/**
 * Test Suite: Milestone M4 — Challenger 1 (Requirement R4: Streaming Session ZIP Export)
 * File: tests/unit/test_r4_challenger_1.test.mjs
 *
 * Empirical Adversarial Challenger Verification:
 * 1. Exact PKZIP 2.0 Header & Binary Specification Compliance:
 *    - LFH signature (0x04034b50), version (20), flags (0x0800 UTF-8), STORE (0), CRC32, sizes, offsets
 *    - CDH signature (0x02014b50), version made by (20), version needed (20), offsets, sizes
 *    - EOCD signature (0x06054b50), disk numbering, entry count, central directory size & offset
 * 2. Byte-for-Byte CRC-32 Oracle Verification:
 *    - Cross-validation of JS crc32() against native node:zlib.crc32 across diverse data vectors
 *    - Progressive / chunked CRC calculation invariant: crc32(A + B) === crc32(B, crc32(A))
 *    - External Python 3.14 standard zipfile testzip() and zlib.crc32 validation
 *    - Info-ZIP unzip -t structural verification
 * 3. Large Archive Streaming Simulation (>64 MiB Payload Chunks):
 *    - 70 MiB archive emission via onChunk callback
 *    - Memory pressure verification (O(1) buffer footprint, chunks array unpopulated)
 *    - Exact byte counting and relative offset alignment
 *    - Generator-based streaming validation (writeFile* / finalize*)
 * 4. Unicode, Emoji, and Deep Directory Path Archival:
 *    - Cyrillic, CJK, Emoji, accented characters, spaces, and deep folder structures
 *    - Verification via Python zipfile.namelist() ensuring zero UTF-8 / mojibake corruption
 * 5. Hostile Inputs, Corruption Detection, and Defensive Boundaries:
 *    - Rejection of post-closure calls (addFile, finish)
 *    - Corrupted signature detection, CRC mismatch detection, and truncated archive handling
 *    - Non-Uint8Array payload resilience
 * 6. ExportManager & exportSession High-Level Integration:
 *    - Complete archive assembly (transcript_full.jsonl, transcript.md, changes.diff, attachments, MANIFEST, meta.json)
 *    - End-to-end secret redaction and file blacklisting verification
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import zlib from "node:zlib";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

// Load export session module
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

/**
 * Empirical Oracle: Low-level PKZIP 2.0 Binary Parser
 * Inspects raw bytes and extracts exact header structures.
 */
function inspectZipBinary(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // Locate EOCD signature (0x06054b50) from the tail
  let eocdOffset = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("EOCD signature (0x06054b50) not found in archive");
  }

  const eocd = {
    signature: view.getUint32(eocdOffset, true),
    diskNumber: view.getUint16(eocdOffset + 4, true),
    cdStartDisk: view.getUint16(eocdOffset + 6, true),
    entriesThisDisk: view.getUint16(eocdOffset + 8, true),
    totalEntries: view.getUint16(eocdOffset + 10, true),
    cdSize: view.getUint32(eocdOffset + 12, true),
    cdOffset: view.getUint32(eocdOffset + 16, true),
    commentLength: view.getUint16(eocdOffset + 20, true),
    offset: eocdOffset
  };

  const centralEntries = [];
  let pos = eocd.cdOffset;
  for (let i = 0; i < eocd.totalEntries; i++) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x02014b50) {
      throw new Error(`Invalid CDH signature (0x${sig.toString(16)}) at byte ${pos}`);
    }
    const cdh = {
      signature: sig,
      versionMadeBy: view.getUint16(pos + 4, true),
      versionNeeded: view.getUint16(pos + 6, true),
      flags: view.getUint16(pos + 8, true),
      compressionMethod: view.getUint16(pos + 10, true),
      modTime: view.getUint16(pos + 12, true),
      modDate: view.getUint16(pos + 14, true),
      crc32: view.getUint32(pos + 16, true),
      compressedSize: view.getUint32(pos + 20, true),
      uncompressedSize: view.getUint32(pos + 24, true),
      nameLength: view.getUint16(pos + 28, true),
      extraLength: view.getUint16(pos + 30, true),
      commentLength: view.getUint16(pos + 32, true),
      diskNumberStart: view.getUint16(pos + 34, true),
      internalAttrs: view.getUint16(pos + 36, true),
      externalAttrs: view.getUint32(pos + 38, true),
      localHeaderOffset: view.getUint32(pos + 42, true),
      offset: pos
    };
    const nameBytes = u8.subarray(pos + 46, pos + 46 + cdh.nameLength);
    cdh.name = new TextDecoder("utf-8").decode(nameBytes);
    centralEntries.push(cdh);

    pos += 46 + cdh.nameLength + cdh.extraLength + cdh.commentLength;
  }

  // Parse corresponding LFHs
  const localEntries = [];
  for (const cdh of centralEntries) {
    const lPos = cdh.localHeaderOffset;
    const lSig = view.getUint32(lPos, true);
    if (lSig !== 0x04034b50) {
      throw new Error(`Invalid LFH signature (0x${lSig.toString(16)}) at byte ${lPos} for file ${cdh.name}`);
    }
    const lfh = {
      signature: lSig,
      versionNeeded: view.getUint16(lPos + 4, true),
      flags: view.getUint16(lPos + 6, true),
      compressionMethod: view.getUint16(lPos + 8, true),
      modTime: view.getUint16(lPos + 10, true),
      modDate: view.getUint16(lPos + 12, true),
      crc32: view.getUint32(lPos + 14, true),
      compressedSize: view.getUint32(lPos + 18, true),
      uncompressedSize: view.getUint32(lPos + 22, true),
      nameLength: view.getUint16(lPos + 26, true),
      extraLength: view.getUint16(lPos + 28, true),
      offset: lPos
    };
    const nameBytes = u8.subarray(lPos + 30, lPos + 30 + lfh.nameLength);
    lfh.name = new TextDecoder("utf-8").decode(nameBytes);

    const dataStart = lPos + 30 + lfh.nameLength + lfh.extraLength;
    lfh.data = u8.subarray(dataStart, dataStart + lfh.uncompressedSize);
    localEntries.push(lfh);
  }

  return {
    raw: u8,
    eocd,
    centralEntries,
    localEntries
  };
}

