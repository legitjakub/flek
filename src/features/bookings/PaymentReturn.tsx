import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, RotateCcw } from 'lucide-react';
import { paymentState } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { Button, ErrorState, Spinner, buttonClass } from '../../components/ui';
import { Link } from '../../app/router';

const GIVE_UP_AFTER_MS = 90_000;

/**
 * The customer is back from Stripe Checkout. The booking is made by Stripe's webhook, a few
 * seconds after the payment, so this waits for it instead of guessing: the reservation code, a
 * refund when the seat went meanwhile, or a payment that was never finished.
 */
export function PaymentReturn({
  paymentId,
  cancelled,
  onBooked,
  onRetry,
}: {
  paymentId: string;
  cancelled: boolean;
  onBooked: (code: string) => void;
  onRetry: () => void;
}) {
  const queryClient = useQueryClient();
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setExpired(true), GIVE_UP_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const state = useQuery({
    queryKey: ['payment-state', paymentId],
    queryFn: () => paymentState(paymentId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.reservation_code || data.refund_requested || data.status === 'refunded' || data.status === 'failed') {
        return data ? false : 1500;
      }
      if (cancelled && data.status === 'pending') return false;
      return expired ? false : 1500;
    },
  });
  const data = state.data;

  useEffect(() => {
    if (!data?.reservation_code) return;
    void queryClient.invalidateQueries();
    onBooked(data.reservation_code);
  }, [data?.reservation_code]);

  if (state.isError) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <ErrorState error={state.error} onRetry={() => state.refetch()} />
      </main>
    );
  }

  const notFinished = data && !data.reservation_code && (data.status === 'failed' || (cancelled && data.status === 'pending'));
  const refunding = data && !data.reservation_code && (data.refund_requested || data.status === 'refunded');
  const stillWaiting = !data || (!data.reservation_code && !notFinished && !refunding);
  const gaveUp = stillWaiting && expired;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-12 text-center" aria-live="polite">
      {refunding ? (
        <>
          <span className="grid size-14 place-items-center rounded-full bg-warning-soft text-warning"><RotateCcw size={26} aria-hidden="true" /></span>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">Rezervaci se nepodařilo dokončit</h1>
          <p className="mt-2 text-base leading-relaxed text-muted">
            {data?.failure_reason && data.failure_reason !== 'NO_BOOKING' ? `${errorMessage(new Error(data.failure_reason))} ` : ''}
            {data?.refund_status === 'failed' || data?.refund_status === 'canceled'
              ? `Platbu ${money(data.amount_cents)} se na kartu vrátit nepodařilo. Peníze nepropadly, vrácení vyřešíme s tebou ručně.`
              : `Platbu ${data ? money(data.amount_cents) : ''} ti proto celou vracíme na kartu. Na výpisu se obvykle objeví do 5–10 pracovních dnů.`}
          </p>
          <Link to="/" className={buttonClass({ shape: 'pill' }) + ' mt-6'}>Najít jiný FLEK</Link>
        </>
      ) : notFinished ? (
        <>
          <span className="grid size-14 place-items-center rounded-full bg-surface text-ink"><CircleAlert size={26} aria-hidden="true" /></span>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">Platba nebyla dokončena</h1>
          <p className="mt-2 text-base leading-relaxed text-muted">Nic jsme nestrhli. Termín ti nedržíme, tak ho zkus zarezervovat znovu, dokud je volný.</p>
          <div className="mt-6 grid w-full grid-cols-2 gap-2">
            <Button shape="pill" onClick={onRetry}>Zkusit znovu</Button>
            <Link to="/" className={buttonClass({ variant: 'soft', shape: 'pill' })}>Jiné FLEKy</Link>
          </div>
        </>
      ) : gaveUp ? (
        <>
          <span className="grid size-14 place-items-center rounded-full bg-surface text-ink"><CircleAlert size={26} aria-hidden="true" /></span>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">Platbu ještě ověřujeme</h1>
          <p className="mt-2 text-base leading-relaxed text-muted">
            Jakmile ji Stripe potvrdí, rezervaci s kódem najdeš v Rezervacích. Když se nepotvrdí, nic ti nestrhneme.
          </p>
          <Link to="/rezervace" className={buttonClass({ shape: 'pill' }) + ' mt-6'}>Moje rezervace</Link>
        </>
      ) : (
        <>
          <span className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent"><Spinner label="Ověřujeme platbu" /></span>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">Ověřujeme platbu</h1>
          <p className="mt-2 text-base leading-relaxed text-muted">Obvykle to trvá pár sekund. Hned potom uvidíš rezervační kód.</p>
        </>
      )}
    </main>
  );
}
