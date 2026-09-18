/*
 * Právní minimum, 1. část: verze dokumentů, údaje provozovatele, souhlasy a poskytovatel služby.
 *
 * Texty podmínek, zásad a pravidel jsou v aplikaci (src/content/pravni). Databáze ví jen, která
 * verze platí od kdy, a zapisuje, kdo s kterou verzí souhlasil. Dokument bez data účinnosti se
 * nikde nevynucuje: verze 1.0 začne platit, až budou v private.settings údaje provozovatele.
 *
 * - start_payment přijímá verzi obchodních podmínek. Když nějaká platí, bez souhlasu s ní platba
 *   nezačne (TERMS_OUTDATED) a souhlas se zapíše serverem.
 * - Podnik souhlasí s podmínkami pro podniky v Provozovně nebo z banneru; FLEK zveřejní člověk
 *   jen pro podnik, který souhlasil s platnou verzí. Plánované úlohy (obnova dema) se to netýká.
 * - Údaje o podnikateli pro zákazníka (název, IČO, adresa) a pro DAC7 (typ, datum narození, stát),
 *   výsledek ověření v ARES. Schválit nový skutečný podnik jde až s IČO.
 */

create table public.legal_documents (
  kind text not null check (kind in ('customer_terms', 'merchant_terms', 'privacy', 'content_rules')),
  version text not null check (version ~ '^[0-9]+\.[0-9]+$'),
  effective_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (kind, version)
);
alter table public.legal_documents enable row level security;
revoke all on public.legal_documents from public, anon, authenticated;

insert into public.legal_documents (kind, version) values
  ('customer_terms', '1.0'), ('merchant_terms', '1.0'), ('privacy', '1.0'), ('content_rules', '1.0');

/** The newest version whose effective date has come, or null while nothing is in force. */
create function private.current_legal_version(p_kind text) returns text
language sql stable security definer set search_path = '' as $$
  select version from public.legal_documents
  where kind = p_kind and effective_at <= now()
  order by effective_at desc, version desc
  limit 1
$$;

create function private.upcoming_legal_document(p_kind text) returns public.legal_documents
language sql stable security definer set search_path = '' as $$
  select * from public.legal_documents
  where kind = p_kind and effective_at > now()
  order by effective_at
  limit 1
$$;

/** Everything the footer, the legal pages and the consent lines need, for anyone. */
create function public.legal_info() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'operator', jsonb_build_object(
      'name', private.setting('operator_name'),
      'ico', private.setting('operator_ico'),
      'address', private.setting('operator_address'),
      'email', private.setting('support_email')),
    'documents', (
      select jsonb_object_agg(k.kind, jsonb_build_object(
        'version', current_doc.version,
        'effective_at', current_doc.effective_at,
        'upcoming_version', (private.upcoming_legal_document(k.kind)).version,
        'upcoming_effective_at', (private.upcoming_legal_document(k.kind)).effective_at))
      from (select distinct kind from public.legal_documents) k
      left join lateral (
        select d.version, d.effective_at from public.legal_documents d
        where d.kind = k.kind and d.effective_at <= now()
        order by d.effective_at desc, d.version desc limit 1
      ) current_doc on true),
    'server_now', now())
$$;

create table private.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  kind text not null,
  version text not null,
  source text not null check (source in ('booking', 'business_billing', 'terms_banner')),
  accepted_at timestamptz not null default now(),
  foreign key (kind, version) references public.legal_documents (kind, version),
  constraint legal_acceptances_once unique nulls not distinct (user_id, business_id, kind, version)
);
create index legal_acceptances_business on private.legal_acceptances (business_id, kind, version) where business_id is not null;
alter table private.legal_acceptances enable row level security;
revoke all on private.legal_acceptances from public, anon, authenticated;

