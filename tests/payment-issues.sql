-- Payments that need a person (audit 28. 9., H1): every kind shows up for an admin and for nobody else, each
-- admin hears about a new one once, and nothing here changes money. Everything rolls back.
-- Run against a migrated database with the demo seed (it copies one demo venue as the template).
begin;
-- No worker calls leave the transaction.
delete from private.notification_config where key = 'worker_secret';

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  template public.businesses; venue public.businesses; svc uuid; offer uuid; other_offer uuid; customer uuid; admin_user uuid; admin_mail text;
  refund_failed uuid; refund_stuck uuid; refund_waiting uuid; orphan uuid; fresh_orphan uuid; release uuid; capture uuid; healthy uuid;
  demo_customer uuid; demo_failed uuid;
  booking uuid; issues jsonb; kinds text[]; before_money jsonb; after_money jsonb; notices integer;
begin
  select * into template from public.businesses where status = 'approved' order by created_at limit 1;
  assert template.id is not null, 'Demo venue to copy missing';
  venue := template;
  venue.id := gen_random_uuid(); venue.slug := 'qa-issues-' || venue.id; venue.display_name := 'QA platby k řešení';
  venue.stripe_account_id := 'acct_qa_' || left(venue.id::text, 8); venue.stripe_charges_enabled := true;
  venue.google_place_id := null; venue.pending_moderation_id := null; venue.content_status := 'approved';
  insert into public.businesses select venue.*;
  insert into public.services (business_id, name, category_slug, duration_minutes, normal_price_cents)
  values (venue.id, 'QA služba', venue.category_slug, 60, 100000) returning id into svc;
  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue.id, svc, now() + interval '1 day', now() + interval '25 hours', now() + interval '1 day' - interval '15 minutes',
    100000, 78800, 75000, 3800, 1, 10, 10) returning id into offer;
  -- One active booking per customer and offer: the healthy booking gets a slot of its own.
  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue.id, svc, now() + interval '2 days', now() + interval '49 hours', now() + interval '2 days' - interval '15 minutes',
    100000, 78800, 75000, 3800, 1, 10, 10) returning id into other_offer;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'qa-issues-customer@example.invalid', 'x', now(),
    '{"provider": "email", "providers": ["email"]}', '{"first_name": "QA", "last_name": "Zákazník"}', now(), now())
  returning id into customer;
  admin_mail := 'qa-issues-admin-' || left(gen_random_uuid()::text, 8) || '@example.invalid';
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', admin_mail, 'x', now(),
    '{"provider": "email", "providers": ["email"]}', '{"first_name": "QA", "last_name": "Admin"}', now(), now())
  returning id into admin_user;
  insert into public.user_roles (user_id, role) values (admin_user, 'admin');
  select id into demo_customer from auth.users where email like '%@flek.test' and id not in (select user_id from public.user_roles) limit 1;
  assert demo_customer is not null, 'Demo account missing';

  -- One payment per kind, plus a healthy one that must never appear.
  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, paid_at, payment_intent_id, livemode,
    refund_requested_at, refund_status, refund_error, refund_id)
  values (customer, offer, 78800, 'stripe', 'paid', now() - interval '2 days', 'pi_qa_failed', false,
    now() - interval '1 day', 'failed', 'expired_or_canceled_card', 're_qa_failed') returning id into refund_failed;
  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, paid_at, payment_intent_id, livemode,
    refund_requested_at, refund_attempts, refund_error)
  values (customer, offer, 78800, 'stripe', 'paid', now() - interval '2 days', 'pi_qa_stuck', false,
    now() - interval '1 day', 8, 'Stripe unavailable') returning id into refund_stuck;
  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, paid_at, payment_intent_id, livemode,
    refund_requested_at, refund_status, refund_id)
  values (customer, offer, 78800, 'stripe', 'paid', now() - interval '5 days', 'pi_qa_waiting', false,
    now() - interval '4 days', 'pending', 're_qa_waiting') returning id into refund_waiting;
  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, paid_at, payment_intent_id, livemode)
  values (customer, offer, 78800, 'stripe', 'paid', now() - interval '2 hours', 'pi_qa_orphan', false) returning id into orphan;
  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, paid_at, payment_intent_id, livemode)
  values (customer, offer, 78800, 'stripe', 'paid', now() - interval '20 minutes', 'pi_qa_fresh', false) returning id into fresh_orphan;

  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, payment_intent_id, livemode, confirmation_version,
    authorization_state, failure_reason, created_at)
  values (customer, offer, 78800, 'stripe', 'pending', 'pi_qa_release', false, 1, 'release_pending', 'CONFIRMATION_TIMEOUT',
    now() - interval '3 hours') returning id into release;
  insert into public.bookings (offer_id, business_id, customer_id, reservation_code, price_cents, service_name_snapshot, business_name_snapshot,
    business_address_snapshot, start_at_snapshot, end_at_snapshot, original_price_cents_snapshot, payment_id, merchant_payout_cents,
    service_fee_cents, fee_policy_version, status, confirmation_version, authorized_at, cancelled_at, capacity_released_at)
  select offer, venue.id, customer, 'FLEK-QAI' || upper(left(md5(random()::text), 5)), 78800, 'QA služba', venue.display_name, 'Adresa',
    start_at, end_at, 100000, release, 75000, 3800, 1, 'expired', 1, now() - interval '3 hours', now() - interval '2 hours', now() - interval '2 hours'
  from public.offers where id = offer;
  insert into private.confirmation_jobs (payment_id, action, attempts, last_error, available_at)
  values (release, 'cancel', 8, 'STRIPE_TIMEOUT', now() - interval '1 hour');

  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, payment_intent_id, livemode, confirmation_version,
    authorization_state)
  values (customer, offer, 78800, 'stripe', 'pending', 'pi_qa_capture', false, 1, 'authorized') returning id into capture;
  insert into public.bookings (offer_id, business_id, customer_id, reservation_code, price_cents, service_name_snapshot, business_name_snapshot,
    business_address_snapshot, start_at_snapshot, end_at_snapshot, original_price_cents_snapshot, payment_id, merchant_payout_cents,
    service_fee_cents, fee_policy_version, status, confirmation_version, authorized_at, merchant_decided_at)
  select offer, venue.id, customer, 'FLEK-QAI' || upper(left(md5(random()::text), 5)), 78800, 'QA služba', venue.display_name, 'Adresa',
    start_at, end_at, 100000, capture, 75000, 3800, 1, 'capturing', 1, now() - interval '40 minutes', now() - interval '30 minutes'
  from public.offers where id = offer;
  insert into private.confirmation_jobs (payment_id, action, attempts, last_error) values (capture, 'capture', 3, 'STRIPE_PROCESSING');

  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, paid_at, payment_intent_id, livemode)
  values (customer, other_offer, 78800, 'stripe', 'paid', now() - interval '3 hours', 'pi_qa_healthy', false) returning id into healthy;
  insert into public.bookings (offer_id, business_id, customer_id, reservation_code, price_cents, service_name_snapshot, business_name_snapshot,
    business_address_snapshot, start_at_snapshot, end_at_snapshot, original_price_cents_snapshot, payment_id, merchant_payout_cents,
    service_fee_cents, fee_policy_version, status, confirmed_at)
  select other_offer, venue.id, customer, 'FLEK-QAI' || upper(left(md5(random()::text), 5)), 78800, 'QA služba', venue.display_name, 'Adresa',
    start_at, end_at, 100000, healthy, 75000, 3800, 1, 'confirmed', now() from public.offers where id = other_offer
  returning id into booking;

  -- The acceptance checks fail a demo refund on purpose: listed for the admin, never e-mailed.
  insert into public.payments (customer_id, offer_id, amount_cents, provider, status, paid_at, payment_intent_id, livemode,
    refund_requested_at, refund_status, refund_error, refund_id)
  values (demo_customer, offer, 78800, 'stripe', 'paid', now() - interval '2 days', 'pi_qa_demo_failed', false,
    now() - interval '1 day', 'failed', 'test_refund_failure', 're_qa_demo') returning id into demo_failed;

  insert into private.stripe_events (id, type, livemode, received_at, error)
  values ('evt_qa_failed', 'refund.updated', false, now() - interval '2 hours', 'stripe_refund_update: boom');
  insert into private.stripe_events (id, type, livemode, received_at, error, processed_at)
  values ('evt_qa_done', 'refund.updated', false, now() - interval '2 hours', null, now() - interval '2 hours');

  before_money := (select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p where p.customer_id = customer);

  -- A customer (not an admin) is refused; anon cannot even call it.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', customer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  assert pg_temp.err('select public.admin_payment_issues()') = 'FORBIDDEN', 'A customer read the payment issues';
  execute 'reset role';
  execute 'set local role anon';
  assert pg_temp.err('select public.admin_payment_issues()') like 'permission denied%', 'Anon reached the payment issues';
  execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  issues := public.admin_payment_issues();
  execute 'reset role';
  select array_agg(i->>'kind' order by i->>'kind') into kinds from jsonb_array_elements(issues) i
  where i->>'ref' in (refund_failed::text, refund_stuck::text, refund_waiting::text, orphan::text, release::text, capture::text, 'evt_qa_failed');
  assert kinds = array['capture_stuck', 'paid_without_booking', 'refund_failed', 'refund_stuck', 'refund_waiting', 'release_stuck', 'webhook_failed'],
    format('Issue kinds: %s', kinds);
  assert not exists (select 1 from jsonb_array_elements(issues) i
                     where i->>'ref' in (healthy::text, fresh_orphan::text, 'evt_qa_done')), 'A healthy payment is listed as an issue';
  assert exists (select 1 from jsonb_array_elements(issues) i where i->>'ref' = demo_failed::text and i->>'kind' = 'refund_failed'),
    'A demo account''s failed refund is not listed';
  assert exists (select 1 from jsonb_array_elements(issues) i where i->>'ref' = refund_failed::text
                 and i->>'detail' = 'expired_or_canceled_card' and i->>'customer_email' = 'qa-issues-customer@example.invalid'
                 and i->>'payment_intent_id' = 'pi_qa_failed' and (i->>'livemode')::boolean = false and (i->>'amount_cents')::int = 78800),
    'A failed refund lacks what the admin needs to act';
  assert exists (select 1 from jsonb_array_elements(issues) i where i->>'ref' = release::text
                 and (i->>'attempts')::int = 8 and i->>'detail' = 'STRIPE_TIMEOUT'), 'A stuck release lacks its job state';

  -- The five-minute maintenance tells each admin once; a second run is silent.
  perform set_config('request.jwt.claims', '', true);
  perform private.flek_stripe_maintenance();
  select count(*) into notices from public.notifications where user_id = admin_user and event = 'account' and href = '/admin/platby';
  assert notices = 1, format('The admin got %s notices instead of one', notices);
  assert not exists (select 1 from private.payment_issue_notices where ref = demo_failed::text), 'A demo test payment was e-mailed';
  assert exists (select 1 from private.notification_delivery d join public.notifications n on n.id = d.notification_id
                 where n.user_id = admin_user and n.href = '/admin/platby' and d.channel = 'email' and d.target = admin_mail),
    'The notice was not queued as an e-mail';
  perform private.flek_stripe_maintenance();
  assert (select count(*) from public.notifications where user_id = admin_user and href = '/admin/platby') = 1, 'The same issues were told twice';

  -- A resolved issue is forgotten, so the same payment failing again later is news again.
  update public.payments set status = 'refunded', refund_status = 'succeeded' where id = refund_failed;
  perform private.notice_payment_issues();
  assert not exists (select 1 from private.payment_issue_notices where ref = refund_failed::text), 'A resolved issue is still remembered';
  update public.payments set status = 'paid', refund_status = 'failed' where id = refund_failed;
  assert private.notice_payment_issues() = 1, 'A payment failing again is not news';

  -- Nothing about the money moved, except what the hourly safety net always did: the orphan's refund request.
  after_money := (select jsonb_agg(to_jsonb(p) - 'refund_requested_at' - 'failure_reason' - 'status' - 'refund_status' order by p.id)
                  from public.payments p where p.customer_id = customer);
  assert after_money = (select jsonb_agg(p.value - 'refund_requested_at' - 'failure_reason' - 'status' - 'refund_status' order by p.value->>'id')
                        from jsonb_array_elements(before_money) p), 'Payment issues changed a payment';
  assert (select refund_requested_at is not null and failure_reason = 'NO_BOOKING' from public.payments where id = orphan),
    'The orphan was not queued for its refund';
  assert not has_function_privilege('authenticated', 'private.payment_issues()', 'EXECUTE')
     and not has_function_privilege('authenticated', 'private.notice_payment_issues()', 'EXECUTE')
     and not has_table_privilege('authenticated', 'private.payment_issue_notices', 'SELECT'), 'A client reaches the private helpers';
end $$;

rollback;
select 'PASS: seven kinds of payments that need a person, only for admins, one e-mail per new issue and admin (demo test payments listed, not e-mailed), resolved issues forgotten, no money changed; all fixtures rolled back' as result;
