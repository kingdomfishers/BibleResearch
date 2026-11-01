// @file: supabase/functions/bible-mcp/catalog.ts
// @feature: api
// @tables: words | verses | verse_translation_sources | chronology_models | chronology_runs | chronology_assertions | chronology_evidence | places | place_locations | verse_geography | passage_geography | geography_sources | lexemes | concepts | assertions | assertion_evidence
// @candidates: none
// @toc: imports | types | logic:contracts | logic:prompts | logic:database-tools | logic:hydrated-tool | logic:research-tools | logic:server

// === @section:imports ===
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { PATTERN_PROMPTS } from './pattern-prompts.ts';

// === @section:types ===
export type RpcName =
  | 'prompt_verse_words'
  | 'prompt_word_occurrences'
  | 'prompt_word_cooccurrences'
  | 'prompt_word_relationships'
  | 'resolve_word_id'
  | 'get_verse_chronology_v1'
  | 'get_verse_geography'
  | 'research_relationships_v1'
  | 'get_verse_research_v1';
export interface DatabaseQuery {
  name: RpcName | 'get_word_details';
  args: Record<string, unknown>;
  limit: number;
  offset: number;
}
export interface DatabasePage {
  source: 'live';
  rows: Record<string, unknown>[];
  page: { limit: number; offset: number; has_more: boolean; next_offset: number | null };
}
export type DatabaseReader = (query: DatabaseQuery) => Promise<DatabasePage>;

// === @section:logic:contracts ===
const wordQuery = z.string().trim().min(1).max(128)
  .describe("Strong's number (H7225/G3056), database word ID, exact original form or transliteration.");
const wordId = z.number().int().positive().max(2147483647);
const pagination = {
  limit: z.number().int().min(1).max(100).default(25).describe('Maximum rows on this page, up to 100.'),
  offset: z.number().int().min(0).max(50000).default(0).describe('Continue at page.next_offset.'),
};
const pageSchema = z.object({
  source: z.literal('live'),
  rows: z.array(z.record(z.string(), z.unknown())),
  page: z.object({
    limit: z.number(), offset: z.number(), has_more: z.boolean(), next_offset: z.number().nullable(),
  }),
});
const publicRead = {
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { securitySchemes: [{ type: 'noauth' }] },
};
export const SERVER_INSTRUCTIONS = [
  'BibleResearch provides read-only research on the STEP Hebrew/Aramaic OT and Greek NT corpus, multi-model chronology, context-aware geography, and the relationship evidence graph.',
  'Book IDs are canonical 1-66 (Genesis=1, Psalms=19, Matthew=40, John=43, Revelation=66).',
  'Verse 0 denotes a retained Psalm heading. English glosses are not a continuous Bible translation.',
  'Resolve real positive word IDs with resolve_word_id or prompt_verse_words before comparing words.',
  'Occurrences and relationships group inflections by Strong\'s number. Scores are corpus statistics, not theological proof.',
  'Follow page.next_offset while has_more is true before claiming a complete set or count.',
  'Unknown chronology, symbolic/non-physical geography, and physical definitions remain explicit; never invent dates, coordinates, or missing passages.',
  'Use get_verse_research for one-call hydrated verses: words, public translations, grammar, complete occurrences, seven cached connections, chronology, geography and available semantic evidence. Inspect coverage and component statuses.',
  'Use get_research_prompt for saved study templates and ten deep-pattern templates covering repetition, structure, motifs, allusions, semantics, grammar, rare connections, time/place, translation effects and counterexamples.',
  'Cite returned book/chapter/verse references and distinguish corpus observations from interpretation.',
].join(' ');
const textContent = (text: string) => [{ type: 'text' as const, text }];

