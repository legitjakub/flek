import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchOffers } from '../../lib/api';
import { track } from '../../lib/analytics';
import { serverNow, useClockEpoch } from '../../lib/clock';
import type { Point } from '../../lib/geo';
import type { SearchRow } from '../../types/database';
import { windowFor, wideningSteps, type Filters, type When } from './filters';
import { groupSlots } from './slots';

/**
 * `applied` is the rung of the widening ladder these rows actually came from — not what was
 * asked for. Without it the toolbar had no way to know: it lit the pill for `filters.when`
 * while `discover` had quietly answered "Teď" with the whole week, so every pill looked
 * broken because every pill produced the same 18 cards under a different name.
 */
export type DiscoveryResult = {
  rows: SearchRow[];
  note: string | null;
  applied: { when: When; radius_m: number };
};

const MIN_RESULTS = 3;
const DEFAULT_RESULT_LIMIT = 50;
export const MAP_RESULT_LIMIT = 100;

function safeResultLimit(limit: number) {
  // `search_offers` rejects anything above 100. Keep the contract here so a future screen
  // cannot accidentally turn a larger visual target into a broken request.
  return Math.min(MAP_RESULT_LIMIT, Math.max(1, Math.trunc(limit)));
}

/**
 * One server-side search; if the current filter is too thin, walk the cold-start ladder
 * and label the widening honestly. All filtering stays in Postgres.
 */
export async function discover(point: Point, filters: Filters, limit = DEFAULT_RESULT_LIMIT): Promise<DiscoveryResult> {
  const steps = wideningSteps(filters, serverNow());
  const resultLimit = safeResultLimit(limit);
  let best: DiscoveryResult = { rows: [], note: null, applied: { when: filters.when, radius_m: filters.radius_m } };
  for (const step of steps) {
    const range = windowFor(step.when, serverNow());
    const rows = await searchOffers({
      lat: point.lat,
      lng: point.lng,
      radius_m: step.radius_m,
      category: filters.category,
      from: range.from,
      until: range.until,
      min_discount_pct: filters.min_discount_pct,
      max_price_cents: filters.max_price_cents,
      sort: filters.sort,
      daypart: filters.daypart,
      // Several times of one service become one card, so ask for more rows than cards are shown.
      limit: resultLimit,
    });
    // What counts is how many different FLEKs the customer gets, not how many times they have.
    const cards = groupSlots(rows).length;
    if (cards > groupSlots(best.rows).length) best = { rows, note: step.note, applied: { when: step.when, radius_m: step.radius_m } };
    if (cards >= MIN_RESULTS) break;
  }
  return best;
}

export function useDiscovery(point: Point, filters: Filters, limit = DEFAULT_RESULT_LIMIT) {
  // The epoch is part of the key so a late clock correction re-runs the search with the
  // right Prague day window instead of leaving a wrong „Dnes" on screen.
  const epoch = useClockEpoch();
  const query = useQuery({
    queryKey: ['discovery', point.lat.toFixed(4), point.lng.toFixed(4), filters, limit, epoch],
    queryFn: () => discover(point, filters, limit),
    // Inventory decays by the minute: never show a card that stopped being bookable.
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // A search is what a person asked for: counted once per place and filters, not on every refresh.
  const searchKey = JSON.stringify([point.lat.toFixed(2), point.lng.toFixed(2), filters]);
  const tracked = useRef<string | null>(null);
  const result = query.data;
  useEffect(() => {
    if (!result || tracked.current === searchKey) return;
    tracked.current = searchKey;
    track('search_performed', {
      // A district is enough for "where is the marketplace thin"; the server rounds the same way.
      lat: Number(point.lat.toFixed(2)),
      lng: Number(point.lng.toFixed(2)),
      when: filters.when,
      daypart: filters.daypart,
      category: filters.category,
      sort: filters.sort,
      results: result.rows.length,
      // Both, always: the gap between what was asked for and what the ladder had to fall back
      // to is the measure of how thin the marketplace is in a district.
      applied_when: result.applied.when,
      applied_radius_m: result.applied.radius_m,
    });
  }, [searchKey, result, point.lat, point.lng, filters]);

  return query;
}
