import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { listCategories } from '../../lib/api';
import { useServerNow } from '../../lib/clock';
import { DEFAULT_POINT, storedPoint, type Point } from '../../lib/geo';
import { Banner, Chip, EmptyState, ErrorState, LoadingList, Sheet, Button, Field, Select, Input } from '../../components/ui';
import { OfferCard } from './OfferCard';
import { DEFAULT_FILTERS, SORT_LABELS, WHEN_LABELS, type Filters, type When } from './filters';
import { useDiscovery } from './useDiscovery';
import { LocationChip } from './LocationChip';
import type { SortKey } from '../../types/database';

export function DiscoveryPage() {
  const [point, setPoint] = useState<Point>(() => storedPoint() ?? DEFAULT_POINT);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const now = useServerNow();
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 3_600_000 });
  const discovery = useDiscovery(point, filters);

  const rows = discovery.data?.rows ?? [];
  const sections = useMemo(() => {
    if (!rows.length) return [];
    const byDistance = [...rows].sort((a, b) => a.distance_m - b.distance_m).slice(0, 6);
    const byDiscount = [...rows].sort((a, b) => b.discount_pct - a.discount_pct).slice(0, 6);
    const nearIds = new Set(byDistance.map((r) => r.id));
    return [
      { title: 'Nejblíž právě teď', rows: byDistance },
      { title: 'Největší slevy', rows: byDiscount.filter((r) => !nearIds.has(r.id)) },
    ].filter((section) => section.rows.length > 0);
  }, [rows]);

  const activeFilterCount =
    (filters.category ? 1 : 0) +
    (filters.min_discount_pct > 0 ? 1 : 0) +
    (filters.max_price_cents ? 1 : 0) +
    (filters.sort !== 'recommended' ? 1 : 0);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-4 pb-6">
      <div className="flex flex-wrap items-center gap-2">
        <LocationChip point={point} onChange={setPoint} />
        <Chip onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
          Filtry{activeFilterCount ? ` · ${activeFilterCount}` : ''}
        </Chip>
      </div>

      <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">
        Volné termíny v okolí, levněji.
      </h1>
      <p className="mt-1 text-sm text-muted">Rezervuj na dnes, plať na místě.</p>

      <div className="mt-4 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {(Object.keys(WHEN_LABELS) as When[]).map((when) => (
          <Chip
            key={when}
            active={filters.when === when}
            onClick={() => setFilters((f) => ({ ...f, when }))}
          >
            {WHEN_LABELS[when]}
          </Chip>
        ))}
        <Chip
          active={filters.radius_m === 2000}
          onClick={() => setFilters((f) => ({ ...f, radius_m: f.radius_m === 2000 ? 5000 : 2000 }))}
        >
          Do 2 km
        </Chip>
        <Chip
          active={filters.min_discount_pct === 30}
          onClick={() => setFilters((f) => ({ ...f, min_discount_pct: f.min_discount_pct === 30 ? 0 : 30 }))}
        >
          −30 % a víc
        </Chip>
      </div>

      {categories.data?.length ? (
        <div className="mt-3 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Chip active={filters.category === null} onClick={() => setFilters((f) => ({ ...f, category: null }))}>
            Vše
          </Chip>
          {categories.data.map((category) => (
            <Chip
              key={category.slug}
              active={filters.category === category.slug}
              onClick={() =>
                setFilters((f) => ({ ...f, category: f.category === category.slug ? null : category.slug }))
              }
            >
              {category.label_cs}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        {discovery.isPending ? <LoadingList rows={4} /> : null}
        {discovery.isError ? <ErrorState error={discovery.error} onRetry={() => discovery.refetch()} /> : null}

        {discovery.data?.note ? <Banner tone="warning">{discovery.data.note}</Banner> : null}

        {discovery.isSuccess && rows.length === 0 ? (
          <EmptyState
            title="V okolí teď nic volného není."
            body="Zkus jiný den nebo větší okolí. Nové termíny přibývají během dne."
            action={
              <Button variant="secondary" onClick={() => setFilters({ ...DEFAULT_FILTERS, when: 'week', radius_m: 10000 })}>
                Hledat v celém týdnu
              </Button>
            }
          />
        ) : null}

        {sections.map((section) => (
          <section key={section.title} className="flex flex-col gap-3">
            <h2 className="text-base font-bold text-ink">{section.title}</h2>
            {section.rows.map((offer) => (
              <OfferCard key={offer.id} offer={offer} now={now} />
            ))}
          </section>
        ))}
      </div>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filtry"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Zrušit filtry
            </Button>
            <Button className="flex-1" onClick={() => setSheetOpen(false)}>
              Zobrazit nabídky
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Field id="sort" label="Řadit podle">
            <Select
              id="sort"
              data-autofocus
              value={filters.sort}
              onChange={(event) => setFilters((f) => ({ ...f, sort: event.target.value as SortKey }))}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="radius" label="Vzdálenost">
            <Select
              id="radius"
              value={String(filters.radius_m)}
              onChange={(event) => setFilters((f) => ({ ...f, radius_m: Number(event.target.value) }))}
            >
              <option value="2000">Do 2 km</option>
              <option value="5000">Do 5 km</option>
              <option value="10000">Do 10 km</option>
              <option value="25000">Do 25 km</option>
            </Select>
          </Field>
          <Field id="discount" label="Minimální sleva">
            <Select
              id="discount"
              value={String(filters.min_discount_pct)}
              onChange={(event) => setFilters((f) => ({ ...f, min_discount_pct: Number(event.target.value) }))}
            >
              <option value="0">Jakákoli</option>
              <option value="20">−20 % a víc</option>
              <option value="30">−30 % a víc</option>
              <option value="40">−40 % a víc</option>
            </Select>
          </Field>
          <Field id="max-price" label="Cena nejvýše" hint="Nech prázdné, pokud na ceně nezáleží.">
            <Input
              id="max-price"
              inputMode="numeric"
              placeholder="např. 500"
              value={filters.max_price_cents ? String(filters.max_price_cents / 100) : ''}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, '');
                setFilters((f) => ({ ...f, max_price_cents: digits ? Number(digits) * 100 : null }));
              }}
            />
          </Field>
        </div>
      </Sheet>
    </main>
  );
}
