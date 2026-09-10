import { useState } from 'react';
import { CalendarDays, Clock3, MapPin } from 'lucide-react';
import { Link, useRouter } from '../../app/router';
import { distance as formatDistance } from '../../lib/format';
import { DiscountBadge, Price } from '../../components/Price';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { relativeTime } from '../../lib/clock';
import { GooglePlaceRating } from '../ratings/GooglePlaceRating';
import type { SearchRow } from '../../types/database';

/**
 * The card the whole product is read through. Time leads, price closes, the discount only
 * supports — this is an opportunity, not a coupon. Urgency is never invented: the only
 * countdown shown is the real clock.
 *
 * The venue's identity sits on the photograph rather than in a text row, so the block
 * underneath can be facts alone.
 */
export function OfferCard({
  offer,
  now,
  compact,
  priority,
}: {
  offer: SearchRow;
  now: string;
  /** Drops the photograph — for the preview card floating over the map. */
  compact?: boolean;
  /** The one card above the fold: fetched eagerly so it is not the slow LCP element. */
  priority?: boolean;
}) {
  const { path, search } = useRouter();
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const origin = `${path}${search.size ? `?${search}` : ''}`;
  const photo = offer.image_url ?? offer.cover_url;
  const showPhoto = Boolean(photo) && photo !== failedPhoto && !compact;
  const minutesAway = Math.round((Date.parse(offer.start_at) - Date.parse(now)) / 60000);
  const startingSoon = minutesAway > 0 && minutesAway <= 120;
  const lastSeat = offer.capacity_remaining === 1 && offer.capacity_total > 1;
  const away = formatDistance(offer.distance_m);

  return (
    <Link
      to={`/nabidka/${offer.id}?from=${encodeURIComponent(origin)}`}
      className="group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl bg-card shadow-card transition-shadow duration-150 hover:shadow-lift"
    >
      {!compact ? (
        <div className="relative">
          {showPhoto ? (
            <img
              src={photo as string}
              onError={() => setFailedPhoto(photo as string)}
              alt=""
              loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : 'auto'}
              decoding="async"
              width={800}
              height={500}
              className="aspect-[8/5] w-full object-cover"
            />
          ) : (
            // A missing photograph keeps the same height, so a mixed grid stays even.
            <div className="aspect-[8/5] w-full bg-accent-soft" aria-hidden="true" />
          )}

          {/*
            The discount belongs on the picture, in the corner the identity scrim leaves free.
            In the price column it was 12 px in the same accent as the calendar glyph — the
            single most important number in a discount marketplace, rendered as a footnote.
          */}
          <DiscountBadge pct={offer.discount_pct} className="absolute top-3 left-3 shadow-card" />

          {/* Identity on the image: the scrim exists so white text survives a pale photo. */}
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-ink/75 to-transparent px-3 pt-8 pb-3">
            <VenueMark name={offer.business_name} logo={offer.logo_url} />
            <span className="truncate text-base font-bold text-card">{offer.business_name}</span>
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="text-base leading-snug font-extrabold text-ink [overflow-wrap:anywhere]">
          {offer.service_name}
        </h3>

        <p className="tnum flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          {offer.district ? <span>{offer.district}</span> : null}
          {offer.district && away ? <span aria-hidden="true">·</span> : null}
          {/* The favourites feed comes from offer_details, which carries no distance, so this
              segment has to disappear rather than render an icon next to nothing. */}
          {away ? (
            <>
              <span className="inline-flex items-center gap-1">
                <MapPin size={14} aria-hidden="true" />
                {away}
              </span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Clock3 size={14} aria-hidden="true" />
            {duration(offer.start_at, offer.end_at)} min
          </span>
          <GooglePlaceRating
            businessId={offer.business_id}
            placeId={offer.google_place_id}
            withSeparator
          />
          {lastSeat ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-bold text-ink">Poslední místo</span>
            </>
          ) : null}
        </p>

        {/*
          Centred, not bottom-aligned. The price column is two lines (price, then the struck
          original with the discount badge) while the time column is usually one, so aligning
          their bottoms left a hole under the time exactly the height of the second price
          line — it read as a missing element rather than as spacing.
        */}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <CalendarDays size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="tnum text-base leading-5 font-extrabold text-ink">
                {dayLabel(offer.start_at, now)} · {clockTime(offer.start_at)}
              </p>
            {startingSoon ? (
              <span className="tnum mt-0.5 block text-xs font-bold text-accent">
                Začíná {relativeTime(offer.start_at, now)}
              </span>
            ) : null}
            </div>
          </div>
          {/*
            The badge is on the photo already, so repeating it here would only crowd the two
            numbers that have to be compared. A compact card has no photo, so it keeps it.
          */}
          <Price
            className="shrink-0 text-right"
            align="right"
            dealCents={offer.deal_price_cents}
            originalCents={offer.original_price_cents}
            discountPct={offer.discount_pct}
            showBadge={Boolean(compact)}
            showSaving
          />
        </div>
      </div>
    </Link>
  );
}

/** Every seeded venue has an empty logo_url, so the initial is the normal case, not a fallback. */
function VenueMark({ name, logo }: { name: string; logo?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (logo && !broken) {
    return (
      <img
        src={logo}
        onError={() => setBroken(true)}
        alt=""
        width={56}
        height={56}
        className="size-7 shrink-0 rounded-full bg-card object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid size-7 shrink-0 place-items-center rounded-full bg-card text-sm font-bold text-ink"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
