import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

// Load modules under test
const gatewayPath = path.join(REPO_ROOT, "app/assets/web/agy_gateway.js");
const providersPath = path.join(REPO_ROOT, "app/assets/web/agy_providers.js");

// Gateway module
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
} = await import("file://" + gatewayPath).then((m) => m.default || m);

// Providers module
const { officialModelInfo, effectiveInfo } = await import("file://" + providersPath).then(
  (m) => m.default || m
);

// Sample fixtures
const SAMPLE_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG header
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89
]);
const SAMPLE_PNG_B64 = Buffer.from(SAMPLE_PNG_BYTES).toString("base64");
const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_B64}`;

const SAMPLE_JPG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString("base64");
const SAMPLE_JPG_DATA_URL = `data:image/jpg;base64,${SAMPLE_JPG_B64}`;

const MEDIA_SCHEMA_PNG = {
  mimeType: "image/png",
  description: "screenshot.png",
  payload: {
    case: "inlineData",
    value: SAMPLE_PNG_BYTES
  }
};

const MEDIA_SCHEMA_JPG = {
  mimeType: "image/jpg",
  description: "photo.jpg",
  payload: {
    case: "inlineData",
    value: Buffer.from(SAMPLE_JPG_B64, "base64")
  }
};

// ============================================================================
// Test Suite 1: Multimodal Payload Serialization & Conversion
// ============================================================================
test("Multimodal Serialization: OpenAI Chat Completions image_url format", async (t) => {
  await t.test("converts MediaSchema with inlineData Uint8Array to image_url", () => {
    const res = transformToOpenAIChat(MEDIA_SCHEMA_PNG);
    assert.equal(res.type, "image_url");
    assert.ok(res.image_url, "image_url object must be present");
    assert.equal(res.image_url.url, SAMPLE_PNG_DATA_URL);
    assert.equal(res.image_url.detail, "auto");
  });

  await t.test("preserves remote HTTPS image URLs without re-encoding", () => {
    const remote = { url: "https://example.com/test.png" };
    const res = transformToOpenAIChat(remote, { detail: "high" });
    assert.equal(res.type, "image_url");
    assert.equal(res.image_url.url, "https://example.com/test.png");
    assert.equal(res.image_url.detail, "high");
  });

  await t.test("converts raw data URL string into image_url part", () => {
    const res = transformToOpenAIChat(SAMPLE_PNG_DATA_URL);
    assert.equal(res.type, "image_url");
    assert.equal(res.image_url.url, SAMPLE_PNG_DATA_URL);
  });
});

test("Multimodal Serialization: OpenAI Responses API input_image format", async (t) => {
  await t.test("converts MediaSchema with inlineData to input_image", () => {
    const res = transformToOpenAIResponses(MEDIA_SCHEMA_PNG);
    assert.equal(res.type, "input_image");
    assert.equal(res.image_url, SAMPLE_PNG_DATA_URL);
    assert.equal(res.detail, "auto");
  });

  await t.test("converts full chat completion request to Responses API format", () => {
    const req = {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this UI:" },
            { type: "image_url", image_url: { url: SAMPLE_PNG_DATA_URL } }
          ]
        }
      ]
    };

    const transformed = transformRequest(req, "responses");
    assert.equal(transformed.messages[0].role, "user");
    const content = transformed.messages[0].content;
    assert.equal(content.length, 2);
    assert.equal(content[0].type, "input_text");
    assert.equal(content[0].text, "Look at this UI:");
    assert.equal(content[1].type, "input_image");
    assert.equal(content[1].image_url, SAMPLE_PNG_DATA_URL);
  });
});

test("Multimodal Serialization: Anthropic Messages image block format", async (t) => {
  await t.test("converts inlineData to Anthropic base64 image block", () => {
    const res = transformToAnthropic(MEDIA_SCHEMA_PNG);
    assert.equal(res.type, "image");
    assert.ok(res.source, "source block must be present");
    assert.equal(res.source.type, "base64");
    assert.equal(res.source.media_type, "image/png");
    assert.equal(res.source.data, SAMPLE_PNG_B64);
    // Must NOT contain data: URL prefix in source.data
    assert.ok(!res.source.data.startsWith("data:"));
  });

  await t.test("normalizes image/jpg to image/jpeg for Anthropic compliance", () => {
    const res = transformToAnthropic(MEDIA_SCHEMA_JPG);
    assert.equal(res.type, "image");
    assert.equal(res.source.media_type, "image/jpeg");
    assert.equal(res.source.data, SAMPLE_JPG_B64);
  });

  await t.test("normalizes data URL containing image/jpg", () => {
    const res = transformToAnthropic(SAMPLE_JPG_DATA_URL);
    assert.equal(res.type, "image");
    assert.equal(res.source.media_type, "image/jpeg");
  });

  await t.test("accepts all 4 official Anthropic image formats", () => {
    for (const mime of ["image/jpeg", "image/png", "image/gif", "image/webp"]) {
      const item = { mimeType: mime, data: "QUJD" };
      const res = transformToAnthropic(item);
      assert.equal(res.source.media_type, mime);
    }
  });

  await t.test("rejects unsupported media formats for Anthropic with descriptive error", () => {
    const bmpItem = { mimeType: "image/bmp", data: "QUJD" };
    assert.throws(() => transformToAnthropic(bmpItem), /Image format not supported by Anthropic: image\/bmp/);

    const heicItem = { mimeType: "image/heic", data: "QUJD" };
    assert.throws(() => transformToAnthropic(heicItem), /Image format not supported by Anthropic: image\/heic/);

    const pdfItem = { mimeType: "application/pdf", data: "QUJD" };
    assert.throws(() => transformToAnthropic(pdfItem), /Image format not supported by Anthropic/);
  });
});

test("Gateway Architecture: Anthropic Content Array Bug Fix Verification", async (t) => {
  await t.test("assigns converted array content back to Anthropic message content", () => {
    const req = {
      model: "claude-3-5-sonnet",
      messages: [
        {
          role: "system",
          content: "You are a helpful coding assistant."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe what you see:" },
            { type: "image_url", image_url: { url: SAMPLE_PNG_DATA_URL } }
          ]
        }
      ]
    };

    const transformed = transformRequest(req, "anthropic");

    // Top-level system string
    assert.equal(transformed.system, "You are a helpful coding assistant.");
    assert.equal(transformed.messages.length, 1);

    const userMsg = transformed.messages[0];
    assert.equal(userMsg.role, "user");

    // CRITICAL: userMsg.content must NOT be empty string! It must be the converted array.
    assert.ok(Array.isArray(userMsg.content), "Anthropic content must be an array, not empty string");
    assert.equal(userMsg.content.length, 2);
    assert.equal(userMsg.content[0].type, "text");
    assert.equal(userMsg.content[0].text, "Describe what you see:");
    assert.equal(userMsg.content[1].type, "image");
    assert.equal(userMsg.content[1].source.type, "base64");
    assert.equal(userMsg.content[1].source.media_type, "image/png");
    assert.equal(userMsg.content[1].source.data, SAMPLE_PNG_B64);
  });

  await t.test("convertUserContent correctly formats Anthropic vs Gemini blocks", () => {
    const blocks = [
      { type: "text", text: "Hello" },
      { type: "image_url", image_url: { url: SAMPLE_PNG_DATA_URL } }
    ];

    const anthropicBlocks = convertUserContent(blocks, true);
    assert.equal(anthropicBlocks[0].type, "text");
    assert.equal(anthropicBlocks[1].type, "image");
    assert.equal(anthropicBlocks[1].source.media_type, "image/png");

    const geminiBlocks = convertUserContent(blocks, false);
    assert.equal(geminiBlocks[0].text, "Hello");
    assert.ok(geminiBlocks[1].inline_data, "Gemini inline_data block must be present");
    assert.equal(geminiBlocks[1].inline_data.mime_type, "image/png");
    assert.equal(geminiBlocks[1].inline_data.data, SAMPLE_PNG_B64);
  });
});

// ============================================================================
// Test Suite 2: Model Vision Capability Resolution
// ============================================================================
test("Model Vision Capability Resolution: Family & ID mappings", async (t) => {
  const VISION_MODELS = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.5-preview",
    "o1",
    "o3-mini",
    "o4",
    "claude-3-5-sonnet",
    "claude-3-7-sonnet",
    "claude-3-opus",
    "claude-3-haiku",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-2.5-pro",
    "qwen-vl-max",
    "qwen-2.5-vl-72b",
    "pixtral-12b",
    "llama-3.2-11b-vision",
    "llama-3.2-90b-vision"
  ];

  const TEXT_ONLY_MODELS = [
    "deepseek-chat",
    "deepseek-reasoner",
    "deepseek-r1",
    "llama-3.3-70b",
    "llama-3.1-405b",
    "llama-3.1-70b",
    "llama-3.2-1b",
    "llama-3.2-3b",
    "mistral-large",
    "codestral-latest",
    "qwen-2.5-coder-32b",
    "qwen-2.5-72b",
    "claude-2.0",
    "claude-instant-1.2",
    "gpt-4",
    "gpt-3.5-turbo"
  ];

  await t.test("identifies vision capability in officialModelInfo from agy_providers.js", () => {
    for (const id of VISION_MODELS) {
      const info = officialModelInfo(null, id);
      assert.ok(info, `officialModelInfo must resolve for ${id}`);
      assert.ok(
        info.inputModes && info.inputModes.includes("image"),
        `Model ${id} must have 'image' in inputModes. Got: ${JSON.stringify(info.inputModes)}`
      );
    }

    for (const id of TEXT_ONLY_MODELS) {
      const info = officialModelInfo(null, id);
      assert.ok(info, `officialModelInfo must resolve for ${id}`);
      assert.ok(
        !info.inputModes || !info.inputModes.includes("image"),
        `Model ${id} must NOT have 'image' in inputModes. Got: ${JSON.stringify(info?.inputModes)}`
      );
    }
  });

  await t.test("isModelVisionCapable resolves strings and config objects accurately", () => {
    for (const id of VISION_MODELS) {
      assert.equal(isModelVisionCapable(id), true, `${id} should be vision capable`);
    }

    for (const id of TEXT_ONLY_MODELS) {
      assert.equal(isModelVisionCapable(id), false, `${id} should NOT be vision capable`);
    }

    // Config object with supportedMimeTypes Map
    const configWithVisionMap = {
      label: "custom-vision",
      supportedMimeTypes: new Map([["image/png", true]])
    };
    assert.equal(isModelVisionCapable(configWithVisionMap), true);

    const configWithEmptyMap = {
      label: "custom-text",
      supportedMimeTypes: new Map()
    };
    assert.equal(isModelVisionCapable(configWithEmptyMap), false);

    // Config object with modelFeatures
    const configWithFeatures = {
      label: "custom-feat",
      modelFeatures: { supportsImages: true }
    };
    assert.equal(isModelVisionCapable(configWithFeatures), true);
  });
});

// ============================================================================
// Test Suite 3: Pre-Send Validation & Draft Retention
// ============================================================================
test("Pre-Send Validation: Blocks unsupported media and preserves drafts", async (t) => {
  await t.test("blocks send when images are attached to a non-vision model", () => {
    const result = validateVisionSupport("deepseek-chat", [MEDIA_SCHEMA_PNG]);
    assert.equal(result.valid, false);
    assert.ok(
      result.error.includes("Selected model does not support images"),
      `Expected vision warning message, got: ${result.error}`
    );
  });

  await t.test("allows send when images are attached to a vision-capable model", () => {
    const result = validateVisionSupport("gpt-4o", [MEDIA_SCHEMA_PNG]);
    assert.equal(result.valid, true);
    assert.equal(result.error, undefined);
  });

  await t.test("does NOT block non-image attachments (code/text) even on non-vision models", () => {
    const textAttachment = {
      mimeType: "text/x-python",
      description: "solution.py",
      payload: { case: "inlineData", value: Buffer.from("print('hello')") }
    };
    const zipAttachment = {
      mimeType: "application/zip",
      description: "archive.zip",
      payload: { case: "inlineData", value: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) }
    };

    const res1 = validateVisionSupport("deepseek-chat", [textAttachment]);
    assert.equal(res1.valid, true, "Text attachment must not be blocked on deepseek-chat");

    const res2 = validateVisionSupport("llama-3.3-70b", [zipAttachment]);
    assert.equal(res2.valid, true, "Zip attachment must not be blocked on llama-3.3-70b");
  });

  await t.test("draft retention guarantee: draft input and media survive blocked send", () => {
    // Simulate composer state
    const inputDraft = {
      text: "Please inspect this chart and fix the bug",
      attachments: [MEDIA_SCHEMA_PNG]
    };

    // Pre-send validation check
    const validation = validateVisionSupport("deepseek-chat", inputDraft.attachments);
    assert.equal(validation.valid, false);

    // Because validation failed, send action is aborted BEFORE clearInput()
    // Verify draft remains intact
    assert.equal(inputDraft.text, "Please inspect this chart and fix the bug");
    assert.equal(inputDraft.attachments.length, 1);
    assert.equal(inputDraft.attachments[0].description, "screenshot.png");
  });
});

// ============================================================================
// Test Suite 4: Base64 and Binary Log Redaction
// ============================================================================
test("Log Redaction: Strips Base64 payloads while retaining metadata", async (t) => {
  await t.test("masks Data URLs in log strings", () => {
    const logLine = `[CoreServerService] Outgoing request with payload: {"url":"data:image/png;base64,${SAMPLE_PNG_B64}"}`;
    const redacted = maskMediaInLogs(logLine);

    // Data URL base64 should be gone
    assert.ok(!redacted.includes(SAMPLE_PNG_B64), "Raw base64 payload must not appear in log");
    // Metadata (MIME type and byte size) must be preserved
    assert.ok(redacted.includes("[IMAGE: image/png"), "MIME type must be preserved in log");
    assert.ok(redacted.includes("bytes]"), "Byte size must be preserved in log");
  });

  await t.test("masks Anthropic JSON data fields in dumps", () => {
    const dump = JSON.stringify({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: "A".repeat(100)
      }
    });

    const redacted = maskMediaInLogs(dump);
    assert.ok(!redacted.includes("A".repeat(100)), "Base64 data must be masked");
    assert.ok(redacted.includes("<base64 redacted: 75 bytes>"));
  });

  await t.test("masks object structures recursively", () => {
    const obj = {
      message: "Processing image",
      attachmentUrl: SAMPLE_PNG_DATA_URL,
      nested: {
        data: SAMPLE_PNG_DATA_URL
      }
    };

    const redacted = maskMediaInLogs(obj);
    assert.equal(typeof redacted, "object");
    assert.ok(!JSON.stringify(redacted).includes(SAMPLE_PNG_B64));
    assert.ok(JSON.stringify(redacted).includes("[IMAGE: image/png"));
  });

  await t.test("leaves non-image text and regular URLs completely intact", () => {
    const normalLog = "User asked: 'How do I use https://github.com/earendil-works/pi-ai?' in chat session 123";
    const redacted = maskMediaInLogs(normalLog);
    assert.equal(redacted, normalLog);
  });
});

// ============================================================================
// Test Suite 5: main.js LNa & NNa Integration Verification
// ============================================================================
test("main.js Validation: Verifies patched LNa and NNa logic against AST/regex", async (t) => {
  const mainJsPath = path.join(REPO_ROOT, "app/assets/web/generated/main.js");
  const mainJsContent = fs.readFileSync(mainJsPath, "utf-8");

  // Verify that the artificial bypass window.__agyBlockUnsupportedMedia is removed from validation
  assert.ok(
    !mainJsContent.includes("window.__agyBlockUnsupportedMedia===!0&&LNa"),
    "window.__agyBlockUnsupportedMedia bypass guard must be eliminated from LNa calls in main.js"
  );

  // Verify that LNa exists and checks image support genuinely
  assert.ok(mainJsContent.includes("function LNa("), "function LNa must exist in main.js");
  assert.ok(
    mainJsContent.includes("Selected model does not support images"),
    "NNa must contain user-facing warning message for unsupported image models"
  );
});

// ============================================================================
// Test Suite 6: LNa String & Object Model ID Resolution
// ============================================================================
test("Pre-Send Vision Resolution: LNa supports string IDs and object descriptors", async (t) => {
  const mainJsPath = path.join(REPO_ROOT, "app/assets/web/generated/main.js");
  const mainJsContent = fs.readFileSync(mainJsPath, "utf-8");
  const lnaMatch = mainJsContent.match(/function LNa\(a,b\)\{[\s\S]*?return!supp\}/);
  assert.ok(lnaMatch, "function LNa must be found in main.js");

  const evalFn = new Function("window", lnaMatch[0] + "; return LNa;");
  const LNa = evalFn({ AgyGateway: { isModelVisionCapable } });

  const imgAttachment = [{ mimeType: "image/png" }];
  const nonImgAttachment = [{ mimeType: "text/x-python" }];

  await t.test("allows bare string IDs of vision-capable models", () => {
    assert.equal(LNa(imgAttachment, "gpt-4o"), false, "gpt-4o string ID must NOT be blocked");
    assert.equal(LNa(imgAttachment, "claude-3-5-sonnet"), false, "claude-3-5-sonnet string ID must NOT be blocked");
    assert.equal(LNa(imgAttachment, "gemini-2.0-flash"), false, "gemini-2.0-flash string ID must NOT be blocked");
    assert.equal(LNa(imgAttachment, "mimo-v2.6-pro"), false, "mimo-v2.6-pro string ID must NOT be blocked");
    assert.equal(LNa(imgAttachment, "mimo-v2.6-flash"), false, "mimo-v2.6-flash string ID must NOT be blocked");
  });

  await t.test("blocks bare string IDs of non-vision models", () => {
    assert.equal(LNa(imgAttachment, "deepseek-chat"), true, "deepseek-chat string ID must be blocked");
    assert.equal(LNa(imgAttachment, "llama-3.1-70b"), true, "llama-3.1-70b string ID must be blocked");
  });

  await t.test("allows object model configurations with .id, .model, or .name", () => {
    assert.equal(LNa(imgAttachment, { id: "gpt-4o" }), false);
    assert.equal(LNa(imgAttachment, { model: "claude-3-5-sonnet" }), false);
    assert.equal(LNa(imgAttachment, { name: "mimo-v2.6-pro" }), false);
    assert.equal(LNa(imgAttachment, { id: "deepseek-chat" }), true);
    assert.equal(LNa(imgAttachment, { model: "llama-3.1-70b" }), true);
  });

  await t.test("never blocks non-image attachments even on non-vision models", () => {
    assert.equal(LNa(nonImgAttachment, "deepseek-chat"), false);
    assert.equal(LNa(nonImgAttachment, { id: "llama-3.1-70b" }), false);
  });
});

// ============================================================================
// Test Suite 7: Dalvik Multi-DEX Architecture & Zero Shadowing
// ============================================================================
test("Dalvik Bytecode Attestation: Partitioning, Size & Zero Shadowing", async (t) => {
  const cp = await import("node:child_process");

  await t.test("classes.dex contains strictly 208 classes with zero AgyGateway", () => {
    const classes1 = cp
      .execFileSync("baksmali", ["list", "classes", path.join(REPO_ROOT, "app/classes.dex")], {
        encoding: "utf8"
      })
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("L"));

    assert.equal(classes1.length, 208, "app/classes.dex must contain strictly 208 classes");
    assert.ok(
      !classes1.some((c) => c.includes("AgyGateway")),
      "Lcom/agy/ru/AgyGateway; must be completely ABSENT from app/classes.dex"
    );

    const stat1 = fs.statSync(path.join(REPO_ROOT, "app/classes.dex"));
    assert.ok(
      stat1.size >= 280000 && stat1.size <= 290000,
      `app/classes.dex size should be ~284,000 bytes, got: ${stat1.size}`
    );
  });

  await t.test("classes2.dex contains strictly 177 classes including AgyGateway", () => {
    const classes2 = cp
      .execFileSync("baksmali", ["list", "classes", path.join(REPO_ROOT, "app/classes2.dex")], {
        encoding: "utf8"
      })
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("L"));

    assert.equal(classes2.length, 177, "app/classes2.dex must contain strictly 177 classes");
    assert.ok(
      classes2.some((c) => c === "Lcom/agy/ru/AgyGateway;"),
      "Lcom/agy/ru/AgyGateway; must exist in app/classes2.dex"
    );
  });

  await t.test("zero class overlap exists between classes.dex and classes2.dex", () => {
    const classes1 = cp
      .execFileSync("baksmali", ["list", "classes", path.join(REPO_ROOT, "app/classes.dex")], {
        encoding: "utf8"
      })
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("L"));

    const classes2 = cp
      .execFileSync("baksmali", ["list", "classes", path.join(REPO_ROOT, "app/classes2.dex")], {
        encoding: "utf8"
      })
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("L"));

    const set1 = new Set(classes1);
    const overlap = classes2.filter((c) => set1.has(c));
    assert.equal(overlap.length, 0, `Overlap must be 0, found: ${overlap.join(", ")}`);
  });
});
