import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, Input, Segmented, Sheet } from '../../components/ui';
import type { Category, SortKey } from '../../types/database';
import {
  activeChips,
  activeCount,
  applyIntent,
  DAYPART_LABELS,
  DEFAULT_FILTERS,
  intentOf,
  DISCOUNT_LABELS,
  PRICE_LABELS,
  RADIUS_LABELS,
  SORT_LABELS,
  TIME_INTENTS,
  type Daypart,
  type Filters,
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
  const count = activeCount({ ...filters, category: null });
  const label = (slug: string) => categories.find((c) => c.slug === slug)?.label_cs ?? slug;
  const chips = activeChips(filters, label).filter((chip) => chip.key !== 'category');

  function openSheet() {
    setDraft(filters);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <p id="kdy-label" className="mb-2 text-sm font-bold">Kdy máš čas?</p>
          <div role="radiogroup" aria-labelledby="kdy-label" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {TIME_INTENTS.map((intent) => {
              const active = intentOf(filters) === intent.key;
              return (
                <button
                  key={intent.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange(applyIntent(filters, intent.key))}
                  className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-bold whitespace-nowrap transition-colors ${active ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-card text-ink hover:border-accent'}`}
                >
                  {intent.label}
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" onClick={openSheet} aria-haspopup="dialog" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-card px-3 text-sm font-bold hover:border-accent">
          <SlidersHorizontal size={17} aria-hidden="true" />Filtry{count ? <span className="tnum text-accent">{count}</span> : null}
        </button>
      </div>
      <div className="flex max-w-full gap-5 overflow-x-auto border-b border-line" aria-label="Kategorie">
        {[{ slug: '', label_cs: 'Vše' }, ...categories].map((category) => {
          const active = (filters.category ?? '') === category.slug;
          return <button key={category.slug} type="button" aria-pressed={active} onClick={() => onChange({ ...filters, category: category.slug || null })} className={`min-h-12 shrink-0 border-b-2 px-1 text-sm font-semibold transition-colors ${active ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'}`}>{category.label_cs}</button>;
        })}
      </div>
      {chips.length ? <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
        <span>{chips.map((chip) => chip.label).join(' · ')}</span>
        <button type="button" onClick={() => onChange({ ...DEFAULT_FILTERS, when: filters.when, category: filters.category })} className="min-h-11 font-semibold text-accent underline underline-offset-4">Zrušit omezení</button>
      </div> : null}

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
