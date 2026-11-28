// @file: src/relationships/v4-epistemic-algebra.ts
// BibleResearch v4 Formal Epistemic Path Composition Algebra & Layer 2 <-> Layer 3 Projection.
// Enforces transitivity boundaries, sense-identity continuity, witness-independence deduplication,
// and deterministic algorithm_evidence_id / rg_projection mapping without reading rg_* during Layer 2 ranking.
// Pure TypeScript; zero Node-only imports.

export type EdgeTransitivityClass = 'strict' | 'gated' | 'non_transitive';

export type PathEpistemicGrade =
  | 'VERIFIED_TEXTUAL_CHAIN'
  | 'STRUCTURAL_OR_ANALOGICAL_BRIDGE'
  | 'EXPLORATORY_NON_TRANSITIVE_CHAIN';

export interface EpistemicPathEdge {
  fromNode: string;
  toNode: string;
  edgeKind: string; // e.g. 'EXPLICIT_INTERP', 'LXX', 'OCC', 'LEX_SYN', 'verified_xref', 'STRUCT_ANALOGY', 'WP', 'CONCEPT_PROC', 'editorial_xref', 'RG:part_of', 'RG:analogous_to', etc.
  esideClass?: string; // C1..C8
  sourceVid?: number;
  targetVid?: number;
  edgeFamily?: string;
  senseIdIn?: string | null;
  senseIdOut?: string | null;
  monosemeIn?: boolean;
  monosemeOut?: boolean;
  passageCoherent?: boolean; // same verse/pericope or K_step >= 0.65
  lxxStability?: number;
  originLayer?: 'layer2' | 'layer3';
  weight?: number;
}

export interface ComposedPathResult {
  validForProofOrDiscovery: boolean;
  grade: PathEpistemicGrade;
  nonTransitiveCount: number;
  senseDiscontinuous: boolean;
  passageIncoherent: boolean;
  distinctWitnessCount: number;
  duplicateWitnessCount: number;
  sharedUpstreamWarnings: string[];
  boundaryNote: string;
  marginalWeights: number[];
}

export interface RgClaimParticipantProjection {
  role:
    | 'agent'
    | 'patient'
    | 'instrument'
    | 'source'
    | 'destination'
    | 'condition'
    | 'outcome'
    | 'slot_a'
    | 'slot_b'
    | 'unmatched';
  entity_ref: string;
  strongs?: string;
  label?: string;
}

export interface RgProjectionPayload {
  algorithm_evidence_id: string;
  evidence_kind: 'algorithm_edge';
  epistemic_class: string;
  title: string;
  summary: string;
  participants: RgClaimParticipantProjection[];
  witness_vids: number[];
}

const STRICT_EDGE_KINDS = new Set([
  'EXPLICIT_INTERP',
  'C1', 'C2', 'C4', 'C5', 'C7',
  'RG:part_of', 'RG:contains', 'RG:precedes', 'RG:cites', 'RG:interprets',
]);

const GATED_EDGE_KINDS = new Set([
  'OCC',
  'LEX_SYN',
  'verified_xref',
  'XREF_VERIFIED',
  'GRAM',
  'ROOT',
]);

const NON_TRANSITIVE_EDGE_KINDS = new Set([
  'STRUCT_ANALOGY',
  'SME',
  'WP',
  'CONCEPT_PROC',
  'editorial_xref',
  'XREF_EDITORIAL',
  'C3',
  'C8',
  'RG:analogous_to',
  'RG:alludes_to',
  'RG:hypothesized_to_express',
]);

export function classifyEdgeTransitivity(edge: EpistemicPathEdge): EdgeTransitivityClass {
  const kind = String(edge.edgeKind || '').trim();
  if (STRICT_EDGE_KINDS.has(kind)) return 'strict';
  if (kind === 'LXX') {
    if (edge.lxxStability === undefined || edge.lxxStability >= 0.18) return 'strict';
    return 'gated';
  }
  if (GATED_EDGE_KINDS.has(kind)) return 'gated';
  if (NON_TRANSITIVE_EDGE_KINDS.has(kind)) return 'non_transitive';
  if (kind.startsWith('RG:')) return 'non_transitive';
  return 'non_transitive';
}

function areSensesContinuous(prevEdge: EpistemicPathEdge, nextEdge: EpistemicPathEdge): boolean {
  const outSense = prevEdge.senseIdOut;
  const inSense = nextEdge.senseIdIn;
  if (outSense && inSense) {
    return outSense === inSense;
  }
  // Allow if both endpoints are explicitly marked unambiguous monosemes or same explicit sense absent on non-lexical nodes
  if (prevEdge.monosemeOut && nextEdge.monosemeIn) return true;
  // If one side specifies a distinct sense (e.g. H3722:pitch) and the next specifies a different sense (e.g. H3722:atone), block!
  if ((outSense && !inSense && !nextEdge.monosemeIn) || (!outSense && inSense && !prevEdge.monosemeOut)) {
    return true; // Allow when only one side carries an annotation and the other is unannotated verse/structural node
  }
  return true;
}

/**
 * Deterministic Path Composition Operator over any multi-hop path pi = (e_1..e_k).
 * Applies identically to Layer 2 CSR/Steiner paths AND Layer 2+3 combined KG paths.
 */
