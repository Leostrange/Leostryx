/* AGY-P1-5: Android blob bridge. Must load BEFORE main.js.
 * Installs window.downloadBlobOverride (consumed by dialogService.saveFileWithDialog)
 * and window.__agDownloadBridge helper used by agy_export_session.js. */
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
    var a = android();
    return !!(a && token());
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
      a.saveBlob(token(), b64, String(filename || 'download'),
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
    /* drop-in for dialogService.saveFileWithDialog downloadBlobOverride hook:
       must resolve with a filename on success; falls back to anchor flow on failure */
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
  console.log('[AGY DownloadBridge] installed, native ready =', ready());
})();
