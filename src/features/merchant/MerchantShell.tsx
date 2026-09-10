import { LayoutDashboard, CalendarDays, Ticket, Scissors, Store, ChartNoAxesColumn, Ellipsis, ArrowUpRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Banner, LoadingList, ErrorState, Wordmark, Sheet } from '../../components/ui';
import { SignOutButton } from '../auth/SignOutButton';
import { Link, useRouter } from '../../app/router';
import { useSession } from '../auth/session';
import { useMyBusinesses } from './useBusiness';
import type { Business } from '../../types/database';

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
        <div className="rounded-2xl bg-card shadow-card p-5">
          <h1 className="text-lg font-extrabold text-ink">Přihlaste se jako partner</h1>
          <p className="mt-1 text-sm text-muted">Účtem partnera spravujete provozovnu a volné termíny.</p>
          <Link
            to="/prihlaseni?role=merchant&returnTo=%2Fpartner"
            className="btn-primary"
          >
            Přihlásit se
          </Link>
        </div>
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
      {business.status !== 'approved' ? (
        <div className="mb-4">
          <Banner tone="warning">
            {business.status === 'pending'
              ? 'Vaši provozovnu kontrolujeme. Ozveme se do 24 hodin.'
              : business.status === 'rejected'
                ? `Registrace byla zamítnuta. ${business.status_reason ?? ''}`
                : `Provozovna je pozastavená. ${business.status_reason ?? ''}`}
          </Banner>
        </div>
      ) : null}
      {children(business)}
    </MerchantFrame>
  );
}

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
            <Link
              to="/"
              aria-label="Přejít do zákaznické části"
              title="Přejít do zákaznické části"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 text-sm font-bold sm:min-w-0"
            >
              <span className="hidden sm:inline">Zákaznická část</span>
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
            {userId ? <SignOutButton compact /> : null}
          </div>
        </div>
      </header>
      <div className={`mx-auto max-w-[1440px] ${nav ? 'lg:grid lg:grid-cols-[224px_minmax(0,1fr)]' : ''}`}>
        {nav ? <aside className="hidden min-h-[calc(100dvh-73px)] border-r border-line bg-card px-4 py-6 lg:block"><nav aria-label="Partner" className="sticky top-24"><ul className="flex flex-col gap-2">{NAV.map(({ to, label, icon: Icon }) => <li key={to}><Link to={to} aria-current={path === to ? 'page' : undefined} className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-bold ${path === to ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface hover:text-ink'}`}><Icon size={20} aria-hidden="true" />{label}</Link></li>)}</ul></nav></aside> : null}
        <main id="partner-obsah" className="min-w-0 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:p-8">{children}</main>
      </div>
      {nav ? <nav aria-label="Partner" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"><ul className="flex">{NAV.slice(0, 3).map(({ to, label, icon: Icon }) => <li key={to} className="flex-1"><Link to={to} aria-current={path === to ? 'page' : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-bold ${path === to ? 'text-accent' : 'text-muted'}`}><Icon size={22} aria-hidden="true" />{label}</Link></li>)}<li className="flex-1"><button type="button" onClick={() => setMenu(true)} aria-haspopup="dialog" className={`flex min-h-16 w-full flex-col items-center justify-center gap-1 text-xs font-bold ${NAV.slice(3).some((item) => item.to === path) ? 'text-accent' : 'text-muted'}`}><Ellipsis size={22} aria-hidden="true" />Další</button></li></ul></nav> : null}
      <Sheet open={menu} onClose={() => setMenu(false)} title="Správa provozovny"><div className="flex flex-col gap-2">{NAV.slice(3).map(({ to, label, icon: Icon }) => <button key={to} type="button" onClick={() => { setMenu(false); navigate(to); }} className={`flex min-h-13 items-center gap-3 rounded-xl px-4 text-base font-bold ${path === to ? 'bg-accent-soft text-accent' : 'hover:bg-surface'}`}><Icon size={20} aria-hidden="true" />{label}</button>)}</div></Sheet>
    </div>
  );
}
