import { Plus, CalendarDays } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { merchantBookings } from '../../lib/api';
import { money } from '../../lib/format';
import { clockTime, dayBounds, dayLabel } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, LoadingList } from '../../components/ui';
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
  const [published, setPublished] = useState<string | null>(null);
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
    <div className="flex flex-col gap-6">
      {published ? (
        <div className="mb-4">
          <Banner tone="success">
            Nabídka je aktivní. <span className="tnum">{published}</span>{' '}
            <button type="button" onClick={() => setPublished(null)} className="font-semibold underline underline-offset-4">Skrýt</button>
          </Banner>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold tracking-tight text-ink">Přehled</h1><p className="mt-1 text-sm text-muted">Vaše termíny a rezervace na jednom místě.</p></div>
        <Button size="lg" className="w-full sm:w-auto" disabled={!approved || services.isPending} onClick={() => setSheetOpen(true)}>
          <Plus size={20} aria-hidden="true" />Přidat volný termín
        </Button>
      </div>

      {metrics.isError ? <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} /> : null}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Stat label="Aktivní nabídky" value={metrics.data?.active_offers} />
        <Stat label="Rezervace dnes" value={metrics.data?.today_bookings} />
        <Stat label="Volná místa" value={metrics.data?.free_seats} />
      </div>

      <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
        <h2 className="text-base font-bold text-ink">Nejbližší rezervace</h2>
        {today.isPending ? <LoadingList rows={1} /> : null}
        {today.isError ? <ErrorState error={today.error} onRetry={() => today.refetch()} /> : null}
        {today.isSuccess && !next ? (
          <p className="mt-2 text-sm text-muted">Dnes zatím nemáte žádnou rezervaci.</p>
        ) : null}
        {next ? (
          <div className="mt-4 flex flex-wrap items-center gap-5"><div className="tnum flex items-center gap-3 rounded-xl bg-accent-soft p-4 text-accent"><CalendarDays size={24} aria-hidden="true" /><span className="text-xl font-extrabold">{clockTime(next.start_at_snapshot)}</span></div><div>
            <p className="tnum font-mono text-lg font-extrabold tracking-[0.1em] text-ink">{next.reservation_code}</p>
            <p className="tnum mt-1 text-sm font-semibold text-ink">
              {dayLabel(next.start_at_snapshot, now)} {clockTime(next.start_at_snapshot)} · {next.service_name_snapshot}
            </p>
            <p className="text-sm text-muted">
              {next.customer_label} · {money(next.price_cents)}
            </p></div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
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
              className="inline-flex min-h-11 items-center rounded-xl bg-action px-4 font-semibold text-accent-ink"
            >
              Přidat službu
            </Link>
          }
        />
      ) : null}

      {sheetOpen ? <CreateOfferSheet onPublished={setPublished} open onClose={() => setSheetOpen(false)} services={services.data ?? []} /> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-3 py-4 sm:p-5">
      <p className="tnum text-xl font-extrabold text-ink">{value ?? '—'}</p>
      <p className="mt-1 text-sm leading-snug text-muted">{label}</p>
    </div>
  );
}
