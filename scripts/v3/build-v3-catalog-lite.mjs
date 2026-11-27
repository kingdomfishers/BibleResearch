#!/usr/bin/env node
/**
 * Build compact uncompressed v3 catalog files from /v1/catalog/metadata.json.gz:
 *  - .artifacts-r12/staging-bundle/v3/index/catalog-books.json (~6 KB)
 *  - .artifacts-r12/staging-bundle/v3/index/catalog-verses.bin (187,218 B: Uint16 [book, chapter, verse_nr] per vid-1)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const bundleRoot = path.join(repoRoot, '.artifacts-r12', 'staging-bundle');
const metaPath = path.join(bundleRoot, 'v1', 'catalog', 'metadata.json.gz');
const outDir = path.join(bundleRoot, 'v3', 'index');

const meta = JSON.parse(zlib.gunzipSync(fs.readFileSync(metaPath)).toString('utf8'));
const verses = meta.verses_compact || [];
const buf = Buffer.allocUnsafe(verses.length * 6);
const view = new Uint16Array(buf.buffer, buf.byteOffset, verses.length * 3);

for (let i = 0; i < verses.length; i++) {
  const [id, b, c, v] = verses[i];
  if (id !== i + 1) throw new Error(`verses_compact not contiguous at ${i}: id=${id}`);
  if (i > 0) {
    const [, pb, pc, pv] = verses[i - 1];
    if (b < pb || (b === pb && c < pc) || (b === pb && c === pc && v <= pv)) {
      throw new Error(`verses_compact not monotonically sorted at ${i}: ${b}:${c}:${v}`);
    }
  }
  view[i * 3] = b;
  view[i * 3 + 1] = c;
  view[i * 3 + 2] = v;
}

const booksPayload = {
  schema_version: meta.schema_version ?? 1,
  books: meta.books || [],
  lxx_swete_books: meta.lxx_swete_books || [],
  num_verses: verses.length,
};

fs.mkdirSync(outDir, { recursive: true });
const booksPath = path.join(outDir, 'catalog-books.json');
const versesPath = path.join(outDir, 'catalog-verses.bin');
fs.writeFileSync(booksPath, JSON.stringify(booksPayload));
fs.writeFileSync(versesPath, buf);

console.log(`Wrote ${path.relative(repoRoot, booksPath)} (${fs.statSync(booksPath).size} B)`);
console.log(`Wrote ${path.relative(repoRoot, versesPath)} (${fs.statSync(versesPath).size} B, ${verses.length} verses)`);
