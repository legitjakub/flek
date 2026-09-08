-- Paying at booking time instead of at the venue. The money is taken before the seat is
-- issued, so a booking can only exist against a payment that is already settled.
--
-- The provider sits behind this table: `provider='demo'` settles through
-- demo_confirm_payment (the pilot demo), a real gateway settles the same row from its
-- webhook using the service role. Nothing else in the schema changes when that swap happens.
create type public.payment_status as enum ('pending','paid','refunded','failed');

create table public.payments (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references auth.users on delete restrict,
 offer_id uuid not null references public.offers on delete restrict,
 amount_cents integer not null check(amount_cents>0 and amount_cents%100=0),
 status public.payment_status not null default 'pending',
 provider text not null default 'demo',
 provider_reference text,
 created_at timestamptz not null default now(),
 paid_at timestamptz,
 refunded_at timestamptz
);
create index payments_customer on public.payments(customer_id,created_at desc);
create index payments_offer on public.payments(offer_id);

alter table public.bookings add column payment_id uuid references public.payments(id) on delete restrict;
-- A settled payment buys exactly one seat and can never be replayed for a second booking.
create unique index bookings_one_per_payment on public.bookings(payment_id) where payment_id is not null;

alter table public.payments enable row level security;
create policy payments_read on public.payments for select using(customer_id=auth.uid() or public.is_admin());
revoke all on public.payments from anon,authenticated;
grant select on public.payments to authenticated;
grant all on public.payments to service_role;

-- Amount always comes from the offer row; a client-supplied price is never trusted.
create function public.start_payment(p_offer_id uuid) returns public.payments
language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); o public.offers; b public.businesses; p public.payments;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into o from public.offers where id=p_offer_id;
 if o.id is null then raise exception 'OFFER_UNAVAILABLE'; end if;
 select * into b from public.businesses where id=o.business_id;
 if b.status<>'approved' or not public.offer_is_bookable(o.status,o.capacity_remaining,o.booking_cutoff_at,o.start_at) then
  raise exception 'OFFER_UNAVAILABLE';
 end if;
 if exists(select 1 from public.bookings k where k.offer_id=p_offer_id and k.customer_id=u and k.status='confirmed') then
  raise exception 'ALREADY_BOOKED';
 end if;
 -- Reuse a fresh unsettled attempt so a double tap does not open a second payment.
 select * into p from public.payments
  where customer_id=u and offer_id=p_offer_id and status='pending' and created_at>now()-interval '20 minutes'
  order by created_at desc limit 1;
 if p.id is not null then
  update public.payments set amount_cents=o.deal_price_cents where id=p.id returning * into p;
  return p;
 end if;
 insert into public.payments(customer_id,offer_id,amount_cents) values(u,p_offer_id,o.deal_price_cents) returning * into p;
 return p;
end $$;

-- The demo settlement path. A real gateway never calls this: it settles from its webhook.
create function public.demo_confirm_payment(p_payment_id uuid) returns public.payments
language plpgsql security definer set search_path=public as $$
declare p public.payments;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into p from public.payments where id=p_payment_id and customer_id=auth.uid() for update;
 if p.id is null then raise exception 'FORBIDDEN'; end if;
 if p.provider<>'demo' then raise exception 'FORBIDDEN'; end if;
 if p.status='paid' then return p; end if;
 if p.status<>'pending' then raise exception 'PAYMENT_FAILED'; end if;
 update public.payments set status='paid',paid_at=now(),provider_reference='demo-'||left(p.id::text,8)
  where id=p.id returning * into p;
 return p;
end $$;

drop function if exists public.create_booking(uuid);

