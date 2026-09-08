import { describe, expect, it } from 'vitest';
import { clusterPins } from '../src/features/discovery/mapClusters';
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

  it('clusters overlapping tap targets without dropping activities', () => {
    const groups = clusterPins([
      { x: 100, y: 100, width: 90, indexes: [0] },
      { x: 130, y: 120, width: 90, indexes: [1] },
      { x: 330, y: 320, width: 90, indexes: [2] },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.flatMap((group) => group.indexes).sort()).toEqual([0, 1, 2]);
  });

  it('separates nearby activities when zooming provides enough space', () => {
    const near = [{ x: 0, y: 0, width: 90, indexes: [0] }, { x: 30, y: 10, width: 90, indexes: [1] }];
    expect(clusterPins(near)).toHaveLength(1);
    expect(clusterPins(near.map((pin) => ({ ...pin, x: pin.x * 10, y: pin.y * 10 })))).toHaveLength(2);
  });

  it('rechecks cluster sizes so a merged label cannot cover another target', () => {
    const groups = clusterPins(Array.from({ length: 30 }, (_, i) => ({ x: (i % 6) * 75, y: Math.floor(i / 6) * 50, width: 100, indexes: [i] })));
    expect(groups.flatMap((group) => group.indexes).sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      expect(Math.abs(groups[i].x - groups[j].x) >= (groups[i].width + groups[j].width) / 2 + 10 || Math.abs(groups[i].y - groups[j].y) >= 54).toBe(true);
    }
  });
});
