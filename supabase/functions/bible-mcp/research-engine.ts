// Pure Web/Deno TypeScript module: declarative, zero-eval composable
// query and calculation engine for bible-mcp `research`.
// Zero Node-only imports; all relative imports include .ts extensions.

import * as z from 'zod';
import type { DatabaseQuery, DatabaseReader } from './catalog.ts';
import {
  expandPassageRefs,
  formatRef,
  isPassageLike,
  parsePassageString,
  type ParsedPassage,
} from './bible-ref.ts';
import { computeGematria, type GematriaResult } from './gematria.ts';
import {
  queryMcpFeastsCalendar,
  queryMcpGenealogy,
  queryMcpPlaces,
  queryMcpSacredArchitecture,
  queryMcpTribeLineage,
} from './context-atlas.ts';
import { NOTE_SECURITY_NOTICE, formatCompactNote } from './notes-tools.ts';
import { executeKgResearchOp } from './research-graph-tools.ts';
import {
  cleanTransliteration,
  isFunctionWord,
  normalizeDiscoveryConnection,
  verifyWordRowAlignment,
  type CompactConnection,
} from './word-model.ts';
import { analyzeLiteraryPassage, type R13CorpusContext, type ShardVerseInput } from './literary/literary-engine.ts';
import type { LiteraryAnalysisOptions } from './literary/literary-types.ts';
import {
  defaultLiteraryPackBaseUrl,
  loadLiteraryVersesFromPack,
  normalizePassageCoords,
} from './literary/literary-pack-loader.ts';

const VIEW_DETAIL_ALIASES = [
  'clues',
  'clue',
  'evidence',
  'full',
  'concise',
  'compact',
  'standard',
  'summary',
  'deep',
] as const;

type ViewDetailAlias = (typeof VIEW_DETAIL_ALIASES)[number];

const CommonOpControlFields = {
  limit: z.number().int().min(1).max(100).optional(),
  view: z.enum(VIEW_DETAIL_ALIASES).optional(),
  detail: z.enum(VIEW_DETAIL_ALIASES).optional(),
};

export const ResearchOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('evidence'),
    id: z.string().trim().min(1).max(64).optional(),
    evidence_id: z.string().trim().min(1).max(220),
    release_id: z.string().trim().min(1).max(64).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('occurrences'),
    id: z.string().trim().min(1).max(64).optional(),
    word: z.string().trim().min(1).max(128),
    testament: z.enum(['OT', 'NT']).optional(),
    book: z.number().int().min(1).max(66).optional(),
    expand_family: z.boolean().optional(),
    ...CommonOpControlFields,
    offset: z.number().int().min(0).max(10000).optional(),
  }),
  z.strictObject({
    op: z.literal('intersect_words'),
    id: z.string().trim().min(1).max(64).optional(),
    words: z.array(z.string().trim().min(1).max(128)).min(2).max(5),
    window: z.number().int().min(0).max(3).optional().default(0),
    testament: z.enum(['OT', 'NT']).optional(),
    book: z.number().int().min(1).max(66).optional(),
    expand_family: z.boolean().optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('grammar_search'),
    id: z.string().trim().min(1).max(64).optional(),
    word: z.string().trim().min(1).max(128).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    ref: z.string().trim().min(1).max(160).optional(),
    predicates: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
    direction: z.enum(['both', 'outgoing', 'incoming']).optional(),
    include_syntax_tree: z.boolean().optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('lxx'),
    id: z.string().trim().min(1).max(64).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    ref: z.string().trim().min(1).max(160).optional(),
    word: z.string().trim().min(1).max(128).optional(),
    mode: z.enum(['compare', 'passage', 'translations', 'alignments']).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('gematria'),
    id: z.string().trim().min(1).max(64).optional(),
    terms: z.array(z.string().trim().min(1).max(128)).min(1).max(10),
    find_matches: z.boolean().optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('numbers'),
    id: z.string().trim().min(1).max(64).optional(),
    number: z.number().finite().optional(),
    query: z.string().trim().min(1).max(160).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('chronology_occurrences'),
    id: z.string().trim().min(1).max(64).optional(),
    word: z.string().trim().min(1).max(128).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    ref: z.string().trim().min(1).max(160).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('geography_search'),
    id: z.string().trim().min(1).max(64).optional(),
    place: z.string().trim().min(1).max(128),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('passage_compare'),
    id: z.string().trim().min(1).max(64).optional(),
    passages: z.array(z.string().trim().min(1).max(160)).min(2).max(4),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('notes_search'),
    id: z.string().trim().min(1).max(64).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    ref: z.string().trim().min(1).max(160).optional(),
    word: z.string().trim().min(1).max(128).optional(),
    include_dlm: z.boolean().optional(),
    include_kg: z.boolean().optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('set_combine'),
    id: z.string().trim().min(1).max(64).optional(),
    combine: z.enum(['intersect', 'union', 'difference']).optional().default('intersect'),
    refs: z.array(z.string().trim().min(1).max(64)).min(1).max(16).optional(),
    include: z.array(z.string().trim().min(1).max(64)).min(1).max(8).optional(),
    exclude: z.array(z.string().trim().min(1).max(64)).max(8).optional(),
    testament: z.enum(['OT', 'NT', 'ALL']).optional(),
    book: z.number().int().min(1).max(66).optional(),
    mode: z.enum(['intersect', 'ranked']).optional(),
    hydrate_verses: z.boolean().optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('genealogy'),
    id: z.string().trim().min(1).max(64).optional(),
    person: z.string().trim().min(1).max(128).optional(),
    strongs: z.string().trim().min(1).max(24).optional(),
    passage: z.string().trim().min(1).max(64).optional(),
    generations: z.number().int().min(1).max(2).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('tribe_lineage'),
    id: z.string().trim().min(1).max(64).optional(),
    query: z.string().trim().min(1).max(128).optional(),
    strongs: z.string().trim().min(1).max(24).optional(),
    branch: z.string().trim().min(1).max(48).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('sacred_architecture'),
    id: z.string().trim().min(1).max(64).optional(),
    plan: z.string().trim().min(1).max(32).optional(),
    element: z.string().trim().min(1).max(128).optional(),
    strongs: z.string().trim().min(1).max(24).optional(),
    passage: z.string().trim().min(1).max(64).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('feasts_calendar'),
    id: z.string().trim().min(1).max(64).optional(),
    feast: z.string().trim().min(1).max(128).optional(),
    strongs: z.string().trim().min(1).max(24).optional(),
    gregorian_year: z.number().int().min(1900).max(2200).optional(),
    tradition: z.enum(['israel', 'diaspora']).optional(),
    omer_rule: z.enum(['rabbinic_nisan_16', 'boethusian_sunday']).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('discover_patterns'),
    id: z.string().trim().min(1).max(64).optional(),
    query: z.string().trim().min(1).max(400),
    concepts: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
    mode: z.enum(['discover', 'expand', 'bridge', 'compare', 'explain', 'challenge']).optional(),
    evidence_types: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
    include_orthographic: z.boolean().optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('compare_patterns'),
    id: z.string().trim().min(1).max(64).optional(),
    targets: z.array(z.string().trim().min(1).max(120)).min(2).max(4),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('trace_evidence'),
    id: z.string().trim().min(1).max(64).optional(),
    evidence_id: z.string().trim().min(1).max(220).optional(),
    expand_id: z.string().trim().min(1).max(220).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    ref: z.string().trim().min(1).max(160).optional(),
    query: z.string().trim().min(1).max(220).optional(),
    verse_id: z.number().int().positive().optional(),
    from: z.string().trim().min(1).max(120).optional(),
    to: z.string().trim().min(1).max(120).optional(),
    max_hops: z.number().int().min(1).max(4).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('literary_structure'),
    id: z.string().trim().min(1).max(64).optional(),
    passage: z.string().trim().min(1).max(160),
    categories: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    compare_lxx: z.boolean().optional(),
    include_alternatives: z.boolean().optional(),
    min_strength: z.number().min(0).max(1).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('lxx_concordance'),
    id: z.string().trim().min(1).max(64).optional(),
    word: z.string().trim().min(1).max(128).optional(),
    strongs: z.string().trim().min(1).max(24).optional(),
    lemma: z.string().trim().min(1).max(128).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    ref: z.string().trim().min(1).max(160).optional(),
    shift_type: z.string().trim().min(1).max(64).optional(),
    offset: z.number().int().min(0).max(10000).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('tri_textual_diff'),
    id: z.string().trim().min(1).max(64).optional(),
    target: z.string().trim().min(1).max(160).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    ref: z.string().trim().min(1).max(160).optional(),
    source: z.string().trim().min(1).max(160).optional(),
    sources: z.array(z.string().trim().min(1).max(160)).max(6).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('clause_role_query'),
    id: z.string().trim().min(1).max(64).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    ref: z.string().trim().min(1).max(160).optional(),
    predicate: z.string().trim().min(1).max(64).optional(),
    subject: z.string().trim().min(1).max(64).optional(),
    object: z.string().trim().min(1).max(64).optional(),
    polarity: z.enum(['POS', 'NEG', 'POSITIVE', 'NEGATIVE']).optional(),
    concept: z.string().trim().min(1).max(80).optional(),
    concepts: z.array(z.string().trim().min(1).max(80)).max(6).optional(),
    idiom_only: z.boolean().optional(),
    include: z.array(z.string().trim().min(1).max(64)).max(6).optional(),
    exclude: z.array(z.string().trim().min(1).max(64)).max(6).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('sequence_parallels'),
    id: z.string().trim().min(1).max(64).optional(),
    source: z.string().trim().min(1).max(160).optional(),
    target: z.string().trim().min(1).max(160).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    ref: z.string().trim().min(1).max(160).optional(),
    targets: z.array(z.string().trim().min(1).max(160)).min(2).max(2).optional(),
    permutations: z.number().int().min(8).max(128).optional(),
    switch_penalty: z.number().min(0.1).max(10).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('wordplay_scan'),
    id: z.string().trim().min(1).max(64).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    ref: z.string().trim().min(1).max(160).optional(),
    a: z.string().trim().min(1).max(128).optional(),
    b: z.string().trim().min(1).max(128).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('expand_clue'),
    id: z.string().trim().min(1).max(64).optional(),
    expand_id: z.string().trim().min(1).max(220),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('kg_search'),
    id: z.string().trim().min(1).max(64).optional(),
    query: z.string().trim().min(1).max(400).optional(),
    author_kind: z.enum(['human', 'ai']).optional(),
    evidence_class: z.string().trim().max(40).optional(),
    review_status: z.string().trim().max(32).optional(),
    epistemic_state: z.string().trim().max(48).optional(),
    predicate: z.string().trim().max(64).optional(),
    claim_kind: z.string().trim().max(48).optional(),
    node_kind: z.string().trim().max(48).optional(),
    is_potentially_stale: z.boolean().optional(),
    include_superseded: z.boolean().optional(),
    offset: z.number().int().min(0).max(5000).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('kg_dossier'),
    id: z.string().trim().min(1).max(64).optional(),
    node_ref: z.string().trim().min(1).max(160).optional(),
    query: z.string().trim().min(1).max(160).optional(),
    word: z.string().trim().min(1).max(160).optional(),
    include_stale: z.boolean().optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('kg_neighbors'),
    id: z.string().trim().min(1).max(64).optional(),
    node_ref: z.string().trim().min(1).max(160).optional(),
    query: z.string().trim().min(1).max(160).optional(),
    word: z.string().trim().min(1).max(160).optional(),
    direction: z.enum(['both', 'outgoing', 'incoming']).optional(),
    author_kind: z.enum(['human', 'ai']).optional(),
    evidence_class: z.string().trim().max(40).optional(),
    review_status: z.string().trim().max(32).optional(),
    predicate: z.string().trim().max(64).optional(),
    offset: z.number().int().min(0).max(5000).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('kg_paths'),
    id: z.string().trim().min(1).max(64).optional(),
    from: z.string().trim().min(1).max(160).optional(),
    to: z.string().trim().min(1).max(160).optional(),
    from_refs: z.array(z.string().trim().min(1).max(160)).min(1).max(6).optional(),
    to_refs: z.array(z.string().trim().min(1).max(160)).min(1).max(6).optional(),
    max_hops: z.number().int().min(1).max(4).optional(),
    mode: z.enum(['source_only', 'algorithm_only', 'research_only', 'combined']).optional(),
    author_kind: z.enum(['human', 'ai']).optional(),
    evidence_class: z.string().trim().max(40).optional(),
    review_status: z.string().trim().max(32).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('kg_trace'),
    id: z.string().trim().min(1).max(64).optional(),
    claim_id: z.string().trim().min(1).max(64).optional(),
    evidence_id: z.string().trim().min(1).max(220).optional(),
    max_hops: z.number().int().min(1).max(6).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('kg_contradictions'),
    id: z.string().trim().min(1).max(64).optional(),
    node_ref: z.string().trim().min(1).max(160).optional(),
    query: z.string().trim().min(1).max(160).optional(),
    claim_id: z.string().trim().min(1).max(64).optional(),
    ...CommonOpControlFields,
  }),
  z.strictObject({
    op: z.literal('kg_trail'),
    id: z.string().trim().min(1).max(64).optional(),
    trail_ref: z.string().trim().min(1).max(160).optional(),
    query: z.string().trim().min(1).max(160).optional(),
    status: z.enum(['active', 'paused', 'completed', 'archived']).optional(),
    ...CommonOpControlFields,
  }),
]);

export type ResearchOp =
  | { op: 'evidence'; id?: string; evidence_id: string; release_id?: string; limit?: number; view?: ViewDetailAlias; detail?: ViewDetailAlias }
  | { op: 'occurrences'; id?: string; word: string; testament?: 'OT' | 'NT'; book?: number; expand_family?: boolean; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number; offset?: number }
  | { op: 'intersect_words'; id?: string; words: string[]; window?: number; testament?: 'OT' | 'NT'; book?: number; expand_family?: boolean; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'grammar_search'; id?: string; word?: string; passage?: string; predicates?: string[]; direction?: 'both' | 'outgoing' | 'incoming'; include_syntax_tree?: boolean; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'lxx'; id?: string; passage?: string; word?: string; mode?: 'compare' | 'passage' | 'translations' | 'alignments'; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'gematria'; id?: string; terms: string[]; find_matches?: boolean; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'numbers'; id?: string; number?: number; query?: string; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'chronology_occurrences'; id?: string; word?: string; passage?: string; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'geography_search'; id?: string; place: string; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'passage_compare'; id?: string; passages: string[]; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'notes_search'; id?: string; passage?: string; word?: string; include_dlm?: boolean; include_kg?: boolean; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'set_combine'; id?: string; combine?: 'intersect' | 'union' | 'difference'; refs?: string[]; include?: string[]; exclude?: string[]; testament?: 'OT' | 'NT' | 'ALL'; book?: number; mode?: 'intersect' | 'ranked'; hydrate_verses?: boolean; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'genealogy'; id?: string; person?: string; strongs?: string; passage?: string; generations?: number; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'tribe_lineage'; id?: string; query?: string; strongs?: string; branch?: string; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'sacred_architecture'; id?: string; plan?: string; element?: string; strongs?: string; passage?: string; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'feasts_calendar'; id?: string; feast?: string; strongs?: string; gregorian_year?: number; tradition?: 'israel' | 'diaspora'; omer_rule?: 'rabbinic_nisan_16' | 'boethusian_sunday'; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'discover_patterns'; id?: string; query: string; concepts?: string[]; mode?: 'discover' | 'expand' | 'bridge' | 'compare' | 'explain' | 'challenge'; evidence_types?: string[]; include_orthographic?: boolean; limit?: number; detail?: ViewDetailAlias; view?: ViewDetailAlias }
  | { op: 'compare_patterns'; id?: string; targets: string[]; limit?: number; detail?: ViewDetailAlias; view?: ViewDetailAlias }
  | { op: 'trace_evidence'; id?: string; evidence_id?: string; expand_id?: string; passage?: string; verse_id?: number; from?: string; to?: string; max_hops?: number; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'literary_structure'; id?: string; passage: string; detail?: ViewDetailAlias; view?: ViewDetailAlias; categories?: string[]; compare_lxx?: boolean; include_alternatives?: boolean; min_strength?: number; limit?: number }
  | { op: 'lxx_concordance'; id?: string; word?: string; strongs?: string; lemma?: string; passage?: string; shift_type?: string; limit?: number; offset?: number; view?: ViewDetailAlias; detail?: ViewDetailAlias }
  | { op: 'tri_textual_diff'; id?: string; target?: string; passage?: string; source?: string; sources?: string[]; view?: ViewDetailAlias; detail?: ViewDetailAlias; limit?: number }
  | { op: 'clause_role_query'; id?: string; passage?: string; predicate?: string; subject?: string; object?: string; polarity?: 'POS' | 'NEG' | 'POSITIVE' | 'NEGATIVE'; concept?: string; concepts?: string[]; idiom_only?: boolean; include?: string[]; exclude?: string[]; limit?: number; view?: ViewDetailAlias; detail?: ViewDetailAlias }
  | { op: 'sequence_parallels'; id?: string; source?: string; target?: string; passage?: string; targets?: string[]; permutations?: number; switch_penalty?: number; view?: ViewDetailAlias; detail?: ViewDetailAlias; limit?: number }
  | { op: 'wordplay_scan'; id?: string; passage?: string; a?: string; b?: string; view?: ViewDetailAlias; detail?: ViewDetailAlias; limit?: number }
  | { op: 'expand_clue'; id?: string; expand_id: string; detail?: ViewDetailAlias; view?: ViewDetailAlias; limit?: number }
  | { op: 'kg_search'; id?: string; query?: string; author_kind?: 'human' | 'ai'; evidence_class?: string; review_status?: string; epistemic_state?: string; predicate?: string; claim_kind?: string; node_kind?: string; is_potentially_stale?: boolean; include_superseded?: boolean; offset?: number; limit?: number; view?: ViewDetailAlias; detail?: ViewDetailAlias }
  | { op: 'kg_dossier'; id?: string; node_ref?: string; query?: string; word?: string; include_stale?: boolean; limit?: number; view?: ViewDetailAlias; detail?: ViewDetailAlias }
  | { op: 'kg_neighbors'; id?: string; node_ref?: string; query?: string; word?: string; direction?: 'both' | 'outgoing' | 'incoming'; author_kind?: 'human' | 'ai'; evidence_class?: string; review_status?: string; predicate?: string; offset?: number; limit?: number; view?: ViewDetailAlias; detail?: ViewDetailAlias }
  | { op: 'kg_paths'; id?: string; from?: string; to?: string; from_refs?: string[]; to_refs?: string[]; max_hops?: number; mode?: 'source_only' | 'algorithm_only' | 'research_only' | 'combined'; author_kind?: 'human' | 'ai'; evidence_class?: string; review_status?: string; limit?: number; view?: ViewDetailAlias; detail?: ViewDetailAlias }
  | { op: 'kg_trace'; id?: string; claim_id?: string; evidence_id?: string; max_hops?: number; limit?: number; view?: ViewDetailAlias; detail?: ViewDetailAlias }
  | { op: 'kg_contradictions'; id?: string; node_ref?: string; query?: string; claim_id?: string; limit?: number; view?: ViewDetailAlias; detail?: ViewDetailAlias }
  | { op: 'kg_trail'; id?: string; trail_ref?: string; query?: string; status?: 'active' | 'paused' | 'completed' | 'archived'; limit?: number; view?: ViewDetailAlias; detail?: ViewDetailAlias };

const OperationsBatchSchema = z.array(ResearchOpSchema).min(1).max(8);

