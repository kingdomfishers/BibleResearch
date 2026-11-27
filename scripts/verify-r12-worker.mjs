#!/usr/bin/env node
/** D1.2 local workerd request profiler. No account, remote bindings or deployments.
 * Full baseline uses the configured compatibility date; self-test fixtures use an
 * explicit older date and cannot satisfy baseline/CPU acceptance.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { hashFile, readJson, validateInventory } from './r12-evidence.mjs';

const require = createRequire(import.meta.url);
// Isolated tooling can advance without changing the shared project's dependencies.
// npm's lockfile pins its package integrity; every run also hashes the executable.
const toolingPackage = path.resolve('.artifacts-r12/tooling/package.json');
const runtimeRequire = fs.existsSync(toolingPackage) ? createRequire(toolingPackage) : require;
const workerd = runtimeRequire('workerd');
const RELEASE = 'r11-v1.0';
export const WORKLOAD = Object.freeze([
  ['lily', 'Lily'], ['seed_word', 'The seed is the word of God'],
  ['acts_19_16', 'Acts 19:16'], ['mark_12_23', 'Mark 12:23'],
  ['eye_spring', 'H5869'], ['hagar_spring', 'Genesis 16:7'],
  ['hagar_naming', 'Genesis 16:13-14'], ['hagar_water', 'Genesis 21:19'],
  ['spirit_wind_breath', 'H7307'], ['menorah', 'Exodus 25:31-37'],
  ['zechariah_eyes', 'Zechariah 4:10'], ['seven_lamps', 'Revelation 4:5'],
  ['seven_eyes', 'Revelation 5:6'], ['lampstands_churches', 'Revelation 1:20'],
  ['bronze_serpent', 'Numbers 21:8-9'], ['explicit_comparison', 'John 3:14'],
  ['adam', 'Genesis 2:7'], ['adam_christ_romans', 'Romans 5:14'],
  ['adam_christ_corinthians', '1 Corinthians 15:45'], ['common_word_control', 'God world'],
  ['high_degree', 'G2532'], ['no_result', 'zzr12noattestation'],
].map(([id, query]) => ({ id, operation: 'discover_biblical_connections_v1', params: { query, release_id: RELEASE } })).concat([
  { id: 'evidence_expansion', operation: 'get_connection_evidence_v1', params: { evidence_id: 'r11:cluster:H7799:temple_and_sanctuary_architecture', release_id: RELEASE } },
  { id: 'cluster_expansion', operation: 'expand_biblical_connection_v1', params: { node_id: 'cluster:H7799:temple_and_sanctuary_architecture', release_id: RELEASE } },
]));

function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function quote(value) { return JSON.stringify(value.replaceAll('\\', '/')); }
async function loopbackFetch(url, init) {
  assert.equal(new URL(url).hostname, '127.0.0.1', 'Profiler forbids non-loopback requests');
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
}
async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

/** Only the source entry/date/flags and asset binding name are inherited. Never
 * copy env vars, routes, secrets, remote resources, or the production pointer. */
