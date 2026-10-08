// Service worker: makes the app load offline. The fridge data is already on the
// device, so once the shell is cached everything but AI features and the first
// receipt scan (which downloads the OCR library) works without a connection.
//
// Bump CACHE whenever the list of cached files changes.

const CACHE = 'smartfridge-v3';
const SHELL = [
  '/',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/shared/dates.js',
  '/shared/foods.js',
  '/shared/items.js',
  '/shared/receipt.js',
  '/shared/recipes.js',
  '/shared/storage.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-maskable-512.png',
  '/fonts/fraunces-latin-soft-normal.woff2',
  '/fonts/nunito-latin-wght-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stale-while-revalidate for our own files: instant load from cache, refreshed in
// the background so the next launch gets any update. API calls are never cached.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
      const network = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const res = await network;
      if (res) return res;
      if (request.mode === 'navigate') return (await cache.match('/')) ?? Response.error();
      return Response.error();
    }),
  );
});
