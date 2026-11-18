// @file: supabase/functions/bible-mcp/relationships-v2.ts
// @feature: relationships-v2
// Read-only MCP tool wrappers backed by the versioned Cloudflare `bibleresearch-corpus` R5 graph gateway.
// Zero duplicated grammatical parsing or embedded relationship bundles in Edge Runtime.

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { DatabaseReader } from './catalog.ts';

export type R3PredicateId =
  | 'grammatical_subject_of'
  | 'grammatical_object_of'
  | 'grammatical_indirect_object_of'
  | 'grammatical_second_object_of'
  | 'modifies'
  | 'possessive_construction_with';

export const R3_PREDICATES = [
  'grammatical_subject_of',
  'grammatical_object_of',
  'grammatical_indirect_object_of',
  'grammatical_second_object_of',
  'modifies',
  'possessive_construction_with',
] as const;

export const EDITIONS_V2 = [
  'macula-hebrew-wlc',
  'macula-greek-nestle1904',
  'macula-greek-sblgnt',
] as const;

export const R9B_LAYERS = [
  'grammatical',
  'lexical',
  'contextual',
  'lxx_translation',
] as const;

export const CONTEXTUAL_SCOPES = [
  'all',
  'same_clause',
  'collocation',
  'same_verse',
] as const;

export const LEXICAL_DIRECTIONS = [
  'both',
  'outgoing',
  'incoming',
  'symmetric',
] as const;

export const UPSTREAM_PIN = {
  upstream_repo: 'bibleontology/bibleontology',
  upstream_commit: '62d6bc0fba5f84dfad245e546e87c6212b35fa75',
  macula_hebrew_commit: '47db250bd55d0d8577f2a94fba114ef16c35b23c',
  macula_greek_commit: '8423afe47b9e8f24b7772e808af45c7159a6fe7e',
  stepbible_commit: 'be4191f0082aeedddb0eff0c02c966292b2bd641',
  rule_version: '1.2',
  release_version: 'r9b-v1.1',
  grammatical_release_version: 'r8-v1.2',
  license: 'CC BY 4.0 / Apache-2.0',
};

const readOnlyMeta = {
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { securitySchemes: [{ type: 'noauth' }] },
};

const asObj = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};

const jsonContent = (obj: unknown) => [{ type: 'text' as const, text: JSON.stringify(obj) }];

const invalidTargetReply = (message: string) => {
  const payload = {
    schema_version: '3.0',
    status: 'invalid_request',
    error_message: message,
  };
  return { content: jsonContent(payload), structuredContent: payload, isError: true };
};

const lemmaLookupShape = {
  query: z.string().trim().min(1).max(128).optional().describe('Canonical lemma ID (lemma:H7307, lemma:H0430G), Strongs ID, transliteration, token ID, or surface script.'),
  lemma_id: z.string().trim().min(1).max(64).optional().describe('Explicit canonical lemma_id (e.g. lemma:H7307, lemma:G3056).'),
  extended_strongs: z.string().trim().min(1).max(32).optional().describe('Disambiguated extended Strongs ID (e.g. H0430G, H7307H).'),
  word_id: z.number().int().positive().optional().describe('Canonical STEP database word_id.'),
  edition_key: z.enum(EDITIONS_V2).optional().describe('Source edition filter (macula-hebrew-wlc, macula-greek-nestle1904, macula-greek-sblgnt).'),
  book: z.number().int().min(1).max(66).optional(),
  chapter: z.number().int().min(1).max(150).optional(),
  verse: z.number().int().min(0).max(176).optional(),
  position: z.number().int().min(1).max(200).optional().describe('1-based word position in passage to disambiguate clicked homographs.'),
  release: z.string().trim().min(1).max(32).optional().describe('Optional relationship release override (e.g. r9b-v1.0).'),
};

function compactDefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function queryGatewayV2(
  read: DatabaseReader,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const reply = await read({
    name: 'query_relationships_v2',
    args,
    limit: 1,
    offset: 0,
  });
  return asObj(reply.rows[0]);
}