export function localConfig(source, bundle, entry, port, traced = true) {
  assert.equal(source.assets.binding, 'ASSETS');
  assert.equal(source.assets.run_worker_first, true);
  return `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [
  (name = "corpus", worker = (
   compatibilityDate = ${quote(source.compatibility_date)},
   compatibilityFlags = ${JSON.stringify(source.compatibility_flags || [])},
   modules = [(name = "worker.mjs", esModule = embed ${quote(path.basename(entry))})],
   bindings = [(name = "ASSETS", service = "assets"), (name = "R12_TRACE_ENABLED", text = "${traced ? '1' : '0'}")],
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
    this.socket = socket; this.sequence = 0; this.pending = new Map();
    socket.addEventListener('message', event => {
      const packet = JSON.parse(event.data);
      const pending = this.pending.get(packet.id);
      if (!pending) return;
      this.pending.delete(packet.id); clearTimeout(pending.timer);
      packet.error ? pending.reject(new Error(JSON.stringify(packet.error))) : pending.resolve(packet.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Inspector disconnected')); }
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
  close() { this.socket.close(); }
}

export function summarizeProfile(profile) {
  assert.ok(profile.nodes?.length && profile.samples?.length && profile.timeDeltas?.length, 'Unavailable CPU samples');
  assert.equal(profile.samples.length, profile.timeDeltas.length);
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
  let idle = 0, active = 0, gc = 0, unclassified = 0;
  const phases = { json_parse: 0, text_decode: 0, gzip_decode: 0, cache_and_load: 0, reader: 0, other: 0 };
  const intervals = [];
  for (let i = 0; i < profile.samples.length; i++) {
    const delta = profile.timeDeltas[i];
    assert.ok(Number.isFinite(delta) && delta >= 0, 'Invalid CPU sample delta');
    intervals.push(delta);
    const leaf = nodes.get(profile.samples[i]);
    if (leaf?.callFrame.functionName === '(idle)') { idle += delta; continue; }
    active += delta;
    if (leaf?.callFrame.functionName === '(garbage collector)') gc += delta;
    if (leaf?.callFrame.functionName === '(program)') unclassified += delta;
    const names = [];
    let id = profile.samples[i];
    while (id !== undefined) { names.push(nodes.get(id)?.callFrame.functionName || ''); id = parents.get(id); }
    const phase = names.includes('parseJsonShard') ? 'json_parse' : names.includes('decodeJsonShard') ? 'text_decode'
      : names.includes('decompressGzipIfNeeded') ? 'gzip_decode' : names.includes('loadJsonShardWithBytes') ? 'cache_and_load'
      : names.includes('createWorkerR10Reader') ? 'reader' : 'other';
    phases[phase] += delta / 1000;
  }
  intervals.sort((a, b) => a - b);
  return { sampled_active_ms: active / 1000, idle_ms: idle / 1000, gc_ms: gc / 1000,
    unclassified_program_ms: unclassified / 1000, samples: profile.samples.length,
    observed_interval_p95_us: intervals[Math.ceil(intervals.length * .95) - 1], phase_sampled_ms: phases,
    limitations: ['V8 sampling estimates; native decompression and program samples may not be attributable.',
      'Idle samples excluded. This is not Node wall time, startup CPU, or production telemetry.'] };
}

async function startRuntime(source, bundle, entry, dir, label, traced = true) {
  const port = await freePort(), inspectorPort = await freePort();
  const configFile = path.join(dir, `${label}.capnp`), logFile = path.join(dir, `${label}.log`);
  fs.writeFileSync(configFile, localConfig(source, bundle, entry, port, traced));
  const log = fs.openSync(logFile, 'w');
  const child = spawn(workerd.default, ['serve', configFile, `--inspector-addr=127.0.0.1:${inspectorPort}`], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', log, log],
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP|PATH)$/i.test(key))),
  });
  const exited = new Promise(resolve => { child.once('error', error => resolve({ error })); child.once('exit', code => resolve({ code })); });
  let inspector;
  const stop = async () => {
    inspector?.close(); child.kill();
    await Promise.race([exited, delay(3000)]);
    fs.closeSync(log);
  };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const exit = await Promise.race([exited, Promise.resolve(null)]);
      if (exit) throw new Error(`workerd unavailable: ${exit.error?.message || fs.readFileSync(logFile, 'utf8')}`);
      try {
        const targets = await (await loopbackFetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json();
        const target = targets.find(t => t.id === 'corpus');
        if (target) {
          const health = await loopbackFetch(`http://127.0.0.1:${port}/health`);
          assert.equal(health.status, 200, 'Local Worker failed its health request');
          await health.arrayBuffer();
          inspector = await Inspector.open(target.webSocketDebuggerUrl); break;
        }
      } catch { /* Local socket can precede inspector readiness. */ }
      await delay(100);
    }
    if (!inspector) throw new Error(`Local inspector unavailable: ${logFile}`);
    await inspector.send('Profiler.enable');
    await inspector.send('Profiler.setSamplingInterval', { interval: 100 });
    return { inspector, stop, port, configFile, logFile };
  } catch (error) {
    await stop();
    throw new Error(`${error.message}\nLocal runtime log (${logFile}):\n${fs.readFileSync(logFile, 'utf8')}`);
  }
}

