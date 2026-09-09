import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { merchantBookings, merchantLookupBooking } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { clockTime, dayBounds, dayLabel } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, Field, Input, LoadingList, Tabs } from '../../components/ui';
import { useRouter } from '../../app/router';
import { MerchantShell } from './MerchantShell';
import { ScanButton, ScanVoucherSheet } from './ScanVoucherSheet';
import { ResolveButtons } from './ResolveButtons';
import type { MerchantBooking, MerchantBookingDetail } from '../../types/database';

type Tab = 'today' | 'upcoming' | 'history';

export function MerchantBookingsPage() {
  return <MerchantShell>{(business) => <Bookings businessId={business.id} />}</MerchantShell>;
}

function Bookings({ businessId }: { businessId: string }) {
  const now = useServerNow();
  const [tab, setTab] = useState<Tab>('today');
  const { search } = useRouter();
  const scanned = (search.get('kod') ?? '').toUpperCase();
  const [code, setCode] = useState(scanned);
  const [lookup, setLookup] = useState<MerchantBookingDetail | null>(null);
  const [lookupState, setLookupState] = useState<'idle' | 'pending' | 'missing' | 'error'>('idle');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const query = useQuery({
    queryKey: ['merchant-bookings', businessId, 'all'],
    queryFn: () => merchantBookings(businessId),
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
  const unresolved = all.filter((booking) => booking.unresolved);

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
      const found = await merchantLookupBooking(searchFor);
      setLookup(found);
      setLookupState(found ? 'idle' : 'missing');
    } catch (error) {
      setLookupError(errorMessage(error));
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
          {unresolved.length} rezervací čeká na vyřízení déle než 24 hodin. Dokud je nevyřídíte, nepočítají se do
          statistik docházky.
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
      {query.isSuccess && rows.length === 0 ? (
        <EmptyState title={tab === 'today' ? 'Dnes zatím nemáte žádnou rezervaci.' : 'Tady zatím nic není.'} />
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.map((booking) => (
          <li key={booking.id} className="rounded-2xl bg-card shadow-card p-4">
            <BookingRow booking={booking} now={now} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Potvrzeno',
  completed: 'Dorazil',
  no_show: 'Nedorazil',
  cancelled_by_customer: 'Zrušil zákazník',
  cancelled_by_merchant: 'Zrušeno vámi',
};

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
        <p className="text-sm text-muted">
          {booking.customer_label} · {money(booking.price_cents)}
          {booking.payment_status === 'paid' ? (
            <span className="ml-2 font-bold text-positive">{' '}Zaplaceno předem</span>
          ) : booking.payment_status === 'refunded' ? (
            <span className="ml-2 font-bold text-muted">Vráceno</span>
          ) : null}
        </p>
        <p className="tnum mt-1 font-mono text-sm font-bold tracking-[0.1em] text-ink">{booking.reservation_code}</p>
        {showContact && detail.phone ? (
          <p className="mt-1 text-sm text-muted">
            {detail.first_name} {detail.last_name} ·{' '}
            <a className="underline underline-offset-4" href={`tel:${detail.phone}`}>
              {detail.phone}
            </a>
          </p>
        ) : null}
        <p className="mt-1 text-xs font-bold text-muted">{STATUS_LABEL[booking.status] ?? booking.status}</p>
      </div>
      {booking.status === 'confirmed' ? <ResolveButtons booking={booking} /> : null}
    </div>
  );
}
