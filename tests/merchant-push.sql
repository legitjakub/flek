-- Privileged regression test for the phone notifications a venue gets without choosing them first.
-- Run against a migrated demo database (demo-merchant, demo-5 … demo-7): every fixture is rolled back.
-- No push is sent: only what private.booking_notification queues is checked.
begin;
-- No worker calls leave the transaction.
delete from private.notification_config where key = 'worker_secret';
insert into private.settings (key, value) values ('manual_confirmation_enabled', 'demo')
  on conflict (key) do update set value = 'demo';

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
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
-- Push deliveries queued about a booking, for the venue or for the customer, for one event.
create function pg_temp.pushes(p_booking uuid, p_venue boolean, p_event text) returns integer language sql as $$
  select count(*)::integer from private.notification_delivery d join public.notifications n on n.id = d.notification_id
  where n.booking_id = p_booking and d.channel = 'push' and (n.business_id is not null) = p_venue and n.event = p_event
$$;

do $$
declare
  merchant uuid; c uuid[];
  venue public.businesses; svc public.services; offer uuid[] := '{}'; o uuid;
  k public.bookings;
begin
  select id into merchant from auth.users where email = 'demo-merchant@flek.test';
  select array_agg(id order by email) into c from auth.users where email in ('demo-5@flek.test', 'demo-6@flek.test', 'demo-7@flek.test');
  assert merchant is not null and array_length(c, 1) = 3, 'Demo fixtures missing';
  update public.profiles set phone = '+420777123456', booking_blocked = false where id = any(c);

  -- A venue of its own, so no choice the demo venue's members made decides anything.
  select b.* into venue from public.businesses b join public.business_members m on m.business_id = b.id where m.user_id = merchant limit 1;
  venue.id := gen_random_uuid(); venue.slug := 'qa-push-' || venue.id; venue.display_name := 'QA Push';
  venue.status := 'approved'; venue.stripe_account_id := 'acct_qa_' || left(venue.id::text, 8); venue.stripe_charges_enabled := true;
  venue.google_place_id := null; venue.cancellation_window_minutes := 60;
  insert into public.businesses select venue.*;
  insert into public.business_members (business_id, user_id) values (venue.id, merchant);
  insert into public.services (business_id, name, category_slug, duration_minutes, normal_price_cents)
  values (venue.id, 'QA masáž', venue.category_slug, 60, 100000) returning * into svc;
  for i in 1..4 loop
    insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
      merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
    values (venue.id, svc.id, now() + make_interval(hours => 2 + i), now() + make_interval(hours => 3 + i),
      now() + make_interval(hours => 2 + i) - interval '15 minutes', 100000, 78800, 75000, 3800, 1, 1, 1)
    returning id into o;
    offer := offer || o;
  end loop;

  -- A phone registered by the merchant and by the customers, and no choice saved by anyone.
  delete from public.notification_preferences where user_id = merchant and scope = venue.id::text;
  delete from public.notification_preferences where user_id = any(c) and scope = 'customer';
  insert into private.push_subscriptions (user_id, endpoint, subscription)
  select u, 'https://push.example/qa-' || u, jsonb_build_object('endpoint', 'https://push.example/qa-' || u, 'keys', '{}'::jsonb)
  from unnest(array[merchant] || c) u;

  -- 1. A request reaches the venue's phone without the venue ever choosing it.
  k := pg_temp.request(c[1], offer[1], 'pi_qa_push1');
  assert k.status = 'pending_merchant', 'Request not waiting';
  assert pg_temp.pushes(k.id, true, 'requested') = 1, 'No push for the venue''s request by default';

  -- 2. The venue's own answer is not news to the venue; the customer's phone stays off until chosen.
  perform pg_temp.act_as(merchant);
  perform public.respond_to_booking(k.id, true);
  k := pg_temp.captured(k.id);
  assert k.status = 'confirmed', 'Confirmed request not confirmed: ' || k.status;
  assert pg_temp.pushes(k.id, true, 'confirmed') = 0, 'Venue pushed about its own confirmation';
  assert pg_temp.pushes(k.id, false, 'confirmed') = 0, 'Customer pushed without choosing it';

  k := pg_temp.request(c[2], offer[2], 'pi_qa_push2');
  perform pg_temp.act_as(merchant);
  perform public.respond_to_booking(k.id, false);
  assert (select status from public.bookings where id = k.id) = 'rejected', 'Declined request not rejected';
  assert pg_temp.pushes(k.id, true, 'cancelled') = 0, 'Venue pushed about its own refusal';

  -- 3. Something the venue did not do itself, a customer cancelling, does reach it.
  k := pg_temp.request(c[3], offer[3], 'pi_qa_push3');
  perform pg_temp.act_as(merchant);
  perform public.respond_to_booking(k.id, true);
  k := pg_temp.captured(k.id);
  perform pg_temp.act_as(c[3]);
  perform public.cancel_booking(k.id);
  assert (select status from public.bookings where id = k.id) = 'cancelled_by_customer', 'Customer cancellation not recorded';
  assert pg_temp.pushes(k.id, true, 'cancelled') = 1, 'No push for the venue when the customer cancelled';
  assert pg_temp.pushes(k.id, false, 'cancelled') = 0, 'Customer pushed about their own cancellation without choosing it';

  -- 4. A venue that switched the phone off for requests stays switched off.
  perform pg_temp.act_as(merchant);
  perform public.save_notification_preference(venue.id::text, 'requested', true, false, true);
  k := pg_temp.request(c[1], offer[4], 'pi_qa_push4');
  assert k.status = 'pending_merchant' and pg_temp.pushes(k.id, true, 'requested') = 0, 'Push despite the venue''s choice';
end $$;

rollback;
