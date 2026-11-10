(function(){
/**
 * patches/web_optimizations/taps.js - kill the 300ms double-tap delay.
 */
'use strict';

function installTaps(doc) {
  try {
    var style = doc.createElement('style');
    style.setAttribute('data-agy', 'web-optimizations');
    style.textContent =
      'button,a,[role="button"],input,select,textarea{touch-action:manipulation;}';
    (doc.head || doc.documentElement).appendChild(style);
  } catch (e) {}
}

/**
 * patches/web_optimizations/viewport.js - keep --agy-vvh honest while the
 * soft keyboard opens.
 */
function installViewport(global, doc) {
  try {
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', function () {
        var vv = global.visualViewport;
        if (vv && vv.height && doc.documentElement) {
          doc.documentElement.style.setProperty(
            '--agy-vvh', Math.round(vv.height) + 'px');
        }
      }, { passive: true });
    }
  } catch (e) {}
}

/**
 * patches/web_optimizations/gpu.js - GPU-accelerate scroll/animation surfaces
 * and isolate layout for lists.
 */
function installGpu(doc) {
  try {
    if (!doc.querySelector('style[data-agy="gpu-acceleration"]')) {
      var gpu = doc.createElement('style');
      gpu.setAttribute('data-agy', 'gpu-acceleration');
      // Promote ONLY the real scroll containers. Never inline <code>/<pre>:
      // per-element layers explode on Mali and saturate RenderThread.
      gpu.textContent =
        '[data-testid="chat-container"], .scrollable {' +
        ' -webkit-overflow-scrolling: touch; }' +
        '.artifact-viewer {' +
        ' contain: layout style; }' +
        '*{ -webkit-tap-highlight-color: transparent; }';
      (doc.head || doc.documentElement).appendChild(gpu);
    }
  } catch (e) {}
}

/**
 * patches/web_optimizations/public-api.js - install and expose.
 */
var global = window;

if (global.__AG_WEB_OPTIMIZATIONS__) return;
global.__AG_WEB_OPTIMIZATIONS__ = true;

var doc = global.document;
if (!doc) return;

installTaps(doc);
installViewport(global, doc);
installGpu(doc);

global.__agWebOptimizations = { installed: true };

/**
 * AgyShade bridge for Android shade notifications + action buttons.
 */
try {
  var _shadeClickCbs = [];
  global.nativeNotifications = {
    send: function(opts) {
      try {
        if (!opts) return Promise.resolve();
        var cascadeId = (opts.payload && opts.payload.cascadeId) || opts.id || "";
        var title = opts.title || "Leostryx";
        var body = opts.body || "";
        var needsAction = (opts.payload && (opts.payload.type === "request_action" || opts.payload.needsAction)) || true;
        if (window.AgyShade && typeof window.AgyShade.notify === "function") {
          window.AgyShade.notify(cascadeId, title, body, !!needsAction);
        }
      } catch(e) {
        console.warn("[AgyShade] send failed", e);
      }
      return Promise.resolve();
    },
    onClicked: function(cb) {
      if (typeof cb === "function") _shadeClickCbs.push(cb);
    },
    openSystemPreferences: function() {
      try {
        if (window.AgyShade && typeof window.AgyShade.openSystemPreferences === "function") {
          window.AgyShade.openSystemPreferences();
        }
      } catch(e) {}
      return Promise.resolve();
    },
    clearNotifications: function() {
      try {
        if (window.AgyShade && typeof window.AgyShade.cancelAll === "function") {
          window.AgyShade.cancelAll();
        }
      } catch(e) {}
      return Promise.resolve();
    }
  };
  global.__agyTriggerNotificationClick = function(cascadeId) {
    for (var i = 0; i < _shadeClickCbs.length; i++) {
      try { _shadeClickCbs[i]({ cascadeId: cascadeId }); } catch(e) {}
    }
  };
} catch(e) {}

})();
