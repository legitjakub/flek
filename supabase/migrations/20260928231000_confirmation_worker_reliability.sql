/*
 * Worker potvrzování bez tichých konců (audit 28. 9., nálezy M1–M3).
 *
 * M1: `confirmation_job_ready` říkal jen ano/ne. Když úlohu mezitím převzal jiný běh (lease 45 s) nebo
 *     selhalo spojení s databází, worker to bral jako „termín už začal“ a přijatou rezervaci ukončil
 *     jako nezaplacenou. `confirmation_job_state` teď řekne proč, a worker úlohu cizího běhu jen přeskočí.
 * M2: Žádost, kterou zákazník nezaplatil, zůstávala navždy `release_pending` a platba `pending`, takže
 *     karta ukazovala „Uvolňujeme blokaci“ a stránka se dotazovala každé tři sekundy. Bez autorizace
 *     není co uvolnit: worker to po zavření Checkoutu zapíše jako uvolněné, `stripe_checkout_expired`
 *     taky, a údržba dorovná, co zůstalo (i starší řádky). Pozdní autorizace vrátí stav na `release_pending`.
 * M3: Po osmi pokusech se úloha už nikdy nespustila. Uvolnění blokace je vždy bezpečné, proto se zkouší
 *     dál s rostoucím odstupem (nejvýš hodina). Stržení, které nedoběhlo do začátku termínu nebo
 *     vyčerpalo pokusy, databáze ukončí sama a blokaci uvolní; peníze se tím nikdy nestrhnou dvakrát.
 */

-- ------------------------------------------------------------------------------------------- M1

/** Why a capture job may or may not run now, for the worker holding `p_lease`. */
create function public.confirmation_job_state(p_payment_id uuid, p_lease uuid) returns text
language sql volatile security definer set search_path = '' as $$
  select case
    when j.payment_id is null then 'missing'
    when j.lease is distinct from p_lease then 'lease_lost'
    when j.completed_at is not null then 'done'
    when j.action <> 'capture' or k.cancellation_requested then 'cancel_requested'
    when k.status is distinct from 'capturing' then 'not_capturing'
    when k.start_at_snapshot <= now() then 'started'
    else 'ready' end
  from (select 1) one
  left join private.confirmation_jobs j on j.payment_id = p_payment_id
  left join public.bookings k on k.payment_id = p_payment_id and k.confirmation_version = 1
$$;

-- ------------------------------------------------------------------------------------------- M3

create or replace function public.claim_confirmation_jobs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.expire_confirmation_requests();
  with due as (
    select payment_id from private.confirmation_jobs
    -- A release is always safe to try again; a capture gives up after eight claims.
    where completed_at is null and available_at <= now() and (action = 'cancel' or attempts < 8)
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

create or replace function public.finish_confirmation_job(p_payment_id uuid, p_lease uuid, p_done boolean, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update private.confirmation_jobs
  set completed_at = case when p_done then now() end, lease = null, last_error = left(p_error, 200),
      -- After eight tries a release waits longer each time, up to an hour, instead of stopping.
      available_at = now() + case when p_done or attempts < 8 then interval '20 seconds'
                                  else least(interval '1 hour', interval '1 minute' * power(2, least(attempts - 8, 6))) end
  where payment_id = p_payment_id and lease = p_lease
$$;

-- The timeout sweep also ends a capture that cannot finish: the appointment has started, or the job ran out.
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
  -- Five minutes after the start nothing can still be capturing; neither can a capture whose job gave up.
  for x in select b.payment_id, b.start_at_snapshot <= now() - interval '5 minutes' as started
      from public.bookings b left join private.confirmation_jobs j on j.payment_id = b.payment_id
      where b.confirmation_version = 1 and b.status = 'capturing'
        and (b.start_at_snapshot <= now() - interval '5 minutes'
             or (j.action = 'capture' and j.completed_at is null and j.attempts >= 8 and j.lease is null))
      order by b.customer_id, b.offer_id limit 50 loop
    perform public.confirmation_capture_failed(x.payment_id, case when x.started then 'CAPTURE_TOO_LATE' else 'CAPTURE_ATTEMPTS_EXHAUSTED' end);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------------------------------------- M2

-- A late authorisation after FLEK let the request go must show as being released again.
create or replace function private.queue_release(p_payment_id uuid, p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.payments
  set failure_reason = coalesce(failure_reason, left(p_code, 200)),
      authorization_state = case when authorization_state in ('none', 'authorized', 'released') then 'release_pending' else authorization_state end
  where id = p_payment_id;
  insert into private.confirmation_jobs (payment_id, action) values (p_payment_id, 'cancel')
  on conflict (payment_id) do update set action = 'cancel', available_at = now(), completed_at = null, lease = null, attempts = 0;
  perform private.kick_confirmations();
end $$;

-- Stripe closed a Checkout nobody paid: with no PaymentIntent there is no hold left to release.
create or replace function public.stripe_checkout_expired(p_payment_id uuid, p_session text) returns void
language sql security definer set search_path = public as $$
  update public.payments
  set status = 'failed', failure_reason = coalesce(failure_reason, 'CHECKOUT_EXPIRED'),
      authorization_state = case when payment_intent_id is null and authorization_state = 'release_pending' then 'released' else authorization_state end
  where id = p_payment_id and provider = 'stripe' and status = 'pending' and checkout_session_id = p_session;
$$;

create or replace function private.flek_stripe_maintenance() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payments set refund_requested_at = now(), failure_reason = coalesce(failure_reason, 'NO_BOOKING')
  where provider = 'stripe' and status = 'paid' and refund_requested_at is null
    and paid_at < now() - interval '60 minutes'
    and not exists (select 1 from public.bookings b where b.payment_id = payments.id);
  -- A hold FLEK let go without Stripe ever authorising anything: every Checkout page has expired after two
  -- hours, so nothing can be authorised any more and nothing is held.
  update public.payments set status = case when status = 'pending' then 'failed'::public.payment_status else status end,
      authorization_state = 'released', failure_reason = coalesce(failure_reason, 'ABANDONED')
  where provider = 'stripe' and confirmation_version = 1 and authorization_state = 'release_pending'
    and payment_intent_id is null and created_at < now() - interval '2 hours';
  update private.confirmation_jobs j set completed_at = now(), lease = null
  from public.payments p
  where p.id = j.payment_id and j.action = 'cancel' and j.completed_at is null
    and p.authorization_state = 'released' and p.payment_intent_id is null;
  -- An authorisation still being released or captured is not an abandoned attempt.
  update public.payments set status = 'failed', failure_reason = coalesce(failure_reason, 'ABANDONED')
  where provider = 'stripe' and status = 'pending' and created_at < now() - interval '2 hours'
    and not (confirmation_version = 1 and authorization_state in ('authorized', 'release_pending'));
  perform private.kick_refunds();
  perform private.notice_payment_issues();
end $$;

revoke all on function public.confirmation_job_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirmation_job_state(uuid, uuid) to service_role;
revoke all on function public.claim_confirmation_jobs(), public.finish_confirmation_job(uuid, uuid, boolean, text),
  public.expire_confirmation_requests(), public.stripe_checkout_expired(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_confirmation_jobs(), public.finish_confirmation_job(uuid, uuid, boolean, text),
  public.expire_confirmation_requests(), public.stripe_checkout_expired(uuid, text) to service_role;
revoke all on function private.queue_release(uuid, text), private.flek_stripe_maintenance() from public, anon, authenticated;
