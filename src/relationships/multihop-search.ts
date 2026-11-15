// @file: src/relationships/multihop-search.ts
// @feature: relationships-r9c
// Bounded, deterministic 1-3 hop graph traversal with lazy adjacency, cycle detection, and completeness tracking.

import { fnv1a64Hex, isFunctionWordPos, normalizeLang } from './adjacency-loader.ts';
import { resolveEntityKey } from './concept-resolver.ts';
import {
  buildPathStep,
  compareMultiHopPaths,
  computePathId,
  edgePreRankScore,
  mergeHubConfig,
  scoreAndExplainPath,
} from './path-ranker.ts';
import type {
  AdjacencyLoader,
  DirectionFilter,
  GraphEdge,
  GraphEntityRef,
  GraphLayer,
  HopEvidenceWitness,
  HubPenaltyConfig,
  JoinScope,
  MultiHopPath,
  MultiHopQuery,
  MultiHopResult,
  NeighborLoadOptions,
  NeighborLoadResult,
  PathStep,
  QualityThreshold,
  SearchCoverageMetadata,
  SearchLimits,
} from './multihop-types.ts';

// === @section:logic:query-normalization ===
export const DEFAULT_SEARCH_LIMITS: SearchLimits = {
  max_nodes_expanded: 45,
  max_edges_examined: 3000,
  max_paths_returned: 20,
  max_per_node_edges: 150,
  max_contextual_pages_per_node: 4,
};

const ALL_LAYERS: GraphLayer[] = ['grammatical', 'lexical', 'contextual', 'lxx_translation'];

const LEXICAL_INVERSE_DISPLAY: Record<string, string> = {
  sense_subdivision_of: 'has_sense_subdivision',
  base_root_anchor: 'root_anchored_by',
  derived_from_root_anchor: 'root_anchor_of_derivation',
  greek_loan_or_transliteration: 'loan_source_of',
  compound_formation_component: 'component_of_formation',
};

function reverseDirectionFilter(dir: DirectionFilter): DirectionFilter {
  if (dir === 'outgoing') return 'incoming';
  if (dir === 'incoming') return 'outgoing';
  return 'both';
}

function flipIncomingEdgeToForward(edge: GraphEdge): GraphEdge {
  const newTrav =
    edge.traversal_direction === 'reverse'
      ? 'forward'
      : edge.traversal_direction === 'forward'
        ? 'reverse'
        : 'symmetric';
  let displayPred = edge.display_predicate;
  if (edge.layer === 'lexical') {
    displayPred =
      newTrav === 'forward'
        ? edge.predicate
        : newTrav === 'reverse'
          ? LEXICAL_INVERSE_DISPLAY[edge.predicate] || `inverse_${edge.predicate}`
          : edge.display_predicate;
  } else if (edge.layer === 'grammatical') {
    displayPred = newTrav === 'forward' ? edge.predicate : edge.display_predicate;
  }
  return {
    ...edge,
    edge_id: `${edge.source_relationship_id}::${newTrav === 'forward' ? 'fwd' : newTrav === 'reverse' ? 'rev' : 'sym'}`,
    traversal_direction: newTrav,
    display_predicate: displayPred,
    from_entity: edge.to_entity,
    to_entity: edge.from_entity,
  };
}

function clampLimits(raw?: Partial<SearchLimits>, reqLimit?: number): SearchLimits {
  const maxReturned = Math.max(1, Math.min(100, raw?.max_paths_returned ?? reqLimit ?? DEFAULT_SEARCH_LIMITS.max_paths_returned));
  return {
    max_nodes_expanded: Math.max(1, Math.min(500, raw?.max_nodes_expanded ?? DEFAULT_SEARCH_LIMITS.max_nodes_expanded)),
    max_edges_examined: Math.max(10, Math.min(25000, raw?.max_edges_examined ?? DEFAULT_SEARCH_LIMITS.max_edges_examined)),
    max_paths_returned: maxReturned,
    max_per_node_edges: Math.max(5, Math.min(5000, raw?.max_per_node_edges ?? DEFAULT_SEARCH_LIMITS.max_per_node_edges)),
    max_contextual_pages_per_node: Math.max(
      0,
      Math.min(100, raw?.max_contextual_pages_per_node ?? DEFAULT_SEARCH_LIMITS.max_contextual_pages_per_node),
    ),
  };
}

