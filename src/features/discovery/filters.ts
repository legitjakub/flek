import type { SortKey } from '../../types/database';
import { dayBounds } from '../../lib/time';

export type When = 'now' | 'soon' | 'today' | 'tomorrow' | 'week';
export type Daypart = 'morning' | 'afternoon' | 'evening';

export type Filters = {
  query: string;
  when: When;
  daypart: Daypart | null;
  radius_m: number;
  category: string | null;
  min_discount_pct: number;
  max_price_cents: number | null;
  sort: SortKey;
};

export const DEFAULT_FILTERS: Filters = {
  query: '',
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
  now: 'Brzy',
  soon: 'Do 2 h',
  today: 'Dnes',
  tomorrow: 'Zítra',
  week: 'Vše',
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

/** The rail offers only broad windows; the sheet keeps every server-supported window. */
export const PRIMARY_TIME_INTENTS = [
  { key: 'week', label: 'Vše' },
  { key: 'now', label: 'Brzy' },
  { key: 'today', label: 'Dnes' },
  { key: 'tomorrow', label: 'Zítra' },
] as const;
export type TimeIntent = typeof PRIMARY_TIME_INTENTS[number]['key'];
export const TIME_OPTIONS: { value: When; label: string }[] =
  (['now', 'soon', 'today', 'tomorrow', 'week'] as const).map((value) => ({ value, label: WHEN_LABELS[value] }));

/** Dayparts remain visible as chips. A two-hour window must never light the four-hour Brzy. */
export function intentOf(filters: Filters, appliedWhen: When = filters.when): TimeIntent | null {
  // An advanced request stays represented by its chip even if the cold-start ladder widens it.
  if (filters.when === 'soon') return null;
  return PRIMARY_TIME_INTENTS.find((intent) => intent.key === appliedWhen)?.key ?? null;
}

export function applyIntent(filters: Filters, key: TimeIntent): Filters {
  return { ...filters, when: key, daypart: null };
}

/** Clear the sheet's choices, including its advanced window, while keeping a primary window. */
export function clearAdvancedFilters(filters: Filters): Filters {
  return { ...DEFAULT_FILTERS, when: filters.when === 'soon' ? DEFAULT_FILTERS.when : filters.when };
}

/** How many choices differ from the default — the number shown on the Filtry button. */
export function activeCount(filters: Filters): number {
  return (
    (filters.query ? 1 : 0) +
    (filters.when === 'soon' ? 1 : 0) +
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
  if (filters.query)
    chips.push({ key: 'query', label: `Hledání: ${filters.query}`, clear: (f) => ({ ...f, query: '' }) });
  if (filters.when === 'soon')
    chips.push({ key: 'when', label: WHEN_LABELS.soon, clear: (f) => ({ ...f, when: DEFAULT_FILTERS.when }) });
  if (filters.daypart)
    chips.push({ key: 'daypart', label: DAYPART_LABELS[filters.daypart], clear: (f) => ({ ...f, daypart: null }) });
  if (filters.category)
    chips.push({ key: 'category', label: categoryLabel(filters.category), clear: (f) => ({ ...f, category: null }) });
  if (filters.radius_m !== DEFAULT_FILTERS.radius_m)
    chips.push({
      key: 'radius',
      label: RADIUS_LABELS.find(([m]) => m === filters.radius_m)?.[1] ?? `Do ${(Math.round(filters.radius_m / 100) / 10).toLocaleString('cs-CZ')} km`,
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

export function wideningSteps(filters: Filters, now: string): Widening[] {
  const radii = [filters.radius_m, 5000, 10000, 25000].filter(
    (r, i, all) => all.indexOf(r) === i && r >= filters.radius_m,
  );
  /*
   * Every rung has to contain the one below it, and two of them did not.
   *
   * windowFor('tomorrow') starts at tomorrow 00:00, so widening "Dnes" to it REPLACED today's
   * thin results with tomorrow's instead of adding to them — a search for today answered with
   * nothing from today. Today now widens straight to the whole week, which does contain it.
   *
   * And "today" is not always wider than "Teď": at nine in the evening the next four hours
   * run past midnight while today ends at midnight. So the ladder is filtered against the
   * clock rather than assumed, which is why this takes `now` at all.
   */
  const asked = windowFor(filters.when, now);
  const contains = (when: When) => {
    const step = windowFor(when, now);
    return Date.parse(step.from ?? now) <= Date.parse(asked.from ?? now)
      && Date.parse(step.until ?? now) >= Date.parse(asked.until ?? now);
  };
  const ladder: When[] =
    filters.when === 'week'
      ? ['week']
      : filters.when === 'tomorrow'
        ? ['tomorrow', 'week']
        : [filters.when, 'today', 'week'];
  const whens = ladder.filter((w, i, all) => all.indexOf(w) === i && (i === 0 || contains(w)));
  const steps: Widening[] = [];
  for (const when of whens) {
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
              ? `Poblíž nic není, ukazujeme do ${radius / 1000} km a ${WHEN_SENTENCE[when]}`
              : widerRadius
                ? `Do ${filters.radius_m / 1000} km nic není, ukazujeme do ${radius / 1000} km`
                : `Na ${WHEN_SENTENCE[filters.when]} nic není, ukazujeme ${WHEN_SENTENCE[when]}`,
      });
    }
  }
  return steps;
}
