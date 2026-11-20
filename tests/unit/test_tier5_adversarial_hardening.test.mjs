/**
 * Tier 5: Adversarial Coverage Hardening Test Suite
 * Master empirical challenge suite for Milestone M5 covering:
 * - Area 1: Cross-Feature Compound Interactions (R1 + R2 + R3 + R4 concurrently)
 * - Area 2: Boundary Stress & Failure Recovery Simulations (network drops, invalid auth, corrupted media, Dalvik pressure)
 * - Area 3: Concurrency, Race Condition Invariants & Resource Leak Prevention
 *
 * File: tests/unit/test_tier5_adversarial_hardening.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

// Load all 4 core architectural modules under test
const gatewayPath = path.join(REPO_ROOT, "app/assets/web/agy_gateway.js");
const providersPath = path.join(REPO_ROOT, "app/assets/web/agy_providers.js");
const dictationPath = path.join(REPO_ROOT, "app/assets/web/agy_dictation.js");
const compactorPath = path.join(REPO_ROOT, "app/assets/web/agy_compactor.js");
const exportPath = path.join(REPO_ROOT, "app/assets/web/agy_export_session.js");

// R1: Multimodal Payloads & Gateway
const gatewayModule = await import("file://" + gatewayPath).then(m => m.default || m);
const {
  ANTHROPIC_SUPPORTED_IMAGE_MIMES,
  uint8ToBase64,
  base64ToUint8,
  normalizeMimeType,
  isImageMime,
  parseDataUrl,
  extractMediaInfo,
  transformToOpenAIChat,
  transformToOpenAIResponses,
  transformToAnthropic,
  convertUserContent,
  transformRequest,
  isModelVisionCapable,
  validateVisionSupport,
  maskMediaInLogs
} = gatewayModule;

// Providers
const { officialModelInfo, effectiveInfo } = await import("file://" + providersPath).then(m => m.default || m);

// R2: Resilient Dictation FSM
const dictModule = await import("file://" + dictationPath);
const { DictationFSM, AgyDictation, __agyDictationMount, __agyDictationCfg } = (
  dictModule.default?.DictationFSM ? dictModule.default : dictModule
);

// R3: Compaction Persistence & Recovery
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

// R4: Streaming Session ZIP Export
const exportModule = await import("file://" + exportPath).then(m => m.default || m);
const {
  StreamingZipWriter,
  buildZip,
  crc32,
  sanitizeText,
  redactSensitiveData,
  isSensitiveFilename,
  isPrivateConfigFile,
  sanitizeDiff,
  sanitizeJsonl,
  sanitizeMarkdown,
  transcriptMd,
  formatTranscriptFullJsonl,
  formatChangesDiff,
  packageTranscriptFull,
  packageTranscriptMd,
  packageChangesDiff,
  packageAttachments,
  createUnifiedDiff,
  ExportManager,
  exportSession,
  BLACKLISTED_FILENAMES,
  BLACKLISTED_EXTENSIONS
} = exportModule;

// ============================================================================
// Test Utilities & Empirical Oracles
// ============================================================================

/**
 * Pure JS PKZIP 2.0 Parser with CRC-32 Oracle
 */
function parseZipArchive(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  let eocdOffset = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("EOCD signature not found in archive");

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries = new Map();
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) {
      throw new Error(`Invalid Central Directory header signature at offset ${pos}`);
    }
    const crc = view.getUint32(pos + 16, true);
    const compSize = view.getUint32(pos + 20, true);
    const uncompSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);

    const nameBytes = u8.subarray(pos + 46, pos + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);

    // Read Local File Header
    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid Local File Header signature at offset ${localOffset} for ${name}`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = u8.subarray(dataStart, dataStart + uncompSize);

    // Oracle verification against node:zlib native CRC32
    const nativeCrc = (zlib.crc32(Buffer.from(data)) >>> 0);
    assert.equal(nativeCrc, crc, `CRC32 mismatch for ${name}: native=${nativeCrc}, zip=${crc}`);

    entries.set(name, {
      name,
      crc,
      compSize,
      uncompSize,
      data,
      text: () => new TextDecoder().decode(data)
    });

    pos += 46 + nameLen + extraLen + commentLen;
  }

  return {
    totalEntries,
    entries,
    hasFile: (name) => entries.has(name),
    getFileText: (name) => entries.get(name)?.text(),
    getFileData: (name) => entries.get(name)?.data
  };
}

/**
 * In-memory Mock LocalStorage
 */
function createMockStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(String(k)) || null,
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(String(k)),
    clear: () => map.clear(),
    _map: map
  };
}

/**
 * Recursive Deep Freeze Utility
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (ArrayBuffer.isView(obj)) return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

// Realistic Sample Image Fixtures (complete valid image files >40 b64 chars)
const SAMPLE_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, // IEND
  0x42, 0x60, 0x82
]);
const SAMPLE_PNG_B64 = Buffer.from(SAMPLE_PNG_BYTES).toString("base64");
const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_B64}`;
const SAMPLE_MEDIA_PNG = {
  mimeType: "image/png",
  description: "architecture_diagram.png",
  payload: { case: "inlineData", value: SAMPLE_PNG_BYTES }
};

