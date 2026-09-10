import { money } from '../../lib/format';
import { ErrorState, LoadingList } from '../../components/ui';
import { MerchantShell } from './MerchantShell';
import { useMerchantMetrics } from './useBusiness';
import { payout } from './OffersPage';

export function MerchantMetricsPage() {
  return (
    <MerchantShell>
      {(business) => <Metrics businessId={business.id} commissionRate={business.commission_rate} />}
    </MerchantShell>
  );
}

function Metrics({ businessId, commissionRate }: { businessId: string; commissionRate: number }) {
  const metrics = useMerchantMetrics(businessId);
  if (metrics.isPending) return <LoadingList rows={2} />;
  if (metrics.isError) return <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} />;
  const data = metrics.data;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Metriky</h1>

      {/*
        recovered_cents is the sum of what customers paid — gross — and the headline called
        it "získali jste" with no mention that a commission comes out of it. The split is
        stated here rather than left for the merchant to discover on an invoice.
      */}
      <section className="rounded-2xl bg-card shadow-card p-5">
        <p className="text-sm text-muted">Tento měsíc jste z jinak prázdných termínů vydělali</p>
        <p className="tnum mt-1 text-2xl font-extrabold text-ink">{money(payout(data.recovered_cents, commissionRate))}</p>
        <p className="tnum mt-2 text-sm text-muted">
          Zákazníci zaplatili {money(data.recovered_cents)} · provize FLEK{' '}
          {Math.round(commissionRate * 100)} % je {money(data.recovered_cents - payout(data.recovered_cents, commissionRate))}
        </p>
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label="Zveřejněné nabídky" value={data.published_offers} note="tento měsíc" />
        <Metric label="Rezervace" value={data.bookings} note="tento měsíc" />
        <Metric label="Dokončené" value={data.completed} note="tento měsíc" />
        <Metric label="Nedorazili" value={data.no_show} note="tento měsíc" />
        {/* merchant_metrics counts this one over all time, unlike its five neighbours. */}
        <Metric label="Nevyřízené" value={data.unresolved} note="celkem" />
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
      <p className="mt-0.5 text-xs text-muted">{note}</p>
    </div>
  );
}
