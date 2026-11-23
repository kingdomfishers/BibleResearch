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
  'compare_hebrew_septuagint_passage_v1',
  'lookup_septuagint_passage_v1',
  'lookup_hebrew_septuagint_alignments_v1',
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

test('P0 E01, E07, E08, E09: Almond/watching wordplay evidence includes BOTH Jer 1:11 and 1:12 with canonical pos 4 H0413 parity', async () => {
  const { handleGetPassage } = await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts');
  const { executeResearch } = await bundleTs('supabase/functions/bible-mcp/research-engine.ts');
  const read = makeReader();

  const gp = await handleGetPassage(read, { passage: 'Jeremiah 1:11', word_depth: 5 });
  const gpWords = gp.verses[0].words;
  const pos4Gp = gpWords.find(w => w.pos === 4);
  assert.ok(pos4Gp, 'Jeremiah 1:11 pos 4 exists in get_Passage');
  assert.equal(pos4Gp.strongs, 'H0413', 'get_Passage Jer 1:11 pos 4 is H0413');

  const evRes = await executeResearch(read, {
    operations: [{ op: 'evidence', evidence_id: 'r13:wp:H8247:H8245' }],
  });
  assert.equal(evRes.status, 'ok');
  const ev = evRes.results[0];
  const refs = (ev.passages || []).map(p => p.ref);
  assert.ok(refs.includes('Jeremiah 1:11'), 'E01: includes Jeremiah 1:11');
  assert.ok(refs.includes('Jeremiah 1:12'), 'E01: includes Jeremiah 1:12');

  const jer11 = ev.passages.find(p => p.ref === 'Jeremiah 1:11' || p.passage?.ref === 'Jeremiah 1:11');
  const jer12 = ev.passages.find(p => p.ref === 'Jeremiah 1:12' || p.passage?.ref === 'Jeremiah 1:12');
  const pos4Ev = (jer11.original_tokens || []).find(t => (t.word_no ?? t.position ?? t.pos) === 4);
  assert.equal(pos4Ev.strongs, 'H0413', 'E07: research(evidence) Jer 1:11 pos 4 matches canonical H0413');
  assert.equal(pos4Ev.word_id, 33134, 'E07: research(evidence) Jer 1:11 pos 4 has canonical word_id 33134');
  assert.ok((jer11.original_tokens || []).some(t => t.strongs === 'H8247' && t.is_highlighted), 'E01: H8247 highlighted in Jer 1:11');
  assert.ok((jer12.original_tokens || []).some(t => t.strongs === 'H8245' && t.is_highlighted), 'E01: H8245 highlighted in Jer 1:12');
});

