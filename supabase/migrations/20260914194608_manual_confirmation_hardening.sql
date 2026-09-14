-- Follow-up to the gated rollout: close legacy booking entry points and make offer cancellation
-- cooperate with pending authorisations. Kept separate because the base migration was already
-- applied while these race checks were being reviewed.
create or replace function public.create_booking(p_offer_id uuid,p_payment_id uuid)
returns table(booking_id uuid,reservation_code text) language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.payments where id=p_payment_id and confirmation_version=1) then
  raise exception 'PAYMENT_PENDING_CONFIRMATION';
 end if;
 return query select * from private.book_payment(auth.uid(),p_offer_id,p_payment_id);
end $$;

create or replace function public.cancel_booking(p_booking_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare k public.bookings; grace_from timestamptz;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 select * into k from public.bookings where id=p_booking_id and customer_id=auth.uid();
 if not found then raise exception 'NOT_FOUND'; end if;
 perform 1 from public.businesses where id=k.business_id for share;
 perform 1 from public.offers where id=k.offer_id for update;
 perform 1 from public.payments where id=k.payment_id for update;
 select * into k from public.bookings where id=p_booking_id for update;
 if k.status='cancelled_by_customer' then return; end if;
 if k.status<>'confirmed' then raise exception 'ALREADY_RESOLVED'; end if;
 grace_from:=coalesce(k.confirmed_at,k.created_at);
 if not (now()<k.start_at_snapshot-make_interval(mins=>k.cancellation_window_minutes) or now()<grace_from+interval '10 minutes') then
  raise exception 'CANCELLATION_CLOSED';
 end if;
 update public.bookings set status='cancelled_by_customer',cancelled_at=now(),capacity_released_at=coalesce(capacity_released_at,now()) where id=k.id;
 if k.capacity_released_at is null then update public.offers set capacity_remaining=least(capacity_remaining+1,capacity_total),updated_at=now() where id=k.offer_id; end if;
 perform private.refund_for_booking(k.id);
 perform private.emit('booking_cancelled',jsonb_build_object('booking_id',k.id,'offer_id',k.offer_id));
end $$;

create or replace function public.merchant_cancel_offer(p_offer_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare o public.offers; k record;
begin
 select * into o from public.offers where id=p_offer_id;
 if o.id is null or not(public.is_member_of(o.business_id) or public.is_admin()) then raise exception 'FORBIDDEN'; end if;
 if length(trim(p_reason))<3 then raise exception 'VALIDATION_ERROR'; end if;
 for k in select distinct customer_id from public.bookings where offer_id=p_offer_id and status in ('pending_payment','pending_merchant','capturing','confirmed') order by customer_id loop
  perform 1 from public.profiles where id=k.customer_id for update;
 end loop;
 perform 1 from public.businesses where id=o.business_id for share;
 select * into o from public.offers where id=p_offer_id for update;
 if now()>o.start_at then raise exception 'OFFER_STARTED'; end if;
 if o.status='cancelled' then return; end if;
 update public.offers set status='cancelled',cancelled_at=now(),cancellation_reason=p_reason,updated_at=now() where id=o.id;
 for k in select * from public.bookings where offer_id=o.id and status in ('pending_payment','pending_merchant','capturing','confirmed') order by customer_id loop
  perform 1 from public.payments where id=k.payment_id for update;
  perform 1 from public.bookings where id=k.id for update;
  if k.status='confirmed' then
   perform private.refund_for_booking(k.id);
   update public.bookings set status='cancelled_by_merchant',cancelled_at=now(),cancellation_reason=p_reason where id=k.id;
  elsif k.status='capturing' then
   update public.bookings set cancellation_requested=true,cancellation_reason=p_reason where id=k.id;
   insert into private.confirmation_jobs(payment_id,action) values(k.payment_id,'cancel')
   on conflict(payment_id) do update set action='cancel',completed_at=null,available_at=now(),lease=null;
  else
   update public.bookings set status='cancelled_by_merchant',cancelled_at=now(),cancellation_reason=p_reason,
    capacity_released_at=coalesce(capacity_released_at,now()) where id=k.id;
   if k.capacity_released_at is null then update public.offers set capacity_remaining=least(capacity_remaining+1,capacity_total),updated_at=now() where id=o.id; end if;
   update public.payments set authorization_state='release_pending',failure_reason='OFFER_CANCELLED' where id=k.payment_id;
   insert into private.confirmation_jobs(payment_id,action) values(k.payment_id,'cancel')
   on conflict(payment_id) do update set action='cancel',completed_at=null,available_at=now(),lease=null;
  end if;
 end loop;
 perform private.kick_confirmations();
 perform private.emit('offer_cancelled',jsonb_build_object('offer_id',o.id,'business_id',o.business_id,'reason',p_reason));
end $$;

create or replace function public.confirmation_details(p_business_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_business_id is not null and not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',k.id,'confirmation_version',k.confirmation_version,
 'confirmation_expires_at',k.confirmation_expires_at,'checkout_expires_at',k.checkout_expires_at,'confirmed_at',k.confirmed_at,
 'authorization_state',p.authorization_state,
 'can_cancel',k.status='confirmed' and (now()<k.start_at_snapshot-make_interval(mins=>k.cancellation_window_minutes) or now()<coalesce(k.confirmed_at,k.created_at)+interval '10 minutes'),
 'cancellation_deadline',greatest(k.start_at_snapshot-make_interval(mins=>k.cancellation_window_minutes),coalesce(k.confirmed_at,k.created_at)+interval '10 minutes'),
 'server_now',now())),'[]'::jsonb)
 from public.bookings k join public.payments p on p.id=k.payment_id where k.confirmation_version=1
 and case when p_business_id is null then k.customer_id=auth.uid() else k.business_id=p_business_id end);
end $$;
