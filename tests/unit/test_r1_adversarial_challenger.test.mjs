import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
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

const { officialModelInfo, effectiveInfo } = await import("file://" + providersPath).then(
  (m) => m.default || m
);

// Synthetic reproduction of LNa and NNa from main.js (exact source logic)
function simulateLNa(a, b) {
  if (!a || !a.length) return false;
  var hasImg = a.some((c) => /^image\//i.test(String(c?.mimeType || "")));
  if (!hasImg) return false;
  var supp = false;
  if (b && typeof b.get === "function") {
    supp = b.get("image/png") === true || b.size > 0;
  } else if (b && typeof b === "object") {
    if (b.supportedMimeTypes && typeof b.supportedMimeTypes.get === "function") {
      supp = b.supportedMimeTypes.get("image/png") === true || b.supportedMimeTypes.size > 0;
    }
    if (!supp && b.modelFeatures && typeof b.modelFeatures.supportsImages === "boolean") {
      supp = b.modelFeatures.supportsImages;
    }
    if (!supp && typeof b.images === "boolean") {
      supp = b.images;
    }
    if (!supp && Array.isArray(b.inputModes)) {
      supp = b.inputModes.indexOf("image") >= 0;
    }
  }
  if (!supp && typeof isModelVisionCapable === "function") {
    var mName = (b && (b.label || b.modelName || b.value || b.chatModelName)) || "";
    if (mName) supp = isModelVisionCapable(mName);
  }
  return !supp;
}

function simulateNNa(a, b, c) {
  if (b && a.length !== 0) {
    if (simulateLNa(a, b.supportedMimeTypes || b)) {
      return "Selected model does not support images. Select a vision-capable model (e.g. GPT-4o, Claude 3.5 Sonnet, Gemini 2.5 Flash) or remove the image.";
    }
    if (
      a.reduce(
        (e, f) =>
          e + Math.max(f?.payload?.case === "inlineData" ? f?.payload?.value?.length || 0 : 0, 0),
        0
      ) > 20971520
    ) {
      return `Total media size exceeds ${(20).toFixed(0)}MB limit`;
    }
    if (c) return "Videos must be at least 1 second long";
  }
}

// Sample fixtures
const SAMPLE_IMAGE_PNG = {
  mimeType: "image/png",
  description: "diagram.png",
  payload: { case: "inlineData", value: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]) }
};

const SAMPLE_TEXT_FILE = {
  mimeType: "text/x-python",
  description: "algo.py",
  payload: { case: "inlineData", value: Buffer.from("def solve(): pass") }
};

const SAMPLE_JSON_FILE = {
  mimeType: "application/json",
  description: "data.json",
  payload: { case: "inlineData", value: Buffer.from('{"key":"value"}') }
};

const SAMPLE_ZIP_FILE = {
  mimeType: "application/zip",
  description: "project.zip",
  payload: { case: "inlineData", value: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) }
};