create function public.create_booking(p_offer_id uuid, p_payment_id uuid) returns table(booking_id uuid,reservation_code text)
language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); p public.profiles; pay public.payments; o public.offers; s public.services; b public.businesses; code text; constraint_name text;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into p from public.profiles where id=u for update;
 if p.phone is null or length(regexp_replace(p.phone,'[^0-9]','','g'))<9 then raise exception 'PHONE_REQUIRED'; end if;
 if exists(select 1 from public.bookings x where x.offer_id=p_offer_id and x.customer_id=u and x.status='confirmed') then raise exception 'ALREADY_BOOKED'; end if;
 if p.booking_blocked then raise exception 'BOOKING_BLOCKED'; end if;
 if (select count(*) from public.bookings where customer_id=u and status='confirmed' and start_at_snapshot>now())>=3 then raise exception 'TOO_MANY_ACTIVE'; end if;
 if coalesce(p.no_show_override_until,'-infinity')<now() and (select count(*) from public.bookings where customer_id=u and status='no_show' and start_at_snapshot>now()-interval '60 days')>=2 then raise exception 'BLOCKED_NO_SHOW'; end if;

 -- The seat is only issued against money that has actually settled.
 select * into pay from public.payments where id=p_payment_id for update;
 if pay.id is null or pay.customer_id<>u or pay.offer_id<>p_offer_id then raise exception 'PAYMENT_REQUIRED'; end if;
 if pay.status<>'paid' then raise exception 'PAYMENT_REQUIRED'; end if;

 select biz.* into b from public.businesses biz join public.offers x on x.business_id=biz.id where x.id=p_offer_id for share of biz;
 if b.id is null or b.status<>'approved' then raise exception 'OFFER_UNAVAILABLE'; end if;
 update public.offers x set capacity_remaining=x.capacity_remaining-1,updated_at=now()
 where x.id=p_offer_id and public.offer_is_bookable(x.status,x.capacity_remaining,x.booking_cutoff_at,x.start_at)
 returning x.* into o;
 if not found then raise exception 'OFFER_UNAVAILABLE'; end if;
 -- Price is the one that was paid; a mid-flight change must not silently overcharge.
 if pay.amount_cents<>o.deal_price_cents then raise exception 'PRICE_CHANGED'; end if;
 select * into s from public.services where id=o.service_id;
 for i in 1..5 loop
  code:='FLEK-'||public.generate_reservation_code(6);
  begin
   insert into public.bookings as bk(offer_id,business_id,customer_id,reservation_code,price_cents,service_name_snapshot,business_name_snapshot,business_address_snapshot,start_at_snapshot,end_at_snapshot,original_price_cents_snapshot,payment_id)
   values(o.id,o.business_id,u,code,o.deal_price_cents,s.name,b.display_name,b.address_line||', '||b.city,o.start_at,o.end_at,o.original_price_cents,pay.id)
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

-- Money goes back whenever the seat is released by anyone but the customer failing to show.
create function private.refund_for_booking(p_booking_id uuid) returns void language plpgsql set search_path=public as $$
begin
 update public.payments set status='refunded',refunded_at=now()
 where id=(select payment_id from public.bookings where id=p_booking_id) and status='paid';
end $$;

