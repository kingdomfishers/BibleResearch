// @file: src/relationships/path-ranker.ts
// @feature: relationships-r9c
// Deterministic evidence-aware path ranking, hub penalties, and anti-false-discovery explanations.

import { fnv1a64Hex, isFunctionWordPos } from './adjacency-loader.ts';
import type {
  GraphEdge,
  HubPenaltyConfig,
  JoinScope,
  MultiHopPath,
  PathExplanation,
  PathStep,
  R12DestinationRecommendation,
  R12EndpointEpistemicStatus,
  R12EpistemicLayer,
  R12PathInput,
  R12ProofStepInput,
  R12ScoredPath,
  RankingFactors,
  RankingSummary,
} from './multihop-types.ts';

// === @section:logic:hub-config-and-edge-scoring ===
export const DEFAULT_HUB_PENALTY_CONFIG: HubPenaltyConfig = {
  enabled: true,
  function_word_penalty: 28,
  hub_degree_threshold: 250,
  hub_degree_weight: 8,
  allow_function_word_intermediates: true,
};

export function mergeHubConfig(partial?: Partial<HubPenaltyConfig>): HubPenaltyConfig {
  return {
    enabled: partial?.enabled ?? DEFAULT_HUB_PENALTY_CONFIG.enabled,
    function_word_penalty: partial?.function_word_penalty ?? DEFAULT_HUB_PENALTY_CONFIG.function_word_penalty,
    hub_degree_threshold: partial?.hub_degree_threshold ?? DEFAULT_HUB_PENALTY_CONFIG.hub_degree_threshold,
    hub_degree_weight: partial?.hub_degree_weight ?? DEFAULT_HUB_PENALTY_CONFIG.hub_degree_weight,
    allow_function_word_intermediates:
      partial?.allow_function_word_intermediates ?? DEFAULT_HUB_PENALTY_CONFIG.allow_function_word_intermediates,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const GRAMMATICAL_SPECIFICITY: Record<string, number> = {
  grammatical_subject_of: 28,
  grammatical_object_of: 27,
  grammatical_indirect_object_of: 25,
  possessive_construction_with: 26,
  vocative_addressee_of: 26,
  adjectival_modification_of: 24,
  nominal_apposition_with: 24,
  clause_head_governed_by: 22,
  prepositional_complement_of: 14,
  co_participates_in_clause_with: 12,
};

function scoreSingleEdgeStrength(edge: Pick<GraphEdge, 'layer' | 'predicate' | 'quality' | 'stats' | 'uncertainty'>): number {
  if (edge.layer === 'grammatical') {
    const base = GRAMMATICAL_SPECIFICITY[edge.predicate] ?? 20;
    const qMult = edge.quality === 'source_explicit' ? 1.05 : edge.quality === 'rule_derived' ? 0.92 : 0.72;
    return base * qMult;
  }
  if (edge.layer === 'lexical') {
    if (edge.predicate === 'aramaic_cognate_parallel' || edge.predicate === 'derived_from_root_anchor') return 26;
    if (edge.predicate === 'sense_subdivision_of' || edge.predicate === 'has_sense_subdivision') return 25;
    if (edge.predicate === 'base_root_anchor' || edge.predicate === 'root_anchored_by') return 22;
    if (edge.predicate === 'greek_loan_or_transliteration' || edge.predicate === 'compound_formation_component') return 22;
    return 18;
  }
  if (edge.layer === 'lxx_translation') {
    const share = Math.min(1, Math.max(0, edge.stats.translation_share ?? 0));
    const base = edge.uncertainty.homograph_ambiguity ? 12 : 20;
    return base + share * 8;
  }
  // Contextual: collocation and same_clause carry real syntactic proximity; raw same_verse alone is much weaker.
  const colloc = edge.stats.collocation_distance_le_3 ?? 0;
  const sameClause = edge.stats.same_clause ?? 0;
  const sameVerse = edge.stats.same_verse ?? 0;
  if (colloc > 0) return 15 + Math.min(8, Math.log2(1 + colloc) * 2.5);
  if (sameClause > 0) return 12 + Math.min(6, Math.log2(1 + sameClause) * 2);
  return 5 + Math.min(4, Math.log2(1 + sameVerse) * 1.1);
}

export function edgePreRankScore(
  edge: GraphEdge,
  hubConfig: HubPenaltyConfig,
  penalizeToEntityAsIntermediate: boolean,
): number {
  let score = scoreSingleEdgeStrength(edge);
  const passages = edge.stats.distinct_passages ?? edge.stats.same_verse ?? edge.stats.published_count ?? 1;
  score += Math.min(8, Math.log2(1 + Math.max(0, passages)) * 2);
  if (edge.uncertainty.is_uncertain) score -= 6;
  if (penalizeToEntityAsIntermediate && hubConfig.enabled) {
    if (isFunctionWordPos(edge.to_entity.pos)) score -= hubConfig.function_word_penalty;
    const deg = edge.to_entity.degree_hint ?? 0;
    if (deg > hubConfig.hub_degree_threshold) {
      score -= hubConfig.hub_degree_weight * Math.log2(1 + deg / hubConfig.hub_degree_threshold);
    }
  }
  return round2(score);
}

// === @section:logic:path-step-and-id ===
export function buildPathStep(hopIndex: number, edge: GraphEdge): PathStep {
  return {
    hop_index: hopIndex,
    from_entity: edge.from_entity,
    to_entity: edge.to_entity,
    canonical_source_entity: edge.canonical_source,
    canonical_target_entity: edge.canonical_target,
    predicate: edge.predicate,
    display_predicate: edge.display_predicate,
    display_label: edge.display_label,
    direction: edge.edge_direction,
    traversal_direction: edge.traversal_direction,
    layer: edge.layer,
    epistemic_class: edge.epistemic_class,
    source_relationship_id: edge.source_relationship_id,
    quality: edge.quality,
    editions: edge.editions,
    language: edge.language,
    uncertainty: edge.uncertainty,
    evidence_summary: {
      ...edge.stats,
      sample_references: edge.sample_references,
      sample_witnesses: edge.sample_witnesses,
    },
    provenance: edge.provenance,
    guardrails: edge.guardrails,
  };
}

export function computePathId(steps: PathStep[]): string {
  const sig = steps
    .map(
      (s) =>
        `${s.from_entity.entity_key}|${s.layer}|${s.predicate}|${s.traversal_direction}|${s.source_relationship_id}|${s.to_entity.entity_key}`,
    )
    .join('->');
  return `path:${fnv1a64Hex(sig).slice(0, 16)}`;
}

// === @section:logic:path-scoring ===
function computeIntermediateHubPenalty(
  steps: PathStep[],
  hubConfig: HubPenaltyConfig,
): { penalty: number; penalizedNodes: string[] } {
  if (!hubConfig.enabled || steps.length <= 1) return { penalty: 0, penalizedNodes: [] };
  let total = 0;
  const penalizedNodes: string[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const mid = steps[i].to_entity;
    let nodePen = 0;
    if (isFunctionWordPos(mid.pos)) {
      nodePen += hubConfig.function_word_penalty;
    }
    const deg = mid.degree_hint ?? 0;
    if (deg > hubConfig.hub_degree_threshold) {
      nodePen += hubConfig.hub_degree_weight * Math.log2(1 + deg / hubConfig.hub_degree_threshold);
    }
    if (nodePen > 0) {
      total += nodePen;
      penalizedNodes.push(`${mid.entity_key} (${mid.label || mid.pos || 'hub'}, -${round2(nodePen)})`);
    }
  }
  return { penalty: round2(total), penalizedNodes };
}

function computeFactors(
  steps: PathStep[],
  hubConfig: HubPenaltyConfig,
  joinScope: JoinScope,
): { factors: RankingFactors; penalizedNodes: string[] } {
  const hopCount = steps.length;
  let strengthSum = 0;
  let passageSum = 0;
  let distinctSum = 0;
  let provSum = 0;
  let uncertaintyPen = 0;

  for (const s of steps) {
    strengthSum += scoreSingleEdgeStrength({
      layer: s.layer,
      predicate: s.predicate,
      quality: s.quality,
      stats: s.evidence_summary,
      uncertainty: s.uncertainty,
    });
    const passages =
      s.evidence_summary.distinct_passages ??
      s.evidence_summary.same_clause ??
      s.evidence_summary.same_verse ??
      s.evidence_summary.published_count ??
      1;
    // Cap passage support per step so raw frequency alone never dominates.
    passageSum += Math.min(10, Math.log2(1 + Math.max(0, passages)) * 2.1);

    if (s.layer === 'contextual') {
      distinctSum += (s.evidence_summary.collocation_distance_le_3 ?? 0) > 0 ? 7 : (s.evidence_summary.same_clause ?? 0) > 0 ? 4 : 1;
    } else if (s.layer === 'lxx_translation') {
      distinctSum += 6 + Math.min(6, (s.evidence_summary.translation_share ?? 0) * 6);
    } else {
      distinctSum += 10;
    }

    if (s.quality === 'source_explicit' || s.quality === 'attested_lexicon' || s.quality === 'attested_lexical_fact') provSum += 10;
    else if (s.quality === 'rule_derived' || s.quality === 'translation_candidate') provSum += 7;
    else if (s.quality === 'contextual_stat' || s.quality === 'statistical_association') provSum += 6;
    else provSum += 3;

    if (s.uncertainty.homograph_ambiguity) uncertaintyPen += 9;
    else if (s.uncertainty.is_uncertain) uncertaintyPen += 5;
    if (s.quality === 'candidate_relation' || s.quality === 'candidate') uncertaintyPen += 4;
  }

  const evidence_strength = round2(strengthSum / hopCount);
  const directness_bonus = hopCount === 1 ? 18 : hopCount === 2 ? 4 : 0;
  const passage_support = round2(passageSum / hopCount);
  const distinctiveness = round2(distinctSum / hopCount);
  const provenance_quality = round2(provSum / hopCount);
  const hop_penalty = hopCount === 1 ? 0 : hopCount === 2 ? 10 : 22;
  const hubRes = computeIntermediateHubPenalty(steps, hubConfig);
  const same_frame_bonus = joinScope === 'same_frame' ? 12 : joinScope === 'same_passage' ? 5 : 0;

  return {
    factors: {
      evidence_strength,
      directness_bonus,
      passage_support,
      distinctiveness,
      provenance_quality,
      hop_penalty,
      uncertainty_penalty: round2(uncertaintyPen),
      hub_penalty: hubRes.penalty,
      same_frame_bonus,
    },
    penalizedNodes: hubRes.penalizedNodes,
  };
}

// === @section:logic:explanations-and-ranking ===
function buildWhyRanked(factors: RankingFactors, penalizedNodes: string[], joinScope: JoinScope, hopCount: number): string {
  const positives: string[] = [
    `evidence=${factors.evidence_strength}`,
    `passage_support=${factors.passage_support}`,
    `distinctiveness=${factors.distinctiveness}`,
    `provenance=${factors.provenance_quality}`,
  ];
  if (factors.directness_bonus > 0) positives.push(`directness=+${factors.directness_bonus}`);
  if (factors.same_frame_bonus > 0) positives.push(`${joinScope}=+${factors.same_frame_bonus}`);

  const negatives: string[] = [];
  if (factors.hop_penalty > 0) negatives.push(`${hopCount}-hop=-${factors.hop_penalty}`);
  if (factors.uncertainty_penalty > 0) negatives.push(`uncertainty=-${factors.uncertainty_penalty}`);
  if (factors.hub_penalty > 0) negatives.push(`hubs=[${penalizedNodes.join(', ')}]`);

  return `Positives: ${positives.join(', ')}.${negatives.length ? ` Deductions: ${negatives.join(', ')}.` : ''}`;
}

function buildDoesNotEstablish(steps: PathStep[]): string[] {
  const out = new Set<string>();
  const layers = new Set(steps.map((s) => s.layer));
  const hasRootOrSense = steps.some(
    (s) =>
      s.from_entity.entity_kind !== 'lemma' ||
      s.to_entity.entity_kind !== 'lemma' ||
      s.predicate.includes('root') ||
      s.predicate.includes('sense'),
  );
  const langs = new Set<string>();
  for (const s of steps) {
    if (s.from_entity.language) langs.add(s.from_entity.language);
    if (s.to_entity.language) langs.add(s.to_entity.language);
  }
  if (layers.has('contextual')) {
    out.add('Contextual proximity or statistical co-occurrence does not establish shared semantic meaning or lexical dependency.');
  }
  if (hasRootOrSense || layers.has('lexical')) {
    out.add('Lexical root, derivation, cognate, or sense relationships do not establish semantic synonymy.');
  }
  if (layers.has('lxx_translation')) {
    out.add('An LXX translation candidate does not establish identical Hebrew and Greek semantic ranges or direct New Testament dependence.');
  }
  if ((langs.has('hbo') || langs.has('arc')) && langs.has('grc')) {
    out.add('A path crossing between Hebrew/Aramaic and Greek does not automatically establish a New Testament theological connection.');
  }
  out.add('Heuristic ranking reflects source evidence richness and specificity, not the probability that an interpretive hypothesis is true.');
  return Array.from(out);
}

export function scoreAndExplainPath(
  steps: PathStep[],
  hubConfig: HubPenaltyConfig,
  joinInfo: { join_scope: JoinScope; shared_frame_ids: string[]; shared_references: string[] },
): {
  ranking: RankingSummary;
  uncertainty_indicators: string[];
  interpretation_guardrails: string[];
  explanation: PathExplanation;
} {
  const { factors, penalizedNodes } = computeFactors(steps, hubConfig, joinInfo.join_scope);
  const rawScore =
    factors.evidence_strength +
    factors.directness_bonus +
    factors.passage_support +
    factors.distinctiveness +
    factors.provenance_quality +
    factors.same_frame_bonus -
    factors.hop_penalty -
    factors.uncertainty_penalty -
    factors.hub_penalty;

  const ranking: RankingSummary = {
    score: round2(rawScore),
    score_kind: 'heuristic_evidence_relevance_not_truth_probability',
    factors,
    why_ranked: buildWhyRanked(factors, penalizedNodes, joinInfo.join_scope, steps.length),
  };

  const uncertaintySet = new Set<string>();
  const guardrailSet = new Set<string>();
  for (const s of steps) {
    for (const n of s.uncertainty.notes) uncertaintySet.add(n);
    if (s.quality === 'candidate_relation' || s.quality === 'candidate') {
      uncertaintySet.add(`Hop ${s.hop_index} uses candidate-grade evidence (${s.quality}).`);
    }
    for (const g of s.guardrails) guardrailSet.add(g);
  }
  if (joinInfo.join_scope === 'cross_passage') {
    uncertaintySet.add('Multi-hop grammatical chain spans non-identical passages (cross-passage join).');
  }

  const startLabel = steps[0].from_entity.label || steps[0].from_entity.entity_key;
  const endLabel = steps[steps.length - 1].to_entity.label || steps[steps.length - 1].to_entity.entity_key;
  const layerList = Array.from(new Set(steps.map((s) => s.layer))).join(' -> ');
  const predList = steps.map((s) => s.display_predicate).join(' -> ');
  const refNote =
    joinInfo.shared_references.length > 0
      ? ` Shared witness references: ${joinInfo.shared_references.slice(0, 5).join(', ')}.`
      : '';
  const establishes = `${steps.length}-hop path from ${steps[0].from_entity.entity_key} (${startLabel}) to ${steps[steps.length - 1].to_entity.entity_key} (${endLabel}) across [${layerList}] via [${predList}] (${joinInfo.join_scope}).${refNote}`;

  return {
    ranking,
    uncertainty_indicators: Array.from(uncertaintySet),
    interpretation_guardrails: Array.from(guardrailSet),
    explanation: {
      establishes,
      does_not_establish: buildDoesNotEstablish(steps),
      join_scope: joinInfo.join_scope,
      shared_frame_ids: joinInfo.shared_frame_ids,
      shared_references: joinInfo.shared_references,
    },
  };
}

export function compareMultiHopPaths(a: MultiHopPath, b: MultiHopPath): number {
  if (b.ranking.score !== a.ranking.score) return b.ranking.score - a.ranking.score;
  if (a.hop_count !== b.hop_count) return a.hop_count - b.hop_count;
  return a.path_id.localeCompare(b.path_id);
}

// === @section:logic:r12-proof-ranker ===
/**
 * Authoritative TypeScript integration of research/r12/proof-ranker.mjs.
 * Scores are heuristic discovery priorities, NEVER theological probabilities.
 */
export const R12_SCORE_VERSION = 'r12-ranker-v2';

const CANONICAL_BOOK_ALIASES: Record<string, number> = {
  genesis: 1, gen: 1, ge: 1, gn: 1,
  exodus: 2, exod: 2, exo: 2, ex: 2,
  leviticus: 3, lev: 3, le: 3, lv: 3,
  numbers: 4, num: 4, nu: 4, nm: 4, nb: 4,
  deuteronomy: 5, deut: 5, deu: 5, dt: 5,
  joshua: 6, josh: 6, jos: 6, jsh: 6,
  judges: 7, judg: 7, jdg: 7, jg: 7, jdgs: 7,
  ruth: 8, rth: 8, ru: 8,
  '1samuel': 9, '1sam': 9, '1sa': 9, '1sm': 9, isamuel: 9, isam: 9,
  '2samuel': 10, '2sam': 10, '2sa': 10, '2sm': 10, iisamuel: 10, iisam: 10,
  '1kings': 11, '1kgs': 11, '1ki': 11, '1kg': 11, '1k': 11, ikings: 11, ikgs: 11,
  '2kings': 12, '2kgs': 12, '2ki': 12, '2kg': 12, '2k': 12, iikings: 12, iikgs: 12,
  '1chronicles': 13, '1chron': 13, '1chr': 13, '1ch': 13, ichronicles: 13, ichr: 13,
  '2chronicles': 14, '2chron': 14, '2chr': 14, '2ch': 14, iichronicles: 14, iichr: 14,
  ezra: 15, ezr: 15,
  nehemiah: 16, neh: 16, ne: 16,
  esther: 17, esth: 17, est: 17, es: 17,
  job: 18, jb: 18,
  psalms: 19, psalm: 19, psa: 19, psm: 19, pss: 19, ps: 19,
  proverbs: 20, prov: 20, pro: 20, prv: 20, pr: 20,
  ecclesiastes: 21, eccles: 21, eccl: 21, ecc: 21, ec: 21, qoh: 21, qoheleth: 21,
  songofsolomon: 22, songofsongs: 22, song: 22, sos: 22, sng: 22, sg: 22, cant: 22, canticles: 22,
  isaiah: 23, isa: 23, is: 23,
  jeremiah: 24, jer: 24, je: 24, jr: 24,
  lamentations: 25, lam: 25, la: 25,
  ezekiel: 26, ezek: 26, eze: 26, ezk: 26,
  daniel: 27, dan: 27, da: 27, dn: 27,
  hosea: 28, hos: 28, ho: 28,
  joel: 29, joe: 29, jl: 29,
  amos: 30, amo: 30, am: 30,
  obadiah: 31, obad: 31, ob: 31,
  jonah: 32, jon: 32, jnh: 32,
  micah: 33, mic: 33, mc: 33,
  nahum: 34, nah: 34, na: 34,
  habakkuk: 35, hab: 35, hb: 35,
  zephaniah: 36, zeph: 36, zep: 36, zp: 36,
  haggai: 37, hag: 37, hg: 37,
  zechariah: 38, zech: 38, zec: 38, zc: 38,
  malachi: 39, mal: 39, ml: 39,
  matthew: 40, matt: 40, mat: 40, mt: 40,
  mark: 41, mrk: 41, mar: 41, mk: 41, mr: 41,
  luke: 42, luk: 42, lk: 42,
  john: 43, joh: 43, jhn: 43, jn: 43,
  acts: 44, act: 44, ac: 44,
  romans: 45, rom: 45, ro: 45, rm: 45,
  '1corinthians': 46, '1cor': 46, '1co': 46, icorinthians: 46, icor: 46,
  '2corinthians': 47, '2cor': 47, '2co': 47, iicorinthians: 47, iicor: 47,
  galatians: 48, gal: 48, ga: 48,
  ephesians: 49, eph: 49, ep: 49,
  philippians: 50, phil: 50, php: 50, pp: 50,
  colossians: 51, col: 51, co: 51,
  '1thessalonians': 52, '1thess': 52, '1thes': 52, '1th': 52, ithessalonians: 52, ithess: 52,
  '2thessalonians': 53, '2thess': 53, '2thes': 53, '2th': 53, iithessalonians: 53, iithess: 53,
  '1timothy': 54, '1tim': 54, '1ti': 54, '1tm': 54, itimothy: 54, itim: 54,
  '2timothy': 55, '2tim': 55, '2ti': 55, '2tm': 55, iitimothy: 55, iitim: 55,
  titus: 56, tit: 56, ti: 56,
  philemon: 57, philem: 57, phlm: 57, phm: 57, pm: 57,
  hebrews: 58, heb: 58, he: 58,
  james: 59, jas: 59, jam: 59, jm: 59,
  '1peter': 60, '1pet': 60, '1pe': 60, '1pt': 60, '1p': 60, ipeter: 60, ipet: 60,
  '2peter': 61, '2pet': 61, '2pe': 61, '2pt': 61, '2p': 61, iipeter: 61, iipet: 61,
  '1john': 62, '1joh': 62, '1jhn': 62, '1jn': 62, '1jo': 62, ijohn: 62, ijn: 62,
  '2john': 63, '2joh': 63, '2jhn': 63, '2jn': 63, '2jo': 63, iijohn: 63, iijn: 63,
  '3john': 64, '3joh': 64, '3jhn': 64, '3jn': 64, '3jo': 64, iiijohn: 64, iiijn: 64,
  jude: 65, jud: 65, jd: 65,
  revelation: 66, revelations: 66, rev: 66, re: 66, rv: 66, apoc: 66,
};

interface ParsedPassageRef {
  bookKey: string;
  chapterKey: string;
  verseKeys: string[];
}

function parsePassageRef(raw: string): ParsedPassageRef | null {
  const cleaned = String(raw || '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/[–—]/g, '-');
  if (!cleaned) return null;

  const numericMatch = /^(\d{1,2})\s*:\s*(\d{1,3})(?:\s*:\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?)?$/.exec(cleaned);
  if (numericMatch) {
    const bookKey = String(Number(numericMatch[1]));
    const chapter = Number(numericMatch[2]);
    const chapterKey = `${bookKey}:${chapter}`;
    const verseKeys: string[] = [];
    if (numericMatch[3] !== undefined) {
      const startV = Number(numericMatch[3]);
      const endV = numericMatch[4] !== undefined ? Number(numericMatch[4]) : startV;
      if (endV >= startV && endV - startV <= 20) {
        for (let v = startV; v <= endV; v++) verseKeys.push(`${chapterKey}:${v}`);
      } else {
        verseKeys.push(`${chapterKey}:${startV}`);
      }
    }
    return { bookKey, chapterKey, verseKeys };
  }

  const m = /^([1-3]?\s*[A-Za-z][A-Za-z.\s]*?)\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-,]\s*(\d{1,3}))?)?(?:\s*\|.*)?$/.exec(cleaned);
  if (!m) return null;

  const bookNorm = m[1].toLowerCase().replace(/[^a-z0-9]+/g, '');
  const canonicalBook = CANONICAL_BOOK_ALIASES[bookNorm];
  const bookKey = canonicalBook ? String(canonicalBook) : bookNorm;
  if (!bookKey) return null;

  const chapter = Number(m[2]);
  const chapterKey = `${bookKey}:${chapter}`;
  const verseKeys: string[] = [];
  if (m[3] !== undefined) {
    const startV = Number(m[3]);
    const endV = m[4] !== undefined ? Number(m[4]) : startV;
    if (endV >= startV && endV - startV <= 20) {
      for (let v = startV; v <= endV; v++) verseKeys.push(`${chapterKey}:${v}`);
    } else {
      verseKeys.push(`${chapterKey}:${startV}`);
    }
  }
  return { bookKey, chapterKey, verseKeys };
}

