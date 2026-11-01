// Reproducible additive OpenAPI generation for the versioned hydration RPC.
import fs from 'node:fs';
const file = 'supabase/openapi.json';
const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const str = { type: 'string' }, num = { type: 'number' }, int = { type: 'integer' };
const nullable = { type: ['string', 'null'] };
const array = items => ({ type: 'array', items });
const object = (properties, required = Object.keys(properties), extra = {}) =>
  ({ type: 'object', properties, required, ...extra });
const schemas = spec.components.schemas;
schemas.ResearchPassage = object({ book: { ...int, minimum: 1, maximum: 66 },
  chapter: { ...int, minimum: 1, maximum: 150 }, verse: { ...int, minimum: 0, maximum: 176 } }, undefined, { additionalProperties: false });
schemas.VerseResearchRequest = object({
  passages: { ...array(ref('ResearchPassage')), minItems: 1, maxItems: 5, uniqueItems: true },
  occurrences: { ...object({ mode: { type: 'string', enum: ['all', 'sample'], default: 'all' },
    limit: { ...int, minimum: 1, maximum: 100, default: 20 } }, [], { additionalProperties: false }),
    allOf: [{ if: { properties: { mode: { const: 'sample' } }, required: ['mode'] },
      then: {}, else: { not: { required: ['limit'] } } }],
    description: 'Default all includes every occurrence reference and exact counts. Explicit sample mode limits references only; totals remain exact. limit is valid only with sample.' },
  chronology_model_id: { ...str, default: 'theographic-verse-v1' },
}, ['passages'], { additionalProperties: false });
schemas.ResearchLexemeCandidate = object({ lexeme_key: str, language: str, base_strongs: str,
  extended_strongs: str, disambiguated_strongs: nullable, unified_strongs: nullable,
  original_lemma: str, transliteration: str, pos: nullable, primary_gloss: str, homograph_note: nullable,
  source_release_id: { type: ['integer', 'null'] } });
schemas.HydratedResearchWord = object({ word_position: int, word_id: int, original_word: str,
  transliteration: str, strongs_nr: str, lexical_entry_key: str,
  grammar: object({ raw_code: nullable, scheme: nullable,
    decoded_features: { type: 'object', additionalProperties: str }, unresolved_tags: array(str) }),
  translations: object({ source_english: nullable, source_ref: nullable, source_name: nullable,
    source_commit: nullable, corpus_gloss: nullable, available_renderings: array(str) }),
  definitions: object({ biblical: nullable, physical: nullable, source_release_key: str }),
  lexeme_candidates: array(ref('ResearchLexemeCandidate')),
});
schemas.ResearchOccurrence = object({ book: int, chapter: int, verse: int, occurrence_count: int });
schemas.ResearchConnectedWord = object({ rank: int, word_id: int, strongs_nr: str, original_word: str,
  transliteration: str, primary_english: nullable, score: num, frequency: int, avg_distance: num,
  english_translations: array(str), biblical_def: nullable, physical_def: nullable, source_release_key: str });
