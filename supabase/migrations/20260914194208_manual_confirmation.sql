-- Manual confirmation is gated until the worker and all clients have been deployed.
alter table public.payments add column confirmation_version integer not null default 0 check(confirmation_version in (0,1)),
 add column authorization_state text not null default 'none' check(authorization_state in ('none','authorized','release_pending','released','captured'));
alter table public.bookings add column confirmation_version integer not null default 0 check(confirmation_version in (0,1)),
 add column checkout_expires_at timestamptz, add column confirmation_expires_at timestamptz,
 add column authorized_at timestamptz, add column confirmed_at timestamptz,
 add column capacity_released_at timestamptz, add column cancellation_requested boolean not null default false;
insert into private.settings(key,value) values('manual_confirmation_enabled','false') on conflict do nothing;
drop index public.bookings_one_active_per_customer_offer;
create unique index bookings_one_active_per_customer_offer on public.bookings(offer_id,customer_id)
 where status in ('pending_payment','pending_merchant','capturing','confirmed');
create index bookings_confirmation_due on public.bookings(confirmation_expires_at)
 where status='pending_merchant';
create index bookings_checkout_due on public.bookings(checkout_expires_at) where status='pending_payment';

create function private.confirmation_deadline(p_start timestamptz,p_now timestamptz) returns timestamptz
language sql immutable set search_path='' as $$
 select case when p_start <= p_now+interval '15 minutes' then null else
 least(p_start-interval '10 minutes',p_now+case
 when p_start>p_now+interval '120 minutes' then interval '10 minutes'
 when p_start>=p_now+interval '30 minutes' then interval '5 minutes'
 else interval '3 minutes' end) end
$$;
create or replace function public.offer_is_bookable(p_status public.offer_status,p_capacity_remaining integer,p_booking_cutoff_at timestamptz,p_start_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select p_status='published' and p_capacity_remaining>0 and p_booking_cutoff_at>now() and p_start_at>now()
 and (coalesce(private.setting('manual_confirmation_enabled'),'false')<>'true' or p_start_at>now()+interval '15 minutes')
$$;

create table private.confirmation_jobs(
 payment_id uuid primary key references public.payments on delete cascade,
 action text not null check(action in ('capture','cancel')),
 available_at timestamptz not null default now(), lease uuid, attempts integer not null default 0,
 completed_at timestamptz, last_error text
);
alter table private.confirmation_jobs enable row level security;
revoke all on private.confirmation_jobs from public,anon,authenticated;
create function private.kick_confirmations() returns void language plpgsql security definer set search_path='' as $$
declare secret text;
begin
 if not exists(select 1 from private.confirmation_jobs where completed_at is null and available_at<=now()) then return; end if;
 select value into secret from private.notification_config where key='worker_secret';
 if secret is null then return; end if;
 perform net.http_post(url:=private.setting('functions_url')||'/booking-confirmation',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),
 body:='{}'::jsonb,timeout_milliseconds:=15000);
end $$;

-- Uniform lock order with legacy cancellations: profile, business, offer, payment, booking.
create function private.lock_confirmation(p_id uuid) returns public.bookings language plpgsql security definer set search_path='' as $$
declare k public.bookings;
begin
 select * into k from public.bookings where id=p_id;
 if k.id is null or k.confirmation_version<>1 then raise exception 'NOT_FOUND'; end if;
 perform 1 from public.profiles where id=k.customer_id for update;
 perform 1 from public.businesses where id=k.business_id for share;
 perform 1 from public.offers where id=k.offer_id for update;
 perform 1 from public.payments where id=k.payment_id for update;
 select * into k from public.bookings where id=p_id for update;
 return k;
end $$;

