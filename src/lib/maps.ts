/**
 * Links out to a map application.
 *
 * One helper, because the two places that need it — the offer detail and the screen shown
 * straight after booking — used to carry the same URL twice, interpolated raw. Two copies of
 * a URL template is how they quietly stop matching.
 */

type Destination = {
  latitude: number;
  longitude: number;
  /** Set once an admin has linked the venue; makes Google land on the business, not a point. */
  google_place_id?: string | null;
};

/**
 * Google Maps in directions mode. On a phone this opens the Google Maps app when it is
 * installed and the website otherwise; either way the person gets a route rather than a
 * marker they still have to press "navigate" on.
 *
 * Coordinates come first because they are always right. The Place ID is added when we have
 * one: Google then labels the destination with the venue's own name instead of a raw pin.
 */
export function navigationHref(destination: Destination): string {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.latitude},${destination.longitude}`,
  });
  const placeId = destination.google_place_id?.trim();
  if (placeId) params.set('destination_place_id', placeId);
  return `https://www.google.com/maps/dir/?${params}`;
}
