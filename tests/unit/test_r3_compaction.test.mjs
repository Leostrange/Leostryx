import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

// Load agy_compactor module
const compactorPath = path.join(REPO_ROOT, "app/assets/web/agy_compactor.js");
const compactorModule = await import("file://" + compactorPath).then(m => m.default || m);
const {
  CompactionManager,
  AgyCompactor,
  isContextOverflowError,
  slicePromptHistory,
  extractEntryId,
  sanitizeToolOutputs,
  SUMMARY_HEADER,
  SUMMARY_ACK,
  SUMMARY_ACK_RU,
  DEFAULT_THRESHOLD,
  DEFAULT_KEEP_RECENT,
  EMERGENCY_KEEP_RECENT,
  DEFAULT_CHAR_LIMIT,
  MAX_TOOL_OUTPUT_CHARS,
  EMERGENCY_TOOL_OUTPUT_CHARS,
  STORAGE_KEY_PREFIX
} = compactorModule;

// Load agy_gateway module to verify interface contracts & delegation
const gatewayPath = path.join(REPO_ROOT, "app/assets/web/agy_gateway.js");
const gatewayModule = await import("file://" + gatewayPath).then(m => m.default || m);

// Helper: In-memory mock localStorage
function createMockStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(String(key)) || null,
    setItem: (key, val) => store.set(String(key), String(val)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear(),
    _store: store
  };
}

// ============================================================================
// Suite 1: Contract, Public Exports, and Constants Verification
// ============================================================================
test("Suite 1: Compaction Module Contract & Public Interface Exports", async (t) => {
  await t.test("exports CompactionManager class and singleton AgyCompactor", () => {
    assert.equal(typeof CompactionManager, "function");
    assert.ok(AgyCompactor instanceof CompactionManager);
    assert.equal(typeof isContextOverflowError, "function");
    assert.equal(typeof slicePromptHistory, "function");
    assert.equal(typeof extractEntryId, "function");
    assert.equal(typeof sanitizeToolOutputs, "function");
  });

  await t.test("exports core protocol constants", () => {
    assert.equal(SUMMARY_HEADER, "### Previous Conversation Summary");
    assert.ok(SUMMARY_ACK.includes("Understood. I will continue the conversation"));
    assert.ok(SUMMARY_ACK_RU.includes("Контекст предыдущих этапов задачи принят"));
    assert.equal(DEFAULT_THRESHOLD, 16);
    assert.equal(DEFAULT_KEEP_RECENT, 8);
    assert.equal(EMERGENCY_KEEP_RECENT, 4);
    assert.equal(DEFAULT_CHAR_LIMIT, 80000);
    assert.equal(MAX_TOOL_OUTPUT_CHARS, 8000);
    assert.equal(EMERGENCY_TOOL_OUTPUT_CHARS, 2000);
    assert.equal(STORAGE_KEY_PREFIX, "agy_compaction_");
  });

  await t.test("AgyGateway exposes compaction delegates conforming to PROJECT.md", () => {
    assert.equal(typeof gatewayModule.isContextOverflowError, "function");
    assert.equal(typeof gatewayModule.slicePromptHistory, "function");
    assert.equal(typeof gatewayModule.handleOverflowRecovery, "function");
    assert.ok(gatewayModule.CompactionManager === CompactionManager);
    assert.ok(gatewayModule.AgyCompactor === AgyCompactor);
  });
});

