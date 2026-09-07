import { useEffect, useState } from 'react';

// Device clocks are never authoritative. Every server payload carries `server_now`;
// we keep the offset and derive all countdowns and day labels from it.
let offsetMs = 0;
let epoch = 0;
const listeners = new Set<() => void>();

export function noteServerNow(iso: string | null | undefined) {
  if (!iso) return;
  const next = Date.parse(iso) - Date.now();
  if (!Number.isFinite(next)) return;
  if (Math.abs(next - offsetMs) < 1000) return;
  // A shift of more than a minute can move a Prague day boundary, so anything derived
  // from the clock (the „Dnes" window above all) has to be recomputed.
  const material = Math.abs(next - offsetMs) >= 60_000;
  offsetMs = next;
  if (material) epoch += 1;
  listeners.forEach((l) => l());
}

/** Bumps whenever the correction is large enough to change a day window. */
export function useClockEpoch(): number {
  const [value, setValue] = useState(epoch);
  useEffect(() => {
    const tick = () => setValue(epoch);
    listeners.add(tick);
    tick();
    return () => {
      listeners.delete(tick);
    };
  }, []);
  return value;
}

export function serverNow(): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** Server-corrected clock that re-renders on an interval, so "za 20 minut" never freezes. */
export function useServerNow(intervalMs = 30000): string {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const tick = () => setNow(serverNow());
    const id = window.setInterval(tick, intervalMs);
    listeners.add(tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      listeners.delete(tick);
      window.removeEventListener('focus', tick);
    };
  }, [intervalMs]);
  return now;
}

/** „za 20 minut" / „za 3 h" / „za 2 dny" — always relative to the server clock. */
export function relativeTime(target: string, now: string): string {
  const minutes = Math.round((Date.parse(target) - Date.parse(now)) / 60000);
  if (minutes <= 0) return 'právě teď';
  if (minutes < 60) return `za ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `za ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'zítra' : `za ${days} dny`;
}
