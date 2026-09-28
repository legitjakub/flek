import { describe, expect, it } from 'vitest';
import { DOT_SIZE, markersCollide, spreadPins } from '../src/features/discovery/mapClusters';
import { cardsByLocation, groupMapOffers, mapLocationId, serviceForMapPin } from '../src/features/discovery/mapOffers';
import { groupSlots } from '../src/features/discovery/slots';
import type { SearchRow } from '../src/types/database';

describe('Map selection regressions', () => {
  const carouselRows = [
    { id: 'massage-later', business_id: 'a', service_id: 'massage', latitude: 50.08, longitude: 14.42, deal_price_cents: 39000, start_at: '2026-09-29T16:00:00Z' },
    { id: 'yoga', business_id: 'b', service_id: 'yoga', latitude: 50.09, longitude: 14.43, deal_price_cents: 26000, start_at: '2026-09-29T12:00:00Z' },
    { id: 'massage-earlier', business_id: 'a', service_id: 'massage', latitude: 50.08, longitude: 14.42, deal_price_cents: 39000, start_at: '2026-09-29T10:00:00Z' },
    { id: 'facial', business_id: 'a', service_id: 'facial', latitude: 50.08, longitude: 14.42, deal_price_cents: 45000, start_at: '2026-09-29T14:00:00Z' },
  ] as SearchRow[];

  it('offers every matching venue in server order, with multiple times under one service card', () => {
    const cards = groupSlots(carouselRows);
    expect(cards.map((card) => card.key)).toEqual(['a:massage', 'b:yoga', 'a:facial']);
    expect(cards[0].slots.map((row) => row.id)).toEqual(['massage-earlier', 'massage-later']);
    expect(cards[0].lead.id).toBe('massage-earlier');
    const pinIds = groupMapOffers(carouselRows).map((pin) => pin.id);
    expect(cards.every((card) => pinIds.includes(mapLocationId(card.lead)))).toBe(true);
    expect(mapLocationId(cards[0].lead)).not.toBe(mapLocationId(cards[1].lead));
  });

  it('swipes through every service at one venue before moving the map to the next venue', () => {
    const cards = cardsByLocation(groupSlots(carouselRows));
    expect(cards.map((card) => card.key)).toEqual(['a:massage', 'a:facial', 'b:yoga']);
    // One pin change for two venues: the map never flies back to a venue it has left.
    const pins = cards.map((card) => mapLocationId(card.lead));
    expect(pins.filter((pin, index) => index > 0 && pin !== pins[index - 1])).toHaveLength(1);
    expect(cardsByLocation([])).toEqual([]);
  });

  it('selects the first service at a tapped venue and keeps an already selected service there', () => {
    const cards = groupSlots(carouselRows);
    const pin = mapLocationId(carouselRows[0]);
    expect(serviceForMapPin(cards, pin, 'b:yoga')?.key).toBe('a:massage');
    expect(serviceForMapPin(cards, pin, 'a:facial')?.key).toBe('a:facial');
    expect(serviceForMapPin(cards, mapLocationId(carouselRows[1]), 'a:massage')?.key).toBe('b:yoga');
  });

  it('never selects a service outside the current results or brings back a filtered-out venue', () => {
    const cards = groupSlots(carouselRows.filter((row) => row.service_id === 'facial'));
    expect(serviceForMapPin(cards, mapLocationId(carouselRows[0]), 'a:massage')?.key).toBe('a:facial');
    expect(serviceForMapPin(cards, mapLocationId(carouselRows[1]), null)).toBeUndefined();
    expect(serviceForMapPin([], mapLocationId(carouselRows[0]), null)).toBeUndefined();
  });

  it('keeps every appointment at the same address accessible, with the actual lowest price', () => {
    const rows = [
      { id: 'later', latitude: 50.08, longitude: 14.42, deal_price_cents: 39000, start_at: '2026-09-09T16:00:00Z' },
      { id: 'earlier', latitude: 50.08, longitude: 14.42, deal_price_cents: 45000, start_at: '2026-09-09T10:00:00Z' },
      { id: 'elsewhere', latitude: 50.09, longitude: 14.43, deal_price_cents: 65000, start_at: '2026-09-09T12:00:00Z' },
    ] as SearchRow[];
    const groups = groupMapOffers(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].offers.map((row) => row.id)).toEqual(['earlier', 'later']);
    expect(groups[0].minPrice).toBe(39000);
    expect(rows.map((row) => row.id)).toEqual(['later', 'earlier', 'elsewhere']);
  });

  it('keeps every nearby activity as its own visible pin', () => {
    const pins = spreadPins([
      { x: 100, y: 100, width: 90, indexes: [0] },
      { x: 130, y: 120, width: 90, indexes: [1] },
      { x: 330, y: 320, width: 90, indexes: [2] },
    ]);
    expect(pins).toHaveLength(3);
    expect(pins.flatMap((pin) => pin.indexes).sort()).toEqual([0, 1, 2]);
    expect(pins[1].offsetX !== 0 || pins[1].offsetY !== 0).toBe(true);
  });

  it('does not move activities that already have enough space', () => {
    const near = [{ x: 0, y: 0, width: 90, indexes: [0] }, { x: 30, y: 10, width: 90, indexes: [1] }];
    const far = spreadPins(near.map((pin) => ({ ...pin, x: pin.x * 10, y: pin.y * 10 })));
    expect(far.every((pin) => pin.offsetX === 0 && pin.offsetY === 0)).toBe(true);
  });

  it('lays out ordinary dense results without replacing a venue with a count', () => {
    const pins = spreadPins(Array.from({ length: 12 }, (_, i) => ({ x: (i % 4) * 100, y: Math.floor(i / 4) * 92, width: 82, indexes: [i] })));
    expect(pins.flatMap((pin) => pin.indexes).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
      expect(markersCollide(pins[i], pins[j])).toBe(false);
    }
  });

  it('says when a pin had nowhere free to sit, which is what makes the map fall back to dots', () => {
    // A city block at a wide view: twelve venues 50 px apart, where a pin needs about 100.
    const block = Array.from({ length: 12 }, (_, i) => ({ x: 300 + (i % 4) * 50, y: 300 + Math.floor(i / 4) * 50, width: 90, indexes: [i] }));
    expect(spreadPins(block).some((pin) => pin.crowded)).toBe(true);

    const dots = spreadPins(block.map((pin) => ({ ...pin, width: DOT_SIZE, height: DOT_SIZE })));
    expect(dots.some((pin) => pin.crowded)).toBe(false);
    expect(dots.flatMap((pin) => pin.indexes).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
      expect(markersCollide(dots[i], dots[j])).toBe(false);
    }
  });

  it('never drops a venue even where not even a dot fits, so nothing is hidden', () => {
    const pileUp = Array.from({ length: 24 }, (_, i) => ({ x: 300 + (i % 4) * 9, y: 300 + Math.floor(i / 4) * 9, width: DOT_SIZE, height: DOT_SIZE, indexes: [i] }));
    const dots = spreadPins(pileUp);
    expect(dots).toHaveLength(24);
    expect(dots.flatMap((pin) => pin.indexes).sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it('is deterministic so pins do not jump after a pan redraw', () => {
    const input = Array.from({ length: 7 }, (_, i) => ({ x: 200 + i * 4, y: 180 + i * 3, width: 88, indexes: [i] }));
    expect(spreadPins(input)).toEqual(spreadPins(input));
  });
});
