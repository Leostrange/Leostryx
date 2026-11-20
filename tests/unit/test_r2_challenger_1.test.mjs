import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

// Load agy_dictation module
const dictationPath = path.join(REPO_ROOT, "app/assets/web/agy_dictation.js");
const dictModule = await import("file://" + dictationPath);
const { DictationFSM, AgyDictation } = (
  dictModule.default?.DictationFSM ? dictModule.default : dictModule
);

// All 7 FSM States
const ALL_STATES = ['idle', 'preparing', 'recording', 'processing', 'ready', 'cancelled', 'error'];

// Expected Valid Transitions mapping
const EXPECTED_VALID_TRANSITIONS = {
  idle: ['preparing', 'error'],
  preparing: ['recording', 'cancelled', 'error'],
  recording: ['processing', 'cancelled', 'error'],
  processing: ['ready', 'cancelled', 'error'],
  ready: ['idle'],
  cancelled: ['idle'],
  error: ['idle']
};

// ============================================================================
// Suite 1: Full 7x7 Transition Matrix Verification (49 Transitions)
// ============================================================================
test("Challenger 1 - Full 7x7 FSM Transition Matrix (49 pairs)", async (t) => {
  let validCount = 0;
  let invalidCount = 0;

  for (const fromState of ALL_STATES) {
    for (const toState of ALL_STATES) {
      const isValid = EXPECTED_VALID_TRANSITIONS[fromState].includes(toState);

      if (isValid) {
        validCount++;
        await t.test(`VALID transition: ${fromState} -> ${toState}`, () => {
          const fsm = new DictationFSM();
          fsm.state = fromState;

          // Perform valid transition
          fsm.transitionTo(toState, { testDetail: "ok" });
          assert.equal(fsm.state, toState, `FSM state must update to ${toState}`);
          
          const lastHistory = fsm.history[fsm.history.length - 1];
          assert.ok(lastHistory, "History record must be created");
          assert.equal(lastHistory.from, fromState);
          assert.equal(lastHistory.to, toState);
          assert.equal(lastHistory.testDetail, "ok");
        });
      } else {
        invalidCount++;
        await t.test(`INVALID transition: ${fromState} -> ${toState} throws error`, () => {
          const fsm = new DictationFSM();
          fsm.state = fromState;

          const historyLengthBefore = fsm.history.length;
          assert.throws(
            () => fsm.transitionTo(toState),
            new RegExp(`Invalid state transition from ${fromState} to ${toState}`),
            `Transition ${fromState} -> ${toState} must throw specific Invalid state transition error`
          );
          assert.equal(fsm.state, fromState, `State must remain ${fromState} when transition throws`);
          assert.equal(fsm.history.length, historyLengthBefore, "History must not record rejected transition");
        });
      }
    }
  }

  await t.test("Matrix completeness check (14 valid + 35 invalid = 49 total)", () => {
    assert.equal(validCount, 14, "Must have exactly 14 valid transitions");
    assert.equal(invalidCount, 35, "Must have exactly 35 invalid transitions");
    assert.equal(validCount + invalidCount, 49, "Total matrix size must be exactly 49");
  });

  await t.test("Invalid / non-existent target states throw error", () => {
    const fsm = new DictationFSM();
    for (const invalidTarget of ["non_existent", null, undefined, 123, {}, []]) {
      assert.throws(
        () => fsm.transitionTo(invalidTarget),
        /Invalid state transition/,
        `Transitioning to ${invalidTarget} must throw`
      );
    }
  });

  await t.test("Transition from corrupted / invalid state throws error", () => {
    const fsm = new DictationFSM();
    fsm.state = "corrupted_state";
    assert.throws(
      () => fsm.transitionTo("idle"),
      /Invalid state transition from corrupted_state to idle/
    );
  });
});

