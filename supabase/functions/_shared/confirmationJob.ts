/**
 * The confirmation worker's decisions, kept apart from Stripe and the database so they can be tested.
 * The database says what state a job is in (`confirmation_job_state`); Stripe says what happened to the
 * money. These functions only map those answers to the next step.
 */

/** What to do with a capture job whose PaymentIntent is waiting to be captured. */
export type CaptureStep = 'capture' | 'give_up' | 'release' | 'skip';

export function captureStep(state: string | null | undefined): CaptureStep {
  switch (state) {
    case 'ready':
      return 'capture';
    // The appointment has started: too late to take the money, so the hold goes back.
    case 'started':
      return 'give_up';
    // The offer was cancelled, or the request already ended another way: release, never capture.
    case 'cancel_requested':
    case 'not_capturing':
      return 'release';
    // Another run took the job over (`lease_lost`), it is finished, or the database did not answer:
    // leave it alone. Whoever holds it now finishes it, or the job comes round again.
    default:
      return 'skip';
  }
}

export type CheckoutSnapshot = { status: string | null; payment_intent: string | null } | null;

/**
 * A release with no PaymentIntent recorded: FLEK let the request go before Stripe told it about any
 * authorisation. Only the Checkout page can say whether one exists.
 */
export type UnpaidCheckout = { step: 'released' } | { step: 'use_intent'; intent: string } | { step: 'retry' };

export function unpaidCheckoutStep(session: CheckoutSnapshot): UnpaidCheckout {
  // No page was ever opened, or it expired unpaid: nothing was authorised and nothing is held.
  if (!session || session.status === 'expired') return { step: 'released' };
  // The customer finished the page just before it closed: that authorisation is the one to release.
  if (session.status === 'complete' && session.payment_intent) return { step: 'use_intent', intent: session.payment_intent };
  // Still open (the expiry did not go through yet), or complete without an intent so far: ask again.
  return { step: 'retry' };
}
