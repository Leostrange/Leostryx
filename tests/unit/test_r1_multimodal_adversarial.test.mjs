import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

const gatewayPath = path.join(REPO_ROOT, "app/assets/web/agy_gateway.js");
const providersPath = path.join(REPO_ROOT, "app/assets/web/agy_providers.js");

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

const { officialModelInfo } = await import("file://" + providersPath).then(
  (m) => m.default || m
);

// ============================================================================
// Suite 1: Extreme Base64 Payload Sizes (1MB - 10MB) Stress Tests
// ============================================================================
test("Extreme Payload Sizes: Multi-megabyte images and serialization limits", async (t) => {
  await t.test("2MB binary image serialization and transformations", () => {
    const size2MB = 2 * 1024 * 1024;
    const randomBytes = crypto.randomBytes(size2MB);
    const expectedB64 = randomBytes.toString("base64");

    const mediaItem = {
      mimeType: "image/png",
      description: "large_2mb.png",
      payload: {
        case: "inlineData",
        value: new Uint8Array(randomBytes.buffer, randomBytes.byteOffset, randomBytes.byteLength)
      }
    };

    const openAIChat = transformToOpenAIChat(mediaItem);
    assert.equal(openAIChat.type, "image_url");
    assert.equal(openAIChat.image_url.url, `data:image/png;base64,${expectedB64}`);

    const openAIResp = transformToOpenAIResponses(mediaItem);
    assert.equal(openAIResp.type, "input_image");
    assert.equal(openAIResp.image_url, `data:image/png;base64,${expectedB64}`);

    const anthropic = transformToAnthropic(mediaItem);
    assert.equal(anthropic.type, "image");
    assert.equal(anthropic.source.media_type, "image/png");
    assert.equal(anthropic.source.data, expectedB64);
  });

  await t.test("Hardened: maskMediaInLogs processes payloads >= 4MB without RangeError in <500ms", () => {
    // Generates a 4MB payload (5.3MB base64 string)
    const size4MB = 4 * 1024 * 1024;
    const raw4MB = crypto.randomBytes(size4MB);
    const b64_4MB = raw4MB.toString("base64");
    const dataUrl4MB = `data:image/jpeg;base64,${b64_4MB}`;
    const logString = `[DEBUG] Outgoing request payload: ${dataUrl4MB}`;

    const t0 = performance.now();
    const redactedString = maskMediaInLogs(logString);
    const duration = performance.now() - t0;

    assert.ok(duration < 500, `4MB redaction must complete in <500ms (took ${duration.toFixed(2)}ms)`);
    assert.ok(!redactedString.includes(b64_4MB.substring(0, 100)), "4MB base64 payload must not appear in redacted log");
    assert.ok(redactedString.includes("[IMAGE: image/jpeg, "), "Metadata must be accurately preserved");
    assert.ok(redactedString.includes("bytes]"), "Metadata must be accurately preserved");

    // Object input must redact without error and must NOT leak base64
    const objWith4MB = { url: dataUrl4MB };
    const resultObj = maskMediaInLogs(objWith4MB);
    assert.ok(!resultObj.url.includes(b64_4MB.substring(0, 100)), "Object containing 4MB image must have base64 redacted");
    assert.ok(resultObj.url.startsWith("[IMAGE: image/jpeg, "));
    assert.ok(resultObj.url.endsWith("bytes]"));
  });

  await t.test("Hardened: 20MB maximum attachment payload redacts in <500ms with zero leak", () => {
    const size20MB = 20 * 1024 * 1024;
    const b64_20MB = "A".repeat(Math.round((size20MB * 4) / 3));
    const log20MB = `[DEBUG] Payload: data:image/jpeg;base64,${b64_20MB}`;
    const t0 = performance.now();
    const redacted = maskMediaInLogs(log20MB);
    const dur = performance.now() - t0;
    assert.ok(dur < 500, `20MB redaction must complete in <500ms (took ${dur.toFixed(2)}ms)`);
    assert.ok(!redacted.includes("AAAA"), "20MB base64 must not leak");
  });
});

