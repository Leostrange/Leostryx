import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

// ============================================================================
// Suite 1: Contract & Module Exports
// ============================================================================
test("Dictation Module Contract: Exports and Public Interfaces", async (t) => {
  await t.test("exports DictationFSM class and singleton AgyDictation", () => {
    assert.equal(typeof DictationFSM, "function");
    assert.ok(AgyDictation instanceof DictationFSM);
    assert.equal(typeof __agyDictationMount, "function");
    assert.equal(typeof __agyDictationCfg, "function");
  });

  await t.test("public AgyDictation contract satisfies PROJECT.md § Interface Contracts #2", () => {
    assert.equal(typeof AgyDictation.startDictation, "function");
    assert.equal(typeof AgyDictation.stopDictation, "function");
    assert.equal(typeof AgyDictation.cancelDictation, "function");
    assert.equal(typeof AgyDictation.destroy, "function");
    assert.equal(typeof AgyDictation.getStatus, "function");
    assert.equal(typeof AgyDictation.subscribe, "function");
    assert.equal(typeof AgyDictation.isRecording, "function");
  });

  await t.test("settings configuration loads valid defaults", () => {
    const cfg = __agyDictationCfg();
    assert.ok(typeof cfg === "object" && cfg !== null);
    assert.equal(cfg.enabled, true);
    assert.ok(["auto", "vosk", "system"].includes(cfg.engine));
    assert.ok(["auto", "ru", "en"].includes(cfg.lang));
  });
});

// ============================================================================
// Suite 2: 7-State FSM State Machine Integrity (F7)
// ============================================================================
test("Dictation 7-State FSM: State Machine Lifecycle and Transition Matrix", async (t) => {
  await t.test("initial state is idle", () => {
    const fsm = new DictationFSM();
    assert.equal(fsm.state, "idle");
    assert.equal(fsm.isRecording(), false);
  });

  await t.test("full standard recording lifecycle: idle -> preparing -> recording -> processing -> ready -> idle", async () => {
    const fsm = new DictationFSM();
    const recordedTransitions = [];
    fsm.onStateChange = (next, prev) => recordedTransitions.push(`${prev}->${next}`);

    const sid = fsm.startDictation({ chatId: "c_main" });
    assert.equal(fsm.state, "recording");
    assert.equal(fsm.isRecording(), true);

    fsm.dispatchBridgeEvent(sid, "c_main", "F", "Hello world from Leostryx");
    const result = await fsm.stopDictation(sid);

    assert.equal(result, "Hello world from Leostryx");
    assert.equal(fsm.state, "idle");
    assert.equal(fsm.isRecording(), false);

    assert.deepEqual(recordedTransitions, [
      "idle->preparing",
      "preparing->recording",
      "recording->processing",
      "processing->ready",
      "ready->idle"
    ]);
  });

  await t.test("cancellation transitions: preparing -> cancelled -> idle", () => {
    const fsm = new DictationFSM();
    fsm.transitionTo("preparing");
    fsm.transitionTo("cancelled");
    assert.equal(fsm.state, "cancelled");
    fsm.transitionTo("idle");
    assert.equal(fsm.state, "idle");
  });

  await t.test("cancellation transitions: recording -> cancelled -> idle", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "c_rec" });
    assert.equal(fsm.state, "recording");
    fsm.cancelDictation(sid);
    assert.equal(fsm.state, "idle");
  });

  await t.test("cancellation transitions: processing -> cancelled -> idle", () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: "c_proc" });
    fsm.transitionTo("processing");
    assert.equal(fsm.state, "processing");
    fsm.cancelDictation(fsm.sessionId);
    assert.equal(fsm.state, "idle");
  });

  await t.test("error transitions from preparing, recording, processing to idle", () => {
    const fsm1 = new DictationFSM();
    fsm1.transitionTo("preparing");
    fsm1.transitionTo("error", { error: "Mic busy" });
    assert.equal(fsm1.state, "error");
    fsm1.transitionTo("idle");
    assert.equal(fsm1.state, "idle");

    const fsm2 = new DictationFSM();
    const sid2 = fsm2.startDictation({ chatId: "c_err" });
    fsm2.dispatchBridgeEvent(sid2, "c_err", "E", "Hardware failure");
    assert.equal(fsm2.state, "idle");
  });

  await t.test("guards against illegal state transitions (throws Invalid state transition)", () => {
    const fsm = new DictationFSM();

    // From idle
    assert.throws(() => fsm.transitionTo("recording"), /Invalid state transition from idle to recording/);
    assert.throws(() => fsm.transitionTo("processing"), /Invalid state transition from idle to processing/);
    assert.throws(() => fsm.transitionTo("ready"), /Invalid state transition from idle to ready/);
    assert.throws(() => fsm.transitionTo("cancelled"), /Invalid state transition from idle to cancelled/);

    // From preparing
    fsm.transitionTo("preparing");
    assert.throws(() => fsm.transitionTo("idle"), /Invalid state transition from preparing to idle/);
    assert.throws(() => fsm.transitionTo("processing"), /Invalid state transition from preparing to processing/);
    assert.throws(() => fsm.transitionTo("ready"), /Invalid state transition from preparing to ready/);

    // From recording
    fsm.transitionTo("recording");
    assert.throws(() => fsm.transitionTo("idle"), /Invalid state transition from recording to idle/);
    assert.throws(() => fsm.transitionTo("preparing"), /Invalid state transition from recording to preparing/);
    assert.throws(() => fsm.transitionTo("ready"), /Invalid state transition from recording to ready/);

    // From processing
    fsm.transitionTo("processing");
    assert.throws(() => fsm.transitionTo("idle"), /Invalid state transition from processing to idle/);
    assert.throws(() => fsm.transitionTo("preparing"), /Invalid state transition from processing to preparing/);
    assert.throws(() => fsm.transitionTo("recording"), /Invalid state transition from processing to recording/);
  });

  await t.test("subscribe method registers and unregisters listeners accurately", () => {
    const fsm = new DictationFSM();
    const events = [];
    const unsubscribe = fsm.subscribe((next, prev, session) => {
      events.push({ next, prev, sessionId: session.sessionId });
    });

    const sid = fsm.startDictation({ chatId: "sub_chat" });
    assert.ok(events.length >= 2); // idle->preparing, preparing->recording
    assert.equal(events[0].prev, "idle");
    assert.equal(events[0].next, "preparing");
    assert.equal(events[0].sessionId, sid);

    unsubscribe();
    const countBefore = events.length;
    fsm.cancelDictation(sid);
    assert.equal(events.length, countBefore, "No further events delivered after unsubscribe");
  });
});

