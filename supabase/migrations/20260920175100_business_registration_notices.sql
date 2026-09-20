/*
 * Nová provozovna se dosud nedozvěděl nikdo: majitel po odeslání přihlášky nedostal nic a admin
 * se o ní dozvěděl jen tím, že náhodou otevřel administraci. Zpráva chodila až při schválení nebo
 * zamítnutí. Teď obojí odejde hned po registraci, v aplikaci i e-mailem.
 *
 * Trigger visí na členství, ne na provozovně: `create_business` vkládá nejdřív provozovnu a
 * teprve potom vlastníka, takže při vložení provozovny ještě není komu psát.
 */
create function private.business_registered_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b public.businesses; a record; owner_email text;
begin
  if new.role::text <> 'owner' then return new; end if;
  select * into b from public.businesses where id = new.business_id;
  if b.id is null or b.status::text <> 'pending' then return new; end if;

  -- Demo podniky ze seedu by adminovi nasypaly osmnáct zpráv.
  select u.email into owner_email from auth.users u where u.id = new.user_id;
  if owner_email like '%@flek.test' then return new; end if;

  perform private.account_notice(new.user_id, b.id,
    'Přihlášku provozovny máme',
    b.display_name || ' čeká na schválení. Ozveme se, jakmile ji projdeme.',
    '/partner/provozovna');

  -- Admin, který si provozovnu registruje sám, už o ní ví.
  for a in select user_id from public.user_roles where role = 'admin' and user_id <> new.user_id loop
    perform private.account_notice(a.user_id, b.id,
      'Nová provozovna ke schválení',
      b.display_name || ' · ' || coalesce(nullif(btrim(b.address_line), ''), 'bez adresy')
        || ' · čeká v administraci.',
      '/admin');
  end loop;
  return new;
end $$;

create trigger business_registered_notice after insert on public.business_members
  for each row execute function private.business_registered_notice();

revoke all on function private.business_registered_notice() from public, anon, authenticated;