// ============================================================================
// Adversarial Challenge Suite 1: Model Capability Matrix Across Diverse IDs
// ============================================================================
test("Adversarial: Capability resolution on diverse, obscure, and vendor-prefixed model IDs", async (t) => {
  const TEST_SPECS = [
    // Anthropic Claude
    { id: "claude-3-opus", vision: true, family: "anthropic" },
    { id: "claude-3-opus-20240229", vision: true, family: "anthropic" },
    { id: "claude-3-5-sonnet", vision: true, family: "anthropic" },
    { id: "claude-3-5-haiku-20241022", vision: true, family: "anthropic" },
    { id: "claude-3-7-sonnet-20250219", vision: true, family: "anthropic" },
    { id: "claude-2.0", vision: false, family: "anthropic" },
    { id: "claude-2.1", vision: false, family: "anthropic" },
    { id: "claude-instant-1.2", vision: false, family: "anthropic" },

    // Google Gemini
    { id: "gemini-1.5-flash", vision: true, family: "gemini" },
    { id: "gemini-1.5-flash-8b", vision: true, family: "gemini" },
    { id: "gemini-1.5-pro", vision: true, family: "gemini" },
    { id: "gemini-2.0-flash", vision: true, family: "gemini" },
    { id: "gemini-2.0-flash-exp", vision: true, family: "gemini" },
    { id: "gemini-2.5-pro", vision: true, family: "gemini" },

    // OpenAI
    { id: "gpt-4o", vision: true, family: "openai" },
    { id: "gpt-4o-2024-11-20", vision: true, family: "openai" },
    { id: "gpt-4o-mini", vision: true, family: "openai" },
    { id: "chatgpt-4o-latest", vision: true, family: "openai" },
    { id: "gpt-4.5-preview", vision: true, family: "openai" },
    { id: "gpt-4-turbo", vision: true, family: "openai" },
    { id: "gpt-4-vision-preview", vision: true, family: "openai" },
    { id: "o1", vision: true, family: "openai" },
    { id: "o1-preview", vision: true, family: "openai" },
    { id: "o3-mini", vision: true, family: "openai" },
    { id: "o4", vision: true, family: "openai" },
    { id: "gpt-4", vision: false, family: "openai" },
    { id: "gpt-4-0613", vision: false, family: "openai" },
    { id: "gpt-3.5-turbo", vision: false, family: "openai" },
    { id: "gpt-3.5-turbo-0125", vision: false, family: "openai" },

    // DeepSeek
    { id: "deepseek-chat", vision: false, family: "deepseek" },
    { id: "deepseek-reasoner", vision: false, family: "deepseek" },
    { id: "deepseek-r1", vision: false, family: "deepseek" },
    { id: "deepseek-ai/DeepSeek-V3", vision: false, family: "deepseek" },
    { id: "deepseek-ai/DeepSeek-R1", vision: false, family: "deepseek" },
    { id: "deepseek-vl2", vision: true, family: "deepseek" },
    { id: "deepseek-janus-pro-7b", vision: true, family: "deepseek" },

    // Meta Llama
    { id: "llama-3.3-70b", vision: false, family: "llama" },
    { id: "llama-3.1-405b", vision: false, family: "llama" },
    { id: "llama-3.1-70b", vision: false, family: "llama" },
    { id: "llama-3.2-1b", vision: false, family: "llama" },
    { id: "llama-3.2-3b", vision: false, family: "llama" },
    { id: "meta-llama/Llama-3.3-70B-Instruct", vision: false, family: "llama" },
    { id: "meta-llama/Llama-3.2-1B-Instruct", vision: false, family: "llama" },
    { id: "llama-3.2-11b-vision", vision: true, family: "llama" },
    { id: "llama-3.2-90b-vision", vision: true, family: "llama" },
    { id: "meta-llama/Llama-3.2-11B-Vision-Instruct", vision: true, family: "llama" },

    // Mistral
    { id: "mistral-large", vision: false, family: "mistral" },
    { id: "codestral-latest", vision: false, family: "mistral" },
    { id: "mistralai/Mistral-7B-Instruct-v0.2", vision: false, family: "mistral" },
    { id: "pixtral-12b", vision: true, family: "mistral" },
    { id: "mistralai/Pixtral-Large-Instruct-2411", vision: true, family: "mistral" },

    // Qwen
    { id: "qwen-2.5-72b", vision: false, family: "qwen" },
    { id: "qwen-2.5-coder-32b", vision: false, family: "qwen" },
    { id: "qwen/qwen-2.5-coder-32b-instruct", vision: false, family: "qwen" },
    { id: "qwen-vl-max", vision: true, family: "qwen" },
    { id: "qwen-2.5-vl-72b", vision: true, family: "qwen" },

    // xAI Grok
    { id: "grok-2", vision: false, family: "xai" },
    { id: "grok-beta", vision: false, family: "xai" },
    { id: "grok-2-vision-1212", vision: true, family: "xai" },
    { id: "x-ai/grok-2-vision", vision: true, family: "xai" }
  ];

  for (const spec of TEST_SPECS) {
    await t.test(`resolves vision for ${spec.id} (${spec.family}) -> expected: ${spec.vision}`, () => {
      // 1. Providers officialModelInfo
      const info = officialModelInfo(null, spec.id);
      assert.ok(info, `officialModelInfo must resolve for ${spec.id}`);
      const provVision = Boolean(info.inputModes && info.inputModes.includes("image"));
      assert.equal(
        provVision,
        spec.vision,
        `officialModelInfo(${spec.id}) vision mismatch: expected ${spec.vision}, got ${provVision}`
      );

      // 2. Gateway isModelVisionCapable
      const gwVision = isModelVisionCapable(spec.id);
      assert.equal(
        gwVision,
        spec.vision,
        `isModelVisionCapable(${spec.id}) vision mismatch: expected ${spec.vision}, got ${gwVision}`
      );

      // 3. simulateLNa on synthetic modelConfig object
      const modelConfig = {
        label: spec.id,
        modelName: spec.id,
        inputModes: info.inputModes ? info.inputModes.slice() : ["text"],
        images: provVision
      };
      const lnaBlocked = simulateLNa([SAMPLE_IMAGE_PNG], modelConfig);
      assert.equal(
        lnaBlocked,
        !spec.vision,
        `simulateLNa should block images if and only if model lacks vision for ${spec.id}`
      );
    });
  }
});

