import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Clock3, List, MapPin } from 'lucide-react';
import { Link, useRouter } from '../../app/router';
import { listCategories } from '../../lib/api';
import { money, distance } from '../../lib/format';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, EmptyState, ErrorState, Sheet, Skeleton } from '../../components/ui';
import { LazyMap } from '../offers/LazyMap';
import { LocationChip } from './LocationChip';
import { FilterBar, plural } from './FilterBar';
import { useDiscoveryState } from './useDiscoveryState';
import { useDiscovery } from './useDiscovery';
import { groupMapOffers } from './mapOffers';
import type { SearchRow } from '../../types/database';

export function MapPage() {
  const { point, setPoint, filters, setFilters } = useDiscoveryState();
  const { search, navigate } = useRouter();
  const [openGroup, setOpenGroup] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const mapArea = useRef<HTMLDivElement>(null);
  const lastSelection = useRef<string[]>([]);
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
      ? `Otevřít ${group.offers[0].service_name}, ${group.offers[0].business_name}, ${dayLabel(group.offers[0].start_at, now)} ${clockTime(group.offers[0].start_at)}, ${money(group.minPrice)}`
      : `${group.offers[0].business_name}: ${group.offers.length} termíny, od ${money(group.minPrice)}. Vybrat termín.`,
  })), [groups, now]);

  function openMarker(id: string) {
    const group = groups.find((item) => item.id === id);
    if (!group) return;
    if (group.offers.length === 1) navigate(detailHref(group.offers[0].id));
    else { lastSelection.current = [id]; setOpenGroup([id]); }
  }

  return (
    <main className="page-container map-page flex flex-col gap-3 py-4 md:py-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <LocationChip point={point} onChange={setPoint} />
        <Link to={`/${search.size ? `?${search}` : ''}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-accent"><List size={18} aria-hidden="true" />Seznam</Link>
      </div>
      <h1 className="sr-only">Volné termíny na mapě</h1>
      <FilterBar filters={filters} onChange={setFilters} categories={categories.data ?? []} resultCount={rows?.length ?? 0} pending={discovery.isFetching} />
      {discovery.isError ? <ErrorState error={discovery.error} onRetry={() => discovery.refetch()} /> : null}
      {discovery.data?.note ? <Banner tone="warning">{discovery.data.note}</Banner> : null}
      {discovery.isPending ? <Skeleton className="min-h-80 flex-1" /> : null}
      {discovery.isSuccess && !rows?.length ? <EmptyState title="V okolí teď nic volného není." body="Zkus změnit místo nebo filtry nad mapou." /> : null}
      {discovery.isSuccess && rows?.length ? (
        <div className="grid min-h-80 flex-1 overflow-hidden rounded-2xl border border-line bg-card lg:grid-cols-[340px_minmax(0,1fr)]">
          <section className="hidden min-h-0 flex-col border-r border-line lg:flex" aria-label="Nabídky na mapě">
            <div className="border-b border-line px-5 py-4"><h2 className="text-base font-extrabold">{rows.length} {plural(rows.length)} v okolí</h2><p className="mt-1 text-sm text-muted">Vyber si aktivitu a svůj čas.</p></div>
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain">
              {rows.map((offer) => <li key={offer.id} onMouseEnter={() => setHighlighted(groups.find((g) => g.offers.some((o) => o.id === offer.id))?.id ?? null)} onMouseLeave={() => setHighlighted(null)} onFocus={() => setHighlighted(groups.find((g) => g.offers.some((o) => o.id === offer.id))?.id ?? null)} onBlur={() => setHighlighted(null)}><MapOffer offer={offer} now={now} to={detailHref(offer.id)} /></li>)}
            </ul>
          </section>
          <div ref={mapArea} className="relative min-h-0 min-w-0">
            <LazyMap className="h-full min-h-80 w-full" center={point} markers={markers} selectedId={openGroup[0] ?? highlighted ?? undefined} eager fitToMarkers onSelect={openMarker} onSelectGroup={(ids) => { lastSelection.current = ids; setOpenGroup(ids); }} ariaLabel="Mapa aktivit. Cena otevře konkrétní aktivitu, číslo u ceny nabídne více termínů v okolí." />
            <p className="pointer-events-none absolute top-3 left-3 z-10 max-w-[calc(100%-6rem)] rounded-xl border border-line bg-card px-3 py-2 text-sm font-semibold shadow-card">Klepni na cenu a vyber si termín</p>
          </div>
        </div>
      ) : null}
      <Sheet returnFocus={() => [...(mapArea.current?.querySelectorAll<HTMLElement>('[data-map-ids]') ?? [])].find((element) => {
        const ids: string[] = JSON.parse(element.dataset.mapIds ?? '[]');
        return ids.some((id) => lastSelection.current.includes(id));
      }) ?? null} open={selectedOffers.length > 0} onClose={() => setOpenGroup([])} title={oneBusiness ? selectedOffers[0].business_name : 'Vyber si aktivitu'}>
        {selectedOffers.length ? <><p className="mb-4 flex items-start gap-2 text-sm text-muted"><MapPin size={18} className="shrink-0" aria-hidden="true" />{oneBusiness ? selectedOffers[0].address_line : 'Termíny v této části mapy'} · {selectedOffers.length} {plural(selectedOffers.length)}</p><ul className="divide-y divide-line rounded-xl border border-line">{selectedOffers.map((offer) => <li key={offer.id}><MapOffer offer={offer} now={now} to={detailHref(offer.id)} /></li>)}</ul></> : null}
      </Sheet>
    </main>
  );
}

function MapOffer({ offer, now, to }: { offer: SearchRow; now: string; to: string }) {
  return (
    <Link to={to} className="group block p-4 transition-colors hover:bg-surface focus-visible:bg-accent-soft">
      <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 text-base leading-snug font-extrabold [overflow-wrap:anywhere]">{offer.service_name}</h3><ArrowUpRight size={18} className="shrink-0 text-muted group-hover:text-accent" aria-hidden="true" /></div>
      <p className="mt-1 text-sm text-muted">{offer.business_name}{offer.district ? ` · ${offer.district}` : ''}</p>
      <p className="tnum mt-3 text-base font-extrabold text-accent">{dayLabel(offer.start_at, now)} {clockTime(offer.start_at)}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2"><p className="tnum inline-flex items-center gap-1 text-sm text-muted"><Clock3 size={14} aria-hidden="true" />{duration(offer.start_at, offer.end_at)} min · {distance(offer.distance_m)}</p><span className="tnum text-lg font-extrabold">{money(offer.deal_price_cents)}</span></div>
      <span className="mt-3 inline-flex min-h-6 items-center gap-1 text-sm font-bold text-accent">Zobrazit aktivitu<ArrowUpRight size={14} aria-hidden="true" /></span>
    </Link>
  );
}
