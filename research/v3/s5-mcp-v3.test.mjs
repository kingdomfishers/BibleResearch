// Gate G5 Verification Suite for Stage S5 (MCP v3 Progressive Experience):
// M1: get_Passage progressive "clues" (<8 KB wire, expand_id, zero structured duplicate) + expand_clue hydration
// M2: Zero-stub vowel-aware get_Word (pyroo, בֹּר, שַׁיִת, furnace multi-match, H4417 realworld, ἄχρηστος vs Χριστός, Also: hygiene)
// M3: research lxx_concordance & tri_textual_diff (MT <-> Rahlfs LXX <-> NT Halo-SW)
// M4: research clause_role_query, sequence_parallels, wordplay_scan (talion + onomastic + NEG rejection)
// M5: research set_combine (BMW bitset), intersect_words (compound English), trace_evidence (passage ref), get_Connection ("clues")
// M6: follow_connectionchain (next_id, axis_filter, <8 KB "clues" view, expand_id)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { localCorpusFetcher } from '../../scripts/local-corpus-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const RESTRICTED_KEYS = new Set([
  'gated_fields',
  'semantic_frame',
  'frame',
  'greekstrong',
  'sdbh',
  'lexdomain',
  'coredomain',
  'contextualdomain',
  'ln',
  'field_name',
]);

function assertNoRestrictedKeys(val, p = '') {
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) assertNoRestrictedKeys(val[i], `${p}[${i}]`);
  } else if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      assert.ok(!RESTRICTED_KEYS.has(k), `Restricted UBS key "${k}" leaked at ${p}.${k}`);
      if (v && typeof v === 'object') assertNoRestrictedKeys(v, `${p}.${k}`);
    }
  }
}

let appPromise;
async function getLocalMcpApp() {
  if (!appPromise) {
    appPromise = (async () => {
      await import(`file:///${path.join(ROOT, 'scripts/mcp-deno-loader.mjs').replace(/\\/g, '/')}`);
      const tmpOut = path.join(ROOT, '.artifacts-r12', 'tmp-s5-mcp-test.mjs');
      fs.mkdirSync(path.dirname(tmpOut), { recursive: true });
      await esbuild.build({
        entryPoints: [path.join(ROOT, 'supabase/functions/bible-mcp/index.ts')],
        bundle: true,
        write: true,
        outfile: tmpOut,
        format: 'esm',
        platform: 'neutral',
        mainFields: ['module', 'main'],
        external: ['@modelcontextprotocol/server', '@modelcontextprotocol/core', 'zod'],
      });
      const mod = await import(`file:///${tmpOut.replace(/\\/g, '/')}?t=${Date.now()}`);
      const literaryRoot = path.join(ROOT, '.artifacts', 'v2', 'literary');
      const fetcher = localCorpusFetcher(async (url) => {
        if (url.pathname.startsWith('/v2/literary/')) {
          const rel = url.pathname.slice('/v2/literary/'.length);
          const fp = path.join(literaryRoot, rel);
          if (fp.startsWith(literaryRoot) && fs.existsSync(fp)) {
            return new Response(fs.readFileSync(fp), { status: 200 });
          }
          return new Response('not found', { status: 404 });
        }
        return Response.json([]);
      });
      return mod.createApp(
        { url: 'https://ejoperxiwxlcbsqrkrvb.supabase.co', publicKey: 'sb_publishable_local_stub', corpusUrl: 'https://corpus.test' },
        fetcher,
      );
    })();
  }
  return appPromise;
}

