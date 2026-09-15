import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { respondToBooking } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, cx } from '../../components/ui';
import { startsInLine, timeLeft } from '../bookings/confirmationView';
import type { ConfirmationDecision, MerchantBooking } from '../../types/database';

/** A request the merchant still has to answer, or has answered and whose payment is being finished. */
export function isConfirmationRequest(row: Pick<MerchantBooking, 'status'>): boolean {
  return row.status === 'pending_merchant' || row.status === 'capturing';
}

/**
 * A customer who never authorised a payment was only ever on Stripe's page: that request never
 * reached the merchant and is not theirs to see.
 */
export function visibleToMerchant(row: Pick<MerchantBooking, 'confirmation_version' | 'authorized_at' | 'status'>): boolean {
  return !(row.confirmation_version === 1 && !row.authorized_at) && row.status !== 'pending_payment';
}

/** What the merchant is told after pressing a button: the server's answer, not the button they pressed. */
export function decisionMessage(result: ConfirmationDecision, accepted: boolean): { tone: 'success' | 'warning'; text: string } {
  if (result.decided && result.status === 'capturing') {
    return { tone: 'success', text: 'Potvrzeno. Dokončujeme platbu zákazníka, rezervace se tu objeví za pár sekund.' };
  }
  if (result.decided && result.status === 'rejected') {
    return { tone: 'success', text: 'Rezervaci jste odmítli. Zákazník nic nezaplatí a místo se vrátilo do nabídky.' };
  }
  switch (result.status) {
    case 'expired':
      return { tone: 'warning', text: 'Na potvrzení už bylo pozdě. Žádost vypršela a místo se vrátilo do nabídky.' };
    case 'cancelled_by_customer':
      return { tone: 'warning', text: 'Zákazník žádost mezitím zrušil.' };
    case 'capturing':
    case 'confirmed':
      return { tone: accepted ? 'success' : 'warning', text: 'Rezervace už je potvrzená, nejspíš z jiného zařízení nebo z WhatsAppu.' };
    case 'rejected':
      return { tone: 'warning', text: 'Žádost už byla odmítnuta, nejspíš z jiného zařízení nebo z WhatsAppu.' };
    default:
      return { tone: 'warning', text: 'Žádost už mezitím skončila.' };
  }
}

export function ConfirmationRequests({ rows, title = 'Vyžadují potvrzení' }: { rows: MerchantBooking[]; title?: string }) {
  const requests = rows.filter(isConfirmationRequest)
    .sort((a, b) => Date.parse(a.confirmation_expires_at ?? a.start_at_snapshot) - Date.parse(b.confirmation_expires_at ?? b.start_at_snapshot));
  if (!requests.length) return null;
  // The count is what still needs an answer; a confirmed request only waits a few seconds for its payment.
  const waiting = requests.filter((row) => row.status === 'pending_merchant').length;
  return (
    <section aria-labelledby="k-potvrzeni" className="flex flex-col gap-3">
      <h2 id="k-potvrzeni" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-ink">
        <BellRing size={20} aria-hidden="true" className="text-brand" />
        {title}
        {waiting ? (
          <span className="tnum grid min-h-6 min-w-6 place-items-center rounded-full bg-brand px-1.5 text-sm font-extrabold text-brand-ink" aria-label={`${waiting} čeká`}>{waiting}</span>
        ) : null}
      </h2>
      <ul className="grid gap-3 xl:grid-cols-2">
        {requests.map((booking) => (
          <li key={booking.id}><ConfirmationRequestCard booking={booking} /></li>
        ))}
      </ul>
    </section>
  );
}

function ConfirmationRequestCard({ booking }: { booking: MerchantBooking }) {
  const now = useServerNow(1_000);
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const decision = useMutation({
    mutationFn: (accept: boolean) => respondToBooking(booking.id, accept),
    onSuccess: (result, accept) => setFeedback(decisionMessage(result, accept)),
    onError: (error) => setFeedback({ tone: 'warning', text: errorMessage(error, 'merchant') }),
    onSettled: () => {
      for (const key of ['merchant-bookings', 'merchant-offers', 'merchant-metrics', 'booking-alert-poll']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  const left = timeLeft(booking.confirmation_expires_at, now);
  const starts = startsInLine(booking.start_at_snapshot, now);
  const capturing = booking.status === 'capturing';
  const overdue = !capturing && left !== null && left.seconds === 0;
  // Once the server answered, the buttons have done their job; the list catches up on its next read.
  const answered = decision.data !== undefined;

  return (
    <article className={cx('rounded-2xl bg-card p-4 shadow-card ring-2 sm:p-5', capturing ? 'ring-positive/40' : 'ring-brand')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-extrabold text-ink">{capturing ? 'Potvrzená rezervace' : 'Nová rezervace'}</p>
        <p className={cx('tnum text-sm font-bold', starts.urgent ? 'text-warning' : 'text-muted')}>{starts.text}</p>
      </div>
      <p className="tnum mt-2 text-lg leading-snug font-extrabold text-ink">
        {dayLabel(booking.start_at_snapshot, now)} {clockTime(booking.start_at_snapshot)}
      </p>
      <p className="text-base font-bold text-ink">
        {booking.service_name_snapshot} <span className="font-normal text-muted">{duration(booking.start_at_snapshot, booking.end_at_snapshot)} min</span>
      </p>
      <dl className="mt-2 grid gap-1 text-sm">
        <div className="flex gap-2"><dt className="text-muted">Zákazník:</dt><dd className="font-bold text-ink">{booking.customer_label}</dd></div>
        <div className="flex gap-2"><dt className="text-muted">Vy dostanete:</dt><dd className="tnum font-bold text-ink">{money(booking.merchant_payout_cents)}</dd></div>
      </dl>
      <p className="mt-2 text-sm text-muted">
        {capturing ? 'Dokončujeme platbu zákazníka. Rezervační kód uvidíte za pár sekund.' : 'Zákazník má platbu autorizovanou. Peníze strhneme, až rezervaci potvrdíte.'}
      </p>

      {!capturing ? (
        <>
          <p className={cx('tnum mt-3 text-xl font-extrabold', overdue ? 'text-muted' : 'text-ink')} role="timer" aria-live="off">
            {overdue ? 'Čas na potvrzení vypršel' : `Potvrďte do ${left?.clock ?? '–'}`}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button size="lg" loading={decision.isPending && decision.variables === true} disabled={decision.isPending || overdue || answered} onClick={() => decision.mutate(true)}>
              Potvrdit
            </Button>
            <Button size="lg" variant="secondary" loading={decision.isPending && decision.variables === false} disabled={decision.isPending || overdue || answered} onClick={() => decision.mutate(false)}>
              Nemohu přijmout
            </Button>
          </div>
        </>
      ) : null}
      {feedback ? <div className="mt-3"><Banner tone={feedback.tone}>{feedback.text}</Banner></div> : null}
    </article>
  );
}
