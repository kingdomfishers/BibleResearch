/**
 * scripts/verify-r8-mcp-e2e.mjs
 *
 * Full verification suite for R8C against the live production MCP endpoint:
 * `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`
 * and live website gateway:
 * `https://bibleresearch.kingdomfishers-custom.workers.dev`
 */

import assert from 'node:assert';

const MCP_BASE = 'https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp';
const CORPUS_BASE = 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev';
const WEB_BASE = 'https://bibleresearch.kingdomfishers-custom.workers.dev';

let rpcSeq = 1;

async function mcpCall(name, args = {}) {
  const t0 = Date.now();
  const res = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcSeq++,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const elapsed = Date.now() - t0;
  assert(res.ok, `MCP HTTP ${res.status}`);
  const text = await res.text();
  const dataLine = text.split('\n').find(l => l.startsWith('data: '));
  const rpc = JSON.parse(dataLine ? dataLine.slice(6) : text);
  assert(!rpc.error, `MCP JSON-RPC error: ${JSON.stringify(rpc.error)}`);
  if (rpc.result?.isError) {
    throw new Error(`MCP tool error: ${rpc.result.content?.[0]?.text}`);
  }
  const data = rpc.result.structuredContent ?? JSON.parse(rpc.result.content[0].text);
  return { data, elapsed };
}

async function mcpListTools() {
  const t0 = Date.now();
  const res = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcSeq++,
      method: 'tools/list',
      params: {},
    }),
  });
  const elapsed = Date.now() - t0;
  assert(res.ok, `MCP tools/list HTTP ${res.status}`);
  const text = await res.text();
  const dataLine = text.split('\n').find(l => l.startsWith('data: '));
  const rpc = JSON.parse(dataLine ? dataLine.slice(6) : text);
  return { tools: rpc.result.tools, elapsed };
}

