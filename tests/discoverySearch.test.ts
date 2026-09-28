import { describe, expect, it, vi } from 'vitest';
import { searchOffers } from '../src/lib/api';
import { DEFAULT_FILTERS } from '../src/features/discovery/filters';
import { discover, MAP_LIMIT } from '../src/features/discovery/useDiscovery';

vi.mock('../src/lib/api', () => ({ searchOffers: vi.fn(async () => []) }));
vi.mock('../src/lib/clock', () => ({ serverNow: () => '2026-09-28T08:00:00Z', useClockEpoch: () => 0 }));

describe('service search during widening', () => {
  it.each([50, MAP_LIMIT])('keeps the service query and advanced filters at every rung (%i rows)', async (limit) => {
    vi.mocked(searchOffers).mockClear();
    const result = await discover({ lat: 50.08, lng: 14.42, label: 'Praha' }, {
      ...DEFAULT_FILTERS, query: 'masáž', when: 'soon', daypart: 'afternoon', category: 'masaze',
    }, limit);
    expect(result.rows).toEqual([]);
    expect(vi.mocked(searchOffers).mock.calls.length).toBeGreaterThan(1);
    for (const [params] of vi.mocked(searchOffers).mock.calls) {
      expect(params).toMatchObject({ query: 'masáž', daypart: 'afternoon', category: 'masaze', limit });
    }
  });
});
