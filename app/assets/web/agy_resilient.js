/* Leostryx — Resilient Network & Auto-Resume Module (agy_resilient.js)
 *
 * Provides transparent auto-reconnection and seamless resumption for
 * agent execution during network interruptions, cellular/Wi-Fi handovers,
 * and mobile sleep states.
 *
 * Features:
 * 1. Network interruption detector (online/offline events, socket resets, timeouts)
 * 2. Exponential backoff auto-reconnect loop with user status banner
 * 3. Idempotent tool execution checkpointing (prevents duplicate command/write side-effects)
 * 4. Seamless request retry preserving active trajectory context
 */
(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    var exp = factory();
    if (typeof window !== "undefined") {
      window.AgyResilient = exp;
    }
    if (typeof root !== "undefined") {
      root.AgyResilient = exp;
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
  var MAX_RECONNECT_ATTEMPTS = 12;
  var INITIAL_BACKOFF_MS = 1500;
  var MAX_BACKOFF_MS = 12000;
  var TOOL_CHECKPOINT_PREFIX = "agy_tool_cp_";

  var state = {
    isOnline: isBrowser ? (navigator.onLine !== false) : true,
    isReconnecting: false,
    activeAttempt: 0,
    bannerEl: null,
    pendingRetries: []
  };

  function T(ru, en) {
    if (typeof window !== "undefined" && window.__agyLang === "en") return en;
    return ru;
  }

  /* ------------------------------------------------ Network Error Detection */
  function isNetworkError(err) {
    if (!err) return false;
    var msg = (err.message || String(err)).toLowerCase();
    var name = (err.name || "").toLowerCase();
    return (
      name === "networkerror" ||
      name === "aborterror" ||
      name === "timeouterror" ||
      msg.indexOf("failed to fetch") >= 0 ||
      msg.indexOf("network error") >= 0 ||
      msg.indexOf("networkerror") >= 0 ||
      msg.indexOf("econnreset") >= 0 ||
      msg.indexOf("econnrefused") >= 0 ||
      msg.indexOf("etimedout") >= 0 ||
      msg.indexOf("sockettimeout") >= 0 ||
      msg.indexOf("err_internet_disconnected") >= 0 ||
      msg.indexOf("err_network_changed") >= 0 ||
      msg.indexOf("err_connection_reset") >= 0 ||
      msg.indexOf("load failed") >= 0
    );
  }

  /* ---------------------------------------------------- UI Banner Feedback */
  function ensureBanner() {
    if (!isBrowser || state.bannerEl) return state.bannerEl;
    var b = document.getElementById("agy-network-resume-banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "agy-network-resume-banner";
      b.setAttribute("data-agy-no-translate", "");
      b.style.cssText =
        "position:fixed;top:10px;left:50%;transform:translateX(-50%) translateY(-100px);" +
        "z-index:999999;padding:8px 16px;border-radius:24px;font-size:12px;font-weight:600;" +
        "display:flex;align-items:center;gap:8px;box-shadow:0 8px 30px rgba(0,0,0,0.5);" +
        "transition:transform .3s cubic-bezier(0.16,1,0.3,1), opacity .3s ease;opacity:0;" +
        "pointer-events:none;font-family:system-ui,-apple-system,sans-serif;";
      document.body.appendChild(b);
    }
    state.bannerEl = b;
    return b;
  }

  function showReconnectingBanner(attempt, maxAttempts) {
    var b = ensureBanner();
    if (!b) return;
    b.style.background = "linear-gradient(135deg, rgba(245,158,11,0.95), rgba(217,119,6,0.95))";
    b.style.color = "#ffffff";
    b.style.border = "1px solid rgba(255,255,255,0.3)";
    b.innerHTML =
      '<span style="display:inline-block;animation:agyPulse 1s infinite;">⚡</span> ' +
      '<span>' + T("Связь прервана. Авто-переподключение...", "Connection lost. Auto-reconnecting...") +
      ' (' + attempt + '/' + maxAttempts + ')</span>';
    b.style.opacity = "1";
    b.style.transform = "translateX(-50%) translateY(0)";
  }

  function showRestoredBanner() {
    var b = ensureBanner();
    if (!b) return;
    b.style.background = "linear-gradient(135deg, rgba(34,197,94,0.95), rgba(21,128,61,0.95))";
    b.style.color = "#ffffff";
    b.style.border = "1px solid rgba(255,255,255,0.3)";
    b.innerHTML =
      '<span>✓</span> ' +
      '<span>' + T("Связь восстановлена! Агент продолжает выполнение.", "Connection restored! Agent resuming...") + '</span>';
    b.style.opacity = "1";
    b.style.transform = "translateX(-50%) translateY(0)";

    setTimeout(function () {
      if (b) {
        b.style.opacity = "0";
        b.style.transform = "translateX(-50%) translateY(-100px)";
      }
    }, 3200);
  }

  /* ---------------------------------------------------- Backoff & Auto-Resume */
  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function waitForOnline() {
    if (!isBrowser) return Promise.resolve();
    if (navigator.onLine) return Promise.resolve();
    return new Promise(function (resolve) {
      function onOnline() {
        window.removeEventListener("online", onOnline);
        resolve();
      }
      window.addEventListener("online", onOnline);
    });
  }

  /**
   * Transparently executes an asynchronous fetch operation with auto-reconnection
   * upon network drops. Preserves request payload and streams smoothly.
   */
  function resilientFetch(fetchFn, options) {
    options = options || {};
    var maxAttempts = options.maxAttempts || MAX_RECONNECT_ATTEMPTS;
    var attempt = 0;

    function execute() {
      attempt++;
      return Promise.resolve()
        .then(function () {
          return fetchFn();
        })
        .then(function (result) {
          if (state.isReconnecting) {
            state.isReconnecting = false;
            showRestoredBanner();
          }
          return result;
        })
        .catch(function (err) {
          if (isNetworkError(err) && attempt < maxAttempts) {
            state.isReconnecting = true;
            showReconnectingBanner(attempt, maxAttempts);

            var backoff = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * Math.pow(1.5, attempt - 1));
            return Promise.race([
              wait(backoff),
              waitForOnline()
            ]).then(function () {
              return execute();
            });
          }
          if (state.isReconnecting) {
            state.isReconnecting = false;
            if (state.bannerEl) {
              state.bannerEl.style.opacity = "0";
              state.bannerEl.style.transform = "translateX(-50%) translateY(-100px)";
            }
          }
          throw err;
        });
    }

    return execute();
  }

  /* ---------------------------------- Idempotent Tool Execution Checkpointing */
  function getStorage() {
    try {
      if (typeof localStorage !== "undefined") return localStorage;
    } catch (e) {}
    return null;
  }

  function recordToolExecution(callId, toolName, result) {
    if (!callId) return;
    var store = getStorage();
    if (!store) return;
    try {
      var record = {
        toolName: toolName || "unknown",
        result: result,
        timestamp: Date.now()
      };
      store.setItem(TOOL_CHECKPOINT_PREFIX + callId, JSON.stringify(record));
    } catch (e) {}
  }

  function getCachedToolResult(callId) {
    if (!callId) return null;
    var store = getStorage();
    if (!store) return null;
    try {
      var raw = store.getItem(TOOL_CHECKPOINT_PREFIX + callId);
      if (raw) {
        var parsed = JSON.parse(raw);
        return parsed ? parsed.result : null;
      }
    } catch (e) {}
    return null;
  }

  function clearToolCheckpoint(callId) {
    if (!callId) return;
    var store = getStorage();
    if (!store) return;
    try {
      store.removeItem(TOOL_CHECKPOINT_PREFIX + callId);
    } catch (e) {}
  }

  /* ------------------------------------------------ Lifecycle Listeners */
  if (isBrowser) {
    window.addEventListener("online", function () {
      state.isOnline = true;
      if (state.isReconnecting) {
        showRestoredBanner();
        state.isReconnecting = false;
      }
    });

    window.addEventListener("offline", function () {
      state.isOnline = false;
      showReconnectingBanner(1, MAX_RECONNECT_ATTEMPTS);
    });
  }

  return {
    isNetworkError: isNetworkError,
    resilientFetch: resilientFetch,
    recordToolExecution: recordToolExecution,
    getCachedToolResult: getCachedToolResult,
    clearToolCheckpoint: clearToolCheckpoint,
    showReconnectingBanner: showReconnectingBanner,
    showRestoredBanner: showRestoredBanner,
    isOnline: function () { return state.isOnline; }
  };
});