function normalizeRefToChapterKey(raw: string): string {
  const parsed = parsePassageRef(raw);
  return parsed ? parsed.chapterKey : String(raw || '').trim().toLowerCase();
}

interface StepPassageSets {
  books: Set<string>;
  chapters: Set<string>;
  verses: Set<string>;
}

function collectStepPassages(passageIds: string[] | undefined): StepPassageSets {
  const books = new Set<string>();
  const chapters = new Set<string>();
  const verses = new Set<string>();
  if (!Array.isArray(passageIds)) return { books, chapters, verses };
  for (const raw of passageIds) {
    const parsed = parsePassageRef(raw);
    if (parsed) {
      books.add(parsed.bookKey);
      chapters.add(parsed.chapterKey);
      for (const v of parsed.verseKeys) verses.add(v);
    } else {
      const trimmed = String(raw || '').trim().toLowerCase();
      if (trimmed) verses.add(trimmed);
    }
  }
  return { books, chapters, verses };
}

function setsOverlap(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  for (const x of a) if (b.has(x)) return true;
  return false;
}

interface MergedEndpointContext {
  direct_cooccurrence_refs: string[];
  lxx_bridge_cooccurrence_refs: string[];
  same_chapter_overlap: boolean;
  intermediate_is_proper?: boolean[];
  intermediate_verse_counts?: number[];
}

