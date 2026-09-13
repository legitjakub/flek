-- business_details expanded `b.*` before businesses.cancellation_window_minutes existed, so
-- the merchant form could never read back its own policy. The column order changes, which
-- CREATE OR REPLACE cannot do, so the view and its reader are rebuilt.
drop function if exists public.my_businesses();
drop view if exists public.business_details;

create view public.business_details with(security_invoker=true) as
 select b.*,extensions.st_y(location::extensions.geometry) latitude,extensions.st_x(location::extensions.geometry) longitude
 from public.businesses b;

create function public.my_businesses() returns setof public.business_details language sql stable security definer set search_path=public as $$
 select * from public.business_details where public.is_member_of(id) order by created_at;
$$;

revoke all on public.business_details from anon,authenticated;
revoke execute on function public.my_businesses() from public,anon,authenticated;
grant execute on function public.my_businesses() to authenticated,service_role;
grant all on public.business_details to service_role;
