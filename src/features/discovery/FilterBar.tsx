import { useState } from 'react';
import { Button, Chip, Field, FilterPill, Input, Segmented, Sheet } from '../../components/ui';
import type { Category, SortKey } from '../../types/database';
import {
  activeChips,
  activeCount,
  DAYPART_LABELS,
  DEFAULT_FILTERS,
  DISCOUNT_LABELS,
  PRICE_LABELS,
  RADIUS_LABELS,
  SORT_LABELS,
  WHEN_LABELS,
  type Daypart,
  type Filters,
  type When,
} from './filters';

/**
 * One compact toolbar plus a sheet, rather than a wall of controls: the phone screen is
 * for offers, and every applied filter stays visible as a removable pill so results are
 * never quietly narrowed.
 */
export function FilterBar({
  filters,
  onChange,
  categories,
  resultCount,
  pending,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  categories: Category[];
  resultCount: number;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(filters);
  const count = activeCount(filters);
  const label = (slug: string) => categories.find((c) => c.slug === slug)?.label_cs ?? slug;
  const chips = activeChips(filters, label);

  function openSheet() {
    setDraft(filters);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Kdy"
        value={filters.when}
        onChange={(when) => onChange({ ...filters, when: when as When })}
        options={(Object.keys(WHEN_LABELS) as When[]).map((w) => ({ value: w, label: WHEN_LABELS[w] }))}
      />

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <button
          type="button"
          onClick={openSheet}
          aria-haspopup="dialog"
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-ink bg-card px-3.5 text-sm font-bold text-ink"
        >
          Filtry
          {count ? (
            <span className="tnum grid size-5 place-items-center rounded-full bg-ink text-xs text-surface">{count}</span>
          ) : null}
        </button>
        {(Object.keys(DAYPART_LABELS) as Daypart[]).map((part) => (
          <Chip
            key={part}
            active={filters.daypart === part}
            onClick={() => onChange({ ...filters, daypart: filters.daypart === part ? null : part })}
          >
            {DAYPART_LABELS[part]}
          </Chip>
        ))}
        <Chip
          active={filters.min_discount_pct === 30}
          onClick={() => onChange({ ...filters, min_discount_pct: filters.min_discount_pct === 30 ? 0 : 30 })}
        >
          −30 % a víc
        </Chip>
        <Chip
          active={filters.radius_m === 2000}
          onClick={() => onChange({ ...filters, radius_m: filters.radius_m === 2000 ? DEFAULT_FILTERS.radius_m : 2000 })}
        >
          Do 2 km
        </Chip>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={filters.category === null} onClick={() => onChange({ ...filters, category: null })}>
          Vše
        </Chip>
        {categories.map((category) => (
          <Chip
            key={category.slug}
            active={filters.category === category.slug}
            onClick={() =>
              onChange({ ...filters, category: filters.category === category.slug ? null : category.slug })
            }
          >
            {category.label_cs}
          </Chip>
        ))}
      </div>

      {chips.length ? (
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1">
          {chips.map((chip) => (
            <FilterPill key={chip.key} label={chip.label} onRemove={() => onChange(chip.clear(filters))} />
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_FILTERS, when: filters.when })}
            className="shrink-0 text-sm font-semibold text-muted underline underline-offset-4 hover:text-ink"
          >
            Zrušit vše
          </button>
        </div>
      ) : null}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Filtry"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setDraft({ ...DEFAULT_FILTERS, when: draft.when })}
            >
              Vymazat
            </Button>
            <Button
              className="flex-[2]"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              Zobrazit nabídky
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <Group title="Denní doba">
            <Segmented
              label="Denní doba"
              value={draft.daypart}
              onChange={(daypart) => setDraft({ ...draft, daypart })}
              options={[
                { value: null, label: 'Kdykoli' },
                ...(Object.keys(DAYPART_LABELS) as Daypart[]).map((p) => ({ value: p, label: DAYPART_LABELS[p] })),
              ]}
              columns={2}
            />
          </Group>

          <Group title="Vzdálenost">
            <Segmented
              label="Vzdálenost"
              value={draft.radius_m}
              onChange={(radius_m) => setDraft({ ...draft, radius_m })}
              options={RADIUS_LABELS.map(([value, label]) => ({ value, label }))}
              columns={3}
            />
          </Group>

          <Group title="Minimální sleva">
            <Segmented
              label="Minimální sleva"
              value={draft.min_discount_pct}
              onChange={(min_discount_pct) => setDraft({ ...draft, min_discount_pct })}
              options={DISCOUNT_LABELS.map(([value, label]) => ({ value, label }))}
              columns={2}
            />
          </Group>

          <Group title="Cena">
            <Segmented
              label="Cena"
              value={draft.max_price_cents}
              onChange={(max_price_cents) => setDraft({ ...draft, max_price_cents })}
              options={PRICE_LABELS.map(([value, label]) => ({ value, label }))}
              columns={2}
            />
            <Field id="price-exact" label="Nebo přesný strop v Kč">
              <Input
                id="price-exact"
                inputMode="numeric"
                placeholder="např. 450"
                value={draft.max_price_cents ? String(draft.max_price_cents / 100) : ''}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '');
                  setDraft({ ...draft, max_price_cents: digits ? Number(digits) * 100 : null });
                }}
              />
            </Field>
          </Group>

          <Group title="Řadit podle">
            <Segmented
              label="Řadit podle"
              value={draft.sort}
              onChange={(sort) => setDraft({ ...draft, sort: sort as SortKey })}
              options={(Object.keys(SORT_LABELS) as SortKey[]).map((k) => ({ value: k, label: SORT_LABELS[k] }))}
              columns={2}
            />
          </Group>

          <p aria-live="polite" className="tnum text-sm text-muted">
            {pending ? 'Hledáme…' : `Aktuální výběr: ${resultCount} ${plural(resultCount)}`}
          </p>
        </div>
      </Sheet>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-sm font-bold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

export function plural(n: number): string {
  if (n === 1) return 'nabídka';
  if (n >= 2 && n <= 4) return 'nabídky';
  return 'nabídek';
}
