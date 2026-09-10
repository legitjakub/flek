import { useQuery } from '@tanstack/react-query';
import { searchOffers } from '../../lib/api';
import { track } from '../../lib/analytics';
import { serverNow, useClockEpoch } from '../../lib/clock';
import type { Point } from '../../lib/geo';
import type { SearchRow } from '../../types/database';
import { windowFor, wideningSteps, type Filters, type When } from './filters';

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

/**
 * One server-side search; if the current filter is too thin, walk the cold-start ladder
 * and label the widening honestly. All filtering stays in Postgres.
 */
export async function discover(point: Point, filters: Filters): Promise<DiscoveryResult> {
  const steps = wideningSteps(filters, serverNow());
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
      limit: 30,
    });
    if (rows.length > best.rows.length) best = { rows, note: step.note, applied: { when: step.when, radius_m: step.radius_m } };
    if (rows.length >= MIN_RESULTS) break;
  }
  track('search_performed', {
    lat: Number(point.lat.toFixed(3)),
    lng: Number(point.lng.toFixed(3)),
    when: filters.when,
    daypart: filters.daypart,
    category: filters.category,
    sort: filters.sort,
    results: best.rows.length,
    // Both, always: the gap between what was asked for and what the ladder had to fall back
    // to is the measure of how thin the marketplace is in a district.
    applied_when: best.applied.when,
    applied_radius_m: best.applied.radius_m,
  });
  return best;
}

export function useDiscovery(point: Point, filters: Filters) {
  // The epoch is part of the key so a late clock correction re-runs the search with the
  // right Prague day window instead of leaving a wrong „Dnes" on screen.
  const epoch = useClockEpoch();
  return useQuery({
    queryKey: ['discovery', point.lat.toFixed(4), point.lng.toFixed(4), filters, epoch],
    queryFn: () => discover(point, filters),
    // Inventory decays by the minute: never show a card that stopped being bookable.
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
