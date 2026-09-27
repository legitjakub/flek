import { Armchair, CalendarClock, CalendarDays, ChevronRight, Heart, Plus, Ticket, UserCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { merchantBookings, merchantOffers } from '../../lib/api';
import { money } from '../../lib/format';
import { calendarDay, clockTime, dayBounds, dayLabel, duration } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, ErrorState, IconTile, LoadingList, cx } from '../../components/ui';
import { Link } from '../../app/router';
import { MerchantShell } from './MerchantShell';
import { CreateOfferSheet } from './CreateOfferSheet';
import { useMerchantMetrics, useServices } from './useBusiness';
import { SetupGuide, usePublishReadiness } from './SetupGuide';
import type { Business, MerchantBooking } from '../../types/database';
import { ResolveButtons } from './ResolveButtons';
import { ConfirmationRequests, isConfirmationRequest, visibleToMerchant } from './ConfirmationRequests';
import { CodeChip, PageHeader, SectionTitle } from './partnerUi';
import { startsIn } from './incomingRequestState';

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
  const now = useServerNow();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [published, setPublished] = useState<string | null>(null);
  const services = useServices(businessId);
  const metrics = useMerchantMetrics(businessId);
  const readiness = usePublishReadiness(business);
  const offers = useQuery({ queryKey: ['merchant-offers', businessId], queryFn: () => merchantOffers(businessId) });
  // Until the first FLEK, the dashboard is the guide: three zeros and two empty booking lists
  // only pushed the one thing a new venue has to do below the fold.
  const fresh = offers.isSuccess && offers.data.length === 0;
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
  // The rest of today after the next one: who else is coming, at a glance.
  const laterToday = upcoming.filter((b) => b !== next && Date.parse(b.start_at_snapshot) >= Date.parse(now) && Date.parse(b.start_at_snapshot) < Date.parse(day.until));
  const toResolve = (today.data ?? []).filter((b) => Date.parse(b.end_at_snapshot) <= Date.parse(now) && b.can_resolve && b.status === 'confirmed');

  return (
    <div className="flex flex-col gap-5">
      {published ? (
        <Banner tone="success">
          Nabídka je aktivní. <span className="tnum">{published}</span>{' '}
          <button type="button" onClick={() => setPublished(null)} className="font-bold underline underline-offset-4">Skrýt</button>
        </Banner>
      ) : null}
      <PageHeader
        title="Přehled"
        subtitle={fresh ? 'Pár kroků a můžete nabízet volné termíny.' : `${business.display_name} · ${calendarDay(now).long}`}
        action={
          // Only once it works: before that the guide below says what is missing and leads there.
          readiness.canPublish ? (
            <Button variant="brand" size="lg" className="w-full sm:w-auto" onClick={() => setSheetOpen(true)}>
              <Plus size={20} aria-hidden="true" />Přidat volný termín
            </Button>
          ) : null
        }
      />

      {/* A request answers itself by running out, so it comes before anything the merchant could do later. */}
      <ConfirmationRequests rows={requests} />

      <SetupGuide business={business} onAddOffer={() => setSheetOpen(true)} />

      {fresh ? null : (
        <>
          {today.isPending ? <LoadingList rows={1} /> : null}
          {today.isError ? <ErrorState error={today.error} onRetry={() => today.refetch()} /> : null}
          {/* On a wide screen the rest of the day sits beside the next booking instead of under it. */}
          {today.isSuccess ? (
            <div className={cx('grid gap-5', laterToday.length > 0 && 'xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
              {next ? <NextBooking booking={next} now={now} /> : <NoBookingYet />}
              {laterToday.length ? (
                <section aria-labelledby="dnes-jeste" className="rounded-3xl bg-card p-5 shadow-card sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <h2 id="dnes-jeste" className="text-base font-extrabold text-ink">Dnes ještě přijdou</h2>
                    <Link to="/partner/rezervace" className="-mr-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-bold text-accent hover:bg-accent-soft">
                      Všechny rezervace
                      <ChevronRight size={16} aria-hidden="true" />
                    </Link>
                  </div>
                  <ul className="mt-1 divide-y divide-line">
                    {laterToday.slice(0, 4).map((booking) => (
                      <li key={booking.id} className="flex items-center gap-4 py-3">
                        <span className="tnum w-12 shrink-0 text-base font-extrabold text-ink">{clockTime(booking.start_at_snapshot)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-ink">{booking.service_name_snapshot}</span>
                          <span className="tnum block truncate text-sm text-muted">
                            {booking.customer_label} · {money(booking.merchant_payout_cents)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {laterToday.length > 4 ? (
                    <p className="tnum text-sm text-muted">a {laterToday.length - 4} další v Rezervacích</p>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : null}

          {metrics.isError ? <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} /> : null}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Stat to="/partner/nabidky" icon={<CalendarDays size={18} />} label="Aktivní nabídky" value={metrics.data?.active_offers} />
            <Stat to="/partner/rezervace" icon={<Ticket size={18} />} label="Rezervace dnes" value={metrics.data?.today_bookings} />
            <Stat to="/partner/nabidky" icon={<Armchair size={18} />} label="Volná místa" value={metrics.data?.free_seats} />
          </div>

          {/* Renamed from "Čeká na vyřízení": nothing waits on the merchant any more. These are
              the bookings still open for a no-show, and ignoring them is the correct default,
              so the card is only here when there is one. */}
          {toResolve.length ? (
            <section aria-labelledby="probehle" className="rounded-3xl bg-card p-5 shadow-card sm:p-6">
              <SectionTitle id="probehle" icon={<UserCheck size={20} />} tone="accent" title="Proběhlé rezervace" />
              <p className="mt-2 text-sm text-muted">
                Pokud zákazník dorazil, nemusíte nic dělat. Pokud nedorazil, označte ho do 24 hodin po konci termínu.
              </p>
              <ul className="mt-2 divide-y divide-line">
                {toResolve.map((booking) => (
                  <li key={booking.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="tnum text-sm font-bold text-ink">
                        {dayLabel(booking.start_at_snapshot, now)} {clockTime(booking.start_at_snapshot)} · {booking.service_name_snapshot}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                        {booking.customer_label}
                        {booking.reservation_code ? <CodeChip code={booking.reservation_code} /> : null}
                      </p>
                    </div>
                    <ResolveButtons booking={booking} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Shown only once it means something — a follower count of one or two reads as
              failure. Worded as an audience, never as "we notified them". */}
          {(metrics.data?.followers ?? 0) >= 5 ? (
            <p className="flex items-center gap-3 rounded-3xl bg-card px-5 py-4 text-base text-ink shadow-card">
              <IconTile icon={<Heart size={18} />} tone="accent" size="sm" />
              <span>
                <span className="tnum font-extrabold">{metrics.data?.followers} lidí</span> sleduje vaši provozovnu. Nový FLEK se objeví i jim.
              </span>
            </p>
          ) : null}
        </>
      )}

      {sheetOpen ? <CreateOfferSheet onPublished={setPublished} open onClose={() => setSheetOpen(false)} services={services.data ?? []} /> : null}
    </div>
  );
}

/**
 * Who comes next, as the customer's own "Tvůj termín" card reads: the one filled surface on
 * the page, the time large, and the code the customer will show.
 */
function NextBooking({ booking, now }: { booking: MerchantBooking; now: string }) {
  const starts = startsIn(booking.start_at_snapshot, now);
  return (
    <section aria-labelledby="nejblizsi" className="rounded-3xl bg-brand p-5 text-brand-ink shadow-card sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
        <h2 id="nejblizsi" className="inline-flex items-center gap-1.5">
          <CalendarClock size={14} aria-hidden="true" />
          Nejbližší rezervace
        </h2>
        <span className="tnum rounded-full bg-card/15 px-2.5 py-1 font-bold">{starts.text}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <CalendarDays size={15} aria-hidden="true" />
            {dayLabel(booking.start_at_snapshot, now)}
          </p>
          <p className="tnum mt-1.5 text-3xl leading-none font-extrabold tracking-tight">
            {clockTime(booking.start_at_snapshot)}–{clockTime(booking.end_at_snapshot)}
          </p>
        </div>
        <div className="shrink-0">
          <p className="text-xs font-medium">Vy dostanete</p>
          <p className="tnum mt-1 text-xl leading-none font-extrabold tracking-tight">{money(booking.merchant_payout_cents)}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-card/20 pt-4">
        <p className="min-w-0 text-sm">
          <span className="font-bold">{booking.service_name_snapshot}</span>
          <span className="tnum"> · {duration(booking.start_at_snapshot, booking.end_at_snapshot)} min · </span>
          {booking.customer_label}
        </p>
        {booking.reservation_code ? <CodeChip code={booking.reservation_code} tone="onBrand" /> : null}
      </div>
    </section>
  );
}

function NoBookingYet() {
  return (
    <section className="flex items-center gap-4 rounded-3xl bg-card p-5 shadow-card sm:p-6">
      <IconTile icon={<CalendarClock size={20} />} tone="accent" />
      <div className="min-w-0">
        <h2 className="text-base font-extrabold text-ink">Zatím žádná nadcházející rezervace</h2>
        <p className="mt-0.5 text-sm text-muted">Jakmile si někdo termín rezervuje, uvidíte ho tady.</p>
      </div>
    </section>
  );
}

function Stat({ to, icon, label, value }: { to: string; icon: ReactNode; label: string; value: number | undefined }) {
  return (
    <Link to={to} className="flex flex-col rounded-3xl bg-card p-3.5 shadow-card transition-transform hover:-translate-y-0.5 sm:p-5">
      <IconTile icon={icon} size="sm" />
      <span className="tnum mt-3 text-2xl leading-none font-extrabold text-ink">{value ?? '—'}</span>
      <span className="mt-1.5 text-sm leading-snug text-muted">{label}</span>
    </Link>
  );
}
