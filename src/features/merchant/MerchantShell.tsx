import { LayoutDashboard, CalendarDays, Ticket, Scissors, Store, ChartNoAxesColumn, Ellipsis, ArrowUpRight, Eye, BellRing, X } from 'lucide-react';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Banner, LoadingList, ErrorState, Wordmark, Sheet } from '../../components/ui';
import { SignOutButton } from '../auth/SignOutButton';
import { Link, useRouter } from '../../app/router';
import { useSession } from '../auth/session';
import { useMyBusinesses } from './useBusiness';
import { PartnerLanding } from './PartnerLanding';
import { useBookingAlerts, useUnreadBookings, type BookingAlert } from './useBookingAlerts';
import { money } from '../../lib/format';
import { clockTime, dayLabel } from '../../lib/time';
import { serverNow, useServerNow } from '../../lib/clock';
import { timeLeft } from '../bookings/confirmationView';
import type { Business } from '../../types/database';
import { NotificationBell } from '../notifications/Notifications';

const NAV = [
  { to: '/partner', label: 'Přehled', icon: LayoutDashboard },
  { to: '/partner/nabidky', label: 'Nabídky', icon: CalendarDays },
  { to: '/partner/rezervace', label: 'Rezervace', icon: Ticket },
  { to: '/partner/sluzby', label: 'Služby', icon: Scissors },
  { to: '/partner/provozovna', label: 'Provozovna', icon: Store },
  { to: '/partner/metriky', label: 'Metriky', icon: ChartNoAxesColumn },
];

/**
 * Merchant surface: visibly the same product, deliberately a different skin, and vykání
 * throughout (the customer app tyká).
 */
export function MerchantShell({ children }: { children: (business: Business) => ReactNode }) {
  const { path } = useRouter();
  const { userId, ready } = useSession();
  const businesses = useMyBusinesses();
  const [selectedId, setSelectedId] = useState(storedBusinessId);

  if (ready && !userId) {
    return (
      <MerchantFrame>
        <PartnerLanding />
      </MerchantFrame>
    );
  }

  if (businesses.isPending || !ready) {
    return (
      <MerchantFrame>
        <LoadingList />
      </MerchantFrame>
    );
  }
  if (businesses.isError) {
    return (
      <MerchantFrame>
        <ErrorState error={businesses.error} onRetry={() => businesses.refetch()} />
      </MerchantFrame>
    );
  }

  /*
   * my_businesses() returns a set, and the console read [0] and nothing else — a partner
   * with two venues could not reach the second one at all. The choice is remembered so it
   * survives navigating between the six pages, each of which mounts this shell afresh.
   */
  const all = businesses.data ?? [];
  const business = all.find((item) => item.id === selectedId) ?? all[0];
  if (!business) {
    return (
      <MerchantFrame>
        <div className="rounded-2xl bg-card shadow-card p-5">
          <h1 className="text-lg font-extrabold text-ink">Zaregistrujte provozovnu</h1>
          <p className="mt-1 text-sm text-muted">
            Vyplníte základní údaje, my je do 24 hodin zkontrolujeme a pak můžete zveřejňovat volné termíny.
          </p>
          <Link
            to="/partner/registrace"
            className="btn-primary"
          >
            Přidat provozovnu
          </Link>
        </div>
      </MerchantFrame>
    );
  }

  return (
    <MerchantFrame
      nav
      business={business}
      businesses={all}
      onSwitch={(id) => {
        rememberBusinessId(id);
        setSelectedId(id);
      }}
      path={path}
    >
      {business.status === 'approved' ? <ApprovedFrame key={`alerts:${userId}:${business.id}`} business={business} path={path} /> : null}
      {business.status !== 'approved' ? <PendingNotice business={business} /> : null}
      <Fragment key={`content:${userId}:${business.id}`}>{children(business)}</Fragment>
    </MerchantFrame>
  );
}

/*
 * Approval sends no e-mail — the app has no mail provider and adding one only for this is out
 * of scope — so the promise the pending screen makes is kept where the merchant will see it:
 * the first time an approved venue is opened after this browser saw it pending, it says so.
 */
const PENDING_SEEN = 'flek.merchant.pendingSeen.';

function PendingNotice({ business }: { business: Business }) {
  useEffect(() => {
    if (business.status !== 'pending') return;
    try {
      window.localStorage.setItem(PENDING_SEEN + business.id, '1');
    } catch {
      /* private mode: the celebration is simply skipped */
    }
  }, [business.id, business.status]);
  return (
    <div className="mb-4">
      <Banner tone="warning">
        {business.status === 'pending'
          ? 'Vaši provozovnu kontrolujeme. Schválení obvykle trvá do 24 hodin a uvidíte ho tady. Mezitím si můžete připravit služby.'
          : business.status === 'rejected'
            ? `Registrace byla zamítnuta. ${business.status_reason ?? ''}`
            : `Provozovna je pozastavená. ${business.status_reason ?? ''}`}
      </Banner>
    </div>
  );
}

