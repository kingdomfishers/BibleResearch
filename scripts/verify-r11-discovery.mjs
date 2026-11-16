#!/usr/bin/env node
/**
 * Verification test for Universal R11 Discovery Engine (`r11-v1.0`).
 * Verifies discoverBiblicalConnections, getConnectionEvidence, and expandBiblicalConnection
 * against `.artifacts-r10/deploy-bundle` for:
 *   - "Lily"
 *   - "lilies"
 *   - "H7799"
 *   - "Psalms 45:0"
 *   - "Hyssop"
 *   - "Pomegranate"
 *   - "Water Spirit"
 *   - "Oil Lampstand"
 *   - mode: 'bridge'
 *   - mode: 'compare'
 *   - mode: 'challenge'
 *   - Full pagination on H7799 (all 17 verses)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createNodeFsAssetReader } from '../src/relationships/adjacency-loader.ts';
import {
  DEFAULT_R10_RELEASE,
  discoverBiblicalConnections,
  getConnectionEvidence,
  expandBiblicalConnection,
} from '../src/relationships/r10-discovery.ts';

const BUNDLE_ROOT = path.resolve('.artifacts-r10/deploy-bundle');
const RESTRICTED_KEYS = new Set([
  'semantic_frame', 'frame', 'greekstrong', 'sdbh', 'lexdomain',
  'coredomain', 'contextualdomain', 'domain', 'ln', 's21', 'tbesh_col_7',
]);

function assertNoRestrictedKeys(obj, label) {
  const stack = [obj];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
    } else {
      for (const [k, v] of Object.entries(cur)) {
        assert.ok(!RESTRICTED_KEYS.has(k), `Restricted key "${k}" leaked in ${label}`);
        stack.push(v);
      }
    }
  }
}

async function run() {
  console.log(`[R11-TEST] Starting R11 verification against ${BUNDLE_ROOT}...`);
  assert.equal(DEFAULT_R10_RELEASE, 'r11-v1.0', 'DEFAULT_R10_RELEASE must be r11-v1.0');
  const reader = await createNodeFsAssetReader([BUNDLE_ROOT]);

  // Test 1: "Lily"
  console.log('1. Testing "Lily"...');
  const resLily = await discoverBiblicalConnections(reader, { query: 'Lily' });
  assert.equal(resLily.status, 'ok');
  assertNoRestrictedKeys(resLily, 'Lily');
  const lilyConcept = resLily.parsed_query.resolved_concepts.find(c => c.input_token.toLowerCase() === 'lily');
  assert.ok(lilyConcept, 'Concept "lily" must be resolved');
  assert.ok(lilyConcept.lemmas.some(l => l.strongs === 'H7799'), 'H7799 must be primary resolved lemma for "Lily"');
  // Proper name guard: Susa H7800 must NOT displace lily H7799
  assert.ok(!lilyConcept.lemmas.some(l => l.strongs === 'H7800'), 'Proper name Susa (H7800) must NOT be in primary lemmas for "Lily"');
  assert.ok(lilyConcept.homograph_siblings?.some(h => h.bs === 'H7800'), 'H7800 must be attached in homograph_siblings');
  assert.ok(resLily.clusters.length >= 1, 'Expected clusters for lily');
  assert.ok(resLily.strongest_connections.length >= 1, 'Expected strongest connections for lily');
  assert.ok(resLily.strongest_connections[0].ranking_rationale, 'Expected ranking_rationale');
  console.log(`   ✓ "Lily" resolved H7799 (cnt=${lilyConcept.total_verses}), clusters=${resLily.clusters.length}, connections=${resLily.strongest_connections.length}`);

  // Test 2: "lilies"
  console.log('2. Testing "lilies"...');
  const resLilies = await discoverBiblicalConnections(reader, { query: 'lilies' });
  assert.equal(resLilies.status, 'ok');
  assertNoRestrictedKeys(resLilies, 'lilies');
  const liliesConcept = resLilies.parsed_query.resolved_concepts.find(c => c.input_token.toLowerCase() === 'lilies');
  assert.ok(liliesConcept, 'Concept "lilies" must be resolved');
  assert.ok(liliesConcept.lemmas.some(l => l.strongs === 'H7799'), 'H7799 must be resolved for "lilies"');
  console.log(`   ✓ "lilies" resolved H7799 successfully`);

  // Test 3: "H7799"
  console.log('3. Testing "H7799"...');
  const res7799 = await discoverBiblicalConnections(reader, { query: 'H7799' });
  assert.equal(res7799.status, 'ok');
  assertNoRestrictedKeys(res7799, 'H7799');
  assert.ok(res7799.clusters.some(c => c.cluster_id === 'H7799:temple_and_sanctuary_architecture'), 'Must have temple architecture cluster');
  assert.ok(res7799.clusters.some(c => c.cluster_id === 'H7799:psalm_superscription'), 'Must have psalm superscription cluster');
  assert.ok(res7799.clusters.some(c => c.cluster_id === 'H7799:poetic_imagery_and_similes'), 'Must have poetic imagery cluster');
  console.log(`   ✓ "H7799" found ${res7799.clusters.length} semantic clusters`);

  // Test 4: "Psalms 45:0"
  console.log('4. Testing "Psalms 45:0"...');
  const resPs = await discoverBiblicalConnections(reader, { query: 'Psalms 45:0' });
  assert.equal(resPs.status, 'ok');
  assertNoRestrictedKeys(resPs, 'Psalms 45:0');
  const p0 = resPs.parsed_query.explicit_passages[0];
  assert.ok(p0, 'Explicit passage ref must be parsed');
  assert.equal(p0.book, 19);
  assert.equal(p0.chapter, 45);
  assert.equal(p0.verse, 0, 'Verse must be 0 for Psalm heading');
  assert.equal(p0.is_psalm_heading, true, 'is_psalm_heading must be true');
  assert.equal(p0.ref, 'Psalms 45:0');
  console.log(`   ✓ "Psalms 45:0" parsed with verse: 0, is_psalm_heading: true`);

  // Test 5: "Hyssop"
  console.log('5. Testing "Hyssop"...');
  const resHyssop = await discoverBiblicalConnections(reader, { query: 'Hyssop' });
  assert.equal(resHyssop.status, 'ok');
  assertNoRestrictedKeys(resHyssop, 'Hyssop');
  const hyssopConcept = resHyssop.parsed_query.resolved_concepts.find(c => c.input_token.toLowerCase() === 'hyssop');
  assert.ok(hyssopConcept?.lemmas.some(l => l.strongs === 'H0231'), 'H0231 must be resolved for Hyssop');
  console.log(`   ✓ "Hyssop" resolved H0231 (total_verses=${hyssopConcept.total_verses}), top score=${resHyssop.strongest_connections[0]?.score}`);

  // Test 6: "Pomegranate"
  console.log('6. Testing "Pomegranate"...');
  const resPom = await discoverBiblicalConnections(reader, { query: 'Pomegranate' });
  assert.equal(resPom.status, 'ok');
  assertNoRestrictedKeys(resPom, 'Pomegranate');
  const pomConcept = resPom.parsed_query.resolved_concepts.find(c => c.input_token.toLowerCase() === 'pomegranate');
  assert.ok(pomConcept?.lemmas.some(l => l.strongs === 'H7416'), 'H7416 must be resolved for Pomegranate');
  console.log(`   ✓ "Pomegranate" resolved H7416 (total_verses=${pomConcept.total_verses}), clusters=${resPom.clusters.length}`);

  // Test 7: "Water Spirit"
  console.log('7. Testing "Water Spirit" (multi-concept dynamic intersection)...');
  const resWaterSpirit = await discoverBiblicalConnections(reader, { query: 'Water Spirit' });
  assert.equal(resWaterSpirit.status, 'ok');
  assertNoRestrictedKeys(resWaterSpirit, 'Water Spirit');
  assert.ok(resWaterSpirit.parsed_query.multi_cluster_mode, 'multi_cluster_mode must be true');
  const intersectConn = resWaterSpirit.strongest_connections.find(c => c.evidence_id.startsWith('r11:intersect:verse:'));
  assert.ok(intersectConn, 'Must find same-verse convergence for Water + Spirit');
  console.log(`   ✓ "Water Spirit" found direct convergence: ${intersectConn.title} (score=${intersectConn.score})`);

  // Test 8: "Oil Lampstand"
  console.log('8. Testing "Oil Lampstand"...');
  const resOilLamp = await discoverBiblicalConnections(reader, { query: 'Oil Lampstand' });
  assert.equal(resOilLamp.status, 'ok');
  assertNoRestrictedKeys(resOilLamp, 'Oil Lampstand');
  const oilConn = resOilLamp.strongest_connections.find(c => c.evidence_id.startsWith('r11:intersect:verse:') || c.evidence_id.startsWith('r11:cluster:'));
  assert.ok(oilConn, 'Expected connections for Oil + Lampstand');
  console.log(`   ✓ "Oil Lampstand" generated ${resOilLamp.strongest_connections.length} connections, top: ${resOilLamp.strongest_connections[0]?.title}`);

  // Test 9: mode: 'bridge'
  console.log('9. Testing mode: "bridge"...');
  const resBridge = await discoverBiblicalConnections(reader, {
    query: 'Water Spirit',
    mode: 'bridge',
  });
  assert.equal(resBridge.iterative_analysis?.mode, 'bridge');
  assert.ok(resBridge.iterative_analysis?.explanation, 'Expected bridge explanation');
  console.log(`   ✓ mode: "bridge" returned explanation and ${resBridge.iterative_analysis?.bridges?.length ?? 0} bridges`);

  // Test 10: mode: 'compare'
  console.log('10. Testing mode: "compare"...');
  const resCompare = await discoverBiblicalConnections(reader, {
    query: 'Water Spirit',
    mode: 'compare',
    compare_targets: ['Water', 'Spirit'],
  });
  assert.equal(resCompare.iterative_analysis?.mode, 'compare');
  assert.ok(resCompare.iterative_analysis?.comparison?.targets, 'Expected compare targets');
  console.log(`   ✓ mode: "compare" targets: ${JSON.stringify(resCompare.iterative_analysis?.comparison?.targets)}`);

  // Test 11: mode: 'challenge'
  console.log('11. Testing mode: "challenge"...');
  const resChallenge = await discoverBiblicalConnections(reader, {
    query: 'Lily Susa',
    mode: 'challenge',
  });
  assert.equal(resChallenge.iterative_analysis?.mode, 'challenge');
  assert.ok(resChallenge.iterative_analysis?.challenges?.length >= 1, 'Expected challenge controls');
  console.log(`   ✓ mode: "challenge" returned ${resChallenge.iterative_analysis?.challenges?.length} controls`);

  // Test 12: Full pagination on H7799 (all 17 verses)
  console.log('12. Testing full pagination on H7799 (all 17 verses)...');
  const allVidsFound = new Set();
  let cursor = null;
  let pageCount = 0;
  do {
    const pRes = await discoverBiblicalConnections(reader, {
      query: 'H7799',
      mode: 'expand',
      focus_lemma: 'H7799',
      limit: 6,
      cursor,
    });
    pageCount++;
    const occs = pRes.iterative_analysis?.lemma_occurrences?.passages || [];
    for (const p of occs) {
      allVidsFound.add(p.verse_id);
    }
    cursor = pRes.iterative_analysis?.lemma_occurrences?.next_cursor || null;
  } while (cursor && pageCount < 10);

  console.log(`   ✓ Paged ${pageCount} pages, collected ${allVidsFound.size} unique verse IDs for H7799`);
  assert.equal(allVidsFound.size, 17, `Expected exactly 17 occurrences of H7799, got ${allVidsFound.size}`);

  // Test 13: getConnectionEvidence
  console.log('13. Testing getConnectionEvidence...');
  const topEvId = resLily.strongest_connections[0].evidence_id;
  const evRes = await getConnectionEvidence(reader, topEvId);
  assert.equal(evRes.status, 'ok');
  assertNoRestrictedKeys(evRes, 'getConnectionEvidence');
  assert.ok(evRes.passage_details.length >= 1, 'Expected passage details');
  assert.ok(evRes.passage_details[0].original_tokens.length >= 1, 'Expected original tokens');
  assert.ok(evRes.passage_details[0].english_text, 'Expected English text');
  console.log(`   ✓ getConnectionEvidence loaded ${evRes.passage_details.length} passages with tokens and English text`);

  // Test 14: expandBiblicalConnection
  console.log('14. Testing expandBiblicalConnection...');
  const expRes = await expandBiblicalConnection(reader, 'cluster:H7799:temple_and_sanctuary_architecture');
  assert.equal(expRes.status, 'ok');
  assertNoRestrictedKeys(expRes, 'expandBiblicalConnection');
  assert.ok(expRes.connections.length >= 1, 'Expected expanded connections');
  console.log(`   ✓ expandBiblicalConnection returned ${expRes.connections.length} connections`);

  console.log('\n[R11-TEST] ALL 14 TESTS PASSED PERFECTLY!');
}

run().catch(err => {
  console.error('[R11-TEST] FAILED:', err);
  process.exit(1);
});
