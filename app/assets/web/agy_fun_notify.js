/* Leostryx — fun completion overlay.
 *
 * Когда агент завершает задачу, показываем гифку и играем звук:
 *   - приложение на экране, тот же чат  -> гифка прямо в переписке;
 *   - приложение на экране, другой чат  -> оверлей (в чужую переписку не лезем);
 *   - приложение в фоне                 -> завершение запоминается (15 мин)
 *                                          и отдаётся при возврате в приложение.
 * Раньше фон и чужой чат просто выбрасывались (`done:background -> skip`),
 * а системного уведомления на завершение хода нет — длинная сборка или
 * установка заканчивалась полной тишиной.
 *
 * Как определяется завершение (см. блок «ТРИГГЕР» ниже):
 *   1. взвод ТОЛЬКО по реальной отправке сообщения (кнопка отправки,
 *      Enter с опустевшим полем, RPC SendUserCascadeMessage);
 *   2. затем агент должен реально поработать (Stop-кнопка композера /
 *      agent-loading / GetTurnDiff) и замолчать на SETTLE_MS;
 *   3. гифка показывается только в том каскаде (data-cascade-id), в котором
 *      отправляли, — открытие старой переписки её не вызывает.
 * Таймеры в фоне Android замораживает, поэтому при возврате в приложение
 * взвод «доседывается» через GRACE_MS, если индикатор занятости уже исчез.
 *
 * Звук: WebView требует жеста пользователя (setMediaPlaybackRequiresUserGesture),
 * поэтому первый `play()` без жеста отклоняется с NotAllowedError. Общий
 * элемент Audio разблокируется первым касанием беззвучным прогоном, а
 * заблокированное воспроизведение встаёт в очередь и повторяется на следующем
 * жесте — вместо того чтобы потеряться в пустом .catch().
 *
 * Настройка (в «Оформление» приложения или напрямую):
 *   localStorage.setItem('agy.funDoneGif', 'https://.../funny.gif')  — своя гифка/картинка
 *   localStorage.setItem('agy.funDoneEnabled', '1' | '0')            — вкл/выкл
 *   localStorage.setItem('agy.funDonePreset', 'michael'|'nice'|...)
 *   localStorage.setItem('agy.funDoneInChat', '0')                   — оверлей вместо чата
 * Отключить показ: agy.funDoneEnabled = '0'
 *
 * Диагностика в консоли WebView:
 *   __agyFunDiag()  — состояние (enabled, inChat, gif, sound, audioUnlocked,
 *                     soundQueued, visible, armed, seenBusy, pending, log);
 *   __agyFunFire()  — принудительно показать гифку и проиграть звук.
 */
