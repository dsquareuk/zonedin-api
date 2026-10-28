// ZonedIn Service Worker — v3 (instant open + offline)
// The app shell lives on the phone. Opening ZonedIn waits at most 1.5s for a fresh copy
// (covered by the splash); with a slow or no connection the cached copy opens instead. Data calls (Supabase, /api, analytics) always go to the network.
const CACHE = 'zonedin-v8';
const SHELL = [
  '/',
  '/manifest.json',
  '/privacy.html',
  '/vendor/react-18.3.1.min.js',
  '/vendor/react-dom-18.3.1.min.js',
  '/vendor/supabase-2.45.4.js',
  '/fonts/space-grotesk-latin-600-normal.woff2',
  '/fonts/space-grotesk-latin-700-normal.woff2',
  '/fonts/dm-sans-latin-400-normal.woff2',
  '/fonts/dm-sans-latin-500-normal.woff2',
  '/fonts/dm-sans-latin-600-normal.woff2',
  '/fonts/dm-sans-latin-700-normal.woff2',
  '/icons/icon-192x192.png',
  '/icons/icon-180x180.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // Supabase, PostHog, fonts CDN etc.
  if (url.pathname.startsWith('/api/')) return;                 // serverless functions: always live

  // Opening the app: cached shell first, refresh in the background.
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(async c => {
      const cached = await c.match('/');
      const fresh = fetch(req).then(r => { if (r && r.ok && url.pathname === '/') c.put('/', r.clone()); return r; }).catch(() => null);
      if (url.pathname !== '/' && url.pathname !== '/index.html') {
        const page = await fresh; return page || (await c.match(url.pathname)) || cached || Response.error();
      }
      // v4: try the network first for a moment (hidden behind the splash), so new releases show on the next open.
      if (cached) {
        const quick = await Promise.race([fresh, new Promise(r => setTimeout(() => r(null), 1500))]);
        if (quick && quick.ok) return quick;
        e.waitUntil(fresh); return cached;
      }
      return (await fresh) || Response.error();
    }));
    return;
  }

  // Versioned static files: cache first.
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req);
    if (hit) return hit;
    const r = await fetch(req);
    if (r && r.ok) c.put(req, r.clone());
    return r;
  }));
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
