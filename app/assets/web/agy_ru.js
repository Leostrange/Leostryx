/* Antigravity RU — small runtime fixes on top of the original 2.4.1 bundle.
 * Never moves or edits React-owned nodes; only adds its own fixed elements. */
(function () {
  "use strict";
  if (window.__agyRuFixes) return;
  window.__agyRuFixes = true;


  /* ---- Usage: "Refreshing…" without changing the panel height ----------
   * 2.4.1 inserts a status row (+ separator) above the quota list while it
   * refreshes, so the sheet grows and then shrinks. agy_ru.css hides that row;
   * here we mirror its presence as a small spinner pinned to the right end of
   * the sheet header (the row with "‹ Usage"). */
  var ROW_SEL = '[data-testid="model-quota-refreshing"]';
  var badge = null;
  var raf = 0;

  function inlineRow() {
    // Only the inline variant (the empty-state one is a tall flex-col block
    // that IS the content and stays as it is).
    var rows = document.querySelectorAll(ROW_SEL);
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].classList.contains("flex-col") && rows[i].getClientRects().length === 0) return rows[i];
    }
    return null;
  }

  function headerFor(row) {
    // The scroll list is the row's parent; the header is the nearest preceding
    // block above it that starts higher on screen inside the same sheet.
    var list = row.parentElement;
    if (!list) return null;
    var listTop = list.getBoundingClientRect().top;
    var node = list;
    for (var depth = 0; node && depth < 6; depth++) {
      var prev = node.previousElementSibling;
      while (prev) {
        var r = prev.getBoundingClientRect();
        if (r.height > 16 && r.bottom <= listTop + 2 && r.width > 120) return prev;
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
    }
    return null;
  }

  function label() {
    var lang = "";
    try { lang = (window.AgyLang && window.AgyLang.getLang()) || ""; } catch (e) {}
    if (lang === "system" || !lang) lang = /^ru\b/i.test(navigator.language || "") ? "ru" : "en";
    return lang === "ru" ? "Обновление…" : "Refreshing…";
  }

  function place() {
    raf = 0;
    var row = inlineRow();
    var header = row && headerFor(row);
    if (!header) {
      if (badge) badge.style.display = "none";
      return;
    }
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "agy-usage-refreshing";
      badge.setAttribute("role", "status");
      badge.setAttribute("aria-live", "polite");
      badge.innerHTML = '<span class="agy-usage-spin" aria-hidden="true"></span><span class="agy-usage-text"></span>';
      document.body.appendChild(badge);
    }
    badge.querySelector(".agy-usage-text").textContent = label();
    var r = header.getBoundingClientRect();
    badge.style.display = "flex";
    badge.style.top = Math.round(r.top) + "px";
    badge.style.height = Math.round(r.height) + "px";
    badge.style.right = Math.max(12, Math.round(window.innerWidth - r.right + 16)) + "px";
  }

  function schedule() { if (!raf) raf = requestAnimationFrame(place); }

  function start() {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule, { passive: true });
    document.addEventListener("scroll", schedule, { passive: true, capture: true });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start, { once: true });

  /* ---- Composer focus guard (ТЗ 6.3, B-08) ---------------------------------
   * 2.4.1 refocuses the chat editor after "+" / the model selector / menu
   * closes, which pops the keyboard. Block that programmatic focus when the
   * last touch was on those controls or inside an open menu/sheet. A touch on
   * the editor itself, and menu items that need typing (Mentions / Actions),
   * keep the original behaviour. */
  var BOX = "[data-testid='agent-input-box']";
  var MENUISH = "[role='menu'],[role='menuitem'],[role='listbox'],[role='option'],[role='dialog']," +
                "[data-testid^='model-selector'],[aria-label='Add context'],[aria-label='Добавить контекст']";
  var guard = { t: 0, block: false };

  function isEditor(el) {
    return !!(el && el.nodeType === 1 && el.closest && el.closest(BOX) &&
      (el.isContentEditable || el.tagName === "TEXTAREA"));
  }
  function menuOpen() {
    return !!document.querySelector("[role='menu'],[role='listbox'],[role='dialog'],[data-testid='model-selector-panel']");
  }
  document.addEventListener("pointerdown", function (e) {
    var t = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
    if (!t || !t.closest) return;
    var item = t.closest("[role='menuitem'],[role='option'],button");
    var label = item ? (item.textContent || "").trim() : "";
    var needsInput = /^(Mentions|Actions|Упоминания|Действия)$/.test(label);
    var onEditor = isEditor(t) || !!t.closest(BOX + " [contenteditable='true']");
    var onControls = !!t.closest(MENUISH);
    // The "+" (Add context) button must open its menu even while text is typed.
    // Blocking editor focus here blurred the editor, dismissed the keyboard and
    // the layout shift ate the tap, so "+" did nothing. Never guard on that tap.
    var onAdd = !!t.closest("[aria-label='Add context'],[aria-label='Добавить контекст']");
    guard = { t: Date.now(), block: !onEditor && !needsInput && !onAdd && (onControls || menuOpen()) };
  }, true);

  function shouldBlock(el) {
    return guard.block && Date.now() - guard.t < 1500 && isEditor(el) && document.activeElement !== el;
  }
  var nativeFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function () {
    if (shouldBlock(this)) return;
    return nativeFocus.apply(this, arguments);
  };
  document.addEventListener("focusin", function (e) {
    if (guard.block && Date.now() - guard.t < 1500 && isEditor(e.target)) {
      try { e.target.blur(); } catch (err) {}
    }
  }, true);

  /* ---- Focus allowed again once an attachment is really added (ТЗ 6.3) --- */
  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var added = list[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType === 1 && (n.matches("[data-testid='input-attachment']") || n.querySelector("[data-testid='input-attachment']"))) {
          // After a file is attached the editor must NOT grab focus (it kept the
          // keyboard up and swallowed the next tap on "+").
          guard = { t: Date.now(), block: true };
          var ae = document.activeElement;
          if (ae && isEditor(ae)) { try { ae.blur(); } catch (err) {} }
          return;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* ---- Chat input repaint nudge -------------------------------------------
   * Intermittently, after the keyboard opens on an empty focused input, the
   * WebView leaves the input card unpainted (black) until the next repaint
   * (typing or tapping the chat fixes it). Force that repaint ourselves while
   * the keyboard settles: read layout, then toggle a no-op opacity for 2 frames. */
  function nudge() {
    var box = document.querySelector(BOX);
    if (!box || !box.contains(document.activeElement)) return;
    // 1px scroll jiggle re-rasterizes without promoting a layer.
    try { window.scrollBy(0, 1); window.scrollBy(0, -1); } catch (e) {}
    // AND clear the black texture on the composer's own compositing layers (the
    // "input card goes black on focus" case) — repaint only elements that are
    // ALREADY their own layer, never <body>, so no flashing spots.
    compositingAncestors(document.activeElement || box).forEach(repaint);
  }
  function nudgeSeries() { [120, 350, 700, 1200].forEach(function (ms) { setTimeout(nudge, ms); }); }

  /* Whole-page repaint after returning from a system window (file picker,
   * permission dialog) and when an attachment/image appears: the WebView can
   * leave large areas unpainted (black) until something repaints them. */
  // Overlay containers that sit on their own compositing layer and can blacken:
  // the app's menus, selects, popovers, bottom sheets and modal/dialog roots.
  var OVERLAY_SEL = '[role="menu"],[role="listbox"],[role="dialog"],[data-select-popup],' +
    '[data-radix-popper-content-wrapper],.typeahead-popover,#typeahead-menu,' +
    '[data-testid="bottom-sheet"],[class*="animate-slideIn"],[class*="animate-in"],.z-\\[6000\\]';
  function repaintOverlays() {
    var nodes;
    try { nodes = document.querySelectorAll(OVERLAY_SEL); } catch (e) { return; }
    for (var i = 0; i < nodes.length; i++) repaint(nodes[i]);
  }
  function nudgePage() {
    // Compositing-safe: a 1px scroll jiggle re-rasterizes without promoting a
    // layer. Then clear the black texture on the overlay layers that are open and
    // on the focused field's compositing ancestors — never on <body> (that is what
    // caused the flashing black spots).
    try { window.scrollBy(0, 1); window.scrollBy(0, -1); } catch (e) {}
    try {
      var sc = document.scrollingElement || document.documentElement;
      if (sc) { var top = sc.scrollTop; sc.scrollTop = top + 1; sc.scrollTop = top; }
    } catch (e) {}
    repaintOverlays();
    var ae = document.activeElement;
    if (ae && ae !== document.body) compositingAncestors(ae).forEach(repaint);
  }
  var pageTimers = [];
  function nudgePageSeries() {
    pageTimers.forEach(clearTimeout);
    pageTimers = [0, 150, 400, 800, 1500, 2500].map(function (ms) { return setTimeout(nudgePage, ms); });
  }

  /* Settings / Providers inputs live inside the settings panel, which is a
   * transformed (animated) subtree with its own scroll container and compositing
   * layer. Toggling body opacity does not force that layer to repaint, so the
   * keyboard can leave a black overlay over the fields. Repaint the field's own
   * scroll ancestor directly (a 1px scroll jiggle + an opacity/transform no-op). */
  function scrollAncestor(el) {
    for (var p = el && el.parentElement; p; p = p.parentElement) {
      var cs;
      try { cs = getComputedStyle(p); } catch (e) { continue; }
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2) return p;
    }
    return document.scrollingElement || document.documentElement;
  }
  // Ancestors that sit on their own compositing layer (transform/filter/opacity/
  // fixed) — on this WebView the keyboard can leave that layer's texture black,
  // and only repainting THAT layer clears it.
  function compositingAncestors(el) {
    var out = [];
    for (var p = el && el.parentElement; p && p !== document.body; p = p.parentElement) {
      var cs; try { cs = getComputedStyle(p); } catch (e) { continue; }
      if ((cs.transform && cs.transform !== "none") || (cs.filter && cs.filter !== "none") ||
          (cs.backdropFilter && cs.backdropFilter !== "none") || /transform|opacity/.test(cs.willChange || "") ||
          (cs.opacity && cs.opacity !== "1") || cs.position === "fixed" || cs.position === "sticky") out.push(p);
    }
    return out;
  }
  /* Clear the black GPU texture on an ALREADY-compositing element by forcing it
   * to re-rasterize. A brief opacity delta does this; 0.999 for two frames is
   * imperceptible. CRITICAL: only call this on an element that is ALREADY its own
   * compositing layer (transform/filter/opacity/fixed). Never on <body> or a big
   * content scroller — toggling opacity there restructures child layers and makes
   * them flash black ("черные пятна"). That is why the earlier broad version was
   * wrong: here we repaint ONLY the specific layer that blacked out. */
  // Do not mutate compositing transforms on live app layers. Concurrent
  // repaint timers can overwrite an animation or change stacking order.
  function repaint(n) { if (n) void n.offsetWidth; }
  function revealProviderField(el) {
    if (!el || !el.isConnected || document.activeElement !== el) return;
    var rect = el.getBoundingClientRect();
    var vv = window.visualViewport;
    var bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    var top = vv ? vv.offsetTop : 0;
    if (rect.bottom > bottom - 12 || rect.top < top + 12) {
      try { el.scrollIntoView({block: "center", behavior: "auto"}); } catch (e) {}
    }
  }
  function revealProviderSeries(el) {
    fieldTimers.forEach(clearTimeout);
    fieldTimers = [0, 120, 300, 600].map(function (ms) { return setTimeout(function () { revealProviderField(el); }, ms); });
  }
  function nudgeField(el) {
    if (!el || !el.isConnected) return;
    try { el.scrollIntoView({ block: "center", behavior: "auto" }); } catch (e) {}
    // Compositing-safe: jiggle the scroll container by 1px (keeps the field above
    // the keyboard, re-rasterizes without layer changes).
    var sc = scrollAncestor(el);
    try { var top = sc.scrollTop; sc.scrollTop = top + 1; sc.scrollTop = top; } catch (e) {}
    // Clear the black texture ONLY on the containers that are already their own
    // compositing layer (the settings panel / popover). NOT body, NOT the scroll
    // container — repainting those causes the flashing black spots.
    compositingAncestors(el).forEach(repaint);
  }
  var fieldTimers = [];
  function nudgeFieldSeries(el) {
    fieldTimers.forEach(clearTimeout);
    fieldTimers = [0, 120, 300, 600, 1100, 1800].map(function (ms) { return setTimeout(function () { nudgeField(el); }, ms); });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      guard = { t: Date.now(), block: true };
      nudgePageSeries();
    }
  });

  /* Slash / mention list: show every item without an inner scroll (Out27),
   * compact rows, kept right above the input box. */
  function fitTypeahead() {
    var m = document.getElementById("typeahead-menu");
    if (!m) return;
    var all = m.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var cs = getComputedStyle(all[i]);
      if (/(auto|scroll)/.test(cs.overflowY) || cs.maxHeight !== "none") {
        all[i].style.setProperty("max-height", "none", "important");
        all[i].style.setProperty("overflow", "visible", "important");
      }
    }
    m.classList.add("agy-typeahead");
    var box = document.querySelector(BOX);
    if (!box) return;
    var br = box.getBoundingClientRect(), h = m.getBoundingClientRect().height;
    var top = Math.max(4, br.top - h - 6);
    m.style.setProperty("top", Math.round(top + window.pageYOffset) + "px", "important");
  }
  /* Popovers / menus (projects "+", filter, …): narrow vertical cards like
   * Out27 — width by content, and the current value shown next to a row with
   * a submenu ("Group by  Project >") is hidden: it is visible in the submenu. */
  function fitPopups() {
    var ps = document.querySelectorAll("[class*='animate-slideIn']");
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p.closest("[data-testid^='model-selector']") || p.querySelector("[data-testid^='model-selector'],[data-testid='model-quota-refreshing']")) continue;
      if (p.matches("[data-select-popup],[role='listbox'],[role='menu']")) continue;   // menus keep their own width   // selects keep trigger width
      if (p.querySelector("input,textarea,[contenteditable='true']")) continue;
      p.style.setProperty("width", "max-content", "important");
      p.style.setProperty("min-width", "0", "important");
      p.style.setProperty("max-width", "min(240px, calc(100vw - 16px))", "important");
      var rows = p.querySelectorAll("button,[role='menuitem'],.main-row-trigger");
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var texts = [];
        for (var c = 0; c < row.children.length; c++) {
          var ch = row.children[c];
          if (ch.tagName !== "svg" && (ch.textContent || "").trim()) texts.push(ch);
        }
        if (texts.length < 2 || !row.querySelector("svg")) continue;
        for (var t = 1; t < texts.length; t++) {
          if (/text-(muted|secondary)-foreground/.test(texts[t].className || "") || texts[t].querySelector("[class*='text-muted'],[class*='text-secondary']") || t === texts.length - 1) {
            texts[t].style.setProperty("display", "none", "important");
          }
        }
      }
    }
  }
  /* Selects (Base UI select popup): short lists = exactly the trigger width;
   * lists with descriptions = width of the settings card that holds the row,
   * aligned to it (never wider than that card). */
  var selTrigger = null, selLoop = 0;
  function selTick() {
    selLoop = 0;
    if (!document.querySelector("[data-select-popup]")) return;
    fitSelects();
    selLoop = requestAnimationFrame(selTick);
  }
  document.addEventListener("pointerdown", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[role='combobox'],[aria-haspopup],button") : null;
    if (t && !t.closest("[data-select-popup]")) selTrigger = t;
  }, true);
  function fitSelects() {
    var ps = document.querySelectorAll("[data-select-popup]");
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var tr = selTrigger && selTrigger.isConnected ? selTrigger : null;
      if (!tr) continue;
      var opts = p.querySelectorAll("[role='option']");
      var described = false;
      for (var o = 0; o < opts.length; o++) {
        var lines = (opts[o].innerText || "").split("\n").filter(function (x) { return x.trim(); });
        if (lines.length > 1) { described = true; break; }
      }
      var tw = tr.getBoundingClientRect();
      if (!described) {
        p.style.setProperty("width", Math.round(tw.width) + "px", "important");
        p.style.setProperty("min-width", "0", "important");
        p.style.setProperty("max-width", "none", "important");
        p.style.removeProperty("translate"); delete p.dataset.agyDx;
        continue;
      }
      var card = tr.parentElement, vw = window.innerWidth;
      while (card && card !== document.body) {
        var cs = getComputedStyle(card), r = card.getBoundingClientRect();
        if (r.width >= vw * 0.7 && parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderTopLeftRadius) > 0) break;
        card = card.parentElement;
      }
      var cr = card && card !== document.body ? card.getBoundingClientRect() : { left: 16, width: vw - 32 };
      p.style.setProperty("width", Math.round(cr.width) + "px", "important");
      p.style.setProperty("min-width", "0", "important");
      p.style.setProperty("max-width", "none", "important");
      var cur = parseFloat(p.dataset.agyDx || "0") || 0;
      var base = p.getBoundingClientRect().left - cur;      // where floating-ui put it
      var dx = Math.round(cr.left - base);
      if (dx !== cur) { p.dataset.agyDx = String(dx); p.style.setProperty("translate", dx + "px 0", "important"); }
    }
  }

  /* Settings: system Back (button or swipe gesture) goes one settings page
   * back instead of leaving to the chat. Every page with a "Back" header gets
   * one history entry; popping it clicks that page's own Back button. */
  function sheetBack() {
    var bs = document.querySelectorAll("[data-testid='bottom-sheet'] button");
    var found = null;
    for (var i = 0; i < bs.length; i++) {
      var t = (bs[i].innerText || bs[i].textContent || "").trim();
      if (!/(^|\s)(Назад|Back)$/.test(t) && !/^(Назад|Back)$/.test((bs[i].getAttribute("aria-label") || "").trim())) continue;
      var r = bs[i].getBoundingClientRect();
      if (r.width > 0 && r.left >= -1 && r.left < window.innerWidth / 2) found = bs[i];
    }
    return found;
  }
  /* Called by the native Back handler (button and edge swipe). Returns true
   * when the page handled Back: an open menu/list closes first, otherwise the
   * open settings page goes one level back. */
  window.__agyBack = function () {
    if (window.__agyShieldClose && window.__agyShieldClose()) return true;
    var open = document.querySelector("[data-select-popup],[class*='animate-slideIn'],#typeahead-menu");
    if (open) {
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
      return true;
    }
    var btn = sheetBack();
    if (btn) { btn.click(); return true; }
    // Root settings screen: a side swipe must not close settings (ТЗ 9.4);
    // they close only with their own control or a swipe down.
    var sheets = document.querySelectorAll("[data-testid='bottom-sheet']");
    for (var i = 0; i < sheets.length; i++) {
      var tx = sheets[i].innerText || "";
      if (/(Общие|General)/.test(tx) && /(Оформление|Appearance)/.test(tx)) return true;
    }
    return false;
  };

  var popRaf = 0;
  new MutationObserver(function () {
    if (!popRaf) popRaf = requestAnimationFrame(function () { popRaf = 0; fitPopups(); if (!selLoop) selTick(); });
  }).observe(document.body, { childList: true, subtree: true });

  var taRaf = 0;
  new MutationObserver(function () {
    if (!taRaf) taRaf = requestAnimationFrame(function () { taRaf = 0; fitTypeahead(); });
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("focus", nudgePageSeries);
  window.addEventListener("pageshow", nudgePageSeries);
  document.addEventListener("load", function (e) {
    if (e.target && e.target.tagName === "IMG" && e.target.closest && e.target.closest("[data-testid='input-attachment']")) nudgePageSeries();
  }, true);
  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var rm = list[i].removedNodes, ad = list[i].addedNodes, all = [];
      for (var a = 0; a < ad.length; a++) all.push(ad[a]);
      for (var r = 0; r < rm.length; r++) all.push(rm[r]);
      for (var j = 0; j < all.length; j++) {
        var n = all[j];
        if (n.nodeType === 1 && (n.matches("[data-testid='input-attachment']") || n.querySelector("[data-testid='input-attachment']"))) { nudgePageSeries(); return; }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* A context menu / select popover / bottom sheet opens on its own compositing
   * layer; on this WebView that layer can appear fully black. Repaint it the
   * moment it is added (and once more after its slide-in settles). */
  var ovTimers = [];
  function repaintOverlaysSeries() {
    ovTimers.forEach(clearTimeout);
    ovTimers = [0, 60, 180, 360].map(function (ms) { return setTimeout(repaintOverlays, ms); });
  }
  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var ad = list[i].addedNodes;
      for (var j = 0; j < ad.length; j++) {
        var n = ad[j];
        if (n.nodeType !== 1) continue;
        try {
          if ((n.matches && n.matches(OVERLAY_SEL)) || (n.querySelector && n.querySelector(OVERLAY_SEL))) { repaintOverlaysSeries(); return; }
        } catch (e) {}
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* The reasoning ("Размышление"/Thinking) block is a maxHeight collapsible with
   * its own scroll/transform panel; on this WebView that panel renders fully
   * black while it streams or when expanded. Repaint its compositing layers as it
   * updates. */
  var THINK = "[data-testid='thinking-collapsible-trigger']";
  function repaintThinking() {
    var trigs;
    try { trigs = document.querySelectorAll(THINK); } catch (e) { return; }
    for (var i = 0; i < trigs.length; i++) {
      var blk = trigs[i].parentElement; if (!blk) continue;
      compositingAncestors(trigs[i]).forEach(repaint);
      var kids = blk.querySelectorAll("*");
      for (var j = 0; j < kids.length && j < 80; j++) {
        var cs; try { cs = getComputedStyle(kids[j]); } catch (e) { continue; }
        if ((cs.transform && cs.transform !== "none") || /(auto|scroll)/.test(cs.overflowY) ||
            /transform|opacity/.test(cs.willChange || "") || (cs.opacity && cs.opacity !== "1") ||
            cs.position === "sticky") repaint(kids[j]);
      }
    }
  }
  var thTimer = 0;
  function repaintThinkingSoon() {
    if (thTimer) return;                         // throttle to ~8/sec while streaming
    thTimer = setTimeout(function () { thTimer = 0; repaintThinking(); }, 120);
  }
  new MutationObserver(function () {
    try { if (document.querySelector(THINK)) repaintThinkingSoon(); } catch (e) {}
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  // Expand / collapse: repaint through the animation.
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest(THINK)) { [0, 80, 220, 420].forEach(function (ms) { setTimeout(repaintThinking, ms); }); }
  }, true);

  document.addEventListener("focusin", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(BOX)) { nudgeSeries(); return; }
    if (t.closest('.agy-providers')) {
      pageTimers.forEach(clearTimeout); revealProviderSeries(t);
      return;
    }
    // Any other editable field (settings inputs, Providers, Tools): opening the
    // keyboard can leave black areas on this WebView — repaint the whole page and
    // the field's own (transformed) scroll container.
    if (t.matches && t.matches("input:not([type='checkbox']):not([type='radio']),textarea,select,[contenteditable='true']")) { nudgePageSeries(); nudgeFieldSeries(t); }
  }, true);
  if (window.visualViewport) {
    var vvTimer = 0;
    window.visualViewport.addEventListener("resize", function () {
      clearTimeout(vvTimer);
      var ae = document.activeElement;
      var isInput = (ae && ae !== document.body && ae.matches && ae.matches("input:not([type='checkbox']):not([type='radio']),textarea,[contenteditable='true']"));
      if (!isInput) {
        // Keyboard is closing/closed: don't delay or jiggle scroll, let chat drop down smoothly
        return;
      }
      vvTimer = setTimeout(function () {
        var active = document.activeElement;
        if (active && active.closest && active.closest('.agy-providers')) { revealProviderSeries(active); return; }
        nudgeSeries();
        var e = document.activeElement;
        if (e && e.matches && e.matches("input:not([type='checkbox']):not([type='radio']),textarea,select,[contenteditable='true']") && !e.closest(BOX)) nudgeFieldSeries(e);
      }, 50);
    }, { passive: true });
  }

  /* ---- Compact menus & Glass Popovers (Release 3.0.7) --------------------- */
  var lastTrigger = null;
  var sheetTriggers = new WeakMap();
  document.addEventListener("pointerdown", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("button,[role='button']") : null;
    if (t && !t.closest("[data-testid='bottom-sheet']")) lastTrigger = t;
  }, true);

  var ITEM = "[role='menuitem'],[role='menuitemradio'],[role='menuitemcheckbox'],[role='option']";
  function sheetKind(sheet, trigger) {
    if (!sheet) return null;
    // Model selector: keep native bottom sheet as in builds prior to 3.0.6
    if (sheet.querySelector("[data-testid^='model-selector']")) return null;
    if (trigger && trigger.closest && trigger.closest("[data-testid='model-selector-trigger']")) return null;
    if (sheet.querySelector("[data-testid='model-quota-refreshing']")) return null;

    // Tabs / complex sheets (Settings, Workspace Drawer, Terminal, Files, History, Artifacts)
    if (sheet.querySelector("[role='tablist'], [role='tab']")) return null;

    // Any sheet that contains form inputs or large content
    if (sheet.querySelector("input:not([type='checkbox']):not([type='radio']),textarea,[contenteditable='true']")) return null;

    var txt = (sheet.textContent || "").trim();
    if (txt.length > 220) return null;
    if (/^(Настройки|Settings|Оформление|Appearance|Субагенты|Subagents|Файлы|Files|Терминал|Terminal|История|History|Артефакты|Artifacts|Изменённые|Modified)/i.test(txt)) return null;

    var btns = sheet.querySelectorAll("button, [role='menuitem'], [role='option']");
    if (btns.length === 0 || btns.length > 8) return null;

    if (sheet.querySelector("[role='option'],[role='menuitemradio']")) return "select";
    if (sheet.querySelector(ITEM)) return "menu";
    if (!sheet.style.height && btns.length <= 8 && txt.length < 220) return "menu";
    return null;
  }

  function lines(el) {
    return (el.innerText || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function layoutCompact() {
    var sheets = document.querySelectorAll("[data-testid='bottom-sheet']");
    var backs = document.querySelectorAll("[data-testid='bottom-sheet-backdrop']");
    var compactBacks = new Set();
    for (var i = 0; i < sheets.length; i++) {
      var sh = sheets[i];
      var kind = sheetKind(sh, sheetTriggers.get(sh) || lastTrigger);
      if (!kind) {
        sheetTriggers.delete(sh);
        if (sh.classList.contains("agy-compact-sheet")) {
          sh.classList.remove("agy-compact-sheet", "agy-tight-menu", "agy-model-menu");
          ["left", "top", "bottom", "width", "max-height", "transform"].forEach(function (k) { sh.style.removeProperty(k); });
        }
        continue;
      }
      if (!sheetTriggers.has(sh) && lastTrigger && lastTrigger.isConnected) sheetTriggers.set(sh, lastTrigger);
      sh.classList.add("agy-compact-sheet");
      sh.classList.toggle("agy-model-menu", kind === "model-menu");
      var layer = sh.parentElement;
      var z = layer ? parseInt(getComputedStyle(layer).zIndex, 10) : NaN;
      for (var k = 0; k < backs.length; k++) {
        if (parseInt(getComputedStyle(backs[k]).zIndex, 10) === z - 1) compactBacks.add(backs[k]);
      }
      var viewport = window.visualViewport;
      var vw = window.innerWidth, vh = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      var trigger = sheetTriggers.get(sh);
      var r = trigger && trigger.isConnected ? trigger.getBoundingClientRect() : null;
      var tw = r ? r.width : 0;
      var ls = lines(sh);
      var short = ls.length > 0 && ls.every(function (x) { return x.length <= 26; });
      var w;
      if (kind === "model-menu") w = Math.round(Math.min(340, vw - 20));
      else if (kind === "select" && tw >= 60) w = tw;
      else if (short) w = Math.round(Math.min(188, Math.max(tw, 124)));
      else w = 0;
      sh.classList.toggle("agy-tight-menu", short);
      if (w) sh.style.setProperty("width", Math.min(w, vw - 16) + "px", "important");
      else sh.style.removeProperty("width");
      var rect = sh.getBoundingClientRect();
      var ww = rect.width, h = rect.height;
      var left, placeAbove = false, top = 0, bottom = 0;
      if (r) {
        if (kind === "select") left = r.left;
        else left = (r.left + r.width / 2 > vw / 2) ? r.right - ww : r.left;
        var spaceBelow = vh - r.bottom - 8, spaceAbove = r.top - 8;
        placeAbove = spaceBelow < Math.min(h, 260) && spaceAbove > spaceBelow;
        if (placeAbove) bottom = Math.round(window.innerHeight - r.top + 6);
        else top = Math.round(r.bottom + 6);
      } else {
        left = (vw - ww) / 2; placeAbove = true; bottom = 16;
      }
      left = Math.max(8, Math.min(left, vw - ww - 8));
      sh.style.setProperty("left", Math.round(left) + "px", "important");
      if (placeAbove) {
        sh.style.setProperty("bottom", bottom + "px", "important");
        sh.style.setProperty("top", "auto", "important");
        sh.style.setProperty("max-height", Math.max(120, (r ? r.top : vh) - 14) + "px", "important");
      } else {
        sh.style.setProperty("top", top + "px", "important");
        sh.style.setProperty("bottom", "auto", "important");
        sh.style.setProperty("max-height", Math.max(120, vh - top - 8) + "px", "important");
      }
    }
    for (var b = 0; b < backs.length; b++) backs[b].classList.toggle("agy-compact-backdrop", compactBacks.has(backs[b]));
  }
  var compactRaf = 0;
  function scheduleCompact() { if (!compactRaf) compactRaf = requestAnimationFrame(function () { compactRaf = 0; layoutCompact(); }); }
  new MutationObserver(scheduleCompact).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", scheduleCompact, { passive: true });
  window.addEventListener("scroll", scheduleCompact, { passive: true });
  document.addEventListener("scroll", scheduleCompact, { passive: true, capture: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleCompact, { passive: true });
    window.visualViewport.addEventListener("scroll", scheduleCompact, { passive: true });
  }
  if (window.ResizeObserver) {
    var composerObserver = new ResizeObserver(scheduleCompact);
    function watchComposer() {
      var box = document.querySelector(BOX);
      if (box && !box.__agyCompactObserved) { box.__agyCompactObserved = true; composerObserver.observe(box); }
    }
    new MutationObserver(watchComposer).observe(document.documentElement, { childList: true, subtree: true });
    watchComposer();
  }

})();

