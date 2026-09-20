-- Privileged regression test for sign-in with Google and Apple: every fixture is rolled back.
-- The trigger on auth.users is the only place a profile is created, so the name a provider sends
-- (Google: full_name/name or given_name/family_name; Apple on the web: nothing) has to land there.
-- Run against a migrated database; it needs no demo fixtures.
begin;

create function pg_temp.signs_in(p_meta jsonb) returns public.profiles language plpgsql as $$
declare
  new_user uuid := gen_random_uuid();
  created public.profiles;
begin
  -- What GoTrue writes when a provider returns: the identity metadata becomes raw_user_meta_data.
  insert into auth.users (id, email, raw_user_meta_data)
  values (new_user, 'qa-oauth-' || left(new_user::text, 8) || '@flek.test', p_meta);
  select * into created from public.profiles where id = new_user;
  return created;
end $$;

do $$
declare p public.profiles;
begin
  -- Google sends the whole name; the first word is the first name and the rest the surname.
  p := pg_temp.signs_in(jsonb_build_object(
    'iss', 'https://accounts.google.com', 'email', 'jana@example.com', 'email_verified', true,
    'full_name', 'Jana Nováková Dvořáková', 'name', 'Jana Nováková Dvořáková',
    'avatar_url', 'https://lh3.googleusercontent.com/a/x', 'provider_id', '1029384756'));
  assert p.id is not null, 'Google sign-in created no profile';
  assert p.first_name = 'Jana', format('Google first name is %L', p.first_name);
  assert p.last_name = 'Nováková Dvořáková', format('Google surname is %L', p.last_name);

  -- Separate fields win over the whole name, whichever order they arrive in.
  p := pg_temp.signs_in(jsonb_build_object(
    'given_name', 'Petr', 'family_name', 'Svoboda', 'name', 'Petr Svoboda', 'email', 'petr@example.com'));
  assert p.first_name = 'Petr' and p.last_name = 'Svoboda', format('Google fields gave %L %L', p.first_name, p.last_name);

  -- Sign in with Apple on the web returns no name at all (Apple sends it only to native apps), so the
  -- profile stays blank and the booking sheet asks for the name before the first booking.
  p := pg_temp.signs_in(jsonb_build_object(
    'iss', 'https://appleid.apple.com', 'email', 'qa@privaterelay.appleid.com',
    'email_verified', true, 'provider_id', '001234.abc.5678', 'sub', '001234.abc.5678'));
  assert p.id is not null, 'Apple sign-in created no profile';
  assert p.first_name = '' and p.last_name = '', format('Apple left %L %L instead of blanks', p.first_name, p.last_name);

  -- A name that is only spaces is a blank name, not a profile called " ".
  p := pg_temp.signs_in(jsonb_build_object('full_name', '   ', 'email', 'prazdne@example.com'));
  assert p.first_name = '' and p.last_name = '', format('Whitespace name gave %L %L', p.first_name, p.last_name);

  -- One-word name: a first name without a surname, the same as an e-mail sign-up with an empty surname.
  p := pg_temp.signs_in(jsonb_build_object('name', 'Madonna', 'email', 'madonna@example.com'));
  assert p.first_name = 'Madonna' and p.last_name = '', format('One-word name gave %L %L', p.first_name, p.last_name);

  -- Sign-up by e-mail keeps sending first_name and last_name and must not change.
  p := pg_temp.signs_in(jsonb_build_object(
    'first_name', 'Tomáš', 'last_name', 'Krátký', 'signup_role', 'customer', 'signup_return_to', '/nabidka/abc'));
  assert p.first_name = 'Tomáš' and p.last_name = 'Krátký', format('E-mail sign-up gave %L %L', p.first_name, p.last_name);

  -- The column holds 80 characters; a longer name is cut, never refused.
  p := pg_temp.signs_in(jsonb_build_object('first_name', repeat('a', 120), 'last_name', repeat('b', 120)));
  assert length(p.first_name) = 80 and length(p.last_name) = 80, format('Long name gave %s and %s characters', length(p.first_name), length(p.last_name));

  -- A provider that sends nothing at all still gets a profile; without one the app has no customer.
  p := pg_temp.signs_in('{}'::jsonb);
  assert p.id is not null and p.first_name = '' and p.last_name = '', 'Empty metadata left no profile';

  -- Neither sign-in touches the merchant side: a fresh account manages no business.
  assert not exists (select 1 from public.business_members m where m.user_id = p.id), 'Sign-in granted a business';
end $$;

rollback;
select 'PASS: Google whole name and separate fields, Apple web without a name, blank and one-word names, e-mail sign-up unchanged, 80-character limit; all fixtures rolled back' as result;
