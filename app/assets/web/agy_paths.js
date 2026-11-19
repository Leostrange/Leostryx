/* Leostryx — кликабельные пути в чате.
 *
 * Агент часто пишет пути к файлам («/sdcard/Download/app.apk», ссылки вида
 * [app.apk](file:///storage/emulated/0/...), кнопки-пилюли с data-uri или пути в code-блоках).
 * По клику на такой путь открываем карточку:
 * - «Открыть папку» (DocumentsUI сразу в нужном каталоге через AgyTools.openPath);
 * - «Установить APK» (системный установщик через AgyTools.installApk);
 * - «Копировать».
 *
 * Поддерживает:
 * - элементы React с data-uri / data-file-uri (кнопки inline-pill, чипы, карточки);
 * - прямые ссылки <a> с href="file://..." или href="/..." (с декодированием %20 и пробелов);
 * - блоки кода <code> с путями (включая пробелы в именах каталогов);
 * - элементы с data-path / title;
 * - пути в тексте в кавычках, скобках, бэктиках или с расширениями (.apk, .zip и т.д.);
 * - симлинки (/sdcard/ -> /storage/emulated/0/);
 * - пути с пробелами («/storage/emulated/0/Leostryx Projects/...»);
 * - перехват событий на ранней фазе (capture) pointerdown, touchstart и click,
 *   а также прямой хук __agyPaths.handleFileUri для защиты от всплытия окна артефактов.
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

    // Извлечение пути из markdown-ссылок: [label](file://...) или [label](/storage/...)
    var md = p.match(/\((file:\/\/[^)]+|\/(?:sdcard|storage|data|root|mnt|system)[^)]+)\)/i);
    if (md) p = md[1];

    p = p.replace(/^[`"'«(\[{]+/, "").replace(/[`"'»)\].}]+$/, "");
    p = p.replace(TRAILING, "");
    // Удаляем zero-width / невидимые символы
    p = p.replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "");
    p = p.trim();

    if (/^file:\/\//i.test(p)) {
      p = p.replace(/^file:\/\/(?:localhost)?\/?/i, "/");
      p = p.split(/[?#]/)[0];
      try { p = decodeURIComponent(p); } catch (e) { try { p = decodeURI(p); } catch (e2) {} }
    } else {
      p = p.split(/[?#]/)[0];
    }

    if (/%[0-9a-fA-F]{2}/.test(p)) {
      try { p = decodeURIComponent(p); } catch (e) {}
    }

    p = p.replace(/^[`"'«(\[{]+/, "").replace(/[`"'»)\].}]+$/, "");
    p = p.replace(TRAILING, "");
    p = p.trim();

    // Гарантируем начальный слэш для известных корней файловой системы Android
    if (/^(?:sdcard|storage|data|root|mnt|system)\b/i.test(p)) {
      p = "/" + p;
    }
    return p;
  }

  function isApk(path) {
    if (!path) return false;
    var p = clean(path);
    return /\.apk($|[?#])/i.test(p);
  }

  function isLikelyPath(str) {
    if (!str) return false;
    return isApk(str);
  }

  function isInternalBrainArtifact(path) {
    if (!path) return false;
    var p = clean(path);
    // APK никогда не является внутренним артефактом IDE
    if (isApk(p)) return false;
    // Внутренние артефакты диалога (отчёты, планы) живут в brain/ и должны открываться в просмотрщике IDE
    if (/\/brain\/[^\/]+\/[^\/]+\.(?:md|json|txt|html)$/i.test(p) || /\/static\/artifacts\//i.test(p)) {
      return true;
    }
    return false;
  }

  function normalizeSymlink(path) {
    var p = clean(path);
    // /sdcard/ on Android is a symlink to /storage/emulated/0/
    if (/^\/sdcard\b/i.test(p)) {
      return "/storage/emulated/0" + p.slice(7);
    }
    return p;
  }

  function resolveAbsolutePath(path) {
    if (!path) return "";
    var p = clean(path);
    if (!p) return "";
    p = normalizeSymlink(p);
    // Если путь уже абсолютный к известному корню Android
    if (/^\/(?:storage|sdcard|data|root|mnt|system)\b/i.test(p)) {
      return p;
    }
    // Если путь относительный (например dist/signed/Leostryx-3.1.14-bypass.apk)
    var cleanRel = p.replace(/^\.?\//, "");
    var defaultRepo = "/storage/emulated/0/Leostryx Projects/Leostryx-repo";
    return defaultRepo + "/" + cleanRel;
  }

  function isAllowedChatTarget(target) {
    if (!target) return false;
    // 1. Исключаем саму всплывающую карточку
    if (target.closest && target.closest(".agy-path-sheet")) return false;

    // 2. Исключаем вкладки, кнопки закрытия вкладок, панель артефактов/файлов, навигацию и диалоги
    var excluded = target.closest && target.closest(
      '[role="tab"], [role="tablist"], [data-testid*="tab"], .tab, ' +
      'button[aria-label*="close" i], button[aria-label*="Close" i], button[title*="close" i], button[title*="Close" i], ' +
      '[data-aux-pane-open], [data-testid="aux-pane"], [class*="aux-pane"], [class*="auxPane"], [class*="artifact-view"], ' +
      'header, nav, [role="dialog"], [role="menu"]'
    );
    if (excluded) return false;

    // 3. Разрешаем строго внутри области сообщений чата
    var inChat = target.closest && target.closest(
      '[data-testid="conversation-view"], [data-turn-content], [data-testid="virtuoso-scroller"], ' +
      '[data-testid="virtuoso-item-list"], [data-testid="conversation-turn"], .conversation-view, [class*="conversation-view"]'
    );
    return !!inChat;
  }

  function extractFromElement(el) {
    if (!el) return "";
    var target = el.nodeType === 3 ? el.parentElement : el;
    if (!target || !isAllowedChatTarget(target)) return "";

    // Всплывающее окно предназначено ТОЛЬКО для APK-файлов (открытие папки с APK и установка APK).
    // Все остальные файлы (исходники, логи, тексты, markdown) должны открываться
    // во встроенном просмотрщике файлов / IDE, как обычно.

    // 1. Поиск элементов с data-uri / data-file-uri / data-path
    var pill = target.closest ? target.closest("[data-uri], [data-file-uri], [data-path]") : null;
    if (pill) {
      var val = pill.getAttribute("data-uri") ||
                pill.getAttribute("data-file-uri") ||
                pill.getAttribute("data-path") || "";
      var cVal = clean(val);
      if (cVal && isApk(cVal)) return cVal;
    }

    // 2. Ближайшая ссылка a[href]
    var a = target.closest ? target.closest("a[href]") : null;
    if (a) {
      var href = a.getAttribute("href") || "";
      var cHref = clean(href);
      if (cHref && isApk(cHref)) return cHref;
      var aText = clean(a.textContent || "");
      if (aText && isApk(aText)) return aText;
    }

    // 3. Ближайший элемент с title (часто хранит полный путь к файлу)
    var titled = target.closest ? target.closest("[title]") : null;
    if (titled) {
      var t = titled.getAttribute("title") || "";
      var cT = clean(t);
      if (cT && isApk(cT)) return cT;
    }

    // 4. Ближайший блок <code>
    var code = target.closest ? target.closest("code") : null;
    if (code) {
      var codeText = clean(code.textContent || "");
      if (codeText && isApk(codeText)) return codeText;
    }

    // 5. Ближайшая кнопка-пилюля или контекстный элемент
    var mention = target.closest ? target.closest(".inline-pill, .context-scope-mention, [data-quotable-inline]") : null;
    if (mention) {
      var mUri = mention.getAttribute("data-uri") || mention.getAttribute("data-file-uri") || mention.getAttribute("title") || "";
      var cmUri = clean(mUri);
      if (cmUri && isApk(cmUri)) return cmUri;
      var mText = clean(mention.textContent || "");
      if (mText && isApk(mText)) return mText;
    }

    return "";
  }

  function extractFromTextNode(node, offset) {
    if (!node || node.nodeType !== 3) return "";
    var text = node.nodeValue || "";
    if (!text || !/\.apk\b/i.test(text)) return "";

    // 1. Пути к APK в кавычках, скобках или бэктиках
    var quoteRe = /[`"'«(\[{](\/(?:sdcard|storage|data|root|mnt|system)\/[^`"'»)\].\n\r]+?\.apk)[`"'»)\].}]/gi;
    var m;
    while ((m = quoteRe.exec(text))) {
      var qStart = m.index, qEnd = m.index + m[0].length;
      if (offset >= qStart && offset <= qEnd) {
        return clean(m[1]);
      }
    }

    // 2. Любой абсолютный путь к APK
    var apkRe = /\/(?:sdcard|storage|data|root|mnt|system)\/[^\n\r"';<>()[\]{}*?]+?\.apk\b/gi;
    while ((m = apkRe.exec(text))) {
      var aStart = m.index, aEnd = m.index + m[0].length;
      if (offset >= aStart && offset <= aEnd) {
        return clean(m[0]);
      }
    }

    return "";
  }

  function pathAtPoint(x, y, target) {
    // Приоритет 1: проверка целевого элемента или элемента под координатами
    var el = target || (document.elementFromPoint ? document.elementFromPoint(x, y) : null);
    if (!isAllowedChatTarget(el)) return "";
    var fromEl = extractFromElement(el);
    if (fromEl) return fromEl;

    // Приоритет 2: каретка и текстовый узел под пальцем/курсором
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

    // Приоритет 3: fallback на elementFromPoint
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
    var normPath = resolveAbsolutePath(rawPath);
    flash(T("Открываю папку в проводнике…", "Opening folder in file manager…"));

    // 1. Попытка через нативный мост AgyTools
    var b = bridge("openPath");
    if (b) {
      try { b.openPath(normPath); } catch (_) {}
    }

    // 2. Резервный запуск DocumentsUI через termrun (am start) с автопоиском пути
    var pyCmd = [
      'python3 -c "',
      'import os, urllib.parse, subprocess;',
      'raw = \'\'\'' + normPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\'\'\';',
      'p = raw;',
      'if not os.path.exists(p):',
      '    for root in [\'/storage/emulated/0/Leostryx Projects/Leostryx-repo\', \'/storage/emulated/0/Documents\', \'/storage/emulated/0/Download\', \'/storage/emulated/0\']:',
      '        cand = os.path.join(root, raw.lstrip(\'/\'));',
      '        if os.path.exists(cand): p = cand; break;',
      'if os.path.isfile(p): p = os.path.dirname(p);',
      'p = os.path.realpath(p);',
      'rel = p;',
      'if rel.startswith(\'/storage/emulated/0/\'): rel = rel[20:];',
      'elif rel.startswith(\'/storage/emulated/0\'): rel = \'\';',
      'doc_id = \'primary:\' + rel if rel else \'primary:\';',
      'enc = urllib.parse.quote(doc_id);',
      'cmd = \'am start -a android.intent.action.VIEW -d \"content://com.android.externalstorage.documents/document/\' + enc + \'\" -t \"vnd.android.document/directory\" -f 0x10000000\';',
      'try: subprocess.run([\'rish\', \'-c\', cmd], timeout=5);',
      'except Exception: pass;',
      '"'
    ].join("");
    runTerm(pyCmd);

    closeSheet();
  }

  function installApk(path) {
    var rawPath = clean(path);
    var normPath = resolveAbsolutePath(rawPath);
    flash(T("Запуск установки APK…", "Launching APK install…"));

    // 1. Попытка через нативный мост AgyTools (системный PackageInstaller через FileProvider)
    var b = bridge("installApk");
    if (b) {
      try { b.installApk(normPath); } catch (_) {}
    }

    // 2. Запуск установки через Shizuku (rish am start PackageInstaller + pm install)
    var pyCmd = [
      'python3 -c "',
      'import os, urllib.parse, subprocess;',
      'raw = \'\'\'' + normPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\'\'\';',
      'p = raw;',
      'if not os.path.exists(p):',
      '    for root in [\'/storage/emulated/0/Leostryx Projects/Leostryx-repo\', \'/storage/emulated/0/Documents\', \'/storage/emulated/0/Download\', \'/storage/emulated/0\']:',
      '        cand = os.path.join(root, raw.lstrip(\'/\'));',
      '        if os.path.exists(cand): p = cand; break;',
      'p = os.path.realpath(p);',
      'if os.path.isfile(p):',
      '    enc = urllib.parse.quote(p);',
      '    cmd_ui = \'am start -a android.intent.action.VIEW -d \"content://com.agyru.t2.fileprovider\' + enc + \'\" -t \"application/vnd.android.package-archive\" -f 0x10000001\';',
      '    try: subprocess.run([\'rish\', \'-c\', cmd_ui], timeout=6);',
      '    except Exception: pass;',
      '    cmd_pm = \'pm install -r \"\' + p + \'\"\';',
      '    try: subprocess.run([\'rish\', \'-c\', cmd_pm], timeout=25);',
      '    except Exception: pass;',
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
    var resolved = resolveAbsolutePath(cleaned);
    var apk = isApk(cleaned) || isApk(resolved);
    var box = document.createElement("div");
    box.className = "agy-path-sheet";
    box.innerHTML =
      '<div class="agy-path-card">' +
        '<div class="agy-path-label">' + (apk ? T("APK-файл", "APK file") : T("Путь к файлу", "File path")) + '</div>' +
        '<div class="agy-path-value" data-path></div>' +
        '<div class="agy-path-row">' +
          '<button class="agy-path-btn" data-act="open">' + T("Открыть папку", "Open folder") + '</button>' +
          (apk ? '<button class="agy-path-btn agy-path-btn--primary" data-act="install">' +
            T("Установить APK", "Install APK") + '</button>' : '') +
          '<button class="agy-path-btn agy-path-btn--ghost" data-act="copy">' + T("Копировать", "Copy") + '</button>' +
          '<button class="agy-path-btn agy-path-btn--ghost" data-act="close">' + T("Закрыть", "Close") + '</button>' +
        '</div>' +
        (apk ? '<div class="agy-path-hint">' +
          T("Для установки система может запросить разрешение «Установка неизвестных приложений» для Leostryx.",
            "The system may ask for “Install unknown apps” permission for Leostryx.") + '</div>' : '') +
      '</div>';

    box.querySelector("[data-path]").textContent = resolved || cleaned;
    box.addEventListener("pointerdown", function (e) {
      if (e.target === box) closeSheet();
    });
    box.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("button[data-act]") : null;
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      var act = b.getAttribute("data-act");
      if (act === "open") openPath(resolved || cleaned);
      else if (act === "install") installApk(resolved || cleaned);
      else if (act === "copy") { flash(copy(resolved || cleaned) ? T("Путь скопирован.", "Path copied.") : T("Не удалось скопировать.", "Copy failed.")); }
      else closeSheet();
    }, true);

    document.body.appendChild(box);
    sheet = box;
    void box.offsetWidth;
    box.classList.add("in");
  }

  var lastClickAt = 0, lastMissLog = 0, pendingTap = 0;

  function tryIntercept(e, source) {
    if (sheet) return false;
    var target = e.target;
    if (!isAllowedChatTarget(target)) return false;

    var x = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    var y = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    var path = pathAtPoint(x, y, target);
    if (!path || !isApk(path)) return false;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }
    lastClickAt = Date.now();
    try { console.info("[agy_paths] intercepted APK via " + source + ": " + path); } catch (_) {}
    openSheet(path);
    return true;
  }

  // 1. Ранний перехват pointerdown в фазе capture (предотвращает срабатывание встроенных обработчиков IDE для APK)
  document.addEventListener("pointerdown", function (e) {
    if (e.button !== undefined && e.button > 0) return;
    tryIntercept(e, "pointerdown");
  }, true);

  // 2. Ранний перехват touchstart для мобильных тач-событий
  document.addEventListener("touchstart", function (e) {
    tryIntercept(e, "touchstart");
  }, { capture: true, passive: false });

  // 3. Основной перехват click в фазе capture
  document.addEventListener("click", function (e) {
    if (e.button !== undefined && e.button > 0) return;
    lastClickAt = Date.now();
    tryIntercept(e, "click");
  }, true);

  // 4. Резервный перехват pointerup на случай, если часть тач-контейнеров поглощает click
  document.addEventListener("pointerup", function (e) {
    if (sheet) return;
    if (e.button !== undefined && e.button > 0) return;
    if (e.clientX === undefined) return;
    var x = e.clientX, y = e.clientY, target = e.target;
    clearTimeout(pendingTap);
    pendingTap = setTimeout(function () {
      if (Date.now() - lastClickAt < 400) return;
      if (!isAllowedChatTarget(target)) return;
      var path = pathAtPoint(x, y, target);
      if (path && isApk(path)) {
        try { console.info("[agy_paths] open APK " + path + " via pointerup fallback"); } catch (_) {}
        openSheet(path);
      }
    }, 260);
  }, true);

  // Автоматическое закрытие ошибочно открытых вкладок с APK в панели артефактов/редактора
  function autoCloseApkTabs() {
    try {
      var tabs = document.querySelectorAll('[role="tab"], [data-testid*="tab"], .tab');
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        var text = (t.textContent || "") + " " + (t.getAttribute("title") || "");
        if (/\.apk\b/i.test(text)) {
          var closeBtn = t.querySelector('button[aria-label*="close" i], button[aria-label*="Close" i], [data-testid*="close"]');
          if (closeBtn) {
            try { console.info("[agy_paths] auto-closing stuck APK tab: " + text); } catch (_) {}
            closeBtn.click();
          }
        }
      }
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(autoCloseApkTabs, 300);
      setTimeout(autoCloseApkTabs, 1200);
    });
  } else {
    setTimeout(autoCloseApkTabs, 300);
    setTimeout(autoCloseApkTabs, 1200);
  }
  setInterval(autoCloseApkTabs, 2000);

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

  window.__agyPaths = {
    __installed: true,
    openSheet: openSheet,
    pathAtPoint: pathAtPoint,
    close: closeSheet,
    clean: clean,
    handleFileUri: function (uri) {
      if (!uri) return false;
      var p = clean(uri);
      if (!p) return false;
      // Всплывающее окно карточки предназначено ТОЛЬКО для APK-файлов (открытие папки и установка).
      // Любые другие файлы (исходники, логи, тексты, markdown) отдаём штатному
      // просмотрщику файлов IDE (openFile / openArtifact).
      if (isApk(p)) {
        try { console.info("[agy_paths] handleFileUri caught APK: " + p); } catch (_) {}
        openSheet(p);
        return true;
      }
      return false;
    }
  };
})();
