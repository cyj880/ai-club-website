// Service Worker 注册：https（或 localhost）环境下启用静态资源缓存
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(function () { /* 注册失败不影响页面功能 */ });
}
