import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  adminBookings,
  adminBusinesses,
  adminMetrics,
  adminOffers,
  adminSetBookingBlock,
  adminSetBusinessStatus,
  adminUserLookup,
} from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { clockTime, dayLabel } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, Field, Input, LoadingList, Sheet, Wordmark } from '../../components/ui';
import { Link, useRouter } from '../../app/router';
import { useSession } from '../auth/session';
import { LazyMap } from '../offers/LazyMap';
import type { AdminBusiness } from '../../types/database';

const NAV = [
  { to: '/admin', label: 'Provozovny' },
  { to: '/admin/nabidky', label: 'Nabídky' },
  { to: '/admin/rezervace', label: 'Rezervace' },
  { to: '/admin/uzivatele', label: 'Uživatelé' },
  { to: '/admin/metriky', label: 'Metriky' },
];

/** Routing-only guard. Every admin RPC re-checks `is_admin()` in SQL. */
export function AdminFrame({ children }: { children: ReactNode }) {
  const { path } = useRouter();
  const { admin, userId, ready } = useSession();

  return (
    <div className="min-h-dvh bg-ink/3">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/admin">
            <Wordmark suffix="Admin" />
          </Link>
          <Link to="/" className="text-sm font-bold underline underline-offset-4">
            Zpět do aplikace
          </Link>
        </div>
        <nav aria-label="Administrace" className="mx-auto w-full max-w-5xl overflow-x-auto px-4">
          <ul className="flex gap-1 pb-2">
            {NAV.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={path === item.to ? 'page' : undefined}
                  className={`inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-bold whitespace-nowrap ${
                    path === item.to ? 'bg-ink text-surface' : 'text-muted hover:text-ink'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-5">
        {!ready ? (
          <LoadingList rows={2} />
        ) : !userId ? (
          <EmptyState
            title="Přihlaste se"
            action={
              <Link
                to="/prihlaseni?returnTo=%2Fadmin"
                className="inline-flex min-h-11 items-center rounded-xl bg-action px-4 font-bold text-accent-ink"
              >
                Přihlásit se
              </Link>
            }
          />
        ) : !admin ? (
          <EmptyState title="K administraci nemáte oprávnění." />
        ) : (
          children
        )}
      </main>
    </div>
  );
}

export function AdminBusinessesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['admin-businesses'], queryFn: () => adminBusinesses(null) });
  const [action, setAction] = useState<{ business: AdminBusiness; status: 'rejected' | 'suspended' } | null>(null);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: string; reason: string | null }) =>
      adminSetBusinessStatus(input.id, input.status, input.reason),
    onSuccess: async () => {
      setAction(null);
      setReason('');
      setFailure(null);
      await queryClient.invalidateQueries();
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  return (
    <AdminFrame>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Provozovny</h1>
      {query.isPending ? <LoadingList /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}

      <ul className="mt-4 flex flex-col gap-3">
        {(query.data ?? []).map((business) => (
          <li key={business.id} className="rounded-2xl border border-line bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-bold text-ink">
                  {business.display_name}{' '}
                  <span className="text-xs font-bold text-muted uppercase">{business.status}</span>
                </p>
                <p className="text-sm text-muted">
                  {business.address_line}, {business.postal_code} {business.city}
                </p>
                <p className="text-sm text-muted">
                  {business.phone} · {business.public_email}
                  {business.owner_email ? ` · vlastník ${business.owner_email}` : ''}
                </p>
                <p className="text-sm text-muted">
                  {business.services.length} služeb · {business.upcoming_offers} nadcházejících nabídek
                </p>
                {business.status_reason ? (
                  <p className="mt-1 text-sm text-accent">Důvod: {business.status_reason}</p>
                ) : null}
              </div>
              <LazyMap
                className="h-32 w-full max-w-xs overflow-hidden rounded-xl border border-line"
                center={{ lat: business.latitude, lng: business.longitude }}
                zoom={14}
                interactive={false}
                markers={[{ id: business.id, lat: business.latitude, lng: business.longitude, label: '1' }]}
                ariaLabel={`Poloha: ${business.display_name}`}
              />
            </div>

            {business.services.length ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {business.services.map((service) => (
                  <li key={service.id} className="tnum rounded-lg bg-surface px-2 py-1 text-xs text-muted">
                    {service.name} · {service.duration_minutes} min · {money(service.normal_price_cents)}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {business.status !== 'approved' ? (
                <Button
                  loading={setStatus.isPending && setStatus.variables?.id === business.id}
                  onClick={() => setStatus.mutate({ id: business.id, status: 'approved', reason: null })}
                >
                  Schválit
                </Button>
              ) : null}
              {business.status !== 'rejected' ? (
                <Button variant="secondary" onClick={() => setAction({ business, status: 'rejected' })}>
                  Zamítnout
                </Button>
              ) : null}
              {business.status === 'approved' ? (
                <Button variant="danger" onClick={() => setAction({ business, status: 'suspended' })}>
                  Pozastavit
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <Sheet
        open={Boolean(action)}
        onClose={() => setAction(null)}
        title={action?.status === 'suspended' ? 'Pozastavit provozovnu' : 'Zamítnout provozovnu'}
        footer={
          <Button
            className="w-full"
            disabled={reason.trim().length < 3}
            loading={setStatus.isPending}
            onClick={() => action && setStatus.mutate({ id: action.business.id, status: action.status, reason })}
          >
            Potvrdit
          </Button>
        }
      >
        {action?.status === 'suspended' ? (
          <Banner tone="warning">
            Pozastavením okamžitě zmizí všechny budoucí nabídky ({action.business.upcoming_offers}) a nadcházející
            potvrzené rezervace se zákazníkům zruší s uvedeným důvodem.
          </Banner>
        ) : null}
        <div className="mt-3">
          <Field id="admin-reason" label="Důvod">
            <Input id="admin-reason" data-autofocus value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </div>
        {failure ? (
          <div className="mt-3">
            <Banner tone="warning">{failure}</Banner>
          </div>
        ) : null}
      </Sheet>
    </AdminFrame>
  );
}

export function AdminOffersPage() {
  const [query, setQuery] = useState('');
  const now = useServerNow();
  const offers = useQuery({ queryKey: ['admin-offers', query], queryFn: () => adminOffers(query) });
  return (
    <AdminFrame>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Nabídky</h1>
      <div className="mt-4 max-w-sm">
        <Field id="offer-search" label="Hledat podle služby nebo provozovny">
          <Input id="offer-search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </Field>
      </div>
      {offers.isPending ? <LoadingList /> : null}
      {offers.isError ? <ErrorState error={offers.error} onRetry={() => offers.refetch()} /> : null}
      <ul className="mt-4 flex flex-col gap-2">
        {(offers.data ?? []).map((offer) => (
          <li key={offer.id} className="tnum rounded-xl border border-line bg-card p-3 text-sm">
            {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)} · {offer.service_name} ·{' '}
            {money(offer.deal_price_cents)} · {offer.booked}/{offer.capacity_total} · {offer.status}
          </li>
        ))}
      </ul>
      {offers.isSuccess && offers.data.length === 0 ? <EmptyState title="Nic nenalezeno." /> : null}
    </AdminFrame>
  );
}

export function AdminBookingsPage() {
  const [query, setQuery] = useState('');
  const now = useServerNow();
  const bookings = useQuery({ queryKey: ['admin-bookings', query], queryFn: () => adminBookings(query) });
  return (
    <AdminFrame>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Rezervace</h1>
      <div className="mt-4 max-w-sm">
        <Field id="booking-search" label="Hledat podle kódu nebo provozovny">
          <Input id="booking-search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </Field>
      </div>
      {bookings.isPending ? <LoadingList /> : null}
      {bookings.isError ? <ErrorState error={bookings.error} onRetry={() => bookings.refetch()} /> : null}
      <ul className="mt-4 flex flex-col gap-2">
        {(bookings.data ?? []).map((booking) => (
          <li key={booking.id} className="tnum rounded-xl border border-line bg-card p-3 text-sm">
            {booking.reservation_code} · {dayLabel(booking.start_at_snapshot, now)}{' '}
            {clockTime(booking.start_at_snapshot)} · {booking.business_name_snapshot} · {money(booking.price_cents)} ·{' '}
            {booking.status}
          </li>
        ))}
      </ul>
      {bookings.isSuccess && bookings.data.length === 0 ? <EmptyState title="Nic nenalezeno." /> : null}
    </AdminFrame>
  );
}

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState('');
  const users = useQuery({
    queryKey: ['admin-users', submitted],
    queryFn: () => adminUserLookup(submitted),
    enabled: submitted.includes('@'),
  });
  const block = useMutation({
    mutationFn: (input: { id: string; blocked: boolean; override: boolean }) =>
      adminSetBookingBlock(input.id, input.blocked, input.override),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  return (
    <AdminFrame>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Uživatelé</h1>
      <form
        className="mt-4 flex max-w-md items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(email.trim());
        }}
      >
        <div className="flex-1">
          <Field id="user-email" label="E-mail uživatele">
            <Input id="user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
        </div>
        <Button type="submit">Najít</Button>
      </form>

      {users.isError ? <ErrorState error={users.error} onRetry={() => users.refetch()} /> : null}
      {users.isSuccess && users.data.length === 0 ? <EmptyState title="Uživatel nenalezen." /> : null}

      <ul className="mt-4 flex flex-col gap-3">
        {(users.data ?? []).map((user) => (
          <li key={user.id} className="rounded-2xl border border-line bg-card p-4">
            <p className="text-base font-bold text-ink">
              {user.first_name} {user.last_name}
            </p>
            <p className="text-sm text-muted">
              {user.email} · {user.phone ?? 'bez telefonu'} · nedorazil {user.no_show_count}×
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant={user.booking_blocked ? 'primary' : 'danger'}
                loading={block.isPending}
                onClick={() => block.mutate({ id: user.id, blocked: !user.booking_blocked, override: false })}
              >
                {user.booking_blocked ? 'Zrušit blokaci rezervací' : 'Zablokovat rezervace'}
              </Button>
              <Button
                variant="secondary"
                loading={block.isPending}
                onClick={() => block.mutate({ id: user.id, blocked: false, override: true })}
              >
                Odpustit nedostavení na 60 dní
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted">{user.bookings.length} rezervací</p>
          </li>
        ))}
      </ul>
    </AdminFrame>
  );
}

export function AdminMetricsPage() {
  const metrics = useQuery({ queryKey: ['admin-metrics'], queryFn: adminMetrics });
  return (
    <AdminFrame>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Metriky pilotu</h1>
      {metrics.isPending ? <LoadingList rows={2} /> : null}
      {metrics.isError ? <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} /> : null}
      {metrics.data ? <MetricsBody data={metrics.data} /> : null}
    </AdminFrame>
  );
}

function MetricsBody({ data }: { data: NonNullable<Awaited<ReturnType<typeof adminMetrics>>> }) {
  const fillRate = data.published_capacity > 0 ? Math.round((data.booked_capacity * 100) / data.published_capacity) : 0;
  const resolved = data.completed + data.no_show;
  const showUp = resolved > 0 ? Math.round((data.completed * 100) / resolved) : 0;

  return (
    <div className="mt-4 flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Naplněnost" value={`${fillRate} %`} />
        <Metric
          label="Medián do 1. rezervace"
          value={data.median_minutes_to_first_booking == null ? '—' : `${Math.round(data.median_minutes_to_first_booking)} min`}
        />
        <Metric
          label="Opakující se podniky"
          value={`${data.repeat_merchants}/${data.approved_businesses}`}
        />
        <Metric label="Opakující se zákazníci" value={`${data.repeat_customers}/${data.customers}`} />
        <Metric label="Míra dostavení" value={`${showUp} %`} />
        <Metric label="Nevyřízené" value={data.unresolved} />
        <Metric label="Realizovaná hodnota" value={money(data.realized_cents)} />
        <Metric label="Odhad provize" value={money(Math.round(data.commission_cents / 100) * 100)} />
      </dl>

      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="text-base font-bold text-ink">Naplněnost podle kategorie</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {data.fill_rate_by_category.map((row) => (
            <li key={row.category} className="tnum flex justify-between">
              <span>{row.category}</span>
              <span>
                {row.published > 0 ? Math.round((row.booked * 100) / row.published) : 0} % ({row.booked}/{row.published})
              </span>
            </li>
          ))}
          {data.fill_rate_by_category.length === 0 ? <li className="text-muted">Zatím žádná data.</li> : null}
        </ul>
      </section>

      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="text-base font-bold text-ink">Trychtýř</h2>
        <ul className="tnum mt-2 flex flex-col gap-1 text-sm">
          <li className="flex justify-between">
            <span>Zobrazení nabídky</span>
            <span>{data.funnel.offer_viewed}</span>
          </li>
          <li className="flex justify-between">
            <span>Zahájená rezervace</span>
            <span>{data.funnel.booking_started}</span>
          </li>
          <li className="flex justify-between">
            <span>Dokončená rezervace</span>
            <span>{data.funnel.booking_created}</span>
          </li>
        </ul>
        <h3 className="mt-4 text-sm font-bold text-ink">Neúspěšné rezervace</h3>
        <ul className="tnum mt-1 flex flex-col gap-1 text-sm">
          {data.failures.map((failure) => (
            <li key={failure.code} className="flex justify-between">
              <span>{failure.code}</span>
              <span>{failure.count}</span>
            </li>
          ))}
          {data.failures.length === 0 ? <li className="text-muted">Zatím žádná.</li> : null}
        </ul>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum mt-1 text-xl font-extrabold text-ink">{value}</dd>
    </div>
  );
}
