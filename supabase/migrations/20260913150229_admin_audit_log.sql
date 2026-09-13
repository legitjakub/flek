/*
 * Admin audit log.
 *
 * Analytics answer "what do people click"; this answers "who changed what, when, from what to
 * what". Every admin mutation writes one row in the same transaction as the change itself, so a
 * change without a record cannot exist. Rows cannot be updated, deleted or truncated. Clients have
 * no grant on the table; admins read it through admin_audit_log(). The actor is stored as a plain
 * id rather than a foreign key: deleting an account must not rewrite history.
 */
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (length(action) between 1 and 80),
  target_type text not null check (length(target_type) between 1 and 40),
  target_id uuid,
  before jsonb,
  after jsonb,
  reason text check (length(coalesce(reason, '')) <= 500)
);
create index admin_audit_log_recent on public.admin_audit_log (occurred_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;

create function private.audit_log_is_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'AUDIT_LOG_IMMUTABLE';
end $$;
create trigger admin_audit_log_no_change before update or delete on public.admin_audit_log
  for each row execute function private.audit_log_is_append_only();
create trigger admin_audit_log_no_truncate before truncate on public.admin_audit_log
  for each statement execute function private.audit_log_is_append_only();

create function private.audit(p_action text, p_target_type text, p_target_id uuid,
  p_before jsonb, p_after jsonb, p_reason text default null) returns void
language sql set search_path = public as $$
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, before, after, reason)
  values (auth.uid(), p_action, p_target_type, p_target_id, p_before, p_after, left(p_reason, 500));
$$;
revoke all on function private.audit_log_is_append_only(), private.audit(text, text, uuid, jsonb, jsonb, text)
  from public, anon, authenticated;

create or replace function public.admin_set_business_status(p_business_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare o record; k record; previous public.business_status; previous_reason text;
  offers_cancelled integer := 0; bookings_refunded integer := 0;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('pending','approved','rejected','suspended') then raise exception 'VALIDATION_ERROR'; end if;
  if p_status in ('rejected','suspended') and coalesce(length(trim(p_reason)),0) < 3 then raise exception 'VALIDATION_ERROR'; end if;
  select status, status_reason into previous, previous_reason from public.businesses where id = p_business_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.businesses set status = p_status::public.business_status, status_reason = p_reason, updated_at = now() where id = p_business_id;
  if p_status = 'approved' and previous is distinct from 'approved' then
    perform private.emit('business_approved', jsonb_build_object('business_id', p_business_id));
  end if;
  if p_status <> 'approved' then
    for o in select id from public.offers where business_id = p_business_id and start_at > now() and status = 'published' order by id for update loop
      update public.offers set status = 'cancelled', cancelled_at = now(), cancellation_reason = coalesce(p_reason, 'Provozovna není dostupná.'), updated_at = now() where id = o.id;
      offers_cancelled := offers_cancelled + 1;
      for k in select id from public.bookings where offer_id = o.id and status = 'confirmed' for update loop
        update public.bookings set status = 'cancelled_by_merchant', cancelled_at = now(), cancellation_reason = coalesce(p_reason, 'Provozovna není dostupná.') where id = k.id;
        perform private.refund_for_booking(k.id);
        bookings_refunded := bookings_refunded + 1;
      end loop;
      perform private.emit('offer_cancelled', jsonb_build_object('offer_id', o.id, 'business_id', p_business_id));
    end loop;
  end if;
  perform private.audit('business_status_changed', 'business', p_business_id,
    jsonb_build_object('status', previous, 'status_reason', previous_reason),
    jsonb_build_object('status', p_status, 'status_reason', p_reason,
      'offers_cancelled', offers_cancelled, 'bookings_refunded', bookings_refunded),
    p_reason);
end $$;

create or replace function public.admin_set_booking_block(p_user_id uuid, p_blocked boolean, p_override_no_shows boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare was record; now_row record;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select booking_blocked, no_show_override_until into was from public.profiles where id = p_user_id for update;
  update public.profiles set booking_blocked = p_blocked,
    no_show_override_until = case when p_override_no_shows then now() + interval '60 days' else null end
  where id = p_user_id
  returning booking_blocked, no_show_override_until into now_row;
  if found then
    perform private.audit('booking_block_changed', 'user', p_user_id,
      jsonb_build_object('booking_blocked', was.booking_blocked, 'no_show_override_until', was.no_show_override_until),
      jsonb_build_object('booking_blocked', now_row.booking_blocked, 'no_show_override_until', now_row.no_show_override_until));
  end if;
end $$;

create or replace function public.admin_set_google_place_id(p_business_id uuid, p_place_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare normalized text := nullif(trim(p_place_id), ''); previous text;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select google_place_id into previous from public.businesses where id = p_business_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if normalized is not null and (length(normalized) not between 10 and 255 or normalized ~ '[[:space:]]') then
    raise exception 'INVALID_GOOGLE_PLACE_ID';
  end if;
  update public.businesses set google_place_id = normalized, updated_at = now() where id = p_business_id;
  if previous is distinct from normalized then
    perform private.audit('google_place_id_changed', 'business', p_business_id,
      jsonb_build_object('google_place_id', previous), jsonb_build_object('google_place_id', normalized));
  end if;
end $$;

create function public.admin_audit_log(p_limit integer default 100)
returns table (id bigint, occurred_at timestamptz, actor_email text, action text, target_type text,
  target_id uuid, target_label text, before jsonb, after jsonb, reason text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return query
    select l.id, l.occurred_at, u.email::text, l.action, l.target_type, l.target_id,
      coalesce(b.display_name, tu.email::text), l.before, l.after, l.reason
    from public.admin_audit_log l
    left join auth.users u on u.id = l.actor_id
    left join public.businesses b on l.target_type = 'business' and b.id = l.target_id
    left join auth.users tu on l.target_type = 'user' and tu.id = l.target_id
    order by l.occurred_at desc, l.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;
revoke all on function public.admin_audit_log(integer) from public, anon;
grant execute on function public.admin_audit_log(integer) to authenticated;
