import { Info, SlidersHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  type When,
} from './filters';

/** Width of the fade over a rail edge that hides more pills; `.rail-edges` in styles.css. */
const RAIL_FADE = 24;

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
  applied,
  note,
  floating = false,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  categories: Category[];
  resultCount: number;
  pending: boolean;
  /**
   * What the search actually ran with after the cold-start ladder had its say. The rail is
   * lit from this, not from `filters`: a pill that says "Teď" above a week's worth of cards
   * is the whole reason the filters read as broken.
   */
  applied?: { when: When; radius_m: number };
  /** What the cold-start ladder widened, as one short line. */
  note?: string | null;
  /** Over a full-screen map: white pills lifted by a shadow instead of outlined on cream. */
  floating?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(filters);
  const count = activeCount(filters);
  const label = (slug: string) => categories.find((c) => c.slug === slug)?.label_cs ?? slug;
  const chips = activeChips(filters, label);
  const lit = intentOf({ ...filters, when: applied?.when ?? filters.when });
  const rail = useRef<HTMLDivElement>(null);

  // Over the map a fade on a half-hidden white pill left a ghost of it floating on the tiles,
  // and the scroll to the lit pill cut the first one hard at the left edge. The rail now rests
  // on whole pills (scroll snap) and fades only the edge that actually hides more of them.
  const [edges, setEdges] = useState({ start: false, end: false });
  const measureEdges = useCallback(() => {
    const viewport = rail.current;
    if (!viewport) return;
    const start = viewport.scrollLeft > 1;
    const end = viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1;
    setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
  }, []);
  useEffect(() => {
    const viewport = rail.current;
    if (!viewport) return;
    measureEdges();
    const observer = new ResizeObserver(measureEdges);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [measureEdges]);

  // The lit pill can sit past the fade at the rail's end ("Dnes" on a phone, beside Filtry),
  // which reads as nothing being selected. Scroll the rail itself — never the page — to the
  // first whole-pill position that shows it clear of the fade.
  useEffect(() => {
    const viewport = rail.current;
    const chip = viewport?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!viewport || !chip) return;
    const origin = viewport.getBoundingClientRect().left - viewport.scrollLeft;
    const left = (element: Element) => element.getBoundingClientRect().left - origin;
    const right = left(chip) + chip.offsetWidth;
    const max = viewport.scrollWidth - viewport.clientWidth;
    const clear = (scroll: number) => right - scroll <= viewport.clientWidth - (scroll < max ? RAIL_FADE : 0);
    if (clear(viewport.scrollLeft) && left(chip) >= viewport.scrollLeft + (viewport.scrollLeft > 0 ? RAIL_FADE : 0)) return;
    const stops = [...viewport.children].map((element) => Math.min(max, Math.max(0, left(element) - RAIL_FADE)));
    viewport.scrollLeft = stops.find((stop) => clear(stop) && stop <= left(chip) - (stop > 0 ? RAIL_FADE : 0)) ?? stops[0];
  }, [lit]);
  // The ladder can search at 25 km while the radius chip still reads 5 km and the Filtry
  // badge reads zero. Say it — once, in one line beside the chips. It used to be a chip AND a
  // full-width banner saying the same thing, which cost a phone screen about 150 px of offers.
  // No cross: it is not the customer's choice to undo.
  const widened = note ?? null;

  function openSheet() {
    setDraft(filters);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          {/* The six labelled pills say this themselves; the heading only cost height. */}
          <div
            ref={rail}
            role="radiogroup"
            aria-label="Kdy máš čas"
            onScroll={measureEdges}
            data-more-start={edges.start || undefined}
            data-more-end={edges.end || undefined}
            className={`rail rail-edges -mx-1 flex snap-x snap-mandatory scroll-px-6 gap-2 px-1 ${floating ? '-my-3 py-3' : '-my-1 py-1'}`}
          >
            {TIME_INTENTS.map((intent) => {
              const active = lit === intent.key;
              return (
                <button
                  key={intent.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange(applyIntent(filters, intent.key))}
                  className={`min-h-11 shrink-0 snap-start rounded-full border px-4 text-sm font-bold whitespace-nowrap transition-colors ${active ? 'border-ink bg-ink text-accent-ink' : floating ? 'border-transparent bg-card text-ink shadow-card hover:border-accent' : 'border-line bg-card text-ink hover:border-accent'} ${floating && active ? 'shadow-card' : ''}`}
                >
                  {intent.label}
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" onClick={openSheet} aria-haspopup="dialog" className={`inline-flex min-h-11 shrink-0 items-center gap-2 border bg-card px-4 text-sm font-bold hover:border-accent ${floating ? 'rounded-full border-transparent shadow-card' : 'rounded-xl border-line'}`}>
          <SlidersHorizontal size={17} aria-hidden="true" />
          Filtry
          {count ? (
            <span className="tnum grid size-5 place-items-center rounded-full bg-brand text-xs font-bold text-brand-ink">
              {count}
            </span>
          ) : null}
        </button>
      </div>
      {chips.length || widened ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {/*
            These were a joined string of labels while every chip carried a `clear` nobody
            called — the toolbar showed what was narrowing the results and gave no way to
            stop it. One tap, one filter gone.
          */}
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChange(chip.clear(filters))}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-card py-1 pr-2 pl-3 font-bold text-ink transition-colors hover:border-accent ${floating ? 'border-transparent shadow-card' : 'border-line'}`}
            >
              {chip.label}
              <X size={15} aria-hidden="true" className="text-muted" />
              <span className="sr-only">Zrušit filtr</span>
            </button>
          ))}
          {widened ? (
            <span role="status" className={`inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-2xl bg-brand-soft px-3 py-1.5 font-bold text-accent ring-1 ring-brand/15 ${floating ? 'shadow-card' : ''}`}>
              <Info size={15} aria-hidden="true" className="shrink-0 text-brand" />
              <span className="min-w-0">{widened}</span>
            </span>
          ) : null}
          {chips.length ? (
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_FILTERS, when: filters.when })}
              className={`min-h-9 font-bold underline underline-offset-4 ${floating ? 'rounded-full bg-card px-3 text-ink shadow-card' : 'text-accent'}`}
            >
              Zrušit vše
            </button>
          ) : null}
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
          <Group title="Obor">
            <div className="flex flex-wrap gap-2">
              {[{ slug: '', label_cs: 'Vše' }, ...categories].map((category) => {
                const active = (draft.category ?? '') === category.slug;
                return (
                  <button
                    key={category.slug}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDraft({ ...draft, category: category.slug || null })}
                    className={`min-h-11 rounded-xl px-3.5 text-base font-bold transition-colors ${
                      active ? 'bg-ink text-card' : 'bg-surface text-ink hover:bg-line/60'
                    }`}
                  >
                    {category.label_cs}
                  </button>
                );
              })}
            </div>
          </Group>

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
            <p className="mt-2 text-sm text-muted">
              Doporučené řadí podle vzdálenosti (45 %), toho, jak brzy FLEK začíná (35 %), a výše slevy (20 %). Za lepší
              pozici podniky neplatí.
            </p>
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
