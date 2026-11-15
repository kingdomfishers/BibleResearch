// @file: scripts/verify-r9c-multihop.mjs
// Deterministic offline test suite for R9C multi-hop discovery (controlled fixtures + real R9B/R8D shards).

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  computeBucketHex,
  createInMemoryAssetReader,
  createNodeFsAssetReader,
  ShardedAdjacencyLoader,
} from '../src/relationships/adjacency-loader.ts';
import { resolveResearchConcept } from '../src/relationships/concept-resolver.ts';
import { discoverMultiHopPaths } from '../src/relationships/multihop-search.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'r9c-multihop-fixtures.json');
const R9B_STAGING = 'C:\\Projects\\BibleResearch-r9b\\.artifacts-r9b\\staging';
const R8D_CORPUS = 'C:\\Projects\\BibleResearch\\.artifacts\\static-corpus';

async function buildShardedFixtureFiles(spec) {
  const releaseVersion = 'r9c-fixture-v1.0';
  const base = `/v2/relationships/${releaseVersion}`;
  const files = {};
  files[`${base}/manifest.json.gz`] = {
    schema_version: '3.0',
    release_version: releaseVersion,
    layers: {
      grammatical: { release_version: releaseVersion, hash_algorithm: 'fnv1a64_mod256', buckets: 256, base_dir: base },
      lexical: { release_version: releaseVersion, hash_algorithm: 'fnv1a64_hi32_mod64', buckets: 64, base_dir: `${base}/lexical` },
      contextual: { release_version: releaseVersion, hash_algorithm: 'fnv1a64_hi32_mod64', buckets: 64, base_dir: `${base}/contextual` },
      lxx_translation: { release_version: releaseVersion, hash_algorithm: 'fnv1a64_hi32_mod64', buckets: 64, base_dir: `${base}/lxx` },
    },
  };

  const resolver = { lemmas: {}, by_strongs_base: {}, by_strongs_extended: {}, by_surface_form: {}, by_transliteration: {} };
  const lemmaMap = new Map();
  for (const l of spec.lemmas) {
    const canonicalAlias = l.lemma_id === 'lemma:H9005b' || l.lemma_id === 'lemma:H9005a' || l.lemma_id === 'lemma:H9005' ? undefined : undefined;
    resolver.lemmas[l.lemma_id] = {
      ...l,
      canonical_lemma_id: l.lemma_id === 'lemma:H9005' ? 'lemma:H9005a' : canonicalAlias,
      in_graph: true,
      outgoing_summary_count: l.lemma_id === 'lemma:H9009' ? 400 : 2,
      incoming_summary_count: l.lemma_id === 'lemma:H9009' ? 400 : 2,
    };
    lemmaMap.set(l.lemma_id, resolver.lemmas[l.lemma_id]);
    resolver.by_strongs_base[l.strongs_base] = resolver.by_strongs_base[l.strongs_base] || [];
    if (!resolver.by_strongs_base[l.strongs_base].includes(l.lemma_id)) resolver.by_strongs_base[l.strongs_base].push(l.lemma_id);
    if (l.extended_strongs) resolver.by_strongs_extended[l.extended_strongs] = l.lemma_id;
    resolver.by_surface_form[l.lemma_form] = resolver.by_surface_form[l.lemma_form] || [];
    resolver.by_surface_form[l.lemma_form].push(l.lemma_id);
    resolver.by_transliteration[l.transliteration] = resolver.by_transliteration[l.transliteration] || [];
    resolver.by_transliteration[l.transliteration].push(l.lemma_id);
  }
  files[`${base}/resolver-index.json.gz`] = resolver;
  files[`${base}/uncovered-lemmas.json.gz`] = { entries: {} };

  const gramByShard = new Map();
  const sumEvByShard = new Map();
  const ensureGram = (lemmaId) => {
    const hex = computeBucketHex('fnv1a64_mod256', 256, lemmaId);
    const p = `${base}/by-lemma/shard-${hex}.json.gz`;
    if (!gramByShard.has(p)) gramByShard.set(p, { entries: {} });
    const shard = gramByShard.get(p);
    if (!shard.entries[lemmaId]) shard.entries[lemmaId] = { outgoing_summaries: [], incoming_summaries: [] };
    return shard.entries[lemmaId];
  };
  for (const g of spec.grammatical_edges) {
    const srcMeta = lemmaMap.get(g.source);
    const tgtMeta = lemmaMap.get(g.target);
    const sampleRel = { relation_id: `${g.summary_id}:r1`, frame_id: g.frame_id, canonical_ref: g.canonical_ref, edition: g.edition, quality: g.quality_tier };
    ensureGram(g.source).outgoing_summaries.push({
      summary_id: g.summary_id, predicate: g.predicate, display_predicate: g.predicate, display_label: g.predicate,
      direction: 'outgoing', quality_tier: g.quality_tier, source_edition: g.edition, related_lemma_id: g.target,
      related_lemma: { lemma_id: g.target, lemma_form: tgtMeta.lemma_form, gloss: tgtMeta.gloss, pos: tgtMeta.pos, language: tgtMeta.language },
      stats: { distinct_passages: 1, distinct_books: 1, occurrences: 1 }, sample_relations: [sampleRel],
    });
    ensureGram(g.target).incoming_summaries.push({
      summary_id: g.summary_id, predicate: g.predicate, display_predicate: `inverse_${g.predicate}`, display_label: g.predicate,
      direction: 'incoming', quality_tier: g.quality_tier, source_edition: g.edition, related_lemma_id: g.source,
      related_lemma: { lemma_id: g.source, lemma_form: srcMeta.lemma_form, gloss: srcMeta.gloss, pos: srcMeta.pos, language: srcMeta.language },
      stats: { distinct_passages: 1, distinct_books: 1, occurrences: 1 }, sample_relations: [sampleRel],
    });
    const evHex = computeBucketHex('fnv1a64_mod256', 256, g.summary_id);
    const evPath = `${base}/evidence/by-summary/shard-${evHex}.json.gz`;
    if (!sumEvByShard.has(evPath)) sumEvByShard.set(evPath, { entries: {} });
    sumEvByShard.get(evPath).entries[g.summary_id] = [sampleRel];
  }
  for (const [p, v] of gramByShard) files[p] = v;
  for (const [p, v] of sumEvByShard) files[p] = v;

  // Ensure all fixture lemmas/entities have empty shard buckets if they have no edges in a layer (matches real R8D/R9B full bucket emission)
  for (const l of spec.lemmas) {
    const gHex = computeBucketHex('fnv1a64_mod256', 256, l.lemma_id);
    const gp = `${base}/by-lemma/shard-${gHex}.json.gz`;
    if (!files[gp]) files[gp] = { entries: {} };
    const xHex = computeBucketHex('fnv1a64_hi32_mod64', 64, l.lemma_id);
    const lp = `${base}/lexical/edges/sharded-edges/shard-${xHex}.json.gz`;
    if (!files[lp]) files[lp] = { endpoint_index: {}, edges_by_id: {} };
    const cp = `${base}/contextual/sharded-contextual/shard-${xHex}.json.gz`;
    if (!files[cp]) files[cp] = {};
    const xp = `${base}/lxx/${l.lemma_id.startsWith('lemma:G') ? 'by-greek-lemma' : 'by-hebrew-lemma'}/shard-${xHex}.json.gz`;
    if (!files[xp]) files[xp] = { entries: {} };
  }
  for (const entKey of ['root:H9001', 'sense:H9001I:sub']) {
    const xHex = computeBucketHex('fnv1a64_hi32_mod64', 64, entKey);
    const lp = `${base}/lexical/edges/sharded-edges/shard-${xHex}.json.gz`;
    if (!files[lp]) files[lp] = { endpoint_index: {}, edges_by_id: {} };
  }

  const lexShards = new Map();
  const ensureLex = (k) => {
    const hex = computeBucketHex('fnv1a64_hi32_mod64', 64, k);
    const p = `${base}/lexical/edges/sharded-edges/shard-${hex}.json.gz`;
    if (!lexShards.has(p)) lexShards.set(p, { endpoint_index: {}, edges_by_id: {} });
    return lexShards.get(p);
  };
  for (const l of spec.lexical_edges) {
    const rec = {
      relationship_id: l.relationship_id,
      raw_relation_code: l.raw_relation_code,
      category: l.category,
      direction: l.direction,
      epistemic_tier: 'attested_lexical_fact',
      subject: { canonical_key: l.subject, language: 'hebrew' },
      target: { canonical_key: l.target, language: 'hebrew' },
      explanation: `Fixture lexical link ${l.relationship_id}`,
      provenance: { source_title: 'Fixture STEPBible', license: 'CC BY 4.0' },
    };
    const sShard = ensureLex(l.subject);
    sShard.edges_by_id[l.relationship_id] = rec;
    sShard.endpoint_index[l.subject] = sShard.endpoint_index[l.subject] || [];
    sShard.endpoint_index[l.subject].push({ relationship_id: l.relationship_id, role: l.direction === 'symmetric' ? 'symmetric' : 'outgoing', peer_key: l.target });

    const tShard = ensureLex(l.target);
    tShard.edges_by_id[l.relationship_id] = rec;
    tShard.endpoint_index[l.target] = tShard.endpoint_index[l.target] || [];
    tShard.endpoint_index[l.target].push({ relationship_id: l.relationship_id, role: l.direction === 'symmetric' ? 'symmetric' : 'incoming', peer_key: l.subject });
  }
  for (const [p, v] of lexShards) files[p] = v;

  const ctxShards = new Map();
  const addCtxItem = (a, b, item, overflow) => {
    const hex = computeBucketHex('fnv1a64_hi32_mod64', 64, a);
    const p = `${base}/contextual/sharded-contextual/shard-${hex}.json.gz`;
    if (!ctxShards.has(p)) ctxShards.set(p, {});
    const shard = ctxShards.get(p);
    if (!shard[a]) shard[a] = { total_neighbors: 0, neighbors: [], overflow_pages: [] };
    shard[a].total_neighbors += 1;
    if (overflow) {
      const ovPath = `${base}/contextual/overflow/page-${a.replace(':', '_')}.json.gz`;
      shard[a].overflow_pages.push({ path: `contextual/overflow/page-${a.replace(':', '_')}.json.gz`, offset_start: 50, max_same_verse: item.counts.same_verse, max_same_clause: item.counts.same_clause, max_collocation: item.counts.collocation_distance_le_3 });
      files[ovPath] = { entries: { [a]: [{ offset_start: 50, items: [item] }] } };
    } else {
      shard[a].neighbors.push(item);
    }
  };
  for (const c of spec.contextual_pairs) {
    addCtxItem(c.a, c.b, { target_lemma_key: c.b, target_language: 'hebrew', counts: { same_verse: c.same_verse, same_clause: c.same_clause, collocation_distance_le_3: c.collocation_distance_le_3 }, sample_passages: [{ ref: c.ref, in_same_clause: c.same_clause > 0, is_collocation: c.collocation_distance_le_3 > 0 }] }, c.overflow);
    addCtxItem(c.b, c.a, { target_lemma_key: c.a, target_language: 'hebrew', counts: { same_verse: c.same_verse, same_clause: c.same_clause, collocation_distance_le_3: c.collocation_distance_le_3 }, sample_passages: [{ ref: c.ref, in_same_clause: c.same_clause > 0, is_collocation: c.collocation_distance_le_3 > 0 }] }, c.overflow);
  }
  for (const [p, v] of ctxShards) files[p] = v;

  for (const x of spec.lxx_edges) {
    const hHex = computeBucketHex('fnv1a64_hi32_mod64', 64, x.hebrew);
    const hp = `${base}/lxx/by-hebrew-lemma/shard-${hHex}.json.gz`;
    files[hp] = files[hp] || { entries: {} };
    files[hp].entries[x.hebrew] = { candidates: [{ edge_id: x.edge_id, homograph_ambiguity: x.homograph_ambiguity, mapping_status: x.mapping_status, published_count: x.published_count, translation_share: x.translation_share, greek_candidates: [{ lemma_key: x.greek }] }] };

    const gHex = computeBucketHex('fnv1a64_hi32_mod64', 64, x.greek);
    const gp = `${base}/lxx/by-greek-lemma/shard-${gHex}.json.gz`;
    files[gp] = files[gp] || { entries: {} };
    files[gp].entries[x.greek] = { candidates: [{ edge_id: x.edge_id, homograph_ambiguity: x.homograph_ambiguity, mapping_status: x.mapping_status, published_count: x.published_count, translation_share: x.translation_share, hebrew_candidates: [{ lemma_key: x.hebrew }] }] };
  }
  return { releaseVersion, files };
}

