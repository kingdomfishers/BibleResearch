#!/usr/bin/env node
/**
 * BibleResearch v4 Blind Holdout Suite (10 Unseen Positive Cases + 3 Hard Negatives)
 * Evaluates generalization across unseen cross-testament, apocalyptic, parable,
 * naming, catena quotation, narrative structural parallels, and negative pairs.
 * Writes compact results to .artifacts-r12/v4-eval/holdouts.json.
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

function itemsOf(res) {
  return res?.strongest_connections || [];
}
function blobOf(x) {
  return JSON.stringify(x).toLowerCase();
}

const checks = [];
async function runCheck(id, kind, fn) {
  const t0 = performance.now();
  try {
    const r = await fn();
    checks.push({ id, kind, ...r, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    checks.push({ id, kind, passed: false, detail: err instanceof Error ? err.message : String(err), ms: Math.round(performance.now() - t0) });
  }
}

// H01. Gal 4:24-26: explicit C2 allegory Hagar/Sarah/Sinai/Jerusalem -> Gen 16/21
await runCheck('H01_Gal_4_24_26', 'positive', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Galatians 4:24-26', limit: 12 });
  const items = itemsOf(res);
  const blob = blobOf(items);
  const hasExplicit = items.some((c) => /v4:eside:|explicit_biblical_interpretation|authorial_typology_or_quote/.test(blobOf(c)));
  const hasHagarGen = /hagar|sarah|sinai|gen(?:esis)?\s*(?:16|21)|g0028|g4564|g4614/i.test(blob);
  return { passed: hasExplicit && hasHagarGen, detail: `explicit=${hasExplicit}, hagar/sinai/gen=${hasHagarGen}` };
});

// H02. 1 Pet 3:20-21: explicit C6 antitype baptism / flood ark -> Gen 6-8
await runCheck('H02_1Pet_3_20_21', 'positive', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: '1 Peter 3:20-21', limit: 12 });
  const items = itemsOf(res);
  const blob = blobOf(items);
  const hasExplicit = items.some((c) => /v4:eside:|explicit_biblical_interpretation|authorial_typology_or_quote/.test(blobOf(c)));
  const hasArkFlood = /gen(?:esis)?\s*[6-8]|noah|ark|baptis|g0908|g2787|g0499/i.test(blob);
  return { passed: hasExplicit && hasArkFlood, detail: `explicit=${hasExplicit}, ark/flood=${hasArkFlood}` };
});

// H03. Matt 13:37-39: explicit C1/C2 parable decoding (sower/field/seed/weeds/enemy/harvest)
await runCheck('H03_Matt_13_37_39', 'positive', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Matthew 13:37-39', limit: 12 });
  const items = itemsOf(res);
  const eside = await edgeRpc('get_eside_interpretations_v4', { passages: ['Matthew 13:37-39'] });
  const blob = blobOf(items) + ' ' + blobOf(eside);
  const hasExplicit = (eside?.records?.length || 0) > 0 || items.some((c) => /v4:eside:|explicit_biblical_interpretation/.test(blobOf(c)));
  const hasSymbols = /(field|world|g0068|g2889)/.test(blob) && /(enemy|devil|g2190|g1228|harvest|g2326|g4930)/.test(blob);
  return { passed: hasExplicit && hasSymbols, detail: `esideCount=${eside?.records?.length || 0}, symbols=${hasSymbols}` };
});

// H04. Gen 32:28: explicit C4 etiological naming Israel / striven with God
await runCheck('H04_Gen_32_28', 'positive', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Genesis 32:28', limit: 12 });
  const eside = await edgeRpc('get_eside_interpretations_v4', { passages: ['Genesis 32:28'] });
  const blob = blobOf(itemsOf(res)) + ' ' + blobOf(eside);
  const hasIsraelNaming = /israel|h3478/i.test(blob) && /h8280|striv|struggl|prevail|c4|eside|r13:interp/i.test(blob);
  return { passed: hasIsraelNaming, detail: `esideCount=${eside?.records?.length || 0}, israelNaming=${hasIsraelNaming}` };
});

// H05. Heb 1:5-13: C7 multi-source catena splice alignment to Ps 2 / 2 Sam 7 / Ps 104 / Ps 45 / Ps 102 / Ps 110
await runCheck('H05_Heb_1_5_13', 'positive', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Hebrews 1:5-13', limit: 15 });
  const blob = blobOf(itemsOf(res));
  const otTargets = [
    /ps(?:alm)?\s*2:7/,
    /2\s*sam(?:uel)?\s*7:14/,
    /ps(?:alm)?\s*104:4/,
    /ps(?:alm)?\s*45:[67]/,
    /ps(?:alm)?\s*102:2[5-7]/,
    /ps(?:alm)?\s*110:1/,
  ].filter((rx) => rx.test(blob)).length;
  return { passed: otTargets >= 3, detail: `otCatenaTargets=${otTargets}/6` };
});

// H06. Dan 7:17-24: explicit C2 apocalyptic vision interpretation (beasts -> kings/kingdoms)
await runCheck('H06_Dan_7_17_24', 'positive', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Daniel 7:17-24', limit: 12 });
  const eside = await edgeRpc('get_eside_interpretations_v4', { passages: ['Daniel 7:17-24'] });
  const blob = blobOf(itemsOf(res)) + ' ' + blobOf(eside);
  const hasBeastKing = /(beast|h2423)/.test(blob) && /(king|h4430|h4437)/.test(blob) && /(c2|eside|explicit_biblical_interpretation|r13:interp)/.test(blob);
  return { passed: hasBeastKing, detail: `esideCount=${eside?.records?.length || 0}, beastKing=${hasBeastKing}` };
});

// H07. Exod 12:21-27 <-> 1 Cor 5:7: Passover lamb structural & typological correspondence
await runCheck('H07_Exod12_1Cor5_Passover', 'positive', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Exodus 12:21-27', compare_targets: ['1 Corinthians 5:7'], limit: 12 });
  const sme = await edgeRpc('discover_structural_analogies_v4', { seed_passages: ['Exodus 12:21-27'], compare_passages: ['1 Corinthians 5:7'], limit: 6 });
  const blob = blobOf(itemsOf(res)) + ' ' + blobOf(sme);
  const hitsTarget = /1\s*cor(?:inthians)?\s*5:[6-8]/.test(blob) || (sme?.analogies?.length || 0) > 0;
  return { passed: hitsTarget, detail: `smeCount=${sme?.analogies?.length || 0}, hitsTarget=${hitsTarget}` };
});

// H08. Gen 28:12 <-> John 1:51: ladder / angels ascending & descending
await runCheck('H08_Gen28_John1_Ladder', 'positive', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Genesis 28:12', limit: 15 });
  const sme = await edgeRpc('discover_structural_analogies_v4', { seed_passages: ['Genesis 28:12'], compare_passages: ['John 1:51'], limit: 6 });
  const blob = blobOf(itemsOf(res)) + ' ' + blobOf(sme);
  const hasJn151 = /john\s*1:51/.test(blob) || (sme?.analogies?.length || 0) > 0;
  return { passed: hasJn151, detail: `smeCount=${sme?.analogies?.length || 0}, hasJn151=${hasJn151}` };
});

// H09. 1 Kgs 17:17-24 <-> 2 Kgs 4:32-37: Elijah/Elisha raising son structural parallel
await runCheck('H09_Elijah_Elisha_Raising', 'positive', async () => {
  const sme = await edgeRpc('discover_structural_analogies_v4', { seed_passages: ['1 Kings 17:17-24'], compare_passages: ['2 Kings 4:32-37'], limit: 6 });
  const top = (sme?.analogies || [])[0];
  const passed = Boolean(top && top.classification && top.classification !== 'UNRELATED' && (top.mapped_events_count || top.mapped_events?.length || 0) >= 2);
  return { passed, detail: `topClass=${top?.classification || 'none'}, pStruct=${top?.p_struct ?? 'n/a'}, ho=${top?.mapped_ho_count ?? 0}` };
});

// H10. Isa 5:1-7 <-> Matt 21:33-41: Song of Vineyard / Wicked Tenants structural analogy + explicit Isa 5:7 decoding
await runCheck('H10_Isa5_Matt21_Vineyard', 'positive', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Isaiah 5:1-7', compare_targets: ['Matthew 21:33-41'], limit: 15 });
  const sme = await edgeRpc('discover_structural_analogies_v4', { seed_passages: ['Isaiah 5:1-7'], compare_passages: ['Matthew 21:33-41'], limit: 6 });
  const eside = await edgeRpc('get_eside_interpretations_v4', { passages: ['Isaiah 5:7'] });
  const blob = blobOf(itemsOf(res)) + ' ' + blobOf(sme) + ' ' + blobOf(eside);
  const hasVineyardDecoding = (/vineyard|h3754/.test(blob) && /israel|judah|h3478|h3063/.test(blob)) || (eside?.records?.length || 0) > 0;
  const hasStructuralOrAllusion = /matt(?:hew)?\s*21:3/.test(blob) || ((sme?.analogies || []).some((a) => a.p_struct < 0.05));
  return { passed: hasVineyardDecoding && hasStructuralOrAllusion, detail: `decoding=${hasVineyardDecoding}, matt21/sme=${hasStructuralOrAllusion}` };
});

// N01. Gen 10:1-5 vs 1 Chr 1:5-7: Genealogy surface overlap must NOT emit CROSS_DOMAIN_ANALOGY with pStruct < 0.035
await runCheck('N01_Genealogy_NoCrossDomain', 'negative', async () => {
  const sme = await edgeRpc('discover_structural_analogies_v4', { seed_passages: ['Genesis 10:1-5'], compare_passages: ['1 Chronicles 1:5-7'], limit: 6 });
  const falseCross = (sme?.analogies || []).some((a) => a.classification === 'CROSS_DOMAIN_ANALOGY' && a.p_struct < 0.035);
  return { passed: !falseCross, detail: `analogies=${(sme?.analogies || []).length}, topClass=${sme?.analogies?.[0]?.classification || 'none'}` };
});

// N02. Exod 26:1-6 vs 1 Kgs 6:15-20: Architectural details must NOT emit authorial_typology_or_quote or explicit_biblical_interpretation
await runCheck('N02_Architecture_NoQuote', 'negative', async () => {
  const res = await edgeRpc('discover_biblical_connections_v2', { query: 'Exodus 26:1-6', compare_targets: ['1 Kings 6:15-20'], limit: 10 });
  const items = itemsOf(res).filter((c) => /1\s*k(?:in)?gs\s*6/i.test(blobOf(c)));
  const falseQuote = items.some((c) => c.epistemic_class === 'authorial_typology_or_quote' || c.evidence_type === 'explicit_biblical_interpretation' || c.predicate === 'explicit_quotation');
  return { passed: !falseQuote, detail: `falseQuote=${falseQuote}, matchedItems=${items.length}` };
});

// N03. Num 7:12-17 vs Ezra 2:1-10: Unrelated offering/census lists rejected from structural analogy
await runCheck('N03_Lists_NoStructural', 'negative', async () => {
  const sme = await edgeRpc('discover_structural_analogies_v4', { seed_passages: ['Numbers 7:12-17'], compare_passages: ['Ezra 2:1-10'], limit: 6 });
  const falsePass = (sme?.analogies || []).some((a) => (a.classification === 'CROSS_DOMAIN_ANALOGY' || a.classification === 'LITERAL_PARALLEL_OR_TYPOLOGY') && a.p_struct < 0.035);
  return { passed: !falsePass, detail: `analogies=${(sme?.analogies || []).length}, topClass=${sme?.analogies?.[0]?.classification || 'none'}, p=${sme?.analogies?.[0]?.p_struct ?? 'n/a'}` };
});

const passed = checks.filter((c) => c.passed).length;
const posPassed = checks.filter((c) => c.kind === 'positive' && c.passed).length;
const negPassed = checks.filter((c) => c.kind === 'negative' && c.passed).length;
const out = {
  total: checks.length,
  passed,
  failed: checks.length - passed,
  positive_passed: posPassed,
  positive_total: checks.filter((c) => c.kind === 'positive').length,
  negative_passed: negPassed,
  negative_total: checks.filter((c) => c.kind === 'negative').length,
  checks,
};
fs.mkdirSync(path.join(repoRoot, '.artifacts-r12/v4-eval'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, '.artifacts-r12/v4-eval/holdouts.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ total: out.total, passed: out.passed, failed: out.failed, positive: `${posPassed}/10`, negative: `${negPassed}/3`, summary: checks.map((c) => `${c.passed ? 'PASS' : 'FAIL'} ${c.id} (${c.detail})`) }, null, 2));
