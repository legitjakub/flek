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
-- The worker: claim, "send" under the given WhatsApp id, finish. Returns the claimed job.
create function pg_temp.deliver(p_booking uuid, p_wamid text) returns jsonb language plpgsql as $$
declare claimed jsonb; job jsonb;
begin
  -- Claimed first, joined after: a query does not see the message rows its own function call inserts.
  claimed := public.claim_whatsapp_deliveries();
  select j into job from jsonb_array_elements(claimed) j
  join private.whatsapp_messages m on m.id = (j->>'message_id')::uuid
  where m.booking_id = p_booking;
  if job is null then return null; end if;
  if p_wamid is not null then perform public.whatsapp_message_sent((job->>'message_id')::uuid, p_wamid); end if;
  perform public.finish_notification_delivery((job->>'id')::uuid, (job->>'lease')::uuid, 'sent', null);
  return job;
end $$;

do $$
declare
  merchant uuid; other_merchant uuid; c uuid[];
  venue public.businesses; svc public.services; offer uuid[] := '{}'; o uuid;
  k public.bookings; job jsonb; token text; code text; r jsonb; raised text; version text := private.whatsapp_consent_version();
begin
  select id into merchant from auth.users where email = 'demo-merchant@flek.test';
  select id into other_merchant from auth.users where email = 'demo-merchant2@flek.test';
  select array_agg(id order by email) into c from auth.users where email in
    ('demo-5@flek.test','demo-6@flek.test','demo-7@flek.test','demo-8@flek.test','demo-9@flek.test','demo-10@flek.test','demo-11@flek.test','demo-12@flek.test');
  assert merchant is not null and other_merchant is not null and array_length(c, 1) = 8, 'Demo fixtures missing';
  update public.profiles set phone = '+420777123456', booking_blocked = false where id = any(c);

  select b.* into venue from public.businesses b join public.business_members m on m.business_id = b.id where m.user_id = merchant limit 1;
  venue.id := gen_random_uuid(); venue.slug := 'qa-whatsapp-' || venue.id; venue.display_name := 'QA WhatsApp';
  venue.status := 'approved'; venue.stripe_account_id := 'acct_qa_' || left(venue.id::text, 8); venue.stripe_charges_enabled := true;
  venue.google_place_id := null;
  insert into public.businesses select venue.*;
  insert into public.business_members (business_id, user_id) values (venue.id, merchant);
  insert into public.services (business_id, name, category_slug, duration_minutes, normal_price_cents)
  values (venue.id, 'QA masáž', venue.category_slug, 60, 100000) returning * into svc;
  for i in 1..6 loop
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

  -- 2. Only a member, only with the current consent and a real number, only once FLEK has a number.
  perform pg_temp.act_as(other_merchant);
  assert pg_temp.raises(format('select public.whatsapp_settings(%L)', venue.id)) = 'FORBIDDEN', 'Another venue read the settings';
  assert pg_temp.raises(format('select public.whatsapp_start_pairing(%L, %L, %L)', venue.id, '777123456', version)) = 'FORBIDDEN',
    'Another venue paired a number';
  perform pg_temp.act_as(merchant);
  r := public.whatsapp_settings(venue.id);
  assert r->>'status' = 'off' and not (r->>'available')::boolean, 'Settings before FLEK has a number';
  assert pg_temp.raises(format('select public.whatsapp_start_pairing(%L, %L, %L)', venue.id, '777123456', version)) = 'WHATSAPP_UNAVAILABLE',
    'Pairing without a FLEK number';
  insert into private.settings (key, value) values ('whatsapp_display_number', '+420222333444');
  assert pg_temp.raises(format('select public.whatsapp_start_pairing(%L, %L, %L)', venue.id, '777123456', 'outdated')) = 'CONSENT_REQUIRED',
    'Pairing without the current consent';
  assert pg_temp.raises(format('select public.whatsapp_start_pairing(%L, %L, %L)', venue.id, '12345', version)) = 'INVALID_PHONE',
    'Pairing an invalid number';
  r := public.whatsapp_start_pairing(venue.id, '777 123 456', version);
  code := r->>'code';
  assert code ~ '^[0-9]{6}$' and r->>'phone' = '+420777123456' and r->>'flek_number' = '+420222333444', 'Pairing code not issued';
  assert not exists (select 1 from private.business_whatsapp where business_id = venue.id and pairing_code_hash like '%' || code || '%'),
    'Pairing code stored in plain text';
  assert (select consent_by = merchant and consent_version = version from private.business_whatsapp where business_id = venue.id),
    'Consent not recorded';
  assert public.whatsapp_settings(venue.id)->>'status' = 'pending', 'Pairing not pending';

  -- 3. Pairing: a wrong code, the right code from another number, then the real message; Meta's retry is ignored.
  r := public.whatsapp_pair('message:wamid.qa-p1', '420777123456', 'FLEK ' || lpad(((code::integer + 1) % 1000000)::text, 6, '0'));
  assert r->>'result' = 'failed', 'Wrong code paired';
  r := public.whatsapp_pair('message:wamid.qa-p2', '420777999999', 'FLEK ' || code);
  assert r->>'result' = 'failed' and (select pairing_attempts from private.business_whatsapp where business_id = venue.id) = 1,
    'Code from another number paired or was not counted';
  assert (public.whatsapp_pair('message:wamid.qa-p3', '420777123456', 'Ahoj'))->>'result' = 'ignored', 'Plain text treated as pairing';
  r := public.whatsapp_pair('message:wamid.qa-p4', '420777123456', 'Dobrý den, flek ' || code || ' děkuji');
  assert r->>'result' = 'paired' and r->>'business' = 'QA WhatsApp', 'Pairing failed: ' || r::text;
  assert (public.whatsapp_pair('message:wamid.qa-p4', '420777123456', 'FLEK ' || code))->>'result' = 'duplicate', 'Retry not deduplicated';
  assert (public.whatsapp_pair('message:wamid.qa-p5', '420777123456', 'FLEK ' || code))->>'result' = 'failed', 'Used code paired again';
  assert public.whatsapp_settings(venue.id)->>'status' = 'verified', 'Number not verified';

  -- 4. A request queues one WhatsApp for the venue with the template's facts and a one-time token.
  k := pg_temp.request(c[1], offer[1], 'pi_qa_wa1');
  assert k.status = 'pending_merchant', 'Request not waiting';
  assert (select count(*) from private.notification_delivery d join public.notifications n on n.id = d.notification_id
          where n.booking_id = k.id and d.channel = 'whatsapp' and d.target = '+420777123456') = 1, 'WhatsApp not queued exactly once';
  job := pg_temp.deliver(k.id, null);
  assert (job->>'allowed')::boolean and job->>'to' = '+420777123456' and job->>'payout' = '750 Kč' and job->>'service' = 'QA masáž (60 min)'
    and job->>'deadline' = to_char(k.confirmation_expires_at at time zone 'Europe/Prague', 'FMHH24:MI')
    and job->>'when' like '% ' || to_char(k.start_at_snapshot at time zone 'Europe/Prague', 'FMHH24:MI')
    and length(job->>'token') = 32, 'Claimed job wrong: ' || job::text;
  token := job->>'token';
  assert (select action_hash = encode(extensions.digest(token, 'sha256'), 'hex') from private.whatsapp_messages where id = (job->>'message_id')::uuid),
    'Token not stored as a hash';
  -- Meta's status can beat the worker's record of the send; it is applied once the send is recorded.
  perform public.whatsapp_status('status:wamid.qa-1:delivered', 'wamid.qa-1', 'delivered', null);
  perform public.whatsapp_message_sent((job->>'message_id')::uuid, 'wamid.qa-1');
  assert (select status from private.whatsapp_messages where wamid = 'wamid.qa-1') = 'delivered', 'Early status lost';
  perform public.whatsapp_status('status:wamid.qa-1:sent', 'wamid.qa-1', 'sent', null);
  assert (select status from private.whatsapp_messages where wamid = 'wamid.qa-1') = 'delivered', 'Status stepped back';
  assert not exists (select 1 from private.notification_delivery where id = (job->>'id')::uuid and status in ('pending', 'processing')),
    'Sent WhatsApp left in the queue';

  -- 5. Taps that must not decide anything.
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

  -- 6. The real tap decides once, through the same decision as the app.
  r := public.whatsapp_decide('message:wamid.qa-t6', '420777123456', 'wamid.qa-1', 'FLEK1.a.' || token, 'Potvrdit');
  assert r->>'result' = 'decided' and r->>'status' = 'capturing', 'WhatsApp confirmation failed: ' || r::text;
  select * into k from public.bookings where id = k.id;
  assert k.status = 'capturing' and k.decision_channel = 'whatsapp' and k.merchant_decided_by = merchant and k.merchant_decided_at is not null,
    'Decision not recorded with its channel and actor';
  assert (public.whatsapp_decide('message:wamid.qa-t6', '420777123456', 'wamid.qa-1', 'FLEK1.a.' || token, 'Potvrdit'))->>'result' = 'duplicate',
    'Meta retry decided twice';
  r := public.whatsapp_decide('message:wamid.qa-t7', '420777123456', 'wamid.qa-1', 'FLEK1.r.' || token, 'Nemohu přijmout');
  assert r->>'result' = 'already' and r->>'status' = 'capturing', 'Second tap on a used message decided: ' || r::text;

  -- 7. Decided in the app first: the tap reports the app's decision.
  k := pg_temp.request(c[2], offer[2], 'pi_qa_wa2');
  job := pg_temp.deliver(k.id, 'wamid.qa-2');
  perform pg_temp.act_as(merchant);
  perform public.respond_to_booking(k.id, false);
  r := public.whatsapp_decide('message:wamid.qa-t8', '420777123456', 'wamid.qa-2', 'Potvrdit', 'Potvrdit');
  assert r->>'result' = 'not_decided' and r->>'status' = 'rejected', 'Tap after the app refused: ' || r::text;

  -- 8. Without FLEK's payload the label counts on its own message; past the deadline it expires instead.
  k := pg_temp.request(c[3], offer[3], 'pi_qa_wa3');
  job := pg_temp.deliver(k.id, 'wamid.qa-3');
  r := public.whatsapp_decide('message:wamid.qa-t9', '420777123456', 'wamid.qa-3', 'Nemohu přijmout', 'Nemohu přijmout');
  assert r->>'result' = 'decided' and r->>'status' = 'rejected' and (select capacity_remaining from public.offers where id = offer[3]) = 1,
    'Label-only refusal failed: ' || r::text;
  k := pg_temp.request(c[4], offer[4], 'pi_qa_wa4');
  job := pg_temp.deliver(k.id, 'wamid.qa-4');
  update public.bookings set confirmation_expires_at = now() - interval '1 second' where id = k.id;
  r := public.whatsapp_decide('message:wamid.qa-t10', '420777123456', 'wamid.qa-4', 'Potvrdit', 'Potvrdit');
  assert r->>'result' = 'not_decided' and r->>'status' = 'expired' and (select capacity_remaining from public.offers where id = offer[4]) = 1,
    'Late WhatsApp confirmation won: ' || r::text;
  -- A delivery claimed after its request ended is skipped, not sent.
  k := pg_temp.request(c[5], offer[5], 'pi_qa_wa5');
  perform pg_temp.act_as(c[5]);
  perform public.cancel_pending_booking(k.id);
  select j into job from jsonb_array_elements(public.claim_whatsapp_deliveries()) j where j->>'to' = '+420777123456' limit 1;
  assert job is not null and not (job->>'allowed')::boolean and job->>'token' is null and job->>'message_id' is null,
    'Ended request still sent a WhatsApp: ' || coalesce(job::text, 'nothing claimed');
  perform public.finish_notification_delivery((job->>'id')::uuid, (job->>'lease')::uuid, 'skipped', null);

  -- 9. A new number, or a member who left, and old messages no longer decide.
  k := pg_temp.request(c[6], offer[6], 'pi_qa_wa6');
  job := pg_temp.deliver(k.id, 'wamid.qa-6');
  perform pg_temp.act_as(merchant);
  perform public.whatsapp_start_pairing(venue.id, '+420 777 555 666', version);
  r := public.whatsapp_decide('message:wamid.qa-t11', '420777123456', 'wamid.qa-6', 'FLEK1.a.' || (job->>'token'), 'Potvrdit');
  assert r->>'result' = 'not_allowed', 'Tap after re-pairing decided: ' || r::text;
  update private.business_whatsapp set status = 'verified', phone_e164 = '+420777123456' where business_id = venue.id;
  insert into public.business_members (business_id, user_id) values (venue.id, other_merchant);
  update private.business_whatsapp set consent_by = other_merchant where business_id = venue.id;
  delete from public.business_members where business_id = venue.id and user_id = other_merchant;
  r := public.whatsapp_decide('message:wamid.qa-t12', '420777123456', 'wamid.qa-6', 'FLEK1.a.' || (job->>'token'), 'Potvrdit');
  assert r->>'result' = 'not_allowed', 'Tap from a former member decided: ' || r::text;
  assert (select status from public.bookings where id = k.id) = 'pending_merchant', 'Refused taps changed the request';
  update private.business_whatsapp set consent_by = merchant where business_id = venue.id;

  -- 10. Switching off, and a limit on new codes.
  perform pg_temp.act_as(merchant);
  perform public.whatsapp_disable(venue.id);
  assert public.whatsapp_settings(venue.id)->>'status' = 'disabled', 'Not disabled';
  for i in 1..3 loop perform public.whatsapp_start_pairing(venue.id, '777123456', version); end loop;
  raised := pg_temp.raises(format('select public.whatsapp_start_pairing(%L, %L, %L)', venue.id, '777123456', version));
  assert raised = 'WHATSAPP_PAIRING_RATE_LIMITED', 'Sixth code in an hour: ' || coalesce(raised, 'no error');

  -- 11. No phone numbers in analytics, and the webhook's functions only for the service role.
  assert not exists (select 1 from public.analytics_events where name like 'whatsapp%' and (props::text like '%777123456%' or props::text like '%777999999%')),
    'Phone number in analytics';
  assert exists (select 1 from public.analytics_events where name = 'whatsapp_decision' and props->>'status' = 'capturing'), 'Decision not in analytics';
  assert has_function_privilege('authenticated', 'public.whatsapp_start_pairing(uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.whatsapp_settings(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.whatsapp_start_pairing(uuid,text,text)', 'EXECUTE'), 'Member functions grants';
  assert not has_function_privilege('authenticated', 'public.whatsapp_decide(text,text,text,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.whatsapp_pair(text,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.whatsapp_status(text,text,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_whatsapp_deliveries()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.whatsapp_message_sent(uuid,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.whatsapp_decide(text,text,text,text,text)', 'EXECUTE'), 'Webhook functions reachable by clients';
  assert not has_table_privilege('authenticated', 'private.business_whatsapp', 'SELECT')
    and not has_table_privilege('anon', 'private.whatsapp_messages', 'SELECT'), 'WhatsApp tables readable by clients';
end $$;
rollback;
select 'PASS: phone normalisation, member-only pairing with consent, pairing by code from the entered number, one WhatsApp per request, early statuses, forged and misplaced taps refused, one decision per message through decide_booking, app-first and late taps, ended requests skipped, re-pairing and former members refused, disable, code limit, analytics without numbers, grants; all fixtures rolled back' as result;
