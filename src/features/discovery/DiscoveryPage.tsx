import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { listCategories } from '../../lib/api';
import { useServerNow } from '../../lib/clock';
import { DEFAULT_POINT, storedPoint, type Point } from '../../lib/geo';
import { Banner, Button, CardSkeleton, EmptyState, ErrorState } from '../../components/ui';
import { OfferCard, OfferTile } from './OfferCard';
import { DEFAULT_FILTERS, type Filters } from './filters';
import { useDiscovery } from './useDiscovery';
import { LocationChip } from './LocationChip';
import { FilterBar, plural } from './FilterBar';
import type { SearchRow } from '../../types/database';

export function DiscoveryPage() {
  const [point, setPoint] = useState<Point>(() => storedPoint() ?? DEFAULT_POINT);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const now = useServerNow();
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 3_600_000 });
  const discovery = useDiscovery(point, filters);

  const rows = discovery.data?.rows ?? [];
  const sections = useMemo(() => buildSections(rows, now), [rows, now]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-3 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LocationChip point={point} onChange={setPoint} />
        {discovery.isSuccess ? (
          <p className="tnum text-sm text-muted" aria-live="polite">
            {rows.length} {plural(rows.length)}
          </p>
        ) : null}
      </div>

      <h1 className="mt-4 text-2xl leading-tight font-extrabold tracking-tight text-ink">
        Volné termíny v okolí, levněji.
      </h1>
      <p className="mt-1 text-sm text-muted">Rezervuj na dnes, plať na místě.</p>

      <div className="mt-4">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          categories={categories.data ?? []}
          resultCount={rows.length}
          pending={discovery.isFetching}
        />
      </div>

      <div className="mt-5 flex flex-col gap-6">
        {discovery.isPending ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Načítáme nabídky">
            {Array.from({ length: 4 }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : null}

        {discovery.isError ? <ErrorState error={discovery.error} onRetry={() => discovery.refetch()} /> : null}
        {discovery.data?.note ? <Banner tone="warning">{discovery.data.note}</Banner> : null}

        {discovery.isSuccess && rows.length === 0 ? (
          <EmptyState
            title="V okolí teď nic volného není."
            body="Zkus jiný den nebo větší okolí. Nové termíny přibývají během dne."
            action={
              <Button
                variant="secondary"
                onClick={() => setFilters({ ...DEFAULT_FILTERS, when: 'week', radius_m: 25000 })}
              >
                Hledat v celém týdnu
              </Button>
            }
          />
        ) : null}

        {sections.map((section) =>
          section.layout === 'rail' ? (
            <section key={section.title} aria-labelledby={`s-${section.key}`}>
              <SectionHead id={`s-${section.key}`} title={section.title} note={section.note} count={section.rows.length} />
              <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
                {section.rows.map((offer) => (
                  <OfferTile key={offer.id} offer={offer} now={now} />
                ))}
              </div>
            </section>
          ) : (
            <section key={section.title} aria-labelledby={`s-${section.key}`}>
              <SectionHead id={`s-${section.key}`} title={section.title} note={section.note} count={section.rows.length} />
              <div className="flex flex-col gap-3">
                {section.rows.map((offer) => (
                  <OfferCard key={offer.id} offer={offer} now={now} />
                ))}
              </div>
            </section>
          ),
        )}
      </div>
    </main>
  );
}

function SectionHead({ id, title, note, count }: { id: string; title: string; note?: string; count: number }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-base font-bold text-ink">
        {title}
      </h2>
      <span className="tnum shrink-0 text-xs text-muted">{note ?? `${count} ${plural(count)}`}</span>
    </div>
  );
}

type Section = { key: string; title: string; note?: string; rows: SearchRow[]; layout: 'rail' | 'list' };

/**
 * Rhythm rather than one long column: what starts within three hours goes in a rail at the
 * top, the deepest discounts get a second rail, and everything else stays a scannable list.
 * Nothing is duplicated between sections.
 */
function buildSections(rows: SearchRow[], now: string): Section[] {
  if (!rows.length) return [];
  const used = new Set<string>();
  const take = (list: SearchRow[], limit: number) => {
    const picked = list.filter((r) => !used.has(r.id)).slice(0, limit);
    picked.forEach((r) => used.add(r.id));
    return picked;
  };

  const soon = take(
    [...rows]
      .filter((r) => Date.parse(r.start_at) - Date.parse(now) <= 3 * 3600_000)
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)),
    8,
  );
  const deals = take([...rows].sort((a, b) => b.discount_pct - a.discount_pct).filter((r) => r.discount_pct >= 30), 8);
  const rest = rows.filter((r) => !used.has(r.id));

  const sections: Section[] = [];
  if (soon.length) sections.push({ key: 'soon', title: 'Začíná brzy', note: 'do 3 hodin', rows: soon, layout: 'rail' });
  if (deals.length) sections.push({ key: 'deals', title: 'Největší slevy', rows: deals, layout: 'rail' });
  if (rest.length) sections.push({ key: 'all', title: soon.length || deals.length ? 'Další termíny' : 'Volné termíny', rows: rest, layout: 'list' });
  return sections;
}
