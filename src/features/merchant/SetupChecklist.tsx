import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { businessBilling, businessPaymentsStatus, merchantOffers } from '../../lib/api';
import { Link } from '../../app/router';
import { useServices } from './useBusiness';
import type { Business } from '../../types/database';

const PREVIEWED = 'flek.merchant.previewed.';

/**
 * "Co mám teď udělat?" answered on the dashboard of a new venue, in order. Not a game: each
 * row is a real prerequisite for the first customer, and the list disappears once they are all
 * done. The only step the app cannot observe — looking at the venue as a customer — is
 * ticked when the merchant follows its link.
 */
export function SetupChecklist({ business }: { business: Business }) {
  const services = useServices(business.id);
  const offers = useQuery({
    queryKey: ['merchant-offers', business.id],
    queryFn: () => merchantOffers(business.id),
  });
  const billing = useQuery({
    queryKey: ['business-billing', business.id],
    queryFn: () => businessBilling(business.id),
    staleTime: 60_000,
  });
  const payments = useQuery({
    queryKey: ['business-payments', business.id],
    queryFn: () => businessPaymentsStatus(business.id),
    staleTime: 60_000,
  });
  const [previewed, setPreviewed] = useState(() => {
    try {
      return window.localStorage.getItem(PREVIEWED + business.id) === '1';
    } catch {
      return false;
    }
  });

  if (services.isPending || offers.isPending || billing.isPending || payments.isPending) return null;

  const approved = business.status === 'approved';
  const steps = [
    { key: 'account', label: 'Účet', done: true },
    { key: 'approved', label: 'Provozovna schválena', done: approved, hint: approved ? null : 'Obvykle do 24 hodin.' },
    {
      key: 'billing',
      label: 'Výplatní a fakturační údaje',
      done: Boolean(billing.data?.bank_account && billing.data?.terms_accepted_at),
      to: '/partner/provozovna',
    },
    ...(payments.data?.provider === 'stripe'
      ? [{ key: 'payments', label: 'Platby přes Stripe', done: Boolean(payments.data.charges_enabled), to: '/partner/provozovna' }]
      : []),
    { key: 'service', label: 'První služba', done: (services.data ?? []).some((s) => s.is_active), to: '/partner/sluzby' },
    { key: 'offer', label: 'První FLEK', done: (offers.data ?? []).length > 0, to: approved ? '/partner/nabidky' : undefined },
    { key: 'preview', label: 'Zobrazit jako zákazník', done: previewed, href: approved ? `/podnik/${business.id}` : undefined },
  ];
  if (steps.every((step) => step.done)) return null;
  const next = steps.find((step) => !step.done);

  return (
    <section className="rounded-2xl bg-card shadow-card p-5 sm:p-6" aria-labelledby="skoro-pripraveni">
      <h2 id="skoro-pripraveni" className="text-lg font-extrabold tracking-tight text-ink">
        Jste skoro připraveni získat prvního zákazníka
      </h2>
      <ol className="mt-4 flex flex-col gap-2">
        {steps.map((step) => {
          const current = step === next;
          const body = (
            <>
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full ${step.done ? 'bg-accent text-accent-ink' : current ? 'border-2 border-ink' : 'border-2 border-line'}`}
                aria-hidden="true"
              >
                {step.done ? <Check size={14} strokeWidth={3} /> : null}
              </span>
              <span className={`text-base ${step.done ? 'text-muted line-through decoration-line' : current ? 'font-bold text-ink' : 'text-ink'}`}>
                {step.label}
              </span>
              <span className="sr-only">{step.done ? ' — hotovo' : ' — zbývá'}</span>
              {'hint' in step && step.hint && !step.done ? <span className="text-sm text-muted">· {step.hint}</span> : null}
            </>
          );
          const className = 'flex min-h-11 items-center gap-3 rounded-xl px-2 -mx-2';
          if (!step.done && 'to' in step && step.to) {
            return (
              <li key={step.key}>
                <Link to={step.to} className={`${className} hover:bg-surface`}>
                  {body}
                </Link>
              </li>
            );
          }
          if (!step.done && 'href' in step && step.href) {
            return (
              <li key={step.key}>
                <a
                  href={step.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    setPreviewed(true);
                    try {
                      window.localStorage.setItem(PREVIEWED + business.id, '1');
                    } catch {
                      /* the step simply stays open in private mode */
                    }
                  }}
                  className={`${className} hover:bg-surface`}
                >
                  {body}
                </a>
              </li>
            );
          }
          return (
            <li key={step.key} className={className}>
              {body}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
