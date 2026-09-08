import { useQuery } from '@tanstack/react-query';
import { Map } from 'lucide-react';
import { Link, useRouter } from '../../app/router';
import { listCategories } from '../../lib/api';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, CardSkeleton, EmptyState, ErrorState } from '../../components/ui';
import { OfferCard } from './OfferCard';
import { buildSections } from './sections';
import { DEFAULT_FILTERS, SORT_LABELS } from './filters';
import { useDiscovery } from './useDiscovery';
import { useDiscoveryState } from './useDiscoveryState';
import { LocationChip } from './LocationChip';
import { FilterBar, plural } from './FilterBar';
import { useMemo } from 'react';

export function DiscoveryPage() {
  const { point, setPoint, filters, setFilters } = useDiscoveryState();
  const { search } = useRouter();
  const now = useServerNow();
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 3_600_000 });
  const discovery = useDiscovery(point, filters);
  const rows = discovery.data?.rows ?? [];
  const sections = useMemo(() => buildSections(rows, now), [rows, now]);
  return (
    <main className="page-container py-5 sm:py-8">
      <LocationChip point={point} onChange={setPoint} />
      <h1 className="mt-3 max-w-2xl text-2xl leading-tight font-extrabold tracking-tight">Volné termíny v okolí, levněji.</h1>
      <p className="mt-2 text-base text-muted">Vyber si svůj termín. Plať až na místě.</p>
      <div className="mt-6"><FilterBar filters={filters} onChange={setFilters} categories={categories.data ?? []} resultCount={rows.length} pending={discovery.isFetching} /></div>
      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">{discovery.isPending ? 'Hledáme volné termíny…' : discovery.isSuccess ? `${rows.length} ${plural(rows.length)} · ${SORT_LABELS[filters.sort]}` : 'Nabídky se nepodařilo načíst'}</p>
        <Link to={`/mapa${search.size ? `?${search}` : ''}`} className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm font-bold text-accent"><Map size={18} aria-hidden="true" />Na mapě</Link>
      </div>
      {discovery.isError ? <div className="mt-4"><ErrorState error={discovery.error} onRetry={() => discovery.refetch()} /></div> : null}
      {discovery.data?.note ? <div className="mt-4"><Banner tone="warning">{discovery.data.note}</Banner></div> : null}
      {discovery.isSuccess && rows.length === 0 ? <div className="mt-4"><EmptyState title="V okolí teď nic volného není." body="Zkus jiný den nebo větší okolí. Nové termíny přibývají během dne." action={<Button variant="secondary" onClick={() => setFilters({ ...DEFAULT_FILTERS, when: 'week', radius_m: 25000 })}>Hledat v celém týdnu</Button>} /></div> : null}
      {discovery.isPending ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Načítáme volné termíny">
          {Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : null}
      {sections.map((section) => (
        <section key={section.key} className="mt-8 first:mt-4" aria-labelledby={`sekce-${section.key}`}>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 id={`sekce-${section.key}`} className="text-lg font-extrabold tracking-tight">{section.title}</h2>
            <span className="tnum shrink-0 text-sm text-muted">{section.note ?? `${section.rows.length} ${plural(section.rows.length)}`}</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {section.rows.map((offer) => <OfferCard key={offer.id} offer={offer} now={now} />)}
          </div>
        </section>
      ))}
    </main>
  );
}