create function private.release_confirmation(p_id uuid,p_status public.booking_status,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare k public.bookings;
begin
 k:=private.lock_confirmation(p_id);
 if k.status not in ('pending_payment','pending_merchant') then return; end if;
 update public.bookings set status=p_status,cancelled_at=now(),cancellation_reason=p_reason,capacity_released_at=now()
 where id=k.id;
 if k.capacity_released_at is null then
  update public.offers set capacity_remaining=capacity_remaining+1,updated_at=now() where id=k.offer_id;
 end if;
 update public.payments set authorization_state='release_pending',failure_reason=p_reason where id=k.payment_id;
 insert into private.confirmation_jobs(payment_id,action) values(k.payment_id,'cancel')
 on conflict(payment_id) do update set action='cancel',available_at=now(),completed_at=null,lease=null;
 perform private.kick_confirmations();
end $$;

alter function public.start_payment(uuid) rename to start_payment_legacy;
revoke all on function public.start_payment_legacy(uuid) from public,anon,authenticated;
create function public.start_payment(p_offer_id uuid) returns public.payments
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.offers; b public.businesses; p public.payments; pr public.profiles; k public.bookings; s public.services;
begin
 if coalesce(private.setting('manual_confirmation_enabled'),'false')<>'true' then return public.start_payment_legacy(p_offer_id); end if;
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into pr from public.profiles where id=u for update;
 if pr.id is null or pr.booking_blocked then raise exception 'BOOKING_BLOCKED'; end if;
 if pr.phone is null or length(regexp_replace(pr.phone,'[^0-9]','','g'))<9 then raise exception 'PHONE_REQUIRED'; end if;
 select biz.* into b from public.businesses biz join public.offers x on x.business_id=biz.id where x.id=p_offer_id for share of biz;
 select * into o from public.offers where id=p_offer_id for update;
 if o.id is null or b.status<>'approved' then raise exception 'OFFER_UNAVAILABLE'; end if;
 select * into k from public.bookings where customer_id=u and offer_id=o.id and status in ('pending_payment','pending_merchant','capturing','confirmed');
 if k.id is not null then
  if k.status='pending_payment' and k.checkout_expires_at>now() then select * into p from public.payments where id=k.payment_id; return p; end if;
  raise exception 'ALREADY_BOOKED';
 end if;
 if (select count(*) from public.bookings where customer_id=u and status in ('pending_payment','pending_merchant','capturing','confirmed') and start_at_snapshot>now())>=3 then raise exception 'TOO_MANY_ACTIVE'; end if;
 if coalesce(pr.no_show_override_until,'-infinity')<now() and (select count(*) from public.bookings where customer_id=u and status='no_show' and start_at_snapshot>now()-interval '60 days')>=2 then raise exception 'BLOCKED_NO_SHOW'; end if;
 if not public.offer_is_bookable(o.status,o.capacity_remaining,o.booking_cutoff_at,o.start_at) or private.confirmation_deadline(o.start_at,now()) is null then raise exception 'OFFER_UNAVAILABLE'; end if;
 if b.stripe_account_id is null or not b.stripe_charges_enabled then raise exception 'PAYMENTS_NOT_READY'; end if;
 select * into s from public.services where id=o.service_id;
 insert into public.payments(customer_id,offer_id,amount_cents,provider,destination_account_id,application_fee_cents,confirmation_version)
 values(u,o.id,o.deal_price_cents,'stripe',b.stripe_account_id,o.service_fee_cents,1) returning * into p;
 update public.offers set capacity_remaining=capacity_remaining-1,updated_at=now() where id=o.id;
 insert into public.bookings(offer_id,business_id,customer_id,reservation_code,price_cents,service_name_snapshot,business_name_snapshot,
 business_address_snapshot,start_at_snapshot,end_at_snapshot,original_price_cents_snapshot,payment_id,cancellation_window_minutes,
 merchant_payout_cents,service_fee_cents,fee_policy_version,status,confirmation_version,checkout_expires_at)
 values(o.id,b.id,u,'FLEK-'||public.generate_reservation_code(6),o.deal_price_cents,s.name,b.display_name,b.address_line||', '||b.city,
 o.start_at,o.end_at,o.original_price_cents,p.id,b.cancellation_window_minutes,o.merchant_price_cents,o.service_fee_cents,o.fee_policy_version,
 'pending_payment',1,least(now()+interval '3 minutes',o.start_at-interval '15 minutes',o.booking_cutoff_at));
 return p;
end $$;
revoke all on function public.start_payment(uuid) from public,anon;
grant execute on function public.start_payment(uuid) to authenticated;

create function public.confirmation_checkout_context(p_payment_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k public.bookings; p public.payments;
begin
 select id into k.id from public.bookings where payment_id=p_payment_id and confirmation_version=1;
 k:=private.lock_confirmation(k.id);
 select * into p from public.payments where id=p_payment_id;
 return jsonb_build_object('allowed',k.status='pending_payment' and k.checkout_expires_at>now(),
 'expires_at',k.checkout_expires_at,'server_now',now(),'payment',to_jsonb(p));
end $$;

create function public.confirmation_authorized(p_payment_id uuid,p_intent text,p_session text,p_amount integer,p_currency text,p_livemode boolean)
returns void language plpgsql security definer set search_path='' as $$
declare k public.bookings; p public.payments; deadline timestamptz;
begin
 select id into k.id from public.bookings where payment_id=p_payment_id and confirmation_version=1;
 k:=private.lock_confirmation(k.id);
 select * into p from public.payments where id=p_payment_id;
 if p.amount_cents<>p_amount or lower(p_currency)<>'czk' or p.livemode is distinct from p_livemode or p.checkout_session_id is distinct from p_session then raise exception 'PAYMENT_MISMATCH'; end if;
 if p.payment_intent_id is not null and p.payment_intent_id<>p_intent then raise exception 'PAYMENT_MISMATCH'; end if;
 update public.payments set payment_intent_id=p_intent where id=p.id;
 if k.status in ('pending_merchant','capturing','confirmed') then return; end if;
 deadline:=private.confirmation_deadline(k.start_at_snapshot,now());
 if k.status<>'pending_payment' or k.checkout_expires_at<=now() or deadline is null or
 not exists(select 1 from public.offers o join public.businesses b on b.id=o.business_id where o.id=k.offer_id and o.status='published' and b.status='approved') then
  perform private.release_confirmation(k.id,'expired','Potvrzení platby dorazilo po uzávěrce.');
  insert into private.confirmation_jobs(payment_id,action) values(p.id,'cancel')
  on conflict(payment_id) do update set action='cancel',completed_at=null,available_at=now();
  perform private.kick_confirmations(); return;
 end if;
 update public.payments set authorization_state='authorized' where id=p.id;
 update public.bookings set status='pending_merchant',authorized_at=now(),confirmation_expires_at=deadline where id=k.id;
end $$;

create function public.respond_to_booking(p_booking_id uuid,p_accept boolean) returns text
language plpgsql security definer set search_path='' as $$
declare k public.bookings;
begin
 select * into k from public.bookings where id=p_booking_id;
 if not public.is_member_of(k.business_id) then raise exception 'FORBIDDEN'; end if;
 k:=private.lock_confirmation(p_booking_id);
 if k.status<>'pending_merchant' then return k.status::text; end if;
 if k.confirmation_expires_at<=now() then
  perform private.release_confirmation(k.id,'expired','Podnik nepotvrdil rezervaci včas.'); return 'expired';
 end if;
 if not p_accept then perform private.release_confirmation(k.id,'rejected','Podnik nemůže rezervaci přijmout.'); return 'rejected'; end if;
 if not exists(select 1 from public.offers o join public.businesses b on b.id=o.business_id where o.id=k.offer_id and o.status='published' and b.status='approved' and b.stripe_charges_enabled) then
  perform private.release_confirmation(k.id,'rejected','Podnik nyní nemůže rezervaci přijmout.'); return 'rejected';
 end if;
 update public.bookings set status='capturing' where id=k.id;
 insert into private.confirmation_jobs(payment_id,action) values(k.payment_id,'capture') on conflict do nothing;
 perform private.kick_confirmations();
 return 'capturing';
end $$;

create function public.cancel_pending_booking(p_booking_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare k public.bookings;
begin
 select * into k from public.bookings where id=p_booking_id;
 if auth.uid() is null or k.customer_id is distinct from auth.uid() then raise exception 'FORBIDDEN'; end if;
 k:=private.lock_confirmation(p_booking_id);
 if k.status in ('pending_payment','pending_merchant') then
  perform private.release_confirmation(k.id,'cancelled_by_customer','Žádost zrušena zákazníkem.');
 end if;
 return (select status::text from public.bookings where id=k.id);
end $$;

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

-- Timeout claims exactly the same row as a merchant decision. No client timer makes a decision.
create function public.expire_confirmation_requests() returns integer
language plpgsql security definer set search_path='' as $$
declare x record; k public.bookings; n integer:=0;
begin
 for x in select id from public.bookings where confirmation_version=1 and
 ((status='pending_payment' and checkout_expires_at<=now()) or (status='pending_merchant' and confirmation_expires_at<=now()))
 order by customer_id,offer_id limit 100 loop
  k:=private.lock_confirmation(x.id);
  if (k.status='pending_payment' and k.checkout_expires_at<=now()) or (k.status='pending_merchant' and k.confirmation_expires_at<=now()) then
   perform private.release_confirmation(k.id,'expired',case when k.status='pending_payment' then 'Čas pro dokončení platby vypršel.' else 'Podnik nepotvrdil rezervaci včas.' end); n:=n+1;
  end if;
 end loop;
 return n;
end $$;

create function public.claim_confirmation_jobs() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.expire_confirmation_requests();
 with due as (
  select payment_id from private.confirmation_jobs where completed_at is null and available_at<=now()
  order by available_at for update skip locked limit 20
 ), jobs as (
  update private.confirmation_jobs j set lease=gen_random_uuid(),attempts=j.attempts+1,available_at=now()+interval '45 seconds'
  from due where j.payment_id=due.payment_id returning j.*
 )
 select coalesce(jsonb_agg(to_jsonb(j)||jsonb_build_object('intent',p.payment_intent_id,'session',p.checkout_session_id,
 'amount',p.amount_cents,'booking_id',k.id,'booking_status',k.status,'capture_before',k.start_at_snapshot-interval '10 minutes',
 'cancellation_requested',k.cancellation_requested,'server_now',now())),'[]'::jsonb)
 into result from jobs j join public.payments p on p.id=j.payment_id join public.bookings k on k.payment_id=p.id;
 return result;
end $$;

create function public.confirmation_payment_observed(p_payment_id uuid,p_outcome text,p_intent text,p_amount integer default 0)
returns void language plpgsql security definer set search_path='' as $$
declare k public.bookings; p public.payments;
begin
 select id into k.id from public.bookings where payment_id=p_payment_id and confirmation_version=1;
 k:=private.lock_confirmation(k.id);
 select * into p from public.payments where id=p_payment_id;
 if p_intent is not null and p.payment_intent_id is not null and p.payment_intent_id<>p_intent then raise exception 'PAYMENT_MISMATCH'; end if;
 if p_outcome='captured' then
  if p.amount_cents<>p_amount then raise exception 'PAYMENT_MISMATCH'; end if;
  if p.status in ('paid','refunded') then return; end if;
  update public.payments set status='paid',paid_at=now(),authorization_state='captured',payment_intent_id=coalesce(payment_intent_id,p_intent) where id=p.id;
  if k.status='capturing' and not k.cancellation_requested then
   update public.bookings set status='confirmed',confirmed_at=now() where id=k.id;
  else
   -- Unexpected late capture can never resurrect an expired hold; refund through the existing queue.
   update public.payments set refund_requested_at=now(),failure_reason='LATE_CAPTURE' where id=p.id;
   perform private.kick_refunds();
   if k.capacity_released_at is null then update public.offers set capacity_remaining=capacity_remaining+1,updated_at=now() where id=k.offer_id; end if;
   update public.bookings set status='cancelled_by_merchant',cancelled_at=now(),capacity_released_at=coalesce(capacity_released_at,now()),
    cancellation_reason='Rezervaci nelze dokončit. Platbu vracíme.' where id=k.id;
  end if;
 elsif p_outcome='released' then
  if p.status in ('paid','refunded') or k.status='confirmed' then return; end if;
  if k.status in ('pending_payment','pending_merchant') then perform private.release_confirmation(k.id,'payment_failed','Blokaci platby se nepodařilo dokončit.'); end if;
  if k.status='capturing' then
   if k.capacity_released_at is null then update public.offers set capacity_remaining=capacity_remaining+1,updated_at=now() where id=k.offer_id; end if;
   update public.bookings set status='payment_failed',capacity_released_at=coalesce(capacity_released_at,now()),cancelled_at=now(),
    cancellation_reason='Platbu se nepodařilo dokončit. Blokaci na kartě uvolňujeme.' where id=k.id;
  end if;
  update public.payments set status='failed',authorization_state='released',payment_intent_id=coalesce(payment_intent_id,p_intent) where id=p.id;
 else raise exception 'INVALID_OUTCOME'; end if;
end $$;

create function public.finish_confirmation_job(p_payment_id uuid,p_lease uuid,p_done boolean,p_error text default null)
returns void language sql security definer set search_path='' as $$
 update private.confirmation_jobs set completed_at=case when p_done then now() end,lease=null,
 last_error=left(p_error,200),available_at=now()+interval '20 seconds'
 where payment_id=p_payment_id and lease=p_lease
$$;

create function public.confirmation_job_ready(p_payment_id uuid,p_lease uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(
  select 1 from private.confirmation_jobs j join public.bookings k on k.payment_id=j.payment_id
  where j.payment_id=p_payment_id and j.lease=p_lease and j.action='capture' and j.completed_at is null
  and k.status='capturing' and not k.cancellation_requested and k.start_at_snapshot>now()+interval '10 minutes'
 )
$$;

-- Extra data through an authorised RPC; no new grants on domain tables.
create function public.confirmation_details(p_business_id uuid default null) returns jsonb
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

create or replace function public.my_payment_state(p_payment_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.payments; k public.bookings;
begin
 select * into p from public.payments where id=p_payment_id and customer_id=auth.uid();
 if p.id is null then raise exception 'NOT_FOUND'; end if;
 select * into k from public.bookings where payment_id=p.id;
 return jsonb_build_object('id',p.id,'offer_id',p.offer_id,'provider',p.provider,'status',p.status,'amount_cents',p.amount_cents,
 'refund_requested',p.refund_requested_at is not null,'refund_status',p.refund_status,'failure_reason',p.failure_reason,
 'booking_id',k.id,'reservation_code',case when k.status in ('confirmed','completed','no_show') then k.reservation_code end,
 'confirmation_version',p.confirmation_version,'booking_status',k.status,'confirmation_expires_at',k.confirmation_expires_at,
 'checkout_expires_at',k.checkout_expires_at,'authorization_state',p.authorization_state,'server_now',now());
end $$;
create or replace function public.payments_mode() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('provider','stripe','test',coalesce(private.setting('stripe_test_mode'),'true')='true',
 'manual_confirmation',coalesce(private.setting('manual_confirmation_enabled'),'false')='true')
$$;

-- Prevent a merchant changing what a pending customer has authorised.
create function private.guard_pending_offer() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.start_at,new.end_at,new.deal_price_cents,new.original_price_cents,new.merchant_price_cents,new.service_fee_cents,new.fee_policy_version,new.capacity_total,new.service_id)
 is distinct from (old.start_at,old.end_at,old.deal_price_cents,old.original_price_cents,old.merchant_price_cents,old.service_fee_cents,old.fee_policy_version,old.capacity_total,old.service_id)
 and exists(select 1 from public.bookings where offer_id=old.id and status in ('pending_payment','pending_merchant','capturing')) then
 raise exception 'OFFER_HAS_PENDING_BOOKINGS'; end if;
 return new;
end $$;
create trigger guard_pending_offer before update on public.offers for each row execute function private.guard_pending_offer();

-- Global, non-PII revision allows every discovery surface to refresh without table SELECT.
create table private.inventory_revision(id boolean primary key default true check(id), revision bigint not null default 0);
insert into private.inventory_revision values(true,0);
alter table private.inventory_revision enable row level security;
revoke all on private.inventory_revision from public,anon,authenticated;
create function private.inventory_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin update private.inventory_revision set revision=revision+1; return null; end $$;
create trigger inventory_changed after update of capacity_remaining,status on public.offers for each statement execute function private.inventory_changed();
create function public.inventory_version() returns bigint language sql stable security definer set search_path='' as $$
 select revision from private.inventory_revision where id
$$;
revoke all on function public.inventory_version() from public;
grant execute on function public.inventory_version() to anon,authenticated;

-- Only authenticated actors may decide; money observations and workers are service-role only.
revoke all on function public.respond_to_booking(uuid,boolean),public.cancel_pending_booking(uuid),public.confirmation_details(uuid) from public,anon;
grant execute on function public.respond_to_booking(uuid,boolean),public.cancel_pending_booking(uuid),public.confirmation_details(uuid) to authenticated;
revoke all on function public.confirmation_checkout_context(uuid),public.confirmation_authorized(uuid,text,text,integer,text,boolean),
 public.expire_confirmation_requests(),public.claim_confirmation_jobs(),public.confirmation_payment_observed(uuid,text,text,integer),
 public.finish_confirmation_job(uuid,uuid,boolean,text),public.confirmation_job_ready(uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirmation_checkout_context(uuid),public.confirmation_authorized(uuid,text,text,integer,text,boolean),
 public.expire_confirmation_requests(),public.claim_confirmation_jobs(),public.confirmation_payment_observed(uuid,text,text,integer),
 public.finish_confirmation_job(uuid,uuid,boolean,text),public.confirmation_job_ready(uuid,uuid) to service_role;
revoke all on function private.confirmation_deadline(timestamptz,timestamptz),private.lock_confirmation(uuid),
 private.release_confirmation(uuid,public.booking_status,text),private.kick_confirmations(),private.guard_pending_offer(),private.inventory_changed() from public,anon,authenticated;
select cron.schedule('flek-confirmation-expiry','10 seconds',$$select public.expire_confirmation_requests(); select private.kick_confirmations();$$);