function parseCursor(cursor: string | null | undefined, sigPrefix: string): number | null {
  if (!cursor) return null;
  const parts = cursor.split(':');
  if (parts.length !== 3 || parts[0] !== 'mh1' || parts[2] !== sigPrefix) return null;
  const off = Number(parts[1]);
  return Number.isInteger(off) && off >= 0 ? off : null;
}

// === @section:logic:state-and-loader-budget ===
interface SearchBudgetTracker {
  limits: SearchLimits;
  hubConfig: HubPenaltyConfig;
  layers: GraphLayer[];
  predicates?: string[];
  direction: DirectionFilter;
  minQuality: QualityThreshold;
  languages?: string[];
  editions?: string[];
  contextualScope?: MultiHopQuery['contextual_scope'];
  minSameVerse?: number;
  minSameClause?: number;
  minCollocation?: number;
  nodesExpanded: number;
  edgesExamined: number;
  shardsRead: number;
  bytesRead: number;
  contextualPagesLoaded: number;
  limitsReached: Set<string>;
  missingShards: Set<string>;
  truncatedContextual: Set<string>;
  incompleteReasons: Set<string>;
  nodeCache: Map<string, NeighborLoadResult>;
}

async function fetchNodeEdges(
  loader: AdjacencyLoader,
  tracker: SearchBudgetTracker,
  entityKey: string,
  dir: DirectionFilter,
  targetHint: string | null,
  isIntermediateFilter: boolean,
): Promise<GraphEdge[]> {
  const cacheKey = `${entityKey}::${dir}::${targetHint || ''}`;
  const cached = tracker.nodeCache.get(cacheKey);
  if (cached) return cached.edges;

  const loadOpts: NeighborLoadOptions = {
    layers: tracker.layers,
    predicates: tracker.predicates,
    direction: dir,
    min_quality: tracker.minQuality,
    languages: tracker.languages,
    editions: tracker.editions,
    contextual_scope: tracker.contextualScope,
    min_same_verse: tracker.minSameVerse,
    min_same_clause: tracker.minSameClause,
    min_collocation: tracker.minCollocation,
    max_contextual_pages: tracker.limits.max_contextual_pages_per_node,
    target_hint: targetHint,
  };

  const res = await loader.getNeighbors(entityKey, loadOpts);
  tracker.shardsRead += res.shards_read;
  tracker.bytesRead += res.bytes_read;
  tracker.contextualPagesLoaded += res.contextual_pages_loaded;
  for (const ms of res.missing_shards) tracker.missingShards.add(ms);
  for (const reason of res.incomplete_reasons) tracker.incompleteReasons.add(reason);
  if (res.contextual_truncated) tracker.truncatedContextual.add(entityKey);
  if (res.uncovered_in_grammatical && tracker.layers.includes('grammatical') && res.edges.length === 0) {
    tracker.incompleteReasons.add(`${entityKey}: uncovered in grammatical layer (lexical/contextual/LXX may still exist).`);
  }

  let edges = res.edges;
  tracker.edgesExamined += edges.length;

  if (!tracker.hubConfig.allow_function_word_intermediates && isIntermediateFilter) {
    edges = edges.filter((e) => !isFunctionWordPos(e.to_entity.pos));
  }

  // Deterministic pre-ranking so per-node slicing retains highest-evidence neighbors first.
  edges = [...edges].sort((a, b) => {
    const sb = edgePreRankScore(b, tracker.hubConfig, true);
    const sa = edgePreRankScore(a, tracker.hubConfig, true);
    if (sb !== sa) return sb - sa;
    return a.edge_id.localeCompare(b.edge_id);
  });

  tracker.nodeCache.set(cacheKey, { ...res, edges });
  return edges;
}

