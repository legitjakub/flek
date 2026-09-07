import type { SortKey } from '../../types/database';
import { dayBounds } from '../../lib/time';

export type When = 'now' | 'today' | 'tomorrow' | 'week';

export type Filters = {
  when: When;
  radius_m: number;
  category: string | null;
  min_discount_pct: number;
  max_price_cents: number | null;
  sort: SortKey;
};

export const DEFAULT_FILTERS: Filters = {
  when: 'today',
  radius_m: 5000,
  category: null,
  min_discount_pct: 0,
  max_price_cents: null,
  sort: 'recommended',
};

/** Window boundaries are Prague days derived from the server clock, never the device. */
export function windowFor(when: When, serverNow: string): { from: string | null; until: string | null } {
  if (when === 'now') return { from: serverNow, until: new Date(Date.parse(serverNow) + 4 * 3600_000).toISOString() };
  if (when === 'today') return { from: serverNow, until: dayBounds(serverNow, 0).until };
  if (when === 'tomorrow') {
    const day = dayBounds(serverNow, 1);
    return { from: day.from, until: day.until };
  }
  return { from: serverNow, until: dayBounds(serverNow, 6).until };
}

export const WHEN_LABELS: Record<When, string> = {
  now: 'Teď',
  today: 'Dnes',
  tomorrow: 'Zítra',
  week: 'Tento týden',
};

export const SORT_LABELS: Record<SortKey, string> = {
  recommended: 'Doporučené',
  nearest: 'Nejblíž',
  discount: 'Největší sleva',
  cheapest: 'Nejlevnější',
  soonest: 'Nejdřív',
};

/**
 * Cold-start ladder. At pilot launch a district may hold three offers, and a bare empty
 * grid makes the app look dead — so widen radius first, then the time window, and say so.
 */
export type Widening = { radius_m: number; when: When; note: string | null };

export function wideningSteps(filters: Filters): Widening[] {
  const radii = [filters.radius_m, 5000, 10000, 25000].filter((r, i, all) => all.indexOf(r) === i && r >= filters.radius_m);
  const whens: When[] = filters.when === 'week' ? ['week'] : [filters.when, filters.when === 'now' ? 'today' : 'tomorrow', 'week'];
  const steps: Widening[] = [];
  for (const when of whens.filter((w, i, all) => all.indexOf(w) === i)) {
    for (const radius of radii) {
      const widerRadius = radius !== filters.radius_m;
      const widerWhen = when !== filters.when;
      steps.push({
        radius_m: radius,
        when,
        note:
          !widerRadius && !widerWhen
            ? null
            : widerRadius && widerWhen
              ? `Poblíž teď nic není. Ukazujeme nabídky do ${radius / 1000} km a dál než ${WHEN_LABELS[filters.when].toLowerCase()}.`
              : widerRadius
                ? `Do ${filters.radius_m / 1000} km nic není. Ukazujeme nabídky do ${radius / 1000} km.`
                : `Na výběr „${WHEN_LABELS[filters.when]}" nic není. Ukazujeme ${WHEN_LABELS[when].toLowerCase()}.`,
      });
    }
  }
  return steps;
}
