import { localInput } from '../../lib/time';
import type { MerchantOffer, Service } from '../../types/database';

/** Only inputs to publish_flek, never inventory, status or a financial snapshot. */
export type OfferDraft = { service_id: string; merchant_price_cents: number; start_at?: string; capacity_total?: number } | null;
// Existing form bounds; publish_flek remains authoritative.
export const MAX_DAYS_AHEAD = 7;
export const MIN_MINUTES_AHEAD = 10;

export function repeatSlot(previousStart: string | undefined, now: string): string {
  const instant = Date.parse(previousStart ?? '');
  const clock = Date.parse(now);
  if (!Number.isFinite(instant) || instant < clock + MIN_MINUTES_AHEAD * 60_000 || instant > clock + MAX_DAYS_AHEAD * 86400_000) return '';
  // Validate the minute precision that the input will actually publish.
  const value = localInput(new Date(instant).toISOString());
  return Math.floor(instant / 60_000) * 60_000 < clock + MIN_MINUTES_AHEAD * 60_000 ? '' : value;
}

export function repeatDraft(offer: MerchantOffer): NonNullable<OfferDraft> {
  return { service_id: offer.service_id, merchant_price_cents: offer.merchant_price_cents, capacity_total: offer.capacity_total, start_at: offer.start_at };
}

/** Latest publication per active service; ended, sold-out and cancelled offers are all templates. */
export function recentOffers(offers: MerchantOffer[], services: Service[]): MerchantOffer[] {
  const active = new Set(services.filter((s) => s.is_active).map((s) => s.id));
  const seen = new Set<string>();
  return [...offers].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .filter((offer) => {
      if (!active.has(offer.service_id) || seen.has(offer.service_id)) return false;
      seen.add(offer.service_id);
      return true;
    }).slice(0, 3);
}