function extractEndpointContext(path: R12PathInput): MergedEndpointContext {
  const direct = uniqueSorted([
    ...(path.endpoint_context?.direct_cooccurrence_refs ?? []),
    ...path.steps.flatMap((s) => s.endpoint_context?.direct_cooccurrence_refs ?? []),
  ]);
  const lxx = uniqueSorted([
    ...(path.endpoint_context?.lxx_bridge_cooccurrence_refs ?? []),
    ...path.steps.flatMap((s) => s.endpoint_context?.lxx_bridge_cooccurrence_refs ?? []),
  ]);
  const sameChapterOverlap = Boolean(
    path.endpoint_context?.same_chapter_overlap ||
      path.steps.some((s) => s.endpoint_context?.same_chapter_overlap),
  );
  const stepWithProper = path.steps.find((s) => s.endpoint_context?.intermediate_is_proper);
  const stepWithCounts = path.steps.find((s) => s.endpoint_context?.intermediate_verse_counts);
  return {
    direct_cooccurrence_refs: direct,
    lxx_bridge_cooccurrence_refs: lxx,
    same_chapter_overlap: sameChapterOverlap,
    intermediate_is_proper:
      path.endpoint_context?.intermediate_is_proper ?? stepWithProper?.endpoint_context?.intermediate_is_proper,
    intermediate_verse_counts:
      path.endpoint_context?.intermediate_verse_counts ?? stepWithCounts?.endpoint_context?.intermediate_verse_counts,
  };
}

