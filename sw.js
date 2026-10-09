/* Egypt Guide service worker. VERSION is rewritten by tools/build.py on every build. */
const VERSION = '20261009-1631';
const SHELL = 'egypt-shell-' + VERSION;
const MEDIA = 'egypt-media-v1';
const SHELL_FILES = [
  './', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest',
  'data/entries.json', 'data/sites.json', 'data/itinerary.json', 'data/phrases.json', 'data/assets.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png'
];
const MEDIA_PREFIX = /\/(img|audio|docs)\//;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // add one by one so a single missing file does not break install
    for (const f of SHELL_FILES) {
      try { await c.add(new Request(f, { cache: 'reload' })); } catch (err) { /* ignore */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('egypt-shell-') && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (MEDIA_PREFIX.test(url.pathname)) {
    // media: cache first, fill cache on first online view
    e.respondWith((async () => {
      const cache = await caches.open(MEDIA);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  // shell + data: cache first, then network (and refresh cache)
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const idx = await cache.match('index.html');
        if (idx) return idx;
      }
      return new Response('offline', { status: 504 });
    }
  })());
});