// ============================================================================
// Suite 2: Malformed Data URLs & Boundary Cases
// ============================================================================
test("Malformed Data URLs: Error handling & robustness", async (t) => {
  await t.test("parseDataUrl handles missing mime type (data:;base64,...)", () => {
    const res = parseDataUrl("data:;base64,QUJD");
    assert.equal(res.mimeType, "");
    assert.equal(res.base64Data, "QUJD");
  });

  await t.test("parseDataUrl rejects missing ;base64 indicator", () => {
    assert.throws(
      () => parseDataUrl("data:image/png,QUJD"),
      /Invalid base64 image data URL/
    );
    assert.throws(
      () => parseDataUrl("data:image/png;charset=utf-8,QUJD"),
      /missing ;base64 indicator/
    );
  });

  await t.test("parseDataUrl rejects empty payload (trailing comma)", () => {
    assert.throws(
      () => parseDataUrl("data:image/png;base64,"),
      /Invalid base64 image data URL/
    );
  });

  await t.test("parseDataUrl rejects malformed prefix", () => {
    assert.throws(
      () => parseDataUrl("data//image/png;base64,QUJD"),
      /Invalid base64 image data URL/
    );
    assert.throws(
      () => parseDataUrl("http:image/png;base64,QUJD"),
      /Invalid base64 image data URL/
    );
  });

  await t.test("parseDataUrl rejects non-string inputs", () => {
    assert.throws(() => parseDataUrl(null), /must be a non-empty string/);
    assert.throws(() => parseDataUrl(undefined), /must be a non-empty string/);
    assert.throws(() => parseDataUrl(""), /must be a non-empty string/);
    assert.throws(() => parseDataUrl(12345), /must be a non-empty string/);
    assert.throws(() => parseDataUrl({}), /must be a non-empty string/);
  });

  await t.test("extractMediaInfo handles malformed string or object gracefully", () => {
    assert.throws(() => extractMediaInfo(null), /Invalid attachment item/);
    assert.throws(() => extractMediaInfo(undefined), /Invalid attachment item/);
    assert.throws(() => extractMediaInfo("ftp://example.com/img.png"), /Unsupported string attachment/);
    assert.throws(() => extractMediaInfo({}), /Unable to extract media information/);
  });
});

// ============================================================================
// Suite 3: Weird & Non-Standard MIME Types
// ============================================================================
test("Weird & Non-Standard MIME Types", async (t) => {
  const weirdImageMimes = [
    "image/svg+xml",
    "image/tiff",
    "image/vnd.microsoft.icon",
    "image/x-icon",
    "image/bmp",
    "image/heic",
    "image/avif"
  ];

  await t.test("isImageMime correctly recognizes weird image MIME types", () => {
    for (const mime of weirdImageMimes) {
      assert.equal(isImageMime(mime), true, `${mime} should be recognized as image MIME`);
    }
  });

  await t.test("isImageMime rejects non-image MIME types", () => {
    const nonImageMimes = [
      "application/pdf",
      "text/plain",
      "application/octet-stream",
      "video/mp4",
      "audio/webm",
      "application/zip"
    ];
    for (const mime of nonImageMimes) {
      assert.equal(isImageMime(mime), false, `${mime} should NOT be recognized as image MIME`);
    }
  });

  await t.test("Anthropic strictly rejects weird MIME types", () => {
    for (const mime of weirdImageMimes) {
      const item = { mimeType: mime, data: "QUJDRA==" };
      assert.throws(
        () => transformToAnthropic(item),
        new RegExp(`Image format not supported by Anthropic: ${mime.replace("+", "\\+")}`)
      );
    }
  });

  await t.test("OpenAI Chat and Responses accept weird image MIME types", () => {
    for (const mime of weirdImageMimes) {
      const item = { mimeType: mime, data: "QUJDRA==" };
      const chatRes = transformToOpenAIChat(item);
      assert.equal(chatRes.type, "image_url");
      assert.equal(chatRes.image_url.url, `data:${mime};base64,QUJDRA==`);

      const respRes = transformToOpenAIResponses(item);
      assert.equal(respRes.type, "input_image");
      assert.equal(respRes.image_url, `data:${mime};base64,QUJDRA==`);
    }
  });

  await t.test("MIME type normalization handles uppercase and parameters", () => {
    assert.equal(normalizeMimeType("IMAGE/PNG"), "image/png");
    assert.equal(normalizeMimeType("image/jpeg; charset=utf-8"), "image/jpeg");
    assert.equal(normalizeMimeType("image/jpg"), "image/jpeg");
    assert.equal(normalizeMimeType("IMAGE/JPG; foo=bar"), "image/jpeg");
  });

  await t.test("validateVisionSupport triggers for weird image MIME types", () => {
    for (const mime of weirdImageMimes) {
      const item = { mimeType: mime, data: "QUJDRA==" };
      const resText = validateVisionSupport("deepseek-chat", [item]);
      assert.equal(resText.valid, false, `${mime} should be blocked on deepseek-chat`);

      const resVision = validateVisionSupport("gpt-4o", [item]);
      assert.equal(resVision.valid, true, `${mime} should be allowed on gpt-4o`);
    }
  });
});

