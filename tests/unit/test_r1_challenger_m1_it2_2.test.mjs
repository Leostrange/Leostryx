import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

const gatewayPath = path.join(REPO_ROOT, "app/assets/web/agy_gateway.js");
const mainJsPath = path.join(REPO_ROOT, "app/assets/web/generated/main.js");

const {
  isModelVisionCapable,
  validateVisionSupport,
  isImageMime,
  maskMediaInLogs
} = await import("file://" + gatewayPath).then((m) => m.default || m);

// Extract real LNa from main.js directly
const mainJsContent = fs.readFileSync(mainJsPath, "utf-8");
const lnaMatch = mainJsContent.match(/function LNa\(a,b\)\{[\s\S]*?return!supp\}/);
assert.ok(lnaMatch, "function LNa must be found in main.js");

// Extract real NNa from main.js directly
const nnaMatch = mainJsContent.match(
  /function NNa\(a,b,c\)\{[\s\S]*?return"Videos must be at least 1 second long"\}\}/
);
assert.ok(nnaMatch, "function NNa must be found in main.js");

// Evaluate in isolated scope with window.AgyGateway bound
const mockWindow = {
  AgyGateway: { isModelVisionCapable },
  AgyModelCatalog: null
};

const evalLNa = new Function("window", lnaMatch[0] + "; return LNa;");
const LNa = evalLNa(mockWindow);

// Construct NNa evaluator bound to real LNa and AB weakmap
const evalNNa = new Function(
  "LNa",
  "AB",
  nnaMatch[0] + "; return NNa;"
);
const NNa = evalNNa(LNa, new WeakMap());

// Helper: Simulate Send button state from DYb in main.js:11381
function simulateSendButtonDisabled({ attachments, currentModelConfig, isInputEmpty = false }) {
  const attachmentsError = NNa(attachments, currentModelConfig, false);
  const k = attachmentsError;
  const hasAttachments = attachments && attachments.length > 0;
  const hasContent = !isInputEmpty || hasAttachments;
  const isSendActive = !k && hasContent;
  return {
    disabled: !isSendActive,
    attachmentsError: k || null,
    cursorClass: isSendActive ? "cursor-pointer" : "cursor-not-allowed",
    buttonClass: isSendActive ? "bg-primary text-primary-foreground" : "text-muted-foreground bg-secondary"
  };
}

// Sample test fixtures
const PNG_IMAGE = [{ mimeType: "image/png", payload: { case: "inlineData", value: new Uint8Array([1, 2, 3]) } }];

// Helper for testing a list of models
function testModels(t, models) {
  for (const item of models) {
    const isCapable = isModelVisionCapable(item.id);
    const lnaBlocked = LNa(PNG_IMAGE, item.id);
    const validation = validateVisionSupport(item.id, PNG_IMAGE);

    assert.equal(
      isCapable,
      item.vision,
      `isModelVisionCapable("${item.id}") must be ${item.vision}`
    );
    assert.equal(
      lnaBlocked,
      !item.vision,
      `LNa(PNG, "${item.id}") must return ${!item.vision} (blocked=${!item.vision})`
    );
    assert.equal(
      validation.valid,
      item.vision,
      `validateVisionSupport("${item.id}") must return valid=${item.vision}`
    );
  }
}

