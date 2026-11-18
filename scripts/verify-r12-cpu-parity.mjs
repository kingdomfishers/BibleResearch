#!/usr/bin/env node
/**
 * Step 3 R12 verification harness:
 *   Part A: Strict 44-case local parity check against live MCP baseline snapshots
 *           using an HTTP-200 (no-Range) ASSETS binding on .artifacts-r12/staging-bundle.
 *   Part B: Local workerd V8 Inspector active CPU profiling (cold & warm) for
 *           the 6 discovery smoke queries + 2 get_connection_evidence_v1 calls.
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import corpusWorker from './corpus-worker.mjs';
import { withCorpusSecurity, registerFastJsonText } from './corpus-security.mjs';

const require = createRequire(import.meta.url);
const toolingPackage = path.resolve('.artifacts-r12/tooling/package.json');
const runtimeRequire = fs.existsSync(toolingPackage) ? createRequire(toolingPackage) : require;
const workerd = runtimeRequire('workerd');

const BUNDLE_ROOT = path.resolve('.artifacts-r12/staging-bundle');
const SNAPSHOT_DIR = path.resolve('research/r12/live_mcp_results_2026-11-18/current');
const BATCH_FILES = ['batch_001_020.json', 'batch_021_040.json', 'batch_041_060.json'];
const SAMPLING_INTERVAL_US = 50;
const COLD_CPU_BUDGET_MS = 8;
const WARM_CPU_BUDGET_MS = 5;

const PART_B_QUERIES = [
  { id: 'H0120', operation: 'discover_biblical_connections_v2', params: { query: 'H0120', limit: 25, max_hops: 5, mode: 'discover' } },
  { id: 'G3088', operation: 'discover_biblical_connections_v2', params: { query: 'G3088', limit: 25, max_hops: 5, mode: 'discover' } },
  { id: 'H5869', operation: 'discover_biblical_connections_v2', params: { query: 'H5869', limit: 25, max_hops: 5, mode: 'discover' } },
  { id: 'H1285', operation: 'discover_biblical_connections_v2', params: { query: 'H1285', limit: 25, max_hops: 5, mode: 'discover' } },
  { id: 'Genesis 1:1', operation: 'discover_biblical_connections_v2', params: { query: 'Genesis 1:1', limit: 25, max_hops: 5, mode: 'discover' } },
  { id: 'Exodus 12:15', operation: 'discover_biblical_connections_v2', params: { query: 'Exodus 12:15', limit: 25, max_hops: 5, mode: 'discover' } },
  { id: 'ev:r12:path:H5869:G0457', operation: 'get_connection_evidence_v1', params: { evidence_id: 'r12:path:H5869:G0457' } },
  { id: 'ev:r12:prop:G3088:H5216', operation: 'get_connection_evidence_v1', params: { evidence_id: 'r12:prop:G3088:H5216' } },
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function quote(value) {
  return JSON.stringify(value.replaceAll('\\', '/'));
}

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Canonical projection matching scripts/collect-r12-live-mcp-snapshot.mjs lines 44-62. */
function projectSavedRank(r, i) {
  const m = r.r12_metadata || {};
  return {
    rank: i + 1,
    evidence_id: r.evidence_id,
    title: r.title,
    predicate: r.predicate,
    epistemic_class: r.epistemic_class,
    evidence_tier: r.evidence_tier,
    passages: (r.passages || []).slice(0, 12).map(p => ({
      ref: p.ref,
      verse_id: p.verse_id,
      snippet: (p.snippet || '').slice(0, 180),
    })),
    original_words: (r.original_words || []).slice(0, 8).map(w => ({
      strongs: w.strongs,
      gloss: w.gloss,
    })),
    r12_metadata: Object.keys(m).length
      ? {
          score_version: m.score_version,
          epistemic_status: m.epistemic_status,
          epistemic_layer: m.epistemic_layer,
          Q: m.Q,
          C: m.C,
          D: m.D,
          T: m.T,
          interest: m.interest,
          mmr_score: m.mmr_score,
          independent_group_count: m.independent_group_count,
          independent_evidence_groups: m.independent_evidence_groups,
          meaningful_hops: m.meaningful_hops,
          steps: (m.steps || []).map(s => ({
            edge_id: s.edge_id,
            from_id: s.from_id,
            to_id: s.to_id,
            relation_type: s.relation_type,
            witness_refs: s.witness_refs,
            epistemic_layer: s.epistemic_layer,
          })),
          external_bridge: m.external_bridge,
        }
      : null,
  };
}

