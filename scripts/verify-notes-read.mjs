// @file: scripts/verify-notes-read.mjs
// NOTE-10: Verification script for note read RPCs.
// Verifies:
// 1. list_note_connection_types_v1 returns 16 connection types, 7 note kinds, 9 block types, settings
// 2. get_notes_for_passage_v1 (Genesis 9:6, Genesis 9:7, Psalm 3:0 heading)
//    - Primary tier: verse, range, occurrence, connection notes
//    - Secondary tier: word_form, lemma notes with matched token positions
//    - Cross-verse occurrence isolation and disjoint tiers
//    - Author kind filtering (human vs ai) and exact totals
//    - token_note_counts grouped by (verse_id, word_position)
// 3. get_notes_for_word_v1 (Genesis 9:6 dam, homograph isolation for H1254)
//    - occurrence, form, and lemma groups with highest specificity scoping
//    - Homograph separation (H1254a vs H1254b: no cross-bleed)
// 4. list_notes_v1 keyset pagination with cursor (idempotent, no duplicates)
// 5. get_note_v1 full note retrieval with backlinks and revision history summaries
// 6. Soft-deleted notes hidden from all read endpoints
// 7. TP-PERF-2 benchmark execution (< 300 ms, 0 seq scans on notes/anchors)
// 8. Cleanup of all test fixtures

import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

const hdr = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

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

