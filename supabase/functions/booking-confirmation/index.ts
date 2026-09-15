import { isPermanentStripeError, message, serviceClient, Stripe, stripeClient } from '../_shared/stripe.ts';

type Job = {
  payment_id: string;
  lease: string;
  action: 'capture' | 'cancel';
  attempts: number;
  intent: string | null;
  session: string | null;
  booking_status: string;
  cancellation_requested: boolean;
  cancellation_reason: 'requested_by_customer' | 'abandoned';
  server_now: string;
};

/** After this many claims a capture that still fails is given up: the seat goes back and the hold is released. */
const MAX_ATTEMPTS = 8;

/**
 * Durable worker for merchant confirmation. The database owns the deadline, the seat and the decision;
 * Stripe owns the money. Every run reads the PaymentIntent again before acting, so a lost response, a
 * duplicate run or a webhook that got there first all end in the same state.
 *
 * Idempotency keys carry the attempt number, as the refund worker's do: Stripe replays the stored
 * result of a key, so a retry after a network error has to be a new request to really ask again.
 * Capturing twice or cancelling twice is impossible on Stripe's side regardless.
 */
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const db = serviceClient();
  const { data: allowed } = await db.rpc('notification_worker_authorized', { p_secret: secret });
  if (!allowed) return new Response('Unauthorized', { status: 401 });
  const stripe = stripeClient();
  if (!stripe) return new Response('Payments are not configured', { status: 503 });

  const { data, error } = await db.rpc('claim_confirmation_jobs');
  if (error) return new Response('Queue unavailable', { status: 500 });
  const jobs = (Array.isArray(data) ? data : []) as Job[];
  const result = { completed: 0, retrying: 0, capture_failed: 0 };

  for (const job of jobs) {
    let done = false;
    let failure: string | null = null;
    try {
      if (!job.intent) {
        // No authorisation exists yet. Close the Checkout page too, so a customer whose hold ran out
        // cannot still authorise money for a seat that is no longer theirs.
        if (job.action === 'cancel' && job.session) await expireSession(stripe, job.session);
        done = true;
      } else {
        let intent = await stripe.paymentIntents.retrieve(job.intent);
        if (job.action === 'capture' && intent.status === 'requires_capture') {
          const { data: ready } = await db.rpc('confirmation_job_ready', { p_payment_id: job.payment_id, p_lease: job.lease });
          if (ready === true) {
            try {
              intent = await stripe.paymentIntents.capture(intent.id, {}, { idempotencyKey: `flek-capture-${job.payment_id}-${job.attempts}` });
            } catch (captureError) {
              intent = await stripe.paymentIntents.retrieve(job.intent);
              if (intent.status === 'requires_capture' && (isPermanentStripeError(captureError) || job.attempts >= MAX_ATTEMPTS)) {
                await rpc(db, 'confirmation_capture_failed', { p_payment_id: job.payment_id, p_error: message(captureError) });
                result.capture_failed += 1;
                // The failure queued a release under a new lease; this lease is spent.
                continue;
              }
              if (intent.status === 'requires_capture') throw captureError;
            }
          } else {
            // The request moved on while the job waited (the offer was cancelled, the appointment started): release, never capture.
            const { data: state } = await db.from('bookings').select('status, cancellation_requested').eq('payment_id', job.payment_id).maybeSingle();
            if (state?.status === 'capturing' && !state.cancellation_requested) {
              await rpc(db, 'confirmation_capture_failed', { p_payment_id: job.payment_id, p_error: 'CAPTURE_NOT_ALLOWED' });
              result.capture_failed += 1;
              continue;
            }
            intent = await cancelIntent(stripe, intent, job);
          }
        } else if (job.action === 'cancel' && intent.status === 'requires_capture') {
          intent = await cancelIntent(stripe, intent, job);
        }

        if (intent.status === 'succeeded') {
          await observed(db, job, 'captured', intent.id, intent.amount_received);
          done = true;
        } else if (intent.status === 'canceled') {
          await observed(db, job, 'released', intent.id, 0);
          done = true;
        } else if (job.action === 'cancel' && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)) {
          // Never authorised: nothing is held on the card. Make sure the page cannot finish it later.
          if (job.session) await expireSession(stripe, job.session);
          await observed(db, job, 'released', intent.id, 0);
          done = true;
        } else {
          failure = `STRIPE_${intent.status.toUpperCase()}`;
        }
      }
    } catch (error) {
      // Unknown outcome: retried and reconciled by reading the PaymentIntent again. The seat stays held meanwhile.
      failure = message(error);
      if (job.action === 'capture' && job.attempts >= MAX_ATTEMPTS) {
        await db.rpc('confirmation_capture_failed', { p_payment_id: job.payment_id, p_error: failure });
        result.capture_failed += 1;
        continue;
      }
    }
    await db.rpc('finish_confirmation_job', { p_payment_id: job.payment_id, p_lease: job.lease, p_done: done, p_error: failure });
    if (done) result.completed += 1;
    else result.retrying += 1;
  }
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
});

async function cancelIntent(stripe: Stripe, intent: Stripe.PaymentIntent, job: Job): Promise<Stripe.PaymentIntent> {
  try {
    return await stripe.paymentIntents.cancel(
      intent.id,
      { cancellation_reason: job.cancellation_reason },
      { idempotencyKey: `flek-release-${job.payment_id}-${job.attempts}` },
    );
  } catch (error) {
    // Already cancelled or captured by someone else: the fresh state decides what happens next.
    const fresh = await stripe.paymentIntents.retrieve(intent.id);
    if (fresh.status === 'requires_capture') throw error;
    return fresh;
  }
}

async function expireSession(stripe: Stripe, sessionId: string) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === 'open') await stripe.checkout.sessions.expire(sessionId);
  } catch (error) {
    // A session that already completed or expired needs nothing; anything else is retried.
    if (!isPermanentStripeError(error)) throw error;
  }
}

async function observed(db: ReturnType<typeof serviceClient>, job: Job, outcome: 'captured' | 'released', intent: string, amount: number) {
  await rpc(db, 'confirmation_payment_observed', { p_payment_id: job.payment_id, p_outcome: outcome, p_intent: intent, p_amount: amount });
}

async function rpc(db: ReturnType<typeof serviceClient>, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}
