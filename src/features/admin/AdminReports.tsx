import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminContentModeration, adminContentReports, adminResolveContentModeration, adminResolveContentReport, moderationImageUrl } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { clockTime, dayLabel } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, Field, LoadingList, Segmented, Sheet, Textarea } from '../../components/ui';
import { Link } from '../../app/router';
import { AdminFrame } from './AdminPage';
import type { AdminContentModeration, AdminContentReport, ContentReportReason } from '../../types/database';

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
  const [section, setSection] = useState<'reports' | 'moderation'>('reports');
  const [filter, setFilter] = useState<Filter>('open');
  const reports = useQuery({
    queryKey: ['admin-content-reports', filter],
    queryFn: async () => {
      const rows = await adminContentReports(filter === 'open' ? 'open' : null);
      return filter === 'open' ? rows : rows.filter((row) => row.status !== 'open');
    },
    enabled: section === 'reports',
  });
  const [resolving, setResolving] = useState<AdminContentReport | null>(null);

  return (
    <AdminFrame>
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Bezpečnost obsahu</h1>
          <p className="mt-1 text-sm text-muted">
            Nahlášení od lidí a obsah označený automatickou kontrolou se řeší odděleně a každé rozhodnutí se zapisuje do auditu.
          </p>
        </div>
        <Segmented
          label="Druh kontroly"
          value={section}
          onChange={setSection}
          options={[{ value: 'reports', label: 'Nahlášení' }, { value: 'moderation', label: 'Ke kontrole' }]}
          columns={2}
        />
        {section === 'reports' ? (
          <>
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
          </>
        ) : <ModerationPanel />}
      </div>
      {section === 'reports' ? <ResolveSheet report={resolving} onClose={() => setResolving(null)} /> : null}
    </AdminFrame>
  );
}

function ModerationPanel() {
  const [filter, setFilter] = useState<'open' | 'resolved'>('open');
  const [selected, setSelected] = useState<AdminContentModeration | null>(null);
  const queue = useQuery({
    queryKey: ['admin-content-moderation', filter],
    queryFn: async () => {
      const rows = await adminContentModeration(filter === 'open' ? 'manual_review' : null);
      return filter === 'open' ? rows : rows.filter((row) => ['approved', 'rejected'].includes(row.status));
    },
  });
  return (
    <>
      <Segmented
        label="Stav automatické kontroly"
        value={filter}
        onChange={setFilter}
        options={[{ value: 'open', label: 'Čeká na člověka' }, { value: 'resolved', label: 'Rozhodnuté' }]}
        columns={2}
      />
      {queue.isPending ? <LoadingList rows={3} /> : null}
      {queue.isError ? <ErrorState error={queue.error} onRetry={() => queue.refetch()} /> : null}
      {queue.data?.length === 0 ? <EmptyState title={filter === 'open' ? 'Nic nečeká na kontrolu.' : 'Zatím tu není žádné rozhodnutí.'} /> : null}
      <ul className="flex flex-col gap-3">
        {(queue.data ?? []).map((item) => <ModerationRow key={item.id} item={item} onOpen={() => setSelected(item)} />)}
      </ul>
      <ModerationSheet item={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function ModerationRow({ item, onOpen }: { item: AdminContentModeration; onOpen: () => void }) {
  const now = useServerNow();
  const imagePath = Object.values(item.image_paths ?? {})[0];
  const image = useQuery({
    queryKey: ['moderation-image', imagePath],
    queryFn: () => moderationImageUrl(imagePath),
    enabled: Boolean(imagePath),
    staleTime: 4 * 60_000,
  });
  const title = item.entity_type === 'review' ? 'Recenze'
    : item.entity_type === 'service' ? 'Služba' : 'Provozovna';
  const primary = String(item.payload.name ?? item.payload.display_name ?? item.payload.body ?? 'Obsah bez názvu');
  return (
    <li className="overflow-hidden rounded-2xl bg-card shadow-card">
      <div className="flex gap-3 p-4">
        {image.data ? <img src={image.data} alt="Soukromý náhled obsahu ke kontrole" className="size-24 shrink-0 rounded-xl object-cover" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-bold text-ink">{title}{item.business_name ? ` · ${item.business_name}` : ''}</p>
            <span className="tnum text-xs text-muted">{dayLabel(item.created_at, now)} {clockTime(item.created_at)}</span>
          </div>
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink">{primary}</p>
          {item.last_error ? <p className="mt-1 text-xs font-medium text-danger">{item.last_error}</p> : null}
          {item.status === 'manual_review' ? <Button variant="secondary" size="sm" className="mt-3" onClick={onOpen}>Posoudit</Button>
            : <p className="mt-2 text-xs font-bold text-muted">{item.status === 'approved' ? 'Schváleno' : 'Zamítnuto'}</p>}
        </div>
      </div>
    </li>
  );
}

function ModerationSheet({ item, onClose }: { item: AdminContentModeration | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const resolve = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => adminResolveContentModeration(item!.id, decision, note),
    onSuccess: async () => {
      setNote('');
      onClose();
      await queryClient.invalidateQueries({ queryKey: ['admin-content-moderation'] });
    },
  });
  const copy = item ? Object.entries(item.payload)
    .filter(([, value]) => typeof value === 'string' && value)
    .map(([key, value]) => `${key === 'body' ? 'Text' : key === 'description' ? 'Popis' : 'Název'}: ${value}`)
    .join('\n\n') : '';
  return (
    <Sheet
      open={Boolean(item)}
      onClose={onClose}
      title="Kontrola obsahu"
      footer={
        <div className="flex gap-2">
          <Button className="flex-1" loading={resolve.isPending && resolve.variables === 'approve'} onClick={() => resolve.mutate('approve')}>Schválit</Button>
          <Button variant="danger" className="flex-1" loading={resolve.isPending && resolve.variables === 'reject'} onClick={() => resolve.mutate('reject')}>Zamítnout</Button>
        </div>
      }
    >
      <p className="whitespace-pre-line rounded-2xl bg-surface p-4 text-sm leading-relaxed text-ink">{copy}</p>
      <Field id="moderation-note" label="Interní poznámka" hint="Nepovinná; uloží se do auditního záznamu.">
        <Textarea id="moderation-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {resolve.isError ? <div className="mt-3"><Banner tone="warning">{errorMessage(resolve.error, 'merchant')}</Banner></div> : null}
    </Sheet>
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
