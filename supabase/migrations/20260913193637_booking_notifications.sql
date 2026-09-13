-- Durable inbox and transactional delivery outbox. No historical reservations are replayed.
create table public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
 booking_id uuid not null references public.bookings, business_id uuid references public.businesses,
 event text not null check(event in ('confirmed','cancelled')), title text not null, body text not null,
 href text not null check(href in ('/rezervace','/partner/rezervace')),
 created_at timestamptz not null default now(), read_at timestamptz,
 constraint notifications_once unique nulls not distinct(user_id,booking_id,event,business_id),
 check(length(title) between 1 and 120), check(length(body) between 1 and 500)
);
create index notifications_user_time on public.notifications(user_id,created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
create table public.notification_preferences (
 user_id uuid not null references auth.users on delete cascade, scope text not null default 'customer',
 event text not null check(event in ('confirmed','cancelled')), email boolean not null default true, push boolean not null default false,
 primary key(user_id,scope,event), check(length(scope) between 8 and 40)
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;
create table private.push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
 endpoint text not null unique, subscription jsonb not null, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table private.notification_delivery (
 id uuid primary key default gen_random_uuid(), notification_id uuid not null references public.notifications on delete cascade,
 channel text not null check(channel in ('email','push')), target text not null,
 status text not null default 'pending' check(status in ('pending','processing','sent','failed','skipped')),
 attempts integer not null default 0, available_at timestamptz not null default now(), lease uuid,
 last_error text, sent_at timestamptz, unique(notification_id,channel,target)
);
create table private.notification_config (
 key text primary key, value text not null, updated_at timestamptz not null default now()
);
create index notification_delivery_ready on private.notification_delivery(available_at) where status in ('pending','processing');
alter table private.push_subscriptions enable row level security;
alter table private.notification_delivery enable row level security;
alter table private.notification_config enable row level security;
revoke all on private.push_subscriptions,private.notification_delivery,private.notification_config from public,anon,authenticated;

create function public.my_notifications() returns setof public.notifications language sql stable security definer set search_path='' as $$
 select n.* from public.notifications n where n.user_id=auth.uid() and
 (n.business_id is null or exists(select 1 from public.business_members m where m.business_id=n.business_id and m.user_id=auth.uid()))
 order by n.created_at desc limit 100;
$$;
create function public.read_notification(p_id uuid) returns void language sql security definer set search_path='' as $$
 update public.notifications set read_at=now() where id=p_id and user_id=auth.uid();
$$;
create function public.my_notification_preferences(p_scope text default 'customer') returns setof public.notification_preferences language sql stable security definer set search_path='' as $$
 select * from public.notification_preferences where user_id=auth.uid() and scope=p_scope;
$$;
create function public.save_notification_preference(p_scope text,p_event text,p_email boolean,p_push boolean) returns void language plpgsql security definer set search_path='' as $$
 begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 if p_event not in ('confirmed','cancelled') or length(p_scope) not between 8 and 40 then raise exception 'INVALID_PREFERENCE'; end if;
 if p_scope <> 'customer' and not exists(select 1 from public.business_members where business_id::text=p_scope and user_id=auth.uid()) then raise exception 'FORBIDDEN'; end if;
 insert into public.notification_preferences values(auth.uid(),p_scope,p_event,p_email,p_push)
 on conflict(user_id,scope,event) do update set email=excluded.email,push=excluded.push;
 end;
$$;
create function public.save_push_subscription(p_subscription jsonb) returns void language plpgsql security definer set search_path='' as $$
 declare endpoint_value text:=p_subscription->>'endpoint';
 begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 -- Limit outgoing Web Push requests to browser push services, never arbitrary URLs.
 if endpoint_value is null or endpoint_value !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/' or length(endpoint_value)>4096
 or length(coalesce(p_subscription#>>'{keys,p256dh}','')) not between 80 and 120
 or length(coalesce(p_subscription#>>'{keys,auth}','')) not between 20 and 40 then raise exception 'INVALID_SUBSCRIPTION'; end if;
 if (select count(*) from private.push_subscriptions where user_id=auth.uid())>=10 and not exists(select 1 from private.push_subscriptions s where s.endpoint=endpoint_value and s.user_id=auth.uid()) then raise exception 'DEVICE_LIMIT'; end if;
 insert into private.push_subscriptions(user_id,endpoint,subscription) values(auth.uid(),endpoint_value,p_subscription)
 on conflict(endpoint) do update set subscription=excluded.subscription,updated_at=now()
 where private.push_subscriptions.user_id=auth.uid();
 if not found then raise exception 'SUBSCRIPTION_OWNED_BY_ANOTHER_USER'; end if;
 end;
$$;
create function public.remove_push_subscription(p_endpoint text) returns void language sql security definer set search_path='' as $$
 delete from private.push_subscriptions where user_id=auth.uid() and endpoint=p_endpoint;
$$;

create function private.booking_notification() returns trigger language plpgsql security definer set search_path='' as $$
 declare recipient record; nid uuid; kind text; heading text; detail text; scope_key text;
 begin
 if TG_OP='UPDATE' and new.status=old.status then return new; end if;
 kind:=case when new.status='confirmed' then 'confirmed' when new.status in ('cancelled_by_customer','cancelled_by_merchant') then 'cancelled' end;
 if kind is null then return new; end if;
 for recipient in select new.customer_id as uid,null::uuid as bid union select user_id,new.business_id from public.business_members where business_id=new.business_id loop
 scope_key:=coalesce(recipient.bid::text,'customer');
 heading:=case when kind='cancelled' then 'Rezervace byla zrušena' when recipient.bid is null then 'Tvůj FLEK je rezervovaný' else 'Nová rezervace' end;
 detail:=new.service_name_snapshot || ' · ' || to_char(new.start_at_snapshot at time zone 'Europe/Prague','DD.MM.YYYY HH24:MI') || ' · 1 místo · ' || new.business_name_snapshot;
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
 end;
$$;
create trigger booking_notification after insert or update of status on public.bookings for each row execute function private.booking_notification();

create function public.claim_notification_deliveries(p_channels text[]) returns jsonb language plpgsql security definer set search_path='' as $$
 declare result jsonb;
 begin
 with eligible as (
 select id from private.notification_delivery where channel=any(p_channels) and status in ('pending','processing') and available_at<=now() and attempts<8 order by available_at for update skip locked limit 25
 ), claimed as (
 update private.notification_delivery d set status='processing',attempts=attempts+1,lease=gen_random_uuid(),available_at=now()+interval '5 minutes' from eligible e where d.id=e.id returning d.*
 ) select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('title',n.title,'body',n.body,'href',n.href,'subscription',s.subscription,
 'allowed', (n.business_id is null or exists(select 1 from public.business_members m where m.business_id=n.business_id and m.user_id=n.user_id)) and coalesce(case when c.channel='email' then p.email else p.push end,c.channel='email'))),'[]'::jsonb)
 into result from claimed c join public.notifications n on n.id=c.notification_id
 left join public.notification_preferences p on p.user_id=n.user_id and p.scope=coalesce(n.business_id::text,'customer') and p.event=n.event
 left join private.push_subscriptions s on c.channel='push' and s.id::text=c.target and s.user_id=n.user_id;
 return result;
 end;
$$;
create function public.finish_notification_delivery(p_id uuid,p_lease uuid,p_status text,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
 begin
 if p_status not in ('sent','pending','failed','skipped') then raise exception 'INVALID_STATUS'; end if;
 if p_status='skipped' and p_error in ('PUSH_HTTP_404','PUSH_HTTP_410') then
   delete from private.push_subscriptions where id::text=(select target from private.notification_delivery where id=p_id and lease=p_lease);
 end if;
 update private.notification_delivery set status=case when p_status='pending' and attempts>=8 then 'failed' else p_status end,
 last_error=left(p_error,200),sent_at=case when p_status='sent' then now() end,
 available_at=now()+least(interval '6 hours',interval '30 seconds'*power(2,attempts)),lease=null
 where id=p_id and lease=p_lease and status='processing';
 end;
$$;

-- A database cron drains the outbox. Its random bearer secret is added only during deployment,
-- never to this migration or the browser bundle. Until then the function is a harmless no-op.
create extension if not exists pg_net;
create extension if not exists pg_cron;
create function private.kick_notification_delivery() returns void language plpgsql security definer set search_path='' as $$
 declare worker_secret text;
 begin
 select value into worker_secret from private.notification_config where key='worker_secret';
 if worker_secret is null then return; end if;
 perform net.http_post(
   url:='https://yupkrntknbkvmlajwlph.supabase.co/functions/v1/notification-delivery',
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_secret),
   body:='{}'::jsonb,
   timeout_milliseconds:=15000
 );
 end;
$$;
select cron.schedule('flek-notification-delivery','* * * * *',$$select private.kick_notification_delivery()$$);
-- Explicit grants: no anonymous invocation, worker endpoints only service role.
revoke all on function public.my_notifications(),public.read_notification(uuid),public.my_notification_preferences(text),public.save_notification_preference(text,text,boolean,boolean),public.save_push_subscription(jsonb),public.remove_push_subscription(text) from public,anon;
grant execute on function public.my_notifications(),public.read_notification(uuid),public.my_notification_preferences(text),public.save_notification_preference(text,text,boolean,boolean),public.save_push_subscription(jsonb),public.remove_push_subscription(text) to authenticated;
revoke all on function public.claim_notification_deliveries(text[]),public.finish_notification_delivery(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_notification_deliveries(text[]),public.finish_notification_delivery(uuid,uuid,text,text) to service_role;
revoke all on function private.booking_notification() from public,anon,authenticated;
revoke all on function private.kick_notification_delivery() from public,anon,authenticated;
