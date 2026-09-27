import type { BookingStatus, MerchantBooking } from '../../types/database';

/** Czech count forms: 1 → one, 2–4 → few, 0 and 5 or more → many ("0 volných míst"). */
export function countWord(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count >= 2 && count <= 4) return few;
  return many;
}

/*
 * Every booking of the day the venue is paid for: the ones still ahead, and the ones already
 * over — a no-show included, because the customer paid and the place was held. A request still
 * waiting for the venue, or one being charged, is not agreed yet; a cancelled one is gone.
 */
const PAID_FOR: BookingStatus[] = ['confirmed', 'completed', 'no_show'];

/** Today's bookings and what the venue gets for them, from one list so the two always agree. */
export function todaySummary(rows: MerchantBooking[], day: { from: string; until: string }): { count: number; payoutCents: number } {
  const from = Date.parse(day.from);
  const until = Date.parse(day.until);
  let count = 0;
  let payoutCents = 0;
  for (const row of rows) {
    const start = Date.parse(row.start_at_snapshot);
    if (!PAID_FOR.includes(row.status) || start < from || start >= until) continue;
    count += 1;
    payoutCents += row.merchant_payout_cents;
  }
  return { count, payoutCents };
}

/** "1 volné místo", "3 volná místa", "0 volných míst": the word that goes after the count. */
export function freeSeatsWord(count: number): string {
  return countWord(count, 'volné místo', 'volná místa', 'volných míst');
}
