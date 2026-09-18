/*
 * Právní minimum, 3. část: povinné zprávy, odůvodnění, smazání účtu a doby uchování.
 *
 * - E-mail zákazníkovi o potvrzení, odmítnutí, vypršení a zrušení rezervace nejde vypnout: je to
 *   potvrzení smlouvy a informace o ní. Nese podrobnosti rezervace a údaje provozovatele.
 * - Podnik dostane zprávu s důvodem, když ho admin schválí, zamítne nebo pozastaví; zákazník, když mu
 *   admin zablokuje rezervace (důvod je povinný). Oznamovatel se dozví, jak jsme nahlášení vyřídili.
 * - Smazání účtu zákazníkem: osobní údaje zmizí i z přihlašování, rezervace a platby zůstanou bez nich.
 * - Doby uchování ze zásad ochrany osobních údajů jako denní úloha flek-retention.
 * - Staré analytické události ztratí identifikátor relace z prohlížeče.
 */

-- ----------------------------------------------------------------------------- notifications

-- A notice about an account (a venue's status, blocked bookings, a resolved report) has no booking.
alter table public.notifications alter column booking_id drop not null;
alter table public.notifications add constraint notifications_booking_link check ((event = 'account') = (booking_id is null));
alter table public.notifications drop constraint notifications_event_check;
alter table public.notifications add constraint notifications_event_check check (event in ('requested', 'confirmed', 'cancelled', 'account'));
alter table public.notifications drop constraint notifications_href_check;
alter table public.notifications add constraint notifications_href_check check (href in ('/rezervace', '/partner/rezervace', '/partner/provozovna', '/profil'));
-- A booking event is told once per person; account notices can repeat.
alter table public.notifications drop constraint notifications_once;
create unique index notifications_once on public.notifications (user_id, booking_id, event, business_id) nulls not distinct where event <> 'account';

create or replace function private.booking_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare recipient record; nid uuid; event_kind text; heading text; detail text; scope_key text;
begin
  if TG_OP = 'UPDATE' and new.status = old.status then return new; end if;
  -- A seat held for a Checkout that was never paid concerns nobody but the database.
  if new.confirmation_version = 1 and new.authorized_at is null then return new; end if;
  event_kind := case
    when new.status = 'pending_merchant' then 'requested'
    when new.status = 'confirmed' then 'confirmed'
    when new.status in ('cancelled_by_customer', 'cancelled_by_merchant', 'expired', 'rejected', 'payment_failed') then 'cancelled'
  end;
  if event_kind is null then return new; end if;
  for recipient in
    select user_id as uid, new.business_id as bid from public.business_members where business_id = new.business_id
    union all
    -- The customer hears about their own request's outcome, not about cancelling it themselves.
    select new.customer_id, null::uuid
    where event_kind <> 'requested' and not (new.confirmation_version = 1 and new.confirmed_at is null and new.status = 'cancelled_by_customer')
  loop
    scope_key := coalesce(recipient.bid::text, 'customer');
    heading := case
      when event_kind = 'requested' then 'Nová rezervace čeká na potvrzení'
      when event_kind = 'confirmed' and recipient.bid is null then 'Tvůj FLEK je potvrzený'
      when event_kind = 'confirmed' then 'Rezervace je potvrzená'
      when new.status = 'rejected' and recipient.bid is null then 'Podnik rezervaci nepotvrdil'
      when new.status = 'rejected' then 'Žádost o rezervaci byla odmítnuta'
      when new.status = 'expired' and recipient.bid is null then 'Čas na potvrzení vypršel'
      when new.status = 'expired' then 'Žádost o rezervaci vypršela'
      when new.status = 'payment_failed' and recipient.bid is null then 'Platbu se nepodařilo dokončit'
      when new.status = 'payment_failed' then 'Rezervaci se nepodařilo dokončit'
      when new.status = 'cancelled_by_customer' and new.confirmed_at is null and new.confirmation_version = 1 then 'Zákazník žádost zrušil'
      else 'Rezervace byla zrušena'
    end;
    detail := new.service_name_snapshot || ' · ' || to_char(new.start_at_snapshot at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI')
      || ' · 1 místo · ' || new.business_name_snapshot
      || case when event_kind = 'requested' then ' · potvrďte do ' || to_char(new.confirmation_expires_at at time zone 'Europe/Prague', 'HH24:MI') else '' end;
    nid := null;
    insert into public.notifications (user_id, booking_id, business_id, event, title, body, href)
    values (recipient.uid, new.id, recipient.bid, event_kind, heading, detail, case when recipient.bid is null then '/rezervace' else '/partner/rezervace' end)
    on conflict do nothing returning id into nid;
    if nid is null then continue; end if;
    -- The customer's e-mail confirms the contract or tells what happened to it: it always goes.
    insert into private.notification_delivery (notification_id, channel, target)
    select nid, 'email', u.email from auth.users u
    where u.id = recipient.uid and u.email_confirmed_at is not null and u.email not like '%@flek.test'
      and (recipient.bid is null
        or coalesce((select email from public.notification_preferences where user_id = recipient.uid and scope = scope_key and event = event_kind), true));
    insert into private.notification_delivery (notification_id, channel, target)
    select nid, 'push', s.id::text from private.push_subscriptions s
    where s.user_id = recipient.uid
      and coalesce((select push from public.notification_preferences where user_id = recipient.uid and scope = scope_key and event = event_kind), false);
    -- WhatsApp on a verified number, on by default: once per venue (the member who verified it) or to the customer.
    -- Nobody gets a WhatsApp about what they just did themselves: the venue's own confirmation, rejection or
    -- cancellation, or the customer's own cancellation. The app and e-mail still record it.
    insert into private.notification_delivery (notification_id, channel, target)
    select nid, 'whatsapp', c.id::text from private.whatsapp_contacts c
    where c.status = 'verified'
      and case when recipient.bid is null then c.kind = 'customer' and c.user_id = recipient.uid
                 and new.status <> 'cancelled_by_customer'
               else c.kind = 'business' and c.business_id = new.business_id and c.consent_by = recipient.uid
                 and new.status not in ('rejected', 'cancelled_by_merchant')
                 and not (event_kind = 'confirmed' and new.merchant_decided_at is not null) end
      and coalesce((select whatsapp from public.notification_preferences where user_id = recipient.uid and scope = scope_key and event = event_kind), true);
  end loop;
  perform private.kick_notification_delivery();
  return new;
end $$;

create or replace function public.claim_notification_deliveries(p_channels text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  with eligible as (
    select id from private.notification_delivery
    where channel = any(p_channels) and status in ('pending', 'processing') and available_at <= now() and attempts < 8
    order by available_at for update skip locked limit 25
  ), claimed as (
    update private.notification_delivery d
    set status = 'processing', attempts = attempts + 1, lease = gen_random_uuid(), available_at = now() + interval '5 minutes'
    from eligible e where d.id = e.id returning d.*
  )
  select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
    'title', n.title, 'body', n.body, 'href', n.href, 'event', n.event, 'subscription', s.subscription,
    'customer', n.business_id is null,
    'contract', case when c.channel = 'email' and n.business_id is null and n.booking_id is not null then private.booking_contract(n.booking_id) end,
    'operator', case when c.channel = 'email' then private.operator_details() end,
    'allowed', (n.business_id is null or exists (select 1 from public.business_members m where m.business_id = n.business_id and m.user_id = n.user_id))
      and case
        -- Messages about the customer's own contract and account are not a preference.
        when c.channel = 'email' and n.business_id is null then true
        when c.channel = 'email' then coalesce(p.email, true)
        else coalesce(p.push, false) end)), '[]'::jsonb)
  into result
  from claimed c
  join public.notifications n on n.id = c.notification_id
  left join public.notification_preferences p on p.user_id = n.user_id and p.scope = coalesce(n.business_id::text, 'customer') and p.event = n.event
  left join private.push_subscriptions s on c.channel = 'push' and s.id::text = c.target and s.user_id = n.user_id;
  return result;