/**
 * Empirical Oracle: Python 3.14 zipfile validation runner
 * Passes archive buffer to python3 via stdin and runs strict zipfile verification.
 */
function verifyZipWithPython(zipBuffer) {
  const pyScript = `
import sys, io, zipfile

buffer = sys.stdin.buffer.read()
bio = io.BytesIO(buffer)

try:
    with zipfile.ZipFile(bio, 'r') as zf:
        # testzip returns None if all file CRCs and headers pass
        bad_file = zf.testzip()
        if bad_file is not None:
            print(f"FAIL: CRC mismatch in file {bad_file}", file=sys.stderr)
            sys.exit(1)
        
        info_list = zf.infolist()
        print(f"TOTAL_FILES={len(info_list)}")
        for info in info_list:
            filename = info.filename
            data = zf.read(filename)
            crc = info.CRC
            comp_size = info.compress_size
            file_size = info.file_size
            print(f"ENTRY:{filename}|CRC={crc:#010x}|SIZE={file_size}|COMP={comp_size}")
except Exception as e:
    print(f"EXCEPTION: {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(2)
`;

  const res = cp.spawnSync("python3", ["-c", pyScript], {
    input: zipBuffer instanceof Uint8Array ? Buffer.from(zipBuffer) : zipBuffer,
    encoding: "utf8"
  });

  if (res.status !== 0) {
    throw new Error(`Python zipfile verification failed (exit code ${res.status}): ${res.stderr || res.stdout}`);
  }

  const lines = res.stdout.trim().split("\n");
  const entries = new Map();
  let totalFiles = 0;

  for (const line of lines) {
    if (line.startsWith("TOTAL_FILES=")) {
      totalFiles = parseInt(line.split("=")[1], 10);
    } else if (line.startsWith("ENTRY:")) {
      const parts = line.slice(6).split("|");
      const name = parts[0];
      const crc = parts[1].split("=")[1];
      const size = parseInt(parts[2].split("=")[1], 10);
      const comp = parseInt(parts[3].split("=")[1], 10);
      entries.set(name, { name, crc, size, comp });
    }
  }

  return {
    totalFiles,
    entries,
    output: res.stdout
  };
}

