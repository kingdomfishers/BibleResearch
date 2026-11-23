// @file: src/relationships/subgraph-engine.ts
// @feature: relationships
// @tables: none
// @candidates: none
// @toc: types | logic:helpers | logic:steiner-kmb | logic:find-subgraph

// === @section:types ===

import type { AssetReadResult, AssetReader } from './adjacency-loader.ts';
import { DEFAULT_R10_RELEASE, discoverBiblicalConnections } from './r10-discovery.ts';
import type { R10ConnectionSummary, R10EpistemicClass } from './r10-types.ts';

export type SubgraphNodeKind = 'lemma' | 'passage' | 'motif' | 'person' | 'concept';

export type SubgraphEdgeFamily =
  | 'wordplay_consonantal'
  | 'shares_root'
  | 'co_occurs_with'
  | 'explicitly_interprets'
  | 'translates_in_lxx'
  | 'parallels_scene'
  | 'shares_motif_cluster'
  | 'genealogical_relation'
  | 'verified_cross_reference'
  | 'shared_rare_vocabulary';

export interface SubgraphNode {
  id: string;
  kind: SubgraphNodeKind;
  label: string;
  strongs?: string;
  script?: string;
  transliteration?: string;
  gloss?: string;
  ref?: string;
  total_verses?: number;
  anchor_indices: number[];
  is_steiner_bridge: boolean;
}

export interface SubgraphEdge {
  id: string;
  evidence_id: string;
  from_node: string;
  to_node: string;
  family: SubgraphEdgeFamily;
  predicate: string;
  epistemic_class: R10EpistemicClass | string;
  evidence_tier: 1 | 2 | 3 | 4 | 5;
  weight: number;
  cost: number;
  score: number;
  title: string;
  summary: string;
  witness_refs: string[];
  original_words: Array<{
    strongs?: string;
    lemma_script: string;
    transliteration: string;
    gloss: string;
  }>;
  in_steiner_tree: boolean;
  is_closure_edge: boolean;
  uncertainty_note?: string;
}

export interface SubgraphAnchorPath {
  from_anchor_index: number;
  to_anchor_index: number;
  from_anchor: string;
  to_anchor: string;
  hop_count: number;
  total_cost: number;
  path_score: number;
  node_ids: string[];
  edge_ids: string[];
  epistemic_class: string;
  evidence_tier: 1 | 2 | 3 | 4 | 5;
  title: string;
  why: string;
  witness_refs: string[];
}

export interface SubgraphMotifClosure {
  motif_id: string;
  shape: 'triangle' | 'diamond' | 'multi_anchor_star' | 'steiner_chain';
  node_ids: string[];
  edge_ids: string[];
  covered_anchor_indices: number[];
  epistemic_class: string;
  evidence_tier: 1 | 2 | 3 | 4 | 5;
  title: string;
  summary: string;
  witness_refs: string[];
  score: number;
}

export interface SubgraphRequest {
  anchors: string[];
  max_hops?: number;
  max_nodes?: number;
  max_edges?: number;
  include_exploratory?: boolean;
  release_id?: string;
}

export interface SubgraphVerifiedProofEdge {
  anchor_pair: [number, number];
  from_anchor: string;
  to_anchor: string;
  from_node: string;
  to_node: string;
  evidence_id: string;
  predicate: string;
  epistemic_class: string;
  evidence_tier: 1 | 2 | 3 | 4 | 5;
  witness_refs: string[];
  summary: string;
}

export interface SubgraphGraphProof {
  proof_type: 'triangle' | 'diamond_network' | 'steiner_tree' | 'direct_pair' | 'partial_components';
  is_complete: boolean;
  independent_edge_count: number;
  distinct_node_pair_count: number;
  covered_anchors: string[];
  uncovered_anchors: string[];
  verified_edges: SubgraphVerifiedProofEdge[];
}

export interface SubgraphDiscoveryPacket {
  schema_version: 1;
  status: 'ok' | 'invalid_request';
  release_id: string;
  anchors: Array<{
    index: number;
    input: string;
    terminal_node_ids: string[];
    resolved_strongs: string[];
    resolved_refs: string[];
  }>;
  is_complete: boolean;
  all_endpoints_connected: boolean;
  connected_anchor_indices: number[];
  connected_anchor_count: number;
  total_anchor_count: number;
  graph_proof: SubgraphGraphProof;
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  paths: SubgraphAnchorPath[];
  motifs: SubgraphMotifClosure[];
  steiner_bridges: SubgraphNode[];
  summary: string;
}

// === @section:logic:helpers ===

const GENERIC_HUB_STRONGS = new Set([
  'H0853', 'H3588', 'H0834', 'H3068', 'H0430', 'H0559', 'H1961', 'H0935', 'H5414', 'H6213',
  'H0376', 'H1121', 'H0776', 'H3117', 'H1697', 'H4428', 'H5971', 'H1004', 'H3478', 'H0413',
  'G3588', 'G2532', 'G1161', 'G0846', 'G1722', 'G1519', 'G3754', 'G1510', 'G3004', 'G2316',
  'G2962', 'G0444', 'G1093', 'G3956',
]);

