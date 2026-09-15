import Stripe from 'npm:stripe@22.6.2';
import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';

export { Stripe };

/** Where Checkout and onboarding may send people back to. Anything else falls back to production. */
const APP_ORIGINS = [
  'https://www.app-flek.eu',
  'https://app-flek.eu',
  'https://flek-nine.vercel.app',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
];

export function appOrigin(request: Request): string {
  const origin = request.headers.get('Origin') ?? '';
  if (APP_ORIGINS.includes(origin)) return origin;
  return Deno.env.get('SITE_URL') ?? APP_ORIGINS[0];
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': APP_ORIGINS.includes(origin) ? origin : APP_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
}

export function preflight(request: Request): Response | null {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'METHOD_NOT_ALLOWED' }, 405);
  return null;
}

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

export function stripeClient(): Stripe | null {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return null;
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    appInfo: { name: 'FLEK' },
  });
}

export function isTestMode(): boolean {
  return (Deno.env.get('STRIPE_SECRET_KEY') ?? '').startsWith('sk_test_');
}

export const cryptoProvider = Stripe.createSubtleCryptoProvider();

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The signed-in person behind the request, with a client that acts as them (RLS applies). */
export async function caller(request: Request): Promise<{ user: User; client: SupabaseClient } | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { user: data.user, client };
}

export function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

type RefundOutcome = 'refunded' | 'pending' | 'failed';

/**
 * Writes Stripe's verdict on a refund to the payment. Only `succeeded` makes a payment refunded;
 * `pending` and `requires_action` keep it in the queue to be looked up again. `failed` or `canceled`
 * (even after an earlier success) puts the payment back to paid with the reason and leaves it to a
 * person: Stripe advises arranging another way to return the money rather than refunding the same
 * card again.
 */
export async function recordRefund(db: SupabaseClient, paymentId: string, refund: Stripe.Refund): Promise<RefundOutcome> {
  const { data, error } = await db.rpc('stripe_refund_update', {
    p_payment_id: paymentId,
    p_refund: refund.id,
    p_status: refund.status ?? 'pending',
    p_error: refund.failure_reason ?? null,
  });
  if (error) throw new Error(`stripe_refund_update: ${error.message}`);
  return data === 'refunded' ? 'refunded' : data === 'failed' ? 'failed' : 'pending';
}

/** The refund that decides a payment's state: a succeeded one if there is any, else the newest. */
export async function latestRefund(stripe: Stripe, paymentIntent: string): Promise<Stripe.Refund | null> {
  const refunds = await stripe.refunds.list({ payment_intent: paymentIntent, limit: 10 });
  return refunds.data.find((refund) => refund.status === 'succeeded') ?? refunds.data[0] ?? null;
}

/**
 * Returns requested refunds through Stripe. A destination charge refund also reverses the transfer
 * to the business and returns FLEK's fee, so the customer gets the whole amount back.
 *
 * A refund Stripe accepts is not money back yet, so each one is followed to its outcome: a pending
 * refund is looked up again on the next run, and one Stripe failed leaves the queue for a person.
 * Errors on the way to Stripe count as attempts; the idempotency key carries the attempt number, so
 * racing workers refund once per attempt and a retry after an error really asks Stripe again.
 */
export async function processRefunds(db: SupabaseClient, stripe: Stripe, limit = 20) {
  const { data: rows, error } = await db
    .from('payments')
    .select('id, payment_intent_id, refund_id, refund_status, refund_attempts')
    .eq('provider', 'stripe')
    .eq('status', 'paid')
    .not('refund_requested_at', 'is', null)
    .or('refund_status.is.null,refund_status.not.in.(failed,canceled)')
    .lt('refund_attempts', 8)
    .order('refund_requested_at')
    .limit(limit);
  if (error) throw error;

  const counts: Record<RefundOutcome, number> = { refunded: 0, pending: 0, failed: 0 };
  for (const row of rows ?? []) {
    if (!row.payment_intent_id) {
      await db.rpc('stripe_refund_failed', { p_payment_id: row.id, p_error: 'NO_PAYMENT_INTENT' });
      counts.failed += 1;
      continue;
    }
    try {
      const waiting = row.refund_id && (row.refund_status === 'pending' || row.refund_status === 'requires_action');
      const refund = waiting
        ? await stripe.refunds.retrieve(row.refund_id)
        : await stripe.refunds.create(
          {
            payment_intent: row.payment_intent_id,
            reverse_transfer: true,
            refund_application_fee: true,
            metadata: { payment_id: row.id },
          },
          { idempotencyKey: `flek-refund-${row.id}-${row.refund_attempts}` },
        );
      counts[await recordRefund(db, row.id, refund)] += 1;
    } catch (error) {
      try {
        const already = (error as { code?: string }).code === 'charge_already_refunded'
          ? await latestRefund(stripe, row.payment_intent_id)
          : null;
        if (already) {
          counts[await recordRefund(db, row.id, already)] += 1;
          continue;
        }
      } catch {
        // Fall through and record the original failure.
      }
      await db.rpc('stripe_refund_failed', { p_payment_id: row.id, p_error: message(error) });
      counts.failed += 1;
    }
  }
  return counts;
}

export type ConnectedAccount = Stripe.V2.Core.Account;

/** The parts of an Accounts v2 account that say what it may do. */
export const ACCOUNT_INCLUDE: ('configuration.recipient' | 'requirements')[] = ['configuration.recipient', 'requirements'];

/**
 * What a connected account may do. FLEK sells through destination charges, so a business can take
 * payments as soon as Stripe allows transfers to its account, and is paid out once Stripe also
 * allows payouts (a verified bank account).
 */
export function accountFlags(account: ConnectedAccount) {
  const balance = account.configuration?.recipient?.capabilities?.stripe_balance;
  const due = (account.requirements?.entries ?? []).filter((entry) =>
    entry.minimum_deadline?.status === 'currently_due' || entry.minimum_deadline?.status === 'past_due');
  return {
    charges: balance?.stripe_transfers?.status === 'active',
    payouts: balance?.payouts?.status === 'active',
    details: due.length === 0,
    due: due.map((entry) => entry.description ?? 'requirement'),
    reason: balance?.stripe_transfers?.status_details?.[0]?.code ?? null,
  };
}

export async function syncAccount(db: SupabaseClient, businessId: string, account: ConnectedAccount) {
  const flags = accountFlags(account);
  const { error } = await db.rpc('stripe_account_synced', {
    p_business_id: businessId,
    p_account: account.id,
    p_charges: flags.charges,
    p_payouts: flags.payouts,
    p_details: flags.details,
  });
  if (error) throw new Error(`stripe_account_synced: ${error.message}`);
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether asking Stripe again can change the answer. Card and request errors (a declined capture, a
 * PaymentIntent in the wrong state, a destination account that may not receive transfers) stay the
 * same however often they are retried; network errors, rate limits and Stripe's own 5xx do not.
 */
export function isPermanentStripeError(error: unknown): boolean {
  const type = (error as { type?: string })?.type ?? '';
  return type === 'StripeCardError' || type === 'StripeInvalidRequestError' || type === 'StripePermissionError';
}
