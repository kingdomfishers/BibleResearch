import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { corpusRpc } from '../../scripts/local-corpus-harness.mjs';
import { analyzeLiteraryPassage } from '../../src/relationships/literary-engine.ts';

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
  'compare_hebrew_septuagint_passage_v1',
  'lookup_septuagint_passage_v1',
  'query_septuagint_alignments_v1',
  'query_cross_testament_parallels_v1',
]);

function makeReader(extraHandlers = {}) {
  return async ({ name, args }) => {
    if (extraHandlers[name]) return await extraHandlers[name](args);
    if (CORPUS_OPS.has(name)) {
      const data = await corpusRpc(name, args);
      return { rows: [data] };
    }
    return { rows: [] };
  };
}

let cachedMods;
async function getMods() {
  if (!cachedMods) {
    cachedMods = {
      tools: await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts'),
      wordModel: await bundleTs('supabase/functions/bible-mcp/word-model.ts'),
      research: await bundleTs('supabase/functions/bible-mcp/research-engine.ts'),
    };
  }
  return cachedMods;
}

test('I3-1: Swete Psalm untitled shift fixed (Ps 33:6->32:6, Ps 104:30->103:30) while titled preserved (Ps 18:1->17:2) & non-empty hebrew text', async () => {
  const { research } = await getMods();
  const read = makeReader();

  const ps33 = await research.executeResearch(read, {
    operations: [{ op: 'lxx', passage: 'Psalm 33:6', mode: 'compare', limit: 3 }],
  });
  const ps33Data = ps33.results[0]?.data;
  assert.equal(ps33Data?.septuagint_passage?.ref, 'Psalmi 32:6');
  assert.match(ps33Data?.septuagint_passage?.text || '', /τῷ λόγῳ τοῦ κυρίου/i);
  assert.ok((ps33Data?.hebrew_passage?.text || '').length > 5, 'hebrew_passage.text must not be empty');
  assert.match(ps33Data?.hebrew_passage?.ref || '', /^Psalm|^Psalms/i);

  const ps104 = await corpusRpc('compare_hebrew_septuagint_passage_v1', { p_hebrew_book: 19, p_hebrew_chapter: 104, p_hebrew_verse: 30 });
  assert.equal(ps104.septuagint_passage?.verse_nr, 30, 'Untitled Ps 104:30 must align to Swete 103:30');

  const ps18 = await corpusRpc('compare_hebrew_septuagint_passage_v1', { p_hebrew_book: 19, p_hebrew_chapter: 18, p_hebrew_verse: 1 });
  assert.equal(ps18.septuagint_passage?.verse_nr, 2, 'Titled Ps 18:1 must preserve Swete 17:2 shift');

  const gen22 = await research.executeResearch(read, {
    operations: [{ op: 'lxx', passage: 'Genesis 2:2', mode: 'passage', limit: 3 }],
  });
  assert.equal(gen22.results[0]?.status, 'ok');
  assert.ok(gen22.results[0]?.data && !Array.isArray(gen22.results[0]?.data), 'Single-verse Gen 2:2 lxx passage must return verse data');
});

test('I3-2: compare_patterns aligns passage ranges, discover_patterns retries gracefully, and Greek grammar_search has coverage_note', async () => {
  const { research } = await getMods();
  const read = makeReader();

  const cmp = await corpusRpc('compare_patterns_v1', { targets: ['Gen 1:1-2:3', 'Exod 39:32-40:34'] });
  assert.equal(cmp.status, 'ok');
  assert.ok(Array.isArray(cmp.shared_lemmas) && cmp.shared_lemmas.includes('H3615'), `Expected H3615 in shared_lemmas, got ${JSON.stringify(cmp.shared_lemmas)}`);

  const gramG = await research.executeResearch(read, {
    operations: [{ op: 'grammar_search', word: 'G0129', limit: 5 }],
  });
  assert.equal(gramG.results[0]?.status, 'ok');
  assert.match(gramG.results[0]?.coverage_note || '', /Hebrew\/Aramaic/i);

  const dpRetryRead = makeReader({
    discover_patterns_v1: async (args) => {
      if (String(args.query || '').split(/\s+/).length > 4) {
        return { rows: [{ status: 'error', error: 'too heavy' }] };
      }
      return { rows: [{ status: 'ok', network: { pattern_count: 1, patterns: [{ pattern_id: 'p1', pattern_type: 'shared', title: 'test', summary: 'ok', anchor_coverage: 1, witness_refs: [], explicit_vs_inferred: 'explicit', counterexamples_and_limits: [], distinctiveness_score: 1 }] }, strongest_connections: [] }] };
    },
  });
  const dp = await research.executeResearch(dpRetryRead, {
    operations: [{ op: 'discover_patterns', query: 'sevenfold completion sabbath creation rest temple pattern' }],
  });
  assert.equal(dp.results[0]?.status, 'ok');
});

test('I3-3: Etymology profileLex filters Ephes-dammim & fixes Greek source; literary filters H9033/H9036; Rev4:5-5:6 blocks G1027:G2362 verified_edge', async () => {
  const { wordModel, tools } = await getMods();
  const read = makeReader();

  const damEtym = await wordModel.buildWordEtymology(read, 'H1818', {
    bs: 'H1818',
    sc: 'דָּם',
    gl: 'blood',
    lexical_relations: [
      { target_strongs: 'H0658', script: 'אֶ֫פֶס דַּמִּים', gloss: 'Ephes-dammim', root: 'אֶפֶס דַּמִּים', type: 'shared_root' },
    ],
  }, 5);
  assert.equal(damEtym.roots?.length ?? 0, 0, 'profileLex must not attach Ephes-dammim as root of dam');
  assert.equal(damEtym.relatives?.length ?? 0, 0, 'profileLex must filter compound proper-place relatives on common noun H1818');

  const gEtym = await wordModel.buildWordEtymology(read, 'G1720', {
    bs: 'G1720',
    sc: 'ἐμφυσάω',
    gl: 'to breathe into',
    lexical_relations: [
      { target_strongs: 'G9684', script: 'φυσάω', gloss: 'to blow', type: 'derived_from' },
    ],
  }, 5);
  assert.equal(gEtym.relatives?.[0]?.source, 'STEPBible / GreekLexicon', 'Greek profileLex must use STEPBible / GreekLexicon source');

  const genCh = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.resolve('.artifacts-r12/staging-bundle/v1/chapters/b1-c1.json.gz'))));
  const genVerses = Object.values(genCh.verses).sort((a, b) => a.verse_nr - b.verse_nr);
  const genLit = analyzeLiteraryPassage({ passage: 'Genesis 1:1-31', verses: genVerses, truncated: false }, { detail: 'standard' });
  const detectedStr = JSON.stringify({
    retainedMotifs: genLit.segmentation?.conclusion?.retainedMotifs ?? [],
    deviations: genLit.deviations ?? [],
    keyWords: genLit.keyWords ?? [],
  });
  assert.doesNotMatch(detectedStr, /H903[36]/, 'Pronominal suffixes H9033/H9036 must not appear in literary motifs/deviations/keywords');

  const revConn = await tools.handleGetConnection(read, ['Revelation 4:5', 'Revelation 5:6'], 6);
  const edgeIds = (revConn.graph_proof?.verified_edges || []).map(e => e.id);
  assert.ok(!edgeIds.includes('passage_root_wordplay:G1027:G2362'), 'βροντή↔θρόνος must not be a verified_edge in Rev 4:5↔5:6');
});
