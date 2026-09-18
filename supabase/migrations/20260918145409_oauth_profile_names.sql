/*
 * Přihlášení přes Google a Apple: jméno do profilu z údajů, které poskytovatel pošle. Registrace
 * e-mailem posílá first_name a last_name jako dřív; Google posílá celé jméno (full_name, name), Apple
 * nejvýš při prvním přihlášení. Chybějící jméno a telefon si aplikace vyžádá u první rezervace.
 */
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = 'public' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  whole text := btrim(coalesce(nullif(meta->>'full_name', ''), meta->>'name', ''));
  given text := nullif(btrim(coalesce(meta->>'first_name', meta->>'given_name', '')), '');
  family text := nullif(btrim(coalesce(meta->>'last_name', meta->>'family_name', '')), '');
begin
  -- A provider that sends only the whole name: the first word is the first name, the rest the surname.
  if given is null and whole <> '' then
    given := split_part(whole, ' ', 1);
    family := coalesce(family, nullif(btrim(substr(whole, length(given) + 1)), ''));
  end if;
  insert into public.profiles (id, first_name, last_name)
  values (new.id, left(coalesce(given, ''), 80), left(coalesce(family, ''), 80));
  return new;
end $$;
