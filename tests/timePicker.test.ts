import { describe, expect, it } from 'vitest';
import { timeRow, visibleCount } from '../src/features/offers/timeRows';
import type { SearchRow } from '../src/types/database';

const NOW = '2026-09-25T12:00:00Z'; // 14:00 in Prague
const slot = (extra: Partial<SearchRow> = {}): SearchRow => ({
  id: 'o1', business_id: 'b1', service_id: 's1', business_name: 'Studio', business_slug: 'studio', service_name: 'Úprava vousů',
  description: '', category_slug: 'vlasy', start_at: '2026-09-25T14:00:00Z', end_at: '2026-09-25T14:30:00Z',
  booking_cutoff_at: '2026-09-25T13:45:00Z', original_price_cents: 32500, deal_price_cents: 22300, capacity_total: 1, capacity_remaining: 1,
  address_line: '', city: 'Praha', district: 'Vinohrady', latitude: 50.07, longitude: 14.44, cover_url: null, logo_url: null,
  image_url: null, distance_m: 900, discount_pct: 31, score: 1, server_now: NOW, rating_avg: null, rating_count: 0, google_place_id: null,
  ...extra,
});

describe('time row', () => {
  it('shows the whole range and what the time saves', () => {
    const row = timeRow(slot(), NOW);
    expect(row.range).toBe('16:00–16:30');
    expect(row.priceCents).toBe(22300);
    expect(row.savedCents).toBe(10200);
    // Amounts keep the number and "Kč" together with a no-break space.
    expect(row.spoken).toBe('dnes 16:00 až 16:30, 223\u00a0Kč, ušetříš 102\u00a0Kč');
  });

  it('says soon only within two hours, and a last seat above everything', () => {
    expect(timeRow(slot({ start_at: '2026-09-25T12:45:00Z', end_at: '2026-09-25T13:15:00Z' }), NOW).note).toEqual({ text: 'za 45 min', tone: 'soon' });
    expect(timeRow(slot(), NOW).note).toEqual({ text: 'za 2 h', tone: 'soon' });
    expect(timeRow(slot({ start_at: '2026-09-25T17:00:00Z', end_at: '2026-09-25T17:30:00Z' }), NOW).note).toBeNull();
    const last = timeRow(slot({ capacity_total: 3, capacity_remaining: 1 }), NOW);
    expect(last.note).toEqual({ text: 'Poslední místo', tone: 'last' });
    expect(last.spoken).toMatch(/poslední místo$/);
  });

  it('never claims a saving where the price is the usual one', () => {
    const row = timeRow(slot({ original_price_cents: 22300 }), NOW);
    expect(row.savedCents).toBe(0);
    expect(row.spoken).not.toMatch(/ušetříš/);
  });
});

describe('rows to show', () => {
  it('keeps the chosen time in view', () => {
    expect(visibleCount(10, 6, false)).toBe(7);
    expect(visibleCount(10, 1, false)).toBe(4);
    expect(visibleCount(3, 0, false)).toBe(3);
    expect(visibleCount(10, -1, false)).toBe(4);
    expect(visibleCount(10, 2, true)).toBe(10);
  });
});
