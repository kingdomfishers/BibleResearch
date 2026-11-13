// Actual full-table restore into a new isolated PostgreSQL instance. Never connects to production.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { buildReclamationSchema, quoteRelation, quoteIdentifier } from './build-reclamation-backup-schema.mjs';
import { RECLAMATION_TABLES } from './phase0-storage-scope.mjs';

const output = '.artifacts/phase0/full-restore-report.json';
let db, activeRelation;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function verifyFile(shard) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(shard.path)) digest.update(chunk);
  assert.equal(digest.digest('hex'), shard.sha256_compressed, 'Backup file digest mismatch');
}
function decrypt(shard) {
  const secret = process.env.PRIVATE_BACKUP_PASSPHRASE;
  if (!secret) throw Error('PRIVATE_BACKUP_PASSPHRASE is required; encrypted data cannot be certified from envelope counts');
  const envelope = JSON.parse(fs.readFileSync(shard.path));
  assert.equal(envelope.algorithm, 'aes-256-gcm');
  const cipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(secret).digest(), Buffer.from(envelope.iv, 'hex'));
  cipher.setAuthTag(Buffer.from(envelope.auth_tag, 'hex'));
  const bytes = Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64')), cipher.final()]);
  assert.equal(hash(bytes), shard.plaintext_sha256, 'Decrypted backup digest mismatch');
  const rows = JSON.parse(bytes.toString('utf8'));
  assert.equal(rows.length, shard.rows);
  return rows;
}
async function* records(table) {
  for (const shard of table.shards) {
    await verifyFile(shard);
    let count = 0;
    for await (const line of createInterface({ input: fs.createReadStream(shard.path).pipe(createGunzip()), crlfDelay: Infinity })) {
      if (line.trim()) { count++; yield JSON.parse(line); }
    }
    assert.equal(count, shard.rows, 'Backup shard row count mismatch');
  }
  for (const shard of table.encrypted) {
    await verifyFile(shard);
    yield* decrypt(shard);
  }
}
async function run() {
  const catalog = JSON.parse(fs.readFileSync('supabase/recovery/reclamation-catalog.json'));
  const inventory = JSON.parse(fs.readFileSync('.artifacts/phase0/backup-inventory.json'));
  const live = JSON.parse(fs.readFileSync('.artifacts/phase0/live-table-digests.json'));
  assert.equal(inventory.tables.filter(t=>t.target).length, 19);
  for (const name of RECLAMATION_TABLES) {
    const t = inventory.tables.find(t=>t.relation === name);
    if (!t?.row_count_matches) throw Error('Exact live backup count not satisfied: ' + name);
    if (!live.some(t=>t.relation === name)) throw Error('Missing authoritative live digest: ' + name);
  }
  // Fail before initializing PostgreSQL if restricted backup authorization is absent.
  for (const table of inventory.tables) for (const shard of table.encrypted) { await verifyFile(shard); decrypt(shard); }
  const ddl = buildReclamationSchema(catalog);
  const dataDir = path.resolve('.artifacts/phase0/restore-' + crypto.randomUUID());
  db = await PGlite.create(dataDir, { extensions: { pg_trgm } });
  await db.exec("SET TIME ZONE 'UTC'; CREATE EXTENSION pg_trgm;");
  await db.exec(ddl.tables);
  const restored = [];
  for (const table of inventory.tables) {
    activeRelation = table.relation;
    const descriptor = catalog.relations.find(t=>`${t.schema}.${t.name}` === table.relation);
    const known = new Map(descriptor.columns.map(c=>[c.name,c]));
    let batch = [], count = 0;
    async function insert() {
      if (!batch.length) return;
      const columns = Object.keys(batch[0]).filter(k=>!known.get(k)?.generated);
      for (const row of batch) for (const key of Object.keys(row)) if (!known.has(key)) throw Error('Unknown backup column: ' + table.relation + '.' + key);
      const quoted = columns.map(quoteIdentifier).join(',');
      await db.query(`INSERT INTO ${quoteRelation(table.relation)} (${quoted}) OVERRIDING SYSTEM VALUE SELECT ${columns.map(k=>'x.'+quoteIdentifier(k)).join(',')} FROM jsonb_populate_recordset(NULL::${quoteRelation(table.relation)},$1::jsonb) AS x`, [JSON.stringify(batch)]);
      count += batch.length; batch = [];
    }
    for await (const row of records(table)) { batch.push(row); if (batch.length === 1000) await insert(); }
    await insert();
    assert.equal(count, table.available_rows);
    const pk = descriptor.constraints.find(c=>c.type === 'p')?.definition.match(/PRIMARY KEY \(([^)]+)\)/)?.[1];
    if (!pk) throw Error('Missing primary key contract: ' + table.relation);
    const result = await db.query(`SELECT count(*)::bigint AS rows,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY ${pk}),''),'UTF8')),'hex') AS typed_rows_sha256 FROM ${quoteRelation(table.relation)} t`);
    const actual = result.rows[0], expected = live.find(t=>t.relation === table.relation);
    if (table.target) { assert.equal(Number(actual.rows), Number(expected.rows)); assert.equal(actual.typed_rows_sha256, expected.typed_rows_sha256, 'Live typed-row digest mismatch: ' + table.relation); }
    restored.push({ relation: table.relation, target: table.target, rows: Number(actual.rows), typed_rows_sha256: actual.typed_rows_sha256 });
  }
  await db.exec(ddl.foreignKeys);
  await db.exec(ddl.indexes);
  for (const sequence of ddl.sequences) {
    const maximum = await db.query(`SELECT max(${quoteIdentifier(sequence.column)})::text AS n FROM ${quoteRelation(sequence.relation)}`);
    const seq = sequence.sequence ?? (await db.query('SELECT pg_get_serial_sequence($1,$2) AS name', [sequence.relation,sequence.column])).rows[0].name;
    if (!seq) throw Error('Missing sequence: ' + sequence.relation);
    const max = maximum.rows[0].n;
    if (max !== null) await db.query('SELECT setval($1::regclass,$2::bigint,true)', [seq,max]);
  }
  const report = { status:'PASS_FULL_DATA_RESTORE', full_restore_verified:true, tables_restored:restored.filter(t=>t.target).length, dependent_relations:restored.length, dataDir, restored, relational_retrieval_integration_verified:false, security_policy_replay_verified:false };
  fs.writeFileSync(output, JSON.stringify(report,null,2));
  console.log(JSON.stringify({ status:report.status, tables_restored:report.tables_restored, dependent_relations:report.dependent_relations, retrieval_integration_verified:false }));
}
try { await run(); }
catch (error) {
  const report = { status:'BLOCKED_OR_FAILED', full_restore_verified:false, relation:activeRelation, code:error.code, message:error.message };
  fs.mkdirSync(path.dirname(output), { recursive:true });
  fs.writeFileSync(output, JSON.stringify(report,null,2));
  console.log(JSON.stringify(report)); process.exitCode = 1;
} finally { if (db) await db.close(); }
