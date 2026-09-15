/*
 * Manual confirmation, finished before it is switched on.
 *
 * The first release (manual_confirmation*, 14. 9.) is live but gated off. An audit of it found
 * what had to change before any customer money goes through it:
 *  - a pending request exposed its reservation code through my_bookings and merchant_bookings;
 *  - a merchant who confirmed just before the deadline got the authorisation cancelled, because
 *    capture also required ten minutes before the start;
 *  - a mismatch between Stripe and the payment raised an error, so the webhook retried for days
 *    and the customer's card stayed on hold with nothing queued to release it;
 *  - a capture that fails for good was retried for ever, with the seat held;
 *  - one abandoned Checkout froze the offer's time and price for good (update_offer counted it
 *    as a booking), and suspending a venue left its pending requests waiting;
 *  - every capacity change took the same row lock in private.inventory_revision, a global
 *    serialisation point that could deadlock against an admin suspending a venue;
 *  - decisions left no trace of who decided, when and through which channel.
 *
 * Also: the rollout gate gains a `demo` stage (only venues whose members are all @flek.test), the
 * expiry job runs every 30 seconds instead of 10, and repeated abandoned holds are limited.
 */

alter table public.bookings
  add column merchant_decided_at timestamptz,
  add column merchant_decided_by uuid references auth.users on delete set null,
  add column decision_channel text check (decision_channel in ('app', 'whatsapp'));

-- ------------------------------------------------------------------------------ rollout gate

