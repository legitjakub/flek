import { describe, expect, it } from 'vitest';
import { byDeadline, waitingFrom } from '../src/features/merchant/waitingRequests';
import { noticeLink } from '../src/features/notifications/noticeLink';
import type { MerchantBooking } from '../src/types/database';

const NOW = '2026-09-29T10:00:00Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function row(id: string, business: string, deadline: string, extra: Partial<MerchantBooking> = {}): MerchantBooking {
  return {
    id,
    business_id: business,
    confirmation_version: 1,
    status: 'pending_merchant',
    authorized_at: '2026-09-29T09:58:00Z',
    confirmation_expires_at: deadline,
    service_name_snapshot: 'Střih',
    start_at_snapshot: '2026-09-29T12:00:00Z',
    end_at_snapshot: '2026-09-29T13:00:00Z',
    customer_label: 'Jana N.',
    merchant_payout_cents: 75000,
    ...extra,
  } as MerchantBooking;
}

describe('requests across a person’s venues (scenario J)', () => {
  it('keeps only what still waits for this venue, most urgent first', () => {
    const rows = [
      row('late', A, '2026-09-29T10:08:00Z'),
      row('soon', A, '2026-09-29T10:03:00Z'),
      row('other-venue', B, '2026-09-29T10:01:00Z'),
      row('ran-out', A, '2026-09-29T09:59:59Z'),
      row('unpaid', A, '2026-09-29T10:05:00Z', { authorized_at: null }),
      row('decided', A, '2026-09-29T10:05:00Z', { status: 'capturing' }),
      row('old-flow', A, '2026-09-29T10:05:00Z', { confirmation_version: 0 }),
    ];
    expect(waitingFrom(rows, A, NOW).map((request) => request.id)).toEqual(['soon', 'late']);
    expect(waitingFrom(undefined, A, NOW)).toEqual([]);
  });

  it('names the venue only for a request of a venue that is not open', () => {
    const open = waitingFrom([row('a', A, '2026-09-29T10:05:00Z')], A, NOW);
    expect(open[0]).not.toHaveProperty('venue');
    expect(open[0]).not.toHaveProperty('businessId');
    const other = waitingFrom([row('b', B, '2026-09-29T10:05:00Z')], B, NOW, 'Salon Vinohrady');
    expect(other[0]).toMatchObject({ id: 'b', venue: 'Salon Vinohrady', businessId: B, payoutCents: 75000, customer: 'Jana N.' });
  });

  it('rings the most urgent request first, whichever venue it is for', () => {
    const open = waitingFrom([row('a', A, '2026-09-29T10:07:00Z')], A, NOW);
    const other = waitingFrom([row('b', B, '2026-09-29T10:02:00Z')], B, NOW, 'Salon Vinohrady');
    expect([...open, ...other].sort(byDeadline).map((request) => request.id)).toEqual(['b', 'a']);
  });
});

describe('where a notice opens', () => {
  it('leaves the customer’s and the open venue’s notices as they are', () => {
    expect(noticeLink('/rezervace', null, A)).toBe('/rezervace');
    expect(noticeLink('/partner/rezervace', A, A)).toBe('/partner/rezervace');
    expect(noticeLink('/partner/provozovna', A, A)).toBe('/partner/provozovna');
  });

  it('opens the venue a notice is about', () => {
    expect(noticeLink('/partner/rezervace', B, A)).toBe(`/partner/rezervace?provozovna=${B}`);
    expect(noticeLink('/partner/provozovna', B, A)).toBe(`/partner/provozovna?provozovna=${B}`);
    // New notices name their venue already; nothing is added twice.
    expect(noticeLink(`/partner/rezervace?provozovna=${B}`, B, A)).toBe(`/partner/rezervace?provozovna=${B}`);
  });
});
