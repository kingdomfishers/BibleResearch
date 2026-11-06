// @file: scripts/verify-septuagint-layer.mjs
// Verification suite for the Septuagint and Hebrew-Greek comparison layer (SEP-06)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('=== Septuagint & Hebrew-Greek Comparison Verification Suite (SEP-06) ===\n');

async function test1_GenesisParallel() {
  console.log('1. Testing Genesis 1:1 MT <-> LXX Swete parallel & word alignments...');
  const { data, error } = await supabase.rpc('get_hebrew_septuagint_parallel_v1', {
    p_book: 1,
    p_chapter: 1,
    p_verse: 1,
  });

  if (error || !data || data.status !== 'ok') {
    throw new Error(`Test 1 Failed: ${error?.message || JSON.stringify(data)}`);
  }

  if (data.masoretic.word_count !== 7) {
    throw new Error(`Test 1 Failed: Expected 7 MT words, got ${data.masoretic.word_count}`);
  }
  if (data.septuagint.word_count !== 10) {
    throw new Error(`Test 1 Failed: Expected 10 LXX words, got ${data.septuagint.word_count}`);
  }

  const aligns = data.word_alignments || [];
  const elohimAlign = aligns.find((a) => a.strong_x === '0430');
  if (!elohimAlign || elohimAlign.greek_strong !== '2316') {
    throw new Error(`Test 1 Failed: Expected Strong 0430 -> Greek 2316 alignment, got ${JSON.stringify(elohimAlign)}`);
  }

  if (data.license_info.catss_policy !== 'External reference only; CATSS alignment data is NOT embedded.') {
    throw new Error(`Test 1 Failed: Missing required CATSS exclusion notice`);
  }

  console.log(`  PASS: Genesis 1:1 MT (${data.masoretic.word_count} words) <-> LXX (${data.septuagint.word_count} words), Elohim -> theos (G2316) aligned.`);
}

async function test2_PsalmsVersificationShift() {
  console.log('\n2. Testing Psalm 3:0 MT superscription vs LXX 27:3:1 title verse correspondence...');
  const { data, error } = await supabase.rpc('get_hebrew_septuagint_parallel_v1', {
    p_book: 19,
    p_chapter: 3,
    p_verse: 0,
  });

  if (error || !data || data.status !== 'ok') {
    throw new Error(`Test 2 Failed: ${error?.message || JSON.stringify(data)}`);
  }

  if (data.septuagint.chapter !== 3 || data.septuagint.verse_nr !== 1) {
    throw new Error(`Test 2 Failed: Expected LXX Psalmi 3:1, got ${data.septuagint.chapter}:${data.septuagint.verse_nr}`);
  }

  if (data.septuagint.mapping_kind !== 'versification_shift' && data.septuagint.mapping_kind !== 'superscription_title_verse') {
    throw new Error(`Test 2 Failed: Expected mapping_kind = 'versification_shift' or 'superscription_title_verse', got ${data.septuagint.mapping_kind}`);
  }

  const firstSweteWord = data.septuagint.words[0]?.word_text;
  if (!firstSweteWord || !firstSweteWord.includes('Ψαλμὸς')) {
    throw new Error(`Test 2 Failed: Expected Swete title 'Ψαλμὸς', got ${firstSweteWord}`);
  }

  console.log(`  PASS: Psalm 3:0 MT superscription ("${data.masoretic.words[0]?.original_word}...") accurately shifted to LXX Psalmi 3:1 ("${firstSweteWord}...").`);
}

async function test3_IsaiahActsCorrespondence() {
  console.log('\n3. Testing Isaiah 53:7 <-> Acts 8:32 Greek vocabulary correspondence...');
  const { data, error } = await supabase.rpc('get_hebrew_septuagint_parallel_v1', {
    p_book: 23,
    p_chapter: 53,
    p_verse: 7,
  });

  if (error || !data || data.status !== 'ok') {
    throw new Error(`Test 3 Failed: ${error?.message || JSON.stringify(data)}`);
  }

  const aligns = data.word_alignments || [];
  const sheepAlign = aligns.find((a) => a.lemma === 'שֶׂה');
  const eweAlign = aligns.find((a) => a.lemma === 'רָחֵל');
  const slaughterAlign = aligns.find((a) => a.lemma === 'טֶבַח');
  const ledAlign = aligns.find((a) => a.lemma === 'יָבַל');
  const silentAlign = aligns.find((a) => a.lemma === 'אָלַם');

  if (!sheepAlign || sheepAlign.greek_strong !== '4263') {
    throw new Error(`Test 3 Failed: Expected שֶׂה -> probaton (G4263), got ${JSON.stringify(sheepAlign)}`);
  }
  if (!eweAlign || eweAlign.greek_strong !== '286') {
    throw new Error(`Test 3 Failed: Expected רָחֵל -> amnos (G286), got ${JSON.stringify(eweAlign)}`);
  }
  if (!slaughterAlign || slaughterAlign.greek_strong !== '4967') {
    throw new Error(`Test 3 Failed: Expected טֶבַח -> sphagēn (G4967), got ${JSON.stringify(slaughterAlign)}`);
  }
  if (!ledAlign || ledAlign.greek_strong !== '71') {
    throw new Error(`Test 3 Failed: Expected יָבַל -> ēchthē (G71), got ${JSON.stringify(ledAlign)}`);
  }
  if (!silentAlign || silentAlign.greek_strong !== '880') {
    throw new Error(`Test 3 Failed: Expected אָלַם -> aphōnos (G880), got ${JSON.stringify(silentAlign)}`);
  }

  console.log('  PASS: Isaiah 53:7 aligns 5 key terms directly to Greek:');
  console.log(`        שֶׂה -> probaton (${sheepAlign.greek_strong})`);
  console.log(`        רָחֵל -> amnos (${eweAlign.greek_strong})`);
  console.log(`        טֶבַח -> sphagē (${slaughterAlign.greek_strong})`);
  console.log(`        יָבַל -> agō (${ledAlign.greek_strong})`);
  console.log(`        אָלַם -> aphōnos (${silentAlign.greek_strong})`);
}

