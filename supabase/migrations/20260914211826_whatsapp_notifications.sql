/*
 * WhatsApp upozornění pro podniky (Meta WhatsApp Cloud API).
 *
 * - Číslo se propojuje párovacím kódem: člen podniku zadá číslo a souhlas, aplikace ukáže kód
 *   „FLEK 123456“ a podnik ho z toho čísla pošle na číslo FLEK. Tím prokáže, že číslo ovládá,
 *   a nepotřebujeme k tomu další šablonu ani odkaz s tokenem (GET nic nemění).
 * - Nová žádost o rezervaci (`requested`) založí jedno WhatsApp doručení na podnik, u člena, který
 *   číslo propojil. Worker pošle schválenou šablonu s tlačítky Potvrdit / Nemohu přijmout.
 * - Klepnutí na tlačítko jde přes podepsaný webhook do `whatsapp_decide`, které ověří číslo,
 *   zprávu, jednorázový token a členství a zavolá stejné `private.decide_booking` jako aplikace.
 * - Telefonní čísla nejsou v analytice; události nesou jen ID rezervace a podniku.
 * - Bez klíčů Meta se nic neodesílá: číslo nejde ověřit, takže nevznikne ani žádné doručení.
 */

-- --------------------------------------------------------------------------- tables

create table private.business_whatsapp (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'pending' check (status in ('pending', 'verified', 'disabled')),
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  pairing_attempts integer not null default 0,
  pairing_requests integer not null default 0,
  pairing_window_at timestamptz,
  -- Who asked for the notifications and agreed to what; their membership is checked on every decision.
  consent_by uuid references auth.users (id) on delete set null,
  consent_at timestamptz,
  consent_version text,
  verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid unique references private.notification_delivery (id) on delete set null,
  business_id uuid not null references public.businesses (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  phone_e164 text not null,
  wamid text unique,
  -- SHA-256 of the one-time token carried in the buttons; the token itself is never stored.
  action_hash text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  error_code text,
  decision text check (decision in ('accept', 'reject')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index whatsapp_messages_booking on private.whatsapp_messages (booking_id);
create index whatsapp_messages_action on private.whatsapp_messages (action_hash) where action_hash is not null;

-- Meta delivers webhooks at least once; each inbound message and status is handled once.
create table private.whatsapp_events (
  event_key text primary key,
  kind text not null check (kind in ('message', 'status')),
  sender_hash text,
  -- Status events only: which message and what happened, kept when the status beats the worker's record of the send.
  wamid text,
  status text,
  detail text,
  outcome text,
  received_at timestamptz not null default now()
);
create index whatsapp_events_sender on private.whatsapp_events (sender_hash, received_at desc) where sender_hash is not null;
create index whatsapp_events_unmatched on private.whatsapp_events (wamid) where outcome = 'unmatched';

alter table private.business_whatsapp enable row level security;
alter table private.whatsapp_messages enable row level security;
alter table private.whatsapp_events enable row level security;
revoke all on private.business_whatsapp, private.whatsapp_messages, private.whatsapp_events from public, anon, authenticated;

alter table private.notification_delivery drop constraint notification_delivery_channel_check;
alter table private.notification_delivery add constraint notification_delivery_channel_check
  check (channel in ('email', 'push', 'whatsapp'));

-- -------------------------------------------------------------------------- helpers

/** The consent text shown in Provozovna has this version; a pairing needs the current one. */
create or replace function private.whatsapp_consent_version() returns text
language sql immutable set search_path = '' as $$ select '2026-09-14' $$;

/**
 * E.164 from what a person types: spaces, dots, dashes and brackets go, 00 becomes +, and nine
 * digits are a Czech number. Anything else that is not a plausible E.164 number is refused.
 */
create or replace function private.normalize_phone(p_phone text) returns text
language plpgsql immutable set search_path = '' as $$
declare digits text;
begin
  if p_phone is null then return null; end if;
  digits := regexp_replace(p_phone, '[[:space:]().-]', '', 'g');
  if digits ~ '^00[1-9]' then digits := '+' || substr(digits, 3); end if;
  if digits ~ '^[0-9]{9}$' then digits := '+420' || digits; end if;
  if digits ~ '^420[0-9]{9}$' then digits := '+' || digits; end if;
  if digits !~ '^\+[1-9][0-9]{7,14}$' then return null; end if;
  if digits ~ '^\+420' and digits !~ '^\+420[0-9]{9}$' then return null; end if;
  return digits;
end $$;

create or replace function private.whatsapp_code_hash(p_business_id uuid, p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p_business_id::text || ':' || p_code, 'sha256'), 'hex')
$$;

create or replace function private.whatsapp_sender_hash(p_digits text) returns text
language sql immutable set search_path = '' as $$
  select case when coalesce(p_digits, '') = '' then null
    else encode(extensions.digest('whatsapp:' || p_digits, 'sha256'), 'hex') end
$$;

/** "dnes 14:30", "zítra 9:00", "st 17. 9. 18:15" in Prague time. */
create or replace function private.whatsapp_when(p_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select case (p_at at time zone 'Europe/Prague')::date - (now() at time zone 'Europe/Prague')::date
      when 0 then 'dnes'
      when 1 then 'zítra'
      else (array['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'])[extract(isodow from p_at at time zone 'Europe/Prague')::integer]
        || ' ' || to_char(p_at at time zone 'Europe/Prague', 'FMDD. FMMM.')
    end || ' ' || to_char(p_at at time zone 'Europe/Prague', 'FMHH24:MI')
$$;

create or replace function private.whatsapp_money(p_cents integer) returns text
language sql immutable set search_path = '' as $$
  select replace(to_char(p_cents / 100, 'FM999,999,990'), ',', ' ')
    || case when p_cents % 100 <> 0 then ',' || lpad((p_cents % 100)::text, 2, '0') else '' end || ' Kč'
$$;

-- ------------------------------------------------------------------ partner: settings

create or replace function public.whatsapp_settings(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare w private.business_whatsapp; flek_number text := private.setting('whatsapp_display_number');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
  select * into w from private.business_whatsapp where business_id = p_business_id;
  return jsonb_build_object(
    'available', flek_number is not null,
    'status', case
      when w.business_id is null then 'off'
      when w.status = 'pending' and (w.pairing_expires_at is null or w.pairing_expires_at <= now()) then 'expired'
      else w.status end,
    'phone', w.phone_e164,
    'pairing_expires_at', case when w.status = 'pending' then w.pairing_expires_at end,
    'verified_at', w.verified_at,
    'flek_number', flek_number,
    'consent_version', private.whatsapp_consent_version(),
    'server_now', now());
end $$;

create or replace function public.whatsapp_start_pairing(p_business_id uuid, p_phone text, p_consent_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  phone text := private.normalize_phone(p_phone);
  flek_number text := private.setting('whatsapp_display_number');
  code text;
  w private.business_whatsapp;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
  if flek_number is null then raise exception 'WHATSAPP_UNAVAILABLE'; end if;
  if p_consent_version is distinct from private.whatsapp_consent_version() then raise exception 'CONSENT_REQUIRED'; end if;
  if phone is null then raise exception 'INVALID_PHONE'; end if;

  code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  insert into private.business_whatsapp as existing (business_id, phone_e164, status, pairing_code_hash, pairing_expires_at,
      pairing_attempts, pairing_requests, pairing_window_at, consent_by, consent_at, consent_version)
  values (p_business_id, phone, 'pending', private.whatsapp_code_hash(p_business_id, code), now() + interval '15 minutes',
      0, 1, now(), auth.uid(), now(), p_consent_version)
  on conflict (business_id) do update set
    phone_e164 = excluded.phone_e164, status = 'pending', pairing_code_hash = excluded.pairing_code_hash,
    pairing_expires_at = excluded.pairing_expires_at, pairing_attempts = 0,
    pairing_requests = case when existing.pairing_window_at > now() - interval '1 hour' then existing.pairing_requests + 1 else 1 end,
    pairing_window_at = case when existing.pairing_window_at > now() - interval '1 hour' then existing.pairing_window_at else now() end,
    consent_by = excluded.consent_by, consent_at = excluded.consent_at, consent_version = excluded.consent_version,
    verified_at = null, disabled_at = null, updated_at = now()
  returning * into w;
  -- Raising rolls the counter back too, so it stays at the limit until the hour is over.
  if w.pairing_requests > 5 then raise exception 'WHATSAPP_PAIRING_RATE_LIMITED'; end if;

  perform private.emit('whatsapp_pairing_started', jsonb_build_object('business_id', p_business_id));
  return jsonb_build_object('code', code, 'expires_at', w.pairing_expires_at, 'phone', phone, 'flek_number', flek_number, 'server_now', now());
end $$;

create or replace function public.whatsapp_disable(p_business_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
  update private.business_whatsapp
  set status = 'disabled', pairing_code_hash = null, pairing_expires_at = null, disabled_at = now(), updated_at = now()
  where business_id = p_business_id and status <> 'disabled';
  if found then perform private.emit('whatsapp_disabled', jsonb_build_object('business_id', p_business_id)); end if;
end $$;

-- --------------------------------------------------------------- webhook: pairing

/** A text message from WhatsApp. Only "FLEK 123456" from the number entered in the app pairs it. */
create or replace function public.whatsapp_pair(p_event_key text, p_from text, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sender text := regexp_replace(coalesce(p_from, ''), '[^0-9]', '', 'g');
  code text := substring(lower(coalesce(p_text, '')) from 'flek[[:space:]]*([0-9]{6})');
  w private.business_whatsapp;
  paired text[] := '{}';
begin
  insert into private.whatsapp_events (event_key, kind, sender_hash)
  values (p_event_key, 'message', private.whatsapp_sender_hash(sender)) on conflict do nothing;
  if not found then return jsonb_build_object('result', 'duplicate'); end if;
  if code is null or sender = '' then
    update private.whatsapp_events set outcome = 'ignored' where event_key = p_event_key;
    return jsonb_build_object('result', 'ignored');
  end if;
  -- Ten wrong codes from one number in an hour and it is not answered any more.
  if (select count(*) from private.whatsapp_events
      where sender_hash = private.whatsapp_sender_hash(sender) and outcome = 'pairing_failed' and received_at > now() - interval '1 hour') >= 10 then
    update private.whatsapp_events set outcome = 'pairing_blocked' where event_key = p_event_key;
    return jsonb_build_object('result', 'blocked');
  end if;

  for w in
    select * from private.business_whatsapp
    where status = 'pending' and pairing_expires_at > now() and pairing_attempts < 5
      and pairing_code_hash = private.whatsapp_code_hash(business_id, code)
    for update
  loop
    if substr(w.phone_e164, 2) <> sender then
      -- The right code from another number: count it, five of those burn the code.
      update private.business_whatsapp set pairing_attempts = pairing_attempts + 1, updated_at = now() where business_id = w.business_id;
      continue;
    end if;
    if w.consent_by is null or not exists (
        select 1 from public.business_members m where m.business_id = w.business_id and m.user_id = w.consent_by) then
      continue;
    end if;
    update private.business_whatsapp
    set status = 'verified', verified_at = now(), pairing_code_hash = null, pairing_expires_at = null, pairing_attempts = 0, updated_at = now()
    where business_id = w.business_id;
    perform private.emit('whatsapp_paired', jsonb_build_object('business_id', w.business_id));
    paired := paired || (select display_name from public.businesses where id = w.business_id);
  end loop;

  update private.whatsapp_events set outcome = case when cardinality(paired) > 0 then 'paired' else 'pairing_failed' end
  where event_key = p_event_key;
  if cardinality(paired) = 0 then return jsonb_build_object('result', 'failed'); end if;
  return jsonb_build_object('result', 'paired', 'business', array_to_string(paired, ', '));
end $$;

-- -------------------------------------------------------------- webhook: decision

create or replace function private.whatsapp_outcome(p_event_key text, p_outcome text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update private.whatsapp_events set outcome = p_outcome where event_key = p_event_key;
  return jsonb_build_object('result', p_outcome);
end $$;

/**
 * A tap on Potvrdit / Nemohu přijmout. The tap counts only on the message FLEK sent for that
 * request (by its WhatsApp id, or the one-time token in the button), from the number it was sent
 * to, while that number is still the venue's verified number and the person who paired it is
 * still a member. Each message decides once; the decision itself is `private.decide_booking`.
 */
create or replace function public.whatsapp_decide(p_event_key text, p_from text, p_context_id text, p_payload text, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sender text := regexp_replace(coalesce(p_from, ''), '[^0-9]', '', 'g');
  from_payload boolean;
  from_label boolean := case p_label when 'Potvrdit' then true when 'Nemohu přijmout' then false end;
  accept boolean;
  token text;
  m private.whatsapp_messages;
  w private.business_whatsapp;
  booking_state public.booking_status;
  result jsonb;
begin
  insert into private.whatsapp_events (event_key, kind, sender_hash)
  values (p_event_key, 'message', private.whatsapp_sender_hash(sender)) on conflict do nothing;
  if not found then return jsonb_build_object('result', 'duplicate'); end if;

  if p_payload ~ '^FLEK1\.[ar]\.[A-Za-z0-9_-]{20,64}$' then
    from_payload := split_part(p_payload, '.', 2) = 'a';
    token := split_part(p_payload, '.', 3);
  end if;
  -- Without FLEK's payload the button's label decides, and only together with the message it was on.
  if from_payload is not null and from_label is not null and from_payload <> from_label then
    return private.whatsapp_outcome(p_event_key, 'unknown_action');
  end if;
  accept := coalesce(from_payload, from_label);
  if accept is null or sender = '' then return private.whatsapp_outcome(p_event_key, 'unknown_action'); end if;

  if p_context_id is not null then
    select * into m from private.whatsapp_messages where wamid = p_context_id for update;
  end if;
  if m.id is null and token is not null then
    select * into m from private.whatsapp_messages
    where action_hash = encode(extensions.digest(token, 'sha256'), 'hex') for update;
  end if;
  if m.id is null or (token is not null and m.action_hash is distinct from encode(extensions.digest(token, 'sha256'), 'hex')) then
    return private.whatsapp_outcome(p_event_key, 'unknown_message');
  end if;
  if substr(m.phone_e164, 2) <> sender then return private.whatsapp_outcome(p_event_key, 'wrong_number'); end if;

  select * into w from private.business_whatsapp where business_id = m.business_id;
  if w.status is distinct from 'verified' or w.phone_e164 <> m.phone_e164 or w.consent_by is null
     or not exists (select 1 from public.business_members b where b.business_id = m.business_id and b.user_id = w.consent_by) then
    return private.whatsapp_outcome(p_event_key, 'not_allowed');
  end if;

  if m.decided_at is not null then
    select k.status into booking_state from public.bookings k where k.id = m.booking_id;
    perform private.whatsapp_outcome(p_event_key, 'already');
    return jsonb_build_object('result', 'already', 'status', booking_state, 'decided', false);
  end if;

  begin
    result := private.decide_booking(m.booking_id, accept, w.consent_by, 'whatsapp');
  exception when others then
    return private.whatsapp_outcome(p_event_key, 'error');
  end;
  update private.whatsapp_messages
  set decision = case when accept then 'accept' else 'reject' end, decided_at = now(), updated_at = now()
  where id = m.id;
  perform private.emit('whatsapp_decision', jsonb_build_object('booking_id', m.booking_id, 'business_id', m.business_id,
    'accept', accept, 'decided', result -> 'decided', 'status', result ->> 'status'));
  perform private.whatsapp_outcome(p_event_key, case when (result ->> 'decided')::boolean then 'decided' else 'not_decided' end);
  return result || jsonb_build_object('result', case when (result ->> 'decided')::boolean then 'decided' else 'not_decided' end);
end $$;

-- ---------------------------------------------------------------- webhook: statuses

/** Moves a message forward to a delivery status. Statuses arrive out of order: delivered never steps back to sent. */
create or replace function private.whatsapp_apply_status(p_message_id uuid, p_status text, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare m private.whatsapp_messages; ranks constant text[] := array['queued', 'sent', 'delivered', 'read'];
begin
  select * into m from private.whatsapp_messages where id = p_message_id for update;
  if m.id is null or m.status = 'failed' then return; end if;
  if p_status <> 'failed' and array_position(ranks, p_status) <= array_position(ranks, m.status) then return; end if;
  update private.whatsapp_messages
  set status = p_status, error_code = case when p_status = 'failed' then left(p_error, 120) end, updated_at = now()
  where id = m.id;
  if p_status in ('delivered', 'failed') then
    perform private.emit('whatsapp_' || p_status, jsonb_build_object('booking_id', m.booking_id, 'business_id', m.business_id,
      'error', case when p_status = 'failed' then left(p_error, 120) end));
  end if;
end $$;

create or replace function public.whatsapp_status(p_event_key text, p_wamid text, p_status text, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare message_id uuid;
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed') then return; end if;
  insert into private.whatsapp_events (event_key, kind, wamid, status, detail)
  values (p_event_key, 'status', p_wamid, p_status, left(p_error, 120)) on conflict do nothing;
  if not found then return; end if;
  select id into message_id from private.whatsapp_messages where wamid = p_wamid;
  if message_id is null then
    -- Meta can report a status before the worker has recorded the send; whatsapp_message_sent picks it up.
    update private.whatsapp_events set outcome = 'unmatched' where event_key = p_event_key;
    return;
  end if;
  perform private.whatsapp_apply_status(message_id, p_status, p_error);
  update private.whatsapp_events set outcome = 'applied' where event_key = p_event_key;
end $$;

-- ------------------------------------------------------------------ delivery worker

/**
 * Claims WhatsApp deliveries for the worker with everything the template needs. A delivery is
 * allowed only while its request still waits with at least half a minute left, and the number is
 * still verified for the venue. Each allowed delivery gets a message row and a fresh one-time token.
 */
create or replace function public.claim_whatsapp_deliveries() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d record;
  k public.bookings;
  w private.business_whatsapp;
  sent_before boolean;
  allowed boolean;
  token text;
  message_id uuid;
  claimed jsonb := '[]'::jsonb;
begin
  for d in
    with eligible as (
      select id from private.notification_delivery
      where channel = 'whatsapp' and status in ('pending', 'processing') and available_at <= now() and attempts < 8
      order by available_at for update skip locked limit 10
    )
    update private.notification_delivery nd
    set status = 'processing', attempts = nd.attempts + 1, lease = gen_random_uuid(), available_at = now() + interval '2 minutes'
    from eligible e where nd.id = e.id
    returning nd.id, nd.lease, nd.target, nd.attempts, nd.notification_id
  loop
    k := null; w := null; token := null; message_id := null;
    select b.* into k from public.notifications n join public.bookings b on b.id = n.booking_id where n.id = d.notification_id;
    select * into w from private.business_whatsapp where business_id = k.business_id;
    sent_before := exists (select 1 from private.whatsapp_messages where delivery_id = d.id and wamid is not null);
    allowed := coalesce(not sent_before
      and k.status = 'pending_merchant' and k.confirmation_expires_at > now() + interval '30 seconds'
      and w.status = 'verified' and w.phone_e164 = d.target
      and exists (select 1 from public.business_members b where b.business_id = k.business_id and b.user_id = w.consent_by), false);
    if allowed then
      token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
      insert into private.whatsapp_messages (delivery_id, business_id, booking_id, phone_e164, action_hash)
      values (d.id, k.business_id, k.id, d.target, encode(extensions.digest(token, 'sha256'), 'hex'))
      on conflict (delivery_id) do update set action_hash = excluded.action_hash, updated_at = now()
      returning id into message_id;
    end if;
    claimed := claimed || jsonb_build_array(jsonb_build_object(
      'id', d.id, 'lease', d.lease, 'attempts', d.attempts, 'allowed', allowed, 'already_sent', sent_before,
      'message_id', message_id, 'to', d.target, 'token', token,
      'when', case when allowed then private.whatsapp_when(k.start_at_snapshot) end,
      'service', case when allowed then k.service_name_snapshot || ' (' || (extract(epoch from k.end_at_snapshot - k.start_at_snapshot) / 60)::integer || ' min)' end,
      'payout', case when allowed then private.whatsapp_money(k.merchant_payout_cents) end,
      'deadline', case when allowed then to_char(k.confirmation_expires_at at time zone 'Europe/Prague', 'FMHH24:MI') end));
  end loop;
  return claimed;
end $$;

create or replace function public.whatsapp_message_sent(p_message_id uuid, p_wamid text) returns void
language plpgsql security definer set search_path = '' as $$
declare m private.whatsapp_messages; late record;
begin
  update private.whatsapp_messages set wamid = p_wamid, status = 'sent', updated_at = now()
  where id = p_message_id and wamid is null and status = 'queued'
  returning * into m;
  if m.id is null then return; end if;
  perform private.emit('whatsapp_sent', jsonb_build_object('booking_id', m.booking_id, 'business_id', m.business_id));
  for late in
    select event_key, status, detail from private.whatsapp_events
    where outcome = 'unmatched' and wamid = p_wamid
    order by array_position(array['sent', 'delivered', 'read', 'failed'], status)
  loop
    perform private.whatsapp_apply_status(m.id, late.status, late.detail);
    update private.whatsapp_events set outcome = 'applied' where event_key = late.event_key;
  end loop;
end $$;

-- ------------------------------------------------------------------ notification trigger

create or replace function private.booking_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare recipient record; nid uuid; kind text; heading text; detail text; scope_key text;
begin
  if TG_OP = 'UPDATE' and new.status = old.status then return new; end if;
  -- A seat held for a Checkout that was never paid concerns nobody but the database.
  if new.confirmation_version = 1 and new.authorized_at is null then return new; end if;
  kind := case
    when new.status = 'pending_merchant' then 'requested'
    when new.status = 'confirmed' then 'confirmed'
    when new.status in ('cancelled_by_customer', 'cancelled_by_merchant', 'expired', 'rejected', 'payment_failed') then 'cancelled'
  end;
  if kind is null then return new; end if;
  for recipient in
    select user_id as uid, new.business_id as bid from public.business_members where business_id = new.business_id
    union all
    -- The customer hears about their own request's outcome, not about cancelling it themselves.
    select new.customer_id, null::uuid
    where kind <> 'requested' and not (new.confirmation_version = 1 and new.confirmed_at is null and new.status = 'cancelled_by_customer')
  loop
    scope_key := coalesce(recipient.bid::text, 'customer');
    heading := case
      when kind = 'requested' then 'Nová rezervace čeká na potvrzení'
      when kind = 'confirmed' and recipient.bid is null then 'Tvůj FLEK je potvrzený'
      when kind = 'confirmed' then 'Rezervace je potvrzená'
      when new.status = 'rejected' and recipient.bid is null then 'Podnik rezervaci nepotvrdil'
      when new.status = 'rejected' then 'Žádost o rezervaci byla odmítnuta'
      when new.status = 'expired' and recipient.bid is null then 'Čas na potvrzení vypršel'
      when new.status = 'expired' then 'Žádost o rezervaci vypršela'
      when new.status = 'payment_failed' and recipient.bid is null then 'Platbu se nepodařilo dokončit'
      when new.status = 'payment_failed' then 'Rezervaci se nepodařilo dokončit'
      when new.status = 'cancelled_by_customer' and new.confirmed_at is null and new.confirmation_version = 1 then 'Zákazník žádost zrušil'
      else 'Rezervace byla zrušena'
    end;
    detail := new.service_name_snapshot || ' · ' || to_char(new.start_at_snapshot at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI')
      || ' · 1 místo · ' || new.business_name_snapshot
      || case when kind = 'requested' then ' · potvrďte do ' || to_char(new.confirmation_expires_at at time zone 'Europe/Prague', 'HH24:MI') else '' end;
    nid := null;
    insert into public.notifications (user_id, booking_id, business_id, event, title, body, href)
    values (recipient.uid, new.id, recipient.bid, kind, heading, detail, case when recipient.bid is null then '/rezervace' else '/partner/rezervace' end)
    on conflict do nothing returning id into nid;
    if nid is null then continue; end if;
    insert into private.notification_delivery (notification_id, channel, target)
    select nid, 'email', u.email from auth.users u
    where u.id = recipient.uid and u.email_confirmed_at is not null and u.email not like '%@flek.test'
      and coalesce((select email from public.notification_preferences where user_id = recipient.uid and scope = scope_key and event = kind), true);
    insert into private.notification_delivery (notification_id, channel, target)
    select nid, 'push', s.id::text from private.push_subscriptions s
    where s.user_id = recipient.uid
      and coalesce((select push from public.notification_preferences where user_id = recipient.uid and scope = scope_key and event = kind), false);
    -- One WhatsApp per request per venue: on the notification of the member who paired the number.
    if kind = 'requested' and recipient.bid is not null then
      insert into private.notification_delivery (notification_id, channel, target)
      select nid, 'whatsapp', w.phone_e164 from private.business_whatsapp w
      where w.business_id = new.business_id and w.status = 'verified' and w.consent_by = recipient.uid;
    end if;
  end loop;
  perform private.kick_notification_delivery();
  return new;
end $$;

-- ------------------------------------------------------------------- payments status

-- Provozovna says whether new bookings wait for the venue; the answer comes from the rollout switch.
create or replace function public.business_payments_status(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b public.businesses;
begin
  if not (public.is_member_of(p_business_id) or public.is_admin()) then raise exception 'FORBIDDEN'; end if;
  select * into b from public.businesses where id = p_business_id;
  return jsonb_build_object(
    'provider', 'stripe',
    'connected', b.stripe_account_id is not null,
    'charges_enabled', b.stripe_charges_enabled, 'payouts_enabled', b.stripe_payouts_enabled,
    'details_submitted', b.stripe_details_submitted, 'synced_at', b.stripe_synced_at,
    'manual_confirmation', private.manual_confirmation_for(p_business_id));
end $$;

-- ------------------------------------------------------------------------ grants, cron

revoke all on function private.whatsapp_consent_version(), private.normalize_phone(text), private.whatsapp_code_hash(uuid, text),
  private.whatsapp_sender_hash(text), private.whatsapp_when(timestamptz), private.whatsapp_money(integer),
  private.whatsapp_outcome(text, text), private.whatsapp_apply_status(uuid, text, text), private.booking_notification()
  from public, anon, authenticated;

revoke all on function public.whatsapp_settings(uuid), public.whatsapp_start_pairing(uuid, text, text), public.whatsapp_disable(uuid)
  from public, anon;
grant execute on function public.whatsapp_settings(uuid), public.whatsapp_start_pairing(uuid, text, text), public.whatsapp_disable(uuid)
  to authenticated;

revoke all on function public.whatsapp_pair(text, text, text), public.whatsapp_decide(text, text, text, text, text),
  public.whatsapp_status(text, text, text, text), public.claim_whatsapp_deliveries(), public.whatsapp_message_sent(uuid, text)
  from public, anon, authenticated;
grant execute on function public.whatsapp_pair(text, text, text), public.whatsapp_decide(text, text, text, text, text),
  public.whatsapp_status(text, text, text, text), public.claim_whatsapp_deliveries(), public.whatsapp_message_sent(uuid, text)
  to service_role;

revoke all on function public.business_payments_status(uuid) from public, anon;
grant execute on function public.business_payments_status(uuid) to authenticated;

select cron.schedule('flek-whatsapp-events-cleanup', '17 3 * * *',
  $$delete from private.whatsapp_events where received_at < now() - interval '30 days'$$);
