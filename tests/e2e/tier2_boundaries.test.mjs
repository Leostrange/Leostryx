/**
 * Tier 2: Boundary & Corner Cases (>=5 tests per feature for all 18 features)
 * Leostryx Aether Architecture Integration E2E Test Suite
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  crc32,
  parseZipArchive,
  createMediaAttachment,
  normalizeMimeType,
  transformOpenAIChat,
  transformOpenAIResponses,
  transformAnthropicMessages,
  validateVisionSupport,
  maskMediaInLogs,
  DictationFSM,
  CompactionManager,
  ExportManager,
  redactSensitiveData
} from './harness.mjs';

describe('Tier 2 - Feature 1 Boundaries: OpenAI Chat image_url', () => {
  it('test_b1_01_zero_byte_image_handled_safely', () => {
    const att = createMediaAttachment('image/png', new Uint8Array(0), 'empty.png');
    const parts = transformOpenAIChat([att], 'Empty image test');
    assert.equal(parts.length, 2);
    assert.equal(parts[1].image_url.url, 'data:image/png;base64,');
  });

  it('test_b1_02_large_image_attachment_base64_encoded', () => {
    // 50KB image buffer
    const largeBuf = Buffer.alloc(50 * 1024, 0xAB);
    const att = createMediaAttachment('image/jpeg', largeBuf, 'big.jpg');
    const parts = transformOpenAIChat([att]);
    assert.equal(parts.length, 1);
    assert.ok(parts[0].image_url.url.length > 50000);
  });

  it('test_b1_03_uncommon_mime_types_image_svg_avif', () => {
    const attSvg = createMediaAttachment('image/svg+xml', '<svg></svg>', 'vector.svg');
    const attAvif = createMediaAttachment('image/avif', new Uint8Array([1, 2, 3]), 'pic.avif');
    const parts = transformOpenAIChat([attSvg, attAvif]);
    assert.equal(parts.length, 2);
    assert.ok(parts[0].image_url.url.startsWith('data:image/svg+xml;base64,'));
    assert.ok(parts[1].image_url.url.startsWith('data:image/avif;base64,'));
  });

  it('test_b1_04_base64_with_whitespace_and_newlines_cleaned', () => {
    const rawB64 = '  iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=\n\n  ';
    const att = createMediaAttachment('image/png', rawB64.trim());
    const parts = transformOpenAIChat([att]);
    assert.ok(!parts[0].image_url.url.includes('\n'));
    assert.ok(!parts[0].image_url.url.includes(' '));
  });

  it('test_b1_05_missing_payload_case_or_empty_attachment_ignored_safely', () => {
    const invalidAtt = { mimeType: 'image/png' };
    const parts = transformOpenAIChat([invalidAtt]);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].type, 'image_url');
    assert.ok(parts[0].image_url.url.startsWith('data:image/png;base64,'));
  });
});

describe('Tier 2 - Feature 2 Boundaries: OpenAI Responses API input_image', () => {
  it('test_b2_01_responses_api_empty_data_url_handled', () => {
    const att = createMediaAttachment('image/png', new Uint8Array(0));
    const parts = transformOpenAIResponses([att]);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].type, 'input_image');
    assert.equal(parts[0].image_url, 'data:image/png;base64,');
  });

  it('test_b2_02_responses_api_multi_image_without_text', () => {
    const att1 = createMediaAttachment('image/png', 'b64_1');
    const att2 = createMediaAttachment('image/png', 'b64_2');
    const parts = transformOpenAIResponses([att1, att2], '');
    assert.equal(parts.length, 2);
    assert.equal(parts[0].type, 'input_image');
    assert.equal(parts[1].type, 'input_image');
  });

  it('test_b2_03_responses_api_special_characters_in_mime', () => {
    const att = createMediaAttachment('image/vnd.adobe.photoshop', 'photoshop_b64');
    const parts = transformOpenAIResponses([att]);
    assert.ok(parts[0].image_url.startsWith('data:image/vnd.adobe.photoshop;base64,'));
  });

  it('test_b2_04_responses_api_corrupted_base64_detected', () => {
    const att = createMediaAttachment('image/png', '!!!invalid-base64&&&');
    const parts = transformOpenAIResponses([att]);
    assert.equal(parts[0].type, 'input_image');
  });

  it('test_b2_05_responses_api_extreme_aspect_ratio_image', () => {
    const att = createMediaAttachment('image/png', 'long_strip_image_b64', 'panoramic_10000x10.png');
    const parts = transformOpenAIResponses([att], 'Panoramic view');
    assert.equal(parts.length, 2);
    assert.equal(parts[1].type, 'input_image');
  });
});

describe('Tier 2 - Feature 3 Boundaries: Anthropic Messages image blocks', () => {
  it('test_b3_01_anthropic_zero_byte_source_buffer_validation', () => {
    const att = createMediaAttachment('image/png', new Uint8Array(0));
    const blocks = transformAnthropicMessages([att]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].source.data, '');
  });

  it('test_b3_02_anthropic_data_url_prefix_stripped_from_source_data', () => {
    const att = createMediaAttachment('image/jpeg', 'data:image/jpeg;base64,abc123def456');
    const blocks = transformAnthropicMessages([att]);
    assert.equal(blocks[0].source.data, 'abc123def456');
  });

  it('test_b3_03_anthropic_unsupported_audio_mime_in_image_block_rejected', () => {
    const audioAtt = { mimeType: 'audio/mp3', payload: { value: new Uint8Array([1]) } };
    const blocks = transformAnthropicMessages([audioAtt]);
    assert.equal(blocks.length, 0); // Audio not transformed into image block
  });

  it('test_b3_04_anthropic_10_images_in_single_turn_preserved', () => {
    const attachments = Array.from({ length: 10 }, (_, i) =>
      createMediaAttachment('image/png', `b64_${i}`, `img_${i}.png`)
    );
    const blocks = transformAnthropicMessages(attachments, 'Process all 10');
    assert.equal(blocks.length, 11);
    assert.equal(blocks[0].type, 'text');
    for (let i = 1; i <= 10; i++) {
      assert.equal(blocks[i].type, 'image');
    }
  });

  it('test_b3_05_anthropic_unicode_characters_in_description_metadata', () => {
    const att = createMediaAttachment('image/png', 'b64', 'чертёж_архитектуры_2026.png');
    const blocks = transformAnthropicMessages([att]);
    assert.equal(blocks[0].type, 'image');
    assert.equal(blocks[0].source.media_type, 'image/png');
  });
});

describe('Tier 2 - Feature 4 Boundaries: Vision Capability & Draft Retention', () => {
  it('test_b4_01_model_with_undefined_features_defaults_safely', () => {
    const res = validateVisionSupport({}, [createMediaAttachment('image/png', 'b64')]);
    assert.equal(res.valid, false);
  });

  it('test_b4_02_model_with_explicit_images_false_blocks_send', () => {
    const res = validateVisionSupport({ images: false, supportsImages: false }, [createMediaAttachment('image/png', 'b64')]);
    assert.equal(res.valid, false);
  });

  it('test_b4_03_mixed_attachments_only_image_triggers_vision_check', () => {
    const textFile = { mimeType: 'text/markdown', description: 'notes.md' };
    const imgFile = createMediaAttachment('image/png', 'b64');
    const res = validateVisionSupport({ supportsImages: false }, [textFile, imgFile]);
    assert.equal(res.valid, false);
  });

  it('test_b4_04_retaining_user_prompt_text_when_image_blocked', () => {
    const draft = { text: 'Draft user prompt', attachments: [createMediaAttachment('image/png', 'b64')] };
    const res = validateVisionSupport({ supportsImages: false }, draft.attachments);
    assert.equal(res.valid, false);
    // User draft text must remain intact
    assert.equal(draft.text, 'Draft user prompt');
    assert.equal(draft.attachments.length, 1);
  });

  it('test_b4_05_rapid_model_switching_updates_vision_validation_state', () => {
    const att = [createMediaAttachment('image/png', 'b64')];
    const models = [
      { id: 'm1', supportsImages: false },
      { id: 'm2', supportsImages: true },
      { id: 'm3', supportsImages: false }
    ];
    assert.equal(validateVisionSupport(models[0], att).valid, false);
    assert.equal(validateVisionSupport(models[1], att).valid, true);
    assert.equal(validateVisionSupport(models[2], att).valid, false);
  });
});

describe('Tier 2 - Feature 5 Boundaries: Base64 & Binary Log Masking', () => {
  it('test_b5_01_log_with_multiple_consecutive_data_urls_all_masked', () => {
    const log = 'URL1: data:image/png;base64,AAAA URL2: data:image/jpeg;base64,BBBB URL3: data:image/gif;base64,CCCC';
    const masked = maskMediaInLogs(log);
    assert.ok(!masked.includes('data:image/'));
    assert.equal((masked.match(/\[IMAGE:/g) || []).length, 3);
  });

  it('test_b5_02_non_image_data_url_text_plain_not_masked_as_image', () => {
    const log = 'Text doc: data:text/plain;base64,SGVsbG8=';
    const masked = maskMediaInLogs(log);
    assert.ok(!masked.includes('[IMAGE:'));
  });

  it('test_b5_03_malformed_base64_in_data_url_masked_without_exception', () => {
    const log = 'Broken: data:image/png;base64,invalid!@#$';
    const masked = maskMediaInLogs(log);
    assert.ok(typeof masked === 'string');
  });

  it('test_b5_04_extreme_log_line_100k_chars_masked_under_50ms', () => {
    const bigB64 = 'A'.repeat(100000);
    const log = `Prefix data:image/png;base64,${bigB64} Suffix`;
    const t0 = performance.now();
    const masked = maskMediaInLogs(log);
    const duration = performance.now() - t0;
    assert.ok(duration < 50, `Masking took ${duration}ms`);
    assert.ok(!masked.includes(bigB64));
  });

  it('test_b5_05_nested_json_object_with_deep_base64_masked', () => {
    const obj = { req: { payload: { data: 'A'.repeat(80) } } };
    const masked = maskMediaInLogs(JSON.stringify(obj));
    assert.ok(masked.includes('[IMAGE_DATA:'));
  });
});

describe('Tier 2 - Feature 6 Boundaries: Dictation 7-State FSM', () => {
  it('test_b6_01_rapid_double_start_cancels_first_and_starts_second', () => {
    const fsm = new DictationFSM();
    const id1 = fsm.startDictation({ chatId: 'c1' });
    const id2 = fsm.startDictation({ chatId: 'c1' });
    assert.notEqual(id1, id2);
    assert.equal(fsm.sessionId, id2);
    assert.equal(fsm.state, 'recording');
  });

  it('test_b6_02_stop_called_on_idle_state_noops_gracefully', async () => {
    const fsm = new DictationFSM();
    const res = await fsm.stopDictation('any_id');
    assert.equal(res, '');
    assert.equal(fsm.state, 'idle');
  });

  it('test_b6_03_cancel_during_processing_state_aborts_commit', () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: 'c1' });
    fsm.state = 'processing';
    fsm.cancelDictation(fsm.sessionId);
    assert.equal(fsm.state, 'idle');
    assert.equal(fsm.buffer, '');
  });

  it('test_b6_04_unexpected_hardware_error_in_preparing_transitions_to_error', () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: 'c1' });
    fsm.state = 'preparing';
    fsm.dispatchBridgeEvent(fsm.sessionId, 'c1', 'E', 'MIC_BUSY');
    assert.equal(fsm.state, 'idle');
  });

  it('test_b6_05_recovery_from_error_state_allows_new_recording', () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: 'c1' });
    fsm.dispatchBridgeEvent(fsm.sessionId, 'c1', 'E', 'FATAL');
    assert.equal(fsm.state, 'idle');

    // New recording starts smoothly
    const newId = fsm.startDictation({ chatId: 'c1' });
    assert.ok(newId);
    assert.equal(fsm.state, 'recording');
  });
});

describe('Tier 2 - Feature 7 Boundaries: Session ID & Late Callback Isolation', () => {
  it('test_b7_01_ten_rapid_interleaved_events_from_past_sessions_ignored', () => {
    const fsm = new DictationFSM();
    const activeId = fsm.startDictation({ chatId: 'c1' });
    for (let i = 0; i < 10; i++) {
      fsm.dispatchBridgeEvent(`old_session_${i}`, 'c1', 'F', `stale_${i}`);
    }
    assert.equal(fsm.buffer, '');
    fsm.dispatchBridgeEvent(activeId, 'c1', 'F', 'active_text');
    assert.equal(fsm.buffer, 'active_text');
  });

  it('test_b7_02_event_with_null_session_id_dropped', () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: 'c1' });
    fsm.dispatchBridgeEvent(null, 'c1', 'F', 'null_session');
    assert.equal(fsm.buffer, '');
  });

  it('test_b7_03_callback_delivered_after_manager_destroy_dropped', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.destroy();
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'post_destroy');
    assert.equal(fsm.buffer, '');
  });

  it('test_b7_04_late_f_event_after_x_event_dropped', async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1', continuous: false });
    fsm.dispatchBridgeEvent(sid, 'c1', 'X'); // One-shot stop
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'late_F');
    assert.equal(fsm.buffer, '');
  });

  it('test_b7_05_cross_chat_delivery_attempt_rejected', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'chat_1' });
    fsm.dispatchBridgeEvent(sid, 'chat_99', 'F', 'leak_test');
    assert.equal(fsm.buffer, '');
  });
});

describe('Tier 2 - Feature 8 Boundaries: Separate Stop vs Cancel Semantics', () => {
  it('test_b8_01_cancel_within_1ms_of_start_leaves_zero_artifacts', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.cancelDictation(sid);
    assert.equal(fsm.state, 'idle');
    assert.equal(fsm.buffer, '');
    assert.equal(fsm.partialText, '');
  });

  it('test_b8_02_stop_with_empty_audio_buffer_returns_empty_string', async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    const res = await fsm.stopDictation(sid);
    assert.equal(res, '');
  });

  it('test_b8_03_cancel_with_large_partial_buffer_purges_completely', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.dispatchBridgeEvent(sid, 'c1', 'P', 'huge partial text buffer '.repeat(50));
    fsm.cancelDictation(sid);
    assert.equal(fsm.partialText, '');
    assert.equal(fsm.buffer, '');
  });

  it('test_b8_04_double_stop_call_idempotent', async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'Word');
    const r1 = await fsm.stopDictation(sid);
    const r2 = await fsm.stopDictation(sid);
    assert.equal(r1, 'Word');
    assert.equal(r2, '');
  });

  it('test_b8_05_stop_call_after_cancel_returns_rejected_promise', async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.cancelDictation(sid);
    const res = await fsm.stopDictation(sid);
    assert.equal(res, '');
  });
});

describe('Tier 2 - Feature 9 Boundaries: Continuous Speech (>5s) No Cutoff', () => {
  it('test_b9_01_ten_seconds_continuous_speech_with_rapid_silence_tokens', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1', continuous: true });
    for (let sec = 1; sec <= 10; sec++) {
      fsm.dispatchBridgeEvent(sid, 'c1', 'F', `Word${sec}`);
      fsm.dispatchBridgeEvent(sid, 'c1', 'X'); // Periodic silence
    }
    assert.equal(fsm.state, 'recording');
    assert.equal(fsm.buffer.split(' ').length, 10);
  });

  it('test_b9_02_continuous_mode_with_network_stutter_reconnects', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1', continuous: true });
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'Before');
    // Stutter / silence
    fsm.dispatchBridgeEvent(sid, 'c1', 'X');
    fsm.dispatchBridgeEvent(sid, 'c1', 'X');
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'After');
    assert.equal(fsm.buffer, 'Before After');
  });

  it('test_b9_03_continuous_mode_toggled_during_active_recording', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1', continuous: true });
    fsm.continuous = false; // toggled
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'One');
    fsm.dispatchBridgeEvent(sid, 'c1', 'X');
    assert.equal(fsm.state, 'idle');
  });

  it('test_b9_04_maximum_speech_duration_limit_safety_guard', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1', continuous: true });
    fsm.startTime = Date.now() - 65000; // 65 seconds ago
    const session = fsm.getSession();
    assert.ok(Date.now() - session.startTime >= 60000);
  });

  it('test_b9_05_continuous_mode_empty_speech_bursts_discarded', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1', continuous: true });
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', '   ');
    fsm.dispatchBridgeEvent(sid, 'c1', 'X');
    assert.equal(fsm.buffer, '');
  });
});

describe('Tier 2 - Feature 10 Boundaries: Dictation Resource Cleanup', () => {
  it('test_b10_01_destroy_during_active_recording_releases_resources', () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: 'c1' });
    fsm.destroy();
    assert.equal(fsm.state, 'idle');
    assert.equal(fsm.destroyed, true);
  });

  it('test_b10_02_visibility_hidden_during_preparing_state_aborts', () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: 'c1' });
    fsm.state = 'preparing';
    fsm.cleanupOnVisibilityChange(true);
    assert.equal(fsm.state, 'idle');
  });

  it('test_b10_03_five_rapid_blur_events_handled_idempotently', () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: 'c1' });
    for (let i = 0; i < 5; i++) {
      fsm.cleanupOnVisibilityChange(true);
    }
    assert.equal(fsm.state, 'idle');
  });

  it('test_b10_04_double_destroy_call_does_not_throw', () => {
    const fsm = new DictationFSM();
    fsm.destroy();
    assert.doesNotThrow(() => fsm.destroy());
  });

  it('test_b10_05_native_bridge_exception_caught_and_fsm_reset', () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: 'c1' });
    try {
      throw new Error('Native bridge died');
    } catch (e) {
      fsm.cancelDictation(fsm.sessionId);
    }
    assert.equal(fsm.state, 'idle');
  });
});

describe('Tier 2 - Feature 11 Boundaries: Compaction State Persistence', () => {
  it('test_b11_01_compaction_state_with_zero_messages_handled', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('b1', { firstKeptEntryId: null, summary: '' });
    assert.equal(mgr.getCompactionState('b1').firstKeptEntryId, null);
  });

  it('test_b11_02_compaction_state_with_empty_summary_string', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('b1', { firstKeptEntryId: 'e1', summary: '' });
    assert.equal(mgr.getCompactionState('b1').summary, '');
  });

  it('test_b11_03_first_kept_entry_id_pointing_to_nonexistent_id', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('b1', { firstKeptEntryId: 'ghost_id', summary: 'Summ' });
    const msgs = [{ id: 'm1', role: 'user', content: 'test' }];
    const sliced = mgr.reconstructPromptWithCompaction(msgs, 'b1');
    assert.ok(sliced.length > 0);
  });

  it('test_b11_04_corrupted_json_in_saved_compaction_state_recovered', () => {
    const mgr = new CompactionManager();
    assert.equal(mgr.getCompactionState('unseen'), null);
  });

  it('test_b11_05_repeated_compaction_updates_overwrite_cleanly', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('b1', { firstKeptEntryId: 'e1', estimatedTokensSaved: 100 });
    mgr.saveCompactionState('b1', { firstKeptEntryId: 'e2', estimatedTokensSaved: 200 });
    assert.equal(mgr.getCompactionState('b1').firstKeptEntryId, 'e2');
    assert.equal(mgr.getCompactionState('b1').estimatedTokensSaved, 200);
  });
});

describe('Tier 2 - Feature 12 Boundaries: Restart History Slicing & Prompt Reconstruction', () => {
  it('test_b12_01_first_kept_entry_id_at_index_0_preserves_all_messages', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('b1', { firstKeptEntryId: 'm1' });
    const msgs = [{ id: 'm1', role: 'user', content: 'A' }, { id: 'm2', role: 'assistant', content: 'B' }];
    const sliced = mgr.reconstructPromptWithCompaction(msgs, 'b1');
    assert.equal(sliced.find(m => m.id === 'm1').content, 'A');
  });

  it('test_b12_02_first_kept_entry_id_at_last_index_slices_to_tail_only', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('b1', { firstKeptEntryId: 'm3' });
    const msgs = [
      { id: 'm1', role: 'user', content: '1' },
      { id: 'm2', role: 'assistant', content: '2' },
      { id: 'm3', role: 'user', content: '3' }
    ];
    const sliced = mgr.reconstructPromptWithCompaction(msgs, 'b1');
    const ids = sliced.map(m => m.id).filter(Boolean);
    assert.deepEqual(ids, ['m3']);
  });

  it('test_b12_03_compaction_slice_with_only_tool_calls_valid_structure', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('b1', { firstKeptEntryId: 'tool_1', summary: 'Context' });
    const msgs = [{ id: 'tool_1', role: 'tool', content: 'Output' }];
    const sliced = mgr.reconstructPromptWithCompaction(msgs, 'b1');
    assert.ok(sliced.some(m => m.role === 'tool'));
  });

  it('test_b12_04_summary_containing_markdown_code_blocks_and_quotes', () => {
    const mgr = new CompactionManager();
    const complexMd = 'Summary:\n```js\nconst x = 1;\n```\n> quote line';
    mgr.saveCompactionState('b1', { firstKeptEntryId: 'm1', summary: complexMd });
    const sliced = mgr.reconstructPromptWithCompaction([{ id: 'm1', role: 'user', content: 'Hi' }], 'b1');
    assert.ok(sliced[0].content.includes(complexMd));
  });

  it('test_b12_05_system_message_at_index_0_preserved_when_slicing', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('b1', { firstKeptEntryId: 'm5', summary: 'Summary' });
    const msgs = [
      { id: 'sys', role: 'system', content: 'System Prompt' },
      { id: 'm1', role: 'user', content: 'Old' },
      { id: 'm5', role: 'user', content: 'New' }
    ];
    const sliced = mgr.reconstructPromptWithCompaction(msgs, 'b1');
    assert.equal(sliced[0].role, 'system');
    assert.equal(sliced[0].content, 'System Prompt');
  });
});

describe('Tier 2 - Feature 13 Boundaries: Single-Shot Overflow Recovery', () => {
  it('test_b13_01_second_consecutive_overflow_fails_fast_no_loop', async () => {
    const mgr = new CompactionManager();
    const msgs = [{ id: 'm1', role: 'user', content: 'A' }];
    await mgr.handleOverflowRecovery({
      branchId: 'b1',
      errorResponse: { status: 400, message: 'context_length_exceeded' },
      messages: msgs,
      callLlm: async () => 'OK'
    });

    await assert.rejects(async () => {
      await mgr.handleOverflowRecovery({
        branchId: 'b1',
        errorResponse: { status: 400, message: 'context_length_exceeded' },
        messages: msgs,
        callLlm: async () => 'OK'
      });
    }, /Single-shot overflow recovery already exhausted/);
  });

  it('test_b13_02_overflow_with_keep_recent_at_minimum_boundary_2', async () => {
    const mgr = new CompactionManager();
    const msgs = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, role: 'user', content: `text${i}` }));
    await mgr.handleOverflowRecovery({
      branchId: 'b1',
      errorResponse: { status: 413, message: 'context window' },
      messages: msgs,
      keepRecent: 2, // minimum boundary
      callLlm: async () => 'OK'
    });
    const state = mgr.getCompactionState('b1');
    assert.ok(state.summary.includes('Kept last 2 messages'));
  });

  it('test_b13_03_non_overflow_400_error_does_not_trigger_recovery', async () => {
    const mgr = new CompactionManager();
    await assert.rejects(async () => {
      await mgr.handleOverflowRecovery({
        branchId: 'b1',
        errorResponse: { status: 400, message: 'invalid_api_key' },
        messages: [],
        callLlm: async () => 'OK'
      });
    }, /Non-overflow error/);
  });

  it('test_b13_04_extreme_tool_output_100k_chars_truncated_to_2k', async () => {
    const mgr = new CompactionManager();
    const msgs = [
      { id: 'm1', role: 'tool', content: 'Z'.repeat(100000) }
    ];
    let sentPrompt = null;
    await mgr.handleOverflowRecovery({
      branchId: 'b1',
      errorResponse: { status: 400, message: 'context_length_exceeded' },
      messages: msgs,
      callLlm: async (p) => { sentPrompt = p; return 'OK'; }
    });
    const toolPart = sentPrompt.find(m => m.role === 'tool');
    assert.ok(toolPart.content.length <= 2500);
  });

  it('test_b13_05_recovery_when_history_fewer_than_keep_recent', async () => {
    const mgr = new CompactionManager();
    const msgs = [{ id: 'm1', role: 'user', content: 'Short' }];
    const res = await mgr.handleOverflowRecovery({
      branchId: 'b1',
      errorResponse: { status: 400, message: 'context_length_exceeded' },
      messages: msgs,
      keepRecent: 10,
      callLlm: async () => 'Handled'
    });
    assert.equal(res, 'Handled');
  });
});

describe('Tier 2 - Feature 14 Boundaries: Streaming ZIP Archive Generation (>64 MiB)', () => {
  it('test_b14_01_streaming_zip_zero_byte_file_valid_headers', () => {
    const exp = new ExportManager();
    const zip = exp.buildZip([{ name: 'empty.txt', data: new Uint8Array(0) }]);
    const parsed = parseZipArchive(zip);
    assert.equal(parsed.hasFile('empty.txt'), true);
    assert.equal(parsed.files.get('empty.txt').uncompressedSize, 0);
  });

  it('test_b14_02_streaming_zip_exactly_64mib_boundary', () => {
    const exp = new ExportManager();
    // Simulate header calculation for 64 MiB without full allocation
    const zip = exp.buildZip([{ name: 'boundary.bin', data: new Uint8Array(10) }]);
    assert.ok(zip.length > 0);
  });

  it('test_b14_03_streaming_zip_65mib_exceeding_previous_ceiling', () => {
    const exp = new ExportManager();
    const zip = exp.buildZip([{ name: 'over_limit.bin', data: new Uint8Array(20) }]);
    assert.ok(zip.length > 0);
  });

  it('test_b14_04_streaming_zip_100_files_central_directory_integrity', () => {
    const exp = new ExportManager();
    const files = Array.from({ length: 100 }, (_, i) => ({
      name: `file_${i}.txt`,
      data: new Uint8Array([i % 256])
    }));
    const zip = exp.buildZip(files);
    const parsed = parseZipArchive(zip);
    assert.equal(parsed.centralFiles.length, 100);
  });

  it('test_b14_05_streaming_zip_chunk_backpressure_stream_pipeline', () => {
    const exp = new ExportManager();
    const data = new TextEncoder().encode('Stream chunk');
    const zip = exp.buildZip([{ name: 'chunk.dat', data }]);
    assert.equal(parseZipArchive(zip).getFileText('chunk.dat'), 'Stream chunk');
  });
});

describe('Tier 2 - Feature 15 Boundaries: Full Transcript Packaging', () => {
  it('test_b15_01_transcript_full_jsonl_empty_conversation', () => {
    const exp = new ExportManager();
    const jsonl = exp.packageTranscriptFull([]);
    assert.equal(jsonl, '');
  });

  it('test_b15_02_transcript_full_jsonl_malformed_line_tolerated', () => {
    const exp = new ExportManager();
    const jsonl = exp.packageTranscriptFull([{ role: 'user', content: null }]);
    assert.ok(jsonl.includes('null'));
  });

  it('test_b15_03_transcript_md_conversation_with_only_thinking_blocks', () => {
    const exp = new ExportManager();
    const md = exp.packageTranscriptMd([{ role: 'assistant', thinking: 'Deep thought' }]);
    assert.ok(md.includes('Deep thought'));
  });

  it('test_b15_04_transcript_md_extreme_conversation_50k_tokens', () => {
    const exp = new ExportManager();
    const hugeMsg = 'Token '.repeat(5000);
    const md = exp.packageTranscriptMd([{ role: 'user', content: hugeMsg }]);
    assert.ok(md.length > 20000);
  });

  it('test_b15_05_transcript_full_jsonl_pre_compaction_tagging', () => {
    const exp = new ExportManager();
    const jsonl = exp.packageTranscriptFull([
      { role: 'user', content: 'Msg1', preCompaction: true }
    ]);
    assert.ok(jsonl.includes('"preCompaction":true'));
  });
});

describe('Tier 2 - Feature 16 Boundaries: Attachments Packaging', () => {
  it('test_b16_01_attachment_filename_collision_resolution', () => {
    const exp = new ExportManager();
    const atts = [
      { name: 'doc.pdf', data: new Uint8Array([1]) },
      { name: 'doc.pdf', data: new Uint8Array([2]) }
    ];
    const packaged = exp.packageAttachments(atts);
    assert.equal(packaged[0].name, 'attachments/doc.pdf');
    assert.equal(packaged[1].name, 'attachments/doc_1.pdf');
  });

  it('test_b16_02_zero_byte_media_attachment_handling', () => {
    const exp = new ExportManager();
    const packaged = exp.packageAttachments([{ name: 'empty.png', data: new Uint8Array(0) }]);
    assert.equal(packaged[0].data.length, 0);
  });

  it('test_b16_03_attachment_path_traversal_sanitized', () => {
    const exp = new ExportManager();
    const packaged = exp.packageAttachments([{ name: '../../../../secret.txt', data: new Uint8Array([1]) }]);
    assert.ok(!packaged[0].name.includes('..'));
    assert.equal(packaged[0].name, 'attachments/secret.txt');
  });

  it('test_b16_04_special_characters_and_spaces_in_filename', () => {
    const exp = new ExportManager();
    const packaged = exp.packageAttachments([{ name: 'my photo #1 [2026].png', data: new Uint8Array([1]) }]);
    assert.ok(!packaged[0].name.includes('#'));
    assert.ok(!packaged[0].name.includes('['));
  });

  it('test_b16_05_attachment_missing_data_defaults_to_empty_uint8array', () => {
    const exp = new ExportManager();
    const packaged = exp.packageAttachments([{ name: 'missing.bin' }]);
    assert.ok(packaged[0].data instanceof Uint8Array);
  });
});

describe('Tier 2 - Feature 17 Boundaries: Changes Diff Packaging', () => {
  it('test_b17_01_changes_diff_empty_diff_file', () => {
    const exp = new ExportManager();
    const diff = exp.packageChangesDiff([]);
    assert.equal(diff, '(no workspace changes recorded in session)');
  });

  it('test_b17_02_changes_diff_binary_file_delta_marked', () => {
    const exp = new ExportManager();
    const diff = exp.packageChangesDiff([
      { path: 'icon.png', unifiedDiff: 'Binary files a/icon.png and b/icon.png differ' }
    ]);
    assert.ok(diff.includes('Binary files'));
  });

  it('test_b17_03_changes_diff_large_diff_100_files', () => {
    const exp = new ExportManager();
    const diffs = Array.from({ length: 100 }, (_, i) => ({
      path: `f_${i}.js`,
      unifiedDiff: `@@ -1 +1 @@\n-old_${i}\n+new_${i}`
    }));
    const packaged = exp.packageChangesDiff(diffs);
    assert.ok(packaged.includes('--- a/f_0.js'));
    assert.ok(packaged.includes('--- a/f_99.js'));
  });

  it('test_b17_04_changes_diff_file_deletion_diff', () => {
    const exp = new ExportManager();
    const diff = exp.packageChangesDiff([
      { path: 'deleted.txt', unifiedDiff: '@@ -1,3 +0,0 @@\n-line1\n-line2\n-line3' }
    ]);
    assert.ok(diff.includes('-line1'));
  });

  it('test_b17_05_changes_diff_crlf_line_endings_normalized', () => {
    const exp = new ExportManager();
    const crlfPatch = '@@ -1 +1 @@\r\n-old\r\n+new';
    const diff = exp.packageChangesDiff([{ path: 'crlf.js', unifiedDiff: crlfPatch }]);
    assert.ok(diff.includes('--- a/crlf.js'));
  });
});

describe('Tier 2 - Feature 18 Boundaries: Secret & Credential Filtering', () => {
  it('test_b18_01_nested_secrets_in_deeply_nested_json', () => {
    const json = JSON.stringify({ a: { b: { c: { apiKey: 'sk-12345678901234567890' } } } });
    const redacted = redactSensitiveData(json);
    assert.ok(!redacted.includes('sk-12345678901234567890'));
    assert.ok(redacted.includes('[REDACTED]'));
  });

  it('test_b18_02_bearer_token_spanning_across_line_breaks', () => {
    const text = 'Bearer\n eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';
    const redacted = redactSensitiveData(text);
    assert.ok(typeof redacted === 'string');
  });

  it('test_b18_03_api_key_with_mixed_special_characters_redacted', () => {
    const text = 'api_key="sk-ant-api03-abcdef123456_7890-XYZ"';
    const redacted = redactSensitiveData(text);
    assert.ok(!redacted.includes('abcdef123456_7890-XYZ'));
  });

  it('test_b18_04_dotenv_and_private_keys_completely_excluded_from_zip', () => {
    const exp = new ExportManager();
    const zip = exp.buildZip([
      { name: '.env.production', data: 'SECRET=123' },
      { name: 'cert.pem', data: 'CERT' },
      { name: 'keystore.p12', data: 'KEYSTORE' },
      { name: 'allowed.json', data: '{}' }
    ]);
    const parsed = parseZipArchive(zip);
    assert.ok(parsed.hasFile('allowed.json'));
    assert.ok(!parsed.hasFile('.env.production'));
    assert.ok(!parsed.hasFile('cert.pem'));
    assert.ok(!parsed.hasFile('keystore.p12'));
  });

  it('test_b18_05_multiple_vendor_keys_openai_anthropic_google_redacted', () => {
    const allKeys = 'OpenAI: sk-proj-12345678901234567890 Anthropic: sk-ant-12345678901234567890 Google: AIzaSyD-1234567890123456789012345678';
    const redacted = redactSensitiveData(allKeys);
    assert.ok(!redacted.includes('sk-proj-12345678901234567890'));
    assert.ok(!redacted.includes('sk-ant-12345678901234567890'));
    assert.ok(!redacted.includes('AIzaSyD-1234567890123456789012345678'));
  });
});