// ============================================================================
// Suite 2: Feature F12 — Compaction State Persistence & Branch Isolation
// ============================================================================
test("Suite 2: Feature F12 — Compaction State Persistence & Storage Isolation", async (t) => {
  await t.test("persists firstKeptEntryId, summary, tokens saved, and compactedAt", () => {
    const mgr = new CompactionManager();
    const now = Date.now();
    const record = mgr.saveCompactionState("main", {
      firstKeptEntryId: "entry_turn_5",
      summary: "Refactored authentication controller",
      estimatedTokensSaved: 14500
    });

    assert.equal(record.firstKeptEntryId, "entry_turn_5");
    assert.equal(record.summary, "Refactored authentication controller");
    assert.equal(record.estimatedTokensSaved, 14500);
    assert.ok(record.compactedAt >= now);

    const retrieved = mgr.getCompactionState("main");
    assert.deepEqual(retrieved, record);
  });

  await t.test("coerces estimatedTokensSaved to numeric value and provides empty summary default", () => {
    const mgr = new CompactionManager();
    const record = mgr.saveCompactionState("branch_abc", {
      firstKeptEntryId: "msg_99",
      estimatedTokensSaved: "32000"
    });
    assert.equal(record.estimatedTokensSaved, 32000);
    assert.equal(record.summary, "");
  });

  await t.test("maintains strict branch isolation across distinct branch identifiers", () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState("branch_feat_1", {
      firstKeptEntryId: "turn_feat_1",
      summary: "Feature 1 summary",
      estimatedTokensSaved: 5000
    });
    mgr.saveCompactionState("branch_feat_2", {
      firstKeptEntryId: "turn_feat_2",
      summary: "Feature 2 summary",
      estimatedTokensSaved: 12000
    });

    const b1 = mgr.getCompactionState("branch_feat_1");
    const b2 = mgr.getCompactionState("branch_feat_2");

    assert.equal(b1.firstKeptEntryId, "turn_feat_1");
    assert.equal(b1.estimatedTokensSaved, 5000);
    assert.equal(b2.firstKeptEntryId, "turn_feat_2");
    assert.equal(b2.estimatedTokensSaved, 12000);
    assert.notEqual(b1.summary, b2.summary);
  });

  await t.test("synchronizes state with localStorage under agy_compaction_<chatId> key", () => {
    const mockStorage = createMockStorage();
    CompactionManager.setStorage(mockStorage);

    try {
      const mgr = new CompactionManager({ chatId: "chat_uuid_101" });
      mgr.saveCompactionState("branch_main", {
        firstKeptEntryId: "turn_7",
        summary: "Setup database migrations",
        estimatedTokensSaved: 20000,
        chatId: "chat_uuid_101"
      });

      const rawStored = mockStorage.getItem("agy_compaction_chat_uuid_101");
      assert.ok(rawStored, "Must store under agy_compaction_<chatId>");
      const parsed = JSON.parse(rawStored);
      assert.equal(parsed.firstKeptEntryId, "turn_7");
      assert.equal(parsed.estimatedTokensSaved, 20000);

      // Verify fresh manager instance recovers state from storage
      const freshMgr = new CompactionManager();
      const recovered = freshMgr.loadCompactionState("chat_uuid_101", "branch_main");
      assert.equal(recovered.firstKeptEntryId, "turn_7");
      assert.equal(recovered.summary, "Setup database migrations");
    } finally {
      CompactionManager.setStorage(null);
    }
  });

  await t.test("clearing compaction state purges in-memory and storage records", () => {
    const mockStorage = createMockStorage();
    CompactionManager.setStorage(mockStorage);

    try {
      const mgr = new CompactionManager();
      mgr.saveCompactionState("to_delete", { firstKeptEntryId: "e1" });
      assert.ok(mgr.getCompactionState("to_delete"));
      assert.ok(mockStorage.getItem("agy_compaction_to_delete"));

      mgr.clearCompactionState("to_delete");
      assert.equal(mgr.getCompactionState("to_delete"), null);
      assert.equal(mockStorage.getItem("agy_compaction_to_delete"), null);
    } finally {
      CompactionManager.setStorage(null);
    }
  });

  await t.test("repeated compaction updates overwrite cleanly without stale fragments", () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState("b_repeat", { firstKeptEntryId: "e1", estimatedTokensSaved: 100 });
    mgr.saveCompactionState("b_repeat", { firstKeptEntryId: "e2", estimatedTokensSaved: 500, summary: "Newest" });

    const finalState = mgr.getCompactionState("b_repeat");
    assert.equal(finalState.firstKeptEntryId, "e2");
    assert.equal(finalState.estimatedTokensSaved, 500);
    assert.equal(finalState.summary, "Newest");
  });
});

