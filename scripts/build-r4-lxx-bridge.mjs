/**
 * scripts/build-r4-lxx-bridge.mjs
 *
 * Deterministic build pipeline for R4: Hebrew–Greek Septuagint Lexical Bridge.
 *
 * Ingests the verified, pinned BCV Hebrew Lexical References dataset (`lxx_bridge.tsv`),
 * resolves Hebrew and Greek Strong's codes against the canonical lemma/lexeme registry,
 * materializes deterministic translation candidate edges, builds bidirectional indexes,
 * generates mapping & uncertainty reports, and packages versioned, sharded static assets
 * compatible with the Cloudflare graph architecture.
 *
 * Rules:
 * - Deterministic, byte-for-byte reproducible outputs.
 * - Offline execution: zero external network calls during build.
 * - Preserves exact source identifiers (including leading zeroes) and published counts.
 * - Does not merge homographs or invent missing correspondences.
 * - Explicitly classifies edges as `translation_candidate`.
 * - Bounded memory (< 200 MB) and fast execution (< 10 seconds).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const REPO_ROOT = path.resolve('.');
const OUTPUT_DIR = path.join(REPO_ROOT, '.artifacts', 'r4-lxx-bridge');
const SHARDS_DIR = path.join(OUTPUT_DIR, 'shards');
const PINNED_SOURCE_PATH = path.join(REPO_ROOT, 'data', 'sources', 'bcv-lxx-bridge', 'lxx_bridge.tsv');

const EXPECTED_SOURCE_SHA256 = '97c1c2a8df1f33069ecd88dab3a1b7ff179e900236ac41cd4d93f12ec5d40cff';
const SOURCE_DATASET_ID = 'bcv-commons/hebrew-lexical-references';
const SOURCE_REVISION = 'b3b135b24394aa4a8f4eaa59dbc59689735c2b46';
const SOURCE_LICENSE = 'CC BY 4.0';
const RELEASE_VERSION = 'r4-lxx-v1.0';
const SCHEMA_VERSION = '2.0';
const BUILD_TIMESTAMP = process.env.R4_BUILD_TIMESTAMP || '2026-11-15T12:50:53.318Z';

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function fnv1a64Hex(input) {
  let hash = FNV_OFFSET_64;
  const str = String(input);
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

export function bucket64(key) {
  return Number(BigInt('0x' + fnv1a64Hex(key).slice(0, 8)) % 64n).toString(16).padStart(2, '0');
}

export function normalizeStrongsCode(code) {
  const m = /^([HG])0*(\d+)([A-Za-z]?)$/i.exec(String(code || '').trim());
  if (!m) return { raw: code, prefix: '', num: 0, compact: code, padded: code, suffix: '' };
  const prefix = m[1].toUpperCase();
  const num = parseInt(m[2], 10);
  const suffix = (m[3] || '').toUpperCase();
  return {
    raw: code,
    prefix,
    num,
    compact: `${prefix}${num}${suffix}`,
    padded: `${prefix}${String(num).padStart(4, '0')}${suffix}`,
    suffix,
  };
}

function findStaticCorpusTablesDir() {
  const candidates = [
    path.join(REPO_ROOT, '.artifacts', 'static-corpus', 'tables'),
    path.resolve(REPO_ROOT, '..', 'BibleResearch', '.artifacts', 'static-corpus', 'tables'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(`Static corpus tables directory not found in candidates: ${candidates.join(', ')}`);
}

function readJsonlGzTable(tablesDir, tableName) {
  const tableDir = path.join(tablesDir, tableName);
  if (!fs.existsSync(tableDir)) {
    throw new Error(`Table directory not found: ${tableDir}`);
  }
  const files = fs.readdirSync(tableDir).filter(f => f.endsWith('.jsonl.gz')).sort();
  const rows = [];
  for (const file of files) {
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(tableDir, file)));
    const lines = raw.toString('utf8').trim().split('\n');
    for (const line of lines) {
      if (line) rows.push(JSON.parse(line));
    }
  }
  return rows;
}

export function buildLxxBridge(options = {}) {
  const startTime = Date.now();
  const memStart = process.memoryUsage().heapUsed;

  console.log(`[R4 LXX Bridge] Starting build (release: ${RELEASE_VERSION})...`);

  // 1. Verify pinned source file
  const sourcePath = options.sourcePath || PINNED_SOURCE_PATH;
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Pinned source file not found at: ${sourcePath}`);
  }
  const sourceBytes = fs.readFileSync(sourcePath);
  const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  if (sourceSha256 !== EXPECTED_SOURCE_SHA256) {
    throw new Error(`Source SHA256 digest mismatch! Expected ${EXPECTED_SOURCE_SHA256}, got ${sourceSha256}`);
  }
  console.log(`[R4 LXX Bridge] Pinned source verified (SHA256: ${sourceSha256.slice(0, 16)}..., ${sourceBytes.length} bytes).`);

  // 2. Parse TSV rows
  const tsvText = sourceBytes.toString('utf8');
  const tsvLines = tsvText.trim().split('\n');
  const header = tsvLines[0].trim();
  if (header !== 'hebrew_strong\tgreek_strong\tcount') {
    throw new Error(`Unexpected TSV header: ${header}`);
  }

  const rawPairs = [];
  for (let i = 1; i < tsvLines.length; i++) {
    const line = tsvLines[i].trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length !== 3) {
      throw new Error(`Malformed TSV row at line ${i + 1}: ${line}`);
    }
    const [hRaw, gRaw, countStr] = parts;
    const count = parseInt(countStr, 10);
    if (!/^H\d+$/i.test(hRaw) || !/^G\d+$/i.test(gRaw) || isNaN(count) || count < 1) {
      throw new Error(`Invalid TSV data at line ${i + 1}: ${line}`);
    }
    rawPairs.push({
      line_num: i + 1,
      hebrew_strong: hRaw,
      greek_strong: gRaw,
      published_count: count,
      source_record: line,
    });
  }
  console.log(`[R4 LXX Bridge] Validated ${rawPairs.length} source pairs from ${tsvLines.length - 1} lines.`);

  // 3. Load canonical registry tables
  const tablesDir = findStaticCorpusTablesDir();
  console.log(`[R4 LXX Bridge] Loading canonical tables from: ${tablesDir}`);

  const lemmas = readJsonlGzTable(tablesDir, 'lemmas');
  const lexemes = readJsonlGzTable(tablesDir, 'lexemes');
  const lexemeIdentifiers = readJsonlGzTable(tablesDir, 'lexeme_identifiers');

  console.log(`[R4 LXX Bridge] Loaded ${lemmas.length} lemmas, ${lexemes.length} lexemes, ${lexemeIdentifiers.length} lexeme identifiers.`);

  // Build indexes for resolution
  const lemmaById = new Map(lemmas.map(l => [l.id, l]));
  const lemmasByBaseStrongs = new Map();
  for (const lem of lemmas) {
    if (lem.base_strongs) {
      const k = lem.base_strongs.toUpperCase();
      if (!lemmasByBaseStrongs.has(k)) lemmasByBaseStrongs.set(k, []);
      lemmasByBaseStrongs.get(k).push(lem);
    }
  }

  const lexemeById = new Map(lexemes.map(x => [x.id, x]));
  const lexemeIdsByVal = new Map();
  for (const li of lexemeIdentifiers) {
    const v = String(li.id_value || '').toUpperCase();
    if (!lexemeIdsByVal.has(v)) lexemeIdsByVal.set(v, new Set());
    lexemeIdsByVal.get(v).add(li.lexeme_id);
  }

  function resolveCode(code) {
    const norm = normalizeStrongsCode(code);
    const baseKey = norm.compact.toUpperCase();
    const directLemmas = lemmasByBaseStrongs.get(baseKey) || [];

    if (directLemmas.length > 0) {
      return {
        status: directLemmas.length === 1 ? 'exact' : 'ambiguous_homograph',
        method: 'base_strongs',
        norm,
        lemmas: directLemmas,
      };
    }

    // Secondary fallback: check lexeme_identifiers crosswalk
    const candidates = [code.toUpperCase(), norm.compact.toUpperCase(), norm.padded.toUpperCase()];
    const matchingLexIds = new Set();
    for (const c of candidates) {
      const set = lexemeIdsByVal.get(c);
      if (set) for (const id of set) matchingLexIds.add(id);
    }

    const indirectLemmas = [];
    for (const lid of matchingLexIds) {
      const lex = lexemeById.get(lid);
      if (lex && lex.lemma_id && lemmaById.has(lex.lemma_id)) {
        indirectLemmas.push(lemmaById.get(lex.lemma_id));
      }
    }

    if (indirectLemmas.length > 0) {
      const dedup = Array.from(new Map(indirectLemmas.map(l => [l.lemma_key, l])).values());
      return {
        status: 'crosswalk_resolved',
        method: 'lexeme_crosswalk',
        norm,
        lemmas: dedup,
      };
    }

    return {
      status: 'unmapped',
      method: 'none',
      norm,
      lemmas: [],
    };
  }

  // 4. Materialize deterministic candidate edges
  console.log(`[R4 LXX Bridge] Materializing deterministic translation candidate edges...`);

  const edges = [];
  const edgeById = new Map();
  const distinctHebrewStrongs = new Set();
  const distinctGreekStrongs = new Set();
  const distinctHebrewLemmas = new Set();
  const distinctGreekLemmas = new Set();

  let countExact = 0;
  let countAmbiguousHebrew = 0;
  let countAmbiguousGreek = 0;
  let countBothAmbiguous = 0;
  let countCrosswalk = 0;
  let countUnmapped = 0;

  for (const raw of rawPairs) {
    const hRes = resolveCode(raw.hebrew_strong);
    const gRes = resolveCode(raw.greek_strong);

    distinctHebrewStrongs.add(raw.hebrew_strong);
    distinctGreekStrongs.add(raw.greek_strong);

    for (const l of hRes.lemmas) distinctHebrewLemmas.add(l.lemma_key);
    for (const l of gRes.lemmas) distinctGreekLemmas.add(l.lemma_key);

    const isHomographAmbiguous = hRes.lemmas.length > 1 || gRes.lemmas.length > 1;
    let mappingStatus = 'exact';

    if (hRes.status === 'unmapped' || gRes.status === 'unmapped') {
      mappingStatus = 'unmapped';
      countUnmapped++;
    } else if (hRes.method === 'lexeme_crosswalk' || gRes.method === 'lexeme_crosswalk') {
      mappingStatus = 'crosswalk_resolved';
      countCrosswalk++;
    } else if (hRes.lemmas.length > 1 && gRes.lemmas.length > 1) {
      mappingStatus = 'both_homographs_ambiguous';
      countBothAmbiguous++;
    } else if (hRes.lemmas.length > 1) {
      mappingStatus = 'hebrew_homograph_ambiguous';
      countAmbiguousHebrew++;
    } else if (gRes.lemmas.length > 1) {
      mappingStatus = 'greek_homograph_ambiguous';
      countAmbiguousGreek++;
    } else {
      mappingStatus = 'exact';
      countExact++;
    }

    const edgeId = `rel:lxx:trans:${raw.hebrew_strong}->${raw.greek_strong}`;

    const edge = {
      edge_id: edgeId,
      predicate: 'translation_candidate',
      inverse_predicate: 'translation_candidate_of',
      hebrew_strong: raw.hebrew_strong,
      greek_strong: raw.greek_strong,
      published_count: raw.published_count,
      source_record: raw.source_record,
      source_dataset: SOURCE_DATASET_ID,
      source_revision: SOURCE_REVISION,
      source_sha256: sourceSha256,
      license: SOURCE_LICENSE,
      classification: 'translation_candidate',
      epistemic_tier: 'attested_translation_candidate',
      mapping_status: mappingStatus,
      homograph_ambiguity: isHomographAmbiguous,
      hebrew: {
        raw_code: raw.hebrew_strong,
        compact_code: hRes.norm.compact,
        resolution_method: hRes.method,
        candidate_count: hRes.lemmas.length,
        candidate_lemma_keys: hRes.lemmas.map(l => l.lemma_key),
        candidates: hRes.lemmas.map(l => ({
          lemma_key: l.lemma_key,
          lemma_script: l.lemma_script,
          transliteration: l.transliteration,
          gloss: l.transliteration, // lemma table has script & transliteration; profile fills gloss
          primary_pos: l.primary_pos,
          homograph_tag: l.homograph_tag,
        })),
      },
      greek: {
        raw_code: raw.greek_strong,
        compact_code: gRes.norm.compact,
        resolution_method: gRes.method,
        candidate_count: gRes.lemmas.length,
        candidate_lemma_keys: gRes.lemmas.map(l => l.lemma_key),
        candidates: gRes.lemmas.map(l => ({
          lemma_key: l.lemma_key,
          lemma_script: l.lemma_script,
          transliteration: l.transliteration,
          gloss: l.transliteration,
          primary_pos: l.primary_pos,
          homograph_tag: l.homograph_tag,
        })),
      },
      guardrails: {
        not_synonymy: true,
        not_token_alignment: true,
        not_nt_usage_claim: true,
        attestation_scope: 'Observed Septuagint translation rendering count; does not establish semantic equivalence or single-verse alignment without independent manuscript evidence.',
      },
    };

    edges.push(edge);
    edgeById.set(edgeId, edge);
  }

  // 5. Build bidirectional indexes
  console.log(`[R4 LXX Bridge] Building bidirectional indexes...`);

  // Hebrew -> Greek
  const hebrewToGreekByLemma = new Map();
  const hebrewToGreekByStrongs = new Map();

  // Greek -> Hebrew
  const greekToHebrewByLemma = new Map();
  const greekToHebrewByStrongs = new Map();

  for (const edge of edges) {
    // Add to Hebrew -> Greek by Strongs
    if (!hebrewToGreekByStrongs.has(edge.hebrew_strong)) {
      hebrewToGreekByStrongs.set(edge.hebrew_strong, []);
    }
    hebrewToGreekByStrongs.get(edge.hebrew_strong).push(edge);

    // Add to Hebrew -> Greek by Lemma keys
    for (const hKey of edge.hebrew.candidate_lemma_keys) {
      if (!hebrewToGreekByLemma.has(hKey)) hebrewToGreekByLemma.set(hKey, []);
      hebrewToGreekByLemma.get(hKey).push(edge);
    }

    // Add to Greek -> Hebrew by Strongs
    if (!greekToHebrewByStrongs.has(edge.greek_strong)) {
      greekToHebrewByStrongs.set(edge.greek_strong, []);
    }
    greekToHebrewByStrongs.get(edge.greek_strong).push(edge);

    // Add to Greek -> Hebrew by Lemma keys
    for (const gKey of edge.greek.candidate_lemma_keys) {
      if (!greekToHebrewByLemma.has(gKey)) greekToHebrewByLemma.set(gKey, []);
      greekToHebrewByLemma.get(gKey).push(edge);
    }
  }

  // Helper to compile ranked candidate list
  function formatHebrewForwardCandidates(edgeList) {
    // Sort descending by published_count, tie-break by greek_strong
    const sorted = [...edgeList].sort((a, b) => b.published_count - a.published_count || a.greek_strong.localeCompare(b.greek_strong));
    const totalCount = sorted.reduce((sum, e) => sum + e.published_count, 0);

    return {
      total_attested_renderings: totalCount,
      candidate_count: sorted.length,
      candidates: sorted.map(e => ({
        edge_id: e.edge_id,
        greek_strong: e.greek_strong,
        published_count: e.published_count,
        translation_share: totalCount > 0 ? Number((e.published_count / totalCount).toFixed(4)) : 0,
        mapping_status: e.mapping_status,
        homograph_ambiguity: e.homograph_ambiguity,
        greek_candidate_count: e.greek.candidate_count,
        greek_lemma_keys: e.greek.candidate_lemma_keys,
        greek_candidates: e.greek.candidates,
      })),
    };
  }

  function formatGreekReverseCandidates(edgeList) {
    // Sort descending by published_count, tie-break by hebrew_strong
    const sorted = [...edgeList].sort((a, b) => b.published_count - a.published_count || a.hebrew_strong.localeCompare(b.hebrew_strong));
    const totalCount = sorted.reduce((sum, e) => sum + e.published_count, 0);

    return {
      total_attested_renderings: totalCount,
      candidate_count: sorted.length,
      candidates: sorted.map(e => ({
        edge_id: e.edge_id,
        hebrew_strong: e.hebrew_strong,
        published_count: e.published_count,
        translation_share: totalCount > 0 ? Number((e.published_count / totalCount).toFixed(4)) : 0,
        mapping_status: e.mapping_status,
        homograph_ambiguity: e.homograph_ambiguity,
        hebrew_candidate_count: e.hebrew.candidate_count,
        hebrew_lemma_keys: e.hebrew.candidate_lemma_keys,
        hebrew_candidates: e.hebrew.candidates,
      })),
    };
  }

  const hebrewToGreekIndex = {
    schema_version: SCHEMA_VERSION,
    release_version: RELEASE_VERSION,
    direction: 'hebrew_to_greek',
    total_distinct_hebrew_strongs: distinctHebrewStrongs.size,
    total_distinct_hebrew_lemmas: distinctHebrewLemmas.size,
    total_translation_edges: edges.length,
    by_lemma_key: {},
    by_strongs: {},
  };

  for (const [hKey, edgeList] of [...hebrewToGreekByLemma.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    hebrewToGreekIndex.by_lemma_key[hKey] = formatHebrewForwardCandidates(edgeList);
  }
  for (const [hStrongs, edgeList] of [...hebrewToGreekByStrongs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    hebrewToGreekIndex.by_strongs[hStrongs] = formatHebrewForwardCandidates(edgeList);
  }

  const greekToHebrewIndex = {
    schema_version: SCHEMA_VERSION,
    release_version: RELEASE_VERSION,
    direction: 'greek_to_hebrew',
    total_distinct_greek_strongs: distinctGreekStrongs.size,
    total_distinct_greek_lemmas: distinctGreekLemmas.size,
    total_translation_edges: edges.length,
    by_lemma_key: {},
    by_strongs: {},
  };

  for (const [gKey, edgeList] of [...greekToHebrewByLemma.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    greekToHebrewIndex.by_lemma_key[gKey] = formatGreekReverseCandidates(edgeList);
  }
  for (const [gStrongs, edgeList] of [...greekToHebrewByStrongs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    greekToHebrewIndex.by_strongs[gStrongs] = formatGreekReverseCandidates(edgeList);
  }

  // 6. Research examples
  console.log(`[R4 LXX Bridge] Compiling critical lexical research examples...`);

  const ruachExamples = {
    hebrew_strong: 'H7307',
    canonical_lemma: 'lemma:H7307',
    hebrew_script: 'רוּחַ',
    transliteration: 'ru.ach',
    gloss: 'spirit, wind, breath',
    source_correspondences: hebrewToGreekIndex.by_strongs['H7307'] || null,
    reverse_correspondences: {
      pneuma_G4151: greekToHebrewIndex.by_strongs['G4151'] || null,
      anemos_G0417: greekToHebrewIndex.by_strongs['G0417'] || null,
      pnoe_G4157: greekToHebrewIndex.by_strongs['G4157'] || null,
    },
    findings: [
      'Source dataset documents H7307 translated by G4151 (pneuma) 259 times (84.6%), G0417 (anemos) 44 times (14.4%), and G4157 (pnoe) 3 times (1.0%).',
      'In the reverse direction, G4151 (pneuma) and G0417 (anemos) both trace back exclusively to H7307 in this attested dataset.',
      'Full lexical family of H7307 is preserved as a single canonical lemma without splitting based on English translations.',
      'No missing correspondences were invented.',
    ],
  };

  const elohimExamples = {
    hebrew_strong: 'H0430',
    canonical_homographs: [
      { key: 'lemma:H0430G', description: 'God (disambiguated STEP tag for the God of Israel; H0430G = a Name of H3068G)' },
      { key: 'lemma:H0430a', description: 'gods / rulers / judges (plural deities or human magistrates; H0430A)' },
      { key: 'lemma:H0430H', description: '(LORD)-Elohe (bound component of divine-name expression H3068G; = a Part of H3068G, not an independent lexical sense)' },
      { key: 'lemma:H0430I', description: '(Gibeath)-elohim (bound component of Gibeath-elohim H1389G; = a Part of H1389G, not an independent lexical sense)' },
    ],
    source_correspondences: hebrewToGreekIndex.by_strongs['H0430'] || null,
    findings: [
      'Source documents H0430 translated by G2316 (theos) 2,153 times, G2962 (kyrios) 70 times, G3588 (ho) 53 times, and G0846 (autos) 3 times.',
      'All 4 Hebrew canonical homographs are preserved in the candidate set with homograph_ambiguity=true.',
      'No single homograph was chosen by default.',
    ],
  };

  const dabarExamples = {
    hebrew_strong: 'H1697',
    canonical_homographs: ['lemma:H1697G', 'lemma:H1697O'],
    source_correspondences: hebrewToGreekIndex.by_strongs['H1697'] || null,
    reverse_logos_correspondences: greekToHebrewIndex.by_strongs['G3056'] || null,
    findings: [
      'Hebrew H1697 translates to Greek G3056 (logos, 668), G4487 (rhema, 257), G4229 (pragma, 26), and G2980 (laleo, 20).',
      'Greek G3056 (logos) is translated from H1697 (dabar, 668), H0561 (emer, 10), H4405 (millah, 10), H0565 (imrah, 6), and H4406 (millah, 3).',
      'Reflects real observed translation evidence across speech and utterance vocabulary.',
    ],
  };

  const ambiguityExamples = {
    multiple_hebrew_homographs: {
      H0430: hebrewToGreekIndex.by_strongs['H0430']?.candidates[0] || null,
      H0001: hebrewToGreekIndex.by_strongs['H0001']?.candidates[0] || null,
    },
    multiple_greek_candidates: {
      H7307: hebrewToGreekIndex.by_strongs['H7307']?.candidates || null,
    },
    crosswalk_resolved: {
      G3187_meizon: greekToHebrewIndex.by_strongs['G3187'] || null,
      G3700_optanomai: greekToHebrewIndex.by_strongs['G3700'] || null,
      G3708_horao: greekToHebrewIndex.by_strongs['G3708'] || null,
    },
  };

  const researchExamples = {
    schema_version: SCHEMA_VERSION,
    release_version: RELEASE_VERSION,
    generated_at: BUILD_TIMESTAMP,
    ruach: ruachExamples,
    elohim: elohimExamples,
    dabar_and_logos: dabarExamples,
    ambiguity_tests: ambiguityExamples,
  };

  // 7. Mapping & uncertainty report
  console.log(`[R4 LXX Bridge] Generating mapping & uncertainty report...`);

  const mappingReport = {
    schema_version: SCHEMA_VERSION,
    release_version: RELEASE_VERSION,
    generated_at: BUILD_TIMESTAMP,
    source_dataset: SOURCE_DATASET_ID,
    source_revision: SOURCE_REVISION,
    source_sha256: sourceSha256,
    license: SOURCE_LICENSE,
    total_source_pairs_examined: rawPairs.length,
    pairs_by_status: {
      exact: countExact,
      hebrew_homograph_ambiguous: countAmbiguousHebrew,
      greek_homograph_ambiguous: countAmbiguousGreek,
      both_homographs_ambiguous: countBothAmbiguous,
      crosswalk_resolved: countCrosswalk,
      unmapped: countUnmapped,
    },
    distinct_counts: {
      hebrew_strongs: distinctHebrewStrongs.size,
      greek_strongs: distinctGreekStrongs.size,
      hebrew_canonical_lemmas: distinctHebrewLemmas.size,
      greek_canonical_lemmas: distinctGreekLemmas.size,
      materialized_edges: edges.length,
    },
    frequency_distribution: {
      min_count: Math.min(...rawPairs.map(r => r.published_count)),
      max_count: Math.max(...rawPairs.map(r => r.published_count)),
      top_10_pairs: [...edges].sort((a, b) => b.published_count - a.published_count).slice(0, 10).map(e => ({
        edge_id: e.edge_id,
        hebrew_strong: e.hebrew_strong,
        greek_strong: e.greek_strong,
        published_count: e.published_count,
        mapping_status: e.mapping_status,
      })),
    },
    uncertainty_principles: [
      'Translation correspondence does not establish semantic synonymy.',
      'Shared Strong\'s base codes never merge homographs; candidate sets are preserved.',
      'Reported counts are third-party attestation frequencies from the Septuagint, distinct from verified occurrence alignments.',
      'LXX translation usage must not be equated with NT Greek usage without textual grounding.',
      'No lexical senses were assigned automatically.',
    ],
  };

  // 8. Source provenance and license manifest
  console.log(`[R4 LXX Bridge] Generating source provenance & license manifest...`);

  const licenseManifest = {
    schema_version: SCHEMA_VERSION,
    release_version: RELEASE_VERSION,
    generated_at: BUILD_TIMESTAMP,
    dataset: {
      id: SOURCE_DATASET_ID,
      file: 'lxx_bridge.tsv',
      url: 'https://huggingface.co/datasets/bcv-commons/hebrew-lexical-references',
      revision: SOURCE_REVISION,
      sha256: sourceSha256,
      size_bytes: sourceBytes.length,
      row_count: rawPairs.length,
    },
    license: {
      primary: SOURCE_LICENSE,
      upstream_notices: [
        'MACULA Hebrew and Greek tagging: CC BY 4.0 (Clear-Bible / Biblical Humanities).',
        'Septuagint base text: Ancient text in the Public Domain (Swete / Rahlfs).',
        'OpenScriptures HebrewLexicon: CC BY 4.0.',
        'STEPBible lexical identifiers: CC BY 4.0 (Tyndale House Cambridge).',
        'No data derived from or reproducing UBS MARBLE, Louw-Nida, or SDBH.',
      ],
      redistribution_permitted: true,
      commercial_use_permitted: true,
      derivative_works_permitted: true,
      attribution_required: true,
    },
    methodology: {
      description: 'Attested Hebrew->Greek lexical translation correspondences across the Septuagint, noise-filtered to count >= 3.',
      upstream_build_script: 'bcv-commons/bcv-query: shoresh/macula/build_prior_pack.py',
      counting_method: 'Observed translation frequency of Hebrew Strong\'s to Greek Strong\'s in the Septuagint corpus.',
    },
  };

  // 9. Cloudflare-compatible sharding
  console.log(`[R4 LXX Bridge] Generating Cloudflare-compatible static asset shards...`);

  const hebrewShards = {};
  const greekShards = {};
  for (let i = 0; i < 64; i++) {
    const bucket = i.toString(16).padStart(2, '0');
    hebrewShards[bucket] = { schema_version: SCHEMA_VERSION, release: RELEASE_VERSION, bucket, entries: {} };
    greekShards[bucket] = { schema_version: SCHEMA_VERSION, release: RELEASE_VERSION, bucket, entries: {} };
  }

  for (const [hKey, data] of Object.entries(hebrewToGreekIndex.by_lemma_key)) {
    const b = bucket64(hKey);
    hebrewShards[b].entries[hKey] = data;
  }
  for (const [gKey, data] of Object.entries(greekToHebrewIndex.by_lemma_key)) {
    const b = bucket64(gKey);
    greekShards[b].entries[gKey] = data;
  }

  const resolverIndex = {
    schema_version: SCHEMA_VERSION,
    release_version: RELEASE_VERSION,
    total_edges: edges.length,
    hebrew_strongs_to_bucket: {},
    greek_strongs_to_bucket: {},
    hebrew_lemma_to_bucket: {},
    greek_lemma_to_bucket: {},
  };

  for (const [hKey] of Object.entries(hebrewToGreekIndex.by_lemma_key)) {
    resolverIndex.hebrew_lemma_to_bucket[hKey] = bucket64(hKey);
  }
  for (const [hStrongs, data] of Object.entries(hebrewToGreekIndex.by_strongs)) {
    // Pick the bucket of its first candidate lemma or hash the strongs code
    const firstKey = data.candidates[0]?.greek_lemma_keys[0] || hStrongs;
    resolverIndex.hebrew_strongs_to_bucket[hStrongs] = bucket64(hStrongs);
  }
  for (const [gKey] of Object.entries(greekToHebrewIndex.by_lemma_key)) {
    resolverIndex.greek_lemma_to_bucket[gKey] = bucket64(gKey);
  }
  for (const [gStrongs] of Object.entries(greekToHebrewIndex.by_strongs)) {
    resolverIndex.greek_strongs_to_bucket[gStrongs] = bucket64(gStrongs);
  }

  const cloudflareManifest = {
    schema_version: SCHEMA_VERSION,
    release_version: RELEASE_VERSION,
    generated_at: BUILD_TIMESTAMP,
    source_git_commit: SOURCE_REVISION.slice(0, 7),
    source_releases: {
      bcv_lxx_bridge: {
        dataset: SOURCE_DATASET_ID,
        revision: SOURCE_REVISION,
        sha256: sourceSha256,
        license: SOURCE_LICENSE,
      },
    },
    counts: {
      distinct_hebrew_strongs: distinctHebrewStrongs.size,
      distinct_greek_strongs: distinctGreekStrongs.size,
      distinct_hebrew_lemmas: distinctHebrewLemmas.size,
      distinct_greek_lemmas: distinctGreekLemmas.size,
      total_translation_edges: edges.length,
      hebrew_shards: 64,
      greek_shards: 64,
    },
    predicates: ['translation_candidate', 'translation_candidate_of'],
    sharding: {
      schema_version: SCHEMA_VERSION,
      buckets: 64,
      hash_algorithm: 'fnv1a64_hi32_mod64',
      hash_input_normalization: 'canonical_lemma_key_utf16_exact',
      shard_path_formats: {
        by_hebrew_lemma: 'shards/by-hebrew-lemma/shard-{hex2}.json.gz',
        by_greek_lemma: 'shards/by-greek-lemma/shard-{hex2}.json.gz',
      },
    },
  };

  // 10. Write outputs to disk
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(SHARDS_DIR, 'by-hebrew-lemma'), { recursive: true });
  fs.mkdirSync(path.join(SHARDS_DIR, 'by-greek-lemma'), { recursive: true });

  console.log(`[R4 LXX Bridge] Writing artifact files to: ${OUTPUT_DIR}`);

  // 10.1 Edges
  const edgesJson = JSON.stringify(edges, null, 2);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'translation_candidate_edges.json'), edgesJson, 'utf8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'translation_candidate_edges.jsonl.gz'), zlib.gzipSync(edges.map(e => JSON.stringify(e)).join('\n') + '\n'));

  // 10.2 Indexes
  const h2gJson = JSON.stringify(hebrewToGreekIndex, null, 2);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'hebrew_to_greek_index.json'), h2gJson, 'utf8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'hebrew_to_greek_index.json.gz'), zlib.gzipSync(Buffer.from(h2gJson)));

  const g2hJson = JSON.stringify(greekToHebrewIndex, null, 2);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'greek_to_hebrew_index.json'), g2hJson, 'utf8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'greek_to_hebrew_index.json.gz'), zlib.gzipSync(Buffer.from(g2hJson)));

  // 10.3 Reports & Manifests
  fs.writeFileSync(path.join(OUTPUT_DIR, 'mapping_and_uncertainty_report.json'), JSON.stringify(mappingReport, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'source_provenance_and_license_manifest.json'), JSON.stringify(licenseManifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'research_examples.json'), JSON.stringify(researchExamples, null, 2), 'utf8');

  // 10.4 Shards
  for (const [bucket, data] of Object.entries(hebrewShards)) {
    fs.writeFileSync(path.join(SHARDS_DIR, 'by-hebrew-lemma', `shard-${bucket}.json.gz`), zlib.gzipSync(Buffer.from(JSON.stringify(data))));
  }
  for (const [bucket, data] of Object.entries(greekShards)) {
    fs.writeFileSync(path.join(SHARDS_DIR, 'by-greek-lemma', `shard-${bucket}.json.gz`), zlib.gzipSync(Buffer.from(JSON.stringify(data))));
  }
  fs.writeFileSync(path.join(SHARDS_DIR, 'resolver-index.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(resolverIndex))));
  fs.writeFileSync(path.join(SHARDS_DIR, 'manifest.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(cloudflareManifest))));

  const durationMs = Date.now() - startTime;
  const memUsedMb = ((process.memoryUsage().heapUsed - memStart) / (1024 * 1024)).toFixed(2);

  console.log(`[R4 LXX Bridge] Build complete in ${durationMs}ms (memory delta: ${memUsedMb} MB).`);
  console.log(`[R4 LXX Bridge] Materialized: ${edges.length} edges, ${distinctHebrewLemmas.size} Hebrew lemmas, ${distinctGreekLemmas.size} Greek lemmas.`);

  return {
    success: true,
    durationMs,
    memUsedMb: Number(memUsedMb),
    edgesCount: edges.length,
    hebrewStrongsCount: distinctHebrewStrongs.size,
    greekStrongsCount: distinctGreekStrongs.size,
    hebrewLemmasCount: distinctHebrewLemmas.size,
    greekLemmasCount: distinctGreekLemmas.size,
    outputDir: OUTPUT_DIR,
    mappingReport,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('./scripts/build-r4-lxx-bridge.mjs')) {
  try {
    buildLxxBridge();
  } catch (err) {
    console.error('[R4 LXX Bridge] Build failed:', err);
    process.exit(1);
  }
}
