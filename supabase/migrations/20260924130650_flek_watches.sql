-- Hlídač FLEKů. Zákazník si uloží místo, dojezd (pěšky nebo MHD/kolem, 10–30 minut) a stejný filtr,
-- jaký má nad mapou, a když se v tom okruhu objeví nový FLEK, dostane upozornění v aplikaci,
-- podle nastavení i na telefon a e-mailem.
--
-- Dojezd je odhad vzdušnou čarou, ne trasa: pěšky 75 m za minutu (4,5 km/h), MHD nebo kolem
-- 200 m za minutu (12 km/h i s čekáním). Aplikace to tak i píše („zhruba").
-- Místo se ukládá zaokrouhlené na tři desetinná místa (asi 100 m): pro okruh kilometrů víc netřeba
-- a přesná adresa bydliště na serveru nemá co dělat.

create table private.flek_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (length(label) between 1 and 60),
  lat float8 not null check (lat between -90 and 90),
  lng float8 not null check (lng between -180 and 180),
  travel_mode text not null check (travel_mode in ('walk','ride')),
  travel_minutes smallint not null check (travel_minutes in (10,20,30)),
  radius_m integer not null check (radius_m between 500 and 6000),
  category text references public.categories(slug) on delete set null,
  max_price_cents integer check (max_price_cents is null or max_price_cents > 0),
  min_discount_pct smallint not null default 0 check (min_discount_pct between 0 and 90),
  daypart text check (daypart in ('morning','afternoon','evening')),
  follow_me boolean not null default false,
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  -- Upozorňuje se jen na FLEKy zveřejněné po tomhle okamžiku: po založení nebo přesunu hlídače
  -- zákazník to, co už v okolí je, vidí na mapě, a zahltit ho by byla chyba.
  armed_at timestamptz not null default now(),
  last_alert_at timestamptz,
  alerts_day date,
  alerts_count smallint not null default 0
);
create index flek_watches_user_id_idx on private.flek_watches(user_id);

-- Na který FLEK už daný hlídač upozornil, aby se žádný neohlásil dvakrát.
create table private.flek_watch_hits (
  watch_id uuid not null references private.flek_watches(id) on delete cascade,
  offer_id uuid not null references public.offers(id) on delete cascade,
  notified_at timestamptz not null default now(),
  primary key (watch_id, offer_id)
);
create index flek_watch_hits_offer_id_idx on private.flek_watch_hits(offer_id);

alter table private.flek_watches enable row level security;
alter table private.flek_watch_hits enable row level security;
revoke all on private.flek_watches, private.flek_watch_hits from public, anon, authenticated;

create function private.watch_radius(p_mode text, p_minutes integer) returns integer
language sql immutable set search_path = '' as $$
  select case p_mode when 'walk' then p_minutes * 75 when 'ride' then p_minutes * 200 end;
$$;

-- Co hlídač právě teď najde: rezervovatelné FLEKy do 48 hodin, v okruhu a podle filtru.
-- Denní části mají stejné hranice jako `search_offers`.
create function private.watch_matches(w private.flek_watches)
returns table(offer_id uuid, service_name text, business_name text, start_at timestamptz,
              deal_price_cents integer, published_at timestamptz, distance_m float8)
language sql stable security definer set search_path = '' as $$
  select d.id, d.service_name, d.business_name, d.start_at, d.deal_price_cents, d.published_at,
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

create function public.my_watches()
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

create function public.save_watch(
  p_id uuid, p_label text, p_lat float8, p_lng float8, p_travel_mode text, p_travel_minutes integer,
  p_category text, p_max_price_cents integer, p_min_discount_pct integer, p_daypart text,
  p_follow_me boolean, p_paused boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); wid uuid; old private.flek_watches%rowtype;
  lat_r float8 := round(p_lat::numeric, 3)::float8; lng_r float8 := round(p_lng::numeric, 3)::float8;
