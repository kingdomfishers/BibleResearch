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
