// Service worker: app shell only.
//
// The setlist archive lives in IndexedDB, written by the app itself, so the
// worker does NOT cache API responses. That separation matters:
//   - /api/ is robots-disallowed and must not be fetched speculatively.
//   - Cached API data would bypass the integrity checks in source.js, which
//     is exactly how a subtly-truncated archive would become permanent.
//
// Bump CACHE_VERSION whenever shell files change. It is tied to the BUILD
// marker so a deploy is confirmable from the header.

const CACHE_VERSION = 'dozen-shell-v16';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/app.js',
  './src/version.js',
  './src/scratchpad.js',
  './src/styles/tokens.css',
  './src/styles/app.css',
  './src/data/source.js',
  './src/data/cache.js',
  './src/data/index.js',
  './src/data/normalize.js',
  './src/util/dates.js',
  './src/ui/dom.js',
  './src/ui/components.js',
  './src/views/upcoming.js',
  './src/views/gap.js',
  './src/views/recent.js',
  './src/views/song.js',
  './src/views/show.js',
  './src/views/jams.js',
  './src/views/picks.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // addAll fails the whole install if any file 404s; add individually so
      // one renamed file cannot brick the worker.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch the API. Those requests go straight to the network and are
  // governed by the TTLs and integrity checks in the app.
  if (url.hostname.endsWith('thecarton.net')) return;

  // Same-origin shell: cache first, since these change only on deploy.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request)
          .then((res) => {
            if (res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
            }
            return res;
          })
          .catch(() => caches.match('./index.html'));
      }),
    );
  }
});
