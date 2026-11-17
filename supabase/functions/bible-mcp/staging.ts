/** Public, corpus-only staging connector. No database client, credentials or notes. */
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { registerRelationshipV2Tools } from "./relationships-v2.ts";
import type { DatabaseReader } from "./catalog.ts";

export const STAGING_MCP_RELEASE = "r12-witnesses-1";
export const STAGING_CORPUS =
  "https://bibleresearch-corpus-staging.kingdomfishers-custom.workers.dev";
const operations = new Set([
  "query_relationships_v2",
  "resolve_research_concept_v1",
  "discover_relationship_paths_v1",
  "discover_biblical_connections_v1",
  "discover_biblical_connections_v2",
  "get_connection_evidence_v1",
  "expand_biblical_connection_v1",
  "lookup_septuagint_passage_v1",
]);

export function createStagingApp(fetcher: typeof fetch = fetch) {
  const read: DatabaseReader = async ({ name, args }) => {
    if (!operations.has(name)) {
      throw new Error(
        "Only public corpus operations are available on staging.",
      );
    }
    const response = await fetcher(`${STAGING_CORPUS}/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Staging corpus HTTP ${response.status}`);
    const data = await response.json();
    const verification_release = {
      mcp_release: STAGING_MCP_RELEASE,
      corpus_target: "staging",
      corpus_url: STAGING_CORPUS,
      corpus_release: response.headers.get("X-BibleResearch-Release"),
      worker_version: response.headers.get("X-BibleResearch-Version"),
      source_commit: response.headers.get("X-BibleResearch-Commit"),
      asset_sha256: response.headers.get("X-BibleResearch-Assets"),
    };
    return {
      source: "live",
      rows: [{ ...data, verification_release }],
      page: { limit: 1, offset: 0, has_more: false, next_offset: null },
    };
  };
  const mcp = createMcpHandler(() => {
    const server = new McpServer({
      name: "BibleResearch staging",
      version: STAGING_MCP_RELEASE,
    }, {
      instructions:
        "Public read-only staging corpus. Cite verification_release and exact source witnesses. This connector has no notes, private data, writable tools or production fallback. Graph scores do not establish authorial or theological significance.",
    });
    registerRelationshipV2Tools(server, read);
    server.registerTool("get_septuagint_passage", {
      description:
        "Read authentic Swete Greek tokens with raw-source provenance from staging.",
      inputSchema: z.strictObject({
        p_book_no: z.number().int().min(1).max(55),
        p_chapter: z.number().int().min(1).max(151),
        p_verse_nr: z.number().int().min(0).max(176).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    }, async (args) => {
      const reply = await read({
        name: "lookup_septuagint_passage_v1",
        args,
        limit: 1,
        offset: 0,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(reply.rows[0]),
        }],
        structuredContent: reply.rows[0],
      };
    });
    return server;
  });
  return async (request: Request) => {
    const path = new URL(request.url).pathname;
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id",
      "Cache-Control": "no-store",
      "X-BibleResearch-MCP-Release": STAGING_MCP_RELEASE,
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method === "GET" && path.endsWith("/health")) {
      const backend = await fetcher(`${STAGING_CORPUS}/health`);
      return Response.json({
        name: "BibleResearch staging",
        mcp_release: STAGING_MCP_RELEASE,
        corpus_target: "staging",
        corpus_url: STAGING_CORPUS,
        read_only: true,
        writes: "disabled",
        tools: 14,
        prompts: 0,
        worker_version: backend.headers.get("X-BibleResearch-Version"),
        corpus_release: backend.headers.get("X-BibleResearch-Release"),
        asset_sha256: backend.headers.get("X-BibleResearch-Assets"),
        source_commit: backend.headers.get("X-BibleResearch-Commit"),
        backend_status: backend.status,
      }, { headers });
    }
    if (!path.endsWith("/mcp")) {
      return Response.json({
        error: "Not found",
        mcp_release: STAGING_MCP_RELEASE,
      }, { status: 404, headers });
    }
    const response = await mcp.fetch(request);
    const merged = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) merged.set(key, value);
    return new Response(response.body, {
      status: response.status,
      headers: merged,
    });
  };
}

if (import.meta.main) Deno.serve(createStagingApp());
