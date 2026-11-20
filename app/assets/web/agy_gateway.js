/* Leostryx — Gateway & Multimodal Payload Transformation Module
 *
 * Provides serialization and conversion of internal media attachments to:
 * - OpenAI Chat Completions: { type: "image_url", image_url: { url: "data:<mime>;base64,..." } }
 * - OpenAI Responses API:    { type: "input_image", image_url: "data:<mime>;base64,..." }
 * - Anthropic Messages API:  { type: "image", source: { type: "base64", media_type: "<mime>", data: "<b64>" } }
 *
 * Also provides:
 * - MIME normalization (image/jpg -> image/jpeg) and format validation
 * - Model vision capability resolution
 * - Pre-send attachment validation with draft retention guarantees
 * - Base64 and binary log / telemetry redaction preserving metadata
 */
(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    var exp = factory();
    if (typeof window !== "undefined") {
      window.AgyGateway = exp;
    }
    if (typeof root !== "undefined") {
      root.AgyGateway = exp;
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Anthropic strictly supported image MIME types
  var ANTHROPIC_SUPPORTED_IMAGE_MIMES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp"
  ];

  // Helper: Convert Uint8Array / Buffer / number[] to Base64 string
  function uint8ToBase64(bytes) {
    if (!bytes) return "";
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("base64");
    }
    var binary = "";
    var len = bytes.byteLength !== undefined ? bytes.byteLength : bytes.length;
    for (var i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    if (typeof btoa === "function") {
      return btoa(binary);
    }
    throw new Error("No Base64 encoder available in environment");
  }

  // Helper: Convert Base64 string to Uint8Array
  function base64ToUint8(b64) {
    if (!b64) return new Uint8Array(0);
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(b64, "base64"));
    }
    if (typeof atob === "function") {
      var binary = atob(b64);
      var len = binary.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
    throw new Error("No Base64 decoder available in environment");
  }

  // Normalize MIME types (e.g. image/jpg -> image/jpeg)
  function normalizeMimeType(mime) {
    if (!mime || typeof mime !== "string") return "";
    var clean = mime.split(";")[0].trim().toLowerCase();
    if (clean === "image/jpg") {
      return "image/jpeg";
    }
    return clean;
  }

  // Check if MIME type is an image
  function isImageMime(mime) {
    var normalized = normalizeMimeType(mime);
    return /^image\//i.test(normalized);
  }

  // Parse Data URL: data:<mime>;base64,<payload>
  function parseDataUrl(dataUrl) {
    if (!dataUrl || typeof dataUrl !== "string") {
      throw new Error("Invalid data URL: input must be a non-empty string");
    }
    var commaIdx = dataUrl.indexOf(",");
    var semiIdx = dataUrl.indexOf(";");
    if (
      !dataUrl.startsWith("data:") ||
      commaIdx < 0 ||
      semiIdx < 0 ||
      semiIdx > commaIdx ||
      commaIdx === dataUrl.length - 1
    ) {
      throw new Error("Invalid base64 image data URL");
    }
    var prefix = dataUrl.substring(0, commaIdx);
    if (!prefix.endsWith(";base64")) {
      throw new Error("Invalid base64 image: missing ;base64 indicator");
    }
    var rawMime = dataUrl.substring(5, semiIdx);
    var normalizedMime = normalizeMimeType(rawMime);
    var b64Data = dataUrl.substring(commaIdx + 1);
    var byteSize = Math.round((b64Data.length * 3) / 4);

    return {
      mimeType: normalizedMime,
      base64Data: b64Data,
      byteSize: byteSize
    };
  }

  // Extract normalized media info from internal representation
  function extractMediaInfo(item) {
    if (!item) {
      throw new Error("Invalid attachment item: cannot be null or undefined");
    }

    // 1. Direct string data URL
    if (typeof item === "string") {
      if (item.startsWith("data:image/")) {
        var parsed = parseDataUrl(item);
        return {
          mimeType: parsed.mimeType,
          base64Data: parsed.base64Data,
          dataUrl: "data:" + parsed.mimeType + ";base64," + parsed.base64Data,
          url: null,
          byteSize: parsed.byteSize
        };
      }
      if (item.startsWith("http://") || item.startsWith("https://")) {
        return {
          mimeType: "image/jpeg",
          base64Data: null,
          dataUrl: null,
          url: item,
          byteSize: 0
        };
      }
      throw new Error("Unsupported string attachment: must be a data:image/ or http(s) URL");
    }

    // 2. OpenAI image_url part: { type: "image_url", image_url: { url: ... } }
    if (item.type === "image_url" && item.image_url) {
      var rawUrl = typeof item.image_url === "object" ? item.image_url.url : item.image_url;
      if (typeof rawUrl === "string") {
        if (rawUrl.startsWith("data:image/")) {
          var parsedObj = parseDataUrl(rawUrl);
          return {
            mimeType: parsedObj.mimeType,
            base64Data: parsedObj.base64Data,
            dataUrl: "data:" + parsedObj.mimeType + ";base64," + parsedObj.base64Data,
            url: null,
            detail: item.image_url.detail || "auto",
            byteSize: parsedObj.byteSize
          };
        }
        if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
          return {
            mimeType: "image/jpeg",
            base64Data: null,
            dataUrl: null,
            url: rawUrl,
            detail: item.image_url.detail || "auto",
            byteSize: 0
          };
        }
      }
    }

    // 3. OpenAI input_image part: { type: "input_image", image_url: ... }
    if (item.type === "input_image" && item.image_url) {
      var inputUrl = typeof item.image_url === "object" ? item.image_url.url : item.image_url;
      if (typeof inputUrl === "string") {
        if (inputUrl.startsWith("data:image/")) {
          var parsedInput = parseDataUrl(inputUrl);
          return {
            mimeType: parsedInput.mimeType,
            base64Data: parsedInput.base64Data,
            dataUrl: "data:" + parsedInput.mimeType + ";base64," + parsedInput.base64Data,
            url: null,
            detail: item.detail || "auto",
            byteSize: parsedInput.byteSize
          };
        }
        if (inputUrl.startsWith("http://") || inputUrl.startsWith("https://")) {
          return {
            mimeType: "image/jpeg",
            base64Data: null,
            dataUrl: null,
            url: inputUrl,
            detail: item.detail || "auto",
            byteSize: 0
          };
        }
      }
    }

    // 4. Anthropic image block: { type: "image", source: { type: "base64", media_type, data } }
    if (item.type === "image" && item.source) {
      if (item.source.type === "base64") {
        var aMime = normalizeMimeType(item.source.media_type);
        var aData = item.source.data || "";
        return {
          mimeType: aMime,
          base64Data: aData,
          dataUrl: "data:" + aMime + ";base64," + aData,
          url: null,
          byteSize: Math.round((aData.length * 3) / 4)
        };
      }
      if (item.source.type === "url") {
        return {
          mimeType: "image/jpeg",
          base64Data: null,
          dataUrl: null,
          url: item.source.url,
          byteSize: 0
        };
      }
    }

    // 5. Protobuf I.MediaSchema: { mimeType, description, payload: { case: "inlineData", value: Uint8Array } }
    var mime = normalizeMimeType(item.mimeType || item.type || "");
    var detail = item.detail || "auto";

    if (item.payload && item.payload.case === "inlineData" && item.payload.value) {
      var b64FromBytes = uint8ToBase64(item.payload.value);
      return {
        mimeType: mime,
        base64Data: b64FromBytes,
        dataUrl: "data:" + mime + ";base64," + b64FromBytes,
        url: null,
        detail: detail,
        byteSize: item.payload.value.byteLength || item.payload.value.length || Math.round((b64FromBytes.length * 3) / 4)
      };
    }

    // 6. Generic object: { mimeType, data: "<b64>" } or { mimeType, base64: "<b64>" }
    var rawB64 = item.data || item.base64 || item.base64Data;
    if (typeof rawB64 === "string" && rawB64.length > 0) {
      if (rawB64.startsWith("data:image/")) {
        var parsedRaw = parseDataUrl(rawB64);
        return {
          mimeType: parsedRaw.mimeType,
          base64Data: parsedRaw.base64Data,
          dataUrl: "data:" + parsedRaw.mimeType + ";base64," + parsedRaw.base64Data,
          url: null,
          detail: detail,
          byteSize: parsedRaw.byteSize
        };
      }
      return {
        mimeType: mime || "image/png",
        base64Data: rawB64,
        dataUrl: "data:" + (mime || "image/png") + ";base64," + rawB64,
        url: null,
        detail: detail,
        byteSize: Math.round((rawB64.length * 3) / 4)
      };
    }

    // 7. Object with url property: { url: "https://..." }
    if (item.url && typeof item.url === "string") {
      if (item.url.startsWith("data:image/")) {
        var parsedUrl = parseDataUrl(item.url);
        return {
          mimeType: parsedUrl.mimeType,
          base64Data: parsedUrl.base64Data,
          dataUrl: "data:" + parsedUrl.mimeType + ";base64," + parsedUrl.base64Data,
          url: null,
          detail: detail,
          byteSize: parsedUrl.byteSize
        };
      }
      return {
        mimeType: mime || "image/jpeg",
        base64Data: null,
        dataUrl: null,
        url: item.url,
        detail: detail,
        byteSize: 0
      };
    }

    throw new Error("Unable to extract media information from item: " + JSON.stringify(item).substring(0, 80));
  }

  // --- Transformation 1: OpenAI Chat Completions Part ---
  // Returns: { type: "image_url", image_url: { url: "data:<mime>;base64,...", detail?: "auto" } }
  function transformToOpenAIChat(mediaItem, options) {
    var info = extractMediaInfo(mediaItem);
    var detail = (options && options.detail) || info.detail || "auto";

    if (info.url) {
      return {
        type: "image_url",
        image_url: {
          url: info.url,
          detail: detail
        }
      };
    }

    return {
      type: "image_url",
      image_url: {
        url: "data:" + info.mimeType + ";base64," + info.base64Data,
        detail: detail
      }
    };
  }

  // --- Transformation 2: OpenAI Responses API Part ---
  // Returns: { type: "input_image", image_url: "data:<mime>;base64,...", detail?: "auto" }
  function transformToOpenAIResponses(mediaItem, options) {
    var info = extractMediaInfo(mediaItem);
    var detail = (options && options.detail) || info.detail || "auto";

    if (info.url) {
      return {
        type: "input_image",
        image_url: info.url,
        detail: detail
      };
    }

    return {
      type: "input_image",
      image_url: "data:" + info.mimeType + ";base64," + info.base64Data,
      detail: detail
    };
  }

  // --- Transformation 3: Anthropic Messages Content Block ---
  // Returns: { type: "image", source: { type: "base64", media_type: "<mime>", data: "<b64>" } }
  function transformToAnthropic(mediaItem) {
    var info = extractMediaInfo(mediaItem);

    if (info.url) {
      return {
        type: "image",
        source: {
          type: "url",
          url: info.url
        }
      };
    }

    var normalizedMime = normalizeMimeType(info.mimeType);
    if (ANTHROPIC_SUPPORTED_IMAGE_MIMES.indexOf(normalizedMime) < 0) {
      throw new Error("Image format not supported by Anthropic: " + normalizedMime);
    }

    return {
      type: "image",
      source: {
        type: "base64",
        media_type: normalizedMime,
        data: info.base64Data
      }
    };
  }

  // Convert array of user content parts (OpenAI style) to target format (Anthropic or Gemini)
  // Replicates and standardizes the Java AgyGateway.convertUserContent method.
  function convertUserContent(contentArray, isAnthropic) {
    if (!Array.isArray(contentArray)) {
      throw new Error("Invalid content block: content must be an array");
    }

    var converted = [];
    for (var i = 0; i < contentArray.length; i++) {
      var block = contentArray[i];
      if (!block || typeof block !== "object") {
        throw new Error("Invalid content block");
      }

      var type = block.type || "";
      if (type === "text" || block.text !== undefined) {
        var textVal = block.text || "";
        if (isAnthropic) {
          converted.push({ type: "text", text: textVal });
        } else {
          converted.push({ text: textVal });
        }
      } else if (type === "image_url" || block.image_url !== undefined) {
        var rawUrl = "";
        if (typeof block.image_url === "object" && block.image_url !== null) {
          rawUrl = block.image_url.url || "";
        } else if (typeof block.image_url === "string") {
          rawUrl = block.image_url;
        }

        if (rawUrl.startsWith("data:image/")) {
          var parsed = parseDataUrl(rawUrl);
          var mime = parsed.mimeType;

          if (isAnthropic) {
            if (ANTHROPIC_SUPPORTED_IMAGE_MIMES.indexOf(mime) < 0) {
              throw new Error("Image format not supported by Anthropic: " + mime);
            }
            converted.push({
              type: "image",
              source: {
                type: "base64",
                media_type: mime,
                data: parsed.base64Data
              }
            });
          } else {
            // Gemini inline_data format
            converted.push({
              inline_data: {
                mime_type: mime,
                data: parsed.base64Data
              }
            });
          }
        } else if (isAnthropic && (rawUrl.startsWith("https://") || rawUrl.startsWith("http://"))) {
          converted.push({
            type: "image",
            source: {
              type: "url",
              url: rawUrl
            }
          });
        } else {
          throw new Error("Unsupported image source; use a base64 image");
        }
      } else {
        throw new Error("Unsupported content block: " + type);
      }
    }
    return converted;
  }

  // Transform entire OpenAI Chat Completions request into target protocol
  function transformRequest(request, targetProtocol) {
    if (!request || typeof request !== "object") {
      throw new Error("Invalid request object");
    }
    var target = String(targetProtocol || "openai").toLowerCase();

    // 1. OpenAI Chat Completions (pass-through / standard normalization)
    if (target === "openai") {
      return JSON.parse(JSON.stringify(request));
    }

    // 2. OpenAI Responses API
    if (target === "responses") {
      var responsesReq = Object.assign({}, request);
      if (Array.isArray(request.messages)) {
        responsesReq.messages = request.messages.map(function (msg) {
          if (!msg || typeof msg !== "object") return msg;
          if (Array.isArray(msg.content)) {
            var newContent = msg.content.map(function (part) {
              if (part.type === "text" || part.text !== undefined) {
                return { type: "input_text", text: part.text || "" };
              }
              if (part.type === "image_url" || part.image_url !== undefined) {
                return transformToOpenAIResponses(part);
              }
              return part;
            });
            return Object.assign({}, msg, { content: newContent });
          }
          return msg;
        });
      }
      return responsesReq;
    }

    // 3. Anthropic Messages API
    if (target === "anthropic") {
      var systemPrompt = "";
      var outMessages = [];

      var srcMessages = Array.isArray(request.messages) ? request.messages : [];
      for (var i = 0; i < srcMessages.length; i++) {
        var m = srcMessages[i];
        if (!m || typeof m !== "object") continue;

        var role = m.role || "user";
        var rawContent = m.content;

        if (role === "system") {
          var sysText = typeof rawContent === "string" ? rawContent : "";
          if (Array.isArray(rawContent)) {
            sysText = rawContent
              .filter(function (p) { return p && (p.text || p.type === "text"); })
              .map(function (p) { return p.text || ""; })
              .join("\n");
          }
          if (sysText) {
            systemPrompt = systemPrompt ? systemPrompt + "\n" + sysText : sysText;
          }
        } else {
          var outRole = role === "assistant" ? "assistant" : "user";
          var convertedContent;

          if (Array.isArray(rawContent)) {
            // CRITICAL FIX: The converted array MUST be assigned to message content!
            convertedContent = convertUserContent(rawContent, true);
          } else {
            convertedContent = typeof rawContent === "string" ? rawContent : "";
          }

          outMessages.push({
            role: outRole,
            content: convertedContent
          });
        }
      }

      var anthropicPayload = {
        model: request.model,
        messages: outMessages,
        max_tokens: request.max_tokens || request.maxTokens || 4096
      };
      if (systemPrompt) {
        anthropicPayload.system = systemPrompt;
      }
      if (request.temperature !== undefined) {
        anthropicPayload.temperature = request.temperature;
      }
      if (request.stream !== undefined) {
        anthropicPayload.stream = request.stream;
      }

      return anthropicPayload;
    }

    throw new Error("Unsupported target protocol: " + targetProtocol);
  }

  // --- Model Vision Capability Resolution ---
  function isModelVisionCapable(modelIdOrConfig) {
    if (!modelIdOrConfig) return false;

    // Direct Map object
    if (typeof modelIdOrConfig.get === "function") {
      if (modelIdOrConfig.get("image/png") === true) return true;
      if (modelIdOrConfig.size > 0) return true;
    }

    // If config object
    if (typeof modelIdOrConfig === "object") {
      if (
        modelIdOrConfig.supportedMimeTypes &&
        typeof modelIdOrConfig.supportedMimeTypes.get === "function"
      ) {
        if (modelIdOrConfig.supportedMimeTypes.get("image/png") === true) return true;
        if (modelIdOrConfig.supportedMimeTypes.size > 0) return true;
      }
      if (
        modelIdOrConfig.modelFeatures &&
        typeof modelIdOrConfig.modelFeatures.supportsImages === "boolean"
      ) {
        return modelIdOrConfig.modelFeatures.supportsImages;
      }
      if (typeof modelIdOrConfig.images === "boolean") {
        return modelIdOrConfig.images;
      }
      if (Array.isArray(modelIdOrConfig.inputModes)) {
        return modelIdOrConfig.inputModes.indexOf("image") >= 0;
      }
      var nameCandidate =
        modelIdOrConfig.id ||
        modelIdOrConfig.model ||
        modelIdOrConfig.label ||
        modelIdOrConfig.modelName ||
        modelIdOrConfig.chatModelName ||
        modelIdOrConfig.value ||
        modelIdOrConfig.name ||
        "";
      if (nameCandidate) {
        return isModelVisionCapable(nameCandidate);
      }
      return false;
    }

    // String identifier resolution
    var id = String(modelIdOrConfig).trim().toLowerCase();
    var pureId = id.indexOf("/") >= 0 ? id.split("/").pop() : id;

    // Explicit vision keywords
    if (
      /(?:^|[-_.])(vision|vl|4v|multimodal)(?:[-_.]|$)/.test(id) ||
      id.indexOf("-v-") >= 0 ||
      id.endsWith("-v")
    ) {
      return true;
    }

    // Family 1: Google Gemini (all support vision)
    if (pureId.indexOf("gemini") >= 0 || id.indexOf("gemini") >= 0) {
      return true;
    }

    // Family 2: Anthropic Claude
    if (
      pureId.indexOf("claude") >= 0 ||
      pureId.indexOf("sonnet") >= 0 ||
      pureId.indexOf("haiku") >= 0 ||
      pureId.indexOf("opus") >= 0
    ) {
      if (pureId.indexOf("claude-2") >= 0 || pureId.indexOf("instant") >= 0) {
        return false;
      }
      return true; // Claude 3, 3.5, 3.7 all support vision
    }

    // Family 3: OpenAI
    if (
      pureId.indexOf("openai") >= 0 ||
      pureId.indexOf("gpt") >= 0 ||
      pureId.indexOf("o1") >= 0 ||
      pureId.indexOf("o3") >= 0 ||
      pureId.indexOf("o4") >= 0 ||
      pureId.indexOf("o5") >= 0
    ) {
      var isO =
        pureId.indexOf("o1") >= 0 ||
        pureId.indexOf("o3") >= 0 ||
        pureId.indexOf("o4") >= 0 ||
        pureId.indexOf("o5") >= 0;
      if (isO) return true;
      if (pureId.indexOf("4o") >= 0) return true;
      if (pureId.indexOf("4.5") >= 0) return true;
      if (pureId.indexOf("4-turbo") >= 0) return true;
      // Older gpt-4, gpt-3.5-turbo are text only
      return false;
    }

    // Family 4: DeepSeek
    if (
      pureId.indexOf("deepseek") >= 0 ||
      id.indexOf("deepseek") >= 0 ||
      pureId.indexOf("r1") >= 0 ||
      pureId.indexOf("janus") >= 0 ||
      id.indexOf("janus") >= 0
    ) {
      // deepseek-chat, deepseek-reasoner are text-only unless explicitly VL / Janus
      return (
        pureId.indexOf("vl") >= 0 ||
        pureId.indexOf("janus") >= 0 ||
        pureId.indexOf("vision") >= 0
      );
    }

    // Family 5: Meta Llama
    if (pureId.indexOf("llama") >= 0) {
      // llama-3.2-11b-vision, llama-3.2-90b-vision
      if (pureId.indexOf("vision") >= 0) return true;
      if (
        pureId.indexOf("3.2") >= 0 &&
        (pureId.indexOf("11b") >= 0 || pureId.indexOf("90b") >= 0)
      ) {
        return true;
      }
      return false; // llama-3.1, llama-3.3, llama-3.2-1b/3b are text only
    }

    // Family 6: Mistral
    if (
      pureId.indexOf("mistral") >= 0 ||
      pureId.indexOf("codestral") >= 0 ||
      pureId.indexOf("pixtral") >= 0
    ) {
      return pureId.indexOf("pixtral") >= 0 || pureId.indexOf("vision") >= 0;
    }

    // Family 7: Qwen
    if (pureId.indexOf("qwen") >= 0 || pureId.indexOf("qwq") >= 0) {
      return pureId.indexOf("vl") >= 0 || pureId.indexOf("vision") >= 0;
    }

    // Family 8: Kimi / Moonshot
    if (pureId.indexOf("kimi") >= 0 || pureId.indexOf("moonshot") >= 0) {
      return true;
    }

    // Family 9: MiniMax
    if (pureId.indexOf("minimax") >= 0 || pureId.indexOf("hailuo") >= 0) {
      return true;
    }

    // Family 10: Xiaomi MiMo
    if (
      pureId.indexOf("mimo") >= 0 ||
      id.indexOf("mimo") >= 0 ||
      pureId.indexOf("xiaomi") >= 0
    ) {
      return true;
    }

    return false;
  }

  // --- Pre-Send Vision Validation ---
  function validateVisionSupport(modelConfigOrId, attachments) {
    if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
      return { valid: true };
    }

    // Check if any attachment is an image
    var hasImage = false;
    for (var i = 0; i < attachments.length; i++) {
      var item = attachments[i];
      var mime = (item && (item.mimeType || item.type || "")) || "";
      if (isImageMime(mime)) {
        hasImage = true;
        break;
      }
    }

    // If no images are attached, allow send (text, code, zip files are never blocked)
    if (!hasImage) {
      return { valid: true };
    }

    // Images are attached: verify model vision capability
    var capable = isModelVisionCapable(modelConfigOrId);
    if (!capable) {
      return {
        valid: false,
        error:
          "Selected model does not support images. Select a vision-capable model (e.g. GPT-4o, Claude 3.5 Sonnet, Gemini 2.5 Flash) or remove the image."
      };
    }

    return { valid: true };
  }

  // --- Base64 & Binary Log Redaction ---
  // Masks Base64 data URLs and raw data fields in logs and dumps while retaining metadata.
  function maskMediaInLogs(input) {
    if (input === null || input === undefined) return input;

    // Handle object / array recursively
    if (typeof input === "object") {
      try {
        var str = JSON.stringify(input);
        var redactedStr = maskMediaInLogs(str);
        return JSON.parse(redactedStr);
      } catch (e) {
        try {
          var clone = Array.isArray(input) ? [] : {};
          for (var k in input) {
            if (Object.prototype.hasOwnProperty.call(input, k)) {
              clone[k] = maskMediaInLogs(input[k]);
            }
          }
          return clone;
        } catch (err2) {
          return "[Redacted Object]";
        }
      }
    }

    if (typeof input !== "string") {
      return String(input);
    }

    if (!input) return "";

    // Helper to find the end index of Base64 data starting at startIdx
    function findBase64End(str, startIdx, matchStart) {
      var len = str.length;
      var quote = matchStart > 0 ? str.charAt(matchStart - 1) : "";
      if (quote === "\"" || quote === "\x27") {
        var qEnd = str.indexOf(quote, startIdx);
        if (qEnd !== -1) {
          return { end: qEnd, validLen: qEnd - startIdx };
        }
      }

      var b64EndRegex = /[^A-Za-z0-9+/=]/g;
      b64EndRegex.lastIndex = startIdx;
      var m = b64EndRegex.exec(str);
      if (!m) {
        return { end: len, validLen: len - startIdx };
      }
      if (m[0] !== "\r" && m[0] !== "\n") {
        return { end: m.index, validLen: m.index - startIdx };
      }

      var idx = startIdx;
      var validChars = 0;
      while (idx < len) {
        var c = str.charCodeAt(idx);
        // Base64 chars: A-Z (65-90), a-z (97-122), 0-9 (48-57), + (43), / (47), = (61)
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 61) {
          validChars++;
          idx++;
        } else if (c === 10 || c === 13) {
          // Newline in MIME chunked base64: check if followed by more base64 chars
          var next = idx + 1;
          while (next < len && (str.charCodeAt(next) === 10 || str.charCodeAt(next) === 13 || str.charCodeAt(next) === 32 || str.charCodeAt(next) === 9)) {
            next++;
          }
          if (next < len) {
            var nc = str.charCodeAt(next);
            if ((nc >= 65 && nc <= 90) || (nc >= 97 && nc <= 122) || (nc >= 48 && nc <= 57) || nc === 43 || nc === 47 || nc === 61) {
              idx = next;
              continue;
            }
          }
          break;
        } else {
          break;
        }
      }
      return { end: idx, validLen: validChars > 0 ? validChars : (idx - startIdx) };
    }

    // Pattern 1: Data URLs with prefix matching
    // Supports JSON-escaped slashes (\/), MIME parameters (;charset=...), and chunked Base64
    var dataUrlPrefixPattern = /data:(image(?:\/|\\\/)[a-zA-Z0-9.+_-]+)((?:;[a-zA-Z0-9._-]+=[^;,]+)*);base64,/gi;
    var pieces = [];
    var lastIdx = 0;
    var match;

    while ((match = dataUrlPrefixPattern.exec(input)) !== null) {
      var matchStart = match.index;
      var b64Start = dataUrlPrefixPattern.lastIndex;
      var b64Info = findBase64End(input, b64Start, matchStart);

      var bytes = Math.round((b64Info.validLen * 3) / 4);
      var rawMime = match[1];
      var normalizedMime = rawMime.replace(/\\/g, "");

      pieces.push(input.substring(lastIdx, matchStart));
      pieces.push("[IMAGE: " + normalizedMime + ", " + bytes + " bytes]");

      lastIdx = b64Info.end;
      dataUrlPrefixPattern.lastIndex = b64Info.end;
    }
    pieces.push(input.substring(lastIdx));
    var out = pieces.join("");

    // Pattern 2: JSON data field: "data": "A...=" or "b64_json": "A...="
    var jsonDataPrefixPattern = /("data"\s*:\s*")|("b64_json"\s*:\s*")/gi;
    var jsonPieces = [];
    lastIdx = 0;

    while ((match = jsonDataPrefixPattern.exec(out)) !== null) {
      var prefixStart = match.index;
      var prefix = match[0];
      var b64Start = jsonDataPrefixPattern.lastIndex;
      var b64End = out.indexOf("\"", b64Start);

      if (b64End !== -1) {
        var b64Len = b64End - b64Start;
        if (b64Len >= 40) {
          var bytes = Math.round((b64Len * 3) / 4);
          jsonPieces.push(out.substring(lastIdx, prefixStart));
          jsonPieces.push(prefix + "<base64 redacted: " + bytes + " bytes>\"");
          lastIdx = b64End + 1;
          jsonDataPrefixPattern.lastIndex = b64End + 1;
          continue;
        }
      }
    }
    jsonPieces.push(out.substring(lastIdx));
    out = jsonPieces.join("");

    return out;
  }

  // Resolve AgyCompactor if available
  var compactor = null;
  try {
    if (typeof require === "function") {
      compactor = require("./agy_compactor.js");
    }
  } catch (e) {}
  if (!compactor) {
    if (typeof window !== "undefined" && window.AgyCompactor) {
      compactor = window.AgyCompactor;
    } else if (typeof root !== "undefined" && root.AgyCompactor) {
      compactor = root.AgyCompactor;
    }
  }

  function isContextOverflowError(statusCode, responseBody) {
    if (compactor && typeof compactor.isContextOverflowError === "function") {
      return compactor.isContextOverflowError(statusCode, responseBody);
    }
    var status = typeof statusCode === "object" && statusCode !== null ? (statusCode.status || statusCode.statusCode || 0) : statusCode;
    if (status === 413) return true;
    if (status !== 400 && status !== 422) return false;
    var text = String(typeof responseBody === "object" ? JSON.stringify(responseBody) : (responseBody || ""));
    return /context[-_\s]length[-_\s]exceeded|maximum context length|prompt is too long|context window|max_tokens/i.test(text);
  }

  function slicePromptHistory(messages, compactionState, options) {
    if (compactor && typeof compactor.slicePromptHistory === "function") {
      return compactor.slicePromptHistory(messages, compactionState, options);
    }
    return Array.isArray(messages) ? messages.slice() : [];
  }

  function handleOverflowRecovery(params) {
    if (compactor && typeof compactor.handleOverflowRecovery === "function") {
      return compactor.handleOverflowRecovery(params);
    }
    if (compactor && compactor.AgyCompactor && typeof compactor.AgyCompactor.handleOverflowRecovery === "function") {
      return compactor.AgyCompactor.handleOverflowRecovery(params);
    }
    throw new Error("Compactor module not initialized");
  }

  return {
    ANTHROPIC_SUPPORTED_IMAGE_MIMES: ANTHROPIC_SUPPORTED_IMAGE_MIMES,
    uint8ToBase64: uint8ToBase64,
    base64ToUint8: base64ToUint8,
    normalizeMimeType: normalizeMimeType,
    isImageMime: isImageMime,
    parseDataUrl: parseDataUrl,
    extractMediaInfo: extractMediaInfo,
    transformToOpenAIChat: transformToOpenAIChat,
    transformToOpenAIResponses: transformToOpenAIResponses,
    transformToAnthropic: transformToAnthropic,
    convertUserContent: convertUserContent,
    transformRequest: transformRequest,
    isModelVisionCapable: isModelVisionCapable,
    validateVisionSupport: validateVisionSupport,
    maskMediaInLogs: maskMediaInLogs,
    isContextOverflowError: isContextOverflowError,
    slicePromptHistory: slicePromptHistory,
    handleOverflowRecovery: handleOverflowRecovery,
    CompactionManager: compactor ? (compactor.CompactionManager || compactor) : null,
    AgyCompactor: compactor ? (compactor.AgyCompactor || compactor) : null
  };
});

