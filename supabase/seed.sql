-- LOCAL DEVELOPMENT ONLY. Fictional businesses; recreate with supabase db reset.
insert into public.categories(slug,label_cs,icon,sort_order) values
 ('vlasy','Vlasy a vousy','Scissors',1),('masaze','Masáže','Hand',2),('krasa','Krása','Sparkles',3),
 ('sport','Sport','Dumbbell',4),('joga','Jóga','Flower2',5),('wellness','Wellness','Waves',6);

do $$
declare uid uuid; mail text; i integer;
begin
 for i in 1..12 loop
  uid:=md5('flek-user-'||i)::uuid;
  mail:=case i when 1 then 'demo-customer@flek.test' when 2 then 'demo-merchant@flek.test' when 3 then 'demo-merchant2@flek.test' when 4 then 'demo-admin@flek.test' else 'demo-'||i||'@flek.test' end;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
  values(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',mail,extensions.crypt('FlekDemo2026!',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}',jsonb_build_object('first_name',case when i=1 then 'Jakub' when i=2 then 'Adam' else 'Tereza' end,'last_name',case when i in(1,2) then 'Novotný' else 'Novotná' end),now(),now(),'','','','');
  insert into auth.identities(id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
  values(gen_random_uuid(),uid,uid::text,jsonb_build_object('sub',uid::text,'email',mail),'email',now(),now(),now());
  update public.profiles set phone='+420777100'||lpad(i::text,3,'0') where id=uid;
 end loop;
 insert into public.user_roles values(md5('flek-user-4')::uuid,'admin');
end $$;

do $$
declare item jsonb; i integer:=0; bid uuid; cat text; price integer; dur integer; service_name text;
begin
 for item in select * from jsonb_array_elements('[
 ["Studio Dobrá hodina","Vinohrady","Korunní 42",50.0757,14.4475,"vlasy","Pánský střih",650,45],
 ["Masážní ateliér Klidno","Karlín","Křižíkova 28",50.0923,14.4516,"masaze","Relaxační masáž",1200,60],
 ["Krása po svém","Holešovice","Dělnická 16",50.1024,14.4482,"krasa","Manikúra s lakováním",750,60],
 ["Padel Dobrý míč","Smíchov","Strakonická 8",50.0598,14.4105,"sport","Padelový kurt",800,60],
 ["Jóga Mezi nádechy","Dejvice","Dejvická 21",50.0985,14.4012,"joga","Jemná jóga",300,60],
 ["Sauna Teplá chvíle","Žižkov","Bořivojova 64",50.0809,14.4528,"wellness","Privátní sauna",1000,60],
 ["Střih Na rohu dne","Anděl","Lidická 12",50.0717,14.4081,"vlasy","Střih a úprava vousů",800,60],
 ["Masáže Volný dech","Vinohrady","Slezská 31",50.0744,14.4416,"masaze","Sportovní masáž",1100,60],
 ["Ateliér Pěkný den","Karlín","Sokolovská 52",50.0935,14.4468,"krasa","Kosmetické ošetření",1200,60],
 ["Pohyb Bez spěchu","Holešovice","Komunardů 10",50.1003,14.4514,"sport","Osobní trénink",700,60],
 ["Jóga O kousek blíž","Smíchov","Štefánikova 22",50.0735,14.4031,"joga","Vinyasa jóga",350,60],
 ["Wellness Tichý dvůr","Dejvice","Československé armády 18",50.1017,14.4015,"wellness","Sauna a odpočinek",900,90],
 ["Holičství Pátá židle","Žižkov","Seifertova 47",50.0851,14.4451,"vlasy","Pánský střih",550,30],
 ["Masáže Na chvíli","Anděl","Nádražní 18",50.0682,14.4041,"masaze","Masáž zad a šíje",900,60],
 ["Studio Nová kapitola","Vinohrady","Francouzská 24",50.0731,14.4385,"vlasy","Pánský střih",650,45]
 ]'::jsonb) loop
  i:=i+1;bid:=md5('flek-business-'||i)::uuid;cat:=item->>5;price:=(item->>7)::int*100;dur:=(item->>8)::int;service_name:=item->>6;
  insert into public.businesses(id,display_name,slug,description,category_slug,phone,public_email,address_line,city,district,postal_code,location,status)
  values(bid,item->>0,'demo-'||i,'Fiktivní provozovna pro ukázku FLEK. Klidné místo v čtvrti '||(item->>1)||', kde je čas jen pro vás.',cat,'+420777200'||lpad(i::text,3,'0'),'studio'||i||'@flek.test',item->>2,'Praha',item->>1,'12000',extensions.st_setsrid(extensions.st_makepoint((item->>4)::float8,(item->>3)::float8),4326)::extensions.geography,case when i=15 then 'pending'::public.business_status else 'approved'::public.business_status end);
  insert into public.business_members values(bid,md5('flek-user-'||case when i=1 then 2 when i=15 then 3 else 5+(i%8) end)::uuid,'owner');
  insert into public.services(id,business_id,name,description,category_slug,duration_minutes,normal_price_cents)
  values(md5('flek-service-'||i)::uuid,bid,service_name,'Dopřej si chvíli pro sebe. V ceně je vše potřebné pro tuto službu.',cat,dur,price),
  (md5('flek-service-'||(i+15))::uuid,bid,case cat when 'vlasy' then 'Úprava vousů' when 'masaze' then 'Masáž zad a šíje' when 'krasa' then 'Péče o ruce' when 'sport' then 'Individuální lekce' when 'joga' then 'Ranní protažení' else 'Odpočinková procedura' end,'Péče a pozornost bez spěchu.',cat,30,greatest(25000,(price/200)*100));
 end loop;
end $$;

do $$
declare i int; s public.services; st timestamptz; cap int; price int; oid uuid; k int; uid uuid; outcome public.booking_status;
begin
 for i in 1..38 loop
  select * into s from public.services where id=md5('flek-service-'||case when i in (30,33,34,35,36,37,38) then 1 else 1+((i-1)%14) end)::uuid;
  st:=date_trunc('minute',now())+make_interval(mins=>45+i*20);
  if i between 16 and 30 then st:=(date_trunc('day',now() at time zone 'Europe/Prague') at time zone 'Europe/Prague')+interval '1 day 9 hours'+make_interval(mins=>(i-16)*30); end if;
  if i=30 then st:=date_trunc('minute',now())+interval '1 hour'; end if;
  if i in (33,34,37,38) then st:=now()-make_interval(days=>case when i=38 then 8 else 1 end,hours=>2); end if;
  cap:=case when i=31 then 4 when i=36 then 1 when i%6=0 then 12 when i%3=0 then 4 else 1 end;
  price:=(s.normal_price_cents*(case when i%4=0 then 55 when i%4=1 then 60 when i%4=2 then 70 else 80 end)/10000)*100;
  oid:=md5('flek-offer-'||i)::uuid;
  insert into public.offers(id,business_id,service_id,start_at,end_at,booking_cutoff_at,original_price_cents,deal_price_cents,capacity_total,capacity_remaining,status,cancelled_at,cancellation_reason,published_at)
  values(oid,s.business_id,s.id,st,st+make_interval(mins=>s.duration_minutes),st-interval '15 minutes',s.normal_price_cents,price,cap,cap,case when i=35 then 'cancelled'::public.offer_status else 'published'::public.offer_status end,case when i=35 then now() end,case when i=35 then 'Provozovna dnes nemůže termín zajistit.' end,case when i in(37,38) then st-interval '2 days' else now()-interval '30 minutes' end);
  if i>=30 then
   for k in 1..(case when i=31 then 3 else 1 end) loop
    uid:=md5('flek-user-'||case when i=31 then k+7 when i=33 then 6 else 1 end)::uuid;
    outcome:=case i when 32 then 'cancelled_by_customer'::public.booking_status when 33 then 'no_show'::public.booking_status when 34 then 'completed'::public.booking_status when 35 then 'cancelled_by_merchant'::public.booking_status when 37 then 'completed'::public.booking_status when 38 then 'completed'::public.booking_status else 'confirmed'::public.booking_status end;
    insert into public.bookings(offer_id,business_id,customer_id,reservation_code,price_cents,service_name_snapshot,business_name_snapshot,business_address_snapshot,start_at_snapshot,end_at_snapshot,original_price_cents_snapshot,status,created_at,cancelled_at,resolved_at,cancellation_reason)
    select oid,s.business_id,uid,'FLEK-'||public.generate_reservation_code(6),price,s.name,b.display_name,b.address_line||', '||b.city,st,st+make_interval(mins=>s.duration_minutes),s.normal_price_cents,outcome,least(st-interval '2 hours',now()-interval '5 minutes'),case when outcome in ('cancelled_by_customer','cancelled_by_merchant') then now() end,case when outcome in ('completed','no_show') then st+interval '1 hour' end,case when outcome='cancelled_by_merchant' then 'Provozovna dnes nemůže termín zajistit.' end from public.businesses b where b.id=s.business_id;
    if outcome not in ('cancelled_by_customer','cancelled_by_merchant') then update public.offers set capacity_remaining=capacity_remaining-1 where id=oid; end if;
    if outcome='no_show' then update public.profiles set no_show_count=no_show_count+1 where id=uid; end if;
   end loop;
  end if;
 end loop;
end $$;

-- Demo photography: fictional venues illustrated with stock images. In production a
-- business uploads its own into Storage; see LIMITATIONS.md.
with pics(category_slug, a, b) as (values
 ('vlasy','photo-1503951914875-452162b0f3f1','photo-1585747860715-2ba37e788b70'),
 ('masaze','photo-1544161515-4ab6ce6db874','photo-1540555700478-4be289fbecef'),
 ('krasa','photo-1604654894610-df63bc536371','photo-1596178065887-1198b6148b2b'),
 ('sport','photo-1554068865-24cecd4e34b8','photo-1571019613454-1cb2f99b2d8b'),
 ('joga','photo-1544367567-0f2fcb009e0b','photo-1512290923902-8a9f81dc236c'),
 ('wellness','photo-1571019613914-85f342c6a11e','photo-1519824145371-296894a0daa9'))
update public.services s
set image_url='https://images.unsplash.com/'||(case when substr(md5(s.id::text),1,1)<'8' then p.a else p.b end)||'?w=640&q=70&auto=format&fit=crop'
from pics p where p.category_slug=s.category_slug;

with pics(category_slug, a, b) as (values
 ('vlasy','photo-1585747860715-2ba37e788b70','photo-1503951914875-452162b0f3f1'),
 ('masaze','photo-1540555700478-4be289fbecef','photo-1544161515-4ab6ce6db874'),
 ('krasa','photo-1596178065887-1198b6148b2b','photo-1604654894610-df63bc536371'),
 ('sport','photo-1571019613454-1cb2f99b2d8b','photo-1554068865-24cecd4e34b8'),
 ('joga','photo-1512290923902-8a9f81dc236c','photo-1544367567-0f2fcb009e0b'),
 ('wellness','photo-1519824145371-296894a0daa9','photo-1571019613914-85f342c6a11e'))
update public.businesses b
set cover_url='https://images.unsplash.com/'||(case when substr(md5(b.id::text),1,1)<'8' then p.a else p.b end)||'?w=960&q=70&auto=format&fit=crop'
from pics p where p.category_slug=b.category_slug;

-- Ratings come from attendance, so the demo needs past bookings that were actually
-- completed. Venues 9-15 stay unrated, which is what a new venue looks like.
do $$
declare b record; i integer; n integer; oid uuid; s public.services; uid uuid; st timestamptz; price integer;
begin
 for b in select id, row_number() over (order by slug) rn from public.businesses where status='approved' loop
  exit when b.rn > 8;
  select * into s from public.services where business_id=b.id order by created_at, id limit 1;
  n := 2 + (b.rn % 5)::integer;
  st := date_trunc('hour', now()) - make_interval(days => 10 + b.rn::integer);
  oid := md5('flek-past-'||b.rn)::uuid;
  price := (s.normal_price_cents * 70 / 10000) * 100;
  insert into public.offers(id,business_id,service_id,start_at,end_at,booking_cutoff_at,original_price_cents,deal_price_cents,capacity_total,capacity_remaining,published_at)
  values(oid,b.id,s.id,st,st+make_interval(mins=>s.duration_minutes),st-interval '15 minutes',s.normal_price_cents,price,n,0,st-interval '1 day');
  for i in 1..n loop
   uid := md5('flek-user-'||(1+((b.rn::integer*3+i) % 12)))::uuid;
   insert into public.bookings(offer_id,business_id,customer_id,reservation_code,price_cents,service_name_snapshot,business_name_snapshot,business_address_snapshot,start_at_snapshot,end_at_snapshot,original_price_cents_snapshot,status,created_at,resolved_at,rating,rated_at)
   select oid,b.id,uid,'FLEK-'||public.generate_reservation_code(6),price,s.name,bb.display_name,bb.address_line||', '||bb.city,st,st+make_interval(mins=>s.duration_minutes),s.normal_price_cents,'completed',st-interval '3 hours',st+interval '1 hour',
    case when (b.rn+i) % 7 = 0 then 3 when (b.rn+i) % 3 = 0 then 4 else 5 end, st+interval '2 hours'
   from public.businesses bb where bb.id=b.id;
  end loop;
 end loop;
end $$;

-- Seeded bookings predate paying up front; give them settled payments so the demo does not
-- show a wall of unpaid seats. Cancelled ones show the money going back.
insert into public.payments(customer_id, offer_id, amount_cents, status, provider, provider_reference, paid_at, refunded_at)
select k.customer_id, k.offer_id, k.price_cents,
       case when k.status in ('cancelled_by_customer','cancelled_by_merchant') then 'refunded' else 'paid' end::public.payment_status,
       'demo', 'demo-seed', k.created_at,
       case when k.status in ('cancelled_by_customer','cancelled_by_merchant') then k.cancelled_at end
from public.bookings k where k.payment_id is null;

update public.bookings k set payment_id = p.id
from public.payments p
where k.payment_id is null and p.provider_reference='demo-seed'
  and p.customer_id=k.customer_id and p.offer_id=k.offer_id and p.amount_cents=k.price_cents
  and not exists (select 1 from public.bookings x where x.payment_id=p.id);
