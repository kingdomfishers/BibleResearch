// scripts/verify-hebrew-septuagint-comparison.mjs
// Acceptance test suite for Rigorous Hebrew–Septuagint Comparison (F8).
// Verifies:
//   1. Psalms with differing numbering map correctly (e.g. Ps 3:0 MT superscription -> LXX 3:1 title verse).
//   2. Jeremiah major textual reorderings and omissions (Jer 25:15->32:1, Jer 46->26, Jer 50->27, Jer 10:6-8/10 missing, Jer 33:14-26 missing).
//   3. Genesis 1:2 returns both source passages without inventing word-level equivalences.
//   4. Unmatched words and verses remain explicitly unmatched without fake alignments.
//   5. One-to-many and many-to-one relationships work in both directions (MT -> LXX and LXX -> MT).
//   6. Invariant: Candidate alignments strictly segregated (confidence < 1.0) and cannot masquerade as verified.
//   7. Alignment lookup RPC (text, lemma, Strong's, tier filter).
//   8. Query reproducibility: repeated queries produce identical results.

import fs from 'node:fs';
import assert from 'node:assert';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

async function rpc(name, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`RPC ${name} failed: HTTP ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function runTests() {
  console.log('--- Acceptance Test Suite: Rigorous Hebrew–Septuagint Comparison (F8) ---\n');

  // Test 1: Psalms with differing numbering
  console.log('1. Verifying Psalm versification shifts (MT superscription vs LXX title verse)...');
  const ps3_0 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 19,
    p_hebrew_chapter: 3,
    p_hebrew_verse: 0,
  });

  await test('Psalm 3:0 MT superscription maps to Septuagint Psalm 3:1', () => {
    assert.strictEqual(ps3_0.status, 'ok');
    assert.strictEqual(ps3_0.has_hebrew_passage, true);
    assert.strictEqual(ps3_0.has_septuagint_passage, true);
    assert.strictEqual(ps3_0.septuagint_passage.chapter, 3);
    assert.strictEqual(ps3_0.septuagint_passage.verse_nr, 1);
    assert.strictEqual(ps3_0.versification_mappings.length > 0, true);
    const m = ps3_0.versification_mappings[0];
    assert.ok(
      ['superscription_title_verse', 'versification_shift', 'psalm_numbering_shift'].includes(m.mapping_kind),
      `Expected psalm shift mapping kind, got ${m.mapping_kind}`
    );
  });

  const ps3_1 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 19,
    p_hebrew_chapter: 3,
    p_hebrew_verse: 1,
  });

  await test('Psalm 3:1 MT maps to Septuagint Psalm 3:2', () => {
    assert.strictEqual(ps3_1.status, 'ok');
    assert.strictEqual(ps3_1.has_hebrew_passage, true);
    assert.strictEqual(ps3_1.has_septuagint_passage, true);
    assert.strictEqual(ps3_1.septuagint_passage.chapter, 3);
    assert.strictEqual(ps3_1.septuagint_passage.verse_nr, 2);
  });

  // Test 2: Jeremiah major textual reorderings and omissions
  console.log('\n2. Verifying Jeremiah major textual reorderings and omissions (TVTMS)...');
  const jer25_15 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 24,
    p_hebrew_chapter: 25,
    p_hebrew_verse: 15,
  });

  await test('Jeremiah 25:15 (Cup of Wrath) maps to LXX 32:1 with reordered status', () => {
    assert.strictEqual(jer25_15.status, 'ok');
    assert.strictEqual(jer25_15.correspondence_status, 'reordered');
    assert.strictEqual(jer25_15.has_septuagint_passage, true);
    assert.strictEqual(jer25_15.septuagint_passage.book_no, 49);
    assert.strictEqual(jer25_15.septuagint_passage.chapter, 32);
    assert.strictEqual(jer25_15.septuagint_passage.verse_nr, 1);
    assert.strictEqual(jer25_15.versification_mappings[0].derivation_method, 'stepbible_tvtms_versification_alignment');
  });

  const jer46_1 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 24,
    p_hebrew_chapter: 46,
    p_hebrew_verse: 1,
  });

  await test('Jeremiah 46:1 (Egypt oracle) maps to LXX 26:1 with reordered status', () => {
    assert.strictEqual(jer46_1.status, 'ok');
    assert.strictEqual(jer46_1.correspondence_status, 'reordered');
    assert.strictEqual(jer46_1.has_septuagint_passage, true);
    assert.strictEqual(jer46_1.septuagint_passage.chapter, 26);
    assert.strictEqual(jer46_1.septuagint_passage.verse_nr, 1);
  });

  const jer50_1 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 24,
    p_hebrew_chapter: 50,
    p_hebrew_verse: 1,
  });

  await test('Jeremiah 50:1 (Babylon oracle) maps to LXX 27:1 with reordered status', () => {
    assert.strictEqual(jer50_1.status, 'ok');
    assert.strictEqual(jer50_1.correspondence_status, 'reordered');
    assert.strictEqual(jer50_1.has_septuagint_passage, true);
    assert.strictEqual(jer50_1.septuagint_passage.chapter, 27);
    assert.strictEqual(jer50_1.septuagint_passage.verse_nr, 1);
  });

  const jer10_6 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 24,
    p_hebrew_chapter: 10,
    p_hebrew_verse: 6,
  });

  await test('Jeremiah 10:6 is absent in Septuagint and reports unmatched_hebrew_minus_in_lxx', () => {
    assert.strictEqual(jer10_6.status, 'ok');
    assert.strictEqual(jer10_6.has_hebrew_passage, true);
    assert.strictEqual(jer10_6.has_septuagint_passage, false);
    assert.strictEqual(jer10_6.septuagint_passage, null);
    assert.strictEqual(jer10_6.correspondence_status, 'unmatched_hebrew_minus_in_lxx');
    assert.ok(
      ['mt_plus', 'unmatched_hebrew'].includes(jer10_6.versification_mappings[0].mapping_kind),
      `Expected mt_plus or unmatched_hebrew, got ${jer10_6.versification_mappings[0].mapping_kind}`
    );
  });

  const jer10_8 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 24,
    p_hebrew_chapter: 10,
    p_hebrew_verse: 8,
  });

  await test('Jeremiah 10:8 is absent in Septuagint and reports unmatched_hebrew_minus_in_lxx', () => {
    assert.strictEqual(jer10_8.status, 'ok');
    assert.strictEqual(jer10_8.has_septuagint_passage, false);
    assert.strictEqual(jer10_8.correspondence_status, 'unmatched_hebrew_minus_in_lxx');
  });

  const jer10_10 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 24,
    p_hebrew_chapter: 10,
    p_hebrew_verse: 10,
  });

  await test('Jeremiah 10:10 is absent in Septuagint and reports unmatched_hebrew_minus_in_lxx', () => {
    assert.strictEqual(jer10_10.status, 'ok');
    assert.strictEqual(jer10_10.has_septuagint_passage, false);
    assert.strictEqual(jer10_10.correspondence_status, 'unmatched_hebrew_minus_in_lxx');
  });

  const jer33_14 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 24,
    p_hebrew_chapter: 33,
    p_hebrew_verse: 14,
  });

  await test('Jeremiah 33:14 (Davidic covenant) is absent in Septuagint and reports unmatched_hebrew_minus_in_lxx', () => {
    assert.strictEqual(jer33_14.status, 'ok');
    assert.strictEqual(jer33_14.has_septuagint_passage, false);
    assert.strictEqual(jer33_14.septuagint_passage, null);
    assert.strictEqual(jer33_14.correspondence_status, 'unmatched_hebrew_minus_in_lxx');
  });

  // Test 3: Genesis 1:2 returns both source passages without inventing word-level equivalences
  console.log('\n3. Verifying Genesis 1:2 returns both passages without invented word equivalences...');
  const gen1_2 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 1,
    p_hebrew_chapter: 1,
    p_hebrew_verse: 2,
  });

  await test('Genesis 1:2 returns both source passages with all tokens', () => {
    assert.strictEqual(gen1_2.status, 'ok');
    assert.strictEqual(gen1_2.has_hebrew_passage, true);
    assert.strictEqual(gen1_2.has_septuagint_passage, true);
    assert.strictEqual(gen1_2.hebrew_passage.words.length, 14);
    assert.strictEqual(gen1_2.septuagint_passage.words.length, 19);
  });

  await test('Genesis 1:2 has zero documented word-level alignments and all words are unmatched', () => {
    assert.strictEqual(gen1_2.documented_alignments.length, 0);
    assert.strictEqual(gen1_2.candidate_alignments.length, 0);
    for (const w of gen1_2.hebrew_passage.words) {
      assert.strictEqual(w.alignment_status, 'unmatched', `Hebrew word ${w.ordinal} (${w.original_word}) must be unmatched`);
      assert.deepStrictEqual(w.aligned_lxx_ordinals, []);
    }
    for (const w of gen1_2.septuagint_passage.words) {
      assert.strictEqual(w.alignment_status, 'unmatched', `LXX word ${w.ordinal} (${w.word_text}) must be unmatched`);
      assert.deepStrictEqual(w.aligned_hebrew_ordinals, []);
    }
  });

  await test('Genesis 1:2 preserves scholarly interpretation tier without polluting verified facts', () => {
    assert.strictEqual(gen1_2.scholarly_interpretations.length, 1);
    const s = gen1_2.scholarly_interpretations[0];
    assert.strictEqual(s.alignment_tier, 'scholarly_interpretation');
    assert.strictEqual(s.verification_status, 'scholarly_hypothesis');
    assert.strictEqual(s.translation_technique, 'free_paraphrastic');
    assert.ok(s.evidence_summary.includes('תֹּהוּ') || s.evidence_summary.includes('hendiadys'));
  });

  // Test 4: Unmatched words and particles remain explicitly unmatched
  console.log('\n4. Verifying unmapped words in Genesis 1:3 and Jeremiah 25:15 remain explicitly unmatched...');
  const gen1_3 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 1,
    p_hebrew_chapter: 1,
    p_hebrew_verse: 3,
  });

  await test('Unmapped words in Genesis 1:3 and Jeremiah 25:15 remain strictly unmatched', () => {
    const w3 = gen1_3.hebrew_passage.words.find(w => w.ordinal === 3);
    const w4 = gen1_3.hebrew_passage.words.find(w => w.ordinal === 4);
    assert.ok(w3, 'Word 3 in Gen 1:3 must exist');
    assert.ok(w4, 'Word 4 in Gen 1:3 must exist');
    assert.strictEqual(w3.alignment_status, 'unmatched');
    assert.deepStrictEqual(w3.aligned_lxx_ordinals, []);
    assert.strictEqual(w4.alignment_status, 'unmatched');
    assert.deepStrictEqual(w4.aligned_lxx_ordinals, []);

    for (const w of jer25_15.hebrew_passage.words) {
      assert.strictEqual(w.alignment_status, 'unmatched');
      assert.deepStrictEqual(w.aligned_lxx_ordinals, []);
    }
  });

  // Test 5: One-to-many and many-to-one bidirectional alignment
  console.log('\n5. Verifying bidirectional 1:many alignment (Genesis 1:1)...');
  const gen1_1 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 1,
    p_hebrew_chapter: 1,
    p_hebrew_verse: 1,
  });

  await test('Hebrew -> LXX: בְּרֵאשִׁית maps to Greek ordinals [1, 2] (Ἐν ἀρχῇ)', () => {
    const bereshit = gen1_1.hebrew_passage.words.find(w => w.ordinal === 1);
    assert.ok(bereshit);
    assert.strictEqual(bereshit.alignment_status, 'documented_aligned');
    assert.deepStrictEqual(bereshit.aligned_lxx_ordinals, [1, 2]);
  });

  const gen1_1_rev = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_lxx_book_no: 1,
    p_lxx_chapter: 1,
    p_lxx_verse_nr: 1,
  });

  await test('LXX -> Hebrew: Ἐν and ἀρχῇ both map back to Hebrew ordinal [1] (בְּרֵאשִׁית)', () => {
    assert.strictEqual(gen1_1_rev.status, 'ok');
    assert.strictEqual(gen1_1_rev.query_mode, 'septuagint');
    assert.strictEqual(gen1_1_rev.has_hebrew_passage, true);
    const en = gen1_1_rev.septuagint_passage.words.find(w => w.ordinal === 1);
    const arche = gen1_1_rev.septuagint_passage.words.find(w => w.ordinal === 2);
    assert.ok(en);
    assert.ok(arche);
    assert.strictEqual(en.alignment_status, 'documented_aligned');
    assert.deepStrictEqual(en.aligned_hebrew_ordinals, [1]);
    assert.strictEqual(arche.alignment_status, 'documented_aligned');
    assert.deepStrictEqual(arche.aligned_hebrew_ordinals, [1]);
  });

  // Test 6: Invariant: Candidate alignments segregated and cannot masquerade as verified
  console.log('\n6. Verifying candidate alignment segregation and masquerade prevention...');

  await test('Candidate alignment in Genesis 1:3 is segregated with confidence < 1.0', () => {
    assert.strictEqual(gen1_3.status, 'ok');
    assert.strictEqual(gen1_3.documented_alignments.length, 0);
    assert.strictEqual(gen1_3.candidate_alignments.length, 1);
    const cand = gen1_3.candidate_alignments[0];
    assert.strictEqual(cand.alignment_tier, 'computationally_inferred_candidate');
    assert.strictEqual(cand.verification_status, 'unverified_candidate');
    assert.ok(cand.confidence_score !== null && cand.confidence_score < 1.0, 'Confidence must be strictly < 1.0');
    assert.strictEqual(cand.confidence_score, 0.88);
    assert.strictEqual(cand.algorithm_or_source, 'lemma_strong_exact_v1');

    const w1 = gen1_3.hebrew_passage.words.find(w => w.ordinal === 1);
    assert.strictEqual(w1.alignment_status, 'candidate_aligned');
  });

  await test('Database constraint chk_candidate_never_masquerade rejects candidate masquerading as verified', async () => {
    let errorThrown = false;
    let errorMessage = '';
    try {
      await rpc('ingest_hebrew_lxx_word_alignments_batch_v1', {
        p_alignments: [{
          alignment_key: 'test:masquerade:violation',
          canonical_verse_id: 1,
          lxx_book_no: 1,
          lxx_chapter: 1,
          lxx_verse_nr: 1,
          hebrew_word_ids: [1],
          hebrew_token_ordinals: [1],
          hebrew_text: 'בְּרֵאשִׁית',
          hebrew_strongs: ['H7225'],
          lxx_word_ids: [1],
          lxx_token_ordinals: [1],
          lxx_text: 'ΕΝ',
          lxx_strongs: ['G1722'],
          cardinality: 'one_to_one',
          alignment_tier: 'computationally_inferred_candidate',
          verification_status: 'verified_source_attestation',
          confidence_score: 1.0,
          algorithm_or_source: 'fake_algorithm',
          evidence_summary: 'This should violate chk_candidate_never_masquerade',
        }],
      });
    } catch (err) {
      errorThrown = true;
      errorMessage = err.message;
    }
    assert.strictEqual(errorThrown, true, 'Masquerading row must be rejected by check constraint');
    assert.ok(
      errorMessage.includes('chk_candidate_never_masquerade'),
      `Expected chk_candidate_never_masquerade error, got ${errorMessage}`
    );
  });

  await test('Epistemic disclaimer is present in every comparison result', () => {
    assert.ok(gen1_1.epistemic_disclaimer.length > 20);
    assert.ok(gen1_3.epistemic_disclaimer.includes('computationally inferred'));
  });

  // Test 7: Alignment lookup RPC
  console.log('\n7. Verifying lookup_hebrew_septuagint_alignments_v1...');
  const lookupHebrew = await rpc('lookup_hebrew_septuagint_alignments_v1', {
    p_query: 'בְּרֵאשִׁית',
  });

  await test('Lookup by Hebrew text returns documented alignment', () => {
    assert.strictEqual(lookupHebrew.status, 'ok');
    assert.strictEqual(lookupHebrew.total_returned > 0, true);
    const a = lookupHebrew.alignments[0];
    assert.strictEqual(a.alignment_tier, 'documented_textual');
    assert.strictEqual(a.verification_status, 'verified_source_attestation');
    assert.strictEqual(a.confidence_score, 1.0);
  });

  const lookupStrongs = await rpc('lookup_hebrew_septuagint_alignments_v1', {
    p_query: 'H7225',
  });

  await test('Lookup by Strongs number H7225 finds matching alignment', () => {
    assert.strictEqual(lookupStrongs.status, 'ok');
    assert.strictEqual(lookupStrongs.total_returned > 0, true);
    assert.ok(lookupStrongs.alignments[0].hebrew_strongs.includes('H7225'));
  });

  const lookupScholarly = await rpc('lookup_hebrew_septuagint_alignments_v1', {
    p_query: 'tohu',
    p_tier: 'scholarly_interpretation',
  });

  await test('Lookup with tier filter scholarly_interpretation returns only scholarly entries', () => {
    assert.strictEqual(lookupScholarly.status, 'ok');
    assert.strictEqual(lookupScholarly.total_returned, 1);
    assert.strictEqual(lookupScholarly.alignments[0].alignment_tier, 'scholarly_interpretation');
  });

  // Test 8: Query reproducibility
  console.log('\n8. Verifying query reproducibility...');
  const run1 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 24,
    p_hebrew_chapter: 25,
    p_hebrew_verse: 15,
  });
  const run2 = await rpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 24,
    p_hebrew_chapter: 25,
    p_hebrew_verse: 15,
  });

  await test('Repeated comparison queries return byte-identical results', () => {
    assert.strictEqual(JSON.stringify(run1), JSON.stringify(run2));
  });

  console.log(`\n========================================`);
  console.log(`F8 Hebrew-Septuagint Comparison Verification: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled verification error:', err);
  process.exit(1);
});
