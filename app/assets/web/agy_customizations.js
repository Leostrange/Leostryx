/* Antigravity RU — Settings › Customizations (Настройки пользователя).
 * Complete customization management:
 * 1. Skills tab: browse builtin/plugin/user skills, preview SKILL.md, copy to user skills, edit and add custom skills.
 * 2. Instructions tab: view, preset, and edit global system rules (AGENTS.md).
 * 3. Plugins tab: installed plugins management, 1-click install marketplace catalog, custom plugin creation.
 * 4. Custom providers integration: forward tools, skills and instructions to OpenAI/Claude/DeepSeek.
 */
(function () {
  "use strict";
  if (window.__agyCustomizationsReady) return;
  window.__agyCustomizationsReady = true;

  function ru() {
    try { return window.__agyI18n ? window.__agyI18n.getLanguage() === "ru" : true; }
    catch (e) { return true; }
  }
  function T(r, e) { return ru() ? r : e; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function toB64(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      return "";
    }
  }
  function fromB64(str) {
    try {
      return decodeURIComponent(escape(atob(str)));
    } catch (e) {
      try { return atob(str); } catch (e2) { return str || ""; }
    }
  }

  var host = null, root = null;
  var activeTab = "skills"; // "skills" | "subagents" | "instructions" | "plugins"
  var skillFilter = "all";  // "all" | "user" | "plugin" | "builtin"
  var searchQuery = "";

  // Modals state
  var skillModal = { open: false, mode: "create", name: "", desc: "", body: "" };
  var viewModal = { open: false, skill: null, loading: false };
  var addPluginModal = { open: false, name: "", desc: "" };
  var agentModal = { open: false, mode: "create", name: "", title: "", desc: "", model: "inherit", write: true, mcp: true, sub: false, body: "" };
  var viewAgentModal = { open: false, agent: null, loading: false };

  var skills = [];
  var plugins = [];
  var agents = [];
  var instructionsText = "";
  var instructionsLoaded = false;

  var activeJobs = 0;       // number of running bridge ops (busy indicator)
  var pollTimers = {};      // jobId -> setTimeout handle (per-job polling)
  var logText = "";

  var CATALOG_AGENTS = [
    {
      id: "code-reviewer",
      title: T("Ревьюер кода (Code Reviewer)", "Code Reviewer"),
      model: "pro",
      desc: T("Глубокое код-ревью изменений, поиск багов, гонок данных, утечек памяти и нарушений архитектуры без модификации файлов.", "Deep code review for bugs, data races, memory leaks and architecture issues (read-only)."),
      tags: ["Ревью", "Read-only", "Pro"]
    },
    {
      id: "android-debugger",
      title: T("Android-отладчик (Logcat & APK)", "Android Debugger (Logcat & APK)"),
      model: "inherit",
      desc: T("Диагностика крашей Android, анализ logcat/stacktrace, проверка манифестов, Gradle, JNI и декомпиляция через jadx-agy/apktool.", "Android crash diagnostics, logcat/stacktrace analysis, Gradle, JNI and jadx-agy/apktool."),
      tags: ["Android", "Logcat", "APK"]
    },
    {
      id: "security-auditor",
      title: T("Аудитор безопасности (Security Auditor)", "Security Auditor"),
      model: "pro",
      desc: T("Аудит безопасности по OWASP Top 10, поиск инъекций, XSS/CSRF, небезопасных прав Android и утечек API-ключей/секретов.", "OWASP Top 10 security audit, injection checks, Android permissions and secret leak detection."),
      tags: ["OWASP", "Безопасность", "Read-only"]
    },
    {
      id: "test-engineer",
      title: T("Инженер тестирования (QA & Tests)", "Test Engineer (QA & Tests)"),
      model: "inherit",
      desc: T("Написание и запуск модульных и интеграционных тестов (pytest, vitest, jest, JUnit, go test) и проверка покрытия.", "Writing and running unit/integration tests (pytest, vitest, jest, JUnit, go test)."),
      tags: ["Тесты", "QA", "Автоматизация"]
    },
    {
      id: "docs-architect",
      title: T("Архитектор документации (Docs & README)", "Docs Architect"),
      model: "flash",
      desc: T("Генерация и актуализация README.md, CHANGELOG.md, архитектурных Mermaid-диаграмм и документации API.", "Generating and updating README.md, CHANGELOG.md, Mermaid architecture diagrams and API docs."),
      tags: ["Документация", "Mermaid", "Flash"]
    }
  ];

  // Curated Android-compatible plugin catalog (1-click install).
  // Only packs that fully work on Android without Docker/Postgres/etc.
  var CATALOG_PLUGINS = [
    {
      id: "android-cli-plugin",
      name: "Android CLI",
      desc: T("Официальные инструкции Google для Android CLI. Для работы требуется совместимый Android CLI.", "Official Android CLI guidance. A compatible Android CLI is required."),
      skills: ["android-cli"],
      tags: ["Android", "Google", "CLI"]
    },
    {
      id: "modern-web-guidance",
      name: "Modern Web Guidance",
      desc: T("Официальный набор Google Chrome для современной веб-разработки.", "Official Google Chrome modern web development guidance."),
      skills: ["modern-web-guidance", "chrome-extensions"],
      tags: ["Web", "Google", "CSS"]
    },
    {
      id: "google-workspace",
      name: "Google Workspace & Cloud",
      desc: T("Инструменты для работы с Google Docs, Sheets, Slides, Drive и Cloud API.", "Integration with Google Workspace: Docs, Sheets, Slides, Drive and Cloud API."),
      skills: ["gdocs-editor", "gsheets-analyzer", "gdrive-manager"],
      tags: ["Google", "Облако", "Документы"]
    },
    {
      id: "python-data-science",
      name: "Python Data Science & ML",
      desc: T("Пакет навыков для анализа данных, машинного обучения, работы с Pandas, NumPy и визуализации.", "Data science & machine learning pack with Pandas, NumPy and data visualization skills."),
      skills: ["python-eda", "data-visualization"],
      tags: ["Python", "Данные", "ML"]
    },
    {
      id: "database-tools",
      name: "SQLite & Mobile Databases",
      desc: T("Проектирование схем и оптимизация запросов для SQLite — нативной БД Android.", "Schema design and query tuning for SQLite — the native Android database."),
      skills: ["sqlite-optimizer", "schema-design"],
      tags: ["SQLite", "SQL", "БД"]
    },
    {
      id: "security-audit",
      name: "Security Audit & Hardening",
      desc: T("Поиск уязвимостей по стандарту OWASP Top 10, аудит зависимостей и сканер утечки токенов/ключей.", "OWASP Top 10 vulnerability checks, dependency security scanning and secret leak detection."),
      skills: ["security-review", "secret-scanner"],
      tags: ["Безопасность", "OWASP", "Секреты"]
    },
    {
      id: "git-advanced",
      name: "Git Automation & Conventional Flow",
      desc: T("Стандарты семантических коммитов Conventional Commits и подготовка чеклистов Pull Request.", "Semantic conventional commits automation and structured pull request reviews."),
      skills: ["git-conventional-commits", "git-pr-review"],
      tags: ["Git", "PR", "Воркфлоу"]
    },
    {
      id: "antigravity-sdk",
      name: "Google Antigravity SDK",
      desc: T("Создание AI-агентов с помощью Python SDK для Antigravity.", "Building AI agents with the Python SDK for Antigravity."),
      skills: ["antigravity-sdk-guide"],
      tags: ["Python", "SDK", "Агенты"]
    },
    {
      id: "science",
      name: "Science",
      desc: T("Подборка навыков агента для научных задач: методы, статистика, оформление исследований.", "Agent skill pack for scientific work: methods, statistics and research formatting."),
      skills: ["scientific-research"],
      tags: ["Наука", "Исследования", "Статистика"]
    },
    {
      id: "firebase",
      name: "Firebase",
      desc: T("Проектирование, создание и запуск проектов Firebase: Auth, Firestore, Functions.", "Designing, building and shipping Firebase projects: Auth, Firestore, Functions."),
      skills: ["firebase-architect", "firebase-deploy"],
      tags: ["Firebase", "Google", "Бэкенд"]
    }
  ];

  // Provider tools integration
  function isProviderToolsEnabled() {
    try {
      var raw = window.localStorage.getItem("agyProviders") || "";
      if (!raw && window.AgyProviders && typeof window.AgyProviders.load === "function") {
        raw = window.AgyProviders.load();
      }
      if (!raw) return true;
      var data = JSON.parse(raw);
      var conns = data.connections || [];
      for (var i = 0; i < conns.length; i++) {
        var meta = conns[i].modelMeta || {};
        for (var m in meta) {
          if (meta[m] && meta[m].tools === false) return false;
        }
      }
      return true;
    } catch (e) {
      return true;
    }
  }

  function toggleProviderTools(enable) {
    try {
      var raw = window.localStorage.getItem("agyProviders") || "";
      if (!raw && window.AgyProviders && typeof window.AgyProviders.load === "function") {
        raw = window.AgyProviders.load();
      }
      if (!raw) return;
      var data = JSON.parse(raw);
      var conns = data.connections || [];
      conns.forEach(function (c) {
        c.modelMeta = c.modelMeta || {};
        (c.selected || []).forEach(function (m) {
          c.modelMeta[m] = c.modelMeta[m] || {};
          c.modelMeta[m].tools = enable;
        });
      });
      var s = JSON.stringify(data);
      window.localStorage.setItem("agyProviders", s);
      if (window.AgyProviders && typeof window.AgyProviders.save === "function") {
        window.AgyProviders.save(s);
      }
    } catch (e) {}
  }

  function syncProviders() {
    toggleProviderTools(true);
    alert(T("Инструменты, навыки, субагенты и инструкции синхронизированы со всеми кастомными провайдерами!",
            "Tools, skills, subagents and instructions synchronized with all custom providers!"));
  }

  /* ------------------------------------------------------------ Native bridge */
  function runOp(cmd, arg, done) {
    var b = window.AgyTools;
    if (!b || typeof b.start !== "function") {
      logText += "\n[Error] Native AgyTools bridge not available.";
      if (done) done(null);
      return;
    }
    var fullArg = arg ? (cmd + " " + arg) : cmd;
    var id;
    try {
      id = b.start("customizations", fullArg);
    } catch (e) {
      logText += "\n[Error] Failed to start customizations op: " + e;
      if (done) done(null);
      return;
    }
    if (!id || /^ERR/.test(String(id))) {
      logText += "\n[Error] Bridge error: " + id;
      if (done) done(null);
      return;
    }
    activeJobs++;
    render();

    // Per-job polling: concurrent ops (status + read-instructions on mount)
    // must NOT cancel each other's timers — each job owns its own timer and log.
    (function poll() {
      var r = {};
      try { r = JSON.parse(b.read(id) || "{}"); } catch (e) {}
      var jobLog = r.log || "";
      if (jobLog) {
        logText = jobLog;
      }
      if (r.rc !== undefined && r.rc !== "") {
        delete pollTimers[id];
        activeJobs = Math.max(0, activeJobs - 1);
        parseLog(jobLog || logText, cmd);
        if (done) done(r);
        render();
        return;
      }
      pollTimers[id] = setTimeout(poll, 400);
    })();
  }

  function parseLog(txt, cmd) {
    if (!txt) return;

    if (cmd === "read-instructions") {
      var sIdx = txt.indexOf("@@cust_instr_start");
      var eIdx = txt.indexOf("@@cust_instr_end");
      if (sIdx >= 0 && eIdx > sIdx) {
        var body = txt.slice(sIdx + "@@cust_instr_start".length, eIdx).trim();
        instructionsText = body;
        instructionsLoaded = true;
      }
      return;
    }

    if (cmd === "read-skill") {
      var mData = /^@@cust_skill_data (.*)$/m.exec(txt);
      if (mData) {
        var dParts = mData[1].split("|");
        var dName = dParts[0];
        var dDesc = fromB64(dParts[1] || "");
        var dBody = fromB64(dParts[2] || "");
        if (viewModal.open && viewModal.skill) {
          viewModal.skill.desc = dDesc || viewModal.skill.desc;
          viewModal.skill.body = dBody;
          viewModal.loading = false;
        }
        if (skillModal.open) {
          skillModal.desc = dDesc || skillModal.desc;
          skillModal.body = dBody;
        }
      }
      return;
    }

    if (cmd === "read-agent") {
      var mAg = /^@@cust_agent_data (.*)$/m.exec(txt);
      if (mAg) {
        var aParts = mAg[1].split("|");
        var aName = aParts[0];
        var aTitle = fromB64(aParts[1] || "");
        var aDesc = fromB64(aParts[2] || "");
        var aModel = aParts[3] || "inherit";
        var aWrite = aParts[4] === "1";
        var aMcp = aParts[5] === "1";
        var aSub = aParts[6] === "1";
        var aBody = fromB64(aParts[7] || "");
        if (viewAgentModal.open && viewAgentModal.agent) {
          viewAgentModal.agent.title = aTitle || viewAgentModal.agent.title;
          viewAgentModal.agent.desc = aDesc || viewAgentModal.agent.desc;
          viewAgentModal.agent.model = aModel;
          viewAgentModal.agent.write = aWrite;
          viewAgentModal.agent.mcp = aMcp;
          viewAgentModal.agent.sub = aSub;
          viewAgentModal.agent.body = aBody;
          viewAgentModal.loading = false;
        }
        if (agentModal.open) {
          agentModal.title = aTitle || agentModal.title;
          agentModal.desc = aDesc || agentModal.desc;
          agentModal.model = aModel;
          agentModal.write = aWrite;
          agentModal.mcp = aMcp;
          agentModal.sub = aSub;
          agentModal.body = aBody;
        }
      }
      return;
    }

    var newSkills = [];
    var newPlugins = [];
    var newAgents = [];

    txt.split("\n").forEach(function (line) {
      var m;
      if ((m = /^@@cust_skill (.*)$/.exec(line))) {
        var parts = m[1].split("|");
        if (parts.length >= 6) {
          newSkills.push({
            type: parts[0],
            name: parts[1],
            plugin: parts[2],
            enabled: parts[3] === "1",
            path: parts[4],
            desc: parts[5]
          });
        }
      } else if ((m = /^@@cust_plugin (.*)$/.exec(line))) {
        var parts = m[1].split("|");
        if (parts.length >= 7) {
          newPlugins.push({
            name: parts[0],
            title: parts[1] || parts[0],
            enabled: parts[2] === "1",
            skillsCount: parseInt(parts[3], 10) || 0,
            hasRules: parts[4] === "1",
            hasMcp: parts[5] === "1",
            desc: parts[6]
          });
        }
      } else if ((m = /^@@cust_agent (.*)$/.exec(line))) {
        var parts = m[1].split("|");
        if (parts.length >= 10) {
          newAgents.push({
            type: parts[0],
            name: parts[1],
            title: parts[2] || parts[1],
            model: parts[3] || "inherit",
            write: parts[4] === "1",
            mcp: parts[5] === "1",
            sub: parts[6] === "1",
            enabled: parts[7] === "1",
            path: parts[8],
            desc: parts[9]
          });
        }
      }
    });

    if (newSkills.length > 0) skills = newSkills;
    if (newPlugins.length > 0) plugins = newPlugins;
    if (newAgents.length > 0) agents = newAgents;
  }

  function refreshStatus(done) {
    runOp("status", "", done);
  }

  function loadInstructions(done) {
    runOp("read-instructions", "", done);
  }

  function invokeSubagentInChat(ag) {
    if (!ag) return;
    var promptText;
    if (ag.type === "builtin") {
      promptText = T(
        "Вызови субагента `" + ag.name + "` (роль: \"" + (ag.title || ag.name) + "\") через `invoke_subagent` для следующей задачи: ",
        "Invoke subagent `" + ag.name + "` (role: \"" + (ag.title || ag.name) + "\") via `invoke_subagent` for the following task: "
      );
    } else {
      promptText = T(
        "Используй кастомного субагента `" + ag.name + "` (" + (ag.title || ag.name) + ", инструкция в `" + ag.path + "`, модель `" + ag.model + "`): зарегистрируй его через `define_subagent` и запусти через `invoke_subagent` для задачи: ",
        "Use custom subagent `" + ag.name + "` (" + (ag.title || ag.name) + ", prompt in `" + ag.path + "`, model `" + ag.model + "`): register via `define_subagent` and invoke via `invoke_subagent` for task: "
      );
    }
    if (typeof window.__agyInsertIntoChat === "function") {
      window.__agyInsertIntoChat(promptText, false);
      return;
    }
    try {
      navigator.clipboard.writeText(promptText);
    } catch (e) {}
    alert(T("Команда вызова субагента скопирована и подготовлена:\n\n" + promptText, "Subagent invocation prompt copied:\n\n" + promptText));
  }

  /* ------------------------------------------------------------ Filtering */
  function getFilteredSkills() {
    var q = searchQuery.toLowerCase().trim();
    return skills.filter(function (s) {
      if (skillFilter === "user" && s.type !== "user") return false;
      if (skillFilter === "plugin" && s.type !== "plugin") return false;
      if (skillFilter === "builtin" && s.type !== "builtin") return false;

      if (q) {
        var match = s.name.toLowerCase().indexOf(q) >= 0 ||
                    s.desc.toLowerCase().indexOf(q) >= 0 ||
                    s.plugin.toLowerCase().indexOf(q) >= 0;
        if (!match) return false;
      }
      return true;
    });
  }

  /* ------------------------------------------------------------ Render */
  function render() {
    if (!root) return;
    var provTools = isProviderToolsEnabled();
    var isBusy = activeJobs > 0;

    var html = '';

    // Header
    html += '<div class="agy-cust-header">';
    html += '  <div class="agy-cust-title">' + esc(T("Настройки пользователя и кастомизация", "User Customizations & Skills")) + '</div>';
    html += '  <div class="agy-cust-sub">' + esc(T("Управление процедурными навыками (Skills), субагентами (Subagents), глобальными инструкциями (AGENTS.md) и плагинами.", "Manage procedural skills, subagents, global agent rules (AGENTS.md) and plugins.")) + '</div>';
    html += '</div>';

    // Provider Integration Banner
    html += '<div class="agy-cust-banner">';
    html += '  <div class="agy-cust-banner-info">';
    html += '    <div class="agy-cust-banner-title">' + esc(T("Сквозная поддержка в кастомных провайдерах", "Custom Providers Integration")) + '</div>';
    html += '    <div class="agy-cust-banner-desc">' + esc(T("Передавать навыки, субагентов, инструкции и инструменты в сторонние нейросети (OpenAI, Claude, DeepSeek).", "Forward active skills, subagents, rules and tools to third-party LLMs (OpenAI, Claude, DeepSeek).")) + '</div>';
    html += '  </div>';
    html += '  <div style="display: flex; align-items: center; gap: 8px;">';
    html += '    <button class="agy-cust-btn sm secondary" data-act="sync-providers">' + esc(T("Синхронизировать", "Sync All")) + '</button>';
    html += '    <label class="agy-mcp-switch">';
    html += '      <input type="checkbox" data-act="toggle-prov" ' + (provTools ? 'checked' : '') + '>';
    html += '      <span class="agy-mcp-slider"></span>';
    html += '    </label>';
    html += '  </div>';
    html += '</div>';

    // Segmented Navigation Tabs
    html += '<div class="agy-cust-tabs">';
    html += '  <button class="agy-cust-tab ' + (activeTab === "skills" ? "active" : "") + '" data-tab="skills">';
    html += '    ' + esc(T("Навыки (" + skills.length + ")", "Skills (" + skills.length + ")"));
    html += '  </button>';
    html += '  <button class="agy-cust-tab ' + (activeTab === "subagents" ? "active" : "") + '" data-tab="subagents">';
    html += '    ' + esc(T("Субагенты (" + agents.length + ")", "Subagents (" + agents.length + ")"));
    html += '  </button>';
    html += '  <button class="agy-cust-tab ' + (activeTab === "instructions" ? "active" : "") + '" data-tab="instructions">';
    html += '    ' + esc(T("Инструкции (AGENTS.md)", "Instructions (AGENTS.md)"));
    html += '  </button>';
    html += '  <button class="agy-cust-tab ' + (activeTab === "plugins" ? "active" : "") + '" data-tab="plugins">';
    html += '    ' + esc(T("Плагины (" + plugins.length + ")", "Plugins (" + plugins.length + ")"));
    html += '  </button>';
    html += '</div>';

    // ------------------------------------------------------------ TAB 1: Skills
    if (activeTab === "skills") {
      html += '<div class="agy-cust-section">';

      // Toolbar
      html += '<div class="agy-cust-toolbar">';
      html += '  <div class="agy-cust-search-wrap">';
      html += '    <span class="agy-cust-search-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span>';
      html += '    <input type="text" class="agy-cust-search-input" data-act="search-skills" value="' + esc(searchQuery) + '" placeholder="' + esc(T("Поиск навыков по названию или описанию...", "Search skills by name or description...")) + '">';
      html += '  </div>';

      var userCount = skills.filter(function (s) { return s.type === "user"; }).length;
      var pluginCount = skills.filter(function (s) { return s.type === "plugin"; }).length;
      var builtinCount = skills.filter(function (s) { return s.type === "builtin"; }).length;

      html += '  <div class="agy-cust-filter-bar">';
      html += '    <button class="agy-cust-filter-pill ' + (skillFilter === "all" ? "active" : "") + '" data-filter="all">' + esc(T("Все (" + skills.length + ")", "All (" + skills.length + ")")) + '</button>';
      html += '    <button class="agy-cust-filter-pill ' + (skillFilter === "user" ? "active" : "") + '" data-filter="user">' + esc(T("Пользовательские (" + userCount + ")", "My Skills (" + userCount + ")")) + '</button>';
      html += '    <button class="agy-cust-filter-pill ' + (skillFilter === "plugin" ? "active" : "") + '" data-filter="plugin">' + esc(T("Из плагинов (" + pluginCount + ")", "From Plugins (" + pluginCount + ")")) + '</button>';
      html += '    <button class="agy-cust-filter-pill ' + (skillFilter === "builtin" ? "active" : "") + '" data-filter="builtin">' + esc(T("Встроенные (" + builtinCount + ")", "Built-in (" + builtinCount + ")")) + '</button>';
      html += '  </div>';
      html += '</div>';

      // Add Skill Card Button
      html += '<div class="agy-cust-add-card" data-act="open-add-skill">';
      html += '  <div>';
      html += '    <div class="agy-cust-add-title">+ ' + esc(T("Создать свой навык", "Create Custom Skill")) + '</div>';
      html += '    <div class="agy-cust-add-desc">' + esc(T("Обучите агента специфическим регламентам, инструкциям сборки, тестам или правилам для вашей кодовой базы.", "Teach the agent custom runbooks, build steps, tests or project guidelines.")) + '</div>';
      html += '  </div>';
      html += '</div>';

      // Skills List — grouped by type (user / plugin / builtin)
      var filtered = getFilteredSkills();
      if (filtered.length === 0) {
        html += '<div style="text-align:center; padding: 24px 12px; color: var(--muted-foreground, #888); font-size: 12px;">';
        html += esc(T("Навыки не найдены. Попробуйте изменить фильтр или запрос.", "No skills found matching query."));
        html += '</div>';
      } else {
        var skillGroups = [
          { type: "user", label: T("Пользовательские", "My Skills") },
          { type: "plugin", label: T("Из плагинов", "From Plugins") },
          { type: "builtin", label: T("Встроенные", "Built-in") }
        ];
        var firstGroup = true;
        skillGroups.forEach(function (grp) {
          var items = filtered.filter(function (s) { return s.type === grp.type; });
          if (items.length === 0) return;

          html += '<div class="agy-cust-group-label"' + (firstGroup ? ' style="margin-top:0;"' : '') + '>';
          html += '  <span>' + esc(grp.label) + '</span>';
          html += '  <span class="agy-cust-group-count">' + items.length + '</span>';
          html += '</div>';
          firstGroup = false;

          html += '<div class="agy-cust-group">';
          items.forEach(function (s) {
            html += '<div class="agy-cust-row">';
            html += '  <div class="agy-cust-card-main">';
            html += '    <div class="agy-cust-card-title">';
            html += '      <span>' + esc(s.name) + '</span>';
            if (grp.type === "plugin") {
              html += '    <span class="agy-cust-badge plugin">' + esc(s.plugin) + '</span>';
            }
            html += '      <span class="agy-cust-badge ' + (s.enabled ? "on" : "off") + '">' + (s.enabled ? esc(T("Активен", "Active")) : esc(T("Отключен", "Disabled"))) + '</span>';
            html += '    </div>';
            html += '    <div class="agy-cust-card-desc">' + esc(s.desc || T("Описание отсутствует", "No description")) + '</div>';
            html += '    <div class="agy-cust-card-meta">';
            html += '      <span style="font-family:monospace; opacity:.8;">' + esc(s.path.split("/.gemini/")[1] || s.path) + '</span>';
            html += '    </div>';

            // Contextual actions
            html += '    <div class="agy-cust-card-footer" style="margin-top:8px; justify-content:flex-end;">';
            html += '      <div class="agy-cust-action-group">';
            html += '        <button class="agy-cust-btn sm secondary" data-act="view-skill" data-skill-name="' + esc(s.name) + '" data-skill-path="' + esc(s.path) + '" data-skill-type="' + esc(s.type) + '">';
            html += '          ' + esc(T("Просмотр", "View"));
            html += '        </button>';

            if (grp.type === "builtin" || grp.type === "plugin") {
              html += '      <button class="agy-cust-btn sm secondary" data-act="copy-skill" data-skill-name="' + esc(s.name) + '" data-skill-path="' + esc(s.path) + '" title="' + esc(T("Скопировать в ~/.gemini/config/skills/ для редактирования", "Copy to user skills for editing")) + '">';
              html += '        ' + esc(T("Копировать", "Copy"));
              html += '      </button>';
            } else if (grp.type === "user") {
              html += '      <button class="agy-cust-btn sm secondary" data-act="edit-skill" data-skill-name="' + esc(s.name) + '" data-skill-path="' + esc(s.path) + '">';
              html += '        ' + esc(T("Редактировать", "Edit"));
              html += '      </button>';
              html += '      <button class="agy-cust-btn sm danger" data-act="delete-skill" data-skill="' + esc(s.name) + '">';
              html += '        ' + esc(T("Удалить", "Delete"));
              html += '      </button>';
            }
            html += '      </div>';
            html += '    </div>';

            html += '  </div>';
            html += '  <label class="agy-mcp-switch">';
            html += '    <input type="checkbox" data-act="toggle-skill" data-skill="' + esc(s.name) + '" ' + (s.enabled ? "checked" : "") + ' ' + (isBusy ? "disabled" : "") + '>';
            html += '    <span class="agy-mcp-slider"></span>';
            html += '  </label>';
            html += '</div>';
          });
          html += '</div>';
        });
      }

      html += '</div>';
    }

    // ------------------------------------------------------------ TAB 2: Subagents (Субагенты)
    if (activeTab === "subagents") {
      html += '<div class="agy-cust-section">';

      html += '<div style="margin-bottom: 10px;">';
      html += '  <div style="font-weight:600; font-size:13px; color:var(--foreground);">' + esc(T("Автономные субагенты (Subagents)", "Autonomous Subagents")) + '</div>';
      html += '  <div style="font-size:11.5px; color:var(--muted-foreground,#888); margin-top:2px; line-height:1.4;">' + esc(T("Субагенты работают в собственном контексте параллельно с основным агентом. Основной агент может вызывать как встроенных субагентов (self, research, image-generator), так и ваших специализированных субагентов из ~/.gemini/config/agents/.", "Subagents run in isolated contexts in parallel with the main agent. Supports both built-in subagents and custom roles stored in ~/.gemini/config/agents/.")) + '</div>';
      html += '</div>';

      // Create Custom Subagent Card Button
      html += '<div class="agy-cust-add-card" data-act="open-add-agent">';
      html += '  <div>';
      html += '    <div class="agy-cust-add-title">+ ' + esc(T("Создать своего субагента", "Create Custom Subagent")) + '</div>';
      html += '    <div class="agy-cust-add-desc">' + esc(T("Задайте имя роли, модель (inherit / pro / flash), права доступа к инструментам (запись файлов, терминал, MCP) и системный промпт.", "Define role ID, model (inherit / pro / flash), tool permissions (write/terminal, MCP) and system prompt.")) + '</div>';
      html += '  </div>';
      html += '</div>';

      var agentGroups = [
        { type: "user", label: T("Пользовательские субагенты", "Custom Subagents") },
        { type: "builtin", label: T("Встроенные системные субагенты", "Built-in System Subagents") }
      ];
      var firstAgGroup = true;
      agentGroups.forEach(function (grp) {
        var items = agents.filter(function (a) { return a.type === grp.type; });
        if (items.length === 0) return;

        html += '<div class="agy-cust-group-label"' + (firstAgGroup ? ' style="margin-top:0;"' : '') + '>';
        html += '  <span>' + esc(grp.label) + '</span>';
        html += '  <span class="agy-cust-group-count">' + items.length + '</span>';
        html += '</div>';
        firstAgGroup = false;

        html += '<div class="agy-cust-group">';
        items.forEach(function (ag) {
          var isBuiltin = ag.type === "builtin";
          html += '<div class="agy-cust-row">';
          html += '  <div class="agy-cust-card-main">';
          html += '    <div class="agy-cust-card-title">';
          html += '      <span>' + esc(ag.title || ag.name) + '</span>';
          html += '      <span class="agy-cust-badge ' + (isBuiltin ? "builtin" : "user") + '" style="font-family:monospace;">' + esc(ag.name) + '</span>';
          html += '      <span class="agy-cust-badge ' + (ag.enabled ? "on" : "off") + '">' + (ag.enabled ? esc(T("Активен", "Active")) : esc(T("Отключен", "Disabled"))) + '</span>';
          html += '    </div>';
          html += '    <div class="agy-cust-card-desc">' + esc(ag.desc || T("Описание роли отсутствует", "No role description")) + '</div>';
          html += '    <div class="agy-cust-card-meta" style="display:flex; flex-wrap:wrap; gap:5px; margin-top:5px;">';
          html += '      <span class="agy-cust-badge plugin">' + esc(T("Модель: ", "Model: ") + ag.model) + '</span>';
          html += '      <span class="agy-cust-badge ' + (ag.write ? "on" : "builtin") + '">' + esc(ag.write ? T("Запись и терминал", "Write & Terminal") : T("Только чтение", "Read-only")) + '</span>';
          if (ag.mcp) {
            html += '    <span class="agy-cust-badge user">MCP</span>';
          }
          if (ag.sub) {
            html += '    <span class="agy-cust-badge plugin">' + esc(T("Вложенные субагенты", "Nested Subagents")) + '</span>';
          }
          html += '    </div>';

          html += '    <div class="agy-cust-card-footer" style="margin-top:8px; justify-content:flex-end;">';
          html += '      <div class="agy-cust-action-group">';
          html += '        <button class="agy-cust-btn sm primary" data-act="invoke-agent" data-agent-name="' + esc(ag.name) + '">';
          html += '          ' + esc(T("Вызвать в чате", "Invoke in Chat"));
          html += '        </button>';
          html += '        <button class="agy-cust-btn sm secondary" data-act="view-agent" data-agent-name="' + esc(ag.name) + '" data-agent-path="' + esc(ag.path) + '">';
          html += '          ' + esc(T("Просмотр", "View"));
          html += '        </button>';
          if (!isBuiltin) {
            html += '      <button class="agy-cust-btn sm secondary" data-act="edit-agent" data-agent-name="' + esc(ag.name) + '" data-agent-path="' + esc(ag.path) + '">';
            html += '        ' + esc(T("Редактировать", "Edit"));
            html += '      </button>';
            html += '      <button class="agy-cust-btn sm danger" data-act="delete-agent" data-agent-name="' + esc(ag.name) + '">';
            html += '        ' + esc(T("Удалить", "Delete"));
            html += '      </button>';
          }
          html += '      </div>';
          html += '    </div>';
          html += '  </div>';

          if (!isBuiltin) {
            html += '  <label class="agy-mcp-switch">';
            html += '    <input type="checkbox" data-act="toggle-agent" data-agent="' + esc(ag.name) + '" ' + (ag.enabled ? "checked" : "") + ' ' + (isBusy ? "disabled" : "") + '>';
            html += '    <span class="agy-mcp-slider"></span>';
            html += '  </label>';
          }
          html += '</div>';
        });
        html += '</div>';
      });

      // 1-Click Subagent Preset Catalog
      html += '<div style="margin-top: 22px; margin-bottom: 8px;">';
      html += '  <div style="font-weight:600; font-size:13px; color:var(--foreground);">' + esc(T("Каталог готовых субагентов (1-клик установка)", "Subagent Role Catalog (1-Click Install)")) + '</div>';
      html += '  <div style="font-size:11.5px; color:var(--muted-foreground,#888); margin-top:2px; line-height:1.4;">' + esc(T("Готовые специализированные субагенты для код-ревью, отладки Android, аудита безопасности, тестов и документации.", "Pre-configured specialized subagents for code review, Android debugging, security auditing, testing and documentation.")) + '</div>';
      html += '</div>';

      html += '<div class="agy-cust-preset-grid">';
      CATALOG_AGENTS.forEach(function (pa) {
        var isInstalled = agents.some(function (a) { return a.name === pa.id; });
        html += '<div class="agy-cust-preset-card">';
        html += '  <div>';
        html += '    <div class="agy-cust-preset-header">';
        html += '      <div class="agy-cust-preset-title">' + esc(pa.title) + '</div>';
        if (isInstalled) {
          html += '    <span class="agy-cust-badge on">' + esc(T("Установлен", "Installed")) + '</span>';
        }
        html += '    </div>';
        html += '    <div class="agy-cust-preset-desc">' + esc(pa.desc) + '</div>';
        html += '    <div class="agy-cust-preset-tags">';
        pa.tags.forEach(function (t) {
          html += '    <span class="agy-cust-preset-tag">' + esc(t) + '</span>';
        });
        html += '    </div>';
        html += '  </div>';
        html += '  <div class="agy-cust-preset-footer">';
        html += '    <span style="font-size:11px; font-family:monospace; color:var(--muted-foreground,#888);">' + esc(pa.id) + '</span>';
        html += '    <button class="agy-cust-btn sm ' + (isInstalled ? "secondary" : "primary") + '" data-act="install-preset-agent" data-agent-id="' + esc(pa.id) + '" ' + (isBusy ? "disabled" : "") + '>';
        html += '      ' + esc(isInstalled ? T("Переустановить", "Reinstall") : T("Установить", "Install"));
        html += '    </button>';
        html += '  </div>';
        html += '</div>';
      });
      html += '</div>';

      html += '</div>';
    }

    // ------------------------------------------------------------ TAB 3: Instructions (AGENTS.md)
    if (activeTab === "instructions") {
      html += '<div class="agy-cust-section">';

      html += '<div style="margin-bottom: 10px;">';
      html += '  <div style="font-weight:600; font-size:13px; color:var(--foreground);">' + esc(T("Глобальные инструкции пользователя (AGENTS.md)", "Global User Instructions (AGENTS.md)")) + '</div>';
      html += '  <div style="font-size:11.5px; color:var(--muted-foreground,#888); margin-top:2px; line-height:1.4;">' + esc(T("Эти инструкции загружаются в начало системного промпта агента в каждом диалоге и действуют как для стандартных, так и для всех кастомных моделей.", "These instructions are injected into the agent system prompt for every conversation, applying to standard and custom models.")) + '</div>';
      html += '</div>';

      // Presets
      html += '<div class="agy-cust-presets">';
      html += '  <span style="font-size:11px; color:var(--muted-foreground,#888); align-self:center;">' + esc(T("Быстрые правила:", "Quick rules:")) + '</span>';
      html += '  <button class="agy-cust-preset-pill" data-preset="concise">+ ' + esc(T("Краткие и ёмкие ответы", "Concise answers")) + '</button>';
      html += '  <button class="agy-cust-preset-pill" data-preset="strict">+ ' + esc(T("Строгая типизация и тесты", "Strict types & tests")) + '</button>';
      html += '  <button class="agy-cust-preset-pill" data-preset="russian">+ ' + esc(T("Русский язык и комментарии", "Russian language only")) + '</button>';
      html += '</div>';

      // Textarea Editor
      var len = instructionsText.length;
      var lines = instructionsText ? instructionsText.split("\n").length : 0;

      html += '<div class="agy-cust-editor-wrap">';
      html += '  <textarea class="agy-cust-editor" id="agy-cust-instr-textarea" placeholder="' + esc(T("Загрузка инструкций...", "Loading instructions...")) + '">' + esc(instructionsText) + '</textarea>';
      html += '  <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--muted-foreground,#888);">';
      html += '    <span>' + esc(T("Символов: " + len + " | Строк: " + lines, "Chars: " + len + " | Lines: " + lines)) + '</span>';
      html += '    <span style="font-family:monospace;">~/.gemini/config/AGENTS.md</span>';
      html += '  </div>';
      html += '</div>';

      // Actions
      html += '<div style="display:flex; gap:8px; margin-top:14px; flex-wrap:wrap;">';
      html += '  <button class="agy-cust-btn primary" data-act="save-instructions" ' + (isBusy ? "disabled" : "") + '>';
      html += '    ' + esc(T("Сохранить инструкции", "Save Instructions"));
      html += '  </button>';
      html += '  <button class="agy-cust-btn secondary" data-act="reset-instructions" ' + (isBusy ? "disabled" : "") + '>';
      html += '    ' + esc(T("Восстановить стандартные правила Android", "Restore Default Android Rules"));
      html += '  </button>';
      html += '  <button class="agy-cust-btn secondary" data-act="reload-instructions" ' + (isBusy ? "disabled" : "") + '>';
      html += '    ' + esc(T("Обновить из файла", "Reload from Disk"));
      html += '  </button>';
      html += '</div>';

      html += '</div>';
    }

    // ------------------------------------------------------------ TAB 4: Plugins
    if (activeTab === "plugins") {
      html += '<div class="agy-cust-section">';

      html += '<div style="margin-bottom: 12px;">';
      html += '  <div style="font-weight:600; font-size:13px; color:var(--foreground);">' + esc(T("Установленные плагины", "Installed Plugins")) + '</div>';
      html += '  <div style="font-size:11.5px; color:var(--muted-foreground,#888); margin-top:2px; line-height:1.4;">' + esc(T("Плагины объединяют тематические навыки, правила и инструменты MCP. Их можно включать и отключать на лету.", "Plugins bundle procedural skills, rules and MCP servers. You can toggle them on or off.")) + '</div>';
      html += '</div>';

      // Installed Plugins list
      if (plugins.length === 0) {
        html += '<div style="text-align:center; padding: 18px; color: var(--muted-foreground, #888); font-size:12px; background:color-mix(in srgb, var(--foreground, #888) 3%, transparent); border-radius:10px;">';
        html += esc(T("Плагины не обнаружены в ~/.gemini/config/plugins", "No plugins found in ~/.gemini/config/plugins"));
        html += '</div>';
      } else {
        html += '<div class="agy-cust-group">';
        plugins.forEach(function (p) {
          var isSystem = (p.name === "android-cli-plugin" || p.name === "flutter" || p.name === "modern-web-guidance-plugin");

          html += '<div class="agy-cust-row">';
          html += '  <div class="agy-cust-card-main">';
          html += '    <div class="agy-cust-card-title">';
          html += '      <span>' + esc(p.title || p.name) + '</span>';
          html += '      <span class="agy-cust-badge ' + (p.enabled ? "on" : "off") + '">' + (p.enabled ? esc(T("Включен", "Active")) : esc(T("Отключен", "Disabled"))) + '</span>';
          if (isSystem) {
            html += '    <span class="agy-cust-badge builtin">' + esc(T("Системный", "System")) + '</span>';
          }
          html += '    </div>';
          html += '    <div class="agy-cust-card-desc">' + esc(p.desc || T("Описание плагина отсутствует", "No plugin description")) + '</div>';
          html += '    <div class="agy-cust-card-meta">';
          html += '      <span class="agy-cust-badge plugin">' + esc(T(p.skillsCount + " навыков", p.skillsCount + " skills")) + '</span>';
          if (p.hasRules) html += '      <span class="agy-cust-badge user">' + esc(T("Правила AGENTS.md", "AGENTS.md rules")) + '</span>';
          if (p.hasMcp) html += '      <span class="agy-cust-badge builtin">' + esc(T("Серверы MCP", "MCP Servers")) + '</span>';
          html += '    </div>';

          if (!isSystem) {
            html += '  <div style="margin-top:8px;">';
            html += '    <button class="agy-cust-btn sm danger" data-act="uninstall-plugin" data-plugin="' + esc(p.name) + '">';
            html += '      ' + esc(T("Удалить плагин", "Uninstall Plugin"));
            html += '    </button>';
            html += '  </div>';
          }

          html += '  </div>';
          html += '  <label class="agy-mcp-switch">';
          html += '    <input type="checkbox" data-act="toggle-plugin" data-plugin="' + esc(p.name) + '" ' + (p.enabled ? "checked" : "") + ' ' + (isBusy ? "disabled" : "") + '>';
          html += '    <span class="agy-mcp-slider"></span>';
          html += '  </label>';
          html += '</div>';
        });
        html += '</div>';
      }

      // Add custom plugin button
      html += '<div style="margin-top:12px;">';
      html += '  <button class="agy-cust-btn sm secondary" data-act="open-add-plugin">';
      html += '    + ' + esc(T("Создать свой плагин...", "Create custom plugin..."));
      html += '  </button>';
      html += '</div>';

      // -------------------------------------------------------- Marketplace Catalog
      html += '<div style="margin-top: 24px; margin-bottom: 8px;">';
      html += '  <div style="font-weight:600; font-size:13px; color:var(--foreground);">' + esc(T("Каталог готовых плагинов (1-клик установка)", "Plugin Catalog (1-Click Install)")) + '</div>';
      html += '  <div style="font-size:11.5px; color:var(--muted-foreground,#888); margin-top:2px; line-height:1.4;">' + esc(T("Наборы навыков, инструкций и конфигураций для решения прикладных задач.", "Curated packs of skills, instructions and workflows ready to install with one click.")) + '</div>';
      html += '</div>';

      html += '<div class="agy-cust-preset-grid">';
      CATALOG_PLUGINS.forEach(function (preset) {
        var isInstalled = plugins.some(function (p) { return p.name === preset.id; });

        html += '<div class="agy-cust-preset-card">';
        html += '  <div>';
        html += '    <div class="agy-cust-preset-header">';
        html += '      <div class="agy-cust-preset-title">' + esc(preset.name) + '</div>';
        if (isInstalled) {
          html += '    <span class="agy-cust-badge on">' + esc(T("Установлен", "Installed")) + '</span>';
        }
        html += '    </div>';
        html += '    <div class="agy-cust-preset-desc">' + esc(preset.desc) + '</div>';
        html += '    <div class="agy-cust-preset-tags">';
        preset.tags.forEach(function (t) {
          html += '    <span class="agy-cust-preset-tag">' + esc(t) + '</span>';
        });
        html += '    </div>';
        html += '  </div>';

        html += '  <div class="agy-cust-preset-footer">';
        html += '    <span style="font-size:11px; color:var(--muted-foreground,#888);">' + esc(T(preset.skills.length + " навыков", preset.skills.length + " skills")) + '</span>';
        if (isInstalled) {
          html += '  <button class="agy-cust-btn sm secondary" data-act="install-preset" data-plugin="' + esc(preset.id) + '" ' + (isBusy ? "disabled" : "") + '>';
          html += '    ' + esc(T("Переустановить", "Reinstall"));
          html += '  </button>';
        } else {
          html += '  <button class="agy-cust-btn sm primary" data-act="install-preset" data-plugin="' + esc(preset.id) + '" ' + (isBusy ? "disabled" : "") + '>';
          html += '    ' + esc(T("Установить", "Install"));
          html += '  </button>';
        }
        html += '  </div>';
        html += '</div>';
      });
      html += '</div>';

      html += '<div style="margin-top:20px;">';
      html += '  <button class="agy-cust-btn secondary" data-act="restart-core">';
      html += '    ' + esc(T("Перезапустить ядро для применения плагинов", "Restart Core to Apply Plugins"));
      html += '  </button>';
      html += '</div>';

      html += '</div>';
    }

    // ------------------------------------------------------------ MODAL: View Skill Preview
    if (viewModal.open && viewModal.skill) {
      var vSkill = viewModal.skill;
      var typeTitle = vSkill.type === "user" ? T("Пользовательский навык", "User Skill") :
                     (vSkill.type === "plugin" ? T("Навык из плагина", "Plugin Skill") : T("Встроенный навык", "Built-in Skill"));

      html += '<div class="agy-cust-modal-overlay">';
      html += '  <div class="agy-cust-modal agy-cust-preview-modal">';
      html += '    <div class="agy-cust-modal-title" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">';
      html += '      <span>' + esc(vSkill.name) + '</span>';
      html += '      <span class="agy-cust-badge ' + (vSkill.type === "user" ? "user" : (vSkill.type === "plugin" ? "plugin" : "builtin")) + '">' + esc(typeTitle) + '</span>';
      html += '    </div>';
      html += '    <div class="agy-cust-modal-desc" style="font-family:monospace; font-size:11px; opacity:.85;">' + esc(vSkill.path) + '</div>';

      if (vSkill.desc) {
        html += '  <div style="font-size:12px; color:var(--foreground); background:color-mix(in srgb, var(--foreground,#888) 4%, transparent); padding:8px 10px; border-radius:7px; border:1px solid var(--border,rgba(127,127,127,.2));">';
        html += '    <strong>' + esc(T("Триггер:", "Trigger:")) + '</strong> ' + esc(vSkill.desc);
        html += '  </div>';
      }

      html += '    <div style="display:flex; flex-direction:column; gap:5px; margin-top:4px;">';
      html += '      <div style="font-size:11px; font-weight:600; color:var(--muted-foreground,#888);">' + esc(T("Инструкция Markdown (SKILL.md):", "Markdown Instructions (SKILL.md):")) + '</div>';
      if (viewModal.loading) {
        html += '    <div class="agy-cust-code-preview" style="text-align:center; color:var(--muted-foreground,#888); padding:32px;">' + esc(T("Загрузка содержимого навыка...", "Loading skill content...")) + '</div>';
      } else {
        html += '    <div class="agy-cust-code-preview">' + esc(vSkill.body || T("(Пустой файл инструкции)", "(Empty instructions)")) + '</div>';
      }
      html += '    </div>';

      html += '    <div class="agy-cust-modal-actions" style="margin-top:10px;">';
      if (vSkill.type === "builtin" || vSkill.type === "plugin") {
        html += '    <button class="agy-cust-btn primary" data-act="copy-from-view" data-skill-path="' + esc(vSkill.path) + '" data-skill-name="' + esc(vSkill.name) + '">';
        html += '      ' + esc(T("Копировать в мои навыки для редактирования", "Copy to My Skills to Edit"));
        html += '    </button>';
      } else if (vSkill.type === "user") {
        html += '    <button class="agy-cust-btn primary" data-act="edit-from-view" data-skill-path="' + esc(vSkill.path) + '" data-skill-name="' + esc(vSkill.name) + '">';
        html += '      ' + esc(T("Редактировать", "Edit"));
        html += '    </button>';
      }
      html += '      <button class="agy-cust-btn secondary" data-act="close-view-skill">' + esc(T("Закрыть", "Close")) + '</button>';
      html += '    </div>';
      html += '  </div>';
      html += '</div>';
    }

    // ------------------------------------------------------------ MODAL: Add / Edit Skill
    if (skillModal.open) {
      var isEdit = skillModal.mode === "edit";

      html += '<div class="agy-cust-modal-overlay">';
      html += '  <div class="agy-cust-modal agy-cust-preview-modal">';
      html += '    <div class="agy-cust-modal-title">' + (isEdit ? esc(T("Редактировать навык", "Edit Skill")) : esc(T("Добавить свой навык (Skill)", "Create Custom Skill"))) + '</div>';
      html += '    <div class="agy-cust-modal-desc">' + esc(T("Навык сохраняется в ~/.gemini/config/skills/<имя>/SKILL.md и автоматически доступен агенту во всех проектах и провайдерах.", "Skill is stored in ~/.gemini/config/skills/<name>/SKILL.md and discovered across projects.")) + '</div>';
      html += '    <div class="agy-cust-modal-form">';
      html += '      <div class="agy-cust-field">';
      html += '        <label>' + esc(T("Идентификатор навыка (латиница, дефисы, например: my-git-flow)", "Skill ID (lowercase, hyphens, e.g. my-git-flow)")) + '</label>';
      html += '        <input type="text" id="cust-skill-name" value="' + esc(skillModal.name) + '" placeholder="my-custom-skill" ' + (isEdit ? "readonly style='opacity:.75;'" : "") + '>';
      html += '      </div>';
      html += '      <div class="agy-cust-field">';
      html += '        <label>' + esc(T("Когда применять навык (триггер для агента)", "When to use (Agent trigger description)")) + '</label>';
      html += '        <input type="text" id="cust-skill-desc" value="' + esc(skillModal.desc) + '" placeholder="' + esc(T("Использовать этот навык, когда пользователь просит...", "Use this skill when the user asks to...")) + '">';
      html += '      </div>';
      html += '      <div class="agy-cust-field">';
      html += '        <label>' + esc(T("Инструкция Markdown (шаги, команды, регламент)", "Markdown Instructions (steps, commands, runbook)")) + '</label>';
      html += '        <textarea id="cust-skill-body" style="min-height:220px;" placeholder="# ' + esc(T("Заголовок навыка\n\n## Шаги выполнения:\n1. Проверить...\n2. Выполнить команду...", "Skill Title\n\n## Steps:\n1. Check...\n2. Run command...")) + '">' + esc(skillModal.body) + '</textarea>';
      html += '      </div>';
      html += '    </div>';
      html += '    <div class="agy-cust-modal-actions">';
      html += '      <button class="agy-cust-btn secondary" data-act="close-skill-modal">' + esc(T("Отмена", "Cancel")) + '</button>';
      html += '      <button class="agy-cust-btn primary" data-act="submit-skill-modal">' + (isEdit ? esc(T("Сохранить изменения", "Save Changes")) : esc(T("Создать навык", "Create Skill"))) + '</button>';
      html += '    </div>';
      html += '  </div>';
      html += '</div>';
    }

    // ------------------------------------------------------------ MODAL: View Subagent
    if (viewAgentModal.open && viewAgentModal.agent) {
      var vAg = viewAgentModal.agent;
      html += '<div class="agy-cust-modal-overlay">';
      html += '  <div class="agy-cust-modal agy-cust-preview-modal">';
      html += '    <div class="agy-cust-modal-title" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">';
      html += '      <span>' + esc(vAg.title || vAg.name) + '</span>';
      html += '      <span class="agy-cust-badge ' + (vAg.type === "builtin" ? "builtin" : "user") + '" style="font-family:monospace;">' + esc(vAg.name) + '</span>';
      html += '    </div>';
      html += '    <div class="agy-cust-modal-desc" style="font-family:monospace; font-size:11px; opacity:.85;">' + esc(vAg.path) + '</div>';
      if (vAg.desc) {
        html += '  <div style="font-size:12px; color:var(--foreground); background:color-mix(in srgb, var(--foreground,#888) 4%, transparent); padding:8px 10px; border-radius:7px; border:1px solid var(--border,rgba(127,127,127,.2));">';
        html += '    <strong>' + esc(T("Назначение:", "Role:")) + '</strong> ' + esc(vAg.desc);
        html += '  </div>';
      }
      html += '    <div style="display:flex; flex-direction:column; gap:5px; margin-top:4px;">';
      html += '      <div style="font-size:11px; font-weight:600; color:var(--muted-foreground,#888);">' + esc(T("Системный промпт субагента:", "Subagent System Prompt:")) + '</div>';
      if (viewAgentModal.loading) {
        html += '    <div class="agy-cust-code-preview" style="text-align:center; color:var(--muted-foreground,#888); padding:32px;">' + esc(T("Загрузка конфигурации субагента...", "Loading subagent configuration...")) + '</div>';
      } else {
        html += '    <div class="agy-cust-code-preview">' + esc(vAg.body || T("(Пустой промпт)", "(Empty prompt)")) + '</div>';
      }
      html += '    </div>';
      html += '    <div class="agy-cust-modal-actions" style="margin-top:10px;">';
      html += '      <button class="agy-cust-btn primary" data-act="invoke-agent" data-agent-name="' + esc(vAg.name) + '">' + esc(T("Вызвать в чате", "Invoke in Chat")) + '</button>';
      if (vAg.type !== "builtin") {
        html += '    <button class="agy-cust-btn secondary" data-act="edit-from-view-agent" data-agent-name="' + esc(vAg.name) + '" data-agent-path="' + esc(vAg.path) + '">' + esc(T("Редактировать", "Edit")) + '</button>';
      }
      html += '      <button class="agy-cust-btn secondary" data-act="close-view-agent">' + esc(T("Закрыть", "Close")) + '</button>';
      html += '    </div>';
      html += '  </div>';
      html += '</div>';
    }

    // ------------------------------------------------------------ MODAL: Add / Edit Subagent
    if (agentModal.open) {
      var isAgEdit = agentModal.mode === "edit";
      html += '<div class="agy-cust-modal-overlay">';
      html += '  <div class="agy-cust-modal agy-cust-preview-modal">';
      html += '    <div class="agy-cust-modal-title">' + (isAgEdit ? esc(T("Редактировать субагента", "Edit Subagent")) : esc(T("Создать своего субагента", "Create Custom Subagent"))) + '</div>';
      html += '    <div class="agy-cust-modal-desc">' + esc(T("Субагент сохраняется в ~/.gemini/config/agents/<id>.md и автоматически синхронизируется с правилами агента.", "Subagent is saved in ~/.gemini/config/agents/<id>.md and synced with agent rules.")) + '</div>';
      html += '    <div class="agy-cust-modal-form">';
      html += '      <div class="agy-cust-field">';
      html += '        <label>' + esc(T("ID субагента (латиница, дефисы, например: code-reviewer)", "Subagent ID (lowercase, hyphens, e.g. code-reviewer)")) + '</label>';
      html += '        <input type="text" id="cust-agent-name" value="' + esc(agentModal.name) + '" placeholder="my-subagent" ' + (isAgEdit ? "readonly style='opacity:.75;'" : "") + '>';
      html += '      </div>';
      html += '      <div class="agy-cust-field">';
      html += '        <label>' + esc(T("Отображаемое название (Роль)", "Display Title (Role)")) + '</label>';
      html += '        <input type="text" id="cust-agent-title" value="' + esc(agentModal.title) + '" placeholder="' + esc(T("Архитектор БД / Ревьюер кода", "DB Architect / Code Reviewer")) + '">';
      html += '      </div>';
      html += '      <div class="agy-cust-field">';
      html += '        <label>' + esc(T("Краткое описание (когда вызывать этого субагента)", "Description (when to delegate to this subagent)")) + '</label>';
      html += '        <input type="text" id="cust-agent-desc" value="' + esc(agentModal.desc) + '" placeholder="' + esc(T("Вызывать для проверки кода, написания тестов...", "Delegate to this subagent when...")) + '">';
      html += '      </div>';
      html += '      <div class="agy-cust-field">';
      html += '        <label>' + esc(T("Модель субагента", "Subagent Model")) + '</label>';
      html += '        <select id="cust-agent-model" style="padding:7px 10px; border-radius:7px; border:1px solid var(--border,rgba(127,127,127,.25)); background:var(--background,#1e1e1e); color:var(--foreground,#fff); font-size:12px;">';
      [
        ["inherit", T("inherit — Наследовать текущую модель чата (Рекомендуется)", "inherit — Use current chat model (Recommended)")],
        ["pro", T("pro — Глубокое рассуждение и сложный рефакторинг", "pro — Deep reasoning & complex tasks")],
        ["flash", T("flash — Быстрый поиск, анализ и документация", "flash — Fast research, reading & docs")],
        ["flash_lite", T("flash_lite — Сверхлёгкая модель для простых проверок", "flash_lite — Ultra-light model")]
      ].forEach(function (opt) {
        html += '          <option value="' + esc(opt[0]) + '"' + (agentModal.model === opt[0] ? " selected" : "") + '>' + esc(opt[1]) + '</option>';
      });
      html += '        </select>';
      html += '      </div>';
      html += '      <div class="agy-cust-field" style="display:flex; flex-direction:column; gap:6px;">';
      html += '        <label>' + esc(T("Разрешённые группы инструментов", "Allowed Tool Groups")) + '</label>';
      html += '        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:normal;"><input type="checkbox" id="cust-agent-write" ' + (agentModal.write ? "checked" : "") + '> ' + esc(T("Разрешить запись файлов и выполнение команд терминала (enable_write_tools)", "Allow file edits & terminal commands (enable_write_tools)")) + '</label>';
      html += '        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:normal;"><input type="checkbox" id="cust-agent-mcp" ' + (agentModal.mcp ? "checked" : "") + '> ' + esc(T("Разрешить использование серверов MCP (enable_mcp_tools)", "Allow MCP server tools (enable_mcp_tools)")) + '</label>';
      html += '        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:normal;"><input type="checkbox" id="cust-agent-sub" ' + (agentModal.sub ? "checked" : "") + '> ' + esc(T("Разрешить порождать вложенных субагентов (enable_subagent_tools)", "Allow spawning nested subagents (enable_subagent_tools)")) + '</label>';
      html += '      </div>';
      html += '      <div class="agy-cust-field">';
      html += '        <label>' + esc(T("Системный промпт субагента (Markdown)", "Subagent System Prompt (Markdown)")) + '</label>';
      html += '        <textarea id="cust-agent-body" style="min-height:190px;" placeholder="# ' + esc(T("Роль субагента\n\nТы — специализированный субагент...\n\n## Правила работы:\n1. ...", "Subagent Role\n\nYou are a specialized subagent...")) + '">' + esc(agentModal.body) + '</textarea>';
      html += '      </div>';
      html += '    </div>';
      html += '    <div class="agy-cust-modal-actions">';
      html += '      <button class="agy-cust-btn secondary" data-act="close-agent-modal">' + esc(T("Отмена", "Cancel")) + '</button>';
      html += '      <button class="agy-cust-btn primary" data-act="submit-agent-modal">' + (isAgEdit ? esc(T("Сохранить субагента", "Save Subagent")) : esc(T("Создать субагента", "Create Subagent"))) + '</button>';
      html += '    </div>';
      html += '  </div>';
      html += '</div>';
    }

    // ------------------------------------------------------------ MODAL: Add Custom Plugin
    if (addPluginModal.open) {
      html += '<div class="agy-cust-modal-overlay">';
      html += '  <div class="agy-cust-modal">';
      html += '    <div class="agy-cust-modal-title">' + esc(T("Создать свой плагин", "Create Custom Plugin")) + '</div>';
      html += '    <div class="agy-cust-modal-desc">' + esc(T("Плагин создастся в ~/.gemini/config/plugins/<идентификатор> со структурой plugin.json и директорией skills/.", "Plugin will be scaffolded in ~/.gemini/config/plugins/<id> with plugin.json and skills/ folder.")) + '</div>';
      html += '    <div class="agy-cust-modal-form">';
      html += '      <div class="agy-cust-field">';
      html += '        <label>' + esc(T("Идентификатор плагина (латиница, например: my-tools-plugin)", "Plugin ID (lowercase, hyphens, e.g. my-tools-plugin)")) + '</label>';
      html += '        <input type="text" id="cust-plugin-name" placeholder="my-tools-plugin">';
      html += '      </div>';
      html += '      <div class="agy-cust-field">';
      html += '        <label>' + esc(T("Описание плагина", "Plugin Description")) + '</label>';
      html += '        <input type="text" id="cust-plugin-desc" placeholder="' + esc(T("Пакет инструментов и правил для...", "Bundle of tools and runbooks for...")) + '">';
      html += '      </div>';
      html += '    </div>';
      html += '    <div class="agy-cust-modal-actions">';
      html += '      <button class="agy-cust-btn secondary" data-act="close-add-plugin">' + esc(T("Отмена", "Cancel")) + '</button>';
      html += '      <button class="agy-cust-btn primary" data-act="submit-add-plugin">' + esc(T("Создать плагин", "Create Plugin")) + '</button>';
      html += '    </div>';
      html += '  </div>';
      html += '</div>';
    }

    root.innerHTML = html;
  }

  /* ------------------------------------------------------------ Events */
  function onClick(e) {
    var tb = e.target.closest("[data-tab]");
    if (tb) {
      activeTab = tb.getAttribute("data-tab");
      if (activeTab === "instructions" && !instructionsLoaded) {
        loadInstructions();
      }
      render();
      return;
    }

    var fp = e.target.closest("[data-filter]");
    if (fp) {
      skillFilter = fp.getAttribute("data-filter");
      render();
      return;
    }

    var btn = e.target.closest("[data-act]");
    if (!btn) {
      // Check preset click
      var pr = e.target.closest("[data-preset]");
      if (pr) {
        var pType = pr.getAttribute("data-preset");
        var appendStr = "";
        if (pType === "concise") {
          appendStr = "\n\n## Правило краткости\n- Отвечай предельно лаконично, структурированно и сразу по существу вопроса.\n- Не повторяй формулировку вопроса и избегай шаблонных вводных фраз.\n";
        } else if (pType === "strict") {
          appendStr = "\n\n## Строгая разработка\n- Всегда используй строгую типизацию, проверку ошибок и пиши готовый к продакшну код.\n- Сохраняй целостность документации и существующих комментариев.\n";
        } else if (pType === "russian") {
          appendStr = "\n\n## Язык общения\n- Всегда общайся, объясняй и комментируй код на русском языке, кроме стандартных системных идентификаторов.\n";
        }
        var txtArea = root.querySelector("#agy-cust-instr-textarea");
        if (txtArea) {
          instructionsText = (txtArea.value || "") + appendStr;
          render();
        }
        return;
      }
      return;
    }

    var act = btn.getAttribute("data-act");

    if (act === "sync-providers") {
      syncProviders();
      return;
    }

    // Subagent actions
    if (act === "open-add-agent") {
      agentModal = { open: true, mode: "create", name: "", title: "", desc: "", model: "inherit", write: true, mcp: true, sub: false, body: "" };
      render();
      return;
    }

    if (act === "close-agent-modal") {
      agentModal.open = false;
      render();
      return;
    }

    if (act === "view-agent") {
      var aPath = btn.getAttribute("data-agent-path");
      var aName = btn.getAttribute("data-agent-name");
      var aFound = agents.find(function (a) { return a.name === aName; });
      viewAgentModal = {
        open: true,
        loading: true,
        agent: aFound ? Object.assign({}, aFound, { body: "" }) : { name: aName, title: aName, path: aPath, type: "user", desc: "", body: "" }
      };
      render();
      runOp("read-agent", aPath, function () {
        render();
      });
      return;
    }

    if (act === "close-view-agent") {
      viewAgentModal.open = false;
      viewAgentModal.agent = null;
      render();
      return;
    }

    if (act === "edit-agent" || act === "edit-from-view-agent") {
      var eaPath = btn.getAttribute("data-agent-path");
      var eaName = btn.getAttribute("data-agent-name");
      viewAgentModal.open = false;
      var eaFound = agents.find(function (a) { return a.name === eaName; });
      agentModal = {
        open: true,
        mode: "edit",
        name: eaName,
        title: eaFound ? eaFound.title : eaName,
        desc: eaFound ? eaFound.desc : "",
        model: eaFound ? eaFound.model : "inherit",
        write: eaFound ? eaFound.write : true,
        mcp: eaFound ? eaFound.mcp : true,
        sub: eaFound ? eaFound.sub : false,
        body: ""
      };
      render();
      runOp("read-agent", eaPath, function () {
        render();
      });
      return;
    }

    if (act === "submit-agent-modal") {
      var anInp = root.querySelector("#cust-agent-name");
      var atInp = root.querySelector("#cust-agent-title");
      var adInp = root.querySelector("#cust-agent-desc");
      var amInp = root.querySelector("#cust-agent-model");
      var awInp = root.querySelector("#cust-agent-write");
      var acInp = root.querySelector("#cust-agent-mcp");
      var asInp = root.querySelector("#cust-agent-sub");
      var abInp = root.querySelector("#cust-agent-body");

      var agName = anInp ? anInp.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-") : "";
      var agTitle = atInp ? atInp.value.trim() : agName;
      var agDesc = adInp ? adInp.value.trim() : "";
      var agModel = amInp ? amInp.value : "inherit";
      var agWrite = (awInp && awInp.checked) ? "1" : "0";
      var agMcp = (acInp && acInp.checked) ? "1" : "0";
      var agSub = (asInp && asInp.checked) ? "1" : "0";
      var agBody = abInp ? abInp.value.trim() : "";

      if (!agName || !agDesc) {
        alert(T("Укажите ID субагента и его описание!", "Please enter subagent ID and description!"));
        return;
      }
      agentModal.open = false;
      var agRaw = [
        agName,
        toB64(agTitle || agName),
        toB64(agDesc),
        agModel,
        agWrite,
        agMcp,
        agSub,
        toB64(agBody || ("# " + (agTitle || agName) + "\n\n" + agDesc))
      ].join("|");
      runOp("add-agent", agRaw, function () {
        refreshStatus(function () {
          alert(T("Субагент " + agName + " сохранён и добавлен в реестр агента!", "Subagent " + agName + " saved!"));
        });
      });
      return;
    }

    if (act === "delete-agent") {
      var delAg = btn.getAttribute("data-agent-name");
      if (delAg && confirm(T("Удалить субагента " + delAg + "?", "Delete subagent " + delAg + "?"))) {
        runOp("delete-agent", delAg, function () {
          refreshStatus();
        });
      }
      return;
    }

    if (act === "install-preset-agent") {
      var paId = btn.getAttribute("data-agent-id");
      if (!paId) return;
      runOp("install-agent", paId, function () {
        refreshStatus(function () {
          alert(T("Субагент " + paId + " установлен и готов к вызову!", "Subagent " + paId + " installed and ready!"));
        });
      });
      return;
    }

    if (act === "invoke-agent") {
      var invName = btn.getAttribute("data-agent-name");
      var invAg = agents.find(function (a) { return a.name === invName; });
      viewAgentModal.open = false;
      invokeSubagentInChat(invAg || { name: invName, title: invName, type: "user", model: "inherit", path: "~/.gemini/config/agents/" + invName + ".md" });
      return;
    }

    // Skills actions
    if (act === "open-add-skill") {
      skillModal = { open: true, mode: "create", name: "", desc: "", body: "" };
      render();
      return;
    }

    if (act === "close-skill-modal") {
      skillModal.open = false;
      render();
      return;
    }

    if (act === "view-skill") {
      var vPath = btn.getAttribute("data-skill-path");
      var vName = btn.getAttribute("data-skill-name");
      var vType = btn.getAttribute("data-skill-type");
      var sFound = skills.find(function (s) { return s.name === vName && s.path === vPath; });
      viewModal = {
        open: true,
        loading: true,
        skill: {
          name: vName,
          path: vPath,
          type: vType,
          desc: sFound ? sFound.desc : "",
          body: ""
        }
      };
      render();
      runOp("read-skill", vPath, function () {
        render();
      });
      return;
    }

    if (act === "close-view-skill") {
      viewModal.open = false;
      viewModal.skill = null;
      render();
      return;
    }

    if (act === "copy-skill") {
      var cPath = btn.getAttribute("data-skill-path");
      var cName = btn.getAttribute("data-skill-name");
      var askName = prompt(T("Имя для копии навыка в ~/.gemini/config/skills/:", "Name for copied skill in ~/.gemini/config/skills/:"), cName + "-custom");
      if (!askName) return;
      var cleanName = askName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      runOp("copy-skill", cPath + "|" + cleanName, function () {
        refreshStatus(function () {
          alert(T("Навык успешно скопирован в пользовательские навыки: " + cleanName, "Skill successfully copied to user skills: " + cleanName));
        });
      });
      return;
    }

    if (act === "copy-from-view") {
      var cvPath = btn.getAttribute("data-skill-path");
      var cvName = btn.getAttribute("data-skill-name");
      viewModal.open = false;
      var askName2 = prompt(T("Имя для копии навыка в ~/.gemini/config/skills/:", "Name for copied skill in ~/.gemini/config/skills/:"), cvName + "-custom");
      if (!askName2) return;
      var cleanName2 = askName2.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      runOp("copy-skill", cvPath + "|" + cleanName2, function () {
        refreshStatus(function () {
          alert(T("Навык успешно скопирован в пользовательские навыки: " + cleanName2, "Skill successfully copied to user skills: " + cleanName2));
        });
      });
      return;
    }

    if (act === "edit-skill") {
      var ePath = btn.getAttribute("data-skill-path");
      var eName = btn.getAttribute("data-skill-name");
      var ef = skills.find(function (s) { return s.name === eName; });
      skillModal = {
        open: true,
        mode: "edit",
        name: eName,
        desc: ef ? ef.desc : "",
        body: ""
      };
      render();
      runOp("read-skill", ePath, function () {
        render();
      });
      return;
    }

    if (act === "edit-from-view") {
      var evPath = btn.getAttribute("data-skill-path");
      var evName = btn.getAttribute("data-skill-name");
      viewModal.open = false;
      var evFound = skills.find(function (s) { return s.name === evName; });
      skillModal = {
        open: true,
        mode: "edit",
        name: evName,
        desc: evFound ? evFound.desc : "",
        body: ""
      };
      render();
      runOp("read-skill", evPath, function () {
        render();
      });
      return;
    }

    if (act === "submit-skill-modal") {
      var nInp = root.querySelector("#cust-skill-name");
      var dInp = root.querySelector("#cust-skill-desc");
      var bInp = root.querySelector("#cust-skill-body");
      var sName = nInp ? nInp.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-") : "";
      var sDesc = dInp ? dInp.value.trim() : "";
      var sBody = bInp ? bInp.value.trim() : "";

      if (!sName || !sDesc) {
        alert(T("Укажите идентификатор и описание триггера навыка!", "Please enter skill ID and trigger description!"));
        return;
      }
      skillModal.open = false;
      var raw = sName + "|" + toB64(sDesc) + "|" + toB64(sBody || "# " + sName);
      runOp("add-skill", raw, function () {
        refreshStatus(function () {
          alert(T("Навык успешно сохранен!", "Skill successfully saved!"));
        });
      });
      return;
    }

    if (act === "delete-skill") {
      var delName = btn.getAttribute("data-skill");
      if (delName && confirm(T("Удалить навык " + delName + "?", "Delete skill " + delName + "?"))) {
        runOp("delete-skill", delName, function () {
          refreshStatus();
        });
      }
      return;
    }

    // Instructions actions
    if (act === "save-instructions") {
      var txtEl = root.querySelector("#agy-cust-instr-textarea");
      if (txtEl) {
        instructionsText = txtEl.value;
      }
      var b64 = toB64(instructionsText);
      runOp("save-instructions", b64, function () {
        alert(T("Инструкции AGENTS.md успешно сохранены!", "Instructions AGENTS.md saved successfully!"));
      });
      return;
    }

    if (act === "reset-instructions") {
      if (confirm(T("Восстановить AGENTS.md к стандартным правилам Android Antigravity?", "Restore AGENTS.md to default Android rules?"))) {
        runOp("reset-instructions", "", function () {
          loadInstructions();
        });
      }
      return;
    }

    if (act === "reload-instructions") {
      loadInstructions();
      return;
    }

    // Plugins actions
    if (act === "install-preset") {
      var pId = btn.getAttribute("data-plugin");
      if (!pId) return;
      runOp("install-plugin", pId, function () {
        refreshStatus(function () {
          alert(T("Плагин " + pId + " успешно установлен и активирован!", "Plugin " + pId + " installed and activated!"));
        });
      });
      return;
    }

    if (act === "uninstall-plugin") {
      var uId = btn.getAttribute("data-plugin");
      if (uId && confirm(T("Удалить плагин " + uId + " из ~/.gemini/config/plugins/?", "Uninstall plugin " + uId + "?"))) {
        runOp("uninstall-plugin", uId, function () {
          refreshStatus();
        });
      }
      return;
    }

    if (act === "open-add-plugin") {
      addPluginModal = { open: true, name: "", desc: "" };
      render();
      return;
    }

    if (act === "close-add-plugin") {
      addPluginModal.open = false;
      render();
      return;
    }

    if (act === "submit-add-plugin") {
      var pnInp = root.querySelector("#cust-plugin-name");
      var pdInp = root.querySelector("#cust-plugin-desc");
      var pName = pnInp ? pnInp.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-") : "";
      var pDesc = pdInp ? pdInp.value.trim() : "";

      if (!pName) {
        alert(T("Укажите идентификатор плагина!", "Please enter plugin ID!"));
        return;
      }
      addPluginModal.open = false;
      runOp("install-plugin", pName, function () {
        refreshStatus(function () {
          alert(T("Плагин " + pName + " создан в ~/.gemini/config/plugins/" + pName, "Plugin " + pName + " created!"));
        });
      });
      return;
    }

    if (act === "restart-core") {
      if (window.AgyProviders && typeof window.AgyProviders.restartCore === "function") {
        window.AgyProviders.restartCore();
        alert(T("Ядро перезапущено. Изменения плагинов применены.", "Core restarted. Plugin changes applied."));
      } else {
        alert(T("Перезапустите приложение для применения настроек.", "Restart application to apply settings."));
      }
      return;
    }
  }

  function onInput(e) {
    if (e.target.matches("[data-act='search-skills']")) {
      searchQuery = e.target.value;
      var pos = e.target.selectionStart;
      render();
      var reInp = root.querySelector("[data-act='search-skills']");
      if (reInp) {
        reInp.focus();
        reInp.setSelectionRange(pos, pos);
      }
      return;
    }
    if (e.target.id === "agy-cust-instr-textarea") {
      instructionsText = e.target.value;
    }
  }

  function onChange(e) {
    if (e.target.matches("[data-act='toggle-prov']")) {
      toggleProviderTools(e.target.checked);
      return;
    }

    if (e.target.matches("[data-act='toggle-skill']")) {
      var sName = e.target.getAttribute("data-skill");
      var en = e.target.checked ? "1" : "0";
      runOp("toggle-skill", sName + " " + en, function () {
        refreshStatus();
      });
      return;
    }

    if (e.target.matches("[data-act='toggle-agent']")) {
      var aName = e.target.getAttribute("data-agent");
      var aEn = e.target.checked ? "1" : "0";
      runOp("toggle-agent", aName + " " + aEn, function () {
        refreshStatus();
      });
      return;
    }

    if (e.target.matches("[data-act='toggle-plugin']")) {
      var pName = e.target.getAttribute("data-plugin");
      var en = e.target.checked ? "1" : "0";
      runOp("toggle-plugin", pName + " " + en, function () {
        refreshStatus();
      });
      return;
    }
  }

  /* ------------------------------------------------------------ Mount */
  window.__agyCustomizationsMount = function (el) {
    if (!el) return;
    if (root && root.parentElement === el && el.children.length === 1) {
      render();
      return;
    }
    el.innerHTML = "";
    host = el;
    root = document.createElement("div");
    root.className = "agy-cust";
    root.setAttribute("data-agy-no-translate", "");
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    host.appendChild(root);

    refreshStatus();
    render();
  };
})();
