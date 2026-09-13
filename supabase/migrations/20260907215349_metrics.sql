-- Merchant and admin read models. Every function re-derives authorization server side.

create view public.merchant_offer_rows with(security_invoker=true) as
 select o.*,s.name service_name,s.duration_minutes,
 (select count(*) from public.bookings k where k.offer_id=o.id and k.status='confirmed') booked,
 (select count(*) from public.bookings k where k.offer_id=o.id and k.status='completed') completed,
 public.offer_is_bookable(o.status,o.capacity_remaining,o.booking_cutoff_at,o.start_at) bookable,
 now() server_now
 from public.offers o join public.services s on s.id=o.service_id;

create function public.merchant_offers(p_business_id uuid,p_from timestamptz default null,p_until timestamptz default null)
returns setof public.merchant_offer_rows language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 return query select * from public.merchant_offer_rows
 where business_id=p_business_id and (p_from is null or start_at>=p_from) and (p_until is null or start_at<p_until)
 order by start_at desc;
end $$;

-- Recovered revenue is the number that decides whether a merchant comes back.
create function public.merchant_metrics(p_business_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare month_start timestamptz:=date_trunc('month',now() at time zone 'Europe/Prague') at time zone 'Europe/Prague';
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 return (select jsonb_build_object(
  'published_offers',(select count(*) from public.offers where business_id=p_business_id and published_at>=month_start),
  'published_capacity',(select coalesce(sum(capacity_total),0) from public.offers where business_id=p_business_id and status<>'draft' and published_at>=month_start),
  'booked_capacity',(select count(*) from public.bookings where business_id=p_business_id and status in ('confirmed','completed','no_show') and created_at>=month_start),
  'bookings',(select count(*) from public.bookings where business_id=p_business_id and created_at>=month_start),
  'completed',(select count(*) from public.bookings where business_id=p_business_id and status='completed' and start_at_snapshot>=month_start),
  'no_show',(select count(*) from public.bookings where business_id=p_business_id and status='no_show' and start_at_snapshot>=month_start),
  'unresolved',(select count(*) from public.bookings where business_id=p_business_id and status='confirmed' and start_at_snapshot<now()-interval '24 hours'),
  'recovered_cents',(select coalesce(sum(price_cents),0) from public.bookings where business_id=p_business_id and status='completed' and start_at_snapshot>=month_start),
  'active_offers',(select count(*) from public.merchant_offer_rows where business_id=p_business_id and bookable),
  'today_bookings',(select count(*) from public.bookings where business_id=p_business_id and status='confirmed' and start_at_snapshot>=date_trunc('day',now() at time zone 'Europe/Prague') at time zone 'Europe/Prague' and start_at_snapshot<(date_trunc('day',now() at time zone 'Europe/Prague')+interval '1 day') at time zone 'Europe/Prague'),
  'free_seats',(select coalesce(sum(capacity_remaining),0) from public.merchant_offer_rows where business_id=p_business_id and bookable)));
end $$;

create function public.admin_businesses(p_status text default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object(
   'latitude',extensions.st_y(b.location::extensions.geometry),'longitude',extensions.st_x(b.location::extensions.geometry),
   'owner_email',(select u.email from public.business_members m join auth.users u on u.id=m.user_id where m.business_id=b.id order by m.role limit 1),
   'services',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'duration_minutes',s.duration_minutes,'normal_price_cents',s.normal_price_cents,'is_active',s.is_active) order by s.name),'[]') from public.services s where s.business_id=b.id),
   'upcoming_offers',(select count(*) from public.offers o where o.business_id=b.id and o.status='published' and o.start_at>now())
  ) order by case when b.status='pending' then 0 else 1 end,b.created_at desc),'[]')
  from public.businesses b where p_status is null or b.status=p_status::public.business_status);
end $$;

