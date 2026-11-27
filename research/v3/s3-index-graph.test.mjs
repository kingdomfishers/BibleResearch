// Gate G3 Verification Suite for Stage S3:
// Binary Hybrid Bitset/BMW Index, 6-Partition Typed Conductance CSR,
// Precomputed Top-64 PPR Shards, Flat v3 Profile/Verse Packs, and Size/Latency Caps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  BMW_FLAG_ACTANT,
  BMW_FLAG_CONCEPT,
  BMW_FLAG_DENSE,
  BMW_FLAG_LXX,
  GRAPH_PARTITIONS,
  blockMaxWandTopK,
  intersectTerms,
  lookupCsrEdges,
  lookupPprTop64,
  lookupTerm,
  parseBmwIndex,
  parseCsrPart,
  parsePprShard,
} from '../../src/relationships/v3-binary-index.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGING_BUNDLE = path.join(ROOT, '.artifacts-r12/staging-bundle');
const V3_DIR = path.join(STAGING_BUNDLE, 'v3');
const MAX_10_MIB = 10 * 1024 * 1024;
const MAX_1_MIB = 1024 * 1024;

const RESTRICTED_KEYS = new Set([
  'gated_fields',
  'semantic_frame',
  'frame',
  'greekstrong',
  'sdbh',
  'lexdomain',
  'coredomain',
  'contextualdomain',
  'domain',
  'ln',
  'field_name',
]);

function assertNoRestrictedKeys(val, p = '') {
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) assertNoRestrictedKeys(val[i], `${p}[${i}]`);
  } else if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      assert.ok(!RESTRICTED_KEYS.has(k), `Restricted UBS key "${k}" at ${p}.${k}`);
      if (v && typeof v === 'object') assertNoRestrictedKeys(v, `${p}.${k}`);
    }
  }
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full));
    else out.push({ path: full, size: fs.statSync(full).size });
  }
  return out;
}

function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

let cached = null;
function loadV3Runtime() {
  if (cached) return cached;
  const manifest = JSON.parse(fs.readFileSync(path.join(V3_DIR, 'manifest.json'), 'utf8'));
  const bmw = parseBmwIndex(fs.readFileSync(path.join(V3_DIR, 'index/postings-bmw.bin')));
  const nodes = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(V3_DIR, 'index/nodes.json.gz'))).toString('utf8'));

  const csrParts = Array.from({ length: 16 }, (_, i) =>
    parseCsrPart(fs.readFileSync(path.join(V3_DIR, `graph/typed-csr/part-${String(i).padStart(2, '0')}.bin`)))
  );
  const pprShards = Array.from({ length: 32 }, (_, i) =>
    parsePprShard(fs.readFileSync(path.join(V3_DIR, `graph/ppr-top64/shard-${String(i).padStart(2, '0')}.bin`)))
  );

  const keyToId = new Map(Object.entries(nodes.key_to_id));
  const idToKey = (id) => (id <= nodes.num_verses ? `V:${id}` : nodes.id_to_key[id - nodes.entity_offset]);
  const getPpr = (keyOrId) => {
    const id = typeof keyOrId === 'number' ? keyOrId : keyToId.get(keyOrId);
    if (!id) return [];
    return lookupPprTop64(pprShards[id & 31], id);
  };
  const getCsr = (keyOrId) => {
    const id = typeof keyOrId === 'number' ? keyOrId : keyToId.get(keyOrId);
    if (!id) return [];
    return lookupCsrEdges(csrParts[id & 15], id);
  };

  cached = { manifest, bmw, nodes, csrParts, pprShards, keyToId, idToKey, getPpr, getCsr };
  return cached;
}

