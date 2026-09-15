/*
 * WhatsApp pro podniky i zákazníky, zapnutý předem a vypínatelný jako e-mail a push (Jakub, 15. 9.).
 *
 * - `private.business_whatsapp` (v produkci prázdná) nahrazuje obecná `private.whatsapp_contacts`:
 *   jedno číslo na podnik a jedno na zákazníka. Ověření zůstává: číslo platí, až z něj přijde kód
 *   „FLEK 123456“, protože zpráva nese termín, výplatu a u zákazníka i rezervační kód.
 * - `notification_preferences.whatsapp` je výchozí `true`. Zpráva jde jen na ověřené číslo a jen
 *   když preference není vypnutá.
 * - Podnik dostane žádost s tlačítky, potvrzenou a zrušenou rezervaci; zákazník potvrzený FLEK
 *   s kódem a zrušení. Každá zpráva má svou šablonu, chybějící šablonu worker jen přeskočí.
 * - Rozhodnout tlačítkem jde dál jen ze žádosti pro podnik, přes `private.decide_booking`.
 */

-- ------------------------------------------------------------------------- contacts

create table private.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('business', 'customer')),
  business_id uuid references public.businesses (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'pending' check (status in ('pending', 'verified', 'disabled')),
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  pairing_attempts integer not null default 0,
  pairing_requests integer not null default 0,
  pairing_window_at timestamptz,
  -- Who asked for the messages and agreed to what. For a venue their membership is checked on every decision.
  consent_by uuid references auth.users (id) on delete set null,
  consent_at timestamptz,
  consent_version text,
  verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'business' and business_id is not null and user_id is null)
      or (kind = 'customer' and user_id is not null and business_id is null))
);
create unique index whatsapp_contacts_business on private.whatsapp_contacts (business_id) where kind = 'business';
create unique index whatsapp_contacts_customer on private.whatsapp_contacts (user_id) where kind = 'customer';
alter table private.whatsapp_contacts enable row level security;
revoke all on private.whatsapp_contacts from public, anon, authenticated;

insert into private.whatsapp_contacts (kind, business_id, phone_e164, status, consent_by, consent_at, consent_version, verified_at, disabled_at, created_at, updated_at)
select 'business', business_id, phone_e164, case when status = 'pending' then 'disabled' else status end,
  consent_by, consent_at, consent_version, verified_at, disabled_at, created_at, updated_at
from private.business_whatsapp;

alter table private.whatsapp_messages
  add column contact_id uuid references private.whatsapp_contacts (id) on delete cascade,
  add column template text not null default 'business_request'
    check (template in ('business_request', 'business_confirmed', 'business_cancelled', 'customer_confirmed', 'customer_cancelled'));
update private.whatsapp_messages m set contact_id = c.id
from private.whatsapp_contacts c where c.kind = 'business' and c.business_id = m.business_id;
delete from private.whatsapp_messages where contact_id is null;
alter table private.whatsapp_messages alter column contact_id set not null;

drop function public.whatsapp_settings(uuid);
drop function public.whatsapp_start_pairing(uuid, text, text);
drop function public.whatsapp_disable(uuid);
drop function private.whatsapp_code_hash(uuid, text);
drop table private.business_whatsapp;

create index whatsapp_messages_contact on private.whatsapp_messages (contact_id);

alter table public.notification_preferences add column whatsapp boolean not null default true;

-- The consent is now the text next to the one-tap button, for venues and customers alike.
create or replace function private.whatsapp_consent_version() returns text
language sql immutable set search_path = '' as $$ select '2026-09-15' $$;

create or replace function private.whatsapp_code_hash(p_contact_id uuid, p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p_contact_id::text || ':' || p_code, 'sha256'), 'hex')
$$;

