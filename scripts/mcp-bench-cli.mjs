#!/usr/bin/env node
/**
 * BibleResearch MCP benchmark & blind research CLI.
 * Supports --target live | local, --tool <name>, --args <json> | --args-b64 <b64>,
 * --session <id>, --log <jsonlPath>, --list-tools.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parseCliArgs(argv) {
  const out = { target: 'live', tool: '', argsJson: '{}', session: 'default', log: '', listTools: false, noSupabase: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--tool') out.tool = argv[++i];
    else if (a === '--args') out.argsJson = argv[++i];
    else if (a === '--args-b64') out.argsJson = Buffer.from(argv[++i], 'base64').toString('utf8');
    else if (a === '--args-file') out.argsJson = fs.readFileSync(argv[++i], 'utf8');
    else if (a === '--session') out.session = argv[++i];
    else if (a === '--log') out.log = argv[++i];
    else if (a === '--list-tools') out.listTools = true;
    else if (a === '--no-supabase') out.noSupabase = true;
  }
  return out;
}

function loadDotEnv() {
  const envPath = path.join(repoRoot, '.env');
  const map = {};
  if (!fs.existsSync(envPath)) return map;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) map[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return map;
}

async function createLocalMcpApp(noSupabase) {
  const loaderPath = path.join(repoRoot, 'scripts', 'mcp-deno-loader.mjs');
  await import(`file:///${loaderPath.replace(/\\/g, '/')}`);

  const tmpOut = path.join(repoRoot, '.artifacts-r12', 'tmp-mcp-local.mjs');
  fs.mkdirSync(path.dirname(tmpOut), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(repoRoot, 'supabase/functions/bible-mcp/index.ts')],
    bundle: true,
    write: true,
    outfile: tmpOut,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    external: ['@modelcontextprotocol/server', '@modelcontextprotocol/core', 'zod'],
  });
  const mod = await import(`file:///${tmpOut.replace(/\\/g, '/')}?t=${Date.now()}`);
  const { localCorpusFetcher } = await import(`file:///${path.join(repoRoot, 'scripts', 'local-corpus-harness.mjs').replace(/\\/g, '/')}`);

  const env = loadDotEnv();
  const supaUrl = env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
  const supaKey = env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_local_stub';
  const literaryRoot = path.join(repoRoot, '.artifacts', 'v2', 'literary');

  const fetcher = localCorpusFetcher(async (url, init) => {
    if (url.pathname.startsWith('/v2/literary/')) {
      const rel = url.pathname.slice('/v2/literary/'.length);
      const fp = path.join(literaryRoot, rel);
      if (fp.startsWith(literaryRoot) && fs.existsSync(fp)) {
        return new Response(fs.readFileSync(fp), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }
    if (!noSupabase && url.origin === new URL(supaUrl).origin) {
      return fetch(url.toString(), init);
    }
    return Response.json([]);
  });

  const app = mod.createApp(
    { url: supaUrl, publicKey: supaKey, corpusUrl: 'https://corpus.test' },
    fetcher,
  );
  return app;
}

async function callMcpRpc(opts, method, params) {
  const reqBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-11-25',
  };

  let rawText = '';
  let contentType = 'application/json';
  let statusCode = 200;

  if (opts.target === 'local') {
    const app = await createLocalMcpApp(opts.noSupabase);
    const resp = await app(new Request('https://local.mcp/functions/v1/bible-mcp/mcp', {
      method: 'POST',
      headers,
      body: reqBody,
    }));
    statusCode = resp.status;
    contentType = resp.headers.get('content-type') || contentType;
    rawText = await resp.text();
  } else {
    const url = process.env.MCP_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp';
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: reqBody,
      signal: AbortSignal.timeout(60000),
    });
    statusCode = resp.status;
    contentType = resp.headers.get('content-type') || contentType;
    rawText = await resp.text();
  }

  let parsed = null;
  if (contentType.includes('text/event-stream')) {
    const dataLine = rawText.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).find((x) => x.id === 1);
    parsed = dataLine || { raw: rawText };
  } else {
    parsed = JSON.parse(rawText);
  }
  return { statusCode, wireBytes: Buffer.byteLength(rawText, 'utf8'), parsed };
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const t0 = Date.now();
  let method = 'tools/call';
  let params;
  let toolArgs = {};

  if (opts.listTools) {
    method = 'tools/list';
    params = {};
  } else {
    if (!opts.tool) {
      console.error('Missing --tool <name> or --list-tools');
      process.exit(2);
    }
    toolArgs = JSON.parse(opts.argsJson || '{}');
    params = { name: opts.tool, arguments: toolArgs };
  }

  const { statusCode, wireBytes, parsed } = await callMcpRpc(opts, method, params);
  const latencyMs = Date.now() - t0;
  const result = parsed?.result ?? parsed;
  const isError = Boolean(result?.isError || parsed?.error || statusCode >= 400);

  let payloadText = '';
  let hasStructuredDuplicate = false;
  if (opts.listTools) {
    payloadText = JSON.stringify(result, null, 2);
  } else if (result?.content?.[0]?.text) {
    payloadText = result.content[0].text;
    hasStructuredDuplicate = result.structuredContent !== undefined;
  } else {
    payloadText = JSON.stringify(result);
  }

  let statusField = isError ? 'error' : 'ok';
  try {
    const obj = JSON.parse(payloadText);
    if (obj && typeof obj.status === 'string') statusField = obj.status;
  } catch { /* plain text */ }

  if (opts.log) {
    const logPath = path.resolve(repoRoot, opts.log);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify({
      ts: new Date().toISOString(),
      target: opts.target,
      session: opts.session,
      tool: opts.listTools ? 'tools/list' : opts.tool,
      args: toolArgs,
      http_status: statusCode,
      latency_ms: latencyMs,
      wire_bytes: wireBytes,
      payload_bytes: Buffer.byteLength(payloadText, 'utf8'),
      has_structured_duplicate: hasStructuredDuplicate,
      status: statusField,
      is_error: isError,
      response_preview: payloadText.slice(0, 600),
    }) + '\n');
  }

  console.log(JSON.stringify({
    meta: { target: opts.target, tool: opts.listTools ? 'tools/list' : opts.tool, latency_ms: latencyMs, wire_bytes: wireBytes, payload_bytes: Buffer.byteLength(payloadText, 'utf8'), has_structured_duplicate: hasStructuredDuplicate, is_error: isError },
    data: (() => { try { return JSON.parse(payloadText); } catch { return payloadText; } })(),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
