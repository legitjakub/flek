import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { merchantBookings } from '../../lib/api';
import { money } from '../../lib/format';
import { clockTime, dayBounds, dayLabel } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Button, EmptyState, ErrorState, LoadingList } from '../../components/ui';
import { Link } from '../../app/router';
import { MerchantShell } from './MerchantShell';
import { CreateOfferSheet } from './CreateOfferSheet';
import { useMerchantMetrics, useServices } from './useBusiness';
import { ResolveButtons } from './ResolveButtons';

export function MerchantDashboardPage() {
  return <MerchantShell>{(business) => <Dashboard businessId={business.id} approved={business.status === 'approved'} />}</MerchantShell>;
}

function Dashboard({ businessId, approved }: { businessId: string; approved: boolean }) {
  const now = useServerNow();
  const [sheetOpen, setSheetOpen] = useState(false);
  const services = useServices(businessId);
  const metrics = useMerchantMetrics(businessId);
  const day = dayBounds(now);

  const today = useQuery({
    queryKey: ['merchant-bookings', businessId, 'dashboard'],
    queryFn: () => merchantBookings(businessId, day.from),
    refetchOnWindowFocus: true,
  });

  const upcoming = (today.data ?? []).filter((b) => b.status === 'confirmed');
  const next = upcoming.find((b) => Date.parse(b.start_at_snapshot) >= Date.parse(now));
  const toResolve = (today.data ?? []).filter((b) => b.can_resolve && b.status === 'confirmed');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Přehled</h1>
        <Button size="lg" disabled={!approved} onClick={() => setSheetOpen(true)}>
          + Přidat volný termín
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Aktivní nabídky" value={metrics.data?.active_offers} />
        <Stat label="Rezervace dnes" value={metrics.data?.today_bookings} />
        <Stat label="Volná místa" value={metrics.data?.free_seats} />
      </div>

      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="text-base font-bold text-ink">Nejbližší rezervace</h2>
        {today.isPending ? <LoadingList rows={1} /> : null}
        {today.isError ? <ErrorState error={today.error} onRetry={() => today.refetch()} /> : null}
        {today.isSuccess && !next ? (
          <p className="mt-2 text-sm text-muted">Dnes zatím nemáte žádnou rezervaci.</p>
        ) : null}
        {next ? (
          <div className="mt-2">
            <p className="tnum font-mono text-lg font-extrabold tracking-[0.1em] text-ink">{next.reservation_code}</p>
            <p className="tnum mt-1 text-sm font-semibold text-ink">
              {dayLabel(next.start_at_snapshot, now)} {clockTime(next.start_at_snapshot)} · {next.service_name_snapshot}
            </p>
            <p className="text-sm text-muted">
              {next.customer_label} · {money(next.price_cents)}
            </p>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="text-base font-bold text-ink">Čeká na vyřízení</h2>
        {toResolve.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nic nečeká. Docházku potvrdíte až po začátku termínu.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {toResolve.map((booking) => (
              <li key={booking.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 first:border-0 first:pt-0">
                <div>
                  <p className="tnum text-sm font-semibold text-ink">
                    {clockTime(booking.start_at_snapshot)} · {booking.service_name_snapshot}
                  </p>
                  <p className="text-sm text-muted">
                    {booking.customer_label} · {booking.reservation_code}
                  </p>
                </div>
                <ResolveButtons booking={booking} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {services.isSuccess && services.data.filter((s) => s.is_active).length === 0 ? (
        <EmptyState
          title="Přidejte první službu"
          body="Nabídka je vždy volný termín na konkrétní službu."
          action={
            <Link
              to="/partner/sluzby"
              className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 font-semibold text-accent-ink"
            >
              Přidat službu
            </Link>
          }
        />
      ) : null}

      <CreateOfferSheet open={sheetOpen} onClose={() => setSheetOpen(false)} services={services.data ?? []} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-3">
      <p className="tnum text-xl font-extrabold text-ink">{value ?? '—'}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
