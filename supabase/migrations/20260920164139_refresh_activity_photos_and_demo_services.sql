/*
 * Put the generated FLEK photo library on the rows that are already shown by the app and
 * broaden the demo catalogue enough to exercise every prepared activity. Real merchant
 * uploads are deliberately left untouched; only an empty image, the old stock catalogue,
 * or an older generated illustration is eligible for replacement.
 */

create or replace function private.is_allowed_picture(p_url text) returns boolean
language sql immutable set search_path = public as $$
  select p_url is null
    or p_url ~ '^/images/(services|activities)/[a-z0-9/_-]+\.(jpg|jpeg|png|webp)$'
    or p_url ~ '^https://images\.unsplash\.com/photo-[A-Za-z0-9-]+(\?[A-Za-z0-9=&%._-]*)?$'
    or p_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/(logos|covers|avatars)/'
    or p_url ~ '^http://127\.0\.0\.1:54321/storage/v1/object/public/(logos|covers|avatars)/'
$$;
revoke all on function private.is_allowed_picture(text) from public, anon, authenticated;

with catalogue(slug, category_slug, label_cs, sort_order) as (values
  ('vlasy-pansky-strih','vlasy','Pánský střih',1),
  ('vlasy-uprava-vousu','vlasy','Úprava vousů',2),
  ('vlasy-damsky-strih','vlasy','Dámský střih',3),
  ('vlasy-barveni','vlasy','Barvení vlasů',4),
  ('vlasy-myti-foukana','vlasy','Mytí a foukaná',5),
  ('vlasy-detsky-strih','vlasy','Dětský střih',6),
  ('masaze-relaxacni','masaze','Relaxační masáž',1),
  ('masaze-thajska','masaze','Thajská masáž',2),
  ('masaze-zada-sije','masaze','Masáž zad a šíje',3),
  ('masaze-sportovni','masaze','Sportovní masáž',4),
  ('masaze-chodidla','masaze','Masáž chodidel',5),
  ('masaze-lavove-kameny','masaze','Lávové kameny',6),
  ('krasa-manikura','krasa','Manikúra',1),
  ('krasa-gel-lak','krasa','Gel lak',2),
  ('krasa-pedikura','krasa','Pedikúra',3),
  ('krasa-kosmeticke-osetreni','krasa','Kosmetické ošetření',4),
  ('krasa-oboci','krasa','Úprava obočí',5),
  ('krasa-rasy','krasa','Prodloužení řas',6),
  ('sport-padel','sport','Padelový kurt',1),
  ('sport-tenis','sport','Tenisový kurt',2),
  ('sport-squash','sport','Squashový kurt',3),
  ('sport-badminton','sport','Badminton',4),
  ('sport-osobni-trenink','sport','Osobní trénink',5),
  ('sport-skupinova-lekce','sport','Skupinová lekce',6),
  ('sport-pujceni-kola','sport','Půjčení kola',7),
  ('joga-vinyasa','joga','Vinyasa jóga',1),
  ('joga-jemna','joga','Jemná jóga',2),
  ('joga-power','joga','Power jóga',3),
  ('joga-rani-protazeni','joga','Ranní protažení',4),
  ('joga-zacatecnici','joga','Jóga pro začátečníky',5),
  ('joga-meditace','joga','Meditace',6),
  ('wellness-privatni-sauna','wellness','Privátní sauna',1),
  ('wellness-finska-sauna','wellness','Finská sauna',2),
  ('wellness-solna-jeskyne','wellness','Solná jeskyně',3),
  ('wellness-virivka','wellness','Vířivka',4),
  ('wellness-parni-lazen','wellness','Parní lázeň',5),
  ('wellness-odpocinek','wellness','Odpočinková procedura',6)
)
insert into public.service_photos(slug, category_slug, label_cs, image_url, sort_order)
select slug, category_slug, label_cs, '/images/activities/' || slug || '-1.jpg', sort_order
from catalogue
on conflict (slug) do update set
  category_slug = excluded.category_slug,
  label_cs = excluded.label_cs,
  image_url = excluded.image_url,
  sort_order = excluded.sort_order;

-- Fix the typo on the demo bike venue without touching a similarly named real business.
update public.businesses b
set display_name = 'Půjčení kola', updated_at = now()
where b.display_name = 'Pujčení kola'
  and exists (
    select 1 from public.business_members bm join auth.users u on u.id = bm.user_id
    where bm.business_id = b.id and u.email like '%@flek.test'
  )
  and not exists (
    select 1 from public.business_members bm join auth.users u on u.id = bm.user_id
    where bm.business_id = b.id and u.email not like '%@flek.test'
  );

update public.services s
set name = 'Půjčení kola', updated_at = now()
from public.businesses b
where b.id = s.business_id and b.display_name = 'Půjčení kola' and s.name = 'Pujčení kola'
  and exists (
    select 1 from public.business_members bm join auth.users u on u.id = bm.user_id
    where bm.business_id = b.id and u.email like '%@flek.test'
  )
  and not exists (
    select 1 from public.business_members bm join auth.users u on u.id = bm.user_id
    where bm.business_id = b.id and u.email not like '%@flek.test'
  );

