-- A venue hears about its bookings on the phone without having to find the switch first: when a
-- member has never chosen for an event, push is on for them. It still needs a device the member
-- registered and allowed in the browser ("Povolit zvonění a oznámení"), so nothing reaches a phone
-- nobody switched on. Not about the venue's own answers (confirmed or declined by the venue, or an
-- offer it cancelled), the same line WhatsApp draws. Customers are unchanged: off until chosen.
-- Only the push default changes; the rest is the function as it runs in production.
create or replace function private.booking_notification()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare recipient record; nid uuid; event_kind text; heading text; detail text; scope_key text;
begin
  if TG_OP='UPDATE' and new.status=old.status then return new; end if;
  if new.confirmation_version=1 and new.authorized_at is null then return new; end if;

  if new.status='completed' then
    insert into public.notifications(user_id,booking_id,business_id,event,title,body,href)
    values(new.customer_id,new.id,null,'review_requested','Jaký byl tvůj FLEK?',
      new.service_name_snapshot||' · '||new.business_name_snapshot,
      '/rezervace?ohodnotit='||new.id::text)
    on conflict do nothing returning id into nid;
    if nid is not null then
      insert into private.notification_delivery(notification_id,channel,target)
      select nid,'push',s.id::text from private.push_subscriptions s
      where s.user_id=new.customer_id and coalesce((
        select push from public.notification_preferences
        where user_id=new.customer_id and scope='customer' and event='review_requested'
      ),false);
      perform private.kick_notification_delivery();
    end if;
    return new;
  end if;

  event_kind := case when new.status='pending_merchant' then 'requested' when new.status='confirmed' then 'confirmed'
    when new.status in ('cancelled_by_customer','cancelled_by_merchant','expired','rejected','payment_failed') then 'cancelled' end;
  if event_kind is null then return new; end if;
  for recipient in
    select user_id uid,new.business_id bid from public.business_members where business_id=new.business_id
    union all select new.customer_id,null::uuid where event_kind<>'requested'
      and not(new.confirmation_version=1 and new.confirmed_at is null and new.status='cancelled_by_customer')
  loop
    scope_key:=coalesce(recipient.bid::text,'customer');
    heading:=case when event_kind='requested' then 'Nová rezervace čeká na potvrzení'
      when event_kind='confirmed' and recipient.bid is null then 'Tvůj FLEK je potvrzený'
      when event_kind='confirmed' then 'Rezervace je potvrzená'
      when new.status='rejected' and recipient.bid is null then 'Podnik rezervaci nepotvrdil'
      when new.status='rejected' then 'Žádost o rezervaci byla odmítnuta'
      when new.status='expired' and recipient.bid is null then 'Čas na potvrzení vypršel'
      when new.status='expired' then 'Žádost o rezervaci vypršela'
      when new.status='payment_failed' and recipient.bid is null then 'Platbu se nepodařilo dokončit'
      when new.status='payment_failed' then 'Rezervaci se nepodařilo dokončit'
      when new.status='cancelled_by_customer' and new.confirmed_at is null and new.confirmation_version=1 then 'Zákazník žádost zrušil'
      else 'Rezervace byla zrušena' end;
    detail:=new.service_name_snapshot||' · '||to_char(new.start_at_snapshot at time zone 'Europe/Prague','DD.MM.YYYY HH24:MI')
      ||' · 1 místo · '||new.business_name_snapshot
      ||case when event_kind='requested' then ' · potvrďte do '||to_char(new.confirmation_expires_at at time zone 'Europe/Prague','HH24:MI') else '' end;
    nid:=null;
    insert into public.notifications(user_id,booking_id,business_id,event,title,body,href)
    values(recipient.uid,new.id,recipient.bid,event_kind,heading,detail,
      case when recipient.bid is null then '/rezervace' else '/partner/rezervace' end)
    on conflict do nothing returning id into nid;
    if nid is null then continue; end if;
    insert into private.notification_delivery(notification_id,channel,target)
    select nid,'email',u.email from auth.users u where u.id=recipient.uid and u.email_confirmed_at is not null
      and u.email not like '%@flek.test' and (recipient.bid is null or coalesce((select email from public.notification_preferences
        where user_id=recipient.uid and scope=scope_key and event=event_kind),true));
    insert into private.notification_delivery(notification_id,channel,target)
    select nid,'push',s.id::text from private.push_subscriptions s where s.user_id=recipient.uid
      and coalesce((select push from public.notification_preferences where user_id=recipient.uid and scope=scope_key and event=event_kind),
        recipient.bid is not null and new.status not in ('rejected','cancelled_by_merchant')
          and not(event_kind='confirmed' and new.merchant_decided_at is not null));
    insert into private.notification_delivery(notification_id,channel,target)
    select nid,'whatsapp',c.id::text from private.whatsapp_contacts c where c.status='verified'
      and case when recipient.bid is null then c.kind='customer' and c.user_id=recipient.uid and new.status<>'cancelled_by_customer'
        else c.kind='business' and c.business_id=new.business_id and c.consent_by=recipient.uid
          and new.status not in ('rejected','cancelled_by_merchant') and not(event_kind='confirmed' and new.merchant_decided_at is not null) end
      and coalesce((select whatsapp from public.notification_preferences where user_id=recipient.uid and scope=scope_key and event=event_kind),true);
  end loop;
  perform private.kick_notification_delivery();
  return new;
end $function$;