/* ===================================================================== *
 * Provider-mode voice input (local, on-device) — drives the NATIVE mic button.
 *
 * In provider mode the core's own Gemini transcription is unavailable, so the
 * core streaming path can't work. Instead of a separate button, we hijack the
 * app's own mic button: when it is tapped in provider mode we intercept the tap
 * in the capture phase (React's handler never runs), drive Android's on-device
 * SpeechRecognizer (AgySTT bridge — no key, no cost) and insert the recognised
 * text straight into the chat editor. In standard mode we do nothing and the
 * button behaves exactly as before.
 *
 * The native mic button is `vA`: <button aria-label="Record voice memo"> (or
 * "Stop recording" while recording). We match it by that aria-label.
 * ===================================================================== */
(function () {
  // Prefer the offline streaming engine (Vosk: continuous, no beep, no reconnect)
  // when the model is bundled; otherwise fall back to the system SpeechRecognizer
  // (AgySTT: one phrase per tap). Both expose the same poll protocol, so the UI
  // below is identical for either.
  function voskReady() { try { return !!(window.AgyVosk && window.AgyVosk.available && window.AgyVosk.available()); } catch (e) { return false; } }
  var VOSK = voskReady() ? window.AgyVosk : null;   // offline streaming (preferred)
  var SYS = window.AgySTT || null;                   // system recognizer (fallback)
  if (!VOSK && !SYS) return;
  var BOX = "[data-testid='agent-input-box']";
  var MIC_SEL = 'button[aria-label="Record voice memo"],button[aria-label="Stop recording"],button[aria-label="Записать голосовое сообщение"],button[aria-label="Остановить запись"]';
  var listening = false, pollTimer = null, liveBtn = null, lastPartial = "", gotFinal = false;
  var curEng = null, sawEvent = false, wdTimer = 0;

  function providerMode() {
    try { 
      var s = window.__agyProviderSpecs && window.__agyProviderSpecs();
      return !!(s && s.length); 
    } catch (e) { 
      console.log("[AgyMic] providerMode error:", e);
      return false; 
    }
  }
  function editorEl() {
    var box = document.querySelector(BOX);
    if (!box) return null;
    return box.querySelector("[contenteditable='true']") || box.querySelector("textarea");
  }
  function placeCaret(ed) {
    // execCommand("insertText") needs a live selection INSIDE the editor;
    // tapping the mic button leaves the caret elsewhere, so put it at the end.
    try {
      var sel = window.getSelection();
      if (!sel) return;
      if (!sel.rangeCount || !ed.contains(sel.anchorNode)) {
        var r = document.createRange();
        r.selectNodeContents(ed); r.collapse(false);
        sel.removeAllRanges(); sel.addRange(r);
      }
    } catch (e) {}
  }
  function insertText(text) {
    var ed = editorEl();
    if (!ed) return false;
    try { ed.focus(); } catch (e) {}
    placeCaret(ed);
    var ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (e) {}
    if (!ok) {
      try {
        ed.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
        ed.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true }));
        ok = true;
      } catch (e2) {}
    }
    return ok;
  }
  function mark(on) {
    // Visual feedback on the native button (re-applied each poll tick, since React re-renders).
    var b = liveBtn && liveBtn.isConnected ? liveBtn : document.querySelector(MIC_SEL);
    if (!b) return;
    if (on) b.classList.add("agy-stt-live"); else b.classList.remove("agy-stt-live");
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } mark(false); }
  // If an utterance produced only interim results (no final arrived), commit the
  // last interim so speech is never silently lost.
  function flushPartial() {
    if (!gotFinal && lastPartial) { insertText(lastPartial.replace(/\s+$/, "") + " "); }
    lastPartial = ""; gotFinal = false;
  }
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(function () {
      if (listening) mark(true);
      var e; try { e = curEng ? curEng.pollStt() : ""; } catch (err) { e = ""; }
      if (!e) return;
      sawEvent = true;
      var tag = e.charAt(0);
      if (tag === "F") { var t = e.slice(2); if (t) { insertText(t.replace(/\s+$/, "") + " "); gotFinal = true; } lastPartial = ""; }
      else if (tag === "P") { lastPartial = e.slice(2); }       // remember newest interim
      else if (tag === "R" || tag === "B") { lastPartial = ""; gotFinal = false; } // new utterance
      else if (tag === "E") {
        // Offline engine failed (e.g. model/native-lib load) -> fall back to the
        // system recogniser instead of dying.
        if (curEng === VOSK && SYS && listening) { clearWd(); lastPartial = ""; gotFinal = false; engStart(SYS); }
        else { flushPartial(); listening = false; stopPoll(); }
      }
      else if (tag === "X") {
        // Vosk "X" only on real stop; but if it ended without ever producing a
        // result and we have a fallback, switch to it.
        if (curEng === VOSK && SYS && listening && !gotFinal && !lastPartial) { clearWd(); engStart(SYS); }
        else { flushPartial(); listening = false; stopPoll(); }
      }
    }, 180);
  }
  function dictCfg() { try { return (window.__agyDictationCfg && window.__agyDictationCfg()) || {}; } catch (e) { return {}; } }
  function uiLang() {
    // Dictation language: the explicit choice from the Dictation tab, else the
    // app's UI language (agy_i18n sets <html data-agy-language="ru|en">).
    var c = dictCfg();
    if (c.lang === "ru") return "ru-RU";
    if (c.lang === "en") return "en-US";
    var l;
    try { l = (document.documentElement.getAttribute("data-agy-language") || "ru").toLowerCase(); } catch (e) { l = "ru"; }
    return l.indexOf("en") === 0 ? "en-US" : "ru-RU";
  }
  function pickEngine() {
    // Engine from the Dictation tab: system / vosk / auto (Vosk if present).
    var c = dictCfg();
    if (c.engine === "system") return SYS || VOSK;
    if (c.engine === "vosk") return VOSK || SYS;
    return VOSK || SYS;
  }
  function clearWd() { if (wdTimer) { clearTimeout(wdTimer); wdTimer = 0; } }
  function engStart(eng) {
    curEng = eng; sawEvent = false;
    try { eng.ensurePermission && eng.ensurePermission(); } catch (e) {}
    var r = "ERR"; try { r = eng.start(uiLang()); } catch (e) { console.error("[AgyMic] eng.start error:", e); }
    console.log("[AgyMic] engStart engine:", (eng === VOSK ? "VOSK" : "SYS"), "lang:", uiLang(), "result:", r);
    return !(typeof r === "string" && r.indexOf("ERR") === 0);
  }
  function startListening(btn) {
    liveBtn = btn || null;
    var eng = pickEngine();
    if (!eng) { listening = false; return; }
    if (!engStart(eng)) { listening = false; return; } // e.g. permission just requested — tap again
    listening = true;
    var ed = editorEl(); if (ed) try { ed.focus(); } catch (e) {}
    mark(true); startPoll();
    // Watchdog: if the offline engine (Vosk) produces nothing (e.g. native lib
    // failed to load), fall back to the system recogniser so the mic still works.
    clearWd();
    if (eng === VOSK && SYS) {
      wdTimer = setTimeout(function () {
        if (listening && !sawEvent) {
          try { VOSK.stop && VOSK.stop(); } catch (e) {}
          lastPartial = ""; gotFinal = false;
          engStart(SYS);
        }
      }, 4500);
    }
  }
  function stopListening() {
    if (!listening) return;
    clearWd();
    try { if (curEng) curEng.stop(); } catch (e) {}
    listening = false;
    flushPartial();
    setTimeout(stopPoll, 600);
  }
  function toggle(btn) { if (listening) stopListening(); else startListening(btn); }

  // Capture-phase: intercept the native mic tap BEFORE React, in all chat modes.
  document.addEventListener("click", function (e) {
    if (!providerMode()) return; // Standard models use the original core transcription.
    if (dictCfg().enabled === false) return;   // voice input turned off in the Dictation tab
    var b = e.target && e.target.closest && e.target.closest(MIC_SEL);
    if (!b) return;
    var pm = providerMode();
    console.log("[AgyMic] Mic button tapped! providerMode:", pm, "dictCfg:", dictCfg());
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    toggle(b);
  }, true);

  // Hard stop: cancel recognition immediately and clear state. Used whenever the
  // app is backgrounded or the chat is left, so the recogniser never keeps
  // running (and beeping) off-screen.
  function hardStop() {
    clearWd();
    try { if (curEng) { if (curEng.cancel) curEng.cancel(); else curEng.stop(); } } catch (e) {}
    listening = false; lastPartial = ""; gotFinal = false; stopPoll();
  }
  // App backgrounded / tab hidden -> stop at once (this was the "keeps beeping in
  // the background" bug: we only stopped when leaving provider mode before).
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" && listening) hardStop();
  });
  window.addEventListener("pagehide", function () { if (listening) hardStop(); }, true);
  window.addEventListener("blur", function () { if (listening && document.visibilityState !== "visible") hardStop(); }, true);
  // Also stop if we are no longer in a chat.
  setInterval(function () {
    if (listening && (!providerMode() || !document.querySelector(BOX))) hardStop();
  }, 1200);

})();