function isEventStep(s: R12ProofStepInput): boolean {
  return (
    s.epistemic_layer === 'TEXTUAL' ||
    s.relation_type.startsWith('gram_') ||
    s.relation_type === 'contextual_collocation' ||
    s.relation_type === 'CO_OCCURS_WITH'
  );
}

function isGrammaticalStep(s: R12ProofStepInput): boolean {
  return (
    s.relation_type.startsWith('gram_') ||
    s.relation_type in GRAMMATICAL_SPECIFICITY ||
    (s.epistemic_layer === 'TEXTUAL' &&
      s.relation_type !== 'contextual_collocation' &&
      s.relation_type !== 'CO_OCCURS_WITH')
  );
}

function normalizedStepDirection(s: R12ProofStepInput): 'forward' | 'reverse' | undefined {
  if (s.direction === 'forward') return s.reversed ? 'reverse' : 'forward';
  if (s.direction === 'reverse') return 'reverse';
  if (s.reversed === true) return 'reverse';
  return undefined;
}

function isUnwitnessedLxxStep(s: R12ProofStepInput): boolean {
  return (
    (s.relation_type === 'lxx_translation_bridge' || s.relation_type === 'TRANSLATED_AS') &&
    (!Array.isArray(s.passage_ids) || s.passage_ids.length === 0)
  );
}

