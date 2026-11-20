/* Leostryx — Context Compaction, Persistence & Single-Shot Recovery Module (Requirement R3)
 *
 * Implements:
 * 1. Feature F12: Compaction Boundary Persistence
 *    - Persists firstKeptEntryId, structured summary, estimatedTokensSaved, compactedAt
 *    - In-memory branch management and localStorage persistence (key: agy_compaction_<chatId>)
 * 2. Feature F13: Restart & Reload History Slicing (slicePromptHistory)
 *    - Preserves system prompt(s) at index 0
 *    - Prunes messages prior to firstKeptEntryId from prompt payload while keeping full storage/UI history intact
 *    - Injects synthetic summary pair (user summary + assistant ACK)
 *    - Strict boundary alignment to user turn (role === 'user') to prevent orphan tool calls/responses
 * 3. Feature F14: Single-Shot Context Overflow Recovery
 *    - Universal error detection predicate isContextOverflowError(statusCode, responseBody)
 *    - Halves keepRecent window (e.g. 8 -> 4, 4 -> 2, minimum 2)
 *    - Aggressive tool output truncation (>2000 chars) with overflow notification marker
 *    - Anti-loop protection (_recoveryAttempted flag / recoveryAttempts registry)
 *    - Safe prompt re-issue exactly once with zero side-effects
 */

