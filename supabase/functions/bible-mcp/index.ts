// @file: supabase/functions/bible-mcp/index.ts
// @feature: api
// @tables: words | verses | verse_translation_sources | chronology_models | chronology_runs | chronology_assertions | chronology_evidence | places | place_locations | verse_geography | passage_geography | geography_sources | lexemes | concepts | assertions | assertion_evidence
// @candidates: none
// @toc: imports | types | logic:database | logic:transport | logic:entrypoint

// === @section:imports ===
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createResearchServer, type DatabasePage, type DatabaseQuery, type DatabaseReader } from './catalog.ts';
import { PROMPTS } from './catalog.ts';
import { WORKFLOW_VERSION } from './research-workflow.ts';
import { RESEARCH_TOOL_NAMES } from './workflow-contract.ts';

// === @section:types ===
export interface DatabaseConfig { url: string; publicKey: string }
const allowedRpcs = new Set([
  'prompt_verse_words',
  'prompt_word_occurrences',
  'prompt_word_cooccurrences',
  'prompt_word_relationships',
  'resolve_word_id',
  'get_verse_chronology_v1',
  'get_verse_geography',
  'research_relationships_v1',
  'get_verse_research_v1',
  'lookup_septuagint_passage_v1',
  'lookup_lexical_semantics_v1',
  'lookup_syntax_tree_v1',
  'compare_hebrew_septuagint_passage_v1',
  'lookup_hebrew_septuagint_alignments_v1',
  'audit_evidence_coverage_v1',
  'get_word_formation_v1',
  'suggest_orthographic_candidates_v1',
  'get_verse_research_v2',
]);
const singlePacketRpcs = new Set([
  'resolve_word_id',
  'get_verse_chronology_v1',
  'get_verse_geography',
  'research_relationships_v1',
  'get_verse_research_v1',
  'get_verse_research_v2',
  'lookup_septuagint_passage_v1',
  'lookup_lexical_semantics_v1',
  'lookup_syntax_tree_v1',
  'compare_hebrew_septuagint_passage_v1',
  'lookup_hebrew_septuagint_alignments_v1',
  'audit_evidence_coverage_v1',
  'get_word_formation_v1',
  'suggest_orthographic_candidates_v1',
]);
const wordColumns = 'id,strongs_nr,original_word,transliteration,grammar_code,biblical_def,physical_def,english_translations';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Mcp-Method, Mcp-Name',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
};

// === @section:logic:database ===
function isPublicKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return true;
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).role === 'anon';
  } catch { return false; }
}
export function createDatabaseReader(config: DatabaseConfig, fetcher: typeof fetch = fetch): DatabaseReader {
  const base = new URL(config.url);
  if (!['https:', 'http:'].includes(base.protocol) || !isPublicKey(config.publicKey)) {
    throw new Error('BibleResearch requires a Supabase URL and public publishable/anon key.');
  }
  return async ({ name, args, limit, offset }: DatabaseQuery): Promise<DatabasePage> => {
    if (!allowedRpcs.has(name) && name !== 'get_word_details') throw new Error('Unsupported Bible operation.');
    const single = singlePacketRpcs.has(name) || name === 'get_word_details';
    const pageLimit = single ? 1 : limit;
    const pageOffset = single ? 0 : offset;
    const url = new URL(name === 'get_word_details' ? '/rest/v1/words' : `/rest/v1/rpc/${name}`, base);
    if (name === 'get_word_details') {
      url.searchParams.set('id', `eq.${args.word_id}`);
      url.searchParams.set('select', wordColumns);
    }
    if (!singlePacketRpcs.has(name)) {
      url.searchParams.set('limit', String(pageLimit + 1));
      url.searchParams.set('offset', String(pageOffset));
    }
    const request: RequestInit = {
      method: name === 'get_word_details' ? 'GET' : 'POST',
      headers: { apikey: config.publicKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: name === 'get_word_details' ? undefined : JSON.stringify(args),
      signal: AbortSignal.timeout(12000),
    };
    let response = await fetcher(url, request);
    // Every allowlisted operation is a read. Retry one transient upstream failure
    // within the original 12-second budget, preserving the same public identity.
    if ([500, 502, 503, 504].includes(response.status)) {
      await response.body?.cancel();
      response = await fetcher(url, request);
    }
    if (!response.ok) {
      console.error('BibleResearch Data API request failed', { operation: name, status: response.status });
      throw new Error('Bible database unavailable.');
    }
    const data = await response.json();
    const rows: Record<string, unknown>[] = name === 'resolve_word_id'
      ? (typeof data === 'number' && data > 0 ? [{ word_id: data }] : [])
      : singlePacketRpcs.has(name)
        ? (data && typeof data === 'object' && !Array.isArray(data) ? [data as Record<string, unknown>] : [])
        : data;
    if (!Array.isArray(rows)) throw new Error('Unexpected Bible database response.');
    const hasMore = !single && rows.length > pageLimit;
    return { source: 'live', rows: rows.slice(0, pageLimit),
      page: { limit: pageLimit, offset: pageOffset, has_more: hasMore,
        next_offset: hasMore ? pageOffset + pageLimit : null } };
  };
}

// === @section:logic:transport ===
export function createApp(config: DatabaseConfig, fetcher: typeof fetch = fetch) {
  const read = createDatabaseReader(config, fetcher);
  const mcp = createMcpHandler(() => createResearchServer(read), { maxRequestBodySize: 32768 });
  const paths = new Set(['/', '/mcp', '/bible-mcp', '/bible-mcp/mcp',
    '/functions/v1/bible-mcp', '/functions/v1/bible-mcp/mcp']);
  const withCors = (response: Response) => {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  };
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    if (request.method === 'GET' && path.endsWith('/health')) {
      return withCors(Response.json({ name: 'BibleResearch', version: WORKFLOW_VERSION, status: 'ok',
        transport: 'streamable-http', authentication: 'none', read_only: true,
        tools: RESEARCH_TOOL_NAMES.length, prompts: Object.keys(PROMPTS).length }));
    }
    if (!paths.has(path)) return withCors(Response.json({ error: 'Not found' }, { status: 404 }));
    try { return withCors(await mcp.fetch(request)); }
    catch {
      console.error('BibleResearch MCP transport failed');
      return withCors(Response.json({ error: 'MCP temporarily unavailable' }, { status: 500 }));
    }
  };
}

// === @section:logic:entrypoint ===
if (import.meta.main) {
  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('BIBLE_SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !publicKey) throw new Error('Supabase public environment is not configured.');
  Deno.serve(createApp({ url, publicKey }));
}