// Connector-friendly flat schema (avoids `oneOf` rejection in strict external JSON Schema connectors while `executeResearch` enforces full per-op validation via `ResearchOpSchema`).
export const ResearchOpInputSchema = z.object({
  op: z.enum([
    'evidence',
    'occurrences',
    'intersect_words',
    'grammar_search',
    'lxx',
    'gematria',
    'numbers',
    'chronology_occurrences',
    'geography_search',
    'passage_compare',
    'notes_search',
    'set_combine',
    'genealogy',
    'tribe_lineage',
    'sacred_architecture',
    'feasts_calendar',
    'discover_patterns',
    'compare_patterns',
    'trace_evidence',
    'literary_structure',
    'lxx_concordance',
    'tri_textual_diff',
    'clause_role_query',
    'sequence_parallels',
    'wordplay_scan',
    'expand_clue',
    'kg_search',
    'kg_dossier',
    'kg_neighbors',
    'kg_paths',
    'kg_trace',
    'kg_contradictions',
    'kg_trail',
  ]),
  id: z.string().trim().min(1).max(64).optional(),
  passage: z.string().trim().min(1).max(160).optional(),
  ref: z.string().trim().min(1).max(160).optional(),
  detail: z.enum(VIEW_DETAIL_ALIASES).optional(),
  categories: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  compare_lxx: z.boolean().optional(),
  include_alternatives: z.boolean().optional(),
  min_strength: z.number().min(0).max(1).optional(),
  evidence_id: z.string().trim().min(1).max(220).optional(),
  expand_id: z.string().trim().min(1).max(220).optional(),
  verse_id: z.number().int().positive().optional(),
  release_id: z.string().trim().min(1).max(64).optional(),
  word: z.string().trim().min(1).max(128).optional(),
  lemma: z.string().trim().min(1).max(128).optional(),
  shift_type: z.string().trim().min(1).max(64).optional(),
  words: z.array(z.string().trim().min(1).max(128)).min(2).max(5).optional(),
  testament: z.enum(['OT', 'NT', 'ALL']).optional(),
  book: z.number().int().min(1).max(66).optional(),
  expand_family: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(10000).optional(),
  window: z.number().int().min(0).max(3).optional(),
  predicates: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
  direction: z.enum(['both', 'outgoing', 'incoming']).optional(),
  include_syntax_tree: z.boolean().optional(),
  mode: z.string().trim().min(1).max(32).optional(),
  terms: z.array(z.string().trim().min(1).max(128)).min(1).max(10).optional(),
  find_matches: z.boolean().optional(),
  number: z.number().finite().optional(),
  query: z.string().trim().min(1).max(400).optional(),
  place: z.string().trim().min(1).max(128).optional(),
  passages: z.array(z.string().trim().min(1).max(160)).min(2).max(4).optional(),
  include_dlm: z.boolean().optional(),
  combine: z.enum(['intersect', 'union', 'difference']).optional(),
  refs: z.array(z.string().trim().min(1).max(64)).min(1).max(16).optional(),
  include: z.array(z.string().trim().min(1).max(64)).min(1).max(8).optional(),
  exclude: z.array(z.string().trim().min(1).max(64)).max(8).optional(),
  hydrate_verses: z.boolean().optional(),
  person: z.string().trim().min(1).max(128).optional(),
  strongs: z.union([
    z.string().trim().min(1).max(120),
    z.array(z.string().trim().min(1).max(128)).min(1).max(5),
  ]).optional(),
  generations: z.number().int().min(1).max(2).optional(),
  branch: z.string().trim().min(1).max(48).optional(),
  plan: z.string().trim().min(1).max(32).optional(),
  element: z.string().trim().min(1).max(128).optional(),
  feast: z.string().trim().min(1).max(128).optional(),
  gregorian_year: z.number().int().min(1900).max(2200).optional(),
  tradition: z.enum(['israel', 'diaspora']).optional(),
  omer_rule: z.enum(['rabbinic_nisan_16', 'boethusian_sunday']).optional(),
  concepts: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  concept: z.string().trim().min(1).max(80).optional(),
  evidence_types: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
  include_orthographic: z.boolean().optional(),
  targets: z.array(z.string().trim().min(1).max(160)).min(2).max(4).optional(),
  target: z.string().trim().min(1).max(160).optional(),
  source: z.string().trim().min(1).max(160).optional(),
  sources: z.array(z.string().trim().min(1).max(160)).max(6).optional(),
  predicate: z.string().trim().min(1).max(64).optional(),
  subject: z.string().trim().min(1).max(64).optional(),
  object: z.string().trim().min(1).max(64).optional(),
  polarity: z.enum(['POS', 'NEG', 'POSITIVE', 'NEGATIVE']).optional(),
  idiom_only: z.boolean().optional(),
  permutations: z.number().int().min(8).max(128).optional(),
  switch_penalty: z.number().min(0.1).max(10).optional(),
  a: z.string().trim().min(1).max(128).optional(),
  b: z.string().trim().min(1).max(128).optional(),
  view: z.enum(VIEW_DETAIL_ALIASES).optional(),
  from: z.string().trim().min(1).max(160).optional(),
  to: z.string().trim().min(1).max(160).optional(),
  max_hops: z.number().int().min(1).max(6).optional(),
  node_ref: z.string().trim().min(1).max(160).optional(),
  from_refs: z.array(z.string().trim().min(1).max(160)).min(1).max(6).optional(),
  to_refs: z.array(z.string().trim().min(1).max(160)).min(1).max(6).optional(),
  claim_id: z.string().trim().min(1).max(64).optional(),
  trail_ref: z.string().trim().min(1).max(160).optional(),
  author_kind: z.enum(['human', 'ai']).optional(),
  evidence_class: z.string().trim().max(40).optional(),
  review_status: z.string().trim().max(32).optional(),
  epistemic_state: z.string().trim().max(48).optional(),
  claim_kind: z.string().trim().max(48).optional(),
  node_kind: z.string().trim().max(48).optional(),
  is_potentially_stale: z.boolean().optional(),
  include_superseded: z.boolean().optional(),
  include_stale: z.boolean().optional(),
  status: z.enum(['active', 'paused', 'completed', 'archived']).optional(),
});

interface OpContext {
  read: DatabaseReader;
  defaultLimit: number;
  view: 'clues' | 'evidence' | 'full';
  verseIdStore: Map<string, number[]>;
}

interface ResolvedWord {
  query: string;
  strongs: string;
  lemmaKey: string;
  wordId: number | null;
  lemma: string;
  gloss: string;
  raw: Record<string, unknown> | null;
}