(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    var exp = factory();
    if (typeof window !== "undefined") {
      window.AgyCompactor = exp.AgyCompactor;
      window.CompactionManager = exp.CompactionManager;
    }
    if (typeof root !== "undefined") {
      root.AgyCompactor = exp.AgyCompactor;
      root.CompactionManager = exp.CompactionManager;
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ---- Constants ----
  var SUMMARY_HEADER = "### Previous Conversation Summary";
  var SUMMARY_ACK = "Understood. I will continue the conversation based on the above summary and subsequent messages.";
  var SUMMARY_ACK_RU = "Контекст предыдущих этапов задачи принят. Продолжаю выполнение текущей задачи.";
  var DEFAULT_THRESHOLD = 16;
  var DEFAULT_KEEP_RECENT = 8;
  var EMERGENCY_KEEP_RECENT = 4;
  var DEFAULT_CHAR_LIMIT = 80000;
  var MAX_TOOL_OUTPUT_CHARS = 8000;
  var EMERGENCY_TOOL_OUTPUT_CHARS = 2000;
  var STORAGE_KEY_PREFIX = "agy_compaction_";

  // Internal storage adapter
  var _customStorage = null;

  function getStorage() {
    if (_customStorage) return _customStorage;
    try {
      if (typeof localStorage !== "undefined" && localStorage !== null) {
        return localStorage;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Resolves a stable identifier for a message to serve as firstKeptEntryId.
   */
  function extractEntryId(msg, index) {
    if (!msg) return "turn_" + (index !== undefined ? index : 0);
    if (msg.id && typeof msg.id === "string") return msg.id;
    if (msg.entryId && typeof msg.entryId === "string") return msg.entryId;
    if (msg.step_id && typeof msg.step_id === "string") return msg.step_id;
    var role = msg.role || "unknown";
    var text = typeof msg.content === "string" ? msg.content.trim().slice(0, 32) : "";
    var hash = 0;
    for (var i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return "turn_" + (index !== undefined ? index : 0) + "_" + role + "_" + Math.abs(hash).toString(16).slice(0, 8);
  }

  /**
   * Universal error predicate to detect context length exceeded across all LLM providers.
   * Recognizes OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, Ollama, OpenRouter, and HTTP 413.
   */
  function isContextOverflowError(statusCode, responseBody) {
    var status = statusCode;
    var body = responseBody;

    // Single-argument overload handling: isContextOverflowError(errorResponse)
    if (typeof statusCode === "object" && statusCode !== null && responseBody === undefined) {
      status = statusCode.status || statusCode.statusCode || statusCode.responseCode || 0;
      body = statusCode;
    }

    // HTTP 413 Payload Too Large is ALWAYS classified as context overflow
    if (status === 413) {
      return true;
    }

    // Context length errors are returned under HTTP 400, 413, 422, or 500 (Ollama/llama.cpp)
    if (status !== 400 && status !== 422 && status !== 500) {
      return false;
    }

    if (!body) {
      return false;
    }

    // Extract text representation
    var text = "";
    if (typeof body === "string") {
      text = body;
    } else if (typeof body === "object") {
      // Check message / error / code fields specifically
      var innerMsg = body.message || body.error || body.body || "";
      try {
        if (typeof innerMsg === "object") {
          text = JSON.stringify(body);
        } else {
          text = String(innerMsg) + " " + JSON.stringify(body);
        }
      } catch (e) {
        text = String(innerMsg || body);
      }
    }

    var lower = text.toLowerCase();

    // 1. Exact API error codes & keys
    if (lower.indexOf("context_length_exceeded") >= 0) return true;
    if (lower.indexOf("string_above_max_length") >= 0) return true;
    if (lower.indexOf("prompt_too_long") >= 0) return true;
    if (lower.indexOf("request_too_large") >= 0) return true;
    if (lower.indexOf("context window") >= 0) return true;
    if (lower.indexOf("max_tokens") >= 0) return true;

    // 2. Provider error messages regex patterns
    var patterns = [
      /context[-_\s]length[-_\s]exceeded/i,
      /maximum\s+context\s+length/i,
      /prompt is too long/i,
      /prompt.*exceeds context/i,
      /exceeds the context window/i,
      /exceeds context window/i,
      /input token count.*exceeds/i,
      /exceeds the maximum number of tokens/i,
      /total tokens.*exceeds/i,
      /too many tokens/i,
      /model's context window/i,
      /request payload size exceeds/i,
      /payload too large/i,
      /request entity too large/i,
      /token limit exceeded/i,
      /reduce the length of the messages/i,
      /exceeds max allowed tokens/i
    ];

    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].test(lower)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Sanitizes and aggressively truncates large tool output messages.
   * Preserves head and tail while inserting an overflow warning marker.
   */
  function sanitizeToolOutputs(messages, maxChars) {
    if (!Array.isArray(messages)) return [];
    var limit = typeof maxChars === "number" && maxChars > 0 ? maxChars : EMERGENCY_TOOL_OUTPUT_CHARS;

    return messages.map(function (m) {
      if (m && m.role === "tool" && typeof m.content === "string" && m.content.length > limit) {
        return Object.assign({}, m, {
          content: m.content.slice(0, limit) + "... [TRUNCATED DUE TO CONTEXT OVERFLOW]"
        });
      }
      return m;
    });
  }

  /**
   * Slices conversation history for prompt reconstruction after compaction.
   *
   * Invariants:
   * - Preserves initial system prompt(s) at index 0.
   * - Prunes messages prior to firstKeptEntryId from outgoing prompt payload.
   * - Injects synthetic summary pair (user summary + assistant ACK).
   * - Preserves 100% of original messages array in storage and UI.
   * - Enforces boundary alignment:
   *   If boundary lands on a tool response or if alignToUser is enabled,
   *   advances to the next user turn to avoid orphan tool calls/responses.
   */
  function slicePromptHistory(messages, compactionState, options) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return Array.isArray(messages) ? messages.slice() : [];
    }

    if (!compactionState || (!compactionState.firstKeptEntryId && !compactionState.summary)) {
      return messages.slice();
    }

    options = options || {};
    var firstKeptEntryId = compactionState.firstKeptEntryId;
    var summary = compactionState.summary || "";

    // 1. Find index matching firstKeptEntryId
    var sliceIndex = -1;
    if (firstKeptEntryId) {
      sliceIndex = messages.findIndex(function (m, idx) {
        return (
          m &&
          (m.id === firstKeptEntryId ||
            m.entryId === firstKeptEntryId ||
            extractEntryId(m, idx) === firstKeptEntryId)
        );
      });

      // Fallback: check turn index tag pattern (^turn_(\d+))
      if (sliceIndex < 0 && typeof firstKeptEntryId === "string") {
        var match = firstKeptEntryId.match(/^turn_(\d+)/);
        if (match) {
          var parsedIdx = parseInt(match[1], 10);
          if (parsedIdx >= 0 && parsedIdx < messages.length) {
            sliceIndex = parsedIdx;
          }
        }
      }
    }

    if (sliceIndex < 0) {
      sliceIndex = 0; // Fallback if entry ID not found
    }

    // 2. Boundary alignment
    // By default, if options.alignToUser is true OR if boundary lands on a "tool" role,
    // advance to the next user message to avoid orphan tool responses.
    var shouldAlign = options.alignToUser !== undefined
      ? Boolean(options.alignToUser)
      : (compactionState.alignToUser !== undefined ? Boolean(compactionState.alignToUser) : true);

    var isBoundaryTool = messages[sliceIndex] && messages[sliceIndex].role === "tool";
    if (shouldAlign || isBoundaryTool) {
      var nextUserIdx = -1;
      for (var u = sliceIndex; u < messages.length; u++) {
        if (messages[u] && messages[u].role === "user") {
          nextUserIdx = u;
          break;
        }
      }
      if (nextUserIdx !== -1) {
        sliceIndex = nextUserIdx;
      } else if (messages[sliceIndex] && messages[sliceIndex].role === "tool") {
        var targetToolCallId = messages[sliceIndex].tool_call_id;
        var rewindIdx = sliceIndex;
        while (rewindIdx > 0) {
          rewindIdx--;
          var candidate = messages[rewindIdx];
          if (!candidate) continue;
          if (candidate.role === "assistant" && Array.isArray(candidate.tool_calls) && candidate.tool_calls.length > 0) {
            if (!targetToolCallId || candidate.tool_calls.some(function (tc) { return tc && tc.id === targetToolCallId; })) {
              sliceIndex = rewindIdx;
              break;
            }
          } else if (candidate.role === "user") {
            sliceIndex = rewindIdx;
            break;
          }
        }
        if (messages[sliceIndex] && messages[sliceIndex].role === "tool") {
          while (sliceIndex > 0 && messages[sliceIndex] && messages[sliceIndex].role === "tool") {
            sliceIndex--;
          }
        }
      }
    }

    // 3. Extract system messages before the slice boundary
    var systemMessages = messages.filter(function (m, idx) {
      return idx < sliceIndex && m && m.role === "system";
    });

    // 4. Extract kept tail
    var keptTail = messages.slice(sliceIndex);

    // 5. Assemble prompt payload
    var prompt = [];
    if (systemMessages.length > 0) {
      prompt.push.apply(prompt, systemMessages);
    }

    if (summary) {
      var summaryText = typeof summary === "string" ? summary : JSON.stringify(summary);
      var formattedSummary = summaryText.startsWith(SUMMARY_HEADER)
        ? summaryText
        : SUMMARY_HEADER + "\n" + summaryText;

      prompt.push({
        role: "user",
        content: formattedSummary
      });

      prompt.push({
        role: "assistant",
        content: options.summaryAck || SUMMARY_ACK
      });
    }

    prompt.push.apply(prompt, keptTail);
    return prompt;
  }

  /**
   * CompactionManager class managing multi-branch compaction state,
   * localStorage synchronization, prompt reconstruction, and overflow recovery.
   */
  function CompactionManager(options) {
    options = options || {};
    this.branches = new Map();
    this.recoveryAttempts = new Map();
    this.chatId = options.chatId || null;
  }

  CompactionManager.setStorage = function (storage) {
    _customStorage = storage;
  };

  CompactionManager.getStorage = function () {
    return getStorage();
  };

  /**
   * Saves compaction state for a branch.
   * Synchronizes with in-memory cache and localStorage (key: agy_compaction_<id>).
   */
  CompactionManager.prototype.saveCompactionState = function (branchId, state) {
    if (!branchId) branchId = "main";
    state = state || {};

    var record = {
      firstKeptEntryId: state.firstKeptEntryId || null,
      summary: state.summary || "",
      estimatedTokensSaved: Number(state.estimatedTokensSaved) || 0,
      compactedAt: state.compactedAt || Date.now()
    };

    if (state.alignToUser !== undefined) {
      record.alignToUser = Boolean(state.alignToUser);
    }

    this.branches.set(branchId, record);

    var storage = getStorage();
    if (storage) {
      try {
        storage.setItem(STORAGE_KEY_PREFIX + branchId, JSON.stringify(record));
        if (state.chatId && state.chatId !== branchId) {
          storage.setItem(STORAGE_KEY_PREFIX + state.chatId, JSON.stringify(record));
        }
      } catch (e) {}
    }

    return record;
  };

  /**
   * Retrieves compaction state for a branch.
   * Checks in-memory cache first, falling back to localStorage.
   */
  CompactionManager.prototype.getCompactionState = function (branchId) {
    if (!branchId) branchId = "main";

    if (this.branches.has(branchId)) {
      return this.branches.get(branchId);
    }

    var storage = getStorage();
    if (storage) {
      try {
        var raw = storage.getItem(STORAGE_KEY_PREFIX + branchId);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            this.branches.set(branchId, parsed);
            return parsed;
          }
        }
      } catch (e) {
        return null;
      }
    }

    return null;
  };

  /**
   * Loads compaction state from localStorage for a given chatId and branchId.
   */
  CompactionManager.prototype.loadCompactionState = function (chatId, branchId) {
    if (!branchId) branchId = "main";
    var storage = getStorage();
    if (!storage) {
      return this.getCompactionState(branchId);
    }

    try {
      var raw = (chatId ? storage.getItem(STORAGE_KEY_PREFIX + chatId) : null) ||
        storage.getItem(STORAGE_KEY_PREFIX + branchId);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          this.branches.set(branchId, parsed);
          return parsed;
        }
      }
    } catch (e) {}

    return this.getCompactionState(branchId);
  };

  /**
   * Clears compaction state and recovery attempts for a branch from memory and localStorage.
   */
  CompactionManager.prototype.clearCompactionState = function (branchId) {
    if (!branchId) branchId = "main";
    this.branches.delete(branchId);
    this.recoveryAttempts.delete(branchId);

    var storage = getStorage();
    if (storage) {
      try {
        storage.removeItem(STORAGE_KEY_PREFIX + branchId);
      } catch (e) {}
    }
  };

  /**
   * Reconstructs prompt with compaction slicing.
   *
   * By default, preserves exact firstKeptEntryId specified (e.g. in test_f12_03),
   * while aligning if the boundary is a tool message or if alignToUser is enabled.
   */
  CompactionManager.prototype.reconstructPromptWithCompaction = function (messages, branchId, options) {
    if (!branchId) branchId = "main";
    options = options || {};

    var compaction = this.getCompactionState(branchId);
    if (!compaction || !compaction.firstKeptEntryId) {
      return Array.isArray(messages) ? messages.slice() : [];
    }

    // Pass alignToUser option: false by default in reconstructPromptWithCompaction
    // unless explicitly specified or configured in compaction state.
    var opts = Object.assign({}, options, {
      alignToUser: options.alignToUser !== undefined
        ? options.alignToUser
        : (compaction.alignToUser !== undefined ? compaction.alignToUser : false)
    });

    return slicePromptHistory(messages, compaction, opts);
  };

  /**
   * Single-Shot Context Overflow Recovery.
   *
   * - Detects HTTP 400/413 context length exceeded via isContextOverflowError.
   * - Enforces anti-loop protection (throws if recovery already attempted).
   * - Applies emergency compaction: halves keepRecent, truncates tool outputs >2000 chars.
   * - Re-issues prompt once via callLlm.
   */
  CompactionManager.prototype.handleOverflowRecovery = function (params) {
    var self = this;
    params = params || {};
    var branchId = params.branchId || "main";
    var errorResponse = params.errorResponse;
    var messages = params.messages || [];
    var keepRecent = typeof params.keepRecent === "number" ? params.keepRecent : DEFAULT_KEEP_RECENT;
    var callLlm = params.callLlm;
    var chatId = params.chatId || null;

    return Promise.resolve().then(function () {
      var isOverflow = isContextOverflowError(errorResponse);
      if (!isOverflow) {
        throw new Error("Non-overflow error: " + JSON.stringify(errorResponse));
      }

      var attemptKey = (chatId ? chatId + ":" : "") + branchId;
      var attemptCount = self.recoveryAttempts.get(attemptKey) || self.recoveryAttempts.get(branchId) || 0;

      if (attemptCount >= 1 || (errorResponse && errorResponse._recoveryAttempted)) {
        throw new Error("Single-shot overflow recovery already exhausted. Aborting to avoid infinite loop.");
      }

      // Record recovery attempt
      self.recoveryAttempts.set(attemptKey, attemptCount + 1);
      self.recoveryAttempts.set(branchId, attemptCount + 1);

      // Halve keepRecent window (minimum 2)
      var emergencyKeepRecent = Math.max(2, Math.floor(keepRecent / 2));
      var keptTailIndex = Math.max(0, messages.length - emergencyKeepRecent);

      if (messages[keptTailIndex] && messages[keptTailIndex].role === "tool") {
        var targetToolCallId = messages[keptTailIndex].tool_call_id;
        var rIdx = keptTailIndex;
        while (rIdx > 0) {
          rIdx--;
          var candidate = messages[rIdx];
          if (!candidate) continue;
          if (candidate.role === "assistant" && Array.isArray(candidate.tool_calls) && candidate.tool_calls.length > 0) {
            if (!targetToolCallId || candidate.tool_calls.some(function (tc) { return tc && tc.id === targetToolCallId; })) {
              keptTailIndex = rIdx;
              break;
            }
          } else if (candidate.role === "user") {
            keptTailIndex = rIdx;
            break;
          }
        }
        if (messages[keptTailIndex] && messages[keptTailIndex].role === "tool") {
          while (keptTailIndex > 0 && messages[keptTailIndex] && messages[keptTailIndex].role === "tool") {
            keptTailIndex--;
          }
        }
      }

      var firstKept = messages[keptTailIndex] || messages[0];

      // Aggressively truncate tool outputs >2000 chars
      var sanitizedMessages = sanitizeToolOutputs(messages, EMERGENCY_TOOL_OUTPUT_CHARS);

      self.saveCompactionState(branchId, {
        firstKeptEntryId: firstKept ? (firstKept.id || firstKept.entryId || extractEntryId(firstKept, keptTailIndex)) : "turn_0",
        summary: "Emergency compaction due to context overflow. Kept last " + emergencyKeepRecent + " messages.",
        estimatedTokensSaved: 50000,
        compactedAt: Date.now(),
        chatId: chatId
      });

      var newPrompt = self.reconstructPromptWithCompaction(sanitizedMessages, branchId);

      if (typeof callLlm !== "function") {
        return { ok: true, prompt: newPrompt, emergencyKeepRecent: emergencyKeepRecent };
      }

      return callLlm(newPrompt);
    });
  };

  // Singleton instance
  var AgyCompactor = new CompactionManager();

  // Attach standalone helper functions to singleton for public API convenience
  AgyCompactor.isContextOverflowError = isContextOverflowError;
  AgyCompactor.slicePromptHistory = slicePromptHistory;
  AgyCompactor.extractEntryId = extractEntryId;
  AgyCompactor.sanitizeToolOutputs = sanitizeToolOutputs;
  AgyCompactor.CompactionManager = CompactionManager;
  AgyCompactor.SUMMARY_HEADER = SUMMARY_HEADER;
  AgyCompactor.SUMMARY_ACK = SUMMARY_ACK;
  AgyCompactor.SUMMARY_ACK_RU = SUMMARY_ACK_RU;
  AgyCompactor.DEFAULT_THRESHOLD = DEFAULT_THRESHOLD;
  AgyCompactor.DEFAULT_KEEP_RECENT = DEFAULT_KEEP_RECENT;
  AgyCompactor.EMERGENCY_KEEP_RECENT = EMERGENCY_KEEP_RECENT;
  AgyCompactor.DEFAULT_CHAR_LIMIT = DEFAULT_CHAR_LIMIT;
  AgyCompactor.MAX_TOOL_OUTPUT_CHARS = MAX_TOOL_OUTPUT_CHARS;
  AgyCompactor.EMERGENCY_TOOL_OUTPUT_CHARS = EMERGENCY_TOOL_OUTPUT_CHARS;
  AgyCompactor.STORAGE_KEY_PREFIX = STORAGE_KEY_PREFIX;

  return {
    CompactionManager: CompactionManager,
    AgyCompactor: AgyCompactor,
    isContextOverflowError: isContextOverflowError,
    slicePromptHistory: slicePromptHistory,
    extractEntryId: extractEntryId,
    sanitizeToolOutputs: sanitizeToolOutputs,
    SUMMARY_HEADER: SUMMARY_HEADER,
    SUMMARY_ACK: SUMMARY_ACK,
    SUMMARY_ACK_RU: SUMMARY_ACK_RU,
    DEFAULT_THRESHOLD: DEFAULT_THRESHOLD,
    DEFAULT_KEEP_RECENT: DEFAULT_KEEP_RECENT,
    EMERGENCY_KEEP_RECENT: EMERGENCY_KEEP_RECENT,
    DEFAULT_CHAR_LIMIT: DEFAULT_CHAR_LIMIT,
    MAX_TOOL_OUTPUT_CHARS: MAX_TOOL_OUTPUT_CHARS,
    EMERGENCY_TOOL_OUTPUT_CHARS: EMERGENCY_TOOL_OUTPUT_CHARS,
    STORAGE_KEY_PREFIX: STORAGE_KEY_PREFIX
  };
});
