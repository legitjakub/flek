/*
 * Právní minimum, 2. část: nahlášení obsahu, export vlastních dat, podklad DAC7 a analytika bez
 * identifikátoru z prohlížeče. Jen doplňuje: nic nemaže, nemění účty a samo neposílá zprávy.
 *
 * - Nahlášení nabídky nebo podniku (nařízení o digitálních službách) s frontou pro admina.
 * - Export vlastních dat pro zákazníka.
 * - Podklad pro oznámení DAC7: zaplacené a nevrácené služby po čtvrtletích na podnik (jen ostré platby).
 * - record_event už identifikátor relace neukládá; staré záznamy dožijí podle doby uchování.
 * - Pomocné funkce s údaji provozovatele, poskytovatele a smlouvy pro e-maily.
 */

-- ---------------------------------------------------------------------------- content reports

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  business_id uuid not null references public.businesses(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete set null,
  reason text not null check (reason in ('illegal', 'misleading', 'prohibited_service', 'rights', 'other')),
  message text not null check (length(message) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolution text check (resolution is null or length(resolution) between 3 and 2000),
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index content_reports_open on public.content_reports (created_at) where status = 'open';
create index content_reports_reporter on public.content_reports (reporter_id, created_at);
alter table public.content_reports enable row level security;
revoke all on public.content_reports from public, anon, authenticated;

create function public.report_content(p_business_id uuid, p_offer_id uuid, p_reason text, p_message text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); venue uuid := p_business_id; report_id uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_offer_id is not null then
    select business_id into venue from public.offers where id = p_offer_id;
  end if;
  if venue is null or not exists (select 1 from public.businesses where id = venue) then raise exception 'NOT_FOUND'; end if;
  if p_reason not in ('illegal', 'misleading', 'prohibited_service', 'rights', 'other')
     or length(btrim(coalesce(p_message, ''))) not between 10 and 2000 then
    raise exception 'VALIDATION_ERROR';
  end if;
  if (select count(*) from public.content_reports where reporter_id = u and created_at > now() - interval '1 day') >= 10 then
    raise exception 'REPORT_RATE_LIMITED';
  end if;
  insert into public.content_reports (reporter_id, business_id, offer_id, reason, message)
  values (u, venue, p_offer_id, p_reason, btrim(p_message))
  returning id into report_id;
  perform private.emit('content_reported', jsonb_build_object('report_id', report_id, 'business_id', venue, 'offer_id', p_offer_id, 'reason', p_reason));
  return report_id;
end $$;

create function public.admin_content_reports(p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'status', r.status, 'reason', r.reason, 'message', r.message, 'resolution', r.resolution,
      'created_at', r.created_at, 'resolved_at', r.resolved_at,
      'business_id', r.business_id, 'business_name', b.display_name, 'business_status', b.status,
      'offer_id', r.offer_id, 'service_name', s.name, 'offer_start_at', o.start_at, 'offer_status', o.status,
      'reporter_email', u.email) order by r.created_at desc)
    from public.content_reports r
    join public.businesses b on b.id = r.business_id
    left join public.offers o on o.id = r.offer_id
    left join public.services s on s.id = o.service_id
    left join auth.users u on u.id = r.reporter_id
    where p_status is null or r.status = p_status), '[]'::jsonb);
end $$;

