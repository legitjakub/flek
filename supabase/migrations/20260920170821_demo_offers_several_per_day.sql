/*
 * Demo FLEKy: několik termínů na službu a den místo jednoho.
 *
 * Jeden termín denně znamenal, že po jeho odbavení byl feed do večera prázdný — dnes v poledne
 * zbývaly ze 29 publikovaných nabídek tři rezervovatelné. Termíny se teď rozsazují po půlhodinách
 * mezi 8:00 a 20:00 pražského času, a to rotací, takže dva FLEKy jedné služby jsou hodiny od sebe,
 * ne za sebou. Ostatní pravidla zůstávají: jen demo podniky se zapnutým Stripe, žádné překryvy
 * v jedné provozovně, cena a poplatek přes `private.validate_flek`.
 */
drop function if exists private.flek_demo_refresh(integer);

create or replace function private.flek_demo_refresh(p_days integer default 3, p_per_day integer default 3)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s record;
  d date;
  today date := (now() at time zone 'Europe/Prague')::date;
  starts timestamptz;
  merchant integer;
  fee integer;
  seats integer;
  target integer := least(greatest(p_per_day, 1), 6);
  have integer;
  made integer;
  slot integer;
  created integer := 0;
  skipped integer := 0;
begin
  for s in
    select sv.id, sv.business_id, sv.duration_minutes, sv.normal_price_cents, sv.category_slug
    from public.services sv
    join public.businesses b on b.id = sv.business_id
    where sv.is_active and b.status = 'approved' and b.stripe_account_id is not null and b.stripe_charges_enabled
      and exists (select 1 from public.business_members m where m.business_id = b.id)
      and not exists (
        select 1 from public.business_members m join auth.users u on u.id = m.user_id
        where m.business_id = b.id and u.email not like '%@flek.test')
    order by sv.business_id, sv.id
  loop
    for i in 0 .. least(greatest(p_days, 1), 7) - 1 loop
      d := today + i;
      select count(*) into have from public.offers o
      where o.service_id = s.id and o.status = 'published'
        and (o.start_at at time zone 'Europe/Prague')::date = d;
      made := 0;

      -- Půlhodinové sloty 8:00–20:00, procházené s krokem 7 (nesoudělné s 25), takže rotace
      -- projde všechny a sousední termíny téže služby dělí několik hodin.
      for j in 0 .. 24 loop
        exit when have + made >= target;
        slot := (abs(hashtext(s.id::text || d::text)) + j * 7) % 25;
        starts := (d + make_interval(hours => 8, mins => 30 * slot)) at time zone 'Europe/Prague';
        -- Termín, na který by se nedalo včas dojet, nemá smysl zveřejňovat.
        continue when starts <= now() + interval '45 minutes';
        continue when exists (
          select 1 from public.offers o
          where o.business_id = s.business_id and o.status = 'published'
            and o.start_at < starts + make_interval(mins => s.duration_minutes) and o.end_at > starts);

        -- Podnik chce 55–70 % běžné ceny, v celých korunách; jiný slot, jiná cena.
        merchant := (s.normal_price_cents * (55 + abs(hashtext(d::text || s.id::text || j::text)) % 16) / 100 / 100) * 100;
        begin
          fee := private.validate_flek(starts, starts - interval '15 minutes', merchant, s.normal_price_cents);
        exception when others then
          skipped := skipped + 1;
          continue;
        end;
        seats := case when s.category_slug = 'joga' then 4 else 1 end;

        insert into public.offers (business_id, service_id, start_at, end_at, original_price_cents, deal_price_cents,
          merchant_price_cents, service_fee_cents, fee_policy_version, capacity_total, capacity_remaining, booking_cutoff_at)
        values (s.business_id, s.id, starts, starts + make_interval(mins => s.duration_minutes), s.normal_price_cents,
          merchant + fee, merchant, fee, private.flek_current_fee_policy(), seats, seats, starts - interval '15 minutes');
        created := created + 1;
        made := made + 1;
      end loop;

      if have + made < target then
        skipped := skipped + 1;
      end if;
    end loop;
  end loop;

  perform private.emit('demo_offers_refreshed', jsonb_build_object('created', created, 'skipped', skipped));
  return jsonb_build_object('created', created, 'skipped', skipped);
end $$;

revoke all on function private.flek_demo_refresh(integer, integer) from public, anon, authenticated;
