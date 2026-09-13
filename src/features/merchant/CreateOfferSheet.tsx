import { ChevronDown, ImageOff, Minus, Plus } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { publishFlek } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { MIN_SAVING_PCT, maxMerchantPrice, merchantPriceForSaving, priceProblem, quote, type Quote } from '../../lib/pricing';
import { clockTime, dayLabel, localInput, localToInstant, ZONE } from '../../lib/time';
import { serverNow } from '../../lib/clock';
import { Banner, Button, Chip, Field, Input, Sheet } from '../../components/ui';
import { Link } from '../../app/router';
import type { Service } from '../../types/database';

/** A previous FLEK to repeat: the merchant's own price, not the customer's. */
export type OfferDraft = { service_id: string; merchant_price_cents: number; start_at?: string; capacity_total?: number } | null;

/** validate_flek refuses anything further out; the picker should refuse it first. */
const MAX_DAYS_AHEAD = 7;
/** publish_flek wants a cutoff at least five minutes out, so the start needs headroom. */
const MIN_MINUTES_AHEAD = 10;
const CUTOFF_MINUTES = 15;

/**
 * The flow that decides whether this company exists: one screen, no wizard.
 *
 * Two things used to make it feel long and strange. Capacity and cutoff lived inside a
 * collapsed `<details>` labelled "Více míst a pokročilé nastavení" that nothing ever opened
 * — so in practice every offer published through this sheet had exactly one seat, and the
 * cutoff nobody saw could reject the whole form ("INVALID_CUTOFF") for a slot twenty minutes
 * away. And the only validation was "a service is selected and the price is digits", so the
 * rest arrived as a server error at the bottom of a scroll container.
 *
 * Now capacity is a visible stepper, the cutoff is derived and clamped so it cannot fail,
 * and the bounds the server enforces are checked here first, in the same style ServicesPage
 * already uses: the button stays alive, the error lands on the field, focus goes to it.
 */