/* Dismiss expired November 2026 third-party model notice (Claude 4.6 -> 5.5) */
(function () {
  var scheduled = false, seen = new WeakSet();
  function dismissNotice() {
    scheduled = false;
    if (!document.body) return;

    // Check all dialogs, modals, banners, alerts
    var candidates = document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [data-radix-portal], [data-state="open"], .fixed, .absolute'
    );
    for (var k = 0; k < candidates.length; k++) {
      var node = candidates[k];
      var text = (node.textContent || '').toLowerCase();
      var hasModelNotice = (
        (text.indexOf('opus 5.5') >= 0 || text.indexOf('sonnet 5.5') >= 0 || text.indexOf('claude') >= 0) &&
        (text.indexOf('2 ноября') >= 0 || text.indexOf('november 2') >= 0 || text.indexOf('2026') >= 0 || text.indexOf('сторонн') >= 0 || text.indexOf('third-party') >= 0)
      ) || (
        text.indexOf('доступ к сторонним моделям') >= 0 ||
        text.indexOf('third-party model access') >= 0
      );
      if (!hasModelNotice) continue;

      // Find the closest dialog container or portal
      var container = node.closest('[role="dialog"], [role="alertdialog"], [data-radix-portal]') || node;

      // Click close / ok / dismiss button
      var btns = container.querySelectorAll('button');
      var clicked = false;
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (seen.has(b)) continue;
        var lbl = (b.textContent || b.getAttribute('aria-label') || b.getAttribute('title') || '').trim().toLowerCase();
        if (/^(понятно|ok|ок|закрыть|close|dismiss|got it|хорошо|продолжить|continue)$/i.test(lbl) || b.querySelector('svg')) {
          seen.add(b);
          try { b.click(); } catch (e) {}
          clicked = true;
          break;
        }
      }
      if (!clicked && btns.length > 0 && !seen.has(btns[0])) {
        seen.add(btns[0]);
        try { btns[0].click(); } catch (e) {}
      }

      // Hide container immediately to prevent flashing
      container.style.display = 'none';
      container.setAttribute('aria-hidden', 'true');

      // Also hide accompanying backdrop
      var overlays = document.querySelectorAll('[data-radix-focus-guard], [data-aria-hidden="true"], .fixed.inset-0');
      for (var oi = 0; oi < overlays.length; oi++) {
        if (overlays[oi] !== container && overlays[oi].classList.contains('bg-black/50')) {
          overlays[oi].style.display = 'none';
        }
      }
    }
  }

  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(dismissNotice);
    }
  }

  function start() {
    new MutationObserver(function () { schedule(); }).observe(
      document.body,
      { childList: true, subtree: true }
    );
    schedule();
    // Re-check a few times after initial login
    setTimeout(schedule, 500);
    setTimeout(schedule, 1500);
    setTimeout(schedule, 3000);
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();

/* -------------------------------------------------------------------------- */
/* Agent Shade Reply & Chat Insertion Bridge (Release 3.0.6)                  */
/* -------------------------------------------------------------------------- */
(function() {
  var BOX = "[data-testid='agent-input-box']";

  function getEditor() {
    var box = document.querySelector(BOX);
    if (!box) return document.querySelector("[contenteditable='true']");
    return box.querySelector("[contenteditable='true']") || box.querySelector("textarea") || box;
  }

  function placeCaretAtEnd(ed) {
    try {
      var sel = window.getSelection();
      if (!sel) return;
      if (!sel.rangeCount || !ed.contains(sel.anchorNode)) {
        var r = document.createRange();
        r.selectNodeContents(ed);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    } catch (e) {}
  }

  window.__agyInsertIntoChat = function(text, send) {
    if (!text) return false;
    var ed = getEditor();
    if (!ed) return false;
    try { ed.focus(); } catch (e) {}
    placeCaretAtEnd(ed);

    var ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (e) {}
    if (!ok) {
      try {
        ed.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
        ed.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true }));
        ok = true;
      } catch (e2) {}
    }

    if (send) {
      setTimeout(function() {
        var box = document.querySelector(BOX);
        var sendBtn = box ? (box.querySelector("button[data-testid='send-button']") || box.querySelector("button[aria-label*='Send']")) : null;
        if (!sendBtn) sendBtn = document.querySelector("button[data-testid='send-button']") || document.querySelector("button[aria-label*='Send']");
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
        }
      }, 100);
    }
    return ok;
  };

  window.__agyOnShadeReply = function(payload) {
    if (!payload) return;
    var text = payload.text || "";
    var isApprove = (payload.type === "approve" || text === "__AGY_APPROVE__");

    if (isApprove) {
      var btns = Array.from(document.querySelectorAll("button"));
      var approveBtn = btns.find(function(b) {
        if (!b.offsetParent) return false;
        var tid = b.getAttribute("data-testid") || "";
        if (tid === "run-button" || tid === "accept-action-button" || tid === "approve-button") return true;
        var t = (b.textContent || "").trim().toLowerCase();
        return /^(разрешить|выполнить|продолжить|run|allow|always allow|accept)$/i.test(t);
      });
      if (approveBtn) {
        approveBtn.click();
        return;
      }
      text = "Разрешить / Продолжить";
    }

  /* -------------------------------------------------------------------------- */
  /* Subagents Chat Quick Launcher (Release 3.0.9)                              */
  /* -------------------------------------------------------------------------- */
  var CHAT_SUBAGENTS = [
    { id: "self", name: "self", title: "Текущий агент", desc: "Копия контекста и инструментов", icon: "🤖" },
    { id: "research", name: "research", title: "Исследователь", desc: "Поиск в кодовой базе и сети", icon: "🔍" },
    { id: "android-debugger", name: "android-debugger", title: "Android отладчик", desc: "Краши, logcat, JNI, jadx-agy", icon: "🐞" },
    { id: "code-reviewer", name: "code-reviewer", title: "Код-ревью", desc: "Поиск багов и утечек памяти", icon: "🔎" },
    { id: "docs-architect", name: "docs-architect", title: "Архитектор доков", desc: "README, CHANGELOG, Mermaid", icon: "📝" },
    { id: "security-auditor", name: "security-auditor", title: "Аудитор безопасности", desc: "OWASP Top 10, уязвимости", icon: "🛡️" },
    { id: "test-engineer", name: "test-engineer", title: "Инженер тестов", desc: "Модульные и интеграционные тесты", icon: "🧪" },
    { id: "image-generator", name: "image-generator", title: "Генератор картинок", desc: "Создание и редактирование изображений", icon: "🎨" }
  ];

  function getSubagentsCatalog() {
    var list = CHAT_SUBAGENTS.slice();
    try {
      var raw = localStorage.getItem("agyCustomSubagents");
      if (raw) {
        var extra = JSON.parse(raw);
        if (Array.isArray(extra)) {
          extra.forEach(function (x) {
            if (x && x.name && !list.some(function (i) { return i.name === x.name; })) {
              list.push({ id: x.name, name: x.name, title: x.title || x.name, desc: x.desc || "Кастомный субагент", icon: "⚡" });
            }
          });
        }
      }
    } catch (e) {}
    return list;
  }

  function closeSubagentsMenu() {
    var old = document.getElementById("agy-subagents-popover");
    if (old) old.remove();
  }

  function toggleSubagentsMenu(anchorBtn) {
    var existing = document.getElementById("agy-subagents-popover");
    if (existing) { existing.remove(); return; }

    var pop = document.createElement("div");
    pop.id = "agy-subagents-popover";
    pop.style.cssText = "position:fixed;z-index:9000;width:min(320px,calc(100vw - 20px));max-height:min(360px,calc(100vh - 120px));" +
      "background:var(--agy-glass-surface, rgba(26,26,30,.88));border:1px solid var(--agy-glass-border, rgba(255,255,255,.14));" +
      "border-radius:16px;box-shadow:var(--agy-glass-shadow, 0 16px 40px rgba(0,0,0,.4));" +
      "backdrop-filter:blur(22px) saturate(190%);-webkit-backdrop-filter:blur(22px) saturate(190%);" +
      "padding:10px;display:flex;flex-direction:column;gap:4px;overflow-y:auto;box-sizing:border-box";

    var r = anchorBtn.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var top = Math.max(10, r.top - 370);
    var left = Math.max(10, Math.min(r.left - 10, vw - 330));
    pop.style.top = top + "px";
    pop.style.left = left + "px";

    var hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:4px 6px 8px;" +
      "border-bottom:1px solid rgba(127,127,127,.18);margin-bottom:4px;font-size:13px;font-weight:600;color:var(--foreground,#eee)";
    hdr.innerHTML = "<span>🤖 Субагенты</span><span style='font-size:11px;font-weight:400;color:#888'>нажмите для вызова</span>";
    pop.appendChild(hdr);

    var list = getSubagentsCatalog();
    list.forEach(function (ag) {
      var item = document.createElement("button");
      item.type = "button";
      item.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;" +
        "border:0;border-radius:10px;background:transparent;cursor:pointer;text-align:left;font:inherit;" +
        "color:var(--foreground,#eee);transition:background .12s";
      item.onmouseenter = function () { item.style.background = "var(--agy-glass-item-hover, rgba(255,255,255,.08))"; };
      item.onmouseleave = function () { item.style.background = "transparent"; };

      var ic = document.createElement("span");
      ic.style.cssText = "font-size:16px;line-height:1;flex-shrink:0";
      ic.textContent = ag.icon;
      item.appendChild(ic);

      var txtWrap = document.createElement("div");
      txtWrap.style.cssText = "display:flex;flex-direction:column;gap:1px;min-width:0;flex:1";

      var tTitle = document.createElement("div");
      tTitle.style.cssText = "font-size:13px;font-weight:600;line-height:1.2;color:var(--foreground,#eee);display:flex;align-items:center;gap:6px";
      tTitle.textContent = ag.title;
      var tBadge = document.createElement("span");
      tBadge.style.cssText = "font-size:10.5px;font-weight:400;color:var(--primary,#0b84ff);font-family:ui-monospace,monospace";
      tBadge.textContent = "@" + ag.name;
      tTitle.appendChild(tBadge);
      txtWrap.appendChild(tTitle);

      var tDesc = document.createElement("div");
      tDesc.style.cssText = "font-size:11px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      tDesc.textContent = ag.desc;
      txtWrap.appendChild(tDesc);

      item.appendChild(txtWrap);

      item.onclick = function (ev) {
        ev.stopPropagation();
        closeSubagentsMenu();
        var prompt = "@" + ag.name + " ";
        window.__agyInsertIntoChat(prompt, false);
      };
      pop.appendChild(item);
    });

    document.body.appendChild(pop);
  }

  document.addEventListener("pointerdown", function (e) {
    var p = document.getElementById("agy-subagents-popover");
    if (!p) return;
    if (!p.contains(e.target) && !e.target.closest("#agy-subagent-btn")) {
      closeSubagentsMenu();
    }
  }, true);

  function attachSubagentButton() {
    if (document.getElementById("agy-subagent-btn")) return;
    var box = document.querySelector(BOX);
    if (!box) return;

    // Try multiple selectors for the '+' / attach button
    var anchor = box.querySelector(
      "[aria-label='Add context'],[aria-label='Добавить контекст']," +
      "[aria-label='Add attachment'],[aria-label='Прикрепить файл']," +
      "[aria-label='Attach'],[aria-label='Upload']," +
      "[data-testid='attach-button'],[data-testid='add-context-button']"
    );
    // Fall back to first visible button in the box
    if (!anchor) {
      var allBtns = box.querySelectorAll("button");
      for (var bi = 0; bi < allBtns.length; bi++) {
        var b = allBtns[bi];
        if (b.offsetHeight > 0 && b.offsetWidth > 0) { anchor = b; break; }
      }
    }
    if (!anchor || !anchor.parentElement) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "agy-subagent-btn";
    btn.title = "Субагенты (вызов в чате)";
    btn.setAttribute("aria-label", "Субагенты");
    btn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;" +
      "padding:0;border:0;border-radius:8px;background:transparent;cursor:pointer;font-size:16px;line-height:1;" +
      "color:var(--foreground,#aaa);transition:color .15s, transform .12s;flex-shrink:0";
    btn.innerHTML = "🤖";
    btn.onmouseenter = function () { btn.style.transform = "scale(1.08)"; };
    btn.onmouseleave = function () { btn.style.transform = ""; };
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleSubagentsMenu(btn);
    };
    anchor.parentElement.insertBefore(btn, anchor.nextSibling);
  }

  setInterval(attachSubagentButton, 800);
  // Also watch DOM for SPA route changes / re-renders
  (function () {
    var attached = false;
    new MutationObserver(function () { attachSubagentButton(); }).observe(
      document.body || document.documentElement,
      { childList: true, subtree: true }
    );
  })();
})();
