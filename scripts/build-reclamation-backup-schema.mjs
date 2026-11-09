// scripts/build-reclamation-backup-schema.mjs
// Assembles complete, authentic PostgreSQL DDL for:
// - All 19 reclamation-target tables
// - Core dependency tables (source_editions, source_releases, verses, words, lemmas, lexemes, field_license_registry)
// - Primary keys, foreign keys, unique constraints, check constraints, and indexes.

import fs from 'node:fs';
import path from 'node:path';

function parseStepOutput(stepFilePath) {
  const raw = fs.readFileSync(stepFilePath, 'utf8');
  const parsed = JSON.parse(raw);
  const match = parsed.result.match(/<untrusted-data-[0-9a-f-]+>\s*(\[[\s\S]+?\])\s*<\/untrusted-data-[0-9a-f-]+>/);
  if (!match) throw new Error(`Could not parse step output: ${stepFilePath}`);
  return JSON.parse(match[1]);
}

const targetCols = parseStepOutput('C:/Users/fluck/.gemini/antigravity/brain/665d66fd-5dd3-4293-8f5a-1ae633a34d7f/.system_generated/steps/293/output.txt');
const targetConstraints = parseStepOutput('C:/Users/fluck/.gemini/antigravity/brain/665d66fd-5dd3-4293-8f5a-1ae633a34d7f/.system_generated/steps/295/output.txt');
const targetIndexes = parseStepOutput('C:/Users/fluck/.gemini/antigravity/brain/665d66fd-5dd3-4293-8f5a-1ae633a34d7f/.system_generated/steps/297/output.txt');
const depCols = parseStepOutput('C:/Users/fluck/.gemini/antigravity/brain/665d66fd-5dd3-4293-8f5a-1ae633a34d7f/.system_generated/steps/299/output.txt');

const schemaDir = path.resolve('.artifacts/db-backup/schema');
fs.mkdirSync(schemaDir, { recursive: true });

function formatColType(col) {
  let dt = col.data_type;
  if (dt === 'character varying') dt = col.character_maximum_length ? `varchar(${col.character_maximum_length})` : 'varchar';
  else if (dt === 'USER-DEFINED') dt = col.udt_name;
  else if (dt === 'ARRAY') dt = `${col.udt_name.replace(/^_/, '')}[]`;
  return dt;
}

function extractSequences(cols) {
  const seqs = new Set();
  for (const c of cols) {
    if (c.column_default) {
      const m = c.column_default.match(/nextval\('([^']+)'::regclass\)/);
      if (m) seqs.add(m[1]);
    }
  }
  return Array.from(seqs);
}

function buildTableDDL(schema, table, cols, constraints) {
  const lines = [];
  lines.push(`CREATE TABLE IF NOT EXISTS ${schema}.${table} (`);
  const colDefs = cols.map(c => {
    let def = `  ${c.column_name} ${formatColType(c)}`;
    if (c.is_nullable === 'NO') def += ' NOT NULL';
    if (c.column_default) def += ` DEFAULT ${c.column_default}`;
    return def;
  });

  const pkeys = constraints.filter(c => c.contype === 'p').map(c => `  CONSTRAINT ${c.conname} ${c.condef}`);
  const uniques = constraints.filter(c => c.contype === 'u').map(c => `  CONSTRAINT ${c.conname} ${c.condef}`);
  const checks = constraints.filter(c => c.contype === 'c').map(c => `  CONSTRAINT ${c.conname} ${c.condef}`);

  const allElements = [...colDefs, ...pkeys, ...uniques, ...checks];
  lines.push(allElements.join(',\n'));
  lines.push(');');
  return lines.join('\n');
}

// 1. Group columns by table
function groupByTable(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

const targetColsMap = groupByTable(targetCols);
const depColsMap = groupByTable(depCols);

const constraintsMap = new Map();
for (const c of targetConstraints) {
  const key = `${c.table_schema}.${c.table_name}`;
  if (!constraintsMap.has(key)) constraintsMap.set(key, []);
  constraintsMap.get(key).push(c);
}

// Sequences
const allCols = [...targetCols, ...depCols];
const allSequences = extractSequences(allCols);

// Build 01_dependencies_schema.sql
const depSQL = [];
depSQL.push('-- 01_dependencies_schema.sql');
depSQL.push('CREATE SCHEMA IF NOT EXISTS bible_internal;');
for (const s of allSequences) {
  depSQL.push(`CREATE SEQUENCE IF NOT EXISTS ${s};`);
}

for (const [key, cols] of depColsMap.entries()) {
  const [schema, table] = key.split('.');
  depSQL.push(`\n-- ${key}`);
  const idCol = cols.find(c => c.column_name === 'id');
  const pkDef = idCol ? `  CONSTRAINT ${table}_pkey PRIMARY KEY (id)` : '';
  const colDefs = cols.map(c => `  ${c.column_name} ${formatColType(c)}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}${c.column_default ? ' DEFAULT ' + c.column_default : ''}`);
  if (pkDef) colDefs.push(pkDef);
  depSQL.push(`CREATE TABLE IF NOT EXISTS ${schema}.${table} (\n${colDefs.join(',\n')}\n);`);
}
// Add unique constraint on field_license_registry(dataset_key, field_name)
depSQL.push(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'field_license_registry_dataset_key_field_name_key'
  ) THEN
    ALTER TABLE public.field_license_registry ADD CONSTRAINT field_license_registry_dataset_key_field_name_key UNIQUE (dataset_key, field_name);
  END IF;
END $$;
`);
fs.writeFileSync(path.join(schemaDir, '01_dependencies_schema.sql'), depSQL.join('\n'), 'utf8');

// Build 02_reclamation_tables_schema.sql (without FKs initially to avoid ordering circularities)
const recSQL = [];
recSQL.push('-- 02_reclamation_tables_schema.sql');
for (const [key, cols] of targetColsMap.entries()) {
  const [schema, table] = key.split('.');
  recSQL.push(`\n-- ${key}`);
  const cons = constraintsMap.get(key) || [];
  recSQL.push(buildTableDDL(schema, table, cols, cons));
}

// Add Foreign Keys at the end
recSQL.push('\n-- Foreign Key Constraints');
for (const [key, cons] of constraintsMap.entries()) {
  const [schema, table] = key.split('.');
  const fkeys = cons.filter(c => c.contype === 'f');
  for (const fk of fkeys) {
    recSQL.push(`ALTER TABLE ${schema}.${table} ADD CONSTRAINT ${fk.conname} ${fk.condef};`);
  }
}
fs.writeFileSync(path.join(schemaDir, '02_reclamation_tables_schema.sql'), recSQL.join('\n'), 'utf8');

// Build 03_indexes.sql
const idxSQL = [];
idxSQL.push('-- 03_indexes.sql');
for (const idx of targetIndexes) {
  if (idx.indexname.endsWith('_pkey') || idx.indexname.endsWith('_key')) continue;
  idxSQL.push(`${idx.indexdef};`);
}
fs.writeFileSync(path.join(schemaDir, '03_indexes.sql'), idxSQL.join('\n'), 'utf8');

console.log('Successfully regenerated complete DDL in .artifacts/db-backup/schema/');
