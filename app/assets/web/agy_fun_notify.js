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
  if (get("agy.funDoneEnabled", "1") === "0") return;

  var PRESETS = {
    uhm:      "./gifs/fun_uhm.webp",      // UHM (мужчина, «угм»)
    deadpool: "./gifs/fun_deadpool.webp", // Deadpool "VERY NICE!!"
    nice:     "./gifs/fun_nice.webp",     // DiCaprio clap "NICE"
    zach:     "./gifs/fun_zach.webp",     // Zach Galifianakis
    bale:     "./gifs/fun_bale.webp"      // Patrick Bateman smile
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
    return PRESETS.nyan;
  }

  var overlay = null, hideTimer = null;

  function buildOverlay() {
    var el = document.createElement("div");
    el.id = "agy-fun-done";
    el.setAttribute("style",
      "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(0,0,0,.55);opacity:0;transition:opacity .25s ease;");
    var img = document.createElement("img");
    img.src = gifSrc();
    img.alt = "Task done!";
    img.setAttribute("style",
      "max-width:72vw;max-height:60vh;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.6);" +
      "transform:scale(.8);transition:transform .25s cubic-bezier(.2,1.4,.4,1);");
    var label = document.createElement("div");
    label.textContent = "Задача завершена! 🎉";
    label.setAttribute("style",
      "position:fixed;bottom:12vh;left:50%;transform:translateX(-50%);color:#fff;" +
      "font:600 18px/1.3 system-ui,sans-serif;text-shadow:0 2px 8px rgba(0,0,0,.8);pointer-events:none;");
    el.appendChild(img); el.appendChild(label);
    el.addEventListener("click", hide);
    return el;
  }

  function show() {
    if (overlay) clearTimeout(hideTimer);
    if (!overlay) {
      overlay = buildOverlay();
      (document.body || document.documentElement).appendChild(overlay);
      void overlay.offsetWidth;
    }
    overlay.style.opacity = "1";
    var img = overlay.querySelector("img");
    if (img) img.style.transform = "scale(1)";
    hideTimer = setTimeout(hide, DURATION_MS);
  }

  function hide() {
    if (!overlay) return;
    clearTimeout(hideTimer);
    var el = overlay; overlay = null;
    el.style.opacity = "0";
    setTimeout(function () { el.remove(); }, 300);
  }


  /* --- In-chat mode: вставляем гифку прямо в переписку --- */
  function chatInsert() {
    try {
      // контейнер переписки: берём скролл-область чата
      var chat = document.querySelector('[class*="conversation"], [class*="chat-scroll"], main [role="log"]');
      if (!chat) chat = document.body;
      var wrap = document.createElement("div");
      wrap.className = "agy-fun-chat";
      wrap.setAttribute("style",
        "display:flex;justify-content:center;margin:10px auto;pointer-events:none;");
      var img = document.createElement("img");
      img.src = gifSrc();
      img.alt = "Task done!";
      img.setAttribute("style",
        "max-width:260px;max-height:200px;border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,.4);");
      wrap.appendChild(img);
      chat.appendChild(wrap);
      try { chat.scrollTop = chat.scrollHeight; } catch (e) {}
      setTimeout(function () { wrap.remove(); }, 8000);
    } catch (e) { show(); } // fallback на оверлей
  }

  function funShow() { if (get("agy.funDoneInChat", "0") === "1") chatInsert(); else show(); }

  function isForeground() {
    try { return document.visibilityState === "visible" && document.hasFocus(); }
    catch (e) { return document.visibilityState === "visible"; }
  }

  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        if (url && url.indexOf("antigravityCascadeDone") !== -1 && isForeground()) {
          setTimeout(funShow, 150);
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }

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
          ({ uhm: "😐 Uhm", deadpool: "🗡 Very Nice", nice: "👏 Nice", zach: "🤨 Zach", bale: "😏 Bateman" })[k] +
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
    chat.checked = get("agy.funDoneInChat", "0") === "1";
    chat.addEventListener("change", function () {
      try { localStorage.setItem("agy.funDoneInChat", chat.checked ? "1" : "0"); } catch (e) {}
    });
    box.querySelectorAll("[data-preset]").forEach(function (b) {
      b.addEventListener("click", function () {
        try { localStorage.setItem("agy.funDonePreset", b.getAttribute("data-preset")); } catch (e) {}
      });
    });
    var url = box.querySelector("#agy-fd-url");
    url.value = get("agy.funDoneGif", "");
    box.querySelector("#agy-fd-apply").addEventListener("click", function () {
      try { localStorage.setItem("agy.funDoneGif", url.value.trim()); localStorage.removeItem("agy.funDonePreset"); } catch (e) {}
    });
    box.querySelectorAll("[data-sound]").forEach(function (b) {
      b.addEventListener("click", function () {
        try { localStorage.setItem("agy.funDoneSound", b.getAttribute("data-sound")); } catch (e) {}
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

  window.__agyFunDoneMount = function (el) {
    if (!el) return;
    var existing = el.querySelector("#agy-fun-done-settings");
    if (existing) return;      // React перемонтировал тот же хост — блок уже внутри
    el.style.cssText = "padding:4px 4px 24px;max-width:620px;box-sizing:border-box";
    el.appendChild(buildSettingsBox());
  };

  // fallback: если хоста нет (старый main.js), ищем заголовок Appearance
  var tries = 0;
  var t = setInterval(function () {
    tries++;
    if (tries > 120 || document.getElementById("agy-fun-done-settings")) return clearInterval(t);
    try {
      if (document.querySelector(".agy-fun-done-host")) return; // хост появится от React
      var heading = null, hs = document.querySelectorAll("h1,h2,h3,span,div");
      for (var i = 0; i < hs.length; i++) {
        var txt = (hs[i].textContent || "").trim();
        if (txt === "Appearance" || txt === "Оформление") { heading = hs[i]; break; }
      }
      if (!heading) return;
      var anchor = heading.closest("[class]") || heading;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(buildSettingsBox(), anchor.nextSibling);
      clearInterval(t);
    } catch (e) {}
  }, 1000);
})();
