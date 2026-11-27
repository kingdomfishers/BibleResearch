import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { corpusRpc } from '../../scripts/local-corpus-harness.mjs';
import { analyzeLiteraryPassage } from '../../src/relationships/literary-engine.ts';

function loadChapterVerses(ranges) {
  const bundleDir = path.resolve('.artifacts-r12/staging-bundle/v1/chapters');
  const out = [];
  for (const [book, chapter, startV, endV] of ranges) {
    const ch = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(bundleDir, `b${book}-c${chapter}.json.gz`))));
    out.push(
      ...Object.values(ch.verses)
        .filter(v => v.verse_nr >= startV && v.verse_nr <= endV)
        .sort((a, b) => a.verse_nr - b.verse_nr),
    );
  }
  return out;
}

const zStubSource = `
const fn = () => {};
const zProxy = new Proxy(fn, {
  get(_target, prop) {
    if (prop === 'then' || prop === '__esModule') return undefined;
    if (prop === 'safeParse') return (val) => {
      if (val && typeof val === 'object' && val.op === 'occurrences' && !val.word) {
        return { success: false, error: { issues: [{ path: ['word'], message: 'Required' }] } };
      }
      if (val && typeof val === 'object' && val.op === 'intersect_words' && (!Array.isArray(val.words) || val.words.length < 2)) {
        return { success: false, error: { issues: [{ path: ['words'], message: 'Expected >=2 words' }] } };
      }
      return { success: true, data: val };
    };
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

let cachedToolsMod;
let cachedChainMod;
let cachedWordModelMod;
let cachedResearchMod;

async function getMods() {
  if (!cachedToolsMod) {
    cachedToolsMod = await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts');
    cachedChainMod = await bundleTs('supabase/functions/bible-mcp/chain-evidence.ts');
    cachedWordModelMod = await bundleTs('supabase/functions/bible-mcp/word-model.ts');
    cachedResearchMod = await bundleTs('supabase/functions/bible-mcp/research-engine.ts');
  }
  return {
    tools: cachedToolsMod,
    chain: cachedChainMod,
    wordModel: cachedWordModelMod,
    research: cachedResearchMod,
  };
}

test('Step 3: Greek medial-sigma & transliteration fallbacks resolve via corpus lookup', async () => {
  const karpos = await corpusRpc('resolve_fast_lookup_v1', { query: 'καρπός', limit: 5 });
  assert.ok((karpos.matches || []).some(m => m.bs === 'G2590'), 'καρπός must resolve G2590');

  const logos = await corpusRpc('resolve_fast_lookup_v1', { query: 'λόγος', limit: 5 });
  assert.ok((logos.matches || []).some(m => m.bs === 'G3056'), 'λόγος must resolve G3056');

  const melek = await corpusRpc('resolve_fast_lookup_v1', { query: 'melek', limit: 8 });
  assert.equal(melek.matches?.[0]?.bs, 'H4428', 'melek must rank Hebrew king lemma H4428 first');

  const tsadiq = await corpusRpc('resolve_fast_lookup_v1', { query: 'tsadiq', limit: 5 });
  assert.ok((tsadiq.matches || []).some(m => m.bs === 'H6662'), 'tsadiq must resolve H6662');

  const thoughts = await corpusRpc('resolve_fast_lookup_v1', { query: 'thoughts', limit: 8 });
  assert.notEqual(thoughts.matches?.[0]?.bs, 'G3361', 'thoughts must not rank G3361 ("not") first');
  assert.ok((thoughts.matches || []).some(m => m.bs === 'H4284' || m.bs === 'H4609' || m.bs === 'G3540'));

  const tree = await corpusRpc('resolve_fast_lookup_v1', { query: 'tree', limit: 8 });
  assert.equal(tree.matches?.[0]?.bs, 'H6086', 'tree should rank H6086 (289 vv) first');
});

test('Step 2 & 4A: negative controls block melach/melek & Hagar/Ekron/forty false links', async () => {
  const read = makeReader();
  const { tools } = await getMods();

  const conn = await tools.handleGetConnection(read, ['melach', 'melek'], 10);
  assert.equal(conn.direct_link_found, false, 'orthographic overlap melach/melek must not set direct_link_found');

  const h4417 = await tools.buildFullCompactWord(read, 'H4417', { connections: 6, etymology: 0, realworld: 0 });
  const h4417Titles = (h4417.occurrences?.clusters || []).map(c => `${c.category || ''} ${c.label || ''}`).join(' ');
  assert.doesNotMatch(h4417Titles, /temple_and_sanctuary_architecture/, 'H4417 Salt Sea cluster must not be mislabeled temple/sanctuary');

  const dp = await corpusRpc('discover_patterns_v1', { query: 'Hagar Ekron forty', limit: 8 });
  assert.equal(dp.status, 'ok');
  assert.ok(dp.network && typeof dp.network.pattern_count === 'number', 'empty discover_patterns must still include network');
});

test('Step 2 & 4A: chainEvidenceTarget, buildWordEtymology, homographs, and r13:motif prefix', async () => {
  const read = makeReader();
  const { tools, chain, wordModel } = await getMods();

  const target = chain.chainEvidenceTarget(
    {
      id: 'lex:H8247:H8246',
      relation: 'shares_root',
      epistemic: 'documented_lexical_relationship',
      refs: ['Jer 1:11'],
      target: { strongs: 'H8246' },
    },
    'H8247',
  );
  assert.equal(target, 'H8246', 'lexical chain edge should traverse to target strongs rather than stalling on sample ref');

  const et = await wordModel.buildWordEtymology(
    read,
    'H8247',
    {
      bs: 'H8247',
      lexical_relations: [
        { type: 'shared_name_base', target_strongs: 'H0001', script: 'אב', gloss: 'father' },
        { type: 'derived_from_root_anchor', target_strongs: 'H8245', script: 'שקד', gloss: 'watch', root: 'שקד' },
      ],
    },
    5,
    {},
  );
  assert.equal(et.status, 'documented');
  assert.ok(et.relatives.some(r => r.strongs === 'H8245'), 'should include documented relative from profile fallback');
  assert.ok(!et.relatives.some(r => r.strongs === 'H0001'), 'should exclude shared_name_base from relatives');

  const rw = await wordModel.buildWordRealworld(
    read,
    'H8247',
    'almond',
    null,
    {
      pilot_bridges: [
        { property_key: 'biological_bloom', value_label: 'early_spring', target_strongs: 'H8245' },
        { property_key: 'biological_bloom', value_label: 'early_spring', target_strongs: 'H8245' },
      ],
    },
  );
  assert.equal(rw.property_bridges.length, 1, 'duplicate property_bridges must be deduplicated');

  const gen1Pass = await tools.handleGetPassage(read, {
    passage: 'Gen 1:1',
    depth: 2,
    word_depth: 0,
    etymology: 0,
    realworld: 0,
    literary: 0,
    offset: 0,
    limit: 5,
  });
  const bara = gen1Pass.lexicon?.H1254;
  assert.ok(bara && !/to be fat/i.test(String(bara.gloss || '')), 'H1254 create in Gen 1:1 must not show H1254c "to be fat"');
});

test('Step 2: literary-engine Rev 2-3 reordering & Zech 4 wordplay false positive guard', () => {
  const revVerses = loadChapterVerses([[66, 2, 1, 29], [66, 3, 1, 22]]);
  const revRes = analyzeLiteraryPassage({ passage: 'Rev 2-3', verses: revVerses }, { detail: 'compact' });
  assert.ok(
    revRes.deviations.slice(0, 12).some(d => d.kind === 'reordering'),
    'Rev 2-3 compact deviations top 12 should include the 3+4 reordering flip',
  );

  const zechVerses = loadChapterVerses([[38, 4, 1, 14]]);
  const zechRes = analyzeLiteraryPassage({ passage: 'Zech 4', verses: zechVerses }, { detail: 'compact' });
  assert.equal(
    zechRes.wordplays.filter(w => w.kind === 'attested_textual_wordplay').length,
    0,
    'Zech 4 should not emit false attested_textual_wordplay on generic tokens',
  );

  const isaVerses = loadChapterVerses([[23, 55, 8, 13]]);
  const isaRes = analyzeLiteraryPassage({ passage: 'Isa 55:8-13', verses: isaVerses }, { detail: 'compact' });
  assert.ok(
    !isaRes.symmetries.some(s => /נְאֻם/.test(`${s.leftText || ''} ${s.rightText || ''}`)),
    'Isa 55:8-13 symmetries should not match oracle formula tag נְאֻם יְהוָה',
  );
});

test('Step 4B: research batch per-op isolation, aliases, and high-freq intersection H7637+H3117', async () => {
  const read = makeReader();
  const { research } = await getMods();

  const res = await research.executeResearch(read, {
    operations: [
      { op: 'occurrences', id: 'bad_op' },
      { op: 'intersect_words', id: 'days_7th', terms: ['H7637', 'H3117'], limit: 5 },
      { op: 'evidence', id: 'proof_op', evidence_id: 'r13:proof:direct_pair:H8247+H8245' },
      { op: 'numbers', id: 'seven_num', number: 7 },
    ],
  });

  assert.equal(res.status, 'ok');
  assert.equal(res.results[0].status, 'invalid_request', 'bad sibling op must isolate to invalid_request');
  assert.equal(res.results[1].status, 'ok', 'intersect_words H7637+H3117 via terms alias must succeed');
  assert.ok(res.results[1].total_matches > 0, 'H7637+H3117 intersection must be non-empty');
  assert.equal(res.results[2].status, 'ok', 'r13:proof:* evidence resolution must return structured summary');
  assert.equal(res.results[3].status, 'ok');
  assert.ok((res.results[3].number_profiles || []).length > 0, 'numbers(7) must include number_profiles');
});
