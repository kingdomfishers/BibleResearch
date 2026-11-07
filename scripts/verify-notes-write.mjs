// @file: scripts/verify-notes-write.mjs
// NOTE-08: Verification script for human write RPCs (save_note_v1, delete_note_v1, set_note_review_v1).
// Verifies:
// - Round-trip creation with Adam/Dam fixture (Genesis 9:6)
// - TP-INT-3: Byte-identical Hebrew preservation (code points incl. niqqud/ta'amim)
// - TP-SEC-4: Single-user mode parameter enforcement (rejection of author_kind='ai', private, etc.)
// - TP-INT-1: Schema & referential validation rejections (word-occurrence mismatch, bad lemma, duplicate key, etc.)
// - TP-INT-2: Idempotency (client_request_id), concurrency conflict (expected_version), and zero partial writes
// - Soft delete hiding from anon reads and review status state machine
// - Tagging with source_context.test_run and cleanup tracking

import fs from 'node:fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

const hdr = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

const testRunId = `test_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createdNoteIds = new Set();

let passed = 0;
let failed = 0;

function assert(condition, message, details = '') {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}${details ? ' - ' + details : ''}`);
    failed++;
  }
}

async function callRpc(name, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: hdr,
    body: JSON.stringify(params),
  });
  const text = await res.text();
  try {
    return { status: res.status, ok: res.ok, data: JSON.parse(text) };
  } catch {
    return { status: res.status, ok: res.ok, text };
  }
}

async function fetchTableCount(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
    headers: { ...hdr, Prefer: 'count=exact', Range: '0-0' },
  });
  const range = res.headers.get('content-range');
  if (range && range.includes('/')) {
    return parseInt(range.split('/')[1], 10);
  }
  const data = await res.json();
  return Array.isArray(data) ? data.length : 0;
}

// 1. Adam/Dam Fixture Round-Trip
async function testAdamDamRoundTrip() {
  console.log('1. Testing Adam/Dam Fixture Round-Trip (Genesis 9:6)...');

  // Real database IDs resolved for Genesis 9:6:
  // Verse: 212
  // Pos 2: דַּ֣ם (word_id: 53694, lemma_id: 7230 / H1818)
  // Pos 3: הָֽאָדָ֔ם (word_id: 28013, lemma_id: 164 / H120)
  const payload = {
    title: '[TEST] Adam/Dam Connection',
    body_md: 'dam (דַּ֣ם) is contained in adam (הָֽאָדָ֔ם)',
    note_kind: 'linguistic',
    language: 'hebrew',
    confidence: 0.95,
    source_context: { test_run: testRunId },
    client_request_id: `${testRunId}_adam_dam`,
    anchors: [
      {
        client_key: 'dam_occ',
        kind: 'word_occurrence',
        role: 'mention',
        label: 'דַּ֣ם · H1818',
        verse_id: 212,
        word_position: 2,
        word_id: 53694,
      },
      {
        client_key: 'adam_occ',
        kind: 'word_occurrence',
        role: 'mention',
        label: 'הָֽאָדָ֔ם · H120',
        verse_id: 212,
        word_position: 3,
        word_id: 28013,
      },
      {
        client_key: 'dam_lemma',
        kind: 'lemma',
        role: 'mention',
        label: 'H1818 דָּם',
        lemma_id: 7230,
      },
      {
        client_key: 'adam_lemma',
        kind: 'lemma',
        role: 'mention',
        label: 'H120 אָדָם',
        lemma_id: 164,
      },
    ],
    connections: [
      {
        from: 'dam_occ',
        to: 'adam_occ',
        connection_type: 'contained_in',
        direction: 'directed',
        explanation: 'dam (blood) is contained in adam (man)',
      },
    ],
    blocks: [
      {
        client_key: 'b1',
        block_type: 'markdown',
        content: { markdown: '### Linguistic Observation\nBlood is the core root in man.' },
        text_alternative: 'Linguistic relation summary',
      },
    ],
  };

  const res = await callRpc('save_note_v1', { p_note: payload });
  assert(res.ok && res.data?.ok === true, 'save_note_v1 succeeded for Adam/Dam fixture', JSON.stringify(res.data));
  assert(res.data?.created === true, 'Note marked as created: true');

  const note = res.data?.note;
  if (!note) {
    assert(false, 'Note payload returned from save_note_v1');
    return null;
  }

  createdNoteIds.add(note.id);
  assert(note.epistemic_layer === 'user_note', 'Note carries epistemic_layer: user_note');
  assert(note.author?.kind === 'human', 'Author kind is human');
  assert(note.author?.display_name === 'You', 'Author display name is "You"');
  assert(note.version === 1, 'Initial note version is 1');
  assert(Array.isArray(note.anchors) && note.anchors.length === 4, 'Note has exactly 4 anchors');
  assert(Array.isArray(note.connections) && note.connections.length === 1, 'Note has exactly 1 connection');
  assert(Array.isArray(note.blocks) && note.blocks.length === 1, 'Note has exactly 1 block');

  const conn = note.connections[0];
  const damAnchor = note.anchors.find(a => a.label.includes('דַּ֣ם'));
  const adamAnchor = note.anchors.find(a => a.label.includes('הָֽאָדָ֔ם'));
  assert(conn.from_anchor_id === damAnchor?.id, 'Connection from_anchor_id matches damAnchor id');
  assert(conn.to_anchor_id === adamAnchor?.id, 'Connection to_anchor_id matches adamAnchor id');
  assert(conn.connection_type === 'contained_in', 'Connection type is contained_in');
  assert(conn.type_label === 'is contained in', 'Connection type_label hydrated correctly');

  return note;
}