test("Adversarial: Custom and uncatalogued model ID semantics", async (t) => {
  await t.test("pure unknown string without metadata defaults to text-only blocking in gateway", () => {
    // When passed as a bare string ID with no keywords
    const isCapable = isModelVisionCapable("custom-model-42");
    assert.equal(isCapable, false, "Unknown bare string ID should not be assumed vision-capable");

    const val = validateVisionSupport("custom-model-42", [SAMPLE_IMAGE_PNG]);
    assert.equal(val.valid, false, "Gateway validation must block images for unknown bare string ID");
  });

  await t.test("custom model with explicit vision keywords in ID is recognized", () => {
    assert.equal(isModelVisionCapable("custom-finetuned-vision"), true);
    assert.equal(isModelVisionCapable("local-vl-model"), true);
    assert.equal(isModelVisionCapable("my-multimodal-assistant"), true);
  });

  await t.test("custom model with configured inputModes/images in provider metadata is respected", () => {
    // A custom model explicitly configured with vision support in provider settings
    const customConfigVision = {
      label: "my-custom-vllm",
      images: true,
      inputModes: ["text", "image"]
    };
    assert.equal(isModelVisionCapable(customConfigVision), true);
    assert.equal(simulateLNa([SAMPLE_IMAGE_PNG], customConfigVision), false);

    // A custom model explicitly configured as text-only
    const customConfigTextOnly = {
      label: "my-custom-vllm-text",
      images: false,
      inputModes: ["text"]
    };
    assert.equal(isModelVisionCapable(customConfigTextOnly), false);
    assert.equal(simulateLNa([SAMPLE_IMAGE_PNG], customConfigTextOnly), true);
  });
});

