import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, Navigation, X } from 'lucide-react';
import { Link } from '../../app/router';
import { buttonClass, cx } from '../../components/ui';
import { DiscountBadge, OriginalPrice } from '../../components/Price';
import { IllustrativePhotoLabel } from '../../components/IllustrativePhotoLabel';
import { useSnapCarousel } from '../../components/useSnapCarousel';
import { distance, money } from '../../lib/format';
import { navigationHref } from '../../lib/maps';
import { SERVICE_PLACEHOLDER, serviceIllustration } from '../../lib/serviceIllustrations';
import { thumbnail } from '../../lib/thumbnail';
import { clockTime, dayLabel, duration } from '../../lib/time';
import type { SearchRow } from '../../types/database';

/**
 * What a tapped pin opens: the appointment as a card with its photo, over the bottom of the
 * map, so the customer can compare it against the pins around it without leaving the map.
 * Several appointments at one address swipe sideways.
 */
export function MapPreviewCard({
  offers,
  now,
  detailHref,
  onClose,
  className,
}: {
  offers: SearchRow[];
  now: string;
  detailHref: (id: string) => string;
  onClose: () => void;
  className?: string;
}) {
  const carousel = useSnapCarousel<HTMLUListElement>(offers.length, offers.map((offer) => offer.id).join(':'));
  const many = offers.length > 1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section className={cx('pointer-events-none', className)} aria-label={many ? `${offers.length} termíny na tomto místě` : 'Vybraný termín'}>
      <ul
        ref={carousel.viewportRef}
        tabIndex={many ? 0 : -1}
        onScroll={carousel.onScroll}
        onKeyDown={carousel.onKeyDown}
        className="rail pointer-events-auto flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto overscroll-x-contain px-3 pb-3 -mb-3 touch-pan-x"
      >
        {offers.map((offer, index) => (
          <li
            key={offer.id}
            data-snap-item
            aria-label={many ? `Termín ${index + 1} z ${offers.length}` : undefined}
            className={cx('shrink-0 snap-start snap-always', many ? 'w-[calc(100%_-_2.25rem)] max-w-sm' : 'w-full max-w-sm')}
          >
            <PreviewCard
              offer={offer}
              now={now}
              to={detailHref(offer.id)}
              onClose={onClose}
              position={many ? `${index + 1} / ${offers.length}` : null}
            />
          </li>
        ))}
      </ul>
      {many ? (
        <div className="pointer-events-auto mt-2 hidden justify-center gap-2 md:flex">
          <button
            type="button"
            onClick={() => carousel.goTo(carousel.index - 1)}
            disabled={!carousel.canGoBack}
            aria-label="Předchozí termín"
            className="grid size-11 place-items-center rounded-full bg-card text-ink shadow-card disabled:opacity-40"
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => carousel.goTo(carousel.index + 1)}
            disabled={!carousel.canGoForward}
            aria-label="Další termín"
            className="grid size-11 place-items-center rounded-full bg-card text-ink shadow-card disabled:opacity-40"
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </section>
  );
}

/*
 * The full card is back (14. 9.): a compact row with only the name, time and price dropped the
 * discount, the struck list price, the distance and the way to get there, which are exactly what
 * decide a last-minute booking. The map keeps the pin in sight above it, because MapPage measures
 * the card and passes its real height as the area the camera has to avoid.
 */
function PreviewCard({
  offer,
  now,
  to,
  onClose,
  position,
}: {
  offer: SearchRow;
  now: string;
  to: string;
  onClose: () => void;
  position: string | null;
}) {
  const source = serviceIllustration(offer.service_name, offer.image_url, offer.cover_url);
  const [failed, setFailed] = useState(false);
  const photo = failed ? SERVICE_PLACEHOLDER : (thumbnail(source, 720, false) ?? SERVICE_PLACEHOLDER);
  const away = distance(offer.distance_m);
  const place = [offer.business_name, offer.district, away].filter(Boolean).join(' · ');

  return (
    <article className="overflow-hidden rounded-3xl bg-card shadow-lift">
      <div className="relative h-28 bg-accent-soft sm:h-32 [@media(max-height:720px)]:h-20">
        <img src={photo} alt="" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/35 to-transparent" aria-hidden="true" />
        {photo !== SERVICE_PLACEHOLDER ? <IllustrativePhotoLabel className="bottom-2.5 right-3" /> : null}
        <div className="absolute top-2.5 left-3 flex items-center gap-2">
          <DiscountBadge pct={offer.discount_pct} className="shadow-card" />
          {position ? (
            <span className="tnum rounded-full bg-card/90 px-2 py-0.5 text-xs font-bold text-ink" aria-hidden="true">
              {position}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zavřít náhled"
          className="absolute top-1.5 right-1.5 grid size-11 place-items-center rounded-full"
        >
          <span className="grid size-8 place-items-center rounded-full bg-card/95 text-ink shadow-card">
            <X size={17} aria-hidden="true" />
          </span>
        </button>
      </div>

      <div className="relative px-4 pb-4">
        <VenueBadge name={offer.business_name} logo={offer.logo_url} />
        <h3 className="mt-2 truncate text-lg leading-snug font-extrabold tracking-tight text-ink">{offer.service_name}</h3>
        <p className="truncate text-sm text-muted">{place}</p>

        <div className="mt-3 flex items-end justify-between gap-3">
          <p className="tnum flex min-w-0 items-center gap-1.5 text-sm">
            <Clock3 size={15} aria-hidden="true" className="shrink-0 text-accent" />
            <span className="truncate">
              <span className="font-bold text-ink">
                {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)}
              </span>
              <span className="text-muted"> · {duration(offer.start_at, offer.end_at)} min</span>
            </span>
          </p>
          <p className="tnum flex shrink-0 items-baseline gap-2">
            {offer.original_price_cents > offer.deal_price_cents ? (
              <OriginalPrice cents={offer.original_price_cents} className="text-sm" />
            ) : null}
            <span className="text-xl font-extrabold text-ink">{money(offer.deal_price_cents)}</span>
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <a
            href={navigationHref(offer)}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({ variant: 'soft', shape: 'pill' })}
          >
            <Navigation size={16} aria-hidden="true" />
            Navigovat
          </a>
          <Link to={to} className={buttonClass({ shape: 'pill' })}>
            Detail
          </Link>
        </div>
      </div>
    </article>
  );
}

/** The venue's logo, or its initial, sitting across the edge of the photo. */
function VenueBadge({ name, logo }: { name: string; logo: string | null }) {
  const [broken, setBroken] = useState(false);
  const ring = 'relative -mt-7 size-14 rounded-full border-4 border-card shadow-card';
  if (logo && !broken) {
    return <img src={logo} alt="" onError={() => setBroken(true)} className={cx(ring, 'bg-card object-cover')} />;
  }
  return (
    <span aria-hidden="true" className={cx(ring, 'grid place-items-center bg-brand text-xl font-extrabold text-brand-ink')}>
      {name.trim().charAt(0).toLocaleUpperCase('cs-CZ')}
    </span>
  );
}
