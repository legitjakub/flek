import { useEffect, useMemo, useState } from 'react';
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
import { CapacityLabel } from '../../components/CapacityLabel';
import { groupSlots, slotLabels, type SlotGroup } from './slots';

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
  // One card per service at this address; its times are picked on the card.
  const groups = useMemo(() => groupSlots(offers), [offers]);
  const carousel = useSnapCarousel<HTMLUListElement>(groups.length, groups.map((group) => group.key).join(':'));
  const many = groups.length > 1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section className={cx('pointer-events-none', className)} aria-label={many ? `${groups.length} ${groups.length < 5 ? 'služby' : 'služeb'} na tomto místě` : 'Vybraný termín'}>
      <ul
        ref={carousel.viewportRef}
        tabIndex={many ? 0 : -1}
        onScroll={carousel.onScroll}
        onKeyDown={carousel.onKeyDown}
        className="rail pointer-events-auto flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto overscroll-x-contain px-3 pb-3 -mb-3 touch-pan-x"
      >
        {groups.map((group, index) => (
          <li
            key={group.key}
            data-snap-item
            aria-label={many ? `Služba ${index + 1} z ${groups.length}` : undefined}
            // A flex item, so every card stretches to the tallest one in the row: a capacity label or a row of
            // times on one card no longer leaves the others shorter and floating higher.
            className={cx('flex shrink-0 snap-start snap-always', many ? 'w-[calc(100%_-_2.25rem)] max-w-sm' : 'w-full max-w-sm')}
          >
            <PreviewCard
              group={group}
              now={now}
              detailHref={detailHref}
              onClose={onClose}
              position={many ? `${index + 1} / ${groups.length}` : null}
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
            aria-label="Předchozí služba"
            className="grid size-11 place-items-center rounded-full bg-card text-ink shadow-card disabled:opacity-40"
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => carousel.goTo(carousel.index + 1)}
            disabled={!carousel.canGoForward}
            aria-label="Další služba"
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
  group,
  now,
  detailHref,
  onClose,
  position,
}: {
  group: SlotGroup;
  now: string;
  detailHref: (id: string) => string;
  onClose: () => void;
  position: string | null;
}) {
  const [selectedId, setSelectedId] = useState(group.lead.id);
  const offer: SearchRow = group.slots.find((slot) => slot.id === selectedId) ?? group.lead;
  const times = group.slots.length > 1 ? slotLabels(group.slots, now, { priceCents: offer.deal_price_cents }) : [];
  const source = serviceIllustration(offer.service_name, offer.image_url, offer.category_slug);
  const [failed, setFailed] = useState(false);
  const photo = failed ? SERVICE_PLACEHOLDER : (thumbnail(source, 720, false) ?? SERVICE_PLACEHOLDER);
  const away = distance(offer.distance_m);
  const place = [offer.business_name, offer.district, away].filter(Boolean).join(' · ');

  return (
    <article className="flex w-full flex-col overflow-hidden rounded-3xl bg-card shadow-lift">
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

      <div className="relative flex flex-1 flex-col p-4">
        <h3 className="truncate text-lg leading-snug font-extrabold tracking-tight text-ink">{offer.service_name}</h3>
        <p className="truncate text-sm text-muted">{place}</p>
        <div className="mt-1 flex min-h-5 items-center empty:hidden">
          <CapacityLabel remaining={offer.capacity_remaining} total={offer.capacity_total} />
        </div>

        {times.length ? (
          <div role="group" aria-label={`${times.length} ${times.length < 5 ? "časy" : "časů"}, vyber si`} className="rail -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4">
            {times.map((time) => {
              const selected = time.id === offer.id;
              return (
                <button
                  key={time.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={time.spoken}
                  onClick={() => setSelectedId(time.id)}
                  className={cx(
                    'tnum inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3 text-sm font-bold transition-colors',
                    selected ? 'border-ink bg-ink text-accent-ink' : 'border-line bg-card text-ink hover:bg-surface',
                  )}
                >
                  {time.label}
                  {time.priceCents !== null ? <span className={cx('text-xs font-normal', selected ? 'text-accent-ink/80' : 'text-muted')}>{money(time.priceCents)}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
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
          <Link to={detailHref(offer.id)} className={buttonClass({ shape: 'pill' })}>
            Detail
          </Link>
        </div>
      </div>
    </article>
  );
}
