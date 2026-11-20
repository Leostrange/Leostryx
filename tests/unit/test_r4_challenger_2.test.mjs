/**
 * Adversarial Challenger 2 Test Suite: Milestone M4 (Requirement R4)
 * File: tests/unit/test_r4_challenger_2.test.mjs
 *
 * Empirical Challenger Verification for:
 * - Feature F17: Attachments Path Sanitization & Collision Resolution Fuzzing
 * - Feature F18: Workspace Changes Diff Formatting & Empty State Handling
 * - Feature F19: Secret & Credential Filtering Adversarial Bypass Resistance & Strict Blacklisting
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

// Load the target export session module
const exportPath = path.join(REPO_ROOT, "app/assets/web/agy_export_session.js");
const exportModule = await import("file://" + exportPath).then((m) => m.default || m);

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
  packageTranscriptFull,
  packageTranscriptMd,
  packageChangesDiff,
  packageAttachments,
  createUnifiedDiff,
  ExportManager,
  exportSession,
  BLACKLISTED_FILENAMES,
  BLACKLISTED_EXTENSIONS
} = exportModule;

// Helper: parse ZIP Central Directory and local file headers in memory
function inspectZip(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  let eocdOffset = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Invalid ZIP: EOCD not found");

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const fileMap = new Map();
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) {
      throw new Error("Invalid Central Directory header");
    }
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const uncompSize = view.getUint32(pos + 24, true);

    const nameBytes = u8.subarray(pos + 46, pos + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);

    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = u8.subarray(dataStart, dataStart + uncompSize);

    fileMap.set(name, {
      name,
      size: uncompSize,
      data,
      text: () => new TextDecoder().decode(data)
    });

    pos += 46 + nameLen + extraLen + commentLen;
  }

  return {
    totalEntries,
    hasFile: (n) => fileMap.has(n),
    getFile: (n) => fileMap.get(n),
    getFileText: (n) => fileMap.get(n)?.text(),
    fileNames: Array.from(fileMap.keys())
  };
}

// ============================================================================
// Suite 1: Adversarial Attachment Path Sanitization & Traversal Resistance (F17)
// ============================================================================
test("Suite 1: Adversarial Attachment Path Sanitization & Traversal Resistance (F17)", async (t) => {
  await t.test("fuzzes classic Unix path traversal patterns without directory escape", () => {
    const maliciousPaths = [
      "../../etc/passwd",
      "../../../../../../../../etc/shadow",
      "../../var/log/syslog",
      "....//secret.txt",
      "..../...//...//etc/passwd",
      "./././var/data.bin",
      "/etc/passwd",
      "/root/secret.txt"
    ];

    const atts = maliciousPaths.map((p, idx) => ({
      name: p,
      data: new Uint8Array([idx, idx + 1])
    }));

    const packaged = packageAttachments(atts);
    assert.equal(packaged.length, maliciousPaths.length);

    for (const item of packaged) {
      assert.ok(item.name.startsWith("attachments/"), `Must be inside attachments/: ${item.name}`);
      const relativePart = item.name.slice("attachments/".length);
      assert.ok(!relativePart.includes("/"), `Must not contain subdirectories: ${item.name}`);
      assert.ok(!relativePart.includes("\\"), `Must not contain backslashes: ${item.name}`);
      assert.ok(!relativePart.includes(".."), `Must not contain parent references: ${item.name}`);
    }
  });

  await t.test("fuzzes Windows path traversal patterns and drive letter roots", () => {
    const windowsPaths = [
      "..\\..\\windows\\win.ini",
      "C:\\Windows\\System32\\cmd.exe",
      "D:\\secret\\keys.txt",
      "..\\..\\..\\..\\boot.ini",
      "\\\\server\\share\\file.txt",
      "nested\\sub\\..\\..\\windows\\system.ini"
    ];

    const atts = windowsPaths.map((p, idx) => ({
      name: p,
      data: new Uint8Array([idx])
    }));

    const packaged = packageAttachments(atts);
    assert.equal(packaged.length, windowsPaths.length);

    for (const item of packaged) {
      assert.ok(item.name.startsWith("attachments/"), `Must be in attachments/: ${item.name}`);
      const relativePart = item.name.slice("attachments/".length);
      assert.ok(!relativePart.includes("/"), `No forward slashes: ${item.name}`);
      assert.ok(!relativePart.includes("\\"), `No backslashes: ${item.name}`);
      assert.ok(!relativePart.includes(".."), `No traversal: ${item.name}`);
      assert.ok(!relativePart.includes(":"), `No drive letter colon: ${item.name}`);
    }
  });

  await t.test("fuzzes boundary conditions: dots-only, slashes-only, and empty names", () => {
    const boundaryInputs = [
      ".",
      "..",
      "...",
      "....",
      "/////",
      "\\\\\\\\\\",
      "../",
      "..\\",
      "///..///",
      ""
    ];

    const atts = boundaryInputs.map((p, idx) => ({
      name: p,
      data: new Uint8Array([idx])
    }));

    const packaged = packageAttachments(atts);
    assert.equal(packaged.length, boundaryInputs.length);

    const names = packaged.map((p) => p.name);
    const uniqueNames = new Set(names);
    assert.equal(uniqueNames.size, boundaryInputs.length, "All boundary filenames must be unique");

    for (const n of names) {
      assert.ok(n.startsWith("attachments/"), `Must be inside attachments/: ${n}`);
      const rel = n.slice("attachments/".length);
      assert.ok(!rel.includes("/"), `No subdirectories: ${n}`);
      assert.ok(!rel.includes("\\"), `No backslashes: ${n}`);
      assert.ok(!rel.includes(".."), `No traversal: ${n}`);
    }
  });

  await t.test("fuzzes control characters, null bytes, and command injection metacharacters", () => {
    const injectionNames = [
      "image\x00.png",
      "image\r\n.png",
      "image;rm -rf /;.png",
      "image$(whoami).png",
      "image`id`.png",
      "image|calc.exe.png",
      "image<script>.png",
      "image' OR '1'='1.png",
      "   image spaced.png   "
    ];

    const atts = injectionNames.map((p, idx) => ({
      name: p,
      data: new Uint8Array([idx])
    }));

    const packaged = packageAttachments(atts);
    assert.equal(packaged.length, injectionNames.length);

    for (const item of packaged) {
      assert.ok(item.name.startsWith("attachments/"), `Must be in attachments/: ${item.name}`);
      const rel = item.name.slice("attachments/".length);
      assert.ok(!/[\0\r\n;`$|<>'"\\]/.test(rel), `Sanitized of dangerous chars: ${rel}`);
      assert.ok(!rel.includes("/"), `No directory nesting: ${rel}`);
      assert.ok(!rel.includes(".."), `No parent traversal: ${rel}`);
    }
  });
});

// ============================================================================
// Suite 2: High-Volume Attachment Collision Resolution & Integrity (F17)
// ============================================================================
test("Suite 2: High-Volume Attachment Collision Resolution & Integrity (F17)", async (t) => {
  await t.test("resolves 60 identically named attachments (image.png) into 60 unique non-colliding files", () => {
    const N = 60;
    const atts = [];
    for (let i = 0; i < N; i++) {
      atts.push({
        name: "image.png",
        data: new Uint8Array([i, (i * 3) % 256, (i * 7) % 256])
      });
    }

    const packaged = packageAttachments(atts);
    assert.equal(packaged.length, N);

    const names = packaged.map((p) => p.name);
    const uniqueSet = new Set(names);
    assert.equal(uniqueSet.size, N, "Every single attachment filename must be completely unique");

    assert.equal(names[0], "attachments/image.png");
    assert.equal(names[1], "attachments/image_1.png");
    assert.equal(names[2], "attachments/image_2.png");
    assert.equal(names[N - 1], `attachments/image_${N - 1}.png`);
  });

  await t.test("correctly resolves interleaved pre-existing numbered suffixes without collision", () => {
    const inputs = [
      "photo.png",
      "photo_1.png",
      "photo_2.png",
      "photo.png",
      "photo_1.png",
      "photo_3.png",
      "photo.png",
      "photo_2.png"
    ];

    const atts = inputs.map((name, idx) => ({
      name,
      data: new Uint8Array([idx])
    }));

    const packaged = packageAttachments(atts);
    assert.equal(packaged.length, inputs.length);

    const names = packaged.map((p) => p.name);
    const uniqueSet = new Set(names);
    assert.equal(uniqueSet.size, inputs.length, "Zero collisions despite interleaved numbered names");

    for (const n of names) {
      assert.ok(n.startsWith("attachments/"));
      assert.ok(n.endsWith(".png"));
    }
  });

  await t.test("preserves multi-dot extensions during collision numbering (archive.tar.gz)", () => {
    const atts = [
      { name: "archive.tar.gz", data: new Uint8Array([1]) },
      { name: "archive.tar.gz", data: new Uint8Array([2]) },
      { name: "archive.tar.gz", data: new Uint8Array([3]) }
    ];

    const packaged = packageAttachments(atts);
    assert.equal(packaged.length, 3);
    assert.equal(packaged[0].name, "attachments/archive.tar.gz");
    assert.equal(packaged[1].name, "attachments/archive.tar_1.gz");
    assert.equal(packaged[2].name, "attachments/archive.tar_2.gz");
  });

  await t.test("preserves binary payload byte-for-byte across collision-renamed attachments in ZIP", () => {
    const N = 25;
    const atts = [];
    for (let i = 0; i < N; i++) {
      const payload = new Uint8Array([0xaa, 0xbb, i, (i * 13) % 256]);
      atts.push({ name: "data.bin", data: payload });
    }

    const packaged = packageAttachments(atts);
    const zipBytes = buildZip(packaged);
    const parsed = inspectZip(zipBytes);

    assert.equal(parsed.totalEntries, N);
    for (let i = 0; i < N; i++) {
      const expectedName = i === 0 ? "attachments/data.bin" : `attachments/data_${i}.bin`;
      assert.ok(parsed.hasFile(expectedName), `Missing entry ${expectedName}`);
      const entry = parsed.getFile(expectedName);
      assert.deepEqual(entry.data, new Uint8Array([0xaa, 0xbb, i, (i * 13) % 256]));
    }
  });
});

// ============================================================================
// Suite 3: Secret Redaction Adversarial Bypass Attacks (Feature F19)
// ============================================================================
test("Suite 3: Secret Redaction Adversarial Bypass Attacks (Feature F19)", async (t) => {
  await t.test("resists unusual whitespace bypass attempts (multiple spaces, tabs, newline colons)", () => {
    const testCases = [
      {
        input: "Authorization:     Bearer     eyJhbGciOiJIUzI1NiJ9.test.sig",
        check: (out) => !out.includes("eyJhbGci") && out.includes("Authorization:     [REDACTED]")
      },
      {
        input: "Authorization:\t\tBearer\t\tmy_secret_token_12345678",
        check: (out) => !out.includes("my_secret_token_12345678") && out.includes("Authorization:\t\t[REDACTED]")
      },
      {
        input: 'api_key   :   "sk-secret-abcdef1234567890123456"',
        check: (out) => !out.includes("sk-secret-abcdef") && out.includes("[REDACTED]")
      },
      {
        input: 'client_secret  =  "secret_client_val_99999"',
        check: (out) => !out.includes("secret_client_val_99999") && out.includes("[REDACTED]")
      },
      {
        input: 'password   :   "UltraSecretPassword123!"',
        check: (out) => !out.includes("UltraSecretPassword123!") && out.includes("[REDACTED]")
      },
      {
        input: 'OPENAI_API_KEY   =   "sk-proj-1234567890abcdef123456"',
        check: (out) => !out.includes("sk-proj-1234567890abcdef123456") && out.includes("[REDACTED]")
      }
    ];

    for (const tc of testCases) {
      const sanitized = sanitizeText(tc.input);
      assert.ok(tc.check(sanitized), `Failed to redact whitespace variation: ${tc.input} => ${sanitized}`);
    }
  });

  await t.test("resists mixed-case and casing permutation bypass attempts", () => {
    const casingInputs = [
      "bEaReR  my_token_value_abcdefgh12345",
      "BEARER  UPPERCASE_TOKEN_VAL_1234567",
      "AUTHORIZATION: BEARER lower_tok_abcdef12345",
      'PassWord = "CaseSensitivePass123!"',
      'ApI_kEy: "my-custom-key-case-test"',
      'cLiEnT_sEcReT: "client-secret-case-test"'
    ];

    for (const inp of casingInputs) {
      const out = sanitizeText(inp);
      assert.ok(!out.includes("my_token_value_abcdefgh12345"), `Token leaked: ${inp}`);
      assert.ok(!out.includes("UPPERCASE_TOKEN_VAL_1234567"), `Token leaked: ${inp}`);
      assert.ok(!out.includes("lower_tok_abcdef12345"), `Token leaked: ${inp}`);
      assert.ok(!out.includes("CaseSensitivePass123!"), `Password leaked: ${inp}`);
      assert.ok(!out.includes("my-custom-key-case-test"), `API key leaked: ${inp}`);
      assert.ok(!out.includes("client-secret-case-test"), `Client secret leaked: ${inp}`);
    }
  });

  await t.test("resists URL-encoded and query parameter credential bypasses", () => {
    const url1 = sanitizeText("https://api.openai.com/v1?api_key=sk-12345678901234567890&model=gpt-4");
    assert.ok(!url1.includes("sk-12345678901234567890"));
    assert.ok(url1.includes("api_key=[REDACTED]"));
    assert.ok(url1.includes("model=gpt-4"));

    const url2 = sanitizeText("https://oauth.example.com/callback?access_token=ya29.secretToken123&token=secretTok456");
    assert.ok(!url2.includes("ya29.secretToken123"));
    assert.ok(!url2.includes("secretTok456"));
    assert.ok(url2.includes("access_token=[REDACTED]"));
    assert.ok(url2.includes("token=[REDACTED]"));

    const url3 = sanitizeText("https://service.internal/auth?secret=ultraSecretKey&user=alice");
    assert.ok(!url3.includes("ultraSecretKey"));
    assert.ok(url3.includes("secret=[REDACTED]"));
    assert.ok(url3.includes("user=alice"));

    const url4 = sanitizeText("https://db.internal?password=SuperSecretPass&ssl=true");
    assert.ok(!url4.includes("SuperSecretPass"));
    assert.ok(url4.includes("password=[REDACTED]"));
    assert.ok(url4.includes("ssl=true"));

    const url5 = sanitizeText("https://api.service.io/v1/data?client_secret=topSecretSecret&scope=all");
    assert.ok(!url5.includes("topSecretSecret"));
    assert.ok(url5.includes("client_secret=[REDACTED]"));
    assert.ok(url5.includes("scope=all"));
  });

  await t.test("redacts embedded credentials across diverse database and protocol connection URIs", () => {
    const uris = [
      "postgres://admin:SuperSecretPass123@db.prod.internal:5432/main",
      "postgresql://readonly:P%40ssw%3Ard!@10.0.0.1:5432/analytics",
      "mysql://root:toor1234@127.0.0.1:3306/app",
      "mongodb://app_user:MongoPass456!@cluster0.mongodb.net/test",
      "mongodb+srv://admin:AdminSecretPass@cluster0.mongodb.net/production",
      "redis://:RedisPass789@redis-cache:6379",
      "amqp://guest:guest123@rabbitmq.internal:5672/vhost",
      "https://user:SuperSecretToken@github.com/org/repo.git",
      "http://root:toor1234@192.168.1.1/setup"
    ];

    for (const uri of uris) {
      const out = sanitizeText(uri);
      assert.ok(!out.includes("SuperSecretPass123"), `Postgres password leaked: ${uri}`);
      assert.ok(!out.includes("P%40ssw%3Ard!"), `Postgres encoded pass leaked: ${uri}`);
      assert.ok(!out.includes("toor1234"), `MySQL / HTTP root pass leaked: ${uri}`);
      assert.ok(!out.includes("MongoPass456!"), `Mongo pass leaked: ${uri}`);
      assert.ok(!out.includes("AdminSecretPass"), `Mongo+srv pass leaked: ${uri}`);
      assert.ok(!out.includes("RedisPass789"), `Redis pass leaked: ${uri}`);
      assert.ok(!out.includes("guest123"), `RabbitMQ pass leaked: ${uri}`);
      assert.ok(!out.includes("SuperSecretToken"), `HTTPS git pass leaked: ${uri}`);
      assert.ok(out.includes(":[REDACTED]@"), `Must contain sanitized marker: ${out}`);
    }
  });

  await t.test("redacts multi-line diff injections containing vendor API keys and secrets", () => {
    const multiLineDiff = `
diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,12 +10,12 @@
-const apiKey = "";
+const apiKey = "sk-proj-1234567890abcdef1234567890";
+const anthropicKey = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
+const geminiKey = "AIzaSyA1234567890abcdefghijklmnopqrstuv";
+const githubPat = "github_pat_11AAAAAAA01234567890abcdefghijklmnopqrstuvwxyz01234567890abcdefghijklmnopqrstuvwxyz";
+const awsKey = "AKIAIOSFODNN7EXAMPLE";
+const dbUri = "postgres://root:ProdSecretDbPass@db:5432/main";
    return true;
`;

    const out = sanitizeDiff(multiLineDiff);
    assert.ok(!out.includes("sk-proj-1234567890abcdef1234567890"));
    assert.ok(!out.includes("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"));
    assert.ok(!out.includes("AIzaSyA1234567890abcdefghijklmnopqrstuv"));
    assert.ok(!out.includes("github_pat_11AAAAAAA"));
    assert.ok(!out.includes("AKIAIOSFODNN7EXAMPLE"));
    assert.ok(!out.includes("ProdSecretDbPass"));

    // Verify diff formatting is preserved
    assert.ok(out.includes("diff --git a/src/config.ts b/src/config.ts"));
    assert.ok(out.includes("--- a/src/config.ts"));
    assert.ok(out.includes("+++ b/src/config.ts"));
    assert.ok(out.includes("@@ -10,12 +10,12 @@"));
    assert.ok(out.includes("+const apiKey = \"[REDACTED]\";"));
  });

  await t.test("preserves technical identifiers and natural language without false positives", () => {
    const benignCode = `
      // Commit: b6681b8e5c7e738b91dc8982a0fc8ac1e2582d1d
      function getKeyName(keyId) {
        const keyManager = new KeyManager();
        return keyManager.findKey(keyId);
      }
      class TokenBucketLimiter {
        tokensPerSecond = 50;
      }
      const note = "He was the bearer of great news";
    `;

    const out = sanitizeText(benignCode);
    assert.ok(out.includes("b6681b8e5c7e738b91dc8982a0fc8ac1e2582d1d"));
    assert.ok(out.includes("function getKeyName(keyId)"));
    assert.ok(out.includes("class TokenBucketLimiter"));
    assert.ok(out.includes("bearer of great news"));
  });
});

// ============================================================================
// Suite 4: Strict Multi-Channel Omission of Blacklisted Files (Feature F19)
// ============================================================================
test("Suite 4: Strict Multi-Channel Omission of Blacklisted Files (Feature F19)", async (t) => {
  const targetBlacklist = [
    ".env",
    ".env.local",
    "id_rsa",
    "server.pem",
    "prod.key",
    "release.keystore",
    "app.jks",
    "credentials.json"
  ];

  await t.test("isSensitiveFilename identifies all 8 required blacklisted files", () => {
    for (const f of targetBlacklist) {
      assert.equal(isSensitiveFilename(f), true, `Failed to recognize ${f} as sensitive`);
    }
  });

  await t.test("isSensitiveFilename handles case variations and subdirectories", () => {
    const variants = [
      "config/.env",
      "config/nested/.env.local",
      "keys/sub/id_rsa",
      "certs/SERVER.PEM",
      "security/PROD.KEY",
      "android/app/Release.Keystore",
      "android/app/APP.JKS",
      "auth/Credentials.JSON",
      ".env.development",
      ".env.production",
      ".env.staging",
      ".env.test"
    ];

    for (const v of variants) {
      assert.equal(isSensitiveFilename(v), true, `Failed on variant: ${v}`);
    }
  });

  await t.test("strictly omits blacklisted files from attachments packaging", () => {
    const atts = targetBlacklist.map((f, idx) => ({
      name: f,
      data: new Uint8Array([idx, 0xff])
    }));

    // Add 2 benign attachments to verify selective filtering
    atts.push({ name: "diagram.png", data: new Uint8Array([1, 2, 3]) });
    atts.push({ name: "notes.txt", data: new Uint8Array([4, 5, 6]) });

    const packaged = packageAttachments(atts);
    assert.equal(packaged.length, 2, "Only the 2 benign files should be packaged");
    assert.equal(packaged[0].name, "attachments/diagram.png");
    assert.equal(packaged[1].name, "attachments/notes.txt");

    for (const p of packaged) {
      for (const bad of targetBlacklist) {
        assert.ok(!p.name.includes(bad), `Leaked blacklisted attachment: ${p.name}`);
      }
    }
  });

  await t.test("strictly redacts blacklisted files in packageChangesDiff", () => {
    const diffs = targetBlacklist.map((f) => ({
      path: `sub/${f}`,
      originalContent: `SECRET_ORIG_${f}=12345\n`,
      modifiedContent: `SECRET_MOD_${f}=67890\n`
    }));

    // Add a benign file
    diffs.push({
      path: "src/main.js",
      originalContent: "console.log('old');\n",
      modifiedContent: "console.log('new');\n"
    });

    const diffText = packageChangesDiff(diffs);

    for (const f of targetBlacklist) {
      assert.ok(!diffText.includes(`SECRET_ORIG_${f}`), `Leaked original content of ${f}`);
      assert.ok(!diffText.includes(`SECRET_MOD_${f}`), `Leaked modified content of ${f}`);
      assert.ok(diffText.includes(`[DIFF REDACTED: sensitive file sub/${f} excluded]`), `Missing redaction header for ${f}`);
    }

    // Benign diff is intact
    assert.ok(diffText.includes("--- a/src/main.js"));
    assert.ok(diffText.includes("+++ b/src/main.js"));
    assert.ok(diffText.includes("+console.log('new');"));
  });

  await t.test("strictly omits blacklisted files from buildZip archive generation", () => {
    const directFiles = [
      { name: "public.txt", data: "public info" },
      { name: ".env", data: "AWS_SECRET=123" },
      { name: ".env.local", data: "LOCAL_SECRET=456" },
      { name: "keys/id_rsa", data: "PRIVATE_RSA_KEY" },
      { name: "server.pem", data: "CERTIFICATE" },
      { name: "prod.key", data: "PROD_PRIVATE_KEY" },
      { name: "release.keystore", data: new Uint8Array([1, 2, 3]) },
      { name: "app.jks", data: new Uint8Array([4, 5, 6]) },
      { name: "credentials.json", data: "{\"user\":\"admin\"}" }
    ];

    const zipBytes = buildZip(directFiles);
    const parsed = inspectZip(zipBytes);

    assert.equal(parsed.totalEntries, 1);
    assert.ok(parsed.hasFile("public.txt"));
    for (const f of targetBlacklist) {
      assert.ok(!parsed.hasFile(f), `Direct file leaked in ZIP: ${f}`);
      assert.ok(!parsed.hasFile(`keys/${f}`), `Subdir file leaked in ZIP: keys/${f}`);
    }
  });
});

// ============================================================================
// Suite 5: Workspace Changes Diff Formatting & Boundary Conditions (Feature F18)
// ============================================================================
test("Suite 5: Workspace Changes Diff Formatting & Boundary Conditions (F18)", async (t) => {
  await t.test("generates compliant unified diff for additions, deletions, and modifications", () => {
    // 1. Addition (new file without trailing newline)
    const addDiff = createUnifiedDiff("new_file.js", "new_file.js", "", "const x = 1;\nconsole.log(x);");
    assert.ok(addDiff.startsWith("--- a/new_file.js\n+++ b/new_file.js\n"));
    assert.ok(addDiff.includes("@@ -1,0 +1,2 @@"));
    assert.ok(addDiff.includes("+const x = 1;"));
    assert.ok(addDiff.includes("+console.log(x);"));

    // 2. Deletion (removed file)
    const delDiff = createUnifiedDiff("old_file.js", "old_file.js", "line1\nline2", "");
    assert.ok(delDiff.startsWith("--- a/old_file.js\n+++ b/old_file.js\n"));
    assert.ok(delDiff.includes("@@ -1,2 +1,0 @@"));
    assert.ok(delDiff.includes("-line1"));
    assert.ok(delDiff.includes("-line2"));

    // 3. Modification
    const modDiff = createUnifiedDiff(
      "mod_file.js",
      "mod_file.js",
      "line1\nline2\nline3",
      "line1\nline2_changed\nline3"
    );
    assert.ok(modDiff.startsWith("--- a/mod_file.js\n+++ b/mod_file.js\n"));
    assert.ok(modDiff.includes("-line2"));
    assert.ok(modDiff.includes("+line2_changed"));
  });

  await t.test("handles empty and no-change diff scenarios returning standard placeholder", () => {
    const expectedPlaceholder = "(no workspace changes recorded in session)";

    // 1. Empty array
    assert.equal(packageChangesDiff([]), expectedPlaceholder);

    // 2. Null and undefined
    assert.equal(packageChangesDiff(null), expectedPlaceholder);
    assert.equal(packageChangesDiff(undefined), expectedPlaceholder);

    // 3. Array of unchanged files (identical content)
    const identicalDiffs = [
      { path: "a.js", originalContent: "const a = 1;\n", modifiedContent: "const a = 1;\n" },
      { path: "b.js", originalContent: "", modifiedContent: "" }
    ];
    assert.equal(packageChangesDiff(identicalDiffs), expectedPlaceholder);

    // 4. Array containing only artifact files or knowledge files
    const nonWorkspaceDiffs = [
      { isArtifactFile: true, path: "meta.json", originalContent: "1", modifiedContent: "2" },
      { isKnowledgeFile: true, path: "docs.md", originalContent: "a", modifiedContent: "b" }
    ];
    assert.equal(packageChangesDiff(nonWorkspaceDiffs), expectedPlaceholder);
  });

  await t.test("packages multi-file diffs and normalizes file URI paths", () => {
    const diffs = [
      {
        path: "file:///storage/emulated/0/Documents/project/src/index.js",
        originalContent: "var a = 1;\n",
        modifiedContent: "var a = 2;\n"
      },
      {
        path: "/storage/emulated/0/Documents/app/utils.js",
        originalContent: "export const PI = 3;\n",
        modifiedContent: "export const PI = 3.14159;\n"
      }
    ];

    const result = packageChangesDiff(diffs);
    assert.ok(result.includes("--- a/project/src/index.js") || result.includes("--- a/src/index.js"));
    assert.ok(result.includes("--- a/app/utils.js") || result.includes("--- a/utils.js"));
    assert.ok(!result.includes("file://"), "file:// prefix must be stripped");
    assert.ok(!result.includes("/storage/emulated/0/Documents/"), "Android Documents prefix stripped");
  });

  await t.test("full exportSession integration with attachments, diffs, and secrets", async () => {
    const sessionRecords = [
      {
        role: "user",
        content: "Please check postgres connection postgres://user:secretpass123@db.prod:5432/main",
        attachments: [
          { name: "report.pdf", data: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
          { name: "../../etc/passwd", data: new Uint8Array([0x70, 0x77, 0x64]) },
          { name: ".env", data: new Uint8Array([0x65, 0x6e, 0x76]) }
        ]
      },
      {
        role: "assistant",
        content: "Here is your API key: sk-proj-1234567890abcdef123456"
      }
    ];

    const fileDiffs = [
      { path: "src/server.ts", originalContent: "const port = 3000;\n", modifiedContent: "const port = 8080;\n" },
      { path: ".env.production", originalContent: "SECRET=1\n", modifiedContent: "SECRET=2\n" }
    ];

    const res = await exportSession("test-cascade-123", {
      records: sessionRecords,
      fileDiffs: fileDiffs
    });

    assert.ok(res.zipBytes instanceof Uint8Array);
    const parsed = inspectZip(res.zipBytes);

    // 1. Transcripts are present and sanitized
    assert.ok(parsed.hasFile("transcript_full.jsonl"));
    assert.ok(parsed.hasFile("transcript.md"));
    const fullJsonl = parsed.getFileText("transcript_full.jsonl");
    assert.ok(!fullJsonl.includes("secretpass123"));
    assert.ok(!fullJsonl.includes("sk-proj-1234567890abcdef123456"));

    // 2. Attachments: benign is present, traversal sanitized, blacklisted (.env) dropped
    assert.ok(parsed.hasFile("attachments/report.pdf"));
    assert.ok(parsed.hasFile("attachments/passwd.bin"));
    assert.ok(!parsed.hasFile("attachments/.env"));
    assert.ok(!parsed.fileNames.some((n) => n.includes("..")));

    // 3. Changes diff: benign diff is included, .env.production is redacted
    assert.ok(parsed.hasFile("changes.diff"));
    const diffContent = parsed.getFileText("changes.diff");
    assert.ok(diffContent.includes("--- a/src/server.ts"));
    assert.ok(!diffContent.includes("SECRET=2"));
    assert.ok(diffContent.includes("[DIFF REDACTED: sensitive file .env.production excluded]"));

    // 4. Manifest and Meta are present
    assert.ok(parsed.hasFile("MANIFEST.txt"));
    assert.ok(parsed.hasFile("meta.json"));
  });
});
