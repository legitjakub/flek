import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { cryptoProvider, message, processRefunds, serviceClient, Stripe, stripeClient } from '../_shared/stripe.ts';

/**
 * Stripe's word on money. Every event is verified by signature, handled once (Stripe retries and may
 * deliver twice), and turned into the same database calls the app uses: a paid payment books its
 * seat, a payment that cannot book is refunded, an expired Checkout closes the payment.
 */
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const stripe = stripeClient();
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripe || !secret) return new Response('Payments are not configured', { status: 503 });

  const signature = request.headers.get('Stripe-Signature');
  if (!signature) return new Response('Missing signature', { status: 400 });
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, secret, undefined, cryptoProvider);
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

  const db = serviceClient();
  const { data: fresh, error } = await db.rpc('stripe_event_begin', {
    p_id: event.id, p_type: event.type, p_livemode: event.livemode,
  });
  if (error) return new Response('Storage unavailable', { status: 500 });
  if (!fresh) return Response.json({ received: true, duplicate: true });

  try {
    await handle(event, stripe, db);
    await db.rpc('stripe_event_finish', { p_id: event.id, p_error: null });
    return Response.json({ received: true });
  } catch (failure) {
    console.error('stripe-webhook', event.type, message(failure));
    await db.rpc('stripe_event_finish', { p_id: event.id, p_error: message(failure) });
    // A 500 makes Stripe deliver the event again later.
    return new Response('Processing failed', { status: 500 });
  }
});

async function handle(event: Stripe.Event, stripe: Stripe, db: SupabaseClient) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== 'paid') return;
      const paymentId = session.metadata?.payment_id ?? session.client_reference_id;
      const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      if (!paymentId || !intent) return;
      await paid(stripe, db, paymentId, intent, session.amount_total ?? 0, session.currency ?? '', event.livemode, session.id);
      return;
    }
    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent;
      const paymentId = intent.metadata?.payment_id;
      if (!paymentId) return;
      await paid(stripe, db, paymentId, intent.id, intent.amount_received, intent.currency, event.livemode, null);
      return;
    }
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      const paymentId = session.metadata?.payment_id ?? session.client_reference_id;
      if (paymentId) await rpc(db, 'stripe_checkout_expired', { p_payment_id: paymentId, p_session: session.id });
      return;
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (!intent || !charge.refunded) return;
      const { data: row } = await db.from('payments').select('id').eq('payment_intent_id', intent).maybeSingle();
      if (row) await rpc(db, 'stripe_refund_done', { p_payment_id: row.id, p_refund: null });
      return;
    }
    case 'account.updated': {
      const account = event.data.object as Stripe.Account;
      const businessId = account.metadata?.business_id;
      if (!businessId) return;
      await rpc(db, 'stripe_account_synced', {
        p_business_id: businessId, p_account: account.id,
        p_charges: account.charges_enabled, p_payouts: account.payouts_enabled, p_details: account.details_submitted,
      });
      return;
    }
    default:
      return;
  }
}

async function paid(stripe: Stripe, db: SupabaseClient, paymentId: string, intent: string, amount: number,
  currency: string, livemode: boolean, sessionId: string | null) {
  const { data: row } = await db.from('payments').select('id, payment_intent_id').eq('id', paymentId).maybeSingle();
  if (!row) return;
  if (row.payment_intent_id && row.payment_intent_id !== intent) {
    // A second charge for a payment that is already settled: nothing can be bought with it.
    await stripe.refunds.create(
      { payment_intent: intent, reverse_transfer: true, refund_application_fee: true, metadata: { payment_id: paymentId, reason: 'duplicate' } },
      { idempotencyKey: `flek-refund-duplicate-${intent}` },
    );
    return;
  }
  const result = await rpc(db, 'stripe_payment_succeeded', {
    p_payment_id: paymentId, p_intent: intent, p_amount: amount, p_currency: currency, p_livemode: livemode, p_session: sessionId,
  }) as { outcome?: string } | null;
  if (result?.outcome === 'refund') await processRefunds(db, stripe, 5);
}

async function rpc(db: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}