// ============================================================================
// Suite 3: Feature F13 — Restart & Reload History Slicing (slicePromptHistory)
// ============================================================================
test("Suite 3: Feature F13 — Restart & Reload History Slicing & Boundary Alignment", async (t) => {
  await t.test("slices messages at firstKeptEntryId, excluding pre-compaction entries from prompt", () => {
    const messages = [
      { id: "m1", role: "user", content: "Initial query" },
      { id: "m2", role: "assistant", content: "Initial reply" },
      { id: "m3", role: "user", content: "Second query" },
      { id: "m4", role: "assistant", content: "Second reply" },
      { id: "m5", role: "user", content: "Active query" }
    ];

    const state = {
      firstKeptEntryId: "m3",
      summary: "User started project setup; Assistant gave initial scaffolding."
    };

    const sliced = slicePromptHistory(messages, state);
    const ids = sliced.map(m => m.id).filter(Boolean);

    // m1 and m2 must be pruned; m3, m4, m5 must be kept
    assert.deepEqual(ids, ["m3", "m4", "m5"]);
    assert.ok(!ids.includes("m1"));
    assert.ok(!ids.includes("m2"));
  });

  await t.test("preserves system instructions at index 0 (and contiguous system headers) at prompt head", () => {
    const messages = [
      { id: "sys1", role: "system", content: "You are an expert full-stack developer." },
      { id: "sys2", role: "system", content: "Workspace: /storage/emulated/0/project" },
      { id: "m1", role: "user", content: "Turn 1" },
      { id: "m2", role: "assistant", content: "Turn 2" },
      { id: "m3", role: "user", content: "Turn 3" }
    ];

    const state = {
      firstKeptEntryId: "m3",
      summary: "Turns 1 and 2 completed."
    };

    const sliced = slicePromptHistory(messages, state);

    assert.equal(sliced[0].role, "system");
    assert.equal(sliced[0].content, "You are an expert full-stack developer.");
    assert.equal(sliced[1].role, "system");
    assert.equal(sliced[1].content, "Workspace: /storage/emulated/0/project");
    assert.equal(sliced[2].role, "user"); // Injected summary
    assert.ok(sliced[2].content.includes("Turns 1 and 2 completed."));
    assert.equal(sliced[3].role, "assistant"); // Summary ACK
    assert.equal(sliced[4].id, "m3"); // Kept tail
  });

  await t.test("injects synthetic user summary and assistant acknowledgement pair", () => {
    const messages = [
      { id: "t1", role: "user", content: "Hello" },
      { id: "t2", role: "user", content: "Current task" }
    ];

    const state = {
      firstKeptEntryId: "t2",
      summary: "User initiated conversation."
    };

    const sliced = slicePromptHistory(messages, state);

    const summaryUserMsg = sliced.find(m => m.role === "user" && m.content.includes("### Previous Conversation Summary"));
    assert.ok(summaryUserMsg, "Must include ### Previous Conversation Summary heading");
    assert.ok(summaryUserMsg.content.includes("User initiated conversation."));

    const ackAssistantMsg = sliced.find(m => m.role === "assistant" && m.content.includes("Understood. I will continue"));
    assert.ok(ackAssistantMsg, "Must include assistant acknowledgement message");
  });

  await t.test("guarantees 100% non-destructive invariant: original messages array is unmodified", () => {
    const originalMessages = [
      { id: "msg_1", role: "user", content: "One" },
      { id: "msg_2", role: "assistant", content: "Two" },
      { id: "msg_3", role: "user", content: "Three" }
    ];
    const snapshot = JSON.stringify(originalMessages);

    const state = { firstKeptEntryId: "msg_3", summary: "Summary" };
    const sliced = slicePromptHistory(originalMessages, state);

    assert.equal(JSON.stringify(originalMessages), snapshot, "Original messages must remain strictly untouched");
    assert.notEqual(sliced, originalMessages, "Sliced must be a new array");
    assert.equal(originalMessages.length, 3);
  });

  await t.test("boundary alignment: advances to user turn if firstKeptEntryId lands on tool message", () => {
    // When prompt slicing happens, if boundary is placed on a tool response,
    // the tool response would lack its preceding assistant tool_calls, causing HTTP 400 from providers.
    const messages = [
      { id: "sys", role: "system", content: "System" },
      { id: "u1", role: "user", content: "Read file" },
      { id: "a1", role: "assistant", content: "Reading", tool_calls: [{ id: "c1" }] },
      { id: "t1", role: "tool", content: "File content 12345", tool_call_id: "c1" },
      { id: "a2", role: "assistant", content: "Done reading" },
      { id: "u2", role: "user", content: "Next step" },
      { id: "a3", role: "assistant", content: "Proceeding" }
    ];

    // Boundary placed on tool message t1
    const state = {
      firstKeptEntryId: "t1",
      summary: "Prior file reading steps"
    };

    const sliced = slicePromptHistory(messages, state);

    // Kept tail must advance to u2 ("Next step") to avoid orphan tool message
    const tailNonSynthetic = sliced.filter(m => m.id);
    assert.equal(tailNonSynthetic[0].id, "sys");
    assert.equal(tailNonSynthetic[1].id, "u2");
    assert.equal(tailNonSynthetic[1].role, "user");
  });

  await t.test("fallback handling: non-existent ID gracefully retains messages without throwing", () => {
    const messages = [
      { id: "u1", role: "user", content: "Hello" },
      { id: "a1", role: "assistant", content: "Hi" }
    ];
    const state = { firstKeptEntryId: "non_existent_uuid", summary: "Summary" };

    const sliced = slicePromptHistory(messages, state);
    assert.ok(Array.isArray(sliced));
    assert.ok(sliced.length > 0);
  });

  await t.test("fallback handling: null/empty compaction state returns shallow copy unchanged", () => {
    const messages = [{ id: "u1", role: "user", content: "Hello" }];
    const sliced = slicePromptHistory(messages, null);
    assert.deepEqual(sliced, messages);
    assert.notEqual(sliced, messages);
  });

  await t.test("resolves turn index tag (turn_N) if explicit uuid is not present", () => {
    const messages = [
      { role: "system", content: "Sys" },
      { role: "user", content: "Query 0" },
      { role: "assistant", content: "Reply 1" },
      { role: "user", content: "Query 2" },
      { role: "assistant", content: "Reply 3" },
      { role: "user", content: "Query 4" }
    ];

    const boundaryTag = extractEntryId(messages[4], 4);
    const state = {
      firstKeptEntryId: boundaryTag,
      summary: "Turns 0-3 summarized."
    };

    const sliced = slicePromptHistory(messages, state);
    assert.equal(sliced[0].role, "system");
    assert.ok(sliced[1].content.includes("Turns 0-3 summarized."));
    assert.equal(sliced[3].content, "Query 4");
  });
});

