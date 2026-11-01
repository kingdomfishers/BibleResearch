// Prepare one atomic SQL import for the authenticated Supabase execute_sql tool.
// No service-role key is needed or written to the repository.
import { readFile, writeFile } from 'node:fs/promises';
import { BOOKS } from './stepbible-parser.mjs';
const dir = '.artifacts/stepbible';
const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8'));
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const sourceRows = manifest.sources.map(s => `(${literal(s.name)},${literal(s.url)},${literal(s.sha256)},${s.bytes})`).join(',\n');
let sql = await readFile('scripts/import-stepbible.sql', 'utf8');
for (const [key, value] of Object.entries({ SOURCES: sourceRows, BOOKS: BOOKS.map(literal).join(','), EDITION: literal(manifest.edition), WORD_COUNT: manifest.words, VERSE_COUNT: manifest.verses, TOKEN_COUNT: manifest.tokens })) sql = sql.replaceAll(`{{${key}}}`, String(value));
if (/\{\{\w+\}\}/.test(sql)) throw new Error('Unresolved SQL template marker');
await writeFile(`${dir}/import.sql`, sql);
console.log(`Prepared ${Buffer.byteLength(sql)} bytes of atomic import SQL for ${manifest.words} word forms and ${manifest.verses} passages (${manifest.edition}).`);
