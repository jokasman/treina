// Service worker: guarda a app para funcionar sem rede (ginásio). Os pedidos ao Google não passam por aqui.
const VERSAO = 'treina-v3';
const FICHEIROS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/config.js',
  './js/db.js',
  './js/drive.js',
  './js/som.js',
  './js/core/cadencia.js',
  './js/core/estado.js',
  './js/core/perfil.js',
  './js/core/peso.js',
  './js/core/plano.js',
  './js/core/pt.js',
  './js/core/treino.js',
  './js/core/util.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(FICHEIROS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Rede primeiro (para receber atualizações), cache se não houver rede.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && !url.search) {
          const copia = r.clone();
          caches.open(VERSAO).then((c) => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then((r) => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
