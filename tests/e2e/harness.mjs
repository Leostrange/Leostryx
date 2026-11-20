/**
 * E2E Test Harness & Contract Oracle for Leostryx Aether Architecture Integration
 * Opaque-box, requirement-driven test harness derived strictly from
 * ORIGINAL_REQUEST.md and PROJECT.md interface contracts.
 */
import assert from 'node:assert/strict';

/* =========================================================================
 * 1. CRC32 & ZIP Parser Utilities
 * ========================================================================= */

const CRC_TABLE = (function () {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function parseZipArchive(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const files = new Map();
  let offset = 0;

  // Read Local File Headers (0x04034b50)
  while (offset + 4 <= buffer.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break; // Reached central directory or unknown

    const versionNeeded = view.getUint16(offset + 4, true);
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const modTime = view.getUint16(offset + 10, true);
    const modDate = view.getUint16(offset + 12, true);
    const fileCrc = view.getUint32(offset + 14, true);
    const compSize = view.getUint32(offset + 18, true);
    const uncompSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameBytes = buffer.subarray(offset + 30, offset + 30 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buffer.subarray(dataStart, dataStart + uncompSize);

    // Verify CRC32
    const computedCrc = crc32(data);
    assert.equal(computedCrc, fileCrc, `CRC32 mismatch for ${name}`);

    files.set(name, {
      name,
      crc: fileCrc,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      data,
      text: () => new TextDecoder().decode(data)
    });

    offset = dataStart + uncompSize;
  }

  // Find and read Central Directory Headers (0x02014b50)
  const centralFiles = [];
  while (offset + 4 <= buffer.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x02014b50) break;

    const fileCrc = view.getUint32(offset + 16, true);
    const compSize = view.getUint32(offset + 20, true);
    const uncompSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);

    centralFiles.push({ name, crc: fileCrc, size: uncompSize, offset: localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }

  // End of Central Directory (0x06054b50)
  let eocdFound = false;
  let totalEntries = 0;
  if (offset + 4 <= buffer.length) {
    const sig = view.getUint32(offset, true);
    if (sig === 0x06054b50) {
      eocdFound = true;
      totalEntries = view.getUint16(offset + 10, true);
    }
  }

  return {
    files,
    centralFiles,
    eocdFound,
    totalEntries,
    hasFile: (name) => files.has(name),
    getFileText: (name) => files.get(name)?.text()
  };
}

/* =========================================================================
 * 2. Multimodal Payload Transformations & Validation (R1)
 * ========================================================================= */

export function createMediaAttachment(mimeType, dataOrBytes, name = 'image.png') {
  let bytes;
  let base64;
  if (typeof dataOrBytes === 'string') {
    // If data URL, extract raw base64
    if (dataOrBytes.startsWith('data:')) {
      const idx = dataOrBytes.indexOf(',');
      base64 = idx >= 0 ? dataOrBytes.slice(idx + 1) : dataOrBytes;
    } else {
      base64 = dataOrBytes;
    }
    bytes = Buffer.from(base64, 'base64');
  } else if (dataOrBytes instanceof Uint8Array || Buffer.isBuffer(dataOrBytes)) {
    bytes = dataOrBytes;
    base64 = Buffer.from(bytes).toString('base64');
  } else {
    bytes = new Uint8Array(0);
    base64 = '';
  }

  return {
    mimeType: normalizeMimeType(mimeType),
    description: name,
    payload: {
      case: 'inlineData',
      value: bytes
    },
    base64
  };
}

export function normalizeMimeType(mime) {
  if (!mime) return 'image/png';
  const clean = mime.toLowerCase().trim();
  if (clean === 'image/jpg') return 'image/jpeg';
  return clean;
}

/**
 * Transforms attachments and text into OpenAI Chat Completions content parts:
 * [ { type: "text", text: "..." }, { type: "image_url", image_url: { url: "data:<mime>;base64,..." } } ]
 */
export function transformOpenAIChat(attachments, text = '') {
  const parts = [];
  if (text) {
    parts.push({ type: 'text', text });
  }
  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      if (!att || !att.mimeType?.startsWith('image/')) continue;
      const b64 = att.base64 || Buffer.from(att.payload?.value || []).toString('base64');
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${normalizeMimeType(att.mimeType)};base64,${b64}`
        }
      });
    }
  }
  return parts;
}

/**
 * Transforms attachments and text into OpenAI Responses API parts:
 * [ { type: "input_text", text: "..." }, { type: "input_image", image_url: "data:<mime>;base64,..." } ]
 */
export function transformOpenAIResponses(attachments, text = '') {
  const parts = [];
  if (text) {
    parts.push({ type: 'input_text', text });
  }
  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      if (!att || !att.mimeType?.startsWith('image/')) continue;
      const b64 = att.base64 || Buffer.from(att.payload?.value || []).toString('base64');
      parts.push({
        type: 'input_image',
        image_url: `data:${normalizeMimeType(att.mimeType)};base64,${b64}`
      });
    }
  }
  return parts;
}

/**
 * Transforms attachments and text into Anthropic Messages content blocks:
 * [ { type: "text", text: "..." }, { type: "image", source: { type: "base64", media_type: "<mime>", data: "<b64>" } } ]
 */
export function transformAnthropicMessages(attachments, text = '') {
  const blocks = [];
  if (text) {
    blocks.push({ type: 'text', text });
  }
  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      if (!att || !att.mimeType?.startsWith('image/')) continue;
      let b64 = att.base64 || Buffer.from(att.payload?.value || []).toString('base64');
      // Strip any accidental data URL prefix
      if (b64.startsWith('data:')) {
        const idx = b64.indexOf(',');
        if (idx >= 0) b64 = b64.slice(idx + 1);
      }
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: normalizeMimeType(att.mimeType),
          data: b64
        }
      });
    }
  }
  return blocks;
}

/**
 * Pre-send Vision Capability Validation
 */
export function validateVisionSupport(modelConfig, attachments) {
  if (!attachments || !attachments.length) {
    return { valid: true };
  }

  // Check if any attachment is an image
  const hasImages = attachments.some(a => a?.mimeType && /^image\//i.test(a.mimeType));
  if (!hasImages) {
    // Non-image files (text/code) should never be blocked by vision check
    return { valid: true };
  }

  // Model capability check
  const supportsImages = modelConfig && (
    modelConfig.images === true ||
    modelConfig.supportsImages === true ||
    (modelConfig.inputModes && modelConfig.inputModes.includes('image')) ||
    (modelConfig.modelFeatures && modelConfig.modelFeatures.supportsImages === true)
  );

  if (!supportsImages) {
    return {
      valid: false,
      error: 'Selected model does not support this media type',
      code: 'ERR_VISION_NOT_SUPPORTED',
      retainedAttachments: attachments.slice()
    };
  }

  return { valid: true };
}

/**
 * Log & Telemetry Redaction: Masks Base64 data URLs and binary payload dumps
 */
export function maskMediaInLogs(logText) {
  if (typeof logText !== 'string') logText = String(logText || '');

  // 1. Data URLs: data:image/<mime>;base64,<payload> -> [IMAGE: image/<mime>, <bytes> bytes]
  let masked = logText.replace(/data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)/g, (match, mime, b64) => {
    const byteSize = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    return `[IMAGE: ${mime}, ${byteSize} bytes]`;
  });

  // 2. Raw Base64 data fields in JSON string dumps: "data":\s*"[A-Za-z0-9+/=]{60,}"
  masked = masked.replace(/"data"\s*:\s*"([A-Za-z0-9+/=]{60,})"/g, (match, b64) => {
    const byteSize = Math.floor((b64.length * 3) / 4);
    return `"data":"[IMAGE_DATA: ${byteSize} bytes redacted]"`;
  });

  return masked;
}

/* =========================================================================
 * 3. Resilient Dictation 7-State FSM & Session Isolation (R2)
 * ========================================================================= */

export class DictationFSM {
  static STATES = ['idle', 'preparing', 'recording', 'processing', 'ready', 'cancelled', 'error'];

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
    this.history = [];
    this.onStateChange = options.onStateChange || null;
    this.onPartial = options.onPartial || null;
    this.onFinal = options.onFinal || null;
    this.onError = options.onError || null;
    this.speechTimer = null;
    this.watchdogTimer = null;
    this.destroyed = false;
  }

  transitionTo(nextState, detail = {}) {
    const validTransitions = {
      idle: ['preparing', 'error'],
      preparing: ['recording', 'cancelled', 'error'],
      recording: ['processing', 'cancelled', 'error'],
      processing: ['ready', 'cancelled', 'error'],
      ready: ['idle'],
      cancelled: ['idle'],
      error: ['idle']
    };

    if (!validTransitions[this.state]?.includes(nextState)) {
      throw new Error(`Invalid state transition from ${this.state} to ${nextState}`);
    }

    const prevState = this.state;
    this.state = nextState;
    this.history.push({ from: prevState, to: nextState, timestamp: Date.now(), ...detail });

    if (this.onStateChange) {
      this.onStateChange(this.state, prevState, this.getSession());
    }
  }

  startDictation({ chatId, continuous = true, onPartial, onFinal, onError, onStateChange }) {
    if (this.destroyed) throw new Error('Dictation manager is destroyed');
    if (this.state !== 'idle') {
      // If already active, abort prior session cleanly
      this.cancelDictation(this.sessionId);
    }

    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.chatId = chatId || 'default_chat';
    this.continuous = continuous;
    this.buffer = '';
    this.partialText = '';
    this.startTime = Date.now();
    if (onPartial) this.onPartial = onPartial;
    if (onFinal) this.onFinal = onFinal;
    if (onError) this.onError = onError;
    if (onStateChange) this.onStateChange = onStateChange;

    this.transitionTo('preparing');

    // Simulate hardware readiness transition
    this.transitionTo('recording');
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

    this.transitionTo('processing');

    // Commit any buffered/partial text
    const finalText = (this.buffer + ' ' + this.partialText).trim();
    this.buffer = finalText;
    this.partialText = '';

    this.transitionTo('ready');
    if (this.onFinal) this.onFinal(finalText, this.sessionId);

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

    this.buffer = '';
    this.partialText = '';

    if (this.state === 'preparing' || this.state === 'recording' || this.state === 'processing') {
      this.transitionTo('cancelled');
    }

    this.transitionTo('idle');
  }

  dispatchBridgeEvent(targetSessionId, targetChatId, eventTag, text = '') {
    if (this.destroyed) return;

    // Session ID & Chat ID Isolation: Drop events without valid matching sessionId or chatId
    if (!targetSessionId || targetSessionId !== this.sessionId) {
      return; // Dropped
    }
    if (!targetChatId || targetChatId !== this.chatId) {
      return; // Dropped
    }

    if (eventTag === 'E') { // Error allowed in preparing, recording, or processing
      if (this.state === 'preparing' || this.state === 'recording' || this.state === 'processing') {
        this.transitionTo('error', { error: text });
        if (this.onError) this.onError(new Error(text), this.sessionId);
        this.transitionTo('idle');
      }
      return;
    }

    if (this.state !== 'recording' && this.state !== 'processing') {
      return; // State guard
    }

    if (eventTag === 'P') { // Partial
      this.partialText = text;
      if (this.onPartial) this.onPartial(text, this.sessionId);
    } else if (eventTag === 'F') { // Final phrase
      if (text) {
        this.buffer = (this.buffer ? this.buffer + ' ' : '') + text.trim();
      }
      this.partialText = '';
      if (this.onPartial) this.onPartial('', this.sessionId);
    } else if (eventTag === 'X') { // Silence / phrase end
      if (this.continuous) {
        // Continuous mode re-priming loop: re-prime engine without dropping session!
        if (this.partialText) {
          this.buffer = (this.buffer ? this.buffer + ' ' : '') + this.partialText.trim();
          this.partialText = '';
        }
      } else {
        // One-shot mode: stop listening on silence
        this.stopDictation(this.sessionId);
      }
    }
  }

  cleanupOnVisibilityChange(hidden) {
    if (hidden && (this.state === 'recording' || this.state === 'preparing' || this.state === 'processing')) {
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
}

/* =========================================================================
 * 4. Compaction Persistence & Recovery (R3)
 * ========================================================================= */

export class CompactionManager {
  constructor() {
    this.branches = new Map();
    this.recoveryAttempts = new Map();
  }

  saveCompactionState(branchId, state) {
    if (!branchId) branchId = 'main';
    const record = {
      firstKeptEntryId: state.firstKeptEntryId,
      summary: state.summary || '',
      estimatedTokensSaved: Number(state.estimatedTokensSaved) || 0,
      compactedAt: state.compactedAt || Date.now()
    };
    this.branches.set(branchId, record);
    return record;
  }

  getCompactionState(branchId = 'main') {
    return this.branches.get(branchId) || null;
  }

  /**
   * Slices messages and prepends summary on prompt reconstruction
   */
  reconstructPromptWithCompaction(messages, branchId = 'main') {
    const compaction = this.getCompactionState(branchId);
    if (!compaction || !compaction.firstKeptEntryId) {
      return messages.slice();
    }

    const { firstKeptEntryId, summary } = compaction;
    let sliceIndex = messages.findIndex(m => m.id === firstKeptEntryId || m.entryId === firstKeptEntryId);
    if (sliceIndex < 0) {
      sliceIndex = 0; // fallback if ID not found
    }

    const systemMessages = messages.filter((m, idx) => idx < sliceIndex && m.role === 'system');
    const keptTail = messages.slice(sliceIndex);

    const prompt = [];
    // Preserve system messages at top
    if (systemMessages.length) {
      prompt.push(...systemMessages);
    }

    // Prepend synthetic summary
    if (summary) {
      prompt.push({
        role: 'user',
        content: `### Previous Conversation Summary\n${summary}`
      });
      prompt.push({
        role: 'assistant',
        content: 'Understood. I will continue the conversation based on the above summary and subsequent messages.'
      });
    }

    prompt.push(...keptTail);
    return prompt;
  }

  /**
   * Single-Shot Context Overflow Recovery
   */
  async handleOverflowRecovery({ branchId = 'main', errorResponse, messages = [], keepRecent = 8, callLlm }) {
    const msg = String(errorResponse?.message || errorResponse?.error || errorResponse?.body || '');
    const isOverflow = (errorResponse?.status === 400 || errorResponse?.status === 413) &&
      (msg.includes('context_length_exceeded') || msg.includes('context window') || msg.includes('max_tokens'));

    if (!isOverflow) {
      throw new Error(`Non-overflow error: ${JSON.stringify(errorResponse)}`);
    }

    const attemptCount = this.recoveryAttempts.get(branchId) || 0;
    if (attemptCount >= 1) {
      throw new Error('Single-shot overflow recovery already exhausted. Aborting to avoid infinite loop.');
    }

    // Mark single-shot attempt
    this.recoveryAttempts.set(branchId, attemptCount + 1);

    // Apply emergency compaction with halved keepRecent
    const emergencyKeepRecent = Math.max(2, Math.floor(keepRecent / 2));
    const keptTailIndex = Math.max(0, messages.length - emergencyKeepRecent);
    const firstKept = messages[keptTailIndex] || messages[0];

    // Truncate large tool outputs in kept messages
    const sanitizedMessages = messages.map(m => {
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 2000) {
        return { ...m, content: m.content.slice(0, 2000) + '... [TRUNCATED DUE TO CONTEXT OVERFLOW]' };
      }
      return m;
    });

    this.saveCompactionState(branchId, {
      firstKeptEntryId: firstKept.id || firstKept.entryId,
      summary: `Emergency compaction due to context overflow. Kept last ${emergencyKeepRecent} messages.`,
      estimatedTokensSaved: 50000,
      compactedAt: Date.now()
    });

    const newPrompt = this.reconstructPromptWithCompaction(sanitizedMessages, branchId);
    // Re-issue prompt once
    return await callLlm(newPrompt);
  }
}

