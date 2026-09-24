-- Regression test for the FLEK watch: every fixture and side effect is rolled back.
-- Run against the demo database (demo-10, demo-11 exist there).
begin;
delete from private.notification_config where key = 'worker_secret';

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.raises(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  a uuid := (select id from auth.users where email = 'demo-10@flek.test');
  b uuid := (select id from auth.users where email = 'demo-11@flek.test');
  w1 uuid; w2 uuid; sent integer; n record;
begin
  perform set_config('request.jwt.claims', '', true);
  assert pg_temp.raises($q$select public.save_watch(null,'x',50,14,'walk',10,null,null,0,null,false,false)$q$) = 'UNAUTHORIZED', 'anonymous save';

  perform pg_temp.act_as(a);
  assert pg_temp.raises($q$select public.save_watch(null,'x',50,14,'walk',15,null,null,0,null,false,false)$q$) = 'VALIDATION_ERROR', 'minutes outside 10/20/30';
  assert pg_temp.raises($q$select public.save_watch(null,'x',50,14,'car',10,null,null,0,null,false,false)$q$) = 'VALIDATION_ERROR', 'unknown mode';
  assert pg_temp.raises($q$select public.save_watch(null,'x',50,14,'walk',10,'neexistuje',null,0,null,false,false)$q$) = 'VALIDATION_ERROR', 'unknown category';

  w1 := public.save_watch(null, 'Kolem centra', 50.087512, 14.421299, 'ride', 30, null, null, 0, null, true, false);
  w2 := public.save_watch(null, 'Druhý', 50.1, 14.4, 'walk', 10, null, null, 0, null, false, true);
  perform public.save_watch(null, 'Třetí', 50.1, 14.4, 'walk', 10, null, null, 0, null, false, false);
  assert pg_temp.raises($q$select public.save_watch(null,'Čtvrtý',50.1,14.4,'walk',10,null,null,0,null,false,false)$q$) = 'WATCH_LIMIT', 'fourth watch';

  select * into n from private.flek_watches where id = w1;
  assert n.lat = 50.088 and n.lng = 14.421, 'point is rounded to ~100 m';
  assert n.radius_m = 6000, 'radius comes from the server';
  assert (select count(*) from public.my_watches()) = 3, 'own watches listed';

  perform pg_temp.act_as(b);
  assert (select count(*) from public.my_watches()) = 0, 'someone else sees none';
  perform public.delete_watch(w1);
  assert exists (select 1 from private.flek_watches where id = w1), 'someone else cannot delete';
  assert pg_temp.raises(format('select public.save_watch(%L,''x'',50,14,''walk'',10,null,null,0,null,false,false)', w1)) = 'NOT_FOUND', 'someone else cannot edit';

  -- Pretend the watch has existed for a month so today's FLEKs count as new.
  update private.flek_watches set armed_at = now() - interval '30 days' where id in (w1, w2);
  sent := private.scan_watches();
  assert sent = 1, 'one alert: the paused watch stays silent';
  select * into n from public.notifications where user_id = a and event = 'watch';
  assert n.booking_id is null and n.business_id is null, 'watch alert is not tied to a booking';
  assert n.href ~ '^/(nabidka/|mapa\?hlidac=)', 'alert links to the FLEK or the map';
  assert (select count(*) from private.notification_delivery d where d.notification_id = n.id and d.channel = 'email') = 0,
    'no e-mail unless switched on';
  assert private.scan_watches() = 0, 'at most one alert per half hour';

  -- Moving a follow-me watch: under 300 m nothing happens, further on it moves and re-arms.
  perform pg_temp.act_as(a);
  perform public.move_watch(w1, 50.0885, 14.4215);
  assert (select lat from private.flek_watches where id = w1) = 50.088, 'GPS jitter ignored';
  perform public.move_watch(w1, 50.1024, 14.4482);
  assert (select lat from private.flek_watches where id = w1) = 50.102, 'moved to the new place';
  assert (select armed_at > now() - interval '1 minute' from private.flek_watches where id = w1), 're-armed after moving';

  perform public.delete_watch(w1);
  assert not exists (select 1 from private.flek_watches where id = w1), 'own watch deleted';
  raise notice 'watches.sql: PASS';
end $$;
rollback;
