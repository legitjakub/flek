/*
 * Platby k řešení (audit 28. 9., nález H1).
 *
 * Vratka, kterou Stripe zamítl nebo která osmkrát selhala cestou ke Stripe, vypadla z fronty a jedinou
 * stopou byla událost v analytice. Stejně potichu mohla zůstat zaplacená platba bez místa, blokace na
 * kartě, kterou se nepodařilo uvolnit, potvrzení podnikem, u kterého stržení nedoběhlo, nebo událost ze
 * Stripe, která skončila chybou. Admin je teď vidí na jednom místě (`admin_payment_issues`) a o každé
 * nové se jednou dozví e-mailem (údržba každých pět minut).
 *
 * Nic tu nemění peníze ani jejich stav: ten dál přebírá FLEK jen od Stripe. Novou vratku z dashboardu
 * Stripe zapíše webhook sám, `stripe_refund_update` přijme nové `refund_id`.
 */

create table private.payment_issue_notices (
  kind text not null,
  ref text not null,
  noticed_at timestamptz not null default now(),
  primary key (kind, ref)
);
alter table private.payment_issue_notices enable row level security;
revoke all on private.payment_issue_notices from public, anon, authenticated;

/** Everything about money that waits for a person, newest problem last. `ref` identifies it for the notices. */
create function private.payment_issues() returns table (
  kind text, ref text, payment_id uuid, booking_id uuid, business_name text, service_name text, start_at timestamptz,
  amount_cents integer, customer_email text, payment_intent_id text, livemode boolean, detail text, attempts integer,
  since timestamptz)
language sql stable security definer set search_path = '' as $$
  with money as (
    select p.*, k.id as k_id, k.status as k_status, k.business_name_snapshot, k.service_name_snapshot, k.start_at_snapshot,
      k.cancelled_at as k_cancelled_at, k.merchant_decided_at, u.email::text as email
    from public.payments p
    left join public.bookings k on k.payment_id = p.id
    left join auth.users u on u.id = p.customer_id
    where p.provider = 'stripe'
  )
  -- Stripe failed or canceled the refund: the money has to go back another way.
  select 'refund_failed', m.id::text, m.id, m.k_id, m.business_name_snapshot, m.service_name_snapshot, m.start_at_snapshot,
    m.amount_cents, m.email, m.payment_intent_id, m.livemode, coalesce(m.refund_error, m.refund_status), m.refund_attempts,
    m.refund_requested_at
  from money m
  where m.status = 'paid' and m.refund_requested_at is not null and m.refund_status in ('failed', 'canceled')
  union all
  -- Eight errors on the way to Stripe: the refund queue gave up.
  select 'refund_stuck', m.id::text, m.id, m.k_id, m.business_name_snapshot, m.service_name_snapshot, m.start_at_snapshot,
    m.amount_cents, m.email, m.payment_intent_id, m.livemode, m.refund_error, m.refund_attempts, m.refund_requested_at
  from money m
  where m.status = 'paid' and m.refund_requested_at is not null and m.refund_attempts >= 8
    and coalesce(m.refund_status, '') not in ('failed', 'canceled')
  union all
  -- Stripe waits for an action, or a refund has been pending for three days.
  select 'refund_waiting', m.id::text, m.id, m.k_id, m.business_name_snapshot, m.service_name_snapshot, m.start_at_snapshot,
    m.amount_cents, m.email, m.payment_intent_id, m.livemode, m.refund_status, m.refund_attempts, m.refund_requested_at
  from money m
  where m.status = 'paid' and m.refund_attempts < 8
    and (m.refund_status = 'requires_action' or (m.refund_status = 'pending' and m.refund_requested_at < now() - interval '3 days'))
  union all
  -- Paid, no seat behind it and no refund asked for: the hourly safety net did not run.
  select 'paid_without_booking', m.id::text, m.id, null, null, null, null,
    m.amount_cents, m.email, m.payment_intent_id, m.livemode, m.failure_reason, m.refund_attempts, m.paid_at
  from money m
  where m.status = 'paid' and m.refund_requested_at is null and m.k_id is null and m.paid_at < now() - interval '75 minutes'
  union all
  -- FLEK let the authorisation go an hour ago and the card still holds it.
  select 'release_stuck', m.id::text, m.id, m.k_id, m.business_name_snapshot, m.service_name_snapshot, m.start_at_snapshot,
    m.amount_cents, m.email, m.payment_intent_id, m.livemode, coalesce(j.last_error, m.failure_reason), coalesce(j.attempts, 0),
    coalesce(m.k_cancelled_at, m.created_at)
  from money m
  left join private.confirmation_jobs j on j.payment_id = m.id
  where m.confirmation_version = 1 and m.authorization_state = 'release_pending' and m.payment_intent_id is not null
    and coalesce(m.k_cancelled_at, m.created_at) < now() - interval '1 hour'
  union all
  -- The merchant said yes and the capture did not finish in time.
  select 'capture_stuck', m.id::text, m.id, m.k_id, m.business_name_snapshot, m.service_name_snapshot, m.start_at_snapshot,
    m.amount_cents, m.email, m.payment_intent_id, m.livemode, j.last_error, coalesce(j.attempts, 0), m.merchant_decided_at
  from money m
  left join private.confirmation_jobs j on j.payment_id = m.id
  where m.k_status = 'capturing' and (m.start_at_snapshot <= now() or m.merchant_decided_at < now() - interval '15 minutes')
  union all
  -- A Stripe event that failed and has not gone through since.
  select 'webhook_failed', e.id, null, null, null, null, null, null, null, null, e.livemode, e.type || ': ' || coalesce(e.error, ''), null,
    e.received_at
  from private.stripe_events e
  where e.processed_at is null and e.error is not null and e.received_at < now() - interval '30 minutes'
