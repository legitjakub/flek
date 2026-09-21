/*
 * Verified anonymous reviews, fail-closed moderation of public merchant content,
 * explicit WhatsApp readiness and RLS for the two private tables flagged by the
 * production security advisor.
 *
 * Customer and merchant clients still write through SECURITY DEFINER RPCs. The
 * moderation worker is the only process that can publish submitted copy or images.
 */

-- --------------------------------------------------------------------- private table hardening

alter table private.settings enable row level security;
alter table private.stripe_events enable row level security;
revoke all on private.settings, private.stripe_events from public, anon, authenticated;

-- The privacy text now documents public reviews and automated safety moderation.
insert into public.legal_documents(kind, version) values ('privacy', '1.1');
update public.legal_documents set effective_at = now()
where kind = 'privacy' and version = '1.1';

-- --------------------------------------------------------------------- moderation queue

create table private.content_moderation (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  entity_type text not null check (entity_type in ('service', 'business', 'review')),
  entity_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  image_paths jsonb not null default '{}'::jsonb check (jsonb_typeof(image_paths) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'manual_review', 'approved', 'rejected', 'superseded', 'failed')),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  available_at timestamptz not null default now(),
  lease uuid,
  lease_until timestamptz,
  provider_result jsonb,
  last_error text check (length(coalesce(last_error, '')) <= 500),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_moderation_claim on private.content_moderation (available_at, created_at)
  where status in ('pending', 'processing');
create index content_moderation_admin on private.content_moderation (status, created_at desc);
create unique index content_moderation_one_live_entity on private.content_moderation (entity_type, entity_id)
  where status in ('pending', 'processing', 'manual_review');
alter table private.content_moderation enable row level security;
revoke all on private.content_moderation from public, anon, authenticated;

alter table public.services
  add column content_status text not null default 'approved'
    check (content_status in ('approved', 'pending', 'rejected')),
  add column pending_moderation_id uuid;
alter table public.businesses
  add column content_status text not null default 'approved'
    check (content_status in ('approved', 'pending', 'rejected')),
  add column pending_moderation_id uuid;
alter table public.bookings
  add column review_body text check (length(review_body) between 1 and 800),
  add column review_status text check (review_status in ('pending', 'approved', 'rejected')),
  add column review_moderation_id uuid,
  add column review_moderated_at timestamptz;

comment on column public.bookings.review_body is
  'Public anonymous review copy. Null until text moderation approves it.';