// === @section:logic:prompts ===
export const PROMPTS = {
  ...PATTERN_PROMPTS,
  study_verse: {
    title: 'Study a verse',
    description: 'Inspect an original-language passage. Subject example: Genesis 1:1 or John 1:1.',
    instruction: 'Retrieve the verse using get_verse_research with p_request.passages. Reuse shared lexical_entries for complete occurrences and top seven connections. Preserve word order, source translations, Strong\'s, grammar and definitions. Report chronology, map data and available semantic evidence with their coverage and uncertainty. Cite the passage and token positions; distinguish observations from interpretation.',
  },
  study_word: {
    title: 'Study a word',
    description: 'Study a lexical word across the corpus. Subject example: H7225 or G3056.',
    instruction: 'Resolve the word with resolve_word_id and inspect get_word_details. Retrieve prompt_word_occurrences and prompt_word_cooccurrences. Inspect representative passages with prompt_verse_words. Explain lexical range and corpus associations; paginate before claiming exhaustive results or totals, and cite every passage used.',
  },
  compare_words: {
    title: 'Compare words',
    description: 'Compare two or more words. Subject example: H7225, H1254.',
    instruction: 'Resolve each supplied word to its real database ID using resolve_word_id. Call prompt_word_relationships with those IDs, then inspect shared passages with prompt_verse_words. Explain the returned density score and distinguish it from co-occurrence frequency and proximity. Cite passages and avoid inferring causation or doctrine from scores.',
  },
  study_chronology: {
    title: 'Study verse chronology',
    description: 'Inspect multi-model dating and archaeological/textual evidence for a passage. Subject example: 1 Kings 6:1 or 2 Kings 18:13.',
    instruction: 'Call get_verse_chronology_v1 for the target passage (canonical book 1-66, chapter, verse). Present the primary chronological summary, distinguish setting vs. composition vs. mentioned_event axes, compare competing chronological models in alternatives, and cite archaeological/textual evidence items. Never invent dates when assignment_status is unresolved.',
  },
  study_geography: {
    title: 'Study verse geography',
    description: 'Inspect context-aware geographical settings, confidence, and disputed sites for a passage. Subject example: John 4:7, Genesis 29:10, or Exodus 15:23.',
    instruction: 'Call get_verse_geography for the target passage (canonical book 1-66, chapter, verse). Explain the 5-tier resolution_status (direct_event_location, passage_context, event_metadata, regional_context, symbolic_non_physical, or unknown). Distinguish event settings from mentioned_location, travel_origin, and travel_destination. Report biblical and modern names, coordinates or polygons, confidence_level, establishing biblical references, and any disputed alternative_locations. Never fabricate coordinates for symbolic or unknown passages.',
  },
  study_relationships: {
    title: 'Study concept & word relationships',
    description: 'Inspect one-call lexical, literary, and intertextual evidence paths. Subject example: well -> marriage, or menorah -> seven spirits of God.',
    instruction: 'Call research_relationships with subject (and optional target). Report disambiguated lexemes (including homograph subdivisions such as H1254a/b/c), reviewed evidence_paths with epistemic_category (textual vs. interpretive) and scope denominators, and controls_and_distinctions (such as non-marriage wells in Gen 21/26 or seven lampstands = seven churches in Rev 1:20).',
  },
} as const;
export type PromptName = keyof typeof PROMPTS;
export function researchPrompt(name: PromptName, subject: string): string {
  return `${PROMPTS[name].instruction}\nResearch subject: ${JSON.stringify(subject)}\n${SERVER_INSTRUCTIONS}`;
}
function registerPrompts(server: McpServer): void {
  for (const name of Object.keys(PROMPTS) as PromptName[]) {
    const prompt = PROMPTS[name];
    server.registerPrompt(name, {
      title: prompt.title, description: prompt.description,
      argsSchema: z.object({ subject: z.string().trim().min(1).max(500).describe(prompt.description) }),
    }, ({ subject }) => ({ messages: [{ role: 'user' as const,
      content: { type: 'text' as const, text: researchPrompt(name, subject) } }] }));
  }
  server.registerTool('get_research_prompt', {
    title: 'Get research instructions', description: 'Retrieve a saved research template to follow using the BibleResearch tools.',
    inputSchema: z.strictObject({
      name: z.enum(Object.keys(PROMPTS) as [PromptName, ...PromptName[]]),
      subject: z.string().trim().min(1).max(500),
    }),
    outputSchema: z.object({ name: z.string(), subject: z.string(), instructions: z.string() }),
    ...publicRead,
  }, ({ name, subject }) => {
    const result = { name, subject, instructions: researchPrompt(name, subject) };
    return { content: textContent(result.instructions), structuredContent: result };
  });
}

