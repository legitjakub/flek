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

-- A broad demo catalogue exercises every prepared activity and both service/photo pickers.
-- These rows belong only to the fictional demo venues above.
with additions(service_key, business_key, template_slug, name, duration_minutes,
               normal_price_cents, merchant_price_cents, default_capacity, image_variant) as (values
 ('barveni','demo-1','vlasy-barveni','Barvení vlasů',90,120000,78000,1,1),
 ('myti-foukana','demo-7','vlasy-myti-foukana','Mytí a foukaná',45,65000,42000,1,2),
 ('detsky-strih','demo-13','vlasy-detsky-strih','Dětský střih',30,45000,30000,1,1),
 ('damsky-strih','demo-15','vlasy-damsky-strih','Dámský střih',60,85000,55000,1,2),
 ('lavove-kameny','demo-2','masaze-lavove-kameny','Masáž lávovými kameny',75,130000,85000,1,2),
 ('masaz-chodidel','demo-8','masaze-chodidla','Masáž chodidel',45,65000,42000,1,1),
 ('thajska-masaz','demo-14','masaze-thajska','Thajská masáž',60,110000,72000,1,2),
 ('gel-lak','demo-3','krasa-gel-lak','Gel lak',45,65000,42000,1,2),
 ('uprava-oboci','demo-3','krasa-oboci','Úprava obočí',30,50000,33000,1,1),
 ('pedikura','demo-9','krasa-pedikura','Pedikúra',60,80000,52000,1,1),
 ('prodlouzeni-ras','demo-9','krasa-rasy','Prodloužení řas',90,120000,78000,1,2),
 ('tenisovy-kurt','demo-4','sport-tenis','Tenisový kurt',60,70000,46000,4,1),
 ('squashovy-kurt','demo-4','sport-squash','Squashový kurt',60,65000,42000,2,2),
 ('badminton','demo-10','sport-badminton','Badminton',60,50000,33000,4,1),
 ('skupinova-lekce','demo-10','sport-skupinova-lekce','Skupinová lekce',60,45000,30000,12,2),
 ('meditace','demo-5','joga-meditace','Meditace',45,25000,17000,10,1),
 ('joga-zacatecnici','demo-5','joga-zacatecnici','Jóga pro začátečníky',60,32000,21000,10,2),
 ('power-joga','demo-11','joga-power','Power jóga',60,38000,25000,10,2),
 ('finska-sauna','demo-6','wellness-finska-sauna','Finská sauna',60,80000,52000,4,1),
 ('parni-lazen','demo-6','wellness-parni-lazen','Parní lázeň',45,65000,42000,4,2),
 ('solna-jeskyne','demo-12','wellness-solna-jeskyne','Solná jeskyně',45,50000,33000,6,1),
 ('virivka','demo-12','wellness-virivka','Vířivka',60,70000,46000,4,2)
), targets as (
 select a.*, b.id as business_id
 from additions a join public.businesses b on b.slug = a.business_key
)
insert into public.services(
 id,business_id,name,description,category_slug,duration_minutes,normal_price_cents,
 image_url,is_active,template_slug,default_merchant_price_cents,default_capacity
)
select md5('flek-demo-extra:'||business_id::text||':'||service_key)::uuid,business_id,name,
 'Ukázková služba této demo provozovny.',split_part(template_slug,'-',1),duration_minutes,
 normal_price_cents,'/images/activities/'||template_slug||'-'||image_variant||'.jpg',true,
 template_slug,merchant_price_cents,default_capacity
from targets;

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

