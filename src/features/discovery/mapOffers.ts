import type { SearchRow } from '../../types/database';

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
    const id = `${offer.latitude.toFixed(5)},${offer.longitude.toFixed(5)}`;
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
