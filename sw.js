// Zebra Shift service worker: keeps the game playable offline.
// Bump VERSION whenever index.html changes so players get the new build.
const VERSION = 'zebra-shift-v30';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/supabase.js',
  './config.js',
  './online.js',
  './privacy.html',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pages: try the network for updates, fall back to the cached copy offline.
  // Only the game itself is stored as index.html; articles and other pages keep their own entry.
  if (req.mode === 'navigate') {
    const scope = new URL(self.registration.scope).pathname;
    const isGame = url.pathname === scope || url.pathname === scope + 'index.html';
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      if (res.ok) caches.open(VERSION).then(c => c.put(isGame ? './index.html' : req, copy));
      return res;
    }).catch(() => caches.match(isGame ? './index.html' : req).then(hit => hit || caches.match('./index.html'))));
    return;
  }

  // Google Fonts: serve the cached copy at once and refresh it in the background
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(VERSION).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }

  // Online settings: fetch fresh so a newly filled-in config.js takes effect without a new VERSION
  if (url.origin === location.origin && url.pathname.endsWith('/config.js')) {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req)));
    return;
  }

  // Everything else from this site: cache first
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
  }
});

// Daily reminder notifications sent by the daily-reminder function
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Zebra Shift', {
    body: d.body || 'A new Zebra Hunt and Case of the day are waiting.', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    tag: 'daily', data: { url: d.url || './#daily' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './#daily', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