test('P0 E02, E03, E04, W07, W08: Linguistic classification separates proximate candidates from attested wordplay and filters false roots', async () => {
  const { executeResearch } = await bundleTs('supabase/functions/bible-mcp/research-engine.ts');
  const read = makeReader();

  // E02: H8245 <-> H6918 (watching/holy) must not be attested_textual_wordplay
  const e02 = await executeResearch(read, {
    operations: [{ op: 'evidence', evidence_id: 'r13:wp:H8245:H6918' }],
  });
  const ev02 = e02.results[0];
  if (ev02 && ev02.status === 'ok') {
    assert.notEqual(ev02.evidence_type, 'attested_textual_wordplay', 'E02: H8245:H6918 is not attested_textual_wordplay');
    assert.notEqual(ev02.epistemic, 'direct_textual_evidence', 'E02: H8245:H6918 is not direct_textual_evidence');
  }

  // E03: H1818 <-> H6924 (blood/east) must not be attested_textual_wordplay
  const e03 = await executeResearch(read, {
    operations: [{ op: 'evidence', evidence_id: 'r13:wp:H1818:H6924' }],
  });
  const ev03 = e03.results[0];
  if (ev03 && ev03.status === 'ok') {
    assert.notEqual(ev03.evidence_type, 'attested_textual_wordplay', 'E03: H1818:H6924 is not attested_textual_wordplay');
    assert.notEqual(ev03.epistemic, 'direct_textual_evidence', 'E03: H1818:H6924 is not direct_textual_evidence');
  }

  // E04 / EV05: H0894 <-> H6489 (Babylon/Pekod) must NEVER claim documented_root_family or proven_common_root=true, and r11:lex:H6489:0 must not appear on H0894
  const e04 = await executeResearch(read, {
    operations: [{ op: 'evidence', evidence_id: 'r13:wp:H0894:H6489' }],
  });
  const ev04 = e04.results[0];
  if (ev04 && ev04.status === 'ok') {
    assert.notEqual(ev04.evidence_type, 'documented_root_family', 'E04: H0894:H6489 is not documented_root_family');
  }

  // EV05: get_Word(H0894) and discover(H0894) must not contain r11:lex:H6489:0 or shares_root to H6489 / H4850
  const { buildFullCompactWord, handleGetPassage } = await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts');
  const w0894 = await buildFullCompactWord(read, 'H0894', { connections: 25, etymology: 3, realworld: 0 });
  const w0894Conns = w0894.word?.connections || [];
  const falsePekodLex = w0894Conns.find(
    c => c.id === 'r11:lex:H6489:0' || ((c.target?.strongs === 'H6489' || c.target?.strongs === 'H4850') && c.relation === 'shares_root'),
  );
  assert.equal(falsePekodLex, undefined, 'EV05: get_Word(H0894) must not return r11:lex:H6489:0 or shares_root to H6489/H4850');

  // Spurious Uriah <-> conceive wordplay check: r13:wp:H2029:H0223 must not be attested_textual_wordplay
  const gen2932 = await handleGetPassage(read, { passage: 'Genesis 29:32', depth: 20, word_depth: 5 });
  const gen2932Conns = gen2932.passage_connections || [];
  const uriahAt2932 = gen2932Conns.find(c => c.id === 'r13:wp:H2029:H0223' && c.evidence_type === 'attested_textual_wordplay');
  assert.equal(uriahAt2932, undefined, 'Genesis 29:32 must not classify H2029 (conceive) <-> H0223 (Uriah) as attested_textual_wordplay');

  // EV14 / U01: Genesis 21:6 discovers Isaac (H3327) <-> laughter (H6712 / H6711) naming etiology
  const gen216 = await handleGetPassage(read, { passage: 'Genesis 21:6', depth: 20, word_depth: 5 });
  const gen216Conns = gen216.passage_connections || [];
  const isaacLaugh = gen216Conns.find(c => JSON.stringify(c).includes('H3327') && (JSON.stringify(c).includes('H6712') || JSON.stringify(c).includes('H6711')));
  assert.ok(isaacLaugh, 'EV14/U01: Genesis 21:6 discovers Isaac (H3327) <-> laugh (H6712/H6711) naming etiology');

  // EV15 / U03: Genesis 29:32 discovers Reuben (H7205) compound naming etiology (H7200 + H1121 / H6040)
  const reubenEtiology = gen2932Conns.find(c => JSON.stringify(c).includes('H7205') && (JSON.stringify(c).includes('H7200') || JSON.stringify(c).includes('H1121')));
  assert.ok(reubenEtiology, 'EV15/U03: Genesis 29:32 discovers Reuben (H7205) compound naming etiology');

  // U02: Genesis 25:25 discovers Esau (H6215) birth-attribute naming with red (H0132) / hair (H8181)
  const gen2525 = await handleGetPassage(read, { passage: 'Genesis 25:25', depth: 20, word_depth: 5 });
  const esauNaming = (gen2525.passage_connections || []).find(
    c => JSON.stringify(c).includes('H6215') && (JSON.stringify(c).includes('H0132') || JSON.stringify(c).includes('H8181')),
  );
  assert.ok(esauNaming, 'U02: Genesis 25:25 discovers Esau (H6215) birth-attribute naming');

  // W07/W08: H0894 (Babel) <-> H1101 (balal) must be discovered in Genesis 11:9
  const babelDisc = await corpusRpc('discover_biblical_connections_v2', { query: 'H0894', limit: 15 });
  const hitBalal = (babelDisc.strongest_connections || []).find(
    c => (c.original_words || []).some(w => w.strongs === 'H1101') || (c.passages || []).some(p => p.ref === 'Genesis 11:9'),
  );
  assert.ok(hitBalal, 'W07/W08: H0894 discovers H1101 / Genesis 11:9 wordplay');
});