function resolveIntermediateDegree(
  semantic: R12ProofStepInput[],
  idx: number,
  endpointCtx: MergedEndpointContext,
): number {
  return Math.max(
    0,
    endpointCtx.intermediate_verse_counts?.[idx] ??
      semantic[idx]?.intermediate_degree ??
      semantic[idx + 1]?.source_verse_count ??
      0,
  );
}

function resolveIntermediateIsProper(
  semantic: R12ProofStepInput[],
  idx: number,
  endpointCtx: MergedEndpointContext,
): boolean {
  if (endpointCtx.intermediate_is_proper?.[idx] !== undefined) {
    return Boolean(endpointCtx.intermediate_is_proper[idx]);
  }
  if (semantic[idx]?.proper_entity !== undefined) {
    return Boolean(semantic[idx].proper_entity);
  }
  if (
    semantic[idx]?.intermediate_degree === undefined &&
    semantic[idx + 1]?.source_verse_count !== undefined &&
    semantic[idx + 1]?.proper_entity !== undefined
  ) {
    return Boolean(semantic[idx + 1].proper_entity);
  }
  return false;
}

function computePathCoherenceK(
  semantic: R12ProofStepInput[],
  endpointCtx: MergedEndpointContext,
  hasExternalWorld: boolean,
): number {
  let k = 1.0;
  const eventIndices: number[] = [];
  for (let i = 0; i < semantic.length; i++) {
    if (isEventStep(semantic[i])) eventIndices.push(i);
  }

  for (let p = 0; p < eventIndices.length - 1; p++) {
    const idxA = eventIndices[p];
    const idxB = eventIndices[p + 1];
    const stepA = semantic[idxA];
    const stepB = semantic[idxB];
    const passA = collectStepPassages(stepA.passage_ids);
    const passB = collectStepPassages(stepB.passage_ids);

    const sharedVerse = setsOverlap(passA.verses, passB.verses);
    const sharedChapter = sharedVerse || setsOverlap(passA.chapters, passB.chapters);
    const sharedBook = sharedChapter || setsOverlap(passA.books, passB.books);

    if (sharedVerse) {
      k *= 1.0;
    } else if (sharedChapter) {
      k *= 0.86;
    } else if (sharedBook) {
      k *= 0.65;
    } else {
      k *= 0.28;
    }

    if (!sharedVerse) {
      let hasGenericHubBetween = false;
      for (let m = idxA; m < idxB; m++) {
        const deg = resolveIntermediateDegree(semantic, m, endpointCtx);
        const isProper = resolveIntermediateIsProper(semantic, m, endpointCtx);
        if (deg >= 25 && !isProper) {
          hasGenericHubBetween = true;
          break;
        }
      }
      if (hasGenericHubBetween) {
        k *= 0.5;
      }

      if (isGrammaticalStep(stepA) && isGrammaticalStep(stepB)) {
        const dirA = normalizedStepDirection(stepA);
        const dirB = normalizedStepDirection(stepB);
        if (dirA && dirB && dirA !== dirB) {
          k *= 0.75;
        }
      }
    }

    if (!sharedChapter && isGrammaticalStep(stepA) && isGrammaticalStep(stepB)) {
      let hasUnwitnessedLxx = false;
      for (let m = idxA + 1; m < idxB; m++) {
        if (isUnwitnessedLxxStep(semantic[m])) {
          hasUnwitnessedLxx = true;
          break;
        }
      }
      if (hasUnwitnessedLxx) {
        k *= 0.5;
      }
    }
  }

  // Consecutive semantic steps outside already-scored event-to-event spans (lexical, LXX, external bridges)
  const firstEvent = eventIndices.length > 0 ? eventIndices[0] : -1;
  const lastEvent = eventIndices.length > 0 ? eventIndices[eventIndices.length - 1] : -1;
  for (let i = 0; i < semantic.length - 1; i++) {
    if (firstEvent >= 0 && lastEvent > firstEvent && i >= firstEvent && i < lastEvent) {
      continue;
    }
    const stepA = semantic[i];
    const stepB = semantic[i + 1];
    if (
      stepA.epistemic_layer === 'EXTERNAL_WORLD' ||
      stepB.epistemic_layer === 'EXTERNAL_WORLD' ||
      stepA.epistemic_layer === 'HYPOTHESIS' ||
      stepB.epistemic_layer === 'HYPOTHESIS'
    ) {
      k *= 0.75;
    } else {
      const passA = collectStepPassages(stepA.passage_ids);
      const passB = collectStepPassages(stepB.passage_ids);
      k *= setsOverlap(passA.verses, passB.verses) ? 0.92 : 0.78;
    }
  }

  if (semantic.length === 1 && hasExternalWorld) {
    k *= 0.75;
  }

  if (semantic.some((s) => s.relation_type === 'contextual_collocation' || s.relation_type === 'CO_OCCURS_WITH')) {
    k *= 0.85;
  }

  if (endpointCtx.direct_cooccurrence_refs.length > 0) {
    k = Math.max(k, 0.95);
  } else if (endpointCtx.lxx_bridge_cooccurrence_refs.length > 0) {
    k = Math.max(k, 0.85);
  } else if (endpointCtx.same_chapter_overlap) {
    k = Math.max(k, 0.72);
  } else if (eventIndices.length <= 1) {
    k = Math.max(k, hasExternalWorld ? 0.75 : 0.78);
  }

  return Math.max(0.04, Math.min(1.0, k));
}

