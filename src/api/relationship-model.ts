// @file: src/api/relationship-model.ts
// @feature: api
// @tables: entity_relationships | lemma_root_links | lexical_formations | lemma_components | lexical_connections | lemmas | lexemes
// @candidates: logic:hash | logic:identity | logic:pagination
// @toc: imports | logic:hash | logic:identity | logic:dedup-xrefs | logic:dedup-lexical | logic:pagination

// === @section:imports ===
import type {
  CanonicalPassageEndpoint,
  CrossReferenceEdge,
  CrossReferenceGuardrails,
  LexicalEndpointRef,
  LexicalGuardrails,
  LexicalRelationshipCategory,
  LexicalRelationshipEdge,
  RelationshipEpistemicTier,
  RelationshipPageInfo,
} from './relationship-types';

// === @section:logic:hash ===
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function fnv1a64Hex(input: string): string {
  let hash = FNV_OFFSET_64;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

export const CROSS_REFERENCE_GUARDRAILS: CrossReferenceGuardrails = Object.freeze({
  association_only: true,
  implies_quotation: false,
  implies_prophecy: false,
  implies_typology: false,
  implies_theological_equivalence: false,
});

const SYMMETRIC_LEXICAL_CATEGORIES = new Set<LexicalRelationshipCategory>([
  'same_lemma',
  'same_documented_root',
  'semantic_overlap',
  'synonymy',
  'antonymy',
  'related_translation',
  'literary_wordplay',
  'orthographic_overlap',
  'co_occurrence',
]);

export function isSymmetricLexicalCategory(category: LexicalRelationshipCategory): boolean {
  return SYMMETRIC_LEXICAL_CATEGORIES.has(category);
}

// === @section:logic:identity ===
export function endpointSpanKey(ep: CanonicalPassageEndpoint): string {
  if (ep.versification_status === 'edition_only_non_canonical' && ep.edition_only_ref) {
    const r = ep.edition_only_ref;
    return `ed:${r.edition}:${r.book}:${r.chapter}:${r.verse}`;
  }
  if (ep.verse_start === ep.verse_end) {
    return `v:${ep.book}:${ep.chapter}:${ep.verse_start}`;
  }
  return `r:${ep.book}:${ep.chapter}:${ep.verse_start}-${ep.verse_end}`;
}

export function targetClusterKey(spans: CanonicalPassageEndpoint[]): string {
  return spans.map(endpointSpanKey).join('+');
}

export function buildCrossReferenceRelationshipId(params: {
  sourceKey: string;
  sourcePassage: CanonicalPassageEndpoint;
  subverseSort: number;
  anchorSort: number;
  targetSpans: CanonicalPassageEndpoint[];
}): string {
  const srcKey = endpointSpanKey(params.sourcePassage);
  const tgtKey = targetClusterKey(params.targetSpans);
  const raw = `xref|${params.sourceKey}|${srcKey}|s${params.subverseSort}|a${params.anchorSort}|${tgtKey}`;
  const digest = fnv1a64Hex(raw).slice(0, 12);
  return `rel:v1:xref:${params.sourceKey}:${srcKey}:s${params.subverseSort}:a${params.anchorSort}:${digest}`;
}

export function buildLexicalRelationshipId(params: {
  sourceKey: string;
  category: LexicalRelationshipCategory;
  rawRelationCode: string;
  epistemicTier: RelationshipEpistemicTier;
  subjectKey: string;
  targetKey: string;
   symmetric?: boolean;
}): string {
  const sym = params.symmetric ?? isSymmetricLexicalCategory(params.category);
  const [a, b] = sym && params.subjectKey > params.targetKey
    ? [params.targetKey, params.subjectKey]
    : [params.subjectKey, params.targetKey];
  const arrow = sym ? '<->' : '->';
  const raw = `lex|${params.sourceKey}|${params.category}|${params.rawRelationCode}|${params.epistemicTier}|${a}${arrow}${b}`;
  const digest = fnv1a64Hex(raw).slice(0, 12);
  return `rel:v1:lex:${params.category}:${a}:${b}:${digest}`;
}

// === @section:logic:dedup-xrefs ===
export function deduplicateCrossReferenceEdges(edges: CrossReferenceEdge[]): CrossReferenceEdge[] {
  const byAnchorTarget = new Map<string, CrossReferenceEdge>();
  for (const edge of edges) {
    const srcKey = endpointSpanKey(edge.source_passage);
    const tgtKey = targetClusterKey(edge.target_spans);
    const dedupKey = [
      edge.provenance.source_key,
      edge.direction,
      srcKey,
      edge.anchor.source_subverse_sort,
      edge.anchor.anchor_sort,
      tgtKey,
    ].join('|');
    const existing = byAnchorTarget.get(dedupKey);
    if (!existing || edge.group_ordinal < existing.group_ordinal) {
      byAnchorTarget.set(dedupKey, edge);
    }
  }
  return [...byAnchorTarget.values()].sort((a, b) => {
    if (a.rank_order !== b.rank_order) return a.rank_order - b.rank_order;
    const sA = a.source_passage;
    const sB = b.source_passage;
    if (sA.book !== sB.book) return sA.book - sB.book;
    if (sA.chapter !== sB.chapter) return sA.chapter - sB.chapter;
    if (sA.verse_start !== sB.verse_start) return sA.verse_start - sB.verse_start;
    if (a.anchor.source_subverse_sort !== b.anchor.source_subverse_sort) {
      return a.anchor.source_subverse_sort - b.anchor.source_subverse_sort;
    }
    if (a.anchor.anchor_sort !== b.anchor.anchor_sort) {
      return a.anchor.anchor_sort - b.anchor.anchor_sort;
    }
    if (a.group_ordinal !== b.group_ordinal) return a.group_ordinal - b.group_ordinal;
    return a.relationship_id.localeCompare(b.relationship_id);
  });
}

// === @section:logic:dedup-lexical ===
export function buildLexicalGuardrails(category: LexicalRelationshipCategory): LexicalGuardrails {
  return {
    implies_synonymy: category === 'synonymy',
    implies_common_etymology:
      category === 'same_lemma' ||
      category === 'same_documented_root' ||
      category === 'derivation' ||
      category === 'cognate' ||
      category === 'morphological_relationship',
    inferred_from_english_gloss: false,
    inferred_from_spelling_alone: false,
  };
}

export function validateLexicalEdgeIntegrity(edge: LexicalRelationshipEdge): string | null {
  if (edge.category !== 'synonymy' && edge.guardrails.implies_synonymy) {
    return `Category ${edge.category} must never claim implies_synonymy=true.`;
  }
  if (
    (edge.category === 'orthographic_overlap' ||
      edge.category === 'related_translation' ||
      edge.category === 'co_occurrence' ||
      edge.category === 'semantic_overlap' ||
      edge.category === 'synonymy' ||
      edge.category === 'antonymy') &&
    edge.guardrails.implies_common_etymology
  ) {
    return `Category ${edge.category} must never claim implies_common_etymology=true.`;
  }
  if (edge.guardrails.inferred_from_english_gloss || edge.guardrails.inferred_from_spelling_alone) {
    return 'Lexical relationships inferred solely from spelling or English glosses are forbidden.';
  }
  return null;
}

export function deduplicateLexicalEdges(edges: LexicalRelationshipEdge[]): LexicalRelationshipEdge[] {
  const byId = new Map<string, LexicalRelationshipEdge>();
  for (const edge of edges) {
    const err = validateLexicalEdgeIntegrity(edge);
    if (err) throw new Error(err);
    const key = `${edge.relationship_id}|${edge.subject.canonical_key}|${edge.target.canonical_key}`;
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, edge);
    } else if (edge.evidence_verses.length > prev.evidence_verses.length) {
      byId.set(key, edge);
    }
  }
  const tierRank: Record<RelationshipEpistemicTier, number> = {
    attested_lexical_fact: 1,
    human_reviewed_interpretation: 2,
    deterministic_computational: 3,
    statistical_association: 4,
    ai_hypothesis: 5,
  };
  return [...byId.values()].sort((a, b) => {
    const tDiff = tierRank[a.epistemic_tier] - tierRank[b.epistemic_tier];
    if (tDiff !== 0) return tDiff;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.relationship_id.localeCompare(b.relationship_id);
  });
}

