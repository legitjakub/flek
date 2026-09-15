import { capacityLabel } from '../../components/CapacityLabel';
import { money } from '../../lib/format';
import { clockTime, dayKey, dayLabel } from '../../lib/time';
import type { SearchRow } from '../../types/database';

/**
 * One service at one venue, at every time it is free. Each time is its own offer on the server
 * (its own seats, price and booking); the customer sees them as one FLEK with several times,
 * instead of three near-identical cards next to each other.
 */
export type SlotGroup<T extends SearchRow = SearchRow> = {
  key: string;
  /** The soonest time: what the card shows first, opens, and is sorted by. */
  lead: T;
  /** Every time in the group, soonest first, the lead included. */
  slots: T[];
};

export function slotKey(row: Pick<SearchRow, 'business_id' | 'service_id'>): string {
  return `${row.business_id}:${row.service_id}`;
}

/** Groups keep the order in which the server ranked their first time. */
export function groupSlots<T extends SearchRow>(rows: T[]): SlotGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const slots = groups.get(slotKey(row));
    if (!slots) groups.set(slotKey(row), [row]);
    else if (!slots.some((slot) => slot.id === row.id)) slots.push(row);
  }
  return [...groups.entries()].map(([key, slots]) => {
    const sorted = [...slots].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.id.localeCompare(b.id));
    return { key, lead: sorted[0], slots: sorted };
  });
}

export type SlotLabel = {
  id: string;
  /** "15:30", or "Zítra 9:00" where the day changes. */
  label: string;
  /** "zítra 9:00, 350 Kč, poslední místo" for a screen reader. */
  spoken: string;
  /** Set only when this time costs something else than the time it is compared with. */
  priceCents: number | null;
  last: boolean;
};

/**
 * Labels for a row of times. The day is written only where it changes: from `after` (the time the
 * card already shows) or from today, so "13:00 · 15:30 · Zítra 9:00" reads without repeating "Dnes".
 */
export function slotLabels(slots: SearchRow[], now: string, options: { after?: SearchRow; priceCents?: number } = {}): SlotLabel[] {
  let previousDay = dayKey(options.after?.start_at ?? now);
  return slots.map((slot) => {
    const day = dayKey(slot.start_at);
    const time = clockTime(slot.start_at);
    const label = day === previousDay ? time : `${dayLabel(slot.start_at, now)} ${time}`;
    previousDay = day;
    const priceCents = options.priceCents !== undefined && slot.deal_price_cents !== options.priceCents ? slot.deal_price_cents : null;
    const last = capacityLabel(slot.capacity_remaining, slot.capacity_total) === 'Poslední místo';
    const spoken = [
      `${dayLabel(slot.start_at, now).toLocaleLowerCase('cs-CZ')} ${time}`,
      priceCents !== null ? money(priceCents) : null,
      last ? 'poslední místo' : null,
    ].filter(Boolean).join(', ');
    return { id: slot.id, label, spoken, priceCents, last };
  });
}

/** The first few labels and how many more there are, for a card that has room for one row. */
export function visibleSlots<T>(items: T[], max = 4): { shown: T[]; more: number } {
  if (items.length <= max) return { shown: items, more: 0 };
  return { shown: items.slice(0, max - 1), more: items.length - (max - 1) };
}

/** Times grouped under their day heading, for picking one on the detail page. */
export function slotsByDay<T extends SearchRow>(slots: T[], now: string): { key: string; title: string; slots: T[] }[] {
  const days: { key: string; title: string; slots: T[] }[] = [];
  for (const slot of slots) {
    const key = dayKey(slot.start_at);
    const day = days.find((entry) => entry.key === key);
    if (day) day.slots.push(slot);
    else days.push({ key, title: dayLabel(slot.start_at, now), slots: [slot] });
  }
  return days;
}