// ============================================================================
// Suite 4: Complex Message Sequences (Mixed text, multiple images, turns)
// ============================================================================
test("Complex Message Sequences: Multi-turn & Multi-part transformations", async (t) => {
  const samplePngUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const sampleJpgUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
  const sampleWebpUrl = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

  const complexRequest = {
    model: "claude-3-5-sonnet",
    temperature: 0.7,
    max_tokens: 2048,
    messages: [
      {
        role: "system",
        content: "System prompt part 1."
      },
      {
        role: "system",
        content: [{ type: "text", text: "System prompt part 2." }]
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Here are three reference designs:" },
          { type: "image_url", image_url: { url: samplePngUrl } },
          { type: "text", text: "And the mobile layout:" },
          { type: "image_url", image_url: { url: sampleJpgUrl } },
          { type: "image_url", image_url: { url: sampleWebpUrl } }
        ]
      },
      {
        role: "assistant",
        content: "I have reviewed all three images. Which component should I implement first?"
      },
      {
        role: "user",
        content: "Please implement the navigation bar from the first image."
      }
    ]
  };

  await t.test("Anthropic transformation preserves system prompts and multi-image order", () => {
    const anthropicReq = transformRequest(complexRequest, "anthropic");

    assert.equal(
      anthropicReq.system,
      "System prompt part 1.\nSystem prompt part 2."
    );

    assert.equal(anthropicReq.messages.length, 3);

    const turn1 = anthropicReq.messages[0];
    assert.equal(turn1.role, "user");
    assert.equal(turn1.content.length, 5);
    assert.equal(turn1.content[0].type, "text");
    assert.equal(turn1.content[0].text, "Here are three reference designs:");

    assert.equal(turn1.content[1].type, "image");
    assert.equal(turn1.content[1].source.media_type, "image/png");

    assert.equal(turn1.content[2].type, "text");
    assert.equal(turn1.content[2].text, "And the mobile layout:");

    assert.equal(turn1.content[3].type, "image");
    assert.equal(turn1.content[3].source.media_type, "image/jpeg");

    assert.equal(turn1.content[4].type, "image");
    assert.equal(turn1.content[4].source.media_type, "image/webp");

    assert.equal(anthropicReq.messages[1].role, "assistant");
    assert.equal(
      anthropicReq.messages[1].content,
      "I have reviewed all three images. Which component should I implement first?"
    );

    assert.equal(anthropicReq.messages[2].role, "user");
    assert.equal(
      anthropicReq.messages[2].content,
      "Please implement the navigation bar from the first image."
    );
  });

  await t.test("Responses API transformation preserves multi-image and text parts", () => {
    const responsesReq = transformRequest(complexRequest, "responses");

    assert.equal(responsesReq.messages.length, 5);
    const userTurn = responsesReq.messages[2];
    assert.equal(userTurn.role, "user");
    assert.equal(userTurn.content.length, 5);

    assert.equal(userTurn.content[0].type, "input_text");
    assert.equal(userTurn.content[1].type, "input_image");
    assert.equal(userTurn.content[1].image_url, samplePngUrl);

    assert.equal(userTurn.content[2].type, "input_text");
    assert.equal(userTurn.content[3].type, "input_image");
    assert.equal(userTurn.content[3].image_url, sampleJpgUrl);

    assert.equal(userTurn.content[4].type, "input_image");
    assert.equal(userTurn.content[4].image_url, sampleWebpUrl);
  });

  await t.test("Tool output in user content role string passes through cleanly", () => {
    const reqWithToolMsg = {
      model: "claude-3-5-sonnet",
      messages: [
        { role: "user", content: "List files" },
        { role: "assistant", content: "Listing files..." },
        { role: "tool", content: "file1.txt\nfile2.txt", tool_call_id: "call_abc" }
      ]
    };
    const res = transformRequest(reqWithToolMsg, "anthropic");
    assert.equal(res.messages.length, 3);
    assert.equal(res.messages[2].role, "user");
    assert.equal(res.messages[2].content, "file1.txt\nfile2.txt");
  });
});

