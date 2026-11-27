// @file: src/relationships/motif-discovery.ts
// Algorithm B: Corpus-wide high-PMI collocations, typed 3-6 node multi-passage motif mining,
// and bounded runtime beam search. Compatible with Worker bundles and Node strip-types.

import type { WordplayCandidateEdge } from './wordplay-engine.ts';

export interface CollocationEdge {
  target_bs: string;
  shared_count: number;
  npmi: number;
  salience: number;
  sample_vids: number[];
}

export type MotifEdgeType = 'wordplay' | 'collocation' | 'lxx' | 'self_interpretation' | 'syntax';

export interface MotifEdgeRef {
  from_bs: string;
  to_bs: string;
  edge_type: MotifEdgeType;
  detail: string;
  weight: number;
  witness_vids: number[];
}

export interface MultiPassageMotif {
  motif_id: string;
  kind: 'triangle' | 'chain' | 'diamond';
  nodes: string[];
  edges: MotifEdgeRef[];
  witness_vids: number[];
  independent_chapters: number;
  distinct_edge_types: number;
  cross_testament: boolean;
  distinctiveness: number;
}

export interface MotifProfileInput {
  bs: string;
  script?: string;
  gloss?: string;
  total_verses: number;
  all_vids: number[];
}

export interface MotifInterpretationEdgeInput {
  from_bs: string;
  to_bs: string;
  verse_id: number;
  cue: string;
}

const COLLOC_STOP_STRONGS = new Set([
  'H0853', 'H0854', 'H4480', 'H0413', 'H5921', 'H0518', 'H3588', 'H0834', 'H1931', 'H0859', 'H0589', 'H0595',
  'H2088', 'H2063', 'H0428', 'H3605', 'H3808', 'H3541', 'H3651', 'H1571', 'H0408', 'H3863', 'H0559', 'H1696',
  'H1961', 'H0935', 'H1980', 'H5414', 'H6213', 'H3068', 'H3069',
  'G3588', 'G2532', 'G1161', 'G0846', 'G1722', 'G1519', 'G3754', 'G1473', 'G4771', 'G3778', 'G3739', 'G5100',
  'G5101', 'G1438', 'G1510', 'G1063', 'G3361', 'G3756', 'G3761', 'G235', 'G0235', 'G1537', 'G0575', 'G2596',
  'G3326', 'G4012', 'G4314', 'G5228', 'G5613', 'G3004', 'G1096', 'G4160', 'G2064', 'G2192',
]);

export function computeHighPmiCollocations(
  profiles: MotifProfileInput[],
  totalCorpusVerses = 31203,
  options: { maxPerLemma?: number; maxDf?: number } = {},
): Map<string, CollocationEdge[]> {
  const maxPerLemma = options.maxPerLemma ?? 12;
  const maxDf = options.maxDf ?? 2500;
  const N = Math.max(100, totalCorpusVerses);

  const valid = new Map<string, MotifProfileInput>();
  const verseToLemmas = new Map<number, string[]>();

  for (const p of profiles) {
    if (!p.bs || COLLOC_STOP_STRONGS.has(p.bs) || /^H900/.test(p.bs)) continue;
    if (p.total_verses < 2 || p.total_verses > maxDf || p.all_vids.length === 0) continue;
    valid.set(p.bs, p);
    for (const vid of p.all_vids) {
      let arr = verseToLemmas.get(vid);
      if (!arr) { arr = []; verseToLemmas.set(vid, arr); }
      arr.push(p.bs);
    }
  }

  // Pairwise co-occurrence counts + sample vids per unordered pair "A|B"
  const pairCounts = new Map<string, number>();
  const pairVids = new Map<string, number[]>();

  for (const [vid, lemmas] of verseToLemmas) {
    if (lemmas.length < 2 || lemmas.length > 55) continue;
    const uniq = lemmas.length <= 1 ? lemmas : [...new Set(lemmas)].sort();
    for (let i = 0; i < uniq.length; i++) {
      const a = uniq[i];
      for (let j = i + 1; j < uniq.length; j++) {
        const b = uniq[j];
        const key = `${a}|${b}`;
        const prev = pairCounts.get(key) || 0;
        pairCounts.set(key, prev + 1);
        let vids = pairVids.get(key);
        if (!vids) {
          vids = [vid];
          pairVids.set(key, vids);
        } else if (vids.length < 6) {
          vids.push(vid);
        }
      }
    }
  }

  const out = new Map<string, CollocationEdge[]>();
  const addEdge = (bs: string, edge: CollocationEdge) => {
    let arr = out.get(bs);
    if (!arr) { arr = []; out.set(bs, arr); }
    arr.push(edge);
  };

  for (const [key, count] of pairCounts) {
    const sep = key.indexOf('|');
    const a = key.slice(0, sep);
    const b = key.slice(sep + 1);
    const pA = valid.get(a);
    const pB = valid.get(b);
    if (!pA || !pB) continue;

    const dfA = Math.max(1, pA.total_verses);
    const dfB = Math.max(1, pB.total_verses);
    const minCount = Math.max(dfA, dfB) <= 140 ? 2 : 3;
    if (count < minCount) continue;

    const pXY = count / N;
    const pX = dfA / N;
    const pY = dfB / N;
    const pmi = Math.log2(pXY / (pX * pY));
    const denom = -Math.log2(pXY);
    const npmi = denom > 0 ? Math.round((pmi / denom) * 1000) / 1000 : 0;
    if (npmi < 0.08) continue;

    const hubPenalty = 0.55 + 0.45 / Math.log2(4 + Math.max(dfA, dfB) * 0.04);
    const salience = Math.round(npmi * Math.log2(1 + count) * hubPenalty * 1000) / 1000;
    const samples = pairVids.get(key) || [];

    addEdge(a, { target_bs: b, shared_count: count, npmi, salience, sample_vids: samples });
    addEdge(b, { target_bs: a, shared_count: count, npmi, salience, sample_vids: samples });
  }

  for (const [bs, list] of out) {
    list.sort((x, y) => y.salience - x.salience || y.shared_count - x.shared_count || x.target_bs.localeCompare(y.target_bs));
    out.set(bs, list.slice(0, maxPerLemma));
  }

  return out;
}

