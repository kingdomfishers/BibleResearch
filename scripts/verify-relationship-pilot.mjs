// @file: scripts/verify-relationship-pilot.mjs
// Verifies R1–R3 pilot invariants, independent fixtures, R3.2 lemma graph integrity,
// byte-identical reproducibility, license field exclusions, and source-ID traceability.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { runPilotBuild } from './build-relationship-pilot.mjs';

const VERBAL_ROLE_BY_PREDICATE = {
  grammatical_subject_of: 'grammatical_subject',
  grammatical_object_of: 'grammatical_object',
  grammatical_indirect_object_of: 'grammatical_indirect_object',
  grammatical_second_object_of: 'grammatical_second_object',
};

const PHRASE_RULE_BY_PREDICATE = {
  modifies: new Set(['he_phrase_mod_v1', 'gr_phrase_mod_v1']),
  possessive_construction_with: new Set(['he_phrase_poss_v1', 'gr_phrase_poss_v1']),
};

const PREDICATE_INVERSE = {
  grammatical_subject_of: 'has_grammatical_subject',
  grammatical_object_of: 'has_grammatical_object',
  grammatical_indirect_object_of: 'has_grammatical_indirect_object',
  grammatical_second_object_of: 'has_grammatical_second_object',
  modifies: 'modified_by',
  possessive_construction_with: 'has_possessive_construction',
};

const COMMAND_OR_PREDICTION_MODALITIES = new Set([
  'imperative',
  'jussive',
  'cohortative',
  'subjunctive',
  'optative',
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(REPO_ROOT, '.artifacts', 'relationships-v2');
const FIXTURES_PATH = path.join(__dirname, 'fixtures', 'relationship-pilot-cases.json');
const MCP_REL_PATH = path.join(REPO_ROOT, 'supabase', 'functions', 'bible-mcp', 'relationships-v2.ts');
const SYNTAX_NODES_DIR = path.join(REPO_ROOT, '.artifacts', 'static-corpus', 'tables', 'syntax_nodes');

const RESTRICTED_KEYS = new Set([
  'sdbh',
  'lexdomain',
  'coredomain',
  'contextualdomain',
  'domain',
  'ln',
  'frame',
  'semantic_frame',
  'meaning',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((ln) => ln.trim().length > 0)
    .map((ln) => JSON.parse(ln));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function findRestrictedKeys(obj, prefix = '') {
  const hits = [];
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i += 1) {
      hits.push(...findRestrictedKeys(obj[i], `${prefix}[${i}]`));
    }
    return hits;
  }
  if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const next = prefix ? `${prefix}.${k}` : k;
      if (RESTRICTED_KEYS.has(k.toLowerCase())) {
        hits.push(next);
      }
      hits.push(...findRestrictedKeys(v, next));
    }
  }
  return hits;
}

function parseXmlIds(xmlPath) {
  const raw = fs.readFileSync(xmlPath, 'utf8');
  const ids = new Set();
  const re = /xml:id="([^"]+)"/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

