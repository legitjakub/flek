-- Privileged regression test for verified reviews, fail-closed content moderation and private-table RLS.
-- Run against a migrated demo database. Every fixture and side effect is rolled back.
begin;
delete from private.notification_config where key = 'worker_secret';

create function pg_temp.act_as(p_user uuid, p_role text default 'authenticated') returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', p_role)::text, true)
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
  booking public.bookings; other_customer uuid; merchant uuid; admin_user uuid; service public.services;
  review_job uuid; service_job uuid; lease_id uuid; response jsonb; old_name text; old_image text;
begin
  select k.* into booking from public.bookings k
  where k.status='completed'
    and exists(select 1 from public.business_members m where m.business_id=k.business_id)
  order by k.resolved_at desc nulls last limit 1;
  select id into other_customer from auth.users where email='demo-6@flek.test';
  select user_id into merchant from public.business_members where business_id=booking.business_id limit 1;
  select id into admin_user from auth.users where email='demo-admin@flek.test';
  select s.* into service from public.services s join public.offers o on o.service_id=s.id where o.id=booking.offer_id;
  assert booking.id is not null and other_customer is not null and merchant is not null and admin_user is not null and service.id is not null,
    'Demo fixtures missing';

  delete from public.notifications where booking_id=booking.id and event='review_requested';
  update public.bookings set status='confirmed',rating=null,rated_at=null,review_body=null,review_status=null,
    review_moderation_id=null,review_moderated_at=null where id=booking.id;

  perform pg_temp.act_as(other_customer);
  assert pg_temp.raises(format('select public.submit_booking_review(%L,5,%L)',booking.id,'Cizí recenze'))='FORBIDDEN',
    'Another customer reviewed the booking';
  perform pg_temp.act_as(booking.customer_id);
  assert pg_temp.raises(format('select public.submit_booking_review(%L,5,%L)',booking.id,'Před návštěvou'))='BOOKING_NOT_COMPLETED',
    'An unfinished booking was reviewed';

  update public.bookings set status='completed' where id=booking.id;
  update public.bookings set status='completed' where id=booking.id;
  assert (select count(*) from public.notifications where booking_id=booking.id and event='review_requested')=1,
    'Review reminder was not idempotent';
  assert not exists(
    select 1 from private.notification_delivery d join public.notifications n on n.id=d.notification_id
    where n.booking_id=booking.id and n.event='review_requested' and d.channel in ('email','whatsapp')
  ), 'Review reminder queued e-mail or WhatsApp';

  response:=public.submit_booking_review(booking.id,4,'Příjemná ověřená návštěva.');
  select review_moderation_id into review_job from public.bookings where id=booking.id;
  assert response->>'review_status'='pending' and review_job is not null
    and (select rating=4 and review_body is null from public.bookings where id=booking.id),
    'Review was not queued fail-closed';
  assert exists(select 1 from public.business_reviews(booking.business_id,10,null) r
    where r.review_id=booking.id and r.rating=4 and r.comment is null and r.verified),
    'Pending review leaked text or lost its verified rating';

  lease_id:=gen_random_uuid();
  update private.content_moderation set status='processing',lease=lease_id,lease_until=now()+interval '2 minutes'
  where id=review_job;
  perform pg_temp.act_as(null,'service_role');
  assert public.finish_content_moderation(review_job,lease_id,'approved','{"flagged":false}'::jsonb,null,'{}'::jsonb)='approved',
    'Safe review was not approved';
  assert exists(select 1 from public.business_reviews(booking.business_id,10,null) r
    where r.review_id=booking.id and r.comment='Příjemná ověřená návštěva.'),
    'Approved review text is not public';

  old_name:=service.name; old_image:=service.image_url;
  perform pg_temp.act_as(merchant);
  perform public.save_service(booking.business_id,jsonb_build_object(
    'name','QA moderovaná služba','description','Bezpečný veřejný popis.'),service.id);
  select pending_moderation_id into service_job from public.services where id=service.id;
  assert service_job is not null
    and (select name=old_name and image_url is not distinct from old_image and content_status='pending' from public.services where id=service.id),
    'A service change became public before moderation or lost its photo';
  lease_id:=gen_random_uuid();
  update private.content_moderation set status='processing',lease=lease_id,lease_until=now()+interval '2 minutes'
  where id=service_job;
  perform pg_temp.act_as(null,'service_role');
  perform public.finish_content_moderation(service_job,lease_id,'approved','{"flagged":false}'::jsonb,null,'{}'::jsonb);
  assert (select name='QA moderovaná služba' and image_url is not distinct from old_image and content_status='approved'
    from public.services where id=service.id), 'Approved service copy was not applied safely';

  perform pg_temp.act_as(booking.customer_id);
  perform public.submit_booking_review(booking.id,5,'Text určený k ručnímu zamítnutí.');
  select review_moderation_id into review_job from public.bookings where id=booking.id;
  lease_id:=gen_random_uuid();
  update private.content_moderation set status='processing',lease=lease_id,lease_until=now()+interval '2 minutes'
  where id=review_job;
  perform pg_temp.act_as(null,'service_role');
  perform public.finish_content_moderation(review_job,lease_id,'manual_review','{"flagged":true}'::jsonb,'CONTENT_FLAGGED','{}'::jsonb);
  perform pg_temp.act_as(admin_user);
  perform public.admin_resolve_content_moderation(review_job,'reject','QA kontrola');
  assert (select rating=5 and review_body is null and review_status='rejected' from public.bookings where id=booking.id),
    'Rejected review exposed text or removed the star rating';
  assert exists(select 1 from public.admin_audit_log where action='content_moderation_reject' and target_id=review_job),
    'Admin moderation decision was not audited';

  assert (select relrowsecurity from pg_class where oid='private.settings'::regclass)
    and (select relrowsecurity from pg_class where oid='private.stripe_events'::regclass),
    'RLS is disabled on a private table';
  assert not has_table_privilege('authenticated','private.settings','SELECT')
    and not has_table_privilege('authenticated','private.stripe_events','SELECT')
    and not has_table_privilege('authenticated','public.services','UPDATE'),
    'A client can bypass a protected server write';
end $$;

rollback;
select 'PASS: verified anonymous reviews, one push-only reminder, fail-closed moderation, audited admin decision, photo preservation and private-table RLS; all fixtures rolled back' as result;
