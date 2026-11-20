import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

// Load agy_dictation module
const dictationPath = path.join(REPO_ROOT, "app/assets/web/agy_dictation.js");
const dictModule = await import("file://" + dictationPath);
const { DictationFSM, AgyDictation, __agyDictationMount, __agyDictationCfg } = (
  dictModule.default?.DictationFSM ? dictModule.default : dictModule
);

// Load TypeScript AST parser from system environment if available
let ts = null;
try {
  const tsModule = await import("/data/user/0/com.agyru.t2/files/usr/lib/node_modules/typescript/lib/typescript.js");
  ts = tsModule.default || tsModule;
} catch (e) {
  try {
    const tsModule = await import("typescript");
    ts = tsModule.default || tsModule;
  } catch (ignore) {}
}

// Helper to create a sandboxed DOM mock for testing agy_ru.js voice input integration
function createSandboxedVoiceEnv(initialEditorText = "Pre-existing draft text") {
  const listeners = { document: {}, window: {} };
  const execCommandCalls = [];
  const inputEventCalls = [];

  const editor = {
    textContent: initialEditorText,
    focusCalls: 0,
    focus: () => { editor.focusCalls++; },
    contains: () => true,
    dispatchEvent: (evt) => {
      inputEventCalls.push(evt);
      if (evt && evt.data) {
        editor.textContent += evt.data;
      }
      return true;
    }
  };

  const inputCardBox = {
    parentElement: {
      insertBefore: (newChild, refChild) => {
        liveBarElement = newChild;
        liveBarElement.isConnected = true;
      }
    },
    querySelector: (sel) => {
      if (sel.includes("contenteditable") || sel.includes("textarea")) {
        return editor;
      }
      return null;
    }
  };

  let liveBarElement = null;

  const micBtn = {
    classList: {
      add: (cls) => micBtn.classes.add(cls),
      remove: (cls) => micBtn.classes.delete(cls),
      contains: (cls) => micBtn.classes.has(cls)
    },
    classes: new Set(),
    closest: (sel) => micBtn,
    isConnected: true
  };

  const doc = {
    visibilityState: "visible",
    documentElement: {
      getAttribute: (attr) => "ru"
    },
    querySelector: (sel) => {
      if (sel.includes("agent-input-box")) return inputCardBox;
      if (sel.includes("Record voice memo") || sel.includes("Stop recording")) return micBtn;
      if (sel.includes("conversation-view")) return { getAttribute: () => "chat_challenger" };
      return null;
    },
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        id: "",
        className: "",
        innerHTML: "",
        isConnected: false,
        querySelector: (subSel) => {
          if (subSel.includes("agy-dictation-preview-text")) {
            return {
              textContent: "",
              set textContent(val) { el._previewText = val; },
              get textContent() { return el._previewText || ""; }
            };
          }
          if (subSel.includes("agy-dictation-cancel-btn")) {
            return {
              addEventListener: (ev, handler) => {
                el._cancelHandler = handler;
              }
            };
          }
          return null;
        },
        remove: () => {
          el.isConnected = false;
          if (liveBarElement === el) liveBarElement = null;
        }
      };
      return el;
    },
    addEventListener: (ev, fn, capture) => {
      if (!listeners.document[ev]) listeners.document[ev] = [];
      listeners.document[ev].push(fn);
    },
    removeEventListener: (ev, fn) => {
      if (!listeners.document[ev]) return;
      listeners.document[ev] = listeners.document[ev].filter(h => h !== fn);
    },
    execCommand: (cmd, showUI, val) => {
      execCommandCalls.push({ cmd, val });
      if (cmd === "insertText" && val) {
        editor.textContent += val;
      }
      return true;
    }
  };

  const fsmInstance = new DictationFSM();

  const win = {
    getSelection: () => ({ rangeCount: 0 }),
    addEventListener: (ev, fn) => {
      if (!listeners.window[ev]) listeners.window[ev] = [];
      listeners.window[ev].push(fn);
    },
    removeEventListener: (ev, fn) => {
      if (!listeners.window[ev]) return;
      listeners.window[ev] = listeners.window[ev].filter(h => h !== fn);
    },
    __agyProviderSpecs: () => [{ id: "mock_provider" }],
    __agyDictationCfg: () => ({ enabled: true, engine: "system", lang: "ru" }),
    AgyDictation: fsmInstance,
    DictationFSM: DictationFSM
  };

  const activeIntervals = [];
  const customSetInterval = (fn, ms) => {
    const id = setInterval(fn, ms);
    activeIntervals.push(id);
    return id;
  };
  const customClearInterval = (id) => {
    clearInterval(id);
  };

  const ctx = {
    window: win,
    document: doc,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {}
    },
    setTimeout,
    clearTimeout,
    setInterval: customSetInterval,
    clearInterval: customClearInterval,
    InputEvent: class InputEvent {
      constructor(type, opts = {}) {
        this.type = type;
        this.data = opts.data;
        this.inputType = opts.inputType;
      }
    }
  };

  // Extract voice IIFE from agy_ru.js (lines 1180-1457)
  const agyRuContent = fs.readFileSync(path.join(REPO_ROOT, "app/assets/web/agy_ru.js"), "utf-8");
  const agyRuLines = agyRuContent.split("\n");
  const voiceSnippet = agyRuLines.slice(1179, 1457).join("\n");

  vm.createContext(ctx);
  vm.runInContext(voiceSnippet, ctx);

  function cleanup() {
    activeIntervals.forEach(id => clearInterval(id));
    fsmInstance.destroy();
  }

  return {
    listeners,
    editor,
    micBtn,
    fsm: fsmInstance,
    doc,
    win,
    execCommandCalls,
    inputEventCalls,
    getLiveBar: () => liveBarElement,
    cleanup
  };
}

