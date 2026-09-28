import { caller, isTestMode, json, message, preflight, Stripe, stripeClient } from '../_shared/stripe.ts';

/**
 * Keeps the platform webhook subscribed to every event `stripe-webhook` needs, so nobody has to
 * click through the Stripe Dashboard. Admins only. It never creates an endpoint and never touches
 * its signing secret: it finds the endpoint that points at this project's `stripe-webhook` and adds
 * the event types that are missing. `{ "dry_run": true }` only reports. The answer carries the mode,
 * the endpoint's URL and events, never a key.
 *
 * The Connect endpoint for the businesses' accounts is created by a person in the Stripe Dashboard on
 * `…/stripe-webhook?connect=1` (its signing secret goes to STRIPE_CONNECT_WEBHOOK_SECRET). The distinct URL
 * keeps the two apart here; this function only reports it and, when it exists, keeps `account.updated` on.
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
] as const;

/** What the Connect endpoint needs: the businesses' account status. */
const CONNECT_EVENTS = ['account.updated'] as const;

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
  const connectTarget = `${target}?connect=1`;
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const endpoint = endpoints.data.find((candidate) => candidate.url === target);
    const connect = endpoints.data.find((candidate) => candidate.url === connectTarget);
    const connectReport = {
      url: connectTarget,
      found: Boolean(connect),
      status: connect?.status ?? null,
      missing: connect ? missingEvents(connect.enabled_events, CONNECT_EVENTS) : [...CONNECT_EVENTS],
      secret_configured: Boolean(Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')),
    };
    if (!endpoint) {
      return json(request, { error: 'ENDPOINT_NOT_FOUND', test_mode: isTestMode(), urls: endpoints.data.map((candidate) => candidate.url), connect: connectReport }, 404);
    }
    const current: string[] = endpoint.enabled_events;
    const missing = missingEvents(current, REQUIRED_EVENTS);
    if (body.dry_run || (!missing.length && !(connect && connectReport.missing.length))) {
      return json(request, { test_mode: isTestMode(), url: endpoint.url, status: endpoint.status, missing, events: current, changed: false, connect: connectReport });
    }
    const updated = missing.length
      ? await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: [...current, ...missing] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[] })
      : endpoint;
    if (connect && connectReport.missing.length) {
      await stripe.webhookEndpoints.update(connect.id, {
        enabled_events: [...connect.enabled_events, ...connectReport.missing] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
      });
    }
    console.log('stripe-webhook-setup added', [...missing, ...(connect ? connectReport.missing : [])].join(','));
    return json(request, {
      test_mode: isTestMode(), url: updated.url, status: updated.status, added: missing, events: updated.enabled_events, changed: true,
      connect: { ...connectReport, added: connect ? connectReport.missing : [], missing: [] },
    });
  } catch (error) {
    console.error('stripe-webhook-setup', message(error));
    return json(request, { error: 'STRIPE_REQUEST_FAILED', detail: message(error) }, 502);
  }
});

function missingEvents(current: string[], required: readonly string[]): string[] {
  return current.includes('*') ? [] : required.filter((event) => !current.includes(event));
}
