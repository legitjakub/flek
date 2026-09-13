/*
 * Payments go through Stripe only.
 *
 * Nothing can create or settle a demo payment any more: `start_payment` always opens a Stripe
 * payment, a business sells only once Stripe lets it receive transfers, the demo confirmation is
 * gone and the daily demo refresh only fills venues that can be paid. `provider = 'demo'` stays
 * valid for payments made before the switch, so their bookings can still be cancelled (refunding a
 * demo payment only flips its row).
 */

delete from private.settings where key = 'payments_provider';

drop function public.demo_confirm_payment(uuid);

-- Demo attempts nobody can finish any more.
update public.payments set status = 'failed', failure_reason = 'DEMO_RETIRED'
where provider = 'demo' and status = 'pending';

alter table public.payments alter column provider set default 'stripe';
alter table public.payments add constraint payments_provider_known check (provider in ('demo', 'stripe'));

create or replace function public.start_payment(p_offer_id uuid)
returns public.payments
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); o public.offers; b public.businesses; p public.payments;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into o from public.offers where id = p_offer_id;
  if o.id is null then raise exception 'OFFER_UNAVAILABLE'; end if;
  select * into b from public.businesses where id = o.business_id;
  if b.status <> 'approved' or not public.offer_is_bookable(o.status, o.capacity_remaining, o.booking_cutoff_at, o.start_at) then
    raise exception 'OFFER_UNAVAILABLE';
  end if;
  if exists (select 1 from public.bookings k where k.offer_id = p_offer_id and k.customer_id = u and k.status = 'confirmed') then
    raise exception 'ALREADY_BOOKED';
  end if;
  if b.stripe_account_id is null or not b.stripe_charges_enabled then raise exception 'PAYMENTS_NOT_READY'; end if;

  select * into p from public.payments
  where customer_id = u and offer_id = p_offer_id and status = 'pending' and provider = 'stripe'
    and created_at > now() - interval '20 minutes'
  order by created_at desc limit 1;
  if p.id is not null then
    -- A changed price needs a new Checkout page; the old one would charge the old amount.
    update public.payments set amount_cents = o.deal_price_cents, application_fee_cents = o.service_fee_cents,
      checkout_session_id = case when amount_cents = o.deal_price_cents then checkout_session_id end
    where id = p.id returning * into p;
    return p;
  end if;
  insert into public.payments (customer_id, offer_id, amount_cents, provider, destination_account_id, application_fee_cents)
  values (u, p_offer_id, o.deal_price_cents, 'stripe', b.stripe_account_id, o.service_fee_cents)
  returning * into p;
  return p;
end $$;

create or replace function private.require_payments_ready(p_business_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.businesses where id = p_business_id and stripe_account_id is not null and stripe_charges_enabled) then
    raise exception 'STRIPE_NOT_CONNECTED';
  end if;
end $$;

create or replace function public.payments_mode() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('provider', 'stripe', 'test', coalesce(private.setting('stripe_test_mode'), 'true') = 'true')
$$;

create or replace function public.business_payments_status(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b public.businesses;
begin
  if not (public.is_member_of(p_business_id) or public.is_admin()) then raise exception 'FORBIDDEN'; end if;
  select * into b from public.businesses where id = p_business_id;
  return jsonb_build_object(
    'provider', 'stripe',
    'connected', b.stripe_account_id is not null,
    'charges_enabled', b.stripe_charges_enabled, 'payouts_enabled', b.stripe_payouts_enabled,
    'details_submitted', b.stripe_details_submitted, 'synced_at', b.stripe_synced_at);
end $$;

-- The daily demo FLEKs only for venues whose Stripe account can receive the money.
create or replace function private.flek_demo_refresh(p_days integer default 3)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s record;
  d date;
  today date := (now() at time zone 'Europe/Prague')::date;
  starts timestamptz;
  merchant integer;
  fee integer;
  seats integer;
  slots integer;
  created integer := 0;
  skipped integer := 0;
begin
  for s in
    select sv.id, sv.business_id, sv.duration_minutes, sv.normal_price_cents, sv.category_slug
    from public.services sv
    join public.businesses b on b.id = sv.business_id
    where sv.is_active and b.status = 'approved' and b.stripe_account_id is not null and b.stripe_charges_enabled
      and exists (select 1 from public.business_members m where m.business_id = b.id)
      and not exists (
        select 1 from public.business_members m join auth.users u on u.id = m.user_id
        where m.business_id = b.id and u.email not like '%@flek.test')
    order by sv.business_id, sv.id
  loop
    for i in 0 .. least(greatest(p_days, 1), 7) - 1 loop
      d := today + i;
      continue when exists (
        select 1 from public.offers o
        where o.service_id = s.id and o.status = 'published'
          and (o.start_at at time zone 'Europe/Prague')::date = d);

      -- A half-hour slot between 8:00 and 20:00 Prague time.
      starts := (d + make_interval(hours => 8, mins => 30 * (abs(hashtext(s.id::text || d::text)) % 25)))
        at time zone 'Europe/Prague';
      if starts <= now() + interval '45 minutes' then
        -- Today's slot has gone: pick one of the half hours still left before 20:00, so a
        -- midday run does not stack every service on the same hour.
        starts := date_trunc('hour', now()) + interval '2 hours';
        slots := floor(extract(epoch from ((d + time '20:00') at time zone 'Europe/Prague') - starts) / 1800)::integer + 1;
        if slots < 1 then
          skipped := skipped + 1;
          continue;
        end if;
        starts := starts + make_interval(mins => 30 * (abs(hashtext(s.id::text)) % slots));
      end if;

      if exists (
        select 1 from public.offers o
        where o.business_id = s.business_id and o.status = 'published'
          and o.start_at < starts + make_interval(mins => s.duration_minutes) and o.end_at > starts) then
        skipped := skipped + 1;
        continue;
      end if;

      -- The merchant asks 55–70 % of the regular price, in whole crowns.
      merchant := (s.normal_price_cents * (55 + abs(hashtext(d::text || s.id::text)) % 16) / 100 / 100) * 100;
      begin
        fee := private.validate_flek(starts, starts - interval '15 minutes', merchant, s.normal_price_cents);
      exception when others then
        skipped := skipped + 1;
        continue;
      end;
      seats := case when s.category_slug = 'joga' then 4 else 1 end;

      insert into public.offers (business_id, service_id, start_at, end_at, original_price_cents, deal_price_cents,
        merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining, booking_cutoff_at)
      values (s.business_id, s.id, starts, starts + make_interval(mins => s.duration_minutes), s.normal_price_cents,
        merchant + fee, merchant, fee, private.flek_current_fee_policy(), seats, seats, starts - interval '15 minutes');
      created := created + 1;
    end loop;
  end loop;

  perform private.emit('demo_offers_refreshed', jsonb_build_object('created', created, 'skipped', skipped));
  return jsonb_build_object('created', created, 'skipped', skipped);
end $$;

revoke all on function private.flek_demo_refresh(integer) from public, anon, authenticated;
