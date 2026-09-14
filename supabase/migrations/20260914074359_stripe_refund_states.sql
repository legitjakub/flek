/*
 * Refunds follow Stripe's refund status instead of being assumed.
 *
 * A refund Stripe has accepted is not money back yet: it can stay `pending` or `requires_action`,
 * and a card refund can still fail days later. The payment turns `refunded` only on `succeeded`.
 * A refund that fails, even after it looked done, puts the payment back into the refund queue with
 * the error and one more attempt counted; after eight attempts a person has to look at it.
 */

alter table public.payments
  add column refund_status text check (refund_status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled'));

update public.payments set refund_status = 'succeeded' where provider = 'stripe' and status = 'refunded';

create function public.stripe_refund_update(p_payment_id uuid, p_refund text, p_status text, p_error text default null)
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
  set status = case when status = 'refunded' then 'paid'::public.payment_status else status end,
      refunded_at = null,
      refund_id = coalesce(p_refund, refund_id),
      refund_status = p_status,
      refund_requested_at = coalesce(refund_requested_at, now()),
      refund_attempts = refund_attempts + 1,
      refund_error = left(coalesce(p_error, 'REFUND_' || upper(p_status)), 500)
  where id = pay.id;
  perform private.emit('refund_failed', jsonb_build_object('payment_id', pay.id, 'refund_id', p_refund, 'status', p_status));
  return 'failed';
end $$;

revoke all on function public.stripe_refund_update(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.stripe_refund_update(uuid, text, text, text) to service_role;