function padStrongs(raw: string): string {
  const m = /^([HG])0*(\d+)[A-Z]*$/i.exec(String(raw || '').trim());
  return m ? `${m[1].toUpperCase()}${m[2].padStart(4, '0')}` : '';
}

function classifyEdgeFamily(conn: R10ConnectionSummary): SubgraphEdgeFamily {
  const id = conn.evidence_id || conn.connection_id || '';
  const pred = String(conn.predicate || conn.evidence_type || '');
  if (id.startsWith('r13:wp:') || id.startsWith('r11:orth:') || pred === 'orthographic_wordplay' || pred === 'orthographic_overlap') {
    return 'wordplay_consonantal';
  }
  if (id.startsWith('r13:si:') || id.startsWith('r10:ident:') || id.startsWith('r13:symchain:') || pred === 'explicit_identification') {
    return 'explicitly_interprets';
  }
  if (id.startsWith('r11:lxx:')) return 'translates_in_lxx';
  if (id.startsWith('r11:lex:') || pred === 'shared_root_family' || conn.evidence_type === 'documented_root_family') return 'shares_root';
  if (id.startsWith('r13:colloc:') || id.startsWith('r11:colloc:')) return 'co_occurs_with';
  if (id.startsWith('r11:scene:') || id.startsWith('r11:gram:') || pred === 'structural_scene_parallel') {
    return 'parallels_scene';
  }
  if (id.startsWith('r13:motif:') || id.startsWith('r10:motif:') || pred === 'shared_motif') {
    return 'shares_motif_cluster';
  }
  if (id.startsWith('r12:prop:')) return 'genealogical_relation';
  if (id.startsWith('r11:xref:')) return 'verified_cross_reference';
  return 'shared_rare_vocabulary';
}

function createCachingReader(baseReader: AssetReader, maxUniqueReads = 24): AssetReader {
  const jsonCache = new Map<string, Promise<AssetReadResult | null>>();
  let reads = 0;
  return {
    readJson(assetPath: string): Promise<AssetReadResult | null> {
      const existing = jsonCache.get(assetPath);
      if (existing) return existing;
      if (reads >= maxUniqueReads && !assetPath.includes('fast-manifest') && !assetPath.includes('concept-index') && !assetPath.includes('explicit-and-typology') && !assetPath.includes('motifs-and-patterns')) {
        return Promise.resolve(null);
      }
      reads++;
      const p = baseReader.readJson(assetPath).catch(() => null);
      jsonCache.set(assetPath, p);
      return p;
    },
    ...(baseReader.decodeB64GzJson
      ? {
          decodeB64GzJson<T = any>(b64: string, cacheKey?: string): Promise<T> | T {
            return baseReader.decodeB64GzJson!<T>(b64, cacheKey);
          },
        }
      : {}),
  };
}

// === @section:logic:steiner-kmb ===

interface ShortestPathResult {
  cost: number;
  nodeIds: string[];
  edgeIds: string[];
}

function findShortestBoundedPath(
  adj: Map<string, SubgraphEdge[]>,
  nodesById: Map<string, SubgraphNode>,
  startNodes: Set<string>,
  targetNodes: Set<string>,
  maxHops: number,
): ShortestPathResult | null {
  for (const s of startNodes) {
    if (targetNodes.has(s)) {
      return { cost: 0, nodeIds: [s], edgeIds: [] };
    }
  }

  let best: ShortestPathResult | null = null;
  const queue: Array<{ node: string; cost: number; nodes: string[]; edges: string[] }> = [];
  const bestCostAtHop = new Map<string, number>();

  for (const s of startNodes) {
    if (!adj.has(s)) continue;
    queue.push({ node: s, cost: 0, nodes: [s], edges: [] });
    bestCostAtHop.set(`${s}:0`, 0);
  }

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift()!;
    if (best && cur.cost >= best.cost) continue;
    const hops = cur.edges.length;
    if (hops >= maxHops) continue;

    for (const edge of adj.get(cur.node) || []) {
      const nextNode = edge.from_node === cur.node ? edge.to_node : edge.from_node;
      if (cur.nodes.includes(nextNode)) continue;

      const isTarget = targetNodes.has(nextNode);
      const nextMeta = nodesById.get(nextNode);
      // Intermediate non-terminal hubs with > 450 verses cannot act as interior bridge hops
      if (!isTarget) {
        if (nextMeta?.strongs && GENERIC_HUB_STRONGS.has(nextMeta.strongs)) continue;
        if (nextMeta?.total_verses && nextMeta.total_verses > 450) continue;
      }

      const nextCost = Math.round((cur.cost + edge.cost) * 10000) / 10000;
      if (best && nextCost >= best.cost) continue;

      const nextNodes = [...cur.nodes, nextNode];
      const nextEdges = [...cur.edges, edge.id];
      if (isTarget) {
        best = { cost: nextCost, nodeIds: nextNodes, edgeIds: nextEdges };
        continue;
      }

      if (nextEdges.length < maxHops) {
        const stateKey = `${nextNode}:${nextEdges.length}`;
        const prevCost = bestCostAtHop.get(stateKey);
        if (prevCost === undefined || nextCost < prevCost) {
          bestCostAtHop.set(stateKey, nextCost);
          queue.push({ node: nextNode, cost: nextCost, nodes: nextNodes, edges: nextEdges });
        }
      }
    }
  }

  return best;
}