// ============================================================================
// Suite 1: Strict Cancellation Semantics (Escape Key & cancelDictation)
// ============================================================================
test("Challenger Suite 1: Strict Cancellation Semantics (Zero Characters Inserted)", async (t) => {
  await t.test("cancelDictation guarantees strictly 0 characters added with interim partial text", () => {
    const fsm = new DictationFSM();
    let finalCalls = 0;
    fsm.onFinal = () => { finalCalls++; };

    const sid = fsm.startDictation({ chatId: "chat_cancel_test" });
    assert.equal(fsm.state, "recording");

    // Partial speech arrives
    fsm.dispatchBridgeEvent(sid, "chat_cancel_test", "P", "temporary unrecognized fragment");
    assert.equal(fsm.partialText, "temporary unrecognized fragment");
    assert.equal(fsm.buffer, "");

    // User or system aborts via cancelDictation
    fsm.cancelDictation(sid);

    assert.equal(fsm.state, "idle", "FSM must return to idle state");
    assert.equal(fsm.buffer, "", "Buffer must be purged to empty string");
    assert.equal(fsm.partialText, "", "Partial text must be purged to empty string");
    assert.equal(finalCalls, 0, "onFinal must NEVER be called upon cancellation");
  });

  await t.test("cancelDictation purges both committed buffer and interim partial text", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "chat_cancel_mult" });

    // Finalized sentence + ongoing partial
    fsm.dispatchBridgeEvent(sid, "chat_cancel_mult", "F", "Sentence one.");
    fsm.dispatchBridgeEvent(sid, "chat_cancel_mult", "P", "Sentence two partial");

    assert.equal(fsm.buffer, "Sentence one.");
    assert.equal(fsm.partialText, "Sentence two partial");

    fsm.cancelDictation(sid);

    assert.equal(fsm.buffer, "");
    assert.equal(fsm.partialText, "");
    assert.equal(fsm.state, "idle");
  });

  await t.test("Escape key press during active recording leaves editor text strictly pristine", () => {
    const initialText = "My original prompt draft that must remain intact.";
    const env = createSandboxedVoiceEnv(initialText);

    try {
      // 1. User clicks mic button to start recording
      const clickHandler = env.listeners.document["click"][0];
      let clickPrevented = false;
      clickHandler({
        target: env.micBtn,
        preventDefault: () => { clickPrevented = true; },
        stopPropagation: () => {},
        stopImmediatePropagation: () => {}
      });

      assert.equal(env.fsm.state, "recording");
      assert.ok(env.micBtn.classList.contains("agy-stt-live"));
      assert.ok(env.getLiveBar(), "Live floating preview bar must be rendered");

      // 2. Partial text streams in
      env.fsm.dispatchBridgeEvent(env.fsm.sessionId, "chat_challenger", "P", "Some spoken stream");
      assert.equal(env.fsm.partialText, "Some spoken stream");

      // 3. User presses Escape key
      const keyHandler = env.listeners.document["keydown"][0];
      let escapePrevented = false;
      let escapeStopped = false;
      keyHandler({
        key: "Escape",
        keyCode: 27,
        preventDefault: () => { escapePrevented = true; },
        stopPropagation: () => { escapeStopped = true; }
      });

      // Strict verifications
      assert.ok(escapePrevented, "Escape key default action must be prevented");
      assert.ok(escapeStopped, "Escape key propagation must be stopped");
      assert.equal(env.fsm.state, "idle", "Session must be cancelled and returned to idle");
      assert.equal(env.fsm.buffer, "", "Buffer must be empty");
      assert.equal(env.fsm.partialText, "", "Partial text must be empty");
      assert.equal(env.micBtn.classList.contains("agy-stt-live"), false, "Mic active styling must be removed");
      assert.equal(env.getLiveBar(), null, "Live preview bar must be removed from DOM");

      // STRICT ZERO CHARACTERS INSERTION CHECK:
      assert.equal(env.execCommandCalls.length, 0, "document.execCommand must NOT be called on Escape");
      assert.equal(env.inputEventCalls.length, 0, "No InputEvents must be dispatched to the editor on Escape");
      assert.equal(env.editor.textContent, initialText, "Editor content must match initial text byte-for-byte");
      assert.equal(env.editor.textContent.length - initialText.length, 0, "Exactly 0 characters added to editor");
    } finally {
      env.cleanup();
    }
  });

  await t.test("stopDictation on cancelled session strictly yields empty result and inserts 0 chars", async () => {
    // 1. Direct FSM cancelled state rejection
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "c_canc" });
    fsm.transitionTo("cancelled");
    await assert.rejects(
      () => fsm.stopDictation(sid),
      /Session was cancelled/
    );

    // 2. Post-cancellation (idle state): resolves with empty string, 0 chars inserted
    const env = createSandboxedVoiceEnv("Draft message");
    try {
      const clickHandler = env.listeners.document["click"][0];
      clickHandler({
        target: env.micBtn,
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {}
      });

      const activeSid = env.fsm.sessionId;
      env.fsm.dispatchBridgeEvent(activeSid, "chat_challenger", "F", "Completed phrase");

      // Cancel session
      env.fsm.cancelDictation(activeSid);
      assert.equal(env.fsm.state, "idle");

      // stopDictation returns empty string and commits 0 characters
      const result = await env.fsm.stopDictation(activeSid);
      assert.equal(result, "");
      assert.equal(env.execCommandCalls.length, 0);
      assert.equal(env.editor.textContent, "Draft message");
    } finally {
      env.cleanup();
    }
  });

  await t.test("Stress test: 50 consecutive cycles of start -> partial stream -> Escape key", () => {
    const baseText = "Initial draft #";
    for (let i = 0; i < 50; i++) {
      const initialContent = `${baseText}${i}`;
      const env = createSandboxedVoiceEnv(initialContent);
      try {
        const clickHandler = env.listeners.document["click"][0];
        clickHandler({
          target: env.micBtn,
          preventDefault: () => {},
          stopPropagation: () => {},
          stopImmediatePropagation: () => {}
        });

        // Send 1-5 random partial speech chunks
        const chunksCount = 1 + (i % 5);
        for (let c = 0; c < chunksCount; c++) {
          env.fsm.dispatchBridgeEvent(env.fsm.sessionId, "chat_challenger", "P", `Stress chunk ${i}-${c}`);
        }

        // Press Escape
        const keyHandler = env.listeners.document["keydown"][0];
        keyHandler({
          key: "Escape",
          keyCode: 27,
          preventDefault: () => {},
          stopPropagation: () => {}
        });

        assert.equal(env.fsm.state, "idle", `Cycle ${i}: state must be idle`);
        assert.equal(env.execCommandCalls.length, 0, `Cycle ${i}: execCommand calls must be 0`);
        assert.equal(env.editor.textContent, initialContent, `Cycle ${i}: content must remain unchanged`);
        assert.equal(env.editor.textContent.length, initialContent.length, `Cycle ${i}: delta must be exactly 0`);
      } finally {
        env.cleanup();
      }
    }
  });

  await t.test("Edge case: Escape key when idle, preparing, or processing is completely safe", () => {
    const env = createSandboxedVoiceEnv("Static text");
    try {
      const keyHandler = env.listeners.document["keydown"][0];

      // 1. Idle state
      assert.equal(env.fsm.state, "idle");
      keyHandler({ key: "Escape", keyCode: 27, preventDefault: () => {}, stopPropagation: () => {} });
      assert.equal(env.fsm.state, "idle");
      assert.equal(env.editor.textContent, "Static text");

      // 2. Preparing state
      env.fsm.transitionTo("preparing");
      assert.equal(env.fsm.isRecording(), true);
      keyHandler({ key: "Escape", keyCode: 27, preventDefault: () => {}, stopPropagation: () => {} });
      assert.equal(env.fsm.state, "idle");
      assert.equal(env.editor.textContent, "Static text");

      // 3. Processing state
      env.fsm.startDictation({ chatId: "chat_challenger" });
      env.fsm.transitionTo("processing");
      assert.equal(env.fsm.isRecording(), true);
      keyHandler({ key: "Escape", keyCode: 27, preventDefault: () => {}, stopPropagation: () => {} });
      assert.equal(env.fsm.state, "idle");
      assert.equal(env.editor.textContent, "Static text");
    } finally {
      env.cleanup();
    }
  });
});

