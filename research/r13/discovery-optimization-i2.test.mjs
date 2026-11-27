import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { corpusRpc } from '../../scripts/local-corpus-harness.mjs';
import { analyzeLiteraryPassage } from '../../src/relationships/literary-engine.ts';
import { loadLiteraryVersesFromPack } from '../../src/relationships/literary-pack-loader.ts';

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
    if (extraHandlers[name]) {
      return await extraHandlers[name](args);
    }
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

test('I2-1: Literary pack artifacts exist under 25 MiB and literary engine runs on Gen 1 and Zech 3', async () => {
  const litDir = path.resolve('.artifacts/v2/literary');
  assert.ok(fs.existsSync(path.join(litDir, 'index.json')), 'index.json must exist in .artifacts/v2/literary');
  const packs = fs.readdirSync(litDir).filter(f => f.endsWith('.json') || f.endsWith('.bin'));
  assert.ok(packs.length >= 60, `Expected >=60 literary files, got ${packs.length}`);
  for (const f of packs) {
    const size = fs.statSync(path.join(litDir, f)).size;
    assert.ok(size < 25 * 1024 * 1024, `${f} exceeds 25 MiB Cloudflare limit`);
  }

  const zechCh = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.resolve('.artifacts-r12/staging-bundle/v1/chapters/b38-c3.json.gz'))));
  const zechVerses = Object.values(zechCh.verses).filter(v => v.verse_nr >= 1 && v.verse_nr <= 10).sort((a, b) => a.verse_nr - b.verse_nr);
  const analysis = analyzeLiteraryPassage({ passage: 'Zechariah 3:1-10', verses: zechVerses, truncated: false }, { detail: 'compact' });
  assert.ok(analysis && typeof analysis === 'object');

  const localPackFetcher = async (url, init = {}) => {
    const fileName = url.split('/').pop();
    const buf = fs.readFileSync(path.join(litDir, fileName));
    const rangeHdr = init.headers?.Range || init.headers?.range;
    if (rangeHdr) {
      const m = /bytes=(\d+)-(\d+)/.exec(rangeHdr);
      const start = Number(m[1]);
      const end = Number(m[2]);
      return new Response(buf.subarray(start, end + 1), { status: 206 });
    }
    return new Response(buf, { status: 200 });
  };
  const { verses: genVerses } = await loadLiteraryVersesFromPack(
    'https://local.test/v2/literary',
    [{ book: 1, chapter: 1, start_verse: 1, end_verse: 31 }, { book: 1, chapter: 2, start_verse: 1, end_verse: 3 }],
    localPackFetcher,
  );
  assert.equal(genVerses.length, 34, 'Gen 1:1-2:3 pack range fetch must load 34 verses');
  const genLit = analyzeLiteraryPassage({ passage: 'Gen 1:1-2:3', verses: genVerses, truncated: false }, { detail: 'compact' });
  assert.ok(genLit && genLit.segmentation?.units?.length >= 6, 'Gen 1:1-2:3 must detect >=6 structural units');
});

test('I2-2: LXX Swete canonical book routing (Zacharias/Isaias), NT rejection, and Hebrew profile fallback', async () => {
  const { research } = await getMods();
  const read = makeReader();

  const zechOut = await research.executeResearch(read, {
    operations: [{ op: 'lxx', passage: 'Zechariah 3:1-2', mode: 'passage', limit: 5 }],
  });
  const zechStep = zechOut.results[0];
  assert.equal(zechStep.status, 'ok');
  assert.match(JSON.stringify(zechStep), /Zacharias/i, 'Zechariah 3 must map to Swete Zacharias (not Michaeas)');

  const isaOut = await research.executeResearch(read, {
    operations: [{ op: 'lxx', passage: 'Isaiah 53:1-3', mode: 'passage', limit: 5 }],
  });
  assert.match(JSON.stringify(isaOut.results[0]), /Isaias|Isaiah/i, 'Isaiah must map to Swete Isaias');

  const ntOut = await research.executeResearch(read, {
    operations: [{ op: 'lxx', passage: 'Romans 3:23', mode: 'passage', limit: 5 }],
  });
  assert.equal(ntOut.results[0].status, 'invalid_request');

  const hebWordOut = await research.executeResearch(read, {
    operations: [{ op: 'lxx', word: 'H5301', limit: 5 }],
  });
  assert.equal(hebWordOut.results[0].status, 'ok', 'H5301 Hebrew word LXX query should fall back cleanly to profile lxx_relations');
});

