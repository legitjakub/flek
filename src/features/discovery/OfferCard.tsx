import { ArrowUpRight, Clock3, MapPin } from 'lucide-react';
import { Link, useRouter } from '../../app/router';
import { money, distance as formatDistance } from '../../lib/format';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { relativeTime } from '../../lib/clock';
import { Rating } from '../../components/ui';
import type { SearchRow } from '../../types/database';

/**
 * The card the whole product is read through. Time leads, price follows, the discount
 * supports — the offer is an opportunity, not a coupon. Urgency is only ever the real
 * clock: no invented scarcity, no countdown that is not true.
 */
export function OfferCard({
  offer,
  now,
  compact,
  priority,
}: {
  offer: SearchRow;
  now: string;
  compact?: boolean;
  /** The one card above the fold: fetched eagerly so it is not the slow LCP element. */
  priority?: boolean;
}) {
  const { path, search } = useRouter();
  const origin = `${path}${search.size ? `?${search}` : ''}`;
  const photo = offer.image_url ?? offer.cover_url;
  const minutesAway = Math.round((Date.parse(offer.start_at) - Date.parse(now)) / 60000);
  const startingSoon = minutesAway > 0 && minutesAway <= 120;
  const lastSeat = offer.capacity_remaining === 1 && offer.capacity_total > 1;

  return (
    <Link
      to={`/nabidka/${offer.id}?from=${encodeURIComponent(origin)}`}
      className="offer-card group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-card transition duration-150 hover:border-accent/40 hover:shadow-card"
    >
      {photo && !compact ? (
        <img
          src={photo}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          width={800}
          height={400}
          className="aspect-[2/1] w-full bg-line/40 object-cover"
        />
      ) : null}

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base leading-snug font-extrabold text-ink [overflow-wrap:anywhere]">
              {offer.service_name}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-muted [overflow-wrap:anywhere]">
              {offer.business_name}
              {offer.district ? ` · ${offer.district}` : ''}
            </p>
          </div>
          <ArrowUpRight
            aria-hidden="true"
            size={18}
            className="mt-0.5 shrink-0 text-muted transition-colors group-hover:text-accent"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="tnum rounded-lg bg-accent-soft px-3 py-2 text-base font-extrabold text-accent">
            {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)}
          </p>
          {startingSoon ? (
            <span className="tnum text-sm font-bold text-accent">Začíná {relativeTime(offer.start_at, now)}</span>
          ) : null}
          {lastSeat ? <span className="text-sm font-semibold text-muted">Poslední místo</span> : null}
        </div>

        <p className="tnum mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 size={15} aria-hidden="true" />
            {duration(offer.start_at, offer.end_at)} min
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={15} aria-hidden="true" />
            {formatDistance(offer.distance_m)}
          </span>
          <Rating average={offer.rating_avg} count={offer.rating_count} />
        </p>

        <div className="mt-auto flex flex-wrap items-baseline gap-2 pt-4">
          <span className="tnum text-xl font-extrabold tracking-tight">{money(offer.deal_price_cents)}</span>
          <s className="tnum text-sm text-muted">{money(offer.original_price_cents)}</s>
          <span className="tnum ml-auto text-sm font-bold text-accent">−{offer.discount_pct} %</span>
        </div>
      </div>
    </Link>
  );
}
