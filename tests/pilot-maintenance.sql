-- Privileged regression test: every fixture and side effect is rolled back.
-- Run against a migrated demo database (with demo-merchant and demo-customer).
begin;
do $$
declare
 merchant uuid; customer uuid; venue public.businesses; svc public.services;
 offer_id uuid; payment_id uuid; booking_id uuid; ids uuid[] := '{}';
 orphan uuid; fresh uuid; bound uuid; paid_booking uuid; legacy uuid;
 snapshot_rejected boolean := false; deadline_rejected boolean := false;
 stats jsonb; result jsonb; started timestamptz; ended timestamptz;
begin
 select id into merchant from auth.users where email='demo-merchant@flek.test';
 select id into customer from auth.users where email='demo-customer@flek.test';
 assert merchant is not null and customer is not null, 'Demo fixtures missing';
 select b.* into venue from public.businesses b join public.business_members m on m.business_id=b.id where m.user_id=merchant limit 1;
 venue.id := gen_random_uuid(); venue.slug := 'qa-rollback-'||venue.id; venue.display_name := 'QA transakční test';
 insert into public.businesses select venue.*;
 insert into public.business_members(business_id,user_id) values(venue.id,merchant);
 insert into public.services(business_id,name,category_slug,duration_minutes,normal_price_cents)
 values(venue.id,'QA služba',venue.category_slug,60,100000) returning * into svc;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',merchant,'role','authenticated')::text,true);
 for i in 1..6 loop
  ended := case i when 1 then now()-interval '24 hours'
   when 2 then now()-interval '23 hours 59 minutes'
   when 5 then now()-interval '30 minutes' else now()-interval '26 hours' end;
  started := ended-interval '1 hour';
  insert into public.offers(business_id,service_id,start_at,end_at,booking_cutoff_at,original_price_cents,
   deal_price_cents,merchant_price_cents,service_fee_cents,fee_policy_version,capacity_total,capacity_remaining)
  values(venue.id,svc.id,started,ended,started-interval '15 minutes',100000,78800,75000,3800,1,1,0)
  returning id into offer_id;
  insert into public.payments(customer_id,offer_id,amount_cents,status,paid_at)
  values(customer,offer_id,78800,case when i=4 then 'refunded'::public.payment_status else 'paid'::public.payment_status end,now()-interval '27 hours')
  returning id into payment_id;
  insert into public.bookings(offer_id,business_id,customer_id,reservation_code,price_cents,
   merchant_payout_cents,service_fee_cents,fee_policy_version,service_name_snapshot,business_name_snapshot,
   business_address_snapshot,start_at_snapshot,end_at_snapshot,original_price_cents_snapshot,payment_id,status,resolved_at)
  values(offer_id,venue.id,customer,'QA-'||gen_random_uuid(),78800,75000,3800,1,svc.name,venue.display_name,
   venue.address_line,started,ended,100000,payment_id,
   case i when 3 then 'no_show'::public.booking_status when 4 then 'cancelled_by_customer'::public.booking_status else 'confirmed'::public.booking_status end,
   case when i=3 then now() end)
  returning id into booking_id;
  ids := array_append(ids,booking_id);
  if i=2 then paid_booking := payment_id; end if;
 end loop;
 -- Exactly 24 hours is outside the no-show window, even before the cron next runs.
 begin
  perform public.merchant_resolve_booking(ids[1],'no_show');
 exception when others then
  if sqlerrm='RESOLUTION_WINDOW_CLOSED' then deadline_rejected:=true; else raise; end if;
 end;
 assert deadline_rejected, 'No-show allowed after deadline';
 perform public.merchant_resolve_booking(ids[5],'no_show');
 assert (select status='no_show' from public.bookings where id=ids[5]), 'In-window no-show failed';
 -- Even a privileged SQL edit cannot silently change agreed financial values.
 begin
  update public.bookings set merchant_payout_cents=74900,service_fee_cents=3900 where id=ids[2];
 exception when others then
  if sqlerrm='FINANCIAL_SNAPSHOT_IMMUTABLE' then snapshot_rejected:=true; else raise; end if;
 end;
 assert snapshot_rejected, 'Financial snapshot changed';
 insert into public.payments(customer_id,offer_id,amount_cents,status,paid_at)
 values(customer,offer_id,78800,'paid',now()-interval '31 minutes') returning id into orphan;
 insert into public.payments(customer_id,offer_id,amount_cents,status,paid_at)
 values(customer,offer_id,78800,'paid',now()-interval '29 minutes') returning id into fresh;
 insert into public.payments(customer_id,offer_id,amount_cents,status,paid_at)
 values(customer,offer_id,78800,'paid',now()-interval '30 minutes') returning id into bound;
 result := private.flek_maintenance();
 assert (select status='completed' and resolved_at is not null from public.bookings where id=ids[1]), 'Exact 24h boundary not completed';
 assert (select status='confirmed' from public.bookings where id=ids[2]), 'Completed too early';
 assert (select status='no_show' from public.bookings where id=ids[3]), 'Old no-show overwritten';
 assert (select status='cancelled_by_customer' from public.bookings where id=ids[4]), 'Cancellation overwritten';
 assert (select status='no_show' from public.bookings where id=ids[5]), 'New no-show overwritten';
 assert (select status='completed' from public.bookings where id=ids[6]), 'Old confirmed not completed';
 assert (select status='paid' from public.payments where id=paid_booking), 'Booked payment refunded';
 assert (select status='refunded' and refunded_at is not null from public.payments where id=orphan), 'Old orphan not refunded';
 assert (select status='paid' from public.payments where id=fresh), 'Fresh payment refunded';
 assert (select status='paid' from public.payments where id=bound), '30m boundary refunded too early';
 assert (select p.status='paid' from public.payments p join public.bookings b on b.payment_id=p.id where b.id=ids[5]), 'No-show payment refunded';
 stats := public.merchant_metrics(venue.id);
 assert (stats->>'unresolved')::int=0, 'A booking inside its no-show window is not overdue';
 -- Two completed and two no-shows. All snapshots start in this month for this fixture date.
 assert (stats->>'earned_cents')::int = case when extract(day from now() at time zone 'Europe/Prague')>2 then 300000 else
  (select coalesce(sum(merchant_payout_cents),0) from public.bookings where business_id=venue.id and status in ('completed','no_show') and start_at_snapshot >= date_trunc('month',now() at time zone 'Europe/Prague') at time zone 'Europe/Prague') end, 'No-show payout missing from metrics';
 assert (stats->>'upcoming_payout_cents')::int=75000, 'Upcoming payout wrong';
 result := private.flek_maintenance();
 assert (result->>'completed')::int=0 and (result->>'payments_released')::int=0, 'Maintenance not idempotent';
 -- A legacy insert remains policy 0, with no retroactive fee.
 insert into public.bookings(offer_id,business_id,customer_id,reservation_code,price_cents,
  service_name_snapshot,business_name_snapshot,business_address_snapshot,start_at_snapshot,end_at_snapshot,
  original_price_cents_snapshot,status)
 values(offer_id,venue.id,customer,'QA-'||gen_random_uuid(),39000,svc.name,venue.display_name,venue.address_line,
  started,ended,100000,'cancelled_by_customer') returning id into legacy;
 assert (select merchant_payout_cents=39000 and service_fee_cents=0 and fee_policy_version=0 from public.bookings where id=legacy), 'Legacy price altered';
 assert not has_function_privilege('authenticated','public.publish_offer(uuid,timestamptz,integer,integer,timestamptz,boolean)','EXECUTE'), 'Legacy publish still callable';
 assert not has_function_privilege('authenticated','private.flek_maintenance()','EXECUTE'), 'Client can run maintenance';
end $$;
rollback;
select 'PASS: maintenance, time boundaries, immutable snapshot, no-show payout, legacy prices and grants; all fixtures rolled back' as result;
