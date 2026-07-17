// AQlite service worker — own cache namespace ('aqlite-')
// CacheStorage is ORIGIN-scoped and shared with the other apps on
// jawitmer.github.io, so activate() must only delete THIS app's stale caches.
const CACHE_PREFIX = 'aqlite-';
const CACHE_NAME = 'aqlite-v4';
const ASSETS = ['./', './index.html', './app.js', './holes_data.js', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
                    .map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
