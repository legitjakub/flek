import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { List, X } from 'lucide-react';
import { Link, useRouter } from '../../app/router';
import { listCategories } from '../../lib/api';
import { money } from '../../lib/format';
import { useServerNow } from '../../lib/clock';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import { LazyMap } from '../offers/LazyMap';
import { OfferCard } from './OfferCard';
import { LocationChip } from './LocationChip';
import { FilterBar } from './FilterBar';
import { useDiscoveryState } from './useDiscoveryState';
import { useDiscovery } from './useDiscovery';

export function MapPage() {
  const { point, setPoint, filters, setFilters } = useDiscoveryState();
  const { search } = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const now = useServerNow();
  const discovery = useDiscovery(point, filters);
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 3_600_000 });
  const rows = discovery.data?.rows ?? [];
  const markers = useMemo(() => rows.map((row) => ({ id: row.id, lat: row.latitude, lng: row.longitude, label: money(row.deal_price_cents), description: `${row.service_name}, ${row.business_name}, ${money(row.deal_price_cents)}` })), [rows]);
  const preview = rows.find((row) => row.id === selected) ?? null;
  return (
    <main className="page-container py-5 sm:py-8">
      <div className="mb-3 flex items-center justify-between gap-3"><LocationChip point={point} onChange={setPoint} /><Link to={`/${search.size ? `?${search}` : ''}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-accent"><List size={18} aria-hidden="true" />Seznam</Link></div>
      <h1 className="sr-only">Volné termíny na mapě</h1>
      <FilterBar filters={filters} onChange={setFilters} categories={categories.data ?? []} resultCount={rows.length} pending={discovery.isFetching} />
      <div className="mt-4">
        {discovery.isError ? <ErrorState error={discovery.error} onRetry={() => discovery.refetch()} /> : null}
        {discovery.isPending ? <Skeleton className="h-[60dvh] w-full" /> : null}
        {discovery.isSuccess ? <>
          {discovery.data.note ? <div className="mb-4"><Banner tone="warning">{discovery.data.note}</Banner></div> : null}
          {rows.length === 0 ? <div className="mb-4"><EmptyState title="V okolí teď nic volného není." body="Zkus změnit místo nebo filtry nad mapou." /></div> : null}
          <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
            <div className="hidden max-h-[65dvh] flex-col gap-3 overflow-y-auto pr-1 lg:flex" aria-label="Nabídky na mapě">{rows.map((row) => <div key={row.id} className={`rounded-2xl ${row.id === selected ? 'ring-2 ring-accent ring-inset' : ''}`}><button type="button" onClick={() => setSelected(row.id)} aria-pressed={row.id === selected} className="mb-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent">Ukázat na mapě: {row.business_name}</button><OfferCard offer={row} now={now} /></div>)}</div>
            <div className="relative min-w-0">
              <LazyMap className="h-[68dvh] min-h-100 w-full overflow-hidden rounded-2xl border border-line lg:h-[70dvh]" center={preview ? { lat: preview.latitude, lng: preview.longitude } : point} markers={markers} selectedId={preview?.id} eager fitToMarkers onSelect={setSelected} ariaLabel="Mapa volných termínů. Klepnutím na cenu zobrazíš nabídku." />
              {preview ? <div className="absolute right-3 bottom-8 left-3 z-10 lg:hidden"><div className="flex justify-end"><button type="button" onClick={() => setSelected(null)} aria-label="Zavřít náhled nabídky" className="mb-2 grid size-11 place-items-center rounded-full border border-line bg-card text-ink shadow-card"><X size={20} aria-hidden="true" /></button></div><OfferCard offer={preview} now={now} compact /></div> : null}
            </div>
          </div>
        </> : null}
      </div>
    </main>
  );
}
