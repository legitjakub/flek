import { ImageOff, Minus, Plus } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { publishOffer } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { czkToCents, money } from '../../lib/format';
import { clockTime, dayLabel, localInput, localToInstant, ZONE } from '../../lib/time';
import { serverNow } from '../../lib/clock';
import { Banner, Button, Chip, Field, Input, Sheet } from '../../components/ui';
import { Link } from '../../app/router';
import type { Service } from '../../types/database';

export type OfferDraft = { service_id: string; original_price_cents: number; deal_price_cents: number; start_at?: string } | null;

/** Server bounds, mirrored so a merchant is told before the round trip, not after it. */
const MIN_DISCOUNT_PCT = 10;
const MAX_DISCOUNT_PCT = 85;
/** validate_offer refuses anything further out; the picker should refuse it first. */
const MAX_DAYS_AHEAD = 7;
/** publish_offer wants a cutoff at least five minutes out, so the start needs headroom. */
const MIN_MINUTES_AHEAD = 10;
const CUTOFF_MINUTES = 15;

export function offerDiscountPct(originalCents: number, dealCents: number): number {
  return originalCents > 0 && dealCents > 0
    ? Math.floor(((originalCents - dealCents) * 100) / originalCents)
    : 0;
}

/** Mirrors the database's integer arithmetic so the client and RPC accept the same prices. */
export function offerDiscountError(originalCents: number, dealCents: number): string | undefined {
  if (dealCents * 100 > originalCents * (100 - MIN_DISCOUNT_PCT)) {
    return `Sleva musí být aspoň ${MIN_DISCOUNT_PCT} %, tedy nejvýš ${money(Math.floor((originalCents * (100 - MIN_DISCOUNT_PCT)) / 100 / 100) * 100)}.`;
  }
  if (dealCents * 100 < originalCents * (100 - MAX_DISCOUNT_PCT)) {
    return `Sleva nesmí přesáhnout ${MAX_DISCOUNT_PCT} %, tedy aspoň ${money(Math.ceil((originalCents * (100 - MAX_DISCOUNT_PCT)) / 100 / 100) * 100)}.`;
  }
  return undefined;
}

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
  commissionRate,
}: {
  open: boolean;
  onClose: () => void;
  services: Service[];
  draft?: OfferDraft;
  /** Confirmation belongs on the page behind the sheet, not in one more screen to dismiss. */
  onPublished?: (summary: string) => void;
  /** businesses.commission_rate — per venue, not a constant, even though every row is 0.15. */
  commissionRate?: number;
}) {
  const queryClient = useQueryClient();
  const active = useMemo(() => services.filter((s) => s.is_active), [services]);
  const [serviceId, setServiceId] = useState<string | null>(draft?.service_id ?? active[0]?.id ?? null);
  const initialService = active.find((s) => s.id === draft?.service_id) ?? active[0] ?? null;
  const [start, setStartValue] = useState<string>(() => (draft?.start_at ? repeatSlot(draft.start_at, serverNow()) : nextSlot(serverNow())));
  const [originalPrice, setOriginalPriceValue] = useState<string>(() => String((draft?.original_price_cents ?? initialService?.normal_price_cents ?? 0) / 100 || ''));
  const [dealPrice, setDealPriceValue] = useState<string>(draft ? String(draft.deal_price_cents / 100) : '');
  const [capacity, setCapacity] = useState(1);
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
  function setOriginalPrice(value: string) {
    setOverlap(false);
    setOriginalPriceValue(value);
  }
  function setDealPrice(value: string) {
    setOverlap(false);
    setDealPriceValue(value);
  }

  const service = active.find((s) => s.id === serviceId) ?? active[0] ?? null;
  const originalCents = /^\d+$/.test(originalPrice) ? Number(originalPrice) * 100 : 0;
  const dealCents = /^\d+$/.test(dealPrice) ? Number(dealPrice) * 100 : 0;
  const discount = offerDiscountPct(originalCents, dealCents);
  const startInstant = parseStart(start);

  const originalPriceError = !/^\d+$/.test(originalPrice) || originalCents <= 0
    ? 'Zadejte běžnou cenu v celých korunách.'
    : undefined;
  const priceError =
    !/^\d+$/.test(dealPrice) || dealCents <= 0
      ? 'Zadejte cenu na FLEKu v celých korunách.'
      : originalPriceError
        ? undefined
        : offerDiscountError(originalCents, dealCents);

  const startError = !startInstant
    ? 'Vyberte datum a čas začátku.'
    : Date.parse(startInstant) < Date.parse(serverNow()) + MIN_MINUTES_AHEAD * 60_000
      ? `Termín musí začínat aspoň za ${MIN_MINUTES_AHEAD} minut.`
      : Date.parse(startInstant) > Date.parse(serverNow()) + MAX_DAYS_AHEAD * 24 * 3600_000
        ? `Termín může být nejdál ${MAX_DAYS_AHEAD} dní dopředu.`
        : undefined;

  const valid = Boolean(service) && !originalPriceError && !priceError && !startError;

  // Whole crowns on both lines: money() throws on anything else, and a merchant reading a
  // payout wants the two numbers to add back up to what the customer paid.
  const rate = commissionRate ?? 0.15;
  const commissionCents = Math.round((dealCents * rate) / 100) * 100;
  const payoutCents = dealCents - commissionCents;

  const publish = useMutation({
    mutationFn: async (confirmOverlap: boolean) => {
      if (!service || !startInstant) throw new Error('VALIDATION_ERROR');
      return publishOffer({
        service_id: service.id,
        start_at: startInstant,
        original_price_cents: czkToCents(originalPrice),
        deal_price_cents: czkToCents(dealPrice),
        capacity_total: capacity,
        booking_cutoff_at: cutoffFor(startInstant, serverNow()),
        confirm_overlap: confirmOverlap,
      });
    },
    onSuccess: async () => {
      const instant = startInstant ?? serverNow();
      onPublished?.(
        `${service?.name} · ${dayLabel(instant, serverNow())} ${clockTime(instant)} · ${money(dealCents)}`,
      );
      close();
      // Named keys. A bare invalidateQueries() threw away every cached query in the app,
      // customer discovery included, for one merchant publishing one slot.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['merchant-offers'] }),
        queryClient.invalidateQueries({ queryKey: ['merchant-bookings'] }),
        queryClient.invalidateQueries({ queryKey: ['merchant-metrics'] }),
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
      setFailure(errorMessage(error));
    },
  });

  function submit() {
    setAttempted(true);
    setFailure(null);
    if (!valid) {
      const first = startError ? 'offer-start' : originalPriceError ? 'offer-original-price' : 'offer-price';
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
                    setOriginalPriceValue(String(item.normal_price_cents / 100));
                    setDealPriceValue('');
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

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-bold text-ink">Cena</legend>
            <div className="grid grid-cols-2 gap-2.5">
              <Field id="offer-original-price" label="Běžná cena" error={attempted ? originalPriceError : undefined}>
                <div className="relative">
                  <Input
                    id="offer-original-price"
                    inputMode="numeric"
                    placeholder="650"
                    className="tnum min-h-14 pr-9 text-lg font-extrabold"
                    value={originalPrice}
                    onChange={(event) => setOriginalPrice(event.target.value.replace(/\D/g, ''))}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-bold text-muted">Kč</span>
                </div>
              </Field>
              <Field id="offer-price" label="Cena na FLEKu" error={attempted ? priceError : undefined}>
                <div className="relative">
                  <Input
                    id="offer-price"
                    inputMode="numeric"
                    placeholder="520"
                    className="tnum min-h-14 pr-9 text-lg font-extrabold"
                    value={dealPrice}
                    onChange={(event) => setDealPrice(event.target.value.replace(/\D/g, ''))}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-bold text-muted">Kč</span>
                </div>
              </Field>
            </div>
            {service && originalCents > 0 && dealCents > 0 && !originalPriceError && !priceError ? <Payout deal={dealCents} normal={originalCents} discount={discount} commission={commissionCents} payout={payoutCents} rate={rate} /> : null}
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
                onClick={() => setCapacity((n) => Math.max(1, n - 1))}
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
                onClick={() => setCapacity((n) => Math.min(50, n + 1))}
              >
                <Plus size={18} aria-hidden="true" />
              </Button>
              <p className="text-sm text-muted">
                {capacity === 1 ? 'Termín pro jednoho zákazníka.' : `Termín zvládne ${capacity} zákazníky najednou.`}
              </p>
            </div>
            {/* The cutoff is derived, not asked for: fifteen minutes before the start, never
                closer than five minutes from now, so it can no longer reject the form. */}
            <p className="text-sm text-muted">Rezervace se uzavře {CUTOFF_MINUTES} minut před začátkem.</p>
          </fieldset>

          {overlap ? <Banner tone="warning">Ve stejnou dobu už máte jinou nabídku. Máte dostatečnou kapacitu?</Banner> : null}
          {failure ? <Banner tone="warning">{failure}</Banner> : null}
        </div>
      )}
    </Sheet>
  );
}

/**
 * What the merchant actually earns.
 *
 * commission_rate has been on businesses since the first migration, it reaches the browser
 * inside my_businesses(), and no merchant screen has ever rendered it — the only place the
 * commission appeared at all was one platform-wide tile in the admin console. A partner
 * setting a price was choosing a number without being told what it left them.
 */
function Payout({
  deal,
  normal,
  discount,
  commission,
  payout,
  rate,
}: {
  deal: number;
  normal: number;
  discount: number;
  commission: number;
  payout: number;
  rate: number;
}) {
  return (
    <div className="mt-1 rounded-xl bg-surface p-3">
      <p className="tnum text-sm text-muted">
        Běžně {money(normal)} · sleva −{discount} %
      </p>
      <dl className="mt-2 flex flex-col gap-1 text-sm">
        <Line label="Zákazník zaplatí" value={money(deal)} />
        <Line label={`Provize FLEK (${Math.round(rate * 100)} %)`} value={`−${money(commission)}`} />
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-2">
          <dt className="text-base font-bold text-ink">Vám zůstane</dt>
          <dd className="tnum text-base font-extrabold text-ink">{money(payout)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tnum font-bold text-ink">{value}</dd>
    </div>
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
