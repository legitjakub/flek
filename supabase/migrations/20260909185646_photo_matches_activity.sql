/*
 * Make every catalogue photograph actually depict its activity.
 *
 * An audit of all 36 activities against what is really in the eight licence-safe photographs
 * found five that lied to the customer:
 *   - a hand with painted nails illustrated "Kosmetické ošetření", "Úprava obočí" and
 *     "Prodloužení řas", which are face treatments, not nails;
 *   - a tennis court from above illustrated "Osobní trénink" and "Skupinová lekce".
 *
 * The first three move to the spa still life (towels, oil, flowers), which is honestly a
 * beauty-treatment setting. The last two have no truthful match in the safe set, so they
 * get no photograph at all: a listing with the venue's own cover is better than one that
 * shows a customer a tennis court and sells them a personal trainer.
 */
alter table public.service_photos alter column image_url drop not null;

update public.service_photos
set image_url = 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=640&q=70&auto=format&fit=crop'
where slug in ('krasa-kosmeticke-osetreni','krasa-oboci','krasa-rasy');

update public.service_photos
set image_url = null
where slug in ('sport-osobni-trenink','sport-skupinova-lekce');

/*
 * Services already carrying one of the corrected photographs follow the catalogue. Scoped to
 * the stock set so nothing a venue supplied itself is touched, and matched on the service
 * name so the correction lands only where the name says it should.
 */
update public.services s
set image_url = (
  select p.image_url from public.service_photos p
  where p.category_slug = s.category_slug
    and p.image_url is not null
    and lower(s.name) like '%' || lower(p.label_cs) || '%'
  order by length(p.label_cs) desc, p.sort_order limit 1)
where s.image_url like 'https://images.unsplash.com/%'
  and exists (
    select 1 from public.service_photos p
    where p.category_slug = s.category_slug
      and p.image_url is not null
      and lower(s.name) like '%' || lower(p.label_cs) || '%');

/*
 * And a service whose name matches an activity we deliberately cannot illustrate must lose
 * the borrowed picture rather than keep pointing at the wrong one.
 */
update public.services s
set image_url = null
where s.image_url like 'https://images.unsplash.com/%'
  and exists (
    select 1 from public.service_photos p
    where p.category_slug = s.category_slug
      and p.image_url is null
      and lower(s.name) like '%' || lower(p.label_cs) || '%');