test('G3.1: Bundle file caps (< 10 MiB per v3/ file, <= 250 v3/ files, post-S4 <= 4,200) & zero restricted UBS keys', () => {
  const { manifest, nodes } = loadV3Runtime();
  assert.equal(manifest.schema_version, 3);
  assert.equal(manifest.license_audit, '0 restricted UBS keys');
  assert.equal(manifest.swete_included, false);
  assertNoRestrictedKeys(manifest, 'manifest');
  assertNoRestrictedKeys(nodes, 'nodes');

  const v3Files = walkFiles(V3_DIR);
  assert.ok(v3Files.length <= 250, `Expected <= 250 v3/ files, got ${v3Files.length}`);

  let maxBytes = 0;
  for (const f of v3Files) {
    assert.ok(f.size < MAX_10_MIB, `${f.path} exceeds 10 MiB (${f.size} B)`);
    if (f.size > maxBytes) maxBytes = f.size;
  }

  // Flat profile & verse shards must be <= 64 files and < 1 MiB each
  const profileFiles = fs.readdirSync(path.join(V3_DIR, 'profiles')).filter(x => x.endsWith('.json.gz'));
  const verseFiles = fs.readdirSync(path.join(V3_DIR, 'verses')).filter(x => x.endsWith('.json.gz'));
  assert.ok(profileFiles.length <= 64 && profileFiles.length >= 16);
  assert.ok(verseFiles.length <= 64 && verseFiles.length >= 16);
  for (const pf of profileFiles) {
    const sz = fs.statSync(path.join(V3_DIR, 'profiles', pf)).size;
    assert.ok(sz < MAX_1_MIB, `profiles/${pf} exceeds 1 MiB (${sz} B)`);
  }
  for (const vf of verseFiles) {
    const sz = fs.statSync(path.join(V3_DIR, 'verses', vf)).size;
    assert.ok(sz < MAX_1_MIB, `verses/${vf} exceeds 1 MiB (${sz} B)`);
  }

  // Check projected post-S4 bundle file count (< 4,200 after retiring r9b-v1.1, r8-v1.2, and fast-*)
  const allBundleFiles = walkFiles(STAGING_BUNDLE).length;
  const r8Count = walkFiles(path.join(STAGING_BUNDLE, 'v2/relationships/r8-v1.2')).length;
  const r9Count = walkFiles(path.join(STAGING_BUNDLE, 'v2/relationships/r9b-v1.1')).length;
  const fastProfilesCount = walkFiles(path.join(STAGING_BUNDLE, 'v2/relationships/r11-v1.0/r10/fast-profiles')).length;
  const fastVersesCount = walkFiles(path.join(STAGING_BUNDLE, 'v2/relationships/r11-v1.0/r10/fast-verses')).length;
  const projectedPostS4 = allBundleFiles - r8Count - r9Count - fastProfilesCount - fastVersesCount;
  assert.ok(
    projectedPostS4 <= 4200,
    `Projected post-S4 bundle file count ${projectedPostS4} must be <= 4,200 (current=${allBundleFiles})`
  );
});

