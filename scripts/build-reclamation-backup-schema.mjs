// Portable recovery DDL from the checked-in read-only pg_catalog capture.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RECLAMATION_TABLES, assertReclamationScope } from './phase0-storage-scope.mjs';

export const quoteIdentifier = s => '"' + s.replaceAll('"', '""') + '"';
export const quoteRelation = s => s.split('.').map(quoteIdentifier).join('.');

export function buildReclamationSchema(catalog) {
  assertReclamationScope();
  const relations = catalog.relations;
  const names = new Set(relations.map(t => t.schema + '.' + t.name));
  for (const t of RECLAMATION_TABLES) if (!names.has(t)) throw Error('Missing recovery DDL: ' + t);
  const schemas = [...new Set(relations.map(t => t.schema))].map(s => 'CREATE SCHEMA IF NOT EXISTS ' + quoteIdentifier(s) + ';');
  const tables = [], foreignKeys = [], indexes = [], security = [], sequences = [];
  const explicitSequences = new Set();
  for (const t of relations) {
    const relation = t.schema + '.' + t.name, qtable = quoteRelation(relation);
    const columns = t.columns.map(c => {
      const seq = c.default?.match(/nextval\('([^']+)'::regclass\)/)?.[1];
      if (seq && !c.identity) explicitSequences.add(seq);
      if (seq || c.identity) sequences.push({ relation, column: c.name, sequence: seq ?? null });
      const generated = c.generated ? ' GENERATED ALWAYS AS (' + c.default + ') STORED' : '';
      const identity = c.identity ? ' GENERATED ' + (c.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT') + ' AS IDENTITY' : '';
      const def = !generated && !identity && c.default ? ' DEFAULT ' + c.default : '';
      return quoteIdentifier(c.name) + ' ' + c.type + generated + identity + def + (c.not_null ? ' NOT NULL' : '');
    });
    for (const c of t.constraints ?? []) {
      const sql = 'CONSTRAINT ' + quoteIdentifier(c.name) + ' ' + c.definition;
      if (c.type === 'f') {
        const parent = c.parent.includes('.') ? c.parent : 'public.' + c.parent;
        if (!names.has(parent)) throw Error('Missing FK dependency ' + parent);
        foreignKeys.push('ALTER TABLE ' + qtable + ' ADD ' + sql + ';');
      } else columns.push(sql);
    }
    tables.push('CREATE TABLE ' + qtable + ' (\n  ' + columns.join(',\n  ') + '\n);');
    const constraintNames = new Set((t.constraints ?? []).filter(c => ['p','u','x'].includes(c.type)).map(c => c.name));
    for (const i of t.indexes ?? []) if (!constraintNames.has(i.name)) indexes.push(i.definition + ';');
    if (t.rls) security.push('ALTER TABLE ' + qtable + ' ENABLE ROW LEVEL SECURITY;');
    if (t.force_rls) security.push('ALTER TABLE ' + qtable + ' FORCE ROW LEVEL SECURITY;');
    for (const p of t.policies ?? []) security.push('CREATE POLICY ' + quoteIdentifier(p.name) + ' ON ' + qtable + ' AS ' + p.permissive + ' FOR ' + p.command + ' TO ' + p.roles.map(r => r === 'public' ? 'PUBLIC' : quoteIdentifier(r)).join(', ') + (p.using ? ' USING (' + p.using + ')' : '') + (p.check ? ' WITH CHECK (' + p.check + ')' : '') + ';');
    security.push('REVOKE ALL ON TABLE ' + qtable + ' FROM PUBLIC, anon, authenticated, service_role;');
    for (const g of t.grants ?? []) security.push('GRANT ' + g.privilege + ' ON TABLE ' + qtable + ' TO ' + (g.role === 'PUBLIC' ? 'PUBLIC' : quoteIdentifier(g.role)) + (g.grantable === 'YES' ? ' WITH GRANT OPTION' : '') + ';');
  }
  return { tables: [...schemas, ...(catalog.helpers ?? []).map(f => f.definition.trim() + ';'), ...[...explicitSequences].map(s => 'CREATE SEQUENCE ' + quoteRelation(s) + ';'), ...tables].join('\n\n') + '\n', foreignKeys: foreignKeys.join('\n') + '\n', indexes: indexes.join('\n') + '\n', security: security.join('\n') + '\n', sequences, relations: [...names], targets: [...RECLAMATION_TABLES] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2] ?? 'supabase/recovery/reclamation-catalog.json';
  const output = process.argv[3] ?? '.artifacts/phase0/recovery-schema';
  const bytes = fs.readFileSync(input), result = buildReclamationSchema(JSON.parse(bytes));
  fs.mkdirSync(output, { recursive: true });
  for (const [name, key] of [['01_tables.sql','tables'],['02_foreign_keys.sql','foreignKeys'],['03_indexes.sql','indexes'],['04_security.sql','security']]) fs.writeFileSync(path.join(output, name), result[key]);
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ catalog_sha256: crypto.createHash('sha256').update(bytes).digest('hex'), targets: result.targets, relations: result.relations, sequences: result.sequences }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'GENERATED', target_tables: result.targets.length, total_relations: result.relations.length, output }));
}
