import { useMemo, useState } from 'react';
import { DEFAULT_POINT, storedPoint, type Point } from '../../lib/geo';
import { useServerNow } from '../../lib/clock';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import { LazyMap } from '../offers/LazyMap';
import { OfferCard } from './OfferCard';
import { LocationChip } from './LocationChip';
import { DEFAULT_FILTERS, type Filters } from './filters';
import { useDiscovery } from './useDiscovery';

export function MapPage() {
  const [point, setPoint] = useState<Point>(() => storedPoint() ?? DEFAULT_POINT);
  const [filters] = useState<Filters>({ ...DEFAULT_FILTERS, when: 'week', radius_m: 10000 });
  const [selected, setSelected] = useState<string | null>(null);
  const now = useServerNow();
  const discovery = useDiscovery(point, filters);
  const rows = discovery.data?.rows ?? [];

  const markers = useMemo(
    () => rows.map((row) => ({ id: row.id, lat: row.latitude, lng: row.longitude, label: `−${row.discount_pct}%` })),
    [rows],
  );
  const preview = rows.find((row) => row.id === selected) ?? null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-4 pb-6">
      <div className="flex items-center gap-2">
        <LocationChip point={point} onChange={setPoint} />
        <p className="text-sm text-muted">{rows.length} volných termínů</p>
      </div>

      {discovery.isError ? <ErrorState error={discovery.error} onRetry={() => discovery.refetch()} /> : null}
      {discovery.isPending ? <Skeleton className="h-[55vh] w-full" /> : null}

      {discovery.isSuccess ? (
        <>
          {discovery.data.note ? <Banner tone="warning">{discovery.data.note}</Banner> : null}
          <LazyMap
            className="h-[55vh] w-full overflow-hidden rounded-2xl border border-line"
            center={point}
            markers={markers}
            onSelect={setSelected}
            ariaLabel="Mapa volných termínů. Klepnutím na značku zobrazíš nabídku."
          />
          {preview ? (
            <OfferCard offer={preview} now={now} />
          ) : rows.length === 0 ? (
            <EmptyState title="V okolí teď nic volného není." body="Zkus posunout mapu nebo změnit místo." />
          ) : (
            <p className="text-sm text-muted">Klepni na značku a zobrazí se nabídka.</p>
          )}
        </>
      ) : null}
    </main>
  );
}
