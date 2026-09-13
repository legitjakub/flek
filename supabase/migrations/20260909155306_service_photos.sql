/*
 * A catalogue of the activities a venue actually sells, each with a photograph that matches
 * it. Two problems it solves, both visible in the product today:
 *
 * 1. No merchant screen ever set services.image_url. save_service has always accepted it, so
 *    the column existed but nothing could fill it — a service a merchant created had no
 *    photo at all and fell back to the venue cover.
 * 2. The seed picked a photo per category by md5 of the service id, and three of the twelve
 *    stock photos were filed under the wrong category to begin with. A yoga class could show
 *    a facial treatment, a sauna could show a gym floor, a manicure a resort swimming pool.
 *
 * Reference data, like public.categories: readable by everyone, written by nobody through
 * the API. Every image_url below was loaded in a browser and confirmed to resolve.
 */
create table public.service_photos (
  slug text primary key,
  category_slug text not null references public.categories(slug) on delete cascade,
  label_cs text not null,
  image_url text not null,
  sort_order integer not null default 0
);
create index service_photos_category on public.service_photos(category_slug, sort_order);

alter table public.service_photos enable row level security;
create policy service_photos_read on public.service_photos for select using (true);
grant select on public.service_photos to anon, authenticated;
grant all on public.service_photos to service_role;

/*
 * Photographs named by what is in them, not by the category they were filed under. Several
 * activities deliberately share one image: one honest photograph beats two where one is
 * wrong, and a merchant who wants their own room in the picture uploads it.
 */
insert into public.service_photos(slug, category_slug, label_cs, image_url, sort_order) values
  -- Vlasy a vousy
  ('vlasy-pansky-strih','vlasy','Pánský střih','https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=640&q=70&auto=format&fit=crop',1),
  ('vlasy-uprava-vousu','vlasy','Úprava vousů','https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=640&q=70&auto=format&fit=crop',2),
  ('vlasy-damsky-strih','vlasy','Dámský střih','https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=640&q=70&auto=format&fit=crop',3),
  ('vlasy-barveni','vlasy','Barvení vlasů','https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=640&q=70&auto=format&fit=crop',4),
  ('vlasy-myti-foukana','vlasy','Mytí a foukaná','https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=640&q=70&auto=format&fit=crop',5),
  ('vlasy-detsky-strih','vlasy','Dětský střih','https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=640&q=70&auto=format&fit=crop',6),

  -- Masáže
  ('masaze-relaxacni','masaze','Relaxační masáž','https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=640&q=70&auto=format&fit=crop',1),
  ('masaze-thajska','masaze','Thajská masáž','https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=640&q=70&auto=format&fit=crop',2),
  ('masaze-zada-sije','masaze','Masáž zad a šíje','https://images.unsplash.com/photo-1519824145371-296894a0daa9?w=640&q=70&auto=format&fit=crop',3),
  ('masaze-sportovni','masaze','Sportovní masáž','https://images.unsplash.com/photo-1519824145371-296894a0daa9?w=640&q=70&auto=format&fit=crop',4),
  ('masaze-chodidla','masaze','Masáž chodidel','https://images.unsplash.com/photo-1519824145371-296894a0daa9?w=640&q=70&auto=format&fit=crop',5),
  ('masaze-lavove-kameny','masaze','Lávové kameny','https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=640&q=70&auto=format&fit=crop',6),

  -- Krása
  ('krasa-manikura','krasa','Manikúra','https://images.unsplash.com/photo-1604654894610-df63bc536371?w=640&q=70&auto=format&fit=crop',1),
  ('krasa-gel-lak','krasa','Gel lak','https://images.unsplash.com/photo-1604654894610-df63bc536371?w=640&q=70&auto=format&fit=crop',2),
  ('krasa-pedikura','krasa','Pedikúra','https://images.unsplash.com/photo-1604654894610-df63bc536371?w=640&q=70&auto=format&fit=crop',3),
  ('krasa-kosmeticke-osetreni','krasa','Kosmetické ošetření','https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=640&q=70&auto=format&fit=crop',4),
  ('krasa-oboci','krasa','Úprava obočí','https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=640&q=70&auto=format&fit=crop',5),
  ('krasa-rasy','krasa','Prodloužení řas','https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=640&q=70&auto=format&fit=crop',6),

  -- Sport
  ('sport-padel','sport','Padelový kurt','https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=640&q=70&auto=format&fit=crop',1),
  ('sport-tenis','sport','Tenisový kurt','https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=640&q=70&auto=format&fit=crop',2),
  ('sport-squash','sport','Squashový kurt','https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=640&q=70&auto=format&fit=crop',3),
  ('sport-badminton','sport','Badminton','https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=640&q=70&auto=format&fit=crop',4),
  ('sport-osobni-trenink','sport','Osobní trénink','https://images.unsplash.com/photo-1571019613914-85f342c6a11e?w=640&q=70&auto=format&fit=crop',5),
  ('sport-skupinova-lekce','sport','Skupinová lekce','https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=640&q=70&auto=format&fit=crop',6),

  -- Jóga
  ('joga-vinyasa','joga','Vinyasa jóga','https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=640&q=70&auto=format&fit=crop',1),
  ('joga-jemna','joga','Jemná jóga','https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=640&q=70&auto=format&fit=crop',2),
  ('joga-power','joga','Power jóga','https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=640&q=70&auto=format&fit=crop',3),
  ('joga-rani-protazeni','joga','Ranní protažení','https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=640&q=70&auto=format&fit=crop',4),
  ('joga-zacatecnici','joga','Jóga pro začátečníky','https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=640&q=70&auto=format&fit=crop',5),
  ('joga-meditace','joga','Meditace','https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=640&q=70&auto=format&fit=crop',6),

  -- Wellness
  ('wellness-privatni-sauna','wellness','Privátní sauna','https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=640&q=70&auto=format&fit=crop',1),
  ('wellness-finska-sauna','wellness','Finská sauna','https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=640&q=70&auto=format&fit=crop',2),
  ('wellness-solna-jeskyne','wellness','Solná jeskyně','https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=640&q=70&auto=format&fit=crop',3),
  ('wellness-virivka','wellness','Vířivka','https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=640&q=70&auto=format&fit=crop',4),
  ('wellness-parni-lazen','wellness','Parní lázeň','https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=640&q=70&auto=format&fit=crop',5),
  ('wellness-odpocinek','wellness','Odpočinková procedura','https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=640&q=70&auto=format&fit=crop',6)