function ApprovedFrame({ business, path }: { business: Business; path: string }) {
  const { alerts, unread, markRead, dismiss } = useBookingAlerts(business.id);
  const [celebrate, setCelebrate] = useState(() => {
    try {
      return window.localStorage.getItem(PENDING_SEEN + business.id) === '1';
    } catch {
      return false;
    }
  });

  // Opening the bookings page is reading them.
  useEffect(() => {
    if (path === '/partner/rezervace') markRead();
  }, [path, unread]);

  function closeCelebration() {
    setCelebrate(false);
    try {
      window.localStorage.removeItem(PENDING_SEEN + business.id);
    } catch {
      /* nothing to forget */
    }
  }

  return (
    <>
      {celebrate ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl bg-accent px-4 py-3 text-accent-ink" role="status">
          <div>
            <p className="text-base font-extrabold">Provozovna byla schválena 🎉</p>
            <p className="text-sm">Teď můžete vystavit první FLEK.</p>
          </div>
          <button type="button" onClick={closeCelebration} aria-label="Zavřít" className="grid size-10 shrink-0 place-items-center rounded-xl hover:bg-card/15">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div aria-live="polite" className="empty:hidden mb-4 flex flex-col gap-2">
        {/* Přehled and Rezervace list the requests at the top themselves; a banner there would say it twice. */}
        {alerts.filter((alert) => alert.kind !== 'request' || !REQUEST_PAGES.includes(path)).map((alert) => (
          <NewBookingBanner key={alert.id} alert={alert} onDismiss={() => dismiss(alert.id)} />
        ))}
      </div>
    </>
  );
}

function NewBookingBanner({ alert, onDismiss }: { alert: BookingAlert; onDismiss: () => void }) {
  const { navigate } = useRouter();
  const request = alert.kind === 'request';
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-card shadow-lift">
      <BellRing size={20} aria-hidden="true" className="shrink-0 text-brand-on-dark" />
      <div className="min-w-0 flex-1">
        <p className="text-base font-extrabold">{request ? 'Nová rezervace čeká na potvrzení' : 'Nová rezervace'}</p>
        <p className="tnum text-sm text-card/85">
          {alert.service} · {dayLabel(alert.startAt, serverNow()).toLocaleLowerCase('cs-CZ')} {clockTime(alert.startAt)} · Vy dostanete{' '}
          <span className="font-bold text-card">{money(alert.payoutCents)}</span>
        </p>
        {request ? <RequestDeadline deadline={alert.deadline} /> : null}
      </div>
      <button
        type="button"
        onClick={() => {
          // A request stays on the list until it is answered; only the banner goes.
          onDismiss();
          navigate('/partner/rezervace');
        }}
        className="min-h-11 shrink-0 rounded-xl bg-card px-3 text-sm font-bold text-ink hover:bg-surface"
      >
        {request ? 'Vyřídit' : 'Zobrazit'}
      </button>
      <button type="button" onClick={() => onDismiss()} aria-label="Skrýt" className="grid size-10 shrink-0 place-items-center rounded-xl text-card/80 hover:bg-card/10">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

function RequestDeadline({ deadline }: { deadline?: string | null }) {
  const left = timeLeft(deadline, useServerNow(1_000));
  if (!left) return null;
  return (
    <p className="tnum text-sm font-bold text-brand-on-dark">
      {left.seconds > 0 ? `Potvrďte do ${left.clock}` : 'Čas na potvrzení vypršel'}
    </p>
  );
}

const REQUEST_PAGES = ['/partner', '/partner/rezervace'];

const BUSINESS_KEY = 'flek.merchant.business';

function storedBusinessId(): string | null {
  try {
    return window.localStorage.getItem(BUSINESS_KEY);
  } catch {
    return null;
  }
}

function rememberBusinessId(id: string) {
  try {
    window.localStorage.setItem(BUSINESS_KEY, id);
  } catch {
    /* private mode: the console simply falls back to the first venue */
  }
}

function MerchantFrame({
  children,
  nav,
  business,
  businesses = [],
  onSwitch,
  path,
}: {
  children: ReactNode;
  nav?: boolean;
  business?: Business;
  businesses?: Business[];
  onSwitch?: (id: string) => void;
  path?: string;
}) {
  const [menu, setMenu] = useState(false);
  const { navigate } = useRouter();
  const { userId } = useSession();
  const unread = useUnreadBookings(business?.id);
  const badge = (to: string) =>
    to === '/partner/rezervace' && unread > 0 ? (
      <span className="tnum ml-auto grid min-h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-xs font-extrabold text-brand-ink" aria-label={`${unread} nových`}>
        {unread}
      </span>
    ) : null;
  return (
    <div className="min-h-dvh bg-surface">
      <a href="#partner-obsah" className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-ink focus:p-3 focus:text-card">Přeskočit na obsah</a>
      <header className="sticky top-0 z-20 border-b border-line bg-card">
        <div className="mx-auto flex min-h-18 max-w-[1440px] items-center justify-between gap-3 px-4 lg:px-8">
          <Link to="/partner" aria-label="FLEK Partner" className="inline-flex min-h-11 items-center"><Wordmark suffix="Partner" /></Link>
          <div className="flex min-w-0 items-center gap-2 sm:gap-6">
            {business && businesses.length > 1 ? (
              <select
                aria-label="Provozovna"
                value={business.id}
                onChange={(event) => onSwitch?.(event.target.value)}
                className="min-h-11 max-w-[12rem] truncate rounded-xl border border-line bg-card px-3 text-sm font-bold text-ink"
              >
                {businesses.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name}
                  </option>
                ))}
              </select>
            ) : business ? (
              <span className="hidden max-w-sm truncate text-sm font-bold text-muted sm:inline">{business.display_name}</span>
            ) : null}
            {/* The venue exactly as customers find it — the public page, in a new tab so the
                console stays where it was. Only approved venues have a public page. */}
            {business?.status === 'approved' ? (
              <a
                href={`/podnik/${business.id}`}
                target="_blank"
                rel="noreferrer"
                title="Zobrazit jako zákazník"
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 text-sm font-bold sm:min-w-0"
              >
                <Eye size={17} aria-hidden="true" />
                <span className="hidden sm:inline">Zobrazit jako zákazník</span>
                <span className="sr-only sm:hidden">Zobrazit jako zákazník</span>
              </a>
            ) : null}
            <Link
              to="/"
              aria-label="Přejít do zákaznické části"
              title="Přejít do zákaznické části"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 text-sm font-bold sm:min-w-0"
            >
              <span className="hidden sm:inline">Zákaznická část</span>
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
            {userId ? (
              <>
                <NotificationBell businessId={business?.id} />
                <SignOutButton compact />
              </>
            ) : null}
          </div>
        </div>
      </header>
      <div className={`mx-auto max-w-[1440px] ${nav ? 'lg:grid lg:grid-cols-[224px_minmax(0,1fr)]' : ''}`}>
        {nav ? <aside className="hidden min-h-[calc(100dvh-73px)] border-r border-line bg-card px-4 py-6 lg:block"><nav aria-label="Partner" className="sticky top-24"><ul className="flex flex-col gap-2">{NAV.map(({ to, label, icon: Icon }) => <li key={to}><Link to={to} aria-current={path === to ? 'page' : undefined} className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-bold ${path === to ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface hover:text-ink'}`}><Icon size={20} aria-hidden="true" />{label}{badge(to)}</Link></li>)}</ul></nav></aside> : null}
        <main id="partner-obsah" className="min-w-0 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:p-8">{children}</main>
      </div>
      {nav ? <nav aria-label="Partner" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"><ul className="flex">{NAV.slice(0, 3).map(({ to, label, icon: Icon }) => <li key={to} className="flex-1"><Link to={to} aria-current={path === to ? 'page' : undefined} className={`relative flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-bold ${path === to ? 'text-accent' : 'text-muted'}`}><span className="relative inline-flex"><Icon size={22} aria-hidden="true" />{to === '/partner/rezervace' && unread > 0 ? <span className="tnum absolute -top-1.5 -right-2.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-extrabold text-brand-ink" aria-label={`${unread} nových`}>{unread}</span> : null}</span>{label}</Link></li>)}<li className="flex-1"><button type="button" onClick={() => setMenu(true)} aria-haspopup="dialog" className={`flex min-h-16 w-full flex-col items-center justify-center gap-1 text-xs font-bold ${NAV.slice(3).some((item) => item.to === path) ? 'text-accent' : 'text-muted'}`}><Ellipsis size={22} aria-hidden="true" />Další</button></li></ul></nav> : null}
      <Sheet open={menu} onClose={() => setMenu(false)} title="Správa provozovny"><div className="flex flex-col gap-2">{NAV.slice(3).map(({ to, label, icon: Icon }) => <button key={to} type="button" onClick={() => { setMenu(false); navigate(to); }} className={`flex min-h-13 items-center gap-3 rounded-xl px-4 text-base font-bold ${path === to ? 'bg-accent-soft text-accent' : 'hover:bg-surface'}`}><Icon size={20} aria-hidden="true" />{label}</button>)}</div></Sheet>
    </div>
  );
}
