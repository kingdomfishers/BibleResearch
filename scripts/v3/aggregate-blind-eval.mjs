#!/usr/bin/env node
/**
 * Combine BLIND_KEY.json, scores_B1_B6.json, scores_H1_H3.json, and MCP JSONL telemetry
 * into research/v3/eval-final/BLIND_SCORES.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const evalDir = path.join(repoRoot, 'research', 'v3', 'eval-final');
const baseDir = path.join(repoRoot, 'research', 'v3', 'baseline');

const DIMS = [
  'depth_grounding',
  'verified_nonredundant_connections',
  'surprising_rare_discoveries',
  'intermediate_bridges_macro_patterns',
  'evidence_accuracy_low_fp',
  'overall_research_utility',
];

function parseJsonlTelemetry(fp) {
  if (!fs.existsSync(fp)) return null;
  const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter(Boolean);
  let calls = 0;
  let errors = 0;
  let wireBytes = 0;
  let maxLatencyMs = 0;
  let totalLatencyMs = 0;
  const seen = new Set();
  let dup = 0;

  for (const line of lines) {
    const row = JSON.parse(line);
    calls++;
    if (row.is_error || row.isError || row.error || row.status === 'error' || (row.http_status && row.http_status >= 400)) errors++;
    wireBytes += Number(row.wire_bytes ?? row.responseBytes ?? row.bytes ?? 0);
    const lat = Number(row.latency_ms ?? row.durationMs ?? row.latencyMs ?? 0);
    totalLatencyMs += lat;
    if (lat > maxLatencyMs) maxLatencyMs = lat;
    const sig = `${row.tool}|${JSON.stringify(row.args || {})}`;
    if (seen.has(sig)) dup++;
    else seen.add(sig);
  }
  return {
    calls,
    errors,
    dup,
    wireKB: Number((wireBytes / 1024).toFixed(1)),
    totalLatencySec: Number((totalLatencyMs / 1000).toFixed(1)),
    maxLatencySec: Number((maxLatencyMs / 1000).toFixed(1)),
  };
}

function summarizeGroup(taskRows, arms) {
  const out = {};
  for (const arm of arms) {
    const dimSums = Object.fromEntries(DIMS.map((d) => [d, 0]));
    let rank1Count = 0;
    let meanSum = 0;
    for (const r of taskRows) {
      const s = r.byArm[arm];
      let rowMean = 0;
      for (const d of DIMS) {
        dimSums[d] += Number(s[d] || 0);
        rowMean += Number(s[d] || 0);
      }
      meanSum += rowMean / DIMS.length;
      if (r.rankOrderArms[0] === arm) rank1Count++;
    }
    const n = taskRows.length;
    out[arm] = {
      tasks: n,
      rank1Wins: rank1Count,
      overallMean: Number((meanSum / n).toFixed(2)),
      dims: Object.fromEntries(DIMS.map((d) => [d, Number((dimSums[d] / n).toFixed(2))])),
    };
  }
  return out;
}

function main() {
  const key = JSON.parse(fs.readFileSync(path.join(evalDir, 'BLIND_KEY.json'), 'utf8'));
  const sB = JSON.parse(fs.readFileSync(path.join(evalDir, 'scores_B1_B6.json'), 'utf8'));
  const sH = JSON.parse(fs.readFileSync(path.join(evalDir, 'scores_H1_H3.json'), 'utf8'));
  const rawTasks = { ...(sB.tasks || {}), ...(sH.tasks || {}) };

  const tasks = [];
  for (const id of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'H1', 'H2', 'H3']) {
    const k = key[id];
    const t = rawTasks[id];
    if (!k || !t) throw new Error(`Missing key or score for ${id}`);

    const byArm = {};
    for (const [sysLabel, arm] of Object.entries(k.mapping)) {
      const sc = t.scores?.[sysLabel];
      if (!sc) throw new Error(`Missing scores for ${id} ${sysLabel}`);
      const mean = DIMS.reduce((a, d) => a + Number(sc[d] || 0), 0) / DIMS.length;
      byArm[arm] = { ...sc, mean: Number(mean.toFixed(2)) };
    }
    const rankOrderArms = (t.rank_order || []).map((lbl) => k.mapping[lbl] || lbl);
    const v2Jsonl = id.startsWith('B') ? path.join(baseDir, `live_${id}.jsonl`) : path.join(evalDir, `v2_${id}.jsonl`);
    const v3Jsonl = path.join(evalDir, `v3_${id}.jsonl`);

    tasks.push({
      id,
      set: id.startsWith('B') ? 'B1-B6' : 'H1-H3',
      rankOrderArms,
      rationale: t.rationale || '',
      byArm,
      telemetry: {
        v2_live: parseJsonlTelemetry(v2Jsonl),
        v3_local: parseJsonlTelemetry(v3Jsonl),
      },
    });
  }

  const arms = ['nomcp', 'v2', 'v3'];
  const summary = {
    all_9_tasks: summarizeGroup(tasks, arms),
    B1_B6: summarizeGroup(tasks.filter((t) => t.set === 'B1-B6'), arms),
    H1_H3: summarizeGroup(tasks.filter((t) => t.set === 'H1-H3'), arms),
  };

  const result = {
    generatedAt: new Date().toISOString(),
    methodology: {
      note: 'B1-B6 (N=6) and frozen holdout H1-H3 (N=3) anonymized via random System X/Y/Z permutation (H4-H6 deferred to live ChatGPT evaluation). v2 ran against live production corpus; v3 ran against frozen local bundle.',
      dimensions: DIMS,
    },
    summary,
    tasks,
  };

  const outPath = path.join(evalDir, 'BLIND_SCORES.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log('Wrote', path.relative(repoRoot, outPath));
  console.log(JSON.stringify(summary, null, 2));
}

main();
