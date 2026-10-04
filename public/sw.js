const VERSION = '__BUILD_ID__';
const CACHE = `feature-lens-${VERSION}`;
const ASSETS = [
  './', './index.html', './app.js', './pwa.js', './style.css', './manifest.webmanifest',
  './worker.js', './detector.js', './vision.js', './demo-view.js',
  './object-tracker.js', './appearance.js', './local-media.js', './media-platform.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];
const assetUrls = ASSETS.map(path => new URL(path, self.registration.scope).href);
const shellUrl = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      for (const url of assetUrls) {
        const response = await fetch(url, { cache: 'reload' });
        if (!response.ok || response.type !== 'basic') throw new Error(`Unable to cache ${url}`);
        await cache.put(url, response);
      }
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
    // Keep an older version active until the user chooses to update.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('feature-lens-') && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(shellUrl, { cacheName: CACHE });
      return cached || fetch(request);
    })());
    return;
  }
  if (!assetUrls.includes(url.href)) return;
  event.respondWith((async () => {
    const cached = await caches.match(url.href, { cacheName: CACHE });
    return cached || fetch(request);
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  } else if (event.data?.type === 'CACHE_STATUS') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const ready = (await Promise.all(assetUrls.map(url => cache.match(url)))).every(Boolean);
      event.ports[0]?.postMessage({ ready, version: VERSION });
    })());
  }
});
