-- Privileged regression test for manual confirmation: every fixture and side effect is rolled back.
-- Run against a migrated demo database (demo-merchant, demo-merchant2, demo-admin and demo-5 … demo-12).
-- Races are exercised as orderings: the second transition must find the request already decided.
-- Real parallel calls through JWTs live in scripts/acceptance.mjs.
begin;
-- No worker calls leave the transaction.
delete from private.notification_config where key = 'worker_secret';
update private.settings set value = 'demo' where key = 'manual_confirmation_enabled';
insert into private.settings (key, value) values ('manual_confirmation_enabled', 'demo') on conflict (key) do nothing;

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.cap(p_offer uuid) returns integer language sql as $$
  select capacity_remaining from public.offers where id = p_offer
$$;
create function pg_temp.booking(p_payment uuid) returns public.bookings language sql as $$
  select * from public.bookings where payment_id = p_payment
$$;

do $$
declare
  merchant uuid; other_merchant uuid; admin uuid; c uuid[];
  venue public.businesses; svc public.services;
  single uuid; triple uuid; soon uuid; near uuid; spare uuid; frozen uuid; rate uuid[] := '{}';
  pay public.payments; pay2 public.payments; pay3 public.payments; pay4 public.payments; k public.bookings; outcome text; r jsonb;
  raised text; seats_before integer; revision bigint;