function compareCase(saved, actual) {
  const diffs = [];
  if (actual.status !== saved.status) {
    diffs.push(`status: expected ${saved.status}, got ${actual.status}`);
  }
  const actualConns = actual.strongest_connections || [];
  const savedTop = saved.top25 || [];
  if (actualConns.length !== savedTop.length) {
    diffs.push(`strongest_connections.length: expected ${savedTop.length}, got ${actualConns.length}`);
  }
  if (saved.pagination && !jsonEqual(actual.pagination, saved.pagination)) {
    diffs.push(`pagination mismatch: expected ${JSON.stringify(saved.pagination)}, got ${JSON.stringify(actual.pagination)}`);
  }
  if (saved.r12_discovery !== undefined && !jsonEqual(actual.r12_discovery ?? null, saved.r12_discovery ?? null)) {
    diffs.push(`r12_discovery mismatch`);
  }

  const n = Math.min(actualConns.length, savedTop.length);
  for (let i = 0; i < n; i++) {
    const raw = actualConns[i];
    const proj = projectSavedRank(raw, i);
    const exp = savedTop[i];

    for (const key of ['rank', 'evidence_id', 'epistemic_class', 'evidence_tier', 'predicate', 'title']) {
      if (proj[key] !== exp[key]) {
        diffs.push(`rank ${i} (${exp.evidence_id}) ${key}: expected ${JSON.stringify(exp[key])}, got ${JSON.stringify(proj[key])}`);
      }
    }
    if ('score' in exp && raw.score !== exp.score) {
      diffs.push(`rank ${i} (${exp.evidence_id}) score: expected ${exp.score}, got ${raw.score}`);
    }
    if ('limitations' in exp && !jsonEqual(raw.limitations, exp.limitations)) {
      diffs.push(`rank ${i} (${exp.evidence_id}) limitations mismatch`);
    }

    const expRefs = (exp.passages || []).map(p => p.ref);
    const actRefs = (proj.passages || []).map(p => p.ref);
    if (!jsonEqual(actRefs, expRefs)) {
      diffs.push(`rank ${i} (${exp.evidence_id}) passages refs: expected ${JSON.stringify(expRefs)}, got ${JSON.stringify(actRefs)}`);
    } else if (!jsonEqual(proj.passages, exp.passages || [])) {
      diffs.push(`rank ${i} (${exp.evidence_id}) passages details/snippet mismatch`);
    }

    if (!jsonEqual(proj.original_words, exp.original_words || [])) {
      diffs.push(`rank ${i} (${exp.evidence_id}) original_words mismatch`);
    }

    if (exp.r12_metadata === null || proj.r12_metadata === null) {
      if (exp.r12_metadata !== proj.r12_metadata) {
        diffs.push(`rank ${i} (${exp.evidence_id}) r12_metadata nullness mismatch`);
      }
    } else {
      for (const mk of ['interest', 'Q', 'C', 'D', 'T', 'mmr_score', 'meaningful_hops', 'independent_group_count', 'score_version', 'epistemic_status', 'epistemic_layer']) {
        if (proj.r12_metadata[mk] !== exp.r12_metadata[mk]) {
          diffs.push(`rank ${i} (${exp.evidence_id}) r12_metadata.${mk}: expected ${exp.r12_metadata[mk]}, got ${proj.r12_metadata[mk]}`);
        }
      }
      if (!jsonEqual(proj.r12_metadata.independent_evidence_groups, exp.r12_metadata.independent_evidence_groups)) {
        diffs.push(`rank ${i} (${exp.evidence_id}) r12_metadata.independent_evidence_groups mismatch`);
      }
      if (!jsonEqual(proj.r12_metadata.steps, exp.r12_metadata.steps)) {
        diffs.push(`rank ${i} (${exp.evidence_id}) r12_metadata.steps mismatch`);
      }
      if (!jsonEqual(proj.r12_metadata.external_bridge, exp.r12_metadata.external_bridge)) {
        diffs.push(`rank ${i} (${exp.evidence_id}) r12_metadata.external_bridge mismatch`);
      }
    }
  }
  return diffs;
}

