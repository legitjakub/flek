-- Corrective migration after service_fee_v1 (already deployed). No historical money changes.
-- Fix simultaneous booking retries and the scheduled refund/booking race.

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
 -- The first lookup may have run before another request committed. Recheck after the
 -- per-customer lock so simultaneous retries return the same booking too.
 select k.id,k.reservation_code into booking_id,reservation_code
  from public.bookings k where k.payment_id=p_payment_id and k.customer_id=u and k.offer_id=p_offer_id;
 if booking_id is not null then return next; return; end if;
 if p.phone is null or length(regexp_replace(p.phone,'[^0-9]','','g'))<9 then raise exception 'PHONE_REQUIRED'; end if;
 if exists(select 1 from public.bookings x where x.offer_id=p_offer_id and x.customer_id=u and x.status='confirmed') then raise exception 'ALREADY_BOOKED'; end if;
 if p.booking_blocked then raise exception 'BOOKING_BLOCKED'; end if;
 if (select count(*) from public.bookings where customer_id=u and status='confirmed' and start_at_snapshot>now())>=3 then raise exception 'TOO_MANY_ACTIVE'; end if;
 if coalesce(p.no_show_override_until,'-infinity')<now() and (select count(*) from public.bookings where customer_id=u and status='no_show' and start_at_snapshot>now()-interval '60 days')>=2 then raise exception 'BLOCKED_NO_SHOW'; end if;

 select biz.* into b from public.businesses biz join public.offers x on x.business_id=biz.id where x.id=p_offer_id for share of biz;
 if b.id is null or b.status<>'approved' then raise exception 'OFFER_UNAVAILABLE'; end if;
 update public.offers x set capacity_remaining=x.capacity_remaining-1,updated_at=now()
 where x.id=p_offer_id and public.offer_is_bookable(x.status,x.capacity_remaining,x.booking_cutoff_at,x.start_at)
 returning x.* into o;
 if not found then raise exception 'OFFER_UNAVAILABLE'; end if;
 -- Lock order matches cancellation: customer, business, offer, payment.
 select * into pay from public.payments where id=p_payment_id for update;
 if pay.id is null or pay.customer_id<>u or pay.offer_id<>p_offer_id then raise exception 'PAYMENT_REQUIRED'; end if;
 if pay.status<>'paid' then raise exception 'PAYMENT_REQUIRED'; end if;

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

create or replace function private.flek_maintenance() returns jsonb
language plpgsql security definer set search_path=public as $$
declare k record; pay record; completed_count integer := 0; released_count integer := 0;
begin
 for k in select id,business_id from public.bookings
   where status='confirmed' and end_at_snapshot <= now()-interval '24 hours'
   order by end_at_snapshot for update skip locked loop
  update public.bookings set status='completed',resolved_at=now() where id=k.id and status='confirmed';
  if found then
   completed_count := completed_count+1;
   perform private.emit('booking_completed',jsonb_build_object('booking_id',k.id,'business_id',k.business_id,'automatic',true));
   perform private.qualify_referral(k.id);
  end if;
 end loop;

 -- Claim candidate payment rows first, without waiting on an in-flight booking.
 -- The existence check MUST be a separate statement after the lock: an UPDATE with
 -- NOT EXISTS in the same snapshot can refund a booking that committed while it waited.
 for pay in select p.id from public.payments p
   where p.status='paid' and p.provider='demo'
    and coalesce(p.paid_at,p.created_at) < now()-interval '30 minutes'
    and not exists(select 1 from public.bookings b where b.payment_id=p.id)
   order by p.id for update of p skip locked loop
  if not exists(select 1 from public.bookings b where b.payment_id=pay.id) then
   update public.payments set status='refunded',refunded_at=now() where id=pay.id and status='paid';
   if found then released_count := released_count+1; end if;
  end if;
 end loop;

 if completed_count>0 or released_count>0 then
  perform private.emit('maintenance_run',jsonb_build_object('completed',completed_count,'payments_released',released_count));
 end if;
 return jsonb_build_object('completed',completed_count,'payments_released',released_count);
end $$;
revoke execute on function private.flek_maintenance() from public,anon,authenticated;


-- Trigger functions are not public endpoints. Pin lookup paths for advisors and predictable execution.
alter function private.offers_legacy_split() set search_path=public;
alter function private.bookings_legacy_split() set search_path=public;
alter function private.bookings_financial_immutable() set search_path=public;
alter function private.flek_current_fee_policy() set search_path=public;
revoke all on function private.offers_legacy_split(),private.bookings_legacy_split(),
 private.bookings_financial_immutable(),private.flek_current_fee_policy(),
 private.validate_flek(timestamptz,timestamptz,integer,integer) from public,anon,authenticated;

-- Even a cancelled booking freezes the agreed offer facts. The editor must know this.
create or replace view public.merchant_offer_rows with(security_invoker=true) as
 select o.id,o.business_id,o.service_id,o.start_at,o.end_at,o.original_price_cents,o.deal_price_cents,
 o.capacity_total,o.capacity_remaining,o.booking_cutoff_at,o.status,o.cancelled_at,o.cancellation_reason,
 o.published_at,o.created_at,o.updated_at,
 s.name service_name,s.duration_minutes,
 (select count(*) from public.bookings k where k.offer_id=o.id and k.status='confirmed') booked,
 (select count(*) from public.bookings k where k.offer_id=o.id and k.status='completed') completed,
 public.offer_is_bookable(o.status,o.capacity_remaining,o.booking_cutoff_at,o.start_at) bookable,
 now() server_now,
 o.merchant_price_cents,o.service_fee_cents,o.fee_policy_version,
 exists(select 1 from public.bookings k where k.offer_id=o.id) has_bookings
 from public.offers o join public.services s on s.id=o.service_id;
