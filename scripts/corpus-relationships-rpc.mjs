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

  if (startId == null) {
    const edEntry =
      bookShard?.edition_only_by_coord?.[`${chapter}:${verse}`] ||
      relManifest?.edition_only_verses?.[`${book}:${chapter}:${verse}`] ||
      null;
    if (edEntry) {
      const edEndpoint = edEntry.endpoint || edEntry;
      const outEdges = direction === 'incoming' ? [] : deduplicateXrefEdges(edEntry.outgoing || []);
      const inEdges = direction === 'outgoing' ? [] : deduplicateXrefEdges(edEntry.incoming || []);
      return {
        schema_version: 1,
        status: 'edition_only_passage',
        epistemic_layer: 'static_source_evidence',
        query_passage: edEndpoint,
        direction,
        outgoing: outEdges.slice(0, limit),
        incoming: inEdges.slice(0, limit),
        page: {
          limit,
          returned: Math.min(limit, outEdges.length + inEdges.length),
          total_available: outEdges.length + inEdges.length,
          next_cursor: null,
          has_more: false,
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
        if (translationFilter === 'bsb' && !e.anchor?.phrase_bsb && e.anchor?.anchor_scope !== 'whole_verse') continue;
        if (translationFilter === 'kjv' && !e.anchor?.phrase_kjv && e.anchor?.anchor_scope !== 'whole_verse') continue;
        rawOut.push(e);
      }
    }
    if (direction !== 'outgoing') {
      for (const e of bookShard.incoming_by_verse?.[coord] || []) {
        rawIn.push(e);
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
