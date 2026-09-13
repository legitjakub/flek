/*
 * The growth loop: follow reliably, prove the value FLEK created, and record who actually
 * brought whom. Additive only — nothing here changes an existing invariant. Availability
 * stays offer_is_bookable(), money stays integer cents, capacity stays server-authoritative.
 */

-- ---------------------------------------------------------------- idempotent following

/*
 * toggle_favorite() is right for a button press and wrong for replaying an intent after
 * authentication: a replay that runs twice reverses the very state it was meant to reach.
 * This states the desired value instead of flipping the current one, so replaying it any
 * number of times lands on the same result. toggle_favorite stays for the plain button.
 */
create function public.set_favorite(p_business_id uuid, p_value boolean) returns boolean
language plpgsql security definer set search_path=public as $$
declare u uuid := auth.uid();
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_value is null then raise exception 'VALIDATION_ERROR'; end if;
 -- Following an unapproved or deleted venue would promise notifications that cannot come.
 if not exists(select 1 from public.businesses b where b.id=p_business_id and b.status='approved') then
  raise exception 'NOT_FOUND';
 end if;
 if p_value then
  -- seen_at defaults to now(), so a place you have just started following does not
  -- immediately claim that everything already published there is new.
  insert into public.favorites(user_id,business_id) values(u,p_business_id)
  on conflict (user_id,business_id) do nothing;
 else
  delete from public.favorites where user_id=u and business_id=p_business_id;
 end if;
 return p_value;
end $$;

-- ------------------------------------------------------------------ customer value

/*
 * What FLEK has actually saved this person. Every number comes from booking snapshots, not
 * from today's service price: the point is what the deal was worth on the day it was taken.
 * Only 'completed' counts — a cancelled or missed appointment created no value, and saying
 * otherwise would be the kind of inflated number that destroys trust in the rest.
 */
create function public.my_customer_metrics() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
 u uuid := auth.uid();
 month_start timestamptz := date_trunc('month', now() at time zone 'Europe/Prague') at time zone 'Europe/Prague';
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 return (
  select jsonb_build_object(
   'month_completed', count(*) filter (where resolved_at >= month_start),
   'month_saved_cents', coalesce(sum(saved) filter (where resolved_at >= month_start), 0),
   'all_time_completed', count(*),
   'all_time_saved_cents', coalesce(sum(saved), 0),
   -- Null, not zero: "no best catch yet" and "best catch was 0 %" are different facts.
   'best_discount_pct', max(discount_pct)
  )
  from (
   select k.resolved_at,
    k.original_price_cents_snapshot - k.price_cents as saved,
    case when k.original_price_cents_snapshot > 0
     then round((k.original_price_cents_snapshot - k.price_cents) * 100.0 / k.original_price_cents_snapshot)::integer
    end as discount_pct
   from public.bookings k
   where k.customer_id = u and k.status = 'completed'
  ) t
 );
end $$;

-- ---------------------------------------------------------------------- referrals

/*
 * A code, not a user id. The link is public by nature, so it must not carry anything that
 * identifies its owner or that could be enumerated into a user list.
 */
create table public.referral_codes (
 user_id uuid primary key references auth.users on delete cascade,
 code text not null unique,
 created_at timestamptz not null default now()
);
alter table public.referral_codes enable row level security;
revoke all on public.referral_codes from anon,authenticated;
grant all on public.referral_codes to service_role;

/*
 * One row per referred account, and the primary key is what enforces the rule that matters:
 * a person can be referred once, by one person, for ever. Doing this with a constraint
 * rather than a check in application code means a race cannot produce two referrers.
 */
create table public.referrals (
 referred_user_id uuid primary key references auth.users on delete cascade,
 referrer_user_id uuid not null references auth.users on delete cascade,
 created_at timestamptz not null default now(),
 -- Set exactly once, when the referred customer's first FLEK is actually completed.
 qualified_at timestamptz,
 qualifying_booking_id uuid references public.bookings on delete set null,
 constraint referrals_no_self check (referred_user_id <> referrer_user_id)
);
create index referrals_referrer on public.referrals(referrer_user_id);
-- One qualification per referral, and only ever against one booking.
create unique index referrals_qualifying_booking on public.referrals(qualifying_booking_id)
 where qualifying_booking_id is not null;
alter table public.referrals enable row level security;
revoke all on public.referrals from anon,authenticated;
grant all on public.referrals to service_role;