// === @section:logic:find-subgraph ===

export async function findConnectedSubgraph(
  rawReader: AssetReader,
  request: SubgraphRequest,
): Promise<SubgraphDiscoveryPacket> {
  const rawAnchors = (request.anchors || []).map((a) => String(a || '').trim()).filter(Boolean).slice(0, 6);
  const releaseId = request.release_id || DEFAULT_R10_RELEASE;
  if (rawAnchors.length === 0) {
    return {
      schema_version: 1,
      status: 'invalid_request',
      release_id: releaseId,
      anchors: [],
      is_complete: false,
      all_endpoints_connected: false,
      connected_anchor_indices: [],
      connected_anchor_count: 0,
      total_anchor_count: 0,
      graph_proof: {
        proof_type: 'partial_components',
        is_complete: false,
        independent_edge_count: 0,
        distinct_node_pair_count: 0,
        covered_anchors: [],
        uncovered_anchors: [],
        verified_edges: [],
      },
      nodes: [],
      edges: [],
      paths: [],
      motifs: [],
      steiner_bridges: [],
      summary: 'At least one anchor is required for subgraph discovery.',
    };
  }

  const maxHops = Math.min(3, Math.max(1, Number(request.max_hops ?? 3)));
  const maxNodes = Math.min(120, Math.max(12, Number(request.max_nodes ?? 60)));
  const maxEdges = Math.min(400, Math.max(16, Number(request.max_edges ?? 160)));
  const includeExploratory = request.include_exploratory !== false;
  const reader = createCachingReader(rawReader, 22);

  // Run combined bridge query + individual anchor resolutions through the shared R13 discovery engine
  const perAnchorResults = await Promise.all(
    rawAnchors.map((a) =>
      discoverBiblicalConnections(
        reader,
        {
          query: a,
          mode: 'discover',
          limit: 12,
          filters: {
            include_orthographic: includeExploratory,
            include_candidate_patterns: true,
            include_interpretive: includeExploratory,
          },
        },
        releaseId,
      ),
    ),
  );

  const combinedResult =
    rawAnchors.length >= 2
      ? await discoverBiblicalConnections(
          reader,
          {
            query: rawAnchors.join(' ; '),
            mode: 'bridge',
            compare_targets: rawAnchors,
            limit: 24,
            filters: {
              include_orthographic: includeExploratory,
              include_candidate_patterns: true,
              include_interpretive: includeExploratory,
            },
          },
          releaseId,
        )
      : perAnchorResults[0];

  const nodesById = new Map<string, SubgraphNode>();
  const edgesById = new Map<string, SubgraphEdge>();

  const ensureNode = (partial: Omit<SubgraphNode, 'anchor_indices' | 'is_steiner_bridge'>, anchorIdx?: number): SubgraphNode => {
    let existing = nodesById.get(partial.id);
    if (!existing) {
      existing = {
        ...partial,
        anchor_indices: anchorIdx !== undefined ? [anchorIdx] : [],
        is_steiner_bridge: false,
      };
      nodesById.set(partial.id, existing);
    } else {
      if (anchorIdx !== undefined && !existing.anchor_indices.includes(anchorIdx)) {
        existing.anchor_indices.push(anchorIdx);
      }
      if (!existing.script && partial.script) existing.script = partial.script;
      if (!existing.gloss && partial.gloss) existing.gloss = partial.gloss;
      if (!existing.total_verses && partial.total_verses) existing.total_verses = partial.total_verses;
    }
    return existing;
  };

  // 1. Register terminal anchor nodes from each anchor's resolved Strong's and explicit passages
  const anchorRecords: SubgraphDiscoveryPacket['anchors'] = [];
  for (let i = 0; i < rawAnchors.length; i++) {
    const input = rawAnchors[i];
    const res = perAnchorResults[i];
    const termIds = new Set<string>();
    const strongsList: string[] = [];
    const refsList: string[] = [];

    const directBs = padStrongs(input);
    if (directBs) {
      strongsList.push(directBs);
      const nid = `lemma:${directBs}`;
      termIds.add(nid);
      ensureNode({ id: nid, kind: 'lemma', label: directBs, strongs: directBs }, i);
    }

    for (const ep of res.parsed_query?.explicit_passages || []) {
      if (ep.ref) {
        refsList.push(ep.ref);
        const pid = `passage:${ep.ref}`;
        termIds.add(pid);
        ensureNode({ id: pid, kind: 'passage', label: ep.ref, ref: ep.ref }, i);
      }
    }

    for (const rc of res.parsed_query?.resolved_concepts || []) {
      // Only attach top 2 specific lemmas per concept so polysemous English terms don't spray unrelated anchors
      const rcTv = rc.total_verses || 0;
      for (const w of (rc.lemmas || []).slice(0, 2)) {
        const bs = padStrongs(w.strongs || '');
        if (!bs) continue;
        if (rcTv > 900 && strongsList.length > 0) continue;
        if (!strongsList.includes(bs)) strongsList.push(bs);
        const nid = `lemma:${bs}`;
        termIds.add(nid);
        ensureNode(
          {
            id: nid,
            kind: 'lemma',
            label: `${w.lemma_script || bs} (${w.gloss || bs})`,
            strongs: bs,
            script: w.lemma_script,
            transliteration: w.transliteration,
            gloss: w.gloss,
            total_verses: rcTv || undefined,
          },
          i,
        );
      }
    }

    // If passage anchor has focal original words in strongest_connections, register rare focal words
    if (refsList.length > 0) {
      for (const conn of (res.strongest_connections || []).slice(0, 6)) {
        const hitsPassage = (conn.passages || []).some((p) => refsList.includes(p.ref));
        if (!hitsPassage) continue;
        for (const ow of (conn.original_words || []).slice(0, 2)) {
          const bs = padStrongs(ow.strongs || '');
          if (!bs || GENERIC_HUB_STRONGS.has(bs)) continue;
          if (!strongsList.includes(bs)) strongsList.push(bs);
          const nid = `lemma:${bs}`;
          termIds.add(nid);
          ensureNode(
            {
              id: nid,
              kind: 'lemma',
              label: `${ow.lemma_script || bs} (${ow.gloss || bs})`,
              strongs: bs,
              script: ow.lemma_script,
              transliteration: ow.transliteration,
              gloss: ow.gloss,
            },
            i,
          );
        }
      }
    }

    anchorRecords.push({
      index: i,
      input,
      terminal_node_ids: [...termIds],
      resolved_strongs: strongsList,
      resolved_refs: refsList,
    });
  }

  // Helper to ingest a connection summary into the multigraph
  const addConnectionEdge = (conn: R10ConnectionSummary, sourceAnchorIdx?: number) => {
    const id = conn.evidence_id || conn.connection_id;
    if (!id) return;
    const pred = String(conn.predicate || conn.evidence_type || '');
    const family = classifyEdgeFamily(conn);

    // Filter out weak pericope window intersections unless they have explicit cue or high tier
    if (id.startsWith('r11:pericope:') && (conn.evidence_tier || 5) >= 4) {
      return;
    }

    const words = (conn.original_words || [])
      .map((w) => ({
        strongs: padStrongs(w.strongs || ''),
        lemma_script: w.lemma_script || '',
        transliteration: w.transliteration || '',
        gloss: w.gloss || '',
      }))
      .filter((w) => Boolean(w.strongs));

    // Reject same-script shares_root relations with < 2 shared consonants (EV05 defense)
    if (
      (id.startsWith('r11:lex:') || family === 'shares_root') &&
      words.length >= 2 &&
      words[0].strongs &&
      words[1].strongs &&
      words[0].strongs[0] === words[1].strongs[0]
    ) {
      const getCons = (s: string) =>
        new Set(
          [...(String(s || '').split(/[,;/]/)[0] || '').normalize('NFD')]
            .filter((ch) => {
              const cp = ch.codePointAt(0) || 0;
              return (cp >= 0x05d0 && cp <= 0x05ea) || (cp >= 0x03b1 && cp <= 0x03c9) || (cp >= 0x0391 && cp <= 0x03a9);
            })
            .map((c) => c.toLowerCase()),
        );
      const cA = getCons(words[0].lemma_script);
      const cB = getCons(words[1].lemma_script);
      if (cA.size > 0 && cB.size > 0) {
        const shared = [...cB].filter((c) => cA.has(c));
        if (shared.length < 2) return;
      }
    }

    const pRefs = (conn.passages || [])
      .map((p) => p.ref)
      .filter((r): r is string => Boolean(r && !/^Verse \d+$/.test(r)));

    for (const w of words) {
      if (!w.strongs) continue;
      ensureNode({
        id: `lemma:${w.strongs}`,
        kind: 'lemma',
        label: `${w.lemma_script || w.strongs} (${w.gloss || w.strongs})`,
        strongs: w.strongs,
        script: w.lemma_script,
        transliteration: w.transliteration,
        gloss: w.gloss,
      });
    }
    for (const r of pRefs.slice(0, 3)) {
      ensureNode({ id: `passage:${r}`, kind: 'passage', label: r, ref: r });
    }

    const candidatePairs: Array<[string, string]> = [];
    if (words.length >= 2 && words[0].strongs !== words[1].strongs) {
      candidatePairs.push([`lemma:${words[0].strongs}`, `lemma:${words[1].strongs}`]);
      if (words.length >= 3 && words[2].strongs && words[2].strongs !== words[0].strongs && words[2].strongs !== words[1].strongs) {
        candidatePairs.push([`lemma:${words[0].strongs}`, `lemma:${words[2].strongs}`]);
        candidatePairs.push([`lemma:${words[1].strongs}`, `lemma:${words[2].strongs}`]);
      }
    }
    if (pRefs.length >= 2 && pRefs[0] !== pRefs[1]) {
      candidatePairs.push([`passage:${pRefs[0]}`, `passage:${pRefs[1]}`]);
    }
    if (words.length >= 1 && pRefs.length >= 1) {
      candidatePairs.push([`lemma:${words[0].strongs}`, `passage:${pRefs[0]}`]);
      if (pRefs.length >= 2) {
        candidatePairs.push([`lemma:${words[0].strongs}`, `passage:${pRefs[1]}`]);
      }
    }
    if (candidatePairs.length === 0 && sourceAnchorIdx !== undefined) {
      const aNode = anchorRecords[sourceAnchorIdx]?.terminal_node_ids[0];
      const bNode = words[0]?.strongs ? `lemma:${words[0].strongs}` : pRefs[0] ? `passage:${pRefs[0]}` : '';
      if (aNode && bNode && aNode !== bNode) candidatePairs.push([aNode, bNode]);
    }

    const rawScore = Number(conn.score ?? 100);
    const tier = (conn.evidence_tier || 3) as 1 | 2 | 3 | 4 | 5;
    const normWeight = Math.max(0.15, Math.min(1.0, rawScore / 450));
    const cost = Math.round(((1.15 - normWeight) + (tier - 1) * 0.18) * 1000) / 1000;

    for (let idx = 0; idx < candidatePairs.length; idx++) {
      const [u, v] = candidatePairs[idx];
      if (!u || !v || u === v) continue;
      const pairKey = [u, v].sort().join('<->') + `:${family}`;
      const existing = edgesById.get(pairKey);
      if (existing && existing.score >= rawScore) continue;
      edgesById.set(pairKey, {
        id: pairKey,
        evidence_id: id,
        from_node: u,
        to_node: v,
        family,
        predicate: pred,
        epistemic_class: conn.epistemic_class,
        evidence_tier: tier,
        weight: Math.round(normWeight * 1000) / 1000,
        cost: Math.max(0.1, cost),
        score: rawScore,
        title: conn.title,
        summary: conn.explanation || conn.title,
        witness_refs: pRefs,
        original_words: words.map((w) => ({
          strongs: w.strongs,
          lemma_script: w.lemma_script,
          transliteration: w.transliteration,
          gloss: w.gloss,
        })),
        in_steiner_tree: false,
        is_closure_edge: false,
        ...(conn.uncertainty_note ? { uncertainty_note: conn.uncertainty_note } : {}),
      });
    }
  };

  for (const conn of combinedResult.strongest_connections || []) {
    addConnectionEdge(conn);
  }
  for (let i = 0; i < perAnchorResults.length; i++) {
    for (const conn of (perAnchorResults[i].strongest_connections || []).slice(0, 10)) {
      addConnectionEdge(conn, i);
    }
  }

  // Also check genealogy_index_b64gz in motifs-and-patterns.json.gz for direct kinship edges between resolved Strong's
  try {
    const mpRes = await reader.readJson('/v2/relationships/r11-v1.0/r10/motifs-and-patterns.json.gz');
    const mp = mpRes?.data as any;
    if (mp?.genealogy_index_b64gz && reader.decodeB64GzJson) {
      const gen = await reader.decodeB64GzJson<any>(mp.genealogy_index_b64gz, '/r10/genealogy_index');
      if (gen?.people_by_bs && Array.isArray(gen?.edges)) {
        const activePersonToBs = new Map<string, string>();
        for (const a of anchorRecords) {
          for (const bs of a.resolved_strongs) {
            for (const pid of gen.people_by_bs[bs] || []) {
              activePersonToBs.set(pid, bs);
            }
          }
        }
        if (activePersonToBs.size > 0) {
          for (const ge of gen.edges) {
            const fromBs = activePersonToBs.get(ge.from);
            const toBs = activePersonToBs.get(ge.to);
            if (fromBs && toBs && fromBs !== toBs) {
              const p1 = gen.people_by_id?.[ge.from]?.name || ge.from;
              const p2 = gen.people_by_id?.[ge.to]?.name || ge.to;
              const pairKey = [`lemma:${fromBs}`, `lemma:${toBs}`].sort().join('<->') + ':genealogical_relation';
              if (!edgesById.has(pairKey)) {
                edgesById.set(pairKey, {
                  id: pairKey,
                  evidence_id: `r13:gen:${ge.from}:${ge.to}:${ge.type}`,
                  from_node: `lemma:${fromBs}`,
                  to_node: `lemma:${toBs}`,
                  family: 'genealogical_relation',
                  predicate: 'genealogical_relation',
                  epistemic_class: 'direct_textual_evidence',
                  evidence_tier: 1,
                  weight: 0.92,
                  cost: 0.23,
                  score: 390,
                  title: `Genealogical relationship: ${p1} -> ${p2} (${ge.type})`,
                  summary: `${p1} (${fromBs}) and ${p2} (${toBs}) are linked by ${ge.category || 'explicit'} ${ge.type} relation${ge.ref ? ` in ${ge.ref}` : ''}.`,
                  witness_refs: ge.ref ? [ge.ref] : [],
                  original_words: [],
                  in_steiner_tree: false,
                  is_closure_edge: false,
                });
              }
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal if motifs shard unavailable
  }

  // Build adjacency map
  const adj = new Map<string, SubgraphEdge[]>();
  for (const edge of edgesById.values()) {
    let listU = adj.get(edge.from_node);
    if (!listU) { listU = []; adj.set(edge.from_node, listU); }
    listU.push(edge);
    let listV = adj.get(edge.to_node);
    if (!listV) { listV = []; adj.set(edge.to_node, listV); }
    listV.push(edge);
  }

  // 2. Compute all-pairs shortest bounded paths between anchor terminal sets (KMB metric closure step 1)
  const paths: SubgraphAnchorPath[] = [];
  const pairwiseShortest = new Map<string, ShortestPathResult>();
  const anchorAdj = new Map<number, Set<number>>();
  for (let i = 0; i < anchorRecords.length; i++) anchorAdj.set(i, new Set([i]));

  for (let i = 0; i < anchorRecords.length; i++) {
    const setI = new Set(anchorRecords[i].terminal_node_ids);
    if (setI.size === 0) continue;
    for (let j = i + 1; j < anchorRecords.length; j++) {
      const setJ = new Set(anchorRecords[j].terminal_node_ids);
      if (setJ.size === 0) continue;
      const sp = findShortestBoundedPath(adj, nodesById, setI, setJ, maxHops);
      if (!sp) continue;

      pairwiseShortest.set(`${i}:${j}`, sp);
      anchorAdj.get(i)!.add(j);
      anchorAdj.get(j)!.add(i);

      const pathEdges = sp.edgeIds.map((eid) => edgesById.get(eid)!).filter(Boolean);
      const worstTierNum = pathEdges.reduce<number>((acc, e) => Math.max(acc, e.evidence_tier), 1);
      const worstTier = Math.min(5, Math.max(1, worstTierNum)) as 1 | 2 | 3 | 4 | 5;
      const witnessRefs = [...new Set(pathEdges.flatMap((e) => e.witness_refs))].slice(0, 6);
      const hopSummaries = pathEdges.map((e) => e.title);
      const pathScore = Math.max(
        40,
        Math.round(
          (pathEdges.reduce((s, e) => s + e.score, 0) / Math.max(1, pathEdges.length)) *
            Math.pow(0.88, Math.max(0, pathEdges.length - 1)),
        ),
      );

      paths.push({
        from_anchor_index: i,
        to_anchor_index: j,
        from_anchor: anchorRecords[i].input,
        to_anchor: anchorRecords[j].input,
        hop_count: pathEdges.length,
        total_cost: sp.cost,
        path_score: pathScore,
        node_ids: sp.nodeIds,
        edge_ids: sp.edgeIds,
        epistemic_class: pathEdges.length === 1 ? String(pathEdges[0].epistemic_class) : 'multi_hop_research_path',
        evidence_tier: worstTier,
        title:
          pathEdges.length === 1
            ? pathEdges[0].title
            : `Steiner bridge (${pathEdges.length} hops): ${anchorRecords[i].input} <-> ${anchorRecords[j].input}`,
        why: hopSummaries.join(' -> ') || `${anchorRecords[i].input} shares terminal identity with ${anchorRecords[j].input}`,
        witness_refs: witnessRefs,
      });
    }
  }

  // 3. Compute largest connected component of anchors via BFS
  let largestComp: number[] = anchorRecords.length > 0 ? [0] : [];
  const visitedAnchors = new Set<number>();
  for (let i = 0; i < anchorRecords.length; i++) {
    if (visitedAnchors.has(i)) continue;
    const comp: number[] = [];
    const q = [i];
    visitedAnchors.add(i);
    while (q.length > 0) {
      const cur = q.shift()!;
      comp.push(cur);
      for (const nxt of anchorAdj.get(cur) || []) {
        if (!visitedAnchors.has(nxt)) {
          visitedAnchors.add(nxt);
          q.push(nxt);
        }
      }
    }
    comp.sort((a, b) => a - b);
    if (comp.length > largestComp.length) largestComp = comp;
  }

  // 4. KMB Steiner Tree construction over metric closure of connected anchor terminals
  const steinerNodeIds = new Set<string>();
  const steinerEdgeIds = new Set<string>();
  for (const aIdx of largestComp) {
    for (const tid of anchorRecords[aIdx].terminal_node_ids) steinerNodeIds.add(tid);
  }

  const metricEdges = [...pairwiseShortest.entries()]
    .map(([k, sp]) => {
      const [iStr, jStr] = k.split(':');
      return { i: Number(iStr), j: Number(jStr), sp };
    })
    .sort((a, b) => a.sp.cost - b.sp.cost);

  const ufParent = anchorRecords.map((_, idx) => idx);
  const ufFind = (x: number): number => (ufParent[x] === x ? x : (ufParent[x] = ufFind(ufParent[x])));
  for (const me of metricEdges) {
    const ri = ufFind(me.i);
    const rj = ufFind(me.j);
    if (ri !== rj) {
      ufParent[ri] = rj;
      for (const nid of me.sp.nodeIds) steinerNodeIds.add(nid);
      for (const eid of me.sp.edgeIds) {
        steinerEdgeIds.add(eid);
        const e = edgesById.get(eid);
        if (e) e.in_steiner_tree = true;
      }
    }
  }

  // 5. Strict mathematical cycle & motif closure over Steiner nodes (EV11/EV12/C05):
  // - Exclude intra-anchor edges (where both nodes belong only to the same single anchor index, e.g. Adam<->ground inside Gen 2:7 on C05)
  // - Deduplicate parallel edges by unordered node pair [u, v] and unordered anchor pair [i, j]
  const isIntraSingleAnchorEdge = (edge: SubgraphEdge): boolean => {
    if (anchorRecords.length < 2) return false;
    const uAnchors = nodesById.get(edge.from_node)?.anchor_indices || [];
    const vAnchors = nodesById.get(edge.to_node)?.anchor_indices || [];
    if (uAnchors.length === 1 && vAnchors.length === 1 && uAnchors[0] === vAnchors[0]) {
      return true;
    }
    return false;
  };

  // Track best edge per unordered node pair [u, v] among steinerNodeIds
  const bestTreeEdgeByNodePair = new Map<string, SubgraphEdge>();
  for (const eid of [...steinerEdgeIds]) {
    const e = edgesById.get(eid);
    if (!e || isIntraSingleAnchorEdge(e)) {
      steinerEdgeIds.delete(eid);
      if (e) e.in_steiner_tree = false;
      continue;
    }
    const npKey = [e.from_node, e.to_node].sort().join('<->');
    const prev = bestTreeEdgeByNodePair.get(npKey);
    if (!prev || e.score > prev.score) {
      bestTreeEdgeByNodePair.set(npKey, e);
    }
  }

  for (const edge of edgesById.values()) {
    if (isIntraSingleAnchorEdge(edge)) continue;
    if (steinerNodeIds.has(edge.from_node) && steinerNodeIds.has(edge.to_node)) {
      const npKey = [edge.from_node, edge.to_node].sort().join('<->');
      if (!bestTreeEdgeByNodePair.has(npKey)) {
        edge.is_closure_edge = true;
        bestTreeEdgeByNodePair.set(npKey, edge);
        steinerEdgeIds.add(edge.id);
      }
    }
  }

  // Build verified anchor-pair proof edges (one best independent edge per connected anchor pair i < j)
  const verifiedProofEdges: SubgraphVerifiedProofEdge[] = [];
  const usedProofEvidenceIds = new Set<string>();
  const distinctAnchorPairsConnected = new Set<string>();
  for (let i = 0; i < anchorRecords.length; i++) {
    for (let j = i + 1; j < anchorRecords.length; j++) {
      const sp = pairwiseShortest.get(`${i}:${j}`);
      if (!sp || sp.edgeIds.length === 0) continue;
      const pathEdges = sp.edgeIds
        .map((eid) => edgesById.get(eid)!)
        .filter((e) => Boolean(e && !isIntraSingleAnchorEdge(e)));
      if (pathEdges.length === 0) continue;
      // Only count as a direct anchor-pair edge for triangle/cycle detection when hop_count === 1
      // and backed by an independent evidence_id
      const primaryEdge = pathEdges[0];
      if (pathEdges.length === 1 && !usedProofEvidenceIds.has(primaryEdge.evidence_id)) {
        distinctAnchorPairsConnected.add(`${i}:${j}`);
      }
      for (const pe of pathEdges) {
        usedProofEvidenceIds.add(pe.evidence_id);
      }
      const worstTierNum = pathEdges.reduce<number>((acc, e) => Math.max(acc, e.evidence_tier), 1);
      const worstTier = Math.min(5, Math.max(1, worstTierNum)) as 1 | 2 | 3 | 4 | 5;
      verifiedProofEdges.push({
        anchor_pair: [i, j],
        from_anchor: anchorRecords[i].input,
        to_anchor: anchorRecords[j].input,
        from_node: primaryEdge.from_node,
        to_node: pathEdges[pathEdges.length - 1].to_node,
        evidence_id: pathEdges.map((e) => e.evidence_id).join(' -> '),
        predicate: pathEdges.length === 1 ? primaryEdge.predicate : 'steiner_bridge_path',
        epistemic_class: pathEdges.length === 1 ? String(primaryEdge.epistemic_class) : 'multi_hop_research_path',
        evidence_tier: worstTier,
        witness_refs: [...new Set(pathEdges.flatMap((e) => e.witness_refs))].slice(0, 6),
        summary: pathEdges.map((e) => e.title).join(' -> '),
      });
    }
  }

  // Mark interior Steiner bridge nodes
  const steinerBridges: SubgraphNode[] = [];
  for (const nid of steinerNodeIds) {
    const n = nodesById.get(nid);
    if (!n) continue;
    if (n.anchor_indices.length === 0) {
      n.is_steiner_bridge = true;
      steinerBridges.push(n);
    }
  }

  // 6. Synthesize higher-order motifs with strict cycle rank check over distinct node pairs
  const motifs: SubgraphMotifClosure[] = [];
  const isComplete = anchorRecords.length >= 2 && largestComp.length === anchorRecords.length;
  const uniqueTreeEdges = [...bestTreeEdgeByNodePair.values()];
  const activeTreeNodes = new Set<string>();
  for (const e of uniqueTreeEdges) {
    activeTreeNodes.add(e.from_node);
    activeTreeNodes.add(e.to_node);
  }
  const hasTrueGraphCycle =
    uniqueTreeEdges.length >= activeTreeNodes.size && activeTreeNodes.size >= 3;
  const isTrueThreeAnchorTriangle =
    anchorRecords.length === 3 && distinctAnchorPairsConnected.size === 3 && hasTrueGraphCycle;

  if (isComplete && uniqueTreeEdges.length > 0) {
    const worstTierNum = uniqueTreeEdges.reduce<number>((acc, e) => Math.max(acc, e.evidence_tier), 1);
    const worstTier = Math.min(5, Math.max(1, worstTierNum)) as 1 | 2 | 3 | 4 | 5;
    const refs = [...new Set(uniqueTreeEdges.flatMap((e) => e.witness_refs))].slice(0, 8);
    const shape: SubgraphMotifClosure['shape'] = isTrueThreeAnchorTriangle
      ? 'triangle'
      : anchorRecords.length >= 4 && hasTrueGraphCycle
        ? 'diamond'
        : steinerBridges.length > 0
          ? 'multi_anchor_star'
          : 'steiner_chain';

    motifs.push({
      motif_id: `r13:subgraph:${shape}:${anchorRecords.map((a) => a.input).join('+')}`,
      shape,
      node_ids: [...activeTreeNodes],
      edge_ids: uniqueTreeEdges.map((e) => e.id),
      covered_anchor_indices: largestComp,
      epistemic_class:
        worstTier <= 2
          ? 'convergent_textual_pattern'
          : hasTrueGraphCycle
            ? 'convergent_multi_channel_pattern'
            : 'multi_hop_research_path',
      evidence_tier: worstTier,
      title: `Convergent ${shape.replace(/_/g, ' ')} connecting ${anchorRecords.map((a) => a.input).join(' <-> ')}`,
      summary: uniqueTreeEdges.map((e) => e.title).slice(0, 4).join(' | '),
      witness_refs: refs,
      score: Math.round(
        uniqueTreeEdges.reduce((s, e) => s + e.score, 0) / Math.max(1, uniqueTreeEdges.length) +
          (isTrueThreeAnchorTriangle ? 40 : hasTrueGraphCycle ? 25 : 15),
      ),
    });
  }

  const coveredAnchors = largestComp.map((i) => anchorRecords[i].input);
  const uncoveredAnchors = anchorRecords
    .filter((_, idx) => !largestComp.includes(idx))
    .map((a) => a.input);
  const proofType: SubgraphGraphProof['proof_type'] = !isComplete
    ? 'partial_components'
    : anchorRecords.length === 2
      ? 'direct_pair'
      : isTrueThreeAnchorTriangle
        ? 'triangle'
        : hasTrueGraphCycle
          ? 'diamond_network'
          : 'steiner_tree';
  const graphProof: SubgraphGraphProof = {
    proof_type: proofType,
    is_complete: isComplete,
    independent_edge_count: distinctAnchorPairsConnected.size || uniqueTreeEdges.length,
    distinct_node_pair_count: uniqueTreeEdges.length,
    covered_anchors: coveredAnchors,
    uncovered_anchors: uncoveredAnchors,
    verified_edges: verifiedProofEdges,
  };

  // Sort and bound returned nodes & edges (prioritizing Steiner tree + anchor nodes first)
  const sortedEdges = [...edgesById.values()]
    .sort(
      (a, b) =>
        Number(b.in_steiner_tree) - Number(a.in_steiner_tree) ||
        Number(b.is_closure_edge) - Number(a.is_closure_edge) ||
        b.score - a.score,
    )
    .slice(0, maxEdges);

  const retainedNodeIds = new Set<string>(steinerNodeIds);
  for (const e of sortedEdges) {
    if (retainedNodeIds.size >= maxNodes) break;
    retainedNodeIds.add(e.from_node);
    retainedNodeIds.add(e.to_node);
  }
  const sortedNodes = [...nodesById.values()]
    .filter((n) => retainedNodeIds.has(n.id))
    .sort(
      (a, b) =>
        b.anchor_indices.length - a.anchor_indices.length ||
        Number(b.is_steiner_bridge) - Number(a.is_steiner_bridge) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, maxNodes);

  const summary = isComplete
    ? `Connected all ${anchorRecords.length} anchors (${anchorRecords.map((a) => a.input).join(', ')}) via ${steinerEdgeIds.size} Steiner/closure edges and ${steinerBridges.length} intermediate bridge node(s).`
    : anchorRecords.length >= 2
      ? `Connected ${largestComp.length} of ${anchorRecords.length} requested anchors; no verified <= ${maxHops}-hop original-language path bridged all endpoints.`
      : `Built local discovery neighborhood around ${anchorRecords[0].input} (${sortedNodes.length} nodes, ${sortedEdges.length} edges).`;

  return {
    schema_version: 1,
    status: 'ok',
    release_id: releaseId,
    anchors: anchorRecords,
    is_complete: isComplete,
    all_endpoints_connected: isComplete,
    connected_anchor_indices: largestComp,
    connected_anchor_count: largestComp.length,
    total_anchor_count: anchorRecords.length,
    graph_proof: graphProof,
    nodes: sortedNodes,
    edges: sortedEdges,
    paths,
    motifs,
    steiner_bridges: steinerBridges,
    summary,
  };
}
