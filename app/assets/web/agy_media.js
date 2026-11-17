/* Leostryx — бейдж для видео-вложений в поле ввода.
 *
 * В Android WebView canvas-миниатюра для локального видео не генерируется
 * («Failed to load video»), поэтому чип вложения остаётся без превью. В
 * бандле для категории video нет ни цвета, ни иконки — рисуется пустой
 * серый прямоугольник или битая картинка «Video attachment».
 * Здесь гарантированно отображаем красивый бейдж с иконкой видеокамеры
 * и форматом (MP4, MOV и т.д.), скрывая битый <img> через CSS и DOM-декоратор.
 */
(function () {
  "use strict";
  if (window.__agyMedia && window.__agyMedia.__installed) return;

  var CSS = [
    '[data-testid="input-attachment"] img[alt*="video" i],',
    '[data-testid="input-attachment"] img[alt*="Video" i],',
    '[data-testid="input-attachment-open"][aria-label*="video" i] img,',
    '[data-testid="input-attachment-open"][aria-label*=".mp4" i] img,',
    '[data-testid="input-attachment-open"][aria-label*=".mov" i] img,',
    '[data-testid="input-attachment-open"][aria-label*=".webm" i] img,',
    '[data-testid="input-attachment-open"][aria-label*=".mkv" i] img {',
    '  display: none !important;',
    '}',
    '.agy-media-badge {',
    '  display: flex !important;',
    '  flex-direction: column !important;',
    '  align-items: center !important;',
    '  justify-content: center !important;',
    '  gap: 5px !important;',
    '  width: 100% !important;',
    '  height: 72px !important;',
    '  min-height: 72px !important;',
    '  max-height: 72px !important;',
    '  box-sizing: border-box !important;',
    '  padding: 0 4px !important;',
    '  border-radius: 0 !important;',
    '  background: color-mix(in srgb, var(--primary, #007acc) 14%, rgba(0,0,0,0.25)) !important;',
    '  color: var(--primary, #38bdf8) !important;',
    '  border: none !important;',
    '  font-size: 11px !important;',
    '  font-weight: 700 !important;',
    '  letter-spacing: .05em !important;',
    '  flex: 0 0 72px !important;',
    '  cursor: pointer !important;',
    '  user-select: none !important;',
    '}',
    '.agy-media-badge svg {',
    '  width: 24px !important;',
    '  height: 24px !important;',
    '  flex-shrink: 0 !important;',
    '}'
  ].join("\n");

  try {
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

  var SEL_CHIP = '[data-testid="input-attachment"]';
  var SEL_OPEN = '[data-testid="input-attachment-open"]';

  function isVideo(chip) {
    var open = chip.querySelector(SEL_OPEN);
    var img = chip.querySelector("img");
    var label = (open && open.getAttribute("aria-label")) || chip.getAttribute("aria-label") || "";
    var imgAlt = (img && img.getAttribute("alt")) || "";
    var tip = chip.getAttribute("data-tooltip-id") || "";
    var text = chip.textContent || "";
    var combined = (label + " " + imgAlt + " " + tip + " " + text).toLowerCase();
    if (/video/i.test(combined)) return true;
    return /\.(mp4|mov|webm|mkv|avi|m4v|3gp|flv|wmv)\b/i.test(combined);
  }

  function extensionOf(chip) {
    var open = chip.querySelector(SEL_OPEN);
    var img = chip.querySelector("img");
    var label = (open && open.getAttribute("aria-label")) || chip.getAttribute("aria-label") || "";
    var imgAlt = (img && img.getAttribute("alt")) || "";
    var text = chip.textContent || "";
    var combined = label + " " + imgAlt + " " + text;
    var m = /\.(mp4|mov|webm|mkv|avi|m4v|3gp|flv|wmv)\b/i.exec(combined);
    return m ? m[1].toUpperCase() : "MP4";
  }

  // Бейдж вместо битой картинки: иконка камеры + расширение (MP4 и т.п.)
  function makeBadge(chip) {
    var badge = document.createElement("span");
    badge.className = "agy-media-badge";
    badge.innerHTML = ICON + "<span>" + extensionOf(chip) + "</span>";
    return badge;
  }

  function decorateChip(chip) {
    if (!isVideo(chip)) return;
    var open = chip.querySelector(SEL_OPEN) || chip;
    var existingBadge = chip.querySelector(".agy-media-badge");
    if (existingBadge) return;

    var img = open.querySelector("img");
    if (img) {
      img.style.display = "none";
    }

    var badge = makeBadge(chip);
    if (img && img.parentNode) {
      img.parentNode.insertBefore(badge, img);
    } else {
      var holder = open.firstElementChild || open;
      holder.insertBefore(badge, holder.firstChild);
    }
  }

  function decorate() {
    var chips = document.querySelectorAll(SEL_CHIP);
    for (var i = 0; i < chips.length; i++) {
      try { decorateChip(chips[i]); } catch (e) {}
    }
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    var run = function () { queued = false; try { decorate(); } catch (e) {} };
    if (window.requestAnimationFrame) requestAnimationFrame(run); else setTimeout(run, 16);
  }

  try {
    var mo = new MutationObserver(schedule);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  document.addEventListener("DOMContentLoaded", schedule, { once: true });
  schedule();

  try { setInterval(schedule, 800); } catch (e) {}

  window.__agyMedia = { __installed: true, decorate: decorate };
})();
