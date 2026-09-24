import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Check, ChevronRight, Clock3, HelpCircle } from 'lucide-react';
import { businessBilling, businessPaymentsStatus, merchantOffers } from '../../lib/api';
import { Link } from '../../app/router';
import { Button, buttonClass, cx } from '../../components/ui';
import { NOTIFICATIONS_ENABLED, useDevicePush, usePreferenceQuery } from '../notifications/Notifications';
import { useWhatsAppSettings } from '../notifications/WhatsApp';
import { useServices } from './useBusiness';
import { openPartnerHelp } from './PartnerHelp';
import type { Business } from '../../types/database';

const PREVIEWED = 'flek.merchant.previewed.';

type Missing = 'payments' | 'service' | 'approval';

/**
 * What stands between a venue and its first FLEK, checked the way `publish_flek` checks it:
 * Stripe able to take payments, an active service, an approved venue. The steps a venue can
 * take come first; approval is FLEK's, so it is named last.
 */
export function usePublishReadiness(business: Business) {
  const services = useServices(business.id);
  const payments = useQuery({
    queryKey: ['business-payments', business.id],
    queryFn: () => businessPaymentsStatus(business.id),
    staleTime: 60_000,
  });
  const loading = services.isPending || payments.isPending;
  const missing: Missing | null = !payments.data?.charges_enabled
    ? 'payments'
    : !(services.data ?? []).some((service) => service.is_active)
      ? 'service'
      : business.status !== 'approved'
        ? 'approval'
        : null;
  return { loading, canPublish: !loading && missing === null, missing: loading ? null : missing };
}

const MISSING: Record<Missing, { text: string; label?: string; to?: string }> = {
  payments: {
    text: 'Než zveřejníte první FLEK, propojte platby přes Stripe. Zákazníci u vás platí kartou a Stripe vám posílá výplaty.',
    label: 'Propojit platby',
    to: '/partner/provozovna?sekce=platby',
  },
  service: {
    text: 'Než zveřejníte první FLEK, přidejte službu, kterou nabízíte. Stačí délka a běžná cena.',
    label: 'Přidat službu',
    to: '/partner/sluzby?nova=1',
  },
  approval: {
    text: 'Provozovnu ještě kontrolujeme, obvykle do 24 hodin. Pak tady zveřejníte první FLEK.',
  },
};

/** One line where a venue would otherwise meet a button it cannot use yet: what is missing and a way to it. */
export function SetupNotice({ business }: { business: Business }) {
  const { missing } = usePublishReadiness(business);
  if (!missing) return null;
  const copy = MISSING[missing];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-accent-soft px-4 py-3">
      <p className="min-w-0 flex-1 basis-60 text-sm text-ink">{copy.text}</p>
      {copy.to ? (
        <Link to={copy.to} className={buttonClass({ size: 'sm' })}>
          {copy.label}
        </Link>
      ) : null}
    </div>
  );
}

type Step = {
  key: string;
  title: string;
  body: string;
  done: boolean;
  /** Said in the row itself while the step waits on someone else (FLEK, Stripe). */
  waiting?: string | null;
  /** The way to do it: a link, or on the last step the offer sheet itself. */
  action?: { label: string; to?: string; href?: string; onClick?: () => void } | null;
};

/**
 * "Začínáme" on the dashboard of a venue that has not published its first FLEK yet.
 *
 * A guide, not a tour: nothing pops up, nothing covers the page. It shows how far the venue is,
 * opens only the one step to do next — why it matters and a button to it — and keeps the rest to a
 * line each. It leaves on its own once the venue is ready: the optional rows below never keep it
 * on screen, which is what made the old checklist stay for good on venues that simply never
 * opened their public page.
 */
