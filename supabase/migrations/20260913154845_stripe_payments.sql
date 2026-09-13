/*
 * Stripe Connect payments.
 *
 * Money moves as a destination charge: the customer pays the platform through Stripe Checkout,
 * FLEK keeps its service fee as the application fee and Stripe transfers the rest to the
 * business's connected account. A refund reverses the transfer and returns the fee, so the
 * customer gets everything back and nobody keeps money for a seat that was not used.
 *
 * The database stays the authority on seats and prices. Stripe only answers "was this amount
 * paid": the webhook marks the payment paid and books the seat in the same call the customer
 * would have made, so a customer who closes the tab after paying still gets the booking — or,
 * if the seat went meanwhile, the refund.
 *
 * Rollout: `payments_provider` starts at 'demo' so nothing changes until Stripe keys, the
 * webhook and connected accounts exist; then it is switched to 'stripe' everywhere.
 */

create extension if not exists pg_net;

-- Settings --------------------------------------------------------------------------------------
create table private.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.settings from public, anon, authenticated;
insert into private.settings (key, value) values
  ('payments_provider', 'demo'),
  ('functions_url', 'https://yupkrntknbkvmlajwlph.supabase.co/functions/v1');

create function private.setting(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select value from private.settings where key = p_key
$$;

-- Businesses: the connected account and what Stripe allows it to do ---------------------------
alter table public.businesses
  add column stripe_account_id text unique,
  add column stripe_charges_enabled boolean not null default false,
  add column stripe_payouts_enabled boolean not null default false,
  add column stripe_details_submitted boolean not null default false,
  add column stripe_synced_at timestamptz;

-- Payments: what Stripe knows about each one ------------------------------------------------------
alter table public.payments
  add column checkout_session_id text unique,
  add column payment_intent_id text unique,
  add column destination_account_id text,
  add column application_fee_cents integer check (application_fee_cents is null or application_fee_cents >= 0),
  add column livemode boolean,
  add column refund_requested_at timestamptz,
  add column refund_id text,
  add column refund_attempts integer not null default 0,
  add column refund_error text check (length(coalesce(refund_error, '')) <= 500),
  add column failure_reason text check (length(coalesce(failure_reason, '')) <= 200);
create index payments_refund_queue on public.payments (refund_requested_at)
  where provider = 'stripe' and status = 'paid' and refund_requested_at is not null;

-- Webhook deliveries already handled; Stripe retries and may deliver an event twice ---------------
create table private.stripe_events (
  id text primary key,
  type text not null,
  livemode boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text check (length(coalesce(error, '')) <= 500)
);

-- Refund worker: ask the Edge Function to process the queue after the transaction commits --------
create function private.kick_refunds() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.payments
             where provider = 'stripe' and status = 'paid' and refund_requested_at is not null and refund_attempts < 8) then
    perform net.http_post(
      url := private.setting('functions_url') || '/stripe-refunds',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000);
  end if;
end $$;

create or replace function private.refund_for_booking(p_booking_id uuid) returns void
language plpgsql set search_path = public as $$
declare pay_id uuid := (select payment_id from public.bookings where id = p_booking_id);
begin
  -- Demo money is only a row: flip it.
  update public.payments set status = 'refunded', refunded_at = now()
  where id = pay_id and status = 'paid' and provider = 'demo';
  -- Real money is returned by Stripe; the row turns refunded when Stripe accepts the refund.
  update public.payments set refund_requested_at = coalesce(refund_requested_at, now())
  where id = pay_id and status = 'paid' and provider = 'stripe';
  if found then perform private.kick_refunds(); end if;
end $$;