async function runSecurityCheck() {
  const checks = [];

  // (a) Clean registered JSON response bypasses double-JSON / preserves exact text & emits required headers
  try {
    const cleanText = '{"status": "ok",  "strongest_connections": [{"id": 1}]}';
    const sec = withCorpusSecurity({
      async fetch() {
        return registerFastJsonText(
          new Response(cleanText, {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          }),
          cleanText,
        );
      },
    });
    const res = await sec.fetch(new Request('https://corpus.internal/v1/rpc/discover_biblical_connections_v2', { method: 'POST' }), {});
    const bodyText = await res.text();
    assert.equal(res.status, 200);
    assert.equal(bodyText, cleanText, 'Clean registered JSON text must bypass re-serialization and remain verbatim');
    assert.equal(res.headers.get('X-BibleResearch-Corpus-Security'), 'semantic-frame-redaction-v2');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET,POST,OPTIONS');
    assert.equal(res.headers.get('Access-Control-Allow-Headers'), 'content-type,authorization,apikey');
    checks.push({ id: 'clean_registered_bypass', passed: true });
  } catch (err) {
    checks.push({ id: 'clean_registered_bypass', passed: false, error: err instanceof Error ? err.message : String(err) });
  }

  // (b) Registered JSON containing restricted keys and field_name items must be parsed and stripped
  try {
    const dirtyObj = {
      safe: 'kept',
      semantic_frame: 'SECRET',
      domain: 'X',
      items: [
        { field_name: 'lexdomain', v: 1 },
        { field_name: 'ok', v: 2 },
      ],
    };
    const dirtyText = JSON.stringify(dirtyObj);
    const sec = withCorpusSecurity({
      async fetch() {
        return registerFastJsonText(
          new Response(dirtyText, {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          }),
          dirtyText,
        );
      },
    });
    const res = await sec.fetch(new Request('https://corpus.internal/v1/rpc/discover_biblical_connections_v2', { method: 'POST' }), {});
    const parsed = await res.json();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-BibleResearch-Corpus-Security'), 'semantic-frame-redaction-v2');
    assert.equal(parsed.safe, 'kept');
    assert.equal('semantic_frame' in parsed, false, 'semantic_frame must be stripped');
    assert.equal('domain' in parsed, false, 'domain must be stripped');
    assert.deepEqual(parsed.items, [{ field_name: 'ok', v: 2 }]);
    checks.push({ id: 'registered_restricted_redaction', passed: true });
  } catch (err) {
    checks.push({ id: 'registered_restricted_redaction', passed: false, error: err instanceof Error ? err.message : String(err) });
  }

  // (c) Unregistered response with escaped JSON key (\u0066rame) must still parse and strip restricted keys
  try {
    const escapedText = '{"safe":1,"\\u0066rame":"HIDDEN","nested":{"greekstrong":"G0001"}}';
    const sec = withCorpusSecurity({
      async fetch() {
        return new Response(escapedText, {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      },
    });
    const res = await sec.fetch(new Request('https://corpus.internal/v1/rpc/discover_biblical_connections_v2', { method: 'POST' }), {});
    const parsed = await res.json();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-BibleResearch-Corpus-Security'), 'semantic-frame-redaction-v2');
    assert.equal(parsed.safe, 1);
    assert.equal('frame' in parsed, false, 'escaped \\u0066rame must be stripped');
    assert.deepEqual(parsed.nested, {});
    checks.push({ id: 'unregistered_escaped_redaction', passed: true });
  } catch (err) {
    checks.push({ id: 'unregistered_escaped_redaction', passed: false, error: err instanceof Error ? err.message : String(err) });
  }

  return {
    passed: checks.every(c => c.passed),
    checks,
  };
}

async function runPartA() {
  assert.ok(fs.existsSync(BUNDLE_ROOT), `Missing staging bundle: ${BUNDLE_ROOT}`);
  const cases = [];
  for (const file of BATCH_FILES) {
    const data = readJson(path.join(SNAPSHOT_DIR, file));
    for (const row of data.results || []) {
      if (row.status !== 'TOOL_ERROR') cases.push(row);
    }
  }
  assert.equal(cases.length, 44, `Expected 44 successful baseline cases, found ${cases.length}`);

  const assetsHttp200 = {
    async fetch(req) {
      const pathname = new URL(req.url).pathname.replace(/^\/+/, '');
      const fullPath = path.join(BUNDLE_ROOT, pathname);
      if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        return new Response('Not Found', { status: 404 });
      }
      const bytes = await fs.promises.readFile(fullPath);
      return new Response(bytes, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    },
  };

  const env = {
    ASSETS: assetsHttp200,
    R12_TRACE_ENABLED: '1',
    R12_RELEASE_ID: 'r12-discovery-1',
  };

  const results = [];
  let packedFullResponsesTotal = 0;
  let packedStreamBytesTotal = 0;

  for (const saved of cases) {
    const req = new Request('https://corpus.internal/v1/rpc/discover_biblical_connections_v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-R12-Trace-Id': `parity_${saved.case_id}`,
      },
      body: JSON.stringify(saved.query),
    });
    const res = await corpusWorker.fetch(req, env);
    const traceHeader = res.headers.get('X-R12-Trace');
    const trace = traceHeader ? JSON.parse(traceHeader) : null;
    const payload = await res.json();

    const packedFull = trace?.packed_full_responses ?? 0;
    const packedStream = trace?.packed_stream_bytes ?? 0;
    packedFullResponsesTotal += packedFull;
    packedStreamBytesTotal += packedStream;

    const diffs = [];
    if (res.status !== 200) diffs.push(`http_status: expected 200, got ${res.status}`);
    if (!trace) diffs.push('missing X-R12-Trace header');
    if (packedFull !== 0) diffs.push(`packed_full_responses=${packedFull}`);
    if (packedStream !== 0) diffs.push(`packed_stream_bytes=${packedStream}`);
    diffs.push(...compareCase(saved, payload));

    results.push({
      case_id: saved.case_id,
      query: saved.query.query,
      http_status: res.status,
      parity_ok: diffs.length === 0,
      diffs,
      asset_reads: trace?.asset_reads ?? null,
      decoded_bytes: trace?.decoded_bytes ?? null,
      cache_hits: trace?.cache_hits ?? null,
      packed_full_responses: packedFull,
      packed_stream_bytes: packedStream,
    });
  }

  const passed = results.filter(r => r.parity_ok).length;
  return {
    total: cases.length,
    passed,
    failed: cases.length - passed,
    packed_full_responses_total: packedFullResponsesTotal,
    packed_stream_bytes_total: packedStreamBytesTotal,
    failures: results.filter(r => !r.parity_ok),
    results,
  };
}

