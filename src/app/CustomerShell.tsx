import type { ReactNode } from 'react';
import { Link, useRouter } from './router';
import { Wordmark } from '../components/ui';
import { useSession } from '../features/auth/session';

const NAV = [
  { to: '/', label: 'Objevit' },
  { to: '/mapa', label: 'Mapa' },
  { to: '/rezervace', label: 'Rezervace' },
  { to: '/profil', label: 'Profil' },
];

export function CustomerShell({ children }: { children: ReactNode }) {
  const { path } = useRouter();
  const { userId } = useSession();

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a
        href="#obsah"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-surface"
      >
        Přeskočit na obsah
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" aria-label="FLEK — domů">
            <Wordmark />
          </Link>
          <Link
            to={userId ? '/partner' : '/prihlaseni?role=merchant&returnTo=%2Fpartner'}
            className="text-sm font-semibold text-ink underline underline-offset-4"
          >
            Pro podniky
          </Link>
        </div>
      </header>

      <div id="obsah" className="flex-1 pb-20">
        {children}
      </div>

      <nav
        aria-label="Hlavní"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <ul className="mx-auto flex w-full max-w-3xl">
          {NAV.map((item) => {
            const active = item.to === '/' ? path === '/' : path.startsWith(item.to);
            return (
              <li key={item.to} className="flex-1">
                <Link
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center text-xs font-semibold ${
                    active ? 'text-ink' : 'text-muted'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mb-1 block h-1 w-6 rounded-full ${active ? 'bg-accent' : 'bg-transparent'}`}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
