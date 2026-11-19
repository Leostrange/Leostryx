/* Antigravity RU — security shield in the chat toolbar (ТЗ §7, B-16, B-17).
 * Reads and writes the real 2.4.1 settings store (exported from the bundle as
 * window.__agySettings), so every change shows up in Settings and back.
 * The popover is one fixed element of its own: no full-screen layer, nothing
 * is styled outside it, and it is removed on close. */
(function () {
  "use strict";
  if (window.__agyShield) return;
  window.__agyShield = true;

  var BOX = "[data-testid='agent-input-box']";
  var SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>';

  function ru() {
    try { return window.__agyI18n ? window.__agyI18n.getLanguage() === "ru" : document.documentElement.getAttribute("data-agy-language") === "ru"; }
    catch (e) { return true; }
  }
  function T(r, e) { return ru() ? r : e; }
  function tr(s) { try { return window.__agyI18n ? window.__agyI18n.translate(s) : s; } catch (e) { return s; } }

  function api() {
    var x = window.__agySettings;
    if (!x || !x.store || !x.store.getState) return null;
    var st = x.store.getState();
    if (!st || typeof st.getPrefValue !== "function" || typeof st.setPrefValue !== "function") return null;
    return x;
  }
  function get(key) { var x = api(); return x ? x.store.getState().getPrefValue(x.Ui[key]) : undefined; }
  function set(key, v) { var x = api(); if (x) x.store.getState().setPrefValue(x.Ui[key], v); }

  function osGroup(x) { var os = x.qq(); return os === "macos" || os === "linux" ? "macos_linux" : "windows"; }

  /* --- reliable persistence for policy fields -----------------------------
   * In 2.4.1 the JS settings store cannot round-trip userSettings policy
   * fields (its proto schema predates internetAccessPolicy), so a pick used
   * to write nothing and the row snapped back ("Доступ в интернет" always
   * returned to "Всегда спрашивать"; the agent kept asking for approvals
   * although the shield showed the right values). Every pick now:
   *   1. normalises enum values (numbers AND config strings like
   *      "AGENT_SETTING_POLICY_ALLOW" match the option list);
   *   2. mirrors the pick into localStorage (instant, sticky UI);
   *   3. persists it to config.json via the AgyTools bridge (agy-tools.sh
   *      policy) — the Go core watches the file and applies the value. */
  function normEnum(v, E) {
    if (typeof v !== "string") return v;
    var u = v.toUpperCase(), best, bl = -1;
    for (var k in E) {
      if (typeof E[k] !== "number") continue;
      if (u.length >= k.length && u.lastIndexOf(k) === u.length - k.length && k.length > bl) { best = E[k]; bl = k.length; }
    }
    return best !== undefined ? best : E.UNSPECIFIED;
  }
  var OVK = "agyShieldOv";
  function ovAll() { try { return JSON.parse(window.localStorage.getItem(OVK) || "{}"); } catch (e) { return {}; } }
  function ovGet(id) { var o = ovAll(); return o[id]; }
  function ovSet(id, v) { try { var o = ovAll(); o[id] = v; window.localStorage.setItem(OVK, JSON.stringify(o)); } catch (e) {} }
  var pickAt = {};   // section id -> ms timestamp of the last user pick
  var SECTIONS_CFG = {
    file: { field: "nonWorkspaceFileAccessPolicy", prefix: "AGENT_SETTING_POLICY" },
    net:  { field: "internetAccessPolicy", prefix: "AGENT_SETTING_POLICY" },
    term: { field: "autoExecutionPolicy", prefix: "CASCADE_COMMANDS_AUTO_EXECUTION" },
    sbx:  { field: "enableTerminalSandbox", bool: true },
    js:   { field: "browserJsExecutionPolicy", prefix: "BROWSER_JS_EXECUTION_POLICY" }
  };
  function cfgStr(cfg, v) {
    if (cfg.bool) return v ? "true" : "false";
    return cfg.prefix + "_" + cfg.E[v];
  }
  function cfgValueFromStr(cfg, s) {
    if (cfg.bool) return String(s).toLowerCase() === "true";
    return normEnum(s, cfg.E);
  }
  function bridgePolicy(arg, done) {
    var b = window.AgyTools;
    if (!b || typeof b.start !== "function") { if (done) done(null); return; }
    var id;
    try { id = b.start("policy", arg); } catch (e) { if (done) done(null); return; }
    if (!id || /^ERR/.test(String(id))) { if (done) done(null); return; }
    var t0 = Date.now();
    (function poll() {
      var r = null;
      try { r = JSON.parse(b.read(id) || "{}"); } catch (e) {}
      if (r && r.rc !== undefined && r.rc !== "") { if (done) done(r); return; }
      if (Date.now() - t0 > 15000) { if (done) done(null); return; }
      setTimeout(poll, 300);
    })();
  }
  /* Pull the authoritative values from config.json and refresh the overlays —
     but never fight a pick the user made in the last seconds. */
  function syncFromBridge() {
    var x = api(); if (!x) return;
    var defaults = {file: "NON_WORKSPACE_FILE_ACCESS_POLICY", net: "INTERNET_ACCESS_POLICY", term: "CASCADE_AUTO_EXECUTION_POLICY", js: "BROWSER_JS_EXECUTION_POLICY", sbx: "ENABLE_TERMINAL_SANDBOX"};
    var fields = [];
    for (var id in defaults) {
      var cfg = SECTIONS_CFG[id], value = get(defaults[id]);
      if (cfg.bool) value = value === true;
      else {
        value = normEnum(value, cfg.E);
        if (value === undefined || value === cfg.E.UNSPECIFIED || cfg.E[value] === undefined)
          value = id === "term" ? cfg.E.OFF : id === "js" ? cfg.E.ALWAYS_ASK : cfg.E.ASK;
      }
      fields.push(cfg.field + "=" + cfgStr(cfg, value));
    }
    policyLoading = true;
    bridgePolicy("init," + fields.join(","), function (r) {
      policyLoading = false;
      if (!r || !r.log || String(r.rc) !== "0") { if (pop) render(); return; }
      var changed = false;
      (String(r.log).match(/@@kv \S+ \S*/g) || []).forEach(function (line) {
        var m = /^@@kv (\S+) (\S*)$/.exec(line); if (!m) return;
        for (var id in SECTIONS_CFG) {
          var cfg = SECTIONS_CFG[id];
          if (cfg.field !== m[1]) continue;
          if (pickAt[id] && Date.now() - pickAt[id] < 3000) continue;
          ovSet(id, cfgValueFromStr(cfg, m[2])); changed = true;
        }
      });
      if (changed && pop) render();
    });
  }
  function mirrorPick(id, v) {
    var cfg = SECTIONS_CFG[id]; if (!cfg) return;
    pickAt[id] = Date.now();
    ovSet(id, v);
    bridgePolicy(cfg.field + "=" + cfgStr(cfg, v));
  }

  function sections() {
    var x = api(); if (!x) return null;
    var I = x.I, CAE = I.CascadeCommandsAutoExecution, ASP = I.AgentSettingPolicy, JS = I.BrowserJsExecutionPolicy;
    SECTIONS_CFG.file.E = ASP; SECTIONS_CFG.net.E = ASP;
    SECTIONS_CFG.term.E = CAE; SECTIONS_CFG.js.E = JS;
    var sandbox = get("ENABLE_TERMINAL_SANDBOX");
    var term = normEnum(get("CASCADE_AUTO_EXECUTION_POLICY"), CAE);
    var file = normEnum(get("NON_WORKSPACE_FILE_ACCESS_POLICY"), ASP);
    if (file === undefined || file === ASP.UNSPECIFIED) file = ASP.ASK;
    var js = normEnum(get("BROWSER_JS_EXECUTION_POLICY"), JS);
    var net = normEnum(get("INTERNET_ACCESS_POLICY"), ASP);
    if (net === undefined || net === ASP.UNSPECIFIED) net = ASP.ASK;
    if (js === undefined || js === JS.UNSPECIFIED) js = JS.ALWAYS_ASK;
    if (ovGet("sbx") !== undefined) sandbox = ovGet("sbx");
    if (ovGet("term") !== undefined) term = ovGet("term");
    if (ovGet("file") !== undefined) file = ovGet("file");
    if (ovGet("net") !== undefined) net = ovGet("net");
    if (ovGet("js") !== undefined) js = ovGet("js");
    // Ignore unset / obsolete cached enums rather than showing a dash.
    if (file === undefined || file === ASP.UNSPECIFIED || ASP[file] === undefined) file = ASP.ASK;
    if (net === undefined || net === ASP.UNSPECIFIED || ASP[net] === undefined) net = ASP.ASK;
    if (term === undefined || term === CAE.UNSPECIFIED || CAE[term] === undefined) term = CAE.OFF;
    if (js === undefined || js === JS.UNSPECIFIED || JS[js] === undefined) js = JS.ALWAYS_ASK;
    var presets = x.hEa[x.qq()].presets;
    var cur = x.iEa(sandbox === undefined ? false : sandbox, term, file, presets);
    var labels = x.Mt[osGroup(x)];
    var presetOpts = presets.map(function (p) {
      return { v: p, label: tr(labels[p].displayName), desc: tr(labels[p].shortDescription) };
    });
    presetOpts.push({ v: "custom", label: T("Пользовательский", "Custom"), desc: T("Настройте отдельные параметры вручную.", "Manually customize individual settings."), passive: true });
    return [
      { id: "preset", title: T("Профиль безопасности", "Security preset"), value: cur, opts: presetOpts,
        pick: function (v) {
          var p = x.gEa[v]; if (!p) return;
          set("ENABLE_TERMINAL_SANDBOX", p.sandboxMode);
          set("CASCADE_AUTO_EXECUTION_POLICY", p.terminal);
          set("NON_WORKSPACE_FILE_ACCESS_POLICY", p.fileAccess);
        } },
      { id: "file", title: T("Доступ к файлам вне папок", "Non-workspace file access"), value: file, opts: [
          { v: ASP.ASK, label: T("Всегда спрашивать", "Always ask") },
          { v: ASP.ALLOW, label: T("Разрешить", "Allow") },
          { v: ASP.DENY, label: T("Запретить", "Deny") }],
        pick: function (v) { set("NON_WORKSPACE_FILE_ACCESS_POLICY", v); } },
      { id: "net", title: T("Доступ в интернет", "Internet access"), value: net, opts: [
          { v: ASP.ASK, label: T("Всегда спрашивать", "Always ask") },
          { v: ASP.ALLOW, label: T("Разрешить", "Allow") },
          { v: ASP.DENY, label: T("Запретить", "Deny") }],
        pick: function (v) { set("INTERNET_ACCESS_POLICY", v); } },
      { id: "term", title: T("Автовыполнение команд терминала", "Terminal auto execution"), value: term, opts: [
          { v: CAE.OFF, label: T("Требовать подтверждение", "Request review") },
          { v: CAE.PROCEED_IN_SANDBOX, label: T("Выполнять в песочнице", "Proceed in sandbox") },
          { v: CAE.EAGER, label: T("Не спрашивать", "Always proceed") }],
        pick: function (v) {
          set("CASCADE_AUTO_EXECUTION_POLICY", v);
          // Android has no bwrap: a sandboxed command fails and falls back to
          // "run outside sandbox", which always asks. "Always proceed" therefore
          // also turns the sandbox off; "Proceed in sandbox" turns it on.
          if (v === CAE.EAGER) {
            set("ENABLE_TERMINAL_SANDBOX", false);
            mirrorPick("sbx", false);
          }
          if (v === CAE.PROCEED_IN_SANDBOX) {
            set("ENABLE_TERMINAL_SANDBOX", true);
            mirrorPick("sbx", true);
          }
        } },
      { id: "sbx", title: T("Песочница", "Sandbox"), value: sandbox === true, opts: [
          { v: false, label: T("Выключена", "Off"), desc: T("Команды выполняются напрямую. Нужно для работы без подтверждений на Android.", "Commands run directly. Required for no-approval mode on Android.") },
          { v: true, label: T("Включена", "On"), desc: T("На Android не работает (нет bwrap): каждая команда будет запрашивать запуск вне песочницы.", "Does not work on Android (no bwrap): every command will ask to run outside the sandbox.") }],
        pick: function (v) { set("ENABLE_TERMINAL_SANDBOX", v); } },
      { id: "js", title: T("JavaScript в браузере", "Browser JavaScript"), value: js, opts: [
          { v: JS.DISABLED, label: T("Отключено", "Disabled") },
          { v: JS.ALWAYS_ASK, label: T("Запрашивать подтверждение", "Ask first") },
          { v: JS.TURBO, label: T("Не спрашивать", "Always run") }],
        pick: function (v) { set("BROWSER_JS_EXECUTION_POLICY", v); } }
    ];
  }

  var pop = null, openId = null, unsub = null, policyLoading = false;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function render() {
    if (!pop) return;
    var secs = sections();
    if (!secs) {
      pop.innerHTML = '<div class="agy-sh-empty">' + esc(T("Настройки ещё загружаются…", "Settings are still loading…")) + "</div>";
      return;
    }
    var h = "";
    secs.forEach(function (s) {
      var cur = s.opts.filter(function (o) { return o.v === s.value; })[0];
      var open = openId === s.id;
      h += '<div class="agy-sh-sec' + (open ? " open" : "") + '">' +
        '<button type="button" class="agy-sh-head" data-sec="' + s.id + '"><span class="agy-sh-title">' + esc(s.title) + '</span>' +
        '<span class="agy-sh-cur">' + esc(cur ? cur.label : "—") + '</span>' +
        '<svg class="agy-sh-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button>';
      if (open) {
        h += '<div class="agy-sh-opts" role="listbox">';
        s.opts.forEach(function (o, i) {
          var sel = o.v === s.value;
          h += '<button type="button" role="option" aria-selected="' + sel + '" class="agy-sh-opt' + (sel ? " sel" : "") + (o.passive ? " passive" : "") +
            '" data-sec="' + s.id + '" data-i="' + i + '"><span class="agy-sh-ol"><span>' + esc(o.label) + "</span>" +
            (o.desc ? '<span class="agy-sh-od">' + esc(o.desc) + "</span>" : "") + "</span>" +
            (sel ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12l5 5 9-10"/></svg>' : "") + "</button>";
        });
        h += "</div>";
      }
      h += "</div>";
    });
    pop.innerHTML = h;
    place();
  }

  function place() {
    if (!pop) return;
    var box = document.querySelector(BOX);
    if (!box) { close(); return; }
    var r = box.getBoundingClientRect();
    // Strictly the width of the context (input) box — both edges aligned with
    // it. The old 360px cap made the popover fall short on the right whenever
    // the box was wider (the projects screen).
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var w = Math.min(r.width, vw - 8);
    var left = Math.max(4, Math.min(r.left, vw - w - 4));
    pop.style.setProperty("width", Math.round(w) + "px", "important");
    pop.style.setProperty("max-width", Math.round(w) + "px", "important");
    pop.style.setProperty("min-width", Math.round(w) + "px", "important");
    pop.style.setProperty("left", Math.round(left) + "px", "important");
    pop.style.setProperty("right", "auto", "important");
    pop.style.setProperty("bottom", Math.round(window.innerHeight - r.top + 6) + "px", "important");
    pop.style.setProperty("max-height", Math.max(160, Math.round(r.top - 64)) + "px", "important");
  }

  function open(btn) {
    if (pop) { close(); return; }
    pop = document.createElement("div");
    pop.id = "agy-shield";
    pop.setAttribute("data-agy-no-translate", "");
    pop.addEventListener("pointerdown", function (e) { e.preventDefault(); });
    pop.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var id = b.getAttribute("data-sec");
      if (b.classList.contains("agy-sh-head")) { openId = openId === id ? null : id; render(); return; }
      var secs = sections(); if (!secs) return;
      var s = secs.filter(function (q) { return q.id === id; })[0];
      var o = s && s.opts[+b.getAttribute("data-i")];
      if (!o || o.passive || policyLoading) return;
      openId = null; // Close before writing: the settings store may re-render synchronously.
      try { s.pick(o.v); } catch (err) {}
      if (s.id === "preset") {
        // preset pick writes three fields at once — mirror all of them
        var xx = api(), pp = xx && xx.gEa && xx.gEa[o.v];
        if (pp) {
          mirrorPick("sbx", pp.sandboxMode === true);
          mirrorPick("term", pp.terminal);
          mirrorPick("file", pp.fileAccess);
          if (pp.internetAccess !== undefined) mirrorPick("net", pp.internetAccess);
          if (pp.browserJs !== undefined)      mirrorPick("js",  pp.browserJs);
        }
      } else {
        mirrorPick(s.id, o.v);
      }
      setTimeout(render, 30);
    });
    document.body.appendChild(pop);
    btn.setAttribute("aria-expanded", "true");
    var x = api();
    if (x && x.store.onDidChange) { var d = x.store.onDidChange(function () { render(); }); unsub = function () { try { d.dispose(); } catch (e) {} }; }
    render();
    syncFromBridge();
  }

  var CTX_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9" stroke-dasharray="38 18" stroke-width="2"/>' +
    '<circle cx="12" cy="12" r="3.5" fill="currentColor"/>' +
    '</svg>';

  var ctxPop = null;

  function close() {
    if (unsub) { unsub(); unsub = null; }
    if (pop) { pop.remove(); pop = null; }
    openId = null;
    var b = document.querySelector(".agy-shield-btn"); if (b) b.setAttribute("aria-expanded", "false");
  }
  window.__agyShieldClose = function () { if (!pop) return false; close(); return true; };

  function closeCtx() {
    if (ctxPop) { ctxPop.remove(); ctxPop = null; }
    var b = document.querySelector(".agy-ctx-circle-btn");
    if (b) b.setAttribute("aria-expanded", "false");
  }
  window.__agyContextClose = function () { if (!ctxPop) return false; closeCtx(); return true; };

  function getActiveModel() {
    var trigger = document.querySelector(BOX + " [data-testid='model-selector-trigger'] > span:first-child");
    if (trigger && trigger.textContent && trigger.textContent.trim()) {
      return trigger.textContent.trim();
    }
    try {
      var last = localStorage.getItem("agyLastCustomModel");
      if (last) return last;
    } catch (e) {}
    return "gemini-2.5-flash";
  }

  function getModelProvider(id) {
    try {
      var raw = localStorage.getItem("agyProviders");
      if (raw) {
        var st = JSON.parse(raw);
        for (var i = 0; i < (st.connections || []).length; i++) {
          var c = st.connections[i];
          if ((c.selected || []).indexOf(id) >= 0 || (c.models || []).indexOf(id) >= 0) {
            return {
              name: c.name || (c.type === "openai" ? "OpenAI-совместимый" : c.type === "anthropic" ? "Claude (Anthropic)" : "Gemini"),
              baseUrl: c.baseUrl || ""
            };
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function getCompactorStats() {
    var enabled = true, threshold = 16, keepRecent = 8;
    try {
      var raw = localStorage.getItem("agyGatewaySettings");
      if (raw) {
        var g = JSON.parse(raw);
        if (g.compactEnabled === false) enabled = false;
        if (Number(g.compactThreshold) > 0) threshold = Number(g.compactThreshold);
        if (Number(g.compactKeepRecent) > 0) keepRecent = Number(g.compactKeepRecent);
      }
    } catch (e) {}
    var msgs = document.querySelectorAll("[data-testid='chat-message'], [class*='conversation-message'], [class*='message-turn'], [data-testid='turn-container']").length;
    return { enabled: enabled, threshold: threshold, keepRecent: keepRecent, count: msgs };
  }

  function placeCtx() {
    if (!ctxPop) return;
    var box = document.querySelector(BOX); if (!box) return;
    var r = box.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var w = Math.min(350, vw - 16);
    var left = Math.max(8, Math.min(r.right - w - 8, vw - w - 8));
    ctxPop.style.setProperty("width", Math.round(w) + "px", "important");
    ctxPop.style.setProperty("max-width", Math.round(w) + "px", "important");
    ctxPop.style.setProperty("min-width", Math.round(w) + "px", "important");
    ctxPop.style.setProperty("left", Math.round(left) + "px", "important");
    ctxPop.style.setProperty("right", "auto", "important");
    ctxPop.style.setProperty("bottom", Math.round(window.innerHeight - r.top + 6) + "px", "important");
    ctxPop.style.setProperty("max-height", Math.max(200, Math.round(r.top - 64)) + "px", "important");
  }

  function renderCtx() {
    if (!ctxPop) return;
    var modelName = getActiveModel();
    var prov = getModelProvider(modelName);
    var catalogFn = window.AgyModelCatalog;
    var info = catalogFn ? catalogFn(prov ? prov.baseUrl : "", modelName) : null;
    var cmp = getCompactorStats();

    function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
    function value(x) { return x === null || x === undefined ? T("неизвестно", "unknown") : x ? T("да", "yes") : T("нет", "no"); }
    var modes = info && Array.isArray(info.inputModes) ? info.inputModes : [];
    function mode(m) { return value(modes.length ? modes.indexOf(m) >= 0 : null); }

    var ctxFormatted = (info && info.ctx > 0) ? Number(info.ctx).toLocaleString() + " " + T("токенов", "tokens") : T("128 000 токенов (базовый)", "128,000 tokens (default)");
    var srcMap = {
      "xiaomi-docs": T("официальная документация Xiaomi", "official Xiaomi documentation"),
      "anthropic-spec": T("спецификация Anthropic Claude", "Anthropic Claude specification"),
      "google-spec": T("спецификация Google Gemini", "Google Gemini specification"),
      "moonshot-spec": T("спецификация Moonshot Kimi", "Moonshot Kimi specification"),
      "openai-spec": T("спецификация OpenAI", "OpenAI specification"),
      "deepseek-spec": T("спецификация DeepSeek", "DeepSeek specification"),
      "qwen-spec": T("спецификация Alibaba Qwen", "Alibaba Qwen specification"),
      "glm-spec": T("спецификация Zhipu GLM", "Zhipu GLM specification"),
      "meta-spec": T("спецификация Meta Llama", "Meta Llama specification"),
      "mistral-spec": T("спецификация Mistral AI", "Mistral AI specification"),
      "xai-spec": T("спецификация xAI Grok", "xAI Grok specification"),
      "minimax-spec": T("спецификация MiniMax", "MiniMax specification"),
      "provider-api": T("ответ API провайдера", "provider API response"),
      "auto-detected": T("каталог характеристик моделей", "model capability catalog")
    };
    var src = (info && srcMap[info.source]) || (info && info.source) || T("каталог характеристик моделей", "model capability catalog");

    var h = '<div class="agy-ctx-head">' +
      '<div class="agy-ctx-title-wrap">' +
        '<span class="agy-ctx-dot">●</span>' +
        '<span class="agy-ctx-title" title="' + esc(modelName) + '">' + esc(modelName) + '</span>' +
      '</div>' +
      '<button type="button" class="agy-ctx-close" data-act="close" title="' + esc(T("Закрыть", "Close")) + '">✕</button>' +
    '</div>' +
    '<div class="agy-ctx-tags">' +
      '<span class="agy-ctx-tag">' + esc(prov ? prov.name : T("Модель", "Model")) + '</span>' +
      '<span class="agy-ctx-tag green">' + esc(ctxFormatted) + '</span>' +
    '</div>' +
    '<div class="agy-ctx-rows">' +
      '<div class="agy-ctx-row"><span class="agy-ctx-lbl">' + esc(T("Контекст:", "Context:")) + '</span><span class="agy-ctx-val">' + esc(ctxFormatted) + '</span></div>' +
      '<div class="agy-ctx-row"><span class="agy-ctx-lbl">' + esc(T("Вложения:", "Attachments:")) + '</span><span class="agy-ctx-val">' +
        esc(T("Картинки ", "Images ") + mode("image") + ' · ' + T("Аудио ", "Audio ") + mode("audio") + ' · ' + T("Видео ", "Video ") + mode("video")) + '</span></div>' +
      '<div class="agy-ctx-row"><span class="agy-ctx-lbl">' + esc(T("Функции:", "Capabilities:")) + '</span><span class="agy-ctx-val">' +
        esc("Reasoning " + value(info ? info.reasoning : null) + ' · ' + T("Инструменты ", "Tools ") + value(info ? info.tools : true)) + '</span></div>' +
      '<div class="agy-ctx-row"><span class="agy-ctx-lbl">' + esc(T("Источник:", "Source:")) + '</span><span class="agy-ctx-val">' + esc(src) + '</span></div>' +
      (info && info.effort ? '<div class="agy-ctx-row"><span class="agy-ctx-lbl">' + esc(T("Мышление:", "Effort:")) + '</span><span class="agy-ctx-val">' + esc(info.effort + (Array.isArray(info.efforts) && info.efforts.length ? ' (' + info.efforts.join(", ") + ')' : '')) + '</span></div>' : '') +
    '</div>' +
    '<div class="agy-ctx-compactor-box">' +
      '<div class="agy-ctx-c-title">' +
        '<span>' + esc(T("Авто-сжатие контекста:", "Context Compaction:")) + '</span>' +
        '<span style="color:' + (cmp.enabled ? '#a3e635' : '#ef4444') + ';font-weight:600;">' + esc(cmp.enabled ? T("Активно", "Active") : T("Выключено", "Disabled")) + '</span>' +
      '</div>' +
      '<div style="opacity:.8;margin-top:2px;">' +
        esc(T("Порог: ", "Threshold: ") + cmp.threshold + ' · ' + T("Окно свежих: ", "Window: ") + cmp.keepRecent + (cmp.count > 0 ? ' · ' + T("В диалоге: ", "In chat: ") + cmp.count : '')) +
      '</div>' +
    '</div>' +
    '<button type="button" class="agy-ctx-btn" data-act="providers">' + esc(T("Настройки провайдеров и моделей →", "Providers & model settings →")) + '</button>';

    ctxPop.innerHTML = h;
    placeCtx();
  }

  function toggleContext(btn) {
    if (ctxPop) { closeCtx(); return; }
    if (pop) close();
    ctxPop = document.createElement("div");
    ctxPop.id = "agy-ctx-popup";
    ctxPop.setAttribute("data-agy-no-translate", "");
    ctxPop.addEventListener("pointerdown", function (e) { e.preventDefault(); });
    ctxPop.addEventListener("click", function (e) {
      var actEl = e.target.closest("[data-act]");
      if (!actEl) return;
      var act = actEl.getAttribute("data-act");
      if (act === "close") { closeCtx(); }
      else if (act === "providers") {
        closeCtx();
        if (window.AgyProviders && typeof window.AgyProviders.open === "function") {
          window.AgyProviders.open();
        } else {
          var sBtn = document.querySelector("[data-testid='settings-button'], [aria-label*='Settings'], [aria-label*='Настройки']");
          if (sBtn) sBtn.click();
        }
      }
    });
    document.body.appendChild(ctxPop);
    btn.setAttribute("aria-expanded", "true");
    renderCtx();
  }

  document.addEventListener("pointerdown", function (e) {
    if (pop && !e.target.closest("#agy-shield") && !e.target.closest(".agy-shield-btn")) {
      close();
    }
    if (ctxPop && !e.target.closest("#agy-ctx-popup") && !e.target.closest(".agy-ctx-circle-btn")) {
      closeCtx();
    }
  }, true);
  window.addEventListener("resize", function () { if (pop) place(); if (ctxPop) placeCtx(); });

  /* Кнопка живёт в React-футере окна ввода, поэтому вставляем её только когда
   * редактор НЕ в фокусе: вставка узла в перерисовываемую строку заставляет
   * React пересобрать композер, фокус теряется и клавиатура закрывается
   * (симметрично attachSubagentButton в agy_ru.js). */
  function editorFocused() {
    var ae = document.activeElement;
    if (!ae || ae === document.body || !ae.closest) return false;
    if (!ae.closest(BOX)) return false;
    return !!(ae.isContentEditable || ae.tagName === "TEXTAREA" ||
      ae.getAttribute("contenteditable") === "true");
  }

  /* Buttons: toolbar group next to mic: [shield] [context circle] */
  function ensureButton() {
    var plus = document.querySelector(BOX + " button[aria-label='Add context'], " + BOX + " button[aria-label='Добавить контекст']");
    var footer = plus && plus.closest("[class*='input-footer']");
    if (!footer) { if (pop && !document.querySelector(BOX)) close(); if (ctxPop && !document.querySelector(BOX)) closeCtx(); return; }
    var group = footer.lastElementChild;
    if (!group || group.contains(plus)) return;
    if (editorFocused()) return;

    var shieldBtn = group.querySelector(".agy-shield-btn");
    var ctxBtn = group.querySelector(".agy-ctx-circle-btn");

    if (!shieldBtn) {
      shieldBtn = document.createElement("button");
      shieldBtn.type = "button";
      shieldBtn.className = "agy-shield-btn";
      shieldBtn.setAttribute("aria-label", T("Безопасность", "Security"));
      shieldBtn.setAttribute("title", T("Безопасность и политики", "Security & policies"));
      shieldBtn.setAttribute("aria-expanded", "false");
      shieldBtn.innerHTML = SVG;
      shieldBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); });
      shieldBtn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (ctxPop) closeCtx(); open(shieldBtn); });
      group.insertBefore(shieldBtn, group.firstChild);
    }

    if (!ctxBtn) {
      ctxBtn = document.createElement("button");
      ctxBtn.type = "button";
      ctxBtn.className = "agy-ctx-circle-btn";
      ctxBtn.setAttribute("aria-label", T("Контекст и данные модели", "Model context & capabilities"));
      ctxBtn.setAttribute("title", T("Контекст и данные модели", "Model context & capabilities"));
      ctxBtn.setAttribute("aria-expanded", "false");
      ctxBtn.innerHTML = CTX_SVG;
      ctxBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); });
      ctxBtn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); toggleContext(ctxBtn); });
      group.insertBefore(ctxBtn, shieldBtn.nextSibling);
    }
  }
  var raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; ensureButton(); if (pop) place(); if (ctxPop) placeCtx(); }); }
  function start() {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start, { once: true });

  // Редактор отпустил фокус — возвращаем кнопку сразу, не дожидаясь мутации.
  document.addEventListener("focusout", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest(BOX)) setTimeout(schedule, 0);
  }, true);
})();
