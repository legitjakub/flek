/*
 * A service keeps the catalogue price, while an offer snapshots the honest price for that
 * particular slot. Merchants may therefore correct both numbers without silently changing
 * every future offer for the service.
 *
 * template_slug records which prepared activity was chosen. Category alone is too broad:
 * it made a group class offer padel and tennis photographs simply because all three are
 * filed under sport.
 */
alter table public.services
  add column template_slug text references public.service_photos(slug) on delete set null;

update public.services s
set template_slug = (
  select p.slug
  from public.service_photos p
  where p.category_slug = s.category_slug
    and lower(s.name) like '%' || lower(p.label_cs) || '%'
  order by length(p.label_cs) desc, p.sort_order
  limit 1
)
where template_slug is null;

update public.service_photos
set image_url = case slug
  when 'sport-padel' then '/images/services/padel-prague.jpg'
  when 'sport-tenis' then '/images/services/tennis-prague.jpg'
  when 'sport-squash' then '/images/services/squash-prague.jpg'
  when 'sport-badminton' then '/images/services/badminton-prague.jpg'
  when 'sport-osobni-trenink' then '/images/services/personal-training-prague.jpg'
  when 'sport-skupinova-lekce' then '/images/services/group-class-prague.jpg'
  else image_url
end
where category_slug = 'sport';

update public.services s
set image_url = p.image_url
from public.service_photos p
where s.template_slug = p.slug
  and p.category_slug = 'sport'
  and (s.image_url is null or s.image_url like 'https://images.unsplash.com/%');

create or replace function public.save_service(p_business_id uuid,p_data jsonb,p_service_id uuid default null)
returns public.services language plpgsql security definer set search_path=public as $$
declare s public.services;
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.businesses where id=p_business_id for share;
 if p_service_id is null then
  insert into public.services(business_id,name,description,category_slug,duration_minutes,normal_price_cents,image_url,template_slug,is_active)
  values(p_business_id,p_data->>'name',coalesce(p_data->>'description',''),p_data->>'category_slug',(p_data->>'duration_minutes')::int,(p_data->>'normal_price_cents')::int,p_data->>'image_url',nullif(p_data->>'template_slug',''),coalesce((p_data->>'is_active')::bool,true)) returning * into s;
 else
  update public.services set
    name=coalesce(p_data->>'name',name),
    description=coalesce(p_data->>'description',description),
    category_slug=coalesce(p_data->>'category_slug',category_slug),
    duration_minutes=coalesce((p_data->>'duration_minutes')::int,duration_minutes),
    normal_price_cents=coalesce((p_data->>'normal_price_cents')::int,normal_price_cents),
    image_url=case when p_data ? 'image_url' then p_data->>'image_url' else image_url end,
    template_slug=case when p_data ? 'template_slug' then nullif(p_data->>'template_slug','') else template_slug end,
    is_active=coalesce((p_data->>'is_active')::bool,is_active),
    updated_at=now()
  where id=p_service_id and business_id=p_business_id returning * into s;
  if not found then raise exception 'FORBIDDEN'; end if;
 end if;
 return s;
end $$;

revoke execute on function public.save_service(uuid,jsonb,uuid) from public,anon;
grant execute on function public.save_service(uuid,jsonb,uuid) to authenticated,service_role;

drop function public.publish_offer(uuid,timestamptz,integer,integer,timestamptz,boolean);

create function public.publish_offer(
  p_service_id uuid,
  p_start_at timestamptz,
  p_deal_price_cents integer,
  p_capacity_total integer default 1,
  p_booking_cutoff_at timestamptz default null,
  p_confirm_overlap boolean default false,
  p_original_price_cents integer default null
)
returns public.offers language plpgsql security definer set search_path=public as $$
declare s public.services; b public.businesses; o public.offers;
        cutoff timestamptz:=coalesce(p_booking_cutoff_at,p_start_at-interval '15 minutes');
        original integer;