// ============================================================================
// Suite 3: Session ID & Chat ID Isolation (F8)
// ============================================================================
test("Dictation Session Isolation: Unique Session IDs and Stale Event Rejection", async (t) => {
  await t.test("generates unique session IDs on each startDictation", () => {
    const fsm = new DictationFSM();
    const s1 = fsm.startDictation({ chatId: "chat_1" });
    fsm.cancelDictation(s1);

    const s2 = fsm.startDictation({ chatId: "chat_1" });
    fsm.cancelDictation(s2);

    const s3 = fsm.startDictation({ chatId: "chat_1" });
    fsm.cancelDictation(s3);

    assert.notEqual(s1, s2);
    assert.notEqual(s2, s3);
    assert.ok(s1.startsWith("session_"));
    assert.ok(s2.startsWith("session_"));
  });

  await t.test("starting a new session cleanly cancels any prior unfinalized session", () => {
    const fsm = new DictationFSM();
    const s1 = fsm.startDictation({ chatId: "chat_1" });
    fsm.dispatchBridgeEvent(s1, "chat_1", "P", "unfinalized speech");

    // Starting new session s2
    const s2 = fsm.startDictation({ chatId: "chat_1" });
    assert.notEqual(s1, s2);
    assert.equal(fsm.sessionId, s2);
    assert.equal(fsm.buffer, "");
    assert.equal(fsm.partialText, "");
  });

  await t.test("discards late callbacks from previous stale sessions (Late Callback Isolation)", () => {
    const fsm = new DictationFSM();
    const sidActive = fsm.startDictation({ chatId: "chat_1" });

    // Simulate delayed callback from dead session
    fsm.dispatchBridgeEvent("stale_session_uuid", "chat_1", "F", "Spurious ghost phrase");
    fsm.dispatchBridgeEvent("stale_session_uuid", "chat_1", "P", "Spurious interim");

    assert.equal(fsm.buffer, "");
    assert.equal(fsm.partialText, "");

    // Valid callback for active session works
    fsm.dispatchBridgeEvent(sidActive, "chat_1", "F", "Legitimate phrase");
    assert.equal(fsm.buffer, "Legitimate phrase");
  });

  await t.test("discards events with mismatched chatId (Cross-Chat Isolation)", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "chat_alpha" });

    // Event directed to chat_beta
    fsm.dispatchBridgeEvent(sid, "chat_beta", "F", "Leaked chat text");
    fsm.dispatchBridgeEvent(sid, "chat_beta", "P", "Leaked partial");

    assert.equal(fsm.buffer, "");
    assert.equal(fsm.partialText, "");
  });

  await t.test("discards events when FSM is not in recording or processing state", () => {
    const fsm = new DictationFSM();
    // In idle state
    fsm.dispatchBridgeEvent("session_any", "chat_any", "F", "Random text");
    assert.equal(fsm.buffer, "");
    assert.equal(fsm.state, "idle");
  });
});