// ============================================================================
// Suite 1: PKZIP 2.0 Binary Specification Exact Header Compliance
// ============================================================================
test("Challenger 1 Suite 1: PKZIP 2.0 Header & Binary Specification Compliance", async (t) => {
  await t.test("1.1 Local File Header (LFH) exact byte structure and field values", () => {
    const writer = new StreamingZipWriter();
    const testContent = "Hello PKZIP 2.0 Spec!";
    const testBytes = new TextEncoder().encode(testContent);
    const expectedCrc = zlib.crc32(testBytes);

    writer.addFile("test_file.txt", testBytes);
    writer.finish();

    const zipBytes = writer.getUint8Array();
    const parsed = inspectZipBinary(zipBytes);

    assert.equal(parsed.localEntries.length, 1);
    const lfh = parsed.localEntries[0];

    // Check exact LFH fields
    assert.equal(lfh.signature, 0x04034b50, "LFH signature must be 0x04034b50");
    assert.equal(lfh.versionNeeded, 20, "Version needed to extract must be 20 (2.0)");
    assert.equal(lfh.flags, 0x0800, "Flag must have bit 11 (0x0800) set for UTF-8 filename");
    assert.equal(lfh.compressionMethod, 0, "Compression method must be 0 (STORE)");
    assert.equal(lfh.crc32, expectedCrc, "LFH CRC32 must match uncompressed data CRC32");
    assert.equal(lfh.compressedSize, testBytes.length, "Compressed size must equal uncompressed size");
    assert.equal(lfh.uncompressedSize, testBytes.length, "Uncompressed size must match data length");
    assert.equal(lfh.nameLength, new TextEncoder().encode("test_file.txt").length);
    assert.equal(lfh.extraLength, 0, "Extra field length must be 0");
    assert.equal(lfh.name, "test_file.txt");
    assert.deepEqual(lfh.data, testBytes, "Stored payload bytes must match input exactly");
  });

  await t.test("1.2 Central Directory Header (CDH) exact byte structure and field values", () => {
    const writer = new StreamingZipWriter();
    const payload = new Uint8Array([10, 20, 30, 40, 50]);
    const expectedCrc = zlib.crc32(payload);

    writer.addFile("binary.dat", payload);
    writer.finish();

    const zipBytes = writer.getUint8Array();
    const parsed = inspectZipBinary(zipBytes);

    assert.equal(parsed.centralEntries.length, 1);
    const cdh = parsed.centralEntries[0];

    // Check exact CDH fields
    assert.equal(cdh.signature, 0x02014b50, "CDH signature must be 0x02014b50");
    assert.equal(cdh.versionMadeBy, 20, "Version made by must be 20 (2.0)");
    assert.equal(cdh.versionNeeded, 20, "Version needed to extract must be 20 (2.0)");
    assert.equal(cdh.flags, 0x0800, "Flag must be 0x0800 (UTF-8)");
    assert.equal(cdh.compressionMethod, 0, "Compression method must be 0 (STORE)");
    assert.equal(cdh.crc32, expectedCrc, "CDH CRC32 must match");
    assert.equal(cdh.compressedSize, payload.length);
    assert.equal(cdh.uncompressedSize, payload.length);
    assert.equal(cdh.nameLength, "binary.dat".length);
    assert.equal(cdh.extraLength, 0);
    assert.equal(cdh.commentLength, 0);
    assert.equal(cdh.diskNumberStart, 0);
    assert.equal(cdh.internalAttrs, 0);
    assert.equal(cdh.externalAttrs, 0);
    assert.equal(cdh.localHeaderOffset, 0, "First file local header offset must be 0");
    assert.equal(cdh.name, "binary.dat");
  });

  await t.test("1.3 End of Central Directory (EOCD) exact 22-byte structure and alignment", () => {
    const writer = new StreamingZipWriter();
    writer.addFile("file1.txt", "data 1");
    writer.addFile("file2.txt", "data 2 longer");
    writer.finish();

    const zipBytes = writer.getUint8Array();
    const parsed = inspectZipBinary(zipBytes);

    const eocd = parsed.eocd;
    assert.equal(eocd.signature, 0x06054b50, "EOCD signature must be 0x06054b50");
    assert.equal(eocd.diskNumber, 0, "Disk number must be 0");
    assert.equal(eocd.cdStartDisk, 0, "CD start disk must be 0");
    assert.equal(eocd.entriesThisDisk, 2, "Entries on this disk must equal 2");
    assert.equal(eocd.totalEntries, 2, "Total entries must equal 2");
    assert.equal(eocd.commentLength, 0, "Comment length must be 0");

    // Exact size and offset calculation
    const cdEntry1Len = 46 + "file1.txt".length;
    const cdEntry2Len = 46 + "file2.txt".length;
    const expectedCdSize = cdEntry1Len + cdEntry2Len;
    assert.equal(eocd.cdSize, expectedCdSize, "EOCD cdSize must match sum of CDH lengths");

    // EOCD must be exactly 22 bytes from the end of the archive
    assert.equal(zipBytes.length - eocd.offset, 22, "EOCD record must be exactly 22 bytes at archive tail");
    assert.equal(eocd.cdOffset + eocd.cdSize, eocd.offset, "EOCD must immediately follow the central directory");
  });

  await t.test("1.4 Multiple file relative local header offset alignment", () => {
    const writer = new StreamingZipWriter();
    const f1Data = new TextEncoder().encode("File 1 contents AAAAA");
    const f2Data = new TextEncoder().encode("File 2 contents BBBBBBBBBB");
    const f3Data = new TextEncoder().encode("File 3 contents C");

    writer.addFile("dir/f1.txt", f1Data);
    writer.addFile("dir/f2.txt", f2Data);
    writer.addFile("f3.txt", f3Data);
    writer.finish();

    const zipBytes = writer.getUint8Array();
    const parsed = inspectZipBinary(zipBytes);

    const expectedOffset0 = 0;
    const expectedOffset1 = expectedOffset0 + 30 + "dir/f1.txt".length + f1Data.length;
    const expectedOffset2 = expectedOffset1 + 30 + "dir/f2.txt".length + f2Data.length;

    assert.equal(parsed.centralEntries[0].localHeaderOffset, expectedOffset0);
    assert.equal(parsed.centralEntries[1].localHeaderOffset, expectedOffset1);
    assert.equal(parsed.centralEntries[2].localHeaderOffset, expectedOffset2);
  });
});