(function () {
  "use strict";
  function get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }

  /* Модуль рисует свои элементы поверх бандла, поэтому нужен локальный
     выбор строки RU/EN по общему источнику языка. */
  function ruT() {
    try {
      if (window.__agyI18n && typeof window.__agyI18n.getLanguage === "function") {
        return window.__agyI18n.getLanguage() === "ru";
      }
    } catch (e) {}
    return /^ru\b/i.test(navigator.language || "");
  }
  function T(r, e) { return ruT() ? r : e; }
  /* --- АВАРИЙНЫЙ KILL-SWITCH ---
     Если в localStorage agyFunSafeMode=1 — скрипт полностью отключён:
     никаких перехватов fetch/Audio/WebSocket, никакого DOM-демона.
     Включить обратно: localStorage.setItem('agyFunSafeMode','0') */
  var SAFE = false;
  try { SAFE = localStorage.getItem("agyFunSafeMode") === "1"; } catch (e) {}
  // Также проверяем deep-link leostryx://disable-fun — можно выключить без захода в приложение
  try {
    var q = (location.search || "").toLowerCase();
    if (q.indexOf("agysafe=1") !== -1) { SAFE = true; try { localStorage.setItem("agyFunSafeMode", "1"); } catch (e) {} }
  } catch (e) {}
  if (SAFE) return;
  if (get("agy.funDoneEnabled", "1") === "0") return;

  var PRESETS = {
    michael:  "/gifs/fun_michael.gif",   // Michael Rosen "Nice"
    nice:     "/gifs/fun_nice.gif",      // DiCaprio clap "NICE"
    bateman:  "/gifs/fun_bateman.gif",   // Patrick Bateman "NICE"
    deadpool: "/gifs/fun_deadpool.gif",  // Deadpool "VERY NICE!!"
    jeremiah: "/gifs/fun_jeremiah.gif"   // Jeremiah Johnson nod
  };

  var DURATION_MS = 4000;

  /* Пресеты короткого звука. app-done — штатный звук приложения,
     chime/pop — собственные mp3, лежащие прямо в assets/web (раньше тянулись
     с CDN jsDelivr: без сети звук молчал, а сам запрос уходил наружу).
     Ключи chime/pop оставлены прежними, чтобы уже сохранённый в localStorage
     выбор пользователя продолжал работать; изменились только подписи и файлы. */
  var SOUNDS = {
    "app-done": "/antigravityCascadeDone.mp3", // встроенный звук приложения
    chime: "/leostryx_portal.mp3",             // Portal — «портальный» гул
    pop:   "/leostryx_bell.mp3"                // Bell — короткий колокольчик
  };

  function soundSrc() {
    var p = get("agy.funDoneSound", "app-done");
    if (SOUNDS[p]) return SOUNDS[p];
    var u = get("agy.funDoneSoundUrl", "");
    if (u && /^https?:\/\//.test(u)) return u;
    return SOUNDS["app-done"];
  }

  function gifSrc() {
    var preset = get("agy.funDonePreset", "");
    if (preset && PRESETS[preset]) return PRESETS[preset];
    var u = get("agy.funDoneGif", "");
    if (u && /^(https?:|data:image|\.?\/)/.test(u)) return u;
    return PRESETS.michael;
  }

  /* Загружаем GIF через fetch → FileReader → data URI
     data: URL работает в любом WebView без SSL/CORS ограничений */
  var GIF_CACHE = {};
  function loadGifDataUrl(src, callback) {
    if (GIF_CACHE[src]) { callback(GIF_CACHE[src]); return; }
    var origin = "";
    try { origin = window.location.origin; } catch(e) {}
    var absSrc = src;
    if (src && src[0] === "/" && origin) absSrc = origin + src;
    else if (src && src[0] === "." && origin) absSrc = origin + "/" + src.replace(/^\.\//,"");
    dbg("gifLoad:src=" + absSrc.slice(0,70));
    try {
      fetch(absSrc).then(function(r) {
        dbg("gifLoad:status=" + r.status);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.blob();
      }).then(function(b) {
        var reader = new FileReader();
        reader.onloadend = function() {
          var dataUrl = reader.result;
          GIF_CACHE[src] = dataUrl;
          dbg("gifLoad:ok len=" + (dataUrl ? dataUrl.length : 0));
          callback(dataUrl);
        };
        reader.onerror = function() {
          dbg("gifLoad:reader-err");
          callback(absSrc);
        };
        reader.readAsDataURL(b);
      }).catch(function(e) {
        dbg("gifLoad:fetch-err=" + String(e).slice(0,50));
        callback(absSrc);
      });
    } catch(e) {
      dbg("gifLoad:ex=" + String(e).slice(0,50));
      callback(src);
    }
  }
  var loadGifBlob = loadGifDataUrl;

  // Предзагрузка активной гифки в память сразу при запуске
  setTimeout(function() {
    try { loadGifDataUrl(gifSrc(), function() { dbg("preload:ready"); }); } catch(e) {}
  }, 1000);

  var overlay = null, hideTimer = null;

  function buildOverlay(blobSrc) {
    var el = document.createElement("div");
    el.id = "agy-fun-done";
    el.setAttribute("style",
      "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;flex-direction:column;" +
      "background:rgba(0,0,0,.6);opacity:0;transition:opacity .25s ease;backdrop-filter:blur(2px);");
    var img = document.createElement("img");
    img.src = blobSrc || gifSrc();
    img.alt = "Task done!";
    img.setAttribute("style",
      "max-width:76vw;max-height:60vh;border-radius:18px;box-shadow:0 12px 48px rgba(0,0,0,.8);" +
      "transform:scale(.85);transition:transform .25s cubic-bezier(.2,1.4,.4,1);background:#1a1a1a;");
    var label = document.createElement("div");
    label.textContent = T("Задача завершена! 🎉", "Task complete! 🎉");
    label.setAttribute("style",
      "margin-top:20px;color:#fff;" +
      "font:600 20px/1.3 system-ui,sans-serif;text-shadow:0 2px 8px rgba(0,0,0,.8);pointer-events:none;");
    el.appendChild(img); el.appendChild(label);
    el.addEventListener("click", hide);
    return el;
  }

  function show() {
    if (overlay) {
      clearTimeout(hideTimer);
      overlay.style.opacity = "1";
      var img2 = overlay.querySelector("img");
      if (img2) img2.style.transform = "scale(1)";
      hideTimer = setTimeout(hide, DURATION_MS);
      return;
    }
    loadGifDataUrl(gifSrc(), function (dataSrc) {
      overlay = buildOverlay(dataSrc);
      (document.body || document.documentElement).appendChild(overlay);
      void overlay.offsetWidth;
      overlay.style.opacity = "1";
      var img = overlay.querySelector("img");
      if (img) img.style.transform = "scale(1)";
      hideTimer = setTimeout(hide, DURATION_MS);
    });
  }

  function hide() {
    if (!overlay) return;
    clearTimeout(hideTimer);
    var el = overlay; overlay = null;
    el.style.opacity = "0";
    setTimeout(function () { try { el.remove(); } catch(e) {} }, 300);
  }

  /* --- In-chat mode: вставляем гифку прямо в переписку --- */

  var CONVO_SEL = '[data-testid="conversation-view"]';
  var VIEWPORT_SEL = '[data-testid="autoscroll-viewport"]';

  function convoEl() {
    try { return document.querySelector(CONVO_SEL); } catch (e) { return null; }
  }
  /* Каскад, открытый на экране. Именно этот id привязывает гифку к чату:
     задачи в других чатах (и просто открытая история) её не показывают. */
  function convoId() {
    var el = convoEl();
    try { return (el && el.getAttribute("data-cascade-id")) || ""; } catch (e) { return ""; }
  }

  /* Возвращает {host, scroller}:
     host     — куда вставлять гифку (внутрь последнего хода агента),
     scroller — что прокручивать (только он, не страница). */
  function findChatContainer() {
    var vp = null;
    try { vp = document.querySelector(VIEWPORT_SEL); } catch (e) {}
    if (vp) return { host: vp.firstElementChild || vp, scroller: vp };

    var convo = convoEl();
    if (convo) return { host: convo, scroller: convo };

    var alt = document.querySelector('[class*="conversation-view"], [class*="conversation"], main [role="log"]');
    if (alt) return { host: alt, scroller: alt };
    return null;
  }

  /* Последний ход агента растянут на всю высоту ленты: в бандле внешний
     контейнер хода получает `min-height: calc(100cqh - 50px)` (у вьюпорта
     `container-type: size`). Поэтому всё, что вставлено ПОСЛЕ списка
     сообщений, оказывалось у самого низа экрана — гифка «отрывалась» от
     текста на пол-экрана. Внутренний `[data-turn-content]` — обычный
     flex-столбец по высоте содержимого, поэтому гифка встаёт вплотную
     под последним ответом. */
  var TURN_SEL = "[data-turn-content]";
  function lastTurnContent() {
    var list;
    try { list = document.querySelectorAll(TURN_SEL); } catch (e) { return null; }
    if (!list || !list.length) return null;
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].getAttribute("data-turn-content") === "latest") return list[i];
    }
    return list[list.length - 1];
  }

  function insertGifToElement(chat, dataUrl) {
    if (!chat || !chat.host) return false;
    var host = chat.host, scroller = chat.scroller || host;
    // Убираем предыдущую гифку (где бы она ни лежала)
    var stale;
    try { stale = document.querySelectorAll(".agy-fun-chat"); } catch (e) { stale = []; }
    for (var s = 0; s < stale.length; s++) {
      try { if (stale[s]._agyKeep) clearInterval(stale[s]._agyKeep); } catch (e) {}
      try { stale[s].remove(); } catch (e) {}
    }

    var wrap = document.createElement("div");
    wrap.className = "agy-fun-chat";
    wrap.setAttribute("style",
      "display:flex;flex-direction:column;align-items:center;margin:8px auto 4px;padding:8px 12px 10px;" +
      "background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;" +
      "box-shadow:0 4px 20px rgba(0,0,0,0.35);max-width:280px;box-sizing:border-box;pointer-events:auto;");

    var img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "Task done!";
    img.setAttribute("style",
      "max-width:260px;max-height:190px;border-radius:12px;object-fit:cover;display:block;background:#18181b;");

    var caption = document.createElement("div");
    caption.textContent = T("Задача выполнена 🎉", "Task done 🎉");
    caption.setAttribute("style",
      "margin-top:6px;font:500 12px/1.3 system-ui,sans-serif;color:var(--text-secondary,#94a3b8);text-align:center;");

    wrap.appendChild(img);
    wrap.appendChild(caption);

    /* Вставка в последний ход агента. Узел живёт в дереве, которым владеет
       React: любой его re-render (финализация хода, приход статуса
       инструментов) выбрасывает наши элементы, и гифка исчезает через
       мгновение. Поэтому тот же самый узел возвращается на место, пока не
       истечёт его 35-секундный срок. */
    function place() {
      var turn = lastTurnContent();
      if (turn) {
        turn.appendChild(wrap);
        return true;
      }
      var inputRow = null;
      try {
        inputRow = host.querySelector('[class*="px-4 pb-2"], [class*="composer"], form, textarea')?.closest('div[class*="items-center"]');
      } catch (e) {}
      if (inputRow && inputRow.parentElement === host) {
        host.insertBefore(wrap, inputRow);
        return true;
      }
      if (host) { host.appendChild(wrap); return true; }
      return false;
    }

    if (!place()) return false;

    dbg("chatInsert:inserted ok");
    // Только мгновенный скролл списка сообщений. smooth-скролл во время
    // анимации клавиатуры WebView применял ко всей странице — чат «отрывался»
    // от контейнера. Страницу не трогаем вообще.
    try { scroller.scrollTop = scroller.scrollHeight; } catch (e) {}

    // Авто-удаление через 35 секунд; до этого — удержание узла в дереве.
    // Возвращать узел можно только в тот же каскад: иначе при переходе в
    // другую переписку гифка «прилипала» к чужому последнему ходу.
    var born = Date.now(), replaced = 0, atId = convoId();
    wrap._agyKeep = setInterval(function () {
      try {
        if (Date.now() - born > 35000) {
          clearInterval(wrap._agyKeep); wrap._agyKeep = null;
          try { wrap.remove(); } catch (e) {}
          return;
        }
        if (atId && convoId() && convoId() !== atId) {
          clearInterval(wrap._agyKeep); wrap._agyKeep = null;
          try { wrap.remove(); } catch (e) {}
          dbg("chatInsert:left-chat -> drop");
          return;
        }
        var inDoc = false;
        try { inDoc = document.contains(wrap); } catch (e) { inDoc = !!wrap.parentNode; }
        if (inDoc) return;
        if (replaced >= 10) { clearInterval(wrap._agyKeep); wrap._agyKeep = null; return; }
        replaced++;
        place();
        dbg("chatInsert:restored " + replaced);
      } catch (e) {}
    }, 800);
    return true;
  }

  /* done(placed) вызывается всегда: true — гифка в чате, false — ставить
     некуда (открыт не чат или другой каскад). Тогда funShow покажет
     обычный оверлей вместо молчания. */
  function chatInsert(expectedCascadeId, done) {
    done = done || function () {};
    var chat = findChatContainer();
    if (!chat) {
      // Пользователь не в чате (настройки / проекты). Гифку НЕ откладываем:
      // раньше она «ждала» до 30 секунд и потом появлялась в ЛЮБОМ открытом
      // чате — отсюда баг «зашёл в старую переписку, а там гифка».
      dbg("chatInsert:not-on-chat-screen -> overlay");
      done(false);
      return;
    }
    var cur = convoId();
    if (expectedCascadeId && cur && cur !== expectedCascadeId) {
      dbg("chatInsert:other-chat -> overlay");
      done(false);
      return;
    }
    loadGifDataUrl(gifSrc(), function (dataUrl) {
      done(!!insertGifToElement(chat, dataUrl));
    });
  }

  var lastShow = 0;
  var scriptStart = Date.now();
  try { dbg("init:origin=" + window.location.origin); } catch(e) {}
  function dbg(s) {
    try { window.__agyFunDebug = (window.__agyFunDebug || []).concat([s]).slice(-40); } catch (e) {}
  }
  function funShow(expectedCascadeId, opts) {
    opts = opts || {};
    var now = Date.now();
    if (!opts.force) {
      if (now - scriptStart < 8000) { dbg("skip:warmup"); return; }
      // Только защита от двойного вызова в пределах одного хода: сам ход
      // выдаётся один раз (disarm), поэтому длинное «окно тишины» лишь
      // съедало завершение следующей, быстро прошедшей задачи.
      if (now - lastShow < 2000) { dbg("skip:dup"); return; }
    }
    lastShow = now;
    var inChat = get("agy.funDoneInChat", "1") !== "0";
    dbg("fire:inChat=" + inChat + (opts.force ? " force" : ""));
    if (!inChat || opts.overlay) { show(); playSound(); return; }
    chatInsert(expectedCascadeId, function (placed) {
      if (!placed) { dbg("fallback:overlay"); show(); }
      playSound();
    });
  }

  /* --- Звук ---
     WebView по умолчанию требует «жеста» пользователя для воспроизведения
     (setMediaPlaybackRequiresUserGesture). `new Audio(...).play()` без жеста
     отклоняется с NotAllowedError, а ошибка глушилась — поэтому звук
     завершения молчал. Теперь один общий элемент Audio создаётся заранее,
     разблокируется первым же касанием беззвучным прогоном, а если play()
     всё-таки отклонён, звук встаёт в очередь и повторяется на следующем
     жесте вместо того, чтобы потеряться. */
  var AUDIO = null, audioUnlocked = false, soundQueued = false;

  function audioEl() {
    if (AUDIO) return AUDIO;
    try {
      AUDIO = new Audio();
      try { AUDIO.preload = "auto"; } catch (e) {}
    } catch (e) { AUDIO = null; }
    return AUDIO;
  }

  function unlockAudio() {
    if (audioUnlocked) return;
    var a = audioEl();
    if (!a) return;
    try {
      a.muted = true;
      if (a.getAttribute("src") !== soundSrc()) a.setAttribute("src", soundSrc());
      var p = a.play();
      if (p && typeof p.then === "function") {
        p.then(function () {
          try { a.pause(); a.currentTime = 0; } catch (e) {}
          try { a.muted = false; } catch (e) {}
          audioUnlocked = true;
          dbg("audio:unlocked");
          if (soundQueued) { soundQueued = false; playSound(); }
        }).catch(function (e) {
          try { a.muted = false; } catch (e2) {}
          dbg("audio:unlock-err=" + ((e && e.name) || "err"));
        });
      }
    } catch (e) { dbg("audio:unlock-ex"); }
  }

  /* Жест пользователя: он и разблокирует Audio, и повторяет отложенный
     звук. Проверять звук нужно независимо от audioUnlocked — иначе очередь
     после первой же успешной разблокировки уже не проигрывалась. */
  function onGesture() {
    if (audioUnlocked) {
      if (soundQueued) { soundQueued = false; playSound(); }
      return;
    }
    unlockAudio();
  }

  ["pointerdown", "touchstart", "keydown"].forEach(function (ev) {
    try { document.addEventListener(ev, onGesture, { capture: true, passive: true }); }
    catch (e) { try { document.addEventListener(ev, onGesture, true); } catch (e2) {} }
  });

  function playSound() {
    var a = audioEl();
    if (!a) { dbg("audio:none"); return; }
    try {
      var src = soundSrc();
      if (a.getAttribute("src") !== src) a.setAttribute("src", src);
      try { a.currentTime = 0; } catch (e) {}
      a.muted = false;
      try { a.volume = 1; } catch (e) {}
      var p = a.play();
      if (p && typeof p.then === "function") {
        p.then(function () { audioUnlocked = true; dbg("audio:ok"); })
         .catch(function (e) {
           var n = (e && e.name) || "err";
           if (n === "NotAllowedError") { soundQueued = true; dbg("audio:blocked -> queued"); }
           else dbg("audio:err=" + n);
         });
      }
    } catch (e) { dbg("audio:ex"); }
  }

  function isForeground() {
    try { return document.visibilityState === "visible"; }
    catch (e) { return true; }
  }

  /* ═══════════════════════════════════════════════════════════════
     ТРИГГЕР: завершение задачи, которую отправил пользователь
     ───────────────────────────────────────────────────────────────
     Взводится ТОЛЬКО реальной отправкой сообщения:
       • клик по кнопке отправки внутри блока ввода (send-button),
       • Enter в поле ввода — и только если поле действительно опустело,
       • RPC SendUserCascadeMessage (если fetch его видит).
     Потом ждём, пока агент реально поработает (Stop-кнопка композера /
     agent-loading / GetTurnDiff) и замолчит на SETTLE_MS.
     Гифка показывается только в том же каскаде (data-cascade-id),
     поэтому простое открытие старой переписки её не вызывает.
     ═══════════════════════════════════════════════════════════════ */
  var SETTLE_MS = 4200;                 // столько тишины = задача завершена
  var ARM_TTL_MS = 4 * 3600 * 1000;     // страховка от «вечного» взвода
  var arm = null;                       // { at, cascadeId, seenBusy, lastActivity }
  var armTicker = null;

  /* Агент работает? Композер на время работы показывает кнопку Cancel
     (data-tooltip-id="input-send-button-cancel-tooltip"), в переписке —
     индикатор agent-loading. Ни тот, ни другой не появляется при
     открытии истории. */
  function isAgentBusy() {
    try {
      return !!document.querySelector(
        '[data-tooltip-id="input-send-button-cancel-tooltip"],' +
        '[data-testid="send-button-pending"],' +
        '[data-testid="agent-loading"]');
    } catch (e) { return false; }
  }

  function readComposer(el) {
    try {
      var v = (el.value !== undefined ? el.value : el.textContent) || "";
      return v.replace(/\s+/g, " ").trim();
    } catch (e) { return ""; }
  }

  function armTrigger(source) {
    var now = Date.now();
    var id = convoId();
    arm = {
      at: now,
      cascadeId: (id && id !== "conversation") ? id : "",
      seenBusy: false,
      lastActivity: now
    };
    dbg("arm:" + source + " id=" + (arm.cascadeId || "?"));
    if (!armTicker) armTicker = setInterval(armTick, 700);
  }

  function disarm(reason) {
    if (!arm) return;
    arm = null;
    if (armTicker) { clearInterval(armTicker); armTicker = null; }
    dbg("disarm:" + reason);
  }

  /* ── Доставка завершения ────────────────────────────────────────
     Раньше завершение в фоне или в другом чате просто выбрасывалось:
     `done:background -> skip`. Для длинной задачи (сборка, установка, NDK)
     это значило, что пользователь не увидит ни гифки, ни звука вообще —
     уведомления-то в шторке на завершение хода нет. Теперь такое событие
     запоминается и показывается при возврате в приложение. */
  var PENDING_TTL_MS = 15 * 60 * 1000;
  var pendingDone = null;

  function announce(cascadeId) {
    if (!isForeground()) {
      pendingDone = { at: Date.now(), cascadeId: cascadeId || "" };
      dbg("announce:background -> pending");
      return;
    }
    var cur = convoId();
    if (cascadeId && cur && cur !== cascadeId) {
      // Открыт другой чат. Гифку в чужую переписку не вставляем, но и
      // молчать не должны — показываем оверлей и играем звук.
      dbg("announce:other-chat -> overlay");
      funShow("", { force: true, overlay: true });
      return;
    }
    funShow(cascadeId);
  }

  function flushPending() {
    if (!pendingDone) return;
    var p = pendingDone;
    pendingDone = null;
    if (Date.now() - p.at > PENDING_TTL_MS) { dbg("pending:expired"); return; }
    dbg("pending:deliver");
    announce(p.cascadeId);
  }

  function armTick() {
    if (!arm) { disarm("idle"); return; }
    var now = Date.now();
    if (now - arm.at > ARM_TTL_MS) { disarm("ttl"); return; }

    // Новый чат: настоящий cascadeId появляется только после отправки
    if (!arm.cascadeId) {
      var id = convoId();
      if (id && id !== "conversation") arm.cascadeId = id;
    }
    if (isAgentBusy()) {
      arm.seenBusy = true;
      arm.lastActivity = now;
      return;
    }
    if (!arm.seenBusy) return;                       // работа ещё не началась
    if (now - arm.lastActivity < SETTLE_MS) return;   // агент молчит недолго

    var done = arm;
    disarm("completed");
    dbg("trigger:task-completed");
    announce(done.cascadeId);
  }

  /* Стриминг ответа лишь продлевает «тишину» — решение принимает armTick. */
  function markActivity() {
    if (!arm) return;
    arm.lastActivity = Date.now();
    arm.seenBusy = true;   // GetTurnDiff запрашивается только для активного хода
  }

  /* Возврат в приложение.
     Пока WebView в фоне, Android приостанавливает таймеры, поэтому за время
     свёрнутого приложения armTick может не выполниться ни разу: индикатор
     занятости уже исчез, `seenBusy` так и остался false — и завершение
     терялось. Если нас вернули в приложение, а шаг был взведён и агент
     сейчас не работает, считаем, что работа прошла, и отдаём решение
     обычному SETTLE_MS вместо бесконечного ожидания.
     Проверка отложена на GRACE_MS, чтобы дать индикатору занятости
     отрисоваться: иначе мгновенный возврат после отправки засчитывался
     как завершение. Порог не зависит от того, сколько пользователь
     отсутствовал, — привязка к времени взвода оставляла взвод навсегда
     в состоянии «работа ещё не началась». */
  var GRACE_MS = 1500;
  try {
    document.addEventListener("visibilitychange", function () {
      if (!isForeground()) return;
      dbg("visible");
      onGesture();
      if (arm && !arm.seenBusy && !isAgentBusy()) {
        setTimeout(function () {
          if (arm && !arm.seenBusy && !isAgentBusy()) {
            dbg("visible:settle-armed");
            arm.seenBusy = true;
            arm.lastActivity = Date.now();
          }
        }, GRACE_MS);
      }
      setTimeout(flushPending, 600);
    }, false);
  } catch (e) {}

  try {
    var origFetch = window.fetch;
    if (typeof origFetch === "function") {
      window.fetch = function (input) {
        try {
          var url = typeof input === "string" ? input : (input && input.url) || "";
          if (url) {
            var low = url.toLowerCase();
            if (low.indexOf("sendusercascademessage") !== -1) armTrigger("rpc");
            else if (low.indexOf("getturndiff") !== -1) markActivity();
          }
        } catch (e) {}
        return origFetch.apply(this, arguments);
      };
    }
  } catch (e) {}

  /* Кнопка отправки — самый надёжный сигнал на телефоне. */
  document.addEventListener("click", function (e) {
    try {
      var b = e.target && e.target.closest && e.target.closest('[data-testid="send-button"]');
      if (!b || b.disabled) return;
      if (!b.closest('[data-testid="agent-input-box"]')) return;
      armTrigger("send-button");
    } catch (err) {}
  }, true);

  /* Enter в композере: взводим только если сообщение реально ушло (поле
     опустело). Раньше Enter в ЛЮБОМ поле (поиск, переименование) взводил
     триггер и не снимал его — из-за этого гифка выскакивала при открытии
     старой переписки. */
  document.addEventListener("keydown", function (e) {
    try {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      var tg = e.target;
      if (!tg || !tg.closest || !tg.closest('[data-testid="agent-input-box"]')) return;
      if (!(tg.tagName === "TEXTAREA" || tg.isContentEditable || tg.getAttribute("role") === "textbox")) return;
      if (!readComposer(tg)) return;      // пустой Enter — не отправка
      setTimeout(function () {
        try { if (!tg.isConnected) return; } catch (err) {}
        if (readComposer(tg) === "") armTrigger("enter");
        else { try { dbg("skip:enter-not-sent"); } catch (err2) {} }
      }, 450);
    } catch (err) {}
  }, true);

  /* --- Блок настроек в «Оформление» (Appearance) ---
     Использует mount-хост div.agy-fun-done-host, вставленный в экран Appearance
     (как у brand/customizations), плюс polling-fallback на заголовок. */
  function buildSettingsBox() {
    var box = document.createElement("div");
    box.id = "agy-fun-done-settings";
    box.setAttribute("style",
      "margin:16px 0;padding:16px;border:1px solid var(--border,#333);border-radius:12px;" +
      "background:var(--background,transparent);color:var(--foreground,#eee);font:14px system-ui,sans-serif;");
    box.innerHTML =
      '<div style="font-weight:600;margin-bottom:8px">🎉 ' + T("Прикол при завершении задачи", "Fun on task completion") + '</div>' +
      '<label style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
      '<input type="checkbox" id="agy-fd-on"> ' + T("Показывать гифку, когда приложение на экране", "Show the GIF while the app is on screen") + '</label>' +
      '<label style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
      '<input type="checkbox" id="agy-fd-chat"> ' + T("Показывать гифку в чате (в переписке, а не на весь экран)", "Show the GIF inline in the chat (instead of full screen)") + '</label>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
      Object.keys(PRESETS).map(function (k) {
        return '<button data-preset="' + k + '" style="padding:4px;display:flex;flex-direction:column;align-items:center;gap:4px;border-radius:8px;border:1px solid var(--border,#444);background:var(--secondary,#222);color:inherit;cursor:pointer">' +
          '<img src="' + PRESETS[k] + '" style="width:72px;height:56px;object-fit:cover;border-radius:6px">' +
          ({ michael: "😐 Nice", nice: "👏 DiCaprio", bateman: "😏 Bateman", deadpool: "🗡 Deadpool", jeremiah: "🤠 Jeremiah" })[k] +
          '</button>';
      }).join("") + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
      '<input id="agy-fd-url" placeholder="' + T("Ссылка на свою гифку (https://...)", "Link to your own GIF (https://...)") + '" style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--border,#444);background:var(--secondary,#1a1a1a);color:inherit">' +
      '<button id="agy-fd-apply" style="padding:8px 14px;border-radius:8px;border:none;background:var(--primary,#4f7cff);color:#fff;cursor:pointer">' + T("ОК", "OK") + '</button></div>' +
      '<div style="font-weight:600;margin:10px 0 8px">🔊 ' + T("Звук при завершении", "Completion sound") + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
      Object.keys(SOUNDS).map(function (k) {
        return '<button data-sound="' + k + '" style="padding:6px 12px;border-radius:8px;border:1px solid var(--border,#444);background:var(--secondary,#222);color:inherit;cursor:pointer">' +
          ({ "app-done": "🔔 " + T("Стандартный", "Default"), chime: "🌀 Portal", pop: "🛎 Bell" })[k] + '</button>';
      }).join("") + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
      '<input id="agy-fd-sound-url" placeholder="' + T("Ссылка на свой звук (https://...mp3)", "Link to your own sound (https://...mp3)") + '" style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--border,#444);background:var(--secondary,#1a1a1a);color:inherit">' +
      '<button id="agy-fd-sound-apply" style="padding:8px 14px;border-radius:8px;border:none;background:var(--primary,#4f7cff);color:#fff;cursor:pointer">' + T("ОК", "OK") + '</button></div>' +
      '<button id="agy-fd-test" style="padding:6px 12px;border-radius:8px;border:1px solid var(--border,#444);background:transparent;color:inherit;cursor:pointer">' + T("Показать пример", "Show a preview") + '</button>';

    var on = box.querySelector("#agy-fd-on");
    on.checked = get("agy.funDoneEnabled", "1") !== "0";
    on.addEventListener("change", function () {
      try { localStorage.setItem("agy.funDoneEnabled", on.checked ? "1" : "0"); } catch (e) {}
    });
    var chat = box.querySelector("#agy-fd-chat");
    chat.checked = get("agy.funDoneInChat", "1") !== "0";
    chat.addEventListener("change", function () {
      try { localStorage.setItem("agy.funDoneInChat", chat.checked ? "1" : "0"); } catch (e) {}
    });
    box.querySelectorAll("[data-preset]").forEach(function (b) {
      b.addEventListener("click", function () {
        try { localStorage.setItem("agy.funDonePreset", b.getAttribute("data-preset")); localStorage.removeItem("agy.funDoneGif"); } catch (e) {}
        refreshSelection(box);
      });
    });
    var url = box.querySelector("#agy-fd-url");
    url.value = get("agy.funDoneGif", "");
    box.querySelector("#agy-fd-apply").addEventListener("click", function () {
      try { localStorage.setItem("agy.funDoneGif", url.value.trim()); localStorage.removeItem("agy.funDonePreset"); } catch (e) {}
      refreshSelection(box);
    });
    box.querySelectorAll("[data-sound]").forEach(function (b) {
      b.addEventListener("click", function () {
        try { localStorage.setItem("agy.funDoneSound", b.getAttribute("data-sound")); } catch (e) {}
        refreshSelection(box);
      });
    });
    var surl = box.querySelector("#agy-fd-sound-url");
    surl.value = get("agy.funDoneSoundUrl", "");
    box.querySelector("#agy-fd-sound-apply").addEventListener("click", function () {
      try { localStorage.setItem("agy.funDoneSoundUrl", surl.value.trim()); } catch (e) {}
    });
    box.querySelector("#agy-fd-test").addEventListener("click", function () {
      // Настройки открыты вне чата — in-chat вставка тут невозможна,
      // поэтому пример всегда показываем оверлеем.
      lastShow = 0;
      show();
      playSound();
    });
    return box;
  }

  function refreshSelection(box) {
    try { loadGifDataUrl(gifSrc(), function(){}); } catch(e) {}
    var curP = get("agy.funDonePreset", ""), curU = get("agy.funDoneGif", "");
    var curS = get("agy.funDoneSound", "app-done");
    box.querySelectorAll("[data-preset]").forEach(function (b) {
      var sel = b.getAttribute("data-preset") === curP && !curU;
      b.style.borderColor = sel ? "var(--primary,#4f7cff)" : "var(--border,#444)";
      b.style.boxShadow = sel ? "0 0 0 2px var(--primary,#4f7cff)" : "none";
    });
    box.querySelectorAll("[data-sound]").forEach(function (b) {
      var sel = b.getAttribute("data-sound") === curS;
      b.style.borderColor = sel ? "var(--primary,#4f7cff)" : "var(--border,#444)";
      b.style.boxShadow = sel ? "0 0 0 2px var(--primary,#4f7cff)" : "none";
    });
  }

  window.__agyFunDoneMount = function (el) {
    if (!el) return;
    var existing = el.querySelector("#agy-fun-done-settings");
    if (existing) return;      // React перемонтировал тот же хост — блок уже внутри
    el.style.cssText = "padding:4px 4px 24px;max-width:620px;box-sizing:border-box";
    var box = buildSettingsBox();
    refreshSelection(box);
    el.appendChild(box);
  };

  /* Диагностика для проверки на устройстве:
       __agyFunDiag()  — текущее состояние и последние 20 шагов;
       __agyFunFire()  — принудительный показ (как при завершении задачи). */
  try {
    window.__agyFunDiag = function () {
      return {
        enabled: get("agy.funDoneEnabled", "1") !== "0",
        inChat: get("agy.funDoneInChat", "1") !== "0",
        gif: gifSrc(),
        sound: soundSrc(),
        audioUnlocked: audioUnlocked,
        soundQueued: soundQueued,
        visible: isForeground(),
        armed: !!arm,
        seenBusy: arm ? !!arm.seenBusy : false,
        pending: pendingDone ? { ageMs: Date.now() - pendingDone.at } : null,
        log: (window.__agyFunDebug || []).slice(-20)
      };
    };
    window.__agyFunFire = function () { lastShow = 0; announce(convoId()); return true; };
  } catch (e) {}

  /* Блок настроек монтируется ТОЛЬКО через div.agy-fun-done-host на экране
     «Оформление» (Appearance). Без polling-fallback, чтобы не попадать в «Общие». */
})();
