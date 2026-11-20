/**
 * Test Suite: Milestone M4 — Streaming Session ZIP Export (Requirement R4)
 * File: tests/unit/test_r4_export.test.mjs
 *
 * Verifies:
 * - Feature F15: Streaming ZIP Archive Generation & >64 MiB Support
 * - Feature F16: Complete Transcript Packaging (transcript_full.jsonl & transcript.md)
 * - Feature F17: Attachments Packaging (attachments/ with path traversal & collision handling)
 * - Feature F18: Workspace Changes Diff Packaging (changes.diff with unified formatting)
 * - Feature F19: Export Secret & Credential Filtering and File Blacklisting
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

// Load export module
const exportPath = path.join(REPO_ROOT, "app/assets/web/agy_export_session.js");
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
  maskMediaInLogs,
  BLACKLISTED_FILENAMES,
  BLACKLISTED_EXTENSIONS
} = exportModule;

// ============================================================================
// Helper: Pure JS In-Memory ZIP Reader
// Validates PKZIP 2.0 structures without spawning external processes.
// ============================================================================
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
  if (eocdOffset === -1) throw new Error("EOCD record signature not found (not a valid ZIP)");

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries = new Map();
  const centralFiles = [];
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) {
      throw new Error(`Invalid Central Directory signature at byte ${pos}`);
    }
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const compSize = view.getUint32(pos + 20, true);
    const uncompSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);

    const nameBytes = u8.subarray(pos + 46, pos + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);

    centralFiles.push({ name, crc, size: uncompSize, offset: localOffset });

    // Read and verify Local File Header
    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid Local File Header signature at offset ${localOffset} for ${name}`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = u8.subarray(dataStart, dataStart + uncompSize);

    // Verify CRC32 matches stored CRC32
    const computedCrc = crc32(data);
    if (computedCrc !== crc) {
      throw new Error(`CRC-32 mismatch for ${name}: expected 0x${crc.toString(16)}, got 0x${computedCrc.toString(16)}`);
    }

    entries.set(name, {
      name,
      method,
      crc,
      compSize,
      uncompSize,
      flags,
      data,
      text: () => new TextDecoder().decode(data)
    });

    pos += 46 + nameLen + extraLen + commentLen;
  }

  return {
    totalEntries,
    cdSize,
    cdOffset,
    entries,
    centralFiles,
    files: entries,
    hasFile: (name) => entries.has(name),
    getFileText: (name) => entries.get(name)?.text()
  };
}

// ============================================================================
// Suite 1: Contract, Public Exports, and Constants Verification
// ============================================================================
test("Suite 1: Export Module Contract & Public Interface Exports", async (t) => {
  await t.test("exports core streaming, sanitization and packager functions", () => {
    assert.equal(typeof StreamingZipWriter, "function");
    assert.equal(typeof buildZip, "function");
    assert.equal(typeof crc32, "function");
    assert.equal(typeof sanitizeText, "function");
    assert.equal(typeof redactSensitiveData, "function");
    assert.equal(typeof isSensitiveFilename, "function");
    assert.equal(typeof isPrivateConfigFile, "function");
    assert.equal(typeof sanitizeDiff, "function");
    assert.equal(typeof sanitizeJsonl, "function");
    assert.equal(typeof sanitizeMarkdown, "function");
    assert.equal(typeof transcriptMd, "function");
    assert.equal(typeof formatTranscriptFullJsonl, "function");
    assert.equal(typeof formatChangesDiff, "function");
    assert.equal(typeof packageTranscriptFull, "function");
    assert.equal(typeof packageTranscriptMd, "function");
    assert.equal(typeof packageChangesDiff, "function");
    assert.equal(typeof packageAttachments, "function");
    assert.equal(typeof ExportManager, "function");
    assert.equal(typeof exportSession, "function");
  });

  await t.test("exports standard file blacklists with required entries", () => {
    assert.ok(BLACKLISTED_FILENAMES.has(".env"));
    assert.ok(BLACKLISTED_FILENAMES.has(".env.local"));
    assert.ok(BLACKLISTED_FILENAMES.has("id_rsa"));
    assert.ok(BLACKLISTED_FILENAMES.has("id_ed25519"));
    assert.ok(BLACKLISTED_FILENAMES.has("credentials.json"));
    assert.ok(BLACKLISTED_FILENAMES.has("service-account.json"));
    assert.ok(BLACKLISTED_EXTENSIONS.has(".pem"));
    assert.ok(BLACKLISTED_EXTENSIONS.has(".key"));
    assert.ok(BLACKLISTED_EXTENSIONS.has(".keystore"));
    assert.ok(BLACKLISTED_EXTENSIONS.has(".jks"));
    assert.ok(BLACKLISTED_EXTENSIONS.has(".p12"));
  });

  await t.test("ExportManager instance exposes expected methods and preserves options", () => {
    const mgr = new ExportManager({ cascadeId: "c_123" });
    assert.equal(mgr.options.cascadeId, "c_123");
    assert.equal(typeof mgr.buildZip, "function");
    assert.equal(typeof mgr.packageTranscriptFull, "function");
    assert.equal(typeof mgr.packageTranscriptMd, "function");
    assert.equal(typeof mgr.packageChangesDiff, "function");
    assert.equal(typeof mgr.packageAttachments, "function");
  });
});

// ============================================================================
// Suite 2: Feature F19 — Secret & Credential Filtering Engine (sanitizeText)
// ============================================================================
test("Suite 2: Feature F19 — Secret & Credential Filtering Engine", async (t) => {
  await t.test("redacts Bearer tokens while preserving English phrasing", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature\n" +
                  "curl -H 'bearer abcdef1234567890~+/'\n" +
                  "He was the bearer of good news.";
    const out = sanitizeText(input);
    assert.ok(!out.includes("eyJhbGci"));
    assert.ok(!out.includes("abcdef1234567890"));
    assert.ok(out.includes("Authorization: [REDACTED]"));
    assert.ok(out.includes("bearer of good news"));
  });

  await t.test("redacts vendor-specific API keys (OpenAI, Anthropic, Gemini, GitHub, AWS)", () => {
    const input = [
      "OpenAI: sk-proj-1234567890abcdefghijklmnopqrstuvwxyz",
      "Anthropic: sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
      "Gemini: AIzaSyA1234567890abcdefghijklmnopqrstuv",
      "GitHub: ghp_1234567890abcdefghijklmnopqrstuvwxyz",
      "GitHub Fine-Grained: github_pat_11AAAAAAA01234567890abcdefghijklmnopqrstuvwxyz01234567890abcdefghijklmnopqrstuvwxyz",
      "AWS: AKIAIOSFODNN7EXAMPLE"
    ].join("\n");

    const out = sanitizeText(input);
    assert.ok(!out.includes("sk-proj-"));
    assert.ok(!out.includes("sk-ant-"));
    assert.ok(!out.includes("AIzaSyA"));
    assert.ok(!out.includes("ghp_"));
    assert.ok(!out.includes("github_pat_"));
    assert.ok(!out.includes("AKIAIOSFODNN7EXAMPLE"));
  });

  await t.test("redacts sensitive fields in JSON, YAML, and assignment statements", () => {
    const input = `
      {
        "api_key": "my_secret_key_val",
        "client_secret": "client_sec_12345",
        "access_token": "acc_tok_99999",
        "refresh_token": "ref_tok_88888",
        "password": "Password123!",
        "csrf_token": "csrf_val_abc"
      }
      export OPENAI_API_KEY="sk-custom-abcdef1234567890"
      password = "SecretPassword!"
    `;
    const out = sanitizeText(input);
    assert.ok(!out.includes("my_secret_key_val"));
    assert.ok(!out.includes("client_sec_12345"));
    assert.ok(!out.includes("acc_tok_99999"));
    assert.ok(!out.includes("ref_tok_88888"));
    assert.ok(!out.includes("Password123!"));
    assert.ok(!out.includes("SecretPassword!"));
  });

  await t.test("redacts sensitive HTTP headers (Authorization, Cookie, Proxy-Authorization)", () => {
    const input = "Authorization: Basic dXNlcjpwYXNz\n" +
                  "Cookie: session_id=abc123xyz; token=sec456\n" +
                  "Proxy-Authorization: Basic cHJveHk6c2VjcmV0\n" +
                  "X-Api-Key: custom_raw_api_key_value";
    const out = sanitizeText(input);
    assert.ok(!out.includes("dXNlcjpwYXNz"));
    assert.ok(!out.includes("session_id=abc123xyz"));
    assert.ok(!out.includes("cHJveHk6c2VjcmV0"));
    assert.ok(!out.includes("custom_raw_api_key_value"));
    assert.ok(out.includes("Authorization: [REDACTED]"));
    assert.ok(out.includes("Cookie: [REDACTED]"));
    assert.ok(out.includes("Proxy-Authorization: [REDACTED]"));
  });

  await t.test("redacts embedded credentials in URI connection strings", () => {
    const input = "const p = 'postgres://admin:SuperSecretPass123@db.prod.internal:5432/main';\n" +
                  "const m = 'mongodb://app_user:MongoPass456!@cluster0.mongodb.net/test';\n" +
                  "const r = 'redis://:RedisPass789@redis-cache:6379';";
    const out = sanitizeText(input);
    assert.ok(!out.includes("SuperSecretPass123"));
    assert.ok(!out.includes("MongoPass456!"));
    assert.ok(!out.includes("RedisPass789"));
    assert.ok(out.includes("postgres://admin:[REDACTED]@db.prod.internal:5432/main"));
    assert.ok(out.includes("mongodb://app_user:[REDACTED]@cluster0.mongodb.net/test"));
  });

  await t.test("redacts URL query credentials", () => {
    const input = "https://api.example.com/v1?api_key=secretKey123&token=tok456&user=alice";
    const out = sanitizeText(input);
    assert.ok(!out.includes("secretKey123"));
    assert.ok(!out.includes("tok456"));
    assert.ok(out.includes("user=alice"));
  });

  await t.test("replaces Base64 data URLs with concise metadata markers", () => {
    const input = 'Here is an image: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg== in markdown';
    const out = sanitizeText(input);
    assert.ok(!out.includes("iVBORw0KGgoAAAANSUhEUg"));
    assert.ok(out.includes("[IMAGE: image/png, <redacted>]"));
  });

  await t.test("preserves benign git commit hashes and source code tokens without false positives", () => {
    const input = "Commit: b6681b8e5c7e738b91dc8982a0fc8ac1e2582d1d\n" +
                  "Function: calculateTokenBudget(history, 4096);\n" +
                  "Variable: const sessionToken = 'sess_user_active_123';";
    const out = sanitizeText(input);
    assert.ok(out.includes("b6681b8e5c7e738b91dc8982a0fc8ac1e2582d1d"));
    assert.ok(out.includes("calculateTokenBudget(history, 4096)"));
  });
});

// ============================================================================
// Suite 3: Feature F19 — Sensitive File Blacklisting & Diff Filtering
// ============================================================================
test("Suite 3: Feature F19 — Sensitive File Blacklisting & Diff Filtering", async (t) => {
  await t.test("isSensitiveFilename identifies exact blacklisted files and extensions", () => {
    assert.equal(isSensitiveFilename(".env"), true);
    assert.equal(isSensitiveFilename(".env.local"), true);
    assert.equal(isSensitiveFilename(".env.production"), true);
    assert.equal(isSensitiveFilename("sub/dir/id_rsa"), true);
    assert.equal(isSensitiveFilename("keys/server.pem"), true);
    assert.equal(isSensitiveFilename("private.key"), true);
    assert.equal(isSensitiveFilename("release.keystore"), true);
    assert.equal(isSensitiveFilename("app.jks"), true);
    assert.equal(isSensitiveFilename("client_secret.json"), true);
    assert.equal(isSensitiveFilename("service-account.json"), true);
    assert.equal(isSensitiveFilename(".netrc"), true);
    assert.equal(isSensitiveFilename(".npmrc"), true);
  });

  await t.test("isSensitiveFilename preserves legitimate application source and media files", () => {
    assert.equal(isSensitiveFilename("app.js"), false);
    assert.equal(isSensitiveFilename("environment.ts"), false);
    assert.equal(isSensitiveFilename("keyboard.js"), false);
    assert.equal(isSensitiveFilename("attachments/image_01.png"), false);
    assert.equal(isSensitiveFilename("diagram.jpg"), false);
    assert.equal(isSensitiveFilename("doc.pdf"), false);
    assert.equal(isSensitiveFilename("package.json"), false);
    assert.equal(isSensitiveFilename("README.md"), false);
  });

  await t.test("sanitizeDiff redacts whole diff hunks for blacklisted files", () => {
    const sampleDiff = [
      "diff --git a/.env b/.env",
      "index 1111111..2222222 100644",
      "--- a/.env",
      "+++ b/.env",
      "@@ -1,2 +1,2 @@",
      "-FOO=bar",
      "+OPENAI_API_KEY=sk-proj-supersecretkey1234567890",
      "diff --git a/src/index.js b/src/index.js",
      "index 3333333..4444444 100644",
      "--- a/src/index.js",
      "+++ b/src/index.js",
      "@@ -10,3 +10,3 @@",
      "-const token = null;",
      "+const token = 'sk-ant-api03-0123456789abcdefghij';"
    ].join("\n");

    const cleanDiff = sanitizeDiff(sampleDiff);
    assert.ok(!cleanDiff.includes("sk-proj-supersecretkey1234567890"));
    assert.ok(!cleanDiff.includes("sk-ant-api03-0123456789abcdefghij"));
    assert.ok(cleanDiff.includes("[DIFF REDACTED: sensitive file .env excluded]"));
    assert.ok(cleanDiff.includes("diff --git a/src/index.js b/src/index.js"));
    assert.ok(cleanDiff.includes("+const token = '[REDACTED_API_KEY]';"));
  });
});

// ============================================================================
// Suite 4: Feature F16, F17, F18 — Full History, Diff & Attachments Packaging
// ============================================================================
test("Suite 4: Feature F16, F17, F18 — Transcript, Diff, and Attachments Assembly", async (t) => {
  await t.test("sanitizeJsonl produces 100% parseable, secret-free JSON lines", () => {
    const rawJsonl = [
      JSON.stringify({ role: "user", content: "My key is sk-proj-1234567890abcdef123456" }),
      JSON.stringify({
        role: "assistant",
        headers: { "Authorization": "Bearer eyJhbGciOi...12345" },
        tool_calls: [{ name: "bash", args: { command: "curl -H 'api_key: AIzaSyD1234567890123456789012345678901'" } }]
      })
    ].join("\n");

    const cleanJsonl = sanitizeJsonl(rawJsonl);
    const lines = cleanJsonl.trim().split("\n");
    assert.equal(lines.length, 2);

    const rec0 = JSON.parse(lines[0]);
    assert.ok(!rec0.content.includes("sk-proj-"));
    assert.ok(rec0.content.includes("[REDACTED_API_KEY]"));

    const rec1 = JSON.parse(lines[1]);
    assert.equal(rec1.headers.Authorization, "[REDACTED]");
    assert.ok(!rec1.tool_calls[0].args.command.includes("AIzaSyD"));
  });

  await t.test("transcriptMd generates readable Markdown without leaked credentials", () => {
    const rawLines = [
      JSON.stringify({ role: "user", content: "Setup postgres: postgres://root:P@ssword!@db:5432/app" }),
      JSON.stringify({ role: "assistant", thinking: "Exporting token sk-ant-12345678901234567890", delta: "Done." })
    ];
    const { md } = transcriptMd(rawLines, "test_session");
    const cleanMd = sanitizeMarkdown(md);

    assert.ok(!cleanMd.includes("P@ssword!"));
    assert.ok(!cleanMd.includes("sk-ant-"));
    assert.ok(cleanMd.includes("## 1. user"));
    assert.ok(cleanMd.includes("## 2. assistant"));
  });

  await t.test("packageTranscriptMd renders compaction boundary callout", () => {
    const records = [
      { role: "user", content: "Active turn after compaction" }
    ];
    const compaction = {
      firstKeptEntryId: "entry_turn_5",
      summary: "User set up project scaffolding.\nAssistant created core router.",
      estimatedTokensSaved: 14200
    };
    const md = packageTranscriptMd(records, { cascadeId: "casc_123", compactionState: compaction });
    assert.ok(md.includes("Context Compaction Boundary") || md.includes("Граница сжатия контекста"));
    assert.ok(md.includes("entry_turn_5"));
    assert.ok(md.includes("14200"));
    assert.ok(md.includes("User set up project scaffolding."));
    assert.ok(md.includes("Active turn after compaction"));
  });

  await t.test("packageAttachments resolves duplicate collision and sanitizes filenames", () => {
    const atts = [
      { name: "photo.jpg", data: new Uint8Array([1, 2, 3]) },
      { name: "photo.jpg", data: new Uint8Array([4, 5, 6]) },
      { name: "../../secrets/report.pdf", data: new Uint8Array([7, 8, 9]) },
      { name: ".env", data: new Uint8Array([10]) },
      { name: "sub/dir/id_rsa", data: new Uint8Array([11]) }
    ];
    const packaged = packageAttachments(atts);
    assert.equal(packaged.length, 3);
    assert.equal(packaged[0].name, "attachments/photo.jpg");
    assert.equal(packaged[1].name, "attachments/photo_1.jpg");
    assert.ok(!packaged[2].name.includes(".."));
    assert.equal(packaged[2].name, "attachments/report.pdf");
    // Verify blacklisted files (.env, id_rsa) are excluded
    assert.ok(!packaged.some(p => p.name.includes(".env")));
    assert.ok(!packaged.some(p => p.name.includes("id_rsa")));
  });

  await t.test("packageChangesDiff formats unified diff chunks with header", () => {
    const diffs = [
      { path: "src/server.ts", originalContent: "port = 3000;\n", modifiedContent: "port = 8080;\n" }
    ];
    const diffText = packageChangesDiff(diffs);
    assert.ok(diffText.includes("--- a/src/server.ts"));
    assert.ok(diffText.includes("+++ b/src/server.ts"));
    assert.ok(diffText.includes("-port = 3000;"));
    assert.ok(diffText.includes("+port = 8080;"));
  });

  await t.test("packageTranscriptFull handles BigInts and custom structures without error", () => {
    const records = [
      { role: "user", timestamp: 1732042800000n, content: "BigInt timestamp" }
    ];
    const full = packageTranscriptFull(records);
    assert.ok(full.includes("1732042800000"));
    assert.ok(full.includes("BigInt timestamp"));
  });

  await t.test("packageAttachments handles data URLs and inlineData payloads", () => {
    const atts = [
      { name: "test_inline.png", payload: { case: "inlineData", value: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) } },
      { name: "test_b64.png", data: "data:image/png;base64,iVBORw0KGgo=" }
    ];
    const files = packageAttachments(atts);
    assert.equal(files.length, 2);
    assert.equal(files[0].name, "attachments/test_inline.png");
    assert.equal(files[0].data[0], 0x89);
    assert.equal(files[1].name, "attachments/test_b64.png");
    assert.ok(files[1].data.length > 0);
  });

  await t.test("packageChangesDiff returns standard placeholder on empty or non-diff arrays", () => {
    assert.equal(packageChangesDiff([]), "(no workspace changes recorded in session)");
    assert.equal(packageChangesDiff(null), "(no workspace changes recorded in session)");
    assert.equal(packageChangesDiff([{ isArtifactFile: true, path: "meta.json" }]), "(no workspace changes recorded in session)");
  });
});

// ============================================================================
// Suite 5: Feature F15 — Streaming ZIP Writer & Archive Integrity (PKZIP / CRC32)
// ============================================================================
test("Suite 5: Feature F15 — Streaming ZIP Writer & Archive Validity", async (t) => {
  await t.test("generates uncorrupted PKZIP archive with correct CRC32 and headers", () => {
    const chunks = [];
    const writer = new StreamingZipWriter({ onChunk: (c) => chunks.push(c) });

    writer.addFile("transcript_full.jsonl", new TextEncoder().encode('{"role":"user","content":"Hello"}\n'));
    writer.addFile("transcript.md", new TextEncoder().encode("# Session Title\nHello\n"));
    writer.addFile("changes.diff", new TextEncoder().encode("diff --git a/file.js b/file.js\n"));
    writer.addFile("attachments/img_01.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const meta = writer.finish();
    assert.equal(meta.totalFiles, 4);

    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
    const fullZip = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      fullZip.set(chunk, offset);
      offset += chunk.length;
    }

    const parsed = parseZipArchive(fullZip);
    assert.equal(parsed.totalEntries, 4);
    assert.ok(parsed.entries.has("transcript_full.jsonl"));
    assert.ok(parsed.entries.has("transcript.md"));
    assert.ok(parsed.entries.has("changes.diff"));
    assert.ok(parsed.entries.has("attachments/img_01.png"));

    // Verify extracted file content
    assert.equal(parsed.entries.get("transcript_full.jsonl").text(), '{"role":"user","content":"Hello"}\n');
    assert.deepEqual(parsed.entries.get("attachments/img_01.png").data, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  await t.test("handles unicode filenames and nested directory structures", () => {
    const chunks = [];
    const writer = new StreamingZipWriter({ onChunk: (c) => chunks.push(c) });

    writer.addFile("документы/отчет.md", new TextEncoder().encode("Тестовый отчет"));
    writer.finish();

    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
    const fullZip = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) { fullZip.set(c, offset); offset += c.length; }

    const parsed = parseZipArchive(fullZip);
    assert.ok(parsed.entries.has("документы/отчет.md"));
    assert.equal(parsed.entries.get("документы/отчет.md").text(), "Тестовый отчет");
  });

  await t.test("buildZip automatically filters out sensitive files from archive", () => {
    const files = [
      { name: "public.txt", data: "public text" },
      { name: ".env", data: "SECRET=1" },
      { name: ".env.production", data: "SECRET=2" },
      { name: "id_rsa", data: "PRIVATE KEY" },
      { name: "app.keystore", data: new Uint8Array([1, 2, 3]) }
    ];
    const zipBytes = buildZip(files);
    const parsed = parseZipArchive(zipBytes);
    assert.equal(parsed.totalEntries, 1);
    assert.ok(parsed.hasFile("public.txt"));
    assert.ok(!parsed.hasFile(".env"));
    assert.ok(!parsed.hasFile(".env.production"));
    assert.ok(!parsed.hasFile("id_rsa"));
    assert.ok(!parsed.hasFile("app.keystore"));
  });
});

// ============================================================================
// Suite 6: Feature F15 — Large Payload Simulation (>64 MiB Ceiling Elimination)
// ============================================================================
test("Suite 6: Feature F15 — Large Payload Streaming Simulation (>64 MiB)", async (t) => {
  await t.test("streams 70 MiB of mock archive data without buffering entire payload", () => {
    let totalBytesStreamed = 0;
    let chunkCount = 0;

    const writer = new StreamingZipWriter({
      onChunk: (chunk) => {
        totalBytesStreamed += chunk.length;
        chunkCount++;
      }
    });

    // Simulate 7 files of 10 MiB each (70 MiB total payload > 64 MiB limit)
    const MOCK_10MB_LEN = 10 * 1024 * 1024;
    const samplePattern = new Uint8Array(1024);
    for (let i = 0; i < samplePattern.length; i++) samplePattern[i] = (i % 256);

    const mock10MbData = new Uint8Array(MOCK_10MB_LEN);
    for (let pos = 0; pos < MOCK_10MB_LEN; pos += 1024) {
      mock10MbData.set(samplePattern, pos);
    }

    for (let f = 1; f <= 7; f++) {
      writer.addFile(`attachments/large_media_${f}.bin`, mock10MbData);
    }

    const summary = writer.finish();
    assert.equal(summary.totalFiles, 7);
    assert.ok(totalBytesStreamed > 70 * 1024 * 1024);
    assert.ok(chunkCount > 1000); // Confirms chunked emission occurred
  });
});

// ============================================================================
// Suite 7: Edge Cases & Error Resilience
// ============================================================================
test("Suite 7: Edge Cases & Error Resilience", async (t) => {
  await t.test("empty session produces valid ZIP with empty transcripts and manifest", () => {
    const chunks = [];
    const writer = new StreamingZipWriter({ onChunk: (c) => chunks.push(c) });

    writer.addFile("transcript_full.jsonl", new Uint8Array(0));
    writer.addFile("transcript.md", new TextEncoder().encode("# Empty Session\n"));
    writer.addFile("changes.diff", new Uint8Array(0));
    writer.addFile("MANIFEST.txt", new TextEncoder().encode("Empty session export\n"));
    writer.finish();

    const fullZip = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let offset = 0;
    for (const c of chunks) { fullZip.set(c, offset); offset += c.length; }

    const parsed = parseZipArchive(fullZip);
    assert.equal(parsed.totalEntries, 4);
    assert.equal(parsed.entries.get("transcript_full.jsonl").uncompSize, 0);
  });

  await t.test("sanitizeText handles null, undefined, numbers, and boolean inputs gracefully", () => {
    assert.equal(sanitizeText(null), "");
    assert.equal(sanitizeText(undefined), "");
    assert.equal(sanitizeText(12345), "12345");
    assert.equal(sanitizeText(true), "true");
  });

  await t.test("sanitizeDiff handles malformed or empty diffs without throwing", () => {
    assert.equal(sanitizeDiff(""), "");
    assert.equal(sanitizeDiff(null), "");
    assert.equal(sanitizeDiff("Not a real diff at all"), "Not a real diff at all");
  });

  await t.test("isSensitiveFilename handles null, undefined, numbers, and paths safely", () => {
    assert.equal(isSensitiveFilename(null), false);
    assert.equal(isSensitiveFilename(undefined), false);
    assert.equal(isSensitiveFilename(12345), false);
    assert.equal(isSensitiveFilename(""), false);
    assert.equal(isSensitiveFilename("a/.env"), true);
    assert.equal(isSensitiveFilename("b/server.key"), true);
  });

  await t.test("buildZip handles empty files array and empty inputs", () => {
    const zip1 = buildZip([]);
    assert.ok(zip1 instanceof Uint8Array);
    const parsed1 = parseZipArchive(zip1);
    assert.equal(parsed1.totalEntries, 0);

    const zip2 = buildZip(null);
    assert.ok(zip2 instanceof Uint8Array);
    const parsed2 = parseZipArchive(zip2);
    assert.equal(parsed2.totalEntries, 0);
  });
});
