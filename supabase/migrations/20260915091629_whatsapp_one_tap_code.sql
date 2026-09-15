/*
 * Ověření WhatsAppu jedním klepnutím: kód může vytvořit aplikace.
 *
 * WhatsApp s připravenou zprávou spolehlivě otevře (i na iPhonu) jen odkaz, na který člověk sám
 * klepne, ne okno otevřené až po odpovědi serveru. Tlačítko „Ověřit ve WhatsAppu“ je proto
 * obyčejný odkaz na wa.me se zprávou „FLEK 123456“, jejíž kód vytvoří aplikace náhodně
 * (crypto.getRandomValues) a v tomtéž klepnutí ho pošle sem spolu se souhlasem. Databáze dál
 * ukládá jen hash. Na bezpečnosti to nic nemění: číslo ověří jen zpráva s tím kódem, která přijde
 * přímo z toho čísla, a limit pěti kódů za hodinu platí stejně.
 */

drop function public.whatsapp_start_pairing(uuid, text, text);
create function public.whatsapp_start_pairing(p_business_id uuid default null, p_phone text default null,
  p_consent_version text default null, p_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  phone text;
  flek_number text := private.setting('whatsapp_display_number');
  code text := coalesce(p_code, lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0'));
  c private.whatsapp_contacts;
begin
  perform private.whatsapp_owner(p_business_id);
  if flek_number is null then raise exception 'WHATSAPP_UNAVAILABLE'; end if;
  if p_consent_version is distinct from private.whatsapp_consent_version() then raise exception 'CONSENT_REQUIRED'; end if;
  if code !~ '^[0-9]{6}$' then raise exception 'VALIDATION_ERROR'; end if;
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

revoke all on function public.whatsapp_start_pairing(uuid, text, text, text) from public, anon;
grant execute on function public.whatsapp_start_pairing(uuid, text, text, text) to authenticated;
