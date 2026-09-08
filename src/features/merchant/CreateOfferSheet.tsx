import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { publishOffer } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { czkToCents, money } from '../../lib/format';
import { addMinutes, clockTime, dayLabel, localInput, localToInstant, ZONE } from '../../lib/time';
import { serverNow } from '../../lib/clock';
import { Banner, Button, Chip, Field, Input, Sheet } from '../../components/ui';
import type { Service } from '../../types/database';

export type OfferDraft = { service_id: string; deal_price_cents: number; start_at?: string } | null;

/**
 * The flow that decides whether this company exists: one screen, no wizard.
 * Quick chips remove the slowest step (typing a time into a native picker).
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
  const [start, setStart] = useState<string>(() => (draft?.start_at ? repeatSlot(draft.start_at, serverNow()) : nextSlot(serverNow())));
  const [price, setPrice] = useState<string>(draft ? String(draft.deal_price_cents / 100) : '');
  const [capacity, setCapacity] = useState('1');
  const [cutoffMinutes, setCutoffMinutes] = useState('15');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [overlap, setOverlap] = useState(false);

  const service = active.find((s) => s.id === serviceId) ?? active[0] ?? null;
  const normal = service?.normal_price_cents ?? 0;
  const dealCents = /^\d+$/.test(price) ? Number(price) * 100 : 0;
  const discount = normal > 0 && dealCents > 0 ? Math.floor(((normal - dealCents) * 100) / normal) : 0;

  const publish = useMutation({
    mutationFn: async (confirmOverlap: boolean) => {
      if (!service) throw new Error('VALIDATION_ERROR');
      const startInstant = localToInstant(start);
      return publishOffer({
        service_id: service.id,
        start_at: startInstant,
        deal_price_cents: czkToCents(price),
        capacity_total: Math.max(1, Number(capacity) || 1),
        booking_cutoff_at: addMinutes(startInstant, -Math.max(0, Number(cutoffMinutes) || 0)),
        confirm_overlap: confirmOverlap,
      });
    },
    onSuccess: async () => {
      const startInstant = localToInstantSafe(start);
      onPublished?.(
        `${service?.name} · ${dayLabel(startInstant, serverNow())} ${clockTime(startInstant)} · ${money(dealCents)}`,
      );
      close();
      await queryClient.invalidateQueries();
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

  function close() {
    setFailure(null);
    setOverlap(false);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Přidat volný termín"
      footer={
        <Button
          size="lg"
          className="w-full"
          loading={publish.isPending}
          disabled={!service || !/^\d+$/.test(price)}
          onClick={() => publish.mutate(overlap)}
        >
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
                  onClick={() => setServiceId(item.id)}
                >
                  {item.name} · {item.duration_minutes} min
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-bold text-ink">Začátek</legend>
            <div className="flex flex-wrap gap-2">
              {quickTimes(serverNow()).map((option) => (
                <Chip key={option.value} active={start === option.value} onClick={() => setStart(option.value)}>
                  {option.label}
                </Chip>
              ))}
            </div>
            <Input
              id="offer-start"
              type="datetime-local"
              aria-label="Přesný začátek"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-bold text-ink">Cena</legend>
            {service ? (
              <div className="flex flex-wrap gap-2">
                {[20, 30, 40].map((pct) => (
                  <Chip
                    key={pct}
                    active={discount === pct}
                    onClick={() => setPrice(String(Math.round((normal * (100 - pct)) / 100 / 100)))}
                  >
                    −{pct} %
                  </Chip>
                ))}
              </div>
            ) : null}
            <Input
              id="offer-price"
              inputMode="numeric"
              aria-label="Cena v korunách"
              placeholder="Cena v Kč"
              className="tnum min-h-14 text-xl font-extrabold"
              value={price}
              onChange={(event) => setPrice(event.target.value.replace(/\D/g, ''))}
            />
            {service && dealCents > 0 ? (
              <p className="tnum text-sm font-semibold text-ink">
                {money(normal)} → {money(dealCents)} · −{discount} %
              </p>
            ) : null}
          </fieldset>

          <details className="border-t border-line pt-2" open={showAdvanced} onToggle={(event) => setShowAdvanced(event.currentTarget.open)}>
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-muted">Více míst a pokročilé nastavení</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field id="offer-capacity" label="Počet míst"><Input id="offer-capacity" inputMode="numeric" value={capacity} onChange={(event) => setCapacity(event.target.value.replace(/\D/g, '') || '1')} /></Field>
              <Field id="offer-cutoff" label="Uzávěrka před začátkem" hint="V minutách"><Input id="offer-cutoff" inputMode="numeric" value={cutoffMinutes} onChange={(event) => setCutoffMinutes(event.target.value.replace(/\D/g, '') || '0')} /></Field>
            </div>
          </details>

          {overlap ? <Banner tone="warning">Ve stejnou dobu už máte jinou nabídku. Máte dostatečnou kapacitu?</Banner> : null}
          {failure ? <Banner tone="warning">{failure}</Banner> : null}
        </div>
      )}
    </Sheet>
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

function localToInstantSafe(value: string): string {
  try {
    return localToInstant(value);
  } catch {
    return serverNow();
  }
}

function quickTimes(now: string): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (const minutes of [60, 120]) {
    const at = new Date(Date.parse(now) + minutes * 60_000).toISOString();
    options.push({ value: localInput(at), label: `+${minutes / 60} h` });
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(now));
  for (const hhmm of ['17:00', '18:00', '18:30', '19:00']) {
    const value = `${today}T${hhmm}`;
    try {
      if (Date.parse(localToInstant(value)) > Date.parse(now)) options.push({ value, label: hhmm });
    } catch {
      /* the DST gap has no such wall-clock time today */
    }
  }
  return options;
}
