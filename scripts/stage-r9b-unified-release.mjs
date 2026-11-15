/**
 * @file: scripts/stage-r9b-unified-release.mjs
 * @feature: relationships-r9b
 * @description: Deterministically stages an immutable unified R9B release (`r9b-v1.0`)
 * combining R8D grammatical (`r8-v1.1`), fixed R9A lexical/contextual (`r9a-v1.0-dev`),
 * and R4 Hebrew-Greek LXX bridge (`r4-lxx-v1.0`) under `.artifacts-r9b/staging/` without
 * rebuilding the 66-book R8D corpus or overwriting the live `r8-v1.1` release.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const REPO_ROOT = path.resolve('.');
const R8_DIR = path.join(REPO_ROOT, '.artifacts', 'static-corpus', 'v2', 'relationships', 'r8-v1.1');
const R9A_DIR = path.join(REPO_ROOT, '.artifacts-r9a');
const R4_DIR = path.join(REPO_ROOT, '.artifacts', 'r4-lxx-bridge');
const STAGE_ROOT = path.join(REPO_ROOT, '.artifacts-r9b', 'staging');
const RELEASE_VERSION = 'r9b-v1.0';
const RELEASE_DIR = path.join(STAGE_ROOT, 'v2', 'relationships', RELEASE_VERSION);

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readGzipJson(filePath) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8'));
}

function writeGzipJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const jsonStr = JSON.stringify(data);
  const compressed = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'), { level: 9 });
  fs.writeFileSync(filePath, compressed);
  return {
    bytes: compressed.length,
    uncompressed_bytes: Buffer.byteLength(jsonStr, 'utf8'),
    sha256: crypto.createHash('sha256').update(compressed).digest('hex'),
  };
}

function copyTreeFiltered(srcDir, dstDir, filterFn, baseRel = '') {
  const copied = [];
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Missing source directory: ${srcDir}`);
  }
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name;
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copied.push(...copyTreeFiltered(srcPath, dstPath, filterFn, rel));
    } else if (!filterFn || filterFn(rel)) {
      fs.copyFileSync(srcPath, dstPath);
      copied.push({
        rel,
        dstPath,
        bytes: fs.statSync(dstPath).size,
        sha256: sha256File(dstPath),
      });
    }
  }
  return copied;
}

export async function stageR9bUnifiedRelease() {
  const start = Date.now();
  console.log(`[R9B-STAGE] Staging immutable unified release ${RELEASE_VERSION}...`);

  const r8ManifestPath = path.join(R8_DIR, 'manifest.json.gz');
  const r9aManifestPath = path.join(R9A_DIR, 'manifest.json');
  const r4ManifestPath = path.join(R4_DIR, 'shards', 'manifest.json.gz');
  const r4LicensePath = path.join(R4_DIR, 'source_provenance_and_license_manifest.json');

  for (const reqPath of [r8ManifestPath, r9aManifestPath, r4ManifestPath, r4LicensePath]) {
    if (!fs.existsSync(reqPath)) {
      throw new Error(`Required prerequisite artifact missing: ${reqPath}`);
    }
  }

  const r8Manifest = readGzipJson(r8ManifestPath);
  const r9aManifest = JSON.parse(fs.readFileSync(r9aManifestPath, 'utf8'));
  const r9aLexRep = JSON.parse(fs.readFileSync(path.join(R9A_DIR, 'reports', 'lexical-coverage-report.json'), 'utf8'));
  const r9aCtxRep = JSON.parse(fs.readFileSync(path.join(R9A_DIR, 'reports', 'contextual-coverage-report.json'), 'utf8'));
  const r4Manifest = readGzipJson(r4ManifestPath);
  const r4License = JSON.parse(fs.readFileSync(r4LicensePath, 'utf8'));
  const r4MappingRep = JSON.parse(fs.readFileSync(path.join(R4_DIR, 'mapping_and_uncertainty_report.json'), 'utf8'));

  if (r8Manifest.sharding?.by_lemma_buckets !== 256) {
    throw new Error(`Unexpected R8D bucket count: ${r8Manifest.sharding?.by_lemma_buckets}`);
  }
  if (r9aManifest.sharding?.buckets !== 64 || r9aManifest.sharding?.hash_algorithm !== 'fnv1a64_hi32_mod64') {
    throw new Error(`Unexpected R9A sharding contract: ${JSON.stringify(r9aManifest.sharding)}`);
  }
  if (r4Manifest.sharding?.buckets !== 64 || r4Manifest.sharding?.hash_algorithm !== 'fnv1a64_hi32_mod64') {
    throw new Error(`Unexpected R4 sharding contract: ${JSON.stringify(r4Manifest.sharding)}`);
  }

  // Rebuild staged release directory cleanly without touching .artifacts/static-corpus/v2/relationships/r8-v1.1
  fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
  fs.mkdirSync(RELEASE_DIR, { recursive: true });

  const artifactChecksums = {
    'upstream/r8-v1.1/manifest.json.gz': {
      sha256: sha256File(r8ManifestPath),
      bytes: fs.statSync(r8ManifestPath).size,
    },
  };

  // Stage R9A Lexical shards + indexes
  const lexIdxFiles = copyTreeFiltered(
    path.join(R9A_DIR, 'indexes', 'sharded-lemma-index'),
    path.join(RELEASE_DIR, 'lexical', 'indexes', 'sharded-lemma-index'),
    rel => rel.endsWith('.json.gz')
  );
  const lexEdgeFiles = copyTreeFiltered(
    path.join(R9A_DIR, 'edges', 'sharded-edges'),
    path.join(RELEASE_DIR, 'lexical', 'edges', 'sharded-edges'),
    rel => rel.endsWith('.json.gz')
  );
  const r9aManifestGz = writeGzipJson(path.join(RELEASE_DIR, 'lexical', 'manifest.json.gz'), r9aManifest);
  artifactChecksums['lexical/manifest.json.gz'] = { sha256: r9aManifestGz.sha256, bytes: r9aManifestGz.bytes };
  for (const f of lexIdxFiles) {
    artifactChecksums[`lexical/indexes/sharded-lemma-index/${f.rel}`] = { sha256: f.sha256, bytes: f.bytes };
  }
  for (const f of lexEdgeFiles) {
    artifactChecksums[`lexical/edges/sharded-edges/${f.rel}`] = { sha256: f.sha256, bytes: f.bytes };
  }

  // Stage R9A Lossless Contextual shards + overflow pages
  const ctxTopFiles = copyTreeFiltered(
    path.join(R9A_DIR, 'contextual', 'sharded-contextual'),
    path.join(RELEASE_DIR, 'contextual', 'sharded-contextual'),
    rel => rel.endsWith('.json.gz')
  );
  const ctxPageFiles = copyTreeFiltered(
    path.join(R9A_DIR, 'contextual', 'pages'),
    path.join(RELEASE_DIR, 'contextual', 'pages'),
    rel => rel.endsWith('.json.gz')
  );
  for (const f of ctxTopFiles) {
    artifactChecksums[`contextual/sharded-contextual/${f.rel}`] = { sha256: f.sha256, bytes: f.bytes };
  }
  for (const f of ctxPageFiles) {
    artifactChecksums[`contextual/pages/${f.rel}`] = { sha256: f.sha256, bytes: f.bytes };
  }

  // Stage R4 LXX Translation Bridge shards + resolver + manifest
  const lxxFiles = copyTreeFiltered(
    path.join(R4_DIR, 'shards'),
    path.join(RELEASE_DIR, 'lxx'),
    rel => rel.endsWith('.json.gz')
  );
  for (const f of lxxFiles) {
    artifactChecksums[`lxx/${f.rel}`] = { sha256: f.sha256, bytes: f.bytes };
  }

  // Build unified manifest preserving R8D fields + explicit multi-layer routing contracts
  const unifiedManifest = {
    schema_version: '3.0',
    release_version: RELEASE_VERSION,
    rule_version: r8Manifest.rule_version || '1.2',
    generated_at: new Date().toISOString(),
    source_commits: {
      r8d_grammatical: 'e6d62c99352c641d5748a486b90c1b2cad47fc98',
      r9a_lexical_contextual: '9809c77a8b9044cc5d08a545560f4b019ecce378',
      r4_lxx_bridge: '805561d4f71ad755d8ef6d62049502c23295ef95',
    },
    dataset_versions: {
      grammatical: r8Manifest.release_version,
      lexical_contextual: r9aManifest.release_version,
      lxx_translation: r4Manifest.release_version,
    },
    canonical_registry_version: {
      canonical_lemmas: r9aLexRep.totals.canonical_lemmas,
      distinct_lexemes: r9aLexRep.totals.distinct_lexemes,
      lexical_senses: r9aLexRep.totals.lexical_senses,
      r8_index_lemmas: Object.keys(r8Manifest.sharding ? {} : {}).length || undefined,
      r8_counts: r8Manifest.counts,
    },
    // Preserve top-level R8D compatibility fields for existing handlers & scripts
    predicates: r8Manifest.predicates,
    counts: {
      ...r8Manifest.counts,
      lexical_edges: r9aLexRep.totals.lexical_edges_total,
      indexed_lexical_endpoints: r9aLexRep.totals.indexed_endpoints_total,
      contextual_pairs: r9aCtxRep.totals.distinct_co_occurring_pairs,
      contextual_directed_records: r9aCtxRep.totals.lossless_directed_neighbor_records,
      contextual_overflow_page_shards: r9aCtxRep.totals.overflow_page_shards,
      lxx_translation_edges: r4MappingRep.distinct_counts.materialized_edges,
      lxx_hebrew_lemmas: r4MappingRep.distinct_counts.hebrew_canonical_lemmas,
      lxx_greek_lemmas: r4MappingRep.distinct_counts.greek_canonical_lemmas,
    },
    sharding: r8Manifest.sharding,
    // Explicit versioned layer routing contracts (never assume single hash algorithm)
    layers: {
      grammatical: {
        schema_version: '2.0',
        release_version: r8Manifest.release_version,
        base_dir: `/v2/relationships/${r8Manifest.release_version}`,
        hash_algorithm: 'fnv1a64_mod256',
        hash_input_normalization: 'canonical_lemma_key_utf16_exact',
        buckets: r8Manifest.sharding.by_lemma_buckets,
        shard_path_formats: {
          resolver: 'resolver-index.json.gz',
          uncovered_lemmas: 'uncovered-lemmas.json.gz',
          by_lemma: 'by-lemma/shard-{hex2}.json.gz',
          evidence_by_summary: 'evidence/by-summary/shard-{hex2}.json.gz',
          passages_by_chapter: 'passages/b{book}-c{chapter}.json.gz',
        },
        coverage_limits: 'Syntax grammatical frames cover OT MACULA WLC + NT Nestle1904/SBLGNT annotated verses.',
      },
      lexical: {
        schema_version: r9aManifest.schema_version,
        release_version: r9aManifest.release_version,
        base_dir: `/v2/relationships/${RELEASE_VERSION}/lexical`,
        hash_algorithm: r9aManifest.sharding.hash_algorithm,
        hash_input_normalization: r9aManifest.sharding.hash_input_normalization,
        buckets: r9aManifest.sharding.buckets,
        shard_path_formats: r9aManifest.sharding.shard_path_formats,
        coverage_limits: 'Attested lexical sense subdivisions, roots/derivations/cognates, morphological compounds, and documented wordplay/orthography.',
      },
      contextual: {
        schema_version: r9aManifest.schema_version,
        release_version: r9aManifest.release_version,
        base_dir: `/v2/relationships/${RELEASE_VERSION}/contextual`,
        hash_algorithm: r9aManifest.sharding.hash_algorithm,
        hash_input_normalization: r9aManifest.sharding.hash_input_normalization,
        buckets: r9aManifest.sharding.buckets,
        top_limit: r9aManifest.sharding.contextual_top_limit,
        page_chunk_size: r9aManifest.sharding.contextual_page_chunk_size,
        shard_path_formats: {
          contextual_neighbors: 'sharded-contextual/shard-{hex2}.json.gz',
          contextual_overflow_pages: 'pages/shard-{hex2}-p{pad3}.json.gz',
        },
        coverage_limits: 'MACULA tree leaf clauses only (WLC ed 11 + Nestle1904 ed 18); proximity never proves synonymy, grammar, or causality.',
      },
      lxx_translation: {
        schema_version: r4Manifest.sharding.schema_version,
        release_version: r4Manifest.release_version,
        base_dir: `/v2/relationships/${RELEASE_VERSION}/lxx`,
        hash_algorithm: r4Manifest.sharding.hash_algorithm,
        hash_input_normalization: r4Manifest.sharding.hash_input_normalization,
        buckets: r4Manifest.sharding.buckets,
        shard_path_formats: {
          by_hebrew_lemma: 'by-hebrew-lemma/shard-{hex2}.json.gz',
          by_greek_lemma: 'by-greek-lemma/shard-{hex2}.json.gz',
          resolver_index: 'resolver-index.json.gz',
          manifest: 'manifest.json.gz',
        },
        coverage_limits: 'Attested LXX Hebrew->Greek frequency table (published_count >= 3, 3,301 pairs); translation candidate only, not token alignment or NT synonymy.',
      },
    },
    licensing: {
      grammatical: 'MACULA Hebrew/Greek (CC BY 4.0)',
      lexical_contextual: r9aLexRep.licensing,
      lxx_translation: r4License.license,
      excluded_restricted_fields: ['tbesh_column_7_meaning', 's21_fields', 'ubs_marble', 'louw_nida', 'sdbh'],
    },
    staged_file_count: Object.keys(artifactChecksums).length,
    artifact_checksums: artifactChecksums,
  };

  const uManifestGz = writeGzipJson(path.join(RELEASE_DIR, 'manifest.json.gz'), unifiedManifest);
  fs.writeFileSync(path.join(RELEASE_DIR, 'manifest.json'), JSON.stringify(unifiedManifest, null, 2));

  // Write staged pointer (never touching live .artifacts/static-corpus/v2/relationships/active.json.gz)
  const stagedActive = {
    schema_version: '3.0',
    active_release: RELEASE_VERSION,
    fallback_release: r8Manifest.release_version,
    manifest_path: `/v2/relationships/${RELEASE_VERSION}/manifest.json.gz`,
    manifest_sha256: uManifestGz.sha256,
    staged_at: unifiedManifest.generated_at,
    production_activated: false,
  };
  writeGzipJson(path.join(STAGE_ROOT, 'v2', 'relationships', 'active.json.gz'), stagedActive);

  const duration = Date.now() - start;
  console.log(`[R9B-STAGE] Staged ${RELEASE_VERSION} in ${duration}ms: ${Object.keys(artifactChecksums).length} verified assets (manifest sha256: ${uManifestGz.sha256.slice(0, 12)}...).`);
  console.log(`[R9B-STAGE] Live release untouched at .artifacts/static-corpus/v2/relationships/r8-v1.1.`);
  return { release_version: RELEASE_VERSION, staged_files: Object.keys(artifactChecksums).length, duration_ms: duration };
}

if (process.argv[1] && path.basename(process.argv[1]).includes('stage-r9b-unified-release')) {
  stageR9bUnifiedRelease().catch(err => {
    console.error('[R9B-STAGE] FAILED:', err);
    process.exit(1);
  });
}
