/* Leostryx — fun completion overlay.
 *
 * Когда агент завершает задачу, приложение подгружает /antigravityCascadeDone.mp3
 * и проигрывает звук. Мы перехватываем этот момент:
 *   - приложение на экране (visible + focus) -> показываем гифку-прикол поверх UI
 *   - приложение в фоне -> звук играет штатно (ничего не показываем)
 *
 * Настройка (в «Оформление» приложения или напрямую):
 *   localStorage.setItem('agy.funDoneGif', 'https://.../funny.gif')  — своя гифка/картинка
 *   localStorage.setItem('agy.funDoneEnabled', '1' | '0')            — вкл/выкл
 *   localStorage.setItem('agy.funDonePreset', 'nyan'|'party'|'thumbs'|'none')
 * Отключить показ: agy.funDoneEnabled = '0'
 */
(function () {
  "use strict";
  function get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }
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
     остальные — маленькие mp3 с CDN; можно указать свой URL. */
  var SOUNDS = {
    "app-done": "/antigravityCascadeDone.mp3", // встроенный звук приложения
    chime: "https://cdn.jsdelivr.net/gh/hyprwm/hyprland-assets@main/sounds/chime.mp3",
    pop:   "https://cdn.jsdelivr.net/gh/hyprwm/hyprland-assets@main/sounds/pop.mp3"
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
    label.textContent = "Задача завершена! 🎉";
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
  var pendingChatGif = false;
  var watchChatTimer = null;

  function findChatContainer() {
    // 1. Точный селектор Antigravity conversation-view
    var convo = document.querySelector('[data-testid="conversation-view"]');
    if (convo) return convo;

    // 2. Селектор по ролям / классам
    var alt = document.querySelector('[class*="conversation-view"], [class*="conversation"], main [role="log"]');
    if (alt) return alt;

    // 3. От поля ввода наверх
    var inp = document.querySelector('textarea, [role="textbox"], [contenteditable="true"]');
    if (inp) {
      var cur = inp.parentElement;
      while (cur && cur !== document.body) {
        if (cur.clientHeight > 250 && (cur.scrollHeight > cur.clientHeight || cur.getAttribute("data-testid") === "conversation-view")) {
          return cur;
        }
        cur = cur.parentElement;
      }
    }
    return null;
  }

  function insertGifToElement(chat, dataUrl) {
    if (!chat) return false;
    // Проверим, нет ли уже свежей гифки
    var existing = chat.querySelector(".agy-fun-chat");
    if (existing) {
      try { existing.remove(); } catch(e) {}
    }

    var wrap = document.createElement("div");
    wrap.className = "agy-fun-chat";
    wrap.setAttribute("style",
      "display:flex;flex-direction:column;align-items:center;margin:14px auto;padding:8px 12px 10px;" +
      "background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;" +
      "box-shadow:0 4px 20px rgba(0,0,0,0.35);max-width:280px;box-sizing:border-box;pointer-events:auto;");

    var img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "Task done!";
    img.setAttribute("style",
      "max-width:260px;max-height:190px;border-radius:12px;object-fit:cover;display:block;background:#18181b;");

    var caption = document.createElement("div");
    caption.textContent = "Задача выполнена 🎉";
    caption.setAttribute("style",
      "margin-top:6px;font:500 12px/1.3 system-ui,sans-serif;color:var(--text-secondary,#94a3b8);text-align:center;");

    wrap.appendChild(img);
    wrap.appendChild(caption);

    // Если внутри chat есть блок формы ввода (в самом низу), вставляем ПЕРЕД ним,
    // либо в конец контейнера сообщений
    var inputRow = chat.querySelector('[class*="px-4 pb-2"], [class*="composer"], form, textarea')?.closest('div[class*="items-center"]');
    if (inputRow && inputRow.parentElement === chat) {
      chat.insertBefore(wrap, inputRow);
    } else {
      chat.appendChild(wrap);
    }

    dbg("chatInsert:inserted ok");
    try {
      chat.scrollTo({ top: chat.scrollHeight, behavior: "smooth" });
    } catch(e) {
      try { chat.scrollTop = chat.scrollHeight; } catch(e2) {}
    }

    // Авто-удаление через 35 секунд
    setTimeout(function() {
      try { wrap.remove(); } catch(e) {}
    }, 35000);
    return true;
  }

  function chatInsert() {
    var chat = findChatContainer();
    if (!chat) {
      // Пользователь не на экране чата (в настройках / проектах).
      // НЕ показываем оверлей на весь экран! Ждем перехода в чат:
      dbg("chatInsert:not-on-chat-screen -> waiting");
      pendingChatGif = true;
      if (!watchChatTimer) {
        var attempts = 0;
        watchChatTimer = setInterval(function() {
          attempts++;
          var c = findChatContainer();
          if (c && pendingChatGif) {
            clearInterval(watchChatTimer);
            watchChatTimer = null;
            pendingChatGif = false;
            dbg("chatInsert:deferred-found-chat");
            loadGifDataUrl(gifSrc(), function(dataUrl) {
              insertGifToElement(c, dataUrl);
            });
          } else if (attempts > 60) { // 30 секунд ждем
            clearInterval(watchChatTimer);
            watchChatTimer = null;
            pendingChatGif = false;
            dbg("chatInsert:deferred-timeout");
          }
        }, 500);
      }
      return;
    }

    loadGifDataUrl(gifSrc(), function(dataUrl) {
      insertGifToElement(chat, dataUrl);
    });
  }

  var lastShow = 0;
  var scriptStart = Date.now();
  try { dbg("init:origin=" + window.location.origin); } catch(e) {}
  function dbg(s) {
    try { window.__agyFunDebug = (window.__agyFunDebug || []).concat([s]).slice(-40); } catch (e) {}
  }
  function funShow() {
    var now = Date.now();
    if (now - scriptStart < 8000) { dbg("skip:warmup"); return; }
    if (now - lastShow < 12000) { dbg("skip:cooldown"); return; }
    lastShow = now;
    dbg("fire:inChat=" + get("agy.funDoneInChat", "1"));
    if (get("agy.funDoneInChat", "1") === "0") show(); else chatInsert();
    try { new Audio(soundSrc()).play().catch(function (e) {}); } catch (e) {}
  }

  function isForeground() {
    try { return document.visibilityState === "visible"; }
    catch (e) { return true; }
  }

  /* ═══════════════════════════════════════════════════════════════
     ЕДИНСТВЕННЫЙ ТРИГГЕР: реальное завершение отправленной задачи
     ───────────────────────────────────────────────────────────────
     1. Активируется ТОЛЬКО когда пользователь отправил сообщение
        (SendUserCascadeMessage или клик отправки / Enter).
     2. Пока агент стримит ответ, идут GetTurnDiff (~каждые 1-2 сек).
     3. Как только стрим остановился на 3 сек — задача завершена 🎉.
     4. Если вы просто открыли старый чат — SendUserCascadeMessage
        НЕ вызывался, поэтому открытие истории НИКОГДА не вызовет гифку!
     ═══════════════════════════════════════════════════════════════ */
  try {
    var origFetch = window.fetch;
    if (typeof origFetch === "function") {

      var userSentTask = false;      // пользователь отправил задачу в работу
      var diffSeenCount = 0;         // счетчик шагов стриминга ответа
      var turnDiffTimer = null;      // таймер завершения
      var PAUSE_MS = 3000;           // 3 сек тишины после ответа

      function armUserTask() {
        userSentTask = true;
        diffSeenCount = 0;
        dbg("arm:task-started");
      }

      // Отслеживаем также отправку через Enter
      document.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          var tg = e.target;
          if (tg && (tg.tagName === "TEXTAREA" || tg.isContentEditable || tg.getAttribute("role") === "textbox")) {
            armUserTask();
          }
        }
      }, true);

      function onTurnDiffSeen() {
        if (!userSentTask) return;
        diffSeenCount++;
        if (turnDiffTimer) clearTimeout(turnDiffTimer);
        turnDiffTimer = setTimeout(function () {
          if (!userSentTask) return;
          userSentTask = false;
          diffSeenCount = 0;
          dbg("trigger:task-completed");
          if (isForeground()) funShow();
        }, PAUSE_MS);
      }

      window.fetch = function (input, init) {
        try {
          var url = typeof input === "string" ? input : (input && input.url) || "";
          if (url) {
            // Отправка запроса пользователем -> активируем триггер
            if (url.indexOf("SendUserCascadeMessage") !== -1) {
              armUserTask();
            }
            // Стриминг ответа агента
            else if (url.indexOf("GetTurnDiff") !== -1) {
              if (userSentTask) {
                onTurnDiffSeen();
              } else {
                dbg("skip:GetTurnDiff-idle");
              }
            }
          }
        } catch (e) {}
        return origFetch.apply(this, arguments);
      };
    }
  } catch (e) {}

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
      '<div style="font-weight:600;margin-bottom:8px">🎉 Прикол при завершении задачи</div>' +
      '<label style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
      '<input type="checkbox" id="agy-fd-on"> Показывать гифку, когда приложение на экране</label>' +
      '<label style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
      '<input type="checkbox" id="agy-fd-chat"> Показывать гифку в чате (в переписке, а не на весь экран)</label>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
      Object.keys(PRESETS).map(function (k) {
        return '<button data-preset="' + k + '" style="padding:4px;display:flex;flex-direction:column;align-items:center;gap:4px;border-radius:8px;border:1px solid var(--border,#444);background:var(--secondary,#222);color:inherit;cursor:pointer">' +
          '<img src="' + PRESETS[k] + '" style="width:72px;height:56px;object-fit:cover;border-radius:6px">' +
          ({ michael: "😐 Nice", nice: "👏 DiCaprio", bateman: "😏 Bateman", deadpool: "🗡 Deadpool", jeremiah: "🤠 Jeremiah" })[k] +
          '</button>';
      }).join("") + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
      '<input id="agy-fd-url" placeholder="Ссылка на свою гифку (https://...)" style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--border,#444);background:var(--secondary,#1a1a1a);color:inherit">' +
      '<button id="agy-fd-apply" style="padding:8px 14px;border-radius:8px;border:none;background:var(--primary,#4f7cff);color:#fff;cursor:pointer">ОК</button></div>' +
      '<div style="font-weight:600;margin:10px 0 8px">🔊 Звук при завершении</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
      Object.keys(SOUNDS).map(function (k) {
        return '<button data-sound="' + k + '" style="padding:6px 12px;border-radius:8px;border:1px solid var(--border,#444);background:var(--secondary,#222);color:inherit;cursor:pointer">' +
          ({ "app-done": "🔔 Стандартный", chime: "🎵 Chime", pop: "💧 Pop" })[k] + '</button>';
      }).join("") + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
      '<input id="agy-fd-sound-url" placeholder="Ссылка на свой звук (https://...mp3)" style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--border,#444);background:var(--secondary,#1a1a1a);color:inherit">' +
      '<button id="agy-fd-sound-apply" style="padding:8px 14px;border-radius:8px;border:none;background:var(--primary,#4f7cff);color:#fff;cursor:pointer">ОК</button></div>' +
      '<button id="agy-fd-test" style="padding:6px 12px;border-radius:8px;border:1px solid var(--border,#444);background:transparent;color:inherit;cursor:pointer">Показать пример</button>';

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
      funShow();
      try { new Audio(soundSrc()).play().catch(function (e) {}); } catch (e) {}
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

  /* Блок настроек монтируется ТОЛЬКО через div.agy-fun-done-host на экране
     «Оформление» (Appearance). Без polling-fallback, чтобы не попадать в «Общие». */
})();