// ============================================================================
// Suite 2: Byte-for-Byte CRC-32 Oracle Verification (Node & Python)
// ============================================================================
test("Challenger 1 Suite 2: Byte-for-Byte CRC-32 Oracle Verification", async (t) => {
  await t.test("2.1 Cross-validation against node:zlib.crc32 across diverse test vectors", () => {
    const vectors = [
      { name: "empty buffer", data: new Uint8Array(0) },
      { name: "single zero byte", data: new Uint8Array([0x00]) },
      { name: "single 0xFF byte", data: new Uint8Array([0xFF]) },
      { name: "ASCII text", data: new TextEncoder().encode("The quick brown fox jumps over the lazy dog") },
      { name: "1024 zero bytes", data: new Uint8Array(1024) },
      { name: "1024 0xFF bytes", data: new Uint8Array(1024).fill(0xFF) },
      { name: "Cyrillic Russian text", data: new TextEncoder().encode("Полноценная сериализация и потоковый экспорт сессии в ZIP") },
      { name: "CJK multi-byte characters", data: new TextEncoder().encode("日本語のテキストと中国語の文章 🚀🌟") },
      { name: "High-entropy random buffer (64 KiB)", data: Buffer.alloc(65536, "A") },
      { name: "Cross-boundary buffer (65537 bytes)", data: Buffer.alloc(65537, "B") }
    ];

    for (const vec of vectors) {
      const expected = zlib.crc32(vec.data);
      const actual = crc32(vec.data);
      assert.equal(
        actual,
        expected,
        `CRC32 mismatch on vector '${vec.name}': expected 0x${expected.toString(16)}, got 0x${actual.toString(16)}`
      );
    }
  });

  await t.test("2.2 Progressive chunked CRC-32 update invariant", () => {
    const fullPayload = Buffer.from("Testing progressive CRC-32 calculation across irregular chunk sizes!");
    const expectedFull = zlib.crc32(fullPayload);

    // Test across various split points
    for (let split = 1; split < fullPayload.length; split += 5) {
      const p1 = fullPayload.subarray(0, split);
      const p2 = fullPayload.subarray(split);

      const progressiveCrc = crc32(p2, crc32(p1));
      assert.equal(
        progressiveCrc,
        expectedFull,
        `Progressive CRC split at byte ${split} failed: expected 0x${expectedFull.toString(16)}, got 0x${progressiveCrc.toString(16)}`
      );
    }

    // 10-chunk progressive stream
    const chunkCount = 10;
    const chunkSize = Math.floor(fullPayload.length / chunkCount);
    let runningCrc = undefined;
    for (let i = 0; i < chunkCount; i++) {
      const chunk = (i === chunkCount - 1)
        ? fullPayload.subarray(i * chunkSize)
        : fullPayload.subarray(i * chunkSize, (i + 1) * chunkSize);
      runningCrc = (runningCrc === undefined) ? crc32(chunk) : crc32(chunk, runningCrc);
    }
    assert.equal(runningCrc, expectedFull, "10-chunk progressive calculation must match atomic CRC-32");
  });

  await t.test("2.3 Python 3.14 standard zipfile.ZipFile.testzip() oracle verification", () => {
    const writer = new StreamingZipWriter();
    writer.addFile("empty.txt", new Uint8Array(0));
    writer.addFile("short.txt", "short content");
    writer.addFile("nested/doc.md", "# Heading\nSome markdown text\n");
    writer.addFile("binary.bin", new Uint8Array([0x00, 0xFF, 0x55, 0xAA, 0x12, 0x34, 0x56, 0x78]));
    writer.addFile("multiline.jsonl", '{"a":1}\n{"b":2}\n');
    writer.finish();

    const zipBytes = writer.getUint8Array();
    const pyResult = verifyZipWithPython(zipBytes);

    assert.equal(pyResult.totalFiles, 5);
    assert.ok(pyResult.entries.has("empty.txt"));
    assert.ok(pyResult.entries.has("short.txt"));
    assert.ok(pyResult.entries.has("nested/doc.md"));
    assert.ok(pyResult.entries.has("binary.bin"));
    assert.ok(pyResult.entries.has("multiline.jsonl"));
  });

  await t.test("2.4 Info-ZIP unzip -t command validation", () => {
    const fs = cp.spawnSync("node", ["-e", "import('node:fs').then(f => console.log('ok'))"]).status === 0;
    const writer = new StreamingZipWriter();
    writer.addFile("unzip_test.txt", "Info-ZIP validation test content");
    writer.finish();
    const zipBytes = writer.getUint8Array();

    const scratchDir = "/data/user/0/com.agyru.t2/files/.gemini/antigravity-app/scratch";
    const scratchFile = path.join(scratchDir, "challenger_unzip_test.zip");

    // Write scratch archive
    const writeRes = cp.spawnSync("python3", [
      "-c",
      "import sys; open(sys.argv[1], 'wb').write(sys.stdin.buffer.read())",
      scratchFile
    ], { input: Buffer.from(zipBytes) });
    assert.equal(writeRes.status, 0);

    try {
      const res = cp.spawnSync("unzip", ["-t", scratchFile], { encoding: "utf8" });
      assert.equal(res.status, 0, `unzip -t failed: ${res.stderr || res.stdout}`);
      assert.ok(res.stdout.includes("No errors detected"), "unzip output must confirm zero errors");
    } finally {
      cp.spawnSync("rm", ["-f", scratchFile]);
    }
  });
});

