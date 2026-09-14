import { message, serviceClient, stripeClient } from '../_shared/stripe.ts';

type Job = {
  payment_id: string;
  lease: string;
  action: 'capture' | 'cancel';
  intent: string | null;
  booking_status: string;
  capture_before: string;
  cancellation_requested: boolean;
  server_now: string;
};

/** Durable worker for manual capture. The database owns the deadline and seat; Stripe owns money. */
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
  const result = { completed: 0, retrying: 0 };

  for (const job of jobs) {
    let done = false;
    let failure: string | null = null;
    try {
      if (!job.intent) {
        // A Checkout abandoned before card authorisation has no money to release.
        done = true;
      } else {
        let intent = await stripe.paymentIntents.retrieve(job.intent);
        if (job.action === 'capture') {
          const { data: ready } = await db.rpc('confirmation_job_ready', { p_payment_id: job.payment_id, p_lease: job.lease });
          if (!ready) {
            if (intent.status === 'requires_capture') intent = await stripe.paymentIntents.cancel(intent.id);
          } else if (intent.status === 'requires_capture') {
            intent = await stripe.paymentIntents.capture(intent.id, {}, { idempotencyKey: `flek-capture-${job.payment_id}` });
          }
        } else if (intent.status === 'requires_capture') {
          intent = await stripe.paymentIntents.cancel(intent.id);
        }

        if (intent.status === 'succeeded') {
          await observed(db, job, 'captured', intent.id, intent.amount_received);
          done = true;
        } else if (intent.status === 'canceled' || intent.status === 'requires_payment_method') {
          await observed(db, job, 'released', intent.id, 0);
          done = true;
        } else {
          failure = `STRIPE_${intent.status.toUpperCase()}`;
        }
      }
    } catch (error) {
      // Unknown network outcomes are retried and reconciled by retrieving the PaymentIntent.
      // Capacity remains held while the result is unknown.
      failure = message(error);
    }
    await db.rpc('finish_confirmation_job', {
      p_payment_id: job.payment_id, p_lease: job.lease, p_done: done, p_error: failure,
    });
    if (done) result.completed += 1;
    else result.retrying += 1;
  }
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
});

async function observed(db: ReturnType<typeof serviceClient>, job: Job, outcome: 'captured' | 'released', intent: string, amount: number) {
  const { error } = await db.rpc('confirmation_payment_observed', {
    p_payment_id: job.payment_id, p_outcome: outcome, p_intent: intent, p_amount: amount,
  });
  if (error) throw new Error(`confirmation_payment_observed: ${error.message}`);
}