export function registerRelationshipV2Tools(server: McpServer, read: DatabaseReader): void {
  server.registerTool('get_passage_grammatical_frames_v2', {
    title: 'Inspect grammatical frames & R3 syntactic relations for a passage',
    description:
      'Retrieve verified grammatical frames and occurrence-level relations (grammatical_subject_of, grammatical_object_of, grammatical_indirect_object_of, grammatical_second_object_of, modifies, possessive_construction_with) from the versioned Cloudflare corpus graph gateway. Uncovered passages return explicit status: not_covered.',
    inputSchema: z.strictObject({
      book: z.number().int().min(1).max(66).describe('Canonical book ID: Genesis=1, Joshua=6, Psalms=19, Matthew=40, Luke=42, John=43.'),
      chapter: z.number().int().min(1).max(150),
      verse: z.number().int().min(0).max(176).describe('Verse number (0 for Psalm headings).'),
      edition_key: z.enum(EDITIONS_V2).optional().describe('Source edition override (e.g. macula-greek-sblgnt vs macula-greek-nestle1904).'),
      include_candidates: z.boolean().default(true).describe('Include candidate-quality frames and relations.'),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({ book, chapter, verse, edition_key, include_candidates = true }) => {
    const payload = await queryGatewayV2(read, {
      op: 'passage_frames',
      book,
      chapter,
      verse,
      ...(edition_key ? { edition_key } : {}),
      include_candidates,
    });
    return { content: jsonContent(payload), structuredContent: payload };
  });

  server.registerTool('get_word_relationships_v2', {
    title: 'Query R3 grammatical lemma relationships & occurrence evidence',
    description:
      'Query verified Hebrew/Greek grammatical relationships across all 6 R3 predicates (subject, object, indirect object, second object, modifies, possessive/construct construction) in both directions. Preserves Hebrew homographs (returns needs_disambiguation for ambiguous bases unless suffix or passage position is provided) and supports summary_id exact occurrence evidence drill-down.',
    inputSchema: z.strictObject({
      query: z.string().trim().min(1).max(128).optional().describe('Disambiguated lemma ID (lemma:H1254a, lemma:H0430G), Strongs ID, token ID, or surface form.'),
      lemma_id: z.string().trim().min(1).max(64).optional().describe('Explicit canonical lemma_id (e.g. lemma:H0776G).'),
      extended_strongs: lemmaLookupShape.extended_strongs,
      word_id: lemmaLookupShape.word_id,
      summary_id: z.string().trim().min(1).max(256).optional().describe('If set, returns bounded exact occurrence evidence for that summary ID.'),
      relation_types: z.array(z.enum(R3_PREDICATES)).optional(),
      direction: z.enum(['both', 'outgoing', 'incoming']).default('both'),
      edition_key: z.enum(EDITIONS_V2).optional(),
      include_uncertain: z.boolean().default(false).describe('Include candidate-only summaries and candidate occurrence relations (default false = high_quality only).'),
      book: z.number().int().min(1).max(66).optional(),
      chapter: z.number().int().min(1).max(150).optional(),
      verse: z.number().int().min(0).max(176).optional(),
      position: z.number().int().min(1).max(200).optional().describe('1-based word position in the passage to disambiguate clicked homographs.'),
      release: lemmaLookupShape.release,
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).max(5000).default(0),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({
    query,
    lemma_id,
    extended_strongs,
    word_id,
    summary_id,
    relation_types,
    direction = 'both',
    edition_key,
    include_uncertain = false,
    book,
    chapter,
    verse,
    position,
    release,
    limit = 25,
    offset = 0,
  }) => {
    if (!query && !lemma_id && !extended_strongs && word_id === undefined && !summary_id && position === undefined) {
      const payload = {
        schema_version: '2.0',
        status: 'invalid_request',
        error_message: 'Provide query, lemma_id, extended_strongs, word_id, summary_id, or passage position.',
      };
      return { content: jsonContent(payload), structuredContent: payload, isError: true };
    }

    const args: Record<string, unknown> = summary_id
      ? {
          op: 'evidence',
          summary_id,
          include_uncertain,
          ...(release ? { release } : {}),
          limit,
          offset,
        }
      : {
          op: 'lemma_relationships',
          ...(query ? { query } : {}),
          ...(lemma_id ? { lemma_id } : {}),
          ...(extended_strongs ? { extended_strongs } : {}),
          ...(word_id !== undefined ? { word_id } : {}),
          ...(relation_types ? { predicates: relation_types } : {}),
          direction,
          ...(edition_key ? { edition_key } : {}),
          include_uncertain,
          ...(book !== undefined ? { book } : {}),
          ...(chapter !== undefined ? { chapter } : {}),
          ...(verse !== undefined ? { verse } : {}),
          ...(position !== undefined ? { position } : {}),
          ...(release ? { release } : {}),
          limit,
          offset,
        };

    const payload = await queryGatewayV2(read, args);
    return { content: jsonContent(payload), structuredContent: payload };
  });

  server.registerTool('get_relationship_coverage_v2', {
    title: 'Inspect relationship graph release & coverage',
    description:
      'Return the active v2 relationship graph release manifest (r9b-v1.1 default: r8-v1.2 grammatical, lexical, contextual with matching-witness samples, and LXX layers), pinned upstream commits, supported R3 predicates, quality/coverage statistics, and optional passage coverage status.',
    inputSchema: z.strictObject({
      edition_key: z.enum(EDITIONS_V2).optional(),
      predicate: z.enum(R3_PREDICATES).optional(),
      book: z.number().int().min(1).max(66).optional(),
      chapter: z.number().int().min(1).max(150).optional(),
      verse: z.number().int().min(0).max(176).optional(),
      release: z.string().trim().min(1).max(32).optional(),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({ edition_key, predicate, book, chapter, verse, release }) => {
    const gateway = await queryGatewayV2(read, compactDefined({
      op: 'coverage',
      edition_key,
      book,
      chapter,
      verse,
      release,
    }));
    const gramLayer = asObj(asObj(gateway.layers).grammatical);
    const payload = {
      ...gateway,
      provenance: {
        ...UPSTREAM_PIN,
        ...(typeof gateway.release_version === 'string' ? { release_version: gateway.release_version } : {}),
        ...(typeof gramLayer.release_version === 'string' ? { grammatical_release_version: gramLayer.release_version } : {}),
      },
      ...(predicate ? { requested_predicate: predicate } : {}),
    };
    return { content: jsonContent(payload), structuredContent: payload };
  });

  server.registerTool('get_unified_word_relationships_v2', {
    title: 'Query unified R9B 4-layer word relationships (Grammatical, Lexical, Contextual, LXX)',
    description:
      'Retrieve all four distinct evidence layers for an original-language word from the Cloudflare corpus gateway: (1) grammatical R3 relations, (2) bidirectional lexical roots/senses/cognates/formations, (3) lossless contextual co-occurrences separated into distinct-verse and clause-occurrence units, and (4) Hebrew-Greek Septuagint translation candidates. Never flattens layers into one score or equates translation/proximity with synonymy.',
    inputSchema: z.strictObject({
      ...lemmaLookupShape,
      layers: z.array(z.enum(R9B_LAYERS)).optional().describe('Subset of layers to return; defaults to all 4.'),
      relation_types: z.array(z.enum(R3_PREDICATES)).optional(),
      direction: z.enum(['both', 'outgoing', 'incoming']).default('both'),
      include_uncertain: z.boolean().default(false),
      limit: z.number().int().min(1).max(50).default(15).describe('Bounded grammatical summary page size.'),
      offset: z.number().int().min(0).max(5000).default(0),
      lexical_direction: z.enum(LEXICAL_DIRECTIONS).default('both'),
      lexical_categories: z.array(z.string().trim().min(1).max(64)).optional(),
      lexical_limit: z.number().int().min(1).max(50).default(20),
      lexical_offset: z.number().int().min(0).max(5000).default(0),
      contextual_scope: z.enum(CONTEXTUAL_SCOPES).default('all'),
      min_same_verse: z.number().int().min(0).optional(),
      min_same_clause: z.number().int().min(0).optional(),
      min_collocation: z.number().int().min(0).optional(),
      contextual_limit: z.number().int().min(1).max(50).default(20),
      contextual_offset: z.number().int().min(0).max(50000).default(0),
      lxx_limit: z.number().int().min(1).max(50).default(20),
      lxx_offset: z.number().int().min(0).max(5000).default(0),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async (input) => {
    if (!input.query && !input.lemma_id && !input.extended_strongs && input.word_id === undefined && input.position === undefined) {
      return invalidTargetReply('Provide query, lemma_id, extended_strongs, word_id, or passage position.');
    }
    const payload = await queryGatewayV2(read, compactDefined({
      op: 'unified_lemma',
      query: input.query,
      lemma_id: input.lemma_id,
      extended_strongs: input.extended_strongs,
      word_id: input.word_id,
      edition_key: input.edition_key,
      book: input.book,
      chapter: input.chapter,
      verse: input.verse,
      position: input.position,
      release: input.release,
      layers: input.layers,
      predicates: input.relation_types,
      direction: input.direction,
      include_uncertain: input.include_uncertain,
      limit: input.limit,
      offset: input.offset,
      lexical_direction: input.lexical_direction,
      lexical_categories: input.lexical_categories,
      lexical_limit: input.lexical_limit,
      lexical_offset: input.lexical_offset,
      contextual_scope: input.contextual_scope,
      min_same_verse: input.min_same_verse,
      min_same_clause: input.min_same_clause,
      min_collocation: input.min_collocation,
      contextual_limit: input.contextual_limit,
      contextual_offset: input.contextual_offset,
      lxx_limit: input.lxx_limit,
      lxx_offset: input.lxx_offset,
    }));
    return { content: jsonContent(payload), structuredContent: payload };
  });

  server.registerTool('page_contextual_neighbors_v2', {
    title: 'Page through lossless R9B contextual neighbors beyond the top 50',
    description:
      'Retrieve paginated contextual co-occurrence partners from R9B partitioned contextual shards, supporting filters by verified same-clause scope, token-distance <= 3 collocation, and minimum frequency thresholds.',
    inputSchema: z.strictObject({
      ...lemmaLookupShape,
      contextual_scope: z.enum(CONTEXTUAL_SCOPES).default('all'),
      min_same_verse: z.number().int().min(0).optional(),
      min_same_clause: z.number().int().min(0).optional(),
      min_collocation: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).max(50000).default(0),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async (input) => {
    if (!input.query && !input.lemma_id && !input.extended_strongs && input.word_id === undefined && input.position === undefined) {
      return invalidTargetReply('Provide query, lemma_id, extended_strongs, word_id, or passage position.');
    }
    const payload = await queryGatewayV2(read, compactDefined({
      op: 'contextual_neighbors',
      query: input.query,
      lemma_id: input.lemma_id,
      extended_strongs: input.extended_strongs,
      word_id: input.word_id,
      edition_key: input.edition_key,
      book: input.book,
      chapter: input.chapter,
      verse: input.verse,
      position: input.position,
      release: input.release,
      contextual_scope: input.contextual_scope,
      min_same_verse: input.min_same_verse,
      min_same_clause: input.min_same_clause,
      min_collocation: input.min_collocation,
      limit: input.limit,
      offset: input.offset,
    }));
    return { content: jsonContent(payload), structuredContent: payload };
  });

  server.registerTool('lookup_lexical_relations_v2', {
    title: 'Query bidirectional R9B lexical relations (roots, cognates, subdivisions, formations)',
    description:
      'Retrieve bidirectional lexical relations (outgoing, incoming, symmetric) from R9B serialized lexical shards without duplicating edges or equating shared roots with synonymy. Also accepts non-lemma endpoint_key such as root:H7307 or sense:H7307H:sub.',
    inputSchema: z.strictObject({
      ...lemmaLookupShape,
      endpoint_key: z.string().trim().min(1).max(96).optional().describe('Non-lemma endpoint key such as root:H7307 or sense:H7307H:sub.'),
      lexical_direction: z.enum(LEXICAL_DIRECTIONS).default('both'),
      lexical_categories: z.array(z.string().trim().min(1).max(64)).optional(),
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).max(5000).default(0),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async (input) => {
    if (!input.endpoint_key && !input.query && !input.lemma_id && !input.extended_strongs && input.word_id === undefined && input.position === undefined) {
      return invalidTargetReply('Provide endpoint_key, query, lemma_id, extended_strongs, word_id, or passage position.');
    }
    const payload = await queryGatewayV2(read, compactDefined({
      op: 'lexical_relations',
      endpoint_key: input.endpoint_key,
      query: input.query,
      lemma_id: input.lemma_id,
      extended_strongs: input.extended_strongs,
      word_id: input.word_id,
      edition_key: input.edition_key,
      book: input.book,
      chapter: input.chapter,
      verse: input.verse,
      position: input.position,
      release: input.release,
      lexical_direction: input.lexical_direction,
      lexical_categories: input.lexical_categories,
      limit: input.limit,
      offset: input.offset,
    }));
    return { content: jsonContent(payload), structuredContent: payload };
  });

  server.registerTool('lookup_lxx_translations_v2', {
    title: 'Query Hebrew-Greek Septuagint (LXX) translation candidates & published counts',
    description:
      'Retrieve Hebrew->Greek or Greek->Hebrew LXX translation bridge candidates with published source counts, homograph ambiguity flags, and canonical candidate lists. Translation correspondence is corpus attestation, not semantic identity.',
    inputSchema: z.strictObject({
      ...lemmaLookupShape,
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).max(5000).default(0),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async (input) => {
    if (!input.query && !input.lemma_id && !input.extended_strongs && input.word_id === undefined && input.position === undefined) {
      return invalidTargetReply('Provide query, lemma_id, extended_strongs, word_id, or passage position.');
    }
    const payload = await queryGatewayV2(read, compactDefined({
      op: 'lxx_translations',
      query: input.query,
      lemma_id: input.lemma_id,
      extended_strongs: input.extended_strongs,
      word_id: input.word_id,
      edition_key: input.edition_key,
      book: input.book,
      chapter: input.chapter,
      verse: input.verse,
      position: input.position,
      release: input.release,
      limit: input.limit,
      offset: input.offset,
    }));
    return { content: jsonContent(payload), structuredContent: payload };
  });

  server.registerTool('resolve_research_concept_v1', {
    title: 'Resolve English concepts, Strongs IDs, forms, or canonical root/sense/lemma keys',
    description:
      'Resolve an English concept, Strongs ID (base or extended), transliteration, surface form, or canonical entity_key (lemma:*, root:*, sense:*) into explicit candidate entities before multi-hop traversal. Ambiguous Strongs bases and English concepts return needs_disambiguation and require explicit selection.',
    inputSchema: z.strictObject({
      query: z.string().trim().min(1).max(128).describe('Concept, Strongs ID (e.g. H7307, H1697, G4151), canonical key, transliteration, or surface form.'),
      language: z.enum(['hbo', 'arc', 'grc', 'hebrew', 'aramaic', 'greek']).optional().describe('Optional language filter.'),
      limit: z.number().int().min(1).max(50).default(20),
      include_uncovered: z.boolean().default(true),
      release: z.string().trim().min(1).max(32).optional().describe('Optional relationship release override (defaults to r9b-v1.0).'),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async (input) => {
    const reply = await read({
      name: 'resolve_research_concept_v1',
      args: compactDefined({
        query: input.query,
        language: input.language,
        limit: input.limit,
        include_uncovered: input.include_uncovered,
        release: input.release,
      }),
      limit: 1,
      offset: 0,
    });
    const payload = asObj(reply.rows[0]);
    return { content: jsonContent(payload), structuredContent: payload };
  });

  server.registerTool('discover_relationship_paths_v1', {
    title: 'Discover bounded 1-3 hop biblical relationship paths with ranked explanations',
    description:
      'Traverse grammatical, lexical, contextual, and LXX translation layers in bounded 1-3 hop queries between canonical lemma:/root:/sense: entities or unique Strongs IDs. Ambiguous Strongs bases and English words require resolve_research_concept_v1 first. Preserves distinct epistemic classes, passage/frame join scope, uncertainty indicators, resource-budget metadata, and explicit incomplete-coverage reporting.',
    inputSchema: z.strictObject({
      source: z.string().trim().min(1).max(96).describe('Starting canonical entity key (e.g. lemma:H7307, root:H7307, sense:...) or unique Strongs ID.'),
      target: z.string().trim().min(1).max(96).optional().describe('Optional single target canonical entity key for targeted path discovery.'),
      targets: z.array(z.string().trim().min(1).max(96)).max(10).optional().describe('Optional list of up to 10 target canonical entity keys.'),
      max_hops: z.number().int().min(1).max(3).default(2),
      layers: z.array(z.enum(R9B_LAYERS)).max(4).optional().describe('Restrict traversal to specific layers.'),
      predicates: z.array(z.string().trim().min(1).max(64)).max(24).optional(),
      direction: z.enum(['both', 'outgoing', 'incoming']).default('both'),
      min_quality: z.enum(['all', 'high_precision_only']).default('all'),
      languages: z.array(z.string().trim().min(1).max(16)).max(4).optional(),
      editions: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
      contextual_scope: z.enum(CONTEXTUAL_SCOPES).optional(),
      min_same_verse: z.number().int().min(1).max(500).optional(),
      min_same_clause: z.number().int().min(0).max(500).optional(),
      min_collocation: z.number().int().min(0).max(500).optional(),
      allow_cycles: z.boolean().default(false),
      hub_penalty: z.strictObject({
        enabled: z.boolean().optional(),
        function_word_penalty: z.number().min(0).max(100).optional(),
        hub_degree_threshold: z.number().int().min(10).max(10000).optional(),
        hub_degree_weight: z.number().min(0).max(25).optional(),
        allow_function_word_intermediates: z.boolean().optional(),
      }).optional(),
      limits: z.strictObject({
        max_nodes_expanded: z.number().int().min(1).max(60).optional(),
        max_edges_examined: z.number().int().min(1).max(4000).optional(),
        max_paths_returned: z.number().int().min(1).max(50).optional(),
        max_per_node_edges: z.number().int().min(1).max(300).optional(),
        max_contextual_pages_per_node: z.number().int().min(0).max(8).optional(),
        max_asset_requests: z.number().int().min(1).max(70).optional(),
        max_bytes_read: z.number().int().min(1024).max(18 * 1024 * 1024).optional(),
        max_execution_ms: z.number().int().min(25).max(5000).optional(),
        max_candidate_paths: z.number().int().min(1).max(500).optional(),
      }).optional(),
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).max(5000).default(0),
      cursor: z.string().trim().min(1).max(128).optional(),
      release: z.string().trim().min(1).max(32).optional().describe('Optional relationship release override (defaults to r9b-v1.0).'),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async (input) => {
    const reply = await read({
      name: 'discover_relationship_paths_v1',
      args: compactDefined({
        source: input.source,
        target: input.target,
        targets: input.targets,
        max_hops: input.max_hops,
        layers: input.layers,
        predicates: input.predicates,
        direction: input.direction,
        min_quality: input.min_quality,
        languages: input.languages,
        editions: input.editions,
        contextual_scope: input.contextual_scope,
        min_same_verse: input.min_same_verse,
        min_same_clause: input.min_same_clause,
        min_collocation: input.min_collocation,
        allow_cycles: input.allow_cycles,
        hub_penalty: input.hub_penalty,
        limits: input.limits,
        limit: input.limit,
        offset: input.offset,
        cursor: input.cursor,
        release: input.release,
      }),
      limit: 1,
      offset: 0,
    });
    const payload = asObj(reply.rows[0]);
    const isErr = payload.status === 'invalid_request' || payload.status === 'unknown_entity';
    return { content: jsonContent(payload), structuredContent: payload, ...(isErr ? { isError: false } : {}) };
  });

  const discoveryAnchorShape = {
    word_id: lemmaLookupShape.word_id,
    book: lemmaLookupShape.book,
    chapter: lemmaLookupShape.chapter,
    verse: lemmaLookupShape.verse,
    position: lemmaLookupShape.position,
    edition_key: lemmaLookupShape.edition_key,
    lemma_id: lemmaLookupShape.lemma_id,
    extended_strongs: lemmaLookupShape.extended_strongs,
  };

  server.registerTool('discover_biblical_connections_v1', {
    title: 'Discover Biblical Connections (R10)',
    description:
      'Discover deep biblical connections across books, Hebrew/Aramaic/Greek original languages, motifs, numbers, events, typology, and orthographic wordplay from natural language, concept lists, or an exact occurrence anchor {word_id, book, chapter, verse, position, edition_key?}. Separates explicit biblical identifications (Tier 1) and NT authorial comparisons (Tier 1-2) from lexical/LXX facts (Tier 3), CrossReferences.org links (Tier 4), shared imagery (Tier 5), candidate literary patterns, and non-etymological consonantal overlaps (Tier 7), with explicit subclusters, bridges, and negative controls.',
    inputSchema: z.strictObject({
      query: z.string().trim().min(1).max(400).optional().describe('Natural language question, passage references, transliterations (e.g. ruach, adam, dam), or comma-separated concept list.'),
      concepts: z.array(z.string().trim().min(1).max(64)).max(16).optional().describe('Optional explicit list of concepts to analyze alongside query.'),
      ...discoveryAnchorShape,
      mode: z.enum(['discover', 'expand', 'bridge', 'compare', 'explain', 'challenge']).optional().describe('Optional R11 exploration mode.'),
      cluster_id: z.string().trim().max(160).optional().describe('Target cluster identifier for expand/drill-down exploration.'),
      focus_lemma: z.string().trim().max(64).optional().describe('Specific Hebrew or Greek lemma / Strong\'s ID to anchor or disambiguate.'),
      compare_targets: z.array(z.string().trim().min(1).max(128)).max(6).optional().describe('Up to 6 concepts, words, or lemmas to compare directly.'),
      filters: z.strictObject({
        predicates: z.array(z.string().trim().min(1).max(64)).optional(),
        max_tier: z.number().int().min(1).max(8).optional(),
        include_orthographic: z.boolean().optional(),
        include_candidate_patterns: z.boolean().optional(),
        include_interpretive: z.boolean().optional(),
        testaments: z.array(z.enum(['OT', 'NT'])).optional(),
      }).optional(),
      limit: z.number().int().min(1).max(25).optional(),
      cursor: z.string().trim().max(128).nullable().optional(),
      max_hops: z.number().int().min(1).max(3).optional(),
      release_id: z.string().trim().min(1).max(32).optional(),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async (input) => {
    const hasAnchor = Boolean(
      input.query ||
      input.concepts?.length ||
      input.lemma_id ||
      input.extended_strongs ||
      input.word_id !== undefined ||
      input.position !== undefined
    );
    if (!hasAnchor) {
      return invalidTargetReply('Provide query, concepts, or occurrence anchor ({word_id, book, chapter, verse, position}).');
    }
    const reply = await read({
      name: 'discover_biblical_connections_v1',
      args: compactDefined({
        query: input.query,
        concepts: input.concepts,
        word_id: input.word_id,
        book: input.book,
        chapter: input.chapter,
        verse: input.verse,
        position: input.position,
        edition_key: input.edition_key,
        lemma_id: input.lemma_id,
        extended_strongs: input.extended_strongs,
        mode: input.mode,
        cluster_id: input.cluster_id,
        focus_lemma: input.focus_lemma,
        compare_targets: input.compare_targets,
        filters: input.filters,
        limit: input.limit,
        cursor: input.cursor ?? undefined,
        max_hops: input.max_hops,
        release_id: input.release_id,
      }),
      limit: 1,
      offset: 0,
    });
    const payload = asObj(reply.rows[0]);
    const isErr = payload.status === 'invalid_request' || payload.status === 'selector_mismatch';
    return { content: jsonContent(payload), structuredContent: payload, ...(isErr ? { isError: false } : {}) };
  });

  server.registerTool('discover_biblical_connections_v2', {
    title: 'Discover & Explore Universal Biblical Connections (R12)',
    description:
      'Universal corpus-wide biblical discovery and multi-mode exploration with R12 2-5 hop beam proof paths, Q/C/D/T/MMR ranking, Open English WordNet 2025 (CC BY 4.0) & Wikidata (CC0) physical-property bridges, R8 structural scene parallels, and orthographic candidates. Handles ANY biblical concept, English word, Hebrew/Greek lemma or surface form, Strong\'s ID, exact occurrence anchor {word_id, book, chapter, verse, position, edition_key?}, number, passage (including Psalm verse 0 headings), or multi-concept question across all 31,203 verses.',
    inputSchema: z.strictObject({
      query: z.string().trim().min(1).max(400).optional().describe('Natural language question, English concept/word (e.g. lily, hyssop, pomegranate), passage reference (including Psalm headings verse 0), transliteration, Strong\'s ID, or comma-separated concepts.'),
      concepts: z.array(z.string().trim().min(1).max(64)).max(16).optional().describe('Optional explicit list of concepts to analyze alongside query.'),
      ...discoveryAnchorShape,
      mode: z.enum(['discover', 'expand', 'bridge', 'compare', 'explain', 'challenge']).optional().describe('Exploration mode: discover (default overview), expand (drill into cluster/concept), bridge (trace cross-testament/LXX links), compare (contrast multiple targets), explain (evidence rationale), or challenge (test counter-evidence).'),
      cluster_id: z.string().trim().max(160).optional().describe('Target cluster identifier for expand/drill-down exploration.'),
      focus_lemma: z.string().trim().max(64).optional().describe('Specific Hebrew or Greek lemma / Strong\'s ID to anchor or disambiguate.'),
      compare_targets: z.array(z.string().trim().min(1).max(128)).max(6).optional().describe('Up to 6 concepts, words, or lemmas to compare directly in compare mode.'),
      filters: z.strictObject({
        predicates: z.array(z.string().trim().min(1).max(64)).optional(),
        max_tier: z.number().int().min(1).max(8).optional(),
        include_orthographic: z.boolean().optional(),
        include_candidate_patterns: z.boolean().optional(),
        include_interpretive: z.boolean().optional(),
        testaments: z.array(z.enum(['OT', 'NT'])).optional(),
      }).optional(),
      limit: z.number().int().min(1).max(25).optional(),
      cursor: z.string().trim().max(128).nullable().optional(),
      max_hops: z.number().int().min(1).max(5).optional(),
      release_id: z.string().trim().min(1).max(32).optional(),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async (input) => {
    const hasAnchor = Boolean(
      input.query ||
      input.concepts?.length ||
      input.lemma_id ||
      input.extended_strongs ||
      input.word_id !== undefined ||
      input.position !== undefined
    );
    if (!hasAnchor) {
      return invalidTargetReply('Provide query, concepts, or occurrence anchor ({word_id, book, chapter, verse, position}).');
    }
    const reply = await read({
      name: 'discover_biblical_connections_v2',
      args: compactDefined({
        query: input.query,
        concepts: input.concepts,
        word_id: input.word_id,
        book: input.book,
        chapter: input.chapter,
        verse: input.verse,
        position: input.position,
        edition_key: input.edition_key,
        lemma_id: input.lemma_id,
        extended_strongs: input.extended_strongs,
        mode: input.mode,
        cluster_id: input.cluster_id,
        focus_lemma: input.focus_lemma,
        compare_targets: input.compare_targets,
        filters: input.filters,
        limit: input.limit,
        cursor: input.cursor ?? undefined,
        max_hops: input.max_hops,
        release_id: input.release_id,
      }),
      limit: 1,
      offset: 0,
    });
    const payload = asObj(reply.rows[0]);
    const isErr = payload.status === 'invalid_request' || payload.status === 'selector_mismatch';
    return { content: jsonContent(payload), structuredContent: payload, ...(isErr ? { isError: false } : {}) };
  });

  server.registerTool('get_connection_evidence_v1', {
    title: 'Inspect Biblical Connection Evidence (R10)',
    description:
      'Retrieve full original-language Greek/Hebrew tokens (Strong\'s, lemma, gloss, highlighted matches), public-domain English text, orthographic decomposition, number classification, and dataset provenance/license for any connection returned by discover_biblical_connections_v1.',
    inputSchema: z.strictObject({
      evidence_id: z.string().trim().min(1).max(220).describe('The evidence_id returned inside strongest_connections by discover_biblical_connections_v1 or discover_biblical_connections_v2.'),
      release_id: z.string().trim().min(1).max(32).optional(),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async (input) => {
    const reply = await read({
      name: 'get_connection_evidence_v1',
      args: compactDefined({
        evidence_id: input.evidence_id,
        release_id: input.release_id,
      }),
      limit: 1,
      offset: 0,
    });
    const payload = asObj(reply.rows[0]);
    return { content: jsonContent(payload), structuredContent: payload };
  });

  server.registerTool('expand_biblical_connection_v1', {
    title: 'Expand Biblical Connection Node (R12)',
    description:
      'Expand a specific motif, Strong\'s lemma, sense, external OEWN/Wikidata concept, passage, or concept node into its neighboring verified biblical connections, R12 multihop paths, property bridges, negative controls, and original-language links.',
    inputSchema: z.strictObject({
      node_id: z.string().trim().min(1).max(192).describe('Node identifier, label, or cluster ID (e.g. motif:lampstand, lemma:H7307, sense:H5869_spring, wd:Q124714, oewn:09466357-n, passage:Zechariah 4:2, cluster:H7799:temple_and_sanctuary_architecture).'),
      limit: z.number().int().min(1).max(20).optional(),
      cursor: z.string().trim().max(128).nullable().optional(),
      release_id: z.string().trim().min(1).max(32).optional(),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async (input) => {
    const reply = await read({
      name: 'expand_biblical_connection_v1',
      args: compactDefined({
        node_id: input.node_id,
        limit: input.limit,
        cursor: input.cursor ?? undefined,
        release_id: input.release_id,
      }),
      limit: 1,
      offset: 0,
    });
    const payload = asObj(reply.rows[0]);
    return { content: jsonContent(payload), structuredContent: payload };
  });
}
