create view public.offer_details with(security_invoker=true) as
 select o.*,s.name service_name,s.description,s.category_slug,s.image_url,
 b.display_name business_name,b.slug business_slug,b.description business_description,b.phone business_phone,
 b.address_line,b.city,b.district,b.cover_url,b.logo_url,b.status business_status,
 extensions.st_y(b.location::extensions.geometry) latitude,extensions.st_x(b.location::extensions.geometry) longitude,
 floor((o.original_price_cents-o.deal_price_cents)::numeric*100/o.original_price_cents)::integer discount_pct,
 public.offer_is_bookable(o.status,o.capacity_remaining,o.booking_cutoff_at,o.start_at) and b.status='approved' bookable,
 now() server_now
 from public.offers o join public.services s on s.id=o.service_id join public.businesses b on b.id=o.business_id;

create function public.search_offers(p_lat float8,p_lng float8,p_radius_m integer default 5000,p_category text default null,p_from timestamptz default now(),p_until timestamptz default null,p_min_discount_pct integer default 0,p_max_price_cents integer default null,p_sort text default 'recommended',p_limit integer default 20,p_offset integer default 0)
returns table(id uuid,business_id uuid,service_id uuid,business_name text,business_slug text,service_name text,description text,category_slug text,start_at timestamptz,end_at timestamptz,booking_cutoff_at timestamptz,original_price_cents integer,deal_price_cents integer,capacity_total integer,capacity_remaining integer,address_line text,city text,district text,latitude float8,longitude float8,cover_url text,logo_url text,image_url text,distance_m float8,discount_pct integer,score float8,server_now timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
 if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_radius_m not between 1 and 100000 or p_limit not between 1 and 100 or p_offset<0 or p_sort not in ('recommended','nearest','discount','cheapest','soonest') then raise exception 'VALIDATION_ERROR'; end if;
 return query with eligible as (
  select d.*,extensions.st_distance(b.location,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography) dist
  from public.offer_details d join public.businesses b on b.id=d.business_id
  where d.bookable and d.start_at>=coalesce(p_from,now()) and (p_until is null or d.start_at<p_until)
  and (p_category is null or d.category_slug=p_category) and d.discount_pct>=p_min_discount_pct
  and (p_max_price_cents is null or d.deal_price_cents<=p_max_price_cents)
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

create function public.get_offer_detail(p_offer_id uuid,p_lat float8 default null,p_lng float8 default null) returns jsonb language sql stable security definer set search_path=public as $$
 select to_jsonb(d)||jsonb_build_object('distance_m',case when p_lat between -90 and 90 and p_lng between -180 and 180 then extensions.st_distance(b.location,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography) else null end)
 from public.offer_details d join public.businesses b on b.id=d.business_id where d.id=p_offer_id and (
 (d.status='published' and b.status='approved') or public.is_member_of(b.id) or public.is_admin() or exists(select 1 from public.bookings k where k.offer_id=d.id and k.customer_id=auth.uid())
 );
$$;
create function public.server_clock() returns timestamptz language sql stable as $$ select now(); $$;

create view public.customer_booking_details with(security_invoker=true) as
 select k.*,b.phone business_phone,
 k.status='confirmed' and (now()<k.start_at_snapshot-interval '60 minutes' or now()<k.created_at+interval '10 minutes') can_cancel,
 greatest(k.start_at_snapshot-interval '60 minutes',k.created_at+interval '10 minutes') cancellation_deadline,
 now() server_now
 from public.bookings k join public.businesses b on b.id=k.business_id;
create function public.my_bookings() returns setof public.customer_booking_details language sql stable security definer set search_path=public as $$
 select * from public.customer_booking_details where customer_id=auth.uid() order by start_at_snapshot desc;
$$;
create view public.business_details with(security_invoker=true) as
 select b.*,extensions.st_y(location::extensions.geometry) latitude,extensions.st_x(location::extensions.geometry) longitude from public.businesses b;
create function public.my_businesses() returns setof public.business_details language sql stable security definer set search_path=public as $$
 select * from public.business_details where public.is_member_of(id) order by created_at;
$$;
create view public.merchant_booking_rows with(security_invoker=true) as
 select k.*,trim(p.first_name||' '||case when p.last_name<>'' then left(p.last_name,1)||'.' else '' end) customer_label,
 k.status='confirmed' and now()>=k.start_at_snapshot can_resolve,
 k.status='confirmed' and now()>=k.start_at_snapshot+interval '24 hours' unresolved, now() server_now
 from public.bookings k join public.profiles p on p.id=k.customer_id;
create function public.merchant_bookings(p_business_id uuid,p_from timestamptz default null,p_until timestamptz default null) returns setof public.merchant_booking_rows language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 return query select * from public.merchant_booking_rows where business_id=p_business_id and (p_from is null or start_at_snapshot>=p_from) and (p_until is null or start_at_snapshot<p_until) order by start_at_snapshot;
end $$;
create function public.merchant_booking_detail(p_booking_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select to_jsonb(k)||case when k.status='confirmed' then jsonb_build_object('first_name',p.first_name,'last_name',p.last_name,'phone',p.phone) else '{}'::jsonb end
 from public.merchant_booking_rows k join public.profiles p on p.id=k.customer_id where k.id=p_booking_id and public.is_member_of(k.business_id);
$$;
create function public.merchant_lookup_booking(p_code text) returns jsonb language sql stable security definer set search_path=public as $$
 select public.merchant_booking_detail(k.id) from public.bookings k where k.reservation_code=upper(trim(p_code)) and public.is_member_of(k.business_id);
$$;
create function public.admin_user_lookup(p_email text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('email',u.email,'bookings',(select coalesce(jsonb_agg(to_jsonb(k)),'[]') from public.bookings k where k.customer_id=p.id))),'[]') into result from public.profiles p join auth.users u on u.id=p.id where lower(u.email)=lower(trim(p_email));
 return result;
end $$;
revoke all on public.offer_details,public.customer_booking_details,public.business_details,public.merchant_booking_rows from anon,authenticated;
revoke execute on function public.search_offers(float8,float8,integer,text,timestamptz,timestamptz,integer,integer,text,integer,integer),public.get_offer_detail(uuid,float8,float8),public.server_clock(),public.my_bookings(),public.my_businesses(),public.merchant_bookings(uuid,timestamptz,timestamptz),public.merchant_booking_detail(uuid),public.merchant_lookup_booking(text),public.admin_user_lookup(text) from public,anon,authenticated;
grant execute on function public.search_offers(float8,float8,integer,text,timestamptz,timestamptz,integer,integer,text,integer,integer),public.get_offer_detail(uuid,float8,float8),public.server_clock() to anon,authenticated;
grant execute on function public.my_bookings(),public.my_businesses(),public.merchant_bookings(uuid,timestamptz,timestamptz),public.merchant_booking_detail(uuid),public.merchant_lookup_booking(text),public.admin_user_lookup(text) to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
