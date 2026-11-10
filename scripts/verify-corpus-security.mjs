import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withCorpusSecurity } from './corpus-security.mjs';

let calls = 0;
const wrapped = withCorpusSecurity({ fetch: async () => {
  calls++;
  return Response.json({ status: 'ok', lexical: { frame: 'restricted', greekstrong: 'restricted', text: 'בְּרֵאשִׁית' }, fields: [{ field_name: 'sdbh', value: 'restricted' }, { field_name: 'morph', value: 'N' }] });
}});
let assertions = 0;
for (const path of ['/tables/books/part-0000.jsonl.gz?raw=1','/v1/chapters/b1-c1.json.gz','/v1/lexical/query-index.json','/v1/lxx/b1.json.gz','/v1/syntax/search-index.json.gz','/v1/catalog/metadata.json.gz']) {
  const res = await wrapped.fetch(new Request(`https://corpus.test${path}`), {});
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'raw_corpus_asset_access_disabled');
  assertions += 2;
}
assert.equal(calls, 0);
const preflight = await wrapped.fetch(new Request('https://corpus.test/v1/rpc/lookup_syntax_tree_v1', { method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'content-type,authorization,apikey' } }), {});
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'content-type,authorization,apikey');
for (const path of ['/v1/rpc/lookup_syntax_tree_v1','/v1/syntax/unmapped']) {
  const res = await wrapped.fetch(new Request(`https://corpus.test${path}`), {});
  const body = await res.json();
  assert.deepEqual(body, { status: 'ok', lexical: { text: 'בְּרֵאשִׁית' }, fields: [{ field_name: 'morph', value: 'N' }] });
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assertions += 2;
}
const report = { status: 'PASS', assertions: assertions + 3, source: 'deployed dc01ca7e-34ee-424f-aff9-c453352a3d97', raw_backups_public: false };
fs.mkdirSync('.artifacts/phase0', { recursive: true });
fs.writeFileSync('.artifacts/phase0/corpus-security.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
