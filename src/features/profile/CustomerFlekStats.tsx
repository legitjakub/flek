import { useQuery } from '@tanstack/react-query';
import { myCustomerMetrics } from '../../lib/api';
import { money } from '../../lib/format';
import { PinMark, PromoCard, Skeleton } from '../../components/ui';
import { Link } from '../../app/router';

const MONTHS = [
  'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec',
];

/** Prague, because the server counts the month boundary in Prague. */
function currentMonthName(): string {
  return MONTHS[
    Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', month: 'numeric' }).format(new Date())) - 1
  ];
}

/** One, two to four, five and more: Czech counts in three forms. */
function fleks(count: number): string {
  if (count === 1) return 'FLEK';
  return count < 5 ? 'FLEKy' : 'FLEKů';
}

/**
 * A value dashboard, not a game. Every figure is computed in PostgreSQL from booking
 * snapshots and counts only appointments that were actually kept — no levels, no badges, no
 * percentile that a few hundred users could not honestly support.
 */
export function CustomerFlekStats({ userId }: { userId: string }) {
  const metrics = useQuery({
    queryKey: ['customer-metrics', userId],
    queryFn: myCustomerMetrics,
    staleTime: 60_000,
  });

  if (metrics.isPending) return <Skeleton className="h-60 w-full rounded-3xl" />;
  if (metrics.isError || !metrics.data) return null;

  const m = metrics.data;

  if (m.all_time_completed === 0) {
    return (
      <PromoCard tone="dark">
        <PinMark tone="dark" className="pointer-events-none absolute top-3.5 right-4 h-10 w-12" />
        <p className="text-sm font-bold text-brand-on-dark">Tvůj FLEK</p>
        <h2 className="mt-2 max-w-xs text-xl leading-snug font-extrabold tracking-tight">První FLEK na tebe čeká</h2>
        <p className="mt-2 max-w-xs text-base text-card/75">Chyť volný FLEK se slevou a tady uvidíš, kolik ušetříš.</p>
        <Link to="/" className="relative mt-5 inline-flex min-h-11 items-center rounded-full bg-brand-on-dark px-5 text-sm font-bold text-ink hover:bg-brand-soft">
          Objevit FLEKy
        </Link>
      </PromoCard>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-3xl bg-card shadow-card">
      {/*
        A stub, like the voucher the customer shows at the business: the torn-off top is what
        the month saved, the rest is the small print. One figure is the headline on purpose —
        the card exists for the money, and the count used to compete with it at the same size.
      */}
      <div className="relative bg-ink px-5 pt-5 pb-6 text-card sm:px-6">
        <PinMark tone="dark" className="pointer-events-none absolute top-4 right-5 h-9 w-10" />
        <h2 className="text-xs font-bold tracking-[0.06em] text-brand-on-dark uppercase">
          Tvůj FLEK · {currentMonthName()}
        </h2>
        <p className="tnum mt-2.5 text-[2.75rem] leading-none font-extrabold tracking-tight text-brand-on-dark">
          {money(m.month_saved_cents)}
        </p>
        <p className="mt-1.5 text-sm text-card/75">ušetřeno</p>
      </div>
      {/* The perforation: a dashed tear line with a bite out of each edge in the page colour. */}
      <div aria-hidden="true" className="relative border-t-2 border-dashed border-line">
        <span className="absolute -top-[11px] -left-2.5 size-5 rounded-full bg-surface" />
        <span className="absolute -top-[11px] -right-2.5 size-5 rounded-full bg-surface" />
      </div>
      <dl className="tnum px-5 pt-3 pb-4 text-sm sm:px-6">
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-muted">Chycené FLEKy</dt>
          <dd className="font-bold text-ink">{m.month_completed}</dd>
        </div>
        {/* Null means "nothing completed yet", which the branch above already handled; 0 %
            would be a real if unexciting best catch, so it is not hidden. */}
        {m.best_discount_pct !== null ? (
          <div className="flex items-baseline justify-between gap-4 py-1.5">
            <dt className="text-muted">Nejlepší úlovek</dt>
            <dd className="font-bold text-brand">−{m.best_discount_pct} %</dd>
          </div>
        ) : null}
        {/* In the first month every FLEK is also this month's, so the row would repeat the
            figures above word for word. It appears once there is history to add up. */}
        {m.all_time_completed !== m.month_completed ? (
          <div className="flex items-baseline justify-between gap-4 py-1.5">
            <dt className="text-muted">Od začátku</dt>
            <dd className="text-right text-ink">
              {m.all_time_completed} {fleks(m.all_time_completed)} ·{' '}
              <span className="font-bold">{money(m.all_time_saved_cents)}</span>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
