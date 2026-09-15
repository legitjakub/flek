import { caller, isTestMode, json, message, preflight, stripeClient } from '../_shared/stripe.ts';

/**
 * Keeps the platform webhook subscribed to every event `stripe-webhook` needs, so nobody has to
 * click through the Stripe Dashboard. Admins only. It never creates an endpoint and never touches
 * its signing secret: it finds the endpoint that points at this project's `stripe-webhook` and adds
 * the event types that are missing. `{ "dry_run": true }` only reports. The answer carries the mode,
 * the endpoint's URL and events, never a key.
 */
const REQUIRED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  // Manual confirmation: the authorisation, its release and a failed one.
  'payment_intent.amount_capturable_updated',
  'payment_intent.canceled',
  'payment_intent.payment_failed',
  'charge.refunded',
  'refund.created',
  'refund.updated',
  'refund.failed',
];

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  const who = await caller(request);
  if (!who) return json(request, { error: 'AUTH_REQUIRED' }, 401);
  const { data: admin } = await who.client.rpc('is_admin');
  if (admin !== true) return json(request, { error: 'FORBIDDEN' }, 403);
  const stripe = stripeClient();
  if (!stripe) return json(request, { error: 'PAYMENTS_NOT_CONFIGURED' }, 503);

  const body = await request.json().catch(() => ({})) as { dry_run?: boolean };
  const target = `${Deno.env.get('SUPABASE_URL')}/functions/v1/stripe-webhook`;
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const endpoint = endpoints.data.find((candidate: { url: string }) => candidate.url === target);
    if (!endpoint) {
      return json(request, { error: 'ENDPOINT_NOT_FOUND', test_mode: isTestMode(), urls: endpoints.data.map((candidate: { url: string }) => candidate.url) }, 404);
    }
    const current: string[] = endpoint.enabled_events;
    const missing = current.includes('*') ? [] : REQUIRED_EVENTS.filter((event) => !current.includes(event));
    if (body.dry_run || !missing.length) {
      return json(request, { test_mode: isTestMode(), url: endpoint.url, status: endpoint.status, missing, events: current, changed: false });
    }
    const updated = await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: [...current, ...missing] });
    console.log('stripe-webhook-setup added', missing.join(','));
    return json(request, { test_mode: isTestMode(), url: updated.url, status: updated.status, added: missing, events: updated.enabled_events, changed: true });
  } catch (error) {
    console.error('stripe-webhook-setup', message(error));
    return json(request, { error: 'STRIPE_REQUEST_FAILED', detail: message(error) }, 502);
  }
});