create function private.enqueue_content_moderation(
  p_entity_type text,
  p_entity_id uuid,
  p_business_id uuid,
  p_payload jsonb,
  p_image_paths jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare moderation_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_entity_type not in ('service', 'business', 'review')
     or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(coalesce(p_image_paths, '{}'::jsonb)) <> 'object' then
    raise exception 'VALIDATION_ERROR';
  end if;

  update private.content_moderation
  set status = 'superseded', lease = null, lease_until = null, updated_at = now()
  where entity_type = p_entity_type and entity_id = p_entity_id
    and status in ('pending', 'processing', 'manual_review');

  insert into private.content_moderation(author_id, business_id, entity_type, entity_id, payload, image_paths)
  values(auth.uid(), p_business_id, p_entity_type, p_entity_id, p_payload, coalesce(p_image_paths, '{}'::jsonb))
  returning id into moderation_id;
  return moderation_id;
end $$;

-- The same database-held worker credential already protects notification-delivery.
create function private.kick_content_moderation() returns void
language plpgsql security definer set search_path = '' as $$
declare worker_secret text;
begin
  if not exists (
    select 1 from private.content_moderation
    where status in ('pending', 'processing') and available_at <= now() and attempts < 8
  ) and not exists (
    select 1 from private.content_moderation
    where status in ('approved', 'rejected', 'superseded', 'failed') and image_paths <> '{}'::jsonb
  ) then return; end if;
  select value into worker_secret from private.notification_config where key = 'worker_secret';
  if worker_secret is null or private.setting('functions_url') is null then return; end if;
  perform net.http_post(
    url := private.setting('functions_url') || '/content-moderation',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || worker_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000);
end $$;

create function public.claim_content_moderation()
returns table(
  id uuid, lease uuid, author_id uuid, business_id uuid, entity_type text,
  entity_id uuid, payload jsonb, image_paths jsonb, admin_override boolean, attempts smallint
)
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  return query
  with picked as (
    select m.id from private.content_moderation m
    where (m.status = 'pending' and m.available_at <= now())
       or (m.status = 'processing' and m.lease_until < now())
    order by m.available_at, m.created_at
    for update skip locked limit 5
  )
  update private.content_moderation m
  set status = 'processing', lease = gen_random_uuid(), lease_until = now() + interval '2 minutes',
      attempts = (m.attempts + 1)::smallint, updated_at = now()
  from picked where m.id = picked.id
  returning m.id, m.lease, m.author_id, m.business_id, m.entity_type, m.entity_id,
    m.payload, m.image_paths, coalesce((m.provider_result->>'admin_override')::boolean, false), m.attempts;
end $$;

create function private.apply_content_moderation(
  p_item private.content_moderation,
  p_public_images jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_item.entity_type = 'service' then
    update public.services set
      name = p_item.payload->>'name',
      description = coalesce(p_item.payload->>'description', ''),
      image_url = case
        when p_item.image_paths ? 'service' then p_public_images->>'service'
        else nullif(p_item.payload->>'image_url', '') end,
      is_active = coalesce((p_item.payload->>'is_active')::boolean, is_active),
      content_status = 'approved', pending_moderation_id = null, updated_at = now()
    where id = p_item.entity_id and pending_moderation_id = p_item.id;
  elsif p_item.entity_type = 'business' then
    update public.businesses set
      display_name = p_item.payload->>'display_name',
      description = coalesce(p_item.payload->>'description', ''),
      logo_url = case when p_item.image_paths ? 'logo' then p_public_images->>'logo'
        else nullif(p_item.payload->>'logo_url', '') end,
      cover_url = case when p_item.image_paths ? 'cover' then p_public_images->>'cover'
        else nullif(p_item.payload->>'cover_url', '') end,
      content_status = 'approved', pending_moderation_id = null, updated_at = now()
    where id = p_item.entity_id and pending_moderation_id = p_item.id;
  elsif p_item.entity_type = 'review' then
    update public.bookings set
      review_body = p_item.payload->>'body', review_status = 'approved',
      review_moderation_id = null, review_moderated_at = now()
    where id = p_item.entity_id and review_moderation_id = p_item.id;
  end if;
end $$;

create function public.finish_content_moderation(
  p_id uuid,
  p_lease uuid,
  p_outcome text,
  p_provider jsonb default null,
  p_error text default null,
  p_public_images jsonb default '{}'::jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
declare item private.content_moderation; final_status text;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_outcome not in ('approved', 'manual_review', 'retry') then raise exception 'VALIDATION_ERROR'; end if;
  select * into item from private.content_moderation
  where id = p_id and status = 'processing' and lease = p_lease for update;
  if not found then return 'stale'; end if;

  if p_outcome = 'approved' then
    perform private.apply_content_moderation(item, coalesce(p_public_images, '{}'::jsonb));
    final_status := 'approved';
  elsif p_outcome = 'manual_review' or item.attempts >= 8 then
    final_status := 'manual_review';
  else
    final_status := 'pending';
  end if;

  update private.content_moderation set
    status = final_status,
    provider_result = coalesce(p_provider, provider_result),
    last_error = left(p_error, 500),
    available_at = case when final_status = 'pending'
      then now() + make_interval(secs => least(3600, 15 * (2 ^ greatest(item.attempts - 1, 0))::integer))
      else available_at end,
    lease = null, lease_until = null,
    resolved_at = case when final_status in ('approved', 'manual_review') then now() else null end,
    updated_at = now()
  where id = p_id;
  return final_status;
end $$;

revoke all on function public.claim_content_moderation(),
  public.finish_content_moderation(uuid,uuid,text,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.claim_content_moderation(),
  public.finish_content_moderation(uuid,uuid,text,jsonb,text,jsonb) to service_role;

-- Terminal jobs keep no public copy or abandoned private upload. Deletion from the
-- object store is retried idempotently by the worker before these references are cleared.
create function public.content_moderation_cleanup()
returns table(id uuid,image_paths jsonb)
language sql security definer set search_path = '' as $$
  select m.id,m.image_paths from private.content_moderation m
  where m.status in ('approved','rejected','superseded','failed') and m.image_paths <> '{}'::jsonb
  order by m.updated_at limit 25
$$;

create function public.finish_content_moderation_cleanup(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  update private.content_moderation set payload='{}'::jsonb,image_paths='{}'::jsonb,updated_at=now()
  where id=p_id and status in ('approved','rejected','superseded','failed');
end $$;

revoke all on function public.content_moderation_cleanup(),
  public.finish_content_moderation_cleanup(uuid) from public,anon,authenticated;
grant execute on function public.content_moderation_cleanup(),
  public.finish_content_moderation_cleanup(uuid) to service_role;

-- Retry work even when the initial pg_net request met a transient outage.
do $$
declare job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'flek-content-moderation';
  if job_id is not null then perform cron.unschedule(job_id); end if;
  perform cron.schedule('flek-content-moderation', '* * * * *', 'select private.kick_content_moderation()');
end $$;

-- --------------------------------------------------------------------- private upload staging

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('moderation-pending', 'moderation-pending', false, 5242880,
  array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Authenticated users can no longer publish files straight into the public buckets.
drop policy if exists flek_images_insert on storage.objects;
drop policy if exists flek_images_update on storage.objects;

create policy moderation_pending_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'moderation-pending'
  and exists (
    select 1 from public.business_members m
    where m.user_id = auth.uid() and m.business_id::text = (storage.foldername(name))[1]
  )
);
create policy moderation_pending_read on storage.objects for select to authenticated
using (
  bucket_id = 'moderation-pending'
  and (
    public.is_admin()
    or exists (
      select 1 from public.business_members m
      where m.user_id = auth.uid() and m.business_id::text = (storage.foldername(name))[1]
    )
  )
);
create policy moderation_pending_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'moderation-pending'
  and exists (
    select 1 from public.business_members m
    where m.user_id = auth.uid() and m.business_id::text = (storage.foldername(name))[1]
  )
);

-- --------------------------------------------------------------------- moderated merchant writes

create or replace function public.save_service(p_business_id uuid,p_data jsonb,p_service_id uuid default null)
returns public.services language plpgsql security definer set search_path = '' as $$
declare
  s public.services;
  moderation_id uuid;
  requested_image text := case when p_data ? 'image_url' then p_data->>'image_url' end;
  image_path text;
  requested_active boolean := coalesce((p_data->>'is_active')::boolean, true);
  needs_moderation boolean;
  public_payload jsonb;
begin
  if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.businesses where id = p_business_id for share;
  if not found then raise exception 'NOT_FOUND'; end if;

  if requested_image like 'moderation-pending://%' then
    image_path := substring(requested_image from 22);
    if split_part(image_path, '/', 1) <> p_business_id::text then raise exception 'FORBIDDEN'; end if;
  end if;

  if p_service_id is null then
    insert into public.services(
      business_id,name,description,category_slug,duration_minutes,normal_price_cents,
      image_url,is_active,template_slug,content_status
    ) values(
      p_business_id,p_data->>'name',coalesce(p_data->>'description',''),p_data->>'category_slug',
      (p_data->>'duration_minutes')::int,(p_data->>'normal_price_cents')::int,null,false,
      nullif(p_data->>'template_slug',''),'pending'
    ) returning * into s;
    needs_moderation := true;
    perform private.emit('service_created',jsonb_build_object('service_id',s.id,'business_id',p_business_id,'template',s.template_slug));
  else
    select * into s from public.services where id = p_service_id and business_id = p_business_id for update;
    if not found then raise exception 'FORBIDDEN'; end if;
    if not (p_data ? 'is_active') then requested_active := s.is_active; end if;

    if requested_image is not null and image_path is null and requested_image is distinct from s.image_url
       and requested_image not like '/images/services/%'
       and not exists (select 1 from public.service_photos p where p.image_url = requested_image)
       and not exists (select 1 from public.businesses b where b.id = p_business_id and requested_image in (b.logo_url, b.cover_url)) then
      raise exception 'IMAGE_REUPLOAD_REQUIRED';
    end if;

    update public.services set
      category_slug = coalesce(p_data->>'category_slug', category_slug),
      duration_minutes = coalesce((p_data->>'duration_minutes')::int, duration_minutes),
      normal_price_cents = coalesce((p_data->>'normal_price_cents')::int, normal_price_cents),
      template_slug = case when p_data ? 'template_slug' then nullif(p_data->>'template_slug','') else template_slug end,
      is_active = case when requested_active = false then false else is_active end,
      updated_at = now()
    where id = p_service_id returning * into s;

    needs_moderation := coalesce(p_data->>'name',s.name) is distinct from s.name
      or coalesce(p_data->>'description',s.description) is distinct from s.description
      or (p_data ? 'image_url' and requested_image is distinct from s.image_url)
      or (requested_active and not s.is_active);
  end if;

  if needs_moderation then
    public_payload := jsonb_build_object(
      'name', coalesce(p_data->>'name',s.name), 'description', coalesce(p_data->>'description',s.description),
      'image_url', case when image_path is null then
        case when p_data ? 'image_url' then requested_image else s.image_url end end,
      'is_active', requested_active
    );
    moderation_id := private.enqueue_content_moderation(
      'service', s.id, p_business_id, public_payload,
      case when image_path is null then '{}'::jsonb else jsonb_build_object('service', image_path) end
    );
    update public.services set content_status = 'pending', pending_moderation_id = moderation_id where id = s.id
    returning * into s;
    perform private.kick_content_moderation();
  end if;
  return s;
end $$;

create or replace function public.update_business(p_business_id uuid,p_data jsonb)
returns public.businesses language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses; lat float8; lng float8; win integer; moderation_id uuid;
  logo text; cover text; logo_path text; cover_path text; needs_moderation boolean;
begin
  if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
  select * into b from public.businesses where id=p_business_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  lat:=coalesce((p_data->>'latitude')::float8,extensions.st_y(b.location::extensions.geometry));
  lng:=coalesce((p_data->>'longitude')::float8,extensions.st_x(b.location::extensions.geometry));
  if lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'VALIDATION_ERROR'; end if;
  win:=coalesce((p_data->>'cancellation_window_minutes')::integer,b.cancellation_window_minutes);
  if win not between 0 and 10080 then raise exception 'INVALID_CANCELLATION_WINDOW'; end if;
  logo := case when p_data ? 'logo_url' then p_data->>'logo_url' else b.logo_url end;
  cover := case when p_data ? 'cover_url' then p_data->>'cover_url' else b.cover_url end;
  if logo like 'moderation-pending://%' then logo_path := substring(logo from 22); end if;
  if cover like 'moderation-pending://%' then cover_path := substring(cover from 22); end if;
  if (logo_path is not null and split_part(logo_path,'/',1) <> p_business_id::text)
     or (cover_path is not null and split_part(cover_path,'/',1) <> p_business_id::text) then raise exception 'FORBIDDEN'; end if;
  if p_data ? 'logo_url' and logo_path is null and logo is distinct from b.logo_url then raise exception 'IMAGE_REUPLOAD_REQUIRED'; end if;
  if p_data ? 'cover_url' and cover_path is null and cover is distinct from b.cover_url
     and cover not like '/images/services/%' then raise exception 'IMAGE_REUPLOAD_REQUIRED'; end if;

  needs_moderation := coalesce(p_data->>'display_name',b.display_name) is distinct from b.display_name
    or coalesce(p_data->>'description',b.description) is distinct from b.description
    or (p_data ? 'logo_url' and logo is distinct from b.logo_url)
    or (p_data ? 'cover_url' and cover is distinct from b.cover_url);

  update public.businesses set
    legal_name=coalesce(nullif(btrim(p_data->>'legal_name'),''),legal_name),
    category_slug=coalesce(p_data->>'category_slug',category_slug),phone=coalesce(p_data->>'phone',phone),
    public_email=coalesce(p_data->>'public_email',public_email),website=coalesce(p_data->>'website',website),
    address_line=coalesce(p_data->>'address_line',address_line),city=coalesce(p_data->>'city',city),
    district=coalesce(p_data->>'district',district),postal_code=coalesce(p_data->>'postal_code',postal_code),
    location=extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography,
    cancellation_window_minutes=win,updated_at=now()
  where id=p_business_id returning * into b;

  if needs_moderation then
    moderation_id := private.enqueue_content_moderation(
      'business', b.id, b.id,
      jsonb_build_object(
        'display_name',coalesce(p_data->>'display_name',b.display_name),'description',coalesce(p_data->>'description',b.description),
        'logo_url',case when logo_path is null then logo end,'cover_url',case when cover_path is null then cover end
      ),
      jsonb_strip_nulls(jsonb_build_object('logo',logo_path,'cover',cover_path))
    );
    update public.businesses set content_status='pending',pending_moderation_id=moderation_id where id=b.id returning * into b;
    perform private.kick_content_moderation();
  end if;
  return b;
end $$;

create or replace function public.create_business(p_data jsonb)
returns public.businesses language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses; bid uuid:=gen_random_uuid(); lat float8:=(p_data->>'latitude')::float8;
  lng float8:=(p_data->>'longitude')::float8; win integer:=coalesce((p_data->>'cancellation_window_minutes')::integer,60);
  moderation_id uuid; logo text:=p_data->>'logo_url'; cover text:=p_data->>'cover_url'; logo_path text; cover_path text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if lat is null or lng is null or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'VALIDATION_ERROR'; end if;
  if win not between 0 and 10080 then raise exception 'INVALID_CANCELLATION_WINDOW'; end if;
  if logo like 'moderation-pending://%' then logo_path := substring(logo from 22); end if;
  if cover like 'moderation-pending://%' then cover_path := substring(cover from 22); end if;
  if (logo_path is not null and split_part(logo_path,'/',1) <> bid::text)
     or (cover_path is not null and split_part(cover_path,'/',1) <> bid::text) then raise exception 'FORBIDDEN'; end if;
  if logo is not null and logo_path is null then raise exception 'IMAGE_REUPLOAD_REQUIRED'; end if;
  if cover is not null and cover_path is null and cover not like '/images/services/%' then raise exception 'IMAGE_REUPLOAD_REQUIRED'; end if;

  insert into public.businesses(
    id,display_name,slug,legal_name,description,category_slug,phone,public_email,website,address_line,city,
    district,postal_code,country,location,logo_url,cover_url,cancellation_window_minutes,content_status
  ) values(
    bid,p_data->>'display_name',lower(regexp_replace(p_data->>'display_name','[^a-zA-Z0-9]+','-','g'))||'-'||left(bid::text,8),
    p_data->>'legal_name',coalesce(p_data->>'description',''),p_data->>'category_slug',p_data->>'phone',p_data->>'public_email',
    p_data->>'website',p_data->>'address_line',p_data->>'city',coalesce(p_data->>'district',''),p_data->>'postal_code',
    coalesce(p_data->>'country','CZ'),extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography,
    null,null,win,'pending'
  ) returning * into b;
  insert into public.business_members(business_id,user_id,role) values(b.id,auth.uid(),'owner');
  moderation_id := private.enqueue_content_moderation(
    'business', b.id, b.id,
    jsonb_build_object('display_name',p_data->>'display_name','description',coalesce(p_data->>'description',''),
      'logo_url',null,'cover_url',case when cover_path is null then cover end),
    jsonb_strip_nulls(jsonb_build_object('logo',logo_path,'cover',cover_path))
  );
  update public.businesses set pending_moderation_id=moderation_id where id=b.id returning * into b;
  perform private.emit('merchant_signup_completed',jsonb_build_object('business_id',b.id));
  perform private.kick_content_moderation();
  return b;
end $$;

revoke execute on function public.save_service(uuid,jsonb,uuid), public.update_business(uuid,jsonb),
  public.create_business(jsonb) from public, anon;
grant execute on function public.save_service(uuid,jsonb,uuid), public.update_business(uuid,jsonb),
  public.create_business(jsonb) to authenticated, service_role;

-- A pending or rejected public profile cannot be approved accidentally.
create function private.require_approved_business_content() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.content_status <> 'approved' then
    raise exception 'CONTENT_REVIEW_REQUIRED';
  end if;
  return new;
end $$;
create trigger businesses_content_before_approval before update of status on public.businesses
for each row execute function private.require_approved_business_content();

-- --------------------------------------------------------------------- verified anonymous reviews

create function public.submit_booking_review(p_booking_id uuid,p_rating integer,p_body text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.bookings; body text:=nullif(btrim(p_body),''); moderation_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_rating is null or p_rating not between 1 and 5 or length(coalesce(body,'')) > 800 then raise exception 'VALIDATION_ERROR'; end if;
  select * into k from public.bookings where id=p_booking_id and customer_id=auth.uid() for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  if k.status <> 'completed' then raise exception 'BOOKING_NOT_COMPLETED'; end if;

  update public.bookings set rating=p_rating::smallint,rated_at=now() where id=k.id;
  if body is null then
    update private.content_moderation set status='superseded',lease=null,lease_until=null,updated_at=now()
    where entity_type='review' and entity_id=k.id and status in ('pending','processing','manual_review');
    update public.bookings set review_body=null,review_status=null,review_moderation_id=null,review_moderated_at=now() where id=k.id;
    return jsonb_build_object('rating',p_rating,'review_status',null);
  end if;

  moderation_id := private.enqueue_content_moderation(
    'review',k.id,k.business_id,jsonb_build_object('body',body),'{}'::jsonb
  );
  update public.bookings set review_body=null,review_status='pending',review_moderation_id=moderation_id,
    review_moderated_at=null where id=k.id;
  perform private.kick_content_moderation();
  return jsonb_build_object('rating',p_rating,'review_status','pending');
end $$;

create function public.business_reviews(p_business_id uuid,p_limit integer default 10,p_before timestamptz default null)
returns table(
  review_id uuid, service_name text, visited_at timestamptz, rating smallint,
  comment text, rated_at timestamptz, verified boolean
)
language sql stable security definer set search_path = '' as $$
  select k.id,k.service_name_snapshot,k.start_at_snapshot,k.rating,
    case when k.review_status='approved' then k.review_body end,k.rated_at,true
  from public.bookings k join public.businesses b on b.id=k.business_id
  where k.business_id=p_business_id and b.status='approved' and k.status='completed' and k.rating is not null
    and (p_before is null or k.rated_at < p_before)
  order by k.rated_at desc,k.id desc limit least(greatest(coalesce(p_limit,10),1),50)
$$;

revoke all on function public.submit_booking_review(uuid,integer,text),
  public.business_reviews(uuid,integer,timestamptz) from public, anon;
grant execute on function public.submit_booking_review(uuid,integer,text) to authenticated,service_role;
grant execute on function public.business_reviews(uuid,integer,timestamptz) to anon,authenticated,service_role;

-- Account deletion keeps the legally required financial booking snapshot, but a
-- voluntary public review and its pending moderation copy disappear with the account.
create or replace function public.delete_my_account() returns text
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id = u for update;
  if exists (select 1 from public.business_members where user_id = u) then raise exception 'BUSINESS_MEMBER'; end if;
  if exists (select 1 from public.user_roles where user_id = u) then raise exception 'FORBIDDEN'; end if;
  if exists (select 1 from public.bookings where customer_id = u
             and status in ('pending_payment','pending_merchant','capturing','confirmed') and end_at_snapshot > now()) then
    raise exception 'ACTIVE_BOOKINGS';
  end if;

  update private.content_moderation set status='superseded',updated_at=now()
  where author_id=u and entity_type='review' and status in ('pending','processing','manual_review');
  update public.bookings set rating=null,rated_at=null,review_body=null,review_status=null,
    review_moderation_id=null,review_moderated_at=null where customer_id=u;
  delete from public.favorites where user_id=u;
  delete from private.push_subscriptions where user_id=u;
  delete from private.whatsapp_contacts where kind='customer' and user_id=u;
  delete from public.notification_preferences where user_id=u;
  delete from public.notifications where user_id=u;
  delete from public.referral_codes where user_id=u;
  update public.analytics_events set user_id=null where user_id=u;
  update public.content_reports set reporter_id=null where reporter_id=u;
  update public.profiles set first_name='Smazaný',last_name='účet',phone=null,avatar_url=null,updated_at=now() where id=u;

  update auth.users set email='smazany-'||u::text||'@smazany.invalid',phone=null,encrypted_password=null,
    raw_user_meta_data='{}'::jsonb,banned_until='2999-01-01 00:00:00+00'::timestamptz,updated_at=now() where id=u;
  delete from auth.identities where user_id=u;
  delete from auth.mfa_factors where user_id=u;
  delete from auth.one_time_tokens where user_id=u;
  delete from auth.sessions where user_id=u;
  delete from auth.refresh_tokens where user_id=u::text;

  perform private.kick_content_moderation();
  perform private.audit('account_deleted','user',u,null,null,'Smazání účtu zákazníkem');
  return 'deleted';
end $$;

create or replace function public.business_public(p_business_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(x) from (
    select b.id,b.display_name,b.slug,b.description,b.category_slug,b.address_line,b.city,b.district,
      b.logo_url,b.cover_url,b.google_place_id,b.cancellation_window_minutes,
      extensions.st_y(b.location::extensions.geometry) latitude,
      extensions.st_x(b.location::extensions.geometry) longitude,
      (select count(*) from public.offer_details d where d.business_id=b.id and d.bookable)::integer open_offers,
      (select round(avg(k.rating),1) from public.bookings k
        where k.business_id=b.id and k.status='completed' and k.rating is not null) rating_avg,
      (select count(*) from public.bookings k
        where k.business_id=b.id and k.status='completed' and k.rating is not null)::integer rating_count
    from public.businesses b where b.id=p_business_id and b.status='approved'
  ) x
$$;
revoke execute on function public.business_public(uuid) from public;
grant execute on function public.business_public(uuid) to anon,authenticated,service_role;

-- Expose only the signed-in customer's own moderation state in their existing booking row.
drop function public.my_bookings();
drop view public.customer_booking_details;
create view public.customer_booking_details with (security_invoker = true) as
select k.id,k.offer_id,k.business_id,k.customer_id,
  case when private.booking_was_agreed(k.status,k.confirmation_version,k.confirmed_at) then k.reservation_code end reservation_code,
  k.price_cents,k.service_name_snapshot,k.business_name_snapshot,k.business_address_snapshot,
  k.start_at_snapshot,k.end_at_snapshot,k.original_price_cents_snapshot,k.status,k.created_at,k.cancelled_at,k.resolved_at,
  k.cancellation_reason,k.rating,k.rated_at,k.review_body,k.review_status,k.review_moderated_at,k.payment_id,
  k.cancellation_window_minutes,b.phone business_phone,
  k.status='confirmed' and (now()<k.start_at_snapshot-make_interval(mins=>k.cancellation_window_minutes)
    or now()<coalesce(k.confirmed_at,k.created_at)+interval '10 minutes') can_cancel,
  greatest(k.start_at_snapshot-make_interval(mins=>k.cancellation_window_minutes),
    coalesce(k.confirmed_at,k.created_at)+interval '10 minutes') cancellation_deadline,
  now() server_now,(select pay.status from public.payments pay where pay.id=k.payment_id) payment_status,
  k.confirmation_version,k.checkout_expires_at,k.confirmation_expires_at,k.authorized_at,k.confirmed_at,k.merchant_decided_at,
  (select pay.authorization_state from public.payments pay where pay.id=k.payment_id) authorization_state
from public.bookings k join public.businesses b on b.id=k.business_id;

create function public.my_bookings() returns setof public.customer_booking_details
language sql stable security definer set search_path = '' as $$
  select * from public.customer_booking_details where customer_id=auth.uid() order by created_at desc
$$;
revoke all on public.customer_booking_details from anon,authenticated;
revoke execute on function public.my_bookings() from public,anon;
grant all on public.customer_booking_details to service_role;
grant execute on function public.my_bookings() to authenticated,service_role;

-- One in-app reminder and optional push when a visit becomes completed. Never e-mail or WhatsApp.
alter table public.notifications drop constraint notifications_event_check;
alter table public.notifications add constraint notifications_event_check
  check (event in ('requested','confirmed','cancelled','review_requested','account'));
alter table public.notifications drop constraint notifications_href_check;
alter table public.notifications add constraint notifications_href_check
  check (href in ('/rezervace','/partner/rezervace','/partner/provozovna','/profil')
    or href ~ '^/rezervace\?ohodnotit=[0-9a-f-]{36}$');
alter table public.notification_preferences drop constraint notification_preferences_event_check;
alter table public.notification_preferences add constraint notification_preferences_event_check
  check (event in ('requested','confirmed','cancelled','review_requested'));

create or replace function public.save_notification_preference(
  p_scope text,p_event text,p_email boolean,p_push boolean,p_whatsapp boolean default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_event not in ('requested','confirmed','cancelled','review_requested') or length(p_scope) not between 8 and 40 then
    raise exception 'INVALID_PREFERENCE';
  end if;
  if p_event='review_requested' and p_scope<>'customer' then raise exception 'INVALID_PREFERENCE'; end if;
  if p_scope<>'customer' and not exists (
    select 1 from public.business_members where business_id::text=p_scope and user_id=auth.uid()
  ) then raise exception 'FORBIDDEN'; end if;
  insert into public.notification_preferences(user_id,scope,event,email,push,whatsapp)
  values(auth.uid(),p_scope,p_event,
    case when p_event='review_requested' then false else p_email end,
    p_push,
    case when p_event='review_requested' then false else coalesce(p_whatsapp,true) end)
  on conflict(user_id,scope,event) do update set
    email=excluded.email,push=excluded.push,
    whatsapp=case when p_event='review_requested' then false
      else coalesce(p_whatsapp,public.notification_preferences.whatsapp) end;
end $$;

create or replace function private.booking_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare recipient record; nid uuid; event_kind text; heading text; detail text; scope_key text;
begin
  if TG_OP='UPDATE' and new.status=old.status then return new; end if;
  if new.confirmation_version=1 and new.authorized_at is null then return new; end if;

  if new.status='completed' then
    insert into public.notifications(user_id,booking_id,business_id,event,title,body,href)
    values(new.customer_id,new.id,null,'review_requested','Jaký byl tvůj FLEK?',
      new.service_name_snapshot||' · '||new.business_name_snapshot,
      '/rezervace?ohodnotit='||new.id::text)
    on conflict do nothing returning id into nid;
    if nid is not null then
      insert into private.notification_delivery(notification_id,channel,target)
      select nid,'push',s.id::text from private.push_subscriptions s
      where s.user_id=new.customer_id and coalesce((
        select push from public.notification_preferences
        where user_id=new.customer_id and scope='customer' and event='review_requested'
      ),false);
      perform private.kick_notification_delivery();
    end if;
    return new;
  end if;

  event_kind := case when new.status='pending_merchant' then 'requested' when new.status='confirmed' then 'confirmed'
    when new.status in ('cancelled_by_customer','cancelled_by_merchant','expired','rejected','payment_failed') then 'cancelled' end;
  if event_kind is null then return new; end if;
  for recipient in
    select user_id uid,new.business_id bid from public.business_members where business_id=new.business_id
    union all select new.customer_id,null::uuid where event_kind<>'requested'
      and not(new.confirmation_version=1 and new.confirmed_at is null and new.status='cancelled_by_customer')
  loop
    scope_key:=coalesce(recipient.bid::text,'customer');
    heading:=case when event_kind='requested' then 'Nová rezervace čeká na potvrzení'
      when event_kind='confirmed' and recipient.bid is null then 'Tvůj FLEK je potvrzený'
      when event_kind='confirmed' then 'Rezervace je potvrzená'
      when new.status='rejected' and recipient.bid is null then 'Podnik rezervaci nepotvrdil'
      when new.status='rejected' then 'Žádost o rezervaci byla odmítnuta'
      when new.status='expired' and recipient.bid is null then 'Čas na potvrzení vypršel'
      when new.status='expired' then 'Žádost o rezervaci vypršela'
      when new.status='payment_failed' and recipient.bid is null then 'Platbu se nepodařilo dokončit'
      when new.status='payment_failed' then 'Rezervaci se nepodařilo dokončit'
      when new.status='cancelled_by_customer' and new.confirmed_at is null and new.confirmation_version=1 then 'Zákazník žádost zrušil'
      else 'Rezervace byla zrušena' end;
    detail:=new.service_name_snapshot||' · '||to_char(new.start_at_snapshot at time zone 'Europe/Prague','DD.MM.YYYY HH24:MI')
      ||' · 1 místo · '||new.business_name_snapshot
      ||case when event_kind='requested' then ' · potvrďte do '||to_char(new.confirmation_expires_at at time zone 'Europe/Prague','HH24:MI') else '' end;
    nid:=null;
    insert into public.notifications(user_id,booking_id,business_id,event,title,body,href)
    values(recipient.uid,new.id,recipient.bid,event_kind,heading,detail,
      case when recipient.bid is null then '/rezervace' else '/partner/rezervace' end)
    on conflict do nothing returning id into nid;
    if nid is null then continue; end if;
    insert into private.notification_delivery(notification_id,channel,target)
    select nid,'email',u.email from auth.users u where u.id=recipient.uid and u.email_confirmed_at is not null
      and u.email not like '%@flek.test' and (recipient.bid is null or coalesce((select email from public.notification_preferences
        where user_id=recipient.uid and scope=scope_key and event=event_kind),true));
    insert into private.notification_delivery(notification_id,channel,target)
    select nid,'push',s.id::text from private.push_subscriptions s where s.user_id=recipient.uid
      and coalesce((select push from public.notification_preferences where user_id=recipient.uid and scope=scope_key and event=event_kind),false);
    insert into private.notification_delivery(notification_id,channel,target)
    select nid,'whatsapp',c.id::text from private.whatsapp_contacts c where c.status='verified'
      and case when recipient.bid is null then c.kind='customer' and c.user_id=recipient.uid and new.status<>'cancelled_by_customer'
        else c.kind='business' and c.business_id=new.business_id and c.consent_by=recipient.uid
          and new.status not in ('rejected','cancelled_by_merchant') and not(event_kind='confirmed' and new.merchant_decided_at is not null) end
      and coalesce((select whatsapp from public.notification_preferences where user_id=recipient.uid and scope=scope_key and event=event_kind),true);
  end loop;
  perform private.kick_notification_delivery();
  return new;
end $$;

-- --------------------------------------------------------------------- admin moderation

create function public.admin_content_moderation(p_status text default 'manual_review')
returns table(
  id uuid,entity_type text,entity_id uuid,business_id uuid,business_name text,
  payload jsonb,image_paths jsonb,status text,attempts smallint,last_error text,provider_result jsonb,
  created_at timestamptz,resolved_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return query select m.id,m.entity_type,m.entity_id,m.business_id,b.display_name,m.payload,m.image_paths,
    m.status,m.attempts,m.last_error,m.provider_result,m.created_at,m.resolved_at
  from private.content_moderation m left join public.businesses b on b.id=m.business_id
  where p_status is null or m.status=p_status order by m.created_at desc limit 100;
end $$;

create function private.moderation_rejection_notice(p_item private.content_moderation) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_item.entity_type='review' then
    insert into public.notifications(user_id,booking_id,business_id,event,title,body,href)
    values(p_item.author_id,null,null,'account','Text recenze potřebuje upravit',
      'Hvězdičky zůstaly uložené. Text uprav bez nevhodného nebo osobního obsahu.','/rezervace');
  else
    insert into public.notifications(user_id,booking_id,business_id,event,title,body,href)
    select m.user_id,null,p_item.business_id,'account','Obsah potřebuje upravit',
      case when p_item.entity_type='service' then 'Služba nebyla zveřejněna. Upravte text nebo fotografii a odešlete ji znovu.'
        else 'Úprava provozovny nebyla zveřejněna. Upravte text nebo fotografii a odešlete ji znovu.' end,
      '/partner/provozovna'
    from public.business_members m where m.business_id=p_item.business_id;
  end if;
end $$;

create function public.admin_resolve_content_moderation(p_id uuid,p_decision text,p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare item private.content_moderation; before_state jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('approve','reject') or length(coalesce(p_note,''))>500 then raise exception 'VALIDATION_ERROR'; end if;
  select * into item from private.content_moderation where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if item.status not in ('manual_review','failed') then raise exception 'ALREADY_RESOLVED'; end if;
  before_state:=jsonb_build_object('status',item.status,'last_error',item.last_error);
  if p_decision='approve' then
    update private.content_moderation set status='pending',provider_result=coalesce(provider_result,'{}')||'{"admin_override":true}'::jsonb,
      available_at=now(),lease=null,lease_until=null,resolved_by=auth.uid(),resolved_at=null,updated_at=now() where id=p_id;
    perform private.kick_content_moderation();
  else
    update private.content_moderation set status='rejected',resolved_by=auth.uid(),resolved_at=now(),updated_at=now() where id=p_id;
    if item.entity_type='service' then
      update public.services set content_status='rejected',pending_moderation_id=null where id=item.entity_id and pending_moderation_id=item.id;
    elsif item.entity_type='business' then
      update public.businesses set content_status='rejected',pending_moderation_id=null where id=item.entity_id and pending_moderation_id=item.id;
    else
      update public.bookings set review_status='rejected',review_moderation_id=null,review_moderated_at=now()
      where id=item.entity_id and review_moderation_id=item.id;
    end if;
    perform private.moderation_rejection_notice(item);
  end if;
  perform private.audit('content_moderation_'||p_decision,'content_moderation',p_id,before_state,
    jsonb_build_object('status',case when p_decision='approve' then 'pending_apply' else 'rejected' end),p_note);
end $$;

revoke all on function public.admin_content_moderation(text),
  public.admin_resolve_content_moderation(uuid,text,text) from public,anon;
grant execute on function public.admin_content_moderation(text),
  public.admin_resolve_content_moderation(uuid,text,text) to authenticated,service_role;

-- --------------------------------------------------------------------- WhatsApp readiness

insert into private.settings(key,value) values('whatsapp_enabled','false') on conflict(key) do nothing;

create or replace function public.whatsapp_settings(p_business_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c private.whatsapp_contacts; flek_number text:=private.setting('whatsapp_display_number');
  enabled boolean:=coalesce(private.setting('whatsapp_enabled')::boolean,false);
begin
  perform private.whatsapp_owner(p_business_id);
  select * into c from private.whatsapp_contacts where case when p_business_id is null then kind='customer' and user_id=auth.uid()
    else kind='business' and business_id=p_business_id end;
  return jsonb_build_object('available',enabled and flek_number is not null,'kind',case when p_business_id is null then 'customer' else 'business' end,
    'status',case when c.id is null then 'off' when c.status='pending' and (c.pairing_expires_at is null or c.pairing_expires_at<=now()) then 'expired' else c.status end,
    'phone',coalesce(c.phone_e164,private.whatsapp_default_phone(p_business_id,auth.uid())),
    'pairing_expires_at',case when c.status='pending' then c.pairing_expires_at end,'verified_at',c.verified_at,
    'mine',coalesce(c.consent_by=auth.uid(),false),'flek_number',case when enabled then flek_number end,
    'consent_version',private.whatsapp_consent_version(),'server_now',now());
end $$;

create function public.admin_set_whatsapp_enabled(p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare old_value text:=private.setting('whatsapp_enabled');
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_enabled and private.setting('whatsapp_display_number') is null then raise exception 'WHATSAPP_NOT_READY'; end if;
  insert into private.settings(key,value,updated_at) values('whatsapp_enabled',p_enabled::text,now())
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
  perform private.audit('whatsapp_availability_changed','settings',gen_random_uuid(),
    jsonb_build_object('enabled',coalesce(old_value::boolean,false)),jsonb_build_object('enabled',p_enabled),null);
end $$;
revoke all on function public.admin_set_whatsapp_enabled(boolean) from public,anon;
grant execute on function public.admin_set_whatsapp_enabled(boolean) to authenticated,service_role;
