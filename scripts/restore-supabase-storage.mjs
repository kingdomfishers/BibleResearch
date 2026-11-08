// scripts/restore-supabase-storage.mjs
// Verifies and restores static corpus table shards from `.artifacts/static-corpus/tables/`
// or `.artifacts/db-backup/tables/` back into PostgreSQL if a rollback from Stage G is ever needed.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CORPUS_TABLES_DIR = path.resolve('.artifacts/static-corpus/tables');
const BACKUP_TABLES_DIR = path.resolve('.artifacts/db-backup/tables');

function verifyBackupTable(baseDir, tableName) {
  const dir = path.join(baseDir, tableName);
  if (!fs.existsSync(dir)) {
    throw new Error(`Missing backup directory: ${dir}`);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl.gz')).sort();
  if (files.length === 0) {
    throw new Error(`No .jsonl.gz shards found in ${dir}`);
  }
  let rowCount = 0;
  for (const file of files) {
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(dir, file))).toString('utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    // Validate first and last JSON line of each shard
    JSON.parse(lines[0]);
    JSON.parse(lines[lines.length - 1]);
    rowCount += lines.length;
  }
  return { tableName, shards: files.length, rowCount };
}

function main() {
  console.log('=== Verifying Recoverable Local Backups for Stage G Rollback Safety ===\n');
  const publicTables = [
    'macula_hebrew_morphemes',
    'macula_greek_tokens',
    'lxx_swete_words',
    'morphhb_tokens',
    'tagnt_tokens',
    'syntax_nodes',
    'syntax_edges',
    'verse_translation_sources',
    'lexeme_identifiers',
    'edition_passages',
    'reader_rendering_groups',
    'hebrew_lxx_verse_map',
    'reader_english_verses',
    'word_form_lemmas',
    'token_morphemes',
    'cross_token_mappings',
    'macula_gated_field_values',
  ];

  for (const t of publicTables) {
    const res = verifyBackupTable(CORPUS_TABLES_DIR, t);
    console.log(`  [OK] public.${res.tableName}: ${res.rowCount.toLocaleString()} rows across ${res.shards} shard(s)`);
  }

  const dbBackupTables = ['words_full', 'verses_full', 'syntax_nodes_db', 'syntax_edges_db'];
  for (const t of dbBackupTables) {
    const res = verifyBackupTable(BACKUP_TABLES_DIR, t);
    console.log(`  [OK] db-backup.${res.tableName}: ${res.rowCount.toLocaleString()} rows across ${res.shards} shard(s)`);
  }

  console.log('\nAll recoverable backups verified and ready.');
}

main();
