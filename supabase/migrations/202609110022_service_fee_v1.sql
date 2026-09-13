/*
 * FLEK pricing v1: the merchant names what they want to receive, FLEK adds a service fee on
 * top, and the customer sees the final all-in price from the first screen to the receipt.
 *
 *   merchant_price  what the merchant entered and is paid           (whole crowns)
 *   service_fee     clamp(round_half_up(merchant × 5 %), 25, 149) Kč (whole crowns)
 *   customer_price  merchant_price + service_fee
 *
 * `offers.deal_price_cents` keeps its column and becomes the customer price. Every customer
 * surface, the payment amount and the discount percentage already read that column, so they
 * become all-in without a single change; only the merchant side learns the new split. A
 * parallel `customer_price` column would have left some screen, some day, reading the wrong one.
 *
 * Everything that existed before this migration is policy 0: no fee, the merchant receives
 * the full price. No live offer changes the price a customer has already seen.
 *
 * Also closes three holes the audit for this change found:
 *  - a payment that was paid but whose booking then failed stayed "paid" for ever (282 rows);
 *  - retrying create_booking after a lost response answered ALREADY_BOOKED instead of the code;
 *  - suspending or rejecting a venue cancelled its bookings without refunding the customers.
 */

-- ------------------------------------------------------------------------ fee policy

/*
 * The single server-side definition. The browser mirrors it in src/lib/pricing.ts for the
 * live preview only; tests/fixtures/fee-vector.json is checked against both, so the two
 * cannot drift apart silently. The server's number is the one that is charged.
 */
create or replace function private.flek_service_fee_cents(p_merchant_cents integer, p_policy smallint default 1)
returns integer language sql immutable set search_path=public as $$
 select case
  when p_merchant_cents is null or p_merchant_cents <= 0 or p_merchant_cents % 100 <> 0 then null
  when p_policy = 0 then 0
  -- Integer crowns throughout: (crowns × 5 + 50) div 100 is 5 % rounded half up.
  when p_policy = 1 then least(14900, greatest(2500, ((p_merchant_cents / 100 * 5 + 50) / 100) * 100))
 end
$$;

create or replace function private.flek_current_fee_policy() returns smallint
language sql immutable as $$ select 1::smallint $$;

