import { cx } from './ui';
import type { BookingStatus, BusinessStatus, OfferStatus, PaymentStatus } from '../types/database';

export type AppStatus = BookingStatus | BusinessStatus | OfferStatus | PaymentStatus;
type Tone = 'positive' | 'warning' | 'danger' | 'neutral';

const META: Record<AppStatus, { label: string; tone: Tone }> = {
  confirmed: { label: 'Potvrzeno', tone: 'positive' },
  completed: { label: 'Dokončeno', tone: 'positive' },
  no_show: { label: 'Nedorazil/a', tone: 'danger' },
  cancelled_by_customer: { label: 'Zrušeno zákazníkem', tone: 'danger' },
  cancelled_by_merchant: { label: 'Zrušeno podnikem', tone: 'danger' },
  pending: { label: 'Čeká na vyřízení', tone: 'warning' },
  approved: { label: 'Schváleno', tone: 'positive' },
  rejected: { label: 'Zamítnuto', tone: 'danger' },
  suspended: { label: 'Pozastaveno', tone: 'danger' },
  draft: { label: 'Koncept', tone: 'neutral' },
  published: { label: 'Zveřejněno', tone: 'positive' },
  cancelled: { label: 'Zrušeno', tone: 'danger' },
  paid: { label: 'Zaplaceno', tone: 'positive' },
  refunded: { label: 'Vráceno', tone: 'neutral' },
  failed: { label: 'Platba selhala', tone: 'danger' },
};

export function statusMeta(status: AppStatus): { label: string; tone: Tone } {
  return META[status];
}

export function StatusBadge({ status, label }: { status: AppStatus; label?: string }) {
  const meta = statusMeta(status);
  return (
    <span
      className={cx(
        'inline-flex min-h-6 items-center rounded-md px-2 py-0.5 text-xs font-bold',
        meta.tone === 'positive' && 'bg-positive/10 text-positive',
        meta.tone === 'warning' && 'bg-warning-soft text-warning',
        meta.tone === 'danger' && 'bg-danger-soft text-danger',
        meta.tone === 'neutral' && 'bg-surface text-muted',
      )}
    >
      {label ?? meta.label}
    </span>
  );
}