begin
  select id into merchant from auth.users where email = 'demo-merchant@flek.test';
  select id into other_merchant from auth.users where email = 'demo-merchant2@flek.test';
  select id into admin from auth.users where email = 'demo-admin@flek.test';
  select array_agg(id order by email) into c from auth.users where email in
    ('demo-5@flek.test','demo-6@flek.test','demo-7@flek.test','demo-8@flek.test','demo-9@flek.test','demo-10@flek.test','demo-11@flek.test','demo-12@flek.test');
  assert merchant is not null and other_merchant is not null and admin is not null and array_length(c, 1) = 8, 'Demo fixtures missing';
  update public.profiles set phone = '+420777123456', booking_blocked = false where id = any(c);

  -- A demo venue of our own, so live demo inventory is never touched.
  select b.* into venue from public.businesses b join public.business_members m on m.business_id = b.id where m.user_id = merchant limit 1;
  venue.id := gen_random_uuid(); venue.slug := 'qa-confirmation-' || venue.id; venue.display_name := 'QA potvrzování';
  venue.status := 'approved'; venue.stripe_account_id := 'acct_qa_' || left(venue.id::text, 8); venue.stripe_charges_enabled := true;
  venue.google_place_id := null;
  insert into public.businesses select venue.*;
  insert into public.business_members (business_id, user_id) values (venue.id, merchant);
  insert into public.services (business_id, name, category_slug, duration_minutes, normal_price_cents)
  values (venue.id, 'QA masáž', venue.category_slug, 60, 100000) returning * into svc;

  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue.id, svc.id, now() + interval '3 hours', now() + interval '4 hours', now() + interval '165 minutes', 100000, 78800, 75000, 3800, 1, 1, 1)
  returning id into single;
  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue.id, svc.id, now() + interval '5 hours', now() + interval '6 hours', now() + interval '285 minutes', 100000, 78800, 75000, 3800, 1, 3, 3)
  returning id into triple;
  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue.id, svc.id, now() + interval '20 minutes', now() + interval '80 minutes', now() + interval '19 minutes', 100000, 78800, 75000, 3800, 1, 1, 1)
  returning id into soon;
  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue.id, svc.id, now() + interval '14 minutes', now() + interval '74 minutes', now() + interval '8 minutes', 100000, 78800, 75000, 3800, 1, 1, 1)
  returning id into near;
  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue.id, svc.id, now() + interval '7 hours', now() + interval '8 hours', now() + interval '405 minutes', 100000, 78800, 75000, 3800, 1, 2, 2)
  returning id into spare;
  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue.id, svc.id, now() + interval '9 hours', now() + interval '10 hours', now() + interval '525 minutes', 100000, 78800, 75000, 3800, 1, 1, 1)
  returning id into frozen;
  for i in 1..5 loop
    insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
      merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
    values (venue.id, svc.id, now() + make_interval(hours => 11 + i), now() + make_interval(hours => 12 + i),
      now() + make_interval(hours => 11 + i) - interval '15 minutes', 100000, 78800, 75000, 3800, 1, 1, 1)
    returning id into spare;
    rate := rate || spare;
  end loop;
  select id into spare from public.offers where business_id = venue.id and capacity_total = 2;

  -- 1. The window: 10 / 5 / 3 minutes, nothing at 15 minutes or less, never later than start − 10 minutes.
  assert private.confirmation_deadline(now() + interval '121 minutes', now()) = now() + interval '10 minutes', 'Over 120 minutes: 10';
  assert private.confirmation_deadline(now() + interval '120 minutes', now()) = now() + interval '5 minutes', 'At 120 minutes: 5';
  assert private.confirmation_deadline(now() + interval '30 minutes', now()) = now() + interval '5 minutes', 'At 30 minutes: 5';
  assert private.confirmation_deadline(now() + interval '29 minutes', now()) = now() + interval '3 minutes', 'Under 30 minutes: 3';
  assert private.confirmation_deadline(now() + interval '15 minutes 1 second', now()) = now() + interval '3 minutes', 'Just over 15 minutes: 3';
  assert private.confirmation_deadline(now() + interval '15 minutes', now()) is null, 'At 15 minutes: no manual booking';
  assert private.confirmation_deadline(now() + interval '5 minutes', now()) is null, 'Very last minute: no manual booking';
  for i in 16..300 loop
    assert private.confirmation_deadline(now() + make_interval(mins => i), now()) <= now() + make_interval(mins => i) - interval '10 minutes',
      'Deadline leaves the customer ten minutes';
  end loop;

  -- 2. Rollout gate: a demo venue takes the new path, a quote says so.
  assert private.manual_confirmation_for(venue.id), 'Demo venue not in demo rollout';
  r := public.confirmation_quote(single);
  assert (r->>'manual')::boolean and (r->>'window_seconds')::integer between 590 and 600, 'Quote for a 3-hour FLEK';
  perform pg_temp.act_as(c[8]);
  raised := null;
  begin perform public.start_payment(near); exception when others then raised := sqlerrm; end;
  assert raised = 'OFFER_UNAVAILABLE', 'A FLEK 14 minutes away accepted a manual booking: ' || coalesce(raised, 'no error');

  -- 3. Hold before Checkout: one seat, idempotent, code never shown.
  perform pg_temp.act_as(c[1]);
  revision := public.inventory_version();
  pay := public.start_payment(single);
  k := pg_temp.booking(pay.id);
  assert pay.confirmation_version = 1 and k.status = 'pending_payment' and pg_temp.cap(single) = 0, 'Hold did not take exactly one seat';
  assert k.checkout_expires_at <= now() + interval '3 minutes', 'Checkout hold longer than 3 minutes';
  assert public.inventory_version() > revision, 'Inventory revision did not move';
  assert (public.start_payment(single)).id = pay.id and pg_temp.cap(single) = 0, 'Repeated start opened a second hold';
  assert not exists (select 1 from public.notifications where booking_id = k.id), 'An unpaid hold notified someone';
  assert (select reservation_code from public.my_bookings() where id = k.id) is null, 'Pending code exposed to the customer';
  assert (public.my_payment_state(pay.id)->>'reservation_code') is null, 'Pending code exposed in payment state';

  -- G. Two customers on the last seat: the second cannot hold it.
  perform pg_temp.act_as(c[2]);
  raised := null;
  begin perform public.start_payment(single); exception when others then raised := sqlerrm; end;
  assert raised = 'OFFER_UNAVAILABLE', 'Second customer took the held last seat';

  -- 4. Authorisation opens the merchant window; duplicates change nothing.
  update public.payments set checkout_session_id = 'cs_qa_single', livemode = false where id = pay.id;
  assert public.confirmation_authorized(pay.id, 'pi_qa_single', 'cs_qa_single', 78800, 'czk', false) = 'pending_merchant', 'Authorisation not accepted';
  k := pg_temp.booking(pay.id);
  assert k.status = 'pending_merchant' and k.confirmation_expires_at between now() + interval '9 minutes' and now() + interval '10 minutes', 'Window not opened';
  assert public.confirmation_authorized(pay.id, 'pi_qa_single', 'cs_qa_single', 78800, 'czk', false) = 'already', 'Duplicate authorisation not idempotent';
  assert public.confirmation_authorized(pay.id, 'pi_qa_other', 'cs_qa_single', 78800, 'czk', false) = 'release_intent', 'Second PaymentIntent not rejected';
  assert (pg_temp.booking(pay.id)).status = 'pending_merchant' and pg_temp.cap(single) = 0, 'Duplicate intent changed the request';
  assert exists (select 1 from public.notifications where booking_id = k.id and user_id = merchant and event = 'requested'), 'Merchant not asked';
  assert not exists (select 1 from public.notifications where booking_id = k.id and user_id = c[1]), 'Customer told before confirmation';
  perform pg_temp.act_as(merchant);
  assert (select reservation_code from public.merchant_bookings(venue.id) where id = k.id) is null, 'Pending code exposed to the merchant';
  assert (select pending_requests from public.merchant_offers(venue.id) where id = single) = 1, 'Pending request not counted for the merchant';

  -- 22, 23. Only a member of this venue decides.
  perform pg_temp.act_as(other_merchant);
  raised := null;
  begin perform public.respond_to_booking(k.id, true); exception when others then raised := sqlerrm; end;
  assert raised = 'FORBIDDEN', 'Another venue confirmed this request';
  perform pg_temp.act_as(c[1]);
  raised := null;
  begin perform public.respond_to_booking(k.id, true); exception when others then raised := sqlerrm; end;
  assert raised = 'FORBIDDEN', 'The customer confirmed their own request';

  -- D, C, B. Confirm wins once; a second confirm, a refusal from another device and a customer cancel find it decided.
  perform pg_temp.act_as(merchant);
  r := public.respond_to_booking(k.id, true);
  assert r->>'status' = 'capturing' and (r->>'decided')::boolean, 'Confirmation not accepted';
  k := pg_temp.booking(pay.id);
  assert k.merchant_decided_by = merchant and k.decision_channel = 'app' and k.merchant_decided_at is not null, 'Decision not recorded';
  assert exists (select 1 from private.confirmation_jobs where payment_id = pay.id and action = 'capture' and completed_at is null), 'Capture not queued';
  r := public.respond_to_booking(k.id, true);
  assert r->>'status' = 'capturing' and not (r->>'decided')::boolean, 'Double confirm decided twice';
  r := public.respond_to_booking(k.id, false);
  assert r->>'status' = 'capturing' and not (r->>'decided')::boolean, 'Refusal after confirmation changed the request';
  perform pg_temp.act_as(c[1]);
  assert public.cancel_pending_booking(k.id) = 'capturing' and pg_temp.cap(single) = 0, 'Customer cancelled a request whose capture started';
  assert public.confirmation_job_ready(pay.id, null) = false, 'Job ready without a lease';

  -- 3–6. Capture books exactly one seat with the agreed money; repeated news changes nothing.
  perform public.confirmation_payment_observed(pay.id, 'captured', 'pi_qa_single', 78800);
  k := pg_temp.booking(pay.id);
  assert k.status = 'confirmed' and k.confirmed_at is not null and pg_temp.cap(single) = 0, 'Capture did not confirm';
  assert k.price_cents = 78800 and k.merchant_payout_cents = 75000 and k.service_fee_cents = 3800, 'Financial snapshot wrong';
  assert (select status from public.payments where id = pay.id) = 'paid', 'Payment not paid';
  perform public.confirmation_payment_observed(pay.id, 'captured', 'pi_qa_single', 78800);
  perform public.confirmation_payment_observed(pay.id, 'released', 'pi_qa_single', 0);
  assert (pg_temp.booking(pay.id)).status = 'confirmed' and pg_temp.cap(single) = 0, 'Duplicate or out-of-order news changed a confirmed booking';
  assert (select reservation_code from public.my_bookings() where id = k.id) like 'FLEK-%', 'Confirmed code hidden';
  assert exists (select 1 from public.notifications where booking_id = k.id and user_id = c[1] and event = 'confirmed'), 'Customer not told';
  assert (select count(*) from public.bookings where offer_id = single and status = 'confirmed') = 1, 'More than one booking';

  -- 7–9. Refusal releases the seat once and queues a release, never a refund.
  perform pg_temp.act_as(c[2]);
  pay2 := public.start_payment(triple);
  update public.payments set checkout_session_id = 'cs_qa_reject', livemode = false where id = pay2.id;
  perform public.confirmation_authorized(pay2.id, 'pi_qa_reject', 'cs_qa_reject', 78800, 'czk', false);
  seats_before := pg_temp.cap(triple);
  perform pg_temp.act_as(merchant);
  r := public.respond_to_booking((pg_temp.booking(pay2.id)).id, false);
  assert r->>'status' = 'rejected' and pg_temp.cap(triple) = seats_before + 1, 'Refusal did not return exactly one seat';
  assert (select action from private.confirmation_jobs where payment_id = pay2.id) = 'cancel', 'Release not queued';
  assert (select refund_requested_at is null and status = 'pending' and authorization_state = 'release_pending' from public.payments where id = pay2.id),
    'Refusal treated as a refund';
  r := public.respond_to_booking((pg_temp.booking(pay2.id)).id, false);
  assert not (r->>'decided')::boolean and pg_temp.cap(triple) = seats_before + 1, 'Second refusal released twice';
  r := public.respond_to_booking((pg_temp.booking(pay2.id)).id, true);
  assert r->>'status' = 'rejected' and pg_temp.cap(triple) = seats_before + 1, 'Confirm after refusal revived the request';
  perform public.confirmation_payment_observed(pay2.id, 'released', 'pi_qa_reject', 0);
  assert (select status = 'failed' and authorization_state = 'released' from public.payments where id = pay2.id), 'Release not recorded';
  assert (select completed_at is not null from private.confirmation_jobs where payment_id = pay2.id), 'Release job left open';
  assert exists (select 1 from public.notifications where booking_id = (pg_temp.booking(pay2.id)).id and user_id = c[2] and title = 'Podnik rezervaci nepotvrdil'),
    'Customer not told about the refusal';

  -- A, 10. Confirm at the deadline loses to the timeout, with or without the job having run.
  perform pg_temp.act_as(c[3]);
  pay3 := public.start_payment(triple);
  update public.payments set checkout_session_id = 'cs_qa_late', livemode = false where id = pay3.id;
  perform public.confirmation_authorized(pay3.id, 'pi_qa_late', 'cs_qa_late', 78800, 'czk', false);
  update public.bookings set confirmation_expires_at = now() - interval '1 second' where payment_id = pay3.id;
  seats_before := pg_temp.cap(triple);
  perform pg_temp.act_as(merchant);
  r := public.respond_to_booking((pg_temp.booking(pay3.id)).id, true);
  assert r->>'status' = 'expired' and pg_temp.cap(triple) = seats_before + 1, 'Confirmation after the deadline won';
  assert public.expire_confirmation_requests() = 0 and pg_temp.cap(triple) = seats_before + 1, 'Expiry released the seat a second time';
  perform pg_temp.act_as(c[4]);
  pay4 := public.start_payment(triple);
  update public.payments set checkout_session_id = 'cs_qa_timeout', livemode = false where id = pay4.id;
  perform public.confirmation_authorized(pay4.id, 'pi_qa_timeout', 'cs_qa_timeout', 78800, 'czk', false);
  update public.bookings set confirmation_expires_at = now() - interval '1 second' where payment_id = pay4.id;
  seats_before := pg_temp.cap(triple);
  assert public.expire_confirmation_requests() >= 1 and (pg_temp.booking(pay4.id)).status = 'expired' and pg_temp.cap(triple) = seats_before + 1,
    'Timeout job did not expire the request';
  perform pg_temp.act_as(merchant);
  r := public.respond_to_booking((pg_temp.booking(pay4.id)).id, true);
  assert r->>'status' = 'expired' and not (r->>'decided')::boolean and pg_temp.cap(triple) = seats_before + 1, 'Late confirmation revived an expired request';
  -- A capture that arrives anyway is refunded, never booked, and the seat is not counted twice.
  perform public.confirmation_payment_observed(pay4.id, 'captured', 'pi_qa_timeout', 78800);
  assert (pg_temp.booking(pay4.id)).status <> 'confirmed' and pg_temp.cap(triple) = seats_before + 1, 'Late capture booked an expired request';
  assert (select refund_requested_at is not null and failure_reason = 'LATE_CAPTURE' from public.payments where id = pay4.id), 'Late capture not refunded';

  -- 11. The customer withdraws a pending request.
  perform pg_temp.act_as(c[5]);
  pay := public.start_payment(triple);
  update public.payments set checkout_session_id = 'cs_qa_cancel', livemode = false where id = pay.id;
  perform public.confirmation_authorized(pay.id, 'pi_qa_cancel', 'cs_qa_cancel', 78800, 'czk', false);
  seats_before := pg_temp.cap(triple);
  assert public.cancel_pending_booking((pg_temp.booking(pay.id)).id) = 'cancelled_by_customer' and pg_temp.cap(triple) = seats_before + 1,
    'Customer cancel did not return the seat';
  assert public.cancel_pending_booking((pg_temp.booking(pay.id)).id) = 'cancelled_by_customer' and pg_temp.cap(triple) = seats_before + 1,
    'Repeated customer cancel returned the seat twice';
  assert exists (select 1 from public.notifications where booking_id = (pg_temp.booking(pay.id)).id and user_id = merchant and title = 'Zákazník žádost zrušil'),
    'Merchant not told about the withdrawal';

  -- 15, multi-spot. Three holds empty an offer of three; the fourth customer cannot hold; expiry returns one seat.
  assert pg_temp.cap(triple) = 3, 'Triple offer not back to three seats';
  perform pg_temp.act_as(c[1]); pay := public.start_payment(triple);
  perform pg_temp.act_as(c[2]); pay2 := public.start_payment(triple);
  perform pg_temp.act_as(c[3]); pay3 := public.start_payment(triple);
  assert pg_temp.cap(triple) = 0 and not (select bookable from public.offer_details where id = triple), 'Three holds did not empty the offer';
  perform pg_temp.act_as(c[6]);
  raised := null;
  begin perform public.start_payment(triple); exception when others then raised := sqlerrm; end;
  assert raised = 'OFFER_UNAVAILABLE', 'Fourth customer held a seat that does not exist';
  update public.bookings set checkout_expires_at = now() - interval '1 second' where payment_id = pay2.id;
  perform public.expire_confirmation_requests();
  assert pg_temp.cap(triple) = 1 and (pg_temp.booking(pay2.id)).status = 'expired', 'Expired Checkout hold did not return exactly one seat';
  assert not exists (select 1 from public.notifications where booking_id = (pg_temp.booking(pay2.id)).id), 'Unpaid expired hold notified someone';
  -- A payment that completes after its hold is released, never booked.
  update public.payments set checkout_session_id = 'cs_qa_slow', livemode = false where id = pay2.id;
  assert public.confirmation_authorized(pay2.id, 'pi_qa_slow', 'cs_qa_slow', 78800, 'czk', false) = 'released', 'Late authorisation accepted';
  assert (select action from private.confirmation_jobs where payment_id = pay2.id) = 'cancel' and pg_temp.cap(triple) = 1, 'Late authorisation not released';

  -- 24. A mismatch is released, never booked and never an error loop.
  update public.payments set checkout_session_id = 'cs_qa_mismatch', livemode = false where id = pay3.id;
  assert public.confirmation_authorized(pay3.id, 'pi_qa_mismatch', 'cs_qa_mismatch', 1, 'czk', false) = 'released', 'Amount mismatch accepted';
  assert (pg_temp.booking(pay3.id)).status = 'payment_failed' and pg_temp.cap(triple) = 2, 'Mismatch did not release the seat';
  assert (select payment_intent_id = 'pi_qa_mismatch' and failure_reason = 'PAYMENT_MISMATCH' from public.payments where id = pay3.id), 'Mismatch intent not kept for release';

  -- 12. Capture that fails for good: seat back once, authorisation released, a later capture refunded.
  update public.payments set checkout_session_id = 'cs_qa_capture', livemode = false where id = pay.id;
  perform public.confirmation_authorized(pay.id, 'pi_qa_capture', 'cs_qa_capture', 78800, 'czk', false);
  perform pg_temp.act_as(merchant);
  perform public.respond_to_booking((pg_temp.booking(pay.id)).id, true);
  seats_before := pg_temp.cap(triple);
  assert public.confirmation_capture_failed(pay.id, 'card_declined') = 'payment_failed' and pg_temp.cap(triple) = seats_before + 1, 'Capture failure kept the seat';
  assert public.confirmation_capture_failed(pay.id, 'card_declined') = 'payment_failed' and pg_temp.cap(triple) = seats_before + 1, 'Capture failure released twice';
  assert (select action from private.confirmation_jobs where payment_id = pay.id) = 'cancel', 'Authorisation not released after capture failure';
  perform public.confirmation_payment_observed(pay.id, 'captured', 'pi_qa_capture', 78800);
  assert (pg_temp.booking(pay.id)).status = 'payment_failed' and pg_temp.cap(triple) = seats_before + 1
    and (select refund_requested_at is not null from public.payments where id = pay.id), 'Capture after failure not refunded';

  -- An abandoned Checkout does not freeze the offer; an open one does.
  perform pg_temp.act_as(c[7]);
  pay := public.start_payment(frozen);
  perform pg_temp.act_as(merchant);
  raised := null;
  begin perform public.update_offer(frozen, '{"merchant_price_cents": 70000}'::jsonb, true); exception when others then raised := sqlerrm; end;
  assert raised = 'OFFER_HAS_PENDING_BOOKINGS', 'Offer edited while a customer held it';
  update public.bookings set checkout_expires_at = now() - interval '1 second' where payment_id = pay.id;
  perform public.expire_confirmation_requests();
  assert not (select has_bookings from public.merchant_offers(venue.id) where id = frozen), 'Expired hold counted as a booking';
  perform public.update_offer(frozen, '{"merchant_price_cents": 70000}'::jsonb, true);
  assert (select merchant_price_cents from public.offers where id = frozen) = 70000 and pg_temp.cap(frozen) = 1, 'Expired hold froze the offer';

  -- Repeatedly holding without paying is limited.
  perform pg_temp.act_as(c[8]);
  for i in 1..5 loop
    pay := public.start_payment(rate[i]);
    perform public.cancel_pending_booking((pg_temp.booking(pay.id)).id);
  end loop;
  raised := null;
  begin perform public.start_payment(spare); exception when others then raised := sqlerrm; end;
  assert raised = 'HOLD_RATE_LIMITED', 'Sixth abandoned hold within an hour allowed: ' || coalesce(raised, 'no error');

  -- The merchant cancelling the offer and the admin suspending the venue end pending requests.
  perform pg_temp.act_as(c[6]);
  pay := public.start_payment(spare);
  update public.payments set checkout_session_id = 'cs_qa_offer', livemode = false where id = pay.id;
  perform public.confirmation_authorized(pay.id, 'pi_qa_offer', 'cs_qa_offer', 78800, 'czk', false);
  perform pg_temp.act_as(merchant);
  perform public.merchant_cancel_offer(spare, 'Kurz odpadá, omlouváme se.');
  assert (pg_temp.booking(pay.id)).status = 'cancelled_by_merchant'
    and (select action from private.confirmation_jobs where payment_id = pay.id) = 'cancel', 'Offer cancellation left a pending request';
  -- An offer cancelled while its capture runs ends as the merchant's cancellation, not as a payment failure.
  perform pg_temp.act_as(c[5]);
  pay := public.start_payment(rate[1]);
  update public.payments set checkout_session_id = 'cs_qa_race', livemode = false where id = pay.id;
  perform public.confirmation_authorized(pay.id, 'pi_qa_race', 'cs_qa_race', 78800, 'czk', false);
  perform pg_temp.act_as(merchant);
  perform public.respond_to_booking((pg_temp.booking(pay.id)).id, true);
  perform public.merchant_cancel_offer(rate[1], 'Nemoc trenéra.');
  k := pg_temp.booking(pay.id);
  assert k.status = 'capturing' and k.cancellation_requested
    and (select action from private.confirmation_jobs where payment_id = pay.id) = 'cancel', 'Capture in flight not turned into a release';
  perform public.confirmation_payment_observed(pay.id, 'released', 'pi_qa_race', 0);
  k := pg_temp.booking(pay.id);
  assert k.status = 'cancelled_by_merchant' and k.cancellation_reason = 'Nemoc trenéra.' and pg_temp.cap(rate[1]) = 1,
    'Offer cancelled during capture reported as a payment failure';

  perform pg_temp.act_as(c[7]);
  pay := public.start_payment(soon);
  update public.payments set checkout_session_id = 'cs_qa_suspend', livemode = false where id = pay.id;
  assert public.confirmation_authorized(pay.id, 'pi_qa_suspend', 'cs_qa_suspend', 78800, 'czk', false) = 'pending_merchant', 'Short window not opened';
  assert (pg_temp.booking(pay.id)).confirmation_expires_at <= now() + interval '3 minutes', 'A FLEK 20 minutes away got more than 3 minutes';
  perform pg_temp.act_as(admin);
  perform public.admin_set_business_status(venue.id, 'suspended', 'QA pozastavení');
  assert (pg_temp.booking(pay.id)).status = 'cancelled_by_merchant' and pg_temp.cap(soon) = 1, 'Suspension left a pending request holding a seat';

  -- The legacy path is untouched while the gate is off.
  update private.settings set value = 'false' where key = 'manual_confirmation_enabled';
  assert not private.manual_confirmation_for(venue.id), 'Gate off still routes to manual confirmation';

  -- Grants: decisions for members, money news and workers for the service role only.
  assert has_function_privilege('authenticated', 'public.respond_to_booking(uuid,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.respond_to_booking(uuid,boolean)', 'EXECUTE'), 'respond_to_booking grants';
  assert not has_function_privilege('authenticated', 'public.confirmation_authorized(uuid,text,text,integer,text,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.confirmation_payment_observed(uuid,text,text,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.confirmation_capture_failed(uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_confirmation_jobs()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.expire_confirmation_requests()', 'EXECUTE'), 'Service functions reachable by clients';
  assert has_function_privilege('anon', 'public.confirmation_quote(uuid)', 'EXECUTE')
    and has_function_privilege('anon', 'public.inventory_version()', 'EXECUTE'), 'Public read models not reachable';
  assert not has_function_privilege('authenticated', 'private.decide_booking(uuid,boolean,uuid,text)', 'EXECUTE'), 'Decision reachable directly';
end $$;
rollback;
select 'PASS: manual confirmation window, hold, authorisation, decisions and races, capture, refusal, timeout, customer cancel, multi-spot capacity, mismatch, capture failure, late capture, offer freeze, hold limit, merchant and admin cancellation, grants; all fixtures rolled back' as result;