create function public.admin_resolve_content_report(p_report_id uuid, p_status text, p_resolution text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.content_reports;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('actioned', 'dismissed') or length(btrim(coalesce(p_resolution, ''))) < 3 then raise exception 'VALIDATION_ERROR'; end if;
  select * into r from public.content_reports where id = p_report_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'open' then raise exception 'ALREADY_RESOLVED'; end if;
  update public.content_reports set status = p_status, resolution = btrim(p_resolution), resolved_by = auth.uid(), resolved_at = now()
  where id = r.id;
  perform private.audit('content_report_resolved', 'content_report', r.id,
    jsonb_build_object('status', r.status), jsonb_build_object('status', p_status, 'business_id', r.business_id, 'offer_id', r.offer_id),
    p_resolution);
end $$;

-- ------------------------------------------------------------------------ customer's own data

create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', a.email, 'created_at', a.created_at, 'email_confirmed_at', a.email_confirmed_at)
                from auth.users a where a.id = u),
    'profile', (select jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'phone', p.phone,
                  'no_show_count', p.no_show_count, 'booking_blocked', p.booking_blocked, 'created_at', p.created_at)
                from public.profiles p where p.id = u),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object(
                  'service', k.service_name_snapshot, 'business', k.business_name_snapshot, 'address', k.business_address_snapshot,
                  'start_at', k.start_at_snapshot, 'end_at', k.end_at_snapshot, 'status', k.status,
                  'reservation_code', case when k.status in ('confirmed', 'completed', 'no_show') then k.reservation_code end,
                  'price_cents', k.price_cents, 'service_fee_cents', k.service_fee_cents,
                  'created_at', k.created_at, 'confirmed_at', k.confirmed_at, 'cancelled_at', k.cancelled_at,
                  'cancellation_reason', k.cancellation_reason, 'rating', k.rating) order by k.created_at)
                from public.bookings k where k.customer_id = u), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
                  'amount_cents', p.amount_cents, 'status', p.status, 'created_at', p.created_at, 'paid_at', p.paid_at,
                  'refunded_at', p.refunded_at, 'refund_status', p.refund_status) order by p.created_at)
                from public.payments p where p.customer_id = u), '[]'::jsonb),
    'favorites', coalesce((select jsonb_agg(jsonb_build_object('business', b.display_name, 'since', f.created_at))
                from public.favorites f join public.businesses b on b.id = f.business_id where f.user_id = u), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('title', n.title, 'body', n.body, 'created_at', n.created_at, 'read_at', n.read_at) order by n.created_at)
                from public.notifications n where n.user_id = u), '[]'::jsonb),
    'notification_preferences', coalesce((select jsonb_agg(jsonb_build_object('scope', np.scope, 'event', np.event, 'email', np.email, 'push', np.push, 'whatsapp', np.whatsapp))
                from public.notification_preferences np where np.user_id = u), '[]'::jsonb),
    'push_devices', (select count(*) from private.push_subscriptions ps where ps.user_id = u),
    'whatsapp', (select jsonb_build_object('phone', c.phone_e164, 'status', c.status, 'consent_at', c.consent_at,
                  'consent_version', c.consent_version, 'verified_at', c.verified_at)
                from private.whatsapp_contacts c where c.kind = 'customer' and c.user_id = u),
    'referral', jsonb_build_object(
                  'code', (select rc.code from public.referral_codes rc where rc.user_id = u),
                  'invited', (select count(*) from public.referrals r where r.referrer_user_id = u),
                  'invited_by_someone', exists (select 1 from public.referrals r where r.referred_user_id = u)),
    'legal_acceptances', coalesce((select jsonb_agg(jsonb_build_object('document', a.kind, 'version', a.version, 'accepted_at', a.accepted_at, 'source', a.source) order by a.accepted_at)
                from private.legal_acceptances a where a.user_id = u), '[]'::jsonb),
    'businesses', coalesce((select jsonb_agg(jsonb_build_object('business', b.display_name, 'role', m.role))
                from public.business_members m join public.businesses b on b.id = m.business_id where m.user_id = u), '[]'::jsonb),
    'content_reports', coalesce((select jsonb_agg(jsonb_build_object('reason', r.reason, 'message', r.message, 'status', r.status, 'created_at', r.created_at))
                from public.content_reports r where r.reporter_id = u), '[]'::jsonb),
    'analytics_events', coalesce((select jsonb_agg(jsonb_build_object('name', e.name, 'occurred_at', e.occurred_at, 'props', e.props) order by e.occurred_at)
                from public.analytics_events e where e.user_id = u), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------- DAC7

/** Paid, not refunded services per venue and calendar quarter (Europe/Prague), for the yearly report. */
create function public.admin_dac7_report(p_year integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_year is null or p_year not between 2020 and 2100 then raise exception 'VALIDATION_ERROR'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.legal_name nulls last, r.display_name)
    from (
      select b.id as business_id, b.display_name, coalesce(bb.legal_name, b.legal_name) as legal_name,
        bb.seller_type, bb.ico, bb.dic, bb.birth_date, coalesce(bb.country, b.country, 'CZ') as country,
        coalesce(
          nullif(concat_ws(', ', bb.billing_address_line, nullif(concat_ws(' ', bb.billing_postal_code, bb.billing_city), '')), ''),
          nullif(concat_ws(', ', b.address_line, nullif(concat_ws(' ', b.postal_code, b.city), '')), '')) as address,
        b.stripe_account_id, bb.ares_checked_at, private.is_demo_business(b.id) as demo,
        count(*) filter (where x.quarter = 1) as q1_count, coalesce(sum(x.payout) filter (where x.quarter = 1), 0) as q1_payout_cents, coalesce(sum(x.fee) filter (where x.quarter = 1), 0) as q1_fee_cents,
        count(*) filter (where x.quarter = 2) as q2_count, coalesce(sum(x.payout) filter (where x.quarter = 2), 0) as q2_payout_cents, coalesce(sum(x.fee) filter (where x.quarter = 2), 0) as q2_fee_cents,
        count(*) filter (where x.quarter = 3) as q3_count, coalesce(sum(x.payout) filter (where x.quarter = 3), 0) as q3_payout_cents, coalesce(sum(x.fee) filter (where x.quarter = 3), 0) as q3_fee_cents,
        count(*) filter (where x.quarter = 4) as q4_count, coalesce(sum(x.payout) filter (where x.quarter = 4), 0) as q4_payout_cents, coalesce(sum(x.fee) filter (where x.quarter = 4), 0) as q4_fee_cents
      from (
        select k.business_id, k.merchant_payout_cents as payout, k.service_fee_cents as fee,
          extract(quarter from p.paid_at at time zone 'Europe/Prague')::integer as quarter
        from public.bookings k
        join public.payments p on p.id = k.payment_id
        where p.provider = 'stripe' and p.status = 'paid' and p.livemode is true
          and k.status in ('confirmed', 'completed', 'no_show')
          and p.paid_at >= make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Europe/Prague')
          and p.paid_at < make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Europe/Prague')
      ) x
      join public.businesses b on b.id = x.business_id
      left join public.business_billing bb on bb.business_id = b.id
      group by b.id, bb.business_id
    ) r), '[]'::jsonb);
