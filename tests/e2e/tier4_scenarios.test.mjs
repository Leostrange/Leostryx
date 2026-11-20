/**
 * Tier 4: Real-World Application Scenarios
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

describe('Tier 4 - Real-World Application Scenarios', () => {
  it('Scenario 1: Full Multimodal Chat & Vision Warning Journey', async () => {
    // 1. User starts with text-only model
    const textModel = { modelId: 'deepseek-coder-v2', supportsImages: false, images: false };
    const imageAttachment = createMediaAttachment('image/png', SAMPLE_PNG_BYTES, 'architecture_v2.png');
    const promptText = 'Explain this microservices architecture diagram.';

    const draft = { text: promptText, attachments: [imageAttachment] };

    // 2. Pre-send vision validation blocks send
    const validation1 = validateVisionSupport(textModel, draft.attachments);
    assert.equal(validation1.valid, false);
    assert.equal(validation1.code, 'ERR_VISION_NOT_SUPPORTED');
    // Draft retained safely
    assert.equal(draft.attachments.length, 1);
    assert.equal(draft.text, promptText);

    // 3. User switches to Claude 3.5 Sonnet (vision supported)
    const claudeModel = { modelId: 'claude-3-5-sonnet-20241022', supportsImages: true };
    const validation2 = validateVisionSupport(claudeModel, draft.attachments);
    assert.equal(validation2.valid, true);

    // 4. Transform to Anthropic Messages content blocks
    const anthropicBlocks = transformAnthropicMessages(draft.attachments, draft.text);
    assert.equal(anthropicBlocks.length, 2);
    assert.equal(anthropicBlocks[0].type, 'text');
    assert.equal(anthropicBlocks[1].type, 'image');
    assert.equal(anthropicBlocks[1].source.media_type, 'image/png');
    assert.equal(anthropicBlocks[1].source.data, SAMPLE_PNG_B64);

    // 5. Verify log redaction masks payload
    const wireLog = `Gateway POST /v1/messages payload=${JSON.stringify(anthropicBlocks)}`;
    const maskedLog = maskMediaInLogs(wireLog);
    assert.ok(!maskedLog.includes(SAMPLE_PNG_B64));
    assert.ok(maskedLog.includes('[IMAGE: image/png, ') || maskedLog.includes('[IMAGE_DATA:'));

    // 6. Follow-up to OpenAI gpt-4o
    const openAiModel = { modelId: 'gpt-4o', supportsImages: true };
    const openAiParts = transformOpenAIChat(draft.attachments, 'Now optimize this design.');
    assert.equal(openAiParts[0].text, 'Now optimize this design.');
    assert.equal(openAiParts[1].type, 'image_url');
    assert.ok(openAiParts[1].image_url.url.startsWith('data:image/png;base64,'));
  });

  it('Scenario 2: Long-Form Dictation & Chat Switch Abort', async () => {
    const fsm = new DictationFSM();

    // 1. User starts dictation in chat_alpha
    const sidAlpha = fsm.startDictation({ chatId: 'chat_alpha', continuous: true });
    assert.equal(fsm.state, 'recording');
    assert.equal(fsm.chatId, 'chat_alpha');

    // 2. User dictates continuously for >5 seconds with periodic pauses
    fsm.dispatchBridgeEvent(sidAlpha, 'chat_alpha', 'F', 'First sentence of technical explanation.');
    fsm.dispatchBridgeEvent(sidAlpha, 'chat_alpha', 'X'); // 2-second silence: auto-reprimed!
    assert.equal(fsm.state, 'recording');

    fsm.dispatchBridgeEvent(sidAlpha, 'chat_alpha', 'F', 'Second sentence continuing speech.');
    fsm.dispatchBridgeEvent(sidAlpha, 'chat_alpha', 'X'); // Another pause
    assert.equal(fsm.state, 'recording');
    assert.equal(fsm.buffer, 'First sentence of technical explanation. Second sentence continuing speech.');

    // 3. User switches to chat_beta while microphone is active
    fsm.cleanupOnChatSwitch('chat_beta');
    assert.equal(fsm.state, 'idle');
    assert.equal(fsm.buffer, ''); // Purged

    // 4. Late callbacks from chat_alpha audio engine arrive after switch
    fsm.dispatchBridgeEvent(sidAlpha, 'chat_alpha', 'F', 'Ghost audio phrase that finished late');
    assert.equal(fsm.buffer, ''); // Dropped completely

    // 5. User starts fresh dictation in chat_beta
    const sidBeta = fsm.startDictation({ chatId: 'chat_beta', continuous: true });
    assert.notEqual(sidBeta, sidAlpha);
    fsm.dispatchBridgeEvent(sidBeta, 'chat_beta', 'F', 'Query in new chat.');
    const committedBeta = await fsm.stopDictation(sidBeta);
    assert.equal(committedBeta, 'Query in new chat.');
  });

  it('Scenario 3: Long Coding Session with Compaction, Restart & Resume', async () => {
    const compMgr = new CompactionManager();

    // 1. Multi-turn coding session (12 turns)
    const messages = [];
    for (let i = 1; i <= 12; i++) {
      messages.push({
        id: `turn_${i}`,
        role: i % 2 === 1 ? 'user' : 'assistant',
        content: `Message content turn ${i}`
      });
    }

    // 2. Context boundary reached: compaction executes at turn 8
    compMgr.saveCompactionState('feature_branch', {
      firstKeptEntryId: 'turn_8',
      summary: 'Turns 1-7 designed database schema and API routes.',
      estimatedTokensSaved: 18500
    });

    // 3. App reload / restart simulation: prompt is reconstructed from persistent branch record
    const promptAfterRestart = compMgr.reconstructPromptWithCompaction(messages, 'feature_branch');
    const keptIds = promptAfterRestart.map(m => m.id).filter(Boolean);
    assert.deepEqual(keptIds, ['turn_8', 'turn_9', 'turn_10', 'turn_11', 'turn_12']);
    assert.ok(promptAfterRestart[0].content.includes('Turns 1-7 designed database schema and API routes.'));

    // 4. Turn 13 triggers 400 context_length_exceeded
    messages.push({ id: 'turn_13', role: 'user', content: 'Run test suite' });
    messages.push({ id: 'turn_14', role: 'tool', content: 'Huge output '.repeat(5000) });

    let recoveryCalled = false;
    const res = await compMgr.handleOverflowRecovery({
      branchId: 'feature_branch',
      errorResponse: { status: 400, message: 'context_length_exceeded: maximum tokens reached' },
      messages,
      keepRecent: 4,
      callLlm: async (recoveredPrompt) => {
        recoveryCalled = true;
        // Verify tool output was truncated
        const toolMsg = recoveredPrompt.find(m => m.role === 'tool');
        assert.ok(toolMsg.content.includes('[TRUNCATED DUE TO CONTEXT OVERFLOW]'));
        return { ok: true, reply: 'Tests passed after recovery.' };
      }
    });

    assert.equal(recoveryCalled, true);
    assert.equal(res.ok, true);

    // 5. Subsequent overflow immediately aborts to avoid infinite loop
    await assert.rejects(async () => {
      await compMgr.handleOverflowRecovery({
        branchId: 'feature_branch',
        errorResponse: { status: 400, message: 'context_length_exceeded' },
        messages,
        callLlm: async () => ({ ok: true })
      });
    }, /Single-shot overflow recovery already exhausted/);
  });

  it('Scenario 4: Large Project Session Export (>64 MiB) with Attachments & Diffs', async () => {
    const expMgr = new ExportManager();

    // 1. Session conversation records
    const records = [
      { role: 'user', timestamp: '2026-11-19T18:00:00Z', content: 'Initialize repository with secret key: sk-live-secretkey1234567890abcdef' },
      { role: 'assistant', timestamp: '2026-11-19T18:01:00Z', content: 'Repository initialized.', toolCalls: [{ name: 'git_init' }] },
      { role: 'user', timestamp: '2026-11-19T18:05:00Z', content: 'Check Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.topsecret and Authorization: Basic secret' }
    ];

    // 2. Trajectory file diffs
    const diffs = [
      { path: 'src/server.ts', unifiedDiff: '@@ -1,3 +1,4 @@\n-const PORT = 3000;\n+const PORT = 8080;\n+const HOST = "127.0.0.1";' },
      { path: 'config/db.json', unifiedDiff: '@@ -1 +1 @@\n-{"db":"dev"}\n+{"db":"prod"}' }
    ];

    // 3. User attachments
    const attachments = [
      { name: 'dashboard.png', data: SAMPLE_PNG_BYTES },
      { name: 'dashboard.png', data: SAMPLE_PNG_BYTES } // Collision test
    ];

    // 4. Private files that must be excluded
    const privateFiles = [
      { name: '.env', data: 'DATABASE_URL=postgres://user:pass@localhost/db' },
      { name: 'id_rsa', data: 'PRIVATE KEY' }
    ];

    const packagedAtts = expMgr.packageAttachments(attachments);
    const transcriptFull = expMgr.packageTranscriptFull(records);
    const transcriptMd = expMgr.packageTranscriptMd(records);
    const changesDiff = expMgr.packageChangesDiff(diffs);

    const zipFiles = [
      { name: 'transcript_full.jsonl', data: transcriptFull },
      { name: 'transcript.md', data: transcriptMd },
      { name: 'changes.diff', data: changesDiff },
      { name: 'MANIFEST.txt', data: 'Exported session manifest' },
      ...packagedAtts,
      ...privateFiles
    ];

    // 5. Build streaming ZIP archive
    const zipBytes = expMgr.buildZip(zipFiles);
    const parsed = parseZipArchive(zipBytes);

    // Verify files in ZIP
    assert.ok(parsed.hasFile('transcript_full.jsonl'));
    assert.ok(parsed.hasFile('transcript.md'));
    assert.ok(parsed.hasFile('changes.diff'));
    assert.ok(parsed.hasFile('attachments/dashboard.png'));
    assert.ok(parsed.hasFile('attachments/dashboard_1.png'));

    // Verify private files are excluded
    assert.ok(!parsed.hasFile('.env'));
    assert.ok(!parsed.hasFile('id_rsa'));

    // Verify sensitive secrets are redacted from transcripts
    const exportedFull = parsed.getFileText('transcript_full.jsonl');
    assert.ok(!exportedFull.includes('sk-live-secretkey1234567890abcdef'));
    assert.ok(!exportedFull.includes('eyJhbGciOiJIUzI1Ni'));
    assert.ok(exportedFull.includes('[REDACTED]'));
    assert.ok(exportedFull.includes('Bearer [REDACTED]'));
    assert.ok(exportedFull.includes('Authorization: [REDACTED]'));

    // Verify changes.diff contents
    const exportedDiff = parsed.getFileText('changes.diff');
    assert.ok(exportedDiff.includes('src/server.ts'));
    assert.ok(exportedDiff.includes('+const PORT = 8080;'));
  });

  it('Scenario 5: Integrated Resilience: Multimodal Prompt with Overflow Recovery & Clean Session Export', async () => {
    // End-to-end integration combining R1, R2, R3, R4
    const compMgr = new CompactionManager();
    const expMgr = new ExportManager();
    const fsm = new DictationFSM();

    // 1. User attaches image diagram
    const diagram = createMediaAttachment('image/png', SAMPLE_PNG_BYTES, 'sys_arch.png');

    // 2. User dictates prompt via continuous voice dictation
    const sid = fsm.startDictation({ chatId: 'resilience_chat', continuous: true });
    fsm.dispatchBridgeEvent(sid, 'resilience_chat', 'F', 'Analyze the security model of this architecture:');
    const promptText = await fsm.stopDictation(sid);

    // 3. Serialize multimodal payload
    const openAiPayload = transformOpenAIChat([diagram], promptText);
    assert.equal(openAiPayload[0].text, 'Analyze the security model of this architecture:');
    assert.equal(openAiPayload[1].type, 'image_url');

    // 4. Conversation history simulation
    const messages = [
      { id: 'm1', role: 'user', content: 'Historical turn '.repeat(100) },
      { id: 'm2', role: 'assistant', content: 'Historical reply '.repeat(100) },
      { id: 'm3', role: 'user', content: promptText, attachments: [diagram] }
    ];

    // 5. Gateway encounters 413 context window overflow
    let promptDelivered = null;
    const llmCall = async (recoveredPrompt) => {
      promptDelivered = recoveredPrompt;
      return { ok: true, answer: 'Security analysis complete: OAuth2 endpoints verified.' };
    };

    const recoveryResult = await compMgr.handleOverflowRecovery({
      branchId: 'resilience_branch',
      errorResponse: { status: 413, message: 'Request Entity Too Large: context window exceeded' },
      messages,
      keepRecent: 2,
      callLlm: llmCall
    });

    assert.equal(recoveryResult.ok, true);
    assert.ok(promptDelivered);

    // 6. User exports session to ZIP
    const exportHistory = [
      ...messages,
      { id: 'm4', role: 'assistant', content: recoveryResult.answer }
    ];

    const attFiles = expMgr.packageAttachments([diagram]);
    const zipFiles = [
      { name: 'transcript_full.jsonl', data: expMgr.packageTranscriptFull(exportHistory) },
      { name: 'transcript.md', data: expMgr.packageTranscriptMd(exportHistory) },
      { name: 'changes.diff', data: expMgr.packageChangesDiff([{ path: 'security.md', unifiedDiff: '@@ -1 +1 @@\n+Audited' }]) },
      ...attFiles
    ];

    const zipBytes = expMgr.buildZip(zipFiles);
    const parsed = parseZipArchive(zipBytes);

    // 7. Verify export archive integrity
    assert.ok(parsed.hasFile('transcript_full.jsonl'));
    assert.ok(parsed.hasFile('attachments/sys_arch.png'));
    assert.ok(parsed.hasFile('changes.diff'));
    assert.ok(parsed.getFileText('transcript.md').includes('Analyze the security model of this architecture:'));
    assert.ok(parsed.getFileText('transcript.md').includes('Security analysis complete'));
  });
});
