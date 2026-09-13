create schema if not exists private;
revoke all on schema private from public,anon,authenticated;

create function private.emit(p_name text,p_props jsonb default '{}') returns void language plpgsql set search_path=public as $$
begin
 insert into public.analytics_events(name,session_id,user_id,props) values(p_name,'server',auth.uid(),p_props);
exception when others then null; -- Analytics must never prevent the authoritative mutation.
end $$;
create function public.record_event(p_name text,p_session_id text,p_props jsonb default '{}') returns void language plpgsql security definer set search_path=public as $$
begin
 if p_name not in ('search_performed','offer_viewed','booking_started','booking_failed') then return; end if;
 insert into public.analytics_events(name,session_id,user_id,props) values(p_name,left(p_session_id,100),auth.uid(),p_props);
exception when others then null;
end $$;

create function public.generate_reservation_code(n integer) returns text language plpgsql volatile set search_path=public as $$
declare a constant text := '2346789ABCDEFGHJKLMNPQRTUVWXYZ'; v text:=''; b integer;
begin
 if n<1 or n>32 then raise exception 'VALIDATION_ERROR'; end if;
 while length(v)<n loop
  b:=get_byte(extensions.gen_random_bytes(1),0);
  if b<(256/length(a))*length(a) then v:=v||substr(a,b%length(a)+1,1); end if;
 end loop;
 return v;
end $$;

create function public.save_profile(p_first_name text,p_last_name text,p_phone text,p_avatar_url text default null)
returns public.profiles language plpgsql security definer set search_path=public as $$
declare v public.profiles;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if length(trim(p_first_name)) not between 1 and 80 or length(p_last_name)>80 then raise exception 'VALIDATION_ERROR'; end if;
 if p_phone is not null and regexp_replace(p_phone,'[^0-9]','','g') !~ '^[0-9]{9,15}$' then raise exception 'PHONE_REQUIRED'; end if;
 update public.profiles set first_name=trim(p_first_name),last_name=trim(p_last_name),phone=nullif(trim(p_phone),''),avatar_url=p_avatar_url,updated_at=now() where id=auth.uid() returning * into v;
 return v;
end $$;

create function public.create_booking(p_offer_id uuid) returns table(booking_id uuid,reservation_code text)
language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); p public.profiles; o public.offers; s public.services; b public.businesses; code text; constraint_name text;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 -- One customer lock protects both the three-booking limit and duplicate detection.
 select * into p from public.profiles where id=u for update;
 if p.phone is null or length(regexp_replace(p.phone,'[^0-9]','','g'))<9 then raise exception 'PHONE_REQUIRED'; end if;
 if exists(select 1 from public.bookings x where x.offer_id=p_offer_id and x.customer_id=u and x.status='confirmed') then raise exception 'ALREADY_BOOKED'; end if;
 if p.booking_blocked then raise exception 'BOOKING_BLOCKED'; end if;
 if (select count(*) from public.bookings where customer_id=u and status='confirmed' and start_at_snapshot>now())>=3 then raise exception 'TOO_MANY_ACTIVE'; end if;
 if coalesce(p.no_show_override_until,'-infinity')<now() and (select count(*) from public.bookings where customer_id=u and status='no_show' and start_at_snapshot>now()-interval '60 days')>=2 then raise exception 'BLOCKED_NO_SHOW'; end if;
 -- Shared business lock serializes the claim against approval/suspension changes.
 select biz.* into b from public.businesses biz join public.offers x on x.business_id=biz.id where x.id=p_offer_id for share of biz;
 if b.id is null or b.status<>'approved' then raise exception 'OFFER_UNAVAILABLE'; end if;
 update public.offers x set capacity_remaining=x.capacity_remaining-1,updated_at=now()
 where x.id=p_offer_id and public.offer_is_bookable(x.status,x.capacity_remaining,x.booking_cutoff_at,x.start_at)
 returning x.* into o;
 if not found then raise exception 'OFFER_UNAVAILABLE'; end if;
 select * into s from public.services where id=o.service_id;
 for i in 1..5 loop
  code:='FLEK-'||public.generate_reservation_code(6);
  begin
   insert into public.bookings as bk(offer_id,business_id,customer_id,reservation_code,price_cents,service_name_snapshot,business_name_snapshot,business_address_snapshot,start_at_snapshot,end_at_snapshot,original_price_cents_snapshot)
   values(o.id,o.business_id,u,code,o.deal_price_cents,s.name,b.display_name,b.address_line||', '||b.city,o.start_at,o.end_at,o.original_price_cents)
   returning bk.id,bk.reservation_code into booking_id,reservation_code;
   perform private.emit('booking_created',jsonb_build_object('booking_id',booking_id,'offer_id',o.id,'business_id',b.id));
   return next; return;
  exception when unique_violation then
   get stacked diagnostics constraint_name=CONSTRAINT_NAME;
   if constraint_name='bookings_one_active_per_customer_offer' then raise exception 'ALREADY_BOOKED'; end if;
   if constraint_name<>'bookings_reservation_code_key' then raise; end if;
  end;
 end loop;
 raise exception 'CODE_GENERATION_FAILED';
