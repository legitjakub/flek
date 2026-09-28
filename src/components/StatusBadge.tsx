import { cx } from './ui';
import type { BookingStatus, BusinessStatus, OfferStatus, PaymentStatus } from '../types/database';

export type AppStatus = BookingStatus | BusinessStatus | OfferStatus | PaymentStatus;
export type BadgeTone = 'positive' | 'warning' | 'danger' | 'neutral';
type Tone = BadgeTone;

const META: Record<AppStatus, { label: string; tone: Tone }> = {
  pending_payment: { label: 'Probíhá platba', tone: 'warning' },
  pending_merchant: { label: 'Čeká na potvrzení', tone: 'warning' },
  capturing: { label: 'Dokončuje se platba', tone: 'warning' },
  confirmed: { label: 'Potvrzeno', tone: 'positive' },
  completed: { label: 'Dokončeno', tone: 'positive' },
  no_show: { label: 'Nedorazil/a', tone: 'danger' },
  cancelled_by_customer: { label: 'Zrušeno zákazníkem', tone: 'danger' },
  cancelled_by_merchant: { label: 'Zrušeno podnikem', tone: 'danger' },
  expired: { label: 'Nepotvrzeno včas', tone: 'neutral' },
  payment_failed: { label: 'Platba se nezdařila', tone: 'danger' },
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
  return <ToneBadge tone={meta.tone} label={label ?? meta.label} />;
}

/** The badge itself, for a label whose colour follows its meaning rather than a stored status. */
export function ToneBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  return (
    <span
      className={cx(
        'inline-flex min-h-6 items-center rounded-md px-2 py-0.5 text-xs font-bold',
        tone === 'positive' && 'bg-positive/10 text-positive',
        tone === 'warning' && 'bg-warning-soft text-warning',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'neutral' && 'bg-surface text-muted',
      )}
    >
      {label}
    </span>
  );
}
