import assert from "node:assert/strict";
import {
  createStagingApp,
  STAGING_CORPUS,
  STAGING_MCP_RELEASE,
} from "../supabase/functions/bible-mcp/staging.ts";

Deno.test("staging protocol: corpus routing, release evidence, no private or writable tools", async () => {
  const calls: string[] = [];
  const app = createStagingApp(async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith(STAGING_CORPUS + "/"));
    assert.ok(!url.includes("/rest/"));
    calls.push(url);
    return Response.json({
      status: "ok",
      release_version: "r9b-v1.1",
      resolved_occurrence: { word_id: 130555 },
    }, {
      headers: {
        "X-BibleResearch-Release": "r12-witnesses-1",
        "X-BibleResearch-Version": "fixture-version",
        "X-BibleResearch-Assets": "fixture-hash",
        "X-BibleResearch-Commit": "fixture-commit",
      },
    });
  });
  let id = 0;
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await app(
      new Request("https://test/functions/v1/bible-mcp-staging/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      }),
    );
    assert.equal(
      response.headers.get("X-BibleResearch-MCP-Release"),
      STAGING_MCP_RELEASE,
    );
    const text = await response.text();
    return response.headers.get("content-type")?.includes("text/event-stream")
      ? JSON.parse(
        text.split("\n").find((l) => l.startsWith("data:"))!.slice(5),
      )
      : JSON.parse(text);
  };
  const init = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "r12-tests", version: "1" },
  });
  assert.equal(init.result.serverInfo.name, "BibleResearch staging");
  const tools = (await rpc("tools/list")).result.tools;
  assert.equal(tools.length, 14);
  assert.ok(
    tools.every((t: { annotations: { readOnlyHint: boolean } }) =>
      t.annotations.readOnlyHint
    ),
  );
  for (
    const name of [
      "get_notes",
      "get_dlm_research",
      "create_note",
      "update_my_note",
      "delete_my_note",
      "save_dlm_research_note",
      "get_word_details",
    ]
  ) {
    assert.ok(!tools.some((t: { name: string }) => t.name === name));
    const denied = await rpc("tools/call", { name, arguments: {} });
    assert.ok(denied.error || denied.result?.isError);
  }
  assert.equal(calls.length, 0, "Rejected tools must never reach any backend");
  const result = (await rpc("tools/call", {
    name: "get_unified_word_relationships_v2",
    arguments: { query: "H7307" },
  })).result.structuredContent;
  assert.equal(result.verification_release.worker_version, "fixture-version");
  assert.equal(result.verification_release.asset_sha256, "fixture-hash");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith("/v1/rpc/query_relationships_v2"));
  const health = await (await app(new Request("https://test/health"))).json();
  assert.equal(health.writes, "disabled");
  assert.equal(health.read_only, true);
});