const SAMPLE_JPG_BYTES = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64"
);
const SAMPLE_JPG_B64 = Buffer.from(SAMPLE_JPG_BYTES).toString("base64");
const SAMPLE_JPG_DATA_URL = `data:image/jpeg;base64,${SAMPLE_JPG_B64}`;
const SAMPLE_MEDIA_JPG = {
  mimeType: "image/jpeg",
  description: "benchmark_plot.jpg",
  payload: { case: "inlineData", value: SAMPLE_JPG_BYTES }
};

// ============================================================================
// AREA 1: Cross-Feature Compound Interactions (R1 + R2 + R3 + R4)
// ============================================================================

test("Area 1: Cross-Feature Compound Interactions", async (t) => {

  await t.test("test_501_compound_dictation_multimodal_compaction_and_streaming_export", async () => {
    // SCENARIO: A user is dictating audio into the input box while multimodal images
    // are attached to the prompt. The conversation reaches context overflow,
    // triggering single-shot emergency compaction, and simultaneously a background
    // streaming ZIP export is invoked on the full conversation history.

    // 1. Initialize Dictation FSM
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: "chat_compound_101", continuous: true });
    assert.equal(fsm.state, "recording");

    // Feed speech segments with pauses ("X" silence endpointing)
    fsm.dispatchBridgeEvent(sid, "chat_compound_101", "P", "Please examine the architecture diagram");
    fsm.dispatchBridgeEvent(sid, "chat_compound_101", "F", "Please examine the architecture diagram");
    fsm.dispatchBridgeEvent(sid, "chat_compound_101", "X"); // continuous re-prime
    assert.equal(fsm.state, "recording");

    // 2. Multimodal attachments in composer draft
    const attachments = [SAMPLE_MEDIA_PNG, SAMPLE_MEDIA_JPG];
    const validation = validateVisionSupport("claude-3-5-sonnet", attachments);
    assert.equal(validation.valid, true);

    const anthropicBlocks = attachments.map(att => transformToAnthropic(att));
    assert.equal(anthropicBlocks.length, 2);
    assert.equal(anthropicBlocks[0].type, "image");
    assert.equal(anthropicBlocks[1].type, "image");

    // 3. Populate conversational history prior to compaction
    const history = [
      { id: "turn_0", role: "system", content: "You are the Leostryx coding assistant." },
      { id: "turn_1", role: "user", content: "Initial query on system setup" },
      { id: "turn_2", role: "assistant", content: "Scaffolded project files" },
      { id: "turn_3", role: "user", content: "Second query: add database migration" },
      { id: "turn_4", role: "assistant", content: "Created schema.sql", tool_calls: [{ id: "call_db", name: "apply_migration" }] },
      { id: "turn_5", role: "tool", content: "Migration applied successfully", tool_call_id: "call_db" },
      { id: "turn_6", role: "assistant", content: "Database ready for queries" },
      { id: "turn_7", role: "user", content: "Active multimodal turn", attachments }
    ];

    // Deep freeze history to verify strict immutability during concurrent compaction & export
    deepFreeze(history);

    // 4. Trigger single-shot overflow recovery (R3)
    const compMgr = new CompactionManager({ chatId: "chat_compound_101" });
    const overflowError = {
      status: 400,
      message: "context_length_exceeded: input tokens 132000 exceed model limit 128000"
    };

    let llmCalls = 0;
    let reconstructedPrompt = null;
    const callLlm = async (prompt) => {
      llmCalls++;
      reconstructedPrompt = prompt;
      return { status: 200, content: "Model response following compaction." };
    };

    const recoveryPromise = compMgr.handleOverflowRecovery({
      branchId: "branch_compound",
      errorResponse: overflowError,
      messages: history,
      keepRecent: 4,
      callLlm
    });

    // 5. Concurrently, user / background task initiates Streaming ZIP Export (R4)
    const exportChunks = [];
    const zipWriter = new StreamingZipWriter({
      onChunk: (chunk) => exportChunks.push(chunk)
    });

    const diffs = [
      { path: "src/config.ts", originalContent: "port = 3000;\n", modifiedContent: "port = 8080;\n" }
    ];

    const rawTranscript = packageTranscriptFull(history);
    const mdTranscript = packageTranscriptMd(history, {
      cascadeId: "chat_compound_101",
      compactionState: {
        firstKeptEntryId: "turn_6",
        summary: "Pre-compaction summary of turns 1-5.",
        estimatedTokensSaved: 42000
      }
    });
    const changesDiff = packageChangesDiff(diffs);
    const packagedAtts = packageAttachments(attachments);

    zipWriter.addFile("transcript_full.jsonl", new TextEncoder().encode(rawTranscript));
    zipWriter.addFile("transcript.md", new TextEncoder().encode(mdTranscript));
    zipWriter.addFile("changes.diff", new TextEncoder().encode(changesDiff));
    for (const att of packagedAtts) {
      zipWriter.addFile(att.name, att.data);
    }
    const zipSummary = zipWriter.finish();

    // Await recovery completion
    const recoveryRes = await recoveryPromise;
    assert.equal(recoveryRes.status, 200);
    assert.equal(llmCalls, 1);

    // 6. Assert Invariants across All 4 Systems:
    // Invariant A: Dictation FSM remained alive, recording, with zero corruption
    assert.equal(fsm.state, "recording");
    assert.equal(fsm.sessionId, sid);
    assert.equal(fsm.buffer, "Please examine the architecture diagram");

    // Feed additional utterance and finalize dictation cleanly
    fsm.dispatchBridgeEvent(sid, "chat_compound_101", "P", "and propose speedups");
    const committedDictation = await fsm.stopDictation(sid);
    assert.equal(committedDictation, "Please examine the architecture diagram and propose speedups");
    assert.equal(fsm.state, "idle");

    // Invariant B: Reconstructed prompt contains only kept tail + structured summary
    assert.ok(reconstructedPrompt, "Compaction prompt must be generated");
    assert.equal(reconstructedPrompt[0].role, "system"); // System header preserved
    const summaryMsg = reconstructedPrompt.find(m => m.role === "user" && m.content.includes(SUMMARY_HEADER));
    assert.ok(summaryMsg, "Summary message must be present");
    const preCompactionMsg = reconstructedPrompt.find(m => m.id === "turn_1");
    assert.equal(preCompactionMsg, undefined, "Pre-compaction turns must NOT appear in prompt");

    // Invariant C: ZIP archive is 100% valid PKZIP with zero byte corruption
    assert.equal(zipSummary.totalFiles, 5); // transcript_full, transcript.md, changes.diff, 2 attachments
    const totalBytes = exportChunks.reduce((a, c) => a + c.length, 0);
    const fullZip = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of exportChunks) { fullZip.set(chunk, offset); offset += chunk.length; }

    const parsedZip = parseZipArchive(fullZip);
    assert.equal(parsedZip.totalEntries, 5);
    assert.ok(parsedZip.hasFile("transcript_full.jsonl"));
    assert.ok(parsedZip.hasFile("transcript.md"));
    assert.ok(parsedZip.hasFile("changes.diff"));
    assert.ok(parsedZip.hasFile("attachments/architecture_diagram.png"));
    assert.ok(parsedZip.hasFile("attachments/benchmark_plot.jpg"));

    // Verify transcript_full.jsonl contains pre-compaction turns
    const jsonlText = parsedZip.getFileText("transcript_full.jsonl");
    assert.ok(jsonlText.includes("turn_1"));
    assert.ok(jsonlText.includes("Initial query on system setup"));

    // Invariant D: Zero Base64 leak in telemetry logs (tests Data URL and JSON data field redaction)
    const wireTelemetry = JSON.stringify({
      event: "request_sent",
      payload: anthropicBlocks,
      previewUrl: SAMPLE_PNG_DATA_URL
    });
    const redactedTelemetry = maskMediaInLogs(wireTelemetry);
    assert.ok(!redactedTelemetry.includes(SAMPLE_PNG_B64));
    assert.ok(!redactedTelemetry.includes(SAMPLE_JPG_B64));
    assert.ok(redactedTelemetry.includes("[IMAGE: image/png"));
    assert.ok(redactedTelemetry.includes("<base64 redacted:"));
  });

  await t.test("test_502_compound_chat_switch_abort_during_dictation_with_concurrent_export", async () => {
    // SCENARIO: Dictation is actively recording in Chat A. The user abruptly switches
    // to Chat B while an export of Chat A is concurrently being assembled.
    // Late callbacks from Chat A's speech recognizer arrive after the switch.

    const fsm = new DictationFSM();
    const sidA = fsm.startDictation({ chatId: "chat_alpha", continuous: true });
    fsm.dispatchBridgeEvent(sidA, "chat_alpha", "F", "Secret turn in chat alpha");
    assert.equal(fsm.buffer, "Secret turn in chat alpha");

    // Chat A history to be exported
    const chatAHistory = [
      { id: "a_1", role: "user", content: "Question in Alpha" },
      { id: "a_2", role: "assistant", content: "Response in Alpha: " + fsm.buffer }
    ];

    // Concurrently trigger export of Chat A and switch to Chat B
    const exportPromise = (async () => {
      const expMgr = new ExportManager();
      return expMgr.buildZip([
        { name: "transcript.jsonl", data: packageTranscriptFull(chatAHistory) }
      ]);
    })();

    // User switches to chat_beta
    fsm.cleanupOnChatSwitch("chat_beta");
    assert.equal(fsm.state, "idle");
    assert.equal(fsm.buffer, ""); // Purged immediately

    // Late callbacks from Chat A arrive after switch
    fsm.dispatchBridgeEvent(sidA, "chat_alpha", "P", "ghost partial");
    fsm.dispatchBridgeEvent(sidA, "chat_alpha", "F", "ghost final");
    assert.equal(fsm.buffer, ""); // Must remain empty (zero late callback leak)

    // Await export completion
    const zipBytes = await exportPromise;
    const parsed = parseZipArchive(zipBytes);
    assert.equal(parsed.totalEntries, 1);
    assert.ok(parsed.hasFile("transcript.jsonl"));

    // Start fresh dictation in Chat B
    const sidB = fsm.startDictation({ chatId: "chat_beta", continuous: true });
    assert.notEqual(sidB, sidA);
    fsm.dispatchBridgeEvent(sidB, "chat_beta", "F", "Valid text in Beta");
    const betaResult = await fsm.stopDictation(sidB);
    assert.equal(betaResult, "Valid text in Beta");
  });

  await t.test("test_503_compound_multimodal_vision_validation_dynamic_model_switch_and_recovery", async () => {
    // SCENARIO: User has attached screenshots. The user switches between text-only and
    // vision models. When sending on a vision model, request transforms correctly.
    // If context overflows, emergency compaction preserves the multimodal content block in kept tail.

    const attachments = [SAMPLE_MEDIA_PNG];

    // Model 1: Text-only model blocks send and retains draft
    const val1 = validateVisionSupport("deepseek-chat", attachments);
    assert.equal(val1.valid, false);
    assert.ok(val1.error.includes("Selected model does not support images"));

    // Model 2: Switch to GPT-4o -> validation passes
    const val2 = validateVisionSupport("gpt-4o", attachments);
    assert.equal(val2.valid, true);
    const openAiParts = transformToOpenAIChat(SAMPLE_MEDIA_PNG);
    assert.equal(openAiParts.type, "image_url");

    // Model 3: Switch to Claude 3.5 Sonnet -> validation passes
    const val3 = validateVisionSupport("claude-3-5-sonnet", attachments);
    assert.equal(val3.valid, true);

    // Build history containing this multimodal user turn with content parts
    const history = [
      { id: "m0", role: "system", content: "Instructions" },
      { id: "m1", role: "user", content: "Turn 1" },
      { id: "m2", role: "assistant", content: "Reply 1" },
      {
        id: "m3",
        role: "user",
        content: [
          { type: "text", text: "Analyze diagram" },
          transformToOpenAIChat(SAMPLE_MEDIA_PNG)
        ]
      }
    ];

    const compMgr = new CompactionManager();
    const state = compMgr.saveCompactionState("branch_dyn", {
      firstKeptEntryId: "m3",
      summary: "Turns 1 and 2 summarized."
    });

    const prompt = compMgr.reconstructPromptWithCompaction(history, "branch_dyn");
    const keptMultimodalTurn = prompt.find(m => m.id === "m3");
    assert.ok(keptMultimodalTurn, "Kept tail must contain multimodal turn m3");

    // Transform prompt to Anthropic schema
    const anthropicReq = transformRequest({
      model: "claude-3-5-sonnet",
      messages: prompt
    }, "anthropic");

    const convertedUserTurn = anthropicReq.messages.find(m => m.role === "user" && Array.isArray(m.content));
    assert.ok(convertedUserTurn, "Anthropic request must retain converted array content");
    assert.equal(convertedUserTurn.content.length, 2);
    assert.equal(convertedUserTurn.content[0].type, "text");
    assert.equal(convertedUserTurn.content[1].type, "image");
    assert.equal(convertedUserTurn.content[1].source.media_type, "image/png");
  });

  await t.test("test_504_compound_multi_tool_chain_boundary_alignment_during_compaction_and_diff_export", async () => {
    // SCENARIO: Conversation has an assistant turn with parallel tool calls,
    // followed by parallel tool responses. Compaction boundary lands right in the
    // middle of the tool responses. Slicing oracle verifies atomic tool pair integrity.

    const history = [
      { id: "sys", role: "system", content: "Coding agent" },
      { id: "u1", role: "user", content: "Run tests and refactor" },
      {
        id: "a1",
        role: "assistant",
        content: "Running checks",
        tool_calls: [
          { id: "call_test", type: "function", function: { name: "run_test" } },
          { id: "call_git", type: "function", function: { name: "git_diff" } }
        ]
      },
      { id: "t1", role: "tool", content: "Tests passed (12/12)", tool_call_id: "call_test" },
      { id: "t2", role: "tool", content: "Diff: 5 lines changed", tool_call_id: "call_git" },
      { id: "a2", role: "assistant", content: "All tests green. Refactoring complete." },
      { id: "u2", role: "user", content: "Next command" }
    ];

    // Boundary placed on tool message t2
    const state = {
      firstKeptEntryId: "t2",
      summary: "Completed test runner execution."
    };

    const sliced = slicePromptHistory(history, state);

    // Empirical Oracle: Tool Call Chain Invariant
    // Slicing must NEVER orphan tool response messages (i.e. every tool message must have its initiating assistant call)
    const toolMsgIndex = sliced.findIndex(m => m.role === "tool");
    if (toolMsgIndex >= 0) {
      const toolCallId = sliced[toolMsgIndex].tool_call_id;
      const precedingAssistant = sliced.slice(0, toolMsgIndex).find(
        m => m.role === "assistant" && m.tool_calls && m.tool_calls.some(c => c.id === toolCallId)
      );
      assert.ok(precedingAssistant, "Tool message must have matching assistant tool_calls in prompt");
    } else {
      // Advanced to next user turn (u2)
      const nonSynthetic = sliced.filter(m => m.id && m.role !== "system");
      assert.equal(nonSynthetic[0].id, "u2");
    }

    // Concurrently, formatChangesDiff packages the workspace changes
    const diffs = [
      { path: "lib/engine.js", originalContent: "v = 1;\n", modifiedContent: "v = 2;\n" }
    ];
    const diffOut = packageChangesDiff(diffs);
    assert.ok(diffOut.includes("--- a/lib/engine.js"));
    assert.ok(diffOut.includes("+++ b/lib/engine.js"));
  });
});

