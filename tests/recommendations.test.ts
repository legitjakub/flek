import { describe, expect, it } from 'vitest';
import { pickRecommendations } from '../src/features/offers/pickRecommendations';
import type { SearchRow } from '../src/types/database';

const row = (id: string, business: string, service: string, start = '2026-09-15T12:00:00Z'): SearchRow => ({
  id, business_id: business, service_id: service, business_name: business, business_slug: business, service_name: service,
  description: '', category_slug: 'sport', start_at: start, end_at: start, booking_cutoff_at: start, original_price_cents: 80000,
  deal_price_cents: 40000, capacity_total: 1, capacity_remaining: 1, address_line: '', city: 'Praha', district: null as unknown as string,
  latitude: 50, longitude: 14, cover_url: null, logo_url: null, image_url: null, distance_m: 100, discount_pct: 50, score: 1,
  server_now: start, rating_avg: null, rating_count: 0, google_place_id: null,
});

describe('Mohlo by se ti líbit', () => {
  const current = { business_id: 'b1', service_id: 'padel' };

  it('puts the venue first, then the same kind nearby, then anything, one card per service and never this service', () => {
    const picks = pickRecommendations(current, [
      [row('p2', 'b1', 'padel', '2026-09-15T15:00:00Z'), row('l1', 'b1', 'lekce'), row('l2', 'b1', 'lekce', '2026-09-15T16:00:00Z')],
      [row('t1', 'b2', 'tenis'), row('l3', 'b1', 'lekce', '2026-09-15T18:00:00Z'), row('s1', 'b3', 'squash')],
      [row('m1', 'b4', 'masaz'), row('t2', 'b2', 'tenis', '2026-09-15T19:00:00Z')],
    ]);
    expect(picks.map((group) => [group.key, group.slots.map((slot) => slot.id)])).toEqual([
      ['b1:lekce', ['l1', 'l2']],
      ['b2:tenis', ['t1']],
      ['b3:squash', ['s1']],
      ['b4:masaz', ['m1']],
    ]);
  });

  it('shows nothing rather than a strip of one, and stops at the limit', () => {
    expect(pickRecommendations(current, [[row('p2', 'b1', 'padel'), row('t1', 'b2', 'tenis')]])).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => row(`x${i}`, `b${i + 10}`, 'kurz'));
    expect(pickRecommendations(current, [many], 8)).toHaveLength(8);
  });
});
