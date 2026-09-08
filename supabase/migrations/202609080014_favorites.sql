-- Favourite venues, and the one thing a favourite is actually for: knowing when that place
-- opens something new. There is no push or e-mail in V1, so "notification" means the app
-- tells you on arrival — honestly, from data, without a background job.
create table public.favorites (
 user_id uuid not null references auth.users on delete cascade,
 business_id uuid not null references public.businesses on delete cascade,
 created_at timestamptz not null default now(),
 -- Moves forward when the customer looks at the list; everything published after it is new.
 seen_at timestamptz not null default now(),
 primary key(user_id,business_id)
);
create index favorites_user on public.favorites(user_id);

alter table public.favorites enable row level security;
create policy favorites_own on public.favorites for select using(user_id=auth.uid() or public.is_admin());
revoke all on public.favorites from anon,authenticated;
grant select on public.favorites to authenticated;
grant all on public.favorites to service_role;

create function public.toggle_favorite(p_business_id uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); existing boolean;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if not exists(select 1 from public.businesses b where b.id=p_business_id and b.status='approved') then
  raise exception 'NOT_FOUND';
 end if;
 select true into existing from public.favorites where user_id=u and business_id=p_business_id;
 if existing then
  delete from public.favorites where user_id=u and business_id=p_business_id;
  return false;
 end if;
 insert into public.favorites(user_id,business_id) values(u,p_business_id);
 return true;
end $$;

/*
 * What is new at the places you follow. "New" is derived: an offer published after the
 * moment you last looked, still bookable. No stored notification, nothing to go stale.
 */
create view public.favorite_offer_rows with(security_invoker=true) as
 select f.user_id, d.*, f.seen_at, d.published_at>f.seen_at is_new
 from public.favorites f
 join public.offer_details d on d.business_id=f.business_id
 where d.bookable;

create function public.my_favorites() returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(x order by x->>'display_name'),'[]') from (
  select to_jsonb(b)||jsonb_build_object(
   'latitude',extensions.st_y(b.location::extensions.geometry),
   'longitude',extensions.st_x(b.location::extensions.geometry),
   'favorited_at',f.created_at,
   'seen_at',f.seen_at,
   'rating_avg',(select round(avg(r.rating),1) from public.bookings r where r.business_id=b.id and r.rating is not null),
   'rating_count',(select count(*) from public.bookings r where r.business_id=b.id and r.rating is not null),
   'open_offers',(select count(*) from public.offer_details d where d.business_id=b.id and d.bookable),
   'new_offers',(select count(*) from public.offer_details d where d.business_id=b.id and d.bookable and d.published_at>f.seen_at)
  ) x
  from public.favorites f join public.businesses b on b.id=f.business_id
  where f.user_id=auth.uid()
 ) t;
$$;

/** Offers published at followed venues since the customer last looked. */
create function public.new_at_favorites(p_limit integer default 20) returns setof public.favorite_offer_rows
language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
 return query select * from public.favorite_offer_rows
  where user_id=auth.uid() and is_new
  order by published_at desc limit p_limit;
end $$;

/** Called when the list has actually been shown, so the badge clears honestly. */
create function public.mark_favorites_seen() returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 update public.favorites set seen_at=now() where user_id=auth.uid();
end $$;

/** One number for the bottom-nav badge. */
create function public.new_at_favorites_count() returns integer language sql stable security definer set search_path=public as $$
 select coalesce(count(*),0)::integer from public.favorite_offer_rows where user_id=auth.uid() and is_new;
$$;

revoke all on public.favorite_offer_rows from anon,authenticated;
revoke execute on function public.toggle_favorite(uuid),public.my_favorites(),public.new_at_favorites(integer),public.mark_favorites_seen(),public.new_at_favorites_count() from public,anon,authenticated;
grant execute on function public.toggle_favorite(uuid),public.my_favorites(),public.new_at_favorites(integer),public.mark_favorites_seen(),public.new_at_favorites_count() to authenticated,service_role;
grant all on public.favorite_offer_rows to service_role;
