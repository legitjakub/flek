import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** Runs public/sw.js against a fake worker scope and returns what one push shows. */
async function push(payload: unknown) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const scope = {
    addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); } },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined, openWindow: async () => undefined },
    location: { origin: 'https://www.app-flek.eu' },
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self: scope, caches: { keys: async () => [] }, URL });
  const waits: Promise<unknown>[] = [];
  handlers.push({ data: { json: () => payload }, waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
  await Promise.all(waits);
  return shown[0];
}

describe('service worker push', () => {
  it('keeps a booking request for a venue on screen until tapped', async () => {
    const shown = await push({ url: '/partner/rezervace', id: 'n1', kind: 'request' });
    expect(shown.options.body).toContain('čeká na potvrzení');
    expect(shown.options.requireInteraction).toBe(true);
    expect(shown.options.renotify).toBe(true);
    expect(shown.options.vibrate).toEqual([300, 150, 300, 150, 600]);
    expect(shown.options.tag).toBe('n1');
    expect(shown.options.data).toEqual({ url: '/partner/rezervace?notifications=1' });
  });

  it('leaves other venue notices as they were', async () => {
    const shown = await push({ url: '/partner/rezervace', id: 'n2' });
    expect(shown.options.body).toBe('V aplikaci máte nové upozornění na rezervaci.');
    expect(shown.options.requireInteraction).toBeUndefined();
  });

  it('never treats a customer notice as a request, whatever the payload says', async () => {
    const shown = await push({ url: '/rezervace', id: 'n3', kind: 'request' });
    expect(shown.options.body).toBe('V aplikaci máš nové upozornění na rezervaci.');
    expect(shown.options.requireInteraction).toBeUndefined();
  });

  it('opens only FLEK\'s own addresses and carries no booking details', async () => {
    const shown = await push({ url: 'https://evil.example/', id: 'n4', kind: 'request' });
    expect(shown.options.data).toEqual({ url: '/rezervace?notifications=1' });
    expect(JSON.stringify(shown.options)).not.toMatch(/Kč|FLEK-[A-Z0-9]{6}/);
  });
});
