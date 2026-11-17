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
import {
  DEFAULT_R10_RELEASE,
  discoverBiblicalConnections,
  expandBiblicalConnection,
  getConnectionEvidence,
} from '../src/relationships/r10-discovery.ts';

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

  const dedupOut = deduplicateXrefEdges(rawOut);
  const dedupIn = deduplicateXrefEdges(rawIn);
  const combined = [
    ...dedupOut.map(item => ({ kind: 'out', item })),
    ...dedupIn.map(item => ({ kind: 'in', item })),
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
  return {
    async readJson(assetPath) {
      if (ctx.env?.__r12Trace) ctx.env.__r12Trace.phases.r10_reader++;
      if (typeof ctx.loadJsonShardWithBytes === 'function') {
        return await ctx.loadJsonShardWithBytes(ctx.env, assetPath);
      }
      const data = await ctx.loadJsonShard(ctx.env, assetPath);
      return data ? { data, bytes: 0 } : null;
    },
    async readBytes() {
      return null;
    },
  };
}

export async function handleDiscoverBiblicalConnectionsV1(ctx, params = {}) {
  const queryText = String(params.query || params.q || params.topic || '').trim();
  const concepts = parseOptionalListParam(params.concepts);
  if (!queryText && (!concepts || concepts.length === 0)) {
    return {
      schema_version: 1,
      status: 'invalid_request',
      error: 'Provide non-empty query or concepts for biblical connection discovery.',
    };
  }
  const reader = createWorkerR10Reader(ctx);
  const releaseId = params.release_id ? String(params.release_id).trim() : DEFAULT_R10_RELEASE;
  const limit = params.limit !== undefined ? Math.min(25, Math.max(1, finiteOr(params.limit, 10))) : 10;
  return await discoverBiblicalConnections(reader, {
    query: queryText || (concepts ? concepts.join(' ') : ''),
    concepts,
    mode: params.mode ? String(params.mode) : undefined,
    cluster_id: params.cluster_id ? String(params.cluster_id) : undefined,
    focus_lemma: params.focus_lemma ? String(params.focus_lemma) : undefined,
    compare_targets: parseOptionalListParam(params.compare_targets),
    filters: params.filters && typeof params.filters === 'object' ? params.filters : undefined,
    limit,
    cursor: params.cursor ? String(params.cursor) : null,
    max_hops: params.max_hops !== undefined ? finiteOr(params.max_hops, 3) : 3,
    release_id: releaseId,
  }, releaseId);
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

