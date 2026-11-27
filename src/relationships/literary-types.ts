// @file: src/relationships/literary-types.ts
// Shared types for the multi-edition Literary Structure Discovery Engine (Browser, Worker, MCP).

import type { CanonicalEpistemicClass } from './epistemic-taxonomy.ts';

export type LiteraryEdition = 'hbo' | 'grc_lxx' | 'grc_nt';

export type EvidenceChannel =
  | 'exact_form'
  | 'resolved_lemma'
  | 'broad_strongs'
  | 'orthographic'
  | 'grammatical'
  | 'semantic'
  | 'interpretive_hypothesis';

export type EpistemicClass = CanonicalEpistemicClass | 'attested_textual_wordplay';

export interface LiteraryToken {
  id: string; // `${edition}:${verseId}:${pos}`
  edition: LiteraryEdition;
  wordId: number;
  verseId: number;
  book: number;
  chapter: number;
  verse: number;
  ref: string;
  pos: number;
  index: number;
  surfaceForm: string;
  transliteration: string;
  gloss: string;
  strongs: string;
  lemmaKey: string; // disambiguated STEP lemma_key or explicit broad fallback
  lemmaSource: 'occurrence' | 'strongs_fallback' | 'lxx_form';
  lemmaScript: string;
  consonantal: string;
  grammarCode: string;
  posClass: string;
  person: string | null;
  number: string | null;
  gender: string | null;
  stem: string | null;
  mood: string | null;
  cantillation: string | null;
  masoreticBreak: 'P' | 'S' | null;
  isFunctionWord: boolean;
  isEndOfVerse: boolean;
}

export interface LiteraryClauseFrame {
  id: string;
  verseId: number;
  ref: string;
  startPos: number;
  endPos: number;
  startIndex: number;
  endIndex: number;
  predicateLemma: string;
  predicateStrongs: string;
  predicateScript: string;
  predicateWordId: string | null;
  predicatePerson: string | null;
  predicateMood: string | null;
  subjectLemmas: string[];
  objectLemmas: string[];
  modifierPairs: {
    headWordId: string;
    modifierWordId: string;
    headStrongs: string;
    modifierStrongs: string;
    modifierForm: string;
    modifierLemma: string;
    sourceNode: string;
  }[];
  clauseType: 'speech_opener' | 'command' | 'fulfillment' | 'evaluation' | 'naming' | 'blessing' | 'closing' | 'narrative' | 'declaration';
  isDirectSpeech: boolean;
  wordIds: string[];
  sourceNodeId?: string;
}

export interface LiterarySubunit {
  id: string;
  kind: string;
  label: string;
  fromRef: string;
  toRef: string;
  wordIds: string[];
  clauseIds: string[];
  summary: string;
}

export interface LiteraryUnit {
  index: number;
  label: string;
  fromRef: string;
  toRef: string;
  fromTokenIndex: number;
  toTokenIndex: number;
  verseIds: number[];
  subunits: LiterarySubunit[];
}

export interface LiterarySection {
  role: 'introduction' | 'unit_sequence' | 'transition' | 'conclusion';
  label: string;
  fromRef: string;
  toRef: string;
  verseIds: number[];
  rationale: string;
}

export interface SegmentationCandidate {
  id: string;
  anchorKeys: string[];
  anchorText: string;
  anchorSide: 'start' | 'end' | 'multi';
  signals: string[];
  sections: LiterarySection[];
  units: LiteraryUnit[];
  introduction: { fromRef: string; toRef: string; verseIds: number[]; rationale: string } | null;
  conclusion: {
    fromRef: string;
    toRef: string;
    verseIds: number[];
    droppedTemplateSlots: string[];
    retainedMotifs: string[];
    newPredicates: string[];
    transformationSummary: string;
  } | null;
  coverage: number;
  mdlSavingsBits: number;
  score: number;
  confidence: number;
  epistemicClass: EpistemicClass;
}

export interface TemplateSlotCell {
  unitIndex: number;
  present: boolean;
  key: string | null;
  wordIds: string[];
  ref: string | null;
  text: string;
  isDeviant: boolean;
  deviationKind?: string;
}

