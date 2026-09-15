import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Clock3, RotateCcw } from 'lucide-react';
import { cancelPendingBooking, paymentState } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, ErrorState, Spinner, buttonClass } from '../../components/ui';
import { Link } from '../../app/router';
import { confirmationView, waitingLine } from './confirmationView';
import { WhatsAppPrompt } from '../notifications/WhatsApp';

/** Past this, a request that neither the merchant nor Stripe has moved is left to the bookings page. */
const GIVE_UP_AFTER_MS = 12 * 60_000;

/**
 * The customer is back from Stripe Checkout. Everything after that happens on the server — Stripe's
 * webhook, the merchant's answer, the capture — so this page only watches: the amount held while the
 * merchant decides, then the reservation code, or why there is none. Closing the tab changes nothing.
 */
export function PaymentReturn({
  paymentId,
  cancelled,
  onBooked,
  onRetry,
}: {
  paymentId: string;
  cancelled: boolean;
  onBooked: (code: string, confirmedByMerchant: boolean) => void;
  onRetry: () => void;
}) {
  const queryClient = useQueryClient();
  const now = useServerNow(1_000);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setGaveUp(true), GIVE_UP_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const state = useQuery({
    queryKey: ['payment-state', paymentId],
    queryFn: () => paymentState(paymentId),
    refetchInterval: (query) => (confirmationView(query.state.data, cancelled).live && !gaveUp ? 2_000 : false),
  });
  const data = state.data;
  const view = confirmationView(data, cancelled);

  // Back from Stripe without paying: give the held seat back straight away instead of after the hold runs out.
  useEffect(() => {
    if (!cancelled || !data?.booking_id || data.booking_status !== 'pending_payment') return;
    void cancelPendingBooking(data.booking_id).finally(() => void state.refetch());
  }, [cancelled, data?.booking_id, data?.booking_status]);

  useEffect(() => {
    if (!data?.reservation_code) return;
    void queryClient.invalidateQueries();
    onBooked(data.reservation_code, data.confirmation_version === 1);
  }, [data?.reservation_code]);

  const withdraw = useMutation({
    mutationFn: () => cancelPendingBooking(data!.booking_id!),
    onSettled: () => {
      void state.refetch();
      void queryClient.invalidateQueries({ queryKey: ['discovery'] });
    },
  });

  if (state.isError) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <ErrorState error={state.error} onRetry={() => state.refetch()} />
      </main>
    );
  }

  if (view.live && gaveUp) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-12 text-center" aria-live="polite">
        <span className="grid size-14 place-items-center rounded-full bg-surface text-ink"><CircleAlert size={26} aria-hidden="true" /></span>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">Pořád na tom pracujeme</h1>
        <p className="mt-2 text-base leading-relaxed text-muted">
          Jak to dopadlo, uvidíš v Rezervacích. Dokud rezervace není potvrzená, nic ti nestrhneme.
        </p>
        <Link to="/rezervace" className={buttonClass({ shape: 'pill' }) + ' mt-6'}>Moje rezervace</Link>
      </main>
    );
  }

  const line = view.kind === 'waiting' && data ? waitingLine(data, now) : null;
  const icon = view.kind === 'refunding' ? <RotateCcw size={26} aria-hidden="true" />
    : view.kind === 'waiting' ? <Clock3 size={26} aria-hidden="true" />
      : view.live ? <Spinner label={view.title} /> : <CircleAlert size={26} aria-hidden="true" />;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-12 text-center" aria-live="polite">
      <span className={`grid size-14 place-items-center rounded-full ${view.live ? 'bg-accent-soft text-accent' : 'bg-surface text-ink'}`}>{icon}</span>
      <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">{view.title}</h1>
      <p className="mt-2 text-base leading-relaxed text-muted">{view.body}</p>
      {line ? <p className="tnum mt-3 text-base font-bold text-ink" role="timer">{line}</p> : null}
      {view.kind === 'waiting' && data ? (
        <p className="tnum mt-1 text-sm text-muted">Zablokováno {money(data.amount_cents)}</p>
      ) : null}
      {view.kind === 'refunding' && (data?.refund_status === 'failed' || data?.refund_status === 'canceled') ? (
        <div className="mt-3 w-full text-left">
          <Banner tone="warning">Platbu se na kartu vrátit nepodařilo. Peníze nepropadly, vrácení vyřešíme s tebou ručně.</Banner>
        </div>
      ) : null}
      {withdraw.isError ? (
        <div className="mt-3 w-full text-left"><Banner tone="warning">{errorMessage(withdraw.error)}</Banner></div>
      ) : null}

      {view.action === 'cancel_request' ? (
        <Button variant="secondary" shape="pill" className="mt-6" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
          Zrušit žádost
        </Button>
      ) : view.action === 'retry' ? (
        <div className="mt-6 grid w-full grid-cols-2 gap-2">
          <Button shape="pill" onClick={onRetry}>Zkusit znovu</Button>
          <Link to="/" className={buttonClass({ variant: 'soft', shape: 'pill' })}>Jiné FLEKy</Link>
        </div>
      ) : view.action === 'find_other' ? (
        <Link to="/" className={buttonClass({ shape: 'pill' }) + ' mt-6'}>Najít jiný FLEK</Link>
      ) : null}
      {view.kind === 'waiting' ? <div className="mt-8 w-full"><WhatsAppPrompt context="waiting" /></div> : null}
    </main>
  );
}
