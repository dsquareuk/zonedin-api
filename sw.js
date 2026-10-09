// ZonedIn Service Worker
const CACHE = 'zonedin-v2';
const ASSETS = ['/'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = e.request.url;
  if (u.includes('supabase') || u.includes('anthropic') || u.includes('/api/') || u.includes('posthog')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Morning reminder: "Your Gold is waiting"
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { title: 'ZonedIn', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'ZonedIn', {
    body: data.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    tag: 'zonedin-morning',
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return clients.openWindow(url);
  }));
});
