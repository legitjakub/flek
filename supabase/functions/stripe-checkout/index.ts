import { appOrigin, caller, json, message, preflight, serviceClient, stripeClient, UUID } from '../_shared/stripe.ts';

/**
 * Opens (or reopens) the Stripe Checkout page for a payment the customer started with start_payment.
 * The amount, the business's connected account and FLEK's fee all come from the database, never
 * from the request: the only thing the browser says is which of its own payments to pay.
 */
Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  const who = await caller(request);
  if (!who) return json(request, { error: 'AUTH_REQUIRED' }, 401);
  const stripe = stripeClient();
  if (!stripe) return json(request, { error: 'PAYMENTS_NOT_CONFIGURED' }, 503);

  let paymentId = '';
  try {
    const body = await request.json();
    paymentId = typeof body.payment_id === 'string' ? body.payment_id : '';
  } catch {
    return json(request, { error: 'INVALID_REQUEST' }, 400);
  }
  if (!UUID.test(paymentId)) return json(request, { error: 'INVALID_REQUEST' }, 400);

  const db = serviceClient();
  const { data: payment } = await db.from('payments').select('*').eq('id', paymentId).maybeSingle();
  if (!payment || payment.customer_id !== who.user.id) return json(request, { error: 'NOT_FOUND' }, 404);
  if (payment.provider !== 'stripe') return json(request, { error: 'WRONG_PROVIDER' }, 409);
  if (payment.status === 'paid') return json(request, { state: 'paid' });
  if (payment.status !== 'pending') return json(request, { error: 'PAYMENT_CLOSED' }, 409);
  const manual = payment.confirmation_version === 1;
  if (manual) {
    const { data: context, error } = await db.rpc('confirmation_checkout_context', { p_payment_id: payment.id });
    if (error || !context?.allowed) return json(request, { error: 'PAYMENT_CLOSED' }, 409);
  }

  const { data: offer } = await db
    .from('offers')
    .select('id, start_at, deal_price_cents, service_fee_cents, services(name), businesses(display_name, stripe_account_id, stripe_charges_enabled)')
    .eq('id', payment.offer_id)
    .single();
  const business = offer?.businesses as unknown as { display_name: string; stripe_account_id: string | null; stripe_charges_enabled: boolean } | null;
  const service = offer?.services as unknown as { name: string } | null;
  if (!offer || !business || !service) return json(request, { error: 'OFFER_UNAVAILABLE' }, 409);
  if (!business.stripe_account_id || !business.stripe_charges_enabled) return json(request, { error: 'PAYMENTS_NOT_READY' }, 409);
  if (offer.deal_price_cents !== payment.amount_cents) return json(request, { error: 'PRICE_CHANGED' }, 409);

  try {
    if (payment.checkout_session_id) {
      const existing = await stripe.checkout.sessions.retrieve(payment.checkout_session_id);
      if (existing.status === 'complete') return json(request, { state: 'processing' });
      if (existing.status === 'open' && existing.amount_total === payment.amount_cents && existing.url) {
        return json(request, { url: existing.url, livemode: existing.livemode });
      }
      if (existing.status === 'open') await stripe.checkout.sessions.expire(existing.id).catch(() => null);
    }

    const origin = appOrigin(request);
    const when = new Intl.DateTimeFormat('cs-CZ', {
      weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague',
    }).format(new Date(offer.start_at));
    // Ten-minute buckets keep a retried request byte-identical, which idempotency requires.
    const bucket = Math.floor(Date.now() / 600_000);
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        locale: 'cs',
        customer_email: who.user.email ?? undefined,
        client_reference_id: payment.id,
        expires_at: (bucket + 6) * 600,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'czk',
            unit_amount: payment.amount_cents,
            product_data: { name: `${service.name} · ${when}`, description: `${business.display_name} · rezervace přes FLEK` },
          },
        }],
        payment_intent_data: {
          capture_method: manual ? 'manual' : undefined,
          application_fee_amount: offer.service_fee_cents,
          transfer_data: { destination: business.stripe_account_id },
          description: `FLEK · ${service.name} · ${business.display_name}`,
          receipt_email: who.user.email ?? undefined,
          metadata: { payment_id: payment.id, offer_id: payment.offer_id },
        },
        metadata: { payment_id: payment.id, offer_id: payment.offer_id },
        success_url: `${origin}/nabidka/${payment.offer_id}?platba=${payment.id}`,
        cancel_url: `${origin}/nabidka/${payment.offer_id}?platba=${payment.id}&zruseno=1`,
      },
      { idempotencyKey: `flek-checkout-${payment.id}-${payment.amount_cents}-${bucket}` },
    );

    await db
      .from('payments')
      .update({
        checkout_session_id: session.id,
        destination_account_id: business.stripe_account_id,
        application_fee_cents: offer.service_fee_cents,
        livemode: session.livemode,
      })
      .eq('id', payment.id)
      .eq('status', 'pending');

    return json(request, { url: session.url, livemode: session.livemode });
  } catch (error) {
    console.error('stripe-checkout', message(error));
    return json(request, { error: 'CHECKOUT_FAILED' }, 502);
  }
});
