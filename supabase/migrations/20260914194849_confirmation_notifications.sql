alter table public.notifications drop constraint notifications_event_check;
alter table public.notifications add constraint notifications_event_check check(event in ('requested','confirmed','cancelled'));
alter table public.notification_preferences drop constraint notification_preferences_event_check;
alter table public.notification_preferences add constraint notification_preferences_event_check check(event in ('requested','confirmed','cancelled'));

create or replace function public.save_notification_preference(p_scope text,p_event text,p_email boolean,p_push boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 if p_event not in ('requested','confirmed','cancelled') or length(p_scope) not between 8 and 40 then raise exception 'INVALID_PREFERENCE'; end if;
 if p_scope<>'customer' and not exists(select 1 from public.business_members where business_id::text=p_scope and user_id=auth.uid()) then raise exception 'FORBIDDEN'; end if;
 insert into public.notification_preferences values(auth.uid(),p_scope,p_event,p_email,p_push)
 on conflict(user_id,scope,event) do update set email=excluded.email,push=excluded.push;
end $$;

create or replace function private.booking_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient record; nid uuid; kind text; heading text; detail text; scope_key text;
begin
 if TG_OP='UPDATE' and new.status=old.status then return new; end if;
 kind:=case
  when new.status='pending_merchant' then 'requested'
  when new.status='confirmed' then 'confirmed'
  when new.status in ('cancelled_by_customer','cancelled_by_merchant','expired','rejected','payment_failed') then 'cancelled'
 end;
 if kind is null then return new; end if;
 for recipient in
  select user_id uid,new.business_id bid from public.business_members where business_id=new.business_id
  union all
  select new.customer_id,null::uuid where kind<>'requested'
 loop
  scope_key:=coalesce(recipient.bid::text,'customer');
  heading:=case
   when kind='requested' then 'Nová rezervace čeká na potvrzení'
   when kind='confirmed' and recipient.bid is null then 'Tvůj FLEK je potvrzený'
   when kind='confirmed' then 'Rezervace je potvrzená'
   when new.status='rejected' and recipient.bid is null then 'Podnik rezervaci nepotvrdil'
   when new.status='expired' then 'Čas na potvrzení vypršel'
   else 'Rezervace byla zrušena'
  end;
  detail:=new.service_name_snapshot||' · '||to_char(new.start_at_snapshot at time zone 'Europe/Prague','DD.MM.YYYY HH24:MI')||' · 1 místo · '||new.business_name_snapshot||
   case when kind='requested' then ' · potvrďte do '||to_char(new.confirmation_expires_at at time zone 'Europe/Prague','HH24:MI') else '' end;
  nid:=null;
  insert into public.notifications(user_id,booking_id,business_id,event,title,body,href)
  values(recipient.uid,new.id,recipient.bid,kind,heading,detail,case when recipient.bid is null then '/rezervace' else '/partner/rezervace' end)
  on conflict do nothing returning id into nid;
  if nid is null then continue; end if;
  insert into private.notification_delivery(notification_id,channel,target)
  select nid,'email',u.email from auth.users u where u.id=recipient.uid and u.email_confirmed_at is not null and u.email not like '%@flek.test'
  and coalesce((select email from public.notification_preferences where user_id=recipient.uid and scope=scope_key and event=kind),true);
  insert into private.notification_delivery(notification_id,channel,target)
  select nid,'push',s.id::text from private.push_subscriptions s where s.user_id=recipient.uid
  and coalesce((select push from public.notification_preferences where user_id=recipient.uid and scope=scope_key and event=kind),false);
 end loop;
 perform private.kick_notification_delivery();
 return new;
end $$;