function layerBalancedSlice(edges: GraphEdge[], maxEdges: number, targetKeys?: Set<string>): GraphEdge[] {
  if (edges.length <= maxEdges) return edges;
  const chosenIds = new Set<string>();
  const out: GraphEdge[] = [];
  const push = (e: GraphEdge): void => {
    if (out.length < maxEdges && !chosenIds.has(e.edge_id)) {
      chosenIds.add(e.edge_id);
      out.push(e);
    }
  };
  if (targetKeys?.size) {
    for (const e of edges) {
      if (targetKeys.has(e.to_entity.entity_key)) push(e);
    }
  }
  const perLayerReserve = Math.max(8, Math.floor(maxEdges / 6));
  const counts: Record<GraphLayer, number> = { grammatical: 0, lexical: 0, contextual: 0, lxx_translation: 0 };
  for (const e of edges) {
    if (counts[e.layer] < perLayerReserve) {
      counts[e.layer] += 1;
      push(e);
    }
  }
  for (const e of edges) {
    if (out.length >= maxEdges) break;
    push(e);
  }
  return out;
}

// === @section:logic:join-and-assembly ===
function hasLanguageConflict(edge: GraphEdge, langFilter: string[] | undefined): boolean {
  if (!langFilter || !langFilter.length) return false;
  const allowed = new Set(langFilter.map((l) => normalizeLang(l, '') || l.toLowerCase()));
  if (edge.from_entity.language && !allowed.has(edge.from_entity.language.toLowerCase())) return true;
  if (edge.to_entity.language && !allowed.has(edge.to_entity.language.toLowerCase())) return true;
  return false;
}

function inspectJoinMetadata(steps: PathStep[], extraWitnesses?: Map<string, HopEvidenceWitness[]>): {
  join_scope: JoinScope;
  shared_frame_ids: string[];
  shared_references: string[];
} {
  if (steps.length === 1) {
    const refs = new Set<string>(steps[0].evidence_summary.sample_references);
    for (const w of steps[0].evidence_summary.sample_witnesses) {
      if (w.reference) refs.add(w.reference);
    }
    return {
      join_scope: 'direct',
      shared_frame_ids: Array.from(new Set(steps[0].evidence_summary.sample_witnesses.map((w) => w.frame_id || '').filter(Boolean))),
      shared_references: Array.from(refs).slice(0, 12),
    };
  }

  const perStepFrames: Array<Set<string>> = [];
  const perStepRefs: Array<Set<string>> = [];
  let allHavePassageEvidence = true;

  for (const s of steps) {
    const frames = new Set<string>();
    const refs = new Set<string>(s.evidence_summary.sample_references);
    const witnesses = extraWitnesses?.get(s.source_relationship_id) ?? s.evidence_summary.sample_witnesses;
    for (const w of witnesses) {
      if (w.frame_id) frames.add(w.frame_id);
      if (w.reference) refs.add(w.reference);
    }
    if (s.layer === 'lexical' || s.layer === 'lxx_translation') allHavePassageEvidence = false;
    perStepFrames.push(frames);
    perStepRefs.push(refs);
  }

  let sharedFrames = perStepFrames[0];
  let sharedRefs = perStepRefs[0];
  for (let i = 1; i < steps.length; i++) {
    sharedFrames = new Set([...sharedFrames].filter((f) => perStepFrames[i].has(f)));
    sharedRefs = new Set([...sharedRefs].filter((r) => perStepRefs[i].has(r)));
  }

  if (sharedFrames.size > 0) {
    return { join_scope: 'same_frame', shared_frame_ids: Array.from(sharedFrames).slice(0, 12), shared_references: Array.from(sharedRefs).slice(0, 12) };
  }
  if (sharedRefs.size > 0) {
    return { join_scope: 'same_passage', shared_frame_ids: [], shared_references: Array.from(sharedRefs).slice(0, 12) };
  }
  return {
    join_scope: allHavePassageEvidence ? 'cross_passage' : 'lexical_or_translation_bridge',
    shared_frame_ids: [],
    shared_references: [],
  };
}

