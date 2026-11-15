#!/usr/bin/env node
/**
 * scripts/optimize-r9b-worker-shards.mjs
 *
 * Optimizes R9B/R9C static shards for Cloudflare Workers (128 MB RAM / CPU limits)
 * without rebuilding the 66-book grammatical corpus:
 * 1. Re-shards `r9b-v1.0/contextual/sharded-contextual/` from 64 buckets -> 1024 buckets
 *    using `fnv1a64_hi32_mod1024` (`shard-000.json.gz` .. `shard-3ff.json.gz`), shrinking
 *    largest contextual shards from ~22.8 MB raw JSON to ~1.3 MB raw JSON.
 * 2. Builds `r9b-v1.0/resolver/`:
 *    - `compact-meta.json.gz`: compact `[pos, deg, gloss, homograph_tag]` map (~480 KB raw)
 *    - `english-concepts.json.gz`: compact gloss search table for English concept resolution
 *    - `by-key/shard-00..ff.json.gz`: 256-bucket `fnv1a64_mod256(lowerKey)` lookup shards
 *      containing slim lemma profiles, uncovered tuples, Strong's base/extended candidates,
 *      surface forms, and transliterations (~10-30 KB raw each).
 * 3. Updates `r9b-v1.0/manifest.json` and `manifest.json.gz` with updated layer metadata
 *    and artifact checksums.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const DEFAULT_BASES = [
  path.join(ROOT, '.artifacts-r9b', 'deploy-bundle', 'v2', 'relationships'),
  path.join(ROOT, '.artifacts-r9b', 'staging', 'v2', 'relationships'),
];

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

function fnv1a64Hi32Mod(input, buckets) {
  const hex64 = fnv1a64Hex(input);
  return Number(BigInt('0x' + hex64.slice(0, 8)) % BigInt(buckets));
}

function fnv1a64Mod(input, buckets) {
  const hex64 = fnv1a64Hex(input);
  return Number(BigInt('0x' + hex64) % BigInt(buckets));
}

function readGzJson(filePath) {
  const gz = fs.readFileSync(filePath);
  return JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
}

function writeGzJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const raw = Buffer.from(JSON.stringify(data), 'utf8');
  const gz = zlib.gzipSync(raw, { level: 6 });
  fs.writeFileSync(filePath, gz);
  const sha256 = crypto.createHash('sha256').update(gz).digest('hex');
  return { sha256, bytes: gz.length, rawBytes: raw.length };
}

function slimResolverEntry(key, v) {
  return {
    lemma_id: v.lemma_id || key,
    canonical_lemma_id: v.canonical_lemma_id || key,
    language: v.language ?? null,
    lemma_form: v.lemma_form ?? null,
    lemma_stripped: v.lemma_stripped ?? null,
    transliteration: v.transliteration ?? null,
    gloss: v.gloss ?? null,
    strongs_base: v.strongs_base ?? null,
    extended_strongs: v.extended_strongs ?? null,
    homograph_tag: v.homograph_tag ?? null,
    pos: v.pos ?? null,
    in_graph: v.in_graph !== false,
    editions: Array.isArray(v.editions) ? v.editions : [],
    outgoing_summary_count: Number(v.outgoing_summary_count || 0),
    incoming_summary_count: Number(v.incoming_summary_count || 0),
  };
}

function optimizeContextualShards(r9bDir, checksums) {
  const ctxDir = path.join(r9bDir, 'contextual', 'sharded-contextual');
  const existing = fs.readdirSync(ctxDir).filter((f) => /^shard-.*\.json\.gz$/.test(f));
  const merged = new Map();

  for (const file of existing) {
    const obj = readGzJson(path.join(ctxDir, file));
    for (const [k, val] of Object.entries(obj || {})) {
      merged.set(k, val);
    }
  }

  const CTX_BUCKETS = 1024;
  const buckets = Array.from({ length: CTX_BUCKETS }, () => ({}));
  for (const [lemmaKey, val] of merged.entries()) {
    const idx = fnv1a64Mod(lemmaKey, CTX_BUCKETS);
    buckets[idx][lemmaKey] = val;
  }

  // Remove old 64-bucket checksums and files
  for (const key of Object.keys(checksums)) {
    if (key.startsWith('contextual/sharded-contextual/')) {
      delete checksums[key];
    }
  }
  for (const file of existing) {
    fs.unlinkSync(path.join(ctxDir, file));
  }

  let maxRaw = 0;
  let maxGz = 0;
  for (let i = 0; i < CTX_BUCKETS; i++) {
    const hex3 = i.toString(16).padStart(3, '0');
    const rel = `contextual/sharded-contextual/shard-${hex3}.json.gz`;
    const res = writeGzJson(path.join(r9bDir, rel), buckets[i]);
    if (res.rawBytes > maxRaw) maxRaw = res.rawBytes;
    if (res.bytes > maxGz) maxGz = res.bytes;
    checksums[rel] = { sha256: res.sha256, bytes: res.bytes };
  }

  return {
    lemmasCount: merged.size,
    buckets: CTX_BUCKETS,
    maxRawKB: +(maxRaw / 1024).toFixed(1),
    maxGzKB: +(maxGz / 1024).toFixed(1),
  };
}

function buildShardedResolver(r8Dir, r9bDir, checksums) {
  const resolver = readGzJson(path.join(r8Dir, 'resolver-index.json.gz'));
  const uncovered = readGzJson(path.join(r8Dir, 'uncovered-lemmas.json.gz'));
  const resDir = path.join(r9bDir, 'resolver');
  fs.mkdirSync(path.join(resDir, 'by-key'), { recursive: true });

  // Clean previous resolver checksums
  for (const key of Object.keys(checksums)) {
    if (key.startsWith('resolver/')) delete checksums[key];
  }

  // 1. compact-meta.json.gz: lightweight lookup for POS/degree/gloss/homograph during BFS
  const compactLemmas = {};
  for (const [k, v] of Object.entries(resolver.lemmas || {})) {
    if (v.canonical_lemma_id && v.canonical_lemma_id !== k) continue;
    const deg = (v.outgoing_summary_count || 0) + (v.incoming_summary_count || 0);
    compactLemmas[k] = [v.pos || null, deg, v.gloss || null, v.homograph_tag || null];
  }
  const compactUncovered = {};
  for (const [k, tup] of Object.entries(uncovered.entries || {})) {
    if (compactLemmas[k]) continue;
    compactUncovered[k] = [tup[4] || null, tup[2] || null];
  }
  const compactRes = writeGzJson(path.join(resDir, 'compact-meta.json.gz'), {
    schema_version: '1.0',
    lemmas: compactLemmas,
    uncovered: compactUncovered,
  });
  checksums['resolver/compact-meta.json.gz'] = { sha256: compactRes.sha256, bytes: compactRes.bytes };

  // 1b. search-hints.json.gz: tiny hub + function-word subset for cold Cloudflare CPU <10ms
  const fnPosRe = /^(?:H:(?:P|C|T|R|D|S)|G:(?:PREP|CONJ|PART|ART|PRON|INJ))/;
  const searchHintLemmas = {};
  for (const [k, tup] of Object.entries(compactLemmas)) {
    const pos = tup[0];
    const deg = tup[1] || 0;
    if (deg >= 100 || (pos && fnPosRe.test(pos)) || tup[3]) {
      searchHintLemmas[k] = [pos, deg, null, tup[3]];
    }
  }
  const hintsRes = writeGzJson(path.join(resDir, 'search-hints.json.gz'), {
    schema_version: '1.0',
    lemmas: searchHintLemmas,
    uncovered: {},
  });
  checksums['resolver/search-hints.json.gz'] = { sha256: hintsRes.sha256, bytes: hintsRes.bytes };

  // 2. english-concepts.json.gz: compact gloss index
  const conceptRows = [];
  for (const [k, v] of Object.entries(resolver.lemmas || {})) {
    if (v.canonical_lemma_id && v.canonical_lemma_id !== k) continue;
    if (!v.gloss) continue;
    const deg = (v.outgoing_summary_count || 0) + (v.incoming_summary_count || 0);
    conceptRows.push([
      k,
      v.gloss,
      v.lemma_form || null,
      v.transliteration || null,
      v.language || null,
      v.pos || null,
      v.strongs_base || null,
      v.extended_strongs || null,
      v.in_graph !== false ? 1 : 0,
      deg,
      0,
    ]);
  }
  for (const [k, tup] of Object.entries(uncovered.entries || {})) {
    if (resolver.lemmas?.[k]) continue;
    if (!tup[2]) continue;
    conceptRows.push([
      k,
      tup[2],
      tup[0] || null,
      tup[1] || null,
      null,
      tup[4] || null,
      tup[3] || null,
      null,
      0,
      0,
      1,
    ]);
  }
  const engRes = writeGzJson(path.join(resDir, 'english-concepts.json.gz'), {
    schema_version: '1.0',
    rows: conceptRows,
  });
  checksums['resolver/english-concepts.json.gz'] = { sha256: engRes.sha256, bytes: engRes.bytes };

  // 3. by-key 256-bucket shards (bucketed by fnv1a64_mod256(key.toLowerCase()))
  const RES_BUCKETS = 256;
  const shards = Array.from({ length: RES_BUCKETS }, () => ({
    lemmas: {},
    uncovered: {},
    by_strongs_base: {},
    by_strongs_extended: {},
    by_surface_form: {},
    by_transliteration: {},
  }));

  const resolveEntry = (id) => {
    const v = resolver.lemmas?.[id];
    if (v) return { kind: 'lemma', key: v.canonical_lemma_id || id, entry: slimResolverEntry(id, v) };
    const u = uncovered.entries?.[id];
    if (u) return { kind: 'uncovered', key: id, tuple: u };
    return null;
  };

  for (const [k, v] of Object.entries(resolver.lemmas || {})) {
    const idx = fnv1a64Mod(k.toLowerCase(), RES_BUCKETS);
    shards[idx].lemmas[k] = slimResolverEntry(k, v);
  }
  for (const [k, tup] of Object.entries(uncovered.entries || {})) {
    const idx = fnv1a64Mod(k.toLowerCase(), RES_BUCKETS);
    shards[idx].uncovered[k] = tup;
  }

  for (const [base, ids] of Object.entries(resolver.by_strongs_base || {})) {
    const idx = fnv1a64Mod(base.toLowerCase(), RES_BUCKETS);
    const seen = new Set();
    const items = [];
    for (const id of [...(ids || []), `lemma:${base}`]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const r = resolveEntry(id);
      if (!r) continue;
      items.push(r.kind === 'lemma' ? { kind: 'lemma', entry: r.entry } : { kind: 'uncovered', key: r.key, tuple: r.tuple });
    }
    if (items.length > 0) shards[idx].by_strongs_base[base] = items;
  }

  // Ensure Strong's bases present only in uncovered also get indexed cleanly
  for (const [k, tup] of Object.entries(uncovered.entries || {})) {
    const base = tup[3];
    if (!base) continue;
    const idx = fnv1a64Mod(base.toLowerCase(), RES_BUCKETS);
    const list = shards[idx].by_strongs_base[base] || [];
    if (!list.some((it) => (it.kind === 'uncovered' ? it.key === k : it.entry.canonical_lemma_id === k))) {
      list.push({ kind: 'uncovered', key: k, tuple: tup });
      shards[idx].by_strongs_base[base] = list;
    }
  }

  for (const [ext, targetId] of Object.entries(resolver.by_strongs_extended || {})) {
    const idx = fnv1a64Mod(ext.toLowerCase(), RES_BUCKETS);
    const r = resolveEntry(targetId) || resolveEntry(`lemma:${ext}`);
    if (r) {
      shards[idx].by_strongs_extended[ext] =
        r.kind === 'lemma' ? { kind: 'lemma', entry: r.entry } : { kind: 'uncovered', key: r.key, tuple: r.tuple };
    }
  }

  for (const [surf, ids] of Object.entries(resolver.by_surface_form || {})) {
    const items = [];
    for (const id of ids || []) {
      const r = resolveEntry(id);
      if (r && r.kind === 'lemma') items.push(r.entry);
    }
    if (!items.length) continue;
    const idx = fnv1a64Mod(surf.toLowerCase(), RES_BUCKETS);
    shards[idx].by_surface_form[surf] = items;
  }

  for (const [tr, ids] of Object.entries(resolver.by_transliteration || {})) {
    const items = [];
    for (const id of ids || []) {
      const r = resolveEntry(id);
      if (r && r.kind === 'lemma') items.push(r.entry);
    }
    if (!items.length) continue;
    const lowerTr = tr.toLowerCase();
    const idx = fnv1a64Mod(lowerTr, RES_BUCKETS);
    shards[idx].by_transliteration[lowerTr] = items;
  }

  let maxRaw = 0;
  let maxGz = 0;
  for (let i = 0; i < RES_BUCKETS; i++) {
    const hex2 = i.toString(16).padStart(2, '0');
    const rel = `resolver/by-key/shard-${hex2}.json.gz`;
    const res = writeGzJson(path.join(r9bDir, rel), shards[i]);
    if (res.rawBytes > maxRaw) maxRaw = res.rawBytes;
    if (res.bytes > maxGz) maxGz = res.bytes;
    checksums[rel] = { sha256: res.sha256, bytes: res.bytes };
  }

  return {
    compactRawKB: +(compactRes.rawBytes / 1024).toFixed(1),
    compactGzKB: +(compactRes.bytes / 1024).toFixed(1),
    hintsRawKB: +(hintsRes.rawBytes / 1024).toFixed(1),
    hintsGzKB: +(hintsRes.bytes / 1024).toFixed(1),
    engRawKB: +(engRes.rawBytes / 1024).toFixed(1),
    engGzKB: +(engRes.bytes / 1024).toFixed(1),
    byKeyBuckets: RES_BUCKETS,
    byKeyMaxRawKB: +(maxRaw / 1024).toFixed(1),
    byKeyMaxGzKB: +(maxGz / 1024).toFixed(1),
  };
}

function slimGramSummary(s) {
  return {
    summary_id: s.summary_id,
    predicate: s.predicate,
    quality_tier: s.quality_tier,
    source_edition: s.source_edition,
    stats: s.stats,
    direction: s.direction,
    display_predicate: s.display_predicate,
    display_label: s.display_label,
    guardrail: s.guardrail,
    rule_version: s.rule_version,
    related_lemma_id: s.related_lemma_id,
    related_lemma: s.related_lemma,
    sample_relations: (s.sample_relations || []).map((r) => ({
      relation_id: r.relation_id,
      frame_id: r.frame_id,
      source_clause_id: r.source_clause_id,
      canonical_ref: r.canonical_ref,
      edition: r.edition,
      rule_id: r.rule_id,
      quality: r.quality,
      qualifiers: r.qualifiers,
    })),
  };
}

function slimGramEntry(v) {
  return {
    outgoing_summaries: (v.outgoing_summaries || []).map(slimGramSummary),
    incoming_summaries: (v.incoming_summaries || []).map(slimGramSummary),
  };
}

function buildFastGrammaticalShards(r8Dir, r9bDir, checksums) {
  const srcDir = path.join(r8Dir, 'by-lemma');
  const outDir = path.join(r9bDir, 'grammatical', 'fast-by-lemma');
  fs.mkdirSync(outDir, { recursive: true });
  const FAST_BUCKETS = 1024;
  const buckets = Array.from({ length: FAST_BUCKETS }, () => ({}));
  let totalEntries = 0;

  for (const file of fs.readdirSync(srcDir).filter((f) => /^shard-.*\.json\.gz$/.test(f))) {
    const obj = readGzJson(path.join(srcDir, file));
    for (const [k, v] of Object.entries(obj.entries || {})) {
      const idx = fnv1a64Mod(k, FAST_BUCKETS);
      buckets[idx][k] = slimGramEntry(v);
      totalEntries++;
    }
  }

  for (const key of Object.keys(checksums)) {
    if (key.startsWith('grammatical/fast-by-lemma/')) delete checksums[key];
  }
  let maxRaw = 0;
  let maxGz = 0;
  for (let i = 0; i < FAST_BUCKETS; i++) {
    const hex3 = i.toString(16).padStart(3, '0');
    const rel = `grammatical/fast-by-lemma/shard-${hex3}.json.gz`;
    const res = writeGzJson(path.join(r9bDir, rel), {
      schema_version: '1.0',
      bucket: hex3,
      entries: buckets[i],
    });
    if (res.rawBytes > maxRaw) maxRaw = res.rawBytes;
    if (res.bytes > maxGz) maxGz = res.bytes;
    checksums[rel] = { sha256: res.sha256, bytes: res.bytes };
  }
  return { entries: totalEntries, buckets: FAST_BUCKETS, maxRawKB: +(maxRaw / 1024).toFixed(1), maxGzKB: +(maxGz / 1024).toFixed(1) };
}

function buildFastLexicalShards(r9bDir, checksums) {
  const srcDir = path.join(r9bDir, 'lexical', 'edges', 'sharded-edges');
  const outDir = path.join(r9bDir, 'lexical', 'fast-edges');
  fs.mkdirSync(outDir, { recursive: true });
  const FAST_BUCKETS = 1024;
  const buckets = Array.from({ length: FAST_BUCKETS }, () => ({ endpoint_index: {}, edges_by_id: {} }));
  let totalKeys = 0;

  for (const file of fs.readdirSync(srcDir).filter((f) => /^shard-.*\.json\.gz$/.test(f))) {
    const obj = readGzJson(path.join(srcDir, file));
    const ep = obj.endpoint_index || {};
    const byId = obj.edges_by_id || {};
    for (const [k, links] of Object.entries(ep)) {
      const idx = fnv1a64Mod(k, FAST_BUCKETS);
      buckets[idx].endpoint_index[k] = links;
      for (const link of links || []) {
        const edge = byId[String(link.relationship_id)];
        if (edge) buckets[idx].edges_by_id[String(link.relationship_id)] = edge;
      }
      totalKeys++;
    }
  }

  for (const key of Object.keys(checksums)) {
    if (key.startsWith('lexical/fast-edges/')) delete checksums[key];
  }
  let maxRaw = 0;
  let maxGz = 0;
  for (let i = 0; i < FAST_BUCKETS; i++) {
    const hex3 = i.toString(16).padStart(3, '0');
    const rel = `lexical/fast-edges/shard-${hex3}.json.gz`;
    const res = writeGzJson(path.join(r9bDir, rel), {
      schema_version: '1.0',
      bucket: hex3,
      endpoint_index: buckets[i].endpoint_index,
      edges_by_id: buckets[i].edges_by_id,
    });
    if (res.rawBytes > maxRaw) maxRaw = res.rawBytes;
    if (res.bytes > maxGz) maxGz = res.bytes;
    checksums[rel] = { sha256: res.sha256, bytes: res.bytes };
  }
  return { keys: totalKeys, buckets: FAST_BUCKETS, maxRawKB: +(maxRaw / 1024).toFixed(1), maxGzKB: +(maxGz / 1024).toFixed(1) };
}

for (const baseRelDir of DEFAULT_BASES) {
  const localR8 = path.join(baseRelDir, 'r8-v1.1');
  const fallbackR8 = path.join(ROOT, '.artifacts-r9b', 'deploy-bundle', 'v2', 'relationships', 'r8-v1.1');
  const r8Dir = fs.existsSync(path.join(localR8, 'resolver-index.json.gz')) ? localR8 : fallbackR8;
  const r9bDir = path.join(baseRelDir, 'r9b-v1.0');
  const manifestPath = path.join(r9bDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.log(`Skipping absent dir: ${r9bDir}`);
    continue;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const checksums = manifest.artifact_checksums || {};

  const ctxStats = optimizeContextualShards(r9bDir, checksums);
  const resStats = buildShardedResolver(r8Dir, r9bDir, checksums);
  const gramStats = buildFastGrammaticalShards(r8Dir, r9bDir, checksums);
  const lexStats = buildFastLexicalShards(r9bDir, checksums);

  manifest.layers = manifest.layers || {};
  manifest.layers.contextual = {
    ...(manifest.layers.contextual || {}),
    hash_algorithm: 'fnv1a64_mod1024',
    buckets: 1024,
    shard_path_formats: {
      ...((manifest.layers.contextual || {}).shard_path_formats || {}),
      contextual_neighbors: 'sharded-contextual/shard-{hex3}.json.gz',
    },
  };
  manifest.layers.resolver = {
    schema_version: '1.0',
    base_dir: '/v2/relationships/r9b-v1.0/resolver',
    hash_algorithm: 'fnv1a64_mod256',
    hash_input_normalization: 'trimmed_lowercase_utf16',
    buckets: 256,
    shard_path_formats: {
      by_key: 'by-key/shard-{hex2}.json.gz',
      compact_meta: 'compact-meta.json.gz',
      search_hints: 'search-hints.json.gz',
      english_concepts: 'english-concepts.json.gz',
    },
  };
  manifest.counts = {
    ...(manifest.counts || {}),
    contextual_sharded_buckets: 1024,
    resolver_by_key_buckets: 256,
  };
  manifest.artifact_checksums = checksums;
  manifest.staged_file_count = Object.keys(checksums).length;

  const rawManifest = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(manifestPath, rawManifest, 'utf8');
  fs.writeFileSync(path.join(r9bDir, 'manifest.json.gz'), zlib.gzipSync(Buffer.from(rawManifest, 'utf8'), { level: 6 }));

  const runtimeManifest = {
    ...manifest,
    layers: {
      ...manifest.layers,
      grammatical: {
        ...(manifest.layers.grammatical || {}),
        worker_shards: {
          base_dir: '/v2/relationships/r9b-v1.0/grammatical',
          hash_algorithm: 'fnv1a64_mod1024',
          buckets: 1024,
          path: 'fast-by-lemma/shard-{hex3}.json.gz',
        },
      },
      lexical: {
        ...(manifest.layers.lexical || {}),
        worker_shards: {
          base_dir: '/v2/relationships/r9b-v1.0/lexical',
          hash_algorithm: 'fnv1a64_mod1024',
          buckets: 1024,
          path: 'fast-edges/shard-{hex3}.json.gz',
        },
      },
    },
  };
  delete runtimeManifest.artifact_checksums;
  const rtRes = writeGzJson(path.join(r9bDir, 'runtime-manifest.json.gz'), runtimeManifest);

  console.log(`Optimized ${r9bDir}:`);
  console.log('  contextual:', JSON.stringify(ctxStats));
  console.log('  resolver:', JSON.stringify(resStats));
  console.log('  fast-grammatical:', JSON.stringify(gramStats));
  console.log('  fast-lexical:', JSON.stringify(lexStats));
  console.log('  runtime-manifest:', `${(rtRes.rawBytes / 1024).toFixed(1)} KB raw / ${(rtRes.bytes / 1024).toFixed(1)} KB gz`);
}
