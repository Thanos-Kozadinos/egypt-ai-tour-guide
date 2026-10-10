/* Egypt Guide service worker. VERSION is rewritten by tools/build.py on every build. */
const VERSION = '20261010-1330';
const SHELL = 'egypt-shell-' + VERSION;
const MEDIA = 'egypt-media-v1';
const SHELL_FILES = [
  './', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest',
  'data/entries.json', 'data/sites.json', 'data/itinerary.json', 'data/phrases.json', 'data/assets.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png'
];
const MEDIA_PREFIX = /\/(img|audio|docs)\//;
// Match cache entries by URL only. The <audio> element sends extra headers (Range, Accept-Encoding: identity)
// and GitHub Pages answers with "Vary: Accept-Encoding"; without ignoreVary the Cache API refuses to match a file
// that was downloaded with plain fetch() against the player's request, and playback fails offline.
const MATCH = { ignoreSearch: true, ignoreVary: true };

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

// Store media with a minimal, uniform header set (no Vary, no Content-Encoding/Length that may not match the stored body).
function storable(res) {
  const h = new Headers();
  for (const k of ['content-type', 'last-modified', 'etag']) { const v = res.headers.get(k); if (v) h.set(k, v); }
  return new Response(res.body, { status: 200, statusText: 'OK', headers: h });
}

// Serve a cached full file to a request that may carry a Range header (audio/video players, the PDF viewer).
async function withRange(req, res) {
  const range = req.headers.get('range');
  if (!range) return res;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!m || (!m[1] && !m[2])) return res; // unparseable: hand over the whole file, browsers cope with a 200
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  let start, end;
  if (m[1]) { start = +m[1]; end = m[2] ? Math.min(+m[2], size - 1) : size - 1; }
  else { start = Math.max(0, size - +m[2]); end = size - 1; } // suffix range "bytes=-500"
  if (start >= size || start > end) return new Response('', { status: 416, statusText: 'Range Not Satisfiable', headers: { 'Content-Range': `bytes */${size}` } });
  const h = new Headers(res.headers);
  h.delete('vary'); h.delete('content-encoding');
  h.set('Content-Range', `bytes ${start}-${end}/${size}`);
  h.set('Content-Length', String(end - start + 1));
  h.set('Accept-Ranges', 'bytes');
  return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: h });
}

async function media(e, req) {
  const cache = await caches.open(MEDIA);
  const hit = await cache.match(req.url, MATCH);
  if (hit) return withRange(req, hit);
  // not cached: go online. Fill the cache on the way when we fetch the whole file
  // (a plain fetch, or the player's first "bytes=0-" request, which we upgrade to a full download).
  try {
    const range = (req.headers.get('range') || '').trim();
    if (range && !/^bytes=0-$/i.test(range)) return await fetch(req); // a seek into a file we do not have: pass through
    const res = await fetch(range ? req.url : req);
    // the download manager (cache: 'no-store') stores what it fetches itself; do not write every pack file twice
    if (res.ok && res.status === 200 && res.type === 'basic' && req.cache !== 'no-store') e.waitUntil(cache.put(req.url, storable(res.clone())).catch(() => {}));
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (MEDIA_PREFIX.test(url.pathname)) {
    e.respondWith(media(e, req));
    return;
  }

  // shell + data: cache first, then network (and refresh cache)
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, MATCH);
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