end $$;

/** In-app notice plus e-mail about an account (a venue's status, blocked bookings, a resolved report). */
create function private.account_notice(p_user_id uuid, p_business_id uuid, p_title text, p_body text, p_href text) returns void
language plpgsql security definer set search_path = '' as $$
declare nid uuid;
begin
  insert into public.notifications (user_id, booking_id, business_id, event, title, body, href)
  values (p_user_id, null, p_business_id, 'account', left(p_title, 120), left(p_body, 500), p_href)
  returning id into nid;
  insert into private.notification_delivery (notification_id, channel, target)
  select nid, 'email', u.email from auth.users u
  where u.id = p_user_id and u.email_confirmed_at is not null and u.email not like '%@flek.test';
  perform private.kick_notification_delivery();
end $$;

/** A venue always learns that it went live, or why it was rejected or suspended. */
create function private.business_status_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m record; heading text; detail text; contact text := coalesce(private.setting('support_email'), 'e-mailu podpory FLEK');
begin
  if new.status is not distinct from old.status or new.status::text not in ('approved', 'rejected', 'suspended') then return new; end if;
  heading := case new.status::text
    when 'approved' then 'Provozovna je schválená'
    when 'rejected' then 'Registrace provozovny byla zamítnuta'
    else 'Provozovna je pozastavená' end;
  detail := case new.status::text
    when 'approved' then new.display_name || ' je schválená. Po propojení se Stripe můžete zveřejňovat FLEKy.'
    else new.display_name || ' · Důvod: ' || coalesce(nullif(btrim(new.status_reason), ''), 'neuveden') || ' · Ohradit se můžete na ' || contact || '.' end;
  for m in select user_id from public.business_members where business_id = new.id loop
    perform private.account_notice(m.user_id, new.id, heading, detail, '/partner/provozovna');
  end loop;
  return new;
