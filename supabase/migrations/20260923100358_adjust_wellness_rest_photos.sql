-- Replace only the two just-released illustrative photos that resemble a resort/pool.
-- The merchant's own Storage uploads are not matched.
with replacements(old_url, new_url) as (values
  ('https://images.unsplash.com/photo-1773924093206-9a433a14bb44?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1787496994928-b5b554eb0cd8?w=800&q=70&auto=format&fit=crop'),
  ('https://images.unsplash.com/photo-1776763019081-dd0b07a19846?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1693578538512-fc66f318c833?w=800&q=70&auto=format&fit=crop')
), catalog as (
  update public.service_photos p set image_url = r.new_url
  from replacements r where p.slug = 'wellness-odpocinek' and p.image_url = r.old_url
  returning 1
), services as (
  update public.services s set image_url = r.new_url, updated_at = now()
  from replacements r where s.image_url = r.old_url
    and (s.template_slug is null or s.template_slug = 'wellness-odpocinek')
  returning 1
)
update public.businesses b set cover_url = r.new_url, updated_at = now()
from replacements r where b.cover_url = r.old_url;