begin
 select * into s from public.services where id=p_service_id;
 if s.id is null or not public.is_member_of(s.business_id) then raise exception 'FORBIDDEN'; end if;
 select * into b from public.businesses where id=s.business_id for update;
 select * into s from public.services where id=p_service_id for share;
 if b.status<>'approved' then raise exception 'BUSINESS_NOT_APPROVED'; end if;
 if not s.is_active then raise exception 'VALIDATION_ERROR'; end if;
 original:=coalesce(p_original_price_cents,s.normal_price_cents);
 perform private.validate_offer(p_start_at,cutoff,p_deal_price_cents,original);
 if not p_confirm_overlap and exists(select 1 from public.offers where business_id=b.id and status='published' and start_at<p_start_at+make_interval(mins=>s.duration_minutes) and end_at>p_start_at) then raise exception 'OVERLAP_CONFIRMATION_REQUIRED'; end if;
 insert into public.offers(business_id,service_id,start_at,end_at,original_price_cents,deal_price_cents,capacity_total,capacity_remaining,booking_cutoff_at)
 values(b.id,s.id,p_start_at,p_start_at+make_interval(mins=>s.duration_minutes),original,p_deal_price_cents,p_capacity_total,p_capacity_total,cutoff) returning * into o;
 perform private.emit('offer_published',jsonb_build_object('offer_id',o.id,'business_id',b.id));
 return o;
end $$;

create or replace function public.update_offer(p_offer_id uuid,p_data jsonb,p_confirm_overlap boolean default false)
returns public.offers language plpgsql security definer set search_path=public as $$
declare o public.offers; s public.services; cap integer; st timestamptz; cutoff timestamptz;
        price integer; original integer;
begin
 select * into o from public.offers where id=p_offer_id;
 if o.id is null or not public.is_member_of(o.business_id) then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.businesses where id=o.business_id for update;
 select * into o from public.offers where id=p_offer_id for update;
 if o.status<>'published' or o.start_at<=now() then raise exception 'OFFER_UNAVAILABLE'; end if;
 cap:=coalesce((p_data->>'capacity_total')::int,o.capacity_total);
 if cap not between 1 and 50 then raise exception 'INVALID_CAPACITY'; end if;
 if exists(select 1 from public.bookings where offer_id=o.id) then
  if p_data-'capacity_total'<>'{}'::jsonb then raise exception 'OFFER_HAS_BOOKINGS'; end if;
  if cap<o.capacity_total then raise exception 'INVALID_CAPACITY'; end if;
  update public.offers set capacity_total=cap,capacity_remaining=capacity_remaining+cap-o.capacity_total,updated_at=now() where id=o.id returning * into o;
 else
  select * into s from public.services where id=coalesce((p_data->>'service_id')::uuid,o.service_id) and business_id=o.business_id and is_active;
  if not found then raise exception 'FORBIDDEN'; end if;
  st:=coalesce((p_data->>'start_at')::timestamptz,o.start_at);
  price:=coalesce((p_data->>'deal_price_cents')::int,o.deal_price_cents);
  original:=coalesce((p_data->>'original_price_cents')::int,o.original_price_cents);
  cutoff:=coalesce((p_data->>'booking_cutoff_at')::timestamptz,case when p_data ? 'start_at' then st-interval '15 minutes' else o.booking_cutoff_at end);
  perform private.validate_offer(st,cutoff,price,original);
  if not p_confirm_overlap and exists(select 1 from public.offers where id<>o.id and business_id=o.business_id and status='published' and start_at<st+make_interval(mins=>s.duration_minutes) and end_at>st) then raise exception 'OVERLAP_CONFIRMATION_REQUIRED'; end if;
  update public.offers set service_id=s.id,start_at=st,end_at=st+make_interval(mins=>s.duration_minutes),deal_price_cents=price,original_price_cents=original,capacity_total=cap,capacity_remaining=cap,booking_cutoff_at=cutoff,updated_at=now() where id=o.id returning * into o;
 end if;
 return o;
end $$;

revoke execute on function public.publish_offer(uuid,timestamptz,integer,integer,timestamptz,boolean,integer),public.update_offer(uuid,jsonb,boolean) from public,anon;
grant execute on function public.publish_offer(uuid,timestamptz,integer,integer,timestamptz,boolean,integer),public.update_offer(uuid,jsonb,boolean) to authenticated,service_role;
