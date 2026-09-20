import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { searchOffers, type SearchParams } from '../../lib/api';
import { track } from '../../lib/analytics';
import { useSnapCarousel } from '../../components/useSnapCarousel';
import { OfferCard } from '../discovery/OfferCard';
import { groupSlots, slotKey } from '../discovery/slots';
import { pickRecommendations } from './pickRecommendations';
import type { OfferDetail, SearchRow } from '../../types/database';

const NEARBY: Omit<SearchParams, 'lat' | 'lng' | 'category'> = {
  radius_m: 5000,
  from: null,
  until: null,
  min_discount_pct: 0,
  max_price_cents: null,
  sort: 'recommended',
  daypart: null,
  limit: 30,
};

/**
 * "Mohlo by se ti líbit": other FLEKs worth a look from this page — the venue's other services first,
 * then the same kind of service nearby, then anything nearby. The same searches the rest of the app
 * runs, no second recommendation engine. Shown only when there are at least two to swipe through.
 */
export function Recommendations({
  offer,
  venueRows,
  point,
  now,
}: {
  offer: OfferDetail;
  venueRows: SearchRow[];
  point: { lat: number; lng: number };
  now: string;
}) {
  const at = { lat: point.lat, lng: point.lng };
  // Keys start with "discovery", so the inventory watcher refreshes them with the rest of the feed.
  const sameKind = useQuery({
    queryKey: ['discovery', 'recommendations', offer.category_slug, at.lat.toFixed(4), at.lng.toFixed(4)],
    queryFn: () => searchOffers({ ...NEARBY, ...at, category: offer.category_slug }),
    staleTime: 60_000,
  });
  const groupsSoFar = groupSlots([...venueRows, ...(sameKind.data ?? [])])
    .filter((group) => group.key !== slotKey(offer)).length;
  const anything = useQuery({
    queryKey: ['discovery', 'recommendations', 'any', at.lat.toFixed(4), at.lng.toFixed(4)],
    queryFn: () => searchOffers({ ...NEARBY, ...at, category: null }),
    enabled: sameKind.isSuccess && groupsSoFar < 4,
    staleTime: 60_000,
  });

  const picks = pickRecommendations(offer, [venueRows, sameKind.data ?? [], anything.data ?? []]);
  const carousel = useSnapCarousel<HTMLUListElement>(picks.length, picks.map((group) => group.key).join(':'));
  if (!picks.length) return null;

  return (
    <section aria-labelledby="doporuceni" className="mt-8 border-t border-line pt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="doporuceni" className="text-lg font-extrabold">Mohlo by se ti líbit</h2>
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
      <ul
        ref={carousel.viewportRef}
        onScroll={carousel.onScroll}
        onKeyDown={carousel.onKeyDown}
        tabIndex={0}
        aria-label="Další FLEKy"
        className="rail -mx-4 mt-3 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 md:mx-0 md:scroll-px-0 md:px-0"
      >
        {picks.map((group) => (
          <li
            key={group.key}
            data-snap-item
            className="flex w-[84%] max-w-80 shrink-0 snap-start md:w-80"
            onClickCapture={() => track('similar_offers_clicked', {
              offer_id: offer.id,
              to_offer_id: group.lead.id,
              source: group.lead.business_id === offer.business_id ? 'venue' : 'detail_carousel',
            })}
          >
            <OfferCard offer={group.lead} slots={group.slots} now={now} tall />
          </li>
        ))}
      </ul>
    </section>
  );
}
