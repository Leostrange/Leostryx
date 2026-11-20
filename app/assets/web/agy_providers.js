/* Antigravity RU — Settings › Providers.
 * Lets the user add third-party model connections (Claude-, OpenAI- or
 * Gemini-compatible), paste a base URL + API key, and load the provider's
 * model list. Configs are stored by the native AgyProviders bridge (the core's
 * LLM-gateway launcher reads them). Model listing is done natively so provider
 * CORS never blocks it. Wiring selected models into the core runs as the next
 * step; this page configures and validates connections. */
(function () {
  "use strict";
  var window = typeof globalThis !== "undefined" && globalThis.window ? globalThis.window : (typeof globalThis !== "undefined" ? globalThis : this);
  if (window.__agyProvidersReady) return;
  window.__agyProvidersReady = true;

  function ru() { try { return window.__agyI18n ? window.__agyI18n.getLanguage() === "ru" : true; } catch (e) { return true; } }
  function T(r, e) { return ru() ? r : e; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  // A capability toggle chip for a selected model (images / tools / reasoning).
  function capChip(kind, m, on, label, title) {
    return '<label class="agy-pv-cap' + (on ? " on" : "") + '" title="' + esc(title) + '">' +
      '<input type="checkbox" data-cap="' + kind + '" data-capm="' + esc(m) + '"' + (on ? " checked" : "") + "> " + esc(label) + "</label>";
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  var TYPES = [
    { id: "openai", ru: "OpenAI-совместимый", en: "OpenAI-compatible", base: "https://api.openai.com/v1", hint: T("OpenAI, DeepSeek, Groq, xAI, Mistral, OpenRouter, локальные серверы.", "OpenAI, DeepSeek, Groq, xAI, Mistral, OpenRouter, local servers.") },
    { id: "anthropic", ru: "Claude-совместимый (Anthropic)", en: "Claude-compatible (Anthropic)", base: "https://api.anthropic.com", hint: T("Anthropic и прокси с форматом Messages API.", "Anthropic and proxies speaking the Messages API.") },
    { id: "gemini", ru: "Gemini-совместимый", en: "Gemini-compatible", base: "https://generativelanguage.googleapis.com/v1beta", hint: T("Google AI Studio и прокси с generateContent.", "Google AI Studio and generateContent proxies.") }
  ];
  function typeOf(id) { return TYPES.filter(function (t) { return t.id === id; })[0] || TYPES[0]; }

  var bridge = window.AgyProviders && typeof window.AgyProviders.save === "function" ? window.AgyProviders : null;

  var state = { connections: [] };
  function load() {
    var raw = "";
    try { raw = bridge ? bridge.load() : (localStorage.getItem("agyProviders") || ""); } catch (e) {}
    if (raw) { try { state = JSON.parse(raw); } catch (e) { state = { connections: [] }; } }
    if (!state.connections) state.connections = [];
    if (typeof state.compactHistory !== "boolean") state.compactHistory = true;
    if (!state.compactThreshold) state.compactThreshold = 16;
    if (!state.compactKeepRecent) state.compactKeepRecent = 8;
  }
  function save() {
    var json = JSON.stringify(state);
    try { if (bridge) bridge.save(json); else localStorage.setItem("agyProviders", json); } catch (e) {}
  }

  /* Restart the core so it re-reads the provider env (switch standard<->providers
     mode, or pick up a changed connection) — no manual Force Stop needed. */
  var restarting = false, restartTimer = 0;
  function applyRestart(targetLabel) {
    if (restarting) return;
    var label = targetLabel || "";
    // Отметка для следующей загрузки страницы: этот reload вызван рестартом
    // ядра, поэтому startup_ready.js разрешено агрессивнее лечить пустой экран
    // (сначала авто-перезагрузки, и только потом фатальный экран), а
    // agy_loading.js показывает экран возврата в чат.
    try {
      localStorage.setItem("__agyCoreRestart", JSON.stringify({
        ts: Date.now(),
        path: location.pathname + location.search + location.hash,
        label: label
      }));
    } catch (e) {}
    // Вместо тоста — полноэкранный экран перезапуска ядра. Даём браузеру
    // отрисовать его (два кадра), и только потом останавливаем ядро.
    try { if (window.__agyLoading) window.__agyLoading.show({ target: label, mode: "switch", guardMs: 60000 }); } catch (e) {}
    restarting = true;
    clearTimeout(restartTimer);
    setTimeout(function () {
      try { if (bridge && typeof bridge.restartCore === "function") bridge.restartCore(); } catch (e) {}
    }, 360);

    // WebView больше не перезагружается при смене ядра (патч watchCore), поэтому
    // экран держим до первого ответа НОВОГО ядра и убираем без перезагрузки
    // страницы. Два успешных ответа подряд — чтобы не поймать ещё живой старый
    // процесс в момент остановки.
    (function waitForCore() {
      var startedAt = Date.now(), okCount = 0;
      var timer = setInterval(function () {
        if (Date.now() - startedAt > 60000) { clearInterval(timer); return; }
        if (Date.now() - startedAt < 1200) return;
        fetch("./?agy_ping=" + Date.now(), { method: "HEAD", cache: "no-store" })
          .then(function (r) {
            if (!r || !r.ok) { okCount = 0; return; }
            if (++okCount < 2) return;
            clearInterval(timer);
            // Ядро ответило. Страницу перезагрузит натив (watchCore → loadApp),
            // а флаг __agyCoreRestart НЕ трогаем: по нему новая страница покажет
            // вторую фазу экрана (60% → 100%) и уйдёт по сигналу готовности UI.
            // Здесь специально не показываем 100% и «Готово» — иначе полоса
            // откатывалась бы назад после перезагрузки.
          })
          .catch(function () { okCount = 0; });
      }, 500);
    })();
    restartTimer = setTimeout(function () { restarting = false; if (root && root.isConnected) render(); }, 15000);
  }

  /* ---- global reader used by the model selector (main.js / cCb) ----
     Builds the provider-model map straight from storage, so it works no matter
     whether this settings page has been mounted yet. Each selected model turns
     into a BYOM custom-model entry {modelId, modelName}; cKa in main.js maps
     that into a selectable option, and the request resolves "gemini-api:/models/<id>"
     through the local gateway. Cached; the page calls __agyRefreshProviderModels
     on any change to invalidate the cache and re-render the selector. */
  function readPersisted() {
    var raw = "";
    try { raw = bridge ? bridge.load() : (localStorage.getItem("agyProviders") || ""); } catch (e) {}
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  // Specs for the selector: one per selected model, carrying the per-connection
  // capabilities and token budget set on the Providers page. main.js turns each
  // into a full BYOM ModelInfo. Capabilities live here, NOT in the selector.
  var __agySpecCache = null;
  function buildSpecs() {
    var cfg = readPersisted(), out = [], seen = {};
    if (!(cfg && cfg.useProviders && cfg.connections)) return out;
    cfg.connections.forEach(function (c) {
      var meta = c.modelMeta || {};
      var pType = c.type || "openai";
      var pName = c.name || (pType === "openai" ? "OpenAI-compatible" : pType === "anthropic" ? "Claude (Anthropic)" : "Gemini-compatible");
      (c.selected || []).forEach(function (m) {
        if (!m || seen[m]) return; seen[m] = 1;
        var md = effectiveInfo(c, m, meta[m]);
        out.push({
          // Bare id: in Providers mode the core routes the custom model through
          // the exclusive AGY_LLM_GATEWAY to the provider, which expects the raw
          // model id (e.g. "mimo-v2.6-pro").
          label: m, modelName: m,
          provider: pName,
          providerName: pName,
          providerType: pType,
          maxTokens: md.ctx && md.ctx > 0 ? md.ctx : 200000,
          images: md.images !== false, tools: md.tools !== false, thinking: md.thinking !== false,
          efforts: Array.isArray(md.efforts) && md.efforts.length ? md.efforts.slice() : null,
          effort: typeof md.effort === "string" && md.effort ? md.effort : null,
          ctxOut: Number(md.reportedMaxOutput) > 0 ? Number(md.reportedMaxOutput) : null
        });
      });
    });
    return out;
  }
  window.__agyProviderSpecs = function () {
    if (__agySpecCache !== null) return __agySpecCache;
    var s = buildSpecs();
    // Cache only a non-empty result, so the selector self-heals on its next
    // render once a provider is configured.
    if (s.length) __agySpecCache = s;
    return s;
  };
  window.__agyGetProviderName = function (label) {
    if (!label) return "";
    var specs = window.__agyProviderSpecs ? window.__agyProviderSpecs() : [];
    for (var i = 0; i < specs.length; i++) {
      if (specs[i].label === label) return specs[i].provider || specs[i].providerName || "";
    }
    var cfg = readPersisted();
    if (cfg && cfg.connections) {
      for (var ci = 0; ci < cfg.connections.length; ci++) {
        var conn = cfg.connections[ci];
        if (conn.selected && conn.selected.indexOf(label) >= 0) {
          var t = conn.type || "openai";
          return conn.name || (t === "openai" ? "OpenAI-compatible" : t === "anthropic" ? "Claude (Anthropic)" : "Gemini-compatible");
        }
      }
    }
    return "Custom";
  };
  // The core's gateway discovery returns the same provider models as native
  // options. Suppress exact duplicates only in this selector; keep all other
  // server-provided models and the original model/usage UI untouched.
  window.__agyFilterProviderDuplicates = function (status) {
    if (!status || !status.cascadeModelConfigData) return status;
    var specs = window.__agyProviderSpecs ? window.__agyProviderSpecs() : [];
    if (!specs.length) return status;
    var ids = new Set();
    specs.forEach(function (it) { ids.add(it.label); });
    var data = status.cascadeModelConfigData;
    return Object.assign({}, status, { cascadeModelConfigData: Object.assign({}, data, {
      clientModelConfigs: (data.clientModelConfigs || []).filter(function (m) { return !ids.has(m.label) && !ids.has(m.modelId); })
    }) });
  };
  window.__agySetCustomEffort = function (modelId, effort) {
    var cfg = readPersisted();
    if (!cfg || !cfg.connections) return;
    var changed = false;
    cfg.connections.forEach(function (c) {
      if ((c.selected || []).indexOf(modelId) < 0) return;
      c.modelMeta = c.modelMeta || {};
      c.modelMeta[modelId] = c.modelMeta[modelId] || {};
      if (effort) c.modelMeta[modelId].effort = effort;
      else delete c.modelMeta[modelId].effort;
      changed = true;
    });
    if (!changed) return;
    try { if (bridge) bridge.save(JSON.stringify(cfg)); else localStorage.setItem("agyProviders", JSON.stringify(cfg)); } catch (e) {}
    window.__agyRefreshProviderModels();
  };
  window.__agyRefreshProviderModels = function () {
    __agySpecCache = null;
    try { if (window.__agyBump) window.__agyBump(function (x) { return (x || 0) + 1; }); } catch (e) {}
  };

  var root = null, editing = null, fetchTimer = 0, fetchJob = null, fetchMsg = "", typeOpen = false;
  var threshOpen = false, recentOpen = false;
  var fetchListType = null, fetchFallbackTried = false;

  /* ---- sync selected provider models into the model selector (BYOM) ---- */
  function desiredModels() {
    var out = [], seen = {};
    if (!state.useProviders) return out;
    state.connections.forEach(function (c) {
      (c.selected || []).forEach(function (m) {
        if (!m || seen[m]) return;
        seen[m] = 1;
        out.push({ label: m, modelName: m });
      });
    });
    return out;
  }
  function syncModels() {
    if (window.__agyRefreshProviderModels) window.__agyRefreshProviderModels();
  }

  /* ---------------------------------------------------------- model listing
   * Returns {ids, meta}. meta[id] = {ctx, images, tools, thinking} inferred from
   * whatever the provider's /models endpoint reports (context window, modalities,
   * supported parameters). The user never types any of this; unknown fields fall
   * back to generous defaults so the model still works. */
  function arrHas(a, k) { return Array.isArray(a) && a.indexOf(k) >= 0; }
  // Documented capability snapshot: applies to all major model families
  // (Claude, Kimi, Gemini, GPT/o-series, DeepSeek, Qwen/QwQ, GLM, Llama, Mistral, Grok, MiniMax, MiMo)
  // as well as explicit tokens in model names (-128k, -vision, -thinking, etc.).
  function officialModelInfo(base, id) {
    id = String(id || "").trim();
    if (!id) return null;
    var lid = id.toLowerCase();
    var pureId = lid.indexOf("/") >= 0 ? lid.split("/").pop() : lid;

    // Extract explicit context size and modalities from model name if present
    var explicitCtx = 0;
    var kmatch = lid.match(/(?:^|[-_.])(\d+)[kK](?:[-_.]|$)/);
    if (kmatch) explicitCtx = parseInt(kmatch[1], 10) * 1024;
    var mmatch = lid.match(/(?:^|[-_.])(\d+)[mM](?:[-_.]|$)/);
    if (mmatch) explicitCtx = parseInt(mmatch[1], 10) * 1048576;

    var hasVision = /(?:^|[-_.])(vision|vl|4v|multimodal)(?:[-_.]|$)/.test(lid) || lid.indexOf("-v-") >= 0 || lid.endsWith("-v");
    var hasAudio = lid.indexOf("audio") >= 0;
    var hasVideo = lid.indexOf("video") >= 0;
    var hasThinking = /(?:^|[-_.])(thinking|reasoner|reasoning|thought|qwq|r1|zero)(?:[-_.]|$)/.test(lid);

    function has(term) { return pureId.indexOf(term) >= 0 || lid.indexOf(term) >= 0; }

    var res = null;

    // 1. Xiaomi MiMo official endpoints or model IDs
    if (has("mimo")) {
      res = {
        ctx: 1048576, maxOutput: 131072,
        inputModes: ["text", "image", "audio", "video"],
        reasoning: true, tools: true,
        source: "xiaomi-docs", verified: "2026-10-29",
        effort: "medium", efforts: ["low", "medium", "high"]
      };
    }
    // 2. Anthropic Claude models (claude-sonnet-5-5, claude-3-5-sonnet, claude-3-7-sonnet, claude-3-opus, claude-3-haiku, etc.)
    else if (has("claude") || has("sonnet") || has("haiku") || has("opus")) {
      var is1m = has("1m");
      var ctx = is1m ? 1000000 : (has("claude-2.0") || has("instant")) ? 100000 : 200000;
      var is37 = has("3-7") || has("3.7");
      var hasThink = is37 || hasThinking || has("sonnet-5") || has("sonnet-4");
      res = {
        ctx: ctx, maxOutput: (is37 || has("3-5") || has("3.5") || has("sonnet-5") || has("sonnet-4")) ? 8192 : 4096,
        inputModes: (has("claude-2") || has("instant")) ? ["text"] : ["text", "image"],
        reasoning: hasThink, tools: true,
        source: "anthropic-spec", verified: "2026",
        effort: hasThink ? "medium" : null,
        efforts: hasThink ? ["low", "medium", "high"] : null
      };
    }
    // 3. Moonshot Kimi models (kimi-k3.1-pro, kimi-k2.5, moonshot-v1-128k, etc.)
    else if (has("kimi") || has("moonshot")) {
      var kctx = 256000;
      if (has("128k")) kctx = 128000;
      else if (has("32k")) kctx = 32768;
      else if (has("8k")) kctx = 8192;
      res = {
        ctx: kctx, maxOutput: 8192,
        inputModes: ["text", "image"],
        reasoning: true, tools: true,
        source: "moonshot-spec", verified: "2026",
        effort: "medium", efforts: ["low", "medium", "high"]
      };
    }
    // 4. Google Gemini models (gemini-4-hydrogen, gemini-2.5-pro, gemini-2.0-flash, gemini-1.5-pro, etc.)
    else if (has("gemini") || has("hydrogen")) {
      var is2m = has("2.5-pro") || has("1.5-pro") || has("hydrogen");
      res = {
        ctx: is2m ? 2097152 : 1048576, maxOutput: 65536,
        inputModes: ["text", "image", "audio", "video"],
        reasoning: true, tools: true,
        source: "google-spec", verified: "2026",
        effort: "medium", efforts: ["low", "medium", "high"]
      };
    }
    // 5. OpenAI models (gpt-4o, gpt-4o-mini, gpt-4.5, o1, o3-mini, o4, o5)
    else if (has("openai") || has("gpt") || has("o1") || has("o3") || has("o4") || has("o5") || has("chatgpt")) {
      var isOseries = has("o1") || has("o3") || has("o4") || has("o5");
      var octx = 128000;
      if (isOseries) octx = 200000;
      else if (has("32k")) octx = 32768;
      else if (has("16k")) octx = 16384;
      else if (pureId === "gpt-4") octx = 8192;
      var omodes = isOseries ? ["text", "image"] : (has("4o") ? ["text", "image", "audio"] : (has("vision") || has("4-turbo") || has("4.5")) ? ["text", "image"] : ["text"]);
      res = {
        ctx: octx, maxOutput: isOseries ? 100000 : 16384,
        inputModes: omodes,
        reasoning: isOseries, tools: true,
        source: "openai-spec", verified: "2026",
        effort: isOseries ? "medium" : null,
        efforts: isOseries ? ["low", "medium", "high"] : null
      };
    }
    // 6. DeepSeek models (deepseek-chat, deepseek-reasoner, deepseek-v3, deepseek-r1)
    else if (has("deepseek") || has("r1")) {
      var isR1 = has("reasoner") || has("r1") || has("r-1");
      res = {
        ctx: has("128k") ? 131072 : 65536, maxOutput: 8192,
        inputModes: (hasVision || has("vl") || has("janus")) ? ["text", "image"] : ["text"],
        reasoning: isR1, tools: true,
        source: "deepseek-spec", verified: "2026",
        effort: isR1 ? "medium" : null,
        efforts: isR1 ? ["low", "medium", "high"] : null
      };
    }
    // 7. Alibaba Qwen & QwQ models (qwen-2.5, qwen-max, qwq-32b, qwen-vl)
    else if (has("qwen") || has("qwq")) {
      var isVl = hasVision || has("vl");
      var isQwQ = hasThinking || has("qwq");
      res = {
        ctx: has("turbo") ? 1000000 : 131072, maxOutput: 8192,
        inputModes: isVl ? ["text", "image", "video"] : ["text"],
        reasoning: isQwQ, tools: true,
        source: "qwen-spec", verified: "2026",
        effort: isQwQ ? "medium" : null,
        efforts: isQwQ ? ["low", "medium", "high"] : null
      };
    }
    // 8. Zhipu GLM models (glm-4, glm-4v, glm-zero-preview)
    else if (has("glm")) {
      var isGlmV = hasVision || has("4v");
      var isGlmZ = hasThinking || has("zero");
      res = {
        ctx: 131072, maxOutput: 8192,
        inputModes: isGlmV ? ["text", "image", "video"] : ["text"],
        reasoning: isGlmZ, tools: true,
        source: "glm-spec", verified: "2026",
        effort: isGlmZ ? "medium" : null,
        efforts: isGlmZ ? ["low", "medium", "high"] : null
      };
    }
    // 9. Meta Llama models (llama-3.3-70b, llama-3.1-405b, llama-3.2-11b-vision)
    else if (has("llama")) {
      var isLlamaVis = hasVision || has("vision") || (has("3.2") && (has("11b") || has("90b") || has("vis")));
      var lctx = (has("3.1") || has("3.2") || has("3.3")) ? 131072 : (has("llama-3") ? 8192 : 4096);
      res = {
        ctx: lctx, maxOutput: 8192,
        inputModes: isLlamaVis ? ["text", "image"] : ["text"],
        reasoning: hasThinking, tools: true,
        source: "meta-spec", verified: "2026",
        effort: hasThinking ? "medium" : null,
        efforts: hasThinking ? ["low", "medium", "high"] : null
      };
    }
    // 10. Mistral models (codestral, pixtral, mistral-large, mixtral)
    else if (has("mistral") || has("codestral") || has("pixtral") || has("mixtral")) {
      var isPix = hasVision || has("pixtral");
      var mctx = has("codestral") ? 256000 : (has("large") || isPix ? 131072 : (has("8x22b") ? 65536 : 32768));
      res = {
        ctx: mctx, maxOutput: 8192,
        inputModes: isPix ? ["text", "image"] : ["text"],
        reasoning: hasThinking, tools: true,
        source: "mistral-spec", verified: "2026",
        effort: hasThinking ? "medium" : null,
        efforts: hasThinking ? ["low", "medium", "high"] : null
      };
    }
    // 11. xAI Grok (grok-2, grok-2-vision, grok-beta, grok-3)
    else if (has("grok")) {
      var isGrokVis = hasVision || has("vision");
      res = {
        ctx: 131072, maxOutput: 8192,
        inputModes: isGrokVis ? ["text", "image"] : ["text"],
        reasoning: hasThinking, tools: true,
        source: "xai-spec", verified: "2026",
        effort: hasThinking ? "medium" : null,
        efforts: hasThinking ? ["low", "medium", "high"] : null
      };
    }
    // 12. MiniMax / Hailuo
    else if (has("minimax") || has("abab") || has("hailuo")) {
      res = {
        ctx: 1048576, maxOutput: 8192,
        inputModes: ["text", "image"],
        reasoning: hasThinking, tools: true,
        source: "minimax-spec", verified: "2026",
        effort: "medium", efforts: ["low", "medium", "high"]
      };
    }
    // 13. Generic model fallback
    else {
      var modesArr = ["text"];
      if (hasVision) modesArr.push("image");
      if (hasAudio) modesArr.push("audio");
      if (hasVideo) modesArr.push("video");
      if (modesArr.length === 1) modesArr.push("image");

      res = {
        ctx: explicitCtx || 131072,
        maxOutput: 8192,
        inputModes: modesArr,
        reasoning: hasThinking,
        tools: true,
        source: "auto-detected",
        verified: null,
        effort: hasThinking ? "medium" : null,
        efforts: hasThinking ? ["low", "medium", "high"] : null
      };
    }

    // If explicit context size was in the model name (e.g. -32k, -128k, -1m), respect it
    if (explicitCtx > 0) res.ctx = explicitCtx;
    if (hasVision && res.inputModes.indexOf("image") < 0) res.inputModes.push("image");
    if (hasAudio && res.inputModes.indexOf("audio") < 0) res.inputModes.push("audio");
    if (hasVideo && res.inputModes.indexOf("video") < 0) res.inputModes.push("video");

    return res;
  }
  window.AgyModelCatalog = officialModelInfo;

  function effectiveInfo(connection, id, stored) {
    var md = Object.assign({}, stored || {});
    var official = officialModelInfo((connection && connection.baseUrl) || typeOf(connection && connection.type).base, id);
    if (!official) {
      official = {
        ctx: 131072, maxOutput: 8192, inputModes: ["text", "image"],
        reasoning: false, tools: true, source: "auto-detected"
      };
    }

    // Upgrade old or incomplete saved entries in memory with rich detected capabilities.
    if (!Array.isArray(md.inputModes) || !md.inputModes.length) {
      md.inputModes = official.inputModes ? official.inputModes.slice() : ["text", "image"];
    }
    if (!(Number(md.reportedCtx) > 0)) md.reportedCtx = official.ctx || 131072;
    if (md.reasoningReported == null) md.reasoningReported = official.reasoning || false;
    if (md.toolsReported == null) md.toolsReported = official.tools !== false;
    if (!(Number(md.ctx) > 0)) md.ctx = md.reportedCtx;
    if (!md.factsSource) { md.factsSource = official.source || "auto-detected"; md.factsVerified = official.verified; }
    if (!Array.isArray(md.efforts) && Array.isArray(official.efforts)) md.efforts = official.efforts.slice();
    if (typeof md.effort !== "string" && official.effort) md.effort = official.effort;
    if (Number(official.maxOutput) > 0 && !(Number(md.reportedMaxOutput) > 0)) md.reportedMaxOutput = official.maxOutput;

    // Synchronize switches with detected model capability unless user explicitly toggled them
    var overrides = md.overrides && typeof md.overrides === "object" ? md.overrides : {};
    if (overrides.images === undefined) {
      if (typeof official.images === "boolean") md.images = official.images;
      else if (Array.isArray(md.inputModes)) md.images = md.inputModes.indexOf("image") >= 0;
    }
    if (overrides.tools === undefined && typeof official.tools === "boolean") {
      md.tools = official.tools;
    }
    if (overrides.thinking === undefined && typeof official.reasoning === "boolean") {
      md.thinking = official.reasoning;
    }
    return md;
  }
  function parseModels(type, body, baseUrl) {
    try {
      var o = JSON.parse(body), ids = [], meta = {};
      function put(id, ctx, images, tools, thinking, inputModes, knownReasoning, knownTools) {
        id = id && String(id).trim(); if (!id) return;
        var official = officialModelInfo(baseUrl, id);
        var modes = Array.isArray(inputModes) && inputModes.length ? inputModes.slice() : null;
        var apiCtx = Number(ctx) > 0 ? Number(ctx) : 0;
        if (!modes && official) modes = official.inputModes.slice();
        var reportedCtx = apiCtx || (official ? official.ctx : 0);
        var reason = typeof knownReasoning === "boolean" ? knownReasoning : (official ? official.reasoning : null);
        var functions = typeof knownTools === "boolean" ? knownTools : (official ? official.tools : null);
        ids.push(id);
        var isImg = modes ? modes.indexOf("image") >= 0 : (images !== false);
        meta[id] = {
          ctx: reportedCtx,
          images: isImg,
          tools: functions === null ? (tools !== false) : functions,
          thinking: reason === null ? (thinking !== false) : reason,
          inputModes: modes || (official ? official.inputModes.slice() : ["text"]),
          reportedCtx: reportedCtx || null,
          reasoningReported: reason !== null ? reason : (official ? official.reasoning : null),
          toolsReported: functions !== null ? functions : (official ? official.tools : true),
          reportedMaxOutput: official ? official.maxOutput : null,
          factsSource: (apiCtx || (inputModes && inputModes.length)) ? "provider-api" : (official ? official.source : "auto-detected"),
          factsVerified: official ? official.verified : null,
          effort: official ? official.effort : null,
          efforts: official ? official.efforts : null
        };
      }
      if (type === "gemini") {
        (o.models || []).forEach(function (m) {
          var id = String(m.name || "").replace(/^models\//, "");
          put(id, m.inputTokenLimit || 0, true, true, true);
        });
      } else if (type === "anthropic") {
        (o.data || o.models || []).forEach(function (m) {
          if (typeof m === "string") { put(m, 0, true, true, true); return; }
          put(m.id, m.context_window || 0, true, true, true);
        });
      } else {
        (o.data || o.models || []).forEach(function (m) {
          if (typeof m === "string") { put(m, 0, true, true, true); return; }
          var arch = m.architecture || {};
          var inMod = arch.input_modalities || arch.modality || m.input_modalities || m.modalities || [];
          var images = Array.isArray(inMod) ? inMod.indexOf("image") >= 0 : /image/.test(String(inMod));
          var sp = m.supported_parameters;
          var tools = Array.isArray(sp) ? (arrHas(sp, "tools") || arrHas(sp, "function_calling")) : (m.capabilities ? m.capabilities.tools !== false : true);
          var thinking = Array.isArray(sp) ? (arrHas(sp, "reasoning") || arrHas(sp, "include_reasoning") || arrHas(sp, "thinking")) : (m.capabilities ? m.capabilities.thinking === true : true);
          var ctx = m.context_length || m.context_window || m.max_context_length || m.max_context_tokens || m.max_tokens || m.input_token_limit || (m.top_provider && m.top_provider.context_length) || (m.limits && (m.limits.max_context_tokens || m.limits.max_prompt_tokens)) || 0;
          // When the provider gives no modality/param hints, default permissive.
          put(m.id, ctx, Array.isArray(inMod) && inMod.length ? images : true, tools, thinking, Array.isArray(inMod) ? inMod : null, Array.isArray(sp) ? thinking : null, Array.isArray(sp) ? tools : null);
        });
      }
      return { ids: ids, meta: meta };
    } catch (e) { return null; }
  }
  function normBase(base, type) {
    base = String(base || "").trim().replace(/\/+$/, "");
    // Anthropic-style bases are the API root (native/direct code appends /v1/…),
    // so a pasted trailing "/v1" would double up — strip it.
    if (type === "anthropic") base = base.replace(/\/v1$/, "");
    return base;
  }
  function cleanBody(b) {
    return String(b || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  }
  // Fallback for providers that implement the chat API but no model list
  // (e.g. MiMo's Anthropic-compatible endpoint returns 404 for /v1/models).
  // Try the OpenAI-style catalog on the same host (/v1/models), which such
  // providers usually do expose; manual model entry covers the rest.
  function tryFallback(conn) {
    if (fetchFallbackTried) return false;
    fetchFallbackTried = true;
    var base = normBase(conn.baseUrl || "", conn.type), fb;
    try {
      var u = new URL(base);
      if (!u.pathname || u.pathname === "/") return false;
      fb = u.origin + "/v1";
    } catch (e) { return false; }
    if (fb === base) return false;
    fetchMsg = T("Список моделей для этого API недоступен — пробую каталог того же сервера…",
                 "No model list for this API — trying the same server's catalog…");
    render();
    startFetch(conn, "openai", fb);
    return true;
  }
  function loadModels(conn) {
    fetchMsg = T("Загрузка списка моделей…", "Loading models…");
    render();
    fetchFallbackTried = false;
    startFetch(conn, conn.type, normBase(conn.baseUrl || typeOf(conn.type).base, conn.type));
  }
  function startFetch(conn, listType, base) {
    fetchListType = listType;
    if (bridge && typeof bridge.fetchModels === "function") {
      var id;
      try { id = bridge.fetchModels(listType, base, conn.apiKey || "", JSON.stringify(conn.headers || {})); } catch (e) { fetchMsg = "ERR:" + e; render(); return; }
      fetchJob = id;
      pollFetch(conn);
    } else {
      // No native bridge: try a direct fetch (may be blocked by provider CORS).
      directFetch(conn, listType, base);
    }
  }
  function pollFetch(conn) {
    clearTimeout(fetchTimer);
    if (!fetchJob) return;
    var r = {};
    try { r = JSON.parse(bridge.readFetch(fetchJob) || "{}"); } catch (e) {}
    if (!r.done) { fetchTimer = setTimeout(function () { pollFetch(conn); }, 500); return; }
    fetchJob = null;
    applyModels(conn, parseInt(r.status, 10) || 0, r.body || "");
  }
  function directFetch(conn, listType, base) {
    var url, headers = { "Accept": "application/json" };
    if (listType === "gemini") url = base + "/models?key=" + encodeURIComponent(conn.apiKey || "");
    else if (listType === "anthropic") { url = base + "/v1/models"; headers["x-api-key"] = conn.apiKey || ""; headers["anthropic-version"] = "2023-06-01"; headers["anthropic-dangerous-direct-browser-access"] = "true"; }
    else { url = base + "/models"; headers["Authorization"] = "Bearer " + (conn.apiKey || ""); }
    Object.keys(conn.headers || {}).forEach(function (k) { headers[k] = conn.headers[k]; });
    fetch(url, { headers: headers }).then(function (res) {
      return res.text().then(function (b) { applyModels(conn, res.status, b); });
    }).catch(function (e) {
      if (tryFallback(conn)) return;
      applyModels(conn, 0, "ERR:" + e + T(" (возможно, провайдер блокирует запрос из приложения — нужен нативный мост)", " (the provider may block in-app requests — native bridge needed)"));
    });
  }
  function applyModels(conn, status, body) {
    if (status < 200 || status >= 400) {
      if (tryFallback(conn)) return;
      fetchMsg = T("Ошибка ", "Error ") + (status || "") + ": " + cleanBody(body) +
        T(". Если список моделей недоступен — добавьте модели вручную в поле ниже.",
          ". If the model list is unavailable, add models manually below.");
      render(); return;
    }
    var parsed = parseModels(fetchListType || conn.type, body, conn.baseUrl || typeOf(conn.type).base);
    if (!parsed || !parsed.ids.length) {
      if (tryFallback(conn)) return;
      fetchMsg = T("Список моделей пуст или не распознан.", "No models returned or response not recognized."); render(); return;
    }
    conn.models = parsed.ids;
    // Keep explicit user overrides when the provider catalog is refreshed.
    Object.keys(parsed.meta).forEach(function (id) {
      var old = conn.modelMeta && conn.modelMeta[id];
      if (!old) return;
      // Older versions did not distinguish defaults from manual edits. Preserve
      // their existing toggles as-is instead of silently changing user settings.
      var overrides = old.overrides || {};
      ["images", "tools", "thinking"].forEach(function (k) {
        if (typeof overrides[k] === "boolean") parsed.meta[id][k] = overrides[k];
        else if (!old.overrides && typeof old[k] === "boolean") parsed.meta[id][k] = old[k];
      });
      if (old.overrides) parsed.meta[id].overrides = overrides;
      if (typeof old.effort === "string" && old.effort) parsed.meta[id].effort = old.effort;
      if (Array.isArray(old.efforts) && old.efforts.length) parsed.meta[id].efforts = old.efforts.slice();
    });
    conn.modelMeta = parsed.meta;
    if (!conn.selected) conn.selected = [];
    save();
    fetchMsg = T("Загружено моделей: ", "Loaded models: ") + parsed.ids.length +
      (fetchListType && fetchListType !== conn.type ?
        T(" (через OpenAI-совместимый каталог того же сервера)", " (via the same server's OpenAI-compatible catalog)") : "");
    render();
  }

  /* ---------------------------------------------------------- render */
  function saveScroll() {
    var scrollers = [];
    var curr = root;
    while (curr) {
      if (curr.scrollTop > 0) scrollers.push({ el: curr, top: curr.scrollTop });
      curr = curr.parentElement;
    }
    var winY = window.scrollY || window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
    return { scrollers: scrollers, winY: winY };
  }
  function restoreScroll(saved) {
    if (!saved) return;
    (saved.scrollers || []).forEach(function (s) {
      if (s.el && s.el.scrollTop !== s.top) s.el.scrollTop = s.top;
    });
    if (saved.winY > 0) window.scrollTo(0, saved.winY);
  }

  function render() {
    if (!root || !root.isConnected) return;
    var savedScroll = saveScroll();
    var h = '<div class="agy-pv-head"><div class="agy-pv-title">' + esc(T("Провайдеры", "Providers")) + "</div>" +
      '<div class="agy-pv-sub">' + esc(T("Подключение сторонних моделей по API: Claude-, OpenAI- и Gemini-совместимые. Работает как режим: включите — работают ваши провайдеры, выключите — стандартные модели Google (ограничение ядра: одновременно нельзя).", "Connect third-party models by API: Claude-, OpenAI- and Gemini-compatible. Works as a mode: on = your providers, off = the standard Google models (the core can't do both at once).")) + "</div></div>";
    if (!bridge) h += '<div class="agy-pv-warn">' + esc(T("Нативный мост недоступен — ключи хранятся только в этой сессии, загрузка моделей может блокироваться провайдером.", "Native bridge unavailable — keys are kept only in this session and model loading may be blocked by the provider.")) + "</div>";

    if (restarting) h += '<div class="agy-pv-status">' + esc(T("Ядро перезапускается, чтобы применить изменения… (несколько секунд)", "Restarting the core to apply changes… (a few seconds)")) + "</div>";

    if (editing) {
      h += form(editing);
      root.innerHTML = h;
      restoreScroll(savedScroll);
      requestAnimationFrame(function () { restoreScroll(savedScroll); });
      return;
    }

    var anySelected = state.connections.some(function (c) { return (c.selected || []).length; });
    h += '<label class="agy-pv-switch"><span>' + esc(T("Режим провайдеров", "Providers mode")) +
      '<small>' + esc(T("Вкл — работают ваши провайдеры (стандартные модели Google при этом скрываются). Выкл — стандартные модели. При переключении ядро перезапускается само.", "On — your providers work (standard Google models are hidden). Off — the standard models. The core restarts automatically on switch.")) + "</small></span>" +
      '<input type="checkbox" data-master="1"' + (state.useProviders ? " checked" : "") + (anySelected ? "" : " disabled") + "></label>";

    if (state.useProviders && anySelected) {
      h += '<div class="agy-pv-note">' + esc(T("Выбранные модели — в селекторе чата, раздел «Пользовательский» (вместе с режимом рассуждения). Если изменили провайдера или модели — нажмите «Применить», чтобы ядро перечитало настройки.", "The selected models are in the chat model selector, \"Custom\" section (with the reasoning mode). If you changed a provider or models, tap \"Apply\" so the core re-reads the settings.")) + "</div>";
      h += '<div class="agy-pv-row"><button type="button" class="agy-pv-btn sec" data-act="restart">' + esc(T("Применить (перезапустить ядро)", "Apply (restart core)")) + "</button></div>";
    }

    var compOn = state.compactHistory !== false;
    var THRESH_OPTIONS = [
      { val: 12, ru: "12 сообщений", en: "12 messages" },
      { val: 16, ru: "16 сообщений", en: "16 messages", subRu: "рекомендуется", subEn: "recommended" },
      { val: 24, ru: "24 сообщения", en: "24 messages" },
      { val: 32, ru: "32 сообщения", en: "32 messages" }
    ];
    var RECENT_OPTIONS = [
      { val: 4, ru: "4 сообщения", en: "4 messages" },
      { val: 6, ru: "6 сообщений", en: "6 messages" },
      { val: 8, ru: "8 сообщений", en: "8 messages", subRu: "рекомендуется", subEn: "recommended" },
      { val: 10, ru: "10 сообщений", en: "10 messages" },
      { val: 12, ru: "12 сообщений", en: "12 messages" }
    ];

    var threshList = '<div class="agy-compact-ddlist-title">' + esc(T("Порог сжатия", "Threshold")) + '</div>' +
      THRESH_OPTIONS.map(function (opt) {
        var isSel = state.compactThreshold === opt.val;
        return '<div class="agy-pv-opt' + (isSel ? " sel" : "") + '" data-thresh-pick="' + opt.val + '">' +
          '<div class="agy-pv-opt-txt">' +
            '<span>' + esc(T(opt.ru, opt.en)) + '</span>' +
            (opt.subRu ? '<small class="agy-pv-opt-sub">' + esc(T(opt.subRu, opt.subEn)) + '</small>' : '') +
          '</div>' +
          (isSel ? '<span class="agy-pv-ok">✓</span>' : "") +
          '</div>';
      }).join("");

    var recentList = '<div class="agy-compact-ddlist-title">' + esc(T("Окно свежих", "Recent window")) + '</div>' +
      RECENT_OPTIONS.map(function (opt) {
        var isSel = state.compactKeepRecent === opt.val;
        return '<div class="agy-pv-opt' + (isSel ? " sel" : "") + '" data-recent-pick="' + opt.val + '">' +
          '<div class="agy-pv-opt-txt">' +
            '<span>' + esc(T(opt.ru, opt.en)) + '</span>' +
            (opt.subRu ? '<small class="agy-pv-opt-sub">' + esc(T(opt.subRu, opt.subEn)) + '</small>' : '') +
          '</div>' +
          (isSel ? '<span class="agy-pv-ok">✓</span>' : "") +
          '</div>';
      }).join("");

    h += '<div class="agy-pv-card agy-pv-compactor-card">' +
      '<div class="agy-pv-compactor-header">' +
        '<div class="agy-pv-name">' + esc(T("Оптимизация контекста чата", "Chat Context Optimization")) + '</div>' +
        '<label class="agy-pv-compactor-toggle">' +
          '<span class="agy-pv-compactor-toggle-lbl">' + esc(compOn ? T("Вкл", "On") : T("Выкл", "Off")) + '</span>' +
          '<input type="checkbox" data-compact="1"' + (compOn ? " checked" : "") + '>' +
        '</label>' +
      '</div>' +
      '<div class="agy-pv-compactor-body">' +
        '<div class="agy-pv-meta agy-pv-compactor-text">' +
          esc(T("Авто-сжатие диалогов сворачивает старые сообщения и тяжелые логи инструментов в компактное резюме, передавая модели только свежие реплики. Экономит до 90% лимита токенов и защищает от сбоев.",
                "Auto-compaction summarizes older messages and heavy tool logs into a concise checkpoint, passing only recent turns to the model. Saves up to 90% token quota and prevents context limit crashes.")) +
        '</div>' +
        (compOn ? (
          '<div class="agy-compact-btns">' +
            '<div class="agy-compact-dd' + (threshOpen ? " open" : "") + '">' +
              '<button type="button" class="agy-pv-btn sec agy-compact-btn" data-toggle-thresh="1" title="' + esc(T("Порог сжатия истории", "Compaction threshold")) + '">' +
                '<span>' + esc(T("Порог: ", "Threshold: ")) + '<b>' + state.compactThreshold + '</b></span>' +
                '<span class="agy-pv-ddcar">▾</span>' +
              '</button>' +
              (threshOpen ? '<div class="agy-pv-ddlist agy-compact-ddlist">' + threshList + '</div>' : "") +
            '</div>' +
            '<div class="agy-compact-dd' + (recentOpen ? " open" : "") + '">' +
              '<button type="button" class="agy-pv-btn sec agy-compact-btn" data-toggle-recent="1" title="' + esc(T("Окно свежих реплик", "Recent messages window")) + '">' +
                '<span>' + esc(T("Окно: ", "Window: ")) + '<b>' + state.compactKeepRecent + '</b></span>' +
                '<span class="agy-pv-ddcar">▾</span>' +
              '</button>' +
              (recentOpen ? '<div class="agy-pv-ddlist agy-compact-ddlist">' + recentList + '</div>' : "") +
            '</div>' +
          '</div>'
        ) : "") +
      '</div>' +
    '</div>';

    if (!state.connections.length) h += '<div class="agy-pv-empty">' + esc(T("Подключений пока нет.", "No connections yet.")) + "</div>";
    state.connections.forEach(function (c) {
      var ty = typeOf(c.type);
      var sel = (c.selected || []).length, tot = (c.models || []).length;
      h += '<div class="agy-pv-card"><div class="agy-pv-main">' +
        '<div class="agy-pv-name">' + esc(c.name || ty.ru) + ' <span class="agy-pv-tag">' + esc(T(ty.ru, ty.en)) + "</span></div>" +
        '<div class="agy-pv-meta">' + esc(c.baseUrl || ty.base) + "</div>" +
        '<div class="agy-pv-meta">' + esc(c.apiKey ? T("Ключ: ••••", "Key: ••••") + String(c.apiKey).slice(-4) : T("Ключ не задан", "No key")) +
        (tot ? " · " + esc(T("моделей: ", "models: ") + sel + "/" + tot) : "") + "</div></div>" +
        '<div class="agy-pv-btns"><button type="button" class="agy-pv-btn sec" data-edit="' + c.id + '">' + esc(T("Изменить", "Edit")) + "</button></div></div>";
      if (sel) {
        h += '<details class="agy-pv-model-info"><summary>' + esc(T("Добавленные модели", "Added models")) + ' (' + sel + ')</summary>';
        (c.selected || []).forEach(function (id) {
          var md = effectiveInfo(c, id, c.modelMeta && c.modelMeta[id]);
          var modes = Array.isArray(md.inputModes) && md.inputModes.length ? md.inputModes : ["text", "image"];
          var context = (Number(md.reportedCtx) > 0 ? Number(md.reportedCtx).toLocaleString() : "131 072") + ' ' + T("токенов", "tokens");
          var maxOut = (Number(md.reportedMaxOutput) > 0 ? Number(md.reportedMaxOutput).toLocaleString() : "8 192") + ' ' + T("токенов", "tokens");
          var modeNames = [];
          if (modes.indexOf("text") >= 0) modeNames.push(T("текст", "text"));
          if (modes.indexOf("image") >= 0) modeNames.push(T("картинки", "images"));
          if (modes.indexOf("audio") >= 0) modeNames.push(T("аудио", "audio"));
          if (modes.indexOf("video") >= 0) modeNames.push(T("видео", "video"));
          var modesStr = modeNames.join(", ");

          var capsArr = [];
          if (md.reasoningReported) capsArr.push("reasoning (" + T("рассуждения", "thinking") + ")");
          if (md.toolsReported !== false) capsArr.push(T("инструменты", "tools"));
          var capsStr = capsArr.length ? capsArr.join(", ") : T("стандартные", "standard");

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
          var source = srcMap[md.factsSource] || (md.factsSource ? md.factsSource : T("каталог характеристик моделей", "model capability catalog"));
          var cfgArr = [];
          cfgArr.push(T("картинки: ", "images: ") + (md.images !== false ? T("вкл", "on") : T("выкл", "off")));
          cfgArr.push("reasoning: " + (md.thinking !== false ? T("вкл", "on") : T("выкл", "off")));
          var cfgStr = cfgArr.join(" · ");
          var effStr = (typeof md.effort === "string" && md.effort ? md.effort : T("авто", "auto")) + (Array.isArray(md.efforts) && md.efforts.length ? ' (' + md.efforts.join(", ") + ')' : '');

          h += '<div class="agy-pv-model-info-row">' +
            '<div class="agy-pv-info-head">' +
              '<div class="agy-pv-name">' + esc(id) + '</div>' +
              '<span class="agy-pv-badge ok">' + esc(context) + '</span>' +
            '</div>' +
            '<div class="agy-pv-info-grid">' +
              '<div class="agy-pv-info-item"><span class="agy-pv-lbl">' + esc(T("Входные модальности:", "Input modalities:")) + '</span>' + esc(modesStr) + '</div>' +
              '<div class="agy-pv-info-item"><span class="agy-pv-lbl">' + esc(T("Макс. вывод:", "Max output:")) + '</span>' + esc(maxOut) + '</div>' +
              '<div class="agy-pv-info-item"><span class="agy-pv-lbl">' + esc(T("Возможности:", "Capabilities:")) + '</span>' + esc(capsStr) + '</div>' +
              '<div class="agy-pv-info-item"><span class="agy-pv-lbl">' + esc(T("Мышление:", "Effort:")) + '</span>' + esc(effStr) + '</div>' +
              '<div class="agy-pv-info-item"><span class="agy-pv-lbl">' + esc(T("Источник:", "Source:")) + '</span>' + esc(source + (md.factsVerified ? ' · ' + md.factsVerified : '')) + '</div>' +
              '<div class="agy-pv-info-item"><span class="agy-pv-lbl">' + esc(T("В настройках:", "Configured:")) + '</span>' + esc(cfgStr) + '</div>' +
            '</div>' +
          '</div>';
        });
        h += '<div class="agy-pv-meta" style="margin-top:6px;">' + esc(T("Это возможности модели. Поддержка каждого типа вложений приложением проверяется отдельно.", "These are model capabilities. App support for each attachment type is separate.")) + '</div></details>';
      }

    });
    h += '<div class="agy-pv-bar"><button type="button" class="agy-pv-btn" data-add="1">' + esc(T("Добавить подключение", "Add connection")) + "</button></div>";
    root.innerHTML = h;
    restoreScroll(savedScroll);
    requestAnimationFrame(function () { restoreScroll(savedScroll); });
  }

  function form(c) {
    var ty = typeOf(c.type);
    // Custom styled dropdown for the API type (the native <select> popup renders
    // as an unstyled black system menu on this WebView).
    var opts = TYPES.map(function (t) {
      return '<div class="agy-pv-opt' + (c.type === t.id ? " sel" : "") + '" data-typepick="' + t.id + '">' +
        esc(T(t.ru, t.en)) + (c.type === t.id ? '<span class="agy-pv-ok">✓</span>' : "") + "</div>";
    }).join("");
    var h = '<div class="agy-pv-form">' +
      '<label class="agy-pv-field"><span>' + esc(T("Тип API", "API type")) + "</span>" +
      '<div class="agy-pv-dd' + (typeOpen ? " open" : "") + '">' +
        '<button type="button" class="agy-pv-ddbtn" data-typetoggle="1">' +
          '<span>' + esc(T(ty.ru, ty.en)) + '</span><span class="agy-pv-ddcar">▾</span></button>' +
        (typeOpen ? '<div class="agy-pv-ddlist">' + opts + "</div>" : "") +
      "</div></label>" +
      '<div class="agy-pv-hint">' + esc(ty.hint) + "</div>" +
      '<label class="agy-pv-field"><span>' + esc(T("Название", "Name")) + '</span><input data-f="name" value="' + esc(c.name || "") + '" placeholder="' + esc(T("Например, Мой Claude", "e.g. My Claude")) + '"></label>' +
      '<label class="agy-pv-field"><span>Base URL</span><input data-f="baseUrl" value="' + esc(c.baseUrl || "") + '" placeholder="' + esc(ty.base) + '" autocapitalize="off" autocorrect="off" spellcheck="false"></label>' +
      '<label class="agy-pv-field"><span>' + esc(T("API-ключ", "API key")) + '</span><input data-f="apiKey" type="password" value="' + esc(c.apiKey || "") + '" placeholder="sk-…" autocapitalize="off" autocorrect="off" spellcheck="false"></label>' +
      '<div class="agy-pv-row"><button type="button" class="agy-pv-btn" data-act="loadmodels">' + esc(T("Загрузить модели", "Load models")) + "</button>" +
      '<button type="button" class="agy-pv-btn sec" data-act="save">' + esc(T("Сохранить", "Save")) + "</button>" +
      '<button type="button" class="agy-pv-btn sec" data-act="cancel">' + esc(T("Отмена", "Cancel")) + "</button></div>";
    if (fetchMsg) h += '<div class="agy-pv-status">' + esc(fetchMsg) + "</div>";
    if ((c.models || []).length) {
      h += '<div class="agy-pv-models">';
      c.models.forEach(function (m) {
        var on = (c.selected || []).indexOf(m) >= 0;
        var md = effectiveInfo(c, m, (c.modelMeta && c.modelMeta[m]) || {});
        var imgOn = md.images !== false, toolsOn = md.tools !== false, thinkOn = md.thinking !== false;
        var ctx = md.ctx && md.ctx > 0 ? md.ctx : (md.reportedCtx || 0);
        var ctxLbl = ctx ? (ctx >= 1000 ? Math.round(ctx / 1000) + "k" : "" + ctx) : "";
        var effCur = typeof md.effort === "string" ? md.effort : "";
        var effList = Array.isArray(md.efforts) ? md.efforts.join(", ") : "";

        h += '<div class="agy-pv-model-card" data-card-model="' + esc(m) + '">' +
          '<div class="agy-pv-model">' +
            '<label class="agy-pv-sel"><input type="checkbox" data-model="' + esc(m) + '"' + (on ? " checked" : "") + "> <span>" + esc(m) + "</span></label>" +
            '<div class="agy-pv-model-right">' +
              (ctxLbl ? '<span class="agy-pv-badge" title="' + esc(T("Контекст модели", "Model context window")) + '">' + esc(ctxLbl) + "</span>" : "") +
              '<button type="button" class="agy-pv-btn-del" data-delmodel="' + esc(m) + '" title="' + esc(T("Убрать модель", "Remove model")) + '">✕</button>' +
            '</div>' +
          '</div>' +
          '<div class="agy-pv-caps-wrap" style="display:' + (on ? "flex" : "none") + ';">' +
            '<div class="agy-pv-caps">' +
              capChip("img", m, imgOn, T("картинки", "images"), T("Модель видит изображения", "Model sees images")) +
              capChip("tools", m, toolsOn, T("инструменты", "tools"), T("Вызовы инструментов / функций", "Tool / function calls")) +
              capChip("think", m, thinkOn, "reasoning", T("Режим рассуждений", "Reasoning mode")) +
            '</div>' +
            '<div class="agy-pv-eff-row">' +
              '<span class="agy-pv-eff-lbl">' + esc(T("Мышление:", "Effort:")) + '</span>' +
              '<select class="agy-pv-eff-sel" data-effort="' + esc(m) + '">' +
                '<option value=""' + (effCur === "" ? " selected" : "") + '>' + esc(T("авто", "auto")) + '</option>' +
                ["low", "medium", "high", "xhigh", "max"].map(function (lv) { return '<option value="' + lv + '"' + (effCur === lv ? " selected" : "") + '>' + lv + '</option>'; }).join("") +
              '</select>' +
              '<input class="agy-pv-eff-inp" data-efforts="' + esc(m) + '" value="' + esc(effList) + '" placeholder="' + esc(T("уровни: low, medium, high", "levels: low, medium, high")) + '" autocapitalize="off" autocorrect="off" spellcheck="false" title="' + esc(T("Уровни рассуждения провайдера через запятую", "Provider reasoning levels comma-separated")) + '">' +
            '</div>' +
          '</div>' +
        '</div>';
      });
      h += '</div>' +
        '<div class="agy-pv-hint" style="margin-top:4px;">' + esc(T("Уровни рассуждения подставляются шлюзом для моделей с включенным reasoning. Если провайдер их не заявил, оставьте поле пустым.", "Reasoning effort levels are forwarded by the gateway when reasoning is enabled. Leave empty if unstated by provider.")) + '</div>';
    }
    h += '<div class="agy-pv-hint">' + esc(T("Если провайдер не отдаёт список моделей — добавьте ID вручную (например, mimo-v2.6-pro).", "If the provider has no model list, add model IDs manually (e.g. mimo-v2.6-pro).")) + "</div>" +
      '<div class="agy-pv-row"><input data-manual="1" placeholder="' + esc(T("ID модели", "Model ID")) + '" autocapitalize="off" autocorrect="off" spellcheck="false">' +
      '<button type="button" class="agy-pv-btn sec" data-act="addmodel">' + esc(T("Добавить", "Add")) + "</button></div>";
    if (!c.__new) h += '<div class="agy-pv-row"><button type="button" class="agy-pv-btn danger" data-act="delete">' + esc(T("Удалить подключение", "Delete connection")) + "</button></div>";
    return h + "</div>";
  }

  function readForm() {
    if (!editing) return;
    root.querySelectorAll("[data-f]").forEach(function (el) {
      var k = el.getAttribute("data-f");
      editing[k] = el.value;
    });
  }

  function onInput(e) {
    var el = e.target;
    if (el.matches && el.matches("select[data-f='type']")) { readForm(); render(); }
  }
  function onChange(e) {
    var el = e.target;
    if (el.matches && el.matches("input[data-master]")) {
      state.useProviders = el.checked;
      save(); syncModels(); applyRestart(); render(); return;
    }
    if (el.matches && el.matches("input[data-compact]")) {
      state.compactHistory = el.checked;
      threshOpen = false;
      recentOpen = false;
      save(); render(); return;
    }
    if (el.matches && el.matches("input[data-model]")) {
      if (!editing) return;
      var m = el.getAttribute("data-model");
      editing.selected = editing.selected || [];
      var i = editing.selected.indexOf(m);
      if (el.checked && i < 0) editing.selected.push(m);
      else if (!el.checked && i >= 0) editing.selected.splice(i, 1);
      if ((editing.selected || []).length) state.useProviders = true;
      // Mirror the live edit into the stored connection so the selector picks it
      // up immediately (the Save button also persists it for new connections).
      var j = state.connections.map(function (cc) { return cc.id; }).indexOf(editing.id);
      if (j >= 0) state.connections[j] = JSON.parse(JSON.stringify(editing));
      save(); syncModels();
      var card = el.closest ? el.closest(".agy-pv-model-card") : null;
      if (card) {
        var wrap = card.querySelector(".agy-pv-caps-wrap");
        if (wrap) wrap.style.display = el.checked ? "flex" : "none";
      }
      return;
    }
    if (el.matches && el.matches("select[data-effort]")) {
      if (!editing) return;
      var em = el.getAttribute("data-effort");
      editing.modelMeta = editing.modelMeta || {};
      editing.modelMeta[em] = editing.modelMeta[em] || {};
      if (el.value) editing.modelMeta[em].effort = el.value; else delete editing.modelMeta[em].effort;
      var ej = state.connections.map(function (cc) { return cc.id; }).indexOf(editing.id);
      if (ej >= 0) state.connections[ej] = JSON.parse(JSON.stringify(editing));
      save(); syncModels(); return;
    }
    if (el.matches && el.matches("input[data-efforts]")) {
      if (!editing) return;
      var fm = el.getAttribute("data-efforts");
      editing.modelMeta = editing.modelMeta || {};
      editing.modelMeta[fm] = editing.modelMeta[fm] || {};
      var list = el.value.split(",").map(function (s) { return s.trim(); }).filter(function (s) { return !!s; });
      if (list.length) editing.modelMeta[fm].efforts = list; else delete editing.modelMeta[fm].efforts;
      var fj = state.connections.map(function (cc) { return cc.id; }).indexOf(editing.id);
      if (fj >= 0) state.connections[fj] = JSON.parse(JSON.stringify(editing));
      save(); syncModels(); return;
    }
    if (el.matches && el.matches("input[data-cap]")) {
      if (!editing) return;
      var im = el.getAttribute("data-capm");
      var kind = el.getAttribute("data-cap");             // img | tools | think
      var field = kind === "img" ? "images" : kind === "tools" ? "tools" : "thinking";
      editing.modelMeta = editing.modelMeta || {};
      editing.modelMeta[im] = editing.modelMeta[im] || {};
      editing.modelMeta[im][field] = el.checked;
      editing.modelMeta[im].overrides = editing.modelMeta[im].overrides || {};
      editing.modelMeta[im].overrides[field] = el.checked;
      var jj = state.connections.map(function (cc) { return cc.id; }).indexOf(editing.id);
      if (jj >= 0) state.connections[jj] = JSON.parse(JSON.stringify(editing));
      save(); syncModels();
      var capLbl = el.closest ? el.closest(".agy-pv-cap") : null;
      if (capLbl) {
        if (el.checked) capLbl.classList.add("on");
        else capLbl.classList.remove("on");
      }
      return;
    }
  }
  function onClick(e) {
    // Custom compactor dropdown picks
    var tpick = e.target.closest ? e.target.closest("[data-thresh-pick]") : null;
    if (tpick) {
      state.compactThreshold = parseInt(tpick.getAttribute("data-thresh-pick"), 10) || 16;
      threshOpen = false;
      save();
      render();
      return;
    }
    var rpick = e.target.closest ? e.target.closest("[data-recent-pick]") : null;
    if (rpick) {
      state.compactKeepRecent = parseInt(rpick.getAttribute("data-recent-pick"), 10) || 8;
      recentOpen = false;
      save();
      render();
      return;
    }

    // Custom API-type dropdown (option rows are <div>, not buttons).
    var tp = e.target.closest ? e.target.closest("[data-typepick]") : null;
    if (tp && editing) { readForm(); editing.type = tp.getAttribute("data-typepick"); typeOpen = false; render(); return; }

    var b = e.target.closest("button");
    if (!b) {
      if (threshOpen || recentOpen) {
        threshOpen = false;
        recentOpen = false;
        render();
      }
      return;
    }
    if (b.getAttribute("data-toggle-thresh")) {
      threshOpen = !threshOpen;
      recentOpen = false;
      render();
      return;
    }
    if (b.getAttribute("data-toggle-recent")) {
      recentOpen = !recentOpen;
      threshOpen = false;
      render();
      return;
    }
    if (threshOpen || recentOpen) {
      threshOpen = false;
      recentOpen = false;
    }
    if (b.getAttribute("data-typetoggle")) { readForm(); typeOpen = !typeOpen; render(); return; }
    if (b.getAttribute("data-add")) { editing = { id: uid(), type: "openai", __new: true, selected: [] }; fetchMsg = ""; typeOpen = false; render(); return; }
    var dm = b.getAttribute("data-delmodel");
    if (dm && editing) {
      editing.models = (editing.models || []).filter(function (x) { return x !== dm; });
      editing.selected = (editing.selected || []).filter(function (x) { return x !== dm; });
      if (editing.modelMeta) delete editing.modelMeta[dm];
      var j = state.connections.map(function (cc) { return cc.id; }).indexOf(editing.id);
      if (j >= 0) state.connections[j] = JSON.parse(JSON.stringify(editing));
      save(); syncModels();
      var card = b.closest ? b.closest(".agy-pv-model-card") : null;
      if (card && card.parentNode) {
        card.parentNode.removeChild(card);
      } else {
        render();
      }
      return;
    }
    var ed = b.getAttribute("data-edit");
    if (ed) { editing = JSON.parse(JSON.stringify(state.connections.filter(function (c) { return c.id === ed; })[0])); fetchMsg = ""; render(); return; }
    var act = b.getAttribute("data-act");
    if (!act) return;
    readForm();
    if (act === "cancel") { editing = null; fetchMsg = ""; render(); }
    else if (act === "loadmodels") { loadModels(editing); }
    else if (act === "addmodel") {
      var inp = root.querySelector("[data-manual]");
      var mid = ((inp && inp.value) || "").trim();
      if (mid && editing) {
        editing.models = editing.models || [];
        if (editing.models.indexOf(mid) < 0) {
          editing.models.push(mid);
          editing.modelMeta = editing.modelMeta || {};
          var detected = effectiveInfo(editing, mid, {});
          editing.modelMeta[mid] = detected;
          fetchMsg = T("Добавлена модель: ", "Model added: ") + mid;
        }
        if (inp) inp.value = "";
      }
      render();
    }
    else if (act === "save") {
      editing.baseUrl = normBase(editing.baseUrl, editing.type);
      delete editing.__new;
      editing.models = editing.models || [];
      editing.modelMeta = editing.modelMeta || {};
      editing.models.forEach(function (m) {
        editing.modelMeta[m] = effectiveInfo(editing, m, editing.modelMeta[m]);
      });
      var i = state.connections.map(function (c) { return c.id; }).indexOf(editing.id);
      if (i >= 0) state.connections[i] = editing; else state.connections.push(editing);
      if ((editing.selected || []).length) state.useProviders = true;
      save(); syncModels(); editing = null; fetchMsg = "";
      if (state.useProviders) applyRestart(T("ваши модели", "your models"));
      render();
    } else if (act === "delete") {
      state.connections = state.connections.filter(function (c) { return c.id !== editing.id; });
      save(); syncModels(); editing = null; fetchMsg = "";
      if (state.useProviders) applyRestart(T("ваши модели", "your models"));
      render();
    } else if (act === "restart") {
      applyRestart(T("ваши модели", "your models")); render();
    }
  }

  /* ---- Quick toggle from chat header (...) -------------------------------- */
  function showToast(msg, isWarn) {
    try {
      var old = document.getElementById("agy-toast-msg");
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var t = document.createElement("div");
      t.id = "agy-toast-msg";
      t.style.cssText = "position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
        "background:" + (isWarn ? "rgba(220,53,69,0.92)" : "rgba(30,30,30,0.95)") + ";" +
        "color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:500;" +
        "box-shadow:0 8px 32px rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.15);" +
        "display:flex;align-items:center;gap:8px;pointer-events:none;transition:opacity .3s ease;white-space:nowrap";
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function () {
        t.style.opacity = "0";
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 350);
      }, 3500);
    } catch (_) {}
  }

  window.__agyIsProvidersMode = function () {
    load();
    return !!state.useProviders;
  };

  window.__agyProviderIcon = function () {
    load();
    /* "tune" (ползунки настроек) входит в бандленный набор Material Symbols
       и идеально подходит под стилистику меню, заменяя пятилистник "hub". */
    return state.useProviders ? "tune" : "smart_toy";
  };

  window.__agyProviderTooltip = function () {
    load();
    // Баг 2: короткие метки — длинные делали dropdown слишком широким
    if (state.useProviders) {
      return T("Пользовательские", "Custom");
    }
    return T("Google Gemini", "Google Gemini");
  };

  window.__agyToggleProviders = function () {
    load();
    var anySelected = state.connections.some(function (c) { return (c.selected || []).length; });
    if (!state.useProviders && !anySelected) {
      showToast(T("Сначала настройте провайдера и выберите модель в Настройки › Провайдеры",
                  "Configure a provider and select a model in Settings › Providers first"), true);
      return;
    }

    // Баг 1 + 3 + 6: сохраняем маршрут, черновик текста и файлы ДО перезапуска
    // WebView после restartCore() делает полный reload — localStorage переживает его
    try {
      var path = window.location.pathname + window.location.search + window.location.hash;
      if (path && path !== "/") {
        localStorage.setItem("__agyNavRestore", JSON.stringify({ path: path, ts: Date.now() }));
      }
    } catch (_) {}
    try {
      var draftEl = document.querySelector("[data-testid='agent-input-box'] [contenteditable='true']");
      if (draftEl) {
        var draftText = ((draftEl.innerText !== undefined ? draftEl.innerText : draftEl.textContent) || "").trim();
        if (draftText) {
          localStorage.setItem("__agyDraftRestore", JSON.stringify({ text: draftText, ts: Date.now() }));
        }
      }
    } catch (_) {}
    try {
      var allInputs = Array.prototype.slice.call(document.querySelectorAll("input[type='file']"));
      var compInput = allInputs.filter(function (el) {
        return !el.getAttribute("data-testid") && !el.closest("[role='dialog'],[aria-modal='true']");
      }).pop();
      if (compInput && compInput.files && compInput.files.length && typeof window.__agyAppendFiles === "function") {
        window.__agyAppendFiles(Array.prototype.slice.call(compInput.files));
      }
    } catch (_) {}

    state.useProviders = !state.useProviders;
    save();
    syncModels();
    applyRestart(state.useProviders
      ? T("ваши модели", "your models")
      : T("встроенные модели Google Gemini", "built-in Google Gemini models"));
    if (root && root.isConnected) render();
  };

  window.__agyProvidersMount = function (el) {
    if (!el) return;
    if (root && root.parentElement === el && el.children.length === 1) { render(); return; }
    el.innerHTML = "";
    root = document.createElement("div");
    root.className = "agy-providers";
    root.setAttribute("data-agy-no-translate", "");
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    el.appendChild(root);
    load();
    editing = null; fetchMsg = "";
    if (!window.__agyProvidersDocClickBound) {
      window.__agyProvidersDocClickBound = true;
      document.addEventListener("click", function (e) {
        if (!root || !root.isConnected) return;
        if (!threshOpen && !recentOpen && !typeOpen) return;
        if (e.target && e.target.closest && e.target.closest(".agy-compact-dd, .agy-pv-dd")) return;
        threshOpen = false;
        recentOpen = false;
        typeOpen = false;
        render();
      });
    }
    setTimeout(function () { syncModels(); }, 0);
    render();
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      officialModelInfo: officialModelInfo,
      effectiveInfo: effectiveInfo,
      buildSpecs: buildSpecs
    };
  }
})();

