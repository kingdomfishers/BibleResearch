#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import worker from '../scripts/corpus-worker.mjs';
import { createApp } from '../supabase/functions/bible-mcp/index.ts';

const BUNDLE_ROOT = path.resolve('.artifacts-r10/deploy-bundle');
const env = {
  ASSETS: {
    async fetch(req) {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const full = path.join(BUNDLE_ROOT, rel);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        return new Response(fs.readFileSync(full), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    },
  },
};

const fakeFetch = async (input, init) => {
  const u = new URL(String(input));
  if (u.origin === 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev') {
    return await worker.fetch(new Request(u.toString(), init), env, {});
  }
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
};

const mcpApp = createApp({ url: 'https://example.supabase.co', publicKey: 'sb_publishable_test' }, fakeFetch);

async function mcpRpc(method, params = {}) {
  const resp = await mcpApp(new Request('https://example.supabase.co/functions/v1/bible-mcp/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }));
  const txt = await resp.text();
  if (resp.headers.get('content-type')?.includes('text/event-stream')) {
    return txt.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(m => m.id === 1);
  }
  return JSON.parse(txt);
}

const listed = (await mcpRpc('tools/list')).result.tools.map(t => t.name);
for (const name of ['discover_biblical_connections_v1', 'get_connection_evidence_v1', 'expand_biblical_connection_v1']) {
  assert.ok(listed.includes(name), `Missing R10 MCP tool: ${name}`);
}
const testA = (await mcpRpc('tools/call', { name: 'discover_biblical_connections_v1', arguments: { query: 'ruach, spirit, seven, eyes, lamps, menorah, oil, water, wind, directions' } })).result.structuredContent;
assert.equal(testA.status, 'ok');
assert.ok(testA.clusters.length >= 2);
const testB = (await mcpRpc('tools/call', { name: 'discover_biblical_connections_v1', arguments: { query: 'Red Sea baptism' } })).result.structuredContent;
assert.equal(testB.strongest_connections[0].evidence_tier, 1);
const testC = (await mcpRpc('tools/call', { name: 'get_connection_evidence_v1', arguments: { evidence_id: 'r10:orth:adam_dam_consonantal_overlap' } })).result.structuredContent;
assert.equal(testC.evidence.orthographic_analysis.proven_common_root, false);
const exp = (await mcpRpc('tools/call', { name: 'expand_biblical_connection_v1', arguments: { node_id: 'motif:lampstand' } })).result.structuredContent;
assert.equal(exp.status, 'ok');
console.log(`PASS R10 MCP server checks (${listed.length} tools registered, Tests A/B/C & expand verified cleanly).`);