export function CreateOfferSheet({
  open,
  onClose,
  services,
  draft,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  services: Service[];
  draft?: OfferDraft;
  /** Confirmation belongs on the page behind the sheet, not in one more screen to dismiss. */
  onPublished?: (summary: string) => void;
}) {
  const queryClient = useQueryClient();
  const active = useMemo(() => services.filter((s) => s.is_active), [services]);
  const [serviceId, setServiceId] = useState<string | null>(draft?.service_id ?? active[0]?.id ?? null);
  const [start, setStartValue] = useState<string>(() => (draft?.start_at ? repeatSlot(draft.start_at, serverNow()) : nextSlot(serverNow())));
  /*
   * Prefilled from what this merchant asked for last time on this service. A barber who
   * offers the same cut at the same price every day should publish in seconds, not retype
   * the same two numbers; publish_flek remembers them on the service for exactly this.
   */
  const initialService = active.find((s) => s.id === (draft?.service_id ?? active[0]?.id)) ?? null;
  const [price, setPriceValue] = useState<string>(() => {
    const cents = draft?.merchant_price_cents ?? initialService?.default_merchant_price_cents;
    return cents ? String(cents / 100) : '';
  });
  const [capacity, setCapacity] = useState(draft?.capacity_total ?? initialService?.default_capacity ?? 1);
  const [priceTouched, setPriceTouched] = useState(Boolean(draft));
  const [capacityTouched, setCapacityTouched] = useState(Boolean(draft?.capacity_total));
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [overlap, setOverlap] = useState(false);

  /*
   * Any edit retracts the overlap confirmation. It used to be cleared only on close, so one
   * refusal turned `confirm_overlap: true` on for the rest of the session — every later
   * publish from the same sheet skipped the check silently, whatever the merchant changed.
   */
  function setStart(value: string) {
    setOverlap(false);
    setStartValue(value);
  }
  function setPrice(value: string) {
    setOverlap(false);
    setPriceTouched(true);
    setPriceValue(value);
  }
  function changeCapacity(next: number) {
    setCapacityTouched(true);
    setCapacity(next);
  }

  const service = active.find((s) => s.id === serviceId) ?? active[0] ?? null;
  const normal = service?.normal_price_cents ?? 0;
  const merchantCents = /^\d+$/.test(price) ? Number(price) * 100 : 0;
  // The live preview mirrors the server's fee; what is charged is decided by publish_flek.
  const q = service && merchantCents > 0 ? quote(merchantCents, normal) : null;
  const problem = q ? priceProblem(q) : null;
  const ceiling = service ? maxMerchantPrice(normal) : null;
  const startInstant = parseStart(start);

  const priceError =
    !/^\d+$/.test(price) || merchantCents <= 0 || !q
      ? 'Zadejte částku v celých korunách.'
      : problem === 'no_saving'
        ? 'Po připočtení servisního poplatku by zákazník zaplatil stejně nebo více než běžně. Snižte FLEK cenu.'
        : problem === 'saving_too_small'
          ? `Zákazník musí ušetřit aspoň ${MIN_SAVING_PCT} %. Zadejte nejvýš ${ceiling ? money(ceiling) : 'nižší částku'}.`
          : problem === 'price_too_low'
            ? 'Tahle částka je nezvykle nízká. Zkontrolujte ji prosím.'
            : undefined;

  const startError = !startInstant
    ? 'Vyberte datum a čas začátku.'
    : Date.parse(startInstant) < Date.parse(serverNow()) + MIN_MINUTES_AHEAD * 60_000
      ? `Termín musí začínat aspoň za ${MIN_MINUTES_AHEAD} minut.`
      : Date.parse(startInstant) > Date.parse(serverNow()) + MAX_DAYS_AHEAD * 24 * 3600_000
        ? `Termín může být nejdál ${MAX_DAYS_AHEAD} dní dopředu.`
        : undefined;

  const valid = Boolean(service) && !priceError && !startError;

  const publish = useMutation({
    mutationFn: async (confirmOverlap: boolean) => {
      if (!service || !startInstant) throw new Error('VALIDATION_ERROR');
      return publishFlek({
        service_id: service.id,
        start_at: startInstant,
        merchant_price_cents: merchantCents,
        capacity_total: capacity,
        booking_cutoff_at: cutoffFor(startInstant, serverNow()),
        confirm_overlap: confirmOverlap,
      });
    },
    onSuccess: async (offer) => {
      const instant = startInstant ?? serverNow();
      // The server's numbers, not the preview's: they are the ones customers will see.
      onPublished?.(
        `${service?.name} · ${dayLabel(instant, serverNow())} ${clockTime(instant)} · zákazník uvidí ${money(offer.deal_price_cents)}, vy dostanete ${money(offer.merchant_price_cents)}`,
      );
      close();
      // Named keys. A bare invalidateQueries() threw away every cached query in the app,
      // customer discovery included, for one merchant publishing one slot.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['merchant-offers'] }),
        queryClient.invalidateQueries({ queryKey: ['merchant-bookings'] }),
        queryClient.invalidateQueries({ queryKey: ['merchant-metrics'] }),
        queryClient.invalidateQueries({ queryKey: ['services'] }),
        queryClient.invalidateQueries({ queryKey: ['discovery'] }),
      ]);
    },
    onError: (error) => {
      const raw = error instanceof Error ? error.message : '';
      if (raw.includes('OVERLAP_CONFIRMATION_REQUIRED')) {
        setOverlap(true);
        setFailure(null);
        return;
      }
      setOverlap(false);
      setFailure(errorMessage(error, 'merchant'));
    },
  });

  function submit() {
    setAttempted(true);
    setFailure(null);
    if (!valid) {
      const first = startError ? 'offer-start' : 'offer-price';
      window.setTimeout(() => document.getElementById(first)?.focus(), 0);
      return;
    }
    publish.mutate(overlap);
  }

  function close() {
    setFailure(null);
    setOverlap(false);
    setAttempted(false);
    onClose();
  }

  const day = start.slice(0, 10);

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Přidat volný termín"
      footer={
        <Button size="lg" className="w-full" loading={publish.isPending} disabled={!service} onClick={submit}>
          {overlap ? 'Zveřejnit i tak' : 'Zveřejnit nabídku'}
        </Button>
      }
    >
      {active.length === 0 ? (
        <Banner tone="warning">
          Nejdřív si přidejte službu. Nabídka je vždy volný termín na konkrétní službu.
        </Banner>
      ) : (
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-bold text-ink">Služba</legend>
            <div className="flex flex-wrap gap-2">
              {active.map((item) => (
                <Chip
                  key={item.id}
                  active={item.id === service?.id}
                  onClick={() => {
                    setOverlap(false);
                    setServiceId(item.id);
                    if (!priceTouched) setPriceValue(item.default_merchant_price_cents ? String(item.default_merchant_price_cents / 100) : '');
                    if (!capacityTouched) setCapacity(item.default_capacity ?? 1);
                  }}
                >
                  {item.name} · {item.duration_minutes} min
                </Chip>
              ))}
            </div>

            {/*
              What the customer will see. The photograph was invisible to merchants until
              now — it came from the category, so a listing could be illustrated with
              something unrelated and nobody publishing it would ever notice.
            */}
            {service ? (
              <div className="mt-3 flex items-center gap-3 rounded-xl bg-surface p-3">
                {service.image_url ? (
                  <img src={service.image_url} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-line text-muted">
                    <ImageOff size={20} aria-hidden="true" />
                  </span>
                )}
                <p className="text-sm text-muted">
                  {service.image_url ? (
                    <>
                      Takhle nabídku uvidí zákazník. Fotku změníte{' '}
                      <Link to="/partner/sluzby" className="font-bold text-accent underline underline-offset-2">
                        u služby
                      </Link>
                      .
                    </>
                  ) : (
                    <>
                      Tahle služba nemá fotku, použije se fotka provozovny.{' '}
                      <Link to="/partner/sluzby" className="font-bold text-accent underline underline-offset-2">
                        Vyberte ji u služby
                      </Link>
                      .
                    </>
                  )}
                </p>
              </div>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-bold text-ink">Začátek</legend>
            {/*
              A day row above the hours. There was none: the chips offered +1 h, +2 h and
              four fixed evening times, so after seven in the evening only two chips were
              left and tomorrow could be reached only through the native picker.
            */}
            <div className="flex flex-wrap gap-2">
              {dayOptions(serverNow()).map((option) => (
                <Chip
                  key={option.value}
                  active={day === option.value}
                  onClick={() => setStart(`${option.value}T${start.slice(11) || '18:00'}`)}
                >
                  {option.label}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {timeOptions(day, serverNow()).map((option) => (
                <Chip key={option.value} active={start === option.value} onClick={() => setStart(option.value)}>
                  {option.label}
                </Chip>
              ))}
            </div>
            <Field id="offer-start" label="Přesný začátek" error={attempted ? startError : undefined}>
              <Input
                id="offer-start"
                type="datetime-local"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </Field>
          </fieldset>

          {/*
            The merchant names what they want to receive and never does the fee arithmetic:
            the preview shows both sides of it live — what they get, what the customer sees.
          */}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-bold text-ink">Cena</legend>
            {service ? (
              <div className="flex flex-wrap gap-2">
                {[20, 30, 40].map((pct) => {
                  const target = merchantPriceForSaving(normal, pct);
                  if (!target) return null;
                  return (
                    <Chip key={pct} active={merchantCents === target} onClick={() => setPrice(String(target / 100))}>
                      Zákazník ušetří {pct} %
                    </Chip>
                  );
                })}
              </div>
            ) : null}
            <Field id="offer-price" label="Kolik chcete za tento termín dostat?" error={attempted ? priceError : undefined}>
              <div className="relative">
                <Input
                  id="offer-price"
                  inputMode="numeric"
                  placeholder={ceiling ? `Nejvýš ${ceiling / 100}` : 'Částka'}
                  className="tnum min-h-14 pr-12 text-xl font-extrabold"
                  value={price}
                  aria-invalid={(attempted && Boolean(priceError)) || undefined}
                  onChange={(event) => setPrice(event.target.value.replace(/\D/g, ''))}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-bold text-muted">Kč</span>
              </div>
            </Field>
            {q ? <PriceBreakdown q={q} invalid={Boolean(problem)} /> : null}
            <PricingExplainer />
          </fieldset>

          {/*
            Out of the collapsed section and onto the screen. This is the difference between
            offering one seat and offering four, and it was hidden behind the words
            "pokročilé nastavení" — so it was never used.
          */}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-bold text-ink">Počet míst</legend>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                aria-label="O jedno místo méně"
                disabled={capacity <= 1}
                onClick={() => changeCapacity(Math.max(1, capacity - 1))}
              >
                <Minus size={18} aria-hidden="true" />
              </Button>
              <span className="tnum w-10 text-center text-xl font-extrabold text-ink" aria-live="polite">
                {capacity}
              </span>
              <Button
                variant="secondary"
                aria-label="O jedno místo více"
                disabled={capacity >= 50}
                onClick={() => changeCapacity(Math.min(50, capacity + 1))}
              >
                <Plus size={18} aria-hidden="true" />
              </Button>
              <p className="text-sm text-muted">
                {capacity === 1 ? 'Termín pro jednoho zákazníka.' : `Termín zvládne ${capacity} zákazníky najednou.`}
              </p>
            </div>
            {/* The cutoff is derived, not asked for: fifteen minutes before the start, never
                closer than five minutes from now, so it can no longer reject the form. */}
            {startInstant && !startError ? (
              <p className="text-sm text-muted">Rezervace se uzavře v {clockTime(cutoffFor(startInstant, serverNow()))}.</p>
            ) : null}
          </fieldset>

          {overlap ? <Banner tone="warning">Ve stejnou dobu už máte jinou nabídku. Máte dostatečnou kapacitu?</Banner> : null}
          {failure ? <Banner tone="warning">{failure}</Banner> : null}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Both sides of the price, live. "Vy dostanete" leads because it is the number the merchant
 * decides by; the customer's final price follows because it is the number customers decide
 * by. The fee itself is not a headline — it is the difference, explained one tap away.
 */
function PriceBreakdown({ q, invalid }: { q: Quote; invalid: boolean }) {
  return (
    <div className={`mt-1 rounded-xl p-3 ${invalid ? 'bg-warning-soft' : 'bg-surface'}`}>
      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-base font-bold text-ink">Vy dostanete</dt>
          <dd className="tnum text-xl font-extrabold text-ink">{money(q.merchantCents)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Zákazník uvidí</dt>
          <dd className="tnum text-base font-bold text-ink">{money(q.customerCents)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5">
          <dt className="text-muted">Běžná cena</dt>
          <dd className="tnum text-muted">{money(q.regularCents)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Zákazník ušetří</dt>
          <dd className="tnum font-bold text-ink">
            {q.savingCents > 0 ? `${money(q.savingCents)} · ${q.discountPct} %` : 'nic'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function PricingExplainer() {
  return (
    <details className="group">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-muted hover:text-accent">
        Jak funguje cena?
        <ChevronDown size={15} aria-hidden="true" className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-2 pb-1 text-sm leading-relaxed text-muted">
        <p>
          Částka, kterou zadáte, je částka, kterou po uskutečněné rezervaci dostanete. FLEK k ní přidá malý
          servisní poplatek, který platí zákazník. Zákazník vidí konečnou cenu už od první chvíle.
        </p>
        <p>
          U levnějších rezervací je minimální servisní poplatek 25 Kč, protože každá rezervace má pevné
          náklady na platbu a zpracování. U běžných rezervací je poplatek 5 % a u dražších služeb
          nepřesáhne 149 Kč.
        </p>
      </div>
    </details>
  );
}

/**
 * Repeating an offer keeps its time of day and moves it to the next day that is still in
 * the future — a barber repeating tomorrow's 18:00 does not mean "in thirty minutes".
 */
export function repeatSlot(previousStart: string, now: string): string {
  let candidate = Date.parse(previousStart);
  while (candidate <= Date.parse(now)) candidate += 24 * 3600_000;
  return localInput(new Date(candidate).toISOString());
}

/** Next half-hour in Prague wall-clock, as a `datetime-local` value. */
export function nextSlot(now: string): string {
  const rounded = new Date(Math.ceil((Date.parse(now) + 30 * 60_000) / (30 * 60_000)) * 30 * 60_000);
  return localInput(rounded.toISOString());
}

/**
 * Fifteen minutes before the start, but never inside the five-minute floor the server keeps,
 * and never after the start itself. Publishing a slot twenty minutes out used to fail with
 * INVALID_CUTOFF because of a default field the merchant had no way to see.
 */
export function cutoffFor(startInstant: string, now: string): string {
  const start = Date.parse(startInstant);
  const floor = Date.parse(now) + 6 * 60_000;
  return new Date(Math.min(start, Math.max(start - CUTOFF_MINUTES * 60_000, floor))).toISOString();
}

function parseStart(value: string): string | null {
  try {
    return localToInstant(value);
  } catch {
    return null;
  }
}

/** Today plus the next two days, as `datetime-local` date parts. */
export function dayOptions(now: string): { value: string; label: string }[] {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE });
  const weekday = new Intl.DateTimeFormat('cs-CZ', { timeZone: ZONE, weekday: 'short' });
  return [0, 1, 2, 3].map((offset) => {
    const at = new Date(Date.parse(now) + offset * 24 * 3600_000);
    return {
      value: format.format(at),
      label: offset === 0 ? 'Dnes' : offset === 1 ? 'Zítra' : weekday.format(at),
    };
  });
}

/**
 * Hours for the chosen day. Today also gets the two relative chips, because "za hodinu" is
 * the reason this product exists; a future day gets the full list, unfiltered.
 */
export function timeOptions(day: string, now: string): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(now));
  if (day === today) {
    for (const minutes of [60, 120]) {
      const at = new Date(Date.parse(now) + minutes * 60_000).toISOString();
      options.push({ value: localInput(at), label: `+${minutes / 60} h` });
    }
  }
  for (const hhmm of ['09:00', '11:00', '13:00', '15:00', '17:00', '18:00', '19:00', '20:00']) {
    const value = `${day}T${hhmm}`;
    try {
      if (Date.parse(localToInstant(value)) > Date.parse(now)) options.push({ value, label: hhmm });
    } catch {
      /* the DST gap has no such wall-clock time that day */
    }
  }
  return options;
}
