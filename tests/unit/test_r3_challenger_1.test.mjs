/**
 * Adversarial Challenger 1 Test Suite: Milestone M3 (Requirement R3)
 * Compaction Persistence, History Slicing & Boundary Alignment Verification
 *
 * Verifies:
 * 1. Tool-Call Chain Slicing & Atomic Pair Invariant:
 *    - Asserts slicing NEVER separates an assistant tool_call from its tool response
 *    - Validates parallel multi-tool call transactions (N tool_calls <-> N tool responses)
 *    - Tests behavior with and without subsequent user turns
 *    - Tests emergency overflow recovery prompt reconstruction during active tool turns
 * 2. Resilience to Corrupted, Invalid, or Missing firstKeptEntryId:
 *    - Null, undefined, empty string, type mismatches (numbers, objects, arrays, symbols)
 *    - Out-of-bounds turn IDs (negative, extreme), malformed strings, XSS/SQLi injection
 *    - Corrupted compactionState objects and dirty messages array items
 * 3. History Array Immutability (100% Intact Guarantee):
 *    - Deep immutability of original messages array and individual message objects
 *    - Non-destructive slicing, non-destructive overflow recovery, non-destructive tool truncation
 * 4. Scale Stress Testing (500+ Messages & High-Density Sessions):
 *    - Generation of 600+ message history with system prompts, user turns, and multi-tool executions
 *    - Multi-depth slicing (10%, 25%, 50%, 75%, 90%) with sub-50ms latency benchmark
 *    - Token savings persistence and multi-round sequential compaction
 * 5. Universal Overflow Error Detection & Gateway Robustness:
 *    - Circular object safety in isContextOverflowError
 *    - Provider error signatures and anti-loop single-shot exhaustion
 */

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

// Load agy_gateway module
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

/**
 * Empirical Oracle: Validates tool call integrity in prompt payload.
 *
 * Rules mandated by OpenAI, Anthropic Claude, and Gemini API schemas:
 * 1. Every message with role === 'tool' MUST have a tool_call_id.
 * 2. Every message with role === 'tool' MUST be preceded by an assistant message
 *    in the prompt that contains a tool_calls item with matching id.
 * 3. Every assistant message with tool_calls in the prompt MUST have all of its
 *    declared tool responses present in the prompt.
 * 4. No tool response may appear before its originating assistant tool_calls message.
 */