async function request(runtime, item, requestId) {
  const response = await loopbackFetch(`http://127.0.0.1:${runtime.port}/v1/rpc/${item.operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-R12-Trace-Id': requestId }, body: JSON.stringify(item.params),
  });
  const text = await response.text();
  const traceHeader = response.headers.get('X-R12-Trace');
  const trace = traceHeader ? JSON.parse(traceHeader) : null;
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { error: 'non_json_response' }; }
  return { request_id: requestId, workload: item.id, release: item.params.release_id, http_status: response.status,
    response_status: payload.status || payload.error || null, exceeded_cpu: /exceeded.?cpu/i.test(text), trace };
}

async function profileBatch(runtime, items, id, dir) {
  await runtime.inspector.send('Profiler.start');
  let results;
  try { results = await Promise.all(items.map((item, i) => request(runtime, item, `${id}_${i}`))); }
  finally {
    const { profile } = await runtime.inspector.send('Profiler.stop');
    writeJson(path.join(dir, `${id}.cpuprofile`), profile);
  }
  const profile = readJson(path.join(dir, `${id}.cpuprofile`));
  let cpu;
  try { cpu = { status: 'sampled', ...summarizeProfile(profile) }; }
  catch (error) {
    // Preserve real HTTP/counter observations even when V8 sample timing is invalid.
    // No clamping, invented zero CPU, retries of selected cases, or discarded profiles.
    cpu = { status: 'blocked', reason: error.message, samples: profile.samples?.length || 0 };
  }
  for (const result of results) {
    result.profile = path.join(dir, `${id}.cpuprofile`);
    result.sampled_cpu_ms = results.length === 1 && cpu.status === 'sampled' ? cpu.sampled_active_ms : null;
    result.cpu_attribution = results.length === 1 ? 'isolated request sample window' : 'shared concurrent window; no fabricated per-request division';
  }
  return { id, results, cpu };
}

async function bundleWorker(dir, source) {
  const entry = path.join(dir, 'worker.mjs');
  const result = await build({ entryPoints: [path.resolve(source.main)], outfile: entry,
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:*'], metafile: true, sourcemap: 'external' });
  writeJson(path.join(dir, 'build-inputs.json'), await Promise.all(Object.keys(result.metafile.inputs).map(async file => ({ file: path.resolve(file), sha256: await hashFile(file) }))));
  return entry;
}

function percentile(values) { const sorted = values.slice().sort((a, b) => a - b); return sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null; }
export function cohortSummary(batches) {
  const rows = batches.flatMap(batch => batch.results);
  return { requests: rows.length, http_503: rows.filter(r => r.http_status === 503).length,
    exceeded_cpu: rows.filter(r => r.exceeded_cpu).length,
    http_errors: rows.filter(r => r.http_status >= 400).length,
    counters_observed: rows.filter(r => r.trace).length,
    counters_unavailable: rows.filter(r => !r.trace).length,
    sampled_request_cpu_count: rows.filter(r => Number.isFinite(r.sampled_cpu_ms)).length,
    unattributed_request_cpu_count: rows.filter(r => !Number.isFinite(r.sampled_cpu_ms)).length,
    cpu_profiles_blocked: batches.filter(batch => batch.cpu.status === 'blocked').map(batch => ({ batch: batch.id, ...batch.cpu })),
    sampled_request_cpu_p95_ms: percentile(rows.map(r => r.sampled_cpu_ms).filter(Number.isFinite)),
    decoded_bytes_p95: percentile(rows.map(r => r.trace?.decoded_bytes).filter(Number.isFinite)),
    reads_p95: percentile(rows.map(r => r.trace?.asset_reads).filter(Number.isFinite)),
    oversized_assets: rows.flatMap(r => (r.trace?.assets || []).filter(a => a.decoded_bytes > 128 * 1024).map(a => ({ request_id: r.request_id, ...a }))),
  };
}

async function calibrateProfiles(runtime, dir) {
  const captures = [];
  for (let i = 0; i < 5; i++) {
    for (const control of ['idle', 'health_untraced', 'health_traced']) {
      const id = `calibration_${i}_${control}`;
      await runtime.inspector.send('Profiler.start');
      try {
        if (control === 'idle') await delay(100);
        else {
          const headers = control === 'health_traced' ? { 'X-R12-Trace-Id': id } : {};
          const res = await loopbackFetch(`http://127.0.0.1:${runtime.port}/health`, { headers });
          assert.equal(res.status, 200); await res.arrayBuffer();
        }
      } finally {
        const { profile } = await runtime.inspector.send('Profiler.stop');
        writeJson(path.join(dir, `${id}.cpuprofile`), profile);
        try { captures.push({ id, control, status: 'sampled', ...summarizeProfile(profile) }); }
        catch (error) { captures.push({ id, control, status: 'blocked', reason: error.message }); }
      }
    }
  }
  return { captures, requested_sampling_interval_us: 100,
    interpretation: 'Raw idle/health controls expose profiler and tracing noise and observed resolution. They do not identify exact profiling overhead or native CPU. No correction/subtraction is applied to workload samples.',
    exact_overhead_status: 'blocked', native_cpu_attribution: 'blocked', concurrent_request_cpu_attribution: 'blocked' };
}