begin
  if me is null then raise exception 'UNAUTHORIZED'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
    or p_travel_mode is null or p_travel_mode not in ('walk','ride')
    or p_travel_minutes is null or p_travel_minutes not in (10,20,30)
    or coalesce(p_min_discount_pct, 0) not between 0 and 90
    or (p_max_price_cents is not null and p_max_price_cents <= 0)
    or (p_daypart is not null and p_daypart not in ('morning','afternoon','evening'))
    or (p_category is not null and not exists (select 1 from public.categories where slug = p_category))
    or length(trim(coalesce(p_label, ''))) not between 1 and 60
  then raise exception 'VALIDATION_ERROR'; end if;

  if p_id is null then
    -- Tři stačí na domov, práci a ještě jedno místo; víc by jen zahlcovalo.
    if (select count(*) from private.flek_watches where user_id = me) >= 3 then raise exception 'WATCH_LIMIT'; end if;
    insert into private.flek_watches(user_id, label, lat, lng, travel_mode, travel_minutes, radius_m, category,
      max_price_cents, min_discount_pct, daypart, follow_me, paused)
    values (me, trim(p_label), lat_r, lng_r, p_travel_mode, p_travel_minutes,
      private.watch_radius(p_travel_mode, p_travel_minutes), p_category, p_max_price_cents,
      coalesce(p_min_discount_pct, 0), p_daypart, coalesce(p_follow_me, false), coalesce(p_paused, false))
    returning id into wid;
    return wid;
  end if;

  select * into old from private.flek_watches where id = p_id and user_id = me for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update private.flek_watches set
    label = trim(p_label), lat = lat_r, lng = lng_r, travel_mode = p_travel_mode,
    travel_minutes = p_travel_minutes, radius_m = private.watch_radius(p_travel_mode, p_travel_minutes),
    category = p_category, max_price_cents = p_max_price_cents, min_discount_pct = coalesce(p_min_discount_pct, 0),
    daypart = p_daypart, follow_me = coalesce(p_follow_me, false), paused = coalesce(p_paused, false),
    -- Změněné místo nebo filtr je jako nový hlídač: ohlašuje se jen to, co přibude odteď.
    armed_at = case when (old.lat, old.lng, old.travel_mode, old.travel_minutes, old.category, old.max_price_cents,
        old.min_discount_pct, old.daypart, old.paused)
      is distinct from (lat_r, lng_r, p_travel_mode, p_travel_minutes::smallint, p_category, p_max_price_cents,
        coalesce(p_min_discount_pct, 0)::smallint, p_daypart, coalesce(p_paused, false))
      then now() else old.armed_at end
  where id = p_id;
  return p_id;
end $$;

create function public.delete_watch(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  delete from private.flek_watches where id = p_id and user_id = auth.uid();
end $$;

-- „Posouvat s mojí polohou": aplikace pošle novou polohu, když zákazník otevře mapu jinde.
-- Na pozadí prohlížeč polohu nesleduje, a FLEK to ani nepředstírá.
create function public.move_watch(p_id uuid, p_lat float8, p_lng float8) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'VALIDATION_ERROR';
  end if;
  update private.flek_watches
  set lat = round(p_lat::numeric, 3)::float8, lng = round(p_lng::numeric, 3)::float8, armed_at = now()
  where id = p_id and user_id = auth.uid() and follow_me
    -- Pod 300 m jde o šum GPS, ne o přesun.
    and extensions.st_distance(
      extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography) > 300;
end $$;

revoke all on function public.my_watches(), public.save_watch(uuid,text,float8,float8,text,integer,text,integer,integer,text,boolean,boolean),
  public.delete_watch(uuid), public.move_watch(uuid,float8,float8) from public, anon;
grant execute on function public.my_watches(), public.save_watch(uuid,text,float8,float8,text,integer,text,integer,integer,text,boolean,boolean),
  public.delete_watch(uuid), public.move_watch(uuid,float8,float8) to authenticated;

-- ------------------------------------------------------------------ upozornění

alter table public.notifications drop constraint notifications_event_check;
alter table public.notifications add constraint notifications_event_check
  check (event in ('requested','confirmed','cancelled','review_requested','account','watch'));
alter table public.notifications drop constraint notifications_booking_link;
alter table public.notifications add constraint notifications_booking_link
  check ((event in ('account','watch')) = (booking_id is null));
alter table public.notifications drop constraint notifications_href_check;
alter table public.notifications add constraint notifications_href_check
  check (href in ('/rezervace','/partner/rezervace','/partner/provozovna','/profil')
    or href ~ '^/rezervace\?ohodnotit=[0-9a-f-]{36}$'
    or href ~ '^/nabidka/[0-9a-f-]{36}$'
    or href ~ '^/mapa\?hlidac=[0-9a-f-]{36}$');
alter table public.notification_preferences drop constraint notification_preferences_event_check;
alter table public.notification_preferences add constraint notification_preferences_event_check
  check (event in ('requested','confirmed','cancelled','review_requested','watch'));

create or replace function public.save_notification_preference(
  p_scope text,p_event text,p_email boolean,p_push boolean,p_whatsapp boolean default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_event not in ('requested','confirmed','cancelled','review_requested','watch') or length(p_scope) not between 8 and 40 then
    raise exception 'INVALID_PREFERENCE';
  end if;
  if p_event in ('review_requested','watch') and p_scope<>'customer' then raise exception 'INVALID_PREFERENCE'; end if;
  if p_scope<>'customer' and not exists (
    select 1 from public.business_members where business_id::text=p_scope and user_id=auth.uid()
  ) then raise exception 'FORBIDDEN'; end if;
  -- Hlídač chodí e-mailem jen na výslovné přání; WhatsApp neumí (Meta by šablonu pro reklamu na
  -- nabídky schvalovala jako marketing) a připomenutí hodnocení e-mailem nechodí vůbec.
  insert into public.notification_preferences(user_id,scope,event,email,push,whatsapp)
  values(auth.uid(),p_scope,p_event,
    case when p_event='review_requested' then false else p_email end,
    p_push,
    case when p_event in ('review_requested','watch') then false else coalesce(p_whatsapp,true) end)
  on conflict(user_id,scope,event) do update set
    email=excluded.email,push=excluded.push,
    whatsapp=case when p_event in ('review_requested','watch') then false
      else coalesce(p_whatsapp,public.notification_preferences.whatsapp) end;
end $$;

-- Zprávy o vlastní smlouvě a účtu zákazníka chodí e-mailem vždy; hlídač jen když si ho zapnul.
create or replace function public.claim_notification_deliveries(p_channels text[])
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare result jsonb;
begin
  with eligible as (
    select id from private.notification_delivery
    where channel = any(p_channels) and status in ('pending', 'processing') and available_at <= now() and attempts < 8
    order by available_at for update skip locked limit 25
  ), claimed as (
    update private.notification_delivery d
    set status = 'processing', attempts = attempts + 1, lease = gen_random_uuid(), available_at = now() + interval '5 minutes'
    from eligible e where d.id = e.id returning d.*
  )
  select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
    'title', n.title, 'body', n.body, 'href', n.href, 'event', n.event, 'subscription', s.subscription,
    'customer', n.business_id is null,
    'contract', case when c.channel = 'email' and n.business_id is null and n.booking_id is not null then private.booking_contract(n.booking_id) end,
    'operator', case when c.channel = 'email' then private.operator_details() end,
    'allowed', (n.business_id is null or exists (select 1 from public.business_members m where m.business_id = n.business_id and m.user_id = n.user_id))
      and case
        when n.event = 'watch' and c.channel = 'email' then coalesce(p.email, false)
        when n.event = 'watch' then coalesce(p.push, true)
        -- Messages about the customer's own contract and account are not a preference.
        when c.channel = 'email' and n.business_id is null then true
        when c.channel = 'email' then coalesce(p.email, true)
        else coalesce(p.push, false) end)), '[]'::jsonb)
  into result
  from claimed c
  join public.notifications n on n.id = c.notification_id
  left join public.notification_preferences p on p.user_id = n.user_id and p.scope = coalesce(n.business_id::text, 'customer') and p.event = n.event
  left join private.push_subscriptions s on c.channel = 'push' and s.id::text = c.target and s.user_id = n.user_id;
  return result;
