// @file: src/relationships/multihop-search.ts
// @feature: relationships-r9c
// Bounded, deterministic 1-3 hop graph traversal with lazy adjacency, cycle detection, and completeness tracking.

import { fnv1a64Hex, isFunctionWordPos, normalizeLang } from './adjacency-loader.ts';
import { resolveEntityKeyDetailed } from './concept-resolver.ts';
import {
  ADMIN_PREDICATES,
  buildPathStep,
  compareMultiHopPaths,
  computePathId,
  edgePreRankScore,
  mergeHubConfig,
  pathStepToR12ProofStep,
  R12_SCORE_VERSION,
  rankR12DiscoveryDestinations,
  scoreAndExplainPath,
} from './path-ranker.ts';
import type {
  AdjacencyLoader,
  AssetBudgetContext,
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
  max_asset_requests: 120,
  max_execution_ms: 4000,
  max_bytes_read: 32 * 1024 * 1024,
  max_candidate_paths: 500,
  max_summary_hydrations: 6,
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
    max_edges_examined: Math.max(1, Math.min(25000, raw?.max_edges_examined ?? DEFAULT_SEARCH_LIMITS.max_edges_examined)),
    max_paths_returned: maxReturned,
    max_per_node_edges: Math.max(1, Math.min(5000, raw?.max_per_node_edges ?? DEFAULT_SEARCH_LIMITS.max_per_node_edges)),
    max_contextual_pages_per_node: Math.max(
      0,
      Math.min(100, raw?.max_contextual_pages_per_node ?? DEFAULT_SEARCH_LIMITS.max_contextual_pages_per_node),
    ),
    max_asset_requests: Math.max(1, Math.min(500, raw?.max_asset_requests ?? DEFAULT_SEARCH_LIMITS.max_asset_requests)),
    max_execution_ms: Math.max(25, Math.min(15000, raw?.max_execution_ms ?? DEFAULT_SEARCH_LIMITS.max_execution_ms)),
    max_bytes_read: Math.max(1024, Math.min(128 * 1024 * 1024, raw?.max_bytes_read ?? DEFAULT_SEARCH_LIMITS.max_bytes_read)),
    max_candidate_paths: Math.max(maxReturned, Math.min(2000, raw?.max_candidate_paths ?? DEFAULT_SEARCH_LIMITS.max_candidate_paths)),
    max_summary_hydrations: Math.max(0, Math.min(20, raw?.max_summary_hydrations ?? DEFAULT_SEARCH_LIMITS.max_summary_hydrations ?? 6)),
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
  startTimeMs: number;
  limits: SearchLimits;
  budget: AssetBudgetContext;
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

function hasRemainingExecutionAndResourceBudget(tracker: SearchBudgetTracker, checkNodeLimit = true): boolean {
  if (Date.now() - tracker.startTimeMs >= tracker.limits.max_execution_ms) {
    tracker.limitsReached.add('max_execution_ms');
    return false;
  }
  if (tracker.budget.budget_exceeded) {
    tracker.limitsReached.add(tracker.budget.exceeded_reason || 'max_asset_requests');
    return false;
  }
  if (tracker.budget.asset_requests >= tracker.limits.max_asset_requests) {
    tracker.limitsReached.add('max_asset_requests');
    return false;
  }
  if (tracker.budget.bytes_read >= tracker.limits.max_bytes_read) {
    tracker.limitsReached.add('max_bytes_read');
    return false;
  }
  if (tracker.edgesExamined >= tracker.limits.max_edges_examined) {
    tracker.limitsReached.add('max_edges_examined');
    return false;
  }
  if (checkNodeLimit && tracker.nodesExpanded >= tracker.limits.max_nodes_expanded) {
    tracker.limitsReached.add('max_nodes_expanded');
    return false;
  }
  return true;
}

function enforcePerNodeCap(
  tracker: SearchBudgetTracker,
  edges: GraphEdge[],
  entityKey: string,
  targetKeys?: Set<string>,
): GraphEdge[] {
  if (edges.length <= tracker.limits.max_per_node_edges) return edges;
  tracker.limitsReached.add(`max_per_node_edges (${tracker.limits.max_per_node_edges}) at ${entityKey}`);
  return layerBalancedSlice(edges, tracker.limits.max_per_node_edges, targetKeys);
}

async function fetchNodeEdges(
  loader: AdjacencyLoader,
  tracker: SearchBudgetTracker,
  entityKey: string,
  dir: DirectionFilter,
  targetHint: string | null,
  isIntermediateFilter: boolean,
  layersOverride?: GraphLayer[],
  targetHints?: string[],
): Promise<GraphEdge[]> {
  const effectiveLayers = layersOverride?.length ? layersOverride : tracker.layers;
  const layerSig = [...effectiveLayers].sort().join(',');
  const hintsSig = targetHints?.length ? [...targetHints].sort().join(',') : targetHint || '';
  const cacheKey = `${entityKey}::${dir}::${layerSig}::${hintsSig}`;
  const cached = tracker.nodeCache.get(cacheKey);
  if (cached) return cached.edges;

  if (!hasRemainingExecutionAndResourceBudget(tracker, false)) return [];

  const loadOpts: NeighborLoadOptions = {
    layers: effectiveLayers,
    predicates: tracker.predicates,
    direction: dir,
    min_quality: tracker.minQuality,
    languages: tracker.languages,
    editions: tracker.editions,
    contextual_scope: tracker.contextualScope,
    min_same_verse: tracker.minSameVerse,
    min_same_clause: tracker.minSameClause,
    min_collocation: tracker.minCollocation,
    max_contextual_pages: isIntermediateFilter
      ? Math.min(1, tracker.limits.max_contextual_pages_per_node)
      : tracker.limits.max_contextual_pages_per_node,
    target_hint: targetHint,
    target_hints: targetHints,
    budget: tracker.budget,
  };

  const res = await loader.getNeighbors(entityKey, loadOpts);
  tracker.shardsRead += res.shards_read;
  tracker.bytesRead += res.bytes_read;
  tracker.contextualPagesLoaded += res.contextual_pages_loaded;
  for (const ms of res.missing_shards) tracker.missingShards.add(ms);
  for (const reason of res.incomplete_reasons) tracker.incompleteReasons.add(reason);
  if (res.contextual_truncated) tracker.truncatedContextual.add(entityKey);
  if (tracker.budget.budget_exceeded) {
    tracker.limitsReached.add(tracker.budget.exceeded_reason || 'max_asset_requests');
  }
  if (res.uncovered_in_grammatical && effectiveLayers.includes('grammatical') && res.edges.length === 0) {
    tracker.incompleteReasons.add(`${entityKey}: uncovered in grammatical layer (lexical/contextual/LXX may still exist).`);
  }

  const remainingEdgeBudget = Math.max(0, tracker.limits.max_edges_examined - tracker.edgesExamined);
  let edges = res.edges;
  if (edges.length > remainingEdgeBudget) {
    tracker.limitsReached.add('max_edges_examined');
    tracker.edgesExamined += remainingEdgeBudget;
    edges = edges.slice(0, remainingEdgeBudget);
  } else {
    tracker.edgesExamined += edges.length;
  }

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

function selectHop3LayersAndHints(
  bKey: string,
  requestedLayers: GraphLayer[],
  revHebrewKeys: string[],
  revGreekKeys: string[],
): { layers: GraphLayer[]; targetHints?: string[] } {
  const isRootOrSense = bKey.startsWith('root:') || bKey.startsWith('sense:');
  if (isRootOrSense) {
    return { layers: requestedLayers.filter((l) => l === 'lexical') };
  }
  const isGreek = bKey.startsWith('lemma:G');
  const isHebrew = bKey.startsWith('lemma:H');
  const sameCorpKeys = isGreek ? revGreekKeys : isHebrew ? revHebrewKeys : [];
  const crossCorpKeys = isGreek ? revHebrewKeys : isHebrew ? revGreekKeys : [];
  const layers = requestedLayers.filter((l) => {
    if (l === 'lexical') return true;
    if (l === 'grammatical' || l === 'contextual') return !isHebrew && !isGreek ? true : sameCorpKeys.length > 0;
    if (l === 'lxx_translation') return !isHebrew && !isGreek ? true : crossCorpKeys.length > 0;
    return true;
  });
  const targetHints = sameCorpKeys.length > 0 && sameCorpKeys.length <= 25 ? sameCorpKeys : undefined;
  return { layers, targetHints };
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
  const recordChain = (chain: GraphEdge[]): boolean => {
    const key = chain.map((e) => e.edge_id).join('>');
    if (rawPaths.has(key)) return true;
    if (rawPaths.size >= tracker.limits.max_candidate_paths) {
      tracker.limitsReached.add('max_candidate_paths');
      return false;
    }
    rawPaths.set(key, chain);
    return true;
  };

  if (!hasRemainingExecutionAndResourceBudget(tracker, true)) return [];
  const singleHint = targetKeys.size === 1 ? Array.from(targetKeys)[0] : null;
  tracker.nodesExpanded += 1;
  const fwd0All = await fetchNodeEdges(loader, tracker, sourceKey, tracker.direction, singleHint, false);
  const fwd0 = enforcePerNodeCap(tracker, fwd0All, sourceKey, targetKeys);

  // 1-hop direct
  for (const e1 of fwd0) {
    if (hasLanguageConflict(e1, tracker.languages)) continue;
    if (targetKeys.has(e1.to_entity.entity_key)) {
      if (!recordChain([e1])) break;
    }
  }
  if (maxHops === 1 || rawPaths.size >= tracker.limits.max_candidate_paths) {
    return Array.from(rawPaths.values());
  }

  // Reverse frontier from each target (allows 2-hop meet-in-the-middle without expanding intermediates)
  const revDir = reverseDirectionFilter(tracker.direction);
  const revMap = new Map<string, GraphEdge[]>(); // intermediateKey -> flipped edges (B -> target)
  for (const tKey of targetKeys) {
    if (!hasRemainingExecutionAndResourceBudget(tracker, true)) break;
    tracker.nodesExpanded += 1;
    const revRawAll = await fetchNodeEdges(loader, tracker, tKey, revDir, sourceKey, false);
    const revRaw = enforcePerNodeCap(tracker, revRawAll, tKey, new Set([sourceKey]));
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
  outer2: for (const e1 of fwd0) {
    const mid = e1.to_entity.entity_key;
    if (mid === sourceKey && !allowCycles) continue;
    if (!tracker.hubConfig.allow_function_word_intermediates && isFunctionWordPos(e1.to_entity.pos)) continue;
    if (targetKeys.has(mid) && !allowCycles) continue;
    const matches = revMap.get(mid);
    if (!matches) continue;
    for (const e2 of matches) {
      if (!recordChain([e1, e2])) break outer2;
    }
  }
  if (maxHops === 2 || revMap.size === 0 || rawPaths.size >= tracker.limits.max_candidate_paths) {
    return Array.from(rawPaths.values());
  }

  const revKeys = Array.from(revMap.keys());
  const revHebrewKeys = revKeys.filter((k) => k.startsWith('lemma:H'));
  const revGreekKeys = revKeys.filter((k) => k.startsWith('lemma:G'));
  const revTargetSet = new Set(revKeys);

  // 3-hop: expand promising depth-1 nodes fwd0 -> C -> revMap[C] -> target
  // Prefer documented lexical/LXX/grammatical links and nodes directly in revTargetSet ahead of broad contextual hubs.
  const layerOrderWeight = (layer: GraphLayer): number =>
    layer === 'lexical' ? 0 : layer === 'lxx_translation' ? 1 : layer === 'grammatical' ? 2 : 3;
  const fwd0ForHop3 = [...fwd0].sort((a, b) => {
    const aHit = revTargetSet.has(a.to_entity.entity_key) ? 0 : 1;
    const bHit = revTargetSet.has(b.to_entity.entity_key) ? 0 : 1;
    if (aHit !== bHit) return aHit - bHit;
    const la = layerOrderWeight(a.layer);
    const lb = layerOrderWeight(b.layer);
    if (la !== lb) return la - lb;
    return 0;
  });
  outer3: for (const e1 of fwd0ForHop3) {
    const bKey = e1.to_entity.entity_key;
    if (!allowCycles && (bKey === sourceKey || targetKeys.has(bKey))) continue;
    if (!tracker.hubConfig.allow_function_word_intermediates && isFunctionWordPos(e1.to_entity.pos)) continue;
    if (!hasRemainingExecutionAndResourceBudget(tracker, true)) break;

    const { layers: hop3Layers, targetHints } = selectHop3LayersAndHints(bKey, tracker.layers, revHebrewKeys, revGreekKeys);
    if (hop3Layers.length === 0) continue;

    tracker.nodesExpanded += 1;
    const fwd1Raw = await fetchNodeEdges(loader, tracker, bKey, tracker.direction, null, true, hop3Layers, targetHints);
    const fwd1 = enforcePerNodeCap(tracker, fwd1Raw, bKey, revTargetSet);
    for (const e2 of fwd1) {
      const cKey = e2.to_entity.entity_key;
      if (!allowCycles && (cKey === sourceKey || cKey === bKey || targetKeys.has(cKey))) continue;
      const tailEdges = revMap.get(cKey);
      if (!tailEdges) continue;
      for (const e3 of tailEdges) {
        if (!allowCycles && (e3.to_entity.entity_key === bKey || e3.to_entity.entity_key === cKey)) continue;
        if (!recordChain([e1, e2, e3])) break outer3;
      }
    }
  }
  return Array.from(rawPaths.values());
}

function isAdministrativeEdge(edge: GraphEdge): boolean {
  return ADMIN_PREDICATES.has(edge.predicate) || ADMIN_PREDICATES.has(edge.display_predicate);
}

function countSemanticHops(chain: GraphEdge[]): number {
  let hops = 0;
  for (const e of chain) {
    if (!isAdministrativeEdge(e)) hops += 1;
  }
  return hops;
}

function hasRedundantIdentityJoin(chain: GraphEdge[], nextEdge: GraphEdge): boolean {
  if (!isAdministrativeEdge(nextEdge)) return false;
  if (chain.length > 0 && isAdministrativeEdge(chain[chain.length - 1])) {
    // Prevent chaining sense->lemma->sense or lemma->root->lemma administrative oscillations
    return true;
  }
  const destKey = nextEdge.to_entity.entity_key;
  if (chain.some((e) => e.from_entity.entity_key === destKey || e.to_entity.entity_key === destKey)) {
    return true;
  }
  return false;
}

async function runR12BeamSearch(
  loader: AdjacencyLoader,
  tracker: SearchBudgetTracker,
  sourceKey: string,
  targetKeys: Set<string>,
  maxSemanticHops: number,
  maxPhysicalSteps: number,
  beamWidth: number,
  minSemanticHops: number,
  allowCycles: boolean,
): Promise<GraphEdge[][]> {
  const results = new Map<string, GraphEdge[]>();
  const recordChain = (chain: GraphEdge[]): boolean => {
    const sem = countSemanticHops(chain);
    if (sem < minSemanticHops || sem > maxSemanticHops) return true;
    const endKey = chain[chain.length - 1].to_entity.entity_key;
    if (endKey === sourceKey && !allowCycles) return true;
    if (targetKeys.size > 0 && !targetKeys.has(endKey)) return true;
    // Do not end an open-ended path on an administrative edge alone
    if (isAdministrativeEdge(chain[chain.length - 1])) return true;
    const key = chain.map((e) => e.edge_id).join('>');
    if (results.has(key)) return true;
    if (results.size >= tracker.limits.max_candidate_paths) {
      tracker.limitsReached.add('max_candidate_paths');
      return false;
    }
    results.set(key, chain);
    return true;
  };

  interface BeamItem {
    chain: GraphEdge[];
    score: number;
    semanticHops: number;
  }

  let frontier: BeamItem[] = [{ chain: [], score: 0, semanticHops: 0 }];
  const perNodeOutCap = Math.min(16, tracker.limits.max_per_node_edges);

  for (let physDepth = 1; physDepth <= maxPhysicalSteps; physDepth++) {
    if (frontier.length === 0 || results.size >= tracker.limits.max_candidate_paths) break;
    const nextCandidates: BeamItem[] = [];
    for (const item of frontier) {
      const currentKey = item.chain.length === 0 ? sourceKey : item.chain[item.chain.length - 1].to_entity.entity_key;
      const tipEntity = item.chain.length === 0 ? null : item.chain[item.chain.length - 1].to_entity;
      if (item.chain.length > 0 && !tracker.hubConfig.allow_function_word_intermediates && isFunctionWordPos(tipEntity?.pos || null)) {
        continue;
      }
      if (!hasRemainingExecutionAndResourceBudget(tracker, true)) {
        frontier = [];
        break;
      }
      tracker.nodesExpanded += 1;
      const adjRaw = await fetchNodeEdges(loader, tracker, currentKey, tracker.direction, null, item.chain.length > 0);
      const adj = layerBalancedSlice(adjRaw, perNodeOutCap, targetKeys.size > 0 ? targetKeys : undefined);
      for (const nextEdge of adj) {
        if (hasLanguageConflict(nextEdge, tracker.languages)) continue;
        if (nextEdge.to_entity.entity_key === sourceKey && !allowCycles) continue;
        if (wouldCreateCycle(item.chain, nextEdge.to_entity.entity_key, allowCycles)) continue;
        if (hasRedundantIdentityJoin(item.chain, nextEdge)) continue;
        const isAdmin = isAdministrativeEdge(nextEdge);
        const nextSemHops = item.semanticHops + (isAdmin ? 0 : 1);
        if (nextSemHops > maxSemanticHops) continue;

        const nextChain = [...item.chain, nextEdge];
        const edgeScore = edgePreRankScore(nextEdge, tracker.hubConfig, true);
        const nextScore = item.score + edgeScore * (isAdmin ? 0.25 : 1);

        if (!recordChain(nextChain)) {
          return Array.from(results.values());
        }
        if (physDepth < maxPhysicalSteps) {
          nextCandidates.push({ chain: nextChain, score: nextScore, semanticHops: nextSemHops });
        }
      }
    }

    if (nextCandidates.length === 0) break;
    // Stable deterministic beam selection up to beamWidth (default 64)
    nextCandidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ka = a.chain.map((e) => e.edge_id).join('>');
      const kb = b.chain.map((e) => e.edge_id).join('>');
      return ka.localeCompare(kb);
    });
    frontier = nextCandidates.slice(0, beamWidth);
  }

  return Array.from(results.values());
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
  const pushResult = (chain: GraphEdge[]): boolean => {
    if (results.length >= tracker.limits.max_candidate_paths) {
      tracker.limitsReached.add('max_candidate_paths');
      return false;
    }
    results.push(chain);
    return true;
  };

  if (!hasRemainingExecutionAndResourceBudget(tracker, true)) return results;
  tracker.nodesExpanded += 1;
  const fwd0All = await fetchNodeEdges(loader, tracker, sourceKey, tracker.direction, null, false);
  const fwd0Capped = enforcePerNodeCap(tracker, fwd0All, sourceKey);
  for (const e1 of fwd0Capped) {
    if (hasLanguageConflict(e1, tracker.languages)) continue;
    if (!allowCycles && e1.to_entity.entity_key === sourceKey) continue;
    if (!pushResult([e1])) break;
    frontier.push([e1]);
  }

  for (let depth = 2; depth <= maxHops; depth++) {
    if (results.length >= tracker.limits.max_candidate_paths) break;
    const nextFrontier: GraphEdge[][] = [];
    for (const chain of frontier) {
      const tip = chain[chain.length - 1].to_entity;
      if (!tracker.hubConfig.allow_function_word_intermediates && isFunctionWordPos(tip.pos)) continue;
      if (!hasRemainingExecutionAndResourceBudget(tracker, true)) return results;
      tracker.nodesExpanded += 1;
      const adjRaw = await fetchNodeEdges(loader, tracker, tip.entity_key, tracker.direction, null, true);
      const adj = enforcePerNodeCap(tracker, adjRaw, tip.entity_key);
      for (const nextEdge of adj) {
        if (hasLanguageConflict(nextEdge, tracker.languages)) continue;
        if (wouldCreateCycle(chain, nextEdge.to_entity.entity_key, allowCycles)) continue;
        const nextChain = [...chain, nextEdge];
        if (!pushResult(nextChain)) return results;
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
  tracker: SearchBudgetTracker,
): Promise<MultiHopPath[]> {
  // Rank preliminarily and lazily verify full summary witnesses on top grammatical multi-hop candidates.
  const prelim = chains.map((c) => ({ chain: c, path: buildMultiHopPath(c, hubConfig) }));
  prelim.sort((a, b) => compareMultiHopPaths(a.path, b.path));

  const extraWitnesses = new Map<string, HopEvidenceWitness[]>();
  const summaryBudget = Math.max(0, tracker.limits.max_summary_hydrations ?? 6);
  let fetched = 0;
  for (const item of summaryBudget > 0 ? prelim.slice(0, 6) : []) {
    if (item.chain.length < 2) continue;
    if (!item.chain.every((e) => e.layer === 'grammatical')) continue;
    if (item.path.explanation.join_scope === 'same_frame') continue;
    for (const edge of item.chain) {
      if (fetched >= summaryBudget) break;
      if (Date.now() - tracker.startTimeMs >= tracker.limits.max_execution_ms) {
        tracker.limitsReached.add('max_execution_ms');
        break;
      }
      if (tracker.budget.budget_exceeded || tracker.budget.asset_requests >= tracker.limits.max_asset_requests) {
        tracker.limitsReached.add(tracker.budget.exceeded_reason || 'max_asset_requests');
        break;
      }
      if (!extraWitnesses.has(edge.source_relationship_id)) {
        const fullW = await loader.getSummaryEvidence(edge.source_relationship_id, tracker.budget);
        if (tracker.budget.budget_exceeded) {
          tracker.limitsReached.add(tracker.budget.exceeded_reason || 'max_asset_requests');
        }
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
  budget?: AssetBudgetContext,
  executionMs = 0,
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
      exhaustive: false,
      search_stopped_by_limits: Boolean(budget?.budget_exceeded),
      limits_reached: budget?.budget_exceeded && budget.exceeded_reason ? [budget.exceeded_reason] : [],
      source_coverage_incomplete: status === 'incomplete_coverage',
      incomplete_reasons: status === 'incomplete_coverage' ? [message] : [],
      missing_shards: [],
      truncated_contextual_entities: [],
      nodes_expanded: 0,
      edges_examined: 0,
      asset_requests: budget?.asset_requests ?? 0,
      shards_read: budget?.shards_read ?? 0,
      bytes_read: budget?.bytes_read ?? 0,
      execution_ms: executionMs,
      contextual_pages_loaded: 0,
      total_paths_found: 0,
      paths_returned: 0,
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
  const startTimeMs = Date.now();
  const isR12Offline = query.offline_mode === 'r12';
  const limits = clampLimits(
    isR12Offline
      ? {
          max_nodes_expanded: 250,
          max_edges_examined: 12000,
          max_candidate_paths: 800,
          max_asset_requests: 400,
          max_execution_ms: 12000,
          ...query.limits,
        }
      : query.limits,
    query.limit,
  );
  const budget: AssetBudgetContext = {
    asset_requests: 0,
    shards_read: 0,
    bytes_read: 0,
    max_asset_requests: limits.max_asset_requests,
    max_bytes_read: limits.max_bytes_read,
    budget_exceeded: false,
    exceeded_reason: null,
  };
  const layers = query.layers?.length ? query.layers : ALL_LAYERS;
  const hubConfig = mergeHubConfig(query.hub_penalty);
  const rawMaxHops = query.max_hops ?? (isR12Offline ? 5 : 2);
  const minMeaningfulHops = Math.max(1, query.min_hops ?? (isR12Offline ? 2 : 1));
  const maxPhysicalSteps = Math.max(rawMaxHops, Math.min(10, query.max_physical_steps ?? 10));
  const beamWidth = Math.max(1, Math.min(64, query.beam_width ?? 64));
  const releaseVersion = await loader.getReleaseVersion(budget);
  if (budget.budget_exceeded) {
    return buildInvalidResponse('incomplete_coverage', `Stopped by resource budget (${budget.exceeded_reason}) before search started.`, query.source, 2, releaseVersion, layers, query, hubConfig, budget, Date.now() - startTimeMs);
  }
  const allowedMaxHopCap = isR12Offline ? 5 : 3;
  if (!Number.isInteger(rawMaxHops) || rawMaxHops < 1 || rawMaxHops > allowedMaxHopCap) {
    return buildInvalidResponse(
      'invalid_request',
      `max_hops must be an integer between 1 and ${allowedMaxHopCap} (received ${rawMaxHops}).`,
      query.source,
      2,
      releaseVersion,
      layers,
      query,
      hubConfig,
      budget,
      Date.now() - startTimeMs,
    );
  }
  if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) {
    return buildInvalidResponse('invalid_request', `offset must be a non-negative integer (received ${query.offset}).`, query.source, rawMaxHops, releaseVersion, layers, query, hubConfig, budget, Date.now() - startTimeMs);
  }

  const sourceRes = await resolveEntityKeyDetailed(loader, query.source, budget);
  if (!sourceRes.ok || !sourceRes.entityKey) {
    return buildInvalidResponse(
      sourceRes.status === 'unknown_entity' ? 'unknown_entity' : sourceRes.status === 'incomplete_coverage' ? 'incomplete_coverage' : 'invalid_request',
      sourceRes.message || `Invalid starting entity "${query.source}". Use resolveResearchConcept() first for ambiguous homographs or English concepts.`,
      query.source,
      rawMaxHops,
      releaseVersion,
      layers,
      query,
      hubConfig,
      budget,
      Date.now() - startTimeMs,
    );
  }
  const sourceKey = sourceRes.entityKey;

  const targetKeys = new Set<string>();
  const targetInputs = [...(query.target ? [query.target] : []), ...(query.targets || [])];
  for (const t of targetInputs) {
    const tr = await resolveEntityKeyDetailed(loader, t, budget);
    if (!tr.ok || !tr.entityKey) {
      return buildInvalidResponse(
        tr.status === 'unknown_entity' ? 'unknown_entity' : tr.status === 'incomplete_coverage' ? 'incomplete_coverage' : 'invalid_request',
        tr.message || `Invalid target entity "${t}".`,
        sourceKey,
        rawMaxHops,
        releaseVersion,
        layers,
        query,
        hubConfig,
        budget,
        Date.now() - startTimeMs,
      );
    }
    targetKeys.add(tr.entityKey);
  }

  const sourceProf = await loader.getEntityProfile(sourceKey, budget);
  const tracker: SearchBudgetTracker = {
    startTimeMs,
    limits,
    budget,
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
    limitsReached: new Set<string>(budget.budget_exceeded && budget.exceeded_reason ? [budget.exceeded_reason] : []),
    missingShards: new Set<string>(),
    truncatedContextual: new Set<string>(),
    incompleteReasons: new Set<string>(),
    nodeCache: new Map<string, NeighborLoadResult>(),
  };

  const allowCycles = Boolean(query.allow_cycles);
  const chains = isR12Offline
    ? await runR12BeamSearch(
        loader,
        tracker,
        sourceKey,
        targetKeys,
        rawMaxHops,
        maxPhysicalSteps,
        beamWidth,
        minMeaningfulHops,
        allowCycles,
      )
    : targetKeys.size > 0
      ? await runTargetSearch(loader, tracker, sourceKey, targetKeys, rawMaxHops, allowCycles)
      : await runOpenEndedSearch(loader, tracker, sourceKey, rawMaxHops, allowCycles);

  const sortedPaths = await enrichTopGrammaticalJoins(loader, chains, hubConfig, tracker);
  let r12Recommendations: MultiHopResult['r12_recommendations'];
  if (isR12Offline && sortedPaths.length > 0) {
    const r12Inputs = sortedPaths
      .filter((p) => p.steps.length > 0)
      .map((p) => ({
        path_id: p.path_id,
        anchor_id: p.entities[0].entity_key,
        target_id: p.entities[p.entities.length - 1].entity_key,
        steps: p.steps.map((st) => pathStepToR12ProofStep(st)),
      }))
      .filter((p) => p.anchor_id !== p.target_id && p.steps.some((st) => !st.administrative));
    if (r12Inputs.length > 0) {
      r12Recommendations = rankR12DiscoveryDestinations(r12Inputs, {
        top_n: 24,
        max_alternatives: 3,
        max_hops: rawMaxHops,
        max_physical_hops: maxPhysicalSteps,
        score_version: R12_SCORE_VERSION,
      });
    }
  }
  const totalAvailable = sortedPaths.length;
  const queryFingerprint = JSON.stringify({
    releaseVersion,
    sourceKey,
    targets: Array.from(targetKeys).sort(),
    maxHops: rawMaxHops,
    layers: [...layers].sort(),
    predicates: query.predicates ? [...query.predicates].sort() : null,
    direction: tracker.direction,
    minQuality: tracker.minQuality,
    languages: query.languages ? [...query.languages].map((l) => l.toLowerCase()).sort() : null,
    editions: query.editions ? [...query.editions].sort() : null,
    contextualScope: query.contextual_scope ?? 'all',
    minSameVerse: query.min_same_verse ?? null,
    minSameClause: query.min_same_clause ?? null,
    minCollocation: query.min_collocation ?? null,
    allowCycles,
    hubConfig,
    limits,
    totalAvailable,
  });
  const sigPrefix = fnv1a64Hex(queryFingerprint).slice(0, 16);

  let offset = Math.max(0, query.offset ?? 0);
  if (query.cursor !== undefined && query.cursor !== null && query.cursor !== '') {
    const parsedCursorOffset = parseCursor(query.cursor, sigPrefix);
    if (parsedCursorOffset === null || (totalAvailable > 0 && parsedCursorOffset >= totalAvailable) || (totalAvailable === 0 && parsedCursorOffset > 0)) {
      return buildInvalidResponse('invalid_request', 'Invalid or stale pagination cursor for the current query parameters or release.', sourceKey, rawMaxHops, releaseVersion, layers, query, hubConfig, budget, Date.now() - startTimeMs);
    }
    offset = parsedCursorOffset;
  }

  const pageLimit = Math.max(1, Math.min(limits.max_paths_returned, query.limit ?? limits.max_paths_returned));
  const pagedPaths = sortedPaths.slice(offset, offset + pageLimit);
  const hasMore = offset + pagedPaths.length < totalAvailable;
  const nextOffset = hasMore ? offset + pagedPaths.length : null;

  const targetProfiles = await Promise.all(Array.from(targetKeys).map(async (k) => (await loader.getEntityProfile(k, budget)) || { entity_key: k }));
  if (budget.budget_exceeded) tracker.limitsReached.add(budget.exceeded_reason || 'max_asset_requests');
  const stoppedByLimits = tracker.limitsReached.size > 0;
  const sourceIncomplete = tracker.missingShards.size > 0 || tracker.truncatedContextual.size > 0;
  const executionMs = Date.now() - tracker.startTimeMs;
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
    asset_requests: tracker.budget.asset_requests,
    shards_read: Math.max(tracker.shardsRead, tracker.budget.shards_read),
    bytes_read: Math.max(tracker.bytesRead, tracker.budget.bytes_read),
    execution_ms: executionMs,
    contextual_pages_loaded: tracker.contextualPagesLoaded,
    total_paths_found: totalAvailable,
    paths_returned: pagedPaths.length,
  };

  const incompleteEmpty = pagedPaths.length === 0 && (sourceIncomplete || stoppedByLimits);
  const status: MultiHopResult['status'] =
    pagedPaths.length > 0 ? 'ok' : incompleteEmpty ? 'incomplete_coverage' : 'no_supported_path';
  const message =
    pagedPaths.length > 0
      ? stoppedByLimits || sourceIncomplete
        ? `Found ${totalAvailable} evidence-backed path(s) within ${rawMaxHops} hop(s) (partial search: ${[...coverage.limits_reached, ...(sourceIncomplete ? ['incomplete_source_coverage'] : [])].join(', ')}).`
        : `Found ${totalAvailable} evidence-backed path(s) within ${rawMaxHops} hop(s).`
      : tracker.missingShards.size > 0
        ? 'Search could not verify paths because required relationship shards were unavailable.'
        : sourceIncomplete || stoppedByLimits
          ? `No path found before reaching exploration bounds (${[...coverage.limits_reached, ...Array.from(tracker.incompleteReasons)].slice(0, 3).join('; ')}); coverage is incomplete.`
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
    ...(r12Recommendations ? { r12_recommendations: r12Recommendations } : {}),
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