/** True while no merchant terms are in force, or once any member of the venue accepted the version in force. */
create function private.merchant_terms_accepted(p_business_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_legal_version('merchant_terms') is null
    or exists (
      select 1 from private.legal_acceptances a
      where a.business_id = p_business_id and a.kind = 'merchant_terms'
        and a.version = private.current_legal_version('merchant_terms'))
$$;

create function private.offers_require_merchant_terms() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A person publishing needs the terms in force; scheduled jobs such as the demo refresh run without one.
  if auth.uid() is not null and not private.merchant_terms_accepted(new.business_id) then
    raise exception 'TERMS_OUTDATED';
  end if;
  return new;
end $$;
create trigger offers_require_merchant_terms before insert on public.offers
  for each row execute function private.offers_require_merchant_terms();

-- ------------------------------------------------------------------ provider and DAC7 details

alter table public.business_billing
  add column seller_type text check (seller_type in ('individual', 'entity')),
  add column birth_date date,
  add column country text not null default 'CZ' check (country ~ '^[A-Z]{2}$'),
  add column ares_name text check (ares_name is null or length(ares_name) <= 300),
  add column ares_address text check (ares_address is null or length(ares_address) <= 300),
  add column ares_checked_at timestamptz;

/** A venue run only by @flek.test accounts is the public demo, not a real provider. */
create function private.is_demo_business(p_business_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_members m where m.business_id = p_business_id)
    and not exists (
      select 1 from public.business_members m join auth.users u on u.id = m.user_id
      where m.business_id = p_business_id and u.email not like '%@flek.test')
$$;

/** Who provides the service, as the customer must see it before booking. Never bank or contact details. */
create function public.business_provider(p_business_id uuid) returns jsonb
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
  where b.id = p_business_id and b.status = 'approved'
$$;

create or replace function public.business_billing_get(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare row_data jsonb; upcoming public.legal_documents := private.upcoming_legal_document('merchant_terms');
begin
  if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
  select to_jsonb(x) into row_data from (
    select ico, dic, legal_name, bank_account, billing_address_line, billing_city,
           billing_postal_code, contact_person, contact_phone, terms_accepted_at,
           seller_type, birth_date, country, ares_name, ares_address, ares_checked_at
    from public.business_billing where business_id = p_business_id
  ) x;
  return coalesce(row_data, '{}'::jsonb) || jsonb_build_object(
    'terms_version', (select a.version from private.legal_acceptances a
                      join public.legal_documents d on d.kind = a.kind and d.version = a.version
                      where a.business_id = p_business_id and a.kind = 'merchant_terms'
                      order by d.effective_at desc nulls last, a.accepted_at desc limit 1),
    'terms_current', private.current_legal_version('merchant_terms'),
    'terms_accepted_current', private.merchant_terms_accepted(p_business_id),
    'terms_upcoming', upcoming.version,
    'terms_upcoming_at', upcoming.effective_at,
    'terms_upcoming_accepted', upcoming.version is not null and exists (
      select 1 from private.legal_acceptances a
      where a.business_id = p_business_id and a.kind = 'merchant_terms' and a.version = upcoming.version));
end $$;

/** Accepts the version in force or the announced next one; anything else is stale. */
create function private.accept_merchant_terms_locked(p_business_id uuid, p_version text, p_source text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_version is null or p_version not in (
      coalesce(private.current_legal_version('merchant_terms'), ''),
      coalesce((private.upcoming_legal_document('merchant_terms')).version, '')) then
    raise exception 'TERMS_OUTDATED';
  end if;
  insert into private.legal_acceptances (user_id, business_id, kind, version, source)
  values (auth.uid(), p_business_id, 'merchant_terms', p_version, p_source)
  on conflict on constraint legal_acceptances_once do nothing;
end $$;

create or replace function public.business_billing_save(p_business_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare kind text := nullif(p_data->>'seller_type', ''); born date; accepted boolean := coalesce((p_data->>'terms_accepted')::boolean, false);
begin
  if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
  if kind is not null and kind not in ('individual', 'entity') then raise exception 'VALIDATION_ERROR'; end if;
  begin
    born := nullif(p_data->>'birth_date', '')::date;
  exception when others then
    raise exception 'VALIDATION_ERROR';
  end;
  if born is not null and (kind is distinct from 'individual' or born < date '1900-01-01' or born > (now() at time zone 'Europe/Prague')::date - interval '18 years') then
    raise exception 'VALIDATION_ERROR';
  end if;
  -- With merchant terms in force the checkbox counts only together with the version the merchant read.
  if accepted and nullif(p_data->>'terms_version', '') is not null then
    perform private.accept_merchant_terms_locked(p_business_id, p_data->>'terms_version', 'business_billing');
  end if;
  accepted := accepted and (private.current_legal_version('merchant_terms') is null or nullif(p_data->>'terms_version', '') is not null);

  insert into public.business_billing as t (
    business_id, ico, dic, legal_name, bank_account,
    billing_address_line, billing_city, billing_postal_code,
    contact_person, contact_phone, terms_accepted_at, seller_type, birth_date, country
  ) values (
    p_business_id,
    nullif(btrim(p_data->>'ico'), ''),
    nullif(upper(btrim(p_data->>'dic')), ''),
    nullif(btrim(p_data->>'legal_name'), ''),
    nullif(btrim(p_data->>'bank_account'), ''),
    nullif(btrim(p_data->>'billing_address_line'), ''),
    nullif(btrim(p_data->>'billing_city'), ''),
    nullif(btrim(p_data->>'billing_postal_code'), ''),
    nullif(btrim(p_data->>'contact_person'), ''),
    nullif(btrim(p_data->>'contact_phone'), ''),
    case when accepted then now() end,
    kind,
    case when kind = 'individual' then born end,
    coalesce(nullif(upper(btrim(p_data->>'country')), ''), 'CZ')
  )
  on conflict (business_id) do update set
    ico = coalesce(nullif(btrim(p_data->>'ico'), ''), t.ico),
    dic = coalesce(nullif(upper(btrim(p_data->>'dic')), ''), t.dic),
    legal_name = coalesce(nullif(btrim(p_data->>'legal_name'), ''), t.legal_name),
    bank_account = coalesce(nullif(btrim(p_data->>'bank_account'), ''), t.bank_account),
    billing_address_line = coalesce(nullif(btrim(p_data->>'billing_address_line'), ''), t.billing_address_line),
    billing_city = coalesce(nullif(btrim(p_data->>'billing_city'), ''), t.billing_city),
    billing_postal_code = coalesce(nullif(btrim(p_data->>'billing_postal_code'), ''), t.billing_postal_code),
    contact_person = coalesce(nullif(btrim(p_data->>'contact_person'), ''), t.contact_person),
    contact_phone = coalesce(nullif(btrim(p_data->>'contact_phone'), ''), t.contact_phone),
    terms_accepted_at = coalesce(t.terms_accepted_at, case when accepted then now() end),
    seller_type = coalesce(kind, t.seller_type),
    birth_date = case when coalesce(kind, t.seller_type) = 'individual' then coalesce(born, t.birth_date) end,
    country = coalesce(nullif(upper(btrim(p_data->>'country')), ''), t.country),
    -- A changed IČO needs checking in ARES again.
    ares_checked_at = case when nullif(btrim(p_data->>'ico'), '') is distinct from t.ico and nullif(btrim(p_data->>'ico'), '') is not null then null else t.ares_checked_at end,
    ares_name = case when nullif(btrim(p_data->>'ico'), '') is distinct from t.ico and nullif(btrim(p_data->>'ico'), '') is not null then null else t.ares_name end,
    ares_address = case when nullif(btrim(p_data->>'ico'), '') is distinct from t.ico and nullif(btrim(p_data->>'ico'), '') is not null then null else t.ares_address end,
    updated_at = now();
  return public.business_billing_get(p_business_id);
end $$;

create function public.accept_merchant_terms(p_business_id uuid, p_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
  perform private.accept_merchant_terms_locked(p_business_id, p_version, 'terms_banner');
  update public.business_billing set terms_accepted_at = coalesce(terms_accepted_at, now()), updated_at = now()
  where business_id = p_business_id;
  return public.business_billing_get(p_business_id);
end $$;

-- ------------------------------------------------------------------------------ customer terms

drop function public.start_payment(uuid);
create function public.start_payment(p_offer_id uuid, p_terms_version text default null)
returns public.payments language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); venue uuid; o public.offers; b public.businesses; p public.payments; pr public.profiles;
  k public.bookings; s public.services; hold_until timestamptz; constraint_name text;
  terms text := private.current_legal_version('customer_terms');
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Consent is recorded by the server, with the version the customer was shown.
  if terms is not null then
    if p_terms_version is distinct from terms then raise exception 'TERMS_OUTDATED'; end if;
    insert into private.legal_acceptances (user_id, kind, version, source)
    values (u, 'customer_terms', terms, 'booking')
    on conflict on constraint legal_acceptances_once do nothing;
  end if;
  select business_id into venue from public.offers where id = p_offer_id;
  if venue is null then raise exception 'OFFER_UNAVAILABLE'; end if;
  if not private.manual_confirmation_for(venue) then return public.start_payment_legacy(p_offer_id); end if;

  select * into pr from public.profiles where id = u for update;
  if pr.id is null or pr.booking_blocked then raise exception 'BOOKING_BLOCKED'; end if;
  if pr.phone is null or length(regexp_replace(pr.phone, '[^0-9]', '', 'g')) < 9 then raise exception 'PHONE_REQUIRED'; end if;
  select biz.* into b from public.businesses biz join public.offers x on x.business_id = biz.id where x.id = p_offer_id for share of biz;
  select * into o from public.offers where id = p_offer_id for update;
  if o.id is null or b.status <> 'approved' then raise exception 'OFFER_UNAVAILABLE'; end if;

  select * into k from public.bookings
  where customer_id = u and offer_id = o.id and status in ('pending_payment', 'pending_merchant', 'capturing', 'confirmed');
  if k.id is not null then
    if k.status = 'pending_payment' and k.checkout_expires_at > now() then
      select * into p from public.payments where id = k.payment_id;
      return p;
    end if;
    raise exception 'ALREADY_BOOKED';
  end if;
  if (select count(*) from public.bookings where customer_id = u
      and status in ('pending_payment', 'pending_merchant', 'capturing', 'confirmed') and start_at_snapshot > now()) >= 3 then
    raise exception 'TOO_MANY_ACTIVE';
  end if;
  -- Holding seats without paying for them, again and again, blocks them for everyone else.
  if (select count(*) from public.bookings where customer_id = u and confirmation_version = 1 and confirmed_at is null
      and status in ('expired', 'cancelled_by_customer') and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'HOLD_RATE_LIMITED';
  end if;
  if coalesce(pr.no_show_override_until, '-infinity') < now()
     and (select count(*) from public.bookings where customer_id = u and status = 'no_show' and start_at_snapshot > now() - interval '60 days') >= 2 then
    raise exception 'BLOCKED_NO_SHOW';
  end if;
  if not public.offer_is_bookable(o.status, o.capacity_remaining, o.booking_cutoff_at, o.start_at)
     or private.confirmation_deadline(o.start_at, now()) is null then
    raise exception 'OFFER_UNAVAILABLE';
  end if;
  if b.stripe_account_id is null or not b.stripe_charges_enabled then raise exception 'PAYMENTS_NOT_READY'; end if;

  select * into s from public.services where id = o.service_id;
  insert into public.payments (customer_id, offer_id, amount_cents, provider, destination_account_id, application_fee_cents, confirmation_version)
  values (u, o.id, o.deal_price_cents, 'stripe', b.stripe_account_id, o.service_fee_cents, 1) returning * into p;
  update public.offers set capacity_remaining = capacity_remaining - 1, updated_at = now() where id = o.id;
  hold_until := least(now() + private.checkout_hold_interval(), o.start_at - interval '15 minutes', o.booking_cutoff_at);
  for i in 1..5 loop
    begin
      insert into public.bookings (offer_id, business_id, customer_id, reservation_code, price_cents, service_name_snapshot,
        business_name_snapshot, business_address_snapshot, start_at_snapshot, end_at_snapshot, original_price_cents_snapshot,
        payment_id, cancellation_window_minutes, merchant_payout_cents, service_fee_cents, fee_policy_version, status,
        confirmation_version, checkout_expires_at)
      values (o.id, b.id, u, 'FLEK-' || public.generate_reservation_code(6), o.deal_price_cents, s.name, b.display_name,
        b.address_line || ', ' || b.city, o.start_at, o.end_at, o.original_price_cents, p.id, b.cancellation_window_minutes,
        o.merchant_price_cents, o.service_fee_cents, o.fee_policy_version, 'pending_payment', 1, hold_until);
      return p;
    exception when unique_violation then
      get stacked diagnostics constraint_name = CONSTRAINT_NAME;
      if constraint_name = 'bookings_one_active_per_customer_offer' then raise exception 'ALREADY_BOOKED'; end if;
      if constraint_name <> 'bookings_reservation_code_key' then raise; end if;
    end;
  end loop;
  raise exception 'CODE_GENERATION_FAILED';
end $$;

-- ------------------------------------------------------------------------------ approval gate

create or replace function public.admin_set_business_status(p_business_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = 'public' as $$
declare o record; k record; hold public.bookings; previous public.business_status; previous_reason text;
  offers_cancelled integer := 0; bookings_refunded integer := 0; requests_released integer := 0;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('pending','approved','rejected','suspended') then raise exception 'VALIDATION_ERROR'; end if;
  if p_status in ('rejected','suspended') and coalesce(length(trim(p_reason)),0) < 3 then raise exception 'VALIDATION_ERROR'; end if;
  select status, status_reason into previous, previous_reason from public.businesses where id = p_business_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- The customer has to see who provides the service; a real venue goes live only with its IČO.
  if p_status = 'approved' and previous is distinct from 'approved' and not private.is_demo_business(p_business_id)
     and not exists (select 1 from public.business_billing where business_id = p_business_id and ico is not null) then
    raise exception 'PROVIDER_DETAILS_REQUIRED';
  end if;
  update public.businesses set status = p_status::public.business_status, status_reason = p_reason, updated_at = now() where id = p_business_id;
  if p_status = 'approved' and previous is distinct from 'approved' then
    perform private.emit('business_approved', jsonb_build_object('business_id', p_business_id));
  end if;
  if p_status <> 'approved' then
    for o in select id from public.offers where business_id = p_business_id and start_at > now() and status = 'published' order by id for update loop
      update public.offers set status = 'cancelled', cancelled_at = now(), cancellation_reason = coalesce(p_reason, 'Provozovna není dostupná.'), updated_at = now() where id = o.id;
      offers_cancelled := offers_cancelled + 1;
      for k in select id from public.bookings where offer_id = o.id and status = 'confirmed' for update loop
        update public.bookings set status = 'cancelled_by_merchant', cancelled_at = now(), cancellation_reason = coalesce(p_reason, 'Provozovna není dostupná.') where id = k.id;
        perform private.refund_for_booking(k.id);
        bookings_refunded := bookings_refunded + 1;
      end loop;
      for hold in select * from public.bookings where offer_id = o.id and status in ('pending_payment', 'pending_merchant', 'capturing') order by id for update loop
        if hold.status = 'capturing' then
          update public.bookings set cancellation_requested = true, cancellation_reason = coalesce(p_reason, 'Provozovna není dostupná.') where id = hold.id;
          perform private.queue_release(hold.payment_id, 'BUSINESS_UNAVAILABLE');
        elsif private.release_hold_locked(hold, 'cancelled_by_merchant', 'BUSINESS_UNAVAILABLE', coalesce(p_reason, 'Provozovna není dostupná.')) then
          requests_released := requests_released + 1;
        end if;
      end loop;
      perform private.emit('offer_cancelled', jsonb_build_object('offer_id', o.id, 'business_id', p_business_id));
    end loop;
    perform private.kick_confirmations();
  end if;
  perform private.audit('business_status_changed', 'business', p_business_id,
    jsonb_build_object('status', previous, 'status_reason', previous_reason),
    jsonb_build_object('status', p_status, 'status_reason', p_reason,
      'offers_cancelled', offers_cancelled, 'bookings_refunded', bookings_refunded, 'requests_released', requests_released),
    p_reason);
end $$;

-- ------------------------------------------------------------------------------------ grants

revoke all on function private.current_legal_version(text), private.upcoming_legal_document(text),
  private.merchant_terms_accepted(uuid), private.offers_require_merchant_terms(), private.is_demo_business(uuid),
  private.accept_merchant_terms_locked(uuid, text, text) from public, anon, authenticated;
revoke all on function public.legal_info(), public.business_provider(uuid) from public;
revoke all on function public.accept_merchant_terms(uuid, text), public.start_payment(uuid, text) from public, anon;
grant execute on function public.legal_info(), public.business_provider(uuid) to anon, authenticated;
grant execute on function public.accept_merchant_terms(uuid, text), public.start_payment(uuid, text) to authenticated;