// === @section:logic:pagination ===
export function encodeRelationshipCursor(offset: number, scopeKey: string): string {
  const safeOffset = Math.max(0, Math.floor(offset));
  const sig = fnv1a64Hex(`${scopeKey}|${safeOffset}`).slice(0, 8);
  return `rc1:${safeOffset}:${sig}`;
}

export function decodeRelationshipCursor(
  cursor: string | null | undefined,
  scopeKey: string
): { ok: true; offset: number } | { ok: false; error: string } {
  if (!cursor) return { ok: true, offset: 0 };
  const match = /^rc1:(\d+):([0-9a-f]{8})$/.exec(cursor.trim());
  if (!match) return { ok: false, error: 'Malformed relationship pagination cursor.' };
  const offset = Number(match[1]);
  const expectedSig = fnv1a64Hex(`${scopeKey}|${offset}`).slice(0, 8);
  if (match[2] !== expectedSig) {
    return { ok: false, error: 'Cursor scope mismatch; restart pagination from null cursor.' };
  }
  return { ok: true, offset };
}

export function paginateRelationshipItems<T>(
  items: T[],
  limit: number,
  offset: number,
  scopeKey: string
): { slice: T[]; page: RelationshipPageInfo } {
  const clampedLimit = Math.min(Math.max(1, Math.floor(limit || 25)), 100);
  const slice = items.slice(offset, offset + clampedLimit);
  const nextOffset = offset + slice.length;
  const hasMore = nextOffset < items.length;
  return {
    slice,
    page: {
      limit: clampedLimit,
      returned: slice.length,
      total_available: items.length,
      next_cursor: hasMore ? encodeRelationshipCursor(nextOffset, scopeKey) : null,
      has_more: hasMore,
    },
  };
}

export function formatLexicalEndpointLabel(ep: LexicalEndpointRef): string {
  const code = ep.disambiguated_strongs || ep.extended_strongs || ep.base_strongs || ep.canonical_key;
  const translit = ep.transliteration ? ` (${ep.transliteration})` : '';
  return `${ep.lemma_text}${translit} [${code}]`;
}
