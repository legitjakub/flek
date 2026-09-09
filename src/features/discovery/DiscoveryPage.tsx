import { useQuery } from '@tanstack/react-query';
import { Map } from 'lucide-react';
import { Link, useRouter } from '../../app/router';
import { listCategories } from '../../lib/api';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, CardSkeleton, EmptyState, ErrorState } from '../../components/ui';
import { OfferCard } from './OfferCard';
import { buildSections } from './sections';
import { DEFAULT_FILTERS, SORT_LABELS, activeCount } from './filters';
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
  const customized = activeCount(filters) > 0 || filters.when !== DEFAULT_FILTERS.when;
  const sections = useMemo(() => customized
    ? (rows.length ? [{ key: 'all', title: 'Volné termíny', rows }] : [])
    : buildSections(rows, now), [rows, now, customized]);
  return (
    <main className="page-container py-5 sm:py-8">
      <LocationChip point={point} onChange={setPoint} />
      <h1 className="mt-3 max-w-2xl text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">Volné termíny poblíž</h1>
      <p className="mt-2 text-base text-muted">Zaplatíš rovnou, v podniku ukážeš kód.</p>
      <div className="mt-6"><FilterBar filters={filters} onChange={setFilters} categories={categories.data ?? []} resultCount={rows.length} pending={discovery.isFetching} /></div>
      <p className="sr-only" aria-live="polite">
        {discovery.isPending
          ? 'Hledáme volné termíny…'
          : discovery.isSuccess
            ? `${rows.length} ${plural(rows.length)} · ${SORT_LABELS[filters.sort]}`
            : 'Nabídky se nepodařilo načíst'}
      </p>
      {discovery.isError ? <div className="mt-4"><ErrorState error={discovery.error} onRetry={() => discovery.refetch()} /></div> : null}
      {discovery.data?.note ? <div className="mt-4"><Banner tone="warning">{discovery.data.note}</Banner></div> : null}
      {discovery.isSuccess && rows.length === 0 ? <div className="mt-4"><EmptyState title="V okolí teď nic volného není." body="Zkus jiný den nebo větší okolí. Nové termíny přibývají během dne." action={<Button variant="secondary" onClick={() => setFilters({ ...DEFAULT_FILTERS, when: 'week', radius_m: 25000 })}>Hledat v celém týdnu</Button>} /></div> : null}
      {discovery.isPending ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Načítáme volné termíny">
          {Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : null}
      {sections.map((section, sectionIndex) => (
        <section key={section.key} className="mt-7 first:mt-5" aria-labelledby={`sekce-${section.key}`}>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id={`sekce-${section.key}`} className="text-lg font-extrabold tracking-tight">
              {section.title}
              <span className="tnum ml-2 text-sm font-normal text-muted">
                {section.note ?? `${section.rows.length} ${plural(section.rows.length)}`}
              </span>
            </h2>
            {sectionIndex === 0 ? (
              <Link
                to={`/mapa${search.size ? `?${search}` : ''}`}
                className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-accent"
              >
                <Map size={17} aria-hidden="true" />
                Na mapě
              </Link>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {section.rows.map((offer, index) => (
              <OfferCard key={offer.id} offer={offer} now={now} priority={sectionIndex === 0 && index === 0} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
