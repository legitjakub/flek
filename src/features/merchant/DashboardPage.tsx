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
import { SetupChecklist } from './SetupChecklist';
import type { Business } from '../../types/database';
import { ResolveButtons } from './ResolveButtons';
import { ConfirmationRequests, isConfirmationRequest, visibleToMerchant } from './ConfirmationRequests';

export function MerchantDashboardPage() {
  return (
    <MerchantShell>
      {(business) => (
        <Dashboard business={business} />
      )}
    </MerchantShell>
  );
}

function Dashboard({ business }: { business: Business }) {
  const businessId = business.id;
  const approved = business.status === 'approved';
  const now = useServerNow();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [published, setPublished] = useState<string | null>(null);
  const services = useServices(businessId);
  const metrics = useMerchantMetrics(businessId);
  const day = dayBounds(now);
  // From yesterday: a booking stays open for "Nedorazil" until 24 h after its end, so an
  // evening slot from yesterday still belongs on this screen this morning.
  const windowStart = dayBounds(now, -2).from;

  const today = useQuery({
    queryKey: ['merchant-bookings', businessId, 'dashboard', windowStart],
    queryFn: () => merchantBookings(businessId, windowStart),
    refetchOnWindowFocus: true,
    refetchInterval: (current) => current.state.data?.some(isConfirmationRequest) ? 3_000 : false,
  });
  const requests = (today.data ?? []).filter(visibleToMerchant).filter(isConfirmationRequest);

  const upcoming = (today.data ?? []).filter((b) => b.status === 'confirmed' && b.start_at_snapshot >= day.from);
  const next = upcoming.find((b) => Date.parse(b.start_at_snapshot) >= Date.parse(now));
  const toResolve = (today.data ?? []).filter((b) => Date.parse(b.end_at_snapshot) <= Date.parse(now) && b.can_resolve && b.status === 'confirmed');

  return (
    <div className="flex flex-col gap-6">
      {published ? (
        <div className="mb-4">
          <Banner tone="success">
            Nabídka je aktivní. <span className="tnum">{published}</span>{' '}
            <button type="button" onClick={() => setPublished(null)} className="font-bold underline underline-offset-4">Skrýt</button>
          </Banner>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold tracking-tight text-ink">Přehled</h1><p className="mt-1 text-sm text-muted">Vaše termíny a rezervace na jednom místě.</p></div>
        <Button size="lg" className="w-full sm:w-auto" disabled={!approved || services.isPending} onClick={() => setSheetOpen(true)}>
          <Plus size={20} aria-hidden="true" />Přidat volný termín
        </Button>
      </div>

      {/* A request answers itself by running out, so it comes before anything the merchant could do later. */}
      <ConfirmationRequests rows={requests} />

      <SetupChecklist business={business} />

      {metrics.isError ? <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} /> : null}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Stat label="Aktivní nabídky" value={metrics.data?.active_offers} />
        <Stat label="Rezervace dnes" value={metrics.data?.today_bookings} />
        <Stat label="Volná místa" value={metrics.data?.free_seats} />
      </div>

      {/* Shown only once it means something — a follower count of one or two reads as
          failure. Worded as an audience, never as "we notified them": there is no push
          delivery, and claiming one would be a lie the merchant would repeat to customers. */}
      {(metrics.data?.followers ?? 0) >= 5 ? (
        <p className="rounded-2xl bg-card px-5 py-4 text-base text-ink shadow-card">
          <span className="tnum font-extrabold">{metrics.data?.followers} lidí</span> sleduje vaši
          provozovnu. Nový FLEK se objeví i jim.
        </p>
      ) : null}

      <section className="rounded-2xl bg-card shadow-card p-5 sm:p-6">
        <h2 className="text-base font-bold text-ink">Nejbližší rezervace</h2>
        {today.isPending ? <LoadingList rows={1} /> : null}
        {today.isError ? <ErrorState error={today.error} onRetry={() => today.refetch()} /> : null}
        {today.isSuccess && !next ? (
          <p className="mt-2 text-sm text-muted">Dnes zatím nemáte žádnou rezervaci.</p>
        ) : null}
        {next ? (
          <div className="mt-4 flex flex-wrap items-center gap-5"><div className="tnum flex items-center gap-3 rounded-xl bg-accent-soft p-4 text-accent"><CalendarDays size={24} aria-hidden="true" /><span className="text-xl font-extrabold">{clockTime(next.start_at_snapshot)}</span></div><div>
            <p className="tnum font-mono text-lg font-extrabold tracking-[0.1em] text-ink">{next.reservation_code}</p>
            <p className="tnum mt-1 text-sm font-bold text-ink">
              {dayLabel(next.start_at_snapshot, now)} {clockTime(next.start_at_snapshot)} · {next.service_name_snapshot}
            </p>
            <p className="text-sm text-muted">
              {next.customer_label} · Vy dostanete <span className="tnum font-bold text-ink">{money(next.merchant_payout_cents)}</span>
            </p></div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl bg-card shadow-card p-5 sm:p-6">
        {/* Renamed from "Čeká na vyřízení": nothing waits on the merchant any more. These are
            the bookings still open for a no-show, and ignoring them is the correct default. */}
        <h2 className="text-base font-bold text-ink">Proběhlé rezervace</h2>
        <p className="mt-1 text-sm text-muted">
          Pokud zákazník dorazil, nemusíte nic dělat. Pokud nedorazil, označte ho do 24 hodin po konci termínu.
        </p>
        {toResolve.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Teď tu nic není.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {toResolve.map((booking) => (
              <li key={booking.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 first:border-0 first:pt-0">
                <div>
                  <p className="tnum text-sm font-bold text-ink">
                    {dayLabel(booking.start_at_snapshot, now)} {clockTime(booking.start_at_snapshot)} · {booking.service_name_snapshot}
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


      {sheetOpen ? <CreateOfferSheet onPublished={setPublished} open onClose={() => setSheetOpen(false)} services={services.data ?? []} /> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-2xl bg-card shadow-card px-3 py-4 sm:p-5">
      <p className="tnum text-xl font-extrabold text-ink">{value ?? '—'}</p>
      <p className="mt-1 text-sm leading-snug text-muted">{label}</p>
    </div>
  );
}
