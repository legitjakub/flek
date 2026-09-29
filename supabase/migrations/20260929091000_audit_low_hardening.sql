/*
 * Drobnosti z auditu 28. 9. (nálezy L2, L4 a L5).
 *
 * L2: `stripe-refunds` šel spustit bez klíče a kdokoli tak mohl nechat FLEK opakovaně volat Stripe.
 *     Funkce teď chce klíč workeru jako `booking-confirmation` a databáze ho posílá; bez klíče ji nebudí.
 * L4: Admin mohl zrušit nabídku přes `merchant_cancel_offer` bez záznamu v auditu. Když ruší admin,
 *     který podnik nespravuje, zapíše se `offer_cancelled` ve stejné transakci. Jinak beze změny proti
 *     `20260914204208_manual_confirmation_fixes.sql`.
 * L5: `service_photos` měla pro anon a přihlášené INSERT, UPDATE, DELETE i TRUNCATE (na TRUNCATE RLS
 *     nepůsobí). Aplikace katalog fotek jen čte, zůstává jí SELECT.
 */

-- ------------------------------------------------------------------------------------------- L2

create or replace function private.kick_refunds() returns void
language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  if exists (select 1 from public.payments
             where provider = 'stripe' and status = 'paid' and refund_requested_at is not null and refund_attempts < 8
               and coalesce(refund_status, '') not in ('failed', 'canceled')) then
    select value into secret from private.notification_config where key = 'worker_secret';
    if secret is null then return; end if;
    perform net.http_post(
      url := private.setting('functions_url') || '/stripe-refunds',
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
      timeout_milliseconds := 10000);
  end if;
end $$;
revoke all on function private.kick_refunds() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------- L4

create or replace function public.merchant_cancel_offer(p_offer_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.offers; k public.bookings; c record;
begin
  select * into o from public.offers where id = p_offer_id;
  if o.id is null or not (public.is_member_of(o.business_id) or public.is_admin()) then raise exception 'FORBIDDEN'; end if;
  if length(trim(p_reason)) < 3 then raise exception 'VALIDATION_ERROR'; end if;
  for c in select distinct customer_id from public.bookings
    where offer_id = p_offer_id and status in ('pending_payment', 'pending_merchant', 'capturing', 'confirmed') order by customer_id loop
    perform 1 from public.profiles where id = c.customer_id for update;
  end loop;
  perform 1 from public.businesses where id = o.business_id for share;
  select * into o from public.offers where id = p_offer_id for update;
  if now() > o.start_at then raise exception 'OFFER_STARTED'; end if;
  if o.status = 'cancelled' then return; end if;
  update public.offers set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason, updated_at = now() where id = o.id;
  -- An admin who does not run the venue cancels on FLEK's behalf: that is an admin change and is audited.
  if not public.is_member_of(o.business_id) then
    perform private.audit('offer_cancelled', 'offer', o.id, jsonb_build_object('status', o.status, 'business_id', o.business_id),
      jsonb_build_object('status', 'cancelled'), p_reason);
  end if;
  for c in select id from public.bookings
    where offer_id = o.id and status in ('pending_payment', 'pending_merchant', 'capturing', 'confirmed') order by customer_id loop
    perform 1 from public.payments where id = (select payment_id from public.bookings where id = c.id) for update;
    select * into k from public.bookings where id = c.id for update;
    if k.status = 'confirmed' then
      perform private.refund_for_booking(k.id);
      update public.bookings set status = 'cancelled_by_merchant', cancelled_at = now(), cancellation_reason = p_reason where id = k.id;
    elsif k.status = 'capturing' then
      update public.bookings set cancellation_requested = true, cancellation_reason = p_reason where id = k.id;
      perform private.queue_release(k.payment_id, 'OFFER_CANCELLED');
    else
      perform private.release_hold_locked(k, 'cancelled_by_merchant', 'OFFER_CANCELLED', p_reason);
    end if;
  end loop;
  perform private.kick_confirmations();
  perform private.emit('offer_cancelled', jsonb_build_object('offer_id', o.id, 'business_id', o.business_id, 'reason', p_reason));
end $$;

-- ------------------------------------------------------------------------------------------- L5

revoke insert, update, delete, truncate, references, trigger on public.service_photos from anon, authenticated;