create function public.admin_offers(p_query text default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(d) order by d.start_at desc),'[]') from (
  select o.* from public.merchant_offer_rows o join public.businesses b on b.id=o.business_id
  where p_query is null or trim(p_query)='' or o.service_name ilike '%'||trim(p_query)||'%' or b.display_name ilike '%'||trim(p_query)||'%'
  order by o.start_at desc limit greatest(1,least(p_limit,200))) d);
end $$;

create function public.admin_bookings(p_query text default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(d) order by d.start_at_snapshot desc),'[]') from (
  select k.* from public.bookings k
  where p_query is null or trim(p_query)='' or k.reservation_code ilike '%'||trim(p_query)||'%' or k.business_name_snapshot ilike '%'||trim(p_query)||'%'
  order by k.start_at_snapshot desc limit greatest(1,least(p_limit,200))) d);
end $$;

-- The pilot hypothesis expressed as numbers: do merchants publish again, and do customers show up.
create function public.admin_metrics() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 return jsonb_build_object(
  'published_capacity',(select coalesce(sum(capacity_total),0) from public.offers where status<>'draft'),
  'booked_capacity',(select count(*) from public.bookings where status in ('confirmed','completed','no_show')),
  'fill_rate_by_category',(select coalesce(jsonb_agg(jsonb_build_object('category',c.label_cs,'published',t.published,'booked',t.booked) order by t.published desc),'[]')
   from (select s.category_slug,sum(o.capacity_total) published,sum(o.capacity_total-o.capacity_remaining) booked
         from public.offers o join public.services s on s.id=o.service_id where o.status<>'draft' group by s.category_slug) t
   join public.categories c on c.slug=t.category_slug),
  'median_minutes_to_first_booking',(select percentile_cont(0.5) within group (order by m) from
   (select extract(epoch from min(k.created_at)-o.published_at)/60 m from public.offers o join public.bookings k on k.offer_id=o.id group by o.id,o.published_at) x),
  'approved_businesses',(select count(*) from public.businesses where status='approved'),
  'repeat_merchants',(select count(*) from (select business_id from public.offers group by business_id having count(distinct date_trunc('week',published_at))>=2) r),
  'repeat_customers',(select count(*) from (select customer_id from public.bookings where status='completed' group by customer_id having count(*)>=2) r),
  'customers',(select count(*) from public.profiles),
  'completed',(select count(*) from public.bookings where status='completed'),
  'no_show',(select count(*) from public.bookings where status='no_show'),
  'unresolved',(select count(*) from public.bookings where status='confirmed' and start_at_snapshot<now()-interval '24 hours'),
  'realized_cents',(select coalesce(sum(price_cents),0) from public.bookings where status='completed'),
  'commission_cents',(select coalesce(round(sum(k.price_cents*b.commission_rate)),0) from public.bookings k join public.businesses b on b.id=k.business_id where k.status='completed'),
  'funnel',jsonb_build_object(
   'offer_viewed',(select count(*) from public.analytics_events where name='offer_viewed'),
   'booking_started',(select count(*) from public.analytics_events where name='booking_started'),
   'booking_created',(select count(*) from public.analytics_events where name='booking_created')),
  'failures',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'count',n) order by n desc),'[]')
   from (select coalesce(props->>'code','UNKNOWN') code,count(*) n from public.analytics_events where name='booking_failed' group by 1) f));
end $$;

revoke all on public.merchant_offer_rows from anon,authenticated;
revoke execute on function public.merchant_offers(uuid,timestamptz,timestamptz),public.merchant_metrics(uuid),public.admin_businesses(text),public.admin_offers(text,integer),public.admin_bookings(text,integer),public.admin_metrics() from public,anon;
grant execute on function public.merchant_offers(uuid,timestamptz,timestamptz),public.merchant_metrics(uuid),public.admin_businesses(text),public.admin_offers(text,integer),public.admin_bookings(text,integer),public.admin_metrics() to authenticated,service_role;
grant all on all tables in schema public to service_role;