/** Read-only quote: the parity tests call it, and anyone may — it is arithmetic. */
create or replace function public.flek_price_quote(p_merchant_cents integer, p_regular_cents integer default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fee integer := private.flek_service_fee_cents(p_merchant_cents, private.flek_current_fee_policy());
begin
 if fee is null then raise exception 'VALIDATION_ERROR'; end if;
 return jsonb_build_object(
  'fee_policy_version', private.flek_current_fee_policy(),
  'merchant_price_cents', p_merchant_cents,
  'service_fee_cents', fee,
  'customer_price_cents', p_merchant_cents + fee,
  'discount_pct', case when p_regular_cents > 0
    then floor((p_regular_cents - p_merchant_cents - fee)::numeric * 100 / p_regular_cents)::integer end);
end $$;
grant execute on function public.flek_price_quote(integer,integer) to anon,authenticated,service_role;
revoke execute on function private.flek_service_fee_cents(integer,smallint) from public,anon,authenticated;

-- ---------------------------------------------------------------- financial columns

alter table public.offers
 add column merchant_price_cents integer,
 add column service_fee_cents integer not null default 0,
 add column fee_policy_version smallint not null default 0;
update public.offers set merchant_price_cents = deal_price_cents where merchant_price_cents is null;
alter table public.offers alter column merchant_price_cents set not null;
alter table public.offers add constraint offers_price_composition check (
 merchant_price_cents > 0 and merchant_price_cents % 100 = 0
 and service_fee_cents >= 0 and service_fee_cents % 100 = 0
 and deal_price_cents = merchant_price_cents + service_fee_cents);
comment on column public.offers.deal_price_cents is
 'Customer price: the final all-in amount shown to and paid by the customer (merchant_price_cents + service_fee_cents).';
comment on column public.offers.merchant_price_cents is 'What the merchant receives for this slot.';

alter table public.bookings
 add column merchant_payout_cents integer,
 add column service_fee_cents integer not null default 0,
 add column fee_policy_version smallint not null default 0;
update public.bookings set merchant_payout_cents = price_cents where merchant_payout_cents is null;
alter table public.bookings alter column merchant_payout_cents set not null;
alter table public.bookings add constraint bookings_price_composition check (
 merchant_payout_cents >= 0 and service_fee_cents >= 0 and price_cents = merchant_payout_cents + service_fee_cents);
comment on column public.bookings.price_cents is 'Customer price paid, snapshot at booking time.';

/*
 * Rows written by paths that predate v1 (seed scripts, service-role tooling) still arrive
 * without the split. They are policy 0 by definition: the merchant receives the whole price.
 */
create or replace function private.offers_legacy_split() returns trigger language plpgsql as $$
begin
 if new.merchant_price_cents is null then new.merchant_price_cents := new.deal_price_cents - new.service_fee_cents; end if;
 return new;
end $$;
create trigger offers_legacy_split before insert on public.offers
 for each row execute function private.offers_legacy_split();

create or replace function private.bookings_legacy_split() returns trigger language plpgsql as $$
begin
 if new.merchant_payout_cents is null then new.merchant_payout_cents := new.price_cents - new.service_fee_cents; end if;
 return new;
end $$;
create trigger bookings_legacy_split before insert on public.bookings
 for each row execute function private.bookings_legacy_split();

/** A booking's money is a record of what was agreed, never a value to recompute later. */
create or replace function private.bookings_financial_immutable() returns trigger language plpgsql as $$
begin
 if new.price_cents is distinct from old.price_cents
  or new.merchant_payout_cents is distinct from old.merchant_payout_cents
  or new.service_fee_cents is distinct from old.service_fee_cents
  or new.fee_policy_version is distinct from old.fee_policy_version
  or new.original_price_cents_snapshot is distinct from old.original_price_cents_snapshot then
  raise exception 'FINANCIAL_SNAPSHOT_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger bookings_financial_immutable before update on public.bookings
 for each row execute function private.bookings_financial_immutable();

alter table public.services
 add column template_slug text check (template_slug is null or template_slug ~ '^[a-z0-9-]{1,80}$'),
 add column default_merchant_price_cents integer
  check (default_merchant_price_cents is null or (default_merchant_price_cents > 0 and default_merchant_price_cents % 100 = 0)),
 add column default_capacity smallint check (default_capacity is null or default_capacity between 1 and 50);

-- ------------------------------------------------------------------------ views
-- Each of these was written as `o.*` / `k.*`, which Postgres expands once, at creation. The
-- new columns are appended explicitly at the end; the existing ones keep name and order, which
-- is what CREATE OR REPLACE VIEW requires.

create or replace view public.offer_details with(security_invoker=true) as
 select o.id,o.business_id,o.service_id,o.start_at,o.end_at,o.original_price_cents,o.deal_price_cents,
 o.capacity_total,o.capacity_remaining,o.booking_cutoff_at,o.status,o.cancelled_at,o.cancellation_reason,
 o.published_at,o.created_at,o.updated_at,
 s.name service_name,s.description,s.category_slug,s.image_url,
 b.display_name business_name,b.slug business_slug,b.description business_description,b.phone business_phone,
 b.address_line,b.city,b.district,b.cover_url,b.logo_url,b.status business_status,
 extensions.st_y(b.location::extensions.geometry) latitude,extensions.st_x(b.location::extensions.geometry) longitude,
 -- Always measured against what the customer pays: the fee is inside deal_price_cents.
 floor((o.original_price_cents-o.deal_price_cents)::numeric*100/o.original_price_cents)::integer discount_pct,
 public.offer_is_bookable(o.status,o.capacity_remaining,o.booking_cutoff_at,o.start_at) and b.status='approved' bookable,
 now() server_now,
 (select round(avg(r.rating),1) from public.bookings r where r.business_id=b.id and r.rating is not null) rating_avg,
 (select count(*) from public.bookings r where r.business_id=b.id and r.rating is not null)::integer rating_count,
 b.cancellation_window_minutes,
 b.google_place_id,
 o.merchant_price_cents,o.service_fee_cents,o.fee_policy_version
 from public.offers o join public.services s on s.id=o.service_id join public.businesses b on b.id=o.business_id;

create or replace view public.merchant_offer_rows with(security_invoker=true) as
 select o.id,o.business_id,o.service_id,o.start_at,o.end_at,o.original_price_cents,o.deal_price_cents,
 o.capacity_total,o.capacity_remaining,o.booking_cutoff_at,o.status,o.cancelled_at,o.cancellation_reason,
 o.published_at,o.created_at,o.updated_at,
 s.name service_name,s.duration_minutes,
 (select count(*) from public.bookings k where k.offer_id=o.id and k.status='confirmed') booked,
 (select count(*) from public.bookings k where k.offer_id=o.id and k.status='completed') completed,
 public.offer_is_bookable(o.status,o.capacity_remaining,o.booking_cutoff_at,o.start_at) bookable,
 now() server_now,
 o.merchant_price_cents,o.service_fee_cents,o.fee_policy_version
 from public.offers o join public.services s on s.id=o.service_id;

create or replace view public.merchant_booking_rows with(security_invoker=true) as
 select k.id,k.offer_id,k.business_id,k.customer_id,k.reservation_code,k.price_cents,k.service_name_snapshot,
 k.business_name_snapshot,k.business_address_snapshot,k.start_at_snapshot,k.end_at_snapshot,
 k.original_price_cents_snapshot,k.status,k.created_at,k.cancelled_at,k.resolved_at,k.cancellation_reason,
 k.rating,k.rated_at,k.payment_id,
 trim(p.first_name||' '||case when p.last_name<>'' then left(p.last_name,1)||'.' else '' end) customer_label,
 -- "Nedorazil" can be marked from the start of the slot until 24 h after its end; after that
 -- the booking completes on its own.
 k.status='confirmed' and now()>=k.start_at_snapshot and now()<k.end_at_snapshot+interval '24 hours' can_resolve,
 k.status='confirmed' and now()>=k.start_at_snapshot+interval '24 hours' unresolved, now() server_now,
 (select pay.status from public.payments pay where pay.id=k.payment_id) payment_status,
 k.merchant_payout_cents,k.service_fee_cents,k.fee_policy_version,
 k.end_at_snapshot+interval '24 hours' resolution_deadline
 from public.bookings k join public.profiles p on p.id=k.customer_id;

-- ------------------------------------------------------------------ publishing

/** Timing and price rules for a v1 offer; returns the fee so the caller never recomputes it. */
create or replace function private.validate_flek(p_start timestamptz, p_cutoff timestamptz, p_merchant integer, p_regular integer)
returns integer language plpgsql set search_path=public as $$
declare fee integer; customer integer;
begin
 if p_start is null or p_start<=now() or p_start>now()+interval '7 days' then raise exception 'INVALID_START'; end if;
 if p_cutoff is null or p_cutoff<now()+interval '5 minutes' or p_cutoff>p_start then raise exception 'INVALID_CUTOFF'; end if;
 fee := private.flek_service_fee_cents(p_merchant, private.flek_current_fee_policy());
 if fee is null then raise exception 'VALIDATION_ERROR'; end if;
 customer := p_merchant + fee;
 if customer >= p_regular then raise exception 'NO_CUSTOMER_SAVING'; end if;
 -- The customer saves at least 10 %, measured on the final price.
 if customer::bigint*100 > p_regular::bigint*90 then raise exception 'SAVING_TOO_SMALL'; end if;
 if customer::bigint*100 < p_regular::bigint*15 then raise exception 'PRICE_TOO_LOW'; end if;
 return fee;
end $$;

create or replace function public.publish_flek(
 p_service_id uuid, p_start_at timestamptz, p_merchant_price_cents integer,
 p_capacity_total integer default 1, p_booking_cutoff_at timestamptz default null, p_confirm_overlap boolean default false)
returns public.offers language plpgsql security definer set search_path=public as $$
declare s public.services; b public.businesses; o public.offers; fee integer; first_offer boolean;
 cutoff timestamptz := coalesce(p_booking_cutoff_at, p_start_at - interval '15 minutes');
begin
 select * into s from public.services where id=p_service_id;
 if s.id is null or not public.is_member_of(s.business_id) then raise exception 'FORBIDDEN'; end if;
 -- Exclusive business lock also makes overlap detection reliable under concurrent publication.
 select * into b from public.businesses where id=s.business_id for update;
 select * into s from public.services where id=p_service_id for update;
 if b.status<>'approved' then raise exception 'BUSINESS_NOT_APPROVED'; end if;
 if not s.is_active then raise exception 'VALIDATION_ERROR'; end if;
 if p_capacity_total is null or p_capacity_total not between 1 and 50 then raise exception 'INVALID_CAPACITY'; end if;
 fee := private.validate_flek(p_start_at, cutoff, p_merchant_price_cents, s.normal_price_cents);
 if not p_confirm_overlap and exists(select 1 from public.offers where business_id=b.id and status='published'
   and start_at<p_start_at+make_interval(mins=>s.duration_minutes) and end_at>p_start_at) then
  raise exception 'OVERLAP_CONFIRMATION_REQUIRED';
 end if;
 first_offer := not exists(select 1 from public.offers where business_id=b.id);
 insert into public.offers(business_id,service_id,start_at,end_at,original_price_cents,deal_price_cents,
   merchant_price_cents,service_fee_cents,fee_policy_version,capacity_total,capacity_remaining,booking_cutoff_at)
 values(b.id,s.id,p_start_at,p_start_at+make_interval(mins=>s.duration_minutes),s.normal_price_cents,
   p_merchant_price_cents+fee,p_merchant_price_cents,fee,private.flek_current_fee_policy(),
   p_capacity_total,p_capacity_total,cutoff)
 returning * into o;
 -- The next slot for this service starts from what the merchant chose this time.
 update public.services set default_merchant_price_cents=p_merchant_price_cents, default_capacity=p_capacity_total where id=s.id;
 perform private.emit('offer_published',jsonb_build_object('offer_id',o.id,'business_id',b.id,'first',first_offer,'fee_policy_version',o.fee_policy_version));
 return o;
end $$;

/*
 * The old entry point took the customer price. A browser still running the previous build
 * would now publish without a fee, so it fails loudly instead of pricing silently wrong.
 */
revoke execute on function public.publish_offer(uuid,timestamptz,integer,integer,timestamptz,boolean) from public,anon,authenticated;
revoke execute on function public.publish_flek(uuid,timestamptz,integer,integer,timestamptz,boolean) from public,anon;
grant execute on function public.publish_flek(uuid,timestamptz,integer,integer,timestamptz,boolean) to authenticated,service_role;

create or replace function public.update_offer(p_offer_id uuid,p_data jsonb,p_confirm_overlap boolean default false) returns public.offers language plpgsql security definer set search_path=public as $$
declare o public.offers; s public.services; cap integer; st timestamptz; cutoff timestamptz; merchant integer; fee integer; policy smallint;
begin
 select * into o from public.offers where id=p_offer_id;
 if o.id is null or not public.is_member_of(o.business_id) then raise exception 'FORBIDDEN'; end if;
 -- A client that still speaks in customer prices must not be able to set one.
 if p_data ? 'deal_price_cents' or p_data ? 'service_fee_cents' then raise exception 'VALIDATION_ERROR'; end if;
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
  merchant:=coalesce((p_data->>'merchant_price_cents')::int,o.merchant_price_cents);
  cutoff:=coalesce((p_data->>'booking_cutoff_at')::timestamptz,case when p_data ? 'start_at' then st-interval '15 minutes' else o.booking_cutoff_at end);
  -- An edit moves a legacy offer onto the current policy only when its price is touched.
  if p_data ? 'merchant_price_cents' or o.fee_policy_version>0 then
   fee:=private.validate_flek(st,cutoff,merchant,s.normal_price_cents); policy:=private.flek_current_fee_policy();
  else
   perform private.validate_offer(st,cutoff,o.deal_price_cents,s.normal_price_cents); fee:=0; policy:=0;
  end if;
  if not p_confirm_overlap and exists(select 1 from public.offers where id<>o.id and business_id=o.business_id and status='published' and start_at<st+make_interval(mins=>s.duration_minutes) and end_at>st) then raise exception 'OVERLAP_CONFIRMATION_REQUIRED'; end if;
  update public.offers set service_id=s.id,start_at=st,end_at=st+make_interval(mins=>s.duration_minutes),
   merchant_price_cents=merchant,service_fee_cents=fee,fee_policy_version=policy,deal_price_cents=merchant+fee,
   original_price_cents=s.normal_price_cents,capacity_total=cap,capacity_remaining=cap,booking_cutoff_at=cutoff,updated_at=now()
  where id=o.id returning * into o;
 end if;
 return o;
end $$;

-- ------------------------------------------------------------------- booking & payment

create or replace function public.create_booking(p_offer_id uuid, p_payment_id uuid) returns table(booking_id uuid,reservation_code text)
language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); p public.profiles; pay public.payments; o public.offers; s public.services; b public.businesses; code text; constraint_name text;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 /*
  * Idempotent retry. The first attempt may have succeeded and only its response been lost;
  * the same payment then answers with the same booking instead of "ALREADY_BOOKED", so the
  * customer reaches their reservation code rather than an error about it.
  */
 select k.id,k.reservation_code into booking_id,reservation_code
  from public.bookings k where k.payment_id=p_payment_id and k.customer_id=u and k.offer_id=p_offer_id;
 if booking_id is not null then return next; return; end if;

 select * into p from public.profiles where id=u for update;
 if p.phone is null or length(regexp_replace(p.phone,'[^0-9]','','g'))<9 then raise exception 'PHONE_REQUIRED'; end if;
 if exists(select 1 from public.bookings x where x.offer_id=p_offer_id and x.customer_id=u and x.status='confirmed') then raise exception 'ALREADY_BOOKED'; end if;
 if p.booking_blocked then raise exception 'BOOKING_BLOCKED'; end if;
 if (select count(*) from public.bookings where customer_id=u and status='confirmed' and start_at_snapshot>now())>=3 then raise exception 'TOO_MANY_ACTIVE'; end if;
 if coalesce(p.no_show_override_until,'-infinity')<now() and (select count(*) from public.bookings where customer_id=u and status='no_show' and start_at_snapshot>now()-interval '60 days')>=2 then raise exception 'BLOCKED_NO_SHOW'; end if;

 select * into pay from public.payments where id=p_payment_id for update;
 if pay.id is null or pay.customer_id<>u or pay.offer_id<>p_offer_id then raise exception 'PAYMENT_REQUIRED'; end if;
 if pay.status<>'paid' then raise exception 'PAYMENT_REQUIRED'; end if;

 select biz.* into b from public.businesses biz join public.offers x on x.business_id=biz.id where x.id=p_offer_id for share of biz;
 if b.id is null or b.status<>'approved' then raise exception 'OFFER_UNAVAILABLE'; end if;
 update public.offers x set capacity_remaining=x.capacity_remaining-1,updated_at=now()
 where x.id=p_offer_id and public.offer_is_bookable(x.status,x.capacity_remaining,x.booking_cutoff_at,x.start_at)
 returning x.* into o;
 if not found then raise exception 'OFFER_UNAVAILABLE'; end if;
 if pay.amount_cents<>o.deal_price_cents then raise exception 'PRICE_CHANGED'; end if;
 select * into s from public.services where id=o.service_id;
 for i in 1..5 loop
  code:='FLEK-'||public.generate_reservation_code(6);
  begin
   insert into public.bookings as bk(offer_id,business_id,customer_id,reservation_code,price_cents,service_name_snapshot,business_name_snapshot,business_address_snapshot,start_at_snapshot,end_at_snapshot,original_price_cents_snapshot,payment_id,cancellation_window_minutes,
     merchant_payout_cents,service_fee_cents,fee_policy_version)
   values(o.id,o.business_id,u,code,o.deal_price_cents,s.name,b.display_name,b.address_line||', '||b.city,o.start_at,o.end_at,o.original_price_cents,pay.id,b.cancellation_window_minutes,
     o.merchant_price_cents,o.service_fee_cents,o.fee_policy_version)
   returning bk.id,bk.reservation_code into booking_id,reservation_code;
   perform private.emit('booking_created',jsonb_build_object('booking_id',booking_id,'offer_id',o.id,'business_id',b.id));
   return next; return;
  exception when unique_violation then
   get stacked diagnostics constraint_name=CONSTRAINT_NAME;
   if constraint_name='bookings_one_active_per_customer_offer' then raise exception 'ALREADY_BOOKED'; end if;
   if constraint_name='bookings_one_per_payment' then raise exception 'PAYMENT_ALREADY_USED'; end if;
   if constraint_name<>'bookings_reservation_code_key' then raise; end if;
  end;
 end loop;
 raise exception 'CODE_GENERATION_FAILED';
