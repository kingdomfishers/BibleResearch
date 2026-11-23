// @file: src/relationships/evidence-synthesis.ts
// Algorithms D & E: Cross-testament rare-lexical / many-to-many LXX alignment
// and multi-step evidence synthesis with explicit vs exploratory separation.
// Pure TypeScript compatible with browser/Worker bundles and Node strip-types.

export type CrossTestamentEvidenceKind =
  | 'explicit_nt_quotation'
  | 'strong_lxx_verbal_echo'
  | 'shared_rare_artifact_motif'
  | 'editorial_cross_reference';

export interface CrossTestamentMatchItem {
  source_vid: number;
  target_vid: number;
  source_ref: string;
  target_ref: string;
  kind: CrossTestamentEvidenceKind;
  direction: 'ot_to_nt' | 'nt_interprets_ot' | 'lxx_verbal_bridge';
  aligned_pairs: Array<{
    ot_bs: string;
    nt_bs: string;
    ot_script?: string;
    nt_script?: string;
    ot_gloss?: string;
    nt_gloss?: string;
    idf: number;
    lxx_count: number;
  }>;
  bipartite_idf_sum: number;
  score: number;
  provenance_note: string;
}

export function scoreCrossTestamentPair(params: {
  sourceVid: number;
  targetVid: number;
  sourceRef: string;
  targetRef: string;
  otTokens: Array<{ bs: string; script?: string; gloss?: string; idf: number }>;
  ntTokens: Array<{ bs: string; script?: string; gloss?: string; idf: number }>;
  lxxEquivMap: ReadonlyMap<string, Array<{ target_bs: string; count: number }>>;
  hasExplicitQuotation?: boolean;
  isReciprocalXref?: boolean;
}): CrossTestamentMatchItem | null {
  const {
    sourceVid,
    targetVid,
    sourceRef,
    targetRef,
    otTokens,
    ntTokens,
    lxxEquivMap,
    hasExplicitQuotation = false,
    isReciprocalXref = false,
  } = params;

  const ntByBs = new Map<string, { bs: string; script?: string; gloss?: string; idf: number }>();
  for (const t of ntTokens) {
    if (!ntByBs.has(t.bs)) ntByBs.set(t.bs, t);
  }

  // Greedy maximum-weight bipartite alignment across OT lemma -> LXX Greek -> NT lemma (many-to-many allowed when rare)
  const candPairs: CrossTestamentMatchItem['aligned_pairs'] = [];
  const usedOt = new Set<string>();
  const usedNt = new Set<string>();

  const allScored: Array<{
    ot: { bs: string; script?: string; gloss?: string; idf: number };
    nt: { bs: string; script?: string; gloss?: string; idf: number };
    pairIdf: number;
    lxxCount: number;
  }> = [];

  for (const ot of otTokens) {
    for (const lx of lxxEquivMap.get(ot.bs) || []) {
      const nt = ntByBs.get(lx.target_bs);
      if (!nt) continue;
      const pairIdf = (ot.idf + nt.idf) * 0.5;
      allScored.push({ ot, nt, pairIdf, lxxCount: lx.count });
    }
  }

  allScored.sort((a, b) => b.pairIdf - a.pairIdf || b.lxxCount - a.lxxCount);
  for (const item of allScored) {
    if (usedOt.has(item.ot.bs) && usedNt.has(item.nt.bs)) continue;
    usedOt.add(item.ot.bs);
    usedNt.add(item.nt.bs);
    candPairs.push({
      ot_bs: item.ot.bs,
      nt_bs: item.nt.bs,
      ...(item.ot.script ? { ot_script: item.ot.script } : {}),
      ...(item.nt.script ? { nt_script: item.nt.script } : {}),
      ...(item.ot.gloss ? { ot_gloss: item.ot.gloss } : {}),
      ...(item.nt.gloss ? { nt_gloss: item.nt.gloss } : {}),
      idf: Math.round(item.pairIdf * 100) / 100,
      lxx_count: item.lxxCount,
    });
    if (candPairs.length >= 6) break;
  }

  const bipartiteIdfSum = Math.round(candPairs.reduce((s, p) => s + p.idf, 0) * 100) / 100;
  if (!hasExplicitQuotation && candPairs.length === 0) return null;
  if (!hasExplicitQuotation && candPairs.length === 1 && candPairs[0].idf < 2.8) return null;

  let kind: CrossTestamentEvidenceKind = 'editorial_cross_reference';
  let direction: CrossTestamentMatchItem['direction'] = 'lxx_verbal_bridge';
  if (hasExplicitQuotation) {
    kind = 'explicit_nt_quotation';
    direction = sourceVid > 23213 ? 'nt_interprets_ot' : 'ot_to_nt';
  } else if (candPairs.length >= 2 && bipartiteIdfSum >= 4.2) {
    kind = 'strong_lxx_verbal_echo';
    direction = 'lxx_verbal_bridge';
  } else if (candPairs.length >= 1 && candPairs[0].idf >= 2.8) {
    kind = 'shared_rare_artifact_motif';
    direction = 'lxx_verbal_bridge';
  }

  const base =
    kind === 'explicit_nt_quotation'
      ? 920
      : kind === 'strong_lxx_verbal_echo'
        ? 820
        : kind === 'shared_rare_artifact_motif'
          ? 760
          : 660;
  const score = Math.round(
    base +
      Math.min(180, bipartiteIdfSum * 18) +
      (isReciprocalXref ? 45 : 0) +
      Math.min(60, candPairs.length * 15),
  );

  return {
    source_vid: sourceVid,
    target_vid: targetVid,
    source_ref: sourceRef,
    target_ref: targetRef,
    kind,
    direction,
    aligned_pairs: candPairs,
    bipartite_idf_sum: bipartiteIdfSum,
    score,
    provenance_note:
      kind === 'explicit_nt_quotation'
        ? 'Explicit NT quotation/typological reference paired with OT source alignment.'
        : 'Hebrew-LXX-NT rare lexical bipartite alignment; preserves directionality without claiming single-source dependence where editorial xrefs are absent.',
  };
}