async function test4_ForwardAndReverseLookups() {
  console.log('\n4. Testing Forward (Hebrew->Greek) and Reverse (Greek->Hebrew) lookups...');

  // Forward
  const { data: fwd, error: fwdErr } = await supabase.rpc('lookup_hebrew_to_greek_alignments_v1', {
    p_lemma_query: 'H0430',
  });
  if (fwdErr || !fwd || fwd.status !== 'ok') {
    throw new Error(`Test 4 Forward Failed: ${fwdErr?.message || JSON.stringify(fwd)}`);
  }
  if (!fwd.alignments.some((a) => a.greek_strong === 'G2316')) {
    throw new Error(`Test 4 Forward Failed: Expected G2316 in alignments`);
  }
  console.log(`  PASS: Forward lookup H0430 returned ${fwd.alignments.length} alignments (top: ${fwd.alignments[0].greek_script} ${fwd.alignments[0].greek_strong}, ${fwd.alignments[0].occurrence_count} occurrences).`);

  // Reverse
  const { data: rev, error: revErr } = await supabase.rpc('lookup_greek_to_hebrew_alignments_v1', {
    p_greek_query: 'G2316',
  });
  if (revErr || !rev || rev.status !== 'ok') {
    throw new Error(`Test 4 Reverse Failed: ${revErr?.message || JSON.stringify(rev)}`);
  }
  if (!rev.alignments.some((a) => a.hebrew_strong === 'H430')) {
    throw new Error(`Test 4 Reverse Failed: Expected H430 in alignments`);
  }
  console.log(`  PASS: Reverse lookup G2316 returned ${rev.alignments.length} alignments (top: ${rev.alignments[0].hebrew_script} ${rev.alignments[0].hebrew_strong}, ${rev.alignments[0].occurrence_count} occurrences).`);
}

async function test5_CrossTestamentTracing() {
  console.log('\n5. Testing Cross-Testament Greek vocabulary tracing...');
  const { data, error } = await supabase.rpc('lookup_cross_testament_greek_v1', {
    p_greek_query: 'G2316',
    p_limit: 5,
  });

  if (error || !data || data.status !== 'ok') {
    throw new Error(`Test 5 Failed: ${error?.message || JSON.stringify(data)}`);
  }

  if (data.nt_occurrences.total_count === 0) {
    throw new Error(`Test 5 Failed: Expected NT occurrences for G2316`);
  }
  if (data.lxx_occurrences.total_count === 0) {
    throw new Error(`Test 5 Failed: Expected LXX occurrences for G2316`);
  }
  if (data.hebrew_source_renderings.length === 0) {
    throw new Error(`Test 5 Failed: Expected Hebrew source renderings for G2316`);
  }

  console.log(`  PASS: Cross-testament tracing for G2316 (theos):`);
  console.log(`        NT occurrences: ${data.nt_occurrences.total_count} (sample: ${data.nt_occurrences.samples[0]?.ref})`);
  console.log(`        LXX occurrences: ${data.lxx_occurrences.total_count} (sample: ${data.lxx_occurrences.samples[0]?.ref_swete})`);
  console.log(`        Hebrew renderings: ${data.hebrew_source_renderings[0]?.hebrew_script} (${data.hebrew_source_renderings[0]?.hebrew_strong})`);
}

async function run() {
  try {
    await test1_GenesisParallel();
    await test2_PsalmsVersificationShift();
    await test3_IsaiahActsCorrespondence();
    await test4_ForwardAndReverseLookups();
    await test5_CrossTestamentTracing();
    console.log('\nAll Septuagint & Hebrew-Greek Comparison Layer Tests PASSED!\n');
  } catch (err) {
    console.error('\nFAIL:', err.message);
    process.exit(1);
  }
}

run();