// ============================================================================
// Suite 2: Late Callbacks & Session/Chat ID Isolation
// ============================================================================
test("Challenger Suite 2: Late Callbacks & Session/Chat ID Isolation", async (t) => {
  await t.test("discards stale session events across all event tags (P, F, X, E)", () => {
    const fsm = new DictationFSM();
    let partialCalls = 0;
    let finalCalls = 0;
    let errorCalls = 0;

    fsm.onPartial = () => { partialCalls++; };
    fsm.onFinal = () => { finalCalls++; };
    fsm.onError = () => { errorCalls++; };

    // 1. Start Session 1
    const sid1 = fsm.startDictation({ chatId: "chat_1" });
    fsm.dispatchBridgeEvent(sid1, "chat_1", "F", "Legitimate sentence 1.");
    fsm.cancelDictation(sid1);
    assert.equal(fsm.state, "idle");

    // 2. Start Session 2
    const sid2 = fsm.startDictation({ chatId: "chat_1" });
    assert.notEqual(sid1, sid2);
    assert.equal(fsm.state, "recording");

    // Reset counters before injecting late events from Session 1
    partialCalls = 0;
    finalCalls = 0;
    errorCalls = 0;

    // 3. Late events from Session 1 arrive while Session 2 is actively recording
    fsm.dispatchBridgeEvent(sid1, "chat_1", "P", "Late partial text from session 1");
    fsm.dispatchBridgeEvent(sid1, "chat_1", "F", "Late final text from session 1");
    fsm.dispatchBridgeEvent(sid1, "chat_1", "X"); // Silence event
    fsm.dispatchBridgeEvent(sid1, "chat_1", "E", "Late error from session 1");

    // Verifications: Session 2 state and buffers must NOT be affected
    assert.equal(fsm.state, "recording", "Active session must remain in recording state");
    assert.equal(fsm.buffer, "", "Buffer must remain empty, untouched by sid1");
    assert.equal(fsm.partialText, "", "Partial text must remain empty, untouched by sid1");
    assert.equal(partialCalls, 0, "onPartial must not be triggered by stale sid1");
    assert.equal(finalCalls, 0, "onFinal must not be triggered by stale sid1");
    assert.equal(errorCalls, 0, "onError must not be triggered by stale sid1");

    // Legitimate event for Session 2 succeeds
    fsm.dispatchBridgeEvent(sid2, "chat_1", "P", "Active partial 2");
    assert.equal(fsm.partialText, "Active partial 2");
    assert.equal(partialCalls, 1);

    fsm.cancelDictation(sid2);
  });

  await t.test("discards events with mismatched chatId even with matching sessionId", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "chat_alpha" });

    // Bridge event arrives with targetChatId="chat_beta"
    fsm.dispatchBridgeEvent(sid, "chat_beta", "F", "Rogue text from different chat");
    assert.equal(fsm.buffer, "", "Buffer must reject cross-chat text");

    fsm.dispatchBridgeEvent(sid, "chat_beta", "P", "Rogue partial");
    assert.equal(fsm.partialText, "", "Partial text must reject cross-chat text");

    fsm.dispatchBridgeEvent(sid, "chat_beta", "E", "Rogue error");
    assert.equal(fsm.state, "recording", "Mismatched chatId error must not abort active session");

    fsm.cancelDictation(sid);
  });

  await t.test("boundary robustness: rejects null, undefined, empty, and non-string IDs", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "valid_chat" });

    const invalidSessionIds = [null, undefined, "", 0, 12345, false, {}, []];
    const invalidChatIds = [null, undefined, "", 0, 12345, false, {}, []];

    for (const badSid of invalidSessionIds) {
      assert.doesNotThrow(() => {
        fsm.dispatchBridgeEvent(badSid, "valid_chat", "F", "Payload with bad SID");
      });
      assert.equal(fsm.buffer, "");
    }

    for (const badChat of invalidChatIds) {
      assert.doesNotThrow(() => {
        fsm.dispatchBridgeEvent(sid, badChat, "F", "Payload with bad ChatID");
      });
      assert.equal(fsm.buffer, "");
    }

    fsm.cancelDictation(sid);
  });

  await t.test("late callbacks arriving after cancellation are completely dropped in idle state", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "cancelled_chat" });
    fsm.cancelDictation(sid);
    assert.equal(fsm.state, "idle");

    // Delayed native bridge callback arrives for cancelled session
    fsm.dispatchBridgeEvent(sid, "cancelled_chat", "P", "Late partial");
    fsm.dispatchBridgeEvent(sid, "cancelled_chat", "F", "Late final");
    fsm.dispatchBridgeEvent(sid, "cancelled_chat", "X");
    fsm.dispatchBridgeEvent(sid, "cancelled_chat", "E", "Late error");

    assert.equal(fsm.state, "idle");
    assert.equal(fsm.buffer, "");
    assert.equal(fsm.partialText, "");
  });

  await t.test("Stress storm: 500 interleaved events (400 hostile/stale and 100 legitimate)", async () => {
    const fsm = new DictationFSM();
    const activeChat = "target_conversation";
    const activeSid = fsm.startDictation({ chatId: activeChat, continuous: true });

    const expectedTokens = [];

    // Interleave events: 4 hostile events for every 1 legitimate event
    for (let i = 0; i < 100; i++) {
      // 1. Rogue stale sessionId
      fsm.dispatchBridgeEvent(`stale_session_${i}`, activeChat, "F", `Stale SID ${i}`);
      // 2. Rogue mismatched chatId
      fsm.dispatchBridgeEvent(activeSid, `wrong_chat_${i}`, "P", `Wrong Chat ${i}`);
      // 3. Rogue null sessionId with error tag
      fsm.dispatchBridgeEvent(null, activeChat, "E", "Fatal crash");
      // 4. Rogue empty chatId
      fsm.dispatchBridgeEvent(activeSid, "", "X");

      // 5. Legitimate token
      const token = `word${i}`;
      expectedTokens.push(token);
      fsm.dispatchBridgeEvent(activeSid, activeChat, "F", token);
    }

    assert.equal(fsm.state, "recording", "Must survive 400 hostile events without crashing or aborting");
    const committed = await fsm.stopDictation(activeSid);

    assert.equal(committed, expectedTokens.join(" "), "Active buffer must contain strictly the 100 legitimate tokens");
    assert.equal(fsm.state, "idle");
  });
});

