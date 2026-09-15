import { describe, expect, it } from 'vitest';
import { groupSlots, slotLabels, slotsByDay, visibleSlots } from '../src/features/discovery/slots';
import type { SearchRow } from '../src/types/database';

const NOW = '2026-09-15T08:00:00Z'; // 10:00 in Prague
const row = (id: string, start: string, extra: Partial<SearchRow> = {}): SearchRow => ({
  id, business_id: 'b1', service_id: 's1', business_name: 'Padel Dobrý míč', business_slug: 'padel', service_name: 'Padelový kurt',
  description: '', category_slug: 'sport', start_at: start, end_at: new Date(Date.parse(start) + 3_600_000).toISOString(),
  booking_cutoff_at: start, original_price_cents: 80000, deal_price_cents: 40000, capacity_total: 2, capacity_remaining: 2,
  address_line: '', city: 'Praha', district: 'Smíchov', latitude: 50.07, longitude: 14.4, cover_url: null, logo_url: null,
  image_url: null, distance_m: 960, discount_pct: 50, score: 1, server_now: NOW, rating_avg: null, rating_count: 0, google_place_id: null,
  ...extra,
});

describe('times of one service', () => {
  it('groups by venue and service, soonest time first, in the order the server ranked the groups', () => {
    const groups = groupSlots([
      row('late', '2026-09-15T16:00:00Z'),
      row('other', '2026-09-15T12:00:00Z', { service_id: 's2', service_name: 'Individuální lekce' }),
      row('early', '2026-09-15T11:00:00Z'),
      row('elsewhere', '2026-09-15T11:00:00Z', { business_id: 'b2' }),
      row('late', '2026-09-15T16:00:00Z'),
    ]);
    expect(groups.map((group) => [group.key, group.lead.id, group.slots.map((slot) => slot.id)])).toEqual([
      ['b1:s1', 'early', ['early', 'late']],
      ['b1:s2', 'other', ['other']],
      ['b2:s1', 'elsewhere', ['elsewhere']],
    ]);
  });

  it('writes the day only where it changes and marks different prices and last seats', () => {
    const lead = row('a', '2026-09-15T11:00:00Z');
    const labels = slotLabels([
      row('b', '2026-09-15T13:30:00Z'),
      row('c', '2026-09-15T16:00:00Z', { deal_price_cents: 35000 }),
      row('d', '2026-09-16T07:00:00Z', { capacity_remaining: 1 }),
    ], NOW, { after: lead, priceCents: lead.deal_price_cents });
    expect(labels.map((label) => label.label)).toEqual(['15:30', '18:00', 'Zítra 09:00']);
    expect(labels[1]).toMatchObject({ priceCents: 35000, last: false });
    expect(labels[2]).toMatchObject({ priceCents: null, last: true, spoken: 'zítra 09:00, poslední místo' });
    // Without a reference time the first label is compared with today.
    expect(slotLabels([row('x', '2026-09-17T08:00:00Z')], NOW)[0].label).toBe('17. 9. 10:00');
  });

  it('keeps one row on a card and groups times by day on the detail page', () => {
    expect(visibleSlots([1, 2, 3, 4])).toEqual({ shown: [1, 2, 3, 4], more: 0 });
    expect(visibleSlots([1, 2, 3, 4, 5, 6])).toEqual({ shown: [1, 2, 3], more: 3 });
    const days = slotsByDay([row('a', '2026-09-15T11:00:00Z'), row('b', '2026-09-15T16:00:00Z'), row('c', '2026-09-16T07:00:00Z')], NOW);
    expect(days.map((day) => [day.title, day.slots.map((slot) => slot.id)])).toEqual([['Dnes', ['a', 'b']], ['Zítra', ['c']]]);
  });
});
