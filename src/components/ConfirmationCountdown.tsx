import { useServerNow } from '../lib/clock';

export function confirmationTimeLeft(deadline: string | null | undefined, now: string): string | null {
  if (!deadline) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - Date.parse(now)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function ConfirmationCountdown({ deadline, formal = false }: { deadline?: string | null; formal?: boolean }) {
  const now = useServerNow(1_000);
  const left = confirmationTimeLeft(deadline, now);
  if (!left) return null;
  return <span className="tnum font-extrabold text-warning">{formal ? 'Potvrďte do' : 'Čas na potvrzení'} {left}</span>;
}