// ============================================================================
// Suite 2: Continuous Speech (>30 Seconds) with Silence Pauses ("X" Events)
// ============================================================================
test("Challenger 1 - Continuous Speech (>30 Seconds) and Silence Pause Immunity", async (t) => {
  await t.test("speech >30 seconds across 6 silence pauses never cuts off prematurely", async () => {
    const fsm = new DictationFSM({ continuous: true });
    let stateChanges = [];
    fsm.onStateChange = (next, prev) => stateChanges.push({ from: prev, to: next });

    const sid = fsm.startDictation({ chatId: "long_chat", continuous: true });
    assert.equal(fsm.state, "recording");
    assert.equal(fsm.isRecording(), true);

    // Timeline simulation: 35 seconds of speech with silence gaps every ~5 seconds
    const timeline = [
      { time: 1.0, tag: "P", text: "Сегодня" },
      { time: 2.0, tag: "F", text: "Сегодня мы проверяем" },
      { time: 2.5, tag: "X", text: "" }, // 1st silence pause (previously died here at 2s!)
      { time: 5.5, tag: "P", text: "надежность" },
      { time: 7.0, tag: "F", text: "надежность системы диктовки" },
      { time: 8.0, tag: "X", text: "" }, // 2nd silence pause
      { time: 12.0, tag: "P", text: "в условиях" },
      { time: 14.5, tag: "F", text: "в условиях длительных пауз речи" },
      { time: 15.0, tag: "X", text: "" }, // 3rd silence pause
      { time: 20.0, tag: "P", text: "сессия" },
      { time: 22.0, tag: "F", text: "сессия обязана оставаться активной" },
      { time: 23.0, tag: "X", text: "" }, // 4th silence pause
      { time: 27.0, tag: "P", text: "более" },
      { time: 29.5, tag: "F", text: "более тридцати секунд" },
      { time: 30.0, tag: "X", text: "" }, // 5th silence pause (>30s reached!)
      { time: 33.0, tag: "P", text: "успешно" },
      { time: 34.5, tag: "F", text: "успешно подтверждено" },
      { time: 35.0, tag: "X", text: "" }  // 6th silence pause
    ];

    for (const step of timeline) {
      fsm.dispatchBridgeEvent(sid, "long_chat", step.tag, step.text);

      // Invariant: FSM MUST remain in 'recording' state throughout the speech & pauses
      assert.equal(
        fsm.state,
        "recording",
        `At simulated time ${step.time}s after event '${step.tag}', state must remain 'recording'`
      );
      assert.equal(
        fsm.isRecording(),
        true,
        `At simulated time ${step.time}s, isRecording() must remain true`
      );
    }

    // Stop session at t=35s
    const finalCommitted = await fsm.stopDictation(sid);
    const expected = "Сегодня мы проверяем надежность системы диктовки в условиях длительных пауз речи сессия обязана оставаться активной более тридцати секунд успешно подтверждено";

    assert.equal(finalCommitted, expected, "All 6 spoken phrases must be stitched with single spaces");
    assert.equal(fsm.state, "idle");
    assert.equal(fsm.isRecording(), false);

    // Verify state transition history: exactly one idle->preparing->recording at start, then recording->processing->ready->idle at end
    const names = stateChanges.map(sc => `${sc.from}->${sc.to}`);
    assert.deepEqual(names, [
      "idle->preparing",
      "preparing->recording",
      "recording->processing",
      "processing->ready",
      "ready->idle"
    ]);
  });

  await t.test("rapid silence bounce debounce loop (10 'X' events in 20ms)", async () => {
    let reprimeCount = 0;
    const mockEngine = {
      start: () => { reprimeCount++; return "OK"; },
      stop: () => {},
      pollStt: () => ""
    };

    const prevWindow = global.window;
    global.window = { AgySTT: mockEngine };
    try {
      const fsm = new DictationFSM({ continuous: true });
      const sid = fsm.startDictation({ chatId: "debounce_chat", continuous: true });
      fsm.curEng = mockEngine;
      reprimeCount = 0; // Reset after initial hardware start

      // Fire 10 rapid silence events
      for (let i = 0; i < 10; i++) {
        fsm.dispatchBridgeEvent(sid, "debounce_chat", "X", "");
      }

      assert.ok(fsm.reprimeTimer !== null, "Reprime debounce timer must be armed");
      assert.equal(reprimeCount, 0, "Reprime must not have fired synchronously");

      // Wait for 80ms debounce to expire
      await new Promise(resolve => setTimeout(resolve, 85));

      assert.equal(reprimeCount, 1, "Debounced reprime must fire exactly once despite 10 rapid 'X' events");
      assert.equal(fsm.state, "recording", "FSM must remain in recording state");

      await fsm.stopDictation(sid);
    } finally {
      global.window = prevWindow;
    }
  });

  await t.test("contrast: one-shot mode (continuous: false) stops on first silence 'X'", async () => {
    const fsm = new DictationFSM({ continuous: false });
    const sid = fsm.startDictation({ chatId: "oneshot_chat", continuous: false });
    
    fsm.dispatchBridgeEvent(sid, "oneshot_chat", "F", "Короткая фраза");
    assert.equal(fsm.state, "recording");

    // Silence arrives
    fsm.dispatchBridgeEvent(sid, "oneshot_chat", "X", "");

    // Must transition to idle immediately
    assert.equal(fsm.state, "idle");
    assert.equal(fsm.isRecording(), false);
    assert.equal(fsm.buffer, "Короткая фраза");
  });
});

