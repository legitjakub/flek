import { money } from '../../lib/format';
import { ErrorState, LoadingList } from '../../components/ui';
import { MerchantShell } from './MerchantShell';
import { useMerchantMetrics } from './useBusiness';

export function MerchantMetricsPage() {
  return <MerchantShell>{(business) => <Metrics businessId={business.id} />}</MerchantShell>;
}

function Metrics({ businessId }: { businessId: string }) {
  const metrics = useMerchantMetrics(businessId);
  if (metrics.isPending) return <LoadingList rows={2} />;
  if (metrics.isError) return <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} />;
  const data = metrics.data;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Metriky</h1>

      {/*
        The merchant's own number: the price they set, for every booking whose payment was
        kept — a no-show included, because the customer paid and the slot was held. Nothing
        is deducted from it; FLEK's service fee was added on top and paid by the customer.
      */}
      <section className="rounded-2xl bg-card shadow-card p-5">
        <p className="text-sm text-muted">Tento měsíc jste z jinak prázdných termínů vydělali</p>
        <p className="tnum mt-1 text-2xl font-extrabold text-ink">{money(data.earned_cents)}</p>
        {data.upcoming_payout_cents > 0 ? (
          <p className="tnum mt-2 text-sm text-muted">
            A dalších <span className="font-bold text-ink">{money(data.upcoming_payout_cents)}</span> za rezervace, které vás teprve čekají.
          </p>
        ) : null}
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label="Zveřejněné nabídky" value={data.published_offers} note="tento měsíc" />
        <Metric label="Rezervace" value={data.booked_capacity} note="tento měsíc" />
        <Metric label="Dokončené" value={data.completed} note="tento měsíc" />
        <Metric label="Nedorazili" value={data.no_shows} note="tento měsíc" />
        {/* merchant_metrics counts this one over all time, unlike its five neighbours. */}
        <Metric label="Čeká na dokončení" value={data.unresolved} note="automaticky" />
        <Metric
          label="Naplněnost"
          value={data.published_capacity > 0 ? `${Math.round((data.booked_capacity * 100) / data.published_capacity)} %` : '—'}
          note="tento měsíc"
        />
      </dl>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <div className="rounded-2xl bg-card shadow-card p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum mt-1 text-xl font-extrabold text-ink">{value}</dd>
      {/* Five of these are month-to-date and one is all-time, and nothing said so. */}
      <dd className="mt-0.5 text-xs text-muted">{note}</dd>
    </div>
  );
}
