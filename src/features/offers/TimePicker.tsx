import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { clockTime, dayKey, dayLabel } from '../../lib/time';
import { relativeTime } from '../../lib/clock';
import { money } from '../../lib/format';
import { cx } from '../../components/ui';
import { slotLabels, slotsByDay } from '../discovery/slots';
import type { OfferDetail, SearchRow } from '../../types/database';

/** Four compact choices fill two rows on a phone; more stay one tap away. */
const SHOWN_PER_DAY = 4;
const SOON_MINUTES = 120;

/**
 * A mobile-first time chooser for one service. The day is chosen once in the rail and the service
 * duration stays in the selected-FLEK summary above, so neither has to be repeated on every tile.
 * Price remains on each tile because it can change from one last-minute slot to another.
 */
export function TimePicker({
  offer,
  slots,
  now,
  pendingId,
  onPick,
}: {
  offer: OfferDetail;
  slots: SearchRow[];
  now: string;
  pendingId: string | null;
  onPick: (id: string) => void;
}) {
  const current = slots.some((slot) => slot.id === offer.id);
  // The current slot already has a complete summary above this chooser. Showing it again here
  // made the phone screen feel like two competing selections, so this list contains alternatives.
  const times = slots.filter((slot) => slot.id !== offer.id);
  const days = useMemo(() => slotsByDay(times, now), [times, now]);
  const offerDay = dayKey(offer.start_at);
  const selectedDay = days.some((day) => day.key === offerDay) ? offerDay : days[0]?.key;
  const [activeDay, setActiveDay] = useState(selectedDay ?? '');
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  useEffect(() => {
    if (selectedDay) setActiveDay(selectedDay);
  }, [selectedDay]);

  if (times.length === 0 || days.length === 0) return null;

  const active = days.find((day) => day.key === activeDay) ?? days[0];
  const isExpanded = expandedDay === active.key;
  const visible = isExpanded ? active.slots : active.slots.slice(0, SHOWN_PER_DAY);
  const remaining = active.slots.length - visible.length;
  const last = new Map(slotLabels(times, now).map((label) => [label.id, label.last]));

  return (
    <section className="mt-4 px-1" aria-labelledby="vyber-casu">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="vyber-casu" className="text-sm font-bold text-ink">
          {current ? 'Další termíny' : 'Volné termíny'}
        </h3>
      </div>

      {days.length > 1 ? (
        <div
          role="group"
          aria-label="Den termínu"
          className="mt-1 flex snap-x gap-5 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {days.map((day) => {
            const selected = day.key === active.key;
            return (
              <button
                key={day.key}
                type="button"
                aria-pressed={selected}
                aria-label={`${day.title}, počet termínů: ${day.slots.length}`}
                onClick={() => {
                  setActiveDay(day.key);
                  setExpandedDay(null);
                }}
                className={cx(
                  'min-h-11 shrink-0 snap-start border-b-2 px-1 text-sm font-bold transition-colors',
                  selected
                    ? 'border-brand text-brand'
                    : 'border-transparent text-muted hover:border-brand/30 hover:text-accent',
                )}
              >
                {day.title}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-2.5 text-sm font-bold text-accent">{active.title}</p>
      )}

      <div
        role="group"
        aria-label={`${active.title}: dostupné časy`}
        className="mt-3 grid grid-cols-2 gap-2"
      >
        {visible.map((slot) => {
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
                slot.discount_pct > 0 ? `sleva ${slot.discount_pct} procent` : null,
                lastSeat ? 'poslední místo' : null,
              ].filter(Boolean).join(', ')}
              aria-busy={pending || undefined}
              disabled={pendingId !== null && !pending}
              onClick={() => onPick(slot.id)}
              className={cx(
                'relative min-h-14 rounded-xl px-3 py-2.5 text-left transition-[background-color,transform] active:scale-[0.98] disabled:opacity-55',
                'bg-surface hover:bg-brand-soft',
                pending && 'animate-pulse',
              )}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                <span className="tnum text-base leading-none font-extrabold">{clockTime(slot.start_at)}</span>
                <span className="tnum text-xs font-semibold text-muted">{money(slot.deal_price_cents)}</span>
              </span>
              {soon || lastSeat ? (
                <span className={cx('mt-1 block text-[0.6875rem] font-bold', lastSeat ? 'text-warning' : 'text-accent')}>
                  {lastSeat ? 'Poslední místo' : relativeTime(slot.start_at, now)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {remaining > 0 ? (
        <button
          type="button"
          onClick={() => setExpandedDay(active.key)}
          className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-bold text-accent hover:bg-brand-soft"
        >
          Zobrazit další časy ({remaining})
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}
