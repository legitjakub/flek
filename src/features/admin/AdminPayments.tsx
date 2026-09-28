import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { adminPaymentIssues } from '../../lib/api';
import { money } from '../../lib/format';
import { clockTime, dayLabel } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { EmptyState, ErrorState, LoadingList } from '../../components/ui';
import type { AdminPaymentIssue } from '../../types/database';
import { AdminFrame } from './AdminPage';
import { PAYMENT_ISSUE_TEXT, PAYMENT_ISSUES_KEY, stripeDashboardUrl } from './paymentIssues';

/**
 * Money that waits for a person: refunds Stripe failed or never got, a hold that stayed on the card,
 * a capture that did not finish, a Stripe event that failed. Nothing here changes a payment; the
 * admin acts in Stripe and the webhook brings the result back.
 */
export function AdminPaymentsPage() {
  const now = useServerNow();
  const issues = useQuery({ queryKey: PAYMENT_ISSUES_KEY, queryFn: adminPaymentIssues, refetchInterval: 60_000 });
  return (
    <AdminFrame>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Platby k řešení</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Platby, u kterých automatika nestačila. Stav peněz FLEK mění jen podle Stripe: co vyřešíte v dashboardu Stripe, odsud do pár minut zmizí.
        O každém novém problému vám přijde e-mail.
      </p>
      {issues.isPending ? <LoadingList /> : null}
      {issues.isError ? <ErrorState error={issues.error} onRetry={() => issues.refetch()} /> : null}
      <ul className="mt-4 flex flex-col gap-2">
        {(issues.data ?? []).map((issue) => <IssueCard key={`${issue.kind}:${issue.ref}`} issue={issue} now={now} />)}
      </ul>
      {issues.isSuccess && issues.data.length === 0 ? <EmptyState title="Nic k řešení." /> : null}
    </AdminFrame>
  );
}

function IssueCard({ issue, now }: { issue: AdminPaymentIssue; now: string }) {
  const text = PAYMENT_ISSUE_TEXT[issue.kind];
  const url = stripeDashboardUrl(issue);
  return (
    <li className="tnum rounded-xl border border-line bg-card p-3 text-sm">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-bold text-ink">
          {text?.title ?? issue.kind}
          {issue.amount_cents != null ? ` · ${money(issue.amount_cents)}` : ''}
        </span>
        {issue.since ? <span className="text-muted">od {dayLabel(issue.since, now)} {clockTime(issue.since)}</span> : null}
      </p>
      {issue.service_name ? (
        <p className="mt-1 text-ink [overflow-wrap:anywhere]">
          {issue.service_name} · {issue.business_name}
          {issue.start_at ? ` · ${dayLabel(issue.start_at, now)} ${clockTime(issue.start_at)}` : ''}
        </p>
      ) : null}
      {text ? <p className="mt-1 text-muted">{text.action}</p> : null}
      {issue.detail ? (
        <p className="mt-1 text-muted [overflow-wrap:anywhere]">
          Důvod: <span className="text-ink">{issue.detail}</span>
          {issue.attempts ? ` · pokusů ${issue.attempts}` : ''}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-x-4">
        {issue.customer_email ? (
          <a href={`mailto:${issue.customer_email}`} className="inline-flex min-h-11 items-center font-bold text-ink underline underline-offset-4 [overflow-wrap:anywhere]">
            {issue.customer_email}
          </a>
        ) : null}
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-bold text-ink underline underline-offset-4">
            Otevřít ve Stripe <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </li>
  );
}
