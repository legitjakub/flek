import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CreditCard } from 'lucide-react';
import { businessPaymentsStatus, stripeConnect } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useRouter } from '../../app/router';
import { Banner, Button, Spinner } from '../../components/ui';
import type { Business } from '../../types/database';

/**
 * Where a business connects its Stripe account. Customers pay FLEK through Stripe, FLEK keeps the
 * service fee and Stripe pays the rest to this account, so nothing can be sold until Stripe says
 * the account may take payments.
 */
export function StripePayouts({ business }: { business: Business }) {
  const { search, navigate } = useRouter();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ['business-payments', business.id],
    queryFn: () => businessPaymentsStatus(business.id),
  });

  const refresh = useMutation({
    mutationFn: () => stripeConnect('status', business.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['business-payments', business.id] }),
  });
  const onboard = useMutation({
    mutationFn: () => stripeConnect('onboard', business.id),
    onSuccess: (result) => {
      if (result.url) window.location.assign(result.url);
    },
    onError: (error) => setFailure(errorMessage(error, 'merchant')),
  });
  const dashboard = useMutation({
    mutationFn: () => stripeConnect('dashboard', business.id),
    onSuccess: (result) => {
      if (result.url) window.open(result.url, '_blank', 'noopener');
    },
    onError: (error) => setFailure(errorMessage(error, 'merchant')),
  });

  // Back from Stripe's onboarding: ask Stripe what changed, then drop the marker from the address.
  const returned = search.get('stripe');
  useEffect(() => {
    if (!returned) return;
    refresh.mutate();
    navigate('/partner/provozovna', { replace: true, scroll: false });
  }, [returned]);

  // Stripe may finish verifying while nobody is looking, so ask it again once whenever this opens.
  const asked = useRef(false);
  useEffect(() => {
    const data = status.data;
    if (!data || returned || asked.current) return;
    asked.current = true;
    if (data.connected && !(data.charges_enabled && data.payouts_enabled)) refresh.mutate();
  }, [status.data, returned]);

  const data = status.data;
  const ready = Boolean(data?.charges_enabled);
  const connected = Boolean(data?.connected);

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-card sm:p-6" aria-labelledby="platby-vyplaty">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="platby-vyplaty" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-ink">
          <CreditCard size={20} aria-hidden="true" />
          Platby a výplaty
        </h2>
        {status.isPending || refresh.isPending ? (
          <Spinner label="Zjišťujeme stav u Stripe" />
        ) : (
          <span
            className={
              ready
                ? 'rounded-full bg-positive/10 px-2.5 py-1 text-xs font-bold text-positive'
                : connected
                  ? 'rounded-full bg-warning-soft px-2.5 py-1 text-xs font-bold text-warning'
                  : 'rounded-full bg-surface px-2.5 py-1 text-xs font-bold text-muted'
            }
          >
            {ready ? 'Platby aktivní' : connected ? 'Čeká na ověření' : 'Nepropojeno'}
          </span>
        )}
      </div>

      <p className="text-base text-muted">
        {ready
          ? data?.payouts_enabled
            ? 'Zákazníci platí kartou přes Stripe. FLEK si ponechá servisní poplatek a zbytek vám Stripe posílá na účet.'
            : 'Platby jsou zapnuté. Výplaty na účet začnou, jakmile Stripe dokončí ověření bankovního účtu.'
          : connected
            ? 'Stripe ještě potřebuje doplnit nebo ověřit údaje. Dokud to nebude hotové, nemůžete zveřejňovat FLEKy.'
            : 'Zákazníci platí kartou přes Stripe. FLEK si ponechá servisní poplatek a zbytek vám Stripe pošle na účet. Propojení zabere pár minut: Stripe se zeptá na údaje o firmě a bankovní účet.'}
      </p>

      {failure ? <Banner tone="warning">{failure}</Banner> : null}

      <div className="flex flex-wrap gap-2">
        {ready ? (
          <Button variant="secondary" shape="pill" loading={dashboard.isPending} onClick={() => { setFailure(null); dashboard.mutate(); }}>
            Přehled výplat
            <ArrowUpRight size={16} aria-hidden="true" />
          </Button>
        ) : (
          <Button shape="pill" loading={onboard.isPending} onClick={() => { setFailure(null); onboard.mutate(); }}>
            {connected ? 'Pokračovat v ověření u Stripe' : 'Propojit se Stripe'}
          </Button>
        )}
        {connected && !ready ? (
          <Button variant="ghost" shape="pill" loading={refresh.isPending} onClick={() => refresh.mutate()}>
            Zkontrolovat stav
          </Button>
        ) : null}
      </div>
    </section>
  );
}
