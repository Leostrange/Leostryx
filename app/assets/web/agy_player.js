/* Leostryx — мобильный видеоплеер: мгновенный старт, быстрая перемотка ±5 с
 * и оптимизированное пролистывание без фризов.
 */
(function () {
  "use strict";
  if (window.__agyPlayer && window.__agyPlayer.__installed) return;

  var STEP = 5;
  var T = function (ru, en) {
    try {
      if (window.__agyI18n && typeof window.__agyI18n.getLanguage === "function") {
        return window.__agyI18n.getLanguage() === "ru" ? ru : en;
      }
    } catch (e) {}
    return ru;
  };

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function seek(video, delta) {
    try {
      var dur = isFinite(video.duration) ? video.duration : 0;
      var t = (video.currentTime || 0) + delta;
      if (t < 0) t = 0;
      if (dur && t > dur) t = Math.max(0, dur - 0.1);
      if (typeof video.fastSeek === "function") {
        video.fastSeek(t);
      } else {
        video.currentTime = t;
      }
    } catch (e) {
      try { video.currentTime = t; } catch (_) {}
    }
  }

  function flash(host, text) {
    var el = host.querySelector(".agy-player__badge");
    if (!el) {
      el = document.createElement("div");
      el.className = "agy-player__badge";
      el.style.cssText =
        "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;" +
        "padding:10px 18px;border-radius:999px;background:rgba(0,0,0,.75);color:#fff;" +
        "font:600 15px/1 ui-sans-serif,system-ui,sans-serif;opacity:0;transition:opacity .15s ease;z-index:99;" +
        "border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px);box-shadow:0 8px 24px rgba(0,0,0,.4)";
      host.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = "1";
    clearTimeout(el.__t);
    el.__t = setTimeout(function () { el.style.opacity = "0"; }, 650);
  }

  function showLoading(video) {
    var host = video.parentElement;
    if (!host) return null;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    var el = host.querySelector(".agy-player__loading");
    if (el) return el;
    el = document.createElement("div");
    el.className = "agy-player__loading";
    el.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;gap:10px">' +
      '<svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="animation:agySpin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>' +
      '<span>' + T("Загрузка видео…", "Loading video…") + '</span>' +
      '</div>';
    el.style.cssText =
      "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(0,0,0,.65);color:#fff;font:500 13px/1.4 ui-sans-serif,system-ui,sans-serif;" +
      "letter-spacing:.04em;pointer-events:none;z-index:88;backdrop-filter:blur(4px)";
    host.appendChild(el);
    return el;
  }

  function buildBar(video, host) {
    var oldBar = host.querySelector(".agy-player__bar");
    if (oldBar) return oldBar;

    var bar = document.createElement("div");
    bar.className = "agy-player__bar";
    bar.style.cssText =
      "position:absolute;left:10px;right:10px;bottom:10px;display:flex;align-items:center;gap:8px;" +
      "padding:8px 12px;border-radius:16px;background:rgba(15,18,25,.82);backdrop-filter:blur(12px);" +
      "border:1px solid rgba(255,255,255,.12);z-index:90;color:#fff;font:500 13px/1 ui-sans-serif,system-ui,sans-serif;" +
      "box-shadow:0 8px 32px rgba(0,0,0,.5)";

    function mkButton(label, onTap, title) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (title) b.setAttribute("aria-label", title);
      b.style.cssText =
        "min-width:44px;min-height:44px;border:0;border-radius:12px;background:rgba(255,255,255,.14);" +
        "color:#fff;font:600 14px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;" +
        "display:inline-flex;align-items:center;justify-content:center;padding:0 8px;touch-action:manipulation";
      b.addEventListener("click", function (ev) {
        ev.preventDefault(); ev.stopPropagation(); onTap();
      });
      b.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
      bar.appendChild(b);
      return b;
    }

    var playBtn = mkButton("\u25B6", function () { toggle(); }, T("Воспроизвести", "Play"));
    mkButton("\u22125с", function () { seek(video, -STEP); flash(host, "\u2212" + STEP + T(" с", "s")); }, T("Назад на 5 секунд", "Rewind 5s"));
    mkButton("+5с", function () { seek(video, STEP); flash(host, "+" + STEP + T(" с", "s")); }, T("Вперёд на 5 секунд", "Forward 5s"));

    var time = document.createElement("span");
    time.className = "agy-player__time";
    time.style.cssText = "margin-left:auto;font-variant-numeric:tabular-nums;opacity:.92;padding-right:6px;font-size:12px";
    time.textContent = "0:00 / 0:00";
    bar.appendChild(time);

    function toggle() {
      try {
        if (video.paused) { video.play(); } else { video.pause(); }
      } catch (e) {}
    }

    function sync() {
      playBtn.textContent = video.paused ? "\u25B6" : "\u23F8";
      time.textContent = fmt(video.currentTime) + " / " + fmt(video.duration);
    }

    ["play", "pause", "timeupdate", "loadedmetadata", "durationchange", "ended"].forEach(function (ev) {
      video.addEventListener(ev, sync);
    });
    sync();

    host.appendChild(bar);
    return bar;
  }

  function enhance(video) {
    if (!video || video.__agyPlayer) return;
    video.__agyPlayer = true;

    try {
      video.muted = false;
      video.removeAttribute("muted");
      video.loop = false;
      video.removeAttribute("loop");
      video.setAttribute("playsinline", "");
    } catch (e) {}

    var host = video.parentElement;
    if (!host) return;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";

    var loading = showLoading(video);
    var hideLoading = function () {
      if (loading && loading.parentNode) loading.parentNode.removeChild(loading);
      loading = null;
    };
    ["loadeddata", "canplay", "playing"].forEach(function (ev) { video.addEventListener(ev, hideLoading); });
    if (video.readyState >= 2) hideLoading();
    setTimeout(hideLoading, 15000);

    // Двойной тап по краям для быстрой перемотки ±5 секунд
    var lastTap = 0, lastX = 0, lastY = 0;
    host.addEventListener(
      "pointerup",
      function (ev) {
        if (ev.target.closest && (ev.target.closest("button") || ev.target.closest(".agy-player__bar"))) return;
        var now = Date.now();
        var dx = Math.abs(ev.clientX - lastX), dy = Math.abs(ev.clientY - lastY);
        if (now - lastTap < 320 && dx < 45 && dy < 45) {
          ev.preventDefault();
          ev.stopPropagation();
          var r = video.getBoundingClientRect();
          var left = ev.clientX < (r.left + r.width / 2);
          seek(video, left ? -STEP : STEP);
          flash(host, (left ? "\u2212" : "+") + STEP + T(" с", "s"));
          lastTap = 0;
          return;
        }
        lastTap = now; lastX = ev.clientX; lastY = ev.clientY;
      },
      true
    );

    buildBar(video, host);
    setTimeout(function () { try { video.play(); } catch (e) {} }, 100);
  }

  function scan() {
    var vids = document.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) {
      try {
        if (vids[i].preload === "metadata" && !vids[i].controls && !vids[i].closest('[data-testid="media-modal-video-player"]')) continue;
        enhance(vids[i]);
      } catch (e) {}
    }
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    var run = function () { queued = false; try { scan(); } catch (e) {} };
    if (window.requestAnimationFrame) requestAnimationFrame(run); else setTimeout(run, 16);
  }

  try {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  document.addEventListener("DOMContentLoaded", schedule, { once: true });
  schedule();

  window.__agyPlayer = { __installed: true, scan: scan };
})();
