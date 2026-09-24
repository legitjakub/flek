/**
 * How many metres one screen pixel covers at a latitude and zoom. MapLibre renders 512 px tiles,
 * so zoom 0 fits the equator's 40 075 km into 512 pixels and every zoom level halves it; away from
 * the equator Web Mercator stretches the map by 1 / cos(latitude).
 */
export function metersPerPixel(lat: number, zoom: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** The diameter in pixels of a circle of `radius_m` metres drawn at that latitude and zoom. */
export function circleDiameterPx(lat: number, zoom: number, radius_m: number): number {
  return (2 * radius_m) / metersPerPixel(lat, zoom);
}

/** Great-circle distance in metres; plenty precise for „has the customer moved 300 m". */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
