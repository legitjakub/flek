/*
 * Honest local photography for the activities called out in the product review.
 * Root-relative assets ship with the web app, so the cards no longer depend on an overseas
 * resort photograph or pretend that a tennis court is a personal-training studio.
 */
update public.service_photos
set image_url = case slug
  when 'sport-osobni-trenink' then '/images/services/personal-training-prague.jpg'
  when 'sport-skupinova-lekce' then '/images/services/group-class-prague.jpg'
  when 'joga-vinyasa' then '/images/services/yoga-prague.jpg'
  when 'joga-jemna' then '/images/services/yoga-prague.jpg'
  when 'joga-power' then '/images/services/yoga-prague.jpg'
  when 'joga-rani-protazeni' then '/images/services/yoga-prague.jpg'
  when 'joga-zacatecnici' then '/images/services/yoga-prague.jpg'
  when 'joga-meditace' then '/images/services/yoga-prague.jpg'
  when 'wellness-privatni-sauna' then '/images/services/sauna-prague.jpg'
  when 'wellness-finska-sauna' then '/images/services/sauna-prague.jpg'
  when 'wellness-odpocinek' then '/images/services/sauna-prague.jpg'
  else image_url
end
where slug in (
  'sport-osobni-trenink', 'sport-skupinova-lekce',
  'joga-vinyasa', 'joga-jemna', 'joga-power', 'joga-rani-protazeni', 'joga-zacatecnici', 'joga-meditace',
  'wellness-privatni-sauna', 'wellness-finska-sauna', 'wellness-odpocinek'
);

update public.services s
set image_url = p.image_url
from public.service_photos p
where p.category_slug = s.category_slug
  and p.slug in (
    'sport-osobni-trenink', 'sport-skupinova-lekce',
    'joga-vinyasa', 'joga-jemna', 'joga-power', 'joga-rani-protazeni', 'joga-zacatecnici', 'joga-meditace',
    'wellness-privatni-sauna', 'wellness-finska-sauna', 'wellness-odpocinek'
  )
  and lower(s.name) like '%' || lower(p.label_cs) || '%'
  and (s.image_url is null or s.image_url like 'https://images.unsplash.com/%');

update public.businesses
set cover_url = '/images/services/sauna-prague.jpg'
where category_slug = 'wellness'
  and (cover_url is null or cover_url like 'https://images.unsplash.com/%');

update public.businesses
set cover_url = '/images/services/yoga-prague.jpg'
where category_slug = 'joga'
  and (cover_url is null or cover_url like 'https://images.unsplash.com/%');

/*
 * JSON null now means "use the venue cover" when editing an existing service. The original
 * COALESCE made it impossible to clear an old image even though the client sent the choice.
 */
create or replace function public.save_service(p_business_id uuid,p_data jsonb,p_service_id uuid default null)
returns public.services language plpgsql security definer set search_path=public as $$
declare s public.services;
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.businesses where id=p_business_id for share;
 if p_service_id is null then
  insert into public.services(business_id,name,description,category_slug,duration_minutes,normal_price_cents,image_url,is_active)
  values(p_business_id,p_data->>'name',coalesce(p_data->>'description',''),p_data->>'category_slug',(p_data->>'duration_minutes')::int,(p_data->>'normal_price_cents')::int,p_data->>'image_url',coalesce((p_data->>'is_active')::bool,true)) returning * into s;
 else
  update public.services set
    name=coalesce(p_data->>'name',name),
    description=coalesce(p_data->>'description',description),
    category_slug=coalesce(p_data->>'category_slug',category_slug),
    duration_minutes=coalesce((p_data->>'duration_minutes')::int,duration_minutes),
    normal_price_cents=coalesce((p_data->>'normal_price_cents')::int,normal_price_cents),
    image_url=case when p_data ? 'image_url' then p_data->>'image_url' else image_url end,
    is_active=coalesce((p_data->>'is_active')::bool,is_active),
    updated_at=now()
  where id=p_service_id and business_id=p_business_id returning * into s;
  if not found then raise exception 'FORBIDDEN'; end if;
 end if;
 return s;
end $$;

revoke execute on function public.save_service(uuid,jsonb,uuid) from public,anon;
grant execute on function public.save_service(uuid,jsonb,uuid) to authenticated,service_role;
