import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminContentReports, adminResolveContentReport } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { clockTime, dayLabel } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, Field, LoadingList, Segmented, Sheet, Textarea } from '../../components/ui';
import { Link } from '../../app/router';
import { AdminFrame } from './AdminPage';
import type { AdminContentReport, ContentReportReason } from '../../types/database';

const REASON_LABELS: Record<ContentReportReason, string> = {
  misleading: 'Klamavé údaje',
  prohibited_service: 'Zakázaná služba',
  illegal: 'Nezákonný obsah',
  rights: 'Porušení práv',
  other: 'Jiné',
};

type Filter = 'open' | 'resolved';

/**
 * Notices under the Digital Services Act. Restricting the content itself happens where it lives
 * (the venue's status, the offer); here the notice gets its decision and reason on record.
 */
export function AdminReportsPage() {
  const [filter, setFilter] = useState<Filter>('open');
  const reports = useQuery({
    queryKey: ['admin-content-reports', filter],
    queryFn: async () => {
      const rows = await adminContentReports(filter === 'open' ? 'open' : null);
      return filter === 'open' ? rows : rows.filter((row) => row.status !== 'open');
    },
  });
  const [resolving, setResolving] = useState<AdminContentReport | null>(null);

  return (
    <AdminFrame>
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Nahlášený obsah</h1>
          <p className="mt-1 text-sm text-muted">
            Každé nahlášení posuzuje člověk, obvykle do 7 dnů. Nabídku nebo provozovnu omezte v příslušné sekci a tady zapište výsledek.
          </p>
        </div>
        <Segmented
          label="Stav nahlášení"
          value={filter}
          onChange={setFilter}
          options={[{ value: 'open', label: 'K vyřízení' }, { value: 'resolved', label: 'Vyřízené' }]}
          columns={2}
        />
        {reports.isPending ? <LoadingList rows={3} /> : null}
        {reports.isError ? <ErrorState error={reports.error} onRetry={() => reports.refetch()} /> : null}
        {reports.data && reports.data.length === 0 ? (
          <EmptyState title={filter === 'open' ? 'Žádné nahlášení nečeká.' : 'Zatím nic vyřízeného.'} />
        ) : null}
        <ul className="flex flex-col gap-3">
          {(reports.data ?? []).map((report) => (
            <ReportRow key={report.id} report={report} onResolve={() => setResolving(report)} />
          ))}
        </ul>
      </div>
      <ResolveSheet report={resolving} onClose={() => setResolving(null)} />
    </AdminFrame>
  );
}

function ReportRow({ report, onResolve }: { report: AdminContentReport; onResolve: () => void }) {
  const now = useServerNow();
  return (
    <li className="rounded-2xl bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-bold text-ink">
          {REASON_LABELS[report.reason]} ·{' '}
          <Link to={`/podnik/${report.business_id}`} className="underline underline-offset-4">{report.business_name}</Link>
          {report.service_name && report.offer_start_at ? ` · ${report.service_name}, ${dayLabel(report.offer_start_at, now)} ${clockTime(report.offer_start_at)}` : ''}
        </p>
        <span className="tnum text-sm text-muted">{dayLabel(report.created_at, now)} {clockTime(report.created_at)}</span>
      </div>
      <p className="mt-2 text-base whitespace-pre-line text-ink">{report.message}</p>
      <p className="mt-1 text-sm text-muted">
        Oznámil {report.reporter_email ?? 'smazaný účet'} · provozovna {report.business_status}{report.offer_status ? ` · nabídka ${report.offer_status}` : ''}
      </p>
      {report.status === 'open' ? (
        <Button variant="secondary" className="mt-3" onClick={onResolve}>Vyřídit</Button>
      ) : (
        <p className="mt-2 text-sm text-ink">
          <span className="font-bold">{report.status === 'actioned' ? 'Omezeno' : 'Bez porušení'}:</span> {report.resolution}
        </p>
      )}
    </li>
  );
}

function ResolveSheet({ report, onClose }: { report: AdminContentReport | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState('');
  const resolve = useMutation({
    mutationFn: (status: 'actioned' | 'dismissed') => adminResolveContentReport(report!.id, status, resolution.trim()),
    onSuccess: async () => {
      setResolution('');
      onClose();
      await queryClient.invalidateQueries({ queryKey: ['admin-content-reports'] });
    },
  });
  const tooShort = resolution.trim().length < 3;
  return (
    <Sheet
      open={Boolean(report)}
      onClose={onClose}
      title="Vyřídit nahlášení"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" disabled={tooShort} loading={resolve.isPending && resolve.variables === 'actioned'} onClick={() => resolve.mutate('actioned')}>
            Obsah jsme omezili
          </Button>
          <Button variant="secondary" className="flex-1" disabled={tooShort} loading={resolve.isPending && resolve.variables === 'dismissed'} onClick={() => resolve.mutate('dismissed')}>
            Bez porušení
          </Button>
        </div>
      }
    >
      <Field id="report-resolution" label="Odůvodnění" hint="Co jste zjistili a podle jakého pravidla nebo zákona. Zapíše se do auditu.">
        <Textarea id="report-resolution" data-autofocus maxLength={2000} value={resolution} onChange={(event) => setResolution(event.target.value)} />
      </Field>
      {resolve.isError ? <div className="mt-3"><Banner tone="warning">{errorMessage(resolve.error, 'merchant')}</Banner></div> : null}
    </Sheet>
  );
}
