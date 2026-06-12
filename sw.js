// BnOS Relay Console — Service Worker
const CACHE_NAME = 'bnos-relay-v3';
const ASSETS = [
  './',
  './console.html',
  './css/console.css',
  './js/core.js',
  './js/relay.js',
  './js/events.js',
  './js/console.js',
  './js/vendor/noble-secp256k1.js',
  './manifest.json',
  './icon.svg',
];

// Install — cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        ASSETS.map(async (asset) => {
          try {
            await cache.add(asset);
          } catch (error) {
            console.warn('[SW] Failed to precache asset:', asset, error);
          }
        })
      );
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — cache-first for static assets, network-first for others
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and WebSocket
  if (event.request.method !== 'GET') return;
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  const isSameOrigin = url.origin === self.location.origin;
  const isStaticAsset = isSameOrigin && ASSETS.some((a) => url.pathname.endsWith(a.replace('./', '/')));

  // Static assets: cache-first
  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Everything else: network-first
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && isSameOrigin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
