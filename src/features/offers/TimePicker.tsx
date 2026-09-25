import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { dayKey } from '../../lib/time';
import { money } from '../../lib/format';
import { Chip, cx } from '../../components/ui';
import { slotsByDay } from '../discovery/slots';
import type { OfferDetail, SearchRow } from '../../types/database';
import { timeRow } from './timeRows';

/**
 * The times of one service as a strip of small cards, like showtimes: each card says the whole
 * range, the price and what that time saves, and the chosen one is filled in the brand colour,
 * the same colour as "Tvůj termín" above it.
 *
 * The chosen time stays in the strip. It used to be taken out, so a tap made the tapped tile
 * vanish, the rest shuffle into its place and the card above change without a transition: the
 * whole block jumped. Now the colour moves from one card to the other at once (a short fade and
 * lift), while the page loads that time; nothing else on the screen moves.
 */
export function TimePicker({
  offer,
  slots,
  now,
  pendingId,
  onPick,
  onIntent,
}: {
  offer: OfferDetail;
  slots: SearchRow[];
  now: string;
  pendingId: string | null;
  onPick: (id: string) => void;
  /** A finger or pointer on its way to a card: time to fetch that time's page. */
  onIntent?: (id: string) => void;
}) {
  const current = slots.some((slot) => slot.id === offer.id);
  const days = useMemo(() => slotsByDay(slots, now), [slots, now]);
  const offerDay = dayKey(offer.start_at);
  const selectedDay = days.some((day) => day.key === offerDay) ? offerDay : days[0]?.key;
  const [activeDay, setActiveDay] = useState(selectedDay ?? '');
  // The card just tapped is marked before its page arrives; the page then confirms it.
  const [chosen, setChosen] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedDay) setActiveDay(selectedDay);
  }, [selectedDay]);
  useEffect(() => {
    setChosen(null);
  }, [offer.id]);

  const active = days.find((day) => day.key === activeDay) ?? days[0];
  const selectedId = chosen ?? pendingId ?? (current ? offer.id : null);

  // On a phone, where the strip scrolls sideways, the chosen card is scrolled into view only as far
  // as needed: pulling it to the start hid the earlier times, which read as if they had gone.
  useEffect(() => {
    const rail = strip.current;
    const card = rail?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!rail || !card || rail.scrollWidth <= rail.clientWidth) return;
    const left = card.offsetLeft - rail.offsetLeft;
    const right = left + card.offsetWidth;
    if (left < rail.scrollLeft) rail.scrollTo({ left: Math.max(0, left - 8) });
    else if (right > rail.scrollLeft + rail.clientWidth) rail.scrollTo({ left: right - rail.clientWidth + 8 });
  }, [active?.key, offer.id]);

  // Only the time already on screen: a single card would offer nothing to choose.
  if (!active || (current && slots.length === 1)) return null;

  // One stop in the tab order for the whole strip, as radio buttons have; arrows move within it.
  const focusable = active.slots.some((slot) => slot.id === selectedId) ? selectedId : active.slots[0]?.id;

  function pick(id: string) {
    if (id === selectedId) return;
    setChosen(id);
    onPick(id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    const cards = [...(strip.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
    const index = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    cards[(index + keys[event.key] + cards.length) % cards.length]?.focus();
  }

  return (
    <section className="mt-4 px-1" aria-labelledby="vyber-casu">
      <h3 id="vyber-casu" className="text-sm font-bold text-ink">
        {current ? 'Vyber si čas' : 'Volné termíny'}
      </h3>

      {days.length > 1 ? (
        <div role="group" aria-label="Den" className="rail mt-2 flex gap-2 overflow-x-auto">
          {days.map((day) => {
            const selected = day.key === active.key;
            return (
              <Chip
                key={day.key}
                active={selected}
                aria-label={`${day.title}, počet časů: ${day.slots.length}`}
                onClick={() => setActiveDay(day.key)}
              >
                {day.title}
                <span className={cx('tnum ml-1.5 font-normal', selected ? 'text-surface/70' : 'text-muted')}>{day.slots.length}</span>
              </Chip>
            );
          })}
        </div>
      ) : (
        <p className="mt-1 text-sm font-bold text-accent">{active.title}</p>
      )}

      {/* Sideways on a phone, wrapped on a computer, where a sideways strip needs a wheel to reach. */}
      <div
        ref={strip}
        role="radiogroup"
        aria-labelledby="vyber-casu"
        onKeyDown={onKeyDown}
        className="rail -mx-1 mt-2 flex snap-x gap-2 overflow-x-auto px-1 pt-1 pb-3 md:grid md:grid-cols-2 md:overflow-visible"
      >
        {active.slots.map((slot) => {
          const row = timeRow(slot, now);
          const selected = slot.id === selectedId;
          const loading = selected && slot.id !== offer.id;
          return (
            <button
              key={slot.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={row.spoken}
              aria-busy={loading || undefined}
              tabIndex={slot.id === focusable ? 0 : -1}
              onPointerEnter={() => onIntent?.(slot.id)}
              onTouchStart={() => onIntent?.(slot.id)}
              onFocus={() => onIntent?.(slot.id)}
              onClick={() => pick(slot.id)}
              className={cx(
                'flex min-h-24 w-[7.75rem] shrink-0 snap-start flex-col items-start justify-center rounded-2xl px-3 py-2.5 text-left md:w-auto',
                'transition-[background-color,color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] active:scale-95',
                // A small shadow that fits inside the strip's padding: a larger one was cut off by the scroll box.
                selected ? 'bg-brand text-brand-ink shadow-[0_6px_12px_-6px_rgb(44_38_210/0.55)]' : 'scale-[0.97] bg-surface text-ink hover:bg-brand-soft',
                loading && 'animate-pulse',
              )}
            >
              {row.note ? (
                <span className={cx('mb-0.5 text-[0.6875rem] leading-tight font-bold', selected ? 'text-brand-ink/85' : row.note.tone === 'last' ? 'text-warning' : 'text-accent')}>
                  {row.note.text}
                </span>
              ) : null}
              <span className="tnum text-sm leading-tight font-extrabold">{row.range}</span>
              <span className="tnum mt-1 text-lg leading-none font-extrabold">{money(row.priceCents)}</span>
              {row.savedCents > 0 ? (
                <span className={cx('tnum mt-1 text-[0.6875rem] leading-tight font-bold', selected ? 'text-brand-ink/85' : 'text-accent')}>
                  ušetříš {money(row.savedCents)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
