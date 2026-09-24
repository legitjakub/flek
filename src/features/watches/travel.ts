import type { FlekWatch } from '../../types/database';

export type TravelMode = FlekWatch['travel_mode'];
export type TravelMinutes = FlekWatch['travel_minutes'];

/*
 * Metres of straight line per minute of travel. Mirrors `private.watch_radius` in the database,
 * which is what actually decides the circle; this copy only lets the sheet say how far that is
 * before saving. Walking 4.5 km/h; tram, metro or bike 12 km/h including the wait for a tram.
 * A route is always longer than the straight line, so the labels say „zhruba".
 */
const METRES_PER_MINUTE: Record<TravelMode, number> = { walk: 75, ride: 200 };

export const TRAVEL_MINUTES: TravelMinutes[] = [10, 20, 30];

export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = { walk: 'Pěšky', ride: 'MHD nebo kolo' };

export function watchRadius(mode: TravelMode, minutes: TravelMinutes): number {
  return METRES_PER_MINUTE[mode] * minutes;
}

/** „750 m", „2,3 km" — what the circle is in plain words, never broken between number and unit. */
export function radiusLabel(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 50) * 50}\u00a0m`;
  return `${(Math.round(metres / 100) / 10).toLocaleString('cs-CZ')}\u00a0km`;
}

/** „do 20 min pěšky", „do 30 min MHD nebo kolem". */
export function travelSentence(mode: TravelMode, minutes: TravelMinutes): string {
  return `do ${minutes} min ${mode === 'walk' ? 'pěšky' : 'MHD nebo kolem'}`;
}
