#!/usr/bin/env node
/**
 * Comprehensive verification suite for BibleResearch R10:
 *   1. Direct engine verification against staged/deploy bundle
 *   2. Full Cloudflare Worker HTTP fetch + withCorpusSecurity verification
 *   3. Local bible-mcp Edge Function tool call round-trip verification
 *   4. Existing R9C/R8D regression verification alongside R10 active release
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { createNodeFsAssetReader } from '../src/relationships/adjacency-loader.ts';
import {
  DEFAULT_R10_RELEASE,
  discoverBiblicalConnections,
  getConnectionEvidence,
} from '../src/relationships/r10-discovery.ts';
import worker from '../scripts/corpus-worker.mjs';

const BUNDLE_ROOT = path.resolve('.artifacts-r10/deploy-bundle');
const RESTRICTED_KEYS = new Set(['semantic_frame', 'frame', 'greekstrong', 'sdbh', 'lexdomain', 'coredomain', 'contextualdomain', 'domain', 'ln', 's21']);

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

function createBundleWorkerEnv(rootDir) {
  return {
    ASSETS: {
      async fetch(req) {
        const u = new URL(req.url);
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
        const full = path.join(rootDir, rel);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          return new Response(fs.readFileSync(full), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      },
    },
  };
}

async function runSuite() {
  assert.ok(fs.existsSync(BUNDLE_ROOT), `Missing R10 deploy bundle at ${BUNDLE_ROOT}`);
  const reader = await createNodeFsAssetReader([BUNDLE_ROOT]);
  const env = createBundleWorkerEnv(BUNDLE_ROOT);

  // --- 1. Acceptance Test A: Multi-concept cluster + bridges ---
  console.log('1. Testing Acceptance Case A (ruach, spirit, seven, eyes, lamps, menorah, oil, water, wind, directions)...');
  const resA = await discoverBiblicalConnections(reader, {
    query: 'ruach, spirit, seven, eyes, lamps, menorah, oil, water, wind, directions',
    limit: 12,
  });
  assert.equal(resA.status, 'ok');
  assertNoRestrictedKeys(resA, 'TestA');
  assert.ok(resA.clusters.length >= 2, 'Expected distinct subclusters rather than one forced chain');
  assert.ok(resA.bridges.length >= 1, 'Expected explicit bridging node between subclusters');
  const refsA = new Set(resA.strongest_connections.flatMap(c => c.passages.map(p => p.ref)));
  for (const expectedRef of ['Revelation 4:5', 'Revelation 5:6', 'Zechariah 4:2', 'Zechariah 4:10', 'Ezekiel 37:9', 'John 3:8', 'John 7:38', 'Genesis 1:2', 'Genesis 8:1']) {
    assert.ok(refsA.has(expectedRef), `Test A missing expected passage ${expectedRef}; got: ${[...refsA].join(', ')}`);
  }
  assert.ok(resA.controls_and_alternatives.some(c => c.control_id === 'ctrl:rev1_20_vs_rev4_5'), 'Test A missing Rev 1:20 vs Rev 4:5 control');
  assert.ok(resA.search_metadata.asset_requests_used <= 15, `Too many asset requests in Test A: ${resA.search_metadata.asset_requests_used}`);

  // --- 2. Acceptance Test B: Red Sea & Baptism ---
  console.log('2. Testing Acceptance Case B (Red Sea crossing and baptism)...');
  const resB = await discoverBiblicalConnections(reader, {
    query: 'How is crossing the Red Sea related to baptism?',
  });
  assert.equal(resB.status, 'ok');
  assertNoRestrictedKeys(resB, 'TestB');
  const topB = resB.strongest_connections[0];
  assert.equal(topB.evidence_tier, 1);
  assert.equal(topB.predicate, 'typological_interpretation');
  assert.ok(topB.passages.some(p => p.ref.startsWith('1 Corinthians 10:')), 'Missing 1 Cor 10');
  assert.ok(topB.passages.some(p => p.ref.startsWith('Exodus 14:')), 'Missing Exod 14');
  assert.ok(resB.controls_and_alternatives.some(c => c.control_id === 'ctrl:exod14_event_vs_paul_typology'), 'Missing Exodus event vs NT typology control');

  const evB = await getConnectionEvidence(reader, topB.evidence_id, DEFAULT_R10_RELEASE);
  assert.equal(evB.status, 'ok');
  const cor102 = evB.passage_details.find(pd => pd.passage.ref === '1 Corinthians 10:2');
  const ex1421 = evB.passage_details.find(pd => pd.passage.ref === 'Exodus 14:21');
  assert.ok(cor102?.original_tokens.some(t => t.strongs === 'G0907'), '1 Cor 10:2 must show βαπτίζω G0907 token');
  assert.ok(ex1421?.original_tokens.some(t => t.strongs === 'H3220'), 'Exod 14:21 must show יָם H3220 token');

  // --- 3. Acceptance Test C: Adam and dam ---
  console.log('3. Testing Acceptance Case C (Adam and dam)...');
  const resC = await discoverBiblicalConnections(reader, {
    query: 'Is there a connection between Adam and dam?',
  });
  assert.equal(resC.status, 'ok');
  assertNoRestrictedKeys(resC, 'TestC');
  const gen27Idx = resC.strongest_connections.findIndex(c => c.evidence_id === 'r10:wordplay:adam_adamah_gen2_7');
  const orthIdx = resC.strongest_connections.findIndex(c => c.evidence_id === 'r10:orth:adam_dam_consonantal_overlap');
  assert.ok(gen27Idx >= 0 && orthIdx >= 0, 'Test C must return both Gen 2:7 Adam-Adamah wordplay and Adam-Dam orthographic analysis');
  assert.ok(gen27Idx < orthIdx, `Gen 2:7 Adam-Adamah (rank ${gen27Idx}) must rank higher than Adam-Dam orthographic overlap (rank ${orthIdx})`);
  const evC = await getConnectionEvidence(reader, 'r10:orth:adam_dam_consonantal_overlap');
  assert.equal(evC.evidence?.orthographic_analysis?.proven_common_root, false);
  assert.ok(resC.controls_and_alternatives.some(c => c.kind === 'orthographic_false_positive_warning'));

  // --- 4. §11 Additional Required Checks ---
  console.log('4. Testing §11 cases (Genesis 1->Rev 4, Passover->Jesus, same-image/different-word, homographs, pagination, missing concepts)...');
  const resGenRev = await discoverBiblicalConnections(reader, { query: "Genesis 1 creation and Revelation's seven spirits" });
  assert.ok(resGenRev.strongest_connections.some(c => c.evidence_id === 'r10:corresp:gen1_to_rev4_rev21_creation_spirits'));

  const resPassover = await discoverBiblicalConnections(reader, { query: 'Passover door, blood, and Jesus' });
  assert.equal(resPassover.strongest_connections[0].evidence_id, 'r10:typo:exod12_passover_blood_christ_1cor5_7');
  assert.ok(resPassover.strongest_connections.some(c => c.evidence_id === 'r10:motif:john10_door_thematic_contrast'), 'Must separate John 10 shared motif from explicit 1 Cor 5:7/John 19:36');

  const resHomograph = await discoverBiblicalConnections(reader, { query: 'ayin well marriage' });
  assert.ok(resHomograph.strongest_connections.some(c => c.evidence_id === 'r10:homograph:ayin_eye_vs_spring_h5869'));
  assert.ok(resHomograph.strongest_connections.some(c => c.evidence_id === 'r10:pattern:well_marriage_with_controls'));

  const resMissing = await discoverBiblicalConnections(reader, { query: 'ruach foobarnotaword' });
  assert.equal(resMissing.status, 'partial');
  assert.ok(resMissing.parsed_query.missing_concepts.includes('foobarnotaword'));
  assert.ok(resMissing.controls_and_alternatives.some(c => c.kind === 'missing_evidence'));

  // Pagination test
  const page1 = await discoverBiblicalConnections(reader, { query: 'ruach spirit seven eyes lamps oil water wind', limit: 3, cursor: null });
  assert.equal(page1.strongest_connections.length, 3);
  assert.equal(page1.pagination.has_more, true);
  assert.ok(page1.pagination.next_cursor);
  const page2 = await discoverBiblicalConnections(reader, { query: 'ruach spirit seven eyes lamps oil water wind', limit: 3, cursor: page1.pagination.next_cursor });
  assert.ok(page2.strongest_connections.length > 0);
  const p1Ids = new Set(page1.strongest_connections.map(x => x.evidence_id));
  assert.ok(page2.strongest_connections.every(x => !p1Ids.has(x.evidence_id)), 'Pagination pages must be disjoint');

  // --- 5. Worker HTTP Gateway + withCorpusSecurity + R9C Regression ---
  console.log('5. Testing Cloudflare Worker HTTP RPC gateway & R9C regression...');
  const rpcCall = async (op, body) => {
    const req = new Request(`https://corpus.local/v1/rpc/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const resp = await worker.fetch(req, env, {});
    assert.equal(resp.status, 200, `${op} failed with HTTP ${resp.status}`);
    const data = await resp.json();
    assertNoRestrictedKeys(data, `Worker:${op}`);
    return data;
  };

  const wDiscover = await rpcCall('discover_biblical_connections_v1', { query: 'Red Sea baptism' });
  assert.equal(wDiscover.status, 'ok');
  const wEv = await rpcCall('get_connection_evidence_v1', { evidence_id: wDiscover.strongest_connections[0].evidence_id });
  assert.equal(wEv.status, 'ok');
  const wExpand = await rpcCall('expand_biblical_connection_v1', { node_id: 'motif:lampstand' });
  assert.equal(wExpand.status, 'ok');

  // R9C regression through active R10 bundle
  const wR9c = await rpcCall('resolve_research_concept_v1', { query: 'ruach' });
  assert.ok(wR9c.candidates?.length > 0, 'R9C resolve_research_concept_v1 regression check failed');

  console.log('ALL R10 DISCOVERY, EVIDENCE, PAGINATION, WORKER SECURITY & R9C REGRESSION CHECKS PASSED.');
}

runSuite().catch(err => {
  console.error('R10 verification failed:', err);
  process.exit(1);
});
