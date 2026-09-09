import { describe, expect, it } from 'vitest';
import { unavailableReason } from '../src/features/offers/unavailable';

const NOW = '2026-09-09T12:00:00.000Z';

function offer(over: Partial<Parameters<typeof unavailableReason>[0]> = {}) {
  return {
    status: 'published' as const,
    capacity_remaining: 1,
    booking_cutoff_at: '2026-09-09T17:45:00.000Z',
    start_at: '2026-09-09T18:00:00.000Z',
    bookable: false,
    ...over,
  };
}

/**
 * This helper only ever explains a decision the database already made. The tests therefore
 * guard two things: that it never contradicts `bookable`, and that when several facts are
 * true at once it picks the one that is honest rather than the one that is flattering.
 */
describe('unavailableReason', () => {
  it('says nothing about an offer the server considers bookable', () => {
    expect(unavailableReason(offer({ bookable: true }), NOW)).toBeNull();
    // Even when other facts look alarming, the server's verdict wins.
    expect(unavailableReason(offer({ bookable: true, capacity_remaining: 0 }), NOW)).toBeNull();
  });

  it('reports a sold-out offer as caught', () => {
    expect(unavailableReason(offer({ capacity_remaining: 0 }), NOW)).toBe('caught');
  });

  it('reports a passed cutoff as closed, not caught', () => {
    const past = offer({ booking_cutoff_at: '2026-09-09T11:00:00.000Z' });
    expect(unavailableReason(past, NOW)).toBe('closed');
  });

  it('reports a started appointment as started', () => {
    const started = offer({ start_at: '2026-09-09T11:00:00.000Z', booking_cutoff_at: '2026-09-09T10:45:00.000Z' });
    expect(unavailableReason(started, NOW)).toBe('started');
  });

  it('never blames a customer when the venue cancelled', () => {
    // Cancelling returns capacity, but a cancellation is still a cancellation.
    const cancelled = offer({ status: 'cancelled', capacity_remaining: 0, start_at: '2026-09-09T11:00:00.000Z' });
    expect(unavailableReason(cancelled, NOW)).toBe('cancelled');
  });

  it('prefers "caught" over the clock, because being taken stays true afterwards', () => {
    const both = offer({ capacity_remaining: 0, start_at: '2026-09-09T11:00:00.000Z' });
    expect(unavailableReason(both, NOW)).toBe('caught');
  });

  it('never says caught when seats were still free and time simply ran out', () => {
    const expired = offer({ capacity_remaining: 3, start_at: '2026-09-09T11:00:00.000Z' });
    expect(unavailableReason(expired, NOW)).not.toBe('caught');
  });

  it('falls back rather than inventing a reason it cannot see', () => {
    const odd = offer({ status: 'draft' });
    expect(unavailableReason(odd, NOW)).toBe('unknown');
  });

  it('uses the server clock it is given, not the device clock', () => {
    const o = offer({ start_at: '2026-09-09T11:00:00.000Z', booking_cutoff_at: '2026-09-09T10:45:00.000Z' });
    // Same offer, an earlier server "now": nothing has expired yet.
    expect(unavailableReason(o, '2026-09-09T10:00:00.000Z')).toBe('unknown');
    expect(unavailableReason(o, NOW)).toBe('started');
  });
});
