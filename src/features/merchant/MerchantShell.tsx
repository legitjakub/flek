import type { ReactNode } from 'react';
import { Banner, LoadingList, ErrorState, Wordmark } from '../../components/ui';
import { Link, useRouter } from '../../app/router';
import { useSession } from '../auth/session';
import { useMyBusinesses } from './useBusiness';
import type { Business } from '../../types/database';

const NAV = [
  { to: '/partner', label: 'Přehled' },
  { to: '/partner/nabidky', label: 'Nabídky' },
  { to: '/partner/rezervace', label: 'Rezervace' },
  { to: '/partner/sluzby', label: 'Služby' },
  { to: '/partner/provozovna', label: 'Provozovna' },
  { to: '/partner/metriky', label: 'Metriky' },
];

/**
 * Merchant surface: visibly the same product, deliberately a different skin, and vykání
 * throughout (the customer app tyká).
 */
export function MerchantShell({ children }: { children: (business: Business) => ReactNode }) {
  const { path } = useRouter();
  const { userId, ready } = useSession();
  const businesses = useMyBusinesses();

  if (ready && !userId) {
    return (
      <MerchantFrame>
        <div className="rounded-2xl border border-line bg-card p-5">
          <h1 className="text-lg font-bold text-ink">Přihlaste se jako partner</h1>
          <p className="mt-1 text-sm text-muted">Účtem partnera spravujete provozovnu a volné termíny.</p>
          <Link
            to="/prihlaseni?role=merchant&returnTo=%2Fpartner"
            className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-accent px-4 font-semibold text-accent-ink"
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

  const business = businesses.data?.[0];
  if (!business) {
    return (
      <MerchantFrame>
        <div className="rounded-2xl border border-line bg-card p-5">
          <h1 className="text-lg font-bold text-ink">Zaregistrujte provozovnu</h1>
          <p className="mt-1 text-sm text-muted">
            Vyplníte základní údaje, my je do 24 hodin zkontrolujeme a pak můžete zveřejňovat volné termíny.
          </p>
          <Link
            to="/partner/registrace"
            className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-accent px-4 font-semibold text-accent-ink"
          >
            Přidat provozovnu
          </Link>
        </div>
      </MerchantFrame>
    );
  }

  return (
    <MerchantFrame nav business={business} path={path}>
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

function MerchantFrame({
  children,
  nav,
  business,
  path,
}: {
  children: ReactNode;
  nav?: boolean;
  business?: Business;
  path?: string;
}) {
  return (
    <div className="min-h-dvh bg-ink/3">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/partner" aria-label="VOLNO Partner">
            <Wordmark suffix="Partner" />
          </Link>
          <div className="flex items-center gap-3">
            {business ? <span className="hidden text-sm text-muted sm:inline">{business.display_name}</span> : null}
            <Link to="/" className="text-sm font-semibold text-ink underline underline-offset-4">
              Zákaznická část
            </Link>
          </div>
        </div>
        {nav ? (
          <nav aria-label="Partner" className="mx-auto w-full max-w-4xl overflow-x-auto px-4">
            <ul className="flex gap-1 pb-2">
              {NAV.map((item) => {
                const active = path === item.to;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      aria-current={active ? 'page' : undefined}
                      className={`inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold whitespace-nowrap ${
                        active ? 'bg-ink text-surface' : 'text-muted hover:text-ink'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 py-5">{children}</main>
    </div>
  );
}
