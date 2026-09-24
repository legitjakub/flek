import { useState } from 'react';
import { activityPhotoSrcSet } from '../../lib/activityGalleries';
import { CalendarDays, Clock3, MapPin } from 'lucide-react';
import { Link, useRouter } from '../../app/router';
import { distance as formatDistance, money } from '../../lib/format';
import { DiscountBadge, OriginalPrice, Price } from '../../components/Price';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { relativeTime } from '../../lib/clock';
import { GooglePlaceRating } from '../ratings/GooglePlaceRating';
import type { SearchRow } from '../../types/database';
import { IllustrativePhotoLabel } from '../../components/IllustrativePhotoLabel';
import { isIllustrativeServiceImage, SERVICE_PLACEHOLDER, serviceIllustration } from '../../lib/serviceIllustrations';
import { CapacityLabel } from '../../components/CapacityLabel';
import { cx } from '../../components/ui';
import { slotLabels, visibleSlots } from './slots';

/**
 * The card the whole product is read through. The photograph is the card: the facts sit on a
 * frosted panel laid over its lower edge, and only the two things that decide a tap — when it
 * starts and how deep the discount is — ride on the picture itself.
 *
 * Time leads, price closes, the discount only supports — this is an opportunity, not a coupon.
 * Urgency is never invented: the only countdown shown is the real clock.
 */
