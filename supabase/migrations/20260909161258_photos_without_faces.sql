/*
 * Only photographs without a recognisable face.
 *
 * The Unsplash Terms state that the licence "does not include the right to use … People's
 * images if they are recognizable in the Images", and the service is provided AS-IS with no
 * warranty of non-infringement. Four of the twelve stock photographs showed a clearly
 * visible face — a barber shaving a customer, a facial treatment, a gym, floor exercises —
 * and a marketplace listing is exactly the commercial use that exception is about.
 *
 * They are dropped here. The remaining eight (an empty barber shop, spa towels, a hand with
 * painted nails, a pool, a tennis court from above, a yoga silhouette, and two massage shots
 * where no face appears) cover every category. Four categories end up with a single
 * photograph for all their activities: less variety than before, deliberately, because
 * variety bought with someone else's likeness is not variety worth having.
 */
update public.service_photos set image_url = case category_slug
  when 'vlasy' then 'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=640&q=70&auto=format&fit=crop'
  when 'krasa' then 'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=640&q=70&auto=format&fit=crop'
  when 'sport' then 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=640&q=70&auto=format&fit=crop'
  when 'joga'  then 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=640&q=70&auto=format&fit=crop'
  else image_url end
where category_slug in ('vlasy','krasa','sport','joga');

-- Massage and wellness keep three images each; only the assignment changes, so the two
-- categories that can still tell their activities apart go on doing so.
update public.service_photos set image_url = case slug
  when 'masaze-relaxacni'      then 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=640&q=70&auto=format&fit=crop'
  when 'masaze-thajska'        then 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=640&q=70&auto=format&fit=crop'
  when 'masaze-zada-sije'      then 'https://images.unsplash.com/photo-1519824145371-296894a0daa9?w=640&q=70&auto=format&fit=crop'
  when 'masaze-sportovni'      then 'https://images.unsplash.com/photo-1519824145371-296894a0daa9?w=640&q=70&auto=format&fit=crop'
  when 'masaze-chodidla'       then 'https://images.unsplash.com/photo-1519824145371-296894a0daa9?w=640&q=70&auto=format&fit=crop'
  when 'masaze-lavove-kameny'  then 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=640&q=70&auto=format&fit=crop'
  when 'wellness-privatni-sauna' then 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=640&q=70&auto=format&fit=crop'
  when 'wellness-finska-sauna'   then 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=640&q=70&auto=format&fit=crop'
  when 'wellness-solna-jeskyne'  then 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=640&q=70&auto=format&fit=crop'
  when 'wellness-virivka'        then 'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=640&q=70&auto=format&fit=crop'
  when 'wellness-parni-lazen'    then 'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=640&q=70&auto=format&fit=crop'
  when 'wellness-odpocinek'      then 'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=640&q=70&auto=format&fit=crop'
  else image_url end
where category_slug in ('masaze','wellness');

/*
 * Re-point every row that still carries one of the four withdrawn photographs. Scoped to the
 * stock set, so nothing a venue supplied itself is touched.
 */
update public.services s
set image_url = coalesce(
  (select p.image_url from public.service_photos p
   where p.category_slug = s.category_slug
     and lower(s.name) like '%' || lower(p.label_cs) || '%'
   order by length(p.label_cs) desc, p.sort_order limit 1),
  (select p.image_url from public.service_photos p
   where p.category_slug = s.category_slug order by p.sort_order limit 1))
where s.image_url like 'https://images.unsplash.com/%';

update public.businesses b
set cover_url = (
  select p.image_url from public.service_photos p
  where p.category_slug = b.category_slug order by p.sort_order desc limit 1)
where b.cover_url like 'https://images.unsplash.com/%';