-- Only the existing, explicitly marked demo venues receive additional catalogue rows.
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
  ('pujceni-elektrokola','bike','sport-pujceni-kola','Půjčení kola – elektrokolo',120,45000,30000,1,2),
  ('pujceni-na-den','bike','sport-pujceni-kola','Půjčení kola – celý den',480,70000,46000,1,1),
  ('meditace','demo-5','joga-meditace','Meditace',45,25000,17000,10,1),
  ('joga-zacatecnici','demo-5','joga-zacatecnici','Jóga pro začátečníky',60,32000,21000,10,2),
  ('power-joga','demo-11','joga-power','Power jóga',60,38000,25000,10,2),
  ('finska-sauna','demo-6','wellness-finska-sauna','Finská sauna',60,80000,52000,4,1),
  ('parni-lazen','demo-6','wellness-parni-lazen','Parní lázeň',45,65000,42000,4,2),
  ('solna-jeskyne','demo-12','wellness-solna-jeskyne','Solná jeskyně',45,50000,33000,6,1),
  ('virivka','demo-12','wellness-virivka','Vířivka',60,70000,46000,4,2)
), targets as (
  select a.*, b.id as business_id
  from additions a
  join public.businesses b on b.slug = a.business_key
    or (a.business_key = 'bike' and b.display_name = 'Půjčení kola')
  where exists (
    select 1 from public.business_members bm join auth.users u on u.id = bm.user_id
    where bm.business_id = b.id and u.email like '%@flek.test'
  )
  and not exists (
    select 1 from public.business_members bm join auth.users u on u.id = bm.user_id
    where bm.business_id = b.id and u.email not like '%@flek.test'
  )
)
insert into public.services(
  id, business_id, name, description, category_slug, duration_minutes, normal_price_cents,
  image_url, is_active, template_slug, default_merchant_price_cents, default_capacity
)
select
  md5('flek-demo-extra:' || business_id::text || ':' || service_key)::uuid,
  business_id,
  name,
  'Ukázková služba této demo provozovny.',
  split_part(template_slug, '-', 1),
  duration_minutes,
  normal_price_cents,
  '/images/activities/' || template_slug || '-' || image_variant || '.jpg',
  true,
  template_slug,
  merchant_price_cents,
  default_capacity
