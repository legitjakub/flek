/*
 * A refund Stripe itself failed or canceled goes to a person instead of being tried again.
 *
 * Stripe's guidance for a failed refund is to arrange another way to return the money: refunding the
 * same closed or lost card again only fails again, and a refund canceled because of a dispute must
 * not be repeated. So the payment returns to `paid` with the reason and leaves the refund queue.
 * Only errors on the way to Stripe (`stripe_refund_failed`) are still retried, up to eight times.
 *
 * Stripe never revives a failed or canceled refund, so any later news about that same refund, such
 * as an out-of-order `refund.created` or a slow worker's earlier `succeeded`, changes nothing. A new
 * refund made by a person (for example in the Stripe dashboard) is recorded normally.
 */

create or replace function public.stripe_refund_update(p_payment_id uuid, p_refund text, p_status text, p_error text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare pay public.payments;
begin
  if p_status not in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') then
    raise exception 'INVALID_REFUND_STATUS';
  end if;
  select * into pay from public.payments where id = p_payment_id and provider = 'stripe' for update;
  if pay.id is null then return 'unknown_payment'; end if;

  -- News about an older refund must not undo the outcome of the one that replaced it.
  if pay.refund_id is not null and p_refund is not null and pay.refund_id <> p_refund
     and pay.refund_status in ('pending', 'requires_action', 'succeeded') then
    return 'stale';
  end if;

  -- A failed or canceled refund stays that way.
  if pay.refund_id = p_refund and pay.refund_status in ('failed', 'canceled') then
    return 'failed';
  end if;

  if p_status = 'succeeded' then
    update public.payments
    set status = 'refunded', refunded_at = coalesce(refunded_at, now()), refund_id = coalesce(p_refund, refund_id),
        refund_status = 'succeeded', refund_error = null
    where id = pay.id and status in ('paid', 'refunded');
    return 'refunded';
  end if;

  if p_status in ('pending', 'requires_action') then
    update public.payments
    set refund_id = coalesce(p_refund, refund_id), refund_status = p_status, refund_error = null
    where id = pay.id and status = 'paid';
    return 'pending';
  end if;

  update public.payments
  set status = 'paid',
      refunded_at = null,
      refund_id = coalesce(p_refund, refund_id),
      refund_status = p_status,
      refund_error = left(coalesce(p_error, 'REFUND_' || upper(p_status)), 500)
  where id = pay.id and status in ('paid', 'refunded');
  perform private.emit('refund_failed', jsonb_build_object('payment_id', pay.id, 'refund_id', p_refund, 'status', p_status));
  return 'failed';
end $$;

revoke all on function public.stripe_refund_update(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.stripe_refund_update(uuid, text, text, text) to service_role;

-- The worker is only woken for refunds it can still do something about.
create or replace function private.kick_refunds() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.payments
             where provider = 'stripe' and status = 'paid' and refund_requested_at is not null and refund_attempts < 8
               and coalesce(refund_status, '') not in ('failed', 'canceled')) then
    perform net.http_post(
      url := private.setting('functions_url') || '/stripe-refunds',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000);
  end if;
end $$;
revoke all on function private.kick_refunds() from public, anon, authenticated;
