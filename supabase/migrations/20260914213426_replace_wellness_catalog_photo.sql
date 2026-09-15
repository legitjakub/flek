-- Replace the former resort/pool image used by wellness demo data.
-- Keep merchant-uploaded photos intact: only the exact seeded URL is changed.
do $$
declare
  old_url text := 'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=640&q=70&auto=format&fit=crop';
  replacement_url text := 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=640&q=70&auto=format&fit=crop';
begin
  update public.service_photos
  set image_url = replacement_url
  where image_url = old_url;

  update public.services
  set image_url = replacement_url
  where image_url = old_url;

  update public.businesses
  set cover_url = replacement_url
  where cover_url = old_url;
end;
$$;
