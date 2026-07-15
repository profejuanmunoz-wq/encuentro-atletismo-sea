const CACHE_NAME = 'atletismo-sea-v5';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/emblem-96.png',
  './img/logo-full.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const reqUrl = new URL(event.request.url);
  const isSameOrigin = reqUrl.origin === self.location.origin;
  const isLocalData = reqUrl.pathname.includes('data/data.json');

  // Datos dinámicos: SIEMPRE a la red, nunca cacheados.
  // Incluye Google Sheets (otro origen) y el respaldo local data.json.
  if(!isSameOrigin || isLocalData){
    event.respondWith(fetch(event.request));
    return;
  }

  // Shell de la app (mismo origen): cache primero, con la red como respaldo
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      }).catch(() => cached);
    })
  );
});
