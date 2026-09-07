import { Link } from '../../app/router';
import { money, distance as formatDistance } from '../../lib/format';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { relativeTime } from '../../lib/clock';
import { cx } from '../../components/ui';
import type { SearchRow } from '../../types/database';

/** Under two hours away is the moment this product exists for; say it plainly, once. */
function urgency(offer: SearchRow, now: string): string | null {
  const minutes = Math.round((Date.parse(offer.start_at) - Date.parse(now)) / 60000);
  if (minutes <= 0 || minutes > 120) return null;
  return `Začíná ${relativeTime(offer.start_at, now)}`;
}

function Thumb({ offer, className }: { offer: SearchRow; className: string }) {
  const image = offer.image_url ?? offer.cover_url;
  return (
    <div className={cx('relative shrink-0 overflow-hidden bg-line/50', className)}>
      {image ? (
        <img src={image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,var(--color-line),var(--color-surface))]">
          <span className="text-xs font-bold tracking-wide text-muted">FLEK</span>
        </div>
      )}
      <span className="tnum absolute top-2 left-2 rounded-md bg-ink/90 px-1.5 py-0.5 text-xs font-bold text-surface backdrop-blur">
        −{offer.discount_pct} %
      </span>
    </div>
  );
}

function Price({ offer, size = 'md' }: { offer: SearchRow; size?: 'md' | 'sm' }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={cx('tnum font-extrabold text-ink', size === 'md' ? 'text-lg' : 'text-base')}>
        {money(offer.deal_price_cents)}
      </span>
      <span className="tnum text-sm text-muted line-through">{money(offer.original_price_cents)}</span>
    </div>
  );
}

/**
 * The single most important component. One loud element: the deal price. `Poslední místo`
 * appears only when a seat was actually taken — a 1-of-1 slot is the normal case, and fake
 * urgency is exactly the pattern this product has to avoid.
 */
export function OfferCard({ offer, now }: { offer: SearchRow; now: string }) {
  const lastSeat = offer.capacity_remaining === 1 && offer.capacity_total > 1;
  const soon = urgency(offer, now);

  return (
    <Link
      to={`/nabidka/${offer.id}`}
      className="group flex gap-3 rounded-2xl border border-line bg-card p-3 transition-colors hover:border-ink/25 focus-visible:outline-2"
    >
      <Thumb offer={offer} className="h-24 w-24 rounded-xl sm:h-28 sm:w-36" />

      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="truncate text-base font-bold text-ink">{offer.service_name}</h3>
        <p className="truncate text-sm text-muted">
          {offer.business_name}
          {offer.district ? ` · ${offer.district}` : ''}
        </p>

        <p className="tnum mt-1 text-sm text-ink">
          <span className="font-semibold">
            {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)}
          </span>
          <span className="text-muted">
            {' · '}
            {duration(offer.start_at, offer.end_at)} min · {formatDistance(offer.distance_m)}
          </span>
        </p>

        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-1 pt-2">
          <Price offer={offer} />
          <div className="flex flex-wrap items-center gap-1.5">
            {soon ? (
              <span className="tnum rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-bold text-accent">{soon}</span>
            ) : null}
            {lastSeat ? (
              <span className="rounded-md bg-surface px-1.5 py-0.5 text-xs font-bold text-ink">Poslední místo</span>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}

/** Narrow card for the horizontal rails, where a full-width row would not fit. */
export function OfferTile({ offer, now }: { offer: SearchRow; now: string }) {
  return (
    <Link
      to={`/nabidka/${offer.id}`}
      className="flex w-44 shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-card transition-colors hover:border-ink/25 focus-visible:outline-2 sm:w-52"
    >
      <Thumb offer={offer} className="aspect-[4/3] w-full" />
      <div className="flex flex-1 flex-col p-3">
        <h3 className="truncate text-sm font-bold text-ink">{offer.service_name}</h3>
        <p className="truncate text-xs text-muted">{offer.business_name}</p>
        <p className="tnum mt-1 text-xs font-semibold text-ink">
          {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)}
          <span className="font-normal text-muted"> · {formatDistance(offer.distance_m)}</span>
        </p>
        <div className="mt-auto pt-2">
          <Price offer={offer} size="sm" />
        </div>
      </div>
    </Link>
  );
}
