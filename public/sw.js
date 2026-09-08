/*
 * Shell caching only, and only for files that can never change under a given name.
 *
 * The cache name carries the build id from the registration URL, so a new build activates
 * a new service worker, which drops every older cache. The previous version used a fixed
 * name and served most requests from the cache before the network — which is exactly how
 * a browser ends up showing yesterday's app.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `flek-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add('/index.html'))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Offers, bookings and auth are never cached: inventory decays by the minute.
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return;

  // Hashed build output is immutable, so the cache can answer immediately.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Everything else — the document above all — comes from the network, and the cache is
  // only the offline fallback.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (request.mode === 'navigate' && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/index.html')).then((r) => r ?? Response.error())),
  );
});
