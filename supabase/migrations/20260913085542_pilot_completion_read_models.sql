-- Read models use the same end + 24h deadline as maintenance and no-show resolution.

create or replace view public.merchant_booking_rows with(security_invoker=true) as
 select k.id,k.offer_id,k.business_id,k.customer_id,k.reservation_code,k.price_cents,k.service_name_snapshot,
 k.business_name_snapshot,k.business_address_snapshot,k.start_at_snapshot,k.end_at_snapshot,
 k.original_price_cents_snapshot,k.status,k.created_at,k.cancelled_at,k.resolved_at,k.cancellation_reason,
 k.rating,k.rated_at,k.payment_id,
 trim(p.first_name||' '||case when p.last_name<>'' then left(p.last_name,1)||'.' else '' end) customer_label,
 -- "Nedorazil" can be marked from the start of the slot until 24 h after its end; after that
 -- the booking completes on its own.
 k.status='confirmed' and now()>=k.start_at_snapshot and now()<k.end_at_snapshot+interval '24 hours' can_resolve,
 k.status='confirmed' and now()>=k.end_at_snapshot+interval '24 hours' unresolved, now() server_now,
 (select pay.status from public.payments pay where pay.id=k.payment_id) payment_status,
 k.merchant_payout_cents,k.service_fee_cents,k.fee_policy_version,
 k.end_at_snapshot+interval '24 hours' resolution_deadline
 from public.bookings k join public.profiles p on p.id=k.customer_id;

create or replace function public.merchant_metrics(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare month_start timestamptz:=date_trunc('month',now() at time zone 'Europe/Prague') at time zone 'Europe/Prague';
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 return (select jsonb_build_object(
  'published_offers',(select count(*) from public.offers where business_id=p_business_id and published_at>=month_start),
  'published_capacity',(select coalesce(sum(capacity_total),0) from public.offers where business_id=p_business_id and status<>'draft' and published_at>=month_start),
  'booked_capacity',(select count(*) from public.bookings where business_id=p_business_id and status in ('confirmed','completed','no_show') and created_at>=month_start),
  'completed',(select count(*) from public.bookings where business_id=p_business_id and status='completed' and resolved_at>=month_start),
  'no_shows',(select count(*) from public.bookings where business_id=p_business_id and status='no_show' and resolved_at>=month_start),
  'cancelled',(select count(*) from public.bookings where business_id=p_business_id and status in ('cancelled_by_customer','cancelled_by_merchant') and cancelled_at>=month_start),
  'unresolved',(select count(*) from public.bookings where business_id=p_business_id and status='confirmed' and end_at_snapshot<=now()-interval '24 hours'),
  'recovered_cents',(select coalesce(sum(price_cents),0) from public.bookings where business_id=p_business_id and status='completed' and start_at_snapshot>=month_start),
  -- What the merchant is paid: their own price, for every booking whose payment was kept.
  -- A no-show counts: the customer paid and the slot was held for them.
  'earned_cents',(select coalesce(sum(merchant_payout_cents),0) from public.bookings where business_id=p_business_id and status in ('completed','no_show') and start_at_snapshot>=month_start),
  'upcoming_payout_cents',(select coalesce(sum(merchant_payout_cents),0) from public.bookings where business_id=p_business_id and status='confirmed'),
  'active_offers',(select count(*) from public.merchant_offer_rows where business_id=p_business_id and bookable),
  'today_bookings',(select count(*) from public.bookings where business_id=p_business_id and status='confirmed' and start_at_snapshot>=date_trunc('day',now() at time zone 'Europe/Prague') at time zone 'Europe/Prague' and start_at_snapshot<(date_trunc('day',now() at time zone 'Europe/Prague')+interval '1 day') at time zone 'Europe/Prague'),
  'followers',(select count(*) from public.favorites where business_id=p_business_id),
  'free_seats',(select coalesce(sum(capacity_remaining),0) from public.merchant_offer_rows where business_id=p_business_id and bookable)));
end $$;

create or replace function public.admin_metrics() returns jsonb language plpgsql stable security definer set search_path=public as $$
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
  'unresolved',(select count(*) from public.bookings where status='confirmed' and end_at_snapshot<=now()-interval '24 hours'),
  'realized_cents',(select coalesce(sum(price_cents),0) from public.bookings where status in ('completed','no_show')),
  'merchant_payout_cents',(select coalesce(sum(merchant_payout_cents),0) from public.bookings where status in ('completed','no_show')),
  'service_fee_cents',(select coalesce(sum(service_fee_cents),0) from public.bookings where status in ('completed','no_show')),
  'funnel',jsonb_build_object(
   'offer_viewed',(select count(*) from public.analytics_events where name='offer_viewed'),
   'booking_started',(select count(*) from public.analytics_events where name='booking_started'),
   'booking_created',(select count(*) from public.analytics_events where name='booking_created')),
  -- Where new merchants stall, from the events the server itself records.
  'merchant_funnel',jsonb_build_object(
   'business_created',(select count(*) from public.businesses),
   'business_approved',(select count(*) from public.businesses where status='approved'),
   'with_service',(select count(distinct business_id) from public.services),
   'with_offer',(select count(distinct business_id) from public.offers),
   'with_booking',(select count(distinct business_id) from public.bookings),
   'with_completed_booking',(select count(distinct business_id) from public.bookings where status='completed')),
  'failures',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'count',n) order by n desc),'[]')
   from (select coalesce(props->>'code','UNKNOWN') code,count(*) n from public.analytics_events where name='booking_failed' group by 1) f));
end $$;
