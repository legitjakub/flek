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

/** One fact about a time: how much is off, how long it lasts, what is left of it. */
function Fact({ children, selected, tone }: { children: ReactNode; selected: boolean; tone?: 'discount' | 'warning' }) {
  if (tone === 'warning') {
    return <span className="inline-flex items-center rounded-lg bg-warning-soft px-2 py-0.5 text-xs font-bold text-warning">{children}</span>;
  }
  // The discount is the argument for this time, so it wears the money green the rest of the app
  // uses for what the customer keeps; duration and seats stay quiet metadata beside it.
  if (tone === 'discount') {
    return <span className="tnum inline-flex items-center rounded-lg bg-positive/10 px-2 py-0.5 text-xs font-extrabold text-positive">{children}</span>;
  }
  return (
    <span
      className={cx(
        'tnum inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-bold text-muted',
        // The chosen card is already tinted, so its facts sit on white; the others on the ground.
        selected ? 'bg-card' : 'bg-surface',
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
          {/* The day is the one label that orders the whole list, so it wears the brand rather than
              the grey of metadata: at 12 px muted it read as a caption of the card above it. */}
          {day.title ? (
            <p className="inline-flex items-center rounded-full bg-brand-soft px-2.5 py-1 text-xs font-extrabold text-accent">
              {day.title}
            </p>
          ) : null}
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
                    selected ? 'border-brand bg-brand-soft ring-1 ring-brand' : 'border-line bg-card hover:bg-surface',
                    pending && 'animate-pulse',
                  )}
                >
                  {/*
                    Hour on the left, price on the right end of the same line. As the first chip of
                    the row below, the price sat in a different column on every card, so comparing
                    two times meant reading two chip rows instead of running an eye down one column.
                  */}
                  <span className="flex items-baseline gap-2">
                    <span className="tnum text-lg leading-tight font-extrabold text-ink">
                      {sectioned ? clockTime(slot.start_at) : `${dayLabel(slot.start_at, now)} ${clockTime(slot.start_at)}`}
                    </span>
                    {soon ? <span className="text-sm font-bold text-accent">{relativeTime(slot.start_at, now)}</span> : null}
                    <span className="tnum ml-auto shrink-0 text-lg leading-tight font-extrabold text-ink">
                      {money(slot.deal_price_cents)}
                    </span>
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {slot.discount_pct > 0 ? <Fact selected={selected} tone="discount">−{slot.discount_pct} %</Fact> : null}
                    <Fact selected={selected}>{duration(slot.start_at, slot.end_at)} min</Fact>
                    {lastSeat ? <Fact selected={selected} tone="warning">poslední místo</Fact> : null}
                    {selected ? (
                      <span className="ml-auto inline-flex items-center gap-1 text-xs font-extrabold text-accent">
                        <Check size={14} aria-hidden="true" />Vybráno
                      </span>
                    ) : null}
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