// ============================================================================
// Suite 4: Separate Stop vs Cancel Semantics (F9)
// ============================================================================
test("Dictation Semantics: Strict Stop (Commit) vs Cancel (0 Characters) Separation", async (t) => {
  await t.test("stopDictation flushes partial and buffered text, emits onFinal, resolves Promise", async () => {
    const fsm = new DictationFSM();
    let finalReceived = "";
    fsm.onFinal = (text) => { finalReceived = text; };

    const sid = fsm.startDictation({ chatId: "c_stop" });
    fsm.dispatchBridgeEvent(sid, "c_stop", "F", "Good morning");
    fsm.dispatchBridgeEvent(sid, "c_stop", "P", "everyone");

    const committed = await fsm.stopDictation(sid);
    assert.equal(committed, "Good morning everyone");
    assert.equal(finalReceived, "Good morning everyone");
    assert.equal(fsm.state, "idle");
  });

  await t.test("stopDictation on idle returns empty string without error", async () => {
    const fsm = new DictationFSM();
    const result = await fsm.stopDictation();
    assert.equal(result, "");
    assert.equal(fsm.state, "idle");
  });

  await t.test("cancelDictation guarantees EXACTLY zero characters committed", () => {
    const fsm = new DictationFSM();
    let finalWasEmitted = false;
    fsm.onFinal = () => { finalWasEmitted = true; };

    const sid = fsm.startDictation({ chatId: "c_cancel" });
    fsm.dispatchBridgeEvent(sid, "c_cancel", "F", "Confidential text that must not be committed");
    fsm.dispatchBridgeEvent(sid, "c_cancel", "P", "trailing partial");

    fsm.cancelDictation(sid);

    assert.equal(fsm.buffer, "", "Buffer must be purged to empty string");
    assert.equal(fsm.partialText, "", "Partial text must be purged to empty string");
    assert.equal(finalWasEmitted, false, "onFinal must NEVER be emitted on cancel");
    assert.equal(fsm.state, "idle");
  });

  await t.test("cancelDictation with mismatched sessionId is ignored", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "c_test" });
    fsm.dispatchBridgeEvent(sid, "c_test", "F", "Keep this text");

    fsm.cancelDictation("wrong_session_id");

    assert.equal(fsm.state, "recording");
    assert.equal(fsm.buffer, "Keep this text");
  });

  await t.test("calling stopDictation on already cancelled session rejects", async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "c_canc" });
    fsm.transitionTo("cancelled");

    await assert.rejects(
      () => fsm.stopDictation(sid),
      /Session was cancelled/
    );
  });
});

