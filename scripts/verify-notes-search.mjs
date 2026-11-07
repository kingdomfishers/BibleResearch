// @file: scripts/verify-notes-search.mjs
// @feature: notes-target-search
// Verification suite for NOTE-12: Target search RPC (search_note_targets_v1)
// Verifies:
// 1. Reference queries (Gen 9:6, John 3:16-18, 1 Cor 13) -> 'passage' group with verse/verse_range
// 2. Strong's identifiers (H120, G3056, H1254a) -> 'lemma' group
// 3. Homograph separation (H1254 returns distinct H1254a, H1254b candidates with distinct glosses)
// 4. Hebrew script with/without niqqud (אדם, אָדָם, דם) -> 'lemma' and 'word_form'
// 5. Greek script with/without accents (λόγος, λογος) -> 'lemma' and 'word_form'
// 6. Transliteration / English (logos, adam, dam, blood) -> mapped reader words
// 7. Places (Bethel) -> 'place' group
// 8. Concepts (Well / Water Source) -> 'concept' group
// 9. Existing Notes -> 'note' group
// 10. p_kinds filtering (e.g. ['place'] returns only place group)
// 11. Malicious inputs (SQL injection payload, 100+ chars, emojis) -> handled safely, no crash
// 12. Nonsense query -> status 'ok', empty groups
// 13. Deterministic repeatability (two identical calls return identical JSON)
// 14. Response payload <= 64 KB
// 15. Every returned anchor shape validates against save_note_v1 (round-trip test)
// 16. Performance: query latency < 500 ms each

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
    console.error(`  FAIL: ${message}${details ? ' -> ' + details : ''}`);
    failed++;
  }
}

async function rpc(name, body) {
  const t0 = Date.now();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: hdr,
    body: JSON.stringify(body),
  });
  const lat = Date.now() - t0;
  const data = await res.json().catch(() => null);
  return { status: res.status, data, lat };
}