end $$;
create trigger business_status_notice after update of status on public.businesses
  for each row execute function private.business_status_notice();

drop function public.admin_set_booking_block(uuid, boolean, boolean);
create function public.admin_set_booking_block(p_user_id uuid, p_blocked boolean, p_override_no_shows boolean default false, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare was record; now_row record; contact text := coalesce(private.setting('support_email'), 'e-mailu podpory FLEK');
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  -- Blocking someone needs a reason they are told.
  if p_blocked and coalesce(length(btrim(p_reason)), 0) < 3 then raise exception 'VALIDATION_ERROR'; end if;
  select booking_blocked, no_show_override_until into was from public.profiles where id = p_user_id for update;
  update public.profiles set booking_blocked = p_blocked,
    no_show_override_until = case when p_override_no_shows then now() + interval '60 days' else null end
  where id = p_user_id
  returning booking_blocked, no_show_override_until into now_row;
  if found then
    perform private.audit('booking_block_changed', 'user', p_user_id,
      jsonb_build_object('booking_blocked', was.booking_blocked, 'no_show_override_until', was.no_show_override_until),
      jsonb_build_object('booking_blocked', now_row.booking_blocked, 'no_show_override_until', now_row.no_show_override_until),
      nullif(btrim(p_reason), ''));
    if now_row.booking_blocked and not coalesce(was.booking_blocked, false) then
      perform private.account_notice(p_user_id, null, 'Rezervace na tvém účtu jsou pozastavené',
        'Důvod: ' || btrim(p_reason) || ' · Ohradit se můžeš na ' || contact || '.', '/profil');
    elsif not now_row.booking_blocked and coalesce(was.booking_blocked, false) then
      perform private.account_notice(p_user_id, null, 'Rezervace máš znovu povolené', 'Na tvém účtu už zase můžeš rezervovat FLEKy.', '/profil');
    end if;
  end if;
end $$;

create or replace function public.admin_resolve_content_report(p_report_id uuid, p_status text, p_resolution text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.content_reports;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('actioned', 'dismissed') or length(btrim(coalesce(p_resolution, ''))) < 3 then raise exception 'VALIDATION_ERROR'; end if;
  select * into r from public.content_reports where id = p_report_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'open' then raise exception 'ALREADY_RESOLVED'; end if;
  update public.content_reports set status = p_status, resolution = btrim(p_resolution), resolved_by = auth.uid(), resolved_at = now()
  where id = r.id;
  perform private.audit('content_report_resolved', 'content_report', r.id,
    jsonb_build_object('status', r.status), jsonb_build_object('status', p_status, 'business_id', r.business_id, 'offer_id', r.offer_id),
    p_resolution);
  -- The person who reported learns the outcome.
  if r.reporter_id is not null then
    perform private.account_notice(r.reporter_id, null, 'Tvoje nahlášení jsme vyřídili',
      case p_status when 'actioned' then 'Obsah jsme omezili. ' else 'Porušení pravidel jsme nezjistili. ' end || btrim(p_resolution), '/profil');
  end if;
end $$;

-- ------------------------------------------------------------------------ customer's own account

/**
 * Deletes the person and keeps the records the law requires: bookings and payments stay, attached to
 * an account without name, e-mail or phone that can never sign in again. A venue member or an admin
 * ends the account through support, because a venue and its customers depend on it.
 */
create function public.delete_my_account() returns text
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id = u for update;
  if exists (select 1 from public.business_members where user_id = u) then raise exception 'BUSINESS_MEMBER'; end if;
  if exists (select 1 from public.user_roles where user_id = u) then raise exception 'FORBIDDEN'; end if;
  if exists (select 1 from public.bookings where customer_id = u
             and status in ('pending_payment', 'pending_merchant', 'capturing', 'confirmed') and end_at_snapshot > now()) then
    raise exception 'ACTIVE_BOOKINGS';
  end if;

  delete from public.favorites where user_id = u;
  delete from private.push_subscriptions where user_id = u;
  delete from private.whatsapp_contacts where kind = 'customer' and user_id = u;
  delete from public.notification_preferences where user_id = u;
  delete from public.notifications where user_id = u;
  delete from public.referral_codes where user_id = u;
  update public.analytics_events set user_id = null where user_id = u;
  update public.content_reports set reporter_id = null where reporter_id = u;
  -- A venue still sees its past bookings, now under this name instead of the person's.
  update public.profiles set first_name = 'Smazaný', last_name = 'účet', phone = null, avatar_url = null, updated_at = now() where id = u;

  update auth.users set
    email = 'smazany-' || u::text || '@smazany.invalid',
    phone = null,
    encrypted_password = null,
    raw_user_meta_data = '{}'::jsonb,
    banned_until = '2999-01-01 00:00:00+00'::timestamptz,
    updated_at = now()
  where id = u;
  delete from auth.identities where user_id = u;
  delete from auth.mfa_factors where user_id = u;
  delete from auth.one_time_tokens where user_id = u;
  delete from auth.sessions where user_id = u;
  delete from auth.refresh_tokens where user_id = u::text;

  perform private.audit('account_deleted', 'user', u, null, null, 'Smazání účtu zákazníkem');
  return 'deleted';
end $$;

-- ---------------------------------------------------------------------------------- retention

/** The retention periods the privacy policy promises, every night. */
create function private.flek_retention() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.whatsapp_messages where created_at < now() - interval '90 days';
  delete from private.notification_delivery
  where status in ('sent', 'failed', 'skipped') and coalesce(sent_at, available_at) < now() - interval '90 days';
  delete from public.notifications where created_at < now() - interval '12 months';
  delete from public.content_reports where status <> 'open' and resolved_at < now() - interval '3 years';
  delete from cron.job_run_details where end_time < now() - interval '14 days';
end $$;
select cron.schedule('flek-retention', '40 3 * * *', 'select private.flek_retention()');

-- Browser-made session identifiers from before; server events keep their 'server' label.
update public.analytics_events set session_id = null where session_id is not null and session_id <> 'server';

-- ------------------------------------------------------------------------------------ grants

revoke all on function private.account_notice(uuid, uuid, text, text, text), private.business_status_notice(), private.flek_retention()
  from public, anon, authenticated;
revoke all on function public.admin_set_booking_block(uuid, boolean, boolean, text), public.delete_my_account() from public, anon;
grant execute on function public.admin_set_booking_block(uuid, boolean, boolean, text), public.delete_my_account() to authenticated;
