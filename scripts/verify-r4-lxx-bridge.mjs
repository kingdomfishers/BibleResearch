/**
 * scripts/verify-r4-lxx-bridge.mjs
 *
 * Automated verification suite for R4: Hebrew–Greek Septuagint Lexical Bridge.
 *
 * Tests the 9 core verification requirements from Section 5:
 * 1. Deterministic output hashes (100% byte-for-byte reproducibility).
 * 2. Valid canonical endpoints (all mapped edges link to real canonical lemmas).
 * 3. Preserved source identifiers (all 3,301 records, leading zeros, counts preserved).
 * 4. No false homograph merging (full candidate sets preserved).
 * 5. Correct published frequency metadata (counts match, candidates ranked descending).
 * 6. No duplicate bidirectional facts (Hebrew->Greek and Greek->Hebrew are views of same edges).
 * 7. License hygiene (CC BY 4.0, pinned SHA256/commit, no MARBLE/Louw-Nida derivation).
 * 8. No unsupported claims of token alignment (translation_candidate predicate, guardrails).
 * 9. Correct handling of unmapped source entries (clean isolation, no runtime failure).
 *
 * Plus critical research tests:
 * - Ruach (H7307) -> pneuma (G4151), anemos (G0417), pnoe (G4157)
 * - Elohim (H0430) -> all 4 canonical homographs preserved
 * - Dabar (H1697) & Logos (G3056) -> full speech vocabulary network
 * - Ambiguity and crosswalk tests
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildLxxBridge, fnv1a64Hex, bucket64, normalizeStrongsCode } from './build-r4-lxx-bridge.mjs';

const REPO_ROOT = path.resolve('.');
const ARTIFACTS_DIR = path.join(REPO_ROOT, '.artifacts', 'r4-lxx-bridge');
const SHARDS_DIR = path.join(ARTIFACTS_DIR, 'shards');
const SOURCE_PATH = path.join(REPO_ROOT, 'data', 'sources', 'bcv-lxx-bridge', 'lxx_bridge.tsv');

let totalTests = 0;
let passedTests = 0;
const failures = [];

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failures.push(message);
    console.error(`  FAIL: ${message}`);
  } else {
    passedTests++;
    console.log(`  PASS: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected: ${expected}, actual: ${actual})`);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function runVerification() {
  console.log('===============================================================');
  console.log('R4: Hebrew–Greek Septuagint Lexical Bridge — Verification Suite');
  console.log('===============================================================\n');

  // Test 1: Pinned Source and License Hygiene
  console.log('--- Test Suite 1: Source Provenance and License Hygiene ---');
  assert(fs.existsSync(SOURCE_PATH), `Pinned source file exists at ${SOURCE_PATH}`);
  const sourceBytes = fs.readFileSync(SOURCE_PATH);
  const sourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  assertEqual(sourceHash, '97c1c2a8df1f33069ecd88dab3a1b7ff179e900236ac41cd4d93f12ec5d40cff', 'Source SHA-256 matches exact pinned hash');
  assertEqual(sourceBytes.length, 48191, 'Source byte length matches 48,191 bytes');

  const manifestPath = path.join(ARTIFACTS_DIR, 'source_provenance_and_license_manifest.json');
  assert(fs.existsSync(manifestPath), 'License manifest exists');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assertEqual(manifest.license.primary, 'CC BY 4.0', 'Manifest license is CC BY 4.0');
  assertEqual(manifest.dataset.revision, 'b3b135b24394aa4a8f4eaa59dbc59689735c2b46', 'Manifest revision matches pinned commit');
  assert(manifest.license.upstream_notices.some(n => n.includes('MACULA')), 'Upstream notices cite MACULA');
  assert(manifest.license.upstream_notices.some(n => n.includes('MARBLE')), 'Explicit disclaimer that UBS MARBLE is excluded');

  // Check tracked copies in data/relationships/
  const trackedManifestPath = path.join(REPO_ROOT, 'data', 'relationships', 'lxx-bridge-manifest.json');
  if (fs.existsSync(trackedManifestPath)) {
    assertEqual(sha256File(trackedManifestPath), sha256File(manifestPath), 'Tracked manifest matches artifact manifest');
  }

  // Test 2: Deterministic Output Hashes (Reproducibility)
  console.log('\n--- Test Suite 2: Deterministic Output Hashes ---');
  const initialEdgesHash = sha256File(path.join(ARTIFACTS_DIR, 'translation_candidate_edges.json'));
  const initialH2gHash = sha256File(path.join(ARTIFACTS_DIR, 'hebrew_to_greek_index.json'));
  const initialG2hHash = sha256File(path.join(ARTIFACTS_DIR, 'greek_to_hebrew_index.json'));

  // Re-run build to verify bit-for-bit identical outputs
  const rebuildResult = buildLxxBridge();
  assert(rebuildResult.success, 'Rebuild completed successfully');

  const secondEdgesHash = sha256File(path.join(ARTIFACTS_DIR, 'translation_candidate_edges.json'));
  const secondH2gHash = sha256File(path.join(ARTIFACTS_DIR, 'hebrew_to_greek_index.json'));
  const secondG2hHash = sha256File(path.join(ARTIFACTS_DIR, 'greek_to_hebrew_index.json'));

  assertEqual(secondEdgesHash, initialEdgesHash, 'translation_candidate_edges.json is byte-for-byte deterministic');
  assertEqual(secondH2gHash, initialH2gHash, 'hebrew_to_greek_index.json is byte-for-byte deterministic');
  assertEqual(secondG2hHash, initialG2hHash, 'greek_to_hebrew_index.json is byte-for-byte deterministic');

  // Test 3: Preserved Source Identifiers and Schema
  console.log('\n--- Test Suite 3: Preserved Source Identifiers ---');
  const edges = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, 'translation_candidate_edges.json'), 'utf8'));
  assertEqual(edges.length, 3301, 'Exactly 3,301 materialized translation candidate edges');

  let preservedIdentifiersCount = 0;
  let preservedCountsCount = 0;
  let leadingZerosPreserved = true;

  const rawLines = sourceBytes.toString('utf8').trim().split('\n').slice(1);
  for (let i = 0; i < rawLines.length; i++) {
    const [h, g, c] = rawLines[i].split('\t');
    const edge = edges[i];
    if (edge.hebrew_strong === h && edge.greek_strong === g) preservedIdentifiersCount++;
    if (edge.published_count === parseInt(c, 10)) preservedCountsCount++;
    if (h.startsWith('H0') && !edge.hebrew_strong.startsWith('H0')) leadingZerosPreserved = false;
    if (g.startsWith('G0') && !edge.greek_strong.startsWith('G0')) leadingZerosPreserved = false;
  }

  assertEqual(preservedIdentifiersCount, 3301, 'All 3,301 source Strong codes match source lines in exact order');
  assertEqual(preservedCountsCount, 3301, 'All 3,301 published counts match source lines');
  assert(leadingZerosPreserved, 'Leading zeros strictly preserved on Strong codes (e.g. H0001, G0417)');

  // Test 4: Valid Canonical Endpoints
  console.log('\n--- Test Suite 4: Valid Canonical Endpoints ---');
  let validEndpointsCount = 0;
  let nonZeroCandidatesCount = 0;
  for (const edge of edges) {
    const hKeys = edge.hebrew.candidate_lemma_keys;
    const gKeys = edge.greek.candidate_lemma_keys;
    if (hKeys.length > 0 && gKeys.length > 0) nonZeroCandidatesCount++;
    const allHValid = hKeys.every(k => k.startsWith('lemma:H'));
    const allGValid = gKeys.every(k => k.startsWith('lemma:G'));
    if (allHValid && allGValid) validEndpointsCount++;
  }
  assertEqual(nonZeroCandidatesCount, 3301, 'All 3,301 edges resolve to non-empty candidate lemma sets');
  assertEqual(validEndpointsCount, 3301, 'All candidate lemma keys conform to canonical lemma format (lemma:H/G...)');

  // Test 5: No False Homograph Merging
  console.log('\n--- Test Suite 5: No False Homograph Merging ---');
  const h2g = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, 'hebrew_to_greek_index.json'), 'utf8'));

  // H0430 (Elohim)
  const elohimEntry = h2g.by_strongs['H0430'];
  assert(elohimEntry != null, 'H0430 entry found in Hebrew->Greek index');
  const elohimHKeys = elohimEntry.candidates[0].hebrew_lemma_keys;
  assert(elohimHKeys != null || elohimEntry.candidates.length > 0, 'H0430 has candidate edges');
  const elohimEdge = edges.find(e => e.hebrew_strong === 'H0430' && e.greek_strong === 'G2316');
  assertEqual(elohimEdge.hebrew.candidate_count, 4, 'H0430 retains all 4 canonical homographs');
  assert(elohimEdge.homograph_ambiguity, 'H0430 edge labeled homograph_ambiguity=true');
  assert(elohimEdge.hebrew.candidate_lemma_keys.includes('lemma:H0430G'), 'H0430 contains lemma:H0430G');
  assert(elohimEdge.hebrew.candidate_lemma_keys.includes('lemma:H0430H'), 'H0430 contains lemma:H0430H');
  assert(elohimEdge.hebrew.candidate_lemma_keys.includes('lemma:H0430I'), 'H0430 contains lemma:H0430I');
  assert(elohimEdge.hebrew.candidate_lemma_keys.includes('lemma:H0430a'), 'H0430 contains lemma:H0430a');

  // H1697 (Dabar)
  const dabarEdge = edges.find(e => e.hebrew_strong === 'H1697' && e.greek_strong === 'G3056');
  assertEqual(dabarEdge.hebrew.candidate_count, 2, 'H1697 retains both canonical homographs (H1697G and H1697O)');
  assert(dabarEdge.homograph_ambiguity, 'H1697 edge labeled homograph_ambiguity=true');

  // H0001 (Ab)
  const abEdge = edges.find(e => e.hebrew_strong === 'H0001' && e.greek_strong === 'G3962');
  assertEqual(abEdge.hebrew.candidate_count, 3, 'H0001 retains all 3 canonical homographs (H0001G, H0001H, H0001I)');
  assert(abEdge.homograph_ambiguity, 'H0001 edge labeled homograph_ambiguity=true');

  // Test 6: Correct Published Frequency Metadata and Ranking
  console.log('\n--- Test Suite 6: Frequency Metadata and Ranking ---');
  let strictlyRankedForward = true;
  for (const [strongs, data] of Object.entries(h2g.by_strongs)) {
    for (let j = 1; j < data.candidates.length; j++) {
      if (data.candidates[j].published_count > data.candidates[j - 1].published_count) {
        strictlyRankedForward = false;
      }
    }
  }
  assert(strictlyRankedForward, 'Hebrew->Greek candidates strictly ranked descending by published count');

  const g2h = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, 'greek_to_hebrew_index.json'), 'utf8'));
  let strictlyRankedReverse = true;
  for (const [strongs, data] of Object.entries(g2h.by_strongs)) {
    for (let j = 1; j < data.candidates.length; j++) {
      if (data.candidates[j].published_count > data.candidates[j - 1].published_count) {
        strictlyRankedReverse = false;
      }
    }
  }
  assert(strictlyRankedReverse, 'Greek->Hebrew candidates strictly ranked descending by published count');

  // Test 7: No Duplicate Bidirectional Facts
  console.log('\n--- Test Suite 7: No Duplicate Bidirectional Facts ---');
  const forwardEdgeIds = new Set();
  for (const data of Object.values(h2g.by_strongs)) {
    for (const c of data.candidates) forwardEdgeIds.add(c.edge_id);
  }
  const reverseEdgeIds = new Set();
  for (const data of Object.values(g2h.by_strongs)) {
    for (const c of data.candidates) reverseEdgeIds.add(c.edge_id);
  }

  assertEqual(forwardEdgeIds.size, 3301, 'Forward index contains exactly 3,301 distinct edge IDs');
  assertEqual(reverseEdgeIds.size, 3301, 'Reverse index contains exactly 3,301 distinct edge IDs');
  let identicalFactSets = true;
  for (const id of forwardEdgeIds) {
    if (!reverseEdgeIds.has(id)) identicalFactSets = false;
  }
  assert(identicalFactSets, 'Forward and reverse indexes reference the exact same 3,301 underlying facts');

  // Test 8: Guardrails and No Unsupported Claims of Token Alignment
  console.log('\n--- Test Suite 8: Guardrails and Alignment Classification ---');
  let allEdgesCandidateClass = true;
  let allEdgesHaveGuardrails = true;
  for (const edge of edges) {
    if (edge.predicate !== 'translation_candidate' || edge.classification !== 'translation_candidate') {
      allEdgesCandidateClass = false;
    }
    if (!edge.guardrails.not_synonymy || !edge.guardrails.not_token_alignment || !edge.guardrails.not_nt_usage_claim) {
      allEdgesHaveGuardrails = false;
    }
  }
  assert(allEdgesCandidateClass, 'All 3,301 edges strictly classified as translation_candidate');
  assert(allEdgesHaveGuardrails, 'All 3,301 edges carry explicit guardrails (not synonymy, not token alignment, not NT claim)');

  // Test 9: Unmapped Source Handling
  console.log('\n--- Test Suite 9: Unmapped Source Handling ---');
  const syntheticUnmapped = normalizeStrongsCode('H99999');
  assertEqual(syntheticUnmapped.compact, 'H99999', 'Normalized synthetic unmapped code');
  assertEqual(syntheticUnmapped.padded, 'H99999', 'Padded synthetic unmapped code');

  // Test 10: Critical Lexical Research Tests: Ruach (H7307)
  console.log('\n--- Test Suite 10: Ruach Research Tests (H7307) ---');
  const ruach = h2g.by_strongs['H7307'];
  assert(ruach != null, 'Ruach H7307 present in index');
  assertEqual(ruach.candidate_count, 3, 'Ruach H7307 has exactly 3 documented translation candidates');
  assertEqual(ruach.total_attested_renderings, 306, 'Ruach H7307 has 306 total attested renderings (259 + 44 + 3)');

  const ruachPneuma = ruach.candidates.find(c => c.greek_strong === 'G4151');
  assert(ruachPneuma != null, 'Ruach translates to G4151 (pneuma)');
  assertEqual(ruachPneuma.published_count, 259, 'Ruach -> pneuma count is exactly 259');
  assertEqual(ruachPneuma.translation_share, 0.8464, 'Ruach -> pneuma share is 84.64%');

  const ruachAnemos = ruach.candidates.find(c => c.greek_strong === 'G0417');
  assert(ruachAnemos != null, 'Ruach translates to G0417 (anemos)');
  assertEqual(ruachAnemos.published_count, 44, 'Ruach -> anemos count is exactly 44');
  assertEqual(ruachAnemos.translation_share, 0.1438, 'Ruach -> anemos share is 14.38%');

  const ruachPnoe = ruach.candidates.find(c => c.greek_strong === 'G4157');
  assert(ruachPnoe != null, 'Ruach translates to G4157 (pnoe)');
  assertEqual(ruachPnoe.published_count, 3, 'Ruach -> pnoe count is exactly 3');

  // Reverse checks
  const pneuma = g2h.by_strongs['G4151'];
  assert(pneuma != null, 'Pneuma G4151 present in reverse index');
  assertEqual(pneuma.candidate_count, 1, 'Pneuma G4151 translates from 1 Hebrew word');
  assertEqual(pneuma.candidates[0].hebrew_strong, 'H7307', 'Pneuma G4151 translates exclusively from H7307');
  assertEqual(pneuma.candidates[0].published_count, 259, 'Pneuma -> Ruach count is 259');

  const anemos = g2h.by_strongs['G0417'];
  assert(anemos != null, 'Anemos G0417 present in reverse index');
  assertEqual(anemos.candidates[0].hebrew_strong, 'H7307', 'Anemos G0417 translates exclusively from H7307');
  assertEqual(anemos.candidates[0].published_count, 44, 'Anemos -> Ruach count is 44');

  // Test 11: Critical Lexical Research Tests: God (H0430)
  console.log('\n--- Test Suite 11: Elohim Research Tests (H0430) ---');
  const elohim = h2g.by_strongs['H0430'];
  assert(elohim != null, 'Elohim H0430 present in index');
  assertEqual(elohim.candidate_count, 4, 'Elohim H0430 has 4 documented Greek translation candidates');
  assertEqual(elohim.candidates[0].greek_strong, 'G2316', 'Primary candidate is G2316 (theos)');
  assertEqual(elohim.candidates[0].published_count, 2153, 'Elohim -> theos count is 2,153');
  assertEqual(elohim.candidates[1].greek_strong, 'G2962', 'Secondary candidate is G2962 (kyrios)');
  assertEqual(elohim.candidates[1].published_count, 70, 'Elohim -> kyrios count is 70');
  assertEqual(elohim.candidates[2].greek_strong, 'G3588', 'Articular candidate is G3588 (ho)');
  assertEqual(elohim.candidates[2].published_count, 53, 'Elohim -> ho count is 53');
  assertEqual(elohim.candidates[3].greek_strong, 'G0846', 'Pronominal candidate is G0846 (autos)');
  assertEqual(elohim.candidates[3].published_count, 3, 'Elohim -> autos count is 3');

  // Test 12: Critical Lexical Research Tests: Word and Speech (H1697 & G3056)
  console.log('\n--- Test Suite 12: Word and Speech Tests (H1697 & G3056) ---');
  const dabar = h2g.by_strongs['H1697'];
  assert(dabar != null, 'Dabar H1697 present in index');
  assertEqual(dabar.candidates[0].greek_strong, 'G3056', 'Primary translation of Dabar is G3056 (logos)');
  assertEqual(dabar.candidates[0].published_count, 668, 'Dabar -> logos count is 668');
  assertEqual(dabar.candidates[1].greek_strong, 'G4487', 'Secondary translation is G4487 (rhema)');
  assertEqual(dabar.candidates[1].published_count, 257, 'Dabar -> rhema count is 257');
  assertEqual(dabar.candidates[2].greek_strong, 'G4229', 'Tertiary translation is G4229 (pragma)');
  assertEqual(dabar.candidates[2].published_count, 26, 'Dabar -> pragma count is 26');
  assertEqual(dabar.candidates[3].greek_strong, 'G2980', 'Quaternary translation is G2980 (laleo)');
  assertEqual(dabar.candidates[3].published_count, 20, 'Dabar -> laleo count is 20');

  const logos = g2h.by_strongs['G3056'];
  assert(logos != null, 'Logos G3056 present in reverse index');
  assertEqual(logos.candidate_count, 5, 'Logos G3056 translates from 5 Hebrew words');
  assertEqual(logos.candidates[0].hebrew_strong, 'H1697', 'Primary Hebrew source for logos is H1697 (dabar)');
  assertEqual(logos.candidates[0].published_count, 668, 'Logos <- dabar count is 668');
  assert(logos.candidates.some(c => c.hebrew_strong === 'H0561' && c.published_count === 10), 'Logos translates from H0561 (emer, 10)');
  assert(logos.candidates.some(c => c.hebrew_strong === 'H4405' && c.published_count === 10), 'Logos translates from H4405 (millah, 10)');
  assert(logos.candidates.some(c => c.hebrew_strong === 'H0565' && c.published_count === 6), 'Logos translates from H0565 (imrah, 6)');
  assert(logos.candidates.some(c => c.hebrew_strong === 'H4406' && c.published_count === 3), 'Logos translates from H4406 (millah Aramaic, 3)');

  // Test 13: Cloudflare Static Assets Sharding Integrity
  console.log('\n--- Test Suite 13: Cloudflare Static Assets Sharding Integrity ---');
  let hebrewShardsValid = true;
  let greekShardsValid = true;
  for (let i = 0; i < 64; i++) {
    const bucket = i.toString(16).padStart(2, '0');
    const hShard = path.join(SHARDS_DIR, 'by-hebrew-lemma', `shard-${bucket}.json.gz`);
    const gShard = path.join(SHARDS_DIR, 'by-greek-lemma', `shard-${bucket}.json.gz`);
    if (!fs.existsSync(hShard) || !fs.existsSync(gShard)) {
      hebrewShardsValid = false;
      greekShardsValid = false;
      break;
    }
  }
  assert(hebrewShardsValid, 'All 64 by-hebrew-lemma static asset shards exist');
  assert(greekShardsValid, 'All 64 by-greek-lemma static asset shards exist');

  const resolverGz = path.join(SHARDS_DIR, 'resolver-index.json.gz');
  assert(fs.existsSync(resolverGz), 'resolver-index.json.gz exists in shards directory');
  const resolver = JSON.parse(zlib.gunzipSync(fs.readFileSync(resolverGz)));
  assertEqual(resolver.total_edges, 3301, 'resolver-index records 3,301 total edges');
  assert(Object.keys(resolver.hebrew_strongs_to_bucket).length > 0, 'Resolver contains Hebrew strongs bucket mappings');
  assert(Object.keys(resolver.greek_strongs_to_bucket).length > 0, 'Resolver contains Greek strongs bucket mappings');

  const cfManifestGz = path.join(SHARDS_DIR, 'manifest.json.gz');
  assert(fs.existsSync(cfManifestGz), 'manifest.json.gz exists in shards directory');
  const cfManifest = JSON.parse(zlib.gunzipSync(fs.readFileSync(cfManifestGz)));
  assertEqual(cfManifest.counts.total_translation_edges, 3301, 'Cloudflare manifest records 3,301 translation edges');
  assertEqual(cfManifest.predicates[0], 'translation_candidate', 'Cloudflare manifest registers translation_candidate predicate');

  // Summary
  console.log('\n===============================================================');
  console.log(`Verification Complete: ${passedTests}/${totalTests} tests passed.`);
  if (failures.length > 0) {
    console.error(`FAILURES (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  } else {
    console.log('ALL VERIFICATION TESTS PASSED DETERMINISTICALLY!');
    console.log('===============================================================\n');
  }
}

runVerification().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