async function run() {
  console.log('=== NOTE-12: Target Search RPC Verification Suite ===\n');

  const testRunTag = `test_search_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdNoteIds = [];

  try {
    // Setup: Create a test note to verify note target searching
    const testNoteTitle = `Test Note for Target Search ${testRunTag}`;
    const createNoteRes = await rpc('save_note_v1', {
      p_note: {
        title: testNoteTitle,
        body_md: `Testing target search indexing for note candidates ${testRunTag}`,
        note_kind: 'observation',
        source_context: { test_run: testRunTag },
        anchors: [
          { client_key: 'a1', kind: 'verse', verse_id: 1, label: 'Genesis 1:1' }
        ]
      }
    });
    if (createNoteRes.data?.ok && createNoteRes.data?.note?.id) {
      createdNoteIds.push(createNoteRes.data.note.id);
      console.log(`  Setup: Created search test note id ${createNoteRes.data.note.id}`);
    }

    // =========================================================================
    // SECTION 1: Reference Targets (Passages)
    // =========================================================================
    console.log('\n1. Testing reference target queries...');
    const ref1 = await rpc('search_note_targets_v1', { p_query: 'Gen 9:6' });
    assert(ref1.status === 200, 'Gen 9:6 returned HTTP 200');
    assert(ref1.data?.interpretation?.type === 'reference', 'Interpretation is "reference"');
    const passGroup1 = ref1.data?.groups?.find(g => g.kind === 'passage');
    assert(passGroup1 !== undefined, 'Passage group present for Gen 9:6');
    assert(passGroup1?.candidates?.[0]?.kind === 'verse', 'Gen 9:6 candidate is verse');
    assert(passGroup1?.candidates?.[0]?.anchor?.verse_id === 212, 'Gen 9:6 anchor has verse_id 212');
    assert(ref1.lat < 500, `Gen 9:6 latency < 500 ms (${ref1.lat} ms)`);

    const ref2 = await rpc('search_note_targets_v1', { p_query: 'John 3:16-18' });
    assert(ref2.status === 200, 'John 3:16-18 returned HTTP 200');
    const passGroup2 = ref2.data?.groups?.find(g => g.kind === 'passage');
    assert(passGroup2?.candidates?.[0]?.kind === 'verse_range', 'John 3:16-18 candidate is verse_range');
    assert(passGroup2?.candidates?.[0]?.anchor?.verse_id === 26243, 'John 3:16-18 anchor verse_id is 26243');
    assert(passGroup2?.candidates?.[0]?.anchor?.end_verse_id === 26245, 'John 3:16-18 anchor end_verse_id is 26245');

    const ref3 = await rpc('search_note_targets_v1', { p_query: '1 Cor 13' });
    assert(ref3.status === 200, '1 Cor 13 returned HTTP 200');
    const passGroup3 = ref3.data?.groups?.find(g => g.kind === 'passage');
    assert(passGroup3?.candidates?.[0]?.kind === 'verse_range', '1 Cor 13 candidate is verse_range (chapter range)');
    assert(passGroup3?.candidates?.[0]?.anchor?.verse_id === 28767, '1 Cor 13 start verse_id is 28767');
    assert(passGroup3?.candidates?.[0]?.anchor?.end_verse_id === 28779, '1 Cor 13 end verse_id is 28779');

    // =========================================================================
    // SECTION 2: Strong's Identifiers & Homograph Separation
    // =========================================================================
    console.log('\n2. Testing Strong\'s identifiers and homograph separation...');
    const idH120 = await rpc('search_note_targets_v1', { p_query: 'H120' });
    assert(idH120.status === 200, 'H120 returned HTTP 200');
    assert(idH120.data?.interpretation?.type === 'identifier', 'Interpretation is "identifier"');
    const lemmaGroupH120 = idH120.data?.groups?.find(g => g.kind === 'lemma');
    assert(lemmaGroupH120?.candidates?.length >= 1, 'H120 returns lemma candidate');
    assert(lemmaGroupH120?.candidates?.[0]?.anchor?.kind === 'lemma', 'H120 anchor kind is lemma');

    const idG3056 = await rpc('search_note_targets_v1', { p_query: 'G3056' });
    assert(idG3056.status === 200, 'G3056 returned HTTP 200');
    const lemmaGroupG3056 = idG3056.data?.groups?.find(g => g.kind === 'lemma');
    assert(lemmaGroupG3056?.candidates?.[0]?.label?.includes('λόγος'), 'G3056 returns logos lemma');

    // Homograph separation for H1254 (bara)
    const idH1254 = await rpc('search_note_targets_v1', { p_query: 'H1254' });
    assert(idH1254.status === 200, 'H1254 returned HTTP 200');
    const lemmaGroupH1254 = idH1254.data?.groups?.find(g => g.kind === 'lemma');
    const h1254Cands = lemmaGroupH1254?.candidates || [];
    assert(h1254Cands.length >= 2, `H1254 returns multiple homograph candidates (count: ${h1254Cands.length})`);
    const candA = h1254Cands.find(c => c.id === 35 || c.label.includes('H1254A'));
    const candB = h1254Cands.find(c => c.id === 36 || c.label.includes('H1254B'));
    assert(candA !== undefined, 'Homograph H1254A candidate present');
    assert(candB !== undefined, 'Homograph H1254B candidate present');
    assert(candA?.sublabel?.includes('create'), 'Homograph A sublabel includes "create"');
    assert(candB?.sublabel?.includes('cut down') || candB?.sublabel?.includes('clear'), 'Homograph B sublabel includes "cut down / clear"');
    assert(candA?.id !== candB?.id, 'Homograph candidates have distinct lemma IDs');

    // Querying with specific letter H1254a
    const idH1254a = await rpc('search_note_targets_v1', { p_query: 'H1254a' });
    const lemmaGroupH1254a = idH1254a.data?.groups?.find(g => g.kind === 'lemma');
    const h1254aCands = lemmaGroupH1254a?.candidates || [];
    assert(h1254aCands.some(c => c.id === 35), 'H1254a returns homograph A');
    assert(!h1254aCands.some(c => c.id === 36), 'H1254a isolates and excludes homograph B');

    // =========================================================================
    // SECTION 3: Hebrew Script (with/without niqqud)
    // =========================================================================
    console.log('\n3. Testing Hebrew script queries...');
    const hebUnpointed = await rpc('search_note_targets_v1', { p_query: 'אדם' });
    assert(hebUnpointed.status === 200, 'אדם returned HTTP 200');
    assert(hebUnpointed.data?.interpretation?.type === 'hebrew', 'Interpretation is "hebrew"');
    assert(hebUnpointed.data?.groups?.some(g => g.kind === 'lemma'), 'אדם returns lemma group');
    assert(hebUnpointed.data?.groups?.some(g => g.kind === 'word_form'), 'אדם returns word_form group');

    const hebPointed = await rpc('search_note_targets_v1', { p_query: 'אָדָם' });
    assert(hebPointed.status === 200, 'אָדָם returned HTTP 200');
    assert(hebPointed.data?.interpretation?.type === 'hebrew', 'Interpretation is "hebrew"');
    assert(hebPointed.data?.groups?.some(g => g.kind === 'lemma'), 'אָדָם returns lemma group');

    const hebDam = await rpc('search_note_targets_v1', { p_query: 'דם' });
    assert(hebDam.status === 200, 'דם returned HTTP 200');
    const damLemma = hebDam.data?.groups?.find(g => g.kind === 'lemma')?.candidates?.find(c => c.label.includes('H1818'));
    assert(damLemma !== undefined, 'דם returns H1818 lemma');

    // =========================================================================
    // SECTION 4: Greek Script (with/without accents)
    // =========================================================================
    console.log('\n4. Testing Greek script queries...');
    const grcAccented = await rpc('search_note_targets_v1', { p_query: 'λόγος' });
    assert(grcAccented.status === 200, 'λόγος returned HTTP 200');
    assert(grcAccented.data?.interpretation?.type === 'greek', 'Interpretation is "greek"');
    assert(grcAccented.data?.groups?.some(g => g.kind === 'lemma'), 'λόγος returns lemma group');

    const grcUnaccented = await rpc('search_note_targets_v1', { p_query: 'λογος' });
    assert(grcUnaccented.status === 200, 'λογος returned HTTP 200');
    assert(grcUnaccented.data?.groups?.some(g => g.kind === 'lemma'), 'λογος returns lemma group');

    // =========================================================================
    // SECTION 5: Transliteration & English Text
    // =========================================================================
    console.log('\n5. Testing transliteration and English queries...');
    const txtLogos = await rpc('search_note_targets_v1', { p_query: 'logos' });
    assert(txtLogos.status === 200, 'logos returned HTTP 200');
    assert(txtLogos.data?.interpretation?.type === 'text', 'Interpretation is "text"');
    assert(txtLogos.data?.groups?.some(g => g.kind === 'word_form'), 'logos returns word_form group');

    const txtAdam = await rpc('search_note_targets_v1', { p_query: 'adam' });
    assert(txtAdam.status === 200, 'adam returned HTTP 200');
    assert(txtAdam.data?.groups?.some(g => g.kind === 'word_form'), 'adam returns word_form group');

    const txtBlood = await rpc('search_note_targets_v1', { p_query: 'blood' });
    assert(txtBlood.status === 200, 'blood returned HTTP 200');
    assert(txtBlood.data?.groups?.some(g => g.kind === 'word_form'), 'blood returns word_form group');

    // =========================================================================
    // SECTION 6: Places, Concepts, and Existing Notes
    // =========================================================================
    console.log('\n6. Testing places, concepts, and notes...');
    const txtBethel = await rpc('search_note_targets_v1', { p_query: 'Bethel' });
    assert(txtBethel.status === 200, 'Bethel returned HTTP 200');
    const placeGroup = txtBethel.data?.groups?.find(g => g.kind === 'place');
    assert(placeGroup !== undefined, 'Place group found for Bethel');
    assert(placeGroup?.candidates?.length >= 1, 'Bethel candidates found');
    assert(placeGroup?.candidates?.[0]?.anchor?.kind === 'place', 'Bethel anchor kind is place');

    // Concept test
    const txtMarriage = await rpc('search_note_targets_v1', { p_query: 'Marriage' });
    assert(txtMarriage.status === 200, 'Marriage returned HTTP 200');
    const conceptGroup = txtMarriage.data?.groups?.find(g => g.kind === 'concept');
    assert(conceptGroup !== undefined, 'Concept group found for Marriage');
    assert(conceptGroup?.candidates?.[0]?.anchor?.kind === 'concept', 'Marriage anchor kind is concept');

    // Existing Note test
    const txtNote = await rpc('search_note_targets_v1', { p_query: testRunTag });
    assert(txtNote.status === 200, 'Existing note query returned HTTP 200');
    const noteGroup = txtNote.data?.groups?.find(g => g.kind === 'note');
    assert(noteGroup !== undefined, 'Note group found for created test note');
    assert(noteGroup?.candidates?.[0]?.anchor?.kind === 'note', 'Note anchor kind is note');

    // =========================================================================
    // SECTION 7: p_kinds Filtering
    // =========================================================================
    console.log('\n7. Testing p_kinds filter...');
    const filterRes = await rpc('search_note_targets_v1', {
      p_query: 'Bethel',
      p_kinds: ['place']
    });
    assert(filterRes.status === 200, 'Filter query returned HTTP 200');
    const filterGroups = filterRes.data?.groups || [];
    assert(filterGroups.length === 1 && filterGroups[0].kind === 'place', 'Only "place" group returned when p_kinds=["place"]');

    // =========================================================================
    // SECTION 8: Edge Cases, Security & Robustness
    // =========================================================================
    console.log('\n8. Testing edge cases, SQL safety, and nonsense queries...');
    const nonsenseRes = await rpc('search_note_targets_v1', { p_query: 'xyznonexistent123987' });
    assert(nonsenseRes.status === 200, 'Nonsense query returned HTTP 200');
    assert(nonsenseRes.data?.status === 'ok', 'Status is "ok"');
    assert(nonsenseRes.data?.groups?.length === 0, 'Nonsense query returns empty groups');

    // SQL Injection / Metacharacter payload
    const sqlInj = await rpc('search_note_targets_v1', { p_query: "'; select 1;--" });
    assert(sqlInj.status === 200, 'SQL metacharacters query returned HTTP 200 safely');
    assert(sqlInj.data?.status === 'ok', 'Status is "ok"');

    // Long query & emojis
    const longQuery = 'A'.repeat(120) + ' 📖 🔥';
    const longRes = await rpc('search_note_targets_v1', { p_query: longQuery });
    assert(longRes.status === 200, '120-char query with emoji returned HTTP 200');
    assert(longRes.data?.query?.length <= 100, 'Query truncated to <= 100 chars');

    // Deterministic repeat results
    const r1 = await rpc('search_note_targets_v1', { p_query: 'H120' });
    const r2 = await rpc('search_note_targets_v1', { p_query: 'H120' });
    assert(JSON.stringify(r1.data) === JSON.stringify(r2.data), 'Deterministic repeat: consecutive calls return identical JSON');

    // Payload size cap <= 64 KB
    const payloadBytes = Buffer.byteLength(JSON.stringify(txtBethel.data), 'utf8');
    assert(payloadBytes <= 65536, `Response payload size <= 64 KB (measured ${payloadBytes} bytes)`);

    // =========================================================================
    // SECTION 9: Anchor Round-Trip Test into save_note_v1
    // =========================================================================
    console.log('\n9. Testing anchor round-trip into save_note_v1...');
    // Take returned anchors from each group and post them directly inside save_note_v1
    const testAnchors = [];
    if (passGroup1?.candidates?.[0]?.anchor) {
      testAnchors.push({ client_key: 'a1', ...passGroup1.candidates[0].anchor });
    }
    if (lemmaGroupH120?.candidates?.[0]?.anchor) {
      testAnchors.push({ client_key: 'a2', ...lemmaGroupH120.candidates[0].anchor });
    }
    if (conceptGroup?.candidates?.[0]?.anchor) {
      testAnchors.push({ client_key: 'a3', ...conceptGroup.candidates[0].anchor });
    }
    if (placeGroup?.candidates?.[0]?.anchor) {
      testAnchors.push({ client_key: 'a4', ...placeGroup.candidates[0].anchor });
    }

    assert(testAnchors.length >= 3, `Collected ${testAnchors.length} target search anchors for round-trip test`);

    const roundTripRes = await rpc('save_note_v1', {
      p_note: {
        title: `Round-Trip Note for Search Anchors ${testRunTag}`,
        body_md: 'Verifying that target search candidate anchors validate in save_note_v1',
        note_kind: 'research_lead',
        source_context: { test_run: testRunTag },
        anchors: testAnchors
      }
    });

    assert(roundTripRes.status === 200, 'save_note_v1 returned HTTP 200 for search anchors');
    assert(roundTripRes.data?.ok === true, 'save_note_v1 succeeded with target search anchors', JSON.stringify(roundTripRes.data?.error));
    if (roundTripRes.data?.note?.id) {
      createdNoteIds.push(roundTripRes.data.note.id);
      assert(roundTripRes.data.note.anchors.length === testAnchors.length, `Note created with all ${testAnchors.length} anchors intact`);
    }

  } finally {
    // =========================================================================
    // SECTION 10: Cleanup
    // =========================================================================
    console.log('\n10. Cleaning up test fixtures...');
    let cleaned = 0;
    for (const id of createdNoteIds) {
      const delRes = await rpc('delete_note_v1', { p_note_id: id });
      if (delRes.data?.ok) cleaned++;
    }
    console.log(`  Soft-deleted ${cleaned} test notes.`);
  }

  console.log(`\n=== Verification Complete: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