export interface SlotAtom {
  senseId: string;
  verbStem: string;
  govObjectOrVerbClass: string;
  idiomKey?: string;
  isIdiom?: boolean;
  valence?: -1 | 0 | 1;
}

export interface ReconstructedTemplateSlot {
  columnIndex: number;
  label: string;
  canonicalKey: string;
  slotAtom?: SlotAtom;
  columnSurprisalBits?: number;
  role: 'core' | 'optional' | 'variable' | 'repeated' | 'emerging' | 'rare';
  support: number;
  cells: TemplateSlotCell[];
}

export interface LiteraryDeviationItem {
  id: string;
  kind:
    | 'omission'
    | 'addition'
    | 'substitution'
    | 'reordering'
    | 'intensification'
    | 'person_shift'
    | 'role_shift'
    | 'emerging_motif'
    | 'conclusion_transformation';
  unitIndex: number;
  unitLabel: string;
  ref: string;
  expected: string | null;
  observed: string | null;
  description: string;
  surprisalBits: number;
  confidence: number;
  evidenceChannel: EvidenceChannel;
  epistemicClass: EpistemicClass;
  witnessWordIds: string[];
  anchorBeforeWordId?: string | null;
  anchorAfterWordId?: string | null;
  uncertaintyNote?: string;
}

export interface CrossUnitCorrespondence {
  unitA: number;
  unitB: number;
  labelA: string;
  labelB: string;
  score: number;
  sharedLexemes: { strongs: string; lemma: string; gloss: string; wordIdsA: string[]; wordIdsB: string[] }[];
  sharedConcepts: string[];
  evidenceChannel: EvidenceChannel;
}

export interface CommandFulfillmentLink {
  unitIndex: number | null;
  commandRef: string;
  fulfillmentRef: string;
  commandWordIds: string[];
  fulfillmentWordIds: string[];
  sharedLemmas: string[];
  explicitFormula: boolean;
  kind: 'explicit_fulfillment_formula' | 'predicate_echo' | 'object_echo';
}

export interface SymmetryPattern {
  id: string;
  kind: 'chiasm' | 'concentric' | 'inclusio' | 'forward_parallelism' | 'antithetical_parallelism' | 'progressive_parallelism';
  level: 'token' | 'clause' | 'unit';
  gapped: boolean;
  fromRef: string;
  toRef: string;
  pairs: {
    label: string;
    leftRef: string;
    rightRef: string;
    leftText: string;
    rightText: string;
    leftWordIds: string[];
    rightWordIds: string[];
    similarity: number;
    evidenceChannel: EvidenceChannel;
  }[];
  center?: { ref: string; text: string; wordIds: string[] } | null;
  reverseMean: number;
  forwardMean: number;
  score: number;
  confidence: number;
  pValue?: number | null;
  mdlGainBits?: number | null;
  alternativeExplanation: string | null;
  epistemicClass: EpistemicClass;
}

export interface WordplayFinding {
  id: string;
  epistemicClass: 'attested_textual_wordplay' | 'documented_lexical_relationship' | 'orthographic_similarity_only';
  overlapKind: string;
  sharedConsonants: string;
  wordA: {
    id: string;
    ref: string;
    form: string;
    transliteration: string;
    gloss: string;
    strongs: string;
    lemma: string;
    matchedCharIndices: number[];
  };
  wordB: {
    id: string;
    ref: string;
    form: string;
    transliteration: string;
    gloss: string;
    strongs: string;
    lemma: string;
    matchedCharIndices: number[];
  };
  distanceTokens: number;
  inLiteraryContext: boolean;
  contextCues: string[];
  shiftSummary?: string;
  matchChannel?: string;
  valenceContrast?: { properValence: -1 | 0 | 1; targetValence: -1 | 0 | 1 };
  score: number;
  confidence: number;
  etymologyDisclaimer: string;
}

export interface SpeakerSegment {
  startVerseIndex: number;
  endVerseIndex: number;
  fromRef: string;
  toRef: string;
  dominantLabel: string;
}

