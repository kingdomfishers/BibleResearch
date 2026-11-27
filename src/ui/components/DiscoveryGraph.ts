// @file: src/ui/components/DiscoveryGraph.ts
// @feature: discovery-graph
// @tables: none
// @candidates: none
// @toc: imports | types | logic:epistemic | logic:cache | logic:graph-model | logic:layout | ui:main

// === @section:imports ===
import '../styles-discovery-graph.css';
import {
  discoverBiblicalConnectionsRpc,
  discoverSubgraphRpc,
  expandBiblicalConnectionRpc,
  getConnectionEvidenceRpc,
} from '../../api/r10-rpc';
import { BibleRPC } from '../../api/rpc';
import type {
  RgNeighborhoodEdge,
  RgNeighborhoodResponse,
  RgTraceResponse,
} from '../../api/research-graph-types';
import type { ClaimComposerPrefill } from './ClaimComposerDialog';
import type { ActivePassage } from '../../api/types';
import type {
  ConnectionEvidenceResult,
  DiscoverConnectionsResult,
  R10ClusterBridge,
  R10ConnectionPath,
  R10ConnectionSummary,
  R10ControlOrWarning,
  R10EpistemicClass,
  R10EvidenceTier,
  R10PassageRef,
  R10Predicate,
  V3ScoreMeta,
} from '../../relationships/r10-types';
import type { SubgraphEdge, SubgraphNode } from '../../relationships/subgraph-engine';
import type { DragAnchorPayload } from '../drag-controller';
import {
  explorationState,
  type Anchor,
  type ConnectionEdge,
  type UserHypothesis,
} from '../exploration-state';
import { action, el, status } from '../study-dom';
import { formatVerseRef, parseAnchorPassage } from '../utils';
import type { ContextPreview } from './ContextPreview';

// === @section:types ===
export type GraphLayerMode = 'algorithmic' | 'research' | 'combined';

export interface DiscoveryGraphCallbacks {
  preview: ContextPreview;
  onFollowPassage: (p: ActivePassage, edge: ConnectionEdge) => void;
  onComparePassage: (target: ActivePassage) => void;
  onCreateHypothesis: (from: Anchor, to?: Anchor) => void;
  onInspectWord?: (wordId: number) => void;
  onOpenClaimComposer?: (prefill: ClaimComposerPrefill) => void;
  onRefreshResearchGraph?: () => void;
}

export interface DiscoveryGraphOptions {
  variant?: 'full' | 'compact';
  defaultOpen?: boolean;
  onRegisterDrag?: (target: HTMLElement, getPayload: () => DragAnchorPayload) => () => void;
  onExpandFull?: (query: string, passage: ActivePassage, label?: string) => void;
}

export interface DiscoveryGraphOpenOptions {
  initialFilter?: LayerFilterId;
  layerMode?: GraphLayerMode;
  preserveSelection?: {
    nodeId?: string | null;
    edgeId?: string | null;
  };
  seedResult?: DiscoverConnectionsResult | null;
}

export interface DiscoveryGraphHandle {
  element: HTMLElement;
  openForAnchor: (
    query: string,
    passage: ActivePassage,
    label?: string,
    openOptions?: DiscoveryGraphOpenOptions
  ) => void;
  toggle: (passage: ActivePassage) => void;
  isOpen: () => boolean;
  close: () => void;
  expand: () => void;
  reload?: () => void;
  destroy?: () => void;
}

interface SvgLayoutSpec {
  viewBoxW: number;
  viewBoxH: number;
  centerX: number;
  centerY: number;
  rx: number;
  ry: number;
  secondaryRx: number;
  secondaryRy: number;
  pillW: number;
  pillH: number;
  pillRx: number;
  centerW: number;
  centerH: number;
  centerRx: number;
  padX: number;
  padY: number;
  labelMaxChars: number;
  subMaxChars: number;
  centerMaxChars: number;
}

type LayerFilterId =
  | 'all'
  | 'textual'
  | 'lexical'
  | 'lxx'
  | 'xref'
  | 'motif'
  | 'candidate'
  | 'hypothesis'
  | 'rg_human'
  | 'rg_ai';

interface CenterState {
  query: string;
  passage: ActivePassage;
  label: string;
  anchor: Anchor;
}

interface GraphNode {
  id: string;
  label: string;
  shortLabel: string;
  originalLabel?: string;
  originalShortLabel?: string;
  epistemicClass: R10EpistemicClass;
  evidenceTier: R10EvidenceTier;
  why: string;
  passage: ActivePassage | null;
  supportingPassages: R10PassageRef[];
  rpcNodeId: string;
  expandQuery: string;
  parentNodeId: string;
  isHypothesis: boolean;
  isBridgeNode?: boolean;
  rgAuthorKind?: 'human' | 'ai';
  rgNodeKey?: string;
  rgNodeKind?: string;
  csrPartition?: string;
  v3Score?: V3ScoreMeta;
  expanded: boolean;
  anchor: Anchor;
  conn?: R10ConnectionSummary;
}

interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  fromLabel: string;
  toLabel: string;
  relationLabel: string;
  predicate: R10Predicate | 'user_hypothesis';
  epistemicClass: R10EpistemicClass;
  weakestEpistemicClass: R10EpistemicClass;
  evidenceTier: R10EvidenceTier;
  layers: Set<Exclude<LayerFilterId, 'all'>>;
  why: string;
  isDashed: boolean;
  isMultihop: boolean;
  csrPartition?: string;
  v3Score?: V3ScoreMeta;
  evidenceId?: string;
  sourceRelease?: string;
  conn?: R10ConnectionSummary;
  path?: R10ConnectionPath;
  hypothesis?: UserHypothesis;
  rgClaim?: RgNeighborhoodEdge;
}

interface PositionedNode {
  node: GraphNode;
  x: number;
  y: number;
}

interface BridgeSearchState {
  targetInput: string;
  loading: boolean;
  error: string | null;
  empty: boolean;
  summary: string | null;
}

interface ChallengeState {
  loading: boolean;
  error: string | null;
  explanation: string | null;
  controls: R10ControlOrWarning[];
}

// === @section:logic:epistemic ===
const SVG_NS = 'http://www.w3.org/2000/svg';
const CENTER_NODE_ID = '__center__';

const FULL_SVG_LAYOUT: SvgLayoutSpec = {
  viewBoxW: 640,
  viewBoxH: 344,
  centerX: 320,
  centerY: 172,
  rx: 218,
  ry: 118,
  secondaryRx: 244,
  secondaryRy: 136,
  pillW: 126,
  pillH: 38,
  pillRx: 9,
  centerW: 138,
  centerH: 44,
  centerRx: 11,
  padX: 72,
  padY: 26,
  labelMaxChars: 18,
  subMaxChars: 19,
  centerMaxChars: 19,
};

const COMPACT_SVG_LAYOUT: SvgLayoutSpec = {
  viewBoxW: 444,
  viewBoxH: 268,
  centerX: 222,
  centerY: 134,
  rx: 146,
  ry: 86,
  secondaryRx: 162,
  secondaryRy: 104,
  pillW: 108,
  pillH: 34,
  pillRx: 8,
  centerW: 118,
  centerH: 38,
  centerRx: 9,
  padX: 62,
  padY: 24,
  labelMaxChars: 15,
  subMaxChars: 16,
  centerMaxChars: 16,
};

const LAYER_FILTERS: Array<{ id: LayerFilterId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'textual', label: 'Textual' },
  { id: 'lexical', label: 'Lexical' },
  { id: 'lxx', label: 'LXX' },
  { id: 'xref', label: 'Cross-ref' },
  { id: 'motif', label: 'Motif' },
  { id: 'candidate', label: 'Candidate' },
  { id: 'hypothesis', label: 'My hypotheses' },
  { id: 'rg_human', label: 'Human research' },
  { id: 'rg_ai', label: 'AI research' },
];

const EPISTEMIC_LABELS: Record<R10EpistemicClass, string> = {
  direct_textual_evidence: 'Direct textual',
  authorial_typology_or_quote: 'Authorial quote/typology',
  documented_lexical_relationship: 'Lexical',
  documented_collocation_or_cooccurrence: 'Co-occurrence',
  documented_cross_language_bridge: 'LXX bridge',
  verified_cross_reference: 'Cross-ref',
  editorial_cross_reference: 'Editorial cross-ref',
  shared_motif_evidence: 'Shared motif',
  candidate_literary_pattern: 'Candidate pattern',
  orthographic_similarity_only: 'Orthographic similarity',
  external_world_bridge: 'External bridge',
  interpretive_hypothesis: 'Interpretive hypothesis',
  user_note: 'My hypothesis',
};

const EPISTEMIC_STRENGTH_RANK: Record<R10EpistemicClass, number> = {
  direct_textual_evidence: 1,
  authorial_typology_or_quote: 2,
  documented_lexical_relationship: 3,
  documented_cross_language_bridge: 4,
  verified_cross_reference: 5,
  documented_collocation_or_cooccurrence: 6,
  editorial_cross_reference: 7,
  shared_motif_evidence: 8,
  candidate_literary_pattern: 9,
  orthographic_similarity_only: 10,
  external_world_bridge: 11,
  interpretive_hypothesis: 12,
  user_note: 13,
};

const CAUTION_CLASSES = new Set<R10EpistemicClass>([
  'candidate_literary_pattern',
  'orthographic_similarity_only',
  'external_world_bridge',
  'interpretive_hypothesis',
  'user_note',
]);

function epistemicLabel(cls: R10EpistemicClass): string {
  return EPISTEMIC_LABELS[cls] ?? cls;
}

function isCautionClass(cls: R10EpistemicClass, tier: R10EvidenceTier): boolean {
  return tier >= 5 || CAUTION_CLASSES.has(cls);
}

function weakestEpistemic(classes: R10EpistemicClass[]): R10EpistemicClass {
  let weakest = classes[0] ?? 'interpretive_hypothesis';
  let maxRank = EPISTEMIC_STRENGTH_RANK[weakest] ?? 0;
  for (const cls of classes) {
    const rank = EPISTEMIC_STRENGTH_RANK[cls] ?? 0;
    if (rank > maxRank) {
      maxRank = rank;
      weakest = cls;
    }
  }
  return weakest;
}

function classifyConnectionLayers(
  epistemic: R10EpistemicClass,
  predicate: R10Predicate | 'user_hypothesis',
  tier: R10EvidenceTier
): Set<Exclude<LayerFilterId, 'all'>> {
  const layers = new Set<Exclude<LayerFilterId, 'all'>>();
  if (epistemic === 'user_note' || predicate === 'user_hypothesis') {
    layers.add('hypothesis');
    return layers;
  }
  if (
    epistemic === 'direct_textual_evidence' ||
    epistemic === 'authorial_typology_or_quote' ||
    predicate === 'explicit_identification' ||
    predicate === 'explicit_comparison' ||
    predicate === 'typological_interpretation' ||
    predicate === 'direct_quotation' ||
    predicate === 'authorial_interpretation'
  ) {
    layers.add('textual');
  }
  if (
    epistemic === 'documented_cross_language_bridge' ||
    predicate === 'cross_language_bridge'
  ) {
    layers.add('lxx');
  }
  if (
    epistemic === 'documented_lexical_relationship' ||
    epistemic === 'documented_collocation_or_cooccurrence' ||
    predicate === 'verified_lexical_grammatical' ||
    predicate === 'numbered_entity'
  ) {
    layers.add('lexical');
  }
  if (
    epistemic === 'verified_cross_reference' ||
    epistemic === 'editorial_cross_reference' ||
    predicate === 'cross_reference_witness'
  ) {
    layers.add('xref');
  }
  if (
    epistemic === 'shared_motif_evidence' ||
    predicate === 'shared_motif' ||
    predicate === 'literary_correspondence' ||
    predicate === 'biblical_event'
  ) {
    layers.add('motif');
  }
  if (
    tier >= 5 ||
    CAUTION_CLASSES.has(epistemic) ||
    predicate === 'literary_pattern' ||
    predicate === 'orthographic_wordplay' ||
    predicate === 'orthographic_overlap' ||
    predicate === 'shared_external_property' ||
    predicate === 'structural_scene_parallel' ||
    predicate === 'multihop_proof_path' ||
    predicate === 'interpretive_hypothesis'
  ) {
    layers.add('candidate');
  }
  if (layers.size === 0) layers.add('candidate');
  return layers;
}

type EdgeVisualTier = 'confirmed' | 'inferred' | 'candidate' | 'rg_human' | 'rg_ai';

function isDashedConnection(
  epistemic: R10EpistemicClass,
  tier: R10EvidenceTier,
  layers: Set<Exclude<LayerFilterId, 'all'>>
): boolean {
  return layers.has('hypothesis') || layers.has('candidate') || layers.has('rg_ai') || isCautionClass(epistemic, tier);
}

function edgeVisualTier(edge: GraphEdge): EdgeVisualTier {
  if (edge.rgClaim) {
    return edge.rgClaim.author_kind === 'ai' ? 'rg_ai' : 'rg_human';
  }
  if (
    edge.layers.has('hypothesis') ||
    isCautionClass(edge.weakestEpistemicClass, edge.evidenceTier) ||
    (edge.layers.has('candidate') && !edge.isMultihop && !edge.path)
  ) {
    return 'candidate';
  }
  if (
    edge.isMultihop ||
    edge.path ||
    edge.layers.has('lxx') ||
    edge.layers.has('motif') ||
    edge.weakestEpistemicClass === 'editorial_cross_reference' ||
    edge.weakestEpistemicClass === 'documented_collocation_or_cooccurrence'
  ) {
    return 'inferred';
  }
  return 'confirmed';
}

function nodeVisualTier(node: GraphNode): EdgeVisualTier {
  if (node.rgAuthorKind === 'ai') return 'rg_ai';
  if (node.rgAuthorKind === 'human') return 'rg_human';
  if (node.isHypothesis || isCautionClass(node.epistemicClass, node.evidenceTier)) {
    return 'candidate';
  }
  if (
    node.isBridgeNode ||
    node.epistemicClass === 'documented_cross_language_bridge' ||
    node.epistemicClass === 'shared_motif_evidence' ||
    node.epistemicClass === 'editorial_cross_reference' ||
    node.epistemicClass === 'documented_collocation_or_cooccurrence'
  ) {
    return 'inferred';
  }
  return 'confirmed';
}

