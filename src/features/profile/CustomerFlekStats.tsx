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

  if (metrics.isPending) return <Skeleton className="h-44 w-full rounded-3xl" />;
  if (metrics.isError || !metrics.data) return null;

  const m = metrics.data;

  if (m.all_time_completed === 0) {
    return (
      <PromoCard tone="dark">
        <PinMark className="pointer-events-none absolute top-3.5 right-4 h-10 w-12" />
        <p className="text-sm font-bold text-brand">Tvůj FLEK</p>
        <h2 className="mt-2 max-w-xs text-xl leading-snug font-extrabold tracking-tight">První FLEK na tebe čeká</h2>
        <p className="mt-2 max-w-xs text-base text-card/75">Chyť volný FLEK se slevou a tady uvidíš, kolik ušetříš.</p>
        <Link to="/" className="relative mt-5 inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-bold text-ink hover:bg-sage">
          Objevit FLEKy
        </Link>
      </PromoCard>
    );
  }

  return (
    <PromoCard tone="dark">
      <PinMark className="pointer-events-none absolute top-3.5 right-4 h-10 w-12" />
      <h2 className="text-sm font-bold text-brand">Tvůj FLEK · {currentMonthName()}</h2>
      <dl className="relative mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <dt className="text-sm text-card/75">Ušetřeno</dt>
          <dd className="tnum text-2xl font-extrabold text-brand">{money(m.month_saved_cents)}</dd>
        </div>
        <div>
          <dt className="text-sm text-card/75">Chycené FLEKy</dt>
          <dd className="tnum text-2xl font-extrabold">{m.month_completed}</dd>
        </div>
      </dl>
      <p className="tnum relative mt-4 border-t border-card/15 pt-3 text-sm text-card/75">
        Celkem {m.all_time_completed}{' '}
        {m.all_time_completed === 1 ? 'chycený FLEK' : m.all_time_completed < 5 ? 'chycené FLEKy' : 'chycených FLEKů'}
        {' · '}ušetřeno {money(m.all_time_saved_cents)}
        {/* Null means "nothing completed yet", which the branch above already handled; 0 %
            would be a real if unexciting best catch, so it is not hidden. */}
        {m.best_discount_pct !== null ? ` · nejlepší úlovek −${m.best_discount_pct} %` : ''}
      </p>
    </PromoCard>
  );
}
