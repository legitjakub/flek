import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { relativeTime } from '../../lib/clock';
import { money } from '../../lib/format';
import { cx } from '../../components/ui';
import { slotLabels, slotsByDay, visibleSlots } from '../discovery/slots';
import type { OfferDetail, SearchRow } from '../../types/database';

/** How many times fit before the rest is folded away; the column is 320 px wide on a desktop. */
const SHOWN_AT_ONCE = 5;

/** A time is "starting soon" by the same rule as a card in the feed. */
const SOON_MINUTES = 120;

/** One fact about a time: what it costs, how much is off, how long it lasts, what is left of it. */
function Fact({ children, selected, tone }: { children: ReactNode; selected: boolean; tone?: 'price' | 'warning' }) {
  if (tone === 'warning') {
    return <span className="inline-flex items-center rounded-lg bg-warning-soft px-2 py-0.5 text-xs font-bold text-warning">{children}</span>;
  }
  return (
    <span
      className={cx(
        'tnum inline-flex items-center rounded-lg px-2 py-0.5 text-xs',
        // The chosen card is already tinted, so its facts sit on white; the others on the ground.
        selected ? 'bg-card' : 'bg-surface',
        tone === 'price' ? 'font-extrabold text-ink' : 'font-bold text-muted',
      )}
    >
      {children}
    </span>
  );
}

/**
 * The other free times of the same service at the same venue. Each time is its own offer, so picking
 * one moves the page to it: price, seats, cancellation terms and the booking all follow the time.
 * Nothing is shown when the service has a single time.
 *
 * A time is a card, not a pill. A pill fits the hour and nothing else, so two times that differ by
 * 150 Kč, by half an hour of treatment or by the last free seat looked interchangeable — the
 * customer had to tap each one and watch the price column change. The card states what the tap
 * would buy: the hour, the final price, the discount, how long it lasts and what is left of it.
 * Only the chosen card carries the booking, so the page keeps one call to action (the sticky bar
 * on a phone, the button in this card on a desktop) instead of one per time.
 */
export function TimePicker({
  offer,
  slots,
  now,
  pendingId,
  onPick,
}: {
  offer: OfferDetail;
  /** Bookable times of this service at this venue, from business_offers. */
  slots: SearchRow[];
  now: string;
  pendingId: string | null;
  onPick: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const current = slots.some((slot) => slot.id === offer.id);
  // A time that can no longer be booked is not offered again, but its neighbours are.
  const times = current ? slots : slots.filter((slot) => slot.id !== offer.id);
  if (times.length < (current ? 2 : 1)) return null;

  const { shown, more } = visibleSlots(times, SHOWN_AT_ONCE);
  // Never fold the chosen time away: on a long list the page would open on times it cannot book.
  const chosenIsShown = !current || shown.some((slot) => slot.id === offer.id);
  const folded = more > 0 && !expanded && chosenIsShown;
  const visible = folded ? shown : times;

  const last = new Map(slotLabels(times, now).map((label) => [label.id, label.last]));
  // Day headings help only when a day has several times; one time a day reads better as "Zítra 13:00".
  const sectioned = slotsByDay(times, now).some((day) => day.slots.length > 1);
  const days = sectioned ? slotsByDay(visible, now) : [{ key: 'all', title: '', slots: visible }];

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p id="vyber-casu" className="text-sm font-bold text-ink">
        {current ? 'Vyber si čas' : 'Jiné časy téhle služby'}
      </p>
      {/* On a desktop this list sits in a sticky card: without a ceiling, six times would push the
          price and the booking button below the fold, where a pinned card cannot be scrolled to. */}
      <div className="md:max-h-96 md:overflow-y-auto md:pr-1">
      {days.map((day) => (
        <div key={day.key} className="mt-2">
          {day.title ? <p className="text-xs font-bold text-muted">{day.title}</p> : null}
          <div role="group" aria-labelledby="vyber-casu" className="mt-1.5 flex flex-col gap-2">
            {day.slots.map((slot) => {
              const selected = slot.id === offer.id;
              const pending = slot.id === pendingId;
              const minutesAway = Math.round((Date.parse(slot.start_at) - Date.parse(now)) / 60000);
              const soon = minutesAway > 0 && minutesAway <= SOON_MINUTES;
              const lastSeat = last.get(slot.id) ?? false;
              return (
                <button
                  key={slot.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={[
                    `${dayLabel(slot.start_at, now).toLocaleLowerCase('cs-CZ')} ${clockTime(slot.start_at)}`,
                    money(slot.deal_price_cents),
                    lastSeat ? 'poslední místo' : null,
                  ].filter(Boolean).join(', ')}
                  aria-busy={pending || undefined}
                  disabled={pendingId !== null && !pending}
                  onClick={() => {
                    if (!selected) onPick(slot.id);
                  }}
                  className={cx(
                    'w-full rounded-2xl border p-3 text-left transition-colors disabled:opacity-55',
                    selected ? 'border-brand bg-brand-soft' : 'border-line bg-card hover:bg-surface',
                    pending && 'animate-pulse',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="tnum text-lg leading-tight font-extrabold text-ink">
                      {sectioned ? clockTime(slot.start_at) : `${dayLabel(slot.start_at, now)} ${clockTime(slot.start_at)}`}
                    </span>
                    {soon ? <span className="text-sm font-bold text-accent">{relativeTime(slot.start_at, now)}</span> : null}
                    {selected ? <Check size={18} aria-hidden="true" className="ml-auto shrink-0 text-brand" /> : null}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Fact selected={selected} tone="price">{money(slot.deal_price_cents)}</Fact>
                    {slot.discount_pct > 0 ? <Fact selected={selected}>−{slot.discount_pct} %</Fact> : null}
                    <Fact selected={selected}>{duration(slot.start_at, slot.end_at)} min</Fact>
                    {lastSeat ? <Fact selected={selected} tone="warning">poslední místo</Fact> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      </div>
      {folded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-line bg-card px-3 text-sm font-bold text-ink hover:bg-surface"
        >
          Další časy ({more})
        </button>
      ) : null}
    </div>
  );
}
