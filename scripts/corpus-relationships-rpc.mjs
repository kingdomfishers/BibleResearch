/**
 * scripts/corpus-relationships-rpc.mjs
 * Deterministic Cloudflare Worker RPC handlers for static cross-references
 * (`lookup_cross_references_v1`) and lexical relationships (`lookup_lexical_relationships_v1`).
 *
 * Immutable source evidence lives exclusively in Cloudflare Static Assets (`/v1/relationships/*`
 * and `/v1/lexical/*`). Zero runtime SQL or whole-corpus downloads.
 */

import { ShardedAdjacencyLoader } from '../src/relationships/adjacency-loader.ts';
import { lemmaShardEntry, packedShardEntry } from './relationship-shard-codec.mjs';
import { resolveResearchConcept } from '../src/relationships/concept-resolver.ts';
import { discoverMultiHopPaths } from '../src/relationships/multihop-search.ts';
import { scoreCrossTestamentPair, synthesizeEvidencePatterns } from '../src/relationships/evidence-synthesis.ts';
import { compareStructuredRoleFrames } from '../src/relationships/symbolic-patterns.ts';
import { findConnectedSubgraph } from '../src/relationships/subgraph-engine.ts';
import { scoreTesseraeParallel } from '../src/relationships/tesserae-retrieval.ts';
import {
  DEFAULT_R10_RELEASE,
  discoverBiblicalConnections,
  expandBiblicalConnection,
  getConnectionEvidence,
} from '../src/relationships/r10-discovery.ts';
import { analyzeLiteraryPassage } from '../src/relationships/literary-engine.ts';
import {
  defaultLiteraryPackBaseUrl,
  loadLiteraryVersesFromPack,
  normalizePassageCoords,
} from '../src/relationships/literary-pack-loader.ts';
import { formatRef, parsePassageString } from '../supabase/functions/bible-mcp/bible-ref.ts';
import {
  GRAPH_PARTITIONS,
  NUM_VERSES,
  blockMaxWandTopK,
  intersectTerms,
  lookupTerm,
} from '../src/relationships/v3-binary-index.ts';
import { alignClauseSequencesPiecewise, alignTriTextualQuote, alignTriTextualQuoteV4 } from '../src/relationships/v3-verifiers.ts';
import { queryRmacCandidates } from '../src/relationships/v4-rmac-index.ts';
import { evaluateSmePair, runSeqlGeneralization } from '../src/relationships/v4-sme-engine.ts';
import {
  V3RuntimeSession,
  buildClauseSigsFromV3Verse,
  buildNtTokensFromV3Verse,
  buildOtCandidateFromV3,
  findV3BridgePivots,
  fnv1a32,
  normStrongs4,
  repairV3VerseToks,
  sanitizeV3TokenLemma,
  scoreV3EPerpPair,
  v3ProfileShardId,
  v3VerseChunkId,
} from '../src/relationships/v3-runtime-adapter.ts';
import { isLxxFunctionEquivalent } from '../src/relationships/epistemic-taxonomy.ts';
import {
  canonicalStrongsKey,
  compareOriginalForms,
  detectOnomasticValenceWordplays,
  detectSyntacticTalionAndPolyptoton,
  isVerifiedAttestedWordplayEdge,
  normalizeOriginalForm,
} from '../src/relationships/wordplay-engine.ts';

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function fnv1a64Hex(input) {
  let hash = FNV_OFFSET_64;
  const str = String(input);
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

export const CROSS_REFERENCE_GUARDRAILS = Object.freeze({
  association_only: true,
  implies_quotation: false,
  implies_prophecy: false,
  implies_typology: false,
  implies_theological_equivalence: false,
});

export const DEFAULT_XREF_ATTRIBUTION = Object.freeze({
  source_key: 'crossreferences_org_v1',
  source_title: 'CrossReferences.org Biblical Cross-References',
  dataset_url: 'https://github.com/CrossReferences-org/bible-cross-references',
  pinned_commit: '671bbf73b1e5155e31b209442dc5be3f5b3c1a41',
  license: 'CC BY 4.0',
  attribution: 'CrossReferences.org (CC BY 4.0; BSB & KJV Public Domain English phrases; French S21 excluded)',
  locator: 'json/cross_references.json',
  raw_field: 'refs',
  algorithm_version: null,
  excluded_restricted_fields: ['s21'],
});

function encodeCursor(offset, scopeKey) {
  const safe = Math.max(0, Math.floor(offset));
  const sig = fnv1a64Hex(`${scopeKey}|${safe}`).slice(0, 8);
  return `rc1:${safe}:${sig}`;
}

function decodeCursor(cursor, scopeKey) {
  if (!cursor) return { ok: true, offset: 0 };
  const m = /^rc1:(\d+):([0-9a-f]{8})$/.exec(String(cursor).trim());
  if (!m) return { ok: false, error: 'Malformed relationship pagination cursor.' };
  const offset = Number(m[1]);
  const expected = fnv1a64Hex(`${scopeKey}|${offset}`).slice(0, 8);
  if (m[2] !== expected) {
    return { ok: false, error: 'Cursor scope mismatch; restart pagination from null cursor.' };
  }
  return { ok: true, offset };
}

function clampLimit(raw, fallback = 25) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(1, Math.floor(n)), 100);
}

function normalizeStrongsBase(q) {
  const m = /^([HG])0*(\d+)([A-Za-z]?)$/i.exec(String(q || '').trim());
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const num = String(Number(m[2])).padStart(4, '0');
  return {
    compact: `${prefix}${Number(m[2])}`,
    padded: `${prefix}${num}`,
    suffix: m[3] || '',
  };
}

function endpointSpanKey(ep) {
  if (ep.versification_status === 'edition_only_non_canonical' && ep.edition_only_ref) {
    const r = ep.edition_only_ref;
    return `ed:${r.edition}:${r.book}:${r.chapter}:${r.verse}`;
  }
  return ep.verse_start === ep.verse_end
    ? `v:${ep.book}:${ep.chapter}:${ep.verse_start}`
    : `r:${ep.book}:${ep.chapter}:${ep.verse_start}-${ep.verse_end}`;
}

function deduplicateXrefEdges(edges) {
  const map = new Map();
  for (const edge of edges) {
    const srcKey = endpointSpanKey(edge.source_passage);
    const tgtKey = (edge.target_spans || []).map(endpointSpanKey).join('+');
    const k = `${edge.provenance?.source_key}|${edge.direction}|${srcKey}|${edge.anchor?.source_subverse_sort ?? 1}|${edge.anchor?.anchor_sort ?? 1}|${tgtKey}`;
    const prev = map.get(k);
    if (!prev || edge.group_ordinal < prev.group_ordinal) {
      map.set(k, edge);
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.rank_order !== b.rank_order) return a.rank_order - b.rank_order;
    if (a.source_passage.book !== b.source_passage.book) return a.source_passage.book - b.source_passage.book;
    if (a.source_passage.chapter !== b.source_passage.chapter) return a.source_passage.chapter - b.source_passage.chapter;
    if (a.source_passage.verse_start !== b.source_passage.verse_start) return a.source_passage.verse_start - b.source_passage.verse_start;
    if (a.anchor.source_subverse_sort !== b.anchor.source_subverse_sort) return a.anchor.source_subverse_sort - b.anchor.source_subverse_sort;
    if (a.anchor.anchor_sort !== b.anchor.anchor_sort) return a.anchor.anchor_sort - b.anchor.anchor_sort;
    if (a.group_ordinal !== b.group_ordinal) return a.group_ordinal - b.group_ordinal;
    return String(a.relationship_id).localeCompare(String(b.relationship_id));
  });
}

export async function handleLookupCrossReferencesV1(ctx, params = {}) {
  await ctx.ensureCatalog(ctx.env);
  const book = Number(params.p_book);
  const chapter = Number(params.p_chapter);
  const verse = Number(params.p_verse);
  const verseEnd = params.p_verse_end != null ? Number(params.p_verse_end) : verse;
  const direction = ['outgoing', 'incoming', 'both'].includes(params.p_direction)
    ? params.p_direction
    : 'both';
  const translationFilter = ['all', 'bsb', 'kjv'].includes(params.p_translation_filter)
    ? params.p_translation_filter
    : 'all';
  const limit = clampLimit(params.p_limit, 25);

  const emptyResp = (status, queryPassage, errorMessage = null, attribution = DEFAULT_XREF_ATTRIBUTION) => ({
    schema_version: 1,
    status,
    epistemic_layer: 'static_source_evidence',
    query_passage: queryPassage,
    direction,
    outgoing: [],
    incoming: [],
    page: { limit, returned: 0, total_available: 0, next_cursor: null, has_more: false },
    guardrails: CROSS_REFERENCE_GUARDRAILS,
    dataset_attribution: attribution,
    error_message: errorMessage,
  });

  if (
    !Number.isInteger(book) || book < 1 || book > 66 ||
    !Number.isInteger(chapter) || chapter < 1 ||
    !Number.isInteger(verse) || verse < 0 ||
    !Number.isInteger(verseEnd) || verseEnd < verse ||
    (verse === 0 && book !== 19)
  ) {
    return emptyResp('invalid_reference', null, 'Invalid canonical book/chapter/verse coordinates.');
  }

  const relManifest = await ctx.loadJsonShard(ctx.env, '/v1/relationships/manifest.json.gz');
  const attribution = relManifest?.xref_attribution || DEFAULT_XREF_ATTRIBUTION;
  const bookPad = String(book).padStart(2, '0');
  const bookShard = await ctx.loadJsonShard(ctx.env, `/v1/relationships/xrefs-b${bookPad}.json.gz`);

  const startId = ctx.getVerseIdByCoord(`${book}:${chapter}:${verse}`);
  const endId = ctx.getVerseIdByCoord(`${book}:${chapter}:${verseEnd}`);

  const matchesTranslationFilter = e => {
    if (translationFilter === 'bsb' && !e.anchor?.phrase_bsb && e.anchor?.anchor_scope !== 'whole_verse') return false;
    if (translationFilter === 'kjv' && !e.anchor?.phrase_kjv && e.anchor?.anchor_scope !== 'whole_verse') return false;
    return true;
  };

  if (startId == null) {
    const edEntry =
      bookShard?.edition_only_by_coord?.[`${chapter}:${verse}`] ||
      relManifest?.edition_only_verses?.[`${book}:${chapter}:${verse}`] ||
      null;
    if (edEntry) {
      const edEndpoint = edEntry.endpoint || edEntry;
      const edScopeKey = `xref:ed:${book}:${chapter}:${verse}-${verseEnd}:${direction}:${translationFilter}`;
      const edCursor = decodeCursor(params.p_cursor, edScopeKey);
      if (!edCursor.ok) {
        return emptyResp('invalid_cursor', edEndpoint, edCursor.error, attribution);
      }
      const outEdges = direction === 'incoming'
        ? []
        : deduplicateXrefEdges((edEntry.outgoing || []).filter(matchesTranslationFilter));
      const inEdges = direction === 'outgoing'
        ? []
        : deduplicateXrefEdges((edEntry.incoming || []).filter(matchesTranslationFilter));
      const edCombined = [
        ...outEdges.map(item => ({ kind: 'out', item })),
        ...inEdges.map(item => ({ kind: 'in', item })),
      ];
      const edSlice = edCombined.slice(edCursor.offset, edCursor.offset + limit);
      const edNext = edCursor.offset + edSlice.length;
      const edHasMore = edNext < edCombined.length;
      return {
        schema_version: 1,
        status: 'edition_only_passage',
        epistemic_layer: 'static_source_evidence',
        query_passage: edEndpoint,
        direction,
        outgoing: edSlice.filter(x => x.kind === 'out').map(x => x.item),
        incoming: edSlice.filter(x => x.kind === 'in').map(x => x.item),
        page: {
          limit,
          returned: edSlice.length,
          total_available: edCombined.length,
          next_cursor: edHasMore ? encodeCursor(edNext, edScopeKey) : null,
          has_more: edHasMore,
        },
        guardrails: CROSS_REFERENCE_GUARDRAILS,
        dataset_attribution: attribution,
        error_message: edEndpoint.versification_note,
      };
    }
    return emptyResp('invalid_reference', null, `Passage ${book}:${chapter}:${verse} does not exist in canonical 66-book versification.`, attribution);
  }

  const vNote =
    bookShard?.versification_notes_by_coord?.[`${chapter}:${verse}`] ||
    (book === 19 && verse === 0 ? 'Canonical Psalm superscription (verse 0).' : null);
  const vStatus =
    bookShard?.versification_status_by_coord?.[`${chapter}:${verse}`] ||
    (book === 19 && verse === 0 ? 'exact_psalm_heading' : 'exact_canonical');

  const queryPassage = {
    book,
    chapter,
    verse_start: verse,
    verse_end: verseEnd,
    start_verse_id: startId,
    end_verse_id: endId ?? startId,
    is_psalm_heading: book === 19 && verse === 0 && verseEnd === 0,
    versification_status: vStatus,
    edition_only_ref: null,
    versification_note: vNote,
  };

  if (!bookShard) {
    return emptyResp('not_in_slice', queryPassage, 'Book cross-reference shard not yet populated in vertical slice.', attribution);
  }

  if (bookShard.coverage === 'slice') {
    let anyCovered = false;
    for (let v = verse; v <= verseEnd; v++) {
      if (bookShard.covered_verses?.includes(`${chapter}:${v}`)) {
        anyCovered = true;
        break;
      }
    }
    if (!anyCovered) {
      return emptyResp('not_in_slice', queryPassage, 'Passage outside vertical slice; run full import per RELATIONSHIP_IMPORT_HANDOFF.md.', attribution);
    }
  }

  const scopeKey = `xref:${book}:${chapter}:${verse}-${verseEnd}:${direction}:${translationFilter}`;
  const cursorRes = decodeCursor(params.p_cursor, scopeKey);
  if (!cursorRes.ok) {
    return emptyResp('invalid_cursor', queryPassage, cursorRes.error, attribution);
  }

  const rawOut = [];
  const rawIn = [];
  for (let v = verse; v <= verseEnd; v++) {
    const coord = `${chapter}:${v}`;
    if (direction !== 'incoming') {
      for (const e of bookShard.outgoing_by_verse?.[coord] || []) {
        if (matchesTranslationFilter(e)) rawOut.push(e);
      }
    }
    if (direction !== 'outgoing') {
      for (const e of bookShard.incoming_by_verse?.[coord] || []) {
        if (matchesTranslationFilter(e)) rawIn.push(e);
      }
    }
  }

  const dedupOut = deduplicateXrefEdges(rawOut).map(e => ({ ...e }));
  const dedupIn = deduplicateXrefEdges(rawIn).map(e => ({ ...e }));
  let filteredIn = dedupIn;
  if (direction === 'both' && dedupOut.length > 0 && dedupIn.length > 0) {
    const outByUnordered = new Map();
    for (const e of dedupOut) {
      const a = endpointSpanKey(e.source_passage);
      const b = (e.target_spans || []).map(endpointSpanKey).join('+');
      if (a && b) {
        const pairKey = a <= b ? `${a}<->${b}` : `${b}<->${a}`;
        if (!outByUnordered.has(pairKey)) outByUnordered.set(pairKey, e);
      }
    }
    filteredIn = [];
    for (const e of dedupIn) {
      const a = endpointSpanKey(e.source_passage);
      const b = (e.target_spans || []).map(endpointSpanKey).join('+');
      const pairKey = a && b ? (a <= b ? `${a}<->${b}` : `${b}<->${a}`) : '';
      const mirror = pairKey ? outByUnordered.get(pairKey) : null;
      if (mirror) {
        mirror.reciprocal = true;
        continue;
      }
      filteredIn.push(e);
    }
  }
  const combined = [
    ...dedupOut.map(item => ({ kind: 'out', item })),
    ...filteredIn.map(item => ({ kind: 'in', item })),
  ];
  const slice = combined.slice(cursorRes.offset, cursorRes.offset + limit);
  const nextOffset = cursorRes.offset + slice.length;
  const hasMore = nextOffset < combined.length;

  return {
    schema_version: 1,
    status: 'ok',
    epistemic_layer: 'static_source_evidence',
    query_passage: queryPassage,
    direction,
    outgoing: slice.filter(x => x.kind === 'out').map(x => x.item),
    incoming: slice.filter(x => x.kind === 'in').map(x => x.item),
    page: {
      limit,
      returned: slice.length,
      total_available: combined.length,
      next_cursor: hasMore ? encodeCursor(nextOffset, scopeKey) : null,
      has_more: hasMore,
    },
    guardrails: CROSS_REFERENCE_GUARDRAILS,
    dataset_attribution: attribution,
    error_message: null,
  };
}

export async function handleLookupLexicalRelationshipsV1(ctx, params = {}) {
  await ctx.ensureCatalog(ctx.env);
  const limit = clampLimit(params.p_limit, 30);
  const query = params.p_query ? String(params.p_query).trim() : '';
  const lemmaKeyParam = params.p_lemma_key ? String(params.p_lemma_key).trim() : '';
  const wordIdParam = params.p_word_id != null ? Number(params.p_word_id) : null;
  const includeStatistical = params.p_include_statistical !== false;
  const filterCategories = Array.isArray(params.p_categories) && params.p_categories.length > 0
    ? new Set(params.p_categories)
    : null;
  const filterTiers = Array.isArray(params.p_epistemic_tiers) && params.p_epistemic_tiers.length > 0
    ? new Set(params.p_epistemic_tiers)
    : null;

  const emptyLex = (status, errorMessage = null, focus = null) => ({
    schema_version: 1,
    status,
    epistemic_layer: 'static_source_evidence',
    focus,
    homograph_siblings: [],
    edges: [],
    category_counts: {},
    epistemic_counts: {},
    page: { limit, returned: 0, total_available: 0, next_cursor: null, has_more: false },
    error_message: errorMessage,
  });

  if (!query && !lemmaKeyParam && (!Number.isInteger(wordIdParam) || wordIdParam <= 0)) {
    return emptyLex('invalid_request', 'Provide p_query, p_lemma_key, or positive p_word_id.');
  }

  const lexIndex = await ctx.loadJsonShard(ctx.env, '/v1/relationships/lexical-index.json.gz');
  if (!lexIndex) {
    return emptyLex('not_found', 'Lexical relationship index shard not available.');
  }

  let canonicalKey = null;
  if (lemmaKeyParam && lexIndex.bucket_by_key?.[lemmaKeyParam]) {
    canonicalKey = lemmaKeyParam;
  }
  if (!canonicalKey && wordIdParam && lexIndex.key_by_word_id?.[String(wordIdParam)]) {
    canonicalKey = lexIndex.key_by_word_id[String(wordIdParam)];
  }
  if (!canonicalKey && query) {
    if (lexIndex.bucket_by_key?.[query]) {
      canonicalKey = query;
    } else if (lexIndex.key_by_lookup?.[query.toUpperCase()]) {
      canonicalKey = lexIndex.key_by_lookup[query.toUpperCase()];
    } else if (lexIndex.key_by_surface?.[query]) {
      canonicalKey = lexIndex.key_by_surface[query];
    } else {
      const norm = normalizeStrongsBase(query);
      if (norm) {
        const candidates = [
          `${norm.padded}${norm.suffix.toUpperCase()}`,
          `${norm.padded}${norm.suffix.toLowerCase()}`,
          norm.padded,
          norm.compact,
        ];
        for (const c of candidates) {
          if (lexIndex.key_by_lookup?.[c.toUpperCase()]) {
            canonicalKey = lexIndex.key_by_lookup[c.toUpperCase()];
            break;
          }
        }
      }
    }
  }

  if (!canonicalKey) {
    return emptyLex('not_found', `No lexical relationship record found in slice for target "${lemmaKeyParam || query || wordIdParam}".`);
  }

  const bucket = lexIndex.bucket_by_key[canonicalKey];
  const shard = await ctx.loadJsonShard(ctx.env, `/v1/relationships/lexical-${bucket}.json.gz`);
  const record = shard?.entries?.[canonicalKey];
  if (!record) {
    return emptyLex('not_found', `Lexical shard entry missing for ${canonicalKey}.`);
  }

  const scopeKey = [
    'lex',
    canonicalKey,
    includeStatistical ? 'stat1' : 'stat0',
    filterCategories ? [...filterCategories].sort().join(',') : '*',
    filterTiers ? [...filterTiers].sort().join(',') : '*',
  ].join(':');
  const cursorRes = decodeCursor(params.p_cursor, scopeKey);
  if (!cursorRes.ok) {
    return emptyLex('invalid_cursor', cursorRes.error, record.focus);
  }

  let allEdges = [...(record.edges || [])];
  if (!includeStatistical) {
    allEdges = allEdges.filter(e => e.epistemic_tier !== 'statistical_association');
  }

  const categoryCounts = {};
  const epistemicCounts = {};
  for (const e of allEdges) {
    categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
    epistemicCounts[e.epistemic_tier] = (epistemicCounts[e.epistemic_tier] || 0) + 1;
  }

  const filtered = allEdges.filter(e => {
    if (filterCategories && !filterCategories.has(e.category)) return false;
    if (filterTiers && !filterTiers.has(e.epistemic_tier)) return false;
    return true;
  });

  const slice = filtered.slice(cursorRes.offset, cursorRes.offset + limit);
  const nextOffset = cursorRes.offset + slice.length;
  const hasMore = nextOffset < filtered.length;

  return {
    schema_version: 1,
    status: 'ok',
    epistemic_layer: 'static_source_evidence',
    focus: record.focus,
    homograph_siblings: record.homograph_siblings || [],
    edges: slice,
    category_counts: categoryCounts,
    epistemic_counts: epistemicCounts,
    page: {
      limit,
      returned: slice.length,
      total_available: filtered.length,
      next_cursor: hasMore ? encodeCursor(nextOffset, scopeKey) : null,
      has_more: hasMore,
    },
    error_message: null,
  };
}

// === @section:r5-relationship-graph-v2 ===
const USFM_BY_BOOK_V2 = [
  '', 'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA',
  '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO',
  'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO',
  'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT',
  'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP',
  'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE',
  '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
];

const R3_PREDICATES = [
  'grammatical_subject_of',
  'grammatical_object_of',
  'grammatical_indirect_object_of',
  'grammatical_second_object_of',
  'modifies',
  'possessive_construction_with',
];

export const PREDICATE_META = {
  grammatical_subject_of: {
    forward_label: 'Subject of',
    inverse_predicate: 'has_grammatical_subject',
    inverse_label: 'Has grammatical subject',
    guardrail: 'Syntactic subject role in source clause; does not imply semantic agency.',
  },
  grammatical_object_of: {
    forward_label: 'Direct object of',
    inverse_predicate: 'has_grammatical_object',
    inverse_label: 'Has direct object',
    guardrail: 'Syntactic direct object in source clause.',
  },
  grammatical_indirect_object_of: {
    forward_label: 'Indirect object of',
    inverse_predicate: 'has_grammatical_indirect_object',
    inverse_label: 'Has indirect object',
    guardrail: 'Syntactic indirect object / dative recipient role in source clause.',
  },
  grammatical_second_object_of: {
    forward_label: 'Second object of',
    inverse_predicate: 'has_grammatical_second_object',
    inverse_label: 'Has second object',
    guardrail: 'Syntactic second object / object complement in source clause.',
  },
  modifies: {
    forward_label: 'Modifies',
    inverse_predicate: 'modified_by',
    inverse_label: 'Modified by',
    guardrail: 'Verified syntactic modifier attachment to phrase head.',
  },
  possessive_construction_with: {
    forward_label: 'Genitive / construct connection',
    inverse_predicate: 'possessive_head_of',
    inverse_label: 'Head of genitive / construct',
    guardrail: 'Syntactic Hebrew construct chain or Greek genitive modifier; does not imply legal ownership or theological equivalence.',
  },
};

function parseBoolParam(val, fallback) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const low = val.trim().toLowerCase();
    if (low === 'true' || low === '1' || low === 'yes') return true;
    if (low === 'false' || low === '0' || low === 'no') return false;
  }
  return fallback;
}

function parseListParam(val) {
  if (Array.isArray(val)) return val.map(x => String(x).trim()).filter(Boolean);
  if (typeof val === 'string' && val.trim()) {
    return val.split(',').map(x => x.trim()).filter(Boolean);
  }
  return [];
}

function defaultEditionForBook(book) {
  return Number(book) <= 39 ? 'macula-hebrew-wlc' : 'macula-greek-nestle1904';
}

function canonicalRefV2(book, chapter, verse) {
  return `${USFM_BY_BOOK_V2[Number(book)] || `B${book}`} ${Number(chapter)}:${Number(verse)}`;
}

export function parseTokenPosition(tokenId) {
  if (!tokenId) return null;
  const s = String(tokenId);
  if ((s.startsWith('n') || s.startsWith('o')) && s.length >= 12) {
    return Number(s.slice(9, 12)) || null;
  }
  return null;
}

export const BOOK_NUM_BY_USFM_V2 = Object.freeze(
  Object.fromEntries(USFM_BY_BOOK_V2.map((u, i) => [u, i]).filter(([u]) => Boolean(u)))
);

export const RELATION_ID_REGEX = /^rel:([^:]+):([1-3]?[A-Za-z0-9]{2,3})\s+(\d+):(\d+)(?:#([^:]*))?:([a-z_]+):([^:]+):([^:]+)$/;

export function parseRelationId(rawId) {
  if (typeof rawId !== 'string') return { valid: false };
  const m = RELATION_ID_REGEX.exec(rawId.trim());
  if (!m) return { valid: false };
  const edition = m[1];
  const usfm = m[2].toUpperCase();
  const book = BOOK_NUM_BY_USFM_V2[usfm] || null;
  const chapter = Number(m[3]);
  const verse = Number(m[4]);
  const clause = m[5] || null;
  const predicate = m[6];
  const subjectToken = m[7];
  const objectToken = m[8];
  if (!book || !Number.isInteger(chapter) || !Number.isInteger(verse)) {
    return { valid: false };
  }
  return {
    valid: true,
    edition,
    usfm,
    book,
    chapter,
    verse,
    clause,
    predicate,
    subjectToken,
    objectToken,
  };
}

export function classifyPassageCoverage(resolver, book, chapter, verse, edition, passagesShard) {
  if (!Number.isInteger(book) || book < 1 || book > 66) {
    return {
      status: 'invalid_reference',
      classification: 'invalid_reference',
      reason: `Book ${book} is outside the canonical 66-book Bible (1-66).`,
    };
  }
  const usfm = USFM_BY_BOOK_V2[book] || `Book ${book}`;
  const chList = resolver?.canonical_verses?.[`${book}:${chapter}`];
  if (resolver?.canonical_verses && !chList) {
    return {
      status: 'invalid_reference',
      classification: 'invalid_reference',
      reason: `Chapter ${chapter} does not exist in canonical book ${usfm}.`,
    };
  }
  if (chList && !chList.includes(verse)) {
    return {
      status: 'not_in_canonical_verse',
      classification: 'not_in_canonical_verse',
      reason: `Verse ${verse} is not a canonical verse in ${usfm} ${chapter} (may be omitted in critical editions or outside chapter bounds).`,
    };
  }
  const isOT = book <= 39;
  const isHebrewEd = edition === 'macula-hebrew-wlc';
  const isGreekEd = edition === 'macula-greek-nestle1904' || edition === 'macula-greek-sblgnt';
  if (!isHebrewEd && !isGreekEd) {
    return {
      status: 'unsupported_edition',
      classification: 'unsupported_edition',
      reason: `Edition '${edition}' is not supported in the active corpus release (supported: macula-hebrew-wlc, macula-greek-nestle1904, macula-greek-sblgnt).`,
    };
  }
  if ((isOT && !isHebrewEd) || (!isOT && !isGreekEd)) {
    return {
      status: 'unsupported_edition',
      classification: 'unsupported_edition',
      reason: isOT
        ? `Edition '${edition}' is a Greek New Testament edition, but book ${book} is Old Testament (requires macula-hebrew-wlc).`
        : `Edition '${edition}' is a Hebrew Old Testament edition, but book ${book} is New Testament (requires macula-greek-nestle1904 or macula-greek-sblgnt).`,
    };
  }
  const ref = canonicalRefV2(book, chapter, verse);
  const entry = passagesShard?.passages?.[`${edition}:${ref}`];
  if (!entry) {
    return {
      status: 'not_covered',
      classification: 'missing_syntax_evidence',
      reason: `Passage ${ref} (${edition}) has no parsed syntax clause trees in source release.`,
    };
  }
  if ((entry.relations || []).length === 0) {
    return {
      status: 'no_evidence_in_covered_scope',
      classification: 'covered_no_supported_relation',
      reason: `Passage ${ref} (${edition}) parsed successfully, but 0 extracted relations matched the 6 R3 grammatical predicates.`,
    };
  }
  return {
    status: 'ok',
    classification: 'covered_with_evidence',
    reason: `Passage ${ref} (${edition}) has ${entry.relations.length} verified grammatical relations.`,
  };
}

function parseStrongsInputV2(rawInput) {
  const raw = String(rawInput || '').trim();
  const m = /^(?:lemma:)?([HGhg])0*(\d{1,5})([a-zA-Z]?)$/.exec(raw);
  if (!m) return { raw, isStrongs: false };
  const lang = m[1].toUpperCase();
  const numInt = Number(m[2]);
  const numPad = String(numInt).padStart(4, '0');
  const suffix = m[3];
  return {
    raw,
    isStrongs: true,
    baseCompact: `${lang}${numInt}`,
    basePadded: `${lang}${numPad}`,
    suffix: suffix || null,
    exactLemmaCandidates: suffix
      ? [`lemma:${lang}${numPad}${suffix}`, `lemma:${lang}${numPad}${suffix.toUpperCase()}`, `lemma:${lang}${numPad}${suffix.toLowerCase()}`]
      : [`lemma:${lang}${numPad}`, `lemma:${lang}${numInt}`],
  };
}

function buildUncoveredProfile(lemmaId, tuple, siblingsByBase) {
  if (!Array.isArray(tuple)) return null;
  const [lemmaForm, transliteration, gloss, strongsBase, pos] = tuple;
  return {
    lemma_id: lemmaId,
    language: lemmaId.startsWith('lemma:G') ? 'greek' : 'hebrew',
    lemma_form: lemmaForm || lemmaId.replace(/^lemma:/, ''),
    lemma_stripped: null,
    transliteration: transliteration || null,
    gloss: gloss || null,
    homograph_note: null,
    strongs_base: strongsBase || null,
    extended_strongs: lemmaId.startsWith('lemma:') ? lemmaId.slice(6) : lemmaId,
    pos: pos || null,
    primary_word_id: null,
    word_ids: [],
    homograph_siblings: strongsBase ? (siblingsByBase?.[strongsBase] || [lemmaId]) : [lemmaId],
    in_r3_graph: false,
    editions: [],
    outgoing_summary_count: 0,
    incoming_summary_count: 0,
  };
}

function filterFrameRolesV2(frameObj, retainedRoleTokens, filteredOutCandidateTokens) {
  return {
    ...frameObj,
    roles: (frameObj.roles || []).filter(role => {
      if (role.role === 'v') return true;
      if (role.head_token_id !== null && retainedRoleTokens.has(role.head_token_id)) return true;
      return (
        role.state === 'resolved' &&
        role.head_resolution !== 'candidate_fallback' &&
        (!role.head_token_id || !filteredOutCandidateTokens.has(role.head_token_id))
      );
    }),
  };
}

async function resolveLemmaV2(params, resolver, loadUncovered, ctx = null, gramBaseDirOverride = null) {
  const query = params.query != null ? String(params.query).trim() : (params.p_query != null ? String(params.p_query).trim() : '');
  const lemmaIdParam = params.lemma_id != null ? String(params.lemma_id).trim() : (params.p_lemma_key != null ? String(params.p_lemma_key).trim() : '');
  const extendedStrongsParam = params.extended_strongs != null ? String(params.extended_strongs).trim() : '';
  const wordIdParam = params.word_id != null ? Number(params.word_id) : (params.p_word_id != null ? Number(params.p_word_id) : null);
  const tokenIdParam = params.token_id != null ? String(params.token_id).trim() : '';
  const editionParam = params.edition_key || params.edition || null;
  const book = params.book != null ? Number(params.book) : null;
  const chapter = params.chapter != null ? Number(params.chapter) : null;
  const verse = params.verse != null ? Number(params.verse) : null;
  const position = params.position != null ? Number(params.position) : (params.word_position != null ? Number(params.word_position) : null);

  let resolvedOccurrence = null;
  let candidateIds = [];
  let explicitExactId = null;

  const findExactLemmaKey = async (rawKey) => {
    if (!rawKey) return null;
    if (resolver.lemmas?.[rawKey]) return rawKey;
    if (resolver.loadProfile) {
      await resolver.loadProfile(rawKey);
      if (resolver.lemmas?.[rawKey]) return rawKey;
    }
    if (resolver.by_strongs_extended?.[rawKey.toUpperCase()]) return resolver.by_strongs_extended[rawKey.toUpperCase()];
    const extRaw = rawKey.startsWith('lemma:') ? rawKey.slice('lemma:'.length) : rawKey;
    if (resolver.by_strongs_extended?.[extRaw.toUpperCase()]) return resolver.by_strongs_extended[extRaw.toUpperCase()];
    const low = rawKey.toLowerCase();
    for (const k of Object.keys(resolver.lemmas || {})) {
      if (k.toLowerCase() === low) return k;
    }
    // Uncovered entries use canonical lemma keys. A bare Strong's number or
    // English query cannot match one; resolve those through the sharded index.
    if (!rawKey.toLowerCase().startsWith('lemma:')) return null;
    const unc = await loadUncovered();
    if (unc?.entries?.[rawKey]) return rawKey;
    for (const k of Object.keys(unc?.entries || {})) {
      if (k.toLowerCase() === low) return k;
    }
    return null;
  };

  const getProfile = async (lk) => {
    if (!lk) return null;
    if (resolver.lemmas?.[lk]) return resolver.lemmas[lk];
    if (resolver.loadProfile) {
      await resolver.loadProfile(lk);
      if (resolver.lemmas?.[lk]) return resolver.lemmas[lk];
    }
    const unc = await loadUncovered();
    return buildUncoveredProfile(lk, unc?.entries?.[lk], resolver.by_strongs_base);
  };

  const canonicalizeCandidateIds = (ids) => {
    const seen = new Set();
    const result = [];
    for (const id of ids || []) {
      const prof = resolver.lemmas?.[id];
      const targetId = prof?.canonical_lemma_id || id;
      if (!seen.has(targetId)) {
        seen.add(targetId);
        result.push(targetId);
      }
    }
    return result;
  };

  const resolveStrongsOrText = async (rawText) => {
    if (!rawText) return { exactId: null, candidates: [], alias: null };
    let alias = resolver.aliases?.[rawText] ? rawText : null;
    const direct = await findExactLemmaKey(rawText);
    if (direct) {
      if (rawText !== direct && rawText !== direct.replace(/^lemma:/, '')) alias = rawText;
      const prof = await getProfile(direct);
      return { exactId: prof?.canonical_lemma_id || direct, candidates: [prof?.canonical_lemma_id || direct], alias };
    }
    const parsed = parseStrongsInputV2(rawText);
    if (parsed.isStrongs) {
      if (parsed.suffix) {
        for (const c of parsed.exactLemmaCandidates) {
          const hit = await findExactLemmaKey(c);
          if (hit) {
            if (c !== hit) alias = c;
            const prof = await getProfile(hit);
            const cid = prof?.canonical_lemma_id || hit;
            return { exactId: cid, candidates: [cid], alias };
          }
        }
      } else {
        if (resolver.loadProfile) await resolver.loadProfile(parsed.baseCompact);
        const sibs = canonicalizeCandidateIds(resolver.by_strongs_base?.[parsed.baseCompact] || []);
        if (sibs.length === 1) return { exactId: sibs[0], candidates: sibs, alias };
        if (sibs.length > 1) return { exactId: null, candidates: sibs, alias };
      }
      return { exactId: null, candidates: [], alias };
    }
    const strippedSurface = rawText
      .normalize('NFD')
      .replace(/[\u0300-\u036f\u0591-\u05C7]/g, '')
      .normalize('NFC');
    if (resolver.loadProfile) {
      await resolver.loadProfile(rawText);
      await resolver.loadProfile(strippedSurface);
    }
    const surfaceCandidates =
      resolver.by_surface_form?.[rawText] ||
      resolver.by_surface_form?.[strippedSurface] ||
      resolver.by_surface_form?.[strippedSurface.toLowerCase()];
    if (surfaceCandidates?.length) {
      const hits = canonicalizeCandidateIds(surfaceCandidates);
      return { exactId: hits.length === 1 ? hits[0] : null, candidates: hits, alias };
    }
    const cleanQ = rawText.toLowerCase().trim();
    const stripQ = cleanQ.replace(/[^a-z0-9]/g, '');
    const phoneticQ = stripQ.replace(/b/g, 'v');
    if (resolver.loadProfile) {
      await resolver.loadProfile(cleanQ);
      await resolver.loadProfile(stripQ);
    }
    const tlHits =
      resolver.by_transliteration?.[cleanQ] ||
      resolver.by_transliteration?.[stripQ] ||
      resolver.by_transliteration?.[phoneticQ];
    if (tlHits?.length) {
      const hits = canonicalizeCandidateIds(tlHits);
      return { exactId: hits.length === 1 ? hits[0] : null, candidates: hits, alias };
    }
    return { exactId: null, candidates: [], alias };
  };

  const getGramBase = async () => {
    if (gramBaseDirOverride) return gramBaseDirOverride;
    const active = ctx?.loadJsonShard ? await ctx.loadJsonShard(ctx.env, '/v2/relationships/active.json.gz') : null;
    return active?.active_release ? `/v2/relationships/${active.active_release}` : '/v2/relationships/r8-v1.2';
  };

  // 1. Resolve passage occurrence (book, chapter, verse, position) using canonical /v1/chapters + R8 frames/relations
  let passageOcc = null;
  const hasPassageCoords = Number.isInteger(book) && Number.isInteger(chapter) && Number.isInteger(verse);
  const hasOccPosition = hasPassageCoords && Number.isInteger(position) && position > 0;
  if (hasOccPosition && ctx && ctx.loadJsonShard) {
    const ref = canonicalRefV2(book, chapter, verse);
    const edCandidates = editionParam && editionParam !== 'all' && editionParam !== 'auto'
      ? [editionParam]
      : book <= 39
        ? ['macula-hebrew-wlc']
        : ['macula-greek-nestle1904', 'macula-greek-sblgnt'];
    const isOT = book <= 39;
    const wrongEditionForLang = editionParam && editionParam !== 'all' && editionParam !== 'auto' &&
      ((isOT && editionParam !== 'macula-hebrew-wlc') || (!isOT && !['macula-greek-nestle1904', 'macula-greek-sblgnt'].includes(editionParam)));

    if (wrongEditionForLang) {
      return {
        status: 'selector_mismatch',
        lemma_id: null,
        profile: null,
        homograph_siblings: [],
        homograph_candidates: [],
        resolved_occurrence: null,
        mismatch: {
          reason: `Edition '${editionParam}' does not match ${isOT ? 'Old Testament' : 'New Testament'} passage ${ref}.`,
          conflicting_fields: ['edition_key', 'book'],
          selectors: { edition_key: editionParam, passage: ref, position },
        },
        coverage_notice: `Selector mismatch: edition '${editionParam}' is incompatible with passage ${ref}.`,
      };
    }

    const gramBase = await getGramBase();
    const chBucket = gramBase
      ? Number(BigInt('0x' + fnv1a64Hex(`${book}:${chapter}`)) % 64n).toString(16).padStart(2, '0')
      : null;
    const [liteShard, pShard] = await Promise.all([
      chBucket ? ctx.loadJsonShard(ctx.env, `${gramBase}/chapter-lite/shard-${chBucket}.json.gz`) : Promise.resolve(null),
      ctx.loadJsonShard(ctx.env, `${gramBase}/passages/b${book}-c${chapter}.json.gz`),
    ]);

    let chTok = null;
    const liteChapter = await packedShardEntry(liteShard, `${book}:${chapter}`, gramBase, p => ctx.loadJsonShard(ctx.env, p));
    const liteVerse = liteChapter?.[String(verse)];
    if (liteVerse && Array.isArray(liteVerse.t)) {
      const tup = liteVerse.t.find(row => Number(row[0]) === position);
      if (tup) {
        chTok = {
          word_position: Number(tup[0]),
          word_id: tup[1] ?? null,
          surface_form: tup[2] ?? null,
          base_strongs: tup[3] ?? null,
          morphemes: Array.isArray(tup[4]) ? tup[4].map(m => ({ morpheme_role: m[0] || '', lemma_key: m[1] || '' })) : [],
        };
      }
    } else {
      const chShard = await ctx.loadJsonShard(ctx.env, `/v1/chapters/b${book}-c${chapter}.json.gz`);
      chTok = chShard?.verses?.[String(verse)]?.tokens?.find(t => Number(t.word_position) === position) || null;
    }

    let r8Match = null;
    for (const ed of edCandidates) {
      const pEntry = pShard?.passages?.[`${ed}:${ref}`];
      if (!pEntry) continue;
      for (const rel of pEntry.relations || []) {
        const sPos = rel.subject?.word_position && rel.subject.word_position < 100
          ? rel.subject.word_position
          : parseTokenPosition(rel.subject?.token_id);
        const oPos = rel.object?.word_position && rel.object.word_position < 100
          ? rel.object.word_position
          : parseTokenPosition(rel.object?.token_id);
        if (sPos === position && rel.subject?.lemma_id) {
          r8Match = {
            edition: ed,
            source_token_id: rel.subject.source_token_id || rel.subject.token_id || null,
            word_id: rel.subject.word_id ?? null,
            lemma_id: rel.subject.lemma_id,
            surface_form: rel.subject.surface_form || null,
          };
          break;
        }
        if (oPos === position && rel.object?.lemma_id) {
          r8Match = {
            edition: ed,
            source_token_id: rel.object.source_token_id || rel.object.token_id || null,
            word_id: rel.object.word_id ?? null,
            lemma_id: rel.object.lemma_id,
            surface_form: rel.object.surface_form || null,
          };
          break;
        }
      }
      if (!r8Match) {
        for (const fr of pEntry.frames || []) {
          if (fr.predicate) {
            const pPos = fr.predicate.word_position && fr.predicate.word_position < 100
              ? fr.predicate.word_position
              : parseTokenPosition(fr.predicate.token_id);
            if (pPos === position && fr.predicate.lemma_id) {
              r8Match = {
                edition: ed,
                source_token_id: fr.predicate.source_token_id || fr.predicate.token_id || null,
                word_id: fr.predicate.word_id ?? null,
                lemma_id: fr.predicate.lemma_id,
                surface_form: fr.predicate.surface_form || fr.predicate.source_form || null,
              };
              break;
            }
          }
          for (const role of fr.roles || []) {
            const rPos = role.word_position && role.word_position < 100
              ? role.word_position
              : parseTokenPosition(role.head_token_id);
            if (rPos === position && role.lemma_id) {
              r8Match = {
                edition: ed,
                source_token_id: role.source_token_id || role.head_token_id || null,
                word_id: role.word_id ?? null,
                lemma_id: role.lemma_id,
                surface_form: role.surface_form || null,
              };
              break;
            }
          }
          if (r8Match) break;
        }
      }
      if (r8Match) break;
    }

    if (chTok || r8Match) {
      const morphemeKeys = [];
      const stemKeys = [];
      for (const m of chTok?.morphemes || []) {
        if (!m?.lemma_key) continue;
        if (!morphemeKeys.includes(m.lemma_key)) morphemeKeys.push(m.lemma_key);
        if (m.morpheme_role === 'stem' || (!String(m.morpheme_role || '').startsWith('prefix_') && !String(m.morpheme_role || '').startsWith('suffix_'))) {
          if (!stemKeys.includes(m.lemma_key)) stemKeys.push(m.lemma_key);
        }
      }
      if (r8Match?.lemma_id && !morphemeKeys.includes(r8Match.lemma_id)) {
        morphemeKeys.push(r8Match.lemma_id);
      }
      if (r8Match?.lemma_id && !stemKeys.includes(r8Match.lemma_id)) {
        stemKeys.unshift(r8Match.lemma_id);
      }
      // Also resolve chTok.base_strongs if morphemes lacked stem lemma_key
      if (stemKeys.length === 0 && chTok?.base_strongs) {
        const bsRes = await resolveStrongsOrText(chTok.base_strongs);
        for (const c of bsRes.candidates) {
          if (!morphemeKeys.includes(c)) morphemeKeys.push(c);
          if (!stemKeys.includes(c)) stemKeys.push(c);
        }
      }
      const targetKeysForProfile = stemKeys.length > 0 ? stemKeys : morphemeKeys;
      for (const k of targetKeysForProfile) await getProfile(k);
      for (const k of morphemeKeys) {
        if (!resolver.lemmas?.[k] && resolver.loadProfile) await resolver.loadProfile(k);
      }
      const canonicalAll = canonicalizeCandidateIds(morphemeKeys);
      const canonicalStem = canonicalizeCandidateIds(stemKeys);
      const stepWordId = chTok?.word_id ?? (r8Match?.word_id ?? null);
      const primaryLemmaId = canonicalStem[0] || canonicalAll[0] || null;
      const resolvedEd = r8Match?.edition || edCandidates[0];
      passageOcc = {
        edition: resolvedEd,
        reference: ref,
        position,
        word_id: stepWordId,
        source_token_id: r8Match?.source_token_id || null,
        surface_form: chTok?.surface_form || r8Match?.surface_form || null,
        lemma_id: primaryLemmaId,
        all_lemma_keys: canonicalAll,
        stem_lemma_keys: canonicalStem,
        occurrence_resolution_status: stepWordId != null ? 'verified_occurrence' : 'unresolved',
      };
    } else {
      passageOcc = { missing: true, reference: ref, position };
    }
  }

  // 2. Resolve token_id selector if provided
  let tokenSel = null;
  const rawTokenId = tokenIdParam || (/^[on]\d{8,14}$/.test(query) ? query : '');
  if (rawTokenId) {
    const edPrefix = rawTokenId.startsWith('o') ? 'macula-hebrew-wlc' : (editionParam && editionParam !== 'all' ? editionParam : 'macula-greek-nestle1904');
    const lk = resolver.token_to_lemma?.[`${edPrefix}:${rawTokenId}`] || resolver.token_to_lemma?.[`macula-greek-sblgnt:${rawTokenId}`];
    if (lk) {
      await getProfile(lk);
      tokenSel = { token_id: rawTokenId, lemma_id: resolver.lemmas?.[lk]?.canonical_lemma_id || lk, word_id: null, reference: null, position: parseTokenPosition(rawTokenId) };
    } else if (ctx && ctx.loadJsonShard) {
      const b = Number(rawTokenId.slice(1, 3));
      const c = Number(rawTokenId.slice(3, 6));
      if (b >= 1 && b <= 66) {
        const gramBase = await getGramBase();
        const pShard = await ctx.loadJsonShard(ctx.env, `${gramBase}/passages/b${b}-c${c}.json.gz`);
        if (pShard?.passages) {
          for (const p of Object.values(pShard.passages)) {
            for (const rel of p.relations || []) {
              const hit = rel.subject?.token_id === rawTokenId ? rel.subject : (rel.object?.token_id === rawTokenId ? rel.object : null);
              if (hit) {
                await getProfile(hit.lemma_id);
                tokenSel = {
                  token_id: rawTokenId,
                  lemma_id: resolver.lemmas?.[hit.lemma_id]?.canonical_lemma_id || hit.lemma_id,
                  word_id: hit.word_id ?? null,
                  edition: rel.edition,
                  reference: rel.canonical_ref,
                  position: (hit.word_position && hit.word_position < 100 ? hit.word_position : null) ?? parseTokenPosition(rawTokenId),
                  surface_form: hit.surface_form || null,
                };
                break;
              }
            }
            if (!tokenSel) {
              for (const fr of p.frames || []) {
                const predHit = fr.predicate?.token_id === rawTokenId ? fr.predicate : null;
                const roleHit = predHit || (fr.roles || []).find(r => r.head_token_id === rawTokenId) || null;
                if (roleHit && roleHit.lemma_id) {
                  await getProfile(roleHit.lemma_id);
                  tokenSel = {
                    token_id: rawTokenId,
                    lemma_id: resolver.lemmas?.[roleHit.lemma_id]?.canonical_lemma_id || roleHit.lemma_id,
                    word_id: roleHit.word_id ?? null,
                    edition: p.edition,
                    reference: p.reference,
                    position: (roleHit.word_position && roleHit.word_position < 100 ? roleHit.word_position : null) ?? parseTokenPosition(rawTokenId),
                    surface_form: roleHit.surface_form || roleHit.source_form || null,
                  };
                  break;
                }
              }
            }
            if (tokenSel) break;
          }
        }
      }
    }
  }

  // 3. Resolve word_id selector if provided
  let wordIdLemmaIds = null;
  if (Number.isInteger(wordIdParam) && wordIdParam > 0) {
    if (resolver.loadWordId) await resolver.loadWordId(wordIdParam);
    const byWid = resolver.by_word_id?.[String(wordIdParam)] || [];
    // Canonicalize secondary morphemes from the sharded resolver only. Their
    // absence from the syntax graph must not load the full uncovered lexicon.
    for (const lk of byWid) {
      if (resolver.loadProfile) await resolver.loadProfile(lk);
    }
    wordIdLemmaIds = canonicalizeCandidateIds(byWid);
  }

  // 4. Resolve lemma_id, extended_strongs, and query selectors independently
  let lemmaIdSel = null;
  if (lemmaIdParam) {
    const r = await resolveStrongsOrText(lemmaIdParam);
    lemmaIdSel = r;
  }

  let extSel = null;
  if (extendedStrongsParam) {
    extSel = await resolveStrongsOrText(extendedStrongsParam);
  }

  let querySel = null;
  if (query && !/^[on]\d{8,14}$/.test(query)) {
    querySel = await resolveStrongsOrText(query);
  }

  // 5. Validate consistency across ALL supplied selectors (reject contradictions instead of silent substitution)
  const intersect = (a, b) => a.filter(x => b.includes(x));
  const buildMismatch = (conflictingFields, reason, extra = {}) => ({
    status: 'selector_mismatch',
    lemma_id: null,
    profile: null,
    homograph_siblings: [],
    homograph_candidates: [],
    resolved_occurrence: null,
    mismatch: {
      reason,
      conflicting_fields: conflictingFields,
      selectors: {
        ...(query ? { query: { input: query, resolved_candidates: querySel?.candidates || (tokenSel ? [tokenSel.lemma_id] : []) } } : {}),
        ...(lemmaIdParam ? { lemma_id: { input: lemmaIdParam, resolved_candidates: lemmaIdSel?.candidates || [] } } : {}),
        ...(extendedStrongsParam ? { extended_strongs: { input: extendedStrongsParam, resolved_candidates: extSel?.candidates || [] } } : {}),
        ...(Number.isInteger(wordIdParam) && wordIdParam > 0 ? { word_id: { input: wordIdParam, resolved_lemma_ids: wordIdLemmaIds || [] } } : {}),
        ...(tokenIdParam ? { token_id: { input: tokenIdParam, resolved_lemma_id: tokenSel?.lemma_id || null } } : {}),
        ...(hasOccPosition ? {
          passage_position: passageOcc?.missing
            ? { reference: passageOcc.reference, position: passageOcc.position, found: false }
            : {
                reference: passageOcc.reference,
                position: passageOcc.position,
                actual_word_id: passageOcc.word_id,
                actual_lemma_id: passageOcc.lemma_id,
                actual_lemma_keys: passageOcc.all_lemma_keys,
              },
        } : {}),
        ...extra,
      },
    },
    coverage_notice: reason,
  });

  if (passageOcc?.missing) {
    if (query || lemmaIdParam || extendedStrongsParam || (Number.isInteger(wordIdParam) && wordIdParam > 0) || tokenIdParam) {
      return buildMismatch(
        ['position'],
        `Passage ${passageOcc.reference} position ${passageOcc.position} does not exist in canonical tokens.`
      );
    }
    return {
      status: 'not_found',
      lemma_id: null,
      profile: null,
      homograph_siblings: [],
      homograph_candidates: [],
      resolved_occurrence: null,
    };
  }

  if (passageOcc && !passageOcc.missing) {
    if (Number.isInteger(wordIdParam) && wordIdParam > 0 && passageOcc.word_id != null && wordIdParam !== passageOcc.word_id) {
      return buildMismatch(
        ['word_id', 'position'],
        `Selector mismatch: supplied word_id=${wordIdParam} contradicts ${passageOcc.reference} position ${passageOcc.position} (actual word_id=${passageOcc.word_id}, ${passageOcc.lemma_id}).`
      );
    }
    if (lemmaIdParam && (!lemmaIdSel?.candidates?.length || intersect(lemmaIdSel.candidates, passageOcc.all_lemma_keys).length === 0)) {
      return buildMismatch(
        ['lemma_id', 'position'],
        `Selector mismatch: supplied lemma_id=${lemmaIdParam} contradicts ${passageOcc.reference} position ${passageOcc.position} (${passageOcc.all_lemma_keys.join(', ')}).`
      );
    }
    if (extendedStrongsParam && (!extSel?.candidates?.length || intersect(extSel.candidates, passageOcc.all_lemma_keys).length === 0)) {
      return buildMismatch(
        ['extended_strongs', 'position'],
        `Selector mismatch: supplied extended_strongs=${extendedStrongsParam} contradicts ${passageOcc.reference} position ${passageOcc.position} (${passageOcc.all_lemma_keys.join(', ')}).`
      );
    }
    if (querySel && (!querySel.candidates.length || intersect(querySel.candidates, passageOcc.all_lemma_keys).length === 0)) {
      return buildMismatch(
        ['query', 'position'],
        `Selector mismatch: supplied query="${query}" (${querySel.candidates.join(', ') || 'unresolved'}) contradicts ${passageOcc.reference} position ${passageOcc.position} (${passageOcc.all_lemma_keys.join(', ')}).`
      );
    }
    if (tokenSel && ((tokenSel.position != null && tokenSel.position !== passageOcc.position) || (tokenSel.reference && tokenSel.reference !== passageOcc.reference))) {
      return buildMismatch(
        ['token_id', 'position'],
        `Selector mismatch: supplied token_id=${tokenSel.token_id} contradicts ${passageOcc.reference} position ${passageOcc.position}.`
      );
    }
  }

  if (Number.isInteger(wordIdParam) && wordIdParam > 0 && wordIdLemmaIds && wordIdLemmaIds.length > 0) {
    if (lemmaIdParam && (!lemmaIdSel?.candidates?.length || intersect(lemmaIdSel.candidates, wordIdLemmaIds).length === 0)) {
      return buildMismatch(
        ['word_id', 'lemma_id'],
        `Selector mismatch: word_id=${wordIdParam} (${wordIdLemmaIds.join(', ')}) contradicts lemma_id=${lemmaIdParam}.`
      );
    }
    if (extendedStrongsParam && (!extSel?.candidates?.length || intersect(extSel.candidates, wordIdLemmaIds).length === 0)) {
      return buildMismatch(
        ['word_id', 'extended_strongs'],
        `Selector mismatch: word_id=${wordIdParam} (${wordIdLemmaIds.join(', ')}) contradicts extended_strongs=${extendedStrongsParam}.`
      );
    }
    if (querySel && (!querySel.candidates.length || intersect(querySel.candidates, wordIdLemmaIds).length === 0)) {
      return buildMismatch(
        ['word_id', 'query'],
        `Selector mismatch: word_id=${wordIdParam} (${wordIdLemmaIds.join(', ')}) contradicts query="${query}" (${querySel.candidates.join(', ') || 'unresolved'}).`
      );
    }
  }

  if (lemmaIdParam && querySel && lemmaIdSel?.candidates?.length && (!querySel.candidates.length || intersect(lemmaIdSel.candidates, querySel.candidates).length === 0)) {
    return buildMismatch(
      ['lemma_id', 'query'],
      `Selector mismatch: lemma_id=${lemmaIdParam} contradicts query="${query}".`
    );
  }

  if (tokenSel) {
    if (lemmaIdParam && (!lemmaIdSel?.candidates?.length || !lemmaIdSel.candidates.includes(tokenSel.lemma_id))) {
      return buildMismatch(['token_id', 'lemma_id'], `Selector mismatch: token_id=${tokenSel.token_id} (${tokenSel.lemma_id}) contradicts lemma_id=${lemmaIdParam}.`);
    }
    if (Number.isInteger(wordIdParam) && wordIdParam > 0 && tokenSel.word_id != null && tokenSel.word_id !== wordIdParam) {
      return buildMismatch(['token_id', 'word_id'], `Selector mismatch: token_id=${tokenSel.token_id} (word_id=${tokenSel.word_id}) contradicts word_id=${wordIdParam}.`);
    }
  }

  // 6. Narrow consistent candidate set (intersection of all supplied selectors)
  let queriedAlias = querySel?.alias || lemmaIdSel?.alias || extSel?.alias || null;
  let narrowed = null;
  const applyIntersect = (cands) => {
    if (!cands || cands.length === 0) return;
    narrowed = narrowed === null ? [...cands] : intersect(narrowed, cands);
  };
  if (lemmaIdSel?.candidates?.length) applyIntersect(lemmaIdSel.candidates);
  if (extSel?.candidates?.length) applyIntersect(extSel.candidates);
  if (querySel?.candidates?.length) applyIntersect(querySel.candidates);
  if (tokenSel?.lemma_id) applyIntersect([tokenSel.lemma_id]);
  if (wordIdLemmaIds?.length) applyIntersect(wordIdLemmaIds);
  if (passageOcc && !passageOcc.missing) {
    const occChoice = (narrowed && narrowed.length > 0)
      ? passageOcc.all_lemma_keys
      : (passageOcc.stem_lemma_keys.length ? passageOcc.stem_lemma_keys : passageOcc.all_lemma_keys);
    applyIntersect(occChoice);
    const chosenOccLemma = (narrowed && narrowed[0]) || passageOcc.lemma_id;
    resolvedOccurrence = {
      edition: passageOcc.edition,
      reference: passageOcc.reference,
      position: passageOcc.position,
      word_id: passageOcc.word_id,
      ...(passageOcc.source_token_id ? { source_token_id: passageOcc.source_token_id } : {}),
      ...(passageOcc.surface_form ? { surface_form: passageOcc.surface_form } : {}),
      lemma_id: chosenOccLemma,
      occurrence_resolution_status: passageOcc.occurrence_resolution_status,
    };
  } else if (tokenSel) {
    resolvedOccurrence = {
      edition: tokenSel.edition || null,
      reference: tokenSel.reference || null,
      position: tokenSel.position,
      word_id: tokenSel.word_id,
      source_token_id: tokenSel.token_id,
      ...(tokenSel.surface_form ? { surface_form: tokenSel.surface_form } : {}),
      lemma_id: tokenSel.lemma_id,
      occurrence_resolution_status: tokenSel.word_id != null ? 'verified_occurrence' : 'unresolved',
    };
  }

  if (narrowed && narrowed.length === 1) explicitExactId = narrowed[0];
  else if (narrowed && narrowed.length > 1) candidateIds = narrowed;

  if (explicitExactId) {
    let profile = await getProfile(explicitExactId);
    const targetLemmaId = profile?.canonical_lemma_id || explicitExactId;
    if (profile?.canonical_lemma_id) {
      const aliasName = queriedAlias || query || profile.extended_strongs || explicitExactId;
      const canonicalProfile = await getProfile(profile.canonical_lemma_id);
      if (canonicalProfile) {
        profile = { ...canonicalProfile, queried_alias: aliasName };
      } else {
        profile = { ...profile, queried_alias: aliasName };
      }
    } else if (profile && queriedAlias) {
      profile = { ...profile, queried_alias: queriedAlias };
    }
    const sibProfiles = await Promise.all((profile?.homograph_siblings || [targetLemmaId]).map(getProfile));
    return {
      status: 'ok',
      lemma_id: targetLemmaId,
      profile,
      homograph_siblings: sibProfiles.filter(Boolean),
      homograph_candidates: [],
      resolved_occurrence: resolvedOccurrence,
    };
  }

  if (candidateIds.length > 1) {
    const candidates = (await Promise.all(candidateIds.map(getProfile))).filter(Boolean);
    return {
      status: 'needs_disambiguation',
      lemma_id: null,
      profile: null,
      homograph_siblings: candidates,
      homograph_candidates: candidates,
      resolved_occurrence: resolvedOccurrence,
    };
  }

  return {
    status: 'not_found',
    lemma_id: null,
    profile: null,
    homograph_siblings: [],
    homograph_candidates: [],
    resolved_occurrence: resolvedOccurrence,
  };
}

async function loadPassagesShardForRef(ctx, baseDir, manifest, book, chapter) {
  if (!Number.isInteger(book) || !Number.isInteger(chapter)) return null;
  if (manifest.sharding?.passages_by_chapter) {
    return ctx.loadJsonShard(ctx.env, `${baseDir}/passages/b${book}-c${chapter}.json.gz`);
  }
  if (manifest.sharding?.passages_by_book) {
    return ctx.loadJsonShard(ctx.env, `${baseDir}/passages/b${book}.json.gz`);
  }
  return ctx.loadJsonShard(ctx.env, `${baseDir}/passages-by-ref.json.gz`);
}

function computeLayerBucketHex(layerMeta, key) {
  const alg = String(layerMeta?.hash_algorithm || '').trim();
  const bucketsNum = Number(layerMeta?.buckets);
  if (!alg || !Number.isInteger(bucketsNum) || bucketsNum <= 0) {
    throw new Error(`Invalid layer sharding manifest declaration: ${JSON.stringify(layerMeta)}`);
  }
  const buckets = BigInt(bucketsNum);
  const hex64 = fnv1a64Hex(key);
  let idx;
  if (/^fnv1a64_mod\d*$/.test(alg)) {
    idx = Number(BigInt('0x' + hex64) % buckets);
  } else if (/^fnv1a64_hi32_mod\d*$/.test(alg)) {
    idx = Number(BigInt('0x' + hex64.slice(0, 8)) % buckets);
  } else {
    throw new Error(`Unsupported shard hash_algorithm declared in manifest: ${alg}`);
  }
  const padLen = Math.max(2, Math.ceil(Math.log2(Math.max(2, bucketsNum)) / 4));
  return idx.toString(16).padStart(padLen, '0');
}

function buildLayerAssetPath(layerMeta, formatKey, keyOrVars) {
  const fmt = layerMeta?.shard_path_formats?.[formatKey];
  if (!fmt) {
    throw new Error(`Missing shard_path_formats.${formatKey} in manifest.`);
  }
  let vars = keyOrVars;
  if (typeof keyOrVars === 'string') {
    const hex = computeLayerBucketHex(layerMeta, keyOrVars);
    vars = { hex2: hex, hex3: hex };
  }
  let rel = fmt;
  for (const [k, v] of Object.entries(vars)) {
    rel = rel.replaceAll(`{${k}}`, String(v));
  }
  return `${layerMeta.base_dir}/${rel}`;
}

function lookupResolverWordMeta(resolver, lemmaKey) {
  if (!resolver?.lemmas || !lemmaKey || typeof lemmaKey !== 'string') return null;
  let profile = resolver.lemmas[lemmaKey] || null;
  if (!profile && lemmaKey.startsWith('lemma:')) {
    const parsed = parseStrongsInputV2(lemmaKey);
    if (parsed.isStrongs) {
      for (const cand of parsed.exactLemmaCandidates) {
        if (resolver.lemmas[cand]) {
          profile = resolver.lemmas[cand];
          break;
        }
      }
      if (!profile && !parsed.suffix && resolver.by_strongs_base) {
        const sibs = resolver.by_strongs_base[parsed.baseCompact] || [];
        if (sibs.length === 1 && resolver.lemmas[sibs[0]]) {
          profile = resolver.lemmas[sibs[0]];
        }
      }
    }
  }
  if (!profile) return null;
  return {
    word_id: typeof profile.primary_word_id === 'number' && profile.primary_word_id > 0 ? profile.primary_word_id : null,
    gloss: profile.gloss || null,
    lemma_form: profile.lemma_form || null,
    transliteration: profile.transliteration || null,
    extended_strongs: profile.extended_strongs || null,
    language: profile.language || null,
  };
}

function enrichLexicalEndpoint(ep, resolver) {
  if (!ep || typeof ep !== 'object') return ep;
  const key = ep.canonical_key || ep.key || ep.endpoint_key || ep.lemma_key || (typeof ep.lemma_id === 'string' ? ep.lemma_id : null);
  const isLemmaEndpoint = Boolean(key && key.startsWith('lemma:')) && ep.entity_kind !== 'sense' && ep.entity_kind !== 'root';
  if (!isLemmaEndpoint) {
    return ep.word_id == null ? ep : { ...ep, word_id: null };
  }
  const meta = lookupResolverWordMeta(resolver, key);
  const resolvedWordId = meta?.word_id ?? (typeof ep.word_id === 'number' && ep.word_id > 0 ? ep.word_id : null);
  if (ep.word_id === resolvedWordId) return ep;
  return { ...ep, word_id: resolvedWordId };
}

function enrichContextualSlice(items, resolver, filterOpts = {}) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const needSameClause = filterOpts.scope === 'same_clause' || (filterOpts.minSameClause || 0) > 0;
  const needColloc = filterOpts.scope === 'collocation' || (filterOpts.minColloc || 0) > 0;
  return items.map(item => {
    const meta = resolver ? lookupResolverWordMeta(resolver, item.target_lemma_key) : null;
    let out = meta
      ? {
          ...item,
          target_word_id: item.target_word_id ?? meta.word_id,
          target_primary_gloss: item.target_primary_gloss ?? meta.gloss,
        }
      : { ...item };

    if (needSameClause || needColloc) {
      const pool = [
        ...(needColloc ? (out.collocation_samples || []) : []),
        ...(needSameClause ? (out.same_clause_samples || []) : []),
        ...(out.sample_passages || []),
      ];
      const dedup = [];
      const seen = new Set();
      for (const p of pool) {
        if (!p || !p.ref || seen.has(p.ref)) continue;
        seen.add(p.ref);
        dedup.push(p);
      }
      const matching = dedup.filter(p =>
        (!needSameClause || p.in_same_clause === true) &&
        (!needColloc || p.is_collocation === true)
      );
      if (matching.length > 0) {
        out.sample_passages = matching.slice(0, 5);
        out.witness_status = 'verified_matching_witness';
      } else {
        out.witness_status = 'matching_witness_not_returned';
        out.witness_notice = needColloc
          ? 'Aggregate collocation count is positive, but no qualifying is_collocation sample passage was stored in this summary record.'
          : 'Aggregate same_clause count is positive, but no qualifying in_same_clause sample passage was stored in this summary record.';
      }
    }
    delete out.same_clause_samples;
    delete out.collocation_samples;
    return out;
  });
}

function enrichLxxCandidates(cands, resolver, defaultLang) {
  if (!Array.isArray(cands) || cands.length === 0) return cands;
  return cands.map(c => {
    const meta = lookupResolverWordMeta(resolver, c.lemma_key);
    const code = c.extended_strongs || meta?.extended_strongs || (c.lemma_key ? String(c.lemma_key).replace(/^lemma:/, '') : null);
    return {
      ...c,
      word_id: c.word_id ?? meta?.word_id ?? null,
      original_script: c.original_script || c.lemma_script || meta?.lemma_form || null,
      primary_gloss: c.primary_gloss || meta?.gloss || c.gloss || null,
      extended_strongs: code,
      language: c.language || meta?.language || defaultLang,
    };
  });
}

async function fetchLexicalLayerData(ctx, manifest, lemmaKey, params = {}, resolver = null) {
  const lexLayer = manifest?.layers?.lexical;
  if (!lexLayer) {
    return { available: false, status: 'unavailable', items: [], counts: { total: 0 }, page: { limit: 25, offset: 0, returned: 0, total_available: 0, has_more: false, next_offset: null } };
  }
  const limit = clampLimit(params.lexical_limit ?? params.limit, 25);
  const offset = Math.max(0, Number(params.lexical_offset ?? params.offset) || 0);
  const dirFilter = String(params.lexical_direction || params.direction || 'both').toLowerCase();
  const catFilterList = parseListParam(params.lexical_categories || params.categories);
  const catFilterSet = catFilterList.length > 0 ? new Set(catFilterList) : null;

  const [idxShard, edgeShard] = await Promise.all([
    ctx.loadJsonShard(ctx.env, buildLayerAssetPath(lexLayer, 'lemma_index', lemmaKey)),
    ctx.loadJsonShard(ctx.env, lexLayer.worker_shards
      ? `${lexLayer.worker_shards.base_dir}/${lexLayer.worker_shards.path.replace('{hex3}', computeLayerBucketHex(lexLayer.worker_shards, lemmaKey))}`
      : buildLayerAssetPath(lexLayer, 'lexical_edges', lemmaKey)),
  ]);
  const indexSummary = idxShard?.[lemmaKey] || null;
  const endpointLinks = edgeShard?.endpoint_index?.[lemmaKey] || [];
  const edgesById = edgeShard?.edges_by_id || {};

  const directionCounts = { outgoing: 0, incoming: 0, symmetric: 0 };
  const categoryCounts = {};
  const fullRecords = [];

  for (const link of endpointLinks) {
    const edge = edgesById[link.relationship_id];
    if (!edge) continue;
    if (link.role === 'outgoing') directionCounts.outgoing++;
    else if (link.role === 'incoming') directionCounts.incoming++;
    else directionCounts.symmetric++;
    categoryCounts[edge.category] = (categoryCounts[edge.category] || 0) + 1;

    if (dirFilter !== 'both' && link.role !== dirFilter) continue;
    if (catFilterSet && !catFilterSet.has(edge.category)) continue;

    const peer = link.role === 'incoming'
      ? edge.subject
      : link.role === 'outgoing'
        ? edge.target
        : (edge.subject?.canonical_key === lemmaKey ? edge.target : edge.subject);
    fullRecords.push({
      relationship_id: edge.relationship_id,
      category: edge.category,
      raw_relation_code: edge.raw_relation_code,
      epistemic_tier: edge.epistemic_tier,
      direction: edge.direction,
      role: link.role,
      peer,
      subject: edge.subject,
      target: edge.target,
      explanation: edge.explanation,
      provenance: edge.provenance,
      guardrails: edge.guardrails,
    });
  }

  const rawSlice = fullRecords.slice(offset, offset + limit);
  const slice = rawSlice.map(rec => ({
    ...rec,
    peer: enrichLexicalEndpoint(rec.peer, resolver),
    subject: enrichLexicalEndpoint(rec.subject, resolver),
    target: enrichLexicalEndpoint(rec.target, resolver),
  }));
  const nextOffset = offset + slice.length;
  const hasMore = nextOffset < fullRecords.length;
  return {
    available: true,
    status: fullRecords.length > 0 ? 'ok' : 'no_evidence_in_covered_scope',
    dataset_version: lexLayer.release_version,
    sharding: { hash_algorithm: lexLayer.hash_algorithm, buckets: lexLayer.buckets },
    lemma_summary: indexSummary,
    counts: {
      total_unfiltered: endpointLinks.length,
      total_filtered: fullRecords.length,
      returned: slice.length,
      by_direction: directionCounts,
      by_category: categoryCounts,
    },
    items: slice,
    page: {
      limit,
      offset,
      returned: slice.length,
      total_available: fullRecords.length,
      has_more: hasMore,
      next_offset: hasMore ? nextOffset : null,
    },
    provenance: {
      dataset: 'STEPBible TBESH/TBESG & OpenScriptures (R9A)',
      license: 'CC BY 4.0',
      restricted_fields_excluded: ['tbesh_column_7_meaning', 's21_fields'],
    },
    guardrails: {
      shared_root_not_synonymy: true,
      preserves_sense_subdivisions: true,
      preserves_directionality: true,
    },
  };
}

async function fetchContextualLayerData(ctx, manifest, lemmaKey, params = {}, resolver = null) {
  const ctxLayer = manifest?.layers?.contextual;
  if (!ctxLayer) {
    return { available: false, status: 'unavailable', items: [], counts: { total_neighbors: 0 }, page: { limit: 25, offset: 0, returned: 0, total_available: 0, has_more: false, next_offset: null } };
  }
  const limit = clampLimit(params.contextual_limit ?? params.limit, 25);
  const offset = Math.max(0, Number(params.contextual_offset ?? params.offset) || 0);
  const scope = String(params.contextual_scope || params.scope || 'all').toLowerCase();
  const minSameVerse = Math.max(Number(params.min_same_verse) || 1, 1);
  const minSameClause = Math.max(Number(params.min_same_clause) || (scope === 'same_clause' ? 1 : 0), 0);
  const minColloc = Math.max(Number(params.min_collocation) || (scope === 'collocation' ? 1 : 0), 0);
  const needsCustomFilter = minSameVerse > 1 || minSameClause > 0 || minColloc > 0;

  const topShardPath = buildLayerAssetPath(ctxLayer, 'contextual_neighbors', lemmaKey);
  const topShard = await ctx.loadJsonShard(ctx.env, topShardPath);
  const entry = topShard?.[lemmaKey];
  if (!entry) {
    return {
      available: true,
      status: 'no_evidence_in_covered_scope',
      dataset_version: ctxLayer.release_version,
      sharding: { hash_algorithm: ctxLayer.hash_algorithm, buckets: ctxLayer.buckets },
      counts: { total_neighbors: 0, filtered_total: 0, returned: 0, lossless: true },
      items: [],
      page: { limit, offset, returned: 0, total_available: 0, has_more: false, next_offset: null },
      guardrails: { proximity_only: true, implies_synonymy: false, implies_grammar: false, implies_causality: false, distinct_verse_units: true },
    };
  }

  const topItems = entry.neighbors || [];
  const overflowPages = entry.overflow_pages || [];
  const totalUnfiltered = Number(entry.total_neighbors ?? topItems.length);

  const matchesItem = item =>
    (item.counts?.same_verse || 0) >= minSameVerse &&
    (item.counts?.same_clause || 0) >= minSameClause &&
    (item.counts?.collocation_distance_le_3 || 0) >= minColloc;

  // Fast O(1)-shard path for unfiltered pagination within top-50 window
  if (!needsCustomFilter && offset + limit <= topItems.length) {
    const slice = enrichContextualSlice(topItems.slice(offset, offset + limit), resolver, { scope, minSameClause, minColloc });
    const nextOffset = offset + slice.length;
    const hasMore = nextOffset < totalUnfiltered;
    return {
      available: true,
      status: totalUnfiltered > 0 ? 'ok' : 'no_evidence_in_covered_scope',
      dataset_version: ctxLayer.release_version,
      sharding: { hash_algorithm: ctxLayer.hash_algorithm, buckets: ctxLayer.buckets },
      counts: {
        total_neighbors: totalUnfiltered,
        filtered_total: totalUnfiltered,
        returned: slice.length,
        lossless: true,
      },
      items: slice,
      page: {
        limit,
        offset,
        returned: slice.length,
        total_available: totalUnfiltered,
        has_more: hasMore,
        next_offset: hasMore ? nextOffset : null,
      },
      guardrails: {
        proximity_only: true,
        implies_synonymy: false,
        implies_grammar: false,
        implies_causality: false,
        distinct_verse_units: true,
        clause_scope_note: 'Counts track distinct canonical verses (same_verse >= same_clause >= strict collocation_distance_le_3); occurrence_counts tracked separately.',
      },
    };
  }

  // Unfiltered deep pagination: load ONLY overflow page shards overlapping [offset, offset + limit)
  if (!needsCustomFilter) {
    const collected = [];
    if (offset < topItems.length) {
      collected.push(...topItems.slice(offset, offset + limit));
    }
    const targetEnd = offset + limit;
    const targetPages = overflowPages.filter(p => {
      const pEnd = p.offset_start + p.count;
      return pEnd > offset && p.offset_start < targetEnd;
    });
    const loadedPages = await Promise.all(
      targetPages.map(p => ctx.loadJsonShard(ctx.env, `${ctxLayer.base_dir}/${String(p.path || '').replace(/^contextual\//, '')}`))
    );
    for (let i = 0; i < targetPages.length; i++) {
      const pMeta = targetPages[i];
      const pData = loadedPages[i];
      const seg = (pData?.entries?.[lemmaKey] || []).find(s => s.offset_start === pMeta.offset_start);
      if (!seg?.items) continue;
      for (let idx = 0; idx < seg.items.length; idx++) {
        const absIdx = pMeta.offset_start + idx;
        if (absIdx >= offset && absIdx < targetEnd) {
          collected.push(seg.items[idx]);
        }
      }
    }
    const enrichedCollected = enrichContextualSlice(collected, resolver, { scope, minSameClause, minColloc });
    const nextOffset = offset + enrichedCollected.length;
    const hasMore = nextOffset < totalUnfiltered;
    return {
      available: true,
      status: totalUnfiltered > 0 ? 'ok' : 'no_evidence_in_covered_scope',
      dataset_version: ctxLayer.release_version,
      sharding: { hash_algorithm: ctxLayer.hash_algorithm, buckets: ctxLayer.buckets },
      counts: {
        total_neighbors: totalUnfiltered,
        filtered_total: totalUnfiltered,
        returned: enrichedCollected.length,
        lossless: true,
      },
      items: enrichedCollected,
      page: {
        limit,
        offset,
        returned: enrichedCollected.length,
        total_available: totalUnfiltered,
        has_more: hasMore,
        next_offset: hasMore ? nextOffset : null,
      },
      guardrails: {
        proximity_only: true,
        implies_synonymy: false,
        implies_grammar: false,
        implies_causality: false,
        distinct_verse_units: true,
        clause_scope_note: 'Counts track distinct canonical verses (same_verse >= same_clause >= strict collocation_distance_le_3); occurrence_counts tracked separately.',
      },
    };
  }

  // Filtered query across lossless index (skipping overflow pages whose bounds cannot satisfy thresholds)
  const matching = topItems.filter(matchesItem);
  const eligiblePages = overflowPages.filter(p =>
    (p.max_same_verse ?? 999999) >= minSameVerse &&
    (p.max_same_clause ?? 999999) >= minSameClause &&
    (p.max_collocation ?? 999999) >= minColloc
  );
  const loadedPages = await Promise.all(
    eligiblePages.map(p => ctx.loadJsonShard(ctx.env, `${ctxLayer.base_dir}/${String(p.path || '').replace(/^contextual\//, '')}`))
  );
  for (let i = 0; i < eligiblePages.length; i++) {
    const pMeta = eligiblePages[i];
    const pData = loadedPages[i];
    const seg = (pData?.entries?.[lemmaKey] || []).find(s => s.offset_start === pMeta.offset_start);
    if (!seg?.items) continue;
    for (const item of seg.items) {
      if (matchesItem(item)) matching.push(item);
    }
  }
  const slice = enrichContextualSlice(matching.slice(offset, offset + limit), resolver, { scope, minSameClause, minColloc });
  const nextOffset = offset + slice.length;
  const hasMore = nextOffset < matching.length;
  return {
    available: true,
    status: matching.length > 0 ? 'ok' : 'no_evidence_in_covered_scope',
    dataset_version: ctxLayer.release_version,
    sharding: { hash_algorithm: ctxLayer.hash_algorithm, buckets: ctxLayer.buckets },
    counts: {
      total_neighbors: totalUnfiltered,
      filtered_total: matching.length,
      returned: slice.length,
      lossless: true,
    },
    items: slice,
    page: {
      limit,
      offset,
      returned: slice.length,
      total_available: matching.length,
      has_more: hasMore,
      next_offset: hasMore ? nextOffset : null,
    },
    guardrails: {
      proximity_only: true,
      implies_synonymy: false,
      implies_grammar: false,
      implies_causality: false,
      distinct_verse_units: true,
      clause_scope_note: 'Counts track distinct canonical verses (same_verse >= same_clause >= strict collocation_distance_le_3); occurrence_counts tracked separately.',
    },
  };
}

async function fetchLxxLayerData(ctx, manifest, lemmaKey, params = {}, resolver = null) {
  const lxxLayer = manifest?.layers?.lxx_translation;
  if (!lxxLayer) {
    return { available: false, status: 'unavailable', items: [], counts: { candidate_count: 0, total_attested_renderings: 0 }, page: { limit: 25, offset: 0, returned: 0, total_available: 0, has_more: false, next_offset: null } };
  }
  const isGreek = String(lemmaKey).startsWith('lemma:G');
  const direction = isGreek ? 'greek_to_hebrew' : 'hebrew_to_greek';
  const formatKey = isGreek ? 'by_greek_lemma' : 'by_hebrew_lemma';
  const fast = lxxLayer.worker_shards;
  const shardPath = fast
    ? `${fast.base_dir}/${(isGreek ? fast.greek_path : fast.hebrew_path).replace('{hex2}', computeLayerBucketHex(fast, lemmaKey))}`
    : buildLayerAssetPath(lxxLayer, formatKey, lemmaKey);
  const shard = await ctx.loadJsonShard(ctx.env, shardPath);
  const entry = shard?.entries?.[lemmaKey] || null;
  const limit = clampLimit(params.lxx_limit ?? params.limit, 25);
  const offset = Math.max(0, Number(params.lxx_offset ?? params.offset) || 0);

  if (!entry || !Array.isArray(entry.candidates) || entry.candidates.length === 0) {
    return {
      available: true,
      status: 'no_evidence_in_covered_scope',
      dataset_version: lxxLayer.release_version,
      direction,
      sharding: { hash_algorithm: lxxLayer.hash_algorithm, buckets: lxxLayer.buckets },
      counts: { candidate_count: 0, total_attested_renderings: 0, returned: 0 },
      items: [],
      page: { limit, offset, returned: 0, total_available: 0, has_more: false, next_offset: null },
      provenance: { dataset: 'bcv-commons/hebrew-lexical-references', license: 'CC BY 4.0' },
      guardrails: {
        translation_candidate_only: true,
        not_synonymy: true,
        not_token_alignment: true,
        not_nt_usage_claim: true,
      },
    };
  }

  const allCands = entry.candidates;
  const rawSlice = allCands.slice(offset, offset + limit);
  const slice = rawSlice.map(item => ({
    ...item,
    ...(item.greek_candidates ? { greek_candidates: enrichLxxCandidates(item.greek_candidates, resolver, 'grc') } : {}),
    ...(item.hebrew_candidates ? { hebrew_candidates: enrichLxxCandidates(item.hebrew_candidates, resolver, 'hbo') } : {}),
  }));
  const nextOffset = offset + slice.length;
  const hasMore = nextOffset < allCands.length;
  return {
    available: true,
    status: 'ok',
    dataset_version: lxxLayer.release_version,
    direction,
    sharding: { hash_algorithm: lxxLayer.hash_algorithm, buckets: lxxLayer.buckets },
    counts: {
      candidate_count: entry.candidate_count,
      total_attested_renderings: entry.total_attested_renderings,
      returned: slice.length,
    },
    items: slice,
    page: {
      limit,
      offset,
      returned: slice.length,
      total_available: allCands.length,
      has_more: hasMore,
      next_offset: hasMore ? nextOffset : null,
    },
    provenance: {
      dataset: 'bcv-commons/hebrew-lexical-references (pinned BCV R4)',
      license: 'CC BY 4.0',
      note: 'Published Septuagint translation frequency (count >= 3); not corpus token alignment or semantic synonymy.',
    },
    guardrails: {
      translation_candidate_only: true,
      not_synonymy: true,
      not_token_alignment: true,
      not_nt_usage_claim: true,
    },
  };
}

async function loadCompatibleResolver(ctx, baseDir, gramBaseDir, manifest, params) {
  const resolverBase = manifest.layers?.resolver?.base_dir || `${baseDir}/resolver`;
  const resolverRel = resolverBase.split('/')[3] || baseDir.split('/').pop();
  const hasWordIdParam = params.word_id != null || params.p_word_id != null;
  if (!manifest.layers?.resolver) {
    return ctx.loadJsonShard(ctx.env, `${gramBaseDir}/resolver-index.json.gz`);
  }
  const meta = await ctx.loadJsonShard(ctx.env, `${resolverBase}/legacy-meta.json.gz`) ||
    await ctx.loadJsonShard(ctx.env, `${baseDir}/resolver/legacy-meta.json.gz`);
  if (!meta) return ctx.loadJsonShard(ctx.env, `${gramBaseDir}/resolver-index.json.gz`);
  const resolver = { ...meta, lemmas: {}, by_strongs_base: {}, by_strongs_extended: {}, by_surface_form: {}, by_transliteration: {}, by_word_id: {} };
  const loader = createWorkerAdjacencyLoader(ctx, resolverRel);
  const merge = shard => {
    if (!shard) return;
    Object.assign(resolver.lemmas, shard.lemmas || {});
    const unwrap = item => {
      if (item.entry) { resolver.lemmas[item.entry.lemma_id] = item.entry; return item.entry.lemma_id; }
      if (item.lemma_id) { resolver.lemmas[item.lemma_id] = item; return item.lemma_id; }
      if (item.key && item.tuple) {
        resolver.lemmas[item.key] = buildUncoveredProfile(item.key, item.tuple, {});
        return item.key;
      }
      return item.key;
    };
    for (const [k, v] of Object.entries(shard.by_strongs_base || {})) resolver.by_strongs_base[k] = v.map(unwrap).filter(Boolean);
    for (const [k, v] of Object.entries(shard.by_strongs_extended || {})) resolver.by_strongs_extended[k.toUpperCase()] = unwrap(v);
    for (const field of ['by_surface_form', 'by_transliteration']) {
      for (const [k, v] of Object.entries(shard[field] || {})) resolver[field][k] = v.map(unwrap).filter(Boolean);
    }
  };
  resolver.loadProfile = async key => merge(await loader.getResolverBucket(key));
  resolver.loadWordId = async wid => {
    const k = String(wid);
    if (resolver.by_word_id[k]) return resolver.by_word_id[k];
    const bHex = Number(BigInt('0x' + fnv1a64Hex(k)) % 64n).toString(16).padStart(2, '0');
    const widShard = await ctx.loadJsonShard(ctx.env, `${gramBaseDir}/word-id-index/shard-${bHex}.json.gz`);
    if (widShard?.entries) {
      Object.assign(resolver.by_word_id, widShard.entries);
      return resolver.by_word_id[k] || [];
    }
    const full = await ctx.loadJsonShard(ctx.env, `${gramBaseDir}/resolver-index.json.gz`);
    if (full?.by_word_id) {
      resolver.by_word_id = full.by_word_id;
    }
    return resolver.by_word_id[k] || [];
  };
  if (hasWordIdParam) {
    await resolver.loadWordId(Number(params.word_id ?? params.p_word_id));
  }
  const query = String(params.query || params.lemma_id || params.p_lemma_key || params.extended_strongs || '').trim();
  if (query) {
    const keys = new Set([query]);
    const parsed = parseStrongsInputV2(query);
    if (parsed.isStrongs) {
      keys.add(parsed.baseCompact);
      for (const key of parsed.exactLemmaCandidates) keys.add(key);
    } else {
      keys.add(query.normalize('NFD').replace(/[\u0300-\u036f\u0591-\u05C7]/g, '').normalize('NFC'));
      keys.add(query.toLowerCase().replace(/[^a-z0-9]/g, ''));
    }
    for (const key of keys) await resolver.loadProfile(key);
    for (const profile of Object.values(resolver.lemmas)) {
      if (profile.canonical_lemma_id && !resolver.lemmas[profile.canonical_lemma_id]) await resolver.loadProfile(profile.canonical_lemma_id);
    }
  }
  return resolver;
}

export async function handleQueryRelationshipsV2(ctx, params = {}) {
  const active = await ctx.loadJsonShard(ctx.env, '/v2/relationships/active.json.gz');
  const selected = await resolveR9cReleaseVersion(ctx, params);
  if (selected.error) return { schema_version: '2.0', status: 'invalid_request', error_message: selected.error };
  const releaseVersion = selected.releaseVersion;
  const baseDir = `/v2/relationships/${releaseVersion}`;
  const manifest = await ctx.loadJsonShard(ctx.env, `${baseDir}/runtime-manifest.json.gz`) ||
    await ctx.loadJsonShard(ctx.env, `${baseDir}/manifest.json.gz`);
  if (!manifest) {
    if (['r9b-v1.1', 'r9b-v1.0', 'r8-v1.2', 'r11-v1.0'].includes(releaseVersion) && !params.release && !params.release_version) {
      return await handleQueryRelationshipsV2V3Fallback(ctx, params);
    }
    return {
      schema_version: '2.0',
      status: 'release_not_found',
      release_version: releaseVersion,
      error_message: `Unknown relationship graph release: ${releaseVersion}`,
    };
  }
  const gramBaseDir = manifest.layers?.grammatical?.base_dir || baseDir;

  let rawOp = String(params.op || '').trim().toLowerCase();
  if (params.relation_id || (typeof params.query === 'string' && params.query.startsWith('rel:'))) {
    rawOp = 'evidence';
  } else if (!rawOp) {
    if (params.summary_id || params.relation_ids) rawOp = 'evidence';
    else if (params.query || params.lemma_id || params.p_lemma_key || params.token_id || params.word_id || params.p_word_id || params.position != null || params.word_position != null) rawOp = 'lemma_relationships';
    else if (params.book != null && params.chapter != null && params.verse != null) rawOp = 'passage_frames';
    else rawOp = 'coverage';
  }

  const baseEnvelope = {
    schema_version: manifest.layers ? '3.0' : '2.0',
    release_version: releaseVersion,
    rule_version: manifest.rule_version,
    source_git_commit: manifest.source_git_commit || manifest.source_commits?.r8d_grammatical || null,
    epistemic_layer: 'static_source_evidence',
  };

  if (rawOp === 'coverage') {
    const [cov, qual, resolver] = await Promise.all([
      ctx.loadJsonShard(ctx.env, `${gramBaseDir}/coverage-report.json.gz`),
      ctx.loadJsonShard(ctx.env, `${gramBaseDir}/quality-report.json.gz`),
      loadCompatibleResolver(ctx, baseDir, gramBaseDir, manifest, params),
    ]);
    let passageCoverage = null;
    if (params.book != null && params.chapter != null && params.verse != null) {
      const book = Number(params.book);
      const chapter = Number(params.chapter);
      const verse = Number(params.verse);
      const ed = String(params.edition_key || params.edition || defaultEditionForBook(book));
      const ref = canonicalRefV2(book, chapter, verse);
      const pShard = await loadPassagesShardForRef(ctx, gramBaseDir, manifest, book, chapter);
      const covResult = classifyPassageCoverage(resolver, book, chapter, verse, ed, pShard);
      passageCoverage = {
        reference: ref,
        edition: ed,
        covered: covResult.classification === 'covered_with_evidence' || covResult.classification === 'covered_no_supported_relation',
        status: covResult.status,
        classification: covResult.classification,
        reason: covResult.reason,
      };
    }
    return {
      ...baseEnvelope,
      status: 'ok',
      active_pointer: active,
      manifest_counts: manifest.counts,
      source_releases: manifest.source_releases || manifest.dataset_versions,
      upstream_bibleontology_commit: manifest.upstream_bibleontology_commit || null,
      supported_predicates: manifest.predicates || R3_PREDICATES,
      predicate_meta: manifest.predicate_meta || resolver?.predicate_meta || {},
      covered_passages_by_edition: resolver?.covered_passages_by_edition || {},
      layers: manifest.layers || null,
      licensing: manifest.licensing || null,
      coverage_report: cov,
      quality_report: qual,
      ...(passageCoverage ? { passage_coverage: passageCoverage } : {}),
    };
  }

  const resolver = await loadCompatibleResolver(ctx, baseDir, gramBaseDir, manifest, params);
  if (!resolver) {
    return { ...baseEnvelope, status: 'unavailable', error_message: 'Missing resolver index shard.' };
  }
  const loadUncovered = () => ctx.loadJsonShard(ctx.env, `${gramBaseDir}/uncovered-lemmas.json.gz`);

  // Non-lemma lexical endpoint lookup (root:* or sense:*) for reverse shard discovery
  const directKeyCandidate = String(params.endpoint_key || params.lemma_id || params.p_lemma_key || params.query || '').trim();
  if (
    (rawOp === 'lexical_relations' || rawOp === 'unified_lemma') &&
    (Boolean(params.endpoint_key) || directKeyCandidate.startsWith('root:') || directKeyCandidate.startsWith('sense:')) &&
    manifest.layers?.lexical
  ) {
    const lexLayerData = await fetchLexicalLayerData(ctx, manifest, directKeyCandidate, params, resolver);
    if (rawOp === 'lexical_relations') {
      return {
        ...baseEnvelope,
        status: lexLayerData.status,
        endpoint_key: directKeyCandidate,
        lexical: lexLayerData,
      };
    }
    return {
      ...baseEnvelope,
      status: lexLayerData.status,
      focus: null,
      endpoint_key: directKeyCandidate,
      layers: { grammatical: null, lexical: lexLayerData, contextual: null, lxx_translation: null },
    };
  }

  if (rawOp === 'contextual_neighbors') {
    const res = await resolveLemmaV2(params, resolver, loadUncovered, ctx, gramBaseDir);
    if (res.status !== 'ok' || !res.lemma_id) {
      return {
        ...baseEnvelope,
        status: res.status,
        focus: res.profile,
        homograph_siblings: res.homograph_siblings,
        homograph_candidates: res.homograph_candidates,
        resolved_occurrence: res.resolved_occurrence,
        ...(res.mismatch ? { mismatch: res.mismatch } : {}),
        ...(res.coverage_notice ? { coverage_notice: res.coverage_notice } : {}),
        contextual: null,
      };
    }
    const ctxData = await fetchContextualLayerData(ctx, manifest, res.lemma_id, params, resolver);
    return {
      ...baseEnvelope,
      status: ctxData.status,
      focus: res.profile,
      homograph_siblings: res.homograph_siblings,
      resolved_occurrence: res.resolved_occurrence,
      contextual: ctxData,
    };
  }

  if (rawOp === 'lexical_relations') {
    const res = await resolveLemmaV2(params, resolver, loadUncovered, ctx, gramBaseDir);
    if (res.status !== 'ok' || !res.lemma_id) {
      return {
        ...baseEnvelope,
        status: res.status,
        focus: res.profile,
        homograph_siblings: res.homograph_siblings,
        homograph_candidates: res.homograph_candidates,
        resolved_occurrence: res.resolved_occurrence,
        ...(res.mismatch ? { mismatch: res.mismatch } : {}),
        ...(res.coverage_notice ? { coverage_notice: res.coverage_notice } : {}),
        lexical: null,
      };
    }
    const lexData = await fetchLexicalLayerData(ctx, manifest, res.lemma_id, params, resolver);
    return {
      ...baseEnvelope,
      status: lexData.status,
      focus: res.profile,
      homograph_siblings: res.homograph_siblings,
      resolved_occurrence: res.resolved_occurrence,
      lexical: lexData,
    };
  }

  if (rawOp === 'lxx_translations') {
    const res = await resolveLemmaV2(params, resolver, loadUncovered, ctx, gramBaseDir);
    if (res.status !== 'ok' || !res.lemma_id) {
      return {
        ...baseEnvelope,
        status: res.status,
        focus: res.profile,
        homograph_siblings: res.homograph_siblings,
        homograph_candidates: res.homograph_candidates,
        resolved_occurrence: res.resolved_occurrence,
        ...(res.mismatch ? { mismatch: res.mismatch } : {}),
        ...(res.coverage_notice ? { coverage_notice: res.coverage_notice } : {}),
        lxx_translation: null,
      };
    }
    const lxxData = await fetchLxxLayerData(ctx, manifest, res.lemma_id, params, resolver);
    return {
      ...baseEnvelope,
      status: lxxData.status,
      focus: res.profile,
      homograph_siblings: res.homograph_siblings,
      resolved_occurrence: res.resolved_occurrence,
      lxx_translation: lxxData,
    };
  }

  if (rawOp === 'resolve') {
    const res = await resolveLemmaV2(params, resolver, loadUncovered, ctx, gramBaseDir);
    return {
      ...baseEnvelope,
      status: res.status,
      lemma_id: res.lemma_id,
      profile: res.profile,
      homograph_siblings: res.homograph_siblings,
      homograph_candidates: res.homograph_candidates,
      resolved_occurrence: res.resolved_occurrence,
      ...(res.mismatch ? { mismatch: res.mismatch } : {}),
      coverage_notice: res.coverage_notice || (res.status === 'needs_disambiguation'
        ? 'Base Strong\'s number maps to multiple distinct canonical lemmas (homographs). Specify an exact lemma_id (with suffix) or passage word position.'
        : (res.profile && !res.profile.in_r3_graph
          ? `Canonical lemma resolved, but outside the current verified ${releaseVersion} pilot graph (${manifest.counts?.frames_emitted ?? 0} frames across ${Object.values(manifest.counts?.covered_passages_by_edition || {}).reduce((a, b) => a + b, 0)} passage-editions).`
          : null)),
    };
  }

  if (rawOp === 'passage' || rawOp === 'passage_frames') {
    const book = Number(params.book);
    const chapter = Number(params.chapter);
    const verse = Number(params.verse);
    if (!Number.isInteger(book) || !Number.isInteger(chapter) || !Number.isInteger(verse)) {
      return {
        ...baseEnvelope,
        status: 'invalid_request',
        coverage_classification: 'invalid_reference',
        error_message: 'Valid book (1-66), chapter (>=1), and verse (>=0) are required.',
      };
    }
    const edition = String(params.edition_key || params.edition || defaultEditionForBook(book));
    const ref = canonicalRefV2(book, chapter, verse);
    const passagesShard = await loadPassagesShardForRef(ctx, gramBaseDir, manifest, book, chapter);

    const covResult = classifyPassageCoverage(resolver, book, chapter, verse, edition, passagesShard);

    if (covResult.classification === 'invalid_reference') {
      return {
        ...baseEnvelope,
        status: 'invalid_reference',
        coverage_classification: 'invalid_reference',
        canonical_reference: { book, chapter, verse, ref },
        edition,
        error_message: covResult.reason,
        frames: [],
        relations: [],
      };
    }
    if (covResult.classification === 'not_in_canonical_verse') {
      return {
        ...baseEnvelope,
        status: 'not_in_canonical_verse',
        coverage_classification: 'not_in_canonical_verse',
        canonical_reference: { book, chapter, verse, ref },
        edition,
        error_message: covResult.reason,
        frames: [],
        relations: [],
      };
    }
    if (covResult.classification === 'unsupported_edition') {
      return {
        ...baseEnvelope,
        status: 'unsupported_edition',
        coverage_classification: 'unsupported_edition',
        canonical_reference: { book, chapter, verse, ref },
        edition,
        supported_predicates: manifest.predicates || R3_PREDICATES,
        counts: { frames: 0, relations: 0, candidate_relations: 0 },
        frames: [],
        relations: [],
        note: covResult.reason,
      };
    }

    const entry = passagesShard?.passages?.[`${edition}:${ref}`];
    if (covResult.classification === 'missing_syntax_evidence' || !entry) {
      return {
        ...baseEnvelope,
        status: 'not_covered',
        coverage_classification: 'missing_syntax_evidence',
        source_mode: 'not_covered',
        canonical_reference: { book, chapter, verse, ref },
        edition,
        supported_predicates: manifest.predicates || R3_PREDICATES,
        counts: { frames: 0, relations: 0, candidate_relations: 0 },
        frames: [],
        relations: [],
        note: covResult.reason,
      };
    }

    const allFrames = entry.frames || [];
    const allRelations = entry.relations || [];

    if (covResult.classification === 'covered_no_supported_relation' || allRelations.length === 0) {
      return {
        ...baseEnvelope,
        status: 'no_evidence_in_covered_scope',
        coverage_classification: 'covered_no_supported_relation',
        source_mode: 'covered_zero_relations',
        canonical_reference: { book, chapter, verse, ref },
        edition,
        supported_predicates: manifest.predicates || R3_PREDICATES,
        counts: { frames: allFrames.length, relations: 0, candidate_relations: 0 },
        frames: allFrames,
        relations: [],
        note: covResult.reason,
      };
    }

    const includeCandidates = parseBoolParam(params.include_candidates ?? params.include_uncertain, true);
    const relations = includeCandidates ? allRelations : allRelations.filter(r => r.quality !== 'candidate');
    let frames = allFrames;
    if (!includeCandidates) {
      const supportedFrameIds = new Set(relations.map(r => r.frame_id));
      frames = allFrames
        .filter(f => f.extraction?.quality !== 'candidate' || supportedFrameIds.has(f.frame_id))
        .map(f => {
          const retainedRoleTokens = new Set(relations.filter(r => r.frame_id === f.frame_id).map(r => r.subject?.token_id).filter(Boolean));
          const filteredOutCandidateTokens = new Set(allRelations.filter(r => r.frame_id === f.frame_id && r.quality === 'candidate').map(r => r.subject?.token_id).filter(Boolean));
          return filterFrameRolesV2(f, retainedRoleTokens, filteredOutCandidateTokens);
        });
    }

    return {
      ...baseEnvelope,
      status: 'ok',
      coverage_classification: 'covered_with_evidence',
      source_mode: 'canonical_macula_syntax',
      canonical_reference: { book, chapter, verse, ref },
      edition,
      supported_predicates: manifest.predicates || R3_PREDICATES,
      counts: {
        frames: frames.length,
        relations: relations.length,
        candidate_relations: allRelations.filter(r => r.quality === 'candidate').length,
      },
      frames,
      relations,
      note: covResult.reason,
    };
  }

  if (rawOp === 'evidence') {
    const includeUncertain = parseBoolParam(params.include_uncertain ?? params.include_candidates, false);
    const limit = clampLimit(params.limit, 25);
    const offset = Math.max(0, Number(params.offset) || 0);
    const targetRelId = params.relation_id || (typeof params.query === 'string' && params.query.startsWith('rel:') ? params.query : null);

    let records = [];
    if (params.summary_id && manifest.sharding?.evidence_by_summary) {
      const bCount = BigInt(manifest.sharding?.evidence_by_summary_buckets || 256);
      const bucket = Number(BigInt('0x' + fnv1a64Hex(params.summary_id)) % bCount).toString(16).padStart(2, '0');
      const sumShard = await ctx.loadJsonShard(ctx.env, `${gramBaseDir}/evidence/by-summary/shard-${bucket}.json.gz`);
      records = sumShard?.entries?.[String(params.summary_id)] || [];
    } else if (targetRelId) {
      const parsedRel = parseRelationId(targetRelId);
      if (!parsedRel.valid) {
        return {
          ...baseEnvelope,
          status: 'invalid_request',
          error_message: `Malformed relation_id format: ${targetRelId}`,
          relation_id: targetRelId,
          relations: [],
          page: { limit, offset, returned: 0, total_available: 0, has_more: false, next_offset: null },
        };
      }
      if (manifest.sharding?.evidence_by_book) {
        const bShard = await ctx.loadJsonShard(ctx.env, `${gramBaseDir}/evidence/b${parsedRel.book}.json.gz`);
        const r = bShard?.by_relation_id?.[targetRelId];
        if (r) records = [r];
      } else {
        const evShard = await ctx.loadJsonShard(ctx.env, `${gramBaseDir}/evidence-by-id.json.gz`);
        const r = evShard?.by_relation_id?.[targetRelId];
        if (r) records = [r];
      }
    } else {
      const evShard = await ctx.loadJsonShard(ctx.env, `${gramBaseDir}/evidence-by-id.json.gz`);
      if (!evShard) return { ...baseEnvelope, status: 'unavailable', error_message: 'Missing evidence shard.' };
      let relIds = [];
      if (params.summary_id) {
        relIds = evShard.by_summary_id?.[String(params.summary_id)] || [];
      } else if (params.relation_id) {
        relIds = [String(params.relation_id)];
      } else if (Array.isArray(params.relation_ids)) {
        relIds = params.relation_ids.map(String);
      }
      records = relIds.map(id => evShard.by_relation_id?.[id]).filter(Boolean);
    }

    if (!includeUncertain) {
      records = records.filter(r => r.quality !== 'candidate');
    }
    const pageSlice = records.slice(offset, offset + limit);
    const isSingleRelLookup = Boolean(targetRelId);
    const status = records.length > 0 ? 'ok' : (isSingleRelLookup ? 'not_found' : 'no_evidence_in_covered_scope');
    return {
      ...baseEnvelope,
      status,
      summary_id: params.summary_id || null,
      relation_id: targetRelId,
      counts: {
        total_records: records.length,
        returned: pageSlice.length,
      },
      relations: pageSlice,
      page: {
        limit,
        offset,
        returned: pageSlice.length,
        total_available: records.length,
        has_more: offset + pageSlice.length < records.length,
        next_offset: offset + pageSlice.length < records.length ? offset + pageSlice.length : null,
      },
    };
  }

  // Default: lemma_relationships / neighbors
  const limit = clampLimit(params.limit, 25);
  const offset = Math.max(0, Number(params.offset) || 0);
  const includeUncertain = parseBoolParam(params.include_uncertain ?? params.include_candidates, false);
  const direction = ['outgoing', 'incoming', 'both'].includes(String(params.direction || '').toLowerCase())
    ? String(params.direction).toLowerCase()
    : 'both';
  const editionFilter = params.edition && params.edition !== 'all' && params.edition !== 'auto'
    ? String(params.edition)
    : (params.edition_key && params.edition_key !== 'all' && params.edition_key !== 'auto' ? String(params.edition_key) : null);
  const predicateList = [
    ...parseListParam(params.predicates),
    ...parseListParam(params.relation_types),
  ].filter(p => R3_PREDICATES.includes(p));
  const predicateSet = predicateList.length > 0 ? new Set(predicateList) : null;

  const filterBook = params.book != null ? Number(params.book) : null;
  const filterChapter = params.chapter != null ? Number(params.chapter) : null;
  const filterVerse = params.verse != null ? Number(params.verse) : null;
  const hasPassageCoords = Number.isInteger(filterBook) && Number.isInteger(filterChapter) && Number.isInteger(filterVerse);
  const hasPosition = params.position != null || params.word_position != null;
  const filterToPassage = hasPassageCoords && parseBoolParam(params.filter_to_passage, !hasPosition);

  const isUnifiedMode =
    rawOp === 'unified_lemma' ||
    parseBoolParam(params.include_all_layers, false) ||
    params.layers != null;
  const requestedLayersList = parseListParam(params.layers);
  const requestedLayers = new Set(
    requestedLayersList.length > 0
      ? requestedLayersList
      : ['grammatical', 'lexical', 'contextual', 'lxx_translation']
  );

  const res = await resolveLemmaV2(params, resolver, loadUncovered, ctx, gramBaseDir);
  if (res.status === 'selector_mismatch') {
    return {
      ...baseEnvelope,
      status: 'selector_mismatch',
      focus: null,
      homograph_siblings: [],
      homograph_candidates: [],
      resolved_occurrence: null,
      mismatch: res.mismatch,
      category_groups: [],
      summaries: [],
      relations: [],
      page: { limit, offset, returned: 0, total_available: 0, has_more: false, next_offset: null },
      ...(isUnifiedMode ? { layers: { grammatical: null, lexical: null, contextual: null, lxx_translation: null } } : {}),
      coverage_notice: res.coverage_notice || 'Supplied selectors contradict one another.',
    };
  }
  if (res.status === 'needs_disambiguation') {
    return {
      ...baseEnvelope,
      status: 'needs_disambiguation',
      focus: null,
      homograph_siblings: res.homograph_siblings,
      homograph_candidates: res.homograph_candidates,
      resolved_occurrence: res.resolved_occurrence,
      category_groups: [],
      summaries: [],
      relations: [],
      page: { limit, offset, returned: 0, total_available: 0, has_more: false, next_offset: null },
      ...(isUnifiedMode ? { layers: { grammatical: null, lexical: null, contextual: null, lxx_translation: null } } : {}),
      coverage_notice: 'Multiple distinct Hebrew/Greek canonical lemmas share this base Strong\'s number. Select an exact lemma_id (with suffix) or click a specific word occurrence.',
    };
  }
  if (res.status === 'not_found' || !res.lemma_id) {
    return {
      ...baseEnvelope,
      status: 'not_found',
      focus: null,
      homograph_siblings: [],
      homograph_candidates: [],
      resolved_occurrence: res.resolved_occurrence,
      category_groups: [],
      summaries: [],
      relations: [],
      page: { limit, offset, returned: 0, total_available: 0, has_more: false, next_offset: null },
      ...(isUnifiedMode ? { layers: { grammatical: null, lexical: null, contextual: null, lxx_translation: null } } : {}),
      coverage_notice: 'Could not resolve query to a canonical lemma in the index.',
    };
  }

  let passageCoverageInfo = null;
  if (filterToPassage && hasPassageCoords) {
    const pRef = canonicalRefV2(filterBook, filterChapter, filterVerse);
    const pEd = editionFilter || defaultEditionForBook(filterBook);
    const pShard = await loadPassagesShardForRef(ctx, gramBaseDir, manifest, filterBook, filterChapter);
    const covResult = classifyPassageCoverage(resolver, filterBook, filterChapter, filterVerse, pEd, pShard);
    const isCovered = covResult.classification === 'covered_with_evidence' || covResult.classification === 'covered_no_supported_relation';
    passageCoverageInfo = {
      reference: pRef,
      edition: pEd,
      covered: isCovered,
      status: covResult.status,
      classification: covResult.classification,
      reason: covResult.reason,
    };
    if (!isCovered) {
      return {
        ...baseEnvelope,
        status: covResult.status,
        coverage_classification: covResult.classification,
        focus: res.profile,
        homograph_siblings: res.homograph_siblings,
        resolved_occurrence: res.resolved_occurrence,
        passage_scope: passageCoverageInfo,
        category_groups: [],
        summaries: [],
        relations: [],
        page: { limit, offset, returned: 0, total_available: 0, has_more: false, next_offset: null },
        ...(isUnifiedMode ? { layers: { grammatical: null, lexical: null, contextual: null, lxx_translation: null } } : {}),
        coverage_notice: covResult.reason,
      };
    }
  }

  const loadGrammaticalLayer = async () => {
    let lemmaEntry = null;
    let evShard = null;
    const fast = manifest.layers?.grammatical?.worker_shards;
    if (fast && !filterToPassage) {
      const bucket = computeLayerBucketHex(fast, res.lemma_id);
      const shard = await ctx.loadJsonShard(ctx.env, `${fast.base_dir}/${fast.path.replace('{hex3}', bucket).replace('{hex2}', bucket)}`);
      lemmaEntry = shard?.entries?.[res.lemma_id];
      if (lemmaEntry) {
        lemmaEntry = { ...lemmaEntry };
        for (const field of ['outgoing_summaries', 'incoming_summaries']) {
          lemmaEntry[field] = (lemmaEntry[field] || []).map(summary => ({ ...summary,
            sample_passages: summary.sample_passages || [...new Set((summary.sample_relations || []).map(r => r.canonical_ref))].map(reference => {
              const match = /^([A-Z0-9]+) (\d+):(\d+)$/.exec(reference || '');
              return { reference, coords: match ? { usfm: match[1], book: BOOK_NUM_BY_USFM_V2[match[1]], chapter: Number(match[2]), verse: Number(match[3]) } : null };
            }),
            sample_qualities: summary.sample_qualities || [],
            evidence_ids: summary.evidence_ids || (summary.sample_relations || []).map(r => r.relation_id),
            related_lemma: { ...summary.related_lemma,
              lemma_id: summary.related_lemma_id,
              extended_strongs: summary.related_lemma_id?.replace(/^lemma:/, ''),
              language: summary.related_lemma_id?.startsWith('lemma:G') ? 'greek' : 'hebrew',
            },
          }));
        }
      }
    } else if (manifest.sharding?.by_lemma_sharded) {
      const gramBucket = manifest.layers?.grammatical
        ? computeLayerBucketHex(manifest.layers.grammatical, res.lemma_id)
        : Number(BigInt('0x' + fnv1a64Hex(res.lemma_id)) % BigInt(manifest.sharding?.by_lemma_buckets || 256))
            .toString(16)
            .padStart(2, '0');
      const lemmaShard = await ctx.loadJsonShard(ctx.env, `${gramBaseDir}/by-lemma/shard-${gramBucket}.json.gz`);
      lemmaEntry = lemmaShardEntry(lemmaShard, res.lemma_id);
      if (lemmaShard?.schema_version === 'packed-1' && lemmaEntry) {
        const [file, start, length] = lemmaEntry;
        lemmaEntry = await ctx.loadJsonShard(ctx.env, `${gramBaseDir}/${file}#bytes=${start}-${start + length - 1}`);
      }
    } else {
      const [bShard, eShard] = await Promise.all([
        ctx.loadJsonShard(ctx.env, `${gramBaseDir}/by-lemma.json.gz`),
        ctx.loadJsonShard(ctx.env, `${gramBaseDir}/evidence-by-id.json.gz`),
      ]);
      lemmaEntry = bShard?.entries?.[res.lemma_id];
      evShard = eShard;
    }

    if (!lemmaEntry) {
      let pCovered = false;
      if (hasPassageCoords) {
        if (passageCoverageInfo) {
          pCovered = passageCoverageInfo.covered;
        } else {
          const pEd = editionFilter || defaultEditionForBook(filterBook);
          const pShard = await loadPassagesShardForRef(ctx, gramBaseDir, manifest, filterBook, filterChapter);
          const covResult = classifyPassageCoverage(resolver, filterBook, filterChapter, filterVerse, pEd, pShard);
          pCovered = covResult.classification === 'covered_with_evidence' || covResult.classification === 'covered_no_supported_relation';
        }
      }
      return {
        status: pCovered ? 'no_evidence_in_covered_scope' : 'not_covered',
        category_groups: [],
        summaries: [],
        relations: [],
        counts: { summaries_total: 0, summaries_unfiltered: 0, relations_total: 0, groups_total: 0 },
        page: { limit, offset, returned: 0, total_available: 0, has_more: false, next_offset: null },
        coverage_notice: pCovered
          ? `Passage is in ${releaseVersion} scope, and ${res.lemma_id} has no extracted R3 grammatical relations under the current rules.`
          : `${res.lemma_id} (${res.profile?.lemma_form || ''}) is not yet covered in the current verified grammatical graph (${manifest.counts.distinct_lemmas_in_graph} lemmas across ${manifest.counts.frames_emitted} frames). Absence here reflects coverage limits, not absence in Scripture.`,
      };
    }

    const rawPool = [];
    if (direction !== 'incoming') rawPool.push(...(lemmaEntry.outgoing_summaries || []));
    if (direction !== 'outgoing') rawPool.push(...(lemmaEntry.incoming_summaries || []));

    const summaryMatchesFilter = s => {
      if (editionFilter && s.source_edition !== editionFilter) return false;
      if (predicateSet && !predicateSet.has(s.predicate)) return false;
      if (!includeUncertain && s.quality_tier !== 'high_quality') return false;
      return true;
    };

    let filteredSummaries = rawPool.filter(summaryMatchesFilter);

    const pFilterRef = filterToPassage && hasPassageCoords ? canonicalRefV2(filterBook, filterChapter, filterVerse) : null;
    const matchingRelations = [];
    const summaryIdsWithPassageMatch = new Set();

    if (pFilterRef && (manifest.sharding?.passages_by_chapter || manifest.sharding?.passages_by_book)) {
      const pShard = manifest.sharding?.passages_by_chapter
        ? await ctx.loadJsonShard(ctx.env, `${gramBaseDir}/passages/b${filterBook}-c${filterChapter}.json.gz`)
        : await ctx.loadJsonShard(ctx.env, `${gramBaseDir}/passages/b${filterBook}.json.gz`);
      const pEd = editionFilter || defaultEditionForBook(filterBook);
      const pEntry = pShard?.passages?.[`${pEd}:${pFilterRef}`];
      for (const rel of pEntry?.relations || []) {
        if (!includeUncertain && rel.quality === 'candidate') continue;
        const isSubj = rel.subject?.lemma_id === res.lemma_id;
        const isObj = rel.object?.lemma_id === res.lemma_id;
        if (!isSubj && !isObj) continue;
        if (predicateSet && !predicateSet.has(rel.predicate)) continue;
        if (direction === 'outgoing' && !isSubj) continue;
        if (direction === 'incoming' && !isObj) continue;
        matchingRelations.push({
          ...rel,
          direction: isSubj ? 'outgoing' : 'incoming',
          display_predicate: isSubj ? rel.predicate : (rel.inverse_predicate || PREDICATE_META[rel.predicate]?.inverse_predicate),
          display_label: isSubj ? (PREDICATE_META[rel.predicate]?.forward_label || rel.predicate) : (PREDICATE_META[rel.predicate]?.inverse_label || rel.inverse_predicate),
        });
        if (rel.summary_id) summaryIdsWithPassageMatch.add(rel.summary_id);
      }
    } else if (!manifest.sharding) {
      for (const s of filteredSummaries) {
        const evIds = s.evidence_ids || evShard?.by_summary_id?.[s.summary_id] || [];
        for (const eid of evIds) {
          const ev = evShard?.by_relation_id?.[eid];
          if (!ev) continue;
          if (!includeUncertain && ev.quality === 'candidate') continue;
          if (pFilterRef && ev.canonical_ref !== pFilterRef) continue;
          summaryIdsWithPassageMatch.add(s.summary_id);
          matchingRelations.push({
            ...ev,
            direction: s.direction,
            display_predicate: s.display_predicate,
            display_label: s.display_label,
          });
        }
      }
    } else {
      for (const s of filteredSummaries) {
        for (const ev of s.sample_relations || []) {
          if (!includeUncertain && ev.quality === 'candidate') continue;
          matchingRelations.push({
            ...ev,
            direction: s.direction,
            display_predicate: s.display_predicate,
            display_label: s.display_label,
          });
          if (matchingRelations.length >= 50) break;
        }
        if (matchingRelations.length >= 50) break;
      }
    }

    if (pFilterRef) {
      filteredSummaries = filteredSummaries.filter(s => summaryIdsWithPassageMatch.has(s.summary_id));
    }

    const scopeKey = `v2:${releaseVersion}:${res.lemma_id}:${direction}:${editionFilter || 'all'}:${includeUncertain ? '1' : '0'}:${pFilterRef || '*'}:${predicateList.join(',')}`;
    const cursorRes = params.cursor ? decodeCursor(params.cursor, scopeKey) : { ok: true, offset };
    const pageOffset = cursorRes.ok ? cursorRes.offset : offset;
    const pagedSummaries = filteredSummaries.slice(pageOffset, pageOffset + limit);
    const nextOffset = pageOffset + pagedSummaries.length;
    const hasMore = nextOffset < filteredSummaries.length;
    const pagedIdSet = new Set(pagedSummaries.map(s => s.summary_id));

    const groupMap = new Map();
    for (const s of filteredSummaries) {
      const gKey = `${s.direction}:${s.display_predicate}`;
      if (!groupMap.has(gKey)) {
        groupMap.set(gKey, {
          group_key: gKey,
          direction: s.direction,
          predicate: s.predicate,
          display_predicate: s.display_predicate,
          display_label: s.display_label,
          guardrail: s.guardrail,
          summary_count: 0,
          total_occurrences: 0,
          total_candidate_occurrences: 0,
          total_passages: 0,
          items: [],
        });
      }
      const grp = groupMap.get(gKey);
      grp.summary_count += 1;
      grp.total_occurrences += Number(s.stats?.occurrences || 0);
      grp.total_candidate_occurrences += Number(s.stats?.candidate || 0);
      grp.total_passages += Number(s.stats?.distinct_passages || 0);
      if (pagedIdSet.has(s.summary_id)) {
        grp.items.push(s);
      }
    }
    for (const grp of groupMap.values()) {
      grp.items.sort((a, b) => (b.stats?.occurrences || 0) - (a.stats?.occurrences || 0) || String(a.related_lemma_id).localeCompare(String(b.related_lemma_id)));
    }
    const categoryGroups = [...groupMap.values()];
    const gStatus = filteredSummaries.length > 0 ? 'ok' : 'no_evidence_in_covered_scope';

    return {
      status: gStatus,
      counts: {
        summaries_total: filteredSummaries.length,
        summaries_unfiltered: rawPool.length,
        relations_total: matchingRelations.length,
        groups_total: categoryGroups.length,
      },
      category_groups: categoryGroups,
      summaries: pagedSummaries,
      relations: matchingRelations.slice(0, Math.min(Math.max(limit, 25), 50)),
      page: {
        limit,
        offset: pageOffset,
        returned: pagedSummaries.length,
        total_available: filteredSummaries.length,
        has_more: hasMore,
        next_offset: hasMore ? nextOffset : null,
        next_cursor: hasMore ? encodeCursor(nextOffset, scopeKey) : null,
      },
      coverage_notice: gStatus === 'no_evidence_in_covered_scope'
        ? `Lemma ${res.lemma_id} has ${rawPool.length} summary records in ${releaseVersion}, but 0 match the current filters (${editionFilter || 'all editions'}, include_uncertain=${includeUncertain}${pFilterRef ? `, passage=${pFilterRef}` : ''}).`
        : null,
    };
  };

  if (!isUnifiedMode) {
    const gram = await loadGrammaticalLayer();
    return {
      ...baseEnvelope,
      status: gram.status,
      focus: res.profile,
      homograph_siblings: res.homograph_siblings,
      resolved_occurrence: res.resolved_occurrence,
      passage_scope: passageCoverageInfo,
      filters: {
        direction,
        edition: editionFilter || 'all',
        include_uncertain: includeUncertain,
        predicates: predicateList.length > 0 ? predicateList : R3_PREDICATES,
      },
      counts: gram.counts,
      category_groups: gram.category_groups,
      summaries: gram.summaries,
      relations: gram.relations,
      page: gram.page,
      coverage_notice: gram.coverage_notice,
    };
  }

  const [gramLayer, lexLayer, ctxLayer, lxxLayer] = await Promise.all([
    requestedLayers.has('grammatical') ? loadGrammaticalLayer() : Promise.resolve(null),
    requestedLayers.has('lexical') ? fetchLexicalLayerData(ctx, manifest, res.lemma_id, params, resolver) : Promise.resolve(null),
    requestedLayers.has('contextual') ? fetchContextualLayerData(ctx, manifest, res.lemma_id, params, resolver) : Promise.resolve(null),
    requestedLayers.has('lxx_translation') ? fetchLxxLayerData(ctx, manifest, res.lemma_id, params, resolver) : Promise.resolve(null),
  ]);

  const anyOk = [gramLayer, lexLayer, ctxLayer, lxxLayer].some(l => l && l.status === 'ok');
  const firstLayerStatus = [gramLayer, lexLayer, ctxLayer, lxxLayer].find(l => l && l.status)?.status || 'not_covered';
  const gramFallback = gramLayer || {
    status: firstLayerStatus,
    counts: { summaries_total: 0, summaries_unfiltered: 0, relations_total: 0, groups_total: 0 },
    category_groups: [],
    summaries: [],
    relations: [],
    page: { limit, offset, returned: 0, total_available: 0, has_more: false, next_offset: null },
    coverage_notice: null,
  };

  return {
    ...baseEnvelope,
    status: anyOk ? 'ok' : gramFallback.status,
    focus: res.profile,
    homograph_siblings: res.homograph_siblings,
    resolved_occurrence: res.resolved_occurrence,
    passage_scope: passageCoverageInfo,
    filters: {
      direction,
      edition: editionFilter || 'all',
      include_uncertain: includeUncertain,
      predicates: predicateList.length > 0 ? predicateList : R3_PREDICATES,
      layers: [...requestedLayers],
    },
    layer_contracts: manifest.layers || null,
    epistemic_guardrails: {
      distinct_layers_preserved: true,
      shared_root_not_synonymy: true,
      translation_candidate_not_semantic_identity: true,
      contextual_proximity_not_grammar_or_causality: true,
      grammatical_role_not_theological_proof: true,
    },
    counts: gramFallback.counts,
    category_groups: gramFallback.category_groups,
    summaries: gramFallback.summaries,
    relations: gramFallback.relations,
    page: gramFallback.page,
    coverage_notice: gramFallback.coverage_notice,
    layers: {
      grammatical: gramLayer
        ? {
            dataset_version: manifest.layers?.grammatical?.release_version || releaseVersion,
            sharding: manifest.layers?.grammatical
              ? { hash_algorithm: manifest.layers.grammatical.hash_algorithm, buckets: manifest.layers.grammatical.buckets }
              : { hash_algorithm: 'fnv1a64_mod256', buckets: 256 },
            ...gramLayer,
          }
        : null,
      lexical: lexLayer,
      contextual: ctxLayer,
      lxx_translation: lxxLayer,
    },
  };
}

function parseOptionalListParam(v) {
  const arr = parseListParam(v);
  return arr.length > 0 ? arr : undefined;
}

function finiteOr(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function resolveR9cReleaseVersion(ctx, params = {}) {
  const requested = params.release || params.release_version;
  if (requested) {
    const clean = String(requested).trim();
    if (!/^[A-Za-z0-9._-]+$/.test(clean)) {
      return { error: `Invalid release identifier: ${clean}`, releaseVersion: clean };
    }
    return { error: null, releaseVersion: clean };
  }
  const envDefault = ctx.env?.R9C_DEFAULT_RELEASE || ctx.env?.RELATIONSHIPS_RELEASE;
  if (envDefault) {
    return { error: null, releaseVersion: String(envDefault).trim() };
  }
  const r9b11Manifest =
    (await ctx.loadJsonShard(ctx.env, '/v2/relationships/r9b-v1.1/runtime-manifest.json.gz')) ||
    (await ctx.loadJsonShard(ctx.env, '/v2/relationships/r9b-v1.1/manifest.json.gz'));
  if (r9b11Manifest?.layers?.grammatical && r9b11Manifest?.layers?.lexical) {
    return { error: null, releaseVersion: 'r9b-v1.1' };
  }
  const active = await ctx.loadJsonShard(ctx.env, '/v2/relationships/active.json.gz');
  const activeRel = active?.active_release ? String(active.active_release).trim() : null;
  // Discovery releases inherit compatible relationship assets, rather than containing them.
  let candidate = activeRel;
  const visited = new Set();
  while (candidate && !visited.has(candidate)) {
    visited.add(candidate);
    const manifest = await ctx.loadJsonShard(ctx.env, `/v2/relationships/${candidate}/runtime-manifest.json.gz`) ||
      await ctx.loadJsonShard(ctx.env, `/v2/relationships/${candidate}/manifest.json.gz`);
    if (manifest?.layers?.grammatical && manifest?.layers?.lexical) {
      return { error: null, releaseVersion: candidate };
    }
    candidate = manifest?.inherits_release || null;
  }
  const r9bManifest =
    (await ctx.loadJsonShard(ctx.env, '/v2/relationships/r9b-v1.0/runtime-manifest.json.gz')) ||
    (await ctx.loadJsonShard(ctx.env, '/v2/relationships/r9b-v1.0/manifest.json.gz'));
  if (r9bManifest) return { error: null, releaseVersion: 'r9b-v1.0' };
  return { error: null, releaseVersion: activeRel || 'r9b-v1.0' };
}

function createWorkerAdjacencyLoader(ctx, releaseVersion) {
  const manifestGz = `/v2/relationships/${releaseVersion}/manifest.json.gz`;
  const runtimeManifestGz = `/v2/relationships/${releaseVersion}/runtime-manifest.json.gz`;
  const reader = {
    async readJson(assetPath) {
      if (assetPath === manifestGz) {
        if (typeof ctx.loadJsonShardWithBytes === 'function') {
          const rt = await ctx.loadJsonShardWithBytes(ctx.env, runtimeManifestGz);
          if (rt) return rt;
        } else {
          const rt = await ctx.loadJsonShard(ctx.env, runtimeManifestGz);
          if (rt) return { data: rt, bytes: 0 };
        }
      }
      if (typeof ctx.loadJsonShardWithBytes === 'function') {
        return await ctx.loadJsonShardWithBytes(ctx.env, assetPath);
      }
      const data = await ctx.loadJsonShard(ctx.env, assetPath);
      if (!data) return null;
      return { data, bytes: 0 };
    },
  };
  return new ShardedAdjacencyLoader(reader, { releaseVersion, maxCachedShards: 12 });
}

export async function handleResolveResearchConceptV1(ctx, params = {}) {
  const rel = await resolveR9cReleaseVersion(ctx, params);
  if (rel.error) {
    return {
      schema_version: '1.0',
      query: String(params.query || ''),
      status: 'invalid_request',
      requires_explicit_selection: false,
      candidates: [],
      guardrails: {
        english_concept_never_auto_picks_single_lemma: true,
        gloss_similarity_never_creates_graph_edges: true,
        homographs_preserved_distinct: true,
      },
      guidance: rel.error,
    };
  }
  const query = String(params.query || params.q || params.term || '').trim();
  const loader = createWorkerAdjacencyLoader(ctx, rel.releaseVersion);
  const res = await resolveResearchConcept(loader, query, {
    language: params.language ? String(params.language).trim() : undefined,
    limit: finiteOr(params.limit, 25),
    include_uncovered: params.include_uncovered !== false && params.include_uncovered !== 'false',
    budget: {
      asset_requests: 0,
      shards_read: 0,
      bytes_read: 0,
      max_asset_requests: 12,
      max_bytes_read: 8 * 1024 * 1024,
      budget_exceeded: false,
      exceeded_reason: null,
    },
  });
  return { release_version: rel.releaseVersion, ...res };
}

export async function handleDiscoverRelationshipPathsV1(ctx, params = {}) {
  const rel = await resolveR9cReleaseVersion(ctx, params);
  if (rel.error) {
    return {
      schema_version: '1.0',
      release_version: rel.releaseVersion,
      status: 'invalid_request',
      message: rel.error,
      paths: [],
    };
  }
  const loader = createWorkerAdjacencyLoader(ctx, rel.releaseVersion);
  const manifest = await loader.getManifestSummary();
  if (!manifest) {
    return {
      schema_version: '1.0',
      release_version: rel.releaseVersion,
      status: 'incomplete_coverage',
      message: `Relationship graph release unavailable: ${rel.releaseVersion}`,
      paths: [],
      coverage: {
        exhaustive: false,
        search_stopped_by_limits: false,
        limits_reached: [],
        source_coverage_incomplete: true,
        incomplete_reasons: [`Release manifest ${rel.releaseVersion} missing.`],
        missing_shards: [`/v2/relationships/${rel.releaseVersion}/manifest.json.gz`],
        truncated_contextual_entities: [],
        nodes_expanded: 0,
        edges_examined: 0,
        asset_requests: 1,
        shards_read: 0,
        bytes_read: 0,
        execution_ms: 0,
        contextual_pages_loaded: 0,
        total_paths_found: 0,
        paths_returned: 0,
      },
    };
  }

  const targetList = parseOptionalListParam(params.targets);
  const hasExplicitTarget = Boolean((params.target && String(params.target).trim()) || (targetList && targetList.length > 0));
  const rawLimits = params.limits && typeof params.limits === 'object' ? params.limits : {};
  const workerLimits = {
    max_nodes_expanded: Math.min(60, Math.max(1, finiteOr(rawLimits.max_nodes_expanded, hasExplicitTarget ? 35 : 8))),
    max_edges_examined: Math.min(4000, Math.max(1, finiteOr(rawLimits.max_edges_examined, hasExplicitTarget ? 2500 : 800))),
    max_paths_returned: Math.min(50, Math.max(1, finiteOr(rawLimits.max_paths_returned ?? params.limit, 20))),
    max_per_node_edges: Math.min(300, Math.max(1, finiteOr(rawLimits.max_per_node_edges, hasExplicitTarget ? 120 : 60))),
    max_contextual_pages_per_node: Math.min(8, Math.max(0, finiteOr(rawLimits.max_contextual_pages_per_node, 0))),
    max_asset_requests: Math.min(70, Math.max(1, finiteOr(rawLimits.max_asset_requests, 55))),
    max_bytes_read: Math.min(20 * 1024 * 1024, Math.max(1024, finiteOr(rawLimits.max_bytes_read, 16 * 1024 * 1024))),
    max_execution_ms: Math.min(5000, Math.max(25, finiteOr(rawLimits.max_execution_ms, 3500))),
    max_candidate_paths: Math.min(500, Math.max(1, finiteOr(rawLimits.max_candidate_paths, hasExplicitTarget ? 300 : 120))),
    max_summary_hydrations: Math.min(6, Math.max(0, finiteOr(rawLimits.max_summary_hydrations, 0))),
  };

  return await discoverMultiHopPaths(loader, {
    source: String(params.source || params.from || '').trim(),
    target: params.target ? String(params.target).trim() : null,
    targets: targetList,
    max_hops: params.max_hops !== undefined ? finiteOr(params.max_hops, 2) : 2,
    layers: parseOptionalListParam(params.layers),
    predicates: parseOptionalListParam(params.predicates),
    direction: params.direction ? String(params.direction) : 'both',
    min_quality: params.min_quality ? String(params.min_quality) : 'all',
    languages: parseOptionalListParam(params.languages),
    editions: parseOptionalListParam(params.editions),
    contextual_scope: params.contextual_scope ? String(params.contextual_scope) : undefined,
    min_same_verse: params.min_same_verse !== undefined ? finiteOr(params.min_same_verse, undefined) : undefined,
    min_same_clause: params.min_same_clause !== undefined ? finiteOr(params.min_same_clause, undefined) : undefined,
    min_collocation: params.min_collocation !== undefined ? finiteOr(params.min_collocation, undefined) : undefined,
    allow_cycles: params.allow_cycles === true || params.allow_cycles === 'true',
    hub_penalty: params.hub_penalty && typeof params.hub_penalty === 'object' ? params.hub_penalty : undefined,
    limits: workerLimits,
    limit: params.limit !== undefined ? finiteOr(params.limit, 20) : undefined,
    offset: params.offset !== undefined ? finiteOr(params.offset, 0) : undefined,
    cursor: params.cursor ? String(params.cursor) : null,
  });
}

function createWorkerR10Reader(ctx) {
  const reader = {
    async readJson(assetPath) {
      if (ctx.env?.__r12Trace) ctx.env.__r12Trace.phases.r10_reader++;
      if (typeof ctx.loadJsonShardWithBytes === 'function') {
        return await ctx.loadJsonShardWithBytes(ctx.env, assetPath);
      }
      const data = await ctx.loadJsonShard(ctx.env, assetPath);
      return data ? { data, bytes: 0 } : null;
    },
    ...(typeof ctx.decodeB64GzJson === 'function' ? { decodeB64GzJson: ctx.decodeB64GzJson } : {}),
    ...(typeof ctx.readBinary === 'function'
      ? {
          async readBinary(assetPath) {
            return await ctx.readBinary(assetPath);
          },
        }
      : {}),
    async readBytes() {
      return null;
    },
  };
  if (ctx.v3Hooks) reader.__v3Hooks = ctx.v3Hooks;
  return reader;
}

function createV3SessionFromCtx(ctx) {
  return new V3RuntimeSession(createWorkerR10Reader(ctx), ctx.v3Hooks);
}

export async function handleDiscoverBiblicalConnectionsV1(ctx, params = {}) {
  const anchorObj = params.anchor && typeof params.anchor === 'object' ? params.anchor : {};
  const occWordId = params.word_id ?? anchorObj.word_id;
  const occBook = params.book ?? anchorObj.book;
  const occChapter = params.chapter ?? anchorObj.chapter;
  const occVerse = params.verse ?? anchorObj.verse;
  const occPosition = params.position ?? params.word_position ?? anchorObj.position;
  const occEdition = params.edition_key ?? params.edition ?? anchorObj.edition_key;
  const occLemmaId = params.lemma_id ?? anchorObj.lemma_id;
  const occExtendedStrongs = params.extended_strongs ?? anchorObj.extended_strongs;
  const hasOccSelector =
    occWordId != null ||
    occPosition != null ||
    Boolean(occLemmaId) ||
    Boolean(occExtendedStrongs) ||
    Boolean(occEdition);

  let queryText = String(params.query || params.q || params.topic || '').trim();
  const concepts = parseOptionalListParam(params.concepts);
  if (!queryText && (!concepts || concepts.length === 0) && !hasOccSelector) {
    return {
      schema_version: 1,
      status: 'invalid_request',
      error: 'Provide non-empty query, concepts, or occurrence anchor for biblical connection discovery.',
    };
  }

  let selectedOccurrence = null;
  let discoveryScope = null;
  let effectiveFocusLemma = params.focus_lemma ? String(params.focus_lemma).trim() : undefined;

  if (hasOccSelector) {
    const selected = await resolveR9cReleaseVersion(ctx, params);
    if (selected.error) {
      return { schema_version: 1, status: 'invalid_request', error: selected.error };
    }
    const baseDir = `/v2/relationships/${selected.releaseVersion}`;
    const manifest =
      (await ctx.loadJsonShard(ctx.env, `${baseDir}/runtime-manifest.json.gz`)) ||
      (await ctx.loadJsonShard(ctx.env, `${baseDir}/manifest.json.gz`));
    if (manifest) {
      const gramBaseDir = manifest.layers?.grammatical?.base_dir || baseDir;
      const isLexicalSelectorToken =
        /^(?:lemma:)?[HG]0*\d+[A-Za-z]?$/i.test(queryText) ||
        /^[on]\d{8,14}$/.test(queryText) ||
        /[\u0590-\u05ff\u0370-\u03ff]/.test(queryText);
      const resolverParams = {
        word_id: occWordId,
        book: occBook,
        chapter: occChapter,
        verse: occVerse,
        position: occPosition,
        edition_key: occEdition,
        lemma_id: occLemmaId,
        extended_strongs: occExtendedStrongs,
        ...(isLexicalSelectorToken ? { query: queryText } : {}),
      };
      const resolver = await loadCompatibleResolver(ctx, baseDir, gramBaseDir, manifest, resolverParams);
      if (resolver) {
        const res = await resolveLemmaV2(
          resolverParams,
          resolver,
          () => ctx.loadJsonShard(ctx.env, `${gramBaseDir}/uncovered-lemmas.json.gz`),
          ctx,
          gramBaseDir
        );
        if (res.status === 'selector_mismatch') {
          return {
            schema_version: 1,
            status: 'selector_mismatch',
            release_id: params.release_id ? String(params.release_id).trim() : DEFAULT_R10_RELEASE,
            error: res.coverage_notice || 'Supplied occurrence selectors contradict one another.',
            mismatch: res.mismatch,
            selected_occurrence: null,
          };
        }
        const candList = Array.isArray(res.homograph_candidates) ? res.homograph_candidates : [];
        const contentCands = candList.filter(c => !/^lemma:H90\d\d$/i.test(String(c.lemma_id || '')));
        const fallbackCand = contentCands.length === 1 ? contentCands[0] : (contentCands.length > 1 ? contentCands[0] : candList[0]);
        const resolvedLemmaId =
          res.resolved_occurrence?.lemma_id ||
          res.lemma_id ||
          (occLemmaId ? String(occLemmaId) : null) ||
          (contentCands.length === 1 ? contentCands[0].lemma_id : null);
        const occAnchored = Boolean(
          res.resolved_occurrence && res.resolved_occurrence.occurrence_resolution_status === 'verified_occurrence'
        );
        selectedOccurrence = res.resolved_occurrence
          ? {
              word_id: res.resolved_occurrence.word_id ?? (occWordId != null ? Number(occWordId) : null),
              book: occBook != null ? Number(occBook) : null,
              chapter: occChapter != null ? Number(occChapter) : null,
              verse: occVerse != null ? Number(occVerse) : null,
              position: res.resolved_occurrence.position ?? null,
              edition_key: res.resolved_occurrence.edition ?? null,
              reference: res.resolved_occurrence.reference ?? null,
              surface_form: res.resolved_occurrence.surface_form ?? null,
              source_token_id: res.resolved_occurrence.source_token_id ?? null,
              lemma_id: resolvedLemmaId,
              occurrence_resolution_status: res.resolved_occurrence.occurrence_resolution_status,
            }
          : {
              word_id: occWordId != null ? Number(occWordId) : null,
              book: occBook != null ? Number(occBook) : null,
              chapter: occChapter != null ? Number(occChapter) : null,
              verse: occVerse != null ? Number(occVerse) : null,
              position: occPosition != null ? Number(occPosition) : null,
              edition_key: occEdition ? String(occEdition) : null,
              reference: null,
              lemma_id: resolvedLemmaId,
              ...(candList.length > 1 ? { candidate_lemma_ids: candList.map(c => c.lemma_id).filter(Boolean) } : {}),
              occurrence_resolution_status:
                occWordId != null && occPosition == null
                  ? 'word_form_only_not_unique_occurrence'
                  : res.status === 'ok'
                    ? 'lemma_scoped_no_occurrence_position'
                    : res.status,
            };

        const rawBase =
          res.profile?.strongs_base ||
          res.profile?.extended_strongs ||
          fallbackCand?.strongs_base ||
          fallbackCand?.extended_strongs ||
          (resolvedLemmaId ? String(resolvedLemmaId).replace(/^lemma:/i, '') : '') ||
          (occExtendedStrongs ? String(occExtendedStrongs) : '');
        const normBase = normalizeStrongsBase(rawBase);
        const paddedBase = normBase ? normBase.padded : rawBase.replace(/^([HG]\d+)[A-Za-z]+$/i, '$1');
        if (!queryText && paddedBase) queryText = paddedBase;
        if (!effectiveFocusLemma && paddedBase) effectiveFocusLemma = paddedBase;

        const lemmaLabel = resolvedLemmaId || paddedBase || 'the resolved lemma';
        discoveryScope = {
          level: 'lemma_and_concept_index',
          occurrence_anchored: occAnchored,
          word_id_alone_is_not_unique_occurrence: true,
          scope_explanation: occAnchored
            ? `Exact occurrence identity preserved (${res.resolved_occurrence.reference} position ${res.resolved_occurrence.position}, STEP word_id ${res.resolved_occurrence.word_id}, ${lemmaLabel}). Discovery results query the corpus-wide lemma and concept index for ${lemmaLabel} rather than claiming every discovered connection is specific only to this single token occurrence.`
            : `A STEP word_id alone identifies a word form, not a unique verse occurrence. Supply {word_id, book, chapter, verse, position, edition_key?} for exact occurrence identity. Discovery results reflect corpus-wide lemma and concept connections for ${lemmaLabel}.`,
        };
      }
    } else if (occBook != null && occChapter != null && occVerse != null) {
      // v3 flat-pack occurrence resolution when legacy r9b/r8 manifests are retired
      const session = createV3SessionFromCtx(ctx);
      if (typeof ctx.ensureCatalog === 'function') await ctx.ensureCatalog();
      const vid = typeof ctx.getVerseIdByCoord === 'function'
        ? ctx.getVerseIdByCoord(`${Number(occBook)}:${Number(occChapter)}:${Number(occVerse)}`)
        : null;
      const v3Verse = vid ? await session.getVerse(vid) : null;
      const posNum = occPosition != null ? Number(occPosition) : null;
      const tok = v3Verse?.toks?.find(t =>
        (posNum != null && Number(t.wn) === posNum) ||
        (occWordId != null && Number(t.wid) === Number(occWordId))
      ) || null;
      const bs = normStrongs4(tok?.s || occExtendedStrongs || occLemmaId || queryText);
      const prof = bs ? await session.getProfile(bs) : null;
      const resolvedLemmaId = tok?.lk || prof?.lk || (bs ? `lemma:${bs}` : null);
      const occAnchored = Boolean(tok && posNum != null);
      selectedOccurrence = {
        word_id: tok?.wid ?? (occWordId != null ? Number(occWordId) : null),
        book: Number(occBook),
        chapter: Number(occChapter),
        verse: Number(occVerse),
        position: tok?.wn ?? posNum,
        edition_key: occEdition ? String(occEdition) : (Number(occBook) <= 39 ? 'macula-hebrew-wlc' : 'macula-greek-nestle1904'),
        reference: v3Verse?.ref ?? null,
        surface_form: tok?.sf ?? null,
        source_token_id: null,
        lemma_id: resolvedLemmaId,
        occurrence_resolution_status: occAnchored ? 'verified_occurrence' : (bs ? 'lemma_scoped_no_occurrence_position' : 'unresolved'),
      };
      if (!queryText && bs) queryText = bs;
      if (!effectiveFocusLemma && bs) effectiveFocusLemma = bs;
      const lemmaLabel = resolvedLemmaId || bs || 'the resolved lemma';
      discoveryScope = {
        level: 'lemma_and_concept_index',
        occurrence_anchored: occAnchored,
        word_id_alone_is_not_unique_occurrence: true,
        scope_explanation: occAnchored
          ? `Exact occurrence identity preserved (${v3Verse?.ref} position ${tok?.wn}, STEP word_id ${tok?.wid}, ${lemmaLabel}). Discovery results query the corpus-wide lemma and concept index for ${lemmaLabel}.`
          : `Discovery results reflect corpus-wide lemma and concept connections for ${lemmaLabel}.`,
      };
    }
  }

  if (!queryText && (!concepts || concepts.length === 0)) {
    return {
      schema_version: 1,
      status: 'invalid_request',
      error: 'Could not derive a discovery query from the supplied occurrence anchor.',
      ...(selectedOccurrence ? { selected_occurrence: selectedOccurrence } : {}),
    };
  }

  const reader = createWorkerR10Reader(ctx);
  const releaseId = params.release_id ? String(params.release_id).trim() : DEFAULT_R10_RELEASE;
  const limit = params.limit !== undefined ? Math.min(25, Math.max(1, finiteOr(params.limit, 10))) : 10;
  const result = await discoverBiblicalConnections(reader, {
    query: queryText || (concepts ? concepts.join(' ') : ''),
    concepts,
    mode: params.mode ? String(params.mode) : undefined,
    cluster_id: params.cluster_id ? String(params.cluster_id) : undefined,
    focus_lemma: effectiveFocusLemma,
    compare_targets: parseOptionalListParam(params.compare_targets),
    filters: params.filters && typeof params.filters === 'object' ? params.filters : undefined,
    limit,
    cursor: params.cursor ? String(params.cursor) : null,
    max_hops: params.max_hops !== undefined ? finiteOr(params.max_hops, 3) : 3,
    ...(params.include_v3_verification !== undefined ? { include_v3_verification: parseBoolParam(params.include_v3_verification, false) } : {}),
    release_id: releaseId,
  }, releaseId);
  if (selectedOccurrence || discoveryScope) {
    return {
      ...result,
      ...(selectedOccurrence ? { selected_occurrence: selectedOccurrence } : {}),
      ...(discoveryScope ? { discovery_scope: discoveryScope } : {}),
    };
  }
  return result;
}

export const handleDiscoverBiblicalConnectionsV2 = handleDiscoverBiblicalConnectionsV1;

export async function handleGetConnectionEvidenceV1(ctx, params = {}) {
  const evidenceId = String(params.evidence_id || params.connection_id || params.id || '').trim();
  if (!evidenceId) {
    return { schema_version: 1, status: 'invalid_request', error: 'evidence_id is required.' };
  }
  const reader = createWorkerR10Reader(ctx);
  const releaseId = params.release_id ? String(params.release_id).trim() : DEFAULT_R10_RELEASE;
  return await getConnectionEvidence(reader, evidenceId, releaseId);
}

export async function handleExpandBiblicalConnectionV1(ctx, params = {}) {
  const nodeId = String(params.node_id || params.node || params.concept || '').trim();
  if (!nodeId) {
    return { schema_version: 1, status: 'invalid_request', error: 'node_id is required.' };
  }
  const reader = createWorkerR10Reader(ctx);
  const releaseId = params.release_id ? String(params.release_id).trim() : DEFAULT_R10_RELEASE;
  return await expandBiblicalConnection(reader, nodeId, {
    limit: params.limit !== undefined ? finiteOr(params.limit, 8) : 8,
    cursor: params.cursor ? String(params.cursor) : null,
    release_id: releaseId,
  });
}

// ============================================================================
// CPU-safe fast read-only R10/R11 RPC handlers (<5ms Cloudflare budget)
// Backed strictly by chapter-lite, fast-verses, fast-profiles, motifs, concept-index.
// NEVER reads /v1/chapters/b*-c*.json.gz.
// ============================================================================

const FAST_CHAPTER_LITE_BASE = '/v2/relationships/r8-v1.2';
const FAST_R10_ASSET_BASE = '/v2/relationships/r11-v1.0/r10';
const FAST_FUNCTION_POS_CLASSES = new Set([
  'conjunction', 'preposition', 'article', 'particle', 'pronoun',
  'cj', 'prep', 'ptcl', 'adv', 'rel', 'om', 'intj', 'pron', 'det', 'conj',
]);
const FAST_SKIP_PROFILE_STRONGS = new Set(['H0853', 'H3068']);

function decodeB64GzWithCtx(ctx, b64, cacheKey) {
  if (b64 == null) return null;
  if (typeof b64 !== 'string') return b64;
  if (typeof ctx.decodeB64Gz === 'function') return ctx.decodeB64Gz(b64, cacheKey);
  if (typeof ctx.decodeB64GzJson === 'function') return ctx.decodeB64GzJson(b64, cacheKey);
  throw new Error('decodeB64Gz helper is required in ctx.');
}

async function mapBatched(items, batchSize, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

async function loadFastProfileByStrongs(ctx, bs, opts = {}) {
  if (!bs) return null;
  const normBs = normStrongs4(bs) || bs;
  let v3Prof = null;
  try {
    if (ctx.v3Hooks?.getV3Profile) {
      v3Prof = await ctx.v3Hooks.getV3Profile(normBs);
    } else {
      const sid = String(v3ProfileShardId(normBs)).padStart(2, '0');
      const v3Shard = ctx.v3Hooks?.getV3ProfileShard
        ? await ctx.v3Hooks.getV3ProfileShard(Number(sid))
        : await ctx.loadJsonShard(ctx.env, `/v3/profiles/shard-${sid}.json.gz`);
      v3Prof = v3Shard?.profiles?.[normBs] || null;
    }
  } catch {
    v3Prof = null;
  }

  if (v3Prof && !opts?.includePilot && !opts?.requireR10) {
    const normBs2 = normStrongs4(v3Prof.bs || normBs);
    return {
      ...v3Prof,
      sc: sanitizeV3TokenLemma(normBs2, v3Prof.sc || ''),
      total_verses: v3Prof.total_verses ?? v3Prof.canonical_df ?? 0,
      senses: Array.isArray(v3Prof.senses) ? v3Prof.senses.map(s => ({ ...s, key: s.key || s.sense_id })) : [],
    };
  }

  let fastProf = null;
  try {
    const bucketIdx = Number(BigInt('0x' + fnv1a64Hex(normBs)) % 1024n).toString(16).padStart(3, '0');
    const shard = await ctx.loadJsonShard(ctx.env, `${FAST_R10_ASSET_BASE}/fast-profiles/shard-${bucketIdx}.json.gz`);
    const b64 = shard?.profiles?.[normBs];
    if (b64) {
      fastProf = decodeB64GzWithCtx(ctx, b64, `/r10/p:r11-v1.0:${normBs}`);
    }
  } catch {
    fastProf = null;
  }

  if (v3Prof && fastProf) {
    const normalizedSenses = Array.isArray(v3Prof.senses) && v3Prof.senses.length > 0
      ? v3Prof.senses.map(s => ({ ...s, key: s.key || s.sense_id }))
      : fastProf.senses;
    const rawSc = v3Prof.sc || fastProf.sc;
    const normBs2 = normStrongs4(v3Prof.bs || fastProf.bs || normBs);
    const cleanSc = sanitizeV3TokenLemma(normBs2, rawSc || '');
    return {
      ...fastProf,
      bs: v3Prof.bs || fastProf.bs,
      lk: v3Prof.lk || fastProf.lk,
      lang: v3Prof.lang || fastProf.lang,
      sc: cleanSc,
      tr: v3Prof.tr || fastProf.tr,
      gl: v3Prof.gl || fastProf.gl,
      pos: v3Prof.pos || fastProf.pos,
      entity_kind: v3Prof.entity_kind || fastProf.entity_kind,
      total_verses: v3Prof.canonical_df ?? fastProf.total_verses ?? 0,
      idf: v3Prof.idf ?? fastProf.idf,
      senses: normalizedSenses,
      ...(v3Prof.concepts ? { concepts: v3Prof.concepts } : {}),
      ...(v3Prof.physical_props ? { physical_props: v3Prof.physical_props } : {}),
      ...(v3Prof.lxx_equivalents ? { lxx_equivalents: v3Prof.lxx_equivalents } : {}),
      ...(v3Prof.lxx_shifts ? { lxx_shifts: v3Prof.lxx_shifts } : {}),
    };
  }
  if (v3Prof) {
    const normBs2 = normStrongs4(v3Prof.bs || normBs);
    return {
      ...v3Prof,
      sc: sanitizeV3TokenLemma(normBs2, v3Prof.sc || ''),
      total_verses: v3Prof.total_verses ?? v3Prof.canonical_df ?? 0,
      senses: Array.isArray(v3Prof.senses) ? v3Prof.senses.map(s => ({ ...s, key: s.key || s.sense_id })) : [],
    };
  }
  if (fastProf) {
    const normBs2 = normStrongs4(fastProf.bs || normBs);
    const cleanSc = sanitizeV3TokenLemma(normBs2, fastProf.sc || '');
    if (cleanSc !== fastProf.sc) return { ...fastProf, sc: cleanSc };
  }
  return fastProf;
}

function compactClusterItem(c) {
  const vidCount = Array.isArray(c?.vids) ? c.vids.length : (Array.isArray(c?.verses) ? c.verses.length : 0);
  const count = typeof c?.count === 'number' && c.count > 0 ? c.count : vidCount;
  const sampleRefs = Array.isArray(c?.sample_passages)
    ? c.sample_passages.slice(0, 4).map((p) => p?.ref).filter(Boolean)
    : [];
  return {
    cluster_id: c?.cluster_id ?? null,
    category: c?.category ?? null,
    label: c?.label ?? null,
    count,
    ...(sampleRefs.length > 0 ? { sample_refs: sampleRefs } : {}),
    ...(c?.summary ? { summary: String(c.summary).slice(0, 140) } : {}),
  };
}

function compactGrammaticalItem(g) {
  return {
    predicate: g?.predicate ?? null,
    direction: g?.direction ?? null,
    display_label: g?.display_label ?? null,
    related_strongs: g?.related_strongs ?? null,
    related_script: g?.related_script ?? null,
    related_gloss: g?.related_gloss ?? null,
    occurrences: g?.occurrences ?? 0,
  };
}

function compactLexicalItem(l) {
  return {
    type: l?.type ?? null,
    ...(l?.root ? { root: l.root } : {}),
    target_strongs: l?.target_strongs ?? null,
    ...(l?.script ? { script: l.script } : {}),
    ...(l?.gloss ? { gloss: l.gloss } : {}),
    ...(l?.label ? { label: l.label } : {}),
  };
}

function isCorruptLxxRelation(srcBs, targetBs, script = '') {
  const s = normStrongs4(srcBs);
  const t = normStrongs4(targetBs);
  if ((s === 'G0065' && (t === 'H6501' || t === 'H6171')) || ((s === 'H6501' || s === 'H6171') && t === 'G0065')) {
    return true;
  }
  if (s === 'G0065' && /פֶּ֫רֶא|פרא|עָרוֹד/.test(String(script || ''))) return true;
  return false;
}

function rankAndFilterLxxRelations(srcBs, rawLxxRels, v3LxxEquivs = []) {
  const eqCountByPlain = new Map();
  for (const eq of Array.isArray(v3LxxEquivs) ? v3LxxEquivs : []) {
    const p = stripGreekDiacriticsV3(eq?.g_lemma);
    if (p) eqCountByPlain.set(p, Math.max(eqCountByPlain.get(p) || 0, Number(eq?.count || 0)));
  }
  const items = [];
  for (const x of Array.isArray(rawLxxRels) ? rawLxxRels : []) {
    if (!x || (!x.target_strongs && !x.script)) continue;
    const tBs = normStrongs4(x.target_strongs) || x.target_strongs || null;
    if (isCorruptLxxRelation(srcBs, tBs, x.script)) continue;
    if (isLxxFunctionEquivalent(tBs, x.script)) continue;
    const plainSc = stripGreekDiacriticsV3(x.script);
    const boostedCount = Math.max(Number(x.count || 0), eqCountByPlain.get(plainSc) || 0);
    items.push({
      type: x.type ?? null,
      target_strongs: tBs,
      script: x.script ?? null,
      gloss: x.gloss ?? null,
      count: boostedCount,
    });
  }
  items.sort((a, b) => {
    const aRare = a.count <= 4 ? 0.25 : 1;
    const bRare = b.count <= 4 ? 0.25 : 1;
    const aBridge = a.type === 'bcv_lxx_bridge' ? 1.35 : 1;
    const bBridge = b.type === 'bcv_lxx_bridge' ? 1.35 : 1;
    return (b.count * bRare * bBridge) - (a.count * aRare * aBridge);
  });
  return items;
}

function compactLxxItem(x) {
  return {
    type: x?.type ?? null,
    target_strongs: x?.target_strongs ?? null,
    script: x?.script ?? null,
    gloss: x?.gloss ?? null,
    count: x?.count ?? 0,
  };
}

function compactOrthCandidate(c) {
  return {
    bs: c?.bs ?? c?.target_strongs ?? c?.strongs ?? null,
    sc: c?.sc ?? c?.target_form ?? c?.script ?? null,
    ...(c?.tr || c?.transliteration ? { tr: c.tr ?? c.transliteration } : {}),
    gl: c?.gl ?? c?.target_gloss ?? c?.gloss ?? null,
    ...(c?.cons || c?.matched_normalized_text ? { cons: c.cons ?? c.matched_normalized_text } : {}),
    ...(c?.score !== undefined ? { score: c.score } : {}),
  };
}

function projectCompactProfile(
  prof,
  { includeVids = false, includeForms = false, includeOrth = true, includePilot = false } = {},
) {
  const pilot = prof.r12_pilot_anchor || null;
  const rawOrth = prof.orth_entry || null;
  const rawOrthCands = Array.isArray(rawOrth?.candidates)
    ? rawOrth.candidates
    : (Array.isArray(pilot?.orthographic_candidates) ? pilot.orthographic_candidates : []);
  const orthEntry = includeOrth
    ? (rawOrth
        ? {
            bs: rawOrth.bs ?? prof.bs,
            ...(rawOrth.cons ? { cons: rawOrth.cons } : {}),
            ...(Array.isArray(rawOrth.homographs)
              ? { homographs: rawOrth.homographs.slice(0, 6).map(compactOrthCandidate) }
              : {}),
            ...(Array.isArray(rawOrth.consonantal_overlaps)
              ? { consonantal_overlaps: rawOrth.consonantal_overlaps.slice(0, 8) }
              : {}),
            ...(Array.isArray(rawOrth.shared_root)
              ? { shared_root: rawOrth.shared_root.slice(0, 6) }
              : {}),
            ...(rawOrthCands.length > 0 ? { candidates: rawOrthCands.slice(0, 5).map(compactOrthCandidate) } : {}),
          }
        : (rawOrthCands.length > 0 ? { candidates: rawOrthCands.slice(0, 5).map(compactOrthCandidate) } : null))
    : undefined;

  const propBridges = pilot?.property_bridges ?? prof.property_bridges ?? [];
  const compactBridges = Array.isArray(propBridges)
    ? propBridges.slice(0, 4).map((b) => ({
        property_key: b?.property_key ?? null,
        value_label: b?.value_label ?? null,
        ...(b?.bridge_kind ? { bridge_kind: b.bridge_kind } : {}),
        ...(b?.assertion_origin ? { assertion_origin: b.assertion_origin } : {}),
        ...(b?.target_strongs ? { target_strongs: b.target_strongs } : {}),
        ...(b?.target_gloss ? { target_gloss: b.target_gloss } : {}),
        ...(b?.source ? { source: b.source } : {}),
      }))
    : [];

  const pilotPaths = includePilot
    ? (pilot?.multihop?.recommendations || prof.multihop?.recommendations || [])
        .slice(0, 5)
        .map((p) => ({
          evidence_id: p?.evidence_id ?? null,
          target_strongs: p?.target_strongs ?? p?.target_id ?? null,
          target_gloss: p?.target_gloss ?? p?.target_label ?? null,
          epistemic: p?.endpoint_epistemic_status ?? p?.epistemic_status ?? null,
          ...(p?.K !== undefined ? { K: p.K } : {}),
          ...(Array.isArray(p?.witness_refs) ? { witness_refs: p.witness_refs.slice(0, 2) } : {}),
        }))
    : undefined;

  return {
    bs: prof.bs,
    lk: prof.lk,
    lang: prof.lang,
    sc: prof.sc,
    tr: prof.tr,
    gl: prof.gl,
    pos: prof.pos,
    entity_kind: prof.entity_kind,
    senses: Array.isArray(prof.senses) ? prof.senses.slice(0, 6) : [],
    total_verses: prof.total_verses ?? 0,
    ...(includeVids && Array.isArray(prof.all_vids) ? { all_vids: prof.all_vids } : {}),
    ...(includeForms && Array.isArray(prof.forms)
      ? {
          forms: prof.forms.slice(0, 10).map((f) => ({
            sf: f?.sf ?? null,
            tr: f?.tr ?? null,
            gl: f?.gl ?? null,
            mc: f?.mc ?? null,
            cnt: f?.cnt ?? 0,
          })),
        }
      : {}),
    clusters: Array.isArray(prof.clusters) ? prof.clusters.slice(0, 5).map(compactClusterItem) : [],
    grammatical_relations: Array.isArray(prof.grammatical_relations)
      ? prof.grammatical_relations.slice(0, 6).map(compactGrammaticalItem)
      : [],
    lexical_relations: Array.isArray(prof.lexical_relations)
      ? prof.lexical_relations.slice(0, 6).map(compactLexicalItem)
      : [],
    lxx_relations: Array.isArray(prof.lxx_relations)
      ? rankAndFilterLxxRelations(prof.bs, prof.lxx_relations, prof.lxx_equivalents).slice(0, 6).map(compactLxxItem)
      : [],
    homograph_siblings: Array.isArray(prof.homograph_siblings)
      ? prof.homograph_siblings.slice(0, 6).map((h) => ({
          bs: h?.bs ?? null,
          lk: h?.lk ?? null,
          sc: h?.sc ?? null,
          tr: h?.tr ?? null,
          gl: h?.gl ?? null,
        }))
      : [],
    ...(orthEntry !== undefined ? { orth_entry: orthEntry } : {}),
    ...(Array.isArray(prof.r13_wordplay) ? { r13_wordplay: prof.r13_wordplay.slice(0, 10) } : {}),
    ...(Array.isArray(prof.r13_colloc) ? { r13_colloc: prof.r13_colloc.slice(0, 6) } : {}),
    ...(Array.isArray(prof.r13_motif_ids) ? { r13_motif_ids: prof.r13_motif_ids.slice(0, 8) } : {}),
    first_occ_passages: Array.isArray(prof.first_occ_passages)
      ? prof.first_occ_passages.slice(0, 3).map((fp) => ({
          ref: fp?.ref ?? null,
          book: fp?.book ?? null,
          chapter: fp?.chapter ?? null,
          verse: fp?.verse ?? null,
          ...(fp?.snippet ? { snippet: String(fp.snippet).slice(0, 140) } : {}),
        }))
      : [],
    pilot_bridges: compactBridges,
    ...(pilotPaths !== undefined ? { pilot_paths: pilotPaths } : {}),
  };
}

function parseJsonOrArrayParam(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// Morpheme links enumerate possible lemma identities, not a ranked sense selection.
function stemLemmaKeys(morphemes, strongs) {
  const target = paddedStrongs(strongs);
  return [...new Set((Array.isArray(morphemes) ? morphemes : [])
    .filter(m => Array.isArray(m) && m[0] === 'stem' && typeof m[1] === 'string')
    .map(m => m[1]).filter(lk => paddedStrongs(lk.replace(/^lemma:/i, '')) === target))];
}

function cleanSurfaceDisplay(s) {
  return String(s ?? '').replace(/\s*׃\s*[פס]\s*$/u, '׃').trim();
}

function stripConsonants(s) {
  return cleanSurfaceDisplay(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u0591-\u05c7\u05be\u05c0\u05c3\u05c6]/g, '')
    .replace(/[^\p{L}]/gu, '')
    .toLowerCase();
}

function paddedStrongs(raw) {
  if (!raw) return null;
  return normalizeStrongsBase(raw)?.padded || String(raw).trim();
}

/**
 * chapter-lite (liteVerse.t) is the canonical token spine: positions and word_ids are 1:1 with
 * the lexical word table. fast-verses (fastVerse.toks) uses its own numbering that skips positions
 * in ~1,100 verses and differs in token count in ~670, so it may only enrich a lite token after a
 * monotone surface/Strong's match; it is never joined by position number.
 */
export function normalizeTokenList(liteVerse, fastVerse) {
  const liteRows = Array.isArray(liteVerse?.t) ? liteVerse.t.filter(Array.isArray) : [];
  const fvToks = Array.isArray(fastVerse?.toks) ? fastVerse.toks : [];

  if (liteRows.length === 0) {
    // No canonical spine: expose fast-verse tokens without word identity rather than guessing one.
    return fvToks.map((tok, i) => {
      const strongs = paddedStrongs(tok.s);
      return {
        position: i + 1,
        word_id: null,
        surface: tok.sf ?? null,
        lemma: tok.lm ?? null,
        lemma_key: strongs ? `lemma:${strongs}` : null,
        strongs,
        all_strongs: strongs ? [strongs] : [],
        gloss: tok.g ?? null,
        pos_class: tok.cl ?? null,
        alignment: 'fast_verse_only',
      };
    });
  }

  // Keep only pairs present in every optimal sequence alignment. A repeated form
  // next to an omitted token must not inherit a later occurrence's contextual gloss.
  const keys = liteRows.map(r => [stripConsonants(r[2]), paddedStrongs(r[3])]);
  const fastKeys = fvToks.map(t => [stripConsonants(t.sf), paddedStrongs(t.s)]);
  const matches = (i, j) => Boolean(keys[i][0] && keys[i][0] === fastKeys[j][0]
    && keys[i][1] && keys[i][1] === fastKeys[j][1]);
  const n = liteRows.length, m = fvToks.length;
  const identical = n === m && keys.every((_, i) => matches(i, i));
  const prefix = identical ? [] : Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  const suffix = identical ? [] : Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  if (!identical) for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    prefix[i + 1][j + 1] = Math.max(prefix[i][j + 1], prefix[i + 1][j],
      matches(i, j) ? prefix[i][j] + 1 : 0);
  }
  if (!identical) for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    suffix[i][j] = Math.max(suffix[i + 1][j], suffix[i][j + 1],
      matches(i, j) ? suffix[i + 1][j + 1] + 1 : 0);
  }
  const best = identical ? n : prefix[n][m];
  return liteRows.map((row, i) => {
    const surface = row[2] != null ? cleanSurfaceDisplay(row[2]) : null;
    const strongs = paddedStrongs(row[3]);
    let matched = null;
    const candidates = [];
    let canSkip = false;
    if (!identical) for (let j = 0; j <= m; j++) {
      if (prefix[i][j] + suffix[i + 1][j] === best) canSkip = true;
      if (j < m && matches(i, j) && prefix[i][j] + 1 + suffix[i + 1][j + 1] === best) candidates.push(j);
    }
    if (identical) matched = fvToks[i];
    else if (!canSkip && candidates.length === 1) matched = fvToks[candidates[0]];
    const primaryMatches = Boolean(matched && strongs && paddedStrongs(matched.s) === strongs);
    const lemmaKeys = stemLemmaKeys(row[4], strongs);
    const allStrongs = [];
    const seen = new Set();
    const morphemeStrongs = (Array.isArray(row[4]) ? row[4] : []).filter(Array.isArray).map(m => paddedStrongs(String(m[1] || '').replace(/^lemma:/i, '')));
    for (const s of [strongs, ...morphemeStrongs]) {
      if (s && !seen.has(s)) { seen.add(s); allStrongs.push(s); }
    }
    return {
      position: Number(row[0]),
      word_id: row[1] ?? null,
      surface,
      lemma: primaryMatches ? (matched.lm ?? null) : null,
      lemma_key: lemmaKeys.length === 1 ? lemmaKeys[0] : (strongs ? 'lemma:' + strongs : null),
      ...(lemmaKeys.length > 1 ? { lemma_candidates: lemmaKeys, sense_status: 'ambiguous_source_links' } : {}),
      strongs,
      all_strongs: allStrongs,
      gloss: matched?.g ?? null,
      pos_class: matched?.cl ?? null,
      ...(!matched ? { alignment: 'canonical_only' } : {}),
    };
  });
}

function buildEventLookupMap(motifs, ctx) {
  const eventById = new Map();
  if (!motifs) return eventById;
  const rawEvents = motifs.events_b64gz
    ? decodeB64GzWithCtx(ctx, motifs.events_b64gz, '/r10/events:r11-v1.0')
    : motifs.events;
  if (Array.isArray(rawEvents)) {
    for (const ev of rawEvents) {
      if (ev?.event_id) eventById.set(ev.event_id, ev);
    }
  } else if (rawEvents && typeof rawEvents === 'object') {
    for (const [k, ev] of Object.entries(rawEvents)) {
      const id = ev?.event_id || k;
      if (id && ev) eventById.set(id, ev);
    }
  }
  return eventById;
}

export async function handleGetPassageCompactV1(ctx, params = {}) {
  await ctx.ensureCatalog();

  const orderedVids = [];
  const seenVids = new Set();
  const addVid = (vid) => {
    const n = Number(vid);
    if (Number.isInteger(n) && n > 0 && !seenVids.has(n)) {
      seenVids.add(n);
      orderedVids.push(n);
    }
  };

  const passages = parseJsonOrArrayParam(params.passages);
  if (passages.length > 0) {
    for (const p of passages) {
      if (!p || typeof p !== 'object') continue;
      const book = Number(p.book);
      const chapter = Number(p.chapter);
      if (!Number.isInteger(book) || !Number.isInteger(chapter) || book <= 0 || chapter <= 0) continue;

      const hasSingleVerse = p.verse !== undefined && p.verse !== null && p.verse !== '';
      const hasRange = p.start_verse !== undefined && p.start_verse !== null && p.start_verse !== ''
        || p.end_verse !== undefined && p.end_verse !== null && p.end_verse !== '';

      if (hasSingleVerse && !hasRange) {
        const v = Number(p.verse);
        if (Number.isInteger(v) && v >= 0) {
          addVid(ctx.getVerseIdByCoord(`${book}:${chapter}:${v}`));
        }
      } else if (hasRange) {
        const startV = p.start_verse !== undefined && p.start_verse !== null && p.start_verse !== ''
          ? Math.max(0, Math.floor(Number(p.start_verse)))
          : 0;
        const rawEnd = p.end_verse !== undefined && p.end_verse !== null && p.end_verse !== ''
          ? Math.floor(Number(p.end_verse))
          : startV;
        const endV = Math.min(200, Math.max(startV, rawEnd));
        for (let v = startV; v <= endV; v++) {
          addVid(ctx.getVerseIdByCoord(`${book}:${chapter}:${v}`));
        }
      } else {
        for (let v = 0; v <= 200; v++) {
          addVid(ctx.getVerseIdByCoord(`${book}:${chapter}:${v}`));
        }
      }
    }
  } else {
    const rawIds = Array.isArray(params.verse_ids)
      ? params.verse_ids
      : (typeof params.verse_ids === 'string' ? params.verse_ids.split(',').map(x => Number(x.trim())) : []);
    for (const rawId of rawIds) {
      const id = Number(rawId);
      if (Number.isInteger(id) && id > 0 && ctx.getVerseById(id)) {
        addVid(id);
      }
    }
  }

  const offset = Math.max(0, Math.floor(Number(params.offset || 0)));
  const maxVerses = Math.min(50, Math.max(1, Math.floor(Number(params.max_verses || 30))));
  const totalVerses = orderedVids.length;
  const pageVids = orderedVids.slice(offset, offset + maxVerses);
  const returned = pageVids.length;
  const hasMore = offset + returned < totalVerses;
  const nextOffset = hasMore ? offset + returned : null;

  const chunkHexes = new Set();
  const verseMetas = [];
  for (const vid of pageVids) {
    const meta = ctx.getVerseById(vid);
    if (!meta) continue;
    verseMetas.push(meta);
    chunkHexes.add(Math.floor((vid - 1) / 64).toString(16).padStart(3, '0'));
  }

  let v3VerseById = new Map();
  if (ctx.v3Hooks?.getV3VersesBatch) {
    v3VerseById = await ctx.v3Hooks.getV3VersesBatch(verseMetas.map(m => m.id));
  } else {
    const v3ChunkIds = new Set(verseMetas.map(m => v3VerseChunkId(m.id)));
    const v3ChunkById = new Map();
    await Promise.all([...v3ChunkIds].map(async (cid) => {
      const ch = ctx.v3Hooks?.getV3VerseChunk
        ? await ctx.v3Hooks.getV3VerseChunk(cid)
        : await ctx.loadJsonShard(ctx.env, `/v3/verses/chunk-${String(cid).padStart(2, '0')}.json.gz`);
      if (ch) v3ChunkById.set(cid, ch);
    }));
    for (const meta of verseMetas) {
      const ch = v3ChunkById.get(v3VerseChunkId(meta.id));
      const v3v = ch?.verses?.[String(meta.id)] || null;
      if (v3v) v3VerseById.set(meta.id, v3v);
    }
  }

  const missingV3Vids = verseMetas.filter(m => !v3VerseById.get(m.id)).map(m => m.id);
  const chunkByHex = new Map();
  const liteByChapter = new Map();

  if (missingV3Vids.length > 0) {
    const missHexes = new Set(missingV3Vids.map(vid => Math.floor((vid - 1) / 64).toString(16).padStart(3, '0')));
    await Promise.all([...missHexes].map(async (chunkHex) => {
      const chunk = await ctx.loadJsonShard(ctx.env, `${FAST_R10_ASSET_BASE}/fast-verses/chunk-${chunkHex}.json.gz`);
      if (chunk) chunkByHex.set(chunkHex, chunk);
    }));
  }

  // Only consult legacy r8-v1.2 chapter-lite if v3 verse is unavailable
  if (missingV3Vids.length === verseMetas.length && verseMetas.length > 0) {
    const chapterKeys = new Set(verseMetas.map(m => `${m.book}:${m.chapter}`));
    await Promise.all([...chapterKeys].map(async (chKey) => {
      const chBucket = Number(BigInt('0x' + fnv1a64Hex(chKey)) % 64n).toString(16).padStart(2, '0');
      const liteShard = await ctx.loadJsonShard(ctx.env, `${FAST_CHAPTER_LITE_BASE}/chapter-lite/shard-${chBucket}.json.gz`);
      const liteChapter = liteShard
        ? await packedShardEntry(liteShard, chKey, FAST_CHAPTER_LITE_BASE, p => ctx.loadJsonShard(ctx.env, p))
        : null;
      liteByChapter.set(chKey, liteChapter);
    }));
  }

  const decodedVerses = [];
  let hasAnyEvents = false;
  for (const meta of verseMetas) {
    const vid = meta.id;
    const v3Verse = v3VerseById.get(vid) || null;

    const chKey = `${meta.book}:${meta.chapter}`;
    const chunkHex = Math.floor((vid - 1) / 64).toString(16).padStart(3, '0');
    const chunk = chunkByHex.get(chunkHex);
    const liteChapter = liteByChapter.get(chKey);
    const liteV = liteChapter?.[String(meta.verse_nr)] || null;

    const fvRaw = chunk?.verses?.[String(vid)];
    const fv = fvRaw ? decodeB64GzWithCtx(ctx, fvRaw, `/r10/v:r11-v1.0:${vid}`) : null;

    const rawXrefsVal = chunk?.xrefs?.[String(vid)];
    const rawXrefs = typeof rawXrefsVal === 'string'
      ? decodeB64GzWithCtx(ctx, rawXrefsVal, `/r10/x:r11-v1.0:${vid}`)
      : (rawXrefsVal ?? v3Verse?.xrefs);

    const rawEventsVal = chunk?.events?.[String(vid)];
    const rawEvents = typeof rawEventsVal === 'string'
      ? decodeB64GzWithCtx(ctx, rawEventsVal, `/r10/e:r11-v1.0:${vid}`)
      : rawEventsVal;

    if (Array.isArray(rawEvents) && rawEvents.length > 0) hasAnyEvents = true;

    decodedVerses.push({
      meta,
      v3Verse,
      fv,
      liteV,
      rawXrefs: Array.isArray(rawXrefs) ? rawXrefs : [],
      rawEvents: Array.isArray(rawEvents) ? rawEvents : [],
    });
  }

  let eventById = null;
  if (hasAnyEvents) {
    const motifs = await ctx.loadJsonShard(ctx.env, `${FAST_R10_ASSET_BASE}/motifs-and-patterns.json.gz`);
    eventById = buildEventLookupMap(motifs, ctx);
  }

  const freqByStrongs = new Map();
  const verses = decodedVerses.map(({ meta, v3Verse, fv, liteV, rawXrefs, rawEvents }) => {
    const tokens = v3Verse && Array.isArray(v3Verse.toks)
      ? repairV3VerseToks({ ...v3Verse, vid: meta.id, book: meta.book }).map((tok, i) => {
          const strongs = paddedStrongs(tok.s);
          const cleanLemma = tok.lm != null ? sanitizeV3TokenLemma(strongs || '', String(tok.lm)) : null;
          return {
            position: tok.wn ?? (i + 1),
            word_id: tok.wid ?? null,
            surface: tok.sf != null ? cleanSurfaceDisplay(tok.sf) : null,
            lemma: cleanLemma,
            lemma_key: tok.lk || (strongs ? `lemma:${strongs}` : null),
            strongs,
            all_strongs: strongs ? [strongs] : [],
            gloss: tok.g ?? null,
            pos_class: tok.cl ?? null,
            ...(tok.sense_id ? { sense_id: tok.sense_id } : {}),
            ...(tok.concept_id ? { concept_id: tok.concept_id } : {}),
          };
        })
      : normalizeTokenList(liteV, fv);
    for (const tok of tokens) {
      if (!tok.strongs) continue;
      const cls = String(tok.pos_class || '').toLowerCase();
      if (FAST_FUNCTION_POS_CLASSES.has(cls)) continue;
      if (tok.strongs.startsWith('H900') || FAST_SKIP_PROFILE_STRONGS.has(tok.strongs)) continue;
      freqByStrongs.set(tok.strongs, (freqByStrongs.get(tok.strongs) || 0) + 1);
    }

    const normalizedXrefs = rawXrefs.map((x) => {
      if (!Array.isArray(x)) {
        return {
          target_vid: Number(x.to_vid ?? x.target_vid ?? 0),
          target_ref: x.to_ref ?? x.target_ref ?? null,
          phrase: x.phrase ?? null,
          flags: x.flags ?? null,
        };
      }
      const flags = x[3] !== undefined && x[3] !== null ? Number(x[3]) : null;
      return {
        target_vid: Number(x[0]),
        target_ref: x[1] ?? null,
        phrase: x[2] ?? null,
        flags,
        ...(flags !== null
          ? {
              reciprocal: Boolean(flags & 1),
              cross_testament: Boolean(flags & 2),
            }
          : {}),
      };
    });

    const enrichedEvents = rawEvents.map((evId) => {
      const ev = eventById?.get(evId) || null;
      return {
        event_id: evId,
        title: ev?.title ?? null,
        start_year: ev?.start_year ?? ev?.start_date ?? null,
      };
    });

    const mtRef = v3Verse?.mt_ref || fv?.mt_ref || null;
    return {
      verse_id: meta.id,
      book: v3Verse?.book ?? fv?.book ?? meta.book,
      chapter: v3Verse?.chapter ?? fv?.chapter ?? meta.chapter,
      verse: v3Verse?.verse ?? fv?.verse ?? meta.verse_nr,
      ref: v3Verse?.ref ?? fv?.ref ?? null,
      ...(mtRef ? { mt_ref: mtRef } : {}),
      web: v3Verse?.en || fv?.en || liteV?.web || null,
      xrefs: normalizedXrefs,
      events: enrichedEvents,
      tokens,
    };
  });

  const includeProfiles = parseBoolParam(params.include_profiles, true);
  const profileLimit = Math.min(30, Math.max(0, Math.floor(Number(params.profile_limit ?? 24))));
  const profiles = {};
  let profilePlan = null;

  if (includeProfiles && profileLimit > 0 && freqByStrongs.size > 0) {
    const candidateStrongs = [...freqByStrongs.entries()]
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .slice(0, Math.min(profileLimit + 6, 36))
      .map(([bs]) => bs);

    if (parseBoolParam(params.defer_profiles, false)) {
      profilePlan = { limit: profileLimit, candidates: candidateStrongs.map(bs => ({ bs, freq: freqByStrongs.get(bs) || 0 })) };
    } else {
    const decodedProfiles = await Promise.all(candidateStrongs.map(bs => loadFastProfileByStrongs(ctx, bs)));
    const valid = [];
    for (let i = 0; i < candidateStrongs.length; i++) {
      const prof = decodedProfiles[i];
      if (!prof) continue;
      valid.push({
        bs: candidateStrongs[i],
        freq: freqByStrongs.get(candidateStrongs[i]) || 0,
        totalVerses: prof.total_verses ?? Number.MAX_SAFE_INTEGER,
        prof,
      });
    }

    valid.sort((a, b) => (
      (b.freq - a.freq)
      || (a.totalVerses - b.totalVerses)
      || a.bs.localeCompare(b.bs)
    ));

    for (const item of valid.slice(0, profileLimit)) {
      profiles[item.bs] = projectCompactProfile(item.prof);
    }
    }
  }

  return {
    status: 'ok',
    pagination: {
      total_verses: totalVerses,
      returned,
      offset,
      has_more: hasMore,
      next_offset: nextOffset,
    },
    verses,
    profiles,
    ...(profilePlan ? { profile_plan: profilePlan } : {}),
  };
}

export async function handleGetWordProfilesBatchV1(ctx, params = {}) {
  const rawList = Array.isArray(params.strongs)
    ? params.strongs
    : Array.isArray(params.strongs_list)
      ? params.strongs_list
      : Array.isArray(params.keys)
        ? params.keys
        : parseListParam(params.strongs ?? params.strongs_list ?? params.keys);
  const includeVids = parseBoolParam(params.include_vids, false);
  const includeForms = parseBoolParam(params.include_forms, true);
  const includeOrth = parseBoolParam(params.include_orth, true);
  const includePilot = parseBoolParam(params.include_pilot, false);

  const uniqueStrongs = [];
  const seen = new Set();
  const missing = [];
  for (const raw of rawList.slice(0, 24)) {
    const cleaned = String(raw || '').trim().replace(/^lemma:/i, '');
    const norm = normalizeStrongsBase(cleaned);
    if (!norm) {
      if (cleaned) missing.push(cleaned);
      continue;
    }
    if (seen.has(norm.padded)) continue;
    seen.add(norm.padded);
    uniqueStrongs.push(norm.padded);
  }

  const loaded = await Promise.all(uniqueStrongs.map(bs => loadFastProfileByStrongs(ctx, bs)));
  const profiles = {};
  for (let i = 0; i < uniqueStrongs.length; i++) {
    const bs = uniqueStrongs[i];
    const prof = loaded[i];
    if (!prof) {
      missing.push(bs);
      continue;
    }
    profiles[bs] = projectCompactProfile(prof, {
      includeVids,
      includeForms,
      includeOrth,
      includePilot,
    });
  }

  return {
    status: 'ok',
    profiles,
    missing,
  };
}

function normalizeLookupText(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[.\-']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ς/g, 'σ');
}

function buildMorphFallbacks(normKey) {
  const out = [];
  if (!normKey || !/^[a-z\s]+$/.test(normKey)) return out;
  if (normKey.endsWith('ies') && normKey.length > 4) {
    out.push(normKey.slice(0, -3) + 'y');
  }
  if (normKey.endsWith('im') && normKey.length > 4) {
    out.push(normKey.slice(0, -2));
  }
  if (normKey.endsWith('es') && normKey.length > 3) {
    out.push(normKey.slice(0, -2));
    out.push(normKey.slice(0, -1));
  } else if (normKey.endsWith('s') && normKey.length > 3) {
    out.push(normKey.slice(0, -1));
  } else if (!normKey.includes(' ') && normKey.length >= 4) {
    out.push(normKey + 's');
  }
  return [...new Set(out)];
}

function buildTranslitFallbacks(normKey) {
  if (!normKey || !/^[a-z]+$/.test(normKey) || normKey.length < 3) return [];
  const variants = new Set();
  const add = v => { if (v && v !== normKey) variants.add(v); };
  if (normKey.endsWith('k')) add(normKey + 'h');
  if (normKey.endsWith('kh')) add(normKey.slice(0, -1));
  if (normKey.includes('ch')) {
    add(normKey.replace(/ch/g, 'kh'));
    add(normKey.replace(/ch/g, 'h'));
  }
  if (normKey.includes('kh')) add(normKey.replace(/kh/g, 'ch'));
  if (normKey.includes('ts')) add(normKey.replace(/ts/g, 'tz'));
  if (normKey.includes('tz')) add(normKey.replace(/tz/g, 'ts'));
  if (normKey.includes('q')) add(normKey.replace(/q/g, 'k'));
  if (normKey.includes('k')) add(normKey.replace(/k/g, 'q'));
  if (normKey.includes('ph')) add(normKey.replace(/ph/g, 'f'));
  if (normKey.includes('b')) add(normKey.replace(/b/g, 'v'));
  if (normKey.includes('v')) add(normKey.replace(/v/g, 'b'));
  if (normKey.includes('p')) add(normKey.replace(/p/g, 'f'));
  if (normKey.includes('w')) add(normKey.replace(/w/g, 'v'));
  for (const v of [...variants]) {
    if (v.includes('i') && !v.includes('dd')) add(v.replace(/([a-z])i([qk])$/, '$1$1i$2'));
    if (v.includes('q')) add(v.replace(/q/g, 'k'));
    if (v.includes('k') && !v.endsWith('kh')) add(v.replace(/k$/, 'kh'));
    if (v.includes('b')) add(v.replace(/b/g, 'v'));
  }
  return [...variants].slice(0, 10);
}

const CARDINAL_NUMBER_STRONGS = {
  '1': ['H0259', 'G1520'],
  '2': ['H8147', 'G1417'],
  '3': ['H7969', 'H7992', 'G5140'],
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

const CONCEPT_PRIMARY_STRONGS = {
  thought: ['H4284', 'H2803', 'G3540', 'G1261', 'G3053'],
  thoughts: ['H4284', 'H2803', 'G3540', 'G1261', 'G3053'],
};

async function lookupFastIndexKey(ctx, normKey) {
  if (!normKey) return [];
  const bucketKey = /^[hg]\d{4}$/.test(normKey) ? normKey.toUpperCase() : normKey;
  const bucket = Number(BigInt('0x' + fnv1a64Hex(bucketKey)) % 1024n).toString(16).padStart(3, '0');
  const subIdx = Number((BigInt('0x' + fnv1a64Hex(normKey)) >> 10n) & 15n).toString(16);
  const shard = await ctx.loadJsonShard(ctx.env, `${FAST_R10_ASSET_BASE}/fast-profiles/shard-${bucket}.json.gz`);
  const subB64 = shard?.lookup?.[subIdx];
  if (!subB64) return [];
  const subMap = decodeB64GzWithCtx(ctx, subB64, `/r10/l:r11-v1.0:${bucket}:${subIdx}`);
  const hits = subMap?.[normKey];
  return Array.isArray(hits) ? hits : [];
}

function splitGlossSegments(gl) {
  return String(gl || '')
    .toLowerCase()
    .split(/[/,;:]+/)
    .map(seg => seg.replace(/\([^)]*\)/g, '').trim())
    .filter(Boolean);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWholeWordMatch(text, query) {
  if (!text || !query) return false;
  const cleaned = String(text).toLowerCase().replace(/\([^)]*\)/g, ' ');
  return new RegExp(`(?:^|\\b)${escapeRegExp(query)}(?:\\b|$)`).test(cleaned);
}

function scoreFastLookupMatch(prof, rawQuery, normQuery, strongsNorm) {
  const qTrim = rawQuery.trim();
  const qLower = qTrim.toLowerCase();
  const qTrNorm = qTrim.replace(/[.\-'\s]/g, '').toLowerCase();

  const bs = String(prof.bs || '');
  const lk = String(prof.lk || '');
  const sc = String(prof.sc || '');
  const trNorm = String(prof.tr || '').replace(/[.\-'\s]/g, '').toLowerCase();

  if (
    (strongsNorm && (bs === strongsNorm.padded || lk === `lemma:${strongsNorm.padded}${strongsNorm.suffix.toUpperCase()}` || lk === `lemma:${strongsNorm.padded}`))
    || qLower === lk.toLowerCase()
  ) {
    return 1;
  }

  if (sc && (sc === qTrim || (normQuery && normalizeLookupText(sc) === normQuery))) {
    return 2;
  }

  if (trNorm && qTrNorm && trNorm === qTrNorm) {
    return 3;
  }

  if (trNorm && qTrNorm && buildTranslitFallbacks(qTrNorm).includes(trNorm)) {
    return 3.2;
  }

  const morphSet = new Set([qLower, normQuery, ...buildMorphFallbacks(normQuery)].filter(Boolean));
  const glSegments = splitGlossSegments(prof.gl);
  const senseGl = Array.isArray(prof.senses)
    ? prof.senses.flatMap(s => splitGlossSegments(s?.gl))
    : [];
  const allGlSegments = [...glSegments, ...senseGl];
  if (normQuery && allGlSegments.some(seg => morphSet.has(seg))) {
    return 4;
  }
  const senseTexts = Array.isArray(prof.senses) ? prof.senses.map(s => String(s?.gl || '')) : [];
  if (
    normQuery &&
    [...morphSet].some(m => hasWholeWordMatch(prof.gl, m) || senseTexts.some(st => hasWholeWordMatch(st, m)))
  ) {
    return 4.2;
  }

  return 5;
}

export async function handleResolveFastLookupV1(ctx, params = {}) {
  const rawQuery = String(params.query || '').trim();
  const limit = Math.min(20, Math.max(1, Math.floor(Number(params.limit || 10))));
  if (!rawQuery) {
    return { status: 'ok', query: rawQuery, matches: [] };
  }

  const strongsInput = rawQuery.replace(/^lemma:/i, '').trim();
  const strongsNorm = normalizeStrongsBase(strongsInput);
  const normQuery = normalizeLookupText(rawQuery);
  const cardinalStrongs = CARDINAL_NUMBER_STRONGS[rawQuery.trim()];
  const conceptBoostStrongs = CONCEPT_PRIMARY_STRONGS[normQuery] || [];

  const candidateMap = new Map();
  const addHit = (bs, meta = {}) => {
    if (!bs || candidateMap.has(bs)) return;
    candidateMap.set(bs, {
      bs,
      cnt: Number(meta.cnt || 0),
      is_prop: Boolean(meta.is_prop),
    });
  };

  if (cardinalStrongs) {
    for (const s of cardinalStrongs) addHit(s, { cnt: Number.MAX_SAFE_INTEGER, is_prop: false });
  } else {
    for (const s of conceptBoostStrongs) addHit(s, { cnt: Number.MAX_SAFE_INTEGER, is_prop: false });
  }

  if (strongsNorm) {
    addHit(strongsNorm.padded, { cnt: Number.MAX_SAFE_INTEGER, is_prop: false });
    const sHits = await lookupFastIndexKey(ctx, strongsNorm.padded.toLowerCase());
    for (const h of sHits) addHit(h.bs, h);
  }

  const isAsciiSingleWord = !strongsNorm && !cardinalStrongs && Boolean(normQuery) && /^[a-z]+$/.test(normQuery);
  const morphKeys = normQuery ? buildMorphFallbacks(normQuery) : [];

  if (normQuery && !cardinalStrongs) {
    const initialHits = await lookupFastIndexKey(ctx, normQuery);
    for (const h of initialHits) addHit(h.bs, h);
    if (isAsciiSingleWord) {
      for (const mk of morphKeys.slice(0, 2)) {
        const mHits = await lookupFastIndexKey(ctx, mk);
        for (const h of mHits) addHit(h.bs, h);
      }
    } else if (initialHits.length === 0) {
      for (const mk of morphKeys) {
        const mHits = await lookupFastIndexKey(ctx, mk);
        if (mHits.length > 0) {
          for (const h of mHits) addHit(h.bs, h);
          break;
        }
      }
    }
  }

  if ((candidateMap.size === 0 || isAsciiSingleWord) && normQuery) {
    const conceptIdx = await ctx.loadJsonShard(ctx.env, `${FAST_R10_ASSET_BASE}/concept-index.json.gz`);
    const aliases = conceptIdx?.aliases || {};
    const keysToCheck = [normQuery, ...morphKeys];
    const words = normQuery.split(' ').filter(w => w.length >= 2);
    if (words.length > 1) {
      for (const w of words) {
        keysToCheck.push(w, ...buildMorphFallbacks(w));
      }
    }

    for (const k of keysToCheck) {
      const entry = aliases[k];
      if (!entry) continue;
      for (const s of entry.strongs || []) {
        const norm = normalizeStrongsBase(s);
        if (norm) addHit(norm.padded, { cnt: 0, is_prop: false });
      }
    }

    if (candidateMap.size === 0 && words.length > 1) {
      const tokenHitsList = await Promise.all(words.slice(0, 4).map(w => lookupFastIndexKey(ctx, w)));
      for (const th of tokenHitsList) {
        for (const h of th) addHit(h.bs, h);
      }
    }
  }

  if (candidateMap.size === 0 && isAsciiSingleWord) {
    const translitKeys = buildTranslitFallbacks(normQuery);
    for (const tk of translitKeys.slice(0, 6)) {
      const tHits = await lookupFastIndexKey(ctx, tk);
      if (tHits.length > 0) {
        for (const h of tHits) addHit(h.bs, h);
        break;
      }
    }
  }

  const maxLoadCandidates = 8;
  const sortedCandidateKeys = [...candidateMap.values()]
    .sort((a, b) => (Number(a.is_prop) - Number(b.is_prop)) || (b.cnt - a.cnt) || a.bs.localeCompare(b.bs))
    .slice(0, maxLoadCandidates)
    .map(c => c.bs);

  let loadedProfiles;
  if (ctx.v3Hooks?.getV3ProfilesBatch) {
    const batchMap = await ctx.v3Hooks.getV3ProfilesBatch(sortedCandidateKeys);
    loadedProfiles = await mapBatched(sortedCandidateKeys, 2, async (bs) => {
      const normBs = normStrongs4(bs) || bs;
      const hit = batchMap.get(normBs);
      if (hit) {
        return {
          ...hit,
          sc: sanitizeV3TokenLemma(normBs, hit.sc || ''),
          total_verses: hit.total_verses ?? hit.canonical_df ?? 0,
          senses: Array.isArray(hit.senses) ? hit.senses.map(s => ({ ...s, key: s.key || s.sense_id })) : [],
        };
      }
      return await loadFastProfileByStrongs(ctx, bs, { v3Only: true });
    });
  } else {
    loadedProfiles = await mapBatched(sortedCandidateKeys, 2, bs => loadFastProfileByStrongs(ctx, bs, { v3Only: true }));
  }
  const ranked = [];
  for (const prof of loadedProfiles) {
    if (!prof) continue;
    let effectiveProf = prof;
    if (strongsNorm?.suffix) {
      const targetSuffix = strongsNorm.suffix.toUpperCase();
      const targetSensePrefix = `sense:${strongsNorm.padded}${targetSuffix}:`.toLowerCase();
      const targetLemmaKey = `lemma:${strongsNorm.padded}${targetSuffix}`;
      const matchedSense = Array.isArray(prof.senses)
        ? prof.senses.find(s => String(s?.key || '').toLowerCase().startsWith(targetSensePrefix) || String(s?.lk || '').toLowerCase() === targetLemmaKey.toLowerCase())
        : null;
      if (matchedSense || String(prof.lk || '').toUpperCase() !== targetLemmaKey.toUpperCase()) {
        effectiveProf = {
          ...prof,
          lk: targetLemmaKey,
          ...(matchedSense?.gl ? { gl: matchedSense.gl } : {}),
        };
      }
    }
    let tier = scoreFastLookupMatch(effectiveProf, rawQuery, normQuery, strongsNorm);
    if (cardinalStrongs && cardinalStrongs.includes(String(effectiveProf.bs || ''))) {
      tier = 1.5;
    } else if (tier > 3.8 && conceptBoostStrongs.includes(String(effectiveProf.bs || ''))) {
      tier = 3.8;
    }
    const totalVerses = effectiveProf.total_verses ?? 0;
    const isProperPlace = effectiveProf.entity_kind === 'proper_place' ? 1 : 0;
    if (tier >= 5 && !isProperPlace && totalVerses >= 400) {
      tier = 5.8;
    } else if (tier >= 3 && tier !== 4 && tier !== 4.2 && tier !== 3.8 && (isProperPlace || /^[A-Z]/.test(String(effectiveProf.gl || ''))) && totalVerses < 10) {
      tier = 5.5;
    }
    ranked.push({
      tier,
      prof: effectiveProf,
      totalVerses,
      isProperPlace,
    });
  }

  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier >= 5 && a.isProperPlace !== b.isProperPlace) {
      return a.isProperPlace - b.isProperPlace;
    }
    if (a.totalVerses !== b.totalVerses) return b.totalVerses - a.totalVerses;
    if (a.isProperPlace !== b.isProperPlace) return a.isProperPlace - b.isProperPlace;
    return String(a.prof.bs || '').localeCompare(String(b.prof.bs || ''));
  });

  const matches = ranked.slice(0, limit).map(({ prof, tier }) => ({
    bs: prof.bs,
    lk: prof.lk,
    lang: prof.lang,
    sc: prof.sc,
    tr: prof.tr,
    gl: prof.gl,
    pos: prof.pos,
    entity_kind: prof.entity_kind,
    total_verses: prof.total_verses ?? 0,
    senses: Array.isArray(prof.senses) ? prof.senses : [],
    match_tier: tier,
  }));

  return {
    status: 'ok',
    query: rawQuery,
    matches,
  };
}

function sanitizePatternGloss(strongs, rawGloss) {
  const s = String(strongs || '').toUpperCase().replace(/^([HG])0*(\d+)[A-Z]*$/, (_, l, d) => `${l}${d.padStart(4, '0')}`);
  const gl = String(rawGloss || '');
  if (s === 'H2319' && /^new\s*\(/i.test(gl)) return 'new';
  if (s === 'H1540' && /^(?:heglam|הֶגְלָם)$/i.test(gl)) return 'uncover / reveal';
  if (s === 'H5158' && /\bpalm[- ]tree\b/i.test(gl)) return 'wadi / valley';
  return gl;
}

export async function handleDiscoverPatternsV1(ctx, params = {}) {
  const limit = params.limit !== undefined ? Math.min(25, Math.max(1, finiteOr(params.limit, 12))) : 12;
  const disc = await handleDiscoverBiblicalConnectionsV1(ctx, { ...params, limit });
  if (disc.status !== 'ok' && disc.status !== 'partial') {
    return {
      schema_version: 1,
      status: 'ok',
      release_id: disc.release_id,
      evidence_release_id: disc.evidence_release_id,
      query: String(params.query || ''),
      query_intent: disc.query_intent,
      parsed_query: disc.parsed_query,
      pattern_count: 0,
      patterns: [],
      network: {
        pattern_count: 0,
        node_count: 0,
        edge_count: 0,
        patterns: [],
      },
      strongest_connections: disc.strongest_connections || [],
      controls_and_alternatives: disc.controls_and_alternatives || [],
      warnings: ['No corpus-grounded pattern links found for query.'],
    };
  }

  const nodeCatalog = new Map();
  for (const rc of disc.parsed_query?.resolved_concepts || []) {
    for (const w of rc.lemmas || []) {
      const id = w.strongs ? `lemma:${w.strongs}` : (w.lemma_key || '');
      const cleanGloss = sanitizePatternGloss(w.strongs, w.gloss);
      if (id && !nodeCatalog.has(id)) {
        nodeCatalog.set(id, {
          id,
          label: `${w.lemma_script || id} (${cleanGloss})`.trim(),
          script: w.lemma_script,
          transliteration: w.transliteration,
          gloss: cleanGloss,
        });
      }
    }
  }
  const edges = [];
  for (const c of disc.strongest_connections || []) {
    for (const w of c.original_words || []) {
      const cleanGloss = sanitizePatternGloss(w.strongs, w.gloss);
      if (w.strongs && !nodeCatalog.has(`lemma:${w.strongs}`)) {
        nodeCatalog.set(`lemma:${w.strongs}`, {
          id: `lemma:${w.strongs}`,
          label: `${w.lemma_script || w.strongs} (${cleanGloss})`.trim(),
          script: w.lemma_script,
          transliteration: w.transliteration,
          gloss: cleanGloss,
        });
      }
    }
    const pRefs = (c.passages || []).map(p => p.ref).filter(Boolean);
    const fromNode = c.original_words?.[0]?.strongs
      ? `lemma:${c.original_words[0].strongs}`
      : (pRefs[0] ? `passage:${pRefs[0]}` : c.connection_id);
    const toNode = c.original_words?.[1]?.strongs
      ? `lemma:${c.original_words[1].strongs}`
      : (pRefs[pRefs.length - 1] && pRefs[pRefs.length - 1] !== pRefs[0]
          ? `passage:${pRefs[pRefs.length - 1]}`
          : (c.cluster_id || c.evidence_id));
    edges.push({
      evidence_id: c.evidence_id,
      evidence_type: c.evidence_type || c.predicate,
      epistemic_class: c.epistemic_class,
      tier: c.evidence_tier,
      from_node: fromNode,
      to_node: toNode,
      witness_refs: pRefs,
      summary: c.title,
      score: c.score,
      limitation: c.uncertainty_note,
    });
  }

  const anchors = [
    ...(Array.isArray(params.concepts) ? params.concepts.map(String) : []),
    ...((disc.parsed_query?.extracted_terms || []).slice(0, 6)),
  ];
  const patterns = synthesizeEvidencePatterns({
    anchors,
    edges,
    nodeCatalog,
    maxPatterns: Math.min(8, Math.max(3, limit)),
  });

  return {
    schema_version: 1,
    status: disc.status,
    release_id: disc.release_id,
    evidence_release_id: disc.evidence_release_id,
    query_intent: disc.query_intent,
    parsed_query: disc.parsed_query,
    network: {
      pattern_count: patterns.length,
      node_count: nodeCatalog.size,
      edge_count: edges.length,
      patterns,
    },
    strongest_connections: disc.strongest_connections,
    controls_and_alternatives: disc.controls_and_alternatives,
    pagination: disc.pagination,
  };
}

export async function handleComparePatternsV1(ctx, params = {}) {
  const targetsRaw = parseOptionalListParam(params.targets) || parseOptionalListParam(params.passages) || [];
  if (targetsRaw.length < 2) {
    return { schema_version: 1, status: 'invalid_request', error: 'At least 2 targets are required for compare_patterns.' };
  }
  const targets = targetsRaw.slice(0, 4);
  const reader = createWorkerR10Reader(ctx);
  const releaseId = params.release_id ? String(params.release_id).trim() : DEFAULT_R10_RELEASE;
  const limit = params.limit !== undefined ? Math.min(15, Math.max(3, finiteOr(params.limit, 8))) : 8;

  const perTarget = await Promise.all(
    targets.slice(0, 2).map(t => discoverBiblicalConnections(reader, { query: t, mode: 'compare', limit }, releaseId)),
  );
  const hasPassageTargets = targets.some(t => /\d+[:\-]\d+|\b(?:gen|exod|lev|num|deut|psa|ps|isa|jer|ezek|zec|zech|matt|john|rom|heb|rev)\b/i.test(t));
  const combinedQuery = hasPassageTargets ? targets.slice(0, 3).join(' ; ') : targets.slice(0, 3).join(' ');
  const combined = await discoverBiblicalConnections(reader, {
    query: combinedQuery,
    mode: 'compare',
    compare_targets: targets,
    limit,
  }, releaseId);

  const ALIGN_STOPWORDS = new Set([
    'H0853', 'H3068', 'H0413', 'H5921', 'H0834', 'H3588', 'H3605', 'H1961', 'H5973', 'H4480',
    'G3588', 'G0846', 'G1722', 'G2532', 'G1519', 'G3956', 'G1096', 'G2962', 'G3739', 'G3754',
  ]);
  const loadVerseBundle = async (vid) => {
    const hex = Math.floor((vid - 1) / 64).toString(16).padStart(3, '0');
    const chunk = await ctx.loadJsonShard(ctx.env, `${FAST_R10_ASSET_BASE}/fast-verses/chunk-${hex}.json.gz`);
    const vB64 = chunk?.verses?.[String(vid)];
    const verse = vB64 ? await decodeB64GzWithCtx(ctx, vB64, `/r10/v:${releaseId}:${vid}`) : null;
    const rawFrames = chunk?.frames?.[String(vid)] || [];
    const frames = rawFrames.map(([pred, subj, obj, other]) => ({
      pred: String(pred || ''),
      subj: Array.isArray(subj) ? subj : [],
      obj: Array.isArray(obj) ? obj : [],
      other: Array.isArray(other) ? other : [],
    }));
    return { verse, frames };
  };

  const eps0Raw = (perTarget[0]?.parsed_query?.explicit_passages || []).filter(e => e?.verse_id > 0);
  const eps1Raw = (perTarget[1]?.parsed_query?.explicit_passages || []).filter(e => e?.verse_id > 0);
  const expandTargetEpList = async (targetStr, fallbackEps) => {
    const parsedRange = parsePassageString(targetStr);
    if (!parsedRange?.passages?.length) return fallbackEps.slice(0, 12);
    const meta = await ctx.loadJsonShard(ctx.env, '/v1/catalog/metadata.json.gz').catch(() => null);
    if (!Array.isArray(meta?.verses_compact)) return fallbackEps.slice(0, 12);
    const matches = [];
    for (const row of meta.verses_compact) {
      const [vid, bk, ch, vs] = row;
      if (parsedRange.passages.some(sp => bk === sp.book && ch === sp.chapter && vs >= sp.start_verse && vs <= sp.end_verse)) {
        matches.push({ verse_id: vid, book: bk, chapter: ch, verse: vs, testament: bk >= 40 ? 'NT' : 'OT', ref: `${bk}:${ch}:${vs}` });
      }
    }
    if (matches.length <= 36) return matches.length > 0 ? matches : fallbackEps.slice(0, 12);
    return [...matches.slice(0, 16), ...matches.slice(-16)];
  };
  const [eps0, eps1] = await Promise.all([
    expandTargetEpList(targets[0], eps0Raw),
    expandTargetEpList(targets[1], eps1Raw),
  ]);
  const [bundles0, bundles1] = await Promise.all([
    Promise.all(eps0.map(e => loadVerseBundle(e.verse_id))),
    Promise.all(eps1.map(e => loadVerseBundle(e.verse_id))),
  ]);

  const lemmaSets = perTarget.map((r, idx) => {
    const out = new Set(
      (r.parsed_query?.resolved_concepts || [])
        .flatMap(rc => (rc.lemmas || []).map(l => l.strongs).filter(Boolean))
        .filter(s => !ALIGN_STOPWORDS.has(s) && !/^H90\d{2}$/.test(s)),
    );
    const bundles = idx === 0 ? bundles0 : bundles1;
    for (const b of bundles) {
      for (const tok of b.verse?.toks || []) {
        const s = tok?.s;
        if (s && !ALIGN_STOPWORDS.has(s) && !/^H90\d{2}$/.test(s)) out.add(s);
      }
    }
    return out;
  });
  const sharedLemmas = [...lemmaSets[0]].filter(s => lemmaSets[1]?.has(s));
  const motifSets = perTarget.map(r => new Set((r.related_discoveries?.additional_motifs || []).map(m => m.motif_id)));
  const sharedMotifs = [...motifSets[0]].filter(m => motifSets[1]?.has(m));

  const ep0 = eps0[0];
  const ep1 = eps1[0];
  let structuralAlignment = null;
  let crossTestamentAlignment = null;
  const tesseraeParallels = [];

  if (ep0?.verse_id > 0 && ep1?.verse_id > 0) {
    const b0 = bundles0[0];
    const b1 = bundles1[0];

    const otVerse = ep0.testament === 'OT' ? { ep: ep0, data: b0 } : (ep1.testament === 'OT' ? { ep: ep1, data: b1 } : null);
    const ntVerse = ep0.testament === 'NT' ? { ep: ep0, data: b0 } : (ep1.testament === 'NT' ? { ep: ep1, data: b1 } : null);
    const lxxEquivByBs = new Map();
    const dfMap = new Map();
    const lxxByBs = new Map();
    const rootsByBs = new Map();
    const topContentStrongs = [...new Set(
      [...bundles0.slice(0, 6), ...bundles1.slice(0, 6)]
        .flatMap(b => (b.verse?.toks || []).map(t => t?.s))
        .filter(s => s && !/^H90\d{2}$/.test(s) && !ALIGN_STOPWORDS.has(s)),
    )].slice(0, 20);
    if (topContentStrongs.length > 0) {
      const profs = await Promise.all(topContentStrongs.map(s => loadFastProfileByStrongs(ctx, s).catch(() => null)));
      for (const p of profs) {
        if (!p?.bs) continue;
        if (typeof p.total_verses === 'number' && p.total_verses > 0) dfMap.set(p.bs, p.total_verses);
        if (Array.isArray(p.lxx_relations) && p.lxx_relations.length > 0) {
          lxxByBs.set(p.bs, p.lxx_relations.map(x => x.target_strongs).filter(Boolean));
          if (p.bs.startsWith('H')) {
            lxxEquivByBs.set(p.bs, new Set(p.lxx_relations.map(x => x.target_strongs).filter(Boolean)));
          }
        }
        const roots = (p.lexical_relations || []).map(x => x?.root).filter(Boolean);
        if (roots.length > 0) rootsByBs.set(p.bs, [...new Set(roots.map(String))]);
      }
    }
    if (otVerse && ntVerse && otVerse.data.verse?.toks && ntVerse.data.verse?.toks) {
      const lxxForBipartite = new Map();
      const otTokensRaw = otVerse.data.verse.toks.filter(t => t.s && !/^H90\d{2}$/.test(t.s) && !ALIGN_STOPWORDS.has(t.s));
      for (const t of otTokensRaw) {
        const lxxList = lxxByBs.get(t.s);
        if (lxxList?.length && !lxxForBipartite.has(t.s)) {
          lxxForBipartite.set(t.s, lxxList.map(tb => ({ target_bs: tb, count: 1 })));
        }
      }
      const otTokens = otTokensRaw.map(t => ({ bs: t.s, script: t.lm || t.sf, gloss: t.g, idf: 2.5 }));
      const ntTokens = ntVerse.data.verse.toks.filter(t => t.s && !ALIGN_STOPWORDS.has(t.s)).map(t => ({ bs: t.s, script: t.lm || t.sf, gloss: t.g, idf: 2.5 }));
      crossTestamentAlignment = scoreCrossTestamentPair({
        sourceVid: otVerse.ep.verse_id,
        targetVid: ntVerse.ep.verse_id,
        sourceRef: otVerse.ep.ref,
        targetRef: ntVerse.ep.ref,
        otTokens,
        ntTokens,
        lxxEquivMap: lxxForBipartite,
      });
    }
    const buildTesseraeFeatures = (bundles) => {
      const out = [];
      let pos = 0;
      for (const b of bundles.slice(0, 8)) {
        for (const t of b.verse?.toks || []) {
          pos += 1;
          const s = t?.s;
          if (!s || /^H90\d{2}$/.test(s)) continue;
          const cl = String(t?.cl || '').toLowerCase();
          const isFunc = ['conj', 'prep', 'art', 'ptcl', 'pron', 'conjunction', 'preposition', 'article', 'particle', 'pronoun'].includes(cl) || ALIGN_STOPWORDS.has(s);
          out.push({
            position: pos,
            strongs: s,
            root_keys: rootsByBs.get(s),
            lxx_targets: lxxByBs.get(s),
            is_function_word: isFunc,
          });
        }
      }
      return out;
    };
    const tess0 = buildTesseraeFeatures(bundles0);
    const tess1 = buildTesseraeFeatures(bundles1);
    const tScore = scoreTesseraeParallel(tess0, tess1, dfMap);
    if (tScore.matched_features.length >= 2) {
      tesseraeParallels.push({
        from_passage: targets[0],
        to_passage: targets[1],
        score: tScore.score,
        normalized_score: tScore.normalized_score,
        rare_match_count: tScore.rare_match_count,
        source_span_distance: tScore.source_span_distance,
        target_span_distance: tScore.target_span_distance,
        matched_features: tScore.matched_features,
      });
    }
    const frames0 = bundles0.slice(0, 8).flatMap(b => b.frames || []);
    const frames1 = bundles1.slice(0, 8).flatMap(b => b.frames || []);
    if (frames0.length > 0 && frames1.length > 0) {
      structuralAlignment = compareStructuredRoleFrames(frames0, frames1, lxxEquivByBs);
    }
  }

  let v3SequenceAlignment = null;
  let v3TriTextualAlignment = null;
  if (ep0?.verse_id > 0 && ep1?.verse_id > 0) {
    try {
      const session = createV3SessionFromCtx(ctx);
      const [clA, clB] = await Promise.all([
        Promise.all(eps0.slice(0, 12).map(e => session.getVerseClauses(e.verse_id))).then(vs => vs.flatMap(buildClauseSigsFromV3Verse)),
        Promise.all(eps1.slice(0, 12).map(e => session.getVerseClauses(e.verse_id))).then(vs => vs.flatMap(buildClauseSigsFromV3Verse)),
      ]);
      if (clA.length >= 2 && clB.length >= 2) {
        v3SequenceAlignment = alignClauseSequencesPiecewise(clA, clB, { permutations: 32 });
      }
      if ((ep0.testament === 'OT' && ep1.testament === 'NT') || (ep0.testament === 'NT' && ep1.testament === 'OT')) {
        const ntList = ep0.testament === 'NT' ? eps0 : eps1;
        const otList = ep0.testament === 'OT' ? eps0 : eps1;
        const nodes = await session.getNodes();
        const ntV = await session.getVerse(ntList[0].verse_id);
        if (ntV) {
          const otGroups = (await Promise.all(otList.slice(0, 4).map(o => buildOtCandidateFromV3(session, o.verse_id, nodes)))).filter(Boolean);
          if (otGroups.length > 0) {
            v3TriTextualAlignment = alignTriTextualQuote(buildNtTokensFromV3Verse(ntV), otGroups);
          }
        }
      }
    } catch {
      // Non-fatal if v3 rhetoric/align unavailable
    }
  }

  return {
    schema_version: 1,
    status: 'ok',
    release_id: combined.release_id,
    evidence_release_id: combined.evidence_release_id,
    targets,
    shared_lemmas: sharedLemmas,
    shared_motifs: sharedMotifs,
    tesserae_parallels: tesseraeParallels,
    structural_role_alignment: structuralAlignment,
    cross_testament_alignment: crossTestamentAlignment,
    ...(v3SequenceAlignment ? { sequence_alignment: v3SequenceAlignment } : {}),
    ...(v3TriTextualAlignment ? { tri_textual_alignment: v3TriTextualAlignment } : {}),
    combined_connections: combined.strongest_connections || [],
    divergences_and_controls: [
      ...(perTarget[0]?.controls_and_alternatives || []),
      ...(perTarget[1]?.controls_and_alternatives || []),
      ...(combined.controls_and_alternatives || []),
    ].slice(0, 8),
  };
}

export async function handleDiscoverSubgraphV1(ctx, params = {}) {
  const reader = createWorkerR10Reader(ctx);
  const releaseId = params.release_id ? String(params.release_id).trim() : DEFAULT_R10_RELEASE;
  const rawAnchors =
    parseOptionalListParam(params.anchors) ||
    parseOptionalListParam(params.targets) ||
    parseOptionalListParam(params.items) ||
    parseOptionalListParam(params.concepts) ||
    (params.query ? String(params.query).split(/\s*[;|,]\s*|\s+\+\s+/).filter(Boolean) : []);
  return findConnectedSubgraph(reader, {
    anchors: rawAnchors,
    max_hops: params.max_hops !== undefined ? finiteOr(params.max_hops, 3) : 3,
    max_nodes: params.max_nodes !== undefined ? finiteOr(params.max_nodes, 60) : 60,
    max_edges: params.max_edges !== undefined ? finiteOr(params.max_edges, 110) : 110,
    include_exploratory: params.include_exploratory !== false,
    ...(params.include_v3_ppr !== undefined ? { include_v3_ppr: parseBoolParam(params.include_v3_ppr, false) } : {}),
    release_id: releaseId,
  });
}

export async function handleTraceEvidenceV1(ctx, params = {}) {
  const reader = createWorkerR10Reader(ctx);
  const releaseId = params.release_id ? String(params.release_id).trim() : DEFAULT_R10_RELEASE;
  const evidenceId = String(params.evidence_id || '').trim();
  const fromTarget = String(params.from || '').trim();
  const toTarget = String(params.to || '').trim();
  const queryInput = String(params.query || '').trim();

  if (evidenceId) {
    if (/^(?:v3:|passage_lxx:|passage_lex_bridge:|passage_root_bridge:|passage_root_wordplay:|shared_lemma|r13:proof:|ctrl:)/i.test(evidenceId)) {
      return await handleExpandClueV3(ctx, { expand_id: evidenceId, detail: 'evidence' });
    }
    const evRes = await getConnectionEvidence(reader, evidenceId, releaseId);
    if (evRes.status !== 'ok' || !evRes.evidence) return evRes;
    const motifsData = await ctx.loadJsonShard(ctx.env, `${FAST_R10_ASSET_BASE}/motifs-and-patterns.json.gz`);
    const linkedMotifs = new Set();
    for (const w of evRes.evidence.original_words || []) {
      for (const mid of motifsData?.r13_motifs_by_bs?.[w.strongs] || []) linkedMotifs.add(mid);
    }
    for (const p of evRes.evidence.passages || []) {
      for (const mid of motifsData?.r13_motifs_by_vid?.[String(p.verse_id)] || []) linkedMotifs.add(mid);
    }
    return {
      schema_version: 1,
      status: 'ok',
      release_id: evRes.release_id,
      evidence_release_id: evRes.evidence_release_id,
      evidence_id: evidenceId,
      evidence: evRes.evidence,
      passage_details: evRes.passage_details,
      connected_motif_ids: [...linkedMotifs].slice(0, 8),
      independent_witnesses: (evRes.evidence.provenance?.source_record_ids || []).slice(0, 10),
      counterexamples_and_limits: evRes.evidence.limitations || [],
      provenance: evRes.evidence.provenance,
    };
  }

  if (fromTarget && toTarget) {
    const maxHops = Math.min(4, Math.max(1, finiteOr(params.max_hops, 3)));
    const [fromVids, toVids, bridgeRes] = await Promise.all([
      resolvePassagesToVidsV3(ctx, { passage: fromTarget }),
      resolvePassagesToVidsV3(ctx, { passage: toTarget }),
      discoverBiblicalConnections(reader, {
        query: `${fromTarget} ; ${toTarget}`,
        concepts: [fromTarget, toTarget],
        compare_targets: [fromTarget, toTarget],
        mode: 'bridge',
        max_hops: maxHops,
        limit: Math.min(12, Math.max(3, finiteOr(params.limit, 8))),
      }, releaseId),
    ]);
    let pairWitness = null;
    if (fromVids.length > 0 && toVids.length > 0) {
      const session = createV3SessionFromCtx(ctx);
      const [fromVerses, toVerses] = await Promise.all([
        Promise.all(fromVids.slice(0, 4).map(v => session.getVerse(v))),
        Promise.all(toVids.slice(0, 4).map(v => session.getVerse(v))),
      ]);
      const fClean = fromVerses.filter(Boolean);
      const tClean = toVerses.filter(Boolean);
      const fStrongs = fClean.flatMap(v => (v.toks || []).filter(t => !t.is_func && t.s).map(t => normStrongs4(t.s)).filter(Boolean));
      const tStrongs = tClean.flatMap(v => (v.toks || []).filter(t => !t.is_func && t.s).map(t => normStrongs4(t.s)).filter(Boolean));
      const [ePerp, pivots] = await Promise.all([
        scoreV3EPerpPair(session, fromVids.slice(0, 4), fStrongs, toVids.slice(0, 4), tStrongs),
        findV3BridgePivots(session, [
          { vids: fromVids.slice(0, 4), strongs: fStrongs.slice(0, 8) },
          { vids: toVids.slice(0, 4), strongs: tStrongs.slice(0, 8) },
        ], 5),
      ]);
      const toVidSet = new Set(toVids);
      const fromVidSet = new Set(fromVids);
      const directXrefs = [
        ...fClean.flatMap(v => (v.xrefs || []).filter(x => toVidSet.has(Number(x.to_vid))).map(x => ({ from: v.ref, to: x.to_ref, phrase: x.phrase, score: x.score }))),
        ...tClean.flatMap(v => (v.xrefs || []).filter(x => fromVidSet.has(Number(x.to_vid))).map(x => ({ from: v.ref, to: x.to_ref, phrase: x.phrase, score: x.score }))),
      ];
      pairWitness = {
        from_verses: fClean.map(v => ({ vid: v.vid, ref: v.ref, en: v.en })),
        to_verses: tClean.map(v => ({ vid: v.vid, ref: v.ref, en: v.en })),
        ...(ePerp ? { e_perp: ePerp } : {}),
        ...(directXrefs.length ? { direct_xrefs: directXrefs } : {}),
        ...(pivots.length ? { bridge_pivots: pivots.slice(0, 4) } : {}),
      };
    }
    const resolvedStatus = pairWitness && (pairWitness.direct_xrefs?.length || (pairWitness.e_perp?.ePerpBits ?? 0) > 0)
      ? 'ok'
      : bridgeRes.status;
    return {
      schema_version: 1,
      status: resolvedStatus,
      release_id: bridgeRes.release_id,
      evidence_release_id: bridgeRes.evidence_release_id,
      from: fromTarget,
      to: toTarget,
      max_hops: maxHops,
      ...(pairWitness ? { pair_witness: pairWitness } : {}),
      connection_paths: bridgeRes.connection_paths,
      strongest_connections: bridgeRes.strongest_connections,
      counterexamples_and_limits: bridgeRes.controls_and_alternatives,
    };
  }

  // Passage trace_evidence support (v3 verses + clauses + mt-lxx shifts + rhetoric hits + discovery trace)
  const passageInput = String(params.passage || params.ref || (!toTarget ? fromTarget : '') || queryInput || '').trim();
  const hasCoords = params.book != null && params.chapter != null && params.verse != null;
  const hasVid = params.verse_id != null;
  if (passageInput || hasCoords || hasVid) {
    const vids = await resolvePassagesToVidsV3(ctx, {
      ...(passageInput ? { passage: passageInput } : {}),
      ...(hasCoords ? { book: params.book, chapter: params.chapter, verse: params.verse } : {}),
      ...(hasVid ? { verse_id: params.verse_id } : {}),
    });
    if (vids.length === 0) {
      if (queryInput) {
        const discRes = await discoverBiblicalConnections(reader, {
          query: queryInput,
          mode: 'discover',
          limit: Math.min(12, Math.max(3, finiteOr(params.limit, 8))),
        }, releaseId);
        return {
          schema_version: 1,
          status: discRes.status,
          release_id: discRes.release_id,
          evidence_release_id: discRes.evidence_release_id,
          query: queryInput,
          connection_paths: discRes.connection_paths,
          strongest_connections: discRes.strongest_connections,
          counterexamples_and_limits: discRes.controls_and_alternatives,
        };
      }
      return { schema_version: 1, status: 'passage_not_found', error: 'Requested passage could not be resolved.' };
    }
    const session = createV3SessionFromCtx(ctx);
    const primaryVid = vids[0];
    const primaryBook = ctx.getVerseById?.(primaryVid)?.book || bookForVidV3(primaryVid);
    let [v3Verse, v3Clauses, mtLxx, rhetoricIdx] = await Promise.all([
      session.getVerse(primaryVid),
      session.getVerseClauses(primaryVid),
      session.getMtLxx(primaryVid),
      session.getRhetoricBook(primaryBook),
    ]);
    if (!rhetoricIdx) {
      rhetoricIdx = await session.getRhetoricIndex();
    }
    const refLabel = v3Verse?.ref || passageInput || `Verse ${primaryVid}`;
    const discRes = await discoverBiblicalConnections(reader, {
      query: refLabel,
      mode: 'discover',
      limit: Math.min(12, Math.max(3, finiteOr(params.limit, 8))),
    }, releaseId);
    const vidSet = new Set(vids);
    const talionHits = (rhetoricIdx?.syntactic_talion_hits || []).filter(h => vidSet.has(Number(h.vid)));
    const onomHits = (rhetoricIdx?.onomastic_valence_hits || []).filter(h =>
      h.proper_ref === refLabel || h.target_ref === refLabel
    );
    return {
      schema_version: 1,
      status: 'ok',
      release_id: discRes.release_id,
      evidence_release_id: discRes.evidence_release_id,
      passage: refLabel,
      verse_id: primaryVid,
      verse_details: v3Verse,
      clauses: v3Clauses?.clauses || v3Verse?.clauses || [],
      lxx_shifts: mtLxx?.shifts || [],
      rhetoric_hits: { syntactic_talion: talionHits, onomastic_valence: onomHits },
      connection_paths: discRes.connection_paths,
      strongest_connections: discRes.strongest_connections,
      counterexamples_and_limits: discRes.controls_and_alternatives,
    };
  }

  return {
    schema_version: 1,
    status: 'invalid_request',
    error: 'Provide evidence_id, passage/query, or both from and to targets.',
  };
}

async function loadLiteraryVersesFromV3Chunks(ctx, coords, maxVerses = 200) {
  const seenVid = new Set();
  const ordered = [];
  let truncated = false;

  for (const c of coords) {
    const startV = Math.max(1, Number(c.start_verse ?? 1));
    const endV = Math.min(176, Number(c.end_verse ?? startV));
    for (let v = startV; v <= endV; v++) {
      const vid = typeof ctx.getVerseIdByCoord === 'function'
        ? ctx.getVerseIdByCoord(`${c.book}:${c.chapter}:${v}`)
        : null;
      if (!vid || seenVid.has(vid)) continue;
      if (ordered.length >= maxVerses) {
        truncated = true;
        break;
      }
      seenVid.add(vid);
      const meta = ctx.getVerseById?.(vid) || { id: vid, book: c.book, chapter: c.chapter, verse_nr: v };
      ordered.push({ vid, meta });
    }
    if (truncated) break;
  }

  if (ordered.length === 0) return { verses: [], truncated };

  let v3VerseById = new Map();
  if (ctx.v3Hooks?.getV3VersesBatch) {
    v3VerseById = await ctx.v3Hooks.getV3VersesBatch(ordered.map(o => o.vid));
  } else {
    const chunkIds = [...new Set(ordered.map((o) => v3VerseChunkId(o.vid)))];
    const chunkById = new Map();
    await Promise.all(
      chunkIds.map(async (cid) => {
        const ch = ctx.v3Hooks?.getV3VerseChunk
          ? await ctx.v3Hooks.getV3VerseChunk(cid)
          : await ctx.loadJsonShard(ctx.env, `/v3/verses/chunk-${String(cid).padStart(2, '0')}.json.gz`);
        if (ch) chunkById.set(cid, ch);
      }),
    );
    for (const { vid } of ordered) {
      const ch = chunkById.get(v3VerseChunkId(vid));
      const v3Verse = ch?.verses?.[String(vid)] || null;
      if (v3Verse) v3VerseById.set(vid, v3Verse);
    }
  }

  const verses = [];
  for (const { vid, meta } of ordered) {
    const v3Verse = v3VerseById.get(vid) || null;
    if (!v3Verse || !Array.isArray(v3Verse.toks)) continue;
    const cleanToks = repairV3VerseToks({ ...v3Verse, vid, book: meta.book });
    verses.push({
      verse_id: vid,
      book: meta.book,
      chapter: meta.chapter,
      verse_nr: meta.verse_nr,
      tokens: cleanToks.map((tok, i) => {
        const strongs = paddedStrongs(tok.s) || '';
        const cleanLemma = tok.lm != null ? sanitizeV3TokenLemma(strongs, String(tok.lm)) : '';
        return {
          word_position: Number(tok.wn ?? (tok.idx ?? i) + 1),
          word_id: Number(tok.wid ?? 0),
          surface_form: String(tok.sf ?? ''),
          base_strongs: strongs,
          lemma_key: String(tok.lk || (strongs ? `lemma:${strongs}` : '')),
          lemma_script: cleanLemma || String(tok.sf ?? ''),
          gloss: String(tok.g ?? ''),
          pos_class: String(tok.cl ?? ''),
          grammar_code: String(tok.gc ?? ''),
          ...(tok.person != null ? { person: String(tok.person) } : {}),
        };
      }),
      ...(v3Verse.en ? { english_editions: { BSB: String(v3Verse.en) } } : {}),
    });
  }
  return { verses, truncated };
}

export async function handleGetLiterarySourceV1(ctx, params = {}) {
  await ctx.ensureCatalog();

  let coords = normalizePassageCoords({
    passages: parseJsonOrArrayParam(params.passages),
    book: params.book ?? params.p_book,
    chapter: params.chapter ?? params.p_chapter,
    verse: params.verse,
    start_verse: params.start_verse,
    end_verse: params.end_verse,
  });

  if (coords.length === 0 && typeof params.passage === 'string' && params.passage.trim()) {
    const parsedPassage = parsePassageString(params.passage.trim());
    if (parsedPassage?.passages?.length) {
      coords = normalizePassageCoords({ passages: parsedPassage.passages });
    }
  }

  if (coords.length === 0) {
    const rawIds = Array.isArray(params.verse_ids)
      ? params.verse_ids
      : typeof params.verse_ids === 'string'
        ? params.verse_ids.split(',').map((x) => Number(x.trim()))
        : [];
    const perChapter = new Map();
    for (const rawId of rawIds) {
      const m = ctx.getVerseById(Number(rawId));
      if (!m) continue;
      const ck = `${m.book}:${m.chapter}`;
      const prev = perChapter.get(ck);
      if (!prev) {
        perChapter.set(ck, { book: m.book, chapter: m.chapter, start_verse: m.verse_nr, end_verse: m.verse_nr });
      } else {
        prev.start_verse = Math.min(prev.start_verse, m.verse_nr);
        prev.end_verse = Math.max(prev.end_verse, m.verse_nr);
      }
    }
    coords = [...perChapter.values()];
  }

  if (coords.length === 0) {
    return { schema_version: 1, status: 'passage_not_found', error: 'No matching canonical verses found.' };
  }

  let conceptAliases = undefined;
  const packLoader = typeof ctx.loadLiteraryPack === 'function'
    ? ctx.loadLiteraryPack(coords)
    : (async () => {
        const v3Res = await loadLiteraryVersesFromV3Chunks(ctx, coords);
        if (v3Res.verses.length > 0) return v3Res;
        return loadLiteraryVersesFromPack(defaultLiteraryPackBaseUrl(), coords);
      })();

  const [packResult] = await Promise.all([
    packLoader,
    (async () => {
      try {
        const conceptIndex = await ctx.loadJsonShard(ctx.env, `${FAST_R10_ASSET_BASE}/concept-index.json.gz`);
        if (conceptIndex?.aliases) conceptAliases = conceptIndex.aliases;
      } catch {
        /* Concept index optional. */
      }
    })(),
  ]);

  const { verses, truncated } = packResult;
  if (!verses.length) {
    return { schema_version: 1, status: 'unavailable', error: 'Literary chunks unavailable for requested passage.' };
  }

  const passageLabel =
    typeof params.passage === 'string' && params.passage.trim()
      ? params.passage.trim()
      : `${verses[0].book}:${verses[0].chapter}:${verses[0].verse_nr}-${verses[verses.length - 1].verse_nr}`;

  return {
    schema_version: 1,
    status: 'ok',
    passage: passageLabel,
    truncated,
    ...(conceptAliases ? { conceptAliases } : {}),
    verses,
  };
}

export async function handleAnalyzeLiteraryStructureV1(ctx, params = {}) {
  const source = await handleGetLiterarySourceV1(ctx, params);
  if (source.status !== 'ok') return source;

  const compareLxx = parseBoolParam(params.compare_lxx, false);
  const detail = ['compact', 'standard', 'deep'].includes(String(params.detail))
    ? String(params.detail)
    : 'standard';

  const analysis = analyzeLiteraryPassage(
    {
      passage: source.passage,
      verses: source.verses,
      r13: source.conceptAliases ? { conceptAliases: source.conceptAliases } : undefined,
      truncated: source.truncated,
    },
    {
      detail,
      categories: Array.isArray(params.categories) ? params.categories.map(String) : undefined,
      compareLxx,
      includeAlternatives: parseBoolParam(params.include_alternatives, detail !== 'compact'),
      minStrength: params.min_strength !== undefined ? Number(params.min_strength) : 0,
      maxDepth: params.max_depth !== undefined ? Number(params.max_depth) : 3,
    }
  );

  return {
    status: 'ok',
    ...analysis,
  };
}

// ============================================================================
// BibleResearch v3 RPC Handlers (S4)
// ============================================================================

async function handleQueryRelationshipsV2V3Fallback(ctx, params = {}) {
  const session = createV3SessionFromCtx(ctx);
  const rawOp = String(params.op || '').trim().toLowerCase() || (
    params.query || params.lemma_id || params.p_lemma_key ? 'lemma_relationships' :
    (params.book != null && params.chapter != null && params.verse != null ? 'passage_frames' : 'coverage')
  );
  const baseEnvelope = {
    schema_version: '3.0',
    release_version: 'v3',
    epistemic_layer: 'static_source_evidence',
  };
  if (rawOp === 'coverage') {
    const manifest = ctx.loadJsonShard ? await ctx.loadJsonShard(ctx.env, '/v3/manifest.json') : null;
    return { ...baseEnvelope, status: 'ok', manifest_counts: manifest?.graph || null };
  }
  if (rawOp === 'passage' || rawOp === 'passage_frames') {
    const vids = await resolvePassagesToVidsV3(ctx, { book: params.book, chapter: params.chapter, verse: params.verse });
    if (vids.length === 0) return { ...baseEnvelope, status: 'not_found', frames: [], relations: [] };
    const cv = await session.getVerseClauses(vids[0]);
    return {
      ...baseEnvelope,
      status: 'ok',
      canonical_reference: { book: Number(params.book), chapter: Number(params.chapter), verse: Number(params.verse), ref: cv?.ref || '' },
      frames: cv?.clauses || [],
      relations: [],
    };
  }
  const q = String(params.query || params.lemma_id || params.p_lemma_key || '').trim();
  const bs = normStrongs4(q);
  const prof = bs ? await session.getProfile(bs) : null;
  if (!prof) return { ...baseEnvelope, status: 'not_found', focus: null, summaries: [], relations: [] };
  if (rawOp === 'resolve') {
    return { ...baseEnvelope, status: 'ok', lemma_id: prof.lk, profile: prof, homograph_siblings: [] };
  }
  return {
    ...baseEnvelope,
    status: 'ok',
    focus: prof,
    summaries: prof.grammatical_relations || [],
    relations: prof.lexical_relations || [],
    lxx_relations: prof.lxx_relations || [],
  };
}

function stripGreekDiacriticsV3(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .normalize('NFC')
    .trim();
}

function normalizeBmwKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('c:') || s.startsWith('lxx:') || s.startsWith('role:')) return s;
  if (/^C_XL:\d+$/i.test(s)) return `c:${s.toUpperCase()}`;
  const hashSplit = /^([HGhg]0*\d+)#(.+)$/.exec(s);
  if (hashSplit) {
    const bs = normStrongs4(hashSplit[1]);
    return bs ? `${bs}#${hashSplit[2]}` : s;
  }
  const bs = normStrongs4(s);
  return bs || s;
}

const BOOK_VID_STARTS_V3 = [
  1, 1534, 2747, 3606, 4894, 5853, 6511, 7129, 7214, 8024,
  8719, 9535, 10254, 11196, 12018, 12298, 12704, 12871, 13941, 16518,
  17433, 17655, 17772, 19064, 20428, 20582, 21855, 22212, 22409, 22482,
  22628, 22649, 22697, 22802, 22849, 22905, 22958, 22996, 23207, 23262,
  24330, 25003, 26152, 27030, 28033, 28465, 28902, 29158, 29307, 29462,
  29566, 29661, 29750, 29797, 29910, 29993, 30039, 30064, 30367, 30475,
  30580, 30641, 30746, 30759, 30774, 30799,
];

function bookForVidV3(vid) {
  for (let i = BOOK_VID_STARTS_V3.length - 1; i >= 0; i--) {
    if (vid >= BOOK_VID_STARTS_V3[i]) return i + 1;
  }
  return 1;
}

const PASSAGE_VIDS_CACHE = new Map();

async function resolvePassagesToVidsV3(ctx, params = {}) {
  const refOnly = params.verse_id == null && params.verse_ids == null && params.book == null && params.p_book == null
    ? String(params.passage || params.ref || '').trim()
    : '';
  if (refOnly && PASSAGE_VIDS_CACHE.has(refOnly)) {
    return PASSAGE_VIDS_CACHE.get(refOnly);
  }
  if (typeof ctx.ensureCatalog === 'function') {
    await ctx.ensureCatalog();
  }
  let catalogCoordFn = typeof ctx.getVerseIdByCoord === 'function' ? ctx.getVerseIdByCoord : null;
  if (!catalogCoordFn && typeof ctx.loadJsonShard === 'function') {
    const cat = await ctx.loadJsonShard(ctx.env, '/v1/catalog/metadata.json.gz').catch(() => null);
    if (Array.isArray(cat?.verses_compact)) {
      const m = new Map();
      for (const [id, b, c, v] of cat.verses_compact) m.set(`${b}:${c}:${v}`, id);
      catalogCoordFn = (coord) => m.get(coord) ?? null;
    }
  }

  const vids = [];
  const seen = new Set();
  const addVid = (v) => {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= NUM_VERSES && !seen.has(n)) {
      seen.add(n);
      vids.push(n);
    }
  };

  if (params.verse_id != null) addVid(params.verse_id);
  const rawIds = parseJsonOrArrayParam(params.verse_ids);
  for (const id of rawIds) addVid(id);
  if (typeof params.verse_ids === 'string' && !params.verse_ids.trim().startsWith('[')) {
    for (const part of params.verse_ids.split(',')) addVid(part.trim());
  }

  const book = params.book ?? params.p_book;
  const chapter = params.chapter ?? params.p_chapter;
  const verse = params.verse ?? params.p_verse;
  if (book != null && chapter != null && catalogCoordFn) {
    const b = Number(book);
    const c = Number(chapter);
    if (params.start_verse != null || params.end_verse != null) {
      const sv = Math.max(0, Number(params.start_verse ?? verse ?? 1));
      const ev = Math.min(200, Math.max(sv, Number(params.end_verse ?? sv)));
      for (let v = sv; v <= ev; v++) {
        const vid = catalogCoordFn(`${b}:${c}:${v}`);
        if (vid) addVid(vid);
      }
    } else if (verse != null) {
      const vid = catalogCoordFn(`${b}:${c}:${Number(verse)}`);
      if (vid) addVid(vid);
    } else {
      for (let v = 0; v <= 200; v++) {
        const vid = catalogCoordFn(`${b}:${c}:${v}`);
        if (vid) addVid(vid);
      }
    }
  }

  const refStr = String(params.passage || params.ref || '').trim();
  if (refStr && vids.length === 0) {
    if (/^\d+$/.test(refStr)) {
      addVid(Number(refStr));
    } else if (catalogCoordFn) {
      const parsed = parsePassageString(refStr);
      for (const sp of parsed?.passages || []) {
        const sv = Math.max(0, Number(sp.start_verse ?? 1));
        const ev = Math.min(200, Math.max(sv, Number(sp.end_verse ?? sv)));
        for (let v = sv; v <= ev; v++) {
          const vid = catalogCoordFn(`${sp.book}:${sp.chapter}:${v}`);
          if (vid) addVid(vid);
        }
      }
    }
  }
  if (refOnly && vids.length > 0) {
    if (PASSAGE_VIDS_CACHE.size >= 512) PASSAGE_VIDS_CACHE.clear();
    PASSAGE_VIDS_CACHE.set(refOnly, vids);
  }
  return vids;
}

const GREEK_LXX_EQUIV_STOPWORDS = new Set(
  ['καί', 'δέ', 'γάρ', 'ὁ', 'μή', 'οὐ', 'ὅτι', 'εἰμί', 'αὐτός', 'σύ', 'ἐγώ', 'ὅς', 'οὗτος', 'ὡς', 'τε', 'ἀλλά', 'ἤ', 'οὖν']
    .map(stripGreekDiacriticsV3),
);

function stripGreekDiacriticsKeepCaseV3(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ς/g, 'σ')
    .normalize('NFC')
    .trim();
}

function lookupLxxBmwTerm(bmw, lemma) {
  if (!bmw || !lemma) return null;
  const nfc = String(lemma).normalize('NFC').trim();
  if (!nfc) return null;
  const tryKey = (k) => {
    const t = lookupTerm(bmw, k);
    return t ? { key: k, term: t } : null;
  };
  const direct = tryKey(`lxx:${nfc}`);
  if (direct) return direct;
  const nfkc = nfc.normalize('NFKC');
  if (nfkc !== nfc) {
    const t2 = tryKey(`lxx:${nfkc}`);
    if (t2) return t2;
  }
  const keepCase = stripGreekDiacriticsKeepCaseV3(nfc);
  if (keepCase && keepCase !== nfc) {
    const t3 = tryKey(`lxx:${keepCase}`);
    if (t3) return t3;
  }
  const plain = stripGreekDiacriticsV3(nfc);
  if (plain && plain !== keepCase) {
    const t4 = tryKey(`lxx:${plain}`);
    if (t4) return t4;
  }
  return null;
}

function formatVidLabelV3(ctx, vid) {
  const m = ctx.getVerseById?.(vid);
  if (m && m.book && m.chapter && m.verse_nr != null) {
    return formatRef(m.book, m.chapter, m.verse_nr);
  }
  return m?.ref || `Verse ${vid}`;
}

/**
 * 1. lxx_concordance_v3
 * Query Rahlfs 1935 concordance & MT<->LXX alignments + LxxTranslationShift.
 */
export async function handleLxxConcordanceV3(ctx, params = {}) {
  const session = createV3SessionFromCtx(ctx);
  const limit = clampLimit(params.limit, 25);
  const offset = Math.max(0, Math.floor(Number(params.offset || 0)));
  const shiftTypeRaw = params.shift_type ? String(params.shift_type).trim() : null;
  const shiftType = shiftTypeRaw && shiftTypeRaw !== 'LxxTranslationShift' && shiftTypeRaw !== 'all' && shiftTypeRaw !== '*'
    ? shiftTypeRaw
    : null;
  const wantAnyShift = Boolean(shiftTypeRaw);

  const vids = await resolvePassagesToVidsV3(ctx, params);
  if (vids.length > 0) {
    const includeSwete = parseBoolParam(params.include_swete, false);
    const rangeCap = Math.min(30, Math.max(1, finiteOr(params.limit, 24)));
    const pagedVids = vids.slice(offset, offset + rangeCap);
    const remainingVids = vids.slice(offset + pagedVids.length);
    const [mtLxxMap, v3VerseMap] = await Promise.all([
      session.getMtLxxBatch(pagedVids),
      session.getVersesBatch(pagedVids),
    ]);
    let sweteByVid = null;
    if (includeSwete && typeof ctx.ensureCatalog === 'function' && typeof ctx.loadJsonShard === 'function') {
      sweteByVid = new Map();
      const cat = await ctx.ensureCatalog();
      const lxxBookByCanon = new Map();
      for (const lb of cat?.lxx_swete_books || []) {
        if (lb?.canonical_book != null && lb?.book_no != null) {
          lxxBookByCanon.set(Number(lb.canonical_book), Number(lb.book_no));
        }
      }
      const bookNosNeeded = new Set();
      for (const vid of pagedVids) {
        const meta = ctx.getVerseById?.(vid);
        const lbNo = meta ? lxxBookByCanon.get(Number(meta.book)) : null;
        if (lbNo) bookNosNeeded.add(lbNo);
      }
      const sweteShards = new Map();
      await Promise.all([...bookNosNeeded].map(async (bNo) => {
        const sh = await ctx.loadJsonShard(ctx.env, `/v1/lxx/b${bNo}.json.gz`).catch(() => null);
        if (sh) sweteShards.set(bNo, sh);
      }));
      for (const vid of pagedVids) {
        const meta = ctx.getVerseById?.(vid);
        const lbNo = meta ? lxxBookByCanon.get(Number(meta.book)) : null;
        const sh = lbNo ? sweteShards.get(lbNo) : null;
        if (!meta || !sh) continue;
        const m = (sh.versification_mappings || []).find(x => Number(x.canonical_verse_id) === vid);
        const ch = m ? Number(m.lxx_chapter) : Number(meta.chapter);
        const vs = m ? Number(m.lxx_verse_nr) : Number(meta.verse_nr);
        const chSuf = m?.lxx_chapter_suffix || '';
        const vsSuf = m?.lxx_verse_suffix || '';
        const words = (sh.words || [])
          .filter(w => !w.is_chapter_heading_marker && w.chapter === ch && (w.chapter_suffix || '') === chSuf && w.verse_nr === vs && (w.verse_suffix || '') === vsSuf)
          .map(w => w.word_text);
        if (words.length > 0) {
          sweteByVid.set(vid, { lxx_book_no: lbNo, lxx_ref: `${ch}${chSuf}:${vs}${vsSuf}`, words });
        }
      }
    }
    const alignments = [];
    for (const vid of pagedVids) {
      const mtLxx = mtLxxMap.get(vid);
      if (!mtLxx) continue;
      const v3Verse = v3VerseMap.get(vid);
      const shifts = shiftType ? (mtLxx.shifts || []).filter(s => s.type === shiftType) : (mtLxx.shifts || []);
      const cleanToks = v3Verse ? repairV3VerseToks({ ...v3Verse, vid }) : [];
      const sweteHit = sweteByVid?.get(vid) || null;
      alignments.push({
        vid,
        ref: v3Verse?.ref || mtLxx.ref,
        grk_book: mtLxx.grk_book,
        grk_refs: mtLxx.grk_refs,
        links: mtLxx.links || [],
        shifts,
        grk_tokens: mtLxx.grk_tokens || [],
        mt_tokens: cleanToks.map(t => ({
          idx: t.idx,
          sf: t.sf,
          lm: sanitizeV3TokenLemma(normStrongs4(t.s) || '', String(t.lm || '')),
          s: t.s,
          g: t.g,
        })),
        ...(sweteHit ? { swete_witness: sweteHit } : {}),
      });
    }
    const sweteAttached = Boolean(includeSwete && alignments.some(a => a.swete_witness));
    const remainingRefs = remainingVids.slice(0, 30).map(v => formatVidLabelV3(ctx, v));
    return {
      schema_version: 3,
      status: alignments.length > 0 ? 'ok' : 'not_found',
      mode: 'passage_alignment',
      license: sweteAttached
        ? 'CC BY 4.0 (OpenScriptorium/lxx-morph Rahlfs 1935) + CC BY-SA 4.0 (Swete LXX runtime witness)'
        : 'CC BY 4.0 (OpenScriptorium/lxx-morph Rahlfs 1935)',
      swete_included: sweteAttached,
      total_verses: vids.length,
      returned_verses: alignments.length,
      truncated: offset + pagedVids.length < vids.length,
      remaining_refs: remainingRefs,
      alignments,
    };
  }

  const rawWordOrStrongs = String(params.strongs || '').trim()
    || (/^[HG]0*\d+[A-Z]?$/i.test(String(params.word || '').trim()) ? String(params.word || '').trim() : '');
  const strongsInput = normStrongs4(rawWordOrStrongs);
  let greekLemma = String(params.lemma || (strongsInput ? '' : params.word) || '').normalize('NFKC').trim();
  let profileSummary = null;
  let mtEquivalents = [];

  if (strongsInput) {
    const prof = await session.getProfile(strongsInput);
    if (prof) {
      const rawEquivs = Array.isArray(prof.lxx_equivalents) ? prof.lxx_equivalents : [];
      const contentEquivs = rawEquivs.filter(e => !isLxxFunctionEquivalent(null, e?.g_lemma));
      const rankedEquivs = contentEquivs
        .slice()
        .sort((a, b) => Number(b?.count || 0) - Number(a?.count || 0));
      if (strongsInput.startsWith('G')) {
        const cleanRels = rankAndFilterLxxRelations(strongsInput, prof.lxx_relations, []);
        mtEquivalents = cleanRels
          .filter(r => r.target_strongs && String(r.target_strongs).startsWith('H'))
          .slice(0, 10)
          .map(r => ({ strongs: r.target_strongs, script: r.script, gloss: r.gloss, count: r.count, source: r.type }));
        if (!greekLemma && prof.sc) {
          greekLemma = String(prof.sc).normalize('NFKC').trim();
        }
      } else if (!greekLemma && rankedEquivs[0]?.g_lemma) {
        greekLemma = String(rankedEquivs[0].g_lemma).normalize('NFKC').trim();
      }
      profileSummary = {
        bs: prof.bs,
        sc: sanitizeV3TokenLemma(strongsInput, String(prof.sc || '')),
        gl: prof.gl,
        lxx_equivalents: rankedEquivs,
        ...(mtEquivalents.length > 0 ? { mt_equivalents: mtEquivalents } : {}),
        lxx_shifts: shiftType
          ? (prof.lxx_shifts || []).filter(s => s.type === shiftType)
          : (prof.lxx_shifts || []),
      };
    }
  }

  let concEntry = greekLemma ? await session.getRahlfsConcordance(greekLemma.normalize('NFKC')) : null;
  if (!concEntry && greekLemma) {
    const nfc = greekLemma.normalize('NFC');
    if (nfc !== greekLemma.normalize('NFKC')) {
      concEntry = await session.getRahlfsConcordance(nfc);
      if (concEntry) greekLemma = nfc;
    }
  }
  if (!concEntry && greekLemma) {
    // Diacritic-insensitive fallback via nodes.bin / nodes.json.gz lxx:* keys
    const nodes = await session.getNodes();
    const targetPlain = stripGreekDiacriticsV3(greekLemma);
    if (targetPlain) {
      const lxxKeys = nodes?._bin
        ? nodes._bin.keysWithPrefix('lxx:').map(([k]) => k)
        : Object.keys(nodes?.key_to_id || {}).filter(k => k.startsWith('lxx:'));
      for (const k of lxxKeys) {
        const cand = k.slice(4);
        if (stripGreekDiacriticsV3(cand) === targetPlain) {
          const hit = await session.getRahlfsConcordance(cand);
          if (hit) {
            greekLemma = cand;
            concEntry = hit;
            break;
          }
        }
      }
    }
  }

  if (!concEntry && !profileSummary) {
    return {
      schema_version: 3,
      status: 'not_found',
      error: 'Provide passage, verse_id, strongs, or Greek lemma/word for Rahlfs LXX concordance lookup.',
    };
  }

  const allVerses = concEntry?.verses || [];
  const pagedVerses = allVerses.slice(offset, offset + limit);
  const remainingRefs = allVerses
    .slice(offset + pagedVerses.length, offset + pagedVerses.length + 24)
    .map(v => (v.vid > 0 ? formatVidLabelV3(ctx, v.vid) : `${v.b} ${v.r}`));

  // If G... strongs had empty lxx_relations in v3/profiles, sample MT alignments from canonical Rahlfs hits
  if (strongsInput.startsWith('G') && mtEquivalents.length === 0 && allVerses.length > 0 && greekLemma) {
    const targetPlain = stripGreekDiacriticsV3(greekLemma);
    const canonVids = allVerses.filter(v => v.vid > 0).slice(0, 6).map(v => v.vid);
    const mtMap = await session.getMtLxxBatch(canonVids);
    const mtEntries = canonVids.map(v => mtMap.get(v)).filter(Boolean);
    const mtCounts = new Map();
    for (const m of mtEntries) {
      if (!m?.grk_tokens || !m?.links) continue;
      for (const lnk of m.links) {
        const gt = m.grk_tokens[lnk.g];
        if (!gt || stripGreekDiacriticsV3(gt.l || gt.s) !== targetPlain) continue;
        const hbs = normStrongs4(lnk.h_bs);
        if (!hbs) continue;
        mtCounts.set(hbs, (mtCounts.get(hbs) || 0) + 1);
      }
    }
    if (mtCounts.size > 0) {
      const topHbs = [...mtCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      const profMap = await session.getProfilesBatch(topHbs.map(([bs]) => bs));
      mtEquivalents = topHbs.map(([bs, cnt]) => {
        const hp = profMap.get(bs);
        return {
          strongs: bs,
          script: sanitizeV3TokenLemma(bs, String(hp?.sc || '')),
          gloss: hp?.gl || '',
          sampled_count: cnt,
          source: 'rahlfs_mt_alignment',
        };
      });
      if (profileSummary) profileSummary.mt_equivalents = mtEquivalents;
    }
  }

  const sampledShifts = [...(profileSummary?.lxx_shifts || [])];
  if (wantAnyShift && sampledShifts.length === 0 && pagedVerses.length > 0) {
    const shiftVids = pagedVerses.slice(0, 12).map(v => v.vid).filter(v => v > 0);
    const mtMap = await session.getMtLxxBatch(shiftVids);
    const mtEntries = shiftVids.map(v => mtMap.get(v)).filter(Boolean);
    for (const m of mtEntries) {
      if (!m) continue;
      for (const s of m.shifts || []) {
        if (!shiftType || s.type === shiftType) sampledShifts.push({ ref: m.ref, vid: m.vids?.[0], ...s });
      }
    }
  }

  return {
    schema_version: 3,
    status: 'ok',
    mode: strongsInput ? 'strongs_and_concordance' : 'rahlfs_concordance',
    license: 'CC BY 4.0 (OpenScriptorium/lxx-morph Rahlfs 1935)',
    swete_included: false,
    ...(profileSummary ? { profile: profileSummary } : {}),
    total_verses: allVerses.length,
    returned_verses: pagedVerses.length,
    truncated: offset + pagedVerses.length < allVerses.length,
    remaining_refs: remainingRefs,
    ...(concEntry
      ? {
          lemma: greekLemma,
          total_occ: concEntry.total_occ,
          df: concEntry.df,
          idf: concEntry.idf,
          page: { limit, offset, returned: pagedVerses.length, total_available: allVerses.length },
          verses: pagedVerses,
        }
      : {}),
    ...(sampledShifts.length > 0 ? { matching_shifts: sampledShifts } : {}),
  };
}

/**
 * 2. tri_textual_diff_v3
 * MT <-> Rahlfs LXX <-> NT Halo-SW & composite-splice alignment.
 */
export async function handleTriTextualDiffV3(ctx, params = {}) {
  const session = createV3SessionFromCtx(ctx);
  const targetInput = params.target ?? params.passage ?? params.nt_passage ?? params.ref;
  const ntVids = await resolvePassagesToVidsV3(ctx, {
    ...(typeof targetInput === 'string' ? { passage: targetInput } : {}),
    ...(params.target_verse_id != null ? { verse_id: params.target_verse_id } : {}),
    ...(params.verse_id != null && !params.source ? { verse_id: params.verse_id } : {}),
    ...(params.book != null && !params.source ? { book: params.book, chapter: params.chapter, verse: params.verse } : {}),
  });

  if (ntVids.length === 0) {
    return { schema_version: 3, status: 'invalid_request', error: 'Target NT passage or verse_id is required.' };
  }

  // Gather NT tokens across target span (up to 4 verses)
  const ntVidSlice = ntVids.slice(0, 4);
  const ntVerseMap = await session.getVersesBatch(ntVidSlice);
  const ntVerses = ntVidSlice.map(v => ntVerseMap.get(v)).filter(Boolean);
  if (ntVerses.length === 0) {
    return { schema_version: 3, status: 'not_found', error: 'Target NT verse data not found.' };
  }
  const ntTokens = [];
  for (const nv of ntVerses) {
    for (const t of buildNtTokensFromV3Verse(nv)) {
      ntTokens.push({ ...t, idx: ntTokens.length });
    }
  }

  // Resolve explicit OT source(s) or auto-discover Top <= 20 OT/LXX candidates via IDF BMW + XREF + LXX-CSR priors
  const sourceInputs = [];
  if (Array.isArray(params.sources)) sourceInputs.push(...params.sources);
  else if (typeof params.sources === 'string') sourceInputs.push(...params.sources.split(/[,;]/).map(s => s.trim()).filter(Boolean));
  if (params.source) sourceInputs.push(String(params.source).trim());

  let otVids = [];
  for (const s of sourceInputs) {
    const resolved = await resolvePassagesToVidsV3(ctx, { passage: s });
    otVids.push(...resolved);
  }
  otVids = [...new Set(otVids.filter(v => v >= 1 && v <= 23213))];

  const bmw = await session.getBmw();
  const xrefPriors = new Map();

  if (otVids.length === 0 && bmw) {
    const candScores = new Map();
    const addCandPrior = (vid, scoreAdd, priorAdd) => {
      if (vid < 1 || vid > 23213) return;
      candScores.set(vid, (candScores.get(vid) || 0) + scoreAdd);
      if (priorAdd > 0) {
        xrefPriors.set(vid, Math.min(3.5, Math.max(xrefPriors.get(vid) || 0, priorAdd)));
      }
    };

    // 1. XREF + multi-verse XREF span priors (e.g., Zechariah 11:12-13, Micah 5:2) + LXX/XREF CSR edges
    const rangeExpandPromises = [];
    for (const nv of ntVerses) {
      for (const xr of nv.xrefs || []) {
        const tv = Number(xr.to_vid || 0);
        if (tv >= 1 && tv <= 23213) {
          addCandPrior(tv, 32 + (xr.score || 0) / 8, 1.5 + (xr.score || 0) / 80);
          if (xr.to_ref && /[-–]/.test(String(xr.to_ref))) {
            rangeExpandPromises.push(
              resolvePassagesToVidsV3(ctx, { passage: String(xr.to_ref) }).then(rv => ({ rv, xrScore: xr.score || 0 })),
            );
          }
        }
      }
    }
    const [expandedRanges, csrLists] = await Promise.all([
      Promise.all(rangeExpandPromises),
      Promise.all(ntVerses.map(nv => session.lookupCsr(nv.vid))),
    ]);
    for (const { rv, xrScore } of expandedRanges) {
      for (const vid of rv.slice(0, 3)) {
        addCandPrior(vid, 28 + xrScore / 10, 1.4 + xrScore / 90);
      }
    }
    for (const edges of csrLists) {
      for (const e of edges) {
        if ((e.partition === 1 || e.partition === 2) && e.toNodeId >= 1 && e.toNodeId <= 23213) {
          addCandPrior(e.toNodeId, 18 + (e.weight || 0) * 40, 1.2 + (e.weight || 0) * 15);
        }
      }
    }

    // 2. Diacritic-aware IDF-ranked BMW keys across ALL NT content tokens + proper names + rare MT equivalents
    const rankedQueryTerms = new Map(); // bmwKey -> weight
    const rareStrongsForMt = [];
    for (const t of ntTokens) {
      if (t.isFunction || !t.lemma) continue;
      const hit = lookupLxxBmwTerm(bmw, t.lemma);
      const isProper = /^[A-Z\u0391-\u03A9]/.test(t.surface || '') || /^[A-Z\u0391-\u03A9]/.test(t.lemma || '');
      if (hit) {
        const bonus = (isProper ? 2.5 : 0) + (hit.term.df <= 80 ? 2.0 : 0);
        const w = hit.term.idf + bonus;
        if ((rankedQueryTerms.get(hit.key) || 0) < w) rankedQueryTerms.set(hit.key, w);
        if (hit.term.df <= 180 && t.strongs && !rareStrongsForMt.includes(t.strongs)) {
          rareStrongsForMt.push(t.strongs);
        }
      } else if (t.strongs && !rareStrongsForMt.includes(t.strongs)) {
        rareStrongsForMt.push(t.strongs);
      }
    }
    // Add Hebrew MT equivalents for rare/unmatched NT words (e.g. G2763 κεραμεύς -> H3335 יוֹצֵר)
    if (rareStrongsForMt.length > 0) {
      const rareSlice = rareStrongsForMt.slice(0, 4);
      const gProfsMap = await session.getProfilesBatch(rareSlice);
      const gProfs = rareSlice.map(bs => gProfsMap.get(normStrongs4(bs) || bs)).filter(Boolean);
      for (const gp of gProfs) {
        if (!gp?.lxx_relations) continue;
        for (const rel of gp.lxx_relations.slice(0, 2)) {
          const hbs = normStrongs4(rel?.target_strongs);
          if (!hbs || !hbs.startsWith('H')) continue;
          const hTerm = lookupTerm(bmw, hbs);
          if (hTerm && hTerm.df <= 400) {
            const w = hTerm.idf + 1.5;
            if ((rankedQueryTerms.get(hbs) || 0) < w) rankedQueryTerms.set(hbs, w);
          }
        }
      }
    }

    const topBmwKeys = [...rankedQueryTerms.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([k]) => k);
    if (topBmwKeys.length > 0) {
      const hits = blockMaxWandTopK(bmw, topBmwKeys, 32, 1.2);
      for (const h of hits) {
        if (h.vid >= 1 && h.vid <= 23213) {
          candScores.set(h.vid, (candScores.get(h.vid) || 0) + h.score);
        }
      }
    }

    otVids = [...candScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([v]) => v);
  } else {
    otVids = otVids.slice(0, 12);
  }

  const attachPrior = (g) => {
    const prior = xrefPriors.get(g.vid);
    return prior ? { ...g, priorScore: prior } : g;
  };
  await Promise.all([session.getVersesBatch(otVids), session.getMtLxxBatch(otVids)]);
  let otGroups = (await mapBatched(otVids, 4, ov => buildOtCandidateFromV3(session, ov, null, bmw, { loadProfiles: false })))
    .filter(Boolean)
    .map(attachPrior);
  const runTriAlign = (ntT, groups) =>
    alignTriTextualQuoteV4(ntT, groups, { hasCitationFormula: xrefPriors.size > 0 }) || alignTriTextualQuote(ntT, groups);
  let alignment = runTriAlign(ntTokens, otGroups);
  const pass2Vids = alignment?.sources?.length > 0
    ? alignment.sources.slice(0, 2).map(s => Number(s.vid)).filter(Boolean)
    : otVids.slice(0, 2);
  if (pass2Vids.length > 0) {
    const enriched = (await Promise.all(pass2Vids.map(ov => buildOtCandidateFromV3(session, ov, null, bmw, { loadProfiles: true, maxProfiles: 6 }))))
      .filter(Boolean)
      .map(attachPrior);
    const enrichedByVid = new Map(enriched.map(g => [g.vid, g]));
    if (enrichedByVid.size > 0) {
      otGroups = otGroups.map(g => enrichedByVid.get(g.vid) || g);
      alignment = runTriAlign(ntTokens, otGroups);
    }
  }
  const status = alignment && alignment.sources.length > 0 ? 'ok' : 'no_alignment';
  const lxxShifts = {};
  const shiftSourceVids = status === 'ok' ? otVids.slice(0, 8) : [];
  const shiftMtMap = shiftSourceVids.length > 0 ? await session.getMtLxxBatch(shiftSourceVids) : new Map();
  for (const ov of shiftSourceVids) {
    const m = shiftMtMap.get(ov);
    if (m?.shifts?.length) lxxShifts[m.ref || String(ov)] = m.shifts;
  }

  if (status === 'no_alignment') {
    const isOtTarget = ntVids.every(v => v >= 1 && v <= 23213);
    return {
      schema_version: 3,
      status: 'no_alignment',
      license: 'CC BY 4.0 (OpenScriptorium/lxx-morph Rahlfs 1935 + MACULA + STEPBible)',
      target_ref: ntVerses.map(v => v.ref).join('; '),
      target_vids: ntVerses.map(v => v.vid),
      candidate_source_count: otGroups.length,
      lxx_shift_source_count: 0,
      sources: [],
      splices: [],
      summary: null,
      evidence_bits: 0,
      tokens: [],
      ...(isOtTarget ? { note: 'tri_textual_diff aligns an NT target passage against OT/LXX sources; target is an OT passage (use lxx_concordance for OT MT<->LXX comparison).' } : {}),
    };
  }

  return {
    schema_version: 3,
    status,
    license: 'CC BY 4.0 (OpenScriptorium/lxx-morph Rahlfs 1935 + MACULA + STEPBible)',
    target_ref: ntVerses.map(v => v.ref).join('; '),
    target_vids: ntVerses.map(v => v.vid),
    candidate_sources: otGroups.map(g => ({ ref: g.ref, vid: g.vid, slot_count: g.slots.length })),
    sources: alignment.sources,
    splices: alignment.splices,
    summary: alignment.summary,
    evidence_bits: alignment.evidenceBits,
    tokens: alignment.tokens,
    lxx_shifts_in_sources: lxxShifts,
  };
}

/**
 * 3. clause_role_query_v3
 * Lossless clause/actant/polarity/concept search over postings-bmw.bin + rhetoric/clauses-*.json.gz.
 */
export async function handleClauseRoleQueryV3(ctx, params = {}) {
  const session = createV3SessionFromCtx(ctx);
  const limit = clampLimit(params.limit, 20);
  const polarityParam = params.polarity ? String(params.polarity).toUpperCase() : null;
  const wantNeg = polarityParam === 'NEG' || polarityParam === 'NEGATIVE';
  const wantPos = polarityParam === 'POS' || polarityParam === 'POSITIVE';
  const idiomOnly = parseBoolParam(params.idiom_only, false);
  const existentialOnly = parseBoolParam(params.existential_only, false);
  const hoTypeFilter = params.ho_type ? String(params.ho_type).toUpperCase() : null;
  const predFilter = params.predicate ? normalizeBmwKey(params.predicate) : null;
  const subjFilter = params.subject || params.agent ? normalizeBmwKey(params.subject || params.agent) : null;
  const objFilter = params.object || params.patient ? normalizeBmwKey(params.object || params.patient) : null;
  const conceptFilters = [
    ...parseListParam(params.concept),
    ...parseListParam(params.concepts),
  ].map(c => (c.startsWith('c:') ? c : (c.startsWith('C_XL:') ? `c:${c}` : `c:${c}`)));

  const clauseMatchesFilters = (cl) => {
    if (wantNeg && cl.polarity !== 'negative' && !(cl.neg_markers?.length > 0)) return false;
    if (wantPos && cl.polarity === 'negative') return false;
    if (idiomOnly && !cl.slot_atom?.is_idiom) return false;
    if (existentialOnly) {
      const ps = normStrongs4(cl.predicate?.s);
      const isEx = ps === 'H1961' || ps === 'H0369' || ps === 'H3426' || ps === 'H3808' || ps === 'G1510' || ps === 'G1096' || (cl.neg_markers || []).some((m) => /אין|לֹא|לא|οὐ|μὴ/i.test(String(m)));
      if (!isEx) return false;
    }
    if (predFilter && normStrongs4(cl.predicate?.s) !== predFilter && cl.predicate?.concept_id !== predFilter.replace(/^c:/, '')) return false;
    if (subjFilter && !(cl.subjects || []).some(s => normStrongs4(s) === subjFilter)) return false;
    if (objFilter && !(cl.objects || []).some(o => normStrongs4(o) === objFilter)) return false;
    if (conceptFilters.length > 0) {
      const cSet = new Set(cl.concept_ids || []);
      if (!conceptFilters.some(cf => cSet.has(cf.replace(/^c:/, '')))) return false;
    }
    return true;
  };

  // Mode A: passage-scoped clause query
  const passageVids = await resolvePassagesToVidsV3(ctx, params);
  if (passageVids.length > 0) {
    const pSlice = passageVids.slice(0, 24);
    const clauseMap = await session.getVerseClausesBatch(pSlice);
    const verseClauses = pSlice.map(v => clauseMap.get(v)).filter(Boolean);
    const versesOut = [];
    let totalClauses = 0;
    for (const vc of verseClauses) {
      const matched = (vc.clauses || []).filter(clauseMatchesFilters);
      if (matched.length === 0) continue;
      totalClauses += matched.length;
      versesOut.push({
        vid: vc.vid,
        ref: vc.ref,
        clauses: matched,
        tokens: vc.tokens || [],
      });
    }
    return {
      schema_version: 3,
      status: 'ok',
      mode: 'passage_clauses',
      total_clauses: totalClauses,
      verses: versesOut,
      ...(hoTypeFilter ? { ho_type_filter: hoTypeFilter } : {}),
    };
  }

  // Mode B: corpus-wide BMW bitset intersection + lossless clause hydration
  const bmw = await session.getBmw();
  if (!bmw) return { schema_version: 3, status: 'unavailable', error: 'v3 BMW index unavailable.' };

  const includeKeys = [...parseListParam(params.include).map(normalizeBmwKey)];
  const excludeKeys = [...parseListParam(params.exclude).map(normalizeBmwKey)];
  if (wantNeg) {
    if (predFilter && !predFilter.startsWith('c:') && !predFilter.startsWith('role:')) {
      includeKeys.push(`role:NEG:${predFilter}`);
    } else if (conceptFilters.length > 0) {
      includeKeys.push(`role:NEG:${conceptFilters[0].replace(/^c:/, '')}`);
    } else {
      includeKeys.push('role:NEG:*');
    }
  }
  if (predFilter && !wantNeg) includeKeys.push(predFilter);
  if (subjFilter) includeKeys.push(subjFilter.startsWith('role:') ? subjFilter : `role:${subjFilter}:SUBJ`);
  if (objFilter) includeKeys.push(objFilter.startsWith('role:') ? objFilter : `role:${objFilter}:OBJ`);
  for (const cf of conceptFilters) includeKeys.push(cf);

  const uniqueKeys = [...new Set(includeKeys.filter(Boolean))];
  if (uniqueKeys.length === 0) {
    return { schema_version: 3, status: 'invalid_request', error: 'Provide passage or role/predicate/concept/polarity filters.' };
  }

  const candVids = intersectTerms(bmw, uniqueKeys, excludeKeys, Math.min(80, Math.max(limit * 2, 24)));
  const candSlice = candVids.slice(0, 24);
  const clauseMap = await session.getVerseClausesBatch(candSlice);
  const loadedClauses = candSlice.map(v => clauseMap.get(v)).filter(Boolean);
  const matches = [];
  for (const vc of loadedClauses) {
    const matched = (vc.clauses || []).filter(clauseMatchesFilters);
    if (matched.length === 0) continue;
    matches.push({ vid: vc.vid, ref: vc.ref, clauses: matched });
    if (matches.length >= limit) break;
  }

  return {
    schema_version: 3,
    status: 'ok',
    mode: 'corpus_role_search',
    query_keys: uniqueKeys,
    candidate_vids_count: candVids.length,
    returned: matches.length,
    matches,
  };
}

/**
 * 4. sequence_parallels_v3
 * SW^piece_pol (1:2/2:1 bundling + CONCORDANT/INVERSION + 64-perm p-value) & SlotAtom breaks.
 */
export async function handleSequenceParallelsV3(ctx, params = {}) {
  const session = createV3SessionFromCtx(ctx);
  const targetsList = parseListParam(params.targets);
  const srcParam = params.source ?? params.passageA ?? params.passage ?? targetsList[0];
  const tgtParam = params.target ?? params.passageB ?? targetsList[1];
  const permutations = Math.min(64, Math.max(8, Math.floor(Number(params.permutations ?? 24))));
  const switchPenalty = Number.isFinite(Number(params.switch_penalty)) ? Number(params.switch_penalty) : 1.8;

  const srcVids = await resolvePassagesToVidsV3(ctx, typeof srcParam === 'string' ? { passage: srcParam } : (srcParam || {}));
  if (srcVids.length === 0) {
    return { schema_version: 3, status: 'invalid_request', error: 'Source passage is required for sequence_parallels_v3.' };
  }

  const srcVidSlice = srcVids.slice(0, 40);
  const srcClauseMap = await session.getVerseClausesBatch(srcVidSlice);
  const srcClauseVerses = srcVidSlice.map(v => srcClauseMap.get(v)).filter(Boolean);
  const clausesA = srcClauseVerses.flatMap(buildClauseSigsFromV3Verse);

  // Detect SlotAtom / PELT-like structural breaks across consecutive verses in source
  const structuralBreaks = [];
  for (let i = 1; i < srcClauseVerses.length; i++) {
    const prev = srcClauseVerses[i - 1];
    const curr = srcClauseVerses[i];
    const prevC = new Set((prev.clauses || []).flatMap(c => c.concept_ids || []));
    const currC = new Set((curr.clauses || []).flatMap(c => c.concept_ids || []));
    let inter = 0;
    for (const c of prevC) if (currC.has(c)) inter++;
    const union = prevC.size + currC.size - inter;
    const jacc = union > 0 ? inter / union : 0;
    const prevPol = (prev.clauses || []).some(c => c.polarity === 'negative') ? 'NEG' : 'POS';
    const currPol = (curr.clauses || []).some(c => c.polarity === 'negative') ? 'NEG' : 'POS';
    const prevStems = new Set((prev.clauses || []).map(c => c.slot_atom?.verb_stem).filter(Boolean));
    const currStems = new Set((curr.clauses || []).map(c => c.slot_atom?.verb_stem).filter(Boolean));
    const stemShift = [...currStems].some(s => !prevStems.has(s));
    if (prevPol !== currPol || (jacc < 0.15 && stemShift)) {
      structuralBreaks.push({
        at_vid: curr.vid,
        at_ref: curr.ref,
        prev_ref: prev.ref,
        reason: prevPol !== currPol ? 'polarity_shift' : 'slot_atom_shift',
        concept_jaccard: Number(jacc.toFixed(3)),
      });
    }
  }

  let targetWindows = [];
  if (tgtParam) {
    const tgtVids = await resolvePassagesToVidsV3(ctx, typeof tgtParam === 'string' ? { passage: tgtParam } : (tgtParam || {}));
    if (tgtVids.length > 0) {
      targetWindows.push({ label: String(tgtParam), vids: tgtVids.slice(0, 40) });
    }
  } else {
    // Auto-retrieve Top-5 candidate windows via BMW over source's rarest concepts
    const bmw = await session.getBmw();
    if (bmw) {
      const cCounts = new Map();
      for (const cl of clausesA) {
        for (const c of cl.concepts) cCounts.set(c, (cCounts.get(c) || 0) + 1);
      }
      const cKeys = [...cCounts.keys()]
        .map(c => (c.startsWith('c:') ? c : `c:${c}`))
        .filter(k => {
          const t = lookupTerm(bmw, k);
          return t && t.df >= 2 && t.df <= 1200;
        })
        .slice(0, 10);
      if (cKeys.length > 0) {
        const hits = blockMaxWandTopK(bmw, cKeys, 16, 1.5);
        const srcSet = new Set(srcVids);
        const usedCenters = [];
        for (const h of hits) {
          if (srcSet.has(h.vid) || usedCenters.some(u => Math.abs(u - h.vid) <= 5)) continue;
          usedCenters.push(h.vid);
          const span = Math.min(8, Math.max(3, srcVids.length));
          const half = Math.floor(span / 2);
          const wVids = [];
          for (let v = Math.max(1, h.vid - half); v <= Math.min(NUM_VERSES, h.vid + half); v++) wVids.push(v);
          targetWindows.push({ label: `vid:${h.vid}`, vids: wVids });
          if (targetWindows.length >= 3) break;
        }
      }
    }
  }

  const allTargetVids = [...new Set(targetWindows.flatMap(tw => tw.vids))];
  const tgtClauseMap = allTargetVids.length > 0 ? await session.getVerseClausesBatch(allTargetVids) : new Map();
  const alignments = [];
  for (const tw of targetWindows) {
    const tgtClausesVerses = tw.vids.map(v => tgtClauseMap.get(v)).filter(Boolean);
    const clausesB = tgtClausesVerses.flatMap(buildClauseSigsFromV3Verse);
    session.clausePromises?.clear();
    if (clausesA.length < 2 || clausesB.length < 2) continue;
    const res = alignClauseSequencesPiecewise(clausesA, clausesB, { switchPenalty, permutations });
    alignments.push({
      target_label: tgtClausesVerses[0]?.ref ? `${tgtClausesVerses[0].ref}..${tgtClausesVerses[tgtClausesVerses.length - 1].ref}` : tw.label,
      target_vids: tw.vids,
      target_clause_count: clausesB.length,
      ...res,
      has_inversion: res.blocks.some(b => b.mode === 'INVERSION'),
      has_reversed_order: res.blocks.some(b => b.orientation === 'reversed'),
    });
  }

  alignments.sort((a, b) => b.evidence_bits - a.evidence_bits || b.raw_score - a.raw_score);

  return {
    schema_version: 3,
    status: 'ok',
    source: srcClauseVerses[0]?.ref || String(srcParam),
    source_clause_count: clausesA.length,
    best_alignment: alignments[0] ?? null,
    alignments,
    structural_breaks: structuralBreaks,
  };
}

const WP_CLAUSE_NORMS_CACHE = new WeakMap();
const WORDPLAY_DISCLAIMER =
  'Consonantal/phonetic similarity or syntactic wordplay signals are surface-level structural cues, not proven historical etymologies.';

/**
 * 5. wordplay_scan_v3
 * Passage/range/pair scan via wordplay-engine.ts + v3/rhetoric/rhetoric-index.json.gz.
 */
export async function handleWordplayScanV3(ctx, params = {}) {
  const session = createV3SessionFromCtx(ctx);
  const aInput = params.a ? String(params.a).trim() : '';
  const bInput = params.b ? String(params.b).trim() : '';

  if (aInput && bInput) {
    const resolveForm = async (raw) => {
      const bs = normStrongs4(raw);
      const prof = bs ? await session.getProfile(bs) : null;
      const script = prof?.sc || raw;
      return {
        bs: bs || null,
        prof,
        norm: normalizeOriginalForm(script, bs || undefined, undefined, prof?.pos, prof?.sc),
      };
    };
    const [fa, fb] = await Promise.all([resolveForm(aInput), resolveForm(bInput)]);
    const metrics = compareOriginalForms(fa.norm, fb.norm);
    let documentedRoot = false;
    let attestedWordplay = false;
    if (fa.prof && fb.bs) {
      const canonB = canonicalStrongsKey(fb.bs);
      documentedRoot = (fa.prof.lexical_relations || []).some(
        r => canonicalStrongsKey(r.target_strongs || '') === canonB && (r.type === 'shares_root' || r.type?.startsWith('derived_')),
      );
      attestedWordplay = (fa.prof.r13_wordplay || []).some(
        w =>
          canonicalStrongsKey(w.target_bs || w.bs || '') === canonB
          && (!w.evidence_type || w.evidence_type === 'attested_textual_wordplay')
          && isVerifiedAttestedWordplayEdge(w, fa.prof, fb.prof),
      );
    }
    const isMaterOnlyTrap = fa.norm.language === 'hbo' && (metrics.shared_consonants || '').replace(/[אהוי]/g, '').length === 0;
    const nonMaterSharedCount = (metrics.shared_consonants || '').replace(/[אהוי]/g, '').length;
    const isShortProperSubstring =
      metrics.overlap_kind === 'shared_consonantal_substring'
      && nonMaterSharedCount <= 2
      && !documentedRoot
      && !attestedWordplay;
    const isGenuinePlay =
      attestedWordplay
      || (
        !isMaterOnlyTrap
        && !isShortProperSubstring
        && metrics.comparable
        && metrics.overlap_kind !== 'consonantal_subsequence_only'
        && metrics.formal_score >= 0.65
      );
    return {
      schema_version: 3,
      status: 'ok',
      mode: 'pair_scan',
      a: { input: aInput, strongs: fa.bs, script: fa.norm.script, consonantal: fa.norm.consonantal, stripped: fa.norm.strippedAffixStem },
      b: { input: bInput, strongs: fb.bs, script: fb.norm.script, consonantal: fb.norm.consonantal, stripped: fb.norm.strippedAffixStem },
      comparable: metrics.comparable,
      overlap_kind: metrics.overlap_kind,
      shared_consonants: metrics.shared_consonants,
      edit_distance: metrics.edit_distance,
      phonetic_distance: metrics.phonetic_distance,
      formal_score: metrics.formal_score,
      proven_common_root: documentedRoot,
      attested_textual_wordplay: attestedWordplay,
      wordplay_candidate: isGenuinePlay,
      disclaimer: WORDPLAY_DISCLAIMER,
    };
  }

  const vids = await resolvePassagesToVidsV3(ctx, params);
  if (vids.length === 0) {
    return { schema_version: 3, status: 'invalid_request', error: 'Provide passage/verse range or pair (a, b) for wordplay_scan_v3.' };
  }

  const vidSlice = vids.slice(0, 32);
  const uniqueBooks = [...new Set(vidSlice.map(v => ctx.getVerseById?.(v)?.book || bookForVidV3(v)))];
  const [rhetBooks, v3VersesMap] = await Promise.all([
    Promise.all(uniqueBooks.map(b => session.getRhetoricBook(b))),
    session.getVersesBatch(vidSlice),
  ]);
  const hitRhetBooks = rhetBooks.filter(Boolean);
  let rhetoricIdx = null;
  if (hitRhetBooks.length > 0) {
    rhetoricIdx = {
      syntactic_talion_hits: hitRhetBooks.flatMap(rb => rb.syntactic_talion_hits || []),
      onomastic_valence_hits: hitRhetBooks.flatMap(rb => rb.onomastic_valence_hits || []),
    };
  } else {
    rhetoricIdx = await session.getRhetoricIndex();
  }
  const v3Verses = vidSlice.map(v => v3VersesMap.get(v)).filter(Boolean);

  if (rhetoricIdx && !rhetoricIdx._talionByVid) {
    const tMap = new Map();
    for (const h of rhetoricIdx.syntactic_talion_hits || []) {
      const vid = Number(h.vid);
      if (!tMap.has(vid)) tMap.set(vid, []);
      tMap.get(vid).push(h);
    }
    rhetoricIdx._talionByVid = tMap;
    const oMap = new Map();
    for (const h of rhetoricIdx.onomastic_valence_hits || []) {
      for (const rf of [h.proper_ref, h.target_ref]) {
        if (!rf) continue;
        if (!oMap.has(rf)) oMap.set(rf, []);
        oMap.get(rf).push(h);
      }
    }
    rhetoricIdx._onomByRef = oMap;
  }

  let clauseVersesFallback = null;
  let onomLexFallback = null;
  if (!rhetoricIdx) {
    const clauseMap = await session.getVerseClausesBatch(vidSlice);
    clauseVersesFallback = vidSlice.map(v => clauseMap.get(v)).filter(Boolean);
    onomLexFallback = await session.getOnomastic();
  }
  const activeVerses = rhetoricIdx ? v3Verses : clauseVersesFallback;

  const indexedTalion = [];
  for (const v of vids) {
    const arr = rhetoricIdx?._talionByVid?.get(Number(v));
    if (arr) indexedTalion.push(...arr);
  }
  const indexedOnomSet = new Set();
  for (const cv of activeVerses) {
    const arr = rhetoricIdx?._onomByRef?.get(cv.ref);
    if (arr) for (const h of arr) indexedOnomSet.add(h);
  }
  const indexedOnom = [...indexedOnomSet];

  const wpTokens = [];
  const wpClauses = [];
  if (!rhetoricIdx) {
    for (const cv of clauseVersesFallback) {
      const baseIdx = wpTokens.length;
      for (let i = 0; i < (cv.tokens || []).length; i++) {
        const t = cv.tokens[i];
        wpTokens.push({
          id: `${cv.vid}:${i}`,
          verseId: cv.vid,
          book: cv.book,
          ref: cv.ref,
          index: wpTokens.length,
          surfaceForm: t.sf || '',
          transliteration: '',
          gloss: t.g || '',
          strongs: t.s || '',
          lemmaKey: t.lk,
          lemmaScript: t.lm || t.sf || '',
          grammarCode: t.gc || '',
          posClass: t.cl || '',
          stem: t.stem || null,
          isFunctionWord: Boolean(t.is_func),
        });
      }
      for (const cl of cv.clauses || []) {
        const idxs = cl.token_indices || [];
        if (idxs.length > 0) {
          wpClauses.push({
            startIndex: baseIdx + idxs[0],
            endIndex: baseIdx + idxs[idxs.length - 1],
            subjectLemmas: cl.subjects || [],
            objectLemmas: cl.objects || [],
          });
        }
      }
    }
  }

  const liveTalion = !rhetoricIdx && wpClauses.length > 0
    ? detectSyntacticTalionAndPolyptoton(wpTokens, wpClauses)
    : [];
  const hasProperNoun = !rhetoricIdx && wpTokens.some(t => /^N.*p/i.test(t.grammarCode || '') || t.posClass === 'proper');
  const liveOnom = !rhetoricIdx && hasProperNoun
    ? detectOnomasticValenceWordplays(wpTokens, onomLexFallback?.entries || undefined)
    : [];

  // Pairwise consonantal wordplay candidates across distinct non-function lemmas within the passage
  const consonantalPairs = [];
  const seenPairs = new Set();
  const contentNorms = [];
  for (const cv of activeVerses) {
    let cvNorms = WP_CLAUSE_NORMS_CACHE.get(cv);
    if (!cvNorms) {
      cvNorms = [];
      const rawTokList = Array.isArray(cv.toks) ? repairV3VerseToks(cv) : (cv.tokens || []);
      for (let i = 0; i < rawTokList.length; i++) {
        const t = rawTokList[i];
        if (t.is_func || !t.s || /^H90\d\d$/.test(t.s)) continue;
        const bs = normStrongs4(t.s);
        if (!bs) continue;
        const sf = t.sf || '';
        const lm = t.lm || sf;
        cvNorms.push({
          bs,
          sf,
          ref: cv.ref,
          norm: normalizeOriginalForm(sf, t.s, t.gc || '', t.cl || '', lm),
        });
      }
      WP_CLAUSE_NORMS_CACHE.set(cv, cvNorms);
    }
    for (const item of cvNorms) contentNorms.push(item);
  }
  for (let i = 0; i < contentNorms.length; i++) {
    const aEntry = contentNorms[i];
    const consA = aEntry.norm.consonantal || '';
    for (let j = i + 1; j < Math.min(contentNorms.length, i + 14); j++) {
      const bEntry = contentNorms[j];
      if (aEntry.bs === bEntry.bs) continue;
      const consB = bEntry.norm.consonantal || '';
      let sharedCount = 0;
      for (let c = 0; c < consA.length; c++) {
        if (consB.includes(consA[c])) { sharedCount++; if (sharedCount >= 2) break; }
      }
      if (sharedCount < 2 && consA !== consB) continue;
      const pk = aEntry.bs < bEntry.bs ? `${aEntry.bs}:${bEntry.bs}` : `${bEntry.bs}:${aEntry.bs}`;
      if (seenPairs.has(pk)) continue;
      const cmp = compareOriginalForms(aEntry.norm, bEntry.norm);
      if (cmp.comparable && cmp.overlap_kind !== 'consonantal_subsequence_only' && cmp.formal_score >= 0.60) {
        seenPairs.add(pk);
        consonantalPairs.push({
          strongsA: aEntry.bs,
          strongsB: bEntry.bs,
          formA: aEntry.sf,
          formB: bEntry.sf,
          refA: aEntry.ref,
          refB: bEntry.ref,
          overlap_kind: cmp.overlap_kind,
          shared_consonants: cmp.shared_consonants,
          formal_score: cmp.formal_score,
        });
      }
    }
  }

  return {
    schema_version: 3,
    status: 'ok',
    mode: 'passage_scan',
    passage: activeVerses[0]?.ref ? `${activeVerses[0].ref}${activeVerses.length > 1 ? `..${activeVerses[activeVerses.length - 1].ref}` : ''}` : `vid:${vids[0]}`,
    syntactic_talion: indexedTalion.length > 0 ? indexedTalion : liveTalion.map(t => ({
      vid: t.tokenA.verseId,
      ref: t.tokenA.ref,
      kind: t.kind,
      strongsA: normStrongs4(t.tokenA.strongs),
      strongsB: normStrongs4(t.tokenB.strongs),
      formA: t.tokenA.surfaceForm,
      formB: t.tokenB.surfaceForm,
      shift: t.shiftSummary,
      cues: t.cues,
      score: t.score,
    })),
    onomastic_valence: indexedOnom.length > 0 ? indexedOnom : liveOnom.map(o => ({
      proper_ref: o.properToken.ref,
      target_ref: o.targetToken.ref,
      proper_strongs: normStrongs4(o.properToken.strongs),
      target_strongs: normStrongs4(o.targetToken.strongs),
      proper_form: o.properToken.surfaceForm,
      target_form: o.targetToken.surfaceForm,
      channel: o.matchChannel,
      cues: o.cues,
      score: o.score,
    })),
    consonantal_candidates: consonantalPairs.slice(0, 20),
    disclaimer: WORDPLAY_DISCLAIMER,
  };
}

/**
 * 6. expand_clue_v3
 * On-demand expand_id hydration for progressive MCP output (clue / evidence / full).
 */
export async function handleExpandClueV3(ctx, params = {}) {
  const expandId = String(params.expand_id || params.id || params.evidence_id || params.node_id || '').trim();
  const detail = ['clue', 'evidence', 'full'].includes(String(params.detail)) ? String(params.detail) : 'evidence';
  if (!expandId) {
    return { schema_version: 3, status: 'invalid_request', error: 'expand_id is required.' };
  }

  const session = createV3SessionFromCtx(ctx);
  if (expandId.startsWith('v3:bridge:')) {
    const parts = expandId.split(':');
    const aVid = Number(parts[2] || 0);
    const bVid = Number(parts[3] || 0);
    const pVid = Number(parts[4] || 0);
    const [va, vb, vp, csr, clausesP] = await Promise.all([
      aVid ? session.getVerse(aVid) : null,
      bVid ? session.getVerse(bVid) : null,
      pVid ? session.getVerse(pVid) : null,
      pVid ? session.lookupCsr(pVid) : [],
      detail === 'full' && pVid ? session.getVerseClauses(pVid) : null,
    ]);
    const ePerp = (aVid && pVid)
      ? await scoreV3EPerpPair(session, [aVid], [], [pVid], [])
      : null;
    return {
      schema_version: 3,
      status: vp ? 'ok' : 'not_found',
      expand_id: expandId,
      detail,
      kind: 'intermediate_bridge_pivot',
      pivot: vp ? { vid: vp.vid, ref: vp.ref, ...(detail !== 'clue' ? { en: vp.en, concepts: vp.concepts } : {}) } : null,
      anchors: [va, vb].filter(Boolean).map(v => ({ vid: v.vid, ref: v.ref, ...(detail !== 'clue' ? { en: v.en } : {}) })),
      ...(ePerp ? { e_perp: ePerp } : {}),
      ...(detail === 'full' ? { csr_edge_count: csr.length, clauses: clausesP?.clauses || [] } : {}),
    };
  }

  if (expandId.startsWith('v3:bmw:') || /^(?:verse|vid):\d+$/.test(expandId)) {
    const vid = Number(expandId.split(':').pop() || 0);
    const [v, cv] = await Promise.all([
      session.getVerse(vid),
      detail === 'full' ? session.getVerseClauses(vid) : null,
    ]);
    return {
      schema_version: 3,
      status: v ? 'ok' : 'not_found',
      expand_id: expandId,
      detail,
      kind: 'bmw_cooccurrence',
      verse: v ? { vid: v.vid, ref: v.ref, ...(detail !== 'clue' ? { en: v.en, toks: v.toks, concepts: v.concepts } : {}) } : null,
      ...(detail === 'full' ? { clauses: cv?.clauses || [] } : {}),
    };
  }

  if (expandId.startsWith('v3:tritext:')) {
    const [, , ntVidStr, otVidStr] = expandId.split(':');
    const triRes = await handleTriTextualDiffV3(ctx, { target_verse_id: Number(ntVidStr), sources: otVidStr ? [otVidStr] : [] });
    return { schema_version: 3, expand_id: expandId, detail, ...triRes };
  }

  if (expandId.startsWith('v3:seq:')) {
    const [, , aVidStr, bVidStr] = expandId.split(':');
    const seqRes = await handleSequenceParallelsV3(ctx, { source: aVidStr, target: bVidStr });
    return { schema_version: 3, expand_id: expandId, detail, ...seqRes };
  }

  if (
    expandId.startsWith('passage_lex_bridge:') ||
    expandId.startsWith('passage_root_bridge:') ||
    expandId.startsWith('passage_root_wordplay:') ||
    expandId.startsWith('passage_lxx:') ||
    expandId.startsWith('lxx:') ||
    expandId.startsWith('lex:') ||
    expandId.startsWith('lxx_highlight:') ||
    expandId.startsWith('r13:wp:') ||
    expandId.startsWith('gram:') ||
    expandId.startsWith('prop:')
  ) {
    const parts = expandId.split(':');
    const prefix = parts[0] === 'r13' ? `r13:${parts[1] || 'wp'}` : parts[0];
    const bsA = normStrongs4(prefix === 'r13:wp' ? (parts[2] || '') : (parts[1] || ''));
    const rawB = prefix === 'r13:wp' ? (parts[3] || '') : (prefix === 'gram' || prefix === 'prop' ? (parts[3] || parts[2] || '') : (parts[2] || ''));
    const bsB = normStrongs4(rawB);
    const [profA, profB, bmw] = await Promise.all([
      bsA ? session.getProfile(bsA) : null,
      bsB ? session.getProfile(bsB) : null,
      session.getBmw(),
    ]);
    const projectWord = (prof, fallbackBs) => prof
      ? {
          strongs: prof.bs || fallbackBs,
          lemma_key: prof.lk,
          script: sanitizeV3TokenLemma(prof.bs || fallbackBs || '', String(prof.sc || '')),
          transliteration: prof.tr,
          gloss: prof.gl,
          total_verses: prof.total_verses ?? prof.canonical_df,
        }
      : (fallbackBs ? { strongs: fallbackBs } : null);
    const bridgeRelations = [];
    for (const [srcP, tgtBs] of [[profA, bsB], [profB, bsA]]) {
      if (!srcP || !tgtBs) continue;
      for (const lr of srcP.lexical_relations || []) {
        if (normStrongs4(lr?.target_strongs) === tgtBs) {
          bridgeRelations.push({
            kind: lr.type || 'lexical_relation',
            from: srcP.bs,
            to: tgtBs,
            root: lr.root || null,
            gloss: lr.gloss || null,
          });
        }
      }
      for (const lx of srcP.lxx_relations || []) {
        if (normStrongs4(lx?.target_strongs) === tgtBs) {
          bridgeRelations.push({
            kind: lx.type || 'lxx_bridge',
            from: srcP.bs,
            to: tgtBs,
            count: lx.count || null,
            sample_refs: (lx.sample_refs || []).slice(0, 4),
          });
        }
      }
      for (const wp of srcP.r13_wordplay || []) {
        if (normStrongs4(wp?.target_bs) === tgtBs) {
          bridgeRelations.push({
            kind: wp.evidence_type || 'wordplay_bridge',
            from: srcP.bs,
            to: tgtBs,
            shared_consonants: wp.shared_consonants || null,
            witness_refs: (wp.witness_refs || []).slice(0, 4),
          });
        }
      }
      for (const gr of srcP.grammatical_relations || []) {
        if (normStrongs4(gr?.related_strongs) === tgtBs) {
          bridgeRelations.push({
            kind: gr.predicate || 'grammatical_relation',
            from: srcP.bs,
            to: tgtBs,
            occurrences: gr.occurrences || 0,
          });
        }
      }
    }
    const isCrossTestamentLxx = Boolean(bsA && bsB && bsA[0] !== bsB[0]);
    let sharedVids = [];
    if (bmw && bsA && bsB) {
      if (isCrossTestamentLxx) {
        const hBs = bsA.startsWith('H') ? bsA : bsB;
        const gProf = bsA.startsWith('G') ? profA : profB;
        const gLemma = String(gProf?.sc || (!bsB && rawB ? rawB : '')).normalize('NFKC').trim();
        const gHit = gLemma ? lookupLxxBmwTerm(bmw, gLemma) : null;
        if (gHit) {
          sharedVids = intersectTerms(bmw, [hBs, gHit.key], [], 6);
        }
      } else {
        sharedVids = intersectTerms(bmw, [bsA, bsB], [], 6);
      }
    }
    const sampleWitnessVids = sharedVids.length > 0
      ? sharedVids
      : [
          ...(Array.isArray(profA?.all_vids) ? profA.all_vids.slice(0, 3) : []),
          ...(Array.isArray(profB?.all_vids) ? profB.all_vids.slice(0, 3) : []),
        ];
    const sharedVerses = detail !== 'clue' && sampleWitnessVids.length > 0
      ? (await Promise.all(sampleWitnessVids.map(v => session.getVerse(v)))).filter(Boolean).map(v => ({
          vid: v.vid,
          ref: v.ref,
          en: v.en,
        }))
      : [];
    const ok = Boolean(profA || profB || bridgeRelations.length > 0);
    return {
      schema_version: 3,
      status: ok ? 'ok' : 'not_found',
      expand_id: expandId,
      detail,
      kind: prefix,
      words: [projectWord(profA, bsA), projectWord(profB, bsB)].filter(Boolean),
      bridge_relations: bridgeRelations,
      shared_verse_ids: sharedVids,
      ...(sharedVerses.length > 0 ? { shared_passages: sharedVerses } : {}),
    };
  }

  if (
    expandId.startsWith('shared_lemma:') ||
    expandId.startsWith('shared_lemma_homograph:') ||
    expandId.startsWith('rare:hapax:')
  ) {
    const parts = expandId.split(':');
    const isHapax = expandId.startsWith('rare:hapax:');
    const bs = normStrongs4(isHapax ? (parts[2] || '') : (parts[1] || ''));
    const prof = bs ? await session.getProfile(bs) : null;
    const sampleVids = Array.isArray(prof?.all_vids) ? prof.all_vids.slice(0, detail === 'full' ? 10 : 5) : [];
    const passages = detail !== 'clue' && sampleVids.length > 0
      ? (await Promise.all(sampleVids.map(v => session.getVerse(v)))).filter(Boolean).map(v => ({
          vid: v.vid,
          ref: v.ref,
          en: v.en,
        }))
      : [];
    return {
      schema_version: 3,
      status: prof ? 'ok' : 'not_found',
      expand_id: expandId,
      detail,
      kind: parts[0],
      word: prof ? {
        strongs: prof.bs || bs,
        lemma_key: prof.lk,
        script: sanitizeV3TokenLemma(prof.bs || bs, String(prof.sc || '')),
        transliteration: prof.tr,
        gloss: prof.gl,
        total_verses: prof.total_verses ?? prof.canonical_df,
        senses: (prof.senses || []).slice(0, 6),
      } : null,
      ...(expandId.startsWith('shared_lemma_homograph:') ? { compared_senses: [parts[2], parts[3]].filter(Boolean) } : {}),
      ...(passages.length > 0 ? { passages } : {}),
    };
  }

  if (
    expandId.startsWith('direct_in_passage:') ||
    expandId.startsWith('lxx_in_passage:') ||
    expandId.startsWith('first_occ:') ||
    expandId.startsWith('passage_lexeme:')
  ) {
    const parts = expandId.split(':');
    const bs = normStrongs4(parts[1] || '') || normStrongs4(parts[parts.length - 1] || '');
    const rawRef = normStrongs4(parts[1] || '') ? parts.slice(2).join(':') : parts.slice(1, -1).join(':');
    const [prof, vids] = await Promise.all([
      bs ? session.getProfile(bs) : null,
      rawRef ? resolvePassagesToVidsV3(ctx, { passage: rawRef }) : [],
    ]);
    const verses = (await Promise.all(vids.slice(0, detail === 'full' ? 8 : 4).map(v => session.getVerse(v)))).filter(Boolean);
    const mtLxxEntries = expandId.startsWith('lxx_in_passage:') && vids.length > 0
      ? (await Promise.all(vids.slice(0, 3).map(v => session.getMtLxx(v)))).filter(Boolean)
      : [];
    return {
      schema_version: 3,
      status: (prof || verses.length > 0) ? 'ok' : 'not_found',
      expand_id: expandId,
      detail,
      kind: parts[0],
      ...(prof ? {
        word: {
          strongs: prof.bs || bs,
          script: sanitizeV3TokenLemma(prof.bs || bs, String(prof.sc || '')),
          transliteration: prof.tr,
          gloss: prof.gl,
        },
      } : {}),
      passages: verses.map(v => ({
        vid: v.vid,
        ref: v.ref,
        ...(detail !== 'clue' ? { en: v.en } : {}),
      })),
      ...(mtLxxEntries.length > 0 ? { lxx_alignments: mtLxxEntries.map(m => ({ ref: m.ref, shifts: m.shifts || [], links_count: (m.links || []).length })) } : {}),
    };
  }

  if (expandId.startsWith('intersect:')) {
    const bsList = expandId.slice('intersect:'.length).split('+').map(normStrongs4).filter(Boolean);
    const [bmw, profs] = await Promise.all([
      session.getBmw(),
      Promise.all(bsList.slice(0, 6).map(b => session.getProfile(b))),
    ]);
    const vids = (bmw && bsList.length > 0) ? intersectTerms(bmw, bsList, [], detail === 'full' ? 12 : 6) : [];
    const verses = detail !== 'clue' && vids.length > 0
      ? (await Promise.all(vids.map(v => session.getVerse(v)))).filter(Boolean).map(v => ({ vid: v.vid, ref: v.ref, en: v.en }))
      : [];
    return {
      schema_version: 3,
      status: profs.some(Boolean) ? 'ok' : 'not_found',
      expand_id: expandId,
      detail,
      kind: 'word_intersection',
      words: profs.filter(Boolean).map(p => ({ strongs: p.bs, script: sanitizeV3TokenLemma(p.bs, String(p.sc || '')), gloss: p.gl })),
      matched_verse_ids: vids,
      ...(verses.length > 0 ? { passages: verses } : {}),
    };
  }

  if (expandId.startsWith('nt_typological_citation:')) {
    const tail = expandId.slice('nt_typological_citation:'.length);
    const m = /^(.+?:\d+(?:-\d+)?):(.+)$/.exec(tail);
    const otRef = m ? m[1] : tail;
    const ntRef = m ? m[2] : '';
    const triRes = ntRef ? await handleTriTextualDiffV3(ctx, { target: ntRef, source: otRef }) : null;
    const otVids = otRef ? await resolvePassagesToVidsV3(ctx, { passage: otRef }) : [];
    const otVerses = (await Promise.all(otVids.slice(0, 3).map(v => session.getVerse(v)))).filter(Boolean);
    return {
      schema_version: 3,
      status: (triRes?.status === 'ok' || otVerses.length > 0) ? 'ok' : 'not_found',
      expand_id: expandId,
      detail,
      kind: 'nt_typological_citation',
      ot_ref: otRef,
      nt_ref: ntRef || null,
      ot_passages: otVerses.map(v => ({ vid: v.vid, ref: v.ref, en: v.en })),
      ...(triRes ? { tri_textual_diff: triRes } : {}),
    };
  }

  if (expandId.startsWith('r11:xref:')) {
    const [, , fromVidStr, toVidStr] = expandId.split(':');
    const [vf, vt] = await Promise.all([
      Number(fromVidStr) ? session.getVerse(Number(fromVidStr)) : null,
      Number(toVidStr) ? session.getVerse(Number(toVidStr)) : null,
    ]);
    return {
      schema_version: 3,
      status: (vf || vt) ? 'ok' : 'not_found',
      expand_id: expandId,
      detail,
      kind: 'cross_reference',
      passages: [vf, vt].filter(Boolean).map(v => ({ vid: v.vid, ref: v.ref, ...(detail !== 'clue' ? { en: v.en } : {}) })),
    };
  }

  if (expandId.startsWith('r13:proof:') || expandId.startsWith('r13:subgraph:path:')) {
    const reader = createWorkerR10Reader(ctx);
    const parts = expandId.split(':');
    const isProof = expandId.startsWith('r13:proof:');
    const proofType = isProof ? (parts[2] || 'proof') : 'subgraph_path';
    const rawTargets = isProof ? parts.slice(3).join(':').split('+').map(s => s.trim()).filter(Boolean) : [];
    const anchorWords = [];
    const anchorPassages = [];
    for (const tgt of rawTargets.slice(0, 6)) {
      const bs = normStrongs4(tgt);
      if (bs) {
        const p = await session.getProfile(bs);
        if (p) {
          anchorWords.push({
            strongs: p.bs || bs,
            script: sanitizeV3TokenLemma(p.bs || bs, String(p.sc || '')),
            transliteration: p.tr,
            gloss: p.gl,
            total_verses: p.total_verses ?? p.canonical_df,
          });
        } else {
          anchorWords.push({ strongs: bs });
        }
      } else {
        const vids = await resolvePassagesToVidsV3(ctx, { passage: tgt });
        if (vids.length > 0) {
          const v = await session.getVerse(vids[0]);
          if (v) anchorPassages.push({ vid: v.vid, ref: v.ref, ...(detail !== 'clue' ? { en: v.en } : {}) });
        }
      }
    }
    const [discRes, subgraphRes] = rawTargets.length >= 2
      ? await Promise.all([
          discoverBiblicalConnections(reader, {
            query: rawTargets.join(' ; '),
            mode: 'bridge',
            compare_targets: rawTargets,
            limit: 8,
          }, DEFAULT_R10_RELEASE),
          handleDiscoverSubgraphV1(ctx, { anchors: rawTargets, max_hops: 3 }),
        ])
      : [null, null];
    const evFallback = rawTargets.length === 0 ? await handleGetConnectionEvidenceV1(ctx, { evidence_id: expandId }) : null;
    const ok = Boolean(
      anchorWords.length > 0 ||
      anchorPassages.length > 0 ||
      (discRes?.strongest_connections?.length ?? 0) > 0 ||
      (subgraphRes?.paths?.length ?? 0) > 0 ||
      evFallback?.status === 'ok',
    );
    return {
      schema_version: 3,
      status: ok ? 'ok' : 'not_found',
      expand_id: expandId,
      detail,
      kind: isProof ? 'graph_proof' : 'subgraph_path',
      proof_type: proofType,
      targets: rawTargets,
      ...(anchorWords.length > 0 ? { words: anchorWords } : {}),
      ...(anchorPassages.length > 0 ? { passages: anchorPassages } : {}),
      ...(subgraphRes?.paths ? { verified_paths: subgraphRes.paths.slice(0, detail === 'full' ? 12 : 6) } : {}),
      ...(discRes?.strongest_connections ? { evidence_connections: discRes.strongest_connections.slice(0, detail === 'full' ? 10 : 6) } : {}),
      ...(evFallback?.evidence ? { evidence: evFallback.evidence } : {}),
    };
  }

  if (expandId.startsWith('ctrl:')) {
    const STATIC_CONTROLS = {
      'ctrl:rev1_20_vs_rev4_5': {
        control_kind: 'distinct_context_warning',
        title: 'Distinct imagery control: Rev 1:20 lampstands (λυχνίαι = churches) vs Rev 4:5 lamps (λαμπάδες = Spirits)',
        explanation: 'Revelation explicitly gives different referents for the seven lampstands (Rev 1:20 = seven churches) and the seven burning lamps (Rev 4:5 = seven Spirits of God). Do not merge all "seven + lamp" references into one meaning.',
        strongs: ['G3087', 'G2985'],
      },
      'ctrl:number_coincidence_guard': {
        control_kind: 'number_coincidence_warning',
        title: 'Number coincidence guard: shared numeral alone does not prove theological connection',
        explanation: 'Ordinal occurrences, temporal durations, and unrelated ordinary counts are separated from symbolic vision counts and penalized when context differs.',
      },
      'ctrl:exod14_event_vs_paul_typology': {
        control_kind: 'alternative_explanation',
        title: 'Historical event vs later NT typology (Exodus 14 vs 1 Corinthians 10:1–2)',
        explanation: 'Exodus 14 narrates historical deliverance without baptism vocabulary; Paul in 1 Cor 10:1–2 introduces the typological comparison. Avoid reading later baptismal symbolism into every Exodus 14 detail.',
      },
      'ctrl:adam_dam_not_etymology': {
        control_kind: 'orthographic_false_positive_warning',
        title: 'Orthographic false-etymology guard: אָדָם (adam) vs דָּם (dam)',
        explanation: 'While אָדָם (ʾ-d-m) orthographically contains ד-ם (d-m, blood), STEPBible/BDB treat them as distinct lexical entries with NO proven common historical root. Contrast this weak spelling overlap with the explicit Hebrew wordplay אָדָם ↔ אֲדָמָה (ground) in Gen 2:7.',
        strongs: ['H0120', 'H1818', 'H0127'],
      },
      'ctrl:missing_concepts': {
        control_kind: 'missing_evidence',
        title: 'Unresolved or unsupported query terms notice',
        explanation: 'One or more query terms did not match canonical original-language lemmas, motifs, or events in the index; no fabricated connections were added.',
      },
    };
    const staticCtrl = STATIC_CONTROLS[expandId];
    if (staticCtrl) {
      const profs = detail !== 'clue' && staticCtrl.strongs?.length
        ? (await Promise.all(staticCtrl.strongs.map(s => session.getProfile(s)))).filter(Boolean).map(p => ({
            strongs: p.bs,
            script: p.sc,
            transliteration: p.tr,
            gloss: p.gl,
            total_verses: p.total_verses,
          }))
        : [];
      return {
        schema_version: 3,
        status: 'ok',
        expand_id: expandId,
        detail,
        kind: 'methodological_control',
        ...staticCtrl,
        ...(profs.length ? { profiles: profs } : {}),
      };
    }

    const parts = expandId.split(':');
    const subKind = parts[1] || '';
    const bs1 = normStrongs4(parts[2] || '');
    const bs2 = normStrongs4(parts[3] || '');
    const [p1, p2] = await Promise.all([
      bs1 ? session.getProfile(bs1) : null,
      bs2 ? session.getProfile(bs2) : null,
    ]);
    const profList = [p1, p2].filter(Boolean).map(p => ({
      strongs: p.bs,
      script: p.sc,
      transliteration: p.tr,
      gloss: p.gl,
      total_verses: p.total_verses,
    }));
    let title = `Methodological disambiguation control (${subKind || expandId})`;
    let explanation = 'Methodological control emitted by the discovery engine to separate homographs, proper names, or distinct contexts.';
    if (subKind === 'orth_homograph' && p1) {
      title = `Hebrew consonantal homograph notice for ${p1.sc} (${p1.bs})`;
      const homs = (p1.orth_entry?.homographs || []).map(h => `${h.script} (${h.bs} "${h.gloss}")`).join(', ');
      explanation = homs
        ? `${p1.sc} shares its unpointed consonantal skeleton with distinct entry ${homs}.`
        : `Consonantal homograph boundary preserved for ${p1.sc} (${p1.bs}, "${p1.gl}").`;
    } else if (subKind === 'homograph_sibling' && p1) {
      title = p2
        ? `Homograph sibling: ${p1.sc} (${p1.gl} · ${p1.bs}) vs ${p2.sc} (${p2.gl} · ${p2.bs})`
        : `Homograph sibling notice for ${p1.sc} (${p1.bs})`;
      explanation = p2
        ? `Consonantal skeleton for ${p1.sc} (${p1.bs}) is shared with distinct lexical entry ${p2.sc} (${p2.bs}, "${p2.gl}"). Preserved separately to prevent confounding distinct biblical concepts.`
        : `Homograph sibling boundary preserved for ${p1.sc} (${p1.bs}).`;
    } else if (subKind === 'homograph_proper' && p1) {
      title = `Proper-name homograph distinction for ${p1.sc} (${p1.bs}, "${p1.gl}")`;
      explanation = `Original script ${p1.sc} can designate proper entity "${p1.gl}" (${p1.bs}); separated by default from common-noun homographs to prevent geographical or personal confounding.`;
    } else if (subKind === 'proper_vs_translit' && p1) {
      const term = parts[3] || '';
      title = `Proper-name vs transliteration guard: ${p1.sc} (${p1.bs}, "${p1.gl}")${term ? ` for "${term}"` : ''}`;
      explanation = `Non-proper entry ${p1.sc} (${p1.bs}, "${p1.gl}") is kept separate from exact proper-name matches${term ? ` for "${term}"` : ''}.`;
    }
    return {
      schema_version: 3,
      status: 'ok',
      expand_id: expandId,
      detail,
      kind: 'methodological_control',
      control_kind: subKind || 'disambiguation',
      title,
      explanation,
      ...(profList.length ? { profiles: profList } : {}),
    };
  }

  // Fallback to R10/R12/R13 evidence or node expansion
  if (expandId.includes(':') && !expandId.startsWith('lemma:') && !expandId.startsWith('cluster:')) {
    const ev = await handleGetConnectionEvidenceV1(ctx, { evidence_id: expandId });
    if (detail === 'clue' && ev.evidence) {
      return {
        schema_version: 3,
        status: ev.status,
        expand_id: expandId,
        detail,
        title: ev.evidence.title,
        predicate: ev.evidence.predicate,
        epistemic_class: ev.evidence.epistemic_class,
        evidence_tier: ev.evidence.evidence_tier,
        passages: (ev.evidence.passages || []).map(p => p.ref),
      };
    }
    return { schema_version: 3, expand_id: expandId, detail, ...ev };
  }

  const exp = await handleExpandBiblicalConnectionV1(ctx, { node_id: expandId, limit: clampLimit(params.limit, 8) });
  return { schema_version: 3, expand_id: expandId, detail, ...exp };
}

/**
 * 7. set_combine_v3
 * Zero-full-scan Boolean bitset / BMW intersection over v3/index/postings-bmw.bin.
 */
export async function handleSetCombineV3(ctx, params = {}) {
  const session = createV3SessionFromCtx(ctx);
  const bmw = await session.getBmw();
  if (!bmw) {
    return { schema_version: 3, status: 'unavailable', error: 'v3 postings-bmw.bin index unavailable.' };
  }

  const includeKeys = parseListParam(params.include).map(normalizeBmwKey).filter(Boolean);
  const excludeKeys = parseListParam(params.exclude).map(normalizeBmwKey).filter(Boolean);
  if (includeKeys.length === 0) {
    return { schema_version: 3, status: 'invalid_request', error: 'Provide non-empty include terms for set_combine_v3.' };
  }

  const testament = params.testament ? String(params.testament).toUpperCase() : 'ALL';
  const bookFilter = params.book != null && Number.isInteger(Number(params.book)) ? Number(params.book) : null;
  const mode = String(params.mode || 'intersect').toLowerCase() === 'ranked' ? 'ranked' : 'intersect';
  const limit = clampLimit(params.limit, 25);
  const hydrateVerses = parseBoolParam(params.hydrate_verses, true);

  const matchesScope = (vid) => {
    if (testament === 'OT' && vid > 23213) return false;
    if (testament === 'NT' && vid < 23214) return false;
    if (bookFilter !== null && bookForVidV3(vid) !== bookFilter) return false;
    return true;
  };

  let rawVids = [];
  let rankedScores = null;
  if (mode === 'ranked') {
    const hits = blockMaxWandTopK(bmw, includeKeys, Math.min(200, limit * 4), 1.0);
    const exclSet = new Set(excludeKeys.length > 0 ? intersectTerms(bmw, excludeKeys, [], NUM_VERSES) : []);
    rankedScores = new Map();
    for (const h of hits) {
      if (exclSet.has(h.vid) || !matchesScope(h.vid)) continue;
      rawVids.push(h.vid);
      rankedScores.set(h.vid, { score: Number(h.score.toFixed(3)), matched_count: h.matchedCount });
      if (rawVids.length >= limit) break;
    }
  } else {
    const allVids = intersectTerms(bmw, includeKeys, excludeKeys, NUM_VERSES);
    for (const vid of allVids) {
      if (matchesScope(vid)) rawVids.push(vid);
    }
  }

  const pagedVids = rawVids.slice(0, limit);
  const verses = [];
  if (hydrateVerses && pagedVids.length > 0) {
    const hydratedSlice = pagedVids.slice(0, 20);
    const vMap = await session.getVersesBatch(hydratedSlice);
    const loaded = hydratedSlice.map(v => vMap.get(v)).filter(Boolean);
    for (const v of loaded) {
      if (!v) continue;
      const sampleLemmas = [];
      const seenBs = new Set();
      for (const t of v.toks || []) {
        const bs = normStrongs4(t.s);
        if (!bs || t.is_func || seenBs.has(bs) || sampleLemmas.length >= 6) continue;
        seenBs.add(bs);
        sampleLemmas.push({ strongs: bs, surface: t.sf, gloss: t.g });
      }
      verses.push({
        vid: v.vid,
        expand_id: `v3:bmw:${v.vid}`,
        ref: v.ref,
        en: v.en,
        ...(rankedScores?.get(v.vid) ? rankedScores.get(v.vid) : {}),
        sample_lemmas: sampleLemmas,
      });
    }
  }

  return {
    schema_version: 3,
    status: 'ok',
    mode,
    include: includeKeys,
    exclude: excludeKeys,
    testament,
    ...(bookFilter !== null ? { book: bookFilter } : {}),
    total_matched: rawVids.length,
    returned: pagedVids.length,
    vids: pagedVids,
    verses,
  };
}

/**
 * 4. get_eside_interpretations_v4
 */
export async function handleGetEsideInterpretationsV4(ctx, params = {}) {
  const session = createV3SessionFromCtx(ctx);
  const vids = await resolvePassagesToVidsV3(ctx, params);
  if (vids.length > 0) {
    const slice = vids.slice(0, 24);
    const batch = await session.getV4EsideVidBatch(slice);
    const records = [];
    for (const v of slice) {
      const entry = batch.get(v);
      if (entry?.records?.length) records.push(...entry.records);
    }
    return { schema_version: 4, status: 'ok', vids: slice, records };
  }
  const strongs = params.strongs || params.word ? String(params.strongs || params.word).trim() : '';
  if (strongs) {
    const entry = await session.getV4EsideBs(strongs);
    return { schema_version: 4, status: 'ok', strongs, records: entry?.records || [] };
  }
  return { schema_version: 4, status: 'invalid_request', error: 'Provide passage/vid or strongs.' };
}

/**
 * 5. discover_structural_analogies_v4
 */
export async function handleDiscoverStructuralAnalogiesV4(ctx, params = {}) {
  const session = createV3SessionFromCtx(ctx);
  const [perTable, simOracle, rmacIdx] = await Promise.all([
    session.getV4Pericopes(),
    session.getV4PredSim(),
    session.getV4Rmac(),
  ]);
  if (!perTable || !simOracle || !rmacIdx) {
    return { schema_version: 4, status: 'unavailable', error: 'v4 HREG/R-MAC indexes unavailable.' };
  }
  const vids = await resolvePassagesToVidsV3(ctx, params);
  const pidSet = new Set();
  for (const v of vids) {
    for (const p of perTable.lookupVidPericopes(v)) pidSet.add(p);
  }
  for (const p of parseListParam(params.pericope_ids)) {
    const n = Number(p);
    if (Number.isInteger(n) && n >= 1 && n <= perTable.records.length) pidSet.add(n);
  }
  const seedPids = [...pidSet].slice(0, 6);
  if (seedPids.length === 0) return { schema_version: 4, status: 'not_found', matches: [] };
  const bMap = await session.getV4HregBatch(seedPids);

  if (parseBoolParam(params.seql, false) && seedPids.length >= 3) {
    const hregs = seedPids.map(p => bMap.get(p)).filter(Boolean);
    if (hregs.length >= 3) {
      return { schema_version: 4, status: 'ok', mode: 'seql', schema: runSeqlGeneralization(hregs, simOracle, { bPerm: 24 }) };
    }
  }

  const candMap = new Map();
  for (const sp of seedPids.slice(0, 2)) {
    const bh = bMap.get(sp);
    if (!bh) continue;
    for (const c of queryRmacCandidates(rmacIdx, bh, { kTotal: 20, pericopeTable: perTable })) {
      candMap.set(c.pericopeId, Math.max(candMap.get(c.pericopeId) || 0, c.combinedScore));
    }
  }
  const candPids = [...candMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(x => x[0]);
  const tMap = await session.getV4HregBatch(candPids);
  const matches = [];
  for (const sp of seedPids.slice(0, 2)) {
    const bh = bMap.get(sp);
    if (!bh) continue;
    for (const tp of candPids) {
      if (tp === sp) continue;
      const th = tMap.get(tp);
      if (!th) continue;
      const ev = evaluateSmePair(bh, th, simOracle, { bPerm: 24 });
      if (ev.pStruct < 0.05 && ev.deltaSmeStruct > 0) {
        matches.push({
          base_pericope_id: bh.pericopeId,
          target_pericope_id: th.pericopeId,
          target_start_vid: th.startVid,
          target_end_vid: th.endVid,
          regime: ev.regime,
          classification: ev.classification,
          sub_tag: ev.subTag,
          sms: Number(ev.winning.sms.toFixed(3)),
          p_struct: Number(ev.pStruct.toFixed(4)),
          delta_sme_struct: Number(ev.deltaSmeStruct.toFixed(3)),
          rho_ent: Number(ev.rhoEnt.toFixed(3)),
          mapped_events: ev.winning.mappedEvents.length,
          mapped_ho: ev.winning.mappedHo.length,
          candidate_inferences: ev.candidateInferences.slice(0, 4),
          divergences: ev.divergences.slice(0, 6),
        });
      }
    }
  }
  matches.sort((a, b) => b.delta_sme_struct - a.delta_sme_struct || b.sms - a.sms);
  const limit = clampLimit(params.limit, 8, 16);
  return { schema_version: 4, status: 'ok', mode: 'sme_rmac', seed_pericope_ids: seedPids, matches: matches.slice(0, limit) };
}


