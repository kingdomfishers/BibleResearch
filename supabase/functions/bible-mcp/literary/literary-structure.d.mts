/** Evidence-bearing ordered events; single edition per invocation. */
export interface LiteraryEvent {
  id: string;
  key: string;
  wordIds: string[];
  features: string[];
}
export interface AlignmentOptions {
  gapOpen?: number;
  gapExtend?: number;
  linearGap?: number | null;
  minSimilarity?: number;
  mismatchPenalty?: number;
  featureWeights?: Record<string, number> | null;
}
export interface AlignmentPair { a: number | null; b: number | null; similarity: number }
export interface LiteraryDeviation {
  kind: 'omission' | 'addition' | 'substitution' | 'feature_addition' | 'reordering' | 'emerging_motif';
  unit: number;
  column: number;
  expectedColumn?: number;
  expected: string | null;
  observed: string | null;
  peerSupport: number;
  peerCount: number;
  surprisalBits: number;
  witnessIds: string[];
  beforeId?: string | null;
  afterId?: string | null;
}
export interface TemplateColumn {
  index: number;
  key: string;
  role?: 'core' | 'optional' | 'variable' | 'repeated' | 'emerging' | 'rare';
  support: number;
  eventIds: (string | null)[];
  alternatives: string[];
}
export interface LiteraryTemplate {
  unitEventIds: string[][];
  columns: TemplateColumn[];
  deviations: LiteraryDeviation[];
  compressionProxy: number;
  mdlBits?: number;
  mdlSavingsBits?: number;
}
export interface DiscoveredTemplate extends LiteraryTemplate {
  anchorKeys: string[];
  anchorSide: 'start' | 'end';
  coverage: number;
  score: number;
  unassignedEventIds: string[];
}
export interface ChiasmResult {
  kind: 'candidate_literary_pattern';
  patternKind?: 'chiasm';
  gapped?: boolean;
  start: number;
  endExclusive: number;
  pairs: { leftId: string; rightId: string; similarity: number }[];
  centerIds: string[];
  reverseMean: number;
  forwardMean: number;
  pValue?: number;
  mdlGainBits?: number;
  score: number;
}
export interface PeltSegment {
  start: number;
  end: number;
  dominantLabel: string;
}
export interface PeltOptions {
  penalty?: number;
  penaltyScale?: number;
  minSegmentLength?: number;
}
export interface PeltResult {
  changepoints: number[];
  segments: PeltSegment[];
  totalCost: number;
}
export function eventSimilarity(a: LiteraryEvent, b: LiteraryEvent, featureWeights?: Record<string, number> | null): number;
export function alignSequences(a: LiteraryEvent[], b: LiteraryEvent[], local?: boolean, options?: AlignmentOptions): { score: number; pairs: AlignmentPair[] };
export function induceTemplate(units: LiteraryEvent[][], options?: AlignmentOptions): LiteraryTemplate;
export function repeatedPhrases(events: LiteraryEvent[], options?: { maxLen?: number; limit?: number; maxEvents?: number }): { keys: string[]; starts: number[]; occurrences: string[][]; score: number }[];
export function discoverTemplates(events: LiteraryEvent[], options?: AlignmentOptions & { limit?: number; candidateBoundaries?: { cuts: number[]; anchorKeys?: string[]; anchorSide?: 'start' | 'end' }[] }): DiscoveredTemplate[];
export function discoverChiasms(events: LiteraryEvent[], options?: { maxArm?: number; limit?: number; minSimilarity?: number; allowGapped?: boolean; maxWindow?: number; gapPenalty?: number; idfMap?: ReadonlyMap<string, number>; featureWeights?: Record<string, number> | null; permutations?: number; pThreshold?: number; requireThreePairs?: boolean }): ChiasmResult[];
export function detectPeltChangepoints(labels: string[], options?: PeltOptions): PeltResult;
export function detectNoveltyBoundaries(featureSets: ReadonlyMap<string, number>[], options?: { halfKernel?: number }): { index: number; novelty: number }[];
