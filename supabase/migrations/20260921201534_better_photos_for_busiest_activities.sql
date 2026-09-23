/*
 * Oprava výběru z 20260921190726. Fotky vybíral agent podle popisků u Unsplashe, protože je sám
 * nevidí, a část z nich sedla vedle: holicí strojek vyšel jako kartáček na zuby, masáž jako pokoj
 * se stolem, jóga jako místnost s kulatými okny.
 *
 * Pět variant se vyměnilo za lepší. U úpravy vousů a masáže zad se vrací vygenerovaná sada:
 * v nabídce nebyla ani jedna použitelná fotografie (samé osoby nebo vágní interiéry) a špatná
 * fotografie je horší než kreslená.
 *
 * Mění se jen řádky, kde hodnota přesně odpovídá staré adrese; fotku nahranou podnikem se
 * nikdy nedotkne.
 */
with nove(stara, nova) as (values
  ('https://images.unsplash.com/photo-1637777277337-f114350fb088?w=800&q=70&auto=format&fit=crop',
   'https://images.unsplash.com/photo-1781455793310-8427c96454c7?w=800&q=70&auto=format&fit=crop'),
  ('https://images.unsplash.com/photo-1693578538512-fc66f318c833?w=800&q=70&auto=format&fit=crop',
   'https://images.unsplash.com/photo-1773924093206-9a433a14bb44?w=800&q=70&auto=format&fit=crop'),
  ('https://images.unsplash.com/photo-1670753171916-1063917beacb?w=800&q=70&auto=format&fit=crop',
   'https://images.unsplash.com/photo-1682737789112-badb2cf078b5?w=800&q=70&auto=format&fit=crop'),
  ('https://images.unsplash.com/photo-1724763750864-9e81ee45d036?w=800&q=70&auto=format&fit=crop',
   'https://images.unsplash.com/photo-1639906188555-935e08bbcdf0?w=800&q=70&auto=format&fit=crop'),
  ('https://images.unsplash.com/photo-1676496962536-d8ef110ff6f0?w=800&q=70&auto=format&fit=crop',
   'https://images.unsplash.com/photo-1763004871583-4183d64096b1?w=800&q=70&auto=format&fit=crop'),
  ('https://images.unsplash.com/photo-1595285203581-6f01855f6e7a?w=800&q=70&auto=format&fit=crop',
   '/images/activities/vlasy-uprava-vousu-1.jpg'),
  ('https://images.unsplash.com/photo-1564556902913-581221ed8d3d?w=800&q=70&auto=format&fit=crop',
   '/images/activities/vlasy-uprava-vousu-2.jpg'),
  ('https://images.unsplash.com/photo-1700142360825-d21edc53c8db?w=800&q=70&auto=format&fit=crop',
   '/images/activities/masaze-zada-sije-1.jpg'),
  ('https://images.unsplash.com/photo-1731597076108-f3bbe268162f?w=800&q=70&auto=format&fit=crop',
   '/images/activities/masaze-zada-sije-2.jpg')
),
katalog as (
  update public.service_photos p set image_url = n.nova
  from nove n where p.image_url = n.stara
  returning 1
),
sluzby as (
  update public.services s set image_url = n.nova
  from nove n where s.image_url = n.stara
  returning 1
)
update public.businesses b set cover_url = n.nova, updated_at = now()
from nove n where b.cover_url = n.stara;
