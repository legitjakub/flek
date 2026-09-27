import { describe, expect, it } from 'vitest';
import { countWord, freeSeatsWord, todaySummary } from '../src/features/merchant/dashboardStats';
import { dayBounds } from '../src/lib/time';
import type { BookingStatus, MerchantBooking } from '../src/types/database';

// Saturday 27. 9. 2026, 10:20 in Prague (CEST, UTC+2).
const NOW = '2026-09-27T08:20:00Z';
const day = dayBounds(NOW);
const booking = (start: string, status: BookingStatus, payout: number) =>
  ({ start_at_snapshot: start, status, merchant_payout_cents: payout }) as MerchantBooking;

describe('dashboard numbers', () => {
  it('uses the Czech form for each count, zero included', () => {
    expect([0, 1, 2, 4, 5, 22].map((n) => `${n} ${countWord(n, 'rezervace', 'rezervace', 'rezervací')}`)).toEqual([
      '0 rezervací',
      '1 rezervace',
      '2 rezervace',
      '4 rezervace',
      '5 rezervací',
      '22 rezervací',
    ]);
    expect([1, 3, 0, 7].map(freeSeatsWord)).toEqual(['volné místo', 'volná místa', 'volných míst', 'volných míst']);
  });

  it('counts the Prague day, not the UTC one', () => {
    const rows = [
      booking('2026-09-26T22:00:00Z', 'confirmed', 10000), // 00:00 on the 27th in Prague
      booking('2026-09-27T21:59:00Z', 'confirmed', 20000), // 23:59 on the 27th
      booking('2026-09-26T21:59:00Z', 'confirmed', 40000), // 23:59 the day before
      booking('2026-09-27T22:00:00Z', 'confirmed', 80000), // midnight into the 28th
    ];
    expect(todaySummary(rows, day)).toEqual({ count: 2, payoutCents: 30000 });
  });

  it('pays a no-show and a completed booking, not a request, a charge in progress or a cancellation', () => {
    const at = '2026-09-27T09:00:00Z';
    const rows = (['confirmed', 'completed', 'no_show', 'pending_payment', 'pending_merchant', 'capturing', 'cancelled_by_customer', 'cancelled_by_merchant', 'rejected', 'expired', 'payment_failed'] as BookingStatus[]).map(
      (status, index) => booking(at, status, (index + 1) * 10000),
    );
    expect(todaySummary(rows, day)).toEqual({ count: 3, payoutCents: 60000 });
  });

  it('is zero for an empty day', () => {
    expect(todaySummary([], day)).toEqual({ count: 0, payoutCents: 0 });
  });
});