export function OfferCard({
  offer,
  slots,
  now,
  compact,
  priority,
  tall,
}: {
  offer: SearchRow;
  /** Every free time of this service at this venue, the card's own included. */
  slots?: SearchRow[];
  now: string;
  /** Drops the photograph — for the preview card floating over the map. */
  compact?: boolean;
  /** The one card above the fold: fetched eagerly so it is not the slow LCP element. */
  priority?: boolean;
  /** Portrait rather than square, for the rails where a card stands beside its neighbours. */
  tall?: boolean;
}) {
  const { path, search } = useRouter();
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const origin = `${path}${search.size ? `?${search}` : ''}`;
  const to = `/nabidka/${offer.id}?from=${encodeURIComponent(origin)}`;
  const source = serviceIllustration(offer.service_name, offer.image_url, offer.category_slug);
  const photo = source === failedPhoto ? SERVICE_PLACEHOLDER : source;
  const minutesAway = Math.round((Date.parse(offer.start_at) - Date.parse(now)) / 60000);
  const startingSoon = minutesAway > 0 && minutesAway <= 120;
  const away = formatDistance(offer.distance_m);
  const otherLabels = slotLabels((slots ?? []).filter((slot) => slot.id !== offer.id), now, { after: offer });
  const otherTimes = visibleSlots(otherLabels, 3);
  const discounted = offer.original_price_cents > offer.deal_price_cents;

  const meta = (
    <>
      {offer.district ? (
        <>
          <span>{offer.district}</span>
          {away ? <span aria-hidden="true">·</span> : null}
        </>
      ) : null}
      {away ? (
        <span className="inline-flex items-center gap-1">
          <MapPin size={13} aria-hidden="true" />
          {away}
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1">
        <Clock3 size={13} aria-hidden="true" />
        {duration(offer.start_at, offer.end_at)} min
      </span>
      <GooglePlaceRating businessId={offer.business_id} placeId={offer.google_place_id} withSeparator />
      <CapacityLabel remaining={offer.capacity_remaining} total={offer.capacity_total} />
    </>
  );

  /** The other times of the same FLEK, as plain labels: a time is picked on the detail page. */
  const times = otherTimes.shown.length ? (
    <p
      className="mt-2 flex flex-wrap items-center gap-1.5"
      aria-label={`Další časy: ${otherLabels.map((time) => time.spoken).join('; ')}`}
    >
      <span className="text-xs font-bold text-muted" aria-hidden="true">Další časy</span>
      {otherTimes.shown.map((time) => (
        <span
          key={time.id}
          aria-hidden="true"
          className={cx(
            'tnum rounded-full border px-2 py-0.5 text-xs font-bold',
            compact
              ? 'border-line text-ink'
              : 'border-brand/15 bg-card/70 text-accent shadow-sm',
          )}
        >
          {time.label}
        </span>
      ))}
      {otherTimes.more ? (
        <span aria-hidden="true" className="tnum rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">
          +{otherTimes.more}
        </span>
      ) : null}
    </p>
  ) : null;

  // Over the map the photograph is the map itself, so this card is facts on white.
  if (compact) {
    return (
      <Link
        to={to}
        className="group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl bg-card shadow-card transition-shadow duration-150 hover:shadow-lift"
      >
        <div className="flex flex-1 flex-col gap-3 p-4">
          <h3 className="text-base leading-snug font-extrabold text-ink [overflow-wrap:anywhere]">
            {offer.service_name}
          </h3>
          <p className="tnum flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">{meta}</p>
          {times}
          <div className={cx(otherTimes.shown.length ? '' : 'mt-auto', 'flex items-center justify-between gap-3 border-t border-line pt-3')}>
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
            <Price
              className="shrink-0 text-right"
              align="right"
              dealCents={offer.deal_price_cents}
              originalCents={offer.original_price_cents}
              discountPct={offer.discount_pct}
            />
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={to}
      className={cx(
        'group relative block w-full overflow-hidden rounded-3xl bg-accent-soft shadow-card transition-shadow duration-150 hover:shadow-lift',
        tall ? 'aspect-[4/5]' : 'aspect-square',
      )}
    >
      {photo ? (
        <img
          src={photo}
          srcSet={activityPhotoSrcSet(photo)}
          sizes={tall ? '320px' : '(min-width: 1024px) 400px, (min-width: 768px) 50vw, 100vw'}
          onError={() => setFailedPhoto(source)}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          width={800}
          height={800}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}

      {/*
        The two facts that decide a tap ride on the picture, in the corners a photograph can
        spare: when it starts, and how much is off. Everything else waits on the panel below.
      */}
      <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
        <span className="glass tnum inline-flex min-w-0 items-center gap-1.5 rounded-full py-1.5 pr-3 pl-2.5 text-sm leading-none font-extrabold text-ink">
          <Clock3 size={14} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="truncate">
            {startingSoon
              ? `${clockTime(offer.start_at)} · ${relativeTime(offer.start_at, now)}`
              : `${dayLabel(offer.start_at, now)} ${clockTime(offer.start_at)}`}
          </span>
        </span>
        <DiscountBadge pct={offer.discount_pct} size="lg" className="shrink-0 shadow-card" />
      </div>

      {isIllustrativeServiceImage(photo) ? (
        <IllustrativePhotoLabel className={offer.discount_pct > 0 ? 'top-13 right-4' : 'top-4 right-4'} />
      ) : null}

      {/*
        The same glass as the chip above it, only bigger and lifted higher — one material for the
        whole app instead of a second one for this card. The panel that stood here mixed a
        diagonal brand tint, an inset highlight, a coloured drop shadow and a gradient hairline
        and came out opaque: all that machinery for a white slab, with the photograph gone from
        under it. What makes the card FLEK's is the blue on the price and on the times, where the
        colour carries a meaning — not a wash over the whole sheet.

        The radius is concentric with the card: 2rem outer, 0.625rem inset, 1.375rem here.
      */}
      <div className="glass glass-lift absolute inset-x-2.5 bottom-2.5 rounded-[1.375rem] p-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-base leading-snug font-extrabold text-ink [overflow-wrap:anywhere]">
              {offer.service_name}
            </h3>
            <p className="truncate text-sm text-muted">{offer.business_name}</p>
          </div>
          {/*
            The price closes the card, so it is the one filled element on the panel — and the
            list price under it is struck, because that is the number nobody pays.
          */}
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="tnum inline-flex items-center rounded-full bg-brand px-3 py-1.5 text-base leading-none font-extrabold text-brand-ink">
              {money(offer.deal_price_cents)}
            </span>
            {discounted ? <OriginalPrice cents={offer.original_price_cents} className="text-xs" /> : null}
          </div>
        </div>

        <p className="tnum mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted [&_svg]:text-accent">{meta}</p>
        {times}
      </div>
    </Link>
  );
}