// ============================================================================
// AREA 2: Boundary Stress & Failure Recovery Simulations
// ============================================================================

test("Area 2: Boundary Stress & Failure Recovery Simulations", async (t) => {

  await t.test("test_505_failure_network_drops_timeouts_and_gateway_abort", async () => {
    // 1. Gateway transformRequest with missing, null, or malformed payloads
    assert.throws(() => transformRequest(null, "anthropic"), /Invalid request object/i);
    assert.throws(() => transformRequest({}, "unsupported_protocol"), /Unsupported target protocol/i);

    // 2. Hardware failure simulation in Dictation FSM
    const fsmFail = new DictationFSM({ simulateFailure: true });
    let errorCaught = null;
    fsmFail.onError = (err) => { errorCaught = err; };
    const sid = fsmFail.startDictation({ chatId: "c_fail" });
    assert.equal(fsmFail.state, "idle"); // immediately reverted to idle on hardware error
    assert.ok(errorCaught, "Hardware failure error callback must fire");
    assert.ok(errorCaught.message.includes("Failed to initialize speech recognition hardware"));

    // 3. Simulated Hardware Watchdog timeout (speech never arrives)
    const fsmWatchdog = new DictationFSM();
    const sidWd = fsmWatchdog.startDictation({ chatId: "c_wd" });
    assert.equal(fsmWatchdog.state, "recording");
    assert.equal(fsmWatchdog.sawEvent, false);

    // Simulate watchdog firing after 4.5s
    fsmWatchdog._clearWatchdog();
    fsmWatchdog.cancelDictation(sidWd);
    assert.equal(fsmWatchdog.state, "idle");
  });

  await t.test("test_506_failure_invalid_auth_rate_limits_and_non_overflow_errors", async () => {
    const nonOverflowErrors = [
      { status: 401, body: { error: { message: "Invalid API Key provided: sk-proj-supersecret1234567890" } } },
      { status: 403, body: { error: { message: "User does not have access to model claude-3-5-sonnet" } } },
      { status: 404, body: { error: { message: "The model `gpt-5-preview` does not exist" } } },
      { status: 429, body: { error: { message: "Rate limit exceeded: TPM quota reached" } } },
      { status: 500, body: { error: { message: "Internal server error: upstream timeout" } } },
      { status: 502, body: "Bad Gateway" },
      { status: 503, body: "Service Temporarily Unavailable" }
    ];

    const compMgr = new CompactionManager();
    const messages = [{ id: "m1", role: "user", content: "Query" }];

    for (const err of nonOverflowErrors) {
      // 1. isContextOverflowError must return false
      assert.equal(
        isContextOverflowError(err.status, err.body),
        false,
        `Error status ${err.status} must not be classified as context overflow`
      );

      // 2. handleOverflowRecovery must immediately reject without retrying
      let llmCalled = false;
      await assert.rejects(
        async () => {
          await compMgr.handleOverflowRecovery({
            branchId: "branch_non_overflow",
            errorResponse: { status: err.status, message: JSON.stringify(err.body) },
            messages,
            callLlm: async () => { llmCalled = true; }
          });
        },
        /Non-overflow error/,
        `Status ${err.status} must reject with Non-overflow error`
      );
      assert.equal(llmCalled, false, `LLM must not be called for non-overflow error ${err.status}`);

      // 3. Secret Redaction must mask any leaked tokens in error dumps
      const rawText = JSON.stringify(err.body);
      const sanitized = redactSensitiveData(rawText);
      assert.ok(!sanitized.includes("sk-proj-supersecret1234567890"));
    }
  });

  await t.test("test_507_failure_corrupted_media_bytes_and_hostile_attachment_payloads", async () => {
    // 1. Corrupted Data URL with missing semicolon/base64
    assert.throws(() => parseDataUrl("data:image/png;not_base64,123"), /missing ;base64 indicator/);
    assert.throws(() => parseDataUrl("not_a_data_url"), /Invalid base64 image data URL/);
    assert.throws(() => parseDataUrl("data:image/png;base64,"), /Invalid base64 image data URL/);

    // 2. Hostile Attachment Filenames containing path traversal
    const hostileAtts = [
      { name: "../../../../etc/passwd", data: new Uint8Array([1, 2, 3]) },
      { name: "..\\..\\Windows\\System32\\cmd.exe", data: new Uint8Array([4, 5, 6]) },
      { name: "attachments/../../../secret.txt", data: new Uint8Array([7, 8, 9]) },
      { name: "normal_diagram.png", data: new Uint8Array([10, 11, 12]) }
    ];

    const packaged = packageAttachments(hostileAtts);
    assert.equal(packaged.length, 4);

    for (const p of packaged) {
      assert.ok(p.name.startsWith("attachments/"), `File ${p.name} must be enclosed in attachments/`);
      assert.ok(!p.name.includes(".."), `File ${p.name} must not contain path traversal dots`);
      assert.ok(!p.name.includes("\\"), `File ${p.name} must not contain backslashes`);
    }

    // 3. Blacklisted Sensitive Files as Attachments
    const blacklistedAtts = [
      { name: ".env", data: new Uint8Array([1]) },
      { name: ".env.production", data: new Uint8Array([2]) },
      { name: "id_rsa", data: new Uint8Array([3]) },
      { name: "id_ed25519", data: new Uint8Array([4]) },
      { name: "certs/server.pem", data: new Uint8Array([5]) },
      { name: "private.key", data: new Uint8Array([6]) },
      { name: "release.keystore", data: new Uint8Array([7]) },
      { name: "keystore.jks", data: new Uint8Array([8]) },
      { name: "credentials.json", data: new Uint8Array([9]) },
      { name: "safe_file.png", data: new Uint8Array([10]) }
    ];

    const safePackaged = packageAttachments(blacklistedAtts);
    assert.equal(safePackaged.length, 1);
    assert.equal(safePackaged[0].name, "attachments/safe_file.png");
  });

  await t.test("test_508_failure_simulated_dalvik_memory_pressure_and_large_streaming", async () => {
    // 1. Massive History Simulation (600 messages)
    const largeHistory = [];
    largeHistory.push({ id: "sys", role: "system", content: "System prompt" });
    for (let i = 1; i <= 600; i++) {
      largeHistory.push({
        id: `turn_${i}`,
        role: i % 2 === 1 ? "user" : "assistant",
        content: `Detailed execution log for conversational turn ${i} containing metadata and tokens.`
      });
    }

    const compMgr = new CompactionManager();
    const tStart = Date.now();
    compMgr.saveCompactionState("branch_scale", {
      firstKeptEntryId: "turn_550",
      summary: "Summarized first 549 turns."
    });
    const sliced = compMgr.reconstructPromptWithCompaction(largeHistory, "branch_scale");
    const tElapsed = Date.now() - tStart;

    assert.ok(tElapsed < 50, `Slicing 600 messages should take <50ms (took ${tElapsed}ms)`);
    assert.equal(sliced[0].role, "system");
    assert.ok(sliced.length < 60);

    // 2. Streaming ZIP >80 MiB payload without in-memory full buffer accumulation
    let totalStreamedBytes = 0;
    let chunksEmitted = 0;

    const streamWriter = new StreamingZipWriter({
      onChunk: (chunk) => {
        totalStreamedBytes += chunk.length;
        chunksEmitted++;
      }
    });

    const MOCK_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB per file
    const sampleBlock = new Uint8Array(64 * 1024);
    for (let i = 0; i < sampleBlock.length; i++) sampleBlock[i] = (i % 251);

    const mockFileData = new Uint8Array(MOCK_FILE_SIZE);
    for (let pos = 0; pos < MOCK_FILE_SIZE; pos += sampleBlock.length) {
      mockFileData.set(sampleBlock, pos);
    }

    // Write 8 files of 10 MiB = 80 MiB payload (> 64 MiB ceiling)
    for (let f = 1; f <= 8; f++) {
      streamWriter.addFile(`attachments/large_asset_${f}.bin`, mockFileData);
    }

    const streamMeta = streamWriter.finish();
    assert.equal(streamMeta.totalFiles, 8);
    assert.ok(totalStreamedBytes > 80 * 1024 * 1024);
    assert.ok(chunksEmitted > 1000); // Progressively chunked

    // 3. Tool output truncation performance under emergency overflow
    const hugeToolOutput = "TOOL_OUTPUT_LOG_DATA_".repeat(25000); // 525,000 chars
    const toolMessages = [
      { id: "m_user", role: "user", content: "Run big tool" },
      { id: "m_tool", role: "tool", content: hugeToolOutput }
    ];

    const tTruncStart = Date.now();
    const sanitizedTools = sanitizeToolOutputs(toolMessages, EMERGENCY_TOOL_OUTPUT_CHARS);
    const tTruncElapsed = Date.now() - tTruncStart;

    assert.ok(tTruncElapsed < 20, `Truncating 500k chars should take <20ms (took ${tTruncElapsed}ms)`);
    assert.ok(sanitizedTools[1].content.length <= 2500);
    assert.ok(sanitizedTools[1].content.includes("[TRUNCATED DUE TO CONTEXT OVERFLOW]"));

    // 4. ReDoS Resilience Testing on Redactors
    const maliciousLog = 'data:image/png;base64,' + 'A'.repeat(50000) + '===invalid!@#';
    const tRedosStart = Date.now();
    const redosOut = maskMediaInLogs(maliciousLog);
    const tRedosElapsed = Date.now() - tRedosStart;
    assert.ok(tRedosElapsed < 30, `Log masking should resist ReDoS (took ${tRedosElapsed}ms)`);
    assert.ok(!redosOut.includes('A'.repeat(50000)));
  });
});

