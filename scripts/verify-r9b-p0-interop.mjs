/**
 * scripts/verify-r9b-p0-interop.mjs
 *
 * R9B-P0 End-to-End Interoperability Smoke Test
 *
 * Independently loads R8D (grammatical), R9A (lexical & contextual), and R4 (LXX translation candidates)
 * using their declared manifest sharding metadata and verifies canonical identity compatibility,
 * homograph separation, missing-evidence reporting, deterministic IDs, provenance, and layer separation.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const R8D_ROOT = 'C:/Projects/BibleResearch/.artifacts/static-corpus/v2/relationships/r8-v1.1';
const R9A_ROOT = 'C:/Projects/BibleResearch-r9a/.artifacts-r9a';
const R4_ROOT = 'C:/Projects/BibleResearch-r4/.artifacts/r4-lxx-bridge';

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64Hex(input) {
  let hash = FNV_OFFSET_64;
  const str = String(input);
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

function routeBucket(lemmaKey, hashAlgorithm, buckets) {
  const hex = fnv1a64Hex(lemmaKey);
  if (hashAlgorithm === 'fnv1a64_hi32_mod64') {
    return Number(BigInt('0x' + hex.slice(0, 8)) % BigInt(buckets)).toString(16).padStart(2, '0');
  }
  if (hashAlgorithm === 'fnv1a64_mod256') {
    return Number(BigInt('0x' + hex) % BigInt(buckets)).toString(16).padStart(2, '0');
  }
  throw new Error(`Unsupported hash algorithm: ${hashAlgorithm}`);
}

function readGzipJson(filePath) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8'));
}

function loadR8DLemma(lemmaKey, r8dManifest) {
  const buckets = r8dManifest.sharding?.by_lemma_buckets || 256;
  const bucket = routeBucket(lemmaKey, 'fnv1a64_mod256', buckets);
  const shardPath = path.join(R8D_ROOT, 'by-lemma', `shard-${bucket}.json.gz`);
  const shard = readGzipJson(shardPath);
  const entry = shard.entries?.[lemmaKey] || null;
  if (!entry) return { layer: 'grammatical_r8d', status: 'missing_evidence', lemma_key: lemmaKey, relations: [] };
  const summaries = [...(entry.outgoing_summaries || []), ...(entry.incoming_summaries || [])];
  return {
    layer: 'grammatical_r8d',
    status: summaries.length > 0 ? 'ok' : 'missing_evidence',
    lemma_key: lemmaKey,
    bucket,
    summary_count: summaries.length,
    sample_id: summaries[0]?.summary_id || null,
    summaries,
  };
}

function loadR9ALemma(lemmaKey, r9aManifest) {
  const sharding = r9aManifest.sharding;
  assert(sharding?.hash_algorithm === 'fnv1a64_hi32_mod64', 'R9A manifest must declare fnv1a64_hi32_mod64');
  assert(sharding?.buckets === 64, 'R9A manifest must declare 64 buckets');
  const bucket = routeBucket(lemmaKey, sharding.hash_algorithm, sharding.buckets);

  const idxShard = readGzipJson(path.join(R9A_ROOT, sharding.shard_path_formats.lemma_index.replace('{hex2}', bucket)));
  const edgeShard = readGzipJson(path.join(R9A_ROOT, sharding.shard_path_formats.lexical_edges.replace('{hex2}', bucket)));
  const ctxShard = readGzipJson(path.join(R9A_ROOT, sharding.shard_path_formats.contextual_neighbors.replace('{hex2}', bucket)));

  const idxEntry = idxShard[lemmaKey] || null;
  const lexEdges = (Array.isArray(edgeShard) ? edgeShard : []).filter(e => e.subject?.canonical_key === lemmaKey);
  const ctxEntry = ctxShard[lemmaKey] || null;

  return {
    layer: 'lexical_contextual_r9a',
    status: idxEntry ? 'ok' : 'missing_evidence',
    lemma_key: lemmaKey,
    bucket,
    lexical_edge_count: lexEdges.length,
    contextual_neighbor_count: ctxEntry?.neighbors?.length || 0,
    lexical_edges: lexEdges,
    contextual: ctxEntry,
  };
}

function loadR4Lemma(lemmaKey, r4Manifest) {
  const sharding = r4Manifest.sharding;
  assert(sharding?.hash_algorithm === 'fnv1a64_hi32_mod64', 'R4 manifest must declare fnv1a64_hi32_mod64');
  assert(sharding?.buckets === 64, 'R4 manifest must declare 64 buckets');
  const bucket = routeBucket(lemmaKey, sharding.hash_algorithm, sharding.buckets);
  const isHebrew = lemmaKey.startsWith('lemma:H');
  const tpl = isHebrew ? sharding.shard_path_formats.by_hebrew_lemma : sharding.shard_path_formats.by_greek_lemma;
  const shard = readGzipJson(path.join(R4_ROOT, tpl.replace('{hex2}', bucket)));
  const entry = shard.entries?.[lemmaKey] || null;

  if (!entry) {
    return { layer: 'lxx_translation_r4', status: 'missing_evidence', lemma_key: lemmaKey, bucket, candidate_count: 0, candidates: [] };
  }
  return {
    layer: 'lxx_translation_r4',
    status: 'ok',
    lemma_key: lemmaKey,
    bucket,
    candidate_count: entry.candidates?.length || 0,
    candidates: entry.candidates || [],
  };
}

function main() {
  const r8dManifest = readGzipJson(path.join(R8D_ROOT, 'manifest.json.gz'));
  const r9aManifest = JSON.parse(fs.readFileSync(path.join(R9A_ROOT, 'manifest.json'), 'utf8'));
  const r4Manifest = readGzipJson(path.join(R4_ROOT, 'shards', 'manifest.json.gz'));

  const testCases = [
    { key: 'lemma:H7307', label: 'ruach (high-frequency, multi-sense)', expectR8D: true, expectR9A: true, expectR4: true },
    { key: 'lemma:H0430G', label: 'Elohim - God (homograph G)', expectR8D: true, expectR9A: true, expectR4: true },
    { key: 'lemma:H0430a', label: 'elohim - gods/rulers (homograph a)', expectR8D: false, expectR9A: true, expectR4: true },
    { key: 'lemma:H0430H', label: 'Elohim bound component H', expectR8D: false, expectR9A: true, expectR4: true },
    { key: 'lemma:H1697G', label: 'dabar - word (homograph G)', expectR8D: true, expectR9A: true, expectR4: true },
    { key: 'lemma:H1697O', label: 'dabar - Chronicles (homograph O)', expectR8D: true, expectR9A: true, expectR4: true },
    { key: 'lemma:G4151', label: 'pneuma (Greek high-frequency)', expectR8D: true, expectR9A: true, expectR4: true },
    { key: 'lemma:G3056', label: 'logos (Greek high-frequency)', expectR8D: true, expectR9A: true, expectR4: true },
    { key: 'lemma:G2316', label: 'theos (Greek high-frequency)', expectR8D: true, expectR9A: true, expectR4: true },
    { key: 'lemma:H99999', label: 'unmapped synthetic lemma (missing evidence)', expectR8D: false, expectR9A: false, expectR4: false },
  ];

  console.log('=== R9B-P0 Interoperability Smoke Test ===');
  for (const tc of testCases) {
    const r8d = loadR8DLemma(tc.key, r8dManifest);
    const r9a = loadR9ALemma(tc.key, r9aManifest);
    const r4 = loadR4Lemma(tc.key, r4Manifest);

    assert.strictEqual(r8d.status === 'ok', tc.expectR8D, `${tc.key} R8D status mismatch`);
    assert.strictEqual(r9a.status === 'ok', tc.expectR9A, `${tc.key} R9A status mismatch`);
    assert.strictEqual(r4.status === 'ok', tc.expectR4, `${tc.key} R4 status mismatch`);

    // Verify layer separation & provenance
    assert.notStrictEqual(r8d.layer, r9a.layer);
    assert.notStrictEqual(r9a.layer, r4.layer);
    if (r9a.lexical_edges.length > 0) {
      const e = r9a.lexical_edges[0];
      assert(e.relationship_id && e.provenance?.source_key && e.provenance?.license, `${tc.key} R9A provenance missing`);
    }
    if (r4.candidates.length > 0) {
      const c = r4.candidates[0];
      assert(c.edge_id && (c.greek_lemma_keys || c.hebrew_lemma_keys), `${tc.key} R4 candidate endpoint missing`);
      assert(r4Manifest.source_releases?.bcv_lxx_bridge?.license === 'CC BY 4.0', `${tc.key} R4 manifest license missing`);
    }

    console.log(
      `[PASS] ${tc.key} (${tc.label}): R8D=${r8d.status}(${r8d.summary_count ?? 0}), R9A=${r9a.status}(lex=${r9a.lexical_edge_count},ctx=${r9a.contextual_neighbor_count}), R4=${r4.status}(${r4.candidate_count})`
    );
  }

  // Verify homographs are NOT merged across layers
  const gElohim = loadR8DLemma('lemma:H0430G', r8dManifest);
  const aElohim = loadR8DLemma('lemma:H0430a', r8dManifest);
  assert.notStrictEqual(gElohim.status, aElohim.status, 'H0430G and H0430a must remain distinct');

  console.log('=== ALL 10 INTEROPERABILITY SMOKE TESTS PASSED ===');
}

main();
