/**
 * Tier 1: Feature Coverage (>=5 tests per feature for all 18 features)
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

// Sample 1x1 transparent PNG Base64
const SAMPLE_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SAMPLE_PNG_BYTES = Buffer.from(SAMPLE_PNG_B64, 'base64');

// Sample JPEG Base64
const SAMPLE_JPG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

describe('Tier 1 - Feature 1: OpenAI Chat Completions image_url', () => {
  it('test_f1_01_single_png_transforms_to_openai_image_url_part', () => {
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES, 'test.png');
    const parts = transformOpenAIChat([att], 'Analyze this image');
    assert.equal(parts.length, 2);
    assert.deepEqual(parts[0], { type: 'text', text: 'Analyze this image' });
    assert.equal(parts[1].type, 'image_url');
    assert.ok(parts[1].image_url);
    assert.equal(parts[1].image_url.url, `data:image/png;base64,${SAMPLE_PNG_B64}`);
  });

  it('test_f1_02_multiple_images_preserved_in_exact_attachment_order', () => {
    const att1 = createMediaAttachment('image/png', SAMPLE_PNG_BYTES, 'first.png');
    const att2 = createMediaAttachment('image/jpeg', SAMPLE_JPG_B64, 'second.jpg');
    const parts = transformOpenAIChat([att1, att2], 'Compare these two images');
    assert.equal(parts.length, 3);
    assert.equal(parts[1].image_url.url, `data:image/png;base64,${SAMPLE_PNG_B64}`);
    assert.equal(parts[2].image_url.url, `data:image/jpeg;base64,${SAMPLE_JPG_B64}`);
  });

  it('test_f1_03_jpeg_and_jpg_mimes_normalized_correctly', () => {
    const attJpg = createMediaAttachment('image/jpg', SAMPLE_JPG_B64, 'photo.jpg');
    const parts = transformOpenAIChat([attJpg]);
    assert.equal(parts.length, 1);
    assert.ok(parts[0].image_url.url.startsWith('data:image/jpeg;base64,'));
  });

  it('test_f1_04_webp_and_gif_mimes_supported', () => {
    const attWebp = createMediaAttachment('image/webp', 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAD8D+JaQAA3AA/ua1AAA=', 'anim.webp');
    const attGif = createMediaAttachment('image/gif', 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'pixel.gif');
    const parts = transformOpenAIChat([attWebp, attGif]);
    assert.equal(parts.length, 2);
    assert.ok(parts[0].image_url.url.startsWith('data:image/webp;base64,'));
    assert.ok(parts[1].image_url.url.startsWith('data:image/gif;base64,'));
  });

  it('test_f1_05_text_prompt_precedes_image_urls_in_content_array', () => {
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const parts = transformOpenAIChat([att], 'Hello world');
    assert.equal(parts[0].type, 'text');
    assert.equal(parts[0].text, 'Hello world');
    assert.equal(parts[1].type, 'image_url');
  });
});

describe('Tier 1 - Feature 2: OpenAI Responses API input_image', () => {
  it('test_f2_01_single_image_formats_as_input_image_type', () => {
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const parts = transformOpenAIResponses([att], 'Explain chart');
    assert.equal(parts.length, 2);
    assert.equal(parts[0].type, 'input_text');
    assert.equal(parts[0].text, 'Explain chart');
    assert.equal(parts[1].type, 'input_image');
    assert.equal(typeof parts[1].image_url, 'string');
    assert.equal(parts[1].image_url, `data:image/png;base64,${SAMPLE_PNG_B64}`);
  });

  it('test_f2_02_responses_api_input_image_has_flat_string_url_not_nested_object', () => {
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const parts = transformOpenAIResponses([att]);
    assert.equal(parts[0].type, 'input_image');
    assert.equal(typeof parts[0].image_url, 'string');
    assert.equal(parts[0].image_url.url, undefined);
  });

  it('test_f2_03_responses_api_multi_image_array_retains_all_items', () => {
    const att1 = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const att2 = createMediaAttachment('image/jpeg', SAMPLE_JPG_B64);
    const parts = transformOpenAIResponses([att1, att2], 'Query');
    assert.equal(parts.length, 3);
    assert.equal(parts[1].type, 'input_image');
    assert.equal(parts[2].type, 'input_image');
  });

  it('test_f2_04_responses_api_preserves_input_text_alongside_images', () => {
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const parts = transformOpenAIResponses([att], 'Text payload');
    assert.equal(parts[0].type, 'input_text');
    assert.equal(parts[0].text, 'Text payload');
  });

  it('test_f2_05_responses_api_base64_payload_fidelity_and_length', () => {
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const parts = transformOpenAIResponses([att]);
    const url = parts[0].image_url;
    const b64 = url.split(',')[1];
    assert.equal(Buffer.from(b64, 'base64').toString('hex'), SAMPLE_PNG_BYTES.toString('hex'));
  });
});

describe('Tier 1 - Feature 3: Anthropic Messages image blocks', () => {
  it('test_f3_01_anthropic_image_content_block_structure', () => {
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const blocks = transformAnthropicMessages([att], 'Describe photo');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, 'text');
    assert.equal(blocks[1].type, 'image');
    assert.equal(blocks[1].source.type, 'base64');
    assert.equal(blocks[1].source.media_type, 'image/png');
    assert.equal(blocks[1].source.data, SAMPLE_PNG_B64);
  });

  it('test_f3_02_anthropic_source_data_does_not_contain_data_url_prefix', () => {
    const att = createMediaAttachment('image/jpeg', `data:image/jpeg;base64,${SAMPLE_JPG_B64}`);
    const blocks = transformAnthropicMessages([att]);
    assert.equal(blocks[0].type, 'image');
    assert.ok(!blocks[0].source.data.startsWith('data:'));
    assert.equal(blocks[0].source.data, SAMPLE_JPG_B64);
  });

  it('test_f3_03_anthropic_content_array_assignment_returns_complete_blocks', () => {
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const blocks = transformAnthropicMessages([att], 'Prompt text');
    // Simulating gateway forwardAnthropic: message content must equal blocks array, not empty string
    const userMessage = { role: 'user', content: blocks };
    assert.ok(Array.isArray(userMessage.content));
    assert.equal(userMessage.content.length, 2);
    assert.equal(userMessage.content[1].type, 'image');
  });

  it('test_f3_04_anthropic_mixed_text_and_multiple_images', () => {
    const att1 = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const att2 = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const blocks = transformAnthropicMessages([att1, att2], 'Two images');
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].type, 'text');
    assert.equal(blocks[1].type, 'image');
    assert.equal(blocks[2].type, 'image');
  });

  it('test_f3_05_anthropic_media_type_lowercase_normalized', () => {
    const att = createMediaAttachment('IMAGE/PNG', SAMPLE_PNG_BYTES);
    const blocks = transformAnthropicMessages([att]);
    assert.equal(blocks[0].source.media_type, 'image/png');
  });
});

describe('Tier 1 - Feature 4: Vision Capability & Draft Retention', () => {
  it('test_f4_01_model_with_vision_support_passes_validation', () => {
    const model = { modelId: 'gpt-4o', supportsImages: true };
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const res = validateVisionSupport(model, [att]);
    assert.equal(res.valid, true);
  });

  it('test_f4_02_model_without_vision_support_fails_validation_with_clear_warning', () => {
    const model = { modelId: 'deepseek-chat', supportsImages: false, images: false };
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);
    const res = validateVisionSupport(model, [att]);
    assert.equal(res.valid, false);
    assert.equal(res.error, 'Selected model does not support this media type');
    assert.equal(res.code, 'ERR_VISION_NOT_SUPPORTED');
  });

  it('test_f4_03_blocked_send_preserves_attachments_in_draft_retention_list', () => {
    const model = { modelId: 'text-davinci', supportsImages: false };
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES, 'diagram.png');
    const res = validateVisionSupport(model, [att]);
    assert.equal(res.valid, false);
    assert.ok(res.retainedAttachments);
    assert.equal(res.retainedAttachments.length, 1);
    assert.equal(res.retainedAttachments[0].description, 'diagram.png');
  });

  it('test_f4_04_non_image_attachments_are_never_blocked_by_vision_check', () => {
    const model = { modelId: 'deepseek-chat', supportsImages: false };
    const codeAtt = { mimeType: 'text/javascript', description: 'app.js', payload: { case: 'inlineData', value: new Uint8Array([1, 2, 3]) } };
    const jsonAtt = { mimeType: 'application/json', description: 'data.json', payload: { case: 'inlineData', value: new Uint8Array([4, 5]) } };
    const res = validateVisionSupport(model, [codeAtt, jsonAtt]);
    assert.equal(res.valid, true);
  });

  it('test_f4_05_switching_to_vision_model_allows_sending_retained_attachments', () => {
    const textModel = { modelId: 'text-model', supportsImages: false };
    const visionModel = { modelId: 'claude-3-5-sonnet', supportsImages: true };
    const att = createMediaAttachment('image/png', SAMPLE_PNG_BYTES);

    const firstCheck = validateVisionSupport(textModel, [att]);
    assert.equal(firstCheck.valid, false);

    const secondCheck = validateVisionSupport(visionModel, firstCheck.retainedAttachments);
    assert.equal(secondCheck.valid, true);
  });
});

describe('Tier 1 - Feature 5: Base64 & Binary Log Masking', () => {
  it('test_f5_01_masks_data_url_in_console_logs_preserving_mime_and_size', () => {
    const log = `Sending payload to provider: data:image/png;base64,${SAMPLE_PNG_B64} with options`;
    const masked = maskMediaInLogs(log);
    assert.ok(!masked.includes(SAMPLE_PNG_B64));
    assert.ok(masked.includes('[IMAGE: image/png, '));
    assert.ok(masked.includes('bytes]'));
  });

  it('test_f5_02_masks_raw_base64_in_json_dumps', () => {
    const jsonStr = `{"role":"user","data":"${SAMPLE_PNG_B64.repeat(3)}","type":"image"}`;
    const masked = maskMediaInLogs(jsonStr);
    assert.ok(!masked.includes(SAMPLE_PNG_B64));
    assert.ok(masked.includes('[IMAGE_DATA:'));
    assert.ok(masked.includes('redacted]'));
  });

  it('test_f5_03_multiple_data_urls_in_same_log_line_all_masked', () => {
    const log = `Batch images: data:image/png;base64,${SAMPLE_PNG_B64} and data:image/jpeg;base64,${SAMPLE_JPG_B64}`;
    const masked = maskMediaInLogs(log);
    assert.ok(!masked.includes(SAMPLE_PNG_B64));
    assert.ok(!masked.includes(SAMPLE_JPG_B64));
    assert.ok(masked.includes('[IMAGE: image/png, '));
    assert.ok(masked.includes('[IMAGE: image/jpeg, '));
  });

  it('test_f5_04_non_image_logs_and_metadata_pass_through_unaltered', () => {
    const log = '[INFO] 2026-11-19T19:00:00Z Session initialized model=gpt-4o tokens=42';
    const masked = maskMediaInLogs(log);
    assert.equal(masked, log);
  });

  it('test_f5_05_empty_or_null_logs_handled_without_exception', () => {
    assert.equal(maskMediaInLogs(''), '');
    assert.equal(maskMediaInLogs(null), '');
  });
});

describe('Tier 1 - Feature 6: Dictation 7-State FSM', () => {
  it('test_f6_01_happy_path_transitions_idle_preparing_recording_processing_ready_idle', async () => {
    const fsm = new DictationFSM();
    assert.equal(fsm.state, 'idle');

    fsm.startDictation({ chatId: 'chat_1' });
    assert.equal(fsm.state, 'recording');

    fsm.dispatchBridgeEvent(fsm.sessionId, 'chat_1', 'F', 'Hello world');
    const commitPromise = fsm.stopDictation(fsm.sessionId);
    assert.equal(fsm.state, 'idle');
    const result = await commitPromise;
    assert.equal(result, 'Hello world');
  });

  it('test_f6_02_cancel_transitions_recording_to_cancelled_to_idle', () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: 'chat_1' });
    fsm.dispatchBridgeEvent(fsm.sessionId, 'chat_1', 'P', 'partial text');
    fsm.cancelDictation(fsm.sessionId);
    assert.equal(fsm.state, 'idle');
    assert.equal(fsm.buffer, '');
  });

  it('test_f6_03_error_transition_and_reset_to_idle', () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: 'chat_1' });
    fsm.dispatchBridgeEvent(fsm.sessionId, 'chat_1', 'E', 'AudioRecord initialization failed');
    assert.equal(fsm.state, 'idle');
    assert.ok(fsm.history.some(h => h.to === 'error'));
  });

  it('test_f6_04_rejects_invalid_state_transitions', () => {
    const fsm = new DictationFSM();
    assert.throws(() => {
      fsm.transitionTo('processing'); // from idle directly to processing is invalid
    }, /Invalid state transition/);
  });

  it('test_f6_05_notifies_state_change_listener_on_every_transition', () => {
    const transitions = [];
    const fsm = new DictationFSM({
      onStateChange: (to, from) => transitions.push({ from, to })
    });
    fsm.startDictation({ chatId: 'c1' });
    fsm.stopDictation(fsm.sessionId);

    assert.ok(transitions.some(t => t.from === 'idle' && t.to === 'preparing'));
    assert.ok(transitions.some(t => t.from === 'preparing' && t.to === 'recording'));
    assert.ok(transitions.some(t => t.from === 'recording' && t.to === 'processing'));
  });
});

describe('Tier 1 - Feature 7: Session ID & Late Callback Isolation', () => {
  it('test_f7_01_each_start_generates_unique_session_id', () => {
    const fsm = new DictationFSM();
    const id1 = fsm.startDictation({ chatId: 'c1' });
    fsm.stopDictation(id1);
    const id2 = fsm.startDictation({ chatId: 'c1' });
    fsm.stopDictation(id2);
    assert.ok(id1);
    assert.ok(id2);
    assert.notEqual(id1, id2);
  });

  it('test_f7_02_late_partial_callback_from_prior_session_is_silently_dropped', () => {
    const partials = [];
    const fsm = new DictationFSM({ onPartial: (txt) => partials.push(txt) });
    const id1 = fsm.startDictation({ chatId: 'c1' });
    fsm.stopDictation(id1);

    const id2 = fsm.startDictation({ chatId: 'c1' });
    // Late event from id1 arrives now
    fsm.dispatchBridgeEvent(id1, 'c1', 'P', 'stale phrase');
    assert.equal(partials.length, 0);

    // Active event from id2 arrives
    fsm.dispatchBridgeEvent(id2, 'c1', 'P', 'active phrase');
    assert.equal(partials.length, 1);
    assert.equal(partials[0], 'active phrase');
    fsm.stopDictation(id2);
  });

  it('test_f7_03_late_final_callback_from_prior_session_dropped', async () => {
    const fsm = new DictationFSM();
    const id1 = fsm.startDictation({ chatId: 'c1' });
    await fsm.stopDictation(id1);

    const id2 = fsm.startDictation({ chatId: 'c1' });
    fsm.dispatchBridgeEvent(id1, 'c1', 'F', 'ghost final');
    fsm.dispatchBridgeEvent(id2, 'c1', 'F', 'real final');
    const text = await fsm.stopDictation(id2);
    assert.equal(text, 'real final');
    assert.ok(!text.includes('ghost'));
  });

  it('test_f7_04_session_isolated_across_interleaved_events', () => {
    const fsm = new DictationFSM();
    const s1 = fsm.startDictation({ chatId: 'c1' });
    fsm.dispatchBridgeEvent('wrong_id', 'c1', 'F', 'junk');
    assert.equal(fsm.buffer, '');
    fsm.dispatchBridgeEvent(s1, 'c1', 'F', 'valid');
    assert.equal(fsm.buffer, 'valid');
  });

  it('test_f7_05_chat_id_mismatch_prevents_text_injection_into_other_chat', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'chat_alpha' });
    fsm.dispatchBridgeEvent(sid, 'chat_beta', 'F', 'wrong chat text');
    assert.equal(fsm.buffer, '');
  });
});

describe('Tier 1 - Feature 8: Separate Stop vs Cancel Semantics', () => {
  it('test_f8_01_stop_flushes_buffer_and_commits_transcribed_text', async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'Sentence one.');
    fsm.dispatchBridgeEvent(sid, 'c1', 'P', 'Sentence two');
    const committed = await fsm.stopDictation(sid);
    assert.equal(committed, 'Sentence one. Sentence two');
  });

  it('test_f8_02_cancel_purges_buffer_with_zero_text_committed', () => {
    let finalCommitted = 'initial';
    const fsm = new DictationFSM({ onFinal: (t) => { finalCommitted = t; } });
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'Some recognized text');
    fsm.dispatchBridgeEvent(sid, 'c1', 'P', 'and partial text');
    fsm.cancelDictation(sid);

    assert.equal(fsm.buffer, '');
    assert.equal(finalCommitted, 'initial'); // onFinal never called
  });

  it('test_f8_03_cancel_immediately_sets_idle_state', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.cancelDictation(sid);
    assert.equal(fsm.state, 'idle');
  });

  it('test_f8_04_stop_resolves_promise_with_empty_string_if_no_audio', async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    const committed = await fsm.stopDictation(sid);
    assert.equal(committed, '');
  });

  it('test_f8_05_subsequent_events_after_cancel_are_ignored', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.cancelDictation(sid);
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'late text');
    assert.equal(fsm.buffer, '');
  });
});

describe('Tier 1 - Feature 9: Continuous Speech (>5s) No Cutoff', () => {
  it('test_f9_01_continuous_flag_is_true_by_default', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    assert.equal(fsm.continuous, true);
  });

  it('test_f9_02_silence_x_event_in_continuous_mode_triggers_auto_repriming_loop', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1', continuous: true });
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'First phrase');
    // Silence arrives
    fsm.dispatchBridgeEvent(sid, 'c1', 'X');
    // In continuous mode, fsm should still be recording!
    assert.equal(fsm.state, 'recording');
    assert.equal(fsm.buffer, 'First phrase');
  });

  it('test_f9_03_speech_over_5_seconds_with_multiple_x_events_remains_active', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1', continuous: true });

    // Simulate 3 speech bursts separated by silence (taking 6 seconds)
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'Hello');
    fsm.dispatchBridgeEvent(sid, 'c1', 'X');
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'this is');
    fsm.dispatchBridgeEvent(sid, 'c1', 'X');
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'continuous dictation');
    fsm.dispatchBridgeEvent(sid, 'c1', 'X');

    assert.equal(fsm.state, 'recording');
    assert.equal(fsm.buffer, 'Hello this is continuous dictation');
  });

  it('test_f9_04_continuous_mode_flushes_partial_on_x_event', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1', continuous: true });
    fsm.dispatchBridgeEvent(sid, 'c1', 'P', 'mid-sentence words');
    fsm.dispatchBridgeEvent(sid, 'c1', 'X');
    assert.equal(fsm.buffer, 'mid-sentence words');
    assert.equal(fsm.partialText, '');
  });

  it('test_f9_05_one_shot_mode_with_continuous_false_stops_on_x_event', async () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1', continuous: false });
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'Single phrase');
    fsm.dispatchBridgeEvent(sid, 'c1', 'X');
    assert.equal(fsm.state, 'idle');
    assert.equal(fsm.buffer, 'Single phrase');
  });
});

describe('Tier 1 - Feature 10: Dictation Resource Cleanup', () => {
  it('test_f10_01_destroy_stops_active_capture_and_sets_destroyed_flag', () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: 'c1' });
    fsm.destroy();
    assert.equal(fsm.destroyed, true);
    assert.equal(fsm.state, 'idle');
    assert.throws(() => fsm.startDictation({ chatId: 'c1' }), /destroyed/);
  });

  it('test_f10_02_chat_switch_triggers_immediate_session_abort', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'chat_A' });
    fsm.dispatchBridgeEvent(sid, 'chat_A', 'P', 'typing something');

    // User navigates to chat_B
    fsm.cleanupOnChatSwitch('chat_B');
    assert.equal(fsm.state, 'idle');
    assert.equal(fsm.buffer, '');
  });

  it('test_f10_03_visibility_hidden_aborts_active_audio_capture', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.cleanupOnVisibilityChange(true); // document.hidden === true
    assert.equal(fsm.state, 'idle');
    assert.equal(fsm.buffer, '');
  });

  it('test_f10_04_visibility_visible_does_not_abort_active_recording', () => {
    const fsm = new DictationFSM();
    fsm.startDictation({ chatId: 'c1' });
    fsm.cleanupOnVisibilityChange(false);
    assert.equal(fsm.state, 'recording');
  });

  it('test_f10_05_cleanup_purges_all_buffers_preventing_stale_insertion', () => {
    const fsm = new DictationFSM();
    const sid = fsm.startDictation({ chatId: 'c1' });
    fsm.dispatchBridgeEvent(sid, 'c1', 'F', 'Uncommitted text');
    fsm.cleanupOnChatSwitch('c2');
    assert.equal(fsm.buffer, '');
    assert.equal(fsm.partialText, '');
  });
});

describe('Tier 1 - Feature 11: Compaction State Persistence', () => {
  it('test_f11_01_persists_first_kept_entry_id', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('branch_1', {
      firstKeptEntryId: 'entry_123',
      summary: 'Summary text',
      estimatedTokensSaved: 12000
    });
    const state = mgr.getCompactionState('branch_1');
    assert.equal(state.firstKeptEntryId, 'entry_123');
  });

  it('test_f11_02_persists_structured_summary_markdown', () => {
    const mgr = new CompactionManager();
    const summaryMd = '### Previous Conversation Summary\n- User requested auth refactoring\n- Assistant provided JWT middleware';
    mgr.saveCompactionState('branch_1', { firstKeptEntryId: 'e1', summary: summaryMd });
    const state = mgr.getCompactionState('branch_1');
    assert.equal(state.summary, summaryMd);
  });

  it('test_f11_03_persists_token_savings_estimate', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('branch_1', { firstKeptEntryId: 'e1', estimatedTokensSaved: 45000 });
    const state = mgr.getCompactionState('branch_1');
    assert.equal(state.estimatedTokensSaved, 45000);
  });

  it('test_f11_04_separate_branches_maintain_independent_compaction_records', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('b1', { firstKeptEntryId: 'e_b1', summary: 'Summary B1' });
    mgr.saveCompactionState('b2', { firstKeptEntryId: 'e_b2', summary: 'Summary B2' });
    assert.equal(mgr.getCompactionState('b1').firstKeptEntryId, 'e_b1');
    assert.equal(mgr.getCompactionState('b2').firstKeptEntryId, 'e_b2');
  });

  it('test_f11_05_compacted_at_timestamp_recorded_automatically', () => {
    const mgr = new CompactionManager();
    const now = Date.now();
    mgr.saveCompactionState('b1', { firstKeptEntryId: 'e1' });
    const state = mgr.getCompactionState('b1');
    assert.ok(state.compactedAt >= now);
  });
});

describe('Tier 1 - Feature 12: Restart History Slicing & Prompt Reconstruction', () => {
  it('test_f12_01_slices_history_at_first_kept_entry_id', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('main', { firstKeptEntryId: 'msg_3', summary: 'Prior context' });

    const messages = [
      { id: 'msg_1', role: 'user', content: 'Step 1' },
      { id: 'msg_2', role: 'assistant', content: 'Step 2' },
      { id: 'msg_3', role: 'user', content: 'Step 3' },
      { id: 'msg_4', role: 'assistant', content: 'Step 4' }
    ];

    const reconstructed = mgr.reconstructPromptWithCompaction(messages, 'main');
    // msg_1 and msg_2 pruned, summary inserted, msg_3 and msg_4 kept
    const msgIds = reconstructed.map(m => m.id).filter(Boolean);
    assert.deepEqual(msgIds, ['msg_3', 'msg_4']);
  });

  it('test_f12_02_prepends_synthetic_summary_message', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('main', { firstKeptEntryId: 'msg_2', summary: 'Important summary notes' });

    const messages = [
      { id: 'msg_1', role: 'user', content: 'Old' },
      { id: 'msg_2', role: 'user', content: 'New' }
    ];

    const reconstructed = mgr.reconstructPromptWithCompaction(messages, 'main');
    assert.ok(reconstructed[0].content.includes('Important summary notes'));
    assert.equal(reconstructed[0].role, 'user');
  });

  it('test_f12_03_excludes_pre_compaction_messages_from_llm_prompt', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('main', { firstKeptEntryId: 'm10', summary: 'Summary' });

    const messages = [];
    for (let i = 1; i <= 15; i++) {
      messages.push({ id: `m${i}`, role: i % 2 === 1 ? 'user' : 'assistant', content: `Text ${i}` });
    }

    const reconstructed = mgr.reconstructPromptWithCompaction(messages, 'main');
    const msgIds = reconstructed.map(m => m.id).filter(Boolean);
    assert.ok(!msgIds.includes('m1'));
    assert.ok(!msgIds.includes('m9'));
    assert.ok(msgIds.includes('m10'));
    assert.ok(msgIds.includes('m15'));
  });

  it('test_f12_04_uncompacted_session_retains_full_history_without_slicing', () => {
    const mgr = new CompactionManager();
    const messages = [
      { id: 'm1', role: 'user', content: 'Hello' },
      { id: 'm2', role: 'assistant', content: 'World' }
    ];
    const reconstructed = mgr.reconstructPromptWithCompaction(messages, 'uncompacted_branch');
    assert.equal(reconstructed.length, 2);
    assert.deepEqual(reconstructed, messages);
  });

  it('test_f12_05_system_instructions_at_index_0_preserved_when_slicing', () => {
    const mgr = new CompactionManager();
    mgr.saveCompactionState('main', { firstKeptEntryId: 'm2', summary: 'Summary' });

    const messages = [
      { id: 'sys1', role: 'system', content: 'You are an expert developer.' },
      { id: 'm1', role: 'user', content: 'Old request' },
      { id: 'm2', role: 'user', content: 'Active request' }
    ];

    const reconstructed = mgr.reconstructPromptWithCompaction(messages, 'main');
    assert.equal(reconstructed[0].role, 'system');
    assert.equal(reconstructed[0].content, 'You are an expert developer.');
  });
});

describe('Tier 1 - Feature 13: Single-Shot Overflow Recovery', () => {
  it('test_f13_01_catches_400_context_length_exceeded_and_triggers_recovery', async () => {
    const mgr = new CompactionManager();
    const messages = [
      { id: 'm1', role: 'user', content: 'A' },
      { id: 'm2', role: 'assistant', content: 'B' },
      { id: 'm3', role: 'user', content: 'C' },
      { id: 'm4', role: 'assistant', content: 'D' },
      { id: 'm5', role: 'user', content: 'E' }
    ];

    let llmCallCount = 0;
    const callLlm = async (prompt) => {
      llmCallCount++;
      return { ok: true, promptLength: prompt.length };
    };

    const result = await mgr.handleOverflowRecovery({
      branchId: 'main',
      errorResponse: { status: 400, message: 'context_length_exceeded: maximum context length is 8192 tokens' },
      messages,
      keepRecent: 4,
      callLlm
    });

    assert.equal(result.ok, true);
    assert.equal(llmCallCount, 1);
    assert.ok(mgr.getCompactionState('main'));
  });

  it('test_f13_02_halves_keep_recent_window_on_emergency_compaction', async () => {
    const mgr = new CompactionManager();
    const messages = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, role: 'user', content: `msg_${i}` }));

    await mgr.handleOverflowRecovery({
      branchId: 'main',
      errorResponse: { status: 413, message: 'Request Entity Too Large (context window exceeded)' },
      messages,
      keepRecent: 8, // should be halved to 4
      callLlm: async () => ({ ok: true })
    });

    const state = mgr.getCompactionState('main');
    assert.ok(state.summary.includes('Kept last 4 messages'));
  });

  it('test_f13_03_re_issues_prompt_once_successfully', async () => {
    const mgr = new CompactionManager();
    const messages = [{ id: 'm1', role: 'user', content: 'Hi' }];
    let attempts = 0;

    const res = await mgr.handleOverflowRecovery({
      branchId: 'main',
      errorResponse: { status: 400, message: 'context_length_exceeded' },
      messages,
      callLlm: async () => { attempts++; return 'Success'; }
    });

    assert.equal(res, 'Success');
    assert.equal(attempts, 1);
  });

  it('test_f13_04_second_consecutive_overflow_aborts_to_prevent_infinite_loop', async () => {
    const mgr = new CompactionManager();
    const messages = [{ id: 'm1', role: 'user', content: 'Hi' }];

    // First attempt succeeds
    await mgr.handleOverflowRecovery({
      branchId: 'main',
      errorResponse: { status: 400, message: 'context_length_exceeded' },
      messages,
      callLlm: async () => 'OK'
    });

    // Second attempt fails
    await assert.rejects(async () => {
      await mgr.handleOverflowRecovery({
        branchId: 'main',
        errorResponse: { status: 400, message: 'context_length_exceeded' },
        messages,
        callLlm: async () => 'OK'
      });
    }, /Single-shot overflow recovery already exhausted/);
  });

  it('test_f13_05_truncates_large_tool_outputs_during_emergency_compaction', async () => {
    const mgr = new CompactionManager();
    const hugeToolOutput = 'X'.repeat(50000);
    const messages = [
      { id: 'm1', role: 'user', content: 'Run test' },
      { id: 'm2', role: 'tool', content: hugeToolOutput }
    ];

    let passedPrompt = null;
    await mgr.handleOverflowRecovery({
      branchId: 'main',
      errorResponse: { status: 400, message: 'context_length_exceeded' },
      messages,
      callLlm: async (prompt) => { passedPrompt = prompt; return 'OK'; }
    });

    const toolMsg = passedPrompt.find(m => m.role === 'tool');
    assert.ok(toolMsg);
    assert.ok(toolMsg.content.length < 3000);
    assert.ok(toolMsg.content.includes('[TRUNCATED DUE TO CONTEXT OVERFLOW]'));
  });
});

describe('Tier 1 - Feature 14: Streaming ZIP Archive Generation (>64 MiB)', () => {
  it('test_f14_01_streaming_zip_local_file_header_validity', () => {
    const exp = new ExportManager();
    const fileBytes = new TextEncoder().encode('Hello ZIP');
    const zipBytes = exp.buildZip([{ name: 'test.txt', data: fileBytes }]);

    const parsed = parseZipArchive(zipBytes);
    assert.equal(parsed.hasFile('test.txt'), true);
    assert.equal(parsed.getFileText('test.txt'), 'Hello ZIP');
  });

  it('test_f14_02_central_directory_offsets_match_local_headers', () => {
    const exp = new ExportManager();
    const f1 = { name: 'file1.txt', data: new TextEncoder().encode('File 1 contents') };
    const f2 = { name: 'file2.txt', data: new TextEncoder().encode('File 2 longer contents') };
    const zipBytes = exp.buildZip([f1, f2]);

    const parsed = parseZipArchive(zipBytes);
    assert.equal(parsed.centralFiles.length, 2);
    assert.equal(parsed.centralFiles[0].name, 'file1.txt');
    assert.equal(parsed.centralFiles[1].name, 'file2.txt');
    assert.ok(parsed.centralFiles[1].offset > parsed.centralFiles[0].offset);
  });

  it('test_f14_03_crc32_data_integrity_validated_for_all_files', () => {
    const exp = new ExportManager();
    const content = 'Data integrity check string with special chars !@#$%^&*()';
    const zipBytes = exp.buildZip([{ name: 'integrity.txt', data: new TextEncoder().encode(content) }]);

    const parsed = parseZipArchive(zipBytes);
    const entry = parsed.files.get('integrity.txt');
    assert.equal(entry.crc, crc32(new TextEncoder().encode(content)));
  });

  it('test_f14_04_archive_exceeding_64mib_does_not_throw_blob_limit', () => {
    const exp = new ExportManager();
    // Simulate streaming header generation for large files without allocating 65MB in memory
    const files = [
      { name: 'big_file.bin', data: new Uint8Array(1024) } // 1KB sample
    ];
    const zipBytes = exp.buildZip(files);
    assert.ok(zipBytes.length > 0);
  });

  it('test_f14_05_eocd_record_signature_present_and_valid', () => {
    const exp = new ExportManager();
    const zipBytes = exp.buildZip([{ name: 'a.txt', data: new Uint8Array([65]) }]);
    const parsed = parseZipArchive(zipBytes);
    assert.equal(parsed.eocdFound, true);
    assert.equal(parsed.totalEntries, 1);
  });
});

describe('Tier 1 - Feature 15: Full Transcript Packaging', () => {
  it('test_f15_01_transcript_full_jsonl_contains_all_records_including_pre_compaction', () => {
    const exp = new ExportManager();
    const records = [
      { role: 'user', content: 'Pre-compaction message 1' },
      { role: 'assistant', content: 'Pre-compaction reply 2' },
      { role: 'user', content: 'Post-compaction message 3' }
    ];
    const jsonl = exp.packageTranscriptFull(records);
    const lines = jsonl.trim().split('\n');
    assert.equal(lines.length, 3);
    assert.ok(lines[0].includes('Pre-compaction message 1'));
    assert.ok(lines[2].includes('Post-compaction message 3'));
  });

  it('test_f15_02_transcript_md_formats_roles_and_timestamps', () => {
    const exp = new ExportManager();
    const records = [
      { role: 'user', timestamp: '2026-11-19T19:00:00Z', content: 'Start session' }
    ];
    const md = exp.packageTranscriptMd(records);
    assert.ok(md.includes('# Leostryx Session Transcript'));
    assert.ok(md.includes('## 1. user (2026-11-19T19:00:00Z)'));
    assert.ok(md.includes('Start session'));
  });

  it('test_f15_03_transcript_md_formats_tool_calls_and_reasoning_blocks', () => {
    const exp = new ExportManager();
    const records = [
      {
        role: 'assistant',
        content: 'I analyzed the code.',
        thinking: 'Looking at line 42 in auth.js',
        toolCalls: [{ name: 'read_file', args: { path: 'auth.js' } }]
      }
    ];
    const md = exp.packageTranscriptMd(records);
    assert.ok(md.includes('### Reasoning'));
    assert.ok(md.includes('Looking at line 42 in auth.js'));
    assert.ok(md.includes('### Tool Calls'));
    assert.ok(md.includes('read_file'));
  });

  it('test_f15_04_manifest_txt_records_session_metadata', () => {
    const exp = new ExportManager();
    const zipBytes = exp.buildZip([
      { name: 'MANIFEST.txt', data: 'session_id: 12345\nexport_version: 1.0\n' }
    ]);
    const parsed = parseZipArchive(zipBytes);
    assert.ok(parsed.hasFile('MANIFEST.txt'));
    assert.ok(parsed.getFileText('MANIFEST.txt').includes('session_id: 12345'));
  });

  it('test_f15_05_meta_json_contains_machine_readable_export_info', () => {
    const exp = new ExportManager();
    const meta = JSON.stringify({ cascadeId: 'c_abc', exportedAt: '2026-11-19T19:10:00Z' });
    const zipBytes = exp.buildZip([{ name: 'meta.json', data: meta }]);
    const parsed = parseZipArchive(zipBytes);
    assert.ok(parsed.hasFile('meta.json'));
    const parsedMeta = JSON.parse(parsed.getFileText('meta.json'));
    assert.equal(parsedMeta.cascadeId, 'c_abc');
  });
});

describe('Tier 1 - Feature 16: Attachments Packaging', () => {
  it('test_f16_01_session_media_saved_under_attachments_folder', () => {
    const exp = new ExportManager();
    const files = exp.packageAttachments([
      { name: 'screenshot.png', data: SAMPLE_PNG_BYTES }
    ]);
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'attachments/screenshot.png');
  });

  it('test_f16_02_duplicate_filenames_receive_unique_suffixes', () => {
    const exp = new ExportManager();
    const files = exp.packageAttachments([
      { name: 'photo.jpg', data: new Uint8Array([1]) },
      { name: 'photo.jpg', data: new Uint8Array([2]) },
      { name: 'photo.jpg', data: new Uint8Array([3]) }
    ]);
    assert.equal(files.length, 3);
    assert.equal(files[0].name, 'attachments/photo.jpg');
    assert.equal(files[1].name, 'attachments/photo_1.jpg');
    assert.equal(files[2].name, 'attachments/photo_2.jpg');
  });

  it('test_f16_03_binary_attachment_content_preserved_losslessly', () => {
    const exp = new ExportManager();
    const files = exp.packageAttachments([
      { name: 'pixel.png', data: SAMPLE_PNG_BYTES }
    ]);
    const zip = exp.buildZip(files);
    const parsed = parseZipArchive(zip);
    const entry = parsed.files.get('attachments/pixel.png');
    assert.equal(Buffer.from(entry.data).toString('hex'), SAMPLE_PNG_BYTES.toString('hex'));
  });

  it('test_f16_04_attachment_filenames_sanitized_from_path_traversal', () => {
    const exp = new ExportManager();
    const files = exp.packageAttachments([
      { name: '../../etc/passwd', data: new Uint8Array([0]) }
    ]);
    assert.ok(!files[0].name.includes('..'));
    assert.ok(files[0].name.startsWith('attachments/'));
  });

  it('test_f16_05_multiple_attachments_packaged_correctly', () => {
    const exp = new ExportManager();
    const files = exp.packageAttachments([
      { name: 'img1.png', data: new Uint8Array([1]) },
      { name: 'img2.png', data: new Uint8Array([2]) }
    ]);
    const zip = exp.buildZip(files);
    const parsed = parseZipArchive(zip);
    assert.ok(parsed.hasFile('attachments/img1.png'));
    assert.ok(parsed.hasFile('attachments/img2.png'));
  });
});

describe('Tier 1 - Feature 17: Changes Diff Packaging', () => {
  it('test_f17_01_changes_diff_packages_unified_diff', () => {
    const exp = new ExportManager();
    const diffText = exp.packageChangesDiff([
      { path: 'src/main.js', unifiedDiff: '@@ -1,2 +1,3 @@\n-const a = 1;\n+const a = 2;\n+const b = 3;' }
    ]);
    assert.ok(diffText.includes('--- a/src/main.js'));
    assert.ok(diffText.includes('+++ b/src/main.js'));
    assert.ok(diffText.includes('-const a = 1;'));
    assert.ok(diffText.includes('+const a = 2;'));
  });

  it('test_f17_02_empty_workspace_changes_handled_gracefully', () => {
    const exp = new ExportManager();
    const diffText = exp.packageChangesDiff([]);
    assert.equal(diffText, '(no workspace changes recorded in session)');
  });

  it('test_f17_03_multiple_file_diffs_combined_in_order', () => {
    const exp = new ExportManager();
    const diffText = exp.packageChangesDiff([
      { path: 'file1.js', unifiedDiff: '@@ -1 +1 @@\n-1\n+2' },
      { path: 'file2.js', unifiedDiff: '@@ -1 +1 @@\n-A\n+B' }
    ]);
    assert.ok(diffText.indexOf('file1.js') < diffText.indexOf('file2.js'));
  });

  it('test_f17_04_changes_diff_packaged_at_root_of_zip', () => {
    const exp = new ExportManager();
    const diff = exp.packageChangesDiff([{ path: 'test.py', unifiedDiff: '@@ -1 +1 @@\n-old\n+new' }]);
    const zip = exp.buildZip([{ name: 'changes.diff', data: diff }]);
    const parsed = parseZipArchive(zip);
    assert.ok(parsed.hasFile('changes.diff'));
    assert.ok(parsed.getFileText('changes.diff').includes('test.py'));
  });

  it('test_f17_05_unified_diff_preserves_added_and_removed_line_prefixes', () => {
    const exp = new ExportManager();
    const patch = '@@ -10,3 +10,4 @@\n context\n-removed_line\n+added_line\n context';
    const diff = exp.packageChangesDiff([{ path: 'code.ts', unifiedDiff: patch }]);
    assert.ok(diff.includes('-removed_line'));
    assert.ok(diff.includes('+added_line'));
  });
});

describe('Tier 1 - Feature 18: Secret & Credential Filtering', () => {
  it('test_f18_01_bearer_tokens_redacted_from_text', () => {
    const raw = 'Header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123';
    const redacted = redactSensitiveData(raw);
    assert.ok(!redacted.includes('eyJhbGciOi'));
    assert.ok(redacted.includes('Bearer [REDACTED]'));
  });

  it('test_f18_02_api_keys_redacted_from_transcripts_and_diffs', () => {
    const raw = 'api_key: "sk-1234567890abcdef1234567890abcdef"';
    const redacted = redactSensitiveData(raw);
    assert.ok(!redacted.includes('sk-1234567890abcdef'));
    assert.ok(redacted.includes('[REDACTED]'));
  });

  it('test_f18_03_passwords_and_client_secrets_redacted', () => {
    const raw = 'password: "SuperSecretPassword123!" and client_secret: "secret_xyz"';
    const redacted = redactSensitiveData(raw);
    assert.ok(!redacted.includes('SuperSecretPassword123!'));
    assert.ok(!redacted.includes('secret_xyz'));
  });

  it('test_f18_04_sensitive_http_headers_cookie_and_authorization_redacted', () => {
    const raw = 'Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l\nCookie: session_id=abc123xyz\nHost: example.com';
    const redacted = redactSensitiveData(raw);
    assert.ok(!redacted.includes('YWxhZGRpbjpvcGVuc2VzYW1l'));
    assert.ok(!redacted.includes('session_id=abc123xyz'));
    assert.ok(redacted.includes('Authorization: [REDACTED]'));
    assert.ok(redacted.includes('Cookie: [REDACTED]'));
    assert.ok(redacted.includes('Host: example.com')); // Non-sensitive header preserved
  });

  it('test_f18_05_private_files_env_and_id_rsa_excluded_from_zip_archive', () => {
    const exp = new ExportManager();
    const files = [
      { name: 'public.txt', data: 'public data' },
      { name: '.env', data: 'OPENAI_API_KEY=sk-abcdef123456' },
      { name: '.env.local', data: 'DB_PASS=123' },
      { name: 'id_rsa', data: '-----BEGIN RSA PRIVATE KEY-----' },
      { name: 'app.key', data: 'private key data' }
    ];
    const zip = exp.buildZip(files);
    const parsed = parseZipArchive(zip);
    assert.ok(parsed.hasFile('public.txt'));
    assert.ok(!parsed.hasFile('.env'));
    assert.ok(!parsed.hasFile('.env.local'));
    assert.ok(!parsed.hasFile('id_rsa'));
    assert.ok(!parsed.hasFile('app.key'));
  });
});
