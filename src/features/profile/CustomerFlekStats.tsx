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

/** One, two to four, five and more: Czech counts in three forms and the card says all three. */
function caught(count: number): string {
  if (count === 1) return 'chycený FLEK';
  return count < 5 ? 'chycené FLEKy' : 'chycených FLEKů';
}

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

  if (metrics.isPending) return <Skeleton className="h-48 w-full rounded-3xl" />;
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
    <PromoCard tone="dark">
      <PinMark tone="dark" className="pointer-events-none absolute top-3.5 right-4 h-10 w-12" />
      <h2 className="text-sm font-bold text-brand-on-dark">Tvůj FLEK · {currentMonthName()}</h2>
      {/*
        The month is the headline and the rest is the footnote, because that is the order the
        figures matter in: what the month saved, then how it compares with everything before it.
        Value above label and one size bigger — a figure this card exists for should not be the
        same size as the word describing it.
      */}
      <dl className="relative mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="min-w-0">
          <dd className="tnum text-[2.125rem] leading-none font-extrabold tracking-tight text-brand-on-dark">
            {money(m.month_saved_cents)}
          </dd>
          <dt className="mt-1.5 text-sm text-card/75">ušetřeno</dt>
        </div>
        <div className="min-w-0">
          <dd className="tnum text-[2.125rem] leading-none font-extrabold">{m.month_completed}</dd>
          <dt className="mt-1.5 text-sm text-card/75">{caught(m.month_completed)}</dt>
        </div>
      </dl>
      {/* A band rather than a hairline: it separates the two time spans without adding a line. */}
      <div className="relative mt-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl bg-card/10 px-3.5 py-2.5">
        {/* „FLEKů", not „chycených FLEKů": the label above already said what was caught, and the
            longer wording wrapped this line on a phone and made the band three rows tall. */}
        <p className="tnum text-sm text-card/75">
          Celkem <span className="font-bold text-card">{m.all_time_completed} {fleks(m.all_time_completed)}</span>
          {' · '}ušetřeno <span className="font-bold text-card">{money(m.all_time_saved_cents)}</span>
        </p>
        {/* Null means "nothing completed yet", which the branch above already handled; 0 %
            would be a real if unexciting best catch, so it is not hidden. */}
        {m.best_discount_pct !== null ? (
          <span className="tnum shrink-0 rounded-full bg-brand-on-dark px-2.5 py-1 text-xs font-extrabold text-ink">
            nejlepší úlovek −{m.best_discount_pct} %
          </span>
        ) : null}
      </div>
    </PromoCard>
  );
}