async function loopbackFetch(url, init) {
  assert.equal(new URL(url).hostname, '127.0.0.1', 'Loopback only');
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
  return port;
}

function localConfig(source, bundle, entry, port) {
  return `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [
  (name = "corpus", worker = (
   compatibilityDate = ${quote(source.compatibility_date)},
   compatibilityFlags = ${JSON.stringify(source.compatibility_flags || [])},
   modules = [(name = "worker.mjs", esModule = embed ${quote(path.basename(entry))})],
   bindings = [
    (name = "ASSETS", service = "assets"),
    (name = "R12_TRACE_ENABLED", text = "1"),
    (name = "R12_RELEASE_ID", text = "r12-discovery-1")
   ],
   globalOutbound = "internet")),
  (name = "assets", disk = (path = ${quote(bundle)}, writable = false)),
  (name = "internet", network = (allow = []))
 ],
 sockets = [(name = "http", address = "127.0.0.1:${port}", http = (), service = "corpus")]
);
`;
}

class Inspector {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const packet = JSON.parse(event.data);
      const pending = this.pending.get(packet.id);
      if (!pending) return;
      this.pending.delete(packet.id);
      clearTimeout(pending.timer);
      packet.error ? pending.reject(new Error(JSON.stringify(packet.error))) : pending.resolve(packet.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Inspector disconnected'));
      }
      this.pending.clear();
    });
  }
  static async open(url) {
    const address = new URL(url);
    assert.equal(address.hostname, '127.0.0.1');
    assert.equal(address.protocol, 'ws:');
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('Inspector connection timeout')); }, 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Inspector connection failed')); }, { once: true });
    });
    return new Inspector(socket);
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Inspector timeout: ${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.socket.close();
  }
}

function summarizeProfile(profile) {
  const samples = profile?.samples || [];
  const deltas = profile?.timeDeltas || [];
  const nodes = new Map((profile?.nodes || []).map(node => [node.id, node]));
  const parents = new Map();
  for (const node of profile?.nodes || []) {
    for (const child of node.children || []) parents.set(child, node.id);
  }

  let idleUs = 0;
  let activeUs = 0;
  let gcUs = 0;
  let unclassifiedUs = 0;
  let idleSamples = 0;
  let nonIdleSamples = 0;
  const phases = {
    json_parse: 0,
    text_decode: 0,
    gzip_decode: 0,
    b64_decode: 0,
    cache_and_load: 0,
    reader: 0,
    discovery: 0,
    other: 0,
  };
  const selfFuncUs = new Map();

  for (let i = 0; i < samples.length; i++) {
    const delta = deltas[i] ?? 0;
    const leaf = nodes.get(samples[i]);
    const fn = leaf?.callFrame?.functionName || '(anonymous)';
    if (fn === '(idle)') {
      idleUs += delta;
      idleSamples++;
      continue;
    }
    nonIdleSamples++;
    activeUs += delta;
    if (fn === '(garbage collector)') gcUs += delta;
    if (fn === '(program)') unclassifiedUs += delta;
    selfFuncUs.set(fn, (selfFuncUs.get(fn) || 0) + delta);

    const names = [];
    let id = samples[i];
    while (id !== undefined) {
      names.push(nodes.get(id)?.callFrame?.functionName || '');
      id = parents.get(id);
    }
    const phase = names.includes('parseJsonShard')
      ? 'json_parse'
      : names.includes('decodeJsonShard')
      ? 'text_decode'
      : names.includes('decompressGzipIfNeeded') || names.includes('gunzipSync')
      ? 'gzip_decode'
      : names.includes('decodeB64GzJson') || names.includes('decodeB64Gz')
      ? 'b64_decode'
      : names.includes('loadJsonShardWithBytes')
      ? 'cache_and_load'
      : names.includes('createWorkerR10Reader')
      ? 'reader'
      : names.includes('discoverBiblicalConnections') || names.includes('getConnectionEvidence')
      ? 'discovery'
      : 'other';
    phases[phase] += delta / 1000;
  }

  const topSelfFunctions = [...selfFuncUs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([fn, us]) => ({ fn, ms: Number((us / 1000).toFixed(3)) }));

  return {
    total_samples: samples.length,
    non_idle_samples: nonIdleSamples,
    idle_samples: idleSamples,
    zero_non_idle_samples: nonIdleSamples === 0,
    sampled_active_ms: Number((activeUs / 1000).toFixed(3)),
    idle_ms: Number((idleUs / 1000).toFixed(3)),
    gc_ms: Number((gcUs / 1000).toFixed(3)),
    unclassified_program_ms: Number((unclassifiedUs / 1000).toFixed(3)),
    phase_sampled_ms: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, Number(v.toFixed(3))])),
    top_self_functions: topSelfFunctions,
  };
}