-- Demo photography uses the same activity mapping as production. A real merchant upload
-- still wins in the application; these generated illustrations only belong to seed rows.
with matched as (
 select s.id,
  coalesce(
   case when exists (select 1 from public.service_photos p where p.slug=s.template_slug)
    then s.template_slug end,
   case
    when s.category_slug='vlasy' and lower(s.name) like '%dětsk%' then 'vlasy-detsky-strih'
    when s.category_slug='vlasy' and lower(s.name) like '%dámsk%' then 'vlasy-damsky-strih'
    when s.category_slug='vlasy' and lower(s.name) like '%barven%' then 'vlasy-barveni'
    when s.category_slug='vlasy' and (lower(s.name) like '%mytí%' or lower(s.name) like '%foukan%') then 'vlasy-myti-foukana'
    when s.category_slug='vlasy' and lower(s.name) like '%střih%' then 'vlasy-pansky-strih'
    when s.category_slug='vlasy' and lower(s.name) like '%vous%' then 'vlasy-uprava-vousu'
    when s.category_slug='masaze' and lower(s.name) like '%sportovní%' then 'masaze-sportovni'
    when s.category_slug='masaze' and lower(s.name) like '%thajsk%' then 'masaze-thajska'
    when s.category_slug='masaze' and lower(s.name) like '%chodidel%' then 'masaze-chodidla'
    when s.category_slug='masaze' and lower(s.name) like '%lávov%' then 'masaze-lavove-kameny'
    when s.category_slug='masaze' and (lower(s.name) like '%zad%' or lower(s.name) like '%šíj%') then 'masaze-zada-sije'
    when s.category_slug='masaze' and lower(s.name) like '%relaxační%' then 'masaze-relaxacni'
    when s.category_slug='krasa' and lower(s.name) like '%gel lak%' then 'krasa-gel-lak'
    when s.category_slug='krasa' and lower(s.name) like '%pedik%' then 'krasa-pedikura'
    when s.category_slug='krasa' and lower(s.name) like '%kosmet%' then 'krasa-kosmeticke-osetreni'
    when s.category_slug='krasa' and lower(s.name) like '%obočí%' then 'krasa-oboci'
    when s.category_slug='krasa' and lower(s.name) like '%řas%' then 'krasa-rasy'
    when s.category_slug='krasa' and (lower(s.name) like '%manik%' or lower(s.name) like '%ruce%') then 'krasa-manikura'
    when s.category_slug='sport' and (lower(s.name) like '%padel%' or (lower(b.display_name) like '%padel%' and lower(s.name) like '%individuální%')) then 'sport-padel'
    when s.category_slug='sport' and lower(s.name) like '%tenis%' then 'sport-tenis'
    when s.category_slug='sport' and lower(s.name) like '%squash%' then 'sport-squash'
    when s.category_slug='sport' and lower(s.name) like '%badminton%' then 'sport-badminton'
    when s.category_slug='sport' and lower(s.name) like '%skupinov%' then 'sport-skupinova-lekce'
    when s.category_slug='sport' and (lower(s.name) like '%osobní%' or lower(s.name) like '%individuální%') then 'sport-osobni-trenink'
    when s.category_slug='joga' and lower(s.name) like '%vinyasa%' then 'joga-vinyasa'
    when s.category_slug='joga' and lower(s.name) like '%jemná%' then 'joga-jemna'
    when s.category_slug='joga' and lower(s.name) like '%power%' then 'joga-power'
    when s.category_slug='joga' and lower(s.name) like '%protažení%' then 'joga-rani-protazeni'
    when s.category_slug='joga' and lower(s.name) like '%začáteční%' then 'joga-zacatecnici'
    when s.category_slug='joga' and lower(s.name) like '%meditac%' then 'joga-meditace'
    when s.category_slug='wellness' and lower(s.name) like '%privátní sauna%' then 'wellness-privatni-sauna'
    when s.category_slug='wellness' and lower(s.name) like '%finská sauna%' then 'wellness-finska-sauna'
    when s.category_slug='wellness' and lower(s.name) like '%solná%' then 'wellness-solna-jeskyne'
    when s.category_slug='wellness' and lower(s.name) like '%vířiv%' then 'wellness-virivka'
    when s.category_slug='wellness' and lower(s.name) like '%parní%' then 'wellness-parni-lazen'
    when s.category_slug='wellness' and (lower(s.name) like '%odpoč%' or lower(s.name) like '%sauna a%') then 'wellness-odpocinek'
   end
  ) activity_slug
 from public.services s join public.businesses b on b.id=s.business_id
)
update public.services s
set template_slug=m.activity_slug,
 image_url='/images/activities/'||m.activity_slug||'-'||
  (1+mod(get_byte(decode(md5(s.id::text),'hex'),0),2))||'.jpg'
from matched m where m.id=s.id and m.activity_slug is not null;

with covers(business_key,activity_slug,image_variant) as (values
 ('demo-1','vlasy-pansky-strih',2),('demo-2','masaze-relaxacni',2),
 ('demo-3','krasa-manikura',2),('demo-4','sport-padel',2),
 ('demo-5','joga-jemna',2),('demo-6','wellness-privatni-sauna',2),
 ('demo-7','vlasy-uprava-vousu',2),('demo-8','masaze-sportovni',2),
 ('demo-9','krasa-kosmeticke-osetreni',2),('demo-10','sport-osobni-trenink',2),
 ('demo-11','joga-vinyasa',2),('demo-12','wellness-odpocinek',2),
 ('demo-13','vlasy-pansky-strih',1),('demo-14','masaze-zada-sije',2),
 ('demo-15','vlasy-damsky-strih',2)
)
update public.businesses b
set cover_url='/images/activities/'||c.activity_slug||'-'||c.image_variant||'.jpg'
from covers c where b.slug=c.business_key;

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

