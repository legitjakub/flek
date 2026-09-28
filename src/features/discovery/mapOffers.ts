import type { SearchRow } from '../../types/database';
import type { SlotGroup } from './slots';

export const mapLocationId = (offer: Pick<SearchRow, 'latitude' | 'longitude'>) =>
  `${offer.latitude.toFixed(5)},${offer.longitude.toFixed(5)}`;

/** A pin keeps its current service, or opens its first service in the shared result order. */
export function serviceForMapPin(cards: SlotGroup[], pinId: string, currentKey: string | null): SlotGroup | undefined {
  const matches = cards.filter((card) => mapLocationId(card.lead) === pinId);
  return matches.find((card) => card.key === currentKey) ?? matches[0];
}

export type MapOfferGroup = {
  id: string;
  lat: number;
  lng: number;
  minPrice: number;
  offers: SearchRow[];
};

/** One marker per address: co-located appointments must all remain reachable. */
export function groupMapOffers(rows: SearchRow[]): MapOfferGroup[] {
  const groups = new Map<string, MapOfferGroup>();
  for (const offer of rows) {
    const id = mapLocationId(offer);
    const group = groups.get(id);
    if (group) {
      group.offers.push(offer);
      group.minPrice = Math.min(group.minPrice, offer.deal_price_cents);
    } else {
      groups.set(id, { id, lat: offer.latitude, lng: offer.longitude, minPrice: offer.deal_price_cents, offers: [offer] });
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    offers: group.offers.sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id)),
  }));
}
