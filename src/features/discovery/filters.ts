import type { SortKey } from '../../types/database';
import { dayBounds } from '../../lib/time';

export type When = 'now' | 'soon' | 'today' | 'tomorrow' | 'week';
export type Daypart = 'morning' | 'afternoon' | 'evening';

export type Filters = {
  when: When;
  daypart: Daypart | null;
  radius_m: number;
  category: string | null;
  min_discount_pct: number;
  max_price_cents: number | null;
  sort: SortKey;
};

export const DEFAULT_FILTERS: Filters = {
  when: 'today',
  daypart: null,
  radius_m: 5000,
  category: null,
  min_discount_pct: 0,
  max_price_cents: null,
  sort: 'recommended',
};

/** Window boundaries are Prague days derived from the server clock, never the device. */
export function windowFor(when: When, serverNow: string): { from: string | null; until: string | null } {
  if (when === 'now') return { from: serverNow, until: new Date(Date.parse(serverNow) + 4 * 3600_000).toISOString() };
  if (when === 'soon') return { from: serverNow, until: new Date(Date.parse(serverNow) + 2 * 3600_000).toISOString() };
  if (when === 'today') return { from: serverNow, until: dayBounds(serverNow, 0).until };
  if (when === 'tomorrow') {
    const day = dayBounds(serverNow, 1);
    return { from: day.from, until: day.until };
  }
  return { from: serverNow, until: dayBounds(serverNow, 6).until };
}

/** Short enough to sit on one line in the segmented control at 375 px. */
export const WHEN_LABELS: Record<When, string> = {
  now: 'Teď',
  soon: 'Do 2 h',
  today: 'Dnes',
  tomorrow: 'Zítra',
  week: 'Týden',
};

/** The same choices written so they read inside a sentence. */
export const WHEN_SENTENCE: Record<When, string> = {
  now: 'nejbližší hodiny',
  soon: 'nejbližší dvě hodiny',
  today: 'dnešek',
  tomorrow: 'zítřek',
  week: 'celý týden',
};

export const DAYPART_LABELS: Record<Daypart, string> = {
  morning: 'Ráno',
  afternoon: 'Odpoledne',
  evening: 'Večer',
};

export const SORT_LABELS: Record<SortKey, string> = {
  recommended: 'Doporučené',
  nearest: 'Nejblíž',
  discount: 'Největší sleva',
  cheapest: 'Nejlevnější',
  soonest: 'Nejdřív začíná',
};

export const RADIUS_LABELS: [number, string][] = [
  [1000, 'Do 1 km'],
  [2000, 'Do 2 km'],
  [5000, 'Do 5 km'],
  [10000, 'Do 10 km'],
  [25000, 'Celá Praha'],
];

export const DISCOUNT_LABELS: [number, string][] = [
  [0, 'Jakákoli'],
  [20, '−20 % a víc'],
  [30, '−30 % a víc'],
  [40, '−40 % a víc'],
];

export const PRICE_LABELS: [number | null, string][] = [
  [null, 'Bez limitu'],
  [30000, 'Do 300 Kč'],
  [50000, 'Do 500 Kč'],
  [100000, 'Do 1 000 Kč'],
];

/**
 * FLEK is organised around WHEN, so the time control speaks in intent ("mám volno večer")
 * rather than in the two server parameters it happens to set.
 */
export type TimeIntent = 'now' | 'soon' | 'afternoon' | 'evening' | 'tomorrow' | 'week';

export const TIME_INTENTS: { key: TimeIntent; label: string; when: When; daypart: Daypart | null }[] = [
  { key: 'now', label: 'Teď', when: 'now', daypart: null },
  { key: 'soon', label: 'Do 2 h', when: 'soon', daypart: null },
  { key: 'afternoon', label: 'Odpoledne', when: 'today', daypart: 'afternoon' },
  { key: 'evening', label: 'Večer', when: 'today', daypart: 'evening' },
  { key: 'tomorrow', label: 'Zítra', when: 'tomorrow', daypart: null },
  { key: 'week', label: 'Týden', when: 'week', daypart: null },
];

