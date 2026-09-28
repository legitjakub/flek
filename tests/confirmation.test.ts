import { describe, expect, it } from 'vitest';
import { capacityLabel } from '../src/components/CapacityLabel';
import { bookingMoneyState, confirmationView, customerBookingStatus, startsInLine, timeLeft, waitingLine } from '../src/features/bookings/confirmationView';
import type { BookingStatus } from '../src/types/database';
import { decisionMessage, isConfirmationRequest, visibleToMerchant } from '../src/features/merchant/ConfirmationRequests';

const facts = (extra: Record<string, unknown>) => ({
  status: 'pending', refund_requested: false, failure_reason: null, reservation_code: null, ...extra,
}) as Parameters<typeof confirmationView>[0];

describe('manual confirmation presentation', () => {
  it('shows the deadline from server timestamps rather than a local timeout', () => {
    expect(timeLeft('2026-09-14T17:05:00Z', '2026-09-14T17:00:42Z')).toEqual({ label: '4:18', clock: '04:18', seconds: 258 });
    expect(timeLeft('2026-09-14T17:00:41Z', '2026-09-14T17:00:42Z')).toEqual({ label: '0:00', clock: '00:00', seconds: 0 });
    expect(timeLeft(null, '2026-09-14T17:00:42Z')).toBeNull();
  });

  it('uses actual remaining inventory for natural Czech capacity text', () => {
    expect(capacityLabel(3, 3)).toBe('3 volná místa');
    expect(capacityLabel(2, 3)).toBe('2 volná místa');
    expect(capacityLabel(5, 6)).toBe('5 volných míst');
    expect(capacityLabel(1, 3)).toBe('Poslední místo');
    // A single-seat offer is not a "last seat", and a sold-out one says nothing.
    expect(capacityLabel(1, 1)).toBeNull();
    expect(capacityLabel(0, 3)).toBeNull();
  });
});

describe('what the customer is told', () => {
  it('waits for the venue with a countdown and explains a short window near the start', () => {
    const waiting = { confirmation_expires_at: '2026-09-14T17:05:00Z', start_at: '2026-09-14T19:00:00Z', authorized_at: '2026-09-14T17:00:00Z' };
    expect(waitingLine(waiting, '2026-09-14T17:00:42Z')).toBe('Podnik má na potvrzení ještě 4:18');
    const soon = { confirmation_expires_at: '2026-09-14T17:03:00Z', start_at: '2026-09-14T17:20:00Z', authorized_at: '2026-09-14T17:00:00Z' };
    expect(waitingLine(soon, '2026-09-14T17:01:18Z')).toBe('Tenhle FLEK začíná brzy, takže podnik má na potvrzení 1:42');
    expect(waitingLine(waiting, '2026-09-14T17:06:00Z')).toBe('Čas na potvrzení vypršel. Ověřujeme výsledek…');
  });

  it('maps every server state to one screen, and never promises a refund for money never taken', () => {
    expect(confirmationView(undefined).kind).toBe('verifying');
    expect(confirmationView(facts({ booking_status: 'pending_payment' })).kind).toBe('verifying');
    expect(confirmationView(facts({ booking_status: 'pending_payment' }), true)).toMatchObject({ kind: 'verifying', live: true, action: null });
    expect(confirmationView(facts({ booking_status: 'pending_merchant' }))).toMatchObject({ kind: 'waiting', live: true, action: 'cancel_request' });
    expect(confirmationView(facts({ booking_status: 'capturing' }))).toMatchObject({ kind: 'capturing', title: 'Potvrzujeme FLEK…', live: true });
    expect(confirmationView(facts({ status: 'paid', booking_status: 'confirmed', reservation_code: 'FLEK-ABC123' })))
      .toMatchObject({ kind: 'confirmed', title: '🔥 FLEK je tvůj!', body: 'Podnik rezervaci potvrdil.' });

    const released = [
      confirmationView(facts({ booking_status: 'rejected' })),
      confirmationView(facts({ booking_status: 'expired', authorized_at: '2026-09-14T17:00:00Z' })),
      confirmationView(facts({ booking_status: 'cancelled_by_customer' })),
      confirmationView(facts({ booking_status: 'cancelled_by_merchant' })),
    ];
    expect(released.map((view) => view.kind)).toEqual(['rejected', 'timeout', 'customer_cancelled', 'offer_cancelled']);
    for (const view of released) {
      expect(view.body).toContain('blokaci částky na kartě uvolňujeme');
      expect(view.body).not.toMatch(/vrac/i);
      expect(view.live).toBe(false);
    }
    expect(confirmationView(facts({ booking_status: 'rejected' })).title).toBe('Tentokrát to nevyšlo');
    expect(confirmationView(facts({ booking_status: 'expired' }))).toMatchObject({ kind: 'checkout_timeout', action: 'retry' });
  });

  it('tells a failed capture after the venue said yes apart from a card that never went through', () => {
    expect(confirmationView(facts({ booking_status: 'payment_failed', merchant_decided_at: '2026-09-14T17:02:00Z' })))
      .toMatchObject({ kind: 'capture_failed', title: 'Podnik potvrdil, ale platbu se nepodařilo dokončit' });
    expect(confirmationView(facts({ booking_status: 'payment_failed', failure_reason: 'CAPTURE_FAILED' })).kind).toBe('capture_failed');
    expect(confirmationView(facts({ booking_status: 'payment_failed' }))).toMatchObject({ kind: 'payment_failed', action: 'retry' });
  });

  it('speaks of a refund only when captured money has to go back', () => {
    const refund = confirmationView(facts({ status: 'paid', refund_requested: true }));
    expect(refund.kind).toBe('refunding');
    expect(refund.body).toMatch(/vracíme/);
  });
});