// === @section:logic:database-tools ===
function databaseTool(server: McpServer, read: DatabaseReader, name: DatabaseQuery['name'],
  title: string, description: string, inputSchema: z.ZodObject): void {
  server.registerTool(name, { title, description, inputSchema, outputSchema: pageSchema, ...publicRead }, async raw => {
    const { limit = 25, offset = 0, ...args } = raw;
    try {
      const result = await read({ name, args, limit: Number(limit), offset: Number(offset) });
      return { content: textContent(JSON.stringify(result)), structuredContent: { ...result } };
    } catch {
      return { isError: true, content: textContent('The Bible database is temporarily unavailable. Retry this research request.') };
    }
  });
}

// === @section:logic:hydrated-tool ===
function registerHydratedTool(server: McpServer, read: DatabaseReader): void {
  const passage = z.strictObject({ book: z.number().int().min(1).max(66),
    chapter: z.number().int().min(1).max(150), verse: z.number().int().min(0).max(176) });
  server.registerTool('get_verse_research', {
    title: 'Read fully hydrated verses in one call',
    description: 'Return one JSON packet for 1-5 verses: ordered source translations, Strong\'s, raw grammar, definitions, complete word occurrence references/counts, top seven cached connections, chronology, map data and available reviewed semantic evidence. Shared lexical_entries avoid duplication. Inspect coverage and component statuses; samples require explicit opt-in. Base Strong\'s groups are not assigned senses.',
    inputSchema: z.strictObject({ p_request: z.strictObject({
      passages: z.array(passage).min(1).max(5),
      occurrences: z.strictObject({ mode: z.enum(['all', 'sample']).default('all'),
        limit: z.number().int().min(1).max(100).optional() }).optional(),
      chronology_model_id: z.string().trim().min(1).max(128).optional(),
    }) }),
    outputSchema: z.object({ schema_version: z.literal(1),
      status: z.enum(['ok', 'invalid_request', 'passage_not_found', 'packet_limit_exceeded']),
    }).passthrough(),
    ...publicRead,
  }, async ({ p_request }) => {
    try {
      const result = await read({ name: 'get_verse_research_v1', args: { p_request }, limit: 1, offset: 0 });
      const packet = result.rows[0];
      if (!packet || packet.schema_version !== 1) throw new Error('Invalid hydration response');
      return { content: textContent(JSON.stringify(packet)), structuredContent: packet as { schema_version: 1;
        status: 'ok' | 'invalid_request' | 'passage_not_found' | 'packet_limit_exceeded' } };
    } catch {
      return { isError: true, content: textContent('Verse research is temporarily unavailable. Retry or request fewer passages.') };
    }
  });
}

