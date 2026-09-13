/*
 * Demo inventory that renews itself.
 *
 * The public demo has no merchant who publishes every morning, so the seeded FLEKs ran out two
 * days after the seed and the feed went empty. Every day this tops each demo service up to one
 * FLEK per day for the next three Prague days, priced and validated exactly like publish_flek.
 *
 * Only businesses whose every member is a @flek.test account are touched: a real merchant never
 * gets a generated FLEK. Slots and prices come from a hash of service and day, so a second run on
 * the same day creates nothing new. Before a real pilot on this database, stop it:
 *   select cron.unschedule('flek-demo-refresh');
 */
create or replace function private.flek_demo_refresh(p_days integer default 3)
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
  created integer := 0;
  skipped integer := 0;
begin
  for s in
    select sv.id, sv.business_id, sv.duration_minutes, sv.normal_price_cents, sv.category_slug
    from public.services sv
    join public.businesses b on b.id = sv.business_id
    where sv.is_active and b.status = 'approved'
      and exists (select 1 from public.business_members m where m.business_id = b.id)
      and not exists (
        select 1 from public.business_members m join auth.users u on u.id = m.user_id
        where m.business_id = b.id and u.email not like '%@flek.test')
    order by sv.business_id, sv.id
  loop
    for i in 0 .. least(greatest(p_days, 1), 7) - 1 loop
      d := today + i;
      continue when exists (
        select 1 from public.offers o
        where o.service_id = s.id and o.status = 'published'
          and (o.start_at at time zone 'Europe/Prague')::date = d);

      -- A half-hour slot between 8:00 and 20:00 Prague time.
      starts := (d + make_interval(hours => 8, mins => 30 * (abs(hashtext(s.id::text || d::text)) % 25)))
        at time zone 'Europe/Prague';
      if starts <= now() + interval '45 minutes' then
        -- Today's slot has gone: offer the next round hour that still leaves time to book.
        starts := date_trunc('hour', now()) + interval '2 hours';
        if (starts at time zone 'Europe/Prague')::date <> d
           or extract(hour from starts at time zone 'Europe/Prague') > 20 then
          skipped := skipped + 1;
          continue;
        end if;
      end if;

      if exists (
        select 1 from public.offers o
        where o.business_id = s.business_id and o.status = 'published'
          and o.start_at < starts + make_interval(mins => s.duration_minutes) and o.end_at > starts) then
        skipped := skipped + 1;
        continue;
      end if;

      -- The merchant asks 55–70 % of the regular price, in whole crowns.
      merchant := (s.normal_price_cents * (55 + abs(hashtext(d::text || s.id::text)) % 16) / 100 / 100) * 100;
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
    end loop;
  end loop;

  perform private.emit('demo_offers_refreshed', jsonb_build_object('created', created, 'skipped', skipped));
  return jsonb_build_object('created', created, 'skipped', skipped);
end $$;

revoke all on function private.flek_demo_refresh(integer) from public, anon, authenticated;

-- 03:00 UTC is 05:00 Prague in summer and 04:00 in winter, before anyone opens the demo.
select cron.schedule('flek-demo-refresh', '0 3 * * *', $$select private.flek_demo_refresh()$$);