function checkToolCallIntegrity(prompt) {
  const errors = [];
  const registeredToolCalls = new Map(); // id -> { tc, assistantIdx, resolved: boolean }

  for (let i = 0; i < prompt.length; i++) {
    const msg = prompt[i];
    if (!msg) continue;

    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        if (tc && tc.id) {
          registeredToolCalls.set(tc.id, { tc, assistantIdx: i, resolved: false });
        }
      }
    } else if (msg.role === "tool") {
      const toolCallId = msg.tool_call_id;
      if (!toolCallId) {
        errors.push(`Index ${i}: Message has role 'tool' but lacks 'tool_call_id'`);
      } else if (!registeredToolCalls.has(toolCallId)) {
        errors.push(`Index ${i}: Orphan tool response (tool_call_id: '${toolCallId}') has no preceding assistant tool_calls in prompt`);
      } else {
        registeredToolCalls.get(toolCallId).resolved = true;
      }
    }
  }

  // Check for unresolved tool calls in assistant messages
  for (const [id, entry] of registeredToolCalls.entries()) {
    if (!entry.resolved) {
      errors.push(`Index ${entry.assistantIdx}: Assistant tool_call '${id}' has no corresponding tool response in prompt`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================================================
// Suite 1: Tool-Call Chain Slicing & Atomic Pair Invariant Stress Tests
// ============================================================================
test("Challenger 1 Suite 1: Tool-Call Chain Slicing & Atomic Pair Invariant", async (t) => {
  await t.test("1.1 Single tool call with subsequent user turn: slicing cleanly omits or includes tool turn", () => {
    const messages = [
      { id: "sys1", role: "system", content: "You are a coding assistant." },
      { id: "u1", role: "user", content: "Read database config" },
      { id: "a1", role: "assistant", content: "Fetching config...", tool_calls: [{ id: "call_read_1", type: "function", function: { name: "read_file" } }] },
      { id: "t1", role: "tool", content: "{ host: 'localhost', port: 5432 }", tool_call_id: "call_read_1" },
      { id: "a2", role: "assistant", content: "Config is localhost:5432." },
      { id: "u2", role: "user", content: "Now connect to database" },
      { id: "a3", role: "assistant", content: "Connecting..." }
    ];

    // Slice at tool message t1: boundary alignment advances to u2
    const promptAtTool = slicePromptHistory(messages, {
      firstKeptEntryId: "t1",
      summary: "User checked config."
    });
    const integrityTool = checkToolCallIntegrity(promptAtTool);
    assert.ok(integrityTool.valid, "Slicing at tool with subsequent user turn must be valid: " + integrityTool.errors.join("; "));

    // Tail must start at u2, omitting incomplete tool transaction
    const nonSyntheticIds = promptAtTool.filter(m => m.id).map(m => m.id);
    assert.deepEqual(nonSyntheticIds, ["sys1", "u2", "a3"]);

    // Slice at u2 directly
    const promptAtUser = slicePromptHistory(messages, {
      firstKeptEntryId: "u2",
      summary: "User checked config."
    });
    const integrityUser = checkToolCallIntegrity(promptAtUser);
    assert.ok(integrityUser.valid, "Slicing at user turn must be valid: " + integrityUser.errors.join("; "));
  });

  await t.test("1.2 Parallel multi-tool calls (N=3) with subsequent user turn: atomic transaction integrity", () => {
    const messages = [
      { id: "sys", role: "system", content: "System prompt." },
      { id: "u1", role: "user", content: "Inspect repo status, branch, and diff" },
      { id: "a1", role: "assistant", content: "Inspecting...", tool_calls: [
        { id: "c_status", type: "function", function: { name: "git_status" } },
        { id: "c_branch", type: "function", function: { name: "git_branch" } },
        { id: "c_diff", type: "function", function: { name: "git_diff" } }
      ]},
      { id: "t_status", role: "tool", content: "clean", tool_call_id: "c_status" },
      { id: "t_branch", role: "tool", content: "main", tool_call_id: "c_branch" },
      { id: "t_diff", role: "tool", content: "no changes", tool_call_id: "c_diff" },
      { id: "a2", role: "assistant", content: "Repo is clean on main." },
      { id: "u2", role: "user", content: "Next command" }
    ];

    // Test slicing at each intermediate tool response
    for (const toolId of ["t_status", "t_branch", "t_diff"]) {
      const prompt = slicePromptHistory(messages, {
        firstKeptEntryId: toolId,
        summary: "Git inspections complete."
      });
      const integrity = checkToolCallIntegrity(prompt);
      assert.ok(
        integrity.valid,
        `Slicing at intermediate tool ${toolId} with subsequent user must advance cleanly: ` + integrity.errors.join("; ")
      );
      // Confirmed kept tail lands on u2
      const keptIds = prompt.filter(m => m.id).map(m => m.id);
      assert.deepEqual(keptIds, ["sys", "u2"]);
    }
  });

  await t.test("1.3 Adversarial: Single tool call WITHOUT subsequent user message (active agent turn)", () => {
    // When an agent executes a tool, the conversation ends with the tool response or assistant reply.
    // There is NO subsequent user turn yet!
    const messages = [
      { id: "u1", role: "user", content: "Read database schema" },
      { id: "a1", role: "assistant", content: "Reading schema...", tool_calls: [
        { id: "call_schema_99", type: "function", function: { name: "read_schema" } }
      ]},
      { id: "t1", role: "tool", content: "CREATE TABLE users (id INT PRIMARY KEY);", tool_call_id: "call_schema_99" },
      { id: "a2", role: "assistant", content: "Schema retrieved." }
    ];

    // Boundary placed on tool message t1
    const prompt = slicePromptHistory(messages, {
      firstKeptEntryId: "t1",
      summary: "User requested schema."
    });

    const integrity = checkToolCallIntegrity(prompt);
    // Empirical assertion: Slicing must NEVER produce an orphan tool message
    assert.equal(
      integrity.valid,
      true,
      `INVARIANT VIOLATION: Tool call pair was split during slicing! ${integrity.errors.join("; ")}`
    );
  });

  await t.test("1.4 Adversarial: Multi-tool calls (N=3) WITHOUT subsequent user message sliced at intermediate tool", () => {
    const messages = [
      { id: "u1", role: "user", content: "Run diagnostic tools" },
      { id: "a1", role: "assistant", content: "Executing diagnostics...", tool_calls: [
        { id: "call_cpu", type: "function", function: { name: "check_cpu" } },
        { id: "call_mem", type: "function", function: { name: "check_mem" } },
        { id: "call_disk", type: "function", function: { name: "check_disk" } }
      ]},
      { id: "t_cpu", role: "tool", content: "CPU: 12%", tool_call_id: "call_cpu" },
      { id: "t_mem", role: "tool", content: "RAM: 45%", tool_call_id: "call_mem" },
      { id: "t_disk", role: "tool", content: "Disk: 80%", tool_call_id: "call_disk" },
      { id: "a2", role: "assistant", content: "Diagnostics completed." }
    ];

    // Slice at second tool response t_mem
    const prompt = slicePromptHistory(messages, {
      firstKeptEntryId: "t_mem",
      summary: "Started diagnostics."
    });

    const integrity = checkToolCallIntegrity(prompt);
    assert.equal(
      integrity.valid,
      true,
      `INVARIANT VIOLATION: Intermediate tool slice produced orphan or incomplete tool pair! ${integrity.errors.join("; ")}`
    );
  });

  await t.test("1.5 Adversarial: Single-shot overflow recovery during active tool turn", async () => {
    const mgr = new CompactionManager();
    const messages = [
      { id: "m0", role: "user", content: "Search codebase" },
      { id: "m1", role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "grep" } }] },
      { id: "m2", role: "tool", content: "grep output data", tool_call_id: "c1" },
      { id: "m3", role: "assistant", content: "", tool_calls: [{ id: "c2", type: "function", function: { name: "view_file" } }] },
      { id: "m4", role: "tool", content: "file content 12345", tool_call_id: "c2" },
      { id: "m5", role: "assistant", content: "Done analysis." }
    ];

    let reissuedPrompt = null;
    await mgr.handleOverflowRecovery({
      branchId: "recovery_tool_test",
      errorResponse: { status: 413, message: "Payload Too Large" },
      messages,
      keepRecent: 4, // 4 / 2 = 2, so kept tail index = 6 - 2 = 4 (lands on m4, tool message!)
      callLlm: async (prompt) => {
        reissuedPrompt = prompt;
        return { status: 200, content: "Recovered" };
      }
    });

    assert.ok(reissuedPrompt, "handleOverflowRecovery must re-issue prompt");
    const integrity = checkToolCallIntegrity(reissuedPrompt);
    assert.equal(
      integrity.valid,
      true,
      `INVARIANT VIOLATION: handleOverflowRecovery re-issued prompt with broken tool pair! ${integrity.errors.join("; ")}`
    );
  });
});