/** Stable for the life of the account: the code is created once and then only read. */
create function public.my_referral_code() returns text
language plpgsql security definer set search_path=public as $$
declare u uuid := auth.uid(); c text; tries integer := 0;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select code into c from public.referral_codes where user_id=u;
 if c is not null then return c; end if;
 loop
  tries := tries + 1;
  -- The same unambiguous alphabet the reservation codes use: no O/0, no I/1.
  c := public.generate_reservation_code(6);
  begin
   insert into public.referral_codes(user_id,code) values(u,c);
   return c;
  exception when unique_violation then
   -- Either this user raced with themselves (re-read) or the code collided (retry).
   select code into c from public.referral_codes where user_id=u;
   if c is not null then return c; end if;
   if tries >= 5 then raise; end if;
  end;
 end loop;
end $$;

/*
 * The landing page needs to say who invited you without exposing who that is. A first name
 * is enough to make the invitation feel real; nothing else leaves the server.
 */
create function public.resolve_referral_code(p_code text) returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce(
  (select jsonb_build_object('valid',true,'first_name',nullif(p.first_name,''))
   from public.referral_codes rc join public.profiles p on p.id=rc.user_id
   where rc.code=upper(trim(p_code))),
  jsonb_build_object('valid',false,'first_name',null));
$$;

/*
 * Attribution, claimed by the referred user's own session so the browser never gets to
 * assert who referred whom. Idempotent: claiming twice is a no-op that reports the same
 * answer, which is what makes it safe to replay after e-mail confirmation.
 */