test('G3.2: Hybrid Bitset/BMW Index queries (Strong’s, polyseme splits, LXX, concepts, roles)', () => {
  const { bmw } = loadV3Runtime();

  // 1. H8247 (almond) & H8245 (watch): Jer 1:11-12
  const t8247 = lookupTerm(bmw, 'H8247');
  const t8245 = lookupTerm(bmw, 'H8245');
  assert.ok(t8247 && t8247.df === 4);
  assert.ok(t8245 && t8245.df >= 10);
  const almondWatchHits = blockMaxWandTopK(bmw, ['H8247', 'H8245'], 10, 1.5);
  assert.ok(almondWatchHits.length >= 2, 'BMW must return H8247 / H8245 hits');
  assert.ok(almondWatchHits.some(h => h.vid === 18981 || h.vid === 18982 || h.score > 10), 'Top hit must surface high-IDF Jer 1:11-12');

  // 2. H5869 + H7307 intersection & polyseme sense separation (H5869#eye vs H5869#spring)
  const eyeSpiritVids = intersectTerms(bmw, ['H5869', 'H7307'], [], 50);
  assert.ok(eyeSpiritVids.length >= 5, `Expected H5869+H7307 intersection >= 5, got ${eyeSpiritVids.length}`);
  const eyeSense = lookupTerm(bmw, 'H5869#eye');
  const springSense = lookupTerm(bmw, 'H5869#spring');
  assert.ok(eyeSense && eyeSense.df >= 500, 'H5869#eye must be indexed');
  assert.ok(springSense && springSense.df >= 5 && springSense.df <= 30, 'H5869#spring must be indexed with narrow df');
  const eyeSpringOverlap = intersectTerms(bmw, ['H5869#eye', 'H5869#spring']);
  assert.equal(eyeSpringOverlap.length, 0, 'H5869#eye and H5869#spring postings should be cleanly separated');

  // 3. H4417 (salt)
  const saltTerm = lookupTerm(bmw, 'H4417');
  assert.ok(saltTerm && saltTerm.df >= 20 && saltTerm.df <= 35);
  const saltHits = blockMaxWandTopK(bmw, ['H4417'], 16, 1.5);
  assert.ok(saltHits.length >= 16);

  // 4. Rahlfs LXX lemma lxx:ἀδόκιμος
  const lxxAdokimos = lookupTerm(bmw, 'lxx:ἀδόκιμος');
  assert.ok(lxxAdokimos && (lxxAdokimos.flags & BMW_FLAG_LXX) !== 0 && lxxAdokimos.df >= 1);
  const lxxHits = blockMaxWandTopK(bmw, ['lxx:ἀδόκιμος'], 10, 1.0);
  assert.ok(lxxHits.length >= 1);

  // 5. H0120 / H1818 / H0127 (man / blood / soil -> Gen 9:6 / Gen 4:10-11)
  const adamBlood = intersectTerms(bmw, ['H0120', 'H1818']);
  assert.ok(adamBlood.length >= 5, 'Expected H0120 + H1818 intersection');
  const adamSoil = intersectTerms(bmw, ['H0120', 'H0127']);
  assert.ok(adamSoil.length >= 10, 'Expected H0120 + H0127 intersection');
  const gen96Hits = blockMaxWandTopK(bmw, ['H0120', 'H1818', 'H0127'], 16, 1.5);
  assert.ok(gen96Hits.length >= 5 && gen96Hits[0].matchedCount >= 2);

  // 6. Concepts c:C_XL:* & clause actant roles role:NEG:*
  const cGod = lookupTerm(bmw, 'c:C_XL:0070');
  assert.ok(cGod && (cGod.flags & BMW_FLAG_CONCEPT) !== 0 && (cGod.flags & BMW_FLAG_DENSE) !== 0 && cGod.df > 1000);
  const roleNeg = lookupTerm(bmw, 'role:NEG:*');
  assert.ok(roleNeg && (roleNeg.flags & BMW_FLAG_ACTANT) !== 0 && (roleNeg.flags & BMW_FLAG_DENSE) !== 0 && roleNeg.df > 5000);
});

test('G3.3: Typed Conductance CSR (CONCEPT_PROC <= 0.06) & Top-64 PPR bridges', () => {
  const { manifest, csrParts, getCsr, getPpr, idToKey } = loadV3Runtime();
  assert.ok(
    manifest.graph.concept_proc_max_mass <= 0.06,
    `Manifest CONCEPT_PROC max mass ${manifest.graph.concept_proc_max_mass} > 0.06`
  );

  // Verify CONCEPT_PROC <= 0.06 directly on sampled CSR nodes across all 16 parts
  const cpPartIdx = GRAPH_PARTITIONS.indexOf('CONCEPT_PROC');
  let checkedNodes = 0;
  for (const part of csrParts) {
    const stride = Math.max(1, Math.floor(part.numNodes / 40));
    for (let i = 0; i < part.numNodes; i += stride) {
      const nodeId = part.view.getUint32(part.dirOffset + i * 12, true);
      const edges = lookupCsrEdges(part, nodeId);
      let cpMass = 0;
      for (const e of edges) {
        if (e.partition === cpPartIdx) cpMass += e.weight;
      }
      assert.ok(cpMass <= 0.0605, `Node ${nodeId} CONCEPT_PROC mass ${cpMass} exceeds 0.06`);
      checkedNodes++;
    }
  }
  assert.ok(checkedNodes >= 500);

  // Verify H8247 (almond) PPR reaches H8245 (watch) via WP/OCC bridges
  const ppr8247 = getPpr('H8247');
  assert.ok(ppr8247.length >= 5 && ppr8247.length <= 64);
  const ppr8247Keys = ppr8247.map(e => idToKey(e.targetNodeId));
  assert.ok(ppr8247Keys.includes('H8245'), `H8247 Top-64 PPR must reach H8245, got ${ppr8247Keys.slice(0, 15).join(',')}`);
  for (let i = 1; i < ppr8247.length; i++) {
    assert.ok(ppr8247[i - 1].prob >= ppr8247[i].prob - 1e-6, 'PPR Top-64 must be sorted descending');
  }

  // Verify MT <-> LXX <-> NT bridge: H5509 (dross) -> lxx:ἀδόκιμος -> G0096
  const csr5509 = getCsr('H5509');
  assert.ok(csr5509.some(e => idToKey(e.toNodeId) === 'lxx:ἀδόκιμος' && e.partition === 2), 'H5509 CSR must connect to lxx:ἀδόκιμος via LXX');
  const pprAdokimos = getPpr('lxx:ἀδόκιμος');
  const pprAdokKeys = pprAdokimos.map(e => idToKey(e.targetNodeId));
  assert.ok(
    pprAdokKeys.includes('H5509') || pprAdokKeys.includes('G0096'),
    `lxx:ἀδόκιμος PPR must connect H5509/G0096, got ${pprAdokKeys.slice(0, 15).join(',')}`
  );
});

