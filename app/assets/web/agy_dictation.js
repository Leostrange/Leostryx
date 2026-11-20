/* Antigravity RU — Dictation Engine & Settings Module
 *
 * Implements:
 * 1. 7-state Dictation FSM (idle -> preparing -> recording -> processing -> ready / cancelled / error)
 * 2. Session ID & Chat ID isolation with late callback filtering
 * 3. Distinct Stop (commit) vs Cancel (purge) semantics
 * 4. Continuous dictation re-priming loop on silence tag "X" with 60ms debounce
 * 5. Lifecycle listeners (visibilitychange, pagehide, beforeunload, chat switch, destroy)
 * 6. Preserved Settings UI tab (__agyDictationMount, __agyDictationCfg)
 */

(function (root, factory) {
  var exp = factory();
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = exp;
  }
  if (typeof root !== "undefined") {
    root.AgyDictation = exp.AgyDictation;
    root.DictationFSM = exp.DictationFSM;
    root.__agyDictationCfg = exp.__agyDictationCfg;
    root.__agyDictationMount = exp.__agyDictationMount;
  }
  if (typeof window !== "undefined") {
    window.AgyDictation = exp.AgyDictation;
    window.DictationFSM = exp.DictationFSM;
    window.__agyDictationCfg = exp.__agyDictationCfg;
    window.__agyDictationMount = exp.__agyDictationMount;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KEY = "agy_dictation";

  // ---- Settings & LocalStorage Logic (Preserved) ----
  function T(ru, en) {
    var l;
    try { l = (document.documentElement.getAttribute("data-agy-language") || "ru").toLowerCase(); } catch (e) { l = "ru"; }
    return l.indexOf("en") === 0 ? en : ru;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  function defaults() {
    return { enabled: true, engine: "auto", lang: "auto" };
  }

  function loadCfg() {
    try {
      var o = typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem(KEY) || "{}") : {};
      var d = defaults();
      if (typeof window !== "undefined" && o.engine == null && window.AgyProviders && window.AgyProviders.load) {
        try {
          var old = JSON.parse(window.AgyProviders.load() || "{}");
          if (old.sttEngine === "system" || old.sttEngine === "vosk") d.engine = old.sttEngine;
        } catch (ignore) {}
      }
      for (var k in d) if (o[k] == null) o[k] = d[k];
      return o;
    } catch (e) {
      return defaults();
    }
  }

  function saveCfg(cfg) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(KEY, JSON.stringify(cfg));
      }
    } catch (e) {}
  }

  function voskPresent() {
    return typeof window !== "undefined" && !!(window.AgyVosk && window.AgyVosk.available);
  }

  function voskReady() {
    try { return voskPresent() && window.AgyVosk.available(); } catch (e) { return false; }
  }

  // ---- 7-State Dictation FSM Class ----
  class DictationFSM {
    static STATES = ['idle', 'preparing', 'recording', 'processing', 'ready', 'cancelled', 'error'];
    static VALID_TRANSITIONS = {
      idle: ['preparing', 'error'],
      preparing: ['recording', 'cancelled', 'error'],
      recording: ['processing', 'cancelled', 'error'],
      processing: ['ready', 'cancelled', 'error'],
      ready: ['idle'],
      cancelled: ['idle'],
      error: ['idle']
    };

    constructor(options = {}) {
      this.options = options;
      this.sessionId = null;
      this.chatId = null;
      this.state = 'idle';
      this.startTime = 0;
      this.buffer = '';
      this.partialText = '';
      this.continuous = options.continuous !== false;
      this.engine = options.engine || 'system';
      this.lang = options.lang || null;
      this.history = [];
      this.onStateChange = options.onStateChange || null;
      this.onPartial = options.onPartial || null;
      this.onFinal = options.onFinal || null;
      this.onError = options.onError || null;
      this.pollTimer = null;
      this.watchdogTimer = null;
      this.reprimeTimer = null;
      this.curEng = null;
      this.sawEvent = false;
      this.destroyed = false;
      this._subscribers = [];
    }

    isRecording() {
      return this.state === 'recording' || this.state === 'preparing' || this.state === 'processing';
    }

    getStatus() {
      return this.getSession();
    }

    subscribe(listener) {
      if (typeof listener !== 'function') return function () {};
      if (!this._subscribers) this._subscribers = [];
      this._subscribers.push(listener);
      var self = this;
      return function () {
        if (!self._subscribers) return;
        var idx = self._subscribers.indexOf(listener);
        if (idx !== -1) self._subscribers.splice(idx, 1);
      };
    }

    transitionTo(nextState, detail = {}) {
      const allowed = DictationFSM.VALID_TRANSITIONS[this.state];
      if (!allowed || !allowed.includes(nextState)) {
        throw new Error(`Invalid state transition from ${this.state} to ${nextState}`);
      }

      const prevState = this.state;
      this.state = nextState;
      this.history.push({ from: prevState, to: nextState, timestamp: Date.now(), ...detail });

      if (this.onStateChange) {
        try { this.onStateChange(this.state, prevState, this.getSession()); } catch (e) {}
      }
      if (this._subscribers && this._subscribers.length) {
        var sess = this.getSession();
        var subs = this._subscribers.slice();
        for (var i = 0; i < subs.length; i++) {
          try { subs[i](this.state, prevState, sess); } catch (e) {}
        }
      }
    }

    startDictation({ chatId, continuous = true, onPartial, onFinal, onError, onStateChange, engine, lang } = {}) {
      if (this.destroyed) throw new Error('Dictation manager is destroyed');
      if (this.state !== 'idle') {
        this.cancelDictation(this.sessionId);
      }

      this.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      this.chatId = chatId || 'default_chat';
      this.continuous = continuous;
      this.buffer = '';
      this.partialText = '';
      this.startTime = Date.now();
      this.sawEvent = false;

      if (onPartial) this.onPartial = onPartial;
      if (onFinal) this.onFinal = onFinal;
      if (onError) this.onError = onError;
      if (onStateChange) this.onStateChange = onStateChange;

      this.transitionTo('preparing');

      this.engine = engine || this._pickEngine();
      this.lang = lang || this._getLang();

      const started = this._startHardware();
      if (!started) {
        const err = new Error('Failed to initialize speech recognition hardware');
        this.transitionTo('error', { error: err.message });
        if (this.onError) { try { this.onError(err, this.sessionId); } catch (e) {} }
        this.transitionTo('idle');
        return this.sessionId;
      }

      this.transitionTo('recording');
      this._startPolling();
      this._startWatchdog();

      return this.sessionId;
    }

    stopDictation(sessionId) {
      if (this.destroyed) return Promise.reject(new Error('Destroyed'));
      if (this.sessionId && sessionId && this.sessionId !== sessionId) {
        return Promise.reject(new Error(`Session mismatch: active is ${this.sessionId}`));
      }
      if (this.state === 'idle') {
        return Promise.resolve('');
      }
      if (this.state === 'cancelled') {
        return Promise.reject(new Error('Session was cancelled'));
      }
      if (this.state === 'processing' || this.state === 'ready') {
        return Promise.resolve(this.buffer || '');
      }

      this._clearWatchdog();
      this._stopPolling();
      if (this.reprimeTimer) { clearTimeout(this.reprimeTimer); this.reprimeTimer = null; }
      this._stopHardware();

      if (this.state === 'preparing') {
        this.transitionTo('recording');
      }
      this.transitionTo('processing');

      // Commit buffered and partial text
      const finalText = (this.buffer + ' ' + this.partialText).trim();
      this.buffer = finalText;
      this.partialText = '';

      this.transitionTo('ready');
      if (this.onFinal) {
        try { this.onFinal(finalText, this.sessionId); } catch (e) {}
      }

      const committed = this.buffer;
      this.transitionTo('idle');
      return Promise.resolve(committed);
    }

    cancelDictation(sessionId) {
      if (this.destroyed) return;
      if (this.sessionId && sessionId && this.sessionId !== sessionId) {
        return; // Ignore stale cancellation
      }
      if (this.state === 'idle') return;

      this._clearWatchdog();
      this._stopPolling();
      if (this.reprimeTimer) { clearTimeout(this.reprimeTimer); this.reprimeTimer = null; }
      this._cancelHardware();

      this.buffer = '';
      this.partialText = '';

      if (this.state === 'preparing' || this.state === 'recording' || this.state === 'processing') {
        this.transitionTo('cancelled');
      }

      this.transitionTo('idle');
    }

    dispatchBridgeEvent(targetSessionId, targetChatId, eventTag, text = '') {
      if (this.destroyed) return;

      // Session ID & Chat ID Isolation Guards
      if (!targetSessionId || targetSessionId !== this.sessionId) {
        return; // Dropped: mismatch or stale session
      }
      if (!targetChatId || targetChatId !== this.chatId) {
        return; // Dropped: cross-chat isolation
      }

      this.sawEvent = true;

      if (eventTag === 'E') {
        if (this.state === 'preparing' || this.state === 'recording' || this.state === 'processing') {
          this._clearWatchdog();
          this._stopPolling();
          if (this.reprimeTimer) { clearTimeout(this.reprimeTimer); this.reprimeTimer = null; }
          this._stopHardware();
          this.transitionTo('error', { error: text });
          if (this.onError) { try { this.onError(new Error(text), this.sessionId); } catch (e) {} }
          this.transitionTo('idle');
        }
        return;
      }

      if (this.state !== 'recording' && this.state !== 'processing') {
        return; // Guard against events in invalid states
      }

      if (eventTag === 'P') {
        this.partialText = text || '';
        if (this.onPartial) {
          try { this.onPartial(this.partialText, this.sessionId); } catch (e) {}
        }
      } else if (eventTag === 'F') {
        if (text && text.trim()) {
          this.buffer = (this.buffer ? this.buffer + ' ' : '') + text.trim();
        }
        this.partialText = '';
        if (this.onPartial) {
          try { this.onPartial('', this.sessionId); } catch (e) {}
        }
      } else if (eventTag === 'R' || eventTag === 'B') {
        this.partialText = '';
      } else if (eventTag === 'X') {
        if (this.continuous) {
          // Continuous Speech Auto-Repriming Loop
          if (this.partialText && this.partialText.trim()) {
            this.buffer = (this.buffer ? this.buffer + ' ' : '') + this.partialText.trim();
            this.partialText = '';
            if (this.onPartial) {
              try { this.onPartial('', this.sessionId); } catch (e) {}
            }
          }
          // Debounced re-prime (60ms) to prevent Android ERROR_RECOGNIZER_BUSY
          if (this.reprimeTimer) { clearTimeout(this.reprimeTimer); }
          const self = this;
          this.reprimeTimer = setTimeout(function () {
            if (self.state === 'recording') {
              self._reprimeHardware();
            }
          }, 60);
        } else {
          this.stopDictation(this.sessionId);
        }
      }
    }

    cleanupOnVisibilityChange(hidden) {
      var isHidden = typeof hidden === 'boolean'
        ? hidden
        : (typeof document !== 'undefined' ? document.visibilityState !== 'visible' : true);
      if (isHidden && (this.state === 'recording' || this.state === 'preparing' || this.state === 'processing')) {
        this.cancelDictation(this.sessionId);
      }
    }

    cleanupOnChatSwitch(newChatId) {
      if (this.chatId && newChatId !== this.chatId && this.state !== 'idle') {
        this.cancelDictation(this.sessionId);
      }
    }

    destroy() {
      this.cancelDictation(this.sessionId);
      this.destroyed = true;
      this.state = 'idle';
      this._subscribers = [];
    }

    getSession() {
      return {
        sessionId: this.sessionId,
        chatId: this.chatId,
        state: this.state,
        startTime: this.startTime,
        buffer: this.buffer,
        partialText: this.partialText,
        continuous: this.continuous,
        engine: this.engine
      };
    }

    // ---- Hardware & Engine Integration Internals ----
    _pickEngine() {
      if (this.options && this.options.engine) return this.options.engine;
      try {
        var cfg = loadCfg();
        if (cfg.engine === 'system') return 'system';
        if (cfg.engine === 'vosk') return 'vosk';
      } catch (e) {}
      return 'vosk';
    }

    _getLang() {
      if (this.lang) return this.lang;
      try {
        var cfg = loadCfg();
        if (cfg.lang === 'ru') return 'ru-RU';
        if (cfg.lang === 'en') return 'en-US';
        var docLang = typeof document !== 'undefined'
          ? (document.documentElement.getAttribute('data-agy-language') || 'ru').toLowerCase()
          : 'ru';
        return docLang.indexOf('en') === 0 ? 'en-US' : 'ru-RU';
      } catch (e) {
        return 'ru-RU';
      }
    }

    _startHardware() {
      if (this.options && this.options.simulateFailure) return false;
      if (typeof window === 'undefined') return true;

      var VOSK = window.AgyVosk && window.AgyVosk.available && window.AgyVosk.available() ? window.AgyVosk : null;
      var SYS = window.AgySTT || null;
      var eng = this.engine === 'system' ? (SYS || VOSK) : (VOSK || SYS);
      if (!eng) return true;

      this.curEng = eng;
      try { if (eng.ensurePermission) eng.ensurePermission(); } catch (e) {}
      try {
        var r = eng.start(this._getLang());
        return !(typeof r === 'string' && r.indexOf('ERR') === 0);
      } catch (e) {
        return false;
      }
    }

    _reprimeHardware() {
      if (typeof window === 'undefined' || !this.curEng) return;
      try {
        if (this.curEng.ensurePermission) this.curEng.ensurePermission();
        if (this.curEng.start) this.curEng.start(this._getLang());
      } catch (e) {}
    }

    _stopHardware() {
      if (this.curEng) {
        try {
          if (this.curEng.pollStt) {
            var e = this.curEng.pollStt();
            if (e) {
              var tag = e.charAt(0);
              var t = e.length > 2 ? e.slice(2) : '';
              if (tag === 'F' && t) {
                this.buffer = (this.buffer ? this.buffer + ' ' : '') + t.trim();
              } else if (tag === 'P' && t) {
                this.partialText = t;
              }
            }
          }
        } catch (err) {}
        try { if (this.curEng.stop) this.curEng.stop(); } catch (e) {}
        this.curEng = null;
      }
    }

    _cancelHardware() {
      if (this.curEng) {
        try {
          if (this.curEng.cancel) this.curEng.cancel();
          else if (this.curEng.stop) this.curEng.stop();
        } catch (e) {}
        this.curEng = null;
      }
    }

    _startPolling() {
      if (this.pollTimer || typeof window === 'undefined' || !this.curEng) return;
      var self = this;
      this.pollTimer = setInterval(function () {
        if (self.state !== 'recording' && self.state !== 'processing') return;
        var evt = '';
        try { evt = self.curEng ? self.curEng.pollStt() : ''; } catch (e) { evt = ''; }
        if (!evt) return;
        var tag = evt.charAt(0);
        var text = evt.length > 2 ? evt.slice(2) : '';
        self.dispatchBridgeEvent(self.sessionId, self.chatId, tag, text);
      }, 120);
    }

    _stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    }

    _startWatchdog() {
      if (this.watchdogTimer || typeof window === 'undefined') return;
      var self = this;
      var VOSK = window.AgyVosk;
      var SYS = window.AgySTT;
      if (this.curEng === VOSK && SYS) {
        this.watchdogTimer = setTimeout(function () {
          if (self.state === 'recording' && !self.sawEvent) {
            try { if (VOSK.stop) VOSK.stop(); } catch (e) {}
            self.curEng = SYS;
            try { SYS.start(self._getLang()); } catch (e) {}
          }
        }, 4500);
      }
    }

    _clearWatchdog() {
      if (this.watchdogTimer) {
        clearTimeout(this.watchdogTimer);
        this.watchdogTimer = null;
      }
    }
  }

  // Global Singleton Instance
  var agyDictationInstance = new DictationFSM();

  // Attach Lifecycle Listeners in browser environment
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      agyDictationInstance.cleanupOnVisibilityChange(document.visibilityState !== 'visible');
    });
    window.addEventListener('pagehide', function () {
      agyDictationInstance.destroy();
    });
    window.addEventListener('beforeunload', function () {
      agyDictationInstance.destroy();
    });
  }

  // ---- Settings Tab Mount (Preserved) ----
  function radioRow(name, value, cur, label, hint) {
    return '<label class="agy-dc-opt' + (cur === value ? " on" : "") + '">' +
      '<input type="radio" name="' + name + '" data-set="' + name + '" value="' + value + '"' + (cur === value ? " checked" : "") + ">" +
      '<span class="agy-dc-optmain"><b>' + esc(label) + "</b>" + (hint ? '<span class="agy-dc-opthint">' + esc(hint) + "</span>" : "") + "</span></label>";
  }

  function render(host) {
    var c = loadCfg();
    var vok = voskReady();
    var h = '<div class="agy-dictation">' +
      '<div class="agy-dc-title">' + esc(T("Распознавание речи", "Speech recognition")) + "</div>" +
      '<div class="agy-dc-sub">' + esc(T(
        "Голосовой ввод в чате. Для провайдерских моделей распознаёт локально на устройстве, без ключа.",
        "In-chat voice input. For provider models it recognises locally on-device, no API key.")) + "</div>";

    // Enable
    h += '<label class="agy-dc-master"><span>' + esc(T("Включить голосовой ввод", "Enable voice input")) + "</span>" +
      '<input type="checkbox" data-set="enabled"' + (c.enabled ? " checked" : "") + "></label>";

    // Engine
    h += '<div class="agy-dc-group"><div class="agy-dc-gtitle">' + esc(T("Движок распознавания", "Recognition engine")) + "</div>";
    h += radioRow("engine", "auto", c.engine, T("Авто", "Auto"),
      vok ? T("Офлайн Vosk, если доступен, иначе системный", "Offline Vosk if available, else system") : T("Системный распознаватель", "System recogniser"));
    h += radioRow("engine", "vosk", c.engine, T("Офлайн (Vosk)", "Offline (Vosk)"),
      vok ? T("На устройстве, без интернета, непрерывно", "On-device, no internet, continuous") : T("Модель не встроена в этот билд", "Model not bundled in this build"));
    h += radioRow("engine", "system", c.engine, T("Системный", "System"),
      T("Android SpeechRecognizer (одна фраза за нажатие)", "Android SpeechRecognizer (one phrase per tap)"));
    h += "</div>";

    // Language
    h += '<div class="agy-dc-group"><div class="agy-dc-gtitle">' + esc(T("Язык", "Language")) + "</div>";
    h += radioRow("lang", "auto", c.lang, T("По языку интерфейса", "Follow interface language"), "");
    h += radioRow("lang", "ru", c.lang, T("Русский", "Russian"), "");
    h += radioRow("lang", "en", c.lang, T("Английский", "English"), "");
    h += "</div>";

    h += '<div class="agy-dc-note">' + esc(T(
      "В стандартном режиме (не провайдеры) диктовка идёт через ядро и этим настройкам не подчиняется.",
      "In standard mode (non-provider) dictation goes through the core and ignores these settings.")) + "</div>";
    h += "</div>";
    host.innerHTML = h;
  }

  function onChange(host, e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var k = el.getAttribute("data-set");
    if (!k) return;
    var c = loadCfg();
    if (k === "enabled") c.enabled = el.checked;
    else c[k] = el.value;
    saveCfg(c);
    render(host);
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("agy-dictation-changed", { detail: c }));
      }
    } catch (e2) {}
  }

  var agyDictationMount = function (host) {
    if (!host) return;
    if (host.__agyMounted) { render(host); return; }
    host.__agyMounted = true;
    render(host);
    host.addEventListener("change", function (e) { onChange(host, e); });
  };

  return {
    DictationFSM: DictationFSM,
    AgyDictation: agyDictationInstance,
    __agyDictationCfg: loadCfg,
    __agyDictationMount: agyDictationMount,
    default: {
      DictationFSM: DictationFSM,
      AgyDictation: agyDictationInstance,
      __agyDictationCfg: loadCfg,
      __agyDictationMount: agyDictationMount
    }
  };
});