export function SetupGuide({ business, onAddOffer }: { business: Business; onAddOffer: () => void }) {
  const services = useServices(business.id);
  const offers = useQuery({ queryKey: ['merchant-offers', business.id], queryFn: () => merchantOffers(business.id) });
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
  const whatsapp = useWhatsAppSettings(business.id);
  const preferences = usePreferenceQuery(business.id);
  const device = useDevicePush();
  const [previewed, setPreviewed] = useState(() => {
    try {
      return window.localStorage.getItem(PREVIEWED + business.id) === '1';
    } catch {
      return false;
    }
  });

  if (services.isPending || offers.isPending || billing.isPending || payments.isPending || whatsapp.isLoading) return null;

  const approved = business.status === 'approved';
  const paymentsReady = Boolean(payments.data?.charges_enabled);
  const hasService = (services.data ?? []).some((service) => service.is_active);
  const canPublish = approved && paymentsReady && hasService;

  const required: Step[] = [
    {
      key: 'billing',
      title: 'Údaje pro výplaty',
      body: 'IČO, bankovní účet a souhlas s podmínkami pro podniky. Bez IČO provozovnu neschválíme.',
      // Once merchant terms are in force, only an acceptance of that version counts.
      done: Boolean(billing.data?.bank_account && billing.data?.terms_accepted_at && (billing.data.terms_accepted_current ?? true)),
      action: { label: 'Doplnit údaje', to: '/partner/provozovna?sekce=fakturace' },
    },
    {
      key: 'approved',
      title: 'Schválení provozovny',
      body: '',
      done: approved,
      waiting: business.status === 'pending'
        ? 'Kontrolujeme údaje, obvykle do 24 hodin.'
        : business.status === 'rejected'
          ? 'Registrace byla zamítnuta, důvod je nahoře.'
          : 'Provozovna je pozastavená, důvod je nahoře.',
    },
    {
      key: 'payments',
      title: 'Platby přes Stripe',
      body: 'Zákazníci platí kartou přes Stripe a ten vám posílá výplaty na účet. Propojení zabere pár minut.',
      done: paymentsReady,
      waiting: payments.data?.connected ? 'Stripe ještě ověřuje údaje.' : null,
      action: { label: payments.data?.connected ? 'Pokračovat u Stripe' : 'Propojit se Stripe', to: '/partner/provozovna?sekce=platby' },
    },
    {
      key: 'service',
      title: 'První služba',
      body: 'Vyberte z připravených služeb, nebo založte vlastní. Stačí délka a běžná cena.',
      done: hasService,
      action: { label: 'Přidat službu', to: '/partner/sluzby?nova=1' },
    },
    {
      key: 'offer',
      title: 'První FLEK',
      body: 'Vyberte službu, čas a kolik za termín chcete dostat. Zákazníci ho hned uvidí na mapě.',
      done: (offers.data ?? []).length > 0,
      action: canPublish ? { label: 'Přidat volný termín', onClick: onAddOffer } : null,
    },
  ];
  if (required.every((step) => step.done)) return null;

  const requestPush = preferences.data?.find((preference) => preference.event === 'requested')?.push ?? false;
  const optional: Step[] = [
    ...(NOTIFICATIONS_ENABLED
      ? [{
          key: 'alerts',
          title: 'Upozornění na žádosti v telefonu',
          body: 'Na potvrzení máte jen pár minut.',
          done: Boolean(device.on && requestPush),
          action: { label: 'Nastavit', to: '/partner/provozovna?sekce=upozorneni' },
        }]
      : []),
    // Only once FLEK can send WhatsApp; switching it off counts as a decision, not as a missing step.
    ...(whatsapp.data?.available
      ? [{
          key: 'whatsapp',
          title: 'Potvrzování přes WhatsApp',
          body: 'Žádost přijde i do WhatsAppu a potvrdíte ji tlačítkem.',
          done: ['verified', 'disabled'].includes(whatsapp.data.status),
          action: { label: 'Zapnout', to: '/partner/provozovna?sekce=whatsapp' },
        }]
      : []),
    ...(approved
      ? [{
          key: 'preview',
          title: 'Jak vás vidí zákazníci',
          body: 'Vaše stránka ve FLEKu, jak ji najdou zákazníci.',
          done: previewed,
          action: { label: 'Otevřít', href: `/podnik/${business.id}` },
        }]
      : []),
  ];

  const done = required.filter((step) => step.done).length;
  // The one step opened out: the first the venue can do now. Approval is FLEK's, so it is never it.
  const current = required.find((step) => !step.done && step.action);

  function markPreviewed() {
    setPreviewed(true);
    try {
      window.localStorage.setItem(PREVIEWED + business.id, '1');
    } catch {
      /* the row simply stays open in private mode */
    }
  }

  return (
    <section className="max-w-3xl rounded-2xl bg-card p-5 shadow-card sm:p-6" aria-labelledby="zaciname">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="zaciname" className="text-lg font-extrabold tracking-tight text-ink">Začínáme</h2>
        <p className="tnum text-sm font-bold text-muted">{done} z {required.length} hotovo</p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-surface"
        role="progressbar"
        aria-label="Nastavení provozovny"
        aria-valuemin={0}
        aria-valuemax={required.length}
        aria-valuenow={done}
      >
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${(done / required.length) * 100}%` }} />
      </div>

      <ol className="mt-4 flex flex-col gap-1">
        {required.map((step, index) => (
          <StepRow key={step.key} step={step} number={index + 1} open={step === current} />
        ))}
      </ol>

      {optional.some((step) => !step.done) ? (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs font-bold tracking-wide text-muted uppercase">Doporučujeme</p>
          <ul className="mt-1 flex flex-col">
            {optional.filter((step) => !step.done).map((step) => (
              <li key={step.key}>
                <OptionalRow step={step} onOpen={step.key === 'preview' ? markPreviewed : undefined} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        onClick={openPartnerHelp}
        className="mt-3 -ml-1 inline-flex min-h-11 items-center gap-2 rounded-xl px-1 text-sm font-bold text-accent hover:underline"
      >
        <HelpCircle size={17} aria-hidden="true" />
        Jak FLEK funguje
      </button>
    </section>
  );
}

function StepRow({ step, number, open }: { step: Step; number: number; open: boolean }) {
  const mark = step.done ? (
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-positive/12 text-positive" aria-hidden="true">
      <Check size={15} strokeWidth={3} />
    </span>
  ) : step.waiting ? (
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-warning-soft text-warning" aria-hidden="true">
      <Clock3 size={15} strokeWidth={2.5} />
    </span>
  ) : (
    <span
      className={cx(
        'tnum grid size-7 shrink-0 place-items-center rounded-full text-sm font-extrabold',
        open ? 'bg-brand text-brand-ink' : 'border-2 border-line text-muted',
      )}
      aria-hidden="true"
    >
      {number}
    </span>
  );
  const state = step.done ? 'hotovo' : step.waiting ? 'čeká' : open ? 'teď na řadě' : 'zbývá';

  if (open && step.action) {
    return (
      <li className="my-1 rounded-2xl bg-accent-soft p-4">
        <div className="flex items-start gap-3">
          {mark}
          <div className="min-w-0 flex-1">
            <p className="text-base font-extrabold text-ink">
              {step.title}
              <span className="sr-only"> — {state}</span>
            </p>
            {step.waiting ? <p className="mt-0.5 text-sm font-bold text-warning">{step.waiting}</p> : null}
            <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
            <div className="mt-3">
              <Action action={step.action} primary />
            </div>
          </div>
        </div>
      </li>
    );
  }

  const row = (
    <>
      {mark}
      <span className="min-w-0 flex-1">
        <span className={cx('block text-sm font-bold', step.done ? 'text-muted' : 'text-ink')}>
          {step.title}
          <span className="sr-only"> — {state}</span>
        </span>
        {step.waiting && !step.done ? <span className="block text-sm text-muted">{step.waiting}</span> : null}
      </span>
    </>
  );
  // A step the venue can already do stays one tap away, even while another one is on turn.
  if (!step.done && step.action?.to) {
    return (
      <li>
        <Link to={step.action.to} className="-mx-2 flex min-h-12 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface">
          {row}
          <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
        </Link>
      </li>
    );
  }
  return <li className="flex min-h-12 items-center gap-3 py-1.5">{row}</li>;
}

function OptionalRow({ step, onOpen }: { step: Step; onOpen?: () => void }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-ink">{step.title}</span>
        <span className="block text-sm text-muted">{step.body}</span>
      </span>
      <span className="shrink-0 text-sm font-bold text-accent">{step.action?.label}</span>
    </>
  );
  const className = '-mx-2 flex min-h-12 items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface';
  if (step.action?.href) {
    return (
      <a href={step.action.href} target="_blank" rel="noreferrer" onClick={onOpen} className={className}>
        {body}
      </a>
    );
  }
  return step.action?.to ? <Link to={step.action.to} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

function Action({ action, primary }: { action: NonNullable<Step['action']>; primary?: boolean }): ReactNode {
  if (action.onClick) {
    return <Button onClick={action.onClick}>{action.label}</Button>;
  }
  return (
    <Link to={action.to ?? '/partner'} className={buttonClass({ variant: primary ? 'primary' : 'secondary' })}>
      {action.label}
    </Link>
  );
}
