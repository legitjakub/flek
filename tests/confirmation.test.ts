import { describe, expect, it } from 'vitest';
import { capacityLabel } from '../src/components/CapacityLabel';
import { confirmationView, startsInLine, timeLeft, waitingLine } from '../src/features/bookings/confirmationView';
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
    expect(waitingLine(waiting, '2026-09-14T17:06:00Z')).toBe('Čas na potvrzení vypršel. Uvolňujeme blokaci…');
  });

  it('maps every server state to one screen, and never promises a refund for money never taken', () => {
    expect(confirmationView(undefined).kind).toBe('verifying');
    expect(confirmationView(facts({ booking_status: 'pending_payment' })).kind).toBe('verifying');
    expect(confirmationView(facts({ booking_status: 'pending_payment' }), true)).toMatchObject({ kind: 'not_finished', action: 'retry' });
    expect(confirmationView(facts({ booking_status: 'pending_merchant' }))).toMatchObject({ kind: 'waiting', live: true, action: 'cancel_request' });
    expect(confirmationView(facts({ booking_status: 'capturing' }))).toMatchObject({ kind: 'capturing', title: 'Potvrzujeme FLEK…', live: true });
    expect(confirmationView(facts({ booking_status: 'confirmed', reservation_code: 'FLEK-ABC123' })))
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
