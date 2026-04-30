const CACHE_NAME = 'word-root-reader-v1';
const urlsToCache = [
  '/word-root-reader/reading-assistant.html',
  '/word-root-reader/manifest.json',
  '/word-root-reader/icon-192.png',
  '/word-root-reader/icon-512.png'
];

// 安装事件：提前缓存核心文件
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

// 拦截网络请求，优先返回缓存
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// 激活事件：清理旧版缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => {
          return name !== CACHE_NAME;
        }).map((name) => {
          return caches.delete(name);
        })
      );
    })
  );
});