export interface KeyWordDistribution {
  strongs: string;
  lemmaKey: string;
  script: string;
  transliteration: string;
  gloss: string;
  count: number;
  unitCounts: number[];
  verseRefs: string[];
  wordIds: string[];
  idfSalience: number;
  isNotableCount: boolean;
  notableCountLabel?: string;
}

export interface AcrosticFinding {
  id: string;
  mode: 'verse_initial' | 'half_verse_atnach' | 'multi_verse_stanza';
  stanzaSize: number;
  lettersCovered: number;
  totalLetters: 22;
  coverageRatio: number;
  entries: { letter: string; expectedLetter: string; ref: string; wordId: string; form: string; matched: boolean }[];
  missingLetters: string[];
  confidence: number;
  epistemicClass: EpistemicClass;
}

export interface ThematicCluster {
  id: string;
  themeLabel: string;
  source: 'r13_motif' | 'r13_concept' | 'predicate_role_frame';
  lemmas: { strongs: string; script: string; gloss: string; count: number }[];
  wordIds: string[];
  refs: string[];
  unitIndices: number[];
  score: number;
  evidenceChannel: EvidenceChannel;
}

export interface LxxEditionComparison {
  lxxBookNo: number;
  mappedVerses: number;
  versificationNotes: { mtRef: string; lxxRef: string; mappingKind: string }[];
  divergences: {
    kind: 'lxx_formula_addition' | 'lxx_formula_omission' | 'length_divergence' | 'versification_shift' | 'lexical_theological_shift';
    mtRef: string;
    lxxRef: string;
    description: string;
    mtExcerpt?: string;
    lxxExcerpt?: string;
  }[];
  lxxTokenCount: number;
}

export interface LiteraryAnalysisOptions {
  detail?: 'compact' | 'standard' | 'deep';
  categories?: string[];
  compareLxx?: boolean;
  includeAlternatives?: boolean;
  minStrength?: number;
  maxDepth?: number;
}

export type LiteraryPatternCategory =
  | 'template_function'
  | 'unit'
  | 'symmetry'
  | 'deviation'
  | 'wordplay'
  | 'keyword'
  | 'thematic'
  | 'acrostic'
  | 'nested';

export interface LiteraryPatternSpan {
  spanId: string;
  ref: string;
  fromTokenIndex: number;
  toTokenIndex: number;
  wordIds: string[];
  text: string;
  gloss: string;
  unitIndex: number | null;
  role?: string;
  hasDeviation: boolean;
  deviationKind?: string;
  deviationNote?: string;
  deviationIds?: string[];
  nestedDepth: number;
}

export interface LiteraryPatternFamily {
  id: string;
  category: LiteraryPatternCategory;
  label: string;
  description: string;
  colorSlot: number;
  priority: 'primary' | 'secondary' | 'exploratory';
  defaultVisible: boolean;
  evidenceChannel: EvidenceChannel;
  epistemicClass: EpistemicClass;
  spans: LiteraryPatternSpan[];
}

export interface LiteraryAnalysisResult {
  schemaVersion: 1;
  passage: string;
  edition: LiteraryEdition;
  tokenCount: number;
  verseCount: number;
  tokens: LiteraryToken[];
  segmentation: SegmentationCandidate | null;
  alternativeSegmentations: SegmentationCandidate[];
  template: {
    slots: ReconstructedTemplateSlot[];
    mdlSavingsBits: number;
    compressionProxy: number;
  } | null;
  patternFamilies: LiteraryPatternFamily[];
  deviations: LiteraryDeviationItem[];
  correspondences: CrossUnitCorrespondence[];
  commandFulfillments: CommandFulfillmentLink[];
  symmetries: SymmetryPattern[];
  wordplays: WordplayFinding[];
  keyWords: KeyWordDistribution[];
  acrostics: AcrosticFinding[];
  thematicClusters: ThematicCluster[];
  speakerShifts: { ref: string; prevPerson: string; nextPerson: string; wordId: string; form: string; kind: string }[];
  speakerSegments?: SpeakerSegment[];
  peltChangepoints?: number[];
  lxxComparison: LxxEditionComparison | null;
  coverage: {
    syntaxVerses: number;
    totalVerses: number;
    syntaxComplete: boolean;
    truncated: boolean;
  };
  limitations: string[];
}
