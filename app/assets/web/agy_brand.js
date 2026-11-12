/* Leostryx — Settings › Appearance › Кастомизация (Leostryx branding).
 * Renders into the Appearance screen (main.js `eLb` calls
 * window.__agyBrandMount(el)). Two controls:
 *   1. Logo pack picker — 4 packs (Owl, Lynx, LSX, Angular X), default 02_lynx.
 *      Swaps the in-app header logo, login-screen logo, splash logo, and
 *      Android home-screen launcher icon immediately without rebuilding the APK.
 *   2. Accent colour table — sets --primary / --primary-foreground live with
 *      priority over theme presets, and re-tints all in-app logos & buttons. */
(function () {
  "use strict";
  if (window.__agyBrandReady) return;
  window.__agyBrandReady = true;

  var STORE_KEY = "agyBrandConfig";

  function ru() {
    try { return window.__agyI18n ? window.__agyI18n.getLanguage() === "ru" : true; }
    catch (e) { return true; }
  }
  function T(r, e) { return ru() ? r : e; }

  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }

  /* ------------------------------------------------------------- catalog */
  var PACKS = [
    { id: "01_owl",       ru: "Сова",           en: "Owl" },
    { id: "02_lynx",      ru: "Рысь",           en: "Lynx" },
    { id: "03_lsx",       ru: "Монограмма LSX", en: "LSX monogram" },
    { id: "04_angular_x", ru: "Угловой X",      en: "Angular X" }
  ];
  var DEFAULT_PACK = "02_lynx";

  var COLORS = [
    { hex: "#0b84ff", ru: "Синий",      en: "Blue" },
    { hex: "#3b82f6", ru: "Индиго",     en: "Indigo" },
    { hex: "#8b5cf6", ru: "Фиолетовый", en: "Violet" },
    { hex: "#ec4899", ru: "Розовый",    en: "Pink" },
    { hex: "#ef4444", ru: "Красный",    en: "Red" },
    { hex: "#f97316", ru: "Оранжевый",  en: "Orange" },
    { hex: "#f59e0b", ru: "Янтарный",   en: "Amber" },
    { hex: "#10b981", ru: "Изумрудный", en: "Emerald" },
    { hex: "#14b8a6", ru: "Бирюзовый",  en: "Teal" },
    { hex: "#64748b", ru: "Серый",      en: "Slate" },
    { hex: "#0ea5e9", ru: "Небесный",   en: "Sky" },
    { hex: "#a3e635", ru: "Лаймовый",   en: "Lime" }
  ];
  var DEFAULT_COLOR = "#0b84ff";

  var FONTS = [
    {
      id: "system",
      ru: "Системный (По умолчанию)",
      en: "System (Default)",
      desc: "Roboto / MiSans / UI",
      family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'MiSans', sans-serif",
      license: "System",
      isMono: false
    },
    {
      id: "inter",
      ru: "Inter",
      en: "Inter",
      desc: "Современный UI-гротеск",
      family: "'Inter', system-ui, -apple-system, sans-serif",
      license: "SIL OFL 1.1",
      isMono: false
    },
    {
      id: "jetbrains_mono",
      ru: "JetBrains Mono",
      en: "JetBrains Mono",
      desc: "Шрифт разработчиков",
      family: "'JetBrains Mono', ui-monospace, monospace",
      license: "SIL OFL 1.1",
      isMono: true
    },
    {
      id: "fira_code",
      ru: "Fira Code",
      en: "Fira Code",
      desc: "Моноширинный с лигатурами",
      family: "'Fira Code', ui-monospace, monospace",
      license: "SIL OFL 1.1",
      isMono: true
    },
    {
      id: "roboto",
      ru: "Roboto",
      en: "Roboto",
      desc: "Классический Android",
      family: "'Roboto', 'RobotoFlex', sans-serif",
      license: "Apache 2.0",
      isMono: false
    },
    {
      id: "geist",
      ru: "Geist",
      en: "Geist",
      desc: "Чистый технический",
      family: "'Geist', sans-serif",
      license: "SIL OFL 1.1",
      isMono: false
    },
    {
      id: "montserrat",
      ru: "Montserrat",
      en: "Montserrat",
      desc: "Геометрический гротеск",
      family: "'Montserrat', sans-serif",
      license: "SIL OFL 1.1",
      isMono: false
    },
    {
      id: "ubuntu",
      ru: "Ubuntu",
      en: "Ubuntu",
      desc: "Гуманистический гротеск",
      family: "'Ubuntu', sans-serif",
      license: "Ubuntu Font Licence",
      isMono: false
    },
    {
      id: "pt_root_ui",
      ru: "PT Root UI",
      en: "PT Root UI",
      desc: "Создан для кириллицы",
      family: "'PT Root UI', 'PT Sans', sans-serif",
      license: "SIL OFL 1.1",
      isMono: false
    }
  ];
  var DEFAULT_FONT = "system";

  /* -------------------------------------------------------------- state */
  function loadCfg() {
    var raw = store(STORE_KEY);
    var savedFont = store("agyFontFamily");
    var cfg = { pack: DEFAULT_PACK, color: DEFAULT_COLOR, recolorLogo: true, font: savedFont || DEFAULT_FONT };
    if (raw) {
      try {
        var p = JSON.parse(raw);
        if (p && typeof p === "object") {
          if (p.pack) cfg.pack = p.pack;
          if (p.color) cfg.color = p.color;
          if (p.recolorLogo !== undefined) cfg.recolorLogo = p.recolorLogo !== false;
          if (p.font) cfg.font = p.font;
        }
      } catch (e) {}
    }
    if (savedFont && FONTS.some(function (f) { return f.id === savedFont; })) cfg.font = savedFont;
    if (!PACKS.some(function (p) { return p.id === cfg.pack; })) cfg.pack = DEFAULT_PACK;
    if (!COLORS.some(function (c) { return c.hex.toLowerCase() === String(cfg.color).toLowerCase(); })) cfg.color = DEFAULT_COLOR;
    if (!FONTS.some(function (f) { return f.id === cfg.font; })) cfg.font = DEFAULT_FONT;
    return cfg;
  }
  var cfg = loadCfg();

  function saveCfg() {
    store(STORE_KEY, JSON.stringify(cfg));
    store("agyFontFamily", cfg.font);
  }

  window.__agyGetBrandAccent = function () {
    return cfg && cfg.color ? cfg.color : DEFAULT_COLOR;
  };

  /* -------------------------------------------------------- font apply */
  function applyFont(fontId) {
    var f = FONTS.filter(function (x) { return x.id === fontId; })[0] || FONTS[0];
    var root = document.documentElement;
    var body = document.body;
    if (!root) return;

    var styleEl = document.getElementById("agy-font-override-css");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "agy-font-override-css";
      (document.head || root).appendChild(styleEl);
    }

    if (f.id === "system") {
      styleEl.textContent = "";
      root.style.removeProperty("--default-font-family");
      root.style.removeProperty("--font-sans");
      root.style.removeProperty("--vscode-font-family");
      if (body) {
        body.style.removeProperty("font-family");
      }
    } else {
      var cssRule =
        ":root, html, body, button, input, select, textarea, .font-sans {\n" +
        "  --default-font-family: " + f.family + " !important;\n" +
        "  --font-sans: " + f.family + " !important;\n" +
        "  --vscode-font-family: " + f.family + " !important;\n" +
        "  font-family: " + f.family + " !important;\n" +
        "}\n";
      if (f.isMono) {
        cssRule +=
          "code, pre, .font-mono {\n" +
          "  --default-mono-font-family: " + f.family + " !important;\n" +
          "  --font-mono: " + f.family + " !important;\n" +
          "  --editor-font-family: " + f.family + " !important;\n" +
          "  font-family: " + f.family + " !important;\n" +
          "}\n";
      }
      styleEl.textContent = cssRule;
    }
  }
  window.__agyApplyFont = applyFont;

  /* ------------------------------------------------------- colour apply */
  function hexToRgb(hex) {
    var h = String(hex).replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return { r: 11, g: 132, b: 255 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function luminance(hex) {
    var c = hexToRgb(hex);
    function lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  }
  function contrastText(hex) { return luminance(hex) > 0.45 ? "#111111" : "#ffffff"; }

  function applyColor(hex) {
    /* Акцент бренда красит ТОЛЬКО лого/иконки/сплэшскрин (при включённой
       опции recolorLogo). Глобальные токены темы (--primary/--accent и пр.)
       не трогаем, чтобы не перекрашивать кнопки, поля и прочий UI. */
    var root = document.documentElement;
    if (!root || !root.style) return;

    try {
      var st = document.getElementById("agy-brand-accent-css");
      if (cfg.recolorLogo) {
        if (!st) {
          st = document.createElement("style");
          st.id = "agy-brand-accent-css";
          (document.head || root).appendChild(st);
        }
        var css =
          ".google-symbols,\n" +
          "[data-testid=\"app-icon-new-conversation-button\"] svg,\n" +
          "[data-testid=\"sidebar-header-logo\"] svg,\n" +
          ".floating-icon,\n" +
          ".animated-logo-container svg,\n" +
          "button[aria-selected=\"true\"] svg,\n" +
          "button[data-state=\"active\"] svg,\n" +
          "[role=\"tab\"][aria-selected=\"true\"] svg,\n" +
          "nav button svg,\n" +
          "header button svg {\n" +
          "  color: " + hex + " !important;\n" +
          "}\n" +
          "[data-testid=\"app-icon-new-conversation-button\"] svg path,\n" +
          ".floating-icon path {\n" +
          "  fill: " + hex + " !important;\n" +
          "}\n";
        st.textContent = css;
      } else if (st) {
        st.textContent = "";
      }
    } catch (e) {}
  }

  /* --------------------------------------------------------- logo apply */
  function bridge() {
    return window.AgyTools && typeof window.AgyTools.start === "function" ? window.AgyTools : null;
  }
  function applyLogo(packId, after) {
    var b = bridge();
    if (!b) { if (after) after(false); return; }
    var arg = packId + "@" + String(cfg.color || "").replace("#", "") + "@" + (cfg.recolorLogo ? "1" : "0");
    var id = b.start("brand", arg);
    if (!id || /^ERR/.test(String(id))) { if (after) after(false); return; }
    var tries = 0;
    (function tick() {
      tries++;
      var r = {};
      try { r = JSON.parse(b.read(id) || "{}"); } catch (e) {}
      if (r.rc !== undefined && r.rc !== "") {
        if (after) after(String(r.rc) === "0");
        return;
      }
      if (tries > 240) { if (after) after(false); return; }
      setTimeout(tick, 250);
    })();
  }

  function persistForBuild() {
    try {
      var b = bridge();
      if (!b) return;
      b.start("brand", cfg.pack + "@" + String(cfg.color || "").replace("#", "") + "@" + (cfg.recolorLogo ? "1" : "0"));
    } catch (e) {}
  }

  /* --------------------------------------------------------------- UI */
  function makeCard() {
    var c = document.createElement("div");
    c.style.cssText = "background:rgba(255,255,255,.025);border:1px solid rgba(127,127,127,.18);" +
      "border-radius:16px;padding:16px;margin-bottom:12px";
    return c;
  }
  function makeTitle(text) {
    var t = document.createElement("div");
    t.style.cssText = "font-size:16px;font-weight:600;color:var(--foreground,#eee);margin-bottom:4px";
    t.textContent = text;
    return t;
  }
  function makeNote(text) {
    var n = document.createElement("div");
    n.style.cssText = "font-size:12.5px;line-height:1.5;color:#999;margin-bottom:12px";
    n.textContent = text;
    return n;
  }

  function render(el) {
    el.innerHTML = "";

    /* ── header ── */
    var header = document.createElement("div");
    header.style.cssText = "font-size:18px;font-weight:600;color:var(--foreground,#eee);margin-bottom:12px";
    header.textContent = T("Кастомизация", "Customization");
    el.appendChild(header);

    /* ── Card 1: logo pack ── */
    var c1 = makeCard();
    c1.appendChild(makeTitle(T("Логотип", "Logo")));
    c1.appendChild(makeNote(T(
      "Сова, рысь, монограмма LSX или угловой X. Сразу меняет логотип в шапке, на экране входа, сплэш-скрине и иконку приложения на рабочем столе.",
      "Owl, lynx, LSX monogram or angular X. Immediately updates the header logo, login screen, splash screen and home-screen app icon."
    )));

    var grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px";

    PACKS.forEach(function (p) {
      var selected = cfg.pack === p.id;
      var cell = document.createElement("button");
      cell.type = "button";
      cell.style.cssText = "position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;" +
        "padding:12px 8px;border-radius:14px;cursor:pointer;font:inherit;text-align:center;" +
        "border:1px solid " + (selected ? cfg.color : "rgba(127,127,127,.22)") + ";" +
        "background:" + (selected ? "color-mix(in srgb, " + cfg.color + " 14%, transparent)" : "rgba(255,255,255,.02)") + ";" +
        "transition:border-color .15s, background .15s";

      var iconWrap = document.createElement("div");
      iconWrap.style.cssText = "width:56px;height:56px;display:flex;align-items:center;justify-content:center;pointer-events:none";
      if (typeof window.__agyBrandSvgMarkup === "function") {
        iconWrap.innerHTML = window.__agyBrandSvgMarkup(p.id, cfg.recolorLogo ? cfg.color : null, 52);
      } else {
        var img = document.createElement("img");
        img.src = "./brand/" + p.id + "/ic_launcher_logo.png";
        img.alt = "";
        img.loading = "lazy";
        img.style.cssText = "width:56px;height:56px;object-fit:contain;pointer-events:none";
        iconWrap.appendChild(img);
      }
      cell.appendChild(iconWrap);

      var lbl = document.createElement("div");
      lbl.style.cssText = "font-size:12.5px;line-height:1.3;color:var(--foreground,#ddd)";
      lbl.textContent = T(p.ru, p.en);
      cell.appendChild(lbl);

      if (selected) {
        var tick = document.createElement("span");
        tick.style.cssText = "position:absolute;top:6px;right:8px;font-size:11px;color:" + cfg.color;
        tick.textContent = "✓";
        cell.appendChild(tick);
      }

      cell.onclick = function () {
        if (cfg.pack === p.id) return;
        cfg.pack = p.id;
        saveCfg();
        try {
          window.dispatchEvent(new CustomEvent("agy:brand-changed", { detail: { pack: p.id, color: cfg.color, recolorLogo: cfg.recolorLogo } }));
        } catch (e) {}
        render(el);
        try {
          if (window.AgyTools && typeof window.AgyTools.switchIconPack === "function") {
            var spec = (cfg.recolorLogo && cfg.color)
              ? (p.id + "_" + String(cfg.color).replace("#", "").toLowerCase())
              : p.id;
            window.AgyTools.switchIconPack(spec);
          }
        } catch (e) {}
        applyLogo(cfg.pack, function (ok) {
          var s = document.getElementById("agy-brand-status");
          if (!s) return;
          s.textContent = ok
            ? T("Логотип и иконка рабочего стола обновлены.",
                "Logo and home-screen icon updated.")
            : T("Логотип обновлён.",
                "Logo updated.");
          s.style.color = "#10b981";
        });
      };
      grid.appendChild(cell);
    });
    c1.appendChild(grid);
    el.appendChild(c1);

    /* ── Card 2: accent colour ── */
    var c2 = makeCard();
    c2.appendChild(makeTitle(T("Цвет логотипа и иконки", "Logo and icon colour")));
    c2.appendChild(makeNote(T(
      "Акцентный цвет: окрашивает только логотип, значки и сплэшскрин приложения. Цвета интерфейса не меняет.",
      "Accent colour: tints only the app logo, icons and splash screen. Does not affect interface colours."
    )));

    /* Switch: Recolor logos & icons */
    var toggleRow = document.createElement("label");
    toggleRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;" +
      "background:rgba(255,255,255,.03);border:1px solid rgba(127,127,127,.18);border-radius:12px;margin-bottom:14px;cursor:pointer";

    var toggleInfo = document.createElement("div");
    toggleInfo.style.cssText = "display:flex;flex-direction:column;gap:2px";
    var toggleTitle = document.createElement("div");
    toggleTitle.style.cssText = "font-size:13.5px;font-weight:600;color:var(--foreground,#eee)";
    toggleTitle.textContent = T("Перекрашивать логотипы и значки", "Recolor logos and icons");
    var toggleDesc = document.createElement("div");
    toggleDesc.style.cssText = "font-size:11.5px;color:#999;line-height:1.35";
    toggleDesc.textContent = T(
      "Если включено — логотипы, значки и иконка на рабочем столе окрашиваются в выбранный цвет акцента. Если выключено — сохраняют оригинальные авторские цвета.",
      "When on — logos, icons and the home-screen icon are tinted with the selected accent colour. When off — they retain original designer colours."
    );
    toggleInfo.appendChild(toggleTitle);
    toggleInfo.appendChild(toggleDesc);
    toggleRow.appendChild(toggleInfo);

    var toggleSwitch = document.createElement("input");
    toggleSwitch.type = "checkbox";
    toggleSwitch.checked = !!cfg.recolorLogo;
    toggleSwitch.style.cssText = "width:20px;height:20px;accent-color:" + cfg.color + ";cursor:pointer;flex-shrink:0";
    toggleSwitch.onchange = function () {
      cfg.recolorLogo = toggleSwitch.checked;
      saveCfg();
      applyColor(cfg.color);
      try {
        window.dispatchEvent(new CustomEvent("agy:brand-changed", { detail: { pack: cfg.pack, color: cfg.color, recolorLogo: cfg.recolorLogo } }));
      } catch (e) {}
      try {
        if (window.AgyTools && typeof window.AgyTools.switchIconPack === "function") {
          var spec = (cfg.recolorLogo && cfg.color)
            ? (cfg.pack + "_" + String(cfg.color).replace("#", "").toLowerCase())
            : cfg.pack;
          window.AgyTools.switchIconPack(spec);
        }
      } catch (e) {}
      applyLogo(cfg.pack);
      render(el);
    };
    toggleRow.appendChild(toggleSwitch);
    c2.appendChild(toggleRow);

    var sw = document.createElement("div");
    sw.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:8px";

    COLORS.forEach(function (c) {
      var selected = cfg.color.toLowerCase() === c.hex.toLowerCase();
      var b = document.createElement("button");
      b.type = "button";
      b.title = T(c.ru, c.en) + " " + c.hex;
      b.setAttribute("aria-label", T(c.ru, c.en));
      b.style.cssText = "position:relative;width:100%;aspect-ratio:1;border-radius:12px;cursor:pointer;" +
        "border:2px solid " + (selected ? "var(--foreground,#eee)" : "transparent") + ";" +
        "background:" + c.hex + ";padding:0;transition:transform .12s";
      b.onmousedown = function () { b.style.transform = "scale(.92)"; };
      b.onmouseup = b.onmouseleave = function () { b.style.transform = ""; };
      b.onclick = function () {
        cfg.color = c.hex;
        saveCfg();
        applyColor(c.hex);
        try {
          window.dispatchEvent(new CustomEvent("agy:brand-changed", { detail: { pack: cfg.pack, color: c.hex, recolorLogo: cfg.recolorLogo } }));
        } catch (e) {}
        try {
          if (window.AgyTools && typeof window.AgyTools.switchIconPack === "function") {
            var spec = cfg.recolorLogo
              ? (cfg.pack + "_" + String(c.hex).replace("#", "").toLowerCase())
              : cfg.pack;
            window.AgyTools.switchIconPack(spec);
          }
        } catch (e) {}
        applyLogo(cfg.pack);
        render(el);
        var s = document.getElementById("agy-brand-status");
        if (s) {
          s.textContent = T("Акцентный цвет применён: ", "Accent colour applied: ") + c.hex.toUpperCase();
          s.style.color = "#10b981";
        }
      };
      sw.appendChild(b);
    });
    c2.appendChild(sw);

    /* current colour chip + hex */
    var cur = document.createElement("div");
    cur.style.cssText = "display:flex;align-items:center;gap:10px;margin-top:12px;font-size:13px;color:#999";
    var chip = document.createElement("span");
    chip.style.cssText = "width:18px;height:18px;border-radius:6px;background:" + cfg.color +
      ";border:1px solid rgba(127,127,127,.3);flex-shrink:0";
    cur.appendChild(chip);
    var curTxt = document.createElement("span");
    curTxt.style.cssText = "font-family:ui-monospace,monospace";
    curTxt.textContent = cfg.color.toUpperCase();
    cur.appendChild(curTxt);
    c2.appendChild(cur);
    el.appendChild(c2);

    /* ── Card 3: fonts ── */
    var c3 = makeCard();
    c3.appendChild(makeTitle(T("Шрифт интерфейса", "Interface font")));
    c3.appendChild(makeNote(T(
      "Шрифты, одинаково подходящие для английского и русского языка (полная поддержка кириллицы и латиницы), свободные от авторских прав (SIL OFL / Apache 2.0 / Ubuntu).",
      "Fonts equally suited for English and Russian (full Latin and Cyrillic coverage), completely copyright-free (SIL OFL / Apache 2.0 / Ubuntu)."
    )));

    var currentFont = FONTS.filter(function (x) { return x.id === cfg.font; })[0] || FONTS[0];

    var fontContainer = document.createElement("div");
    fontContainer.style.cssText = "display:flex;align-items:stretch;gap:14px;flex-wrap:wrap;margin-top:6px";

    /* LEFT: Live Preview Box showing real-time changes */
    var previewCol = document.createElement("div");
    previewCol.id = "agy-font-preview-box";
    previewCol.style.cssText = "flex:1 1 240px;min-width:200px;background:rgba(255,255,255,.03);border:1px solid rgba(127,127,127,.2);" +
      "border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;justify-content:center;gap:6px;transition:all .15s";

    var previewHead = document.createElement("div");
    previewHead.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:2px";

    var previewLabel = document.createElement("span");
    previewLabel.style.cssText = "font-size:10.5px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:var(--muted-foreground,#888)";
    previewLabel.textContent = T("Предпросмотр", "Live preview");
    previewHead.appendChild(previewLabel);

    var previewBadge = document.createElement("span");
    previewBadge.id = "agy-font-preview-badge";
    previewBadge.style.cssText = "font-size:10px;padding:2px 7px;border-radius:6px;background:rgba(127,127,127,.15);color:var(--muted-foreground,#888);font-family:monospace";
    previewBadge.textContent = currentFont.license;
    previewHead.appendChild(previewBadge);
    previewCol.appendChild(previewHead);

    var previewText = document.createElement("div");
    previewText.id = "agy-font-preview-text";
    previewText.style.cssText = "font-size:13.5px;line-height:1.45;color:var(--foreground,#eee);font-family:" + currentFont.family;
    previewText.innerHTML =
      "<strong>Leostryx AI</strong> — умный агент для Android.<br>" +
      "The quick brown fox jumps over the lazy dog.<br>" +
      "<span style='font-size:11.5px;opacity:0.8'>0123456789 • АБВГДЕёжзийклмноп • ABCDEF • { ok: true }</span>";
    previewCol.appendChild(previewText);

    fontContainer.appendChild(previewCol);

    /* RIGHT: Button with Dropdown List */
    var selectCol = document.createElement("div");
    selectCol.style.cssText = "flex:0 1 210px;min-width:170px;position:relative;display:flex;flex-direction:column;justify-content:center";

    var fontBtn = document.createElement("button");
    fontBtn.type = "button";
    fontBtn.id = "agy-font-select-btn";
    fontBtn.setAttribute("aria-haspopup", "listbox");
    fontBtn.setAttribute("aria-expanded", "false");
    fontBtn.style.cssText = "width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;" +
      "background:var(--secondary,rgba(255,255,255,.05));border:1px solid rgba(127,127,127,.25);border-radius:12px;" +
      "color:var(--foreground,#eee);font-size:13.5px;font-weight:500;cursor:pointer;transition:border-color .15s, background .15s";

    var btnContent = document.createElement("div");
    btnContent.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;text-align:left;overflow:hidden";

    var btnTitle = document.createElement("span");
    btnTitle.id = "agy-font-btn-title";
    btnTitle.style.cssText = "font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px";
    btnTitle.textContent = T(currentFont.ru, currentFont.en);
    btnContent.appendChild(btnTitle);

    var btnSub = document.createElement("span");
    btnSub.id = "agy-font-btn-sub";
    btnSub.style.cssText = "font-size:11px;color:var(--muted-foreground,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px";
    btnSub.textContent = currentFont.license;
    btnContent.appendChild(btnSub);

    fontBtn.appendChild(btnContent);

    var arrowIcon = document.createElement("span");
    arrowIcon.style.cssText = "flex-shrink:0;opacity:0.7;display:inline-flex";
    arrowIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    fontBtn.appendChild(arrowIcon);

    selectCol.appendChild(fontBtn);

    /* Dropdown Popover */
    var dropdown = document.createElement("div");
    dropdown.id = "agy-font-dropdown";
    dropdown.setAttribute("role", "listbox");
    dropdown.style.cssText = "display:none;position:absolute;top:calc(100% + 6px);right:0;width:max-content;min-width:240px;max-width:320px;" +
      "max-height:280px;overflow-y:auto;z-index:9999;border-radius:14px;background:var(--agy-glass-surface,rgba(24,24,28,.95));" +
      "backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--agy-glass-border,rgba(127,127,127,.25));" +
      "box-shadow:var(--agy-glass-shadow,0 16px 40px rgba(0,0,0,.5));padding:6px;box-sizing:border-box";

    FONTS.forEach(function (f) {
      var isSel = f.id === cfg.font;
      var item = document.createElement("div");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", isSel ? "true" : "false");
      item.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-radius:8px;" +
        "cursor:pointer;transition:background .12s;background:" + (isSel ? "var(--agy-glass-item-hover,rgba(255,255,255,.08))" : "transparent");

      var itemInfo = document.createElement("div");
      itemInfo.style.cssText = "display:flex;flex-direction:column;gap:1px;text-align:left";

      var itemTitle = document.createElement("span");
      itemTitle.style.cssText = "font-size:13px;font-weight:" + (isSel ? "600" : "500") + ";color:var(--foreground,#eee);font-family:" + f.family;
      itemTitle.textContent = T(f.ru, f.en);
      itemInfo.appendChild(itemTitle);

      var itemDesc = document.createElement("span");
      itemDesc.style.cssText = "font-size:10.5px;color:var(--muted-foreground,#888)";
      itemDesc.textContent = f.desc + " · " + f.license;
      itemInfo.appendChild(itemDesc);

      item.appendChild(itemInfo);

      if (isSel) {
        var check = document.createElement("span");
        check.style.cssText = "color:" + cfg.color + ";font-size:13px;font-weight:700";
        check.textContent = "✓";
        item.appendChild(check);
      }

      item.onmouseenter = function () {
        if (!isSel) item.style.background = "var(--agy-glass-item-hover,rgba(255,255,255,.05))";
      };
      item.onmouseleave = function () {
        if (!isSel) item.style.background = "transparent";
      };

      item.onclick = function (e) {
        e.stopPropagation();
        cfg.font = f.id;
        saveCfg();
        store("agyFontFamily", f.id);
        applyFont(f.id);

        dropdown.style.display = "none";
        fontBtn.setAttribute("aria-expanded", "false");

        previewText.style.fontFamily = f.family;
        previewBadge.textContent = f.license;
        btnTitle.textContent = T(f.ru, f.en);
        btnSub.textContent = f.license;

        render(el);

        var s = document.getElementById("agy-brand-status");
        if (s) {
          s.textContent = T("Шрифт применён: ", "Font applied: ") + T(f.ru, f.en) + " (" + f.license + ")";
          s.style.color = "#10b981";
        }
      };

      dropdown.appendChild(item);
    });

    selectCol.appendChild(dropdown);

    fontBtn.onclick = function (e) {
      e.stopPropagation();
      var open = dropdown.style.display === "block";
      dropdown.style.display = open ? "none" : "block";
      fontBtn.setAttribute("aria-expanded", open ? "false" : "true");
    };

    document.addEventListener("pointerdown", function (e) {
      if (dropdown.style.display === "block" && !selectCol.contains(e.target)) {
        dropdown.style.display = "none";
        fontBtn.setAttribute("aria-expanded", "false");
      }
    }, true);

    fontContainer.appendChild(selectCol);
    c3.appendChild(fontContainer);
    el.appendChild(c3);

    /* ── status ── */
    var st = document.createElement("div");
    st.id = "agy-brand-status";
    st.style.cssText = "font-size:12.5px;line-height:1.5;color:#999;min-height:18px;padding:0 2px";
    st.textContent = T(
      "Логотип: " + packName(cfg.pack) + " · Цвет: " + cfg.color.toUpperCase() + " · Шрифт: " + fontName(cfg.font),
      "Logo: " + packNameEn(cfg.pack) + " · Colour: " + cfg.color.toUpperCase() + " · Font: " + fontNameEn(cfg.font)
    );
    el.appendChild(st);
  }

  function fontName(id) {
    var f = FONTS.filter(function (x) { return x.id === id; })[0];
    return f ? T(f.ru, f.en) : id;
  }
  function fontNameEn(id) {
    var f = FONTS.filter(function (x) { return x.id === id; })[0];
    return f ? f.en : id;
  }

  function packName(id) {
    var p = PACKS.filter(function (x) { return x.id === id; })[0];
    return p ? T(p.ru, p.en) : id;
  }
  function packNameEn(id) {
    var p = PACKS.filter(function (x) { return x.id === id; })[0];
    return p ? p.en : id;
  }

  /* ------------------------------------------------------------- mount */
  window.__agyBrandMount = function (el) {
    if (!el) return;
    applyColor(cfg.color);
    applyFont(cfg.font);
    if (el.getAttribute("data-brand-mounted") === "1") { render(el); return; }
    el.setAttribute("data-brand-mounted", "1");
    el.style.cssText = "padding:4px 4px 24px;max-width:620px;box-sizing:border-box";
    render(el);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      applyColor(cfg.color);
      applyFont(cfg.font);
    });
  } else {
    applyColor(cfg.color);
    applyFont(cfg.font);
  }
})();