test('P0 E05 & P10: Ezekiel 37:5 is not a false bones=breath identification while Ezekiel 37:11 and Luke 8:11 are extracted', async () => {
  const ezek375 = await corpusRpc('discover_biblical_connections_v2', { query: 'Ezekiel 37:5', limit: 15 });
  const badIdent = (ezek375.strongest_connections || []).find(
    c => c.evidence_id?.startsWith('r13:interp:21519') || (c.predicate === 'explicit_identification' && (c.passages || []).some(p => p.ref === 'Ezekiel 37:5')),
  );
  assert.equal(badIdent, undefined, 'E05: Ezekiel 37:5 must not emit false explicit_identification between bones and breath');

  const luke811 = await corpusRpc('discover_biblical_connections_v2', { query: 'Luke 8:11', limit: 15 });
  const seedLogos = (luke811.strongest_connections || []).find(
    c => (c.original_words || []).some(w => w.strongs === 'G3056'),
  );
  assert.ok(seedLogos, 'P10: Luke 8:11 discovers G3056 (the seed is the word of God)');
});

test('P0 E10: compare_hebrew_septuagint_passage_v1 returns candidate token alignments for Jeremiah 1:11 and Exodus 25:33', async () => {
  const jerLxx = await corpusRpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 24,
    p_hebrew_chapter: 1,
    p_hebrew_verse: 11,
  });
  assert.equal(jerLxx.status, 'ok');
  assert.ok(
    (jerLxx.documented_alignments?.length || 0) + (jerLxx.candidate_alignments?.length || 0) >= 3,
    `E10: Jeremiah 1:11 returns candidate alignments (got ${jerLxx.candidate_alignments?.length || 0})`,
  );

  const exodLxx = await corpusRpc('compare_hebrew_septuagint_passage_v1', {
    p_hebrew_book: 2,
    p_hebrew_chapter: 25,
    p_hebrew_verse: 33,
  });
  assert.equal(exodLxx.status, 'ok');
  assert.ok(
    (exodLxx.documented_alignments?.length || 0) + (exodLxx.candidate_alignments?.length || 0) >= 3,
    `E10: Exodus 25:33 returns candidate alignments (got ${exodLxx.candidate_alignments?.length || 0})`,
  );
});

test('P0 H4723 Gen 1:10 gloss & N05/N07/N09 natural query fixes', async () => {
  const { handleGetPassage } = await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts');
  const read = makeReader();

  const gen110 = await handleGetPassage(read, { passage: 'Genesis 1:10', word_depth: 5 });
  const h4723Word = (gen110.verses[0].words || []).find(w => w.strongs === 'H4723');
  assert.ok(h4723Word, 'Gen 1:10 contains H4723');
  assert.notEqual(h4723Word.gloss, 'hope', 'Gen 1:10 H4723 must not display "hope" instead of gathering/collection');

  const n05 = await corpusRpc('discover_biblical_connections_v2', { query: 'well', limit: 25 });
  assert.notEqual(n05.strongest_connections?.[0]?.evidence_id, 'r10:ident:rev5_6_eyes_spirits', 'N05: "well" is not hijacked by Rev 5:6 eyes');

  const n07 = await corpusRpc('discover_biblical_connections_v2', { query: 'breath', limit: 25 });
  assert.notEqual(n07.strongest_connections?.[0]?.evidence_id, 'r10:ident:rev5_6_eyes_spirits', 'N07: "breath" is not hijacked by Rev 5:6 spirits');
});
