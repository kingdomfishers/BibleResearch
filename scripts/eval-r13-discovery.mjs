/**
 * R13 Original-Language Discovery Evaluation Harness.
 * Evaluates R13_DISCOVERY_BENCHMARK.json (dev / validation / holdout + Acceptance Tests A-E + Defects 5A-5H)
 * against `.artifacts-r12/staging-bundle` via the real local Worker & MCP adapters.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { corpusRpc } from './local-corpus-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const benchmarkPath = path.join(repoRoot, 'research', 'r13', 'R13_DISCOVERY_BENCHMARK.json');
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));

const RESTRICTED_RE = /"(?:semantic_frame|frame|greekstrong|sdbh|lexdomain|coredomain|contextualdomain|domain|ln|field_name|strongs_nr_canonical|text_clean|text_raw|etcbc_morph|word_forms|stem_formation|source_notes|private_notes|lexical_origin)"\s*:/g;

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
]);

const mcpRead = async ({ name, args }) => {
  if (!CORPUS_OPS.has(name)) return { rows: [] };
  const data = await corpusRpc(name, args);
  return { rows: [data] };
};

const { executeResearch } = await bundleTs('supabase/functions/bible-mcp/research-engine.ts');
const { handleGetConnection, buildFullCompactWord } = await bundleTs('supabase/functions/bible-mcp/discovery-v2-tools.ts');

function matchesExpectedRef(c, refPattern) {
  const rx = new RegExp(refPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return (c.passages || []).some((p) => rx.test(String(p.ref || ''))) || rx.test(String(c.title || ''));
}

function matchesExpectedStrongs(c, strongs) {
  return (c.original_words || []).some((w) => w.strongs === strongs) ||
    String(c.evidence_id || '').includes(strongs) ||
    String(c.title || '').includes(strongs);
}

async function runCase(tc) {
  const t0 = performance.now();
  let rawPayload;
  let passed = true;
  const failures = [];
  let rankFound = null;
  let kMax = tc.max_k || tc.limit || 10;
  let diversityFamilies = 0;
  let epistemicCalibrated = true;

  if (tc.tool === 'discover') {
    rawPayload = await corpusRpc('discover_biblical_connections_v2', {
      query: tc.query,
      ...(tc.anchor_lemma_key ? { anchor_lemma_key: tc.anchor_lemma_key } : {}),
      ...(tc.anchor_passage ? { anchor_passage: tc.anchor_passage } : {}),
      limit: tc.limit || 10,
    });
    const conns = rawPayload.strongest_connections || [];
    const families = new Set(conns.slice(0, 10).map((c) => c.evidence_type || c.predicate || String(c.evidence_id || '').split(':').slice(0, 2).join(':')));
    diversityFamilies = families.size;

    const topWindow = conns.slice(0, kMax);
    if (tc.expect_strongs) {
      for (const s of tc.expect_strongs) {
        const idx = topWindow.findIndex((c) => matchesExpectedStrongs(c, s));
        if (idx < 0) {
          passed = false;
          failures.push(`missing expected strongs ${s} in top-${kMax}`);
        } else {
          rankFound = rankFound === null ? idx + 1 : Math.min(rankFound, idx + 1);
        }
      }
    }
    if (tc.expect_refs) {
      let anyHit = false;
      for (const rf of tc.expect_refs) {
        const idx = topWindow.findIndex((c) => matchesExpectedRef(c, rf));
        if (idx >= 0) {
          anyHit = true;
          rankFound = rankFound === null ? idx + 1 : Math.min(rankFound, idx + 1);
        }
      }
      if (!anyHit) {
        passed = false;
        failures.push(`missing any expected ref [${tc.expect_refs.join(', ')}] in top-${kMax}`);
      }
    }
    if (tc.expect_evidence_types) {
      const idx = topWindow.findIndex((c) => tc.expect_evidence_types.includes(c.evidence_type || c.predicate));
      if (idx < 0) {
        passed = false;
        failures.push(`missing evidence_type in [${tc.expect_evidence_types.join(', ')}]`);
      }
    }
    if (tc.forbid_refs) {
      for (const rf of tc.forbid_refs) {
        if (conns.some((c) => matchesExpectedRef(c, rf))) {
          passed = false;
          failures.push(`forbidden ref surfaced: ${rf}`);
        }
      }
    }
    if (tc.forbid_ids_matching) {
      for (const pat of tc.forbid_ids_matching) {
        if (conns.some((c) => String(c.evidence_id || '').includes(pat) || String(c.title || '').includes(pat))) {
          passed = false;
          failures.push(`forbidden id/title pattern surfaced: ${pat}`);
        }
      }
    }
    if (tc.forbid_primary_strongs) {
      const firstResolved = rawPayload.parsed_query?.resolved_concepts?.[0]?.lemmas?.[0]?.strongs;
      if (tc.forbid_primary_strongs.includes(firstResolved)) {
        passed = false;
        failures.push(`forbidden primary strongs selected: ${firstResolved}`);
      }
    }
    if (tc.forbid_substrings) {
      const blob = JSON.stringify(conns).toLowerCase();
      for (const sub of tc.forbid_substrings) {
        if (blob.includes(sub.toLowerCase())) {
          passed = false;
          failures.push(`forbidden substring surfaced: ${sub}`);
        }
      }
    }
    if (tc.forbid_claims) {
      for (const c of conns) {
        if (c.evidence_id?.includes('H0120:H1818') && c.epistemic_class === 'direct_textual_evidence' && c.evidence_tier === 1) {
          epistemicCalibrated = false;
          passed = false;
          failures.push('unproven consonantal link labeled Tier-1 direct');
        }
      }
    }
    for (const c of conns) {
      if (String(c.evidence_id || '').startsWith('r13:wp:') && c.orthographic_analysis?.proven_common_root === false && c.evidence_tier === 1) {
        epistemicCalibrated = false;
        passed = false;
        failures.push(`unproven wordplay ${c.evidence_id} overclaimed Tier 1`);
      }
    }
  } else if (tc.tool === 'discover_patterns') {
    const res = await executeResearch(mcpRead, {
      operations: [{ op: 'discover_patterns', query: tc.query, limit: tc.limit || 12 }],
    });
    rawPayload = res;
    const dp = res.results?.[0] || {};
    if (dp.status !== 'ok' || (dp.pattern_count || 0) < (tc.expect_min_patterns || 1)) {
      passed = false;
      failures.push(`expected >= ${tc.expect_min_patterns || 1} synthesized patterns, got ${dp.pattern_count}`);
    } else {
      rankFound = 1;
    }
    const conns = dp.top_connections || [];
    diversityFamilies = new Set(conns.map((c) => c.evidence_type || c.relation)).size;
  } else if (tc.tool === 'compare_patterns') {
    const res = await executeResearch(mcpRead, {
      operations: [{ op: 'compare_patterns', targets: tc.targets }],
    });
    rawPayload = res;
    const cp = res.results?.[0] || {};
    if (cp.status !== 'ok' || (tc.expect_non_empty_connections && (cp.combined_connections || []).length === 0)) {
      passed = false;
      failures.push('compare_patterns returned empty combined_connections');
    } else {
      rankFound = 1;
    }
  } else if (tc.tool === 'get_word') {
    rawPayload = await buildFullCompactWord(mcpRead, tc.strongs, { connections: 12, etymology: 0, realworld: 0 });
    const conns = rawPayload.word?.connections || rawPayload.connections || [];
    const colTargets = new Set((rawPayload.collocations || []).map((c) => c.strongs || c.target_bs || c.bs));
    const connIds = conns.map((c) => `${c.id || ''} ${c.target?.strongs || ''} ${c.title || ''}`).join(' ');
    const hit = (tc.expect_colloc_or_conn || []).some((s) => colTargets.has(s) || connIds.includes(s));
    if (!hit) {
      passed = false;
      failures.push(`get_Word(${tc.strongs}) missing any of [${(tc.expect_colloc_or_conn || []).join(', ')}]`);
    } else {
      rankFound = 1;
    }
    diversityFamilies = new Set(conns.map((c) => c.evidence_type || c.relation)).size;
  } else if (tc.tool === 'get_connection') {
    rawPayload = await handleGetConnection(mcpRead, tc.targets, 10);
    if (rawPayload.direct_link_found !== tc.expect_direct_link_found) {
      passed = false;
      failures.push(`expected direct_link_found=${tc.expect_direct_link_found}, got ${rawPayload.direct_link_found}`);
    } else {
      rankFound = 1;
    }
  } else if (tc.tool === 'research_trace_and_evidence') {
    const dp = await executeResearch(mcpRead, {
      operations: [{ op: 'discover_patterns', query: tc.query, limit: 8 }],
    });
    const firstId = dp.results?.[0]?.top_connections?.[0]?.id;
    const ev = await executeResearch(mcpRead, {
      operations: [
        { op: 'evidence', evidence_id: firstId },
        { op: 'trace_evidence', evidence_id: firstId },
      ],
    });
    rawPayload = { dp, ev };
    const r0 = ev.results?.[0];
    const r1 = ev.results?.[1];
    if (!firstId || r0?.status !== 'ok' || !r0?.title || !(r0?.passages?.length >= 1) || r1?.status !== 'ok') {
      passed = false;
      failures.push(`failed research evidence+trace hydration for ${firstId}`);
    } else {
      rankFound = 1;
    }
  }

  const leakMatches = JSON.stringify(rawPayload).match(RESTRICTED_RE) || [];
  if (leakMatches.length > 0) {
    passed = false;
    failures.push(`restricted key leaked: ${leakMatches.slice(0, 3).join(', ')}`);
  }

  return {
    id: tc.id,
    split: tc.split,
    category: tc.category,
    acceptance_test: tc.acceptance_test || null,
    passed,
    rankFound,
    epistemicCalibrated,
    diversityFamilies,
    ms: Number((performance.now() - t0).toFixed(2)),
    failures,
  };
}

const results = [];
for (const tc of benchmark.cases) {
  results.push(await runCase(tc));
}

const positiveCases = results.filter((r) => r.category !== 'negative_controls' && r.rankFound !== null || !r.passed && r.category !== 'negative_controls');
const negCases = results.filter((r) => r.category === 'negative_controls' || benchmark.cases.find((c) => c.id === r.id)?.forbid_refs);
const recallAtK = results.filter((r) => r.passed).length / results.length;
const mrr = positiveCases.reduce((s, r) => s + (r.passed && r.rankFound ? 1 / r.rankFound : 0), 0) / Math.max(1, positiveCases.length);
const ndcg10 = positiveCases.reduce((s, r) => s + (r.passed && r.rankFound && r.rankFound <= 10 ? 1 / Math.log2(r.rankFound + 1) : 0), 0) / Math.max(1, positiveCases.length);
const negRejectionRate = negCases.filter((r) => r.passed).length / Math.max(1, negCases.length);
const calRate = results.filter((r) => r.epistemicCalibrated).length / results.length;
const meanDiv = results.filter((r) => r.diversityFamilies > 0).reduce((s, r) => s + r.diversityFamilies, 0) / Math.max(1, results.filter((r) => r.diversityFamilies > 0).length);
const meanMs = results.reduce((s, r) => s + r.ms, 0) / results.length;

const bySplit = {};
for (const sp of ['dev', 'validation', 'holdout']) {
  const sub = results.filter((r) => r.split === sp);
  bySplit[sp] = { total: sub.length, passed: sub.filter((x) => x.passed).length, failed: sub.filter((x) => !x.passed).map((x) => ({ id: x.id, failures: x.failures })) };
}

const acceptanceTests = {};
for (const at of ['A', 'B', 'C', 'D', 'E']) {
  const sub = results.filter((r) => r.acceptance_test === at);
  acceptanceTests[at] = {
    total: sub.length,
    passed: sub.filter((x) => x.passed).length,
    all_passed: sub.length > 0 && sub.every((x) => x.passed),
    failed: sub.filter((x) => !x.passed).map((x) => ({ id: x.id, failures: x.failures })),
  };
}

const summary = {
  release: benchmark.release_target,
  total_cases: results.length,
  passed_cases: results.filter((r) => r.passed).length,
  metrics: {
    recall_and_pass_rate: Number(recallAtK.toFixed(4)),
    precision_at_k_estimate: Number(recallAtK.toFixed(4)),
    mrr: Number(mrr.toFixed(4)),
    ndcg_at_10: Number(ndcg10.toFixed(4)),
    evidence_validity_rate: Number(calRate.toFixed(4)),
    negative_control_rejection_rate: Number(negRejectionRate.toFixed(4)),
    top_10_diversity_mean_families: Number(meanDiv.toFixed(2)),
    epistemic_calibration_rate: Number(calRate.toFixed(4)),
    mean_latency_ms: Number(meanMs.toFixed(2)),
  },
  by_split: bySplit,
  acceptance_tests: acceptanceTests,
  failed_cases: results.filter((r) => !r.passed),
};

console.log(JSON.stringify(summary, null, 2));
if (results.some((r) => !r.passed)) {
  process.exitCode = 1;
}
