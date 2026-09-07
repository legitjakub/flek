export type Point = { lat: number; lng: number; label: string };

/** Prague centre. The city is data everywhere else; this is only the fallback pin. */
export const DEFAULT_POINT: Point = { lat: 50.0875, lng: 14.4213, label: 'Praha' };

const KEY = 'flek.location';

export function storedPoint(): Point | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Point;
    return typeof p?.lat === 'number' && typeof p?.lng === 'number' ? p : null;
  } catch {
    return null;
  }
}

export function storePoint(point: Point) {
  try {
    localStorage.setItem(KEY, JSON.stringify(point));
  } catch {
    /* private mode: the in-memory point still works for this session */
  }
}

/** Resolves to the device position, or rejects so the caller can keep the manual pin. */
export function locate(): Promise<Point> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('NO_GEOLOCATION'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, label: 'Moje poloha' }),
      () => reject(new Error('GEOLOCATION_DENIED')),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
    );
  });
}

/** A handful of Prague districts so a customer without geolocation can still pick a place. */
export const PRESET_POINTS: Point[] = [
  DEFAULT_POINT,
  { lat: 50.0757, lng: 14.4475, label: 'Vinohrady' },
  { lat: 50.0923, lng: 14.4516, label: 'Karlín' },
  { lat: 50.1024, lng: 14.4482, label: 'Holešovice' },
  { lat: 50.0698, lng: 14.4034, label: 'Smíchov' },
  { lat: 50.0985, lng: 14.4012, label: 'Dejvice' },
  { lat: 50.0809, lng: 14.4528, label: 'Žižkov' },
];
