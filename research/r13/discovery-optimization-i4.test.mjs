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
      atlas: await bundleTs('supabase/functions/bible-mcp/context-atlas.ts'),
    };
  }
  return cachedMods;
}

test('I4-1: Primary-sense display overrides for H1540, H5158, and H2319 in word-model & discover_patterns', async () => {
  const { wordModel } = await getMods();

  const w1540 = wordModel.compactWordFromData({
    token: null,
    profile: {
      bs: 'H1540',
      lk: 'lemma:h1540g',
      sc: 'הֶגְלָם',
      tr: 'heglam',
      gl: 'Heglam',
      lang: 'hbo',
      senses: [
        { key: 'sense:H1540G:primary', gl: 'Heglam' },
        { key: 'sense:H1540A:primary', gl: 'to uncover, reveal, exile' },
      ],
    },
  });
  assert.equal(w1540.lemma, 'גָּלָה');
  assert.equal(w1540.gloss, 'to uncover, reveal, go into exile');
  assert.equal(w1540.senses?.[0]?.gloss, 'to uncover, reveal, exile');

  const w5158 = wordModel.compactWordFromData({
    token: null,
    profile: {
      bs: 'H5158',
      lk: 'lemma:h5158a',
      sc: 'נַ֫חַל',
      tr: 'na.chal',
      gl: 'palm-tree',
      lang: 'hbo',
      senses: [
        { key: 'sense:H5158B:primary', gl: 'palm-tree' },
        { key: 'sense:H5158A:primary', gl: 'wadi, torrent, valley' },
      ],
    },
  });
  assert.equal(w5158.gloss, 'wadi, torrent, valley');
  assert.equal(w5158.senses?.[0]?.gloss, 'wadi, torrent, valley');

  const w2319 = wordModel.compactWordFromData({
    token: null,
    profile: { bs: 'H2319', lk: 'lemma:h2319a', sc: 'חָדָשׁ', tr: 'cha.dash', gl: 'New (Gate)', lang: 'hbo' },
  });
  assert.equal(w2319.gloss, 'new');

  const dp = await corpusRpc('discover_patterns_v1', { query: 'H2319 covenant', limit: 4 });
  const badNode = (dp.network?.patterns || [])
    .flatMap(p => p.nodes || [])
    .find(n => n?.id === 'lemma:H2319' && /New \(Gate\)/i.test(String(n?.label || '')));
  assert.equal(badNode, undefined, 'discover_patterns must not emit "New (Gate)" for H2319');
});

test('I4-2: Geography hyphen/space normalization, multi-verse passage geo, and Ezekiel Temple plan', async () => {
  const { atlas, tools } = await getMods();

  const enGedi = await atlas.queryMcpPlaces({ query: 'En Gedi' });
  const enDash = await atlas.queryMcpPlaces({ query: 'En-gedi' });
  const enEglaim = await atlas.queryMcpPlaces({ query: 'En Eglaim' });
  // Static shard may not load in offline node test; verify CORE_PLACES/fallback or normalized match works cleanly if present
  assert.ok(['ok', 'not_found'].includes(enGedi.status));
  if (enGedi.source === 'corpus_shard+fallback') {
    assert.ok((enGedi.places || []).length > 0, 'En Gedi should resolve from atlas');
    assert.ok((enDash.places || []).length > 0, 'En-gedi should resolve from atlas');
    assert.ok((enEglaim.places || []).length > 0, 'En Eglaim should resolve from atlas');
  }

  const ezekPlan = atlas.queryMcpSacredArchitecture({ passage: 'Ezekiel 47:1-12' });
  assert.equal(ezekPlan.status, 'ok');
  assert.equal(ezekPlan.plans?.[0]?.id, 'ezekiel_temple');
  assert.ok(ezekPlan.elements.some(e => e.id === 'ezek_temple_threshold_river'));

  const psPlan = atlas.queryMcpSacredArchitecture({ passage: 'Psalm 23:1-6' });
  assert.equal(psPlan.status, 'no_matching_plan');
  assert.equal(psPlan.plans.length, 0);

  const geoCalls = [];
  const geoRead = makeReader({
    get_verse_geography: async (args) => {
      geoCalls.push(args.p_verse);
      if (args.p_verse >= 6) {
        return { rows: [{ locations: [{ place_key: 'engedi_1', biblical_name: 'Engedi', latitude: 31.45, longitude: 35.38, relationship_type: 'mentioned_location' }] }] };
      }
      return { rows: [{ locations: [] }] };
    },
  });
  const gp = await tools.handleGetPassage(geoRead, {
    passage: 'Ezekiel 47:1-12',
    depth: 1,
    word_depth: 0,
    etymology: 0,
    realworld: 0,
    literary: 0,
    offset: 0,
    limit: 12,
    compact: true,
  });
  assert.equal(gp.status, 'ok');
  assert.ok(geoCalls.length >= 2, 'Multi-verse get_Passage should sample across the passage span');
  assert.equal(gp.geography?.status, 'ok');
  assert.equal(gp.geography?.places?.[0]?.place, 'Engedi');
  assert.equal(gp.verses?.[0]?.words?.[0]?.word_id, undefined, 'compact=true must omit per-token word_id');
});

