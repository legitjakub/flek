import type { AdminPaymentIssue, PaymentIssueKind } from '../../types/database';

/** One query for the list and the count in the admin navigation. */
export const PAYMENT_ISSUES_KEY = ['admin-payment-issues'] as const;

/**
 * What each kind of payment problem means for the admin and what to do about it. FLEK changes the
 * state of money only on Stripe's word, so every step points to Stripe; whatever is resolved there
 * leaves this list by itself.
 */
export const PAYMENT_ISSUE_TEXT: Record<PaymentIssueKind, { title: string; action: string }> = {
  refund_failed: {
    title: 'Vratka selhala',
    action: 'Stripe peníze zákazníkovi nevrátil. Vraťte je jinou cestou (nová vratka v dashboardu Stripe nebo převod) a zákazníkovi napište.',
  },
  refund_stuck: {
    title: 'Vratka se nedostala do Stripe',
    action: 'Osm pokusů skončilo chybou spojení. Zkontrolujte platbu ve Stripe a vratku zadejte v dashboardu, FLEK ji zapíše sám.',
  },
  refund_waiting: {
    title: 'Vratka čeká',
    action: 'Stripe čeká na akci, nebo vratka visí déle než 3 dny. Otevřete platbu ve Stripe.',
  },
  paid_without_booking: {
    title: 'Zaplaceno bez rezervace',
    action: 'Platba nemá rezervaci a automatická vratka se nespustila. Zkontrolujte údržbu (cron) a vratku zadejte ve Stripe.',
  },
  release_stuck: {
    title: 'Blokace se neuvolnila',
    action: 'Zákazník má částku dál zablokovanou na kartě. Ve Stripe platbu zrušte (Cancel), FLEK to zapíše sám.',
  },
  capture_stuck: {
    title: 'Stržení nedoběhlo',
    action: 'Podnik rezervaci potvrdil, ale platba se nestrhla. Zkontrolujte ji ve Stripe; worker ji po výpadku strhne nebo blokaci uvolní.',
  },
  webhook_failed: {
    title: 'Událost ze Stripe selhala',
    action: 'Stripe ji zkusí doručit znovu. Když chyba trvá, podívejte se do logů funkce stripe-webhook.',
  },
};

/** The page in the Stripe dashboard where the issue is resolved, in the mode the payment was made in. */
export function stripeDashboardUrl(issue: Pick<AdminPaymentIssue, 'kind' | 'ref' | 'payment_intent_id' | 'livemode'>): string | null {
  const base = `https://dashboard.stripe.com/${issue.livemode ? '' : 'test/'}`;
  if (issue.kind === 'webhook_failed') return `${base}events/${encodeURIComponent(issue.ref)}`;
  return issue.payment_intent_id ? `${base}payments/${encodeURIComponent(issue.payment_intent_id)}` : null;
}

/** „3 platby k řešení“: the nav shows the count, the heading says what it counts. */
export function issueCountLabel(count: number): string {
  if (count === 1) return '1 platba k řešení';
  if (count >= 2 && count <= 4) return `${count} platby k řešení`;
  return `${count} plateb k řešení`;
}