async function readRawShardFromDisk(roots, relPath) {
  const clean = relPath.replace(/^\/+/, '');
  for (const r of roots) {
    for (const cand of [path.join(r, clean), clean.endsWith('.json.gz') ? path.join(r, clean.slice(0, -3)) : null].filter(Boolean)) {
      try {
        const buf = await fs.readFile(cand);
        const gz = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
        return JSON.parse((gz ? zlib.gunzipSync(buf) : buf).toString('utf8'));
      } catch { /* try next */ }
    }
  }
  return null;
}

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed += 1;
    console.log(`PASS [${passed}]: ${name}`);
  });
}

async function main() {
  const spec = JSON.parse(await fs.readFile(FIXTURE_PATH, 'utf8'));
  const { releaseVersion, files } = await buildShardedFixtureFiles(spec);
  const fxLoader = new ShardedAdjacencyLoader(createInMemoryAssetReader(files), { releaseVersion });

  await check('1. Valid one-hop paths (fixture)', async () => {
    const r = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', target: 'lemma:H9002', max_hops: 1 });
    assert.equal(r.status, 'ok');
    assert.ok(r.paths.some((p) => p.hop_count === 1 && p.steps[0].source_relationship_id === 'sum:fx:1'));
  });

  await check('2. Valid two-hop paths & same_frame verification (fixture)', async () => {
    const r = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', target: 'lemma:H9003', max_hops: 2, layers: ['grammatical'] });
    assert.equal(r.status, 'ok');
    const sameFramePath = r.paths.find((p) => p.explanation.join_scope === 'same_frame');
    assert.ok(sameFramePath, 'Expected a same_frame 2-hop path H9001 -> H9002 -> H9003');
    assert.ok(sameFramePath.explanation.shared_frame_ids.includes('frame:fx:GEN:1:2#cl1'));
  });

  await check('3. Valid three-hop paths (fixture)', async () => {
    const r = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', target: 'lemma:H9004', max_hops: 3, layers: ['grammatical'] });
    assert.equal(r.status, 'ok');
    assert.ok(r.paths.some((p) => p.hop_count === 3 && p.entities.map((e) => e.entity_key).join('>') === 'lemma:H9001>lemma:H9002>lemma:H9003>lemma:H9004'));
  });

  await check('4. Directed relationship semantics (no fabricated reverse facts)', async () => {
    const fwdOk = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', target: 'lemma:H9002', max_hops: 1, layers: ['grammatical'], direction: 'outgoing' });
    assert.equal(fwdOk.paths.length, 1);
    const revDisallowed = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9002', target: 'lemma:H9001', max_hops: 1, layers: ['grammatical'], direction: 'outgoing' });
    assert.equal(revDisallowed.status, 'no_supported_path');
    const revAllowedIncoming = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9002', target: 'lemma:H9001', max_hops: 1, layers: ['grammatical'], direction: 'incoming' });
    assert.equal(revAllowedIncoming.paths.length, 1);
    assert.equal(revAllowedIncoming.paths[0].steps[0].canonical_source_entity.entity_key, 'lemma:H9001');
    assert.equal(revAllowedIncoming.paths[0].steps[0].canonical_target_entity.entity_key, 'lemma:H9002');
  });

  await check('5. Symmetric reverse traversal (contextual & lexical symmetric)', async () => {
    const a2b = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9002', target: 'lemma:H9003', max_hops: 1, layers: ['contextual'], direction: 'outgoing' });
    const b2a = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9003', target: 'lemma:H9002', max_hops: 1, layers: ['contextual'], direction: 'outgoing' });
    assert.equal(a2b.paths.length, 1);
    assert.equal(b2a.paths.length, 1);
    assert.equal(a2b.paths[0].steps[0].direction, 'symmetric');
  });

  await check('6. No duplicate path_ids & 7. No cycles by default', async () => {
    const open = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', max_hops: 3, limit: 50 });
    const ids = open.paths.map((p) => p.path_id);
    assert.equal(new Set(ids).size, ids.length, 'All returned path_ids must be unique');
    for (const p of open.paths) {
      const keys = p.entities.map((e) => e.entity_key);
      assert.equal(new Set(keys).size, keys.length, `Cycle detected in path ${p.path_id}: ${keys.join(' -> ')}`);
    }
    const cyc = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9002', target: 'lemma:H9002', max_hops: 2, allow_cycles: true });
    assert.ok(cyc.paths.some((p) => p.entities[0].entity_key === p.entities[p.entities.length - 1].entity_key));
  });

  await check('8. Canonical homograph preservation & concept disambiguation', async () => {
    const baseRes = await resolveResearchConcept(fxLoader, 'H9005');
    assert.equal(baseRes.status, 'needs_disambiguation');
    assert.equal(baseRes.requires_explicit_selection, true);
    assert.ok(baseRes.candidates.some((c) => c.entity_key === 'lemma:H9005a'));
    assert.ok(baseRes.candidates.some((c) => c.entity_key === 'lemma:H9005b'));

    const conceptRes = await resolveResearchConcept(fxLoader, 'light');
    assert.equal(conceptRes.status, 'needs_disambiguation');
    assert.equal(conceptRes.requires_explicit_selection, true);
  });

  await check('9. Lexical root and sense typed entities & guardrails', async () => {
    const res = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', max_hops: 1, layers: ['lexical'] });
    const rootPath = res.paths.find((p) => p.entities[1].entity_key === 'root:H9001');
    const sensePath = res.paths.find((p) => p.entities[1].entity_key === 'sense:H9001I:sub');
    assert.equal(rootPath?.entities[1].entity_kind, 'root');
    assert.equal(sensePath?.entities[1].entity_kind, 'sense');
    assert.ok(rootPath?.explanation.does_not_establish.some((d) => /synonymy/i.test(d)));
  });

  await check('10. Edition separation (morphgnt-sblgnt vs robinson-byzantine)', async () => {
    const sbl = await discoverMultiHopPaths(fxLoader, { source: 'lemma:G9001', target: 'lemma:G9002', max_hops: 1, editions: ['morphgnt-sblgnt'] });
    assert.equal(sbl.paths.length, 1);
    assert.deepEqual(sbl.paths[0].steps[0].editions, ['morphgnt-sblgnt']);
    const byz = await discoverMultiHopPaths(fxLoader, { source: 'lemma:G9001', target: 'lemma:G9002', max_hops: 1, editions: ['robinson-byzantine'] });
    assert.equal(byz.paths.length, 1);
    assert.deepEqual(byz.paths[0].steps[0].editions, ['robinson-byzantine']);
  });

  await check('12. LXX translation guardrails & 13. High-frequency hub ranking (fixture)', async () => {
    const lxx = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9005a', target: 'lemma:G9002', max_hops: 1, layers: ['lxx_translation'] });
    assert.equal(lxx.paths.length, 1);
    assert.equal(lxx.paths[0].steps[0].uncertainty.homograph_ambiguity, true);
    assert.ok(lxx.paths[0].ranking.factors.uncertainty_penalty > 0);
    assert.ok(lxx.paths[0].explanation.does_not_establish.some((d) => /LXX/i.test(d)));

    const hubRank = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', target: 'lemma:H9003', max_hops: 2, layers: ['grammatical'] });
    assert.equal(hubRank.paths[0].entities[1].entity_key, 'lemma:H9002', 'Content same-frame path must outrank function-word hub path');
    const hubPath = hubRank.paths.find((p) => p.entities[1].entity_key === 'lemma:H9009');
    assert.ok(hubPath && hubPath.ranking.factors.hub_penalty > 0);

    const noHubs = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', target: 'lemma:H9003', max_hops: 2, layers: ['grammatical'], hub_penalty: { allow_function_word_intermediates: false } });
    assert.ok(!noHubs.paths.some((p) => p.entities[1].entity_key === 'lemma:H9009'));
  });

  await check('14. Deterministic results & 15. Cursor pagination (fixture)', async () => {
    const r1 = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', max_hops: 2, limit: 2, offset: 0 });
    const r1Repeat = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', max_hops: 2, limit: 2, offset: 0 });
    assert.deepEqual(r1.paths.map((p) => p.path_id), r1Repeat.paths.map((p) => p.path_id));
    assert.equal(r1.pagination.has_more, true);
    const r2 = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', max_hops: 2, limit: 2, cursor: r1.pagination.next_cursor });
    assert.ok(r2.paths.length > 0);
    assert.equal(new Set([...r1.paths, ...r2.paths].map((p) => p.path_id)).size, r1.paths.length + r2.paths.length);
  });

  await check('16. Search resource limits & 17. Contextual overflow + missing shard coverage', async () => {
    const limited = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', max_hops: 3, limits: { max_nodes_expanded: 2, max_edges_examined: 25 } });
    assert.equal(limited.coverage.exhaustive, false);
    assert.equal(limited.coverage.search_stopped_by_limits, true);

    const truncCtx = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', target: 'lemma:H9004', max_hops: 1, layers: ['contextual'], limits: { max_contextual_pages_per_node: 0 } });
    assert.equal(truncCtx.status, 'no_supported_path');
    assert.equal(truncCtx.coverage.source_coverage_incomplete, true);
    assert.ok(truncCtx.coverage.truncated_contextual_entities.includes('lemma:H9001'));

    const fullCtx = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', target: 'lemma:H9004', max_hops: 1, layers: ['contextual'], limits: { max_contextual_pages_per_node: 5 } });
    assert.equal(fullCtx.status, 'ok', 'Overflow contextual page should make H9001 <-> H9004 discoverable');

    const brokenFiles = { ...files };
    const hexIso = computeBucketHex('fnv1a64_mod256', 256, 'lemma:H9990');
    delete brokenFiles[`/v2/relationships/${releaseVersion}/by-lemma/shard-${hexIso}.json.gz`];
    const brokenLoader = new ShardedAdjacencyLoader(createInMemoryAssetReader(brokenFiles), { releaseVersion });
    const inc = await discoverMultiHopPaths(brokenLoader, { source: 'lemma:H9990', max_hops: 1, layers: ['grammatical'] });
    assert.equal(inc.coverage.source_coverage_incomplete, true);
    assert.ok(inc.coverage.missing_shards.length > 0);
  });

  await check('18. Unsupported paths & no_supported_path contract', async () => {
    const disconn = await discoverMultiHopPaths(fxLoader, { source: 'lemma:H9001', target: 'lemma:H9990', max_hops: 3 });
    assert.equal(disconn.status, 'no_supported_path');
    assert.equal(disconn.message, 'No supported path within the requested scope.');

    const englishDirect = await discoverMultiHopPaths(fxLoader, { source: 'spirit', max_hops: 2 });
    assert.equal(englishDirect.status, 'invalid_request');
  });

  // Real R9B + R8D offline graph verification
  const reader = await createNodeFsAssetReader([R9B_STAGING, R8D_CORPUS]);
  const realLoader = new ShardedAdjacencyLoader(reader, { releaseVersion: 'r9b-v1.0', maxCachedShards: 128 });
  const manifest = await realLoader.getManifestSummary();
  assert.ok(manifest, 'Real R9B manifest must load from disk');

  await check('11 & Real-1: Independently verify sampled H7307 grammatical/lexical/LXX edges against raw shards', async () => {
    const res = await discoverMultiHopPaths(realLoader, { source: 'lemma:H7307', target: 'lemma:H7363B', max_hops: 1, layers: ['grammatical'] });
    assert.equal(res.status, 'ok');
    const step = res.paths[0].steps[0];
    const gHex = computeBucketHex('fnv1a64_mod256', 256, 'lemma:H7307');
    const rawGram = await readRawShardFromDisk([R8D_CORPUS], `/v2/relationships/r8-v1.1/by-lemma/shard-${gHex}.json.gz`);
    const match = rawGram.entries['lemma:H7307'].outgoing_summaries.find((s) => s.summary_id === step.source_relationship_id);
    assert.ok(match, 'Returned summary_id must exist verbatim in raw R8D by-lemma shard');
    assert.equal(match.predicate, step.predicate);

    const cog = await discoverMultiHopPaths(realLoader, { source: 'lemma:H7307', target: 'lemma:H7308', max_hops: 1, layers: ['lexical'] });
    assert.equal(cog.status, 'ok');
    const lHex = computeBucketHex('fnv1a64_hi32_mod64', 64, 'lemma:H7307');
    const rawLex = await readRawShardFromDisk([R9B_STAGING], `/v2/relationships/r9b-v1.0/lexical/edges/sharded-edges/shard-${lHex}.json.gz`);
    assert.ok(rawLex.edges_by_id[cog.paths[0].steps[0].source_relationship_id], 'Lexical edge ID must exist in raw R9B shard');

    const dabarLogos = await discoverMultiHopPaths(realLoader, { source: 'lemma:H1697G', target: 'lemma:G3056', max_hops: 2 });
    assert.equal(dabarLogos.status, 'ok');
    const directLxx = dabarLogos.paths.find((p) => p.hop_count === 1 && p.layers_used.includes('lxx_translation'));
    assert.ok(directLxx, 'H1697G -> G3056 must expose direct LXX candidate');
    assert.equal(directLxx.steps[0].uncertainty.homograph_ambiguity, true);

    const gen1SameFrame = await discoverMultiHopPaths(realLoader, { source: 'lemma:H0430G', target: 'lemma:H8064', max_hops: 2, layers: ['grammatical'], limit: 10 });
    assert.ok(gen1SameFrame.paths.some((p) => p.explanation.shared_references.includes('GEN 1:1')), 'Expected GEN 1:1 2-hop witness between H0430G and H8064 via H1254a');

    const greekOnly = await discoverMultiHopPaths(realLoader, { source: 'lemma:G3056', max_hops: 1, layers: ['grammatical'], editions: ['macula-greek-sblgnt'], limit: 5 });
    assert.ok(greekOnly.paths.length > 0);
    for (const p of greekOnly.paths) assert.ok(p.steps[0].editions.includes('macula-greek-sblgnt'));
    const nestleOnly = await discoverMultiHopPaths(realLoader, { source: 'lemma:G3056', max_hops: 1, layers: ['grammatical'], editions: ['macula-greek-nestle1904'], limit: 5 });
    assert.ok(nestleOnly.paths.length > 0);
    for (const p of nestleOnly.paths) assert.ok(p.steps[0].editions.includes('macula-greek-nestle1904'));
  });

  await check('Real-2: Complete multi-page contextual loading beyond top-50 on R9B', async () => {
    const ruachCtx = await discoverMultiHopPaths(realLoader, {
      source: 'lemma:H7307',
      max_hops: 1,
      layers: ['contextual'],
      limits: { max_contextual_pages_per_node: 5, max_paths_returned: 100 },
      limit: 100,
    });
    assert.equal(ruachCtx.status, 'ok');
    assert.ok(ruachCtx.coverage.total_paths_found > 50, `Expected >50 contextual neighbors via R9B overflow pages, got ${ruachCtx.coverage.total_paths_found}`);
    assert.ok(ruachCtx.coverage.contextual_pages_loaded >= 1);
  });

  console.log(`\nALL ${passed} R9C VERIFICATION CHECKS PASSED.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
