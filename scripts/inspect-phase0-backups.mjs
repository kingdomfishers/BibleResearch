// Full local shard scan; counts/hashes are evidence, never a restore certification.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { RECLAMATION_TABLES, assertReclamationScope } from './phase0-storage-scope.mjs';

assertReclamationScope();
const catalog = JSON.parse(fs.readFileSync('supabase/recovery/reclamation-catalog.json', 'utf8'));
const counts = JSON.parse(fs.readFileSync('.artifacts/phase0/live-target-counts.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('.artifacts/static-corpus/manifest.json', 'utf8'));
const knownShards = new Map(Object.values(manifest.tables).flatMap(t => t.shards ?? []).map(s => [path.resolve('.artifacts/static-corpus', s.path.replace(/^\//, '')), s]));
const tables = [];
for (const relation of catalog.relations) {
  const name = `${relation.schema}.${relation.name}`;
  const key = ['syntax_nodes','syntax_edges'].includes(relation.name) ? relation.name + '_db' : ['words','verses'].includes(relation.name) ? relation.name + '_full' : relation.name;
  const candidates = [`.artifacts/db-backup/tables/${key}`, `.artifacts/static-corpus/tables/${key}`];
  const dir = candidates.find(p => fs.existsSync(p));
  const shards = [];
  if (dir) for (const file of fs.readdirSync(dir).filter(f => /^part-.*\.jsonl\.gz$/.test(f)).sort()) {
    const location = path.join(dir, file);
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    for await (const chunk of fs.createReadStream(location)) { hash.update(chunk); bytes += chunk.length; }
    const sha256 = hash.digest('hex');
    const expected = knownShards.get(path.resolve(location));
    if (expected && sha256 !== expected.sha256_compressed) throw Error(`Manifest digest mismatch: ${location}`);
    let rows = 0;
    const stream = fs.createReadStream(location).pipe(createGunzip());
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) if (line.trim()) { JSON.parse(line); rows++; }
    shards.push({ path: location.replaceAll('\\','/'), sha256_compressed: sha256, compressed_bytes: bytes, rows, source_manifest_verified: Boolean(expected) });
  }
  const encrypted = [];
  const privateFile = relation.name === 'macula_gated_field_values' ? 'macula_gated_restricted_frame_200' : relation.name === 'macula_syntax_import_files' ? 'macula_syntax_import_files_983' : relation.name === 'macula_syntax_unmapped_nodes' ? 'macula_syntax_unmapped_nodes_60' : null;
  if (privateFile) {
    const file = `.artifacts/private-backup/${privateFile}.json.enc`;
    if (fs.existsSync(file)) {
      const bytes = fs.readFileSync(file), envelope = JSON.parse(bytes);
      encrypted.push({ path: file, sha256_compressed: crypto.createHash('sha256').update(bytes).digest('hex'), rows: envelope.record_count, plaintext_sha256: envelope.plaintext_sha256 });
    }
  }
  // Prefer plaintext source shards for internal metadata only if they exist; never double-count alternatives.
  const privateRows = relation.name === 'macula_gated_field_values' || !shards.length ? encrypted.reduce((n,s)=>n+s.rows,0) : 0;
  const availableRows = shards.reduce((n,s)=>n+s.rows,0) + privateRows;
  const live = counts.find(t => t.relation === name)?.rows ?? null;
  tables.push({ relation: name, target: RECLAMATION_TABLES.includes(name), expected_live_rows: live, available_rows: availableRows, row_count_matches: live === null ? null : availableRows === Number(live), shards, encrypted: privateRows ? encrypted : [] });
}
const report = { status: 'INVENTORIED_NOT_RESTORE_VERIFIED', full_restore_verified: false, tables };
fs.writeFileSync('.artifacts/phase0/backup-inventory.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ targets: tables.filter(t=>t.target).length, target_count_mismatches: tables.filter(t=>t.target && !t.row_count_matches).map(t=>({relation:t.relation,live:t.expected_live_rows,backup:t.available_rows})), missing_dependencies: tables.filter(t=>!t.available_rows).map(t=>t.relation), encrypted_archives: tables.reduce((n,t)=>n+t.encrypted.length,0), full_restore_verified:false }));