/** Which intent the current filters read as, or null for a combination only the sheet can make. */
export function intentOf(filters: Filters): TimeIntent | null {
  return TIME_INTENTS.find((i) => i.when === filters.when && i.daypart === filters.daypart)?.key ?? null;
}

export function applyIntent(filters: Filters, key: TimeIntent): Filters {
  const intent = TIME_INTENTS.find((i) => i.key === key);
  return intent ? { ...filters, when: intent.when, daypart: intent.daypart } : filters;
}

/** How many choices differ from the default — the number shown on the Filtry button. */
export function activeCount(filters: Filters): number {
  return (
    (filters.daypart ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.min_discount_pct > 0 ? 1 : 0) +
    (filters.max_price_cents ? 1 : 0) +
    (filters.radius_m !== DEFAULT_FILTERS.radius_m ? 1 : 0) +
    (filters.sort !== DEFAULT_FILTERS.sort ? 1 : 0)
  );
}

export type ActiveChip = { key: string; label: string; clear: (f: Filters) => Filters };

/** Every applied filter as a removable chip, so nothing is ever silently narrowing results. */
export function activeChips(filters: Filters, categoryLabel: (slug: string) => string): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (filters.daypart)
    chips.push({ key: 'daypart', label: DAYPART_LABELS[filters.daypart], clear: (f) => ({ ...f, daypart: null }) });
  if (filters.category)
    chips.push({ key: 'category', label: categoryLabel(filters.category), clear: (f) => ({ ...f, category: null }) });
  if (filters.radius_m !== DEFAULT_FILTERS.radius_m)
    chips.push({
      key: 'radius',
      label: RADIUS_LABELS.find(([m]) => m === filters.radius_m)?.[1] ?? `Do ${filters.radius_m / 1000} km`,
      clear: (f) => ({ ...f, radius_m: DEFAULT_FILTERS.radius_m }),
    });
  if (filters.min_discount_pct > 0)
    chips.push({
      key: 'discount',
      label: `−${filters.min_discount_pct} % a víc`,
      clear: (f) => ({ ...f, min_discount_pct: 0 }),
    });
  if (filters.max_price_cents)
    chips.push({
      key: 'price',
      label: PRICE_LABELS.find(([c]) => c === filters.max_price_cents)?.[1] ?? 'Cenový strop',
      clear: (f) => ({ ...f, max_price_cents: null }),
    });
  if (filters.sort !== DEFAULT_FILTERS.sort)
    chips.push({
      key: 'sort',
      label: SORT_LABELS[filters.sort],
      clear: (f) => ({ ...f, sort: DEFAULT_FILTERS.sort }),
    });
  return chips;
}

/**
 * Cold-start ladder. At pilot launch a district may hold three offers, and a bare empty
 * grid makes the app look dead — so widen radius first, then the time window, and say so.
 */
export type Widening = { radius_m: number; when: When; note: string | null };

export function wideningSteps(filters: Filters): Widening[] {
  const radii = [filters.radius_m, 5000, 10000, 25000].filter(
    (r, i, all) => all.indexOf(r) === i && r >= filters.radius_m,
  );
  const whens: When[] =
    filters.when === 'week'
      ? ['week']
      : [filters.when, filters.when === 'now' || filters.when === 'soon' ? 'today' : 'tomorrow', 'week'];
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
              ? `Poblíž teď nic není. Ukazujeme nabídky do ${radius / 1000} km a širší období než ${WHEN_SENTENCE[filters.when]}.`
              : widerRadius
                ? `Do ${filters.radius_m / 1000} km nic není. Ukazujeme nabídky do ${radius / 1000} km.`
                : `Na ${WHEN_SENTENCE[filters.when]} nic volného není. Ukazujeme ${WHEN_SENTENCE[when]}.`,
      });
    }
  }
  return steps;
}