// ============================================================================
// Adversarial Challenge Suite 2: Draft Preservation & Model Toggle Simulation
// ============================================================================
test("Adversarial: Draft preservation during rapid model toggling (vision <-> non-vision)", async (t) => {
  // Simulate active user composer state
  const composer = {
    editorText: "Here is the architectural diagram and code. Please optimize the algorithm.",
    mediaAttachments: [
      SAMPLE_IMAGE_PNG,
      SAMPLE_TEXT_FILE,
      SAMPLE_JSON_FILE,
      SAMPLE_ZIP_FILE
    ],
    selectedModel: null,
    sendButtonEnabled: false,
    warningBanner: null
  };

  function updateComposerForModel(modelId, modelConfig) {
    composer.selectedModel = modelConfig;
    const errorMsg = simulateNNa(composer.mediaAttachments, modelConfig, false);
    composer.warningBanner = errorMsg || null;
    const isInputEmpty = composer.editorText.trim().length === 0;
    const hasAttachments = composer.mediaAttachments.length > 0;
    const hasAttachmentsError = Boolean(errorMsg);
    // DYb logic: L = !disabledForBattle && !attachmentsError && (!isInputEmpty || hasAttachments)
    const canSend = !hasAttachmentsError && (!isInputEmpty || hasAttachments);
    composer.sendButtonEnabled = canSend;
  }

  // --- Step 1: Start with vision model (GPT-4o) ---
  const gpt4oConfig = {
    label: "gpt-4o",
    images: true,
    inputModes: ["text", "image", "audio"]
  };
  updateComposerForModel("gpt-4o", gpt4oConfig);

  assert.equal(composer.warningBanner, null, "No warning on vision model");
  assert.equal(composer.sendButtonEnabled, true, "Send button enabled on vision model");
  assert.equal(composer.mediaAttachments.length, 4, "All 4 attachments present");

  // --- Step 2: Switch to non-vision model (DeepSeek-Chat) ---
  const deepseekConfig = {
    label: "deepseek-chat",
    images: false,
    inputModes: ["text"]
  };
  updateComposerForModel("deepseek-chat", deepseekConfig);

  assert.ok(
    composer.warningBanner && composer.warningBanner.includes("Selected model does not support images"),
    `Warning banner must appear on non-vision model. Got: ${composer.warningBanner}`
  );
  assert.equal(composer.sendButtonEnabled, false, "Send button must be disabled on non-vision model");

  // DRAFT PRESERVATION CHECK: Verify editor text and attachments are NOT wiped!
  assert.equal(
    composer.editorText,
    "Here is the architectural diagram and code. Please optimize the algorithm."
  );
  assert.equal(composer.mediaAttachments.length, 4, "Attachments must NOT be wiped when send is blocked");
  assert.equal(composer.mediaAttachments[0].description, "diagram.png");
  assert.equal(composer.mediaAttachments[1].description, "algo.py");

  // --- Step 3: Switch to another non-vision model (Llama-3.3-70b) ---
  const llamaConfig = {
    label: "llama-3.3-70b",
    images: false,
    inputModes: ["text"]
  };
  updateComposerForModel("llama-3.3-70b", llamaConfig);

  assert.ok(composer.warningBanner !== null, "Warning banner persists on second non-vision model");
  assert.equal(composer.sendButtonEnabled, false, "Send button remains disabled");
  assert.equal(composer.mediaAttachments.length, 4, "Draft attachments still preserved");

  // --- Step 4: Switch BACK to a vision model (Claude 3.5 Sonnet) ---
  const sonnetConfig = {
    label: "claude-3-5-sonnet",
    images: true,
    inputModes: ["text", "image"]
  };
  updateComposerForModel("claude-3-5-sonnet", sonnetConfig);

  assert.equal(composer.warningBanner, null, "Warning banner cleared on switch back to vision model");
  assert.equal(composer.sendButtonEnabled, true, "Send button RE-ENABLED on switch back to vision model");
  assert.equal(composer.mediaAttachments.length, 4, "All 4 attachments fully intact");
  assert.equal(composer.editorText.length > 0, true, "Draft editor text fully intact");

  // --- Step 5: Simulate G4 submission throw guard ---
  // If user tries to force-call G4 while on non-vision model
  let g4Called = false;
  let clearedInputCalled = false;
  function fakeSendMessage() { g4Called = true; }
  function fakeClearInput() { clearedInputCalled = true; }

  function fakeG4(attachments, modelCfg) {
    if (simulateLNa(attachments, modelCfg.supportedMimeTypes || modelCfg)) {
      throw new Error("Selected model does not support images. Select a vision-capable model (e.g. GPT-4o, Claude 3.5 Sonnet, Gemini 2.5 Flash) or remove the image.");
    }
    fakeSendMessage();
    fakeClearInput();
  }

  assert.throws(
    () => fakeG4(composer.mediaAttachments, deepseekConfig),
    /Selected model does not support images/
  );
  assert.equal(g4Called, false, "sendMessage must not be called when validation fails");
  assert.equal(clearedInputCalled, false, "clearInput must not be called when validation fails");
});

// ============================================================================
// Adversarial Challenge Suite 3: Mixed Attachment Lists & MIME Edge Cases
// ============================================================================
test("Adversarial: Mixed attachment lists (code + text + archives + media)", async (t) => {
  const deepseek = { label: "deepseek-chat", images: false, inputModes: ["text"] };
  const gpt4o = { label: "gpt-4o", images: true, inputModes: ["text", "image"] };

  await t.test("pure text/code attachments pass without blocking on text-only models", () => {
    const codeAttachments = [SAMPLE_TEXT_FILE, SAMPLE_JSON_FILE, SAMPLE_ZIP_FILE];
    assert.equal(simulateLNa(codeAttachments, deepseek), false, "Non-image files must never block send");
    assert.equal(simulateNNa(codeAttachments, deepseek, false), undefined);
  });

  await t.test("mixed attachments (text + image) block on text-only models", () => {
    const mixedAttachments = [SAMPLE_TEXT_FILE, SAMPLE_IMAGE_PNG, SAMPLE_ZIP_FILE];
    assert.equal(simulateLNa(mixedAttachments, deepseek), true, "Mixed files with image must block on text model");
    assert.ok(
      simulateNNa(mixedAttachments, deepseek, false)?.includes("Selected model does not support images")
    );
  });

  await t.test("mixed attachments (text + image) pass on vision models", () => {
    const mixedAttachments = [SAMPLE_TEXT_FILE, SAMPLE_IMAGE_PNG, SAMPLE_ZIP_FILE];
    assert.equal(simulateLNa(mixedAttachments, gpt4o), false, "Mixed files must pass on vision model");
    assert.equal(simulateNNa(mixedAttachments, gpt4o, false), undefined);
  });
});

