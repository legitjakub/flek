import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crosshair, List, MapPin, X } from 'lucide-react';
import { Link, useRouter } from '../../app/router';
import { listCategories } from '../../lib/api';
import { money, distance } from '../../lib/format';
import { DiscountBadge } from '../../components/Price';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import { LazyMap } from '../offers/LazyMap';
import { LocationChip } from './LocationChip';
import { FilterBar, plural } from './FilterBar';
import { useDiscoveryState } from './useDiscoveryState';
import { useDiscovery } from './useDiscovery';
import { groupMapOffers } from './mapOffers';
import { locate } from '../../lib/geo';
import type { SearchRow } from '../../types/database';

const markerTime = new Intl.DateTimeFormat('cs-CZ', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Prague',
});

export function MapPage() {
  const { point, setPoint, filters, setFilters } = useDiscoveryState();
  const { search, navigate } = useRouter();
  const [openGroup, setOpenGroup] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(false);
  const now = useServerNow();
  const discovery = useDiscovery(point, filters);
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 3_600_000 });
  const rows = discovery.data?.rows;
  const groups = useMemo(() => groupMapOffers(rows ?? []), [rows]);
  const selectedOffers = groups.filter((group) => openGroup.includes(group.id)).flatMap((group) => group.offers).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const oneBusiness = new Set(selectedOffers.map((offer) => offer.business_id)).size === 1;
  const origin = `/mapa${search.size ? `?${search}` : ''}`;
  const detailHref = (id: string) => `/nabidka/${id}?from=${encodeURIComponent(origin)}`;
  const markers = useMemo(() => groups.map((group) => ({
    id: group.id, lat: group.lat, lng: group.lng,
    label: `${group.offers.length > 1 ? 'od ' : ''}${money(group.minPrice)}`,
    count: group.offers.length, price: group.minPrice,
    description: group.offers.length === 1
      ? `Otevřít ${group.offers[0].service_name}, ${group.offers[0].business_name}, ${markerTime.format(new Date(group.offers[0].start_at))}, ${money(group.minPrice)}`
      : `${group.offers[0].business_name}: ${group.offers.length} termíny, od ${money(group.minPrice)}. Vybrat termín.`,
  })), [groups]);

  useEffect(() => {
    setOpenGroup((current) => {
      const available = current.filter((id) => groups.some((group) => group.id === id));
      return available.length === current.length ? current : available;
    });
  }, [groups]);

  function openMarker(id: string) {
    const group = groups.find((item) => item.id === id);
    if (!group) return;
    if (group.offers.length === 1) navigate(detailHref(group.offers[0].id));
    else setOpenGroup([id]);
  }

  async function useMyLocation() {
    setLocating(true);
    setLocateError(false);
    try {
      setPoint(await locate());
    } catch {
      setLocateError(true);
    } finally {
      setLocating(false);
    }
  }

  return (
    <main className="page-container map-page flex flex-col gap-3 py-4 md:py-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <LocationChip point={point} onChange={setPoint} />
        <Link to={`/${search.size ? `?${search}` : ''}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-accent"><List size={18} aria-hidden="true" />Seznam</Link>
      </div>
      <h1 className="sr-only">Volné termíny na mapě</h1>
      <FilterBar filters={filters} onChange={setFilters} categories={categories.data ?? []} resultCount={rows?.length ?? 0} pending={discovery.isFetching} applied={discovery.data?.applied} />
      {discovery.isError ? <ErrorState error={discovery.error} onRetry={() => discovery.refetch()} /> : null}
      {discovery.data?.note ? <Banner tone="warning">{discovery.data.note}</Banner> : null}
      {discovery.isPending ? <Skeleton className="min-h-80 flex-1" /> : null}
      {discovery.isSuccess && !rows?.length ? <EmptyState title="V okolí teď nic volného není." body="Zkus změnit místo nebo filtry nad mapou." /> : null}
      {discovery.isSuccess && rows?.length ? (
        <div className="grid min-h-80 flex-1 overflow-hidden rounded-2xl bg-card shadow-card lg:grid-cols-[340px_minmax(0,1fr)]">
          <section className="hidden min-h-0 flex-col border-r border-line lg:flex" aria-label="Nabídky na mapě">
            <div className="border-b border-line px-5 py-4"><h2 className="text-base font-extrabold">{rows.length} {plural(rows.length)} v okolí</h2><p className="mt-1 text-sm text-muted">Vyber si aktivitu a svůj čas.</p></div>
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain">
              {rows.map((offer) => <li key={offer.id} onMouseEnter={() => setHighlighted(groups.find((g) => g.offers.some((o) => o.id === offer.id))?.id ?? null)} onMouseLeave={() => setHighlighted(null)} onFocus={() => setHighlighted(groups.find((g) => g.offers.some((o) => o.id === offer.id))?.id ?? null)} onBlur={() => setHighlighted(null)}><MapOffer offer={offer} now={now} to={detailHref(offer.id)} /></li>)}
            </ul>
          </section>
          <div className="relative min-h-0 min-w-0">
            <LazyMap className="h-full min-h-80 w-full" center={point} markers={markers} selectedId={openGroup[0] ?? highlighted ?? undefined} eager fitToMarkers onSelect={openMarker} onSelectGroup={setOpenGroup} ariaLabel="Mapa aktivit. Cena otevře konkrétní aktivitu, číslo u ceny nabídne více termínů v okolí." />
            <p className="pointer-events-none absolute top-3 left-3 z-10 max-w-[calc(100%-6rem)] rounded-xl border border-line bg-card px-3 py-2 text-sm font-bold shadow-card">Klepni na cenu a vyber si termín</p>
            <button
              type="button"
              aria-label="Najít nabídky u mojí polohy"
              title="Moje poloha"
              disabled={locating}
              onClick={() => void useMyLocation()}
              className="absolute top-[108px] right-3 z-10 inline-flex size-11 items-center justify-center gap-2 rounded-xl border border-line bg-card text-ink shadow-card disabled:opacity-60 sm:w-auto sm:px-3"
            >
              <Crosshair size={18} className={locating ? 'animate-spin' : ''} aria-hidden="true" />
              <span className="hidden text-sm font-bold sm:inline">Moje poloha</span>
            </button>
            {locateError ? (
              <p role="status" className="absolute top-[160px] right-3 z-10 max-w-56 rounded-xl bg-card px-3 py-2 text-sm text-muted shadow-card">
                Polohu se nepodařilo zjistit. Vyber ji nahoře ručně.
              </p>
            ) : null}
            {selectedOffers.length ? (
              <section className="absolute inset-x-2 bottom-2 z-20 rounded-2xl border border-line bg-card/95 p-2 shadow-lift backdrop-blur-sm sm:inset-x-3 sm:bottom-3" aria-label="Vybrané termíny">
                <div className="flex items-center gap-2 px-2 pb-1">
                  <MapPin size={16} className="shrink-0 text-accent" aria-hidden="true" />
                  {/* Only the name truncates. The count used to be inside the truncating
                      paragraph, so the header read "… · 5 nabíd…" — the one number in it. */}
                  <p className="flex min-w-0 flex-1 items-baseline gap-1 text-sm font-bold text-ink">
                    <span className="min-w-0 truncate">
                      {oneBusiness ? selectedOffers[0].business_name : 'V této části mapy'}
                    </span>
                    <span className="tnum shrink-0 font-normal text-muted">
                      · {selectedOffers.length} {plural(selectedOffers.length)}
                    </span>
                  </p>
                  <button type="button" onClick={() => setOpenGroup([])} aria-label="Zavřít výběr" className="grid size-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface hover:text-ink">
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
                <ul className="rail rail-fade flex snap-x gap-2 overflow-x-auto pb-1">
                  {selectedOffers.map((offer) => (
                    <li key={offer.id} className="w-[min(82vw,330px)] shrink-0 snap-start overflow-hidden rounded-xl border border-line bg-card">
                      <MapOffer offer={offer} now={now} to={detailHref(offer.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

/**
 * One appointment in the list beside the map and in the sheet a pin opens.
 *
 * The card is about 330 px wide and had six facts, a three-line price column and a chevron
 * fighting over it — the venue, the district and the whole time line all ended in an
 * ellipsis while the price column ran to three lines in the corner. A card nobody can read
 * is not information.
 *
 * Three lines, each one using both edges: name and price, then the venue, then the time and
 * the discount. The chevron is gone — the entire card is the link, and in a horizontal
 * carousel that arrow only ever cost the width the names needed.
 */
function MapOffer({ offer, now, to }: { offer: SearchRow; now: string; to: string }) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-1 p-3 transition-colors hover:bg-surface focus-visible:bg-accent-soft"
    >
      {/* Name and price on one baseline, at the two ends of the card. */}
      <span className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate text-base leading-snug font-extrabold text-ink">
          {offer.service_name}
        </span>
        <span className="tnum shrink-0 text-base leading-snug font-extrabold text-ink">
          {money(offer.deal_price_cents)}
        </span>
      </span>

      <span className="block truncate text-sm text-muted">
        {offer.business_name}
        {offer.district ? ` · ${offer.district}` : ''}
      </span>

      {/* Time first and in ink: on a last-minute marketplace it is the fact people scan
          for. The discount closes the row at the other edge. */}
      <span className="flex items-baseline gap-3">
        <span className="tnum min-w-0 flex-1 truncate text-sm">
          <span className="font-bold text-ink">
            {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)}
          </span>
          <span className="text-muted">
            {' · '}
            {duration(offer.start_at, offer.end_at)} min
            {distance(offer.distance_m) ? ` · ${distance(offer.distance_m)}` : ''}
          </span>
        </span>
        <DiscountBadge pct={offer.discount_pct} className="shrink-0" />
      </span>
    </Link>
  );
}

