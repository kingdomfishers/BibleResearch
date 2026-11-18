/** Local loader regression: ignored Range, real gzip, bounded reads and cache ownership. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r12-packed-'));
const entry = path.join(dir, 'worker.mjs');
await build({ entryPoints: ['scripts/corpus-worker.mjs'], outfile: entry, bundle: true, platform: 'node', format: 'esm' });
const { loadJsonShardWithBytes } = await import(pathToFileURL(entry));
const expected = { evidence_id: 'rel:exact-source-id', source_token_id: 'o010070220041', word_position: 9 };
const member = gzipSync(JSON.stringify(expected));
const start = 2 * 1024 * 1024 + 19, end = start + member.length - 1;
let reads = 0, cancelled = 0, consumed = 0;
function response() {
  let offset = 0;
  return new Response(new ReadableStream({
    type: 'bytes',
    pull(controller) {
      const length = Math.min(65536, 24 * 1024 * 1024 - offset);
      const chunk = new Uint8Array(length);
      const from = Math.max(start, offset), to = Math.min(end + 1, offset + length);
      if (to > from) chunk.set(member.subarray(from - start, to - start), from - offset);
      offset += length; consumed += length; controller.enqueue(chunk);
      if (offset === 24 * 1024 * 1024) controller.close();
    },
    cancel() { cancelled++; },
  }));
}
const env = { ASSETS: { async fetch(request) { reads++; assert.equal(request.headers.get('Range'), `bytes=${start}-${end}`); return response(); } } };
const asset = `/packed-regression.bin#bytes=${start}-${end}`;
const [a, b] = await Promise.all([loadJsonShardWithBytes(env, asset), loadJsonShardWithBytes(env, asset)]);
assert.deepEqual(a.data, expected); assert.deepEqual(b.data, expected);
assert.equal(reads, 1, 'one request shares its in-flight load');
assert.equal(b.bytes, 0);
assert.equal(cancelled, 1, 'unread suffix cancelled');
assert.ok(consumed < 3 * 1024 * 1024, '24 MiB blob never fully buffered');
assert.equal((await loadJsonShardWithBytes({ ASSETS: { fetch() { throw new Error('completed cache missed'); } } }, asset)).bytes, 0);

const ranged = { ASSETS: { async fetch() { return new Response(member, { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${end + 20}` } }); } } };
assert.deepEqual((await loadJsonShardWithBytes(ranged, `/ranged.bin#bytes=${start}-${end}`)).data, expected);
const invalid = { ASSETS: { async fetch() { return new Response(member, { status: 206, headers: { 'Content-Range': `bytes 0-${member.length - 1}/${end + 20}` } }); } } };
await assert.rejects(loadJsonShardWithBytes(invalid, `/invalid.bin#bytes=${start}-${end}`), /Invalid packed asset range/);
const truncated = { ASSETS: { async fetch() { return new Response(new Uint8Array(10)); } } };
await assert.rejects(loadJsonShardWithBytes(truncated, '/short.bin#bytes=12-20'), /Packed asset range unavailable/);
assert.equal(truncated.__assetInflight.size, 0, 'failed load is removed from request-local promises');
console.log('PASS: ignored/valid/invalid/truncated ranges, exact gzip JSON, bounded stream cancellation, request-local deduplication and completed cache');