async function baseline(dir, report) {
  const inputs = readJson('.artifacts-r12/inputs.json');
  assert.equal(inputs.status, 'pass', 'D1.1 prerequisite must pass');
  assert.equal(readJson(inputs.baseline_report).status, 'pass');
  const candidateReport = report.mode === 'acceptance' ? readJson(readJson('.artifacts-r12/d1-candidate.json').report) : null;
  if (candidateReport) {
    assert.equal(candidateReport.status, 'pass', 'Candidate reliability must pass');
    report.candidate_report = readJson('.artifacts-r12/d1-candidate.json').report;
    report.candidate_report_sha256 = await hashFile(report.candidate_report);
  }
  const bundle = candidateReport?.candidate.root || inputs.roots.bundle;
  const pinnedBundle = candidateReport?.candidate || inputs.sources.find(s => s.kind === 'combined_local_bundle');
  assert.ok(pinnedBundle, 'Missing pinned bundle');
  const source = readJson('wrangler.corpus.jsonc');
  report.source_config_sha256 = await hashFile('wrangler.corpus.jsonc');
  report.inputs_sha256 = await hashFile('.artifacts-r12/inputs.json');
  report.workload = WORKLOAD;
  report.workload_results = WORKLOAD.map(item => ({ id: item.id, status: 'not-run', reason: 'Awaiting valid runtime and pinned bundle verification.' }));
  report.required_cohorts = { cold_requests_per_concurrency: 100, warm_requests_per_concurrency: 1000, concurrency: [1, 8] };
  report.cpu_gate = { status: 'blocked', reason: 'No validated per-request active CPU attribution/overhead calibration yet; never substitute elapsed time.' };
  const entry = await bundleWorker(dir, source);
  // Starting before the large hash pass fails fast for unavailable runtimes.
  const probe = await startRuntime(source, bundle, entry, dir, 'prerequisite');
  try { report.calibration = await calibrateProfiles(probe, dir); }
  finally { await probe.stop(); }
  await validateInventory({ sources: [pinnedBundle] });
  report.bundle_sha256 = pinnedBundle.sha256;
  report.cohorts = {};
  for (const concurrency of [1, 8]) {
    for (const temperature of ['cold', 'warm']) {
      const count = temperature === 'cold' ? 100 : 1000;
      const batches = []; let runtime;
      const seenIsolates = new Set();
      try {
        for (let index = 0; index < count; index += concurrency) {
          const id = `${temperature}_c${concurrency}_${index}`;
          if (!runtime) {
            runtime = await startRuntime(source, bundle, entry, dir, id);
            if (temperature === 'warm') for (const item of WORKLOAD) await request(runtime, item, `warmup_${item.id}`);
          }
          const items = Array.from({ length: Math.min(concurrency, count - index) }, (_, i) => WORKLOAD[(index + i) % WORKLOAD.length]);
          const batch = await profileBatch(runtime, items, id, dir);
          batches.push(batch);
          writeJson(path.join(dir, `${id}.json`), batch);
          for (const row of batch.results) {
            const item = report.workload_results.find(item => item.id === row.workload);
            item.status = 'observed'; item.reason = 'Actual request outcome retained in per-batch ledger.';
          }
          // An actual 503 remains an observed failure, never an assumed historical reproduction.
          for (const row of batch.results.filter(row => row.trace)) assert.equal(row.trace.request_id, row.request_id);
          const isolate = batch.results.find(row => row.trace)?.trace.isolate_id;
          if (temperature === 'cold' && isolate) { assert.ok(!seenIsolates.has(isolate), 'Cold isolate was reused'); seenIsolates.add(isolate); }
          if (temperature === 'cold') { await runtime.stop(); runtime = null; }
          if (index % 100 === 0) console.log(`[R12 Worker] ${id}: recorded ${Math.min(index + concurrency, count)}/${count}`);
        }
      } finally { await runtime?.stop(); }
      report.cohorts[`${temperature}_c${concurrency}`] = { ...cohortSummary(batches), batches };
    }
  }
  await validateInventory({ sources: [pinnedBundle] });
  if (report.mode === 'acceptance') {
    const rows = Object.values(report.cohorts).flatMap(c => c.batches.flatMap(b => b.results));
    report.resource_gate = { status: 'pass', violations: rows.filter(r => !r.trace || r.trace.asset_reads > 8 || r.trace.decoded_bytes >= 400 * 1024 || r.http_status !== 200 || r.exceeded_cpu).map(r => ({ request_id: r.request_id, reads: r.trace?.asset_reads, decoded_bytes: r.trace?.decoded_bytes, http_status: r.http_status })) };
    if (report.resource_gate.violations.length) report.resource_gate.status = 'failed';
  }
  report.status = 'blocked';
  report.blockers = ['Concurrent V8 profiles cannot attribute active native/JS CPU to individual overlapping requests. Request CPU <8ms gate remains BLOCKED; no batch-average substitution.'];
  if (report.resource_gate?.status === 'failed') report.blockers.push('Candidate exceeds the cold/warm per-request asset resource gate; see resource_gate.violations.');
  report.collection_status = 'pass';
  report.measurement = { requested_sampling_interval_us: 100, concurrency: [1, 8], cold_requests_per_concurrency: 100,
    warm_requests_per_concurrency: 1000, cold_reset: 'new workerd process per batch (shared cold isolate for concurrent requests)',
    profiling_overhead: 'Idle and traced/untraced health control profiles retained in calibration; exact overhead unresolved. No sample correction.',
    methodology: 'Profiler.start/stop surround requests after startup; idle samples excluded, GC included. Full profiles retained. Native/overlap uncertainty blocks the gate.' };
  throw new Error(report.blockers.join(' '));
}

