(function(){
/**
 * patches/startup_ready/signal.js - shared scope, guard and ready signal.
 *
 * First fragment: if the patch already installed, exit the whole IIFE.
 */
'use strict';

if (window.__agStartupReady && window.__agStartupReady.__installed) {
  return;
}

var global = window;
var state = { signalled: false, inputSeenAt: 0 };

/* ---- Diagnostics ---------------------------------------------------------
 * Native diagnostics redact URLs, so a failing resource URL never reaches the
 * error screen. diag() rewrites it into a URL-shaped-free token that survives
 * the redactor: "127_0_0_1_48155_generated_main_js_v_3_1_11". */
function diag(value) {
  try {
    return String(value == null ? '' : value)
      .replace(/^https?:\/\//i, '')
      .replace(/[.:/\\?&=#%\s]+/g, '_')
      .slice(0, 200);
  } catch (e) { return 'diag_error'; }
}

/* Was this page load caused by a core restart (providers switch / apply)? */
var restartCtx = null;
try {
  var restartRaw = global.localStorage.getItem('__agyCoreRestart');
  if (restartRaw) {
    var restartParsed = JSON.parse(restartRaw);
    if (restartParsed && restartParsed.ts && (Date.now() - restartParsed.ts) < 300000) {
      restartCtx = restartParsed;
    } else {
      global.localStorage.removeItem('__agyCoreRestart');
    }
  }
} catch (e) {}

function signal(reason) {
  if (state.signalled) return;
  state.signalled = true;
  try {
    // UI поднялся — сбрасываем счётчик авто-перезагрузок (см. arm/fallback).
    try {
      global.localStorage.removeItem('__agyStartupReloadAt');
      global.localStorage.removeItem('__agyStartupReloadN');
      global.localStorage.removeItem('__agyCoreRestart');
    } catch (e) {}
    // Сообщаем странице (в первую очередь экрану перезапуска ядра), что UI
    // действительно отрисован: по этому событию он и уходит, а не по факту
    // появления поля ввода в DOM (раньше из-за этого мелькал пустой экран).
    try {
      global.__agyUiReady = true;
      if (global.document && global.document.dispatchEvent) {
        global.document.dispatchEvent(new global.CustomEvent('agy-ui-ready', { detail: { reason: reason || 'unknown' } }));
      }
    } catch (e) {}
    console.log('[AGY Startup] UI Ready triggered via: ' + (reason || 'unknown'));
    if (global.Android && typeof global.Android.onUiReady === 'function') {
      global.Android.onUiReady(global.__AG_NATIVE_BRIDGE_TOKEN__);
    }
  } catch (e) {
    console.warn('[AGY Startup] Android.onUiReady error:', e);
  }
}

/**
 * patches/startup_ready/error-capture.js - surface startup errors to native.
 */
var startupErrors = [];
var failedResources = [];
try {
  /* Capture-phase handler: resource load failures (<script>, <link>) do not
   * bubble, while script parse errors arrive here as window-level events. */
  global.addEventListener('error', function (ev) {
    var t = ev && ev.target;
    if (t && t.nodeType === 1 && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) {
      var resUrl = t.src || t.href || '';
      failedResources.push(t.tagName + ' ' + resUrl);
      console.error('[AGY Startup] resource failed: ' + t.tagName + ' ' + resUrl);
      return;
    }
    var msg = ev && (ev.message || (ev.error && ev.error.message)) ? (ev.message || ev.error.message) : String(ev);
    var src = ev && ev.filename ? (ev.filename + ':' + ev.lineno + ':' + ev.colno) : '';
    var full = '[JS Error ' + src + '] ' + msg;
    startupErrors.push(full);
    console.error(full);
  }, true);
  global.addEventListener('unhandledrejection', function (ev) {
    var reason = ev && ev.reason ? (ev.reason.stack || ev.reason.message || String(ev.reason)) : 'unknown rejection';
    var full = '[Unhandled Rejection] ' + reason;
    startupErrors.push(full);
    console.error(full);
  });
} catch (e) {}

/**
 * patches/startup_ready/console-hook.js - signal on ConversationLoad completion.
 */
try {
  var origInfo = console.info ? console.info.bind(console) : null;
  if (origInfo) {
    console.info = function () {
      var msg = arguments[0];
      if (typeof msg === 'string' && msg.indexOf('[ConversationLoad]') !== -1) {
        /* ignored: fires before the auth status is known (chat flash before login) */
      }
      return origInfo.apply(console, arguments);
    };
  }
} catch (e) {}

/**
 * patches/startup_ready/detect-ui.js - has React mounted real UI content?
 */
function isUiRendered() {
  try {
    var root = global.document && global.document.getElementById('root');
    if (!root) return false;

    // 0. Login / auth panel is final for a signed-out user: ready at once.
    if (root.querySelector('.entrance-auth-panel')) {
      signal('auth-panel-rendered');
      return true;
    }

    // 1. Has real chat message turns or conversation content rendered?
    var hasMessages = !!root.querySelector('[data-role="user"], [data-role="assistant"], [data-turn-id], .message-row, .prose, [data-message-id]');
    if (hasMessages) {
      signal('messages-rendered');
      return true;
    }

    // 2. Has the input area appeared?
    var hasInput = !!root.querySelector('textarea, [contenteditable="true"], [role="textbox"], button[type="submit"]');
    var hasContentNow = hasInput || !!root.firstElementChild;
    if (!hasContentNow) { state.inputSeenAt = 0; return false; }
    if (!state.inputSeenAt) state.inputSeenAt = Date.now();
    if (Date.now() - state.inputSeenAt < 1500) return false;
    if (hasInput) {
      signal('chat-input-ready');
      return true;
    }

    // 3. Has any auth, landing, onboarding or welcome content rendered?
    var hasContent = !!(root.firstElementChild || (root.children && root.children.length > 0));
    if (hasContent) {
      signal('root-has-content');
      return true;
    }
  } catch (e) {}
  return false;
}

/**
 * patches/startup_ready/arm.js - watch for the first real UI paint.
 */
function arm() {
  if (!global.document) {
    signal('no-document');
    return;
  }

  if (isUiRendered()) return;

  try {
    if (global.MutationObserver) {
      var observer = new MutationObserver(function () {
        if (isUiRendered()) {
          try { observer.disconnect(); } catch (e) {}
        }
      });
      var target = global.document.getElementById('root') || global.document.body || global.document.documentElement;
      if (target) {
        observer.observe(target, { childList: true, subtree: true });
      }
    }
  } catch (e) {}

  var poller = global.setInterval(function () {
    if (isUiRendered() || state.signalled) {
      global.clearInterval(poller);
    }
  }, 40);

  // Fallback: how long we wait for the first real paint before acting.
  var BOOT_DEADLINE = restartCtx ? 12000 : 8000;

  function bootDiag() {
    var d = 'BOOT_DIAG ui=blank';
    d += ' rs=' + (global.document ? global.document.readyState : '?');
    d += ' root=' + (global.document && global.document.getElementById('root') ? 'yes' : 'no');
    d += ' url=' + diag(global.location && global.location.href);
    if (restartCtx) d += ' restart=' + diag(restartCtx.path || 'net');
    if (failedResources.length) d += ' res=' + diag(failedResources[0]);
    if (startupErrors.length) d += ' err=' + diag(startupErrors[0]);
    return d;
  }

  global.setTimeout(function () {
    global.clearInterval(poller);
    if (isUiRendered()) {
      return;
    }
    // Транзиентный сбой загрузки (ядро отдало HTML-заглушку вместо скрипта,
    // пока распаковывало/поднимало UI после рестарта) не требует фатального
    // экрана: одна-две повторные загрузки страницы лечат его сами.
    // «Чёрный экран» после переключения ядра — тот же класс проблемы: страница
    // поднялась, но React ничего не отрисовал, ошибок нет, и натив просто
    // уберёт сплэш по watchdog'у. Поэтому при рестарте ядра перезагружаемся и
    // без ошибок, а на экран ошибки выводим диагностику, которую редактор
    // натива не вырежет (URL без точек и слэшей).
    var suspicious = !!(startupErrors.length || failedResources.length || restartCtx);
    if (suspicious) {
      var last = 0, tries = 0;
      try {
        last = +global.localStorage.getItem('__agyStartupReloadAt') || 0;
        tries = +global.localStorage.getItem('__agyStartupReloadN') || 0;
      } catch (e) {}
      var limit = restartCtx ? 3 : 2;
      var attempt = (!last || Date.now() - last > 120000) ? 1 : tries + 1;
      if (attempt <= limit) {
        try {
          global.localStorage.setItem('__agyStartupReloadAt', String(Date.now()));
          global.localStorage.setItem('__agyStartupReloadN', String(attempt));
        } catch (e) {}
        console.warn('[AGY Startup] ' + bootDiag() + ' (reload ' + attempt + '/' + limit + ')');
        global.setTimeout(function () {
          try { global.location.reload(); } catch (e) {}
        }, 300);
        return;
      }
      try {
        global.localStorage.removeItem('__agyStartupReloadAt');
        global.localStorage.removeItem('__agyStartupReloadN');
      } catch (e) {}
    }
    if (!state.signalled && suspicious && global.Android && typeof global.Android.onUiError === 'function') {
      global.Android.onUiError(global.__AG_NATIVE_BRIDGE_TOKEN__, bootDiag());
      return;
    }
    signal('fallback-timeout');
  }, BOOT_DEADLINE);
}

/**
 * patches/startup_ready/public-api.js - expose and arm on boot.
 */
if (global.document && global.document.readyState === 'loading') {
  global.document.addEventListener('DOMContentLoaded', arm, { once: true });
} else {
  arm();
}

global.__agStartupReady = {
  __installed: true,
  signal: signal
};


})();