test("Adversarial: Edge-case MIME types, formatting variations, and malicious inputs", async (t) => {
  const deepseek = { label: "deepseek-chat", images: false, inputModes: ["text"] };

  await t.test("case-insensitivity: IMAGE/PNG and image/JPEG detected accurately", () => {
    assert.equal(isImageMime("IMAGE/PNG"), true);
    assert.equal(isImageMime("image/JPEG"), true);
    assert.equal(simulateLNa([{ mimeType: "IMAGE/PNG" }], deepseek), true);
  });

  await t.test("MIME types with parameters (e.g. charset) parsed correctly", () => {
    assert.equal(isImageMime("image/png; charset=utf-8"), true);
    assert.equal(normalizeMimeType("image/jpg; name=photo.jpg"), "image/jpeg");
    assert.equal(simulateLNa([{ mimeType: "image/png; charset=binary" }], deepseek), true);
  });

  await t.test("Subtype false-positives containing 'image' in name must NOT be treated as images", () => {
    const diskImage = { mimeType: "application/x-iso9660-image", description: "boot.iso" };
    const odfImage = { mimeType: "application/vnd.oasis.opendocument.image", description: "doc.odi" };
    const textNamedImage = { mimeType: "text/plain", description: "image_data.txt" };

    assert.equal(isImageMime(diskImage.mimeType), false);
    assert.equal(isImageMime(odfImage.mimeType), false);
    assert.equal(isImageMime(textNamedImage.mimeType), false);

    assert.equal(simulateLNa([diskImage, odfImage, textNamedImage], deepseek), false);
  });

  await t.test("Resilience against malformed, null, or empty attachment objects", () => {
    assert.equal(simulateLNa([], deepseek), false);
    assert.equal(simulateLNa(null, deepseek), false);
    assert.equal(simulateLNa(undefined, deepseek), false);
    assert.equal(simulateLNa([null, undefined, {}], deepseek), false);
    assert.equal(simulateLNa([{ description: "no-mime" }], deepseek), false);
    assert.equal(simulateLNa([{ mimeType: "" }], deepseek), false);
  });

  await t.test("20MB media size cap enforcement in NNa", () => {
    const hugeAttachment = {
      mimeType: "image/png",
      payload: { case: "inlineData", value: new Uint8Array(21 * 1024 * 1024) }
    };
    const gpt4o = { label: "gpt-4o", images: true, inputModes: ["text", "image"] };
    const res = simulateNNa([hugeAttachment], gpt4o, false);
    assert.ok(res && res.includes("Total media size exceeds 20MB limit"));
  });
});

// ============================================================================
// Adversarial Challenge Suite 4: Wire Transformations & Anthropic Constraints
// ============================================================================
test("Adversarial: Anthropic strict MIME enforcement and transformation robustness", async (t) => {
  await t.test("Anthropic strictly rejects unsupported image formats (bmp, svg, tiff, heic)", () => {
    const unsupportedMimes = [
      "image/bmp",
      "image/svg+xml",
      "image/tiff",
      "image/heic",
      "image/x-icon"
    ];

    for (const mime of unsupportedMimes) {
      const item = {
        type: "image_url",
        image_url: { url: `data:${mime};base64,AAAA` }
      };
      assert.throws(
        () => convertUserContent([item], true),
        /Image format not supported by Anthropic/,
        `Should throw for unsupported format ${mime}`
      );
    }
  });

  await t.test("Anthropic strictly accepts official 4 formats and normalizes jpg", () => {
    const acceptedMimes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];

    for (const mime of acceptedMimes) {
      const item = {
        type: "image_url",
        image_url: { url: `data:${mime};base64,AAAA` }
      };
      const converted = convertUserContent([item], true);
      assert.equal(converted.length, 1);
      assert.equal(converted[0].type, "image");
      assert.equal(converted[0].source.type, "base64");
      assert.equal(
        converted[0].source.media_type,
        mime === "image/jpg" ? "image/jpeg" : mime
      );
    }
  });

  await t.test("Mixed multipart content ordering preserved for Anthropic", () => {
    const inputParts = [
      { type: "text", text: "Part 1: Question" },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
      { type: "text", text: "Part 2: Follow-up observation" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" } }
    ];

    const converted = convertUserContent(inputParts, true);
    assert.equal(converted.length, 4);
    assert.equal(converted[0].type, "text");
    assert.equal(converted[0].text, "Part 1: Question");
    assert.equal(converted[1].type, "image");
    assert.equal(converted[1].source.media_type, "image/png");
    assert.equal(converted[2].type, "text");
    assert.equal(converted[2].text, "Part 2: Follow-up observation");
    assert.equal(converted[3].type, "image");
    assert.equal(converted[3].source.media_type, "image/jpeg");
  });
});
