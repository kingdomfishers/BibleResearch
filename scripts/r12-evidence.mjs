/** R12 offline compiler support. D1.1 inventories/validates sources only; no builds on import. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';

export async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function readJson(file) {
  const raw = fs.readFileSync(file);
  return JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8'));
}

export function* walkFiles(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.name === '.git') continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(file);
    else if (entry.isFile()) yield file;
    else throw new Error(`Unsupported source entry (no implicit symlink traversal): ${file}`);
  }
}

/** Hash file bytes incrementally, keeping only metadata, never a corpus in memory. */
export async function inventoryRoot(root, kind) {
  root = fs.realpathSync(root);
  const files = [];
  const paths = fs.statSync(root).isFile() ? [root] : walkFiles(root);
  for (const file of paths) {
    files.push({ path: file, bytes: fs.statSync(file).size, sha256: await hashFile(file) });
  }
  if (!files.length) throw new Error(`Empty required source: ${root}`);
  const digest = crypto.createHash('sha256');
  for (const file of files) digest.update(`${path.relative(root, file.path).replaceAll('\\', '/')}\0${file.sha256}\n`);
  return { root, kind, files, file_count: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), sha256: digest.digest('hex') };
}

export async function validateInventory(inventory) {
  for (const source of inventory.sources) {
    if (!source.files.length || source.file_count !== source.files.length) throw new Error(`Invalid inventory: ${source.root}`);
    const actualPaths = fs.statSync(source.root).isFile() ? [source.root] : [...walkFiles(source.root)];
    if (actualPaths.length !== source.files.length || actualPaths.some((file, i) => file !== source.files[i].path)) {
      throw new Error(`Source membership changed: ${source.root}`);
    }
    const digest = crypto.createHash('sha256');
    for (const file of source.files) {
      const relative = path.relative(source.root, file.path);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Source path escapes root: ${file.path}`);
      if (fs.statSync(file.path).size !== file.bytes || await hashFile(file.path) !== file.sha256) {
        throw new Error(`Source changed: ${file.path}`);
      }
      digest.update(`${relative.replaceAll('\\', '/')}\0${file.sha256}\n`);
    }
    if (digest.digest('hex') !== source.sha256) throw new Error(`Inventory digest changed: ${source.root}`);
  }
}

export async function scanJsonLines(file, visit) {
  const input = fs.createReadStream(file);
  const decoded = file.endsWith('.gz') ? input.pipe(zlib.createGunzip()) : input;
  // Propagate source/decompression failures instead of hanging or accepting partial coverage.
  input.on('error', error => decoded.destroy(error));
  const lines = readline.createInterface({ input: decoded, crlfDelay: Infinity });
  let count = 0;
  try {
    for await (const line of lines) if (line.trim()) { visit(JSON.parse(line)); count++; }
  } finally { lines.close(); decoded.destroy(); input.destroy(); }
  return count;
}

export function fixtureLedger(document) {
  if (document.total_cases !== 157 || document.fixtures?.length !== 157) throw new Error('Expected original 157 fixtures');
  const ids = new Set();
  return document.fixtures.map(fixture => {
    if (!fixture.id || ids.has(fixture.id)) throw new Error(`Missing/duplicate fixture ID: ${fixture.id}`);
    ids.add(fixture.id);
    return { id: fixture.id, query: fixture.query, category: fixture.category, status: 'not-run',
      reason: 'Semantic acceptance labels are not independently reviewed; D1.4 owns gold contracts. Historical traces are observations, not passes.',
      historical_trace_available: fixture.observed_r11_local !== null && fixture.observed_r11_local !== undefined };
  });
}

function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim(); }

export async function freezeSourceInventory(root) {
  const sibling = path.resolve(root, '../BibleResearch');
  const bundle = path.join(root, '.artifacts-r10/deploy-bundle');
  const corpus = path.join(root, '.artifacts/static-corpus');
  const sourceTrees = path.join(sibling, '.artifacts/sources');
  const scaled = path.join(sibling, '.artifacts/relationships-scaled');
  const audit = path.join(sibling, 'R11_DEEP_RESEARCH_HANDOFF.md');
  const fixtures = path.join(sibling, 'R11_RESEARCH_FIXTURES.json');
  const roots = [
    [bundle, 'combined_local_bundle'], [path.join(corpus, 'tables'), 'static_tables'],
    [path.join(corpus, 'manifest.json'), 'static_manifest'],
    [path.join(corpus, 'v2/relationships'), 'r8_regression_assets'],
    [path.join(scaled, 'frames.jsonl'), 'r8_frames'],
    [path.join(scaled, 'occurrence-relations.jsonl'), 'r8_occurrence_relations'],
    [path.join(scaled, 'manifest.json'), 'r8_build_manifest'],
    [path.resolve(root, '../BibleResearch-r9b/.artifacts-r9b/staging'), 'r9c_regression_staging'],
    [path.join(sibling, '.artifacts/static-corpus/v2/relationships'), 'r9c_regression_grammar'],
    [path.join(sourceTrees, 'macula-hebrew'), 'macula_hebrew_tree'],
    [path.join(sourceTrees, 'macula-greek'), 'macula_greek_tree'],
    [path.join(root, '.artifacts-r10/sources/bible-cross-references'), 'cross_reference_source'],
    [path.join(root, 'data/sources/bcv-lxx-bridge'), 'lxx_bridge_source'],
    [path.resolve(root, '../BibleResearch-r4/.artifacts/r4-lxx-bridge/source_provenance_and_license_manifest.json'), 'lxx_bridge_rights'],
    [path.join(root, 'third_party/bibleontology'), 'reused_extractor_and_notices'],
    [path.join(root, 'src/relationships'), 'runtime_code'],
    ...['corpus-relationships-rpc.mjs', 'r12-evidence.mjs', 'verify-r12-discovery.mjs'].map(p => [path.join(root, 'scripts', p), 'harness_or_adapter']),
    [audit, 'audit'], [fixtures, 'fixtures'],
    ...['DATA_SOURCES.md', 'PROVENANCE.md', 'package-lock.json', 'RELATIONSHIP_ARCHITECTURE.md'].map(p => [path.join(root, p), 'contract_or_pin']),
  ];
  const sources = [];
  for (const [source, kind] of roots) {
    console.log(`[R12 inventory] ${kind}: ${source}`);
    sources.push(await inventoryRoot(source, kind));
  }
  const r8 = readJson(path.join(bundle, 'v2/relationships/r8-v1.1/manifest.json.gz'));
  const r9b = readJson(path.join(bundle, 'v2/relationships/r9b-v1.0/manifest.json.gz'));
  const r11 = readJson(path.join(bundle, 'v2/relationships/r11-v1.0/manifest.json'));
  const staticManifest = readJson(path.join(corpus, 'manifest.json'));
  const editions = new Set();
  const frames = await scanJsonLines(path.join(scaled, 'frames.jsonl'), row => {
    if (!row.source?.edition) throw new Error('Frame without source edition');
    editions.add(row.source.edition);
  });
  const occurrenceRelations = await scanJsonLines(path.join(scaled, 'occurrence-relations.jsonl'), () => {});
  let lexicalRecords = 0, xrefPairs = 0;
  const lexicalIds = new Set();
  for (const file of walkFiles(path.join(bundle, 'v2/relationships/r9b-v1.0/lexical/edges/sharded-edges'))) {
    for (const id of Object.keys(readJson(file).edges_by_id)) {
      lexicalRecords++;
      lexicalIds.add(id);
    }
  }
  for (const file of walkFiles(path.join(bundle, 'v2/relationships/r11-v1.0/r10/xrefs'))) {
    for (const verse of Object.values(readJson(file).by_verse)) {
      for (const outgoing of verse.out) xrefPairs += outgoing.targets.length;
    }
  }
  const reconciliation = [
    ['r8_frames', frames, 150522, r8.counts.frames_emitted],
    ['r8_occurrence_relations', occurrenceRelations, 124312, r8.counts.occurrence_relations_emitted],
    ['r9_lexical_edges', lexicalIds.size, 14469, r9b.counts.lexical_edges],
    ['r11_xref_pairs', xrefPairs, 305628, r11.counts.xref_links],
  ].map(([metric, actual, auditExpected, manifestExpected]) => ({ metric, actual, audit_expected: auditExpected,
    manifest_expected: manifestExpected, delta_from_audit: actual - auditExpected,
    explanation: actual === auditExpected ? 'Actual record recount agrees with audit.' : 'Local source differs from audit; retain actual count, no regeneration.' }));
  const ledger = fixtureLedger(readJson(fixtures));
  return {
    schema_version: 'r12-inputs-v1', generated_at: new Date().toISOString(), root: fs.realpathSync(root),
    git: { branch: git(root, 'branch', '--show-current'), head: git(root, 'rev-parse', 'HEAD'), status: git(root, 'status', '--porcelain') },
    runtime: { node: process.version, platform: process.platform, arch: process.arch,
      packages: Object.fromEntries(['typescript', 'wrangler', 'workerd'].map(name => {
        const file = path.join(root, 'node_modules', name, 'package.json');
        return [name, fs.existsSync(file) ? readJson(file).version : 'unavailable'];
      })) },
    roots: { bundle, corpus, source_trees: sourceTrees, r8_build: scaled, fixtures, audit,
      r9b_regression_staging: path.resolve(root, '../BibleResearch-r9b/.artifacts-r9b/staging'),
      r9c_regression_corpus: path.join(sibling, '.artifacts/static-corpus') },
    releases: { r8: r8.release_version, r9b: r9b.release_version, r11: r11.release_id,
      source_pins: r8.source_releases, upstream_bibleontology_commit: r8.upstream_bibleontology_commit },
    rights: { source_manifest: staticManifest.licenses_and_provenance, r11_manifest: r11.licenses,
      restricted_fields_excluded: staticManifest.restricted_fields_excluded,
      notices: sources.flatMap(source => source.files.filter(file => /license|licensing|notice|provenance/i.test(path.basename(file.path)))),
      decision: 'Inventory only; no permission to republish fields. Preserve per-source notices. Swete derived-source CC BY-SA in static manifest takes precedence over R11 public-domain shorthand.' },
    coverage: { editions: [...editions].sort(), distinct_editions: editions.size,
      lexical_shard_records: lexicalRecords, lexical_unique_edge_ids: lexicalIds.size,
      lexical_reconciliation: `${lexicalRecords} shard records contain ${lexicalIds.size} distinct edge IDs; ${lexicalRecords - lexicalIds.size} repeated endpoint-bucket records are not independent edges.`,
      static_tables: Object.fromEntries(Object.entries(staticManifest.tables).map(([name, value]) => [name, { declared_rows: value.total_rows, declared_shards: value.shard_count }])),
      syntax: staticManifest.macula_syntax_completion, reconciliation },
    fixture_ledger: ledger, sources,
  };
}