$$;

create function public.admin_payment_issues() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(to_jsonb(i) order by i.since, i.ref) from private.payment_issues() i), '[]'::jsonb);
end $$;

/**
 * Tells every admin, once, about issues that were not there at the previous run. A resolved issue is
 * forgotten, so the same payment failing again later is news again. Test payments of the demo accounts
 * (@flek.test, including the acceptance checks' deliberately failing refunds) are listed, never e-mailed.
 */
create function private.notice_payment_issues() returns integer
language plpgsql security definer set search_path = '' as $$
declare fresh integer; a record; title text;
begin
  with found as (
    select i.kind, i.ref from private.payment_issues() i where coalesce(i.customer_email, '') not like '%@flek.test'
  ), gone as (
    delete from private.payment_issue_notices n
    where not exists (select 1 from found f where f.kind = n.kind and f.ref = n.ref)
  ), added as (
    insert into private.payment_issue_notices (kind, ref)
    select f.kind, f.ref from found f
    on conflict do nothing
    returning 1
  )
  select count(*) into fresh from added;
  if fresh = 0 then return 0; end if;
  title := case when fresh = 1 then '1 nová platba k řešení'
    when fresh between 2 and 4 then fresh || ' nové platby k řešení'
    else fresh || ' nových plateb k řešení' end;
  for a in select distinct user_id from public.user_roles where role = 'admin' loop
    perform private.account_notice(a.user_id, null, title,
      'Stripe nevrátil peníze, nestrhl nebo neuvolnil platbu, nebo webhook skončil chybou. Seznam s odkazem do Stripe najdete v administraci.',
      '/admin/platby');
  end loop;
  return fresh;
end $$;

alter table public.notifications drop constraint notifications_href_check;
alter table public.notifications add constraint notifications_href_check
  check (href in ('/rezervace','/partner/rezervace','/partner/provozovna','/profil','/admin/platby')
    or href ~ '^/rezervace\?ohodnotit=[0-9a-f-]{36}$'
    or href ~ '^/nabidka/[0-9a-f-]{36}$'
    or href ~ '^/mapa\?hlidac=[0-9a-f-]{36}$');

-- The five-minute Stripe safety net also looks for what needs a person.
create or replace function private.flek_stripe_maintenance() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payments set refund_requested_at = now(), failure_reason = coalesce(failure_reason, 'NO_BOOKING')
  where provider = 'stripe' and status = 'paid' and refund_requested_at is null
    and paid_at < now() - interval '60 minutes'
    and not exists (select 1 from public.bookings b where b.payment_id = payments.id);
  -- An authorisation still being released or captured is not an abandoned attempt.
  update public.payments set status = 'failed', failure_reason = coalesce(failure_reason, 'ABANDONED')
  where provider = 'stripe' and status = 'pending' and created_at < now() - interval '2 hours'
    and not (confirmation_version = 1 and authorization_state in ('authorized', 'release_pending'));
  perform private.kick_refunds();
  perform private.notice_payment_issues();
end $$;

revoke all on function private.payment_issues(), private.notice_payment_issues(), private.flek_stripe_maintenance()
  from public, anon, authenticated;
revoke all on function public.admin_payment_issues() from public, anon;
grant execute on function public.admin_payment_issues() to authenticated;