async function startRuntime(source, bundle, entry, dir, label) {
  const port = await freePort();
  const inspectorPort = await freePort();
  const configFile = path.join(dir, `${label}.capnp`);
  const logFile = path.join(dir, `${label}.log`);
  fs.writeFileSync(configFile, localConfig(source, bundle, entry, port));
  const log = fs.openSync(logFile, 'w');
  const child = spawn(workerd.default, ['serve', configFile, `--inspector-addr=127.0.0.1:${inspectorPort}`], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP|PATH)$/i.test(key))),
  });
  const exited = new Promise(resolve => {
    child.once('error', error => resolve({ error }));
    child.once('exit', code => resolve({ code }));
  });
  let inspector;
  const stop = async () => {
    inspector?.close();
    child.kill();
    await Promise.race([exited, delay(3000)]);
    fs.closeSync(log);
  };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const exit = await Promise.race([exited, Promise.resolve(null)]);
      if (exit) throw new Error(`workerd exited early: ${exit.error?.message || fs.readFileSync(logFile, 'utf8')}`);
      try {
        const targets = await (await loopbackFetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json();
        const target = targets.find(t => t.id === 'corpus');
        if (target) {
          const health = await loopbackFetch(`http://127.0.0.1:${port}/health`);
          assert.equal(health.status, 200, 'Local Worker failed /health');
          await health.arrayBuffer();
          inspector = await Inspector.open(target.webSocketDebuggerUrl);
          break;
        }
      } catch {
        // Inspector or HTTP listener still warming up
      }
      await delay(100);
    }
    if (!inspector) throw new Error(`Local inspector unavailable: ${logFile}`);
    await inspector.send('Profiler.enable');
    await inspector.send('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL_US });
    return { inspector, stop, port, configFile, logFile };
  } catch (error) {
    await stop();
    throw new Error(`${error.message}\nLog (${logFile}):\n${fs.readFileSync(logFile, 'utf8')}`);
  }
}

