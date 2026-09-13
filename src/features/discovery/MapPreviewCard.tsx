import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Link } from '../../app/router';
import { cx } from '../../components/ui';
import { useSnapCarousel } from '../../components/useSnapCarousel';
import { money } from '../../lib/format';
import { SERVICE_PLACEHOLDER, serviceIllustration } from '../../lib/serviceIllustrations';
import { thumbnail } from '../../lib/thumbnail';
import { clockTime, dayLabel } from '../../lib/time';
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
  const photo = failed ? SERVICE_PLACEHOLDER : thumbnail(source, 176);
  return (
    <article className="relative rounded-2xl bg-card shadow-lift">
      <button type="button" onClick={onClose} aria-label="Zavřít náhled" className="absolute right-0 top-0 z-10 grid size-11 place-items-center rounded-full text-muted hover:bg-accent-soft"><X size={17} /></button>
      <Link to={to} aria-label={`${offer.service_name} — zobrazit detail`} className="flex min-h-[132px] items-center gap-3 rounded-2xl p-3 pr-11 focus-visible:outline-2 focus-visible:outline-accent">
        <img src={photo ?? SERVICE_PLACEHOLDER} onError={() => setFailed(true)} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-extrabold">{offer.service_name}</span>
          <span className="block truncate text-sm text-muted">{offer.business_name}</span>
          <span className="mt-1 block text-sm">{dayLabel(offer.start_at, now)} · {clockTime(offer.start_at)}</span>
          <span className="mt-1 flex items-baseline justify-between gap-2"><strong className="tnum text-lg">{money(offer.deal_price_cents)}</strong>{position ? <span className="text-xs text-muted">{position}</span> : null}</span>
        </span>
      </Link>
    </article>
  );
}
