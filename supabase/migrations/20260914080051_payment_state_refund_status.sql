/*
 * The customer's view of a payment also says where its refund stands (`pending`, `succeeded`,
 * `failed`…), so a refund Stripe could not return is visible instead of looking like it is still
 * on its way.
 */

create or replace function public.my_payment_state(p_payment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pay public.payments; k record;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into pay from public.payments where id = p_payment_id and customer_id = auth.uid();
  if pay.id is null then raise exception 'NOT_FOUND'; end if;
  select id, reservation_code into k from public.bookings where payment_id = pay.id;
  return jsonb_build_object(
    'id', pay.id, 'offer_id', pay.offer_id, 'provider', pay.provider, 'status', pay.status,
    'amount_cents', pay.amount_cents, 'refund_requested', pay.refund_requested_at is not null,
    'refund_status', pay.refund_status,
    'failure_reason', pay.failure_reason, 'booking_id', k.id, 'reservation_code', k.reservation_code);
end $$;
