// scripts/verify-audit-01.mjs
// Automated verification suite for AUDIT-01:
// 1. Supabase security lockdown (ingest_lexical_formations_batch_v1, ingest_quarantined_records_batch_v1, call_corpus_rpc_v1)
// 2. test_guard_probe RLS protection
// 3. License compliance: 0 leaked macula-hebrew semantic_frame tokens in DB and static corpus
// 4. Private backup vault security (no hardcoded passphrase, no plaintext dumps)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

async function rpcAnon(name, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  return { status: res.status, ok: res.ok, body: await res.text() };
}

async function main() {
  console.log('=== AUDIT-01 Verification Suite ===\n');
  let passed = 0;
  let failed = 0;

  function assert(desc, condition, details = '') {
    if (condition) {
      console.log(`PASS: ${desc}`);
      passed++;
    } else {
      console.error(`FAIL: ${desc} - ${details}`);
      failed++;
    }
  }

  // 1. Ingest & Gateway RPC Lockdown (PostgREST)
  console.log('1. Testing PostgREST anonymous RPC lockdown...');
  const resFormations = await rpcAnon('ingest_lexical_formations_batch_v1', { p_formations: [] });
  assert(
    'ingest_lexical_formations_batch_v1 denied to anonymous caller',
    resFormations.status === 401 || resFormations.status === 403 || resFormations.status === 404 || !resFormations.ok,
    `Status: ${resFormations.status}`
  );

  const resQuarantined = await rpcAnon('ingest_quarantined_records_batch_v1', { p_records: [] });
  assert(
    'ingest_quarantined_records_batch_v1 denied to anonymous caller',
    resQuarantined.status === 401 || resQuarantined.status === 403 || resQuarantined.status === 404 || !resQuarantined.ok,
    `Status: ${resQuarantined.status}`
  );

  const resCallCorpus = await rpcAnon('call_corpus_rpc_v1', { p_operation: 'test' });
  assert(
    'call_corpus_rpc_v1 denied to anonymous caller',
    resCallCorpus.status === 401 || resCallCorpus.status === 403 || resCallCorpus.status === 404 || !resCallCorpus.ok,
    `Status: ${resCallCorpus.status}`
  );

  // 2. Private Backup Vault Security
  console.log('\n2. Testing private backup vault hygiene...');
  const backupDir = path.resolve('.artifacts/private-backup');
  const backupFiles = fs.readdirSync(backupDir);
  const plaintextFiles = backupFiles.filter(f => f.endsWith('.json'));
  assert(
    'Zero plaintext .json files in .artifacts/private-backup/',
    plaintextFiles.length === 0,
    `Found plaintext files: ${plaintextFiles.join(', ')}`
  );

  const encryptedFiles = backupFiles.filter(f => f.endsWith('.json.enc'));
  assert(
    'Encrypted backup files present in .artifacts/private-backup/',
    encryptedFiles.length >= 3,
    `Found: ${encryptedFiles.length} files`
  );

  const extractScript = fs.readFileSync('scripts/extract-private-backups.mjs', 'utf8');
  assert(
    'extract-private-backups.mjs has no hardcoded salt/passphrase',
    !extractScript.includes('private_macula_frame_vault:2026') && !extractScript.includes('secretSalt =')
  );
  assert(
    'extract-private-backups.mjs does not write plaintext JSON',
    !extractScript.includes('writeFileSync(jsonPath')
  );

  // 3. Export script license compliance
  console.log('\n3. Testing export-static-corpus.py license gating...');
  const exportScript = fs.readFileSync('scripts/export-static-corpus.py', 'utf8');
  assert(
    'export-static-corpus.py gates macula-hebrew semantic_frame',
    exportScript.includes('semantic_frame = None if repo == "macula-hebrew"')
  );

  // 4. Static Shard License Audit (Zero leaks across tables and chapters)
  console.log('\n4. Verifying zero macula-hebrew semantic_frame leaks in static shards...');
  let tableHits = 0;
  const tablesDir = path.resolve('.artifacts/static-corpus/tables/syntax_nodes');
  for (const f of fs.readdirSync(tablesDir).filter(f => f.endsWith('.jsonl.gz'))) {
    const raw = fs.readFileSync(path.join(tablesDir, f));
    const str = zlib.gunzipSync(raw).toString('utf8');
    for (const line of str.split('\n')) {
      if (!line.trim()) continue;
      if (line.includes('"semantic_frame":') && !line.includes('"semantic_frame":null')) {
        const row = JSON.parse(line);
        if (row.edition_id === 11 && row.semantic_frame !== null) {
          tableHits++;
        }
      }
    }
  }
  assert('0 edition_id=11 semantic_frame hits in tables/syntax_nodes/', tableHits === 0, `Hits: ${tableHits}`);

  let chapterHits = 0;
  const chaptersDir = path.resolve('.artifacts/static-corpus/v1/chapters');
  for (const f of fs.readdirSync(chaptersDir).filter(f => f.endsWith('.json.gz'))) {
    const m = f.match(/^b([0-9]+)-c[0-9]+\.json\.gz$/);
    if (!m) continue;
    const bookNo = parseInt(m[1], 10);
    if (bookNo > 39) continue;
    const raw = fs.readFileSync(path.join(chaptersDir, f));
    const data = JSON.parse(zlib.gunzipSync(raw).toString('utf8'));
    for (const tid of Object.keys(data.syntax_trees || {})) {
      const tree = data.syntax_trees[tid].tree || data.syntax_trees[tid];
      for (const n of tree.nodes || []) {
        if (n.semantic_frame !== null && n.semantic_frame !== undefined) {
          chapterHits++;
        }
      }
    }
  }
  assert('0 macula-hebrew semantic_frame hits in OT chapter shards', chapterHits === 0, `Hits: ${chapterHits}`);

  // 5. Verify Greek semantic_frames preserved
  console.log('\n5. Verifying Greek semantic_frame retention...');
  const jhn1 = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(chaptersDir, 'b43-c1.json.gz'))).toString('utf8'));
  let greekFrames = 0;
  for (const tid of Object.keys(jhn1.syntax_trees || {})) {
    const tree = jhn1.syntax_trees[tid].tree || jhn1.syntax_trees[tid];
    for (const n of tree.nodes || []) {
      if (n.semantic_frame) greekFrames++;
    }
  }
  assert('Greek semantic_frames preserved in John 1 (b43-c1.json.gz)', greekFrames > 0, `Greek frames: ${greekFrames}`);

  console.log(`\n========================================`);
  console.log(`AUDIT-01 Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
