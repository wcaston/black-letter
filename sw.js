// Know Your Shit offline cache. The build script sets VERSION on every publish.
const VERSION = 'kys-20261016173625-a42a55';
const SHELL = ['./', './index.html', './content.enc.json', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png', './icon-512-maskable.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function save(key, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(key, copy));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;
  if (same && req.mode === 'navigate') {
    // The page: network first so updates arrive; cached copy when there's no signal.
    e.respondWith(fetch(req).then((res) => save('./index.html', res))
      .catch(() => caches.match('./index.html')));
    return;
  }
  if (same && url.pathname.endsWith('/content.enc.json')) {
    // The guide itself: always check for a newer version, fall back to the saved one.
    e.respondWith(fetch(req.url, { cache: 'no-cache' }).then((res) => save('./content.enc.json', res))
      .catch(() => caches.match('./content.enc.json')));
    return;
  }
  if (same || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    })));
  }
});
