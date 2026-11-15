/**
 * scripts/verify-r8-staged-release.mjs
 *
 * Verifies the deployed staged relationship graph `r8-v1.0` against the live Cloudflare Worker
 * (`https://bibleresearch-corpus.kingdomfishers-custom.workers.dev`).
 *
 * Runs tests A through E:
 * - Test A: Genesis 1:1 bara (`lemma:H1254a`)
 * - Test B: Ruach (`H7307`), Gen 1:2, Gen 8:1, Eze 37:9 (all 4 occurrences), subdivisions H7307G-J
 * - Test C: John 3:17 & Philippians 2:5 (Nestle1904 & SBLGNT)
 * - Test D: End-of-Bible coverage (Revelation 1:1, 22:20)
 * - Test E: High-frequency Hebrew & Greek lemmas
 */

import assert from 'node:assert';

const WORKER_BASE = 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev';
const RELEASE = process.env.RELEASE || 'r8-v1.1';

async function queryWorker(params) {
  const t0 = Date.now();
  const res = await fetch(`${WORKER_BASE}/api/relationships/v2/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ release: RELEASE, ...params }),
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Worker query failed (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return { data, elapsed };
}

async function run() {
  console.log(`=== Verifying Live Staged Release: ${RELEASE} ===`);
  console.log(`Endpoint: ${WORKER_BASE}`);

  let passed = 0;
  const timings = [];

  // 1. Direct manifest check
  console.log('1. Checking deployed manifest.json...');
  const mRes = await fetch(`${WORKER_BASE}/v2/relationships/${RELEASE}/manifest.json`);
  assert(mRes.ok, `Failed to fetch manifest: ${mRes.status}`);
  const manifest = await mRes.json();
  assert(manifest.release_version === RELEASE, 'Manifest release mismatch');
  assert(manifest.counts.frames_emitted === 150522, 'Frames count mismatch');
  assert(manifest.counts.occurrence_relations_emitted === 124312, 'Relations count mismatch');
  assert(manifest.counts.relation_summaries_total === 61752, 'Summaries count mismatch');
  assert(manifest.counts.distinct_lemmas_in_graph === 9812, 'Lemmas count mismatch');
  assert(manifest.counts.books_covered === 66, 'Books covered mismatch');
  assert(manifest.counts.partitions_covered === 93, 'Partitions mismatch');
  passed++;
  console.log('  PASS: Manifest counts exact (150,522 frames, 124,312 relations, 61,752 summaries, 66 books, 93 partitions)');

  // 2. Coverage check
  console.log('2. Querying coverage API...');
  const { data: cov, elapsed: covTime } = await queryWorker({ op: 'coverage' });
  timings.push(`coverage:${covTime}ms`);
  assert(cov.status === 'ok', 'Coverage status not ok');
  assert(cov.release_version === RELEASE, 'Coverage release mismatch');
  assert(cov.coverage_report.whole_bible_covered === true, 'Expected whole_bible_covered');
  assert(cov.supported_predicates.length === 6, 'Expected 6 supported predicates');
  passed++;
  console.log(`  PASS: Coverage endpoint returned valid metadata in ${covTime}ms`);

  // 3. Test A: Gen 1:1 בָּרָא (lemma:H1254a)
  console.log('3. Test A: Genesis 1:1 בָּרָא (lemma:H1254a)...');
  const { data: bara, elapsed: baraTime } = await queryWorker({
    query: 'lemma:H1254a',
    direction: 'both',
  });
  timings.push(`testA_bara:${baraTime}ms`);
  assert(bara.status === 'ok', 'Expected ok for bara');
  assert(bara.counts.summaries_total > 0, 'Expected summaries for bara');
  assert(bara.relations.length > 0, 'Expected sample relations for bara');
  // Check subject role with Elohim in Gen 1:1
  const subjElohim = bara.summaries.find(
    s => s.predicate === 'grammatical_subject_of' && (s.to_lemma_id === 'lemma:H0430' || s.to_lemma_id === 'lemma:H0430G')
  ) || bara.summaries.find(
    s => s.display_predicate === 'has_grammatical_subject' && (s.related_lemma_id === 'lemma:H0430' || s.related_lemma_id === 'lemma:H0430G')
  );
  assert(subjElohim, 'Expected grammatical_subject_of link between Elohim and Bara');
  passed++;
  console.log(`  PASS: Test A verified בָּרָא (lemma:H1254a, ${bara.counts.summaries_total} summaries) in ${baraTime}ms`);

  // 4. Test B: Ruach (H7307), Gen 1:2, Gen 8:1, Eze 37:9 (4 occurrences), subdivisions H7307G-J
  console.log('4. Test B: Ruach (H7307) and key passages...');
  // 4a: Base Strongs returns valid focus with subdivisions
  const { data: ruach, elapsed: ruachTime } = await queryWorker({ query: 'lemma:H7307' });
  timings.push(`testB_ruach:${ruachTime}ms`);
  assert(ruach.status === 'ok', 'Expected ok for lemma:H7307');
  assert(ruach.focus?.gloss === 'spirit / wind / breath', 'Expected gloss spirit / wind / breath');
  assert(Array.isArray(ruach.focus?.subdivisions) && ruach.focus.subdivisions.length >= 4, 'Expected subdivisions H7307G-J');
  const extKeys = ruach.focus.subdivisions.map(s => s.extended_strongs);
  assert(extKeys.includes('H7307G') && extKeys.includes('H7307H') && extKeys.includes('H7307I') && extKeys.includes('H7307J'), 'Expected all 4 subdivisions H7307G-J');
  passed++;
  console.log('  PASS: Ruach (H7307) correctly preserves all 4 subdivisions (H7307G, H7307H, H7307I, H7307J)');

  // 4b: Gen 1:2 passage frames
  const { data: gen1_2, elapsed: gen1_2Time } = await queryWorker({ op: 'passage_frames', book: 1, chapter: 1, verse: 2 });
  timings.push(`testB_gen1_2:${gen1_2Time}ms`);
  assert(gen1_2.status === 'ok', 'Expected ok for Gen 1:2');
  assert(gen1_2.counts.frames > 0, 'Expected frames in Gen 1:2');
  passed++;
  console.log(`  PASS: Gen 1:2 returned ${gen1_2.counts.frames} frames, ${gen1_2.counts.relations} relations in ${gen1_2Time}ms`);

  // 4c: Gen 8:1 passage frames
  const { data: gen8_1, elapsed: gen8_1Time } = await queryWorker({ op: 'passage_frames', book: 1, chapter: 8, verse: 1 });
  timings.push(`testB_gen8_1:${gen8_1Time}ms`);
  assert(gen8_1.status === 'ok', 'Expected ok for Gen 8:1');
  assert(gen8_1.counts.frames > 0, 'Expected frames in Gen 8:1');
  passed++;
  console.log(`  PASS: Gen 8:1 returned ${gen8_1.counts.frames} frames, ${gen8_1.counts.relations} relations in ${gen8_1Time}ms`);

  // 4d: Eze 37:9 passage frames (Valley of Dry Bones, prophesy to the breath)
  const { data: eze37_9, elapsed: ezeTime } = await queryWorker({ op: 'passage_frames', book: 26, chapter: 37, verse: 9 });
  timings.push(`testB_eze37_9:${ezeTime}ms`);
  assert(eze37_9.status === 'ok', 'Expected ok for Eze 37:9');
  assert(eze37_9.counts.frames >= 8, 'Expected multiple frames for Eze 37:9');
  const ioRuach = eze37_9.relations.find(r => r.predicate === 'grammatical_indirect_object_of' && r.subject.lemma_id === 'lemma:H7307');
  assert(ioRuach, 'Expected indirect object of ruach in Eze 37:9');
  passed++;
  console.log(`  PASS: Eze 37:9 returned ${eze37_9.counts.frames} frames and verified indirect object of רוּחַ in ${ezeTime}ms`);

  // 5. Test C: John 3:17 and Philippians 2 (Greek editions)
  console.log('5. Test C: John 3:17 and Philippians 2:5 in Nestle1904 & SBLGNT...');
  const { data: jhn3_17_n1904, elapsed: jhnNTime } = await queryWorker({
    op: 'passage_frames',
    book: 43, chapter: 3, verse: 17,
    edition_key: 'macula-greek-nestle1904'
  });
  assert(jhn3_17_n1904.status === 'ok', 'Expected ok for JHN 3:17 Nestle1904');
  assert(jhn3_17_n1904.counts.frames > 0, 'Expected frames in JHN 3:17 Nestle1904');

  const { data: jhn3_17_sblgnt, elapsed: jhnSTime } = await queryWorker({
    op: 'passage_frames',
    book: 43, chapter: 3, verse: 17,
    edition_key: 'macula-greek-sblgnt'
  });
  assert(jhn3_17_sblgnt.status === 'ok', 'Expected ok for JHN 3:17 SBLGNT');
  assert(jhn3_17_sblgnt.counts.frames > 0, 'Expected frames in JHN 3:17 SBLGNT');

  const { data: php2_5, elapsed: phpTime } = await queryWorker({
    op: 'passage_frames',
    book: 50, chapter: 2, verse: 5,
    edition_key: 'macula-greek-nestle1904'
  });
  assert(php2_5.status === 'ok', 'Expected ok for PHP 2:5');
  assert(php2_5.counts.frames > 0, 'Expected frames in PHP 2:5');
  passed++;
  console.log(`  PASS: Test C verified John 3:17 (${jhn3_17_n1904.counts.frames} frames) and Phil 2:5 (${php2_5.counts.frames} frames)`);

  // 6. Test D: Revelation coverage (Rev 1:1, Rev 22:20)
  console.log('6. Test D: End-of-Bible Revelation coverage (Rev 1:1, Rev 22:20)...');
  const { data: rev1_1, elapsed: rev1Time } = await queryWorker({ op: 'passage_frames', book: 66, chapter: 1, verse: 1 });
  assert(rev1_1.status === 'ok', 'Expected ok for Rev 1:1');
  assert(rev1_1.counts.frames > 0, 'Expected frames in Rev 1:1');

  const { data: rev22_20, elapsed: rev22Time } = await queryWorker({ op: 'passage_frames', book: 66, chapter: 22, verse: 20 });
  assert(rev22_20.status === 'ok', 'Expected ok for Rev 22:20');
  assert(rev22_20.counts.frames > 0, 'Expected frames in Rev 22:20');
  passed++;
  console.log(`  PASS: Test D verified Revelation 1:1 (${rev1_1.counts.frames} frames) and Revelation 22:20 (${rev22_20.counts.frames} frames)`);

  // 7. Test E: Broad lexical exploration (High-frequency lemmas)
  console.log('7. Test E: High-frequency lemmas (Hebrew: H0430G God, Greek: G2316 God, G2962 Lord, G3056 Word)...');
  const { data: elohimBase } = await queryWorker({ query: 'H0430' });
  assert(elohimBase.status === 'needs_disambiguation', 'Expected needs_disambiguation for base H0430');

  const { data: elohim, elapsed: elohimTime } = await queryWorker({ query: 'lemma:H0430G', direction: 'both' });
  assert(elohim.status === 'ok', 'Expected ok for Elohim');
  assert(elohim.counts.summaries_total > 50, 'Expected >50 summaries for Elohim');

  const { data: theos, elapsed: theosTime } = await queryWorker({ query: 'lemma:G2316', direction: 'both' });
  assert(theos.status === 'ok', 'Expected ok for Theos');
  assert(theos.counts.summaries_total > 50, 'Expected >50 summaries for Theos');

  const { data: kurios, elapsed: kuriosTime } = await queryWorker({ query: 'lemma:G2962G', direction: 'both' });
  assert(kurios.status === 'ok', 'Expected ok for Kurios');
  assert(kurios.counts.summaries_total > 50, 'Expected >50 summaries for Kurios');

  const { data: logos, elapsed: logosTime } = await queryWorker({ query: 'lemma:G3056', direction: 'both' });
  assert(logos.status === 'ok', 'Expected ok for Logos');
  assert(logos.counts.summaries_total > 20, 'Expected >20 summaries for Logos');

  passed++;
  console.log(`  PASS: Test E verified high-frequency lemmas: Elohim (${elohim.counts.summaries_total} summaries), Theos (${theos.counts.summaries_total} summaries), Kurios (${kurios.counts.summaries_total} summaries), Logos (${logos.counts.summaries_total} summaries)`);

  // 8. Homograph disambiguation check (H776 Eretz)
  console.log('8. Verifying homograph disambiguation guardrail (H776)...');
  const { data: h776, elapsed: h776Time } = await queryWorker({ query: 'H776' });
  assert(h776.status === 'needs_disambiguation', 'Expected needs_disambiguation for base H776');
  assert(h776.homograph_siblings.length === 2, 'Expected 2 homograph siblings for H776');
  passed++;
  console.log(`  PASS: Base Strongs H776 correctly returns needs_disambiguation with 2 distinct homograph siblings in ${h776Time}ms`);

  console.log(`=== ALL ${passed} VERIFICATION CHECKS PASSED ON STAGED RELEASE ${RELEASE} ===`);
  console.log('Timings sample:', timings.join(', '));
}

run().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