// ============================================================================
// Suite 2: Resilience to Malformed, Corrupted, or Missing firstKeptEntryId
// ============================================================================
test("Challenger 1 Suite 2: Resilience to Malformed, Corrupted, or Missing firstKeptEntryId", async (t) => {
  const baseMessages = [
    { id: "sys0", role: "system", content: "System prompt" },
    { id: "u1", role: "user", content: "Hello" },
    { id: "a1", role: "assistant", content: "Hi there" },
    { id: "u2", role: "user", content: "Help me with math" },
    { id: "a2", role: "assistant", content: "Sure, what problem?" }
  ];

  await t.test("2.1 Null, undefined, and empty string firstKeptEntryId", () => {
    const cases = [null, undefined, ""];
    for (const val of cases) {
      const sliced = slicePromptHistory(baseMessages, { firstKeptEntryId: val, summary: "Sum" });
      assert.ok(Array.isArray(sliced), `Must return array for ${val}`);
      assert.ok(sliced.length >= baseMessages.length, `Must retain full messages when boundary is ${val}`);
      assert.equal(sliced[0].role, "system");
    }
  });

  await t.test("2.2 Type mismatches: numbers, objects, arrays, booleans, and symbols", () => {
    const weirdIds = [
      12345,
      0,
      -1,
      3.14159,
      {},
      { id: "u2" },
      [],
      ["u1", "u2"],
      true,
      false,
      NaN,
      Infinity
    ];

    for (const weird of weirdIds) {
      assert.doesNotThrow(() => {
        const sliced = slicePromptHistory(baseMessages, { firstKeptEntryId: weird, summary: "Sum" });
        assert.ok(Array.isArray(sliced), `Expected array for type ${typeof weird}`);
        assert.ok(sliced.length > 0);
      }, `Must not throw on weird firstKeptEntryId: ${String(weird)}`);
    }
  });

  await t.test("2.3 Out-of-bounds turn IDs and non-existent UUIDs", () => {
    const nonExistentCases = [
      "turn_999999",
      "turn_-1",
      "turn_-9999",
      "uuid_not_in_history_00000000-0000-0000-0000-000000000000",
      "msg_missing"
    ];

    for (const id of nonExistentCases) {
      const sliced = slicePromptHistory(baseMessages, { firstKeptEntryId: id, summary: "Sum" });
      assert.ok(Array.isArray(sliced));
      // Graceful fallback defaults to index 0, retaining all messages
      const nonSynthetic = sliced.filter(m => m.id);
      assert.equal(nonSynthetic.length, baseMessages.length, `Expected full retention on missing id ${id}`);
    }
  });

  await t.test("2.4 Malformed turn pattern strings", () => {
    const malformedTurnPatterns = [
      "turn_",
      "turn_abc",
      "turn_NaN",
      "turn_123_extra_tokens",
      "turn_null",
      "turn_undefined"
    ];

    for (const pattern of malformedTurnPatterns) {
      assert.doesNotThrow(() => {
        const sliced = slicePromptHistory(baseMessages, { firstKeptEntryId: pattern, summary: "Sum" });
        assert.ok(Array.isArray(sliced));
      });
    }
  });

  await t.test("2.5 Hostile strings: XSS, SQLi, null bytes, and massive strings", () => {
    const hostileInputs = [
      "<script>alert(document.cookie)</script>",
      "'; DROP TABLE messages; --",
      "../../../etc/passwd",
      "\x00\r\n\t\x1b[31mRed\x1b[0m",
      "A".repeat(50000),
      "🧑‍💻 🚀 💥 𝓤𝓷𝓲𝓬𝓸𝓭𝓮"
    ];

    for (const hostile of hostileInputs) {
      assert.doesNotThrow(() => {
        const sliced = slicePromptHistory(baseMessages, { firstKeptEntryId: hostile, summary: "Hostile test" });
        assert.ok(Array.isArray(sliced));
      }, `Must safely handle hostile input: ${hostile.slice(0, 30)}`);
    }
  });

  await t.test("2.6 Corrupted compactionState inputs", () => {
    const corruptedStates = [
      null,
      undefined,
      "not an object",
      42,
      true,
      [],
      {},
      { summary: null, firstKeptEntryId: null },
      { summary: 12345, firstKeptEntryId: "u2" }
    ];

    for (const state of corruptedStates) {
      assert.doesNotThrow(() => {
        const sliced = slicePromptHistory(baseMessages, state);
        assert.ok(Array.isArray(sliced));
      });
    }
  });

  await t.test("2.7 Corrupted messages array elements", () => {
    const dirtyMessages = [
      null,
      undefined,
      {},
      { id: "m1" }, // missing role & content
      { role: "user" }, // missing id & content
      { content: "no role" }, // missing role
      { id: "m2", role: "assistant", content: null },
      { id: "m3", role: "tool", content: undefined }
    ];

    assert.doesNotThrow(() => {
      const sliced = slicePromptHistory(dirtyMessages, { firstKeptEntryId: "m1", summary: "Dirty" });
      assert.ok(Array.isArray(sliced));
    });

    // Non-array messages inputs
    assert.deepEqual(slicePromptHistory(null, { firstKeptEntryId: "m1" }), []);
    assert.deepEqual(slicePromptHistory(undefined, { firstKeptEntryId: "m1" }), []);
    assert.deepEqual(slicePromptHistory("string", { firstKeptEntryId: "m1" }), []);
    assert.deepEqual(slicePromptHistory({}, { firstKeptEntryId: "m1" }), []);
  });
});

