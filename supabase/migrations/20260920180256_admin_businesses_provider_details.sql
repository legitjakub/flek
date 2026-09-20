/*
 * Administrace potřebuje vidět, co vlastně schvaluje. Dosud měla jen název, kontakt a služby,
 * takže „Schválit“ u podniku bez IČO server odmítl a admin neměl kde zjistit proč.
 *
 * Posílá se jen to, co k rozhodnutí patří: kdo je poskytovatel (IČO, DIČ, typ, co na to ARES),
 * souhlas s podmínkami a kontaktní osoba. **Číslo účtu a datum narození se sem nedostanou** —
 * ke schválení nejsou potřeba a je to to nejcitlivější, co podnik vyplňuje; zůstávají tam, kde
 * je jich potřeba (výplaty, podklad DAC7).
 */
create or replace function public.admin_businesses(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(b) || jsonb_build_object(
    'latitude', extensions.st_y(b.location::extensions.geometry),
    'longitude', extensions.st_x(b.location::extensions.geometry),
    'owner_email', (select u.email from public.business_members m join auth.users u on u.id = m.user_id where m.business_id = b.id order by m.role limit 1),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration_minutes', s.duration_minutes, 'normal_price_cents', s.normal_price_cents, 'is_active', s.is_active) order by s.name), '[]') from public.services s where s.business_id = b.id),
    'upcoming_offers', (select count(*) from public.offers o where o.business_id = b.id and o.status = 'published' and o.start_at > now()),
    -- Ukázkový podnik smí být schválený bez IČO; skutečný ne.
    'is_demo', private.is_demo_business(b.id),
    'billing', (select jsonb_build_object(
        'ico', bb.ico, 'dic', bb.dic, 'seller_type', bb.seller_type, 'legal_name', bb.legal_name,
        'contact_person', bb.contact_person, 'contact_phone', bb.contact_phone,
        'terms_accepted_at', bb.terms_accepted_at,
        'ares_name', bb.ares_name, 'ares_address', bb.ares_address, 'ares_checked_at', bb.ares_checked_at,
        'billing_address_line', bb.billing_address_line, 'billing_city', bb.billing_city,
        'billing_postal_code', bb.billing_postal_code)
      from public.business_billing bb where bb.business_id = b.id)
   ) order by case when b.status = 'pending' then 0 else 1 end, b.created_at desc), '[]')
   from public.businesses b where p_status is null or b.status = p_status::public.business_status);
end $$;