export function composePathEpistemicState(edges: EpistemicPathEdge[]): ComposedPathResult {
  if (edges.length === 0) {
    return {
      validForProofOrDiscovery: false,
      grade: 'EXPLORATORY_NON_TRANSITIVE_CHAIN',
      nonTransitiveCount: 0,
      senseDiscontinuous: false,
      passageIncoherent: false,
      distinctWitnessCount: 0,
      duplicateWitnessCount: 0,
      sharedUpstreamWarnings: [],
      boundaryNote: 'Empty path.',
      marginalWeights: [],
    };
  }

  let nonTransitiveCount = 0;
  let senseDiscontinuous = false;
  let passageIncoherent = false;
  const seenWitnesses = new Set<string>();
  let distinctWitnessCount = 0;
  let duplicateWitnessCount = 0;
  const sharedUpstreamWarnings: string[] = [];
  const marginalWeights: number[] = [];

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const cls = classifyEdgeTransitivity(e);

    if (cls === 'non_transitive') {
      nonTransitiveCount++;
    } else if (cls === 'gated') {
      if (e.passageCoherent === false) {
        passageIncoherent = true;
      }
    }

    if (i > 0) {
      const prev = edges[i - 1];
      if (!areSensesContinuous(prev, e)) {
        senseDiscontinuous = true;
        sharedUpstreamWarnings.push(
          `Sense discontinuity at ${e.fromNode}: ${prev.senseIdOut || '?'} != ${e.senseIdIn || '?'}.`,
        );
      }
    }

    // Witness-independence deduplication: (source_vid, edge_family)
    const fam = e.edgeFamily || e.edgeKind;
    const witKey = e.sourceVid ? `${e.sourceVid}:${fam}` : '';
    let marginal = e.weight ?? 1;
    if (witKey) {
      if (seenWitnesses.has(witKey)) {
        marginal = 0;
        duplicateWitnessCount++;
        sharedUpstreamWarnings.push(`Duplicate primary witness (${witKey}) contributes 0 marginal evidence.`);
      } else {
        seenWitnesses.add(witKey);
        distinctWitnessCount++;
      }
    } else {
      distinctWitnessCount++;
    }
    marginalWeights.push(marginal);
  }

  let grade: PathEpistemicGrade;
  let validForProofOrDiscovery = true;
  let boundaryNote = 'All hops are strict or sense-continuous textual/lexical relations.';

  if (senseDiscontinuous || passageIncoherent || nonTransitiveCount >= 2) {
    grade = 'EXPLORATORY_NON_TRANSITIVE_CHAIN';
    validForProofOrDiscovery = false;
    boundaryNote = senseDiscontinuous
      ? 'Pruned from verified paths due to sense-identity discontinuity across a homograph.'
      : passageIncoherent
        ? 'Pruned from verified paths due to passage-incoherent intermediate jump.'
        : `Non-transitive chaining limit exceeded (${nonTransitiveCount} non-transitive hops); exploratory lead only.`;
  } else if (nonTransitiveCount === 0) {
    grade = 'VERIFIED_TEXTUAL_CHAIN';
  } else {
    grade = 'STRUCTURAL_OR_ANALOGICAL_BRIDGE';
    const ntEdge = edges.find(ed => classifyEdgeTransitivity(ed) === 'non_transitive');
    boundaryNote = `Crosses 1 non-transitive structural/analogical boundary (${ntEdge?.edgeKind || 'bridge'}); do not treat analogy as identity.`;
  }

  return {
    validForProofOrDiscovery,
    grade,
    nonTransitiveCount,
    senseDiscontinuous,
    passageIncoherent,
    distinctWitnessCount,
    duplicateWitnessCount,
    sharedUpstreamWarnings,
    boundaryNote,
    marginalWeights,
  };
}

export function filterEpistemicPaths<T extends { edges: EpistemicPathEdge[] }>(
  paths: T[],
  includeExploratory = false,
): Array<T & { epistemic: ComposedPathResult }> {
  const out: Array<T & { epistemic: ComposedPathResult }> = [];
  for (const p of paths) {
    const epistemic = composePathEpistemicState(p.edges);
    if (!epistemic.validForProofOrDiscovery && !includeExploratory) continue;
    out.push({ ...p, epistemic });
  }
  return out;
}

export function makeEsideEvidenceId(vid: number, idx: number): string {
  return `v4:eside:${vid}:${idx}`;
}

export function makeSmeEvidenceId(perA: number, perB: number, mode: 'CONCORDANT' | 'INVERSION'): string {
  return `v4:sme:${perA}:${perB}:${mode}`;
}

export function makeSpliceEvidenceId(ntVid: number): string {
  return `v4:splice:${ntVid}`;
}

/** Map normalized HREG ArgRole to Layer 3 rg_claim_participants role enum. */
export function mapArgRoleToRgParticipantRole(
  role: string,
): RgClaimParticipantProjection['role'] {
  switch (role.toUpperCase()) {
    case 'AGENT': return 'agent';
    case 'PATIENT':
    case 'THEME_2': return 'patient';
    case 'INSTRUMENT': return 'instrument';
    case 'SOURCE': return 'source';
    case 'RECIPIENT':
    case 'GOAL_LOC': return 'destination';
    case 'CONDITION': return 'condition';
    case 'OUTCOME':
    case 'RESULT': return 'outcome';
    default: return 'slot_a';
  }
}