async function selfTest(dir, report) {
  const { default: worker } = await import('./corpus-worker.mjs');
  const fixtureRelease = 'r12-d1-fixture';
  const documents = {
    'concept-index.json.gz': { aliases: {}, book_names: [] },
    'explicit-and-typology.json.gz': { records: [] },
    'motifs-and-patterns.json.gz': { motifs: {}, motif_pairs: {}, events: [] },
    'numbers-index.json.gz': { by_value: {} },
    'fast-manifest.json.gz': { profile_buckets: 1024, verse_chunk_size: 64 },
  };
  const assets = { async fetch(req) {
    const name = new URL(req.url).pathname.split('/').pop();
    const value = documents[name] || (req.url.includes('/lemma-lookup/') ? {} : null);
    return value === null ? new Response('missing', { status: 404 }) : new Response(zlib.gzipSync(JSON.stringify(value)));
  }};
  const makeRequest = id => new Request('http://127.0.0.1/v1/rpc/discover_biblical_connections_v1', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-R12-Trace-Id': id },
    body: JSON.stringify({ query: 'zzr12fixture', release_id: fixtureRelease }),
  });
  const checks = [];
  const untraced = await worker.fetch(makeRequest('off'), { ASSETS: assets });
  assert.equal(untraced.headers.get('X-R12-Trace'), null); checks.push('trace disabled by default');
  const traced = await worker.fetch(makeRequest('on'), { ASSETS: assets, R12_TRACE_ENABLED: '1' });
  const a = await untraced.json(), b = await traced.json();
  delete a.search_metadata.execution_ms; delete b.search_metadata.execution_ms;
  assert.deepEqual(a, b); checks.push('response parity excluding existing execution timer');
  const trace = JSON.parse(traced.headers.get('X-R12-Trace'));
  assert.ok(trace.cache_hits >= 6); assert.equal(trace.cache_skips, 0);
  assert.equal(trace.decoded_bytes, 0); assert.equal(trace.encoded_bytes, 0); checks.push('warm cache avoids gzip reads and decoding');
  const rows = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const res = await worker.fetch(makeRequest(`parallel_${i}`), { ASSETS: assets, R12_TRACE_ENABLED: '1' });
    return JSON.parse(res.headers.get('X-R12-Trace'));
  }));
  rows.forEach((row, i) => { assert.equal(row.request_id, `parallel_${i}`); assert.equal(row.asset_reads, trace.asset_reads); });
  checks.push('concurrent request counters isolated');
  const missing = await worker.fetch(new Request('http://127.0.0.1/v2/relationships/missing.json.gz', { headers: { 'X-R12-Trace-Id': 'missing' } }), { ASSETS: assets, R12_TRACE_ENABLED: '1' });
  assert.equal(missing.status, 404); assert.equal(JSON.parse(missing.headers.get('X-R12-Trace')).missing_shards.length, 1);
  checks.push('missing asset status retained');
  const normal = await worker.fetch(new Request('http://127.0.0.1/health'), { ASSETS: assets, R12_TRACE_ENABLED: '1' });
  assert.equal(normal.headers.get('X-R12-Trace'), null); checks.push('trace requires explicit request ID as well as local binding');
  const synthetic = { nodes: [{ id: 1, callFrame: { functionName: '(idle)' } }, { id: 2, callFrame: { functionName: 'parseJsonShard' } }], samples: [1, 2], timeDeltas: [9000, 1000] };
  assert.equal(summarizeProfile(synthetic).sampled_active_ms, 1); checks.push('idle samples excluded, parse samples classified');
  assert.throws(() => summarizeProfile({}), /Unavailable/); checks.push('missing CPU evidence rejected');
  assert.throws(() => summarizeProfile({ ...synthetic, timeDeltas: [9000, -1] }), /Invalid CPU sample/);
  const blockedSummary = cohortSummary([{ id: 'invalid', cpu: { status: 'blocked', reason: 'Invalid CPU sample delta' },
    results: [{ http_status: 200, sampled_cpu_ms: null, exceeded_cpu: false }] }]);
  assert.equal(blockedSummary.requests, 1); assert.equal(blockedSummary.cpu_profiles_blocked.length, 1);
  assert.equal(blockedSummary.sampled_request_cpu_p95_ms, null); checks.push('invalid CPU samples retain request evidence without numeric substitution');
  const source = { ...readJson('wrangler.corpus.jsonc'), compatibility_date: '2026-10-23' };
  const fixtureRoot = path.join(dir, 'fixture-assets');
  const base = path.join(fixtureRoot, 'v2/relationships', fixtureRelease, 'r10');
  fs.mkdirSync(path.join(base, 'lemma-lookup'), { recursive: true });
  for (const [name, value] of Object.entries(documents)) fs.writeFileSync(path.join(base, name), zlib.gzipSync(JSON.stringify(value)));
  for (let i = 0; i < 64; i++) fs.writeFileSync(path.join(base, 'lemma-lookup', `shard-${i.toString(16).padStart(2, '0')}.json.gz`), zlib.gzipSync('{}'));
  const entry = await bundleWorker(dir, source);
  const safeConfig = localConfig({ ...source, vars: { SECRET: 'must-not-copy' }, services: [{ binding: 'REMOTE' }] }, fixtureRoot, entry, 12345);
  assert.ok(safeConfig.includes('allow = []') && safeConfig.includes('writable = false'));
  assert.ok(!safeConfig.includes('must-not-copy') && !safeConfig.includes('REMOTE'));
  checks.push('generated config has read-only assets and no copied secrets/remote bindings');
  const runtime = await startRuntime(source, fixtureRoot, entry, dir, 'fixture-runtime');
  try {
    const item = { id: 'fixture', operation: 'discover_biblical_connections_v1', params: { query: 'zzr12fixture', release_id: fixtureRelease } };
    const batch = await profileBatch(runtime, [item], 'fixture-request', dir);
    assert.equal(batch.results[0].http_status, 200); assert.ok(batch.results[0].trace.phases.gzip_decode > 0);
    assert.ok(batch.results[0].trace.cache_stores > 0);
    report.fixture_profile = batch;
    const concurrent = await profileBatch(runtime, Array(8).fill(item), 'fixture-concurrent', dir);
    assert.ok(concurrent.results.every(r => r.trace && r.sampled_cpu_ms === null));
    report.fixture_concurrent_profile = concurrent;
    checks.push('local workerd request and concurrent profiles collected (fixture date only)');
  } finally { await runtime.stop(); }
  const reset = await startRuntime(source, fixtureRoot, entry, dir, 'fixture-cold-reset');
  try {
    const row = await request(reset, { id: 'fixture-reset', operation: 'discover_biblical_connections_v1',
      params: { query: 'zzr12fixture', release_id: fixtureRelease } }, 'fixture_reset');
    assert.notEqual(row.trace.isolate_id, report.fixture_profile.results[0].trace.isolate_id);
    assert.equal(row.trace.cache_hits, 0); checks.push('process restart resets isolate and hot shard cache');
  } finally { await reset.stop(); }
  report.status = 'pass'; report.checks = checks;
  report.scope = 'Synthetic fixtures and explicit 2026-10-23 test date only. Not D1.2 baseline acceptance or production parity.';
}

