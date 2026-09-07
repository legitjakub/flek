import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, type ReactNode } from 'react';
import { RouterProvider, matchPath, useRouter, Link } from './router';
import { CustomerShell } from './CustomerShell';
import { SessionProvider } from '../features/auth/session';
import { AuthPage } from '../features/auth/AuthPage';
import { ProfilePage } from '../features/auth/ProfilePage';
import { DiscoveryPage } from '../features/discovery/DiscoveryPage';
import { MapPage } from '../features/discovery/MapPage';
import { OfferDetailPage } from '../features/offers/OfferDetailPage';
import { MyBookingsPage } from '../features/bookings/MyBookingsPage';
import { MerchantDashboardPage } from '../features/merchant/DashboardPage';
import { MerchantOffersPage } from '../features/merchant/OffersPage';
import { MerchantBookingsPage } from '../features/merchant/BookingsPage';
import { MerchantServicesPage } from '../features/merchant/ServicesPage';
import { MerchantBusinessPage, MerchantRegisterPage } from '../features/merchant/BusinessPage';
import { MerchantMetricsPage } from '../features/merchant/MetricsPage';
import {
  AdminBookingsPage,
  AdminBusinessesPage,
  AdminMetricsPage,
  AdminOffersPage,
  AdminUsersPage,
} from '../features/admin/AdminPage';
import { errorMessage } from '../lib/errors';
import { Button } from '../components/ui';

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
  { path: '/rezervace', render: () => <MyBookingsPage />, shell: true },
  { path: '/profil', render: () => <ProfilePage />, shell: true },
  { path: '/prihlaseni', render: () => <AuthPage />, shell: false },
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

function Routes() {
  const { path } = useRouter();
  for (const route of ROUTES) {
    const params = matchPath(route.path, path);
    if (!params) continue;
    const element = route.render(params);
    return route.shell ? <CustomerShell>{element}</CustomerShell> : <>{element}</>;
  }
  return (
    <CustomerShell>
      <main className="mx-auto w-full max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-extrabold text-ink">Tuhle stránku neznáme.</h1>
        <Link to="/" className="mt-4 inline-block text-sm font-semibold underline underline-offset-4">
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
        <h1 className="text-lg font-bold text-ink">{errorMessage(this.state.error)}</h1>
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
            <Routes />
          </RouterProvider>
        </SessionProvider>
      </QueryClientProvider>
    </Boundary>
  );
}
