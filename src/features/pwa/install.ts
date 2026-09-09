/**
 * Chromium fires `beforeinstallprompt` once, early, and only that event can open the real
 * install dialog later. A component that mounts after a booking would never see it, so it is
 * captured here at start-up and held until something asks for it.
 */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const DISMISSED = 'flek.install.dismissed';

export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Without this the browser shows its own mini-infobar at a moment we do not choose.
    event.preventDefault();
    deferred = event as InstallEvent;
    listeners.forEach((notify) => notify());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((notify) => notify());
  });
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function canPrompt(): boolean {
  return deferred !== null;
}

/** Returns true when the app was actually installed, so the caller can stop asking. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  // The event is single-use: keeping it would offer a dialog that never opens again.
  deferred = null;
  listeners.forEach((notify) => notify());
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome === 'accepted';
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS predates the standard and still reports it here only.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** iOS has no install event at all; the only route is the Share menu, so we have to say so. */
export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    // Private mode or blocked storage: better to ask again than to crash.
    return false;
  }
}

export function rememberDismissal() {
  try {
    localStorage.setItem(DISMISSED, '1');
  } catch {
    // Nothing to do; the prompt simply reappears next time.
  }
}