-- Booking a paid seat, for the customer or for the webhook acting for them ------------------------
create function private.book_payment(u uuid, p_offer_id uuid, p_payment_id uuid)
returns table (booking_id uuid, reservation_code text)
language plpgsql security definer set search_path = public as $$
declare p public.profiles; pay public.payments; o public.offers; s public.services; b public.businesses; code text; constraint_name text;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  select k.id, k.reservation_code into booking_id, reservation_code
    from public.bookings k where k.payment_id = p_payment_id and k.customer_id = u and k.offer_id = p_offer_id;
  if booking_id is not null then return next; return; end if;

  select * into p from public.profiles where id = u for update;
  select k.id, k.reservation_code into booking_id, reservation_code
    from public.bookings k where k.payment_id = p_payment_id and k.customer_id = u and k.offer_id = p_offer_id;
  if booking_id is not null then return next; return; end if;
  if p.phone is null or length(regexp_replace(p.phone, '[^0-9]', '', 'g')) < 9 then raise exception 'PHONE_REQUIRED'; end if;
  if exists (select 1 from public.bookings x where x.offer_id = p_offer_id and x.customer_id = u and x.status = 'confirmed') then raise exception 'ALREADY_BOOKED'; end if;
  if p.booking_blocked then raise exception 'BOOKING_BLOCKED'; end if;
  if (select count(*) from public.bookings where customer_id = u and status = 'confirmed' and start_at_snapshot > now()) >= 3 then raise exception 'TOO_MANY_ACTIVE'; end if;
  if coalesce(p.no_show_override_until, '-infinity') < now()
     and (select count(*) from public.bookings where customer_id = u and status = 'no_show' and start_at_snapshot > now() - interval '60 days') >= 2 then
    raise exception 'BLOCKED_NO_SHOW';
  end if;

  select biz.* into b from public.businesses biz join public.offers x on x.business_id = biz.id where x.id = p_offer_id for share of biz;
  if b.id is null or b.status <> 'approved' then raise exception 'OFFER_UNAVAILABLE'; end if;
  update public.offers x set capacity_remaining = x.capacity_remaining - 1, updated_at = now()
  where x.id = p_offer_id and public.offer_is_bookable(x.status, x.capacity_remaining, x.booking_cutoff_at, x.start_at)
  returning x.* into o;
  if not found then raise exception 'OFFER_UNAVAILABLE'; end if;
  -- Lock order matches cancellation: customer, business, offer, payment.
  select * into pay from public.payments where id = p_payment_id for update;
  if pay.id is null or pay.customer_id <> u or pay.offer_id <> p_offer_id then raise exception 'PAYMENT_REQUIRED'; end if;
  if pay.status <> 'paid' or pay.refund_requested_at is not null then raise exception 'PAYMENT_REQUIRED'; end if;
  if pay.amount_cents <> o.deal_price_cents then raise exception 'PRICE_CHANGED'; end if;

  select * into s from public.services where id = o.service_id;
  for i in 1..5 loop
    code := 'FLEK-' || public.generate_reservation_code(6);
    begin
      insert into public.bookings as bk (offer_id, business_id, customer_id, reservation_code, price_cents, service_name_snapshot,
        business_name_snapshot, business_address_snapshot, start_at_snapshot, end_at_snapshot, original_price_cents_snapshot,
        payment_id, cancellation_window_minutes, merchant_payout_cents, service_fee_cents, fee_policy_version)
      values (o.id, o.business_id, u, code, o.deal_price_cents, s.name, b.display_name, b.address_line || ', ' || b.city,
        o.start_at, o.end_at, o.original_price_cents, pay.id, b.cancellation_window_minutes,
        o.merchant_price_cents, o.service_fee_cents, o.fee_policy_version)
      returning bk.id, bk.reservation_code into booking_id, reservation_code;
      perform private.emit('booking_created', jsonb_build_object('booking_id', booking_id, 'offer_id', o.id, 'business_id', b.id, 'provider', pay.provider));
      return next; return;
    exception when unique_violation then
      get stacked diagnostics constraint_name = CONSTRAINT_NAME;
      if constraint_name = 'bookings_one_active_per_customer_offer' then raise exception 'ALREADY_BOOKED'; end if;
      if constraint_name = 'bookings_one_per_payment' then raise exception 'PAYMENT_ALREADY_USED'; end if;
      if constraint_name <> 'bookings_reservation_code_key' then raise; end if;
    end;
  end loop;
  raise exception 'CODE_GENERATION_FAILED';
end $$;