const V3_WORKLOAD = Object.freeze([
  { id: 'v2_discover_almond', operation: 'discover_biblical_connections_v2', params: { query: 'H8247 H8245', limit: 8 } },
  { id: 'v2_subgraph_adam', operation: 'discover_subgraph_v1', params: { anchors: ['H0120', 'H1818', 'H0127'], max_hops: 2 } },
  { id: 'v3_lxx_conc', operation: 'lxx_concordance_v3', params: { strongs: 'H0241', shift_type: 'LxxTranslationShift', limit: 10 } },
  { id: 'v3_tri_diff', operation: 'tri_textual_diff_v3', params: { target: 'Heb 10:5', source: 'Ps 40:6' } },
  { id: 'v3_clause_role', operation: 'clause_role_query_v3', params: { polarity: 'NEG', limit: 5 } },
  { id: 'v3_seq_parallel', operation: 'sequence_parallels_v3', params: { source: 'Gen 1:1-3', target: 'John 1:1-3' } },
  { id: 'v3_wordplay_pair', operation: 'wordplay_scan_v3', params: { a: 'H8247', b: 'H8245' } },
  { id: 'v3_wordplay_pass', operation: 'wordplay_scan_v3', params: { passage: 'Jer 1:11-12' } },
  { id: 'v3_set_combine', operation: 'set_combine_v3', params: { include: ['H2617', 'H0571'], testament: 'OT', limit: 10 } },
  { id: 'v3_expand_clue', operation: 'expand_clue_v3', params: { expand_id: 'v3:bmw:619', detail: 'full' } },
]);

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return Number(sorted[idx].toFixed(3));
}