/* =========================================================================
 * 5. Streaming ZIP Archive Generation & Secret Filtering (R4)
 * ========================================================================= */

export function redactSensitiveData(text) {
  if (typeof text !== 'string') text = JSON.stringify(text || '');

  // 1. Bearer tokens
  let out = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]');

  // 2. API keys (OpenAI, Anthropic, Google, generic)
  out = out.replace(/(?:api[_-]?key|apiKey)\s*[:=]\s*["']?([A-Za-z0-9-_]{12,})["']?/gi, 'api_key: "[REDACTED]"');
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{20,})\b/g, 'sk-[REDACTED]');
  out = out.replace(/\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g, 'sk-ant-[REDACTED]');
  out = out.replace(/\b(AIzaSy[A-Za-z0-9_-]{30,})\b/g, 'AIzaSy[REDACTED]');

  // 3. Passwords and client secrets
  out = out.replace(/(?:password|client_secret|secret)\s*[:=]\s*["']?([^"'\s,}{]{6,})["']?/gi, 'password: "[REDACTED]"');

  // 4. Sensitive HTTP Headers
  out = out.replace(/(Authorization\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]');
  out = out.replace(/(Cookie\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]');

  return out;
}

export function isPrivateConfigFile(fileName) {
  const base = fileName.split('/').pop().toLowerCase();
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (base === 'id_rsa' || base === 'id_ed25519' || base.endsWith('.pem') || base.endsWith('.key')) return true;
  if (base.endsWith('.keystore') || base.endsWith('.p12')) return true;
  return false;
}

export class ExportManager {
  constructor(options = {}) {
    this.options = options;
  }

  buildZip(files) {
    const parts = [];
    const central = [];
    let offset = 0;

    function u16(v) { return new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF]); }
    function u32(v) { return new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]); }
    function push(b) { parts.push(b); offset += b.length; }

    // Filter out private files and apply redaction to text files
    const validFiles = files.filter(f => !isPrivateConfigFile(f.name));

    validFiles.forEach(f => {
      const name = new TextEncoder().encode(f.name);
      let data = f.data;
      if (typeof data === 'string') {
        data = new TextEncoder().encode(redactSensitiveData(data));
      } else if (f.isText && data instanceof Uint8Array) {
        const text = new TextDecoder().decode(data);
        data = new TextEncoder().encode(redactSensitiveData(text));
      }

      const fileCrc = crc32(data);
      const localOffset = offset;

      push(u32(0x04034b50)); // Local file header signature
      push(u16(20));         // Version needed
      push(u16(0x0800));     // Flags (UTF-8)
      push(u16(0));          // Compression (STORE)
      push(u16(0)); push(u16(0)); // Mod time/date
      push(u32(fileCrc));
      push(u32(data.length));
      push(u32(data.length));
      push(u16(name.length));
      push(u16(0));          // Extra length
      push(name);
      push(data);

      central.push({ name, crc: fileCrc, size: data.length, offset: localOffset });
    });

    const centralStart = offset;
    central.forEach(c => {
      push(u32(0x02014b50)); // Central directory header
      push(u16(20)); push(u16(20));
      push(u16(0x0800));
      push(u16(0));
      push(u16(0)); push(u16(0));
      push(u32(c.crc));
      push(u32(c.size));
      push(u32(c.size));
      push(u16(c.name.length));
      push(u16(0)); push(u16(0)); // Extra/comment len
      push(u16(0)); push(u16(0)); // Disk start / internal attrs
      push(u32(0));               // External attrs
      push(u32(c.offset));
      push(c.name);
    });

    const centralSize = offset - centralStart;
    push(u32(0x06054b50)); // End of central directory record
    push(u16(0)); push(u16(0));
    push(u16(central.length)); push(u16(central.length));
    push(u32(centralSize));
    push(u32(centralStart));
    push(u16(0));

    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }

  packageTranscriptFull(records) {
    const lines = records.map(r => redactSensitiveData(JSON.stringify(r)));
    return lines.join('\n');
  }

  packageTranscriptMd(records) {
    const md = ['# Leostryx Session Transcript', ''];
    records.forEach((rec, idx) => {
      const role = rec.role || 'record';
      md.push(`## ${idx + 1}. ${role}${rec.timestamp ? ` (${rec.timestamp})` : ''}`, '');
      if (rec.content) md.push(redactSensitiveData(rec.content), '');
      if (rec.thinking) md.push('### Reasoning', '```', redactSensitiveData(rec.thinking), '```', '');
      if (rec.toolCalls) md.push('### Tool Calls', '```json', redactSensitiveData(JSON.stringify(rec.toolCalls, null, 2)), '```', '');
    });
    return md.join('\n');
  }

  packageChangesDiff(fileDiffs) {
    if (!fileDiffs || !fileDiffs.length) {
      return '(no workspace changes recorded in session)';
    }
    const chunks = [];
    for (const diff of fileDiffs) {
      const path = diff.path || diff.uri || 'unknown_file';
      chunks.push(`--- a/${path}`);
      chunks.push(`+++ b/${path}`);
      chunks.push(redactSensitiveData(diff.unifiedDiff || diff.patch || '@@ -1 +1 @@\n-old\n+new'));
    }
    return chunks.join('\n');
  }

  packageAttachments(attachments) {
    const files = [];
    const seenNames = new Set();
    attachments.forEach((att, idx) => {
      let rawName = att.name || att.description || `media_${idx}.png`;
      // Strip directory paths and path traversal dots
      let baseName = rawName.split('/').pop().split('\\').pop().replace(/^\.+/, '');
      baseName = baseName.replace(/[^A-Za-z0-9._-]/g, '_');
      if (!baseName || baseName === '_') baseName = `attachment_${idx}.bin`;
      let uniqueName = baseName;
      let c = 1;
      while (seenNames.has(uniqueName)) {
        const parts = baseName.split('.');
        const ext = parts.length > 1 ? parts.pop() : 'bin';
        uniqueName = `${parts.join('.')}_${c++}.${ext}`;
      }
      seenNames.add(uniqueName);

      files.push({
        name: `attachments/${uniqueName}`,
        data: att.bytes || att.data || new Uint8Array(0)
      });
    });
    return files;
  }
}
