import { useQuery } from '@tanstack/react-query';
import { myCustomerMetrics } from '../../lib/api';
import { money } from '../../lib/format';
import { Skeleton } from '../../components/ui';
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

  if (metrics.isPending) return <Skeleton className="h-28 w-full" />;
  if (metrics.isError || !metrics.data) return null;

  const m = metrics.data;

  if (m.all_time_completed === 0) {
    return (
      <section className="rounded-2xl bg-card p-5 shadow-card">
        <h2 className="text-base font-extrabold">Tvůj FLEK</h2>
        <p className="mt-1 text-base text-muted">První FLEK na tebe teprve čeká.</p>
        <Link to="/" className="mt-4 inline-flex min-h-11 items-center text-base font-bold text-accent">
          Objevit FLEKy
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-card p-5 shadow-card">
      <h2 className="text-base font-extrabold">Tvé {currentMonthName()}</h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <dt className="text-sm text-muted">Chycené FLEKy</dt>
          <dd className="tnum text-xl font-extrabold">{m.month_completed}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Ušetřeno</dt>
          <dd className="tnum text-xl font-extrabold text-positive">{money(m.month_saved_cents)}</dd>
        </div>
      </dl>
      <p className="tnum mt-4 border-t border-line pt-3 text-sm text-muted">
        Celkem {m.all_time_completed}{' '}
        {m.all_time_completed === 1 ? 'chycený FLEK' : m.all_time_completed < 5 ? 'chycené FLEKy' : 'chycených FLEKů'}
        {' · '}ušetřeno {money(m.all_time_saved_cents)}
        {/* Null means "nothing completed yet", which the branch above already handled; 0 %
            would be a real if unexciting best catch, so it is not hidden. */}
        {m.best_discount_pct !== null ? ` · nejlepší úlovek −${m.best_discount_pct} %` : ''}
      </p>
    </section>
  );
}
