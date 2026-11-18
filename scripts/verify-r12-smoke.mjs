/**
 * Short targeted smoke & unit verification for BibleResearch R12 (Step 5):
 *  1) Unit test of TypeScript scoreR12Path & rankR12DiscoveryDestinations
 *  2) 1 Hebrew 2+ hop discovery + evidence smoke test (H5869)
 *  3) 1 Greek 2+ hop discovery + evidence smoke test (G3088)
 *  4) 1 real-world physical-property bridge discovery + evidence smoke test
 *  5) Intermediate R12 node expansion smoke check
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {
  computeFeatureIdf,
  R12_SCORE_VERSION,
  rankR12DiscoveryDestinations,
  scoreR12Path,
} from '../src/relationships/path-ranker.ts';
import {
  DEFAULT_R10_RELEASE,
  discoverBiblicalConnections,
  expandBiblicalConnection,
  getConnectionEvidence,
} from '../src/relationships/r10-discovery.ts';

// --- 1. Unit tests for authoritative TypeScript R12 proof ranker ---
const stepBase = {
  from_id: 'lemma:A',
  to_id: 'lemma:B',
  direction: 'forward',
  quality_weight: 0.9,
  feature_idf: computeFeatureIdf(31203, 40),
  intermediate_degree: 25,
};

const s1 = { ...stepBase, edge_id: 'e1', relation_type: 'gram_subject_of', epistemic_layer: 'TEXTUAL', attestation_groups: ['gram:GEN 16:7|cl1'], passage_ids: ['Genesis 16:7'] };
const s2 = { ...stepBase, edge_id: 'e2', from_id: 'lemma:B', to_id: 'lemma:C', relation_type: 'lxx_translation_bridge', epistemic_layer: 'LINGUISTIC', attestation_groups: ['lxx:catss:G4077<->H5869'], passage_ids: ['John 4:6'] };
const sAdmin = { edge_id: 'admin1', relation_type: 'sense_subdivision_of', epistemic_layer: 'LINGUISTIC', quality_weight: 0.98, administrative: true, attestation_groups: [], passage_ids: [] };
const sExt = { ...stepBase, edge_id: 'e3', relation_type: 'SHARES_EXTERNAL_PROPERTY', epistemic_layer: 'EXTERNAL_WORLD', mapping_status: 'candidate', attestation_groups: ['should-be-ignored'], passage_ids: [] };

const scoredText = scoreR12Path({ anchor_id: 'lemma:A', target_id: 'lemma:C', steps: [s1, sAdmin, s2] });
assert.equal(scoredText.score_version, R12_SCORE_VERSION);
assert.equal(scoredText.meaningful_hops, 2, 'administrative step must not increment meaningful_hops');
assert.equal(scoredText.physical_hops, 3, 'administrative step must count toward physical_hops');
assert.equal(scoredText.epistemic_status, 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION');
assert.equal(scoredText.independent_evidence_groups.length, 2);

const scoredExt = scoreR12Path({ anchor_id: 'lemma:A', target_id: 'lemma:C', steps: [s1, sExt] });
assert.equal(scoredExt.epistemic_status, 'EXPLORATORY');
assert.deepEqual(scoredExt.independent_evidence_groups, ['gram:GEN 16:7|cl1'], 'EXTERNAL_WORLD must never add biblical attestation groups');
assert.throws(() => scoreR12Path({ anchor_id: 'lemma:A', target_id: 'lemma:B', steps: [sAdmin] }), /administrative/i);

const ranked = rankR12DiscoveryDestinations([
  { anchor_id: 'lemma:A', target_id: 'lemma:C', steps: [s1, s2] },
  {
    anchor_id: 'lemma:A',
    target_id: 'lemma:C',
    steps: [
      { ...s1, edge_id: 'e1-alt', relation_type: 'lex_shares_root', attestation_groups: ['gram:GEN 21:19|cl1', 'gram:GEN 24:13|cl2'] },
      s2,
    ],
  },
  { anchor_id: 'lemma:A', target_id: 'lemma:D', steps: [s1, sExt] },
]);
assert.equal(ranked.top.length, 2);
assert.equal(ranked.top[0].target_id, 'lemma:C');
assert.ok(ranked.top[0].C > ranked.top[1].C, 'convergent biblical destination must have higher C than external-only bridge');
assert.equal(ranked.top[0].alternative_paths.length, 1, 'alternative route must be preserved');
console.log('1. TypeScript R12 proof ranker unit assertions passed.');

// --- Local staging-bundle AssetReader with byte-range support ---
const bundleRoot = path.resolve('.artifacts-r12/staging-bundle');
assert.ok(fs.existsSync(bundleRoot), 'Local .artifacts-r12/staging-bundle required for smoke tests');

const localReader = {
  async readJson(assetPath) {
    const [rawPath, hashPart] = assetPath.split('#');
    const cleanRel = rawPath.replace(/^\/+/, '');
    const full = path.join(bundleRoot, cleanRel);
    if (!fs.existsSync(full)) return null;
    if (hashPart && hashPart.startsWith('bytes=')) {
      const [start, end] = hashPart.slice(6).split('-').map(Number);
      const fd = fs.openSync(full, 'r');
      const len = end - start + 1;
      const buf = Buffer.allocUnsafe(len);
      fs.readSync(fd, buf, 0, len, start);
      fs.closeSync(fd);
      const raw = buf[0] === 31 && buf[1] === 139 ? zlib.gunzipSync(buf) : buf;
      return { data: JSON.parse(raw.toString('utf8')), bytes: len };
    }
    const buf = fs.readFileSync(full);
    const raw = full.endsWith('.gz') ? zlib.gunzipSync(buf) : buf;
    return { data: JSON.parse(raw.toString('utf8')), bytes: buf.length };
  },
  async readBytes(assetPath, start, length) {
    const cleanRel = assetPath.split('#')[0].replace(/^\/+/, '');
    const full = path.join(bundleRoot, cleanRel);
    if (!fs.existsSync(full)) return null;
    const fd = fs.openSync(full, 'r');
    const buf = Buffer.allocUnsafe(length);
    fs.readSync(fd, buf, 0, length, start);
    fs.closeSync(fd);
    return buf;
  },
};

// --- 2. One Hebrew 2+ hop smoke test (H5869) ---
const hebDisc = await discoverBiblicalConnections(localReader, { query: 'H5869', limit: 15 }, DEFAULT_R10_RELEASE);
assert.equal(hebDisc.status, 'ok');
assert.ok(hebDisc.r12_discovery?.pilot_anchors_matched.includes('H5869'), 'Expected H5869 in r12_discovery');
const hebMulti = hebDisc.strongest_connections.find((c) => c.evidence_id.startsWith('r12:path:H5869:') && (c.r12_metadata?.meaningful_hops ?? 0) >= 2);
assert.ok(hebMulti, 'Expected Hebrew 2+ hop R12 connection for H5869');
const hebEv = await getConnectionEvidence(localReader, hebMulti.evidence_id, DEFAULT_R10_RELEASE);
assert.equal(hebEv.status, 'ok');
assert.ok(hebEv.passage_details.length > 0, 'Expected hydrated Hebrew witness passages');
console.log(`2. Hebrew 2+ hop smoke passed (${hebMulti.evidence_id}, hops=${hebMulti.r12_metadata.meaningful_hops}, witnesses=${hebEv.passage_details.length}).`);

// --- 3. One Greek 2+ hop smoke test (G3088) ---
const grkDisc = await discoverBiblicalConnections(localReader, { query: 'G3088', limit: 15 }, DEFAULT_R10_RELEASE);
assert.equal(grkDisc.status, 'ok');
assert.ok(grkDisc.r12_discovery?.pilot_anchors_matched.includes('G3088'), 'Expected G3088 in r12_discovery');
const grkMulti = grkDisc.strongest_connections.find((c) => c.evidence_id.startsWith('r12:path:G3088:') && (c.r12_metadata?.meaningful_hops ?? 0) >= 2);
assert.ok(grkMulti, 'Expected Greek 2+ hop R12 connection for G3088');
const grkEv = await getConnectionEvidence(localReader, grkMulti.evidence_id, DEFAULT_R10_RELEASE);
assert.equal(grkEv.status, 'ok');
assert.ok(grkEv.passage_details.length > 0, 'Expected hydrated Greek witness passages');
console.log(`3. Greek 2+ hop smoke passed (${grkMulti.evidence_id}, hops=${grkMulti.r12_metadata.meaningful_hops}, witnesses=${grkEv.passage_details.length}).`);

// --- 4. One real-world physical-property bridge smoke test ---
const propConn = grkDisc.strongest_connections.find((c) => c.evidence_id.startsWith('r12:prop:G3088:')) ||
  hebDisc.strongest_connections.find((c) => c.evidence_id.startsWith('r12:prop:H5869:'));
assert.ok(propConn, 'Expected physical-world property bridge connection');
assert.equal(propConn.predicate, 'shared_external_property');
assert.equal(propConn.epistemic_class, 'external_world_bridge');
assert.equal(propConn.r12_metadata?.external_bridge?.independent_biblical_support, 0);
const propEv = await getConnectionEvidence(localReader, propConn.evidence_id, DEFAULT_R10_RELEASE);
assert.equal(propEv.status, 'ok');
assert.ok(propEv.evidence?.provenance?.source_record_ids?.length > 0, 'Expected licensed OEWN/Wikidata source record IDs');
assert.ok(/WordNet|Wikidata/i.test(propEv.evidence.provenance.source_dataset));
console.log(`4. External physical-property bridge smoke passed (${propConn.evidence_id}, license=${propEv.evidence.provenance.license}, sources=${propEv.evidence.provenance.source_record_ids.join(',')}).`);

// --- 5. Intermediate node expansion smoke ---
const expRes = await expandBiblicalConnection(localReader, 'wd:Q821952', { limit: 6, release_id: DEFAULT_R10_RELEASE });
assert.equal(expRes.status, 'ok');
assert.ok(expRes.connections.length > 0);
console.log(`5. External node expansion smoke passed (wd:Q821952 -> ${expRes.connections.length} connections).`);
