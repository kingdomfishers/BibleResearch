#!/usr/bin/env node
/**
 * Anonymize 3-arm reports (No-MCP, v2 MCP, v3 MCP) for B1-B6 and H1-H3 into
 * randomized System X / System Y / System Z packets + BLIND_KEY.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const evalSetsPath = path.join(repoRoot, 'research', 'v3', 'EVAL_SETS.json');
const outDir = path.join(repoRoot, 'research', 'v3', 'eval-final', 'blind_packets');
const keyPath = path.join(repoRoot, 'research', 'v3', 'eval-final', 'BLIND_KEY.json');

const META_HEADING_RE = /^##\s+(?:\d+\.\s+)?(?:Exact MCP Tool Calls|Discoveries Enabled by|Missing Connections|Dead Ends|Self-Assessment|Tool(?:set)?\s+(?:Coverage|Evaluation|Self-Assessment)|Methodological\s*(?:&|and)?\s*Tool|Evaluation\s*&\s*Toolset|Research Tool\s*(?:&|and)\s*Methodological|Verification\s+(?:Ledger|Checklist|Register)|Claims Requiring Primary-Text Verification|Epistemic\s+(?:Audit|Boundaries).*?(?:Self-Assessment|Coverage Limits))/i;

const TOOL_IDS = [
  'get_Connection',
  'follow_connectionchain',
  'tri_textual_diff',
  'lxx_concordance',
  'sequence_parallels',
  'wordplay_scan',
  'clause_role_query',
  'expand_clue',
  'set_combine',
  'literary_structure',
  'get_Passage',
  'get_Word',
  'get_prompt',
  'analyze_passage',
  'research_engine',
];

function stripMetaSections(md) {
  const lines = md.split(/\r?\n/);
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (META_HEADING_RE.test(line.trim())) {
        skipping = true;
        continue;
      }
      skipping = false;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').trim();
}

function sanitizeText(md) {
  let out = stripMetaSections(md);

  // Title/banner arm labels
  out = out.replace(/\(\s*B\d\s*[—–-]\s*No-MCP Control Arm\s*\)/gi, '');
  out = out.replace(/\(\s*No-MCP Control (?:Arm|Evaluation)\s*\)/gi, '');
  out = out.replace(/\s*`\[UNVERIFIED AGAINST PRIMARY CORPUS\]`/gi, '');
  out = out.replace(/\s*\[UNVERIFIED AGAINST PRIMARY CORPUS\]/gi, '');
  out = out.replace(/\s*`\[UNVERIFIED\]`/gi, '');
  out = out.replace(/\s*\[UNVERIFIED\]/gi, '');
  out = out.replace(/\s*`\[U\]`/g, '');
  out = out.replace(/\s*\[U\]/g, '');
  out = out.replace(/\bNo-MCP(?:\s+Control(?:\s+Arm|\s+Evaluation)?)?\b/gi, 'baseline knowledge');

  // Tool/version/environment leaks
  out = out.replace(/~v3c:[^\s`'")\]]+/g, '[handle]');
  out = out.replace(/\bmcp-bench-cli(?:\.mjs)?\b/gi, '[cli]');
  out = out.replace(/\b(?:BibleResearch\s+)?MCP(?:\s+server|\s+CLI|\s+tool(?:s|\s+call)?s?)?\b/gi, 'research engine');
  out = out.replace(/\b(?:v2|v3|r8-v1\.\d+|r9b-v1\.\d+|r12|r13)\b/gi, 'system');
  out = out.replace(/\b(?:live|local)\s+(?:endpoint|worker|server|target|corpus|mode)\b/gi, 'corpus');
  out = out.replace(/--(?:target|no-supabase|session|log|args-b64)\b/g, '');
  out = out.replace(/C:\\Projects\\[^\s`'")\]]+/gi, '[path]');
  out = out.replace(/(?:scripts|research|supabase)\/[^\s`'")\]]+/gi, '[path]');

  for (const tool of TOOL_IDS) {
    out = out.replace(new RegExp('`?' + tool + '`?', 'gi'), 'query module');
  }

  // Collapse excess blank lines created by stripping
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

function shuffledSystems() {
  const arms = ['nomcp', 'v2', 'v3'];
  for (let i = arms.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arms[i], arms[j]] = [arms[j], arms[i]];
  }
  return {
    'System X': arms[0],
    'System Y': arms[1],
    'System Z': arms[2],
  };
}

function checkLeaks(text) {
  const pat = /\b(v2|v3|No-MCP|mcp-bench-cli|follow_connectionchain|tri_textual_diff|lxx_concordance|sequence_parallels|wordplay_scan|clause_role_query|expand_clue|get_Connection)\b|~v3c:/gi;
  return [...new Set((text.match(pat) || []).map((m) => m.toLowerCase()))];
}

function main() {
  const evalSets = JSON.parse(fs.readFileSync(evalSetsPath, 'utf8'));
  const taskMap = new Map();
  for (const grp of ['baseline_and_comparison', 'development_optimization', 'frozen_holdout']) {
    for (const item of evalSets[grp] || []) taskMap.set(item.id, item);
  }

  const ids = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'H1', 'H2', 'H3'];
  fs.mkdirSync(outDir, { recursive: true });
  const key = {};
  const leakSummary = [];

  for (const id of ids) {
    const task = taskMap.get(id);
    if (!task) throw new Error(`Missing task metadata for ${id}`);

    const files = id.startsWith('B')
      ? {
          nomcp: path.join(repoRoot, 'research', 'v3', 'baseline', `report_nomcp_${id}.md`),
          v2: path.join(repoRoot, 'research', 'v3', 'baseline', `report_live_${id}.md`),
          v3: path.join(repoRoot, 'research', 'v3', 'eval-final', `report_v3_${id}.md`),
        }
      : {
          nomcp: path.join(repoRoot, 'research', 'v3', 'eval-final', `report_nomcp_${id}.md`),
          v2: path.join(repoRoot, 'research', 'v3', 'eval-final', `report_v2_${id}.md`),
          v3: path.join(repoRoot, 'research', 'v3', 'eval-final', `report_v3_${id}.md`),
        };

    for (const [arm, fp] of Object.entries(files)) {
      if (!fs.existsSync(fp)) throw new Error(`Missing report for ${id} arm=${arm}: ${fp}`);
    }

    const mapping = shuffledSystems();
    key[id] = {
      mapping,
      files: Object.fromEntries(
        Object.entries(mapping).map(([label, arm]) => [label, path.relative(repoRoot, files[arm]).replace(/\\/g, '/')])
      ),
    };

    const parts = [
      `# Blind Evaluation Packet — ${id} (${task.domain})`,
      '',
      `**Research Question:** ${task.prompt}`,
      '',
      'Compare **System X**, **System Y**, and **System Z** strictly on research quality, original-language accuracy, verified non-redundant connections, surprising/rare discoveries, intermediate bridges, and epistemic rigor.',
      '',
    ];

    for (const label of ['System X', 'System Y', 'System Z']) {
      const arm = mapping[label];
      const cleaned = sanitizeText(fs.readFileSync(files[arm], 'utf8'));
      const leaks = checkLeaks(cleaned);
      if (leaks.length > 0) leakSummary.push({ id, label, arm, leaks });
      parts.push('---', '', `# ${label}`, '', cleaned, '');
    }

    const packetPath = path.join(outDir, `blind_${id}.md`);
    fs.writeFileSync(packetPath, parts.join('\n'), 'utf8');
  }

  fs.writeFileSync(keyPath, JSON.stringify(key, null, 2) + '\n', 'utf8');
  console.log(`Prepared ${ids.length} blind packets in ${path.relative(repoRoot, outDir)}`);
  console.log(`Key written to ${path.relative(repoRoot, keyPath)}`);
  console.log(`Residual leak audit hits: ${leakSummary.length}`, leakSummary.length ? leakSummary : 'CLEAN');
}

main();
