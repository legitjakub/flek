import { useEffect, useState } from 'react';
import { locate } from '../../lib/geo';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, ChevronDown, LocateFixed, MapPin, SlidersHorizontal } from 'lucide-react';
import { Link } from '../../app/router';
import { Button, Field, Input, Segmented, Select, Sheet, buttonClass, cx } from '../../components/ui';
import { deleteWatch, saveWatch, type WatchInput } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import type { Category, FlekWatch } from '../../types/database';
import { useSession } from '../auth/session';
import { DAYPART_LABELS, DISCOUNT_LABELS, PRICE_LABELS, type Daypart, type Filters } from '../discovery/filters';
import { money } from '../../lib/format';
import { devicePushEnabled, enableDevicePush } from '../notifications/Notifications';
import { TRAVEL_MINUTES, TRAVEL_MODE_LABELS, radiusLabel, watchRadius, type TravelMinutes, type TravelMode } from './travel';

type Place = { lat: number; lng: number; label: string };

/**
 * Setting up a watch: where, how far, what. It starts from what the customer is already looking
 * at — the place and the filters above the map — so turning a search into a watch is one tap and a
 * glance, not a second form. Editing an existing watch opens the same sheet with its values.
 */
export function WatchSheet({
  open,
  onClose,
  watch,
  mapPoint,
  here,
  filters,
  categories,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** An existing watch to edit; without it the sheet creates a new one. */
  watch?: FlekWatch | null;
  /** The place the map is searching around. */
  mapPoint: Place;
  /** The device position, when the customer has allowed it. */
  here: { lat: number; lng: number } | null;
  filters?: Filters;
  categories: Category[];
  /** `note` says how the customer will hear about new FLEKs, for a confirmation on the screen behind. */
  onSaved?: (id: string, note: string) => void;
}) {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  // The device position: from the map when it already knows it, or asked for right here.
  const [position, setPosition] = useState(here);
  const [locating, setLocating] = useState(false);
  const [form, setForm] = useState<WatchInput>(() => initial(watch, mapPoint, here, filters));
  // Editing a watch that follows the customer keeps „where I am“ selected, even before the map knows it.
  const [useHere, setUseHere] = useState(watch ? watch.follow_me : Boolean(here));
  const [push, setPush] = useState<'unknown' | 'on' | 'off'>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Every opening starts from the current state of the map, not from what was typed last time.
  useEffect(() => {
    if (!open) return;
    setPosition(here);
    setForm(initial(watch, mapPoint, here, filters));
    setUseHere(watch ? watch.follow_me : Boolean(here));
    setError('');
    void devicePushEnabled().then((enabled) => setPush(enabled ? 'on' : 'off'));
    // The map point and filters are read when the sheet opens; later changes do not reset a half-filled form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, watch?.id]);

  const set = <K extends keyof WatchInput>(key: K, value: WatchInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const radius = watchRadius(form.travel_mode, form.travel_minutes);

  async function choosePlace(nextHere: boolean) {
    setError('');
    if (nextHere && !position) {
      // Asking here, at the moment it is needed, rather than sending the customer back to the map.
      setLocating(true);
      try {
        const found = await locate();
        setPosition(found);
        setUseHere(true);
        setForm((current) => ({ ...current, lat: found.lat, lng: found.lng, follow_me: true, label: current.label === placeLabel(mapPoint) ? 'Moje okolí' : current.label }));
      } catch {
        setError('Polohu se nepodařilo zjistit. Povol ji v prohlížeči, nebo hlídej místo, kde hledáš.');
      } finally {
        setLocating(false);
      }
      return;
    }
    setUseHere(nextHere);
    if (nextHere && position) {
      setForm((current) => ({ ...current, lat: position.lat, lng: position.lng, follow_me: true, label: current.label === placeLabel(mapPoint) ? 'Moje okolí' : current.label }));
    } else {
      setForm((current) => ({ ...current, lat: mapPoint.lat, lng: mapPoint.lng, follow_me: false, label: current.label === 'Moje okolí' ? placeLabel(mapPoint) : current.label }));
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    /*
     * The one moment a permission prompt makes sense to the customer: they just asked to be told.
     * It has to be the first thing the tap does — browsers only allow the prompt while the tap is
     * fresh. A refusal does not stop the watch; it only means news waits in the bell.
     */
    let note = 'Hlídač běží. Nové FLEKy ti pošleme na telefon.';
    if (push !== 'on') {
      try {
        await enableDevicePush();
        setPush('on');
      } catch (failure) {
        note = `Hlídač běží, nové FLEKy uvidíš ve zvonečku. ${failure instanceof Error ? failure.message : ''}`.trim();
      }
    }
    try {
      const id = await saveWatch({ ...form, label: form.label.trim() || 'Moje okolí' }, watch?.id ?? null);
      await queryClient.invalidateQueries({ queryKey: ['watches'] });
      onSaved?.(id, watch ? 'Hlídač je upravený.' : note);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!watch) return;
    setBusy(true);
    try {
      await deleteWatch(watch.id);
      await queryClient.invalidateQueries({ queryKey: ['watches'] });
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!userId) {
    return (
      <Sheet open={open} onClose={onClose} title="Hlídač FLEKů">
        <Intro />
        <p className="mt-4 text-sm text-muted">Hlídač ti posílá upozornění, takže potřebuje účet.</p>
        <Link
          to={`/prihlaseni?returnTo=${encodeURIComponent('/mapa')}`}
          className={cx(buttonClass({ size: 'lg', shape: 'pill' }), 'mt-4 w-full')}
        >
          Přihlásit se
        </Link>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={watch ? 'Upravit hlídač' : 'Hlídač FLEKů'}
      footer={
        <div className="flex gap-2">
          {watch ? (
            <Button variant="secondary" disabled={busy} onClick={() => void remove()}>
              Smazat
            </Button>
          ) : null}
          <Button size="lg" className="flex-1" loading={busy} onClick={() => void save()}>
            <BellRing size={18} aria-hidden="true" />
            {watch ? 'Uložit' : 'Hlídat okolí'}
          </Button>
        </div>
      }
    >
      {watch ? null : <Intro />}

      <fieldset className={watch ? '' : 'mt-5'}>
        <legend className="text-base font-extrabold text-ink">Kde</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <PlaceOption
            active={useHere}
            disabled={locating}
            onClick={() => void choosePlace(true)}
            icon={<LocateFixed size={18} aria-hidden="true" className={locating ? 'animate-spin' : ''} />}
            title="Kde právě jsem"
            hint={locating ? 'Zjišťuju polohu…' : position ? 'Posune se s tebou, když otevřeš mapu' : 'Klepni a povol polohu'}
          />
          <PlaceOption
            active={!useHere}
            onClick={() => void choosePlace(false)}
            icon={<MapPin size={18} aria-hidden="true" />}
            title={placeLabel(mapPoint)}
            hint="Místo, kolem kterého teď hledáš"
          />
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-base font-extrabold text-ink">Jak daleko</legend>
        <div className="mt-2 flex flex-col gap-2">
          <Segmented<TravelMode>
            label="Jak se dopravíš"
            value={form.travel_mode}
            onChange={(value) => set('travel_mode', value)}
            options={(['walk', 'ride'] as const).map((value) => ({ value, label: TRAVEL_MODE_LABELS[value] }))}
          />
          <Segmented<TravelMinutes>
            label="Kolik minut"
            value={form.travel_minutes}
            onChange={(value) => set('travel_minutes', value)}
            options={TRAVEL_MINUTES.map((value) => ({ value, label: `do ${value} min` }))}
          />
        </div>
        <p className="tnum mt-2 text-sm text-muted">
          Zhruba <strong className="text-ink">{radiusLabel(radius)}</strong> vzdušnou čarou. Skutečná cesta bývá o kus delší.
        </p>
      </fieldset>

      {/*
        What to watch starts as the filter already set above the map, so most people never need to
        open this; it stays one line that says what is chosen instead of four more controls on a
        phone screen. Open, it is the same four choices as the filter sheet.
      */}
      <details className="group mt-5 rounded-2xl border border-line bg-card">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3.5 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
            <SlidersHorizontal size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-extrabold text-ink">Co hlídat</span>
            <span className="block truncate text-sm text-muted">{filterSummary(form, categories)}</span>
          </span>
          <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-4 border-t border-line px-3.5 pt-3 pb-4">
          <Field id="watch-category" label="Aktivita">
            <Select id="watch-category" value={form.category ?? ''} onChange={(event) => set('category', event.target.value || null)}>
              <option value="">Cokoli</option>
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>{category.label_cs}</option>
              ))}
            </Select>
          </Field>
          <Choice label="Cena">
            <Segmented<number | null>
              label="Nejvyšší cena"
              value={form.max_price_cents}
              onChange={(value) => set('max_price_cents', value)}
              options={PRICE_LABELS.map(([value, label]) => ({ value, label }))}
              columns={2}
            />
          </Choice>
          <Choice label="Sleva">
            <Segmented<number>
              label="Nejnižší sleva"
              value={form.min_discount_pct}
              onChange={(value) => set('min_discount_pct', value)}
              options={DISCOUNT_LABELS.map(([value, label]) => ({ value, label }))}
              columns={2}
            />
          </Choice>
          <Choice label="Kdy máš čas">
            <Segmented<Daypart | null>
              label="Část dne"
              value={form.daypart}
              onChange={(value) => set('daypart', value)}
              options={[{ value: null, label: 'Kdykoli' }, ...(Object.keys(DAYPART_LABELS) as Daypart[]).map((value) => ({ value, label: DAYPART_LABELS[value] }))]}
              columns={2}
            />
          </Choice>
        </div>
      </details>

      <div className="mt-5">
        <Field id="watch-label" label="Název" hint="Uvidíš ho v upozornění, třeba „Kolem práce“.">
          <Input id="watch-label" maxLength={60} value={form.label} onChange={(event) => set('label', event.target.value)} />
        </Field>
      </div>

      {/* Without push the watch still works — in the bell — but the point of it is the phone buzzing. */}
      <div className="mt-5 rounded-2xl bg-brand-soft p-3.5">
        {push === 'on' ? (
          <p className="flex items-center gap-2 text-sm font-bold text-accent">
            <Check size={16} aria-hidden="true" /> Oznámení na tomhle telefonu jsou zapnutá.
          </p>
        ) : (
          <p className="text-sm text-ink">
            <strong>Ať ti telefon pípne.</strong> Po uložení tě prohlížeč požádá o povolení oznámení. Bez nich uvidíš nové FLEKy jen ve zvonečku.
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          Nejvýš jedna zpráva za čtvrt hodiny. V noci mlčí a co přibude, pošle ráno v 7 najednou. E-mailem jen když si ho zapneš v Profilu.
        </p>
      </div>

      {error ? <p role="alert" className="mt-3 text-sm font-medium text-danger">{error}</p> : null}
    </Sheet>
  );
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-bold text-ink">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** „Masáže · do 500 Kč · večer", or „Všechny FLEKy" when nothing narrows it. */
function filterSummary(form: WatchInput, categories: Category[]): string {
  const parts = [
    form.category ? categories.find((category) => category.slug === form.category)?.label_cs ?? null : null,
    form.max_price_cents ? `do ${money(form.max_price_cents)}` : null,
    form.min_discount_pct ? `−${form.min_discount_pct} % a víc` : null,
    form.daypart ? DAYPART_LABELS[form.daypart].toLocaleLowerCase('cs-CZ') : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Všechny FLEKy v okruhu';
}

function Intro() {
  return (
    <p className="text-base text-ink">
      Dáme ti vědět, když se v okolí uvolní <strong>nový FLEK</strong> podle tvého výběru. Hlídáme termíny na nejbližší
      dva dny.
    </p>
  );
}

function PlaceOption({ active, disabled, onClick, icon, title, hint }: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex min-h-11 items-start gap-3 rounded-2xl border p-3 text-left transition-colors disabled:opacity-55',
        active ? 'border-brand bg-brand-soft ring-1 ring-brand' : 'border-line bg-card hover:border-accent',
      )}
    >
      <span className={cx('grid size-8 shrink-0 place-items-center rounded-full', active ? 'bg-brand text-brand-ink' : 'bg-accent-soft text-accent')}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-bold text-ink">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}

function placeLabel(point: Place): string {
  return point.label === 'Moje poloha' ? 'Moje okolí' : point.label.slice(0, 60);
}

function initial(watch: FlekWatch | null | undefined, mapPoint: Place, here: { lat: number; lng: number } | null, filters?: Filters): WatchInput {
  if (watch) {
    const { id: _id, radius_m: _r, created_at: _c, last_alert_at: _l, matching_now: _m, ...rest } = watch;
    return rest;
  }
  const at = here ?? mapPoint;
  return {
    label: here ? 'Moje okolí' : placeLabel(mapPoint),
    lat: at.lat,
    lng: at.lng,
    travel_mode: 'walk',
    travel_minutes: 20,
    category: filters?.category ?? null,
    max_price_cents: PRICE_LABELS.some(([value]) => value === filters?.max_price_cents) ? filters?.max_price_cents ?? null : null,
    min_discount_pct: DISCOUNT_LABELS.some(([value]) => value === filters?.min_discount_pct) ? filters?.min_discount_pct ?? 0 : 0,
    daypart: filters?.daypart ?? null,
    follow_me: Boolean(here),
    paused: false,
  };
}
