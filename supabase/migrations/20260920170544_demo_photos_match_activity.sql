/*
 * Fotky demo služeb a obálek srovnané s katalogem v `src/lib/serviceIllustrations.ts`.
 * Katalog se od 10. 9. několikrát měnil (vlastní snímky sportů, wellness), ale řádky v databázi
 * zůstaly na původním seedu, takže padelový kurt ukazoval obecnou fotku a sauna spa snímek.
 *
 * Mění se jen řádky, které mají přesně původní seedovanou hodnotu; fotka, kterou si podnik nahrál
 * sám, se nepřepisuje. Ceny, kapacity ani nabídky se netýká.
 */
do $$
declare
  massage_old text := 'https://images.unsplash.com/photo-1519824145371-296894a0daa9?w=640&q=70&auto=format&fit=crop';
  massage_new text := 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=640&q=70&auto=format&fit=crop';
  spa text := 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=640&q=70&auto=format&fit=crop';
  court_old text := 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=640&q=70&auto=format&fit=crop';
  padel text := '/images/services/padel-prague.jpg';
  tennis text := '/images/services/tennis-prague.jpg';
  group_class text := '/images/services/group-class-prague.jpg';
  sauna text := '/images/services/sauna-prague.jpg';
begin
  -- Masáže: jeden snímek pro celou kategorii, ten z katalogu.
  update public.services set image_url = massage_new
  where category_slug = 'masaze' and image_url = massage_old;

  update public.businesses b set cover_url = massage_new
  where b.cover_url = spa
    and exists (select 1 from public.services s where s.business_id = b.id and s.category_slug = 'masaze');

  -- Padelový klub: kurt i individuální lekce jsou padel, ne obecný kurt.
  update public.services s set image_url = padel
  where s.image_url = court_old
    and exists (select 1 from public.services p
                where p.business_id = s.business_id and p.name ilike '%padel%');

  update public.businesses b set cover_url = padel
  where b.cover_url = court_old
    and exists (select 1 from public.services p where p.business_id = b.id and p.name ilike '%padel%');

  -- Pohybové studio bez padelu: skupinová lekce.
  update public.services s set image_url = group_class
  where s.image_url = court_old
    and not exists (select 1 from public.services p
                    where p.business_id = s.business_id and p.name ilike '%padel%');

  update public.businesses b set cover_url = group_class where b.cover_url = court_old;

  -- Sauna má vlastní snímek, spa fotka patří kosmetice.
  update public.services set image_url = sauna
  where image_url = spa and name ilike '%sauna%';

  -- Tenisový kurt neměl fotku vůbec; aplikace ji dopočítá z názvu, stránka podniku ale ne.
  update public.services s set image_url = tennis
  where s.image_url is null and s.name ilike '%tenis%';

  update public.businesses b set cover_url = tennis
  where b.cover_url is null
    and exists (select 1 from public.services s where s.business_id = b.id and s.name ilike '%tenis%');
end $$;