end $$;

create function public.cancel_booking(p_booking_id uuid) returns void language plpgsql security definer set search_path=public as $$
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
 perform private.emit('booking_cancelled',jsonb_build_object('booking_id',k.id,'offer_id',k.offer_id));
end $$;

create function public.merchant_cancel_offer(p_offer_id uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare o public.offers;
begin
 select * into o from public.offers where id=p_offer_id;
 if o.id is null or not(public.is_member_of(o.business_id) or public.is_admin()) then raise exception 'FORBIDDEN'; end if;
 if length(trim(p_reason))<3 then raise exception 'VALIDATION_ERROR'; end if;
 perform 1 from public.businesses where id=o.business_id for share;
 select * into o from public.offers where id=p_offer_id for update;
 if now()>o.start_at then raise exception 'OFFER_STARTED'; end if;
 if o.status='cancelled' then return; end if;
 update public.offers set status='cancelled',cancelled_at=now(),cancellation_reason=p_reason,updated_at=now() where id=o.id;
 update public.bookings set status='cancelled_by_merchant',cancelled_at=now(),cancellation_reason=p_reason where offer_id=o.id and status='confirmed';
 perform private.emit('offer_cancelled',jsonb_build_object('offer_id',o.id,'business_id',o.business_id,'reason',p_reason));
end $$;

create function public.merchant_resolve_booking(p_booking_id uuid,p_outcome text) returns void language plpgsql security definer set search_path=public as $$
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
end $$;

create function public.admin_set_business_status(p_business_id uuid,p_status text,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$
declare o record;
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 if p_status not in ('pending','approved','rejected','suspended') then raise exception 'VALIDATION_ERROR'; end if;
 if p_status in ('rejected','suspended') and coalesce(length(trim(p_reason)),0)<3 then raise exception 'VALIDATION_ERROR'; end if;
 perform 1 from public.businesses where id=p_business_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 update public.businesses set status=p_status::public.business_status,status_reason=p_reason,updated_at=now() where id=p_business_id;
 if p_status<>'approved' then
  for o in select id from public.offers where business_id=p_business_id and start_at>now() and status='published' order by id for update loop
   update public.offers set status='cancelled',cancelled_at=now(),cancellation_reason=coalesce(p_reason,'Provozovna není dostupná.'),updated_at=now() where id=o.id;
   update public.bookings set status='cancelled_by_merchant',cancelled_at=now(),cancellation_reason=coalesce(p_reason,'Provozovna není dostupná.') where offer_id=o.id and status='confirmed';
   perform private.emit('offer_cancelled',jsonb_build_object('offer_id',o.id,'business_id',p_business_id));
  end loop;
 end if;
end $$;
create function public.admin_set_booking_block(p_user_id uuid,p_blocked boolean,p_override_no_shows boolean default false) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 update public.profiles set booking_blocked=p_blocked,no_show_override_until=case when p_override_no_shows then now()+interval '60 days' else null end where id=p_user_id;
end $$;

-- Functions default to PUBLIC EXECUTE in PostgreSQL; every API grant is explicit.
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.is_admin(),public.is_member_of(uuid),public.my_business_ids(),public.offer_is_bookable(public.offer_status,integer,timestamptz,timestamptz),public.record_event(text,text,jsonb) to anon,authenticated;
grant execute on function public.save_profile(text,text,text,text),public.create_booking(uuid),public.cancel_booking(uuid),public.merchant_cancel_offer(uuid,text),public.merchant_resolve_booking(uuid,text),public.admin_set_business_status(uuid,text,text),public.admin_set_booking_block(uuid,boolean,boolean) to authenticated;
grant execute on all functions in schema public to service_role;
