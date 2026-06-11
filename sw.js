// ZonedIn Service Worker
const CACHE = 'zonedin-v1';
const ASSETS = ['/'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  if(e.request.url.includes('supabase') || e.request.url.includes('anthropic') || e.request.url.includes('api/insight')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