// ============================================================================
// Test Suite 1: Model Vision Resolution across Providers & String IDs
// ============================================================================
test("Suite 1: Empirical Model Vision Resolution across 8+ Providers & String ID Patterns", async (t) => {
  await t.test("OpenAI model IDs (vision vs non-vision, versioned & vendor-prefixed)", (st) => {
    testModels(st, [
      { id: "gpt-4o", vision: true },
      { id: "gpt-4o-mini", vision: true },
      { id: "gpt-4o-2024-08-06", vision: true },
      { id: "gpt-4o-2024-11-20", vision: true },
      { id: "chatgpt-4o-latest", vision: true },
      { id: "o1", vision: true },
      { id: "o1-2024-12-17", vision: true },
      { id: "o1-mini", vision: true },
      { id: "o1-mini-2024-09-12", vision: true },
      { id: "o1-preview", vision: true },
      { id: "o3", vision: true },
      { id: "o3-mini", vision: true },
      { id: "o3-mini-2025-01-31", vision: true },
      { id: "o4", vision: true },
      { id: "o4-mini", vision: true },
      { id: "o5", vision: true },
      { id: "gpt-4.5-preview", vision: true },
      { id: "gpt-4.5-preview-2025-02-27", vision: true },
      { id: "gpt-4-turbo", vision: true },
      { id: "gpt-4-turbo-2024-04-09", vision: true },
      { id: "gpt-4-turbo-preview", vision: true },
      { id: "openai/gpt-4o", vision: true },
      { id: "azure/gpt-4o", vision: true },
      { id: "azure.openai/o1-mini", vision: true },
      { id: "gpt-4", vision: false },
      { id: "gpt-4-0613", vision: false },
      { id: "gpt-4-32k", vision: false },
      { id: "gpt-3.5-turbo", vision: false },
      { id: "gpt-3.5-turbo-0125", vision: false },
      { id: "gpt-3.5-turbo-16k", vision: false },
      { id: "text-davinci-003", vision: false },
      { id: "openai/gpt-3.5-turbo", vision: false }
    ]);
  });

  await t.test("Anthropic Claude model IDs (Claude 3/3.5/3.7 vision vs Claude 2 text)", (st) => {
    testModels(st, [
      { id: "claude-3-5-sonnet-20241022", vision: true },
      { id: "claude-3-5-sonnet-latest", vision: true },
      { id: "claude-3-5-haiku-20241022", vision: true },
      { id: "claude-3-opus-20240229", vision: true },
      { id: "claude-3-sonnet-20240229", vision: true },
      { id: "claude-3-haiku-20240307", vision: true },
      { id: "claude-3-7-sonnet", vision: true },
      { id: "claude-3-7-sonnet-20250219", vision: true },
      { id: "anthropic/claude-3-5-sonnet", vision: true },
      { id: "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0", vision: true },
      { id: "vertex_ai/claude-3-5-sonnet@20241022", vision: true },
      { id: "claude-2.0", vision: false },
      { id: "claude-2.1", vision: false },
      { id: "claude-instant-1.2", vision: false },
      { id: "anthropic/claude-2.1", vision: false }
    ]);
  });

  await t.test("Google Gemini model IDs (all Gemini family models support vision)", (st) => {
    testModels(st, [
      { id: "gemini-1.5-pro", vision: true },
      { id: "gemini-1.5-flash", vision: true },
      { id: "gemini-1.5-flash-8b", vision: true },
      { id: "gemini-2.0-flash", vision: true },
      { id: "gemini-2.0-flash-lite", vision: true },
      { id: "gemini-2.0-pro-exp-02-05", vision: true },
      { id: "gemini-2.5-flash", vision: true },
      { id: "gemini-exp-1206", vision: true },
      { id: "google/gemini-1.5-pro-latest", vision: true },
      { id: "vertex/gemini-1.5-flash", vision: true }
    ]);
  });

  await t.test("DeepSeek model IDs (deepseek-vl, deepseek-chat, deepseek-reasoner)", (st) => {
    testModels(st, [
      { id: "deepseek-vl-7b-chat", vision: true },
      { id: "deepseek-vl-67b-chat", vision: true },
      { id: "deepseek-vl2", vision: true },
      { id: "deepseek-vl2-tiny", vision: true },
      { id: "deepseek-janus-pro-7b", vision: true },
      { id: "deepseek-ai/deepseek-vl-67b-chat", vision: true },
      { id: "deepseek-chat", vision: false },
      { id: "deepseek-reasoner", vision: false },
      { id: "deepseek-v3", vision: false },
      { id: "deepseek-r1", vision: false },
      { id: "deepseek-ai/DeepSeek-V3", vision: false },
      { id: "deepseek-ai/DeepSeek-R1", vision: false }
    ]);
  });

  // CHALLENGER FINDING 1: DeepSeek Janus model with canonical vendor prefix deepseek-ai/Janus-Pro-7B
  await t.test("CHALLENGE FINDING 1: DeepSeek Janus with canonical vendor prefix deepseek-ai/Janus-Pro-7B", (st) => {
    const canonicalId = "deepseek-ai/Janus-Pro-7B";
    const isCapable = isModelVisionCapable(canonicalId);
    // Janus-Pro-7B is DeepSeek's multimodal model. In agy_gateway.js:644, pureId is "janus-pro-7b"
    // which fails pureId.indexOf("deepseek") >= 0, falsely returning false!
    assert.equal(
      isCapable,
      true,
      `BUG CONFIRMED: isModelVisionCapable("${canonicalId}") falsely returns false because pureId lost "deepseek"`
    );
  });

  await t.test("Meta Llama model IDs (Llama 3.2 11B/90B Vision vs 3.1/3.3 text)", (st) => {
    testModels(st, [
      { id: "llama-3.2-11b-vision-instruct", vision: true },
      { id: "llama-3.2-90b-vision-instruct", vision: true },
      { id: "meta-llama/Llama-3.2-11B-Vision", vision: true },
      { id: "meta-llama/Llama-3.2-90B-Vision-Instruct", vision: true },
      { id: "llama-3.2-11b", vision: true },
      { id: "llama-3.2-90b", vision: true },
      { id: "llama-3.1-8b-instruct", vision: false },
      { id: "llama-3.1-70b-instruct", vision: false },
      { id: "llama-3.1-405b-instruct", vision: false },
      { id: "llama-3.3-70b-instruct", vision: false },
      { id: "llama-3.2-1b-instruct", vision: false },
      { id: "llama-3.2-3b-instruct", vision: false },
      { id: "meta-llama/Meta-Llama-3.1-70B-Instruct", vision: false }
    ]);
  });

  await t.test("Mistral model IDs (Pixtral vs Mistral Large text / Codestral)", (st) => {
    testModels(st, [
      { id: "pixtral-12b-2409", vision: true },
      { id: "pixtral-large-2411", vision: true },
      { id: "mistralai/Pixtral-12B-2409", vision: true },
      { id: "mistral-large-vision", vision: true },
      { id: "mistral-large-2411", vision: false },
      { id: "mistral-medium-2312", vision: false },
      { id: "mistral-small-2409", vision: false },
      { id: "codestral-2501", vision: false },
      { id: "ministral-8b-2410", vision: false },
      { id: "mistralai/Mistral-7B-Instruct-v0.3", vision: false }
    ]);
  });

  await t.test("Qwen model IDs (Qwen-VL vs Qwen text / QwQ)", (st) => {
    testModels(st, [
      { id: "qwen2-vl-7b-instruct", vision: true },
      { id: "qwen2-vl-72b-instruct", vision: true },
      { id: "qwen2.5-vl-7b-instruct", vision: true },
      { id: "qwen2.5-vl-72b-instruct", vision: true },
      { id: "qwen-vl-plus", vision: true },
      { id: "qwen-vl-max", vision: true },
      { id: "Qwen/Qwen2-VL-7B-Instruct", vision: true },
      { id: "qwen2.5-7b-instruct", vision: false },
      { id: "qwen2.5-14b-instruct", vision: false },
      { id: "qwen2.5-72b-instruct", vision: false },
      { id: "qwen2.5-coder-32b-instruct", vision: false },
      { id: "qwq-32b", vision: false },
      { id: "Qwen/Qwen2.5-72B-Instruct", vision: false }
    ]);
  });

  await t.test("Xiaomi MiMo model IDs (MiMo v2.6 Pro/Flash and vendor prefixed)", (st) => {
    testModels(st, [
      { id: "mimo-v2.6-pro", vision: true },
      { id: "mimo-v2.6-flash", vision: true },
      { id: "xiaomi/mimo-v2", vision: true },
      { id: "xiaomi-mimo-pro", vision: true },
      { id: "mimo-v2", vision: true }
    ]);
  });

  await t.test("Other providers: Kimi, MiniMax, custom vision keywords, and non-vision models", (st) => {
    testModels(st, [
      { id: "kimi-latest", vision: true },
      { id: "moonshot-v1-auto", vision: true },
      { id: "minimax-text-01", vision: true },
      { id: "hailuo-01", vision: true },
      { id: "custom-vision-agent-v1", vision: true },
      { id: "my-model-4v", vision: true },
      { id: "agent-multimodal-beta", vision: true },
      { id: "command-r-plus", vision: false },
      { id: "gemma-2-9b-it", vision: false },
      { id: "phi-3-mini-4k-instruct", vision: false }
    ]);
  });
});

