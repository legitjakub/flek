import { CalendarClock, Camera, CheckCircle2, ChevronDown, ScanLine, Ticket, XCircle } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { merchantBookings, merchantLookupBooking } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { clockTime, dayBounds, dayKey, dayLabel } from '../../lib/time';
import { serverNow, useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, Field, IconTile, Input, LoadingList, Tabs } from '../../components/ui';
import { useRouter } from '../../app/router';
import { MerchantShell } from './MerchantShell';
import { ScanVoucherSheet } from './ScanVoucherSheet';
import { NoShowAction, noShowHint, noShowWindow } from './ResolveButtons';
import { StatusBadge, statusMeta, type AppStatus } from '../../components/StatusBadge';
import { CodeChip, DayHeading, PageHeader, SectionTitle, TimeCard, dayHeading, groupByDay, type Tone } from './partnerUi';
import type { MerchantBooking, MerchantBookingDetail } from '../../types/database';
import { ConfirmationRequests, isConfirmationRequest, visibleToMerchant } from './ConfirmationRequests';

type Tab = 'today' | 'upcoming' | 'history';

export function MerchantBookingsPage() {
  return <MerchantShell>{(business) => <Bookings businessId={business.id} />}</MerchantShell>;
}

function Bookings({ businessId }: { businessId: string }) {
  const now = useServerNow();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('today');
  const { search } = useRouter();
  const scanned = (search.get('kod') ?? '').toUpperCase();
  const [code, setCode] = useState(scanned);
  const [lookupCode, setLookupCode] = useState('');
  const lookupQuery = useQuery({ queryKey: ['merchant-booking-lookup', businessId, lookupCode], queryFn: () => merchantLookupBooking(lookupCode), enabled: Boolean(lookupCode) });
  const lookup = lookupQuery.data?.business_id === businessId ? lookupQuery.data : null;
  const [lookupState, setLookupState] = useState<'idle' | 'pending' | 'missing' | 'error'>('idle');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  /*
   * The last 90 days, not every booking the venue ever had: the list was fetched whole on each
   * visit and each window focus, and filtered in the browser. Older history is one tap away.
   */
  const [historyDays, setHistoryDays] = useState(90);
  const query = useQuery({
    queryKey: ['merchant-bookings', businessId, 'all', historyDays],
    queryFn: () => merchantBookings(businessId, dayBounds(serverNow(), -historyDays).from),
    refetchOnWindowFocus: true,
    refetchInterval: (current) => current.state.data?.some((row) => row.status === 'pending_merchant' || row.status === 'capturing') ? 3_000 : false,
  });

  const day = dayBounds(now);
  const all = (query.data ?? []).filter(visibleToMerchant);
  // Requests with a clock running sit above everything else, never inside a tab where they could be missed.
  const requests = all.filter(isConfirmationRequest);
  const rows = all.filter((booking) => !isConfirmationRequest(booking)).filter((booking) => {
    const start = Date.parse(booking.start_at_snapshot);
    if (tab === 'today') return start >= Date.parse(day.from) && start < Date.parse(day.until);
    if (tab === 'upcoming') return start >= Date.parse(day.until);
    return start < Date.parse(day.from);
  });
  const unresolved = all.filter((booking) => booking.status === 'confirmed' && Date.parse(booking.resolution_deadline) <= Date.parse(now));

  // Arriving from a scanned voucher: look the code up straight away instead of making the
  // merchant press a button they never chose to see.
  useEffect(() => {
    if (!scanned) return;
    setCode(scanned);
    void find(scanned);
    // The scanned code is the trigger, and it is passed explicitly: state has not been
    // committed yet at this point, so reading it here would search for the previous code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanned]);

  async function find(searchFor: string = code) {
    setLookupState('pending');
    setLookupError(null);
    try {
      setLookupCode('');
      const found = await queryClient.fetchQuery({ queryKey: ['merchant-booking-lookup', businessId, searchFor], queryFn: () => merchantLookupBooking(searchFor), staleTime: 0 });
      setLookupCode(searchFor);

      setLookupState(found ? 'idle' : 'missing');
    } catch (error) {
      setLookupError(errorMessage(error, 'merchant'));
      setLookupState('error');
    }
  }

  const live = (booking: MerchantBooking) => !isCancelled(booking);
  const todayCount = all.filter((b) => !isConfirmationRequest(b) && live(b) && Date.parse(b.start_at_snapshot) >= Date.parse(day.from) && Date.parse(b.start_at_snapshot) < Date.parse(day.until)).length;
  const upcomingCount = all.filter((b) => !isConfirmationRequest(b) && live(b) && Date.parse(b.start_at_snapshot) >= Date.parse(day.until)).length;
  // History reads back from yesterday; what is ahead reads forward from now.
  const shown = tab === 'history' ? [...rows].reverse() : rows.filter(live);
  const cancelled = tab === 'history' ? [] : rows.filter(isCancelled);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Rezervace" subtitle="Kdo k vám přijde, kdy a kolik za to dostanete." />

      <ConfirmationRequests rows={requests} />

      <section aria-labelledby="overit" className="rounded-3xl bg-card p-5 shadow-card sm:p-6">
        <SectionTitle id="overit" icon={<ScanLine size={20} />} title="Ověřit rezervaci" />
        <p className="mt-2 text-sm text-muted">Načtěte QR kód z telefonu zákazníka, nebo kód opište.</p>
        {/* Typing six characters off a customer's screen is the step that goes wrong at a
            busy counter, so the camera comes first — never instead of the field, because a
            denied permission or a cracked screen still has to be workable. */}
        <Button variant="brand" size="lg" className="mt-4 w-full sm:w-auto" onClick={() => setScanOpen(true)}>
          <Camera size={20} aria-hidden="true" />
          Načíst QR kód
        </Button>
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void find();
          }}
        >
          <Field id="lookup" label="Nebo zadejte rezervační kód">
            <div className="flex gap-2">
              <Input
                id="lookup"
                className="tnum font-mono uppercase"
                placeholder="FLEK-XXXXXX"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
              <Button type="submit" variant="secondary" loading={lookupState === 'pending'}>
                Ověřit
              </Button>
            </div>
          </Field>
        </form>
        {lookupState === 'missing' ? (
          <p role="status" className="mt-3 text-sm text-muted">Kód nenašel žádnou rezervaci ve vaší provozovně.</p>
        ) : null}
        {lookupState === 'error' && lookupError ? (
          <div className="mt-3">
            <Banner tone="warning">{lookupError}</Banner>
          </div>
        ) : null}
      </section>

      {lookup ? <LookupResult booking={lookup} now={now} /> : null}

      <ScanVoucherSheet
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onCode={(scannedCode) => {
          setScanOpen(false);
          setCode(scannedCode);
          void find(scannedCode);
        }}
      />

      {unresolved.length > 0 ? (
        <Banner tone="warning">
          {unresolved.length} rezervací se automaticky dokončuje. Nemusíte je ručně potvrzovat.
        </Banner>
      ) : null}

      <Tabs
        label="Rezervace"
        pill
        value={tab}
        onChange={setTab}
        items={[
          { value: 'today', label: 'Dnes', count: query.isSuccess ? todayCount : undefined },
          { value: 'upcoming', label: 'Nadcházející', count: query.isSuccess ? upcomingCount : undefined },
          { value: 'history', label: 'Historie' },
        ]}
      />

      {query.isPending ? <LoadingList /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {query.isSuccess && shown.length === 0 ? (
        <EmptyState
          icon={<Ticket size={24} />}
          title={tab === 'today' ? 'Dnes zatím nemáte žádnou platnou rezervaci.' : tab === 'upcoming' ? 'Žádná nadcházející rezervace.' : 'Tady zatím nic není.'}
          body={tab === 'history' ? undefined : 'Jakmile si někdo termín rezervuje, objeví se tady.'}
        />
      ) : null}

      {/*
        Live bookings first. A customer cancellation used to sit in the same list as the
        people actually coming in, so on a busy day the next arrival was buried among rows
        that need nothing from the merchant. History keeps every row in order.
      */}
      {groupByDay(shown, (booking) => booking.start_at_snapshot).map((group) => (
        <section key={group.key} className="flex flex-col gap-3" aria-label={dayHeading(group.start, now)}>
          <DayHeading instant={group.start} now={now} />
          <ul className="grid gap-3 xl:grid-cols-2">
            {group.rows.map((booking) => (
              <li key={booking.id}>
                <BookingCard booking={booking} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {cancelled.length ? (
        <details className="group rounded-3xl bg-card px-5 shadow-card">
          <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between text-sm font-bold text-muted [&::-webkit-details-marker]:hidden">
            Zrušené ({cancelled.length})
            <ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" />
          </summary>
          <ul className="flex flex-col divide-y divide-line border-t border-line">
            {cancelled.map((booking) => (
              <li key={booking.id} className="flex items-start gap-4 py-3">
                <span className="tnum w-12 shrink-0 text-sm font-extrabold text-muted">{clockTime(booking.start_at_snapshot)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">{booking.service_name_snapshot}</span>
                  <span className="block text-sm text-muted">
                    {dayLabel(booking.start_at_snapshot, now)} · {booking.customer_label} · {bookingState(booking).label}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {tab === 'history' && query.isSuccess && historyDays < 730 ? (
        <Button variant="secondary" className="self-center" loading={query.isFetching} onClick={() => setHistoryDays((days) => days * 4)}>
          Načíst starší rezervace
        </Button>
      ) : null}
    </div>
  );
}

function isCancelled(booking: MerchantBooking): boolean {
  return ['cancelled_by_customer', 'cancelled_by_merchant', 'expired', 'rejected', 'payment_failed'].includes(booking.status);
}

/**
 * One line for where a booking stands, instead of two badges side by side: the booking and,
 * once it was agreed, its money ("Potvrzeno · zaplaceno").
 */
function bookingState(booking: MerchantBooking): { label: string; tone: Tone; status: AppStatus } {
  // A request that never became a booking has no payment of the merchant's to show.
  const neverAgreed = booking.confirmation_version === 1 && !booking.confirmed_at;
  const own = booking.status === 'completed' ? 'Zákazník dorazil' : booking.status === 'no_show' ? 'Nedorazil' : booking.status === 'rejected' ? 'Odmítnuto' : statusMeta(booking.status).label;
  const paid = booking.payment_status && !neverAgreed
    ? booking.payment_status === 'pending' ? 'čeká na platbu' : statusMeta(booking.payment_status).label.toLocaleLowerCase('cs-CZ')
    : null;
  const tone: Tone = isCancelled(booking) ? 'muted' : booking.status === 'completed' ? 'positive' : booking.status === 'no_show' ? 'danger' : 'brand';
  return { label: paid ? `${own} · ${paid}` : own, tone, status: booking.status };
}

function BookingCard({ booking, now, showContact = false }: { booking: MerchantBooking | MerchantBookingDetail; now: string; showContact?: boolean }) {
  const detail = booking as MerchantBookingDetail;
  const terminal = isCancelled(booking);
  const state = bookingState(booking);
  const hint = noShowHint(booking, Date.parse(now));
  const canMark = booking.status === 'confirmed' && noShowWindow(booking, Date.parse(now)).canResolve;
  return (
    <TimeCard
      start={booking.start_at_snapshot}
      end={booking.end_at_snapshot}
      tone={state.tone}
      dimmed={terminal}
      actions={canMark ? <NoShowAction booking={booking} /> : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base leading-snug font-extrabold text-ink">{booking.service_name_snapshot}</h3>
          <p className="text-sm text-muted">{booking.customer_label}</p>
        </div>
        {/* The merchant's own amount — their price, fixed when the customer booked. A cancelled
            booking was refunded in full and pays the merchant nothing. */}
        <p className="tnum shrink-0 text-right text-base font-extrabold text-ink">
          {terminal ? <span className="text-sm font-bold text-muted">bez výplaty</span> : money(booking.merchant_payout_cents)}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={state.status} label={state.label} />
        {['confirmed', 'completed', 'no_show'].includes(booking.status) && booking.reservation_code ? (
          <CodeChip code={booking.reservation_code} />
        ) : null}
      </div>
      {showContact && detail.phone ? (
        <p className="mt-1 text-sm text-muted">
          {detail.first_name} {detail.last_name} ·{' '}
          <a className="tnum inline-flex min-h-11 items-center font-bold text-ink underline underline-offset-4" href={`tel:${detail.phone}`}>
            {detail.phone}
          </a>
        </p>
      ) : null}
      {hint ? <p className="mt-2 text-xs leading-relaxed text-muted">{hint}</p> : null}
    </TimeCard>
  );
}

/**
 * What the counter needs to know after a scan, first and in colour: is this booking good for
 * now? Then the booking itself, the same card as in the list, with the customer's contact.
 */
function LookupResult({ booking, now }: { booking: MerchantBookingDetail; now: string }) {
  const today = dayKey(booking.start_at_snapshot) === dayKey(now);
  const verdict = booking.status === 'confirmed'
    ? today
      ? {
        tone: 'positive' as const,
        icon: <CheckCircle2 size={20} />,
        title: 'Platná rezervace na dnes',
        body: booking.payment_status === 'paid' ? 'Zákazník má zaplaceno. Nemusíte nic dalšího dělat.' : 'Rezervace je potvrzená.',
      }
      : { tone: 'warning' as const, icon: <CalendarClock size={20} />, title: `Platná, ale na ${dayLabel(booking.start_at_snapshot, now).toLocaleLowerCase('cs-CZ')} ${clockTime(booking.start_at_snapshot)}`, body: 'Rezervace je na jiný den, než je dnes.' }
    : booking.status === 'completed'
      ? { tone: 'accent' as const, icon: <CheckCircle2 size={20} />, title: 'Rezervace už proběhla', body: 'Zákazník tento kód už využil.' }
      : booking.status === 'no_show'
        ? { tone: 'danger' as const, icon: <XCircle size={20} />, title: 'Označeno: nedorazil', body: 'Termín už proběhl a zákazník je označený, že nedorazil.' }
        : { tone: 'danger' as const, icon: <XCircle size={20} />, title: 'Tahle rezervace neplatí', body: bookingState(booking).label };
  return (
    <section aria-labelledby="nalezena" aria-live="polite" className="flex flex-col gap-3">
      <div className="flex items-center gap-3 px-1">
        <IconTile icon={verdict.icon} tone={verdict.tone} />
        <div className="min-w-0">
          <h2 id="nalezena" className="text-base font-extrabold text-ink">{verdict.title}</h2>
          <p className="text-sm text-muted">{verdict.body}</p>
        </div>
      </div>
      <BookingCard booking={booking} now={now} showContact />
    </section>
  );
}