end $$;

/*
 * The customer paid, then the booking failed — the last seat went to someone else, the price
 * moved. The payment is returned at once instead of sitting "paid" with nothing behind it.
 * Serialised with create_booking through the payment row lock, so a booking that did land in
 * the meantime is never refunded under the customer's feet.
 */
create or replace function public.release_unbooked_payment(p_payment_id uuid) returns public.payments
language plpgsql security definer set search_path=public as $$
declare pay public.payments;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into pay from public.payments where id=p_payment_id and customer_id=auth.uid() for update;
 if pay.id is null then raise exception 'FORBIDDEN'; end if;
 if exists(select 1 from public.bookings where payment_id=pay.id) then return pay; end if;
 if pay.status='paid' then
  update public.payments set status='refunded',refunded_at=now() where id=pay.id returning * into pay;
  perform private.emit('payment_released',jsonb_build_object('payment_id',pay.id,'offer_id',pay.offer_id,'reason','booking_failed'));
 end if;
 return pay;
end $$;
revoke execute on function public.release_unbooked_payment(uuid) from public,anon;
grant execute on function public.release_unbooked_payment(uuid) to authenticated,service_role;

-- --------------------------------------------------------------- attendance

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
 -- Past this point the booking completes on its own; the window is stated in the UI.
 if now()>=k.end_at_snapshot+interval '24 hours' then raise exception 'RESOLUTION_WINDOW_CLOSED'; end if;
 update public.bookings set status=p_outcome::public.booking_status,resolved_at=now() where id=k.id;
 if p_outcome='no_show' then update public.profiles set no_show_count=no_show_count+1,updated_at=now() where id=k.customer_id; end if;
 perform private.emit(case when p_outcome='completed' then 'booking_completed' else 'booking_no_show' end,jsonb_build_object('booking_id',k.id,'business_id',k.business_id));
 if p_outcome='completed' then perform private.qualify_referral(k.id); end if;