create function public.claim_referral(p_code text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 u uuid := auth.uid();
 referrer uuid;
 already uuid;
 account_created timestamptz;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;

 select referred_user_id into already from public.referrals where referred_user_id=u;
 if already is not null then return jsonb_build_object('claimed',false,'reason','already_referred'); end if;

 select rc.user_id into referrer from public.referral_codes rc where rc.code=upper(trim(p_code));
 if referrer is null then return jsonb_build_object('claimed',false,'reason','unknown_code'); end if;
 if referrer = u then return jsonb_build_object('claimed',false,'reason','self'); end if;

 /*
  * An established account must not become a "new referred user" by opening a link. Two
  * independent facts have to hold: the account is genuinely new, and it has never booked.
  * Either alone is gameable — a dormant old account, or a fresh account that already used
  * the product through another path.
  */
 select created_at into account_created from public.profiles where id=u;
 if account_created is null or account_created < now() - interval '30 days' then
  return jsonb_build_object('claimed',false,'reason','not_a_new_account');
 end if;
 if exists(select 1 from public.bookings where customer_id=u) then
  return jsonb_build_object('claimed',false,'reason','not_a_new_account');
 end if;

 begin
  insert into public.referrals(referred_user_id,referrer_user_id) values(u,referrer);
 exception when unique_violation then
  -- Someone else's concurrent claim won; the first referrer stands.
  return jsonb_build_object('claimed',false,'reason','already_referred');
 end;
 return jsonb_build_object('claimed',true,'reason',null);
end $$;

/*
 * Qualification happens where a booking truly becomes completed, never on a client event.
 * Idempotent by construction: it only writes into a row whose qualified_at is still null,
 * and the partial unique index makes a second booking unable to claim the same referral.
 */
create function private.qualify_referral(p_booking_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare k public.bookings;
begin
 select * into k from public.bookings where id=p_booking_id;
 if k.id is null or k.status <> 'completed' then return; end if;
 update public.referrals
  set qualified_at = now(), qualifying_booking_id = k.id
  where referred_user_id = k.customer_id and qualified_at is null;
exception when others then
 -- Attribution is a growth measurement. It must never be able to fail a merchant's
 -- resolution of a real appointment.
 null;
end $$;

/** What the inviter can honestly be told: how many came, and how many actually showed up. */
create function public.my_referral_stats() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare u uuid := auth.uid();
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 return (select jsonb_build_object(
  'invited', count(*),
  'qualified', count(*) filter (where qualified_at is not null))
 from public.referrals where referrer_user_id=u);
end $$;

-- ------------------------------------------------- hook qualification into completion

/*
 * Unchanged from 202609070002 except for the final line. Replaced wholesale rather than
 * patched, because this function owns the no-show counter and the capacity contract.
 */
create or replace function public.merchant_resolve_booking(p_booking_id uuid,p_outcome text) returns void
language plpgsql security definer set search_path=public as $$
declare k public.bookings;
begin
 select * into k from public.bookings where id=p_booking_id;
 if k.id is null or not public.is_member_of(k.business_id) then raise exception 'FORBIDDEN'; end if;
 if p_outcome not in ('completed','no_show') then raise exception 'VALIDATION_ERROR'; end if;
 perform 1 from public.profiles where id=k.customer_id for update;
 perform 1 from public.businesses where id=k.business_id for share;
 perform 1 from public.offers where id=k.offer_id for update;
 select * into k from public.bookings where id=p_booking_id for update;
 if now()<k.start_at_snapshot then raise exception 'TOO_EARLY'; end if;
 if k.status<>'confirmed' then raise exception 'ALREADY_RESOLVED'; end if;
 update public.bookings set status=p_outcome::public.booking_status,resolved_at=now() where id=k.id;
 if p_outcome='no_show' then update public.profiles set no_show_count=no_show_count+1,updated_at=now() where id=k.customer_id; end if;
 perform private.emit(case when p_outcome='completed' then 'booking_completed' else 'booking_no_show' end,jsonb_build_object('booking_id',k.id,'business_id',k.business_id));
 if p_outcome='completed' then perform private.qualify_referral(k.id); end if;
end $$;

-- --------------------------------------------------------- followers for the merchant

/*
 * Unchanged from 202609070006 except for the added 'followers'. A merchant who can see the
 * audience they are building has a reason to keep publishing; it is a real count from the
 * favorites table, and the dashboard must not turn it into a claim about notifications.
 */
create or replace function public.merchant_metrics(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare month_start timestamptz:=date_trunc('month',now() at time zone 'Europe/Prague') at time zone 'Europe/Prague';
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 return (select jsonb_build_object(
  'published_offers',(select count(*) from public.offers where business_id=p_business_id and published_at>=month_start),
  'published_capacity',(select coalesce(sum(capacity_total),0) from public.offers where business_id=p_business_id and status<>'draft' and published_at>=month_start),
  'booked_capacity',(select count(*) from public.bookings where business_id=p_business_id and status in ('confirmed','completed','no_show') and created_at>=month_start),
  'completed',(select count(*) from public.bookings where business_id=p_business_id and status='completed' and resolved_at>=month_start),
  'no_shows',(select count(*) from public.bookings where business_id=p_business_id and status='no_show' and resolved_at>=month_start),
  'cancelled',(select count(*) from public.bookings where business_id=p_business_id and status in ('cancelled_by_customer','cancelled_by_merchant') and cancelled_at>=month_start),
  'unresolved',(select count(*) from public.bookings where business_id=p_business_id and status='confirmed' and start_at_snapshot<now()-interval '24 hours'),
  'recovered_cents',(select coalesce(sum(price_cents),0) from public.bookings where business_id=p_business_id and status='completed' and start_at_snapshot>=month_start),
  'active_offers',(select count(*) from public.merchant_offer_rows where business_id=p_business_id and bookable),
  'today_bookings',(select count(*) from public.bookings where business_id=p_business_id and status='confirmed' and start_at_snapshot>=date_trunc('day',now() at time zone 'Europe/Prague') at time zone 'Europe/Prague' and start_at_snapshot<(date_trunc('day',now() at time zone 'Europe/Prague')+interval '1 day') at time zone 'Europe/Prague'),
  'followers',(select count(*) from public.favorites where business_id=p_business_id),
  'free_seats',(select coalesce(sum(capacity_remaining),0) from public.merchant_offer_rows where business_id=p_business_id and bookable)));
end $$;

-- ------------------------------------------------------------------- analytics events

/** The allowlist is the whole point of this function; new events must be added to it. */
create or replace function public.record_event(p_name text,p_session_id text,p_props jsonb default '{}') returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_name not in ('search_performed','offer_viewed','booking_started','booking_failed',
                   'favorite_added','favorite_removed','offer_shared',
                   'unavailable_recovery_clicked','similar_offers_clicked',
                   'referral_link_opened') then return; end if;
 insert into public.analytics_events(name,session_id,user_id,props) values(p_name,left(p_session_id,100),auth.uid(),p_props);
exception when others then null;
end $$;

-- ------------------------------------------------------------------------ privileges

revoke execute on function
 public.set_favorite(uuid,boolean),
 public.my_customer_metrics(),
 public.my_referral_code(),
 public.claim_referral(text),
 public.my_referral_stats(),
 private.qualify_referral(uuid)
from public,anon,authenticated;

grant execute on function
 public.set_favorite(uuid,boolean),
 public.my_customer_metrics(),
 public.my_referral_code(),
 public.claim_referral(text),
 public.my_referral_stats()
to authenticated,service_role;

-- The landing page has to work before anyone signs in, so this one is deliberately public.
revoke execute on function public.resolve_referral_code(text) from public;
grant execute on function public.resolve_referral_code(text) to anon,authenticated,service_role;

grant execute on function private.qualify_referral(uuid) to service_role;