// ============================================================================
// Suite 5: Log Redaction Robustness & Adversarial Evasion Checks
// ============================================================================
test("Log Redaction Robustness: Multiple formats, edge cases, and leak checks", async (t) => {
  const sampleB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const sampleDataUrl = `data:image/png;base64,${sampleB64}`;

  await t.test("redacts data URL inside standard log lines", () => {
    const log = `[HTTP 200] POST /v1/chat/completions payload={"image":"${sampleDataUrl}"}`;
    const redacted = maskMediaInLogs(log);
    assert.ok(!redacted.includes(sampleB64), "Base64 payload must not be in log");
    assert.ok(redacted.includes("[IMAGE: image/png, 72 bytes]"), "Must show masked token with bytes");
  });

  await t.test("redacts JSON object recursively preserving structure", () => {
    const obj = {
      level: "info",
      event: "send_message",
      request: {
        model: "gpt-4o",
        media: [
          {
            url: sampleDataUrl,
            meta: { alt: "screenshot" }
          }
        ]
      }
    };

    const redacted = maskMediaInLogs(obj);
    assert.equal(typeof redacted, "object");
    const jsonStr = JSON.stringify(redacted);
    assert.ok(!jsonStr.includes(sampleB64), "No base64 in JSON dump");
    assert.equal(redacted.request.media[0].url, "[IMAGE: image/png, 72 bytes]");
    assert.equal(redacted.request.media[0].meta.alt, "screenshot");
  });

  await t.test("redacts data URLs with weird image MIME types", () => {
    const svgDataUrl = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==";
    const log = `Loaded vector asset: ${svgDataUrl}`;
    const redacted = maskMediaInLogs(log);
    assert.ok(!redacted.includes("PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg=="));
    assert.ok(redacted.includes("[IMAGE: image/svg+xml"));
  });

  await t.test("Hardened: Redacts JSON-escaped slashes (image\\/png) with zero leak", () => {
    const escapedJson = `{"url":"data:image\\/png;base64,${sampleB64}"}`;
    const redacted = maskMediaInLogs(escapedJson);
    const isLeaked = redacted.includes(sampleB64);
    assert.equal(isLeaked, false, "Escaped slashes must be redacted with 0% leak");
    assert.ok(redacted.includes("[IMAGE: image/png, 72 bytes]"), "Escaped slash image must be replaced with metadata token");
  });

  await t.test("Hardened: Redacts data URLs with parameters (charset=utf-8) with zero leak", () => {
    const dataUrlWithParam = `data:image/svg+xml;charset=utf-8;base64,${sampleB64}`;
    const redacted = maskMediaInLogs(dataUrlWithParam);
    const isLeaked = redacted.includes(sampleB64);
    assert.equal(isLeaked, false, "Data URL with media parameter must be redacted with 0% leak");
    assert.ok(redacted.includes("[IMAGE: image/svg+xml, 72 bytes]"), "Param URL must be replaced with metadata token");
  });

  await t.test("Hardened: Redacts MIME chunked base64 with newlines with zero leak", () => {
    const chunkedB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYA\nAAAfFcSJAAAADUlEQVR42mNk+M9QDwAD\nhgGAWjR9awAAAABJRU5ErkJggg==";
    const dataUrlWithNewlines = `data:image/png;base64,${chunkedB64}`;
    const redacted = maskMediaInLogs(dataUrlWithNewlines);
    const tailLeaked = redacted.includes("AAAfFcSJAAAADUlEQVR42mNk+M9QDwAD");
    assert.equal(tailLeaked, false, "Base64 with newlines must not leak tail chunks");
    assert.ok(redacted.includes("[IMAGE: image/png, 72 bytes]"), "Chunked base64 must be replaced with metadata token");
  });

  await t.test("Hardened: Anthropic and Gemini JSON wire payloads redacted", () => {
    const anthropicDump = JSON.stringify({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: sampleB64
      }
    });
    const redactedAnthropic = maskMediaInLogs(anthropicDump);
    assert.ok(!redactedAnthropic.includes(sampleB64), "Anthropic raw data must not appear in log");
    assert.ok(redactedAnthropic.includes("<base64 redacted: 72 bytes>"));
  });

  await t.test("does not tamper with legitimate HTTPS URLs or regular base64 auth headers", () => {
    const log = "Connecting to https://api.openai.com/v1/models with query ?image=true";
    assert.equal(maskMediaInLogs(log), log);
  });
});
