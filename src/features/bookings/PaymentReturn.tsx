import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Clock3, RotateCcw } from 'lucide-react';
import { cancelPendingBooking, paymentState } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, ErrorState, Sheet, Spinner, buttonClass } from '../../components/ui';
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
  alternatives,
}: {
  paymentId: string;
  cancelled: boolean;
  onBooked: (code: string, confirmedByMerchant: boolean) => void;
  onRetry: () => void;
  /** Other FLEKy to offer when this one did not work out, so the next step is one tap away. */
  alternatives?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const now = useServerNow(1_000);
  const [gaveUp, setGaveUp] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
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
    if (view.kind !== 'confirmed' || !data?.reservation_code) return;
    void queryClient.invalidateQueries();
    onBooked(data.reservation_code, data.confirmation_version === 1);
  }, [data?.reservation_code, view.kind]);

  const withdraw = useMutation({
    mutationFn: () => cancelPendingBooking(data!.booking_id!),
    onSuccess: () => setConfirmingWithdraw(false),
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

  if (view.live && gaveUp && view.kind !== 'refunding') {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-12 text-center" aria-live="polite">
        <span className="grid size-14 place-items-center rounded-full bg-surface text-ink"><CircleAlert size={26} aria-hidden="true" /></span>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">Pořád na tom pracujeme</h1>
        <p className="mt-2 text-base leading-relaxed text-muted">
          Stav platby ještě ověřujeme. Výsledek najdeš v Rezervacích; platbu zatím neopakuj.
        </p>
        <Link to="/rezervace" className={buttonClass({ shape: 'pill' }) + ' mt-6'}>Moje rezervace</Link>
      </main>
    );
  }

  const line = view.kind === 'waiting' && data ? waitingLine(data, now) : null;
  const icon = view.kind === 'refunding' || view.kind === 'refunded' ? <RotateCcw size={26} aria-hidden="true" />
    : view.kind === 'waiting' ? <Clock3 size={26} aria-hidden="true" />
      : view.live ? <Spinner label={view.title} /> : <CircleAlert size={26} aria-hidden="true" />;

  return (
    <main className="w-full px-4 py-12">
      <div className="mx-auto flex w-full max-w-md flex-col items-center text-center" aria-live="polite">
        <span className={`grid size-14 place-items-center rounded-full ${view.live ? 'bg-accent-soft text-accent' : 'bg-surface text-ink'}`}>{icon}</span>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">{view.title}</h1>
        <p className="mt-2 text-base leading-relaxed text-muted">{view.body}</p>
        {line ? <p className="tnum mt-3 text-base font-bold text-ink" role="timer">{line}</p> : null}
        {view.kind === 'waiting' && data ? (
          <p className="tnum mt-1 text-sm text-muted">Zablokováno {money(data.amount_cents)}</p>
        ) : null}
        {data && (view.kind === 'refunded' || (view.kind === 'refunding' && data.refund_status !== 'failed' && data.refund_status !== 'canceled')) ? (
          <p className="tnum mt-2 font-bold text-ink">{view.kind === 'refunded' ? `${money(data.amount_cents)} vráceno` : `Vracíme ${money(data.amount_cents)}`}</p>
        ) : null}
        {/* What the customer should do now: nothing. The answer reaches them even with the page closed. */}
        {view.kind === 'waiting' ? (
          <p className="mt-4 text-sm leading-relaxed text-muted">Stránku můžeš zavřít. Jak podnik odpoví, pošleme ti e‑mail.</p>
        ) : null}

        {view.action === 'cancel_request' ? (
          <Button variant="secondary" shape="pill" className="mt-6" onClick={() => { withdraw.reset(); setConfirmingWithdraw(true); }}>
            Zrušit žádost
          </Button>
        ) : view.action === 'retry' ? (
          <div className="mt-6 grid w-full grid-cols-2 gap-2">
            <Button shape="pill" onClick={onRetry}>Zkusit znovu</Button>
            <Link to="/" className={buttonClass({ variant: 'soft', shape: 'pill' })}>Jiné FLEKy</Link>
          </div>
        ) : view.action === 'find_other' ? (
          <Link to="/" className={buttonClass({ shape: 'pill' }) + ' mt-6'}>Najít jiný FLEK</Link>
        ) : view.action === 'bookings' ? (
          <Link to="/rezervace" className={buttonClass({ shape: 'pill' }) + ' mt-6'}>Moje rezervace</Link>
        ) : null}
        {view.kind === 'waiting' ? <div className="mt-8 w-full"><WhatsAppPrompt context="waiting" /></div> : null}
      </div>

      {alternatives && view.action === 'find_other' ? <div className="mx-auto mt-10 w-full max-w-[1200px] md:px-4">{alternatives}</div> : null}

      <Sheet
        // Closes by itself when the venue answers meanwhile: there is nothing left to withdraw.
        open={confirmingWithdraw && view.action === 'cancel_request'}
        onClose={() => setConfirmingWithdraw(false)}
        title="Zrušit žádost?"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmingWithdraw(false)}>Nechat</Button>
            <Button variant="danger" className="flex-1" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>Zrušit žádost</Button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-ink">Podnik tvou žádost už neuvidí. Nic nestrhneme a blokaci částky na kartě uvolníme.</p>
        {/* In the sheet, not behind it: the sheet stays open when the call fails. */}
        {withdraw.isError ? <div className="mt-3"><Banner tone="warning">{errorMessage(withdraw.error)}</Banner></div> : null}
      </Sheet>
    </main>
  );
}
