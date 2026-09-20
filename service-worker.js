const CACHE_NAME = 'matchmap-v2';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './firebase-config.js',
  './publisher.html',
  './publisher.css',
  './publisher.js',
  './account-center.html',
  './account-center.css',
  './account-center.js',
  './manifest.webmanifest',
  './img/logo.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, cloned));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        const acceptsHtml = request.headers.get('accept')?.includes('text/html');
        if (acceptsHtml) {
          return caches.match('./index.html');
        }
        throw new Error('Offline and no cached response');
      })
  );
});