function buildMultiHopPath(
  edges: GraphEdge[],
  hubConfig: HubPenaltyConfig,
  extraWitnesses?: Map<string, HopEvidenceWitness[]>,
): MultiHopPath {
  const steps = edges.map((e, i) => buildPathStep(i + 1, e));
  const entities: GraphEntityRef[] = [steps[0].from_entity, ...steps.map((s) => s.to_entity)];
  const joinInfo = inspectJoinMetadata(steps, extraWitnesses);
  const scored = scoreAndExplainPath(steps, hubConfig, joinInfo);
  return {
    path_id: computePathId(steps),
    hop_count: steps.length,
    entities,
    steps,
    layers_used: Array.from(new Set(steps.map((s) => s.layer))),
    epistemic_classes: Array.from(new Set(steps.map((s) => s.epistemic_class))),
    ranking: scored.ranking,
    uncertainty_indicators: scored.uncertainty_indicators,
    interpretation_guardrails: scored.interpretation_guardrails,
    explanation: scored.explanation,
  };
}

// === @section:logic:bidirectional-and-bfs-traversal ===
function wouldCreateCycle(chain: GraphEdge[], nextEntityKey: string, allowCycles: boolean): boolean {
  if (allowCycles) return false;
  if (chain.length > 0 && chain[0].from_entity.entity_key === nextEntityKey) return true;
  return chain.some((e) => e.to_entity.entity_key === nextEntityKey);
}

async function runTargetSearch(
  loader: AdjacencyLoader,
  tracker: SearchBudgetTracker,
  sourceKey: string,
  targetKeys: Set<string>,
  maxHops: number,
  allowCycles: boolean,
): Promise<GraphEdge[][]> {
  const rawPaths = new Map<string, GraphEdge[]>();
  const recordChain = (chain: GraphEdge[]): void => {
    const key = chain.map((e) => e.edge_id).join('>');
    if (!rawPaths.has(key)) rawPaths.set(key, chain);
  };

  const singleHint = targetKeys.size === 1 ? Array.from(targetKeys)[0] : null;
  tracker.nodesExpanded += 1;
  const fwd0 = await fetchNodeEdges(loader, tracker, sourceKey, tracker.direction, singleHint, false);

  // 1-hop direct
  for (const e1 of fwd0) {
    if (hasLanguageConflict(e1, tracker.languages)) continue;
    if (targetKeys.has(e1.to_entity.entity_key)) {
      recordChain([e1]);
    }
  }
  if (maxHops === 1) return Array.from(rawPaths.values());

  // Reverse frontier from each target (allows 2-hop meet-in-the-middle without expanding intermediates)
  const revDir = reverseDirectionFilter(tracker.direction);
  const revMap = new Map<string, GraphEdge[]>(); // intermediateKey -> flipped edges (B -> target)
  for (const tKey of targetKeys) {
    if (tracker.nodesExpanded >= tracker.limits.max_nodes_expanded) {
      tracker.limitsReached.add('max_nodes_expanded');
      break;
    }
    tracker.nodesExpanded += 1;
    const revRaw = await fetchNodeEdges(loader, tracker, tKey, revDir, sourceKey, false);
    for (const rEdge of revRaw) {
      const fwdEdge = flipIncomingEdgeToForward(rEdge);
      if (hasLanguageConflict(fwdEdge, tracker.languages)) continue;
      if (!tracker.hubConfig.allow_function_word_intermediates && isFunctionWordPos(fwdEdge.from_entity.pos)) continue;
      const mid = fwdEdge.from_entity.entity_key;
      const list = revMap.get(mid) || [];
      list.push(fwdEdge);
      revMap.set(mid, list);
    }
  }

  // 2-hop meet-in-the-middle: source -e1-> mid -e2-> target
  for (const e1 of fwd0) {
    const mid = e1.to_entity.entity_key;
    if (mid === sourceKey && !allowCycles) continue;
    if (!tracker.hubConfig.allow_function_word_intermediates && isFunctionWordPos(e1.to_entity.pos)) continue;
    if (targetKeys.has(mid) && !allowCycles) continue;
    const matches = revMap.get(mid);
    if (!matches) continue;
    for (const e2 of matches) {
      recordChain([e1, e2]);
    }
  }
  if (maxHops === 2) return Array.from(rawPaths.values());

  // 3-hop: expand promising depth-1 nodes fwd0 -> C -> revMap[C] -> target
  const fwd0Frontier = fwd0.length > tracker.limits.max_per_node_edges
    ? (tracker.limitsReached.add(`max_per_node_edges (${tracker.limits.max_per_node_edges}) at ${sourceKey}`), layerBalancedSlice(fwd0, tracker.limits.max_per_node_edges, targetKeys))
    : fwd0;
  for (const e1 of fwd0Frontier) {
    const bKey = e1.to_entity.entity_key;
    if (!allowCycles && (bKey === sourceKey || targetKeys.has(bKey))) continue;
    if (!tracker.hubConfig.allow_function_word_intermediates && isFunctionWordPos(e1.to_entity.pos)) continue;
    if (tracker.nodesExpanded >= tracker.limits.max_nodes_expanded) {
      tracker.limitsReached.add('max_nodes_expanded');
      break;
    }
    if (tracker.edgesExamined >= tracker.limits.max_edges_examined) {
      tracker.limitsReached.add('max_edges_examined');
      break;
    }
    tracker.nodesExpanded += 1;
    const fwd1Raw = await fetchNodeEdges(loader, tracker, bKey, tracker.direction, null, true);
    const fwd1 = fwd1Raw.length > tracker.limits.max_per_node_edges
      ? (tracker.limitsReached.add(`max_per_node_edges (${tracker.limits.max_per_node_edges}) at ${bKey}`), layerBalancedSlice(fwd1Raw, tracker.limits.max_per_node_edges, targetKeys))
      : fwd1Raw;
    for (const e2 of fwd1) {
      const cKey = e2.to_entity.entity_key;
      if (!allowCycles && (cKey === sourceKey || cKey === bKey || targetKeys.has(cKey))) continue;
      const tailEdges = revMap.get(cKey);
      if (!tailEdges) continue;
      for (const e3 of tailEdges) {
        if (!allowCycles && (e3.to_entity.entity_key === bKey || e3.to_entity.entity_key === cKey)) continue;
        recordChain([e1, e2, e3]);
      }
    }
  }
  return Array.from(rawPaths.values());
}

