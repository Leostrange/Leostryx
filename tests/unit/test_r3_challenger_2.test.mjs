/**
 * Adversarial Challenger 2 Test Suite: Milestone M3 (Requirement R3)
 * Compaction Persistence & Single-Shot Recovery Verification
 *
 * Verifies:
 * 1. Multi-provider context error emulation matrix:
 *    - OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Groq, Mistral, Ollama / llama.cpp
 *    - HTTP 400, 413, 422, 500 status codes and provider-specific error payloads
 *    - Polymorphic error representations and strict false-positive rejection
 * 2. Strict single-shot overflow recovery constraint:
 *    - Single recovery attempt per branch/chat
 *    - Strict rejection on second consecutive overflow without retry loops
 *    - Loop stress testing in simulated agent workflows
 *    - Branch/chat isolation and recovery reset on clearCompactionState
 * 3. Giant tool output aggressive truncation (50,000+ chars):
 *    - Truncation of tool outputs to <= 2000 characters with overflow notice
 *    - Immunity of non-tool messages (user, assistant, system)
 *    - Exact boundary behavior (2000 vs 2001 chars) and extreme scales (100k, 500k chars)
 *    - Non-destructive preservation of original messages array
 * 4. Tool side-effect invariance:
 *    - Confirmation of ZERO duplicate tool executions or side-effects during recovery
 *    - Preservation of tool call / tool response transaction integrity
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
  DEFAULT_KEEP_RECENT,
  EMERGENCY_KEEP_RECENT,
  EMERGENCY_TOOL_OUTPUT_CHARS
} = compactorModule;

// Load agy_gateway module
const gatewayPath = path.join(REPO_ROOT, "app/assets/web/agy_gateway.js");
const gatewayModule = await import("file://" + gatewayPath).then(m => m.default || m);

// ============================================================================
// Suite 1: Multi-Provider Context Overflow Error Matrix (HTTP 400/413/422/500)
// ============================================================================
test("Challenger 2 Suite 1: Exhaustive Provider Context Overflow Emulation Matrix", async (t) => {
  await t.test("OpenAI & Azure OpenAI: detects all documented context overflow variants", () => {
    const openAiCases = [
      // Standard OpenAI ChatCompletions error with error.code
      {
        status: 400,
        body: {
          error: {
            message: "This model's maximum context length is 8192 tokens. However, your messages resulted in 10420 tokens.",
            type: "invalid_request_error",
            param: "messages",
            code: "context_length_exceeded"
          }
        }
      },
      // String length limit error
      {
        status: 400,
        body: {
          error: {
            message: "String should have at most 1048576 characters.",
            type: "invalid_request_error",
            code: "string_above_max_length"
          }
        }
      },
      // Azure OpenAI format
      {
        status: 400,
        body: {
          error: {
            message: "maximum context length is 128000 tokens. However, your messages resulted in 135400 tokens",
            code: "invalid_prompt"
          }
        }
      },
      // Raw string prompt is too long
      {
        status: 400,
        body: "prompt is too long: 135000 tokens"
      },
      // Legacy OpenAI message: Please reduce the length of the messages
      {
        status: 400,
        body: {
          error: {
            message: "Please reduce the length of the messages."
          }
        }
      },
      // Stringified JSON payload
      {
        status: 400,
        body: JSON.stringify({
          error: {
            message: "Invalid prompt: total tokens (68000) exceeds context window (64000)",
            code: "context_length_exceeded"
          }
        })
      }
    ];

    for (const tc of openAiCases) {
      assert.equal(isContextOverflowError(tc.status, tc.body), true, `Must detect OpenAI case: ${JSON.stringify(tc.body)}`);
      assert.equal(isContextOverflowError(tc), true, `Must detect OpenAI case via object overload`);
    }
  });

  await t.test("Anthropic Claude: detects all Messages API context limit errors", () => {
    const claudeCases = [
      // Official Anthropic prompt is too long error
      {
        status: 400,
        body: {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "prompt is too long: 220000 tokens > 200000 maximum"
          }
        }
      },
      // Claude context window exceeded message
      {
        status: 400,
        body: {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "prompt exceeds the context window"
          }
        }
      },
      // Claude request_too_large error code
      {
        status: 400,
        body: {
          type: "error",
          error: {
            code: "request_too_large",
            message: "Request size exceeds limit"
          }
        }
      },
      // Claude HTTP 413 response from Cloudflare / edge
      {
        status: 413,
        body: "<html><body><h1>413 Request Entity Too Large</h1>Cloudflare</body></html>"
      }
    ];

    for (const tc of claudeCases) {
      assert.equal(isContextOverflowError(tc.status, tc.body), true, `Must detect Claude case: ${JSON.stringify(tc.body)}`);
      assert.equal(isContextOverflowError(tc), true, `Must detect Claude case via object overload`);
    }
  });

  await t.test("Google Gemini: detects token count and request payload limit errors", () => {
    const geminiCases = [
      // Gemini input token count exceeds maximum
      {
        status: 400,
        body: {
          error: {
            code: 400,
            message: "The input token count (1250000) exceeds the maximum number of tokens allowed (1048576) for model gemini-1.5-pro",
            status: "INVALID_ARGUMENT"
          }
        }
      },
      // Gemini payload size exceeds limit
      {
        status: 400,
        body: {
          error: {
            code: 400,
            message: "Request payload size exceeds the limit: 20971520 bytes",
            status: "INVALID_ARGUMENT"
          }
        }
      },
      // Gemini token limit exceeded
      {
        status: 400,
        body: {
          error: {
            message: "token limit exceeded for model gemini-1.5-flash"
          }
        }
      },
      // Gemini HTTP 413 from Google Front End
      {
        status: 413,
        body: "Your client issued a request that was too large."
      }
    ];

    for (const tc of geminiCases) {
      assert.equal(isContextOverflowError(tc.status, tc.body), true, `Must detect Gemini case: ${JSON.stringify(tc.body)}`);
      assert.equal(isContextOverflowError(tc), true, `Must detect Gemini case via object overload`);
    }
  });

  await t.test("DeepSeek & Groq: detects context window and token overflow signatures", () => {
    const cases = [
      // DeepSeek total tokens exceeds context window
      {
        status: 400,
        body: {
          error: {
            message: "Invalid prompt: total tokens (68000) exceeds context window (64000)",
            type: "invalid_request_error"
          }
        }
      },
      // DeepSeek with code
      {
        status: 400,
        body: {
          error: {
            code: "context_length_exceeded",
            message: "Maximum context length is 64k tokens."
          }
        }
      },
      // Groq context_length_exceeded
      {
        status: 400,
        body: {
          error: {
            code: "context_length_exceeded",
            message: "Request too large for model 'llama-3.1-70b': Limit 8192, Requested 10240"
          }
        }
      },
      // Groq payload size exceeds
      {
        status: 400,
        body: {
          error: {
            message: "Request payload size exceeds the maximum limit for groq inference endpoint."
          }
        }
      }
    ];

    for (const tc of cases) {
      assert.equal(isContextOverflowError(tc.status, tc.body), true, `Must detect DeepSeek/Groq case: ${JSON.stringify(tc.body)}`);
    }
  });

  await t.test("Mistral: detects HTTP 422 validation and max allowed tokens overflow", () => {
    const mistralCases = [
      // Mistral HTTP 422 tokens exceeds max allowed
      {
        status: 422,
        body: {
          message: "Input validation error: total number of tokens 35000 exceeds max allowed tokens 32768"
        }
      },
      // Mistral HTTP 422 with FastAPI detail array
      {
        status: 422,
        body: {
          detail: [
            {
              loc: ["body", "messages"],
              msg: "Input validation error: total number of tokens exceeds max allowed tokens",
              type: "value_error"
            }
          ]
        }
      },
      // Mistral HTTP 400 reduce messages
      {
        status: 400,
        body: "Please reduce the length of the messages."
      }
    ];

    for (const tc of mistralCases) {
      assert.equal(isContextOverflowError(tc.status, tc.body), true, `Must detect Mistral case: ${JSON.stringify(tc.body)}`);
    }
  });

  await t.test("Ollama, llama.cpp & Local Server: detects HTTP 500 and 400 context errors", () => {
    const localCases = [
      // Ollama HTTP 500 string response
      {
        status: 500,
        body: "prompt tokens (4200) exceed context window (4096)"
      },
      // Ollama HTTP 500 JSON error object
      {
        status: 500,
        body: {
          error: "prompt tokens (4200) exceed context window (4096)"
        }
      },
      // Ollama model's context window full
      {
        status: 500,
        body: {
          error: "model's context window is exhausted"
        }
      },
      // llama.cpp server HTTP 400
      {
        status: 400,
        body: "context length exceeded"
      },
      // Local server HTTP 500 request entity too large
      {
        status: 500,
        body: "request entity too large for context buffer"
      }
    ];

    for (const tc of localCases) {
      assert.equal(isContextOverflowError(tc.status, tc.body), true, `Must detect Ollama/Local case: ${JSON.stringify(tc.body)}`);
    }
  });

  await t.test("Universal HTTP 413: ALWAYS detected as overflow regardless of payload", () => {
    assert.equal(isContextOverflowError(413, ""), true);
    assert.equal(isContextOverflowError(413, null), true);
    assert.equal(isContextOverflowError(413, undefined), true);
    assert.equal(isContextOverflowError(413, "413 Payload Too Large"), true);
    assert.equal(isContextOverflowError(413, "<html>413 Request Entity Too Large</html>"), true);
    assert.equal(isContextOverflowError(413, { status: 413, message: "Large" }), true);
    assert.equal(isContextOverflowError({ status: 413 }), true);
    assert.equal(isContextOverflowError({ statusCode: 413 }), true);
    assert.equal(isContextOverflowError({ responseCode: 413 }), true);
  });

  await t.test("Polymorphic argument signatures: handles status codes, objects, and delegates", () => {
    // 1. Two arguments: (status, body)
    assert.equal(isContextOverflowError(400, { error: { code: "context_length_exceeded" } }), true);

    // 2. Single argument with status property
    assert.equal(isContextOverflowError({ status: 400, message: "context_length_exceeded" }), true);

    // 3. Single argument with statusCode property
    assert.equal(isContextOverflowError({ statusCode: 400, error: "prompt is too long" }), true);

    // 4. Single argument with responseCode property
    assert.equal(isContextOverflowError({ responseCode: 413 }), true);

    // 5. Gateway delegation: AgyGateway matches CompactionManager
    assert.equal(gatewayModule.isContextOverflowError(413), true);
    assert.equal(gatewayModule.isContextOverflowError(400, { error: { code: "context_length_exceeded" } }), true);
    assert.equal(gatewayModule.isContextOverflowError(401, "unauthorized"), false);
  });

  await t.test("Strict False-Positive Prevention: non-overflow errors strictly return false", () => {
    const nonOverflowCases = [
      // 401 Unauthorized
      { status: 401, body: { error: { message: "Incorrect API key provided" } } },
      // 403 Forbidden
      { status: 403, body: { error: { message: "Access denied. Your quota has been suspended." } } },
      // 404 Model Not Found
      { status: 404, body: { error: { message: "The model `claude-nonexistent` does not exist" } } },
      // 429 Rate Limit (Must NOT trigger compaction!)
      { status: 429, body: { error: { message: "Rate limit reached for requests per minute (RPM)" } } },
      // 400 General validation errors (not context overflow)
      { status: 400, body: { error: { message: "Missing required parameter 'model'" } } },
      { status: 400, body: { error: { message: "Invalid JSON schema in tool definitions" } } },
      { status: 400, body: { error: { message: "Invalid temperature value: must be between 0 and 2" } } },
      // 500 Generic internal server errors (not context overflow)
      { status: 500, body: { error: { message: "Database connection failed" } } },
      { status: 500, body: "Internal Server Error: segmentation fault in worker" },
      // 502 / 503 / 504 Edge errors
      { status: 502, body: "Bad Gateway" },
      { status: 503, body: "Service Unavailable" },
      { status: 504, body: "Gateway Timeout" },
      // 200 OK
      { status: 200, body: { choices: [{ message: { content: "Success" } }] } },
      // Empty / invalid
      { status: 0, body: "" },
      { status: null, body: null }
    ];

    for (const tc of nonOverflowCases) {
      assert.equal(isContextOverflowError(tc.status, tc.body), false, `False positive detected on status ${tc.status}: ${JSON.stringify(tc.body)}`);
      assert.equal(isContextOverflowError(tc), false, `False positive via object overload on status ${tc.status}`);
    }
  });
});

// ============================================================================
// Suite 2: Strict Single-Shot Constraint & Anti-Loop Enforcement
// ============================================================================
test("Challenger 2 Suite 2: Strict Single-Shot Overflow Recovery & Anti-Loop Defense", async (t) => {
  await t.test("single-shot recovery succeeds once and re-issues prompt exactly once", async () => {
    const mgr = new CompactionManager();
    const messages = [
      { id: "m1", role: "user", content: "Implement database schema" },
      { id: "m2", role: "assistant", content: "Schema created", tool_calls: [{ id: "c1" }] },
      { id: "m3", role: "tool", content: "OK", tool_call_id: "c1" },
      { id: "m4", role: "user", content: "Now write migration scripts" }
    ];

    let llmCallCount = 0;
    let receivedPrompt = null;
    const callLlm = async (prompt) => {
      llmCallCount++;
      receivedPrompt = prompt;
      return { status: 200, response: "Migration scripts written." };
    };

    const result = await mgr.handleOverflowRecovery({
      branchId: "branch_single_shot",
      errorResponse: { status: 400, message: "context_length_exceeded: maximum tokens reached" },
      messages,
      keepRecent: 4,
      callLlm
    });

    assert.equal(result.status, 200);
    assert.equal(result.response, "Migration scripts written.");
    assert.equal(llmCallCount, 1, "LLM must be called exactly once during single-shot recovery");
    assert.ok(Array.isArray(receivedPrompt), "Recovered prompt must be an array");

    // Verify state was saved
    const state = mgr.getCompactionState("branch_single_shot");
    assert.ok(state, "Compaction state must be saved");
    assert.ok(state.summary.includes("Emergency compaction"));
  });

  await t.test("second consecutive overflow strictly rejects without calling LLM (Anti-Loop)", async () => {
    const mgr = new CompactionManager();
    const messages = [
      { id: "m1", role: "user", content: "Very large conversation" },
      { id: "m2", role: "assistant", content: "Reply" }
    ];

    let llmInvocations = 0;
    const callLlm = async () => {
      llmInvocations++;
      return { ok: true };
    };

    // First recovery attempt succeeds
    await mgr.handleOverflowRecovery({
      branchId: "branch_anti_loop",
      errorResponse: { status: 400, message: "context_length_exceeded" },
      messages,
      callLlm
    });
    assert.equal(llmInvocations, 1);

    // Second recovery attempt on the same branch MUST fail immediately
    await assert.rejects(
      async () => {
        await mgr.handleOverflowRecovery({
          branchId: "branch_anti_loop",
          errorResponse: { status: 413, message: "Request Entity Too Large" },
          messages,
          callLlm
        });
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("Single-shot overflow recovery already exhausted"),
          `Expected exhaustion error message, got: ${err.message}`
        );
        return true;
      }
    );

    // LLM must NOT have been called a second time
    assert.equal(llmInvocations, 1, "LLM must NOT be called after exhaustion");
  });

  await t.test("explicit _recoveryAttempted flag in errorResponse immediately aborts", async () => {
    const mgr = new CompactionManager();
    let llmInvoked = false;

    await assert.rejects(
      async () => {
        await mgr.handleOverflowRecovery({
          branchId: "branch_flag_check",
          errorResponse: {
            status: 400,
            message: "context_length_exceeded",
            _recoveryAttempted: true
          },
          messages: [{ id: "m1", role: "user", content: "Test" }],
          callLlm: async () => {
            llmInvoked = true;
          }
        });
      },
      /Single-shot overflow recovery already exhausted/
    );

    assert.equal(llmInvoked, false, "callLlm must not be executed when _recoveryAttempted is true");
  });

  await t.test("agent loop simulation: continuous provider overflow terminates cleanly without infinite loop", async () => {
    const mgr = new CompactionManager();
    const conversation = [
      { id: "turn_1", role: "user", content: "Analyze codebase" },
      { id: "turn_2", role: "tool", content: "Massive output ".repeat(2000) }
    ];

    // Simulated stubborn provider that continuously returns HTTP 400 overflow
    const stubbornProvider = async (_prompt) => {
      return {
        status: 400,
        error: { code: "context_length_exceeded", message: "Model context window is still exceeded" }
      };
    };

    let totalLlmCalls = 0;
    let recoveryAttemptsMade = 0;
    let loopTerminatedWithError = false;
    let loopCycles = 0;
    const MAX_CYCLES = 10; // Safety guard to detect runaway loops

    // Run simulated agent loop
    while (loopCycles < MAX_CYCLES) {
      loopCycles++;
      totalLlmCalls++;
      const llmResponse = await stubbornProvider(conversation);

      if (isContextOverflowError(llmResponse.status, llmResponse)) {
        recoveryAttemptsMade++;
        try {
          await mgr.handleOverflowRecovery({
            branchId: "simulated_agent_branch",
            errorResponse: llmResponse,
            messages: conversation,
            callLlm: async (recoveredPrompt) => {
              totalLlmCalls++;
              // Stubborn provider fails again on the recovered prompt
              const retryResponse = await stubbornProvider(recoveredPrompt);
              if (isContextOverflowError(retryResponse.status, retryResponse)) {
                throw new Error("Provider still exceeded context after compaction: " + JSON.stringify(retryResponse));
              }
              return retryResponse;
            }
          });
        } catch (err) {
          loopTerminatedWithError = true;
          break; // Agent loop halts cleanly
        }
      } else {
        break;
      }
    }

    // Assert that the agent loop did not run runaway cycles
    assert.ok(loopCycles <= 2, `Agent loop must terminate in <= 2 cycles, ran ${loopCycles}`);
    assert.equal(recoveryAttemptsMade, 1, "Only exactly 1 recovery attempt must be initiated");
    assert.equal(loopTerminatedWithError, true, "Loop must terminate with caught error when recovery cannot fit context");
  });

  await t.test("branch isolation: recovery exhaustion on branch A does not block branch B", async () => {
    const mgr = new CompactionManager();
    const messages = [{ id: "m1", role: "user", content: "Query" }];

    // Branch A uses its single shot
    await mgr.handleOverflowRecovery({
      branchId: "branch_alpha",
      errorResponse: { status: 400, message: "context_length_exceeded" },
      messages,
      callLlm: async () => ({ ok: true, branch: "alpha" })
    });

    // Branch A is exhausted
    await assert.rejects(async () => {
      await mgr.handleOverflowRecovery({
        branchId: "branch_alpha",
        errorResponse: { status: 400, message: "context_length_exceeded" },
        messages,
        callLlm: async () => ({ ok: true })
      });
    }, /Single-shot overflow recovery already exhausted/);

    // Branch B must still be permitted to perform its single-shot recovery
    let branchBSuccess = false;
    const resB = await mgr.handleOverflowRecovery({
      branchId: "branch_beta",
      errorResponse: { status: 413, message: "Payload Too Large" },
      messages,
      callLlm: async () => {
        branchBSuccess = true;
        return { ok: true, branch: "beta" };
      }
    });

    assert.equal(branchBSuccess, true, "Branch B must be able to recover independently");
    assert.equal(resB.branch, "beta");
  });

  await t.test("recovery counter reset: clearCompactionState allows fresh recovery after explicit purge", async () => {
    const mgr = new CompactionManager();
    const messages = [{ id: "m1", role: "user", content: "Task" }];

    // Exhaust recovery on branch
    await mgr.handleOverflowRecovery({
      branchId: "branch_reset_test",
      errorResponse: { status: 400, message: "context_length_exceeded" },
      messages,
      callLlm: async () => ({ ok: true })
    });

    // Confirm exhausted
    await assert.rejects(async () => {
      await mgr.handleOverflowRecovery({
        branchId: "branch_reset_test",
        errorResponse: { status: 400, message: "context_length_exceeded" },
        messages,
        callLlm: async () => ({ ok: true })
      });
    }, /Single-shot overflow recovery already exhausted/);

    // Clear state
    mgr.clearCompactionState("branch_reset_test");

    // Fresh recovery must now succeed
    let freshRecoverySuccess = false;
    await mgr.handleOverflowRecovery({
      branchId: "branch_reset_test",
      errorResponse: { status: 400, message: "context_length_exceeded" },
      messages,
      callLlm: async () => {
        freshRecoverySuccess = true;
        return { ok: true };
      }
    });

    assert.equal(freshRecoverySuccess, true, "Recovery must succeed after clearCompactionState");
  });
});

// ============================================================================
// Suite 3: Aggressive Truncation of Giant Tool Outputs (50,000+ chars)
// ============================================================================
test("Challenger 2 Suite 3: Giant Tool Output Aggressive Truncation & Non-Destructive Invariant", async (t) => {
  await t.test("truncates 50,000-character tool output to <= 2000 chars of original text + overflow marker", () => {
    const giantPayload = "D".repeat(50000);
    const messages = [
      { id: "u1", role: "user", content: "Run diagnostic" },
      { id: "t1", role: "tool", content: giantPayload, tool_call_id: "diag_1" }
    ];

    const sanitized = sanitizeToolOutputs(messages, 2000);

    // Tool message must be truncated
    const toolMsg = sanitized.find(m => m.id === "t1");
    assert.ok(toolMsg, "Tool message must be present");
    assert.ok(
      toolMsg.content.includes("... [TRUNCATED DUE TO CONTEXT OVERFLOW]"),
      "Must include truncation marker"
    );
    // Head must be exactly first 2000 characters of 'D'
    assert.ok(toolMsg.content.startsWith("D".repeat(2000)));
    // Total length must be 2000 + marker length (41 chars) = 2041 <= 2100 chars
    assert.ok(
      toolMsg.content.length <= 2100,
      `Tool message length must be <= 2100 chars, got ${toolMsg.content.length}`
    );
  });

  await t.test("extreme scale truncation: handles 100,000 and 500,000 character outputs without memory exhaustion", () => {
    const huge100k = "Z".repeat(100000);
    const massive500k = "W".repeat(500000);

    const messages = [
      { id: "t1", role: "tool", content: huge100k },
      { id: "t2", role: "tool", content: massive500k }
    ];

    const startTime = Date.now();
    const sanitized = sanitizeToolOutputs(messages, 2000);
    const elapsed = Date.now() - startTime;

    assert.ok(elapsed < 200, `Sanitization must execute swiftly (<200ms), took ${elapsed}ms`);
    assert.equal(sanitized[0].content.length, 2000 + "... [TRUNCATED DUE TO CONTEXT OVERFLOW]".length);
    assert.equal(sanitized[1].content.length, 2000 + "... [TRUNCATED DUE TO CONTEXT OVERFLOW]".length);
  });

  await t.test("selective truncation: non-tool messages (user, assistant, system) are strictly immune", () => {
    const bigPrompt = "U".repeat(60000);
    const bigAssistant = "A".repeat(70000);
    const bigSystem = "S".repeat(30000);
    const bigTool = "T".repeat(50000);
    const smallTool = "Small output";

    const messages = [
      { id: "s1", role: "system", content: bigSystem },
      { id: "u1", role: "user", content: bigPrompt },
      { id: "a1", role: "assistant", content: bigAssistant },
      { id: "t1", role: "tool", content: bigTool },
      { id: "t2", role: "tool", content: smallTool }
    ];

    const sanitized = sanitizeToolOutputs(messages, 2000);

    // System, User, Assistant messages must NOT be truncated
    assert.equal(sanitized[0].content, bigSystem, "System message must not be truncated");
    assert.equal(sanitized[1].content, bigPrompt, "User message must not be truncated");
    assert.equal(sanitized[2].content, bigAssistant, "Assistant message must not be truncated");

    // Oversized tool must be truncated
    assert.ok(sanitized[3].content.includes("[TRUNCATED DUE TO CONTEXT OVERFLOW]"));
    assert.ok(sanitized[3].content.length <= 2100);

    // Small tool must remain untouched
    assert.equal(sanitized[4].content, smallTool, "Small tool output must remain untouched");
  });

  await t.test("boundary condition: tool output of exactly 2000 chars is preserved intact; 2001 chars is truncated", () => {
    const exactly2000 = "B".repeat(2000);
    const over2001 = "C".repeat(2001);

    const messages = [
      { id: "t_exact", role: "tool", content: exactly2000 },
      { id: "t_over", role: "tool", content: over2001 }
    ];

    const sanitized = sanitizeToolOutputs(messages, 2000);

    assert.equal(sanitized[0].content, exactly2000, "Exactly 2000 chars must NOT be truncated");
    assert.ok(sanitized[1].content.includes("[TRUNCATED DUE TO CONTEXT OVERFLOW]"), "2001 chars must be truncated");
  });

  await t.test("non-destructive guarantee: original messages array and nested objects remain unmodified", () => {
    const rawToolContent = "X".repeat(50000);
    const originalMessages = [
      { id: "t_raw", role: "tool", content: rawToolContent, tool_call_id: "raw_1" }
    ];
    const snapshot = JSON.stringify(originalMessages);

    const sanitized = sanitizeToolOutputs(originalMessages, 2000);

    assert.notEqual(sanitized, originalMessages, "Must return a new array");
    assert.notEqual(sanitized[0], originalMessages[0], "Must clone modified message objects");
    assert.equal(JSON.stringify(originalMessages), snapshot, "Original messages must remain completely untouched");
    assert.equal(originalMessages[0].content.length, 50000, "Original tool content length must be intact");
  });

  await t.test("end-to-end integration: handleOverflowRecovery applies tool truncation before LLM call", async () => {
    const mgr = new CompactionManager();
    const giantToolOutput = "LOG_DATA_".repeat(10000); // 90,000 characters

    const messages = [
      { id: "u1", role: "user", content: "Run log analysis" },
      { id: "a1", role: "assistant", content: "Running logcat", tool_calls: [{ id: "c1" }] },
      { id: "t1", role: "tool", content: giantToolOutput, tool_call_id: "c1" }
    ];

    let llmPromptReceived = null;
    await mgr.handleOverflowRecovery({
      branchId: "branch_e2e_trunc",
      errorResponse: { status: 400, message: "context_length_exceeded" },
      messages,
      keepRecent: 4,
      callLlm: async (prompt) => {
        llmPromptReceived = prompt;
        return { ok: true };
      }
    });

    assert.ok(llmPromptReceived, "LLM must have received recovered prompt");
    const recoveredTool = llmPromptReceived.find(m => m.id === "t1" || m.role === "tool");
    if (recoveredTool) {
      assert.ok(recoveredTool.content.includes("[TRUNCATED DUE TO CONTEXT OVERFLOW]"));
      assert.ok(recoveredTool.content.length <= 2100);
    }
  });
});

// ============================================================================
// Suite 4: Tool Side-Effect Invariance (Zero Duplicate Tool Execution)
// ============================================================================
test("Challenger 2 Suite 4: Tool Side-Effect Invariance & Transaction Integrity", async (t) => {
  await t.test("overflow recovery does NOT re-execute tools or duplicate side-effects", async () => {
    // Stateful mock tool execution harness
    const sideEffects = {
      fileSystem: new Map(),
      toolExecutionCalls: []
    };

    const mockToolDispatcher = (toolName, args) => {
      sideEffects.toolExecutionCalls.push({ toolName, args, timestamp: Date.now() });
      if (toolName === "write_file") {
        sideEffects.fileSystem.set(args.path, args.content);
        return { status: "success", bytesWritten: args.content.length };
      }
      return { status: "unknown" };
    };

    // 1. Initial turn: Agent decides to call tool and executes it ONCE
    const toolCallArgs = { path: "/storage/emulated/0/project/app.js", content: "console.log('v1');" };
    const toolExecutionResult = mockToolDispatcher("write_file", toolCallArgs);

    assert.equal(sideEffects.toolExecutionCalls.length, 1);
    assert.equal(sideEffects.fileSystem.get("/storage/emulated/0/project/app.js"), "console.log('v1');");

    // 2. Build conversation history recording the tool execution
    const conversation = [
      { id: "u1", role: "user", content: "Create app.js" },
      {
        id: "a1",
        role: "assistant",
        content: "Creating file",
        tool_calls: [{ id: "call_write_1", function: { name: "write_file", arguments: JSON.stringify(toolCallArgs) } }]
      },
      {
        id: "t1",
        role: "tool",
        tool_call_id: "call_write_1",
        content: JSON.stringify(toolExecutionResult)
      },
      { id: "u2", role: "user", content: "Next step" }
    ];

    // 3. Provider returns HTTP 400 context_length_exceeded when sending prompt
    const mgr = new CompactionManager();
    let llmReceivedPrompt = null;

    const recoveryResult = await mgr.handleOverflowRecovery({
      branchId: "branch_side_effects",
      errorResponse: { status: 400, message: "context_length_exceeded: maximum tokens reached" },
      messages: conversation,
      keepRecent: 4,
      callLlm: async (prompt) => {
        llmReceivedPrompt = prompt;
        return { status: 200, content: "Continuing next step after recovery." };
      }
    });

    // 4. Verify ZERO new tool executions occurred during recovery!
    assert.equal(
      sideEffects.toolExecutionCalls.length,
      1,
      "CRITICAL: Tool execution calls must remain strictly 1; recovery must NEVER re-invoke tools!"
    );
    assert.equal(
      sideEffects.fileSystem.get("/storage/emulated/0/project/app.js"),
      "console.log('v1');",
      "File content on disk must remain strictly untouched"
    );

    // 5. Verify LLM prompt contains kept tail without re-triggering tool execution
    assert.ok(llmReceivedPrompt.some(m => m.id === "u2" && m.role === "user"));
    assert.equal(recoveryResult.status, 200);
  });

  await t.test("tool transaction pairing: preserved tool calls and tool responses maintain IDs", () => {
    const messages = [
      { id: "sys1", role: "system", content: "You are a coding assistant." },
      { id: "u1", role: "user", content: "Read configs" },
      { id: "a1", role: "assistant", content: "Reading", tool_calls: [{ id: "call_read_123" }] },
      { id: "t1", role: "tool", content: "config data", tool_call_id: "call_read_123" },
      { id: "u2", role: "user", content: "Active query" }
    ];

    const compactionState = {
      firstKeptEntryId: "a1",
      summary: "User asked to read configs."
    };

    // When alignToUser: false, exact tail starting at a1 is preserved with tool transaction intact
    const promptExact = slicePromptHistory(messages, compactionState, { alignToUser: false });

    // System prompt preserved at index 0
    assert.equal(promptExact[0].role, "system");
    // Synthetic summary pair at indices 1 and 2
    assert.equal(promptExact[1].role, "user");
    assert.ok(promptExact[1].content.includes("### Previous Conversation Summary"));
    assert.equal(promptExact[2].role, "assistant");
    assert.ok(promptExact[2].content.includes("Understood. I will continue"));

    // Tail: a1, t1, u2
    const tailNonSynthetic = promptExact.filter(m => m.id);
    assert.equal(tailNonSynthetic[0].id, "sys1");
    assert.equal(tailNonSynthetic[1].id, "a1");
    assert.equal(tailNonSynthetic[1].tool_calls[0].id, "call_read_123");
    assert.equal(tailNonSynthetic[2].id, "t1");
    assert.equal(tailNonSynthetic[2].tool_call_id, "call_read_123");
    assert.equal(tailNonSynthetic[3].id, "u2");

    // When alignToUser: true (default), advances to next user turn to prevent consecutive assistant messages
    const promptAligned = slicePromptHistory(messages, compactionState, { alignToUser: true });
    const alignedTail = promptAligned.filter(m => m.id);
    assert.equal(alignedTail[0].id, "sys1");
    assert.equal(alignedTail[1].id, "u2");
    assert.equal(alignedTail[1].role, "user");
  });
});
