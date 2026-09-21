import { describe, expect, it } from 'vitest';
import { COMPACT_PIN_SIZE, markersCollide, shouldCompactPins, spreadPins } from '../src/features/discovery/mapClusters';
import { groupMapOffers } from '../src/features/discovery/mapOffers';
import type { SearchRow } from '../src/types/database';

describe('Map selection regressions', () => {
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

  it('is deterministic so pins do not jump after a pan redraw', () => {
    const input = Array.from({ length: 7 }, (_, i) => ({ x: 200 + i * 4, y: 180 + i * 3, width: 88, indexes: [i] }));
    expect(spreadPins(input)).toEqual(spreadPins(input));
  });

  it('uses compact branded beacons for a city-wide view and full pins after zooming in', () => {
    const pins = Array.from({ length: 8 }, (_, i) => ({ x: i * 70, y: i % 2 ? 90 : 120, width: 82, indexes: [i] }));
    expect(shouldCompactPins(pins, 11.8)).toBe(true);
    expect(shouldCompactPins(pins, 14)).toBe(false);
    expect(shouldCompactPins([pins[0]], 10)).toBe(false);
  });

  it('can spread compact hit areas more tightly without hiding any venue', () => {
    const pins = spreadPins(Array.from({ length: 8 }, (_, i) => ({
      x: 180 + (i % 2) * 5,
      y: 180 + Math.floor(i / 2) * 5,
      width: COMPACT_PIN_SIZE,
      height: COMPACT_PIN_SIZE,
      indexes: [i],
    })));
    expect(pins.flatMap((pin) => pin.indexes).sort((a, b) => a - b)).toEqual(Array.from({ length: 8 }, (_, i) => i));
    expect(pins.every((pin) => pin.height === COMPACT_PIN_SIZE)).toBe(true);
  });
});