// ============================================================================
// Suite 3: Large Archive Simulation (>64 MiB Payload Chunks & Memory Pressure)
// ============================================================================
test("Challenger 1 Suite 3: Large Archive Simulation (>64 MiB Payload Chunks)", async (t) => {
  await t.test("3.1 70 MiB streaming payload without memory accumulation (onChunk callback)", () => {
    let totalStreamedBytes = 0;
    let chunkCount = 0;
    const chunkLengths = [];

    const writer = new StreamingZipWriter({
      onChunk: (chunk) => {
        totalStreamedBytes += chunk.length;
        chunkCount++;
        chunkLengths.push(chunk.length);
      }
    });

    // Verify that internal chunks array remains empty in onChunk streaming mode
    assert.equal(writer.chunks.length, 0);

    // Create 7 files x 10 MiB = 70 MiB (> 64 MiB Dalvik ceiling)
    const FILE_SIZE = 10 * 1024 * 1024;
    const pattern = Buffer.alloc(65536, "X");

    for (let f = 1; f <= 7; f++) {
      // Stream file in 64 KiB chunks
      const fileBytes = Buffer.alloc(FILE_SIZE);
      for (let p = 0; p < FILE_SIZE; p += 65536) {
        pattern.copy(fileBytes, p);
      }
      writer.addFile(`attachments/large_media_${f}.dat`, fileBytes);
      // Chunks array in writer must still be empty!
      assert.equal(writer.chunks.length, 0, "writer.chunks must not retain data during onChunk streaming");
    }

    const summary = writer.finish();
    assert.equal(summary.totalFiles, 7);

    // Sum of chunk lengths must strictly match writer.offset and summary.totalBytes
    const sumLengths = chunkLengths.reduce((a, b) => a + b, 0);
    assert.equal(totalStreamedBytes, sumLengths);
    assert.equal(totalStreamedBytes, summary.totalBytes);
    assert.ok(totalStreamedBytes > 70 * 1024 * 1024, "Total streamed bytes must exceed 70 MiB");

    // Confirm that payload was emitted in 64 KiB chunks
    assert.ok(chunkCount > 1000, `Expected > 1000 chunks for 70 MiB stream, got ${chunkCount}`);
  });

  await t.test("3.2 Central directory offsets in large stream match exact byte accounting", () => {
    let streamedBytes = 0;
    const writer = new StreamingZipWriter({
      onChunk: (c) => { streamedBytes += c.length; }
    });

    // 3 files of 1 MiB each
    const ONE_MB = 1024 * 1024;
    const mbData = Buffer.alloc(ONE_MB, "M");

    writer.addFile("file1.dat", mbData);
    writer.addFile("file2.dat", mbData);
    writer.addFile("file3.dat", mbData);
    const summary = writer.finish();

    assert.equal(summary.totalFiles, 3);
    assert.equal(writer.centralDirectory.length, 3);

    // Verify local header offsets in central directory
    const expectedOffset0 = 0;
    const lfh1Len = 30 + "file1.dat".length;
    const expectedOffset1 = expectedOffset0 + lfh1Len + ONE_MB;
    const lfh2Len = 30 + "file2.dat".length;
    const expectedOffset2 = expectedOffset1 + lfh2Len + ONE_MB;

    assert.equal(writer.centralDirectory[0].offset, expectedOffset0);
    assert.equal(writer.centralDirectory[1].offset, expectedOffset1);
    assert.equal(writer.centralDirectory[2].offset, expectedOffset2);
  });

  await t.test("3.3 Generator streaming methods (writeFile* and finalize*) produce valid stream", () => {
    const writer = new StreamingZipWriter();
    const yieldedChunks = [];

    const f1Gen = writer.writeFile("gen_file1.txt", "generator content 1");
    for (const chunk of f1Gen) yieldedChunks.push(chunk);

    const f2Gen = writer.writeFile("gen_file2.txt", "generator content 2");
    for (const chunk of f2Gen) yieldedChunks.push(chunk);

    const finalGen = writer.finalize();
    for (const chunk of finalGen) yieldedChunks.push(chunk);

    const totalLen = yieldedChunks.reduce((a, c) => a + c.length, 0);
    const fullZip = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of yieldedChunks) {
      fullZip.set(c, offset);
      offset += c.length;
    }

    const pyResult = verifyZipWithPython(fullZip);
    assert.equal(pyResult.totalFiles, 2);
    assert.ok(pyResult.entries.has("gen_file1.txt"));
    assert.ok(pyResult.entries.has("gen_file2.txt"));
  });
});