function tierStrokeColor(tier: EdgeVisualTier, isSelected: boolean, isSurprise: boolean): string {
  if (isSurprise) return 'var(--gold-light, #ddc391)';
  if (isSelected) return 'var(--gold, #c4a36b)';
  if (tier === 'rg_human') return '#d97706';
  if (tier === 'rg_ai') return '#10b981';
  if (tier === 'confirmed') return 'var(--dg-edge-confirmed, #4fd1c5)';
  if (tier === 'inferred') return 'var(--dg-edge-inferred, #d7ba7e)';
  return 'var(--dg-edge-candidate, #a78bfa)';
}

function rectExitDistance(halfW: number, halfH: number, dx: number, dy: number): number {
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-3) return 0;
  const tx = Math.abs(dx) > 1e-3 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = Math.abs(dy) > 1e-3 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY;
  return Math.min(tx, ty) * dist;
}

// === @section:logic:cache ===
const MAX_QUERY_CACHE = 25;

class BoundedLru<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly maxEntries: number) {}

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key: K, val: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, val);
  }
}

function makeQueryCacheKey(
  mode: string,
  passage: ActivePassage,
  query: string
): string {
  return `${mode}:${passage.book}:${passage.chapter}:${passage.verse}:${query.trim().toLowerCase()}`;
}

// === @section:logic:graph-model ===
const MAX_PRIMARY_NEIGHBORS = 9;
const MAX_TOTAL_NEIGHBORS = 12;

function isSamePassage(a?: ActivePassage | null, b?: ActivePassage | null): boolean {
  return !!a && !!b && a.book === b.book && a.chapter === b.chapter && a.verse === b.verse;
}

function toActivePassage(ref: R10PassageRef): ActivePassage {
  return { book: ref.book, chapter: ref.chapter, verse: ref.verse };
}

function formatPassageLabel(p: R10PassageRef): string {
  const base = p.ref || formatVerseRef(toActivePassage(p));
  if (p.end_verse && p.end_verse > p.verse && !base.includes('-')) {
    return `${base}–${p.end_verse}`;
  }
  return base;
}

function truncateLabel(text: string, maxLen = 18): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function connectionKey(conn: R10ConnectionSummary): string {
  return conn.connection_id || conn.evidence_id || conn.title;
}

function selectDiverseConnections(
  connections: R10ConnectionSummary[],
  maxCount = MAX_PRIMARY_NEIGHBORS
): R10ConnectionSummary[] {
  const selected: R10ConnectionSummary[] = [];
  const usedIds = new Set<string>();
  const seenEpistemic = new Set<R10EpistemicClass>();
  const seenPredicates = new Set<string>();

  for (const conn of connections) {
    if (selected.length >= maxCount) break;
    const id = connectionKey(conn);
    if (usedIds.has(id) || seenEpistemic.has(conn.epistemic_class)) continue;
    seenEpistemic.add(conn.epistemic_class);
    seenPredicates.add(conn.predicate);
    usedIds.add(id);
    selected.push(conn);
  }

  for (const conn of connections) {
    if (selected.length >= maxCount) break;
    const id = connectionKey(conn);
    if (usedIds.has(id) || seenPredicates.has(conn.predicate)) continue;
    seenPredicates.add(conn.predicate);
    usedIds.add(id);
    selected.push(conn);
  }

  for (const conn of connections) {
    if (selected.length >= maxCount) break;
    const id = connectionKey(conn);
    if (usedIds.has(id)) continue;
    usedIds.add(id);
    selected.push(conn);
  }

  return selected;
}

function makePassageKey(p: ActivePassage): string {
  return `verse:${p.book}-${p.chapter}-${p.verse}`;
}

function extractCsrPartition(evidenceId?: string): string | undefined {
  if (!evidenceId || !evidenceId.startsWith('v3:csr:')) return undefined;
  const part = evidenceId.split(':')[2]?.trim();
  return part || undefined;
}

function buildNeighborFromClusterBridge(
  bridge: R10ClusterBridge,
  center: CenterState,
  result: DiscoverConnectionsResult | null
): { node: GraphNode; edge: GraphEdge } | null {
  const bNode = bridge.bridging_node;
  if (!bNode) return null;
  const pRef = bNode.passage;
  const passage = pRef ? toActivePassage(pRef) : parseAnchorPassage(bNode.label);
  const nodeId = `node:bridge:${bridge.evidence_id || bridge.bridge_id}`;
  const epistemic = bNode.epistemic_class || 'shared_motif_evidence';
  const layers = classifyConnectionLayers(epistemic, 'literary_correspondence', bridge.evidence_tier);
  const anchor: Anchor = passage
    ? {
        kind: 'verse',
        canonicalKey: makePassageKey(passage),
        label: bNode.label,
        passage,
      }
    : {
        kind: 'concept',
        canonicalKey: `concept:${bNode.id}`,
        label: bNode.label,
      };

  const node: GraphNode = {
    id: nodeId,
    label: bNode.label,
    shortLabel: truncateLabel(bNode.label, 17),
    epistemicClass: epistemic,
    evidenceTier: bridge.evidence_tier,
    why: bridge.explanation,
    passage,
    supportingPassages: pRef ? [pRef] : [],
    rpcNodeId: bNode.id,
    expandQuery: passage ? formatVerseRef(passage) : bNode.label,
    parentNodeId: CENTER_NODE_ID,
    isHypothesis: false,
    isBridgeNode: true,
    expanded: false,
    anchor,
  };

  const edge: GraphEdge = {
    id: `edge:bridge:${bridge.evidence_id || bridge.bridge_id}`,
    fromNodeId: CENTER_NODE_ID,
    toNodeId: nodeId,
    fromLabel: center.label,
    toLabel: bNode.label,
    relationLabel: bNode.grounding_source?.includes('v3') ? 'v3 bridge pivot' : 'bridge pivot',
    predicate: 'literary_correspondence',
    epistemicClass: epistemic,
    weakestEpistemicClass: epistemic,
    evidenceTier: bridge.evidence_tier,
    layers,
    why: bridge.explanation,
    isDashed: isDashedConnection(epistemic, bridge.evidence_tier, layers),
    isMultihop: true,
    evidenceId: bridge.evidence_id,
    sourceRelease: result?.evidence_release_id ?? result?.release_id,
  };

  return { node, edge };
}

function buildNeighborFromSubgraphBridge(
  sgNode: SubgraphNode,
  sgEdges: SubgraphEdge[],
  center: CenterState
): { node: GraphNode; edge: GraphEdge } {
  const passage = sgNode.ref ? parseAnchorPassage(sgNode.ref) : null;
  const matchingEdge =
    sgEdges.find(e => (e.from_node === sgNode.id || e.to_node === sgNode.id) && e.evidence_id?.startsWith('v3:csr:')) ??
    sgEdges.find(e => e.from_node === sgNode.id || e.to_node === sgNode.id);
  const csrPart = extractCsrPartition(matchingEdge?.evidence_id);
  const epistemic = (matchingEdge?.epistemic_class as R10EpistemicClass) || 'shared_motif_evidence';
  const tier = (matchingEdge?.evidence_tier || 3) as R10EvidenceTier;
  const predicate = (matchingEdge?.predicate as R10Predicate) || 'literary_correspondence';
  const layers = classifyConnectionLayers(epistemic, predicate, tier);
  const originalLabel = sgNode.script
    ? `${sgNode.script}${sgNode.strongs ? ` (${sgNode.strongs}${sgNode.gloss ? ` "${sgNode.gloss}"` : ''})` : ''}`
    : undefined;
  const originalShortLabel = sgNode.script
    ? `${sgNode.script}${sgNode.strongs ? ` ${sgNode.strongs}` : ''}`
    : undefined;
  const nodeId = `node:sg:${sgNode.id}`;

  const anchor: Anchor = passage
    ? {
        kind: 'verse',
        canonicalKey: makePassageKey(passage),
        label: sgNode.label,
        passage,
        strongs: sgNode.strongs,
        original: sgNode.script,
        transliteration: sgNode.transliteration,
        english: sgNode.gloss,
      }
    : {
        kind: 'concept',
        canonicalKey: sgNode.id,
        label: sgNode.label,
        strongs: sgNode.strongs,
        original: sgNode.script,
        transliteration: sgNode.transliteration,
        english: sgNode.gloss,
      };

  const node: GraphNode = {
    id: nodeId,
    label: sgNode.label,
    shortLabel: truncateLabel(sgNode.label, 17),
    originalLabel,
    originalShortLabel: originalShortLabel ? truncateLabel(originalShortLabel, 17) : undefined,
    epistemicClass: epistemic,
    evidenceTier: tier,
    why: matchingEdge?.summary || `Intermediate Steiner / Conductance bridge pivot (${sgNode.label}).`,
    passage,
    supportingPassages: passage
      ? [{ verse_id: 0, ref: sgNode.ref || formatVerseRef(passage), book: passage.book, chapter: passage.chapter, verse: passage.verse, testament: passage.book <= 39 ? 'OT' : 'NT' }]
      : [],
    rpcNodeId: sgNode.id,
    expandQuery: sgNode.strongs || (passage ? formatVerseRef(passage) : sgNode.label),
    parentNodeId: CENTER_NODE_ID,
    isHypothesis: false,
    isBridgeNode: true,
    csrPartition: csrPart,
    expanded: false,
    anchor,
  };

  const edge: GraphEdge = {
    id: `edge:sg:${sgNode.id}`,
    fromNodeId: CENTER_NODE_ID,
    toNodeId: nodeId,
    fromLabel: center.label,
    toLabel: sgNode.label,
    relationLabel: csrPart ? `CSR ${csrPart}` : (matchingEdge?.predicate?.replace(/_/g, ' ') || 'subgraph bridge'),
    predicate,
    epistemicClass: epistemic,
    weakestEpistemicClass: epistemic,
    evidenceTier: tier,
    layers,
    why: matchingEdge?.summary || `Verified subgraph bridge linking anchors via ${sgNode.label}.`,
    isDashed: isDashedConnection(epistemic, tier, layers),
    isMultihop: true,
    csrPartition: csrPart,
    evidenceId: matchingEdge?.evidence_id,
  };

  return { node, edge };
}

function anchorMatchesCenter(anchor: Anchor, center: CenterState): boolean {
  if (anchor.passage && isSamePassage(anchor.passage, center.passage)) return true;
  if (anchor.canonicalKey === center.anchor.canonicalKey) return true;
  const occPrefix = `occ:${center.passage.book}-${center.passage.chapter}-${center.passage.verse}:`;
  if (anchor.canonicalKey.startsWith(occPrefix)) return true;
  const centerRef = formatVerseRef(center.passage).toLowerCase();
  return anchor.label.toLowerCase() === centerRef;
}

function hypothesisTouchesCenter(h: UserHypothesis, center: CenterState): boolean {
  if (anchorMatchesCenter(h.from, center) || anchorMatchesCenter(h.to, center)) return true;
  const centerRef = formatVerseRef(center.passage).toLowerCase();
  if (h.linkedRefs.some(r => r.toLowerCase() === centerRef)) return true;
  const q = center.query.trim().toLowerCase();
  if (q.length >= 3) {
    if (h.from.strongs?.toLowerCase() === q || h.to.strongs?.toLowerCase() === q) return true;
  }
  return false;
}

function buildNeighborFromConnection(
  conn: R10ConnectionSummary,
  center: CenterState,
  parentNodeId: string,
  result: DiscoverConnectionsResult | null,
  isBridgeNode = false
): { node: GraphNode; edge: GraphEdge } {
  const targetRef =
    conn.passages.find(p => !isSamePassage(toActivePassage(p), center.passage)) ?? conn.passages[0];
  const targetPassage = targetRef ? toActivePassage(targetRef) : null;
  const firstWord = conn.original_words[0];

  const readableLabel = targetRef
    ? `${formatPassageLabel(targetRef)} · ${truncateLabel(conn.title, 26)}`
    : conn.title;
  const shortLabel = targetRef
    ? formatPassageLabel(targetRef)
    : firstWord?.transliteration || truncateLabel(conn.title, 16);
  const secondWord = conn.original_words[1];
  const focalWord =
    secondWord && secondWord.strongs && secondWord.strongs !== center.anchor.strongs
      ? secondWord
      : firstWord;
  const originalLabel = focalWord?.lemma_script
    ? `${focalWord.lemma_script} (${focalWord.strongs || focalWord.transliteration || ''}${focalWord.gloss ? ` "${focalWord.gloss}"` : ''})${targetRef ? ` · ${formatPassageLabel(targetRef)}` : ''}`
    : undefined;
  const originalShortLabel = focalWord?.lemma_script
    ? `${focalWord.lemma_script}${focalWord.strongs ? ` ${focalWord.strongs}` : ''}`
    : undefined;

  const nodeId = `node:${connectionKey(conn)}`;
  const rpcNodeId = firstWord?.strongs
    ? `lemma:${firstWord.strongs}`
    : targetPassage
      ? `passage:${formatVerseRef(targetPassage)}`
      : conn.connection_id;
  const expandQuery =
    firstWord?.strongs ||
    firstWord?.transliteration ||
    (targetPassage ? formatVerseRef(targetPassage) : conn.title);

  const neighborAnchor: Anchor = targetPassage
    ? {
        kind: 'verse',
        canonicalKey: makePassageKey(targetPassage),
        label: formatPassageLabel(targetRef!),
        passage: targetPassage,
        strongs: firstWord?.strongs,
        original: firstWord?.lemma_script,
        transliteration: firstWord?.transliteration,
        english: firstWord?.gloss,
      }
    : {
        kind: 'concept',
        canonicalKey: `concept:${connectionKey(conn)}`,
        label: conn.title,
        strongs: firstWord?.strongs,
        original: firstWord?.lemma_script,
        transliteration: firstWord?.transliteration,
        english: firstWord?.gloss,
      };

  const stepClasses: R10EpistemicClass[] = [conn.epistemic_class];
  const isMultihop =
    conn.predicate === 'multihop_proof_path' ||
    (conn.r12_metadata?.meaningful_hops ?? 0) > 1 ||
    (conn.r12_metadata?.steps?.length ?? 0) > 1;

  const layers = classifyConnectionLayers(conn.epistemic_class, conn.predicate, conn.evidence_tier);
  const isDashed = isDashedConnection(conn.epistemic_class, conn.evidence_tier, layers);
  const effectiveBridge =
    isBridgeNode ||
    conn.evidence_id?.startsWith('r13:v3bridge:') ||
    Boolean(conn.expand_id?.startsWith('v3:bridge:'));
  const csrPartition = extractCsrPartition(conn.evidence_id);

  const node: GraphNode = {
    id: nodeId,
    label: readableLabel,
    shortLabel: truncateLabel(shortLabel, 17),
    originalLabel,
    originalShortLabel: originalShortLabel ? truncateLabel(originalShortLabel, 17) : undefined,
    epistemicClass: conn.epistemic_class,
    evidenceTier: conn.evidence_tier,
    why: conn.explanation || conn.title,
    passage: targetPassage,
    supportingPassages: conn.passages,
    rpcNodeId,
    expandQuery,
    parentNodeId,
    isHypothesis: false,
    isBridgeNode: effectiveBridge,
    csrPartition,
    v3Score: conn.v3_score,
    expanded: false,
    anchor: neighborAnchor,
    conn,
  };

  const edge: GraphEdge = {
    id: `edge:${parentNodeId}->${nodeId}`,
    fromNodeId: parentNodeId,
    toNodeId: nodeId,
    fromLabel: parentNodeId === CENTER_NODE_ID ? center.label : parentNodeId,
    toLabel: readableLabel,
    relationLabel: conn.predicate.replace(/_/g, ' '),
    predicate: conn.predicate,
    epistemicClass: conn.epistemic_class,
    weakestEpistemicClass: weakestEpistemic(stepClasses),
    evidenceTier: conn.evidence_tier,
    layers,
    why: conn.explanation || conn.title,
    isDashed,
    isMultihop,
    csrPartition,
    v3Score: conn.v3_score,
    evidenceId: conn.evidence_id,
    sourceRelease: conn.evidence_release_id ?? result?.evidence_release_id ?? result?.release_id,
    conn,
  };

  return { node, edge };
}