end $$;

-- ----------------------------------------------------------------------------------- analytics

-- No identifier read from the visitor's browser: anonymous events are counted, not linked.
alter table public.analytics_events alter column session_id drop not null;
create or replace function public.record_event(p_name text, p_session_id text default null, p_props jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = 'public' as $$
declare props jsonb := coalesce(p_props, '{}'::jsonb);
begin
  if p_name not in ('search_performed','offer_viewed','booking_started','booking_failed',
                    'favorite_added','favorite_removed','offer_shared',
                    'unavailable_recovery_clicked','similar_offers_clicked',
                    'referral_link_opened') then return; end if;
  if jsonb_typeof(props) <> 'object' or pg_column_size(props) > 2048 then return; end if;
  -- A place next to an account is personal data: a district (~1 km) is all the metrics need.
  if jsonb_typeof(props->'lat') = 'number' then props := jsonb_set(props, '{lat}', to_jsonb(round((props->>'lat')::numeric, 2))); end if;
  if jsonb_typeof(props->'lng') = 'number' then props := jsonb_set(props, '{lng}', to_jsonb(round((props->>'lng')::numeric, 2))); end if;
  insert into public.analytics_events(name, session_id, user_id, props)
  values (p_name, null, auth.uid(), props);
exception when others then null;
end $$;

-- ------------------------------------------------------------------------------ e-mail helpers

/** Operator identification for every e-mail footer; null values mean it has not been filled in yet. */
create function private.operator_details() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', private.setting('operator_name'),
    'ico', private.setting('operator_ico'),
    'address', private.setting('operator_address'),
    'email', private.setting('support_email'))
$$;

/** Provider of a booked service regardless of the venue's current status (a suspended venue still owes its bookings). */
create function private.provider_details(p_business_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', coalesce(bb.legal_name, b.legal_name, b.display_name),
    'ico', bb.ico,
    'address', coalesce(
      nullif(concat_ws(', ', bb.billing_address_line, nullif(concat_ws(' ', bb.billing_postal_code, bb.billing_city), '')), ''),
      nullif(concat_ws(', ', b.address_line, nullif(concat_ws(' ', b.postal_code, b.city), '')), '')),
    'demo', private.is_demo_business(b.id))
  from public.businesses b
  left join public.business_billing bb on bb.business_id = b.id
  where b.id = p_business_id
$$;

/** What the customer's e-mail about a booking has to say: the contract, its price and its terms. */
create function private.booking_contract(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', k.status,
    -- The code belongs only to a booking the venue agreed to.
    'code', case when k.status in ('confirmed', 'completed') then k.reservation_code end,
    'service', k.service_name_snapshot,
    'business', k.business_name_snapshot,
    'address', k.business_address_snapshot,
    'start_at', k.start_at_snapshot,
    'end_at', k.end_at_snapshot,
    'price_cents', k.price_cents,
    'service_fee_cents', k.service_fee_cents,
    'original_price_cents', k.original_price_cents_snapshot,
    'free_cancellation_until', greatest(
      k.start_at_snapshot - make_interval(mins => k.cancellation_window_minutes),
      coalesce(k.confirmed_at, k.created_at) + interval '10 minutes'),
    'payment_status', p.status,
    'refund_status', p.refund_status,
    'authorization_state', p.authorization_state,
    'cancellation_reason', k.cancellation_reason,
    'provider', private.provider_details(k.business_id),
    'terms_version', (select a.version from private.legal_acceptances a
                      where a.user_id = k.customer_id and a.kind = 'customer_terms'
                      order by a.accepted_at desc limit 1))
  from public.bookings k
  left join public.payments p on p.id = k.payment_id
  where k.id = p_booking_id
$$;

-- ------------------------------------------------------------------------------------ grants

revoke all on function private.operator_details(), private.provider_details(uuid), private.booking_contract(uuid)
  from public, anon, authenticated;
revoke all on function public.report_content(uuid, uuid, text, text), public.admin_content_reports(text),
  public.admin_resolve_content_report(uuid, text, text), public.export_my_data(), public.admin_dac7_report(integer)
  from public, anon;
grant execute on function public.report_content(uuid, uuid, text, text), public.admin_content_reports(text),
  public.admin_resolve_content_report(uuid, text, text), public.export_my_data(), public.admin_dac7_report(integer)
  to authenticated;
