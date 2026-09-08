import type { ReactNode } from 'react';
import { Compass, Map, Heart, CalendarDays, UserRound, ArrowUpRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { newAtFavoritesCount } from '../lib/api';
import { Link, useRouter } from './router';
import { Wordmark, cx } from '../components/ui';
import { useSession } from '../features/auth/session';

const NAV = [
  { to: '/', label: 'Objevit', icon: Compass },
  { to: '/mapa', label: 'Mapa', icon: Map },
  { to: '/oblibene', label: 'Oblíbené', icon: Heart },
  { to: '/rezervace', label: 'Rezervace', icon: CalendarDays },
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
  function navItems(mobile: boolean) {
    return NAV.map(({ to, label, icon: Icon }) => {
      const active = to === '/' ? path === '/' : path.startsWith(to);
      const badge = to === '/oblibene' ? (newCount.data ?? 0) : 0;
      return <li key={to} className={mobile ? 'flex-1' : ''}><Link to={to + (to === '/' || to === '/mapa' ? query : '')} aria-current={active ? 'page' : undefined} className={cx('flex items-center justify-center font-semibold transition-colors', mobile ? 'min-h-16 flex-col gap-1 text-xs' : 'min-h-11 gap-2 rounded-xl px-4 text-sm', active ? 'text-accent' : 'text-muted hover:text-ink', !mobile && active && 'bg-accent-soft')}><span className="relative inline-flex"><Icon size={mobile ? 22 : 18} aria-hidden="true" strokeWidth={active ? 2.3 : 1.8} />{badge > 0 ? <span className="tnum absolute -top-1.5 -right-2 grid min-h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-ink" aria-label={`${badge} nových`}>{badge > 9 ? '9+' : badge}</span> : null}</span>{label}</Link></li>;
    });
  }
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a href="#obsah" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-ink focus:p-3 focus:text-card">Přeskočit na obsah</a>
      <header className="sticky top-0 z-20 border-b border-line bg-card">
        <div className="page-container flex min-h-17 items-center justify-between gap-3">
          <Link to="/" aria-label="FLEK — domů" className="inline-flex min-h-11 items-center"><Wordmark /></Link>
          <nav aria-label="Hlavní" className="hidden md:block"><ul className="flex gap-1">{navItems(false)}</ul></nav>
          <Link to={userId ? '/partner' : '/prihlaseni?role=merchant&returnTo=%2Fpartner'} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-bold text-ink">Pro podniky<ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
      </header>
      <div id="obsah" className={cx('min-w-0 flex-1', !detail && 'pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-8')}>{children}</div>
      {!detail ? <nav aria-label="Hlavní" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden"><ul className="flex">{navItems(true)}</ul></nav> : null}
    </div>
  );
}