// ============================================================================
// Suite 3: Chat Switching & Session Isolation Adversarial Challenge
// ============================================================================
test("Challenger 1 - Chat Switching & Stale Event Isolation (Zero Character Leakage)", async (t) => {
  await t.test("chat switch immediately cancels active session and purges buffer", () => {
    const fsm = new DictationFSM();
    let finalEmitted = false;
    fsm.onFinal = () => { finalEmitted = true; };

    const sidA = fsm.startDictation({ chatId: "chat_alpha" });
    fsm.dispatchBridgeEvent(sidA, "chat_alpha", "F", "Секретные данные альфа");
    fsm.dispatchBridgeEvent(sidA, "chat_alpha", "P", "незавершенная мысль");

    assert.equal(fsm.buffer, "Секретные данные альфа");
    assert.equal(fsm.partialText, "незавершенная мысль");

    // Chat switch to chat_beta
    fsm.cleanupOnChatSwitch("chat_beta");

    // Must be cancelled and idle
    assert.equal(fsm.state, "idle", "FSM must be idle after chat switch");
    assert.equal(fsm.isRecording(), false);
    assert.equal(fsm.buffer, "", "Buffer must be purged to empty string");
    assert.equal(fsm.partialText, "", "Partial text must be purged to empty string");
    assert.equal(finalEmitted, false, "onFinal must NEVER be called on chat switch");
  });

  await t.test("zero characters leak into new chat from prior session callbacks", async () => {
    const fsm = new DictationFSM();
    const chatAlphaCommitted = [];
    const chatBetaCommitted = [];

    // Session A in Chat Alpha
    fsm.onFinal = (txt) => chatAlphaCommitted.push(txt);
    const sidAlpha = fsm.startDictation({ chatId: "chat_alpha" });
    fsm.dispatchBridgeEvent(sidAlpha, "chat_alpha", "F", "Alpha speech chunk 1");

    // User switches to Chat Beta
    fsm.cleanupOnChatSwitch("chat_beta");
    assert.equal(fsm.state, "idle");

    // Now adversary/system sends late callbacks from dead Session Alpha
    fsm.dispatchBridgeEvent(sidAlpha, "chat_alpha", "F", "Late Alpha text");
    fsm.dispatchBridgeEvent(sidAlpha, "chat_beta", "F", "Cross-pollinated Alpha text to Beta");
    fsm.dispatchBridgeEvent(sidAlpha, "chat_beta", "P", "Partial leak");

    // Invariant: no text was committed, buffer is empty
    assert.equal(fsm.buffer, "");
    assert.equal(fsm.partialText, "");
    assert.deepEqual(chatAlphaCommitted, []);

    // Now start legitimate dictation in Chat Beta
    fsm.onFinal = (txt) => chatBetaCommitted.push(txt);
    const sidBeta = fsm.startDictation({ chatId: "chat_beta" });
    assert.notEqual(sidBeta, sidAlpha, "Must generate unique new sessionId");

    // More late callbacks from old session A attempt to inject into active session B
    fsm.dispatchBridgeEvent(sidAlpha, "chat_beta", "F", "Malicious late chunk from session A");
    fsm.dispatchBridgeEvent(sidBeta, "chat_alpha", "F", "Malicious mismatched chatId chunk");
    assert.equal(fsm.buffer, "", "Buffer must reject events from mismatched session or chat");

    // Send legitimate speech for Chat Beta
    fsm.dispatchBridgeEvent(sidBeta, "chat_beta", "F", "Legitimate beta message");
    const betaResult = await fsm.stopDictation(sidBeta);

    assert.equal(betaResult, "Legitimate beta message");
    assert.deepEqual(chatBetaCommitted, ["Legitimate beta message"]);
    assert.deepEqual(chatAlphaCommitted, [], "Chat Alpha must have 0 committed characters");
  });

  await t.test("app backgrounding (visibilitychange) triggers zero-leak cleanup", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "chat_bg" });
    fsm.dispatchBridgeEvent(sid, "chat_bg", "F", "Speech before backgrounding");

    // App goes to background
    fsm.cleanupOnVisibilityChange(true);

    assert.equal(fsm.state, "idle");
    assert.equal(fsm.buffer, "");
    assert.equal(fsm.partialText, "");

    // Events after backgrounding are dropped
    fsm.dispatchBridgeEvent(sid, "chat_bg", "F", "Speech after backgrounding");
    assert.equal(fsm.buffer, "");
  });
});

