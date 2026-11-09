// @file: src/api/relationships-rpc.ts
// @feature: api
// @tables: entity_relationships | lemma_root_links | lexical_formations | lemma_components | lexical_connections | lemmas | lexemes | notes
// @candidates: none
// @toc: imports | logic:validation | logic:cross-references | logic:lexical | logic:gateway

// === @section:imports ===
import { callCorpusRpc, type CorpusClientOptions } from './corpus-client';
import { CROSS_REFERENCE_GUARDRAILS } from './relationship-model';
import {
  buildNotePrefillFromCrossReference,
  buildNotePrefillFromLexicalEdge,
  extractRelationshipEvaluation,
  indexNotesByRelationshipId,
} from './relationship-notes-adapter';
import type {
  CrossReferenceLookupRequest,
  CrossReferenceLookupResponse,
  LexicalRelationshipLookupRequest,
  LexicalRelationshipLookupResponse,
  RelationshipSourceProvenance,
} from './relationship-types';
import type { DataResult } from './types';

// === @section:logic:validation ===
const DEFAULT_XREF_ATTRIBUTION: RelationshipSourceProvenance = {
  source_key: 'crossreferences_org_v1',
  source_title: 'CrossReferences.org Biblical Cross-References',
  dataset_url: 'https://github.com/CrossReferences-org/bible-cross-references',
  pinned_commit: '671bbf73b1e5155e31b209442dc5be3f5b3c1a41',
  license: 'CC BY 4.0',
  attribution: 'CrossReferences.org (BSB/KJV Public Domain English anchors; S21 excluded)',
  locator: 'json/cross_references.json',
  raw_field: 'refs',
  algorithm_version: null,
  excluded_restricted_fields: ['s21'],
};

function clampPageLimit(limit: number | undefined, fallback = 25): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(1, Math.floor(limit)), 100);
}

function isValidBookChapterVerse(book: number, chapter: number, verse: number): boolean {
  return (
    Number.isInteger(book) &&
    book >= 1 &&
    book <= 66 &&
    Number.isInteger(chapter) &&
    chapter >= 1 &&
    chapter <= 150 &&
    Number.isInteger(verse) &&
    verse >= 0 &&
    verse <= 200
  );
}

// === @section:logic:cross-references ===
export async function lookupCrossReferences(
  req: CrossReferenceLookupRequest,
  opts: CorpusClientOptions = {}
): Promise<DataResult<CrossReferenceLookupResponse>> {
  const direction = req.direction ?? 'both';
  const limit = clampPageLimit(req.limit, 25);

  if (!isValidBookChapterVerse(req.book, req.chapter, req.verse)) {
    return {
      data: {
        schema_version: 1,
        status: 'invalid_reference',
        epistemic_layer: 'static_source_evidence',
        query_passage: null,
        direction,
        outgoing: [],
        incoming: [],
        page: { limit, returned: 0, total_available: 0, next_cursor: null, has_more: false },
        guardrails: CROSS_REFERENCE_GUARDRAILS,
        dataset_attribution: DEFAULT_XREF_ATTRIBUTION,
        error_message: 'Book must be 1..66, chapter >= 1, and verse >= 0 (0 reserved for Psalm headings).',
      },
      source: 'unavailable',
      error: 'Invalid passage coordinates.',
    };
  }

  const res = await callCorpusRpc<CrossReferenceLookupResponse>(
    'lookup_cross_references_v1',
    {
      p_book: req.book,
      p_chapter: req.chapter,
      p_verse: req.verse,
      p_verse_end: req.verse_end ?? null,
      p_direction: direction,
      p_translation_filter: req.translation_filter ?? 'all',
      p_limit: limit,
      p_cursor: req.cursor ?? null,
    },
    opts
  );

  if (!res.data) {
    return {
      data: {
        schema_version: 1,
        status: 'not_in_slice',
        epistemic_layer: 'static_source_evidence',
        query_passage: null,
        direction,
        outgoing: [],
        incoming: [],
        page: { limit, returned: 0, total_available: 0, next_cursor: null, has_more: false },
        guardrails: CROSS_REFERENCE_GUARDRAILS,
        dataset_attribution: DEFAULT_XREF_ATTRIBUTION,
        error_message: res.error ?? 'Static corpus cross-reference shard unavailable.',
      },
      source: 'unavailable',
      error: res.error ?? 'Static corpus cross-reference shard unavailable.',
    };
  }
  return { data: res.data, source: res.source, error: res.error };
}

// === @section:logic:lexical ===
export async function lookupLexicalRelationships(
  req: LexicalRelationshipLookupRequest,
  opts: CorpusClientOptions = {}
): Promise<DataResult<LexicalRelationshipLookupResponse>> {
  const limit = clampPageLimit(req.limit, 30);
  const query = req.query?.trim() ?? null;
  const lemmaKey = req.lemma_key?.trim() ?? null;
  const wordId = typeof req.word_id === 'number' && Number.isInteger(req.word_id) ? req.word_id : null;

  if (!query && !lemmaKey && (wordId === null || wordId <= 0)) {
    return {
      data: {
        schema_version: 1,
        status: 'invalid_request',
        epistemic_layer: 'static_source_evidence',
        focus: null,
        homograph_siblings: [],
        edges: [],
        category_counts: {},
        epistemic_counts: {},
        page: { limit, returned: 0, total_available: 0, next_cursor: null, has_more: false },
        error_message: 'Provide query (Strong’s or original word), lemma_key, or positive word_id.',
      },
      source: 'unavailable',
      error: 'Missing lexical lookup target.',
    };
  }

  const res = await callCorpusRpc<LexicalRelationshipLookupResponse>(
    'lookup_lexical_relationships_v1',
    {
      p_query: query,
      p_word_id: wordId,
      p_lemma_key: lemmaKey,
      p_categories: req.categories ?? null,
      p_epistemic_tiers: req.epistemic_tiers ?? null,
      p_include_statistical: req.include_statistical ?? true,
      p_limit: limit,
      p_cursor: req.cursor ?? null,
    },
    opts
  );

  if (!res.data) {
    return {
      data: {
        schema_version: 1,
        status: 'not_found',
        epistemic_layer: 'static_source_evidence',
        focus: null,
        homograph_siblings: [],
        edges: [],
        category_counts: {},
        epistemic_counts: {},
        page: { limit, returned: 0, total_available: 0, next_cursor: null, has_more: false },
        error_message: res.error ?? 'Static corpus lexical relationship shard unavailable.',
      },
      source: 'unavailable',
      error: res.error ?? 'Static corpus lexical relationship shard unavailable.',
    };
  }
  return { data: res.data, source: res.source, error: res.error };
}

// === @section:logic:gateway ===
export const RelationshipsRPC = {
  lookupCrossReferences,
  lookupLexicalRelationships,
  buildNotePrefillFromCrossReference,
  buildNotePrefillFromLexicalEdge,
  extractRelationshipEvaluation,
  indexNotesByRelationshipId,
};