-- Rolling inventory across the whole bookable window.
--
-- The fixtures above (flek-offer-1..38) exist to exercise specific states — cancelled,
-- booked, no-show, past — and are pinned near "now" on purpose. That made the demo look
-- alive on the day it was seeded and empty the morning after: every slot had passed and
-- nothing was bookable. These offers fill all seven days the schema allows
-- (private.validate_offer caps start_at at now() + 7 days).
--
-- Written so the same block can be pasted into the SQL editor to refresh a live demo, not
-- only run on a fresh reset; it owns the flek-roll- ids and touches nothing else.
delete from public.bookings where offer_id in (select md5('flek-roll-'||g)::uuid from generate_series(1,400) g);
delete from public.offers where id in (select md5('flek-roll-'||g)::uuid from generate_series(1,400) g);

do $$
declare
 v record; s public.services;
 d integer; k integer; n integer; i integer := 0;
 hr integer; st timestamptz; price integer; cap integer; pct integer;
 -- Opening hours a Prague venue actually sells; the index is derived per venue and day so
 -- two businesses rarely free up the same slot, the way a real market looks.
 hours integer[] := array[8,9,10,11,12,13,14,15,16,17,18,19,20];
begin
 for v in select b.id, b.category_slug, row_number() over (order by b.slug)::integer rn
          from public.businesses b where b.status = 'approved' loop
  for d in 0..6 loop
   -- A venue does not have a gap every day. Roughly a quarter of days sell out entirely.
   n := case (v.rn + d) % 4 when 0 then 0 when 1 then 1 else 2 end;
   for k in 1..n loop
    i := i + 1;
    hr := hours[((v.rn * 3 + d * 2 + k * 5) % 13) + 1];
    st := (date_trunc('day', now() at time zone 'Europe/Prague')
           + make_interval(days => d, hours => hr)) at time zone 'Europe/Prague';
    -- Slots already gone, or inside the booking cutoff, would be dead on arrival.
    continue when st < now() + interval '40 minutes';
    continue when st > now() + interval '7 days';

    select * into s from public.services
     where business_id = v.id and is_active
     order by md5(id::text || k::text) limit 1;
    continue when s.id is null;

    -- The dead hours get cut hardest; prime evening barely needs a discount to sell.
    pct := case when hr <= 10 then 55 when hr between 13 and 15 then 50
                when hr between 17 and 19 then 75 else 65 end;
    price := (s.normal_price_cents * pct / 10000) * 100;
    -- Mostly a single free chair. Group formats (yoga, sport) legitimately hold more.
    cap := case when v.category_slug in ('joga','sport') and i % 3 = 0 then 8
                when i % 7 = 0 then 4 when i % 5 = 0 then 2 else 1 end;

    insert into public.offers(id,business_id,service_id,start_at,end_at,booking_cutoff_at,
      original_price_cents,deal_price_cents,capacity_total,capacity_remaining,status,published_at)
    values(md5('flek-roll-'||i)::uuid,v.id,s.id,st,st+make_interval(mins=>s.duration_minutes),
      st-interval '15 minutes',s.normal_price_cents,price,cap,cap,'published',
      now()-make_interval(mins=>i));
   end loop;
  end loop;
 end loop;

 -- Whatever the hour, "Teď" and "Do 2 h" have to show something: those tabs are the whole
 -- premise of the product, and a day-grid alone leaves them empty every evening.
 for k in 1..8 loop
  i := i + 1;
  select sv.* into s from public.services sv
   join public.businesses bb on bb.id = sv.business_id
   where bb.status = 'approved' and sv.is_active
   order by md5(sv.id::text || 'now' || k::text) limit 1;
  continue when s.id is null;
  st := date_trunc('minute', now()) + make_interval(mins => 45 + k * 22);
  price := (s.normal_price_cents * 50 / 10000) * 100;  -- steepest cuts: it starts within hours
  insert into public.offers(id,business_id,service_id,start_at,end_at,booking_cutoff_at,
    original_price_cents,deal_price_cents,capacity_total,capacity_remaining,status,published_at)
  values(md5('flek-roll-'||i)::uuid,s.business_id,s.id,st,st+make_interval(mins=>s.duration_minutes),
    st-interval '15 minutes',s.normal_price_cents,price,
    case when k % 4 = 0 then 3 else 1 end,case when k % 4 = 0 then 3 else 1 end,
    'published',now()-make_interval(mins=>k));
 end loop;
end $$;
