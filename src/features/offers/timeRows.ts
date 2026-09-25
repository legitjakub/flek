import { capacityLabel } from '../../components/CapacityLabel';
import { savings } from '../../components/Price';
import { relativeTime } from '../../lib/clock';
import { money } from '../../lib/format';
import { clockTime, dayLabel } from '../../lib/time';
import type { SearchRow } from '../../types/database';

/** How soon a time counts as "soon" enough to say so on its row. */
const SOON_MINUTES = 120;

/** One row of the time picker: the whole range, the price and what it saves, in words a row can hold. */
export type TimeRow = {
  id: string;
  /** "16:00–16:30": the start alone said nothing about how long it ran. */
  range: string;
  priceCents: number;
  /** What the customer keeps against the usual price; 0 when there is nothing to keep. */
  savedCents: number;
  /** "Poslední místo" or "za 45 min", at most one of them. */
  note: { text: string; tone: 'last' | 'soon' } | null;
  /** The row for a screen reader, day included, since the day sits in the pills above. */
  spoken: string;
};

export function timeRow(slot: SearchRow, now: string): TimeRow {
  const start = clockTime(slot.start_at);
  const end = clockTime(slot.end_at);
  const savedCents = savings(slot.original_price_cents, slot.deal_price_cents);
  const minutesAway = Math.round((Date.parse(slot.start_at) - Date.parse(now)) / 60_000);
  const last = capacityLabel(slot.capacity_remaining, slot.capacity_total) === 'Poslední místo';
  const note: TimeRow['note'] = last
    ? { text: 'Poslední místo', tone: 'last' }
    : minutesAway > 0 && minutesAway <= SOON_MINUTES ? { text: relativeTime(slot.start_at, now), tone: 'soon' } : null;
  const spoken = [
    `${dayLabel(slot.start_at, now).toLocaleLowerCase('cs-CZ')} ${start} až ${end}`,
    money(slot.deal_price_cents),
    savedCents > 0 ? `ušetříš ${money(savedCents)}` : null,
    last ? 'poslední místo' : null,
  ].filter(Boolean).join(', ');
  return { id: slot.id, range: `${start}–${end}`, priceCents: slot.deal_price_cents, savedCents, note, spoken };
}

/**
 * How many rows of a day to show: the first four, but never fewer than reach the chosen time,
 * so the selection is not hidden behind "Zobrazit další časy".
 */
export function visibleCount(total: number, selectedIndex: number, expanded: boolean, base = 4): number {
  if (expanded) return total;
  return Math.min(total, Math.max(base, selectedIndex + 1));
}
