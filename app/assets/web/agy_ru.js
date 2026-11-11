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
   * Keyboard must open ONLY when user focuses directly on the chat editor,
   * after selecting Mentions/Actions/Browser, or when an attachment is added.
   * Tapping buttons (+, model selector, shield, mic, subagent) must NOT open keyboard. */
  var BOX = "[data-testid='agent-input-box']";
  var MENUISH = "[role='menu'],[role='menuitem'],[role='listbox'],[role='option'],[role='dialog']," +
                "[data-testid^='model-selector'],[aria-label='Add context'],[aria-label='Добавить контекст']," +
                "#agy-subagent-btn,.agy-shield-btn,[data-testid='model-selector-trigger']";
  var guard = { t: 0, block: false };

  function isEditor(el) {
    return !!(el && el.nodeType === 1 && el.closest && el.closest(BOX) &&
      (el.isContentEditable || el.tagName === "TEXTAREA"));
  }
  function menuOpen() {
    return !!document.querySelector("[role='menu'],[role='listbox'],[role='dialog'],[data-testid='model-selector-panel'],#agy-subagents-popover,#agy-shield");
  }
  document.addEventListener("pointerdown", function (e) {
    var t = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
    if (!t || !t.closest) return;
    var item = t.closest("[role='menuitem'],[role='option'],button");
    var label = item ? (item.textContent || "").trim() : "";
    var needsInput = /^(Mentions|Actions|Browser|Упоминания|Действия|Браузер)$/.test(label);
    var onEditor = isEditor(t) || !!t.closest(BOX + " [contenteditable='true']");
    var onControls = !!t.closest(MENUISH) || !!t.closest("#agy-subagent-btn,.agy-shield-btn,[data-testid='model-selector-trigger']");

    if (!onEditor && !needsInput && (onControls || menuOpen())) {
      guard = { t: Date.now(), block: true };
      var ae = document.activeElement;
      if (ae && isEditor(ae)) { try { ae.blur(); } catch (_) {} }
    } else if (onEditor || needsInput) {
      guard = { t: 0, block: false };
    }
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

  /* ---- Focus allowed again once an attachment is really added --- */
  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var added = list[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType === 1 && (n.matches("[data-testid='input-attachment']") || n.querySelector("[data-testid='input-attachment']"))) {
          guard = { t: 0, block: false };
          return;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* ---- Chat input repaint nudge (No scroll jiggle) ------------------------ */
  function nudge() {
    var box = document.querySelector(BOX);
    if (!box || !box.contains(document.activeElement)) return;
    compositingAncestors(document.activeElement || box).forEach(repaint);
  }
  function nudgeSeries() { [120, 350, 700].forEach(function (ms) { setTimeout(nudge, ms); }); }

  /* Whole-page repaint after returning from a system window */
  var OVERLAY_SEL = '[role="menu"],[role="listbox"],[role="dialog"],[data-select-popup],' +
    '[data-radix-popper-content-wrapper],.typeahead-popover,#typeahead-menu,' +
    '[data-testid="bottom-sheet"],[class*="animate-slideIn"],[class*="animate-in"],.z-\\[6000\\]';
  function repaintOverlays() {
    var nodes;
    try { nodes = document.querySelectorAll(OVERLAY_SEL); } catch (e) { return; }
    for (var i = 0; i < nodes.length; i++) repaint(nodes[i]);
  }
  function nudgePage() {
    repaintOverlays();
    var ae = document.activeElement;
    if (ae && ae !== document.body) compositingAncestors(ae).forEach(repaint);
  }
  var pageTimers = [];
  function nudgePageSeries() {
    pageTimers.forEach(clearTimeout);
    pageTimers = [0, 150, 400, 800].map(function (ms) { return setTimeout(nudgePage, ms); });
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
      var aria = (bs[i].getAttribute("aria-label") || "").trim();
      if (!/(^|\s)(Назад|Back)$/i.test(t) && !/^(Назад|Back)$/i.test(aria)) continue;
      var r = bs[i].getBoundingClientRect();
      if (r.width > 0 && r.left >= -1 && r.left < window.innerWidth / 2) found = bs[i];
    }
    return found;
  }

  function isSettingsOpen() {
    var sheets = document.querySelectorAll("[data-testid='bottom-sheet']");
    for (var i = 0; i < sheets.length; i++) {
      var s = sheets[i];
      if (s.querySelector("[data-testid='bottom-sheet-grabber']")) return true;
      if (s.querySelector("[data-testid^='settings-nav-item'],[data-testid^='settings-']")) return true;
      if (s.querySelector(".agy-tools, .agy-tools-host, .agy-providers, .agy-providers-host, .agy-cust, .agy-customizations-host, .agy-mcp, .agy-mcp-host, .agy-backup, .agy-backup-host, .agy-about, .agy-about-host, .agy-feedback-host, .agy-dictation-host")) return true;
      var tx = s.innerText || "";
      if (/(Настройки|Settings|Общие|General|Оформление|Appearance|Инструменты|Tools|Резервное|Backup|Провайдер|Provider|Пользователь|Customiz|MCP|Диктовка|Dictation|О приложении|About)/i.test(tx)) return true;
    }
    return false;
  }

  /* Called by the native Back handler (button and edge swipe). Returns true
   * when the page handled Back: an open menu/list closes first, otherwise the
   * open settings page goes one level back, or history goes back one page. */
  window.__agyBack = function () {
    if (window.__agyShieldClose && window.__agyShieldClose()) return true;
    var subPop = document.getElementById("agy-subagents-popover");
    if (subPop) { subPop.remove(); return true; }

    var open = document.querySelector("[data-select-popup],[class*='animate-slideIn'],#typeahead-menu");
    if (open) {
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
      return true;
    }
    var btn = sheetBack();
    if (btn) { btn.click(); return true; }

    // Root settings screen: an edge swipe must NOT close settings (ТЗ 9.4);
    // they close only with their own control or a swipe down.
    if (isSettingsOpen()) {
      return true;
    }

    // Normal navigation: navigate back one page in history
    if (window.history && window.history.length > 1) {
      window.history.back();
      return true;
    }
    return false;
  };

  /* ---- Edge Swipe Back Gesture (left and right edges) --------------------
   * Swiping from left edge (x < 35px) to right, or right edge (x > window.innerWidth - 35px)
   * to left triggers navigation back one page. Settings sheet ignores edge swipe. */
  (function () {
    var touchStartX = 0, touchStartY = 0, isEdge = false;
    window.addEventListener("touchstart", function (e) {
      if (e.touches && e.touches.length === 1) {
        var x = e.touches[0].clientX;
        var y = e.touches[0].clientY;
        touchStartX = x;
        touchStartY = y;
        isEdge = (x <= 35 || x >= window.innerWidth - 35);
      } else {
        isEdge = false;
      }
    }, { passive: true });

    window.addEventListener("touchend", function (e) {
      if (!isEdge) return;
      isEdge = false;
      if (!e.changedTouches || e.changedTouches.length === 0) return;
      var dx = e.changedTouches[0].clientX - touchStartX;
      var dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
      if (Math.abs(dx) > 55 && dy < 70) {
        if ((touchStartX <= 35 && dx > 0) || (touchStartX >= window.innerWidth - 35 && dx < 0)) {
          window.__agyBack();
        }
      }
    }, { passive: true });
  })();

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
    // Bottom sheet grabber indicates a modal full-sheet (Settings, Drawers), never a compact popover
    if (sheet.querySelector("[data-testid='bottom-sheet-grabber']")) return null;
    if (sheet.querySelector("[data-testid^='settings-nav-item'],[data-testid^='settings-']")) return null;
    if (sheet.querySelector(".agy-tools, .agy-tools-host, .agy-providers, .agy-providers-host, .agy-cust, .agy-customizations-host, .agy-mcp, .agy-mcp-host, .agy-backup, .agy-backup-host, .agy-about, .agy-about-host, .agy-feedback-host, .agy-dictation-host")) return null;
    if (trigger && trigger.closest && (trigger.closest("[data-testid^='settings-nav-item']") || trigger.closest("[data-testid='model-selector-trigger']"))) return null;

    // Model selector: keep native bottom sheet as in builds prior to 3.0.6
    if (sheet.querySelector("[data-testid^='model-selector'],[data-testid='model-selector-panel'],[data-testid='model-quota-refreshing']")) return null;

    // Tabs / complex sheets (Settings, Workspace Drawer, Terminal, Files, History, Artifacts)
    if (sheet.querySelector("[role='tablist'], [role='tab']")) return null;

    // Any sheet that contains form inputs
    if (sheet.querySelector("input:not([type='checkbox']):not([type='radio']),textarea,[contenteditable='true']")) return null;

    var txt = (sheet.textContent || "").trim();
    if (txt.length > 220) return null;
    if (/^(Настройки|Settings|Оформление|Appearance|Провайдер|Поставщик|Provider|Пользователь|Customiz|MCP|Инструмент|Tools|Резерв|Backup|О приложении|About|Субагенты|Subagents|Файлы|Files|Терминал|Terminal|История|History|Артефакты|Artifacts|Изменённые|Modified)/i.test(txt)) return null;

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
        if (sh.querySelector("[data-testid^='model-selector'],[data-testid='model-selector-panel'],[data-testid='model-quota-refreshing']")) {
          var mLayer = sh.parentElement;
          var mz = mLayer ? parseInt(getComputedStyle(mLayer).zIndex, 10) : NaN;
          for (var mk = 0; mk < backs.length; mk++) {
            if (backs.length === 1 || parseInt(getComputedStyle(backs[mk]).zIndex, 10) === mz - 1) compactBacks.add(backs[mk]);
          }
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

    // Check only small standalone notice dialogs/alerts, never bottom-sheets or settings pages
    var candidates = document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [data-radix-portal]'
    );
    for (var k = 0; k < candidates.length; k++) {
      var node = candidates[k];
      if (
        node.getAttribute('data-testid') === 'bottom-sheet' ||
        node.closest('[data-testid="bottom-sheet"], [data-testid="agent-input-box"], .agy-providers, .agy-cust, .agy-mcp, .agy-tools, .agy-backup, .agy-about') ||
        node.querySelector('[data-testid="bottom-sheet"], [data-testid^="settings-"], .agy-providers, .agy-cust, .agy-mcp, .agy-tools, .agy-backup, .agy-about')
      ) {
        continue;
      }
      var text = (node.textContent || '').toLowerCase();
      if (text.length > 450) continue;
      var hasModelNotice =
        (text.indexOf('opus 5.5') >= 0 || text.indexOf('sonnet 5.5') >= 0) &&
        (text.indexOf('2 ноября') >= 0 || text.indexOf('november 2') >= 0);
      if (!hasModelNotice) continue;

      var container = node;

      // Click close / ok / dismiss button
      var btns = container.querySelectorAll('button');
      var clicked = false;
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (seen.has(b)) continue;
        var lbl = (b.textContent || b.getAttribute('aria-label') || b.getAttribute('title') || '').trim().toLowerCase();
        if (/^(понятно|ok|ок|закрыть|close|dismiss|got it|хорошо|продолжить|continue)$/i.test(lbl)) {
          seen.add(b);
          try { b.click(); } catch (e) {}
          clicked = true;
          break;
        }
      }
      if (!clicked && btns.length === 1 && !seen.has(btns[0])) {
        seen.add(btns[0]);
        try { btns[0].click(); } catch (e) {}
      }

      // Hide container immediately to prevent flashing
      container.style.display = 'none';
      container.setAttribute('aria-hidden', 'true');
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

  var lastShadeTime = 0;
  window.__agyOnShadeReply = function(payload) {
    if (!payload) return;
    if (payload.time && payload.time === lastShadeTime) return;
    if (payload.time) lastShadeTime = payload.time;
    var text = payload.text || "";
    var isApprove = (payload.type === "approve" || text === "__AGY_APPROVE__");

    if (isApprove) {
      var btns = Array.from(document.querySelectorAll("button"));
      var approveBtn = btns.find(function(b) {
        if (!b.offsetParent) return false;
        var tid = b.getAttribute("data-testid") || "";
        if (tid === "run-button" || tid === "accept-action-button" || tid === "approve-button") return true;
        var t = (b.textContent || "").trim().toLowerCase();
        return /^(разрешить|разрешить один раз|разрешить всегда|выполнить|продолжить|run|allow|allow once|always allow|accept)$/i.test(t);
      });
      if (approveBtn) {
        approveBtn.click();
      }
      return;
    }

    if (text && text !== "__AGY_APPROVE__") {
      window.__agyInsertIntoChat(text, true);
    }
  };

  /* Poll notifications replies from Android shade */
  setInterval(function () {
    try {
      if (window.AgyShade && typeof window.AgyShade.pollReplies === "function") {
        var res = window.AgyShade.pollReplies();
        if (res && res !== "[]") {
          var arr = JSON.parse(res);
          for (var i = 0; i < arr.length; i++) {
            window.__agyOnShadeReply(arr[i]);
          }
        }
      }
    } catch (e) {}
  }, 1200);

  /* Watch for approval prompts and agent responses to post Android notifications */
  var lastNotifiedApproval = 0;
  var lastApprovalSnippet = "";
  var lastNotifiedMessage = "";
  var lastProgressNotify = 0;
  var progressNotifiedThisRun = false;
  var progressRunningLast = false;
  // Shield "Не спрашивать" (auto) mode = terminal auto-execution EAGER (3)
  // in the agyShieldOv mirror. In that mode no approval notification should
  // ever be sent — at most a passive progress message.
  function shieldAutoMode() {
    try {
      var o = JSON.parse(window.localStorage.getItem("agyShieldOv") || "{}");
      return !!o && o.term === 3;
    } catch (e) { return false; }
  }
  function checkAgentActivity() {
    try {
      if (!window.AgyShade || typeof window.AgyShade.notify !== "function") return;
      if (!document.hidden && window.AgyShade.cancel) {
        try { window.AgyShade.cancel("agent_progress"); window.AgyShade.cancel("agent_approval"); } catch (e) {}
      }

      // 1. Approval requests: buttons exist only when the Shield requires confirmation.
      //    Notify (with action) ONLY when the app is minimized; in foreground the user sees it.
      var btns = document.hidden ? Array.from(document.querySelectorAll("button")) : [];
      var approveBtn = null;
      if (!shieldAutoMode()) {
        approveBtn = btns.find(function (b) {
          if (b.disabled) return false;
          if (b.closest("[data-testid='bottom-sheet'],.agy-providers,.agy-cust,.agy-mcp,.agy-tools")) return false;
          var t = (b.textContent || "").trim().toLowerCase();
          return /^(разрешить|разрешить один раз|разрешить всегда|allow|allow once|always allow)$/i.test(t) ||
            b.getAttribute("data-testid") === "run-button" || b.getAttribute("data-testid") === "accept-action-button";
        });
      }

      if (approveBtn) {
        var now = Date.now();
        var container = approveBtn.closest("[class*='step'],[class*='card'],[role='dialog']") || approveBtn.parentElement;
        var textSnippet = container ? (container.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160) : "Требуется подтверждение действия агента";
        // Deduplicate by snippet: the same pending approval notifies ONCE.
        // Re-allow the same snippet only after 5 minutes (user dismissed it).
        if (textSnippet !== lastApprovalSnippet || (now - lastNotifiedApproval > 300000)) {
          lastApprovalSnippet = textSnippet;
          lastNotifiedApproval = now;
          window.AgyShade.notify("agent_approval", "Leostryx — Требуется подтверждение", textSnippet, true);
        }
      } else if (document.hidden) {
        // Approval resolved (or none pending): drop stale approval / progress notifications.
        if (lastApprovalSnippet) {
          lastApprovalSnippet = "";
          try { if (window.AgyShade.cancel) window.AgyShade.cancel("agent_approval"); } catch (e) {}
        }
        try { if (window.AgyShade.cancel) window.AgyShade.cancel("agent_progress"); } catch (e) {}
      }

      // 2. Detect Agent Response completion (when user is in background)
      if (document.hidden) {
        var responses = document.querySelectorAll("[data-testid='agent-turn'],[class*='agent-message'],[data-testid='cascade-step']");
        if (responses.length > 0) {
          var lastResp = responses[responses.length - 1];
          var respText = (lastResp.textContent || "").replace(/\s+/g, " ").trim();
          if (respText && respText !== lastNotifiedMessage && respText.length > 10) {
            var isStreaming = !!lastResp.querySelector("[class*='animate-spin'],.spinner,[data-testid='spinner']");
            if (!isStreaming) {
              lastNotifiedMessage = respText;
              var snippet = respText.slice(0, 150) + (respText.length > 150 ? "..." : "");
              window.AgyShade.notify("agent_reply", "Leostryx — Ответ агента", snippet, false);
            }
          }
        }
      }
    } catch (e) {}
  }
  setInterval(checkAgentActivity, 2000);
  var SVG_ICONS = {
    bot: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    bug: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>',
    code: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    doc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>',
    shield: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>',
    test: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/></svg>',
    image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
    cpu: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>'
  };

  var CHAT_SUBAGENTS = [
    { id: "self", name: "self", title: "Текущий агент", desc: "Копия контекста и инструментов", svg: SVG_ICONS.bot },
    { id: "research", name: "research", title: "Исследователь", desc: "Поиск в кодовой базе и сети", svg: SVG_ICONS.search },
    { id: "android-debugger", name: "android-debugger", title: "Android отладчик", desc: "Краши, logcat, JNI, jadx-agy", svg: SVG_ICONS.bug },
    { id: "code-reviewer", name: "code-reviewer", title: "Код-ревью", desc: "Поиск багов и утечек памяти", svg: SVG_ICONS.code },
    { id: "docs-architect", name: "docs-architect", title: "Архитектор доков", desc: "README, CHANGELOG, Mermaid", svg: SVG_ICONS.doc },
    { id: "security-auditor", name: "security-auditor", title: "Аудитор безопасности", desc: "OWASP Top 10, уязвимости", svg: SVG_ICONS.shield },
    { id: "test-engineer", name: "test-engineer", title: "Инженер тестов", desc: "Модульные и интеграционные тесты", svg: SVG_ICONS.test },
    { id: "image-generator", name: "image-generator", title: "Генератор картинок", desc: "Создание и редактирование изображений", svg: SVG_ICONS.image }
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
              list.push({ id: x.name, name: x.name, title: x.title || x.name, desc: x.desc || "Кастомный субагент", svg: SVG_ICONS.cpu });
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

  function placeSubagentsMenu(pop) {
    if (!pop) return;
    var box = document.querySelector(BOX);
    if (!box) { closeSubagentsMenu(); return; }
    var r = box.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var w = Math.min(r.width, vw - 8);
    var left = Math.max(4, Math.min(r.left, vw - w - 4));
    pop.style.setProperty("width", Math.round(w) + "px", "important");
    pop.style.setProperty("max-width", Math.round(w) + "px", "important");
    pop.style.setProperty("min-width", Math.round(w) + "px", "important");
    pop.style.setProperty("left", Math.round(left) + "px", "important");
    pop.style.setProperty("right", "auto", "important");
    pop.style.setProperty("top", "auto", "important");
    pop.style.setProperty("bottom", Math.round(window.innerHeight - r.top + 6) + "px", "important");
    pop.style.setProperty("max-height", Math.max(160, Math.round(r.top - 64)) + "px", "important");
  }

  function toggleSubagentsMenu(anchorBtn) {
    var existing = document.getElementById("agy-subagents-popover");
    if (existing) { existing.remove(); return; }

    var pop = document.createElement("div");
    pop.id = "agy-subagents-popover";
    pop.setAttribute("data-agy-no-translate", "");
    pop.style.cssText = "position:fixed;z-index:9000;" +
      "background:var(--agy-glass-surface, rgba(26,26,30,.88));border:1px solid var(--agy-glass-border, rgba(255,255,255,.14));" +
      "border-radius:16px;box-shadow:var(--agy-glass-shadow, 0 16px 40px rgba(0,0,0,.4));" +
      "backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);" +
      "padding:10px;display:flex;flex-direction:column;gap:4px;overflow-y:auto;box-sizing:border-box";

    var hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:4px 6px 8px;" +
      "border-bottom:1px solid rgba(127,127,127,.18);margin-bottom:4px;font-size:13px;font-weight:600;color:var(--foreground,#eee)";
    hdr.innerHTML = "<span style='display:inline-flex;align-items:center;gap:6px'>" + SVG_ICONS.bot + "<span>Субагенты</span></span>" +
      "<span style='font-size:11px;font-weight:400;color:#888'>нажмите для вызова</span>";
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
      ic.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;color:var(--primary,#0b84ff);flex-shrink:0";
      ic.innerHTML = ag.svg || SVG_ICONS.bot;
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
    placeSubagentsMenu(pop);
  }

  window.addEventListener("resize", function () {
    var p = document.getElementById("agy-subagents-popover");
    if (p) placeSubagentsMenu(p);
  });

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

    var plus = box.querySelector("[aria-label='Add context'],[aria-label='Добавить контекст'],[data-testid='attach-button']");
    var footer = plus ? plus.closest("[class*='input-footer']") : box.querySelector("[class*='input-footer']");
    if (!footer) return;
    var group = footer.lastElementChild;
    if (!group) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "agy-subagent-btn";
    btn.title = "Субагенты (вызов в чате)";
    btn.setAttribute("aria-label", "Субагенты");
    btn.className = "agy-subagent-btn p-1.5 rounded-full text-secondary-foreground hover:bg-secondary cursor-pointer";
    btn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;" +
      "padding:0;border:0;border-radius:9999px;background:transparent;cursor:pointer;line-height:1;" +
      "color:var(--secondary-foreground, currentColor);flex-shrink:0;transition:background-color .15s, color .15s";
    btn.innerHTML = SVG_ICONS.bot;
    btn.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      guard = { t: Date.now(), block: true };
      var ae = document.activeElement;
      if (ae && isEditor(ae)) { try { ae.blur(); } catch (_) {} }
    });
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleSubagentsMenu(btn);
    });

    var shield = group.querySelector(".agy-shield-btn");
    if (shield) group.insertBefore(btn, shield);
    else group.insertBefore(btn, group.firstChild);
  }

  setInterval(attachSubagentButton, 600);

  try { sessionStorage.removeItem("agy_composer_draft"); } catch (e) {}
})();