end $$;

/*
 * Scheduled, never triggered by a read. Two jobs:
 *  1. A booking nobody marked "Nedorazil" within 24 h of its end is completed — the happy
 *     path asks nothing of the merchant. It does everything a manual "Dorazil" does,
 *     including qualifying a referral.
 *  2. A payment that is paid but has had no booking for 30 minutes is refunded. The client
 *     already releases it on a failed booking; this catches the one that crashed first.
 */
create or replace function private.flek_maintenance() returns jsonb
language plpgsql security definer set search_path=public as $$
declare k record; completed_count integer := 0; released_count integer := 0;
begin
 for k in select id,business_id from public.bookings
   where status='confirmed' and end_at_snapshot < now()-interval '24 hours'
   order by end_at_snapshot for update skip locked loop
  update public.bookings set status='completed',resolved_at=now() where id=k.id and status='confirmed';
  if found then
   completed_count := completed_count+1;
   perform private.emit('booking_completed',jsonb_build_object('booking_id',k.id,'business_id',k.business_id,'automatic',true));
   perform private.qualify_referral(k.id);
  end if;
 end loop;

 with released as (
  update public.payments pay set status='refunded',refunded_at=now()
  where pay.status='paid' and coalesce(pay.paid_at,pay.created_at) < now()-interval '30 minutes'
   and not exists(select 1 from public.bookings b where b.payment_id=pay.id)
  returning pay.id)
 select count(*) into released_count from released;

 if completed_count>0 or released_count>0 then
  perform private.emit('maintenance_run',jsonb_build_object('completed',completed_count,'payments_released',released_count));
 end if;
 return jsonb_build_object('completed',completed_count,'payments_released',released_count);