// ============================================================================
// Suite 3: Document Visibility Lifecycle across all states
// ============================================================================
test("Challenger Suite 3: Visibility Lifecycle (visibilitychange across all states)", async (t) => {
  await t.test("visibilitychange hidden=true cancels session in preparing state", () => {
    const fsm = new DictationFSM();
    fsm.transitionTo("preparing");
    assert.equal(fsm.state, "preparing");
    assert.equal(fsm.isRecording(), true);

    fsm.cleanupOnVisibilityChange(true);

    assert.equal(fsm.state, "idle");
    assert.equal(fsm.isRecording(), false);
    assert.equal(fsm.buffer, "");
    assert.equal(fsm.partialText, "");
  });

  await t.test("visibilitychange hidden=true cancels session in recording state", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "vis_rec" });
    fsm.dispatchBridgeEvent(sid, "vis_rec", "P", "Unfinished thought");
    assert.equal(fsm.state, "recording");

    fsm.cleanupOnVisibilityChange(true);

    assert.equal(fsm.state, "idle");
    assert.equal(fsm.isRecording(), false);
    assert.equal(fsm.buffer, "");
    assert.equal(fsm.partialText, "");
  });

  await t.test("visibilitychange hidden=true cancels session in processing state", () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: "vis_proc" });
    fsm.transitionTo("processing");
    assert.equal(fsm.state, "processing");

    fsm.cleanupOnVisibilityChange(true);

    assert.equal(fsm.state, "idle");
    assert.equal(fsm.isRecording(), false);
    assert.equal(fsm.buffer, "");
  });

  await t.test("visibilitychange hidden=true in idle state is a safe no-op", () => {
    const fsm = new DictationFSM();
    assert.equal(fsm.state, "idle");

    assert.doesNotThrow(() => {
      fsm.cleanupOnVisibilityChange(true);
    });
    assert.equal(fsm.state, "idle");
  });

  await t.test("visibilitychange hidden=false preserves active states without interruption", () => {
    // 1. preparing state
    const fsm1 = new DictationFSM();
    fsm1.transitionTo("preparing");
    fsm1.cleanupOnVisibilityChange(false);
    assert.equal(fsm1.state, "preparing");

    // 2. recording state
    const fsm2 = new DictationFSM();
    fsm2.startDictation({ chatId: "vis_preserve" });
    assert.equal(fsm2.state, "recording");
    fsm2.cleanupOnVisibilityChange(false);
    assert.equal(fsm2.state, "recording");

    // 3. processing state
    fsm2.transitionTo("processing");
    fsm2.cleanupOnVisibilityChange(false);
    assert.equal(fsm2.state, "processing");
  });

  await t.test("DOM integration: document visibilitychange event cancels recording and cleans UI", () => {
    const env = createSandboxedVoiceEnv("Draft before backgrounding");
    try {
      // Start recording
      const clickHandler = env.listeners.document["click"][0];
      clickHandler({
        target: env.micBtn,
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {}
      });

      assert.equal(env.fsm.state, "recording");
      assert.ok(env.micBtn.classList.contains("agy-stt-live"));
      assert.ok(env.getLiveBar());

      // Simulate app sent to background: document.visibilityState becomes hidden
      env.doc.visibilityState = "hidden";
      const visHandler = env.listeners.document["visibilitychange"][0];
      visHandler();

      assert.equal(env.fsm.state, "idle", "Dictation must be cancelled when app goes to background");
      assert.equal(env.micBtn.classList.contains("agy-stt-live"), false, "Mic active class must be cleared");
      assert.equal(env.getLiveBar(), null, "Live preview bar must be removed");
      assert.equal(env.execCommandCalls.length, 0, "No text must be committed to editor");
      assert.equal(env.editor.textContent, "Draft before backgrounding");
    } finally {
      env.cleanup();
    }
  });

  await t.test("Stress test: 20 rapid visibility flapping cycles under active sessions", () => {
    const fsm = new DictationFSM();
    for (let cycle = 0; cycle < 20; cycle++) {
      const sid = fsm.startDictation({ chatId: `flap_${cycle}` });
      assert.equal(fsm.state, "recording");

      // App backgrounds
      fsm.cleanupOnVisibilityChange(true);
      assert.equal(fsm.state, "idle");

      // App foregrounds
      fsm.cleanupOnVisibilityChange(false);
      assert.equal(fsm.state, "idle");
    }
  });
});

