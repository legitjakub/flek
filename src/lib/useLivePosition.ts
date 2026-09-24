import { useEffect, useState } from 'react';

export type LivePosition = { lat: number; lng: number; accuracy: number };

/**
 * Asks the browser whether the customer already allowed FLEK to know where they are. Only then
 * does the map start following them on its own; otherwise it waits for a tap on „Moje poloha",
 * because a permission prompt the moment a map opens is how people learn to press „Block".
 */
export async function locationAlreadyAllowed(): Promise<boolean> {
  try {
    if (!('permissions' in navigator)) return false;
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

/**
 * The device position while `active`, updated as the customer walks. It never leaves the browser
 * and is never stored: the dot on the map is drawn from memory, and the search only moves when the
 * customer asks for it. Tracking stops the moment the map closes.
 */
export function useLivePosition(active: boolean): { position: LivePosition | null; denied: boolean } {
  const [position, setPosition] = useState<LivePosition | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setDenied(false);
        setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) setDenied(true);
      },
      // A walking customer needs a dot that keeps up; half a minute old is still where they are.
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);

  return { position, denied };
}
