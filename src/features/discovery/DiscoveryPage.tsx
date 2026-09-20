import { useQuery } from '@tanstack/react-query';
import { Map } from 'lucide-react';
import { Link, useRouter } from '../../app/router';
import { listCategories } from '../../lib/api';
import { useServerNow } from '../../lib/clock';
import { Button, CardSkeleton, EmptyState, ErrorState } from '../../components/ui';
import { OfferCard } from './OfferCard';
import { OfferRail } from './OfferRail';
import { buildSections } from './sections';
import { DEFAULT_FILTERS, SORT_LABELS, activeCount } from './filters';
import { useDiscovery } from './useDiscovery';
import { useDiscoveryState } from './useDiscoveryState';
import { LocationChip } from './LocationChip';
import { FilterBar, plural } from './FilterBar';
import { useMemo } from 'react';
import { groupSlots } from './slots';

export function DiscoveryPage() {
  const { point, setPoint, filters, setFilters } = useDiscoveryState();
  const { search } = useRouter();
  const now = useServerNow();
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 3_600_000 });
  const discovery = useDiscovery(point, filters);
  // One card per service and venue; its other times ride along on the card.
  const groups = useMemo(() => groupSlots(discovery.data?.rows ?? []), [discovery.data?.rows]);
  const rows = useMemo(() => groups.map((group) => group.lead), [groups]);
  const slotsFor = useMemo(() => Object.fromEntries(groups.map((group) => [group.lead.id, group.slots])), [groups]);
  const customized = activeCount(filters) > 0 || filters.when !== DEFAULT_FILTERS.when;
  const sections = useMemo(() => customized
    ? (rows.length ? [{ key: 'all', title: 'V okolí', rows }] : [])
    : buildSections(rows, now), [rows, now, customized]);
  return (
    <main className="page-container py-5 sm:py-8">
      {/*
        Two lines, the second in the brand colour: what this screen is, and the one thing that
        makes it worth opening. It is the only decoration on the page — everything below is
        offers.
      */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <h1 className="text-xl leading-[1.1] font-extrabold tracking-tight sm:text-2xl">
          Volné FLEKy.
          <span className="block text-brand">Se slevou.</span>
        </h1>
        <LocationChip point={point} onChange={setPoint} />
      </div>
      <div className="mt-3"><FilterBar filters={filters} onChange={setFilters} categories={categories.data ?? []} resultCount={rows.length} pending={discovery.isFetching} applied={discovery.data?.applied} note={discovery.data?.note} /></div>
      <p className="sr-only" aria-live="polite">
        {discovery.isPending
          ? 'Hledáme volné FLEKy…'
          : discovery.isSuccess
            ? `${rows.length} ${plural(rows.length)} · ${SORT_LABELS[filters.sort]}`
            : 'Nabídky se nepodařilo načíst'}
      </p>
      {discovery.isError ? <div className="mt-4"><ErrorState error={discovery.error} onRetry={() => discovery.refetch()} /></div> : null}
      {discovery.isSuccess && rows.length === 0 ? <div className="mt-4"><EmptyState title="V okolí teď nic volného není." body="Zkus jiný den nebo větší okolí. Nové FLEKy přibývají během dne." action={<Button variant="secondary" onClick={() => setFilters({ ...DEFAULT_FILTERS, when: 'week', radius_m: 25000 })}>Hledat v celém týdnu</Button>} /></div> : null}
      {discovery.isPending ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Načítáme volné FLEKy">
          {Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : null}
      {sections.map((section, sectionIndex) => {
        const note = section.note ?? `${section.rows.length} ${plural(section.rows.length)}`;
        const onMap = sectionIndex === 0 ? (
          <Link
            to={`/mapa${search.size ? `?${search}` : ''}`}
            className="-my-3 inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-bold text-accent"
          >
            <Map size={17} aria-hidden="true" />
            Na mapě
          </Link>
        ) : null;
        // The first section is the one that changes by the hour, so it swipes; the rest is a
        // grid. With a single section there is nothing to swipe past — it stays a grid too.
        if (sectionIndex === 0 && sections.length > 1) {
          return (
            <OfferRail
              key={section.key}
              id={`sekce-${section.key}`}
              title={section.title}
              note={note}
              action={onMap}
              rows={section.rows}
              slotsFor={slotsFor}
              now={now}
            />
          );
        }
        return (
          <section key={section.key} className={sectionIndex === 0 ? 'mt-5' : 'mt-7'} aria-labelledby={`sekce-${section.key}`}>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id={`sekce-${section.key}`} className="text-lg font-extrabold tracking-tight">
                {section.title}
                <span className="tnum ml-2 text-sm font-normal text-muted">{note}</span>
              </h2>
              {onMap}
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {section.rows.map((offer, index) => (
                <OfferCard key={offer.id} offer={offer} slots={slotsFor[offer.id]} now={now} priority={sectionIndex === 0 && index === 0} />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