// ============================================================================
// Suite 4: Feature F14 — Universal Context Overflow Detection Predicate
// ============================================================================
test("Suite 4: Feature F14 — Universal Context Overflow Detection (isContextOverflowError)", async (t) => {
  await t.test("HTTP 413 Payload Too Large is ALWAYS detected as context overflow", () => {
    assert.equal(isContextOverflowError(413, "Payload Too Large"), true);
    assert.equal(isContextOverflowError(413, "<html><body><h1>413 Request Entity Too Large</h1></body></html>"), true);
    assert.equal(isContextOverflowError(413, ""), true);
    assert.equal(isContextOverflowError(413, null), true);
    assert.equal(isContextOverflowError({ status: 413 }), true);
    assert.equal(isContextOverflowError({ statusCode: 413 }), true);
  });

  await t.test("OpenAI / Azure provider overflow error signatures detected under HTTP 400", () => {
    const testCases = [
      { status: 400, body: { error: { code: "context_length_exceeded", message: "This model's maximum context length is 8192 tokens." } } },
      { status: 400, body: { error: { code: "string_above_max_length", message: "String should have at most 1048576 characters." } } },
      { status: 400, body: "prompt is too long: 135000 tokens" },
      { status: 400, body: "Please reduce the length of the messages." },
      { status: 400, body: JSON.stringify({ error: { message: "maximum context length is 128000 tokens. However, your messages resulted in 135400 tokens" } }) }
    ];

    for (const tc of testCases) {
      assert.equal(isContextOverflowError(tc.status, tc.body), true, `Must detect: ${JSON.stringify(tc.body)}`);
      assert.equal(isContextOverflowError(tc), true, `Must detect object overload`);
    }
  });

  await t.test("Anthropic Claude provider overflow error signatures detected under HTTP 400", () => {
    const testCases = [
      { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 220000 tokens > 200000 maximum" } } },
      { status: 400, body: { error: { message: "prompt exceeds the context window" } } },
      { status: 400, body: { error: { code: "request_too_large" } } }
    ];

    for (const tc of testCases) {
      assert.equal(isContextOverflowError(tc.status, tc.body), true);
    }
  });

  await t.test("Google Gemini provider overflow error signatures detected under HTTP 400 / 413", () => {
    const testCases = [
      { status: 400, body: { error: { code: 400, message: "Request payload size exceeds the limit: 20971520 bytes" } } },
      { status: 400, body: { error: { message: "The input token count (1250000) exceeds the maximum number of tokens allowed (1048576)" } } },
      { status: 400, body: "token limit exceeded for model gemini-1.5-pro" }
    ];

    for (const tc of testCases) {
      assert.equal(isContextOverflowError(tc.status, tc.body), true);
    }
  });

  await t.test("Groq, DeepSeek, Mistral, OpenRouter, and Ollama signatures detected", () => {
    const testCases = [
      // Groq
      { status: 400, body: { error: { code: "context_length_exceeded", message: "Request too large for model 'llama-3.1-70b': Limit 8192, Requested 10240" } } },
      // DeepSeek
      { status: 400, body: { error: { message: "Invalid prompt: total tokens (68000) exceeds context window (64000)" } } },
      // Mistral
      { status: 422, body: { message: "Input validation error: total number of tokens 35000 exceeds max allowed tokens 32768" } },
      // OpenRouter
      { status: 400, body: { error: { message: "Provider returned error: context length exceeded" } } },
      // Ollama / llama.cpp HTTP 500 or 400
      { status: 500, body: "prompt tokens (4200) exceed context window (4096)" },
      { status: 400, body: "context length exceeded" }
    ];

    for (const tc of testCases) {
      assert.equal(isContextOverflowError(tc.status, tc.body), true, `Provider test failed for ${tc.status}`);
    }
  });

  await t.test("negative testing: non-overflow errors strictly return false", () => {
    const nonOverflowCases = [
      { status: 401, body: { error: { message: "Incorrect API key provided" } } },
      { status: 404, body: { error: { message: "The model `gpt-5-nonexistent` does not exist" } } },
      { status: 429, body: { error: { message: "Rate limit reached for requests" } } },
      { status: 500, body: { error: { message: "Internal server error: database timeout" } } },
      { status: 503, body: { error: { message: "Service Unavailable" } } },
      { status: 200, body: { choices: [{ message: { content: "OK" } }] } },
      { status: 400, body: { error: { message: "Invalid JSON schema in tool definition" } } },
      { status: 400, body: null },
      { status: 0, body: "" }
    ];

    for (const tc of nonOverflowCases) {
      assert.equal(isContextOverflowError(tc.status, tc.body), false, `False positive on: ${JSON.stringify(tc.body)}`);
    }
  });
});

// ============================================================================
// Suite 5: Feature F14 — Single-Shot Context Overflow Recovery
// ============================================================================
test("Suite 5: Feature F14 — Single-Shot Context Overflow Recovery & Anti-Loop Defense", async (t) => {
  await t.test("halves keepRecent window on emergency compaction (8 -> 4, 4 -> 2, min 2)", async () => {
    const mgr = new CompactionManager();
    const messages = Array.from({ length: 12 }, (_, i) => ({
      id: `msg_${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Content for turn ${i}`
    }));

    let receivedPrompt = null;
    const callLlm = async (prompt) => {
      receivedPrompt = prompt;
      return { ok: true, promptLength: prompt.length };
    };

    // Test 1: keepRecent 8 -> 4
    await mgr.handleOverflowRecovery({
      branchId: "branch_halve",
      errorResponse: { status: 400, message: "context_length_exceeded: maximum tokens reached" },
      messages,
      keepRecent: 8,
      callLlm
    });

    const state = mgr.getCompactionState("branch_halve");
    assert.ok(state.summary.includes("Kept last 4 messages"));

    // Test 2: fresh manager with keepRecent 4 -> 2
    const mgr2 = new CompactionManager();
    await mgr2.handleOverflowRecovery({
      branchId: "branch_halve_2",
      errorResponse: { status: 413, message: "context window" },
      messages,
      keepRecent: 4,
      callLlm
    });
    const state2 = mgr2.getCompactionState("branch_halve_2");
    assert.ok(state2.summary.includes("Kept last 2 messages"));

    // Test 3: fresh manager with keepRecent 2 -> minimum bound 2
    const mgr3 = new CompactionManager();
    await mgr3.handleOverflowRecovery({
      branchId: "branch_halve_min",
      errorResponse: { status: 400, message: "context_length_exceeded" },
      messages,
      keepRecent: 2,
      callLlm
    });
    const state3 = mgr3.getCompactionState("branch_halve_min");
    assert.ok(state3.summary.includes("Kept last 2 messages"));
  });

  await t.test("truncates large tool outputs >2000 chars while preserving regular text", async () => {
    const mgr = new CompactionManager();
    const hugeOutput = "A".repeat(80000);
    const normalOutput = "Normal tool output 123";

    // 1. Test standalone sanitizeToolOutputs function
    const rawMessages = [
      { id: "t1", role: "tool", content: hugeOutput },
      { id: "t2", role: "tool", content: normalOutput },
      { id: "u1", role: "user", content: "Regular text" }
    ];
    const sanitized = sanitizeToolOutputs(rawMessages, 2000);
    assert.ok(sanitized[0].content.length <= 2500);
    assert.ok(sanitized[0].content.includes("[TRUNCATED DUE TO CONTEXT OVERFLOW]"));
    assert.equal(sanitized[1].content, normalOutput);
    assert.equal(sanitized[2].content, "Regular text");

    // 2. Test during handleOverflowRecovery
    const messages = [
      { id: "m1", role: "user", content: "Run analysis" },
      { id: "m2", role: "tool", content: hugeOutput }
    ];

    let finalPrompt = null;
    await mgr.handleOverflowRecovery({
      branchId: "branch_trunc",
      errorResponse: { status: 400, message: "context_length_exceeded" },
      messages,
      keepRecent: 4,
      callLlm: async (prompt) => {
        finalPrompt = prompt;
        return { status: 200 };
      }
    });

    const truncatedTool = finalPrompt.find(m => m.id === "m2" || m.role === "tool");
    assert.ok(truncatedTool, "Tool message must be in final prompt");
    assert.ok(truncatedTool.content.length <= 2500, "Huge tool content must be truncated to <= 2500 chars");
    assert.ok(truncatedTool.content.includes("[TRUNCATED DUE TO CONTEXT OVERFLOW]"));
  });

  await t.test("anti-loop defense: second consecutive overflow strictly aborts without retry", async () => {
    const mgr = new CompactionManager();
    const messages = [{ id: "m1", role: "user", content: "Test query" }];

    let llmCallCount = 0;
    const callLlm = async () => {
      llmCallCount++;
      return "Retry Success";
    };

    // Attempt 1: succeeds
    const res1 = await mgr.handleOverflowRecovery({
      branchId: "branch_loop_test",
      errorResponse: { status: 400, message: "context_length_exceeded" },
      messages,
      callLlm
    });
    assert.equal(res1, "Retry Success");
    assert.equal(llmCallCount, 1);

    // Attempt 2 on same branch: must reject immediately
    await assert.rejects(async () => {
      await mgr.handleOverflowRecovery({
        branchId: "branch_loop_test",
        errorResponse: { status: 400, message: "context_length_exceeded" },
        messages,
        callLlm
      });
    }, /Single-shot overflow recovery already exhausted\. Aborting to avoid infinite loop\./);

    // Verify callLlm was NOT called a second time
    assert.equal(llmCallCount, 1);
  });

  await t.test("non-overflow error does not trigger recovery and rejects immediately", async () => {
    const mgr = new CompactionManager();
    let callLlmInvoked = false;

    await assert.rejects(async () => {
      await mgr.handleOverflowRecovery({
        branchId: "branch_err",
        errorResponse: { status: 401, message: "invalid_api_key: unauthorized" },
        messages: [{ id: "m1", role: "user", content: "test" }],
        callLlm: async () => { callLlmInvoked = true; }
      });
    }, /Non-overflow error/);

    assert.equal(callLlmInvoked, false, "callLlm must not be invoked for non-overflow error");
  });

  await t.test("re-issues prompt exactly once when recovery succeeds", async () => {
    const mgr = new CompactionManager();
    const messages = [
      { id: "u1", role: "user", content: "First" },
      { id: "u2", role: "user", content: "Second" }
    ];

    const executionLog = [];
    const callLlm = async (prompt) => {
      executionLog.push({ promptLength: prompt.length });
      return { status: 200, response: "Model response after compaction" };
    };

    const res = await mgr.handleOverflowRecovery({
      branchId: "single_retry_test",
      errorResponse: { status: 400, message: "context_length_exceeded" },
      messages,
      keepRecent: 2,
      callLlm
    });

    assert.equal(res.status, 200);
    assert.equal(res.response, "Model response after compaction");
    assert.equal(executionLog.length, 1, "Prompt must be re-issued exactly once");
  });
});
