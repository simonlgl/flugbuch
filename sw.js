// Service Worker: zuerst das Netz fragen (Updates kommen sofort an), offline auf den Cache zurückfallen.
const CACHE = 'flugbuch-v3';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/data.js', 'js/csv.js', 'js/map.js', 'js/stats.js', 'js/api.js', 'js/pass.js', 'js/util.js',
  'vendor/d3-array.min.js', 'vendor/d3-geo.min.js', 'vendor/topojson-client.min.js', 'vendor/countries-110m.json',
  'data/airports.json', 'data/airlines.json', 'data/countries.json', 'data/regions.json', 'data/flights.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          const url = new URL(req.url); url.search = '';
          caches.open(CACHE).then((c) => c.put(url.href, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
