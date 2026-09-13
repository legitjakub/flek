/*
 * Delivery fixes after the first notification release.
 *
 * - The worker is authorised against the secret the database already holds. The Edge Function
 *   used to compare it with its own copy in the environment; the two drifted apart and every
 *   run ended in 401, so nothing was ever delivered.
 * - The database calls the worker only when a delivery is due, not every minute for nothing.
 * - A notification goes away with the booking or the venue it describes.
 */

create or replace function public.notification_worker_authorized(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_secret) >= 32, false) and exists (
    select 1 from private.notification_config where key = 'worker_secret' and value = p_secret)
$$;
revoke all on function public.notification_worker_authorized(text) from public, anon, authenticated;
grant execute on function public.notification_worker_authorized(text) to service_role;

create or replace function private.kick_notification_delivery() returns void
language plpgsql security definer set search_path = '' as $$
declare worker_secret text;
begin
  if not exists (select 1 from private.notification_delivery
                 where status in ('pending', 'processing') and available_at <= now() and attempts < 8) then
    return;
  end if;
  select value into worker_secret from private.notification_config where key = 'worker_secret';
  if worker_secret is null then return; end if;
  perform net.http_post(
    url := private.setting('functions_url') || '/notification-delivery',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || worker_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000);
end $$;
revoke all on function private.kick_notification_delivery() from public, anon, authenticated;

alter table public.notifications
  drop constraint notifications_booking_id_fkey,
  add constraint notifications_booking_id_fkey foreign key (booking_id) references public.bookings (id) on delete cascade,
  drop constraint notifications_business_id_fkey,
  add constraint notifications_business_id_fkey foreign key (business_id) references public.businesses (id) on delete cascade;
