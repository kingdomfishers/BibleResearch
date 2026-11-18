#!/usr/bin/env node
/**
 * R12 benchmark triage runner (Node 20+).
 *
 * This tool searches for candidate matches near the top of live discovery results.
 * It NEVER declares an interpretive or source-quality PASS automatically:
 * equivalent paraphrases and genuine evidence require human review or a separate LLM judge.
 *
 * Usage:
 *   node scripts/evaluate-r12-expected-connections.mjs --max=5
 *   node scripts/evaluate-r12-expected-connections.mjs --id=S018 --evidence
 *   node scripts/evaluate-r12-expected-connections.mjs --category=real_world_process --max=8
 *   node scripts/evaluate-r12-expected-connections.mjs --all --delay-ms=1500 --output=/tmp/r12-review.json
 *
 * Safety: serial requests only; default max 5; --all is explicit; read-only POST only.
 * SOURCE: research/r12/R12_EXPECTED_CONNECTIONS_180_PLUS.json
 */
import fs from 'node:fs/promises';

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith('--' + name + '='))?.slice(name.length + 3);
const has = (name) => args.includes('--' + name);
const isPositiveInt = (n) => Number.isInteger(n) && n > 0;
const delay = Number(option('delay-ms') ?? 600);
const max = Number(option('max') ?? 5);
const baseUrl = (option('url') ?? 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev').replace(/\/+$/, '');
const withEvidence = has('evidence');
const output = option('output');

if (has('help')) {
  process.stdout.write('R12 benchmark: --max=5 [--id=S018] [--category=linguistic_form] [--evidence] [--all] [--delay-ms=1000] [--url=BASE] [--output=FILE]\n');
  process.exit(0);
}
if (!isPositiveInt(max) || !Number.isInteger(delay) || delay < 0 || delay > 60000) {
  throw new Error('Invalid --max or --delay-ms (must be >=0 and <=60000).');
}

const benchmark = JSON.parse(await fs.readFile(new URL('../research/r12/R12_EXPECTED_CONNECTIONS_180_PLUS.json', import.meta.url), 'utf8'));
if (benchmark.schema_version !== 'r12-expected-connections-v1' || !Array.isArray(benchmark.cases)) {
  throw new Error('Wrong benchmark schema.');
}
let selected = benchmark.cases;
if (option('id')) selected = selected.filter((c) => c.id === option('id'));
if (option('category')) selected = selected.filter((c) => c.category === option('category'));
if (!has('all')) selected = selected.slice(0, max);
if (!selected.length) throw new Error('No selected benchmark cases.');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(tool, payload) {
  const started = performance.now();
  const response = await fetch(baseUrl + '/v1/rpc/' + tool, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + body.slice(0, 280));
  return { data: JSON.parse(body), elapsed_ms: Math.round(performance.now() - started) };
}

function normal(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function flattened(record) {
  // This is a *recall-oriented candidate filter*, NOT evidence verification.
  return normal([
    record.title, record.summary, record.predicate, record.evidence_id,
    record.target_node_id, record.source_node_id, record.epistemic_class,
    JSON.stringify(record.original_words || []),
    JSON.stringify(record.passages || []),
    JSON.stringify(record.matched_terms || []),
    JSON.stringify(record.r12_metadata?.steps || []),
  ].filter(Boolean).join(' '));
}

function candidatesFor(testCase, response) {
  const k = testCase.polarity === 'positive'
    ? testCase.expected.top_k
    : testCase.expected.disallowed_rank_at_or_above;
  const top = Array.isArray(response.strongest_connections)
    ? response.strongest_connections.slice(0, k) : [];
  const aliases = testCase.expected.acceptable_target_terms.map(normal).filter(Boolean);
  const refs = testCase.expected.biblical_witnesses.map(normal);
  return top.flatMap((result, index) => {
    const hay = flattened(result);
    const matched_aliases = aliases.filter((term) => hay.includes(term));
    if (!matched_aliases.length) return [];
    return [{
      rank: index + 1,
      evidence_id: result.evidence_id || null,
      title: result.title || null,
      epistemic_class: result.epistemic_class || null,
      matched_aliases,
      matched_witnesses: refs.filter((ref) => hay.includes(ref)),
    }];
  }).slice(0, 5);
}

const results = [];
for (const [index, c] of selected.entries()) {
  const started = performance.now();
  try {
    const response = await rpc(c.mcp_call.tool, c.mcp_call.arguments);
    const candidates = candidatesFor(c, response.data);
    const entry = {
      id: c.id, category: c.category, difficulty: c.difficulty,
      polarity: c.polarity, expected: c.expected.relationship ?? c.expected.forbidden_claim,
      status: c.polarity === 'positive'
        ? (candidates.length ? 'CANDIDATE_FOR_EVIDENCE_REVIEW' : 'NO_ALIAS_IN_TOP_K')
        : (candidates.length ? 'SUSPECT_REQUIRES_EPISTEMIC_REVIEW' : 'NO_OBVIOUS_VIOLATION'),
      rank_of_first_candidate: candidates[0]?.rank ?? null,
      requested_top_k: c.expected.top_k ?? c.expected.disallowed_rank_at_or_above,
      candidates, response_status: response.data.status || null,
      pilot_release: response.data.r12_discovery?.release_id || null,
      pilot_anchors: response.data.r12_discovery?.pilot_anchors_matched || [],
      http_elapsed_ms: response.elapsed_ms,
    };
    if (withEvidence && candidates[0]?.evidence_id) {
      try {
        const evidence = await rpc(c.evidence_followup.tool, { evidence_id: candidates[0].evidence_id });
        const e = evidence.data.evidence ?? {};
        entry.evidence_triage = {
          status: evidence.data.status, title: e.title, summary: e.summary,
          epistemic_class: e.epistemic_class,
          passage_refs: (e.passages || []).map((p) => p.ref).slice(0, 12),
          limitations: e.limitations || [],
          provenance: e.provenance || null,
        };
      } catch (error) {
        entry.evidence_triage_error = String(error);
      }
    }
    results.push(entry);
  } catch (error) {
    results.push({
      id: c.id, category: c.category, status: 'TRANSPORT_OR_SERVER_ERROR',
      error: String(error), elapsed_ms: Math.round(performance.now() - started),
    });
  }
  process.stderr.write((index + 1) + '/' + selected.length + ' ' + c.id + ' ' + results.at(-1).status + '\n');
  if (index + 1 < selected.length) await sleep(delay);
}
const summary = results.reduce((a, r) => {
  a[r.status] = (a[r.status] || 0) + 1;
  return a;
}, {});
const bundle = {
  benchmark_schema_version: benchmark.schema_version,
  run_at: new Date().toISOString(),
  endpoint: baseUrl,
  selected_count: selected.length,
  caveat: 'Candidate triage only. A correct semantic target, direct witnesses, path coherence, and honest epistemic classification must be reviewed before counting PASS@K. Negative suspicion alone is not a violation.',
  summary, results,
};
const formatted = JSON.stringify(bundle, null, 2) + '\n';
if (output) {
  await fs.writeFile(output, formatted, 'utf8');
  process.stderr.write('Review file written: ' + output + '\n');
} else {
  process.stdout.write(formatted);
}
