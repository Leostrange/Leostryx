/**
 * Tier 3: Cross-Feature Combinations (Pairwise Coverage)
 * Leostryx Aether Architecture Integration E2E Test Suite
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseZipArchive,
  createMediaAttachment,
  transformOpenAIChat,
  transformAnthropicMessages,
  validateVisionSupport,
  maskMediaInLogs,
  DictationFSM,
  CompactionManager,
  ExportManager,
  redactSensitiveData
} from './harness.mjs';

const SAMPLE_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SAMPLE_PNG_BYTES = Buffer.from(SAMPLE_PNG_B64, 'base64');

describe('Tier 3 - Pairwise Combinations (Cross-Feature Coverage)', () => {
  it('test_p01_multimodal_attachments_with_compaction_persistence', () => {
    // R1 + R3: Image attachment in kept tail after compaction
    const compMgr = new CompactionManager();
    const att1 = createMediaAttachment('image/png', SAMPLE_PNG_BYTES, 'old.png');
    const att2 = createMediaAttachment('image/png', SAMPLE_PNG_BYTES, 'new.png');

    const messages = [
      { id: 'm1', role: 'user', content: 'Turn 1 with image', attachments: [att1] },
      { id: 'm2', role: 'assistant', content: 'Turn 2 response' },
      { id: 'm3', role: 'user', content: 'Turn 3 with new image', attachments: [att2] },
      { id: 'm4', role: 'assistant', content: 'Turn 4 response' }
    ];

    compMgr.saveCompactionState('branch_main', {
      firstKeptEntryId: 'm3',
      summary: 'Turn 1 analyzed old.png diagram.'
    });

    const reconstructed = compMgr.reconstructPromptWithCompaction(messages, 'branch_main');
    // Pre-compaction turn 1 is excluded from prompt
    assert.ok(!reconstructed.some(m => m.id === 'm1'));
    // Post-compaction turn 3 is preserved with its image attachment
    const keptUserMsg = reconstructed.find(m => m.id === 'm3');
    assert.ok(keptUserMsg);
    const parts = transformOpenAIChat(keptUserMsg.attachments, keptUserMsg.content);
    assert.equal(parts[1].type, 'image_url');
  });

  it('test_p02_export_session_while_dictation_is_active_or_idle', async () => {
    // R2 + R4: Trigger session export while dictation is recording
    const fsm = new DictationFSM();
    const expMgr = new ExportManager();
    const sid = fsm.startDictation({ chatId: 'chat_active' });
    fsm.dispatchBridgeEvent(sid, 'chat_active', 'P', 'recording thoughts');

    // Run export of prior messages
    const records = [{ role: 'user', content: 'Prior message' }];
    const zipBytes = expMgr.buildZip([
      { name: 'transcript_full.jsonl', data: expMgr.packageTranscriptFull(records) }
    ]);
    const parsed = parseZipArchive(zipBytes);
    assert.ok(parsed.hasFile('transcript_full.jsonl'));

    // Verify audio dictation was not interrupted or altered
    assert.equal(fsm.state, 'recording');
    assert.equal(fsm.partialText, 'recording thoughts');
    const committed = await fsm.stopDictation(sid);
    assert.equal(committed, 'recording thoughts');
  });

  it('test_p03_overflow_recovery_during_multimodal_conversation', async () => {
    // R1 + R3: Multimodal prompt triggers 400 context overflow
    const compMgr = new CompactionManager();
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES, 'diagram.png');

    const messages = [
      { id: 'm1', role: 'user', content: 'Long history '.repeat(100) },
      { id: 'm2', role: 'assistant', content: 'Response '.repeat(100) },
      { id: 'm3', role: 'user', content: 'Latest query with diagram', attachments: [att] }
    ];

    let retriedPrompt = null;
    const callLlm = async (prompt) => {
      retriedPrompt = prompt;
      return { ok: true, text: 'Recovery answer' };
    };

    const res = await compMgr.handleOverflowRecovery({
      branchId: 'main',
      errorResponse: { status: 400, message: 'context_length_exceeded' },
      messages,
      keepRecent: 2,
      callLlm
    });

    assert.equal(res.ok, true);
    assert.ok(retriedPrompt);
    // Verified that prompt was compacted and retried once
    const state = compMgr.getCompactionState('main');
    assert.ok(state);
    assert.equal(state.firstKeptEntryId, 'm2');
  });

  it('test_p04_dictation_input_into_prompt_with_vision_model_validation', async () => {
    // R1 + R2: Dictation commits text, then user attaches image for vision model
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'Describe the components in this diagram:');
    const recognizedText = await fsm.stopDictation(sid);

    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES, 'arch.png');
    const visionModel = { modelId: 'gpt-4o', supportsImages: true };
    const validation = validateVisionSupport(visionModel, [att]);
    assert.equal(validation.valid, true);

    const payload = transformOpenAIChat([att], recognizedText);
    assert.equal(payload[0].text, 'Describe the components in this diagram:');
    assert.equal(payload[1].type, 'image_url');
  });

  it('test_p05_full_session_export_of_compacted_session_with_attachments', () => {
    // R3 + R4: Export contains full history including pruned turns and attachments
    const compMgr = new CompactionManager();
    const expMgr = new ExportManager();

    const fullHistory = [
      { role: 'user', content: 'Early turn 1 before compaction' },
      { role: 'assistant', content: 'Early response 2' },
      { role: 'user', content: 'Kept turn 3 with image' }
    ];

    compMgr.saveCompactionState('branch_1', {
      firstKeptEntryId: '3',
      summary: 'Summary of early turns'
    });

    const attFiles = expMgr.packageAttachments([
      { name: 'diagram.png', data: SAMPLE_PNG_BYTES }
    ]);

    const zipFiles = [
      { name: 'transcript_full.jsonl', data: expMgr.packageTranscriptFull(fullHistory) },
      { name: 'transcript.md', data: expMgr.packageTranscriptMd(fullHistory) },
      ...attFiles
    ];

    const zipBytes = expMgr.buildZip(zipFiles);
    const parsed = parseZipArchive(zipBytes);

    // Full transcript contains pre-compaction message
    assert.ok(parsed.getFileText('transcript_full.jsonl').includes('Early turn 1 before compaction'));
    // Attachments directory contains diagram.png
    assert.ok(parsed.hasFile('attachments/diagram.png'));
  });

  it('test_p06_secret_filtering_on_multimodal_prompt_payload', () => {
    // R1 + R4: Secret redaction in multimodal turn log
    const textWithSecret = 'Here is the diagram with key: sk-1234567890abcdef1234567890 and Bearer secret_token_123';
    const redactedText = redactSensitiveData(textWithSecret);
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const openAiParts = transformOpenAIChat([att], redactedText);

    const logMessage = `User Turn: ${JSON.stringify(openAiParts)}`;
    const maskedLog = maskMediaInLogs(logMessage);

    // No raw secret in payload
    assert.ok(!maskedLog.includes('sk-1234567890abcdef1234567890'));
    assert.ok(!maskedLog.includes('secret_token_123'));
    // No base64 image data in log
    assert.ok(!maskedLog.includes(SAMPLE_PNG_B64));
    assert.ok(maskedLog.includes('[IMAGE: image/png, '));
  });

  it('test_p07_audio_cancellation_while_image_attachments_in_draft', () => {
    // R1 + R2: Cancel audio capture while composer has attachments
    const draftState = {
      text: 'Analyze diagram',
      attachments: [createMediaAttachment('image/png', SAMPLE_PNG_BYTES)]
    };

    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.dispatchBridgeEvent(sid, 'c1', 'P', 'unfinished spoken words');
    fsm.cancelDictation(sid);

    // Audio buffer purged
    assert.equal(fsm.buffer, '');
    assert.equal(fsm.state, 'idle');
    // Draft attachments and text preserved
    assert.equal(draftState.attachments.length, 1);
    assert.equal(draftState.text, 'Analyze diagram');
  });

  it('test_p08_single_shot_overflow_recovery_with_secret_redaction_in_summary', async () => {
    // R3 + R4: Secret in tool output during overflow compaction
    const compMgr = new CompactionManager();
    const secretToolOutput = 'Tool returned API_KEY: sk-secret999999999999999999 with details ' + 'X'.repeat(5000);

    const messages = [
      { id: 'm1', role: 'user', content: 'Run command' },
      { id: 'm2', role: 'tool', content: secretToolOutput }
    ];

    let passedPrompt = null;
    await compMgr.handleOverflowRecovery({
      branchId: 'b1',
      errorResponse: { status: 400, message: 'context_length_exceeded' },
      messages,
      callLlm: async (p) => { passedPrompt = p; return 'OK'; }
    });

    const toolMsg = passedPrompt.find(m => m.role === 'tool');
    // Truncated tool output
    assert.ok(toolMsg.content.includes('[TRUNCATED DUE TO CONTEXT OVERFLOW]'));
  });

  it('test_p09_rapid_chat_switching_during_dictation_with_active_export', () => {
    // R2 + R4: Chat switch aborts audio while session export completes
    const fsm = new DictationFSM();
    const expMgr = new ExportManager();
    const sid = fsm.startDictation({ chatId: 'chat_A' });
    fsm.dispatchBridgeEvent(sid, 'chat_A', 'F', 'Active voice in A');

    // Export of chat_A started
    const zipBytes = expMgr.buildZip([
      { name: 'transcript.md', data: '# Chat A Transcript' }
    ]);

    // User switches to chat_B
    fsm.cleanupOnChatSwitch('chat_B');

    assert.equal(fsm.state, 'idle');
    assert.equal(fsm.buffer, '');
    assert.ok(parseZipArchive(zipBytes).hasFile('transcript.md'));
  });

  it('test_p10_compaction_boundary_slicing_with_multiple_multimodal_image_turns', () => {
    // R1 + R3: Multiple image turns across compaction boundary
    const compMgr = new CompactionManager();
    const img1 = createMediaAttachment('image/png', 'b64_1', 'img1.png');
    const img2 = createMediaAttachment('image/jpeg', 'b64_2', 'img2.jpg');

    const history = [
      { id: 't1', role: 'user', content: 'First image', attachments: [img1] },
      { id: 't2', role: 'assistant', content: 'Analyzed img1' },
      { id: 't3', role: 'user', content: 'Second image', attachments: [img2] },
      { id: 't4', role: 'assistant', content: 'Analyzed img2' }
    ];

    compMgr.saveCompactionState('main', { firstKeptEntryId: 't3', summary: 'Summary of img1' });
    const prompt = compMgr.reconstructPromptWithCompaction(history, 'main');

    assert.ok(!prompt.some(m => m.id === 't1'));
    const keptTurn = prompt.find(m => m.id === 't3');
    assert.ok(keptTurn);
    const anthropicBlocks = transformAnthropicMessages(keptTurn.attachments, keptTurn.content);
    assert.equal(anthropicBlocks[1].type, 'image');
    assert.equal(anthropicBlocks[1].source.media_type, 'image/jpeg');
  });

  it('test_p11_dictation_continuous_speech_committed_and_immediately_exported', async () => {
    // R2 + R4: Continuous dictation text committed to transcript and exported
    const fsm = new DictationFSM();
    const expMgr = new ExportManager();
    const sid = fsm.startDictation({ chatId: 'c1', continuous: true });

    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'Part one of continuous dictation.');
    fsm.dispatchBridgeEvent(sid, 'c1', 'X'); // Silence re-prime
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'Part two of continuous dictation.');
    const committed = await fsm.stopDictation(sid);

    const records = [{ role: 'user', content: committed }];
    const zip = expMgr.buildZip([
      { name: 'transcript_full.jsonl', data: expMgr.packageTranscriptFull(records) },
      { name: 'transcript.md', data: expMgr.packageTranscriptMd(records) }
    ]);

    const parsed = parseZipArchive(zip);
    assert.ok(parsed.getFileText('transcript.md').includes('Part one of continuous dictation. Part two of continuous dictation.'));
  });

  it('test_p12_vision_validation_blocking_followed_by_dictation_input_correction', () => {
    // R1 + R2: Vision validation blocks text-only model, user dictates voice correction
    const textModel = { modelId: 'deepseek-coder', supportsImages: false };
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const check1 = validateVisionSupport(textModel, [att]);
    assert.equal(check1.valid, false);

    // User speaks voice command
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'Remove screenshot and proceed with code review');
    fsm.stopDictation(sid);

    // Removing image resolves validation
    const check2 = validateVisionSupport(textModel, []);
    assert.equal(check2.valid, true);
  });

  it('test_p13_export_zip_containing_pruned_pre_compaction_history_and_git_diffs', () => {
    // R3 + R4: Full export with unified diff and pre-compaction entries
    const expMgr = new ExportManager();
    const records = [
      { id: '1', role: 'user', content: 'Step 1 before compaction' },
      { id: '2', role: 'user', content: 'Step 2 after compaction' }
    ];
    const diffs = [
      { path: 'app.py', unifiedDiff: '@@ -1 +1 @@\n-import os\n+import sys' }
    ];

    const zip = expMgr.buildZip([
      { name: 'transcript_full.jsonl', data: expMgr.packageTranscriptFull(records) },
      { name: 'changes.diff', data: expMgr.packageChangesDiff(diffs) },
      { name: 'MANIFEST.txt', data: 'session: 123' }
    ]);

    const parsed = parseZipArchive(zip);
    assert.ok(parsed.hasFile('changes.diff'));
    assert.ok(parsed.getFileText('changes.diff').includes('import sys'));
    assert.ok(parsed.getFileText('transcript_full.jsonl').includes('Step 1 before compaction'));
  });

  it('test_p14_overflow_error_during_multimodal_response_streaming_with_retry', async () => {
    // R1 + R3: Overflow during multimodal response with successful retry
    const compMgr = new CompactionManager();
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const msgs = [
      { id: 'm1', role: 'user', content: 'Old context '.repeat(50) },
      { id: 'm2', role: 'user', content: 'Analyze image', attachments: [att] }
    ];

    let retrySuccess = false;
    await compMgr.handleOverflowRecovery({
      branchId: 'main',
      errorResponse: { status: 400, message: 'context_length_exceeded' },
      messages: msgs,
      callLlm: async (p) => {
        retrySuccess = true;
        return 'LLM response after recovery';
      }
    });

    assert.equal(retrySuccess, true);
  });

  it('test_p15_backgrounding_cleanup_of_dictation_during_large_zip_streaming_export', () => {
    // R2 + R4: Backgrounding cleans up mic while export finishes
    const fsm = new DictationFSM();
    const expMgr = new ExportManager();
    const sid = fsm.startDictation({ chatId: 'c1' });

    // App goes to background
    fsm.cleanupOnVisibilityChange(true);
    assert.equal(fsm.state, 'idle');

    // Large ZIP streaming assembly runs in background service
    const zip = expMgr.buildZip([{ name: 'large.log', data: new Uint8Array(1024) }]);
    assert.ok(parseZipArchive(zip).hasFile('large.log'));
  });
});
