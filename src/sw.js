// sw.js — offline shell. Cache-first for the app (it is local-first; data lives in IndexedDB),
// never touches /api. A new version waits until the page asks it to take over.
const V = '__VERSION__';
const PRE = __PRECACHE__;
const CACHE = 'lists-' + V;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(PRE.map((u) => new Request(u, { cache: 'reload' })));
    if (!self.registration.active) await self.skipWaiting(); // first install: take control now
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('lists-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => (await caches.match('/', { cacheName: CACHE })) || fetch(req))());
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req, { cacheName: CACHE, ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    // Never cache the HTML fallback a server returns for a missing asset.
    if (res.ok && url.pathname.startsWith('/assets/') && !(res.headers.get('content-type') || '').includes('text/html')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })());
});
