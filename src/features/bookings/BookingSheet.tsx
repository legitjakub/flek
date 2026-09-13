import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { confirmDemoPayment, createBooking, releaseUnbookedPayment, saveProfile, startPayment } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { profileSchema } from '../../lib/schemas';
import { clockTime, dayLabel } from '../../lib/time';
import { track } from '../../lib/analytics';
import { Banner, Button, Field, Input, Sheet } from '../../components/ui';
import { hasPhone, useSession } from '../auth/session';
import { useRouter } from '../../app/router';
import type { OfferDetail } from '../../types/database';

type ProfileValues = z.infer<typeof profileSchema>;

/** The booking failed after the money had moved — and the money has already gone back. */
class PaymentReturned extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : 'BOOKING_FAILED');
  }
}

/**
 * Confirmation sheet. Phone capture happens here — in flow, not at signup — because the
 * merchant needs a way to reach the customer and it visibly raises commitment.
 */
export function BookingSheet({
  offer,
  now,
  open,
  onClose,
  onBooked,
}: {
  offer: OfferDetail;
  now: string;
  open: boolean;
  onClose: () => void;
  onBooked: (code: string, bookingId: string) => void;
}) {
  const { profile, userId } = useSession();
  const { navigate, search } = useRouter();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
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
      // Money first, seat second: the booking RPC refuses anything but a settled payment,
      // and the amount it checks comes from the offer row rather than from here.
      const payment = await startPayment(offer.id);
      // A merchant may have edited the price after this sheet opened. Never settle
      // a higher (or different) amount without the customer reviewing it first.
      if (payment.amount_cents !== offer.deal_price_cents) {
        if (payment.status === 'paid') await releaseUnbookedPayment(payment.id);
        throw new Error('PRICE_CHANGED');
      }
      const settled = payment.status === 'paid' ? payment : await confirmDemoPayment(payment.id);
      try {
        return await createBooking(offer.id, settled.id);
      } catch (error) {
        /*
         * Paid, but no seat — the last one went to someone else, or the price moved. Give the
         * money back now rather than leave it "paid" with nothing behind it. If the server
         * says the payment already has a booking, the first answer was only lost on the way:
         * asking again returns that same booking, so the customer gets their code.
         */
        const released = await releaseUnbookedPayment(settled.id).catch(() => null);
        if (released?.status === 'paid') return await createBooking(offer.id, settled.id);
        if (released?.status === 'refunded') throw new PaymentReturned(error);
        throw error;
      }
    },
    onSuccess: async (booking) => {
      await queryClient.invalidateQueries();
      onBooked(booking.reservation_code, booking.booking_id);
    },
    onError: (error) => {
      const code = error instanceof Error ? error.message : 'UNKNOWN';
      track('booking_failed', { offer_id: offer.id, code: code.slice(0, 80) });
      setFailure(
        error instanceof PaymentReturned
          ? `${errorMessage(error.original)} Platbu jsme ti hned vrátili.`
          : errorMessage(error),
      );
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

  const savings = offer.original_price_cents - offer.deal_price_cents;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Potvrzení rezervace"
      footer={
        <Button
          size="lg"
          className="w-full"
          loading={book.isPending}
          onClick={() => {
            setFailure(null);
            if (needsPhone) void form.handleSubmit((values) => book.mutate(values))();
            else book.mutate(null);
          }}
        >
          {`Zaplatit ${money(offer.deal_price_cents)}`}
        </Button>
      }
    >
      <dl className="flex flex-col gap-2 text-sm">
        <Row label="Co" value={offer.service_name} />
        <Row label="Kde" value={`${offer.business_name}, ${offer.address_line}, ${offer.city}`} />
        <Row
          label="Kdy"
          value={`${dayLabel(offer.start_at, now)} ${clockTime(offer.start_at)}–${clockTime(offer.end_at)}`}
        />
        <Row label="Zrušení zdarma" value={Date.parse(cancellationDeadline(offer.start_at, offer.cancellation_window_minutes)) <= Date.parse(now) ? '10 minut od rezervace' : `do ${clockTime(cancellationDeadline(offer.start_at, offer.cancellation_window_minutes))}`} />
      </dl>

      {/*
        The same number the customer has seen on every screen since the feed — deal_price_cents
        is the all-in price. The split underneath is disclosure, not a surprise: nothing is
        added here that was not already in the price on the card.
      */}
      <div className="mt-4 rounded-xl bg-surface px-3 py-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-base font-bold text-ink">Celkem</span>
          <span className="tnum text-xl font-extrabold text-ink">{money(offer.deal_price_cents)}</span>
        </div>
        {offer.service_fee_cents > 0 ? (
          <p className="tnum mt-1 text-sm text-muted">
            Cena služby {money(offer.merchant_price_cents)} · Servisní poplatek FLEK {money(offer.service_fee_cents)}
          </p>
        ) : null}
        {savings > 0 ? (
          <p className="tnum mt-1 text-sm text-muted">
            Běžně {money(offer.original_price_cents)} · <span className="font-bold text-ink">ušetříš {money(savings)}</span>
          </p>
        ) : null}
      </div>
      {Date.parse(cancellationDeadline(offer.start_at, offer.cancellation_window_minutes)) <= Date.parse(now) ? (
        <p className="mt-2 text-sm text-muted">
          Termín je blízko, takže na bezplatné zrušení máš 10 minut od rezervace.
        </p>
      ) : null}

      {needsPhone ? (
        <form className="mt-5 flex flex-col gap-3" noValidate>
          <p className="text-sm text-muted">Podnik tě potřebuje umět kontaktovat. Zadej prosím telefon.</p>
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

      <p className="mt-5 rounded-xl bg-surface px-3 py-2 text-sm text-muted">
        Platíš rovnou přes FLEK a v podniku už jen ukážeš kód. Když zrušíš včas, vrátíme ti
        celou částku.
      </p>
      <p className="mt-2 rounded-xl border border-warning/30 bg-warning/8 px-3 py-2 text-sm text-ink">
        <strong>Ukázkový režim.</strong> Platební brána zatím není napojená — žádné peníze se
        nestrhnou.
      </p>

      {failure ? (
        <div className="mt-3">
          <Banner tone="warning">{failure}</Banner>
        </div>
      ) : null}
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line pb-2 last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="tnum text-right font-bold text-ink">{value}</dd>
    </div>
  );
}

/**
 * Mirrors `customer_booking_details.cancellation_deadline`; the database still decides.
 * The window is per venue, so it has to be passed in rather than assumed to be an hour.
 */
export function cancellationDeadline(startAt: string, windowMinutes: number): string {
  return new Date(Date.parse(startAt) - windowMinutes * 60_000).toISOString();
}
