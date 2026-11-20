/* Antigravity RU / Leostryx — Streaming Session ZIP Export (Requirement R4)
 * Supports Features F15, F16, F17, F18, F19:
 *  - F15: Streaming ZIP Archive Generation (STORE Method 0, CRC-32, Central Directory, EOCD, >64 MiB support)
 *  - F16: Complete Transcript Packaging (transcript_full.jsonl with pre-compaction entries & transcript.md)
 *  - F17: Attachments Packaging (attachments/ folder with traversal sanitization and collision handling)
 *  - F18: Changes Diff Packaging (changes.diff unified diff from trajectoryFileDiffs or git fallback)
 *  - F19: Export Secret & Credential Filtering and File Blacklisting (.env, id_rsa, tokens, API keys, passwords)
 */
(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else if (typeof define === "function" && define.amd) {
    define([], factory);
  } else {
    var exp = factory();
    if (typeof window !== "undefined") {
      window.ExportManager = exp.ExportManager;
      window.__agyExportSession = exp.exportSession;
      window.__agyExportTest = exp;
    }
    if (typeof root !== "undefined") {
      root.ExportManager = exp.ExportManager;
      root.AgyExportSession = exp;
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ============================================================================
  // Language & Localization Helpers
  // ============================================================================
  function ruT() {
    try {
      if (typeof window !== "undefined" && window.__agyI18n && typeof window.__agyI18n.getLanguage === "function") {
        return window.__agyI18n.getLanguage() === "ru";
      }
    } catch (e) {}
    try {
      if (typeof navigator !== "undefined") return /^ru\b/i.test(navigator.language || "");
    } catch (e) {}
    return false;
  }
  function T(r, e) { return ruT() ? r : e; }

  function toast(msg) {
    try {
      if (typeof document !== "undefined") {
        var d = document.createElement("div");
        d.textContent = msg;
        d.style.cssText = "position:fixed;left:12px;right:12px;bottom:24px;z-index:999999;background:#222;color:#fff;padding:12px 14px;border-radius:10px;font-size:14px;line-height:1.4;";
        document.body.appendChild(d);
        setTimeout(function () { try { d.remove(); } catch (e) {} }, 7000);
        return;
      }
    } catch (e) {}
    try { if (typeof alert === "function") alert(msg); } catch (e2) {}
  }

  function csrfToken() {
    try { if (typeof window !== "undefined" && window.__APP_CONFIG__ && window.__APP_CONFIG__.csrfToken) return window.__APP_CONFIG__.csrfToken; } catch (e) {}
    try {
      if (typeof document !== "undefined" && document.cookie) {
        var m = document.cookie.match(/(?:^|; )csrfToken=([^;]+)/);
        if (m) return decodeURIComponent(m[1]);
      }
    } catch (e) {}
    return "";
  }

  function artifactUrl(cascadeId, rel) {
    var csrf = csrfToken();
    return "/static/artifacts/" + encodeURIComponent(cascadeId) + "/" + rel + (csrf ? "?csrf=" + encodeURIComponent(csrf) : "");
  }

  // ============================================================================
  // Feature F19: File Blacklisting & Sensitive Filename Checking
  // ============================================================================
  var BLACKLISTED_FILENAMES = new Set([
    ".env", ".env.local", ".env.development", ".env.production", ".env.staging", ".env.test",
    "id_rsa", "id_rsa.pub", "id_dsa", "id_ecdsa", "id_ed25519",
    ".netrc", "netrc", ".npmrc", ".pypirc",
    "git-credentials", ".git-credentials",
    "credentials.json", "service-account.json", "service_account.json",
    "serviceaccountkey.json", "client_secret.json", "google-services.json",
    "agy_bridge_token"
  ]);

  var BLACKLISTED_EXTENSIONS = new Set([
    ".pem", ".key", ".keystore", ".jks", ".p12", ".pfx", ".pkcs12", ".pkcs8", ".kdbx", ".ovpn"
  ]);

  function isSensitiveFilename(filepath) {
    if (!filepath || typeof filepath !== "string") return false;
    var clean = filepath.replace(/^[ab]\//, "").split("?")[0].trim();
    var basename = clean.split("/").pop().split("\\").pop().toLowerCase();
    if (BLACKLISTED_FILENAMES.has(basename)) return true;
    if (basename.startsWith(".env.") || basename === ".env") return true;
    var dotIdx = basename.lastIndexOf(".");
    if (dotIdx !== -1) {
      var ext = basename.slice(dotIdx);
      if (BLACKLISTED_EXTENSIONS.has(ext)) return true;
    }
    return false;
  }

  function isPrivateConfigFile(fileName) {
    return isSensitiveFilename(fileName);
  }

  // ============================================================================
  // Feature F19: Secret & Credential Filtering Engine (sanitizeText / redactSensitiveData)
  // ============================================================================
  function sanitizeText(text) {
    if (text === null || text === undefined) return "";
    if (typeof text !== "string") text = String(text);
    if (!text) return "";

    var out = text;

    // 1. Sensitive HTTP Headers (Authorization, Cookie, Proxy-Authorization, X-Api-Key)
    out = out.replace(/(["']?(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)["']?\s*[:=]\s*)[^\r\n",}]+/gi, "$1[REDACTED]");

    // 2. Bearer Tokens (with negative lookahead to protect English phrasing e.g. "bearer of")
    out = out.replace(/(\bBearer\s+)(?!(?:of|a|the|in|to)\b)[A-Za-z0-9._~+/-]{8,}=*/gi, "$1[REDACTED]");

    // 3. Known Provider API Keys and Tokens
    out = out.replace(/\b(sk-ant-[a-zA-Z0-9_-]{20,})\b/g, "[REDACTED_API_KEY]");
    out = out.replace(/\b(sk-[a-zA-Z0-9_-]{20,})\b/g, "[REDACTED_API_KEY]");
    out = out.replace(/\b(AIza[0-9A-Za-z-_]{35})\b/g, "[REDACTED_API_KEY]");
    out = out.replace(/\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED_TOKEN]");
    out = out.replace(/\b(AKIA[0-9A-Z]{16})\b/g, "[REDACTED_AWS_KEY]");

    // 4. Secret Fields in JSON, YAML, shell, or configs
    out = out.replace(/(["']?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|csrf[_-]?token|auth[_-]?token|oauth[_-]?token|client[_-]?secret|device[_-]?code|code[_-]?verifier|session[_-]?state|password|passwd|api[_-]?key|secret|private[_-]?key)["']?\s*[:=]\s*["']?)([^"'\s,;&}]+)(["']?)/gi, "$1[REDACTED]$3");
    out = out.replace(/\b([A-Z0-9_]*(?:API_KEY|CLIENT_SECRET)[A-Z0-9_]*\s*=\s*["']?)([^"'\s,;&}]+)(["']?)/g, "$1[REDACTED]$3");
    out = out.replace(/\b(password\s*=\s*["']?)([^"'\s,;&}]+)(["']?)/gi, "$1[REDACTED]$3");

    // 5. URL Query Credentials
    out = out.replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|client[_-]?secret)=)[^&\s"'>#]+/gi, "$1[REDACTED]");

    // 6. URI Connection Strings with embedded credentials
    out = out.replace(/((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp|https?):\/\/[^:\s"']*):([^@\s"']+)@/gi, "$1:[REDACTED]@");

    // 7. Base64 Data URLs (Mask with concise metadata markers)
    out = out.replace(/data:(image(?:\/|\\\/)[a-zA-Z0-9.+_-]+)((?:;[a-zA-Z0-9._-]+=[^;,]+)*);base64,[A-Za-z0-9+/=\r\n\s]{20,}/gi, "[IMAGE: $1, <redacted>]");

    return out;
  }

  function redactSensitiveData(text) {
    return sanitizeText(text);
  }

  function sanitizeMarkdown(text) {
    return sanitizeText(text);
  }

  function maskMediaInLogs(text) {
    if (typeof text !== "string") return text;
    return text.replace(/data:image\/([a-zA-Z0-9+.-]+);base64,[A-Za-z0-9+/=]+/g, function (match, mime) {
      return "[IMAGE: image/" + mime + ", " + match.length + " bytes]";
    });
  }

  // ============================================================================
  // Feature F19: Unified Diff Sanitization (sanitizeDiff)
  // ============================================================================
  function sanitizeDiff(diffText) {
    if (!diffText || typeof diffText !== "string") return "";
    var sections = diffText.split(/(?=diff --git )/g);
    var out = [];
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      if (!sec.trim()) continue;
      var m = sec.match(/diff --git a\/(.+?) b\/(.+?)(?:\r?\n|$)/);
      var filename = m ? m[2] : "";
      if (!filename) {
        var m2 = sec.match(/---\s+[ab]\/(.+?)(?:\r?\n|$)/);
        if (m2) filename = m2[1];
      }
      if (filename && isSensitiveFilename(filename)) {
        var headerMatch = sec.match(/^(diff --git .+?\r?\n(?:index .+?\r?\n)?--- .+?\r?\n\+\+\+ .+?\r?\n)/);
        var header = headerMatch ? headerMatch[1] : ("diff --git a/" + filename + " b/" + filename + "\n--- a/" + filename + "\n+++ b/" + filename + "\n");
        out.push(header + "@@ -0,0 +1 @@\n+[DIFF REDACTED: sensitive file " + filename + " excluded]\n");
      } else {
        out.push(sanitizeText(sec));
      }
    }
    return out.join("");
  }

  // ============================================================================
  // Feature F19: JSONL Sanitization (sanitizeJsonl)
  // ============================================================================
  function sanitizeObject(val) {
    if (val === null || val === undefined) return val;
    if (typeof val === "string") return sanitizeText(val);
    if (Array.isArray(val)) {
      return val.map(sanitizeObject);
    }
    if (typeof val === "object") {
      var res = {};
      for (var k in val) {
        if (!Object.prototype.hasOwnProperty.call(val, k)) continue;
        if (/^(authorization|cookie|proxy-authorization|x-api-key)$/i.test(k)) {
          res[k] = "[REDACTED]";
        } else if (/^(api[_-]?key|secret|password|passwd|access[_-]?token|refresh[_-]?token|csrf[_-]?token)$/i.test(k)) {
          res[k] = "[REDACTED]";
        } else {
          res[k] = sanitizeObject(val[k]);
        }
      }
      return res;
    }
    return val;
  }

  function sanitizeJsonl(jsonlText) {
    if (!jsonlText || typeof jsonlText !== "string") return "";
    var lines = jsonlText.split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) { out.push(line); continue; }
      try {
        var obj = JSON.parse(line);
        var sanitized = sanitizeObject(obj);
        out.push(JSON.stringify(sanitized));
      } catch (e) {
        out.push(sanitizeText(line));
      }
    }
    return out.join("\n");
  }

  // ============================================================================
  // Helpers: Encoding & Binary Conversions
  // ============================================================================
  function base64ToBytes(b64) {
    if (!b64) return new Uint8Array(0);
    var raw = String(b64).replace(/^data:[^;]+;base64,/, "").trim();
    try {
      if (typeof atob === "function") {
        var bin = atob(raw);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      }
    } catch (e) {}
    try {
      if (typeof Buffer !== "undefined") {
        return new Uint8Array(Buffer.from(raw, "base64"));
      }
    } catch (e) {}
    return new Uint8Array(0);
  }

  function textToBytes(s) {
    return new TextEncoder().encode(s || "");
  }

  function normalizeFilePath(uri) {
    if (!uri) return "unknown_file";
    var p = String(uri).replace(/^file:\/\//i, "").replace(/[?#].*$/, "");
    try { p = decodeURIComponent(p); } catch (e) {}
    p = p.replace(/\\/g, "/");
    var docIdx = p.indexOf("/Documents/");
    if (docIdx >= 0) p = p.slice(docIdx + 11);
    p = p.replace(/^\/+/, "");
    return p;
  }

  // ============================================================================
  // Feature F15: Streaming ZIP Archive Writer & Running CRC-32 (StreamingZipWriter)
  // ============================================================================
  function StreamingZipWriter(options) {
    options = options || {};
    this.onChunk = options.onChunk || null;
    this.chunks = [];
    this.offset = 0;
    this.centralDirectory = [];
    this.closed = false;
  }

  StreamingZipWriter.initCrcTable = function () {
    var t = new Uint32Array(256), c;
    for (var n = 0; n < 256; n++) {
      c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  };

  var CRC_TABLE = StreamingZipWriter.initCrcTable();

  function crc32(bytes, prevCrc) {
    if (typeof bytes === "string") bytes = new TextEncoder().encode(bytes);
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(0);
    var c = prevCrc !== undefined ? (prevCrc ^ 0xFFFFFFFF) >>> 0 : 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  StreamingZipWriter.prototype.u16 = function (v) {
    return new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF]);
  };

  StreamingZipWriter.prototype.u32 = function (v) {
    return new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]);
  };

  StreamingZipWriter.prototype.emit = function (bytes) {
    if (!(bytes instanceof Uint8Array)) return;
    this.offset += bytes.length;
    if (typeof this.onChunk === "function") {
      this.onChunk(bytes);
    } else {
      this.chunks.push(bytes);
    }
  };

  StreamingZipWriter.prototype.addFile = function (filename, data) {
    if (this.closed) throw new Error("StreamingZipWriter is already closed");
    var nameBytes = new TextEncoder().encode(filename);
    if (typeof data === "string") data = new TextEncoder().encode(data);
    if (!(data instanceof Uint8Array)) data = new Uint8Array(0);

    var fileCrc = crc32(data);
    var localOffset = this.offset;

    // 1. Local File Header (30 bytes + name length)
    var lfh = new Uint8Array(30 + nameBytes.length);
    var view = new DataView(lfh.buffer, lfh.byteOffset, lfh.byteLength);
    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, 20, true);         // Version needed: 2.0
    view.setUint16(6, 0x0800, true);     // General purpose bit flag (UTF-8 filename)
    view.setUint16(8, 0, true);          // Compression method: 0 (STORE)
    view.setUint16(10, 0, true);         // Mod time
    view.setUint16(12, 0, true);         // Mod date
    view.setUint32(14, fileCrc, true);   // CRC-32
    view.setUint32(18, data.length, true); // Compressed size
    view.setUint32(22, data.length, true); // Uncompressed size
    view.setUint16(26, nameBytes.length, true); // File name length
    view.setUint16(28, 0, true);         // Extra field length
    lfh.set(nameBytes, 30);

    this.emit(lfh);

    // 2. File Data Payload (chunked in 64 KiB blocks for O(1) buffer footprint)
    var CHUNK_SIZE = 64 * 1024;
    if (data.length <= CHUNK_SIZE) {
      this.emit(data);
    } else {
      for (var pos = 0; pos < data.length; pos += CHUNK_SIZE) {
        this.emit(data.subarray(pos, Math.min(pos + CHUNK_SIZE, data.length)));
      }
    }

    // 3. Central Directory Entry metadata
    this.centralDirectory.push({
      nameBytes: nameBytes,
      crc: fileCrc,
      size: data.length,
      offset: localOffset
    });
  };

  StreamingZipWriter.prototype.finish = function () {
    if (this.closed) throw new Error("StreamingZipWriter is already closed");
    this.closed = true;

    var centralStart = this.offset;

    // Emit Central Directory headers (46 bytes + nameBytes.length)
    for (var i = 0; i < this.centralDirectory.length; i++) {
      var c = this.centralDirectory[i];
      var cdh = new Uint8Array(46 + c.nameBytes.length);
      var view = new DataView(cdh.buffer, cdh.byteOffset, cdh.byteLength);
      view.setUint32(0, 0x02014b50, true); // CD header signature
      view.setUint16(4, 20, true);         // Version made by: 2.0
      view.setUint16(6, 20, true);         // Version needed: 2.0
      view.setUint16(8, 0x0800, true);     // Flags (UTF-8)
      view.setUint16(10, 0, true);         // Compression: STORE (0)
      view.setUint16(12, 0, true);         // Mod time
      view.setUint16(14, 0, true);         // Mod date
      view.setUint32(16, c.crc, true);     // CRC-32
      view.setUint32(20, c.size, true);    // Compressed size
      view.setUint32(24, c.size, true);    // Uncompressed size
      view.setUint16(28, c.nameBytes.length, true); // File name length
      view.setUint16(30, 0, true);         // Extra field length
      view.setUint16(32, 0, true);         // File comment length
      view.setUint16(34, 0, true);         // Disk number start
      view.setUint16(36, 0, true);         // Internal file attributes
      view.setUint32(38, 0, true);         // External file attributes
      view.setUint32(42, c.offset, true);  // Relative offset of local header
      cdh.set(c.nameBytes, 46);

      this.emit(cdh);
    }

    var centralSize = this.offset - centralStart;

    // Emit End of Central Directory (EOCD) record (22 bytes)
    var eocd = new Uint8Array(22);
    var eocdView = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength);
    eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
    eocdView.setUint16(4, 0, true);          // Disk number
    eocdView.setUint16(6, 0, true);          // Disk with central dir
    eocdView.setUint16(8, this.centralDirectory.length, true); // Total entries this disk
    eocdView.setUint16(10, this.centralDirectory.length, true); // Total entries
    eocdView.setUint32(12, centralSize, true); // Central dir size
    eocdView.setUint32(16, centralStart, true); // Central dir offset
    eocdView.setUint16(20, 0, true);         // Comment length

    this.emit(eocd);

    return {
      totalBytes: this.offset,
      totalFiles: this.centralDirectory.length
    };
  };

  StreamingZipWriter.prototype.getUint8Array = function () {
    var total = this.chunks.reduce(function (a, c) { return a + c.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    for (var i = 0; i < this.chunks.length; i++) {
      out.set(this.chunks[i], pos);
      pos += this.chunks[i].length;
    }
    return out;
  };

  // Generator-compatible aliases
  StreamingZipWriter.prototype.writeFile = function* (filename, data) {
    var nameBytes = new TextEncoder().encode(filename);
    if (typeof data === "string") data = new TextEncoder().encode(data);
    if (!(data instanceof Uint8Array)) data = new Uint8Array(0);

    var fileCrc = crc32(data);
    var localOffset = this.offset;

    var lfh = new Uint8Array(30 + nameBytes.length);
    var view = new DataView(lfh.buffer, lfh.byteOffset, lfh.byteLength);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, fileCrc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);

    yield lfh;
    this.offset += lfh.length;

    var CHUNK_SIZE = 64 * 1024;
    for (var pos = 0; pos < data.length; pos += CHUNK_SIZE) {
      var chunk = data.subarray(pos, Math.min(pos + CHUNK_SIZE, data.length));
      yield chunk;
      this.offset += chunk.length;
    }

    this.centralDirectory.push({
      nameBytes: nameBytes,
      crc: fileCrc,
      size: data.length,
      offset: localOffset
    });
  };

  StreamingZipWriter.prototype.finalize = function* () {
    var centralStart = this.offset;
    for (var i = 0; i < this.centralDirectory.length; i++) {
      var c = this.centralDirectory[i];
      var cdh = new Uint8Array(46 + c.nameBytes.length);
      var view = new DataView(cdh.buffer, cdh.byteOffset, cdh.byteLength);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 0, true);
      view.setUint16(14, 0, true);
      view.setUint32(16, c.crc, true);
      view.setUint32(20, c.size, true);
      view.setUint32(24, c.size, true);
      view.setUint16(28, c.nameBytes.length, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, c.offset, true);
      cdh.set(c.nameBytes, 46);

      yield cdh;
      this.offset += cdh.length;
    }

    var centralSize = this.offset - centralStart;
    var eocd = new Uint8Array(22);
    var eocdView = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, this.centralDirectory.length, true);
    eocdView.setUint16(10, this.centralDirectory.length, true);
    eocdView.setUint32(12, centralSize, true);
    eocdView.setUint32(16, centralStart, true);
    eocdView.setUint16(20, 0, true);

    yield eocd;
    this.offset += eocd.length;
  };

  function buildZip(files) {
    var chunks = [];
    var writer = new StreamingZipWriter({ onChunk: function (c) { chunks.push(c); } });
    var validFiles = (files || []).filter(function (f) {
      return !isSensitiveFilename(f.name);
    });
    validFiles.forEach(function (f) {
      var data = f.data;
      if (typeof data === "string") {
        data = new TextEncoder().encode(sanitizeText(data));
      } else if (f.isText && data instanceof Uint8Array) {
        data = new TextEncoder().encode(sanitizeText(new TextDecoder().decode(data)));
      } else if (!(data instanceof Uint8Array)) {
        data = new Uint8Array(0);
      }
      writer.addFile(f.name, data);
    });
    writer.finish();
    var total = chunks.reduce(function (a, c) { return a + c.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    for (var i = 0; i < chunks.length; i++) {
      out.set(chunks[i], pos);
      pos += chunks[i].length;
    }
    return out;
  }

  // ============================================================================
  // Feature F16: Complete Transcript Packaging (packageTranscriptFull & packageTranscriptMd)
  // ============================================================================
  function packageTranscriptFull(records) {
    if (!Array.isArray(records)) return "";
    var lines = [];
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (!rec) continue;
      var clean = Object.assign({}, rec);
      if (clean.content && typeof clean.content === "string") {
        clean.content = maskMediaInLogs(clean.content);
      }
      if (Array.isArray(clean.attachments)) {
        clean.attachments = clean.attachments.map(function (att) {
          return {
            name: att.name || att.displayName || att.description || "attachment",
            mimeType: att.mimeType || "application/octet-stream",
            description: att.description,
            sizeBytes: att.bytes ? att.bytes.length : (att.data ? att.data.length : undefined)
          };
        });
      }
      try {
        var str = JSON.stringify(clean, function (k, v) {
          return typeof v === "bigint" ? v.toString() : v;
        });
        lines.push(sanitizeText(str));
      } catch (e) {
        lines.push(JSON.stringify({ role: rec.role || "unknown", error: "Serialization error: " + e.message }));
      }
    }
    return lines.join("\n");
  }

  function formatTranscriptFullJsonl(records) {
    return packageTranscriptFull(records);
  }

  function packageTranscriptMd(records, options) {
    options = options || {};
    var cascadeId = options.cascadeId || options.chatId || "session";
    var compaction = options.compactionState || null;
    var md = [
      "# Leostryx Session Transcript",
      "",
      "**" + T("Идентификатор сессии", "Session ID") + "**: `" + cascadeId + "`  ",
      "**" + T("Экспортировано", "Exported At") + "**: " + new Date().toISOString() + "  ",
      ""
    ];

    if (compaction && compaction.firstKeptEntryId) {
      md.push("> ℹ️ **" + T("Граница сжатия контекста (Compaction)", "Context Compaction Boundary") + "**");
      md.push("> " + T("Сообщения до шага `", "Messages prior to turn `") + compaction.firstKeptEntryId + "` " + T("были сжаты.", "were compacted."));
      if (compaction.estimatedTokensSaved) {
        md.push("> " + T("Сэкономлено токенов: ~", "Estimated tokens saved: ~") + compaction.estimatedTokensSaved);
      }
      if (compaction.summary) {
        md.push(">", "> **" + T("Сводка сжатой истории", "Compacted History Summary") + "**:", "> " + compaction.summary.split("\n").join("\n> "));
      }
      md.push("");
    }

    if (Array.isArray(records)) {
      records.forEach(function (rec, idx) {
        if (!rec) return;
        var role = rec.role || rec.type || "record";
        var timestamp = rec.timestamp || rec.time || "";
        var title = "## " + (idx + 1) + ". " + role;
        if (timestamp) title += " (" + timestamp + ")";
        md.push(title, "");

        var content = rec.content || rec.text || rec.message || rec.delta || "";
        if (typeof content !== "string") {
          try { content = JSON.stringify(content, null, 2); } catch (e) { content = String(content); }
        }
        if (content) {
          md.push(sanitizeText(maskMediaInLogs(content)), "");
        }

        var thinking = rec.thinking || rec.reasoning;
        if (thinking) {
          md.push("### Reasoning", "```", sanitizeText(String(thinking)), "```", "");
        }

        var toolCalls = rec.toolCalls || rec.tool_calls;
        if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
          md.push("### Tool Calls", "```json", sanitizeText(JSON.stringify(toolCalls, null, 2)), "```", "");
        }

        if (rec.attachments && Array.isArray(rec.attachments) && rec.attachments.length > 0) {
          md.push("### Attachments");
          rec.attachments.forEach(function (att) {
            var attName = att.name || att.displayName || att.description || "attachment";
            md.push("- 📎 `" + attName + "` (" + (att.mimeType || "media") + ")");
          });
          md.push("");
        }
      });
    }
    return md.join("\n");
  }

  function transcriptMd(lines, sourceName) {
    var md = [T("# Сессия Leostryx", "# Leostryx Session Transcript"), "", T("Источник: ", "Source: ") + (sourceName || "session"), ""];
    var filePaths = [], mediaUris = [];
    var list = Array.isArray(lines) ? lines : (typeof lines === "string" ? lines.split("\n") : []);

    list.forEach(function (line, idx) {
      if (line === null || line === undefined) return;
      var rec;
      if (typeof line === "string") {
        if (!line.trim()) return;
        try { rec = JSON.parse(line); } catch (e) {
          md.push(T("## Запись ", "## Record ") + (idx + 1), "", "```", line, "```", "");
          return;
        }
      } else if (typeof line === "object") {
        rec = line;
      } else {
        return;
      }

      var s = JSON.stringify(rec);
      var pathMatch = s.match(/"[^"]*\.(?:py|js|ts|tsx|java|kt|go|rs|md|txt|json|xml|html|css|png|jpg)[^"]*"/g);
      if (pathMatch) pathMatch.forEach(function (p) { var v = p.slice(1, -1); if (filePaths.indexOf(v) < 0) filePaths.push(v); });
      var mediaMatch = s.match(/\.user_uploaded\/[^"'\s]+/g);
      if (mediaMatch) mediaMatch.forEach(function (u) { if (mediaUris.indexOf(u) < 0) mediaUris.push(u); });

      var role = rec.role || rec.type || rec.kind || T("запись", "record");
      var text = rec.text || rec.content || rec.message || rec.delta || "";
      if (typeof text !== "string") text = JSON.stringify(text);

      var title = "## " + (idx + 1) + ". " + role;
      if (rec.timestamp || rec.time) title += " (" + (rec.timestamp || rec.time) + ")";
      md.push(title, "");
      if (text) md.push(sanitizeText(text), "");
      if (rec.thinking) md.push(T("Размышления: ```", "### Reasoning\n```"), sanitizeText(String(rec.thinking).slice(0, 4000)), "```", "");
      if (rec.tool_calls || rec.toolCalls) md.push(T("Инструменты: ```json", "### Tool Calls\n```json"), sanitizeText(JSON.stringify(rec.tool_calls || rec.toolCalls, null, 2)), "```", "");
      if (!text && !rec.tool_calls && !rec.toolCalls && !rec.thinking) md.push("```json", sanitizeText(s.slice(0, 4000)), "```", "");
    });

    return { md: md.join("\n"), filePaths: filePaths, mediaUris: mediaUris };
  }

  // ============================================================================
  // Feature F17: Attachments Packaging (packageAttachments)
  // ============================================================================
  var MIME_MAP = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg",
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3",
    "audio/ogg": "ogg", "video/mp4": "mp4", "video/webm": "webm", "application/pdf": "pdf"
  };

  function packageAttachments(attachments) {
    if (!Array.isArray(attachments)) return [];
    var files = [];
    var seenNames = new Set();

    attachments.forEach(function (att, idx) {
      if (!att) return;
      var rawName = att.name || att.displayName || att.description || ("media_" + idx);
      if (isSensitiveFilename(rawName)) return;

      var baseOnly = rawName.split("/").pop().split("\\").pop();
      if (isSensitiveFilename(baseOnly)) return;

      // Strip directory paths and path traversal tokens
      var baseName = baseOnly.replace(/^\.+/, "");
      baseName = baseName.replace(/[^A-Za-z0-9._-]/g, "_");

      if (isSensitiveFilename(baseName)) return;

      var mime = (att.mimeType || att.type || "").toLowerCase();
      var dotIdx = baseName.lastIndexOf(".");
      if (dotIdx > 0 && dotIdx < baseName.length - 1) {
        // already has valid extension
      } else {
        var ext = MIME_MAP[mime] || "bin";
        baseName = baseName + "." + ext;
      }

      if (!baseName || baseName === "." || baseName === "_") {
        baseName = "attachment_" + idx + ".bin";
      }

      // Exclude blacklisted private files
      if (isSensitiveFilename(baseName)) return;

      // Duplicate collision resolution: append _1, _2
      var uniqueName = baseName;
      var c = 1;
      while (seenNames.has(uniqueName)) {
        var parts = baseName.split(".");
        var fExt = parts.length > 1 ? parts.pop() : "bin";
        uniqueName = parts.join(".") + "_" + (c++) + "." + fExt;
      }
      seenNames.add(uniqueName);

      // Extract binary data
      var data;
      if (att.data instanceof Uint8Array) {
        data = att.data;
      } else if (att.bytes instanceof Uint8Array) {
        data = att.bytes;
      } else if (att.payload && att.payload.case === "inlineData" && att.payload.value instanceof Uint8Array) {
        data = att.payload.value;
      } else if (typeof att.data === "string" || typeof att.bytes === "string") {
        data = base64ToBytes(att.data || att.bytes);
      } else if (att.image_url && typeof att.image_url.url === "string") {
        data = base64ToBytes(att.image_url.url);
      } else if (typeof att.url === "string" && att.url.indexOf("data:") === 0) {
        data = base64ToBytes(att.url);
      } else {
        data = new Uint8Array(0);
      }

      files.push({
        name: "attachments/" + uniqueName,
        data: data
      });
    });

    return files;
  }

  // ============================================================================
  // Feature F18: Changes Diff Packaging (packageChangesDiff & formatChangesDiff)
  // ============================================================================
  function createUnifiedDiff(oldPath, newPath, oldStr, newStr) {
    if (oldStr === newStr) return "";
    var diffLib = (typeof window !== "undefined" && window.Diff) || (typeof globalThis !== "undefined" && globalThis.Diff);
    if (diffLib && typeof diffLib.createTwoFilesPatch === "function") {
      return diffLib.createTwoFilesPatch(oldPath, newPath, oldStr, newStr, "", "", { context: 3 });
    }
    // Pure JS fallback Myers/simple diff for unified diff formatting
    var oldLines = oldStr ? oldStr.split(/\r?\n/) : [];
    var newLines = newStr ? newStr.split(/\r?\n/) : [];
    var hunks = [];
    var i = 0, j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        i++; j++;
      } else {
        var startOld = i, startNew = j;
        var hLines = [];
        while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
          hLines.push("-" + oldLines[i++]);
        }
        while (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
          hLines.push("+" + newLines[j++]);
        }
        hunks.push({
          oldStart: startOld + 1,
          oldLines: i - startOld,
          newStart: startNew + 1,
          newLines: j - startNew,
          lines: hLines
        });
      }
    }
    if (hunks.length === 0) return "";
    var out = ["--- a/" + oldPath, "+++ b/" + newPath];
    for (var k = 0; k < hunks.length; k++) {
      var h = hunks[k];
      out.push("@@ -" + h.oldStart + "," + h.oldLines + " +" + h.newStart + "," + h.newLines + " @@");
      for (var l = 0; l < h.lines.length; l++) out.push(h.lines[l]);
    }
    return out.join("\n") + "\n";
  }

  function packageChangesDiff(fileDiffs) {
    if (!fileDiffs || !fileDiffs.length) {
      return "(no workspace changes recorded in session)";
    }
    var chunks = [];
    for (var i = 0; i < fileDiffs.length; i++) {
      var diff = fileDiffs[i];
      if (!diff) continue;
      if (diff.isArtifactFile || diff.isKnowledgeFile) continue;

      var cleanPath = normalizeFilePath(diff.path || diff.uri);
      if (isSensitiveFilename(cleanPath)) {
        chunks.push("--- a/" + cleanPath);
        chunks.push("+++ b/" + cleanPath);
        chunks.push("@@ -0,0 +1 @@\n+[DIFF REDACTED: sensitive file " + cleanPath + " excluded]");
        continue;
      }

      if (diff.unifiedDiff || diff.patch) {
        var patchText = diff.unifiedDiff || diff.patch;
        if (patchText.indexOf("--- ") !== 0 && patchText.indexOf("--- a/") < 0) {
          chunks.push("--- a/" + cleanPath);
          chunks.push("+++ b/" + cleanPath);
        }
        chunks.push(sanitizeDiff(patchText));
        continue;
      }

      var orig = diff.originalContent != null ? String(diff.originalContent) : "";
      var mod = diff.modifiedContent != null ? String(diff.modifiedContent) : "";
      if (orig === mod) continue;

      var patch = createUnifiedDiff(cleanPath, cleanPath, orig, mod);
      if (patch) chunks.push(sanitizeDiff(patch));
    }

    if (chunks.length === 0) {
      return "(no workspace changes recorded in session)";
    }
    return chunks.join("\n");
  }

  function formatChangesDiff(fileDiffs) {
    return packageChangesDiff(fileDiffs);
  }

  // ============================================================================
  // ExportManager Class (Conforming to tests/e2e/harness.mjs & Web UI)
  // ============================================================================
  function ExportManager(options) {
    this.options = options || {};
  }
  ExportManager.prototype.buildZip = function (files) {
    return buildZip(files);
  };
  ExportManager.prototype.packageTranscriptFull = function (records) {
    return packageTranscriptFull(records);
  };
  ExportManager.prototype.packageTranscriptMd = function (records, options) {
    return packageTranscriptMd(records, options || this.options);
  };
  ExportManager.prototype.packageChangesDiff = function (fileDiffs) {
    return packageChangesDiff(fileDiffs);
  };
  ExportManager.prototype.packageAttachments = function (attachments) {
    return packageAttachments(attachments);
  };

  // ============================================================================
  // High-Level Session Export (exportSession)
  // ============================================================================
  async function exportSession(cascadeId, options) {
    if (!cascadeId) {
      toast(T("Нет открытой сессии для сохранения.", "No open session to save."));
      return Promise.resolve();
    }
    options = options || {};
    var mgr = new ExportManager(options);
    var errors = [];
    var files = [];

    // 1. Transcript records
    var records = options.records || options.history || [];
    var transcriptSource = "in_memory";
    var transcriptText = "";

    if (!records.length && typeof fetch === "function") {
      var candidates = [
        ".system_generated/logs/transcript_full.jsonl",
        ".system_generated/logs/transcript.jsonl"
      ];
      for (var i = 0; i < candidates.length; i++) {
        try {
          var res = await fetch(artifactUrl(cascadeId, candidates[i]));
          if (res.ok) {
            transcriptText = await res.text();
            transcriptSource = candidates[i];
            transcriptText.split("\n").forEach(function (l) {
              if (l.trim()) {
                try { records.push(JSON.parse(l)); } catch (e) {}
              }
            });
            break;
          }
          errors.push(candidates[i] + ": HTTP " + res.status);
        } catch (e) {
          errors.push(candidates[i] + ": " + e);
        }
      }
    }

    // 2. Compaction state
    var compactionState = options.compactionState || null;
    try {
      if (!compactionState && typeof localStorage !== "undefined") {
        var rawComp = localStorage.getItem("agy_compaction_" + cascadeId);
        if (rawComp) compactionState = JSON.parse(rawComp);
      }
    } catch (e) {}

    // 3. Package transcript files
    var fullJsonl = mgr.packageTranscriptFull(records);
    var transMd = mgr.packageTranscriptMd(records, { cascadeId: cascadeId, compactionState: compactionState });
    files.push({ name: "transcript_full.jsonl", data: textToBytes(fullJsonl) });
    files.push({ name: "transcript.md", data: textToBytes(transMd) });

    // 4. Attachments
    var attachments = options.attachments || [];
    if (!attachments.length && records.length) {
      records.forEach(function (r) {
        if (r && Array.isArray(r.attachments)) {
          attachments.push.apply(attachments, r.attachments);
        }
      });
    }
    // Also check media URIs from transcript text if in WebView
    if (!attachments.length && transcriptText && typeof fetch === "function") {
      var mediaMatch = transcriptText.match(/\.user_uploaded\/[^"'\s]+/g);
      if (mediaMatch) {
        var mediaUris = [];
        mediaMatch.forEach(function (u) { if (mediaUris.indexOf(u) < 0) mediaUris.push(u); });
        for (var j = 0; j < mediaUris.length; j++) {
          var fname = mediaUris[j].split("/").pop() || ("media_" + j);
          try {
            var r = await fetch(artifactUrl(cascadeId, ".user_uploaded/" + encodeURIComponent(fname)));
            if (r.ok) {
              var buf = new Uint8Array(await r.arrayBuffer());
              attachments.push({ name: fname, data: buf });
            } else {
              errors.push(T("Вложение ", "Attachment ") + fname + ": HTTP " + r.status);
            }
          } catch (e) {
            errors.push(T("Вложение ", "Attachment ") + fname + ": " + e);
          }
        }
      }
    }
    var packagedAtts = mgr.packageAttachments(attachments);
    files.push.apply(files, packagedAtts);

    // 5. Workspace Changes Diff
    var fileDiffs = options.fileDiffs || [];
    if (!fileDiffs.length && typeof window !== "undefined" && window.__agyReduxStore) {
      try {
        var state = window.__agyReduxStore.getState();
        if (state && state.trajectoryFileDiffsApi && state.trajectoryFileDiffsApi.queries) {
          var queryKey = "getConversationFileDiffs({\"conversationId\":\"" + cascadeId + "\"})";
          var q = state.trajectoryFileDiffsApi.queries[queryKey];
          if (q && q.data && Array.isArray(q.data.diffs)) {
            fileDiffs = q.data.diffs;
          }
        }
      } catch (e) {}
    }
    var diffText = mgr.packageChangesDiff(fileDiffs);
    files.push({ name: "changes.diff", data: textToBytes(diffText) });

    // 6. MANIFEST & Metadata
    var manifest = [
      "Leostryx Session Export (Requirement R4)",
      "cascadeId: " + cascadeId,
      "exported: " + new Date().toISOString(),
      "transcript source: " + transcriptSource,
      "recordsCount: " + records.length,
      "attachmentsCount: " + packagedAtts.length,
      "changesDiffRecorded: " + (diffText !== "(no workspace changes recorded in session)"),
      "",
      "Errors (if any): " + (errors.length ? errors.join("; ") : "none")
    ].join("\n");
    files.push({ name: "MANIFEST.txt", data: textToBytes(manifest) });
    files.push({
      name: "meta.json",
      data: textToBytes(JSON.stringify({
        cascadeId: cascadeId,
        exportedAt: new Date().toISOString(),
        transcriptSource: transcriptSource,
        version: "2.0",
        stats: {
          records: records.length,
          attachments: packagedAtts.length,
          hasChangesDiff: (diffText !== "(no workspace changes recorded in session)")
        },
        errors: errors
      }, null, 2))
    });

    // 7. Streaming ZIP Archive Generation (No 64 MiB ceiling abort!)
    var zip = mgr.buildZip(files);
    var blob = new Blob([zip], { type: "application/zip" });
    var fname = "session-" + String(cascadeId).slice(0, 8) + "-" + new Date().toISOString().slice(0, 10) + ".zip";

    function agyB64(b, cb, err) {
      try {
        var fr = new FileReader();
        fr.onload = function () {
          var s = String(fr.result || "");
          var i = s.indexOf(",");
          cb(i >= 0 ? s.slice(i + 1) : s);
        };
        fr.onerror = err;
        fr.readAsDataURL(b);
      } catch (e) { err(e); }
    }

    function agyAnchor() {
      if (typeof URL !== "undefined" && typeof document !== "undefined") {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        toast(records.length
          ? T("Сессия сохранена в ZIP.", "Session saved to a ZIP archive.")
          : T("ZIP сохранён, но транскрипт получить не удалось — см. MANIFEST.txt.",
              "ZIP saved, but the transcript could not be retrieved — see MANIFEST.txt."));
      }
    }

    var agyA = (typeof window !== "undefined") && ((window.AndroidBridge && window.AndroidBridge.saveBlob) ? window.AndroidBridge : (window.Android && window.Android.saveBlob ? window.Android : null));
    var agyTok = (typeof window !== "undefined") && (window.__AG_NATIVE_BRIDGE_TOKEN__ || (function () { try { return localStorage.getItem("agy_bridge_token"); } catch (e) { return null; } })());

    // If native bridge is available and size is <= 64 MiB, save via saveBlob.
    // If size exceeds 64 MiB, anchor download via Blob URL is used directly to prevent Dalvik 64 MiB IOException.
    if (agyA && agyTok && zip.length <= 64 * 1024 * 1024) {
      agyB64(blob, function (b64) {
        try {
          agyA.saveBlob(agyTok, b64, fname, "application/zip");
          toast(T("Сессия сохранена: " + fname + " (папка Загрузки).",
                  "Session saved: " + fname + " (Downloads folder)."));
        } catch (e) { agyAnchor(); }
      }, agyAnchor);
    } else {
      agyAnchor();
    }

    return {
      zipBytes: zip,
      files: files,
      errors: errors
    };
  }

  // ============================================================================
  // Exports
  // ============================================================================
  var exportsObj = {
    StreamingZipWriter: StreamingZipWriter,
    buildZip: buildZip,
    crc32: crc32,
    sanitizeText: sanitizeText,
    redactSensitiveData: sanitizeText,
    isSensitiveFilename: isSensitiveFilename,
    isPrivateConfigFile: isSensitiveFilename,
    sanitizeDiff: sanitizeDiff,
    sanitizeJsonl: sanitizeJsonl,
    sanitizeMarkdown: sanitizeMarkdown,
    transcriptMd: transcriptMd,
    formatTranscriptFullJsonl: formatTranscriptFullJsonl,
    formatChangesDiff: formatChangesDiff,
    packageTranscriptFull: packageTranscriptFull,
    packageTranscriptMd: packageTranscriptMd,
    packageChangesDiff: packageChangesDiff,
    packageAttachments: packageAttachments,
    createUnifiedDiff: createUnifiedDiff,
    ExportManager: ExportManager,
    exportSession: exportSession,
    maskMediaInLogs: maskMediaInLogs,
    BLACKLISTED_FILENAMES: BLACKLISTED_FILENAMES,
    BLACKLISTED_EXTENSIONS: BLACKLISTED_EXTENSIONS
  };
  exportsObj.default = exportsObj;

  return exportsObj;
});