function runR3FixturesAndGraphChecks({
  fixtures,
  coverage,
  frames,
  relations,
  frameById,
  relById,
  relsByFrameId,
  r3Artifacts,
  recordCheck,
  bumpFixture,
}) {
  const { summaries, evidenceIndex, byLemma, lanes, queryDemos, r3Quality, manifest } = r3Artifacts;

  // R3.1 positive relation fixtures
  for (const fx of fixtures.r3_positive_relations || []) {
    const rel = relById.get(fx.relation_id);
    let ok = Boolean(rel);
    const diffs = [];
    if (!rel) {
      diffs.push('missing_relation');
    } else {
      for (const k of ['predicate', 'subject_lemma_id', 'object_lemma_id', 'quality']) {
        if (fx[k] !== undefined && rel[k] !== fx[k]) {
          ok = false;
          diffs.push(`${k}:${rel[k]}!=${fx[k]}`);
        }
      }
      if (fx.rule_id !== undefined && rel.evidence?.rule_id !== fx.rule_id) {
        ok = false;
        diffs.push(`rule_id:${rel.evidence?.rule_id}!=${fx.rule_id}`);
      }
      if (fx.qualifiers) {
        for (const [qk, qv] of Object.entries(fx.qualifiers)) {
          if (rel.qualifiers?.[qk] !== qv) {
            ok = false;
            diffs.push(`qual.${qk}:${rel.qualifiers?.[qk]}!=${qv}`);
          }
        }
      }
    }
    bumpFixture(ok);
    recordCheck(`fixture_r3_pos:${fx.name}`, ok, diffs.join(', '));
  }

  // R3.1 negative and ambiguous scope fixtures
  for (const fx of fixtures.r3_negative_and_ambiguous_cases || []) {
    let ok = true;
    const diffs = [];
    const fRels = fx.frame_id ? relsByFrameId.get(fx.frame_id) || [] : [];
    if (fx.kind === 'forbidden_predicate_in_frame') {
      const hits = fRels.filter((r) => r.predicate === fx.forbidden_predicate);
      if (hits.length > 0) {
        ok = false;
        diffs.push(`unexpected:${hits.map((h) => h.relation_id).join(',')}`);
      }
    } else if (fx.kind === 'forbidden_subject_in_frame') {
      const hits = fRels.filter(
        (r) =>
          fx.forbidden_subject_token_ids.includes(r.subject_token_id) &&
          (!fx.forbidden_predicate || r.predicate === fx.forbidden_predicate),
      );
      if (hits.length > 0) {
        ok = false;
        diffs.push(`unexpected:${hits.map((h) => h.relation_id).join(',')}`);
      }
    } else if (fx.kind === 'forbidden_pair') {
      const hits = relations.filter(
        (r) => r.subject_token_id === fx.subject_token_id && fx.forbidden_object_token_ids.includes(r.object_token_id),
      );
      if (hits.length > 0) {
        ok = false;
        diffs.push(`unexpected:${hits.map((h) => h.relation_id).join(',')}`);
      }
    } else if (fx.kind === 'expected_candidate_quality') {
      const rel = relById.get(fx.relation_id);
      if (!rel || rel.quality !== fx.expected_quality) {
        ok = false;
        diffs.push(rel ? `quality=${rel.quality}` : 'missing_relation');
      }
    } else {
      ok = false;
      diffs.push(`unknown_fixture_kind:${fx.kind}`);
    }
    bumpFixture(ok);
    recordCheck(`fixture_r3_neg:${fx.name}`, ok, diffs.join(', '));
  }

  // Invariant 15: All 6 R3.1 predicates emitted in both Hebrew & Greek, zero planned/semantic predicates.
  {
    const badPreds = relations.filter((r) => !Object.hasOwn(PREDICATE_INVERSE, r.predicate));
    const missingLangPreds = [];
    for (const lang of ['hebrew', 'greek']) {
      const byPred = coverage.languages?.[lang]?.relations_by_predicate || {};
      for (const pred of Object.keys(PREDICATE_INVERSE)) {
        if (!(byPred[pred] > 0)) missingLangPreds.push(`${lang}:${pred}`);
      }
    }
    recordCheck(
      'invariant_15_r3_1_predicates_and_coordinations',
      badPreds.length === 0 && missingLangPreds.length === 0,
      `bad_preds=${badPreds.length}, missing=${missingLangPreds.join(',')}`,
    );
  }

  const evidenceMap = new Map(evidenceIndex.map((e) => [e.relation_id, e]));
  const summaryById = new Map(summaries.map((s) => [s.summary_id, s]));

  // Invariant 16 & 17: RelationSummaryV2 validation, evidence linking, and exact stats recomputation.
  {
    const badContract = [];
    const badStats = [];
    for (const s of summaries) {
      const expectedInv = PREDICATE_INVERSE[s.predicate];
      if (
        !s.summary_id ||
        s.lane !== 'grammatical' ||
        !expectedInv ||
        s.inverse_predicate !== expectedInv ||
        s.rule_version !== '1.2' ||
        !Array.isArray(s.evidence_ids) ||
        s.evidence_ids.length === 0
      ) {
        badContract.push(`${s.summary_id}:invalid_header`);
        continue;
      }
      const evRels = [];
      for (const eid of s.evidence_ids) {
        const rel = relById.get(eid);
        const ev = evidenceMap.get(eid);
        if (!rel || !ev || ev.summary_id !== s.summary_id || !frameById.has(rel.frame_id)) {
          badContract.push(`${s.summary_id}:bad_ev:${eid}`);
          continue;
        }
        const relTier = rel.quality === 'candidate' ? 'candidate_only' : 'high_quality';
        if (
          rel.subject_lemma_id !== s.from_lemma_id ||
          rel.object_lemma_id !== s.to_lemma_id ||
          rel.predicate !== s.predicate ||
          rel.evidence.edition !== s.source_edition ||
          relTier !== s.quality_tier
        ) {
          badContract.push(`${s.summary_id}:endpoint_mismatch:${eid}`);
          continue;
        }
        evRels.push(rel);
      }

      const distinctFrames = new Set(evRels.map((r) => r.frame_id)).size;
      const passages = new Set(evRels.map((r) => r.evidence.reference));
      const books = new Set([...passages].filter(Boolean).map((p) => p.split(/\s+/)[0]));
      const se = evRels.filter((r) => r.quality === 'source_explicit').length;
      const rd = evRels.filter((r) => r.quality === 'rule_derived').length;
      const cand = evRels.filter((r) => r.quality === 'candidate').length;
      const occ = s.quality_tier === 'high_quality' ? se + rd : 0;
      const negUnc = evRels.filter(
        (r) =>
          r.quality === 'candidate' ||
          r.qualifiers.polarity === 'negative' ||
          r.qualifiers.quotation === 'unknown' ||
          r.qualifiers.modality === 'unknown',
      ).length;
      const cmdPred = evRels.filter((r) => COMMAND_OR_PREDICTION_MODALITIES.has(r.qualifiers.modality)).length;

      const st = s.stats;
      const statsMatch =
        st.distinct_frames === distinctFrames &&
        st.occurrences === occ &&
        st.distinct_passages === passages.size &&
        st.distinct_books === books.size &&
        st.source_explicit === se &&
        st.rule_derived === rd &&
        st.candidate === cand &&
        st.negated_or_uncertain === negUnc &&
        st.command_or_prediction === cmdPred &&
        st.clauses_processed >= st.distinct_frames &&
        st.clauses_eligible >= st.clauses_processed;
      if (!statsMatch) {
        badStats.push(`${s.summary_id}:stats_mismatch`);
      }
    }
    recordCheck(
      'invariant_16_r3_2_summaries_valid_and_evidence_linked',
      badContract.length === 0 && evidenceIndex.length === relations.length,
      `summaries=${summaries.length}, evidence=${evidenceIndex.length}, errors=${badContract.length}`,
    );
    recordCheck(
      'invariant_17_r3_2_summary_stats_recomputed',
      badStats.length === 0,
      `checked=${summaries.length}, mismatches=${badStats.length}`,
    );
  }

  // Invariant 18: Strict high_quality vs candidate_only separation in summaries.
  {
    const leaks = [];
    for (const s of summaries) {
      if (s.quality_tier === 'high_quality') {
        if (s.stats.candidate !== 0 || s.stats.occurrences !== s.stats.source_explicit + s.stats.rule_derived) {
          leaks.push(`${s.summary_id}:hq_has_candidate`);
        }
      } else if (s.quality_tier === 'candidate_only') {
        if (s.stats.occurrences !== 0 || s.stats.source_explicit !== 0 || s.stats.rule_derived !== 0 || s.stats.candidate === 0) {
          leaks.push(`${s.summary_id}:cand_has_hq`);
        }
      } else {
        leaks.push(`${s.summary_id}:bad_tier:${s.quality_tier}`);
      }
    }
    recordCheck('invariant_18_r3_2_tier_separation', leaks.length === 0, `leaks=${leaks.join(',')}`);
  }

  // Invariant 19: Source edition separation (Nestle1904 vs SBLGNT) and Hebrew homograph separation.
  {
    const g2316Nestle = summaries.filter((s) => s.from_lemma_id === 'lemma:G2316' && s.source_edition === 'macula-greek-nestle1904');
    const g2316Sbl = summaries.filter((s) => s.from_lemma_id === 'lemma:G2316' && s.source_edition === 'macula-greek-sblgnt');
    const h1254aIn = byLemma['lemma:H1254a']?.incoming_summaries || [];
    const hasBaseH1254 = Object.hasOwn(byLemma, 'lemma:H1254');
    const h1254bIn = byLemma['lemma:H1254b']?.incoming_summaries || [];
    const mixedEd = summaries.filter((s) =>
      s.evidence_ids.some((eid) => relById.get(eid)?.evidence?.edition !== s.source_edition),
    );
    const ok =
      g2316Nestle.length > 0 &&
      g2316Sbl.length > 0 &&
      h1254aIn.length > 0 &&
      h1254bIn.length === 0 &&
      !hasBaseH1254 &&
      mixedEd.length === 0;
    recordCheck(
      'invariant_19_r3_2_edition_and_homograph_separation',
      ok,
      `G2316(nestle=${g2316Nestle.length},sbl=${g2316Sbl.length}), H1254a_in=${h1254aIn.length}, baseH1254=${hasBaseH1254}, mixed_ed=${mixedEd.length}`,
    );
  }

  // Invariant 20: indexes/by-lemma.json inverse navigation matches summaries/lemma-relation-summaries.jsonl.
  {
    const navErrs = [];
    const outSeen = new Set();
    const inSeen = new Set();
    for (const [lid, entry] of Object.entries(byLemma)) {
      if (entry.lemma_id !== lid) navErrs.push(`${lid}:key_mismatch`);
      for (const outItem of entry.outgoing_summaries || []) {
        const s = summaryById.get(outItem.summary_id);
        if (!s || s.from_lemma_id !== lid || s.to_lemma_id !== outItem.to_lemma_id) {
          navErrs.push(`out:${lid}:${outItem.summary_id}`);
        }
        outSeen.add(outItem.summary_id);
      }
      for (const inItem of entry.incoming_summaries || []) {
        const s = summaryById.get(inItem.summary_id);
        if (!s || s.to_lemma_id !== lid || s.from_lemma_id !== inItem.from_lemma_id || s.inverse_predicate !== inItem.inverse_predicate) {
          navErrs.push(`in:${lid}:${inItem.summary_id}`);
        }
        inSeen.add(inItem.summary_id);
      }
    }
    const ok = navErrs.length === 0 && outSeen.size === summaries.length && inSeen.size === summaries.length;
    recordCheck(
      'invariant_20_r3_2_by_lemma_inverse_navigation',
      ok,
      `lemmas=${Object.keys(byLemma).length}, out=${outSeen.size}/${summaries.length}, in=${inSeen.size}/${summaries.length}, errs=${navErrs.length}`,
    );
  }

  // Invariant 21: Zero synthetic Subject->Object SVO triples & strict multi-lane separation.
  {
    const badLanes = [];
    for (const lid of Object.keys(byLemma)) {
      const entry = lanes[lid];
      if (
        !entry ||
        entry.grammatical_lane?.lane !== 'grammatical' ||
        (entry.lexical_lane && entry.lexical_lane.lane !== 'lexical') ||
        (entry.contextual_lane && entry.contextual_lane.lane !== 'contextual') ||
        entry.research_inference_lane?.lane !== 'research_inference' ||
        entry.research_inference_lane?.status !== 'not_populated_in_r3'
      ) {
        badLanes.push(lid);
      }
    }
    // Every grammatical_subject_of summary must connect nominal subject lemma -> verbal predicate lemma (verified by frame)
    const badSvo = summaries.filter((s) =>
      s.evidence_ids.some((eid) => {
        const r = relById.get(eid);
        const f = r ? frameById.get(r.frame_id) : null;
        return VERBAL_ROLE_BY_PREDICATE[s.predicate] && f?.predicate?.token_id !== r?.object_token_id;
      }),
    );
    recordCheck(
      'invariant_21_r3_2_zero_synthetic_svo_and_lanes_separated',
      badLanes.length === 0 && badSvo.length === 0,
      `lane_errors=${badLanes.length}, synthetic_svo=${badSvo.length}`,
    );
  }

  // Invariant 22: Query demonstrations (H1254, H0430, G2316, G3056), manifest/report totals, and live MCP untouched.
  {
    const demos = queryDemos.demonstrations || {};
    const requiredKeys = ['H1254', 'H0430', 'G2316', 'G3056'];
    const demoOk =
      requiredKeys.every((k) => demos[k]?.homograph_separation_preserved === true && demos[k]?.results?.length > 0) &&
      JSON.stringify(demos.H1254?.target_lemma_ids) === JSON.stringify(['lemma:H1254a', 'lemma:H1254b']) &&
      demos.G2316?.results?.[0]?.grammatical_lane_by_edition?.['macula-greek-nestle1904'] &&
      demos.G2316?.results?.[0]?.grammatical_lane_by_edition?.['macula-greek-sblgnt'];
    const totalsMatch =
      manifest.counts?.frames_emitted === frames.length &&
      manifest.counts?.occurrence_relations_emitted === relations.length &&
      manifest.counts?.relation_summaries_total === summaries.length &&
      manifest.counts?.distinct_lemmas_in_graph === Object.keys(byLemma).length &&
      r3Quality.totals?.relation_summaries_total === summaries.length;
    const mcpDiff = execFileSync(
      'git',
      ['diff', '--name-only', 'HEAD', '--', 'supabase/functions/bible-mcp/relationships-v2.ts'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim();
    recordCheck(
      'invariant_22_r3_2_demos_manifest_and_mcp_unchanged',
      Boolean(demoOk && totalsMatch && mcpDiff === ''),
      `demoOk=${demoOk}, totalsMatch=${totalsMatch}, mcpDiff=${mcpDiff || 'clean'}`,
    );
  }
}

function runSuite() {
  const fixtures = readJson(FIXTURES_PATH);
  const inventory = readJson(path.join(ARTIFACTS_DIR, 'source-crosswalk-inventory.json'));
  const coverage = readJson(path.join(ARTIFACTS_DIR, 'coverage-report.json'));
  const frames = readJsonl(path.join(ARTIFACTS_DIR, 'frames.jsonl'));
  const relations = readJsonl(path.join(ARTIFACTS_DIR, 'occurrence-relations.jsonl'));
  const manifest = readJson(path.join(ARTIFACTS_DIR, 'manifest.json'));
  const summaries = readJsonl(path.join(ARTIFACTS_DIR, 'summaries', 'lemma-relation-summaries.jsonl'));
  const evidenceIndex = readJsonl(path.join(ARTIFACTS_DIR, 'indexes', 'evidence-by-id.jsonl'));
  const byLemma = readJson(path.join(ARTIFACTS_DIR, 'indexes', 'by-lemma.json'));
  const lanes = readJson(path.join(ARTIFACTS_DIR, 'lanes', 'lexical-and-contextual-lanes.json'));
  const queryDemos = readJson(path.join(ARTIFACTS_DIR, 'reports', 'query-demonstrations.json'));
  const r3Quality = readJson(path.join(ARTIFACTS_DIR, 'reports', 'r3-quality-report.json'));
  const r3Artifacts = { manifest, summaries, evidenceIndex, byLemma, lanes, queryDemos, r3Quality };

  const frameById = new Map(frames.map((f) => [f.frame_id, f]));
  const relById = new Map(relations.map((r) => [r.relation_id, r]));
  const relsByFrameId = new Map();
  for (const r of relations) {
    if (!relsByFrameId.has(r.frame_id)) relsByFrameId.set(r.frame_id, []);
    relsByFrameId.get(r.frame_id).push(r);
  }

  const xmlIdCache = new Map();
  for (const f of inventory.files) {
    const absXml = path.join(REPO_ROOT, '.artifacts', 'sources', f.source_file);
    xmlIdCache.set(f.source_file, parseXmlIds(absXml));
  }

  const checks = [];
  function recordCheck(name, ok, detail = '') {
    checks.push({ name, passed: Boolean(ok), detail });
  }

  // Invariant 1: Every high-quality / emitted edge resolves to real source XML IDs and non-null lemmas.
  {
    const bad = [];
    for (const r of relations) {
      const frame = frameById.get(r.frame_id);
      if (!frame) {
        bad.push(`${r.relation_id}:missing_frame`);
        continue;
      }
      const xmlIds = xmlIdCache.get(frame.source.source_file);
      if (!xmlIds?.has(r.subject_token_id) || !xmlIds?.has(r.object_token_id)) {
        bad.push(`${r.relation_id}:missing_xml_id`);
      }
      if (!/^lemma:[HG]\d+/.test(r.subject_lemma_id || '') || !/^lemma:[HG]\d+/.test(r.object_lemma_id || '')) {
        bad.push(`${r.relation_id}:invalid_lemma_id`);
      }
      if (frame.source.alignment_status === 'not_in_canonical_verse') {
        bad.push(`${r.relation_id}:edge_on_unmapped_verse`);
      }
    }
    recordCheck(
      'invariant_1_real_source_ids_and_lemmas',
      bad.length === 0,
      bad.length === 0 ? `verified ${relations.length} relations` : bad.join('; '),
    );
  }

  // Invariant 2: Endpoints belong to the same supported grammatical frame (verbal args vs phrase relations).
  {
    const bad = [];
    for (const r of relations) {
      const f = frameById.get(r.frame_id);
      if (!f) {
        bad.push(`${r.relation_id}:no_frame`);
        continue;
      }
      if (Object.hasOwn(VERBAL_ROLE_BY_PREDICATE, r.predicate)) {
        if (!f.predicate || f.predicate.token_id !== r.object_token_id || f.predicate.lemma_id !== r.object_lemma_id) {
          bad.push(`${r.relation_id}:predicate_mismatch`);
        }
        const expectedRole = VERBAL_ROLE_BY_PREDICATE[r.predicate];
        const hasRole = f.roles.some(
          (role) => role.role === expectedRole && role.head_token_id === r.subject_token_id,
        );
        if (!hasRole) {
          bad.push(`${r.relation_id}:role_missing_in_frame`);
        }
      } else if (Object.hasOwn(PHRASE_RULE_BY_PREDICATE, r.predicate)) {
        if (r.subject_token_id === r.object_token_id) {
          bad.push(`${r.relation_id}:self_loop`);
        }
        if (!PHRASE_RULE_BY_PREDICATE[r.predicate].has(r.evidence?.rule_id)) {
          bad.push(`${r.relation_id}:unexpected_phrase_rule:${r.evidence?.rule_id}`);
        }
        if (f.source?.clause_node_id !== r.evidence?.source_clause_id) {
          bad.push(`${r.relation_id}:clause_mismatch`);
        }
      } else {
        bad.push(`${r.relation_id}:unsupported_predicate:${r.predicate}`);
      }
    }
    recordCheck('invariant_2_same_frame_endpoints', bad.length === 0, bad.join('; '));
  }

  // Invariant 3: No cross-clause or cross-edition relationships fabricated.
  {
    const bad = [];
    for (const r of relations) {
      const f = frameById.get(r.frame_id);
      if (!f) continue;
      if (f.source.edition !== r.evidence.edition || f.source.clause_node_id !== r.evidence.source_clause_id) {
        bad.push(`${r.relation_id}:edition_or_clause_mismatch`);
      }
    }
    const n1904Count = relations.filter((r) => r.evidence.edition === 'macula-greek-nestle1904' && r.evidence.reference === 'JHN 3:17').length;
    const sblCount = relations.filter((r) => r.evidence.edition === 'macula-greek-sblgnt' && r.evidence.reference === 'JHN 3:17').length;
    recordCheck(
      'invariant_3_no_cross_clause_or_cross_edition_mixup',
      bad.length === 0 && n1904Count === 4 && sblCount === 4,
      `bad=${bad.length}, nestle1904_jhn3_17=${n1904Count}, sblgnt_jhn3_17=${sblCount}`,
    );
  }

  // Invariant 4 & Positive Fixtures
  let fixturePassed = 0;
  let fixtureFailed = 0;
  for (const fx of fixtures.positive_relations) {
    const rel = relById.get(fx.relation_id);
    let ok = Boolean(rel);
    const diffs = [];
    if (!rel) {
      diffs.push('missing_relation');
    } else {
      for (const k of ['predicate', 'subject_token_id', 'subject_lemma_id', 'object_token_id', 'object_lemma_id', 'quality']) {
        if (fx[k] !== undefined && rel[k] !== fx[k]) {
          ok = false;
          diffs.push(`${k}:${rel[k]}!=${fx[k]}`);
        }
      }
      if (fx.qualifiers) {
        for (const [qk, qv] of Object.entries(fx.qualifiers)) {
          if (rel.qualifiers?.[qk] !== qv) {
            ok = false;
            diffs.push(`qual.${qk}:${rel.qualifiers?.[qk]}!=${qv}`);
          }
        }
      }
    }
    if (ok) fixturePassed += 1;
    else fixtureFailed += 1;
    recordCheck(`fixture_pos:${fx.name}`, ok, diffs.join(', '));
  }

  // Invariant 5: Passive subjects never relabeled as semantic agents.
  {
    const semanticPreds = relations.filter((r) => /agent|patient|theme|experiencer/i.test(r.predicate));
    const passiveRels = relations.filter((r) => r.qualifiers.voice === 'passive');
    const passiveSubjectViolations = [];
    let passiveSubjects = 0;
    for (const r of passiveRels) {
      const f = frameById.get(r.frame_id);
      if (!f || !Object.hasOwn(VERBAL_ROLE_BY_PREDICATE, r.predicate)) continue;
      const isClauseSubject = f.roles.some(
        (role) => role.role === 'grammatical_subject' && role.head_token_id === r.subject_token_id,
      );
      if (r.predicate === 'grammatical_subject_of') {
        passiveSubjects += 1;
        if (!isClauseSubject) passiveSubjectViolations.push(`${r.relation_id}:missing_subj_role`);
      } else if (isClauseSubject && r.object_token_id === f.predicate?.token_id) {
        passiveSubjectViolations.push(`${r.relation_id}:subject_mislabeled:${r.predicate}`);
      }
    }
    recordCheck(
      'invariant_5_passive_not_semantic_agent',
      semanticPreds.length === 0 && passiveSubjects >= 2 && passiveSubjectViolations.length === 0,
      `passive_subjects=${passiveSubjects}, passive_rels=${passiveRels.length}, semantic=${semanticPreds.length}, violations=${passiveSubjectViolations.length}`,
    );
  }

  // Invariant 6 & 7 & Scope-Control Negative Fixtures
  for (const fx of fixtures.ambiguous_or_candidate_relations) {
    const rel = relById.get(fx.relation_id);
    const frame = rel ? frameById.get(rel.frame_id) : null;
    const ok = Boolean(
      rel &&
        rel.quality === fx.expected_quality &&
        frame &&
        frame.extraction.warnings.includes(fx.expected_warning),
    );
    if (ok) fixturePassed += 1;
    else fixtureFailed += 1;
    recordCheck(
      `fixture_ambig:${fx.name}`,
      ok,
      rel ? `quality=${rel.quality}, warnings=${JSON.stringify(frame?.extraction.warnings)}` : 'missing',
    );
  }

  for (const fx of fixtures.negative_scope_frames) {
    const frame = frameById.get(fx.frame_id);
    const fRels = relsByFrameId.get(fx.frame_id) || [];
    let ok = Boolean(frame);
    const diffs = [];
    if (!frame) {
      diffs.push('missing_frame');
    } else {
      if (fx.expected_relation_count !== undefined && fRels.length !== fx.expected_relation_count) {
        ok = false;
        diffs.push(`rel_count=${fRels.length}!=${fx.expected_relation_count}`);
      }
      if (fx.expected_verbal_relation_count !== undefined) {
        const verbalCount = fRels.filter((r) => Object.hasOwn(VERBAL_ROLE_BY_PREDICATE, r.predicate)).length;
        if (verbalCount !== fx.expected_verbal_relation_count) {
          ok = false;
          diffs.push(`verbal_rel_count=${verbalCount}!=${fx.expected_verbal_relation_count}`);
        }
      }
      if (fx.expected_quotation !== undefined && frame.context.quotation !== fx.expected_quotation) {
        ok = false;
        diffs.push(`quotation=${frame.context.quotation}!=${fx.expected_quotation}`);
      }
      if (fx.expected_speaker_scope !== undefined && frame.context.speaker_scope !== fx.expected_speaker_scope) {
        ok = false;
        diffs.push(`speaker=${frame.context.speaker_scope}`);
      }
      if (fx.expected_polarity !== undefined && frame.context.polarity !== fx.expected_polarity) {
        ok = false;
        diffs.push(`polarity=${frame.context.polarity}`);
      }
      if (fx.expected_modality !== undefined && frame.context.modality !== fx.expected_modality) {
        ok = false;
        diffs.push(`modality=${frame.context.modality}`);
      }
      if (fx.expected_alignment_status !== undefined && frame.source.alignment_status !== fx.expected_alignment_status) {
        ok = false;
        diffs.push(`align=${frame.source.alignment_status}`);
      }
      if (fx.expected_canonical_verse_ids !== undefined) {
        if (JSON.stringify(frame.source.canonical_verse_ids) !== JSON.stringify(fx.expected_canonical_verse_ids)) {
          ok = false;
          diffs.push(`cvids=${JSON.stringify(frame.source.canonical_verse_ids)}`);
        }
      }
      if (fx.expected_frame_quality !== undefined && frame.extraction.quality !== fx.expected_frame_quality) {
        ok = false;
        diffs.push(`quality=${frame.extraction.quality}`);
      }
      if (fx.expected_predicate_token_id !== undefined && frame.predicate?.token_id !== fx.expected_predicate_token_id) {
        ok = false;
        diffs.push(`pred_tok=${frame.predicate?.token_id}`);
      }
      if (fx.expected_predicate_lemma_id !== undefined && frame.predicate?.lemma_id !== fx.expected_predicate_lemma_id) {
        ok = false;
        diffs.push(`pred_lem=${frame.predicate?.lemma_id}`);
      }
      if (fx.must_differ_from_lemma !== undefined && frame.predicate?.lemma_id === fx.must_differ_from_lemma) {
        ok = false;
        diffs.push(`homograph_collided_with_${fx.must_differ_from_lemma}`);
      }
      if (fx.must_not_contain_lemma_ids) {
        const used = [frame.predicate?.lemma_id, ...frame.roles.map((r) => r.lemma_id)];
        for (const badLem of fx.must_not_contain_lemma_ids) {
          if (used.includes(badLem)) {
            ok = false;
            diffs.push(`forbidden_lemma_${badLem}`);
          }
        }
      }
      if (fx.expected_role_token_lemma) {
        const hit = frame.roles.find((r) => r.head_token_id === fx.expected_role_token_lemma.token_id);
        if (!hit || hit.lemma_id !== fx.expected_role_token_lemma.lemma_id) {
          ok = false;
          diffs.push(`role_lemma=${hit?.lemma_id}`);
        }
      }
    }
    if (ok) fixturePassed += 1;
    else fixtureFailed += 1;
    recordCheck(`fixture_neg:${fx.name}`, ok, diffs.join(', '));
  }

  for (const fx of fixtures.forbidden_relations) {
    let ok = true;
    const hits = [];
    if (fx.forbidden_subject_tokens) {
      for (const r of relations) {
        if (fx.forbidden_subject_tokens.includes(r.subject_token_id)) {
          ok = false;
          hits.push(r.relation_id);
        }
      }
    }
    if (fx.forbidden_object_tokens) {
      for (const r of relations) {
        if (fx.forbidden_object_tokens.includes(r.object_token_id)) {
          ok = false;
          hits.push(r.relation_id);
        }
      }
    }
    if (fx.forbidden_pair) {
      const [sTok, oTok] = fx.forbidden_pair;
      for (const r of relations) {
        if (r.subject_token_id === sTok && r.object_token_id === oTok) {
          ok = false;
          hits.push(r.relation_id);
        }
      }
    }
    if (ok) fixturePassed += 1;
    else fixtureFailed += 1;
    recordCheck(`fixture_forbidden:${fx.name}`, ok, hits.join(', '));
  }

  // Invariant 8: Hebrew homograph separation verified across corpus outputs + unmapped ambiguous homographs not guessed.
  {
    const gen1Pred = frameById.get('frame:macula-hebrew-wlc:GEN 1:1#cl0:svov1')?.predicate?.lemma_id;
    const jos17Pred = frameById.get('frame:macula-hebrew-wlc:JOS 17:15#cl3:svov1')?.predicate?.lemma_id;
    const ambigTokens = inventory.unmapped_tokens.filter((t) => t.status === 'ambiguous_homograph');
    const ok = gen1Pred === 'lemma:H1254a' && jos17Pred === 'lemma:H1254b' && ambigTokens.length >= 1;
    recordCheck(
      'invariant_8_hebrew_homographs_distinct',
      ok,
      `GEN1:1=${gen1Pred}, JOS17:15=${jos17Pred}, preserved_ambiguous=${ambigTokens.length}`,
    );
  }

  // Invariant 9: Byte-identical repeated build check in temporary directory across all manifest files.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bibleresearch-r3-repro-'));
  let reproOk = false;
  let reproDetails = '';
  try {
    runPilotBuild(tmpDir);
    const tmpManifest = readJson(path.join(tmpDir, 'manifest.json'));
    const artifactFiles = [
      ...new Set([...Object.keys(manifest.files || {}), ...Object.keys(tmpManifest.files || {})]),
      'manifest.json',
    ].sort();
    const diffs = [];
    for (const fname of artifactFiles) {
      const p1 = path.join(ARTIFACTS_DIR, fname);
      const p2 = path.join(tmpDir, fname);
      if (!fs.existsSync(p1) || !fs.existsSync(p2)) {
        diffs.push(`${fname}:missing(${fs.existsSync(p1)}/${fs.existsSync(p2)})`);
        continue;
      }
      const h1 = sha256File(p1);
      const h2 = sha256File(p2);
      if (h1 !== h2) {
        diffs.push(`${fname}:${h1.slice(0, 12)}!=${h2.slice(0, 12)}`);
      }
    }
    reproOk = diffs.length === 0;
    reproDetails = reproOk ? `all ${artifactFiles.length} artifacts byte-identical` : diffs.join(', ');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  recordCheck('invariant_9_byte_identical_rebuilds', reproOk, reproDetails);

  // Invariant 10: Zero restricted license fields in any exported R2 or R3 JSON artifact.
  {
    const hits = [
      ...findRestrictedKeys(inventory, 'inventory'),
      ...findRestrictedKeys(coverage, 'coverage'),
      ...findRestrictedKeys(frames, 'frames'),
      ...findRestrictedKeys(relations, 'relations'),
      ...findRestrictedKeys(manifest, 'manifest'),
      ...findRestrictedKeys(summaries, 'summaries'),
      ...findRestrictedKeys(evidenceIndex, 'evidenceIndex'),
      ...findRestrictedKeys(byLemma, 'byLemma'),
      ...findRestrictedKeys(lanes, 'lanes'),
      ...findRestrictedKeys(queryDemos, 'queryDemos'),
      ...findRestrictedKeys(r3Quality, 'r3Quality'),
    ];
    recordCheck(
      'invariant_10_zero_restricted_license_fields',
      hits.length === 0,
      hits.join(', '),
    );
  }

  // Invariant 11: Stratified scale (200-500 clauses) and resolvable clause_node_id matching syntax_nodes.
  {
    const badNodeIds = [];
    const nodeKeyRe = /^macula_tree:(macula-hebrew-wlc|macula-greek-nestle1904|macula-greek-sblgnt):.+#s\d+(\.\d+)*$/;
    for (const f of frames) {
      if (!nodeKeyRe.test(f.source.clause_node_id || '')) {
        badNodeIds.push(`${f.frame_id}:${f.source.clause_node_id}`);
      }
      for (const r of relsByFrameId.get(f.frame_id) || []) {
        if (r.evidence.source_clause_id !== f.source.clause_node_id) {
          badNodeIds.push(`${r.relation_id}:clause_node_mismatch`);
        }
      }
    }
    let shardChecked = 0;
    let shardMissing = [];
    if (fs.existsSync(SYNTAX_NODES_DIR)) {
      const canonicalKeys = new Set(
        frames.filter((f) => f.source.alignment_status !== 'not_in_canonical_verse').map((f) => f.source.clause_node_id),
      );
      shardChecked = canonicalKeys.size;
      const foundKeys = new Set();
      const shardFiles = fs.readdirSync(SYNTAX_NODES_DIR).filter((n) => n.endsWith('.jsonl.gz')).sort();
      for (const sf of shardFiles) {
        const text = zlib.gunzipSync(fs.readFileSync(path.join(SYNTAX_NODES_DIR, sf))).toString('utf8');
        for (const ln of text.split(/\r?\n/)) {
          if (!ln) continue;
          const m = /"node_key":"([^"]+)"/.exec(ln);
          if (m && canonicalKeys.has(m[1])) {
            foundKeys.add(m[1]);
          }
        }
      }
      shardMissing = [...canonicalKeys].filter((k) => !foundKeys.has(k));
    }
    const scaleOk = frames.length >= 200 && frames.length <= 500;
    recordCheck(
      'invariant_11_scale_and_clause_node_ids',
      scaleOk && badNodeIds.length === 0 && shardMissing.length === 0,
      `frames=${frames.length}, bad_node_ids=${badNodeIds.length}, syntax_node_shard_matches=${shardChecked - shardMissing.length}/${shardChecked}`,
    );
  }

  // Invariant 12: R2.1 confirmed defect regressions and non-orphan include_candidates=false filtering.
  {
    const baseH0776Hits = [];
    for (const f of frames) {
      if (f.predicate?.lemma_id === 'lemma:H0776') baseH0776Hits.push(`${f.frame_id}:pred`);
      for (const role of f.roles) {
        if (role.lemma_id === 'lemma:H0776') baseH0776Hits.push(`${f.frame_id}:${role.head_token_id}`);
      }
    }
    for (const r of relations) {
      if (r.subject_lemma_id === 'lemma:H0776' || r.object_lemma_id === 'lemma:H0776') {
        baseH0776Hits.push(r.relation_id);
      }
    }
    const jhn13 = frameById.get('frame:macula-greek-nestle1904:JHN 1:3#cl0:svov1');
    const badUnresolvedQuot = frames.filter((f) => f.context.speaker_scope === 'unknown' && f.context.quotation === 'none');
    const psa30 = frameById.get('frame:macula-hebrew-wlc:PSA 3:0#cl2:svov1');
    const psa31 = frameById.get('frame:macula-hebrew-wlc:PSA 3:1#cl1:svov1');

    // Simulate include_candidates=false across every (edition, reference) group.
    const orphanErrors = [];
    const byPassage = new Map();
    for (const f of frames) {
      const k = `${f.source.edition}::${f.source.reference}`;
      if (!byPassage.has(k)) byPassage.set(k, []);
      byPassage.get(k).push(f);
    }
    for (const [k, pFrames] of byPassage.entries()) {
      const pFrameIds = new Set(pFrames.map((f) => f.frame_id));
      const pRels = relations.filter((r) => pFrameIds.has(r.frame_id));
      const retainedRels = pRels.filter((r) => r.quality !== 'candidate');
      const supportedIds = new Set(retainedRels.map((r) => r.frame_id));
      const retainedFrames = pFrames.filter((f) => f.extraction.quality !== 'candidate' || supportedIds.has(f.frame_id));
      const retainedFrameSet = new Set(retainedFrames.map((f) => f.frame_id));
      for (const r of retainedRels) {
        if (!retainedFrameSet.has(r.frame_id)) orphanErrors.push(`${k}:${r.relation_id}`);
      }
    }

    const ok =
      baseH0776Hits.length === 0 &&
      jhn13?.context.modality === 'indicative' &&
      jhn13?.context.quotation === 'unknown' &&
      badUnresolvedQuot.length === 0 &&
      Boolean(psa30 && psa31) &&
      orphanErrors.length === 0;
    recordCheck(
      'invariant_12_r2_1_defect_regressions',
      ok,
      `baseH0776=${baseH0776Hits.length}, jhn1_3_mod=${jhn13?.context.modality}, unresolved_none_quot=${badUnresolvedQuot.length}, orphans=${orphanErrors.length}`,
    );
  }

  // Invariant 13: R2.1 MCP bundle preservation inside R3 and zero live parsing duplication.
  {
    const mcpSource = fs.readFileSync(MCP_REL_PATH, 'utf8');
    const forbiddenLiveTokens = ['extractLiveFromSyntaxPayload', 'live_syntax_fallback', 'HeadRuleSet', 'resolvePhraseHead'];
    const foundDup = forbiddenLiveTokens.filter((tok) => mcpSource.includes(tok));
    const b64Match = /const PILOT_B64 = (?:"([^"]*)"|`([^`]*)`);/.exec(mcpSource);
    let parityOk = false;
    let parityDetail = 'missing_PILOT_B64';
    if (b64Match) {
      const b64Str = (b64Match[1] ?? b64Match[2] ?? '').replace(/\s+/g, '');
      const bundle = JSON.parse(zlib.inflateRawSync(Buffer.from(b64Str, 'base64')).toString('utf8'));
      const missingFrames = bundle.pf.filter((f) => !frameById.has(f.frame_id));
      const relMismatches = [];
      for (const r of bundle.pr) {
        const current = relById.get(r.relation_id);
        if (
          !current ||
          current.subject_token_id !== r.subject_token_id ||
          current.subject_lemma_id !== r.subject_lemma_id ||
          current.object_token_id !== r.object_token_id ||
          current.object_lemma_id !== r.object_lemma_id ||
          current.predicate !== r.predicate ||
          current.quality !== r.quality ||
          JSON.stringify(current.qualifiers) !== JSON.stringify(r.qualifiers)
        ) {
          relMismatches.push(r.relation_id);
        }
      }
      parityOk = missingFrames.length === 0 && relMismatches.length === 0 && bundle.pf.length > 0 && bundle.pr.length > 0;
      parityDetail = `preserved_r2_frames=${bundle.pf.length - missingFrames.length}/${bundle.pf.length}, preserved_r2_rels=${bundle.pr.length - relMismatches.length}/${bundle.pr.length}, dup=${foundDup.length}`;
    }
    recordCheck('invariant_13_mcp_bundle_parity_and_no_live_duplication', foundDup.length === 0 && parityOk, parityDetail);
  }

  runR3FixturesAndGraphChecks({
    fixtures,
    coverage,
    frames,
    relations,
    frameById,
    relById,
    relsByFrameId,
    r3Artifacts,
    recordCheck,
    bumpFixture: (ok) => {
      if (ok) fixturePassed += 1;
      else fixtureFailed += 1;
    },
  });

  // Invariant 14: Precision and recall on independently inspected Hebrew & Greek gold clauses.
  const evalLanguageGold = (langKey, items) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    const fpDetails = [];
    const fnDetails = [];
    const unsupportedCounts = {};
    for (const item of items) {
      if (item.unsupported_kind) {
        unsupportedCounts[item.unsupported_kind] = (unsupportedCounts[item.unsupported_kind] || 0) + 1;
      }
      const frame = frameById.get(item.frame_id);
      if (!frame) {
        fnDetails.push(`${item.frame_id}:missing_frame`);
        fn += item.expected_high_quality_relation_ids.length || 1;
        continue;
      }
      const actualHigh = new Set(
        (relsByFrameId.get(item.frame_id) || []).filter((r) => r.quality !== 'candidate').map((r) => r.relation_id),
      );
      const expected = new Set(item.expected_high_quality_relation_ids);
      for (const aid of actualHigh) {
        if (expected.has(aid)) tp += 1;
        else {
          fp += 1;
          fpDetails.push(aid);
        }
      }
      for (const eid of expected) {
        if (!actualHigh.has(eid)) {
          fn += 1;
          fnDetails.push(eid);
        }
      }
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
    return {
      language: langKey,
      clauses_inspected: items.length,
      tp,
      fp,
      fn,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      unsupported_counts: unsupportedCounts,
      fp_details: fpDetails,
      fn_details: fnDetails,
    };
  };

  const hebrewMetrics = evalLanguageGold('hebrew', fixtures.gold_inspected_clauses.hebrew);
  const greekMetrics = evalLanguageGold('greek', fixtures.gold_inspected_clauses.greek);
  recordCheck(
    'invariant_14_gold_precision_and_recall',
    hebrewMetrics.fp === 0 && greekMetrics.fp === 0 && hebrewMetrics.tp > 0 && greekMetrics.tp > 0,
    `hebrew P=${hebrewMetrics.precision} R=${hebrewMetrics.recall} (tp=${hebrewMetrics.tp},fp=${hebrewMetrics.fp},fn=${hebrewMetrics.fn}); greek P=${greekMetrics.precision} R=${greekMetrics.recall} (tp=${greekMetrics.tp},fp=${greekMetrics.fp},fn=${greekMetrics.fn})`,
  );

  const passedCount = checks.filter((c) => c.passed).length;
  const failedCount = checks.filter((c) => !c.passed).length;

  const report = {
    schema_version: '2.0',
    summary: {
      total_checks: checks.length,
      passed: passedCount,
      failed: failedCount,
      fixtures_passed: fixturePassed,
      fixtures_failed: fixtureFailed,
    },
    precision_and_recall: {
      hebrew: hebrewMetrics,
      greek: greekMetrics,
    },
    coverage_snapshot: coverage.languages,
    checks,
  };

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'test-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  console.log(JSON.stringify({ summary: report.summary, precision_and_recall: report.precision_and_recall }, null, 2));
  if (failedCount > 0) {
    for (const c of checks.filter((x) => !x.passed)) {
      console.error(`FAIL [${c.name}]: ${c.detail}`);
    }
    process.exitCode = 1;
  }
}

runSuite();
