import { useEffect, useState, useSyncExternalStore } from 'react';
import { BellOff, BellRing, MonitorSmartphone, Volume2 } from 'lucide-react';
import { Button } from '../../components/ui';
import { useRouter } from '../../app/router';
import { useServerNow } from '../../lib/clock';
import { timeLeft } from '../bookings/confirmationView';
import {
  armRinger,
  isMuted,
  isRinging,
  keepScreenOn,
  muteRequests,
  ringOnce,
  screenKeptOn,
  soundReady,
  startRinging,
  stopRinging,
  subscribeRinger,
  unlockSound,
  unmuteRequests,
  wakeLockSupported,
} from './ringer';

/** A request that still waits for the venue's answer. */
export type WaitingRequest = { id: string; deadline: string | null };

let mutedVersion = 0;
function mutedSnapshot() {
  return mutedVersion;
}

/**
 * Rings while any request waits that nobody has silenced; stops by itself once it is confirmed,
 * declined (here, on another device or on WhatsApp) or runs out.
 */
export function useRequestRing(waiting: WaitingRequest[]) {
  useEffect(() => armRinger(), []);
  const ready = useSyncExternalStore(subscribeRinger, soundReady, () => false);
  const ringing = useSyncExternalStore(subscribeRinger, isRinging, () => false);
  useSyncExternalStore(subscribeRinger, mutedSnapshot, () => 0);
  const loud = waiting.filter((request) => !isMuted(request.id));
  const shouldRing = loud.length > 0;

  useEffect(() => {
    if (shouldRing && ready) startRinging();
    else stopRinging();
  }, [shouldRing, ready]);
  useEffect(() => () => stopRinging(), []);

  // A tab in the background says it too: the title alternates while the ring lasts.
  useEffect(() => {
    if (!ringing) return;
    const original = document.title;
    let bell = false;
    const timer = window.setInterval(() => {
      bell = !bell;
      document.title = bell ? '🔔 Nová žádost o rezervaci' : original;
    }, 1000);
    return () => {
      window.clearInterval(timer);
      document.title = original;
    };
  }, [ringing]);

  return {
    ready,
    ringing,
    loud,
    mute: () => {
      mutedVersion += 1;
      muteRequests(loud.map((request) => request.id));
    },
    /*
     * The person tapping this is already looking at the request: they hear one ring to know the
     * sound works, and the requests on screen stay quiet. The next one rings in full.
     */
    enable: async () => {
      // Muted before the sound unlocks: unlocking first let the loop start for a split second.
      const ids = loud.map((request) => request.id);
      mutedVersion += 1;
      muteRequests(ids);
      if (!(await unlockSound())) {
        mutedVersion += 1;
        unmuteRequests(ids);
        return false;
      }
      await ringOnce();
      return true;
    },
  };
}

function waitingLabel(count: number) {
  if (count === 1) return 'Nová žádost o rezervaci čeká na potvrzení';
  if (count < 5) return `${count} žádosti o rezervaci čekají na potvrzení`;
  return `${count} žádostí o rezervaci čeká na potvrzení`;
}

/**
 * The strip at the top of every partner page while a request rings, or while it cannot. Away from
 * Přehled and Rezervace, where the request card itself is not on screen, it also leads there.
 */
export function RingBar({ ring, showOpen }: { ring: ReturnType<typeof useRequestRing>; showOpen: boolean }) {
  const { navigate } = useRouter();
  const [blocked, setBlocked] = useState(false);
  if (!ring.loud.length) return null;
  const action = 'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-card px-3 text-sm font-bold text-ink hover:bg-surface';
  return (
    <div role={ring.ready ? 'status' : 'alert'} className="flex flex-wrap items-center gap-3 rounded-2xl bg-brand px-4 py-3 text-brand-ink shadow-lift">
      <BellRing
        size={22}
        aria-hidden="true"
        className={ring.ringing ? 'shrink-0 motion-safe:animate-[ring-shake_1.3s_ease-in-out_infinite]' : 'shrink-0'}
      />
      <div className="min-w-[13rem] flex-1">
        <p className="text-base leading-snug font-extrabold">{waitingLabel(ring.loud.length)}</p>
        <Countdown deadlines={ring.loud.map((request) => request.deadline)} />
        {!ring.ready ? (
          <p className="text-sm text-brand-ink/85">
            {blocked ? 'Prohlížeč zvuk blokuje. Zkontrolujte hlasitost a že karta není ztlumená.' : 'Zvuk je vypnutý. Zapněte ho a FLEK bude zvonit.'}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        {showOpen ? (
          <button type="button" onClick={() => navigate('/partner/rezervace')} className={action}>
            Vyřídit
          </button>
        ) : null}
        {ring.ready ? (
          <button type="button" onClick={ring.mute} className={action}>
            <BellOff size={17} aria-hidden="true" />
            Ztlumit
          </button>
        ) : (
          <button type="button" data-ring-unlock onClick={() => void ring.enable().then((ok) => setBlocked(!ok))} className={action}>
            <Volume2 size={17} aria-hidden="true" />
            Zapnout zvuk
          </button>
        )}
      </div>
    </div>
  );
}

/** The time left on the request that runs out first, in the same words as its card. */
function Countdown({ deadlines }: { deadlines: Array<string | null> }) {
  const now = useServerNow(1_000);
  const first = deadlines.filter((deadline): deadline is string => Boolean(deadline)).sort()[0];
  const left = timeLeft(first, now);
  if (!left || left.seconds === 0) return null;
  return <p className="tnum text-sm font-bold text-brand-ink/90">Potvrďte do {left.clock}</p>;
}

/** Provozovna: what the ring does, a way to hear it, and the screen that stays on. */
export function RingSettings() {
  const awake = useSyncExternalStore(subscribeRinger, screenKeptOn, () => false);
  const [heard, setHeard] = useState<boolean | null>(null);
  return (
    <section className="rounded-2xl bg-card p-5 shadow-card sm:p-6" aria-labelledby="zvoneni-nadpis">
      <h2 id="zvoneni-nadpis" className="text-lg font-extrabold tracking-tight text-ink">Zvonění v aplikaci</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Při nové žádosti o rezervaci FLEK Partner zvoní, dokud ji nepotvrdíte, neodmítnete nebo nevyprší. Nechte ho
        otevřený na telefonu nebo tabletu u recepce.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void ringOnce().then(setHeard)}>
          <Volume2 size={17} aria-hidden="true" />
          Vyzkoušet zvonění
        </Button>
        {wakeLockSupported() ? (
          <Button variant={awake ? 'brand' : 'secondary'} aria-pressed={awake} onClick={() => void keepScreenOn(!awake)}>
            <MonitorSmartphone size={17} aria-hidden="true" />
            {awake ? 'Displej zůstane rozsvícený' : 'Nechat displej rozsvícený'}
          </Button>
        ) : null}
      </div>
      {heard === false ? (
        <p role="status" className="mt-2 text-sm text-danger">Prohlížeč zvuk zablokoval. Zkontrolujte hlasitost a že karta není ztlumená.</p>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Když je aplikace zavřená, přijde e-mail a oznámení na telefon (zapnete níž), které zůstane na obrazovce, dokud na něj
        neklepnete.
      </p>
    </section>
  );
}