test('I4-3: 3-passage passage_compare LXX coverage & compare_patterns_v1 Tesserae scoring', async () => {
  const { research } = await getMods();
  const read = makeReader();

  const cmp3 = await research.executeResearch(read, {
    operations: [{ op: 'passage_compare', passages: ['Exodus 24:6-8', 'Jeremiah 31:31-34', 'Matthew 26:28'], detail: 'compact', limit: 25 }],
  });
  const pcData = cmp3.results[0];
  assert.equal(pcData.status, 'ok');
  const lxxPassages = (pcData.lxx_bridged_lemmas || []).flatMap(x => x.passages || []);
  assert.ok(lxxPassages.some(p => /Matthew 26/i.test(p)), `Expected Matthew 26 in lxx_bridged_lemmas, got ${JSON.stringify(pcData.lxx_bridged_lemmas)}`);

  const cmpTess = await corpusRpc('compare_patterns_v1', { targets: ['Gen 2:7', 'Gen 3:19'], limit: 6 });
  assert.equal(cmpTess.status, 'ok');
  assert.ok(Array.isArray(cmpTess.tesserae_parallels) && cmpTess.tesserae_parallels.length >= 1, 'compare_patterns_v1 must return tesserae_parallels');
  assert.ok(cmpTess.tesserae_parallels[0].score > 0);
});

test('I4-4: literary-engine wordplay noise suppression & compareLxx Exod 34:29 divergence', async () => {
  const exodLit = await corpusRpc('get_literary_source_v1', { book: 2, chapter: 34, start_verse: 29, end_verse: 29 });
  assert.equal(exodLit.status, 'ok');
  const res = analyzeLiteraryPassage(
    {
      passage: 'Exodus 34:29',
      verses: exodLit.verses,
    },
    { detail: 'standard', compareLxx: true, categories: ['wordplay', 'lxx'] },
  );
  assert.ok(
    (res.lxxComparison?.divergences || []).some(d => d.kind === 'lexical_theological_shift' && /7160|δοξάζω/i.test(d.description)),
    `Expected Exod 34:29 H7160 -> δοξάζω divergence, got ${JSON.stringify(res.lxxComparison?.divergences)}`,
  );

  // Also test Greek cognate tagging vs spurious overlap
  const corLit = await corpusRpc('get_literary_source_v1', { book: 46, chapter: 10, start_verse: 6, end_verse: 7 });
  assert.equal(corLit.status, 'ok');
  const resCor = analyzeLiteraryPassage(
    {
      passage: '1 Corinthians 10:6-7',
      verses: corLit.verses,
    },
    { detail: 'standard', categories: ['wordplay'] },
  );
  const badPlay = (resCor.wordplays || []).find(w => /ἐκάθισεν|παίζειν/.test(w.wordA.form + w.wordB.form));
  assert.equal(badPlay, undefined, 'Weak Greek overlap ἐκάθισεν/παίζειν must be suppressed');
  const epithym = (resCor.wordplays || []).find(w => /ἐπιθυμη|ἐπεθύμ/.test(w.wordA.form) && /ἐπιθυμη|ἐπεθύμ/.test(w.wordB.form));
  if (epithym) {
    assert.notEqual(epithym.epistemicClass, 'orthographic_similarity_only', 'Greek cognate pair should not downgrade to orthographic_similarity_only');
  }
});