export interface MineMotifsParams {
  profiles: MotifProfileInput[];
  collocMap: ReadonlyMap<string, CollocationEdge[]>;
  wordplayMap?: ReadonlyMap<string, WordplayCandidateEdge[]>;
  lxxMap?: ReadonlyMap<string, Array<{ target_bs: string; count: number; sample_vids?: number[] }>>;
  interpretationEdges?: MotifInterpretationEdgeInput[];
  vidToChapter: ReadonlyMap<number, string>;
  maxMotifs?: number;
}

export interface MinedMotifsResult {
  motifs: MultiPassageMotif[];
  motifIdsByBs: Map<string, string[]>;
  motifIdsByVid: Map<number, string[]>;
}

export function mineMultiPassageMotifs(params: MineMotifsParams): MinedMotifsResult {
  const {
    profiles,
    collocMap,
    wordplayMap,
    lxxMap,
    interpretationEdges = [],
    vidToChapter,
    maxMotifs = 650,
  } = params;

  const dfByBs = new Map<string, number>();
  for (const p of profiles) dfByBs.set(p.bs, p.total_verses || 1000);

  // Undirected typed best-edge map: "A|B" -> MotifEdgeRef[]
  const edgePairMap = new Map<string, MotifEdgeRef[]>();
  const adj = new Map<string, Map<string, MotifEdgeRef>>();

  const recordEdge = (fromBs: string, toBs: string, edge: MotifEdgeRef) => {
    if (!fromBs || !toBs || fromBs === toBs) return;
    if (COLLOC_STOP_STRONGS.has(fromBs) || COLLOC_STOP_STRONGS.has(toBs)) return;
    const a = fromBs < toBs ? fromBs : toBs;
    const b = fromBs < toBs ? toBs : fromBs;
    const pk = `${a}|${b}`;
    let list = edgePairMap.get(pk);
    if (!list) { list = []; edgePairMap.set(pk, list); }
    if (!list.some(e => e.edge_type === edge.edge_type)) list.push(edge);

    for (const [u, v] of [[fromBs, toBs], [toBs, fromBs]] as const) {
      let m = adj.get(u);
      if (!m) { m = new Map(); adj.set(u, m); }
      const existing = m.get(v);
      if (!existing || edge.weight > existing.weight) {
        m.set(v, { ...edge, from_bs: u, to_bs: v });
      }
    }
  };

  if (wordplayMap) {
    for (const [bs, edges] of wordplayMap) {
      for (const wp of edges) {
        if (wp.evidence_type === 'shared_consonantal_pattern' && wp.score < 0.72) continue;
        if (wp.evidence_type === 'phonetic_similarity' && wp.proximity_same_verse === 0 && wp.proximity_adjacent_verse === 0) continue;
        const w =
          wp.evidence_type === 'attested_textual_wordplay'
            ? 1.15
            : wp.evidence_type === 'proximate_wordplay_candidate'
              ? 0.95
              : wp.proven_common_root
                ? 0.8
                : 0.65;
        recordEdge(bs, wp.target_bs, {
          from_bs: bs,
          to_bs: wp.target_bs,
          edge_type: 'wordplay',
          detail: `${wp.evidence_type}:${wp.overlap_kind}`,
          weight: w,
          witness_vids: wp.witness_vids.slice(0, 4),
        });
      }
    }
  }

  for (const [bs, edges] of collocMap) {
    for (const ce of edges.slice(0, 10)) {
      if (ce.npmi < 0.14 && ce.shared_count < 3) continue;
      recordEdge(bs, ce.target_bs, {
        from_bs: bs,
        to_bs: ce.target_bs,
        edge_type: 'collocation',
        detail: `shared_verses=${ce.shared_count},npmi=${ce.npmi}`,
        weight: Math.min(1.05, 0.35 + ce.salience * 0.45),
        witness_vids: ce.sample_vids.slice(0, 4),
      });
    }
  }

  if (lxxMap) {
    for (const [bs, list] of lxxMap) {
      for (const lx of list.slice(0, 3)) {
        if ((lx.count || 0) < 3) continue;
        recordEdge(bs, lx.target_bs, {
          from_bs: bs,
          to_bs: lx.target_bs,
          edge_type: 'lxx',
          detail: `lxx_count=${lx.count}`,
          weight: Math.min(0.95, 0.45 + Math.log2(1 + lx.count) * 0.15),
          witness_vids: (lx.sample_vids || []).slice(0, 3),
        });
      }
    }
  }

  for (const ie of interpretationEdges) {
    recordEdge(ie.from_bs, ie.to_bs, {
      from_bs: ie.from_bs,
      to_bs: ie.to_bs,
      edge_type: 'self_interpretation',
      detail: ie.cue,
      weight: 1.25,
      witness_vids: [ie.verse_id],
    });
  }

  // Cap adjacency degree per node to keep triangle/chain mining fast and high-signal
  const topNeighbors = new Map<string, MotifEdgeRef[]>();
  for (const [u, map] of adj) {
    const sorted = [...map.values()]
      .sort((x, y) => y.weight - x.weight || x.to_bs.localeCompare(y.to_bs))
      .slice(0, 22);
    topNeighbors.set(u, sorted);
  }

  const seenTri = new Set<string>();
  const rawMotifs: MultiPassageMotif[] = [];

  for (const [a, edgesA] of topNeighbors) {
    for (const eAB of edgesA) {
      const b = eAB.to_bs;
      if (a >= b) continue;
      const edgesB = topNeighbors.get(b);
      if (!edgesB) continue;
      for (const eBC of edgesB) {
        const c = eBC.to_bs;
        if (b >= c || c === a) continue;
        const eAC = adj.get(a)?.get(c);
        if (!eAC) continue;
        const triKey = `${a}|${b}|${c}`;
        if (seenTri.has(triKey)) continue;
        seenTri.add(triKey);

        const allEdges: MotifEdgeRef[] = [];
        for (const [x, y] of [[a, b], [b, c], [a, c]] as const) {
          const pk = x < y ? `${x}|${y}` : `${y}|${x}`;
          allEdges.push(...(edgePairMap.get(pk) || []));
        }

        const witnessVids = [...new Set(allEdges.flatMap(e => e.witness_vids).filter(Boolean))];
        const chapters = new Set(witnessVids.map(v => vidToChapter.get(v)).filter(Boolean));
        if (witnessVids.length < 2 || chapters.size < 2) continue;

        const edgeTypes = new Set(allEdges.map(e => e.edge_type));
        const maxDf = Math.max(dfByBs.get(a) || 100, dfByBs.get(b) || 100, dfByBs.get(c) || 100);
        const hubDenom = Math.log2(4 + maxDf * 0.03);
        const meanEdgeWeight = (eAB.weight + eBC.weight + eAC.weight) / 3;
        const modalityBonus = 1 + (edgeTypes.size - 1) * 0.35 + (edgeTypes.has('wordplay') ? 0.25 : 0) + (edgeTypes.has('self_interpretation') ? 0.3 : 0);
        const convergenceBonus = 1 + Math.min(0.6, (chapters.size - 1) * 0.18);
        const crossTest = [a, b, c].some(x => x.startsWith('H')) && [a, b, c].some(x => x.startsWith('G'));
        const score = Math.round(((meanEdgeWeight * modalityBonus * convergenceBonus) / hubDenom) * 1000) / 1000;

        rawMotifs.push({
          motif_id: `r13:motif:tri:${a}:${b}:${c}`,
          kind: 'triangle',
          nodes: [a, b, c],
          edges: allEdges.slice(0, 8),
          witness_vids: witnessVids.slice(0, 8),
          independent_chapters: chapters.size,
          distinct_edge_types: edgeTypes.size,
          cross_testament: crossTest,
          distinctiveness: score,
        });
      }
    }
  }

  rawMotifs.sort((x, y) => y.distinctiveness - x.distinctiveness || x.motif_id.localeCompare(y.motif_id));

  // Build 4-5 node extension chains anchored on top triangles & wordplay/self-interpretation seeds
  const topTriangles = rawMotifs.slice(0, Math.min(250, rawMotifs.length));
  const chainMotifs: MultiPassageMotif[] = [];
  const seenChains = new Set<string>();

  for (const tri of topTriangles) {
    if (tri.distinct_edge_types < 2 && !tri.edges.some(e => e.edge_type === 'wordplay')) continue;
    const triSet = new Set(tri.nodes);
    let bestExt: MotifEdgeRef | null = null;
    for (const u of tri.nodes) {
      for (const cand of topNeighbors.get(u) || []) {
        if (triSet.has(cand.to_bs) || COLLOC_STOP_STRONGS.has(cand.to_bs)) continue;
        if (!bestExt || cand.weight > bestExt.weight) bestExt = cand;
      }
    }
    if (!bestExt) continue;
    const nodes = [...tri.nodes, bestExt.to_bs];
    const sig = [...nodes].sort().join('|');
    if (seenChains.has(sig)) continue;
    seenChains.add(sig);

    const edges = [...tri.edges, bestExt];
    const witnessVids = [...new Set(edges.flatMap(e => e.witness_vids).filter(Boolean))].slice(0, 10);
    const chapters = new Set(witnessVids.map(v => vidToChapter.get(v)).filter(Boolean));
    if (chapters.size < 2) continue;
    const edgeTypes = new Set(edges.map(e => e.edge_type));
    const crossTest = nodes.some(x => x.startsWith('H')) && nodes.some(x => x.startsWith('G'));

    chainMotifs.push({
      motif_id: `r13:motif:chain:${nodes.join(':')}`,
      kind: 'chain',
      nodes,
      edges: edges.slice(0, 10),
      witness_vids: witnessVids,
      independent_chapters: chapters.size,
      distinct_edge_types: edgeTypes.size,
      cross_testament: crossTest,
      distinctiveness: Math.round(tri.distinctiveness * (1.08 + (crossTest ? 0.12 : 0)) * 1000) / 1000,
    });
  }

  const combined = [
    ...rawMotifs.slice(0, Math.ceil(maxMotifs * 0.65)),
    ...chainMotifs.slice(0, Math.floor(maxMotifs * 0.35)),
    ...rawMotifs.slice(Math.ceil(maxMotifs * 0.65)),
  ]
    .filter((m, idx, arr) => arr.findIndex(x => x.motif_id === m.motif_id) === idx)
    .sort((x, y) => y.distinctiveness - x.distinctiveness || x.motif_id.localeCompare(y.motif_id))
    .slice(0, maxMotifs);

  const motifIdsByBs = new Map<string, string[]>();
  const motifIdsByVid = new Map<number, string[]>();
  for (const m of combined) {
    for (const bs of m.nodes) {
      let arr = motifIdsByBs.get(bs);
      if (!arr) { arr = []; motifIdsByBs.set(bs, arr); }
      if (arr.length < 8 && !arr.includes(m.motif_id)) arr.push(m.motif_id);
    }
    for (const vid of m.witness_vids) {
      let arr = motifIdsByVid.get(vid);
      if (!arr) { arr = []; motifIdsByVid.set(vid, arr); }
      if (arr.length < 8 && !arr.includes(m.motif_id)) arr.push(m.motif_id);
    }
  }

  return { motifs: combined, motifIdsByBs, motifIdsByVid };
}

