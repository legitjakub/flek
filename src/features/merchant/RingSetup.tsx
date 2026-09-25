import { useState } from 'react';
import { BellRing, CheckCircle2, Share } from 'lucide-react';
import { Button, IconTile, cx } from '../../components/ui';
import { NOTIFICATIONS_ENABLED, enableDevicePush, pushProblem, useDevicePush } from '../notifications/Notifications';
import { isIos, isStandalone } from '../pwa/install';
import { keepScreenOn, ringOnce, wakeLockSupported } from './ringer';
import { alertSetupState } from './ringSetup';

/** "Teď ne" lasts until the page is loaded again. Nothing is stored. */
let snoozed = false;

function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
}

/**
 * Ringing is on for every venue by default; what the venue has to give is the browser's
 * permission. One tap here asks for it, registers this device for the notifications that reach a
 * closed console (on by default for a venue's bookings), rings once so they hear the sound works
 * and, where it can, keeps the screen on. On every partner page until this device has it, or in
 * Provozovna as a line that says it is on.
 */
export function RingSetup({ inline = false }: { inline?: boolean }) {
  const device = useDevicePush();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [hidden, setHidden] = useState(snoozed);
  const state = alertSetupState({
    enabled: NOTIFICATIONS_ENABLED,
    deviceOn: device.on,
    permission: typeof Notification === 'undefined' ? 'unknown' : Notification.permission,
    pushSupported: pushSupported(),
    ios: typeof navigator !== 'undefined' && isIos(),
    standalone: typeof window !== 'undefined' && isStandalone(),
  });

  async function allow() {
    setBusy(true);
    setMessage(null);
    // Both start straight from the tap: Safari asks for permission and lets sound play only then.
    const registering = enableDevicePush();
    const sound = ringOnce();
    if (wakeLockSupported()) void keepScreenOn(true);
    try {
      await registering;
      setDone(true);
    } catch (error) {
      setMessage(pushProblem(error, true));
    } finally {
      await sound.catch(() => false);
      device.refresh();
      setBusy(false);
    }
  }

  if (inline && NOTIFICATIONS_ENABLED && device.on) {
    return (
      <p className="mt-3 flex items-center gap-2 text-sm font-bold text-positive">
        <CheckCircle2 size={18} aria-hidden="true" />
        Na tomto zařízení je zvonění i oznámení zapnuté.
      </p>
    );
  }
  if (done && !inline) {
    return (
      <div role="status" className="mb-4 flex items-center gap-3 rounded-3xl bg-card p-4 shadow-card">
        <IconTile icon={<CheckCircle2 size={20} />} tone="positive" />
        <p className="text-sm font-bold text-ink">Hotovo. Nová žádost tu zazvoní, a když aplikaci zavřete, přijde oznámení.</p>
      </div>
    );
  }
  if (state === 'hidden' || (hidden && !inline)) return null;

  const title = state === 'denied' ? 'Oznámení máte v prohlížeči zakázaná'
    : state === 'install' ? 'Přidejte si FLEK Partner na plochu'
      : state === 'unsupported' ? 'Tento prohlížeč oznámení neumí'
        : 'Zapněte zvonění na tomto zařízení';
  const body = state === 'denied'
    ? 'Nová žádost tu zazvoní, jen když máte aplikaci otevřenou. Povolte oznámení v nastavení prohlížeče u www.app-flek.eu (ikona vedle adresy → Oznámení → Povolit) a načtěte stránku znovu.'
    : state === 'install'
      ? 'Na iPhonu chodí oznámení jen z aplikace na ploše. Klepněte na Sdílet, pak Přidat na plochu, otevřete FLEK Partner z plochy a povolte zvonění.'
      : state === 'unsupported'
        ? 'Nová žádost tu zazvoní, dokud máte aplikaci otevřenou. Oznámení při zavřené aplikaci nabízí Chrome, Safari nebo Firefox.'
        : 'Nová žádost o rezervaci tu zazvoní a ukáže se přes celou obrazovku. Když aplikaci zavřete, přijde oznámení do telefonu. Stačí jednou povolit.';

  return (
    <section
      aria-labelledby="zvoneni-povolit"
      className={cx(inline ? 'mt-4 rounded-2xl bg-surface p-4' : 'mb-4 rounded-3xl bg-card p-4 shadow-card ring-2 ring-brand/15 sm:p-5')}
    >
      <div className="flex items-start gap-3">
        <IconTile icon={state === 'install' ? <Share size={20} /> : <BellRing size={20} />} tone={state === 'ask' ? 'brand' : 'warning'} />
        <div className="min-w-0">
          <h2 id="zvoneni-povolit" className="text-base font-extrabold text-ink">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
        </div>
      </div>
      {message ? <p role="alert" className="mt-3 text-sm text-danger">{message}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {state === 'ask' ? (
          <Button variant="brand" loading={busy} onClick={() => void allow()}>
            <BellRing size={18} aria-hidden="true" />
            Povolit zvonění a oznámení
          </Button>
        ) : null}
        {!inline ? (
          <Button variant="ghost" onClick={() => { snoozed = true; setHidden(true); }}>
            Teď ne
          </Button>
        ) : null}
      </div>
    </section>
  );
}
