import { errorMessage } from '../../lib/errors';

/*
 * Registering this device for Web Push, apart from the screen so it can be tested without a
 * browser. `Notifications.tsx` passes in the key and how to store the subscription.
 */

export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - value.length % 4) % 4)}`;
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function sameKey(current: ArrayBuffer | null | undefined, wanted: Uint8Array): boolean {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === wanted.length && bytes.every((byte, index) => byte === wanted[index]);
}

/** Why this device could not be registered; the screen turns it into a sentence for its audience. */
export class PushSetupError extends Error {
  constructor(readonly reason: 'unsupported' | 'not-configured' | 'denied' | 'registration') {
    super(`PUSH_${reason.toUpperCase()}`);
  }
}

/**
 * What went wrong with notifications on this device, in the screen's own voice. The browser's own
 * text ("Registration failed - could not retrieve the public key") reached people untranslated.
 */
export function pushProblem(error: unknown, formal: boolean): string {
  const reason = error instanceof PushSetupError ? error.reason : null;
  const message = error instanceof Error ? error.message : '';
  if (reason === 'unsupported') {
    return formal
      ? 'Tento prohlížeč oznámení nepodporuje. Na iPhonu si FLEK přidejte na plochu a otevřete ho odtud.'
      : 'Tenhle prohlížeč oznámení nepodporuje. Na iPhonu si FLEK přidej na plochu a otevři ho odtud.';
  }
  if (reason === 'not-configured') return formal ? 'Oznámení na telefonu zatím nejsou aktivovaná.' : 'Oznámení na telefonu zatím nejsou aktivovaná.';
  if (reason === 'denied') {
    return formal
      ? 'Prohlížeč má oznámení pro FLEK zakázaná. Povolíte je v nastavení prohlížeče u www.app-flek.eu.'
      : 'Prohlížeč má oznámení pro FLEK zakázaná. Povolíš je v nastavení prohlížeče u www.app-flek.eu.';
  }
  if (reason === 'registration') {
    return formal
      ? 'Prohlížeč oznámení nezaregistroval. V nastavení prohlížeče u www.app-flek.eu oznámení zakažte a znovu povolte, nebo použijte Chrome či Safari.'
      : 'Prohlížeč oznámení nezaregistroval. V nastavení prohlížeče u www.app-flek.eu oznámení zakaž a znovu povol, nebo použij Chrome či Safari.';
  }
  if (message.includes('DEVICE_LIMIT')) {
    return formal ? 'Oznámení máte zapnutá už na 10 zařízeních. Na některém je odpojte.' : 'Oznámení máš zapnutá už na 10 zařízeních. Na některém je odpoj.';
  }
  if (message.includes('SUBSCRIPTION_OWNED_BY_ANOTHER_USER')) {
    return formal ? 'Na tomto zařízení má oznámení zapnutá jiný účet.' : 'Na tomhle zařízení má oznámení zapnutá jiný účet.';
  }
  if (message.includes('INVALID_SUBSCRIPTION')) {
    return formal ? 'Tento prohlížeč posílá oznámení službou, kterou FLEK nepodporuje. Použijte Chrome, Firefox nebo Safari.' : 'Tenhle prohlížeč posílá oznámení službou, kterou FLEK nepodporuje. Použij Chrome, Firefox nebo Safari.';
  }
  return errorMessage(error, formal ? 'merchant' : 'customer');
}

/**
 * Asks for permission and registers this device for push. The permission prompt comes first,
 * before anything else is awaited: Safari shows it only straight from a tap.
 */
export async function registerDevicePush(publicKey: string | undefined, save: (subscription: PushSubscriptionJSON) => Promise<unknown>) {
  if (!('Notification' in globalThis) || !('PushManager' in globalThis) || !('serviceWorker' in navigator)) {
    throw new PushSetupError('unsupported');
  }
  if (!publicKey) throw new PushSetupError('not-configured');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushSetupError('denied');
  const registration = await navigator.serviceWorker.ready;
  const key = applicationServerKey(publicKey);
  let subscription = await registration.pushManager.getSubscription().catch(() => null);
  // A registration made with another key can never deliver ours, and it blocks a new one.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  if (!subscription) {
    const options = { userVisibleOnly: true, applicationServerKey: key };
    try {
      subscription = await registration.pushManager.subscribe(options);
    } catch {
      // Chrome answers a broken earlier registration with "could not retrieve the public key":
      // drop whatever is left and try once more before giving up.
      const stale = await registration.pushManager.getSubscription().catch(() => null);
      await stale?.unsubscribe().catch(() => false);
      try {
        subscription = await registration.pushManager.subscribe(options);
      } catch {
        throw new PushSetupError('registration');
      }
    }
  }
  await save(subscription.toJSON());
}