async function runOpenEndedSearch(
  loader: AdjacencyLoader,
  tracker: SearchBudgetTracker,
  sourceKey: string,
  maxHops: number,
  allowCycles: boolean,
): Promise<GraphEdge[][]> {
  const results: GraphEdge[][] = [];
  let frontier: GraphEdge[][] = [];

  tracker.nodesExpanded += 1;
  const fwd0Raw = await fetchNodeEdges(loader, tracker, sourceKey, tracker.direction, null, false);
  for (const e1 of fwd0Raw) {
    if (hasLanguageConflict(e1, tracker.languages)) continue;
    if (!allowCycles && e1.to_entity.entity_key === sourceKey) continue;
    results.push([e1]);
  }
  const fwd0Frontier = fwd0Raw.length > tracker.limits.max_per_node_edges
    ? (tracker.limitsReached.add(`max_per_node_edges (${tracker.limits.max_per_node_edges}) at ${sourceKey}`), layerBalancedSlice(fwd0Raw, tracker.limits.max_per_node_edges))
    : fwd0Raw;
  for (const e1 of fwd0Frontier) {
    if (hasLanguageConflict(e1, tracker.languages)) continue;
    if (!allowCycles && e1.to_entity.entity_key === sourceKey) continue;
    frontier.push([e1]);
  }

  for (let depth = 2; depth <= maxHops; depth++) {
    const nextFrontier: GraphEdge[][] = [];
    for (const chain of frontier) {
      const tip = chain[chain.length - 1].to_entity;
      if (!tracker.hubConfig.allow_function_word_intermediates && isFunctionWordPos(tip.pos)) continue;
      if (tracker.nodesExpanded >= tracker.limits.max_nodes_expanded) {
        tracker.limitsReached.add('max_nodes_expanded');
        return results;
      }
      if (tracker.edgesExamined >= tracker.limits.max_edges_examined) {
        tracker.limitsReached.add('max_edges_examined');
        return results;
      }
      tracker.nodesExpanded += 1;
      const adjRaw = await fetchNodeEdges(loader, tracker, tip.entity_key, tracker.direction, null, true);
      const adj = adjRaw.length > tracker.limits.max_per_node_edges
        ? (tracker.limitsReached.add(`max_per_node_edges (${tracker.limits.max_per_node_edges}) at ${tip.entity_key}`), layerBalancedSlice(adjRaw, tracker.limits.max_per_node_edges))
        : adjRaw;
      for (const nextEdge of adj) {
        if (hasLanguageConflict(nextEdge, tracker.languages)) continue;
        if (wouldCreateCycle(chain, nextEdge.to_entity.entity_key, allowCycles)) continue;
        const nextChain = [...chain, nextEdge];
        results.push(nextChain);
        if (depth < maxHops) nextFrontier.push(nextChain);
      }
    }
    frontier = nextFrontier;
  }
  return results;
}

