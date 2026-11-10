(function () {
  'use strict';

  // Patch: Group provider models by provider name in the model selector
  // This modifies the Custom section to show provider separators

  if (window.__agyProviderModelGroupsPatch) return;
  window.__agyProviderModelGroupsPatch = true;

  // Store original __agyProviderSpecs to enhance it with provider info
  var originalProviderSpecs = window.__agyProviderSpecs;
  window.__agyProviderSpecs = function () {
    var specs = originalProviderSpecs ? originalProviderSpecs() : [];
    // Add provider info to each spec for grouping
    var cfg = null;
    try {
      var raw = window.AgyProviders && typeof window.AgyProviders.load === 'function'
        ? window.AgyProviders.load()
        : localStorage.getItem('agyProviders') || '';
      if (raw) cfg = JSON.parse(raw);
    } catch (e) {}

    if (cfg && cfg.useProviders && cfg.connections) {
      var providerMap = {};
      cfg.connections.forEach(function (c) {
        var type = c.type || 'openai';
        var providerName = c.name || (type === 'openai' ? 'OpenAI-compatible' : type === 'anthropic' ? 'Claude (Anthropic)' : 'Gemini-compatible');
        (c.selected || []).forEach(function (m) {
          providerMap[m] = providerName;
        });
      });

      specs = specs.map(function (s) {
        return Object.assign({}, s, { provider: providerMap[s.label] || 'Custom' });
      });
    }
    return specs;
  };

  // Patch the model selector to group by provider
  // We'll intercept the customModels passed to the selector
  var originalCcb = null;
  function patchCcb() {
    // Find the cCb component (it's minified, so we look for the pattern)
    // This is a runtime patch that modifies how customModels are processed
    if (typeof window.__agyPatchCustomModels === 'function') return;

    window.__agyPatchCustomModels = function (customModels) {
      // customModels is an object: { label: modelInfo }
      // We need to add provider grouping info
      var specs = window.__agyProviderSpecs ? window.__agyProviderSpecs() : [];
      var providerGroups = {};
      var ungrouped = {};

      specs.forEach(function (s) {
        var provider = s.provider || 'Custom';
        if (!providerGroups[provider]) providerGroups[provider] = {};
        providerGroups[provider][s.label] = customModels[s.label];
      });

      // Add any custom models not from providers
      Object.keys(customModels).forEach(function (key) {
        if (!providerGroups['Custom']) providerGroups['Custom'] = {};
        var found = false;
        Object.keys(providerGroups).forEach(function (p) {
          if (providerGroups[p][key]) found = true;
        });
        if (!found) providerGroups['Custom'][key] = customModels[key];
      });

      // Flatten with group markers
      var result = {};
      Object.keys(providerGroups).forEach(function (provider) {
        if (Object.keys(providerGroups[provider]).length > 0) {
          // Add separator
          result['__SEPARATOR__' + provider] = {
            label: provider,
            isSeparator: true,
            provider: provider
          };
          Object.assign(result, providerGroups[provider]);
        }
      });

      return result;
    };
  }

  // Run patch after a short delay to ensure specs are ready
  setTimeout(patchCcb, 100);

  // Also patch the selector render to handle separators
  // This patches the SXb component (Custom section) to render separators
  var originalSXb = null;
  function patchSXb() {
    // The minified SXb is at a specific location, we can't easily patch it
    // Instead, we'll use a MutationObserver to add separators to the DOM
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType === 1 && node.querySelector) {
            var customSection = node.querySelector('[data-testid="model-selector-panel"]');
            if (customSection) {
              addSeparatorsToCustomSection(customSection);
            }
          }
        });
      });
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function addSeparatorsToCustomSection(panel) {
    var customItems = panel.querySelectorAll('[data-testid="model-selector-item"]');
    var seenProviders = new Set();

    customItems.forEach(function (item) {
      var label = item.getAttribute('data-model-label');
      if (!label) return;

      var specs = window.__agyProviderSpecs ? window.__agyProviderSpecs() : [];
      var spec = specs.find(function (s) { return s.label === label; });
      if (spec && spec.provider && !seenProviders.has(spec.provider)) {
        seenProviders.add(spec.provider);
        // Insert separator before this item
        var separator = document.createElement('div');
        separator.className = 'agy-provider-separator';
        separator.style.cssText = 'padding: 8px 12px 4px; font-size: 11px; font-weight: 600; color: var(--muted-foreground, #888); text-transform: uppercase; letter-spacing: 0.5px; border-top: 1px solid var(--border, #333); margin-top: 8px;';
        separator.textContent = spec.provider;
        item.parentNode.insertBefore(separator, item);
      }
    });
  }

  // Install DOM patch when ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchSXb);
  } else {
    patchSXb();
  }

  // Expose for debugging
  window.__agyAddSeparators = addSeparatorsToCustomSection;
})();
