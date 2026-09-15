import { caller, isTestMode, json, message, preflight, serviceClient, stripeClient, UUID } from '../_shared/stripe.ts';

/**
 * Test mode only, demo accounts only: pays a started payment with Stripe's test card token
 * `pm_card_visa` (or `pm_card_refundFail`, `pm_card_chargeDeclined`), exactly like Checkout would, so
 * automated checks exercise the real Stripe path — authorisation or charge, application fee, transfer and
 * the webhook — without a browser form. A payment that waits for the merchant is authorised with manual
 * capture and captured later by booking-confirmation, never here.
 */
Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  const who = await caller(request);
  if (!who) return json(request, { error: 'AUTH_REQUIRED' }, 401);
  const stripe = stripeClient();
  if (!stripe) return json(request, { error: 'PAYMENTS_NOT_CONFIGURED' }, 503);
  if (!isTestMode() || !(who.user.email ?? '').endsWith('@flek.test')) return json(request, { error: 'FORBIDDEN' }, 403);

  let paymentId = '';
  let paymentMethod = 'pm_card_visa';
  try {
    const body = await request.json();
    paymentId = typeof body.payment_id === 'string' ? body.payment_id : '';
    // Stripe's test card whose refunds fail later, so checks can prove a failed refund is not "refunded",
    // and the card Stripe declines, so checks can prove a declined authorisation holds nothing.
    if (body.payment_method === 'pm_card_refundFail' || body.payment_method === 'pm_card_chargeDeclined') paymentMethod = body.payment_method;
  } catch {
    return json(request, { error: 'INVALID_REQUEST' }, 400);
  }
  if (!UUID.test(paymentId)) return json(request, { error: 'INVALID_REQUEST' }, 400);

  const db = serviceClient();
  const { data: payment } = await db.from('payments').select('*').eq('id', paymentId).maybeSingle();
  if (!payment || payment.customer_id !== who.user.id) return json(request, { error: 'NOT_FOUND' }, 404);
  if (payment.provider !== 'stripe' || payment.status !== 'pending') return json(request, { error: 'PAYMENT_CLOSED' }, 409);
  if (!payment.destination_account_id) return json(request, { error: 'PAYMENTS_NOT_READY' }, 409);
  // A payment that waits for the merchant is only authorised here, exactly as its Checkout page would do,
  // and only while its seat is still held for it.
  const manual = payment.confirmation_version === 1;
  if (manual) {
    const { data: context, error } = await db.rpc('confirmation_checkout_context', { p_payment_id: payment.id });
    if (error || !context?.allowed) return json(request, { error: 'PAYMENT_CLOSED' }, 409);
  }

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: payment.amount_cents,
        currency: 'czk',
        payment_method: paymentMethod,
        payment_method_types: ['card'],
        capture_method: manual ? 'manual' : 'automatic',
        confirm: true,
        application_fee_amount: payment.application_fee_cents ?? 0,
        transfer_data: { destination: payment.destination_account_id },
        description: 'FLEK · testovací platba',
        metadata: { payment_id: payment.id, offer_id: payment.offer_id, test: 'true' },
      },
      { idempotencyKey: `flek-testpay-${payment.id}-${payment.amount_cents}-${paymentMethod}-${manual ? 'manual' : 'automatic'}` },
    );
    return json(request, { status: intent.status, livemode: intent.livemode });
  } catch (error) {
    // A declined test card is an answer, not a failure of this helper.
    const code = (error as { code?: string }).code;
    if (code === 'card_declined') return json(request, { status: 'declined', livemode: false });
    return json(request, { error: 'TEST_PAYMENT_FAILED', detail: message(error) }, 502);
  }
});
