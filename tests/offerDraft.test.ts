import { describe, expect, it } from 'vitest';
import { recentOffers, repeatDraft, repeatSlot } from '../src/features/merchant/offerDraft';
import { nextSlot, cutoffFor } from '../src/features/merchant/CreateOfferSheet';
import type { MerchantOffer, Service } from '../src/types/database';

const NOW = '2026-09-26T08:00:00.000Z';
const offer = (extra: Partial<MerchantOffer> = {}): MerchantOffer => ({
  id: 'a', service_id: 'massage', merchant_price_cents: 36500, deal_price_cents: 39000,
  capacity_total: 3, capacity_remaining: 0, status: 'published',
  published_at: NOW, start_at: '2026-09-27T08:00:00.000Z', ...extra,
} as MerchantOffer);
const service = (id: string, is_active = true) => ({ id, is_active } as Service);

describe('offer drafts', () => {
  it('retains the standard fresh time and derived cutoff', () => {
    expect(nextSlot(NOW)).toBe('2026-09-26T10:30');
    expect(cutoffFor('2026-09-26T08:30:00Z', NOW)).toBe('2026-09-26T08:15:00.000Z');
  });
  it('copies only reusable inputs, including total rather than remaining capacity', () => {
    expect(repeatDraft(offer())).toEqual({ service_id: 'massage', merchant_price_cents: 36500, capacity_total: 3, start_at: '2026-09-27T08:00:00.000Z' });
    expect(repeatSlot(offer().start_at, NOW)).toBe('2026-09-27T10:00');
  });
  it.each(['2026-09-25T08:00:00Z', '2026-09-26T08:09:00Z', '2026-10-05T08:00:00Z', 'bad', undefined])('requires a new time for %s', (start) => {
    expect(repeatSlot(start, NOW)).toBe('');
  });
  it('uses server time, including minute precision near the form boundary', () => {
    expect(repeatSlot('2026-09-26T08:10:00Z', NOW)).toBe('2026-09-26T10:10');
    expect(repeatSlot('2026-09-26T08:10:31Z', '2026-09-26T08:00:30Z')).toBe('');
  });
  it.each(['published', 'cancelled'] as const)('can reuse sold-out or %s offers without copying status', (status) => {
    const draft = repeatDraft(offer({ status, start_at: '2026-09-25T08:00:00Z' }));
    expect(draft).toMatchObject({ service_id: 'massage', merchant_price_cents: 36500, capacity_total: 3 });
    expect(repeatSlot(draft.start_at, NOW)).toBe('');
    expect(draft).not.toHaveProperty('status');
  });
  it('takes the latest three unique active services by publication, not appointment date', () => {
    const rows = [
      offer({ service_id: 'a', published_at: '2026-09-20T10:00Z' }),
      offer({ service_id: 'b', published_at: '2026-09-21T10:00Z' }),
      offer({ service_id: 'c', published_at: '2026-09-22T10:00Z' }),
      offer({ service_id: 'a', published_at: '2026-09-23T10:00Z', merchant_price_cents: 41000, status: 'cancelled' }),
      offer({ service_id: 'inactive', published_at: '2026-09-24T10:00Z' }),
      offer({ service_id: 'd', published_at: '2026-09-19T10:00Z' }),
    ];
    const result = recentOffers(rows, ['a', 'b', 'c', 'd'].map((id) => service(id)).concat(service('inactive', false)));
    expect(result.map((r) => r.service_id)).toEqual(['a', 'c', 'b']);
    expect(result[0].merchant_price_cents).toBe(41000);
    expect(rows[0].service_id).toBe('a');
    expect(recentOffers([], [])).toEqual([]);
  });
});
