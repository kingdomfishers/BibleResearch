import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Exercise the actual gateway with a local transport; never contact production.
const directory = path.resolve('.artifacts/notes-connection-types');
await fs.mkdir(directory, { recursive: true });
const outfile = path.join(directory, 'gateway.mjs');
await build({
  entryPoints: ['src/api/notes-rpc.ts'], outfile, bundle: true, format: 'esm', platform: 'node',
  plugins: [{ name: 'local-notes-client', setup(builder) {
    builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'client', namespace: 'notes-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'notes-test' }, () => ({
      contents: 'export const supabase = globalThis.__connectionTypeTestClient;', loader: 'js',
    }));
  } }],
});
const registry = { connection_types: [{ connection_type: 'wordplay' }], note_kinds: [], block_types: [] };
let sequence = 0;
async function gateway(handler) {
  globalThis.__connectionTypeTestClient = { rpc(name) {
    assert.equal(name, 'list_note_connection_types_v1');
    return { abortSignal: handler };
  } };
  return (await import(pathToFileURL(outfile).href + '?scenario=' + ++sequence)).NotesRPC;
}
try {
  let calls = 0, complete;
  const api = await gateway(() => { calls++; return new Promise(resolve => { complete = resolve; }); });
  const reads = [api.connectionTypes(), api.connectionTypes(), api.connectionTypes()];
  assert.equal(calls, 1, 'Concurrent startup readers share one transport');
  complete({ data: registry, error: null });
  for (const result of await Promise.all(reads)) assert.deepEqual(result.data, registry);
  assert.deepEqual((await api.connectionTypes()).data, registry);
  assert.equal(calls, 1, 'Resolved registry still uses the existing cache');

  let attempts = 0;
  const retry = await gateway(async () => ++attempts === 1
    ? { data: null, error: { message: 'temporary outage' } }
    : { data: registry, error: null });
  const failed = await Promise.all([retry.connectionTypes(), retry.connectionTypes()]);
  assert.ok(failed.every(result => result.source === 'unavailable'));
  assert.equal(attempts, 1);
  assert.deepEqual((await retry.connectionTypes()).data, registry);
  assert.equal(attempts, 2, 'Failed requests clear the in-flight entry and can retry');

  const pending = [];
  const independent = await gateway(signal => new Promise((resolve, reject) => {
    pending.push(resolve);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const cancellable = independent.connectionTypes({ signal: controller.signal });
  const shared = independent.connectionTypes();
  const other = independent.connectionTypes();
  assert.equal(pending.length, 2, 'Cancellable transport stays separate from shared reads');
  controller.abort(new Error('caller cancelled'));
  assert.equal((await cancellable).source, 'unavailable');
  pending[1]({ data: registry, error: null });
  assert.deepEqual((await shared).data, registry);
  assert.deepEqual((await other).data, registry);
  console.log('PASS: registry coalescing (3 to 1), cache reuse, outage retry and independent cancellation');
} finally {
  delete globalThis.__connectionTypeTestClient;
}