// === @section:logic:entrypoint-and-pagination ===
async function enrichTopGrammaticalJoins(
  loader: AdjacencyLoader,
  chains: GraphEdge[][],
  hubConfig: HubPenaltyConfig,
): Promise<MultiHopPath[]> {
  // Rank preliminarily and lazily verify full summary witnesses on top grammatical multi-hop candidates.
  const prelim = chains.map((c) => ({ chain: c, path: buildMultiHopPath(c, hubConfig) }));
  prelim.sort((a, b) => compareMultiHopPaths(a.path, b.path));

  const extraWitnesses = new Map<string, HopEvidenceWitness[]>();
  const summaryBudget = 24;
  let fetched = 0;
  for (const item of prelim.slice(0, 20)) {
    if (item.chain.length < 2) continue;
    if (!item.chain.every((e) => e.layer === 'grammatical')) continue;
    if (item.path.explanation.join_scope === 'same_frame') continue;
    for (const edge of item.chain) {
      if (fetched >= summaryBudget) break;
      if (!extraWitnesses.has(edge.source_relationship_id)) {
        const fullW = await loader.getSummaryEvidence(edge.source_relationship_id);
        extraWitnesses.set(edge.source_relationship_id, fullW);
        fetched += 1;
      }
    }
  }

  const finalMap = new Map<string, MultiHopPath>();
  for (const c of chains) {
    const built = buildMultiHopPath(c, hubConfig, extraWitnesses.size > 0 ? extraWitnesses : undefined);
    if (!finalMap.has(built.path_id)) finalMap.set(built.path_id, built);
  }
  const finalPaths = Array.from(finalMap.values());
  finalPaths.sort(compareMultiHopPaths);
  return finalPaths;
}

function buildInvalidResponse(
  status: MultiHopResult['status'],
  message: string,
  sourceKey: string,
  maxHops: number,
  releaseVersion: string,
  layers: GraphLayer[],
  query: MultiHopQuery,
  hubConfig: HubPenaltyConfig,
): MultiHopResult {
  return {
    schema_version: '1.0',
    release_version: releaseVersion,
    status,
    message,
    query: {
      starting_entity: { entity_key: sourceKey || query.source },
      target_entity: query.target ? { entity_key: query.target } : null,
      applied_filters: {
        layers,
        predicates: query.predicates ?? null,
        direction: query.direction ?? 'both',
        min_quality: query.min_quality ?? 'all',
        languages: query.languages ?? null,
        editions: query.editions ?? null,
        allow_cycles: Boolean(query.allow_cycles),
        allow_function_word_intermediates: hubConfig.allow_function_word_intermediates,
      },
      max_hops: maxHops,
    },
    paths: [],
    pagination: { limit: 0, offset: 0, returned: 0, total_available: 0, has_more: false, next_offset: null, next_cursor: null },
    coverage: {
      exhaustive: false, search_stopped_by_limits: false, limits_reached: [],
      source_coverage_incomplete: status === 'incomplete_coverage',
      incomplete_reasons: status === 'incomplete_coverage' ? [message] : [],
      missing_shards: [], truncated_contextual_entities: [],
      nodes_expanded: 0, edges_examined: 0, shards_read: 0, bytes_read: 0,
      contextual_pages_loaded: 0, total_paths_found: 0, paths_returned: 0,
    },
    guardrails: {
      ranking_is_not_truth_probability: true,
      preserves_distinct_epistemic_classes: true,
      requires_verifiable_source_edges: true,
      cross_language_path_not_nt_theology_proof: true,
    },
  };
}

