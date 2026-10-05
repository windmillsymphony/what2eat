/* ============================================================
 * sw.js — Service Worker：网络优先 + 缓存兜底，离线可用
 * 只缓存本站静态资源；数据全部在 localStorage，不经网络、不缓存
 * 更新代码后请把 CACHE 版本号 +1，否则旧文件可能被缓存命中
 * ============================================================ */
'use strict';

const CACHE = 'w2e-v4';

const ASSETS = [
  './', './index.html', './css/style.css', './manifest.webmanifest',
  './js/storage.js', './js/data.js', './js/recommend.js',
  './js/ui.js', './js/views.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // 不碰外部资源

  // 网络优先：在线时总是拿最新文件并更新缓存；离线时回退到缓存
  // cache:'no-store' 强制穿透浏览器 HTTP 缓存（GitHub Pages 静态文件带
  // 10 分钟缓存头，否则部署后短时间内刷新还是旧文件）
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(e.request).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
  );
});
