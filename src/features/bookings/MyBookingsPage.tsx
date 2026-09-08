import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Star } from 'lucide-react';
import { cancelBooking, myBookings, rateBooking } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { clockTime, dayLabel } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, LoadingList, Sheet, Tabs } from '../../components/ui';
import { Link } from '../../app/router';
import { useSession } from '../auth/session';
import type { BookingStatus, CustomerBooking } from '../../types/database';

const STATUS_LABEL: Record<BookingStatus, string> = {
  confirmed: 'Potvrzeno',
  completed: 'Dokončeno',
  no_show: 'Nedorazil/a jsi',
  cancelled_by_customer: 'Zrušeno tebou',
  cancelled_by_merchant: 'Zrušeno podnikem',
};

export function MyBookingsPage() {
  const { userId } = useSession();
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  const now = useServerNow();
  const queryClient = useQueryClient();
  const [toCancel, setToCancel] = useState<CustomerBooking | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['my-bookings', userId],
    queryFn: myBookings,
    enabled: Boolean(userId),
    refetchOnWindowFocus: true,
  });

  const cancel = useMutation({
    mutationFn: (booking: CustomerBooking) => cancelBooking(booking.id),
    onSuccess: async () => {
      setToCancel(null);
      setFailure(null);
      await queryClient.invalidateQueries();
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  if (!userId) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <EmptyState
          title="Rezervace uvidíš po přihlášení."
          body="Prohlížet nabídky můžeš i bez účtu."
          action={
            <Link
              to="/prihlaseni?returnTo=%2Frezervace"
              className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 font-semibold text-accent-ink"
            >
              Přihlásit se
            </Link>
          }
        />
      </main>
    );
  }

  const all = query.data ?? [];
  const upcoming = all.filter((b) => b.status === 'confirmed' && Date.parse(b.start_at_snapshot) > Date.parse(now));
  const history = all.filter((b) => !upcoming.includes(b));
  const rows = tab === 'upcoming' ? upcoming : history;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Moje rezervace</h1>
      <div className="mt-4">
        <Tabs
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
            title={tab === 'upcoming' ? 'Zatím nemáš žádnou rezervaci.' : 'Historie je zatím prázdná.'}
            body="Najdi si volný termín na dnes."
            action={
              <Link
                to="/"
                className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 font-semibold text-accent-ink"
              >
                Objevit nabídky
              </Link>
            }
          />
        ) : null}

        {rows.map((booking) => {
          const today = dayLabel(booking.start_at_snapshot, now) === 'Dnes';
          return (
            <article
              key={booking.id}
              className={`rounded-2xl border bg-card p-4 ${today && booking.status === 'confirmed' ? 'border-accent' : 'border-line'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="tnum font-mono text-xl font-extrabold tracking-[0.1em] text-ink">
                    {booking.reservation_code}
                  </p>
                  <p className="tnum mt-2 text-base font-bold text-accent">
                    {dayLabel(booking.start_at_snapshot, now)} {clockTime(booking.start_at_snapshot)}–
                    {clockTime(booking.end_at_snapshot)}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-surface px-2 py-1 text-xs font-semibold text-muted">
                  {STATUS_LABEL[booking.status]}
                </span>
              </div>

              <p className="mt-4 text-base font-bold text-ink">{booking.service_name_snapshot}</p>
              <p className="text-sm text-muted">
                {booking.business_name_snapshot} · {booking.business_address_snapshot}
              </p>
              <p className="tnum mt-2 text-base font-bold text-accent">
                {money(booking.price_cents)} <span className="font-normal text-muted">na místě</span>
              </p>

              {booking.status === 'completed' ? <RatingPrompt booking={booking} /> : null}

              {booking.cancellation_reason ? (
                <p className="mt-2 text-sm text-accent">Důvod: {booking.cancellation_reason}</p>
              ) : null}

              {booking.status === 'confirmed' ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a
                    className="inline-flex min-h-11 items-center rounded-xl border border-line px-3 text-sm font-semibold text-ink"
                    href={`tel:${booking.business_phone}`}
                  >
                    Zavolat podniku
                  </a>
                  {booking.can_cancel ? (
                    <Button variant="danger" onClick={() => setToCancel(booking)}>
                      Zrušit rezervaci
                    </Button>
                  ) : (
                    <p className="text-xs text-muted">Rezervaci už nejde zrušit online.</p>
                  )}
                  {booking.can_cancel ? (
                    <p className="tnum w-full text-xs text-muted">
                      Zrušit můžeš zdarma do {clockTime(booking.cancellation_deadline)}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

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
          Termín se vrátí do nabídky a někdo jiný ho může využít. Vrátíme ti celou zaplacenou částku.
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
 * The rating loop closes here: only a booking the merchant marked as completed can be
 * rated, which is what keeps the averages on the cards honest.
 */
function RatingPrompt({ booking }: { booking: CustomerBooking }) {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const rate = useMutation({
    mutationFn: (value: number) => rateBooking(booking.id, value),
    onSuccess: async () => {
      setFailure(null);
      await queryClient.invalidateQueries();
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  if (booking.rating) {
    return (
      <p className="tnum mt-3 inline-flex items-center gap-1.5 text-sm text-muted">
        Ohodnotil/a jsi
        <span className="inline-flex items-center gap-1 font-semibold text-ink">
          <Star size={15} aria-hidden="true" className="fill-ink text-ink" />
          {booking.rating}
        </span>
        z 5
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-sm font-semibold">Jak to bylo?</p>
      <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label="Hodnocení termínu">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            disabled={rate.isPending}
            onClick={() => rate.mutate(value)}
            aria-label={`${value} z 5`}
            className="grid size-11 place-items-center rounded-lg text-muted hover:bg-accent-soft hover:text-accent disabled:opacity-50"
          >
            <Star size={22} aria-hidden="true" />
          </button>
        ))}
      </div>
      {failure ? (
        <p role="alert" className="mt-1 text-sm font-medium text-accent">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
