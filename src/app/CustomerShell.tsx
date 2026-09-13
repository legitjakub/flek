import type { ReactNode } from 'react';
import { Compass, Map, Heart, Ticket, UserRound, ArrowUpRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { newAtFavoritesCount } from '../lib/api';
import { Link, useRouter } from './router';
import { Wordmark, cx } from '../components/ui';
import { useSession } from '../features/auth/session';
import { NotificationBell } from '../features/notifications/Notifications';

const NAV = [
  { to: '/', label: 'Objevit', icon: Compass },
  { to: '/mapa', label: 'Mapa', icon: Map },
  { to: '/oblibene', label: 'Oblíbené', icon: Heart },
  { to: '/rezervace', label: 'Rezervace', icon: Ticket },
  { to: '/profil', label: 'Profil', icon: UserRound },
];

export function CustomerShell({ children }: { children: ReactNode }) {
  const { path, search } = useRouter();
  const { userId } = useSession();
  // The badge is derived, never stored: it counts offers published at followed venues
  // since the customer last opened the list.
  const newCount = useQuery({
    queryKey: ['favorites-count', userId],
    queryFn: newAtFavoritesCount,
    enabled: Boolean(userId),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
  const detail = path.startsWith('/nabidka/');
  const query = (path === '/' || path === '/mapa') && search.size ? `?${search}` : '';
  // The map runs underneath the floating tab bar, so it needs no room kept free below.
  const fullBleed = path === '/mapa';
  function navItems(mobile: boolean) {
    return NAV.map(({ to, label, icon: Icon }) => {
      const active = to === '/' ? path === '/' : path.startsWith(to);
      const badge = to === '/oblibene' ? (newCount.data ?? 0) : 0;
      return (
        <li key={to} className={mobile ? 'flex-1' : ''}>
          <Link
            to={to + (to === '/' || to === '/mapa' ? query : '')}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex items-center justify-center font-bold transition-colors',
              mobile ? 'min-h-15 flex-col gap-0.5 text-xs' : 'min-h-11 gap-2 rounded-full px-4 text-sm',
              active ? 'text-ink' : 'text-muted hover:text-ink',
              !mobile && active && 'bg-accent-soft',
            )}
          >
            {/* On a phone the active tab carries the lime pill behind its icon. */}
            <span className={cx('relative inline-flex items-center justify-center', mobile && 'h-8 w-14 rounded-full transition-colors', mobile && active && 'bg-brand')}>
              <Icon size={mobile ? 21 : 18} aria-hidden="true" strokeWidth={active ? 2.3 : 1.8} />
              {badge > 0 ? (
                <span
                  className={cx(
                    'tnum absolute grid min-h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold',
                    mobile ? 'top-0 right-2.5 bg-ink text-card ring-2 ring-card' : '-top-1.5 -right-2 bg-brand text-ink',
                  )}
                  aria-label={`${badge} nových`}
                >
                  {badge > 9 ? '9+' : badge}
                </span>
              ) : null}
            </span>
            {label}
          </Link>
        </li>
      );
    });
  }
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a href="#obsah" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-ink focus:p-3 focus:text-card">Přeskočit na obsah</a>
      <header className="sticky top-0 z-20 border-b border-line bg-card">
        <div className="page-container flex min-h-17 items-center justify-between gap-3">
          <Link to="/" aria-label="FLEK — domů" className="inline-flex min-h-11 items-center"><Wordmark /></Link>
          <nav aria-label="Hlavní" className="hidden md:block"><ul className="flex gap-1">{navItems(false)}</ul></nav>
          <div className="flex shrink-0 items-center gap-2">
            <NotificationBell />
            <Link to="/partner" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-bold text-ink">Pro podniky<ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </div>
      </header>
      <div id="obsah" className={cx('min-w-0 flex-1', !detail && !fullBleed && 'pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-8')}>{children}</div>
      {!detail ? (
        <nav
          aria-label="Hlavní"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 rounded-[1.75rem] bg-card/95 px-1.5 py-1 shadow-[0_2px_6px_rgb(34_40_43/0.08),0_16px_36px_-12px_rgb(34_40_43/0.35)] backdrop-blur-md md:hidden"
        >
          <ul className="flex">{navItems(true)}</ul>
        </nav>
      ) : null}
    </div>
  );
}
