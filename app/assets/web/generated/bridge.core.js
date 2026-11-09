(function(){
/**
 * core/namespace.js - bridge.core bundle scope.
 *
 * Runs first in the bridge.core.js IIFE. Declares the shared scope every other
 * core fragment attaches to: `global`, `CONFIG`, `VERSION`, `warn`, plus the
 * idempotency guard. Window globals stay compatible with the original
 * (`window.__agBridgeCore` is the public API, `window.__AG_BRIDGE_CORE__` the
 * guard).
 */
'use strict';

var AG = (window.__agCore = window.__agCore || {});

if (window.__AG_BRIDGE_CORE__) return;
window.__AG_BRIDGE_CORE__ = true;

var global = window;
var VERSION = '1.0.0';

// Live config: filled by config.js, then kept in sync by csrf.js/endpoints.js.
var CONFIG = window.__APP_CONFIG__ || {};

function warn(where, err) {
  try {
    console.warn('[AGY bridge.core] ' + where + ':', err && err.message ? err.message : err);
  } catch (e) {}
}

/**
 * core/polyfills-process.js - window.process polyfill.
 *
 * main.js assumes an Electron-ish `process`. Provide a POSIX-shaped stub
 * without clobbering a real one.
 */
try {
  if (!window.process || typeof window.process !== 'object') window.process = {};
  var p = window.process;
  if (!p.platform) p.platform = 'linux';
  if (!p.arch) p.arch = 'arm64';
  if (!p.type) p.type = 'renderer';
  p.browser = p.browser !== undefined ? p.browser : true;
  if (!p.env || typeof p.env !== 'object') p.env = {};
  if (!p.versions || typeof p.versions !== 'object') p.versions = {};
  if (typeof p.cwd !== 'function') p.cwd = function () { return CONFIG.workspaceRoot || '/'; };
  if (typeof p.nextTick !== 'function') {
    p.nextTick = function (cb) {
      var args = Array.prototype.slice.call(arguments, 1);
      if (typeof queueMicrotask === 'function') queueMicrotask(function () { cb.apply(null, args); });
      else Promise.resolve().then(function () { cb.apply(null, args); });
    };
  }
} catch (e) { warn('process polyfill', e); }

/**
 * core/config.js - window.__APP_CONFIG__ fill.
 *
 * Fill only missing keys, then publish the merged object back and rebind
 * CONFIG so later fragments see the resolved values.
 */
var appConfig = {
  productName: 'Antigravity',
  appName: 'AGY',
  appVersion: VERSION,
  version: VERSION,
  isStandalone: true,
  platform: 'android',
  arch: 'arm64',
  enginePort: null,
  engineReady: false,
  apiPrefix: '',
  csrfToken: '',
  workspaceRoot: (CONFIG.workspaceRoot || (window.process && window.process.env && window.process.env.HOME) || '/storage/emulated/0'),
  activeCascadeId: null,
  devMode: false
};

try {
  var injected = window.__APP_CONFIG__ || {};
  for (var k in injected) {
    if (Object.prototype.hasOwnProperty.call(injected, k)) appConfig[k] = injected[k];
  }
  window.__APP_CONFIG__ = appConfig;
  CONFIG = appConfig;
} catch (e) { warn('__APP_CONFIG__', e); }

/**
 * core/csrf.js - CSRF token resolution and cookie sync.
 *
 * Sources (first hit wins): explicit global, meta tag, generated fallback.
 * Publishes `csrfToken`/`csrf_token` cookies that main.js and native read.
 */
function readCsrf() {
  try {
    if (window.__AG_CSRF__) return String(window.__AG_CSRF__);
    var m = document.querySelector('meta[name="csrf-token"], meta[name="csrfToken"]');
    if (m && m.getAttribute('content')) return m.getAttribute('content');
  } catch (e) {}
  return CONFIG.csrfToken || 'agy-standalone-token';
}

function syncCsrf() {
  var token = readCsrf();
  CONFIG.csrfToken = token;
  CONFIG.csrf_token = token;
  try {
    if (document && document.cookie !== undefined) {
      document.cookie = 'csrfToken=' + token + '; path=/; SameSite=Lax';
      document.cookie = 'csrf_token=' + token + '; path=/; SameSite=Lax';
    }
  } catch (e) {}
  return token;
}

syncCsrf();

/**
 * core/endpoints.js - endpoint discovery + core origin resolution.
 *
 * Endpoints come from window.__AG_ENDPOINTS__ or the ?endpoints= query param.
 * `baseOrigin()` prefers a full injected URL, then a bare port mapped to
 * https. Also owns the CSRF header/query helpers shared with fetch-rewrite.
 */
function parseEndpointSpec(raw) {
  var out = {};
  if (!raw) return out;
  if (typeof raw === 'object') {
    for (var k in raw) { if (Object.prototype.hasOwnProperty.call(raw, k)) out[k] = String(raw[k]); }
    return out;
  }
  var s = String(raw).trim();
  if (!s) return out;
  // base64(JSON) or raw JSON
  if (s.charAt(0) === '{') {
    try { return parseEndpointSpec(JSON.parse(s)); } catch (e) {}
  }
  if (/^[A-Za-z0-9+/=]+$/.test(s) && s.length % 4 === 0) {
    try {
      var decoded = global.atob ? global.atob(s) : '';
      if (decoded && decoded.charAt(0) === '{') return parseEndpointSpec(JSON.parse(decoded));
    } catch (e) {}
  }
  // k=v,k2=v2  or k=v&k2=v2
  s.split(/[&,]/).forEach(function (pair) {
    var i = pair.indexOf('=');
    if (i > 0) {
      var k = decodeURIComponent(pair.slice(0, i).trim());
      var v = decodeURIComponent(pair.slice(i + 1).trim());
      if (k) out[k] = v;
    }
  });
  return out;
}

var ENDPOINTS = {};
try {
  ENDPOINTS = parseEndpointSpec(global.__AG_ENDPOINTS__);
  if (global.location && global.location.search) {
    var qp = new URLSearchParams(global.location.search);
    var q = qp.get('endpoints') || qp.get('ag_endpoints');
    if (q) {
      var fromQuery = parseEndpointSpec(q);
      for (var qk in fromQuery) { if (Object.prototype.hasOwnProperty.call(fromQuery, qk)) ENDPOINTS[qk] = fromQuery[qk]; }
    }
    var port = qp.get('port') || qp.get('enginePort');
    if (port) { ENDPOINTS.core_http = 'http://127.0.0.1:' + port; ENDPOINTS.enginePort = port; }
  }
} catch (e) { warn('endpoint parse', e); }
global.__AG_ENDPOINTS__ = ENDPOINTS;

function endpoint(name) {
  if (!name) return null;
  if (ENDPOINTS[name]) return ENDPOINTS[name];
  if (name === 'core' || name === 'core_http' || name === 'engine') return baseOrigin();
  return null;
}

function setEndpoint(name, value) {
  if (!name || value === undefined || value === null) return;
  ENDPOINTS[name] = String(value);
  global.__AG_ENDPOINTS__ = ENDPOINTS;
  return ENDPOINTS[name];
}

// The base origin of the core server. Prefer full injected URLs (the core
// serves ConnectRPC over TLS) over a bare port, which must map to https.
function baseOrigin() {
  if (CONFIG.engineBaseUrl) return String(CONFIG.engineBaseUrl).replace(/\/$/, '');
  if (ENDPOINTS.core) return String(ENDPOINTS.core).replace(/\/$/, '');
  if (ENDPOINTS.core_https) return String(ENDPOINTS.core_https).replace(/\/$/, '');
  if (CONFIG.apiPrefix) return String(CONFIG.apiPrefix).replace(/\/$/, '');
  if (ENDPOINTS.core_http) return String(ENDPOINTS.core_http).replace(/\/$/, '');
  if (CONFIG.enginePort) return 'https://127.0.0.1:' + CONFIG.enginePort;
  if (ENDPOINTS.enginePort) return 'https://127.0.0.1:' + ENDPOINTS.enginePort;
  return '';
}

function coreBase() {
  var p = (CONFIG.enginePort || ENDPOINTS.enginePort || (global.__APP_CONFIG__ && global.__APP_CONFIG__.enginePort) || (global.__AG_ENDPOINTS__ && global.__AG_ENDPOINTS__.enginePort) || 48155);
  return (baseOrigin() || ('https://127.0.0.1:' + p)).replace(/\/$/, '');
}

function ensureCsrf(headers) {
  try {
    if (headers && typeof headers.set === 'function'
        && typeof headers.has === 'function'
        && !headers.has('x-codeium-csrf-token')) {
      headers.set('x-codeium-csrf-token', syncCsrf());
    }
  } catch (e) {}
  return headers;
}

function appendCsrfQuery(url) {
  try {
    if (url.indexOf('csrf_token=') === -1) {
      url += (url.indexOf('?') === -1 ? '?' : '&')
          + 'csrf_token=' + encodeURIComponent(syncCsrf());
    }
  } catch (e) {}
  return url;
}

/**
 * core/fetch-rewrite.js - file:// WebView -> core origin fetch rewrite.
 *
 * The WebView loads from file:///android_asset/web/, so main.js builds its
 * transport from window.location.origin ("file://") and the Connect/grpc-web
 * transport then fetches e.g.
 *   file://exa.language_server_pb.languageserverservice/Method
 * which the WebView rejects: URL scheme "file" is not supported.
 *
 * Rewrite file:// or relative ConnectRPC URLs onto the core origin, preserving
 * method/headers/body and attaching the CSRF token. Idempotent and a no-op for
 * non-RPC / already-absolute http(s) URLs.
 *
 * The original periodic HEAD ping is not ported (it referenced an undefined
 * helper; see docs/DEADCODE.md).
 */
var RPC_MARKERS = ['exa.language_server_pb.', 'exa.host_bridge_pb.', '/exa.'];

// RPC path (no leading slash) when `url` is a file:// or relative ConnectRPC
// URL; null for anything else (http(s), blob, data, static assets).
function rpcPathFrom(url) {
  if (!url) return null;
  var s = String(url);
  if (/^(https?|blob|data|wss?|chrome-extension):/i.test(s)) return null;
  var best = -1;
  for (var i = 0; i < RPC_MARKERS.length; i++) {
    var at = s.indexOf(RPC_MARKERS[i]);
    if (at >= 0 && (best === -1 || at < best)) best = at;
  }
  if (best === -1) return null;
  return s.slice(best).replace(/^\/+/, '') || null;
}

function installFetchRewrite() {
  if (global.__AG_FETCH_REWRITE__ || typeof global.fetch !== 'function') return;
  var origFetch = global.fetch.bind(global);

  function fetchWithStartupRetry(u, opts, retries) {
    return origFetch(u, opts).catch(function (err) {
      if (retries > 0) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(fetchWithStartupRetry(u, opts, retries - 1));
          }, 120);
        });
      }
      throw err;
    });
  }

  global.fetch = function (resource, init) {
    try {
      // Request object: rebuild against the core origin, keep method/body.
      if (resource && typeof resource === 'object' && typeof resource.url === 'string') {
        var rpath = rpcPathFrom(resource.url);
        if (rpath) {
          try {
            var targetUrl = appendCsrfQuery(coreBase() + '/' + rpath);
            var reqMethod = resource.method || (init && init.method) || 'POST';
            var reqHeaders = new Headers(resource.headers || (init && init.headers) || {});
            ensureCsrf(reqHeaders);

            var bodyPromise;
            if (init && init.body !== undefined) {
              bodyPromise = Promise.resolve(init.body);
            } else {
              try {
                bodyPromise = resource.clone().arrayBuffer().then(function (buf) {
                  return buf.byteLength > 0 ? buf : undefined;
                }).catch(function () { return undefined; });
              } catch (e) {
                bodyPromise = Promise.resolve(undefined);
              }
            }

            return bodyPromise.then(function (bodyData) {
              var nextOpts = {
                method: reqMethod,
                headers: reqHeaders,
                body: bodyData,
                credentials: 'omit'
              };
              return fetchWithStartupRetry(targetUrl, nextOpts, 30);
            });
          } catch (e) { warn('fetch rewrite (Request)', e); }
        }
        return origFetch(resource, init);
      }

      // String URL: the Connect/grpc-web transport's common path.
      if (typeof resource === 'string') {
        var path = rpcPathFrom(resource);
        if (path) {
          var url = appendCsrfQuery(coreBase() + '/' + path);
          var headers = new Headers((init && init.headers) || {});
          ensureCsrf(headers);
          var next = {};
          if (init) {
            for (var k in init) {
              if (Object.prototype.hasOwnProperty.call(init, k)) next[k] = init[k];
            }
          }
          next.headers = headers;

          return fetchWithStartupRetry(url, next, 30);
        }
      }
    } catch (e) { warn('fetch rewrite', e); }
    return origFetch(resource, init);
  };
  global.__AG_FETCH_REWRITE__ = true;
}

