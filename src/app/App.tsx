import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, Suspense, lazy, type ReactNode } from 'react';
import { RouterProvider, matchPath, useRouter, Link } from './router';
import { CustomerShell } from './CustomerShell';
import { SessionProvider } from '../features/auth/session';
import { AuthPage } from '../features/auth/AuthPage';
import { ConfirmationPage } from '../features/auth/ConfirmationPage';
import { ProfilePage } from '../features/auth/ProfilePage';
import { DiscoveryPage } from '../features/discovery/DiscoveryPage';
import { MapPage } from '../features/discovery/MapPage';
import { OfferDetailPage } from '../features/offers/OfferDetailPage';
import { MyBookingsPage } from '../features/bookings/MyBookingsPage';
import { FavoritesPage } from '../features/favorites/FavoritesPage';
import { VenuePage } from '../features/business/VenuePage';
import { ReferralLandingPage } from '../features/referral/ReferralLandingPage';
import { ReferralClaimer } from '../features/referral/ReferralClaimer';
// A customer never opens the merchant or admin trees, so they are not part of the bundle
// that has to arrive before the first offer can be read.
const MerchantDashboardPage = lazy(() =>
  import('../features/merchant/DashboardPage').then((m) => ({ default: m.MerchantDashboardPage })),
);
const MerchantOffersPage = lazy(() =>
  import('../features/merchant/OffersPage').then((m) => ({ default: m.MerchantOffersPage })),
);
const MerchantBookingsPage = lazy(() =>
  import('../features/merchant/BookingsPage').then((m) => ({ default: m.MerchantBookingsPage })),
);
const MerchantServicesPage = lazy(() =>
  import('../features/merchant/ServicesPage').then((m) => ({ default: m.MerchantServicesPage })),
);
const MerchantBusinessPage = lazy(() =>
  import('../features/merchant/BusinessPage').then((m) => ({ default: m.MerchantBusinessPage })),
);
const MerchantRegisterPage = lazy(() =>
  import('../features/merchant/BusinessPage').then((m) => ({ default: m.MerchantRegisterPage })),
);
const MerchantMetricsPage = lazy(() =>
  import('../features/merchant/MetricsPage').then((m) => ({ default: m.MerchantMetricsPage })),
);
const AdminBusinessesPage = lazy(() =>
  import('../features/admin/AdminPage').then((m) => ({ default: m.AdminBusinessesPage })),
);
const AdminOffersPage = lazy(() =>
  import('../features/admin/AdminPage').then((m) => ({ default: m.AdminOffersPage })),
);
const AdminBookingsPage = lazy(() =>
  import('../features/admin/AdminPage').then((m) => ({ default: m.AdminBookingsPage })),
);
const AdminUsersPage = lazy(() =>
  import('../features/admin/AdminPage').then((m) => ({ default: m.AdminUsersPage })),
);
const AdminMetricsPage = lazy(() =>
  import('../features/admin/AdminPage').then((m) => ({ default: m.AdminMetricsPage })),
);
import { errorMessage } from '../lib/errors';
import { Button, LoadingList } from '../components/ui';

const queryClient = new QueryClient({
  defaultOptions: {
    // networkMode 'always': the default pauses a failed fetch instead of failing it, which
    // would leave a dropped connection showing a skeleton forever and a confirm button
    // spinning. We would rather surface an honest error the customer can retry.
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: true, networkMode: 'always' },
    mutations: { retry: 0, networkMode: 'always' },
  },
});

/** Merchant and admin surfaces bring their own frame; the customer app wears the shell. */
const ROUTES: { path: string; render: (params: Record<string, string>) => ReactNode; shell: boolean }[] = [
  { path: '/', render: () => <DiscoveryPage />, shell: true },
  { path: '/mapa', render: () => <MapPage />, shell: true },
  { path: '/nabidka/:id', render: (p) => <OfferDetailPage offerId={p.id} />, shell: true },
  { path: '/oblibene', render: () => <FavoritesPage />, shell: true },
  // A venue and everything free at it — the destination favourites always implied.
  { path: '/podnik/:id', render: (p) => <VenuePage businessId={p.id} />, shell: true },
  { path: '/rezervace', render: () => <MyBookingsPage />, shell: true },
  { path: '/profil', render: () => <ProfilePage />, shell: true },
  { path: '/prihlaseni', render: () => <AuthPage />, shell: false },
  { path: '/potvrzeni', render: () => <ConfirmationPage />, shell: false },
  // Invitation links are public and must render before anyone signs in.
  { path: '/r/:code', render: (p) => <ReferralLandingPage code={p.code} />, shell: false },
  { path: '/partner', render: () => <MerchantDashboardPage />, shell: false },
  { path: '/partner/nabidky', render: () => <MerchantOffersPage />, shell: false },
  { path: '/partner/rezervace', render: () => <MerchantBookingsPage />, shell: false },
  { path: '/partner/sluzby', render: () => <MerchantServicesPage />, shell: false },
  { path: '/partner/provozovna', render: () => <MerchantBusinessPage />, shell: false },
  { path: '/partner/metriky', render: () => <MerchantMetricsPage />, shell: false },
  { path: '/partner/registrace', render: () => <MerchantRegisterPage />, shell: false },
  { path: '/admin', render: () => <AdminBusinessesPage />, shell: false },
  { path: '/admin/nabidky', render: () => <AdminOffersPage />, shell: false },
  { path: '/admin/rezervace', render: () => <AdminBookingsPage />, shell: false },
  { path: '/admin/uzivatele', render: () => <AdminUsersPage />, shell: false },
  { path: '/admin/metriky', render: () => <AdminMetricsPage />, shell: false },
];

function RouteLoading() {
  return (
    <div className="page-container py-10" role="status" aria-label="Načítáme">
      <LoadingList rows={3} />
    </div>
  );
}

function Routes() {
  const { path } = useRouter();
  for (const route of ROUTES) {
    const params = matchPath(route.path, path);
    if (!params) continue;
    const element = <Suspense fallback={<RouteLoading />}>{route.render(params)}</Suspense>;
    return route.shell ? <CustomerShell>{element}</CustomerShell> : element;
  }
  return (
    <CustomerShell>
      <main className="mx-auto w-full max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-extrabold text-ink">Tuhle stránku neznáme.</h1>
        <Link to="/" className="mt-4 inline-block text-sm font-bold underline underline-offset-4">
          Zpět na nabídky
        </Link>
      </main>
    </CustomerShell>
  );
}

class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
        <h1 className="text-lg font-extrabold text-ink">{errorMessage(this.state.error)}</h1>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Načíst znovu
        </Button>
      </main>
    );
  }
}

export function App() {
  return (
    <Boundary>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <RouterProvider>
            {/* Attribution is claimed the moment an account exists, wherever that happened:
                a sign-up, a later sign-in, or a return from e-mail confirmation. */}
            <ReferralClaimer />
            <Routes />
          </RouterProvider>
        </SessionProvider>
      </QueryClientProvider>
    </Boundary>
  );
}
