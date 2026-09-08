const CACHE = 'single-point-v10';
const STATIC = ['/mobile.html','/mobile-bridge.js','/learning.js','/learning-support.js','/learning-updates.css','/manifest.webmanifest','/icon-192.png','/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const responses = await Promise.all(STATIC.map(async path => {
      const response = await fetch(path, {cache:'reload'});
      if (!response.ok || response.redirected || (path.endsWith('.js') && !/javascript/.test(response.headers.get('content-type') || ''))) throw new Error('Incomplete application update');
      return [path,response];
    }));
    const cache = await caches.open(CACHE);
    await Promise.all(responses.map(([path,response]) => cache.put(path,response)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('single-point-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const navigation = event.request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/mobile.html');
  if (!STATIC.includes(url.pathname) && !navigation) return;
  // One complete version at a time; never cache sign-in redirects, API responses or errors.
  event.respondWith(caches.open(CACHE).then(async cache => {
    const key = navigation ? '/mobile.html' : url.pathname;
    const saved = await cache.match(key);
    if (saved) return saved;
    return fetch(event.request);
  }));
});
