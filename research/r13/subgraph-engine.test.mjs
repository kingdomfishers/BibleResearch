import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { corpusRpc } from '../../scripts/local-corpus-harness.mjs';

const zStubSource = `
const fn = () => {};
const zProxy = new Proxy(fn, {
  get(_target, prop) {
    if (prop === 'then' || prop === '__esModule') return undefined;
    if (prop === 'safeParse') return (val) => ({ success: true, data: val });
    if (prop === 'parse') return (val) => val;
    return zProxy;
  },
  apply() { return zProxy; },
});
export {
  zProxy as z, zProxy as object, zProxy as strictObject, zProxy as string,
  zProxy as number, zProxy as boolean, zProxy as array, zProxy as union,
  zProxy as literal, zProxy as record, zProxy as unknown, zProxy as any,
  zProxy as optional, zProxy as nullable, zProxy as tuple, zProxy as lazy,
  zProxy as discriminatedUnion, zProxy as enum,
};
export default zProxy;
`;

const mcpStubSource = `
export class McpServer {
  constructor() { this.tools = new Map(); }
  registerTool(name, def, handler) { this.tools.set(name, { def, handler }); }
  registerPrompt() {}
  registerResource() {}
}
`;

async function bundleTs(entryPoint) {
  const result = await esbuild.build({
    entryPoints: [path.resolve(entryPoint)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    plugins: [{
      name: 'deno-mcp-stubs',
      setup(build) {
        build.onResolve({ filter: /^(@modelcontextprotocol\/server|zod)$/ }, args => ({
          path: args.path,
          namespace: 'deno-stub',
        }));
        build.onLoad({ filter: /.*/, namespace: 'deno-stub' }, args => ({
          contents: args.path === '@modelcontextprotocol/server' ? mcpStubSource : zStubSource,
          loader: 'js',
        }));
      },
    }],
  });
  const code = result.outputFiles[0].text;
  return await import(`data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`);
}

const CORPUS_OPS = new Set([
  'get_passage_compact_v1',
  'get_word_profiles_batch_v1',
  'resolve_fast_lookup_v1',
  'discover_biblical_connections_v2',
  'discover_biblical_connections_v1',
  'get_connection_evidence_v1',
  'expand_biblical_connection_v1',
  'discover_patterns_v1',
  'compare_patterns_v1',
  'trace_evidence_v1',
  'discover_subgraph_v1',
]);

function makeReader() {
  return async ({ name, args }) => {
    if (CORPUS_OPS.has(name)) {
      const data = await corpusRpc(name, args);
      return { rows: [data] };
    }
    return { rows: [] };
  };
}

test('Subgraph Engine: connects Adam-Ground-Blood triangle (H0120, H1818, H0127) and Almond-Watching-AlmondBlossom (H8247, H8245, H8246) with valid graph proofs (EV11, EV12)', async () => {
  const { handleGetConnection } = await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts');
  const read = makeReader();

  const c01 = await handleGetConnection(read, ['H0120', 'H1818', 'H0127'], 25);
  assert.equal(c01.all_endpoints_connected, true, 'C01: H0120 + H1818 + H0127 all_endpoints_connected');
  assert.ok(c01.graph_proof?.is_valid, 'C01: graph_proof is valid');
  const c01Ids = (c01.complete_multi_anchor || []).map(c => c.id);
  const c01UniqueIds = new Set(c01Ids);
  assert.equal(c01Ids.length, c01UniqueIds.size, 'EV11: C01 complete_multi_anchor has no duplicate evidence_ids');
  assert.ok(
    !c01Ids.some(id => id.startsWith('nearby_cooc:')),
    'EV11: C01 complete_multi_anchor does not use coincidental ±2v nearby_cooc as a complete triangle proof',
  );
  assert.equal(c01.graph_proof.distinct_anchor_pairs_connected, 3, 'EV11: C01 connects all 3 distinct anchor pairs');

  const c02 = await handleGetConnection(read, ['H8247', 'H8245', 'H8246'], 25);
  assert.equal(c02.all_endpoints_connected, true, 'C02: H8247 + H8245 + H8246 all_endpoints_connected');
  assert.ok((c02.complete_multi_anchor || []).length >= 2, 'EV12: C02 complete_multi_anchor has >= 2 distinct edges');
  const c02Ids = (c02.complete_multi_anchor || []).map(c => c.id);
  assert.equal(c02Ids.length, new Set(c02Ids).size, 'EV12: C02 complete_multi_anchor has no duplicate evidence_ids');
  assert.ok(c02.graph_proof?.is_valid && c02.graph_proof.verified_edge_count >= 2, 'EV12: C02 graph_proof has >= 2 verified edges reaching H8246');
});

test('Subgraph Engine: connects multi-passage networks C03, C04 (EV13 sense distinction), C05 (no intra-anchor pollution), U04 (EV16 Jonah/Matt), and rejects C10', async () => {
  const { handleGetConnection } = await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts');
  const read = makeReader();

  const c03 = await handleGetConnection(
    read,
    ['Jeremiah 1:11-12', 'Exodus 25:33-37', 'Zechariah 4:2-14', 'Revelation 5:6'],
    25,
  );
  assert.equal(c03.all_endpoints_connected, true, 'C03: Almond-Menorah-SevenEyes 4-passage network connected');
  assert.ok(c03.graph_proof?.is_valid && c03.graph_proof.verified_edge_count >= 3, 'C03: valid 4-passage Steiner tree proof');

  const c04 = await handleGetConnection(
    read,
    ['Genesis 6:14', 'Leviticus 16:30', 'Exodus 2:3', '1 Peter 3:20-21'],
    25,
  );
  assert.equal(c04.all_endpoints_connected, true, 'C04: Ark-Pitch-Atonement-Baptism 4-passage network connected');
  const c04AllConns = [...(c04.complete_multi_anchor || []), ...(c04.direct_pairwise || [])];
  const h3722HomographEdge = c04AllConns.find(c => String(c.id).startsWith('shared_lemma_homograph:H3722:'));
  assert.ok(h3722HomographEdge, 'EV13: C04 distinguishes H3722B (cover with pitch in Gen 6:14) from H3722A (make atonement in Lev 16:30)');
  assert.equal(h3722HomographEdge.relation, 'shared_root_distinct_senses');

  const c05 = await handleGetConnection(
    read,
    ['Genesis 2:7', 'Ezekiel 37:5-10', 'John 20:22', 'Revelation 11:11'],
    25,
  );
  assert.equal(c05.all_endpoints_connected, true, 'C05: Breath-DryBones-Resurrection 4-passage network connected');
  const c05TreeIds = (c05.complete_multi_anchor || []).map(c => c.id);
  assert.ok(!c05TreeIds.includes('r13:wp:H0120:H0127'), 'C05: complete_multi_anchor excludes intra-anchor Genesis 2:7 Adam-ground wordplay');

  const u04 = await handleGetConnection(read, ['Jonah 1:17', 'Matthew 12:40'], 25);
  assert.equal(u04.all_endpoints_connected, true, 'U04/EV16: Jonah 1:17 <-> Matthew 12:40 connected');
  const u04Conns = [...(u04.complete_multi_anchor || []), ...(u04.direct_pairwise || [])];
  assert.ok(
    !u04Conns.some(c => c.id === 'passage_lxx:H3915:G2250' || c.id === 'passage_lxx:H3117:G3571'),
    'EV16: Jonah 1:17 <-> Matthew 12:40 has no inverse night->day or day->night LXX pair',
  );
  assert.ok(
    u04Conns.some(c => String(c.id).startsWith('nt_typological_citation:')),
    'EV16/U04: Jonah 1:17 <-> Matthew 12:40 includes explicit_typological_quotation / authorial_typology_or_quote',
  );

  const c10 = await handleGetConnection(read, ['H1904', 'H3629'], 25);
  assert.equal(c10.all_endpoints_connected, false, 'C10: Haman (H1904) + kidneys (H3629) negative control stays disconnected');
  assert.equal(c10.direct_link_found, false);
});
