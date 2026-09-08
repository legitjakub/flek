/**
 * Address lookup for the merchant form. Photon is OpenStreetMap-backed, needs no API key
 * and answers fast enough to type against. Coordinates come from the picked address, so a
 * merchant never has to know what a latitude is.
 */
export type AddressSuggestion = {
  id: string;
  label: string;
  address_line: string;
  city: string;
  district: string;
  postal_code: string;
  latitude: number;
  longitude: number;
};

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number | string;
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    district?: string;
    state?: string;
    country?: string;
    countrycode?: string;
  };
};

function toSuggestion(feature: PhotonFeature, index: number): AddressSuggestion | null {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const street = p.street ?? p.name ?? '';
  const addressLine = [street, p.housenumber].filter(Boolean).join(' ').trim();
  if (!addressLine) return null;

  const city = p.city ?? p.state ?? '';
  // Photon returns "obvod Praha 2"; the district shown on cards reads better without it.
  const district = (p.district ?? '').replace(/^obvod\s+/i, '');

  return {
    id: `${p.osm_id ?? 'x'}-${index}`,
    label: [p.name && p.name !== street ? p.name : null, addressLine, p.postcode, city]
      .filter(Boolean)
      .join(', '),
    address_line: addressLine,
    city,
    district,
    postal_code: (p.postcode ?? '').replace(/\s+/g, ' ').trim(),
    latitude: lat,
    longitude: lng,
  };
}

export async function searchAddress(query: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '6');
  url.searchParams.set('lang', 'default');
  // Bias towards Prague so a bare street name resolves to the pilot city first.
  url.searchParams.set('lat', '50.0875');
  url.searchParams.set('lon', '14.4213');

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('ADDRESS_LOOKUP_FAILED');
  const data = (await response.json()) as { features?: PhotonFeature[] };

  const seen = new Set<string>();
  return (data.features ?? [])
    .map(toSuggestion)
    .filter((s): s is AddressSuggestion => s !== null)
    .filter((s) => {
      const key = `${s.address_line}|${s.postal_code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}
