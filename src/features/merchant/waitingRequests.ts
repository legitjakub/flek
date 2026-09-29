import type { MerchantBooking } from '../../types/database';
import type { WaitingRequest } from './RequestRing';

/**
 * The requests of one venue that still wait for its answer right now, most urgent first. `venue` names
 * the venue on the full screen when the person runs more than one; the selected venue's own requests
 * leave it out and the screen shows the selected venue.
 */
export function waitingFrom(rows: MerchantBooking[] | undefined, businessId: string, now: string, venue?: string): WaitingRequest[] {
  return (rows ?? [])
    .filter((row) => row.business_id === businessId && row.confirmation_version === 1 && row.status === 'pending_merchant'
      && Boolean(row.authorized_at) && Date.parse(row.confirmation_expires_at ?? '') > Date.parse(now))
    .map((row) => ({
      id: row.id,
      deadline: row.confirmation_expires_at ?? null,
      authorizedAt: row.authorized_at ?? null,
      service: row.service_name_snapshot,
      startAt: row.start_at_snapshot,
      endAt: row.end_at_snapshot,
      customer: row.customer_label,
      payoutCents: row.merchant_payout_cents,
      ...(venue ? { venue, businessId } : {}),
    }))
    .sort(byDeadline);
}

export function byDeadline(a: Pick<WaitingRequest, 'deadline'>, b: Pick<WaitingRequest, 'deadline'>): number {
  return Date.parse(a.deadline ?? '') - Date.parse(b.deadline ?? '');
}