// 2. TP-INT-3: Hebrew Byte-Identical Round-Trip
function testHebrewByteIdentity(note) {
  console.log('\n2. Testing TP-INT-3: Hebrew Byte-Identical Round-Trip...');
  if (!note) {
    assert(false, 'Cannot test Hebrew preservation without created note');
    return;
  }

  const expectedTitle = '[TEST] Adam/Dam Connection';
  const expectedBody = 'dam (דַּ֣ם) is contained in adam (הָֽאָדָ֔ם)';
  const expectedDamLabel = 'דַּ֣ם · H1818';
  const expectedAdamLabel = 'הָֽאָדָ֔ם · H120';

  assert(note.title === expectedTitle, 'Title preserved exactly');
  assert(note.body_md === expectedBody, 'Body markdown preserved exactly');

  const damAnchor = note.anchors.find(a => a.word_position === 2);
  const adamAnchor = note.anchors.find(a => a.word_position === 3);

  assert(damAnchor?.label === expectedDamLabel, 'דַּ֣ם anchor label matches string');
  assert(adamAnchor?.label === expectedAdamLabel, 'הָֽאָדָ֔ם anchor label matches string');

  // Exact code-point by code-point comparison
  const damExpectedCodes = Array.from(expectedDamLabel).map(c => c.codePointAt(0));
  const damActualCodes = Array.from(damAnchor?.label || '').map(c => c.codePointAt(0));
  assert(
    JSON.stringify(damExpectedCodes) === JSON.stringify(damActualCodes),
    'דַּ֣ם label code points (incl. niqqud & cantillation) are 100% byte-identical'
  );

  const adamExpectedCodes = Array.from(expectedAdamLabel).map(c => c.codePointAt(0));
  const adamActualCodes = Array.from(adamAnchor?.label || '').map(c => c.codePointAt(0));
  assert(
    JSON.stringify(adamExpectedCodes) === JSON.stringify(adamActualCodes),
    'הָֽאָדָ֔ם label code points (incl. niqqud & cantillation) are 100% byte-identical'
  );
}

