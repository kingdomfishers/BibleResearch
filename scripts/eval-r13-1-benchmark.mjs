/**
 * R13.1 Benchmark & Evidence-Integrity Evaluation Harness.
 * Replays all 44 live MCP queries + 10 evidence-contract assertions from
 * `research/r13/R13_LIVE_BENCHMARK_2026-11-23.json` plus the 16 T'OMIM-compatible
 * Hebrew parallel pairs from `research/r13/tomim_eval_sample.json` against the
 * local Worker + MCP engine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { corpusRpc } from './local-corpus-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const r13BenchPath = path.join(repoRoot, 'research', 'r13', 'R13_LIVE_BENCHMARK_2026-11-23.json');
const tomimPath = path.join(repoRoot, 'research', 'r13', 'tomim_eval_sample.json');

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
    entryPoints: [path.resolve(repoRoot, entryPoint)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    plugins: [{
      name: 'deno-mcp-stubs',
      setup(build) {
        build.onResolve({ filter: /^(@modelcontextprotocol\/server|zod)$/ }, (args) => ({
          path: args.path,
          namespace: 'deno-stub',
        }));
        build.onLoad({ filter: /.*/, namespace: 'deno-stub' }, (args) => ({
          contents: args.path === '@modelcontextprotocol/server' ? mcpStubSource : zStubSource,
          loader: 'js',
        }));
      },
    }],
  });
  return await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text, 'utf8').toString('base64')}`);
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

function connectionMatchesTarget(c, target) {
  if (!c || !target) return false;
  const blob = JSON.stringify(c);
  if (blob.includes(target)) return true;
  // Handle range match like "Jeremiah 1:11" inside "Jeremiah 1:11-12"
  const m = /^(.+\s+\d+):(\d+)$/.exec(target);
  if (m) {
    const prefix = m[1];
    const vNum = Number(m[2]);
    for (const r of [...(c.refs || []), ...((c.passages || []).map(p => p.ref))]) {
      const rm = /^(.+\s+\d+):(\d+)-(\d+)$/.exec(String(r || ''));
      if (rm && rm[1] === prefix && vNum >= Number(rm[2]) && vNum <= Number(rm[3])) return true;
    }
  }
  return false;
}

const r13Bench = JSON.parse(fs.readFileSync(r13BenchPath, 'utf8').replace(/^\uFEFF/, ''));
const { buildFullCompactWord, handleGetPassage, handleGetConnection } = await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts');
const { selectChainEvidence } = await bundleTs('supabase/functions/bible-mcp/chain-evidence.ts');
const { executeResearch } = await bundleTs('supabase/functions/bible-mcp/research-engine.ts');
const read = makeReader();

const queryResults = [];
const byCategory = {};

for (const q of r13Bench.queries) {
  let conns = [];
  let connPacket = null;
  if (q.tool === 'get_Word') {
    const res = await buildFullCompactWord(read, q.args.word, q.args);
    conns = res.word?.connections || res.connections || [];
  } else if (q.tool === 'get_Passage') {
    const res = await handleGetPassage(read, q.args);
    conns = res.passage_connections || res.connections || [];
  } else if (q.tool === 'research') {
    const res = await executeResearch(read, q.args);
    conns = res.connections || [];
  } else if (q.tool === 'get_Connection') {
    connPacket = await handleGetConnection(read, q.args.items, q.args.connections || 25);
  }

  if (q.category === 'multi_anchor') {
    const returnedConnected = Boolean(connPacket?.all_endpoints_connected);
    const pass = returnedConnected === Boolean(q.expected_connected);
    queryResults.push({
      id: q.id,
      category: q.category,
      expected_connected: q.expected_connected,
      returned_connected: returnedConnected,
      complete_multi_anchor_count: (connPacket?.complete_multi_anchor || []).length,
      direct_pairwise_count: (connPacket?.direct_pairwise || []).length,
      indirect_path_count: (connPacket?.indirect_paths || []).length,
      api_connectivity_pass: pass,
      baseline_pass: q.api_connectivity_pass,
    });
    byCategory[q.category] = byCategory[q.category] || { total: 0, hits: 0, pass: 0 };
    byCategory[q.category].total++;
    if (pass) byCategory[q.category].pass++;
  } else {
    let rank = null;
    for (let i = 0; i < conns.length; i++) {
      if (connectionMatchesTarget(conns[i], q.target)) {
        rank = i + 1;
        break;
      }
    }
    queryResults.push({
      id: q.id,
      category: q.category,
      target: q.target,
      baseline_rank: q.first_matching_rank,
      new_rank: rank,
      top1_id: conns[0]?.id || conns[0]?.evidence_id || null,
    });
    const cat = (byCategory[q.category] = byCategory[q.category] || { total: 0, top1: 0, top3: 0, top5: 0, top10: 0, hits: 0, mrrSum: 0 });
    cat.total++;
    if (rank !== null) {
      cat.hits++;
      if (rank <= 1) cat.top1++;
      if (rank <= 3) cat.top3++;
      if (rank <= 5) cat.top5++;
      if (rank <= 10) cat.top10++;
      cat.mrrSum += 1 / rank;
    }
  }
}

// Evaluate E01-E10 evidence-contract assertions
const evChecks = [];
const runEv = async (evidence_id) => {
  const r = await executeResearch(read, { operations: [{ op: 'evidence', evidence_id }] });
  return r.results?.[0];
};

const ev01 = await runEv('r13:wp:H8247:H8245');
const ev01Refs = (ev01?.passages || []).map(p => p.ref || p.passage?.ref);
const ev01Jer12 = (ev01?.passages || []).find(p => (p.ref || p.passage?.ref) === 'Jeremiah 1:12');
evChecks.push({
  id: 'E01',
  pass: ev01Refs.includes('Jeremiah 1:11') && ev01Refs.includes('Jeremiah 1:12') && (ev01Jer12?.original_tokens || []).some(t => t.strongs === 'H8245' && t.is_highlighted),
});

const ev02 = await runEv('r13:wp:H8245:H6918');
evChecks.push({
  id: 'E02',
  pass: !ev02 || (ev02.evidence_type !== 'attested_textual_wordplay' && ev02.epistemic !== 'direct_textual_evidence'),
});

const ev03 = await runEv('r13:wp:H1818:H6924');
evChecks.push({
  id: 'E03',
  pass: !ev03 || (ev03.evidence_type !== 'attested_textual_wordplay' && ev03.epistemic !== 'direct_textual_evidence'),
});

const ev04 = await runEv('r13:wp:H0894:H6489');
const w0894ForEv05 = await buildFullCompactWord(read, 'H0894', { connections: 25, etymology: 3, realworld: 0 });
const hasR11LexPekod = (w0894ForEv05.word?.connections || []).some(
  c => c.id === 'r11:lex:H6489:0' || ((c.target?.strongs === 'H6489' || c.target?.strongs === 'H4850') && c.relation === 'shares_root'),
);
evChecks.push({
  id: 'E04_EV05',
  pass: (!ev04 || ev04.evidence_type !== 'documented_root_family') && !hasR11LexPekod,
});

const ezek375 = await handleGetPassage(read, { passage: 'Ezekiel 37:5', depth: 15, word_depth: 0 });
const hasE05FalseIdent = (ezek375.passage_connections || ezek375.connections || []).some(
  c => c.id?.startsWith('r13:interp:21519') || (c.relation === 'explicit_identification' && (c.refs || []).includes('Ezekiel 37:5')),
);
evChecks.push({ id: 'E05', pass: !hasE05FalseIdent });

const ev06 = await runEv('r13:wp:H5146:H5162');
const ev06Gen529 = (ev06?.passages || []).find(p => (p.ref || p.passage?.ref) === 'Genesis 5:29');
evChecks.push({
  id: 'E06',
  pass: Boolean(
    ev06Gen529 &&
      (ev06Gen529.original_tokens || []).some(t => t.strongs === 'H5146' && t.is_highlighted) &&
      (ev06Gen529.original_tokens || []).some(t => t.strongs === 'H5162' && t.is_highlighted),
  ),
});

const gpJer11 = await handleGetPassage(read, { passage: 'Jeremiah 1:11', word_depth: 5 });
const gpPos4 = (gpJer11.verses?.[0]?.words || []).find(w => w.pos === 4)?.strongs;
const evPos4 = (ev01?.passages?.find(p => (p.ref || p.passage?.ref) === 'Jeremiah 1:11')?.original_tokens || []).find(t => (t.word_no ?? t.position) === 4)?.strongs;
evChecks.push({
  id: 'E07',
  pass: Boolean(gpPos4 === 'H0413' && evPos4 === 'H0413'),
});

evChecks.push({
  id: 'E08',
  pass: Boolean((ev01?.passages?.[0]?.original_tokens || []).length > 0 && ev01?.provenance),
});

const w8247 = await buildFullCompactWord(read, 'H8247', { connections: 15, etymology: 3, realworld: 0 });
const chainEdge = selectChainEvidence(w8247.word?.connections || [], 'H8247', 'H8245');
evChecks.push({
  id: 'E09',
  pass: Boolean(chainEdge && chainEdge.id === 'r13:wp:H8247:H8245' && chainEdge.epistemic === 'direct_textual_evidence'),
});

const lxxJer11 = await corpusRpc('compare_hebrew_septuagint_passage_v1', { p_hebrew_book: 24, p_hebrew_chapter: 1, p_hebrew_verse: 11 });
const lxxExod2533 = await corpusRpc('compare_hebrew_septuagint_passage_v1', { p_hebrew_book: 2, p_hebrew_chapter: 25, p_hebrew_verse: 33 });
evChecks.push({
  id: 'E10',
  pass:
    (lxxJer11.documented_alignments?.length || 0) + (lxxJer11.candidate_alignments?.length || 0) > 0 &&
    (lxxExod2533.documented_alignments?.length || 0) + (lxxExod2533.candidate_alignments?.length || 0) > 0,
});

// EV11: C01 (H0120, H1818, H0127) must be a valid 3-pair triangle proof without nearby_cooc or duplicate IDs
const c01Ev = await handleGetConnection(read, ['H0120', 'H1818', 'H0127'], 25);
const c01Ids = (c01Ev.complete_multi_anchor || []).map(c => c.id);
evChecks.push({
  id: 'EV11',
  pass:
    Boolean(c01Ev.graph_proof?.is_valid) &&
    c01Ev.graph_proof?.distinct_anchor_pairs_connected === 3 &&
    c01Ids.length === new Set(c01Ids).size &&
    !c01Ids.some(id => String(id).startsWith('nearby_cooc:')),
});

// EV12: C02 (H8247, H8245, H8246) must have >= 2 distinct edges reaching H8246 without duplicate IDs
const c02Ev = await handleGetConnection(read, ['H8247', 'H8245', 'H8246'], 25);
const c02Ids = (c02Ev.complete_multi_anchor || []).map(c => c.id);
evChecks.push({
  id: 'EV12',
  pass:
    Boolean(c02Ev.graph_proof?.is_valid) &&
    c02Ids.length >= 2 &&
    c02Ids.length === new Set(c02Ids).size,
});

// EV13: Genesis 6:14 vs Leviticus 16:30 distinguishes H3722 homograph senses (H3722B pitch vs H3722A atonement)
const c04Ev = await handleGetConnection(read, ['Genesis 6:14', 'Leviticus 16:30', 'Exodus 2:3', '1 Peter 3:20-21'], 25);
const c04All = [...(c04Ev.complete_multi_anchor || []), ...(c04Ev.direct_pairwise || [])];
evChecks.push({
  id: 'EV13',
  pass: c04All.some(c => String(c.id).startsWith('shared_lemma_homograph:H3722:') && c.relation === 'shared_root_distinct_senses'),
});

// EV14 (U01): Genesis 21:6 discovers Isaac (H3327) <-> laughter (H6712 / H6711)
const gen216Ev = await handleGetPassage(read, { passage: 'Genesis 21:6', depth: 20, word_depth: 5 });
evChecks.push({
  id: 'EV14_U01',
  pass: (gen216Ev.passage_connections || []).some(
    c => JSON.stringify(c).includes('H3327') && (JSON.stringify(c).includes('H6712') || JSON.stringify(c).includes('H6711')),
  ),
});

// EV15 (U03): Genesis 29:32 discovers Reuben (H7205) compound etiology (H7200 + H1121) and does not promote H2029<->H0223 Uriah as attested wordplay
const gen2932Ev = await handleGetPassage(read, { passage: 'Genesis 29:32', depth: 20, word_depth: 5 });
const gen2932Conns = gen2932Ev.passage_connections || [];
evChecks.push({
  id: 'EV15_U03',
  pass:
    gen2932Conns.some(c => JSON.stringify(c).includes('H7205') && (JSON.stringify(c).includes('H7200') || JSON.stringify(c).includes('H1121'))) &&
    !gen2932Conns.some(c => c.id === 'r13:wp:H2029:H0223' && c.evidence_type === 'attested_textual_wordplay'),
});

// U02: Genesis 25:25 discovers Esau (H6215) birth-attribute naming (H0132 / H8181)
const gen2525Ev = await handleGetPassage(read, { passage: 'Genesis 25:25', depth: 20, word_depth: 5 });
evChecks.push({
  id: 'U02',
  pass: (gen2525Ev.passage_connections || []).some(
    c => JSON.stringify(c).includes('H6215') && (JSON.stringify(c).includes('H0132') || JSON.stringify(c).includes('H8181')),
  ),
});

// EV16 (U04): Jonah 1:17 <-> Matthew 12:40 has explicit_typological_quotation and no inverse day/night LXX pair
const u04Ev = await handleGetConnection(read, ['Jonah 1:17', 'Matthew 12:40'], 25);
const u04Conns = [...(u04Ev.complete_multi_anchor || []), ...(u04Ev.direct_pairwise || [])];
evChecks.push({
  id: 'EV16_U04',
  pass:
    Boolean(u04Ev.all_endpoints_connected) &&
    u04Conns.some(c => String(c.id).startsWith('nt_typological_citation:')) &&
    !u04Conns.some(c => c.id === 'passage_lxx:H3915:G2250' || c.id === 'passage_lxx:H3117:G3571'),
});

// Evaluate T'OMIM Hebrew parallel sample
let tomimSummary = null;
if (fs.existsSync(tomimPath)) {
  const tomim = JSON.parse(fs.readFileSync(tomimPath, 'utf8'));
  let hits = 0;
  let top5 = 0;
  for (const pair of tomim.pairs || []) {
    const res = await handleGetPassage(read, { passage: pair.source_ref, depth: 25, word_depth: 0 });
    const conns = res.passage_connections || res.connections || [];
    const idx = conns.findIndex(c => connectionMatchesTarget(c, pair.target_ref));
    if (idx !== -1) {
      hits++;
      if (idx < 5) top5++;
    }
  }
  tomimSummary = {
    total: (tomim.pairs || []).length,
    hits,
    top5,
    recall: Math.round((hits / Math.max(1, (tomim.pairs || []).length)) * 1000) / 1000,
  };
}

const rankedQueries = queryResults.filter(q => q.category !== 'multi_anchor');
const top1 = rankedQueries.filter(q => q.new_rank !== null && q.new_rank <= 1).length;
const top3 = rankedQueries.filter(q => q.new_rank !== null && q.new_rank <= 3).length;
const top5 = rankedQueries.filter(q => q.new_rank !== null && q.new_rank <= 5).length;
const top10 = rankedQueries.filter(q => q.new_rank !== null && q.new_rank <= 10).length;
const hits = rankedQueries.filter(q => q.new_rank !== null).length;
const mrr = Math.round((rankedQueries.reduce((s, q) => s + (q.new_rank ? 1 / q.new_rank : 0), 0) / rankedQueries.length) * 1000) / 1000;
const multiAnchorPass = queryResults.filter(q => q.category === 'multi_anchor' && q.api_connectivity_pass).length;
const evPass = evChecks.filter(e => e.pass).length;

const summary = {
  baseline_release: r13Bench.release?.corpus_release || 'r13-discovery-1',
  baseline_kpis: r13Bench.kpis || null,
  r13_1_kpis: {
    retrieval_cases: rankedQueries.length,
    at1: top1,
    at3: top3,
    at5: top5,
    at10: top10,
    at25: hits,
    mrr,
    connection_api_correct: multiAnchorPass,
    multi_anchor_total: 10,
    evidence_pass: evPass,
    evidence_total: evChecks.length,
  },
  evidence_checks: evChecks,
  tomim_hebrew_parallels: tomimSummary,
  query_diffs: queryResults,
};

console.log(JSON.stringify(summary, null, 2));
if (evPass < 10 || multiAnchorPass < 10) {
  process.exitCode = 1;
}
