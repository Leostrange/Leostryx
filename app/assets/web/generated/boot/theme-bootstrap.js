// Fast theme bootstrap. Runs before the app bundle so the first paint already
// uses the host-selected color scheme. Fixed: honor "light" instead of always
// forcing the dark class.
(function () {
  'use strict';

  var theme = 'system';
  try {
    var params = new URLSearchParams(window.location.search);
    theme = params.get('hostTheme') || window.__AG_HOST_THEME__ || 'system';
  } catch (e) {
    theme = window.__AG_HOST_THEME__ || 'system';
  }
  if (theme === 'system') {
    var isDark;
    if (typeof window !== 'undefined' && window.Android && typeof window.Android.getTheme === 'function') {
      try {
        var t = window.Android.getTheme();
        if (t === 'dark' || t === 'light') isDark = (t === 'dark');
      } catch (e) {}
    }
    if (isDark === undefined && typeof window !== 'undefined' && window.__AG_RESOLVED_THEME__) {
      isDark = (window.__AG_RESOLVED_THEME__ === 'dark');
    }
    if (isDark === undefined) {
      isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    theme = isDark ? 'dark' : 'light';
  } else {
    theme = theme === 'light' ? 'light' : 'dark';
  }

  document.documentElement.style.colorScheme = theme;
  document.documentElement.classList.add(theme);

  try {
    var fId = localStorage.getItem("agyFontFamily");
    if (!fId) {
      var rawCfg = localStorage.getItem("agyBrandConfig");
      if (rawCfg) {
        var parsed = JSON.parse(rawCfg);
        if (parsed && parsed.font) fId = parsed.font;
      }
    }
    if (fId && fId !== "system") {
      var fontMap = {
        inter: "'Inter', system-ui, -apple-system, sans-serif",
        jetbrains_mono: "'JetBrains Mono', ui-monospace, monospace",
        fira_code: "'Fira Code', ui-monospace, monospace",
        roboto: "'Roboto', 'RobotoFlex', sans-serif",
        geist: "'Geist', sans-serif",
        montserrat: "'Montserrat', sans-serif",
        ubuntu: "'Ubuntu', sans-serif",
        pt_root_ui: "'PT Root UI', 'PT Sans', sans-serif"
      };
      var fam = fontMap[fId];
      if (fam) {
        var isMono = (fId === "jetbrains_mono" || fId === "fira_code");
        var st = document.createElement("style");
        st.id = "agy-font-override-css";
        var css = ":root, html, body, button, input, select, textarea, .font-sans { --default-font-family: " + fam + " !important; --font-sans: " + fam + " !important; --vscode-font-family: " + fam + " !important; font-family: " + fam + " !important; }\n";
        if (isMono) {
          css += "code, pre, .font-mono { --default-mono-font-family: " + fam + " !important; --font-mono: " + fam + " !important; --editor-font-family: " + fam + " !important; font-family: " + fam + " !important; }\n";
        }
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
      }
    }
  } catch (e) {}
})();

