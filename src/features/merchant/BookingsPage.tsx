import { ChevronDown } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { merchantBookings, merchantLookupBooking } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { clockTime, dayBounds, dayLabel } from '../../lib/time';
import { serverNow, useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, Field, Input, LoadingList, Tabs } from '../../components/ui';
import { useRouter } from '../../app/router';
import { MerchantShell } from './MerchantShell';
import { ScanButton, ScanVoucherSheet } from './ScanVoucherSheet';
import { ResolveButtons } from './ResolveButtons';
import { StatusBadge } from '../../components/StatusBadge';
import type { MerchantBooking, MerchantBookingDetail } from '../../types/database';

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
  });

  const day = dayBounds(now);
  const all = query.data ?? [];
  const rows = all.filter((booking) => {
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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Rezervace</h1>

      <form
        className="rounded-2xl bg-card shadow-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
      >
        <Field id="lookup" label="Zadejte rezervační kód">
          <div className="flex gap-2">
            <Input
              id="lookup"
              className="tnum font-mono uppercase"
              placeholder="FLEK-XXXXXX"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            <Button type="submit" loading={lookupState === 'pending'}>
              Najít
            </Button>
          </div>
        </Field>
        {/* Typing six characters off a customer's screen is the step that goes wrong at a
            busy counter, so the camera sits next to the field — never instead of it, because
            a denied permission or a cracked screen still has to be workable. */}
        <div className="mt-3">
          <ScanButton onClick={() => setScanOpen(true)} />
        </div>
        {lookupState === 'missing' ? (
          <p className="mt-3 text-sm text-muted">Kód nenašel žádnou rezervaci ve vaší provozovně.</p>
        ) : null}
        {lookupState === 'error' && lookupError ? (
          <div className="mt-3">
            <Banner tone="warning">{lookupError}</Banner>
          </div>
        ) : null}
        {lookup ? (
          <div className="mt-4 border-t border-line pt-4">
            <BookingRow booking={lookup} now={now} showContact />
          </div>
        ) : null}
      </form>

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
        value={tab}
        onChange={setTab}
        items={[
          { value: 'today', label: 'Dnes' },
          { value: 'upcoming', label: 'Nadcházející' },
          { value: 'history', label: 'Historie' },
        ]}
      />

      {query.isPending ? <LoadingList /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {query.isSuccess && (tab === 'history' ? rows.length === 0 : !rows.some((booking) => !isCancelled(booking))) ? (
        <EmptyState title={tab === 'today' ? 'Dnes zatím nemáte žádnou platnou rezervaci.' : tab === 'upcoming' ? 'Žádná nadcházející rezervace.' : 'Tady zatím nic není.'} />
      ) : null}

      {/*
        Live bookings first. A customer cancellation used to sit in the same list as the
        people actually coming in, so on a busy day the next arrival was buried among rows
        that need nothing from the merchant. History keeps every row in order.
      */}
      <ul className="flex flex-col gap-3">
        {(tab === 'history' ? rows : rows.filter((booking) => !isCancelled(booking))).map((booking) => (
          <li key={booking.id} className="rounded-2xl bg-card shadow-card p-4">
            <BookingRow booking={booking} now={now} />
          </li>
        ))}
      </ul>
      {tab !== 'history' && rows.some(isCancelled) ? (
        <details className="group rounded-2xl border border-line bg-card px-4">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-sm font-bold text-muted">
            Zrušené ({rows.filter(isCancelled).length})
            <ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" />
          </summary>
          <ul className="flex flex-col gap-3 border-t border-line py-3">
            {rows.filter(isCancelled).map((booking) => (
              <li key={booking.id}>
                <BookingRow booking={booking} now={now} />
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
  return booking.status === 'cancelled_by_customer' || booking.status === 'cancelled_by_merchant';
}

function BookingRow({
  booking,
  now,
  showContact,
}: {
  booking: MerchantBooking | MerchantBookingDetail;
  now: string;
  showContact?: boolean;
}) {
  const detail = booking as MerchantBookingDetail;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="tnum text-sm font-bold text-ink">
          {dayLabel(booking.start_at_snapshot, now)} {clockTime(booking.start_at_snapshot)}–
          {clockTime(booking.end_at_snapshot)}
        </p>
        <p className="text-base font-bold text-ink">{booking.service_name_snapshot}</p>
        {/* The merchant's own amount — their price, fixed when the customer booked. What the
            customer paid includes FLEK's fee and is not the merchant's number. */}
        {/* A cancelled booking was refunded in full, so it pays the merchant nothing — showing
            "Vy dostanete 365 Kč" on it promised money that will never arrive. */}
        <p className="text-sm text-muted">
          {booking.customer_label} ·{' '}
          {booking.status === 'cancelled_by_customer' || booking.status === 'cancelled_by_merchant' ? (
            'bez výplaty'
          ) : (
            <>
              Vy dostanete <span className="tnum font-bold text-ink">{money(booking.merchant_payout_cents)}</span>
            </>
          )}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatusBadge status={booking.status} />
          {booking.payment_status ? (
            <StatusBadge
              status={booking.payment_status}
              label={booking.payment_status === 'pending' ? 'Čeká na platbu' : undefined}
            />
          ) : null}
        </div>
        <p className="tnum mt-1 font-mono text-sm font-bold tracking-[0.1em] text-ink">{booking.reservation_code}</p>
        {showContact && detail.phone ? (
          <p className="mt-1 text-sm text-muted">
            {detail.first_name} {detail.last_name} ·{' '}
            <a className="underline underline-offset-4" href={`tel:${detail.phone}`}>
              {detail.phone}
            </a>
          </p>
        ) : null}
      </div>
      {booking.status === 'confirmed' ? <ResolveButtons booking={booking} /> : null}
    </div>
  );
}