/** The number a contact would get by default: the venue's phone, or the customer's own. */
create or replace function private.whatsapp_default_phone(p_business_id uuid, p_user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select private.normalize_phone(case
    when p_business_id is not null then (select phone from public.businesses where id = p_business_id)
    else (select phone from public.profiles where id = p_user_id) end)
$$;

/** A member of the venue, for its contact, or the signed-in person, for their own. */
create or replace function private.whatsapp_owner(p_business_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_business_id is not null and not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
end $$;

-- --------------------------------------------------------------------- settings RPCs

create function public.whatsapp_settings(p_business_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c private.whatsapp_contacts; flek_number text := private.setting('whatsapp_display_number');
begin
  perform private.whatsapp_owner(p_business_id);
  select * into c from private.whatsapp_contacts
  where case when p_business_id is null then kind = 'customer' and user_id = auth.uid()
             else kind = 'business' and business_id = p_business_id end;
  return jsonb_build_object(
    'available', flek_number is not null,
    'kind', case when p_business_id is null then 'customer' else 'business' end,
    'status', case
      when c.id is null then 'off'
      when c.status = 'pending' and (c.pairing_expires_at is null or c.pairing_expires_at <= now()) then 'expired'
      else c.status end,
    'phone', coalesce(c.phone_e164, private.whatsapp_default_phone(p_business_id, auth.uid())),
    'pairing_expires_at', case when c.status = 'pending' then c.pairing_expires_at end,
    'verified_at', c.verified_at,
    -- A venue's messages go to the member who verified the number; only their preferences apply.
    'mine', coalesce(c.consent_by = auth.uid(), false),
    'flek_number', flek_number,
    'consent_version', private.whatsapp_consent_version(),
    'server_now', now());
end $$;

create function public.whatsapp_start_pairing(p_business_id uuid default null, p_phone text default null, p_consent_version text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  phone text;
  flek_number text := private.setting('whatsapp_display_number');
  code text := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  c private.whatsapp_contacts;
begin
  perform private.whatsapp_owner(p_business_id);
  if flek_number is null then raise exception 'WHATSAPP_UNAVAILABLE'; end if;
  if p_consent_version is distinct from private.whatsapp_consent_version() then raise exception 'CONSENT_REQUIRED'; end if;
  phone := private.normalize_phone(coalesce(nullif(trim(p_phone), ''), private.whatsapp_default_phone(p_business_id, auth.uid())));
  if phone is null then raise exception 'INVALID_PHONE'; end if;

  select * into c from private.whatsapp_contacts
  where case when p_business_id is null then kind = 'customer' and user_id = auth.uid()
             else kind = 'business' and business_id = p_business_id end
  for update;
  if c.id is null then
    insert into private.whatsapp_contacts (kind, business_id, user_id, phone_e164)
    values (case when p_business_id is null then 'customer' else 'business' end, p_business_id,
            case when p_business_id is null then auth.uid() end, phone)
    returning * into c;
  end if;
  update private.whatsapp_contacts set
    phone_e164 = phone, status = 'pending', pairing_code_hash = private.whatsapp_code_hash(c.id, code),
    pairing_expires_at = now() + interval '15 minutes', pairing_attempts = 0,
    pairing_requests = case when c.pairing_window_at > now() - interval '1 hour' then c.pairing_requests + 1 else 1 end,
    pairing_window_at = case when c.pairing_window_at > now() - interval '1 hour' then c.pairing_window_at else now() end,
    consent_by = auth.uid(), consent_at = now(), consent_version = p_consent_version,
    verified_at = null, disabled_at = null, updated_at = now()
  where id = c.id
  returning * into c;
  -- Raising rolls the counter back too, so it stays at the limit until the hour is over.
  if c.pairing_requests > 5 then raise exception 'WHATSAPP_PAIRING_RATE_LIMITED'; end if;

  perform private.emit('whatsapp_pairing_started', jsonb_build_object('kind', c.kind, 'business_id', c.business_id));
  return jsonb_build_object('code', code, 'expires_at', c.pairing_expires_at, 'phone', phone, 'flek_number', flek_number, 'server_now', now());
end $$;

create function public.whatsapp_disable(p_business_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.whatsapp_owner(p_business_id);
  update private.whatsapp_contacts
  set status = 'disabled', pairing_code_hash = null, pairing_expires_at = null, disabled_at = now(), updated_at = now()
  where status <> 'disabled'
    and case when p_business_id is null then kind = 'customer' and user_id = auth.uid()
             else kind = 'business' and business_id = p_business_id end;
  if found then perform private.emit('whatsapp_disabled', jsonb_build_object('business_id', p_business_id)); end if;
end $$;

-- A preference per channel, WhatsApp on unless switched off. Old four-argument calls keep working.
drop function public.save_notification_preference(text, text, boolean, boolean);
create function public.save_notification_preference(p_scope text, p_event text, p_email boolean, p_push boolean, p_whatsapp boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_event not in ('requested', 'confirmed', 'cancelled') or length(p_scope) not between 8 and 40 then raise exception 'INVALID_PREFERENCE'; end if;
  if p_scope <> 'customer' and not exists (select 1 from public.business_members where business_id::text = p_scope and user_id = auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.notification_preferences (user_id, scope, event, email, push, whatsapp)
  values (auth.uid(), p_scope, p_event, p_email, p_push, coalesce(p_whatsapp, true))
  on conflict (user_id, scope, event) do update
  set email = excluded.email, push = excluded.push,
      whatsapp = coalesce(p_whatsapp, public.notification_preferences.whatsapp);
end $$;

-- ------------------------------------------------------------------ webhook: pairing

create or replace function public.whatsapp_pair(p_event_key text, p_from text, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sender text := regexp_replace(coalesce(p_from, ''), '[^0-9]', '', 'g');
  code text := substring(lower(coalesce(p_text, '')) from 'flek[[:space:]]*([0-9]{6})');
  c private.whatsapp_contacts;
  paired text[] := '{}';
  kinds text[] := '{}';
begin
  insert into private.whatsapp_events (event_key, kind, sender_hash)
  values (p_event_key, 'message', private.whatsapp_sender_hash(sender)) on conflict do nothing;
  if not found then return jsonb_build_object('result', 'duplicate'); end if;
  if code is null or sender = '' then
    update private.whatsapp_events set outcome = 'ignored' where event_key = p_event_key;
    return jsonb_build_object('result', 'ignored');
  end if;
  if (select count(*) from private.whatsapp_events
      where sender_hash = private.whatsapp_sender_hash(sender) and outcome = 'pairing_failed' and received_at > now() - interval '1 hour') >= 10 then
    update private.whatsapp_events set outcome = 'pairing_blocked' where event_key = p_event_key;
    return jsonb_build_object('result', 'blocked');
  end if;

  for c in
    select * from private.whatsapp_contacts
    where status = 'pending' and pairing_expires_at > now() and pairing_attempts < 5
      and pairing_code_hash = private.whatsapp_code_hash(id, code)
    for update
  loop
    if substr(c.phone_e164, 2) <> sender then
      -- The right code from another number: count it, five of those burn the code.
      update private.whatsapp_contacts set pairing_attempts = pairing_attempts + 1, updated_at = now() where id = c.id;
      continue;
    end if;
    if c.kind = 'business' and (c.consent_by is null or not exists (
        select 1 from public.business_members m where m.business_id = c.business_id and m.user_id = c.consent_by)) then
      continue;
    end if;
    update private.whatsapp_contacts
    set status = 'verified', verified_at = now(), pairing_code_hash = null, pairing_expires_at = null, pairing_attempts = 0, updated_at = now()
    where id = c.id;
    perform private.emit('whatsapp_paired', jsonb_build_object('kind', c.kind, 'business_id', c.business_id));
    kinds := kinds || c.kind;
    if c.kind = 'business' then paired := paired || (select display_name from public.businesses where id = c.business_id); end if;
  end loop;

  update private.whatsapp_events set outcome = case when cardinality(kinds) > 0 then 'paired' else 'pairing_failed' end
  where event_key = p_event_key;
  if cardinality(kinds) = 0 then return jsonb_build_object('result', 'failed'); end if;
  return jsonb_build_object('result', 'paired', 'kind', case when 'business' = any(kinds) then 'business' else 'customer' end,
    'business', nullif(array_to_string(paired, ', '), ''));
end $$;

-- ----------------------------------------------------------------- webhook: decision

create or replace function public.whatsapp_decide(p_event_key text, p_from text, p_context_id text, p_payload text, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sender text := regexp_replace(coalesce(p_from, ''), '[^0-9]', '', 'g');
  from_payload boolean;
  from_label boolean := case p_label when 'Potvrdit' then true when 'Nemohu přijmout' then false end;
  accept boolean;
  token text;
  m private.whatsapp_messages;
  c private.whatsapp_contacts;
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
  if from_payload is not null and from_label is not null and from_payload <> from_label then
    return private.whatsapp_outcome(p_event_key, 'unknown_action');
  end if;
  accept := coalesce(from_payload, from_label);
  if accept is null or sender = '' then return private.whatsapp_outcome(p_event_key, 'unknown_action'); end if;

  if p_context_id is not null then
    select * into m from private.whatsapp_messages where wamid = p_context_id for update;
  end if;
  if m.id is null and token is not null then
    select * into m from private.whatsapp_messages where action_hash = encode(extensions.digest(token, 'sha256'), 'hex') for update;
  end if;
  -- Only a venue's request carries a decision; a confirmation or a customer's message decides nothing.
  if m.id is null or m.template <> 'business_request'
     or (token is not null and m.action_hash is distinct from encode(extensions.digest(token, 'sha256'), 'hex')) then
    return private.whatsapp_outcome(p_event_key, 'unknown_message');
  end if;
  if substr(m.phone_e164, 2) <> sender then return private.whatsapp_outcome(p_event_key, 'wrong_number'); end if;

  select * into c from private.whatsapp_contacts where id = m.contact_id;
  if c.kind is distinct from 'business' or c.status is distinct from 'verified' or c.phone_e164 <> m.phone_e164 or c.consent_by is null
     or not exists (select 1 from public.business_members b where b.business_id = m.business_id and b.user_id = c.consent_by) then
    return private.whatsapp_outcome(p_event_key, 'not_allowed');
  end if;

  if m.decided_at is not null then
    select k.status into booking_state from public.bookings k where k.id = m.booking_id;
    perform private.whatsapp_outcome(p_event_key, 'already');
    return jsonb_build_object('result', 'already', 'status', booking_state, 'decided', false);
  end if;

  begin
    result := private.decide_booking(m.booking_id, accept, c.consent_by, 'whatsapp');
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

-- ------------------------------------------------------------------- delivery worker

/**
 * WhatsApp deliveries with their template and parameters. A delivery is allowed only while it is
 * still true (the request still waits, the booking is still confirmed or cancelled), the contact is
 * verified, the preference is on and, for a venue, the person who verified the number is a member.
 */
create or replace function public.claim_whatsapp_deliveries() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d record;
  n public.notifications;
  k public.bookings;
  c private.whatsapp_contacts;
  template text;
  params text[];
  sent_before boolean;
  allowed boolean;
  token text;
  message_id uuid;
  service text;
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
    n := null; k := null; c := null; template := null; params := null; token := null; message_id := null;
    select * into n from public.notifications where id = d.notification_id;
    select * into k from public.bookings where id = n.booking_id;
    select * into c from private.whatsapp_contacts where id::text = d.target;
    template := case
      when n.business_id is not null then 'business_' || case n.event when 'requested' then 'request' else n.event end
      when n.event in ('confirmed', 'cancelled') then 'customer_' || n.event end;
    sent_before := exists (select 1 from private.whatsapp_messages where delivery_id = d.id and wamid is not null);
    allowed := coalesce(not sent_before and template is not null and c.status = 'verified'
      and coalesce((select whatsapp from public.notification_preferences p
                    where p.user_id = n.user_id and p.scope = coalesce(n.business_id::text, 'customer') and p.event = n.event), true)
      and case c.kind
        when 'business' then c.business_id = k.business_id
          and exists (select 1 from public.business_members b where b.business_id = k.business_id and b.user_id = c.consent_by)
        else c.user_id = k.customer_id end
      and case template
        when 'business_request' then k.status = 'pending_merchant' and k.confirmation_expires_at > now() + interval '30 seconds'
        when 'business_confirmed' then k.status = 'confirmed'
        when 'customer_confirmed' then k.status = 'confirmed'
        else k.status in ('cancelled_by_customer', 'cancelled_by_merchant', 'expired', 'rejected', 'payment_failed') end, false);

    if allowed then
      service := k.service_name_snapshot || ' (' || (extract(epoch from k.end_at_snapshot - k.start_at_snapshot) / 60)::integer || ' min)';
      params := case template
        when 'business_request' then array[private.whatsapp_when(k.start_at_snapshot), service, private.whatsapp_money(k.merchant_payout_cents),
          to_char(k.confirmation_expires_at at time zone 'Europe/Prague', 'FMHH24:MI')]
        when 'business_confirmed' then array[private.whatsapp_when(k.start_at_snapshot), service, private.whatsapp_money(k.merchant_payout_cents)]
        when 'business_cancelled' then array[private.whatsapp_when(k.start_at_snapshot), service, n.title]
        when 'customer_confirmed' then array[k.business_name_snapshot, private.whatsapp_when(k.start_at_snapshot), service, k.reservation_code]
        else array[k.business_name_snapshot, private.whatsapp_when(k.start_at_snapshot), service, n.title] end;
      if template = 'business_request' then token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'); end if;
      insert into private.whatsapp_messages (delivery_id, contact_id, template, business_id, booking_id, phone_e164, action_hash)
      values (d.id, c.id, template, k.business_id, k.id, c.phone_e164, case when token is not null then encode(extensions.digest(token, 'sha256'), 'hex') end)
      on conflict (delivery_id) do update set action_hash = excluded.action_hash, phone_e164 = excluded.phone_e164, updated_at = now()
      returning id into message_id;
    end if;
    claimed := claimed || jsonb_build_array(jsonb_build_object(
      'id', d.id, 'lease', d.lease, 'attempts', d.attempts, 'allowed', allowed, 'already_sent', sent_before,
      'message_id', message_id, 'to', case when allowed then c.phone_e164 end, 'template', template, 'params', to_jsonb(params), 'token', token));
  end loop;
  return claimed;
end $$;

-- ---------------------------------------------------------------- notification trigger

create or replace function private.booking_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare recipient record; nid uuid; event_kind text; heading text; detail text; scope_key text;
begin
  if TG_OP = 'UPDATE' and new.status = old.status then return new; end if;
  -- A seat held for a Checkout that was never paid concerns nobody but the database.
  if new.confirmation_version = 1 and new.authorized_at is null then return new; end if;
  event_kind := case
    when new.status = 'pending_merchant' then 'requested'
    when new.status = 'confirmed' then 'confirmed'
    when new.status in ('cancelled_by_customer', 'cancelled_by_merchant', 'expired', 'rejected', 'payment_failed') then 'cancelled'
  end;
  if event_kind is null then return new; end if;
  for recipient in
    select user_id as uid, new.business_id as bid from public.business_members where business_id = new.business_id
    union all
    -- The customer hears about their own request's outcome, not about cancelling it themselves.
    select new.customer_id, null::uuid
    where event_kind <> 'requested' and not (new.confirmation_version = 1 and new.confirmed_at is null and new.status = 'cancelled_by_customer')
  loop
    scope_key := coalesce(recipient.bid::text, 'customer');
    heading := case
      when event_kind = 'requested' then 'Nová rezervace čeká na potvrzení'
      when event_kind = 'confirmed' and recipient.bid is null then 'Tvůj FLEK je potvrzený'
      when event_kind = 'confirmed' then 'Rezervace je potvrzená'
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
      || case when event_kind = 'requested' then ' · potvrďte do ' || to_char(new.confirmation_expires_at at time zone 'Europe/Prague', 'HH24:MI') else '' end;
    nid := null;
    insert into public.notifications (user_id, booking_id, business_id, event, title, body, href)
    values (recipient.uid, new.id, recipient.bid, event_kind, heading, detail, case when recipient.bid is null then '/rezervace' else '/partner/rezervace' end)
    on conflict do nothing returning id into nid;
    if nid is null then continue; end if;
    insert into private.notification_delivery (notification_id, channel, target)
    select nid, 'email', u.email from auth.users u
    where u.id = recipient.uid and u.email_confirmed_at is not null and u.email not like '%@flek.test'
      and coalesce((select email from public.notification_preferences where user_id = recipient.uid and scope = scope_key and event = event_kind), true);
    insert into private.notification_delivery (notification_id, channel, target)
    select nid, 'push', s.id::text from private.push_subscriptions s
    where s.user_id = recipient.uid
      and coalesce((select push from public.notification_preferences where user_id = recipient.uid and scope = scope_key and event = event_kind), false);
    -- WhatsApp on a verified number, on by default: once per venue (the member who verified it) or to the customer.
    -- Nobody gets a WhatsApp about what they just did themselves: the venue's own confirmation, rejection or
    -- cancellation, or the customer's own cancellation. The app and e-mail still record it.
    insert into private.notification_delivery (notification_id, channel, target)
    select nid, 'whatsapp', c.id::text from private.whatsapp_contacts c
    where c.status = 'verified'
      and case when recipient.bid is null then c.kind = 'customer' and c.user_id = recipient.uid
                 and new.status <> 'cancelled_by_customer'
               else c.kind = 'business' and c.business_id = new.business_id and c.consent_by = recipient.uid
                 and new.status not in ('rejected', 'cancelled_by_merchant')
                 and not (event_kind = 'confirmed' and new.merchant_decided_at is not null) end
      and coalesce((select whatsapp from public.notification_preferences where user_id = recipient.uid and scope = scope_key and event = event_kind), true);
  end loop;
  perform private.kick_notification_delivery();
  return new;
end $$;

-- ------------------------------------------------------------------------ grants

revoke all on function private.whatsapp_code_hash(uuid, text), private.whatsapp_default_phone(uuid, uuid), private.whatsapp_owner(uuid),
  private.booking_notification() from public, anon, authenticated;

revoke all on function public.whatsapp_settings(uuid), public.whatsapp_start_pairing(uuid, text, text), public.whatsapp_disable(uuid),
  public.save_notification_preference(text, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.whatsapp_settings(uuid), public.whatsapp_start_pairing(uuid, text, text), public.whatsapp_disable(uuid),
  public.save_notification_preference(text, text, boolean, boolean, boolean) to authenticated;

revoke all on function public.whatsapp_pair(text, text, text), public.whatsapp_decide(text, text, text, text, text),
  public.claim_whatsapp_deliveries() from public, anon, authenticated;
grant execute on function public.whatsapp_pair(text, text, text), public.whatsapp_decide(text, text, text, text, text),
  public.claim_whatsapp_deliveries() to service_role;
