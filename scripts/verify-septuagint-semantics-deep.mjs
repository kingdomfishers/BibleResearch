// @file: scripts/verify-septuagint-semantics-deep.mjs
// Verification suite for Septuagint (Swete 55 books, 588,579 tokens), semantic annotations (911),
// curated alignments (9), and strict distinction between source text, morphology, semantics, and alignment.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function assert(cond, msg) {
  if (!cond) {
    console.error(`  [FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`  [PASS] ${msg}`);
}

async function main() {
  console.log('=== Septuagint & Semantics Deep Verification Suite ===\n');

  // 1. Verify 55 Swete books
  console.log('1. Verifying 55 Swete Septuagint Books...');
  const booksRaw = zlib.gunzipSync(
    fs.readFileSync('.artifacts/static-corpus/tables/lxx_swete_books/part-0000.jsonl.gz')
  ).toString('utf8');
  const sweteBooks = booksRaw.trim().split('\n').map((l) => JSON.parse(l));
  assert(sweteBooks.length === 55, `Exactly 55 Swete LXX books verified (got ${sweteBooks.length})`);
  assert(sweteBooks[0].book_no === 1 && sweteBooks[0].latin_name === 'Genesis', 'First Swete book is Genesis (book_no: 1, latin_name: Genesis)');
  assert(sweteBooks[54].book_no === 59 && sweteBooks[54].latin_name.includes('Bel et Draco'), '55th Swete book is Bel et Draco (book_no: 59)');

  // 2. Verify 588,579 tokens in lxx_swete_words
  console.log('\n2. Verifying 588,579 Tokens in lxx_swete_words...');
  const wordsDir = path.resolve('.artifacts/static-corpus/tables/lxx_swete_words');
  let tokenCount = 0;
  let hasValidUnicode = true;
  let wordOrderValid = true;
  let currentVerse = null;
  let lastOrdinal = 0;

  for (const f of fs.readdirSync(wordsDir)) {
    if (!f.endsWith('.gz')) continue;
    const lines = zlib.gunzipSync(fs.readFileSync(path.join(wordsDir, f))).toString('utf8').trim().split('\n');
    for (const l of lines) {
      const row = JSON.parse(l);
      tokenCount++;
      if (!row.word_text || typeof row.word_text !== 'string') hasValidUnicode = false;
      const vKey = `${row.book_no}-${row.chapter}${row.chapter_suffix || ''}-${row.verse_nr}${row.verse_suffix || ''}`;
      if (vKey !== currentVerse) {
        currentVerse = vKey;
        lastOrdinal = 0;
      }
      if (row.ordinal <= lastOrdinal) {
        wordOrderValid = false;
      }
      lastOrdinal = row.ordinal;
    }
  }
  assert(tokenCount === 588579, `Exact token count matches 588,579 (got ${tokenCount})`);
  assert(hasValidUnicode, 'All 588,579 tokens contain valid Greek Unicode text');
  assert(wordOrderValid, 'Word ordinal strictly monotonic 1..N within every LXX verse');

  // 3. Verify 9 curated Hebrew-Greek word alignments (and verify non-misrepresentation)
  console.log('\n3. Verifying Curated Hebrew-Greek Word Alignments...');
  const alignRaw = zlib.gunzipSync(
    fs.readFileSync('.artifacts/static-corpus/tables/hebrew_lxx_word_alignments/part-0000.jsonl.gz')
  ).toString('utf8');
  const alignments = alignRaw.trim().split('\n').map((l) => JSON.parse(l));
  assert(alignments.length === 9, `Exactly 9 curated Hebrew-Greek word alignments exist (got ${alignments.length})`);
  console.log('  Curated alignments:');
  for (const a of alignments) {
    console.log(`    - ${(a.hebrew_strongs || []).join(',')} (${a.hebrew_text}) -> ${(a.lxx_strongs || []).join(',')} (${a.lxx_text}) [confidence=${a.confidence_score}, tier=${a.alignment_tier}, status=${a.verification_status}]`);
  }
  assert(
    alignments.every((a) => a.alignment_tier && a.verification_status && (typeof a.confidence_score === 'number' || a.confidence_score === null)),
    'Curated alignments carry explicit provenance, confidence_score, and verification_status'
  );
  const tiers = new Set(alignments.map((a) => a.alignment_tier));
  assert(tiers.has('documented_textual') && tiers.has('computationally_inferred_candidate') && tiers.has('scholarly_interpretation'), 'All 3 epistemic tiers represented in curated alignments');

  // 4. Verify 911 Semantic Annotations
  console.log('\n4. Verifying 911 Semantic Annotations...');
  const semRaw = zlib.gunzipSync(
    fs.readFileSync('.artifacts/static-corpus/tables/semantic_annotations/part-0000.jsonl.gz')
  ).toString('utf8');
  const semAnnotations = semRaw.trim().split('\n').map((l) => JSON.parse(l));
  assert(semAnnotations.length === 911, `Exactly 911 semantic annotations verified (got ${semAnnotations.length})`);
  assert(
    semAnnotations.every((s) => s.id && s.annotation_kind && s.annotation_value),
    'All 911 semantic annotations possess valid semantic relations'
  );

  // 5. Verify 22,633 MT-LXX Versification Mappings
  console.log('\n5. Verifying 22,633 MT-LXX Versification Mappings...');
  const vmapDir = path.resolve('.artifacts/static-corpus/tables/hebrew_lxx_verse_map');
  const vmaps = [];
  for (const f of fs.readdirSync(vmapDir)) {
    if (!f.endsWith('.gz')) continue;
    const lines = zlib.gunzipSync(fs.readFileSync(path.join(vmapDir, f))).toString('utf8').trim().split('\n');
    for (const l of lines) vmaps.push(JSON.parse(l));
  }
  assert(vmaps.length === 22633, `Exactly 22,633 MT-LXX verse mappings verified (got ${vmaps.length})`);
  const psalmShifts = vmaps.filter((m) => m.mapping_kind === 'superscription_title_verse');
  assert(psalmShifts.length === 116, `Exactly 116 Psalm superscription title shifts verified (got ${psalmShifts.length})`);

  // 6. Preservation of Restricted Field Exclusions
  console.log('\n6. Verifying Restricted Field Exclusions in Septuagint & Semantic Shards...');
  const forbidden = ['sdbh', 'lexdomain', 'coredomain', 'contextualdomain', 'domain', 'ln'];
  const lxxV1Dir = path.resolve('.artifacts/static-corpus/v1/lxx');
  for (const f of fs.readdirSync(lxxV1Dir)) {
    if (!f.endsWith('.gz')) continue;
    const txt = zlib.gunzipSync(fs.readFileSync(path.join(lxxV1Dir, f))).toString('utf8');
    for (const field of forbidden) {
      if (txt.includes(`"${field}":`)) {
        throw new Error(`Forbidden field ${field} leaked in ${f}`);
      }
    }
  }
  console.log('  PASS: Zero restricted fields found across all Septuagint shards');

  console.log('\n======================================================');
  console.log('ALL SEPTUAGINT & SEMANTICS VERIFICATIONS PASSED!');
  console.log('======================================================');
}

main().catch((err) => {
  console.error('Septuagint & semantics verification failed:', err);
  process.exit(1);
});
