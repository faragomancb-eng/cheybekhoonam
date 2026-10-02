/*
 * Offline support without stale data:
 *  - pages and data/*.json: network first, cache as fallback (edits show up immediately)
 *  - fonts, images, css, js: stale-while-revalidate
 * Bump VERSION when you change this file's strategy; normal content edits don't need it.
 */
const VERSION = 'v2';
const CACHE = `chibekhoonam-${VERSION}`;
const CORE = ['./', './index.html', './css/main.css', './js/app.js', './data/books.json', './data/vocab.json', './assets/img/hero-night.webp'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never cache third-party APIs here

  const networkFirst = req.mode === 'navigate' || url.pathname.endsWith('.json') || url.pathname.endsWith('.csv');
  if (networkFirst) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(async () => (await caches.match(req)) ?? (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached ?? fresh;
    }),
  );
});
