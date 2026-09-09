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
