/*
 * Hardening after the 13. 9. audit.
 *
 * 1. Public data only through explicit read models. Anonymous visitors could select every column
 *    of businesses, services and offers (commission_rate, status_reason, a service's default
 *    merchant price) because RLS filters rows, not columns — and any column added later would have
 *    leaked the same way. The app never reads these tables directly: the feed, detail and venue
 *    page use search_offers, get_offer_detail, business_public and business_offers, which are
 *    security definer. Direct reads stay only for a member of the business and for admins.
 * 2. record_event keeps what it records small and coarse, and raw events expire after 180 days.
 * 3. Nothing in the private schema is executable by client roles, now or when added later.
 * 4. Upper bounds on free text and an allowlist for picture URLs, enforced by the database.
 */

-- 1. Read models only ------------------------------------------------------------------------
revoke select on public.businesses, public.services, public.offers from anon;

drop policy if exists business_read on public.businesses;
create policy business_read on public.businesses for select to authenticated
  using (public.is_member_of(id) or public.is_admin());

drop policy if exists service_read on public.services;
create policy service_read on public.services for select to authenticated
  using (public.is_member_of(business_id) or public.is_admin());

drop policy if exists offers_read on public.offers;
create policy offers_read on public.offers for select to authenticated
  using (public.is_member_of(business_id) or public.is_admin());

-- 2. Analytics --------------------------------------------------------------------------------
create or replace function public.record_event(p_name text, p_session_id text, p_props jsonb default '{}')
returns void
language plpgsql security definer set search_path = public as $$
declare props jsonb := coalesce(p_props, '{}'::jsonb);
begin
  if p_name not in ('search_performed','offer_viewed','booking_started','booking_failed',
                    'favorite_added','favorite_removed','offer_shared',
                    'unavailable_recovery_clicked','similar_offers_clicked',
                    'referral_link_opened') then return; end if;
  if jsonb_typeof(props) <> 'object' or pg_column_size(props) > 2048 then return; end if;
  -- A place next to an account is personal data: a district (~1 km) is all the metrics need.
  if jsonb_typeof(props->'lat') = 'number' then props := jsonb_set(props, '{lat}', to_jsonb(round((props->>'lat')::numeric, 2))); end if;
  if jsonb_typeof(props->'lng') = 'number' then props := jsonb_set(props, '{lng}', to_jsonb(round((props->>'lng')::numeric, 2))); end if;
  insert into public.analytics_events(name, session_id, user_id, props)
  values (p_name, left(p_session_id, 100), auth.uid(), props);
exception when others then null;
end $$;

-- Clients have no INSERT grant; writes go through record_event only.
drop policy if exists analytics_insert on public.analytics_events;

select cron.schedule('flek-analytics-retention', '30 3 * * *',
  $$delete from public.analytics_events where occurred_at < now() - interval '180 days'$$);

-- 3. Private schema ---------------------------------------------------------------------------
revoke all on all functions in schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- 4. Text bounds and picture sources ----------------------------------------------------------
create function private.is_allowed_picture(p_url text) returns boolean
language sql immutable set search_path = public as $$
  select p_url is null
    or p_url ~ '^/images/services/[a-z0-9/_-]+\.(jpg|jpeg|png|webp)$'
    or p_url ~ '^https://images\.unsplash\.com/photo-[A-Za-z0-9-]+(\?[A-Za-z0-9=&%._-]*)?$'
    or p_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/(logos|covers|avatars)/'
    or p_url ~ '^http://127\.0\.0\.1:54321/storage/v1/object/public/(logos|covers|avatars)/'
$$;
revoke all on function private.is_allowed_picture(text) from public, anon, authenticated;

alter table public.businesses
  add constraint businesses_text_bounds check (
    length(coalesce(description, '')) <= 2000 and length(coalesce(legal_name, '')) <= 200
    and length(coalesce(address_line, '')) <= 200 and length(coalesce(city, '')) <= 100
    and length(coalesce(district, '')) <= 100 and length(coalesce(postal_code, '')) <= 20
    and length(coalesce(phone, '')) <= 40 and length(coalesce(public_email, '')) <= 254
    and length(coalesce(website, '')) <= 300 and length(coalesce(status_reason, '')) <= 500),
  add constraint businesses_picture_sources check (
    private.is_allowed_picture(logo_url) and private.is_allowed_picture(cover_url));

alter table public.services
  add constraint services_text_bounds check (length(coalesce(description, '')) <= 2000),
  add constraint services_picture_source check (private.is_allowed_picture(image_url));

alter table public.offers
  add constraint offers_reason_bounds check (length(coalesce(cancellation_reason, '')) <= 500);

alter table public.bookings
  add constraint bookings_reason_bounds check (length(coalesce(cancellation_reason, '')) <= 500);

alter table public.profiles
  add constraint profiles_text_bounds check (
    length(coalesce(first_name, '')) <= 80 and length(coalesce(last_name, '')) <= 80
    and length(coalesce(phone, '')) <= 40),
  add constraint profiles_picture_source check (private.is_allowed_picture(avatar_url));
