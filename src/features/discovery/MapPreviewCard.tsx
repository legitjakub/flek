import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, X } from 'lucide-react';
import { Link } from '../../app/router';
import { cx } from '../../components/ui';
import { OriginalPrice } from '../../components/Price';
import { useSnapCarousel } from '../../components/useSnapCarousel';
import { money } from '../../lib/format';
import { SERVICE_PLACEHOLDER, serviceIllustration } from '../../lib/serviceIllustrations';
import { thumbnail } from '../../lib/thumbnail';
import { clockTime, dayLabel } from '../../lib/time';
import type { SearchRow } from '../../types/database';
import { groupSlots, type SlotGroup } from './slots';

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
  // One card per service at this address; the nearest time is summarized here.
  const groups = useMemo(() => groupSlots(offers), [offers]);
  const carousel = useSnapCarousel<HTMLUListElement>(groups.length, groups.map((group) => group.key).join(':'));
  const touch = useRef<{ x: number; y: number } | null>(null);
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
        onTouchStart={(event) => {
          const point = event.touches[0];
          touch.current = point ? { x: point.clientX, y: point.clientY } : null;
        }}
        onTouchEnd={(event) => {
          const start = touch.current;
          const point = event.changedTouches[0];
          touch.current = null;
          if (!start || !point) return;
          const dx = point.clientX - start.x;
          const dy = point.clientY - start.y;
          if (Math.abs(dx) < 32 || Math.abs(dx) <= Math.abs(dy)) return;
          carousel.goTo(carousel.index + (dx < 0 ? 1 : -1));
        }}
        // A horizontal scroller clips vertically too, and the lifted glass shadow (40 px blur,
        // 18 px down) only fades out about 60 px below the card. With 12 px of room it ended in
        // a hard line level with the top of the tab bar; the padding now holds the whole shadow
        // and the negative margins keep the card where it was. The extra room below sits under
        // the tab bar, which stays on top and keeps its taps.
        className="rail pointer-events-auto flex snap-x snap-mandatory scroll-px-3 gap-2 overflow-x-auto overscroll-x-contain px-3 pt-2 pb-16 -mt-2 -mb-16 touch-pan-x"
      >
        {groups.map((group, index) => (
          <li
            key={group.key}
            data-snap-item
            aria-label={many ? `Služba ${index + 1} z ${groups.length}` : undefined}
            className="flex w-[calc(100%_-_1.5rem)] max-w-sm shrink-0 snap-start snap-always"
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

/**
 * The map preview answers only the four questions needed before opening a FLEK: what, where,
 * when and for how much. Everything else belongs to the detail page. Keeping the card to one
 * compact row leaves the map useful even on a 375 px phone.
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
  const offer: SearchRow = group.lead;
  const source = serviceIllustration(offer.service_name, offer.image_url, offer.category_slug);
  const [failed, setFailed] = useState(false);
  const photo = failed ? SERVICE_PLACEHOLDER : (thumbnail(source, 320, false) ?? SERVICE_PLACEHOLDER);
  const otherTimes = Math.max(0, group.slots.length - 1);

  return (
    <article className="glass glass-lift relative h-[136px] w-full overflow-hidden rounded-[1.65rem]">
      <Link to={detailHref(offer.id)} className="group flex h-full min-w-0 pr-11 focus-visible:outline-none">
        <span className="relative w-[6.75rem] shrink-0 overflow-hidden bg-accent-soft" aria-hidden="true">
          <img src={photo} alt="" decoding="async" onError={() => setFailed(true)} className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.025]" />
          {position ? (
            <span className="glass tnum absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-bold text-ink">
              {position}
            </span>
          ) : null}
        </span>

        <span className="flex min-w-0 flex-1 flex-col px-3 py-3">
          <span className="line-clamp-2 pr-1 text-sm leading-[1.05rem] font-extrabold tracking-tight text-ink">{offer.service_name}</span>
          <span className="mt-0.5 truncate text-xs text-muted">{offer.business_name}</span>
          <span className="tnum mt-auto flex min-w-0 items-center gap-1.5 text-sm text-ink">
            <Clock3 size={15} aria-hidden="true" className="shrink-0 text-accent" />
            <span className="truncate font-bold">{dayLabel(offer.start_at, now)} · {clockTime(offer.start_at)}</span>
          </span>
          <span className="mt-1 flex min-w-0 items-end justify-between gap-2">
            <span className="truncate text-xs font-bold text-accent">
              {otherTimes ? `+${otherTimes} ${otherTimes === 1 ? 'další čas' : otherTimes < 5 ? 'další časy' : 'dalších časů'}` : 'Otevřít detail'}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="tnum text-lg leading-none font-extrabold text-ink">{money(offer.deal_price_cents)}</span>
              {offer.original_price_cents > offer.deal_price_cents ? (
                <OriginalPrice cents={offer.original_price_cents} className="text-[11px] leading-none" />
              ) : null}
            </span>
          </span>
        </span>
      </Link>

      <button
        type="button"
        onClick={onClose}
        aria-label="Zavřít náhled"
        className="absolute top-1 right-1 grid size-11 place-items-center rounded-full text-ink"
      >
        <span className="grid size-8 place-items-center rounded-full bg-card/90 shadow-card backdrop-blur-sm">
          <X size={17} aria-hidden="true" />
        </span>
      </button>
    </article>
  );
}