function computeIntermediateHubPenaltyR12(
  semantic: R12ProofStepInput[],
  endpointCtx: MergedEndpointContext,
  maxGraphDegree: number,
): number {
  const intermediateSteps = semantic.slice(0, -1);
  if (intermediateSteps.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < intermediateSteps.length; i++) {
    const deg = resolveIntermediateDegree(semantic, i, endpointCtx);
    sum += Math.min(1, Math.log1p(deg) / Math.log1p(maxGraphDegree));
  }
  return (0.18 * sum) / intermediateSteps.length;
}

const R12_EPISTEMIC_LAYERS = new Set<R12EpistemicLayer>([
  'TEXTUAL',
  'LINGUISTIC',
  'EXTERNAL_WORLD',
  'HYPOTHESIS',
  'RECEPTION',
]);

export const ADMIN_PREDICATES = new Set<string>([
  'sense_subdivision_of',
  'has_sense_subdivision',
  'occurrence_of_lemma',
  'lemma_has_occurrence',
  'canonical_alias_of',
]);

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function round6(n: number): number {
  return Number(n.toFixed(6));
}

function jaccardSet(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter || 1);
}

function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  let sumLog = 0;
  for (const v of values) {
    sumLog += Math.log(Math.max(1e-6, Math.min(1, v)));
  }
  return Math.exp(sumLog / values.length);
}

export function computeFeatureIdf(totalDocs: number, docFreq: number): number {
  const N = Math.max(1, totalDocs);
  const df = Math.max(0, docFreq);
  return Math.log((N + 1) / (df + 1)) + 1;
}

export function mapLayerToR12Epistemic(
  step: Pick<PathStep, 'layer' | 'predicate' | 'quality' | 'source_relationship_id' | 'epistemic_class'>,
): R12EpistemicLayer {
  if (step.source_relationship_id.startsWith('ext:') || step.predicate === 'SHARES_EXTERNAL_PROPERTY') {
    return 'EXTERNAL_WORLD';
  }
  if (
    step.quality === 'candidate' ||
    step.quality === 'candidate_relation' ||
    step.epistemic_class === 'semantic_hypothesis' ||
    step.predicate === 'SHARES_STRUCTURAL_PATTERN' ||
    step.predicate === 'SHARES_ORTHOGRAPHIC_FORM'
  ) {
    return 'HYPOTHESIS';
  }
  if (step.layer === 'grammatical') return 'TEXTUAL';
  if (step.layer === 'lexical' || step.layer === 'lxx_translation') return 'LINGUISTIC';
  if (step.layer === 'contextual') {
    return (step.epistemic_class === 'statistical_association') ? 'LINGUISTIC' : 'TEXTUAL';
  }
  return 'LINGUISTIC';
}

function canonicalEndpointPair(a: string, b: string): string {
  return a <= b ? `${a}<->${b}` : `${b}<->${a}`;
}

/**
 * Extracts independent biblical attestation group IDs for a step.
 * - Deduplicates mirrored edges (outgoing/incoming of same clause/statement).
 * - Deduplicates parallel Greek editions (nestle1904/sblgnt) on the same canonical ref/clause.
 * - Returns [] for external-world assertions so external claims never inflate biblical convergence C.
 */
export function extractAttestationGroups(
  step: Pick<
    PathStep,
    'layer' | 'predicate' | 'quality' | 'source_relationship_id' | 'epistemic_class' | 'from_entity' | 'to_entity' | 'evidence_summary'
  >,
): string[] {
  const epistLayer = mapLayerToR12Epistemic(step);
  if (epistLayer === 'EXTERNAL_WORLD') return [];

  const groups = new Set<string>();
  const pair = canonicalEndpointPair(step.from_entity.entity_key, step.to_entity.entity_key);
  const witnesses = step.evidence_summary?.sample_witnesses || [];

  if (step.layer === 'grammatical') {
    for (const w of witnesses) {
      const clauseId = w.source_clause_id || (w.relation_id ? w.relation_id.split('#')[1]?.split(':')[0] : '') || w.frame_id || '';
      const normRef = w.reference || '';
      if (normRef || clauseId) {
        // Edition-independent canonical ref + clause key collapses parallel editions (nestle1904/sblgnt)
        // and symmetric reversed edges into one independent source group.
        groups.add(`gram:${normRef}:${clauseId}`);
      }
    }
    if (groups.size === 0) {
      for (const r of step.evidence_summary?.sample_references || []) {
        groups.add(`gram_ref:${r}:${step.predicate}`);
      }
    }
    if (groups.size === 0) {
      groups.add(`gram_rel:${step.source_relationship_id}:${pair}`);
    }
  } else if (step.layer === 'lexical') {
    groups.add(`lex:${step.predicate}:${pair}`);
  } else if (step.layer === 'lxx_translation') {
    groups.add(`lxx:catss:${pair}`);
  } else if (step.layer === 'contextual') {
    const refs = (step.evidence_summary?.sample_references || []).slice(0, 6);
    if (refs.length > 0) {
      for (const r of refs) groups.add(`ctx:${r}:${pair}`);
    } else {
      groups.add(`ctx:${step.source_relationship_id}:${pair}`);
    }
  }
  return [...groups].sort();
}

export function pathStepToR12ProofStep(
  step: PathStep,
  options: { totalGraphDocs?: number; featureDf?: number; featureIdf?: number } = {},
): R12ProofStepInput {
  const isAdmin = ADMIN_PREDICATES.has(step.predicate) || ADMIN_PREDICATES.has(step.display_predicate);
  const epistLayer = mapLayerToR12Epistemic(step);

  // Quality weight in (0, 1] reflecting reliability, predicate specificity, witness support, and source scope
  let q = 0.72;
  if (step.layer === 'grammatical') {
    const spec = (GRAMMATICAL_SPECIFICITY[step.predicate] ?? 18) / 30;
    const baseQ = step.quality === 'source_explicit' ? 0.96 : step.quality === 'rule_derived' ? 0.86 : 0.68;
    q = Math.min(1, Math.max(0.45, baseQ * (0.72 + 0.28 * spec)));
  } else if (step.layer === 'lexical') {
    q = isAdmin ? 0.98 : step.quality === 'attested_lexicon' || step.quality === 'attested_lexical_fact' ? 0.92 : 0.80;
  } else if (step.layer === 'lxx_translation') {
    const share = clamp01(step.evidence_summary.translation_share ?? 0.35);
    q = step.uncertainty.homograph_ambiguity ? 0.62 : 0.72 + 0.20 * share;
  } else if (step.layer === 'contextual') {
    const colloc = step.evidence_summary.collocation_distance_le_3 ?? 0;
    const sameClause = step.evidence_summary.same_clause ?? 0;
    q = colloc > 0 ? 0.74 : sameClause > 0 ? 0.66 : 0.54;
  }
  if (step.uncertainty.is_uncertain) q *= 0.88;
  q = Math.min(1, Math.max(0.1, round6(q)));

  const passages = step.evidence_summary?.distinct_passages ?? step.evidence_summary?.same_verse ?? 100;
  const featureIdf =
    options.featureIdf ??
    computeFeatureIdf(options.totalGraphDocs ?? 31203, options.featureDf ?? Math.max(1, passages));

  const dir: R12ProofStepInput['direction'] =
    step.traversal_direction === 'forward'
      ? 'forward'
      : step.traversal_direction === 'reverse'
        ? 'reverse'
        : 'symmetric';

  const mappingStatus: R12ProofStepInput['mapping_status'] =
    step.uncertainty?.mapping_status === 'candidate'
      ? 'candidate'
      : step.uncertainty?.mapping_status === 'unmapped'
        ? 'unmapped'
        : 'verified';

  const passageIds = uniqueSorted([
    ...(step.evidence_summary?.sample_references || []),
    ...(step.evidence_summary?.sample_witnesses || []).map((w) => w.reference).filter(Boolean),
  ]);

  return {
    edge_id: `${step.source_relationship_id}:${step.from_entity.entity_key}->${step.to_entity.entity_key}`,
    from_id: step.from_entity.entity_key,
    to_id: step.to_entity.entity_key,
    relation_type: step.display_predicate || step.predicate,
    direction: dir,
    reversed: step.traversal_direction === 'reverse',
    epistemic_layer: epistLayer,
    quality_weight: q,
    administrative: isAdmin,
    mapping_status: mappingStatus,
    attestation_groups: extractAttestationGroups(step),
    passage_ids: passageIds,
    feature_idf: round6(featureIdf),
    intermediate_degree: step.to_entity.degree_hint ?? 0,
    source_dataset: step.provenance?.dataset || 'BibleResearch Corpus',
  };
}

