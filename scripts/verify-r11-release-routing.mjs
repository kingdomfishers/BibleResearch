/** Local, read-only release compatibility regression against Argon's bundle. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { handleQueryRelationshipsV2, handleDiscoverRelationshipPathsV1 } from './corpus-relationships-rpc.mjs';

const root = path.resolve('.artifacts-r10/deploy-bundle');
for (const active_release of ['r10-v1.0', 'r11-v1.0']) {
  const ctx = { env: {}, async loadJsonShard(_env, name) {
    if (name === '/v2/relationships/active.json.gz') return { active_release };
    const file = path.join(root, name.replace(/^\/+/, ''));
    return fs.existsSync(file) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(file))) : null;
  }};
  for (const query of ['H7307', 'H7799']) {
    const result = await handleQueryRelationshipsV2(ctx, { query });
    assert.equal(result.release_version, 'r9b-v1.0');
    assert.notEqual(result.status, 'unavailable', JSON.stringify(result));
    assert.notEqual(result.status, 'release_not_found');
  }
  for (const [book, chapter, verse] of [[1, 1, 2], [11, 7, 26]]) {
    const result = await handleQueryRelationshipsV2(ctx, { op: 'passage_frames', book, chapter, verse });
    assert.equal(result.release_version, 'r9b-v1.0');
    assert.notEqual(result.status, 'unavailable');
  }
  const coverage = await handleQueryRelationshipsV2(ctx, { op: 'coverage' });
  assert.equal(coverage.release_version, 'r9b-v1.0');
  const paths = await handleDiscoverRelationshipPathsV1(ctx, { source: 'lemma:H7307', target: 'lemma:G4151', max_hops: 2 });
  assert.equal(paths.release_version, 'r9b-v1.0');
  assert.ok(paths.paths.length > 0, JSON.stringify(paths.coverage));
  const explicit = await handleQueryRelationshipsV2(ctx, { release: 'r8-v1.1', op: 'coverage' });
  assert.equal(explicit.release_version, 'r8-v1.1');
  console.log(`${active_release}: legacy relationship routing, passage frames, coverage and explicit override passed`);
}