test('I2-3: Begadkefat dabar, thoughts priority, 40 numeral separation (no G4722), H4417M sense & no salt/beam leak', async () => {
  const read = makeReader();
  const { tools, research } = await getMods();

  const dabar = await corpusRpc('resolve_fast_lookup_v1', { query: 'dabar', limit: 5 });
  assert.ok((dabar.matches || []).some(m => m.bs === 'H1697'), 'dabar must resolve H1697 via b->v');

  const thought = await corpusRpc('resolve_fast_lookup_v1', { query: 'thought', limit: 6 });
  assert.ok(['H4284', 'H2803', 'G3540', 'G1261', 'G3053'].includes(thought.matches?.[0]?.bs), `Unexpected #1 for thought: ${thought.matches?.[0]?.bs}`);

  const fortyLookup = await corpusRpc('resolve_fast_lookup_v1', { query: '40', limit: 8 });
  assert.ok((fortyLookup.matches || []).some(m => m.bs === 'H0705' || m.bs === 'G5062'));
  assert.ok(!(fortyLookup.matches || []).some(m => m.bs === 'G4722'), 'lookup("40") must never return G4722');

  const numRes = await research.executeResearch(read, {
    operations: [{ op: 'numbers', number: 40, limit: 8 }],
  });
  assert.equal(numRes.results[0].status, 'ok');
  assert.doesNotMatch(JSON.stringify(numRes.results[0]), /\bG4722\b/, 'numbers(40) must not emit G4722');

  const connSalt = await tools.handleGetConnection(read, ['melach', 'melek'], 10);
  const connJson = JSON.stringify(connSalt);
  assert.equal(connSalt.direct_link_found, false);
  assert.doesNotMatch(connJson, /r11:cluster:H4417:temple_and_sanctuary_architecture/, 'salt/sanctuary cluster must not leak');
  assert.doesNotMatch(connJson, /"evidence_id":"r13:beam:[^"]+"[^}]*"epistemic_class":"shared_motif_evidence"/, 'pure edit_distance_1 beam must not claim shared_motif_evidence');
  if (Array.isArray(connSalt.individual_suggestions)) {
    assert.ok(connSalt.individual_suggestions.length <= 3, 'disconnected individual_suggestions should be slimmed to <= 3');
  }

  const h4417m = await tools.buildFullCompactWord(read, 'H4417M', { connections: 4, etymology: 0, realworld: 0 });
  assert.equal(h4417m.word?.strongs, 'H4417');
  assert.match(String(h4417m.word?.gloss || ''), /salt/i, 'H4417M must select the salt sense');
});

test('I2-4: Etymology guards (H4519/G3056/G2786/H1818/undefined relatives), R10 H7363 fix, and 3500ms PostgREST timeout', async () => {
  const { wordModel, tools } = await getMods();

  const slowRead = makeReader({
    get_word_formation_v1: () => new Promise(resolve => setTimeout(() => resolve({ rows: [] }), 6500)),
    suggest_orthographic_candidates_v1: () => new Promise(resolve => setTimeout(() => resolve({ rows: [] }), 6500)),
    get_verse_geography: () => new Promise(resolve => setTimeout(() => resolve({ rows: [] }), 6500)),
    get_verse_chronology_v1: () => new Promise(resolve => setTimeout(() => resolve({ rows: [] }), 6500)),
    get_notes_for_passage_v1: () => new Promise(resolve => setTimeout(() => resolve({ rows: [] }), 6500)),
    get_words_batch: () => new Promise(resolve => setTimeout(() => resolve({ rows: [] }), 6500)),
    query_chronology_assertions_batch: () => new Promise(resolve => setTimeout(() => resolve({ rows: [] }), 6500)),
  });

  const tEtym0 = Date.now();
  const etymSlow = await wordModel.buildWordEtymology(slowRead, 'H4872', { bs: 'H4872', sc: 'מֹשֶׁה', gl: 'Moses', entity_kind: 'proper_person' }, 5);
  const etymElapsed = Date.now() - tEtym0;
  assert.ok(etymElapsed < 2800, `Expected buildWordEtymology <=2800ms bound, took ${etymElapsed}ms`);
  assert.match(etymSlow.note, /narrative paronomasia/i);

  const tPass0 = Date.now();
  const pSlow = await tools.handleGetPassage(slowRead, { passage: 'Gen 1:1-2', depth: 0, limit: 2, offset: 0, literary: 0 });
  const passElapsed = Date.now() - tPass0;
  assert.equal(pSlow.status, 'ok');
  assert.ok(passElapsed < 5800, `Expected handleGetPassage <=5800ms bound, took ${passElapsed}ms`);

  const mockFormRead = makeReader({
    get_word_formation_v1: async () => ({
      rows: [{
        matched_lemmas: [{ lemma_key: 'lemma:H4872', primary_gloss: 'Moses' }],
        documented_roots: [{ lemma_key: 'lemma:H4872', root_key: 'r:moshe', root_script: 'משׁה', relation_type: 'shared_root' }],
        root_relatives: [
          { root_key: 'r:moshe', base_strongs: 'H4519', lemma_script: 'מְנַשֶּׁה', primary_gloss: 'Moses', relation_type: 'shared_root' },
          { root_key: 'r:moshe', base_strongs: 'G0129', lemma_script: '', primary_gloss: '' },
          { root_key: 'r:moshe', base_strongs: 'G4826', lemma_script: 'Σίμων', primary_gloss: 'Simon', relation_type: 'spelling_variant_of' },
        ],
      }],
    }),
  });
  const etymMoses = await wordModel.buildWordEtymology(mockFormRead, 'H4872', { bs: 'H4872', sc: 'מֹשֶׁה', gl: 'Moses' }, 10);
  const h4519 = etymMoses.relatives.find(r => r.base_strongs === 'H4519');
  assert.equal(h4519?.primary_gloss, 'Manasseh', 'H4519 must not inherit gloss "Moses"');
  assert.ok(!etymMoses.relatives.some(r => r.base_strongs === 'G0129'), 'undefined/empty relative script must be filtered');
  const simon = etymMoses.relatives.find(r => r.base_strongs === 'G4826');
  assert.equal(simon?.relation_type, 'co_referential_or_related_name', 'disjoint-consonant names must not be labeled spelling_variant_of');

  const logosEtym = await wordModel.buildWordEtymology(makeReader(), 'G3056', {
    bs: 'G3056',
    sc: 'λόγος',
    gl: 'word',
    lexical_relations: [{ target_strongs: 'G0356', script: 'ἀναλογία', gloss: 'proportion', type: 'derived_from' }],
  }, 10);
  const analogia = logosEtym.relatives.find(r => r.strongs === 'G0356');
  assert.equal(analogia?.relation_type, 'related_compound_or_cognate', 'simplex G3056 must not be marked derived_from compound G0356');

  const genEv = await corpusRpc('get_connection_evidence_v1', { evidence_id: 'r10:corresp:gen1_2_gen8_1_ruach_water_wind' });
  const h7363Word = (genEv?.record?.original_words || genEv?.original_words || []).find(w => w.strongs === 'H7363');
  if (h7363Word) {
    assert.doesNotMatch(String(h7363Word.gloss || ''), /weak/i, 'H7363 on Gen 1:2/8:1 correspondence must not say "weak"');
  }
});