describe('what the venue is told', () => {
  it('counts down in minutes before the start, with urgency under half an hour', () => {
    expect(startsInLine('2026-09-14T17:34:00Z', '2026-09-14T17:00:00Z')).toEqual({ text: 'FLEK začíná za 34 minut', urgent: false });
    expect(startsInLine('2026-09-14T17:18:00Z', '2026-09-14T17:00:00Z')).toEqual({ text: '🔥 Začíná za 18 minut', urgent: true });
    expect(startsInLine('2026-09-14T17:03:00Z', '2026-09-14T17:00:00Z').text).toBe('🔥 Začíná za 3 minuty');
    expect(startsInLine('2026-09-14T21:00:00Z', '2026-09-14T17:00:00Z').text).toBe('FLEK začíná za 4 hodiny');
  });

  it('shows requests only once the customer authorised a payment, and keeps them out of the tabs', () => {
    expect(visibleToMerchant({ confirmation_version: 1, authorized_at: null, status: 'pending_payment' })).toBe(false);
    expect(visibleToMerchant({ confirmation_version: 1, authorized_at: null, status: 'expired' })).toBe(false);
    expect(visibleToMerchant({ confirmation_version: 1, authorized_at: '2026-09-14T17:00:00Z', status: 'pending_merchant' })).toBe(true);
    expect(visibleToMerchant({ confirmation_version: 0, authorized_at: null, status: 'confirmed' })).toBe(true);
    expect(isConfirmationRequest({ status: 'pending_merchant' })).toBe(true);
    expect(isConfirmationRequest({ status: 'capturing' })).toBe(true);
    expect(isConfirmationRequest({ status: 'confirmed' })).toBe(false);
  });

  it('reports what the server decided, not the button that was pressed', () => {
    const at = '2026-09-14T17:05:00Z';
    expect(decisionMessage({ status: 'capturing', decided: true, confirmation_expires_at: at }, true).tone).toBe('success');
    expect(decisionMessage({ status: 'rejected', decided: true, confirmation_expires_at: at }, false).text).toMatch(/nic nezaplatí/);
    // Pressed "Potvrdit" one second too late.
    expect(decisionMessage({ status: 'expired', decided: false, confirmation_expires_at: at }, true))
      .toEqual({ tone: 'warning', text: 'Na potvrzení už bylo pozdě. Žádost vypršela a místo se vrátilo do nabídky.' });
    expect(decisionMessage({ status: 'cancelled_by_customer', decided: false, confirmation_expires_at: at }, true).text).toBe('Zákazník žádost mezitím zrušil.');
    // Confirmed on WhatsApp a moment earlier.
    expect(decisionMessage({ status: 'capturing', decided: false, confirmation_expires_at: at }, false).tone).toBe('warning');
  });
});

