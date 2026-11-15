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

export const UPSTREAM_PIN = {
  upstream_repo: 'bibleontology/bibleontology',
  upstream_commit: '62d6bc0fba5f84dfad245e546e87c6212b35fa75',
  macula_hebrew_commit: '47db250bd55d0d8577f2a94fba114ef16c35b23c',
  macula_greek_commit: '8423afe47b9e8f24b7772e808af45c7159a6fe7e',
  stepbible_commit: 'be4191f0082aeedddb0eff0c02c966292b2bd641',
  rule_version: '1.2',
  release_version: 'r3-v1.2',
  license: 'CC BY 4.0 / Apache-2.0',
};

const readOnlyMeta = {
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { securitySchemes: [{ type: 'noauth' }] },
};

const asObj = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};

const jsonContent = (obj: unknown) => [{ type: 'text' as const, text: JSON.stringify(obj) }];

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
      'Query verified Hebrew/Greek grammatical relationships from the Cloudflare R5 graph gateway across all 6 R3 predicates (subject, object, indirect object, second object, modifies, possessive/construct construction) in both outgoing and incoming directions. Preserves Hebrew homographs (returns needs_disambiguation for multi-homograph base Strongs unless suffix or passage position is provided) and supports summary_id evidence drill-down.',
    inputSchema: z.strictObject({
      query: z.string().trim().min(1).max(128).optional().describe('Disambiguated lemma ID (lemma:H1254a, lemma:H0430G), Strongs ID, token ID, or surface form.'),
      lemma_id: z.string().trim().min(1).max(64).optional().describe('Explicit canonical lemma_id (e.g. lemma:H0776G).'),
      summary_id: z.string().trim().min(1).max(256).optional().describe('If set, returns bounded exact occurrence evidence for that summary ID.'),
      relation_types: z.array(z.enum(R3_PREDICATES)).optional(),
      direction: z.enum(['both', 'outgoing', 'incoming']).default('both'),
      edition_key: z.enum(EDITIONS_V2).optional(),
      include_uncertain: z.boolean().default(false).describe('Include candidate-only summaries and candidate occurrence relations (default false = high_quality only).'),
      book: z.number().int().min(1).max(66).optional(),
      chapter: z.number().int().min(1).max(150).optional(),
      verse: z.number().int().min(0).max(176).optional(),
      position: z.number().int().min(1).max(200).optional().describe('1-based word position in the passage to disambiguate clicked homographs.'),
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).max(5000).default(0),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({
    query,
    lemma_id,
    summary_id,
    relation_types,
    direction = 'both',
    edition_key,
    include_uncertain = false,
    book,
    chapter,
    verse,
    position,
    limit = 25,
    offset = 0,
  }) => {
    if (!query && !lemma_id && !summary_id && position === undefined) {
      const payload = {
        schema_version: '2.0',
        status: 'invalid_request',
        error_message: 'Provide query, lemma_id, summary_id, or passage position.',
      };
      return { content: jsonContent(payload), structuredContent: payload, isError: true };
    }

    const args: Record<string, unknown> = summary_id
      ? {
          op: 'evidence',
          summary_id,
          include_uncertain,
          limit,
          offset,
        }
      : {
          op: 'lemma_relationships',
          ...(query ? { query } : {}),
          ...(lemma_id ? { lemma_id } : {}),
          ...(relation_types ? { predicates: relation_types } : {}),
          direction,
          ...(edition_key ? { edition_key } : {}),
          include_uncertain,
          ...(book !== undefined ? { book } : {}),
          ...(chapter !== undefined ? { chapter } : {}),
          ...(verse !== undefined ? { verse } : {}),
          ...(position !== undefined ? { position } : {}),
          limit,
          offset,
        };

    const payload = await queryGatewayV2(read, args);
    return { content: jsonContent(payload), structuredContent: payload };
  });

  server.registerTool('get_relationship_coverage_v2', {
    title: 'Inspect Cloudflare R5 relationship graph release & coverage',
    description:
      'Return the active Cloudflare R5 relationship graph release manifest, pinned upstream commits, supported R3 predicates, quality/coverage statistics, and optional passage coverage status.',
    inputSchema: z.strictObject({
      edition_key: z.enum(EDITIONS_V2).optional(),
      predicate: z.enum(R3_PREDICATES).optional(),
      book: z.number().int().min(1).max(66).optional(),
      chapter: z.number().int().min(1).max(150).optional(),
      verse: z.number().int().min(0).max(176).optional(),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({ edition_key, predicate, book, chapter, verse }) => {
    const gateway = await queryGatewayV2(read, {
      op: 'coverage',
      ...(edition_key ? { edition_key } : {}),
      ...(book !== undefined ? { book } : {}),
      ...(chapter !== undefined ? { chapter } : {}),
      ...(verse !== undefined ? { verse } : {}),
    });
    const payload = {
      ...gateway,
      provenance: UPSTREAM_PIN,
      ...(predicate ? { requested_predicate: predicate } : {}),
    };
    return { content: jsonContent(payload), structuredContent: payload };
  });
}
