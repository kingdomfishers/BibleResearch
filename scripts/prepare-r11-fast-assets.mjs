/** Candidate-only resharding of existing derived evidence. Never edits the input release. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fnv1a64Hex } from '../src/relationships/adjacency-loader.ts';
const keyHash = key => BigInt('0x' + fnv1a64Hex(key)).toString(2).padStart(64, '0');
const read = file => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
export function prepareFastAssets(input, output) {
  input = fs.realpathSync(input); output = path.resolve(output);
  assert.ok(!fs.existsSync(output), 'Candidate output must not already exist');
  assert.ok(!output.toLowerCase().startsWith(input.toLowerCase() + path.sep), 'Output must be outside input');
  const manifest = read(path.join(input, 'manifest.json.gz'));
  const release = /\/relationships\/([^/]+)\//.exec(manifest.files[0]?.path)?.[1];
  assert.ok(release, 'Release ID missing from manifest');
  const maps = { lookup: {}, profiles: {}, verses: {}, refs: {} };
  for (const [dir, field, target] of [['lemma-lookup','entries','lookup'], ['lemma-profiles','entries','profiles'], ['evidence-passages','verses','verses']]) {
    for (const name of fs.readdirSync(path.join(input, 'r10', dir)).sort()) {
      const entries = read(path.join(input, 'r10', dir, name))[field];
      for (const [key, value] of Array.isArray(entries) ? entries : Object.entries(entries)) {
        assert.ok(!(key in maps[target]) || JSON.stringify(maps[target][key]) === JSON.stringify(value), `Conflicting ${target}:${key}`);
        maps[target][key] = value;
        if (target === 'verses') {
          const ref = `${value.book}:${value.chapter}:${value.verse}`;
          assert.ok(!(ref in maps.refs) || maps.refs[ref] === key, `Ambiguous reference ${ref}`);
          maps.refs[ref] = key;
        }
      }
    }
  }
  // Only the candidate omits replaced derived layouts. Every original release stays intact.
  const replaced = ['lemma-lookup','lemma-profiles','evidence-passages','fast-profiles','fast-verses'];
  const replacedPaths = replaced.map(name => path.join(input, 'r10', name));
  fs.cpSync(input, output, { recursive: true, errorOnExist: true,
    filter: file => !replacedPaths.some(dir => file === dir || file.startsWith(dir + path.sep)) });
  manifest.files = manifest.files.filter(file => !replaced.some(name => file.path.includes('/r10/' + name + '/')));
  let added = 0;
  function write(rel, data, max = 128 * 1024) {
    const raw = Buffer.from(JSON.stringify(data)); assert.ok(raw.length <= max, `Oversize ${rel}: ${raw.length}`);
    const gz = zlib.gzipSync(raw, { level: 9 });
    const file = path.join(output, 'r10', rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, gz);
    const metadata = { path: `/v2/relationships/${release}/r10/${rel}`, raw_bytes: raw.length, gz_bytes: gz.length,
      sha256_raw: crypto.createHash('sha256').update(raw).digest('hex'), sha256_gz: crypto.createHash('sha256').update(gz).digest('hex') };
    const index = manifest.files.findIndex(f => f.path === metadata.path);
    if (index < 0) { manifest.files.push(metadata); added++; } else manifest.files[index] = metadata;
  }
  for (const [namespace, entries] of Object.entries(maps)) {
    const limit = ['lookup','refs'].includes(namespace) ? 64 * 1024 : 128 * 1024;
    const rootBits = namespace === 'refs' ? 7 : 8;
    function partition(prefix, pairs, routes) {
      const data = { entries: Object.fromEntries(pairs) };
      const rel = `selective/${namespace}/${prefix}.json.gz`;
      if (Buffer.byteLength(JSON.stringify(data)) <= limit) { write(rel, data, limit); routes.push(prefix); return; }
      if (pairs.length === 1) {
        const [key, value] = pairs[0], serialized = JSON.stringify(value), pages = [];
        // Serialized JSON chunks keep every page bounded even for escaped Unicode or quotes.
        for (let offset = 0, n = 0; offset < serialized.length; n++) {
          let length = Math.min(limit / 2, serialized.length - offset);
          while (Buffer.byteLength(JSON.stringify({ text: serialized.slice(offset, offset + length) })) > limit) length = Math.floor(length / 2);
          assert.ok(length > 0, 'Cannot split serialized value');
          const page = `selective/${namespace}/${prefix}-${n}.json.gz`;
          write(page, { text: serialized.slice(offset, offset + length) }, limit); pages.push(page); offset += length;
        }
        write(rel, { continuation: { key, pages } }, limit); routes.push(prefix); return;
      }
      assert.ok(prefix.length < 64, 'Unresolvable hash collision');
      const children = {};
      for (const pair of pairs) { const digit = keyHash(pair[0])[prefix.length]; (children[digit] ||= []).push(pair); }
      for (const [digit, child] of Object.entries(children)) partition(prefix + digit, child, routes);
    }
    const buckets = {};
    for (const pair of Object.entries(entries).sort(([a],[b]) => a.localeCompare(b))) (buckets[keyHash(pair[0]).slice(0, rootBits)] ||= []).push(pair);
    // Empty buckets are real pages: absent keys and missing assets are distinguishable.
    for (let i = 0; i < 2 ** rootBits; i++) { const prefix = i.toString(2).padStart(rootBits,'0'); const routes = []; partition(prefix, buckets[prefix] || [], routes); if (routes.length !== 1 || routes[0] !== prefix) write(`selective/${namespace}/${prefix}.json.gz`, { routes: routes.sort() }, limit); }
  }
  write('fast-manifest.json.gz', { schema_version: 2, selective: true, profile_buckets: 1024, verse_chunk_size: 64 });
  manifest.counts.total_r10_files = manifest.files.length;
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(output, 'manifest.json.gz'), zlib.gzipSync(JSON.stringify(manifest), { level: 9 }));
  return { release, added, counts: Object.fromEntries(Object.entries(maps).map(([key,value]) => [key,Object.keys(value).length])) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  assert.ok(process.argv.length === 6 && process.argv[2] === '--input' && process.argv[4] === '--output', 'Usage: --input RELEASE_DIRECTORY --output NEW_CANDIDATE_DIRECTORY');
  console.log(JSON.stringify(prepareFastAssets(process.argv[3], process.argv[5])));
}