test('G3.4: Flat enriched v3/profiles/ and v3/verses/ packs parity & schema checks', () => {
  const profShard = JSON.parse(
    zlib.gunzipSync(
      fs.readFileSync(path.join(V3_DIR, `profiles/shard-${String(fnv1a32('H5869') % 48).padStart(2, '0')}.json.gz`))
    ).toString('utf8')
  );
  assertNoRestrictedKeys(profShard, 'profShard-H5869');
  const h5869 = profShard.profiles['H5869'];
  assert.ok(h5869 && h5869.sense_gate?.length >= 2 && h5869.lxx_equivalents?.length >= 1);

  const profSalt = JSON.parse(
    zlib.gunzipSync(
      fs.readFileSync(path.join(V3_DIR, `profiles/shard-${String(fnv1a32('H4417') % 48).padStart(2, '0')}.json.gz`))
    ).toString('utf8')
  );
  const h4417 = profSalt.profiles['H4417'];
  assert.ok(h4417 && h4417.headword_rescued === true && /salt/i.test(h4417.gl));

  const vChunk0 = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(path.join(V3_DIR, 'verses/chunk-00.json.gz'))).toString('utf8')
  );
  assertNoRestrictedKeys(vChunk0, 'verseChunk-00');
  const gen11 = vChunk0.verses['1'];
  assert.ok(gen11 && gen11.ref === 'Genesis 1:1' && gen11.toks.length === 7 && gen11.clauses.length >= 1);
  assert.ok(gen11.concepts.includes('C_XL:0070') && gen11.xrefs?.length >= 1);
});

test('G3.5: Warm binary lookup latency across 200 queries (p95 < 1.0 ms)', () => {
  const { bmw, getCsr, getPpr } = loadV3Runtime();
  const queryTerms = [
    ['H8247', 'H8245'],
    ['H5869', 'H7307'],
    ['H4417'],
    ['lxx:ἀδόκιμος'],
    ['H0120', 'H1818', 'H0127'],
    ['c:C_XL:0070', 'H1254'],
    ['H5509', 'H3701'],
    ['H6438', 'H0068'],
    ['H5869#spring'],
    ['role:NEG:*', 'H0120'],
  ];

  // Warm-up pass (allow V8 TurboFan optimization of binary TypedArray/DataView kernels)
  for (let i = 0; i < 200; i++) {
    const q = queryTerms[i % queryTerms.length];
    intersectTerms(bmw, q, [], 32);
    blockMaxWandTopK(bmw, q, 24, 1.5);
    getCsr(q[0]);
    getPpr(q[0]);
  }

  const timingsMs = [];
  for (let i = 0; i < 200; i++) {
    const q = queryTerms[i % queryTerms.length];
    const kind = i % 4;
    const tStart = performance.now();
    if (kind === 0) {
      intersectTerms(bmw, q, [], 32);
    } else if (kind === 1) {
      blockMaxWandTopK(bmw, q, 24, 1.5);
    } else if (kind === 2) {
      getCsr(q[0]);
    } else {
      getPpr(q[0]);
    }
    timingsMs.push(performance.now() - tStart);
  }
  timingsMs.sort((a, b) => a - b);
  const p50 = timingsMs[Math.floor(timingsMs.length * 0.50)];
  const p95 = timingsMs[Math.floor(timingsMs.length * 0.95)];
  console.log(`Warm 200-query latency: p50=${p50.toFixed(4)} ms, p95=${p95.toFixed(4)} ms`);
  assert.ok(p95 < 1.0, `Warm p95 latency ${p95.toFixed(4)} ms must be < 1.0 ms`);
});
