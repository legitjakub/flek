/*
 * Deliberately caches nothing.
 *
 * FLEK is useless offline — every screen needs Supabase — so a cache bought no capability
 * and cost the one thing that matters: people kept seeing an old build. Two attempts at a
 * "smarter" cache (fixed name, then versioned) both left stale clients behind.
 *
 * With no fetch handler the browser networks normally, so staleness is impossible. The
 * worker still exists purely so the app stays installable, and its one job on activation is
 * to delete whatever earlier versions cached and take over immediately.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// A registered fetch listener is part of what browsers look for before offering to install
// the app. It deliberately does nothing: without respondWith the browser handles the
// request itself, so there is still no cache anywhere in the path.
self.addEventListener('fetch', () => {});

// Only addresses FLEK itself produces are ever opened: a push payload is data, not a URL to trust.
const WATCH_URL = /^\/(nabidka\/[0-9a-f-]{36}|mapa\?hlidac=[0-9a-f-]{36})$/;
function target(url) {
  if (url === '/partner/rezervace' || url === '/partner/rezervace?notifications=1') return '/partner/rezervace?notifications=1';
  if (typeof url === 'string' && WATCH_URL.test(url)) return url;
  return '/rezervace?notifications=1';
}

self.addEventListener('push', event => {
  // No booking details on a shared lock screen; read the authorised inbox after opening.
  let data = {};
  try { data = event.data?.json() ?? {}; } catch {}
  const url = target(data.url);
  const partner = url.startsWith('/partner/');
  const watch = WATCH_URL.test(url);
  event.waitUntil(self.registration.showNotification('FLEK', {
    body: watch
      ? 'V okolí se uvolnil nový FLEK podle tvého hlídače.'
      : partner ? 'V aplikaci máte nové upozornění na rezervaci.' : 'V aplikaci máš nové upozornění na rezervaci.',
    icon: '/icon.svg', badge: '/favicon.svg', tag: data.id || (watch ? 'flek-watch' : 'flek-reservations'), data: { url },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(new URL(target(event.notification.data?.url), self.location.origin).href));
});