schemas.HydratedLexicalEntry = object({ identity_scope: { const: 'base_strongs' }, strongs_nr: str,
  lexeme_candidates: array(ref('ResearchLexemeCandidate')), needs_disambiguation: { type: 'boolean' },
  sense_status: { const: 'not_assigned_to_token' }, semantic_annotation_status: str,
  occurrences: object({ counting_method: str, corpus_token_total: int, distinct_passage_total: int,
    returned_reference_count: int, complete: { type: 'boolean' }, references: array(ref('ResearchOccurrence')) }),
  top_connected_words: { ...array(ref('ResearchConnectedWord')), maxItems: 7 },
  connection_coverage: object({ requested: int, returned: int, status: str, method: str }), limitations: str,
});
schemas.HydratedSemanticEvidence = object({ assertion_key: str, subject: str, object: str, predicate: str,
  epistemic_category: { type: 'string', enum: ['lexical', 'linguistic', 'statistical', 'textual', 'interpretive'] },
  review_status: str, scope_reference: str, denominator_note: nullable, summary: str, limitations_note: str,
  source_attribution: str, rank_order: int,
  evidence_spans: array(object({ evidence_role: str, reference_display: str, book: int,
    start_chapter: int, start_verse: int, end_chapter: int, end_verse: int,
    original_terms: array(str), explanation: str, step_url: nullable, step_order: int })),
});
schemas.ResearchComponentError = object({ schema_version: { const: 1 }, status: { type: 'string', not: { const: 'ok' } } });
schemas.HydratedResearchVerse = object({ verse_id: int,
  passage: object({ book: int, chapter: int, verse: int, is_heading: { type: 'boolean' } }),
  words: array(ref('HydratedResearchWord')), chronology: { anyOf: [ref('VerseChronologyPacket'), ref('ResearchComponentError')] },
  geography: { anyOf: [ref('VerseGeographyPacket'), ref('ResearchComponentError')] }, semantic_evidence: array(ref('HydratedSemanticEvidence')),
  coverage: object({ semantic_scope: str, grammar_decoding: str, semantic_domains: str, token_senses: str }),
});
schemas.VerseResearchPacket = object({ schema_version: { const: 1 }, status: { const: 'ok' },
  verses: array(ref('HydratedResearchVerse')),
  lexical_entries: { type: 'object', additionalProperties: ref('HydratedLexicalEntry') },
  sources: array(object({ release_key: str, dataset: str, commit_sha: str, license: str, attribution: str })),
  coverage: object({ corpus: str, requested_passage_count: int, returned_passage_count: int,
    lexical_entry_count: int, occurrence_mode: { type: 'string', enum: ['all', 'sample'] },
    occurrences_complete: { type: 'boolean' }, chronology_evidence_complete: { type: 'boolean' },
    component_statuses: array(object({ passage: object({ book: int, chapter: int, verse: int, is_heading: { type: 'boolean' } }), chronology: str, geography: str })),
    max_passages: int, max_packet_bytes: int, semantic_coverage: str,
    private_translation_choices_included: { const: false } }),
});
schemas.VerseResearchError = object({ schema_version: { const: 1 },
  status: { type: 'string', enum: ['invalid_request', 'passage_not_found', 'packet_limit_exceeded'] },
  message: str, requested_passages: array(ref('ResearchPassage')), measured_bytes: int, max_packet_bytes: int,
}, ['schema_version', 'status']);
spec.paths['/rpc/get_verse_research_v1'] = { post: {
  operationId: 'getVerseResearch', summary: 'Hydrate 1-5 verses for AI research in one JSON response',
  description: 'Ordered tokens, public source renderings, Strong\'s, grammar, definitions, full occurrence references/counts, seven ranked cached connections per base Strong\'s, chronology, map data and available reviewed semantic evidence. Shared lexical_entries avoid duplication. Inspect coverage, component statuses and homograph ambiguity. Full occurrences are the default; samples are explicit. Errors never silently truncate an oversized packet (8 MiB cap). Private translation choices are excluded.',
  requestBody: { required: true, content: { 'application/json': {
    schema: object({ p_request: ref('VerseResearchRequest') }, ['p_request'], { additionalProperties: false }),
    example: { p_request: { passages: [{ book: 1, chapter: 1, verse: 1 }], occurrences: { mode: 'all' } } },
  } } },
  responses: { 200: { description: 'Hydrated packet or explicit validation/size error', content: {
    'application/json': { schema: { oneOf: [ref('VerseResearchPacket'), ref('VerseResearchError')] } },
  } } },
} };
spec.info.version = '1.3.0';
if (!spec.info.description.includes('get_verse_research_v1')) spec.info.description +=
  ' get_verse_research_v1 provides one-call hydrated verse packets for deeper AI pattern research.';
fs.writeFileSync(file, JSON.stringify(spec, null, 2) + '\n');
console.log('Generated hydration OpenAPI request, packet and nested schemas.');