// ============================================================================
// Test Suite 2: Config Object Formats Across Providers
// ============================================================================
test("Suite 2: Config Object Formats & Priority Properties Resolution", async (t) => {
  await t.test("resolves object with .id property", () => {
    assert.equal(LNa(PNG_IMAGE, { id: "gpt-4o" }), false);
    assert.equal(LNa(PNG_IMAGE, { id: "deepseek-chat" }), true);
    assert.equal(isModelVisionCapable({ id: "claude-3-5-sonnet" }), true);
    assert.equal(isModelVisionCapable({ id: "llama-3.1-70b" }), false);
  });

  await t.test("resolves object with .model property", () => {
    assert.equal(LNa(PNG_IMAGE, { model: "claude-3-5-sonnet" }), false);
    assert.equal(LNa(PNG_IMAGE, { model: "claude-2.1" }), true);
    assert.equal(isModelVisionCapable({ model: "gemini-1.5-pro" }), true);
    assert.equal(isModelVisionCapable({ model: "gpt-3.5-turbo" }), false);
  });

  await t.test("resolves object with .name property", () => {
    assert.equal(LNa(PNG_IMAGE, { name: "gemini-2.0-flash" }), false);
    assert.equal(LNa(PNG_IMAGE, { name: "deepseek-r1" }), true);
    assert.equal(isModelVisionCapable({ name: "mimo-v2.6-pro" }), true);
    assert.equal(isModelVisionCapable({ name: "codestral-2501" }), false);
  });

  await t.test("resolves object with .value property", () => {
    assert.equal(LNa(PNG_IMAGE, { value: "mimo-v2.6-pro" }), false);
    assert.equal(LNa(PNG_IMAGE, { value: "llama-3.1-8b" }), true);
    assert.equal(isModelVisionCapable({ value: "pixtral-12b-2409" }), true);
    assert.equal(isModelVisionCapable({ value: "mistral-large-2411" }), false);
  });

  await t.test("resolves object with .label and .id combined", () => {
    const config = { label: "Llama 3.2 11B Vision Instruct", id: "llama-3.2-11b-vision-instruct" };
    assert.equal(LNa(PNG_IMAGE, config), false);
    assert.equal(isModelVisionCapable(config), true);

    const nonVisionConfig = { label: "Llama 3.1 70B Instruct", id: "llama-3.1-70b-instruct" };
    assert.equal(LNa(PNG_IMAGE, nonVisionConfig), true);
    assert.equal(isModelVisionCapable(nonVisionConfig), false);
  });

  await t.test("resolves object with .modelName and .chatModelName", () => {
    assert.equal(LNa(PNG_IMAGE, { modelName: "pixtral-large-2411" }), false);
    assert.equal(LNa(PNG_IMAGE, { modelName: "mistral-small-2409" }), true);
    assert.equal(LNa(PNG_IMAGE, { chatModelName: "qwen2.5-vl-72b-instruct" }), false);
    assert.equal(LNa(PNG_IMAGE, { chatModelName: "qwen2.5-72b-instruct" }), true);
  });

  await t.test("resolves object with explicit inputModes array", () => {
    assert.equal(LNa(PNG_IMAGE, { inputModes: ["text", "image"] }), false);
    assert.equal(LNa(PNG_IMAGE, { inputModes: ["text"] }), true);
    assert.equal(isModelVisionCapable({ inputModes: ["text", "image"] }), true);
    assert.equal(isModelVisionCapable({ inputModes: ["text"] }), false);
  });

  await t.test("resolves object with boolean images flag", () => {
    assert.equal(isModelVisionCapable({ images: true }), true);
    assert.equal(isModelVisionCapable({ images: false }), false);
  });

  await t.test("resolves object with modelFeatures.supportsImages flag", () => {
    assert.equal(isModelVisionCapable({ modelFeatures: { supportsImages: true } }), true);
    assert.equal(isModelVisionCapable({ modelFeatures: { supportsImages: false } }), false);
  });

  await t.test("resolves object with supportedMimeTypes Map", () => {
    const mapWithImg = new Map([["image/png", true]]);
    assert.equal(LNa(PNG_IMAGE, { supportedMimeTypes: mapWithImg }), false);
    assert.equal(isModelVisionCapable({ supportedMimeTypes: mapWithImg }), true);

    const emptyMap = new Map();
    assert.equal(LNa(PNG_IMAGE, { supportedMimeTypes: emptyMap, id: "gpt-4o" }), false);
    assert.equal(LNa(PNG_IMAGE, { supportedMimeTypes: emptyMap, id: "gpt-3.5-turbo" }), true);
  });

  // CHALLENGER FINDING 2: Explicit capability override bypass in main.js:3444 (LNa)
  await t.test("CHALLENGE FINDING 2: Explicit capability disable bypass in main.js:3444 LNa", () => {
    const disabledGpt4o = { id: "gpt-4o", images: false };
    // isModelVisionCapable correctly respects images: false -> returns false
    assert.equal(
      isModelVisionCapable(disabledGpt4o),
      false,
      "isModelVisionCapable correctly returns false when images: false"
    );

    // However, LNa evaluates `isModelVisionCapable(b) || isModelVisionCapable(mName)`
    // which queries "gpt-4o" and overrides images: false back to true!
    const lnaResult = LNa(PNG_IMAGE, disabledGpt4o);
    assert.equal(
      lnaResult,
      true,
      `BUG CONFIRMED: LNa returned ${lnaResult} (unblocked) instead of true (blocked) because it overrides images: false with string lookup`
    );
  });
});

