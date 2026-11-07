// @file: scripts/notes-guard.mjs
// NOTE-02a: Baseline snapshot, live compare, and static regression guard for the Notes layer.
// Modes:
//   --snapshot: Writes baseline row counts, Gen 1:1 research hash, and MCP /health to .artifacts/notes/baseline.json.
//   --compare:  Re-reads live data and compares with .artifacts/notes/baseline.json, exiting 1 on difference.
//   --static:   Validates no innerHTML/outerHTML in notes files, no supabase-js imports in src/ui, and no secrets in src/ or supabase/functions/.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';
const MCP_URL = `${SUPABASE_URL}/functions/v1/bible-mcp`;

const ARTIFACTS_DIR = path.resolve('.artifacts/notes');
const BASELINE_FILE = path.join(ARTIFACTS_DIR, 'baseline.json');

const TABLES = [
  'verses',
  'words',
  'entity_relationships',
  'semantic_annotations',
  'canonical_entities',
  'lemmas',
  'word_form_lemmas',
  'books',
  'concepts',
  'places',
  'chronology_events',
];

function canonicalJson(val) {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(val).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(val[k])).join(',') + '}';
}

async function getTableCount(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?limit=0`;
  const res = await fetch(url, {
    method: 'HEAD',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: 'count=exact',
    },
  });
  if (res.status === 401 || res.status === 404) {
    return 'unreadable';
  }
  const cr = res.headers.get('content-range');
  if (cr) {
    const m = cr.match(/\/(\d+|\*)$/);
    if (m && m[1] !== '*') {
      return parseInt(m[1], 10);
    }
  }
  if (!res.ok && res.status !== 206) {
    return 'unreadable';
  }
  return null;
}

async function getVerseResearchGen1_1() {
  const url = `${SUPABASE_URL}/rest/v1/rpc/get_verse_research_v1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_request: { passages: [{ book: 1, chapter: 1, verse: 1 }] },
    }),
  });
  if (!res.ok) {
    throw new Error(`get_verse_research_v1 failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  const cjson = canonicalJson(data);
  const hash = crypto.createHash('sha256').update(cjson).digest('hex');
  return {
    hash,
    status: data.status,
    verses_count: data.verses?.length ?? 0,
    words_count: data.verses?.[0]?.words?.length ?? 0,
  };
}

async function getMcpHealth() {
  const res = await fetch(`${MCP_URL}/health`);
  if (!res.ok) {
    throw new Error(`MCP /health failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  return {
    name: data.name,
    version: data.version,
    status: data.status,
    tools: data.tools,
    prompts: data.prompts,
  };
}

async function captureSnapshot() {
  const row_counts = {};
  for (const table of TABLES) {
    row_counts[table] = await getTableCount(table);
  }
  const verse_research = await getVerseResearchGen1_1();
  const mcp_health = await getMcpHealth();
  return {
    captured_at: new Date().toISOString(),
    row_counts,
    verse_research_gen_1_1: verse_research,
    mcp_health,
  };
}

function walkDir(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walkDir(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function runStaticChecks() {
  const violations = [];

  // 1. Check notes files for innerHTML, outerHTML, insertAdjacentHTML
  const notesFiles = [
    ...walkDir('src/ui/components').filter(f => /Note|WordNotes/i.test(path.basename(f))),
    ...walkDir('src/ui').filter(f => /^note-|^notes-/i.test(path.basename(f))),
    ...walkDir('src/api').filter(f => /^notes-/i.test(path.basename(f))),
  ];

  const htmlApiRegex = /\b(innerHTML|outerHTML|insertAdjacentHTML)\b/;
  for (const file of notesFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (htmlApiRegex.test(line)) {
        violations.push({
          check: 'no-inner-html-in-notes',
          file,
          line: idx + 1,
          detail: line.trim(),
        });
      }
    });
  }

  // 2. Check src/ui/** for imports of api/supabase or @supabase/supabase-js
  const uiFiles = walkDir('src/ui').filter(f => /\.(ts|tsx|js|mjs)$/.test(f));
  const supabaseImportRegex = /(?:from\s+['"][^'"]*api\/supabase['"]|from\s+['"]@supabase\/supabase-js['"]|require\(['"][^'"]*api\/supabase['"]\)|require\(['"]@supabase\/supabase-js['"]\)|['"]@supabase\/supabase-js['"])/;
  for (const file of uiFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (supabaseImportRegex.test(line)) {
        violations.push({
          check: 'no-direct-supabase-import-in-ui',
          file,
          line: idx + 1,
          detail: line.trim(),
        });
      }
    });
  }

  // 3. Check src/ and supabase/functions/ for secret strings
  const secretTargetFiles = [...walkDir('src'), ...walkDir('supabase/functions')].filter(f =>
    /\.(ts|tsx|js|mjs|json|css|sql)$/.test(f)
  );
  const secretRegex = /service_role|sb_secret_|eyJ[A-Za-z0-9_-]{20,}/;
  for (const file of secretTargetFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (secretRegex.test(line)) {
        violations.push({
          check: 'no-secrets-in-source',
          file,
          line: idx + 1,
          detail: line.trim().slice(0, 100),
        });
      }
    });
  }

  if (violations.length > 0) {
    console.error(`FAIL: ${violations.length} static rule violation(s) found:`);
    for (const v of violations) {
      console.error(`  [${v.check}] ${v.file}:${v.line} -> ${v.detail}`);
    }
    return false;
  }

  console.log(`PASS: Static checks passed (checked ${notesFiles.length} notes files, ${uiFiles.length} UI files, ${secretTargetFiles.length} source files).`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const doSnapshot = args.includes('--snapshot');
  const doCompare = args.includes('--compare');
  const doStatic = args.includes('--static');

  if (!doSnapshot && !doCompare && !doStatic) {
    console.log('Usage: node scripts/notes-guard.mjs [--snapshot] [--compare] [--static]');
    process.exit(1);
  }

  let exitCode = 0;

  if (doStatic) {
    const ok = runStaticChecks();
    if (!ok) exitCode = 1;
  }

  if (doSnapshot) {
    console.log('Capturing baseline snapshot...');
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const snapshot = await captureSnapshot();
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
    console.log(`Wrote baseline snapshot to ${BASELINE_FILE}`);
    console.log('Row counts:', snapshot.row_counts);
    console.log('Gen 1:1 research hash:', snapshot.verse_research_gen_1_1.hash);
    console.log('MCP health:', snapshot.mcp_health);
  }

  if (doCompare) {
    console.log('Comparing live state against baseline snapshot...');
    if (!fs.existsSync(BASELINE_FILE)) {
      console.error(`ERROR: Baseline file not found at ${BASELINE_FILE}. Run with --snapshot first.`);
      process.exit(1);
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    const live = await captureSnapshot();

    const diffs = [];

    // Compare row counts
    for (const [table, expected] of Object.entries(baseline.row_counts)) {
      const actual = live.row_counts[table];
      if (expected !== actual) {
        diffs.push(`Table '${table}' row count changed: expected ${expected}, got ${actual}`);
      }
    }

    // Compare Gen 1:1 hash
    if (baseline.verse_research_gen_1_1?.hash !== live.verse_research_gen_1_1?.hash) {
      diffs.push(
        `Gen 1:1 verse research hash mismatch: expected ${baseline.verse_research_gen_1_1?.hash}, got ${live.verse_research_gen_1_1?.hash}`
      );
    }

    // Compare MCP health
    if (baseline.mcp_health?.tools !== live.mcp_health?.tools) {
      diffs.push(`MCP tools count changed: expected ${baseline.mcp_health?.tools}, got ${live.mcp_health?.tools}`);
    }
    if (baseline.mcp_health?.prompts !== live.mcp_health?.prompts) {
      diffs.push(`MCP prompts count changed: expected ${baseline.mcp_health?.prompts}, got ${live.mcp_health?.prompts}`);
    }
    if (baseline.mcp_health?.version !== live.mcp_health?.version) {
      diffs.push(`MCP version changed: expected ${baseline.mcp_health?.version}, got ${live.mcp_health?.version}`);
    }

    if (diffs.length > 0) {
      console.error(`FAIL: ${diffs.length} baseline mismatch(es) detected:`);
      for (const d of diffs) {
        console.error(`  - ${d}`);
      }
      exitCode = 1;
    } else {
      console.log('PASS: Baseline comparison succeeded. All row counts, Gen 1:1 hash, and MCP health match.');
    }
  }

  process.exit(exitCode);
}

main().catch(err => {
  console.error('Fatal error in notes-guard:', err);
  process.exit(1);
});
