-- WhatsApp: číslo FLEKu a stav kanálu pro administraci.
--
-- Zobrazované číslo FLEKu (`whatsapp_display_number`) dosud zapisoval agent ručně SQL. Teď ho
-- admin převezme jedním klepnutím z údajů, které o čísle vrátí Meta (`whatsapp-templates-setup`),
-- a změna se zapíše do auditu jako každá jiná admin mutace. Číslo se ukládá ve tvaru E.164,
-- který čekají odkazy wa.me i zobrazení v aplikaci.

create function public.admin_whatsapp_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'display_number', private.setting('whatsapp_display_number'),
    'enabled', coalesce(private.setting('whatsapp_enabled')::boolean, false),
    'contacts_verified', (select count(*) from private.whatsapp_contacts where status = 'verified'),
    'messages', (select count(*) from private.whatsapp_messages));
end $$;
revoke all on function public.admin_whatsapp_state() from public, anon;
grant execute on function public.admin_whatsapp_state() to authenticated, service_role;

create function public.admin_set_whatsapp_display_number(p_number text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  old_value text := private.setting('whatsapp_display_number');
  e164 text := '+' || regexp_replace(coalesce(p_number, ''), '\D', '', 'g');
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if e164 !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'VALIDATION_ERROR'; end if;
  insert into private.settings(key, value, updated_at) values ('whatsapp_display_number', e164, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
  perform private.audit('whatsapp_number_changed', 'settings', gen_random_uuid(),
    jsonb_build_object('display_number', old_value), jsonb_build_object('display_number', e164), null);
  return e164;
end $$;
revoke all on function public.admin_set_whatsapp_display_number(text) from public, anon;
grant execute on function public.admin_set_whatsapp_display_number(text) to authenticated, service_role;