/** `false` everywhere, `demo` only for venues run entirely by @flek.test accounts, `true` for all. */
create or replace function private.manual_confirmation_for(p_business_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case coalesce(private.setting('manual_confirmation_enabled'), 'false')
    when 'true' then true
    when 'demo' then exists (select 1 from public.business_members m where m.business_id = p_business_id)
      and not exists (
        select 1 from public.business_members m join auth.users u on u.id = m.user_id
        where m.business_id = p_business_id and u.email not like '%@flek.test')
    else false end
$$;

/** How long a seat is held while the customer is on Stripe's page. */
create or replace function private.checkout_hold_interval() returns interval
language sql immutable set search_path = '' as $$ select interval '3 minutes' $$;

/** A request that never became an agreement does not freeze the offer or count as a booking. */
create or replace function private.booking_was_agreed(p_status public.booking_status, p_version integer, p_confirmed_at timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select p_status in ('confirmed', 'completed', 'no_show', 'cancelled_by_customer', 'cancelled_by_merchant')
    and (p_version = 0 or p_confirmed_at is not null)
$$;

-- --------------------------------------------------------------------- releasing a held seat

/**
 * Ends a request that still holds a seat and has not been captured. The caller holds the locks
 * (profile, business, offer, payment, booking) or a stronger one on the business. Returns whether
 * anything changed, so a repeated release is a no-op and the seat comes back exactly once.
 */
create or replace function private.release_hold_locked(p_booking public.bookings, p_status public.booking_status, p_code text, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_booking.status not in ('pending_payment', 'pending_merchant') then return false; end if;
  update public.bookings
  set status = p_status, cancelled_at = now(), cancellation_reason = left(p_reason, 500),
      capacity_released_at = coalesce(capacity_released_at, now())
  where id = p_booking.id and status in ('pending_payment', 'pending_merchant');
  if not found then return false; end if;
  if p_booking.capacity_released_at is null then
    update public.offers set capacity_remaining = least(capacity_remaining + 1, capacity_total), updated_at = now()
    where id = p_booking.offer_id;
  end if;
  update public.payments
  set failure_reason = left(p_code, 200),
      authorization_state = case when authorization_state in ('none', 'authorized') then 'release_pending' else authorization_state end
  where id = p_booking.payment_id;
  insert into private.confirmation_jobs (payment_id, action) values (p_booking.payment_id, 'cancel')
  on conflict (payment_id) do update set action = 'cancel', available_at = now(), completed_at = null, lease = null, attempts = 0;
  perform private.emit('authorization_released', jsonb_build_object(
    'booking_id', p_booking.id, 'payment_id', p_booking.payment_id, 'offer_id', p_booking.offer_id,
    'business_id', p_booking.business_id, 'reason', p_code, 'authorized', p_booking.authorized_at is not null));
  return true;
end $$;

create or replace function private.release_hold(p_id uuid, p_status public.booking_status, p_code text, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare k public.bookings; changed boolean;
begin
  k := private.lock_confirmation(p_id);
  changed := private.release_hold_locked(k, p_status, p_code, p_reason);
  if changed then perform private.kick_confirmations(); end if;
  return changed;
end $$;

-- The first release's name stays for anything still calling it.
create or replace function private.release_confirmation(p_id uuid, p_status public.booking_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.release_hold(p_id, p_status, case p_status
    when 'expired' then 'CONFIRMATION_TIMEOUT' when 'rejected' then 'MERCHANT_REJECTED'
    when 'cancelled_by_customer' then 'CUSTOMER_CANCELLED' when 'cancelled_by_merchant' then 'OFFER_CANCELLED'
    else 'AUTHORIZATION_FAILED' end, p_reason);
end $$;

/** Queues the release of an authorisation that no longer has a request behind it. */
create or replace function private.queue_release(p_payment_id uuid, p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.payments
  set failure_reason = coalesce(failure_reason, left(p_code, 200)),
      authorization_state = case when authorization_state in ('none', 'authorized') then 'release_pending' else authorization_state end
  where id = p_payment_id;
  insert into private.confirmation_jobs (payment_id, action) values (p_payment_id, 'cancel')
  on conflict (payment_id) do update set action = 'cancel', available_at = now(), completed_at = null, lease = null, attempts = 0;
  perform private.kick_confirmations();
end $$;

-- ------------------------------------------------------------------------ starting a payment

create or replace function public.start_payment(p_offer_id uuid) returns public.payments
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); venue uuid; o public.offers; b public.businesses; p public.payments; pr public.profiles;
  k public.bookings; s public.services; hold_until timestamptz; constraint_name text;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  select business_id into venue from public.offers where id = p_offer_id;
  if venue is null then raise exception 'OFFER_UNAVAILABLE'; end if;
  if not private.manual_confirmation_for(venue) then return public.start_payment_legacy(p_offer_id); end if;

  select * into pr from public.profiles where id = u for update;
  if pr.id is null or pr.booking_blocked then raise exception 'BOOKING_BLOCKED'; end if;
  if pr.phone is null or length(regexp_replace(pr.phone, '[^0-9]', '', 'g')) < 9 then raise exception 'PHONE_REQUIRED'; end if;
  select biz.* into b from public.businesses biz join public.offers x on x.business_id = biz.id where x.id = p_offer_id for share of biz;
  select * into o from public.offers where id = p_offer_id for update;
  if o.id is null or b.status <> 'approved' then raise exception 'OFFER_UNAVAILABLE'; end if;

  select * into k from public.bookings
  where customer_id = u and offer_id = o.id and status in ('pending_payment', 'pending_merchant', 'capturing', 'confirmed');
  if k.id is not null then
    if k.status = 'pending_payment' and k.checkout_expires_at > now() then
      select * into p from public.payments where id = k.payment_id;
      return p;
    end if;
    raise exception 'ALREADY_BOOKED';
  end if;
  if (select count(*) from public.bookings where customer_id = u
      and status in ('pending_payment', 'pending_merchant', 'capturing', 'confirmed') and start_at_snapshot > now()) >= 3 then
    raise exception 'TOO_MANY_ACTIVE';
  end if;
  -- Holding seats without paying for them, again and again, blocks them for everyone else.
  if (select count(*) from public.bookings where customer_id = u and confirmation_version = 1 and confirmed_at is null
      and status in ('expired', 'cancelled_by_customer') and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'HOLD_RATE_LIMITED';
  end if;
  if coalesce(pr.no_show_override_until, '-infinity') < now()
     and (select count(*) from public.bookings where customer_id = u and status = 'no_show' and start_at_snapshot > now() - interval '60 days') >= 2 then
    raise exception 'BLOCKED_NO_SHOW';
  end if;
  if not public.offer_is_bookable(o.status, o.capacity_remaining, o.booking_cutoff_at, o.start_at)
     or private.confirmation_deadline(o.start_at, now()) is null then
    raise exception 'OFFER_UNAVAILABLE';
  end if;
  if b.stripe_account_id is null or not b.stripe_charges_enabled then raise exception 'PAYMENTS_NOT_READY'; end if;

  select * into s from public.services where id = o.service_id;
  insert into public.payments (customer_id, offer_id, amount_cents, provider, destination_account_id, application_fee_cents, confirmation_version)
  values (u, o.id, o.deal_price_cents, 'stripe', b.stripe_account_id, o.service_fee_cents, 1) returning * into p;
  update public.offers set capacity_remaining = capacity_remaining - 1, updated_at = now() where id = o.id;
  hold_until := least(now() + private.checkout_hold_interval(), o.start_at - interval '15 minutes', o.booking_cutoff_at);
  for i in 1..5 loop
    begin
      insert into public.bookings (offer_id, business_id, customer_id, reservation_code, price_cents, service_name_snapshot,
        business_name_snapshot, business_address_snapshot, start_at_snapshot, end_at_snapshot, original_price_cents_snapshot,
        payment_id, cancellation_window_minutes, merchant_payout_cents, service_fee_cents, fee_policy_version, status,
        confirmation_version, checkout_expires_at)
      values (o.id, b.id, u, 'FLEK-' || public.generate_reservation_code(6), o.deal_price_cents, s.name, b.display_name,
        b.address_line || ', ' || b.city, o.start_at, o.end_at, o.original_price_cents, p.id, b.cancellation_window_minutes,
        o.merchant_price_cents, o.service_fee_cents, o.fee_policy_version, 'pending_payment', 1, hold_until);
      return p;
    exception when unique_violation then
      get stacked diagnostics constraint_name = CONSTRAINT_NAME;
      if constraint_name = 'bookings_one_active_per_customer_offer' then raise exception 'ALREADY_BOOKED'; end if;
      if constraint_name <> 'bookings_reservation_code_key' then raise; end if;
    end;
  end loop;
  raise exception 'CODE_GENERATION_FAILED';
end $$;

-- ------------------------------------------------------------------------ Stripe authorised

drop function public.confirmation_authorized(uuid, text, text, integer, text, boolean);
/**
 * Stripe holds the amount. Returns what happened so the webhook knows what to do next:
 *   pending_merchant  the merchant's window opened
 *   already           an earlier delivery of the same news already did this
 *   released          the request can no longer be accepted; the authorisation is queued for release
 *   release_intent    a second authorisation for a payment that already has one; the webhook cancels it
 *   unknown_payment   not a confirmation-flow payment
 */
create function public.confirmation_authorized(p_payment_id uuid, p_intent text, p_session text, p_amount integer,
  p_currency text, p_livemode boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare kid uuid; k public.bookings; p public.payments; deadline timestamptz;
begin
  select id into kid from public.bookings where payment_id = p_payment_id and confirmation_version = 1;
  if kid is null then return 'unknown_payment'; end if;
  k := private.lock_confirmation(kid);
  select * into p from public.payments where id = p_payment_id;

  if p.payment_intent_id is not null and p.payment_intent_id <> p_intent then
    perform private.emit('authorization_released', jsonb_build_object('payment_id', p.id, 'booking_id', k.id, 'reason', 'DUPLICATE_INTENT'));
    return 'release_intent';
  end if;
  update public.payments set payment_intent_id = p_intent, livemode = coalesce(livemode, p_livemode) where id = p.id;

  -- Anything that does not match what FLEK asked Stripe for is released, never booked and never retried as an error.
  if p.amount_cents <> p_amount or lower(p_currency) <> 'czk'
     or (p.livemode is not null and p.livemode <> p_livemode)
     or (p.checkout_session_id is not null and p_session is not null and p.checkout_session_id <> p_session) then
    perform private.release_hold_locked(k, 'payment_failed', 'PAYMENT_MISMATCH', 'Platbu se nepodařilo ověřit.');
    perform private.queue_release(p.id, 'PAYMENT_MISMATCH');
    return 'released';
  end if;

  if k.status in ('pending_merchant', 'capturing', 'confirmed') then return 'already'; end if;

  deadline := private.confirmation_deadline(k.start_at_snapshot, now());
  if k.status <> 'pending_payment' or k.checkout_expires_at <= now() or deadline is null
     or not exists (select 1 from public.offers o join public.businesses b on b.id = o.business_id
                    where o.id = k.offer_id and o.status = 'published' and b.status = 'approved') then
    perform private.release_hold_locked(k, 'expired', 'CHECKOUT_TIMEOUT', 'Platba dorazila až po uplynutí času na zaplacení.');
    perform private.queue_release(p.id, 'CHECKOUT_TIMEOUT');
    return 'released';
  end if;

  update public.payments set authorization_state = 'authorized' where id = p.id;
  update public.bookings set status = 'pending_merchant', authorized_at = now(), confirmation_expires_at = deadline where id = k.id;
  perform private.emit('payment_authorized', jsonb_build_object('payment_id', p.id, 'booking_id', k.id, 'offer_id', k.offer_id,
    'business_id', k.business_id, 'amount_cents', p.amount_cents));
  perform private.emit('confirmation_requested', jsonb_build_object('booking_id', k.id, 'offer_id', k.offer_id,
    'business_id', k.business_id, 'window_seconds', floor(extract(epoch from deadline - now()))::integer,
    'minutes_to_start', floor(extract(epoch from k.start_at_snapshot - now()) / 60)::integer,
    'capacity_remaining', (select capacity_remaining from public.offers where id = k.offer_id),
    'capacity_total', (select capacity_total from public.offers where id = k.offer_id)));
  return 'pending_merchant';
end $$;

-- -------------------------------------------------------------------------- the decision

/**
 * The one place a request is accepted or refused, for the app and for WhatsApp alike. It takes the
 * same locks as the timeout and the customer's cancellation, so whichever commits first wins and
 * the others find the request already decided. A decision at or after the deadline expires it,
 * whether or not the expiry job has run yet.
 */
create or replace function private.decide_booking(p_booking_id uuid, p_accept boolean, p_actor uuid, p_channel text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.bookings; duration_ms bigint;
begin
  if p_channel not in ('app', 'whatsapp') then raise exception 'VALIDATION_ERROR'; end if;
  k := private.lock_confirmation(p_booking_id);
  if k.status <> 'pending_merchant' then
    return jsonb_build_object('status', k.status, 'decided', false, 'confirmation_expires_at', k.confirmation_expires_at);
  end if;
  duration_ms := (extract(epoch from now() - coalesce(k.authorized_at, k.created_at)) * 1000)::bigint;

  if k.confirmation_expires_at <= now() then
    perform private.release_hold_locked(k, 'expired', 'CONFIRMATION_TIMEOUT', 'Podnik nepotvrdil rezervaci včas.');
    perform private.emit('merchant_confirmation_expired', jsonb_build_object('booking_id', k.id, 'business_id', k.business_id,
      'confirmation_duration_ms', duration_ms, 'late_channel', p_channel));
    perform private.kick_confirmations();
    return jsonb_build_object('status', 'expired', 'decided', false, 'confirmation_expires_at', k.confirmation_expires_at);
  end if;

  update public.bookings set merchant_decided_at = now(), merchant_decided_by = p_actor, decision_channel = p_channel where id = k.id;
  k.merchant_decided_at := now();

  if not p_accept then
    perform private.release_hold_locked(k, 'rejected', 'MERCHANT_REJECTED', 'Podnik nemůže rezervaci přijmout.');
    perform private.emit('merchant_confirmation_rejected', jsonb_build_object('booking_id', k.id, 'business_id', k.business_id,
      'channel', p_channel, 'confirmation_duration_ms', duration_ms));
    perform private.kick_confirmations();
    return jsonb_build_object('status', 'rejected', 'decided', true, 'confirmation_expires_at', k.confirmation_expires_at);
  end if;

  if not exists (select 1 from public.offers o join public.businesses b on b.id = o.business_id
                 where o.id = k.offer_id and o.status = 'published' and b.status = 'approved' and b.stripe_charges_enabled) then
    perform private.release_hold_locked(k, 'rejected', 'BUSINESS_UNAVAILABLE', 'Podnik nyní nemůže rezervaci přijmout.');
    perform private.kick_confirmations();
    return jsonb_build_object('status', 'rejected', 'decided', true, 'confirmation_expires_at', k.confirmation_expires_at);
  end if;

  update public.bookings set status = 'capturing' where id = k.id;
  insert into private.confirmation_jobs (payment_id, action) values (k.payment_id, 'capture')
  on conflict (payment_id) do update set action = 'capture', available_at = now(), completed_at = null, lease = null, attempts = 0;
  perform private.emit('merchant_confirmation_accepted', jsonb_build_object('booking_id', k.id, 'business_id', k.business_id,
    'channel', p_channel, 'confirmation_duration_ms', duration_ms));
  perform private.emit('payment_capture_started', jsonb_build_object('booking_id', k.id, 'payment_id', k.payment_id));
  perform private.kick_confirmations();
  return jsonb_build_object('status', 'capturing', 'decided', true, 'confirmation_expires_at', k.confirmation_expires_at);
end $$;

drop function public.respond_to_booking(uuid, boolean);
create function public.respond_to_booking(p_booking_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare venue uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select business_id into venue from public.bookings where id = p_booking_id and confirmation_version = 1;
  if venue is null or not public.is_member_of(venue) then raise exception 'FORBIDDEN'; end if;
  return private.decide_booking(p_booking_id, p_accept, auth.uid(), 'app');
end $$;

create or replace function public.cancel_pending_booking(p_booking_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare k public.bookings;
begin
  select * into k from public.bookings where id = p_booking_id;
  if auth.uid() is null or k.customer_id is distinct from auth.uid() then raise exception 'FORBIDDEN'; end if;
  k := private.lock_confirmation(p_booking_id);
  if private.release_hold_locked(k, 'cancelled_by_customer', 'CUSTOMER_CANCELLED', 'Žádost zrušena zákazníkem.') then
    perform private.kick_confirmations();
  end if;
  return (select status::text from public.bookings where id = k.id);
end $$;

create or replace function public.expire_confirmation_requests() returns integer
language plpgsql security definer set search_path = '' as $$
declare x record; k public.bookings; n integer := 0;
begin
  for x in select id from public.bookings where confirmation_version = 1 and
      ((status = 'pending_payment' and checkout_expires_at <= now()) or (status = 'pending_merchant' and confirmation_expires_at <= now()))
    order by customer_id, offer_id limit 100 loop
    k := private.lock_confirmation(x.id);
    if k.status = 'pending_payment' and k.checkout_expires_at <= now() then
      if private.release_hold_locked(k, 'expired', 'CHECKOUT_TIMEOUT', 'Čas pro dokončení platby vypršel.') then n := n + 1; end if;
    elsif k.status = 'pending_merchant' and k.confirmation_expires_at <= now() then
      if private.release_hold_locked(k, 'expired', 'CONFIRMATION_TIMEOUT', 'Podnik nepotvrdil rezervaci včas.') then
        n := n + 1;
        perform private.emit('merchant_confirmation_expired', jsonb_build_object('booking_id', k.id, 'business_id', k.business_id,
          'confirmation_duration_ms', (extract(epoch from now() - k.authorized_at) * 1000)::bigint));
      end if;
    end if;
  end loop;
  return n;
end $$;

-- ----------------------------------------------------------------------- capture worker

drop function public.claim_confirmation_jobs();
create function public.claim_confirmation_jobs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.expire_confirmation_requests();
  with due as (
    select payment_id from private.confirmation_jobs
    where completed_at is null and available_at <= now() and attempts < 8
    order by available_at for update skip locked limit 20
  ), jobs as (
    update private.confirmation_jobs j set lease = gen_random_uuid(), attempts = j.attempts + 1, available_at = now() + interval '45 seconds'
    from due where j.payment_id = due.payment_id returning j.*
  )
  select coalesce(jsonb_agg(to_jsonb(j) || jsonb_build_object('intent', p.payment_intent_id, 'session', p.checkout_session_id,
    'amount', p.amount_cents, 'booking_id', k.id, 'booking_status', k.status, 'start_at', k.start_at_snapshot,
    'cancellation_requested', k.cancellation_requested,
    'cancellation_reason', case when k.status = 'cancelled_by_customer' then 'requested_by_customer' else 'abandoned' end,
    'server_now', now())), '[]'::jsonb)
  into result from jobs j join public.payments p on p.id = j.payment_id join public.bookings k on k.payment_id = p.id;
  return result;
end $$;

/** Capture may run from the merchant's yes until the appointment starts, never after a cancellation. */
create or replace function public.confirmation_job_ready(p_payment_id uuid, p_lease uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select exists (
    select 1 from private.confirmation_jobs j join public.bookings k on k.payment_id = j.payment_id
    where j.payment_id = p_payment_id and j.lease = p_lease and j.action = 'capture' and j.completed_at is null
      and k.status = 'capturing' and not k.cancellation_requested and k.start_at_snapshot > now())
$$;

/**
 * The merchant said yes and Stripe would not capture. The seat goes back, the authorisation is
 * released, both sides are told (through the status change) and the reason is kept.
 */
create or replace function public.confirmation_capture_failed(p_payment_id uuid, p_error text) returns text
language plpgsql security definer set search_path = '' as $$
declare kid uuid; k public.bookings;
begin
  select id into kid from public.bookings where payment_id = p_payment_id and confirmation_version = 1;
  if kid is null then return 'unknown_payment'; end if;
  k := private.lock_confirmation(kid);
  if k.status <> 'capturing' then return k.status::text; end if;
  update public.bookings
  set status = 'payment_failed', cancelled_at = now(), capacity_released_at = coalesce(capacity_released_at, now()),
      cancellation_reason = 'Podnik potvrdil, ale platbu se nepodařilo dokončit. Blokaci na kartě uvolňujeme.'
  where id = k.id;
  if k.capacity_released_at is null then
    update public.offers set capacity_remaining = least(capacity_remaining + 1, capacity_total), updated_at = now() where id = k.offer_id;
  end if;
  perform private.queue_release(p_payment_id, 'CAPTURE_FAILED');
  update public.payments set failure_reason = 'CAPTURE_FAILED' where id = p_payment_id;
  perform private.emit('payment_capture_failed', jsonb_build_object('booking_id', k.id, 'payment_id', p_payment_id,
    'business_id', k.business_id, 'error', left(coalesce(p_error, ''), 120)));
  return 'payment_failed';
end $$;

create or replace function public.confirmation_payment_observed(p_payment_id uuid, p_outcome text, p_intent text, p_amount integer default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare kid uuid; k public.bookings; p public.payments;
begin
  if p_outcome not in ('captured', 'released') then raise exception 'INVALID_OUTCOME'; end if;
  select id into kid from public.bookings where payment_id = p_payment_id and confirmation_version = 1;
  if kid is null then return; end if;
  k := private.lock_confirmation(kid);
  select * into p from public.payments where id = p_payment_id;
  -- News about some other PaymentIntent is not news about this payment.
  if p_intent is not null and p.payment_intent_id is not null and p.payment_intent_id <> p_intent then return; end if;

  if p_outcome = 'captured' then
    if p.status in ('paid', 'refunded') then return; end if;
    update public.payments set status = 'paid', paid_at = now(), authorization_state = 'captured',
      payment_intent_id = coalesce(payment_intent_id, p_intent), provider_reference = coalesce(provider_reference, p_intent)
    where id = p.id;
    if k.status = 'capturing' and not k.cancellation_requested and p_amount = p.amount_cents then
      update public.bookings set status = 'confirmed', confirmed_at = now() where id = k.id;
      perform private.emit('payment_capture_succeeded', jsonb_build_object('booking_id', k.id, 'payment_id', p.id,
        'business_id', k.business_id, 'capture_duration_ms', (extract(epoch from now() - coalesce(k.merchant_decided_at, now())) * 1000)::bigint));
      perform private.emit('booking_created', jsonb_build_object('booking_id', k.id, 'offer_id', k.offer_id,
        'business_id', k.business_id, 'provider', 'stripe', 'confirmation', true));
    else
      -- Captured money with nothing agreed behind it (a late or wrong capture) goes straight back through the refund queue.
      update public.payments set refund_requested_at = coalesce(refund_requested_at, now()),
        failure_reason = case when p_amount <> p.amount_cents then 'AMOUNT_MISMATCH' else 'LATE_CAPTURE' end
      where id = p.id;
      if k.capacity_released_at is null then
        update public.offers set capacity_remaining = least(capacity_remaining + 1, capacity_total), updated_at = now() where id = k.offer_id;
      end if;
      if k.status in ('pending_payment', 'pending_merchant', 'capturing') then
        -- An offer cancelled while its capture was running is the merchant's cancellation, not a payment failure.
        update public.bookings
        set status = case when k.cancellation_requested then 'cancelled_by_merchant'::public.booking_status else 'payment_failed'::public.booking_status end,
          cancelled_at = now(), capacity_released_at = coalesce(capacity_released_at, now()),
          cancellation_reason = coalesce(case when k.cancellation_requested then k.cancellation_reason end, 'Rezervaci nelze dokončit. Platbu vracíme.')
        where id = k.id;
      else
        update public.bookings set capacity_released_at = coalesce(capacity_released_at, now()) where id = k.id;
      end if;
      perform private.kick_refunds();
    end if;
    return;
  end if;

  -- released
  if p.status in ('paid', 'refunded') or k.status = 'confirmed' then return; end if;
  if k.status in ('pending_payment', 'pending_merchant') then
    perform private.release_hold_locked(k, 'payment_failed', 'AUTHORIZATION_FAILED', 'Blokaci platby se nepodařilo dokončit.');
  elsif k.status = 'capturing' then
    if k.capacity_released_at is null then
      update public.offers set capacity_remaining = least(capacity_remaining + 1, capacity_total), updated_at = now() where id = k.offer_id;
    end if;
    update public.bookings set status = 'payment_failed', capacity_released_at = coalesce(capacity_released_at, now()), cancelled_at = now(),
      cancellation_reason = 'Podnik potvrdil, ale platbu se nepodařilo dokončit. Blokaci na kartě uvolňujeme.'
    where id = k.id;
    perform private.emit('payment_capture_failed', jsonb_build_object('booking_id', k.id, 'payment_id', p.id, 'error', 'PAYMENT_INTENT_CANCELED'));
  end if;
  update public.payments set status = 'failed', authorization_state = 'released',
    payment_intent_id = coalesce(payment_intent_id, p_intent)
  where id = p.id and status = 'pending';
  update private.confirmation_jobs set completed_at = coalesce(completed_at, now()), lease = null
  where payment_id = p.id and action = 'cancel';
end $$;

-- ------------------------------------------------------------------------- read models

/** A rough, non-binding figure for the booking sheet; the real window is fixed at authorisation. */
create or replace function public.confirmation_quote(p_offer_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'manual', private.manual_confirmation_for(o.business_id),
    'window_seconds', case when private.manual_confirmation_for(o.business_id)
      then floor(extract(epoch from private.confirmation_deadline(o.start_at, now()) - now()))::integer end,
    'hold_seconds', floor(extract(epoch from private.checkout_hold_interval()))::integer,
    'server_now', now())
  from public.offers o where o.id = p_offer_id
$$;

create or replace function public.my_payment_state(p_payment_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.payments; k public.bookings;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into p from public.payments where id = p_payment_id and customer_id = auth.uid();
  if p.id is null then raise exception 'NOT_FOUND'; end if;
  select * into k from public.bookings where payment_id = p.id;
  return jsonb_build_object('id', p.id, 'offer_id', p.offer_id, 'provider', p.provider, 'status', p.status,
    'amount_cents', p.amount_cents, 'refund_requested', p.refund_requested_at is not null, 'refund_status', p.refund_status,
    'failure_reason', p.failure_reason, 'booking_id', k.id,
    'reservation_code', case when private.booking_was_agreed(k.status, k.confirmation_version, k.confirmed_at) then k.reservation_code end,
    'confirmation_version', p.confirmation_version, 'booking_status', k.status,
    'confirmation_expires_at', k.confirmation_expires_at, 'checkout_expires_at', k.checkout_expires_at,
    'authorized_at', k.authorized_at, 'merchant_decided_at', k.merchant_decided_at, 'confirmed_at', k.confirmed_at,
    'start_at', k.start_at_snapshot, 'cancellation_reason', k.cancellation_reason,
    'authorization_state', p.authorization_state, 'server_now', now());
end $$;

-- Never-agreed requests keep their code to themselves; the new facts ride along at the end.
create or replace view public.customer_booking_details with (security_invoker = true) as
  select k.id, k.offer_id, k.business_id, k.customer_id,
    case when private.booking_was_agreed(k.status, k.confirmation_version, k.confirmed_at) then k.reservation_code end as reservation_code,
    k.price_cents, k.service_name_snapshot, k.business_name_snapshot, k.business_address_snapshot, k.start_at_snapshot,
    k.end_at_snapshot, k.original_price_cents_snapshot, k.status, k.created_at, k.cancelled_at, k.resolved_at,
    k.cancellation_reason, k.rating, k.rated_at, k.payment_id, k.cancellation_window_minutes, b.phone as business_phone,
    k.status = 'confirmed' and (now() < k.start_at_snapshot - make_interval(mins => k.cancellation_window_minutes)
      or now() < coalesce(k.confirmed_at, k.created_at) + interval '10 minutes') as can_cancel,
    greatest(k.start_at_snapshot - make_interval(mins => k.cancellation_window_minutes),
      coalesce(k.confirmed_at, k.created_at) + interval '10 minutes') as cancellation_deadline,
    now() as server_now,
    (select pay.status from public.payments pay where pay.id = k.payment_id) as payment_status,
    k.confirmation_version, k.checkout_expires_at, k.confirmation_expires_at, k.authorized_at, k.confirmed_at,
    k.merchant_decided_at,
    (select pay.authorization_state from public.payments pay where pay.id = k.payment_id) as authorization_state
  from public.bookings k join public.businesses b on b.id = k.business_id;

create or replace view public.merchant_booking_rows with (security_invoker = true) as
  select k.id, k.offer_id, k.business_id, k.customer_id,
    case when private.booking_was_agreed(k.status, k.confirmation_version, k.confirmed_at) then k.reservation_code end as reservation_code,
    k.price_cents, k.service_name_snapshot, k.business_name_snapshot, k.business_address_snapshot, k.start_at_snapshot,
    k.end_at_snapshot, k.original_price_cents_snapshot, k.status, k.created_at, k.cancelled_at, k.resolved_at,
    k.cancellation_reason, k.rating, k.rated_at, k.payment_id,
    trim(p.first_name || ' ' || case when p.last_name <> '' then left(p.last_name, 1) || '.' else '' end) as customer_label,
    k.status = 'confirmed' and now() >= k.start_at_snapshot and now() < k.end_at_snapshot + interval '24 hours' as can_resolve,
    k.status = 'confirmed' and now() >= k.end_at_snapshot + interval '24 hours' as unresolved,
    now() as server_now,
    (select pay.status from public.payments pay where pay.id = k.payment_id) as payment_status,
    k.merchant_payout_cents, k.service_fee_cents, k.fee_policy_version,
    k.end_at_snapshot + interval '24 hours' as resolution_deadline,
    k.confirmation_version, k.confirmation_expires_at, k.authorized_at, k.confirmed_at, k.merchant_decided_at, k.decision_channel,
    (select pay.authorization_state from public.payments pay where pay.id = k.payment_id) as authorization_state
  from public.bookings k join public.profiles p on p.id = k.customer_id;

create or replace function public.merchant_lookup_booking(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.merchant_booking_detail(k.id) from public.bookings k
  where k.reservation_code = upper(trim(p_code)) and public.is_member_of(k.business_id)
    and private.booking_was_agreed(k.status, k.confirmation_version, k.confirmed_at);
$$;

create or replace view public.merchant_offer_rows with (security_invoker = true) as
  select o.id, o.business_id, o.service_id, o.start_at, o.end_at, o.original_price_cents, o.deal_price_cents,
    o.capacity_total, o.capacity_remaining, o.booking_cutoff_at, o.status, o.cancelled_at, o.cancellation_reason,
    o.published_at, o.created_at, o.updated_at, s.name as service_name, s.duration_minutes,
    (select count(*) from public.bookings k where k.offer_id = o.id and k.status = 'confirmed') as booked,
    (select count(*) from public.bookings k where k.offer_id = o.id and k.status = 'completed') as completed,
    public.offer_is_bookable(o.status, o.capacity_remaining, o.booking_cutoff_at, o.start_at) as bookable,
    now() as server_now, o.merchant_price_cents, o.service_fee_cents, o.fee_policy_version,
    exists (select 1 from public.bookings k where k.offer_id = o.id
            and private.booking_was_agreed(k.status, k.confirmation_version, k.confirmed_at)) as has_bookings,
    (select count(*) from public.bookings k where k.offer_id = o.id and k.status in ('pending_merchant', 'capturing')) as pending_requests
  from public.offers o join public.services s on s.id = o.service_id;

-- ------------------------------------------------------------------------ offers and venues

create or replace function public.update_offer(p_offer_id uuid, p_data jsonb, p_confirm_overlap boolean default false)
returns public.offers language plpgsql security definer set search_path = public as $$
declare o public.offers; s public.services; cap integer; st timestamptz; cutoff timestamptz; merchant integer; fee integer; policy smallint;
begin
  select * into o from public.offers where id = p_offer_id;
  if o.id is null or not public.is_member_of(o.business_id) then raise exception 'FORBIDDEN'; end if;
  if p_data ? 'deal_price_cents' or p_data ? 'service_fee_cents' then raise exception 'VALIDATION_ERROR'; end if;
  perform 1 from public.businesses where id = o.business_id for update;
  select * into o from public.offers where id = p_offer_id for update;
  if o.status <> 'published' or o.start_at <= now() then raise exception 'OFFER_UNAVAILABLE'; end if;
  -- A customer is on Stripe's page or waiting for the merchant: nothing they agreed to may move, and no held seat may be handed out again.
  if exists (select 1 from public.bookings where offer_id = o.id and status in ('pending_payment', 'pending_merchant', 'capturing')) then
    raise exception 'OFFER_HAS_PENDING_BOOKINGS';
  end if;
  cap := coalesce((p_data->>'capacity_total')::int, o.capacity_total);
  if cap not between 1 and 50 then raise exception 'INVALID_CAPACITY'; end if;
  if exists (select 1 from public.bookings k where k.offer_id = o.id and private.booking_was_agreed(k.status, k.confirmation_version, k.confirmed_at)) then
    if p_data - 'capacity_total' <> '{}'::jsonb then raise exception 'OFFER_HAS_BOOKINGS'; end if;
    if cap < o.capacity_total then raise exception 'INVALID_CAPACITY'; end if;
    update public.offers set capacity_total = cap, capacity_remaining = capacity_remaining + cap - o.capacity_total, updated_at = now()
    where id = o.id returning * into o;
  else
    select * into s from public.services where id = coalesce((p_data->>'service_id')::uuid, o.service_id) and business_id = o.business_id and is_active;
    if not found then raise exception 'FORBIDDEN'; end if;
    st := coalesce((p_data->>'start_at')::timestamptz, o.start_at);
    merchant := coalesce((p_data->>'merchant_price_cents')::int, o.merchant_price_cents);
    cutoff := coalesce((p_data->>'booking_cutoff_at')::timestamptz, case when p_data ? 'start_at' then st - interval '15 minutes' else o.booking_cutoff_at end);
    if p_data ? 'merchant_price_cents' or o.fee_policy_version > 0 then
      fee := private.validate_flek(st, cutoff, merchant, s.normal_price_cents); policy := private.flek_current_fee_policy();
    else
      perform private.validate_offer(st, cutoff, o.deal_price_cents, s.normal_price_cents); fee := 0; policy := 0;
    end if;
    if not p_confirm_overlap and exists (select 1 from public.offers where id <> o.id and business_id = o.business_id and status = 'published'
        and start_at < st + make_interval(mins => s.duration_minutes) and end_at > st) then
      raise exception 'OVERLAP_CONFIRMATION_REQUIRED';
    end if;
    update public.offers set service_id = s.id, start_at = st, end_at = st + make_interval(mins => s.duration_minutes),
      merchant_price_cents = merchant, service_fee_cents = fee, fee_policy_version = policy, deal_price_cents = merchant + fee,
      original_price_cents = s.normal_price_cents, capacity_total = cap, capacity_remaining = cap, booking_cutoff_at = cutoff, updated_at = now()
    where id = o.id returning * into o;
  end if;
  return o;
end $$;

create or replace function public.merchant_cancel_offer(p_offer_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.offers; k public.bookings; c record;
begin
  select * into o from public.offers where id = p_offer_id;
  if o.id is null or not (public.is_member_of(o.business_id) or public.is_admin()) then raise exception 'FORBIDDEN'; end if;
  if length(trim(p_reason)) < 3 then raise exception 'VALIDATION_ERROR'; end if;
  for c in select distinct customer_id from public.bookings
    where offer_id = p_offer_id and status in ('pending_payment', 'pending_merchant', 'capturing', 'confirmed') order by customer_id loop
    perform 1 from public.profiles where id = c.customer_id for update;
  end loop;
  perform 1 from public.businesses where id = o.business_id for share;
  select * into o from public.offers where id = p_offer_id for update;
  if now() > o.start_at then raise exception 'OFFER_STARTED'; end if;
  if o.status = 'cancelled' then return; end if;
  update public.offers set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason, updated_at = now() where id = o.id;
  for c in select id from public.bookings
    where offer_id = o.id and status in ('pending_payment', 'pending_merchant', 'capturing', 'confirmed') order by customer_id loop
    perform 1 from public.payments where id = (select payment_id from public.bookings where id = c.id) for update;
    select * into k from public.bookings where id = c.id for update;
    if k.status = 'confirmed' then
      perform private.refund_for_booking(k.id);
      update public.bookings set status = 'cancelled_by_merchant', cancelled_at = now(), cancellation_reason = p_reason where id = k.id;
    elsif k.status = 'capturing' then
      update public.bookings set cancellation_requested = true, cancellation_reason = p_reason where id = k.id;
      perform private.queue_release(k.payment_id, 'OFFER_CANCELLED');
    else
      perform private.release_hold_locked(k, 'cancelled_by_merchant', 'OFFER_CANCELLED', p_reason);
    end if;
  end loop;
  perform private.kick_confirmations();
  perform private.emit('offer_cancelled', jsonb_build_object('offer_id', o.id, 'business_id', o.business_id, 'reason', p_reason));
end $$;

/*
 * Suspending or rejecting a venue also ends its pending requests. The business row is locked
 * first and nothing here locks a customer's profile, so it cannot deadlock against a customer who
 * is starting a payment at the same moment: that customer waits for the business lock instead.
 */
create or replace function public.admin_set_business_status(p_business_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record; k record; hold public.bookings; previous public.business_status; previous_reason text;
  offers_cancelled integer := 0; bookings_refunded integer := 0; requests_released integer := 0;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('pending','approved','rejected','suspended') then raise exception 'VALIDATION_ERROR'; end if;
  if p_status in ('rejected','suspended') and coalesce(length(trim(p_reason)),0) < 3 then raise exception 'VALIDATION_ERROR'; end if;
  select status, status_reason into previous, previous_reason from public.businesses where id = p_business_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.businesses set status = p_status::public.business_status, status_reason = p_reason, updated_at = now() where id = p_business_id;
  if p_status = 'approved' and previous is distinct from 'approved' then
    perform private.emit('business_approved', jsonb_build_object('business_id', p_business_id));
  end if;
  if p_status <> 'approved' then
    for o in select id from public.offers where business_id = p_business_id and start_at > now() and status = 'published' order by id for update loop
      update public.offers set status = 'cancelled', cancelled_at = now(), cancellation_reason = coalesce(p_reason, 'Provozovna není dostupná.'), updated_at = now() where id = o.id;
      offers_cancelled := offers_cancelled + 1;
      for k in select id from public.bookings where offer_id = o.id and status = 'confirmed' for update loop
        update public.bookings set status = 'cancelled_by_merchant', cancelled_at = now(), cancellation_reason = coalesce(p_reason, 'Provozovna není dostupná.') where id = k.id;
        perform private.refund_for_booking(k.id);
        bookings_refunded := bookings_refunded + 1;
      end loop;
      for hold in select * from public.bookings where offer_id = o.id and status in ('pending_payment', 'pending_merchant', 'capturing') order by id for update loop
        if hold.status = 'capturing' then
          update public.bookings set cancellation_requested = true, cancellation_reason = coalesce(p_reason, 'Provozovna není dostupná.') where id = hold.id;
          perform private.queue_release(hold.payment_id, 'BUSINESS_UNAVAILABLE');
        elsif private.release_hold_locked(hold, 'cancelled_by_merchant', 'BUSINESS_UNAVAILABLE', coalesce(p_reason, 'Provozovna není dostupná.')) then
          requests_released := requests_released + 1;
        end if;
      end loop;
      perform private.emit('offer_cancelled', jsonb_build_object('offer_id', o.id, 'business_id', p_business_id));
    end loop;
    perform private.kick_confirmations();
  end if;
  perform private.audit('business_status_changed', 'business', p_business_id,
    jsonb_build_object('status', previous, 'status_reason', previous_reason),
    jsonb_build_object('status', p_status, 'status_reason', p_reason,
      'offers_cancelled', offers_cancelled, 'bookings_refunded', bookings_refunded, 'requests_released', requests_released),
    p_reason);
end $$;

create or replace function private.flek_stripe_maintenance() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payments set refund_requested_at = now(), failure_reason = coalesce(failure_reason, 'NO_BOOKING')
  where provider = 'stripe' and status = 'paid' and refund_requested_at is null
    and paid_at < now() - interval '60 minutes'
    and not exists (select 1 from public.bookings b where b.payment_id = payments.id);
  -- An authorisation still being released or captured is not an abandoned attempt.
  update public.payments set status = 'failed', failure_reason = coalesce(failure_reason, 'ABANDONED')
  where provider = 'stripe' and status = 'pending' and created_at < now() - interval '2 hours'
    and not (confirmation_version = 1 and authorization_state in ('authorized', 'release_pending'));
  perform private.kick_refunds();
end $$;

-- ------------------------------------------------------------------- inventory revision

-- A sequence moves without taking a row lock, so capacity changes no longer queue behind each other.
drop trigger if exists inventory_changed on public.offers;
drop function if exists public.inventory_version();
drop function if exists private.inventory_changed();
drop table if exists private.inventory_revision;
create sequence private.inventory_revision_seq;
revoke all on sequence private.inventory_revision_seq from public, anon, authenticated;
create function private.inventory_changed() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform nextval('private.inventory_revision_seq'); return null; end $$;
create trigger inventory_changed after insert or update of capacity_remaining, status on public.offers
  for each statement execute function private.inventory_changed();
create function public.inventory_version() returns bigint language sql stable security definer set search_path = '' as $$
  select last_value from private.inventory_revision_seq
$$;

-- --------------------------------------------------------------------------- notifications

create or replace function private.booking_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare recipient record; nid uuid; kind text; heading text; detail text; scope_key text;
begin
  if TG_OP = 'UPDATE' and new.status = old.status then return new; end if;
  -- A seat held for a Checkout that was never paid concerns nobody but the database.
  if new.confirmation_version = 1 and new.authorized_at is null then return new; end if;
  kind := case
    when new.status = 'pending_merchant' then 'requested'
    when new.status = 'confirmed' then 'confirmed'
    when new.status in ('cancelled_by_customer', 'cancelled_by_merchant', 'expired', 'rejected', 'payment_failed') then 'cancelled'
  end;
  if kind is null then return new; end if;
  for recipient in
    select user_id as uid, new.business_id as bid from public.business_members where business_id = new.business_id
    union all
    -- The customer hears about their own request's outcome, not about cancelling it themselves.
    select new.customer_id, null::uuid
    where kind <> 'requested' and not (new.confirmation_version = 1 and new.confirmed_at is null and new.status = 'cancelled_by_customer')
  loop
    scope_key := coalesce(recipient.bid::text, 'customer');
    heading := case
      when kind = 'requested' then 'Nová rezervace čeká na potvrzení'
      when kind = 'confirmed' and recipient.bid is null then 'Tvůj FLEK je potvrzený'
      when kind = 'confirmed' then 'Rezervace je potvrzená'
      when new.status = 'rejected' and recipient.bid is null then 'Podnik rezervaci nepotvrdil'
      when new.status = 'rejected' then 'Žádost o rezervaci byla odmítnuta'
      when new.status = 'expired' and recipient.bid is null then 'Čas na potvrzení vypršel'
      when new.status = 'expired' then 'Žádost o rezervaci vypršela'
      when new.status = 'payment_failed' and recipient.bid is null then 'Platbu se nepodařilo dokončit'
      when new.status = 'payment_failed' then 'Rezervaci se nepodařilo dokončit'
      when new.status = 'cancelled_by_customer' and new.confirmed_at is null and new.confirmation_version = 1 then 'Zákazník žádost zrušil'
      else 'Rezervace byla zrušena'
    end;
    detail := new.service_name_snapshot || ' · ' || to_char(new.start_at_snapshot at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI')
      || ' · 1 místo · ' || new.business_name_snapshot
      || case when kind = 'requested' then ' · potvrďte do ' || to_char(new.confirmation_expires_at at time zone 'Europe/Prague', 'HH24:MI') else '' end;
    nid := null;
    insert into public.notifications (user_id, booking_id, business_id, event, title, body, href)
    values (recipient.uid, new.id, recipient.bid, kind, heading, detail, case when recipient.bid is null then '/rezervace' else '/partner/rezervace' end)
    on conflict do nothing returning id into nid;
    if nid is null then continue; end if;
    insert into private.notification_delivery (notification_id, channel, target)
    select nid, 'email', u.email from auth.users u
    where u.id = recipient.uid and u.email_confirmed_at is not null and u.email not like '%@flek.test'
      and coalesce((select email from public.notification_preferences where user_id = recipient.uid and scope = scope_key and event = kind), true);
    insert into private.notification_delivery (notification_id, channel, target)
    select nid, 'push', s.id::text from private.push_subscriptions s
    where s.user_id = recipient.uid
      and coalesce((select push from public.notification_preferences where user_id = recipient.uid and scope = scope_key and event = kind), false);
  end loop;
  perform private.kick_notification_delivery();
  return new;
end $$;

-- ------------------------------------------------------------------------------- grants

revoke all on function private.manual_confirmation_for(uuid), private.checkout_hold_interval(),
  private.booking_was_agreed(public.booking_status, integer, timestamptz),
  private.release_hold_locked(public.bookings, public.booking_status, text, text),
  private.release_hold(uuid, public.booking_status, text, text), private.queue_release(uuid, text),
  private.decide_booking(uuid, boolean, uuid, text), private.inventory_changed(), private.booking_notification()
  from public, anon, authenticated;

revoke all on function public.respond_to_booking(uuid, boolean) from public, anon;
grant execute on function public.respond_to_booking(uuid, boolean) to authenticated;

revoke all on function public.confirmation_authorized(uuid, text, text, integer, text, boolean), public.claim_confirmation_jobs(),
  public.confirmation_capture_failed(uuid, text), public.confirmation_payment_observed(uuid, text, text, integer),
  public.confirmation_job_ready(uuid, uuid), public.expire_confirmation_requests()
  from public, anon, authenticated;
grant execute on function public.confirmation_authorized(uuid, text, text, integer, text, boolean), public.claim_confirmation_jobs(),
  public.confirmation_capture_failed(uuid, text), public.confirmation_payment_observed(uuid, text, text, integer),
  public.confirmation_job_ready(uuid, uuid), public.expire_confirmation_requests()
  to service_role;

revoke all on function public.confirmation_quote(uuid), public.inventory_version() from public;
grant execute on function public.confirmation_quote(uuid), public.inventory_version() to anon, authenticated, service_role;

revoke all on function public.start_payment(uuid), public.cancel_pending_booking(uuid), public.my_payment_state(uuid) from public, anon;
grant execute on function public.start_payment(uuid), public.cancel_pending_booking(uuid), public.my_payment_state(uuid) to authenticated;

revoke all on public.customer_booking_details, public.merchant_booking_rows, public.merchant_offer_rows from anon, authenticated;

-- Correctness does not depend on this job (a decision checks the deadline itself); it only returns seats promptly.
select cron.schedule('flek-confirmation-expiry', '30 seconds', $$select public.expire_confirmation_requests(); select private.kick_confirmations();$$);