function buildR12PathKey(steps: R12ProofStepInput[]): string {
  return steps.map((s) => `${s.edge_id}${s.reversed ? ':reverse' : ''}`).join('>');
}

export function scoreR12Path(
  path: R12PathInput,
  opts: {
    maxGraphDegree?: number;
    allowReception?: boolean;
    max_hops?: number;
    max_physical_hops?: number;
    score_version?: string;
  } = {},
): R12ScoredPath {
  if (!path || !Array.isArray(path.steps) || path.steps.length === 0) {
    throw new TypeError('Nonempty path required');
  }
  const maxPhysical = opts.max_physical_hops ?? 10;
  const maxMeaningful = opts.max_hops ?? 5;
  if (path.steps.length > maxPhysical) {
    throw new RangeError(`Path physical steps (${path.steps.length}) exceed max_physical_hops (${maxPhysical})`);
  }

  const MAX = opts.maxGraphDegree ?? 5000;
  const semantic = path.steps.filter((s) => !s.administrative);
  if (semantic.length === 0) {
    throw new TypeError('Path with only administrative steps');
  }
  if (semantic.length > maxMeaningful) {
    throw new RangeError(`Path meaningful hops (${semantic.length}) exceed max_hops (${maxMeaningful})`);
  }

  for (const s of path.steps) {
    if (!s.edge_id || !s.relation_type || !R12_EPISTEMIC_LAYERS.has(s.epistemic_layer)) {
      throw new TypeError('Missing typed step');
    }
    if (!s.administrative && (!(s.quality_weight > 0) || s.quality_weight > 1)) {
      throw new RangeError('Quality weight must be within (0, 1]');
    }
    if (s.mapping_status === 'unsupported' || (s.epistemic_layer === 'RECEPTION' && !opts.allowReception)) {
      throw new TypeError('Unsupported/reception step in primary path');
    }
  }

  const endpointCtx = extractEndpointContext(path);
  const hasExternalWorld = semantic.some((s) => s.epistemic_layer === 'EXTERNAL_WORLD');
  const K = round6(computePathCoherenceK(semantic, endpointCtx, hasExternalWorld));

  const Q = geometricMean(semantic.map((s) => s.quality_weight)) * Math.pow(0.90, Math.max(0, semantic.length - 2));
  const freq = semantic.map((s) => clamp01(((s.feature_idf ?? 1) - 1) / 5));
  const D = freq.reduce((a, b) => a + b, 0) / freq.length;
  const types = uniqueSorted(semantic.map((s) => s.relation_type));
  const T = Math.min(1, types.length / 4);
  const penalty = computeIntermediateHubPenaltyR12(semantic, endpointCtx, MAX);

  // External-world claims must never add independent biblical attestation groups
  const groups = uniqueSorted(
    path.steps.flatMap((s) =>
      s.epistemic_layer === 'EXTERNAL_WORLD' || !Array.isArray(s.attestation_groups) ? [] : s.attestation_groups,
    ),
  );

  const hypothesis = semantic.some(
    (s) =>
      s.epistemic_layer === 'HYPOTHESIS' ||
      s.epistemic_layer === 'EXTERNAL_WORLD' ||
      s.mapping_status === 'candidate',
  );
  const priority = clamp01(K * (0.45 * Q + 0.15 * D + 0.15 * T) - penalty);

  const directChapters = new Set(endpointCtx.direct_cooccurrence_refs.map(normalizeRefToChapterKey));
  const lxxChapters = new Set(endpointCtx.lxx_bridge_cooccurrence_refs.map(normalizeRefToChapterKey));
  const endpointSupportGroupCount = directChapters.size + lxxChapters.size;
  const endpointEpistemicStatus: R12EndpointEpistemicStatus =
    !hypothesis && endpointCtx.direct_cooccurrence_refs.length > 0
      ? 'DIRECT_ENDPOINT_WITNESS'
      : K >= 0.45 && !hypothesis
        ? 'COHERENT_MULTIHOP_LEAD'
        : 'EXPLORATORY_STEP_CHAIN';

  const pathKey = buildR12PathKey(path.steps);
  const pathId = path.path_id || `r12p:${fnv1a64Hex(`${path.anchor_id}|${path.target_id}|${pathKey}`).slice(0, 16)}`;

  return {
    path_id: pathId,
    path_key: pathKey,
    anchor_id: path.anchor_id,
    target_id: path.target_id,
    steps: path.steps,
    score_version: opts.score_version ?? R12_SCORE_VERSION,
    meaningful_hops: semantic.length,
    physical_hops: path.steps.length,
    Q: round6(Q),
    K,
    endpoint_coherence: K,
    D: round6(D),
    T: round6(T),
    hub_penalty: round6(penalty),
    partial_interest: round6(priority),
    independent_evidence_groups: groups,
    step_support_group_count: groups.length,
    endpoint_support_group_count: endpointSupportGroupCount,
    edge_ids: uniqueSorted(path.steps.map((s) => s.edge_id)),
    passage_ids: uniqueSorted(path.steps.flatMap((s) => (Array.isArray(s.passage_ids) ? s.passage_ids : []))),
    relation_types: types,
    epistemic_status: hypothesis ? 'EXPLORATORY' : 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION',
    endpoint_epistemic_status: endpointEpistemicStatus,
    score_parts: {
      Q: round6(Q),
      K,
      D: round6(D),
      T: round6(T),
      hub_penalty: round6(penalty),
    },
  };
}

