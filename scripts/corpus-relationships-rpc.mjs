/**
 * scripts/corpus-relationships-rpc.mjs
 * Deterministic Cloudflare Worker RPC handlers for static cross-references
 * (`lookup_cross_references_v1`) and lexical relationships (`lookup_lexical_relationships_v1`).
 *
 * Immutable source evidence lives exclusively in Cloudflare Static Assets (`/v1/relationships/*`
 * and `/v1/lexical/*`). Zero runtime SQL or whole-corpus downloads.
 */

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

async function resolveLemmaV2(params, resolver, loadUncovered) {
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
    const low = rawKey.toLowerCase();
    for (const k of Object.keys(resolver.lemmas || {})) {
      if (k.toLowerCase() === low) return k;
    }
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
    const unc = await loadUncovered();
    return buildUncoveredProfile(lk, unc?.entries?.[lk], resolver.by_strongs_base);
  };

  // 1. Exact occurrence lookup by (book, chapter, verse, position)
  if (Number.isInteger(book) && Number.isInteger(chapter) && Number.isInteger(verse) && Number.isInteger(position) && position > 0) {
    const ref = canonicalRefV2(book, chapter, verse);
    const edCandidates = editionParam && editionParam !== 'all'
      ? [editionParam]
      : book <= 39
        ? ['macula-hebrew-wlc']
        : ['macula-greek-nestle1904', 'macula-greek-sblgnt'];
    for (const ed of edCandidates) {
      const occ = resolver.occurrence_to_lemma?.[`${ed}:${ref}#${position}`];
      if (occ?.lemma_id) {
        explicitExactId = occ.lemma_id;
        resolvedOccurrence = occ;
        break;
      }
    }
  }

  // 2. Exact token_id lookup
  if (!explicitExactId && (tokenIdParam || /^[on]\d{8,14}$/.test(query))) {
    const tid = tokenIdParam || query;
    const edPrefix = tid.startsWith('o') ? 'macula-hebrew-wlc' : (editionParam && editionParam !== 'all' ? editionParam : 'macula-greek-nestle1904');
    const lk = resolver.token_to_lemma?.[`${edPrefix}:${tid}`] || resolver.token_to_lemma?.[`macula-greek-sblgnt:${tid}`];
    if (lk) explicitExactId = lk;
  }

  // 3. Explicit lemma_id / p_lemma_key
  if (!explicitExactId && lemmaIdParam) {
    explicitExactId = await findExactLemmaKey(lemmaIdParam);
  }

  // 4. Explicit extended_strongs from reader/lexeme metadata (disambiguates homographs in uncovered verses!)
  if (!explicitExactId && extendedStrongsParam) {
    const parsedExt = parseStrongsInputV2(extendedStrongsParam);
    if (parsedExt.isStrongs) {
      if (parsedExt.suffix) {
        for (const c of parsedExt.exactLemmaCandidates) {
          const hit = await findExactLemmaKey(c);
          if (hit) { explicitExactId = hit; break; }
        }
      } else {
        const list = resolver.by_strongs_base?.[parsedExt.baseCompact] || [];
        if (list.length === 1) explicitExactId = list[0];
        else candidateIds = list;
      }
    }
  }

  // 5. Explicit word_id lookup (when unambiguous or disambiguates siblings)
  if (!explicitExactId && Number.isInteger(wordIdParam) && wordIdParam > 0) {
    const byWid = resolver.by_word_id?.[String(wordIdParam)] || [];
    if (byWid.length === 1) {
      explicitExactId = byWid[0];
    } else if (byWid.length > 1) {
      candidateIds = byWid;
    }
  }

  // 6. Query string resolution (lemma:ID, extended Strong's, base Strong's, or surface form)
  if (!explicitExactId && query) {
    const direct = await findExactLemmaKey(query);
    if (direct) {
      explicitExactId = direct;
    } else {
      const parsed = parseStrongsInputV2(query);
      if (parsed.isStrongs) {
        if (parsed.suffix) {
          for (const c of parsed.exactLemmaCandidates) {
            const hit = await findExactLemmaKey(c);
            if (hit) { explicitExactId = hit; break; }
          }
        } else {
          const sibs = resolver.by_strongs_base?.[parsed.baseCompact] || [];
          if (candidateIds.length > 0 && sibs.length > 0) {
            const inter = candidateIds.filter(x => sibs.includes(x));
            if (inter.length === 1) explicitExactId = inter[0];
            else if (inter.length > 1) candidateIds = inter;
          } else if (sibs.length === 1) {
            explicitExactId = sibs[0];
          } else if (sibs.length > 1) {
            candidateIds = sibs;
          }
        }
      } else if (resolver.by_surface_form?.[query]) {
        const hits = resolver.by_surface_form[query];
        if (hits.length === 1) explicitExactId = hits[0];
        else if (hits.length > 1) candidateIds = hits;
      }
    }
  }

  if (explicitExactId) {
    const profile = await getProfile(explicitExactId);
    const sibProfiles = await Promise.all((profile?.homograph_siblings || [explicitExactId]).map(getProfile));
    return {
      status: 'ok',
      lemma_id: explicitExactId,
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

  if (candidateIds.length === 1) {
    const profile = await getProfile(candidateIds[0]);
    const sibProfiles = await Promise.all((profile?.homograph_siblings || candidateIds).map(getProfile));
    return {
      status: 'ok',
      lemma_id: candidateIds[0],
      profile,
      homograph_siblings: sibProfiles.filter(Boolean),
      homograph_candidates: [],
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

export async function handleQueryRelationshipsV2(ctx, params = {}) {
  const active = await ctx.loadJsonShard(ctx.env, '/v2/relationships/active.json.gz');
  if (!active || !active.active_release) {
    return {
      schema_version: '2.0',
      status: 'unavailable',
      error_message: 'Relationship graph v2 active pointer not found.',
    };
  }
  const releaseVersion = String(params.release || params.release_version || active.active_release).trim();
  const baseDir = `/v2/relationships/${releaseVersion}`;
  const manifest = await ctx.loadJsonShard(ctx.env, `${baseDir}/manifest.json.gz`);
  if (!manifest) {
    return {
      schema_version: '2.0',
      status: 'release_not_found',
      release_version: releaseVersion,
      error_message: `Unknown relationship graph release: ${releaseVersion}`,
    };
  }

  let rawOp = String(params.op || '').trim().toLowerCase();
  if (!rawOp) {
    if (params.summary_id || params.relation_id || params.relation_ids) rawOp = 'evidence';
    else if (params.query || params.lemma_id || params.p_lemma_key || params.word_id || params.p_word_id || params.position != null || params.word_position != null) rawOp = 'lemma_relationships';
    else if (params.book != null && params.chapter != null && params.verse != null) rawOp = 'passage_frames';
    else rawOp = 'coverage';
  }

  const baseEnvelope = {
    schema_version: '2.0',
    release_version: releaseVersion,
    rule_version: manifest.rule_version,
    source_git_commit: manifest.source_git_commit,
    epistemic_layer: 'static_source_evidence',
  };

  if (rawOp === 'coverage') {
    const [cov, qual, resolver] = await Promise.all([
      ctx.loadJsonShard(ctx.env, `${baseDir}/coverage-report.json.gz`),
      ctx.loadJsonShard(ctx.env, `${baseDir}/quality-report.json.gz`),
      ctx.loadJsonShard(ctx.env, `${baseDir}/resolver-index.json.gz`),
    ]);
    let passageCoverage = null;
    if (params.book != null && params.chapter != null && params.verse != null) {
      const ref = canonicalRefV2(params.book, params.chapter, params.verse);
      const ed = params.edition_key || params.edition || defaultEditionForBook(params.book);
      const coveredSet = new Set(resolver?.covered_passages_by_edition?.[ed] || []);
      passageCoverage = {
        reference: ref,
        edition: ed,
        covered: coveredSet.has(ref),
      };
    }
    return {
      ...baseEnvelope,
      status: 'ok',
      active_pointer: active,
      manifest_counts: manifest.counts,
      source_releases: manifest.source_releases,
      upstream_bibleontology_commit: manifest.upstream_bibleontology_commit,
      supported_predicates: manifest.predicates || R3_PREDICATES,
      predicate_meta: manifest.predicate_meta || resolver?.predicate_meta || {},
      covered_passages_by_edition: resolver?.covered_passages_by_edition || {},
      coverage_report: cov,
      quality_report: qual,
      ...(passageCoverage ? { passage_coverage: passageCoverage } : {}),
    };
  }

  const resolver = await ctx.loadJsonShard(ctx.env, `${baseDir}/resolver-index.json.gz`);
  if (!resolver) {
    return { ...baseEnvelope, status: 'unavailable', error_message: 'Missing resolver index shard.' };
  }
  const loadUncovered = () => ctx.loadJsonShard(ctx.env, `${baseDir}/uncovered-lemmas.json.gz`);

  if (rawOp === 'resolve') {
    const res = await resolveLemmaV2(params, resolver, loadUncovered);
    return {
      ...baseEnvelope,
      status: res.status,
      lemma_id: res.lemma_id,
      profile: res.profile,
      homograph_siblings: res.homograph_siblings,
      homograph_candidates: res.homograph_candidates,
      resolved_occurrence: res.resolved_occurrence,
      coverage_notice: res.status === 'needs_disambiguation'
        ? 'Base Strong\'s number maps to multiple distinct canonical lemmas (homographs). Specify an exact lemma_id (with suffix) or passage word position.'
        : (res.profile && !res.profile.in_r3_graph
          ? `Canonical lemma resolved, but outside the current verified ${releaseVersion} pilot graph (${manifest.counts.frames_emitted} frames across ${Object.values(manifest.counts.covered_passages_by_edition).reduce((a, b) => a + b, 0)} passage-editions).`
          : null),
    };
  }

  if (rawOp === 'passage' || rawOp === 'passage_frames') {
    const book = Number(params.book);
    const chapter = Number(params.chapter);
    const verse = Number(params.verse);
    if (!Number.isInteger(book) || book < 1 || book > 66 || !Number.isInteger(chapter) || chapter < 1 || !Number.isInteger(verse) || verse < 0) {
      return { ...baseEnvelope, status: 'invalid_request', error_message: 'Valid book (1-66), chapter (>=1), and verse (>=0) are required.' };
    }
    const edition = String(params.edition_key || params.edition || defaultEditionForBook(book));
    const ref = canonicalRefV2(book, chapter, verse);
    if ((book <= 39) !== edition.startsWith('macula-hebrew-')) {
      return {
        ...baseEnvelope,
        status: 'invalid_edition_for_testament',
        source_mode: 'unavailable',
        canonical_reference: { book, chapter, verse, ref },
        edition,
        supported_predicates: manifest.predicates || R3_PREDICATES,
        counts: { frames: 0, relations: 0, candidate_relations: 0 },
        frames: [],
        relations: [],
        note: 'Books 1-39 use macula-hebrew-wlc; books 40-66 use macula-greek-nestle1904 or macula-greek-sblgnt.',
      };
    }

    const includeCandidates = parseBoolParam(params.include_candidates ?? params.include_uncertain, true);
    const passagesShard = await ctx.loadJsonShard(ctx.env, `${baseDir}/passages-by-ref.json.gz`);
    const entry = passagesShard?.passages?.[`${edition}:${ref}`];
    if (!entry) {
      return {
        ...baseEnvelope,
        status: 'not_covered',
        source_mode: 'not_covered',
        canonical_reference: { book, chapter, verse, ref },
        edition,
        supported_predicates: manifest.predicates || R3_PREDICATES,
        counts: { frames: 0, relations: 0, candidate_relations: 0 },
        frames: [],
        relations: [],
        note: `Passage ${ref} (${edition}) is outside the current verified ${releaseVersion} pilot graph (${manifest.counts.frames_emitted} frames, ${manifest.counts.occurrence_relations_emitted} relations).`,
      };
    }

    const allFrames = entry.frames || [];
    const allRelations = entry.relations || [];
    if (allFrames.length > 0 && allFrames.every(f => f.source?.alignment_status === 'not_in_canonical_verse')) {
      return {
        ...baseEnvelope,
        status: 'not_in_canonical_verse',
        source_mode: 'not_covered',
        canonical_reference: { book, chapter, verse, ref },
        edition,
        supported_predicates: manifest.predicates || R3_PREDICATES,
        counts: { frames: allFrames.length, relations: 0, candidate_relations: 0 },
        frames: allFrames,
        relations: [],
        note: 'Requested reference is marked not_in_canonical_verse and is excluded from verified passage extraction.',
      };
    }

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

    const status = (frames.length === 0 && relations.length === 0) ? 'no_evidence_in_covered_scope' : 'ok';
    return {
      ...baseEnvelope,
      status,
      source_mode: 'cloudflare_r5_graph',
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
    };
  }

  if (rawOp === 'evidence') {
    const evShard = await ctx.loadJsonShard(ctx.env, `${baseDir}/evidence-by-id.json.gz`);
    if (!evShard) return { ...baseEnvelope, status: 'unavailable', error_message: 'Missing evidence shard.' };
    const includeUncertain = parseBoolParam(params.include_uncertain ?? params.include_candidates, false);
    const limit = clampLimit(params.limit, 25);
    const offset = Math.max(0, Number(params.offset) || 0);

    let relIds = [];
    if (params.summary_id) {
      relIds = evShard.by_summary_id?.[String(params.summary_id)] || [];
    } else if (params.relation_id) {
      relIds = [String(params.relation_id)];
    } else if (Array.isArray(params.relation_ids)) {
      relIds = params.relation_ids.map(String);
    }
    let records = relIds.map(id => evShard.by_relation_id?.[id]).filter(Boolean);
    if (!includeUncertain) {
      records = records.filter(r => r.quality !== 'candidate');
    }
    const pageSlice = records.slice(offset, offset + limit);
    return {
      ...baseEnvelope,
      status: records.length > 0 ? 'ok' : 'no_evidence_in_covered_scope',
      summary_id: params.summary_id || null,
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

  const res = await resolveLemmaV2(params, resolver, loadUncovered);
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
      coverage_notice: 'Could not resolve query to a canonical lemma in the index.',
    };
  }

  let passageCoverageInfo = null;
  if (filterToPassage && hasPassageCoords) {
    const pRef = canonicalRefV2(filterBook, filterChapter, filterVerse);
    const pEd = editionFilter || defaultEditionForBook(filterBook);
    const coveredSet = new Set(resolver.covered_passages_by_edition?.[pEd] || []);
    passageCoverageInfo = { reference: pRef, edition: pEd, covered: coveredSet.has(pRef) };
    if (!coveredSet.has(pRef)) {
      return {
        ...baseEnvelope,
        status: 'not_covered',
        focus: res.profile,
        homograph_siblings: res.homograph_siblings,
        resolved_occurrence: res.resolved_occurrence,
        passage_scope: passageCoverageInfo,
        category_groups: [],
        summaries: [],
        relations: [],
        page: { limit, offset, returned: 0, total_available: 0, has_more: false, next_offset: null },
        coverage_notice: `Passage ${pRef} (${pEd}) is outside the current verified ${releaseVersion} pilot graph.`,
      };
    }
  }

  const [byLemmaShard, evShard] = await Promise.all([
    ctx.loadJsonShard(ctx.env, `${baseDir}/by-lemma.json.gz`),
    ctx.loadJsonShard(ctx.env, `${baseDir}/evidence-by-id.json.gz`),
  ]);

  const lemmaEntry = byLemmaShard?.entries?.[res.lemma_id];
  if (!lemmaEntry) {
    const pCovered = hasPassageCoords && (resolver.covered_passages_by_edition?.[editionFilter || defaultEditionForBook(filterBook)] || []).includes(canonicalRefV2(filterBook, filterChapter, filterVerse));
    return {
      ...baseEnvelope,
      status: pCovered ? 'no_evidence_in_covered_scope' : 'not_covered',
      focus: res.profile,
      homograph_siblings: res.homograph_siblings,
      resolved_occurrence: res.resolved_occurrence,
      passage_scope: passageCoverageInfo,
      category_groups: [],
      summaries: [],
      relations: [],
      page: { limit, offset, returned: 0, total_available: 0, has_more: false, next_offset: null },
      coverage_notice: pCovered
        ? `Passage is in ${releaseVersion} pilot scope, and ${res.lemma_id} has no extracted R3 grammatical relations under the current rules.`
        : `${res.lemma_id} (${res.profile?.lemma_form || ''}) is not yet covered in the current verified ${releaseVersion} pilot graph (${manifest.counts.distinct_lemmas_in_graph} lemmas across ${manifest.counts.frames_emitted} frames). Absence here reflects pilot coverage limits, not absence in Scripture.`,
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

  // Build exact occurrence evidence list matching filters
  const pFilterRef = filterToPassage && hasPassageCoords ? canonicalRefV2(filterBook, filterChapter, filterVerse) : null;
  const matchingRelations = [];
  const summaryIdsWithPassageMatch = new Set();

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

  if (pFilterRef) {
    filteredSummaries = filteredSummaries.filter(s => summaryIdsWithPassageMatch.has(s.summary_id));
  }

  // Group into clear categories (forward and inverse separately)
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
    grp.items.push(s);
  }
  for (const grp of groupMap.values()) {
    grp.items.sort((a, b) => (b.stats?.occurrences || 0) - (a.stats?.occurrences || 0) || String(a.related_lemma_id).localeCompare(String(b.related_lemma_id)));
  }
  const categoryGroups = [...groupMap.values()];

  const scopeKey = `v2:${releaseVersion}:${res.lemma_id}:${direction}:${editionFilter || 'all'}:${includeUncertain ? '1' : '0'}:${pFilterRef || '*'}:${predicateList.join(',')}`;
  const cursorRes = params.cursor ? decodeCursor(params.cursor, scopeKey) : { ok: true, offset };
  const pageOffset = cursorRes.ok ? cursorRes.offset : offset;
  const pagedSummaries = filteredSummaries.slice(pageOffset, pageOffset + limit);
  const nextOffset = pageOffset + pagedSummaries.length;
  const hasMore = nextOffset < filteredSummaries.length;

  const status = filteredSummaries.length > 0 ? 'ok' : 'no_evidence_in_covered_scope';
  return {
    ...baseEnvelope,
    status,
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
    coverage_notice: status === 'no_evidence_in_covered_scope'
      ? `Lemma ${res.lemma_id} has ${rawPool.length} summary records in ${releaseVersion}, but 0 match the current filters (${editionFilter || 'all editions'}, include_uncertain=${includeUncertain}${pFilterRef ? `, passage=${pFilterRef}` : ''}).`
      : null,
  };
}

