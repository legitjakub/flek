-- Preserve an existing WhatsApp choice when an older four-argument client updates
-- only e-mail and push. Review reminders deliberately remain push-only.
create or replace function public.save_notification_preference(
  p_scope text,p_event text,p_email boolean,p_push boolean,p_whatsapp boolean default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_event not in ('requested','confirmed','cancelled','review_requested') or length(p_scope) not between 8 and 40 then
    raise exception 'INVALID_PREFERENCE';
  end if;
  if p_event='review_requested' and p_scope<>'customer' then raise exception 'INVALID_PREFERENCE'; end if;
  if p_scope<>'customer' and not exists (
    select 1 from public.business_members where business_id::text=p_scope and user_id=auth.uid()
  ) then raise exception 'FORBIDDEN'; end if;
  insert into public.notification_preferences(user_id,scope,event,email,push,whatsapp)
  values(auth.uid(),p_scope,p_event,
    case when p_event='review_requested' then false else p_email end,
    p_push,
    case when p_event='review_requested' then false else coalesce(p_whatsapp,true) end)
  on conflict(user_id,scope,event) do update set
    email=excluded.email,push=excluded.push,
    whatsapp=case when p_event='review_requested' then false
      else coalesce(p_whatsapp,public.notification_preferences.whatsapp) end;
end $$;
