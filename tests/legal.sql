-- Privileged regression test for the legal minimum: every fixture and side effect is rolled back.
-- Run against a migrated demo database (demo-admin, demo-merchant, demo-merchant2, demo-5, demo-6).
begin;
-- No worker calls leave the transaction.
delete from private.notification_config where key = 'worker_secret';
insert into private.settings (key, value) values ('manual_confirmation_enabled', 'demo')
  on conflict (key) do update set value = 'demo';

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

do $$
declare
  admin_user uuid; merchant uuid; other_merchant uuid; customer uuid; other_customer uuid; real_venue uuid;
  venue public.businesses; svc public.services; o uuid; pay public.payments; r jsonb; report uuid; paid record;
begin
  select id into admin_user from auth.users where email = 'demo-admin@flek.test';
  select id into merchant from auth.users where email = 'demo-merchant@flek.test';
  select id into other_merchant from auth.users where email = 'demo-merchant2@flek.test';
  select id into customer from auth.users where email = 'demo-5@flek.test';
  select id into other_customer from auth.users where email = 'demo-6@flek.test';
  assert admin_user is not null and merchant is not null and other_merchant is not null and customer is not null and other_customer is not null,
    'Demo fixtures missing';
  update public.profiles set phone = '+420777123456', booking_blocked = false, no_show_override_until = now() + interval '1 day'
  where id in (customer, other_customer);

  -- A venue of our own, so nothing depends on the demo inventory. Its offer is inserted as a scheduled job would: without a user.
  select b.* into venue from public.businesses b join public.business_members m on m.business_id = b.id where m.user_id = merchant limit 1;
  venue.id := gen_random_uuid(); venue.slug := 'qa-legal-' || venue.id; venue.display_name := 'QA Právo';
  venue.status := 'approved'; venue.stripe_account_id := 'acct_qa_' || left(venue.id::text, 8); venue.stripe_charges_enabled := true;
  venue.google_place_id := null; venue.cancellation_window_minutes := 60;
  insert into public.businesses select venue.*;
  insert into public.business_members (business_id, user_id) values (venue.id, merchant);
  insert into public.services (business_id, name, category_slug, duration_minutes, normal_price_cents)
  values (venue.id, 'QA střih', venue.category_slug, 60, 100000) returning * into svc;
  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue.id, svc.id, now() + interval '3 hours', now() + interval '4 hours', now() + interval '165 minutes', 100000, 78800, 75000, 3800, 1, 2, 2)
  returning id into o;

  -- 1. Nothing is in force yet: nothing is enforced and no consent is recorded.
  assert (public.legal_info()->'documents'->'customer_terms'->>'version') is null, 'Terms in force before publishing';
  perform pg_temp.act_as(customer);
  pay := public.start_payment(o);
  assert pay.id is not null and not exists (select 1 from private.legal_acceptances where user_id = customer and kind = 'customer_terms'),
    'Consent recorded without terms in force';
  perform public.cancel_pending_booking((select id from public.bookings where payment_id = pay.id));

  -- 2. Publishing: operator details and all four documents in force.
  insert into private.settings (key, value) values
    ('operator_name', 'QA Provozovatel'), ('operator_ico', '12345678'), ('operator_address', 'Ulice 1, 110 00 Praha'), ('support_email', 'qa@example.cz')
  on conflict (key) do update set value = excluded.value;
  update public.legal_documents set effective_at = now() - interval '1 minute' where version = '1.0';
  r := public.legal_info();
  assert r->'operator'->>'ico' = '12345678' and r->'documents'->'customer_terms'->>'version' = '1.0'
    and r->'documents'->'merchant_terms'->>'version' = '1.0' and r->'documents'->'privacy'->>'upcoming_version' is null,
    'legal_info after publishing: ' || r::text;

  -- 3. A customer pays only with the version in force, and the server records the consent once.
  perform pg_temp.act_as(other_customer);
  assert pg_temp.raises(format('select public.start_payment(%L)', o)) = 'TERMS_OUTDATED', 'Payment without consent';
  assert pg_temp.raises(format('select public.start_payment(%L, %L)', o, '0.9')) = 'TERMS_OUTDATED', 'Payment with a stale version';
  pay := public.start_payment(o, '1.0');
  assert exists (select 1 from private.legal_acceptances where user_id = other_customer and kind = 'customer_terms' and version = '1.0' and source = 'booking'),
    'Consent not recorded';
  perform public.start_payment(o, '1.0');
  assert (select count(*) from private.legal_acceptances where user_id = other_customer and kind = 'customer_terms') = 1, 'Consent recorded twice';

  -- 4. A venue publishes only after a member accepted the merchant terms in force.
  perform pg_temp.act_as(merchant);
  assert pg_temp.raises(format('select public.publish_flek(%L, %L, 50000, 1)', svc.id, now() + interval '5 hours')) = 'TERMS_OUTDATED',
    'Published without merchant terms';
  perform pg_temp.act_as(other_merchant);
  assert pg_temp.raises(format('select public.accept_merchant_terms(%L, %L)', venue.id, '1.0')) = 'FORBIDDEN', 'Another venue accepted the terms';
  perform pg_temp.act_as(merchant);
  assert pg_temp.raises(format('select public.accept_merchant_terms(%L, %L)', venue.id, '0.9')) = 'TERMS_OUTDATED', 'Stale merchant terms accepted';
  r := public.accept_merchant_terms(venue.id, '1.0');
  assert (r->>'terms_accepted_current')::boolean and r->>'terms_version' = '1.0' and r->>'terms_current' = '1.0', 'Merchant acceptance: ' || r::text;
  assert (public.publish_flek(svc.id, now() + interval '5 hours', 50000, 1)).id is not null, 'Publishing after acceptance failed';

  -- 5. Provider and DAC7 details: a birth date only for a natural person of age, terms with their version.
  assert pg_temp.raises(format('select public.business_billing_save(%L, %L::jsonb)', venue.id,
    jsonb_build_object('seller_type', 'individual', 'birth_date', to_char(now() - interval '17 years', 'YYYY-MM-DD')))) = 'VALIDATION_ERROR',
    'Under-age birth date accepted';
  assert pg_temp.raises(format('select public.business_billing_save(%L, %L::jsonb)', venue.id,
    jsonb_build_object('seller_type', 'entity', 'birth_date', '1990-01-31'))) = 'VALIDATION_ERROR', 'Birth date on a legal entity';
  r := public.business_billing_save(venue.id, jsonb_build_object('legal_name', 'QA Právo s.r.o.', 'ico', '87654321', 'seller_type', 'individual',
    'birth_date', '1990-01-31', 'country', 'cz', 'billing_address_line', 'Korunní 1', 'billing_city', 'Praha', 'billing_postal_code', '12000',
    'terms_accepted', true, 'terms_version', '1.0'));
  assert r->>'seller_type' = 'individual' and r->>'birth_date' = '1990-01-31' and r->>'country' = 'CZ'
    and (r->>'terms_accepted_current')::boolean and r->>'terms_accepted_at' is not null, 'Billing save: ' || r::text;
  r := public.business_billing_save(venue.id, jsonb_build_object('seller_type', 'entity'));
  assert r->>'birth_date' is null and r->>'seller_type' = 'entity', 'Birth date kept for a legal entity';
  assert pg_temp.raises(format('select public.business_billing_save(%L, %L::jsonb)', venue.id,
    jsonb_build_object('terms_accepted', true, 'terms_version', '0.9'))) = 'TERMS_OUTDATED', 'Stale terms in the billing form';

  -- 6. The customer sees who provides the service and never bank, contact or birth details; the demo says it is one.
  r := public.business_provider(venue.id);
  assert r->>'name' = 'QA Právo s.r.o.' and r->>'ico' = '87654321' and r->>'address' = 'Korunní 1, 12000 Praha'
    and (r->>'demo')::boolean and not (r ? 'bank_account') and not (r ? 'birth_date') and not (r ? 'contact_phone'), 'Provider: ' || r::text;

  -- 7. A real venue goes live only with its IČO; the demo does not need one.
  perform pg_temp.act_as(admin_user);
  select b.id into real_venue from public.businesses b where b.status = 'approved' and not private.is_demo_business(b.id) limit 1;
  if real_venue is not null then
    assert not (public.business_provider(real_venue)->>'demo')::boolean, 'Real venue flagged as demo';
    update public.business_billing set ico = null where business_id = real_venue;
    perform public.admin_set_business_status(real_venue, 'suspended', 'QA pozastavení');
    assert pg_temp.raises(format('select public.admin_set_business_status(%L, %L)', real_venue, 'approved')) = 'PROVIDER_DETAILS_REQUIRED',
      'Real venue approved without IČO';
  end if;
  perform public.admin_set_business_status(venue.id, 'suspended', 'QA pozastavení');
  perform public.admin_set_business_status(venue.id, 'approved');
  assert (select status::text from public.businesses where id = venue.id) = 'approved', 'Demo venue not re-approved';

  -- 8. Notices of illegal content: signed in, validated, limited per day, resolved by an admin with a reason on record.
  perform pg_temp.act_as(customer);
  assert pg_temp.raises(format('select public.report_content(%L, null, %L, %L)', venue.id, 'spam', 'Tohle je špatně.')) = 'VALIDATION_ERROR',
    'Unknown reason accepted';
  assert pg_temp.raises(format('select public.report_content(%L, null, %L, %L)', venue.id, 'misleading', 'krátké')) = 'VALIDATION_ERROR',
    'Too short notice accepted';
  report := public.report_content(null, o, 'misleading', 'Běžná cena neodpovídá ceníku provozovny.');
  assert (select business_id from public.content_reports where id = report) = venue.id, 'Report not tied to the offer''s venue';
  assert pg_temp.raises('select public.admin_content_reports()') = 'FORBIDDEN', 'Customer read the reports';
  insert into public.content_reports (reporter_id, business_id, reason, message)
  select customer, venue.id, 'other', 'Hromadné nahlášení číslo ' || i from generate_series(1, 9) i;
  assert pg_temp.raises(format('select public.report_content(%L, null, %L, %L)', venue.id, 'other', 'Jedenácté nahlášení dnes.')) = 'REPORT_RATE_LIMITED',
    'No daily limit';
  perform pg_temp.act_as(admin_user);
  r := public.admin_content_reports('open');
  assert exists (select 1 from jsonb_array_elements(r) x where x->>'id' = report::text and x->>'reporter_email' = 'demo-5@flek.test'
    and x->>'service_name' = 'QA střih'), 'Admin queue: ' || left(r::text, 300);
  assert pg_temp.raises(format('select public.admin_resolve_content_report(%L, %L, %L)', report, 'actioned', 'x')) = 'VALIDATION_ERROR',
    'Resolution without a reason';
  perform public.admin_resolve_content_report(report, 'actioned', 'Nabídka stažena, běžná cena neodpovídala.');
  assert (select status = 'actioned' and resolved_by = admin_user from public.content_reports where id = report), 'Report not resolved';
  assert exists (select 1 from public.admin_audit_log where action = 'content_report_resolved' and target_id = report), 'Resolution not audited';
  assert pg_temp.raises(format('select public.admin_resolve_content_report(%L, %L, %L)', report, 'dismissed', 'Znovu.')) = 'ALREADY_RESOLVED',
    'Resolved twice';

  -- 9. A customer's export holds their own data only.
  perform pg_temp.act_as(other_customer);
  r := public.export_my_data();
  assert r->'account'->>'email' = 'demo-6@flek.test'
    and jsonb_array_length(r->'bookings') = (select count(*) from public.bookings where customer_id = other_customer)
    and jsonb_array_length(r->'payments') = (select count(*) from public.payments where customer_id = other_customer)
    and exists (select 1 from jsonb_array_elements(r->'legal_acceptances') a where a->>'document' = 'customer_terms' and a->>'version' = '1.0'),
    'Export: ' || left(r::text, 300);
  assert r::text not like '%demo-5@flek.test%', 'Export leaks another customer';

  -- 10. DAC7: live, paid, unrefunded bookings per quarter; test payments do not count; admins only.
  perform pg_temp.act_as(admin_user);
  select k.business_id, k.merchant_payout_cents, p.id as payment_id into paid
  from public.bookings k join public.payments p on p.id = k.payment_id
  where p.provider = 'stripe' and p.status = 'paid' and p.livemode is not true and k.status in ('confirmed', 'completed') limit 1;
  if paid.payment_id is not null then
    r := public.admin_dac7_report(2026);
    assert not exists (select 1 from jsonb_array_elements(r) x where (x->>'business_id')::uuid = paid.business_id
      and (x->>'q3_payout_cents')::bigint > 0), 'Test payments counted';
    update public.payments set livemode = true, paid_at = make_timestamptz(2026, 8, 15, 12, 0, 0, 'Europe/Prague') where id = paid.payment_id;
    r := public.admin_dac7_report(2026);
    assert exists (select 1 from jsonb_array_elements(r) x where (x->>'business_id')::uuid = paid.business_id
      and (x->>'q3_count')::integer >= 1 and (x->>'q3_payout_cents')::bigint >= paid.merchant_payout_cents), 'Live payment missing: ' || left(r::text, 300);
  end if;
  perform pg_temp.act_as(customer);
  assert pg_temp.raises('select public.admin_dac7_report(2026)') = 'FORBIDDEN', 'Customer read the DAC7 report';

  -- 11. Analytics keeps no identifier from the browser.
  perform public.record_event('offer_viewed', 'qa-session-legal', jsonb_build_object('offer_id', o));
  assert not exists (select 1 from public.analytics_events where session_id = 'qa-session-legal')
    and exists (select 1 from public.analytics_events where name = 'offer_viewed' and props->>'offer_id' = o::text and user_id = customer),
    'Analytics stored a browser identifier';

  assert not exists (select 1 from public.analytics_events where session_id is not null and session_id <> 'server'),
    'Old browser identifiers left in analytics';

  -- 12. The customer's e-mail about a booking always goes and carries the contract; a venue's e-mail follows its settings.
  insert into public.offers (business_id, service_id, start_at, end_at, booking_cutoff_at, original_price_cents, deal_price_cents,
    merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining)
  values (venue.id, svc.id, now() + interval '6 hours', now() + interval '7 hours', now() + interval '345 minutes', 100000, 78800, 75000, 3800, 1, 2, 2)
  returning id into o;
  update auth.users set email = 'qa-legal-customer@example.invalid', email_confirmed_at = coalesce(email_confirmed_at, now()) where id = other_customer;
  delete from public.notification_preferences where user_id in (other_customer, merchant);
  insert into public.notification_preferences (user_id, scope, event, email, push, whatsapp) values
    (other_customer, 'customer', 'cancelled', false, false, false),
    (merchant, venue.id::text, 'requested', false, false, false);
  perform pg_temp.act_as(other_customer);
  pay := public.start_payment(o, '1.0');
  assert public.confirmation_authorized(pay.id, 'pi_qa_legal', 'cs_qa_legal', 78800, 'czk', false) = 'pending_merchant', 'Authorisation not accepted';
  perform pg_temp.act_as(merchant);
  perform public.respond_to_booking((select id from public.bookings where payment_id = pay.id), false);
  select n.id into report from public.notifications n join public.bookings k on k.id = n.booking_id
  where k.payment_id = pay.id and n.user_id = other_customer and n.event = 'cancelled' and n.title = 'Podnik rezervaci nepotvrdil';
  assert report is not null, 'Customer not told about the rejection';
  assert exists (select 1 from private.notification_delivery where notification_id = report and channel = 'email' and target = 'qa-legal-customer@example.invalid'),
    'Customer e-mail skipped by a preference';
  insert into private.notification_delivery (notification_id, channel, target)
  select n.id, 'email', 'qa-legal-venue@example.invalid' from public.notifications n join public.bookings k on k.id = n.booking_id
  where k.payment_id = pay.id and n.user_id = merchant and n.event = 'requested';
  r := public.claim_notification_deliveries(array['email']);
  assert exists (select 1 from jsonb_array_elements(r) x where (x->>'notification_id')::uuid = report and (x->>'allowed')::boolean
      and x->'contract'->>'status' = 'rejected' and x->'contract'->>'code' is null and x->'contract'->'provider'->>'name' = 'QA Právo s.r.o.'
      and x->'contract'->>'terms_version' = '1.0' and x->'operator'->>'ico' = '12345678'), 'Customer e-mail job: ' || left(r::text, 400);
  assert exists (select 1 from jsonb_array_elements(r) x where x->>'target' = 'qa-legal-venue@example.invalid' and not (x->>'allowed')::boolean
      and x->'contract' = 'null'::jsonb), 'Venue e-mail preference ignored: ' || left(r::text, 400);

  -- 13. Account notices: a venue hears why it was suspended and that it is live again, a reporter hears the outcome,
  -- a blocked customer hears why; blocking needs a reason. Demo addresses get the notice in the app only.
  assert exists (select 1 from public.notifications where user_id = merchant and business_id = venue.id and event = 'account' and booking_id is null
      and title = 'Provozovna je pozastavená' and body like '%Důvod: QA pozastavení%' and href = '/partner/provozovna'), 'Suspension notice missing';
  assert exists (select 1 from public.notifications where user_id = merchant and business_id = venue.id and event = 'account'
      and title = 'Provozovna je schválená'), 'Approval notice missing';
  assert exists (select 1 from public.notifications where user_id = customer and event = 'account' and business_id is null
      and title = 'Tvoje nahlášení jsme vyřídili' and body like 'Obsah jsme omezili.%' and href = '/profil'), 'Reporter not told';
  perform pg_temp.act_as(admin_user);
  assert pg_temp.raises(format('select public.admin_set_booking_block(%L, true)', other_customer)) = 'VALIDATION_ERROR', 'Blocked without a reason';
  perform public.admin_set_booking_block(other_customer, true, false, 'QA opakované nedostavení');
  assert (select booking_blocked from public.profiles where id = other_customer), 'Customer not blocked';
  assert exists (select 1 from public.admin_audit_log where action = 'booking_block_changed' and target_id = other_customer
      and reason = 'QA opakované nedostavení'), 'Block reason not audited';
  assert exists (select 1 from public.notifications n join private.notification_delivery d on d.notification_id = n.id
      where n.user_id = other_customer and n.event = 'account' and n.title = 'Rezervace na tvém účtu jsou pozastavené'
        and n.body like 'Důvod: QA opakované nedostavení%' and d.channel = 'email'), 'Block notice missing';
  perform public.admin_set_booking_block(other_customer, false);
  assert exists (select 1 from public.notifications where user_id = other_customer and event = 'account' and title = 'Rezervace máš znovu povolené'),
    'Unblock notice missing';
  assert pg_temp.raises(format('insert into public.notifications (user_id, booking_id, event, title, body, href) values (%L, null, %L, %L, %L, %L)',
    other_customer, 'confirmed', 'x', 'x', '/rezervace')) like '%notifications_booking_link%', 'Booking notice without a booking';

  -- 14. Deleting an account: not for venue members or with an active booking; afterwards nobody can sign in and
  -- no personal data is left, while the booking and its payment stay.
  perform pg_temp.act_as(merchant);
  assert pg_temp.raises('select public.delete_my_account()') = 'BUSINESS_MEMBER', 'Venue member deleted the account';
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'qa-legal-delete@example.invalid', 'x', now(),
    '{"provider": "email", "providers": ["email"]}', '{"first_name": "QA", "last_name": "Smazání"}', now(), now())
  returning id into real_venue;
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (real_venue::text, real_venue, jsonb_build_object('sub', real_venue::text, 'email', 'qa-legal-delete@example.invalid'), 'email', now(), now());
  update public.profiles set phone = '+420777000111' where id = real_venue;
  perform pg_temp.act_as(real_venue);
  perform public.set_favorite(venue.id, true);
  pay := public.start_payment(o, '1.0');
  assert pg_temp.raises('select public.delete_my_account()') = 'ACTIVE_BOOKINGS', 'Deleted with an active booking';
  perform public.cancel_pending_booking((select id from public.bookings where payment_id = pay.id));
  assert public.delete_my_account() = 'deleted', 'Account not deleted';
  assert (select email = 'smazany-' || real_venue || '@smazany.invalid' and encrypted_password is null and banned_until > now() + interval '100 years'
      and raw_user_meta_data = '{}'::jsonb from auth.users where id = real_venue), 'Sign-in data kept';
  assert not exists (select 1 from auth.identities where user_id = real_venue), 'Identity kept';
  assert (select first_name = 'Smazaný' and last_name = 'účet' and phone is null from public.profiles where id = real_venue), 'Profile kept';
  assert not exists (select 1 from public.favorites where user_id = real_venue), 'Favourites kept';
  assert exists (select 1 from public.bookings where customer_id = real_venue) and exists (select 1 from public.payments where customer_id = real_venue),
    'Booking records lost';
  assert exists (select 1 from public.admin_audit_log where action = 'account_deleted' and target_id = real_venue), 'Deletion not audited';

  -- 15. Retention runs every night and removes what the privacy policy says it removes.
  insert into public.notifications (user_id, business_id, event, title, body, href, created_at)
  values (merchant, venue.id, 'account', 'QA stará zpráva', 'Stará.', '/partner/provozovna', now() - interval '13 months');
  perform private.flek_retention();
  assert not exists (select 1 from public.notifications where title = 'QA stará zpráva'), 'Old notice kept';
  assert exists (select 1 from public.notifications where user_id = merchant and title = 'Provozovna je schválená'), 'Recent notice removed';
  assert exists (select 1 from cron.job where jobname = 'flek-retention'), 'Retention not scheduled';

  -- 16. Grants.
  assert has_function_privilege('anon', 'public.legal_info()', 'EXECUTE')
    and has_function_privilege('anon', 'public.business_provider(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.start_payment(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.accept_merchant_terms(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.report_content(uuid,uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.export_my_data()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.start_payment(uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.current_legal_version(text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.booking_contract(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.account_notice(uuid,uuid,text,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.flek_retention()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.delete_my_account()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.delete_my_account()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.admin_set_booking_block(uuid,boolean,boolean,text)', 'EXECUTE'), 'Function grants';
  assert not has_table_privilege('authenticated', 'private.legal_acceptances', 'SELECT')
    and not has_table_privilege('anon', 'public.content_reports', 'SELECT')
    and not has_table_privilege('authenticated', 'public.content_reports', 'SELECT')
    and not has_table_privilege('authenticated', 'public.legal_documents', 'SELECT'), 'Legal tables readable by clients';
end $$;
rollback;
select 'PASS: nothing enforced before publishing, customer consent with the version in force recorded once by the server, merchant terms before publishing and members only, DAC7 billing details and birth date rules, provider details without private data, IČO gate for real venues, content notices validated and limited with an audited resolution, own-data export, DAC7 quarters from live payments only, analytics without browser identifiers, mandatory customer e-mail with the contract, venue e-mail preferences, account notices with reasons, block reason required, account deletion, nightly retention, grants; all fixtures rolled back' as result;