export type SynthesizedPatternType =
  | 'multi_passage_motif'
  | 'wordplay_cluster'
  | 'symbolic_chain'
  | 'cross_testament_correspondence'
  | 'structural_parallel';

export interface SynthesisEdgeInput {
  evidence_id: string;
  evidence_type: string;
  epistemic_class: string;
  tier: number;
  from_node: string;
  to_node: string;
  witness_refs: string[];
  summary: string;
  score: number;
  limitation?: string;
}

export interface SynthesisNodeInfo {
  id: string;
  label: string;
  script?: string;
  transliteration?: string;
  gloss?: string;
}

export interface SynthesizedPattern {
  pattern_id: string;
  pattern_type: SynthesizedPatternType;
  title: string;
  summary: string;
  nodes: SynthesisNodeInfo[];
  edges: SynthesisEdgeInput[];
  anchor_coverage: string[];
  independent_witness_count: number;
  witness_refs: string[];
  explicit_vs_inferred: {
    explicit_textual_facts: string[];
    structural_correspondences: string[];
    exploratory_hypotheses: string[];
  };
  counterexamples_and_limits: string[];
  next_research_directions: string[];
  distinctiveness_score: number;
}

function classifyPatternType(edges: SynthesisEdgeInput[]): SynthesizedPatternType {
  const types = new Set(edges.map(e => e.evidence_type));
  if (types.has('explicit_biblical_interpretation') || types.has('symbolic_chain')) {
    return 'symbolic_chain';
  }
  if (edges.filter(e => e.evidence_type.includes('wordplay') || e.evidence_type.includes('consonantal') || e.evidence_type.includes('root')).length >= Math.max(1, Math.ceil(edges.length / 2))) {
    return 'wordplay_cluster';
  }
  if (types.has('strong_lxx_verbal_echo') || types.has('explicit_nt_quotation') || types.has('cross_language_lxx_bridge')) {
    return 'cross_testament_correspondence';
  }
  if (types.has('structural_scene_parallel')) {
    return 'structural_parallel';
  }
  return 'multi_passage_motif';
}

/**
 * Algorithm E: Group reinforcing typed edges into coherent multi-passage discovery patterns
 * with independently inspectable steps, explicit vs inferred stratification, counterexamples,
 * and suggested next research moves.
 */
