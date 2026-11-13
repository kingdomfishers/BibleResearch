// Structural DDL verification only. This is explicitly NOT a data restore proof.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { buildReclamationSchema } from './build-reclamation-backup-schema.mjs';

const catalog = JSON.parse(fs.readFileSync('supabase/recovery/reclamation-catalog.json', 'utf8'));
const ddl = buildReclamationSchema(catalog);
const db = await PGlite.create({ extensions: { pg_trgm } });
try {
  await db.exec('CREATE EXTENSION pg_trgm;');
  await db.exec(ddl.tables);
  await db.exec(ddl.foreignKeys);
  await db.exec(ddl.indexes);
  const tables = await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','bible_internal')");
  assert.deepEqual(tables.rows.map(r => r.schemaname + '.' + r.tablename).sort(), [...ddl.relations].sort());
  // PostgreSQL 18 also catalogs NOT NULL constraints; compare portable constraint kinds.
  const constraints = await db.query("select count(*)::integer as n from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','bible_internal') and c.contype in ('p','u','f','c','x')");
  assert.equal(constraints.rows[0].n, catalog.relations.reduce((n,t) => n + (t.constraints?.filter(c=>c.type !== 'n').length ?? 0), 0));
  const indexes = await db.query("select count(*)::integer as n from pg_indexes where schemaname in ('public','bible_internal')");
  assert.equal(indexes.rows[0].n, catalog.relations.reduce((n,t)=>n+(t.indexes?.length ?? 0),0));
  const report = { status: 'PASS_SCHEMA_ONLY', targets: ddl.targets.length, relations: tables.rows.length, constraints: constraints.rows[0].n, full_data_restore_verified: false };
  fs.writeFileSync('.artifacts/phase0/recovery-schema-test.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  fs.writeFileSync('.artifacts/phase0/recovery-schema-error.json', JSON.stringify({ message: error.message, code: error.code, detail: error.detail, query: error.query }, null, 2));
  console.log(JSON.stringify({ status: 'FAIL_SCHEMA', code: error.code, message: error.message }));
  process.exitCode = 1;
} finally { await db.close(); }