installFetchRewrite();

/**
 * core/public-api.js - expose window.__agBridgeCore.
 *
 * Dead entries listed in docs/DEADCODE.md are not ported.
 */
var api = {
  version: VERSION,
  config: CONFIG,
  endpoints: ENDPOINTS,
  endpoint: endpoint,
  setEndpoint: setEndpoint,
  baseOrigin: baseOrigin,
  syncCsrf: syncCsrf,
  parseEndpointSpec: parseEndpointSpec
};

window.__agBridgeCore = api;

try { console.log('[AGY bridge.core] ready (endpoints: ' + Object.keys(ENDPOINTS).length + ')'); } catch (e) {}


})();

/* AGY-P1-5-APPENDER: Android blob download bridge (loads before main.js).
 * Installs window.downloadBlobOverride (consumed by dialogService.saveFileWithDialog)
 * and window.__agDownloadBridge helper (used by agy_export_session.js / selftest). */
(function () {
  'use strict';
  if (window.__agDownloadBridge && window.__agDownloadBridge.__installed) return;
  function android() {
    if (window.AndroidBridge && typeof window.AndroidBridge.saveBlob === 'function') return window.AndroidBridge;
    if (window.Android && typeof window.Android.saveBlob === 'function') return window.Android;
    return null;
  }
  function token() { return window.__AG_NATIVE_BRIDGE_TOKEN__ || null; }
  function ready() {
    if (android() && token()) return true;
    try { return !!(android() && window.localStorage && window.localStorage.getItem('agy_bridge_token')); } catch (e) { return false; }
  }
  function tokenAny() {
    if (window.__AG_NATIVE_BRIDGE_TOKEN__) return window.__AG_NATIVE_BRIDGE_TOKEN__;
    try { return window.localStorage ? window.localStorage.getItem('agy_bridge_token') : null; } catch (e) { return null; }
  }
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      try {
        var fr = new FileReader();
        fr.onload = function () {
          var s = String(fr.result || '');
          var i = s.indexOf(',');
          resolve(i >= 0 ? s.slice(i + 1) : s);
        };
        fr.onerror = function () { reject(new Error('FileReader failed')); };
        fr.readAsDataURL(blob);
      } catch (e) { reject(e); }
    });
  }
  function legacyAnchorSave(blob, filename) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = String(filename || 'download');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) { console.warn('[AGY DownloadBridge] legacy save failed:', e); }
  }
  function nativeSave(blob, filename) {
    return blobToBase64(blob).then(function (b64) {
      var a = android();
      if (!a || typeof a.saveBlob !== 'function') throw new Error('saveBlob unavailable');
      a.saveBlob(tokenAny(), b64, String(filename || 'download'),
        blob && blob.type ? String(blob.type) : 'application/octet-stream');
      return String(filename || 'download');
    });
  }
  window.__agDownloadBridge = {
    __installed: true,
    ready: ready,
    save: function (blob, filename) {
      if (!ready()) return Promise.reject(new Error('native bridge not ready'));
      return nativeSave(blob, filename);
    },
    override: function (blob, defaultPath) {
      if (!ready()) return Promise.resolve(null);
      return nativeSave(blob, defaultPath).catch(function (e) {
        console.warn('[AGY DownloadBridge] native save failed, legacy fallback:', e);
        legacyAnchorSave(blob, defaultPath);
        return String(defaultPath || 'download');
      });
    }
  };
  if (ready() && !window.downloadBlobOverride) {
    try {
      window.downloadBlobOverride = function (blob, defaultPath) {
        return window.__agDownloadBridge.override(blob, defaultPath);
      };
    } catch (e) { console.warn('[AGY DownloadBridge] override install failed:', e); }
  }
  try { console.log('[AGY DownloadBridge] installed, native ready =', ready()); } catch (e) {}
})();

