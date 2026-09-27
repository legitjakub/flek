import { afterEach, describe, expect, it, vi } from 'vitest';
import { PushSetupError, pushProblem, registerDevicePush } from '../src/features/notifications/devicePush';

const KEY = Buffer.alloc(65, 4).toString('base64url');
const OTHER_KEY = new Uint8Array(65).fill(9).buffer;
const OUR_KEY = new Uint8Array(65).fill(4).buffer;

type Fake = {
  permission?: NotificationPermission;
  existing?: { key: ArrayBuffer } | null;
  /** How many subscribe calls fail before one succeeds; Infinity = all fail. */
  failures?: number;
};

/** A browser with Web Push, where each call is recorded. */
function browser({ permission = 'granted', existing = null, failures = 0 }: Fake = {}) {
  const log: string[] = [];
  let current = existing ? subscription(existing.key, 'old') : null;
  let failed = 0;
  function subscription(key: ArrayBuffer, name: string) {
    return {
      options: { applicationServerKey: key },
      toJSON: () => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: async () => {
        log.push(`unsubscribe:${name}`);
        current = null;
        return true;
      },
    };
  }
  const pushManager = {
    getSubscription: async () => current,
    subscribe: async (options: { applicationServerKey: Uint8Array }) => {
      log.push('subscribe');
      if (failed < failures) {
        failed += 1;
        throw new DOMException('Registration failed - could not retrieve the public key', 'AbortError');
      }
      current = subscription(options.applicationServerKey.buffer as ArrayBuffer, 'new');
      return current;
    },
  };
  vi.stubGlobal('Notification', { requestPermission: async () => { log.push('permission'); return permission; } });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({ pushManager }) } });
  return log;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerDevicePush', () => {
  it('asks for permission first and stores the new subscription', async () => {
    const log = browser();
    const saved: PushSubscriptionJSON[] = [];
    await registerDevicePush(KEY, async (json) => { saved.push(json); });
    expect(log).toEqual(['permission', 'subscribe']);
    expect(saved[0]?.endpoint).toContain('/new');
  });

  it('reuses a subscription made with our key', async () => {
    const log = browser({ existing: { key: OUR_KEY } });
    const saved: PushSubscriptionJSON[] = [];
    await registerDevicePush(KEY, async (json) => { saved.push(json); });
    expect(log).toEqual(['permission']);
    expect(saved[0]?.endpoint).toContain('/old');
  });

  it('drops a subscription made with another key before subscribing again', async () => {
    const log = browser({ existing: { key: OTHER_KEY } });
    await registerDevicePush(KEY, async () => undefined);
    expect(log).toEqual(['permission', 'unsubscribe:old', 'subscribe']);
  });

  it('retries once after "could not retrieve the public key"', async () => {
    const log = browser({ failures: 1 });
    const saved: PushSubscriptionJSON[] = [];
    await registerDevicePush(KEY, async (json) => { saved.push(json); });
    expect(log).toEqual(['permission', 'subscribe', 'subscribe']);
    expect(saved).toHaveLength(1);
  });

  it('gives up with a reason the screen can explain when the browser keeps refusing', async () => {
    browser({ failures: Infinity });
    const error = await registerDevicePush(KEY, async () => undefined).catch((failure) => failure);
    expect(error).toBeInstanceOf(PushSetupError);
    expect(error.reason).toBe('registration');
    expect(pushProblem(error, false)).toContain('Prohlížeč oznámení nezaregistroval');
    expect(pushProblem(error, false)).toContain('zakaž a znovu povol');
    expect(pushProblem(error, true)).toContain('zakažte a znovu povolte');
  });

  it('never registers without permission', async () => {
    const log = browser({ permission: 'denied' });
    const error = await registerDevicePush(KEY, async () => undefined).catch((failure) => failure);
    expect(error.reason).toBe('denied');
    expect(log).toEqual(['permission']);
    expect(pushProblem(error, true)).toContain('Povolíte je v nastavení prohlížeče');
  });

  it('says so when the key is missing or the browser has no push', async () => {
    browser();
    expect((await registerDevicePush(undefined, async () => undefined).catch((e) => e)).reason).toBe('not-configured');
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', {});
    expect((await registerDevicePush(KEY, async () => undefined).catch((e) => e)).reason).toBe('unsupported');
  });
});

describe('pushProblem', () => {
  it('turns server refusals into sentences for each audience', () => {
    expect(pushProblem(new Error('DEVICE_LIMIT'), false)).toContain('odpoj');
    expect(pushProblem(new Error('DEVICE_LIMIT'), true)).toContain('odpojte');
    expect(pushProblem(new Error('SUBSCRIPTION_OWNED_BY_ANOTHER_USER'), false)).toContain('jiný účet');
    expect(pushProblem(new Error('INVALID_SUBSCRIPTION'), true)).toContain('Použijte Chrome');
  });

  it('never shows the browser\'s English text', () => {
    const text = pushProblem(new DOMException('Registration failed - could not retrieve the public key', 'AbortError'), false);
    expect(text).not.toContain('Registration failed');
  });
});
