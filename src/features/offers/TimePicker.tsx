import { useState } from 'react';
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

/**
 * The other free times of the same service at the same venue. Each time is its own offer, so picking
 * one moves the page to it: price, seats, cancellation terms and the booking all follow the time.
 * Nothing is shown when the service has a single time.
 *
 * A time is a card, not a pill. A pill fits the hour and nothing else, so two times that differ by
 * 150 Kč, by half an hour of treatment or by the last free seat looked interchangeable — the
 * customer had to tap each one and watch the price column change. The card states what the tap
 * would buy: the hour, the final price, the discount, how long it lasts and what is left of it.
 *
 * The chosen time is never one of them. The block above this one already states it in full — day,
 * hours, length, price, saving, what is left — so listing it again as a selected card repeated six
 * facts within one screen and made the list a card longer than it needs to be. Above: your
 * appointment. Here: the ones you could have instead.
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
  // A time that can no longer be booked is not offered again, but its neighbours are.
  const times = slots.filter((slot) => slot.id !== offer.id);
  if (!times.length) return null;

  const { shown, more } = visibleSlots(times, SHOWN_AT_ONCE);
  const folded = more > 0 && !expanded;
  const visible = folded ? shown : times;

  const last = new Map(slotLabels(times, now).map((label) => [label.id, label.last]));
  // Day headings help only when a day has several times; one time a day reads better as "Zítra 13:00".
  const sectioned = slotsByDay(times, now).some((day) => day.slots.length > 1);
  const days = sectioned ? slotsByDay(visible, now) : [{ key: 'all', title: '', slots: visible }];

  return (
    <div className="mt-4">
      <p id="vyber-casu" className="text-sm font-bold text-ink">Jiné časy téhle služby</p>
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
              const pending = slot.id === pendingId;
              const minutesAway = Math.round((Date.parse(slot.start_at) - Date.parse(now)) / 60000);
              const soon = minutesAway > 0 && minutesAway <= SOON_MINUTES;
              const lastSeat = last.get(slot.id) ?? false;
              return (
                <button
                  key={slot.id}
                  type="button"
                  aria-label={[
                    `${dayLabel(slot.start_at, now).toLocaleLowerCase('cs-CZ')} ${clockTime(slot.start_at)}`,
                    money(slot.deal_price_cents),
                    lastSeat ? 'poslední místo' : null,
                  ].filter(Boolean).join(', ')}
                  aria-busy={pending || undefined}
                  disabled={pendingId !== null && !pending}
                  onClick={() => onPick(slot.id)}
                  className={cx(
                    'w-full rounded-2xl border border-line bg-card p-3 text-left transition-colors hover:border-brand hover:bg-brand-soft/40 disabled:opacity-55',
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
                  {/*
                    Only the discount keeps a filled chip: it is the argument for this time, in the
                    money green the app uses for what the customer keeps. Length and the last free
                    seat were chips too, and five cards of three grey boxes each read as a form.
                  */}
                  <span className="tnum mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    {slot.discount_pct > 0 ? (
                      <span className="inline-flex items-center rounded-lg bg-positive/10 px-2 py-0.5 font-extrabold text-positive">
                        −{slot.discount_pct} %
                      </span>
                    ) : null}
                    <span>{duration(slot.start_at, slot.end_at)} min</span>
                    {lastSeat ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-bold text-warning">poslední místo</span>
                      </>
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