// ============================================================================
// Suite 4: Race Conditions & Asynchronous Chaos / Spam Harness
// ============================================================================
test("Challenger 1 - Chaos Harness & Async Race Condition Stress-Testing", async (t) => {
  await t.test("synchronous random spam of 300 FSM control operations maintains state invariants", () => {
    const fsm = new DictationFSM();
    const chats = ["chat_1", "chat_2", "chat_3"];
    const tags = ["P", "F", "X", "E", "R", "B", "unknown"];

    for (let i = 0; i < 300; i++) {
      const op = Math.floor(Math.random() * 8);

      try {
        switch (op) {
          case 0:
            fsm.startDictation({ chatId: chats[i % chats.length] });
            break;
          case 1:
            fsm.stopDictation(fsm.sessionId);
            break;
          case 2:
            fsm.cancelDictation(fsm.sessionId);
            break;
          case 3:
            fsm.dispatchBridgeEvent(
              fsm.sessionId,
              fsm.chatId,
              tags[i % tags.length],
              `text_${i}`
            );
            break;
          case 4:
            fsm.cleanupOnChatSwitch(chats[(i + 1) % chats.length]);
            break;
          case 5:
            fsm.cleanupOnVisibilityChange(i % 2 === 0);
            break;
          case 6:
            // Stale cancellation
            fsm.cancelDictation("stale_session_xyz");
            break;
          case 7:
            // Query status
            fsm.getStatus();
            fsm.isRecording();
            break;
        }
      } catch (err) {
        // Only valid transition errors or expected exceptions are acceptable
        assert.ok(
          err.message.includes("Invalid state transition") || err.message.includes("Session mismatch"),
          `Unexpected exception during chaos spam: ${err.message}`
        );
      }

      // Invariant 1: State must ALWAYS be one of the 7 valid FSM states
      assert.ok(
        ALL_STATES.includes(fsm.state),
        `FSM state '${fsm.state}' is corrupted! Must be one of ${ALL_STATES.join(", ")}`
      );

      // Invariant 2: isRecording() must strictly match state
      const expectedRecording = (fsm.state === 'recording' || fsm.state === 'preparing' || fsm.state === 'processing');
      assert.equal(
        fsm.isRecording(),
        expectedRecording,
        `isRecording() (${fsm.isRecording()}) does not match state '${fsm.state}'`
      );
    }

    // Clean up to idle at end
    fsm.cancelDictation(fsm.sessionId);
    assert.equal(fsm.state, "idle");
  });

  await t.test("concurrent asynchronous race of 100 interleaved operations", async () => {
    const fsm = new DictationFSM();
    const tasks = [];

    for (let i = 0; i < 100; i++) {
      const action = i % 5;
      tasks.push(
        (async () => {
          if (action === 0) {
            try {
              fsm.startDictation({ chatId: `c_${i}` });
            } catch (e) {}
          } else if (action === 1) {
            try {
              await fsm.stopDictation(fsm.sessionId);
            } catch (e) {}
          } else if (action === 2) {
            fsm.cancelDictation(fsm.sessionId);
          } else if (action === 3) {
            fsm.dispatchBridgeEvent(fsm.sessionId, fsm.chatId, "P", `p_${i}`);
          } else {
            fsm.dispatchBridgeEvent(fsm.sessionId, fsm.chatId, "F", `f_${i}`);
          }
        })()
      );
    }

    const results = await Promise.allSettled(tasks);
    assert.equal(results.filter(r => r.status === "rejected").length, 0, "No async promises should ungracefully reject");

    // Verify recovery
    fsm.cancelDictation(fsm.sessionId);
    assert.equal(fsm.state, "idle");
  });

  await t.test("immediate stopDictation (0ms latency after startDictation)", async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "rapid_stop" });
    
    // Immediately stop before any bridge events or timers
    const res = await fsm.stopDictation(sid);
    assert.equal(res, "");
    assert.equal(fsm.state, "idle");
  });

  await t.test("immediate cancelDictation (0ms latency after startDictation)", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "rapid_cancel" });
    
    fsm.cancelDictation(sid);
    assert.equal(fsm.state, "idle");
    assert.equal(fsm.buffer, "");
  });

  await t.test("stale stopDictation on replaced session is rejected and preserves new session", async () => {
    const fsm = new DictationFSM();
    const sid1 = fsm.startDictation({ chatId: "session_1" });
    fsm.dispatchBridgeEvent(sid1, "session_1", "F", "Text 1");

    // Session 2 replaces Session 1
    const sid2 = fsm.startDictation({ chatId: "session_2" });
    fsm.dispatchBridgeEvent(sid2, "session_2", "F", "Text 2");

    // Call stopDictation on sid1
    await assert.rejects(
      async () => await fsm.stopDictation(sid1),
      new RegExp(`Session mismatch: active is ${sid2}`)
    );

    // Session 2 must remain healthy and active
    assert.equal(fsm.state, "recording");
    assert.equal(fsm.sessionId, sid2);
    assert.equal(fsm.buffer, "Text 2");

    // Finish session 2 normally
    const res2 = await fsm.stopDictation(sid2);
    assert.equal(res2, "Text 2");
    assert.equal(fsm.state, "idle");
  });

  await t.test("re-entrant callbacks from onStateChange and onPartial execute safely", async () => {
    const fsm = new DictationFSM();
    let reentered = false;

    fsm.onPartial = (partial, sessId) => {
      if (partial === "trigger_cancel" && !reentered) {
        reentered = true;
        // Re-entrant cancellation inside event callback
        fsm.cancelDictation(sessId);
      }
    };

    const sid = fsm.startDictation({ chatId: "reentrant_chat" });
    fsm.dispatchBridgeEvent(sid, "reentrant_chat", "P", "trigger_cancel");

    assert.equal(reentered, true);
    assert.equal(fsm.state, "idle");
    assert.equal(fsm.buffer, "");
  });
});