// ============================================================================
// Test Suite 3: Draft Retention & Send Button Re-enabling Across Model Toggling
// ============================================================================
test("Suite 3: Interactive Draft Retention & Send Button Re-enabling Across Model Toggling", async (t) => {
  const state = {
    editorText: "Here is an architecture diagram of Aether integration",
    attachments: [
      {
        mimeType: "image/png",
        description: "arch_diagram.png",
        payload: { case: "inlineData", value: new Uint8Array([10, 20, 30]) }
      }
    ],
    currentModel: null,
    sentMessages: []
  };

  function attemptSend() {
    const model = state.currentModel;
    if (!model) throw new Error("Select a model to send message");

    if (LNa(state.attachments, model.supportedMimeTypes || model)) {
      throw new Error(
        "Selected model does not support images. Select a vision-capable model (e.g. GPT-4o, Claude 3.5 Sonnet, Gemini 2.5 Flash) or remove the image."
      );
    }

    const payload = { text: state.editorText, media: [...state.attachments] };
    state.sentMessages.push(payload);
    state.attachments = [];
    state.editorText = "";
    return payload;
  }

  assert.equal(state.attachments.length, 1);
  assert.equal(state.editorText.length > 0, true);

  // Step 1: User selects non-vision model (gpt-3.5-turbo)
  state.currentModel = "gpt-3.5-turbo";
  let btn = simulateSendButtonDisabled({
    attachments: state.attachments,
    currentModelConfig: state.currentModel,
    isInputEmpty: false
  });
  assert.equal(btn.disabled, true, "Send button must be disabled for gpt-3.5-turbo with image");
  assert.equal(btn.cursorClass, "cursor-not-allowed");
  assert.ok(btn.attachmentsError?.includes("Selected model does not support images"));
  assert.throws(() => attemptSend(), /Selected model does not support images/);
  assert.equal(state.attachments.length, 1, "Media attachment must survive blocked send");
  assert.equal(state.editorText, "Here is an architecture diagram of Aether integration");

  // Step 2: User toggles to vision model (gpt-4o)
  state.currentModel = "gpt-4o";
  btn = simulateSendButtonDisabled({
    attachments: state.attachments,
    currentModelConfig: state.currentModel,
    isInputEmpty: false
  });
  assert.equal(btn.disabled, false, "Send button must be RE-ENABLED for gpt-4o");
  assert.equal(btn.cursorClass, "cursor-pointer");
  assert.equal(btn.attachmentsError, null);
  assert.equal(state.attachments.length, 1);

  // Step 3: User toggles to another non-vision model (deepseek-chat)
  state.currentModel = "deepseek-chat";
  btn = simulateSendButtonDisabled({
    attachments: state.attachments,
    currentModelConfig: state.currentModel,
    isInputEmpty: false
  });
  assert.equal(btn.disabled, true, "Send button must be re-disabled for deepseek-chat");
  assert.equal(btn.cursorClass, "cursor-not-allowed");
  assert.throws(() => attemptSend(), /Selected model does not support images/);
  assert.equal(state.attachments.length, 1, "Draft attachments still retained");

  // Step 4: User toggles to Claude 3.5 Sonnet object config
  state.currentModel = { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" };
  btn = simulateSendButtonDisabled({
    attachments: state.attachments,
    currentModelConfig: state.currentModel,
    isInputEmpty: false
  });
  assert.equal(btn.disabled, false, "Send button must be RE-ENABLED for Claude 3.5 Sonnet");
  assert.equal(btn.cursorClass, "cursor-pointer");
  assert.equal(btn.attachmentsError, null);

  // Step 5: User toggles to Llama 3.1 70B object config (non-vision)
  state.currentModel = { model: "llama-3.1-70b-instruct" };
  btn = simulateSendButtonDisabled({
    attachments: state.attachments,
    currentModelConfig: state.currentModel,
    isInputEmpty: false
  });
  assert.equal(btn.disabled, true, "Send button must be re-disabled for Llama 3.1 70B");
  assert.throws(() => attemptSend(), /Selected model does not support images/);
  assert.equal(state.attachments.length, 1);

  // Step 6: User toggles to Llama 3.2 11B Vision object config
  state.currentModel = { model: "llama-3.2-11b-vision-instruct" };
  btn = simulateSendButtonDisabled({
    attachments: state.attachments,
    currentModelConfig: state.currentModel,
    isInputEmpty: false
  });
  assert.equal(btn.disabled, false, "Send button must be RE-ENABLED for Llama 3.2 11B Vision");
  assert.equal(btn.cursorClass, "cursor-pointer");

  // Step 7: User toggles to Xiaomi MiMo string ID
  state.currentModel = "mimo-v2.6-pro";
  btn = simulateSendButtonDisabled({
    attachments: state.attachments,
    currentModelConfig: state.currentModel,
    isInputEmpty: false
  });
  assert.equal(btn.disabled, false, "Send button must be RE-ENABLED for Xiaomi MiMo");
  assert.equal(btn.cursorClass, "cursor-pointer");

  // Step 8: User toggles to Qwen non-vision
  state.currentModel = { name: "qwen2.5-coder-32b-instruct" };
  btn = simulateSendButtonDisabled({
    attachments: state.attachments,
    currentModelConfig: state.currentModel,
    isInputEmpty: false
  });
  assert.equal(btn.disabled, true, "Send button must be re-disabled for Qwen Coder");

  // Step 9: User toggles to Qwen 2.5 VL
  state.currentModel = { name: "qwen2.5-vl-72b-instruct" };
  btn = simulateSendButtonDisabled({
    attachments: state.attachments,
    currentModelConfig: state.currentModel,
    isInputEmpty: false
  });
  assert.equal(btn.disabled, false, "Send button must be RE-ENABLED for Qwen 2.5 VL");

  // Step 10: Successful send execution
  const sent = attemptSend();
  assert.equal(sent.text, "Here is an architecture diagram of Aether integration");
  assert.equal(sent.media.length, 1);
  assert.equal(state.sentMessages.length, 1);
  assert.equal(state.attachments.length, 0);
  assert.equal(state.editorText, "");
});

// ============================================================================
// Test Suite 4: Non-Image Files Are NEVER Blocked
// ============================================================================
test("Suite 4: Non-Image Files (.py, .ts, .zip, .md, .pdf, .json, .csv) Are NEVER Blocked", async (t) => {
  const nonImageFiles = [
    { name: "script.py", mimeType: "text/x-python" },
    { name: "module.ts", mimeType: "text/typescript" },
    { name: "app.js", mimeType: "text/javascript" },
    { name: "archive.zip", mimeType: "application/zip" },
    { name: "bundle.tar.gz", mimeType: "application/gzip" },
    { name: "notes.md", mimeType: "text/markdown" },
    { name: "config.json", mimeType: "application/json" },
    { name: "spec.pdf", mimeType: "application/pdf" },
    { name: "dataset.csv", mimeType: "text/csv" },
    { name: "log.txt", mimeType: "text/plain" },
    { name: "index.html", mimeType: "text/html" },
    { name: "binary.bin", mimeType: "application/octet-stream" }
  ];

  const nonVisionModels = [
    "gpt-4",
    "gpt-3.5-turbo",
    "claude-2.1",
    "claude-instant-1.2",
    "deepseek-chat",
    "deepseek-reasoner",
    "deepseek-r1",
    "llama-3.1-8b",
    "llama-3.1-70b",
    "llama-3.3-70b",
    "codestral-2501",
    "mistral-large-2411",
    "qwen2.5-72b-instruct",
    "qwen2.5-coder-32b-instruct"
  ];

  for (const file of nonImageFiles) {
    const attachment = [
      {
        mimeType: file.mimeType,
        description: file.name,
        payload: { case: "inlineData", value: new Uint8Array([1, 2, 3]) }
      }
    ];

    for (const model of nonVisionModels) {
      const blockedInLNa = LNa(attachment, model);
      assert.equal(
        blockedInLNa,
        false,
        `LNa must NOT block non-image file ${file.name} (${file.mimeType}) on non-vision model ${model}`
      );

      const nnaError = NNa(attachment, model, false);
      assert.equal(
        nnaError,
        undefined,
        `NNa must NOT return error for non-image file ${file.name} on model ${model}`
      );

      const validation = validateVisionSupport(model, attachment);
      assert.equal(
        validation.valid,
        true,
        `validateVisionSupport must allow non-image file ${file.name} on model ${model}`
      );

      const btn = simulateSendButtonDisabled({
        attachments: attachment,
        currentModelConfig: model,
        isInputEmpty: false
      });
      assert.equal(
        btn.disabled,
        false,
        `Send button must be ENABLED for non-image file ${file.name} on model ${model}`
      );
      assert.equal(btn.cursorClass, "cursor-pointer");
    }
  }

  const multiNonImgBatch = nonImageFiles.map((f, i) => ({
    mimeType: f.mimeType,
    description: f.name,
    payload: { case: "inlineData", value: new Uint8Array([i, i + 1]) }
  }));

  for (const model of nonVisionModels) {
    assert.equal(LNa(multiNonImgBatch, model), false, `Batch of 12 non-image files must not be blocked on ${model}`);
    assert.equal(NNa(multiNonImgBatch, model, false), undefined);
    assert.equal(validateVisionSupport(model, multiNonImgBatch).valid, true);

    const btn = simulateSendButtonDisabled({
      attachments: multiNonImgBatch,
      currentModelConfig: model,
      isInputEmpty: false
    });
    assert.equal(btn.disabled, false);
  }
});

// ============================================================================
// Test Suite 5: Adversarial Evasion & Edge Cases
// ============================================================================
test("Suite 5: Adversarial Evasion Vectors, Malformed Attachments & Substring Traps", async (t) => {
  await t.test("empty or null attachments never block send", () => {
    assert.equal(LNa([], "gpt-3.5-turbo"), false);
    assert.equal(LNa(null, "gpt-3.5-turbo"), false);
    assert.equal(LNa(undefined, "gpt-3.5-turbo"), false);
    assert.equal(validateVisionSupport("gpt-3.5-turbo", []).valid, true);
    assert.equal(validateVisionSupport("gpt-3.5-turbo", null).valid, true);
  });

  await t.test("MIME types with uppercase or parameters are accurately recognized", () => {
    const uppercaseImg = [{ mimeType: "IMAGE/PNG" }];
    const paramImg = [{ mimeType: "image/jpeg; charset=utf-8" }];

    assert.equal(LNa(uppercaseImg, "gpt-3.5-turbo"), true);
    assert.equal(LNa(paramImg, "gpt-3.5-turbo"), true);

    assert.equal(LNa(uppercaseImg, "gpt-4o"), false);
    assert.equal(LNa(paramImg, "gpt-4o"), false);
  });

  await t.test("Substring traps: non-image MIME types containing 'image' substring must NOT be blocked", () => {
    const traps = [
      { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.image" },
      { mimeType: "text/x-image-map" },
      { mimeType: "application/image-manifest+json" }
    ];

    for (const trap of traps) {
      assert.equal(isImageMime(trap.mimeType), false, `isImageMime must be false for ${trap.mimeType}`);
      assert.equal(
        LNa([trap], "gpt-3.5-turbo"),
        false,
        `LNa must NOT block substring trap ${trap.mimeType} on gpt-3.5-turbo`
      );
      assert.equal(validateVisionSupport("gpt-3.5-turbo", [trap]).valid, true);
    }
  });

  await t.test("attachment with type fallback instead of mimeType", () => {
    const typeImg = [{ type: "image/webp" }];
    assert.equal(LNa(typeImg, "gpt-3.5-turbo"), true, "type fallback must detect image and block non-vision");
    assert.equal(LNa(typeImg, "gpt-4o"), false, "type fallback must allow vision model");

    const typeCode = [{ type: "text/x-python" }];
    assert.equal(LNa(typeCode, "gpt-3.5-turbo"), false, "type fallback must not block code");
  });

  await t.test("mixed attachments (1 image + 5 code files) must trigger vision check", () => {
    const mixed = [
      { mimeType: "text/x-python" },
      { mimeType: "application/zip" },
      { mimeType: "text/markdown" },
      { mimeType: "image/png" },
      { mimeType: "application/json" }
    ];

    assert.equal(LNa(mixed, "gpt-3.5-turbo"), true);
    assert.equal(validateVisionSupport("gpt-3.5-turbo", mixed).valid, false);

    assert.equal(LNa(mixed, "gpt-4o"), false);
    assert.equal(validateVisionSupport("gpt-4o", mixed).valid, true);
  });
});