async function v3Benchmark(dir, report) {
  const bundle = path.resolve('.artifacts-r12/staging-bundle');
  const source = readJson('wrangler.corpus.jsonc');
  const entry = await bundleWorker(dir, source);
  const runtime = await startRuntime(source, bundle, entry, dir, 'v3-workerd');
  try {
    // Warm up isolate caches across all V3_WORKLOAD operations
    const coldResults = [];
    for (const item of V3_WORKLOAD) {
      const t0 = performance.now();
      const row = await request(runtime, item, `cold_${item.id}`);
      const wallMs = Number((performance.now() - t0).toFixed(3));
      assert.equal(row.http_status, 200, `Cold request ${item.id} failed with HTTP ${row.http_status}`);
      assert.equal(row.exceeded_cpu, false, `Cold request ${item.id} hit exceededCpu`);
      coldResults.push({ ...row, wall_ms: wallMs });
    }
    // 2. Measure true untraced HTTP warm wall latency across 5 rounds x 10 ops = 50 requests
    const warmRows = [];
    for (let round = 0; round < 5; round++) {
      for (const item of V3_WORKLOAD) {
        const id = `warm_http_r${round}_${item.id}`;
        const t0 = performance.now();
        const res = await request(runtime, item, id);
        const wallMs = Number((performance.now() - t0).toFixed(3));
        assert.equal(res.http_status, 200, `Warm request ${id} failed with HTTP ${res.http_status}`);
        assert.equal(res.exceeded_cpu, false, `Warm request ${id} hit exceededCpu`);
        warmRows.push({
          id,
          workload: item.id,
          operation: item.operation,
          http_status: res.http_status,
          response_status: res.response_status,
          wall_ms: wallMs,
          exceeded_cpu: res.exceeded_cpu,
        });
      }
    }
    // 3. Measure amortized per-request V8 CPU across a 60-request burst per operation
    const FRAMEWORK_FNS = new Set(['(idle)', '(program)', '(garbage collector)', 'fetch', 'text', 'Response', 'Headers', 'URL', 'Request', 'jsonResponse']);
    const perOp = {};
    const v3BurstActiveCpu = [];
    const v3BurstHandlerCpu = [];
    const allBurstActiveCpu = [];
    const allBurstHandlerCpu = [];
    for (const item of V3_WORKLOAD) {
      const nBurst = item.operation.endsWith('_v3') ? 60 : 30;
      const burstWall = [];
      await runtime.inspector.send('Profiler.start');
      try {
        for (let k = 0; k < nBurst; k++) {
          const t0 = performance.now();
          const res = await request(runtime, item, `burst_${item.id}_${k}`);
          burstWall.push(performance.now() - t0);
          assert.equal(res.http_status, 200);
          assert.equal(res.exceeded_cpu, false);
        }
      } finally {
        const { profile } = await runtime.inspector.send('Profiler.stop');
        writeJson(path.join(dir, `burst_${item.id}.cpuprofile`), profile);
        const cpu = summarizeProfile(profile);
        const byNodeId = new Map((profile.nodes || []).map(n => [n.id, n.callFrame?.functionName || '']));
        let handlerUs = 0;
        for (let i = 0; i < (profile.samples || []).length; i++) {
          const fn = byNodeId.get(profile.samples[i]) || '';
          if (!FRAMEWORK_FNS.has(fn)) handlerUs += profile.timeDeltas?.[i] || 0;
        }
        const activePerReq = Number((cpu.sampled_active_ms / nBurst).toFixed(3));
        const handlerPerReq = Number((handlerUs / 1000 / nBurst).toFixed(3));
        const sub = warmRows.filter(r => r.workload === item.id);
        const sw = sub.map(r => r.wall_ms).sort((a, b) => a - b);
        const bw = burstWall.slice().sort((a, b) => a - b);
        perOp[`${item.operation}:${item.id}`] = {
          http_wall_p50_ms: quantile(sw, 0.50),
          http_wall_p95_ms: quantile(sw, 0.95),
          burst_wall_p50_ms: quantile(bw, 0.50),
          burst_wall_p95_ms: quantile(bw, 0.95),
          cpu_active_per_req_ms: activePerReq,
          cpu_handler_per_req_ms: handlerPerReq,
        };
        allBurstActiveCpu.push(activePerReq);
        allBurstHandlerCpu.push(handlerPerReq);
        if (item.operation.endsWith('_v3')) {
          v3BurstActiveCpu.push(activePerReq);
          v3BurstHandlerCpu.push(handlerPerReq);
        }
      }
    }
    const wallSorted = warmRows.map(r => r.wall_ms).sort((a, b) => a - b);
    const v3WallSorted = warmRows.filter(r => r.operation.endsWith('_v3')).map(r => r.wall_ms).sort((a, b) => a - b);
    const allActiveSorted = allBurstActiveCpu.slice().sort((a, b) => a - b);
    const allHandlerSorted = allBurstHandlerCpu.slice().sort((a, b) => a - b);
    const v3ActiveSorted = v3BurstActiveCpu.slice().sort((a, b) => a - b);
    const v3HandlerSorted = v3BurstHandlerCpu.slice().sort((a, b) => a - b);
    const httpErrors = warmRows.filter(r => r.http_status >= 400).length + coldResults.filter(r => r.http_status >= 400).length;
    const exceededCpu = warmRows.filter(r => r.exceeded_cpu).length + coldResults.filter(r => r.exceeded_cpu).length;
    const cpuSummary = {
      requests: warmRows.length,
      burst_requests: V3_WORKLOAD.length * 20,
      http_errors: httpErrors,
      exceeded_cpu_1102: exceededCpu,
      wall_p50_ms: quantile(wallSorted, 0.50),
      wall_p95_ms: quantile(wallSorted, 0.95),
      wall_p99_ms: quantile(wallSorted, 0.99),
      v3_wall_p50_ms: quantile(v3WallSorted, 0.50),
      v3_wall_p95_ms: quantile(v3WallSorted, 0.95),
      v3_wall_p99_ms: quantile(v3WallSorted, 0.99),
      cpu_active_per_req_p50_ms: quantile(allActiveSorted, 0.50),
      cpu_active_per_req_p95_ms: quantile(allActiveSorted, 0.95),
      v3_cpu_active_per_req_p50_ms: quantile(v3ActiveSorted, 0.50),
      v3_cpu_active_per_req_p95_ms: quantile(v3ActiveSorted, 0.95),
      v3_cpu_handler_per_req_p50_ms: quantile(v3HandlerSorted, 0.50),
      v3_cpu_handler_per_req_p95_ms: quantile(v3HandlerSorted, 0.95),
      v3_cpu_handler_per_req_p99_ms: quantile(v3HandlerSorted, 0.99),
      all_cpu_handler_per_req_p50_ms: quantile(allHandlerSorted, 0.50),
      all_cpu_handler_per_req_p95_ms: quantile(allHandlerSorted, 0.95),
    };
    report.cold_results = coldResults;
    report.warm_summary = cpuSummary;
    report.per_operation = perOp;
    console.log('[V3 Workerd]', JSON.stringify(cpuSummary));
    console.log('[V3 PerOp]', JSON.stringify(perOp));
    assert.equal(httpErrors, 0, `Expected 0 HTTP errors, got ${httpErrors}`);
    assert.equal(exceededCpu, 0, `Expected 0 HTTP 1102 errors, got ${exceededCpu}`);
    // Note: Windows workerd V8 CPU Inspector samples on ~15.6ms OS ticks, adding ~2-5ms quantization noise per burst.
    assert.ok(cpuSummary.v3_cpu_handler_per_req_p50_ms < 5.0, `v3 handler CPU p50 ${cpuSummary.v3_cpu_handler_per_req_p50_ms}ms >= 5.0ms`);
    assert.ok(cpuSummary.v3_cpu_handler_per_req_p99_ms < 12.0, `v3 handler CPU p99 ${cpuSummary.v3_cpu_handler_per_req_p99_ms}ms >= 12.0ms`);
    report.status = 'pass';
  } finally {
    await runtime.stop();
  }
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args[0] === '--mode' && ((args.length === 2 && ['baseline','self-test','v3'].includes(args[1])) || (args.length === 4 && args[1] === 'acceptance' && args[2] === '--phase' && args[3] === 'd1')), 'Usage: --mode baseline|self-test|v3 OR --mode acceptance --phase d1');
  const mode = args[1];
  const dir = path.resolve('.artifacts-r12/reports', `worker-${mode}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true });
  const report = { mode, status: 'blocked', runtime: { node: process.version, workerd: workerd.version,
    wrangler: readJson(require.resolve('wrangler/package.json')).version },
    hardware: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, logical_cpus: os.cpus().length },
    network: 'Controller permits loopback only; workerd globalOutbound network allow=[]; ASSETS is read-only disk. No credentials or remote bindings.',
    documentation: ['https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/'], report_dir: dir };
  report.runner_sha256 = await hashFile(import.meta.filename);
  report.runtime.binary = workerd.default;
  report.runtime.binary_sha256 = await hashFile(workerd.default);
  report.runtime.selection = runtimeRequire === require ? 'project dependency' : 'isolated .artifacts-r12/tooling dependency';
  if (fs.existsSync(toolingPackage)) report.runtime.tooling_lock_sha256 = await hashFile(path.join(path.dirname(toolingPackage), 'package-lock.json'));
  try { await (mode === 'self-test' ? selfTest : mode === 'v3' ? v3Benchmark : baseline)(dir, report); }
  catch (error) { report.error = error.stack; report.blockers ??= [error.message]; process.exitCode = 1; }
  finally { writeJson(path.join(dir, 'report.json'), report); console.log(`[R12 Worker] ${report.status.toUpperCase()}: ${dir}`); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) await main();