// ============================================================================
// Suite 4: Syntax and AST Validation of main.js (continuous: !0 in dO)
// ============================================================================
test("Challenger Suite 4: Syntax & AST Validation of main.js", async (t) => {
  const mainJsPath = path.join(REPO_ROOT, "app/assets/web/generated/main.js");
  const content = fs.readFileSync(mainJsPath, "utf-8");
  const lines = content.split("\n");

  await t.test("main.js passes complete V8 syntax script compilation without error", () => {
    assert.doesNotThrow(() => {
      new vm.Script(content);
    }, "main.js must compile in V8 without SyntaxError");
  });

  await t.test("AST validation of dO function definition and default continuous parameter", () => {
    // Line 5839 (0-indexed 5838) contains `var dO=({editorRef:a,cascadeId:b,logEvent:c,continuous:e=!1,...`
    const defLine = lines[5838];
    assert.ok(defLine.includes("continuous:e=!1"), "dO function parameter list must define continuous:e=!1");

    if (ts) {
      const sf = ts.createSourceFile("dO_def.js", defLine, ts.ScriptTarget.Latest, true);
      let foundDODecl = false;
      let foundContinuousParam = false;
      let defaultIsFalse = false;

      function visit(node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "dO") {
          foundDODecl = true;
          const fn = node.initializer;
          if (ts.isArrowFunction(fn) && fn.parameters.length > 0) {
            const param0 = fn.parameters[0];
            if (ts.isObjectBindingPattern(param0.name)) {
              for (const elem of param0.name.elements) {
                if (elem.propertyName && ts.isIdentifier(elem.propertyName) && elem.propertyName.text === "continuous") {
                  foundContinuousParam = true;
                  // In continuous: e = !1, elem.initializer is BinaryExpression `e = !1`
                  const initText = elem.initializer ? elem.initializer.getText(sf) : "";
                  if (initText.includes("!1") || initText.includes("false")) {
                    defaultIsFalse = true;
                  }
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      }

      visit(sf);
      assert.ok(foundDODecl, "AST must locate variable declaration dO");
      assert.ok(foundContinuousParam, "AST must locate parameter continuous in dO binding pattern");
      assert.ok(defaultIsFalse, "AST must verify continuous parameter defaults to false (!1)");
    }
  });

  await t.test("AST validation of AgentInputBox invocation of dO with continuous: !0", () => {
    // Line 11437 (0-indexed 11436) contains `...}=dO({editorRef:kc,cascadeId:O,logEvent:ob,continuous:!0})`
    const callLine = lines[11436];
    assert.ok(callLine, "Call line must exist");

    if (ts) {
      const sf = ts.createSourceFile("dO_call.js", callLine, ts.ScriptTarget.Latest, true);
      let foundCall = false;
      let hasEditorRef = false;
      let hasCascadeId = false;
      let hasLogEvent = false;
      let hasContinuous = false;
      let continuousValueIsTrue = false;

      function visit(node) {
        if (ts.isCallExpression(node)) {
          if (ts.isIdentifier(node.expression) && node.expression.text === "dO") {
            foundCall = true;
            assert.ok(node.arguments.length > 0, "dO must be called with arguments");
            const arg0 = node.arguments[0];
            if (ts.isObjectLiteralExpression(arg0)) {
              for (const prop of arg0.properties) {
                if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                  const propName = prop.name.text;
                  if (propName === "editorRef") hasEditorRef = true;
                  if (propName === "cascadeId") hasCascadeId = true;
                  if (propName === "logEvent") hasLogEvent = true;
                  if (propName === "continuous") {
                    hasContinuous = true;
                    const init = prop.initializer;
                    // Initializer must be PrefixUnaryExpression `!0`
                    if (ts.isPrefixUnaryExpression(init)) {
                      if (init.operator === ts.SyntaxKind.ExclamationToken &&
                          ts.isNumericLiteral(init.operand) &&
                          init.operand.text === "0") {
                        continuousValueIsTrue = true;
                      }
                    } else if (init.getText(sf) === "!0" || init.getText(sf) === "true") {
                      continuousValueIsTrue = true;
                    }
                  }
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      }

      visit(sf);
      assert.ok(foundCall, "AST must locate CallExpression to dO");
      assert.ok(hasEditorRef, "dO call must preserve editorRef argument");
      assert.ok(hasCascadeId, "dO call must preserve cascadeId argument");
      assert.ok(hasLogEvent, "dO call must preserve logEvent argument");
      assert.ok(hasContinuous, "dO call must explicitly pass continuous property");
      assert.ok(continuousValueIsTrue, "dO call must set continuous: !0 (strictly boolean true)");
    } else {
      // Regex fallback if TypeScript parser is not present
      const match = callLine.match(/dO\(\{editorRef:kc,cascadeId:O,logEvent:ob,continuous:!0\}\)/);
      assert.ok(match, "AgentInputBox must call dO with continuous:!0");
    }
  });

  await t.test("dO body AST verifies extended watchdog timer when continuous is true", () => {
    const defLine = lines[5847]; // line 5848 (0-indexed 5847)
    assert.ok(defLine.includes("e?18E5:21E4"), "dO body must use e ? 18E5 : 21E4 (30min continuous watchdog vs 3.5min)");
  });

  await t.test("AgentInputBox at line 11437 is verified to supply continuous:!0 to dO", () => {
    const callLine = lines[11436];
    assert.ok(
      callLine.includes("dO({editorRef:kc,cascadeId:O,logEvent:ob,continuous:!0})"),
      "AgentInputBox at line 11437 must pass continuous:!0 to dO"
    );
  });
});
