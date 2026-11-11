(function () {
  'use strict';

  // Patch: Group provider models by provider name in the model selector
  // This modifies the Custom section to show provider separators.
  //
  // v3.1.0: Robust provider detection & insertion. Targets both
  // [data-testid="model-selector-item"] and .group.relative wrappers,
  // resolves provider directly from __agyGetProviderName / specs / storage,
  // and inserts styled separator headers before each provider's model group.

  if (window.__agyProviderModelGroupsPatch) return;
  window.__agyProviderModelGroupsPatch = true;

  function getProviderName(label) {
    if (!label) return null;
    try {
      if (typeof window.__agyGetProviderName === 'function') {
        var p = window.__agyGetProviderName(label);
        if (p && p !== 'Custom') return p;
      }
    } catch (_) {}

    try {
      var specs = typeof window.__agyProviderSpecs === 'function' ? window.__agyProviderSpecs() : [];
      for (var i = 0; i < specs.length; i++) {
        if (specs[i].label === label && (specs[i].provider || specs[i].providerName)) {
          return specs[i].provider || specs[i].providerName;
        }
      }
    } catch (_) {}

    try {
      var raw = window.AgyProviders && typeof window.AgyProviders.load === 'function'
        ? window.AgyProviders.load()
        : localStorage.getItem('agyProviders') || '';
      if (raw) {
        var cfg = JSON.parse(raw);
        if (cfg && cfg.connections) {
          for (var ci = 0; ci < cfg.connections.length; ci++) {
            var conn = cfg.connections[ci];
            if (conn.selected && conn.selected.indexOf(label) >= 0) {
              var t = conn.type || 'openai';
              return conn.name || (t === 'openai' ? 'OpenAI-compatible' : t === 'anthropic' ? 'Claude (Anthropic)' : 'Gemini-compatible');
            }
          }
        }
      }
    } catch (_) {}
    return null;
  }

  function applySeparators(panel) {
    if (!panel) return;
    var items = Array.prototype.slice.call(panel.querySelectorAll('[data-testid="model-selector-item"], .group.relative'));
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var label = item.getAttribute('data-model-label');
      if (!label) {
        var tr = item.querySelector('.truncate');
        if (tr) label = (tr.textContent || '').trim();
      }
      if (!label) continue;
      var provider = getProviderName(label);
      if (!provider || seen[provider]) continue;
      seen[provider] = true;

      var targetRow = item.classList && item.classList.contains('relative') ? item : (item.closest('.group.relative') || item);
      if (!targetRow || !targetRow.parentNode) continue;

      var sep = document.createElement('div');
      sep.setAttribute('data-agy-provider-sep', '1');
      sep.className = 'agy-provider-separator';
      sep.style.cssText = 'padding: 8px 12px 4px; font-size: 10.5px; font-weight: 700; color: var(--muted-foreground, #8e8e93); text-transform: uppercase; letter-spacing: 0.06em; border-top: 1px solid rgba(255, 255, 255, 0.08); margin-top: 6px; margin-bottom: 2px; user-select: none; pointer-events: none;';
      sep.textContent = provider;
      targetRow.parentNode.insertBefore(sep, targetRow);
    }
  }

  function panelSignature(panel) {
    var items = panel.querySelectorAll('[data-testid="model-selector-item"], .group.relative');
    var parts = [];
    for (var i = 0; i < items.length; i++) {
      var l = items[i].getAttribute('data-model-label');
      if (!l) {
        var tr = items[i].querySelector('.truncate');
        if (tr) l = (tr.textContent || '').trim();
      }
      if (l) parts.push(l);
    }
    return parts.join('|');
  }

  var lastSig = null;
  function tick() {
    var panel = document.querySelector('[data-testid="model-selector-panel"]');
    if (!panel) { lastSig = null; return; }
    var sig = panelSignature(panel);
    if (sig === lastSig && panel.querySelector('[data-agy-provider-sep="1"]')) return;
    lastSig = sig;

    var olds = panel.querySelectorAll('[data-agy-provider-sep="1"]');
    for (var i = 0; i < olds.length; i++) olds[i].remove();
    try { applySeparators(panel); } catch (e) {}
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; tick(); });
  }

  try {
    var observer = new MutationObserver(function () { schedule(); });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  } catch (e) {}

  setInterval(tick, 600);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }

  window.__agyAddSeparators = applySeparators;
})();
