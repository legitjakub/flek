-- customer_booking_details was created before bookings.rating existed, so its `k.*` was
-- expanded without it. The column order changes, which CREATE OR REPLACE cannot do, so the
-- view and its reader are dropped and rebuilt.
drop function if exists public.my_bookings();
drop view if exists public.customer_booking_details;

create view public.customer_booking_details with(security_invoker=true) as
 select k.*,b.phone business_phone,
 k.status='confirmed' and (now()<k.start_at_snapshot-interval '60 minutes' or now()<k.created_at+interval '10 minutes') can_cancel,
 greatest(k.start_at_snapshot-interval '60 minutes',k.created_at+interval '10 minutes') cancellation_deadline,
 now() server_now
 from public.bookings k join public.businesses b on b.id=k.business_id;

create function public.my_bookings() returns setof public.customer_booking_details language sql stable security definer set search_path=public as $$
 select * from public.customer_booking_details where customer_id=auth.uid() order by start_at_snapshot desc;
$$;

revoke all on public.customer_booking_details from anon,authenticated;
revoke execute on function public.my_bookings() from public,anon,authenticated;
grant execute on function public.my_bookings() to authenticated,service_role;
grant all on public.customer_booking_details to service_role;
