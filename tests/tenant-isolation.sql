-- Tenant isolation (audit scenarios G, H, I, J): a venue never reaches another venue's data, a customer never
-- reaches another customer's, nobody but an admin runs an admin RPC, and a member of two venues sees each one
-- only as itself. Every check runs as the app does: role authenticated (or anon) with JWT claims, so grants and
-- RLS are in force. Fixtures are QA users and venues of their own; everything rolls back.
-- Run against a migrated database with the demo seed (it copies one demo venue as the template).
begin;
-- No worker calls leave the transaction.
delete from private.notification_config where key = 'worker_secret';

-- Runs a statement with the caller's rights and returns the error it raised, or null.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ------------------------------------------------------------------------------------ fixtures

do $$
declare
  template public.businesses; venue public.businesses; ids uuid[] := '{}'; u uuid; i integer;
  merchant_a uuid; merchant_b uuid; customer_a uuid; customer_b uuid; dual uuid;
  venue_a uuid; venue_b uuid; venue_c uuid; service_a uuid; service_b uuid; service_c uuid;
  offer_a uuid; offer_b uuid; offer_c uuid; pay uuid; booking_a uuid; booking_b uuid; booking_c uuid; pending_b uuid;
begin
  for i in 1..5 loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      'qa-tenant-' || i || '-' || left(gen_random_uuid()::text, 8) || '@example.invalid', 'x', now(),
      '{"provider": "email", "providers": ["email"]}', jsonb_build_object('first_name', 'QA' || i, 'last_name', 'Tenant'), now(), now())
    returning id into u;
    update public.profiles set phone = '+42077755500' || i where id = u;
    ids := ids || u;
  end loop;
  merchant_a := ids[1]; merchant_b := ids[2]; customer_a := ids[3]; customer_b := ids[4]; dual := ids[5];

  select * into template from public.businesses where status = 'approved' order by created_at limit 1;
  assert template.id is not null, 'Demo venue to copy missing';
  for i in 1..3 loop
    venue := template;
    venue.id := gen_random_uuid(); venue.slug := 'qa-tenant-' || venue.id; venue.display_name := 'QA provozovna ' || i;
    venue.status := 'approved'; venue.stripe_account_id := 'acct_qa_' || left(venue.id::text, 8); venue.stripe_charges_enabled := true;
    venue.google_place_id := null; venue.pending_moderation_id := null; venue.content_status := 'approved';
    insert into public.businesses select venue.*;
    if i = 1 then venue_a := venue.id; elsif i = 2 then venue_b := venue.id; else venue_c := venue.id; end if;
  end loop;
  insert into public.business_members (business_id, user_id) values
    (venue_a, merchant_a), (venue_b, merchant_b), (venue_a, dual), (venue_c, dual);
  insert into public.business_billing (business_id, ico, bank_account) values (venue_b, '27082440', 'CZ6508000000192000145399');

  insert into public.services (business_id, name, category_slug, duration_minutes, normal_price_cents)
  values (venue_a, 'QA služba A', template.category_slug, 60, 100000) returning id into service_a;
  insert into public.services (business_id, name, category_slug, duration_minutes, normal_price_cents)
  values (venue_b, 'QA služba B', template.category_slug, 60, 100000) returning id into service_b;
  insert into public.services (business_id, name, category_slug, duration_minutes, normal_price_cents)
  values (venue_c, 'QA služba C', template.category_slug, 60, 100000) returning id into service_c;

  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue_a, service_a, now() + interval '1 day', now() + interval '25 hours', now() + interval '1 day' - interval '15 minutes',
    100000, 78800, 75000, 3800, 1, 3, 2) returning id into offer_a;
  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue_b, service_b, now() + interval '1 day', now() + interval '25 hours', now() + interval '1 day' - interval '15 minutes',
    100000, 78800, 75000, 3800, 1, 3, 1) returning id into offer_b;
  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue_c, service_c, now() + interval '1 day', now() + interval '25 hours', now() + interval '1 day' - interval '15 minutes',
    100000, 78800, 75000, 3800, 1, 3, 2) returning id into offer_c;

  -- customer A: a confirmed booking at venue A; customer B: a confirmed booking and a waiting request at venue B.
  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, paid_at, destination_account_id, application_fee_cents)
  values (customer_a, offer_a, 78800, 'stripe', 'paid', now(), 'acct_qa_a', 3800) returning id into pay;
  insert into public.bookings (offer_id, business_id, customer_id, reservation_code, price_cents, service_name_snapshot, business_name_snapshot,
    business_address_snapshot, start_at_snapshot, end_at_snapshot, original_price_cents_snapshot, payment_id, merchant_payout_cents,
    service_fee_cents, fee_policy_version, status, confirmed_at)
  select offer_a, venue_a, customer_a, 'FLEK-QAT' || upper(left(md5(random()::text), 5)), 78800, 'QA služba A', 'QA provozovna 1', 'Adresa',
    start_at, end_at, 100000, pay, 75000, 3800, 1, 'confirmed', now() from public.offers where id = offer_a
  returning id into booking_a;

  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, paid_at, destination_account_id, application_fee_cents)
  values (customer_b, offer_b, 78800, 'stripe', 'paid', now(), 'acct_qa_b', 3800) returning id into pay;
  perform set_config('qa.payment_b', pay::text, true);
  insert into public.bookings (offer_id, business_id, customer_id, reservation_code, price_cents, service_name_snapshot, business_name_snapshot,
    business_address_snapshot, start_at_snapshot, end_at_snapshot, original_price_cents_snapshot, payment_id, merchant_payout_cents,
    service_fee_cents, fee_policy_version, status, confirmed_at)
  select offer_b, venue_b, customer_b, 'FLEK-QAT' || upper(left(md5(random()::text), 5)), 78800, 'QA služba B', 'QA provozovna 2', 'Adresa',
    start_at, end_at, 100000, pay, 75000, 3800, 1, 'confirmed', now() from public.offers where id = offer_b
  returning id into booking_b;

  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, destination_account_id, application_fee_cents,
    confirmation_version, authorization_state)
  values (customer_a, offer_b, 78800, 'stripe', 'pending', 'acct_qa_b', 3800, 1, 'authorized') returning id into pay;
  insert into public.bookings (offer_id, business_id, customer_id, reservation_code, price_cents, service_name_snapshot, business_name_snapshot,
    business_address_snapshot, start_at_snapshot, end_at_snapshot, original_price_cents_snapshot, payment_id, merchant_payout_cents,
    service_fee_cents, fee_policy_version, status, confirmation_version, authorized_at, confirmation_expires_at)
  select offer_b, venue_b, customer_a, 'FLEK-QAT' || upper(left(md5(random()::text), 5)), 78800, 'QA služba B', 'QA provozovna 2', 'Adresa',
    start_at, end_at, 100000, pay, 75000, 3800, 1, 'pending_merchant', 1, now(), now() + interval '10 minutes' from public.offers where id = offer_b
  returning id into pending_b;

  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, paid_at, destination_account_id, application_fee_cents)
  values (customer_b, offer_c, 78800, 'stripe', 'paid', now(), 'acct_qa_c', 3800) returning id into pay;
  insert into public.bookings (offer_id, business_id, customer_id, reservation_code, price_cents, service_name_snapshot, business_name_snapshot,
    business_address_snapshot, start_at_snapshot, end_at_snapshot, original_price_cents_snapshot, payment_id, merchant_payout_cents,
    service_fee_cents, fee_policy_version, status, confirmed_at)
  select offer_c, venue_c, customer_b, 'FLEK-QAT' || upper(left(md5(random()::text), 5)), 78800, 'QA služba C', 'QA provozovna 3', 'Adresa',
    start_at, end_at, 100000, pay, 75000, 3800, 1, 'confirmed', now() from public.offers where id = offer_c
  returning id into booking_c;

  perform set_config('qa.merchant_a', merchant_a::text, true);
  perform set_config('qa.merchant_b', merchant_b::text, true);
  perform set_config('qa.customer_a', customer_a::text, true);
  perform set_config('qa.customer_b', customer_b::text, true);
  perform set_config('qa.dual', dual::text, true);
  perform set_config('qa.venue_a', venue_a::text, true);
  perform set_config('qa.venue_b', venue_b::text, true);
  perform set_config('qa.venue_c', venue_c::text, true);
  perform set_config('qa.service_b', service_b::text, true);
  perform set_config('qa.offer_b', offer_b::text, true);
  perform set_config('qa.booking_a', booking_a::text, true);
  perform set_config('qa.booking_b', booking_b::text, true);
  perform set_config('qa.booking_c', booking_c::text, true);
  perform set_config('qa.pending_b', pending_b::text, true);
  perform set_config('qa.code_b', (select reservation_code from public.bookings where id = booking_b), true);
