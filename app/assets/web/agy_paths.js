/* Leostryx — кликабельные пути в чате.
 *
 * Агент часто пишет пути к файлам («/sdcard/Download/app.apk», ссылки вида
 * file:///storage/emulated/0/... или пути в code-блоках). По клику на такой путь
 * открываем карточку:
 * - «Открыть папку» (DocumentsUI сразу в нужном каталоге через AgyTools.openPath);
 * - «Установить APK» (системный установщик через AgyTools.installApk);
 * - «Копировать».
 *
 * Поддерживает:
 * - прямые ссылки <a> с href="file://..." или href="/..." (с декодированием %20 и пробелов);
 * - блоки кода <code> с путями (включая пробелы в именах каталогов);
 * - элементы с data-path;
 * - пути в тексте в кавычках, скобках, бэктиках или с расширениями (.apk, .zip и т.д.);
 * - симлинки (/sdcard/ -> /storage/emulated/0/);
 * - пути с пробелами («/storage/emulated/0/Leostryx Projects/...»).
 */
(function () {
  "use strict";
  if (window.__agyPaths && window.__agyPaths.__installed) return;

  var T = function (ru, en) {
    try {
      if (window.__agyI18n && typeof window.__agyI18n.getLanguage === "function") {
        return window.__agyI18n.getLanguage() === "ru" ? ru : en;
      }
    } catch (e) {}
    return ru;
  };

  var TRAILING = /[,.;:!?]+$/;
  var KNOWN_EXTS = "\\.(?:apk|idsig|zip|tar|gz|txt|log|sh|py|md|json|dex|so|png|jpg|jpeg|webp|mp4|mov|mkv|webm|aar|jar)\\b";

  var CSS = [
    ".agy-path-sheet{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;",
    "justify-content:center;background:color-mix(in srgb,#000 48%,transparent);",
    "opacity:0;transition:opacity .16s ease;",
    "--agy-card:var(--card,#191919);--agy-fg:var(--foreground,#cccccc);",
    "--agy-border:var(--card-border,var(--border,#222222));",
    "--agy-accent:var(--primary,#007acc);--agy-accent-fg:var(--primary-foreground,#ffffff);",
    "--agy-muted:var(--muted,#151515);--agy-muted-fg:var(--muted-foreground,#6e6e6e);",
    "--agy-secondary:var(--secondary,#272727)}",
    ".agy-path-sheet.in{opacity:1}.agy-path-sheet.out{opacity:0}",
    ".agy-path-card{width:min(680px,94vw);margin:0 0 84px;padding:16px;border-radius:16px;",
    "background:var(--agy-card);color:var(--agy-fg);border:1px solid var(--agy-border);",
    "box-shadow:0 24px 70px rgba(0,0,0,.42);font-family:var(--font-family,system-ui,-apple-system,sans-serif)}",
    ".agy-path-label{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--agy-accent);margin-bottom:8px}",
    ".agy-path-value{font-family:'JetBrains Mono','SFMono-Regular',ui-monospace,Menlo,Consolas,monospace;",
    "font-size:12.5px;line-height:1.45;word-break:break-all;color:var(--agy-fg);background:var(--agy-muted);",
    "border:1px solid var(--agy-border);border-radius:10px;padding:10px 12px;margin-bottom:12px}",
    ".agy-path-row{display:flex;flex-wrap:wrap;gap:8px}",
    ".agy-path-btn{flex:1 1 140px;padding:10px 14px;border-radius:10px;cursor:pointer;font:inherit;",
    "font-size:13px;border:1px solid var(--agy-border);background:var(--agy-secondary);color:var(--agy-fg);",
    "transition:filter .15s ease,background .15s ease}",
    ".agy-path-btn:hover{filter:brightness(1.08)}",
    ".agy-path-btn--primary{background:var(--agy-accent);color:var(--agy-accent-fg);border-color:transparent}",
    ".agy-path-btn--ghost{flex:0 1 auto;background:transparent;color:var(--agy-muted-fg)}",
    ".agy-path-hint{margin-top:9px;font-size:11px;line-height:1.45;color:var(--agy-muted-fg)}",
    ".agy-path-flash{position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:2147483001;",
    "max-width:86vw;padding:10px 14px;border-radius:12px;background:var(--card,#191919);",
    "color:var(--foreground,#cccccc);border:1px solid var(--card-border,var(--border,#222222));",
    "box-shadow:0 12px 40px rgba(0,0,0,.4);font-family:var(--font-family,system-ui,sans-serif);font-size:13px;line-height:1.4}"
  ].join("");

  var sheet = null;

  function styleOnce() {
    if (document.getElementById("agy-path-style")) return;
    var st = document.createElement("style");
    st.id = "agy-path-style";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function clean(path) {
    if (!path) return "";
    var p = String(path).trim();
    if (/^file:\/\//i.test(p)) {
      p = p.replace(/^file:\/\//i, "");
      try { p = decodeURIComponent(p); } catch (e) { try { p = decodeURI(p); } catch (e2) {} }
    }
    if (/%[0-9a-fA-F]{2}/.test(p)) {
      try { p = decodeURIComponent(p); } catch (e) {}
    }
    p = p.replace(/^[`"'«(\[{]+/, "").replace(/[`"'»)\].}]+$/, "");
    p = p.replace(TRAILING, "");
    // markdown-рендерер иногда вставляет zero-width/невидимые символы внутри
    // пути — они ломают и регулярки, и открытие файла
    p = p.replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "");
    return p.trim();
  }

  function isApk(path) {
    return /\.apk$/i.test(clean(path));
  }

  function isLikelyPath(str) {
    if (!str) return false;
    var s = clean(str);
    return /^\/(?:sdcard|storage|data|root|mnt|system)\b/i.test(s);
  }

  function normalizeSymlink(path) {
    var p = clean(path);
    // /sdcard/ on Android is a symlink to /storage/emulated/0/
    if (/^\/sdcard\b/i.test(p)) {
      return "/storage/emulated/0" + p.slice(7);
    }
    return p;
  }

  function extractFromElement(el) {
    if (!el) return "";
    // Check direct data-path
    if (el.hasAttribute && el.hasAttribute("data-path")) {
      var dp = el.getAttribute("data-path");
      if (isLikelyPath(dp)) return clean(dp);
    }
    // Check closest a[href]
    var a = el.closest ? el.closest("a[href]") : null;
    if (a) {
      var href = a.getAttribute("href") || "";
      if (/^file:\/\//i.test(href)) {
        return clean(href);
      }
      if (isLikelyPath(href)) {
        return clean(href);
      }
      var aText = (a.textContent || "").trim();
      if (isLikelyPath(aText)) {
        return clean(aText);
      }
    }
    // Check closest code
    var code = el.closest ? el.closest("code") : null;
    if (code) {
      var codeText = (code.textContent || "").trim();
      if (isLikelyPath(codeText)) {
        return clean(codeText);
      }
    }
    return "";
  }

  function extractFromTextNode(node, offset) {
    if (!node || node.nodeType !== 3) return "";
    var text = node.nodeValue || "";
    if (!text) return "";

    // 1. Check if surrounded by quotes, backticks or brackets
    var quoteRe = /[`"'«(\[{](\/(?:sdcard|storage|data|root|mnt|system)\/[^`"'»)\].\n\r]+)[`"'»)\].}]/gi;
    var m;
    while ((m = quoteRe.exec(text))) {
      var qStart = m.index, qEnd = m.index + m[0].length;
      if (offset >= qStart && offset <= qEnd) {
        return clean(m[1]);
      }
    }

    // 2. Check if it has a known file extension (allowing spaces in path!)
    var extRe = new RegExp("\\/(?:sdcard|storage|data|root|mnt|system)\\/[^\\n\\r\"';<>()[\\\\\\]{}*?]+?" + KNOWN_EXTS, "gi");
    while ((m = extRe.exec(text))) {
      var eStart = m.index, eEnd = m.index + m[0].length;
      if (offset >= eStart && offset <= eEnd) {
        return clean(m[0]);
      }
    }

    // 3. Fallback: space-delimited path
    var wordRe = /\/(?:sdcard|storage|data|root|mnt|system)\/[^\s\n\r"';<>()[\]{}]+/gi;
    while ((m = wordRe.exec(text))) {
      var wStart = m.index, wEnd = m.index + m[0].length;
      if (offset >= wStart && offset <= wEnd) {
        return clean(m[0]);
      }
    }

    return "";
  }

  function pathAtPoint(x, y, target) {
    // Priority 1: Check target element or element at point for <a>, <code>, [data-path]
    var el = target || (document.elementFromPoint ? document.elementFromPoint(x, y) : null);
    var fromEl = extractFromElement(el);
    if (fromEl) return fromEl;

    // Priority 2: Use caret position to inspect the text node
    var node = null, offset = 0;
    try {
      if (document.caretRangeFromPoint) {
        var r = document.caretRangeFromPoint(x, y);
        if (r) { node = r.startContainer; offset = r.startOffset; }
      } else if (document.caretPositionFromPoint) {
        var p = document.caretPositionFromPoint(x, y);
        if (p) { node = p.offsetNode; offset = p.offset; }
      }
    } catch (e) {}

    if (node) {
      if (node.nodeType === 3) {
        // Also check if text node's parent is an <a> or <code>
        if (node.parentElement) {
          var pEl = extractFromElement(node.parentElement);
          if (pEl) return pEl;
        }
        var fromText = extractFromTextNode(node, offset);
        if (fromText) return fromText;
      } else if (node.nodeType === 1) {
        var fromNode = extractFromElement(node);
        if (fromNode) return fromNode;
      }
    }

    // Priority 3: Fallback check on document.elementFromPoint
    if (document.elementFromPoint) {
      var el2 = document.elementFromPoint(x, y);
      if (el2 && el2 !== el) {
        var fromEl2 = extractFromElement(el2);
        if (fromEl2) return fromEl2;
      }
    }

    return "";
  }

  function copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function closeSheet() {
    if (!sheet) return;
    var s = sheet;
    sheet = null;
    s.classList.add("out");
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 180);
  }

  function bridge(name) {
    try { return window.AgyTools && typeof window.AgyTools[name] === "function" ? window.AgyTools : null; } catch (e) { return null; }
  }

  function runTerm(cmd) {
    try {
      if (window.AgyTools && typeof window.AgyTools.start === "function") {
        window.AgyTools.start("termrun", btoa(cmd));
        return true;
      }
    } catch (_) {}
    return false;
  }

  function openPath(path) {
    var rawPath = clean(path);
    var normPath = normalizeSymlink(rawPath);
    flash(T("Открываю папку в проводнике…", "Opening folder in file manager…"));

    // 1. Попытка через нативный мост AgyTools
    var b = bridge("openPath");
    if (b) {
      try { b.openPath(normPath); } catch (_) { try { b.openPath(rawPath); } catch (__) {} }
    }

    // 2. Гарантированный запуск DocumentsUI через termrun (am start)
    var pyCmd = [
      'python3 -c "',
      'import os, urllib.parse, subprocess;',
      'p = \'\'\'' + normPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\'\'\';',
      'if os.path.isfile(p): p = os.path.dirname(p);',
      'p = os.path.realpath(p);',
      'rel = p;',
      'if rel.startswith(\'/storage/emulated/0/\'): rel = rel[20:];',
      'elif rel.startswith(\'/storage/emulated/0\'): rel = \'\';',
      'doc_id = \'primary:\' + rel if rel else \'primary:\';',
      'enc = urllib.parse.quote(doc_id);',
      'cmd = \'am start -a android.intent.action.VIEW -d \"content://com.android.externalstorage.documents/document/\' + enc + \'\" -t \"vnd.android.document/directory\" -f 0x10000000\';',
      'try: subprocess.run([\'rish\', \'-c\', cmd], timeout=5);',
      'except Exception: subprocess.run([\'/system/bin/am\', \'start\', \'-a\', \'android.intent.action.VIEW\', \'-d\', \'content://com.android.externalstorage.documents/document/\' + enc, \'-t\', \'vnd.android.document/directory\', \'-f\', \'0x10000000\'], timeout=5);',
      '"'
    ].join("");
    runTerm(pyCmd);

    closeSheet();
  }

  function installApk(path) {
    var rawPath = clean(path);
    var normPath = normalizeSymlink(rawPath);
    flash(T("Запуск установки APK…", "Launching APK install…"));

    // 1. Попытка через нативный мост AgyTools
    var b = bridge("installApk");
    if (b) {
      try { b.installApk(normPath); } catch (_) { try { b.installApk(rawPath); } catch (__) {} }
    }

    // 2. Открытие папки с APK в системном проводнике DocumentsUI
    var pyCmd = [
      'python3 -c "',
      'import os, urllib.parse, subprocess;',
      'p = \'\'\'' + normPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\'\'\';',
      'folder = os.path.dirname(p) if os.path.isfile(p) else p;',
      'folder = os.path.realpath(folder);',
      'rel = folder;',
      'if rel.startswith(\'/storage/emulated/0/\'): rel = rel[20:];',
      'elif rel.startswith(\'/storage/emulated/0\'): rel = \'\';',
      'doc_id = \'primary:\' + rel if rel else \'primary:\';',
      'enc = urllib.parse.quote(doc_id);',
      'cmd = \'am start -a android.intent.action.VIEW -d \"content://com.android.externalstorage.documents/document/\' + enc + \'\" -t \"vnd.android.document/directory\" -f 0x10000000\';',
      'try: subprocess.run([\'rish\', \'-c\', cmd], timeout=5);',
      'except Exception: subprocess.run([\'/system/bin/am\', \'start\', \'-a\', \'android.intent.action.VIEW\', \'-d\', \'content://com.android.externalstorage.documents/document/\' + enc, \'-t\', \'vnd.android.document/directory\', \'-f\', \'0x10000000\'], timeout=5);',
      '"'
    ].join("");
    runTerm(pyCmd);

    closeSheet();
  }

  function flash(text) {
    styleOnce();
    var el = document.createElement("div");
    el.className = "agy-path-flash";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
  }

  function openSheet(path) {
    styleOnce();
    closeSheet();
    var cleaned = clean(path);
    var apk = isApk(cleaned);
    var box = document.createElement("div");
    box.className = "agy-path-sheet";
    box.innerHTML =
      '<div class="agy-path-card">' +
        '<div class="agy-path-label">' + (apk ? T("APK-файл", "APK file") : T("Путь", "Path")) + '</div>' +
        '<div class="agy-path-value" data-path></div>' +
        '<div class="agy-path-row">' +
          '<button class="agy-path-btn" data-act="open">' + T("Открыть папку", "Open folder") + '</button>' +
          (apk ? '<button class="agy-path-btn agy-path-btn--primary" data-act="install">' +
            T("Установить APK", "Install APK") + '</button>' : '') +
          '<button class="agy-path-btn agy-path-btn--ghost" data-act="copy">' + T("Копировать", "Copy") + '</button>' +
          '<button class="agy-path-btn agy-path-btn--ghost" data-act="close">' + T("Закрыть", "Close") + '</button>' +
        '</div>' +
        (apk ? '<div class="agy-path-hint">' +
          T("Для установки система попросит разрешение «Установка неизвестных приложений» для Leostryx.",
            "The system will ask for “Install unknown apps” permission for Leostryx.") + '</div>' : '') +
      '</div>';

    box.querySelector("[data-path]").textContent = cleaned;
    box.addEventListener("pointerdown", function (e) {
      if (e.target === box) closeSheet();
    });
    box.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("button[data-act]") : null;
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      var act = b.getAttribute("data-act");
      if (act === "open") openPath(cleaned);
      else if (act === "install") installApk(cleaned);
      else if (act === "copy") { flash(copy(cleaned) ? T("Путь скопирован.", "Path copied.") : T("Не удалось скопировать.", "Copy failed.")); }
      else closeSheet();
    }, true);

    document.body.appendChild(box);
    sheet = box;
    void box.offsetWidth;
    box.classList.add("in");
  }

  var lastClickAt = 0, lastMissLog = 0, pendingTap = 0;

  function handleTap(x, y, target, source) {
    if (sheet) return false;
    var path = pathAtPoint(x, y, target);
    if (!path) {
      if (Date.now() - lastMissLog > 1500) {
        lastMissLog = Date.now();
        try { console.info("[agy_paths] no path at " + source + " (" + x + "," + y + ")"); } catch (e) {}
      }
      return false;
    }
    try { console.info("[agy_paths] open " + path + " via " + source); } catch (e) {}
    openSheet(path);
    return true;
  }

  document.addEventListener("click", function (e) {
    lastClickAt = Date.now();
    var x = e.clientX || 0;
    var y = e.clientY || 0;
    if (!handleTap(x, y, e.target, "click")) return;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }
  }, true);

  // Перехватываем pointerdown для ссылок на APK, чтобы внутренний просмотрщик файлов IDE
  // не успевал перехватить нажатие и открыть превью вместо нашего модального окна установки.
  document.addEventListener("pointerdown", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (a) {
      var href = a.getAttribute("href") || "";
      if (isApk(href) || isApk(a.textContent)) {
        var path = extractFromElement(a);
        if (path) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
          lastClickAt = Date.now();
          openSheet(path);
        }
      }
    }
  }, true);

  // Часть интерфейса гасит click на pointerdown/pointerup (тач-навигация), из-за
  // чего ссылки «не нажимаются». Поэтому ловим ещё и pointerup: если в течение
  // 260 мс click так и не пришёл — обрабатываем тап сами.
  document.addEventListener("pointerup", function (e) {
    if (sheet) return;
    if (e.button !== undefined && e.button > 0) return;
    if (e.clientX === undefined) return;
    var x = e.clientX, y = e.clientY, target = e.target;
    clearTimeout(pendingTap);
    pendingTap = setTimeout(function () {
      if (Date.now() - lastClickAt < 400) return;
      handleTap(x, y, target, "pointerup");
    }, 260);
  }, true);

  // Диагностика в logcat (AGY_JS): видно, загрузился ли модуль и что он видит.
  try { console.info("[agy_paths] installed, hash=" + (location.hash || "")); } catch (e) {}

  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && sheet) closeSheet();
  }, true);

  // Системный Back (натив зовёт __agyBack) должен закрывать карточку первым.
  var prevBack = window.__agyBack;
  window.__agyBack = function () {
    if (sheet) { closeSheet(); return true; }
    return typeof prevBack === "function" ? prevBack.apply(this, arguments) : false;
  };

  window.__agyPaths = { __installed: true, openSheet: openSheet, pathAtPoint: pathAtPoint, close: closeSheet, clean: clean };
})();