// === @section:logic:research-tools ===
function registerResearchTools(server: McpServer, read: DatabaseReader): void {
  const passageFields = {
    p_book: z.number().int().min(1).max(66).describe('Canonical book ID: Genesis=1, John=43, Revelation=66.'),
    p_chapter: z.number().int().min(1).max(150),
    p_verse: z.number().int().min(0).max(176).describe('Verse number; 0 is a Psalm heading.'),
  };
  databaseTool(server, read, 'prompt_verse_words', 'Read original verse words',
    'Return ordered original-language verse tokens with database IDs, transliterations, morphology and glosses. Paginate if needed.',
    z.strictObject({ ...passageFields, ...pagination }));
  databaseTool(server, read, 'prompt_word_occurrences', 'Find word occurrences',
    'Find passages for a lexical word across inflections. Each row includes occurrence_count for that passage. This is a page, not the corpus total.',
    z.strictObject({ p_word_query: wordQuery, ...pagination }));
  databaseTool(server, read, 'prompt_word_cooccurrences', 'Find associated words',
    'Return up to 15 cached lexical partners, with frequency, average token distance and score. These are statistical associations.',
    z.strictObject({ p_word_query: wordQuery, ...pagination }));
  databaseTool(server, read, 'prompt_word_relationships', 'Find shared passages',
    'Find passages containing every selected lexical word, ordered by SQL density score. Supply real IDs from resolve_word_id or verse tokens.',
    z.strictObject({ p_word_ids: z.array(wordId).min(2).max(10), ...pagination }));
  databaseTool(server, read, 'resolve_word_id', 'Resolve a lexical word',
    'Resolve a Strong\'s number, exact original form, transliteration or positive ID to one representative database word_id. No rows means not found.',
    z.strictObject({ p_query: wordQuery }));
  databaseTool(server, read, 'get_word_details', 'Inspect a word',
    'Read a word\'s original form, Strong\'s number, grammar, glosses and available definitions. Null fields are unknown.',
    z.strictObject({ word_id: wordId }));
  databaseTool(server, read, 'get_verse_chronology_v1', 'Inspect verse chronology',
    'Retrieve multi-model historical setting, composition dating, archaeological/textual evidence, and competing chronological models for a verse.',
    z.strictObject({
      ...passageFields,
      p_model_id: z.string().trim().min(1).max(64).default('theographic-verse-v1')
        .describe('Chronology model ID: theographic-verse-v1, adam-resurrection-30-v1, adam-resurrection-33-v1, or archaeology-pilot-v1.'),
      p_run_id: z.string().uuid().nullable().optional().default(null),
      p_evidence_cursor: z.string().trim().max(128).nullable().optional().default(null),
    }));
  databaseTool(server, read, 'get_verse_geography', 'Inspect verse geography',
    'Resolve context-aware geographical settings for a verse (direct event, passage context, event metadata, regional inference, or symbolic/unknown) with coordinates, polygons, confidence, evidence, and disputed alternatives.',
    z.strictObject({ ...passageFields }));
  server.registerTool('research_relationships', {
    title: 'Research word & concept relationships',
    description: 'One-lookup original-language and literary relationship graph returning disambiguated lexemes, narrative parallels, intertextual allusions, and counterexample controls.',
    inputSchema: z.strictObject({
      subject: z.string().trim().min(1).max(128).describe('Subject word, concept, or Strong\'s number (e.g. "well", "menorah", "H1254").'),
      target: z.string().trim().min(1).max(128).optional().describe('Optional target word or concept (e.g. "marriage", "seven spirits of God").'),
      mode: z.enum(['explain', 'discover']).optional().default('explain'),
    }),
    outputSchema: pageSchema,
    ...publicRead,
  }, async ({ subject, target, mode }) => {
    try {
      const p_request = {
        subject: { text: subject },
        ...(target ? { target: { text: target } } : {}),
        mode: target ? mode : 'discover',
        corpus: 'primary',
      };
      const result = await read({ name: 'research_relationships_v1', args: { p_request }, limit: 1, offset: 0 });
      return { content: textContent(JSON.stringify(result)), structuredContent: { ...result } };
    } catch {
      return { isError: true, content: textContent('The Bible database is temporarily unavailable. Retry this research request.') };
    }
  });
}

// === @section:logic:server ===
export function createResearchServer(read: DatabaseReader): McpServer {
  const server = new McpServer({ name: 'BibleResearch', version: '1.3.0' }, { instructions: SERVER_INSTRUCTIONS });
  registerResearchTools(server, read);
  registerHydratedTool(server, read);
  registerPrompts(server);
  return server;
}
