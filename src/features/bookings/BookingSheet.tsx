import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { BellRing, Dumbbell, Flower2, Hand, Lock, ShieldCheck, Scissors, Sparkles, Ticket, Waves, type LucideIcon } from 'lucide-react';
import { confirmationQuote, openCheckout, paymentsMode, saveProfile, startPayment } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { profileSchema } from '../../lib/schemas';
import { clockTime, dayLabel, duration, untilLabel } from '../../lib/time';
import { track } from '../../lib/analytics';
import { Banner, Button, Field, Input, PinMark, Sheet, Skeleton, cx } from '../../components/ui';
import { OriginalPrice, savings } from '../../components/Price';
import { hasPhone, useSession } from '../auth/session';
import { useRouter } from '../../app/router';
import type { OfferDetail } from '../../types/database';
import { useLegalInfo } from '../legal/useLegal';
import { ProviderLine } from '../legal/ProviderLine';

type ProfileValues = z.infer<typeof profileSchema>;

/**
 * Confirmation sheet. Phone capture happens here — in flow, not at signup — because the
 * merchant needs a way to reach the customer and it visibly raises commitment.
 */
export function BookingSheet({
  offer,
  now,
  open,
  onClose,
}: {
  offer: OfferDetail;
  now: string;
  open: boolean;
  onClose: () => void;
}) {
  const { profile, userId } = useSession();
  const { navigate, search } = useRouter();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const mode = useQuery({ queryKey: ['payments-mode'], queryFn: paymentsMode, staleTime: 300_000 });
  // Whether this venue confirms each booking, and roughly how long it would have. The server fixes the
  // real deadline when the card is authorised; this is only what to say before paying.
  const quote = useQuery({
    queryKey: ['confirmation-quote', offer.id],
    queryFn: () => confirmationQuote(offer.id),
    enabled: open && Boolean(userId),
    staleTime: 15_000,
  });
  const windowMinutes = quote.data?.window_seconds ? Math.max(1, Math.round(quote.data.window_seconds / 60)) : null;
  const holdMinutes = Math.max(1, Math.round((quote.data?.hold_seconds ?? 180) / 60));
  // The terms version the customer is shown is the one the server records consent to; none while no terms are in force.
  const legal = useLegalInfo();
  const termsVersion = legal.data?.documents.customer_terms?.version ?? null;
  const needsPhone = !hasPhone(profile);
  const needsName = !profile?.first_name?.trim();

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { first_name: '', last_name: '', phone: '' },
    mode: 'onTouched',
  });

  useEffect(() => {
    if (!profile) return;
    form.reset({ first_name: profile.first_name, last_name: profile.last_name, phone: profile.phone ?? '' });
  }, [profile, form]);

  useEffect(() => {
    if (open) track('booking_started', { offer_id: offer.id });
  }, [open, offer.id]);

  const book = useMutation({
    mutationFn: async (values: ProfileValues | null) => {
      if (values) await saveProfile(values);
      // The amount comes from the offer row on the server, never from this screen.
      const payment = await startPayment(offer.id, termsVersion);
      // A merchant may have edited the price after this sheet opened: show the new one first.
      if (payment.amount_cents !== offer.deal_price_cents) throw new Error('PRICE_CHANGED');
      /*
       * The card is entered on Stripe's own page. The seat is booked by Stripe's webhook, not
       * by this tab, so a customer who pays and closes the browser still gets the booking;
       * the detail page picks the result up from `?platba=` when they come back.
       */
      const checkout = await openCheckout(payment.id);
      if (checkout.url) window.location.assign(checkout.url);
      else navigate(`/nabidka/${offer.id}?platba=${payment.id}`, { replace: true });
      return await new Promise<never>(() => undefined);
    },
    onError: (error) => {
      const code = error instanceof Error ? error.message : 'UNKNOWN';
      track('booking_failed', { offer_id: offer.id, code: code.slice(0, 80) });
      setFailure(errorMessage(error));
      if (code.includes('TERMS_OUTDATED')) void queryClient.invalidateQueries({ queryKey: ['legal-info'] });
      // Availability may have changed under us; refresh what the customer is looking at.
      void queryClient.invalidateQueries({ queryKey: ['offer', offer.id] });
      void queryClient.invalidateQueries({ queryKey: ['discovery'] });
    },
  });

  if (!userId) {
    return (
      <Sheet open={open} onClose={onClose} title="Rezervace">
        <p className="text-sm text-muted">Pro rezervaci se přihlas. Vrátíme tě zpátky na tuhle nabídku.</p>
        <Button
          className="mt-4 w-full"
          size="lg"
          data-autofocus
          onClick={() => navigate(`/prihlaseni?returnTo=${encodeURIComponent(`/nabidka/${offer.id}?${new URLSearchParams({ ...Object.fromEntries(search), rezervovat: '1' })}`)}`)}
        >
          Přihlásit se a pokračovat
        </Button>
      </Sheet>
    );
  }

  const deadline = cancellationDeadline(offer.start_at, offer.cancellation_window_minutes);
  // Past the venue's own window there is still the short grace period after booking.
  const freeCancellation = Date.parse(deadline) <= Date.parse(now)
    ? (quote.data?.manual ? 'do 10 minut od potvrzení' : 'do 10 minut od rezervace')
    : untilLabel(deadline, now);
  const pay = () => {
    setFailure(null);
    if (needsPhone) void form.handleSubmit((values) => book.mutate(values))();
    else book.mutate(null);
  };

  /*
   * A ticket rather than a form. The sheet used to be a table of "Co / Kde / Kdy" with the values
   * pushed to the right edge, a grey box of payment prose and two notices of equal weight, so the
   * one thing that matters (when, what, for how much) read no louder than the small print. Now the
   * FLEK is a stub like "Tvůj FLEK" in the profile: time and service on the night top, the money
   * under the tear, and what happens next as three short steps.
   */
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Potvrzení rezervace"
      tone="surface"
      footer={
        <>
          {/* In the footer, not at the end of the scrolling body, where a phone kept it out of sight. */}
          {failure ? (
            <div className="mb-3">
              <Banner tone="warning">{failure}</Banner>
            </div>
          ) : null}
          {/* The amount on the button's far edge, as checkouts put it: the label is what happens, the sum is what it costs. */}
          <Button variant="brand" size="lg" className="w-full" loading={book.isPending} onClick={pay}>
            {/* Below 360 px the padlock would push the label onto two lines. */}
            {book.isPending ? null : <Lock size={18} aria-hidden="true" className="shrink-0 max-[359px]:hidden" />}
            <span className="whitespace-nowrap">Pokračovat k platbě</span>{' '}
            <span className="tnum ml-auto pl-3">{money(offer.deal_price_cents)}</span>
          </Button>
          <p className="mt-2 text-center text-xs text-muted">
            Termín ti na zaplacení podržíme {holdMinutes} {minutesWord(holdMinutes)}.
          </p>
        </>
      }
    >
      <FlekTicket offer={offer} now={now} />

      {needsPhone ? (
        <form className="mt-4 flex flex-col gap-3 rounded-3xl bg-card p-4 shadow-card" noValidate onSubmit={(event) => { event.preventDefault(); pay(); }}>
          <div>
            <h3 className="text-base font-bold text-ink">Kontakt pro podnik</h3>
            <p className="mt-0.5 text-sm text-muted">Podnik tě potřebuje umět kontaktovat. Zadej prosím telefon.</p>
          </div>
          {/* The name is already on the profile from signup; asking for it again here was
              three fields for one missing value. Only show it when it is genuinely blank. */}
          {needsName ? (
            <div className="grid grid-cols-2 gap-3">
              <Field id="booking-first" label="Jméno" error={form.formState.errors.first_name?.message}>
                <Input id="booking-first" autoComplete="given-name" data-autofocus {...form.register('first_name')} />
              </Field>
              <Field id="booking-last" label="Příjmení (nepovinné)" error={form.formState.errors.last_name?.message}>
                <Input id="booking-last" autoComplete="family-name" {...form.register('last_name')} />
              </Field>
            </div>
          ) : null}
          <Field id="booking-phone" label="Telefon" error={form.formState.errors.phone?.message}>
            <Input
              id="booking-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              data-autofocus={needsName ? undefined : true}
              {...form.register('phone')}
            />
          </Field>
        </form>
      ) : null}

      {/* What happens after the button. Until the quote says whether this venue confirms each
          booking, a placeholder of the same height: the manual and the instant flow promise
          different things and neither should flash up and be replaced. */}
      <ul aria-label="Jak to proběhne" className="mt-4 flex flex-col gap-4 rounded-3xl bg-card p-4 shadow-card">
        <Step icon={ShieldCheck} tone="positive" title={`Zrušení zdarma ${freeCancellation}`} text="Když zrušíš včas, vrátíme ti celou částku." />
        {quote.isPending ? (
          <li aria-hidden="true" className="flex flex-col gap-2 py-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </li>
        ) : quote.data?.manual ? (
          <>
            <Step icon={Lock} title={`Teď jen zablokujeme ${money(offer.deal_price_cents)}`} text="Na kartě, Apple Pay nebo Google Pay přes zabezpečenou stránku Stripe." />
            <Step
              icon={BellRing}
              title={windowMinutes ? `Podnik má na potvrzení až ${windowMinutes} ${minutesWord(windowMinutes)}` : 'Podnik má na potvrzení pár minut'}
              text="Pak platbu strhneme a ukážeme ti kód. Když nepotvrdí, blokaci uvolníme a nic nezaplatíš."
            />
          </>
        ) : (
          <>
            <Step icon={Lock} title="Zaplatíš na zabezpečené stránce Stripe" text="Kartou, Apple Pay nebo Google Pay." />
            {/* Without the quote it is unknown whether the venue confirms first, so no promise of an instant code. */}
            {quote.data ? <Step icon={Ticket} title="Hned dostaneš rezervační kód" text="V podniku ukážeš kód nebo necháš načíst QR." /> : null}
          </>
        )}
      </ul>

      <div className="mt-4 flex flex-col gap-3 px-1">
        <ProviderLine businessId={offer.business_id} />
        {termsVersion ? (
          <p className="text-sm leading-relaxed text-muted">
            Pokračováním k platbě souhlasíš s{' '}
            <a href="/podminky" target="_blank" rel="noopener" className="font-bold text-ink underline underline-offset-4">obchodními podmínkami</a>{' '}
            a bereš na vědomí{' '}
            <a href="/soukromi" target="_blank" rel="noopener" className="font-bold text-ink underline underline-offset-4">zásady ochrany osobních údajů</a>.
            Žádáš, aby služba proběhla v rezervovaném termínu, i když je to do 14 dnů, a bereš na vědomí, že po jejím poskytnutí
            právo odstoupit zaniká. Zrušit zdarma můžeš podle podmínek.
          </p>
        ) : null}
        {mode.data?.test ? (
          <div className="flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning-soft/60 px-3.5 py-3 text-sm text-ink">
            <span className="mt-px shrink-0 rounded-md bg-warning px-1.5 py-0.5 text-[11px] leading-4 font-extrabold tracking-wide text-card uppercase">Test</span>
            <p className="tnum leading-relaxed">
              Použij kartu <span className="font-bold whitespace-nowrap">4242 4242 4242 4242</span>, libovolné budoucí datum a CVC. Žádné
              peníze se nestrhnou.
            </p>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/** The trade on the ticket, in the lucide shapes the map pins draw (`categoryGlyphs.ts`). */
const TRADE_ICONS: Record<string, LucideIcon> = { vlasy: Scissors, masaze: Hand, krasa: Sparkles, sport: Dumbbell, joga: Flower2, wellness: Waves };

/** The FLEK being booked, as a stub: when and what on the night top, the money under the tear. */
function FlekTicket({ offer, now }: { offer: OfferDetail; now: string }) {
  const Trade = TRADE_ICONS[offer.category_slug];
  const saved = savings(offer.original_price_cents, offer.deal_price_cents);
  const itemised = offer.service_fee_cents > 0;
  return (
    <section aria-label="Tvůj FLEK" className="overflow-hidden rounded-3xl bg-card shadow-card">
      <div className="relative bg-ink px-5 pt-4 pb-5 text-card">
        <PinMark tone="dark" className="pointer-events-none absolute top-3.5 right-4 h-7 w-8" />
        <p className="tnum text-xs font-bold tracking-[0.06em] text-brand-on-dark uppercase">Tvůj FLEK · {duration(offer.start_at, offer.end_at)} min</p>
        <p className="tnum mt-2 text-[1.625rem] leading-tight font-extrabold tracking-tight">
          <span className="text-brand-on-dark">{dayLabel(offer.start_at, now)}</span> {clockTime(offer.start_at)}–{clockTime(offer.end_at)}
        </p>
        <div className="mt-4 flex items-start gap-3">
          <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-brand-ink">
            {Trade ? <Trade size={22} strokeWidth={2} /> : <PinMark tone="dark" className="h-7 w-8" />}
          </span>
          <div className="min-w-0">
            <p className="text-base leading-snug font-bold [overflow-wrap:anywhere]">{offer.service_name}</p>
            <p className="mt-0.5 text-sm text-card/80 [overflow-wrap:anywhere]">{offer.business_name}</p>
            <p className="text-sm text-card/65 [overflow-wrap:anywhere]">{offer.address_line}, {offer.district || offer.city}</p>
          </div>
        </div>
      </div>
      {/* The perforation: a dashed tear line with a bite out of each edge in the sheet's colour. */}
      <div aria-hidden="true" className="relative border-t-2 border-dashed border-line">
        <span className="absolute -top-[11px] -left-2.5 size-5 rounded-full bg-surface" />
        <span className="absolute -top-[11px] -right-2.5 size-5 rounded-full bg-surface" />
      </div>
      {/*
        The same number the customer has seen on every screen since the feed — deal_price_cents
        is the all-in price. The split is disclosure, not a surprise: nothing is added here that
        was not already in the price on the card.
      */}
      <dl className="tnum px-5 pt-3 pb-4 text-sm">
        {itemised ? (
          <>
            <div className="flex items-baseline justify-between gap-4 py-1">
              <dt className="text-muted">Cena služby</dt>
              <dd className="text-ink">{money(offer.merchant_price_cents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-1">
              <dt className="text-muted">Servisní poplatek FLEK</dt>
              <dd className="text-ink">{money(offer.service_fee_cents)}</dd>
            </div>
          </>
        ) : null}
        <div className={cx('flex items-baseline justify-between gap-4', itemised && 'mt-2 border-t border-line pt-3')}>
          <dt className="text-base font-bold text-ink">Celkem</dt>
          <dd className="text-xl font-extrabold text-ink">{money(offer.deal_price_cents)}</dd>
        </div>
        {saved > 0 ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <dt className="sr-only">Úspora</dt>
            <dd className="inline-flex items-center rounded-full bg-brand-soft px-2.5 py-1 text-sm font-bold text-accent">Ušetříš {money(saved)}</dd>
            <dd className="text-sm text-muted">běžně <OriginalPrice cents={offer.original_price_cents} /></dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function Step({ icon: Icon, title, text, tone = 'brand' }: { icon: LucideIcon; title: string; text: string; tone?: 'brand' | 'positive' }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className={cx('grid size-10 shrink-0 place-items-center rounded-full', tone === 'positive' ? 'bg-positive/10 text-positive' : 'bg-brand-soft text-accent')}>
        <Icon size={19} />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="tnum text-sm font-bold text-ink">{title}</p>
        <p className="mt-0.5 text-sm leading-snug text-muted">{text}</p>
      </div>
    </li>
  );
}

function minutesWord(n: number): string {
  return n === 1 ? 'minutu' : n >= 2 && n <= 4 ? 'minuty' : 'minut';
}

/**
 * Mirrors `customer_booking_details.cancellation_deadline`; the database still decides.
 * The window is per venue, so it has to be passed in rather than assumed to be an hour.
 */
export function cancellationDeadline(startAt: string, windowMinutes: number): string {
  return new Date(Date.parse(startAt) - windowMinutes * 60_000).toISOString();
}
