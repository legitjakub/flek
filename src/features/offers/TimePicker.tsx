import { clockTime, dayLabel } from '../../lib/time';
import { money } from '../../lib/format';
import { cx } from '../../components/ui';
import { slotLabels, slotsByDay } from '../discovery/slots';
import type { OfferDetail, SearchRow } from '../../types/database';

/**
 * The other free times of the same service at the same venue. Each time is its own offer, so picking
 * one moves the page to it: price, seats, cancellation terms and the booking all follow the time.
 * Nothing is shown when the service has a single time.
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
  const current = slots.some((slot) => slot.id === offer.id);
  // A time that can no longer be booked is not offered again, but its neighbours are.
  const times = current ? slots : slots.filter((slot) => slot.id !== offer.id);
  if (times.length < (current ? 2 : 1)) return null;

  const labels = new Map(slotLabels(times, now, { priceCents: offer.deal_price_cents }).map((label) => [label.id, label]));
  // Day headings help only when a day has several times; one time a day reads better as "Zítra 13:00" in a single row.
  const byDay = slotsByDay(times, now);
  const sectioned = byDay.some((day) => day.slots.length > 1);
  const days = sectioned ? byDay : [{ key: 'all', title: '', slots: times }];

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p id="vyber-casu" className="text-sm font-bold text-ink">
        {current ? 'Vyber si čas' : 'Jiné časy téhle služby'}
      </p>
      {days.map((day) => (
        <div key={day.key} className="mt-2">
          {days.length > 1 ? <p className="text-xs font-bold text-muted">{day.title}</p> : null}
          <div role="group" aria-labelledby="vyber-casu" className="mt-1 flex flex-wrap gap-2">
            {day.slots.map((slot) => {
              const label = labels.get(slot.id);
              const selected = slot.id === offer.id;
              const pending = slot.id === pendingId;
              return (
                <button
                  key={slot.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={label?.spoken}
                  aria-busy={pending || undefined}
                  disabled={pendingId !== null && !pending}
                  onClick={() => {
                    if (!selected) onPick(slot.id);
                  }}
                  className={cx(
                    'tnum inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-bold transition-colors disabled:opacity-55',
                    selected ? 'border-ink bg-ink text-accent-ink' : 'border-line bg-card text-ink hover:bg-surface',
                    pending && 'animate-pulse',
                  )}
                >
                  {sectioned ? clockTime(slot.start_at) : `${dayLabel(slot.start_at, now)} ${clockTime(slot.start_at)}`}
                  {label?.priceCents != null ? (
                    <span className={cx('text-xs font-normal', selected ? 'text-accent-ink/80' : 'text-muted')}>{money(label.priceCents)}</span>
                  ) : null}
                  {label?.last ? (
                    <span className={cx('text-xs font-normal', selected ? 'text-accent-ink/80' : 'text-warning')}>poslední</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
