import { describe, expect, it } from 'vitest';
import { PAYMENT_ISSUE_TEXT, issueCountLabel, stripeDashboardUrl } from '../src/features/admin/paymentIssues';
import type { PaymentIssueKind } from '../src/types/database';

const KINDS: PaymentIssueKind[] = ['refund_failed', 'refund_stuck', 'refund_waiting', 'paid_without_booking', 'release_stuck', 'capture_stuck', 'webhook_failed'];

describe('payments that need a person', () => {
  it('names every kind the database lists and says what to do in Stripe or the logs', () => {
    for (const kind of KINDS) {
      expect(PAYMENT_ISSUE_TEXT[kind].title.length).toBeGreaterThan(5);
      expect(PAYMENT_ISSUE_TEXT[kind].action).toMatch(/Stripe|stripe-webhook/);
    }
  });

  it('opens the payment in the dashboard of the mode it was made in', () => {
    expect(stripeDashboardUrl({ kind: 'refund_failed', ref: 'x', payment_intent_id: 'pi_123', livemode: false }))
      .toBe('https://dashboard.stripe.com/test/payments/pi_123');
    expect(stripeDashboardUrl({ kind: 'release_stuck', ref: 'x', payment_intent_id: 'pi_456', livemode: true }))
      .toBe('https://dashboard.stripe.com/payments/pi_456');
  });

  it('opens a failed event among events, and nothing when there is no PaymentIntent', () => {
    expect(stripeDashboardUrl({ kind: 'webhook_failed', ref: 'evt_1', payment_intent_id: null, livemode: false }))
      .toBe('https://dashboard.stripe.com/test/events/evt_1');
    expect(stripeDashboardUrl({ kind: 'paid_without_booking', ref: 'x', payment_intent_id: null, livemode: false })).toBeNull();
  });

  it('counts in Czech', () => {
    expect(issueCountLabel(1)).toBe('1 platba k řešení');
    expect(issueCountLabel(3)).toBe('3 platby k řešení');
    expect(issueCountLabel(5)).toBe('5 plateb k řešení');
  });
});
