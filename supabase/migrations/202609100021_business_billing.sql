/*
 * The identifying and payment details a real partnership needs, and had nowhere to live.
 *
 * The whole schema held one gesture towards a legal entity — businesses.legal_name — and
 * even that was unreachable: create_business read it from p_data, the form never sent it,
 * and update_business did not update it at all. There was no IČO, no DIČ, no bank account,
 * no contact person and no record of anyone accepting terms. FLEK takes a commission from
 * every booking and could not have invoiced or paid a single venue.
 *
 * A separate table, not new columns on businesses, and the reason is a grant:
 *
 *   grant select on public.businesses to anon, authenticated;   -- 202609070001_schema.sql
 *   create policy business_read ... using(status='approved' or is_member_of(id) or is_admin())
 *
 * Every approved venue's row is readable by everyone, by design — that is how the public
 * venue page works. A bank account added to that table would be world-readable the moment
 * it was written. Here the rows are visible only to the venue's own members and to admins.
 */

create table public.business_billing (
  business_id uuid primary key references public.businesses on delete cascade,
  -- Eight digits, the Czech company number. Null until the partner fills it in: registration
  -- already exists in the wild and must not break for venues created before this migration.
  ico text check (ico is null or ico ~ '^[0-9]{8}$'),
  -- CZ + 8 to 10 digits. A venue that is not VAT-registered leaves it empty.
  dic text check (dic is null or dic ~ '^CZ[0-9]{8,10}$'),
  legal_name text check (legal_name is null or length(legal_name) between 2 and 200),
  -- Either the domestic "předčíslí-číslo/kód" or an IBAN; both are checked loosely on
  -- purpose, because a rejected payout is a conversation and a rejected form is a lost partner.
  bank_account text check (bank_account is null or length(bank_account) between 6 and 34),
  -- Empty means "same as the venue address"; only a differing registered seat is stored.
  billing_address_line text,
  billing_city text,
  billing_postal_code text,
  contact_person text check (contact_person is null or length(contact_person) between 2 and 120),
  contact_phone text check (contact_phone is null or length(contact_phone) between 6 and 40),
  -- When, not whether: a boolean cannot answer "which version, and when did they agree".
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_billing enable row level security;

/*
 * No policy for anon and none for other customers. Unlike businesses, this table is never
 * granted to anon at all, so even a mistaken policy could not expose it.
 */
create policy business_billing_read on public.business_billing for select
  using (public.is_member_of(business_id) or public.is_admin());

revoke all on public.business_billing from anon, authenticated;
grant select on public.business_billing to authenticated;
grant all on public.business_billing to service_role;

/** The venue's own billing details, or an empty object before any have been entered. */
create function public.business_billing_get(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare row_data jsonb;
begin
  if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
  select to_jsonb(x) into row_data from (
    select ico, dic, legal_name, bank_account, billing_address_line, billing_city,
           billing_postal_code, contact_person, contact_phone, terms_accepted_at
    from public.business_billing where business_id = p_business_id
  ) x;
  return coalesce(row_data, '{}'::jsonb);
end $$;

/**
 * Upsert. Every field is optional and a key that is absent leaves the stored value alone,
 * so the same call serves registration and a later correction. `terms_accepted_at` is set
 * by the server from its own clock when the client says the box was ticked — a timestamp a
 * browser can choose is not a record of anything.
 */
create function public.business_billing_save(p_business_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
  insert into public.business_billing as t (
    business_id, ico, dic, legal_name, bank_account,
    billing_address_line, billing_city, billing_postal_code,
    contact_person, contact_phone, terms_accepted_at
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
    case when coalesce((p_data->>'terms_accepted')::boolean, false) then now() end
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
    -- Once accepted, never un-accepted by a later save that omitted the box.
    terms_accepted_at = coalesce(t.terms_accepted_at, case when coalesce((p_data->>'terms_accepted')::boolean, false) then now() end),
    updated_at = now();
  return public.business_billing_get(p_business_id);
end $$;

revoke execute on function public.business_billing_get(uuid), public.business_billing_save(uuid, jsonb) from public, anon;
grant execute on function public.business_billing_get(uuid), public.business_billing_save(uuid, jsonb) to authenticated, service_role;

/*
 * legal_name on businesses has been unchangeable since the schema was written: create_business
 * accepts it, update_business never mentioned it. It is the venue's public legal name, so it
 * stays on businesses; the invoicing name lives on business_billing beside the IČO.
 */
create or replace function public.update_business(p_business_id uuid,p_data jsonb) returns public.businesses language plpgsql security definer set search_path=public as $$
declare b public.businesses; lat float8; lng float8; win integer;
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 select * into b from public.businesses where id=p_business_id for update;
 lat:=coalesce((p_data->>'latitude')::float8,extensions.st_y(b.location::extensions.geometry));
 lng:=coalesce((p_data->>'longitude')::float8,extensions.st_x(b.location::extensions.geometry));
 if lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'VALIDATION_ERROR'; end if;
 win:=coalesce((p_data->>'cancellation_window_minutes')::integer,b.cancellation_window_minutes);
 if win not between 0 and 10080 then raise exception 'INVALID_CANCELLATION_WINDOW'; end if;
 update public.businesses set display_name=coalesce(p_data->>'display_name',display_name),legal_name=coalesce(nullif(btrim(p_data->>'legal_name'),''),legal_name),description=coalesce(p_data->>'description',description),category_slug=coalesce(p_data->>'category_slug',category_slug),phone=coalesce(p_data->>'phone',phone),public_email=coalesce(p_data->>'public_email',public_email),website=coalesce(p_data->>'website',website),address_line=coalesce(p_data->>'address_line',address_line),city=coalesce(p_data->>'city',city),district=coalesce(p_data->>'district',district),postal_code=coalesce(p_data->>'postal_code',postal_code),location=extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography,logo_url=coalesce(p_data->>'logo_url',logo_url),cover_url=coalesce(p_data->>'cover_url',cover_url),cancellation_window_minutes=win,updated_at=now() where id=p_business_id returning * into b;
 return b;
end $$;
