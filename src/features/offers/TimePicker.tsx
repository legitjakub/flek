import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { dayKey } from '../../lib/time';
import { money } from '../../lib/format';
import { Chip, cx } from '../../components/ui';
import { slotsByDay } from '../discovery/slots';
import type { OfferDetail, SearchRow } from '../../types/database';
import { timeRow, visibleCount } from './timeRows';

/**
 * The times of one service, as a list the customer picks from. Each row says the whole range and
 * what that time saves, because the start and a price did not: "16:00 · 223 Kč" left the length
 * and the saving to arithmetic.
 *
 * The chosen time stays in the list, marked. It used to be taken out, so a tap made the tapped
 * row vanish, the rest shuffle into its place and the card above change without a transition:
 * the whole block jumped. Now only the mark moves, at once, while the page loads that time.
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
  /** A finger or pointer on its way to a row: time to fetch that row's page. */
  onIntent?: (id: string) => void;
}) {
  const current = slots.some((slot) => slot.id === offer.id);
  const days = useMemo(() => slotsByDay(slots, now), [slots, now]);
  const offerDay = dayKey(offer.start_at);
  const selectedDay = days.some((day) => day.key === offerDay) ? offerDay : days[0]?.key;
  const [activeDay, setActiveDay] = useState(selectedDay ?? '');
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  // The row just tapped is marked before its page arrives; the page then confirms it.
  const [chosen, setChosen] = useState<string | null>(null);
  const group = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedDay) setActiveDay(selectedDay);
  }, [selectedDay]);
  useEffect(() => {
    setChosen(null);
  }, [offer.id]);

  // Only the time already on screen: a single row would offer nothing to choose.
  if (days.length === 0 || (current && slots.length === 1)) return null;

  const active = days.find((day) => day.key === activeDay) ?? days[0];
  const selectedId = chosen ?? pendingId ?? (current ? offer.id : null);
  const selectedIndex = active.slots.findIndex((slot) => slot.id === selectedId);
  const shown = visibleCount(active.slots.length, selectedIndex, expandedDay === active.key);
  const visible = active.slots.slice(0, shown);
  const remaining = active.slots.length - visible.length;
  // One stop in the tab order for the whole list, as radio buttons have; arrows move within it.
  const focusable = selectedIndex >= 0 && selectedIndex < visible.length ? visible[selectedIndex].id : visible[0]?.id;

  function pick(id: string) {
    if (id === selectedId) return;
    setChosen(id);
    onPick(id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (!(event.key in keys)) return;
    const radios = [...(group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
    const index = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    radios[(index + keys[event.key] + radios.length) % radios.length]?.focus();
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
                onClick={() => {
                  setActiveDay(day.key);
                  setExpandedDay(null);
                }}
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

      <div
        ref={group}
        role="radiogroup"
        aria-labelledby="vyber-casu"
        onKeyDown={onKeyDown}
        className="mt-3 flex flex-col gap-2"
      >
        {visible.map((slot) => {
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
                'flex min-h-14 w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-[background-color,box-shadow] duration-200 active:scale-[0.99]',
                selected ? 'bg-brand-soft ring-2 ring-brand' : 'bg-surface ring-0 ring-brand hover:bg-brand-soft/60',
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors duration-200',
                  selected ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-card',
                )}
              >
                {selected ? (loading ? <span className="size-2 animate-pulse rounded-full bg-brand-ink" /> : <Check size={14} strokeWidth={3} />) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="tnum block text-base leading-tight font-extrabold text-ink">{row.range}</span>
                {row.note ? (
                  <span className={cx('mt-0.5 block text-xs font-bold', row.note.tone === 'last' ? 'text-warning' : 'text-accent')}>{row.note.text}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-right">
                <span className="tnum block text-base leading-tight font-extrabold text-ink">{money(row.priceCents)}</span>
                {row.savedCents > 0 ? (
                  <span className="tnum mt-0.5 block text-xs font-bold text-accent">ušetříš {money(row.savedCents)}</span>
                ) : null}
              </span>
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