// ============================================================================
// Suite 3: History Array Immutability (100% Intact Guarantee)
// ============================================================================
test("Challenger 1 Suite 3: History Array Immutability (100% Intact Guarantee)", async (t) => {
  function createDeepSnapshot(arr) {
    return JSON.parse(JSON.stringify(arr));
  }

  await t.test("3.1 slicePromptHistory leaves original array and message objects deeply untouched", () => {
    const original = [
      { id: "m1", role: "system", content: "Sys" },
      { id: "m2", role: "user", content: "Query 1" },
      { id: "m3", role: "assistant", content: "Reply 1" }
    ];
    const snapshot = createDeepSnapshot(original);

    const sliced = slicePromptHistory(original, { firstKeptEntryId: "m3", summary: "Summary" });

    // Assert array reference is fresh
    assert.notEqual(sliced, original);
    // Assert original array length and contents are identical
    assert.deepEqual(original, snapshot);
    assert.equal(JSON.stringify(original), JSON.stringify(snapshot));
  });

  await t.test("3.2 reconstructPromptWithCompaction leaves original array deeply untouched", () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState("immut_branch", { firstKeptEntryId: "u2", summary: "Summary" });

    const original = [
      { id: "u1", role: "user", content: "Turn 1" },
      { id: "a1", role: "assistant", content: "Turn 2" },
      { id: "u2", role: "user", content: "Turn 3" }
    ];
    const snapshot = createDeepSnapshot(original);

    const prompt = mgr.reconstructPromptWithCompaction(original, "immut_branch");
    assert.notEqual(prompt, original);
    assert.deepEqual(original, snapshot);
  });

  await t.test("3.3 handleOverflowRecovery leaves original array untouched even when truncating tool outputs", async () => {
    const mgr = new CompactionManager();
    const giantContent = "A".repeat(50000);
    const original = [
      { id: "m1", role: "user", content: "Inspect" },
      { id: "m2", role: "tool", content: giantContent, tool_call_id: "c1" }
    ];
    const snapshot = createDeepSnapshot(original);

    await mgr.handleOverflowRecovery({
      branchId: "trunc_immut_test",
      errorResponse: { status: 400, message: "context_length_exceeded" },
      messages: original,
      keepRecent: 2,
      callLlm: async () => ({ status: 200 })
    });

    // Verify original tool content was NOT truncated in-place
    assert.equal(original[1].content.length, 50000);
    assert.deepEqual(original, snapshot);
  });

  await t.test("3.4 sanitizeToolOutputs creates new array and copies without mutating original objects", () => {
    const giant = "Z".repeat(10000);
    const original = [
      { id: "t1", role: "tool", content: giant },
      { id: "u1", role: "user", content: "User text" }
    ];
    const snapshot = createDeepSnapshot(original);

    const sanitized = sanitizeToolOutputs(original, 2000);
    assert.notEqual(sanitized, original);
    assert.notEqual(sanitized[0], original[0], "Truncated item must be a new object");
    assert.equal(original[0].content.length, 10000, "Original tool content must not be truncated");
    assert.deepEqual(original, snapshot);
  });

  await t.test("3.5 downstream mutations of sliced prompt elements do not affect original history", () => {
    const original = [
      { id: "m1", role: "user", content: "Pristine content" }
    ];
    const sliced = slicePromptHistory(original, null);
    // Mutate sliced array
    sliced.push({ id: "hacked", role: "user", content: "Injected" });
    assert.equal(original.length, 1, "Original array must not receive pushed items");
  });
});

