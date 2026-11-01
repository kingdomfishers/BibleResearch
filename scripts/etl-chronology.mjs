// Prepare an atomic native SQL import; credentials and joins stay out of this script.
import fs from 'node:fs/promises';
import { COMMIT } from './audit-chronology.mjs';
await import('./verify-chronology-references.mjs');
const report = JSON.parse(await fs.readFile('.artifacts/chronology-audit/report.json', 'utf8'));
const mappings = JSON.parse(await fs.readFile('.artifacts/chronology-audit/mappings.json', 'utf8'));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const overrides = mappings.filter(row => row.verse > 0 && (row.sourceAddresses.length !== 1 || row.sourceAddresses[0] !== `${row.book}-${row.chapter}-${row.verse}`));
const values = overrides.flatMap(row => row.sourceIds.map(sourceId => `(${row.book},${row.chapter},${row.verse},${quote(sourceId)},${quote(JSON.stringify({ method: row.method, correspondence: row.correspondence, sourceAddresses: row.sourceAddresses }))}::jsonb)`));
let sql = await fs.readFile('scripts/import-chronology.sql', 'utf8');
const replacements = {
  SOURCES: report.sources.map(row => `(${quote(row.name)},${quote(row.url)},${quote(row.sha256)},${row.bytes})`).join(',\n'),
  COMMIT: quote(COMMIT), OVERRIDES: values.join(',\n'), EXPECTED_MAPPED: mappings.filter(row => row.status === 'reference_mapped').length,
};
for (const [key, value] of Object.entries(replacements)) sql = sql.replaceAll(`{{${key}}}`, String(value));
if (/\{\{\w+\}\}/.test(sql)) throw new Error('Unresolved SQL marker');
await fs.writeFile('.artifacts/chronology-audit/import.sql', sql);
console.log(`Prepared ${Buffer.byteLength(sql)} bytes of hash-verified native SQL; ${overrides.length} reference overrides.`);
