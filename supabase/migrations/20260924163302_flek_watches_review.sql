-- Revize hlídače FLEKů po prvním nasazení.
--
-- 1. Smazání účtu hlídače nemazalo. `delete_my_account` účet anonymizuje, řádek v auth.users
--    zůstává, takže `on delete cascade` z tabulky hlídačů se nikdy nespustil a místo hlídače by
--    smazání účtu přežilo — přesně proti tomu, co slibují zásady.
-- 2. V noci se nehlídá vůbec, místo zpráv do aplikace ve tři ráno. Co přibude mezi 22. a 7.
--    hodinou, přijde v 7 jako jedna ranní zpráva, pokud je to pořád volné.
-- 3. Brzda 30 minut byla pro produkt „na poslední chvíli" moc dlouhá: FLEK za 45 minut by
--    mohl přijít pozdě. Teď 15 minut; strop šesti zpráv denně zůstává.
-- 4. Zpráva říká i slevu, protože právě ta je důvod, proč hlídač existuje.

create or replace function public.delete_my_account()
 returns text language plpgsql security definer set search_path to '' as $function$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id = u for update;
  if exists (select 1 from public.business_members where user_id = u) then raise exception 'BUSINESS_MEMBER'; end if;
  if exists (select 1 from public.user_roles where user_id = u) then raise exception 'FORBIDDEN'; end if;
  if exists (select 1 from public.bookings where customer_id = u
             and status in ('pending_payment','pending_merchant','capturing','confirmed') and end_at_snapshot > now()) then
    raise exception 'ACTIVE_BOOKINGS';
  end if;

  update private.content_moderation set status='superseded',updated_at=now()
  where author_id=u and entity_type='review' and status in ('pending','processing','manual_review');
  update public.bookings set rating=null,rated_at=null,review_body=null,review_status=null,
    review_moderation_id=null,review_moderated_at=null where customer_id=u;
  delete from public.favorites where user_id=u;
  delete from private.flek_watches where user_id=u;
  delete from private.push_subscriptions where user_id=u;
  delete from private.whatsapp_contacts where kind='customer' and user_id=u;
  delete from public.notification_preferences where user_id=u;
  delete from public.notifications where user_id=u;
  delete from public.referral_codes where user_id=u;
  update public.analytics_events set user_id=null where user_id=u;
  update public.content_reports set reporter_id=null where reporter_id=u;
  update public.profiles set first_name='Smazaný',last_name='účet',phone=null,avatar_url=null,updated_at=now() where id=u;

  update auth.users set email='smazany-'||u::text||'@smazany.invalid',phone=null,encrypted_password=null,
    raw_user_meta_data='{}'::jsonb,banned_until='2999-01-01 00:00:00+00'::timestamptz,updated_at=now() where id=u;
  delete from auth.identities where user_id=u;
  delete from auth.mfa_factors where user_id=u;
  delete from auth.one_time_tokens where user_id=u;
  delete from auth.sessions where user_id=u;
  delete from auth.refresh_tokens where user_id=u::text;

  perform private.kick_content_moderation();
  perform private.audit('account_deleted','user',u,null,null,'Smazání účtu zákazníkem');
  return 'deleted';
end $function$;

-- Účty smazané před touto opravou.
delete from private.flek_watches w using auth.users u
where u.id = w.user_id and u.email like 'smazany-%@smazany.invalid';

drop function private.watch_matches(private.flek_watches);
create function private.watch_matches(w private.flek_watches)
returns table(offer_id uuid, service_name text, business_name text, start_at timestamptz,
              deal_price_cents integer, discount_pct integer, published_at timestamptz, distance_m float8)
language sql stable security definer set search_path = '' as $$
  select d.id, d.service_name, d.business_name, d.start_at, d.deal_price_cents, d.discount_pct, d.published_at,
    extensions.st_distance(b.location, extensions.st_setsrid(extensions.st_makepoint(w.lng, w.lat), 4326)::extensions.geography)
  from public.offer_details d
  join public.businesses b on b.id = d.business_id
  where d.bookable
    and d.start_at < now() + interval '48 hours'
    and (w.category is null or d.category_slug = w.category)
    and d.discount_pct >= w.min_discount_pct
    and (w.max_price_cents is null or d.deal_price_cents <= w.max_price_cents)
    and (w.daypart is null or case w.daypart
          when 'morning' then extract(hour from d.start_at at time zone 'Europe/Prague') < 12
          when 'afternoon' then extract(hour from d.start_at at time zone 'Europe/Prague') between 12 and 16
          else extract(hour from d.start_at at time zone 'Europe/Prague') >= 17 end)
    and extensions.st_dwithin(b.location,
          extensions.st_setsrid(extensions.st_makepoint(w.lng, w.lat), 4326)::extensions.geography, w.radius_m);
$$;
revoke all on function private.watch_matches(private.flek_watches) from public, anon, authenticated;