// ============================================================================
// Suite 4: Scale Stress Testing (500+ Messages & High-Density Sessions)
// ============================================================================
test("Challenger 1 Suite 4: Scale Stress Testing (500+ Messages & Deep History)", async (t) => {
  // Generate 600 realistic messages
  const messageCount = 600;
  const messages = [];

  messages.push({
    id: "sys_root",
    role: "system",
    content: "You are Leostryx coding agent operating in /storage/emulated/0/Leostryx-repo."
  });

  for (let i = 1; i <= 210; i++) {
    const turnId = i;
    messages.push({
      id: `msg_u_${turnId}`,
      role: "user",
      content: `User turn ${turnId}: Please analyze module ${turnId}. Output required: full AST analysis.`
    });
    messages.push({
      id: `msg_a_${turnId}`,
      role: "assistant",
      content: `Assistant turn ${turnId}: Analyzing module ${turnId}...`,
      tool_calls: [
        {
          id: `call_${turnId}_grep`,
          type: "function",
          function: { name: "grep_search", arguments: `{"pattern":"module_${turnId}"}` }
        }
      ]
    });
    messages.push({
      id: `msg_t_${turnId}`,
      role: "tool",
      content: `Tool result for module ${turnId}: Found 14 occurrences in source files. Line 42: export default module_${turnId};`,
      tool_call_id: `call_${turnId}_grep`
    });
  }

  assert.ok(messages.length >= 600, `Generated messages must exceed 600 (actual: ${messages.length})`);

  await t.test("4.1 Multi-depth slicing across 600 messages (10%, 25%, 50%, 75%, 90%)", () => {
    const depthPercentages = [0.10, 0.25, 0.50, 0.75, 0.90];

    for (const pct of depthPercentages) {
      const targetIndex = Math.floor(messages.length * pct);
      const targetMsg = messages[targetIndex];
      const targetId = targetMsg.id;

      const state = {
        firstKeptEntryId: targetId,
        summary: `Compacted pre-turn ${targetId} messages (${Math.round(pct * 100)}% pruned).`,
        estimatedTokensSaved: targetIndex * 120
      };

      const start = performance.now();
      const sliced = slicePromptHistory(messages, state, { alignToUser: false });
      const durationMs = performance.now() - start;

      // Performance assertion: sub-50ms per slice operation
      assert.ok(durationMs < 50, `Slicing at ${pct * 100}% took ${durationMs.toFixed(2)}ms (must be < 50ms)`);

      // System message preservation at index 0
      assert.equal(sliced[0].role, "system");
      assert.equal(sliced[0].id, "sys_root");

      // Injected summary check
      const summaryMsg = sliced.find(m => m.role === "user" && m.content.includes("Compacted pre-turn"));
      assert.ok(summaryMsg, `Summary turn must exist for ${pct * 100}% slice`);

      // Sliced length must be strictly smaller than original
      assert.ok(sliced.length < messages.length);
    }
  });

  await t.test("4.2 Scale Latency Benchmark: 100 consecutive slice operations on 600 messages", () => {
    const state = {
      firstKeptEntryId: "msg_u_150",
      summary: "Benchmarking 100 slicing operations."
    };

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const res = slicePromptHistory(messages, state, { alignToUser: false });
      assert.ok(res.length > 0);
    }
    const totalDuration = performance.now() - start;
    const avgDuration = totalDuration / 100;

    assert.ok(avgDuration < 5, `Average slice duration was ${avgDuration.toFixed(2)}ms (target < 5ms)`);
  });

  await t.test("4.3 Token savings accounting and recovery in CompactionManager across 600 messages", () => {
    const mgr = new CompactionManager({ chatId: "chat_scale_test" });
    const targetTurn = 180;
    const estimatedSaved = targetTurn * 150; // ~27000 tokens

    mgr.saveCompactionState("main", {
      firstKeptEntryId: `msg_u_${targetTurn}`,
      summary: `Compacted up to turn ${targetTurn}.`,
      estimatedTokensSaved: estimatedSaved,
      compactedAt: Date.now()
    });

    const loaded = mgr.getCompactionState("main");
    assert.equal(loaded.estimatedTokensSaved, estimatedSaved);
    assert.equal(loaded.firstKeptEntryId, `msg_u_${targetTurn}`);

    const prompt = mgr.reconstructPromptWithCompaction(messages, "main");
    assert.equal(prompt[0].role, "system");
    assert.equal(prompt[0].id, "sys_root");
  });

  await t.test("4.4 Multi-round sequential compaction (3 rounds as conversation grows to 600 messages)", () => {
    const mgr = new CompactionManager();
    const branch = "growth_branch";

    // Round 1: at message 150
    mgr.saveCompactionState(branch, {
      firstKeptEntryId: "msg_u_50",
      summary: "Round 1 summary",
      estimatedTokensSaved: 10000
    });
    let s1 = mgr.getCompactionState(branch);
    assert.equal(s1.firstKeptEntryId, "msg_u_50");
    assert.equal(s1.estimatedTokensSaved, 10000);

    // Round 2: at message 300
    mgr.saveCompactionState(branch, {
      firstKeptEntryId: "msg_u_100",
      summary: "Round 2 summary (incorporates round 1)",
      estimatedTokensSaved: 25000
    });
    let s2 = mgr.getCompactionState(branch);
    assert.equal(s2.firstKeptEntryId, "msg_u_100");
    assert.equal(s2.estimatedTokensSaved, 25000);

    // Round 3: at message 450
    mgr.saveCompactionState(branch, {
      firstKeptEntryId: "msg_u_150",
      summary: "Round 3 summary",
      estimatedTokensSaved: 45000
    });
    let s3 = mgr.getCompactionState(branch);
    assert.equal(s3.firstKeptEntryId, "msg_u_150");
    assert.equal(s3.estimatedTokensSaved, 45000);

    // Final prompt reconstruction
    const finalPrompt = mgr.reconstructPromptWithCompaction(messages, branch);
    assert.equal(finalPrompt[0].role, "system");
    const summaryMsg = finalPrompt.find(m => m.role === "user" && m.content.includes("Round 3 summary"));
    assert.ok(summaryMsg);
  });
});