create or replace function public.create_booking(p_offer_id uuid, p_payment_id uuid)
returns table (booking_id uuid, reservation_code text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return query select * from private.book_payment(auth.uid(), p_offer_id, p_payment_id);
end $$;

-- Starting a payment picks the provider and, for Stripe, the business's connected account ---------
create or replace function public.start_payment(p_offer_id uuid)
returns public.payments
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); o public.offers; b public.businesses; p public.payments;
  chosen text := coalesce(private.setting('payments_provider'), 'demo');
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
  if chosen = 'stripe' and (b.stripe_account_id is null or not b.stripe_charges_enabled) then
    raise exception 'PAYMENTS_NOT_READY';
  end if;

  select * into p from public.payments
  where customer_id = u and offer_id = p_offer_id and status = 'pending' and payments.provider = chosen
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
  values (u, p_offer_id, o.deal_price_cents, chosen,
    case when chosen = 'stripe' then b.stripe_account_id end,
    case when chosen = 'stripe' then o.service_fee_cents end)
  returning * into p;
  return p;
end $$;

-- A merchant cannot sell seats nobody could pay for ----------------------------------------------
create or replace function private.require_payments_ready(p_business_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(private.setting('payments_provider'), 'demo') = 'stripe'
     and not exists (select 1 from public.businesses where id = p_business_id and stripe_account_id is not null and stripe_charges_enabled) then
    raise exception 'STRIPE_NOT_CONNECTED';
  end if;
end $$;

create or replace function public.publish_flek(p_service_id uuid, p_start_at timestamptz, p_merchant_price_cents integer,
  p_capacity_total integer default 1, p_booking_cutoff_at timestamptz default null, p_confirm_overlap boolean default false)
returns public.offers
language plpgsql security definer set search_path = public as $$
declare s public.services; b public.businesses; o public.offers; fee integer; first_offer boolean;
  cutoff timestamptz := coalesce(p_booking_cutoff_at, p_start_at - interval '15 minutes');
begin
  select * into s from public.services where id = p_service_id;
  if s.id is null or not public.is_member_of(s.business_id) then raise exception 'FORBIDDEN'; end if;
  select * into b from public.businesses where id = s.business_id for update;
  select * into s from public.services where id = p_service_id for update;
  if b.status <> 'approved' then raise exception 'BUSINESS_NOT_APPROVED'; end if;
  perform private.require_payments_ready(b.id);
  if not s.is_active then raise exception 'VALIDATION_ERROR'; end if;
  if p_capacity_total is null or p_capacity_total not between 1 and 50 then raise exception 'INVALID_CAPACITY'; end if;
  fee := private.validate_flek(p_start_at, cutoff, p_merchant_price_cents, s.normal_price_cents);
  if not p_confirm_overlap and exists (select 1 from public.offers where business_id = b.id and status = 'published'
      and start_at < p_start_at + make_interval(mins => s.duration_minutes) and end_at > p_start_at) then
    raise exception 'OVERLAP_CONFIRMATION_REQUIRED';
  end if;
  first_offer := not exists (select 1 from public.offers where business_id = b.id);
  insert into public.offers (business_id, service_id, start_at, end_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining, booking_cutoff_at)
  values (b.id, s.id, p_start_at, p_start_at + make_interval(mins => s.duration_minutes), s.normal_price_cents,
    p_merchant_price_cents + fee, p_merchant_price_cents, fee, private.flek_current_fee_policy(),
    p_capacity_total, p_capacity_total, cutoff)
  returning * into o;
  update public.services set default_merchant_price_cents = p_merchant_price_cents, default_capacity = p_capacity_total where id = s.id;
  perform private.emit('offer_published', jsonb_build_object('offer_id', o.id, 'business_id', b.id, 'first', first_offer, 'fee_policy_version', o.fee_policy_version));
  return o;
end $$;

create or replace function public.release_unbooked_payment(p_payment_id uuid)
returns public.payments
language plpgsql security definer set search_path = public as $$
declare pay public.payments;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into pay from public.payments where id = p_payment_id and customer_id = auth.uid() for update;
  if pay.id is null then raise exception 'FORBIDDEN'; end if;
  if exists (select 1 from public.bookings where payment_id = pay.id) then return pay; end if;
  if pay.status = 'paid' and pay.provider = 'demo' then
    update public.payments set status = 'refunded', refunded_at = now() where id = pay.id returning * into pay;
    perform private.emit('payment_released', jsonb_build_object('payment_id', pay.id, 'offer_id', pay.offer_id, 'reason', 'booking_failed'));
  elsif pay.status = 'paid' and pay.provider = 'stripe' and pay.refund_requested_at is null then
    update public.payments set refund_requested_at = now(), failure_reason = 'BOOKING_FAILED' where id = pay.id returning * into pay;
    perform private.kick_refunds();
    perform private.emit('payment_released', jsonb_build_object('payment_id', pay.id, 'offer_id', pay.offer_id, 'reason', 'booking_failed'));
  end if;
  return pay;
end $$;

-- What the customer sees after returning from Checkout ---------------------------------------------
create function public.my_payment_state(p_payment_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pay public.payments; k record;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into pay from public.payments where id = p_payment_id and customer_id = auth.uid();
  if pay.id is null then raise exception 'NOT_FOUND'; end if;
  select id, reservation_code into k from public.bookings where payment_id = pay.id;
  return jsonb_build_object(
    'id', pay.id, 'offer_id', pay.offer_id, 'provider', pay.provider, 'status', pay.status,
    'amount_cents', pay.amount_cents, 'refund_requested', pay.refund_requested_at is not null,
    'failure_reason', pay.failure_reason, 'booking_id', k.id, 'reservation_code', k.reservation_code);
end $$;
revoke all on function public.my_payment_state(uuid) from public, anon;
grant execute on function public.my_payment_state(uuid) to authenticated;

-- A member sees whether the business can take Stripe payments -------------------------------------
create function public.business_payments_status(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b public.businesses;
begin
  if not (public.is_member_of(p_business_id) or public.is_admin()) then raise exception 'FORBIDDEN'; end if;
  select * into b from public.businesses where id = p_business_id;
  return jsonb_build_object(
    'provider', coalesce(private.setting('payments_provider'), 'demo'),
    'connected', b.stripe_account_id is not null,
    'charges_enabled', b.stripe_charges_enabled, 'payouts_enabled', b.stripe_payouts_enabled,
    'details_submitted', b.stripe_details_submitted, 'synced_at', b.stripe_synced_at);
end $$;
revoke all on function public.business_payments_status(uuid) from public, anon;
grant execute on function public.business_payments_status(uuid) to authenticated;

-- Server-only entry points for the Edge Functions (service role) ------------------------------------
create function public.stripe_event_begin(p_id text, p_type text, p_livemode boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare done timestamptz;
begin
  insert into private.stripe_events (id, type, livemode) values (p_id, p_type, p_livemode) on conflict (id) do nothing;
  select processed_at into done from private.stripe_events where id = p_id;
  return done is null;
end $$;

create function public.stripe_event_finish(p_id text, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update private.stripe_events set processed_at = case when p_error is null then now() end, error = left(p_error, 500) where id = p_id;
$$;

create function public.stripe_payment_succeeded(p_payment_id uuid, p_intent text, p_amount integer, p_currency text,
  p_livemode boolean, p_session text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pay public.payments; k record;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if pay.id is null or pay.provider <> 'stripe' then return jsonb_build_object('outcome', 'unknown_payment'); end if;
  if pay.status = 'refunded' then return jsonb_build_object('outcome', 'already_refunded'); end if;
  if pay.status in ('pending', 'failed') then
    update public.payments set status = 'paid', paid_at = now(), payment_intent_id = p_intent, provider_reference = p_intent,
      checkout_session_id = coalesce(p_session, checkout_session_id), livemode = p_livemode
    where id = pay.id returning * into pay;
    if p_amount <> pay.amount_cents or lower(p_currency) <> 'czk' then
      update public.payments set refund_requested_at = now(), failure_reason = 'AMOUNT_MISMATCH' where id = pay.id;
      return jsonb_build_object('outcome', 'refund', 'reason', 'AMOUNT_MISMATCH');
    end if;
  end if;
  if pay.refund_requested_at is not null then return jsonb_build_object('outcome', 'refund', 'reason', pay.failure_reason); end if;
  begin
    select * into k from private.book_payment(pay.customer_id, pay.offer_id, pay.id);
    return jsonb_build_object('outcome', 'booked', 'booking_id', k.booking_id, 'reservation_code', k.reservation_code);
  exception when others then
    update public.payments set refund_requested_at = coalesce(refund_requested_at, now()), failure_reason = left(sqlerrm, 200)
    where id = pay.id and not exists (select 1 from public.bookings where payment_id = pay.id);
    return jsonb_build_object('outcome', 'refund', 'reason', sqlerrm);
  end;
end $$;

create function public.stripe_checkout_expired(p_payment_id uuid, p_session text) returns void
language sql security definer set search_path = public as $$
  update public.payments set status = 'failed', failure_reason = 'CHECKOUT_EXPIRED'
  where id = p_payment_id and provider = 'stripe' and status = 'pending' and checkout_session_id = p_session;
$$;

create function public.stripe_refund_done(p_payment_id uuid, p_refund text) returns void
language sql security definer set search_path = public as $$
  update public.payments set status = 'refunded', refunded_at = coalesce(refunded_at, now()), refund_id = coalesce(p_refund, refund_id), refund_error = null
  where id = p_payment_id and provider = 'stripe' and status in ('paid', 'refunded');
$$;

create function public.stripe_refund_failed(p_payment_id uuid, p_error text) returns void
language sql security definer set search_path = public as $$
  update public.payments set refund_attempts = refund_attempts + 1, refund_error = left(p_error, 500) where id = p_payment_id;
$$;

create function public.stripe_account_synced(p_business_id uuid, p_account text, p_charges boolean, p_payouts boolean, p_details boolean) returns void
language sql security definer set search_path = public as $$
  update public.businesses set stripe_account_id = p_account, stripe_charges_enabled = p_charges, stripe_payouts_enabled = p_payouts,
    stripe_details_submitted = p_details, stripe_synced_at = now()
  where id = p_business_id and (stripe_account_id is null or stripe_account_id = p_account);
$$;

revoke all on function public.stripe_event_begin(text, text, boolean), public.stripe_event_finish(text, text),
  public.stripe_payment_succeeded(uuid, text, integer, text, boolean, text), public.stripe_checkout_expired(uuid, text),
  public.stripe_refund_done(uuid, text), public.stripe_refund_failed(uuid, text),
  public.stripe_account_synced(uuid, text, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.stripe_event_begin(text, text, boolean), public.stripe_event_finish(text, text),
  public.stripe_payment_succeeded(uuid, text, integer, text, boolean, text), public.stripe_checkout_expired(uuid, text),
  public.stripe_refund_done(uuid, text), public.stripe_refund_failed(uuid, text),
  public.stripe_account_synced(uuid, text, boolean, boolean, boolean)
  to service_role;

revoke all on all functions in schema private from public, anon, authenticated;

-- Safety net: refunds that were requested but not yet accepted, and paid money with no seat ----------
create function private.flek_stripe_maintenance() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payments set refund_requested_at = now(), failure_reason = coalesce(failure_reason, 'NO_BOOKING')
  where provider = 'stripe' and status = 'paid' and refund_requested_at is null
    and paid_at < now() - interval '60 minutes'
    and not exists (select 1 from public.bookings b where b.payment_id = payments.id);
  update public.payments set status = 'failed', failure_reason = coalesce(failure_reason, 'ABANDONED')
  where provider = 'stripe' and status = 'pending' and created_at < now() - interval '2 hours';
  perform private.kick_refunds();
end $$;
revoke all on function private.flek_stripe_maintenance() from public, anon, authenticated;
select cron.schedule('flek-stripe-maintenance', '*/5 * * * *', $$select private.flek_stripe_maintenance()$$);
