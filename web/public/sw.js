/* Service worker of the Mittagessen-Service.
 *
 * It makes the app installable and lets the shell open instantly on a phone.
 * It never caches the API or the event stream: orders are always live.
 * Static assets carry a content hash, so they are cached first; the HTML
 * shell is fetched from the network first and falls back to the cache when
 * the phone is offline.
 */
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/mittag', '/manifest.webmanifest', '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, ASSETS].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return; // always live

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/mittag', copy)); return res; }).catch(() => caches.match('/mittag')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)); return res; })));
  }
});