async function sendRpc(runtime, item, requestId) {
  const t0 = performance.now();
  const response = await loopbackFetch(`http://127.0.0.1:${runtime.port}/v1/rpc/${item.operation}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-R12-Trace-Id': requestId,
    },
    body: JSON.stringify(item.params),
  });
  const text = await response.text();
  const wallMs = Number((performance.now() - t0).toFixed(3));
  const traceHeader = response.headers.get('X-R12-Trace');
  const trace = traceHeader ? JSON.parse(traceHeader) : null;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { error: 'non_json_response' };
  }
  const resultCount = item.operation === 'get_connection_evidence_v1'
    ? (payload.passage_details?.length ?? 0)
    : (payload.strongest_connections?.length ?? 0);
  return {
    id: item.id,
    operation: item.operation,
    request_id: requestId,
    http_status: response.status,
    response_status: payload.status || payload.error || null,
    exceeded_cpu: /exceeded.?cpu/i.test(text),
    result_count: resultCount,
    total_available: payload.pagination?.total_available ?? null,
    wall_ms: wallMs,
    trace,
  };
}

async function measureProfiledRequest(runtime, item, requestId, profileDir) {
  await runtime.inspector.send('Profiler.start');
  let reqResult;
  let profile;
  try {
    reqResult = await sendRpc(runtime, item, requestId);
  } finally {
    const stopped = await runtime.inspector.send('Profiler.stop');
    profile = stopped.profile;
    writeJson(path.join(profileDir, `${requestId}.cpuprofile`), profile);
  }
  const cpu = summarizeProfile(profile);
  const trace = reqResult.trace || {};
  const assetPaths = (trace.assets || []).map(a => a.path);
  return {
    ...reqResult,
    isolate_id: trace.isolate_id ?? null,
    asset_reads: trace.asset_reads ?? null,
    encoded_bytes: trace.encoded_bytes ?? null,
    decoded_bytes: trace.decoded_bytes ?? null,
    cache_hits: trace.cache_hits ?? null,
    cache_stores: trace.cache_stores ?? null,
    cache_skips: trace.cache_skips ?? null,
    cache_evictions: trace.cache_evictions ?? null,
    packed_full_responses: trace.packed_full_responses ?? 0,
    packed_stream_bytes: trace.packed_stream_bytes ?? 0,
    phases: trace.phases ?? null,
    asset_paths: assetPaths,
    motifs_skipped: !assetPaths.some(p => String(p || '').includes('motifs-and-patterns')),
    cpu,
  };
}

async function runPartB(reportDir) {
  const source = readJson('wrangler.corpus.jsonc');
  const entry = path.join(reportDir, 'worker.mjs');
  await build({
    entryPoints: [path.resolve(source.main)],
    outfile: entry,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['node:*'],
    metafile: true,
    sourcemap: 'external',
  });

  // 1. Cold measurements: fresh workerd isolate per query
  const cold = [];
  const seenColdIsolates = new Set();
  for (let i = 0; i < PART_B_QUERIES.length; i++) {
    const item = PART_B_QUERIES[i];
    const safeId = item.id.replace(/[^a-zA-Z0-9_-]+/g, '_');
    const rt = await startRuntime(source, BUNDLE_ROOT, entry, reportDir, `cold_${i}_${safeId}`);
    try {
      const m = await measureProfiledRequest(rt, item, `cold_${i}_${safeId}`, reportDir);
      if (m.isolate_id) {
        assert.ok(!seenColdIsolates.has(m.isolate_id), `Cold isolate reused: ${m.isolate_id}`);
        seenColdIsolates.add(m.isolate_id);
      }
      assert.equal(m.cache_hits, 0, `Expected cache_hits=0 on cold request ${item.id}`);
      cold.push(m);
    } finally {
      await rt.stop();
    }
  }

  // 2. Warm-isolate unseen-query measurements: dedicated isolate warmed ONLY with H0120,
  // then profiled on unseen discovery queries G3088, H5869, H1285, Genesis 1:1, Exodus 12:15
  const warmUnseen = [];
  let warmUnseenWarmup = null;
  const unseenRt = await startRuntime(source, BUNDLE_ROOT, entry, reportDir, 'warm_unseen_isolate');
  try {
    const h0120 = PART_B_QUERIES[0];
    const w = await sendRpc(unseenRt, h0120, 'warm_unseen_warmup_H0120');
    assert.equal(w.http_status, 200, 'Warm-unseen warmup H0120 failed');
    warmUnseenWarmup = {
      id: h0120.id,
      http_status: w.http_status,
      wall_ms: w.wall_ms,
      asset_reads: w.trace?.asset_reads ?? null,
      decoded_bytes: w.trace?.decoded_bytes ?? null,
      isolate_id: w.trace?.isolate_id ?? null,
    };
    for (let i = 1; i <= 5; i++) {
      const item = PART_B_QUERIES[i];
      const safeId = item.id.replace(/[^a-zA-Z0-9_-]+/g, '_');
      const m = await measureProfiledRequest(unseenRt, item, `warm_unseen_${i}_${safeId}`, reportDir);
      warmUnseen.push(m);
    }
  } finally {
    await unseenRt.stop();
  }

  // 3. Warm measurements: shared workerd isolate, warmed up with all 8 queries, then profiled + unprofiled comparison
  const warm = [];
  const warmRepeatsH0120 = [];
  const warmUnprofiled = [];
  const warmupTraces = [];
  const warmRt = await startRuntime(source, BUNDLE_ROOT, entry, reportDir, 'warm_isolate');
  try {
    for (let i = 0; i < PART_B_QUERIES.length; i++) {
      const item = PART_B_QUERIES[i];
      const safeId = item.id.replace(/[^a-zA-Z0-9_-]+/g, '_');
      const w = await sendRpc(warmRt, item, `warmup_${i}_${safeId}`);
      assert.equal(w.http_status, 200, `Warmup failed for ${item.id}`);
      warmupTraces.push({ id: item.id, http_status: w.http_status, wall_ms: w.wall_ms, trace: w.trace });
    }
    for (let i = 0; i < PART_B_QUERIES.length; i++) {
      const item = PART_B_QUERIES[i];
      const safeId = item.id.replace(/[^a-zA-Z0-9_-]+/g, '_');
      const m = await measureProfiledRequest(warmRt, item, `warm_${i}_${safeId}`, reportDir);
      warm.push(m);
    }
    for (let r = 1; r <= 3; r++) {
      const m = await measureProfiledRequest(warmRt, PART_B_QUERIES[0], `warm_repeat_H0120_${r}`, reportDir);
      warmRepeatsH0120.push(m);
    }
    for (let i = 0; i < PART_B_QUERIES.length; i++) {
      const item = PART_B_QUERIES[i];
      const safeId = item.id.replace(/[^a-zA-Z0-9_-]+/g, '_');
      const u = await sendRpc(warmRt, item, `warm_unprofiled_${i}_${safeId}`);
      assert.equal(u.http_status, 200, `Warm unprofiled failed for ${item.id}`);
      warmUnprofiled.push({
        id: u.id,
        request_id: u.request_id,
        http_status: u.http_status,
        wall_ms: u.wall_ms,
        result_count: u.result_count,
        asset_reads: u.trace?.asset_reads ?? null,
        cache_hits: u.trace?.cache_hits ?? null,
        decoded_bytes: u.trace?.decoded_bytes ?? null,
        packed_full_responses: u.trace?.packed_full_responses ?? 0,
      });
    }
  } finally {
    await warmRt.stop();
  }

  const coldOverBudget = cold.filter(m => m.cpu.sampled_active_ms > COLD_CPU_BUDGET_MS);
  const warmOverBudget = [...warmUnseen, ...warm, ...warmRepeatsH0120].filter(m => m.cpu.sampled_active_ms > WARM_CPU_BUDGET_MS);

  return {
    workerd_version: workerd.version,
    sampling_interval_us: SAMPLING_INTERVAL_US,
    cold_budget_ms: COLD_CPU_BUDGET_MS,
    warm_budget_ms: WARM_CPU_BUDGET_MS,
    cold,
    warm_unseen_warmup: warmUnseenWarmup,
    warm_unseen: warmUnseen,
    warmup: warmupTraces,
    warm,
    warm_repeats_H0120: warmRepeatsH0120,
    warm_unprofiled: warmUnprofiled,
    cold_over_budget: coldOverBudget.map(m => ({ id: m.id, sampled_active_ms: m.cpu.sampled_active_ms, wall_ms: m.wall_ms })),
    warm_over_budget: warmOverBudget.map(m => ({ request_id: m.request_id, id: m.id, sampled_active_ms: m.cpu.sampled_active_ms, wall_ms: m.wall_ms })),
  };
}

function formatTableRow(cols, widths) {
  return cols.map((c, i) => String(c).padEnd(widths[i])).join(' | ');
}

function printPartBTable(title, rows) {
  console.log(`\n=== ${title} ===`);
  const headers = ['Query', 'HTTP', 'CPU ms', 'Samples (nonIdle/tot)', 'Wall ms', 'Reads', 'Hits', 'Decoded B', 'Evict', 'Packed', 'Results'];
  const tableRows = rows.map(r => [
    r.id,
    r.http_status,
    r.cpu.zero_non_idle_samples ? `0 (<=${(SAMPLING_INTERVAL_US / 1000).toFixed(2)})` : r.cpu.sampled_active_ms.toFixed(3),
    `${r.cpu.non_idle_samples}/${r.cpu.total_samples}`,
    r.wall_ms.toFixed(2),
    r.asset_reads,
    r.cache_hits,
    r.decoded_bytes,
    r.cache_evictions,
    r.packed_full_responses,
    r.result_count,
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...tableRows.map(r => String(r[i]).length)));
  console.log(formatTableRow(headers, widths));
  console.log(widths.map(w => '-'.repeat(w)).join('-+-'));
  for (const r of tableRows) console.log(formatTableRow(r, widths));
}

async function main() {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const reportDir = path.resolve('.artifacts-r12/reports', `cpu-parity-${stamp}`);
  fs.mkdirSync(reportDir, { recursive: true });

  const report = {
    started_at: new Date().toISOString(),
    report_dir: reportDir,
    security_check: null,
    part_a: null,
    part_b: null,
    flags: [],
  };

  try {
    console.log('[Security] Running corpus-security redaction & fast-bypass regression check...');
    report.security_check = await runSecurityCheck();
    console.log(`[Security] ${report.security_check.passed ? 'PASS' : 'FAIL'}: ${report.security_check.checks.map(c => `${c.id}=${c.passed ? 'PASS' : `FAIL(${c.error})`}`).join(', ')}`);
    if (!report.security_check.passed) {
      report.flags.push(`SECURITY_CHECK_FAILED: ${report.security_check.checks.filter(c => !c.passed).map(c => c.id).join(', ')}`);
      process.exitCode = 1;
    }

    console.log('\n[Part A] Running 44-case local parity verification against .artifacts-r12/staging-bundle (HTTP 200, no Range)...');
    report.part_a = await runPartA();
    console.log(`[Part A] Parity: ${report.part_a.passed}/${report.part_a.total} passed, ${report.part_a.failed} failed`);
    console.log(`[Part A] packed_full_responses=${report.part_a.packed_full_responses_total}, packed_stream_bytes=${report.part_a.packed_stream_bytes_total}`);
    if (report.part_a.failed > 0) {
      report.flags.push(`PARITY_MISMATCH: ${report.part_a.failed}/${report.part_a.total} cases failed`);
      process.exitCode = 1;
      for (const f of report.part_a.failures) {
        console.log(`  FAIL ${f.case_id} (${f.query}): ${f.diffs.slice(0, 5).join(' ; ')}`);
      }
    }
    if (report.part_a.packed_full_responses_total > 0 || report.part_a.packed_stream_bytes_total > 0) {
      report.flags.push(`PACKED_RANGE_FALLBACK_DETECTED: responses=${report.part_a.packed_full_responses_total}, bytes=${report.part_a.packed_stream_bytes_total}`);
      process.exitCode = 1;
    }

    console.log(`\n[Part B] Profiling cold & warm requests in local workerd ${workerd.version} (interval=${SAMPLING_INTERVAL_US}us)...`);
    report.part_b = await runPartB(reportDir);

    printPartBTable('Part B: COLD workerd isolates (fresh isolate per query)', report.part_b.cold);
    console.log('\nCold asset paths & motifs-and-patterns.json.gz skip check:');
    for (const c of report.part_b.cold) {
      console.log(`  ${c.id}: reads=${c.asset_reads}, motifs_skipped=${c.motifs_skipped}, assets=${JSON.stringify(c.asset_paths)}`);
    }

    printPartBTable('Part B: WARM isolate / UNSEEN queries (warmed only with H0120)', report.part_b.warm_unseen);
    printPartBTable('Part B: WARM workerd isolate (after warming all 8 queries)', report.part_b.warm);
    printPartBTable('Part B: WARM repeated H0120 calls', report.part_b.warm_repeats_H0120);

    console.log('\n=== Part B: WARM unprofiled wall-ms (no Profiler.start/stop) ===');
    for (const u of report.part_b.warm_unprofiled) {
      console.log(`  ${u.id}: http=${u.http_status}, wall=${u.wall_ms.toFixed(2)}ms, reads=${u.asset_reads}, hits=${u.cache_hits}, decoded=${u.decoded_bytes}B, results=${u.result_count}`);
    }

    console.log('\n=== Cold H0120 vs Warm H0120 ===');
    const coldH0120 = report.part_b.cold[0];
    console.log(`Cold H0120: cpu=${coldH0120.cpu.sampled_active_ms}ms (${coldH0120.cpu.non_idle_samples}/${coldH0120.cpu.total_samples} samples), wall=${coldH0120.wall_ms}ms, reads=${coldH0120.asset_reads}, decoded=${coldH0120.decoded_bytes}B, phases=${JSON.stringify(coldH0120.cpu.phase_sampled_ms)}, top=${JSON.stringify(coldH0120.cpu.top_self_functions)}`);
    for (const w of [report.part_b.warm[0], ...report.part_b.warm_repeats_H0120]) {
      console.log(`${w.request_id}: cpu=${w.cpu.sampled_active_ms}ms (${w.cpu.non_idle_samples}/${w.cpu.total_samples} samples), wall=${w.wall_ms}ms, reads=${w.asset_reads}, hits=${w.cache_hits}, decoded=${w.decoded_bytes}B, top=${JSON.stringify(w.cpu.top_self_functions)}`);
    }

    if (report.part_b.cold_over_budget.length > 0) {
      report.flags.push(`COLD_CPU_EXCEEDS_${COLD_CPU_BUDGET_MS}MS: ${report.part_b.cold_over_budget.map(x => `${x.id}=${x.sampled_active_ms}ms`).join(', ')}`);
    }
    if (report.part_b.warm_over_budget.length > 0) {
      report.flags.push(`WARM_CPU_EXCEEDS_${WARM_CPU_BUDGET_MS}MS: ${report.part_b.warm_over_budget.map(x => `${x.request_id}=${x.sampled_active_ms}ms`).join(', ')}`);
    }
    const non200 = [...report.part_b.cold, ...report.part_b.warm_unseen, ...report.part_b.warm, ...report.part_b.warm_repeats_H0120].filter(x => x.http_status !== 200 || x.exceeded_cpu || x.packed_full_responses > 0);
    if (non200.length > 0) {
      report.flags.push(`WORKERD_HTTP_OR_PACKED_ERROR: ${non200.map(x => `${x.request_id}:status=${x.http_status}`).join(', ')}`);
      process.exitCode = 1;
    }

    console.log('\n=== Flags ===');
    if (report.flags.length === 0) {
      console.log('NONE (all parity and CPU budgets passed)');
    } else {
      for (const flag of report.flags) console.log(`FLAG: ${flag}`);
    }
  } finally {
    report.ended_at = new Date().toISOString();
    writeJson(path.join(reportDir, 'report.json'), report);
    console.log(`\nReport written: ${path.join(reportDir, 'report.json')}`);
  }
}

await main();