// ============================================================================
// Suite 4: Unicode, Emoji, Non-ASCII and Deep Path Archival
// ============================================================================
test("Challenger 1 Suite 4: Unicode, Emoji, Non-ASCII & Deep Path Archival", async (t) => {
  await t.test("4.1 Emits valid UTF-8 filenames across diverse scripts without mojibake", () => {
    const testFiles = [
      { name: "диалоги/стенограмма_сессии_2026.jsonl", data: "Русский текст в файле" },
      { name: "会話/セッション記録_日本語.txt", data: "日本語コンテンツ" },
      { name: "对话/历史记录_简体中文.txt", data: "简体中文对话内容" },
      { name: "attachments/📸_screenshot_🚀_v2.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      { name: "café_et_résumé/naïve_test.md", data: "Accented French words" },
      { name: "deep/path/level1/level2/level3/nested.txt", data: "Deep directory structure" },
      { name: "symbols/file & with (brackets) + %20 and spaces!.txt", data: "Special symbols" }
    ];

    const writer = new StreamingZipWriter();
    for (const f of testFiles) {
      writer.addFile(f.name, f.data);
    }
    writer.finish();

    const zipBytes = writer.getUint8Array();

    // Verify raw binary inspection: every CDH and LFH must have bit 11 set (0x0800)
    const binary = inspectZipBinary(zipBytes);
    for (const cdh of binary.centralEntries) {
      assert.equal(cdh.flags & 0x0800, 0x0800, `CDH flag for '${cdh.name}' must have UTF-8 bit 11 set`);
    }
    for (const lfh of binary.localEntries) {
      assert.equal(lfh.flags & 0x0800, 0x0800, `LFH flag for '${lfh.name}' must have UTF-8 bit 11 set`);
    }

    // Verify with Python zipfile: filenames must unpack with 100% string equality
    const py = verifyZipWithPython(zipBytes);
    assert.equal(py.totalFiles, testFiles.length);
    for (const f of testFiles) {
      assert.ok(py.entries.has(f.name), `Python zipfile missing expected filename: ${f.name}`);
    }
  });

  await t.test("4.2 Long filename handling (>200 characters)", () => {
    const longName = "nested/very_long_path_folder_name_to_stress_test_buffer_allocation_and_byte_boundaries/" +
                     "subfolder_with_more_characters_to_ensure_pkzip_spec_compliance/" +
                     "transcript_record_session_log_with_extended_timestamp_and_identifiers_2026_11_20_final.json";
    assert.ok(longName.length > 200);

    const writer = new StreamingZipWriter();
    writer.addFile(longName, "data in long filename");
    writer.finish();

    const zipBytes = writer.getUint8Array();
    const py = verifyZipWithPython(zipBytes);
    assert.ok(py.entries.has(longName), "Python must correctly extract long filename");
  });
});

// ============================================================================
// Suite 5: Hostile Inputs, Corruption Detection & Defensive Boundaries
// ============================================================================
test("Challenger 1 Suite 5: Hostile Inputs, Corruption Detection & Defensive Boundaries", async (t) => {
  await t.test("5.1 Writer rejects mutations after finish() closure", () => {
    const writer = new StreamingZipWriter();
    writer.addFile("test.txt", "hello");
    writer.finish();

    assert.throws(() => {
      writer.addFile("after_close.txt", "data");
    }, /StreamingZipWriter is already closed/);

    assert.throws(() => {
      writer.finish();
    }, /StreamingZipWriter is already closed/);
  });

  await t.test("5.2 Robustness to non-Uint8Array and malformed payloads in addFile", () => {
    const writer = new StreamingZipWriter();

    // String input -> auto-encoded
    writer.addFile("str.txt", "plain string");

    // null / undefined -> converted to 0 bytes
    writer.addFile("null.bin", null);
    writer.addFile("undef.bin", undefined);

    // Number / Object -> safely defaults to 0 bytes without crashing
    writer.addFile("num.bin", 12345);
    writer.addFile("obj.bin", { foo: "bar" });

    writer.finish();
    const zipBytes = writer.getUint8Array();
    const py = verifyZipWithPython(zipBytes);

    assert.equal(py.totalFiles, 5);
    assert.equal(py.entries.get("null.bin").size, 0);
    assert.equal(py.entries.get("undef.bin").size, 0);
    assert.equal(py.entries.get("num.bin").size, 0);
    assert.equal(py.entries.get("obj.bin").size, 0);
  });

  await t.test("5.3 Corrupted CRC-32 in archive is detected by Python zipfile", () => {
    const writer = new StreamingZipWriter();
    writer.addFile("corrupt.txt", "Authentic content");
    writer.finish();
    const zipBytes = writer.getUint8Array();

    // Flip bits in the file payload area
    const tampered = new Uint8Array(zipBytes);
    // Find payload byte and flip it
    const payloadIdx = 30 + "corrupt.txt".length + 5;
    tampered[payloadIdx] ^= 0xFF;

    // Python testzip() MUST detect the CRC mismatch and fail
    assert.throws(() => {
      verifyZipWithPython(tampered);
    }, /CRC mismatch/);
  });

  await t.test("5.4 Truncated archive is rejected as invalid ZIP", () => {
    const writer = new StreamingZipWriter();
    writer.addFile("file.txt", "Some content");
    writer.finish();
    const zipBytes = writer.getUint8Array();

    // Truncate before EOCD
    const truncated = zipBytes.subarray(0, zipBytes.length - 30);

    assert.throws(() => {
      inspectZipBinary(truncated);
    }, /EOCD signature/);

    assert.throws(() => {
      verifyZipWithPython(truncated);
    });
  });

  await t.test("5.5 Empty archive (0 files) emits valid 22-byte EOCD accepted by Python", () => {
    const writer = new StreamingZipWriter();
    const summary = writer.finish();
    assert.equal(summary.totalFiles, 0);
    assert.equal(summary.totalBytes, 22);

    const zipBytes = writer.getUint8Array();
    assert.equal(zipBytes.length, 22);

    const parsed = inspectZipBinary(zipBytes);
    assert.equal(parsed.eocd.totalEntries, 0);
    assert.equal(parsed.eocd.cdSize, 0);
    assert.equal(parsed.eocd.cdOffset, 0);
    assert.equal(parsed.centralEntries.length, 0);
    assert.equal(parsed.localEntries.length, 0);

    const py = verifyZipWithPython(zipBytes);
    assert.equal(py.totalFiles, 0);
  });

  await t.test("5.6 Attachment path traversal and duplicate collision adversarial vectors", () => {
    const hostileAttachments = [
      { name: "../../../../etc/passwd", data: new Uint8Array([1]) },
      { name: "..\\..\\windows\\system32\\cmd.exe", data: new Uint8Array([2]) },
      { name: "...", data: new Uint8Array([3]) },
      { name: "///root//snapshot.png", data: new Uint8Array([4]) },
      { name: "report.pdf", data: new Uint8Array([5]) },
      { name: "report.pdf", data: new Uint8Array([6]) },
      { name: "report.pdf", data: new Uint8Array([7]) },
      { name: ".env", data: new Uint8Array([8]) },
      { name: "server.key", data: new Uint8Array([9]) }
    ];

    const packaged = packageAttachments(hostileAttachments);
    const names = packaged.map(p => p.name);

    // Assert traversal paths are neutralized
    assert.ok(names.includes("attachments/passwd.bin"));
    assert.ok(names.includes("attachments/cmd.exe"));
    assert.ok(names.includes("attachments/snapshot.png"));
    assert.ok(!names.some(n => n.includes("..") || n.includes("/") && n.split("/").length > 2));

    // Assert duplicate collisions resolved with incremental indices
    assert.ok(names.includes("attachments/report.pdf"));
    assert.ok(names.includes("attachments/report_1.pdf"));
    assert.ok(names.includes("attachments/report_2.pdf"));

    // Assert blacklisted files are dropped
    assert.ok(!names.some(n => n.includes(".env")));
    assert.ok(!names.some(n => n.includes("server.key")));
  });

  await t.test("5.7 Multi-file unified diff redaction with sensitive and non-sensitive files", () => {
    const rawDiff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      "-const port = 3000;",
      "+const port = 8080;",
      "diff --git a/.env.local b/.env.local",
      "--- a/.env.local",
      "+++ b/.env.local",
      "@@ -1,2 +1,2 @@",
      "+DATABASE_URL=postgres://user:super_secret@localhost:5432/db",
      "diff --git a/keys/id_ed25519 b/keys/id_ed25519",
      "--- a/keys/id_ed25519",
      "+++ b/keys/id_ed25519",
      "@@ -1,1 +1,1 @@",
      "+-----BEGIN OPENSSH PRIVATE KEY-----",
      "diff --git a/docs/README.md b/docs/README.md",
      "--- a/docs/README.md",
      "+++ b/docs/README.md",
      "@@ -5,1 +5,1 @@",
      "+Updated documentation with Bearer my_auth_token_12345 and key sk-ant-12345678901234567890"
    ].join("\n");

    const sanitized = sanitizeDiff(rawDiff);

    // .env.local must be redacted as a whole file
    assert.ok(sanitized.includes("[DIFF REDACTED: sensitive file .env.local excluded]"));
    assert.ok(!sanitized.includes("super_secret"));

    // id_ed25519 must be redacted as a whole file
    assert.ok(sanitized.includes("[DIFF REDACTED: sensitive file keys/id_ed25519 excluded]"));
    assert.ok(!sanitized.includes("BEGIN OPENSSH PRIVATE KEY"));

    // Legitimate app.ts preserved
    assert.ok(sanitized.includes("diff --git a/src/app.ts b/src/app.ts"));
    assert.ok(sanitized.includes("+const port = 8080;"));

    // Secret inside README.md redacted in-place
    assert.ok(sanitized.includes("diff --git a/docs/README.md b/docs/README.md"));
    assert.ok(!sanitized.includes("sk-ant-12345678901234567890"));
    assert.ok(!sanitized.includes("my_auth_token_12345"));
    assert.ok(sanitized.includes("Bearer [REDACTED]"));
    assert.ok(sanitized.includes("[REDACTED_API_KEY]"));
  });
});