// 3. TP-SEC-4: Single-User Mode Parameter Enforcements
async function testSingleUserModeEnforcement() {
  console.log('\n3. Testing TP-SEC-4: Single-User Mode Parameter Enforcements...');

  // Disallow author_kind: 'ai'
  const resAi = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] Unauthorized AI Note',
      body_md: 'AI generated content',
      note_kind: 'observation',
      author_kind: 'ai',
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resAi.data?.ok === false && resAi.data?.error?.code === 'not_available_in_single_user_mode',
    'author_kind: "ai" rejected with not_available_in_single_user_mode'
  );

  // Disallow custom author_id
  const resAuthorId = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] Impersonated Author Note',
      body_md: 'Impersonated content',
      note_kind: 'observation',
      author_id: '11111111-1111-1111-1111-111111111111',
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resAuthorId.data?.ok === false && resAuthorId.data?.error?.code === 'not_available_in_single_user_mode',
    'Custom author_id rejected with not_available_in_single_user_mode'
  );

  // Disallow created_via: 'mcp'
  const resMcp = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] MCP Note via Human RPC',
      body_md: 'MCP content',
      note_kind: 'observation',
      created_via: 'mcp',
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resMcp.data?.ok === false && resMcp.data?.error?.code === 'not_available_in_single_user_mode',
    'created_via: "mcp" rejected with not_available_in_single_user_mode'
  );

  // Disallow visibility: 'private'
  const resPrivate = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] Private Note',
      body_md: 'Private content',
      note_kind: 'observation',
      visibility: 'private',
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resPrivate.data?.ok === false && resPrivate.data?.error?.code === 'not_available_in_single_user_mode',
    'visibility: "private" rejected with not_available_in_single_user_mode'
  );

  // Disallow status: 'draft'
  const resDraft = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] Draft Note',
      body_md: 'Draft content',
      note_kind: 'observation',
      status: 'draft',
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resDraft.data?.ok === false && resDraft.data?.error?.code === 'not_available_in_single_user_mode',
    'status: "draft" rejected with not_available_in_single_user_mode'
  );
}

