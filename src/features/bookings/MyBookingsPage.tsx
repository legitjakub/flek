import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Phone, QrCode, Ticket, X } from 'lucide-react';
import { cancelBooking, cancelPendingBooking, myBookings } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { clockTime, dayLabel } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, LoadingList, Sheet, Tabs, buttonClass, cx } from '../../components/ui';
import { Link } from '../../app/router';
import { useSession } from '../auth/session';
import { Voucher } from './Voucher';
import { StatusBadge } from '../../components/StatusBadge';
import type { CustomerBooking } from '../../types/database';
import { confirmationView, waitingLine } from './confirmationView';

export function MyBookingsPage() {
  const { userId } = useSession();
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  const now = useServerNow(1_000);
  const queryClient = useQueryClient();
  const [toCancel, setToCancel] = useState<CustomerBooking | null>(null);
  const [voucherFor, setVoucherFor] = useState<CustomerBooking | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['my-bookings', userId],
    queryFn: myBookings,
    enabled: Boolean(userId),
    refetchOnWindowFocus: true,
    refetchInterval: (current) => current.state.data?.some((row) => row.status === 'pending_payment' || row.status === 'pending_merchant' || row.status === 'capturing') ? 3_000 : false,
  });

  const cancel = useMutation({
    mutationFn: (booking: CustomerBooking) => ['pending_payment', 'pending_merchant'].includes(booking.status)
      ? cancelPendingBooking(booking.id).then(() => undefined)
      : cancelBooking(booking.id),
    onSuccess: async () => {
      setToCancel(null);
      setFailure(null);
      await queryClient.invalidateQueries();
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  if (!userId) {
    return (
      <main className="page-container py-6 sm:py-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Moje rezervace</h1>
        <div className="mt-5">
          <EmptyState
            tone="promo"
            icon={<Ticket size={26} />}
            title="Rezervace uvidíš po přihlášení."
            body="Prohlížet nabídky můžeš i bez účtu."
            action={
              <Link to="/prihlaseni?returnTo=%2Frezervace" className={buttonClass({ size: 'lg', shape: 'pill' })}>
                Přihlásit se
              </Link>
            }
          />
        </div>
      </main>
    );
  }

  const all = query.data ?? [];
  // Requests still in motion lead the list: they are the ones with a clock running.
  const inMotion = (b: CustomerBooking) => b.status === 'pending_payment' || b.status === 'pending_merchant' || b.status === 'capturing';
  const upcoming = all
    .filter((b) => (inMotion(b) || b.status === 'confirmed') && Date.parse(b.start_at_snapshot) > Date.parse(now))
    .sort((a, b) => Number(inMotion(b)) - Number(inMotion(a)));
  const history = all.filter((b) => !upcoming.includes(b));
  const rows = tab === 'upcoming' ? upcoming : history;

  return (
    <main className="page-container max-w-3xl pt-6 pb-6 sm:pt-8">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Moje rezervace</h1>
      <div className="mt-4">
        <Tabs
          pill
          label="Rezervace"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'upcoming', label: `Nadcházející${upcoming.length ? ` (${upcoming.length})` : ''}` },
            { value: 'history', label: 'Historie' },
          ]}
        />
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {query.isPending ? <LoadingList /> : null}
        {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
        {query.isSuccess && rows.length === 0 ? (
          <EmptyState
            tone="promo"
            icon={<Ticket size={26} />}
            title={tab === 'upcoming' ? 'Nemáš žádnou nadcházející rezervaci.' : 'Historie je zatím prázdná.'}
            body="Najdi si volný FLEK na dnes."
            action={
              <Link to="/" className={buttonClass({ size: 'lg', shape: 'pill' })}>
                Objevit nabídky
              </Link>
            }
          />
        ) : null}

        {rows.map((booking) => {
          const today = dayLabel(booking.start_at_snapshot, now) === 'Dnes';
          const live = booking.status === 'confirmed';
          return (
            <article
              key={booking.id}
              className={cx('overflow-hidden rounded-3xl bg-card shadow-card', today && live && 'ring-2 ring-brand')}
            >
              {/* The code is what gets read out at the counter, so on a live booking it gets the
                  darkest block on the screen and the brightest colour in the palette. */}
              {live ? (
                <div className="flex items-baseline justify-between gap-3 bg-ink px-4 py-3 text-card">
                  <p className="text-xs font-bold text-card/75">Rezervační kód</p>
                  <p className="tnum font-mono text-xl font-extrabold tracking-[0.12em] text-brand-on-dark">
                    {booking.reservation_code}
                  </p>
                </div>
              ) : null}
              <div className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cx('tnum text-base font-bold text-ink', !live && 'mt-1')}>
                      {dayLabel(booking.start_at_snapshot, now)} {clockTime(booking.start_at_snapshot)}–
                      {clockTime(booking.end_at_snapshot)}
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <StatusBadge status={booking.status} />
                    {booking.payment_status === 'paid' && booking.status.startsWith('cancelled') ? (
                      // The refund is on its way but Stripe has not confirmed it yet.
                      <StatusBadge status="refunded" label="Vracíme peníze" />
                    ) : booking.payment_status ? (
                      <StatusBadge
                        status={booking.payment_status}
                        label={booking.authorization_state === 'authorized' ? 'Částka blokována'
                          : booking.authorization_state === 'release_pending' || booking.authorization_state === 'released' ? 'Blokace uvolněna'
                            : booking.payment_status === 'pending' ? 'Čeká na platbu' : undefined}
                      />
                    ) : null}
                  </span>
                </div>

                <p className="mt-3 flex items-baseline gap-3 text-base font-bold text-ink">
                  <span className="min-w-0 flex-1">{booking.service_name_snapshot}</span>
                  <span className="tnum shrink-0">{money(booking.price_cents)}</span>
                </p>
                <p className="text-sm text-muted">
                  {booking.business_name_snapshot} · {booking.business_address_snapshot}
                </p>
                {/* Only a kept appointment created value. A cancellation or a no-show that
                    counted towards "saved" would be a number the product cannot defend, so
                    savings appear on completed bookings alone — and always from the snapshot
                    taken at booking time, never from what the service costs today. */}
                {booking.status === 'completed' && booking.original_price_cents_snapshot > booking.price_cents ? (
                  <p className="tnum mt-1 text-sm font-bold text-positive">
                    Ušetřeno {money(booking.original_price_cents_snapshot - booking.price_cents)}
                  </p>
                ) : null}

                {booking.confirmation_version === 1 && !booking.confirmed_at ? (
                  <RequestState booking={booking} now={now} onCancel={() => setToCancel(booking)} />
                ) : booking.cancellation_reason ? (
                  <p className="mt-2 text-sm text-danger">Důvod: {booking.cancellation_reason}</p>
                ) : null}

                {booking.status === 'confirmed' ? (
                  <div className="mt-4">
                    {/*
                      The QR is the thing you actually hold up at the counter, and until now it
                      existed only on the confirmation screen — once that was dismissed there was
                      no way back to it and the reservation was six characters to read aloud.
                      It opens in a sheet rather than inline: the encoder is a lazy import and
                      rendering one per row would fetch it for every booking in the list.

                      One row of equal, short buttons. Three full-width pills stacked into two
                      rows took a third of the phone screen for three actions.
                    */}
                    <div className={cx('grid gap-2', booking.can_cancel ? 'grid-cols-3' : 'grid-cols-2')}>
                      <Button
                        shape="pill"
                        size="sm"
                        aria-label="Ukázat QR kód"
                        onClick={() => setVoucherFor(booking)}
                      >
                        <QrCode size={16} aria-hidden="true" className="shrink-0" />
                        QR kód
                      </Button>
                      <a
                        className={buttonClass({ variant: 'soft', shape: 'pill', size: 'sm' })}
                        aria-label="Zavolat podniku"
                        href={`tel:${booking.business_phone}`}
                      >
                        <Phone size={15} aria-hidden="true" className="shrink-0" />
                        Zavolat
                      </a>
                      {booking.can_cancel ? (
                        <Button
                          variant="danger"
                          shape="pill"
                          size="sm"
                          aria-label="Zrušit rezervaci"
                          onClick={() => setToCancel(booking)}
                        >
                          <X size={15} aria-hidden="true" className="shrink-0" />
                          Zrušit
                        </Button>
                      ) : null}
                    </div>
                    <p className="tnum mt-2 text-xs text-muted">
                      {booking.can_cancel
                        ? `Zrušit můžeš zdarma do ${clockTime(booking.cancellation_deadline)}`
                        : 'Rezervaci už nejde zrušit online.'}
                    </p>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <Sheet
        open={Boolean(voucherFor)}
        onClose={() => setVoucherFor(null)}
        title="Rezervační kód"
      >
        {voucherFor ? (
          <>
            <p className="tnum mb-4 text-base font-bold text-ink">
              {voucherFor.service_name_snapshot} · {dayLabel(voucherFor.start_at_snapshot, now)}{' '}
              {clockTime(voucherFor.start_at_snapshot)}
            </p>
            <Voucher code={voucherFor.reservation_code} />
          </>
        ) : null}
      </Sheet>

      <Sheet
        open={Boolean(toCancel)}
        onClose={() => {
          setToCancel(null);
          setFailure(null);
        }}
        title="Zrušit rezervaci?"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setToCancel(null)}>
              Nechat
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={cancel.isPending}
              onClick={() => toCancel && cancel.mutate(toCancel)}
            >
              Zrušit rezervaci
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink">
          {toCancel && ['pending_payment', 'pending_merchant'].includes(toCancel.status)
            ? 'Žádost zrušíme a případná blokace částky na kartě se uvolní.'
            : 'Termín se vrátí do nabídky a někdo jiný ho může využít. Vrátíme ti celou zaplacenou částku.'}
        </p>
        {failure ? (
          <div className="mt-3">
            <Banner tone="warning">{failure}</Banner>
          </div>
        ) : null}
      </Sheet>
    </main>
  );
}

/**
 * A booking that waited (or still waits) for the merchant. Its outcome is told in the same words as the
 * page the customer returns to from Stripe, so the two never disagree.
 */
function RequestState({ booking, now, onCancel }: { booking: CustomerBooking; now: string; onCancel: () => void }) {
  const view = confirmationView({
    status: booking.payment_status ?? 'pending', refund_requested: booking.payment_status === 'paid' && booking.status !== 'confirmed',
    failure_reason: null, reservation_code: null, booking_status: booking.status,
    merchant_decided_at: booking.merchant_decided_at, authorized_at: booking.authorized_at,
  });
  const line = booking.status === 'pending_merchant' ? waitingLine({ ...booking, start_at: booking.start_at_snapshot }, now) : null;
  const holdLeft = booking.status === 'pending_payment' && booking.checkout_expires_at && Date.parse(booking.checkout_expires_at) > Date.parse(now)
    ? `Termín ti držíme do ${clockTime(booking.checkout_expires_at)}.` : null;
  return (
    <div className={cx('mt-4 rounded-xl p-3 text-sm', view.live ? 'bg-accent-soft text-ink' : 'bg-surface text-ink')}>
      <p className="font-bold">{booking.status === 'pending_payment' ? 'Dokončuješ platbu' : view.title}</p>
      <p className="mt-1 text-muted">{booking.status === 'pending_payment' ? 'Na kartě zatím nic není. Po zaplacení pošleme rezervaci podniku k potvrzení.' : view.body}</p>
      {line ? <p className="tnum mt-2 font-bold" role="timer">{line}</p> : null}
      {holdLeft ? <p className="tnum mt-2 font-bold">{holdLeft}</p> : null}
      {booking.status === 'pending_merchant' || booking.status === 'pending_payment' ? (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onCancel}>Zrušit žádost</Button>
      ) : null}
    </div>
  );
}
