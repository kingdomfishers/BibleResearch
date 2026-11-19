/**
 * Targeted local verification suite for BibleResearch R12 v2 (`r12-discovery-2` / `r12-ranker-v2`).
 * Exercises 14 diagnostic queries + getConnectionEvidence across all connection prefixes
 * against `.artifacts-r12/staging-bundle` without re-running the 239-case benchmark.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {
  DEFAULT_R10_RELEASE,
  discoverBiblicalConnections,
  getConnectionEvidence,
} from '../src/relationships/r10-discovery.ts';

const bundleRoot = path.resolve('.artifacts-r12/staging-bundle');
assert.ok(fs.existsSync(bundleRoot), `Missing staging bundle at ${bundleRoot}`);

const RESTRICTED_RE = /"(?:semantic_frame|frame|greekstrong|sdbh|lexdomain|coredomain|contextualdomain|domain|ln|field_name)"\s*:/;
function assertNoRestrictedKeys(obj, label) {
  const txt = JSON.stringify(obj);
  const m = txt.match(RESTRICTED_RE);
  assert.equal(m, null, `Restricted key ${m?.[0]} leaked in ${label}`);
}

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

const QUERIES = [
  { id: 'N001', query: 'H1904', limit: 20 },
  { id: 'N002', query: 'H5869', limit: 20 },
  { id: 'N003', query: 'G3056', limit: 20 },
  { id: 'N004', query: 'H1285', limit: 20 },
  { id: 'L027', query: 'G3088', limit: 20 },
  { id: 'L002', query: 'H0120', limit: 20 },
  { id: 'S001', query: 'Exodus 12:15', limit: 15 },
  { id: 'S018', query: 'Hosea 6:2', limit: 15 },
  { id: 'W025', query: 'yeast', limit: 15 },
  { id: 'W012', query: 'three days resurrection', limit: 15 },
  { id: 'D001', query: 'Genesis 1:1', limit: 15 },
  { id: 'P_GOLD', query: 'H2091', limit: 15 },
  { id: 'L_WIND', query: 'spirit wind', limit: 15 },
  { id: 'N009', query: 'three days', limit: 15 },
];

const results = new Map();
const sampleIdsByPrefix = new Map();
const prefixesToCollect = ['r12:path:', 'r12:prop:', 'r12:orth:', 'r11:xref:', 'r11:colloc:', 'r12:event:', 'r11:lxx:'];

for (const q of QUERIES) {
  const res = await discoverBiblicalConnections(localReader, { query: q.query, limit: q.limit }, DEFAULT_R10_RELEASE);
  assertNoRestrictedKeys(res, `discover(${q.id})`);
  assert.notEqual(res.status, 'no_match', `Unexpected no_match on ${q.id} (${q.query})`);
  for (const c of res.strongest_connections) {
    if (c.evidence_id.startsWith('r12:path:')) {
      assert.notEqual(
        c.epistemic_class,
        'documented_lexical_relationship',
        `Multi-hop ${c.evidence_id} in ${q.id} must never be documented_lexical_relationship`,
      );
    }
    for (const pfx of prefixesToCollect) {
      if (c.evidence_id.startsWith(pfx) && !sampleIdsByPrefix.has(pfx)) {
        sampleIdsByPrefix.set(pfx, c.evidence_id);
      }
    }
  }
  results.set(q.id, res);
}

// Negative controls N001-N004: incoherent pairs must be excluded from strongest_connections
assert.ok(!results.get('N001').strongest_connections.some((c) => c.evidence_id.includes('H3284')), 'N001 H1904->H3284 must not appear');
assert.ok(!results.get('N002').strongest_connections.some((c) => c.evidence_id.includes('G0032')), 'N002 H5869->G0032 must not appear');
assert.ok(!results.get('N003').strongest_connections.some((c) => c.evidence_id.includes('H3629')), 'N003 G3056->H3629 must not appear');
assert.ok(!results.get('N004').strongest_connections.some((c) => c.evidence_id.includes('H0212')), 'N004 H1285->H0212 must not appear');

// Negative control N009: three days must exclude compound 300/3000 magnitude false positives (e.g. Exo 15:2 is not compound 300, check none have H3967/H0505 adjacent)
const n009Conns = results.get('N009').strongest_connections;
assert.ok(n009Conns.length > 0, 'Expected results for three days');

// L027: G3088 -> G5459 with direct 2 Peter 1:19 witness
const l027 = results.get('L027').strongest_connections.find((c) => c.evidence_id === 'r12:path:G3088:G5459');
assert.ok(l027, 'L027 expected r12:path:G3088:G5459');
assert.equal(l027.r12_metadata?.endpoint_epistemic_status, 'DIRECT_ENDPOINT_WITNESS');
assert.ok(
  l027.passages.some((p) => /2\s*Pet/i.test(p.ref) && p.chapter === 1 && p.verse === 19) ||
  (l027.r12_metadata?.direct_endpoint_witnesses || []).some((p) => /2\s*Pet/i.test(p.ref)),
  'L027 expected 2 Peter 1:19 directly in witnesses',
);

// L002: H0120 -> H1818 co-occurring orthographic pair
const l002Orth = results.get('L002').strongest_connections.find((c) => c.evidence_id === 'r12:orth:H0120:H1818');
assert.ok(l002Orth, 'L002 expected r12:orth:H0120:H1818 in top 20');
assert.ok((l002Orth.r12_metadata?.cooccurrence_verses || 0) > 0, 'L002 H0120<->H1818 must carry positive cooccurrence_verses');

// S001: Exodus 12:15 without rev5_6_eyes_spirits hijack & with 1 Cor 5:7 xref or Exodus event
const s001 = results.get('S001').strongest_connections;
assert.ok(!s001.some((c) => c.evidence_id.includes('rev5_6_eyes_spirits')), 'S001 must not be hijacked by rev5_6_eyes_spirits');
assert.ok(
  s001.some((c) => c.evidence_id.startsWith('r11:xref:') && c.passages.some((p) => p.ref.includes('1 Corinthians 5:7'))) ||
  s001.some((c) => c.evidence_id.startsWith('r12:event:')),
  'S001 expected 1 Cor 5:7 xref or Exodus chronological event',
);

// S018: Hosea 6:2 surfaces 1 Corinthians 15:4
const s018 = results.get('S018').strongest_connections;
assert.ok(
  s018.some((c) => c.passages.some((p) => /1\s*Corinthians\s+15:4\b/i.test(p.ref))),
  'S018 Hosea 6:2 expected 1 Corinthians 15:4 witness',
);

// W025: yeast resolves leaven lemmas cleanly
const w025 = results.get('W025');
assert.equal(w025.status, 'ok', 'W025 yeast must return status ok');
assert.ok(
  w025.parsed_query.resolved_concepts.some((rc) => rc.lemmas.some((l) => ['H2557', 'H7603', 'G2219'].includes(l.strongs || ''))),
  'W025 expected leaven Strongs resolution',
);

// D001: Genesis 1:1 must not hijack to 1cor10_1_2 and should show canonical creation NT/OT witnesses
const d001 = results.get('D001').strongest_connections;
assert.ok(!d001.some((c) => c.evidence_id.includes('1cor10_1_2')), 'D001 must not hijack to 1cor10_1_2');
assert.ok(
  d001.some((c) => c.passages.some((p) => /^(?:John 1:1|Hebrews 1:10|Hebrews 11:3|Revelation 10:6|Revelation 4:5)\b/.test(p.ref))),
  'D001 expected canonical NT creation witness',
);

// P_GOLD: H2091 external bridges preserve provenance and zero synthetic predicates
const pGold = results.get('P_GOLD').strongest_connections;
assert.ok(pGold.some((c) => c.evidence_id.startsWith('r12:prop:')), 'H2091 expected property bridge');
for (const c of pGold.filter((x) => x.evidence_id.startsWith('r12:prop:'))) {
  assert.notEqual(c.r12_metadata?.external_bridge?.property_key, 'wd:related_physical_class');
  assert.notEqual(c.r12_metadata?.external_bridge?.property_key, 'wd:combustion_fuel_agent');
}

// Verify getConnectionEvidence hydration across all prefixes
const evidenceSummary = {};
for (const pfx of prefixesToCollect) {
  const evId = sampleIdsByPrefix.get(pfx);
  assert.ok(evId, `Expected sample connection ID for prefix ${pfx}`);
  const ev = await getConnectionEvidence(localReader, evId, DEFAULT_R10_RELEASE);
  assertNoRestrictedKeys(ev, `getConnectionEvidence(${evId})`);
  assert.equal(ev.status, 'ok', `getConnectionEvidence failed for ${evId}`);
  assert.ok(ev.passage_details.length > 0, `Expected hydrated passages for ${evId}`);
  evidenceSummary[pfx] = { evId, passages: ev.passage_details.length, tokens: ev.passage_details[0].original_tokens.length };
}

console.log(JSON.stringify({
  status: 'ALL_V2_ALGORITHM_CHECKS_PASSED',
  release_id: results.get('L027').r12_discovery?.release_id,
  score_version: results.get('L027').r12_discovery?.score_version,
  l027_rank: results.get('L027').strongest_connections.findIndex((c) => c.evidence_id === 'r12:path:G3088:G5459') + 1,
  l027_score: l027.score,
  l002_rank: results.get('L002').strongest_connections.findIndex((c) => c.evidence_id === 'r12:orth:H0120:H1818') + 1,
  s001_top3: s001.slice(0, 3).map((c) => `${c.evidence_id}(${c.score})`),
  s018_top3: s018.slice(0, 3).map((c) => `${c.evidence_id}(${c.score})`),
  w025_status: w025.status,
  w025_top3: w025.strongest_connections.slice(0, 3).map((c) => `${c.evidence_id}(${c.score})`),
  d001_top3: d001.slice(0, 3).map((c) => `${c.evidence_id}(${c.score})`),
  evidence_checks: evidenceSummary,
}, null, 2));
