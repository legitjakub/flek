-- The free-cancellation window was hard-coded at 60 minutes for everyone. A padel court
-- and a three-hour treatment do not carry the same risk, so each venue sets its own.
--
-- The window is snapshotted onto the booking: a merchant tightening the policy later must
-- never change the terms a customer already booked under.
alter table public.businesses
  add column cancellation_window_minutes integer not null default 60
  check (cancellation_window_minutes between 0 and 10080);

alter table public.bookings
  add column cancellation_window_minutes integer not null default 60
  check (cancellation_window_minutes between 0 and 10080);

create or replace function public.create_booking(p_offer_id uuid, p_payment_id uuid) returns table(booking_id uuid,reservation_code text)
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
   insert into public.bookings as bk(offer_id,business_id,customer_id,reservation_code,price_cents,service_name_snapshot,business_name_snapshot,business_address_snapshot,start_at_snapshot,end_at_snapshot,original_price_cents_snapshot,payment_id,cancellation_window_minutes)
   values(o.id,o.business_id,u,code,o.deal_price_cents,s.name,b.display_name,b.address_line||', '||b.city,o.start_at,o.end_at,o.original_price_cents,pay.id,b.cancellation_window_minutes)
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
 -- The window the customer agreed to, not the one the venue has today.
 if not (now()<k.start_at_snapshot-make_interval(mins=>k.cancellation_window_minutes) or now()<k.created_at+interval '10 minutes') then
  raise exception 'CANCELLATION_CLOSED';
 end if;
 update public.bookings set status='cancelled_by_customer',cancelled_at=now() where id=k.id;
 update public.offers set capacity_remaining=least(capacity_remaining+1,capacity_total),updated_at=now() where id=k.offer_id;
 perform private.refund_for_booking(k.id);
 perform private.emit('booking_cancelled',jsonb_build_object('booking_id',k.id,'offer_id',k.offer_id));
end $$;

drop function if exists public.my_bookings();
drop view if exists public.customer_booking_details;
create view public.customer_booking_details with(security_invoker=true) as
 select k.*,b.phone business_phone,
 k.status='confirmed' and (now()<k.start_at_snapshot-make_interval(mins=>k.cancellation_window_minutes) or now()<k.created_at+interval '10 minutes') can_cancel,
 greatest(k.start_at_snapshot-make_interval(mins=>k.cancellation_window_minutes),k.created_at+interval '10 minutes') cancellation_deadline,
 now() server_now,
 (select pay.status from public.payments pay where pay.id=k.payment_id) payment_status
 from public.bookings k join public.businesses b on b.id=k.business_id;
create function public.my_bookings() returns setof public.customer_booking_details language sql stable security definer set search_path=public as $$
 select * from public.customer_booking_details where customer_id=auth.uid() order by start_at_snapshot desc;
$$;

-- The offer detail has to quote the venue's own window, not a constant.
create or replace view public.offer_details with(security_invoker=true) as
 select o.*,s.name service_name,s.description,s.category_slug,s.image_url,
 b.display_name business_name,b.slug business_slug,b.description business_description,b.phone business_phone,
 b.address_line,b.city,b.district,b.cover_url,b.logo_url,b.status business_status,
 extensions.st_y(b.location::extensions.geometry) latitude,extensions.st_x(b.location::extensions.geometry) longitude,
 floor((o.original_price_cents-o.deal_price_cents)::numeric*100/o.original_price_cents)::integer discount_pct,
 public.offer_is_bookable(o.status,o.capacity_remaining,o.booking_cutoff_at,o.start_at) and b.status='approved' bookable,
 now() server_now,
 (select round(avg(r.rating),1) from public.bookings r where r.business_id=b.id and r.rating is not null) rating_avg,
 (select count(*) from public.bookings r where r.business_id=b.id and r.rating is not null)::integer rating_count,
 b.cancellation_window_minutes
 from public.offers o join public.services s on s.id=o.service_id join public.businesses b on b.id=o.business_id;

create or replace function public.update_business(p_business_id uuid,p_data jsonb) returns public.businesses language plpgsql security definer set search_path=public as $$
declare b public.businesses; lat float8; lng float8; win integer;
begin
 if not public.is_member_of(p_business_id) then raise exception 'FORBIDDEN'; end if;
 select * into b from public.businesses where id=p_business_id for update;
 lat:=coalesce((p_data->>'latitude')::float8,extensions.st_y(b.location::extensions.geometry));
 lng:=coalesce((p_data->>'longitude')::float8,extensions.st_x(b.location::extensions.geometry));
 if lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'VALIDATION_ERROR'; end if;
 win:=coalesce((p_data->>'cancellation_window_minutes')::integer,b.cancellation_window_minutes);
 if win not between 0 and 10080 then raise exception 'INVALID_CANCELLATION_WINDOW'; end if;
 update public.businesses set display_name=coalesce(p_data->>'display_name',display_name),description=coalesce(p_data->>'description',description),category_slug=coalesce(p_data->>'category_slug',category_slug),phone=coalesce(p_data->>'phone',phone),public_email=coalesce(p_data->>'public_email',public_email),website=coalesce(p_data->>'website',website),address_line=coalesce(p_data->>'address_line',address_line),city=coalesce(p_data->>'city',city),district=coalesce(p_data->>'district',district),postal_code=coalesce(p_data->>'postal_code',postal_code),location=extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography,logo_url=coalesce(p_data->>'logo_url',logo_url),cover_url=coalesce(p_data->>'cover_url',cover_url),cancellation_window_minutes=win,updated_at=now() where id=p_business_id returning * into b;
 return b;
end $$;

create or replace function public.create_business(p_data jsonb) returns public.businesses language plpgsql security definer set search_path=public as $$
declare b public.businesses; bid uuid:=gen_random_uuid(); lat float8:=(p_data->>'latitude')::float8; lng float8:=(p_data->>'longitude')::float8; win integer:=coalesce((p_data->>'cancellation_window_minutes')::integer,60);
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if lat is null or lng is null or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'VALIDATION_ERROR'; end if;
 if win not between 0 and 10080 then raise exception 'INVALID_CANCELLATION_WINDOW'; end if;
 insert into public.businesses(id,display_name,slug,legal_name,description,category_slug,phone,public_email,website,address_line,city,district,postal_code,country,location,logo_url,cover_url,cancellation_window_minutes)
 values(bid,p_data->>'display_name',lower(regexp_replace(p_data->>'display_name','[^a-zA-Z0-9]+','-','g'))||'-'||left(bid::text,8),p_data->>'legal_name',coalesce(p_data->>'description',''),p_data->>'category_slug',p_data->>'phone',p_data->>'public_email',p_data->>'website',p_data->>'address_line',p_data->>'city',coalesce(p_data->>'district',''),p_data->>'postal_code',coalesce(p_data->>'country','CZ'),extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography,p_data->>'logo_url',p_data->>'cover_url',win) returning * into b;
 insert into public.business_members(business_id,user_id,role) values(b.id,auth.uid(),'owner');
 perform private.emit('merchant_signup_completed',jsonb_build_object('business_id',b.id));
 return b;
end $$;

revoke all on public.customer_booking_details from anon,authenticated;
revoke execute on function public.my_bookings() from public,anon,authenticated;
grant execute on function public.my_bookings() to authenticated,service_role;
grant all on public.customer_booking_details to service_role;
