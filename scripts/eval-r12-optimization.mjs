/**
 * R12 optimization evaluation harness against `.artifacts-r12/staging-bundle`.
 *
 * Reuses the `localReader` pattern from `verify-r12-algorithm-v2.mjs` (wrapped to
 * track per-query `asset_reads`, `bytes_read`, missing reads, `ms`, and
 * `RESTRICTED_RE` leaks) calling `discoverBiblicalConnections` and
 * `getConnectionEvidence` from `../src/relationships/r10-discovery.ts`.
 *
 * CLI flags:
 *   --cases ID1,ID2,...   Evaluate specific benchmark cases
 *   --holdout             Evaluate only the 15 holdout IDs (aggregate only)
 *   --verbose-holdout     Allow per-case output during --holdout (opt-in)
 *   --negatives           Evaluate all 24 negative controls (N001-N024)
 *   --quality-canaries    Run P0/P1 quality & unseen prophetic scene probes
 *   --all-239             Run all 190 unique payloads mapped to 239 cases
 *   --json                Emit full JSON payload at the end
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_R10_RELEASE,
  discoverBiblicalConnections,
  getConnectionEvidence,
} from '../src/relationships/r10-discovery.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const bundleRoot = path.join(repoRoot, '.artifacts-r12', 'staging-bundle');
const benchmarkPath = path.join(repoRoot, 'research', 'r12', 'R12_EXPECTED_CONNECTIONS_180_PLUS.json');

if (!fs.existsSync(bundleRoot)) {
  console.error(`Missing staging bundle at ${bundleRoot}`);
  process.exit(2);
}
if (!fs.existsSync(benchmarkPath)) {
  console.error(`Missing benchmark file at ${benchmarkPath}`);
  process.exit(2);
}

const RESTRICTED_RE = /"(?:semantic_frame|frame|greekstrong|sdbh|lexdomain|coredomain|contextualdomain|domain|ln|field_name)"\s*:/g;

const HOLDOUT_IDS = [
  'D004', 'D047', 'D035', 'D043',
  'S008', 'S019', 'S015', 'S029', 'S060',
  'L003', 'L054',
  'W015', 'W026',
  'N021', 'N024',
];

const N001_N004_FORBIDDEN = {
  N001: 'H3284',
  N002: 'G0032',
  N003: 'H3629',
  N004: 'H0212',
};

const SYNTHETIC_PROPERTY_KEYS = new Set([
  'wd:related_physical_class',
  'wd:combustion_fuel_agent',
]);

function createTrackedLocalReader() {
  let assetReads = 0;
  let bytesRead = 0;
  const missingReads = [];

  const reader = {
    async readJson(assetPath) {
      assetReads++;
      const [rawPath, hashPart] = assetPath.split('#');
      const cleanRel = rawPath.replace(/^\/+/, '');
      const full = path.join(bundleRoot, cleanRel);
      if (!fs.existsSync(full)) {
        missingReads.push(assetPath);
        return null;
      }
      if (hashPart && hashPart.startsWith('bytes=')) {
        const [start, end] = hashPart.slice(6).split('-').map(Number);
        const fd = fs.openSync(full, 'r');
        const len = end - start + 1;
        const buf = Buffer.allocUnsafe(len);
        fs.readSync(fd, buf, 0, len, start);
        fs.closeSync(fd);
        bytesRead += len;
        const raw = buf[0] === 31 && buf[1] === 139 ? zlib.gunzipSync(buf) : buf;
        return { data: JSON.parse(raw.toString('utf8')), bytes: len };
      }
      const buf = fs.readFileSync(full);
      bytesRead += buf.length;
      const isGz = buf.length >= 2 && buf[0] === 31 && buf[1] === 139;
      const raw = isGz ? zlib.gunzipSync(buf) : buf;
      return { data: JSON.parse(raw.toString('utf8')), bytes: buf.length };
    },
    async readBytes(assetPath, start, length) {
      assetReads++;
      const cleanRel = assetPath.split('#')[0].replace(/^\/+/, '');
      const full = path.join(bundleRoot, cleanRel);
      if (!fs.existsSync(full)) {
        missingReads.push(assetPath);
        return null;
      }
      const fd = fs.openSync(full, 'r');
      const buf = Buffer.allocUnsafe(length);
      const actuallyRead = fs.readSync(fd, buf, 0, length, start);
      fs.closeSync(fd);
      bytesRead += actuallyRead;
      return actuallyRead === length ? buf : buf.subarray(0, actuallyRead);
    },
    resetCounters() {
      assetReads = 0;
      bytesRead = 0;
      missingReads.length = 0;
    },
    getCounters() {
      return {
        asset_reads: assetReads,
        bytes_read: bytesRead,
        missing_reads: [...missingReads],
      };
    },
  };

  return reader;
}

function countRestrictedKeys(obj) {
  const txt = JSON.stringify(obj);
  const matches = txt.match(RESTRICTED_RE);
  return matches ? matches.length : 0;
}

function normalizeBookName(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (/^psalm$/i.test(s)) return 'Psalms';
  return s;
}

function parseVerseRef(refStr) {
  const cleaned = String(refStr || '')
    .trim()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
  const m = cleaned.match(/^((?:[1-3]\s+)?[A-Za-z][A-Za-z\s]+?)\s+(\d+):(\d+)(?:\s*-\s*(\d+))?$/);
  if (!m) return null;
  const book = normalizeBookName(m[1]);
  const chapter = Number(m[2]);
  const startVerse = Number(m[3]);
  const endVerse = m[4] ? Number(m[4]) : startVerse;
  return {
    book,
    chapter,
    startVerse,
    endVerse,
    canonical: startVerse === endVerse ? `${book} ${chapter}:${startVerse}` : `${book} ${chapter}:${startVerse}-${endVerse}`,
  };
}

function getPassageRefs(passage) {
  const out = [];
  if (passage?.ref) {
    const p = parseVerseRef(passage.ref);
    if (p) {
      if (typeof passage.end_verse === 'number' && passage.end_verse > p.endVerse) {
        p.endVerse = passage.end_verse;
      }
      out.push(p);
    }
  }
  if (passage?.mt_ref) {
    const p = parseVerseRef(passage.mt_ref);
    if (p) out.push(p);
  }
  return out;
}

function refsOverlapRange(a, b) {
  return (
    a.book.toLowerCase() === b.book.toLowerCase() &&
    a.chapter === b.chapter &&
    !(a.endVerse < b.startVerse || a.startVerse > b.endVerse)
  );
}

function refsMatchStrict(passageRef, targetRef) {
  if (passageRef.book.toLowerCase() !== targetRef.book.toLowerCase()) return false;
  if (passageRef.chapter !== targetRef.chapter) return false;
  return passageRef.startVerse === targetRef.startVerse && passageRef.endVerse === targetRef.endVerse;
}

function extractStrongsFromCard(conn) {
  const ids = new Set();
  const addToken = (val) => {
    if (!val) return;
    const str = String(val).toUpperCase();
    const matches = str.match(/\b[HG]\d{3,5}[A-Z]?\b/g);
    if (matches) {
      for (const m of matches) {
        ids.add(m);
        const base = m.replace(/[A-Z]$/, '');
        ids.add(base);
      }
    }
  };
  for (const w of conn.original_words || []) {
    addToken(w.strongs);
    addToken(w.lemma_key);
  }
  addToken(conn.evidence_id);
  if (conn.r12_metadata?.external_bridge) {
    addToken(conn.r12_metadata.external_bridge.left_sense_id);
    addToken(conn.r12_metadata.external_bridge.right_sense_id);
  }
  return ids;
}

function getSlotPrefix(evidenceId) {
  const id = String(evidenceId || '');
  const parts = id.split(':');
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return id || 'unknown';
}

function getMechanismFamily(evidenceId) {
  const id = String(evidenceId || '');
  if (id.startsWith('r10:')) return 'r10:*';
  const parts = id.split(':');
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return id || 'unknown';
}

function extractCaseTargets(benchCase) {
  const queryText = String(benchCase.mcp_call?.arguments?.query || '').trim();
  const sourceParsed = parseVerseRef(queryText);
  const sourceRefs = sourceParsed ? [sourceParsed] : [];

  const acceptableTerms = benchCase.expected?.acceptable_target_terms || [];
  const expectedStrongs = acceptableTerms
    .filter((t) => /^[HG]\d+[A-Z]?$/i.test(String(t).trim()))
    .map((t) => String(t).trim().toUpperCase());

  const candidateWitnessStrings = [
    ...(benchCase.expected?.biblical_witnesses || []),
    ...acceptableTerms.filter((t) => parseVerseRef(String(t)) !== null),
  ];

  const targetRefs = [];
  const seenCanon = new Set();
  for (const w of candidateWitnessStrings) {
    const parsed = parseVerseRef(w);
    if (!parsed) continue;
    if (sourceRefs.some((sr) => refsOverlapRange(sr, parsed))) continue;
    if (!seenCanon.has(parsed.canonical)) {
      seenCanon.add(parsed.canonical);
      targetRefs.push(parsed);
    }
  }

  return { sourceRefs, expectedStrongs, targetRefs };
}

function evaluatePositiveCase(benchCase, res) {
  const topK = benchCase.expected?.top_k ?? 25;
  const conns = (res?.strongest_connections || []).slice(0, 25);
  const { sourceRefs, expectedStrongs, targetRefs } = extractCaseTargets(benchCase);

  let strictStrongsRank = null;
  let strictVerseRank = null;
  let strictRank = null;
  let rangeVerseRank = null;
  let rangeRank = null;
  let pairedStrictRank = null;
  let pairedRangeRank = null;

  for (let i = 0; i < conns.length; i++) {
    const rank = i + 1;
    const c = conns[i];
    const cardStrongs = extractStrongsFromCard(c);
    const strongsHit = expectedStrongs.some((s) => cardStrongs.has(s) || cardStrongs.has(s.replace(/[A-Z]$/, '')));

    const cardPassageRefs = [];
    for (const p of c.passages || []) {
      cardPassageRefs.push(...getPassageRefs(p));
    }

    const strictVerseHit = targetRefs.some((tr) => cardPassageRefs.some((pr) => refsMatchStrict(pr, tr)));
    const rangeVerseHit = targetRefs.some((tr) => cardPassageRefs.some((pr) => refsOverlapRange(pr, tr)));

    if (strongsHit && strictStrongsRank === null) strictStrongsRank = rank;
    if (strictVerseHit && strictVerseRank === null) strictVerseRank = rank;
    if ((strongsHit || strictVerseHit) && strictRank === null) strictRank = rank;
    if ((strongsHit || rangeVerseHit) && rangeRank === null) rangeRank = rank;
    if (rangeVerseHit && rangeVerseRank === null) rangeVerseRank = rank;

    if (sourceRefs.length > 0) {
      const sourceStrictHit = sourceRefs.some((sr) => cardPassageRefs.some((pr) => refsMatchStrict(pr, sr)));
      const sourceRangeHit = sourceRefs.some((sr) => cardPassageRefs.some((pr) => refsOverlapRange(pr, sr)));
      if (sourceStrictHit && (strongsHit || strictVerseHit) && pairedStrictRank === null) {
        pairedStrictRank = rank;
      }
      if (sourceRangeHit && (strongsHit || rangeVerseHit) && pairedRangeRank === null) {
        pairedRangeRank = rank;
      }
    }
  }

  const top5 = conns.slice(0, 5).map((c, idx) => ({
    rank: idx + 1,
    evidence_id: c.evidence_id,
    score: c.score,
    epistemic_class: c.epistemic_class,
    family: getMechanismFamily(c.evidence_id),
    slot_prefix: getSlotPrefix(c.evidence_id),
  }));
  const top5Families = [...new Set(top5.map((x) => x.family))];

  return {
    id: benchCase.id,
    category: benchCase.category,
    polarity: benchCase.polarity,
    query: benchCase.mcp_call.arguments,
    top_k: topK,
    status: res?.status,
    returned_count: conns.length,
    strict_rank_25: strictRank,
    strict_top_k: strictRank !== null && strictRank <= topK,
    strict_strongs_rank: strictStrongsRank,
    strict_verse_rank: strictVerseRank,
    range_rank_25: rangeRank,
    range_top_k: rangeRank !== null && rangeRank <= topK,
    in_top_25_after_k: rangeRank !== null && rangeRank > topK,
    in_top_25_any: rangeRank !== null,
    absent_in_25: rangeRank === null,
    paired_strict_rank_25: pairedStrictRank,
    paired_strict_top_k: pairedStrictRank !== null && pairedStrictRank <= topK,
    paired_rank_25: pairedRangeRank,
    paired_top_k: pairedRangeRank !== null && pairedRangeRank <= topK,
    top5,
    top5_distinct_families: top5Families,
  };
}

function evaluateNegativeCase(benchCase, res) {
  const conns = (res?.strongest_connections || []).slice(0, 25);
  const id = benchCase.id;

  const forbiddenStrongs = N001_N004_FORBIDDEN[id] || null;
  let forbiddenStrongsPresent = false;
  let forbiddenStrongsRank = null;
  if (forbiddenStrongs) {
    for (let i = 0; i < conns.length; i++) {
      const c = conns[i];
      const cardStrongs = extractStrongsFromCard(c);
      if (cardStrongs.has(forbiddenStrongs)) {
        forbiddenStrongsPresent = true;
        forbiddenStrongsRank = i + 1;
        break;
      }
    }
  }

  const badR12PathLexical = [];
  const syntheticPropBridges = [];
  for (let i = 0; i < conns.length; i++) {
    const c = conns[i];
    if (c.evidence_id?.startsWith('r12:path:') && c.epistemic_class === 'documented_lexical_relationship') {
      badR12PathLexical.push({ rank: i + 1, evidence_id: c.evidence_id });
    }
    const propKey = c.r12_metadata?.external_bridge?.property_key;
    if (SYNTHETIC_PROPERTY_KEYS.has(propKey)) {
      syntheticPropBridges.push({ rank: i + 1, evidence_id: c.evidence_id, property_key: propKey });
    }
  }
  const rawJson = JSON.stringify(res || {});
  for (const synthKey of SYNTHETIC_PROPERTY_KEYS) {
    if (rawJson.includes(synthKey) && !syntheticPropBridges.some((x) => x.property_key === synthKey)) {
      syntheticPropBridges.push({ rank: null, evidence_id: 'raw_payload', property_key: synthKey });
    }
  }

  let n009Check = null;
  if (id === 'N009') {
    const top4 = conns.slice(0, 4);
    const hasGen523 = top4.some((c) =>
      (c.passages || []).some((p) => {
        const refs = getPassageRefs(p);
        const gen523 = parseVerseRef('Genesis 5:23');
        return refs.some((r) => refsOverlapRange(r, gen523));
      }) || /\bGen(?:esis)?\s*5:23\b/i.test(`${c.title} ${c.explanation}`)
    );
    const resurrectionCoveredByCard = top4.map((c, idx) => {
      const blob = JSON.stringify({
        id: c.evidence_id,
        title: c.title,
        explanation: c.explanation,
        matched_concepts: c.matched_concepts,
        query_support: c.query_support,
        refs: (c.passages || []).map((p) => p.ref),
        words: (c.original_words || []).map((w) => `${w.strongs}:${w.gloss}`),
      });
      const coversRes =
        c.query_support === 'all_concepts' ||
        /\b(?:resurrect(?:ion|ed|ing)?|anastasis|rise again|raised(?: on the third day)?)\b/i.test(blob) ||
        /\b(?:G0386|G0450|G1453|H2421)\b/i.test(blob) ||
        (c.matched_concepts || []).some((mc) => /resurrect|rise|raise/i.test(String(mc)));
      return {
        rank: idx + 1,
        evidence_id: c.evidence_id,
        title: c.title,
        query_support: c.query_support || null,
        refs: (c.passages || []).slice(0, 4).map((p) => p.ref),
        covers_resurrection: coversRes,
      };
    });
    const anyTop4CoversResurrection = resurrectionCoveredByCard.some((x) => x.covers_resurrection);
    const allTop4CoverResurrection = top4.length > 0 && resurrectionCoveredByCard.every((x) => x.covers_resurrection);
    n009Check = {
      contains_gen_5_23_in_top4: hasGen523,
      any_top4_covers_resurrection: anyTop4CoversResurrection,
      all_top4_cover_resurrection: allTop4CoverResurrection,
      fails_resurrection_coverage: !anyTop4CoversResurrection || !allTop4CoverResurrection,
      top4: resurrectionCoveredByCard,
    };
  }

  const restrictedKeys = countRestrictedKeys(res);
  const top5 = conns.slice(0, 5).map((c, idx) => ({
    rank: idx + 1,
    evidence_id: c.evidence_id,
    score: c.score,
    epistemic_class: c.epistemic_class,
    family: getMechanismFamily(c.evidence_id),
    slot_prefix: getSlotPrefix(c.evidence_id),
  }));

  let pass =
    !forbiddenStrongsPresent &&
    badR12PathLexical.length === 0 &&
    syntheticPropBridges.length === 0 &&
    restrictedKeys === 0;
  if (id === 'N009' && n009Check) {
    pass = pass && !n009Check.contains_gen_5_23_in_top4 && n009Check.all_top4_cover_resurrection;
  }

  return {
    id,
    category: benchCase.category,
    polarity: 'negative',
    query: benchCase.mcp_call.arguments,
    status: res?.status,
    returned_count: conns.length,
    forbidden_strongs: forbiddenStrongs,
    forbidden_strongs_present: forbiddenStrongsPresent,
    forbidden_strongs_rank: forbiddenStrongsRank,
    r12_path_documented_lexical_count: badR12PathLexical.length,
    bad_r12_path_lexical: badR12PathLexical,
    synthetic_prop_count: syntheticPropBridges.length,
    synthetic_prop_bridges: syntheticPropBridges,
    restricted_keys: restrictedKeys,
    n009_check: n009Check,
    pass,
    top5,
    top5_distinct_families: [...new Set(top5.map((x) => x.family))],
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarizeLatencyAndReads(queryMetrics) {
  const msList = queryMetrics.map((m) => m.ms).sort((a, b) => a - b);
  const readsList = queryMetrics.map((m) => m.asset_reads).sort((a, b) => a - b);
  const bytesList = queryMetrics.map((m) => m.bytes_read).sort((a, b) => a - b);
  const totalMs = msList.reduce((a, b) => a + b, 0);
  const totalReads = readsList.reduce((a, b) => a + b, 0);
  const totalBytes = bytesList.reduce((a, b) => a + b, 0);
  const missingReads = queryMetrics.flatMap((m) => m.missing_reads || []);
  return {
    query_count: queryMetrics.length,
    total_ms: Math.round(totalMs * 100) / 100,
    median_ms: Math.round(percentile(msList, 50) * 100) / 100,
    p95_ms: Math.round(percentile(msList, 95) * 100) / 100,
    max_ms: Math.round((msList[msList.length - 1] || 0) * 100) / 100,
    total_asset_reads: totalReads,
    median_asset_reads: percentile(readsList, 50),
    max_asset_reads: readsList[readsList.length - 1] || 0,
    total_bytes_read: totalBytes,
    median_bytes_read: percentile(bytesList, 50),
    max_bytes_read: bytesList[bytesList.length - 1] || 0,
    unique_missing_assets: [...new Set(missingReads)],
  };
}

async function runDeduplicatedQueries(reader, casesList) {
  const queryGroups = new Map();
  for (const c of casesList) {
    const args = c.mcp_call.arguments;
    const key = JSON.stringify({
      query: args.query,
      limit: args.limit ?? 25,
      max_hops: args.max_hops ?? 5,
      mode: args.mode ?? 'discover',
    });
    if (!queryGroups.has(key)) {
      queryGroups.set(key, { key, args, cases: [] });
    }
    queryGroups.get(key).cases.push(c);
  }

  const queryResults = new Map();
  const queryMetrics = [];

  for (const [key, grp] of queryGroups.entries()) {
    reader.resetCounters();
    const t0 = performance.now();
    const res = await discoverBiblicalConnections(
      reader,
      {
        query: grp.args.query,
        limit: grp.args.limit ?? 25,
        max_hops: grp.args.max_hops ?? 5,
        mode: grp.args.mode ?? 'discover',
      },
      DEFAULT_R10_RELEASE,
    );
    const ms = Math.round((performance.now() - t0) * 100) / 100;
    const counters = reader.getCounters();
    const restrictedKeys = countRestrictedKeys(res);

    const metric = {
      key,
      query: grp.args.query,
      mode: grp.args.mode ?? 'discover',
      case_ids: grp.cases.map((c) => c.id),
      status: res?.status,
      release_id: res?.release_id,
      r12_release_id: res?.r12_discovery?.release_id ?? null,
      score_version: res?.r12_discovery?.score_version ?? null,
      ms,
      asset_reads: counters.asset_reads,
      bytes_read: counters.bytes_read,
      missing_reads: counters.missing_reads,
      restricted_keys: restrictedKeys,
      engine_asset_requests_used: res?.search_metadata?.asset_requests_used ?? null,
      engine_execution_ms: res?.search_metadata?.execution_ms ?? null,
    };
    queryMetrics.push(metric);
    queryResults.set(key, { res, metric });
  }

  const caseEvaluations = [];
  for (const c of casesList) {
    const args = c.mcp_call.arguments;
    const key = JSON.stringify({
      query: args.query,
      limit: args.limit ?? 25,
      max_hops: args.max_hops ?? 5,
      mode: args.mode ?? 'discover',
    });
    const { res, metric } = queryResults.get(key);
    if (c.polarity === 'positive') {
      const ev = evaluatePositiveCase(c, res);
      ev.ms = metric.ms;
      ev.asset_reads = metric.asset_reads;
      ev.bytes_read = metric.bytes_read;
      ev.restricted_keys = metric.restricted_keys;
      caseEvaluations.push(ev);
    } else {
      const ev = evaluateNegativeCase(c, res);
      ev.ms = metric.ms;
      ev.asset_reads = metric.asset_reads;
      ev.bytes_read = metric.bytes_read;
      caseEvaluations.push(ev);
    }
  }

  return {
    unique_queries: queryGroups.size,
    query_metrics: queryMetrics,
    query_results: queryResults,
    case_evaluations: caseEvaluations,
  };
}

function aggregateEvaluations(runResult) {
  const positives = runResult.case_evaluations.filter((e) => e.polarity === 'positive');
  const negatives = runResult.case_evaluations.filter((e) => e.polarity === 'negative');

  const strictTopK = positives.filter((e) => e.strict_top_k).length;
  const rangeTopK = positives.filter((e) => e.range_top_k).length;
  const inTop25AfterK = positives.filter((e) => e.in_top_25_after_k).length;
  const inTop25Any = positives.filter((e) => e.in_top_25_any).length;
  const absentIn25 = positives.filter((e) => e.absent_in_25).length;
  const pairedTopK = positives.filter((e) => e.paired_top_k).length;
  const pairedStrictTopK = positives.filter((e) => e.paired_strict_top_k).length;
  const paired25 = positives.filter((e) => e.paired_rank_25 !== null).length;

  const byCategory = {};
  for (const e of positives) {
    if (!byCategory[e.category]) {
      byCategory[e.category] = {
        total: 0,
        strict_top_k: 0,
        range_top_k: 0,
        in_top_25_after_k: 0,
        absent_in_25: 0,
        paired_top_k: 0,
      };
    }
    const b = byCategory[e.category];
    b.total++;
    if (e.strict_top_k) b.strict_top_k++;
    if (e.range_top_k) b.range_top_k++;
    if (e.in_top_25_after_k) b.in_top_25_after_k++;
    if (e.absent_in_25) b.absent_in_25++;
    if (e.paired_top_k) b.paired_top_k++;
  }

  const top5SlotCountsByCase = {};
  const top5FamilyCountsByCase = {};
  for (const e of runResult.case_evaluations) {
    for (const s of e.top5) {
      top5SlotCountsByCase[s.slot_prefix] = (top5SlotCountsByCase[s.slot_prefix] || 0) + 1;
      top5FamilyCountsByCase[s.family] = (top5FamilyCountsByCase[s.family] || 0) + 1;
    }
  }

  const top5SlotCountsUnique = {};
  const top5FamilyCountsUnique = {};
  for (const { res } of runResult.query_results.values()) {
    for (const c of (res?.strongest_connections || []).slice(0, 5)) {
      const sp = getSlotPrefix(c.evidence_id);
      const fam = getMechanismFamily(c.evidence_id);
      top5SlotCountsUnique[sp] = (top5SlotCountsUnique[sp] || 0) + 1;
      top5FamilyCountsUnique[fam] = (top5FamilyCountsUnique[fam] || 0) + 1;
    }
  }

  const restrictedKeysTotal = runResult.query_metrics.reduce((acc, m) => acc + m.restricted_keys, 0);
  const badR12PathLexicalTotal = negatives.reduce((acc, n) => acc + n.r12_path_documented_lexical_count, 0);
  const syntheticPropTotal = negatives.reduce((acc, n) => acc + n.synthetic_prop_count, 0);
  const n001N004Failures = negatives.filter((n) => n.forbidden_strongs_present).map((n) => ({
    id: n.id,
    forbidden_strongs: n.forbidden_strongs,
    rank: n.forbidden_strongs_rank,
  }));
  const n009Eval = negatives.find((n) => n.id === 'N009') || null;
  const noMatchQueries = runResult.query_metrics.filter((m) => m.status === 'no_match').map((m) => m.query);

  return {
    total_cases: runResult.case_evaluations.length,
    unique_queries: runResult.unique_queries,
    positives_count: positives.length,
    negatives_count: negatives.length,
    strict_top_k: strictTopK,
    range_top_k: rangeTopK,
    in_top_25_after_k: inTop25AfterK,
    in_top_25_any: inTop25Any,
    absent_in_25: absentIn25,
    paired_top_k: pairedTopK,
    paired_strict_top_k: pairedStrictTopK,
    paired_in_25: paired25,
    by_category: byCategory,
    top5_slot_counts_case_rows: top5SlotCountsByCase,
    top5_family_counts_case_rows: top5FamilyCountsByCase,
    top5_slot_counts_unique_queries: top5SlotCountsUnique,
    top5_family_counts_unique_queries: top5FamilyCountsUnique,
    negative_checks: {
      total: negatives.length,
      passed: negatives.filter((n) => n.pass).length,
      n001_n004_impossible_strongs_present: n001N004Failures,
      r12_path_documented_lexical_count: badR12PathLexicalTotal,
      synthetic_prop_count: syntheticPropTotal,
      restricted_keys_total: restrictedKeysTotal,
      n009_check: n009Eval?.n009_check || null,
    },
    no_match_queries: noMatchQueries,
    restricted_keys_total: restrictedKeysTotal,
    io_and_latency: summarizeLatencyAndReads(runResult.query_metrics),
  };
}

async function runQualityCanaries(reader) {
  const out = {
    restricted_keys_total: 0,
    canaries: {},
    unseen_scenes: [],
  };

  async function timedDiscover(query, limit = 25, max_hops = 5, mode = 'discover') {
    reader.resetCounters();
    const t0 = performance.now();
    const res = await discoverBiblicalConnections(reader, { query, limit, max_hops, mode }, DEFAULT_R10_RELEASE);
    const ms = Math.round((performance.now() - t0) * 100) / 100;
    const counters = reader.getCounters();
    const rk = countRestrictedKeys(res);
    out.restricted_keys_total += rk;
    return { res, ms, ...counters, restricted_keys: rk };
  }

  async function timedEvidence(evidenceId, releaseId = DEFAULT_R10_RELEASE) {
    reader.resetCounters();
    const t0 = performance.now();
    const res = await getConnectionEvidence(reader, evidenceId, releaseId);
    const ms = Math.round((performance.now() - t0) * 100) / 100;
    const counters = reader.getCounters();
    const rk = countRestrictedKeys(res);
    out.restricted_keys_total += rk;
    return { res, ms, ...counters, restricted_keys: rk };
  }

  // P0-A: Hagar well spring eyes seeing Genesis 16 Genesis 21
  {
    const run = await timedDiscover('Hagar well spring eyes seeing Genesis 16 Genesis 21', 25, 5);
    const conns = run.res?.strongest_connections || [];
    const gen164Hits = conns
      .map((c, idx) => ({ rank: idx + 1, c }))
      .filter(({ c }) =>
        c.evidence_id?.endsWith(':386') ||
        (c.passages || []).some((p) => p.verse_id === 386 || /^Genesis\s+16:4\b/i.test(p.ref || ''))
      )
      .map(({ rank, c }) => ({
        rank,
        evidence_id: c.evidence_id,
        title: c.title,
        explanation: c.explanation,
        says_well: /\bwell\b/i.test(`${c.title || ''} ${c.explanation || ''}`),
      }));
    const anyGen164Well = gen164Hits.some((h) => h.says_well);
    out.canaries['P0-A'] = {
      pass: !anyGen164Well,
      ms: run.ms,
      asset_reads: run.asset_reads,
      bytes_read: run.bytes_read,
      top5: conns.slice(0, 5).map((c, i) => ({
        rank: i + 1,
        evidence_id: c.evidence_id,
        score: c.score,
        title: c.title,
        refs: (c.passages || []).slice(0, 4).map((p) => p.ref),
      })),
      genesis_16_4_hits: gen164Hits,
      fail_reason: anyGen164Well ? 'Genesis 16:4 card title/claim says "well"' : null,
    };
  }

  // P0-B: r11:lex:H7225:0 and r11:lex:H0452:0 + discovery original_words language check
  {
    const ev7225 = await timedEvidence('r11:lex:H7225:0');
    const ev0452 = await timedEvidence('r11:lex:H0452:0');
    const discGen11 = await timedDiscover('Genesis 1:1', 25, 5);
    const disc2Kg214 = await timedDiscover('2 Kings 2:14', 25, 5);

    const checkHboGreek = (words) =>
      (words || []).filter((w) => ['G0746', 'G2243'].includes(String(w.strongs || '').toUpperCase()) && w.language === 'hbo');

    const card7225 = (discGen11.res?.strongest_connections || []).find((c) => c.evidence_id === 'r11:lex:H7225:0');
    const card0452 = (disc2Kg214.res?.strongest_connections || []).find((c) => c.evidence_id === 'r11:lex:H0452:0');

    const ev7225Rec = ev7225.res?.evidence;
    const ev0452Rec = ev0452.res?.evidence;

    const hboBugs = [
      ...checkHboGreek(ev7225Rec?.original_words).map((w) => ({ where: 'evidence:H7225', ...w })),
      ...checkHboGreek(ev0452Rec?.original_words).map((w) => ({ where: 'evidence:H0452', ...w })),
      ...checkHboGreek(card7225?.original_words).map((w) => ({ where: 'discover(Gen1:1):H7225', ...w })),
      ...checkHboGreek(card0452?.original_words).map((w) => ({ where: 'discover(2Kg2:14):H0452', ...w })),
    ];

    const h7225RootMislabel = ev7225Rec?.provenance?.derivation_method === 'lexical_root_derivation';
    const h0452RootMislabel = ev0452Rec?.provenance?.derivation_method === 'lexical_root_derivation';

    out.canaries['P0-B'] = {
      pass: !h7225RootMislabel && !h0452RootMislabel && hboBugs.length === 0,
      H7225: {
        status: ev7225.res?.status,
        title: ev7225Rec?.title ?? null,
        summary: ev7225Rec?.summary ?? null,
        derivation_method: ev7225Rec?.provenance?.derivation_method ?? null,
        discover_rank: (discGen11.res?.strongest_connections || []).findIndex((c) => c.evidence_id === 'r11:lex:H7225:0') + 1 || null,
        discover_original_words: card7225?.original_words ?? null,
        evidence_original_words: ev7225Rec?.original_words ?? null,
        ms: ev7225.ms,
      },
      H0452: {
        status: ev0452.res?.status,
        title: ev0452Rec?.title ?? null,
        summary: ev0452Rec?.summary ?? null,
        derivation_method: ev0452Rec?.provenance?.derivation_method ?? null,
        discover_rank: (disc2Kg214.res?.strongest_connections || []).findIndex((c) => c.evidence_id === 'r11:lex:H0452:0') + 1 || null,
        discover_original_words: card0452?.original_words ?? null,
        evidence_original_words: ev0452Rec?.original_words ?? null,
        ms: ev0452.ms,
      },
      greek_labeled_hbo_errors: hboBugs,
    };
  }

  // P0-C: Genesis 1:1 r11:gram:H1254:grammatical_subject_of:H0430
  {
    const discGen11 = await timedDiscover('Genesis 1:1', 25, 5);
    const card = (discGen11.res?.strongest_connections || []).find((c) => c.evidence_id === 'r11:gram:H1254:grammatical_subject_of:H0430');
    const ev = await timedEvidence('r11:gram:H1254:grammatical_subject_of:H0430');
    const cardWords = (card?.original_words || []).filter((w) => String(w.strongs || '').startsWith('H1254') || String(w.lemma_key || '').startsWith('H1254'));
    const evWords = (ev.res?.evidence?.original_words || []).filter((w) => String(w.strongs || '').startsWith('H1254') || String(w.lemma_key || '').startsWith('H1254'));
    const allH1254 = [...cardWords, ...evWords];
    const hasFattenOrC = allH1254.some((w) => /\bfat(?:ten)?\b/i.test(w.gloss || '') || /^H1254c$/i.test(w.lemma_key || '') || /^H1254c$/i.test(w.strongs || ''));
    out.canaries['P0-C'] = {
      pass: Boolean(card) && !hasFattenOrC,
      discover_rank: (discGen11.res?.strongest_connections || []).findIndex((c) => c.evidence_id === 'r11:gram:H1254:grammatical_subject_of:H0430') + 1 || null,
      discover_title: card?.title ?? null,
      discover_h1254_words: cardWords,
      evidence_h1254_words: evWords,
      flagged_fatten_or_H1254c: hasFattenOrC,
      ms: discGen11.ms,
    };
  }

  // P0-D: getConnectionEvidence('r11:xref:1832:29274')
  {
    const ev = await timedEvidence('r11:xref:1832:29274');
    const rec = ev.res?.evidence;
    const textToCheck = `${rec?.summary || ''} ${(rec?.limitations || []).join(' ')}`;
    const flagsAncientEditorial = /documents ancient editorial or intertextual connection/i.test(textToCheck);
    out.canaries['P0-D'] = {
      pass: ev.res?.status === 'ok' && !flagsAncientEditorial,
      status: ev.res?.status,
      title: rec?.title ?? null,
      summary: rec?.summary ?? null,
      limitations: rec?.limitations ?? [],
      source_dataset: rec?.provenance?.source_dataset ?? null,
      flagged_ancient_editorial_claim: flagsAncientEditorial,
      ms: ev.ms,
    };
  }

  // P1-E: getConnectionEvidence('r12:path:G3088:G5459', 'r12-discovery-2') + explicit evidence_release_id check
  {
    const evMismatch = await timedEvidence('r12:path:G3088:G5459', 'r12-discovery-2');
    const evDefault = await timedEvidence('r12:path:G3088:G5459', DEFAULT_R10_RELEASE);
    const discProbe = await timedDiscover('G3088', 5, 5);
    const hasExplicitEvidenceReleaseId =
      Object.prototype.hasOwnProperty.call(discProbe.res || {}, 'evidence_release_id') ||
      Object.prototype.hasOwnProperty.call(discProbe.res?.r12_discovery || {}, 'evidence_release_id');
    out.canaries['P1-E'] = {
      pass: evMismatch.res?.status === 'release_mismatch' && hasExplicitEvidenceReleaseId,
      with_r12_discovery_2: {
        status: evMismatch.res?.status ?? null,
        release_id: evMismatch.res?.release_id ?? null,
        error: evMismatch.res?.error ?? null,
      },
      with_default_release: {
        status: evDefault.res?.status ?? null,
        release_id: evDefault.res?.release_id ?? null,
      },
      discover_has_explicit_evidence_release_id: hasExplicitEvidenceReleaseId,
      discover_release_id: discProbe.res?.release_id ?? null,
      discover_r12_release_id: discProbe.res?.r12_discovery?.release_id ?? null,
      ms: evMismatch.ms,
    };
  }

  // UNSEEN_SCENES
  const sceneProbes = [
    {
      name: 'Ezekiel 1 <-> Revelation 4',
      query: 'Ezekiel 1 living creatures wheels eyes Revelation 4 throne',
      bookA: 'Ezekiel',
      bookB: 'Revelation',
    },
    {
      name: 'Zechariah 4 <-> Revelation 11',
      query: 'Zechariah 4 two olive trees lampstand seven eyes Revelation 11',
      bookA: 'Zechariah',
      bookB: 'Revelation',
    },
    {
      name: 'Revelation 13 <-> Daniel 7',
      query: 'Revelation 13 beast sea horns Daniel 7',
      bookA: 'Revelation',
      bookB: 'Daniel',
    },
  ];

  for (const probe of sceneProbes) {
    const run = await timedDiscover(probe.query, 25, 5);
    const conns = run.res?.strongest_connections || [];
    const crossBookRanks = [];
    for (let i = 0; i < conns.length; i++) {
      const c = conns[i];
      const refs = (c.passages || []).map((p) => p.ref || '');
      const hasA = refs.some((r) => new RegExp(`^${probe.bookA}\\b`, 'i').test(r));
      const hasB = refs.some((r) => new RegExp(`^${probe.bookB}\\b`, 'i').test(r));
      if (hasA && hasB) crossBookRanks.push(i + 1);
    }
    out.unseen_scenes.push({
      name: probe.name,
      query: probe.query,
      status: run.res?.status,
      ms: run.ms,
      asset_reads: run.asset_reads,
      bytes_read: run.bytes_read,
      cross_book_alignment_in_top10: crossBookRanks.some((r) => r <= 10),
      cross_book_ranks_in_top25: crossBookRanks,
      top5: conns.slice(0, 5).map((c, idx) => ({
        rank: idx + 1,
        evidence_id: c.evidence_id,
        score: c.score,
        epistemic_class: c.epistemic_class,
        family: getMechanismFamily(c.evidence_id),
        passages: (c.passages || []).slice(0, 5).map((p) => p.ref),
      })),
    });
  }

  return out;
}

function parseCliArgs(argv) {
  const opts = {
    cases: null,
    holdout: false,
    verboseHoldout: false,
    negatives: false,
    qualityCanaries: false,
    all239: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cases' && i + 1 < argv.length) {
      opts.cases = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith('--cases=')) {
      opts.cases = a.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--holdout') {
      opts.holdout = true;
    } else if (a === '--verbose-holdout') {
      opts.verboseHoldout = true;
    } else if (a === '--negatives') {
      opts.negatives = true;
    } else if (a === '--quality-canaries') {
      opts.qualityCanaries = true;
    } else if (a === '--all-239') {
      opts.all239 = true;
    } else if (a === '--json') {
      opts.json = true;
    }
  }
  return opts;
}

function printCaseTable(evaluations) {
  console.log('\n=== Case Evaluation ===');
  for (const e of evaluations) {
    if (e.polarity === 'positive') {
      const top5Str = e.top5.map((x) => `${x.evidence_id}@${x.score}[${x.epistemic_class}]`).join(' | ');
      console.log(
        `${e.id} (${e.category}, K=${e.top_k}) | strict=${e.strict_top_k ? `PASS@${e.strict_rank_25}` : `MISS(25:${e.strict_rank_25 ?? '-'})`} | range=${e.range_top_k ? `PASS@${e.range_rank_25}` : (e.in_top_25_after_k ? `AFTER_K@${e.range_rank_25}` : 'ABSENT_25')} | paired=${e.paired_top_k ? `PASS@${e.paired_rank_25}` : (e.paired_rank_25 ? `AFTER_K@${e.paired_rank_25}` : '-')} | ms=${e.ms} reads=${e.asset_reads} bytes=${e.bytes_read} rk=${e.restricted_keys}`
      );
      console.log(`  families(${e.top5_distinct_families.length}): ${e.top5_distinct_families.join(', ')}`);
      console.log(`  top5: ${top5Str}`);
    } else {
      const top5Str = e.top5.map((x) => `${x.evidence_id}@${x.score}[${x.epistemic_class}]`).join(' | ');
      console.log(
        `${e.id} (NEG:${e.category}) | pass=${e.pass} | forbid=${e.forbidden_strongs ?? '-'}->${e.forbidden_strongs_present ? `FAIL@${e.forbidden_strongs_rank}` : 'absent'} | path_lex=${e.r12_path_documented_lexical_count} | synth_prop=${e.synthetic_prop_count} | rk=${e.restricted_keys} | ms=${e.ms} reads=${e.asset_reads} bytes=${e.bytes_read}`
      );
      if (e.n009_check) {
        console.log(
          `  N009: gen5_23_top4=${e.n009_check.contains_gen_5_23_in_top4} any_res_top4=${e.n009_check.any_top4_covers_resurrection} all_res_top4=${e.n009_check.all_top4_cover_resurrection} top4_refs=${JSON.stringify(e.n009_check.top4.map((x) => `${x.evidence_id}:${x.refs.join(',')}[res=${x.covers_resurrection}]`))}`
        );
      }
      console.log(`  families(${e.top5_distinct_families.length}): ${e.top5_distinct_families.join(', ')}`);
      console.log(`  top5: ${top5Str}`);
    }
  }
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (!opts.cases && !opts.holdout && !opts.negatives && !opts.qualityCanaries && !opts.all239) {
    console.error('Usage: node scripts/eval-r12-optimization.mjs [--cases ID1,ID2] [--holdout [--verbose-holdout]] [--negatives] [--quality-canaries] [--all-239] [--json]');
    process.exit(1);
  }

  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
  const caseById = new Map(benchmark.cases.map((c) => [c.id, c]));
  const reader = createTrackedLocalReader();
  const report = {};

  if (opts.cases) {
    const selected = opts.cases.map((id) => {
      const c = caseById.get(id);
      if (!c) throw new Error(`Unknown benchmark case ID: ${id}`);
      return c;
    });
    const run = await runDeduplicatedQueries(reader, selected);
    const agg = aggregateEvaluations(run);
    report.cases = { summary: agg, rows: run.case_evaluations };
    if (!opts.json) {
      printCaseTable(run.case_evaluations);
      console.log('\n=== Cases Aggregate Summary ===');
      console.log(JSON.stringify(agg, null, 2));
    }
  }

  if (opts.holdout) {
    const selected = HOLDOUT_IDS.map((id) => caseById.get(id)).filter(Boolean);
    const run = await runDeduplicatedQueries(reader, selected);
    const agg = aggregateEvaluations(run);
    if (opts.verboseHoldout) {
      report.holdout = { summary: agg, rows: run.case_evaluations };
    } else {
      report.holdout = { summary: agg };
    }
    if (!opts.json) {
      if (opts.verboseHoldout) {
        printCaseTable(run.case_evaluations);
      }
      console.log('\n=== Holdout Aggregate Summary (15 cases: 13 pos, 2 neg) ===');
      console.log(JSON.stringify(agg, null, 2));
    }
  }

  if (opts.negatives) {
    const negCases = benchmark.cases.filter((c) => c.polarity !== 'positive');
    const run = await runDeduplicatedQueries(reader, negCases);
    const agg = aggregateEvaluations(run);
    report.negatives = { summary: agg, rows: run.case_evaluations };
    if (!opts.json) {
      printCaseTable(run.case_evaluations);
      console.log('\n=== Negatives Summary (24 controls) ===');
      console.log(JSON.stringify({
        negative_checks: agg.negative_checks,
        io_and_latency: agg.io_and_latency,
        top5_slot_counts_case_rows: agg.top5_slot_counts_case_rows,
      }, null, 2));
    }
  }

  if (opts.qualityCanaries) {
    const qc = await runQualityCanaries(reader);
    report.quality_canaries = qc;
    if (!opts.json) {
      console.log('\n=== Quality Canaries & Unseen Scenes ===');
      console.log(JSON.stringify(qc, null, 2));
    }
  }

  if (opts.all239) {
    const run = await runDeduplicatedQueries(reader, benchmark.cases);
    const agg = aggregateEvaluations(run);
    report.all_239 = { summary: agg };
    if (!opts.json) {
      console.log('\n=== ALL 239 Aggregate Summary (190 unique queries -> 239 cases) ===');
      console.log(JSON.stringify(agg, null, 2));
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