function buildNeighborFromPath(
  path: R10ConnectionPath,
  center: CenterState,
  result: DiscoverConnectionsResult | null
): { node: GraphNode; edge: GraphEdge } | null {
  const endRef = path.end_node.passage;
  const endPassage = endRef ? toActivePassage(endRef) : parseAnchorPassage(path.end_node.label);
  const stepPassages = path.steps
    .map(s => s.key_passage)
    .filter((p): p is R10PassageRef => !!p);
  const supportingPassages = endRef ? [endRef, ...stepPassages] : stepPassages;
  const nodeId = `node:path:${path.path_id}`;
  const stepClasses = path.steps.map(s => s.epistemic_class);
  const weakest = weakestEpistemic(
    stepClasses.length > 0 ? stepClasses : [path.end_node.epistemic_class]
  );
  const firstEvidenceStep = path.steps.find(s => !!s.evidence_id);
  const layers = classifyConnectionLayers(weakest, 'multihop_proof_path', path.weakest_tier);

  const neighborAnchor: Anchor = endPassage
    ? {
        kind: 'verse',
        canonicalKey: makePassageKey(endPassage),
        label: path.end_node.label,
        passage: endPassage,
      }
    : {
        kind: 'concept',
        canonicalKey: `concept:${path.end_node.id}`,
        label: path.end_node.label,
      };

  const node: GraphNode = {
    id: nodeId,
    label: path.end_node.label,
    shortLabel: truncateLabel(path.end_node.label, 17),
    epistemicClass: weakest,
    evidenceTier: path.weakest_tier,
    why: path.explanation || path.steps.map(s => s.relation_summary).join(' → '),
    passage: endPassage,
    supportingPassages,
    rpcNodeId: path.end_node.id,
    expandQuery: endPassage ? formatVerseRef(endPassage) : path.end_node.label,
    parentNodeId: CENTER_NODE_ID,
    isHypothesis: false,
    isBridgeNode: true,
    expanded: false,
    anchor: neighborAnchor,
  };

  const edge: GraphEdge = {
    id: `edge:path:${path.path_id}`,
    fromNodeId: CENTER_NODE_ID,
    toNodeId: nodeId,
    fromLabel: center.label,
    toLabel: path.end_node.label,
    relationLabel: `bridge (${path.steps.length} step${path.steps.length === 1 ? '' : 's'})`,
    predicate: 'multihop_proof_path',
    epistemicClass: weakest,
    weakestEpistemicClass: weakest,
    evidenceTier: path.weakest_tier,
    layers,
    why: path.explanation || path.steps.map(s => s.relation_summary).join(' → '),
    isDashed: isDashedConnection(weakest, path.weakest_tier, layers),
    isMultihop: path.steps.length > 1,
    evidenceId: firstEvidenceStep?.evidence_id,
    sourceRelease: result?.evidence_release_id ?? result?.release_id,
    path,
  };

  return { node, edge };
}

function buildNeighborFromHypothesis(
  h: UserHypothesis,
  center: CenterState
): { node: GraphNode; edge: GraphEdge } {
  const fromMatches = anchorMatchesCenter(h.from, center);
  const other = fromMatches ? h.to : h.from;
  const targetPassage = other.passage ?? parseAnchorPassage(other.label);
  const nodeId = `node:hyp:${h.id}`;

  const supportingPassages: R10PassageRef[] = targetPassage
    ? [
        {
          verse_id: 0,
          ref: formatVerseRef(targetPassage),
          book: targetPassage.book,
          chapter: targetPassage.chapter,
          verse: targetPassage.verse,
          testament: targetPassage.book <= 39 ? 'OT' : 'NT',
        },
      ]
    : [];

  const node: GraphNode = {
    id: nodeId,
    label: other.label,
    shortLabel: truncateLabel(other.label, 17),
    epistemicClass: 'user_note',
    evidenceTier: 8,
    why: h.note || 'User hypothesis recorded in exploration session.',
    passage: targetPassage,
    supportingPassages,
    rpcNodeId: targetPassage ? `passage:${formatVerseRef(targetPassage)}` : other.canonicalKey,
    expandQuery: targetPassage ? formatVerseRef(targetPassage) : other.label,
    parentNodeId: CENTER_NODE_ID,
    isHypothesis: true,
    expanded: false,
    anchor: other,
  };

  const edge: GraphEdge = {
    id: `edge:hyp:${h.id}`,
    fromNodeId: CENTER_NODE_ID,
    toNodeId: nodeId,
    fromLabel: center.label,
    toLabel: other.label,
    relationLabel: 'My hypothesis',
    predicate: 'user_hypothesis',
    epistemicClass: 'user_note',
    weakestEpistemicClass: 'user_note',
    evidenceTier: 8,
    layers: new Set(['hypothesis']),
    why: h.note || 'User-created hypothesis linking these anchors.',
    isDashed: true,
    isMultihop: false,
    hypothesis: h,
  };

  return { node, edge };
}

// === @section:logic:layout ===
function computeRadialPositions(
  nodes: GraphNode[],
  layout: SvgLayoutSpec
): Map<string, PositionedNode> {
  const positions = new Map<string, PositionedNode>();
  if (nodes.length === 0) return positions;

  const primary = nodes.filter(n => n.parentNodeId === CENTER_NODE_ID);
  const secondary = nodes.filter(n => n.parentNodeId !== CENTER_NODE_ID);

  const primaryAngles = new Map<string, number>();

  primary.forEach((node, idx) => {
    const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / Math.max(primary.length, 1);
    primaryAngles.set(node.id, angle);
    const x = Math.round(
      Math.max(
        layout.padX,
        Math.min(layout.viewBoxW - layout.padX, layout.centerX + layout.rx * Math.cos(angle))
      )
    );
    const y = Math.round(
      Math.max(
        layout.padY,
        Math.min(layout.viewBoxH - layout.padY, layout.centerY + layout.ry * Math.sin(angle))
      )
    );
    positions.set(node.id, { node, x, y });
  });

  // Group secondary (expanded) nodes around their parent node's angle without overlapping.
  const byParent = new Map<string, GraphNode[]>();
  for (const child of secondary) {
    const bucket = byParent.get(child.parentNodeId) ?? [];
    bucket.push(child);
    byParent.set(child.parentNodeId, bucket);
  }

  for (const [parentId, children] of byParent.entries()) {
    const baseAngle = primaryAngles.get(parentId) ?? 0;
    const spread = 0.28;
    children.forEach((child, idx) => {
      const offset = (idx - (children.length - 1) / 2) * spread;
      const angle = baseAngle + offset;
      const x = Math.round(
        Math.max(
          layout.padX,
          Math.min(layout.viewBoxW - layout.padX, layout.centerX + layout.secondaryRx * Math.cos(angle))
        )
      );
      const y = Math.round(
        Math.max(
          layout.padY,
          Math.min(layout.viewBoxH - layout.padY, layout.centerY + layout.secondaryRy * Math.sin(angle))
        )
      );
      positions.set(child.id, { node: child, x, y });
    });
  }

  return positions;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  text?: string
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, String(v));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

// === @section:ui:main ===
let graphInstanceSeq = 0;

