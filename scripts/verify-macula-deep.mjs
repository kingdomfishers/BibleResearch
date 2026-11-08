// @file: scripts/verify-macula-deep.mjs
// Independent deep verification for MACULA completeness, syntax integrity,
// upstream hash verification, err_ role investigation, and multi-corpus passage tests.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const envPath = path.resolve('.env');
const env = fs.existsSync(envPath)
  ? Object.fromEntries(
      fs
        .readFileSync(envPath, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => {
          const idx = l.indexOf('=');
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
        })
    )
  : {};

const CORPUS_BASE_URL = (
  process.env.VITE_CORPUS_BASE_URL ||
  env.VITE_CORPUS_BASE_URL ||
  'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev'
).replace(/\/+$/, '');

function assert(cond, msg) {
  if (!cond) {
    console.error(`  [FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`  [PASS] ${msg}`);
}

async function fetchRpc(op, params = {}) {
  const url = `${CORPUS_BASE_URL}/v1/rpc/${op}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${op}`);
  return res.json();
}

async function main() {
  console.log('=== MACULA Completeness & Syntactic Integrity Deep Verification ===\n');

  // 1. Verify 983 source files from macula_syntax_import_files shard
  console.log('1. Verifying 983 MACULA Source Files & Upstream Hashes...');
  const importFilesRaw = zlib.gunzipSync(
    fs.readFileSync('.artifacts/static-corpus/tables/macula_syntax_import_files/part-0000.jsonl.gz')
  ).toString('utf8');
  const importFiles = importFilesRaw.trim().split('\n').map((l) => JSON.parse(l));

  assert(importFiles.length === 983, `Total import files is exactly 983 (got ${importFiles.length})`);

  const wlcFiles = importFiles.filter((f) => f.edition_key === 'macula-hebrew-wlc');
  const nestleFiles = importFiles.filter((f) => f.edition_key === 'macula-greek-nestle1904');
  const sblFiles = importFiles.filter((f) => f.edition_key === 'macula-greek-sblgnt');

  assert(wlcFiles.length === 929, `Hebrew WLC source files: exactly 929 (got ${wlcFiles.length})`);
  assert(nestleFiles.length === 27, `Greek Nestle1904 files: exactly 27 (got ${nestleFiles.length})`);
  assert(sblFiles.length === 27, `Greek SBLGNT files: exactly 27 (got ${sblFiles.length})`);

  // Verify all 983 files have verified git blob sha1 and valid pinned revisions
  const allSha1Verified = importFiles.every((f) => f.verified_git_blob_sha1 === true && f.git_blob_sha1 && f.pinned_revision);
  assert(allSha1Verified, 'All 983 source files possess verified upstream git blob SHA-1 hashes and pinned revisions');

  // 2. Structural Totals & Integrity
  console.log('\n2. Verifying Structural Syntax Totals & Tree Integrity...');
  const integrity = await fetchRpc('validate_syntax_tree_integrity_v1');
  assert(integrity.status === 'PASS' && integrity.is_valid === true, 'Syntax tree integrity status: PASS');
  assert(integrity.total_nodes === 1338108, `Total syntax nodes: exactly 1,338,108 (got ${integrity.total_nodes})`);
  assert(integrity.total_edges === 1298688, `Total syntax edges: exactly 1,298,688 (got ${integrity.total_edges})`);
  assert(integrity.cycles_count === 0, `Cycles count: 0 (got ${integrity.cycles_count})`);
  assert(integrity.orphaned_parents_count === 0, `Orphaned parent references: 0`);
  assert(integrity.span_inversions_count === 0, `Span inversions: 0`);
  assert(integrity.verse_inversions_count === 0, `Verse inversions: 0`);
  assert(integrity.terminals_without_xml_count === 0, `Terminals without XML ID: 0`);
  assert(integrity.cross_verse_nodes_count === 11008, `Cross-verse syntax nodes: 11,008 (got ${integrity.cross_verse_nodes_count})`);

  // 3. Source-Only Nodes (e.g. Mark 16:99!)
  console.log('\n3. Verifying Source-Only & Unmapped Nodes Preservation...');
  const unmappedRes = await fetch(`${CORPUS_BASE_URL}/v1/syntax/unmapped`);
  assert(unmappedRes.ok, 'GET /v1/syntax/unmapped returned 200');
  const unmappedData = await unmappedRes.json();
  assert(unmappedData.total_unmapped_nodes === 128, `Total unmapped source-only nodes: exactly 128 (got ${unmappedData.total_unmapped_nodes})`);
  const mrk99 = unmappedData.unmapped_nodes.filter((n) => (n.source_ref || '').startsWith('MRK 16:99!'));
  assert(mrk99.length > 0, `Mark 16:99 noncanonical shorter ending source nodes preserved (${mrk99.length} nodes)`);

  // 4. Investigate malformed err_ role values
  console.log('\n4. Investigating Malformed `err_` Role Values...');
  const syntaxNodesDir = path.resolve('.artifacts/static-corpus/tables/syntax_nodes');
  const errNodes = [];
  for (const file of fs.readdirSync(syntaxNodesDir)) {
    if (!file.endsWith('.gz')) continue;
    const lines = zlib.gunzipSync(fs.readFileSync(path.join(syntaxNodesDir, file))).toString('utf8').trim().split('\n');
    for (const line of lines) {
      const node = JSON.parse(line);
      if (node.syntactic_role && node.syntactic_role.includes('err_')) {
        errNodes.push({
          id: node.id,
          node_key: node.node_key,
          edition_id: node.edition_id,
          verse_id: node.verse_id,
          rule_label: node.rule_label,
          syntactic_role: node.syntactic_role,
        });
      }
    }
  }
  assert(errNodes.length === 11, `Exactly 11 nodes contain 'err_' role values (got ${errNodes.length})`);
  console.log('  Summary of 11 err_ role occurrences (preserved verbatim from upstream Lowfat XML):');
  for (const n of errNodes) {
    const cleanRole = n.syntactic_role.replace(/\s+/g, ' ').slice(0, 70);
    console.log(`    - ID ${n.id} (${n.node_key}): role="${cleanRole}..."`);
  }
  const nestleErr = errNodes.filter((n) => n.edition_id === 18);
  const sblErr = errNodes.filter((n) => n.edition_id === 19);
  assert(nestleErr.length === 5, `Nestle1904 err_ nodes: exactly 5 (got ${nestleErr.length})`);
  assert(sblErr.length === 6, `SBLGNT err_ nodes: exactly 6 (got ${sblErr.length})`);
  assert(errNodes.every((n) => n.edition_id === 18 || n.edition_id === 19), 'All 11 err_ role values originate from Greek editions (5 Nestle1904, 6 SBLGNT, 0 Hebrew WLC)');

  // 5. Verify selected passages across Beginning, Middle, End of each corpus
  console.log('\n5. Verifying Beginning, Middle, and End Passages Across All Corpora...');

  const passages = [
    // Hebrew WLC: Gen 1:1 (Beginning), Ps 23:1 & Isa 53:7 (Middle), Mal 4:6 (End OT)
    { name: 'Genesis 1:1 (Beginning Hebrew OT)', b: 1, c: 1, v: 1, expected_terminals: 11, edition: 'macula-hebrew-wlc' },
    { name: 'Psalm 23:1 (Middle Hebrew OT - Psalms)', b: 19, c: 23, v: 1, expected_terminals: 8, edition: 'macula-hebrew-wlc' },
    { name: 'Isaiah 53:7 (Middle Hebrew OT - Prophets)', b: 23, c: 53, v: 7, expected_terminals: 29, edition: 'macula-hebrew-wlc' },
    { name: 'Malachi 4:6 (End Hebrew OT)', b: 39, c: 4, v: 6, expected_terminals: 20, edition: 'macula-hebrew-wlc' },

    // Greek NT Nestle1904: Matt 1:1 (Beginning), 1 Cor 13:1 (Middle), Rev 22:21 (End)
    { name: 'Matthew 1:1 (Beginning NT - Nestle1904)', b: 40, c: 1, v: 1, expected_terminals: 8, edition: 'macula-greek-nestle1904' },
    { name: '1 Cor 13:1 (Middle NT - Nestle1904)', b: 46, c: 13, v: 1, expected_terminals: 19, edition: 'macula-greek-nestle1904' },
    { name: 'Revelation 22:21 (End NT - Nestle1904)', b: 66, c: 22, v: 21, expected_terminals: 7, edition: 'macula-greek-nestle1904' },

    // Greek NT SBLGNT: Matt 1:1 (Beginning), 1 Cor 13:1 (Middle), Rev 22:21 (End)
    { name: 'Matthew 1:1 (Beginning NT - SBLGNT)', b: 40, c: 1, v: 1, expected_terminals: 8, edition: 'macula-greek-sblgnt' },
    { name: '1 Cor 13:1 (Middle NT - SBLGNT)', b: 46, c: 13, v: 1, expected_terminals: 19, edition: 'macula-greek-sblgnt' },
    { name: 'Revelation 22:21 (End NT - SBLGNT)', b: 66, c: 22, v: 21, expected_terminals: 7, edition: 'macula-greek-sblgnt' },
  ];

  for (const p of passages) {
    const res = await fetchRpc('lookup_syntax_tree_v1', { p_book: p.b, p_chapter: p.c, p_verse: p.v, p_edition_key: p.edition });
    assert(res.has_syntax === true && res.trees_count === 1, `${p.name} has syntax tree`);
    const terminals = res.trees[0].nodes.filter((n) => n.is_terminal);
    assert(terminals.length === p.expected_terminals, `${p.name} terminal count: ${terminals.length} (expected ${p.expected_terminals})`);
    assert(terminals.every((t) => t.terminal_xml_id), `${p.name} all terminals have terminal_xml_id`);
  }

  console.log('\n======================================================');
  console.log('ALL MACULA DEEP COMPLETENESS VERIFICATIONS PASSED!');
  console.log('======================================================');
}

main().catch((err) => {
  console.error('MACULA deep verification failed:', err);
  process.exit(1);
});