function r12PathOverlap(a: R12ScoredPath, b: R12ScoredPath): number {
  return (
    (jaccardSet(a.edge_ids, b.edge_ids) +
      jaccardSet(a.passage_ids, b.passage_ids) +
      jaccardSet(a.relation_types, b.relation_types)) /
    3
  );
}

export function rankR12DiscoveryDestinations(
  paths: R12PathInput[],
  opts: {
    top_n?: number;
    limit?: number;
    mmrPenalty?: number;
    max_alternatives?: number;
    maxGraphDegree?: number;
    allowReception?: boolean;
    includeIncoherent?: boolean;
    max_hops?: number;
    max_physical_hops?: number;
    score_version?: string;
  } = {},
): {
  top: R12DestinationRecommendation[];
  tail: R12DestinationRecommendation[];
  next_cursor: string | null;
  score_version: string;
  coverage: 'ranked_top_n' | 'complete_candidate_pool';
  unreturned_destinations: number;
  pruned_incoherent_count: number;
} {
  const selectedMax = opts.top_n ?? opts.limit ?? 24;
  const mmrPenalty = opts.mmrPenalty ?? 0.35;
  const maxAlts = opts.max_alternatives ?? 3;
  const scoreVersion = opts.score_version ?? R12_SCORE_VERSION;

  const scoredEntries = paths.map((p) => ({
    scored: scoreR12Path(p, { ...opts, score_version: scoreVersion }),
    endpointCtx: extractEndpointContext(p),
  }));

  const grouped = new Map<
    string,
    { paths: R12ScoredPath[]; directRefs: Set<string>; lxxRefs: Set<string> }
  >();
  for (const { scored: path, endpointCtx } of scoredEntries) {
    if (!path.anchor_id || !path.target_id) {
      throw new TypeError('Path needs canonical anchor and target');
    }
    if (path.anchor_id === path.target_id) continue;
    const key = `${path.anchor_id}\u001f${path.target_id}`;
    let bucket = grouped.get(key);
    if (!bucket) {
      bucket = { paths: [], directRefs: new Set(), lxxRefs: new Set() };
      grouped.set(key, bucket);
    }
    for (const ref of endpointCtx.direct_cooccurrence_refs) {
      bucket.directRefs.add(normalizeRefToChapterKey(ref));
    }
    for (const ref of endpointCtx.lxx_bridge_cooccurrence_refs) {
      bucket.lxxRefs.add(normalizeRefToChapterKey(ref));
    }
    if (!bucket.paths.some((existing) => existing.path_key === path.path_key)) {
      bucket.paths.push(path);
    }
  }

  let prunedIncoherentCount = 0;
  const pool: R12DestinationRecommendation[] = [];
  for (const { paths: group, directRefs, lxxRefs } of grouped.values()) {
    group.sort((a, b) => b.partial_interest - a.partial_interest || b.K - a.K || a.path_key.localeCompare(b.path_key));
    const attestations = uniqueSorted(group.flatMap((p) => p.independent_evidence_groups));
    const g = attestations.length;
    const coherentRoutes = group.filter(
      (p) =>
        p.K >= 0.45 &&
        !p.steps.some((s) => s.epistemic_layer === 'EXTERNAL_WORLD' || s.epistemic_layer === 'HYPOTHESIS'),
    );
    const coherentRouteBonus = coherentRoutes.length >= 2 ? Math.min(3, coherentRoutes.length - 1) : 0;
    const endpointSupportGroupCount = directRefs.size + lxxRefs.size + coherentRouteBonus;
    const C = round6(Math.min(1, Math.log2(1 + endpointSupportGroupCount) / 3));

    const best = group[0];
    if (!opts.includeIncoherent && best.K < 0.25 && endpointSupportGroupCount === 0) {
      prunedIncoherentCount += 1;
      continue;
    }

    const interest = round6(clamp01(best.K * (0.45 * best.Q + 0.25 * C + 0.15 * best.D + 0.15 * best.T) - best.hub_penalty));
    const exploratory = group.some((p) => p.epistemic_status === 'EXPLORATORY');
    const enrichedGroup = group.map((p) => ({
      ...p,
      C,
      interest,
      endpoint_support_group_count: endpointSupportGroupCount,
      score_parts: { ...p.score_parts, C },
    }));
    const bestEnriched = enrichedGroup[0];
    pool.push({
      anchor_id: bestEnriched.anchor_id,
      target_id: bestEnriched.target_id,
      score_version: scoreVersion,
      best_path_quality: bestEnriched.Q,
      K: bestEnriched.K,
      endpoint_coherence: bestEnriched.endpoint_coherence,
      interest,
      C,
      convergence: C,
      independent_group_count: g,
      support_group_count: g,
      step_support_group_count: g,
      endpoint_support_group_count: endpointSupportGroupCount,
      independent_evidence_groups: attestations,
      best_path: bestEnriched,
      alternative_paths: enrichedGroup.slice(1, 1 + maxAlts),
      paths: enrichedGroup,
      evidence_status:
        exploratory || bestEnriched.endpoint_epistemic_status === 'EXPLORATORY_STEP_CHAIN'
          ? 'MIXED_OR_EXPLORATORY'
          : 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION',
      endpoint_epistemic_status: bestEnriched.endpoint_epistemic_status,
      limitation: 'A graph path does not by itself establish that its endpoints symbolize or equal one another.',
    });
  }

  // Deterministic initial sort so MMR ties break stably by target_id
  pool.sort((a, b) => b.interest - a.interest || b.endpoint_coherence - a.endpoint_coherence || a.target_id.localeCompare(b.target_id));

  const selected: R12DestinationRecommendation[] = [];
  while (pool.length > 0 && selected.length < selectedMax) {
    let bestI = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      let maxOverlap = 0;
      for (const other of selected) {
        for (const p of candidate.paths) {
          for (const q of other.paths) {
            maxOverlap = Math.max(maxOverlap, r12PathOverlap(p, q));
          }
        }
      }
      const mmr = candidate.interest - mmrPenalty * maxOverlap;
      if (mmr > bestValue || (mmr === bestValue && candidate.target_id < pool[bestI].target_id)) {
        bestI = i;
        bestValue = mmr;
      }
    }
    const [next] = pool.splice(bestI, 1);
    const mmrRounded = round6(bestValue);
    next.best_path.mmr_score = mmrRounded;
    selected.push({ ...next, mmr_score: mmrRounded });
  }

  return {
    top: selected,
    tail: pool,
    next_cursor: pool.length > 0 ? `r12tail:${selected.length}` : null,
    score_version: scoreVersion,
    coverage: pool.length > 0 ? 'ranked_top_n' : 'complete_candidate_pool',
    unreturned_destinations: pool.length,
    pruned_incoherent_count: prunedIncoherentCount,
  };
}
