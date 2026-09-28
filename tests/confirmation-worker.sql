-- Confirmation worker without silent endings (audit 28. 9., M1–M3). Everything rolls back.
-- M1: the database tells the worker why a capture may not run, so a lost lease is never read as "too late".
-- M2: a request nobody paid for ends as released, not "being released" for ever.
-- M3: a release is retried with a growing pause after eight tries; a capture that cannot finish is ended.
-- Run against a migrated database with the demo seed (it copies one demo venue as the template).
begin;
delete from private.notification_config where key = 'worker_secret';

do $$
declare
  template public.businesses; venue public.businesses; svc uuid; customer uuid; offer_id uuid;
  pay uuid; k uuid; my_lease uuid := gen_random_uuid(); other_lease uuid := gen_random_uuid();
  ready_pay uuid; late_pay uuid; spent_pay uuid; busy_pay uuid; unpaid_pay uuid; young_pay uuid; held_pay uuid; closed_pay uuid;
  claimed jsonb; next_at timestamptz; i integer;
begin
  select * into template from public.businesses where status = 'approved' order by created_at limit 1;
  assert template.id is not null, 'Demo venue to copy missing';
  venue := template;
  venue.id := gen_random_uuid(); venue.slug := 'qa-worker-' || venue.id; venue.display_name := 'QA worker';
  venue.stripe_account_id := 'acct_qa_' || left(venue.id::text, 8); venue.stripe_charges_enabled := true;
  venue.google_place_id := null; venue.pending_moderation_id := null; venue.content_status := 'approved';
  insert into public.businesses select venue.*;
  insert into public.services (business_id, name, category_slug, duration_minutes, normal_price_cents)
  values (venue.id, 'QA služba', venue.category_slug, 60, 100000) returning id into svc;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'qa-worker@example.invalid', 'x', now(),
    '{"provider": "email", "providers": ["email"]}', '{"first_name": "QA", "last_name": "Worker"}', now(), now())
  returning id into customer;

  -- One offer and one confirmation-flow request per case (a customer may hold one active request per offer).
  for i in 1..8 loop
    insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
      merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
    values (venue.id, svc, now() + interval '3 hours', now() + interval '4 hours', now() + interval '165 minutes',
      100000, 78800, 75000, 3800, 1, 1, 0) returning id into offer_id;
    insert into public.payments (customer_id, offer_id, amount_cents, provider, status, confirmation_version, authorization_state,
      payment_intent_id, checkout_session_id, destination_account_id, application_fee_cents)
    values (customer, offer_id, 78800, 'stripe', 'pending', 1, case when i <= 4 then 'authorized' else 'none' end,
      case when i <= 4 or i = 8 then 'pi_qa_worker_' || i end, 'cs_qa_worker_' || i, venue.stripe_account_id, 3800)
    returning id into pay;
    insert into public.bookings (offer_id, business_id, customer_id, reservation_code, price_cents, service_name_snapshot, business_name_snapshot,
      business_address_snapshot, start_at_snapshot, end_at_snapshot, original_price_cents_snapshot, payment_id, merchant_payout_cents,
      service_fee_cents, fee_policy_version, status, confirmation_version, checkout_expires_at, authorized_at, merchant_decided_at)
    select offer_id, venue.id, customer, 'FLEK-QAW' || upper(left(md5(random()::text), 5)), 78800, 'QA služba', venue.display_name, 'Adresa',
      start_at, end_at, 100000, pay, 75000, 3800, 1,
      case when i <= 4 then 'capturing'::public.booking_status else 'pending_payment'::public.booking_status end, 1, now() + interval '3 minutes',
      case when i <= 4 then now() - interval '5 minutes' end, case when i <= 4 then now() - interval '1 minute' end
    from public.offers where id = offer_id;
    case i
      when 1 then ready_pay := pay; when 2 then late_pay := pay; when 3 then spent_pay := pay; when 4 then busy_pay := pay;
      when 5 then unpaid_pay := pay; when 6 then young_pay := pay; when 7 then closed_pay := pay; else held_pay := pay;
    end case;
  end loop;

  -- ----------------------------------------------------------------- M1: why a capture may not run
  insert into private.confirmation_jobs (payment_id, action, lease, attempts) values (ready_pay, 'capture', my_lease, 1);
  assert public.confirmation_job_state(ready_pay, my_lease) = 'ready', 'A capture that may run is not ready';
  assert public.confirmation_job_state(ready_pay, other_lease) = 'lease_lost', 'A job taken over by another run is not reported as such';
  assert public.confirmation_job_state(gen_random_uuid(), my_lease) = 'missing', 'An unknown payment is not missing';
  update public.bookings set cancellation_requested = true where payment_id = ready_pay;
  assert public.confirmation_job_state(ready_pay, my_lease) = 'cancel_requested', 'A cancelled offer does not ask for a release';
  update public.bookings set cancellation_requested = false, start_at_snapshot = now() - interval '1 minute' where payment_id = ready_pay;
  assert public.confirmation_job_state(ready_pay, my_lease) = 'started', 'A capture after the start is not refused';
  update public.bookings set start_at_snapshot = now() + interval '3 hours', status = 'payment_failed', cancelled_at = now(),
    capacity_released_at = now() where payment_id = ready_pay;
  assert public.confirmation_job_state(ready_pay, my_lease) = 'not_capturing', 'A request that ended is still capturable';
  update private.confirmation_jobs set completed_at = now() where payment_id = ready_pay;
  assert public.confirmation_job_state(ready_pay, my_lease) = 'done', 'A finished job is not done';
  -- The lost lease the worker used to read as "too late" leaves the request alone now; the old check said no to both.
  assert not public.confirmation_job_ready(ready_pay, other_lease), 'Old readiness check changed';

  -- ------------------------------------------------- M3: releases keep trying, captures that cannot finish end
  delete from private.confirmation_jobs where payment_id = ready_pay;
  insert into private.confirmation_jobs (payment_id, action, attempts, available_at) values
    (unpaid_pay, 'cancel', 8, now() - interval '1 second'),
    (spent_pay, 'capture', 8, now() - interval '1 second');
  update public.bookings set status = 'expired', cancelled_at = now(), capacity_released_at = now() where payment_id = unpaid_pay;
  update public.payments set authorization_state = 'release_pending' where id = unpaid_pay;
  claimed := public.claim_confirmation_jobs();
  assert exists (select 1 from jsonb_array_elements(claimed) c where (c->>'payment_id')::uuid = unpaid_pay and (c->>'attempts')::int = 9),
    'A release stopped after eight tries';
  -- claim_confirmation_jobs runs the sweep first: the exhausted capture ends, and in the same claim its hold is released.
  assert not exists (select 1 from jsonb_array_elements(claimed) c where (c->>'payment_id')::uuid = spent_pay and c->>'action' = 'capture'),
    'A capture was tried a ninth time';
  assert exists (select 1 from jsonb_array_elements(claimed) c where (c->>'payment_id')::uuid = spent_pay and c->>'action' = 'cancel'
                 and (c->>'attempts')::int = 1), 'The exhausted capture''s hold was not released at once';
  assert (select status = 'payment_failed' from public.bookings where payment_id = spent_pay), 'An exhausted capture still holds the seat';
  assert (select authorization_state = 'release_pending' from public.payments where id = spent_pay), 'The exhausted capture''s hold is not being released';

  perform public.finish_confirmation_job(unpaid_pay, (select j.lease from private.confirmation_jobs j where j.payment_id = unpaid_pay), false, 'STRIPE_TIMEOUT');
  select available_at into next_at from private.confirmation_jobs where payment_id = unpaid_pay;
  assert next_at between now() + interval '110 seconds' and now() + interval '130 seconds', format('Ninth release retry at %s', next_at - now());
  update private.confirmation_jobs set attempts = 30, lease = other_lease where payment_id = unpaid_pay;
  perform public.finish_confirmation_job(unpaid_pay, other_lease, false, 'STRIPE_TIMEOUT');
  assert (select available_at between now() + interval '59 minutes' and now() + interval '61 minutes' from private.confirmation_jobs where payment_id = unpaid_pay),
    'The pause between releases is not capped at an hour';

  -- A capture past the start is ended five minutes after it; one still in time is left to the worker.
  insert into private.confirmation_jobs (payment_id, action, attempts) values (late_pay, 'capture', 2), (busy_pay, 'capture', 3);
  update public.bookings set start_at_snapshot = now() - interval '10 minutes' where payment_id = late_pay;
  perform public.expire_confirmation_requests();
  assert (select status = 'payment_failed' and capacity_released_at is not null from public.bookings where payment_id = late_pay),
    'A capture ten minutes after the start still holds the seat';
  assert (select capacity_remaining = 1 from public.offers o join public.bookings k on k.offer_id = o.id where k.payment_id = late_pay),
    'The seat of a capture that ended did not come back';
  assert (select status = 'capturing' from public.bookings where payment_id = busy_pay), 'A capture still in time was ended';

  -- ----------------------------------------------------- M2: nothing authorised, nothing left to release
  -- The worker closed the Checkout page and found no authorisation: it reports the release without an intent.
  perform public.confirmation_payment_observed(unpaid_pay, 'released', null, 0);
  assert (select status = 'failed' and authorization_state = 'released' from public.payments where id = unpaid_pay),
    'An unpaid request is still being released';
  assert (select completed_at is not null from private.confirmation_jobs where payment_id = unpaid_pay), 'Its release job is still open';

  -- A late authorisation after that puts it back to being released.
  perform private.queue_release(unpaid_pay, 'CHECKOUT_TIMEOUT');
  assert (select authorization_state = 'release_pending' from public.payments where id = unpaid_pay), 'A late authorisation is not being released';

  -- Stripe closing an unpaid Checkout says the same.
  update public.bookings set status = 'expired', cancelled_at = now(), capacity_released_at = now() where payment_id = closed_pay;
  update public.payments set authorization_state = 'release_pending' where id = closed_pay;
  perform public.stripe_checkout_expired(closed_pay, 'cs_qa_worker_7');
  assert (select status = 'failed' and authorization_state = 'released' from public.payments where id = closed_pay),
    'An expired unpaid Checkout still reads as being released';

  -- The five-minute maintenance settles what is left, old rows included, and nothing it must not touch.
  update public.bookings set status = 'expired', cancelled_at = now(), capacity_released_at = now() where payment_id in (young_pay, held_pay);
  update public.payments set authorization_state = 'release_pending', created_at = now() - interval '3 hours' where id = young_pay;
  update public.payments set authorization_state = 'release_pending', created_at = now() - interval '3 hours' where id = held_pay;
  insert into private.confirmation_jobs (payment_id, action) values (young_pay, 'cancel'), (held_pay, 'cancel');
  perform private.flek_stripe_maintenance();
  assert (select status = 'failed' and authorization_state = 'released' from public.payments where id = young_pay),
    'An old unpaid request was not settled';
  assert (select completed_at is not null from private.confirmation_jobs where payment_id = young_pay), 'Its release job keeps running';
  assert (select authorization_state = 'release_pending' and status = 'pending' from public.payments where id = held_pay),
    'A hold with an authorisation was marked released without Stripe';
  assert (select completed_at is null from private.confirmation_jobs where payment_id = held_pay), 'A real release job was closed';

  assert not has_function_privilege('authenticated', 'public.confirmation_job_state(uuid, uuid)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.confirmation_job_state(uuid, uuid)', 'EXECUTE'), 'A client can read job states';
end $$;

rollback;
select 'PASS: job states (ready, lease lost, missing, cancel, started, ended, done), releases retried with a pause up to an hour, exhausted and late captures ended with the seat back, unpaid requests settled by the worker, Stripe and maintenance, late authorisation released again; all fixtures rolled back' as result;