-- Beze změny, jen znovu nad novou `watch_matches`.
create or replace function public.my_watches()
returns table(id uuid, label text, lat float8, lng float8, travel_mode text, travel_minutes integer,
              radius_m integer, category text, max_price_cents integer, min_discount_pct integer,
              daypart text, follow_me boolean, paused boolean, created_at timestamptz,
              last_alert_at timestamptz, matching_now integer)
language sql stable security definer set search_path = '' as $$
  select w.id, w.label, w.lat, w.lng, w.travel_mode, w.travel_minutes::integer, w.radius_m, w.category,
    w.max_price_cents, w.min_discount_pct::integer, w.daypart, w.follow_me, w.paused, w.created_at,
    w.last_alert_at, (select count(*)::integer from private.watch_matches(w))
  from private.flek_watches w
  where w.user_id = auth.uid()
  order by w.created_at;
$$;

drop function private.watch_offer_line(text, text, timestamptz, integer);
-- „Masáž zad · Studio Karlín · dnes 17:30 · 490 Kč (−38 %)"
create function private.watch_offer_line(p_service text, p_business text, p_start timestamptz, p_cents integer, p_discount integer)
returns text language sql stable set search_path = '' as $$
  select p_service || ' · ' || p_business || ' · '
    || case (p_start at time zone 'Europe/Prague')::date - (now() at time zone 'Europe/Prague')::date
         when 0 then 'dnes ' when 1 then 'zítra '
         else to_char(p_start at time zone 'Europe/Prague', 'FMDD. FMMM. ') end
    || to_char(p_start at time zone 'Europe/Prague', 'FMHH24:MI')
    || ' · ' || replace(to_char(round(p_cents / 100.0), 'FM999G999'), ',', ' ') || ' Kč'
    || case when p_discount > 0 then ' (−' || p_discount || ' %)' else '' end;
$$;
revoke all on function private.watch_offer_line(text, text, timestamptz, integer, integer) from public, anon, authenticated;

create or replace function private.scan_watches() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  w private.flek_watches%rowtype; first_match record; total integer; nid uuid; sent integer := 0;
  prague timestamp := now() at time zone 'Europe/Prague';
  today date := prague::date;
begin
  -- V noci se nehlídá: nic se nezapíše jako ohlášené, takže v 7 přijde jedna ranní zpráva
  -- s tím, co přes noc přibylo a je pořád volné.
  if extract(hour from prague) >= 22 or extract(hour from prague) < 7 then return 0; end if;

  for w in
    select * from private.flek_watches
    where not paused
      and (last_alert_at is null or last_alert_at < now() - interval '15 minutes')
      and (alerts_day is distinct from today or alerts_count < 6)
    for update skip locked
  loop
    select m.*, count(*) over () as total_count into first_match
    from private.watch_matches(w) m
    where m.published_at > w.armed_at
      and not exists (select 1 from private.flek_watch_hits h where h.watch_id = w.id and h.offer_id = m.offer_id)
    order by m.start_at, m.distance_m
    limit 1;
    continue when not found;
    total := first_match.total_count;

    insert into private.flek_watch_hits(watch_id, offer_id)
    select w.id, m.offer_id from private.watch_matches(w) m
    where m.published_at > w.armed_at
    on conflict do nothing;

    insert into public.notifications(user_id, booking_id, business_id, event, title, body, href)
    values (w.user_id, null, null, 'watch',
      left(case when total = 1 then 'Nový FLEK v okolí'
        when total between 2 and 4 then total || ' nové FLEKy v okolí'
        else total || ' nových FLEKů v okolí' end || ' · ' || w.label, 120),
      left(private.watch_offer_line(first_match.service_name, first_match.business_name, first_match.start_at,
          first_match.deal_price_cents, first_match.discount_pct)
        || case when total > 1 then ' · a ' || (total - 1) || case when total - 1 < 5 then ' další' else ' dalších' end else '' end, 500),
      case when total = 1 then '/nabidka/' || first_match.offer_id else '/mapa?hlidac=' || w.id end)
    returning id into nid;

    insert into private.notification_delivery(notification_id, channel, target)
    select nid, 'push', s.id::text from private.push_subscriptions s
    where s.user_id = w.user_id and coalesce((
      select push from public.notification_preferences where user_id = w.user_id and scope = 'customer' and event = 'watch'
    ), true);
    insert into private.notification_delivery(notification_id, channel, target)
    select nid, 'email', u.email from auth.users u
    where u.id = w.user_id and u.email_confirmed_at is not null and u.email not like '%@flek.test'
      and coalesce((
        select email from public.notification_preferences where user_id = w.user_id and scope = 'customer' and event = 'watch'
      ), false);

    update private.flek_watches set last_alert_at = now(),
      alerts_count = case when alerts_day = today then alerts_count + 1 else 1 end, alerts_day = today
    where id = w.id;
    sent := sent + 1;
  end loop;
  if sent > 0 then perform private.kick_notification_delivery(); end if;
  return sent;
end $$;
revoke all on function private.scan_watches() from public, anon, authenticated;
