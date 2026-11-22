// @file: supabase/functions/bible-mcp/index.ts
// @feature: api
// @tables: words | verses | verse_translation_sources | chronology_models | chronology_runs | chronology_assertions | chronology_evidence | places | place_locations | verse_geography | passage_geography | geography_sources | lexemes | concepts | assertions | assertion_evidence | notes | note_anchors | note_connections | note_blocks | note_authors
// @candidates: none
// @toc: imports | types | logic:database | logic:transport | logic:entrypoint

// === @section:imports ===
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createResearchServer, type DatabasePage, type DatabaseQuery, type DatabaseReader } from './catalog.ts';
import { PROMPTS } from './catalog.ts';
import { WORKFLOW_VERSION } from './research-workflow.ts';
import { RESEARCH_TOOL_NAMES } from './workflow-contract.ts';
import { createNotesWriter, registerNoteWriteTools, type NotesWriter } from './notes-write.ts';
import { registerDlmWriteTools } from './dlm-notes.ts';
import { createChainStore } from './chain-store.ts';
import { formatRef } from './bible-ref.ts';
import { createDiscoveryV2Server, V2_READ_TOOL_NAMES } from './discovery-v2-tools.ts';

// === @section:types ===
export interface DatabaseConfig {
  url: string;
  publicKey: string;
  corpusUrl?: string;
  serviceRoleKey?: string;
  agentKey?: string;
}
const DEFAULT_CORPUS_URL = 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev';
const DEFAULT_STAGING_CORPUS_URL = 'https://bibleresearch-corpus-staging.kingdomfishers-custom.workers.dev';
const corpusRpcs = new Set([
  'lookup_septuagint_passage_v1',
  'lookup_syntax_tree_v1',
  'compare_hebrew_septuagint_passage_v1',
  'lookup_hebrew_septuagint_alignments_v1',
  'audit_evidence_coverage_v1',
  'query_relationships_v2',
  'resolve_research_concept_v1',
  'discover_relationship_paths_v1',
  'discover_biblical_connections_v1',
  'discover_biblical_connections_v2',
  'get_connection_evidence_v1',
  'expand_biblical_connection_v1',
  'get_passage_compact_v1',
  'get_word_profiles_batch_v1',
  'resolve_fast_lookup_v1',
]);
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
  'query_relationships_v2',
  'resolve_research_concept_v1',
  'discover_relationship_paths_v1',
  'discover_biblical_connections_v1',
  'discover_biblical_connections_v2',
  'get_connection_evidence_v1',
  'expand_biblical_connection_v1',
  'get_passage_compact_v1',
  'get_word_profiles_batch_v1',
  'resolve_fast_lookup_v1',
  'lookup_concept_properties_v1',
  'get_word_formation_v1',
  'suggest_orthographic_candidates_v1',
  'get_verse_research_v2',
  'research_word_lens_v1',
  'research_word_bridge_v1',
  'research_passage_lens_v1',
  'get_dlm_notes_for_verse_v1',
  'verify_dlm_lemma_occurrence_v1',
  'get_notes_for_passage_v1',
  'get_notes_for_word_v1',
  'get_note_v1',
  'search_note_targets_v1',
  'list_note_connection_types_v1',
]);
const singlePacketRpcs = new Set([
  'get_dlm_notes_for_verse_v1',
  'verify_dlm_lemma_occurrence_v1',
  'research_word_lens_v1',
  'research_word_bridge_v1',
  'research_passage_lens_v1',
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
  'query_relationships_v2',
  'resolve_research_concept_v1',
  'discover_relationship_paths_v1',
  'discover_biblical_connections_v1',
  'discover_biblical_connections_v2',
  'get_connection_evidence_v1',
  'expand_biblical_connection_v1',
  'get_passage_compact_v1',
  'get_word_profiles_batch_v1',
  'resolve_fast_lookup_v1',
  'lookup_concept_properties_v1',
  'get_word_formation_v1',
  'suggest_orthographic_candidates_v1',
  'get_notes_for_passage_v1',
  'get_notes_for_word_v1',
  'get_note_v1',
  'search_note_targets_v1',
  'list_note_connection_types_v1',
]);
const customReadOps = new Set([
  'get_word_details',
  'get_words_batch',
  'query_words_by_gematria',
  'query_places_by_name',
  'query_chronology_assertions_batch',
]);
const corpusOnlyRpcs = new Set([
  'query_relationships_v2',
  'resolve_research_concept_v1',
  'discover_relationship_paths_v1',
  'discover_biblical_connections_v1',
  'discover_biblical_connections_v2',
  'get_connection_evidence_v1',
  'expand_biblical_connection_v1',
  'get_passage_compact_v1',
  'get_word_profiles_batch_v1',
  'resolve_fast_lookup_v1',
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
export function createDatabaseReader(
  config: DatabaseConfig,
  fetcher: typeof fetch = fetch,
  resolveCorpusUrl?: () => string | undefined,
): DatabaseReader {
  const base = new URL(config.url);
  if (!['https:', 'http:'].includes(base.protocol) || !isPublicKey(config.publicKey)) {
    throw new Error('BibleResearch requires a Supabase URL and public publishable/anon key.');
  }
  async function publicRestGet(pathAndQuery: string): Promise<Record<string, unknown>[]> {
    const url = new URL(pathAndQuery, base);
    const req: RequestInit = {
      method: 'GET',
      headers: { apikey: config.publicKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    };
    let res = await fetcher(url, req);
    if ([500, 502, 503, 504].includes(res.status)) {
      await res.body?.cancel();
      res = await fetcher(url, req);
    }
    if (!res.ok) throw new Error(`Bible data source unavailable (HTTP ${res.status}).`);
    const data = await res.json();
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  }

  return async ({ name, args, limit, offset }: DatabaseQuery): Promise<DatabasePage> => {
    if (!allowedRpcs.has(name) && !customReadOps.has(name)) throw new Error('Unsupported Bible operation.');
    const single = singlePacketRpcs.has(name) || customReadOps.has(name);
    const pageLimit = single ? 1 : limit;
    const pageOffset = single ? 0 : offset;
    const corpusBase = (resolveCorpusUrl?.() || config.corpusUrl || DEFAULT_CORPUS_URL).replace(/\/+$/, '');
    if (corpusRpcs.has(name)) {
      try {
        const corpReq: RequestInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(args ?? {}),
          signal: AbortSignal.timeout(8000),
        };
        const corpUrl = `${corpusBase}/v1/rpc/${name}`;
        let corpRes = await fetcher(corpUrl, corpReq);
        const retryableCorpusStatuses =
          name === 'discover_biblical_connections_v1' || name === 'discover_biblical_connections_v2'
            ? [502, 504]
            : [500, 502, 503, 504];
        for (let attempt = 0; attempt < 2 && retryableCorpusStatuses.includes(corpRes.status); attempt++) {
          await corpRes.body?.cancel();
          const backoffMs = 60 * (attempt + 1) + Math.floor(Math.random() * 80);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          corpRes = await fetcher(corpUrl, {
            ...corpReq,
            signal: AbortSignal.timeout(8000),
          });
        }
        if (corpRes.ok) {
          const corpData = await corpRes.json();
          if (corpData && typeof corpData === 'object' && !Array.isArray(corpData)) {
            const corpusRelease = corpRes.headers.get('X-BibleResearch-Release');
            const rowPayload = corpusRelease
              ? {
                  ...(corpData as Record<string, unknown>),
                  verification_release: {
                    mcp_release: WORKFLOW_VERSION,
                    corpus_target: corpusBase.includes('staging') ? 'staging' : 'production',
                    corpus_url: corpusBase,
                    corpus_release: corpusRelease,
                    worker_version: corpRes.headers.get('X-BibleResearch-Version'),
                    source_commit: corpRes.headers.get('X-BibleResearch-Commit'),
                    asset_sha256: corpRes.headers.get('X-BibleResearch-Assets'),
                  },
                }
              : (corpData as Record<string, unknown>);
            return {
              source: 'live',
              rows: [rowPayload],
              page: { limit: 1, offset: 0, has_more: false, next_offset: null },
            };
          }
        }
        if (corpusOnlyRpcs.has(name)) {
          throw new Error(`Cloudflare relationship graph gateway HTTP ${corpRes.status}`);
        }
      } catch (err) {
        if (corpusOnlyRpcs.has(name)) {
          throw new Error(err instanceof Error ? err.message : 'Cloudflare relationship graph gateway unavailable.');
        }
        /* fall back to PostgREST RPC */
      }
    }

    if (name === 'get_words_batch') {
      const ids = Array.isArray(args.word_ids)
        ? [...new Set(args.word_ids.map(Number).filter(n => Number.isInteger(n) && n > 0))]
        : [];
      const chunks: number[][] = [];
      for (let i = 0; i < ids.length; i += 100) {
        chunks.push(ids.slice(i, i + 100));
      }
      const pages: Record<string, unknown>[][] = [];
      for (let i = 0; i < chunks.length; i += 4) {
        pages.push(...await Promise.all(chunks.slice(i, i + 4).map(c =>
          publicRestGet(`/rest/v1/words?id=in.(${c.join(',')})&select=${wordColumns},gematria`))));
      }
      const rows = pages.flat();
      return {
        source: 'live',
        rows,
        page: { limit: rows.length || 1, offset: 0, has_more: false, next_offset: null },
      };
    }

    if (name === 'query_words_by_gematria') {
      const val = Number(args.gematria);
      if (!Number.isInteger(val) || val <= 0) {
        return { source: 'live', rows: [], page: { limit, offset, has_more: false, next_offset: null } };
      }
      const lim = Math.min(Math.max(1, Number(limit || 25)), 50);
      const off = Math.max(0, Number(offset || 0));
      const rows = await publicRestGet(
        `/rest/v1/words?gematria=eq.${val}&select=${wordColumns},gematria&order=id.asc&limit=${lim + 1}&offset=${off}`,
      );
      const hasMore = rows.length > lim;
      return {
        source: 'live',
        rows: rows.slice(0, lim),
        page: { limit: lim, offset: off, has_more: hasMore, next_offset: hasMore ? off + lim : null },
      };
    }

    if (name === 'query_places_by_name') {
      const q = String(args.query || '').replace(/[*%()\\]/g, '').trim();
      if (!q) {
        return { source: 'live', rows: [{ places: [] }], page: { limit: 1, offset: 0, has_more: false, next_offset: null } };
      }
      const lim = Math.min(Math.max(1, Number(limit || 10)), 25);
      const placesRaw = await publicRestGet(
        `/rest/v1/places?published=eq.true&biblical_name=ilike.*${encodeURIComponent(q)}*&select=id,place_key,biblical_name,place_type,hebrew_name,greek_name,is_non_physical&order=id.asc&limit=${lim}`,
      );
      if (placesRaw.length === 0) {
        return { source: 'live', rows: [{ places: [] }], page: { limit: 1, offset: 0, has_more: false, next_offset: null } };
      }
      const pids = placesRaw.map(p => Number(p.id)).filter(n => Number.isInteger(n) && n > 0);
      const [locs, pgRows, vgRows] = await Promise.all([
        publicRestGet(`/rest/v1/place_locations?place_id=in.(${pids.join(',')})&published=eq.true&is_alternative=eq.false&select=place_id,modern_name,latitude,longitude`),
        publicRestGet(`/rest/v1/passage_geography?place_id=in.(${pids.join(',')})&published=eq.true&select=place_id,passage_key,title,book,start_chapter,start_verse,end_chapter,end_verse,relationship_type&limit=40`),
        publicRestGet(`/rest/v1/verse_geography?place_id=in.(${pids.join(',')})&published=eq.true&select=place_id,verse_id,relationship_type,evidence_ref&limit=40`),
      ]);
      const locByPid = new Map<number, Record<string, unknown>>();
      for (const l of locs) {
        const pid = Number(l.place_id);
        if (!locByPid.has(pid)) locByPid.set(pid, l);
      }
      const places = placesRaw.map(p => {
        const pid = Number(p.id);
        const loc = locByPid.get(pid);
        const linkedPassages: Record<string, unknown>[] = [];
        for (const pg of pgRows) {
          if (Number(pg.place_id) !== pid) continue;
          const start = formatRef(Number(pg.book), Number(pg.start_chapter), Number(pg.start_verse));
          const end = formatRef(Number(pg.book), Number(pg.end_chapter), Number(pg.end_verse));
          linkedPassages.push({ ref: start === end ? start : `${start}-${end}`, relationship_type: pg.relationship_type, passage_key: pg.passage_key, title: pg.title });
        }
        for (const vg of vgRows) {
          if (Number(vg.place_id) !== pid) continue;
          linkedPassages.push({ ref: vg.evidence_ref || null, verse_id: vg.verse_id, relationship_type: vg.relationship_type });
        }
        return {
          place: p.biblical_name,
          place_key: p.place_key,
          place_type: p.place_type,
          is_non_physical: Boolean(p.is_non_physical),
          modern_name: loc?.modern_name ?? null,
          lat: typeof loc?.latitude === 'number' ? loc.latitude : null,
          lon: typeof loc?.longitude === 'number' ? loc.longitude : null,
          linked_passages: [...new Map(linkedPassages.map(x => [JSON.stringify(x), x])).values()].slice(0, 12),
          linked_passages_truncated: linkedPassages.length > 12 || pgRows.length === 40 || vgRows.length === 40,
        };
      });
      return { source: 'live', rows: [{ places }], page: { limit: 1, offset: 0, has_more: false, next_offset: null } };
    }

    if (name === 'query_chronology_assertions_batch') {
      const vids = Array.isArray(args.verse_ids)
        ? [...new Set(args.verse_ids.map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 80)
        : [];
      if (vids.length === 0) {
        return { source: 'live', rows: [{ models: [], assertions: [] }], page: { limit: 1, offset: 0, has_more: false, next_offset: null } };
      }
      const [models, assertionsRaw] = await Promise.all([
        publicRestGet('/rest/v1/chronology_models?published=eq.true&select=id,name,adam_year,resurrection_year'),
        publicRestGet(`/rest/v1/chronology_assertions?published=eq.true&verse_id=in.(${vids.join(',')})&select=verse_id,model_id,axis,earliest_year,latest_year,preferred_year,precision,rationale,event_id&limit=400`),
      ]);
      const fmtYear = (y: number) => (y <= 0 ? `${1 - y} BC` : `AD ${y}`);
      const assertions = assertionsRaw.map(a => {
        const pref = typeof a.preferred_year === 'number' ? a.preferred_year : null;
        const ear = typeof a.earliest_year === 'number' ? a.earliest_year : null;
        const lat = typeof a.latest_year === 'number' ? a.latest_year : null;
        const date_label = pref !== null
          ? fmtYear(pref)
          : ear !== null && lat !== null
            ? (ear === lat ? fmtYear(ear) : `${fmtYear(ear)}..${fmtYear(lat)}`)
            : ear !== null ? fmtYear(ear) : '';
        return { ...a, date_label };
      });
      return { source: 'live', rows: [{ models, assertions }], page: { limit: 1, offset: 0, has_more: false, next_offset: null } };
    }

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
    const rows: Record<string, unknown>[] = name === 'verify_dlm_lemma_occurrence_v1'
      ? [{attested:data===true}]
      : name === 'resolve_word_id'
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
  let writer: NotesWriter | null = null;
  if (config.serviceRoleKey) {
    writer = createNotesWriter({
      url: config.url,
      serviceRoleKey: config.serviceRoleKey,
      agentKey: config.agentKey,
    }, fetcher);
  }
  const chainStore = createChainStore(
    config.serviceRoleKey ? { url: config.url, serviceRoleKey: config.serviceRoleKey } : null,
    fetcher,
  );
  const v2Paths = new Set(['/', '/mcp', '/bible-mcp', '/bible-mcp/mcp',
    '/functions/v1/bible-mcp', '/functions/v1/bible-mcp/mcp',
    '/bible-mcp-staging', '/bible-mcp-staging/mcp',
    '/functions/v1/bible-mcp-staging', '/functions/v1/bible-mcp-staging/mcp']);
  const legacyPaths = new Set([
    '/legacy', '/legacy/mcp', '/bible-mcp/legacy', '/bible-mcp/legacy/mcp',
    '/functions/v1/bible-mcp/legacy', '/functions/v1/bible-mcp/legacy/mcp',
    '/bible-mcp-staging/legacy', '/bible-mcp-staging/legacy/mcp',
    '/functions/v1/bible-mcp-staging/legacy', '/functions/v1/bible-mcp-staging/legacy/mcp',
  ]);
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
      const writesEnabled = Boolean(writer);
      const isLegacyHealth = path.includes('/legacy/');
      const legacyTools = RESEARCH_TOOL_NAMES.length + (writesEnabled ? 5 : 0);
      const v2Tools = V2_READ_TOOL_NAMES.length + (writesEnabled ? 1 : 0);
      const corpusTarget = config.corpusUrl ? 'custom' : (path.includes('bible-mcp-staging') ? 'staging' : 'production');
      const activeCorpusUrl = config.corpusUrl || (path.includes('bible-mcp-staging') ? DEFAULT_STAGING_CORPUS_URL : DEFAULT_CORPUS_URL);
      return withCors(Response.json(isLegacyHealth ? {
        name: 'BibleResearch',
        version: WORKFLOW_VERSION,
        surface: 'legacy',
        status: 'ok',
        transport: 'streamable-http',
        authentication: config.agentKey ? 'bearer' : 'none',
        read_only: !writesEnabled,
        writes: writesEnabled ? 'enabled' : 'disabled',
        corpus_target: corpusTarget,
        corpus_url: activeCorpusUrl,
        tools: legacyTools,
        prompts: Object.keys(PROMPTS).length,
      } : {
        name: 'BibleResearch',
        version: WORKFLOW_VERSION,
        surface: 'v2-discovery',
        status: 'ok',
        transport: 'streamable-http',
        authentication: config.agentKey ? 'bearer' : 'none',
        read_only: !writesEnabled,
        writes: writesEnabled ? 'enabled' : 'disabled',
        corpus_target: corpusTarget,
        corpus_url: activeCorpusUrl,
        tools: v2Tools,
        prompts: 1,
        legacy_endpoint: '/legacy/mcp',
        legacy_tools: legacyTools,
        legacy_prompts: Object.keys(PROMPTS).length,
      }));
    }
    const isLegacy = legacyPaths.has(path);
    if (!v2Paths.has(path) && !isLegacy) return withCors(Response.json({ error: 'Not found' }, { status: 404 }));
    const corpusUrl = config.corpusUrl || (path.includes('bible-mcp-staging') ? DEFAULT_STAGING_CORPUS_URL : DEFAULT_CORPUS_URL);
    const read = createDatabaseReader({ ...config, corpusUrl }, fetcher);
  const v2Mcp = createMcpHandler(() => {
    const reqHeaders = request.headers;
    return createDiscoveryV2Server(read, writer, chainStore, () => reqHeaders);
  }, { maxRequestBodySize: 32768 });
  const legacyMcp = createMcpHandler(() => {
    const reqHeaders = request.headers;
    const server = createResearchServer(read);
    if (writer) {
      registerNoteWriteTools(server, writer, () => reqHeaders, read);
      registerDlmWriteTools(server, read, writer, () => reqHeaders);
    }
    return server;
  }, { maxRequestBodySize: 32768 });

    try { return withCors(await (isLegacy ? legacyMcp : v2Mcp).fetch(request)); }
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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const agentKey = Deno.env.get('NOTES_AGENT_KEY');
  if (!url || !publicKey) throw new Error('Supabase public environment is not configured.');
  Deno.serve(createApp({ url, publicKey, serviceRoleKey, agentKey }));
}