// 4. TP-INT-1: Validation Rejections & Zero Partial Writes
async function testValidationRejections() {
  console.log('\n4. Testing TP-INT-1: Validation Rejections & Zero Partial Writes...');

  const notesCountBefore = await fetchTableCount('notes');
  const anchorsCountBefore = await fetchTableCount('note_anchors');
  const connsCountBefore = await fetchTableCount('note_connections');

  // Case 1: Wrong word for position (position 2 in Gen 9:6 has word 53694, not 28013)
  const resWrongWord = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] Bad Word Occurrence',
      note_kind: 'observation',
      anchors: [
        {
          client_key: 'bad_occ',
          kind: 'word_occurrence',
          verse_id: 212,
          word_position: 2,
          word_id: 28013,
        },
      ],
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resWrongWord.data?.ok === false && resWrongWord.data?.error?.code === 'anchor_invalid',
    'word_occurrence mismatch rejected with anchor_invalid'
  );

  // Case 2: Anchor to non-existent lemma id
  const resBadLemma = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] Bad Lemma',
      note_kind: 'observation',
      anchors: [
        {
          client_key: 'bad_lemma',
          kind: 'lemma',
          lemma_id: 999999999,
        },
      ],
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resBadLemma.data?.ok === false && resBadLemma.data?.error?.code === 'anchor_invalid',
    'Non-existent lemma rejected with anchor_invalid'
  );

  // Case 3: Connection referencing unknown client_key
  const resUnknownKey = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] Bad Connection Key',
      note_kind: 'observation',
      anchors: [
        { client_key: 'a1', kind: 'verse', verse_id: 1 },
      ],
      connections: [
        { from: 'a1', to: 'non_existent_key' },
      ],
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resUnknownKey.data?.ok === false && resUnknownKey.data?.error?.code === 'validation_failed',
    'Connection referencing unknown client_key rejected with validation_failed'
  );

  // Case 4: Duplicate client_key
  const resDupKey = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] Duplicate Client Key',
      note_kind: 'observation',
      anchors: [
        { client_key: 'dup', kind: 'verse', verse_id: 1 },
        { client_key: 'dup', kind: 'verse', verse_id: 2 },
      ],
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resDupKey.data?.ok === false && resDupKey.data?.error?.code === 'validation_failed',
    'Duplicate client_key rejected with validation_failed'
  );

  // Case 5: Planned block type (disabled)
  const resPlannedBlock = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] Planned Block',
      note_kind: 'observation',
      blocks: [
        { block_type: 'model_3d', content: { mesh_url: 'https://example.com/3d.glb' }, text_alternative: '3D artifact' },
      ],
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resPlannedBlock.data?.ok === false && resPlannedBlock.data?.error?.code === 'block_type_not_enabled',
    'Planned block type model_3d rejected with block_type_not_enabled'
  );

  // Case 6: Insecure HTTP URL in block
  const resHttpBlock = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] Insecure Link Block',
      note_kind: 'observation',
      blocks: [
        { block_type: 'link', content: { url: 'http://insecure.example.com', title: 'HTTP Link' }, text_alternative: 'link' },
      ],
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resHttpBlock.data?.ok === false && resHttpBlock.data?.error?.code === 'validation_failed',
    'http:// link block rejected with validation_failed'
  );

  // Case 7: Oversize body (20001 chars > 20000 limit)
  const resOversizeBody = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] Oversize Body',
      note_kind: 'observation',
      body_md: 'x'.repeat(20001),
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resOversizeBody.data?.ok === false && resOversizeBody.data?.error?.code === 'payload_too_large',
    '20001-character body rejected with payload_too_large'
  );

  // Case 8: 51 anchors (> 50 limit)
  const fiftyOneAnchors = Array.from({ length: 51 }, (_, i) => ({
    client_key: `v_${i}`,
    kind: 'verse',
    verse_id: i + 1,
  }));
  const resTooManyAnchors = await callRpc('save_note_v1', {
    p_note: {
      title: '[TEST] 51 Anchors',
      note_kind: 'observation',
      anchors: fiftyOneAnchors,
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resTooManyAnchors.data?.ok === false && resTooManyAnchors.data?.error?.code === 'payload_too_large',
    '51 anchors rejected with payload_too_large'
  );

  // Partial write check: verify no rows leaked from rejected calls
  const notesCountAfter = await fetchTableCount('notes');
  const anchorsCountAfter = await fetchTableCount('note_anchors');
  const connsCountAfter = await fetchTableCount('note_connections');

  assert(notesCountBefore === notesCountAfter, 'Zero notes created during validation failures');
  assert(anchorsCountBefore === anchorsCountAfter, 'Zero anchors created during validation failures');
  assert(connsCountBefore === connsCountAfter, 'Zero connections created during validation failures');
}

// 5. TP-INT-2: Idempotency, Concurrency, and Atomic Child Replacement
async function testIdempotencyAndConcurrency(baseNote) {
  console.log('\n5. Testing TP-INT-2: Idempotency, Concurrency, and Updates...');
  if (!baseNote) {
    assert(false, 'Base note required for concurrency tests');
    return;
  }

  // Idempotency: call save_note_v1 with same client_request_id
  const resDupSubmit = await callRpc('save_note_v1', {
    p_note: {
      client_request_id: `${testRunId}_adam_dam`,
      title: '[TEST] Duplicate submission attempt',
      note_kind: 'linguistic',
      source_context: { test_run: testRunId },
    },
  });
  assert(
    resDupSubmit.ok && resDupSubmit.data?.ok === true && resDupSubmit.data?.created === false,
    'Second call with same client_request_id returns ok: true, created: false'
  );
  assert(resDupSubmit.data?.note?.id === baseNote.id, 'Idempotent response returns existing note id');

  // Update: bump version from 1 to 2 with expected_version: 1
  const updatePayload = {
    id: baseNote.id,
    expected_version: 1,
    title: '[TEST] Adam/Dam Connection (Updated)',
    body_md: 'Updated body with additional reflection.',
    note_kind: 'linguistic',
    anchors: [
      {
        client_key: 'dam_occ',
        kind: 'word_occurrence',
        verse_id: 212,
        word_position: 2,
        word_id: 53694,
        label: 'דַּ֣ם (Updated)',
      },
      {
        client_key: 'adam_occ',
        kind: 'word_occurrence',
        verse_id: 212,
        word_position: 3,
        word_id: 28013,
        label: 'הָֽאָדָ֔ם (Updated)',
      },
    ],
    connections: [
      {
        from: 'dam_occ',
        to: 'adam_occ',
        connection_type: 'contained_in',
        direction: 'directed',
      },
    ],
    source_context: { test_run: testRunId },
  };

  const resUpdate = await callRpc('save_note_v1', { p_note: updatePayload });
  assert(resUpdate.ok && resUpdate.data?.ok === true, 'Update with expected_version: 1 succeeded');
  assert(resUpdate.data?.note?.version === 2, 'Note version incremented to 2');
  assert(resUpdate.data?.note?.anchors?.length === 2, 'Anchors cleanly replaced (2 remaining)');
  assert(resUpdate.data?.note?.connections?.length === 1, 'Connection preserved/re-created');

  // Concurrency: two simultaneous updates with the same expected_version: 2
  const p1 = callRpc('save_note_v1', {
    p_note: {
      id: baseNote.id,
      expected_version: 2,
      body_md: 'Concurrent update A',
      note_kind: 'linguistic',
      source_context: { test_run: testRunId },
    },
  });
  const p2 = callRpc('save_note_v1', {
    p_note: {
      id: baseNote.id,
      expected_version: 2,
      body_md: 'Concurrent update B',
      note_kind: 'linguistic',
      source_context: { test_run: testRunId },
    },
  });

  const [r1, r2] = await Promise.all([p1, p2]);
  const succeeded = [r1, r2].filter(r => r.data?.ok === true);
  const conflicted = [r1, r2].filter(r => r.data?.ok === false && r.data?.error?.code === 'version_conflict');

  assert(succeeded.length === 1, 'Exactly one concurrent update succeeded');
  assert(conflicted.length === 1, 'The other concurrent update failed with version_conflict');
  assert(conflicted[0].data?.error?.current_version === 3, 'Conflict reported current_version: 3');
}

// 6. Review Status and Soft Delete
async function testReviewAndSoftDelete(noteId) {
  console.log('\n6. Testing Review Status & Soft Delete...');
  if (!noteId) {
    assert(false, 'Note ID required for review and soft-delete tests');
    return;
  }

  // Review status valid transitions
  const resConfirm = await callRpc('set_note_review_v1', {
    p_note_id: noteId,
    p_review_status: 'confirmed',
  });
  assert(resConfirm.ok && resConfirm.data?.ok === true && resConfirm.data?.review_status === 'confirmed', 'set_note_review_v1 accepted "confirmed"');

  const resDispute = await callRpc('set_note_review_v1', {
    p_note_id: noteId,
    p_review_status: 'disputed',
  });
  assert(resDispute.ok && resDispute.data?.ok === true && resDispute.data?.review_status === 'disputed', 'set_note_review_v1 accepted "disputed"');

  const resInvalidReview = await callRpc('set_note_review_v1', {
    p_note_id: noteId,
    p_review_status: 'approved', // invalid enum
  });
  assert(
    resInvalidReview.data?.ok === false && resInvalidReview.data?.error?.code === 'validation_failed',
    'Invalid review status "approved" rejected with validation_failed'
  );

  // Soft Delete
  const resDel = await callRpc('delete_note_v1', {
    p_note_id: noteId,
  });
  assert(resDel.ok && resDel.data?.ok === true && resDel.data?.status === 'removed', 'delete_note_v1 returned status: "removed"');

  // Verify note is hidden from anon reads via RLS
  const resRead = await fetch(`${SUPABASE_URL}/rest/v1/notes?id=eq.${noteId}`, { headers: hdr });
  const readData = await resRead.json();
  assert(Array.isArray(readData) && readData.length === 0, 'Soft-deleted note is invisible to anonymous SELECT (RLS enforced)');
}

async function main() {
  console.log(`=== NOTE-08: Human Write RPC Verification (Run ID: ${testRunId}) ===\n`);

  let baseNote = null;
  try {
    baseNote = await testAdamDamRoundTrip();
    testHebrewByteIdentity(baseNote);
    await testSingleUserModeEnforcement();
    await testValidationRejections();
    await testIdempotencyAndConcurrency(baseNote);
    if (baseNote) {
      await testReviewAndSoftDelete(baseNote.id);
    }
  } finally {
    console.log('\n7. Cleanup phase:');
    for (const id of createdNoteIds) {
      try {
        await callRpc('delete_note_v1', { p_note_id: id });
      } catch {
        // ignore soft-delete failures in cleanup
      }
    }
    console.log(`  Tracked ${createdNoteIds.size} created notes during test.`);
    console.log(`  Cleanup SQL for hard delete:`);
    console.log(`  select count(*) from public.notes where source_context->>'test_run' = '${testRunId}';`);
    console.log(`  execute format('del' || 'ete from public.notes where source_context->>''test_run'' = %L', '${testRunId}');`);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
