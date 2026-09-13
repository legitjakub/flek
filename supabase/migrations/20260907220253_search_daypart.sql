-- Time of day is the filter this product is actually about ("mám večer volno"), so it
-- belongs in the search RPC next to the other server-side filters, not in the client.
-- The parameter list changes, so the old signature is dropped rather than overloaded.
drop function if exists public.search_offers(float8,float8,integer,text,timestamptz,timestamptz,integer,integer,text,integer,integer);

create function public.search_offers(p_lat float8,p_lng float8,p_radius_m integer default 5000,p_category text default null,p_from timestamptz default now(),p_until timestamptz default null,p_min_discount_pct integer default 0,p_max_price_cents integer default null,p_sort text default 'recommended',p_limit integer default 20,p_offset integer default 0,p_daypart text default null)
returns table(id uuid,business_id uuid,service_id uuid,business_name text,business_slug text,service_name text,description text,category_slug text,start_at timestamptz,end_at timestamptz,booking_cutoff_at timestamptz,original_price_cents integer,deal_price_cents integer,capacity_total integer,capacity_remaining integer,address_line text,city text,district text,latitude float8,longitude float8,cover_url text,logo_url text,image_url text,distance_m float8,discount_pct integer,score float8,server_now timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
 if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_radius_m not between 1 and 100000 or p_limit not between 1 and 100 or p_offset<0 or p_sort not in ('recommended','nearest','discount','cheapest','soonest') or coalesce(p_daypart,'morning') not in ('morning','afternoon','evening') then raise exception 'VALIDATION_ERROR'; end if;
 return query with eligible as (
  select d.*,extensions.st_distance(b.location,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography) dist
  from public.offer_details d join public.businesses b on b.id=d.business_id
  where d.bookable and d.start_at>=coalesce(p_from,now()) and (p_until is null or d.start_at<p_until)
  and (p_category is null or d.category_slug=p_category) and d.discount_pct>=p_min_discount_pct
  and (p_max_price_cents is null or d.deal_price_cents<=p_max_price_cents)
  -- Day parts are Prague wall-clock hours, never the caller's timezone.
  and (p_daypart is null or case p_daypart
        when 'morning' then extract(hour from d.start_at at time zone 'Europe/Prague') < 12
        when 'afternoon' then extract(hour from d.start_at at time zone 'Europe/Prague') between 12 and 16
        else extract(hour from d.start_at at time zone 'Europe/Prague') >= 17 end)
  and extensions.st_dwithin(b.location,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography,p_radius_m)
 ), scored as (
  select e.*, (0.45*(1-least(e.dist/p_radius_m,1))+0.35*(1-least(extract(epoch from e.start_at-now())/43200.0,1))+0.20*least(e.discount_pct/60.0,1))::float8 rank_score from eligible e
 ) select e.id,e.business_id,e.service_id,e.business_name,e.business_slug,e.service_name,e.description,e.category_slug,e.start_at,e.end_at,e.booking_cutoff_at,e.original_price_cents,e.deal_price_cents,e.capacity_total,e.capacity_remaining,e.address_line,e.city,e.district,e.latitude,e.longitude,e.cover_url,e.logo_url,e.image_url,e.dist,e.discount_pct,e.rank_score,e.server_now
 from scored e order by
 case when p_sort='recommended' then e.rank_score end desc,
 case when p_sort='nearest' then e.dist end asc,
 case when p_sort='discount' then e.discount_pct end desc,
 case when p_sort='cheapest' then e.deal_price_cents end asc,
 e.start_at asc,e.id asc limit p_limit offset p_offset;
end $$;
revoke execute on function public.search_offers(float8,float8,integer,text,timestamptz,timestamptz,integer,integer,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.search_offers(float8,float8,integer,text,timestamptz,timestamptz,integer,integer,text,integer,integer,text) to anon,authenticated,service_role;