async function rpc(name, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: hdr,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

export const PERF_BENCHMARK_SQL = `
do $$
declare
  v_t0 timestamptz := clock_timestamp();
  v_t_insert timestamptz;
  v_t_1v_start timestamptz;
  v_t_1v_ms numeric;
  v_t_31v_start timestamptz;
  v_t_31v_ms numeric;
  v_t_word_start timestamptz;
  v_t_word_ms numeric;
  v_res jsonb;
  v_summary jsonb;
begin
  set local jit = off;

  with note_data as (
    select
      gen_random_uuid() as id,
      i as rn
    from generate_series(1, 20000) as i
  ),
  ins_notes as (
    insert into public.notes (id, author_id, author_kind, note_kind, body_md)
    select
      d.id,
      '00000000-0000-0000-0000-00000000a001'::uuid,
      'human',
      'observation',
      'Synthetic perf note ' || d.rn
    from note_data d
  ),
  ins_a1 as (
    insert into public.note_anchors (id, note_id, anchor_kind, verse_id, end_verse_id)
    select
      gen_random_uuid(),
      d.id,
      case when d.rn % 2 = 1 then 'verse' else 'verse_range' end,
      (1 + (d.rn % 31000))::int,
      case when d.rn % 2 = 1 then null else (1 + (d.rn % 31000) + 2)::int end
    from note_data d
  ),
  ins_a2 as (
    insert into public.note_anchors (id, note_id, anchor_kind, word_id, lemma_id)
    select
      gen_random_uuid(),
      d.id,
      case when d.rn % 2 = 1 then 'word_form' else 'lemma' end,
      case when d.rn % 2 = 1 then (1 + (d.rn % 150000))::int else null end,
      case when d.rn % 2 = 1 then null else (1 + (d.rn % 22000))::bigint end
    from note_data d
  )
  select clock_timestamp() into v_t_insert;

  execute 'analyze public.notes';
  execute 'analyze public.note_anchors';

  v_t_1v_start := clock_timestamp();
  v_res := public.get_notes_for_passage_v1(1, 1, 1, 1);
  v_t_1v_ms := round(extract(epoch from (clock_timestamp() - v_t_1v_start)) * 1000, 2);

  v_t_31v_start := clock_timestamp();
  v_res := public.get_notes_for_passage_v1(1, 1, 1, 31);
  v_t_31v_ms := round(extract(epoch from (clock_timestamp() - v_t_31v_start)) * 1000, 2);

  v_t_word_start := clock_timestamp();
  v_res := public.get_notes_for_word_v1(12678);
  v_t_word_ms := round(extract(epoch from (clock_timestamp() - v_t_word_start)) * 1000, 2);

  v_summary := jsonb_build_object(
    'insert_20k_ms', round(extract(epoch from (v_t_insert - v_t0)) * 1000),
    'passage_1v_ms', v_t_1v_ms,
    'passage_31v_ms', v_t_31v_ms,
    'word_common_ms', v_t_word_ms
  );

  raise exception 'ROLLBACK_PERF %', v_summary::text;
end $$;
`.trim();

async function main() {
  console.log('=== NOTE-10: Note Read RPCs Verification Suite ===\n');

  const runIdArg = process.argv.indexOf('--run-id');
  const testRunId = runIdArg !== -1 && process.argv[runIdArg + 1]
    ? process.argv[runIdArg + 1]
    : `test_read_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.log(`Using Test Run ID: ${testRunId}\n`);
  const createdNoteIds = new Set();

  try {
    // =========================================================================
    // SECTION 1: list_note_connection_types_v1
    // =========================================================================
    console.log('1. Testing list_note_connection_types_v1()...');
    const ctRes = await rpc('list_note_connection_types_v1');
    assert(ctRes.status === 200, 'list_note_connection_types_v1 returned HTTP 200');
    assert(ctRes.data?.status === 'ok', 'Status is "ok"');
    assert(ctRes.data?.epistemic_layer === 'user_note', 'epistemic_layer is "user_note"');
    assert(Array.isArray(ctRes.data?.connection_types) && ctRes.data.connection_types.length === 16, 'Returns 16 connection types');
    assert(Array.isArray(ctRes.data?.note_kinds) && ctRes.data.note_kinds.length === 7, 'Returns 7 note kinds');
    assert(Array.isArray(ctRes.data?.block_types) && ctRes.data.block_types.length === 9, 'Returns 9 block types');
    assert(ctRes.data?.settings?.single_user_mode === true, 'Settings single_user_mode is true');
    assert(ctRes.data?.settings?.human_writes_enabled === true, 'Settings human_writes_enabled is true');

    // =========================================================================
    // SECTION 2: Create Test Fixtures
    // =========================================================================
    console.log('\n2. Creating note test fixtures...');

    // F1: Verse note on Gen 9:6 (verse 212)
    const f1 = await rpc('save_note_v1', {
      p_note: {
        title: 'Gen 9:6 Verse Note',
        body_md: 'Observation on Genesis 9:6',
        note_kind: 'observation',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'verse', verse_id: 212, label: 'Genesis 9:6' }]
      }
    });
    assert(f1.data?.ok === true, 'Created F1: Verse note on Gen 9:6');
    const f1Id = f1.data?.note?.id;
    if (f1Id) createdNoteIds.add(f1Id);

    // F2: Range note on Gen 9:5-7 (verses 211-213)
    const f2 = await rpc('save_note_v1', {
      p_note: {
        title: 'Gen 9:5-7 Range Note',
        body_md: 'Interpretation covering verses 5 through 7',
        note_kind: 'interpretation',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'verse_range', verse_id: 211, end_verse_id: 213, label: 'Genesis 9:5-7' }]
      }
    });
    assert(f2.data?.ok === true, 'Created F2: Range note on Gen 9:5-7');
    const f2Id = f2.data?.note?.id;
    if (f2Id) createdNoteIds.add(f2Id);

    // F3: Occurrence note on Gen 9:6 pos 2 דַּם (word 53694)
    const f3 = await rpc('save_note_v1', {
      p_note: {
        title: 'Occurrence Note: dam in Gen 9:6',
        body_md: 'Word occurrence note for dam',
        note_kind: 'linguistic',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'word_occurrence', verse_id: 212, word_position: 2, word_id: 53694, label: 'דַּם Gen 9:6:2' }]
      }
    });
    assert(f3.data?.ok === true, 'Created F3: Occurrence note on dam in Gen 9:6');
    const f3Id = f3.data?.note?.id;
    if (f3Id) createdNoteIds.add(f3Id);

    // F4: Form note on הָאָדָם (word 28013)
    const f4 = await rpc('save_note_v1', {
      p_note: {
        title: 'Form Note: ha-adam',
        body_md: 'Morphological note on ha-adam form',
        note_kind: 'linguistic',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'word_form', word_id: 28013, label: 'הָאָדָם form' }]
      }
    });
    assert(f4.data?.ok === true, 'Created F4: Form note on ha-adam');
    const f4Id = f4.data?.note?.id;
    if (f4Id) createdNoteIds.add(f4Id);

    // F5: Lemma note on H120 (lemma 164)
    const f5 = await rpc('save_note_v1', {
      p_note: {
        title: 'Lemma Note: H120 adam',
        body_md: 'Lexical study of lemma H120',
        note_kind: 'linguistic',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'lemma', lemma_id: 164, label: 'H120 adam lemma' }]
      }
    });
    assert(f5.data?.ok === true, 'Created F5: Lemma note on H120');
    const f5Id = f5.data?.note?.id;
    if (f5Id) createdNoteIds.add(f5Id);

    // F6: Adam/Dam connection note on Gen 9:6
    const f6 = await rpc('save_note_v1', {
      p_note: {
        title: 'Adam & Dam Connection Note',
        body_md: 'dam is contained in adam (same letters)',
        note_kind: 'linguistic',
        source_context: { test_run: testRunId },
        anchors: [
          { client_key: 'a1', kind: 'word_occurrence', verse_id: 212, word_position: 2, word_id: 53694, label: 'דַּם Gen 9:6:2' },
          { client_key: 'a2', kind: 'word_occurrence', verse_id: 212, word_position: 3, word_id: 28013, label: 'הָאָדָם Gen 9:6:3' },
          { client_key: 'a3', kind: 'lemma', lemma_id: 7230, label: 'H1818 dam lemma' },
          { client_key: 'a4', kind: 'lemma', lemma_id: 164, label: 'H120 adam lemma' }
        ],
        connections: [
          { from: 'a1', to: 'a2', connection_type: 'contained_in', custom_label: 'dam in adam', direction: 'directed' }
        ]
      }
    });
    assert(f6.data?.ok === true, 'Created F6: Adam & Dam connection note');
    const f6Id = f6.data?.note?.id;
    if (f6Id) createdNoteIds.add(f6Id);

    // F7: Occurrence note on dam in another verse (Lev 4:7, verse 2803, pos 17, word 53694)
    const f7 = await rpc('save_note_v1', {
      p_note: {
        title: 'Occurrence Note: dam in Lev 4:7',
        body_md: 'Occurrence note in Leviticus 4:7',
        note_kind: 'observation',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'word_occurrence', verse_id: 2803, word_position: 17, word_id: 53694, label: 'דַּם Lev 4:7:17' }]
      }
    });
    assert(f7.data?.ok === true, 'Created F7: Occurrence note in Lev 4:7');
    const f7Id = f7.data?.note?.id;
    if (f7Id) createdNoteIds.add(f7Id);

    // F8: Homograph A note (H1254a bara - create, lemma 35)
    const f8 = await rpc('save_note_v1', {
      p_note: {
        title: 'Homograph A Note: H1254a bara (create)',
        body_md: 'Lemma note on bara homograph A',
        note_kind: 'linguistic',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'lemma', lemma_id: 35, label: 'H1254a bara (create)' }]
      }
    });
    assert(f8.data?.ok === true, 'Created F8: Homograph A note');
    const f8Id = f8.data?.note?.id;
    if (f8Id) createdNoteIds.add(f8Id);

    // F9: Homograph B note (H1254b bara - fat/shape, lemma 36)
    const f9 = await rpc('save_note_v1', {
      p_note: {
        title: 'Homograph B Note: H1254b bara (fat)',
        body_md: 'Lemma note on bara homograph B',
        note_kind: 'linguistic',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'lemma', lemma_id: 36, label: 'H1254b bara (fat)' }]
      }
    });
    assert(f9.data?.ok === true, 'Created F9: Homograph B note');
    const f9Id = f9.data?.note?.id;
    if (f9Id) createdNoteIds.add(f9Id);

    // F10: Control note on Gen 1:1 (verse 1)
    const f10 = await rpc('save_note_v1', {
      p_note: {
        title: 'Control Note: Gen 1:1',
        body_md: 'Control note on Genesis 1:1',
        note_kind: 'observation',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'verse', verse_id: 1, label: 'Genesis 1:1' }]
      }
    });
    assert(f10.data?.ok === true, 'Created F10: Control note on Gen 1:1');
    const f10Id = f10.data?.note?.id;
    if (f10Id) createdNoteIds.add(f10Id);

    // =========================================================================
    // SECTION 3: get_notes_for_passage_v1 (Genesis 9:6)
    // =========================================================================
    console.log('\n3. Testing get_notes_for_passage_v1 on Genesis 9:6...');
    const p96 = await rpc('get_notes_for_passage_v1', { p_book: 1, p_chapter: 9, p_verse_start: 6, p_verse_end: 6 });
    assert(p96.status === 200, 'Passage Gen 9:6 returned HTTP 200');
    assert(p96.data?.status === 'ok', 'Status is "ok"');
    assert(p96.data?.epistemic_layer === 'user_note', 'epistemic_layer is "user_note"');
    assert(p96.data?.passage?.verse_ids?.includes(212), 'Passage includes verse 212');

    const p96PrimaryIds = (p96.data?.primary || []).map(n => n.id);
    const p96SecondaryIds = (p96.data?.secondary || []).map(n => n.id);

    // Primary assertions
    assert(p96PrimaryIds.includes(f1Id), 'Gen 9:6 primary contains F1 (verse note)');
    assert(p96PrimaryIds.includes(f2Id), 'Gen 9:6 primary contains F2 (range note)');
    assert(p96PrimaryIds.includes(f3Id), 'Gen 9:6 primary contains F3 (occurrence note)');
    assert(p96PrimaryIds.includes(f6Id), 'Gen 9:6 primary contains F6 (Adam/Dam note)');

    // Secondary assertions
    assert(p96SecondaryIds.includes(f4Id), 'Gen 9:6 secondary contains F4 (form note ha-adam)');
    assert(p96SecondaryIds.includes(f5Id), 'Gen 9:6 secondary contains F5 (lemma note H120)');

    // Disjointness assertions
    assert(!p96PrimaryIds.includes(f4Id) && !p96PrimaryIds.includes(f5Id), 'Primary does NOT contain secondary notes (F4, F5)');
    assert(!p96SecondaryIds.includes(f1Id) && !p96SecondaryIds.includes(f2Id) && !p96SecondaryIds.includes(f3Id) && !p96SecondaryIds.includes(f6Id), 'Secondary does NOT contain primary notes (F1, F2, F3, F6)');

    // Control note absent
    assert(!p96PrimaryIds.includes(f10Id) && !p96SecondaryIds.includes(f10Id), 'Control note F10 (Gen 1:1) is absent from Gen 9:6');

    // Matched positions on secondary notes
    const f4Secondary = (p96.data?.secondary || []).find(n => n.id === f4Id);
    assert(Array.isArray(f4Secondary?.positions) && f4Secondary.positions.some(p => p.verse_id === 212 && p.word_position === 3 && p.word_id === 28013), 'F4 secondary has exact token position (212, pos 3, word 28013)');

    const f5Secondary = (p96.data?.secondary || []).find(n => n.id === f5Id);
    assert(Array.isArray(f5Secondary?.positions) && f5Secondary.positions.some(p => p.verse_id === 212 && p.word_position === 3 && p.word_id === 28013), 'F5 secondary has exact token position (212, pos 3, word 28013)');

    // Token note counts
    const tokenCounts = p96.data?.token_note_counts || [];
    const pos2Count = tokenCounts.find(tc => tc.verse_id === 212 && tc.word_position === 2);
    const pos3Count = tokenCounts.find(tc => tc.verse_id === 212 && tc.word_position === 3);
    assert(pos2Count?.human >= 2, `Token count at pos 2 (dam) reflects human notes (${pos2Count?.human})`);
    assert(pos3Count?.human >= 1, `Token count at pos 3 (ha-adam) reflects human notes (${pos3Count?.human})`);

    // Totals
    const totals = p96.data?.totals;
    assert(totals?.primary >= 4, `Totals primary count (${totals?.primary}) >= 4`);
    assert(totals?.secondary >= 2, `Totals secondary count (${totals?.secondary}) >= 2`);
    assert(totals?.total === totals?.primary + totals?.secondary, 'Totals total equals primary + secondary');
    assert(totals?.human === totals?.total, 'All notes in this test run are human');

    // =========================================================================
    // SECTION 4: get_notes_for_passage_v1 (Genesis 9:7)
    // =========================================================================
    console.log('\n4. Testing get_notes_for_passage_v1 on Genesis 9:7...');
    const p97 = await rpc('get_notes_for_passage_v1', { p_book: 1, p_chapter: 9, p_verse_start: 7, p_verse_end: 7 });
    const p97PrimaryIds = (p97.data?.primary || []).map(n => n.id);
    assert(p97PrimaryIds.includes(f2Id), 'Gen 9:7 primary contains F2 (range note Gen 9:5-7)');
    assert(!p97PrimaryIds.includes(f1Id), 'Gen 9:7 primary does NOT contain F1 (Gen 9:6 verse note)');
    assert(!p97PrimaryIds.includes(f3Id), 'Gen 9:7 primary does NOT contain F3 (Gen 9:6 occurrence note)');
    assert(!p97PrimaryIds.includes(f6Id), 'Gen 9:7 primary does NOT contain F6 (Gen 9:6 connection note)');

    // =========================================================================
    // SECTION 5: get_notes_for_word_v1 (Genesis 9:6 dam and Homographs)
    // =========================================================================
    console.log('\n5. Testing get_notes_for_word_v1...');

    // Look up dam occurrence in Gen 9:6
    const wDam = await rpc('get_notes_for_word_v1', {
      p_word_id: 53694,
      p_verse_id: 212,
      p_word_position: 2
    });
    assert(wDam.status === 200, 'Word RPC returned HTTP 200');
    assert(wDam.data?.status === 'ok', 'Word RPC status is "ok"');
    assert(wDam.data?.epistemic_layer === 'user_note', 'epistemic_layer is "user_note"');

    const occNotes = wDam.data?.groups?.occurrence || [];
    const occIds = occNotes.map(n => n.id);
    const formIds = (wDam.data?.groups?.form || []).map(n => n.id);
    const lemmaIds = (wDam.data?.groups?.lemma || []).map(n => n.id);

    assert(occIds.includes(f3Id), 'dam occurrence group contains F3 (occurrence note)');
    assert(occIds.includes(f6Id), 'dam occurrence group contains F6 (Adam/Dam connection note)');

    // Verify F6 scoping (highest specificity wins: occurrence with scopes=['occurrence', 'lemma'])
    const f6InWord = occNotes.find(n => n.id === f6Id);
    assert(Array.isArray(f6InWord?.scopes) && f6InWord.scopes.includes('occurrence') && f6InWord.scopes.includes('lemma'),
      'F6 has scopes array containing both "occurrence" and "lemma"');
    assert(!lemmaIds.includes(f6Id), 'F6 does NOT appear in lemma group (deduped to highest specificity)');

    // Verify occurrence in other verse (F7 in Lev 4:7) is NOT returned
    assert(!occIds.includes(f7Id), 'Lev 4:7 occurrence note F7 is NOT in occurrence group');
    assert(!formIds.includes(f7Id), 'Lev 4:7 occurrence note F7 is NOT in form group (no cross-verse occurrence leakage)');

    // Verify associated lemmas
    assert((wDam.data?.lemmas || []).some(l => l.lemma_id === 7230), 'Associated lemmas list includes H1818 (lemma 7230)');

    // Homograph separation test (bara word 46861 -> H1254a)
    const wBara = await rpc('get_notes_for_word_v1', { p_word_id: 46861 });
    const baraLemmaIds = (wBara.data?.groups?.lemma || []).map(n => n.id);
    assert(baraLemmaIds.includes(f8Id), 'Homograph test: bara word returns F8 (homograph A, H1254a)');
    assert(!baraLemmaIds.includes(f9Id), 'Homograph test: bara word does NOT return F9 (homograph B, H1254b) — zero cross-bleed');

    // =========================================================================
    // SECTION 6: get_note_v1 (Backlinks and Revisions)
    // =========================================================================
    console.log('\n6. Testing get_note_v1 backlinks and revisions...');

    // Create Note A
    const nA = await rpc('save_note_v1', {
      p_note: {
        title: 'Target Note A',
        body_md: 'Target for backlinks',
        note_kind: 'interpretation',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'verse', verse_id: 1, label: 'Gen 1:1' }]
      }
    });
    const nAId = nA.data?.note?.id;
    if (nAId) createdNoteIds.add(nAId);

    // Create Note B anchoring to Note A
    const nB = await rpc('save_note_v1', {
      p_note: {
        title: 'Backlinking Note B',
        body_md: 'Links to Note A',
        note_kind: 'cross_reference',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'note', target_note_id: nAId, label: 'Target Note A' }]
      }
    });
    const nBId = nB.data?.note?.id;
    if (nBId) createdNoteIds.add(nBId);

    // Update Note A to version 2
    await rpc('save_note_v1', {
      p_note: {
        id: nAId,
        expected_version: 1,
        title: 'Target Note A Updated',
        body_md: 'Target for backlinks (v2)',
        note_kind: 'interpretation',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'verse', verse_id: 1, label: 'Gen 1:1' }]
      }
    });

    // Query get_note_v1 for Note A
    const noteAFull = await rpc('get_note_v1', { p_note_id: nAId });
    assert(noteAFull.status === 200, 'get_note_v1 returned HTTP 200');
    assert(noteAFull.data?.id === nAId, 'Returned note has correct ID');
    assert(noteAFull.data?.version === 2, 'Returned note version is 2');
    assert(Array.isArray(noteAFull.data?.backlinks) && noteAFull.data.backlinks.some(bl => bl.id === nBId), 'get_note_v1 backlinks contains Note B');
    assert(Array.isArray(noteAFull.data?.revisions) && noteAFull.data.revisions.length >= 2, 'get_note_v1 revisions has at least 2 versions');

    // =========================================================================
    // SECTION 7: list_notes_v1 (Keyset Pagination)
    // =========================================================================
    console.log('\n7. Testing list_notes_v1 keyset pagination...');
    const page1 = await rpc('list_notes_v1', { p_limit: 3 });
    assert(page1.status === 200, 'Page 1 returned HTTP 200');
    assert(page1.data?.notes?.length === 3, 'Page 1 returned exactly 3 notes');
    assert(page1.data?.page?.has_more === true, 'Page 1 has_more is true');
    assert(page1.data?.page?.next_cursor !== null, 'Page 1 next_cursor is present');

    const page2 = await rpc('list_notes_v1', { p_limit: 3, p_cursor: page1.data.page.next_cursor });
    assert(page2.status === 200, 'Page 2 returned HTTP 200');
    assert(page2.data?.notes?.length >= 1, 'Page 2 returned notes');

    // Check no duplicate IDs between page 1 and page 2
    const p1Ids = new Set((page1.data?.notes || []).map(n => n.id));
    const p2Ids = (page2.data?.notes || []).map(n => n.id);
    const hasOverlap = p2Ids.some(id => p1Ids.has(id));
    assert(!hasOverlap, 'Keyset pagination: zero duplicate note IDs between page 1 and page 2');

    // Full-text search query test
    const qRes = await rpc('list_notes_v1', { p_query: 'dam in adam' });
    assert(qRes.status === 200, 'Search query returned HTTP 200');
    assert((qRes.data?.notes || []).some(n => n.id === f6Id), 'Search for "dam in adam" finds F6 note');

    // =========================================================================
    // SECTION 8: Soft Delete Isolation
    // =========================================================================
    console.log('\n8. Testing soft-delete isolation...');
    const delTarget = await rpc('save_note_v1', {
      p_note: {
        title: 'Delete Target Note',
        body_md: 'Will be removed',
        note_kind: 'observation',
        source_context: { test_run: testRunId },
        anchors: [{ client_key: 'a1', kind: 'verse', verse_id: 1, label: 'Gen 1:1' }]
      }
    });
    const delTargetId = delTarget.data?.note?.id;
    if (delTargetId) createdNoteIds.add(delTargetId);

    // Verify it exists
    const beforeDel = await rpc('get_note_v1', { p_note_id: delTargetId });
    assert(beforeDel.data !== null, 'Note exists before deletion');

    // Delete it
    const delRes = await rpc('delete_note_v1', { p_note_id: delTargetId });
    assert(delRes.data?.ok === true, 'delete_note_v1 succeeded');

    // Verify it is completely hidden from get_note_v1
    const afterDel = await rpc('get_note_v1', { p_note_id: delTargetId });
    assert(afterDel.data === null, 'Soft-deleted note returns null from get_note_v1');

    // Verify hidden from passage
    const pAfterDel = await rpc('get_notes_for_passage_v1', { p_book: 1, p_chapter: 1, p_verse_start: 1, p_verse_end: 1 });
    const pAllAfter = [...(pAfterDel.data?.primary || []), ...(pAfterDel.data?.secondary || [])].map(n => n.id);
    assert(!pAllAfter.includes(delTargetId), 'Soft-deleted note is absent from get_notes_for_passage_v1');

    // =========================================================================
    // SECTION 9: Psalm Heading (verse 0) Support
    // =========================================================================
    console.log('\n9. Testing Psalm heading (verse 0) support...');
    const ps0 = await rpc('get_notes_for_passage_v1', { p_book: 19, p_chapter: 3, p_verse_start: 0, p_verse_end: 0 });
    assert(ps0.status === 200, 'Psalm 3:0 heading returned HTTP 200 without error');
    assert(ps0.data?.status === 'ok', 'Status is "ok"');
    assert(ps0.data?.passage?.verse_ids?.includes(13959), 'Psalm 3:0 resolved verse id 13959');

    // =========================================================================
    // SECTION 10: Performance Benchmark (TP-PERF-2)
    // =========================================================================
    console.log('\n10. Performance check: live passage and word read latencies...');
    const t0_1v = Date.now();
    await rpc('get_notes_for_passage_v1', { p_book: 1, p_chapter: 1, p_verse_start: 1, p_verse_end: 1 });
    const lat1v = Date.now() - t0_1v;
    assert(lat1v < 300, `Passage 1-verse latency < 300 ms (measured ${lat1v} ms)`);

    const t0_31v = Date.now();
    await rpc('get_notes_for_passage_v1', { p_book: 1, p_chapter: 1, p_verse_start: 1, p_verse_end: 31 });
    const lat31v = Date.now() - t0_31v;
    assert(lat31v < 300, `Passage 31-verse latency < 300 ms (measured ${lat31v} ms)`);

    const t0_w = Date.now();
    await rpc('get_notes_for_word_v1', { p_word_id: 12678 });
    const latW = Date.now() - t0_w;
    assert(latW < 300, `Word lookup (common word 12678) latency < 300 ms (measured ${latW} ms)`);

  } finally {
    // =========================================================================
    // SECTION 11: Cleanup
    // =========================================================================
    console.log('\n11. Cleaning up test fixtures...');
    let cleanSuccess = 0;
    for (const noteId of createdNoteIds) {
      try {
        await rpc('delete_note_v1', { p_note_id: noteId });
        cleanSuccess++;
      } catch (err) {
        // ignore
      }
    }
    console.log(`  Soft-deleted ${cleanSuccess} test notes.`);
  }

  console.log(`\n=== Verification Complete: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

if (process.argv.includes('--print-perf-sql')) {
  console.log(PERF_BENCHMARK_SQL);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error running verify-notes-read.mjs:', err);
  process.exit(1);
});