export function synthesizeEvidencePatterns(params: {
  anchors: string[];
  edges: SynthesisEdgeInput[];
  nodeCatalog?: ReadonlyMap<string, SynthesisNodeInfo>;
  maxPatterns?: number;
}): SynthesizedPattern[] {
  const { anchors, edges, nodeCatalog, maxPatterns = 8 } = params;
  if (edges.length === 0) return [];

  // Connected-component clustering over shared nodes + shared witness passages (excluding weak high-degree bridges)
  const adjNodes = new Map<string, SynthesisEdgeInput[]>();
  for (const e of edges) {
    if (!e.from_node || !e.to_node) continue;
    for (const k of [e.from_node, e.to_node]) {
      let arr = adjNodes.get(k);
      if (!arr) { arr = []; adjNodes.set(k, arr); }
      arr.push(e);
    }
  }

  const visitedEdge = new Set<string>();
  const clusters: SynthesisEdgeInput[][] = [];

  const sortedEdges = [...edges].sort((a, b) => a.tier - b.tier || b.score - a.score);
  for (const seed of sortedEdges) {
    if (visitedEdge.has(seed.evidence_id)) continue;
    const comp: SynthesisEdgeInput[] = [];
    const queue = [seed.from_node, seed.to_node];
    const seenNodes = new Set<string>(queue);

    while (queue.length > 0 && comp.length < 10) {
      const curr = queue.shift()!;
      for (const e of adjNodes.get(curr) || []) {
        if (visitedEdge.has(e.evidence_id)) continue;
        visitedEdge.add(e.evidence_id);
        comp.push(e);
        for (const nxt of [e.from_node, e.to_node]) {
          if (!seenNodes.has(nxt) && seenNodes.size < 8) {
            seenNodes.add(nxt);
            queue.push(nxt);
          }
        }
        if (comp.length >= 10) break;
      }
    }
    if (comp.length > 0) clusters.push(comp);
  }

  const anchorLower = anchors.map(a => a.trim().toLowerCase()).filter(Boolean);
  const patterns: SynthesizedPattern[] = [];

  for (let idx = 0; idx < clusters.length; idx++) {
    const comp = clusters[idx];
    const nodeIds = [...new Set(comp.flatMap(e => [e.from_node, e.to_node]))];
    const nodes: SynthesisNodeInfo[] = nodeIds.map(id => {
      const meta = nodeCatalog?.get(id);
      return meta ?? { id, label: id };
    });

    const witnessRefs = [...new Set(comp.flatMap(e => e.witness_refs).filter(Boolean))];
    const distinctBooks = new Set(witnessRefs.map(r => r.split(/\s+\d/)[0]).filter(Boolean));
    const distinctTypes = new Set(comp.map(e => e.evidence_type));

    const explicitFacts: string[] = [];
    const structuralCorr: string[] = [];
    const exploratoryHyp: string[] = [];
    const limits = new Set<string>();

    for (const e of comp) {
      if (e.limitation) limits.add(e.limitation);
      if (
        e.epistemic_class === 'direct_textual_evidence' ||
        e.epistemic_class === 'authorial_typology_or_quote' ||
        e.evidence_type === 'attested_textual_wordplay' ||
        e.evidence_type === 'explicit_biblical_interpretation'
      ) {
        explicitFacts.push(`[${e.evidence_id}] ${e.summary}`);
      } else if (
        e.epistemic_class === 'documented_lexical_relationship' ||
        e.epistemic_class === 'documented_collocation_or_cooccurrence' ||
        e.epistemic_class === 'documented_cross_language_bridge' ||
        e.epistemic_class === 'shared_motif_evidence'
      ) {
        structuralCorr.push(`[${e.evidence_id}] ${e.summary}`);
      } else {
        exploratoryHyp.push(`[${e.evidence_id}] ${e.summary}`);
      }
    }

    if (comp.some(e => e.epistemic_class === 'orthographic_similarity_only')) {
      limits.add('Contains formal/consonantal overlaps that do not prove shared lexical etymology without documented STEP roots.');
    }
    if (comp.some(e => e.epistemic_class === 'editorial_cross_reference')) {
      limits.add('Includes editorial cross-references requiring direct original-language verification before inferring authorial dependence.');
    }

    const coveredAnchors = anchors.filter((_a, aIdx) => {
      const al = anchorLower[aIdx];
      return (
        nodeIds.some(n => n.toLowerCase().includes(al) || (nodeCatalog?.get(n)?.gloss || '').toLowerCase().includes(al)) ||
        witnessRefs.some(r => r.toLowerCase().includes(al)) ||
        comp.some(e => e.summary.toLowerCase().includes(al))
      );
    });

    const pType = classifyPatternType(comp);
    const meanScore = comp.reduce((s, e) => s + e.score, 0) / comp.length;
    const convergenceMultiplier = 1 + Math.min(0.45, distinctTypes.size * 0.12) + Math.min(0.4, distinctBooks.size * 0.08);
    const anchorBoost = 1 + coveredAnchors.length * 0.18;
    const distinctiveness = Math.round(meanScore * convergenceMultiplier * anchorBoost);

    const nextDirs: string[] = [];
    for (const ref of witnessRefs.slice(0, 2)) {
      nextDirs.push(`Inspect full original-language syntax & context of ${ref} via get_Passage`);
    }
    for (const e of comp.slice(0, 2)) {
      nextDirs.push(`Verify step tokens and limitations via research(op="evidence", evidence_id="${e.evidence_id}")`);
    }

    const leadLabels = nodes.slice(0, 4).map(n => n.label || n.id).join(' ↔ ');
    patterns.push({
      pattern_id: `r13:pattern:${idx + 1}:${nodeIds.slice(0, 3).join('_')}`,
      pattern_type: pType,
      title: `${pType.replace(/_/g, ' ')}: ${leadLabels}`,
      summary: `Network of ${comp.length} typed link(s) across ${witnessRefs.length} witness passage(s) in ${distinctBooks.size} book(s) (${[...distinctTypes].slice(0, 3).join(', ')}).`,
      nodes,
      edges: comp,
      anchor_coverage: coveredAnchors,
      independent_witness_count: Math.max(distinctBooks.size, witnessRefs.length),
      witness_refs: witnessRefs.slice(0, 10),
      explicit_vs_inferred: {
        explicit_textual_facts: explicitFacts.slice(0, 6),
        structural_correspondences: structuralCorr.slice(0, 6),
        exploratory_hypotheses: exploratoryHyp.slice(0, 6),
      },
      counterexamples_and_limits: [...limits].slice(0, 5),
      next_research_directions: [...new Set(nextDirs)].slice(0, 4),
      distinctiveness_score: distinctiveness,
    });
  }

  return patterns
    .sort((a, b) => b.anchor_coverage.length - a.anchor_coverage.length || b.distinctiveness_score - a.distinctiveness_score)
    .slice(0, maxPatterns);
}
