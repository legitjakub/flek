-- Privileged regression test for WhatsApp notifications: every fixture and side effect is rolled back.
-- Run against a migrated demo database (demo-merchant, demo-merchant2 and demo-5 … demo-12).
-- Meta is not called: the worker's part (claim, record the send, finish) is played by the test.
begin;
-- No worker calls leave the transaction.
delete from private.notification_config where key = 'worker_secret';
insert into private.settings (key, value) values ('manual_confirmation_enabled', 'demo')
  on conflict (key) do update set value = 'demo';
delete from private.settings where key = 'whatsapp_display_number';

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.raises(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
-- A customer's request on an offer, authorised as Stripe's webhook would report it.
create function pg_temp.request(p_customer uuid, p_offer uuid, p_intent text) returns public.bookings language plpgsql as $$
declare pay public.payments; k public.bookings;
begin
  perform pg_temp.act_as(p_customer);
  pay := public.start_payment(p_offer);
  update public.payments set checkout_session_id = 'cs_' || p_intent, livemode = false where id = pay.id;
  perform public.confirmation_authorized(pay.id, p_intent, 'cs_' || p_intent, pay.amount_cents, 'czk', false);
  select * into k from public.bookings where payment_id = pay.id;
  return k;
end $$;
-- Stripe reports the capture the merchant's confirmation started.
create function pg_temp.captured(p_booking uuid) returns public.bookings language plpgsql as $$
declare k public.bookings;
begin
  select * into k from public.bookings where id = p_booking;
  perform public.confirmation_payment_observed(k.payment_id, 'captured',
    (select payment_intent_id from public.payments where id = k.payment_id), (select amount_cents from public.payments where id = k.payment_id));
  select * into k from public.bookings where id = p_booking;
  return k;
end $$;

-- Everything the worker claimed, by booking and template. Within one transaction a claimed job is not offered again.
create temp table claimed (id uuid primary key, booking uuid, template text, job jsonb, taken boolean not null default false);
create function pg_temp.job(p_booking uuid, p_template text) returns jsonb language plpgsql as $$
declare batch jsonb; found_job jsonb;
begin
  loop
    exit when exists (select 1 from pg_temp.claimed where booking = p_booking and template = p_template and not taken);
    -- Claimed first, joined after: a query does not see the message rows its own function call inserts.
    batch := public.claim_whatsapp_deliveries();
    exit when jsonb_array_length(batch) = 0;
    insert into pg_temp.claimed (id, booking, template, job)
    select (j->>'id')::uuid, n.booking_id, j->>'template', j
    from jsonb_array_elements(batch) j
    join private.notification_delivery d on d.id = (j->>'id')::uuid
    join public.notifications n on n.id = d.notification_id;
  end loop;
  update pg_temp.claimed set taken = true
  where id = (select id from pg_temp.claimed where booking = p_booking and template = p_template and not taken limit 1)
  returning job into found_job;
  return found_job;
end $$;
-- The worker's answer to a claimed job: sent under a WhatsApp id, or skipped when the claim said so.
create function pg_temp.finish(p_job jsonb, p_wamid text) returns void language plpgsql as $$
begin
  if p_wamid is not null then perform public.whatsapp_message_sent((p_job->>'message_id')::uuid, p_wamid); end if;
  perform public.finish_notification_delivery((p_job->>'id')::uuid, (p_job->>'lease')::uuid,
    case when (p_job->>'allowed')::boolean then 'sent' else 'skipped' end, null);
end $$;
-- WhatsApp deliveries queued about a booking, for the customer or for the venue, for one event.
create function pg_temp.queued(p_booking uuid, p_customer boolean, p_event text) returns integer language sql as $$
  select count(*)::integer from private.notification_delivery d join public.notifications n on n.id = d.notification_id
  where n.booking_id = p_booking and d.channel = 'whatsapp' and (n.business_id is null) = p_customer and n.event = p_event
$$;

do $$
declare
  merchant uuid; other_merchant uuid; c uuid[];
  venue public.businesses; svc public.services; offer uuid[] := '{}'; o uuid;
  venue_contact uuid; customer_contact uuid;
  k public.bookings; job jsonb; token text; code text; r jsonb; raised text; version text := private.whatsapp_consent_version();
begin
  select id into merchant from auth.users where email = 'demo-merchant@flek.test';
  select id into other_merchant from auth.users where email = 'demo-merchant2@flek.test';
  select array_agg(id order by email) into c from auth.users where email in
    ('demo-5@flek.test','demo-6@flek.test','demo-7@flek.test','demo-8@flek.test','demo-9@flek.test','demo-10@flek.test','demo-11@flek.test','demo-12@flek.test');
  assert merchant is not null and other_merchant is not null and array_length(c, 1) = 8, 'Demo fixtures missing';
  update public.profiles set phone = '+420777123456', booking_blocked = false where id = any(c);
  update public.profiles set phone = '+420 777 888 999' where id = c[7];

  select b.* into venue from public.businesses b join public.business_members m on m.business_id = b.id where m.user_id = merchant limit 1;
  venue.id := gen_random_uuid(); venue.slug := 'qa-whatsapp-' || venue.id; venue.display_name := 'QA WhatsApp';
  venue.status := 'approved'; venue.stripe_account_id := 'acct_qa_' || left(venue.id::text, 8); venue.stripe_charges_enabled := true;
  venue.google_place_id := null; venue.phone := '777 123 456'; venue.cancellation_window_minutes := 60;
  insert into public.businesses select venue.*;
  insert into public.business_members (business_id, user_id) values (venue.id, merchant);
  insert into public.services (business_id, name, category_slug, duration_minutes, normal_price_cents)
  values (venue.id, 'QA masáž', venue.category_slug, 60, 100000) returning * into svc;
  for i in 1..9 loop
    insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
      merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
    values (venue.id, svc.id, now() + make_interval(hours => 2 + i), now() + make_interval(hours => 3 + i),
      now() + make_interval(hours => 2 + i) - interval '15 minutes', 100000, 78800, 75000, 3800, 1, 1, 1)
    returning id into o;
    offer := offer || o;
  end loop;

  -- 1. Numbers as people type them.
  assert private.normalize_phone('777 123 456') = '+420777123456'
    and private.normalize_phone('+420 777-123-456') = '+420777123456'
    and private.normalize_phone('00420 777 123 456') = '+420777123456'
    and private.normalize_phone('(+420) 777.123.456') = '+420777123456'
    and private.normalize_phone('+49 151 23456789') = '+4915123456789', 'Valid numbers not normalised';
  assert private.normalize_phone('+420 77712345') is null and private.normalize_phone('12345') is null
    and private.normalize_phone('777 123 456 ext') is null and private.normalize_phone(null) is null, 'Invalid numbers accepted';

  -- 2. A venue's number: only a member, only with the current consent and a real number, only once FLEK has a number.
  perform pg_temp.act_as(other_merchant);
  assert pg_temp.raises(format('select public.whatsapp_settings(%L)', venue.id)) = 'FORBIDDEN', 'Another venue read the settings';
  assert pg_temp.raises(format('select public.whatsapp_start_pairing(%L, %L, %L)', venue.id, '777123456', version)) = 'FORBIDDEN',
    'Another venue paired a number';
  perform pg_temp.act_as(merchant);
  r := public.whatsapp_settings(venue.id);
  -- Offered with the venue's own phone, so turning it on is one tap.
  assert r->>'status' = 'off' and not (r->>'available')::boolean and r->>'kind' = 'business' and r->>'phone' = '+420777123456',
    'Settings before FLEK has a number: ' || r::text;
  assert pg_temp.raises(format('select public.whatsapp_start_pairing(%L, %L, %L)', venue.id, '777123456', version)) = 'WHATSAPP_UNAVAILABLE',
    'Pairing without a FLEK number';
  insert into private.settings (key, value) values ('whatsapp_display_number', '+420222333444');
  assert pg_temp.raises(format('select public.whatsapp_start_pairing(%L, %L, %L)', venue.id, '777123456', 'outdated')) = 'CONSENT_REQUIRED',
    'Pairing without the current consent';
  assert pg_temp.raises(format('select public.whatsapp_start_pairing(%L, %L, %L)', venue.id, '12345', version)) = 'INVALID_PHONE',
    'Pairing an invalid number';
  r := public.whatsapp_start_pairing(venue.id, null, version);
  code := r->>'code';
  assert code ~ '^[0-9]{6}$' and r->>'phone' = '+420777123456' and r->>'flek_number' = '+420222333444', 'Pairing code not issued: ' || r::text;
  select id into venue_contact from private.whatsapp_contacts where kind = 'business' and business_id = venue.id;
  assert not exists (select 1 from private.whatsapp_contacts where id = venue_contact and pairing_code_hash like '%' || code || '%'),
    'Pairing code stored in plain text';
  assert (select consent_by = merchant and consent_version = version from private.whatsapp_contacts where id = venue_contact),
    'Consent not recorded';
  r := public.whatsapp_settings(venue.id);
  assert r->>'status' = 'pending' and (r->>'mine')::boolean, 'Pairing not pending: ' || r::text;
  perform pg_temp.act_as(other_merchant);
  insert into public.business_members (business_id, user_id) values (venue.id, other_merchant);
  assert not (public.whatsapp_settings(venue.id)->>'mine')::boolean, 'Another member shown as the one who paired';
  delete from public.business_members where business_id = venue.id and user_id = other_merchant;

  -- 3. Pairing: a wrong code, the right code from another number, then the real message; Meta's retry is ignored.
  r := public.whatsapp_pair('message:wamid.qa-p1', '420777123456', 'FLEK ' || lpad(((code::integer + 1) % 1000000)::text, 6, '0'));
  assert r->>'result' = 'failed', 'Wrong code paired';
  r := public.whatsapp_pair('message:wamid.qa-p2', '420777999999', 'FLEK ' || code);
  assert r->>'result' = 'failed' and (select pairing_attempts from private.whatsapp_contacts where id = venue_contact) = 1,
    'Code from another number paired or was not counted';
  assert (public.whatsapp_pair('message:wamid.qa-p3', '420777123456', 'Ahoj'))->>'result' = 'ignored', 'Plain text treated as pairing';
  r := public.whatsapp_pair('message:wamid.qa-p4', '420777123456', 'Dobrý den, flek ' || code || ' děkuji');
  assert r->>'result' = 'paired' and r->>'kind' = 'business' and r->>'business' = 'QA WhatsApp', 'Pairing failed: ' || r::text;
  assert (public.whatsapp_pair('message:wamid.qa-p4', '420777123456', 'FLEK ' || code))->>'result' = 'duplicate', 'Retry not deduplicated';
  assert (public.whatsapp_pair('message:wamid.qa-p5', '420777123456', 'FLEK ' || code))->>'result' = 'failed', 'Used code paired again';
  perform pg_temp.act_as(merchant);
  assert public.whatsapp_settings(venue.id)->>'status' = 'verified', 'Number not verified';

  -- 4. A customer pairs their own number the same way, offered from their profile.
  perform pg_temp.act_as(c[7]);
  r := public.whatsapp_settings();
  assert r->>'kind' = 'customer' and r->>'status' = 'off' and r->>'phone' = '+420777888999' and (r->>'available')::boolean,
    'Customer settings: ' || r::text;
  assert pg_temp.raises(format('select public.whatsapp_start_pairing(p_consent_version => %L)', 'outdated')) = 'CONSENT_REQUIRED',
    'Customer pairing without the current consent';
  -- The app makes the code, so the button can be a plain wa.me link that opens WhatsApp in the same tap.
  assert pg_temp.raises(format('select public.whatsapp_start_pairing(p_consent_version => %L, p_code => %L)', version, '12ab56')) = 'VALIDATION_ERROR',
    'Malformed app code accepted';
  r := public.whatsapp_start_pairing(p_consent_version => version, p_code => '004217');
  code := r->>'code';
  assert code = '004217' and r->>'phone' = '+420777888999', 'Customer pairing not on the profile number with the app''s code: ' || r::text;
  assert not exists (select 1 from private.whatsapp_contacts where user_id = c[7] and pairing_code_hash like '%004217%'), 'App code stored in plain text';
  select id into customer_contact from private.whatsapp_contacts where kind = 'customer' and user_id = c[7];
  assert (public.whatsapp_pair('message:wamid.qa-c1', '420777123456', 'FLEK ' || code))->>'result' = 'failed',
    'Customer code paired from the venue''s number';
  r := public.whatsapp_pair('message:wamid.qa-c2', '420777888999', 'FLEK ' || code);
  assert r->>'result' = 'paired' and r->>'kind' = 'customer' and r->>'business' is null, 'Customer pairing failed: ' || r::text;
  assert public.whatsapp_settings()->>'status' = 'verified'
    and (select status from private.whatsapp_contacts where id = venue_contact) = 'verified', 'Customer pairing changed the wrong contact';
  perform pg_temp.act_as(c[8]);
  assert public.whatsapp_settings()->>'status' = 'off', 'Another customer sees someone else''s number';

  -- 5. A request queues one WhatsApp for the venue with the template's parameters and a one-time token.
  k := pg_temp.request(c[1], offer[1], 'pi_qa_wa1');
  assert k.status = 'pending_merchant', 'Request not waiting';
  assert (select count(*) from private.notification_delivery d join public.notifications n on n.id = d.notification_id
          where n.booking_id = k.id and d.channel = 'whatsapp' and d.target = venue_contact::text) = 1, 'WhatsApp not queued exactly once';
  job := pg_temp.job(k.id, 'business_request');
  assert (job->>'allowed')::boolean and job->>'to' = '+420777123456'
    and job->'params'->>0 like '% ' || to_char(k.start_at_snapshot at time zone 'Europe/Prague', 'FMHH24:MI')
    and job->'params'->>1 = 'QA masáž (60 min)' and job->'params'->>2 = '750 Kč'
    and job->'params'->>3 = to_char(k.confirmation_expires_at at time zone 'Europe/Prague', 'FMHH24:MI')
    and length(job->>'token') = 32, 'Claimed job wrong: ' || job::text;
  token := job->>'token';
  assert (select action_hash = encode(extensions.digest(token, 'sha256'), 'hex') and template = 'business_request' and contact_id = venue_contact
          from private.whatsapp_messages where id = (job->>'message_id')::uuid), 'Message not recorded with a hashed token';
  -- Meta's status can beat the worker's record of the send; it is applied once the send is recorded.
  perform public.whatsapp_status('status:wamid.qa-1:delivered', 'wamid.qa-1', 'delivered', null);
  perform pg_temp.finish(job, 'wamid.qa-1');
  assert (select status from private.whatsapp_messages where wamid = 'wamid.qa-1') = 'delivered', 'Early status lost';
  perform public.whatsapp_status('status:wamid.qa-1:sent', 'wamid.qa-1', 'sent', null);
  assert (select status from private.whatsapp_messages where wamid = 'wamid.qa-1') = 'delivered', 'Status stepped back';
  assert not exists (select 1 from private.notification_delivery where id = (job->>'id')::uuid and status in ('pending', 'processing')),
    'Sent WhatsApp left in the queue';

  -- 6. Taps that must not decide anything.
  r := public.whatsapp_decide('message:wamid.qa-t1', '420777999999', 'wamid.qa-1', 'FLEK1.a.' || token, 'Potvrdit');
  assert r->>'result' = 'wrong_number', 'Another number decided: ' || r::text;
  r := public.whatsapp_decide('message:wamid.qa-t2', '420777123456', 'wamid.qa-1', 'FLEK1.a.' || repeat('x', 32), 'Potvrdit');
  assert r->>'result' = 'unknown_message', 'Forged token decided: ' || r::text;
  r := public.whatsapp_decide('message:wamid.qa-t3', '420777123456', 'wamid.qa-1', 'FLEK1.a.' || token, 'Nemohu přijmout');
  assert r->>'result' = 'unknown_action', 'Payload and label disagreeing decided: ' || r::text;
  r := public.whatsapp_decide('message:wamid.qa-t4', '420777123456', 'wamid.qa-unknown', 'Potvrdit', 'Potvrdit');
  assert r->>'result' = 'unknown_message', 'Label on an unknown message decided: ' || r::text;
  r := public.whatsapp_decide('message:wamid.qa-t5', '420777123456', 'wamid.qa-1', 'Ano', 'Ano');
  assert r->>'result' = 'unknown_action', 'Unknown button decided: ' || r::text;
  assert (select status from public.bookings where id = k.id) = 'pending_merchant', 'A rejected tap changed the request';

  -- 7. The real tap decides once, through the same decision as the app.
  r := public.whatsapp_decide('message:wamid.qa-t6', '420777123456', 'wamid.qa-1', 'FLEK1.a.' || token, 'Potvrdit');
  assert r->>'result' = 'decided' and r->>'status' = 'capturing', 'WhatsApp confirmation failed: ' || r::text;
  select * into k from public.bookings where id = k.id;
  assert k.status = 'capturing' and k.decision_channel = 'whatsapp' and k.merchant_decided_by = merchant and k.merchant_decided_at is not null,
    'Decision not recorded with its channel and actor';
  assert (public.whatsapp_decide('message:wamid.qa-t6', '420777123456', 'wamid.qa-1', 'FLEK1.a.' || token, 'Potvrdit'))->>'result' = 'duplicate',
    'Meta retry decided twice';
  r := public.whatsapp_decide('message:wamid.qa-t7', '420777123456', 'wamid.qa-1', 'FLEK1.r.' || token, 'Nemohu přijmout');
  assert r->>'result' = 'already' and r->>'status' = 'capturing', 'Second tap on a used message decided: ' || r::text;

  -- 8. Nobody is told on WhatsApp what they just did, or without a verified number; the venue hears the customer cancel.
  k := pg_temp.captured(k.id);
  assert k.status = 'confirmed', 'Capture did not confirm: ' || k.status;
  assert pg_temp.queued(k.id, false, 'confirmed') = 0 and pg_temp.queued(k.id, true, 'confirmed') = 0,
    'WhatsApp queued for the venue''s own confirmation or for a customer without a number';
  perform pg_temp.act_as(c[1]);
  perform public.cancel_booking(k.id);
  assert pg_temp.queued(k.id, false, 'cancelled') = 1 and pg_temp.queued(k.id, true, 'cancelled') = 0, 'Cancellation WhatsApps wrong';
  job := pg_temp.job(k.id, 'business_cancelled');
  assert (job->>'allowed')::boolean and job->'params'->>1 = 'QA masáž (60 min)' and job->'params'->>2 = 'Rezervace byla zrušena'
    and job->>'token' is null, 'Venue cancellation job wrong: ' || job::text;
  perform pg_temp.finish(job, 'wamid.qa-1c');
  r := public.whatsapp_decide('message:wamid.qa-t1c', '420777123456', 'wamid.qa-1c', 'Potvrdit', 'Potvrdit');
  assert r->>'result' = 'unknown_message', 'Tap on a cancellation message decided: ' || r::text;

  -- 9. Decided in the app first: the tap reports the app's decision.
  k := pg_temp.request(c[2], offer[2], 'pi_qa_wa2');
  job := pg_temp.job(k.id, 'business_request');
  perform pg_temp.finish(job, 'wamid.qa-2');
  perform pg_temp.act_as(merchant);
  perform public.respond_to_booking(k.id, false);
  r := public.whatsapp_decide('message:wamid.qa-t8', '420777123456', 'wamid.qa-2', 'Potvrdit', 'Potvrdit');
  assert r->>'result' = 'not_decided' and r->>'status' = 'rejected', 'Tap after the app refused: ' || r::text;
  assert pg_temp.queued(k.id, false, 'cancelled') = 0, 'WhatsApp queued for the venue''s own refusal';

  -- 10. Without FLEK's payload the label counts on its own message; past the deadline it expires instead.
  k := pg_temp.request(c[3], offer[3], 'pi_qa_wa3');
  job := pg_temp.job(k.id, 'business_request');
  perform pg_temp.finish(job, 'wamid.qa-3');
  r := public.whatsapp_decide('message:wamid.qa-t9', '420777123456', 'wamid.qa-3', 'Nemohu přijmout', 'Nemohu přijmout');
  assert r->>'result' = 'decided' and r->>'status' = 'rejected' and (select capacity_remaining from public.offers where id = offer[3]) = 1,
    'Label-only refusal failed: ' || r::text;
  k := pg_temp.request(c[4], offer[4], 'pi_qa_wa4');
  job := pg_temp.job(k.id, 'business_request');
  perform pg_temp.finish(job, 'wamid.qa-4');
  update public.bookings set confirmation_expires_at = now() - interval '1 second' where id = k.id;
  r := public.whatsapp_decide('message:wamid.qa-t10', '420777123456', 'wamid.qa-4', 'Potvrdit', 'Potvrdit');
  assert r->>'result' = 'not_decided' and r->>'status' = 'expired' and (select capacity_remaining from public.offers where id = offer[4]) = 1,
    'Late WhatsApp confirmation won: ' || r::text;
  -- A request that ran out is news for the venue.
  job := pg_temp.job(k.id, 'business_cancelled');
  assert (job->>'allowed')::boolean and job->'params'->>2 = 'Žádost o rezervaci vypršela', 'Expiry job wrong: ' || coalesce(job::text, 'nothing claimed');
  perform pg_temp.finish(job, null);
  -- A request delivery claimed after the request ended is skipped, not sent.
  k := pg_temp.request(c[5], offer[5], 'pi_qa_wa5');
  perform pg_temp.act_as(c[5]);
  perform public.cancel_pending_booking(k.id);
  job := pg_temp.job(k.id, 'business_request');
  assert job is not null and not (job->>'allowed')::boolean and job->>'token' is null and job->>'message_id' is null and job->>'to' is null,
    'Ended request still sent a WhatsApp: ' || coalesce(job::text, 'nothing claimed');
  perform pg_temp.finish(job, null);
  job := pg_temp.job(k.id, 'business_cancelled');
  assert (job->>'allowed')::boolean and job->'params'->>2 = 'Zákazník žádost zrušil', 'Withdrawn request job wrong: ' || coalesce(job::text, 'nothing claimed');
  perform pg_temp.finish(job, null);

  -- 11. A verified customer gets the confirmed FLEK with its code and the venue's cancellation, on by default.
  k := pg_temp.request(c[7], offer[7], 'pi_qa_wa7');
  job := pg_temp.job(k.id, 'business_request');
  perform pg_temp.finish(job, 'wamid.qa-7');
  perform pg_temp.act_as(merchant);
  perform public.respond_to_booking(k.id, true);
  k := pg_temp.captured(k.id);
  assert k.status = 'confirmed' and pg_temp.queued(k.id, true, 'confirmed') = 1 and pg_temp.queued(k.id, false, 'confirmed') = 0,
    'Customer confirmation not queued exactly once';
  job := pg_temp.job(k.id, 'customer_confirmed');
  assert (job->>'allowed')::boolean and job->>'to' = '+420777888999' and job->'params'->>0 = 'QA WhatsApp'
    and job->'params'->>2 = 'QA masáž (60 min)' and job->'params'->>3 = k.reservation_code and job->>'token' is null
    and (select contact_id = customer_contact and template = 'customer_confirmed' and action_hash is null
         from private.whatsapp_messages where id = (job->>'message_id')::uuid), 'Customer confirmation job wrong: ' || job::text;
  perform pg_temp.finish(job, 'wamid.qa-7c');
  r := public.whatsapp_decide('message:wamid.qa-t7c', '420777888999', 'wamid.qa-7c', 'Potvrdit', 'Potvrdit');
  assert r->>'result' = 'unknown_message', 'Tap on a customer message decided: ' || r::text;
  perform pg_temp.act_as(merchant);
  perform public.merchant_cancel_offer(offer[7], 'QA zrušení');
  assert (select status from public.bookings where id = k.id) = 'cancelled_by_merchant'
    and pg_temp.queued(k.id, true, 'cancelled') = 1 and pg_temp.queued(k.id, false, 'cancelled') = 0,
    'Venue cancellation WhatsApps wrong';
  job := pg_temp.job(k.id, 'customer_cancelled');
  assert (job->>'allowed')::boolean and job->'params'->>0 = 'QA WhatsApp' and job->'params'->>3 = 'Rezervace byla zrušena',
    'Customer cancellation job wrong: ' || job::text;
  perform pg_temp.finish(job, null);

  -- 12. Switched off per event like e-mail: checked when queued and again when sent; an older four-argument save keeps it.
  k := pg_temp.request(c[7], offer[8], 'pi_qa_wa8');
  job := pg_temp.job(k.id, 'business_request');
  perform pg_temp.finish(job, 'wamid.qa-8');
  perform pg_temp.act_as(merchant);
  perform public.respond_to_booking(k.id, true);
  k := pg_temp.captured(k.id);
  assert pg_temp.queued(k.id, true, 'confirmed') = 1, 'Default-on confirmation not queued';
  perform pg_temp.act_as(c[7]);
  perform public.save_notification_preference('customer', 'confirmed', true, false, false);
  job := pg_temp.job(k.id, 'customer_confirmed');
  assert not (job->>'allowed')::boolean and job->>'message_id' is null and job->>'to' is null, 'Switched-off WhatsApp still sent: ' || job::text;
  perform pg_temp.finish(job, null);
  perform public.save_notification_preference('customer', 'cancelled', true, false, false);
  perform public.save_notification_preference('customer', 'cancelled', true, true);
  assert (select not whatsapp and push and email from public.notification_preferences where user_id = c[7] and scope = 'customer' and event = 'cancelled'),
    'Four-argument save changed the WhatsApp choice';
  assert (select whatsapp from public.my_notification_preferences('customer') where event = 'confirmed') = false, 'Preference not readable';
  perform pg_temp.act_as(merchant);
  perform public.merchant_cancel_offer(offer[8], 'QA zrušení');
  assert pg_temp.queued(k.id, true, 'cancelled') = 0, 'WhatsApp queued despite the customer''s choice';
  -- The venue's member switches requests off: nothing is queued for the venue.
  perform public.save_notification_preference(venue.id::text, 'requested', true, false, false);
  k := pg_temp.request(c[8], offer[9], 'pi_qa_wa9');
  assert k.status = 'pending_merchant' and pg_temp.queued(k.id, false, 'requested') = 0, 'Request queued despite the venue''s choice';
  perform pg_temp.act_as(merchant);
  perform public.save_notification_preference(venue.id::text, 'requested', true, false, true);

  -- 13. A new number, or a member who left, and old messages no longer decide.
  k := pg_temp.request(c[6], offer[6], 'pi_qa_wa6');
  job := pg_temp.job(k.id, 'business_request');
  perform pg_temp.finish(job, 'wamid.qa-6');
  perform pg_temp.act_as(merchant);
  perform public.whatsapp_start_pairing(venue.id, '+420 777 555 666', version);
  r := public.whatsapp_decide('message:wamid.qa-t11', '420777123456', 'wamid.qa-6', 'FLEK1.a.' || (job->>'token'), 'Potvrdit');
  assert r->>'result' = 'not_allowed', 'Tap after re-pairing decided: ' || r::text;
  update private.whatsapp_contacts set status = 'verified', phone_e164 = '+420777123456' where id = venue_contact;
  insert into public.business_members (business_id, user_id) values (venue.id, other_merchant);
  update private.whatsapp_contacts set consent_by = other_merchant where id = venue_contact;
  delete from public.business_members where business_id = venue.id and user_id = other_merchant;
  r := public.whatsapp_decide('message:wamid.qa-t12', '420777123456', 'wamid.qa-6', 'FLEK1.a.' || (job->>'token'), 'Potvrdit');
  assert r->>'result' = 'not_allowed', 'Tap from a former member decided: ' || r::text;
  assert (select status from public.bookings where id = k.id) = 'pending_merchant', 'Refused taps changed the request';
  update private.whatsapp_contacts set consent_by = merchant where id = venue_contact;

  -- 14. Switching off, and a limit on new codes.
  perform pg_temp.act_as(merchant);
  perform public.whatsapp_disable(venue.id);
  assert public.whatsapp_settings(venue.id)->>'status' = 'disabled', 'Venue not disabled';
  perform pg_temp.act_as(c[7]);
  perform public.whatsapp_disable();
  assert public.whatsapp_settings()->>'status' = 'disabled' and (select status from private.whatsapp_contacts where id = customer_contact) = 'disabled',
    'Customer not disabled';
  perform pg_temp.act_as(merchant);
  for i in 1..3 loop perform public.whatsapp_start_pairing(venue.id, '777123456', version); end loop;
  raised := pg_temp.raises(format('select public.whatsapp_start_pairing(%L, %L, %L)', venue.id, '777123456', version));
  assert raised = 'WHATSAPP_PAIRING_RATE_LIMITED', 'Sixth code in an hour: ' || coalesce(raised, 'no error');

  -- 15. No phone numbers in analytics, and the webhook's functions only for the service role.
  assert not exists (select 1 from public.analytics_events where name like 'whatsapp%'
    and (props::text like '%777123456%' or props::text like '%777999999%' or props::text like '%777888999%')), 'Phone number in analytics';
  assert exists (select 1 from public.analytics_events where name = 'whatsapp_decision' and props->>'status' = 'capturing'), 'Decision not in analytics';
  assert has_function_privilege('authenticated', 'public.whatsapp_start_pairing(uuid,text,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.save_notification_preference(text,text,boolean,boolean,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.save_notification_preference(text,text,boolean,boolean,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.whatsapp_settings(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.whatsapp_start_pairing(uuid,text,text,text)', 'EXECUTE'), 'Member functions grants';
  assert not has_function_privilege('authenticated', 'public.whatsapp_decide(text,text,text,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.whatsapp_pair(text,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.whatsapp_status(text,text,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_whatsapp_deliveries()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.whatsapp_message_sent(uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.whatsapp_default_phone(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.whatsapp_decide(text,text,text,text,text)', 'EXECUTE'), 'Webhook functions reachable by clients';
  assert not has_table_privilege('authenticated', 'private.whatsapp_contacts', 'SELECT')
    and not has_table_privilege('anon', 'private.whatsapp_messages', 'SELECT'), 'WhatsApp tables readable by clients';
end $$;
rollback;
select 'PASS: phone normalisation, member-only pairing with consent on the venue''s phone, customer pairing on the profile phone, pairing by code from the entered number, one WhatsApp per request, early statuses, forged and misplaced taps refused, one decision per message through decide_booking, no WhatsApp about one''s own action or without a verified number, customer confirmation with code and cancellation, preferences on by default and re-checked at send, app-first and late taps, ended requests skipped, re-pairing and former members refused, disable, code limit, analytics without numbers, grants; all fixtures rolled back' as result;
