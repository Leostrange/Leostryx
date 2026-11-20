/* Leostryx — медиа-вложения: бейджи для видео в поле ввода и в истории сообщений чата.
 *
 * В Android WebView canvas-миниатюра для локального видео не генерируется
 * («Failed to load video»), поэтому чип вложения остаётся без превью. В
 * бандле для категории video нет ни цвета, ни иконки — в истории сообщений чата
 * <img> с data:video/... или локальным URL падает с ошибкой декодирования,
 * отображая битую картинку и текст «User uploaded media».
 * Здесь гарантированно отображаем красивый бейдж с иконкой видеокамеры
 * и форматом (MP4, MOV и т.д.) как в строке ввода, так и в пузырях сообщений чата,
 * скрывая битый <img> через CSS и DOM-декоратор.
 */
(function () {
  "use strict";
  if (window.__agyMedia && window.__agyMedia.__cleanup) {
    try { window.__agyMedia.__cleanup(); } catch (e) {}
  }

  var CSS = [
    '/* Скрытие битых картинок видео-вложений в поле ввода и в сообщениях чата */',
    '[data-testid="input-attachment"] img[alt*="video" i],',
    '[data-testid="input-attachment"] img[alt*="Video" i],',
    '[data-testid="input-attachment-open"][aria-label*="video" i] img,',
    '[data-testid="input-attachment-open"][aria-label*=".mp4" i] img,',
    '[data-testid="input-attachment-open"][aria-label*=".mov" i] img,',
    '[data-testid="input-attachment-open"][aria-label*=".webm" i] img,',
    '[data-testid="input-attachment-open"][aria-label*=".mkv" i] img,',
    'button[aria-label*="video" i] img,',
    'button[aria-label*="Video" i] img,',
    'button[aria-label*=".mp4" i] img,',
    'button[aria-label*=".mov" i] img,',
    'button[aria-label*=".webm" i] img,',
    'button[aria-label*=".mkv" i] img,',
    'button[aria-label*=".avi" i] img,',
    'img[src^="data:video/"],',
    'img[src*="data:video/"] {',
    '  display: none !important;',
    '}',
    'button[aria-label*="video" i] > span.text-center,',
    'button[aria-label*="Video" i] > span.text-center {',
    '  display: none !important;',
    '}',
    '.agy-media-badge {',
    '  display: flex !important;',
    '  flex-direction: column !important;',
    '  align-items: center !important;',
    '  justify-content: center !important;',
    '  gap: 3px !important;',
    '  box-sizing: border-box !important;',
    '  padding: 0 4px !important;',
    '  background: color-mix(in srgb, var(--primary, #007acc) 14%, rgba(0,0,0,0.28)) !important;',
    '  color: var(--primary, #38bdf8) !important;',
    '  font-size: 11px !important;',
    '  font-weight: 700 !important;',
    '  letter-spacing: .05em !important;',
    '  cursor: pointer !important;',
    '  user-select: none !important;',
    '}',
    '[data-testid="input-attachment"] {',
    '  overflow: hidden !important;',
    '}',
    '[data-testid="input-attachment"] .agy-media-badge {',
    '  width: 100% !important;',
    '  height: 100% !important;',
    '  min-height: 32px !important;',
    '  max-height: 72px !important;',
    '  border-radius: 6px !important;',
    '  border: none !important;',
    '}',
    '[data-testid="input-attachment"] .agy-media-badge svg {',
    '  width: 18px !important;',
    '  height: 18px !important;',
    '}',
    'button:not([data-testid="input-attachment-open"]) .agy-media-badge,',
    '.agy-media-badge--msg {',
    '  width: 64px !important;',
    '  height: 64px !important;',
    '  min-width: 64px !important;',
    '  min-height: 64px !important;',
    '  max-width: 64px !important;',
    '  max-height: 64px !important;',
    '  border-radius: 6px !important;',
    '  border: 1px solid rgba(56, 189, 248, 0.28) !important;',
    '  pointer-events: none !important;',
    '}',
    '.agy-media-badge svg {',
    '  width: 24px !important;',
    '  height: 24px !important;',
    '  flex-shrink: 0 !important;',
    '}'
  ].join("\n");

  try {
    var oldStyle = document.getElementById("agy-media-style");
    if (oldStyle && oldStyle.parentNode) oldStyle.parentNode.removeChild(oldStyle);
    var st = document.createElement("style");
    st.id = "agy-media-style";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}

  var ICON =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2.5" y="6" width="13" height="12" rx="2.5"></rect>' +
    '<path d="M15.5 11.2 21 8.2v7.6l-5.5-3"></path></svg>';

  var VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|m4v|3gp|flv|wmv)\b/i;

  function isVideoElement(el) {
    if (!el) return false;
    var label = (el.getAttribute && el.getAttribute("aria-label")) || "";
    var img = el.querySelector ? el.querySelector("img") : null;
    if (!img && el.tagName === "IMG") img = el;
    var imgAlt = (img && img.getAttribute("alt")) || "";
    var imgSrc = (img && img.getAttribute("src")) || "";
    var tip = (el.getAttribute && el.getAttribute("data-tooltip-id")) || "";
    var text = el.textContent || "";
    var combined = (label + " " + imgAlt + " " + imgSrc.slice(0, 150) + " " + tip + " " + text).toLowerCase();
    if (combined.indexOf("video") !== -1) return true;
    return VIDEO_EXT_RE.test(combined);
  }

  function extensionOfElement(el) {
    if (!el) return "MP4";
    var label = (el.getAttribute && el.getAttribute("aria-label")) || "";
    var img = el.querySelector ? el.querySelector("img") : null;
    if (!img && el.tagName === "IMG") img = el;
    var imgAlt = (img && img.getAttribute("alt")) || "";
    var imgSrc = (img && img.getAttribute("src")) || "";
    var text = el.textContent || "";
    var combined = label + " " + imgAlt + " " + imgSrc.slice(0, 150) + " " + text;
    var m = VIDEO_EXT_RE.exec(combined);
    if (m) return m[1].toUpperCase();
    if (/webm/i.test(combined)) return "WEBM";
    if (/mov/i.test(combined)) return "MOV";
    if (/mkv/i.test(combined)) return "MKV";
    return "MP4";
  }

  function makeBadge(el, isMsg) {
    var badge = document.createElement("span");
    badge.className = "agy-media-badge" + (isMsg ? " agy-media-badge--msg" : "");
    badge.innerHTML = ICON + "<span>" + extensionOfElement(el) + "</span>";
    return badge;
  }

  var SEL_CHIP = '[data-testid="input-attachment"]';
  var SEL_OPEN = '[data-testid="input-attachment-open"]';

  function decorateChip(chip) {
    if (!isVideoElement(chip)) return;
    var existing = chip.querySelectorAll(".agy-media-badge");
    if (existing.length === 1) return;
    if (existing.length > 1) {
      for (var i = 1; i < existing.length; i++) existing[i].remove();
      return;
    }

    var open = chip.querySelector(SEL_OPEN) || chip;
    var img = open.querySelector("img") || chip.querySelector("img");
    if (img) img.style.display = "none";

    var badge = makeBadge(chip, false);
    if (img && img.parentNode) {
      img.parentNode.insertBefore(badge, img);
    } else {
      open.appendChild(badge);
    }
  }

  function decorateButton(btn) {
    if (!btn || !isVideoElement(btn)) return;
    if (btn.closest(SEL_CHIP)) return;
    if (btn.querySelector(".agy-media-badge")) return;

    var img = btn.querySelector("img");
    if (img) img.style.display = "none";

    var span = btn.querySelector("span.text-center");
    if (span) span.style.display = "none";

    var badge = makeBadge(btn, true);
    if (img && img.parentNode) {
      img.parentNode.insertBefore(badge, img);
    } else {
      btn.appendChild(badge);
    }
  }

  var SEL_BTNS = [
    'button[aria-label*="video" i]',
    'button[aria-label*="Video" i]',
    'button[aria-label*=".mp4" i]',
    'button[aria-label*=".mov" i]',
    'button[aria-label*=".webm" i]',
    'button[aria-label*=".mkv" i]',
    'button[aria-label*=".avi" i]'
  ].join(", ");

  function decorate() {
    // 1. Поле ввода (вложения перед отправкой)
    var chips = document.querySelectorAll(SEL_CHIP);
    for (var i = 0; i < chips.length; i++) {
      try { decorateChip(chips[i]); } catch (e) {}
    }

    // 2. Кнопки медиа-вложений в истории чата (только вне поля ввода)
    var btns = document.querySelectorAll(SEL_BTNS);
    for (var j = 0; j < btns.length; j++) {
      if (btns[j].closest(SEL_CHIP)) continue;
      try { decorateButton(btns[j]); } catch (e) {}
    }

    // 3. Картинки медиа (поиск родительской кнопки для data:video/ или альтов вне поля ввода)
    var mediaImgs = document.querySelectorAll('img[alt^="User uploaded media"], img[src^="data:video/"], img[src*="video/"]');
    for (var k = 0; k < mediaImgs.length; k++) {
      try {
        var p = mediaImgs[k].closest("button") || mediaImgs[k].parentElement;
        if (p && !p.closest(SEL_CHIP)) decorateButton(p);
      } catch (e) {}
    }
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    var run = function () { queued = false; try { decorate(); } catch (e) {} };
    if (window.requestAnimationFrame) requestAnimationFrame(run); else setTimeout(run, 16);
  }

  var mo = null;
  try {
    mo = new MutationObserver(schedule);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  document.addEventListener("DOMContentLoaded", schedule, { once: true });
  schedule();

  var timer = null;
  try { timer = setInterval(schedule, 800); } catch (e) {}

  window.__agyMedia = {
    __installed: true,
    decorate: decorate,
    __cleanup: function () {
      if (mo) { try { mo.disconnect(); } catch (e) {} }
      if (timer) { try { clearInterval(timer); } catch (e) {} }
    }
  };
})();