interface WordProfileVids {
  strongs: string;
  totalVerses: number;
  allVids: number[];
  vidBookMap: Map<number, number>;
  bookDistribution: Record<string, number>;
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function asArray(val: unknown): unknown[] {
  return Array.isArray(val) ? val : [];
}

function firstNonEmpty(...vals: unknown[]): string {
  for (const val of vals) {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function clampLimit(val: number | undefined, fallback: number, max = 50): number {
  const n = typeof val === 'number' && Number.isFinite(val) ? Math.trunc(val) : fallback;
  return Math.max(1, Math.min(n, max));
}

function trimText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  const collapsed = val.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  return collapsed.length <= maxLen
    ? collapsed
    : `${collapsed.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

async function callRpc(
  read: DatabaseReader,
  name: string,
  args: Record<string, unknown>,
  limit = 20,
  offset = 0,
): Promise<Record<string, unknown>[]> {
  const res = await read({
    name: name as DatabaseQuery['name'],
    args,
    limit,
    offset,
  });
  return Array.isArray(res.rows) ? res.rows : [];
}

function extractFirstObject(rows: Record<string, unknown>[]): Record<string, unknown> | null {
  return rows.length > 0 ? asRecord(rows[0]) : null;
}

function extractRowsOrField(rows: Record<string, unknown>[], ...fields: string[]): Record<string, unknown>[] {
  if (rows.length === 0) return [];
  const first = asRecord(rows[0]);
  if (first) {
    for (const field of fields) {
      if (Array.isArray(first[field])) {
        return (first[field] as unknown[])
          .map((item) => asRecord(item))
          .filter((item): item is Record<string, unknown> => item !== null);
      }
    }
  }
  return rows;
}

const CANONICAL_BOOK_VID_RANGES: ReadonlyArray<readonly [number, number]> = [
  [1, 1533], [1534, 2746], [2747, 3605], [3606, 4893], [4894, 5852], [5853, 6510], [6511, 7128], [7129, 7213],
  [7214, 8023], [8024, 8718], [8719, 9534], [9535, 10253], [10254, 11195], [11196, 12017], [12018, 12297], [12298, 12703],
  [12704, 12870], [12871, 13940], [13941, 16517], [16518, 17432], [17433, 17654], [17655, 17771], [17772, 19063], [19064, 20427],
  [20428, 20581], [20582, 21854], [21855, 22211], [22212, 22408], [22409, 22481], [22482, 22627], [22628, 22648], [22649, 22696],
  [22697, 22801], [22802, 22848], [22849, 22904], [22905, 22957], [22958, 22995], [22996, 23206], [23207, 23261], [23262, 24329],
  [24330, 25002], [25003, 26151], [26152, 27029], [27030, 28032], [28033, 28464], [28465, 28901], [28902, 29157], [29158, 29306],
  [29307, 29461], [29462, 29565], [29566, 29660], [29661, 29749], [29750, 29796], [29797, 29909], [29910, 29992], [29993, 30038],
  [30039, 30063], [30064, 30366], [30367, 30474], [30475, 30579], [30580, 30640], [30641, 30745], [30746, 30758], [30759, 30773],
  [30774, 30798], [30799, 31203],
];

function inferBookFromVid(vid: number, vidBookMap?: Map<number, number>): number | null {
  if (vidBookMap && vidBookMap.has(vid)) {
    return vidBookMap.get(vid) ?? null;
  }
  if (vid >= 1 && vid <= 31203) {
    let lo = 0;
    let hi = CANONICAL_BOOK_VID_RANGES.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [start, end] = CANONICAL_BOOK_VID_RANGES[mid];
      if (vid < start) hi = mid - 1;
      else if (vid > end) lo = mid + 1;
      else return mid + 1;
    }
  }
  if (vid >= 1_000_000) {
    const book = Math.floor(vid / 1_000_000);
    if (book >= 1 && book <= 66) return book;
  }
  return null;
}

function matchesBookOrTestament(
  book: number | null,
  filterBook?: number,
  testament?: 'OT' | 'NT',
): boolean {
  if (book === null) return false;
  if (filterBook !== undefined && book !== filterBook) return false;
  if (testament === 'OT' && (book < 1 || book > 39)) return false;
  if (testament === 'NT' && (book < 40 || book > 66)) return false;
  return true;
}

function padStrongs(raw: string): string {
  const m = /^([HG])0*(\d+)[A-Z]*$/i.exec(raw.trim());
  return m ? `${m[1].toUpperCase()}${m[2].padStart(4, '0')}` : raw.trim().toUpperCase();
}

const RESEARCH_STOPWORD_STRONGS = new Set([
  'H3605', 'G3956', 'H1961', 'G1096', 'H7200', 'G1492', 'G3708', 'H8147', 'G1417',
  'H0559', 'G3004', 'G2036', 'H0834', 'H3588', 'H5921', 'H0413', 'H4480', 'H0376',
  'G2532', 'G0846', 'G3588', 'G1722', 'G1519', 'H3068', 'G2962', 'H0853', 'H5973',
]);

function stripHebrewGreekMarks(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0591-\u05C7\u0300-\u036F]/g, '')
    .replace(/[^\u05D0-\u05EA\u0370-\u03FF]/g, '')
    .toLowerCase();
}

function tokenLexicalMatchesSurface(surfaceTok: Record<string, unknown>, lexTok: Record<string, unknown>): boolean {
  const bs = padStrongs(firstNonEmpty(lexTok.strongs, lexTok.strongs_id));
  const gloss = firstNonEmpty(surfaceTok.gloss).toLowerCase();
  if (bs === 'H0853' && gloss.includes('(et)')) return true;
  if (bs === 'H3068' && /yahweh|lord/.test(gloss)) return true;
  const s = stripHebrewGreekMarks(firstNonEmpty(surfaceTok.surface, surfaceTok.form));
  const l = stripHebrewGreekMarks(firstNonEmpty(lexTok.lemma, lexTok.lexical_form));
  if (!s || !l) return false;
  if (l.length >= 2 && (s.includes(l) || l.includes(s))) return true;
  const sStem = s.replace(/^[והבכלמש]{1,2}/, '');
  if (sStem.length >= 2 && l.length >= 2 && (sStem.includes(l) || l.includes(sStem))) return true;
  const weak = new Set(['א', 'ה', 'ו', 'י']);
  const sCons = [...(sStem || s)].filter(c => !weak.has(c));
  const lCons = [...l].filter(c => !weak.has(c));
  if (sCons.length >= 2 && lCons.length >= 2) {
    const sSet = new Set(sCons);
    const shared = lCons.filter(c => sSet.has(c)).length;
    if (shared >= Math.min(2, lCons.length)) return true;
  }
  return false;
}

/**
 * Repair 1-token left-shifted lexical metadata caused when a verse token list drops a
 * position (e.g., 1 Kgs 19:4 skipping pos 10 or 2 Chr 33:16 starting at pos 2).
 */
function alignVerseTokens(tokens: Record<string, unknown>[]): Record<string, unknown>[] {
  if (tokens.length < 3) return tokens;
  let shiftStart = -1;
  const firstPos = Number(tokens[0].position ?? tokens[0].pos ?? 1);
  if (Number.isInteger(firstPos) && firstPos > 1) {
    shiftStart = 0;
  } else {
    for (let i = 1; i < tokens.length; i++) {
      const prevPos = Number(tokens[i - 1].position ?? tokens[i - 1].pos ?? i);
      const curPos = Number(tokens[i].position ?? tokens[i].pos ?? (i + 1));
      if (Number.isInteger(prevPos) && Number.isInteger(curPos) && curPos - prevPos > 1) {
        shiftStart = i;
        break;
      }
    }
  }
  if (shiftStart < 0 || shiftStart >= tokens.length - 1) return tokens;

  let alignedMatches = 0;
  let shiftedMatches = 0;
  for (let j = shiftStart + 1; j < tokens.length; j++) {
    if (tokenLexicalMatchesSurface(tokens[j], tokens[j])) alignedMatches++;
    if (tokenLexicalMatchesSurface(tokens[j], tokens[j - 1])) shiftedMatches++;
  }
  if (shiftedMatches < alignedMatches + 2) return tokens;

  const repaired = tokens.map(t => ({ ...t }));
  for (let j = tokens.length - 1; j >= shiftStart + 1; j--) {
    const src = tokens[j - 1];
    repaired[j].lemma = src.lemma;
    repaired[j].lemma_key = src.lemma_key;
    repaired[j].strongs = src.strongs;
    repaired[j].strongs_id = src.strongs_id;
    repaired[j].all_strongs = src.all_strongs;
    repaired[j].word_id = src.word_id;
    repaired[j].sense_id = src.sense_id;
    repaired[j].concept_id = src.concept_id;
    repaired[j].pos_class = src.pos_class;
  }
  delete repaired[shiftStart].lemma;
  delete repaired[shiftStart].lemma_key;
  delete repaired[shiftStart].strongs;
  delete repaired[shiftStart].strongs_id;
  delete repaired[shiftStart].all_strongs;
  delete repaired[shiftStart].word_id;
  delete repaired[shiftStart].sense_id;
  delete repaired[shiftStart].concept_id;
  return repaired;
}

function formatResearchVerse(
  v: Record<string, unknown>,
  compact: boolean,
  focusStrongs?: Set<string>,
  fallbackGlossByStrongs?: Map<string, string>,
): Record<string, unknown> {
  if (!compact) return v;
  const rawTokens = asArray(v.words ?? v.tokens)
    .map(t => asRecord(t))
    .filter((t): t is Record<string, unknown> => t !== null);
  const tokens = alignVerseTokens(rawTokens);
  const original = firstNonEmpty(
    v.original,
    tokens.map(t => firstNonEmpty(t.surface, t.form)).filter(Boolean).join(' '),
  );
  const matchedTokens = focusStrongs && focusStrongs.size > 0
    ? tokens
        .filter(t => {
          const bs = padStrongs(firstNonEmpty(t.strongs, t.strongs_id));
          if (bs && focusStrongs.has(bs)) return true;
          return asArray(t.all_strongs).some(s => focusStrongs.has(padStrongs(String(s || ''))));
        })
        .map(t => {
          const primaryBs = padStrongs(firstNonEmpty(t.strongs, t.strongs_id));
          const bs = (primaryBs && focusStrongs.has(primaryBs))
            ? primaryBs
            : asArray(t.all_strongs).map(s => padStrongs(String(s || ''))).find(s => focusStrongs.has(s)) || primaryBs;
          return {
            pos: t.position ?? t.pos,
            form: firstNonEmpty(t.surface, t.form),
            strongs: bs,
            gloss: firstNonEmpty(t.gloss, fallbackGlossByStrongs?.get(bs)),
          };
        })
    : undefined;
  return {
    verse_id: v.verse_id,
    ...(typeof v.book === 'number' ? { book: v.book } : {}),
    ...(typeof v.chapter === 'number' ? { chapter: v.chapter } : {}),
    ...(typeof v.verse === 'number' ? { verse: v.verse } : {}),
    ref: firstNonEmpty(v.ref),
    ...(v.mt_ref ? { mt_ref: v.mt_ref } : {}),
    original,
    english: firstNonEmpty(v.web, v.english),
    ...(matchedTokens && matchedTokens.length > 0 ? { matched_tokens: matchedTokens } : {}),
  };
}

function normalizePointedHebrewForMatch(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\u0591-\u05AF\u05AB\u05BC\u05BD\u05BF\u05C0\u05C3-\u05C6]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildResearchTranslitVariants(raw: string): string[] {
  const q = raw.trim().toLowerCase();
  if (!/^[a-z\s\-']+$/.test(q) || q.length < 3) return [];
  const out = new Set<string>();
  if (q.includes('y')) out.add(q.replace(/y/g, 'u'));
  if (q.includes('u')) out.add(q.replace(/u/g, 'y'));
  if (q.includes('ch')) out.add(q.replace(/ch/g, 'kh'));
  if (q.includes('ph')) out.add(q.replace(/ph/g, 'f'));
  if (q.includes('oo')) out.add(q.replace(/oo/g, 'o'));
  return [...out];
}

async function resolveWordCandidatesFast(read: DatabaseReader, word: string): Promise<ResolvedWord[]> {
  const rows = await callRpc(read, 'resolve_fast_lookup_v1', { query: word, limit: 12 }, 1, 0);
  let candidates = extractRowsOrField(rows, 'matches', 'candidates', 'results', 'items');
  if (candidates.length === 0) {
    for (const variant of buildResearchTranslitVariants(word)) {
      const vRows = await callRpc(read, 'resolve_fast_lookup_v1', { query: variant, limit: 8 }, 1, 0);
      const vCands = extractRowsOrField(vRows, 'matches', 'candidates', 'results', 'items');
      if (vCands.length > 0) {
        candidates = vCands;
        break;
      }
    }
  }
  if (candidates.length > 1 && /[\u05B0-\u05C7]/.test(word)) {
    const target = normalizePointedHebrewForMatch(word);
    const exact = candidates.filter(m => normalizePointedHebrewForMatch(firstNonEmpty(m.sc, m.lemma)) === target);
    const rest = candidates.filter(m => normalizePointedHebrewForMatch(firstNonEmpty(m.sc, m.lemma)) !== target);
    if (exact.length > 0) candidates = [...exact, ...rest];
  }
  const resolved: ResolvedWord[] = [];
  const seenBs = new Set<string>();
  for (const match of candidates) {
    const strongs = firstNonEmpty(match.bs, match.strongs, match.extended_strongs, match.strongs_id).toUpperCase();
    const lemmaKey = firstNonEmpty(match.lk, match.lemma_key, match.lemma_id);
    const rawWordId = match.word_id ?? match.id;
    const wordId = typeof rawWordId === 'number' && Number.isInteger(rawWordId) && rawWordId > 0 ? rawWordId : null;
    if (!strongs && !lemmaKey && wordId === null) continue;
    if (strongs && seenBs.has(strongs)) continue;
    if (strongs) seenBs.add(strongs);
    resolved.push({
      query: word,
      strongs,
      lemmaKey,
      wordId,
      lemma: firstNonEmpty(match.sc, match.lemma, match.script, match.word),
      gloss: firstNonEmpty(match.gl, match.gloss, match.short_gloss),
      raw: match,
    });
  }
  if (resolved.length === 0) {
    const first = extractFirstObject(rows);
    if (first) {
      const strongs = firstNonEmpty(first.bs, first.strongs, first.extended_strongs, first.strongs_id).toUpperCase();
      const lemmaKey = firstNonEmpty(first.lk, first.lemma_key, first.lemma_id);
      const rawWordId = first.word_id ?? first.id;
      const wordId = typeof rawWordId === 'number' && Number.isInteger(rawWordId) && rawWordId > 0 ? rawWordId : null;
      if (strongs || lemmaKey || wordId !== null) {
        resolved.push({
          query: word,
          strongs,
          lemmaKey,
          wordId,
          lemma: firstNonEmpty(first.sc, first.lemma, first.script, first.word),
          gloss: firstNonEmpty(first.gl, first.gloss, first.short_gloss),
          raw: first,
        });
      }
    }
  }
  return resolved;
}

async function resolveWordFast(read: DatabaseReader, word: string): Promise<ResolvedWord | null> {
  const candidates = await resolveWordCandidatesFast(read, word);
  return candidates[0] ?? null;
}

function parseVidsPayload(profile: Record<string, unknown> | null, strongs: string): WordProfileVids {
  const allVids: number[] = [];
  const vidBookMap = new Map<number, number>();
  const bookDistribution: Record<string, number> = {};

  if (!profile) {
    return { strongs, totalVerses: 0, allVids, vidBookMap, bookDistribution };
  }

  const rawByBook = asRecord(profile.vids_by_book ?? profile.book_vids);
  if (rawByBook) {
    for (const [bookKey, listVal] of Object.entries(rawByBook)) {
      const bookNum = Number(bookKey);
      const vids = asArray(listVal);
      if (Number.isInteger(bookNum) && bookNum >= 1 && bookNum <= 66) {
        bookDistribution[String(bookNum)] = vids.length;
      }
      for (const item of vids) {
        if (typeof item === 'number' && Number.isInteger(item) && item > 0) {
          allVids.push(item);
          if (Number.isInteger(bookNum)) vidBookMap.set(item, bookNum);
        }
      }
    }
  }

  if (allVids.length === 0) {
    for (const item of asArray(profile.all_vids ?? profile.verse_ids)) {
      if (typeof item === 'number' && Number.isInteger(item) && item > 0) {
        allVids.push(item);
        const book = inferBookFromVid(item);
        if (book !== null) vidBookMap.set(item, book);
      } else {
        const obj = asRecord(item);
        const vid = obj?.verse_id ?? obj?.vid ?? obj?.id;
        const book = obj?.book;
        if (typeof vid === 'number' && Number.isInteger(vid) && vid > 0) {
          allVids.push(vid);
          if (typeof book === 'number' && book >= 1 && book <= 66) {
            vidBookMap.set(vid, book);
          } else {
            const inferred = inferBookFromVid(vid);
            if (inferred !== null) vidBookMap.set(vid, inferred);
          }
        }
      }
    }
  }

  const rawDist = asRecord(profile.book_distribution ?? profile.book_counts);
  if (rawDist) {
    for (const [k, v] of Object.entries(rawDist)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        bookDistribution[k] = v;
      }
    }
  } else if (Object.keys(bookDistribution).length === 0) {
    for (const vid of allVids) {
      const book = inferBookFromVid(vid, vidBookMap);
      if (book !== null) {
        const key = String(book);
        bookDistribution[key] = (bookDistribution[key] ?? 0) + 1;
      }
    }
  }

  const rawTotal = profile.total_verses ?? profile.verse_count;
  const totalVerses = typeof rawTotal === 'number' && Number.isFinite(rawTotal)
    ? rawTotal
    : allVids.length;

  return {
    strongs: firstNonEmpty(profile.strongs, strongs).toUpperCase(),
    totalVerses,
    allVids: Array.from(new Set(allVids)).sort((a, b) => a - b),
    vidBookMap,
    bookDistribution,
  };
}

async function hydrateCompactVersesByIds(
  read: DatabaseReader,
  verseIds: number[],
): Promise<Record<string, unknown>[]> {
  const sorted = [...new Set(verseIds)].sort((a, b) => a - b);
  const chunks: number[][] = [];
  for (let offset = 0; offset < sorted.length; offset += 12) {
    chunks.push(sorted.slice(offset, offset + 12));
  }
  const verses: Record<string, unknown>[] = [];
  for (let i = 0; i < chunks.length; i += 2) {
    const pages = await Promise.all(
      chunks.slice(i, i + 2).map(ids =>
        callRpc(read, 'get_passage_compact_v1', { verse_ids: ids, include_profiles: false, max_verses: ids.length }, ids.length, 0)
          .then(rows => extractRowsOrField(rows, 'verses', 'items', 'passages'))
          .catch(() => [] as Record<string, unknown>[]),
      ),
    );
    for (const p of pages) verses.push(...p);
  }
  return verses;
}

async function hydrateCompactVersesByPassage(
  read: DatabaseReader,
  parsed: ParsedPassage,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  const verses: Record<string, unknown>[] = [];
  while (verses.length < limit) {
    const pageLimit = Math.min(50, limit - verses.length);
    const rows = await callRpc(read, 'get_passage_compact_v1',
      { passages: parsed.passages, include_profiles: false, max_verses: pageLimit, offset: verses.length }, pageLimit, 0);
    const page = extractRowsOrField(rows, 'verses', 'items', 'passages');
    verses.push(...page);
    if (page.length < pageLimit || rows[0]?.pagination && asRecord(rows[0].pagination)?.has_more === false) break;
  }
  return verses;
}

async function executeEvidence(
  read: DatabaseReader,
  op: Extract<ResearchOp, { op: 'evidence' }>,
): Promise<Record<string, unknown>> {
  if (/^r13:proof:/i.test(op.evidence_id)) {
    const rest = op.evidence_id.replace(/^r13:proof:[^:]+:/i, '');
    const extractedTargets = rest.split('+').map(s => s.trim()).filter(Boolean);
    return {
      status: 'ok',
      evidence_id: op.evidence_id,
      relation: 'synthesized_graph_proof',
      epistemic: 'composite_proof_summary',
      title: `Composite multi-anchor proof summary (${extractedTargets.join(' <-> ')})`,
      summary: 'r13:proof:* IDs summarize verified pairwise edges synthesized by get_Connection. Inspect constituent_evidence_ids on the get_Connection result or call get_Connection on extracted_targets.',
      extracted_targets: extractedTargets,
    };
  }
  const rows = await callRpc(
    read,
    'get_connection_evidence_v1',
    {
      evidence_id: op.evidence_id,
      ...(op.release_id ? { release_id: op.release_id } : {}),
    },
    1,
    0,
  );
  const raw = extractFirstObject(rows);
  if (!raw) {
    return { status: 'not_found', evidence_id: op.evidence_id };
  }
  const status = firstNonEmpty(raw.status, 'ok');
  const ev = asRecord(raw.evidence) ?? raw;
  const passageDetails = asArray(raw.passage_details)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null);
  const evPassages = asArray(ev.passages ?? ev.verses)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null);

  const hydratedPassages: Record<string, unknown>[] = [];
  const seenPassageRefs = new Set<string>();
  for (const pd of passageDetails.slice(0, 12)) {
    const pObj = asRecord(pd.passage) ?? pd;
    const ref = firstNonEmpty(pObj.ref);
    const vid = typeof pObj.verse_id === 'number' ? pObj.verse_id : undefined;
    const key = ref || (vid ? `vid:${vid}` : '');
    if (key) seenPassageRefs.add(key);
    const origToks = asArray(pd.original_tokens).slice(0, 40);
    hydratedPassages.push({
      ...(ref ? { ref } : {}),
      ...(vid !== undefined ? { verse_id: vid } : {}),
      ...(typeof pObj.book === 'number' ? { book: pObj.book } : {}),
      ...(typeof pObj.chapter === 'number' ? { chapter: pObj.chapter } : {}),
      ...(typeof pObj.verse === 'number' ? { verse: pObj.verse } : {}),
      ...(pObj.mt_ref ? { mt_ref: pObj.mt_ref } : {}),
      ...(pObj.is_psalm_heading ? { is_psalm_heading: true } : {}),
      ...(pd.english_text ? { english_text: trimText(pd.english_text, 400) } : {}),
      ...(pd.english_edition ? { english_edition: pd.english_edition } : {}),
      ...(origToks.length > 0 ? { original_tokens: origToks } : {}),
    });
  }
  for (const p of evPassages) {
    if (hydratedPassages.length >= 12) break;
    const ref = firstNonEmpty(p.ref);
    const vid = typeof p.verse_id === 'number' ? p.verse_id : undefined;
    const key = ref || (vid ? `vid:${vid}` : '');
    if (key && seenPassageRefs.has(key)) continue;
    if (key) seenPassageRefs.add(key);
    hydratedPassages.push(p);
  }

  const tokens = asArray(ev.tokens ?? ev.original_tokens ?? raw.tokens).slice(0, 40);
  const originalWords = asArray(ev.original_words).slice(0, 20);
  const matchedTerms = asArray(ev.matched_terms).slice(0, 20);
  const limitations = asArray(ev.limitations).filter((x): x is string => typeof x === 'string').slice(0, 6);
  const relation = firstNonEmpty(ev.predicate, ev.relation, raw.relation);
  const epistemic = firstNonEmpty(ev.epistemic_class, ev.epistemic, raw.epistemic);
  const releaseId = firstNonEmpty(raw.release_id, raw.evidence_release_id);
  const title = firstNonEmpty(ev.title, raw.title);
  const summary = firstNonEmpty(ev.why, ev.explanation, ev.summary, raw.why, raw.summary);
  const orth = ev.orthographic_analysis ?? ev.orthographic_decomposition ?? raw.orthographic_analysis ?? raw.orthographic_decomposition;

  return {
    status,
    evidence_id: firstNonEmpty(raw.evidence_id, ev.evidence_id, op.evidence_id),
    ...(releaseId ? { release_id: releaseId } : {}),
    ...(raw.error ? { error: raw.error } : {}),
    ...(raw.mismatch ? { mismatch: raw.mismatch } : {}),
    ...(relation ? { relation } : {}),
    ...(epistemic ? { epistemic } : {}),
    ...(typeof ev.evidence_tier === 'number' ? { evidence_tier: ev.evidence_tier } : {}),
    ...(ev.evidence_type ? { evidence_type: ev.evidence_type } : {}),
    ...(title ? { title: trimText(title, 180) } : {}),
    ...(summary ? { summary: trimText(summary, 400) } : {}),
    ...(originalWords.length > 0 ? { original_words: originalWords } : {}),
    ...(matchedTerms.length > 0 ? { matched_terms: matchedTerms } : {}),
    ...(tokens.length > 0 ? { tokens } : {}),
    ...(hydratedPassages.length > 0 ? { passages: hydratedPassages } : {}),
    ...(orth ? { orthographic_analysis: orth } : {}),
    ...(ev.number_classification ? { number_classification: ev.number_classification } : {}),
    ...(ev.r12_metadata ? { r12_metadata: ev.r12_metadata } : {}),
    ...(ev.provenance ? { provenance: ev.provenance } : {}),
    ...(limitations.length > 0 ? { limitations } : {}),
  };
}

async function fetchWordProfilesBatchWithVids(
  read: DatabaseReader,
  strongsList: string[],
): Promise<Map<string, { raw: Record<string, unknown>; vids: WordProfileVids }>> {
  const unique = Array.from(new Set(strongsList.map(s => s.trim()).filter(Boolean)));
  const out = new Map<string, { raw: Record<string, unknown>; vids: WordProfileVids }>();
  if (unique.length === 0) return out;
  const parseBatch = (rows: Record<string, unknown>[], fallbackStrongs: string[]) => {
    const first = extractFirstObject(rows);
    const profilesObj = asRecord(first?.profiles);
    if (profilesObj) {
      for (const [k, val] of Object.entries(profilesObj)) {
        const rec = asRecord(val);
        if (!rec) continue;
        const padKey = padStrongs(k);
        out.set(padKey, { raw: rec, vids: parseVidsPayload(rec, padKey) });
      }
    } else if (first && fallbackStrongs.length === 1) {
      const padKey = padStrongs(fallbackStrongs[0]);
      out.set(padKey, { raw: first, vids: parseVidsPayload(first, padKey) });
    }
  };
  try {
    const rows = await callRpc(
      read,
      'get_word_profiles_batch_v1',
      { strongs: unique, include_vids: true, include_forms: false, include_orth: false, include_pilot: false },
      1,
      0,
    );
    parseBatch(rows, unique);
  } catch {
    // Fallback to per-word fetches if a combined high-frequency vid payload exceeded response limits
  }
  const missing = unique.filter(s => !out.has(padStrongs(s)));
  for (const s of missing) {
    try {
      const rows = await callRpc(
        read,
        'get_word_profiles_batch_v1',
        { strongs: [s], include_vids: true, include_forms: false, include_orth: false, include_pilot: false },
        1,
        0,
      );
      parseBatch(rows, [s]);
    } catch {
      // Skip unavailable profile
    }
  }
  return out;
}

function collectFamilyStrongs(profileRaw: Record<string, unknown> | undefined, baseBs: string): string[] {
  if (!profileRaw) return [baseBs];
  const baseLang = baseBs[0];
  const family = new Set<string>([baseBs]);
  for (const rawLr of asArray(profileRaw.lexical_relations)) {
    const lr = asRecord(rawLr);
    if (!lr) continue;
    const t = firstNonEmpty(lr.type);
    if (t === 'shared_name_base' || t === 'group_member_of') continue;
    const tbs = padStrongs(firstNonEmpty(lr.target_strongs));
    if (tbs && tbs[0] === baseLang && !RESEARCH_STOPWORD_STRONGS.has(tbs)) {
      family.add(tbs);
    }
    if (family.size >= 6) break;
  }
  return [...family];
}

async function executeOccurrences(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'occurrences' }>,
): Promise<{ result: Record<string, unknown>; storedIds: number[] }> {
  const defaultOccLimit = ctx.view === 'clues' ? Math.min(ctx.defaultLimit, 12) : ctx.defaultLimit;
  const limit = clampLimit(op.limit, defaultOccLimit, 50);
  const offset = op.offset ?? 0;
  const resolved = await resolveWordFast(ctx.read, op.word);
  if (!resolved) {
    return {
      result: {
        status: 'not_found',
        word: op.word,
        total_verses: 0,
        filtered_count: 0,
        verse_ids: [],
        verses: [],
        book_distribution: {},
      },
      storedIds: [],
    };
  }

  const baseKey = padStrongs(resolved.strongs || resolved.lemmaKey);
  const batchMap = await fetchWordProfilesBatchWithVids(ctx.read, [baseKey]);
  const primaryEntry = batchMap.get(baseKey);
  let profile = primaryEntry?.vids ?? parseVidsPayload(null, baseKey);
  let expandedStrongs = [baseKey];

  if (op.expand_family && primaryEntry?.raw) {
    const fam = collectFamilyStrongs(primaryEntry.raw, baseKey);
    const extras = fam.filter(s => s !== baseKey);
    if (extras.length > 0) {
      const famMap = await fetchWordProfilesBatchWithVids(ctx.read, extras);
      const mergedVids = new Set<number>(profile.allVids);
      const mergedMap = new Map<number, number>(profile.vidBookMap);
      const mergedDist: Record<string, number> = { ...profile.bookDistribution };
      for (const s of extras) {
        const fe = famMap.get(s);
        if (!fe) continue;
        expandedStrongs.push(s);
        for (const v of fe.vids.allVids) mergedVids.add(v);
        for (const [k, b] of fe.vids.vidBookMap) mergedMap.set(k, b);
        for (const [bk, cnt] of Object.entries(fe.vids.bookDistribution)) {
          mergedDist[bk] = (mergedDist[bk] ?? 0) + cnt;
        }
      }
      profile = {
        ...profile,
        allVids: [...mergedVids].sort((a, b) => a - b),
        vidBookMap: mergedMap,
        bookDistribution: mergedDist,
      };
    }
  }
  const hasFilter = op.book !== undefined || op.testament !== undefined;

  let filteredVids = profile.allVids;
  let preHydrated: Record<string, unknown>[] | null = null;

  if (hasFilter) {
    const knownBookVids = profile.allVids.filter((vid) => {
      const book = inferBookFromVid(vid, profile.vidBookMap);
      return book !== null;
    });

    if (knownBookVids.length === profile.allVids.length && profile.allVids.length > 0) {
      filteredVids = profile.allVids.filter((vid) =>
        matchesBookOrTestament(inferBookFromVid(vid, profile.vidBookMap), op.book, op.testament),
      );
    } else if (profile.allVids.length > 0) {
      const probeSlice = profile.allVids.slice(0, 48);
      const hydratedAll = await hydrateCompactVersesByIds(ctx.read, probeSlice);
      const matched = hydratedAll.filter((v) => {
        const b = typeof v.book === 'number' ? v.book : null;
        return matchesBookOrTestament(b, op.book, op.testament);
      });
      filteredVids = matched
        .map((v) => v.verse_id)
        .filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
      preHydrated = matched.slice(offset, offset + limit);
    }
  }

  const pagedIds = filteredVids.slice(offset, offset + limit);
  const rawVerses = preHydrated ?? (await hydrateCompactVersesByIds(ctx.read, pagedIds));
  const compactMode = op.detail !== 'full' && ctx.view !== 'full';
  const focusSet = new Set(expandedStrongs);
  const fallbackGlossByStrongs = new Map<string, string>();
  const priRawGloss = firstNonEmpty(asRecord(primaryEntry?.raw)?.gl, resolved.gloss);
  if (priRawGloss) fallbackGlossByStrongs.set(baseKey, priRawGloss);
  const verses = rawVerses.map(v => formatResearchVerse(v, compactMode, focusSet, fallbackGlossByStrongs));

  return {
    result: {
      status: 'ok',
      word: op.word,
      strongs: profile.strongs || resolved.strongs,
      ...(expandedStrongs.length > 1 ? { expanded_family: expandedStrongs } : {}),
      lemma: resolved.lemma,
      total_verses: profile.totalVerses,
      filtered_count: filteredVids.length,
      verse_ids: pagedIds,
      verses,
      book_distribution: profile.bookDistribution,
    },
    storedIds: filteredVids,
  };
}

async function executeIntersectWords(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'intersect_words' }>,
): Promise<{ result: Record<string, unknown>; storedIds: number[] }> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const windowSize = op.window ?? 0;

  const candidatesList = await Promise.all(op.words.map((w) => resolveWordCandidatesFast(ctx.read, w)));
  const missing = op.words.filter((_, idx) => candidatesList[idx].length === 0);
  if (missing.length > 0) {
    return {
      result: {
        status: 'not_found',
        missing_words: missing,
        verse_ids: [],
        verses: [],
      },
      storedIds: [],
    };
  }

  const strongsList = candidatesList.map(cands => padStrongs(cands[0].strongs || cands[0].lemmaKey));
  const focusSet = new Set<string>(strongsList);
  const fallbackGlossByStrongs = new Map<string, string>();
  for (const cands of candidatesList) {
    for (const c of cands) {
      const bs = padStrongs(c.strongs || c.lemmaKey);
      if (bs && c.gloss && !fallbackGlossByStrongs.has(bs)) fallbackGlossByStrongs.set(bs, c.gloss);
    }
  }

  // Fast O(1) BMW bitset intersection path when window=0 and !expand_family
  if (windowSize === 0 && !op.expand_family) {
    try {
      const tryBmwIntersect = async (terms: string[]) => {
        const rows = await callRpc(ctx.read, 'set_combine_v3', {
          include: terms,
          ...(op.testament ? { testament: op.testament } : {}),
          ...(op.book !== undefined ? { book: op.book } : {}),
          limit,
          hydrate_verses: true,
        }, 1, 0);
        return extractFirstObject(rows);
      };

      let bestBmw = await tryBmwIntersect(strongsList);
      let usedTerms = [...strongsList];
      let combinedVids = asArray(bestBmw?.vids).filter((n): n is number => typeof n === 'number' && n > 0);
      let combinedTotal = typeof bestBmw?.total_matched === 'number' ? bestBmw.total_matched : combinedVids.length;
      let fallbackBmwVerses = asArray(bestBmw?.verses).map(asRecord).filter((v): v is Record<string, unknown> => v !== null);

      // Compound English query fallback: when primary Strong's yields 0 matches, test alternate Strong's candidates for English terms
      if (bestBmw?.status === 'ok' && combinedVids.length === 0) {
        const isDirectSelector = (w: string) => /^[HG]\d+|^lemma:|[\u0590-\u05ff\u0370-\u03ff]/i.test(w.trim());
        const altSets = candidatesList.map((cands, i) =>
          isDirectSelector(op.words[i])
            ? [strongsList[i]]
            : cands.slice(0, 5).map(c => padStrongs(c.strongs || c.lemmaKey)).filter(Boolean),
        );
        const vidUnion = new Set<number>();
        const matchedBmwVerses = new Map<number, Record<string, unknown>>();
        const matchedStrongs = new Set<string>();
        // Enumerate bounded candidate tuples (up to 12 combinations)
        const combos: string[][] = [[]];
        for (const alts of altSets) {
          const next: string[][] = [];
          for (const prefix of combos) {
            for (const a of alts) {
              if (next.length < 16) next.push([...prefix, a]);
            }
          }
          combos.splice(0, combos.length, ...next);
        }
        for (const combo of combos) {
          if (combo.every((s, idx) => s === strongsList[idx])) continue;
          const res = await tryBmwIntersect(combo);
          const vids = asArray(res?.vids).filter((n): n is number => typeof n === 'number' && n > 0);
          if (vids.length > 0) {
            for (const s of combo) { matchedStrongs.add(s); focusSet.add(s); }
            for (const v of vids) vidUnion.add(v);
            for (const vr of asArray(res?.verses).map(asRecord)) {
              if (vr && typeof vr.vid === 'number' && !matchedBmwVerses.has(vr.vid)) matchedBmwVerses.set(vr.vid, vr);
            }
          }
        }
        if (vidUnion.size > 0) {
          combinedVids = [...vidUnion].sort((a, b) => a - b);
          combinedTotal = combinedVids.length;
          usedTerms = [...matchedStrongs];
          fallbackBmwVerses = combinedVids.slice(0, limit).map(v => matchedBmwVerses.get(v)).filter((v): v is Record<string, unknown> => Boolean(v));
        }
      }

      if (bestBmw && bestBmw.status === 'ok') {
        const topIds = combinedVids.slice(0, limit);
        const rawVerses = topIds.length > 0 ? await hydrateCompactVersesByIds(ctx.read, topIds).catch(() => []) : [];
        const compactMode = op.detail !== 'full' && ctx.view !== 'full';
        const verses = rawVerses.length > 0
          ? rawVerses.map(v => formatResearchVerse(v, compactMode, focusSet, fallbackGlossByStrongs))
          : fallbackBmwVerses.slice(0, limit).map(v => ({
              verse_id: v.vid,
              ref: v.ref,
              english: v.en,
              ...(v.expand_id ? { expand_id: v.expand_id } : {}),
              ...(Array.isArray(v.sample_lemmas) ? { sample_lemmas: v.sample_lemmas } : {}),
            }));
        return {
          result: {
            status: 'ok',
            words: op.words,
            resolved_strongs: usedTerms,
            window: 0,
            total_matches: combinedTotal,
            verse_ids: topIds,
            verses,
          },
          storedIds: combinedVids,
        };
      }
    } catch {
      // Fall back to profile-vid intersection when set_combine_v3 is unavailable
    }
  }

  const batchMap = await fetchWordProfilesBatchWithVids(ctx.read, strongsList);
  const profiles: WordProfileVids[] = [];
  const expandedByAnchor: Record<string, string[]> = {};

  for (const baseKey of strongsList) {
    const entry = batchMap.get(baseKey);
    let prof = entry?.vids ?? parseVidsPayload(null, baseKey);
    if (op.expand_family && entry?.raw) {
      const fam = collectFamilyStrongs(entry.raw, baseKey).filter(s => s !== baseKey);
      if (fam.length > 0) {
        const famMap = await fetchWordProfilesBatchWithVids(ctx.read, fam);
        const mergedVids = new Set<number>(prof.allVids);
        const mergedMap = new Map<number, number>(prof.vidBookMap);
        for (const s of fam) {
          const fe = famMap.get(s);
          if (!fe) continue;
          focusSet.add(s);
          expandedByAnchor[baseKey] = [...(expandedByAnchor[baseKey] ?? [baseKey]), s];
          for (const v of fe.vids.allVids) mergedVids.add(v);
          for (const [k, b] of fe.vids.vidBookMap) mergedMap.set(k, b);
        }
        prof = { ...prof, allVids: [...mergedVids].sort((a, b) => a - b), vidBookMap: mergedMap };
      }
    }
    profiles.push(prof);
  }

  const sortedProfiles = [...profiles].sort((a, b) => a.allVids.length - b.allVids.length);
  const anchor = sortedProfiles[0];
  const others = sortedProfiles.slice(1);

  const matchedIds: number[] = [];
  if (windowSize === 0) {
    const otherSets = others.map((p) => new Set(p.allVids));
    for (const vid of anchor.allVids) {
      if (otherSets.every((set) => set.has(vid))) {
        matchedIds.push(vid);
      }
    }
  } else {
    for (const vid of anchor.allVids) {
      const anchorBook = inferBookFromVid(vid, anchor.vidBookMap);
      const matchesAll = others.every((other) =>
        other.allVids.some((otherVid) => {
          if (Math.abs(otherVid - vid) > windowSize) return false;
          const otherBook = inferBookFromVid(otherVid, other.vidBookMap);
          if (anchorBook !== null && otherBook !== null && anchorBook !== otherBook) {
            return false;
          }
          return true;
        }),
      );
      if (matchesAll) matchedIds.push(vid);
    }
  }

  const hasFilter = op.book !== undefined || op.testament !== undefined;
  let filteredMatchedIds = matchedIds;
  if (hasFilter) {
    filteredMatchedIds = matchedIds.filter((vid) =>
      matchesBookOrTestament(inferBookFromVid(vid), op.book, op.testament),
    );
  }

  const topIds = filteredMatchedIds.slice(0, limit);
  const rawVerses = topIds.length > 0 ? await hydrateCompactVersesByIds(ctx.read, topIds) : [];
  const compactMode = op.detail !== 'full' && ctx.view !== 'full';
  const verses = rawVerses.map(v => formatResearchVerse(v, compactMode, focusSet, fallbackGlossByStrongs));

  return {
    result: {
      status: 'ok',
      words: op.words,
      resolved_strongs: strongsList,
      ...(Object.keys(expandedByAnchor).length > 0 ? { expanded_families: expandedByAnchor } : {}),
      window: windowSize,
      total_matches: filteredMatchedIds.length,
      verse_ids: topIds,
      verses,
    },
    storedIds: filteredMatchedIds,
  };
}

const GRAMMAR_PREDICATE_ALIASES: Record<string, string> = {
  subject_of: 'grammatical_subject_of',
  subject: 'grammatical_subject_of',
  object_of: 'grammatical_object_of',
  object: 'grammatical_object_of',
  possessive: 'possessive_construction_with',
  construct: 'possessive_construction_with',
  passive: 'passive_or_middle_subject',
  agent: 'agent_of',
};

function normalizeGrammarPredicate(p: string): string {
  const k = p.trim().toLowerCase();
  return GRAMMAR_PREDICATE_ALIASES[k] ?? p.trim();
}

async function executeGrammarSearch(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'grammar_search' }>,
): Promise<Record<string, unknown>> {
  if (!op.word && !op.passage) {
    return { status: 'invalid_request', error: 'Provide word or passage for grammar_search.' };
  }
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);

  if (op.passage) {
    const parsed = parsePassageString(op.passage);
    if (!parsed) {
      return { status: 'invalid_request', error: `Could not parse passage: ${op.passage}` };
    }
    const refs = expandPassageRefs(parsed.passages).slice(0, Math.min(limit, 10));
    const frames = await Promise.all(
      refs.map(async (ref) => {
        const frameRows = await callRpc(
          ctx.read,
          'query_relationships_v2',
          {
            op: 'passage_frames',
            book: ref.book,
            chapter: ref.chapter,
            verse: ref.verse,
            include_candidates: true,
          },
          1,
          0,
        );
        let syntaxTree: Record<string, unknown> | null = null;
        if (op.include_syntax_tree) {
          const treeRows = await callRpc(
            ctx.read,
            'lookup_syntax_tree_v1',
            { p_book: ref.book, p_chapter: ref.chapter, p_verse: ref.verse },
            1,
            0,
          );
          syntaxTree = extractFirstObject(treeRows);
        }
        return {
          ref: formatRef(ref.book, ref.chapter, ref.verse),
          frames: extractFirstObject(frameRows),
          ...(syntaxTree ? { syntax_tree: syntaxTree } : {}),
        };
      }),
    );
    return { status: 'ok', passage: parsed.normalized, results: frames };
  }

  const normPreds = op.predicates ? [...new Set(op.predicates.map(normalizeGrammarPredicate).filter(Boolean))] : [];
  if (normPreds.length >= 2) {
    const perPredLimit = Math.max(3, Math.ceil(limit / normPreds.length));
    const perPredResults = await Promise.all(
      normPreds.slice(0, 6).map(pred =>
        callRpc(
          ctx.read,
          'query_relationships_v2',
          {
            op: 'lemma_relationships',
            query: op.word,
            predicates: [pred],
            ...(op.direction ? { direction: op.direction } : {}),
            limit: perPredLimit,
            offset: 0,
          },
          1,
          0,
        ).then(extractFirstObject).catch(() => null),
      ),
    );
    const mergedItems: unknown[] = [];
    let resolvedObj: unknown = null;
    for (const res of perPredResults) {
      if (!res) continue;
      if (!resolvedObj && res.resolved) resolvedObj = res.resolved;
      for (const it of asArray(res.items ?? res.relationships ?? res.edges)) {
        mergedItems.push(it);
      }
    }
    return {
      status: 'ok',
      word: op.word,
      predicates: normPreds,
      per_predicate_limit: perPredLimit,
      relationships: {
        ...(resolvedObj ? { resolved: resolvedObj } : {}),
        items: mergedItems.slice(0, Math.max(limit, normPreds.length * perPredLimit)),
        per_predicate_counts: perPredResults.map((r, i) => ({
          predicate: normPreds[i],
          count: asArray(r?.items ?? r?.relationships ?? r?.edges).length,
        })),
      },
    };
  }

  const rows = await callRpc(
    ctx.read,
    'query_relationships_v2',
    {
      op: 'lemma_relationships',
      query: op.word,
      ...(normPreds.length > 0 ? { predicates: normPreds } : {}),
      ...(op.direction ? { direction: op.direction } : {}),
      limit,
      offset: 0,
    },
    1,
    0,
  );
  const relsObj = extractFirstObject(rows);
  return {
    status: 'ok',
    word: op.word,
    relationships: relsObj,
    ...((/^G\d+/i.test(op.word) || /[\u0370-\u03ff]/.test(op.word)) && (!relsObj || (asArray(relsObj.items).length === 0 && asArray(relsObj.relationships).length === 0))
      ? { coverage_note: 'MACULA grammatical frame search currently indexes Hebrew/Aramaic Old Testament syntax; use occurrences or intersect_words for Greek NT lemmas.' }
      : {}),
  };
}

function compactLxxCompareEntry(raw: Record<string, unknown> | null, full: boolean): Record<string, unknown> | null {
  if (!raw || full) return raw;
  const compactTokens = (arr: unknown[]) =>
    arr.map(t => {
      const tr = asRecord(t);
      if (!tr) return t;
      return {
        pos: tr.ordinal ?? tr.word_position ?? tr.position,
        form: tr.word_text ?? tr.original_word ?? tr.surface ?? tr.form,
        ...(tr.strongs_nr ? { strongs: tr.strongs_nr } : tr.strongs ? { strongs: tr.strongs } : {}),
        ...(tr.english_gloss ? { gloss: tr.english_gloss } : tr.gloss ? { gloss: tr.gloss } : {}),
        ...(tr.alignment_status ? { status: tr.alignment_status } : {}),
        ...(Array.isArray(tr.aligned_lxx_ordinals) && tr.aligned_lxx_ordinals.length > 0 ? { lxx_ords: tr.aligned_lxx_ordinals } : {}),
        ...(Array.isArray(tr.aligned_hebrew_ordinals) && tr.aligned_hebrew_ordinals.length > 0 ? { heb_ords: tr.aligned_hebrew_ordinals } : {}),
      };
    });
  const heb = asRecord(raw.hebrew_passage);
  const sep = asRecord(raw.septuagint_passage);
  const swete = asRecord(raw.swete_lxx_witness);
  const hebRef = heb
    ? (heb.book && heb.chapter ? formatRef(Number(heb.book), Number(heb.chapter), Number(heb.verse_nr ?? 0)) : str(heb.ref))
    : '';
  return {
    ...(raw.status ? { status: raw.status } : {}),
    ...(raw.correspondence_status ? { correspondence_status: raw.correspondence_status } : {}),
    ...(heb ? {
      hebrew_passage: {
        ref: hebRef || `${heb.book}:${heb.chapter}:${heb.verse_nr}`,
        text: asArray(heb.words ?? heb.tokens).map(t => firstNonEmpty(asRecord(t)?.word_text, asRecord(t)?.original_word, asRecord(t)?.surface)).filter(Boolean).join(' '),
        tokens: compactTokens(asArray(heb.words ?? heb.tokens)),
      },
    } : {}),
    ...(sep ? {
      septuagint_passage: {
        ref: `${firstNonEmpty(sep.book_name, sep.latin_name, String(sep.book_no ?? ''))} ${sep.chapter ?? ''}:${sep.verse_nr ?? ''}`.trim(),
        text: asArray(sep.words ?? sep.tokens).map(t => firstNonEmpty(asRecord(t)?.word_text, asRecord(t)?.surface)).filter(Boolean).join(' '),
        tokens: compactTokens(asArray(sep.words ?? sep.tokens)),
      },
    } : {}),
    ...(swete ? {
      swete_lxx_witness: {
        book_name: swete.book_name ?? swete.latin_name,
        chapter: swete.chapter,
        verse_nr: swete.verse_nr,
        text: asArray(swete.words ?? swete.tokens).map(t => firstNonEmpty(asRecord(t)?.word_text, asRecord(t)?.surface)).filter(Boolean).join(' '),
      },
    } : {}),
  };
}

async function executeLxx(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'lxx' }>,
): Promise<Record<string, unknown>> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const mode = op.mode ?? (op.passage ? 'compare' : 'translations');

  if (op.passage) {
    const parsed = parsePassageString(op.passage);
    if (!parsed) {
      return { status: 'invalid_request', error: `Could not parse passage: ${op.passage}` };
    }
    const coords: Array<{ book: number; chapter: number; verse: number }> = [];
    for (const sp of parsed.passages) {
      for (let v = sp.start_verse; v <= sp.end_verse && coords.length < Math.min(limit, 15); v++) {
        coords.push({ book: sp.book, chapter: sp.chapter, verse: v });
      }
    }
    if (coords.some(c => c.book >= 40)) {
      return {
        status: 'invalid_request',
        error: 'LXX passage/compare operations apply to Old Testament passages (books 1-39); requested passage is in the New Testament Greek corpus.',
      };
    }
    const isFull = op.detail === 'full';
    if (mode === 'passage') {
      const verses = await Promise.all(
        coords.map(async c => {
          const direct = await callRpc(
            ctx.read,
            'lookup_septuagint_passage_v1',
            { p_canonical_book: c.book, p_chapter: c.chapter, p_verse_nr: c.verse },
            1,
            0,
          ).then(extractFirstObject).catch(() => null);
          if (direct && (direct.found === true || asArray(direct.words ?? direct.tokens).length > 0)) return direct;
          const cmp = await callRpc(
            ctx.read,
            'compare_hebrew_septuagint_passage_v1',
            { p_hebrew_book: c.book, p_hebrew_chapter: c.chapter, p_hebrew_verse: c.verse },
            1,
            0,
          ).then(extractFirstObject).catch(() => null);
          const sep = asRecord(cmp?.septuagint_passage);
          if (!sep || asArray(sep.words).length === 0) return direct;
          return {
            found: true,
            book: { book_no: sep.book_no, latin_name: sep.latin_name, canonical_book_id: c.book },
            reference: { chapter: sep.chapter, chapter_suffix: sep.chapter_suffix ?? '', verse_nr: sep.verse_nr, verse_suffix: sep.verse_suffix ?? '' },
            words: sep.words,
          };
        }),
      );
      const valid = verses.filter(Boolean).map(v => {
        if (isFull || !v) return v;
        const toks = asArray((v as Record<string, unknown>).words ?? (v as Record<string, unknown>).tokens);
        return {
          ...(v as Record<string, unknown>),
          text: toks.map(t => firstNonEmpty(asRecord(t)?.word_text)).filter(Boolean).join(' '),
          words: toks.map(t => {
            const tr = asRecord(t);
            return tr ? { ordinal: tr.ordinal, word_text: tr.word_text } : t;
          }),
        };
      });
      return {
        status: 'ok',
        mode,
        passage: parsed.normalized,
        data: valid.length === 1 ? valid[0] : valid,
      };
    }
    if (mode === 'alignments') {
      const rows = await callRpc(
        ctx.read,
        'lookup_hebrew_septuagint_alignments_v1',
        { p_query: op.word ?? parsed.normalized, p_limit: limit },
        1,
        0,
      );
      const first = extractFirstObject(rows);
      if (first && first.status !== 'no_evidence_in_covered_scope' && Number(first.total_returned ?? 0) > 0) {
        return { status: 'ok', mode, passage: parsed.normalized, data: first };
      }
      const lxxWitnesses = await Promise.all(
        coords.slice(0, 5).map(c =>
          callRpc(ctx.read, 'lookup_septuagint_passage_v1', { p_canonical_book: c.book, p_chapter: c.chapter, p_verse_nr: c.verse }, 1, 0)
            .then(extractFirstObject).catch(() => null),
        ),
      );
      return {
        status: 'ok',
        mode,
        passage: parsed.normalized,
        data: first,
        swete_lxx_witness: lxxWitnesses.filter(Boolean).map(w => compactLxxCompareEntry({ swete_lxx_witness: w }, isFull)),
      };
    }
    const comparisons = await Promise.all(
      coords.map(async c => {
        const cmp = await callRpc(
          ctx.read,
          'compare_hebrew_septuagint_passage_v1',
          { p_hebrew_book: c.book, p_hebrew_chapter: c.chapter, p_hebrew_verse: c.verse },
          1,
          0,
        ).then(extractFirstObject).catch(() => null);
        if (cmp && cmp.status !== 'no_evidence_in_covered_scope') {
          return compactLxxCompareEntry(cmp, isFull);
        }
        const lxxOnly = await callRpc(
          ctx.read,
          'lookup_septuagint_passage_v1',
          { p_canonical_book: c.book, p_chapter: c.chapter, p_verse_nr: c.verse },
          1,
          0,
        ).then(extractFirstObject).catch(() => null);
        return lxxOnly ? compactLxxCompareEntry({ ...(cmp ?? {}), swete_lxx_witness: lxxOnly }, isFull) : cmp;
      }),
    );
    const nonNull = comparisons.filter(Boolean);
    return {
      status: 'ok',
      mode: 'compare',
      passage: parsed.normalized,
      data: nonNull.length === 1 ? nonNull[0] : nonNull,
    };
  }

  if (!op.word) {
    return { status: 'invalid_request', error: 'Provide passage or word for lxx operation.' };
  }

  if (mode === 'alignments') {
    const rows = await callRpc(
      ctx.read,
      'lookup_hebrew_septuagint_alignments_v1',
      { p_query: op.word, p_limit: limit },
      1,
      0,
    );
    return { status: 'ok', mode, word: op.word, data: extractFirstObject(rows) };
  }

  const rows = await callRpc(
    ctx.read,
    'query_relationships_v2',
    { op: 'lxx_translations', query: op.word, limit, offset: 0 },
    1,
    0,
  );
  const lxxData = extractFirstObject(rows);
  const hasDirectLxxItems = Boolean(
    lxxData &&
    lxxData.status !== 'no_evidence_in_covered_scope' &&
    lxxData.status !== 'needs_disambiguation' &&
    asArray(lxxData.items ?? lxxData.translations ?? lxxData.results).length > 0,
  );
  if (hasDirectLxxItems) {
    return { status: 'ok', mode: 'translations', word: op.word, data: lxxData };
  }
  const resolved = await resolveWordFast(ctx.read, op.word);
  let profileLxx: unknown[] = [];
  let lxxVerseWitnesses: unknown[] = [];
  const baseBs = resolved?.strongs ? padStrongs(resolved.strongs) : (/^[HG]0*\d+[A-Z]*$/i.test(op.word.trim()) ? padStrongs(op.word.trim()) : '');
  if (baseBs) {
    const pRows = await callRpc(
      ctx.read,
      'get_word_profiles_batch_v1',
      { strongs: [baseBs], include_vids: true, include_forms: false, include_orth: false, include_pilot: false },
      1,
      0,
    ).catch(() => []);
    const pObj = asRecord(extractFirstObject(pRows)?.profiles);
    const prof = asRecord(pObj?.[baseBs]);
    profileLxx = asArray(prof?.lxx_relations).slice(0, limit);
    if (profileLxx.length === 0 && baseBs.startsWith('H')) {
      const sampleVids = asArray(prof?.all_vids).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 3);
      if (sampleVids.length > 0) {
        const hyd = await hydrateCompactVersesByIds(ctx.read, sampleVids).catch(() => []);
        const cmps = await Promise.all(
          hyd.slice(0, 3).map(v => {
            const b = Number(v.book || 0);
            const ch = Number(v.chapter || 0);
            const vs = Number(v.verse || 0);
            if (!b || !ch || !vs) return Promise.resolve(null);
            return callRpc(
              ctx.read,
              'compare_hebrew_septuagint_passage_v1',
              { p_hebrew_book: b, p_hebrew_chapter: ch, p_hebrew_verse: vs },
              1,
              0,
            ).then(extractFirstObject).catch(() => null);
          }),
        );
        lxxVerseWitnesses = cmps
          .filter((c): c is Record<string, unknown> => Boolean(c && c.status !== 'no_evidence_in_covered_scope'))
          .map(c => compactLxxCompareEntry(c, op.detail === 'full'));
      }
    }
  }
  return {
    status: 'ok',
    mode: 'translations',
    word: op.word,
    data: lxxData,
    ...(profileLxx.length > 0 ? { profile_lxx_equivalents: profileLxx } : {}),
    ...(lxxVerseWitnesses.length > 0 ? { lxx_verse_witnesses: lxxVerseWitnesses } : {}),
  };
}

async function executeGematria(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'gematria' }>,
): Promise<Record<string, unknown>> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const calculations: GematriaResult[] = op.terms.map((term) => computeGematria(term));

  let matches: Record<string, unknown>[] | undefined;
  if (op.find_matches && calculations[0] && calculations[0].value > 0) {
    const rows = await callRpc(
      ctx.read,
      'query_words_by_gematria',
      { gematria: calculations[0].value },
      limit,
      0,
    );
    matches = extractRowsOrField(rows, 'words', 'matches', 'items').slice(0, limit);
  }

  return {
    status: 'ok',
    calculations,
    ...(matches !== undefined
      ? {
          target_value: calculations[0].value,
          matches,
          epistemic: 'arithmetic_coincidence_only_not_proof',
          epistemic_note:
            'Shared gematria/isopsephy sums are arithmetic coincidences only and do not prove textual dependence or etymology.',
        }
      : {}),
  };
}

const NUMBER_LEMMA_MAP: Record<string, string[]> = {
  '1': ['H0259', 'G1520'],
  '2': ['H8147', 'G1417'],
  '3': ['H7969', 'H7992', 'G5140', 'G5154'],
  '4': ['H0702', 'G5064'],
  '5': ['H2568', 'G4002'],
  '6': ['H8337', 'G1803'],
  '7': ['H7651', 'H7637', 'G2033', 'G1442'],
  '8': ['H8083', 'G3638'],
  '10': ['H6235', 'H6218', 'G1176'],
  '12': ['H8147', 'H6240', 'G1427'],
  '24': ['G1501'],
  '40': ['H0705', 'G5062'],
  '50': ['H2572', 'G4004'],
  '70': ['H7657', 'G1440'],
  '100': ['H3967', 'G1540'],
  '1000': ['H0505', 'G5507'],
};

async function executeNumbers(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'numbers' }>,
): Promise<Record<string, unknown>> {
  if (op.number === undefined && !op.query) {
    return { status: 'invalid_request', error: 'Provide number or query for numbers operation.' };
  }
  const limit = clampLimit(op.limit, 15, 25);
  const searchQuery = String(op.number ?? op.query);
  const numKey = String(op.number ?? '').trim() || (/\b(\d+)\b/.exec(searchQuery)?.[1] ?? '');
  const lemmaStrongs = NUMBER_LEMMA_MAP[numKey] ?? [];

  const [payload, numProfRows] = await Promise.all([
    callRpc(ctx.read, 'discover_biblical_connections_v2', { query: searchQuery, limit }, 1, 0)
      .then(rows => extractFirstObject(rows) ?? {})
      .catch(() => ({}) as Record<string, unknown>),
    lemmaStrongs.length > 0
      ? callRpc(
          ctx.read,
          'get_word_profiles_batch_v1',
          { strongs: lemmaStrongs, include_vids: false, include_forms: false, include_orth: false, include_pilot: false },
          1,
          0,
        ).catch(() => [])
      : Promise.resolve([]),
  ]);

  const rawConnections = asArray(payload.strongest_connections ?? payload.connections)
    .map((c) => asRecord(c))
    .filter((c): c is Record<string, unknown> => c !== null);

  const normalized = rawConnections
    .map((c) => normalizeDiscoveryConnection(c))
    .filter((c): c is CompactConnection => c !== null);

  const numberItems = normalized.filter(
    (c) =>
      /number|count|numeric|ordinal|symbol/i.test(c.relation) ||
      /number|count|numeric|seven|twelve|forty|three/i.test(c.title) ||
      /number|count|numeric/i.test(c.why),
  );

  const profMap = asRecord(extractFirstObject(numProfRows)?.profiles);
  const numberProfiles = profMap
    ? lemmaStrongs
        .map(bs => asRecord(profMap[bs]))
        .filter((p): p is Record<string, unknown> => p !== null)
        .map(p => ({
          strongs: p.bs,
          lemma: p.sc,
          transliteration: p.tr,
          gloss: p.gl,
          total_verses: p.total_verses ?? 0,
          clusters: asArray(p.clusters).slice(0, 3),
        }))
    : [];

  return {
    status: 'ok',
    query: searchQuery,
    items: numberItems.length > 0 ? numberItems : normalized,
    ...(numberProfiles.length > 0 ? { number_profiles: numberProfiles } : {}),
    ...(payload.number_classifications ? { number_classifications: payload.number_classifications } : {}),
    epistemic: 'descriptive_pattern_only',
    coincidence_warning:
      'Numeric occurrences and symbolic number groupings are descriptive only; numerical coincidences do not establish causation or hidden codes.',
  };
}

async function executeChronologyOccurrences(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'chronology_occurrences' }>,
): Promise<{ result: Record<string, unknown>; storedIds: number[] }> {
  if (!op.word && !op.passage) {
    return {
      result: { status: 'invalid_request', error: 'Provide word or passage for chronology_occurrences.' },
      storedIds: [],
    };
  }
  const limit = clampLimit(op.limit, 80, 80);
  let allIds: number[] = [];
  let totalMatchingVerses = 0;
  if (op.word) {
    const resolved = await resolveWordFast(ctx.read, op.word);
    if (resolved) {
      const baseKey = padStrongs(resolved.strongs || resolved.lemmaKey);
      const batchMap = baseKey ? await fetchWordProfilesBatchWithVids(ctx.read, [baseKey]) : new Map();
      const profile = (baseKey ? batchMap.get(baseKey)?.vids : undefined) ?? parseVidsPayload(null, baseKey);
      allIds = profile.allVids;
      totalMatchingVerses = profile.totalVerses;
    }
  } else if (op.passage) {
    const parsed = parsePassageString(op.passage);
    if (!parsed) return { result: { status: 'invalid_request', error: 'Could not parse passage: ' + op.passage }, storedIds: [] };
    const hydrated = await hydrateCompactVersesByPassage(ctx.read, parsed, parsed.verse_count);
    allIds = hydrated.map((v) => Number(v.verse_id)).filter((id) => Number.isInteger(id) && id > 0);
    totalMatchingVerses = parsed.verse_count;
  }
  // Bound work independently of the witness display limit. A few early
  // occurrences cannot describe the historical distribution of a whole lemma.
  const verseIds = [...new Set(allIds)].slice(0, 1000);
  if (!verseIds.length) return { result: { status: 'not_found', verse_ids: [], models: [] }, storedIds: [] };
  const assertions: Record<string, unknown>[] = [];
  const modelNames = new Map<string, string>();
  let assertionCapReached = false;
  for (let offset = 0; offset < verseIds.length; offset += 80) {
    const ids = verseIds.slice(offset, offset + 80);
    const rows = await callRpc(ctx.read, 'query_chronology_assertions_batch', { verse_ids: ids }, ids.length, 0);
    const batch = extractRowsOrField(rows, 'assertions', 'items', 'results');
    assertionCapReached ||= batch.length >= 400;
    assertions.push(...batch);
    for (const raw of asArray(rows[0]?.models)) {
      const model = asRecord(raw);
      if (model) modelNames.set(String(model.id), firstNonEmpty(model.name));
    }
  }
  const groups = new Map<string, { model_id: string; model: string; axis: string; earliest_year: number | null; latest_year: number | null; verse_ids: Set<number> }>();
  const datedIds = new Set<number>();
  const requestedIds = new Set(verseIds);
  for (const row of assertions) {
    const vid = Number(row.verse_id);
    if (!requestedIds.has(vid)) continue;
    const modelId = String(row.model_id ?? row.model ?? 'unknown_model');
    const axis = firstNonEmpty(row.axis, row.chronology_axis, 'unspecified');
    const earliest = typeof row.earliest_year === 'number' ? row.earliest_year : null;
    const latest = typeof row.latest_year === 'number' ? row.latest_year : null;
    // Keep uncertain intervals intact; assigning their midpoint invents precision.
    const exact = earliest !== null && earliest === latest;
    const start = exact ? Math.floor(earliest / 100) * 100 : earliest;
    const end = exact ? start! + 99 : latest;
    const key = [modelId, axis, start, end].join('|');
    if (!groups.has(key)) groups.set(key, { model_id: modelId, model: modelNames.get(modelId) || modelId, axis, earliest_year: start, latest_year: end, verse_ids: new Set() });
    groups.get(key)!.verse_ids.add(vid);
    if (earliest !== null || latest !== null) datedIds.add(vid);
  }
  const distribution = [...groups.values()].sort((a, b) => a.model_id.localeCompare(b.model_id) || a.axis.localeCompare(b.axis) || (a.earliest_year ?? Infinity) - (b.earliest_year ?? Infinity));
  return {
    result: {
      status: 'ok',
      count_unit: 'distinct matching verses per model/axis/date bin, not token occurrences',
      assumptions: 'Chronology models are interpretive. Axes stay separate; exact dates use 100-year bins, uncertain intervals stay intact. Astronomical years: 0 = 1 BC. Verses may occur in multiple bins/models.',
      coverage: { total_matching_verses: totalMatchingVerses, indexed_verse_ids: allIds.length, examined_verses: verseIds.length, remaining_verses: Math.max(0, totalMatchingVerses - verseIds.length), selection: 'first indexed verses in canonical order, capped at 1000; not a random sample', dated_verses: datedIds.size, undated_verses: verseIds.length - datedIds.size, complete_matching_verse_coverage: totalMatchingVerses === verseIds.length && !assertionCapReached, assertion_cap_reached: assertionCapReached, max_examined_verses: 1000 },
      models: distribution.map((g) => ({ model_id: g.model_id, model: g.model, axis: g.axis, earliest_year: g.earliest_year, latest_year: g.latest_year, count: g.verse_ids.size, verse_ids: [...g.verse_ids].slice(0, limit), witnesses_truncated: g.verse_ids.size > limit })),
    },
    storedIds: verseIds,
  };
}

function readableReference(value: unknown): string {
  const ref = typeof value === 'string' ? value : '';
  return ref.replace(/^(\d{1,2}):(\d{1,3}):(\d{1,3})(?=$|\s|[-–])/, (_match, b, c, v) => formatRef(Number(b), Number(c), Number(v)));
}

function compactComparisonVerse(verse: Record<string, unknown>, wordById: Map<number, Record<string, unknown>>, lexicon: Record<string, unknown>): Record<string, unknown> {
  const tokens = asArray(verse.words ?? verse.tokens).map((raw) => {
    const token = asRecord(raw) ?? {};
    const fields = ['position', 'word_id', 'surface', 'lemma', 'lemma_key', 'lemma_candidates', 'sense_status', 'strongs', 'all_strongs', 'gloss', 'transliteration', 'grammar_code', 'pos_class', 'alignment', 'alignment_status', 'source_token_id', 'source_word_id', 'canonical_occurrence_id'];
    const compact = Object.fromEntries(fields.filter((key) => token[key] !== undefined && token[key] !== null && token[key] !== '').map((key) => [key, token[key]]));
    const row = wordById.get(Number(token.word_id));
    // Never attach another word's morphology or transliteration, even if its ID exists.
    delete compact.transliteration;
    delete compact.grammar_code;
    if (verifyWordRowAlignment(token, row)) {
      const tr = cleanTransliteration(firstNonEmpty(row?.transliteration));
      const code = firstNonEmpty(row?.grammar_code);
      if (tr) compact.transliteration = tr;
      if (code) compact.grammar_code = code;
    }
    const lexical = Object.fromEntries(['lemma', 'pos_class', 'lemma_candidates', 'sense_status'].filter((key) => compact[key] !== undefined).map((key) => [key, compact[key]]));
    const baseKey = firstNonEmpty(token.lemma_key, token.strongs);
    if (baseKey) {
      // Preserve distinct records if source variants under one lemma disagree.
      let key = baseKey;
      for (let suffix = 2; lexicon[key]; suffix++) {
        const stored = { ...asRecord(lexicon[key]) };
        delete stored.lemma_key;
        if (JSON.stringify(stored) === JSON.stringify(lexical)) break;
        key = baseKey + ':' + suffix;
      }
      lexicon[key] = key === baseKey ? lexical : { ...lexical, lemma_key: token.lemma_key };
      compact.key = key;
      for (const field of ['lemma', 'lemma_key', 'pos_class', 'lemma_candidates', 'sense_status']) delete compact[field];
    }
    return compact;
  });
  return {
    verse_id: verse.verse_id,
    ref: verse.ref || formatRef(Number(verse.book), Number(verse.chapter), Number(verse.verse)),
    original: firstNonEmpty(verse.original, verse.original_text, verse.text, tokens.map((t) => t.surface).join(' ')),
    english: firstNonEmpty(verse.web, verse.english),
    tokens,
  };
}

async function executeGeographySearch(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'geography_search' }>,
): Promise<Record<string, unknown>> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const [rows, atlasResult] = await Promise.all([
    callRpc(ctx.read, 'query_places_by_name', { query: op.place }, limit, 0).catch(() => []),
    queryMcpPlaces({ query: op.place, limit: Math.min(limit, 30) }).catch(() => null),
  ]);
  const atlasPlaces = asArray(atlasResult?.places)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null);
  const atlasByName = new Map<string, Record<string, unknown>>();
  for (const ap of atlasPlaces) {
    const nameKey = firstNonEmpty(ap.name).toLowerCase();
    if (nameKey && !atlasByName.has(nameKey)) atlasByName.set(nameKey, ap);
    for (const alias of asArray(ap.aliases)) {
      if (typeof alias === 'string' && alias.trim() && !atlasByName.has(alias.trim().toLowerCase())) {
        atlasByName.set(alias.trim().toLowerCase(), ap);
      }
    }
  }

  const placesRaw = extractRowsOrField(rows, 'places', 'items', 'results');
  const seenNames = new Set<string>();
  const places: Record<string, unknown>[] = placesRaw.slice(0, limit).map((p) => {
    const placeName = firstNonEmpty(p.place, p.name, p.ancient_name);
    const atlasMatch = atlasByName.get(placeName.toLowerCase()) ?? null;
    if (placeName) seenNames.add(placeName.toLowerCase());

    const dbLat = typeof p.lat === 'number' && Number.isFinite(p.lat)
      ? p.lat
      : typeof p.latitude === 'number' && Number.isFinite(p.latitude)
        ? p.latitude
        : null;
    const dbLon = typeof p.lon === 'number' && Number.isFinite(p.lon)
      ? p.lon
      : typeof p.lng === 'number' && Number.isFinite(p.lng)
        ? p.lng
        : typeof p.longitude === 'number' && Number.isFinite(p.longitude)
          ? p.longitude
          : null;
    const lat = dbLat ?? (typeof atlasMatch?.latitude === 'number' ? atlasMatch.latitude : null);
    const lon = dbLon ?? (typeof atlasMatch?.longitude === 'number' ? atlasMatch.longitude : null);

    return {
      place: placeName,
      place_type: firstNonEmpty(p.place_type, p.type, atlasMatch?.feature_type, 'unknown'),
      modern_name: firstNonEmpty(p.modern_name, p.modern) || null,
      lat,
      lon,
      ...(p.is_non_physical !== undefined ? { is_non_physical: p.is_non_physical } : {}),
      ...(atlasMatch ? {
        strongs: atlasMatch.strongs ?? [],
        precision: atlasMatch.precision ?? null,
        provenance: atlasMatch.provenance ?? null,
        source: 'database+context_atlas',
      } : { source: 'database' }),
      linked_passages: asArray(p.linked_passages ?? p.passages ?? p.refs).slice(0, 12).map((raw) => {
        const link = asRecord(raw);
        return link
          ? { ...link, ref: readableReference(link.ref ?? link.evidence_ref), role: firstNonEmpty(link.role, link.relationship_type, 'unknown') }
          : { ref: readableReference(raw), role: 'unknown' };
      }),
      coverage: 'Published links only; roles are source assertions. Unknown roles do not establish event or audience location.',
      events: asArray(p.events).slice(0, 8),
    };
  });

  for (const ap of atlasPlaces) {
    if (places.length >= limit) break;
    const name = firstNonEmpty(ap.name);
    if (!name || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());
    places.push({
      place: name,
      place_lookup: ap.place_lookup ?? null,
      place_type: firstNonEmpty(ap.feature_type, 'unknown'),
      aliases: ap.aliases ?? [],
      lat: typeof ap.latitude === 'number' ? ap.latitude : null,
      lon: typeof ap.longitude === 'number' ? ap.longitude : null,
      precision: ap.precision ?? null,
      strongs: ap.strongs ?? [],
      verse_count: ap.verse_count ?? 0,
      provenance: ap.provenance ?? null,
      source: 'context_atlas',
      linked_passages: [],
      coverage: 'Static OpenBible/Pleiades corpus index entry; no verse-role links attached in this row.',
      events: [],
    });
  }

  const qPlaceLower = op.place.trim().toLowerCase();
  places.sort((a, b) => {
    const aName = firstNonEmpty(a.place).toLowerCase();
    const bName = firstNonEmpty(b.place).toLowerCase();
    const aScore = aName === qPlaceLower ? 0 : aName.startsWith(qPlaceLower) ? 1 : 2;
    const bScore = bName === qPlaceLower ? 0 : bName.startsWith(qPlaceLower) ? 1 : 2;
    return aScore - bScore;
  });

  return {
    status: places.length > 0 ? 'ok' : 'not_found',
    query: op.place,
    places,
    ...(atlasResult?.source ? { atlas_source: atlasResult.source } : {}),
    ...(atlasResult?.provenance_sources ? { provenance_sources: atlasResult.provenance_sources } : {}),
  };
}

async function executePassageCompare(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'passage_compare' }>,
): Promise<Record<string, unknown>> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const parsedPassages: Array<{ input: string; parsed: ParsedPassage }> = [];
  for (const p of op.passages) {
    const parsed = parsePassageString(p);
    if (!parsed) {
      return { status: 'invalid_request', error: `Could not parse passage: ${p}` };
    }
    parsedPassages.push({ input: p, parsed });
  }

  const hydratedPassages = await Promise.all(
    parsedPassages.map(async ({ parsed }) => ({
      normalized: parsed.normalized,
      verses: await hydrateCompactVersesByPassage(ctx.read, parsed, parsed.verse_count),
    })),
  );
  const wordIds = [...new Set(hydratedPassages.flatMap((p) => p.verses.flatMap((v) => asArray(v.words ?? v.tokens).map((t) => Number(asRecord(t)?.word_id)))))]
    .filter((id) => Number.isInteger(id) && id > 0);
  const wordById = new Map<number, Record<string, unknown>>();
  try {
    const rows = wordIds.length ? await callRpc(ctx.read, 'get_words_batch', { word_ids: wordIds }, wordIds.length, 0) : [];
    for (const row of rows) wordById.set(Number(row.id), row);
  } catch {
    // Verified source tokens remain available without optional enrichment.
  }

  const lemmaCountsPerPassage = hydratedPassages.map((p) => {
    const map = new Map<string, { strongs: string; lemma: string; gloss: string; count: number }>();
    for (const verse of p.verses) {
      for (const rawTok of asArray(verse.words ?? verse.tokens)) {
        const tok = asRecord(rawTok);
        if (!tok) continue;
        const strongs = firstNonEmpty(tok.strongs, tok.strongs_id).toUpperCase();
        const posClass = firstNonEmpty(tok.pos_class, tok.pos);
        if (!strongs || isFunctionWord({ strongs, pos_class: posClass })) continue;
        const existing = map.get(strongs);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(strongs, {
            strongs,
            lemma: firstNonEmpty(tok.lemma, tok.text, tok.form),
            gloss: firstNonEmpty(tok.gloss),
            count: 1,
          });
        }
      }
    }
    return map;
  });

  const sharedLemmas: Array<{ strongs: string; lemma: string; gloss: string; counts: number[]; passage_indices?: number[] }> = [];
  if (lemmaCountsPerPassage.length >= 2) {
    const allStrongs = new Set<string>();
    for (const m of lemmaCountsPerPassage) {
      for (const s of m.keys()) {
        if (!RESEARCH_STOPWORD_STRONGS.has(padStrongs(s))) allStrongs.add(s);
      }
    }
    for (const strongs of allStrongs) {
      const idxs: number[] = [];
      let sampleEntry: { lemma: string; gloss: string } | null = null;
      lemmaCountsPerPassage.forEach((m, i) => {
        const hit = m.get(strongs);
        if (hit) {
          idxs.push(i);
          if (!sampleEntry) sampleEntry = hit;
        }
      });
      if (idxs.length >= 2 && sampleEntry) {
        sharedLemmas.push({
          strongs,
          lemma: (sampleEntry as { lemma: string; gloss: string }).lemma,
          gloss: (sampleEntry as { lemma: string; gloss: string }).gloss,
          counts: lemmaCountsPerPassage.map((m) => m.get(strongs)?.count ?? 0),
          ...(idxs.length < lemmaCountsPerPassage.length ? { passage_indices: idxs } : {}),
        });
      }
    }
    sharedLemmas.sort((a, b) => (b.passage_indices ? 0 : 1) - (a.passage_indices ? 0 : 1) || (b.counts.reduce((x, y) => x + y, 0) - a.counts.reduce((x, y) => x + y, 0)));
  }

  // Batch-load compact profiles for top non-stopword lemmas to find cross-testament LXX bridges & shared root cognates
  const lxxBridgedLemmas: Array<Record<string, unknown>> = [];
  const sharedRootCognates: Array<Record<string, unknown>> = [];
  const topStrongsPerPassage = lemmaCountsPerPassage.map(m =>
    [...m.values()]
      .filter(x => !RESEARCH_STOPWORD_STRONGS.has(padStrongs(x.strongs)))
      .sort((a, b) => b.count - a.count)
      .slice(0, 14)
      .map(x => padStrongs(x.strongs)),
  );
  const uniqueBatchStrongs: string[] = [];
  const seenBatchStrongs = new Set<string>();
  const maxSliceLen = Math.max(0, ...topStrongsPerPassage.map(a => a.length));
  for (let k = 0; k < maxSliceLen && uniqueBatchStrongs.length < 36; k++) {
    for (const arr of topStrongsPerPassage) {
      if (k < arr.length && !seenBatchStrongs.has(arr[k])) {
        seenBatchStrongs.add(arr[k]);
        uniqueBatchStrongs.push(arr[k]);
        if (uniqueBatchStrongs.length >= 36) break;
      }
    }
  }
  if (uniqueBatchStrongs.length > 0 && lemmaCountsPerPassage.length >= 2) {
    try {
      const pRows = await callRpc(
        ctx.read,
        'get_word_profiles_batch_v1',
        { strongs: uniqueBatchStrongs, include_vids: false, include_forms: false, include_orth: false, include_pilot: false },
        1,
        0,
      );
      const profMap = asRecord(extractFirstObject(pRows)?.profiles) ?? {};
      const seenLxxIdx = new Map<string, number>();
      const seenRoot = new Set<string>();
      const recordLxxPair = (pSrc: string, pTgt: string, profSrc: Record<string, unknown>, lx: Record<string, unknown>, idxA: number, idxB: number) => {
        const key = [pSrc, pTgt].sort().join(':');
        const pRefA = hydratedPassages[idxA].normalized;
        const pRefB = hydratedPassages[idxB].normalized;
        const existingIdx = seenLxxIdx.get(key);
        if (existingIdx !== undefined) {
          const prevPassages = asArray(lxxBridgedLemmas[existingIdx].passages).map(String);
          if (!prevPassages.includes(pRefA)) prevPassages.push(pRefA);
          if (!prevPassages.includes(pRefB)) prevPassages.push(pRefB);
          lxxBridgedLemmas[existingIdx].passages = prevPassages;
          return;
        }
        seenLxxIdx.set(key, lxxBridgedLemmas.length);
        const tokGlossSrc = [...lemmaCountsPerPassage[idxA].values()].find(x => padStrongs(x.strongs) === pSrc)?.gloss;
        lxxBridgedLemmas.push({
          from_strongs: pSrc,
          from_lemma: profSrc.sc,
          from_gloss: tokGlossSrc || profSrc.gl,
          to_strongs: pTgt,
          to_lemma: lx.script,
          to_gloss: lx.gloss,
          lxx_count: lx.count ?? 1,
          passages: [pRefA, pRefB],
        });
      };
      for (let i = 0; i < lemmaCountsPerPassage.length; i++) {
        const paddedKeysI = new Set([...lemmaCountsPerPassage[i].keys()].map(padStrongs));
        for (let j = i + 1; j < lemmaCountsPerPassage.length; j++) {
          const paddedKeysJ = new Set([...lemmaCountsPerPassage[j].keys()].map(padStrongs));
          for (const bsA of lemmaCountsPerPassage[i].keys()) {
            const pBsA = padStrongs(bsA);
            if (RESEARCH_STOPWORD_STRONGS.has(pBsA)) continue;
            const profA = asRecord(profMap[pBsA]);
            if (!profA) continue;
            const tvA = typeof profA.total_verses === 'number' ? profA.total_verses : 0;
            if (tvA <= 450) {
              for (const rawLx of asArray(profA.lxx_relations)) {
                const lx = asRecord(rawLx);
                if (!lx) continue;
                const tBs = padStrongs(firstNonEmpty(lx.target_strongs));
                if (!tBs || RESEARCH_STOPWORD_STRONGS.has(tBs) || !paddedKeysJ.has(tBs)) continue;
                recordLxxPair(pBsA, tBs, profA, lx, i, j);
              }
            }
            if (tvA <= 220) {
              for (const rawLr of asArray(profA.lexical_relations)) {
                const lr = asRecord(rawLr);
                if (!lr || lr.type === 'shared_name_base' || lr.type === 'group_member_of') continue;
                const tBs = padStrongs(firstNonEmpty(lr.target_strongs));
                if (!tBs || tBs === pBsA || tBs[0] !== pBsA[0] || RESEARCH_STOPWORD_STRONGS.has(tBs) || !paddedKeysJ.has(tBs)) continue;
                const key = [pBsA, tBs].sort().join(':');
                if (seenRoot.has(key)) continue;
                seenRoot.add(key);
                sharedRootCognates.push({
                  from_strongs: pBsA,
                  from_lemma: profA.sc,
                  to_strongs: tBs,
                  to_lemma: lr.script,
                  relation: lr.type,
                  ...(lr.root ? { root: lr.root } : {}),
                  passages: [hydratedPassages[i].normalized, hydratedPassages[j].normalized],
                });
              }
            }
          }
          // Reverse lookup from passage j profiles into passage i (catches rare NT/Greek or third-passage anchors whose LXX relation lives on the other side)
          for (const bsB of lemmaCountsPerPassage[j].keys()) {
            const pBsB = padStrongs(bsB);
            if (RESEARCH_STOPWORD_STRONGS.has(pBsB)) continue;
            const profB = asRecord(profMap[pBsB]);
            if (!profB) continue;
            const tvB = typeof profB.total_verses === 'number' ? profB.total_verses : 0;
            if (tvB <= 450) {
              for (const rawLx of asArray(profB.lxx_relations)) {
                const lx = asRecord(rawLx);
                if (!lx) continue;
                const tBs = padStrongs(firstNonEmpty(lx.target_strongs));
                if (!tBs || RESEARCH_STOPWORD_STRONGS.has(tBs) || !paddedKeysI.has(tBs)) continue;
                recordLxxPair(pBsB, tBs, profB, lx, j, i);
              }
            }
          }
        }
      }
    } catch {
      // Non-fatal: continue with intra-testament shared_lemmas & xrefs
    }
  }

  let crossConnections: CompactConnection[] = [];
  const warnings: string[] = [];
  const verseIdSets = hydratedPassages.map((p) => new Set(
    p.verses.map((v) => Number(v.verse_id)).filter((n) => Number.isInteger(n) && n > 0),
  ));
  for (let i = 0; i < hydratedPassages.length; i++) {
    for (const v of hydratedPassages[i].verses) {
      const fromRef = firstNonEmpty(v.ref, 'verse');
      for (const rawXr of asArray(v.xrefs)) {
        const xr = asRecord(rawXr);
        const targetVid = Number(xr?.target_vid ?? (Array.isArray(rawXr) ? rawXr[0] : 0));
        const targetRef = firstNonEmpty(xr?.ref, xr?.target_ref, Array.isArray(rawXr) ? rawXr[1] : '');
        const phrase = firstNonEmpty(xr?.phrase, Array.isArray(rawXr) ? rawXr[2] : '');
        const matchedIdx = verseIdSets.findIndex((s, j) => j !== i && s.has(targetVid));
        if (matchedIdx >= 0) {
          crossConnections.push({
            id: `xref:${v.verse_id}:${targetVid}`,
            relation: 'cross_reference',
            epistemic: 'editorial_cross_reference',
            tier: 4,
            title: `${fromRef} <-> ${targetRef || `vid:${targetVid}`}`,
            why: phrase ? `Cross-reference witness ("${phrase}")` : 'Direct cross-reference between compared passages',
            refs: [fromRef, ...(targetRef ? [targetRef] : [])],
          });
        }
      }
    }
  }
  try {
    const discRows = await callRpc(
      ctx.read,
      'discover_biblical_connections_v2',
      {
        query: parsedPassages.map((p) => p.parsed.normalized).join(' ; '),
        mode: 'compare',
        compare_targets: parsedPassages.map((p) => p.parsed.normalized),
        limit: Math.min(limit, 25),
      },
      1,
      0,
    );
    const payload = extractFirstObject(discRows);
    const rawConns = asArray(payload?.strongest_connections ?? payload?.connections)
      .map((c) => asRecord(c))
      .filter((c): c is Record<string, unknown> => c !== null);
    crossConnections.push(...rawConns
      .map((c) => normalizeDiscoveryConnection(c))
      .filter((c): c is CompactConnection => c !== null));
  } catch {
    warnings.push('Connection discovery unavailable; direct cross-references remain available. Retry to retrieve graph bridges.');
  }

  const lexicon: Record<string, unknown> = {};
  const compactMode = op.detail !== 'full';
  const passages = hydratedPassages.map((p) => ({
    normalized: p.normalized,
    verses: compactMode
      ? p.verses.map((v) => formatResearchVerse(v, true))
      : p.verses.map((v) => compactComparisonVerse(v, wordById, lexicon)),
  }));
  return {
    status: 'ok',
    passages,
    ...(compactMode ? {} : { lexicon }),
    word_enrichment: 'Transliteration/grammar require matching word ID, surface and Strong\'s. Missing fields are unverified/unavailable. tokens[].key indexes lexicon; its lemma_key is the source identity. verse_id + position identifies an occurrence.',
    ...(warnings.length ? { warnings } : {}),
    shared_lemmas: sharedLemmas.slice(0, limit),
    ...(lxxBridgedLemmas.length > 0 ? { lxx_bridged_lemmas: lxxBridgedLemmas.slice(0, limit) } : {}),
    ...(sharedRootCognates.length > 0 ? { shared_root_cognates: sharedRootCognates.slice(0, limit) } : {}),
    cross_references_and_bridges: crossConnections.slice(0, limit),
  };
}

async function executeNotesSearch(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'notes_search' }>,
): Promise<Record<string, unknown>> {
  if (!op.passage && !op.word) {
    return {
      epistemic_layer: 'user_note',
      notice: NOTE_SECURITY_NOTICE,
      status: 'invalid_request',
      error: 'Provide passage or word for notes_search.',
    };
  }
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);

  if (op.passage) {
    const parsed = parsePassageString(op.passage);
    if (!parsed) {
      return {
        epistemic_layer: 'user_note',
        notice: NOTE_SECURITY_NOTICE,
        status: 'invalid_request',
        error: `Could not parse passage: ${op.passage}`,
      };
    }
    const span = parsed.passages[0];
    const rows = await callRpc(
      ctx.read,
      'get_notes_for_passage_v1',
      {
        p_book: span.book,
        p_chapter: span.chapter,
        p_verse_start: span.start_verse,
        p_verse_end: span.end_verse,
        p_author_kind: null,
        p_note_kind: null,
        p_limit: limit,
      },
      1,
      0,
    );
    const rawNotes = extractFirstObject(rows);
    const primary = asArray(rawNotes?.primary)
      .map((n) => asRecord(n))
      .filter((n): n is Record<string, unknown> => n !== null)
      .map(formatCompactNote);
    const secondary = asArray(rawNotes?.secondary)
      .map((n) => asRecord(n))
      .filter((n): n is Record<string, unknown> => n !== null)
      .map(formatCompactNote);

    let dlmNotes: Record<string, unknown> | undefined;
    if (op.include_dlm) {
      try {
        const dlmRows = await callRpc(
          ctx.read,
          'get_dlm_notes_for_verse_v1',
          { p_book: span.book, p_chapter: span.chapter, p_verse: span.start_verse, p_limit: Math.min(limit, 20) },
          1,
          0,
        );
        dlmNotes = extractFirstObject(dlmRows) ?? undefined;
      } catch {
        // Optional DLM layer.
      }
    }

    let kgClaims: Record<string, unknown>[] | undefined;
    if (op.include_kg !== false) {
      try {
        const kgRows = await callRpc(
          ctx.read,
          'rg_search_v1',
          {
            p_query: parsed.normalized,
            p_filters: { include_superseded: false },
            p_limit: Math.min(limit, 8),
            p_offset: 0,
          },
          1,
          0,
        );
        const kgPayload = extractFirstObject(kgRows);
        const rawItems = asArray(kgPayload?.items).map((c) => asRecord(c)).filter((c): c is Record<string, unknown> => c !== null);
        if (rawItems.length > 0) kgClaims = rawItems;
      } catch {
        // Optional KG layer.
      }
    }

    return {
      epistemic_layer: 'user_note',
      notice: NOTE_SECURITY_NOTICE,
      status: 'ok',
      passage: parsed.normalized,
      untrusted_notes: { primary, secondary },
      ...(dlmNotes ? { untrusted_dlm_notes: dlmNotes } : {}),
      ...(kgClaims ? { untrusted_kg_claims: kgClaims } : {}),
    };
  }

  let wordId: number | null = /^\d+$/.test(op.word!) ? Number(op.word) : null;
  if (wordId === null) {
    const resolved = await resolveWordFast(ctx.read, op.word!);
    wordId = resolved?.wordId ?? null;
  }
  if (wordId === null) {
    return {
      epistemic_layer: 'user_note',
      notice: NOTE_SECURITY_NOTICE,
      status: 'not_found',
      word: op.word,
      untrusted_notes: { items: [] },
    };
  }

  const rows = await callRpc(
    ctx.read,
    'get_notes_for_word_v1',
    { p_word_id: wordId, p_verse_id: null, p_word_position: null, p_limit: limit },
    1,
    0,
  );
  const rawNotes = extractFirstObject(rows);
  const items = extractRowsOrField(rows, 'items', 'primary', 'notes').map(formatCompactNote);

  let kgWordClaims: Record<string, unknown>[] | undefined;
  if (op.include_kg !== false) {
    try {
      const kgRows = await callRpc(
        ctx.read,
        'rg_search_v1',
        {
          p_query: op.word!,
          p_filters: { include_superseded: false },
          p_limit: Math.min(limit, 8),
          p_offset: 0,
        },
        1,
        0,
      );
      const kgPayload = extractFirstObject(kgRows);
      const rawItems = asArray(kgPayload?.items).map((c) => asRecord(c)).filter((c): c is Record<string, unknown> => c !== null);
      if (rawItems.length > 0) kgWordClaims = rawItems;
    } catch {
      // Optional KG layer.
    }
  }

  return {
    epistemic_layer: 'user_note',
    notice: NOTE_SECURITY_NOTICE,
    status: 'ok',
    word: op.word,
    word_id: wordId,
    untrusted_notes: rawNotes ? { ...rawNotes, compacted: items } : { items },
    ...(kgWordClaims ? { untrusted_kg_claims: kgWordClaims } : {}),
  };
}

async function executeSetCombine(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'set_combine' }>,
): Promise<{ result: Record<string, unknown>; storedIds: number[] }> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const combineKind = op.combine ?? 'intersect';
  const refs = op.refs ?? [];

  const looksLikeBmwKey = (k: string) =>
    /^(?:[HG]\d+|c:|lxx:|role:)/i.test(k.trim());

  const includeTerms = op.include && op.include.length > 0
    ? op.include
    : (combineKind === 'intersect' && refs.length > 0 && refs.every(r => !ctx.verseIdStore.has(r) && looksLikeBmwKey(r))
        ? refs
        : null);

  if (includeTerms && includeTerms.length > 0) {
    const rows = await callRpc(ctx.read, 'set_combine_v3', {
      include: includeTerms,
      ...(op.exclude && op.exclude.length > 0 ? { exclude: op.exclude } : {}),
      ...(op.testament ? { testament: op.testament } : {}),
      ...(op.book !== undefined ? { book: op.book } : {}),
      ...(op.mode ? { mode: op.mode } : {}),
      limit,
      hydrate_verses: op.hydrate_verses ?? true,
    }, 1, 0);
    const payload = extractFirstObject(rows) ?? { status: 'unavailable', vids: [], verses: [] };
    const vids = asArray(payload.vids).filter((n): n is number => typeof n === 'number' && n > 0);
    return {
      result: {
        ...payload,
        combine: combineKind,
        verse_ids: vids,
      },
      storedIds: vids,
    };
  }

  if (refs.length < 2) {
    return {
      result: {
        status: 'invalid_request',
        error: 'Provide include[] keys for BMW bitset set_combine or >= 2 refs[] from earlier batch operations.',
        verse_ids: [],
        verses: [],
      },
      storedIds: [],
    };
  }

  const resolvedSets: number[][] = [];
  const missingRefs: string[] = [];

  for (const ref of refs) {
    const ids = ctx.verseIdStore.get(ref);
    if (!ids) {
      missingRefs.push(ref);
    } else {
      resolvedSets.push(ids);
    }
  }

  if (missingRefs.length > 0) {
    return {
      result: {
        status: 'invalid_reference',
        missing_refs: missingRefs,
        verse_ids: [],
        verses: [],
      },
      storedIds: [],
    };
  }

  let combined: number[] = [];
  if (combineKind === 'intersect') {
    const base = resolvedSets[0] ?? [];
    const restSets = resolvedSets.slice(1).map((s) => new Set(s));
    combined = Array.from(new Set(base.filter((id) => restSets.every((set) => set.has(id)))));
  } else if (combineKind === 'union') {
    const unionSet = new Set<number>();
    for (const s of resolvedSets) {
      for (const id of s) unionSet.add(id);
    }
    combined = Array.from(unionSet).sort((a, b) => a - b);
  } else {
    const base = resolvedSets[0] ?? [];
    const excludeSet = new Set<number>();
    for (const s of resolvedSets.slice(1)) {
      for (const id of s) excludeSet.add(id);
    }
    combined = Array.from(new Set(base.filter((id) => !excludeSet.has(id))));
  }

  const topIds = combined.slice(0, limit);
  const verses = await hydrateCompactVersesByIds(ctx.read, topIds);

  return {
    result: {
      status: 'ok',
      combine: combineKind,
      refs,
      total_matches: combined.length,
      verse_ids: topIds,
      verses,
    },
    storedIds: combined,
  };
}

function splitCompareQueryPassages(query: string): string[] | null {
  const semi = query.split(/\s*[;|]\s*|\s+\bvs\.?\b\s+|\s+\band\b\s+/i).map((s) => s.trim()).filter(Boolean);
  if (semi.length >= 2 && semi.every((part) => isPassageLike(part))) {
    return semi.slice(0, 4);
  }
  const commaParts = query.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  if (commaParts.length >= 2 && commaParts.every((part) => isPassageLike(part))) {
    return commaParts.slice(0, 4);
  }
  return null;
}

/**
 * Execute either structured research operations[] (up to 8 per call) or a
 * shorthand query string (r10/r11/r12 evidence ID, 2+ passages compare, or
 * discovery query normalized to CompactConnection[]).
 */
export function formatLiteraryStructureMcp(
  payload: Record<string, unknown>,
  mode: 'compact' | 'standard' | 'deep',
): Record<string, unknown> {
  const isCompact = mode === 'compact';
  const isDeep = mode === 'deep';
  const seg = asRecord(payload.segmentation);
  const tmpl = asRecord(payload.template);
  const maxDev = isCompact ? 6 : isDeep ? 60 : 30;
  const maxSym = isCompact ? 4 : isDeep ? 24 : 14;
  const maxWp = isCompact ? 4 : isDeep ? 24 : 14;
  const maxKw = isCompact ? 8 : isDeep ? 35 : 20;
  const maxCorr = isCompact ? 4 : isDeep ? 24 : 12;
  const maxCmd = isCompact ? 6 : isDeep ? 35 : 18;
  const maxCluster = isCompact ? 4 : isDeep ? 20 : 12;

  const rawUnits = asArray(seg?.units).map(u => asRecord(u)).filter((u): u is Record<string, unknown> => u !== null);
  const rawAlts = asArray(payload.alternativeSegmentations).map(a => asRecord(a)).filter((a): a is Record<string, unknown> => a !== null);
  const rawSlots = asArray(tmpl?.slots).map(s => asRecord(s)).filter((s): s is Record<string, unknown> => s !== null);

  return {
    status: firstNonEmpty(payload.status, 'ok'),
    schema_version: payload.schemaVersion ?? 1,
    passage: payload.passage ?? null,
    edition: payload.edition ?? null,
    token_count: payload.tokenCount ?? 0,
    verse_count: payload.verseCount ?? 0,
    coverage: payload.coverage ?? null,
    ...(seg ? {
      segmentation: {
        anchor_text: seg.anchorText ?? null,
        anchor_side: seg.anchorSide ?? null,
        signals: seg.signals ?? [],
        mdl_savings_bits: seg.mdlSavingsBits ?? 0,
        confidence: seg.confidence ?? null,
        epistemic_class: seg.epistemicClass ?? 'candidate_literary_pattern',
        introduction: seg.introduction ?? null,
        sections: asArray(seg.sections).map(s => {
          const sr = asRecord(s);
          return sr ? {
            role: sr.role,
            label: sr.label,
            from_ref: sr.fromRef,
            to_ref: sr.toRef,
            rationale: sr.rationale,
          } : s;
        }),
        units: rawUnits.slice(0, isCompact ? 10 : rawUnits.length).map(u => ({
          index: u.index,
          label: u.label,
          from_ref: u.fromRef,
          to_ref: u.toRef,
          verse_count: asArray(u.verseIds).length,
          ...(isCompact
            ? { subunit_count: asArray(u.subunits).length }
            : {
                subunits: asArray(u.subunits).map(su => {
                  const sur = asRecord(su);
                  return sur ? {
                    kind: sur.kind,
                    label: sur.label,
                    from_ref: sur.fromRef,
                    to_ref: sur.toRef,
                    summary: sur.summary,
                    word_ids: sur.wordIds,
                  } : su;
                }),
              }),
        })),
        conclusion: seg.conclusion ?? null,
      },
    } : { segmentation: null }),
    ...(rawAlts.length > 0 ? {
      alternative_segmentations: rawAlts.slice(0, isCompact ? 2 : 4).map(a => ({
        anchor_text: a.anchorText ?? null,
        anchor_side: a.anchorSide ?? null,
        unit_count: asArray(a.units).length,
        signals: a.signals ?? [],
        mdl_savings_bits: a.mdlSavingsBits ?? 0,
        confidence: a.confidence ?? null,
      })),
    } : {}),
    ...(tmpl ? {
      template: {
        mdl_savings_bits: tmpl.mdlSavingsBits ?? 0,
        compression_proxy: tmpl.compressionProxy ?? 0,
        slots: rawSlots.slice(0, isCompact ? 8 : 40).map(sl => {
          const cells = asArray(sl.cells).map(c => asRecord(c)).filter((c): c is Record<string, unknown> => c !== null);
          return {
            col: sl.columnIndex,
            label: sl.label,
            canonical_key: sl.canonicalKey,
            role: sl.role,
            support: sl.support,
            ...(isCompact
              ? {
                  present_units: cells.filter(c => c.present).map(c => c.unitIndex),
                  absent_units: cells.filter(c => !c.present).map(c => c.unitIndex),
                  deviant_cells: cells
                    .filter(c => c.isDeviant || !c.present)
                    .slice(0, 3)
                    .map(c => ({ unit_index: c.unitIndex, present: c.present, ref: c.ref, deviation_kind: c.deviationKind ?? null })),
                }
              : {
                  cells: cells.map(c => ({
                    unit_index: c.unitIndex,
                    present: c.present,
                    key: c.key,
                    ref: c.ref,
                    text: c.text,
                    is_deviant: c.isDeviant,
                    ...(c.deviationKind ? { deviation_kind: c.deviationKind } : {}),
                    word_ids: c.wordIds,
                  })),
                }),
          };
        }),
      },
    } : {}),
    pattern_families: asArray(payload.patternFamilies).slice(0, isCompact ? 6 : 28).map(pf => {
      const pfr = asRecord(pf) ?? {};
      const spans = asArray(pfr.spans).map(sp => asRecord(sp)).filter((sp): sp is Record<string, unknown> => sp !== null);
      return {
        id: pfr.id,
        category: pfr.category,
        label: pfr.label,
        description: pfr.description,
        color_slot: pfr.colorSlot,
        priority: pfr.priority,
        default_visible: pfr.defaultVisible,
        evidence_channel: pfr.evidenceChannel,
        epistemic_class: pfr.epistemicClass,
        span_count: spans.length,
        ...(isCompact
          ? { sample_refs: spans.slice(0, 6).map(s => s.ref) }
          : {
              spans: spans.slice(0, 32).map(s => ({
                span_id: s.spanId,
                ref: s.ref,
                from_token_index: s.fromTokenIndex,
                to_token_index: s.toTokenIndex,
                word_ids: s.wordIds,
                text: s.text,
                gloss: s.gloss,
                unit_index: s.unitIndex,
                ...(s.role ? { role: s.role } : {}),
                has_deviation: Boolean(s.hasDeviation),
                ...(s.deviationKind ? { deviation_kind: s.deviationKind } : {}),
                ...(s.deviationNote ? { deviation_note: s.deviationNote } : {}),
                nested_depth: s.nestedDepth ?? 0,
              })),
            }),
      };
    }),
    deviations: asArray(payload.deviations).slice(0, maxDev).map(d => {
      const dr = asRecord(d) ?? {};
      return {
        kind: dr.kind,
        unit_index: dr.unitIndex,
        unit_label: dr.unitLabel,
        ref: dr.ref,
        expected: dr.expected,
        observed: dr.observed,
        description: dr.description,
        surprisal_bits: dr.surprisalBits,
        confidence: dr.confidence,
        evidence_channel: dr.evidenceChannel,
        epistemic_class: dr.epistemicClass,
        witness_word_ids: asArray(dr.witnessWordIds).slice(0, isCompact ? 4 : 12),
        ...(dr.uncertaintyNote ? { uncertainty_note: dr.uncertaintyNote } : {}),
      };
    }),
    command_fulfillments: asArray(payload.commandFulfillments).slice(0, maxCmd).map(cf => {
      const cfr = asRecord(cf) ?? {};
      return {
        unit_index: cfr.unitIndex,
        kind: cfr.kind,
        command_ref: cfr.commandRef,
        fulfillment_ref: cfr.fulfillmentRef,
        shared_lemmas: cfr.sharedLemmas,
        explicit_formula: cfr.explicitFormula,
        ...(isCompact ? {} : {
          command_word_ids: cfr.commandWordIds,
          fulfillment_word_ids: cfr.fulfillmentWordIds,
        }),
      };
    }),
    correspondences: asArray(payload.correspondences).slice(0, maxCorr).map(co => {
      const cor = asRecord(co) ?? {};
      return {
        unit_a: cor.unitA,
        unit_b: cor.unitB,
        label_a: cor.labelA,
        label_b: cor.labelB,
        score: cor.score,
        evidence_channel: cor.evidenceChannel,
        shared_concepts: cor.sharedConcepts,
        shared_lexemes: asArray(cor.sharedLexemes).slice(0, isCompact ? 4 : 10),
      };
    }),
    symmetries: asArray(payload.symmetries).slice(0, maxSym).map(sy => {
      const syr = asRecord(sy) ?? {};
      return {
        kind: syr.kind,
        level: syr.level,
        gapped: syr.gapped,
        from_ref: syr.fromRef,
        to_ref: syr.toRef,
        reverse_mean: syr.reverseMean,
        forward_mean: syr.forwardMean,
        score: syr.score,
        confidence: syr.confidence,
        epistemic_class: syr.epistemicClass,
        ...(syr.alternativeExplanation ? { alternative_explanation: syr.alternativeExplanation } : {}),
        ...(syr.center ? { center: syr.center } : {}),
        pairs: asArray(syr.pairs).slice(0, isCompact ? 6 : 16).map(pr => {
          const prr = asRecord(pr) ?? {};
          return {
            label: prr.label,
            left_ref: prr.leftRef,
            right_ref: prr.rightRef,
            left_text: prr.leftText,
            right_text: prr.rightText,
            similarity: prr.similarity,
            evidence_channel: prr.evidenceChannel,
            ...(isCompact ? {} : { left_word_ids: prr.leftWordIds, right_word_ids: prr.rightWordIds }),
          };
        }),
      };
    }),
    wordplays: asArray(payload.wordplays).slice(0, maxWp).map(wp => {
      const wpr = asRecord(wp) ?? {};
      const wa = asRecord(wpr.wordA) ?? {};
      const wb = asRecord(wpr.wordB) ?? {};
      return {
        epistemic_class: wpr.epistemicClass,
        overlap_kind: wpr.overlapKind,
        shared_consonants: wpr.sharedConsonants,
        distance_tokens: wpr.distanceTokens,
        in_literary_context: wpr.inLiteraryContext,
        context_cues: wpr.contextCues,
        score: wpr.score,
        confidence: wpr.confidence,
        word_a: {
          id: wa.id,
          ref: wa.ref,
          form: wa.form,
          transliteration: wa.transliteration,
          gloss: wa.gloss,
          strongs: wa.strongs,
          lemma: wa.lemma,
          matched_char_indices: wa.matchedCharIndices,
        },
        word_b: {
          id: wb.id,
          ref: wb.ref,
          form: wb.form,
          transliteration: wb.transliteration,
          gloss: wb.gloss,
          strongs: wb.strongs,
          lemma: wb.lemma,
          matched_char_indices: wb.matchedCharIndices,
        },
        etymology_disclaimer: wpr.etymologyDisclaimer,
      };
    }),
    key_words: asArray(payload.keyWords).slice(0, maxKw).map(kw => {
      const kwr = asRecord(kw) ?? {};
      return {
        strongs: kwr.strongs,
        lemma_key: kwr.lemmaKey,
        script: kwr.script,
        transliteration: kwr.transliteration,
        gloss: kwr.gloss,
        count: kwr.count,
        unit_counts: kwr.unitCounts,
        idf_salience: kwr.idfSalience,
        is_notable_count: kwr.isNotableCount,
        ...(kwr.notableCountLabel ? { notable_count_label: kwr.notableCountLabel } : {}),
        verse_refs: asArray(kwr.verseRefs).slice(0, isCompact ? 6 : 24),
        ...(isCompact ? {} : { word_ids: asArray(kwr.wordIds).slice(0, 30) }),
      };
    }),
    acrostics: asArray(payload.acrostics).map(ac => {
      const acr = asRecord(ac) ?? {};
      return {
        mode: acr.mode,
        stanza_size: acr.stanzaSize,
        letters_covered: acr.lettersCovered,
        total_letters: acr.totalLetters,
        coverage_ratio: acr.coverageRatio,
        missing_letters: acr.missingLetters,
        confidence: acr.confidence,
        epistemic_class: acr.epistemicClass,
        entries: isCompact ? asArray(acr.entries).slice(0, 8) : asArray(acr.entries),
      };
    }),
    thematic_clusters: asArray(payload.thematicClusters).slice(0, maxCluster).map(tc => {
      const tcr = asRecord(tc) ?? {};
      return {
        theme_label: tcr.themeLabel,
        source: tcr.source,
        score: tcr.score,
        evidence_channel: tcr.evidenceChannel,
        unit_indices: tcr.unitIndices,
        lemmas: tcr.lemmas,
        refs: asArray(tcr.refs).slice(0, isCompact ? 6 : 20),
        ...(isCompact ? {} : { word_ids: asArray(tcr.wordIds).slice(0, 24) }),
      };
    }),
    speaker_shifts: asArray(payload.speakerShifts).slice(0, maxSym),
    ...(payload.lxxComparison ? { lxx_comparison: payload.lxxComparison } : {}),
    limitations: [
      ...asArray(payload.limitations),
      'Keep detected structural patterns, literary wordplay, and orthographic overlap distinct from documented historical etymology.',
    ],
  };
}

export async function runLiteraryStructureMcp(
  _read: DatabaseReader,
  args: {
    passage: string;
    passages: { book: number; chapter: number; verse?: number; start_verse?: number; end_verse?: number }[];
    detail?: 'compact' | 'standard' | 'deep';
    categories?: string[];
    compare_lxx?: boolean;
    include_alternatives?: boolean;
    min_strength?: number;
  },
): Promise<Record<string, unknown> | null> {
  const mode = args.detail ?? 'standard';
  const coords = normalizePassageCoords({ passages: args.passages });
  if (!coords.length) return null;

  let verses: ShardVerseInput[] = [];
  let truncated = false;
  let conceptAliases: R13CorpusContext['conceptAliases'] | undefined;
  if (typeof _read === 'function') {
    try {
      const rows = await callRpc(_read, 'get_literary_source_v1', {
        passage: args.passage,
        passages: args.passages,
      }, 1, 0);
      const src = extractFirstObject(rows) as Record<string, unknown> | null;
      if (src && src.status === 'ok' && Array.isArray(src.verses) && src.verses.length > 0) {
        verses = src.verses as ShardVerseInput[];
        truncated = Boolean(src.truncated);
        if (src.conceptAliases && typeof src.conceptAliases === 'object') {
          conceptAliases = src.conceptAliases as R13CorpusContext['conceptAliases'];
        }
      }
    } catch {
      /* Fallback to static pack below. */
    }
  }
  if (!verses.length) {
    const pack = await loadLiteraryVersesFromPack(defaultLiteraryPackBaseUrl(), coords);
    verses = pack.verses;
    truncated = pack.truncated;
  }
  if (!verses.length) return null;

  const opts: LiteraryAnalysisOptions = {
    detail: mode,
    ...(args.categories ? { categories: args.categories } : {}),
    compareLxx: Boolean(args.compare_lxx),
    includeAlternatives: args.include_alternatives ?? (mode !== 'compact'),
    minStrength: args.min_strength ?? 0,
  };
  const analysis = analyzeLiteraryPassage(
    {
      passage: args.passage,
      verses,
      ...(conceptAliases ? { r13: { conceptAliases } } : {}),
      truncated,
    },
    opts,
  );
  return formatLiteraryStructureMcp(
    { status: 'ok', ...analysis } as unknown as Record<string, unknown>,
    mode,
  );
}

const OP_PARAM_HINTS: Record<string, string> = {
  evidence: '{ op: "evidence", evidence_id: string }',
  occurrences: '{ op: "occurrences", word: string, testament?: "OT"|"NT", book?: number, expand_family?: boolean, detail?: "compact"|"full", limit?: number }',
  intersect_words: '{ op: "intersect_words", words: string[], window?: number, expand_family?: boolean, detail?: "compact"|"full", limit?: number }',
  grammar_search: '{ op: "grammar_search", word?: string, passage?: string, limit?: number }',
  lxx: '{ op: "lxx", passage?: string, word?: string, mode?: "compare"|"passage"|"translations"|"alignments", limit?: number }',
  gematria: '{ op: "gematria", terms: string[], find_matches?: boolean }',
  numbers: '{ op: "numbers", number?: number, query?: string }',
  chronology_occurrences: '{ op: "chronology_occurrences", word?: string, passage?: string }',
  geography_search: '{ op: "geography_search", place: string }',
  passage_compare: '{ op: "passage_compare", passages: string[], detail?: "compact"|"full" }',
  notes_search: '{ op: "notes_search", passage?: string, word?: string }',
  set_combine: '{ op: "set_combine", include?: string[], exclude?: string[], testament?: "OT"|"NT"|"ALL", combine?: "intersect"|"union"|"difference", refs?: string[] }',
  discover_patterns: '{ op: "discover_patterns", query: string, concepts?: string[], mode?: string, detail?: "summary"|"full" }',
  compare_patterns: '{ op: "compare_patterns", targets: string[], detail?: "summary"|"full" }',
  trace_evidence: '{ op: "trace_evidence", evidence_id?: string, expand_id?: string, passage?: string, from?: string, to?: string }',
  literary_structure: '{ op: "literary_structure", passage: string, detail?: "compact"|"standard"|"deep", compare_lxx?: boolean }',
  lxx_concordance: '{ op: "lxx_concordance", word?: string, strongs?: string, lemma?: string, passage?: string, shift_type?: string, limit?: number }',
  tri_textual_diff: '{ op: "tri_textual_diff", target?: string, passage?: string, source?: string, sources?: string[] }',
  clause_role_query: '{ op: "clause_role_query", passage?: string, predicate?: string, subject?: string, object?: string, polarity?: "POS"|"NEG", concept?: string, idiom_only?: boolean }',
  sequence_parallels: '{ op: "sequence_parallels", source?: string, target?: string, passage?: string, permutations?: number }',
  wordplay_scan: '{ op: "wordplay_scan", passage?: string, a?: string, b?: string }',
  expand_clue: '{ op: "expand_clue", expand_id: string, detail?: "clue"|"evidence"|"full" }',
  kg_search: '{ op: "kg_search", query?: string, author_kind?: "human"|"ai", evidence_class?: string, review_status?: string, predicate?: string }',
  kg_dossier: '{ op: "kg_dossier", node_ref: string, include_stale?: boolean }',
  kg_neighbors: '{ op: "kg_neighbors", node_ref: string, direction?: "both"|"outgoing"|"incoming" }',
  kg_paths: '{ op: "kg_paths", from_refs: string[], to_refs: string[], max_hops?: number, mode?: "source_only"|"algorithm_only"|"research_only"|"combined" }',
  kg_trace: '{ op: "kg_trace", claim_id: string, max_hops?: number }',
  kg_contradictions: '{ op: "kg_contradictions", node_ref?: string, claim_id?: string }',
  kg_trail: '{ op: "kg_trail", trail_ref?: string, status?: "active"|"paused"|"completed" }',
};

function resolveTopResearchView(view?: string, detail?: string): 'clues' | 'evidence' | 'full' {
  const raw = (view || detail || 'clues').toLowerCase();
  if (raw === 'full' || raw === 'deep') return 'full';
  if (raw === 'evidence' || raw === 'standard') return 'evidence';
  return 'clues';
}

function projectGenealogyClues(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.status !== 'ok') return payload;
  const focus = asRecord(payload.focus);
  const trav = asRecord(payload.traversal);
  const trimEdges = (val: unknown, max: number) =>
    asArray(val).slice(0, max).map(item => {
      const r = asRecord(item);
      if (!r) return item;
      return {
        ...(r.person_id ? { person_id: r.person_id } : {}),
        ...(r.name ? { name: r.name } : {}),
        ...(r.relation ? { relation: r.relation } : {}),
        ...(r.category ? { category: r.category } : {}),
        ...(r.witness_ref ? { witness_ref: r.witness_ref } : {}),
        ...(r.via ? { via: r.via } : {}),
      };
    });
  return {
    status: payload.status,
    view: 'clues',
    source: payload.source,
    total_people_indexed: payload.total_people_indexed,
    query: payload.query,
    ...(focus
      ? {
          focus: {
            id: focus.id,
            name: focus.name,
            ...(focus.disambiguator ? { disambiguator: focus.disambiguator } : {}),
            ...(focus.hebrew ? { hebrew: focus.hebrew } : {}),
            ...(focus.greek ? { greek: focus.greek } : {}),
            ...(focus.strongs ? { strongs: focus.strongs } : {}),
            ...(focus.tribe ? { tribe: focus.tribe } : {}),
            ...(focus.era ? { era: focus.era } : {}),
            ...(typeof focus.summary === 'string' ? { summary: trimText(focus.summary, 220) } : {}),
            key_refs: asArray(focus.key_refs).slice(0, 5),
          },
        }
      : {}),
    ...(trav
      ? {
          traversal: {
            generations_traversed: trav.generations_traversed,
            parents: trimEdges(trav.parents, 6),
            ...(trav.grandparents !== undefined ? { grandparents: trimEdges(trav.grandparents, 6) } : {}),
            spouses: trimEdges(trav.spouses, 6),
            siblings: trimEdges(trav.siblings, 6),
            children: trimEdges(trav.children, 8),
            ...(trav.grandchildren !== undefined ? { grandchildren: trimEdges(trav.grandchildren, 6) } : {}),
            other_links: trimEdges(trav.other_links, 6),
          },
        }
      : {}),
    candidates: asArray(payload.candidates).slice(0, 8),
    competing_genealogy_notes: asArray(payload.competing_genealogy_notes).slice(0, 4),
    ...(payload.epistemic_note ? { epistemic_note: payload.epistemic_note } : {}),
  };
}

function normalizeRawResearchOp(raw: unknown): Record<string, unknown> {
  const rec = { ...(asRecord(raw) ?? {}) };
  const opName = firstNonEmpty(rec.op);
  if ((opName === 'occurrences' || opName === 'grammar_search' || opName === 'lxx' || opName === 'chronology_occurrences' || opName === 'notes_search') && !rec.word) {
    if (typeof rec.strongs === 'string') { rec.word = rec.strongs; delete rec.strongs; }
    else if (typeof rec.query === 'string') { rec.word = rec.query; delete rec.query; }
  }
  if (opName === 'intersect_words' && !rec.words) {
    if (Array.isArray(rec.strongs)) { rec.words = rec.strongs; delete rec.strongs; }
    else if (typeof rec.strongs === 'string') {
      const parts = rec.strongs.split(/[\s,;+]+/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) { rec.words = parts; delete rec.strongs; }
    } else if (Array.isArray(rec.terms)) { rec.words = rec.terms; delete rec.terms; }
    else if (Array.isArray(rec.targets)) { rec.words = rec.targets; delete rec.targets; }
  }
  if (typeof rec.ref === 'string') {
    if ((opName === 'lxx_concordance' || opName === 'tri_textual_diff' || opName === 'trace_evidence' || opName === 'wordplay_scan' || opName === 'clause_role_query' || opName === 'literary_structure' || opName === 'sequence_parallels' || opName === 'occurrences' || opName === 'grammar_search' || opName === 'lxx' || opName === 'chronology_occurrences' || opName === 'notes_search') && !rec.passage) {
      rec.passage = rec.ref;
    }
    delete rec.ref;
  }
  if (opName === 'gematria' && !rec.terms && typeof rec.word === 'string') {
    rec.terms = [rec.word];
    delete rec.word;
  }
  if (opName === 'compare_patterns' && !rec.targets && Array.isArray(rec.passages)) {
    rec.targets = rec.passages;
    delete rec.passages;
  }
  if (opName === 'passage_compare' && !rec.passages && Array.isArray(rec.targets)) {
    rec.passages = rec.targets;
    delete rec.targets;
  }
  if (opName === 'discover_patterns' && !rec.query && Array.isArray(rec.concepts) && rec.concepts.length > 0) {
    rec.query = rec.concepts.map(c => String(c || '').trim()).filter(Boolean).join(' ');
  }
  if (opName === 'trace_evidence' && typeof rec.query === 'string' && !rec.passage && !rec.evidence_id && !rec.expand_id) {
    const qStr = rec.query.trim();
    if (/^v3:/i.test(qStr)) rec.expand_id = qStr;
    else if (/^r1[0123]:/i.test(qStr)) rec.evidence_id = qStr;
    else if (isPassageLike(qStr)) rec.passage = qStr;
    else rec.evidence_id = qStr;
    delete rec.query;
  }
  const rawDetailOrView = firstNonEmpty(rec.detail, rec.view).toLowerCase();
  if (rawDetailOrView) {
    if (opName === 'occurrences' || opName === 'intersect_words' || opName === 'passage_compare' || opName === 'lxx') {
      rec.detail = (rawDetailOrView === 'full' || rawDetailOrView === 'deep') ? 'full' : 'compact';
    } else if (opName === 'discover_patterns' || opName === 'compare_patterns' || opName === 'trace_evidence') {
      rec.detail = (rawDetailOrView === 'full' || rawDetailOrView === 'deep' || rawDetailOrView === 'evidence') ? 'full' : 'summary';
    } else if (opName === 'literary_structure') {
      rec.detail = (rawDetailOrView === 'full' || rawDetailOrView === 'deep')
        ? 'deep'
        : (rawDetailOrView === 'evidence' || rawDetailOrView === 'standard')
          ? 'standard'
          : 'compact';
    } else if (opName === 'expand_clue') {
      rec.detail = (rawDetailOrView === 'full' || rawDetailOrView === 'deep')
        ? 'full'
        : (rawDetailOrView === 'clues' || rawDetailOrView === 'concise' || rawDetailOrView === 'compact' || rawDetailOrView === 'summary' || rawDetailOrView === 'clue')
          ? 'clue'
          : 'evidence';
    } else if (opName === 'lxx_concordance' || opName === 'tri_textual_diff' || opName === 'clause_role_query' || opName === 'sequence_parallels' || opName === 'wordplay_scan') {
      rec.view = (rawDetailOrView === 'full' || rawDetailOrView === 'deep')
        ? 'full'
        : (rawDetailOrView === 'evidence' || rawDetailOrView === 'standard')
          ? 'evidence'
          : 'clues';
    }
  }
  if (typeof rec.limit === 'number' && Number.isFinite(rec.limit)) {
    const maxOpLimit = opName === 'numbers' ? 25 : opName === 'compare_patterns' ? 15 : opName === 'genealogy' || opName === 'tribe_lineage' ? 30 : 50;
    rec.limit = Math.max(1, Math.min(Math.trunc(rec.limit), maxOpLimit));
  }
  return rec;
}

export async function executeResearch(
  read: DatabaseReader,
  input: { query?: string; operations?: unknown[]; limit?: number; view?: string; detail?: string },
): Promise<Record<string, unknown>> {
  const effectiveView = resolveTopResearchView(input.view, input.detail);
  const defaultLimit = clampLimit(input.limit, effectiveView === 'clues' ? 15 : 20, 50);

  if (input.operations !== undefined) {
    if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 8) {
      return {
        status: 'invalid_request',
        error: 'Invalid research operations payload (expected an array of 1-8 operations).',
      };
    }

    const ctx: OpContext = {
      read,
      defaultLimit,
      view: effectiveView,
      verseIdStore: new Map<string, number[]>(),
    };
    const results: Array<Record<string, unknown>> = [];

    for (let idx = 0; idx < input.operations.length; idx++) {
      const normalizedRaw = normalizeRawResearchOp(input.operations[idx]);
      const opHintName = firstNonEmpty(normalizedRaw.op, 'unknown');
      const parsedOp = ResearchOpSchema.safeParse(normalizedRaw);
      if (!parsedOp.success) {
        results.push({
          index: idx,
          ...(typeof normalizedRaw.id === 'string' ? { id: normalizedRaw.id } : {}),
          op: opHintName,
          status: 'invalid_request',
          error: parsedOp.error.issues.map(i => `${i.path.join('.') || 'op'}: ${i.message}`).join('; '),
          ...(OP_PARAM_HINTS[opHintName] ? { expected_params: OP_PARAM_HINTS[opHintName] } : {}),
        });
        continue;
      }
      const op = parsedOp.data;
      let output: Record<string, unknown>;
      let storedIds: number[] | null = null;

      try {
      switch (op.op) {
        case 'evidence':
          output = await executeEvidence(read, op);
          break;
        case 'occurrences': {
          const res = await executeOccurrences(ctx, op);
          output = res.result;
          storedIds = res.storedIds;
          break;
        }
        case 'intersect_words': {
          const res = await executeIntersectWords(ctx, op);
          output = res.result;
          storedIds = res.storedIds;
          break;
        }
        case 'grammar_search':
          output = await executeGrammarSearch(ctx, op);
          break;
        case 'lxx':
          output = await executeLxx(ctx, op);
          break;
        case 'gematria':
          output = await executeGematria(ctx, op);
          break;
        case 'numbers':
          output = await executeNumbers(ctx, op);
          break;
        case 'chronology_occurrences': {
          const res = await executeChronologyOccurrences(ctx, op);
          output = res.result;
          storedIds = res.storedIds;
          break;
        }
        case 'geography_search':
          output = await executeGeographySearch(ctx, op);
          break;
        case 'passage_compare':
          output = await executePassageCompare(ctx, op);
          break;
        case 'notes_search':
          output = await executeNotesSearch(ctx, op);
          break;
        case 'set_combine': {
          const res = await executeSetCombine(ctx, op);
          output = res.result;
          storedIds = res.storedIds;
          break;
        }
        case 'genealogy': {
          const rawGen = await queryMcpGenealogy(op);
          const opView = op.detail || op.view ? resolveTopResearchView(op.view, op.detail) : effectiveView;
          output = opView === 'clues' ? projectGenealogyClues(rawGen) : rawGen;
          break;
        }
        case 'tribe_lineage':
          output = queryMcpTribeLineage(op);
          break;
        case 'sacred_architecture':
          output = queryMcpSacredArchitecture(op);
          break;
        case 'feasts_calendar':
          output = queryMcpFeastsCalendar(op);
          break;
        case 'discover_patterns': {
          const dpLimit = Math.min(25, op.limit ?? Math.min(defaultLimit, 12));
          let rows: Record<string, unknown>[] = [];
          try {
            rows = await callRpc(
              read,
              'discover_patterns_v1',
              {
                query: op.query,
                ...(op.concepts ? { concepts: op.concepts } : {}),
                ...(op.mode ? { mode: op.mode } : {}),
                filters: {
                  ...(op.evidence_types ? { evidence_types: op.evidence_types } : {}),
                  ...(op.include_orthographic !== undefined ? { include_orthographic: op.include_orthographic } : {}),
                },
                limit: dpLimit,
              },
              1,
              0,
            );
          } catch {
            rows = [];
          }
          let payload = extractFirstObject(rows) ?? {};
          if (!rows.length || payload.status === 'error') {
            const conciseQuery = op.query
              .replace(/[^\p{L}\p{N}\s:-]/gu, ' ')
              .split(/\s+/)
              .filter(t => t.length >= 3)
              .slice(0, 4)
              .join(' ') || op.query;
            const retryRows = await callRpc(
              read,
              'discover_patterns_v1',
              {
                query: conciseQuery,
                limit: Math.min(dpLimit, 8),
              },
              1,
              0,
            );
            payload = extractFirstObject(retryRows) ?? payload;
          }
          const full = op.detail === 'full';
          const net = asRecord(payload.network) ?? {};
          const rawPatterns = asArray(net.patterns).map(p => asRecord(p)).filter((p): p is Record<string, unknown> => p !== null);
          const conns = asArray(payload.strongest_connections)
            .map(c => normalizeDiscoveryConnection(asRecord(c) ?? {}))
            .filter((c): c is CompactConnection => c !== null);
          output = full
            ? payload
            : {
                status: firstNonEmpty(payload.status, 'ok'),
                query_intent: payload.query_intent,
                ...(payload.evidence_release_id ? { evidence_release_id: payload.evidence_release_id } : {}),
                pattern_count: net.pattern_count ?? rawPatterns.length,
                patterns: rawPatterns.slice(0, 6).map(p => ({
                  pattern_id: p.pattern_id,
                  pattern_type: p.pattern_type,
                  title: p.title,
                  summary: p.summary,
                  anchor_coverage: p.anchor_coverage,
                  witness_refs: asArray(p.witness_refs).slice(0, 5),
                  explicit_vs_inferred: p.explicit_vs_inferred,
                  counterexamples_and_limits: asArray(p.counterexamples_and_limits).slice(0, 3),
                  distinctiveness_score: p.distinctiveness_score,
                })),
                top_connections: conns.slice(0, 8),
                controls_and_alternatives: asArray(payload.controls_and_alternatives).slice(0, 4),
              };
          break;
        }
        case 'compare_patterns': {
          const parsedTargets = op.targets
            .map(t => ({ raw: t, parsed: parsePassageString(t) }))
            .filter((x): x is { raw: string; parsed: ParsedPassage } => Boolean(x.parsed));
          const [rows, structuralTargets] = await Promise.all([
            callRpc(
              read,
              'compare_patterns_v1',
              { targets: op.targets, limit: Math.min(15, op.limit ?? 8) },
              1,
              0,
            ),
            parsedTargets.length >= 2
              ? Promise.all(
                  parsedTargets.slice(0, 4).map(t =>
                    runLiteraryStructureMcp(read, {
                      passage: t.parsed.normalized,
                      passages: t.parsed.passages,
                      detail: 'compact',
                      compare_lxx: false,
                      include_alternatives: false,
                    }).catch(() => null),
                  ),
                )
              : Promise.resolve([]),
          ]);
          const payload = extractFirstObject(rows) ?? {};
          const full = op.detail === 'full';
          const combined = asArray(payload.combined_connections)
            .map(c => normalizeDiscoveryConnection(asRecord(c) ?? {}))
            .filter((c): c is CompactConnection => c !== null);
          const litSummaries = structuralTargets
            .map((lit, i) => {
              const lr = asRecord(lit);
              if (!lr) return null;
              const seg = asRecord(lr.segmentation);
              const tmpl = asRecord(lr.template);
              return {
                target: parsedTargets[i]?.parsed.normalized ?? op.targets[i],
                edition: lr.edition ?? null,
                verse_count: lr.verse_count ?? 0,
                unit_count: seg?.unit_count ?? asArray(seg?.units).length,
                conclusion: seg?.conclusion ?? null,
                template_slots: asArray(tmpl?.slots).slice(0, 8),
                top_deviations: asArray(lr.deviations).slice(0, 6),
                top_symmetries: asArray(lr.symmetries).slice(0, 4),
                key_words: asArray(lr.key_words).slice(0, 8),
              };
            })
            .filter(Boolean);
          const structuralComparison = litSummaries.length >= 2
            ? {
                passages: litSummaries,
                unit_count_delta: Math.abs(Number(litSummaries[0]?.unit_count ?? 0) - Number(litSummaries[1]?.unit_count ?? 0)),
                conclusions: litSummaries.map(s => ({ target: s?.target, conclusion: s?.conclusion })),
              }
            : null;
          output = full
            ? { ...payload, ...(structuralComparison ? { structural_comparison: structuralComparison } : {}) }
            : {
                status: firstNonEmpty(payload.status, 'ok'),
                targets: payload.targets ?? op.targets,
                shared_lemmas: payload.shared_lemmas ?? [],
                shared_motifs: payload.shared_motifs ?? [],
                structural_role_alignment: payload.structural_role_alignment ?? null,
                cross_testament_alignment: payload.cross_testament_alignment ?? null,
                ...(structuralComparison ? { structural_comparison: structuralComparison } : {}),
                combined_connections: combined.slice(0, 6),
                divergences_and_controls: asArray(payload.divergences_and_controls).slice(0, 4),
              };
          break;
        }
        case 'trace_evidence': {
          const explicitExpand = op.expand_id || (op.evidence_id && /^v3:/i.test(op.evidence_id) ? op.evidence_id : undefined);
          if (explicitExpand) {
            const detail = op.detail === 'full' ? 'full' : 'evidence';
            const rows = await callRpc(read, 'expand_clue_v3', { expand_id: explicitExpand, detail }, 1, 0);
            output = extractFirstObject(rows) ?? { status: 'not_found', expand_id: explicitExpand };
            break;
          }
          const passageTarget = op.passage
            || (op.evidence_id && !/^r1[0123]:/i.test(op.evidence_id) && isPassageLike(op.evidence_id) ? op.evidence_id : undefined)
            || (op.from && !op.to && isPassageLike(op.from) ? op.from : undefined);
          const rows = await callRpc(
            read,
            'trace_evidence_v1',
            {
              ...(passageTarget ? { passage: passageTarget } : {}),
              ...(op.verse_id !== undefined ? { verse_id: op.verse_id } : {}),
              ...(!passageTarget && op.evidence_id ? { evidence_id: op.evidence_id } : {}),
              ...(!passageTarget && op.from ? { from: op.from } : {}),
              ...(op.to ? { to: op.to } : {}),
              ...(op.max_hops !== undefined ? { max_hops: op.max_hops } : {}),
            },
            1,
            0,
          );
          const payload = extractFirstObject(rows) ?? {};
          const opViewMode = op.view ?? (op.detail ? resolveTopResearchView(undefined, op.detail) : effectiveView);
          const full = op.detail === 'full' || opViewMode === 'full';
          const isCluesView = !full && opViewMode === 'clues';
          const ev = asRecord(payload.evidence);
          if (passageTarget && !full && !ev) {
            const conns = asArray(payload.strongest_connections)
              .map(c => normalizeDiscoveryConnection(asRecord(c) ?? {}))
              .filter((c): c is CompactConnection => c !== null)
              .slice(0, isCluesView ? 5 : 6);
            const rawRhet = asRecord(payload.rhetoric_hits) ?? {};
            const talion = asArray(rawRhet.syntactic_talion);
            const onom = asArray(rawRhet.onomastic_valence);
            output = {
              status: firstNonEmpty(payload.status, 'ok'),
              passage: payload.passage ?? passageTarget,
              verse_id: payload.verse_id,
              clauses_count: asArray(payload.clauses).length,
              clauses: asArray(payload.clauses).slice(0, isCluesView ? 4 : 6),
              lxx_shifts: asArray(payload.lxx_shifts).slice(0, isCluesView ? 4 : 6),
              rhetoric_hits: isCluesView
                ? {
                    syntactic_talion_count: talion.length,
                    syntactic_talion: talion.slice(0, 3),
                    onomastic_valence_count: onom.length,
                    onomastic_valence: onom.slice(0, 3),
                  }
                : (payload.rhetoric_hits ?? {}),
              strongest_connections: conns,
              connection_paths: asArray(payload.connection_paths).slice(0, isCluesView ? 3 : 4),
              counterexamples_and_limits: asArray(payload.counterexamples_and_limits).slice(0, isCluesView ? 3 : 4),
            };
          } else if (!full && !ev && isCluesView) {
            const conns = asArray(payload.strongest_connections)
              .map(c => normalizeDiscoveryConnection(asRecord(c) ?? {}))
              .filter((c): c is CompactConnection => c !== null)
              .slice(0, 5);
            const { verse_details: _vd, ...restPayload } = payload;
            output = {
              ...restPayload,
              ...(Array.isArray(payload.strongest_connections) ? { strongest_connections: conns } : {}),
              ...(Array.isArray(payload.connection_paths) ? { connection_paths: payload.connection_paths.slice(0, 3) } : {}),
              ...(Array.isArray(payload.counterexamples_and_limits) ? { counterexamples_and_limits: payload.counterexamples_and_limits.slice(0, 3) } : {}),
            };
          } else {
            output = full || !ev
              ? payload
              : {
                  status: firstNonEmpty(payload.status, 'ok'),
                  evidence_id: payload.evidence_id ?? op.evidence_id,
                  title: ev.title,
                  summary: ev.summary,
                  evidence_type: ev.evidence_type ?? ev.predicate,
                  evidence_tier: ev.evidence_tier,
                  epistemic_class: ev.epistemic_class,
                  score_breakdown: ev.score_breakdown ?? null,
                  connected_motif_ids: asArray(payload.connected_motif_ids).slice(0, isCluesView ? 5 : 10),
                  independent_witnesses: asArray(payload.independent_witnesses).slice(0, isCluesView ? 5 : 10),
                  original_words: asArray(ev.original_words).slice(0, isCluesView ? 5 : 12),
                  passage_details: asArray(payload.passage_details).slice(0, isCluesView ? 3 : 4),
                  counterexamples_and_limits: asArray(payload.counterexamples_and_limits ?? ev.limitations).slice(0, isCluesView ? 3 : 6),
                  provenance: payload.provenance ?? ev.provenance,
                };
          }
          break;
        }
        case 'literary_structure': {
          const parsed = parsePassageString(op.passage);
          if (!parsed) {
            output = { status: 'invalid_request', error: `Could not parse passage: ${op.passage}` };
            break;
          }
          const viewModeLit = op.view ?? effectiveView;
          const mode: 'compact' | 'standard' | 'deep' = op.detail === 'deep' || op.detail === 'full'
            ? 'deep'
            : op.detail === 'standard' || op.detail === 'evidence'
              ? 'standard'
              : (op.detail === 'compact' || op.detail === 'clues' || op.detail === 'clue' || op.detail === 'concise' || op.detail === 'summary' || viewModeLit === 'clues')
                ? 'compact'
                : effectiveView === 'full'
                  ? 'deep'
                  : effectiveView === 'evidence'
                    ? 'standard'
                    : 'compact';
          const formatted = await runLiteraryStructureMcp(read, {
            passage: parsed.normalized,
            passages: parsed.passages,
            detail: mode,
            categories: op.categories,
            compare_lxx: op.compare_lxx,
            include_alternatives: op.include_alternatives ?? (mode !== 'compact'),
            min_strength: op.min_strength,
          });
          if (!formatted) {
            output = {
              status: 'unavailable',
              passage: parsed.normalized,
              error: 'Literary source chunks unavailable for requested passage.',
              retryable: true,
            };
          } else if (mode === 'compact' || viewModeLit === 'clues') {
            const seg = asRecord(formatted.segmentation);
            const tmpl = asRecord(formatted.template);
            const stripWordArrays = (x: unknown) => {
              const r = asRecord(x);
              if (!r) return x;
              const {
                word_ids: _wids, witness_word_ids: _wwids, unit_counts: _uc,
                matched_char_indices: _mci, etymology_disclaimer: _ed, ...rest
              } = r;
              return rest;
            };
            output = {
              ...formatted,
              ...(seg ? {
                segmentation: {
                  anchor_text: seg.anchor_text,
                  anchor_side: seg.anchor_side,
                  signals: seg.signals,
                  mdl_savings_bits: seg.mdl_savings_bits,
                  confidence: seg.confidence,
                  epistemic_class: seg.epistemic_class,
                  ...(seg.introduction ? { introduction: { from_ref: asRecord(seg.introduction)?.fromRef ?? asRecord(seg.introduction)?.from_ref, to_ref: asRecord(seg.introduction)?.toRef ?? asRecord(seg.introduction)?.to_ref } } : {}),
                  units: asArray(seg.units).slice(0, 6),
                  sections: asArray(seg.sections).slice(0, 5),
                },
              } : {}),
              ...(tmpl ? {
                template: {
                  mdl_savings_bits: tmpl.mdl_savings_bits,
                  compression_proxy: tmpl.compression_proxy,
                  slots: asArray(tmpl.slots).slice(0, 5),
                },
              } : {}),
              pattern_families: asArray(formatted.pattern_families).slice(0, 4).map(pf => {
                const pfr = asRecord(pf);
                if (!pfr) return pf;
                const { description: _d, ...restPf } = pfr;
                return restPf;
              }),
              deviations: asArray(formatted.deviations).slice(0, 3).map(stripWordArrays),
              command_fulfillments: asArray(formatted.command_fulfillments).slice(0, 3),
              correspondences: asArray(formatted.correspondences).slice(0, 3).map(c => {
                const cr = asRecord(c);
                if (!cr) return c;
                return {
                  ...cr,
                  shared_lexemes: asArray(cr.shared_lexemes).slice(0, 4).map(lx => {
                    const lr = asRecord(lx);
                    if (!lr) return lx;
                    const { wordIdsA: _a, wordIdsB: _b, ...restLx } = lr;
                    return restLx;
                  }),
                };
              }),
              symmetries: asArray(formatted.symmetries).slice(0, 2).map(s => {
                const sr = asRecord(s);
                if (!sr) return s;
                const centerRec = asRecord(sr.center);
                return {
                  ...sr,
                  ...(centerRec ? { center: { ref: centerRec.ref, text: centerRec.text } } : {}),
                  pairs: asArray(sr.pairs).slice(0, 3),
                };
              }),
              wordplays: asArray(formatted.wordplays).slice(0, 2).map(wp => {
                const wpr = asRecord(wp);
                if (!wpr) return wp;
                const wa = asRecord(wpr.word_a);
                const wb = asRecord(wpr.word_b);
                return {
                  epistemic_class: wpr.epistemic_class,
                  overlap_kind: wpr.overlap_kind,
                  shared_consonants: wpr.shared_consonants,
                  score: wpr.score,
                  confidence: wpr.confidence,
                  word_a: wa ? { ref: wa.ref, form: wa.form, strongs: wa.strongs, lemma: wa.lemma, gloss: wa.gloss } : wpr.word_a,
                  word_b: wb ? { ref: wb.ref, form: wb.form, strongs: wb.strongs, lemma: wb.lemma, gloss: wb.gloss } : wpr.word_b,
                };
              }),
              key_words: asArray(formatted.key_words).slice(0, 5).map(stripWordArrays),
              acrostics: asArray(formatted.acrostics).map(ac => {
                const acr = asRecord(ac);
                if (!acr) return ac;
                const { entries: _ent, ...restAc } = acr;
                return restAc;
              }),
              thematic_clusters: asArray(formatted.thematic_clusters).slice(0, 3),
              speaker_shifts: asArray(formatted.speaker_shifts).slice(0, 2),
              limitations: asArray(formatted.limitations).slice(0, 1),
            };
          } else {
            output = formatted;
          }
          break;
        }
        case 'lxx_concordance': {
          const isPassageMode = Boolean(op.passage);
          const lim = op.limit !== undefined
            ? clampLimit(op.limit, 24, isPassageMode ? 30 : 50)
            : (isPassageMode ? 24 : clampLimit(undefined, defaultLimit, 50));
          const strongsArg = op.strongs || (op.word && /^[HG]\d+[A-Z]?$/i.test(op.word.trim()) ? op.word.trim() : undefined);
          const rows = await callRpc(read, 'lxx_concordance_v3', {
            ...(op.passage ? { passage: op.passage } : {}),
            ...(strongsArg ? { strongs: strongsArg } : {}),
            ...(op.lemma ? { lemma: op.lemma } : {}),
            ...(!strongsArg && op.word ? { word: op.word } : {}),
            ...(op.shift_type ? { shift_type: op.shift_type } : {}),
            limit: lim,
            ...(op.offset !== undefined ? { offset: op.offset } : {}),
          }, 1, 0);
          const payload = extractFirstObject(rows) ?? { status: 'not_found' };
          const viewMode = op.view ?? effectiveView;
          if (viewMode === 'clues' && payload.mode === 'passage_alignment' && Array.isArray(payload.alignments) && payload.alignments.length > 4) {
            output = {
              ...payload,
              alignments: payload.alignments.map((al: unknown) => {
                const a = asRecord(al);
                if (!a) return al;
                const { grk_tokens, mt_tokens, ...restAl } = a;
                return {
                  ...restAl,
                  grk_token_count: asArray(grk_tokens).length,
                  mt_token_count: asArray(mt_tokens).length,
                };
              }),
            };
          } else {
            output = payload;
          }
          break;
        }
        case 'tri_textual_diff': {
          const rows = await callRpc(read, 'tri_textual_diff_v3', {
            ...(op.target ? { target: op.target } : {}),
            ...(op.passage ? { passage: op.passage } : {}),
            ...(op.source ? { source: op.source } : {}),
            ...(op.sources ? { sources: op.sources } : {}),
          }, 1, 0);
          const payload = extractFirstObject(rows) ?? { status: 'not_found' };
          const viewMode = op.view ?? effectiveView;
          if (viewMode === 'clues' && Array.isArray(payload.tokens) && payload.tokens.length > 24) {
            const { tokens, ...rest } = payload;
            output = {
              ...rest,
              token_count: tokens.length,
              tokens_preview: tokens.slice(0, 16),
            };
          } else {
            output = payload;
          }
          break;
        }
        case 'clause_role_query': {
          const lim = clampLimit(op.limit, defaultLimit, 50);
          const rows = await callRpc(read, 'clause_role_query_v3', {
            ...(op.passage ? { passage: op.passage } : {}),
            ...(op.predicate ? { predicate: op.predicate } : {}),
            ...(op.subject ? { subject: op.subject } : {}),
            ...(op.object ? { object: op.object } : {}),
            ...(op.polarity ? { polarity: op.polarity } : {}),
            ...(op.concept ? { concept: op.concept } : {}),
            ...(op.concepts ? { concepts: op.concepts } : {}),
            ...(op.idiom_only !== undefined ? { idiom_only: op.idiom_only } : {}),
            ...(op.include ? { include: op.include } : {}),
            ...(op.exclude ? { exclude: op.exclude } : {}),
            limit: lim,
          }, 1, 0);
          const payload = extractFirstObject(rows) ?? { status: 'not_found' };
          const viewMode = op.view ?? effectiveView;
          const compactClauseProject = (cl: unknown) => {
            const c = asRecord(cl);
            if (!c) return cl;
            const pred = asRecord(c.predicate);
            return {
              clause_id: c.clause_id,
              polarity: c.polarity,
              ...(pred ? {
                predicate: {
                  s: pred.s,
                  lemma: pred.lm ?? pred.lemma,
                  gloss: pred.gloss,
                  mood: pred.mood,
                  stem: pred.stem,
                },
              } : {}),
              ...(asArray(c.subjects).length ? { subjects: c.subjects } : {}),
              ...(asArray(c.objects).length ? { objects: c.objects } : {}),
              ...(asArray(c.neg_markers).length ? { neg_markers: c.neg_markers } : {}),
            };
          };
          if (viewMode === 'clues') {
            if (Array.isArray(payload.verses)) {
              output = {
                ...payload,
                verses: payload.verses.slice(0, 12).map((v: unknown) => {
                  const vr = asRecord(v);
                  if (!vr) return v;
                  return {
                    vid: vr.vid,
                    ref: vr.ref,
                    clauses: asArray(vr.clauses).map(compactClauseProject),
                  };
                }),
              };
            } else if (Array.isArray(payload.matches)) {
              output = {
                ...payload,
                matches: payload.matches.slice(0, 8).map((m: unknown) => {
                  const mr = asRecord(m);
                  if (!mr) return m;
                  return {
                    vid: mr.vid,
                    ref: mr.ref,
                    clauses: asArray(mr.clauses).map(compactClauseProject),
                  };
                }),
              };
            } else {
              output = payload;
            }
          } else {
            output = payload;
          }
          break;
        }
        case 'sequence_parallels': {
          const rows = await callRpc(read, 'sequence_parallels_v3', {
            ...(op.source ? { source: op.source } : {}),
            ...(op.target ? { target: op.target } : {}),
            ...(op.passage ? { passage: op.passage } : {}),
            ...(op.targets ? { targets: op.targets } : {}),
            ...(op.permutations !== undefined ? { permutations: op.permutations } : {}),
            ...(op.switch_penalty !== undefined ? { switch_penalty: op.switch_penalty } : {}),
          }, 1, 0);
          const payload = extractFirstObject(rows) ?? { status: 'not_found' };
          const viewMode = op.view ?? effectiveView;
          if (viewMode === 'clues' && Array.isArray(payload.alignments) && payload.alignments.length > 6) {
            output = {
              ...payload,
              alignments: payload.alignments.slice(0, 6),
            };
          } else {
            output = payload;
          }
          break;
        }
        case 'wordplay_scan': {
          if ((op.a && isPassageLike(op.a)) || (op.b && isPassageLike(op.b))) {
            output = {
              status: 'invalid_request',
              error: 'wordplay_scan parameters "a" and "b" expect single words or Strong\'s IDs, not passage references. Use "passage" for single-passage wordplay scanning or "sequence_parallels" for comparing passages.',
            };
            break;
          }
          const rows = await callRpc(read, 'wordplay_scan_v3', {
            ...(op.passage ? { passage: op.passage } : {}),
            ...(op.a ? { a: op.a } : {}),
            ...(op.b ? { b: op.b } : {}),
          }, 1, 0);
          const payload = extractFirstObject(rows) ?? { status: 'not_found' };
          const viewMode = op.view ?? effectiveView;
          if (viewMode === 'clues') {
            output = {
              ...payload,
              ...(Array.isArray(payload.consonantal_candidates) && payload.consonantal_candidates.length > 8
                ? { consonantal_candidates: payload.consonantal_candidates.slice(0, 8) }
                : {}),
              ...(Array.isArray(payload.syntactic_talion) && payload.syntactic_talion.length > 6
                ? { syntactic_talion: payload.syntactic_talion.slice(0, 6) }
                : {}),
              ...(Array.isArray(payload.onomastic_valence) && payload.onomastic_valence.length > 6
                ? { onomastic_valence: payload.onomastic_valence.slice(0, 6) }
                : {}),
            };
          } else {
            output = payload;
          }
          break;
        }
        case 'expand_clue': {
          const detail = (op.detail === 'clue' || op.detail === 'evidence' || op.detail === 'full')
            ? op.detail
            : (effectiveView === 'full' ? 'full' : 'evidence');
          const rows = await callRpc(read, 'expand_clue_v3', {
            expand_id: op.expand_id,
            detail,
            ...(op.limit !== undefined ? { limit: op.limit } : {}),
          }, 1, 0);
          output = extractFirstObject(rows) ?? { status: 'not_found', expand_id: op.expand_id };
          break;
        }
        case 'kg_search':
        case 'kg_dossier':
        case 'kg_neighbors':
        case 'kg_paths':
        case 'kg_trace':
        case 'kg_contradictions':
        case 'kg_trail': {
          const opView = op.detail || op.view ? resolveTopResearchView(op.view, op.detail) : effectiveView;
          output = await executeKgResearchOp(read, op as unknown as Record<string, unknown>, opView, defaultLimit);
          break;
        }
      }

      } catch {
        output = { status: 'error', error: `Research operation "${op.op}" could not complete. Retry this operation; other results are retained.`, retryable: true };
      }

      if (storedIds !== null) {
        ctx.verseIdStore.set(String(idx), storedIds);
        if (op.id) ctx.verseIdStore.set(op.id, storedIds);
      }
      results.push({
        index: idx,
        ...(op.id ? { id: op.id } : {}),
        op: op.op,
        ...output,
      });
    }

    return {
      status: results.every((r) => r.status === 'error') ? 'error' : results.some((r) => r.status === 'error') ? 'partial' : 'ok',
      mode: 'operations',
      results,
    };
  }

  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) {
    return {
      status: 'invalid_request',
      error: 'Provide either operations[] or query.',
    };
  }

  if (/^(?:v3:|passage_lex_bridge:|passage_root_bridge:|passage_root_wordplay:|ctrl:)/i.test(query)) {
    const detail = effectiveView === 'full' ? 'full' : 'evidence';
    const rows = await callRpc(read, 'expand_clue_v3', { expand_id: query, detail }, 1, 0);
    const exp = extractFirstObject(rows) ?? { status: 'not_found', expand_id: query };
    return {
      ...exp,
      status: firstNonEmpty(exp.status, 'ok'),
      mode: 'shorthand_expand_clue',
    };
  }

  if (/^r1[0123]:/i.test(query)) {
    const evidence = await executeEvidence(read, { op: 'evidence', evidence_id: query });
    return {
      ...evidence,
      status: firstNonEmpty(evidence.status, 'ok'),
      mode: 'shorthand_evidence',
    };
  }

  const multiPassages = splitCompareQueryPassages(query);
  if (multiPassages) {
    const ctx: OpContext = { read, defaultLimit, view: effectiveView, verseIdStore: new Map() };
    const compared = await executePassageCompare(ctx, {
      op: 'passage_compare',
      passages: multiPassages,
      limit: defaultLimit,
    });
    return {
      mode: 'shorthand_passage_compare',
      ...compared,
    };
  }

  const rows = await callRpc(
    read,
    'discover_biblical_connections_v2',
    { query, limit: Math.min(defaultLimit, 25) },
    1,
    0,
  );
  const payload = extractFirstObject(rows) ?? {};
  const rawConnections = asArray(payload.strongest_connections ?? payload.connections)
    .map((c) => asRecord(c))
    .filter((c): c is Record<string, unknown> => c !== null);
  const connections = rawConnections
    .map((c) => normalizeDiscoveryConnection(c))
    .filter((c): c is CompactConnection => c !== null)
    .map((c) => {
      if (effectiveView !== 'clues') return c;
      const { score_breakdown: _sb, witness: _w, ...rest } = c;
      return { ...rest, expand_id: c.expand_id || c.id, why: trimText(c.why, 120), refs: c.refs.slice(0, 3) };
    });

  return {
    status: 'ok',
    view: effectiveView,
    mode: 'shorthand_discover',
    query,
    ...(payload.evidence_release_id ? { evidence_release_id: payload.evidence_release_id } : {}),
    connections,
  };
}