describe('money regressions', () => {
  it('does not revive a completed or missed appointment through an old checkout URL', () => {
    for (const booking_status of ['completed', 'no_show']) {
      expect(confirmationView(facts({ status: 'paid', booking_status, reservation_code: 'FLEK-ABC123' })))
        .toMatchObject({ kind: 'past', live: false, action: 'bookings' });
    }
  });
  it('explains timeout release while waiting and reflects a completed release', () => {
    expect(confirmationView(facts({ booking_status: 'pending_merchant' })).body).toContain('Když nepotvrdí včas, blokaci uvolníme');
    expect(confirmationView(facts({ booking_status: 'rejected', authorization_state: 'released' })).body).toContain('Blokaci jsme uvolnili');
    expect(confirmationView(facts({ booking_status: 'payment_failed', failure_reason: 'CAPTURE_FAILED', authorization_state: 'released' })).body).not.toContain('uvolňujeme');
  });
  it('does not turn a historical reservation code into success after cancellation', () => {
    const cancelled = facts({ status: 'paid', booking_status: 'cancelled_by_customer', reservation_code: 'FLEK-ABC123', refund_requested: true });
    expect(confirmationView(cancelled)).toMatchObject({ kind: 'refunding', live: true });
    expect(confirmationView({ ...cancelled!, status: 'refunded' })).toMatchObject({ kind: 'refunded', live: false });
    expect(confirmationView({ ...cancelled!, refund_status: 'failed' }).body).not.toContain('celou vracíme');
  });
  it('never describes an unfinished release as completed or an authorization as paid', () => {
    const booking = { status: 'pending_merchant' as const, payment_status: 'pending' as const, authorization_state: 'authorized' as const };
    const text = (extra: Partial<Parameters<typeof bookingMoneyState>[0]>) => bookingMoneyState({ ...booking, ...extra })?.text;
    expect(text({})).toBe('Jen zablokováno');
    expect(text({ authorization_state: 'release_pending' })).toBe('Uvolňujeme blokaci');
    expect(text({ authorization_state: 'released' })).toBe('Blokace uvolněna');
    expect(text({ status: 'capturing' })).toBe('Dokončujeme platbu');
    expect(text({ status: 'confirmed', payment_status: 'paid', authorization_state: 'captured' })).toBe('Zaplaceno');
    expect(text({ status: 'cancelled_by_customer', payment_status: 'paid', authorization_state: 'captured' })).toBe('Vracíme');
    expect(text({ status: 'cancelled_by_customer', payment_status: 'refunded', authorization_state: 'captured' })).toBe('Vráceno');
    // A request that ended before any money moved has nothing left to verify.
    expect(text({ status: 'expired', authorization_state: 'none' })).toBe('Nic nestrženo');
    expect(text({ status: 'pending_payment', authorization_state: 'none' })).toBe('Ověřujeme platbu');
    // Nothing captured is ever called paid, whatever the booking says.
    for (const status of ['pending_payment', 'pending_merchant', 'capturing', 'rejected', 'expired'] as const) {
      for (const authorization_state of ['none', 'authorized', 'release_pending', 'released'] as const) {
        expect(text({ status, authorization_state })).not.toBe('Zaplaceno');
      }
    }
  });
});

describe('the customer\'s own booking card', () => {
  const statuses: BookingStatus[] = ['pending_payment', 'pending_merchant', 'capturing', 'confirmed', 'expired', 'rejected',
    'payment_failed', 'cancelled_by_customer', 'cancelled_by_merchant', 'completed', 'no_show'];
  it('gives every booking state exactly one label, spoken to the customer', () => {
    for (const status of statuses) {
      const { label } = customerBookingStatus({ status });
      expect(label.length).toBeGreaterThan(0);
      // The venue's words about the customer never reach the customer.
      expect(label).not.toMatch(/zákazník|Zamítnuto|Nedorazil/);
    }
    expect(customerBookingStatus({ status: 'cancelled_by_customer' }).label).toBe('Zrušeno na tvou žádost');
    expect(customerBookingStatus({ status: 'rejected' }).label).toBe('Podnik nemohl přijmout');
  });
  it('tells a venue that ran out of time apart from a payment never finished', () => {
    expect(customerBookingStatus({ status: 'expired', authorized_at: '2026-09-28T10:00:00Z' }).label).toBe('Podnik nestihl potvrdit');
    expect(customerBookingStatus({ status: 'expired', authorized_at: null }).label).toBe('Platba nedokončena');
  });
  it('never repeats the money line in the status', () => {
    for (const status of statuses) {
      const status_label = customerBookingStatus({ status, authorized_at: '2026-09-28T10:00:00Z' }).label;
      const money = bookingMoneyState({ status, payment_status: 'pending', authorization_state: 'authorized' })?.text;
      expect(status_label).not.toBe(money);
    }
  });
});