// ============================================================================
// Suite 5: Continuous Speech Immunity & Silence Tag "X" (F10)
// ============================================================================
test("Dictation Resilience: Continuous Mode Speech Cut-Off Immunity (>5s to >60s)", async (t) => {
  await t.test("continuous option defaults to true", () => {
    const fsm = new DictationFSM();
    assert.equal(fsm.continuous, true);
    const sid = fsm.startDictation({ chatId: "c1" });
    assert.equal(fsm.continuous, true);
  });

  await t.test("silence tag 'X' in continuous mode retains recording state and flushes partial", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "c1", continuous: true });

    fsm.dispatchBridgeEvent(sid, "c1", "P", "phrase before pause");
    assert.equal(fsm.partialText, "phrase before pause");

    // Android SpeechRecognizer emits 'X' upon 1.5-2.0s pause
    fsm.dispatchBridgeEvent(sid, "c1", "X");

    assert.equal(fsm.state, "recording", "Must stay in recording state after silence event");
    assert.equal(fsm.buffer, "phrase before pause", "Interim partial must be committed to buffer");
    assert.equal(fsm.partialText, "", "Partial text must be reset");
  });

  await t.test("simulates 60+ seconds of continuous speech across 5 speech pauses", async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "long_chat", continuous: true });

    const speechSegments = [
      "Leostryx continuous audio session initialized.",
      "First pause of two seconds occurred here.",
      "Continuing speech without mic disconnecting.",
      "Past thirty seconds marker with fourth sentence.",
      "Sixty seconds continuous dictation test completed successfully."
    ];

    for (let i = 0; i < speechSegments.length; i++) {
      fsm.dispatchBridgeEvent(sid, "long_chat", "F", speechSegments[i]);
      fsm.dispatchBridgeEvent(sid, "long_chat", "X"); // silence endpointing event
      assert.equal(fsm.state, "recording", `Segment ${i + 1} must remain in recording state`);
    }

    const committed = await fsm.stopDictation(sid);
    assert.equal(committed, speechSegments.join(" "));
    assert.equal(fsm.state, "idle");
  });

  await t.test("one-shot mode (continuous: false) stops recording upon silence tag 'X'", async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "oneshot_chat", continuous: false });

    fsm.dispatchBridgeEvent(sid, "oneshot_chat", "F", "Single short utterance.");
    fsm.dispatchBridgeEvent(sid, "oneshot_chat", "X");

    // In one-shot mode, 'X' immediately stops dictation
    assert.equal(fsm.state, "idle");
    assert.equal(fsm.buffer, "Single short utterance.");
  });
});

// ============================================================================
// Suite 6: Resource Cleanup & Lifecycle (F11)
// ============================================================================
test("Dictation Lifecycle: Immediate Resource Cleanup on App Events", async (t) => {
  await t.test("cleanupOnChatSwitch cancels recording and frees session immediately", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "chat_alpha" });
    fsm.dispatchBridgeEvent(sid, "chat_alpha", "P", "interim in chat alpha");

    fsm.cleanupOnChatSwitch("chat_beta");

    assert.equal(fsm.state, "idle");
    assert.equal(fsm.buffer, "");
    assert.equal(fsm.partialText, "");
  });

  await t.test("cleanupOnChatSwitch with same chatId does NOT cancel session", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "chat_alpha" });
    fsm.dispatchBridgeEvent(sid, "chat_alpha", "F", "Still here");

    fsm.cleanupOnChatSwitch("chat_alpha");

    assert.equal(fsm.state, "recording");
    assert.equal(fsm.buffer, "Still here");
  });

  await t.test("cleanupOnVisibilityChange(hidden=true) cancels recording immediately", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "chat_vis" });
    assert.equal(fsm.state, "recording");

    fsm.cleanupOnVisibilityChange(true);

    assert.equal(fsm.state, "idle");
    assert.equal(fsm.buffer, "");
  });

  await t.test("cleanupOnVisibilityChange(hidden=false) preserves recording", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "chat_vis" });

    fsm.cleanupOnVisibilityChange(false);

    assert.equal(fsm.state, "recording");
  });

  await t.test("destroy terminates active session and prevents future sessions", async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "chat_destroy" });
    fsm.destroy();

    assert.equal(fsm.destroyed, true);
    assert.equal(fsm.state, "idle");

    // Subsequent startDictation must throw
    assert.throws(
      () => fsm.startDictation({ chatId: "new_chat" }),
      /Dictation manager is destroyed/
    );

    // Subsequent stopDictation must reject
    await assert.rejects(
      () => fsm.stopDictation(sid),
      /Destroyed/
    );
  });
});

// ============================================================================
// Suite 7: Static Source Verification of main.js
// ============================================================================
test("main.js Verification: Continuous parameter supplied to dO", () => {
  const mainJsPath = path.join(REPO_ROOT, "app/assets/web/generated/main.js");
  const content = fs.readFileSync(mainJsPath, "utf-8");

  // Verify dO default parameter exists
  assert.ok(content.includes("continuous:e=!1"), "dO function signature must define continuous:e=!1");

  // Verify AgentInputBox invokes dO with continuous:!0
  const match = content.match(/dO\(\{editorRef:kc,cascadeId:O,logEvent:ob,continuous:!0\}\)/);
  assert.ok(match, "AgentInputBox at line 11437 must pass continuous:!0 to dO");
});
