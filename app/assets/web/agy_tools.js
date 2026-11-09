/* Antigravity RU — Settings › Tools (ТЗ 9.3, B-22).
 * Rendered into the "Tools" settings screen (main.js calls
 * window.__agyToolsMount(el)). Every action goes through the native
 * window.AgyTools bridge, which runs the bundled agy-tools.sh with a
 * validated operation; the page only polls the job log. */
(function () {
  "use strict";
  if (window.__agyToolsReady) return;
  window.__agyToolsReady = true;

  function ru() {
    try { return window.__agyI18n ? window.__agyI18n.getLanguage() === "ru" : true; } catch (e) { return true; }
  }
  function T(r, e) { return ru() ? r : e; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }

  /* ------------------------------------------------------------ catalog */
  // kind: pkg (Termux package via pkg), npm (global npm), sdk (sdkmanager id), ndk (full NDK)
  var GROUPS = [
    { id: "node", ru: "Node.js — плагины и расширения", en: "Node.js — plugins and extensions", items: [
      { id: "nodejs-lts", kind: "pkg", ru: "Node.js LTS + npm", en: "Node.js LTS + npm", dru: "Рекомендуется. Нужен для плагинов, MCP-серверов и расширений.", den: "Recommended. Required by plugins, MCP servers and extensions.", verify: "node-lts,npm" },
      { id: "nodejs", kind: "pkg", ru: "Node.js (текущая версия)", en: "Node.js (current)", dru: "Вместо LTS, если нужна самая новая версия. Не ставить вместе с LTS.", den: "Instead of LTS when the newest version is needed. Do not install together with LTS.", verify: "node-current,npm" },
      { id: "yarn", kind: "pkg", ru: "Yarn", en: "Yarn", dru: "Менеджер пакетов JavaScript.", den: "JavaScript package manager." },
      { id: "pnpm", kind: "npm", ru: "pnpm", en: "pnpm", dru: "Устанавливается через npm -g.", den: "Installed with npm -g.", verify: "pnpm" },
      { id: "typescript", kind: "npm", ru: "TypeScript (tsc)", en: "TypeScript (tsc)", dru: "Компилятор TypeScript через npm -g.", den: "TypeScript compiler via npm -g.", verify: "tsc" }
    ] },
    { id: "build", ru: "Сборка нативного кода", en: "Native build tools", items: [
      { id: "clang", kind: "pkg", ru: "Clang / LLVM", en: "Clang / LLVM", dru: "C/C++ компилятор; нужен node-gyp и NDK-сборкам.", den: "C/C++ compiler; needed by node-gyp and NDK builds.", verify: "clang" },
      { id: "lld", kind: "pkg", ru: "LLD", en: "LLD", dru: "Линкер LLVM.", den: "LLVM linker." },
      { id: "make", kind: "pkg", ru: "Make", en: "Make", dru: "", den: "" },
      { id: "cmake", kind: "pkg", ru: "CMake", en: "CMake", dru: "", den: "", verify: "cmake" },
      { id: "ninja", kind: "pkg", ru: "Ninja", en: "Ninja", dru: "", den: "" },
      { id: "pkg-config", kind: "pkg", ru: "pkg-config", en: "pkg-config", dru: "", den: "" },
      { id: "binutils", kind: "pkg", ru: "Binutils", en: "Binutils", dru: "objdump, readelf, strip…", den: "objdump, readelf, strip…" },
      { id: "python", kind: "pkg", ru: "Python 3", en: "Python 3", dru: "Нужен node-gyp и многим скриптам.", den: "Needed by node-gyp and many scripts.", verify: "python" },
      { id: "python-pip", kind: "pkg", ru: "pip", en: "pip", dru: "", den: "" }
    ] },
    { id: "java", ru: "Java и Kotlin", en: "Java and Kotlin", items: [
      { id: "openjdk-17", kind: "pkg", ru: "OpenJDK 17", en: "OpenJDK 17", dru: "Для Gradle и Android Gradle Plugin 8.x.", den: "For Gradle and Android Gradle Plugin 8.x.", verify: "java17,javac17" },
      { id: "openjdk-21", kind: "pkg", ru: "OpenJDK 21", en: "OpenJDK 21", dru: "Новее; AGP 8.x работает и с 17.", den: "Newer; AGP 8.x works with 17 as well.", verify: "java21,javac21" },
      { id: "kotlin", kind: "pkg", ru: "Kotlin (kotlinc)", en: "Kotlin (kotlinc)", dru: "", den: "", verify: "kotlin" },
      { id: "gradle", kind: "pkg", ru: "Gradle", en: "Gradle", dru: "Сборка Android-проектов.", den: "Builds Android projects.", verify: "gradle" },
      { id: "maven", kind: "pkg", ru: "Maven", en: "Maven", dru: "", den: "" }
    ] },
    { id: "android", ru: "Android: сборка APK", en: "Android: APK build", items: [
      { id: "aapt", kind: "pkg", ru: "aapt + zipalign", en: "aapt + zipalign", dru: "Упаковка ресурсов и выравнивание APK.", den: "Resource packaging and APK alignment; zipalign is included in aapt.", verify: "aapt,zipalign" },
      { id: "aapt2", kind: "pkg", ru: "aapt2", en: "aapt2", dru: "Обработка ресурсов Android.", den: "Native aapt2 — Gradle uses it instead of the x86 build.", verify: "aapt2" },
      { id: "aidl", kind: "pkg", ru: "aidl", en: "aidl", dru: "Нативный компилятор интерфейсов AIDL.", den: "Native AIDL interface compiler.", verify: "aidl" },
      { id: "d8", kind: "pkg", ru: "d8", en: "d8", dru: "Компиляция в DEX.", den: "DEX compiler.", verify: "d8" },
      { id: "apksigner", kind: "pkg", ru: "apksigner", en: "apksigner", dru: "Подпись APK v1–v4.", den: "APK signing v1–v4.", verify: "apksigner" },
      { id: "android-tools", kind: "pkg", ru: "adb / fastboot", en: "adb / fastboot", dru: "Отладка по Wi-Fi и через Shizuku.", den: "Debugging over Wi-Fi and via Shizuku.", verify: "adb" },
      { id: "apktool", kind: "pkg", ru: "apktool", en: "apktool", dru: "Разбор и сборка APK.", den: "Decode and rebuild APKs." },
      { id: "jadx", kind: "pkg", ru: "jadx", en: "jadx", dru: "Декомпилятор DEX → Java.", den: "DEX → Java decompiler." }
    ] },
    { id: "sdk", ru: "Android SDK", en: "Android SDK", note: { ru: "Загружается с dl.google.com через sdkmanager. Нужен OpenJDK — поставится сам. x86-бинарники build-tools заменяются нативными aapt/aapt2/zipalign.", en: "Downloaded from dl.google.com with sdkmanager. Needs OpenJDK (installed automatically). x86 build-tools binaries are replaced with native aapt/aapt2/zipalign." }, items: [
      { id: "platforms;android-37.1", kind: "sdk", ru: "Платформа Android API 37.1", en: "Android platform API 37.1", dru: "", den: "" },
      { id: "platforms;android-37.0", kind: "sdk", ru: "Платформа Android API 37.0", en: "Android platform API 37.0", dru: "", den: "" },
      { id: "platforms;android-36", kind: "sdk", ru: "Платформа Android 16 (API 36)", en: "Android 16 platform (API 36)", dru: "", den: "" },
      { id: "platforms;android-35", kind: "sdk", ru: "Платформа Android 15 (API 35)", en: "Android 15 platform (API 35)", dru: "android.jar для компиляции.", den: "android.jar for compilation." },
      { id: "platforms;android-34", kind: "sdk", ru: "Платформа Android 14 (API 34)", en: "Android 14 platform (API 34)", dru: "", den: "" },
      { id: "build-tools;37.0.0", kind: "sdk", ru: "Build-tools 37.0.0", en: "Build-tools 37.0.0", dru: "", den: "" },
      { id: "build-tools;36.0.0", kind: "sdk", ru: "Build-tools 36.0.0", en: "Build-tools 36.0.0", dru: "", den: "" },
      { id: "build-tools;35.0.0", kind: "sdk", ru: "Build-tools 35.0.0", en: "Build-tools 35.0.0", dru: "Нужны Gradle (d8, lib).", den: "Required by Gradle (d8, lib)." },
      { id: "build-tools;34.0.0", kind: "sdk", ru: "Build-tools 34.0.0", en: "Build-tools 34.0.0", dru: "", den: "" }
    ] },
    { id: "ndk", ru: "Android NDK", en: "Android NDK", items: [
      { id: "ndk-sysroot", kind: "pkg", ru: "NDK sysroot", en: "NDK sysroot", dru: "Заголовки и библиотеки Android для clang.", den: "Android headers and libraries for clang." },
      { id: "ndk-multilib", kind: "pkg", ru: "NDK multilib", en: "NDK multilib", dru: "Библиотеки для arm, x86, x86_64.", den: "Libraries for arm, x86, x86_64." },
      { id: "ndk-full", kind: "ndk", ru: "Полный NDK (сборка Termux)", en: "Full NDK (Termux build)", dru: "Инструменты для нативных Android-сборок.", den: "ndk-build and CMake toolchain for Gradle. ~1 GB, from github.com/lzhiyong/termux-ndk.", verify: "ndk" }
    ] },
    { id: "flutter", ru: "Flutter & Dart", en: "Flutter & Dart", note: { ru: "Кроссплатформенный SDK для создания Android/Web-приложений. Автоматически настраивается для Android bionic через agy-fix-flutter.", en: "Cross-platform SDK for Android/Web apps. Automatically patched for Android bionic userspace via agy-fix-flutter." }, items: [
      { id: "flutter-sdk", kind: "flutter", ru: "Flutter SDK (stable)", en: "Flutter SDK (stable)", dru: "SDK для Flutter-приложений.", den: "Flutter SDK + Dart + bionic libc autopatch.", verify: "flutter,dart" }
    ] },
    { id: "lang", ru: "Другие языки", en: "Other languages", items: [
      { id: "rust", kind: "pkg", ru: "Rust (cargo)", en: "Rust (cargo)", dru: "", den: "", verify: "rust" },
      { id: "golang", kind: "pkg", ru: "Go", en: "Go", dru: "", den: "", verify: "go" }
    ] },
    { id: "util", ru: "Git и утилиты", en: "Git and utilities", items: [
      { id: "git", kind: "pkg", ru: "Git", en: "Git", dru: "", den: "", verify: "git" },
      { id: "gh", kind: "pkg", ru: "GitHub CLI", en: "GitHub CLI", dru: "", den: "" },
      { id: "openssh", kind: "pkg", ru: "OpenSSH", en: "OpenSSH", dru: "", den: "" },
      { id: "curl", kind: "pkg", ru: "curl", en: "curl", dru: "", den: "" },
      { id: "wget", kind: "pkg", ru: "wget", en: "wget", dru: "", den: "" },
      { id: "zip", kind: "pkg", ru: "zip", en: "zip", dru: "", den: "" },
      { id: "unzip", kind: "pkg", ru: "unzip", en: "unzip", dru: "", den: "" },
      { id: "jq", kind: "pkg", ru: "jq", en: "jq", dru: "", den: "" },
      { id: "ripgrep", kind: "pkg", ru: "ripgrep (rg)", en: "ripgrep (rg)", dru: "", den: "" },
      { id: "fd", kind: "pkg", ru: "fd", en: "fd", dru: "", den: "" },
      { id: "tree", kind: "pkg", ru: "tree", en: "tree", dru: "", den: "" }
    ] }
  ];
  var PRESETS = [
    { id: "plugins", ru: "Плагины приложения", en: "App plugins", dru: "Node.js LTS, Python, clang, make", den: "Node.js LTS, Python, clang, make",
      items: ["nodejs-lts", "python", "clang", "make", "pkg-config"] },
    { id: "apk", ru: "Android-приложение (Gradle)", en: "Android app (Gradle)", dru: "OpenJDK 17, Gradle, Kotlin, aapt2, d8, apksigner, SDK 35", den: "OpenJDK 17, Gradle, Kotlin, aapt2, d8, apksigner, SDK 35",
      items: ["openjdk-17", "gradle", "kotlin", "aapt", "aapt2", "d8", "apksigner", "android-tools", "platforms;android-35", "build-tools;35.0.0"] },
    { id: "native", ru: "Нативный код (NDK)", en: "Native code (NDK)", dru: "clang, CMake, Ninja, NDK sysroot/multilib", den: "clang, CMake, Ninja, NDK sysroot/multilib",
      items: ["clang", "lld", "cmake", "ninja", "make", "ndk-sysroot", "ndk-multilib"] }
  ];
  var ITEMS = {};
  GROUPS.forEach(function (g) { g.items.forEach(function (it) { it.group = g.id; ITEMS[it.id] = it; }); });

  /* ------------------------------------------------------------ state */
  var host = null, root = null;
  var status = {};          // id -> {avail, inst}
  var special = { cmdline: false, platforms: {}, buildtools: {}, ndk: [], flutter: false };
  var checks = {};          // verify name -> {ok, text}
  var selected = {};
  var versionOpen = {};
  var batchLog = "";
  var job = null;           // {id, op, label, log, rc}
  var queue = [];
  var logOpen = false;
  var loaded = false;

  function bridge() { return window.AgyTools && typeof window.AgyTools.start === "function" ? window.AgyTools : null; }

  function installed(it) {
    if (it.kind === "pkg") { var s = status[it.id]; return !!(s && s.inst && s.inst !== "-"); }
    if (it.kind === "sdk") { var p = it.id.split(";"); return (p[0] === "platforms" ? special.platforms[p[1]] : special.buildtools[p[1]]) === true; }
    if (it.kind === "ndk") return special.ndk.length > 0;
    if (it.kind === "flutter") return !!special.flutter;
    if (it.kind === "npm") { var n = status["npm:" + it.id]; return !!(n && n.inst); }
    return false;
  }
  function availability(it) {
    if (it.kind !== "pkg") return true;
    var s = status[it.id];
    return !hasIndex || !s || s.avail !== "-";
  }

  /* ------------------------------------------------------------ jobs */
  function run(op, arg, label, after, continueOnFailure) {
    queue.push({ op: op, arg: arg || "", label: label, after: after, continueOnFailure: !!continueOnFailure });
    if (!job) next();
    render();
  }
  function next() {
    var q = queue.shift();
    if (!q) { job = null; render(); return; }
    var b = bridge();
    if (!b) { job = { op: q.op, label: q.label, log: T("Нативный мост AgyTools недоступен.", "Native AgyTools bridge is not available."), rc: "1", after: q.after, continueOnFailure: q.continueOnFailure }; finish(); return; }
    var id = b.start(q.op, q.arg);
    if (!id || /^ERR/.test(id)) {
      job = { op: q.op, label: q.label, log: T("Не удалось запустить: ", "Could not start: ") + String(id), rc: "1", after: q.after, continueOnFailure: q.continueOnFailure };
      finish();
      return;
    }
    job = { id: id, op: q.op, arg: q.arg, label: q.label, log: "", rc: "", after: q.after, continueOnFailure: q.continueOnFailure, t0: Date.now() };
    lastLogChange = Date.now();
    store("agyToolsJob", JSON.stringify({ id: id, op: q.op, arg: q.arg, label: q.label, t0: job.t0 }));

    poll();
  }
  var pollTimer = 0;
  var lastLogChange = 0;
  function poll() {
    clearTimeout(pollTimer);
    if (!job || !job.id) return;
    var b = bridge(); if (!b) return;
    var r = {};
    try { r = JSON.parse(b.read(job.id) || "{}"); } catch (e) {}
    var prevLen = (job.log || "").length;
    job.log = r.log || job.log || "";
    if (job.log.length !== prevLen) lastLogChange = Date.now();
    if (r.rc !== undefined && r.rc !== "") { job.rc = r.rc; finish(); return; }
    var now = Date.now();
    var jobAge = job.t0 ? (now - job.t0) : 0;
    var stallTime = lastLogChange ? (now - lastLogChange) : jobAge;
    // Silent package and SDK operations may take minutes. A UI-only timeout
    // cannot stop the native process and must not start the next queued job.
    renderLog();
    pollTimer = setTimeout(poll, job.op === "status" ? 400 : 700);
  }
  function finish() {
    var j = job;
    store("agyToolsJob", null);
    parse(j);
    if (j.rc !== "0" && !QUIET[j.op] && !j.continueOnFailure) {
      // Stop subsequent changes; still refresh the actual installed state.
      queue = queue.filter(function (q) { return q.op === "status"; });
    }
    if ((j.op !== "status" && j.op !== "verify") || j.rc !== "0") {
      j.done = true;
      if (hiddenJob !== j || j.rc !== "0") lastDone = j;
      if (j.rc !== "0") logOpen = true;
    }
    if (hiddenJob === j) hiddenJob = null;
    if (typeof j.after === "function") { try { j.after(j); } catch (e) {} }
    job = null;
    next();
    render();
  }
  var lastDone = null, hiddenJob = null;

  function parse(j) {
    if (j.op === "status") special = { cmdline: false, platforms: {}, buildtools: {}, ndk: [], flutter: false };
    (j.log || "").split("\n").forEach(function (line) {
      var m;
      if ((m = /^@@pkg (\S+) (\S+) (\S+)/.exec(line))) status[m[1]] = { avail: m[2], inst: m[3] };
      else if ((m = /^@@special cmdline-tools (\S+)/.exec(line))) special.cmdline = m[1] === "ok";
      else if ((m = /^@@special platform (\S+)(?: (\S+))?/.exec(line))) special.platforms[m[1]] = m[2] === "incomplete" ? "incomplete" : true;
      else if ((m = /^@@special build-tools (\S+)(?: (\S+))?/.exec(line))) special.buildtools[m[1]] = m[2] === "incomplete" ? "incomplete" : true;
      else if ((m = /^@@special ndk (\S+)/.exec(line))) { if (special.ndk.indexOf(m[1]) < 0) special.ndk.push(m[1]); }
      else if ((m = /^@@special flutter (\S+)/.exec(line))) special.flutter = m[1] === "ok";
      else if ((m = /^@@(ok|fail) (\S+) ?(.*)$/.exec(line))) checks[m[2]] = { ok: m[1] === "ok", text: m[3] };
      else if ((m = /^@@npm (\S+) (\S+)/.exec(line))) status["npm:" + m[1]] = { inst: m[2] !== "-" };
      else if ((m = /^@@index (\S+)/.exec(line))) hasIndex = m[1] === "ok";
    });
    saveCache();
  }
  var hasIndex = true;
  function saveCache() {
    store("agyToolsCache", JSON.stringify({ t: Date.now(), status: status, special: special, checks: checks, hasIndex: hasIndex }));
  }
  function loadCache() {
    var c = null;
    try { c = JSON.parse(store("agyToolsCache") || "null"); } catch (e) {}
    if (!c) return false;
    status = c.status || {}; special = c.special || special; checks = c.checks || {};
    hasIndex = c.hasIndex !== false || Object.keys(status).length > 0;
    loaded = true;
    return true;
  }

  function refresh(withVerify, afterStatus) {
    var names = [];
    GROUPS.forEach(function (g) { g.items.forEach(function (it) { if (it.kind === "pkg") names.push(it.id); }); });
    run("status", names.join(","), T("Обновление состояния", "Refreshing status"), function () {
      loaded = true;
      if (afterStatus) afterStatus();
      if (!withVerify) return;
      var v = [];
      GROUPS.forEach(function (g) { g.items.forEach(function (it) { if (it.verify && installed(it)) v = v.concat(it.verify.split(",")); }); });
      v = v.filter(function (x, i) { return v.indexOf(x) === i; });
      if (v.length) run("verify", v.join(","), T("Самопроверка", "Self-test"));
    });
  }

  function nodeConflict(ids) {
    var wantLts = ids.indexOf("nodejs-lts") >= 0, wantCurrent = ids.indexOf("nodejs") >= 0;
    if (wantLts && (wantCurrent || installed(ITEMS.nodejs))) return T("Чтобы установить Node.js LTS, сначала удалите другую версию Node.js и снимите её выбор. Версии используют общие файлы npm.", "To install Node.js LTS, remove the other Node.js version and deselect it first. Both versions share npm files.");
    if (wantCurrent && installed(ITEMS["nodejs-lts"])) return T("Чтобы установить другую версию Node.js, сначала удалите Node.js LTS. Версии используют общие файлы npm.", "To install the other Node.js version, remove Node.js LTS first. Both versions share npm files.");
    return "";
  }
  function installIds(ids) {
    var conflict = nodeConflict(ids); if (conflict) { alert(conflict); return; }
    batchLog = ""; logOpen = true;
    var pk = [], sdk = [], npm = [], ndk = false, flutter = false;
    var failures = [];
    function recordFailure(j) {
      if (!j) return;
      batchLog += "\n== " + (j.label || j.op) + "\n" + (j.log || "") + "\n";
      if (String(j.rc) === "0") return;
      failures.push((j.label || j.op) + "\n" + (j.log || T("Ошибка запуска", "Failed to start")));
    }
    ids.forEach(function (id) {
      var it = ITEMS[id]; if (!it) return;
      if (it.kind === "pkg") { if (availability(it)) pk.push(id); }
      else if (it.kind === "sdk") sdk.push(id);
      else if (it.kind === "npm") npm.push(id);
      else if (it.kind === "ndk") ndk = true;
      else if (it.kind === "flutter") flutter = true;
    });
    if (pk.length) run("install", pk.join(" "), T("Установка: ", "Install: ") + pk.join(", "), recordFailure, true);
    if (npm.length) run("npm", npm.join(" "), "npm -g " + npm.join(" "), recordFailure, true);
    if (sdk.length) run("sdk", sdk.join(" "), "sdkmanager " + sdk.join(" "), recordFailure, true);
    if (ndk) run("ndk", "", T("Полный NDK", "Full NDK"), recordFailure, true);
    if (flutter) run("flutter", "", T("Flutter SDK", "Flutter SDK"), recordFailure, true);
    refresh(true, function () {
      if (batchLog) {
        lastDone = {op: "install", label: failures.length ? T("Ошибки установки", "Installation errors") : T("Установка завершена", "Installation complete"), rc: failures.length ? "1" : "0", log: batchLog};
        logOpen = true;
      }
    });
  }
  function removeId(id) {
    var it = ITEMS[id]; if (!it) return;
    if (it.kind === "pkg") run("remove", id, T("Удаление: ", "Remove: ") + id);
    else if (it.kind === "sdk") run("sdkremove", id, T("Удаление: ", "Remove: ") + id);
    else if (it.kind === "ndk") run("ndkremove", "", T("Удаление NDK", "Remove NDK"));
    else if (it.kind === "flutter") run("flutterremove", "", T("Удаление Flutter SDK", "Remove Flutter SDK"));
    else return;
    refresh(true);
  }

  /* ------------------------------------------------------------ render */
  function verified(it) {
    if (!installed(it)) return false;
    if (!it.verify) return true;
    return it.verify.split(",").every(function (v) { return checks[v] && checks[v].ok; });
  }
  function needsPresetInstall(it) {
    if (!installed(it)) return true;
    return !!(it.verify && it.verify.split(",").some(function (v) { return checks[v] && !checks[v].ok; }));
  }
  function badge(it) {
    if (job && job.arg && (" " + job.arg.replace(/,/g, " ") + " ").indexOf(" " + it.id + " ") >= 0 && /install|sdk|npm/.test(job.op))
      return '<span class="agy-t-badge run">' + esc(T("Устанавливается…", "Installing…")) + "</span>";
    if (it.kind === "pkg") {
      var s = status[it.id];
      if (!loaded || !s) return '<span class="agy-t-badge">…</span>';
      if (s.inst !== "-" && it.verify && it.verify.split(",").some(function (v) { return checks[v] && !checks[v].ok; })) return '<span class="agy-t-badge off">' + esc(T("Ошибка проверки", "Check failed")) + "</span>";
      if (s.inst !== "-") return '<span class="agy-t-badge ok">' + esc(T("Установлено ", "Installed ") + s.inst) + "</span>";
      if (s.avail === "-") return '<span class="agy-t-badge off">' + esc(T("Нет в репозитории", "Not in repository")) + "</span>";
      return '<span class="agy-t-badge">' + esc(T("Доступно ", "Available ") + s.avail) + "</span>";
    }
    if (!loaded) return '<span class="agy-t-badge">…</span>';
    if (it.kind === "sdk") { var p = it.id.split(";"); if ((p[0] === "platforms" ? special.platforms[p[1]] : special.buildtools[p[1]]) === "incomplete") return '<span class="agy-t-badge off">' + esc(T("Не хватает файлов", "Missing files")) + '</span>'; }
    return installed(it) ? '<span class="agy-t-badge ok">' + esc(T("Установлено", "Installed")) + "</span>"
                         : '<span class="agy-t-badge">' + esc(T("Не установлено", "Not installed")) + "</span>";
  }
  function checkLine(it) {
    if (!it.verify || !installed(it)) return "";
    var failed = it.verify.split(",").some(function(v) { return checks[v] && !checks[v].ok; });
    return failed ? '<div class="agy-t-check bad">' + esc(T("Ошибка проверки — откройте журнал", "Check failed — open the log")) + '</div>' : "";
  }
  var VERSION_GROUPS = {
    node: [{title: ["Node.js", "Node.js"], ids: ["nodejs-lts", "nodejs"]}],
    java: [{title: ["OpenJDK", "OpenJDK"], ids: ["openjdk-17", "openjdk-21"]}],
    sdk: [{title: ["Платформа Android", "Android platform"], ids: ["platforms;android-37.1", "platforms;android-37.0", "platforms;android-36", "platforms;android-35", "platforms;android-34"]},
          {title: ["Android Build-tools", "Android Build-tools"], ids: ["build-tools;37.0.0", "build-tools;36.0.0", "build-tools;35.0.0", "build-tools;34.0.0"]}]
  };

  function render() {
    if (!root || !root.isConnected) return;
    var busy = !!job || queue.length > 0;
    var nsel = Object.keys(selected).filter(function (k) { return selected[k]; }).length;
    var h = '<div class="agy-t-head"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><div class="agy-t-title">' + esc(T("Инструменты", "Tools")) + '</div><button type="button" class="agy-t-btn sec" data-act="tools-menu" aria-label="' + esc(T("Меню инструментов", "Tools menu")) + '">☰</button></div>' +
      '<div class="agy-t-sub">' + esc(T("Компоненты для разработки прямо в приложении: Node.js для плагинов, Java, Android SDK/NDK, компиляторы. Устанавливаются в окружение агента и сразу доступны ему.", "Development components inside the app: Node.js for plugins, Java, Android SDK/NDK, compilers. Installed into the agent environment and available to it right away.")) + "</div>" +
      '<div class="agy-t-actions"><button type="button" data-act="refresh"' + (busy ? " disabled" : "") + ">" + esc(T("Проверить", "Check")) + "</button>" +
      '<button type="button" data-act="upgrade"' + (busy ? " disabled" : "") + ">" + esc(T("Обновить всё", "Upgrade all")) + "</button>" +
      '<button type="button" data-act="selftest-save"' + (busy ? " disabled" : "") + ">" + esc(T("Тест сохранения", "Save test")) + "</button></div></div>"; /* AGY-P1-5-SELFTEST */

    h += '<div class="agy-t-job" hidden>' +
      '<div class="agy-t-jtop"><span class="agy-t-jicon"></span><span class="agy-t-jlabel"></span><span class="agy-t-jpct"></span><button type="button" class="agy-t-jcancel" data-act="cancel-job" title="' + esc(T("Закрыть окно", "Close panel")) + '">✕</button></div>' +
      '<div class="agy-t-pbar"><div class="agy-t-pfill"></div></div>' +
      '<div class="agy-t-jrow"><span class="agy-t-jphase"></span><span class="agy-t-jtime"></span></div>' +
      '<div class="agy-t-jfacts"></div>' +
      '<div class="agy-t-jrow"><span class="agy-t-jtail"></span><button type="button" class="agy-t-jlog" data-act="log"></button><button type="button" data-act="copy-log">' + esc(T("Копировать", "Copy")) + '</button></div>' +
      '<pre class="agy-t-log" hidden></pre></div>';
    if (loaded && !hasIndex && Object.keys(status).length === 0) h += '<div class="agy-t-warn">' + esc(T("Список пакетов ещё не загружен — состояние неполное.", "Package list is not downloaded yet — status is incomplete.")) +
      ' <button type="button" class="agy-t-btn" data-act="index"' + (busy ? " disabled" : "") + ">" + esc(T("Загрузить", "Download")) + "</button></div>";
    if (!bridge()) h += '<div class="agy-t-warn">' + esc(T("Нативный мост недоступен в этой сборке.", "Native bridge is not available in this build.")) + "</div>";

    h += '<div class="agy-t-sec">' + esc(T("Готовые наборы", "Presets")) + "</div>";
    PRESETS.forEach(function (p) {
      var all = p.items.every(function (id) { var it = ITEMS[id]; return it && !needsPresetInstall(it); });
      var pending = p.items.filter(function (id) { var it = ITEMS[id]; return it && availability(it) && needsPresetInstall(it); }).length;
      h += '<div class="agy-t-card"><div class="agy-t-main"><div class="agy-t-name">' + esc(T(p.ru, p.en)) + '</div><div class="agy-t-desc">' + esc(T(p.dru, p.den)) + ' · ' + esc(T("В наборе: ", "In preset: ") + p.items.length) + (loaded && !busy && pending ? ' · ' + esc(T("К установке: ", "To install: ") + pending) : '') + "</div></div>" +
        (all ? '<span class="agy-t-badge ok">' + esc(T("Готово", "Ready")) + "</span>"
             : '<button type="button" class="agy-t-btn" data-preset="' + p.id + '"' + (busy ? " disabled" : "") + ">" + esc(T("Установить", "Install")) + "</button>") + "</div>";
    });

    GROUPS.forEach(function (g) {
      h += '<div class="agy-t-sec">' + esc(T(g.ru, g.en)) + "</div>";
      if (g.id === "sdk") h += '<div class="agy-t-note">' + esc(T("Платформы и инструменты сборки Android.", "Android platforms and build tools.")) + "</div>";
      if (g.id === "flutter") h += '<div class="agy-t-note">' + esc(T("SDK для разработки Flutter-приложений.", "SDK for Flutter development.")) + "</div>";
      h += '<div class="agy-t-group">';
      function renderItem(it) {
        var inst = installed(it), av = availability(it);
        h += '<div class="agy-t-row">' +
          '<label class="agy-t-chk"><input type="checkbox" data-sel="' + esc(it.id) + '"' + (selected[it.id] ? " checked" : "") + (inst || !av || busy ? " disabled" : "") + "></label>" +
          '<div class="agy-t-main"><div class="agy-t-name">' + esc(T(it.ru, it.en)) + " " + badge(it) + "</div>" +
          (T(it.dru, it.den) ? '<div class="agy-t-desc">' + esc(T(it.dru, it.den)) + "</div>" : "") + checkLine(it) + "</div>" +
          (inst
            ? ((it.verify && it.verify.split(",").some(function(v) { return checks[v] && !checks[v].ok; })) ? '<button type="button" class="agy-t-btn" data-in="' + esc(it.id) + '"' + (busy ? " disabled" : "") + ">" + esc(T("Починить", "Repair")) + "</button>" : (it.kind !== "npm" ? '<button type="button" class="agy-t-btn sec" data-rm="' + esc(it.id) + '"' + (busy ? " disabled" : "") + ">" + esc(T("Удалить", "Remove")) + "</button>" : ""))
            : (!inst && av ? '<button type="button" class="agy-t-btn" data-in="' + esc(it.id) + '"' + (busy ? " disabled" : "") + ">" + esc(T("Установить", "Install")) + "</button>" : "")) +
          "</div>";
      }
      var rendered = {};
      g.items.forEach(function(it) {
        var groups = VERSION_GROUPS[g.id] || [];
        var vg = groups.filter(function(x) { return x.ids.indexOf(it.id) >= 0; })[0];
        if (!vg) { renderItem(it); return; }
        var key = g.id + ":" + vg.title[1];
        if (rendered[key]) return;
        rendered[key] = true;
        h += '<div class="agy-t-versions"><div class="agy-t-row"><div class="agy-t-main"><div class="agy-t-name">' + esc(T(vg.title[0], vg.title[1])) + '</div><div class="agy-t-desc">' + esc(T("Выбор версии", "Choose version")) + '</div></div>' +
          '<button type="button" class="agy-t-btn sec" data-version-toggle="' + esc(key) + '" aria-expanded="' + (versionOpen[key] ? 'true' : 'false') + '">' + esc(versionOpen[key] ? T("Скрыть ▲", "Hide ▲") : T("Версии ▼", "Versions ▼")) + '</button></div>';
        if (versionOpen[key]) vg.ids.forEach(function(id) { if (ITEMS[id]) renderItem(ITEMS[id]); });
        h += '</div>';
      });
      h += "</div>";
    });

    h += '<div class="agy-t-bar">' +
      '<button type="button" class="agy-t-btn" data-act="install-sel"' + (!nsel || busy ? " disabled" : "") + ">" + esc(T("Установить выбранные", "Install selected") + (nsel ? " (" + nsel + ")" : "")) + "</button>" +
      "</div>";
    root.innerHTML = h;
    renderLog();
  }
  var QUIET = { status: 1, verify: 1 };
  // Log text: drop machine lines and curl "####" bars; keep the last state of \r-lines.
  function cleanLog(raw) {
    return (raw || "").split("\n").map(function (l) { var p = l.split("\r"); while (p.length && !p[p.length - 1].trim()) p.pop(); return p.pop() || ""; })
      .map(function (l) { return l.replace(/^@@fail\s+/, "Ошибка: ").replace(/^@@error\s+/, "Ошибка: "); })
      .filter(function (l) { return !/^@@/.test(l) && !/^[#\s]*(\d{1,3}(?:[.,]\d+)?%?)?\s*$/.test(l) && !/^#{3,}/.test(l); }).join("\n");
  }
  // Progress model from pkg / curl / sdkmanager output.
  function progress(j) {
    var raw = j.log || "", r = { pct: -1, phase: "", facts: [] };
    // Each pkg invocation reports its own package list and counters. In
    // particular npm is installed in a second invocation after Node.js.
    // Never combine the first list with Setting up lines from later runs.
    var pkgStage = "";
    if (/install|upgrade/.test(j.op)) {
      var stages = Array.from(raw.matchAll(/^== pkg (?:install|upgrade)\b[^\r\n]*/gm));
      if (stages.length) {
        var latestStage = stages[stages.length - 1];
        pkgStage = latestStage[0].slice(3);
        raw = raw.slice(latestStage.index);
      }
      var lists = Array.from(raw.matchAll(/^The following NEW packages will be installed:\s*$/gm));
      if (lists.length) raw = raw.slice(lists[lists.length - 1].index);
    }
    var mNew = /The following NEW packages will be installed:\n([\s\S]*?)\n(?:Need to get|\S)/.exec(raw);
    var names = mNew ? mNew[1].trim().split(/\s+/) : [];
    var total = names.length;
    var size = (/Need to get ([^\n]+?) of archives/.exec(raw) || [])[1];
    var gets = (raw.match(/^Get:\d+ /gm) || []).length;
    var sets = raw.match(/^Setting up (\S+)/gm) || [];
    var pcts = raw.match(/\d{1,3}(?:[.,]\d+)?%/g) || [];
    var cur = pcts.length ? parseFloat(pcts[pcts.length - 1].replace(",", ".")) : 0;
    if (/install|upgrade/.test(j.op) && total) {
      var dl = Math.max(0, gets - 1) + (gets ? Math.min(1, cur / 100) : 0);
      r.pct = Math.min(99, Math.round((dl / total) * 50 + (sets.length / total) * 50));
      var lastName = sets.length ? sets[sets.length - 1].replace(/^Setting up /, "") : "";
      r.phase = sets.length >= gets && gets
        ? T("Установлено ", "Installed ") + Math.min(sets.length, total) + T(" из ", " of ") + total + (lastName ? " · " + lastName : "")
        : T("Загрузка ", "Downloading ") + Math.min(Math.max(gets, 1), total) + T(" из ", " of ") + total + (cur ? " · " + Math.round(cur) + "%" : "");
      if (pkgStage === "pkg install npm") r.phase = "npm · " + r.phase;
      r.facts.push(T("Пакетов: ", "Packages: ") + total + (size ? T(" · объём ", " · size ") + size : ""));
    } else if (/sdk|ndk|npm|flutter/.test(j.op) && pcts.length) {
      r.pct = Math.min(99, Math.round(cur));
      r.phase = T("Загрузка · ", "Downloading · ") + Math.round(cur) + "%";
    } else if (/^== pkg update/m.test(raw) && !/Reading package lists/.test(raw)) {
      r.phase = T("Загрузка списка пакетов…", "Downloading package list…");
    } else if (/Reading package lists/.test(raw) && !total && j.op === "install") {
      r.phase = T("Подготовка…", "Preparing…");
    }
    var steps = raw.match(/^== .+$/gm);
    if (!r.phase && steps) r.phase = steps[steps.length - 1].slice(3);
    if (/^(sdk|npm)$/.test(j.op) && j.arg) {
      var requested = j.arg.trim().split(/\s+/).filter(Boolean).length;
      if (requested) r.facts.push(T("Компонентов на этом этапе: ", "Components in this stage: ") + requested);
    } else if (/^(ndk|flutter)$/.test(j.op)) {
      r.facts.push(T("Компонентов на этом этапе: 1", "Components in this stage: 1"));
    }
    return r;
  }
  function elapsed(j) {
    if (!j.t0) return "";
    var s = Math.round((Date.now() - j.t0) / 1000);
    return (s >= 60 ? Math.floor(s / 60) + T(" мин ", " min ") : "") + (s % 60) + T(" с", " s");
  }
  var tick = 0;
  function renderLog() {
    if (!root || !root.isConnected) return;
    var panel = root.querySelector(".agy-t-job");
    if (!panel) return;
    var j = job && !QUIET[job.op] ? (hiddenJob === job ? null : job) : lastDone;
    if (!j) { panel.hidden = true; return; }
    panel.hidden = false;
    var checking = !!(job && job.op === "verify" && j === lastDone && j.rc === "0");
    var running = j === job || checking;
    var ok = !running && j.rc === "0";
    panel.className = "agy-t-job" + (running ? " run" : ok ? " ok" : " bad");
    var pr = running ? progress(j) : { pct: ok ? 100 : -1, phase: "", facts: [] };
    tick = (tick + 1) % 4;
    panel.querySelector(".agy-t-jicon").textContent = running ? ["◐", "◓", "◑", "◒"][tick] : ok ? "✓" : "✗";
    panel.querySelector(".agy-t-jlabel").textContent = j.label;
    panel.querySelector(".agy-t-jpct").textContent = running && pr.pct >= 0 ? pr.pct + "%" : "";
    panel.querySelector(".agy-t-jphase").textContent = checking ? T("Проверка компонентов…", "Checking components…") : running ? (pr.phase || T("Выполняется…", "Running…"))
      : ok ? T("Готово", "Done") : T("Ошибка — откройте журнал", "Failed — open the log");
    panel.querySelector(".agy-t-jtime").textContent = running ? elapsed(j) + (queue.filter(function (q) { return !QUIET[q.op]; }).length ? T(" · этапов в очереди: ", " · stages queued: ") + queue.filter(function (q) { return !QUIET[q.op]; }).length : "") : "";
    panel.querySelector(".agy-t-jfacts").textContent = pr.facts.join("  ");
    var bar = panel.querySelector(".agy-t-pbar"), fill = panel.querySelector(".agy-t-pfill");
    bar.hidden = !running && !ok;
    fill.style.width = (pr.pct >= 0 ? Math.max(3, pr.pct) : 3) + "%";
    var text = cleanLog((j === job && batchLog ? batchLog + "\n== " + j.label + "\n" : "") + j.log);
    var lines = text.split("\n").filter(function (l) { return l.trim(); });
    panel.querySelector(".agy-t-jtail").textContent = logOpen ? "" : (lines[lines.length - 1] || "");
    panel.querySelector(".agy-t-jlog").textContent = logOpen ? T("Скрыть журнал", "Hide log") : T("Журнал", "Log");
    var pre = panel.querySelector(".agy-t-log");
    pre.hidden = !logOpen;
    if (logOpen) {
      var stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
      pre.textContent = text.slice(-20000) || T("(пока пусто)", "(empty so far)");
      if (stick) pre.scrollTop = pre.scrollHeight;
    }
  }

  /* AGY-P2-11: локальное уведомление (глобального toast нет в этом бандле) */
  function agyToast11(msg){ try { var d=document.createElement("div"); d.textContent=msg; d.style.cssText="position:fixed;left:12px;right:12px;bottom:24px;z-index:999999;background:#222;color:#fff;padding:12px 14px;border-radius:10px;font-size:14px;line-height:1.4;"; document.body.appendChild(d); setTimeout(function(){ try{d.remove();}catch(e){} },6000); } catch(e){ try{alert(msg);}catch(e2){} } }
  /* AGY-P1-5-SELFTEST: диагностика нативного сохранения файлов */
  function selftestSave15() {
    var txt = "AGY selftest " + new Date().toISOString() + "\nЕсли вы видите этот файл в Загрузках — нативный экспорт работает.\n";
    var blob = new Blob([txt], { type: "text/plain" });
    var fr = new FileReader();
    fr.onload = function () {
      var s = String(fr.result || ""); var i = s.indexOf(",");
      var b64 = i >= 0 ? s.slice(i + 1) : s;
      var a = (window.AndroidBridge && window.AndroidBridge.saveBlob) ? window.AndroidBridge : (window.Android && window.Android.saveBlob ? window.Android : null);
      var tok = window.__AG_NATIVE_BRIDGE_TOKEN__ || (function () { try { return localStorage.getItem("agy_bridge_token") || null; } catch (e) { return null; } })();
      if (!a || !tok) { alert("Мост недоступен: saveBlob=" + (!!a) + ", токен=" + (!!tok)); return; }
      try {
        a.saveBlob(tok, b64, "agy-selftest.txt", "text/plain");
        alert("saveBlob вызван. Файл agy-selftest.txt должен появиться в Загрузках.");
      } catch (e) { alert("Ошибка saveBlob: " + e); }
    };
    fr.onerror = function () { alert("FileReader failed"); };
    fr.readAsDataURL(blob);
  }
  function onClick(e) {
    var b = e.target.closest("button,input"); if (!b || b.disabled) return;
    var toggle = b.getAttribute("data-version-toggle");
    if (toggle) { versionOpen[toggle] = !versionOpen[toggle]; render(); return; }
    if (b.matches("input[data-sel]")) {
      var selectedId = b.getAttribute("data-sel");
      var proposed = Object.keys(selected).filter(function(k) { return selected[k] && k !== selectedId; });
      if (b.checked) proposed.push(selectedId);
      var conflict = nodeConflict(proposed);
      if (conflict) { b.checked = false; alert(conflict); return; }
      selected[selectedId] = b.checked; render(); return;
    }
    var act = b.getAttribute("data-act");
    if (act === "tools-menu") openToolsMenu();
    else if (act === "selftest-save") { try { selftestSave15(); } catch (e15) { alert("selftest error: " + e15); } } /* AGY-P1-5-SELFTEST */
    else if (act === "refresh") refresh(true);
    /* AGY-P2-11: предпоказ объёма и подтверждение перед pkg upgrade */
    else if (act === "upgrade") {
      var b11 = bridge();
      var doUpgrade = function () { run("upgrade", "", T("Обновление пакетов", "Upgrading packages")); refresh(true); };
      if (!b11 || !b11.start) { doUpgrade(); return; }
      var statsId = b11.start("pkgstats", "");
      if (!statsId || /^ERR/.test(statsId)) { doUpgrade(); return; }
      var poll11 = function (tries) {
        var raw = "";
        try { raw = b11.read(statsId) || ""; } catch (_) {}
        var res = {};
        try { res = JSON.parse(raw) || {}; } catch (_) {}
        if (res.rc === undefined || res.rc === "") {
          if (tries > 600) { doUpgrade(); return; }
          setTimeout(function () { poll11(tries + 1); }, 150);
          return;
        }
        var n = parseInt(res.count, 10);
        var mb = Math.round((parseInt(res.bytes, 10) || 0) / 1048576);
        var msg;
        if (res.error || isNaN(n)) {
          msg = T("Обновление пакетов может занять 10+ минут и десятки МБ. Продолжить?", "Upgrading packages may take 10+ minutes and tens of MB. Continue?");
        } else if (n === 0) {
          agyToast11(T("Обновления не требуются: все пакеты актуальны.", "Nothing to upgrade: all packages are up to date."));
          return;
        } else {
          msg = T("Будет обновлено пакетов: ", "Packages to upgrade: ") + n + (mb > 0 ? ("\n" + T("Объём загрузки: ~", "Download size: ~") + mb + " МиБ") : "") + "\n\n" + T("Это может занять 10+ минут. Продолжить?", "This may take 10+ minutes. Continue?");
        }
        if (confirm(msg)) doUpgrade();
      };
      poll11(0);
    }
    else if (act === "install-sel") { var ids = Object.keys(selected).filter(function (k) { return selected[k]; }); selected = {}; installIds(ids); }
    else if (act === "index") { run("index", "", T("Загрузка списка пакетов", "Downloading package list")); refresh(false); }
    else if (act === "log") { logOpen = !logOpen; renderLog(); }
    else if (act === "copy-log") {
      var shown = job && !QUIET[job.op] ? job : lastDone;
      var txt = shown ? cleanLog(shown.log || "") : "";
      if (!txt) return;
      /* AGY-P2-11: clipboard API first, execCommand fallback */
      var ok11 = function () { b.textContent = T("Скопировано", "Copied"); };
      var fail11 = function () { logOpen = true; renderLog(); alert(T("Не удалось скопировать. Выделите текст журнала вручную.", "Copy failed. Select the log text manually.")); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(ok11, function () {
          var area = document.createElement("textarea"); area.value = txt;
          area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.left = "-9999px";
          document.body.appendChild(area); area.select();
          var copied = false; try { copied = document.execCommand("copy"); } catch (_) {}
          area.remove();
          if (copied) ok11(); else fail11();
        });
      } else { fail11(); }
    }
    else if (act === "cancel-job") {
      // Closing the panel must not cancel a running operation or its follow-up checks.
      if (job && !QUIET[job.op]) hiddenJob = job;
      else lastDone = null;
      logOpen = false;
      render();
    }
    else if (b.getAttribute("data-preset")) {
      var p = PRESETS.filter(function (x) { return x.id === b.getAttribute("data-preset"); })[0];
      if (p) installIds(p.items.filter(function (id) { return ITEMS[id] && needsPresetInstall(ITEMS[id]); }));
    }
    else if (b.getAttribute("data-in")) installIds([b.getAttribute("data-in")]);
    else if (b.getAttribute("data-rm")) removeId(b.getAttribute("data-rm"));
  }

  var termJobId = null, termTimer = null, modal = null, historyText = "";
  var scroll21List = [];
  function closeToolsModal() {
    if (modal && modal.__agyUnlockScroll) { try { modal.__agyUnlockScroll(); } catch (_) {} }
    if (modal) modal.remove(); modal = null;
    if (termTimer) clearTimeout(termTimer); termTimer = null;
    scroll21List.forEach(function (fn) { try { if (fn && fn.__off) fn.__off(); } catch (_) {} });
    scroll21List.length = 0;
  }
  function modalBox(title, body) {
    closeToolsModal();
    modal = document.createElement("div");
    modal.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px";
    modal.innerHTML = '<div data-card style="box-sizing:border-box;background:#1c1c1e;color:#eee;border:1px solid #555;border-radius:16px;padding:16px;width:min(100%,680px);max-height:88vh;overflow:hidden;display:flex;flex-direction:column"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><strong>' + esc(title) + '</strong><button type="button" data-modal="close">✕</button></div>' + body + '</div>';
    document.body.appendChild(modal);
    modal.addEventListener("click", function(e) { if (e.target===modal || e.target.getAttribute("data-modal")==="close") closeToolsModal(); });
    /* AGY-P2-22: пока окно открыто, чат позади не листается вообще */
    var scroller = document.scrollingElement || document.documentElement;
    var lockedTop = scroller.scrollTop;
    var lock = function () { if (scroller.scrollTop !== lockedTop) scroller.scrollTop = lockedTop; };
    scroller.addEventListener("scroll", lock, { passive: true });
    modal.__agyUnlockScroll = function () { try { scroller.removeEventListener("scroll", lock); } catch (_) {} };
    modal.addEventListener("touchmove", function (e) {
      var pane = e.target.closest && e.target.closest("[data-history],[data-terminal]");
      if (!pane) e.preventDefault();
    }, { passive: false });
    return modal;
  }
  function openToolsMenu() {
    var m=modalBox(T("Инструменты", "Tools"), '<div style="display:grid;gap:10px;margin-top:16px"><button type="button" data-modal="history">' + esc(T("История ошибок", "Error history")) + '</button><button type="button" data-modal="terminal">' + esc(T("Консоль приложения", "App console")) + '</button></div>');
    m.querySelector('[data-modal="history"]').onclick=openErrorHistory;
    m.querySelector('[data-modal="terminal"]').onclick=openToolsTerminal;
  }
  function pollAux(id, done, tries) {
    if (!modal) return;
    var b=bridge(), r={};
    try { r=JSON.parse(b.read(id)||"{}"); } catch (_) {}
    if (r.rc!==undefined && r.rc!=="") { done(r); return; }
    if (tries>600) { done({rc:"1",log:"Timeout"}); return; }
    setTimeout(function(){pollAux(id,done,tries+1);},150);
  }
  /* AGY-P2-18: clipboard API first (execCommand мёртв в Android WebView) */
  function copyText(txt) {
    var fail=function(){ alert(T("Не удалось скопировать; выделите текст вручную.", "Copy failed; select the text manually.")); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).catch(function(){
        var a=document.createElement("textarea"); a.value=txt; a.style.cssText="position:fixed;left:-9999px"; document.body.appendChild(a); a.select();
        var ok=false; try { ok=document.execCommand("copy"); } catch (_) {} a.remove();
        if (!ok) fail();
      });
      return;
    }
    fail();
  }

  /* AGY-P2-21: видимый ползунок внутри окна (Android WebView не рисует ::-webkit-scrollbar) */
  function attachScroll21(wrap, pane) {
    if (!wrap || !pane) return function(){};
    var sb = document.createElement("div");
    sb.setAttribute("data-sb", "");
    sb.style.cssText = "position:absolute;top:6px;right:2px;bottom:6px;width:18px;border-radius:10px;"
      + "background:rgba(255,255,255,.06);opacity:0;transition:opacity .15s;touch-action:none;user-select:none;z-index:3";
    var thumb = document.createElement("div");
    thumb.style.cssText = "position:absolute;left:4px;width:10px;border-radius:6px;background:#9a9aa0;"
      + "min-height:28px;opacity:.92;touch-action:none;user-select:none";
    sb.appendChild(thumb);
    wrap.appendChild(sb);
    function sync() {
      var ch = pane.clientHeight, sh = pane.scrollHeight;
      if (sh <= ch + 6) { sb.style.opacity = "0"; sb.style.pointerEvents = "none"; return; }
      sb.style.opacity = "1"; sb.style.pointerEvents = "auto";
      var th = Math.max(28, Math.round((ch / sh) * sb.clientHeight));
      thumb.style.height = th + "px";
      var track = sb.clientHeight - th;
      var max = sh - ch;
      thumb.style.top = (max > 0 ? Math.round((pane.scrollTop / max) * track) : 0) + "px";
    }
    pane.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    var dragging = false, startY = 0, startTop = 0;
    thumb.addEventListener("pointerdown", function (e) {
      dragging = true; startY = e.clientY; startTop = parseFloat(thumb.style.top) || 0;
      e.preventDefault(); e.stopPropagation();
      try { thumb.setPointerCapture(e.pointerId); } catch (_) {}
    });
    thumb.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var th = thumb.offsetHeight;
      var track = sb.clientHeight - th;
      if (track <= 0) return;
      var top = Math.min(track, Math.max(0, startTop + (e.clientY - startY)));
      pane.scrollTop = (top / track) * (pane.scrollHeight - pane.clientHeight);
    });
    thumb.addEventListener("pointerup", function () { dragging = false; });
    thumb.addEventListener("pointercancel", function () { dragging = false; });
    sb.addEventListener("click", function (e) {
      if (e.target !== sb) return;
      var r = sb.getBoundingClientRect();
      var y = e.clientY - r.top;
      pane.scrollTop = (y / sb.clientHeight) * (pane.scrollHeight - pane.clientHeight) - pane.clientHeight / 2;
      sync();
    });
    sync.__off = function () {
      try { window.removeEventListener("resize", sync); } catch (_) {}
    };
    scroll21List.push(sync);
    requestAnimationFrame(sync);
    setTimeout(sync, 80);
    setTimeout(sync, 400);
    return sync;
  }

  function openErrorHistory() {
    /* AGY-P2-20: тулбар истории ошибок + своя прокрутка, не терминал проекта */
    var m=modalBox(T("История ошибок", "Error history"),
      '<div data-toolbar style="display:flex;gap:8px;align-items:center;margin:12px 0 8px"></div>' +
      '<div data-pane style="position:relative;flex:1 1 auto;min-height:200px">' +
      '<pre data-history style="position:absolute;inset:0;white-space:pre-wrap;overflow-wrap:anywhere;overflow-y:scroll;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;background:#101012;padding:10px 18px 10px 10px;margin:0;border-radius:10px"></pre></div>');
    var bar=m.querySelector('[data-toolbar]');
    function toolBtn(label, title) {
      var b=document.createElement("button");
      b.type="button"; b.textContent=label; b.title=title;
      b.style.cssText="background:#2a2a2e;color:#eee;border:1px solid #555;border-radius:8px;padding:6px 10px;font-size:13px";
      bar.appendChild(b); return b;
    }
    var btnCopy=toolBtn("⧉  " + T("Копировать всё", "Copy all"), T("Копировать всё", "Copy all"));
    var btnClear=toolBtn("⌫  " + T("Очистить", "Clear"), T("Очистить журнал ошибок", "Clear error log"));
    var output=m.querySelector('[data-history]'), decoder=new TextDecoder(), bytes=[]; historyText="";
    var syncH=attachScroll21(m.querySelector('[data-pane]'), output);
    output.textContent=T("Загрузка истории…", "Loading history…");
    btnCopy.onclick=function(){ copyText(historyText); btnCopy.textContent="✓  " + T("Скопировано", "Copied"); setTimeout(function(){ btnCopy.textContent="⧉  " + T("Копировать всё", "Copy all"); }, 1200); };
    btnClear.onclick=function(){
      if (!confirm(T("Очистить журнал ошибок?", "Clear the error log?"))) return;
      var id=bridge().start("histclear","");
      if (!id || /^ERR/.test(id)) { alert(String(id)); return; }
      pollAux(id, function(){ historyText=""; output.textContent=T("Ошибок пока нет.","No errors yet."); }, 0);
    };
    var userMoved=false, ignoreScroll=0;
    output.addEventListener("scroll", function(){ if (!ignoreScroll) userMoved=true; }, {passive:true});
    function placeScroll(top) {
      ignoreScroll++;
      output.scrollTop=top;
      setTimeout(function(){ ignoreScroll=Math.max(0, ignoreScroll-1); }, 60);
    }
    function load(offset) {
      if (modal!==m) return;
      var id=bridge().start("histread",String(offset));
      if (!id || /^ERR/.test(id)) { output.textContent=T("Не удалось открыть историю: ","Cannot open history: ")+id; return; }
      pollAux(id,function(r){
        if (modal!==m) return;
        var match=/@@HISTORY (\d+) (\d+) ?([A-Za-z0-9+/=]*)/.exec(r.log||"");
        if (String(r.rc)!=="0" || !match) {output.textContent=T("Ошибка чтения: ","Read error: ")+(r.log||"");return;}
        var raw=atob(match[3]||""), part=new Uint8Array(raw.length); for(var i=0;i<raw.length;i++)part[i]=raw.charCodeAt(i);
        var keep=output.scrollTop, atBottom=keep+output.clientHeight>=output.scrollHeight-24;
        historyText+=decoder.decode(part,{stream:Number(match[1])<Number(match[2])});
        output.textContent=historyText || T("Ошибок пока нет.","No errors yet.");
        if (!userMoved) placeScroll(0);
        else if (atBottom) placeScroll(output.scrollHeight);
        else placeScroll(keep);
        if (typeof syncH === "function") syncH();
        if (Number(match[1])<Number(match[2]) && Number(match[1])>offset) setTimeout(function(){load(Number(match[1]));},80);
      },0);
    }
    if (!bridge()) {output.textContent=T("Мост недоступен.","Bridge unavailable.");return;} load(0);
  }
  function openToolsTerminal() {
    /* AGY-P2-20: консоль снятия логов приложения. Каждая команда — отдельный запуск,
       не PTY открытой сессии/проекта (тот FIFO умирал и ввод падал с ENXIO). */
    var m=modalBox(T("Консоль приложения", "App console"),
      '<div data-toolbar style="display:flex;gap:8px;align-items:center;margin:10px 0 8px"></div>' +
      '<div data-pane style="position:relative;flex:1 1 auto;min-height:200px">' +
      '<pre data-terminal style="position:absolute;inset:0;white-space:pre-wrap;overflow-wrap:anywhere;overflow-y:scroll;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;background:#101012;padding:10px 18px 10px 10px;margin:0;border-radius:10px"></pre></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px"><input data-command style="flex:1;min-width:0;background:#101012;color:#eee;border:1px solid #555;border-radius:8px;padding:8px" placeholder="' + esc(T("Команда для логов приложения", "Command for app logs")) + '">' +
      '<button type="button" data-send style="background:#0b84ff;color:#fff;border:0;border-radius:8px;padding:8px 14px">▶</button></div>' +
      '<div style="margin-top:6px;color:#888;font-size:12px">' + esc(T("Это не терминал открытого проекта: команда выполняется в окружении приложения и сразу завершается.", "This is not the open project terminal: the command runs in the app environment and then exits.")) + '</div>');
    var bar=m.querySelector('[data-toolbar]');
    function toolBtn(label, title) {
      var b=document.createElement("button");
      b.type="button"; b.textContent=label; b.title=title;
      b.style.cssText="background:#2a2a2e;color:#eee;border:1px solid #555;border-radius:8px;padding:6px 10px;font-size:13px";
      bar.appendChild(b); return b;
    }
    var out=m.querySelector('[data-terminal]'), input=m.querySelector('[data-command]');
    var syncT=attachScroll21(m.querySelector('[data-pane]'), out);
    var transcript="";
    function paint(extra) {
      if (extra) transcript += extra;
      if (transcript.length > 80000) transcript = transcript.slice(-80000);
      out.textContent = transcript || T("Готово. Введите команду, например: logcat -d -t 80", "Ready. Try: logcat -d -t 80");
      out.scrollTop = out.scrollHeight;
      if (typeof syncT === "function") syncT();
    }
    paint("");
    toolBtn("⧉  " + T("Копировать", "Copy"), T("Копировать вывод", "Copy output")).onclick=function(){ copyText(transcript); };
    toolBtn("⌫  " + T("Очистить", "Clear"), T("Очистить экран", "Clear screen")).onclick=function(){ transcript=""; paint(""); };
    toolBtn("logcat", "logcat -d -t 80").onclick=function(){ input.value="logcat -d -t 80 *:W"; send(); };
    if (!bridge()) { out.textContent=T("Мост недоступен.","Bridge unavailable."); return; }
    function send(){
      var v=(input.value||"").replace(/\r/g,"");
      if (!v.trim()) return;
      input.value="";
      var encoded=new TextEncoder().encode(v);
      if (encoded.length>3500){ alert(T("Команда слишком длинная.","Command is too long.")); return; }
      var raw=""; encoded.forEach(function(x){ raw+=String.fromCharCode(x); });
      transcript += "\n$ " + v + "\n";
      paint("");
      var id=bridge().start("termrun", btoa(raw));
      if (!id || /^ERR/.test(id)) { paint(String(id||"ERR")+"\n"); return; }
      pollAux(id, function(r){
        var log=String(r.log||"");
        paint(log.replace(/@@[A-Z0-9_]+[^\n]*\n?/g,"") + (log && !/\n$/.test(log) ? "\n" : ""));
      }, 0);
    }
    m.querySelector('[data-send]').onclick=send;
    input.onkeydown=function(e){ if(e.key==="Enter"){ e.preventDefault(); send(); } };
    input.focus();
  }

  window.__agyToolsMount = function (el) {
    if (!el) return;
    host = el;
    if (root && root.parentElement === el) return;
    root = document.createElement("div");
    root.className = "agy-tools";
    root.setAttribute("data-agy-no-translate", "");
    root.addEventListener("click", onClick);
    el.appendChild(root);
    // Re-attach to a job that was running when the page was closed.
    if (!job) {
      var saved = null;
      try { saved = JSON.parse(store("agyToolsJob") || "null"); } catch (e) {}
      if (saved && saved.id && bridge()) {
        job = { id: saved.id, op: saved.op, arg: saved.arg, label: saved.label, log: "", rc: "", t0: saved.t0 || Date.now() };
        lastLogChange = Date.now();
        logOpen = true;
        poll();
      }
    }
    render();
    if (!loaded) loadCache();
    render();
    // Opening this page only refreshes installed status; verification is explicit.
    if (!job) refresh(false);
  };
})();