on conflict (slug) do update set
  category_slug = excluded.category_slug,
  label_cs = excluded.label_cs,
  image_url = excluded.image_url,
  sort_order = excluded.sort_order;

/*
 * Repair the photographs already attached to demo rows. Strictly limited to images that came
 * from the seed's stock set — a photograph a real merchant uploaded must never be replaced
 * by a guess. Each row takes the first catalogue photo for its own category, which is by
 * construction a picture of that category.
 */
update public.services s
set image_url = coalesce(
  -- Best match first: a service called "Manikúra s lakováním" or "Střih a úprava vousů"
  -- names the activity inside it, so the catalogue label is looked for in the name. The
  -- longest matching label wins, so "Úprava vousů" beats a shorter accidental substring.
  (select p.image_url from public.service_photos p
   where p.category_slug = s.category_slug
     and lower(s.name) like '%' || lower(p.label_cs) || '%'
   order by length(p.label_cs) desc, p.sort_order limit 1),
  -- Otherwise the category's first photo, which is at least a picture of the right thing.
  (select p.image_url from public.service_photos p
   where p.category_slug = s.category_slug order by p.sort_order limit 1)
)
where s.image_url like 'https://images.unsplash.com/%'
  and exists (select 1 from public.service_photos p where p.category_slug = s.category_slug);

update public.businesses b
set cover_url = (
  select p.image_url from public.service_photos p
  where p.category_slug = b.category_slug order by p.sort_order desc limit 1
)
where b.cover_url like 'https://images.unsplash.com/%'
  and exists (select 1 from public.service_photos p where p.category_slug = b.category_slug);
