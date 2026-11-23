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
]);

function makeReader(opts = {}) {
  return async ({ name, args }) => {
    if (opts.failOp && name === opts.failOp) {
      throw new Error(`simulated ${name} failure`);
    }
    if (CORPUS_OPS.has(name)) {
      const data = await corpusRpc(name, args);
      return { rows: [data] };
    }
    return { rows: [] };
  };
}

test('Defect 5A: research(op="evidence") unwraps raw.evidence + passage_details and preserves release_mismatch', async () => {
  const { executeResearch } = await bundleTs('supabase/functions/bible-mcp/research-engine.ts');
  const read = makeReader();

  const okRes = await executeResearch(read, {
    operations: [{ op: 'evidence', evidence_id: 'r11:xref:1:30968' }],
  });
  assert.equal(okRes.status, 'ok');
  const evOp = okRes.results[0];
  assert.equal(evOp.evidence_id, 'r11:xref:1:30968');
  assert.ok(evOp.relation, 'Hydrates predicate/relation from raw.evidence');
  assert.ok(evOp.epistemic, 'Hydrates epistemic class');
  assert.ok(evOp.title, 'Hydrates title');
  assert.ok(Array.isArray(evOp.passages) && evOp.passages.length >= 1, 'Hydrates passage_details/passages');
  assert.ok(evOp.passages[0].english_text || evOp.passages[0].original_tokens?.length, 'Includes verse text/tokens');

  const mismatchRes = await executeResearch(read, { query: 'r11:xref:1:30968', limit: 5 });
  assert.equal(mismatchRes.status, 'ok');

  const badRelRes = await executeResearch(read, {
    operations: [{ op: 'evidence', evidence_id: 'r11:xref:1:30968', release_id: 'bogus-rel' }],
  });
  assert.equal(badRelRes.results[0].status, 'release_mismatch', 'Preserves release_mismatch status');
});

test('Defect 5B: handleGetConnection rejects unrelated direct_link_found=true and connects genuine pairs', async () => {
  const { handleGetConnection } = await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts');
  const read = makeReader();

  const unrelated = await handleGetConnection(read, ['H8247', 'Revelation 12:1'], 10);
  assert.equal(unrelated.direct_link_found, false, 'Unrelated H8247 + Rev 12:1 must not falsely claim direct_link_found');
  assert.equal(unrelated.all_endpoints_connected, false);
  assert.equal((unrelated.direct_pairwise || []).length, 0);

  const linkedPassages = await handleGetConnection(read, ['Genesis 6:14', 'Exodus 2:3'], 10);
  assert.equal(linkedPassages.direct_link_found, true, 'Gen 6:14 + Exod 2:3 finds genuine shared vocabulary/links');
  assert.ok((linkedPassages.connections || []).length > 0);

  const linkedReversed = await handleGetConnection(read, ['Hebrews 9:2', 'Exodus 25:31'], 10);
  assert.equal(linkedReversed.direct_link_found, true, 'Reverse order Passage<->Passage finds bidirectional links');
});

test('Defect 5C & flags: handleGetPassage preserves sense_status and maps flags without fake "witness votes"', async () => {
  const { handleGetPassage, buildFullCompactWord } = await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts');
  const read = makeReader();

  const p = await handleGetPassage(read, {
    passage: 'Genesis 6:14',
    depth: 5,
    word_depth: 0,
    etymology: 0,
    realworld: 0,
    offset: 0,
    limit: 5,
  });
  const connsJson = JSON.stringify(p);
  assert.equal(/\d+ witness votes/i.test(connsJson), false, 'Must not format bitmask flags as witness votes');

  const anchored = await buildFullCompactWord(read, 'H3722', {
    connections: 5,
    etymology: 0,
    realworld: 0,
    passage: 'Genesis 6:14',
  });
  assert.ok(anchored.anchored_occurrence, 'Exposes anchored_occurrence metadata');
  assert.equal(anchored.anchored_occurrence.strongs, 'H3722');
});

test('Defect 5D: selectChainEvidence handles word->passage and non-Strong\'s labels', async () => {
  const { selectChainEvidence } = await bundleTs('supabase/functions/bible-mcp/chain-evidence.ts');
  const cands = [
    {
      id: 'r11:cluster:H0120:0',
      relation: 'verified_lexical_grammatical',
      epistemic: 'direct_textual_evidence',
      refs: ['Genesis 2:7', 'Genesis 3:19'],
      target: { strongs: 'H0127', gloss: 'ground, earth', transliteration: 'adamah' },
    },
  ];
  const hitPassage = selectChainEvidence(cands, 'H0120', 'Gen 2:7');
  assert.equal(hitPassage?.id, 'r11:cluster:H0120:0', 'Matches word -> passage hop');
  const hitWord = selectChainEvidence(cands, 'H0120', 'adamah');
  assert.equal(hitWord?.id, 'r11:cluster:H0120:0', 'Matches word -> transliteration hop');
});

test('Defect 5E: buildFullCompactWord reports warnings and degraded discovery_status on upstream error', async () => {
  const { buildFullCompactWord } = await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts');
  const read = makeReader({ failOp: 'discover_biblical_connections_v2' });
  const res = await buildFullCompactWord(read, 'H0120', {
    connections: 5,
    etymology: 0,
    realworld: 0,
  });
  assert.equal(res.status, 'partial');
  assert.equal(res.discovery_status, 'unavailable');
  assert.ok(res.warnings.length >= 1);
});

test('R13 Research Ops: discover_patterns, compare_patterns, trace_evidence & r13:* hydration work cleanly', async () => {
  const { executeResearch } = await bundleTs('supabase/functions/bible-mcp/research-engine.ts');
  const read = makeReader();

  const dp = await executeResearch(read, {
    operations: [{ op: 'discover_patterns', query: 'H8247 almond watch Jer 1:11', limit: 8 }],
  });
  assert.equal(dp.status, 'ok');
  const dpOp = dp.results[0];
  assert.equal(dpOp.status, 'ok');
  assert.ok(dpOp.pattern_count >= 1, 'Synthesizes at least one pattern');
  assert.ok(Array.isArray(dpOp.top_connections) && dpOp.top_connections.length >= 1);
  const wpConn = dpOp.top_connections.find(c => String(c.id).startsWith('r13:wp:'));
  assert.ok(wpConn, 'Surfaces r13:wp connection in discover_patterns');
  assert.ok(wpConn.evidence_type, 'Preserves evidence_type on CompactConnection');
  assert.ok(wpConn.score_breakdown && typeof wpConn.score_breakdown.E === 'number', 'Preserves score_breakdown');

  const tr = await executeResearch(read, {
    operations: [{ op: 'trace_evidence', evidence_id: wpConn.id }],
  });
  assert.equal(tr.status, 'ok');
  const trOp = tr.results[0];
  assert.equal(trOp.status, 'ok');
  assert.equal(trOp.evidence_id, wpConn.id);
  assert.ok(trOp.score_breakdown || trOp.provenance, 'Hydrates trace_evidence provenance');
  assert.ok(Array.isArray(trOp.passage_details) && trOp.passage_details.length >= 1);

  const cmp = await executeResearch(read, {
    operations: [{ op: 'compare_patterns', targets: ['Exodus 25:31', 'Hebrews 9:2'] }],
  });
  assert.equal(cmp.status, 'ok');
  const cmpOp = cmp.results[0];
  assert.equal(cmpOp.status, 'ok');
  assert.ok(Array.isArray(cmpOp.combined_connections) && cmpOp.combined_connections.length >= 1);
});