from targets t
where not exists (
  select 1 from public.services s
  where s.business_id = t.business_id and lower(s.name) = lower(t.name)
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category_slug = excluded.category_slug,
  duration_minutes = excluded.duration_minutes,
  normal_price_cents = excluded.normal_price_cents,
  image_url = excluded.image_url,
  is_active = true,
  template_slug = excluded.template_slug,
  default_merchant_price_cents = excluded.default_merchant_price_cents,
  default_capacity = excluded.default_capacity,
  updated_at = now();

-- Attach the correct activity key and a stable alternating photo to current active rows.
with matched as (
  select s.id, s.image_url,
    coalesce(
      case when exists (select 1 from public.service_photos p where p.slug = s.template_slug)
        then s.template_slug end,
      case
        when s.category_slug = 'vlasy' and lower(s.name) like '%dětsk%' then 'vlasy-detsky-strih'
        when s.category_slug = 'vlasy' and lower(s.name) like '%dámsk%' then 'vlasy-damsky-strih'
        when s.category_slug = 'vlasy' and lower(s.name) like '%barven%' then 'vlasy-barveni'
        when s.category_slug = 'vlasy' and (lower(s.name) like '%mytí%' or lower(s.name) like '%foukan%') then 'vlasy-myti-foukana'
        when s.category_slug = 'vlasy' and lower(s.name) like '%střih%' then 'vlasy-pansky-strih'
        when s.category_slug = 'vlasy' and lower(s.name) like '%vous%' then 'vlasy-uprava-vousu'
        when s.category_slug = 'masaze' and lower(s.name) like '%sportovní%' then 'masaze-sportovni'
        when s.category_slug = 'masaze' and lower(s.name) like '%thajsk%' then 'masaze-thajska'
        when s.category_slug = 'masaze' and lower(s.name) like '%chodidel%' then 'masaze-chodidla'
        when s.category_slug = 'masaze' and lower(s.name) like '%lávov%' then 'masaze-lavove-kameny'
        when s.category_slug = 'masaze' and (lower(s.name) like '%zad%' or lower(s.name) like '%šíj%') then 'masaze-zada-sije'
        when s.category_slug = 'masaze' and lower(s.name) like '%relaxační%' then 'masaze-relaxacni'
        when s.category_slug = 'krasa' and lower(s.name) like '%gel lak%' then 'krasa-gel-lak'
        when s.category_slug = 'krasa' and lower(s.name) like '%pedik%' then 'krasa-pedikura'
        when s.category_slug = 'krasa' and lower(s.name) like '%kosmet%' then 'krasa-kosmeticke-osetreni'
        when s.category_slug = 'krasa' and lower(s.name) like '%obočí%' then 'krasa-oboci'
        when s.category_slug = 'krasa' and lower(s.name) like '%řas%' then 'krasa-rasy'
        when s.category_slug = 'krasa' and (lower(s.name) like '%manik%' or lower(s.name) like '%ruce%') then 'krasa-manikura'
        when s.category_slug = 'sport' and lower(s.name) like '%kola%' then 'sport-pujceni-kola'
        when s.category_slug = 'sport' and (lower(s.name) like '%padel%' or (lower(b.display_name) like '%padel%' and lower(s.name) like '%individuální%')) then 'sport-padel'
        when s.category_slug = 'sport' and lower(s.name) like '%tenis%' then 'sport-tenis'
        when s.category_slug = 'sport' and lower(s.name) like '%squash%' then 'sport-squash'
        when s.category_slug = 'sport' and lower(s.name) like '%badminton%' then 'sport-badminton'
        when s.category_slug = 'sport' and lower(s.name) like '%skupinov%' then 'sport-skupinova-lekce'
        when s.category_slug = 'sport' and (lower(s.name) like '%osobní%' or lower(s.name) like '%individuální%') then 'sport-osobni-trenink'
        when s.category_slug = 'joga' and lower(s.name) like '%vinyasa%' then 'joga-vinyasa'
        when s.category_slug = 'joga' and lower(s.name) like '%jemná%' then 'joga-jemna'
        when s.category_slug = 'joga' and lower(s.name) like '%power%' then 'joga-power'
        when s.category_slug = 'joga' and lower(s.name) like '%protažení%' then 'joga-rani-protazeni'
        when s.category_slug = 'joga' and lower(s.name) like '%začáteční%' then 'joga-zacatecnici'
        when s.category_slug = 'joga' and lower(s.name) like '%meditac%' then 'joga-meditace'
        when s.category_slug = 'wellness' and lower(s.name) like '%privátní sauna%' then 'wellness-privatni-sauna'
        when s.category_slug = 'wellness' and lower(s.name) like '%finská sauna%' then 'wellness-finska-sauna'
        when s.category_slug = 'wellness' and lower(s.name) like '%solná%' then 'wellness-solna-jeskyne'
        when s.category_slug = 'wellness' and lower(s.name) like '%vířiv%' then 'wellness-virivka'
        when s.category_slug = 'wellness' and lower(s.name) like '%parní%' then 'wellness-parni-lazen'
        when s.category_slug = 'wellness' and (lower(s.name) like '%odpoč%' or lower(s.name) like '%sauna a%') then 'wellness-odpocinek'
      end
    ) as activity_slug
  from public.services s
  join public.businesses b on b.id = s.business_id
  where s.is_active
)
update public.services s
set template_slug = m.activity_slug,
    image_url = case
      when s.image_url is null
        or s.image_url like 'https://images.unsplash.com/%'
        or s.image_url like '/images/services/%'
      then '/images/activities/' || m.activity_slug || '-' ||
        (1 + mod(get_byte(decode(md5(s.id::text), 'hex'), 0), 2)) || '.jpg'
      else s.image_url
    end,
    updated_at = now()
from matched m
where m.id = s.id and m.activity_slug is not null;

with covers(business_key, activity_slug, image_variant) as (values
  ('demo-1','vlasy-pansky-strih',2),
  ('demo-2','masaze-relaxacni',2),
  ('demo-3','krasa-manikura',2),
  ('demo-4','sport-padel',2),
  ('demo-5','joga-jemna',2),
  ('demo-6','wellness-privatni-sauna',2),
  ('demo-7','vlasy-uprava-vousu',2),
  ('demo-8','masaze-sportovni',2),
  ('demo-9','krasa-kosmeticke-osetreni',2),
  ('demo-10','sport-osobni-trenink',2),
  ('demo-11','joga-vinyasa',2),
  ('demo-12','wellness-odpocinek',2),
  ('demo-13','vlasy-pansky-strih',1),
  ('demo-14','masaze-zada-sije',2),
  ('demo-15','vlasy-damsky-strih',2),
  ('bike','sport-pujceni-kola',2)
)
update public.businesses b
set cover_url = '/images/activities/' || c.activity_slug || '-' || c.image_variant || '.jpg',
    updated_at = now()
from covers c
where (b.slug = c.business_key or (c.business_key = 'bike' and b.display_name = 'Půjčení kola'))
  and exists (
    select 1 from public.business_members bm join auth.users u on u.id = bm.user_id
    where bm.business_id = b.id and u.email like '%@flek.test'
  )
  and not exists (
    select 1 from public.business_members bm join auth.users u on u.id = bm.user_id
    where bm.business_id = b.id and u.email not like '%@flek.test'
  );

-- Populate the new rows immediately; the existing daily job keeps them fresh afterwards.
select private.flek_demo_refresh(3);