// === @section:logic:search-execution ===
export async function discoverMultiHopPaths(loader: AdjacencyLoader, query: MultiHopQuery): Promise<MultiHopResult> {
  const releaseVersion = await loader.getReleaseVersion();
  const layers = query.layers?.length ? query.layers : ALL_LAYERS;
  const hubConfig = mergeHubConfig(query.hub_penalty);
  const rawMaxHops = query.max_hops ?? 2;
  if (!Number.isInteger(rawMaxHops) || rawMaxHops < 1 || rawMaxHops > 3) {
    return buildInvalidResponse('invalid_request', `max_hops must be an integer between 1 and 3 (received ${rawMaxHops}).`, query.source, 2, releaseVersion, layers, query, hubConfig);
  }

  const sourceKey = await resolveEntityKey(loader, query.source);
  if (!sourceKey) {
    return buildInvalidResponse('invalid_request', `Invalid or ambiguous starting entity "${query.source}". Use resolveResearchConcept() first for English concepts or bare Strong's bases.`, query.source, rawMaxHops, releaseVersion, layers, query, hubConfig);
  }

  const targetKeys = new Set<string>();
  const targetInputs = [...(query.target ? [query.target] : []), ...(query.targets || [])];
  for (const t of targetInputs) {
    const rk = await resolveEntityKey(loader, t);
    if (!rk) {
      return buildInvalidResponse('invalid_request', `Invalid or ambiguous target entity "${t}".`, sourceKey, rawMaxHops, releaseVersion, layers, query, hubConfig);
    }
    targetKeys.add(rk);
  }

  const sourceProf = await loader.getEntityProfile(sourceKey);
  if (!sourceProf && sourceKey.startsWith('lemma:')) {
    const probe = await loader.getNeighbors(sourceKey, { max_contextual_pages: 0 });
    if (probe.missing_shards.length > 0 && probe.edges.length === 0) {
      return buildInvalidResponse('incomplete_coverage', `Source shards unavailable for ${sourceKey}.`, sourceKey, rawMaxHops, releaseVersion, layers, query, hubConfig);
    }
    if (probe.edges.length === 0) {
      return buildInvalidResponse('unknown_entity', `Entity "${sourceKey}" not found in relationship indexes.`, sourceKey, rawMaxHops, releaseVersion, layers, query, hubConfig);
    }
  }

  const limits = clampLimits(query.limits, query.limit);
  const tracker: SearchBudgetTracker = {
    limits,
    hubConfig,
    layers,
    predicates: query.predicates,
    direction: query.direction ?? 'both',
    minQuality: query.min_quality ?? 'all',
    languages: query.languages,
    editions: query.editions,
    contextualScope: query.contextual_scope,
    minSameVerse: query.min_same_verse,
    minSameClause: query.min_same_clause,
    minCollocation: query.min_collocation,
    nodesExpanded: 0,
    edgesExamined: 0,
    shardsRead: 0,
    bytesRead: 0,
    contextualPagesLoaded: 0,
    limitsReached: new Set<string>(),
    missingShards: new Set<string>(),
    truncatedContextual: new Set<string>(),
    incompleteReasons: new Set<string>(),
    nodeCache: new Map<string, NeighborLoadResult>(),
  };

  const allowCycles = Boolean(query.allow_cycles);
  const chains =
    targetKeys.size > 0
      ? await runTargetSearch(loader, tracker, sourceKey, targetKeys, rawMaxHops, allowCycles)
      : await runOpenEndedSearch(loader, tracker, sourceKey, rawMaxHops, allowCycles);

  const sortedPaths = await enrichTopGrammaticalJoins(loader, chains, hubConfig);
  const totalAvailable = sortedPaths.length;
  const sigPrefix = fnv1a64Hex(`${sourceKey}|${Array.from(targetKeys).sort().join(',')}|${rawMaxHops}|${layers.join(',')}|${totalAvailable}`).slice(0, 8);
  const offset = parseCursor(query.cursor, sigPrefix) ?? Math.max(0, query.offset ?? 0);
  const pageLimit = Math.max(1, Math.min(limits.max_paths_returned, query.limit ?? limits.max_paths_returned));
  const pagedPaths = sortedPaths.slice(offset, offset + pageLimit);
  const hasMore = offset + pagedPaths.length < totalAvailable;
  const nextOffset = hasMore ? offset + pagedPaths.length : null;

  const targetProfiles = await Promise.all(Array.from(targetKeys).map(async (k) => (await loader.getEntityProfile(k)) || { entity_key: k }));
  const stoppedByLimits = tracker.limitsReached.size > 0;
  const sourceIncomplete = tracker.missingShards.size > 0 || tracker.truncatedContextual.size > 0;
  const coverage: SearchCoverageMetadata = {
    exhaustive: !stoppedByLimits && !sourceIncomplete,
    search_stopped_by_limits: stoppedByLimits,
    limits_reached: Array.from(tracker.limitsReached),
    source_coverage_incomplete: sourceIncomplete,
    incomplete_reasons: Array.from(tracker.incompleteReasons),
    missing_shards: Array.from(tracker.missingShards),
    truncated_contextual_entities: Array.from(tracker.truncatedContextual),
    nodes_expanded: tracker.nodesExpanded,
    edges_examined: tracker.edgesExamined,
    shards_read: tracker.shardsRead,
    bytes_read: tracker.bytesRead,
    contextual_pages_loaded: tracker.contextualPagesLoaded,
    total_paths_found: totalAvailable,
    paths_returned: pagedPaths.length,
  };

  const status: MultiHopResult['status'] =
    pagedPaths.length > 0 ? 'ok' : tracker.missingShards.size > 0 ? 'incomplete_coverage' : 'no_supported_path';
  const message =
    pagedPaths.length > 0
      ? `Found ${totalAvailable} evidence-backed path(s) within ${rawMaxHops} hop(s).`
      : tracker.missingShards.size > 0
        ? 'Search could not verify paths because required relationship shards were unavailable.'
        : 'No supported path within the requested scope.';

  return {
    schema_version: '1.0',
    release_version: releaseVersion,
    status,
    message,
    query: {
      starting_entity: sourceProf || { entity_key: sourceKey },
      target_entity: targetKeys.size === 1 ? targetProfiles[0] : null,
      target_entities: targetKeys.size > 1 ? targetProfiles : undefined,
      applied_filters: {
        layers,
        predicates: query.predicates ?? null,
        direction: tracker.direction,
        min_quality: tracker.minQuality,
        languages: query.languages ?? null,
        editions: query.editions ?? null,
        allow_cycles: allowCycles,
        allow_function_word_intermediates: hubConfig.allow_function_word_intermediates,
      },
      max_hops: rawMaxHops,
    },
    paths: pagedPaths,
    pagination: {
      limit: pageLimit,
      offset,
      returned: pagedPaths.length,
      total_available: totalAvailable,
      has_more: hasMore,
      next_offset: nextOffset,
      next_cursor: nextOffset !== null ? `mh1:${nextOffset}:${sigPrefix}` : null,
    },
    coverage,
    guardrails: {
      ranking_is_not_truth_probability: true,
      preserves_distinct_epistemic_classes: true,
      requires_verifiable_source_edges: true,
      cross_language_path_not_nt_theology_proof: true,
    },
  };
}
