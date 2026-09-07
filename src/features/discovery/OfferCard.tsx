import { Link } from '../../app/router';
import { money, distance as formatDistance } from '../../lib/format';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { relativeTime } from '../../lib/clock';
import type { SearchRow } from '../../types/database';

/**
 * The single most important component. One loud element per card: the deal price.
 * `Poslední místo` appears only when a seat was actually taken — a 1-of-1 slot is the
 * normal case, not urgency.
 */
export function OfferCard({ offer, now }: { offer: SearchRow; now: string }) {
  const lastSeat = offer.capacity_remaining === 1 && offer.capacity_total > 1;
  const image = offer.image_url ?? offer.cover_url;

  return (
    <Link
      to={`/nabidka/${offer.id}`}
      className="group flex overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-card)] focus-visible:outline-2"
    >
      <div className="relative w-28 shrink-0 bg-line/60 sm:w-40">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            width={320}
            height={320}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted">VOLNO</div>
        )}
        <span className="tnum absolute top-2 left-2 rounded-lg bg-ink px-1.5 py-0.5 text-xs font-bold text-surface">
          −{offer.discount_pct} %
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-ink">{offer.service_name}</h3>
            <p className="truncate text-sm text-muted">
              {offer.business_name}
              {offer.district ? ` · ${offer.district}` : ''}
            </p>
          </div>
        </div>

        <p className="tnum text-sm text-muted">
          {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)} · {duration(offer.start_at, offer.end_at)} min ·{' '}
          {formatDistance(offer.distance_m)}
        </p>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="flex items-baseline gap-2">
            <span className="tnum text-lg font-extrabold text-ink">{money(offer.deal_price_cents)}</span>
            <span className="tnum text-sm text-muted line-through">{money(offer.original_price_cents)}</span>
          </div>
          <span className="tnum shrink-0 text-xs font-semibold text-muted">{relativeTime(offer.start_at, now)}</span>
        </div>

        {lastSeat ? <p className="text-xs font-bold text-accent">Poslední místo</p> : null}
      </div>
    </Link>
  );
}
