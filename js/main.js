// 人工智能协会招新网站 - 交互脚本
(function () {
  "use strict";

  // 给 <html> 移除 no-js 标记（配合 CSS 兜底显示）
  document.documentElement.classList.remove("no-js");

  // 1. 滚动时给导航栏加阴影
  var navbar = document.getElementById("navbar");
  window.addEventListener("scroll", function () {
    if (window.scrollY > 10) {
      navbar.classList.add("scrolled");
    } else {
      navbar.classList.remove("scrolled");
    }
  }, { passive: true });

  // 2. 滚动渐入动画
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { observer.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("visible"); });
  }

  // 3. 复制QQ群号
  var QQ_NUMBER = "551018478";
  var copyBtn = document.getElementById("copyQQBtn");

  function copyWithFallback(text) {
    // https 环境用 Clipboard API；本地 file:// 环境退回 execCommand
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  copyBtn.addEventListener("click", function () {
    copyWithFallback(QQ_NUMBER).then(function () {
      copyBtn.textContent = "✅ 复制成功，去QQ加群吧！";
    }).catch(function () {
      copyBtn.textContent = "❌ 复制失败，请手动记下群号";
    }).finally(function () {
      setTimeout(function () {
        copyBtn.textContent = "📋 复制群号";
      }, 2500);
    });
  });
})();
