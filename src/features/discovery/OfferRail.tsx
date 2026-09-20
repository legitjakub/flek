import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSnapCarousel } from '../../components/useSnapCarousel';
import { OfferCard } from './OfferCard';
import type { SearchRow } from '../../types/database';

/**
 * The top of the feed as a rail. The FLEKy that start within the next few hours are the ones
 * worth flicking through, and a rail keeps that section one screen tall instead of six — the
 * sections below it stay a plain grid, because a page of rails hides more than it shows.
 */
export function OfferRail({
  id,
  title,
  note,
  action,
  rows,
  slotsFor,
  now,
}: {
  id: string;
  title: string;
  note: string;
  /** One link beside the heading — "Na mapě" on the first section. */
  action?: ReactNode;
  rows: SearchRow[];
  slotsFor: Record<string, SearchRow[]>;
  now: string;
}) {
  const carousel = useSnapCarousel<HTMLUListElement>(rows.length, rows.map((row) => row.id).join(':'));

  return (
    <section aria-labelledby={id} className="mt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={id} className="flex min-w-0 items-baseline gap-2 text-lg font-extrabold tracking-tight">
          <span className="truncate">{title}</span>
          <span className="tnum shrink-0 text-sm font-normal text-muted">{note}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {/* Touch has the swipe; a pointer needs something to press. */}
          <div className="hidden gap-2 md:flex">
            <button
              type="button"
              onClick={() => carousel.goTo(carousel.index - 1)}
              disabled={!carousel.canGoBack}
              aria-label="Předchozí"
              className="grid size-11 place-items-center rounded-full bg-card text-ink shadow-card disabled:opacity-40"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => carousel.goTo(carousel.index + 1)}
              disabled={!carousel.canGoForward}
              aria-label="Další"
              className="grid size-11 place-items-center rounded-full bg-card text-ink shadow-card disabled:opacity-40"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <ul
        ref={carousel.viewportRef}
        onScroll={carousel.onScroll}
        onKeyDown={carousel.onKeyDown}
        tabIndex={0}
        aria-label={title}
        className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:scroll-px-0 md:px-0"
      >
        {rows.map((offer, index) => (
          <li key={offer.id} data-snap-item className="flex w-[88%] max-w-80 shrink-0 snap-start md:w-80">
            <OfferCard offer={offer} slots={slotsFor[offer.id]} now={now} priority={index === 0} tall />
          </li>
        ))}
      </ul>
    </section>
  );
}