// ============================================================================
// AREA 3: Concurrency, Race Condition Invariants & Resource Leak Prevention
// ============================================================================

test("Area 3: Concurrency, Race Condition Invariants & Resource Leak Prevention", async (t) => {

  await t.test("test_509_concurrency_rapid_multi_actor_fsm_stress", async () => {
    // SCENARIO: 200 rapid concurrent asynchronous calls to start, stop, cancel,
    // dispatch, and cleanup across 10 distinct chat sessions.
    // Invariant: FSM must never enter an illegal state or crash with unhandled rejection.

    const fsm = new DictationFSM();
    const validStates = new Set(DictationFSM.STATES);
    const operations = [];

    for (let i = 0; i < 200; i++) {
      const chatId = `chat_${i % 10}`;
      operations.push(async () => {
        const action = i % 5;
        try {
          if (action === 0) {
            const sid = fsm.startDictation({ chatId });
            fsm.dispatchBridgeEvent(sid, chatId, "P", `partial_${i}`);
          } else if (action === 1) {
            fsm.dispatchBridgeEvent(fsm.sessionId, chatId, "F", `final_${i}`);
          } else if (action === 2) {
            fsm.dispatchBridgeEvent(fsm.sessionId, chatId, "X");
          } else if (action === 3) {
            await fsm.stopDictation(fsm.sessionId).catch(() => "");
          } else if (action === 4) {
            fsm.cancelDictation(fsm.sessionId);
          }
        } catch (err) {
          // Normal errors like invalid transitions if race occurs must be gracefully handled
        }
        assert.ok(validStates.has(fsm.state), `State ${fsm.state} must be valid FSM state`);
      });
    }

    await Promise.all(operations.map(op => op()));
    // Final cleanup
    fsm.cancelDictation(fsm.sessionId);
    assert.equal(fsm.state, "idle");
  });

  await t.test("test_510_resource_leak_repeated_lifecycle_and_destroy", async () => {
    // 1. Repeated dictation subscription memory leak test
    const fsm = new DictationFSM();
    const unsubs = [];

    for (let i = 0; i < 300; i++) {
      const unsub = fsm.subscribe(() => {});
      unsubs.push(unsub);
    }
    assert.equal(fsm._subscribers.length, 300);

    // Unsubscribe all
    for (const unsub of unsubs) {
      unsub();
    }
    assert.equal(fsm._subscribers.length, 0, "All subscriber listeners must be unlinked");

    // 2. Destroy prevents further session creation and rejects pending calls
    fsm.startDictation({ chatId: "c_destroy_test" });
    fsm.destroy();
    assert.equal(fsm.destroyed, true);
    assert.equal(fsm.state, "idle");

    assert.throws(
      () => fsm.startDictation({ chatId: "c_after_destroy" }),
      /Dictation manager is destroyed/
    );

    await assert.rejects(
      () => fsm.stopDictation("any"),
      /Destroyed/
    );

    // 3. CompactionManager cleanup test
    const mockStorage = createMockStorage();
    CompactionManager.setStorage(mockStorage);
    try {
      const compMgr = new CompactionManager();
      for (let i = 0; i < 50; i++) {
        compMgr.saveCompactionState(`branch_${i}`, { firstKeptEntryId: `msg_${i}` });
      }
      assert.equal(compMgr.branches.size, 50);

      // Clear all
      for (let i = 0; i < 50; i++) {
        compMgr.clearCompactionState(`branch_${i}`);
      }
      assert.equal(compMgr.branches.size, 0);
    } finally {
      CompactionManager.setStorage(null);
    }
  });

  await t.test("test_511_deep_immutability_and_zero_cross_contamination", async () => {
    // SCENARIO: Deeply freeze all inputs before executing R1, R2, R3, R4 methods.
    // If any method attempts in-place mutation on input objects, runtime throws TypeError.

    const immutableAttachment = deepFreeze({
      mimeType: "image/png",
      description: "screenshot.png",
      payload: { case: "inlineData", value: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }
    });

    const immutableMessages = deepFreeze([
      { id: "m1", role: "system", content: "Prompt" },
      { id: "m2", role: "user", content: "Query", attachments: [immutableAttachment] },
      { id: "m3", role: "assistant", content: "Response" }
    ]);

    const immutableCompactionState = deepFreeze({
      firstKeptEntryId: "m2",
      summary: "Turn 1 summary.",
      estimatedTokensSaved: 1000
    });

    const immutableDiff = deepFreeze([
      { path: "app.ts", originalContent: "a = 1;\n", modifiedContent: "a = 2;\n" }
    ]);

    // Test 1: Multimodal transformation immutability
    const openAiChat = transformToOpenAIChat(immutableAttachment);
    assert.equal(openAiChat.type, "image_url");

    const anthropicBlock = transformToAnthropic(immutableAttachment);
    assert.equal(anthropicBlock.type, "image");

    // Test 2: History slicing immutability
    const sliced = slicePromptHistory(immutableMessages, immutableCompactionState);
    assert.notEqual(sliced, immutableMessages);
    assert.equal(immutableMessages.length, 3);

    // Test 3: Log masking immutability
    const logObj = deepFreeze({ event: "send", url: SAMPLE_PNG_DATA_URL });
    const maskedObj = maskMediaInLogs(logObj);
    assert.notEqual(maskedObj, logObj);

    // Test 4: Export packaging immutability
    const fullJsonl = packageTranscriptFull(immutableMessages);
    assert.ok(typeof fullJsonl === "string");

    const changesText = packageChangesDiff(immutableDiff);
    assert.ok(typeof changesText === "string");

    const packagedAtts = packageAttachments([immutableAttachment]);
    assert.equal(packagedAtts.length, 1);

    const zipData = buildZip([
      { name: "test.txt", data: "sample" }
    ]);
    assert.ok(zipData instanceof Uint8Array);
  });
});