end $$;

-- ------------------------------------------------------------- G: venue A reaches for venue B

select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('qa.merchant_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  venue_b text := quote_literal(current_setting('qa.venue_b'));
  booking_b text := quote_literal(current_setting('qa.booking_b'));
  pending_b text := quote_literal(current_setting('qa.pending_b'));
  offer_b text := quote_literal(current_setting('qa.offer_b'));
  service_b text := quote_literal(current_setting('qa.service_b'));
  call text; e text;
begin
  foreach call in array array[
    format('select public.merchant_bookings(%s::uuid)', venue_b),
    format('select public.merchant_offers(%s::uuid, null, null)', venue_b),
    format('select public.merchant_metrics(%s::uuid)', venue_b),
    format('select public.respond_to_booking(%s::uuid, true)', pending_b),
    format('select public.respond_to_booking(%s::uuid, false)', pending_b),
    format('select public.merchant_resolve_booking(%s::uuid, %L)', booking_b, 'completed'),
    format('select public.merchant_cancel_offer(%s::uuid, %L)', offer_b, 'QA cizí nabídka'),
    format('select public.update_offer(%s::uuid, %L::jsonb)', offer_b, '{"capacity_total": 5}'),
    format('select public.publish_flek(%s::uuid, now() + interval %L, 50000)', service_b, '2 days'),
    format('select public.save_service(%s::uuid, %L::jsonb, %s::uuid)', venue_b, '{"name": "QA přepis"}', service_b),
    format('select public.save_service(%s::uuid, %L::jsonb)', venue_b, '{"name": "QA nová"}'),
    format('select public.update_business(%s::uuid, %L::jsonb)', venue_b, '{"phone": "+420777000000"}'),
    format('select public.business_billing_get(%s::uuid)', venue_b),
    format('select public.business_billing_save(%s::uuid, %L::jsonb)', venue_b, '{"bank_account": "CZ0000000000000000000000"}'),
    format('select public.business_payments_status(%s::uuid)', venue_b),
    format('select public.confirmation_details(%s::uuid)', venue_b),
    format('select public.accept_merchant_terms(%s::uuid, %L)', venue_b, '1.0'),
    format('select public.whatsapp_settings(%s::uuid)', venue_b),
    format('select public.whatsapp_disable(%s::uuid)', venue_b),
    format('select public.whatsapp_start_pairing(%s::uuid, null, null, null)', venue_b),
    format('select public.save_notification_preference(%s, %L, true, true, true)', venue_b, 'requested')
  ] loop
    e := pg_temp.err(call);
    assert e = 'FORBIDDEN', format('G: %s answered %s', call, coalesce(e, 'without an error'));
  end loop;

  assert public.merchant_booking_detail(current_setting('qa.booking_b')::uuid) is null, 'G: booking detail of another venue';
  assert public.merchant_lookup_booking(current_setting('qa.code_b')) is null, 'G: another venue''s code was found';

  assert (select count(*) from public.bookings where business_id = current_setting('qa.venue_b')::uuid) = 0, 'G: bookings table leaks';
  assert (select count(*) from public.offers where business_id = current_setting('qa.venue_b')::uuid) = 0, 'G: offers table leaks';
  assert (select count(*) from public.services where business_id = current_setting('qa.venue_b')::uuid) = 0, 'G: services table leaks';
  assert (select count(*) from public.businesses where id = current_setting('qa.venue_b')::uuid) = 0, 'G: businesses table leaks';
  assert (select count(*) from public.business_billing where business_id = current_setting('qa.venue_b')::uuid) = 0, 'G: billing leaks';
  assert (select count(*) from public.business_members where business_id = current_setting('qa.venue_b')::uuid) = 0, 'G: members leak';
  assert (select count(*) from public.payments where customer_id <> current_setting('qa.merchant_a')::uuid) = 0, 'G: payments leak';
  assert (select count(*) from public.profiles where id <> current_setting('qa.merchant_a')::uuid) = 0, 'G: profiles leak';
  -- The venue's own data is still there, so the zeros above are isolation and not a broken fixture.
  assert (select count(*) from public.bookings where business_id = current_setting('qa.venue_a')::uuid) = 1, 'G: own bookings missing';
  assert jsonb_typeof(public.business_billing_get(current_setting('qa.venue_a')::uuid)) = 'object', 'G: own billing missing';
end $$;
reset role;

-- ------------------------------------------- venue B, before and after the customer is agreed

select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('qa.merchant_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare waiting jsonb := public.merchant_booking_detail(current_setting('qa.pending_b')::uuid);
  agreed jsonb := public.merchant_booking_detail(current_setting('qa.booking_b')::uuid);
begin
  assert waiting is not null and not (waiting ?| array['first_name', 'last_name', 'phone']) and waiting->>'reservation_code' is null,
    'A request that is not agreed shows the customer''s name, phone or code to the venue';
  assert agreed ?& array['first_name', 'last_name', 'phone'] and agreed->>'reservation_code' is not null,
    'A confirmed booking lost the customer''s contact for the venue';
  assert (select reservation_code is null from public.merchant_bookings(current_setting('qa.venue_b')::uuid)
          where id = current_setting('qa.pending_b')::uuid), 'The venue list shows a waiting request''s code';
end $$;
reset role;

-- ---------------------------------------------------- H: customer A reaches for customer B

select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('qa.customer_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  booking_b text := quote_literal(current_setting('qa.booking_b'));
  payment_b text := quote_literal(current_setting('qa.payment_b'));
  e text; data jsonb;
begin
  e := pg_temp.err(format('select public.my_payment_state(%s::uuid)', payment_b));
  assert e = 'NOT_FOUND', format('H: my_payment_state of another customer answered %s', coalesce(e, 'without an error'));
  e := pg_temp.err(format('select public.cancel_booking(%s::uuid)', booking_b));
  assert e = 'NOT_FOUND', format('H: cancel_booking of another customer answered %s', coalesce(e, 'without an error'));
  e := pg_temp.err(format('select public.cancel_pending_booking(%s::uuid)', booking_b));
  assert e = 'FORBIDDEN', format('H: cancel_pending_booking of another customer answered %s', coalesce(e, 'without an error'));
  e := pg_temp.err(format('select public.release_unbooked_payment(%s::uuid)', payment_b));
  assert e = 'FORBIDDEN', format('H: release_unbooked_payment of another customer answered %s', coalesce(e, 'without an error'));
  e := pg_temp.err(format('select public.submit_booking_review(%s::uuid, 5, null)', booking_b));
  assert e = 'FORBIDDEN', format('H: review of another customer''s booking answered %s', coalesce(e, 'without an error'));
  e := pg_temp.err(format('select public.rate_booking(%s::uuid, 5)', booking_b));
  assert e = 'FORBIDDEN', format('H: rating another customer''s booking answered %s', coalesce(e, 'without an error'));
  e := pg_temp.err(format('select public.create_booking(%L::uuid, %s::uuid)', current_setting('qa.offer_b'), payment_b));
  assert e = 'PAYMENT_REQUIRED', format('H: booking with another customer''s payment answered %s', coalesce(e, 'without an error'));

  assert not exists (select 1 from public.my_bookings() where customer_id <> current_setting('qa.customer_a')::uuid), 'H: my_bookings leaks';
  assert (select count(*) from public.my_bookings()) = 2, 'H: own bookings missing from my_bookings';
  assert not exists (select 1 from public.my_notifications() where user_id <> current_setting('qa.customer_a')::uuid), 'H: notifications leak';
  data := public.export_my_data();
  assert position(current_setting('qa.booking_b') in data::text) = 0 and position(current_setting('qa.customer_b') in data::text) = 0,
    'H: data export carries another customer''s data';
  assert (select count(*) from public.bookings where customer_id <> current_setting('qa.customer_a')::uuid) = 0, 'H: bookings table leaks';
  assert (select count(*) from public.payments where customer_id <> current_setting('qa.customer_a')::uuid) = 0, 'H: payments table leaks';
  assert (select count(*) from public.profiles where id <> current_setting('qa.customer_a')::uuid) = 0, 'H: profiles table leaks';

  -- I: a signed-in customer is not an admin.
  foreach e in array array[
    'select public.admin_audit_log(10)', 'select public.admin_bookings(null, 10)', 'select public.admin_businesses(null)',
    'select public.admin_content_moderation(null)', 'select public.admin_content_reports(null)', 'select public.admin_dac7_report(2026)',
    'select public.admin_metrics()', 'select public.admin_offers(null, 10)',
    format('select public.admin_resolve_content_moderation(%L::uuid, %L, %L)', gen_random_uuid(), 'approve', 'QA'),
    format('select public.admin_resolve_content_report(%L::uuid, %L, %L)', gen_random_uuid(), 'resolved', 'QA'),
    format('select public.admin_set_booking_block(%L::uuid, true, false, %L)', current_setting('qa.customer_b'), 'QA blokace'),
    format('select public.admin_set_business_status(%L::uuid, %L, %L)', current_setting('qa.venue_b'), 'suspended', 'QA pozastavení'),
    format('select public.admin_set_google_place_id(%L::uuid, %L)', current_setting('qa.venue_b'), 'ChIJ-qa'),
    'select public.admin_set_whatsapp_display_number(''+420777000000'')', 'select public.admin_set_whatsapp_enabled(true)',
    'select public.admin_user_lookup(''demo'')', 'select public.admin_whatsapp_state()', 'select public.admin_payment_issues()'
  ] loop
    data := to_jsonb(pg_temp.err(e));
    assert data #>> '{}' = 'FORBIDDEN', format('I: %s answered %s', e, coalesce(data #>> '{}', 'without an error'));
  end loop;
end $$;
reset role;

-- ------------------------------------------------------------ anon: nothing but public reads

select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
do $$
declare t text; e text;
begin
  foreach t in array array['bookings', 'payments', 'profiles', 'businesses', 'offers', 'services', 'business_billing',
    'business_members', 'notifications', 'admin_audit_log', 'content_reports', 'customer_booking_details', 'merchant_booking_rows'] loop
    e := pg_temp.err(format('select count(*) from public.%I', t));
    assert e like 'permission denied%', format('anon: %s answered %s', t, coalesce(e, 'rows'));
  end loop;
  e := pg_temp.err('select public.my_bookings()');
  assert e like 'permission denied%', format('anon: my_bookings answered %s', coalesce(e, 'rows'));
  e := pg_temp.err('select public.admin_metrics()');
  assert e like 'permission denied%', format('anon: admin_metrics answered %s', coalesce(e, 'rows'));
  e := pg_temp.err(format('select public.merchant_bookings(%L::uuid)', current_setting('qa.venue_b')));
  assert e like 'permission denied%', format('anon: merchant_bookings answered %s', coalesce(e, 'rows'));
end $$;
reset role;

-- ------------------------------------------------ J: one person, two venues, never mixed

select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('qa.dual'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  assert (select count(*) from public.my_businesses()) = 2, 'J: a member of two venues does not see both';
  assert (select count(*) from public.merchant_bookings(current_setting('qa.venue_a')::uuid)) = 1
     and not exists (select 1 from public.merchant_bookings(current_setting('qa.venue_a')::uuid) where business_id <> current_setting('qa.venue_a')::uuid),
    'J: venue A''s list is not venue A alone';
  assert (select count(*) from public.merchant_bookings(current_setting('qa.venue_c')::uuid)) = 1
     and not exists (select 1 from public.merchant_bookings(current_setting('qa.venue_c')::uuid) where business_id <> current_setting('qa.venue_c')::uuid),
    'J: venue C''s list is not venue C alone';
  assert pg_temp.err(format('select public.merchant_bookings(%L::uuid)', current_setting('qa.venue_b'))) = 'FORBIDDEN',
    'J: two memberships opened a third venue';
end $$;
reset role;

rollback;
select 'PASS: venues isolated from each other (21 RPCs, 8 tables), customers from each other (7 RPCs, read models, export, 3 tables), 18 admin RPCs refuse a customer, anon reads nothing private, two memberships stay apart, no contact or code for the venue before agreement; all fixtures rolled back' as result;