export function createDiscoveryGraph(
  callbacks: DiscoveryGraphCallbacks,
  options?: DiscoveryGraphOptions
): DiscoveryGraphHandle {
  const variant = options?.variant ?? 'full';
  const isCompact = variant === 'compact';
  const svgLayout = isCompact ? COMPACT_SVG_LAYOUT : FULL_SVG_LAYOUT;
  const maxPrimaryNeighbors = isCompact ? 6 : MAX_PRIMARY_NEIGHBORS;
  const maxTotalNeighbors = isCompact ? 8 : MAX_TOTAL_NEIGHBORS;
  const instanceId = ++graphInstanceSeq;
  const shadowFilterId = `dg-center-shadow-${instanceId}`;
  const markerPrefix = `dg-arrow-${instanceId}`;

  const element = el(
    'section',
    `discovery-graph-panel ${isCompact ? 'discovery-graph--compact' : 'discovery-graph--full'}`
  );
  element.setAttribute(
    'aria-label',
    isCompact ? 'Word discovery neighborhood graph' : 'Local discovery neighborhood graph'
  );
  element.hidden = !options?.defaultOpen;

  // Header & controls
  const header = el('div', 'discovery-graph__header');

  const titleWrap = el('div', 'discovery-graph__title');
  const eyebrowEl = el('p', 'eyebrow', isCompact ? 'WORD GRAPH' : 'LOCAL DISCOVERY GRAPH');
  const anchorTitle = el(
    'h3',
    'discovery-graph__anchor',
    isCompact ? 'Select a word' : 'Select a verse'
  );
  titleWrap.append(eyebrowEl, anchorTitle);

  const actionControls = el('div', 'discovery-graph__controls');

  const surpriseBtn = action(
    isCompact ? 'Surprise' : 'Surprise me',
    handleSurprise,
    'study-button discovery-graph__btn'
  );
  const challengeBtn = action(
    'Challenge',
    () => {
      void runChallenge();
    },
    'study-button discovery-graph__btn'
  );
  const addClaimBtn = callbacks.onOpenClaimComposer
    ? action(
        '+ Add claim',
        () => {
          if (!center) return;
          callbacks.onOpenClaimComposer?.({
            mode: 'create',
            subjectQuery: center.query,
            subjectLabel: center.label,
            title: `${center.label} — research observation`,
          });
        },
        'study-button discovery-graph__btn'
      )
    : null;
  const expandFullBtn = action(
    'Expand ⤢',
    () => {
      if (!center) return;
      if (isCompact) {
        openPopupModal();
      } else {
        options?.onExpandFull?.(center.query, center.passage, center.label);
      }
    },
    'study-button discovery-graph__btn'
  );
  expandFullBtn.setAttribute('aria-label', 'Expand word connection graph in modal');
  let collapseBtn: HTMLButtonElement | null = null;
  if (isCompact) {
    actionControls.append(expandFullBtn, surpriseBtn, ...(addClaimBtn ? [addClaimBtn] : []));
  } else {
    collapseBtn = action(
      'Collapse',
      () => {
        if (collapsed) {
          expand();
        } else {
          setCollapsed(true);
          callbacks.preview.dismiss();
        }
      },
      'study-button discovery-graph__btn discovery-graph__collapse-btn'
    );
    collapseBtn.setAttribute('aria-expanded', 'true');
    actionControls.append(surpriseBtn, challengeBtn, ...(addClaimBtn ? [addClaimBtn] : []), collapseBtn);
  }
  header.append(titleWrap, actionControls);

  // Collapsible body (keeps section header visible when collapsed in full variant)
  const bodyEl = el('div', 'discovery-graph__body');

  // Layer mode switcher (Source & Algorithm | Research Graph | Combined) + filter bar
  const toolbar = el('div', 'discovery-graph__toolbar');

  const modeSwitchWrap = el('div', 'discovery-graph__mode-switch');
  modeSwitchWrap.setAttribute('role', 'group');
  modeSwitchWrap.setAttribute('aria-label', 'Graph layer mode');

  const filterBar = el('div', 'discovery-graph__filters');
  filterBar.setAttribute('role', 'group');
  filterBar.setAttribute('aria-label', 'Filter graph layers');

  const bridgeForm = document.createElement('form');
  bridgeForm.className = 'discovery-graph__bridge-form';
  const bridgeInput = document.createElement('input');
  bridgeInput.type = 'search';
  bridgeInput.className = 'discovery-graph__bridge-input';
  bridgeInput.placeholder = 'Target word or verse B…';
  bridgeInput.setAttribute('aria-label', 'Target word or verse B for Find a bridge');
  const bridgeSubmit = el('button', 'study-button discovery-graph__bridge-submit', 'Find a bridge');
  bridgeSubmit.type = 'submit';
  bridgeForm.append(bridgeInput, bridgeSubmit);
  bridgeForm.addEventListener('submit', event => {
    event.preventDefault();
    const targetB = bridgeInput.value.trim();
    if (!targetB) return;
    void runBridge(targetB);
  });

  if (isCompact) {
    toolbar.append(modeSwitchWrap, filterBar);
  } else {
    toolbar.append(modeSwitchWrap, filterBar, bridgeForm);
  }

  // Status / bridge / challenge banner slot
  const bannerSlot = el('div', 'discovery-graph__banners');

  // Main workspace
  const workspace = el('div', 'discovery-graph__workspace');
  const svgWrap = el('div', 'discovery-graph__svg-wrap discovery-graph-canvas-wrap');
  const listWrap = el('div', 'discovery-graph__list');
  listWrap.setAttribute('aria-label', 'Graph nodes and edges keyboard list');

  const inspectorWrap = el('aside', 'discovery-graph__inspector');
  inspectorWrap.setAttribute('aria-label', 'Selection inspector');

  let compactListDetails: HTMLDetailsElement | null = null;
  let compactListSummary: HTMLElement | null = null;

  if (isCompact) {
    compactListDetails = document.createElement('details');
    compactListDetails.className = 'discovery-graph__compact-list';
    compactListSummary = el('summary', '', 'List view (0)');
    compactListDetails.append(compactListSummary, listWrap);
    workspace.append(svgWrap, inspectorWrap, compactListDetails);
  } else {
    const sideCol = el('div', 'discovery-graph__side-col');
    sideCol.append(inspectorWrap, listWrap);
    workspace.append(svgWrap, sideCol);
  }

  bodyEl.append(toolbar, bannerSlot, workspace);
  element.append(header, bodyEl);

  // State & bounded caches
  const queryCache = new BoundedLru<string, DiscoverConnectionsResult>(MAX_QUERY_CACHE);
  const evidenceCache = new BoundedLru<string, ConnectionEvidenceResult>(MAX_QUERY_CACHE);
  const evidenceLoading = new Set<string>();
  const evidenceErrors = new Map<string, string>();
  let dragCleanups: Array<() => void> = [];
  let activePopupDialog: HTMLDialogElement | null = null;
  let destroyed = false;

  let queryGen = 0;
  let evidenceGen = 0;
  let collapsed = false;
  let center: CenterState | null = null;
  let currentResult: DiscoverConnectionsResult | null = null;
  let loading = false;
  let errorMsg: string | null = null;
  let layerMode: GraphLayerMode = 'algorithmic';
  let activeFilter: LayerFilterId = 'all';
  let originalLangMode = true;
  let currentRgNeighborhood: RgNeighborhoodResponse | null = null;
  const rgTraceCache = new Map<string, RgTraceResponse>();
  const rgTraceLoading = new Set<string>();
  let graphNodes: GraphNode[] = [];
  let graphEdges: GraphEdge[] = [];
  let selectedNodeId: string | null = null;
  let selectedEdgeId: string | null = null;
  let surpriseNodeId: string | null = null;
  let surpriseCursor = -1;
  let expandingNodeId: string | null = null;
  let expandNotice: string | null = null;
  let bridgeState: BridgeSearchState | null = null;
  let challengeState: ChallengeState | null = null;

  function clearDragCleanups() {
    for (const cleanup of dragCleanups) {
      cleanup();
    }
    dragCleanups = [];
  }

  function buildLegendBar(): HTMLElement {
    const legend = el('div', 'discovery-graph__legend');
    legend.setAttribute('role', 'note');
    legend.setAttribute('aria-label', 'Epistemic edge legend');

    const items: Array<{ tier: EdgeVisualTier; label: string; dash?: string; round?: boolean }> = [
      { tier: 'confirmed', label: 'Scripture / Lexicon' },
      { tier: 'inferred', label: 'Algorithmic Bridge', dash: '6 4' },
      { tier: 'candidate', label: 'Candidate / Local Note', dash: '2 4', round: true },
      ...(layerMode !== 'algorithmic'
        ? [
            { tier: 'rg_human' as EdgeVisualTier, label: 'Human Research (RG)' },
            { tier: 'rg_ai' as EdgeVisualTier, label: 'AI Research (RG)', dash: '4 3' },
          ]
        : []),
    ];

    for (const item of items) {
      const entry = el('span', 'discovery-graph__legend-item');
      const swatch = svgEl('svg', {
        class: `discovery-graph__legend-swatch discovery-graph__legend-swatch--${item.tier}`,
        viewBox: '0 0 26 8',
        width: 26,
        height: 8,
        'aria-hidden': 'true',
      });
      const lineAttrs: Record<string, string | number> = {
        x1: 1,
        y1: 4,
        x2: 24,
        y2: 4,
        stroke: tierStrokeColor(item.tier, false, false),
        'stroke-width': 2,
      };
      if (item.dash) lineAttrs['stroke-dasharray'] = item.dash;
      if (item.round) lineAttrs['stroke-linecap'] = 'round';
      swatch.append(svgEl('line', lineAttrs));
      entry.append(swatch, document.createTextNode(item.label));
      legend.append(entry);
    }

    return legend;
  }

  function openPopupModal() {
    if (!center) return;
    if (activePopupDialog && (activePopupDialog.open || activePopupDialog.isConnected)) {
      return;
    }

    const initialAnchor = center;
    const dialog = document.createElement('dialog');
    dialog.className = 'graph-popup-dialog';
    dialog.setAttribute('closedby', 'any');

    const titleId = `dg-popup-title-${++graphInstanceSeq}`;
    dialog.setAttribute('aria-labelledby', titleId);

    const shell = el('div', 'graph-popup-shell');
    const popupHeader = el('header', 'graph-popup-header');
    const title = el('h2', 'graph-popup-title', `Word Connection Graph · ${initialAnchor.label}`);
    title.id = titleId;

    const headerActions = el('div', 'graph-popup-header-actions');
    let restoreFocusOnClose = true;
    let cleanedUp = false;

    const closeBtn = action(
      'Close ✕',
      () => {
        dialog.close();
      },
      'study-button discovery-graph__btn graph-popup-close-btn'
    );
    closeBtn.setAttribute('aria-label', 'Close expanded word connection graph');
    closeBtn.setAttribute('autofocus', '');

    if (options?.onExpandFull) {
      const showMainBtn = action(
        'Show in main pane',
        () => {
          restoreFocusOnClose = false;
          dialog.close();
          options.onExpandFull?.(initialAnchor.query, initialAnchor.passage, initialAnchor.label);
        },
        'study-button discovery-graph__btn'
      );
      headerActions.append(showMainBtn);
    }
    headerActions.append(closeBtn);
    popupHeader.append(title, headerActions);

    const popupBody = el('div', 'graph-popup-body');
    const popupGraph = createDiscoveryGraph(
      {
        preview: callbacks.preview,
        onFollowPassage: (p, edge) => {
          restoreFocusOnClose = false;
          dialog.close();
          callbacks.onFollowPassage(p, edge);
        },
        onComparePassage: target => {
          restoreFocusOnClose = false;
          dialog.close();
          callbacks.onComparePassage(target);
        },
        onCreateHypothesis: (from, to) => {
          restoreFocusOnClose = false;
          dialog.close();
          callbacks.onCreateHypothesis(from, to);
        },
        onInspectWord: callbacks.onInspectWord
          ? (wordId: number) => {
              callbacks.onInspectWord?.(wordId);
            }
          : undefined,
      },
      {
        variant: 'full',
        defaultOpen: true,
        onRegisterDrag: options?.onRegisterDrag,
      }
    );

    popupBody.append(popupGraph.element);
    shell.append(popupHeader, popupBody);
    dialog.append(shell);

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const inside =
          rect.width > 0 &&
          rect.height > 0 &&
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        if (!inside) dialog.close();
      });
    }

    dialog.addEventListener('close', () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (activePopupDialog === dialog) activePopupDialog = null;
      popupGraph.destroy?.();
      popupGraph.close();
      dialog.remove();
      if (restoreFocusOnClose && expandFullBtn.isConnected) {
        expandFullBtn.focus();
      }
    });

    activePopupDialog = dialog;
    document.body.append(dialog);
    dialog.showModal();

    popupGraph.openForAnchor(initialAnchor.query, initialAnchor.passage, initialAnchor.label, {
      initialFilter: activeFilter,
      preserveSelection: {
        nodeId: selectedNodeId,
        edgeId: selectedEdgeId,
      },
      seedResult: currentResult,
    });
  }

  function setCollapsed(next: boolean) {
    collapsed = next;
    bodyEl.hidden = collapsed;
    element.classList.toggle('is-collapsed', collapsed);
    if (collapseBtn) {
      collapseBtn.textContent = collapsed ? 'Expand' : 'Collapse';
      collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    }
  }

  function buildCenterAnchor(query: string, passage: ActivePassage, label: string): Anchor {
    return {
      kind: 'verse',
      canonicalKey: makePassageKey(passage),
      label,
      passage: { ...passage },
      english: query !== label ? query : undefined,
    };
  }

  function rebuildGraphFromResult(result: DiscoverConnectionsResult | null) {
    if (!center) return;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const seenNodeIds = new Set<string>();

    if (result && layerMode !== 'research') {
      let candidates = [...result.strongest_connections];
      if (candidates.length < 5 && result.related_discoveries?.literary_parallels?.length) {
        candidates = [...candidates, ...result.related_discoveries.literary_parallels];
      }
      if (candidates.length < 5 && result.related_discoveries?.roots_and_wordplay?.length) {
        candidates = [...candidates, ...result.related_discoveries.roots_and_wordplay];
      }

      const diverse = selectDiverseConnections(candidates, maxPrimaryNeighbors);
      for (const conn of diverse) {
        const built = buildNeighborFromConnection(conn, center, CENTER_NODE_ID, result);
        if (!seenNodeIds.has(built.node.id)) {
          seenNodeIds.add(built.node.id);
          nodes.push(built.node);
          edges.push(built.edge);
        }
      }

      for (const path of result.connection_paths ?? []) {
        if (nodes.length >= maxTotalNeighbors) break;
        const built = buildNeighborFromPath(path, center, result);
        if (built && !seenNodeIds.has(built.node.id)) {
          seenNodeIds.add(built.node.id);
          nodes.push(built.node);
          edges.push(built.edge);
        }
      }

      for (const bridge of result.bridges ?? []) {
        if (nodes.length >= maxTotalNeighbors) break;
        if (bridge.evidence_id && candidates.some(c => c.evidence_id === bridge.evidence_id)) continue;
        const built = buildNeighborFromClusterBridge(bridge, center, result);
        if (built && !seenNodeIds.has(built.node.id)) {
          seenNodeIds.add(built.node.id);
          nodes.push(built.node);
          edges.push(built.edge);
        }
      }
    }

    // Map persistent Research Knowledge Graph edges when layerMode is 'research' or 'combined'
    if (layerMode !== 'algorithmic' && currentRgNeighborhood?.edges?.length) {
      for (const rg of currentRgNeighborhood.edges.slice(0, maxTotalNeighbors)) {
        const nodeId = `rg:${rg.neighbor_key}`;
        if (!seenNodeIds.has(nodeId)) {
          seenNodeIds.add(nodeId);
          nodes.push({
            id: nodeId,
            label: rg.neighbor_label,
            shortLabel: truncateLabel(rg.neighbor_label, svgLayout.labelMaxChars),
            originalLabel: rg.neighbor_script ? `${rg.neighbor_script} · ${rg.neighbor_label}` : rg.neighbor_label,
            originalShortLabel: rg.neighbor_script || truncateLabel(rg.neighbor_label, svgLayout.labelMaxChars),
            epistemicClass: 'interpretive_hypothesis',
            evidenceTier: 6,
            why: `${rg.predicate_label}: ${rg.assertion_text}`,
            passage: null,
            supportingPassages: [],
            rpcNodeId: rg.neighbor_key,
            expandQuery: rg.neighbor_strongs || rg.neighbor_key,
            parentNodeId: CENTER_NODE_ID,
            isHypothesis: false,
            rgAuthorKind: rg.author_kind,
            rgNodeKey: rg.neighbor_key,
            rgNodeKind: rg.neighbor_kind,
            expanded: false,
            anchor: {
              kind: 'concept',
              canonicalKey: rg.neighbor_key,
              label: rg.neighbor_label,
              strongs: rg.neighbor_strongs ?? undefined,
            },
          });
        }
        const fromId = rg.traversal_dir === 'incoming' ? nodeId : CENTER_NODE_ID;
        const toId = rg.traversal_dir === 'incoming' ? CENTER_NODE_ID : nodeId;
        const fromLabel = rg.traversal_dir === 'incoming' ? rg.neighbor_label : center.label;
        const toLabel = rg.traversal_dir === 'incoming' ? center.label : rg.neighbor_label;
        const layerKey: Exclude<LayerFilterId, 'all'> = rg.author_kind === 'ai' ? 'rg_ai' : 'rg_human';
        edges.push({
          id: `rg-edge:${rg.claim_id}:${rg.neighbor_key}`,
          fromNodeId: fromId,
          toNodeId: toId,
          fromLabel,
          toLabel,
          relationLabel: `${rg.predicate_label}${rg.is_potentially_stale ? ' [stale]' : ''}`,
          predicate: 'interpretive_hypothesis',
          epistemicClass: 'interpretive_hypothesis',
          weakestEpistemicClass: 'interpretive_hypothesis',
          evidenceTier: 6,
          layers: new Set([layerKey]),
          why: rg.assertion_text,
          isDashed: rg.author_kind === 'ai' || rg.is_potentially_stale,
          isMultihop: false,
          rgClaim: rg,
        });
      }
    }

    // Map explorationState.getHypotheses() touching current anchor into dashed "My hypothesis" edges
    for (const h of explorationState.getHypotheses()) {
      if (!hypothesisTouchesCenter(h, center)) continue;
      const built = buildNeighborFromHypothesis(h, center);
      if (!seenNodeIds.has(built.node.id)) {
        seenNodeIds.add(built.node.id);
        nodes.push(built.node);
        edges.push(built.edge);
      }
    }

    graphNodes = nodes;
    graphEdges = edges;

    if (selectedNodeId && !nodes.some(n => n.id === selectedNodeId)) selectedNodeId = null;
    if (selectedEdgeId && !edges.some(e => e.id === selectedEdgeId)) selectedEdgeId = null;
    if (!isCompact && !selectedNodeId && !selectedEdgeId && nodes.length > 0) {
      selectedNodeId = nodes[0]!.id;
    }
  }

  function syncHypothesesFromState() {
    if (!center) return;
    const nonHypNodes = graphNodes.filter(n => !n.isHypothesis);
    const nonHypEdges = graphEdges.filter(e => !e.hypothesis);
    const seenIds = new Set(nonHypNodes.map(n => n.id));
    for (const h of explorationState.getHypotheses()) {
      if (!hypothesisTouchesCenter(h, center)) continue;
      const built = buildNeighborFromHypothesis(h, center);
      if (!seenIds.has(built.node.id)) {
        seenIds.add(built.node.id);
        nonHypNodes.push(built.node);
        nonHypEdges.push(built.edge);
      }
    }
    graphNodes = nonHypNodes;
    graphEdges = nonHypEdges;
    if (selectedNodeId && !graphNodes.some(n => n.id === selectedNodeId)) selectedNodeId = null;
    if (selectedEdgeId && !graphEdges.some(e => e.id === selectedEdgeId)) selectedEdgeId = null;
  }

  function getVisibleGraph(): { visibleNodes: GraphNode[]; visibleEdges: GraphEdge[] } {
    const filter = activeFilter;
    if (filter === 'all') {
      return { visibleNodes: graphNodes, visibleEdges: graphEdges };
    }
    const matchingEdges = graphEdges.filter(e => e.layers.has(filter));
    const visibleNodeIds = new Set<string>();
    for (const edge of matchingEdges) {
      if (edge.fromNodeId !== CENTER_NODE_ID) visibleNodeIds.add(edge.fromNodeId);
      if (edge.toNodeId !== CENTER_NODE_ID) visibleNodeIds.add(edge.toNodeId);
    }
    // Include secondary parent nodes if child is visible so edge endpoints stay anchored.
    const visibleNodes = graphNodes.filter(n => visibleNodeIds.has(n.id));
    const visibleEdges = matchingEdges.filter(
      e =>
        (e.fromNodeId === CENTER_NODE_ID || visibleNodeIds.has(e.fromNodeId)) &&
        (e.toNodeId === CENTER_NODE_ID || visibleNodeIds.has(e.toNodeId))
    );
    return { visibleNodes, visibleEdges };
  }

  function selectNode(nodeId: string) {
    selectedNodeId = nodeId;
    selectedEdgeId = null;
    expandNotice = null;
    renderAll();
  }

  function selectEdge(edge: GraphEdge) {
    selectedEdgeId = edge.id;
    selectedNodeId = null;
    expandNotice = null;
    if (edge.rgClaim && !rgTraceCache.has(edge.rgClaim.claim_id) && !rgTraceLoading.has(edge.rgClaim.claim_id)) {
      const claimId = edge.rgClaim.claim_id;
      rgTraceLoading.add(claimId);
      void BibleRPC.graph.traceEvidence(claimId, 4).then(res => {
        rgTraceLoading.delete(claimId);
        if (res.data) rgTraceCache.set(claimId, res.data);
        renderInspector();
      });
    }
    if (edge.evidenceId && !evidenceCache.get(edge.evidenceId) && !evidenceLoading.has(edge.evidenceId)) {
      void loadEdgeEvidence(edge.evidenceId, edge.sourceRelease);
    }
    renderAll();
  }

  async function loadEdgeEvidence(evidenceId: string, releaseId?: string) {
    const gen = ++evidenceGen;
    const activeQueryGen = queryGen;
    evidenceErrors.delete(evidenceId);
    evidenceLoading.add(evidenceId);
    renderInspector();

    const res = await getConnectionEvidenceRpc(evidenceId, releaseId);
    evidenceLoading.delete(evidenceId);
    if (gen !== evidenceGen || activeQueryGen !== queryGen) return;

    if (res.data) {
      evidenceCache.set(evidenceId, res.data);
    } else {
      evidenceErrors.set(evidenceId, res.error || 'Unable to load edge evidence.');
    }
    renderInspector();
  }

  function handleSurprise() {
    const { visibleNodes } = getVisibleGraph();
    if (visibleNodes.length === 0 || !center) return;
    const originTestament = center.passage.book <= 39 ? 'OT' : 'NT';
    const grounded = visibleNodes.filter(
      n =>
        n.evidenceTier <= 6 &&
        n.epistemicClass !== 'interpretive_hypothesis' &&
        n.epistemicClass !== 'orthographic_similarity_only' &&
        n.epistemicClass !== 'user_note'
    );
    const pool = grounded.length > 0 ? grounded : visibleNodes;
    const crossTestament = pool.filter(n => n.passage && (n.passage.book <= 39 ? 'OT' : 'NT') !== originTestament);
    const ordered = [...crossTestament, ...pool.filter(n => !crossTestament.includes(n))];
    surpriseCursor = (surpriseCursor + 1) % ordered.length;
    const chosen = ordered[surpriseCursor]!;
    surpriseNodeId = chosen.id;
    selectNode(chosen.id);
  }

  async function expandNeighbor(node: GraphNode) {
    if (!center || node.expanded || expandingNodeId === node.id) return;
    const gen = queryGen;
    expandingNodeId = node.id;
    expandNotice = null;
    renderInspector();

    let extraConns: R10ConnectionSummary[] = [];
    const expRes = await expandBiblicalConnectionRpc(node.rpcNodeId, { limit: 6 });
    if (gen !== queryGen) {
      expandingNodeId = null;
      return;
    }

    if (expRes.data?.connections?.length) {
      extraConns = expRes.data.connections;
    } else {
      const fallback = await discoverBiblicalConnectionsRpc({
        query: node.expandQuery,
        book: node.passage?.book,
        chapter: node.passage?.chapter,
        verse: node.passage?.verse,
        limit: 6,
      });
      if (gen !== queryGen) {
        expandingNodeId = null;
        return;
      }
      if (fallback.data?.strongest_connections?.length) {
        extraConns = fallback.data.strongest_connections;
      }
    }

    expandingNodeId = null;
    node.expanded = true;

    const existingIds = new Set(graphNodes.map(n => n.id));
    let added = 0;
    const remainingSlots = Math.max(0, maxTotalNeighbors - graphNodes.length);
    const cap = Math.min(4, remainingSlots);

    for (const conn of extraConns) {
      if (added >= cap) break;
      const built = buildNeighborFromConnection(conn, center, node.id, currentResult);
      if (existingIds.has(built.node.id)) continue;
      existingIds.add(built.node.id);
      graphNodes.push(built.node);
      graphEdges.push(built.edge);
      added += 1;
    }

    expandNotice =
      added > 0
        ? `Added ${added} bounded neighbor${added === 1 ? '' : 's'} without modifying trail.`
        : 'No additional bounded neighbors available within graph cap.';
    renderAll();
  }

  async function runBridge(targetB: string) {
    if (!center) return;
    const gen = ++queryGen;
    const bridgeQuery = `${center.query} ${targetB}`.trim();
    bridgeState = {
      targetInput: targetB,
      loading: true,
      error: null,
      empty: false,
      summary: null,
    };
    renderBanners();

    const cacheKey = makeQueryCacheKey('bridge', center.passage, bridgeQuery);
    let data = queryCache.get(cacheKey);
    let err: string | null = null;
    const extraTargets = targetB
      .split(/\s*[,;|]\s*/)
      .map(s => s.trim())
      .filter(Boolean);
    const allAnchors = [center.query, ...(extraTargets.length > 0 ? extraTargets : [targetB])];

    const [res, subgraphRes] = await Promise.all([
      data
        ? Promise.resolve({ data, error: null, source: 'live' as const })
        : discoverBiblicalConnectionsRpc({
            query: bridgeQuery,
            mode: 'bridge',
            compare_targets: allAnchors,
            book: center.passage.book,
            chapter: center.passage.chapter,
            verse: center.passage.verse,
            limit: 10,
          }),
      discoverSubgraphRpc({
        anchors: allAnchors,
        max_hops: 3,
      }),
    ]);
    if (gen !== queryGen) return;
    if (!data) {
      if (res.error || !res.data) {
        err = res.error || 'Unable to search bridge path.';
      } else {
        data = res.data;
        queryCache.set(cacheKey, data);
      }
    }

    const sg = subgraphRes.data;
    if ((err || !data) && !sg) {
      bridgeState = {
        targetInput: targetB,
        loading: false,
        error: err || 'Unable to search bridge path.',
        empty: false,
        summary: null,
      };
      renderBanners();
      return;
    }

    const bridges = data?.bridges ?? [];
    const iaBridges = data?.iterative_analysis?.bridges ?? [];
    const paths = data?.connection_paths ?? [];
    const bridgeConns = data?.strongest_connections ?? [];
    const sgPaths = sg?.paths ?? [];

    const hasAnyBridge =
      bridges.length > 0 ||
      iaBridges.length > 0 ||
      paths.length > 0 ||
      bridgeConns.length > 0 ||
      sgPaths.length > 0;

    if (!hasAnyBridge) {
      bridgeState = {
        targetInput: targetB,
        loading: false,
        error: null,
        empty: true,
        summary: null,
      };
      renderBanners();
      return;
    }

    // Integrate bridge results + Steiner subgraph paths into current neighborhood graph
    const existingIds = new Set(graphNodes.map(n => n.id));
    let addedBridgeNodeId: string | null = null;

    for (const path of paths.slice(0, 3)) {
      const built = buildNeighborFromPath(path, center, data ?? null);
      if (built && !existingIds.has(built.node.id)) {
        existingIds.add(built.node.id);
        graphNodes.push(built.node);
        graphEdges.push(built.edge);
        if (!addedBridgeNodeId) addedBridgeNodeId = built.node.id;
      }
    }

    for (const conn of bridgeConns.slice(0, 3)) {
      const built = buildNeighborFromConnection(conn, center, CENTER_NODE_ID, data ?? null, true);
      if (!existingIds.has(built.node.id)) {
        existingIds.add(built.node.id);
        graphNodes.push(built.node);
        graphEdges.push(built.edge);
        if (!addedBridgeNodeId) addedBridgeNodeId = built.node.id;
      }
    }

    if (sg) {
      const sgTypedEdges = sg.edges ?? [];
      const sgBridgeNodes = (sg.steiner_bridges?.length ? sg.steiner_bridges : (sg.nodes || []).filter(n => n.is_steiner_bridge)).slice(0, 4);
      for (const sgNode of sgBridgeNodes) {
        const built = buildNeighborFromSubgraphBridge(sgNode, sgTypedEdges, center);
        if (!existingIds.has(built.node.id)) {
          existingIds.add(built.node.id);
          graphNodes.push(built.node);
          graphEdges.push(built.edge);
          if (!addedBridgeNodeId) addedBridgeNodeId = built.node.id;
        }
      }
      for (const sgEdge of sgTypedEdges.filter(e => e.evidence_id?.startsWith('v3:csr:')).slice(0, 6)) {
        const part = extractCsrPartition(sgEdge.evidence_id);
        const targetNode = graphNodes.find(n => n.rpcNodeId === sgEdge.to_node || n.rpcNodeId === sgEdge.from_node);
        if (part && targetNode && !targetNode.csrPartition) {
          targetNode.csrPartition = part;
        }
        const matchedEdge = graphEdges.find(e => e.toNodeId === targetNode?.id);
        if (part && matchedEdge && !matchedEdge.csrPartition) {
          matchedEdge.csrPartition = part;
        }
      }
    }

    const bridgeExplanation =
      sg?.summary ||
      bridges[0]?.explanation ||
      iaBridges[0]?.explanation ||
      paths[0]?.explanation ||
      bridgeConns[0]?.explanation ||
      `Found ${paths.length + bridgeConns.length + sgPaths.length} candidate bridge link(s) toward "${targetB}".`;

    bridgeState = {
      targetInput: targetB,
      loading: false,
      error: null,
      empty: false,
      summary: bridgeExplanation,
    };
    if (addedBridgeNodeId) {
      selectedNodeId = addedBridgeNodeId;
      selectedEdgeId = null;
    }
    renderAll();
  }

  async function runChallenge() {
    if (!center) return;
    const gen = ++queryGen;
    challengeState = {
      loading: true,
      error: null,
      explanation: null,
      controls: [],
    };
    renderBanners();

    const cacheKey = makeQueryCacheKey('challenge', center.passage, center.query);
    let data = queryCache.get(cacheKey);
    let err: string | null = null;

    if (!data) {
      const res = await discoverBiblicalConnectionsRpc({
        query: center.query,
        mode: 'challenge',
        book: center.passage.book,
        chapter: center.passage.chapter,
        verse: center.passage.verse,
        limit: 10,
      });
      if (gen !== queryGen) return;
      if (res.error || !res.data) {
        err = res.error || 'Unable to run challenge analysis.';
      } else {
        data = res.data;
        queryCache.set(cacheKey, data);
      }
    }

    if (err || !data) {
      challengeState = {
        loading: false,
        error: err || 'Unable to run challenge analysis.',
        explanation: null,
        controls: [],
      };
      renderBanners();
      return;
    }

    const controls = [
      ...(data.iterative_analysis?.challenges ?? []),
      ...(data.controls_and_alternatives ?? []),
    ];
    const dedupedControls: R10ControlOrWarning[] = [];
    const seenCtrl = new Set<string>();
    for (const c of controls) {
      const key = c.control_id || c.title;
      if (seenCtrl.has(key)) continue;
      seenCtrl.add(key);
      dedupedControls.push(c);
    }

    challengeState = {
      loading: false,
      error: null,
      explanation: data.iterative_analysis?.explanation ?? null,
      controls: dedupedControls,
    };
    renderBanners();
  }

  function computeLayerCounts(): Map<LayerFilterId, number> {
    const counts = new Map<LayerFilterId, number>();
    counts.set('all', graphEdges.length);
    for (const edge of graphEdges) {
      for (const layer of edge.layers) {
        counts.set(layer, (counts.get(layer) ?? 0) + 1);
      }
    }
    return counts;
  }

  function normalizeActiveFilter(counts: Map<LayerFilterId, number>) {
    if (
      isCompact &&
      activeFilter !== 'all' &&
      activeFilter !== 'hypothesis' &&
      (counts.get(activeFilter) ?? 0) === 0
    ) {
      activeFilter = 'all';
    }
  }

  function renderModeSwitcher() {
    const modes: Array<{ id: GraphLayerMode; label: string }> = [
      { id: 'algorithmic', label: 'Source & Algorithm' },
      { id: 'research', label: 'Research Graph' },
      { id: 'combined', label: 'Combined' },
    ];
    modeSwitchWrap.replaceChildren(
      ...modes.map(m => {
        const active = layerMode === m.id;
        const btn = action(
          m.label,
          () => {
            if (layerMode === m.id) return;
            layerMode = m.id;
            if (layerMode === 'algorithmic' && (activeFilter === 'rg_human' || activeFilter === 'rg_ai')) {
              activeFilter = 'all';
            }
            if (center) void loadAnchor(center, false);
            else renderAll();
          },
          `study-button discovery-graph__mode-btn${active ? ' primary is-active' : ''}`,
        );
        btn.setAttribute('aria-pressed', String(active));
        return btn;
      }),
    );
  }

  function renderFilterPills(counts: Map<LayerFilterId, number>) {
    renderModeSwitcher();
    const buttons: HTMLElement[] = [];
    for (const item of LAYER_FILTERS) {
      if (layerMode === 'algorithmic' && (item.id === 'rg_human' || item.id === 'rg_ai')) {
        continue;
      }
      const count = counts.get(item.id) ?? 0;
      if (isCompact && item.id !== 'all' && item.id !== 'hypothesis' && count === 0) {
        continue;
      }
      const isActive = activeFilter === item.id;
      const btn = action(
        `${item.label}${count > 0 || item.id === 'all' ? ` (${count})` : ''}`,
        () => {
          activeFilter = item.id;
          renderAll();
        },
        `study-button discovery-graph__filter-pill${isActive ? ' primary is-active' : ''}`
      );
      btn.setAttribute('aria-pressed', String(isActive));
      buttons.push(btn);
    }
    const langToggleBtn = action(
      originalLangMode ? 'א/α Original' : 'Abc English',
      () => {
        originalLangMode = !originalLangMode;
        renderAll();
      },
      `study-button discovery-graph__filter-pill${originalLangMode ? ' is-active' : ''}`
    );
    langToggleBtn.setAttribute('aria-pressed', String(originalLangMode));
    langToggleBtn.title = 'Toggle original Hebrew/Greek script labels on graph nodes';
    buttons.push(langToggleBtn);
    filterBar.replaceChildren(...buttons);
  }

  function renderBanners() {
    if (isCompact) {
      bannerSlot.replaceChildren();
      return;
    }
    const blocks: HTMLElement[] = [];

    if (bridgeState) {
      const box = el('div', 'discovery-graph__banner discovery-graph__bridge-banner');
      if (bridgeState.loading) {
        box.append(status(`Finding bridge between ${center?.label ?? 'anchor'} and "${bridgeState.targetInput}"…`));
      } else if (bridgeState.error) {
        box.append(el('p', 'study-muted', bridgeState.error));
      } else if (bridgeState.empty && center) {
        const msg = el('p', 'discovery-graph__banner-empty', 'No supported path found at current coverage');
        const targetText = bridgeState.targetInput;
        const parsedTarget = parseAnchorPassage(targetText);
        const toAnchor: Anchor = parsedTarget
          ? {
              kind: 'verse',
              canonicalKey: makePassageKey(parsedTarget),
              label: formatVerseRef(parsedTarget),
              passage: parsedTarget,
            }
          : {
              kind: 'concept',
              canonicalKey: `concept:${targetText.toLowerCase()}`,
              label: targetText,
            };
        const createHypBtn = action(
          'Create hypothesis',
          () => {
            if (center) callbacks.onCreateHypothesis(center.anchor, toAnchor);
          },
          'study-button'
        );
        box.append(msg, createHypBtn);
      } else if (bridgeState.summary) {
        const title = el('strong', '', `Bridge toward "${bridgeState.targetInput}": `);
        const text = document.createTextNode(bridgeState.summary);
        const p = el('p', 'discovery-graph__banner-text');
        p.append(title, text);
        box.append(p);
      }
      blocks.push(box);
    }

    if (challengeState) {
      const box = el('div', 'discovery-graph__banner discovery-graph__challenge-banner');
      if (challengeState.loading) {
        box.append(status('Checking negative controls & alternative explanations…'));
      } else if (challengeState.error) {
        box.append(el('p', 'study-muted', challengeState.error));
      } else {
        const headingEl = el('strong', '', 'Controls & Challenge Analysis');
        box.append(headingEl);
        if (challengeState.explanation) {
          box.append(el('p', 'study-muted discovery-graph__banner-sub', challengeState.explanation));
        }
        if (challengeState.controls.length === 0) {
          box.append(
            el(
              'p',
              'study-muted discovery-graph__banner-sub',
              'No additional negative controls or warnings reported for this anchor.'
            )
          );
        } else {
          const ul = el('ul', 'discovery-graph__challenge-list');
          for (const ctrl of challengeState.controls.slice(0, 6)) {
            const li = el('li', '');
            const badge = el('span', 'discover-badge is-caution', ctrl.kind.replace(/_/g, ' '));
            const title = el('strong', '', ` ${ctrl.title}: `);
            const desc = document.createTextNode(ctrl.explanation);
            li.append(badge, title, desc);
            ul.append(li);
          }
          box.append(ul);
        }
      }
      blocks.push(box);
    }

    bannerSlot.replaceChildren(...blocks);
  }

  function renderSvgAndList() {
    clearDragCleanups();

    if (!center) {
      svgWrap.replaceChildren(
        el(
          'p',
          'study-muted discovery-graph__empty',
          isCompact
            ? 'Inspect a word to map its local lexical and cross-reference neighborhood.'
            : 'Open a passage to view its local discovery neighborhood.'
        )
      );
      listWrap.replaceChildren();
      if (compactListSummary) compactListSummary.textContent = 'List view (0)';
      return;
    }

    if (loading) {
      svgWrap.replaceChildren(status('Loading local discovery neighborhood…'));
      listWrap.replaceChildren();
      if (compactListSummary) compactListSummary.textContent = 'List view (0)';
      return;
    }

    if (errorMsg) {
      const errBox = el('div', 'discovery-graph__error');
      errBox.append(
        el('p', 'study-muted', errorMsg),
        action('Retry', () => {
          if (center) void loadAnchor(center, true);
        })
      );
      svgWrap.replaceChildren(errBox);
      listWrap.replaceChildren();
      if (compactListSummary) compactListSummary.textContent = 'List view (0)';
      return;
    }

    const { visibleNodes, visibleEdges } = getVisibleGraph();
    const positions = computeRadialPositions(visibleNodes, svgLayout);
    if (compactListSummary) {
      compactListSummary.textContent = `List view (${visibleNodes.length})`;
    }

    // Build SVG deterministically
    const svg = svgEl('svg', {
      class: 'discovery-graph__svg',
      viewBox: `0 0 ${svgLayout.viewBoxW} ${svgLayout.viewBoxH}`,
      width: '100%',
      role: 'img',
      'aria-label': `Discovery neighborhood graph centered on ${center.label}`,
    });

    const defs = svgEl('defs');
    const filter = svgEl('filter', {
      id: shadowFilterId,
      x: '-20%',
      y: '-20%',
      width: '140%',
      height: '140%',
    });
    const dropShadow = svgEl('feDropShadow', {
      dx: 0,
      dy: 2,
      stdDeviation: 3,
      'flood-color': '#000000',
      'flood-opacity': 0.18,
    });
    filter.append(dropShadow);
    defs.append(filter);

    const markerSpecs: Array<{ suffix: string; fill: string }> = [
      { suffix: 'confirmed', fill: 'var(--dg-edge-confirmed, #4fd1c5)' },
      { suffix: 'inferred', fill: 'var(--dg-edge-inferred, #d7ba7e)' },
      { suffix: 'candidate', fill: 'var(--dg-edge-candidate, #a78bfa)' },
      { suffix: 'rg_human', fill: '#d97706' },
      { suffix: 'rg_ai', fill: '#10b981' },
      { suffix: 'selected', fill: 'var(--gold, #c4a36b)' },
      { suffix: 'surprise', fill: 'var(--gold-light, #ddc391)' },
    ];
    for (const spec of markerSpecs) {
      const marker = svgEl('marker', {
        id: `${markerPrefix}-${spec.suffix}`,
        viewBox: '0 0 8 7',
        refX: 7,
        refY: 3.5,
        markerWidth: 8,
        markerHeight: 7,
        markerUnits: 'userSpaceOnUse',
        orient: 'auto',
      });
      marker.append(
        svgEl('path', {
          d: 'M 0.5 0.75 L 7.5 3.5 L 0.5 6.25 z',
          fill: spec.fill,
        })
      );
      defs.append(marker);
    }
    svg.append(defs);

    if (visibleNodes.length === 0) {
      const emptyMsg = svgEl(
        'text',
        {
          x: svgLayout.centerX,
          y: svgLayout.centerY + (isCompact ? 46 : 56),
          'text-anchor': 'middle',
          fill: 'var(--muted, #98a4ac)',
          'font-size': isCompact ? 11.5 : 13,
        },
        activeFilter === 'hypothesis'
          ? 'No personal hypotheses touch this anchor yet.'
          : 'No connections match the selected layer filter.'
      );
      svg.append(emptyMsg);
    }

    // 1. Render edges (clipped cleanly outside source/target pill borders)
    for (const edge of visibleEdges) {
      const isFromCenter = edge.fromNodeId === CENTER_NODE_ID;
      const fromPos = isFromCenter
        ? { x: svgLayout.centerX, y: svgLayout.centerY }
        : positions.get(edge.fromNodeId);
      const toPos = positions.get(edge.toNodeId);
      if (!fromPos || !toPos) continue;

      const isSelected = selectedEdgeId === edge.id;
      const isSurprise = surpriseNodeId === edge.toNodeId;
      const tier = edgeVisualTier(edge);
      const stroke = tierStrokeColor(tier, isSelected, isSurprise);
      const markerKey = isSurprise ? 'surprise' : isSelected ? 'selected' : tier;

      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const dist = Math.hypot(dx, dy);
      let x1 = fromPos.x;
      let y1 = fromPos.y;
      let x2 = toPos.x;
      let y2 = toPos.y;

      if (dist > 1) {
        const ux = dx / dist;
        const uy = dy / dist;
        const fromHalfW = (isFromCenter ? svgLayout.centerW : svgLayout.pillW) / 2;
        const fromHalfH = (isFromCenter ? svgLayout.centerH : svgLayout.pillH) / 2;
        const startOffset = rectExitDistance(fromHalfW, fromHalfH, dx, dy) + 3;
        const endOffset = rectExitDistance(svgLayout.pillW / 2, svgLayout.pillH / 2, dx, dy) + 6;
        if (startOffset + endOffset < dist - 8) {
          x1 = Number((fromPos.x + ux * startOffset).toFixed(1));
          y1 = Number((fromPos.y + uy * startOffset).toFixed(1));
          x2 = Number((toPos.x - ux * endOffset).toFixed(1));
          y2 = Number((toPos.y - uy * endOffset).toFixed(1));
        }
      }

      const edgeGroup = svgEl('g', {
        class: `discovery-graph__svg-edge discovery-graph__svg-edge--${tier}${isSelected ? ' is-selected' : ''}`,
        tabindex: '0',
        role: 'button',
        'aria-label': `Edge ${edge.fromLabel} to ${edge.toLabel}, ${edge.relationLabel}, ${epistemicLabel(edge.weakestEpistemicClass)}`,
      });
      edgeGroup.append(svgEl('title', {}, `${edge.fromLabel} → ${edge.toLabel} (${edge.relationLabel})`));

      const hitLine = svgEl('line', {
        x1,
        y1,
        x2,
        y2,
        stroke: 'transparent',
        'stroke-width': 14,
      });

      const lineAttrs: Record<string, string | number> = {
        class: 'discovery-graph__svg-edge-vis',
        x1,
        y1,
        x2,
        y2,
        stroke,
        'stroke-width': isSelected ? 2.8 : isSurprise ? 2.4 : 1.8,
        'stroke-opacity': isSelected ? 1 : 0.88,
        'marker-end': `url(#${markerPrefix}-${markerKey})`,
      };
      if (tier === 'inferred') {
        lineAttrs['stroke-dasharray'] = '6 4';
      } else if (tier === 'candidate') {
        lineAttrs['stroke-dasharray'] = '2 4';
        lineAttrs['stroke-linecap'] = 'round';
      } else if (tier === 'rg_ai') {
        lineAttrs['stroke-dasharray'] = '4 3';
      }

      const visLine = svgEl('line', lineAttrs);
      edgeGroup.append(hitLine, visLine);

      const activateEdge = () => selectEdge(edge);
      edgeGroup.addEventListener('click', activateEdge);
      edgeGroup.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          activateEdge();
        }
      });

      svg.append(edgeGroup);
    }

    // 2. Render center anchor node (double-ring highlight + soft shadow/fill distinction)
    const centerGroup = svgEl('g', {
      class: 'discovery-graph__svg-center',
    });
    centerGroup.append(svgEl('title', {}, center.label));
    const outerRingW = svgLayout.centerW + 10;
    const outerRingH = svgLayout.centerH + 10;
    const centerOuterRing = svgEl('rect', {
      class: 'discovery-graph__svg-center-ring',
      x: svgLayout.centerX - outerRingW / 2,
      y: svgLayout.centerY - outerRingH / 2,
      width: outerRingW,
      height: outerRingH,
      rx: svgLayout.centerRx + 3,
      fill: 'none',
      stroke: 'var(--gold, #c4a36b)',
      'stroke-opacity': 0.45,
      'stroke-width': 1.4,
    });
    const centerRect = svgEl('rect', {
      class: 'discovery-graph__svg-center-box',
      x: svgLayout.centerX - svgLayout.centerW / 2,
      y: svgLayout.centerY - svgLayout.centerH / 2,
      width: svgLayout.centerW,
      height: svgLayout.centerH,
      rx: svgLayout.centerRx,
      fill: 'var(--soft, #e8eee5)',
      stroke: 'var(--gold, #c4a36b)',
      'stroke-width': 2.2,
      filter: `url(#${shadowFilterId})`,
    });
    const centerText = svgEl(
      'text',
      {
        class: 'discovery-graph__svg-center-label',
        x: svgLayout.centerX,
        y: svgLayout.centerY + 4,
        'text-anchor': 'middle',
        fill: 'var(--text, #e9e8e2)',
        'font-size': isCompact ? 11.5 : 13,
        'font-weight': 600,
      },
      truncateLabel(center.label, svgLayout.centerMaxChars)
    );
    centerGroup.append(centerOuterRing, centerRect, centerText);
    svg.append(centerGroup);

    // 3. Render neighbor nodes
    for (const node of visibleNodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const isSelected = selectedNodeId === node.id;
      const isSurprise = surpriseNodeId === node.id;
      const tier = nodeVisualTier(node);
      const stroke = tierStrokeColor(tier, isSelected, isSurprise);

      const nodeGroup = svgEl('g', {
        class: `discovery-graph__svg-node discovery-graph__svg-node--${tier}${isSelected ? ' is-selected' : ''}${isSurprise ? ' is-surprise' : ''}`,
        tabindex: '0',
        role: 'button',
        'aria-pressed': String(isSelected),
        'aria-label': `${node.label}, ${epistemicLabel(node.epistemicClass)}`,
      });
      nodeGroup.append(svgEl('title', {}, `${node.label} · ${epistemicLabel(node.epistemicClass)}`));

      const focusRing = svgEl('rect', {
        class: 'discovery-graph__svg-node-ring',
        x: pos.x - (svgLayout.pillW + 7) / 2,
        y: pos.y - (svgLayout.pillH + 7) / 2,
        width: svgLayout.pillW + 7,
        height: svgLayout.pillH + 7,
        rx: svgLayout.pillRx + 3,
        fill: 'none',
        stroke: isSurprise ? 'var(--gold-light, #ddc391)' : 'var(--gold, #c4a36b)',
        'stroke-width': 1.6,
        'stroke-opacity': isSelected || isSurprise ? 0.9 : 0,
      });

      const pillAttrs: Record<string, string | number> = {
        class: 'discovery-graph__svg-node-pill',
        x: pos.x - svgLayout.pillW / 2,
        y: pos.y - svgLayout.pillH / 2,
        width: svgLayout.pillW,
        height: svgLayout.pillH,
        rx: svgLayout.pillRx,
        fill: isSelected ? 'var(--accent, #1e2d38)' : 'var(--panel, #172129)',
        stroke,
        'stroke-width': isSelected || isSurprise ? 2.2 : 1.4,
      };
      if (tier === 'inferred') {
        pillAttrs['stroke-dasharray'] = '5 3';
      } else if (tier === 'candidate' || tier === 'rg_ai') {
        pillAttrs['stroke-dasharray'] = '2 3';
        pillAttrs['stroke-linecap'] = 'round';
      }
      const subDisplay =
        node.rgAuthorKind === 'ai'
          ? 'AI research'
          : node.rgAuthorKind === 'human'
            ? 'Human research'
            : epistemicLabel(node.epistemicClass);

      const pill = svgEl('rect', pillAttrs);
      const displayShort =
        originalLangMode && node.originalShortLabel ? node.originalShortLabel : node.shortLabel;
      const labelEl = svgEl(
        'text',
        {
          x: pos.x,
          y: pos.y - (isCompact ? 1.5 : 2),
          'text-anchor': 'middle',
          fill: 'var(--text, #e9e8e2)',
          'font-size': isCompact ? 10 : 11,
          'font-weight': isSelected ? 600 : 500,
        },
        truncateLabel(displayShort, svgLayout.labelMaxChars)
      );
      const subEl = svgEl(
        'text',
        {
          x: pos.x,
          y: pos.y + (isCompact ? 10 : 11),
          'text-anchor': 'middle',
          fill: 'var(--muted, #98a4ac)',
          'font-size': isCompact ? 8.2 : 9,
        },
        truncateLabel(subDisplay, svgLayout.subMaxChars)
      );
      nodeGroup.append(focusRing, pill, labelEl, subEl);

      const activateNode = () => selectNode(node.id);
      nodeGroup.addEventListener('click', activateNode);
      nodeGroup.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          activateNode();
        }
      });

      svg.append(nodeGroup);
    }

    const legendBar = buildLegendBar();
    svgWrap.replaceChildren(svg, legendBar);

    // Synchronized keyboard-accessible textual list
    const nodesSection = el('div', 'discovery-graph__list-section');
    const nodesHeading = el(
      'p',
      'eyebrow discovery-graph__list-heading',
      `NEIGHBOR NODES (${visibleNodes.length})`
    );
    const nodesList = el('ul', 'discovery-graph__node-list');

    for (const node of visibleNodes) {
      const li = el('li', '');
      const isSelected = selectedNodeId === node.id;
      const isSurprise = surpriseNodeId === node.id;
      const btn = action(
        '',
        () => selectNode(node.id),
        `study-button discovery-graph__list-item${isSelected ? ' is-selected' : ''}`
      );
      btn.setAttribute('aria-pressed', String(isSelected));
      const listDisplayLabel =
        originalLangMode && node.originalLabel ? node.originalLabel : node.label;
      const left = el('span', 'discovery-graph__list-item-label', `${isSurprise ? '★ ' : ''}${listDisplayLabel}`);
      const badge = el(
        'span',
        `discover-badge${isCautionClass(node.epistemicClass, node.evidenceTier) ? ' is-caution' : ''}`,
        epistemicLabel(node.epistemicClass)
      );
      btn.append(left, badge);

      if (options?.onRegisterDrag && node.passage) {
        const dragPassage = { ...node.passage };
        btn.setAttribute('data-drag-handle', 'true');
        dragCleanups.push(
          options.onRegisterDrag(btn, () => ({
            kind: 'verse',
            passage: dragPassage,
            label: node.anchor.label || formatVerseRef(dragPassage),
            strongs: node.anchor.strongs,
            original: node.anchor.original,
          }))
        );
      }

      li.append(btn);
      nodesList.append(li);
    }
    nodesSection.append(nodesHeading, nodesList);

    const edgesSection = el('div', 'discovery-graph__list-section');
    const edgesHeading = el(
      'p',
      'eyebrow discovery-graph__list-heading',
      `EDGES (${visibleEdges.length})`
    );
    const edgesList = el('ul', 'discovery-graph__edge-list');

    for (const edge of visibleEdges) {
      const li = el('li', '');
      const isSelected = selectedEdgeId === edge.id;
      const btn = action(
        '',
        () => selectEdge(edge),
        `study-button discovery-graph__list-item${isSelected ? ' is-selected' : ''}`
      );
      btn.setAttribute('aria-pressed', String(isSelected));
      const styleTag = edge.isDashed ? ' [dashed]' : '';
      const left = el(
        'span',
        'discovery-graph__list-item-label',
        `${edge.fromLabel} → ${edge.toLabel}${styleTag}`
      );
      const badge = el(
        'span',
        `discover-badge${isCautionClass(edge.weakestEpistemicClass, edge.evidenceTier) ? ' is-caution' : ''}`,
        edge.relationLabel
      );
      btn.append(left, badge);
      li.append(btn);
      edgesList.append(li);
    }
    edgesSection.append(edgesHeading, edgesList);

    listWrap.replaceChildren(nodesSection, edgesSection);
  }

  function renderInspector() {
    if (!center) {
      if (isCompact) {
        inspectorWrap.replaceChildren(
          el('p', 'discovery-graph__compact-hint', 'Tap any node or edge to inspect why it connects')
        );
      } else {
        inspectorWrap.replaceChildren(
          el('p', 'eyebrow', 'INSPECTOR'),
          el(
            'p',
            'study-muted',
            'Select a neighbor node or connecting edge in the graph or list to inspect its epistemic status and supporting passages.'
          )
        );
      }
      return;
    }

    if (selectedEdgeId) {
      const edge = graphEdges.find(e => e.id === selectedEdgeId);
      if (edge) {
        renderEdgeEvidenceInspector(edge);
        return;
      }
    }

    if (selectedNodeId) {
      const node = graphNodes.find(n => n.id === selectedNodeId);
      if (node) {
        renderNodeInspector(node);
        return;
      }
    }

    if (isCompact) {
      inspectorWrap.replaceChildren(
        el('p', 'discovery-graph__compact-hint', 'Tap any node or edge to inspect why it connects')
      );
      return;
    }

    inspectorWrap.replaceChildren(
      el('p', 'eyebrow', 'INSPECTOR'),
      el('p', 'study-muted', 'Select a neighbor node or connecting edge in the graph or list to inspect its epistemic status and supporting passages.')
    );
  }

  function appendV3ScoreBlock(nodes: HTMLElement[], v3?: V3ScoreMeta) {
    if (!v3) return;
    const summaryLine = el(
      'p',
      'study-muted discovery-graph__score-breakdown discovery-graph__v3-score',
      `v3 E⊥: ${v3.e_perp_bits.toFixed(2)} bits · n_eff=${v3.n_eff.toFixed(2)} · axis_factor=${v3.axis_factor.toFixed(2)} · ${v3.dominant_register.replace(/_/g, ' ')} (raw_textual=${v3.raw_textual_bits.toFixed(1)}b, physical_capped=${v3.physical_bits_capped.toFixed(1)}b, p_null≈${v3.p_null_approx.toExponential(1)})`
    );
    nodes.push(summaryLine);
    if (v3.independent_axes?.length) {
      const axesRow = el('div', 'discovery-graph__inspector-meta');
      for (const ax of v3.independent_axes.slice(0, 5)) {
        axesRow.append(
          el(
            'span',
            `discover-badge${ax.is_physical ? ' is-caution' : ''}`,
            `${ax.axis} (${ax.bits.toFixed(1)}b${ax.is_physical ? ' · phys' : ''})`
          )
        );
      }
      nodes.push(axesRow);
    }
  }

  function renderNodeInspector(node: GraphNode) {
    if (!center) return;
    const nodes: HTMLElement[] = [];
    if (!isCompact) {
      nodes.push(el('p', 'eyebrow', 'NODE INSPECTOR'));
    }

    const metaRow = el('div', 'discovery-graph__inspector-meta');
    if (surpriseNodeId === node.id) {
      metaRow.append(el('span', 'discover-badge', 'Surprise find'));
    }
    if (node.isBridgeNode) {
      metaRow.append(el('span', 'discover-badge discovery-graph__badge-pivot', 'Intermediate bridge pivot'));
    }
    if (node.csrPartition) {
      metaRow.append(el('span', 'discover-badge discovery-graph__badge-csr', `CSR: ${node.csrPartition}`));
    }
    const v3NodeMeta = node.v3Score || node.conn?.v3_score;
    if (v3NodeMeta) {
      metaRow.append(el('span', 'discover-badge discovery-graph__badge-eperp', `E⊥ ${v3NodeMeta.e_perp_bits.toFixed(1)}b · ${v3NodeMeta.n_eff.toFixed(1)} ax`));
    }
    metaRow.append(
      el(
        'span',
        `discover-badge${isCautionClass(node.epistemicClass, node.evidenceTier) ? ' is-caution' : ''}`,
        epistemicLabel(node.epistemicClass)
      )
    );
    if (!node.isHypothesis) {
      metaRow.append(el('span', 'discover-badge', `Tier ${node.evidenceTier}`));
    }
    if (node.conn?.evidence_type) {
      metaRow.append(el('span', 'discover-badge', node.conn.evidence_type.replace(/_/g, ' ')));
    }
    nodes.push(metaRow);

    const displayTitle = originalLangMode && node.originalLabel ? node.originalLabel : node.label;
    nodes.push(el('h4', 'discovery-graph__inspector-title', displayTitle));

    appendV3ScoreBlock(nodes, v3NodeMeta);

    const whyP = el('p', 'discovery-graph__inspector-why');
    whyP.append(el('strong', '', 'Why connected: '), document.createTextNode(node.why));
    nodes.push(whyP);

    // Supporting verse links with ContextPreview attach & pin
    if (node.supportingPassages.length > 0) {
      const refsLabel = el('p', 'eyebrow discovery-graph__inspector-subhead', 'SUPPORTING PASSAGES');
      const refsRow = el('div', 'discovery-graph__refs');
      for (const pRef of node.supportingPassages.slice(0, isCompact ? 5 : 8)) {
        const target = toActivePassage(pRef);
        const linkBtn = action(
          `${formatPassageLabel(pRef)} (${pRef.testament})`,
          () => {
            callbacks.preview.pin(target, node.why, pRef.end_verse);
          },
          'reference-link'
        );
        callbacks.preview.attach(linkBtn, target, node.why, pRef.end_verse);
        refsRow.append(linkBtn);
      }
      nodes.push(refsLabel, refsRow);
    }

    // Actions: Follow ->, Expand, Compare, + Hypothesis
    const actionsRow = el('div', 'discovery-graph__inspector-actions');

    const followTarget =
      node.passage ?? (node.supportingPassages[0] ? toActivePassage(node.supportingPassages[0]) : null);

    if (followTarget) {
      const connectingEdge = graphEdges.find(e => e.toNodeId === node.id);
      actionsRow.append(
        action(
          'Follow →',
          () => {
            if (!center) return;
            const edge: ConnectionEdge = {
              id: connectingEdge?.id ?? node.id,
              fromKey: center.anchor.canonicalKey,
              toKey: makePassageKey(followTarget),
              relation: connectingEdge?.predicate ?? 'connection',
              epistemicClass: node.epistemicClass,
              why: node.why,
              sourceRelease:
                connectingEdge?.sourceRelease ??
                currentResult?.evidence_release_id ??
                currentResult?.release_id,
            };
            callbacks.onFollowPassage(followTarget, edge);
            openForAnchor(node.expandQuery || formatVerseRef(followTarget), followTarget, node.label);
          },
          'study-button primary'
        )
      );
    }

    const expandBtn = action(
      expandingNodeId === node.id
        ? 'Expanding…'
        : node.expanded
          ? 'Expanded'
          : 'Expand',
      () => {
        void expandNeighbor(node);
      },
      'study-button'
    );
    expandBtn.disabled = node.expanded || expandingNodeId === node.id;
    actionsRow.append(expandBtn);

    if (followTarget) {
      actionsRow.append(
        action(
          'Compare',
          () => {
            callbacks.onComparePassage(followTarget);
          },
          'study-button'
        )
      );
    }

    actionsRow.append(
      action(
        '+ Hypothesis',
        () => {
          if (center) callbacks.onCreateHypothesis(center.anchor, node.anchor);
        },
        'study-button'
      )
    );

    nodes.push(actionsRow);

    if (expandNotice) {
      nodes.push(el('p', 'study-muted discovery-graph__inspector-notice', expandNotice));
    }

    inspectorWrap.replaceChildren(...nodes);
  }

  function renderEdgeEvidenceInspector(edge: GraphEdge) {
    const nodes: HTMLElement[] = [];
    if (!isCompact) {
      nodes.push(el('p', 'eyebrow', 'EDGE EVIDENCE INSPECTOR'));
    }

    nodes.push(el('h4', 'discovery-graph__inspector-title', `${edge.fromLabel} → ${edge.toLabel}`));

    const badgeRow = el('div', 'discovery-graph__inspector-meta');
    badgeRow.append(
      el(
        'span',
        `discover-badge${isCautionClass(edge.weakestEpistemicClass, edge.evidenceTier) ? ' is-caution' : ''}`,
        `Weakest epistemic class: ${epistemicLabel(edge.weakestEpistemicClass)}`
      ),
      el('span', 'discover-badge', edge.relationLabel)
    );
    const csrPart = edge.csrPartition || extractCsrPartition(edge.evidenceId);
    if (csrPart) {
      badgeRow.append(el('span', 'discover-badge discovery-graph__badge-csr', `CSR: ${csrPart}`));
    }
    const v3EdgeMeta = edge.v3Score || edge.conn?.v3_score;
    if (v3EdgeMeta) {
      badgeRow.append(el('span', 'discover-badge discovery-graph__badge-eperp', `E⊥ ${v3EdgeMeta.e_perp_bits.toFixed(1)}b`));
    }
    if (edge.conn?.evidence_type) {
      badgeRow.append(el('span', 'discover-badge', edge.conn.evidence_type.replace(/_/g, ' ')));
    }
    nodes.push(badgeRow);

    appendV3ScoreBlock(nodes, v3EdgeMeta);

    if (edge.conn?.score_breakdown) {
      const sb = edge.conn.score_breakdown;
      const sbP = el(
        'p',
        'study-muted discovery-graph__score-breakdown',
        `R13.1 Score: ${sb.final} (E=${sb.E.toFixed(2)} F=${sb.F.toFixed(2)} P=${sb.P.toFixed(2)} I=${sb.I.toFixed(2)} R=${sb.R.toFixed(2)} N=${sb.N.toFixed(2)} U=${sb.U.toFixed(2)} RRF=${sb.rrf.toFixed(2)})`
      );
      nodes.push(sbP);
    }

    const whyP = el('p', 'discovery-graph__inspector-why');
    whyP.append(el('strong', '', 'Why connected: '), document.createTextNode(edge.why));
    nodes.push(whyP);

    nodes.push(
      el(
        'p',
        'study-muted discovery-graph__multihop-notice',
        'Epistemic notice: Multi-hop steps document intermediate corpus links and do not automatically prove endpoint equivalence or authorial intent.'
      )
    );

    if (edge.rgClaim) {
      const rg = edge.rgClaim;
      const metaRow = el('div', 'discovery-graph__inspector-meta');
      metaRow.append(
        el(
          'span',
          `discover-badge ${rg.author_kind === 'ai' ? 'discovery-graph__rg-badge-ai' : 'discovery-graph__rg-badge-human'}`,
          rg.author_kind === 'ai' ? `AI Research · ${rg.ai_model || rg.author_display_name}` : `Human Research · ${rg.author_display_name}`,
        ),
        el('span', 'discover-badge', rg.evidence_class),
        el('span', 'discover-badge', rg.review_status),
        ...(rg.is_potentially_stale ? [el('span', 'discover-badge discovery-graph__rg-stale', 'Potentially Stale')] : []),
      );
      nodes.push(
        metaRow,
        el('p', 'discovery-graph__inspector-why', rg.assertion_text),
        el('p', 'study-muted', `Relationship meaning: "${rg.predicate_label}" (${rg.is_transitive ? 'transitive' : 'non-transitive'}). Scope: ${rg.contextual_scope || 'Cross-corpus'}.`),
        ...(rg.limitations ? [el('p', 'study-muted', `Limitations: ${rg.limitations}`)] : []),
      );

      const trace = rgTraceCache.get(rg.claim_id);
      if (rgTraceLoading.has(rg.claim_id)) {
        nodes.push(status('Tracing primary witness evidence…'));
      } else if (trace) {
        nodes.push(
          el('p', 'study-muted', `Primary witnesses: ${trace.independent_primary_witness_count} independent (${trace.primary_witnesses.length} total)`),
        );
        if (trace.shared_upstream_warnings.length > 0) {
          nodes.push(el('p', 'study-muted', `Warning: ${trace.shared_upstream_warnings[0]!.warning}`));
        }
        if (trace.challenges.length > 0) {
          nodes.push(el('p', 'study-muted', `Open challenges: ${trace.challenges.length} — "${trace.challenges[0]!.title}"`));
        }
      }

      const rgActRow = el('div', 'discovery-graph__rg-actions');
      rgActRow.append(
        action('Confirm', async () => {
          await BibleRPC.graph.reviewClaim(rg.claim_id, 'confirmed', { clearStale: true });
          rgTraceCache.delete(rg.claim_id);
          callbacks.onRefreshResearchGraph?.();
          if (center) void loadAnchor(center, true);
        }, 'study-button discovery-graph__btn'),
        action('Dispute', async () => {
          await BibleRPC.graph.reviewClaim(rg.claim_id, 'disputed', { clearStale: false });
          rgTraceCache.delete(rg.claim_id);
          callbacks.onRefreshResearchGraph?.();
          if (center) void loadAnchor(center, true);
        }, 'study-button discovery-graph__btn'),
      );
      if (callbacks.onOpenClaimComposer) {
        rgActRow.append(
          action('Challenge…', () => {
            callbacks.onOpenClaimComposer?.({
              mode: 'challenge',
              targetClaim: { id: rg.claim_id, title: rg.title, object_ref: rg.neighbor_key },
            });
          }, 'study-button discovery-graph__btn'),
          action('Supersede…', () => {
            callbacks.onOpenClaimComposer?.({
              mode: 'supersede',
              targetClaim: { id: rg.claim_id, title: rg.title, object_ref: rg.neighbor_key },
            });
          }, 'study-button discovery-graph__btn'),
        );
      }
      nodes.push(rgActRow);
      inspectorWrap.replaceChildren(...nodes);
      return;
    }

    if (edge.hypothesis) {
      nodes.push(
        el(
          'p',
          'study-muted',
          'User-created hypothesis (stored separately from verified corpus evidence; no external dataset provenance).'
        )
      );
      inspectorWrap.replaceChildren(...nodes);
      return;
    }

    if (!edge.evidenceId) {
      nodes.push(el('p', 'study-muted', 'No underlying evidence record ID is attached to this edge.'));
      inspectorWrap.replaceChildren(...nodes);
      return;
    }

    if (evidenceLoading.has(edge.evidenceId)) {
      nodes.push(status('Loading source dataset & limitations…'));
      inspectorWrap.replaceChildren(...nodes);
      return;
    }

    const evErr = evidenceErrors.get(edge.evidenceId);
    if (evErr) {
      nodes.push(
        el('p', 'study-muted', evErr),
        action('Retry evidence', () => {
          if (edge.evidenceId) void loadEdgeEvidence(edge.evidenceId, edge.sourceRelease);
        })
      );
      inspectorWrap.replaceChildren(...nodes);
      return;
    }

    const evData = evidenceCache.get(edge.evidenceId);
    if (!evData || !evData.evidence) {
      nodes.push(el('p', 'study-muted', 'Detailed dataset provenance is unavailable for this edge.'));
      inspectorWrap.replaceChildren(...nodes);
      return;
    }

    const ev = evData.evidence;
    if (Array.isArray(evData.passage_details) && evData.passage_details.length > 0) {
      const pdHead = el('p', 'eyebrow discovery-graph__inspector-subhead', 'ORIGINAL-LANGUAGE WITNESSES');
      const pdList = el('div', 'discovery-graph__witness-details');
      for (const pd of evData.passage_details.slice(0, 4)) {
        const refText = pd.passage?.ref || '';
        const highlighted = (pd.original_tokens || []).filter(t => t.is_highlighted);
        const row = el('p', 'discovery-graph__witness-line');
        const tokSummary =
          highlighted.length > 0
            ? highlighted.map(t => `${t.surface} (${t.strongs || ''}${t.gloss ? ` "${t.gloss}"` : ''})`).join(', ')
            : (pd.original_tokens || [])
                .slice(0, 5)
                .map(t => `${t.surface} (${t.strongs || ''})`)
                .join(' ');
        row.append(
          el('strong', '', `${refText}: `),
          document.createTextNode(`${tokSummary}${pd.english_text ? ` — ${truncateLabel(pd.english_text, 78)}` : ''}`)
        );
        pdList.append(row);
      }
      nodes.push(pdHead, pdList);
    }
    if (ev.provenance?.source_dataset) {
      const provP = el('p', 'discovery-graph__provenance');
      provP.append(
        el('strong', '', 'Source dataset: '),
        document.createTextNode(
          `${ev.provenance.source_dataset} (${ev.provenance.license}) · ${ev.provenance.derivation_method}`
        )
      );
      nodes.push(provP);
    }

    const limitations = [...(ev.limitations ?? [])];
    if (edge.conn?.uncertainty_note && !limitations.includes(edge.conn.uncertainty_note)) {
      limitations.push(edge.conn.uncertainty_note);
    }
    if (edge.path?.limitations) {
      for (const l of edge.path.limitations) {
        if (!limitations.includes(l)) limitations.push(l);
      }
    }

    nodes.push(el('strong', 'discovery-graph__limitations-title', 'Limitations'));
    if (limitations.length > 0) {
      const ul = el('ul', 'discover-evidence-limitations discovery-graph__limitations-list');
      for (const item of limitations) {
        ul.append(el('li', '', item));
      }
      nodes.push(ul);
    } else {
      nodes.push(el('p', 'study-muted', 'No additional limitations recorded.'));
    }

    inspectorWrap.replaceChildren(...nodes);
  }

  function renderAll() {
    if (center) {
      anchorTitle.textContent = center.label;
    }
    const counts = computeLayerCounts();
    normalizeActiveFilter(counts);

    const { visibleNodes } = getVisibleGraph();
    surpriseBtn.disabled = !center || loading || visibleNodes.length === 0;
    challengeBtn.disabled = !center || loading;
    bridgeSubmit.disabled = !center || loading;
    expandFullBtn.disabled = !center || loading;

    renderFilterPills(counts);
    renderBanners();
    renderSvgAndList();
    renderInspector();
  }

  async function loadAnchor(
    targetCenter: CenterState,
    bypassCache = false,
    openOptions?: DiscoveryGraphOpenOptions
  ) {
    if (destroyed) return;
    const gen = ++queryGen;
    center = targetCenter;
    element.hidden = false;
    setCollapsed(false);
    errorMsg = null;
    expandNotice = null;
    expandingNodeId = null;
    bridgeState = null;
    challengeState = null;
    if (openOptions?.layerMode) {
      layerMode = openOptions.layerMode;
    }
    if (openOptions?.initialFilter) {
      activeFilter = openOptions.initialFilter;
    }
    selectedNodeId = openOptions?.preserveSelection?.nodeId ?? null;
    selectedEdgeId = openOptions?.preserveSelection?.edgeId ?? null;
    surpriseNodeId = null;
    surpriseCursor = -1;

    const cacheKey = makeQueryCacheKey('discover', targetCenter.passage, targetCenter.query);
    if (!bypassCache && openOptions?.seedResult) {
      queryCache.set(cacheKey, openOptions.seedResult);
    }

    async function loadRgForCenter(tc: CenterState): Promise<RgNeighborhoodResponse | null> {
      if (layerMode === 'algorithmic') return null;
      let res = await BibleRPC.graph.expandNeighborhood(tc.query, 'both', {}, 20, 0);
      if ((!res.data?.edges?.length) && tc.query !== formatVerseRef(tc.passage)) {
        res = await BibleRPC.graph.expandNeighborhood(formatVerseRef(tc.passage), 'both', {}, 20, 0);
      }
      return res.data ?? null;
    }

    if (!bypassCache && layerMode === 'algorithmic') {
      const cached = queryCache.get(cacheKey);
      if (cached) {
        currentResult = cached;
        currentRgNeighborhood = null;
        loading = false;
        rebuildGraphFromResult(cached);
        if (selectedEdgeId) {
          const preservedEdge = graphEdges.find(e => e.id === selectedEdgeId);
          if (
            preservedEdge?.evidenceId &&
            !evidenceCache.get(preservedEdge.evidenceId) &&
            !evidenceLoading.has(preservedEdge.evidenceId)
          ) {
            void loadEdgeEvidence(preservedEdge.evidenceId, preservedEdge.sourceRelease);
          }
        }
        renderAll();
        return;
      }
    }

    currentResult = null;
    currentRgNeighborhood = null;
    graphNodes = [];
    graphEdges = [];
    loading = true;
    renderAll();

    const [res, rgData] = await Promise.all([
      layerMode === 'research'
        ? Promise.resolve({ data: null as DiscoverConnectionsResult | null, error: null as string | null })
        : discoverBiblicalConnectionsRpc({
            query: targetCenter.query,
            book: targetCenter.passage.book,
            chapter: targetCenter.passage.chapter,
            verse: targetCenter.passage.verse,
            limit: 12,
          }),
      loadRgForCenter(targetCenter),
    ]);

    if (gen !== queryGen || destroyed) return;
    loading = false;
    currentRgNeighborhood = rgData;

    if (layerMode !== 'research' && (res.error || !res.data)) {
      errorMsg = res.error || 'Unable to load discovery neighborhood.';
      currentResult = null;
      rebuildGraphFromResult(null);
    } else {
      if (res.data) queryCache.set(cacheKey, res.data);
      currentResult = res.data ?? null;
      rebuildGraphFromResult(currentResult);
    }
    renderAll();
  }

  function openForAnchor(
    query: string,
    passage: ActivePassage,
    label?: string,
    openOptions?: DiscoveryGraphOpenOptions
  ) {
    if (destroyed) return;
    const cleanQuery = query.trim() || formatVerseRef(passage);
    const cleanLabel = label?.trim() || formatVerseRef(passage);
    const nextCenter: CenterState = {
      query: cleanQuery,
      passage: { ...passage },
      label: cleanLabel,
      anchor: buildCenterAnchor(cleanQuery, passage, cleanLabel),
    };
    void loadAnchor(nextCenter, false, openOptions);
  }

  function expand() {
    if (destroyed) return;
    element.hidden = false;
    setCollapsed(false);
    if (center && !loading) {
      if (!currentResult && !errorMsg) {
        void loadAnchor(center);
      } else {
        syncHypothesesFromState();
        renderAll();
      }
    }
  }

  function close() {
    queryGen += 1;
    evidenceGen += 1;
    loading = false;
    expandingNodeId = null;
    clearDragCleanups();
    if (activePopupDialog?.open) {
      activePopupDialog.close();
    }
    if (options?.defaultOpen && !isCompact) {
      setCollapsed(true);
    } else {
      element.hidden = true;
    }
    callbacks.preview.dismiss();
  }

  function isOpen(): boolean {
    return !element.hidden && !collapsed;
  }

  function toggle(passage: ActivePassage) {
    if (isOpen() && center && isSamePassage(center.passage, passage)) {
      close();
      return;
    }
    openForAnchor(formatVerseRef(passage), passage);
  }

  if (options?.defaultOpen) {
    renderAll();
  }

  let initialSubscribe = true;
  const unsubscribeState = explorationState.subscribe(() => {
    if (initialSubscribe) {
      initialSubscribe = false;
      return;
    }
    if (destroyed || !isOpen() || !center || loading) return;
    syncHypothesesFromState();
    renderAll();
  });

  function destroy() {
    destroyed = true;
    unsubscribeState();
    close();
  }

  return {
    element,
    openForAnchor,
    toggle,
    isOpen,
    close,
    expand,
    reload: () => {
      if (center && !destroyed) void loadAnchor(center, true);
    },
    destroy,
  };
}