create or replace function public.cancel_booking(p_booking_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare k public.bookings;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 select * into k from public.bookings where id=p_booking_id and customer_id=auth.uid();
 if not found then raise exception 'NOT_FOUND'; end if;
 perform 1 from public.businesses where id=k.business_id for share;
 perform 1 from public.offers where id=k.offer_id for update;
 select * into k from public.bookings where id=p_booking_id for update;
 if k.status='cancelled_by_customer' then return; end if;
 if k.status<>'confirmed' then raise exception 'ALREADY_RESOLVED'; end if;
 if not (now()<k.start_at_snapshot-interval '60 minutes' or now()<k.created_at+interval '10 minutes') then raise exception 'CANCELLATION_CLOSED'; end if;
 update public.bookings set status='cancelled_by_customer',cancelled_at=now() where id=k.id;
 update public.offers set capacity_remaining=least(capacity_remaining+1,capacity_total),updated_at=now() where id=k.offer_id;
 perform private.refund_for_booking(k.id);
 perform private.emit('booking_cancelled',jsonb_build_object('booking_id',k.id,'offer_id',k.offer_id));
end $$;

create or replace function public.merchant_cancel_offer(p_offer_id uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare o public.offers; k record;
begin
 select * into o from public.offers where id=p_offer_id;
 if o.id is null or not(public.is_member_of(o.business_id) or public.is_admin()) then raise exception 'FORBIDDEN'; end if;
 if length(trim(p_reason))<3 then raise exception 'VALIDATION_ERROR'; end if;
 perform 1 from public.businesses where id=o.business_id for share;
 select * into o from public.offers where id=p_offer_id for update;
 if now()>o.start_at then raise exception 'OFFER_STARTED'; end if;
 if o.status='cancelled' then return; end if;
 update public.offers set status='cancelled',cancelled_at=now(),cancellation_reason=p_reason,updated_at=now() where id=o.id;
 for k in select id from public.bookings where offer_id=o.id and status='confirmed' loop
  perform private.refund_for_booking(k.id);
 end loop;
 update public.bookings set status='cancelled_by_merchant',cancelled_at=now(),cancellation_reason=p_reason where offer_id=o.id and status='confirmed';
 perform private.emit('offer_cancelled',jsonb_build_object('offer_id',o.id,'business_id',o.business_id,'reason',p_reason));
end $$;

-- Read models carry the payment state so both sides can see it.
drop function if exists public.my_bookings();
drop view if exists public.customer_booking_details;
create view public.customer_booking_details with(security_invoker=true) as
 select k.*,b.phone business_phone,
 k.status='confirmed' and (now()<k.start_at_snapshot-interval '60 minutes' or now()<k.created_at+interval '10 minutes') can_cancel,
 greatest(k.start_at_snapshot-interval '60 minutes',k.created_at+interval '10 minutes') cancellation_deadline,
 now() server_now,
 (select pay.status from public.payments pay where pay.id=k.payment_id) payment_status
 from public.bookings k join public.businesses b on b.id=k.business_id;
create function public.my_bookings() returns setof public.customer_booking_details language sql stable security definer set search_path=public as $$
 select * from public.customer_booking_details where customer_id=auth.uid() order by start_at_snapshot desc;
$$;

drop function if exists public.merchant_bookings(uuid,timestamptz,timestamptz);
drop function if exists public.merchant_booking_detail(uuid);
drop function if exists public.merchant_lookup_booking(text);
drop view if exists public.merchant_booking_rows;
create view public.merchant_booking_rows with(security_invoker=true) as
 select k.*,trim(p.first_name||' '||case when p.last_name<>'' then left(p.last_name,1)||'.' else '' end) customer_label,
 k.status='confirmed' and now()>=k.start_at_snapshot can_resolve,
 k.status='confirmed' and now()>=k.start_at_snapshot+interval '24 hours' unresolved, now() server_now,
 (select pay.status from public.payments pay where pay.id=k.payment_id) payment_status
 from public.bookings k join public.profiles p on p.id=k.customer_id;
create function public.merchant_bookings(p_business_id uuid,p_from timestamptz default null,p_until timestamptz default null) returns setof public.merchant_booking_rows language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 return query select * from public.merchant_booking_rows where business_id=p_business_id and (p_from is null or start_at_snapshot>=p_from) and (p_until is null or start_at_snapshot<p_until) order by start_at_snapshot;
end $$;
create function public.merchant_booking_detail(p_booking_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select to_jsonb(k)||case when k.status='confirmed' then jsonb_build_object('first_name',p.first_name,'last_name',p.last_name,'phone',p.phone) else '{}'::jsonb end
 from public.merchant_booking_rows k join public.profiles p on p.id=k.customer_id where k.id=p_booking_id and public.is_member_of(k.business_id);
$$;
create function public.merchant_lookup_booking(p_code text) returns jsonb language sql stable security definer set search_path=public as $$
 select public.merchant_booking_detail(k.id) from public.bookings k where k.reservation_code=upper(trim(p_code)) and public.is_member_of(k.business_id);
$$;

revoke all on public.customer_booking_details,public.merchant_booking_rows from anon,authenticated;
revoke execute on function public.start_payment(uuid),public.demo_confirm_payment(uuid),public.create_booking(uuid,uuid),public.my_bookings(),public.merchant_bookings(uuid,timestamptz,timestamptz),public.merchant_booking_detail(uuid),public.merchant_lookup_booking(text) from public,anon,authenticated;
grant execute on function public.start_payment(uuid),public.demo_confirm_payment(uuid),public.create_booking(uuid,uuid),public.my_bookings(),public.merchant_bookings(uuid,timestamptz,timestamptz),public.merchant_booking_detail(uuid),public.merchant_lookup_booking(text) to authenticated,service_role;
grant all on public.customer_booking_details,public.merchant_booking_rows to service_role;
