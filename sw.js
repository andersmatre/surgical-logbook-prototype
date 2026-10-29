// sw.js — caches the app shell so the logbook opens and works with no internet.
// To ship an update: change CACHE (e.g. bump the version) and redeploy.

const CACHE = 'logbook-v0.8.0';
const ASSETS = [
  './', './index.html', './app.js', './core.js', './config.js', './api.js', './ui.js', './supervisor.js', './administrator.js',
  './style.css', './manifest.webmanifest', './icon-192.png', './icon-512.png',
];

// cache: 'reload' fetches every file fresh from the server. Without it the browser may hand over a copy it
// still holds from before the update (the server allows 5 minutes), and the new cache gets old and new files mixed.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache the server API
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    }),
  );
});