// ============================================================================
// Suite 5: Universal Overflow Error Detection & Gateway Robustness
// ============================================================================
test("Challenger 1 Suite 5: Universal Overflow Error Detection & Gateway Robustness", async (t) => {
  await t.test("5.1 Circular reference safety in isContextOverflowError", () => {
    const circularObj = {
      status: 400,
      message: "context_length_exceeded"
    };
    circularObj.self = circularObj;

    // Must safely return boolean without throwing TypeError: Converting circular structure to JSON
    assert.doesNotThrow(() => {
      const isOverflow = isContextOverflowError(400, circularObj);
      assert.equal(typeof isOverflow, "boolean");
    }, "isContextOverflowError must not crash on circular object error structures");
  });

  await t.test("5.2 Provider error patterns: case, whitespace, and phrasing variations", () => {
    const variations = [
      { status: 400, body: "CONTEXT_LENGTH_EXCEEDED" },
      { status: 400, body: "context-length-exceeded" },
      { status: 400, body: "context length exceeded" },
      { status: 400, body: "maximum   context   length" },
      { status: 413, body: "" },
      { status: 400, body: { error: { message: "Input token count: 150000 exceeds maximum tokens 128000" } } },
      { status: 400, body: { message: "Prompt exceeds context window limit" } },
      { status: 422, body: { error: "total tokens exceeds max allowed tokens" } },
      { status: 500, body: "exceeds context window" }
    ];

    for (const v of variations) {
      assert.equal(
        isContextOverflowError(v.status, v.body),
        true,
        `Expected true for variation: ${JSON.stringify(v.body)}`
      );
    }
  });

  await t.test("5.3 Anti-loop exhaustion and multi-branch isolation", async () => {
    const mgr = new CompactionManager();
    const messages = [{ id: "u1", role: "user", content: "Query" }];

    // Branch A: first recovery succeeds
    await mgr.handleOverflowRecovery({
      branchId: "branch_A",
      errorResponse: { status: 413 },
      messages,
      callLlm: async () => ({ ok: true })
    });

    // Branch A: second recovery must fail immediately
    await assert.rejects(async () => {
      await mgr.handleOverflowRecovery({
        branchId: "branch_A",
        errorResponse: { status: 413 },
        messages,
        callLlm: async () => ({ ok: true })
      });
    }, /Single-shot overflow recovery already exhausted/);

    // Branch B: separate branch must still succeed on its first attempt
    const resB = await mgr.handleOverflowRecovery({
      branchId: "branch_B",
      errorResponse: { status: 413 },
      messages,
      callLlm: async () => ({ ok: true, branch: "B" })
    });
    assert.equal(resB.branch, "B");
  });
});