export interface RuntimeBeamProfile {
  bs: string;
  sc?: string;
  gl?: string;
  total_verses?: number;
  r13_wordplay?: Array<{
    target_bs: string;
    target_script?: string;
    evidence_type: string;
    overlap_kind: string;
    score: number;
    witness_vids?: number[];
  }>;
  r13_colloc?: Array<[string, number, number, number[]]>;
  lxx_relations?: Array<{ target_strongs: string; count?: number; script?: string; gloss?: string }>;
}

export interface BeamPathCandidate {
  nodes: string[];
  edges: MotifEdgeRef[];
  witness_vids: number[];
  score: number;
  reached_target: boolean;
}

/**
 * Bounded deterministic beam search across already-loaded profile neighborhoods
 * for unseen multi-anchor or target-directed graph exploration.
 */
export function beamSearchMotifPaths(params: {
  startBs: string;
  targetBs?: Set<string>;
  profilesByBs: ReadonlyMap<string, RuntimeBeamProfile>;
  maxHops?: number;
  beamWidth?: number;
}): BeamPathCandidate[] {
  const maxHops = Math.min(3, Math.max(1, params.maxHops ?? 3));
  const beamWidth = params.beamWidth ?? 10;

  type State = { nodes: string[]; edges: MotifEdgeRef[]; score: number; vids: number[] };
  let beam: State[] = [{ nodes: [params.startBs], edges: [], score: 1, vids: [] }];
  const completed: BeamPathCandidate[] = [];

  for (let hop = 0; hop < maxHops; hop++) {
    const nextBeam: State[] = [];
    for (const st of beam) {
      const curr = st.nodes[st.nodes.length - 1];
      const prof = params.profilesByBs.get(curr);
      if (!prof) continue;

      const stepCands: MotifEdgeRef[] = [];
      for (const wp of (prof.r13_wordplay || []).slice(0, 6)) {
        stepCands.push({
          from_bs: curr,
          to_bs: wp.target_bs,
          edge_type: 'wordplay',
          detail: `${wp.evidence_type}:${wp.overlap_kind}`,
          weight: wp.score,
          witness_vids: wp.witness_vids || [],
        });
      }
      for (const col of (prof.r13_colloc || []).slice(0, 6)) {
        stepCands.push({
          from_bs: curr,
          to_bs: col[0],
          edge_type: 'collocation',
          detail: `shared=${col[1]},npmi=${(col[2] / 100).toFixed(2)}`,
          weight: Math.min(1, 0.35 + (col[2] / 100) * 0.7),
          witness_vids: col[3] || [],
        });
      }
      for (const lx of (prof.lxx_relations || []).slice(0, 3)) {
        if ((lx.count || 0) >= 2 && lx.target_strongs) {
          stepCands.push({
            from_bs: curr,
            to_bs: lx.target_strongs,
            edge_type: 'lxx',
            detail: `lxx_count=${lx.count}`,
            weight: Math.min(0.95, 0.45 + Math.log2(1 + (lx.count || 1)) * 0.14),
            witness_vids: [],
          });
        }
      }

      for (const edge of stepCands) {
        if (st.nodes.includes(edge.to_bs)) continue;
        const nodes = [...st.nodes, edge.to_bs];
        const edges = [...st.edges, edge];
        const vids = [...new Set([...st.vids, ...edge.witness_vids])];
        const types = new Set(edges.map(e => e.edge_type)).size;
        const nextScore = st.score * (0.68 + edge.weight * 0.42) * (1 + (types - 1) * 0.12);

        const hitTarget = Boolean(params.targetBs?.has(edge.to_bs));
        if (hitTarget || (nodes.length >= 3 && types >= 2 && vids.length >= 2)) {
          completed.push({
            nodes,
            edges,
            witness_vids: vids.slice(0, 8),
            score: Math.round((hitTarget ? nextScore * 1.45 : nextScore) * 1000) / 1000,
            reached_target: hitTarget,
          });
        }
        if (!hitTarget && hop + 1 < maxHops) {
          nextBeam.push({ nodes, edges, score: nextScore, vids });
        }
      }
    }
    nextBeam.sort((a, b) => b.score - a.score);
    beam = nextBeam.slice(0, beamWidth);
    if (beam.length === 0) break;
  }

  return completed.sort((a, b) => Number(b.reached_target) - Number(a.reached_target) || b.score - a.score).slice(0, 12);
}
