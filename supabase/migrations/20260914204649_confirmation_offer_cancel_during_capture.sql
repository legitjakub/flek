/*
 * An offer cancelled (or a venue suspended) while its capture was already running used to end as
 * `payment_failed` with "Podnik potvrdil, ale platbu se nepodařilo dokončit": true about the money,
 * wrong about the reason. When the release of such an authorisation comes back, or the capture is
 * given up, the booking now ends as the merchant's cancellation with the merchant's reason.
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
  set status = case when k.cancellation_requested then 'cancelled_by_merchant'::public.booking_status else 'payment_failed'::public.booking_status end,
      cancelled_at = now(), capacity_released_at = coalesce(capacity_released_at, now()),
      cancellation_reason = case when k.cancellation_requested then coalesce(k.cancellation_reason, 'Podnik rezervaci zrušil.')
        else 'Podnik potvrdil, ale platbu se nepodařilo dokončit. Blokaci na kartě uvolňujeme.' end
  where id = k.id;
  if k.capacity_released_at is null then
    update public.offers set capacity_remaining = least(capacity_remaining + 1, capacity_total), updated_at = now() where id = k.offer_id;
  end if;
  perform private.queue_release(p_payment_id, case when k.cancellation_requested then 'OFFER_CANCELLED' else 'CAPTURE_FAILED' end);
  update public.payments set failure_reason = case when k.cancellation_requested then 'OFFER_CANCELLED' else 'CAPTURE_FAILED' end
  where id = p_payment_id;
  if not k.cancellation_requested then
    perform private.emit('payment_capture_failed', jsonb_build_object('booking_id', k.id, 'payment_id', p_payment_id,
      'business_id', k.business_id, 'error', left(coalesce(p_error, ''), 120)));
  end if;
  return (select status::text from public.bookings where id = k.id);
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
    update public.bookings
    set status = case when k.cancellation_requested then 'cancelled_by_merchant'::public.booking_status else 'payment_failed'::public.booking_status end,
      capacity_released_at = coalesce(capacity_released_at, now()), cancelled_at = now(),
      cancellation_reason = case when k.cancellation_requested then coalesce(k.cancellation_reason, 'Podnik rezervaci zrušil.')
        else 'Podnik potvrdil, ale platbu se nepodařilo dokončit. Blokaci na kartě uvolňujeme.' end
    where id = k.id;
    if not k.cancellation_requested then
      perform private.emit('payment_capture_failed', jsonb_build_object('booking_id', k.id, 'payment_id', p.id, 'error', 'PAYMENT_INTENT_CANCELED'));
    end if;
  end if;
  update public.payments set status = 'failed', authorization_state = 'released',
    payment_intent_id = coalesce(payment_intent_id, p_intent)
  where id = p.id and status = 'pending';
  update private.confirmation_jobs set completed_at = coalesce(completed_at, now()), lease = null
  where payment_id = p.id and action = 'cancel';
end $$;

revoke all on function public.confirmation_capture_failed(uuid, text), public.confirmation_payment_observed(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.confirmation_capture_failed(uuid, text), public.confirmation_payment_observed(uuid, text, text, integer)
  to service_role;
