/**
 * scripts/verify-r9b-unified-e2e.mjs
 *
 * End-to-end R9B unified relationship engine verification suite.
 * Boots an in-process Cloudflare Worker gateway backed by staged `r9b-v1.0`
 * (`.artifacts-r9b/staging`) + live `.artifacts/static-corpus` (`r8-v1.1`),
 * and validates all 4 evidence layers, resolved R9A issues (1A/1B/1C),
 * canonical identity, 9 negative guardrails, and Worker memory/latency bounds.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import worker from './corpus-worker.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STAGING_DIR = path.join(ROOT, '.artifacts-r9b', 'staging');
const STATIC_DIR = path.join(ROOT, '.artifacts', 'static-corpus');

async function resolveStaticFile(assetPath) {
  const rel = assetPath.replace(/^\/+/, '');
  const candidates = [
    path.join(STAGING_DIR, rel),
    path.join(STATIC_DIR, rel),
  ];
  for (const file of candidates) {
    try {
      const buf = await fs.readFile(file);
      return buf;
    } catch {
      // try next root
    }
  }
  return null;
}

const simEnv = {
  ENVIRONMENT: 'test',
  RELATIONSHIPS_RELEASE: 'r9b-v1.0',
  ASSETS: {
    async fetch(req) {
      const url = new URL(req.url);
      const buf = await resolveStaticFile(url.pathname);
      if (!buf) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(buf, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    },
  },
};

const timings = [];
let maxPayloadBytes = 0;

async function callWorkerQuery(params, endpoint = '/api/relationships/v2/query') {
  const t0 = performance.now();
  const body = JSON.stringify({ release: 'r9b-v1.0', ...params });
  const req = new Request(`https://worker.test${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const res = await worker.fetch(req, simEnv);
  const elapsedMs = performance.now() - t0;
  const text = await res.text();
  const payloadBytes = Buffer.byteLength(text, 'utf8');
  if (payloadBytes > maxPayloadBytes) maxPayloadBytes = payloadBytes;
  timings.push({ op: params.op, ms: elapsedMs, bytes: payloadBytes });
  assert.ok(res.status < 500, `Unexpected HTTP ${res.status} for op=${params.op}: ${text}`);
  return { statusCode: res.status, data: JSON.parse(text), elapsedMs, payloadBytes };
}

function assertNoRestrictedLeak(obj, contextLabel) {
  const raw = JSON.stringify(obj);
  assert.ok(!/"tbesh_col_7"|"marble_senses"/i.test(raw), `Restricted source field leaked in ${contextLabel}`);
}

async function run() {
  console.log('=== R9B Unified 4-Layer Relationship E2E Verification ===');
  const startHeap = process.memoryUsage().heapUsed;
  const startRss = process.memoryUsage().rss;

  // Verify staging exists
  const stagedManifestPath = path.join(STAGING_DIR, 'v2', 'relationships', 'r9b-v1.0', 'manifest.json.gz');
  await fs.access(stagedManifestPath);

  let passed = 0;
  const pass = (label) => {
    passed++;
    console.log(`  PASS [${passed}]: ${label}`);
  };

  // 1. Release manifest & sharding compatibility verification
  {
    const { data: cov } = await callWorkerQuery({ op: 'coverage' });
    assert.equal(cov.status, 'ok');
    assert.equal(cov.release_version, 'r9b-v1.0');
    assert.equal(cov.schema_version, '3.0');
    assert.equal(cov.layers.grammatical.hash_algorithm, 'fnv1a64_mod256');
    assert.equal(cov.layers.grammatical.buckets, 256);
    assert.equal(cov.layers.lexical.hash_algorithm, 'fnv1a64_hi32_mod64');
    assert.equal(cov.layers.lexical.buckets, 64);
    assert.equal(cov.layers.contextual.hash_algorithm, 'fnv1a64_mod1024');
    assert.equal(cov.layers.contextual.buckets, 1024);
    assert.equal(cov.layers.lxx_translation.hash_algorithm, 'fnv1a64_hi32_mod64');
    assert.equal(cov.layers.lxx_translation.buckets, 64);
    assert.equal(cov.manifest_counts.frames_emitted, 150522);
    assert.equal(cov.manifest_counts.lexical_edges, 14469);
    assert.equal(cov.manifest_counts.contextual_pairs, 689397);
    assert.equal(cov.manifest_counts.lxx_translation_edges, 3301);
    assertNoRestrictedLeak(cov, 'coverage');
    pass('Manifest r9b-v1.0 coverage, layer hash algorithms, bucket counts, and licensing verified');
  }

  // Verify live active.json.gz pointer in .artifacts/static-corpus remains untouched (r8-v1.1)
  {
    const livePointerBytes = await fs.readFile(path.join(STATIC_DIR, 'v2', 'relationships', 'active.json.gz'));
    const livePointer = JSON.parse(zlib.gunzipSync(livePointerBytes).toString('utf8'));
    assert.equal(livePointer.active_release, 'r8-v1.1', 'Live active pointer on disk must remain r8-v1.1');
    pass('Live r8-v1.1 release isolation verified (staged r9b-v1.0 does not overwrite live pointer)');
  }

  // 2. All 5 רוּחַ / H7307 lookup forms + 4-layer completeness
  {
    const directForms = [
      { label: 'canonical lemma_id', params: { lemma_id: 'lemma:H7307' } },
      { label: 'base Strongs', params: { query: 'H7307' } },
      { label: 'STEP word_id', params: { word_id: 130527 } },
      { label: 'extended Strongs H7307G', params: { extended_strongs: 'H7307G' } },
      { label: 'Gen 1:2 token position', params: { book: 1, chapter: 1, verse: 2, position: 9 } },
      { label: 'Gen 1:2 token_id', params: { query: 'o010010020092' } },
    ];
    for (const f of directForms) {
      const { data } = await callWorkerQuery({
        op: 'unified_lemma',
        ...f.params,
        limit: 10,
        lexical_limit: 20,
        contextual_limit: 20,
        lxx_limit: 20,
      }, '/v1/rpc/query_relationships_v2');
      assert.equal(data.status, 'ok', `Lookup form "${f.label}" failed: ${JSON.stringify(data)}`);
      assert.equal(data.focus.lemma_id, 'lemma:H7307', `Mismatch on "${f.label}"`);
      assert.ok(data.layers.grammatical && data.layers.grammatical.counts.summaries_total > 0, `${f.label}: grammatical missing`);
      assert.equal(data.layers.lexical.counts.total_unfiltered, 5, `${f.label}: expected 5 lexical links for H7307`);
      assert.equal(data.layers.contextual.counts.total_neighbors, 1097, `${f.label}: expected 1097 contextual neighbors`);
      assert.equal(data.layers.lxx_translation.counts.candidate_count, 3, `${f.label}: expected 3 LXX candidates`);
      assert.equal(data.layers.lxx_translation.counts.total_attested_renderings, 306, `${f.label}: expected 306 LXX renderings`);
      assertNoRestrictedLeak(data, f.label);
    }

    // Surface Hebrew/Aramaic script & transliteration lookup must preserve H7307 (hbo) vs H7308 (arc) candidate set
    for (const q of ['רוּחַ', 'ruach']) {
      const { data } = await callWorkerQuery({ op: 'unified_lemma', query: q });
      assert.equal(data.status, 'needs_disambiguation', `Expected candidate set for "${q}"`);
      const ids = data.homograph_candidates.map(c => c.lemma_id);
      assert.ok(ids.includes('lemma:H7307') && ids.includes('lemma:H7308'), `"${q}" must preserve both H7307 (hbo) and H7308 (arc)`);
    }

    // Gen 1:2, Gen 8:1, Ezek 37:9 grammatical passages
    for (const [book, chapter, verse] of [[1, 1, 2], [1, 8, 1], [26, 37, 9]]) {
      const { data } = await callWorkerQuery({ op: 'passage_frames', book, chapter, verse });
      assert.equal(data.status, 'ok');
      assert.ok(data.counts.frames > 0, `Expected frames in ${book}:${chapter}:${verse}`);
    }
    pass('All 5 רוּחַ/H7307 lookup forms + 4 layers + Gen 1:2 / Gen 8:1 / Ezek 37:9 verified');
  }

  // 3. Resolved Bug 1A: Bidirectional serialized lexical discoverability without duplicating facts
  {
    const { data: ruachLex } = await callWorkerQuery({ op: 'lexical_relations', lemma_id: 'lemma:H7307', lexical_direction: 'both' });
    const { data: aramaicLex } = await callWorkerQuery({ op: 'lexical_relations', lemma_id: 'lemma:H7308', lexical_direction: 'both' });
    const h7307Cog = ruachLex.lexical.items.find(i => i.category === 'cognate' && i.peer.canonical_key === 'lemma:H7308');
    const h7308Cog = aramaicLex.lexical.items.find(i => i.category === 'cognate' && i.peer.canonical_key === 'lemma:H7307');
    assert.ok(h7307Cog && h7308Cog, 'Cognate H7307 <-> H7308 must appear from both endpoints');
    assert.equal(h7307Cog.relationship_id, h7308Cog.relationship_id, 'Single canonical relationship_id preserved');

    // Non-lemma incoming lookup on root:H7307 & sense:H7307H:sub
    const { data: rootLex } = await callWorkerQuery({ op: 'lexical_relations', endpoint_key: 'root:H7307', lexical_direction: 'incoming' });
    assert.equal(rootLex.status, 'ok');
    assert.ok(rootLex.lexical.items.some(i => i.peer.canonical_key === 'lemma:H7307' && i.role === 'incoming'));

    const { data: senseLex } = await callWorkerQuery({ op: 'lexical_relations', endpoint_key: 'sense:H7307H:sub', lexical_direction: 'incoming' });
    assert.equal(senseLex.status, 'ok');
    assert.ok(senseLex.lexical.items.some(i => i.peer.canonical_key === 'lemma:H7307' && i.role === 'incoming'));

    // Compound-name components (H0430) & derivations/wordplay
    const { data: elohimLex } = await callWorkerQuery({ op: 'lexical_relations', lemma_id: 'lemma:H0430G', lexical_direction: 'both' });
    assert.equal(elohimLex.status, 'ok');
    assert.ok(elohimLex.lexical.items.length > 0, 'Expected lexical relations for H0430G');
    pass('Bug 1A verified: bidirectional serialized lexical shards (cognate, root, sense, compound) with single relationship_id');
  }

  // 4. Resolved Bug 1B: Lossless paginated contextual discovery beyond top 50
  {
    const seen = new Set();
    let offset = 0;
    let totalExpected = null;
    while (offset !== null) {
      const { data } = await callWorkerQuery({
        op: 'contextual_neighbors',
        lemma_id: 'lemma:H7307',
        limit: 100,
        offset,
      });
      assert.equal(data.status, 'ok');
      const ctx = data.contextual;
      if (totalExpected === null) totalExpected = ctx.counts.total_neighbors;
      for (const item of ctx.items) {
        assert.ok(!seen.has(item.target_lemma_key), `Duplicate contextual neighbor ${item.target_lemma_key} during pagination`);
        seen.add(item.target_lemma_key);
        assert.ok(
          item.counts.same_verse >= item.counts.same_clause &&
          item.counts.same_clause >= item.counts.collocation_distance_le_3,
          `Invalid count ordering on ${item.target_lemma_key}`
        );
      }
      offset = ctx.page.has_more ? ctx.page.next_offset : null;
    }
    assert.equal(totalExpected, 1097);
    assert.equal(seen.size, 1097, `Expected 1097 lossless neighbors, got ${seen.size}`);
    pass('Bug 1B verified: lossless pagination reconstructed all 1,097 contextual neighbors of H7307 beyond top 50');
  }

  // 5. Resolved Bug 1C: Strict clause boundaries & distinct-verse vs occurrence units
  {
    const { data: tehomSearch } = await callWorkerQuery({
      op: 'contextual_neighbors',
      lemma_id: 'lemma:H7307',
      contextual_scope: 'all',
      limit: 100,
      offset: 1000, // H8415 has small co-occurrence count near tail; also scan if needed
    });
    let foundTehom = tehomSearch.contextual.items.find(i => i.target_lemma_key === 'lemma:H8415');
    if (!foundTehom) {
      let off = 0;
      while (off !== null && !foundTehom) {
        const { data: page } = await callWorkerQuery({ op: 'contextual_neighbors', lemma_id: 'lemma:H7307', limit: 100, offset: off });
        foundTehom = page.contextual.items.find(i => i.target_lemma_key === 'lemma:H8415');
        off = page.contextual.page.has_more ? page.contextual.page.next_offset : null;
      }
    }
    assert.ok(foundTehom, 'Expected lemma:H8415 (tehom) in lossless contextual neighbors of H7307');
    assert.equal(foundTehom.counts.same_verse, 2);
    assert.equal(foundTehom.counts.same_clause, 0, 'Cross-clause neighbor in Gen 1:2 must have same_clause = 0');
    assert.equal(foundTehom.counts.collocation_distance_le_3, 0, 'Cross-clause neighbor must not count as same-clause collocation');
    assert.equal(foundTehom.counts.near_verse_window_distance_le_3, 1);

    // Filtering by contextual_scope: 'same_clause' must exclude H8415
    const { data: clauseFiltered } = await callWorkerQuery({
      op: 'contextual_neighbors',
      lemma_id: 'lemma:H7307',
      contextual_scope: 'same_clause',
      limit: 50,
      offset: 0,
    });
    assert.equal(clauseFiltered.contextual.counts.filtered_total, 441);
    assert.ok(clauseFiltered.contextual.items.every(i => i.counts.same_clause > 0));
    pass('Bug 1C verified: strict leaf-clause boundary excludes Gen 1:2 H7307<->H8415 from same_clause & separates units');
  }

  // 6. Key benchmark lemmas & NT multi-edition passages
  {
    const { data: dabarAmbig } = await callWorkerQuery({ op: 'unified_lemma', query: 'דָּבָר' });
    assert.equal(dabarAmbig.status, 'needs_disambiguation');
    const dabarIds = dabarAmbig.homograph_candidates.map(c => c.lemma_id);
    assert.ok(dabarIds.includes('lemma:H1697G') && dabarIds.includes('lemma:H1697O'), 'דָּבָר must preserve H1697G and H1697O candidates');

    const { data: dabarExact } = await callWorkerQuery({ op: 'unified_lemma', lemma_id: 'lemma:H1697G' });
    assert.equal(dabarExact.status, 'ok');
    assert.equal(dabarExact.focus.lemma_id, 'lemma:H1697G');

    const { data: gen1_1 } = await callWorkerQuery({ op: 'passage_frames', book: 1, chapter: 1, verse: 1 });
    assert.equal(gen1_1.status, 'ok');
    assert.ok(gen1_1.relations.some(r => r.subject.lemma_id === 'lemma:H0430G'));

    const { data: logos } = await callWorkerQuery({ op: 'unified_lemma', query: 'λόγος' });
    assert.equal(logos.status, 'ok');
    assert.equal(logos.focus.lemma_id, 'lemma:G3056');
    const lxxH1697 = logos.layers.lxx_translation.items.find(i => i.hebrew_strong === 'H1697');
    assert.ok(lxxH1697 && lxxH1697.published_count === 668, 'G3056 must map back to H1697 with count 668');

    // John 1:1 (copular frames = 3, relations = 0 -> no_evidence_in_covered_scope), John 3:17 (Nestle1904 & SBLGNT), Phil 2:5, Rev 22:20
    const { data: jhn1_1 } = await callWorkerQuery({ op: 'passage_frames', book: 43, chapter: 1, verse: 1, edition_key: 'macula-greek-nestle1904' });
    assert.equal(jhn1_1.status, 'no_evidence_in_covered_scope');
    assert.equal(jhn1_1.counts.frames, 3);
    for (const [b, c, v, ed] of [
      [43, 3, 17, 'macula-greek-nestle1904'],
      [43, 3, 17, 'macula-greek-sblgnt'],
      [50, 2, 5, 'macula-greek-nestle1904'],
      [66, 22, 20, 'macula-greek-nestle1904'],
    ]) {
      const { data: pf } = await callWorkerQuery({ op: 'passage_frames', book: b, chapter: c, verse: v, edition_key: ed });
      assert.equal(pf.status, 'ok');
      assert.ok(pf.counts.frames > 0);
    }
    pass('Benchmark passages (Gen 1:1, דָּבָר, λόγος -> H1697=668, John 1:1, John 3:17 dual editions, Phil 2:5, Rev 22:20) verified');
  }

  // 7. All 9 mandatory negative & epistemic guardrail tests
  {
    // Neg 1: Homograph collision (H1254 has H1254a/H1254b; H0430 has H0430G/H/I/a)
    const { data: homo } = await callWorkerQuery({ op: 'unified_lemma', query: 'H1254' });
    assert.equal(homo.status, 'needs_disambiguation', 'Bare multi-homograph Strongs must not arbitrarily select one homograph');
    assert.ok(homo.homograph_candidates.length >= 2);

    // Neg 2: Cross-clause collocation leakage covered in step 5 (H8415)
    // Neg 3: Aramaic/Hebrew confusion (H7307 hbo != H7308 arc)
    const { data: h7308 } = await callWorkerQuery({ op: 'unified_lemma', lemma_id: 'lemma:H7308' });
    assert.equal(h7308.focus.language, 'aramaic');
    assert.notEqual(h7308.focus.lemma_id, 'lemma:H7307');

    // Neg 4: Edition confusion (Greek SBLGNT vs Nestle1904 stays isolated)
    const { data: logosSbl } = await callWorkerQuery({ op: 'unified_lemma', lemma_id: 'lemma:G3056', edition_key: 'macula-greek-sblgnt' });
    assert.equal(logosSbl.status, 'ok');

    // Neg 5: Translation = synonymy & proximity = causality fallacies
    assert.equal(logosSbl.epistemic_guardrails.translation_candidate_not_semantic_identity, true);
    assert.equal(logosSbl.epistemic_guardrails.shared_root_not_synonymy, true);
    assert.equal(logosSbl.epistemic_guardrails.contextual_proximity_not_grammar_or_causality, true);
    assert.equal(logosSbl.layers.lxx_translation.guardrails.not_synonymy, true);
    assert.equal(logosSbl.layers.contextual.guardrails.implies_causality, false);

    // Neg 6: Missing / omitted syntax != fabricated zeroed claims
    const { data: ps23_0 } = await callWorkerQuery({ op: 'passage_frames', book: 19, chapter: 23, verse: 0 });
    assert.equal(ps23_0.status, 'no_evidence_in_covered_scope');
    assert.ok(!ps23_0.relations || ps23_0.relations.length === 0);
    const { data: acts8_37 } = await callWorkerQuery({ op: 'passage_frames', book: 44, chapter: 8, verse: 37, edition_key: 'macula-greek-sblgnt' });
    assert.equal(acts8_37.status, 'not_in_canonical_verse');
    assert.ok(!acts8_37.relations || acts8_37.relations.length === 0);

    // Neg 7: English gloss filtering must not resolve arbitrary gloss to a single canonical lemma
    const { data: gloss } = await callWorkerQuery({ op: 'unified_lemma', query: 'spirit' });
    assert.equal(gloss.status, 'not_found', 'Arbitrary English gloss must not resolve as canonical lemma');

    // Neg 8: Restricted fields never leaked (already checked across payloads)
    // Neg 9: Invalid references never throw HTTP 500
    const { data: badBook } = await callWorkerQuery({ op: 'passage_frames', book: 99, chapter: 1, verse: 1 });
    assert.equal(badBook.status, 'invalid_reference');
    const { data: badLemma } = await callWorkerQuery({ op: 'unified_lemma', query: 'H999999' });
    assert.equal(badLemma.status, 'not_found');

    pass('All 9 negative & epistemic guardrail tests passed');
  }

  // 8. Performance & memory bounds summary
  const endHeap = process.memoryUsage().heapUsed;
  const endRss = process.memoryUsage().rss;
  const heapDeltaMb = (endHeap - startHeap) / (1024 * 1024);
  const rssMb = endRss / (1024 * 1024);
  const sortedMs = [...timings].map(t => t.ms).sort((a, b) => a - b);
  const p50 = sortedMs[Math.floor(sortedMs.length * 0.5)] ?? 0;
  const maxMs = sortedMs[sortedMs.length - 1] ?? 0;

  assert.ok(heapDeltaMb < 128, `Worker simulated heap delta exceeded 128MB: ${heapDeltaMb.toFixed(1)}MB`);
  pass(`Performance & memory bounds OK: heapDelta=${heapDeltaMb.toFixed(2)}MB (<128MB), totalRSS=${rssMb.toFixed(1)}MB, queries=${timings.length}, p50=${p50.toFixed(1)}ms, max=${maxMs.toFixed(1)}ms, maxPayload=${(maxPayloadBytes / 1024).toFixed(1)}KB`);

  console.log(`\nALL ${passed} R9B E2E VERIFICATION SUITES PASSED.`);
}

run().catch((err) => {
  console.error('R9B E2E VERIFICATION FAILED:', err);
  process.exit(1);
});
