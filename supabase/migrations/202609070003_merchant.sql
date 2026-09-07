create function public.create_business(p_data jsonb) returns public.businesses language plpgsql security definer set search_path=public as $$
declare b public.businesses; bid uuid:=gen_random_uuid(); lat float8:=(p_data->>'latitude')::float8; lng float8:=(p_data->>'longitude')::float8;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if lat is null or lng is null or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'VALIDATION_ERROR'; end if;
 insert into public.businesses(id,display_name,slug,legal_name,description,category_slug,phone,public_email,website,address_line,city,district,postal_code,country,location,logo_url,cover_url)
 values(bid,p_data->>'display_name',lower(regexp_replace(p_data->>'display_name','[^a-zA-Z0-9]+','-','g'))||'-'||left(bid::text,8),p_data->>'legal_name',coalesce(p_data->>'description',''),p_data->>'category_slug',p_data->>'phone',p_data->>'public_email',p_data->>'website',p_data->>'address_line',p_data->>'city',coalesce(p_data->>'district',''),p_data->>'postal_code',coalesce(p_data->>'country','CZ'),extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography,p_data->>'logo_url',p_data->>'cover_url) returning * into b;
 insert into public.business_members(business_id,user_id,role) values(b.id,auth.uid(),'owner');
 perform private.emit('merchant_signup_completed',jsonb_build_object('business_id',b.id));
 return b;
end $$;
create function public.update_business(p_business_id uuid,p_data jsonb) returns public.businesses language plpgsql security definer set search_path=public as $$
declare b public.businesses; lat float8; lng float8;
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 select * into b from public.businesses where id=p_business_id for update;
 lat:=coalesce((p_data->>'latitude')::float8,extensions.st_y(b.location::extensions.geometry));
 lng:=coalesce((p_data->>'longitude')::float8,extensions.st_x(b.location::extensions.geometry));
 if lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'VALIDATION_ERROR'; end if;
 update public.businesses set display_name=coalesce(p_data->>'display_name',display_name),description=coalesce(p_data->>'description',description),category_slug=coalesce(p_data->>'category_slug',category_slug),phone=coalesce(p_data->>'phone',phone),public_email=coalesce(p_data->>'public_email',public_email),website=coalesce(p_data->>'website',website),address_line=coalesce(p_data->>'address_line',address_line),city=coalesce(p_data->>'city',city),district=coalesce(p_data->>'district',district),postal_code=coalesce(p_data->>'postal_code',postal_code),location=extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography,logo_url=coalesce(p_data->>'logo_url',logo_url),cover_url=coalesce(p_data->>'cover_url',cover_url),updated_at=now() where id=p_business_id returning * into b;
 return b;
end $$;
create function public.save_service(p_business_id uuid,p_data jsonb,p_service_id uuid default null) returns public.services language plpgsql security definer set search_path=public as $$
declare s public.services;
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.businesses where id=p_business_id for share;
 if p_service_id is null then
  insert into public.services(business_id,name,description,category_slug,duration_minutes,normal_price_cents,image_url,is_active)
  values(p_business_id,p_data->>'name',coalesce(p_data->>'description',''),p_data->>'category_slug',(p_data->>'duration_minutes')::int,(p_data->>'normal_price_cents')::int,p_data->>'image_url',coalesce((p_data->>'is_active')::bool,true)) returning * into s;
 else
  update public.services set name=coalesce(p_data->>'name',name),description=coalesce(p_data->>'description',description),category_slug=coalesce(p_data->>'category_slug',category_slug),duration_minutes=coalesce((p_data->>'duration_minutes')::int,duration_minutes),normal_price_cents=coalesce((p_data->>'normal_price_cents')::int,normal_price_cents),image_url=coalesce(p_data->>'image_url',image_url),is_active=coalesce((p_data->>'is_active')::bool,is_active),updated_at=now() where id=p_service_id and business_id=p_business_id returning * into s;
  if not found then raise exception 'FORBIDDEN'; end if;
 end if;
 return s;
end $$;

create function private.validate_offer(p_start timestamptz,p_cutoff timestamptz,p_deal int,p_original int) returns void language plpgsql set search_path=public as $$
begin
 if p_start is null or p_start<=now() or p_start>now()+interval '7 days' then raise exception 'INVALID_START'; end if;
 if p_cutoff is null or p_cutoff<now()+interval '5 minutes' or p_cutoff>p_start then raise exception 'INVALID_CUTOFF'; end if;
 if p_deal is null or p_deal::bigint*100>p_original::bigint*90 or p_deal::bigint*100<p_original::bigint*15 or p_deal%100<>0 then raise exception 'INVALID_DISCOUNT'; end if;
end $$;

create function public.publish_offer(p_service_id uuid,p_start_at timestamptz,p_deal_price_cents integer,p_capacity_total integer default 1,p_booking_cutoff_at timestamptz default null,p_confirm_overlap boolean default false)
returns public.offers language plpgsql security definer set search_path=public as $$
declare s public.services; b public.businesses; o public.offers; cutoff timestamptz:=coalesce(p_booking_cutoff_at,p_start_at-interval '15 minutes');
begin
 select * into s from public.services where id=p_service_id;
 if s.id is null or not public.is_member_of(s.business_id) then raise exception 'FORBIDDEN'; end if;
 -- Exclusive business lock also makes overlap detection reliable under concurrent publication.
 select * into b from public.businesses where id=s.business_id for update;
 select * into s from public.services where id=p_service_id for share;
 if b.status<>'approved' then raise exception 'BUSINESS_NOT_APPROVED'; end if;
 if not s.is_active then raise exception 'VALIDATION_ERROR'; end if;
 perform private.validate_offer(p_start_at,cutoff,p_deal_price_cents,s.normal_price_cents);
 if not p_confirm_overlap and exists(select 1 from public.offers where business_id=b.id and status='published' and start_at<p_start_at+make_interval(mins=>s.duration_minutes) and end_at>p_start_at) then raise exception 'OVERLAP_CONFIRMATION_REQUIRED'; end if;
 insert into public.offers(business_id,service_id,start_at,end_at,original_price_cents,deal_price_cents,capacity_total,capacity_remaining,booking_cutoff_at)
 values(b.id,s.id,p_start_at,p_start_at+make_interval(mins=>s.duration_minutes),s.normal_price_cents,p_deal_price_cents,p_capacity_total,p_capacity_total,cutoff) returning * into o;
 perform private.emit('offer_published',jsonb_build_object('offer_id',o.id,'business_id',b.id));
 return o;
end $$;

create function public.update_offer(p_offer_id uuid,p_data jsonb,p_confirm_overlap boolean default false) returns public.offers language plpgsql security definer set search_path=public as $$
declare o public.offers; s public.services; cap integer; st timestamptz; cutoff timestamptz; price integer;
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
  st:=coalesce((p_data->>'start_at')::timestamptz,o.start_at); price:=coalesce((p_data->>'deal_price_cents')::int,o.deal_price_cents); cutoff:=coalesce((p_data->>'booking_cutoff_at')::timestamptz,case when p_data ? 'start_at' then st-interval '15 minutes' else o.booking_cutoff_at end);
  perform private.validate_offer(st,cutoff,price,s.normal_price_cents);
  if not p_confirm_overlap and exists(select 1 from public.offers where id<>o.id and business_id=o.business_id and status='published' and start_at<st+make_interval(mins=>s.duration_minutes) and end_at>st) then raise exception 'OVERLAP_CONFIRMATION_REQUIRED'; end if;
  update public.offers set service_id=s.id,start_at=st,end_at=st+make_interval(mins=>s.duration_minutes),deal_price_cents=price,original_price_cents=s.normal_price_cents,capacity_total=cap,capacity_remaining=cap,booking_cutoff_at=cutoff,updated_at=now() where id=o.id returning * into o;
 end if;
 return o;
end $$;
revoke execute on function public.create_business(jsonb),public.update_business(uuid,jsonb),public.save_service(uuid,jsonb,uuid),public.publish_offer(uuid,timestamptz,integer,integer,timestamptz,boolean),public.update_offer(uuid,jsonb,boolean) from public,anon;
grant execute on function public.create_business(jsonb),public.update_business(uuid,jsonb),public.save_service(uuid,jsonb,uuid),public.publish_offer(uuid,timestamptz,integer,integer,timestamptz,boolean),public.update_offer(uuid,jsonb,boolean) to authenticated,service_role;