end $$;
revoke execute on function private.flek_maintenance() from public,anon,authenticated;

-- ----------------------------------------------------------------- venue status

/*
 * Suspending or rejecting a venue cancels its future bookings — and until now kept the
 * customers' money: this predates payments and was never updated when refunds arrived.
 */
create or replace function public.admin_set_business_status(p_business_id uuid,p_status text,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$
declare o record; k record; previous public.business_status;
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 if p_status not in ('pending','approved','rejected','suspended') then raise exception 'VALIDATION_ERROR'; end if;
 if p_status in ('rejected','suspended') and coalesce(length(trim(p_reason)),0)<3 then raise exception 'VALIDATION_ERROR'; end if;
 select status into previous from public.businesses where id=p_business_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 update public.businesses set status=p_status::public.business_status,status_reason=p_reason,updated_at=now() where id=p_business_id;
 if p_status='approved' and previous is distinct from 'approved' then
  perform private.emit('business_approved',jsonb_build_object('business_id',p_business_id));
 end if;
 if p_status<>'approved' then
  for o in select id from public.offers where business_id=p_business_id and start_at>now() and status='published' order by id for update loop
   update public.offers set status='cancelled',cancelled_at=now(),cancellation_reason=coalesce(p_reason,'Provozovna není dostupná.'),updated_at=now() where id=o.id;
   for k in select id from public.bookings where offer_id=o.id and status='confirmed' for update loop
    update public.bookings set status='cancelled_by_merchant',cancelled_at=now(),cancellation_reason=coalesce(p_reason,'Provozovna není dostupná.') where id=k.id;
    perform private.refund_for_booking(k.id);
   end loop;
   perform private.emit('offer_cancelled',jsonb_build_object('offer_id',o.id,'business_id',p_business_id));
  end loop;
 end if;
end $$;

-- --------------------------------------------------------------------- services

create or replace function public.save_service(p_business_id uuid,p_data jsonb,p_service_id uuid default null)
returns public.services language plpgsql security definer set search_path=public as $$
declare s public.services;
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.businesses where id=p_business_id for share;
 if p_service_id is null then
  insert into public.services(business_id,name,description,category_slug,duration_minutes,normal_price_cents,image_url,is_active,template_slug)
  values(p_business_id,p_data->>'name',coalesce(p_data->>'description',''),p_data->>'category_slug',(p_data->>'duration_minutes')::int,(p_data->>'normal_price_cents')::int,p_data->>'image_url',coalesce((p_data->>'is_active')::bool,true),nullif(p_data->>'template_slug',''))
  returning * into s;
  perform private.emit('service_created',jsonb_build_object('service_id',s.id,'business_id',p_business_id,'template',s.template_slug));
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

-- ---------------------------------------------------------------------- metrics

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
  -- What the merchant is paid: their own price, for every booking whose payment was kept.
  -- A no-show counts: the customer paid and the slot was held for them.
  'earned_cents',(select coalesce(sum(merchant_payout_cents),0) from public.bookings where business_id=p_business_id and status in ('completed','no_show') and start_at_snapshot>=month_start),
  'upcoming_payout_cents',(select coalesce(sum(merchant_payout_cents),0) from public.bookings where business_id=p_business_id and status='confirmed'),
  'active_offers',(select count(*) from public.merchant_offer_rows where business_id=p_business_id and bookable),
  'today_bookings',(select count(*) from public.bookings where business_id=p_business_id and status='confirmed' and start_at_snapshot>=date_trunc('day',now() at time zone 'Europe/Prague') at time zone 'Europe/Prague' and start_at_snapshot<(date_trunc('day',now() at time zone 'Europe/Prague')+interval '1 day') at time zone 'Europe/Prague'),
  'followers',(select count(*) from public.favorites where business_id=p_business_id),
  'free_seats',(select coalesce(sum(capacity_remaining),0) from public.merchant_offer_rows where business_id=p_business_id and bookable)));
