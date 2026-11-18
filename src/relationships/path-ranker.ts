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
  R12EpistemicLayer,
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
export const R12_SCORE_VERSION = 'r12-ranker-v1';

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
    step.epistemic_class === 'interpretive_hypothesis' ||
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
  path: {
    path_id?: string;
    anchor_id: string;
    target_id: string;
    steps: R12ProofStepInput[];
  },
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

  const Q = geometricMean(semantic.map((s) => s.quality_weight)) * Math.pow(0.95, Math.max(0, semantic.length - 2));
  const freq = semantic.map((s) => clamp01(((s.feature_idf ?? 1) - 1) / 5));
  const D = freq.reduce((a, b) => a + b, 0) / freq.length;
  const types = uniqueSorted(semantic.map((s) => s.relation_type));
  const T = Math.min(1, types.length / 4);
  const hubDegree = semantic.map((s) => Math.max(0, s.intermediate_degree ?? 0));
  const penalty =
    (0.10 * hubDegree.reduce((a, n) => a + Math.min(1, Math.log1p(n) / Math.log1p(MAX)), 0)) / hubDegree.length;

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
  const priority = clamp01(0.45 * Q + 0.15 * D + 0.10 * T - penalty);
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
    D: round6(D),
    T: round6(T),
    hub_penalty: round6(penalty),
    partial_interest: round6(priority),
    independent_evidence_groups: groups,
    edge_ids: uniqueSorted(path.steps.map((s) => s.edge_id)),
    passage_ids: uniqueSorted(path.steps.flatMap((s) => (Array.isArray(s.passage_ids) ? s.passage_ids : []))),
    relation_types: types,
    epistemic_status: hypothesis ? 'EXPLORATORY' : 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION',
    score_parts: {
      Q: round6(Q),
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
  paths: Array<{
    path_id?: string;
    anchor_id: string;
    target_id: string;
    steps: R12ProofStepInput[];
  }>,
  opts: {
    top_n?: number;
    limit?: number;
    mmrPenalty?: number;
    max_alternatives?: number;
    maxGraphDegree?: number;
    allowReception?: boolean;
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
} {
  const selectedMax = opts.top_n ?? opts.limit ?? 24;
  const mmrPenalty = opts.mmrPenalty ?? 0.35;
  const maxAlts = opts.max_alternatives ?? 3;
  const scoreVersion = opts.score_version ?? R12_SCORE_VERSION;

  const scored = paths.map((p) => scoreR12Path(p, { ...opts, score_version: scoreVersion }));
  const grouped = new Map<string, R12ScoredPath[]>();
  for (const path of scored) {
    if (!path.anchor_id || !path.target_id) {
      throw new TypeError('Path needs canonical anchor and target');
    }
    if (path.anchor_id === path.target_id) continue;
    const key = `${path.anchor_id}\u001f${path.target_id}`;
    const bucket = grouped.get(key) || [];
    if (!bucket.some((existing) => existing.path_key === path.path_key)) {
      bucket.push(path);
      grouped.set(key, bucket);
    }
  }

  const pool: R12DestinationRecommendation[] = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => b.partial_interest - a.partial_interest || a.path_key.localeCompare(b.path_key));
    const attestations = uniqueSorted(group.flatMap((p) => p.independent_evidence_groups));
    const g = attestations.length;
    const C = round6(Math.min(1, Math.log2(Math.max(1, g)) / 3));
    const best = group[0];
    const interest = round6(clamp01(best.partial_interest + 0.30 * C));
    const exploratory = group.some((p) => p.epistemic_status === 'EXPLORATORY');
    const enrichedGroup = group.map((p) => ({
      ...p,
      C,
      interest,
      score_parts: { ...p.score_parts, C },
    }));
    const bestEnriched = enrichedGroup[0];
    pool.push({
      anchor_id: bestEnriched.anchor_id,
      target_id: bestEnriched.target_id,
      score_version: scoreVersion,
      best_path_quality: bestEnriched.Q,
      interest,
      C,
      convergence: C,
      independent_group_count: g,
      support_group_count: g,
      independent_evidence_groups: attestations,
      best_path: bestEnriched,
      alternative_paths: enrichedGroup.slice(1, 1 + maxAlts),
      paths: enrichedGroup,
      evidence_status: exploratory ? 'MIXED_OR_EXPLORATORY' : 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION',
      limitation: 'A graph path does not by itself establish that its endpoints symbolize or equal one another.',
    });
  }

  // Deterministic initial sort so MMR ties break stably by target_id
  pool.sort((a, b) => b.interest - a.interest || a.target_id.localeCompare(b.target_id));

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
  };
}
