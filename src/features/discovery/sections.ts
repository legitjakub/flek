import { dayBounds } from '../../lib/time';
import type { SearchRow } from '../../types/database';

export type Section = { key: string; title: string; note?: string; rows: SearchRow[] };

/** Below this many results the screen is one honest list, not a set of thin sections. */
const SECTIONS_FROM = 6;
/** A section carrying a single card reads as a mistake, so it never renders alone. */
const MIN_PER_SECTION = 2;
/** Capped so the first section cannot swallow the screen and flatten the rhythm. */
const MAX_PER_SECTION = 6;

/**
 * Marketplace liquidity is the constraint this has to survive: at pilot launch a district
 * may hold five offers. Sections are therefore earned, never assumed — a candidate that
 * cannot fill itself is dissolved back into the remainder, and no offer appears twice.
 */
export function buildSections(rows: SearchRow[], now: string): Section[] {
  if (rows.length === 0) return [];
  if (rows.length < SECTIONS_FROM) {
    return [{ key: 'all', title: 'Volné termíny', rows: byTime(rows) }];
  }

  const nowMs = Date.parse(now);
  const todayEnd = Date.parse(dayBounds(now, 0).until);
  const used = new Set<string>();
  const take = (candidates: SearchRow[]): SearchRow[] => {
    const picked = candidates.filter((row) => !used.has(row.id)).slice(0, MAX_PER_SECTION);
    if (picked.length < MIN_PER_SECTION) return [];
    picked.forEach((row) => used.add(row.id));
    return picked;
  };

  const sections: Section[] = [];
  const soon = take(byTime(rows.filter((r) => Date.parse(r.start_at) - nowMs <= 3 * 3600_000)));
  if (soon.length) sections.push({ key: 'soon', title: 'Začíná brzy', note: 'do 3 hodin', rows: soon });

  const evening = take(
    byTime(rows.filter((r) => Date.parse(r.start_at) < todayEnd && hourInPrague(r.start_at) >= 17)),
  );
  if (evening.length) sections.push({ key: 'evening', title: 'Dnes večer', rows: evening });

  const deals = take([...rows].sort((a, b) => b.discount_pct - a.discount_pct));
  if (deals.length) sections.push({ key: 'deals', title: 'Nejvýhodnější termíny', rows: deals });

  const near = take([...rows].sort((a, b) => a.distance_m - b.distance_m));
  if (near.length) sections.push({ key: 'near', title: 'Blízko tebe', rows: near });

  const rest = byTime(rows.filter((row) => !used.has(row.id)));
  if (rest.length >= MIN_PER_SECTION) {
    sections.push({ key: 'rest', title: 'Další volné termíny', rows: rest });
  } else if (rest.length && sections.length) {
    sections[sections.length - 1].rows.push(...rest);
  } else if (rest.length) {
    sections.push({ key: 'all', title: 'Volné termíny', rows: rest });
  }
  return sections;
}

function byTime(rows: SearchRow[]): SearchRow[] {
  return [...rows].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
}

function hourInPrague(instant: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', hour12: false }).format(
      new Date(instant),
    ),
  );
}
