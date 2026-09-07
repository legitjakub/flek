import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { createBooking, saveProfile } from '../../lib/api';
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
  const { navigate } = useRouter();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const needsPhone = !hasPhone(profile);

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
      return createBooking(offer.id);
    },
    onSuccess: async (booking) => {
      await queryClient.invalidateQueries();
      onBooked(booking.reservation_code, booking.booking_id);
    },
    onError: (error) => {
      const code = error instanceof Error ? error.message : 'UNKNOWN';
      track('booking_failed', { offer_id: offer.id, code: code.slice(0, 80) });
      setFailure(errorMessage(error));
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
          onClick={() => navigate(`/prihlaseni?returnTo=${encodeURIComponent(`/nabidka/${offer.id}?rezervovat=1`)}`)}
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
          Potvrdit rezervaci
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
        <Row label="Cena na místě" value={money(offer.deal_price_cents)} />
        <Row label="Ušetříš" value={money(savings)} />
        <Row label="Zrušit můžeš zdarma do" value={clockTime(cancellationDeadline(offer.start_at))} />
      </dl>

      {needsPhone ? (
        <form className="mt-5 flex flex-col gap-3" noValidate>
          <p className="text-sm text-muted">Podnik tě potřebuje umět kontaktovat. Zadej prosím telefon.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field id="booking-first" label="Jméno" error={form.formState.errors.first_name?.message}>
              <Input id="booking-first" autoComplete="given-name" data-autofocus {...form.register('first_name')} />
            </Field>
            <Field id="booking-last" label="Příjmení" error={form.formState.errors.last_name?.message}>
              <Input id="booking-last" autoComplete="family-name" {...form.register('last_name')} />
            </Field>
          </div>
          <Field id="booking-phone" label="Telefon" error={form.formState.errors.phone?.message}>
            <Input id="booking-phone" type="tel" inputMode="tel" autoComplete="tel" {...form.register('phone')} />
          </Field>
        </form>
      ) : null}

      <p className="mt-5 rounded-xl bg-surface px-3 py-2 text-sm text-muted">
        Podnik ti termín drží. Když nemůžeš dorazit, zruš to prosím včas.
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
      <dd className="tnum text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

/** Mirrors `customer_booking_details.cancellation_deadline`; the database still decides. */
export function cancellationDeadline(startAt: string): string {
  return new Date(Date.parse(startAt) - 60 * 60_000).toISOString();
}
