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

      <section className="rounded-2xl bg-card shadow-card p-5">
        <p className="text-sm text-muted">Tento měsíc jste z jinak prázdných termínů získali</p>
        <p className="tnum mt-1 text-2xl font-extrabold text-ink">{money(data.recovered_cents)}</p>
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label="Zveřejněné nabídky" value={data.published_offers} />
        <Metric label="Rezervace" value={data.bookings} />
        <Metric label="Dokončené" value={data.completed} />
        <Metric label="Nedorazili" value={data.no_show} />
        <Metric label="Nevyřízené" value={data.unresolved} />
        <Metric
          label="Naplněnost"
          value={data.published_capacity > 0 ? `${Math.round((data.booked_capacity * 100) / data.published_capacity)} %` : '—'}
        />
      </dl>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl bg-card shadow-card p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum mt-1 text-xl font-extrabold text-ink">{value}</dd>
    </div>
  );
}