test('I2-5: Intersect testament filter, grammar multi-predicate parallel search, geography exact rank, and chain safety', async () => {
  const { research, tools } = await getMods();
  const read = makeReader({
    query_places_by_name: async () => ({
      rows: [
        { modern_name: 'Beth-eden', ancient_name: 'Beth-eden', verse_count: 10 },
        { modern_name: 'Eden', ancient_name: 'Eden', verse_count: 20 },
      ],
    }),
  });

  const inter = await research.executeResearch(read, {
    operations: [{ op: 'intersect_words', words: ['G0129', 'G1093'], testament: 'NT', limit: 5 }],
  });
  assert.equal(inter.results[0].status, 'ok');
  assert.ok((inter.results[0].total_matches || 0) >= 1);

  const gram = await research.executeResearch(read, {
    operations: [{ op: 'grammar_search', word: 'G0129', predicates: ['agent', 'patient'], limit: 6 }],
  });
  assert.equal(gram.results[0].status, 'ok');
  assert.deepEqual(gram.results[0].predicates, ['agent_of', 'patient']);

  const geo = await research.executeResearch(read, {
    operations: [{ op: 'geography_search', place: 'Eden', limit: 5 }],
  });
  assert.equal(geo.results[0].places?.[0]?.place, 'Eden', 'Exact geography match must outrank substring Beth-eden');

  const zechConn = await tools.handleGetConnection(read, ['Zechariah 3:1-5', 'H0899'], 5);
  const bagad = zechConn.items?.[0]?.key_lemmas?.find(l => l.strongs === 'H0899');
  if (bagad) {
    assert.doesNotMatch(bagad.gloss, /treachery/i, 'Contextual gloss for H0899 in Zech 3 must not leak "treachery"');
  }

  // follow_connectionchain next string guarantee + sparse node neighbor fallback
  const chainMap = new Map();
  let seq = 1;
  const chainStore = {
    async create(st) {
      const h = `chain_test_${seq++}_${'x'.repeat(12)}`;
      chainMap.set(h, { ...st, chain: h, expires_at: '2099-01-01T00:00:00Z' });
      return { ok: true, handle: h, state: chainMap.get(h) };
    },
    async load(h) {
      return chainMap.has(h) ? { ok: true, state: chainMap.get(h) } : { ok: false, error: 'not_found', message: 'missing' };
    },
    async update(h, st) {
      chainMap.set(h, { ...st, chain: h, expires_at: '2099-01-01T00:00:00Z' });
      return { ok: true, state: chainMap.get(h) };
    },
  };
  const server = tools.createDiscoveryV2Server(read, null, chainStore);
  const followTool = server.tools.get('follow_connectionchain');
  assert.ok(followTool, 'follow_connectionchain tool must be registered');

  const started = await followTool.handler({ next: 'Hagar', limit: 5 }, {});
  const startPayload = JSON.parse(started.content[0].text);
  assert.equal(startPayload.status, 'ok');
  assert.ok(Array.isArray(startPayload.next_connections) && startPayload.next_connections.length > 0, 'Hagar should yield fallback neighbors');
  for (const nc of startPayload.next_connections) {
    assert.equal(typeof nc.next, 'string', 'Every next_connections entry must expose string .next');
    assert.ok(nc.next.length > 0);
  }
  const autoFollow = await followTool.handler({ action: 'follow', chain: startPayload.chain, limit: 5 }, {});
  const followPayload = JSON.parse(autoFollow.content[0].text);
  assert.equal(followPayload.status, 'ok', 'follow without explicit next should auto-advance via top active_candidate');
});
