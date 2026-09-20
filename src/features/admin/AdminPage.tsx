import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  adminAuditLog,
  adminBookings,
  adminBusinesses,
  adminMetrics,
  adminOffers,
  adminSetGooglePlaceId,
  adminSetBookingBlock,
  adminSetBusinessStatus,
  adminUserLookup,
} from '../../lib/api';
import { ArrowUpRight, Check, House, TriangleAlert } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { clockTime, dayLabel } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, Field, Input, LoadingList, Sheet, Wordmark, cx } from '../../components/ui';
import { SignOutButton } from '../auth/SignOutButton';
import { approvalBlocker, approvalChecklist } from './approvalChecklist';
import { Link, useRouter } from '../../app/router';
import { useSession } from '../auth/session';
import { LazyMap } from '../offers/LazyMap';
import { StatusBadge } from '../../components/StatusBadge';
import type { AdminAuditEntry, AdminBusiness } from '../../types/database';
import { Dac7Export } from './Dac7Export';
import { WhatsAppTemplates } from './WhatsAppTemplates';

const NAV = [
  { to: '/admin', label: 'Provozovny' },
  { to: '/admin/nabidky', label: 'Nabídky' },
  { to: '/admin/rezervace', label: 'Rezervace' },
  { to: '/admin/uzivatele', label: 'Uživatelé' },
  { to: '/admin/metriky', label: 'Metriky' },
  { to: '/admin/audit', label: 'Audit' },
  { to: '/admin/nahlaseni', label: 'Nahlášení' },
  { to: '/admin/nastaveni', label: 'Nastavení' },
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
          <Link
            to="/"
            aria-label="Zpět do zákaznické aplikace"
            title="Zpět do zákaznické aplikace"
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 text-sm font-bold sm:min-w-0 sm:underline sm:underline-offset-4"
          >
            <House size={17} aria-hidden="true" className="sm:hidden" />
            <span className="hidden sm:inline">Zpět do aplikace</span>
          </Link>
          {userId ? <SignOutButton compact /> : null}
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
                className="btn-primary"
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

const BUSINESS_FILTERS = [
  { key: 'pending', label: 'Čekají' },
  { key: 'approved', label: 'Schválené' },
  { key: 'other', label: 'Zamítnuté a pozastavené' },
  { key: 'all', label: 'Vše' },
] as const;

export function AdminBusinessesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['admin-businesses'], queryFn: () => adminBusinesses(null) });
  const [filter, setFilter] = useState<(typeof BUSINESS_FILTERS)[number]['key']>('pending');
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

  const all = query.data ?? [];
  const waiting = all.filter((business) => business.status === 'pending').length;
  const shown = all.filter((business) => {
    if (filter === 'all') return true;
    if (filter === 'other') return business.status === 'rejected' || business.status === 'suspended';
    return business.status === filter;
  });

  return (
    <AdminFrame>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Provozovny</h1>
      <p className="mt-1 text-sm text-muted">
        {waiting === 0 ? 'Nic nečeká na schválení.' : `${waiting} ${waiting === 1 ? 'čeká' : waiting < 5 ? 'čekají' : 'čeká'} na schválení.`}
      </p>
      <div className="rail mt-3 flex gap-2 overflow-x-auto pb-1">
        {BUSINESS_FILTERS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={filter === option.key}
            onClick={() => setFilter(option.key)}
            className={cx(
              'inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-bold transition-colors',
              filter === option.key ? 'border-ink bg-ink text-accent-ink' : 'border-line bg-card text-ink hover:bg-surface',
            )}
          >
            {option.label}
            {option.key === 'pending' && waiting > 0 ? ` (${waiting})` : ''}
          </button>
        ))}
      </div>
      {/* Schválení se děje rovnou z karty, bez panelu — než tohle přibylo, odmítnuté schválení
          (třeba podnik bez IČO) jen zhaslo tlačítko a vypadalo to, že se nestalo nic. */}
      {failure && !action ? (
        <div className="mt-3">
          <Banner tone="warning">{failure}</Banner>
        </div>
      ) : null}
      {query.isPending ? <LoadingList /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}

      <ul className="mt-4 flex flex-col gap-3">
        {shown.map((business) => (
          <li key={business.id} className="rounded-2xl bg-card shadow-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-bold text-ink">{business.display_name}</p>
                  <StatusBadge status={business.status} />
                </div>
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
                {/* Podívat se na provozovnu očima zákazníka je půlka rozhodnutí. */}
                <a
                  href={`/podnik/${business.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-accent underline underline-offset-4"
                >
                  Otevřít stránku podniku
                  <ArrowUpRight size={15} aria-hidden="true" />
                </a>
                {business.status_reason ? (
                  <p className="mt-1 text-sm text-danger">Důvod: {business.status_reason}</p>
                ) : null}
                <GooglePlaceConnector business={business} />
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

            <ApprovalChecks business={business} />

            <div className="mt-3 flex flex-wrap gap-2">
              {business.status !== 'approved' ? (
                <Button
                  loading={setStatus.isPending && setStatus.variables?.id === business.id}
                  disabled={Boolean(approvalBlocker(business))}
                  onClick={() => {
                    setFailure(null);
                    setStatus.mutate({ id: business.id, status: 'approved', reason: null });
                  }}
                >
                  Schválit
                </Button>
              ) : null}
              {business.status !== 'rejected' ? (
                <Button variant="secondary" onClick={() => { setFailure(null); setAction({ business, status: 'rejected' }); }}>
                  Zamítnout
                </Button>
              ) : null}
              {business.status === 'approved' ? (
                <Button variant="danger" onClick={() => { setFailure(null); setAction({ business, status: 'suspended' }); }}>
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
          <Field id="admin-reason" label="Důvod" hint="Podnik ho dostane v aplikaci a e-mailem i s kontaktem, kde se může ohradit.">
            <Input id="admin-reason" data-autofocus value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </div>
        {failure && action ? (
          <div className="mt-3">
            <Banner tone="warning">{failure}</Banner>
          </div>
        ) : null}
      </Sheet>
    </AdminFrame>
  );
}

/**
 * Co je u provozovny hotové a co chybí, na jednom místě. Bez toho admin klepal na „Schválit“
 * naslepo: server odmítne podnik bez IČO a v administraci nebylo vidět, že žádné nemá.
 */
function ApprovalChecks({ business }: { business: AdminBusiness }) {
  const items = approvalChecklist(business);
  const blocker = approvalBlocker(business);
  return (
    <div className="mt-3 rounded-xl border border-line p-3">
      <p className="text-xs font-bold text-muted">Ke kontrole</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden="true"
              className={cx('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full',
                item.ok ? 'bg-positive text-card' : item.blocking ? 'bg-danger text-card' : 'bg-warning-soft text-warning')}
            >
              {item.ok ? <Check size={11} strokeWidth={3} /> : <TriangleAlert size={11} strokeWidth={3} />}
            </span>
            <span className="min-w-0">
              <span className="font-bold text-ink">{item.label}</span>
              <span className="sr-only">{item.ok ? ' — v pořádku' : item.blocking ? ' — chybí, schválit nejde' : ' — chybí'}</span>
              <span className="text-muted"> · {item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {blocker && business.status !== 'approved' ? (
        <p className="mt-2 rounded-lg bg-danger-soft px-2.5 py-2 text-sm font-bold text-danger">
          Schválit zatím nejde — {blocker}.
        </p>
      ) : null}
    </div>
  );
}

function GooglePlaceConnector({ business }: { business: AdminBusiness }) {
  const queryClient = useQueryClient();
  const [placeId, setPlaceId] = useState(business.google_place_id ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => adminSetGooglePlaceId(business.id, placeId.trim() || null),
    onSuccess: async () => {
      setMessage(placeId.trim() ? 'Google hodnocení je propojené.' : 'Propojení bylo odebráno.');
      await queryClient.invalidateQueries({ queryKey: ['admin-businesses'] });
    },
    onError: (error) => setMessage(errorMessage(error)),
  });

  return (
    <form
      className="mt-3 max-w-xl rounded-xl bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-52 flex-1">
          <Field
            id={`google-place-${business.id}`}
            label="Google Place ID"
            hint="Hodnocení se zákazníkům načítá živě z Google Maps."
          >
            <Input
              id={`google-place-${business.id}`}
              value={placeId}
              placeholder="ChIJ…"
              autoComplete="off"
              onChange={(event) => {
                setPlaceId(event.target.value);
                setMessage(null);
              }}
            />
          </Field>
        </div>
        {/* "Odebrat" on an empty field with nothing saved removed nothing — on every venue in
            the list, since none has a Place ID yet. It only appears when there is one to drop. */}
        <Button
          type="submit"
          variant="secondary"
          loading={save.isPending}
          disabled={!placeId.trim() && !business.google_place_id}
        >
          {placeId.trim() ? 'Propojit' : 'Odebrat'}
        </Button>
      </div>
      <a
        href="https://developers.google.com/maps/documentation/places/web-service/place-id"
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-accent underline underline-offset-2"
      >
        Jak najít Place ID
      </a>
      {message ? <p role="status" className="mt-1 text-sm text-muted">{message}</p> : null}
    </form>
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
          <li key={offer.id} className="tnum flex flex-wrap items-center gap-x-1.5 gap-y-2 rounded-xl border border-line bg-card p-3 text-sm">
            <span>{dayLabel(offer.start_at, now)} {clockTime(offer.start_at)} · {offer.service_name} ·{' '}
            {money(offer.deal_price_cents)} · {offer.booked}/{offer.capacity_total}</span>
            <StatusBadge status={offer.status} />
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
          <li key={booking.id} className="tnum flex flex-wrap items-center gap-x-1.5 gap-y-2 rounded-xl border border-line bg-card p-3 text-sm">
            <span>{booking.reservation_code} · {dayLabel(booking.start_at_snapshot, now)}{' '}
            {clockTime(booking.start_at_snapshot)} · {booking.business_name_snapshot} · {money(booking.price_cents)}</span>
            <StatusBadge status={booking.status} />
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
  const [blocking, setBlocking] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const block = useMutation({
    mutationFn: (input: { id: string; blocked: boolean; override: boolean; reason?: string }) =>
      adminSetBookingBlock(input.id, input.blocked, input.override, input.reason?.trim() || null),
    onSuccess: async () => {
      setBlocking(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
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
          <li key={user.id} className="rounded-2xl bg-card shadow-card p-4">
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
                onClick={() => (user.booking_blocked
                  ? block.mutate({ id: user.id, blocked: false, override: false })
                  : setBlocking({ id: user.id, name: `${user.first_name} ${user.last_name}`.trim() || user.email }))}
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
      {block.isError && !blocking ? <Banner tone="warning">{errorMessage(block.error)}</Banner> : null}

      <Sheet
        open={Boolean(blocking)}
        onClose={() => setBlocking(null)}
        title="Zablokovat rezervace"
        footer={
          <Button
            variant="danger"
            className="w-full"
            disabled={reason.trim().length < 3}
            loading={block.isPending}
            onClick={() => blocking && block.mutate({ id: blocking.id, blocked: true, override: false, reason })}
          >
            Zablokovat
          </Button>
        }
      >
        <p className="text-sm text-muted">
          {blocking?.name} nebude moct rezervovat, dokud blokaci nezrušíte. Důvod dostane v aplikaci a e-mailem
          i s kontaktem, kde se může ohradit.
        </p>
        <div className="mt-3">
          <Field id="block-reason" label="Důvod">
            <Input id="block-reason" data-autofocus value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </div>
        {block.isError ? (
          <div className="mt-3">
            <Banner tone="warning">{errorMessage(block.error)}</Banner>
          </div>
        ) : null}
      </Sheet>
    </AdminFrame>
  );
}

const AUDIT_ACTIONS: Record<string, string> = {
  business_status_changed: 'Stav provozovny',
  booking_block_changed: 'Blokace rezervací',
  google_place_id_changed: 'Google Place ID',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'čeká', approved: 'schváleno', rejected: 'zamítnuto', suspended: 'pozastaveno',
};

/** One change in plain words: "čeká → schváleno", "blokováno → povoleno". */
function auditChange(entry: AdminAuditEntry): string {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  if (entry.action === 'business_status_changed') {
    const from = STATUS_LABELS[String(before.status)] ?? String(before.status ?? '—');
    const to = STATUS_LABELS[String(after.status)] ?? String(after.status ?? '—');
    const cancelled = Number(after.offers_cancelled ?? 0);
    const refunded = Number(after.bookings_refunded ?? 0);
    return `${from} → ${to}${cancelled ? ` · zrušeno ${cancelled} nabídek` : ''}${refunded ? ` · vráceno ${refunded} rezervací` : ''}`;
  }
  if (entry.action === 'booking_block_changed') {
    const label = (row: Record<string, unknown>) =>
      row.booking_blocked ? 'blokováno' : row.no_show_override_until ? 'odpuštěno nedostavení' : 'povoleno';
    return `${label(before)} → ${label(after)}`;
  }
  if (entry.action === 'google_place_id_changed') {
    return `${before.google_place_id ?? 'bez ID'} → ${after.google_place_id ?? 'bez ID'}`;
  }
  return `${JSON.stringify(before)} → ${JSON.stringify(after)}`;
}

export function AdminAuditPage() {
  const now = useServerNow();
  const log = useQuery({ queryKey: ['admin-audit'], queryFn: () => adminAuditLog(200) });
  return (
    <AdminFrame>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Audit změn</h1>
      <p className="mt-1 text-sm text-muted">Každá změna provedená v administraci. Záznamy nejde upravit ani smazat.</p>
      {log.isPending ? <LoadingList /> : null}
      {log.isError ? <ErrorState error={log.error} onRetry={() => log.refetch()} /> : null}
      <ul className="mt-4 flex flex-col gap-2">
        {(log.data ?? []).map((entry) => (
          <li key={entry.id} className="tnum rounded-xl border border-line bg-card p-3 text-sm">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-bold text-ink">
                {AUDIT_ACTIONS[entry.action] ?? entry.action} · {entry.target_label ?? entry.target_id ?? '—'}
              </span>
              <span className="text-muted">
                {dayLabel(entry.occurred_at, now)} {clockTime(entry.occurred_at)}
              </span>
            </p>
            <p className="mt-1 text-ink">{auditChange(entry)}</p>
            <p className="mt-1 text-muted">
              {entry.actor_email ?? 'neznámý účet'}
              {entry.reason ? ` · důvod: ${entry.reason}` : ''}
            </p>
          </li>
        ))}
      </ul>
      {log.isSuccess && log.data.length === 0 ? <EmptyState title="Zatím žádné změny." /> : null}
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
      <Dac7Export />
    </AdminFrame>
  );
}

/** Jednorázová nastavení provozu, která nepatří k žádné provozovně ani rezervaci. */
export function AdminSettingsPage() {
  return (
    <AdminFrame>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Nastavení</h1>
      <WhatsAppTemplates />
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
        <Metric label="Čeká na automatické dokončení" value={data.unresolved} />
        {/* Three amounts that must never be read as one another: what customers paid,
            what merchants are owed (their own prices) and what FLEK earned (service fees). */}
        <Metric label="Zaplatili zákazníci" value={money(data.realized_cents)} />
        <Metric label="Výplaty podnikům" value={money(data.merchant_payout_cents)} />
        <Metric label="Výnos FLEK (poplatky)" value={money(data.service_fee_cents)} />
      </dl>

      <section className="rounded-2xl bg-card shadow-card p-4">
        <h2 className="text-base font-bold text-ink">Cesta podniku</h2>
        <p className="mt-1 text-sm text-muted">Kde noví partneři končí, než mají prvního zákazníka.</p>
        <ol className="tnum mt-3 flex flex-col gap-1 text-sm">
          {[
            ['Založená provozovna', data.merchant_funnel.business_created],
            ['Schválená', data.merchant_funnel.business_approved],
            ['Má službu', data.merchant_funnel.with_service],
            ['Vystavila FLEK', data.merchant_funnel.with_offer],
            ['Má rezervaci', data.merchant_funnel.with_booking],
            ['Má dokončenou rezervaci', data.merchant_funnel.with_completed_booking],
          ].map(([label, value]) => (
            <li key={label} className="flex justify-between gap-3">
              <span>{label}</span>
              <span className="font-bold text-ink">{value}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl bg-card shadow-card p-4">
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

      <section className="rounded-2xl bg-card shadow-card p-4">
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
    <div className="rounded-2xl bg-card shadow-card p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum mt-1 text-xl font-extrabold text-ink">{value}</dd>
    </div>
  );
}
