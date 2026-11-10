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

  /* -------------------------------------------------------------- state */
  function loadCfg() {
    var raw = store(STORE_KEY);
    var cfg = { pack: DEFAULT_PACK, color: DEFAULT_COLOR };
    if (raw) {
      try {
        var p = JSON.parse(raw);
        if (p && typeof p === "object") {
          if (p.pack) cfg.pack = p.pack;
          if (p.color) cfg.color = p.color;
        }
      } catch (e) {}
    }
    if (!PACKS.some(function (p) { return p.id === cfg.pack; })) cfg.pack = DEFAULT_PACK;
    if (!COLORS.some(function (c) { return c.hex.toLowerCase() === String(cfg.color).toLowerCase(); })) cfg.color = DEFAULT_COLOR;
    return cfg;
  }
  var cfg = loadCfg();

  function saveCfg() { store(STORE_KEY, JSON.stringify(cfg)); }

  window.__agyGetBrandAccent = function () {
    return cfg && cfg.color ? cfg.color : DEFAULT_COLOR;
  };

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
    var root = document.documentElement;
    if (!root || !root.style) return;
    var fg = contrastText(hex);
    root.style.setProperty("--primary", hex);
    root.style.setProperty("--primary-foreground", fg);
    root.style.setProperty("--color-primary", hex);
    root.style.setProperty("--color-primary-foreground", fg);
    root.style.setProperty("--accent", hex);
    root.style.setProperty("--brand-accent", hex);

    try {
      var st = document.getElementById("agy-brand-accent-css");
      if (!st) {
        st = document.createElement("style");
        st.id = "agy-brand-accent-css";
        (document.head || root).appendChild(st);
      }
      st.textContent =
        ":root, html, body {\n" +
        "  --primary: " + hex + " !important;\n" +
        "  --primary-foreground: " + fg + " !important;\n" +
        "  --color-primary: " + hex + " !important;\n" +
        "  --color-primary-foreground: " + fg + " !important;\n" +
        "  --accent: " + hex + " !important;\n" +
        "  --brand-accent: " + hex + " !important;\n" +
        "}\n";
    } catch (e) {}
  }

  /* --------------------------------------------------------- logo apply */
  function bridge() {
    return window.AgyTools && typeof window.AgyTools.start === "function" ? window.AgyTools : null;
  }
  function applyLogo(packId, after) {
    var b = bridge();
    if (!b) { if (after) after(false); return; }
    var id = b.start("brand", packId + "@" + cfg.color);
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
      b.start("brand", cfg.pack + "@" + cfg.color);
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
        iconWrap.innerHTML = window.__agyBrandSvgMarkup(p.id, cfg.color, 52);
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
          window.dispatchEvent(new CustomEvent("agy:brand-changed", { detail: { pack: p.id, color: cfg.color } }));
        } catch (e) {}
        render(el);
        try {
          if (window.AgyTools && typeof window.AgyTools.switchIconPack === "function") {
            window.AgyTools.switchIconPack(p.id);
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
    c2.appendChild(makeTitle(T("Цвет иконки и кнопок", "Icon and button colour")));
    c2.appendChild(makeNote(T(
      "Акцентный цвет: мгновенно перекрашивает логотип, значки, свечение и все акцентные кнопки интерфейса.",
      "Accent colour: immediately re-tints the logo, icons, glow and all primary UI buttons."
    )));

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
        if (cfg.color.toLowerCase() === c.hex.toLowerCase()) return;
        cfg.color = c.hex;
        saveCfg();
        persistForBuild();
        applyColor(c.hex);
        try {
          window.dispatchEvent(new CustomEvent("agy:brand-changed", { detail: { pack: cfg.pack, color: c.hex } }));
        } catch (e) {}
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

    /* ── status ── */
    var st = document.createElement("div");
    st.id = "agy-brand-status";
    st.style.cssText = "font-size:12.5px;line-height:1.5;color:#999;min-height:18px;padding:0 2px";
    st.textContent = T(
      "Логотип: " + packName(cfg.pack) + " · Цвет: " + cfg.color.toUpperCase(),
      "Logo: " + packNameEn(cfg.pack) + " · Colour: " + cfg.color.toUpperCase()
    );
    el.appendChild(st);
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
    if (el.getAttribute("data-brand-mounted") === "1") { render(el); return; }
    el.setAttribute("data-brand-mounted", "1");
    el.style.cssText = "padding:4px 4px 24px;max-width:620px;box-sizing:border-box";
    render(el);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { applyColor(cfg.color); });
  } else {
    applyColor(cfg.color);
  }
})();