end $$;

/*
 * Three different amounts, never interchanged: what merchants are paid (their price), what
 * FLEK earns (the fee) and what customers paid (the sum). Counted over bookings whose
 * payment was kept — completed and no-show.
 */
create or replace function public.admin_metrics() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 return jsonb_build_object(
  'published_capacity',(select coalesce(sum(capacity_total),0) from public.offers where status<>'draft'),
  'booked_capacity',(select count(*) from public.bookings where status in ('confirmed','completed','no_show')),
  'fill_rate_by_category',(select coalesce(jsonb_agg(jsonb_build_object('category',c.label_cs,'published',t.published,'booked',t.booked) order by t.published desc),'[]')
   from (select s.category_slug,sum(o.capacity_total) published,sum(o.capacity_total-o.capacity_remaining) booked
         from public.offers o join public.services s on s.id=o.service_id where o.status<>'draft' group by s.category_slug) t
   join public.categories c on c.slug=t.category_slug),
  'median_minutes_to_first_booking',(select percentile_cont(0.5) within group (order by m) from
   (select extract(epoch from min(k.created_at)-o.published_at)/60 m from public.offers o join public.bookings k on k.offer_id=o.id group by o.id,o.published_at) x),
  'approved_businesses',(select count(*) from public.businesses where status='approved'),
  'repeat_merchants',(select count(*) from (select business_id from public.offers group by business_id having count(distinct date_trunc('week',published_at))>=2) r),
  'repeat_customers',(select count(*) from (select customer_id from public.bookings where status='completed' group by customer_id having count(*)>=2) r),
  'customers',(select count(*) from public.profiles),
  'completed',(select count(*) from public.bookings where status='completed'),
  'no_show',(select count(*) from public.bookings where status='no_show'),
  'unresolved',(select count(*) from public.bookings where status='confirmed' and start_at_snapshot<now()-interval '24 hours'),
  'realized_cents',(select coalesce(sum(price_cents),0) from public.bookings where status in ('completed','no_show')),
  'merchant_payout_cents',(select coalesce(sum(merchant_payout_cents),0) from public.bookings where status in ('completed','no_show')),
  'service_fee_cents',(select coalesce(sum(service_fee_cents),0) from public.bookings where status in ('completed','no_show')),
  'funnel',jsonb_build_object(
   'offer_viewed',(select count(*) from public.analytics_events where name='offer_viewed'),
   'booking_started',(select count(*) from public.analytics_events where name='booking_started'),
   'booking_created',(select count(*) from public.analytics_events where name='booking_created')),
  -- Where new merchants stall, from the events the server itself records.
  'merchant_funnel',jsonb_build_object(
   'business_created',(select count(*) from public.businesses),
   'business_approved',(select count(*) from public.businesses where status='approved'),
   'with_service',(select count(distinct business_id) from public.services),
   'with_offer',(select count(distinct business_id) from public.offers),
   'with_booking',(select count(distinct business_id) from public.bookings),
   'with_completed_booking',(select count(distinct business_id) from public.bookings where status='completed')),
  'failures',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'count',n) order by n desc),'[]')
   from (select coalesce(props->>'code','UNKNOWN') code,count(*) n from public.analytics_events where name='booking_failed' group by 1) f));
end $$;

-- ---------------------------------------------------------------------- realtime

/*
 * The merchant console hears about a new booking the moment it exists. Postgres Changes
 * applies the bookings_read policy per subscriber, so a member of one venue receives only
 * that venue's rows — the same rows it may already select.
 */
alter publication supabase_realtime add table public.bookings;
