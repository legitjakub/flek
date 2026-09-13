create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.business_status as enum ('pending','approved','rejected','suspended');
create type public.member_role as enum ('owner','manager');
create type public.offer_status as enum ('draft','published','cancelled');
create type public.booking_status as enum ('confirmed','cancelled_by_customer','cancelled_by_merchant','completed','no_show');

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 first_name text not null default '', last_name text not null default '', phone text,
 avatar_url text, no_show_count integer not null default 0 check(no_show_count>=0),
 booking_blocked boolean not null default false, no_show_override_until timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_roles (
 user_id uuid references auth.users(id) on delete cascade, role text not null check(role='admin'), primary key(user_id,role)
);
create table public.categories (slug text primary key, label_cs text not null, icon text not null, sort_order integer not null);
create table public.businesses (
 id uuid primary key default gen_random_uuid(), display_name text not null check(length(display_name) between 2 and 120),
 legal_name text, slug text not null unique, description text not null default '', category_slug text not null references public.categories,
 phone text not null, public_email text not null, website text,
 address_line text not null, city text not null, district text not null default '', postal_code text not null, country text not null default 'CZ',
 location extensions.geography(Point,4326) not null, logo_url text, cover_url text,
 status public.business_status not null default 'pending', status_reason text,
 commission_rate numeric(5,4) not null default 0.15 check(commission_rate between 0 and 1),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.business_members (
 business_id uuid references public.businesses on delete restrict, user_id uuid references auth.users on delete restrict,
 role public.member_role not null default 'owner', primary key(business_id,user_id)
);
create table public.services (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses on delete restrict,
 name text not null check(length(name) between 2 and 120), description text not null default '',
 category_slug text not null references public.categories, duration_minutes integer not null check(duration_minutes between 5 and 480),
 normal_price_cents integer not null check(normal_price_cents>0 and normal_price_cents%100=0),
 image_url text, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,business_id)
);
create table public.offers (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses on delete restrict,
 service_id uuid not null, start_at timestamptz not null, end_at timestamptz not null,
 original_price_cents integer not null, deal_price_cents integer not null,
 capacity_total integer not null, capacity_remaining integer not null, booking_cutoff_at timestamptz not null,
 status public.offer_status not null default 'published', cancelled_at timestamptz, cancellation_reason text,
 published_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(service_id,business_id) references public.services(id,business_id) on delete restrict,
 unique(id,business_id), check(end_at>start_at),
 check(original_price_cents>0 and deal_price_cents>0 and original_price_cents%100=0 and deal_price_cents%100=0),
 check(deal_price_cents::bigint*100<=original_price_cents::bigint*90),
 check(deal_price_cents::bigint*100>=original_price_cents::bigint*15),
 check(capacity_total between 1 and 50), check(capacity_remaining between 0 and capacity_total),
 check(booking_cutoff_at<=start_at)
);
create table public.bookings (
 id uuid primary key default gen_random_uuid(), offer_id uuid not null, business_id uuid not null,
 customer_id uuid not null references auth.users on delete restrict, reservation_code text not null unique,
 price_cents integer not null check(price_cents>0 and price_cents%100=0),
 service_name_snapshot text not null, business_name_snapshot text not null, business_address_snapshot text not null,
 start_at_snapshot timestamptz not null, end_at_snapshot timestamptz not null, original_price_cents_snapshot integer not null,
 status public.booking_status not null default 'confirmed', created_at timestamptz not null default now(),
 cancelled_at timestamptz, resolved_at timestamptz, cancellation_reason text,
 foreign key(offer_id,business_id) references public.offers(id,business_id) on delete restrict
);
create unique index bookings_one_active_per_customer_offer on public.bookings(offer_id,customer_id) where status='confirmed';
create table public.analytics_events (
 id uuid primary key default gen_random_uuid(), occurred_at timestamptz not null default now(), user_id uuid references auth.users on delete set null,
 session_id text not null check(length(session_id) between 1 and 100), name text not null check(length(name)<=80), props jsonb not null default '{}'
);
create index offers_published_start on public.offers(status,start_at) where status='published';
create index offers_business_start on public.offers(business_id,start_at desc);
create index offers_service on public.offers(service_id);
create index businesses_location on public.businesses using gist(location);
create index businesses_status on public.businesses(status);
create index bookings_customer_start on public.bookings(customer_id,start_at_snapshot desc);
create index bookings_business_start on public.bookings(business_id,start_at_snapshot);
create index bookings_offer on public.bookings(offer_id);
create index business_members_user on public.business_members(user_id);
create index analytics_events_name_time on public.analytics_events(name,occurred_at desc);

create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.user_roles where user_id=auth.uid() and role='admin');
$$;
create function public.is_member_of(p_business_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.business_members where user_id=auth.uid() and business_id=p_business_id);
$$;
create function public.my_business_ids() returns setof uuid language sql stable security definer set search_path=public as $$
 select business_id from public.business_members where user_id=auth.uid();
$$;
create function public.offer_is_bookable(p_status public.offer_status,p_capacity_remaining integer,p_booking_cutoff_at timestamptz,p_start_at timestamptz)
 returns boolean language sql stable set search_path=public as $$
 select p_status='published' and p_capacity_remaining>0 and now()<p_booking_cutoff_at and now()<p_start_at;
$$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,first_name,last_name) values(new.id,left(coalesce(new.raw_user_meta_data->>'first_name',''),80),left(coalesce(new.raw_user_meta_data->>'last_name',''),80));
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.categories enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.services enable row level security;
alter table public.offers enable row level security;
alter table public.bookings enable row level security;
alter table public.analytics_events enable row level security;

create policy profiles_read on public.profiles for select using(id=auth.uid() or public.is_admin());
create policy roles_admin_read on public.user_roles for select using(public.is_admin());
create policy categories_read on public.categories for select using(true);
create policy business_read on public.businesses for select using(status='approved' or public.is_member_of(id) or public.is_admin());
create policy members_read on public.business_members for select using(user_id=auth.uid() or public.is_admin());
create policy service_read on public.services for select using(public.is_member_of(business_id) or public.is_admin() or (is_active and exists(select 1 from public.businesses b where b.id=business_id and b.status='approved')));
create policy offers_read on public.offers for select using(public.is_member_of(business_id) or public.is_admin() or (status='published' and exists(select 1 from public.businesses b where b.id=business_id and b.status='approved')));
create policy bookings_read on public.bookings for select using(customer_id=auth.uid() or public.is_member_of(business_id) or public.is_admin());
create policy analytics_read on public.analytics_events for select using(public.is_admin());
create policy analytics_insert on public.analytics_events for insert with check(
 (user_id is null or user_id=auth.uid()) and name in ('search_performed','offer_viewed','booking_started','booking_failed') and octet_length(props::text)<=4096
);
revoke all on public.profiles,public.user_roles,public.categories,public.businesses,public.business_members,public.services,public.offers,public.bookings,public.analytics_events from anon,authenticated;
grant select on public.categories,public.businesses,public.services,public.offers to anon,authenticated;
grant select on public.profiles,public.user_roles,public.business_members,public.bookings,public.analytics_events to authenticated;
grant insert(session_id,name,props,user_id) on public.analytics_events to anon,authenticated;
grant all on all tables in schema public to service_role;
revoke execute on function public.handle_new_user() from public,anon,authenticated;
