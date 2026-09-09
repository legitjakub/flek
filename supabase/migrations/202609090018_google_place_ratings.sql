/*
 * Public ratings come from Google Places. Only the stable Place ID is persisted: Google
 * Maps Platform forbids storing Places content such as the current rating and review count.
 * The edge function fetches those values when the UI asks for them and sends no-store.
 */
alter table public.businesses
  add column google_place_id text
  check (
    google_place_id is null or
    (length(google_place_id) between 10 and 255 and google_place_id !~ '[[:space:]]')
  );

create unique index businesses_google_place_id_unique
  on public.businesses(google_place_id)
  where google_place_id is not null;

/* Rebuild the dependent favorite view so the newly appended Place ID reaches its rows. */
drop function if exists public.new_at_favorites(integer);
drop view if exists public.favorite_offer_rows;

create or replace view public.offer_details with(security_invoker=true) as
 select o.*,s.name service_name,s.description,s.category_slug,s.image_url,
 b.display_name business_name,b.slug business_slug,b.description business_description,b.phone business_phone,
 b.address_line,b.city,b.district,b.cover_url,b.logo_url,b.status business_status,
 extensions.st_y(b.location::extensions.geometry) latitude,extensions.st_x(b.location::extensions.geometry) longitude,
 floor((o.original_price_cents-o.deal_price_cents)::numeric*100/o.original_price_cents)::integer discount_pct,
 public.offer_is_bookable(o.status,o.capacity_remaining,o.booking_cutoff_at,o.start_at) and b.status='approved' bookable,
 now() server_now,
 (select round(avg(r.rating),1) from public.bookings r where r.business_id=b.id and r.rating is not null) rating_avg,
 (select count(*) from public.bookings r where r.business_id=b.id and r.rating is not null)::integer rating_count,
 b.cancellation_window_minutes,
 b.google_place_id
 from public.offers o join public.services s on s.id=o.service_id join public.businesses b on b.id=o.business_id;

drop function if exists public.search_offers(float8,float8,integer,text,timestamptz,timestamptz,integer,integer,text,integer,integer,text);

create function public.search_offers(p_lat float8,p_lng float8,p_radius_m integer default 5000,p_category text default null,p_from timestamptz default now(),p_until timestamptz default null,p_min_discount_pct integer default 0,p_max_price_cents integer default null,p_sort text default 'recommended',p_limit integer default 20,p_offset integer default 0,p_daypart text default null)
returns table(id uuid,business_id uuid,service_id uuid,business_name text,business_slug text,service_name text,description text,category_slug text,start_at timestamptz,end_at timestamptz,booking_cutoff_at timestamptz,original_price_cents integer,deal_price_cents integer,capacity_total integer,capacity_remaining integer,address_line text,city text,district text,latitude float8,longitude float8,cover_url text,logo_url text,image_url text,distance_m float8,discount_pct integer,score float8,server_now timestamptz,rating_avg numeric,rating_count integer,google_place_id text)
language plpgsql stable security definer set search_path=public as $$
begin
 if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_radius_m not between 1 and 100000 or p_limit not between 1 and 100 or p_offset<0 or p_sort not in ('recommended','nearest','discount','cheapest','soonest') or coalesce(p_daypart,'morning') not in ('morning','afternoon','evening') then raise exception 'VALIDATION_ERROR'; end if;
 return query with eligible as (
  select d.*,extensions.st_distance(b.location,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography) dist
  from public.offer_details d join public.businesses b on b.id=d.business_id
  where d.bookable and d.start_at>=coalesce(p_from,now()) and (p_until is null or d.start_at<p_until)
  and (p_category is null or d.category_slug=p_category) and d.discount_pct>=p_min_discount_pct
  and (p_max_price_cents is null or d.deal_price_cents<=p_max_price_cents)
  and (p_daypart is null or case p_daypart
        when 'morning' then extract(hour from d.start_at at time zone 'Europe/Prague') < 12
        when 'afternoon' then extract(hour from d.start_at at time zone 'Europe/Prague') between 12 and 16
        else extract(hour from d.start_at at time zone 'Europe/Prague') >= 17 end)
  and extensions.st_dwithin(b.location,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography,p_radius_m)
 ), scored as (
  select e.*, (0.45*(1-least(e.dist/p_radius_m,1))+0.35*(1-least(extract(epoch from e.start_at-now())/43200.0,1))+0.20*least(e.discount_pct/60.0,1))::float8 rank_score from eligible e
 ) select e.id,e.business_id,e.service_id,e.business_name,e.business_slug,e.service_name,e.description,e.category_slug,e.start_at,e.end_at,e.booking_cutoff_at,e.original_price_cents,e.deal_price_cents,e.capacity_total,e.capacity_remaining,e.address_line,e.city,e.district,e.latitude,e.longitude,e.cover_url,e.logo_url,e.image_url,e.dist,e.discount_pct,e.rank_score,e.server_now,e.rating_avg,e.rating_count,e.google_place_id
 from scored e order by
 case when p_sort='recommended' then e.rank_score end desc,
 case when p_sort='nearest' then e.dist end asc,
 case when p_sort='discount' then e.discount_pct end desc,
 case when p_sort='cheapest' then e.deal_price_cents end asc,
 e.start_at asc,e.id asc limit p_limit offset p_offset;
end $$;

create view public.favorite_offer_rows with(security_invoker=true) as
 select f.user_id, d.*, f.seen_at, d.published_at>f.seen_at is_new
 from public.favorites f
 join public.offer_details d on d.business_id=f.business_id
 where d.bookable;

create function public.new_at_favorites(p_limit integer default 20) returns setof public.favorite_offer_rows
language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
 return query select * from public.favorite_offer_rows
  where user_id=auth.uid() and is_new
  order by published_at desc limit p_limit;
end $$;

/* Connecting a real listing is an admin verification step, not a merchant assertion. */
create function public.admin_set_google_place_id(p_business_id uuid,p_place_id text) returns void
language plpgsql security definer set search_path=public as $$
declare normalized text := nullif(trim(p_place_id),'');
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 if not exists(select 1 from public.businesses where id=p_business_id) then raise exception 'NOT_FOUND'; end if;
 if normalized is not null and (length(normalized) not between 10 and 255 or normalized ~ '[[:space:]]') then
  raise exception 'INVALID_GOOGLE_PLACE_ID';
 end if;
 update public.businesses set google_place_id=normalized,updated_at=now() where id=p_business_id;
end $$;

revoke execute on function public.search_offers(float8,float8,integer,text,timestamptz,timestamptz,integer,integer,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.search_offers(float8,float8,integer,text,timestamptz,timestamptz,integer,integer,text,integer,integer,text) to anon,authenticated,service_role;
revoke all on public.favorite_offer_rows from anon,authenticated;
grant all on public.favorite_offer_rows to service_role;
revoke execute on function public.new_at_favorites(integer),public.admin_set_google_place_id(uuid,text) from public,anon,authenticated;
grant execute on function public.new_at_favorites(integer) to authenticated,service_role;
grant execute on function public.admin_set_google_place_id(uuid,text) to authenticated,service_role;