/* AGY-P2-16-APPENDER: narrowed to generation URLs (P2-22). stream stall watchdog (see fixes/p2_16_stream_watchdog.sh).
 * Wraps window.fetch; streaming responses get an idle watchdog that errors the
 * stream after 'first' ms without any data (before first chunk) or 'idle' ms
 * between chunks. Prevents the UI from waiting forever on a dead stream. */
(function () {
  'use strict';
  if (window.__agStreamWatchdog) return;
  var cfg = { first: 180000, idle: 120000, on: true };
  try {
    var raw = window.localStorage && window.localStorage.getItem('agyStreamWatchdog');
    if (raw) {
      var c = JSON.parse(raw) || {};
      if (c.first) cfg.first = +c.first;
      if (c.idle) cfg.idle = +c.idle;
      if (c.on === false) cfg.on = false;
    }
  } catch (e) {}
  function watchdogStream(body) {
    var reader = body.getReader();
    var seen = false;
    return new ReadableStream({
      pull: function (ctrl) {
        return new Promise(function (resolve) {
          var gap = seen ? cfg.idle : cfg.first;
          var timer = setTimeout(function () {
            try { ctrl.error(new Error('AGY-P2-16: поток завис (нет данных ' + Math.round(gap / 1000) + 'с) — соединение разорвано')); } catch (e) {}
            try { reader.cancel(); } catch (e) {}
            resolve();
          }, gap);
          reader.read().then(function (r) {
            clearTimeout(timer);
            if (r.done) { try { ctrl.close(); } catch (e) {} resolve(); return; }
            seen = true;
            try { ctrl.enqueue(r.value); } catch (e) {}
            resolve();
          }, function (err) {
            clearTimeout(timer);
            try { ctrl.error(err); } catch (e) {}
            resolve();
          });
        });
      },
      cancel: function (reason) { try { return reader.cancel(reason); } catch (e) {} }
    });
  }
  function isStreamish(resp) {
    try {
      var ct = '', cl = '';
      try { ct = String(resp.headers.get('content-type') || '').toLowerCase(); } catch (e) {}
      try { cl = resp.headers.get('content-length'); } catch (e) {}
      return !cl || /grpc|event-stream|ndjson|octet-stream|chunked/.test(ct);
    } catch (e) { return false; }
  }
  var orig = window.fetch;
  if (typeof orig !== 'function') return;
  function urlOf(input) {
    try {
      if (typeof input === 'string') return input;
      if (input && input.url) return String(input.url);
    } catch (e) {}
    return '';
  }
  function isGeneration(input) {
    return /generat|cascade|completion|inference|chat/i.test(urlOf(input));
  }
  function wrapped(input, init) {
    var p = orig.call(this, input, init);
    return p.then(function (resp) {
      if (!cfg.on || !isGeneration(input)) return resp;
      if (!resp || !resp.body || typeof resp.body.getReader !== 'function') return resp;
      if (!isStreamish(resp)) return resp;
      try {
        return new Response(watchdogStream(resp.body), {
          status: resp.status, statusText: resp.statusText, headers: resp.headers
        });
      } catch (e) {
        try { console.warn('[AGY P2-16] wrap failed:', e); } catch (_) {}
        return resp;
      }
    });
  }
  window.fetch = wrapped;
  window.__agStreamWatchdog = {
    __installed: true,
    config: cfg,
    rewrap: function () { window.fetch = wrapped; }
  };
  try { console.log('[AGY P2-16] stream watchdog installed (first=' + cfg.first + ' idle=' + cfg.idle + ')'); } catch (e) {}
})();