async function run() {
  console.log('=== Verifying Live MCP Server & Whole-Bible Relationship Graph ===');
  console.log(`MCP Endpoint: ${MCP_BASE}/mcp`);

  let checksPassed = 0;
  const timings = [];

  // 1. tools/list verification
  console.log('1. Checking MCP tools/list...');
  const { tools, elapsed: listElapsed } = await mcpListTools();
  timings.push(`tools/list:${listElapsed}ms`);
  const toolNames = new Set(tools.map(t => t.name));
  assert(toolNames.has('get_relationship_coverage_v2'), 'Missing get_relationship_coverage_v2');
  assert(toolNames.has('get_word_relationships_v2'), 'Missing get_word_relationships_v2');
  assert(toolNames.has('get_passage_grammatical_frames_v2'), 'Missing get_passage_grammatical_frames_v2');
  checksPassed++;
  console.log(`  PASS: MCP tools/list returned ${tools.length} registered tools in ${listElapsed}ms`);

  // 2. Active coverage & release check
  console.log('2. Calling get_relationship_coverage_v2...');
  const { data: cov, elapsed: covElapsed } = await mcpCall('get_relationship_coverage_v2', {});
  timings.push(`coverage:${covElapsed}ms`);
  assert(cov.status === 'ok', 'Coverage status not ok');
  assert(cov.release_version === 'r8-v1.1' || cov.release_version === 'r8-v1.0', `Expected release_version r8-v1.1/r8-v1.0, got ${cov.release_version}`);
  assert(cov.manifest_counts.frames_emitted === 150522, 'Frames emitted mismatch');
  assert(cov.manifest_counts.occurrence_relations_emitted === 124312, 'Occurrence relations mismatch');
  assert(cov.manifest_counts.relation_summaries_total === 61752, 'Summaries mismatch');
  assert(cov.manifest_counts.books_covered === 66, 'Books covered mismatch');
  assert(cov.manifest_counts.partitions_covered === 93, 'Partitions mismatch');
  assert(cov.supported_predicates.length === 6, 'Expected 6 supported predicates');
  assert(cov.coverage_report.whole_bible_covered === true, 'Expected whole_bible_covered === true');
  checksPassed++;
  console.log(`  PASS: Active release is ${cov.release_version} (150,522 frames, 124,312 relations, 61,752 summaries, 66 books, 93 partitions) in ${covElapsed}ms`);

  // 3. Test A: Genesis 1:1 בָּרָא (lemma:H1254a)
  console.log('3. Test A: Genesis 1:1 בָּרָא (lemma:H1254a)...');
  const { data: baraRel, elapsed: baraElapsed } = await mcpCall('get_word_relationships_v2', {
    lemma_id: 'lemma:H1254a',
    include_uncertain: false,
  });
  timings.push(`testA_bara:${baraElapsed}ms`);
  assert(baraRel.status === 'ok', 'Expected ok for bara');
  assert(baraRel.counts.summaries_total > 0, 'Expected summaries for bara');

  // Verify Gen 1:1 passage frames
  const { data: gen1_1Frames, elapsed: gen1FramesElapsed } = await mcpCall('get_passage_grammatical_frames_v2', {
    book: 1, chapter: 1, verse: 1,
  });
  timings.push(`testA_gen1_1_frames:${gen1FramesElapsed}ms`);
  assert(gen1_1Frames.status === 'ok', 'Expected ok for Gen 1:1 frames');
  assert(gen1_1Frames.counts.frames === 1, 'Expected 1 frame in Gen 1:1');
  assert(gen1_1Frames.counts.relations === 3, 'Expected 3 relations in Gen 1:1');

  // Verify grammatical subject of God (H0430/H0430G) -> Bara
  const baraSubjRel = gen1_1Frames.relations.find(
    r => r.predicate === 'grammatical_subject_of' && (r.subject.lemma_id === 'lemma:H0430' || r.subject.lemma_id === 'lemma:H0430G')
  );
  assert(baraSubjRel, 'Expected grammatical_subject_of relation for God in Gen 1:1');
  assert(baraSubjRel.subject.token_id === 'o010010010031', 'Exact source token ID mismatch for God');
  assert(baraSubjRel.object.token_id === 'o010010010021', 'Exact source token ID mismatch for Bara');
  assert(baraSubjRel.subject.gloss === 'God', 'Expected gloss God');
  // Check epistemic guardrail
  const predMeta = cov.predicate_meta?.grammatical_subject_of;
  assert(predMeta?.guardrail?.includes('does not imply semantic agency'), 'Guardrail must assert grammatical role != semantic agency');
  checksPassed++;
  console.log(`  PASS: Test A verified Gen 1:1 בָּרָא subject relation to אֱלֹהִים with exact tokens (o010010010031 -> o010010010021) in ${baraElapsed}ms`);

  // 4. Test B: Ruach (H7307), Gen 1:2, Gen 8:1, Eze 37:9, subdivisions H7307G-J
  console.log('4. Test B: Ruach (H7307) and key passages...');
  const { data: ruach, elapsed: ruachElapsed } = await mcpCall('get_word_relationships_v2', {
    lemma_id: 'lemma:H7307',
  });
  timings.push(`testB_ruach:${ruachElapsed}ms`);
  assert(ruach.status === 'ok', 'Expected ok for H7307');
  assert(Array.isArray(ruach.focus?.subdivisions) && ruach.focus.subdivisions.length >= 4, 'Expected all 4 subdivisions');
  const subs = ruach.focus.subdivisions.map(s => s.extended_strongs);
  assert(subs.includes('H7307G') && subs.includes('H7307H') && subs.includes('H7307I') && subs.includes('H7307J'), 'Expected H7307G-J');

  // Gen 1:2
  const { data: gen1_2 } = await mcpCall('get_passage_grammatical_frames_v2', { book: 1, chapter: 1, verse: 2 });
  assert(gen1_2.status === 'ok' && gen1_2.counts.frames > 0, 'Expected ok for Gen 1:2');

  // Gen 8:1
  const { data: gen8_1 } = await mcpCall('get_passage_grammatical_frames_v2', { book: 1, chapter: 8, verse: 1 });
  assert(gen8_1.status === 'ok' && gen8_1.counts.frames > 0, 'Expected ok for Gen 8:1');

  // Eze 37:9 (Valley of Dry Bones, prophesy to the breath)
  const { data: eze37_9, elapsed: ezeElapsed } = await mcpCall('get_passage_grammatical_frames_v2', { book: 26, chapter: 37, verse: 9 });
  timings.push(`testB_eze37_9:${ezeElapsed}ms`);
  assert(eze37_9.status === 'ok', 'Expected ok for Eze 37:9');
  assert(eze37_9.counts.frames >= 8, 'Expected frames >= 8 for Eze 37:9');
  const ezeIo = eze37_9.relations.find(r => r.predicate === 'grammatical_indirect_object_of' && r.subject.lemma_id === 'lemma:H7307');
  assert(ezeIo, 'Expected indirect object of ruach in Eze 37:9');
  checksPassed++;
  console.log(`  PASS: Test B verified Ruach H7307 subdivisions (H7307G-J), Gen 1:2, Gen 8:1, Eze 37:9 (${eze37_9.counts.frames} frames) in ${ezeElapsed}ms`);

  // 5. Test C: John 3:17 and Philippians 2 in Nestle1904 & SBLGNT
  console.log('5. Test C: John 3:17 and Philippians 2:5 in Nestle1904 & SBLGNT...');
  const { data: jhnNestle } = await mcpCall('get_passage_grammatical_frames_v2', {
    book: 43, chapter: 3, verse: 17, edition_key: 'macula-greek-nestle1904',
  });
  assert(jhnNestle.status === 'ok' && jhnNestle.counts.frames === 3, 'Expected 3 frames in JHN 3:17 Nestle1904');

  const { data: jhnSbl } = await mcpCall('get_passage_grammatical_frames_v2', {
    book: 43, chapter: 3, verse: 17, edition_key: 'macula-greek-sblgnt',
  });
  assert(jhnSbl.status === 'ok' && jhnSbl.counts.frames === 3, 'Expected 3 frames in JHN 3:17 SBLGNT');

  const { data: php2_5 } = await mcpCall('get_passage_grammatical_frames_v2', {
    book: 50, chapter: 2, verse: 5, edition_key: 'macula-greek-nestle1904',
  });
  assert(php2_5.status === 'ok' && php2_5.counts.frames === 2, 'Expected 2 frames in PHP 2:5');
  checksPassed++;
  console.log(`  PASS: Test C verified John 3:17 (Nestle1904 & SBLGNT isolated) and Phil 2:5`);

  // 6. Test D: End of Bible (Revelation 1:1, 22:20)
  console.log('6. Test D: Revelation coverage (Rev 1:1, Rev 22:20)...');
  const { data: rev1_1 } = await mcpCall('get_passage_grammatical_frames_v2', { book: 66, chapter: 1, verse: 1 });
  assert(rev1_1.status === 'ok' && rev1_1.counts.frames > 0, 'Expected ok for Rev 1:1');

  const { data: rev22_20, elapsed: revElapsed } = await mcpCall('get_passage_grammatical_frames_v2', { book: 66, chapter: 22, verse: 20 });
  timings.push(`testD_rev22_20:${revElapsed}ms`);
  assert(rev22_20.status === 'ok' && rev22_20.counts.frames === 5, 'Expected 5 frames in Rev 22:20');
  checksPassed++;
  console.log(`  PASS: Test D verified Revelation 1:1 and Revelation 22:20 (5 frames) in ${revElapsed}ms`);

  // 7. Test E: Broad lexical exploration (High-frequency lemmas)
  console.log('7. Test E: High-frequency lemmas (H0430G God, G2316 God, G2962 Lord, G3056 Word)...');
  const { data: elohim, elapsed: elohimElapsed } = await mcpCall('get_word_relationships_v2', {
    lemma_id: 'lemma:H0430G', direction: 'both', limit: 25,
  });
  timings.push(`testE_elohim:${elohimElapsed}ms`);
  assert(elohim.status === 'ok', 'Expected ok for Elohim');
  assert(elohim.counts.summaries_total === 139, `Expected 139 summaries for Elohim, got ${elohim.counts.summaries_total}`);

  const { data: theos, elapsed: theosElapsed } = await mcpCall('get_word_relationships_v2', {
    lemma_id: 'lemma:G2316', direction: 'both', limit: 25,
  });
  timings.push(`testE_theos:${theosElapsed}ms`);
  assert(theos.status === 'ok', 'Expected ok for Theos');
  assert(theos.counts.summaries_total === 680, `Expected 680 summaries for Theos, got ${theos.counts.summaries_total}`);

  const { data: kurios, elapsed: kuriosElapsed } = await mcpCall('get_word_relationships_v2', {
    lemma_id: 'lemma:G2962G', direction: 'both', limit: 25,
  });
  timings.push(`testE_kurios:${kuriosElapsed}ms`);
  assert(kurios.status === 'ok', 'Expected ok for Kurios');
  assert(kurios.counts.summaries_total === 414, `Expected 414 summaries for Kurios, got ${kurios.counts.summaries_total}`);

  const { data: logos, elapsed: logosElapsed } = await mcpCall('get_word_relationships_v2', {
    lemma_id: 'lemma:G3056', direction: 'both', limit: 25,
  });
  timings.push(`testE_logos:${logosElapsed}ms`);
  assert(logos.status === 'ok', 'Expected ok for Logos');
  assert(logos.counts.summaries_total === 320, `Expected 320 summaries for Logos, got ${logos.counts.summaries_total}`);
  checksPassed++;
  console.log(`  PASS: Test E verified high-frequency lemmas: Elohim (139 summaries, ${elohimElapsed}ms), Theos (680 summaries, ${theosElapsed}ms), Kurios (414 summaries, ${kuriosElapsed}ms), Logos (320 summaries, ${logosElapsed}ms)`);

  // 8. Homograph disambiguation guardrail check via MCP
  console.log('8. Checking homograph disambiguation guardrail via MCP (H776)...');
  const { data: h776Mcp, elapsed: h776Elapsed } = await mcpCall('get_word_relationships_v2', { query: 'H776' });
  timings.push(`guardrail_H776:${h776Elapsed}ms`);
  assert(h776Mcp.status === 'needs_disambiguation', 'Expected needs_disambiguation for base H776');
  assert(h776Mcp.homograph_siblings.length === 2, 'Expected 2 homograph siblings for H776');
  checksPassed++;
  console.log(`  PASS: Base Strongs H776 correctly returns needs_disambiguation with 2 distinct homograph siblings in ${h776Elapsed}ms`);

  // 8b. R8D: Transliteration & alias resolution via MCP
  console.log('8b. Checking R8D transliteration ("ruach") and sense alias ("H7307G") via MCP...');
  const { data: ruachTlMcp, elapsed: ruachTlElapsed } = await mcpCall('get_word_relationships_v2', { query: 'ruach' });
  timings.push(`r8d_ruach_tl:${ruachTlElapsed}ms`);
  assert(ruachTlMcp.status === 'needs_disambiguation', 'Expected needs_disambiguation for ruach');
  assert(ruachTlMcp.homograph_candidates?.length === 3, 'Expected 3 phonetic homographs for ruach (H7306, H7307, H7308)');
  checksPassed++;
  console.log(`  PASS: Transliteration "ruach" resolved via normalized transliteration index in ${ruachTlElapsed}ms`);

  const { data: h7307gMcp, elapsed: h7307gElapsed } = await mcpCall('get_word_relationships_v2', { query: 'H7307G' });
  timings.push(`r8d_h7307g:${h7307gElapsed}ms`);
  assert(h7307gMcp.status === 'ok', 'Expected ok for H7307G');
  assert(h7307gMcp.focus?.lemma_id === 'lemma:H7307', 'Expected canonical lemma:H7307 for H7307G');
  checksPassed++;
  console.log(`  PASS: Extended Strong's H7307G resolved to canonical lemma:H7307 in ${h7307gElapsed}ms`);

  // 8c. R8D: Individual relation evidence lookup via MCP
  console.log('8c. Checking R8D individual relation lookup via MCP...');
  const testRelId = 'rel:macula-hebrew-wlc:GEN 1:1#cl0:grammatical_subject_of:o010010010031:o010010010021';
  const { data: relMcp, elapsed: relMcpElapsed } = await mcpCall('get_word_relationships_v2', { query: testRelId });
  timings.push(`r8d_relation_id:${relMcpElapsed}ms`);
  assert(relMcp.status === 'ok', 'Expected ok for relation lookup');
  assert(relMcp.relations?.length === 1, 'Expected 1 relation');
  assert(relMcp.relations[0].canonical_ref === 'GEN 1:1', 'Canonical ref mismatch');
  checksPassed++;
  console.log(`  PASS: Safe relation-ID lookup resolved exact evidence (GEN 1:1) in ${relMcpElapsed}ms`);

  // 8d. R8D: Passage coverage classifications via MCP
  console.log('8d. Checking R8D coverage classifications via MCP...');
  const { data: gen1016Mcp, elapsed: gen1016Elapsed } = await mcpCall('get_passage_grammatical_frames_v2', { book: 1, chapter: 10, verse: 16 });
  timings.push(`r8d_gen1016:${gen1016Elapsed}ms`);
  assert(gen1016Mcp.status === 'no_evidence_in_covered_scope', 'Expected no_evidence_in_covered_scope for Gen 10:16');
  assert(gen1016Mcp.coverage_classification === 'covered_no_supported_relation', 'Expected covered_no_supported_relation for Gen 10:16');
  checksPassed++;
  console.log(`  PASS: Gen 10:16 correctly classified as covered_no_supported_relation in ${gen1016Elapsed}ms`);

  const { data: mat1721Mcp, elapsed: mat1721Elapsed } = await mcpCall('get_passage_grammatical_frames_v2', { book: 40, chapter: 17, verse: 21 });
  timings.push(`r8d_mat1721:${mat1721Elapsed}ms`);
  assert(mat1721Mcp.status === 'not_in_canonical_verse', 'Expected not_in_canonical_verse for Matt 17:21');
  assert(mat1721Mcp.coverage_classification === 'not_in_canonical_verse', 'Expected not_in_canonical_verse classification');
  checksPassed++;
  console.log(`  PASS: Matt 17:21 correctly classified as not_in_canonical_verse in ${mat1721Elapsed}ms`);

  // 9. Website Worker parity check
  console.log('9. Checking website Worker gateway parity...');
  const webRes = await fetch(`${WEB_BASE}/`);
  assert(webRes.ok, `Website gateway HTTP ${webRes.status}`);
  checksPassed++;
  console.log(`  PASS: Website gateway (${WEB_BASE}) is online and responsive`);

  console.log(`\n=== ALL ${checksPassed} MCP & CORPUS VERIFICATION CHECKS PASSED ===`);
  console.log('Timings sample:', timings.join(', '));
}

run().catch(err => {
  console.error('MCP VERIFICATION FAILED:', err);
  process.exit(1);
});
