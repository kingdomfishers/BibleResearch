/**
 * Section 5 Diagnostic Suite (Levels 1-4)
 * Evaluates all 18 observed failures & research usability cases locally against
 * the Edge + Worker + MCP stack and saves compact results to .artifacts-r12/v4-eval/diagnostics.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { corpusRpc } from '../local-corpus-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const bundleRoot = path.join(repoRoot, '.artifacts-r12/staging-bundle');

const zStubSource = `
const fn = () => {};
const zProxy = new Proxy(fn, {
  get(_t, prop) {
    if (prop === 'then' || prop === '__esModule') return undefined;
    if (prop === 'safeParse') return (val) => ({ success: true, data: val });
    if (prop === 'parse') return (val) => val;
    return zProxy;
  },
  apply() { return zProxy; },
});
export { zProxy as z, zProxy as object, zProxy as strictObject, zProxy as string, zProxy as number, zProxy as boolean, zProxy as array, zProxy as union, zProxy as literal, zProxy as record, zProxy as unknown, zProxy as any, zProxy as optional, zProxy as nullable, zProxy as tuple, zProxy as lazy, zProxy as discriminatedUnion, zProxy as enum };
export default zProxy;
`;
const mcpStubSource = `export class McpServer { constructor() { this.tools = new Map(); } registerTool(n, d, h) { this.tools.set(n, { d, h }); } registerPrompt() {} registerResource() {} }`;

async function bundleTs(entryPoint) {
  const result = await esbuild.build({
    entryPoints: [path.resolve(repoRoot, entryPoint)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    plugins: [{
      name: 'deno-mcp-stubs',
      setup(build) {
        build.onResolve({ filter: /^(@modelcontextprotocol\/server|zod)$/ }, (args) => ({ path: args.path, namespace: 'deno-stub' }));
        build.onLoad({ filter: /.*/, namespace: 'deno-stub' }, (args) => ({
          contents: args.path === '@modelcontextprotocol/server' ? mcpStubSource : zStubSource,
          loader: 'js',
        }));
      },
    }],
  });
  return await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text, 'utf8').toString('base64')}`);
}

function makeEdgeFetcher() {
  return async (input, init) => {
    const urlStr = typeof input === 'string' ? input : input.url;
    const u = new URL(urlStr);
    if (u.pathname.startsWith('/v1/rpc/')) {
      const rpcName = u.pathname.slice('/v1/rpc/'.length);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const data = await corpusRpc(rpcName, body);
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const relPath = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const fullPath = path.join(bundleRoot, relPath);
    if (!fullPath.startsWith(bundleRoot) || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return new Response('Not Found', { status: 404 });
    }
    const buf = fs.readFileSync(fullPath);
    const rangeHdr = init?.headers?.Range || init?.headers?.range;
    if (rangeHdr) {
      const m = /^bytes=(\d+)-(\d+)$/.exec(String(rangeHdr));
      if (m) {
        const s = Number(m[1]), e = Number(m[2]);
        return new Response(buf.subarray(s, e + 1), { status: 206, headers: { 'Content-Range': `bytes ${s}-${e}/${buf.length}` } });
      }
    }
    return new Response(buf, { status: 200 });
  };
}

const edgeMod = await bundleTs('supabase/functions/bible-mcp/discovery-runtime.ts');
const fetcher = makeEdgeFetcher();
const edgeRpc = async (name, args) => {
  if (edgeMod.SUPABASE_DISCOVERY_COMPUTE_RPCS.has(name)) {
    return edgeMod.executeSupabaseDiscoveryRpc(name, args, { corpusBase: 'https://corpus.local', fetcher });
  }
  return corpusRpc(name, args);
};

const { handleGetConnection, buildFullCompactWord } = await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts');
const mcpRead = async ({ name, args }) => ({ rows: [await edgeRpc(name, args)] });

function itemsOf(res) {
  return res?.strongest_connections || [];
}
function textBlob(c) {
  return JSON.stringify(c).toLowerCase();
}

const checks = [];
async function runCheck(id, fn) {
  const t0 = performance.now();
  try {
    const res = await fn();
    checks.push({ id, ...res, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    checks.push({ id, passed: false, detail: err instanceof Error ? err.message : String(err), ms: Math.round(performance.now() - t0) });
  }
}

// 1. Zech 3:4: garment/iniquity explanatory discourse, NOT H6030/H5771 #1 phonetic
await runCheck('D01_Zech_3_4', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Zechariah 3:4', limit: 10 });
  const items = itemsOf(res);
  const top = items[0];
  const badTop = top?.evidence_id === 'r13:wp:H6030:H5771';
  const hasGarmentIniq = items.some(c =>
    (c.evidence_type === 'explicit_biblical_interpretation' || c.predicate === 'explicit_identification' || c.evidence_id.startsWith('v4:eside:')) &&
    /garment|cloth|iniquity|sin|h0899|h4254|h5771|h5674/i.test(textBlob(c))
  );
  return { passed: !badTop && hasGarmentIniq, detail: `top=${top?.evidence_id}, hasGarmentIniq=${hasGarmentIniq}` };
});

// 2. Exod 17:1-7: explicit rock-Christ 1 Cor 10:4 + Massah/Meribah
await runCheck('D02_Exod_17_1_7', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Exodus 17:1-7', limit: 10 });
  const items = itemsOf(res);
  const has1Cor104 = items.some(c => /1\s*cor(?:inthians)?\s*10:4/i.test(textBlob(c)) && /explicit|typolog|interpret|c1|c2|eside|r13:interp/i.test(textBlob(c)));
  const hasMassahMeribah = items.some(c => /massah|h4532|meribah|h4809|h5254|h7378/i.test(textBlob(c)));
  return { passed: has1Cor104 && hasMassahMeribah, detail: `1Cor10:4=${has1Cor104}, Massah/Meribah=${hasMassahMeribah}` };
});

// 3. Dan 5:25-28: full MENE/TEKEL/PERES interpretation structure
await runCheck('D03_Dan_5_25_28', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Daniel 5:25-28', limit: 10 });
  const items = itemsOf(res);
  const top = items[0];
  const badTop = top?.evidence_id === 'r13:wp:H1836:H4483';
  const hasPesar = items.some(c => /eside|r13:interp|explicit_biblical_interpretation/i.test(textBlob(c)) && /mene|h4484|tekel|h8625|peres|h6537/i.test(textBlob(c)));
  return { passed: !badTop && hasPesar, detail: `top=${top?.evidence_id}, hasPesar=${hasPesar}` };
});

// 4. Amos 8:1-2: summer fruit / end wordplay prominently
await runCheck('D04_Amos_8_1_2', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Amos 8:1-2', limit: 10 });
  const items = itemsOf(res);
  const hasVis = items.some(c => /h7019/i.test(textBlob(c)) && /h7093/i.test(textBlob(c)));
  const hasWpProminent = items.slice(0, 4).some(c => (/h7019/i.test(textBlob(c)) && /h7093/i.test(textBlob(c))) && /wordplay|eside|r13:interp/i.test(textBlob(c)));
  return { passed: hasVis && hasWpProminent, detail: `hasVis=${hasVis}, prominent=${hasWpProminent}` };
});

// 5. Judg 15:19: NO false interpretation involving "the day"
await runCheck('D05_Judg_15_19', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Judges 15:19', limit: 10 });
  const items = itemsOf(res);
  const hasFalseDay = items.some(c => /birthname:H3117|יוֹם.*H3117.*"the day"/i.test(JSON.stringify(c)));
  return { passed: !hasFalseDay, detail: `hasFalseDay=${hasFalseDay}` };
});

// 6. Zech 3 / Isa 61:10 / Rev 19:8: spiritual clothing representations
await runCheck('D06_Clothing_Righteousness_SingleSeed', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Zechariah 3:4', limit: 15 });
  const blob = JSON.stringify(res);
  const hits = [/isa(?:iah)?\s*61:10/i.test(blob), /rev(?:elation)?\s*19:8/i.test(blob)].filter(Boolean).length;
  return { passed: hits >= 1, detail: `hits(Isa61:10/Rev19:8)=${hits}` };
});

// 7. Ezek 36:25-27 / Jer 31:31-34 / 2 Cor 3:3-6
await runCheck('D07_NewHeart_Covenant_SingleSeed', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Ezekiel 36:25-27', limit: 15 });
  const blob = JSON.stringify(res);
  const hasJer31 = /jer(?:emiah)?\s*31:3[1-4]/i.test(blob);
  const has2Cor3 = /2\s*cor(?:inthians)?\s*3:[3-6]/i.test(blob);
  return { passed: hasJer31 && has2Cor3, detail: `Jer31=${hasJer31}, 2Cor3=${has2Cor3}` };
});

// 8. John 6:48-58: historical manna narrative & contrast
await runCheck('D08_John_6_Manna', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'John 6:48-58', limit: 12 });
  const blob = JSON.stringify(res);
  const hasExod16 = /exod(?:us)?\s*16/i.test(blob);
  return { passed: hasExod16, detail: `Exod16=${hasExod16}` };
});

// 9. Gen 6:14 / Exod 2:3: ark & waterproofing
await runCheck('D09_Gen6_Exod2_Ark', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Genesis 6:14', limit: 12 });
  const blob = JSON.stringify(res);
  const hasExod23 = /exod(?:us)?\s*2:3/i.test(blob);
  return { passed: hasExod23, detail: `Exod2:3=${hasExod23}` };
});

// 10. Isa 55:10-11 / Luke 8:11 / 1 Pet 1:23
await runCheck('D10_Isa55_Seed_Word', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Isaiah 55:10-11', limit: 12 });
  const blob = JSON.stringify(res);
  const hits = [/luke\s*8:11/i.test(blob), /1\s*pet(?:er)?\s*1:23/i.test(blob)].filter(Boolean).length;
  return { passed: hits >= 1, detail: `hits(Luke8:11/1Pet1:23)=${hits}` };
});

// 11. Exod 17:1-7 / Num 20:2-13: shared narrative + strike vs speak difference
await runCheck('D11_Exod17_Num20_Structure', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Exodus 17:1-7', compare_targets: ['Numbers 20:2-13'], limit: 12 });
  const blob = JSON.stringify(res);
  const hasNum20 = /num(?:bers)?\s*20/i.test(blob);
  const hasStrikeSpeakDiff = /strike|speak|h5221|h1696|difference|divergence|residual/i.test(blob);
  return { passed: hasNum20 && hasStrikeSpeakDiff, detail: `Num20=${hasNum20}, diff=${hasStrikeSpeakDiff}` };
});

// 12. Gen 1 / Exod 20:8-11: compressed creation/Sabbath correspondence
await runCheck('D12_Gen1_Exod20_Sabbath', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Exodus 20:8-11', limit: 12 });
  const blob = JSON.stringify(res);
  const hasGen1 = /gen(?:esis)?\s*(?:1:|2:[1-3])/i.test(blob);
  return { passed: hasGen1, detail: `Gen1/2=${hasGen1}` };
});

// 13. Heb 4:1-11: creation rest + Ps 95 + Joshua + remaining rest
await runCheck('D13_Heb4_Rest', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Hebrews 4:1-11', limit: 12 });
  const blob = JSON.stringify(res);
  const hasPs95 = /ps(?:alm)?\s*95/i.test(blob);
  const hasGen2 = /gen(?:esis)?\s*2:2/i.test(blob);
  return { passed: hasPs95 && hasGen2, detail: `Ps95=${hasPs95}, Gen2:2=${hasGen2}` };
});

// 14. Ezek 39:17-19 / John 6:53: NOT classified as authorial quote/typology
await runCheck('D14_Ezek39_John6_Epistemic', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Ezekiel 39:17-19', compare_targets: ['John 6:53'], limit: 10 });
  const items = itemsOf(res).filter(c => /john\s*6/i.test(textBlob(c)));
  const falseQuote = items.some(c => c.epistemic_class === 'authorial_typology_or_quote' || c.predicate === 'explicit_quotation');
  return { passed: !falseQuote, detail: `falseQuote=${falseQuote}, matchedItems=${items.length}` };
});

// 15. Ps 95:7-11 / Heb 3:7-11: explicit quotation identified
await runCheck('D15_Ps95_Heb3_Quote', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Hebrews 3:7-11', limit: 10 });
  const items = itemsOf(res);
  const hasPs95Quote = items.some(c => /ps(?:alm)?\s*95/i.test(textBlob(c)) && /authorial_typology_or_quote|direct_textual_evidence|quotation|tritextual|splice|eside/i.test(textBlob(c)));
  return { passed: hasPs95Quote, detail: `hasPs95Quote=${hasPs95Quote}` };
});

// 16. Gen 1:26-27 / Col 1:15-20: LXX translation equivalence, NOT historical root
await runCheck('D16_Gen1_Col1_LXX', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Genesis 1:26-27 Colossians 1:15', limit: 10 });
  const items = itemsOf(res);
  const hasImageBridge = items.some(c => (/h6754/i.test(textBlob(c)) && /g1504/i.test(textBlob(c))) && /lxx|translation|eik|εἰκ/i.test(textBlob(c)));
  const falseRoot = items.some(c => /h6754/i.test(textBlob(c)) && /g1504/i.test(textBlob(c)) && /shared_root|historical_derivation|etymological/i.test(textBlob(c)));
  return { passed: hasImageBridge && !falseRoot, detail: `hasImageBridge=${hasImageBridge}, falseRoot=${falseRoot}` };
});

// 17. Jonah / John lexical identity
await runCheck('D17_Jonah_John_Identity', async () => {
  const w = await buildFullCompactWord(mcpRead, 'G2495', { connections: 4, etymology: 1, realworld: 0 });
  const gl = String(w?.word?.gloss || w?.word?.primary_gloss || w?.profile?.gl || '');
  const lk = String(w?.word?.lemma_key || w?.profile?.lk || '');
  const ok = !/\bjoh?n\b/i.test(gl) && !/^lemma:G2491/i.test(lk);
  return { passed: ok, detail: `gl="${gl}", lk="${lk}"` };
});

// 18. NL Query & get_Word(H3820, Ezek 36:26, bridge)
await runCheck('D18_Usability_NL_And_Bridge', async () => {
  const nl = await edgeRpc('discover_biblical_connections_v2', { query: 'clothing as righteousness removal of sin', limit: 10 });
  const nlBlob = JSON.stringify(itemsOf(nl).slice(0, 6));
  const nlHits = /zech(?:ariah)?\s*3|isa(?:iah)?\s*61|rev(?:elation)?\s*19/i.test(nlBlob);
  const wBridge = await buildFullCompactWord(mcpRead, 'H3820', { connections: 6, etymology: 0, realworld: 0, passage: 'Ezekiel 36:26', mode: 'bridge' });
  const wbBlob = JSON.stringify(wBridge?.word?.connections || []);
  const wbAnchored = /jer(?:emiah)?\s*31|2\s*cor(?:inthians)?\s*3|ezek(?:iel)?\s*11:19/i.test(wbBlob);
  return { passed: nlHits && wbAnchored, detail: `nlHits=${nlHits}, wbAnchored=${wbAnchored}` };
});

const passed = checks.filter(c => c.passed).length;
const out = {
  total: checks.length,
  passed,
  failed: checks.length - passed,
  checks,
};
fs.mkdirSync(path.join(repoRoot, '.artifacts-r12/v4-eval'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, '.artifacts-r12/v4-eval/diagnostics.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ total: out.total, passed: out.passed, failed: out.failed, summary: checks.map(c => `${c.passed ? 'PASS' : 'FAIL'} ${c.id} (${c.detail})`) }, null, 2));
