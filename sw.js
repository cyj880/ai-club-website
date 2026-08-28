/* 人工智能协会网站 - Service Worker
 * 静态资源本地缓存：二次访问秒开，不受 GitHub Pages 网络波动影响。
 * 动态数据（Supabase）不走缓存，始终实时。
 *
 * 版本号由 deploy.py 在每次部署时自动替换为构建时间戳，
 * 新版本 install 时预缓存全部资源、activate 时清掉旧缓存。
 */
var VERSION = "v1787920219";
var CACHE = "ai-club-" + VERSION;

var PRECACHE = [
  "./",
  "index.html",
  "learn.html",
  "account.html",
  "admin.html",
  "privacy.html",
  "css/style.css",
  "css/portal.css",
  "js/main.js",
  "js/supabase-config.js",
  "js/supabase-api.js",
  "js/course-content.js",
  "js/learn.js",
  "js/account.js",
  "js/admin.js",
  "content/course-catalog.json",
  "assets/logo.jpg",
  "assets/favicon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: "reload" }));
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE;
      }).map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase / 外链不拦截

  // 页面导航：网络优先，离线时回退缓存
  if (request.mode === "navigate" || (request.headers.get("accept") || "").indexOf("text/html") >= 0) {
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        return response;
      }).catch(function () {
        return caches.match(request, { ignoreSearch: true }).then(function (hit) {
          return hit || caches.match(url.pathname.replace(/[^/]*$/, "") || "./");
        });
      })
    );
    return;
  }

  // 其余静态资源：缓存优先 + 后台更新（stale-while-revalidate）
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (hit) {
      var network = fetch(request).then(function (response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () { return hit; });
      return hit || network;
    })
  );
});