let reqSeq = 0;
async function callMcpTool(name, args) {
  const app = await getLocalMcpApp();
  const id = ++reqSeq;
  const resp = await app(new Request('https://local.mcp/functions/v1/bible-mcp/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const rawText = await resp.text();
  const wireBytes = Buffer.byteLength(rawText, 'utf8');
  const contentType = resp.headers.get('content-type') || 'application/json';
  const packet = contentType.includes('text/event-stream')
    ? rawText.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(p => p.id === id)
    : JSON.parse(rawText);
  assert.ok(packet && !packet.error, `JSON-RPC error on ${name}: ${rawText.slice(0, 300)}`);
  const result = packet.result;
  assert.ok(!result.isError, `Tool ${name} returned isError: ${result?.content?.[0]?.text}`);
  const hasStructuredDuplicate = result.structuredContent !== undefined;
  const data = JSON.parse(result.content[0].text);
  assertNoRestrictedKeys(data, name);
  return { wireBytes, payloadBytes: Buffer.byteLength(result.content[0].text, 'utf8'), hasStructuredDuplicate, data };
}

test('M1: get_Passage progressive "clues" (< 8 KB wire, expand_id, zero duplicate) & expand_clue hydration', async () => {
  const gen = await callMcpTool('get_Passage', { passage: 'Genesis 6:14' });
  assert.equal(gen.data.status, 'ok');
  assert.equal(gen.data.view, 'clues');
  assert.equal(gen.hasStructuredDuplicate, false);
  assert.ok(gen.wireBytes < 8192, `Gen 6:14 wireBytes=${gen.wireBytes} must be < 8192`);
  assert.ok(Array.isArray(gen.data.passage_connections) && gen.data.passage_connections.length >= 1);
  assert.equal(gen.data.verses?.[0]?.verse_connections, undefined, 'No duplicate verse_connections in clues view');
  for (const clue of gen.data.passage_connections) {
    assert.ok(typeof clue.expand_id === 'string' && clue.expand_id.length > 0, 'Clue must include expand_id');
    assert.ok(clue.epistemic, 'Clue must include epistemic');
  }

  const jer = await callMcpTool('get_Passage', { passage: 'Jeremiah 1:11-12' });
  assert.equal(jer.data.status, 'ok');
  assert.equal(jer.data.view, 'clues');
  assert.equal(jer.hasStructuredDuplicate, false);
  assert.ok(jer.wireBytes < 8192, `Jer 1:11-12 wireBytes=${jer.wireBytes} must be < 8192`);
  const topClue = jer.data.passage_connections[0];
  assert.ok(topClue?.expand_id, 'Jer 1:11-12 clue must carry expand_id');
  assert.ok(topClue.e_perp || topClue.axes, 'Jer 1:11-12 clue must carry e_perp/axes');

  // Hydrate full witness via research(op="expand_clue") AND get_Passage(expand_id=...)
  const expViaResearch = await callMcpTool('research', {
    operations: [{ op: 'expand_clue', expand_id: topClue.expand_id, detail: 'full' }],
  });
  assert.equal(expViaResearch.data.status, 'ok');
  assert.equal(expViaResearch.data.results[0].status, 'ok');
  assert.ok(expViaResearch.data.results[0].evidence || expViaResearch.data.results[0].passages || expViaResearch.data.results[0].verse);

  const expViaPassage = await callMcpTool('get_Passage', { expand_id: topClue.expand_id, view: 'full' });
  assert.equal(expViaPassage.data.status, 'ok');
  assert.equal(expViaPassage.data.expand_id, topClue.expand_id);
});

test('M2: Zero-stub vowel-aware get_Word (pyroo, בֹּר, שַׁיִת, furnace multi-match, H4417 realworld, Χριστός/ἄχρηστος, Also: hygiene)', async () => {
  const pyroo = await callMcpTool('get_Word', { word: 'pyroo' });
  assert.equal(pyroo.data.status, 'ok');
  assert.equal(pyroo.data.word?.strongs, 'G4448', 'pyroo resolves to G4448 (πυρόω)');
  assert.ok(pyroo.wireBytes < 8192, `get_Word(pyroo) wireBytes=${pyroo.wireBytes} < 8192`);

  const bor = await callMcpTool('get_Word', { word: 'בֹּר' });
  assert.equal(bor.data.status, 'ok');
  assert.ok(['H1252', 'H1253'].includes(bor.data.word?.strongs), `Pointed בֹּר must resolve to H1252/H1253, got ${bor.data.word?.strongs}`);

  const shayit = await callMcpTool('get_Word', { word: 'שַׁיִת' });
  assert.equal(shayit.data.status, 'ok');
  assert.equal(shayit.data.word?.strongs, 'H7898', `Pointed שַׁיִת must resolve to H7898 (thornbush), got ${shayit.data.word?.strongs}`);

  const furnace = await callMcpTool('get_Word', { word: 'furnace' });
  assert.equal(furnace.data.status, 'ok');
  const furnaceStrongs = new Set([
    furnace.data.word?.strongs,
    ...(furnace.data.ambiguous_candidates || []).map(c => c.strongs),
  ]);
  for (const expected of ['H0861', 'H3564', 'G2575', 'H3536', 'H5948']) {
    assert.ok(furnaceStrongs.has(expected), `furnace candidates must include ${expected}, got ${[...furnaceStrongs]}`);
  }

  const salt = await callMcpTool('get_Word', { word: 'H4417', realworld: 1 });
  assert.equal(salt.data.status, 'ok');
  assert.ok(salt.wireBytes < 8192, `get_Word(H4417) wireBytes=${salt.wireBytes} < 8192`);
  assert.equal(salt.data.word?.realworld?.status, 'ok');
  assert.equal(salt.data.word?.realworld?.physical_properties?.mineral, 'halite_salt');
  assert.equal(salt.data.word?.realworld?.physical_properties?.preserves_and_seasons, true);

  const achrestos = await callMcpTool('get_Word', { word: 'ἄχρηστος', etymology: 2 });
  const christos = await callMcpTool('get_Word', { word: 'Χριστός', etymology: 2 });
  assert.equal(achrestos.data.word?.strongs, 'G0890');
  assert.equal(christos.data.word?.strongs, 'G5547');
  assert.notEqual(achrestos.data.word?.gloss, christos.data.word?.gloss);
  assert.ok(!(achrestos.data.word?.etymology?.relatives || []).some(r => r.strongs === 'G5547'));
  assert.ok(!(christos.data.word?.etymology?.relatives || []).some(r => r.strongs === 'G0890'));

  // "Also:" gloss hygiene & zero { status: "missing" } stubs
  for (const bs of ['H5158', 'H1540', 'H2319', 'H4417']) {
    const res = await callMcpTool('get_Word', { word: bs });
    assert.equal(res.data.status, 'ok');
    assert.ok(!/\bAlso:/i.test(res.data.word?.gloss || ''), `${bs} gloss must not leak Also:`);
    assert.notEqual(res.data.status, 'missing');
  }
});

test('M3: research lxx_concordance & tri_textual_diff (MT <-> Rahlfs LXX <-> NT Halo-SW)', async () => {
  const res = await callMcpTool('research', {
    operations: [
      { op: 'lxx_concordance', passage: 'Isaiah 28:16' },
      { op: 'lxx_concordance', lemma: 'ἀδόκιμος', shift_type: 'all', limit: 10 },
      { op: 'lxx_concordance', strongs: 'H0241', shift_type: 'LxxTranslationShift', limit: 10 },
      { op: 'tri_textual_diff', target: 'Hebrews 10:5' },
      { op: 'tri_textual_diff', target: '1 Peter 2:6', source: 'Isaiah 28:16' },
      { op: 'tri_textual_diff', target: 'Acts 15:16', source: 'Amos 9:11' },
    ],
  });
  assert.equal(res.data.status, 'ok');
  const [isaLxx, adok, earLxx, heb10, pet26, acts15] = res.data.results;
  assert.equal(isaLxx.status, 'ok');
  assert.equal(isaLxx.swete_included, false);
  assert.equal(adok.status, 'ok');
  assert.ok(adok.verses?.some(v => v.vid === 17793 || v.r === '1:22'), 'ἀδόκιμος surfaces Isa 1:22');
  assert.equal(earLxx.status, 'ok');
  assert.ok((earLxx.matching_shifts || []).length >= 1, 'H0241 surfaces LxxTranslationShift');

  assert.equal(heb10.status, 'ok');
  assert.ok(heb10.sources.includes('Psalms 40:6'));
  assert.ok(Object.keys(heb10.lxx_shifts_in_sources || {}).length >= 1);
  assert.equal(pet26.status, 'ok');
  assert.ok(pet26.sources.includes('Isaiah 28:16'));
  assert.equal(acts15.status, 'ok');
  assert.ok(acts15.sources.includes('Amos 9:11'));
});

test('M4: research clause_role_query, sequence_parallels, wordplay_scan (talion + onomastic + NEG)', async () => {
  const res = await callMcpTool('research', {
    operations: [
      { op: 'clause_role_query', passage: 'Genesis 1:1' },
      { op: 'clause_role_query', polarity: 'NEG', limit: 5 },
      { op: 'sequence_parallels', source: 'Genesis 1:1-31', target: 'Jeremiah 4:23-26' },
      { op: 'wordplay_scan', passage: 'Philemon 1:10-11' },
      { op: 'wordplay_scan', passage: 'Genesis 9:6' },
      { op: 'wordplay_scan', passage: 'Mark 2:27' },
      { op: 'wordplay_scan', a: 'Χριστός', b: 'ἄχρηστος' },
    ],
  });
  assert.equal(res.data.status, 'ok');
  const [clGen, clNeg, seqGenJer, wpPhlm, wpGen96, wpMark227, wpNeg] = res.data.results;
  assert.equal(clGen.status, 'ok');
  assert.ok(clGen.total_clauses >= 1);
  assert.equal(clNeg.status, 'ok');
  assert.ok(clNeg.returned >= 1);

  assert.equal(seqGenJer.status, 'ok');
  assert.ok((seqGenJer.alignments || []).length >= 1);

  assert.equal(wpPhlm.status, 'ok');
  assert.ok((wpPhlm.onomastic_valence || []).some(o => o.target_form === 'ἄχρηστον' || o.target_form === 'εὔχρηστον'));
  assert.ok((wpPhlm.consonantal_candidates || []).some(c => c.strongsA === 'G0890' && c.strongsB === 'G2173'));

  assert.ok((wpGen96.syntactic_talion || []).some(t => t.strongsA === 'H8210' && t.strongsB === 'H8210'));
  assert.ok((wpMark227.syntactic_talion || []).some(t => t.strongsA === 'G4521' || t.strongsA === 'G0444'));
  assert.equal(wpNeg.wordplay_candidate, false);
});

test('M5: research set_combine, intersect_words, trace_evidence(passage), get_Connection("clues")', async () => {
  const res = await callMcpTool('research', {
    operations: [
      { op: 'set_combine', include: ['H2617', 'H0571'], testament: 'OT', limit: 10 },
      { op: 'intersect_words', words: ['furnace', 'refine'], limit: 10 },
      { op: 'trace_evidence', passage: 'Jeremiah 1:11' },
    ],
  });
  assert.equal(res.data.status, 'ok');
  const [scOp, iwOp, teOp] = res.data.results;
  assert.equal(scOp.status, 'ok');
  assert.equal(scOp.total_matched, 33);
  assert.ok(scOp.verses.length >= 1 && scOp.verses[0].expand_id?.startsWith('v3:bmw:'));

  assert.equal(iwOp.status, 'ok');
  assert.ok(iwOp.verses.length >= 1, 'Compound English intersect_words(["furnace","refine"]) returns non-empty verses');
  assert.ok(iwOp.verses.some(v => v.ref === 'Isaiah 48:10'), 'Matches Isaiah 48:10');

  assert.equal(teOp.status, 'ok');
  assert.equal(teOp.passage, 'Jeremiah 1:11');
  assert.ok(teOp.clauses_count >= 1);
  assert.ok(Array.isArray(teOp.strongest_connections) && teOp.strongest_connections.length >= 1);

  const conn = await callMcpTool('get_Connection', { items: ['H0120', 'H1818', 'H0127'], view: 'clues' });
  assert.equal(conn.data.status, 'ok');
  assert.equal(conn.data.view, 'clues');
  assert.equal(conn.hasStructuredDuplicate, false);
  assert.ok(conn.wireBytes < 8192, `get_Connection("clues") wireBytes=${conn.wireBytes} < 8192`);
  assert.equal(conn.data.direct_link_found, true);
  assert.equal(conn.data.all_endpoints_connected, true);
  assert.equal(conn.data.graph_proof?.is_valid, true);
  assert.equal(conn.data.complete_multi_anchor, undefined, 'Zero duplicate arrays in clues view');
  assert.equal(conn.data.direct_pairwise, undefined, 'Zero duplicate arrays in clues view');
  assert.ok(conn.data.connections.every(c => typeof c.expand_id === 'string' && c.expand_id.length > 0));
});

test('M6: follow_connectionchain accepts next_id, supports axis_filter, stays < 8 KB in "clues" view', async () => {
  const started = await callMcpTool('follow_connectionchain', {
    next: 'Zechariah 4',
    axis_filter: 'lxx',
    limit: 6,
  });
  assert.equal(started.data.status, 'ok');
  assert.equal(started.data.view, 'clues');
  assert.equal(started.hasStructuredDuplicate, false);
  assert.ok(started.wireBytes < 8192, `follow start wireBytes=${started.wireBytes} < 8192`);
  assert.ok(Array.isArray(started.data.next_connections) && started.data.next_connections.length >= 1);
  const firstHop = started.data.next_connections[0];
  assert.ok(firstHop.next_id && firstHop.expand_id);

  const advanced = await callMcpTool('follow_connectionchain', {
    chain: started.data.chain,
    next_id: firstHop.next_id,
    action: 'follow',
    limit: 6,
  });
  assert.equal(advanced.data.status, 'ok');
  assert.equal(advanced.data.view, 'clues');
  assert.equal(advanced.data.step, 1);
  assert.ok(advanced.wireBytes < 8192, `follow step wireBytes=${advanced.wireBytes} < 8192`);
  assert.ok(!advanced.data.next_connections.some(c => c.id === firstHop.id), 'Must not repeat visited edge');

  const hydrated = await callMcpTool('follow_connectionchain', {
    expand_id: firstHop.expand_id,
    view: 'evidence',
  });
  assert.equal(hydrated.data.status, 'ok');
  assert.equal(hydrated.data.expand_id, firstHop.expand_id);
});

test('M7: Cycle 2b polish (G... lxx_concordance, expand_clue handles, Matt 2:6->Mic 5:2, H7462 hygiene, ref/strongs aliases)', async () => {
  const h7462 = await callMcpTool('get_Word', { word: 'H7462', passage: 'Numbers 27:17' });
  assert.equal(h7462.data.status, 'ok');
  assert.equal(h7462.data.word?.lemma, 'רָעָה', 'H7462 anchored in Num 27:17 must have canonical headword רָעָה');

  const res = await callMcpTool('research', {
    operations: [
      { op: 'lxx_concordance', strongs: 'G4166', limit: 6 },
      { op: 'lxx_concordance', ref: 'Micah 5:2' },
      { op: 'expand_clue', expand_id: 'passage_lxx:H7462:G1097', detail: 'evidence' },
      { op: 'tri_textual_diff', target: 'Matthew 2:6' },
      { op: 'intersect_words', strongs: ['H7462', 'H6629'], limit: 5 },
      { op: 'wordplay_scan', a: 'Genesis 1:1', b: 'John 1:1' },
    ],
  });
  assert.equal(res.data.status, 'ok');
  const [g4166, micRef, expLxx, matt26, iwStrongs, wpBad] = res.data.results;
  assert.equal(g4166.status, 'ok');
  assert.equal(g4166.lemma, 'ποιμήν');
  assert.ok(g4166.total_verses >= 1 && typeof g4166.truncated === 'boolean');

  assert.equal(micRef.status, 'ok');
  assert.equal(micRef.mode, 'passage_alignment');
  assert.equal(micRef.total_verses, 1);

  assert.equal(expLxx.status, 'ok');
  assert.equal(expLxx.kind, 'passage_lxx');
  assert.ok(Array.isArray(expLxx.words) && expLxx.words.length === 2);

  assert.equal(matt26.status, 'ok');
  assert.ok(matt26.sources.includes('Micah 5:2'), `Matt 2:6 must hit Micah 5:2, got ${JSON.stringify(matt26.sources)}`);

  assert.equal(iwStrongs.status, 'ok');
  assert.ok(Array.isArray(iwStrongs.verses) && iwStrongs.verses.length >= 1);

  assert.equal(wpBad.status, 'invalid_request');
  assert.ok(/single words|passage/i.test(String(wpBad.error || '')));

  const ezChain = await callMcpTool('follow_connectionchain', {
    next: 'Ezekiel 34:1-16',
    limit: 6,
  });
  assert.equal(ezChain.data.status, 'ok');
  assert.ok(ezChain.wireBytes < 8192);
  assert.ok(
    ezChain.data.next_connections.some(c => /H7462|H6629|shepherd|flock|Ezekiel 34:2/i.test(JSON.stringify(c))),
    'Multi-verse follow_connectionchain("Ezekiel 34:1-16") must anchor across range salient lemmas',
  );
});