end $function$;

-- Cena a čas v češtině, jak je píše aplikace: „490 Kč", „dnes 17:30", „zítra 9:05".
create function private.watch_offer_line(p_service text, p_business text, p_start timestamptz, p_cents integer)
returns text language sql stable set search_path = '' as $$
  select p_service || ' · ' || p_business || ' · '
    || case (p_start at time zone 'Europe/Prague')::date - (now() at time zone 'Europe/Prague')::date
         when 0 then 'dnes ' when 1 then 'zítra '
         else to_char(p_start at time zone 'Europe/Prague', 'FMDD. FMMM. ') end
    || to_char(p_start at time zone 'Europe/Prague', 'FMHH24:MI')
    || ' · ' || replace(to_char(round(p_cents / 100.0), 'FM999G999'), ',', ' ') || ' Kč';
$$;

-- Běží každých 5 minut. Jeden hlídač pošle nejvýš jedno upozornění za 30 minut a nejvýš šest
-- za den; když se naráz objeví víc FLEKů, přijdou v jedné zprávě. Od 22 do 7 hodin jen do
-- aplikace, bez oznámení na telefon a e-mailu.
create function private.scan_watches() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  w private.flek_watches%rowtype; first_match record; total integer; nid uuid; sent integer := 0;
  prague timestamp := now() at time zone 'Europe/Prague';
  quiet boolean := extract(hour from prague) >= 22 or extract(hour from prague) < 7;
  today date := prague::date;
begin
  for w in
    select * from private.flek_watches
    where not paused
      and (last_alert_at is null or last_alert_at < now() - interval '30 minutes')
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
      left(private.watch_offer_line(first_match.service_name, first_match.business_name, first_match.start_at, first_match.deal_price_cents)
        || case when total > 1 then ' · a ' || (total - 1) || case when total - 1 < 5 then ' další' else ' dalších' end else '' end, 500),
      case when total = 1 then '/nabidka/' || first_match.offer_id else '/mapa?hlidac=' || w.id end)
    returning id into nid;

    if not quiet then
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
    end if;

    update private.flek_watches set last_alert_at = now(),
      alerts_count = case when alerts_day = today then alerts_count + 1 else 1 end, alerts_day = today
    where id = w.id;
    sent := sent + 1;
  end loop;
  if sent > 0 then perform private.kick_notification_delivery(); end if;
  return sent;
end $$;
revoke all on function private.scan_watches(), private.watch_offer_line(text,text,timestamptz,integer),
  private.watch_radius(text,integer) from public, anon, authenticated;

-- Záznamy o ohlášených FLEKech stačí na měsíc: starší nabídky už dávno proběhly.
select cron.schedule('flek-watch-scan', '*/5 * * * *', $$select private.scan_watches()$$);
select cron.schedule('flek-watch-hits-cleanup', '23 3 * * *',
  $$delete from private.flek_watch_hits where notified_at < now() - interval '30 days'$$);

-- Zásady 1.2 popisují hlídač: jeho místo je jediná poloha, kterou FLEK na serveru drží.
insert into public.legal_documents(kind, version) values ('privacy', '1.2');
update public.legal_documents set effective_at = now()
where kind = 'privacy' and version = '1.2';
