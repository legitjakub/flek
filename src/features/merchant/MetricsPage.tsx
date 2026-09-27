import { CalendarDays, Hourglass, Ticket, UserCheck, UserX, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { money } from '../../lib/format';
import { ErrorState, IconTile, LoadingList, cx } from '../../components/ui';
import { MerchantShell } from './MerchantShell';
import { PageHeader } from './partnerUi';
import { useMerchantMetrics } from './useBusiness';

export function MerchantMetricsPage() {
  return <MerchantShell>{(business) => <Metrics businessId={business.id} />}</MerchantShell>;
}

function Metrics({ businessId }: { businessId: string }) {
  const metrics = useMerchantMetrics(businessId);
  if (metrics.isPending) return <LoadingList rows={2} />;
  if (metrics.isError) return <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} />;
  const data = metrics.data;
  const fill = data.published_capacity > 0 ? Math.round((data.booked_capacity * 100) / data.published_capacity) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Metriky" subtitle="Co vám volné termíny tento měsíc vynesly." />

      {/*
        The merchant's own number: the price they set, for every booking whose payment was
        kept — a no-show included, because the customer paid and the slot was held. Nothing
        is deducted from it; FLEK's service fee was added on top and paid by the customer.
      */}
      <section aria-labelledby="vydelek" className="rounded-3xl bg-brand p-5 text-brand-ink shadow-card sm:p-6">
        <h2 id="vydelek" className="inline-flex items-center gap-1.5 text-xs font-medium">
          <Wallet size={14} aria-hidden="true" />
          Tento měsíc jste z jinak prázdných termínů vydělali
        </h2>
        <p className="tnum mt-3 text-4xl leading-none font-extrabold tracking-tight">{money(data.earned_cents)}</p>
        {data.upcoming_payout_cents > 0 ? (
          <p className="tnum mt-4 border-t border-card/20 pt-3 text-sm">
            A dalších <span className="font-extrabold">{money(data.upcoming_payout_cents)}</span> za rezervace, které vás teprve čekají.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="naplnenost" className="rounded-3xl bg-card p-5 shadow-card sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="naplnenost" className="text-base font-extrabold text-ink">Naplněnost</h2>
          <p className="tnum text-2xl font-extrabold text-ink">{fill === null ? '—' : `${fill} %`}</p>
        </div>
        <span className="mt-3 block h-2.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, fill ?? 0)}%` }} />
        </span>
        <p className="mt-2 text-sm text-muted">Kolik zveřejněných míst si tento měsíc někdo rezervoval.</p>
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric icon={<CalendarDays size={18} />} label="Zveřejněné nabídky" value={data.published_offers} note="tento měsíc" />
        <Metric icon={<Ticket size={18} />} label="Rezervace" value={data.booked_capacity} note="tento měsíc" />
        <Metric icon={<UserCheck size={18} />} tone="positive" label="Dokončené" value={data.completed} note="tento měsíc" />
        <Metric icon={<UserX size={18} />} tone="danger" label="Nedorazili" value={data.no_shows} note="tento měsíc" />
        {/* merchant_metrics counts this one over all time, unlike its neighbours. */}
        <Metric icon={<Hourglass size={18} />} tone="accent" label="Čeká na dokončení" value={data.unresolved} note="automaticky" wide />
      </dl>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  note,
  tone = 'brand',
  wide = false,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  note: string;
  tone?: 'brand' | 'accent' | 'positive' | 'danger';
  /** The odd one out on a phone's two columns takes the whole row. */
  wide?: boolean;
}) {
  return (
    <div className={cx('flex flex-col rounded-3xl bg-card p-4 shadow-card sm:p-5', wide && 'col-span-2 sm:col-span-1')}>
      <dt className="flex flex-col items-start gap-3 text-sm leading-snug text-muted">
        <IconTile icon={icon} tone={tone} size="sm" />
        {label}
      </dt>
      <dd className="tnum mt-1 text-2xl leading-none font-extrabold text-ink">{value}</dd>
      {/* Most of these are month-to-date and one is all-time, and nothing said so. */}
      <dd className="mt-1.5 text-xs text-muted">{note}</dd>
    </div>
  );
}