// ============================================================================
// Suite 5: Security, Invariants and Boundary Edge Cases
// ============================================================================
test("Challenger 1 - Security, Invariants & Boundary Defenses", async (t) => {
  await t.test("handles 5,000 rapid partial events without memory leak (O(1) partial memory)", () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "mem_chat" });

    for (let i = 0; i < 5000; i++) {
      fsm.dispatchBridgeEvent(sid, "mem_chat", "P", `partial_${i}`);
    }

    // Partial text should be only the last partial, not concatenated
    assert.equal(fsm.partialText, "partial_4999");
    assert.equal(fsm.buffer, "");

    fsm.cancelDictation(sid);
  });

  await t.test("handles massive final transcript (500 KB single chunk)", async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "large_chat" });

    const largeChunk = "word ".repeat(100000).trim(); // ~500 KB
    fsm.dispatchBridgeEvent(sid, "large_chat", "F", largeChunk);

    assert.equal(fsm.buffer.length, largeChunk.length);
    const committed = await fsm.stopDictation(sid);
    assert.equal(committed.length, largeChunk.length);
  });

  await t.test("defensive handling of null and undefined in public methods", async () => {
    const fsm = new DictationFSM();

    // cancelDictation with undefined / null
    assert.doesNotThrow(() => fsm.cancelDictation(undefined));
    assert.doesNotThrow(() => fsm.cancelDictation(null));

    // stopDictation on idle with null
    const res = await fsm.stopDictation(null);
    assert.equal(res, "");

    // dispatchBridgeEvent with null/undefined arguments
    assert.doesNotThrow(() => fsm.dispatchBridgeEvent(null, null, null, null));
    assert.doesNotThrow(() => fsm.dispatchBridgeEvent(undefined, undefined, undefined, undefined));

    // cleanup methods with null
    assert.doesNotThrow(() => fsm.cleanupOnChatSwitch(null));
    assert.doesNotThrow(() => fsm.cleanupOnVisibilityChange(null));
  });

  await t.test("destroyed manager strictly refuses all new operations", async () => {
    const fsm = new DictationFSM();
    fsm.destroy();

    assert.equal(fsm.destroyed, true);
    assert.equal(fsm.state, "idle");

    // startDictation throws
    assert.throws(
      () => fsm.startDictation({ chatId: "c_dest" }),
      /Dictation manager is destroyed/
    );

    // stopDictation rejects
    await assert.rejects(
      async () => await fsm.stopDictation("any_sid"),
      /Destroyed/
    );

    // cancelDictation is no-op
    assert.doesNotThrow(() => fsm.cancelDictation("any_sid"));

    // dispatchBridgeEvent is no-op
    assert.doesNotThrow(() => fsm.dispatchBridgeEvent("any_sid", "c_dest", "F", "text"));
    assert.equal(fsm.buffer, "");
  });
});
