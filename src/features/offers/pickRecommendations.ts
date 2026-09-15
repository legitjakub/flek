import { groupSlots, slotKey, type SlotGroup } from '../discovery/slots';
import type { SearchRow } from '../../types/database';

/** Two lonely cards make the market look empty; below this the strip is not shown at all. */
export const MIN_RECOMMENDATIONS = 2;
export const MAX_RECOMMENDATIONS = 8;

/**
 * What else the customer might like, in the order the sources are given: the venue's other services,
 * then the same kind of service nearby, then anything nearby. One card per service and venue, never the
 * service being looked at (its other times are in the time picker), and nothing when it would be a
 * strip of one.
 */
export function pickRecommendations(
  current: Pick<SearchRow, 'business_id' | 'service_id'>,
  sources: SearchRow[][],
  max = MAX_RECOMMENDATIONS,
): SlotGroup[] {
  const seen = new Set([slotKey(current)]);
  const picked: SlotGroup[] = [];
  for (const rows of sources) {
    for (const group of groupSlots(rows)) {
      if (seen.has(group.key)) continue;
      seen.add(group.key);
      picked.push(group);
      if (picked.length === max) return picked;
    }
  }
  return picked.length >= MIN_RECOMMENDATIONS ? picked : [];
}