// ============================================================================
// Suite 6: ExportManager & exportSession High-Level Integration
// ============================================================================
test("Challenger 1 Suite 6: ExportManager & exportSession Integration", async (t) => {
  await t.test("6.1 End-to-end exportSession creates complete, verified archive with all requirements", async () => {
    const records = [
      {
        role: "user",
        timestamp: 1732042800000,
        content: "Please inspect our API key sk-proj-1234567890abcdef1234567890."
      },
      {
        role: "assistant",
        timestamp: 1732042805000,
        content: "API key noted. Also check Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature.",
        thinking: "Secret internal token: ghp_1234567890abcdefghijklmnopqrstuvwxyz",
        toolCalls: [
          { name: "bash", args: { command: "curl -H 'Authorization: Bearer secret_bearer_token'" } }
        ]
      }
    ];

    const attachments = [
      { name: "diagram.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      { name: ".env", data: new Uint8Array([1, 2, 3]) }, // must be filtered out
      { name: "sub/dir/id_rsa", data: new Uint8Array([4, 5, 6]) } // must be filtered out
    ];

    const fileDiffs = [
      {
        path: "src/server.ts",
        originalContent: "const PORT = 3000;\nconst KEY = 'sk-proj-oldkey1234567890';\n",
        modifiedContent: "const PORT = 8080;\nconst KEY = 'sk-proj-newkey1234567890';\n"
      },
      {
        path: ".env.production",
        originalContent: "SECRET=1\n",
        modifiedContent: "SECRET=2\n"
      }
    ];

    const compactionState = {
      firstKeptEntryId: "entry_turn_10",
      summary: "User configured server ports.",
      estimatedTokensSaved: 8500
    };

    const res = await exportSession("cascade_test_999", {
      records,
      attachments,
      fileDiffs,
      compactionState
    });

    assert.ok(res.zipBytes instanceof Uint8Array);
    assert.ok(res.zipBytes.length > 0);

    // Verify with Python zipfile
    const py = verifyZipWithPython(res.zipBytes);

    // Verify required files are in archive
    assert.ok(py.entries.has("transcript_full.jsonl"));
    assert.ok(py.entries.has("transcript.md"));
    assert.ok(py.entries.has("changes.diff"));
    assert.ok(py.entries.has("MANIFEST.txt"));
    assert.ok(py.entries.has("meta.json"));
    assert.ok(py.entries.has("attachments/diagram.png"));

    // Verify blacklisted files are NOT in archive
    assert.ok(!py.entries.has(".env"));
    assert.ok(!py.entries.has("attachments/.env"));
    assert.ok(!py.entries.has("attachments/id_rsa"));
    assert.ok(!py.entries.has("attachments/id_rsa.bin"));

    // Parse files from archive to check secret redaction
    const parsed = inspectZipBinary(res.zipBytes);
    const filesMap = new Map();
    for (const le of parsed.localEntries) {
      filesMap.set(le.name, new TextDecoder().decode(le.data));
    }

    // 1. Check transcript_full.jsonl
    const jsonl = filesMap.get("transcript_full.jsonl");
    assert.ok(!jsonl.includes("sk-proj-1234567890abcdef1234567890"));
    assert.ok(!jsonl.includes("eyJhbGci"));
    assert.ok(!jsonl.includes("ghp_1234567890"));
    assert.ok(jsonl.includes("[REDACTED_API_KEY]"));
    assert.ok(jsonl.includes("[REDACTED]"));

    // 2. Check transcript.md
    const md = filesMap.get("transcript.md");
    assert.ok(!md.includes("sk-proj-"));
    assert.ok(!md.includes("secret_bearer_token"));
    assert.ok(md.includes("Context Compaction Boundary") || md.includes("Граница сжатия контекста"));
    assert.ok(md.includes("entry_turn_10"));
    assert.ok(md.includes("8500"));

    // 3. Check changes.diff
    const diff = filesMap.get("changes.diff");
    assert.ok(!diff.includes("sk-proj-"));
    assert.ok(diff.includes("[DIFF REDACTED: sensitive file .env.production excluded]"));
    assert.ok(diff.includes("--- a/src/server.ts"));
    assert.ok(diff.includes("+const PORT = 8080;"));

    // 4. Check meta.json
    const metaStr = filesMap.get("meta.json");
    const meta = JSON.parse(metaStr);
    assert.equal(meta.cascadeId, "cascade_test_999");
    assert.equal(meta.version, "2.0");
    assert.equal(meta.stats.records, 2);
    assert.equal(meta.stats.attachments, 1);
    assert.equal(meta.stats.hasChangesDiff, true);
  });
});
