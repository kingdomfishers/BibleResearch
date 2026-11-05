import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = '.artifacts/ux-refresh';
const codes = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ');
const expected = 'A93DF5571009FED56F77E3AC1D3CE71C9A3A3DF1486F7570CC7A8F823192FDBA';
const sha = createHash('sha256').update(await readFile(`${root}/engwebp_usfm.zip`)).digest('hex').toUpperCase();
assert.equal(sha, expected, 'Pinned source archive changed; audit before updating its hash');
function clean(text) {
  return text.replace(/\\[fx]\s[\s\S]*?\\[fx]\*/g, '')
    .replace(/\\(?:va|vp|ca)\s[\s\S]*?\\(?:va|vp|ca)\*/g, '')
    .replace(/\\\+?w\s+([^|\\]*)(?:\|[^\\]*)?\\\+?w\*/g, '$1')
    .replace(/\\[+\w-]+\*?\s?/g, '').replace(/\s+/g, ' ').trim();
}
const files = await readdir(`${root}/english`), verses = [], books = [], omitted = [];
for (const [index, code] of codes.entries()) {
  const name = files.find(f => f.endsWith(`${code}engwebp.usfm`));
  assert(name, `Missing ${code}`);
  const raw = await readFile(`${root}/english/${name}`, 'utf8');
  let chapter = 0, verse = null, buffer = [];
  const flush = () => {
    if (verse === null) return;
    const text = clean(buffer.join(' '));
    assert(!/[\\|]|strong=/.test(text), `Unparsed markup ${code} ${chapter}:${verse}`);
    if (text) verses.push({ book: index + 1, chapter, verse_nr: verse, text });
    else omitted.push({ book: index + 1, chapter, verse_nr: verse, reason: 'Edition contains only a note, not verse text' });
    verse = null; buffer = [];
  };
  for (const line of raw.split(/\r?\n/)) {
    const c = /^\\c\s+(\d+)/.exec(line), v = /^\\v\s+(\d+)(?:\s|$)(.*)/.exec(line);
    if (c) { flush(); chapter = Number(c[1]); continue; }
    if (/^\\(?:s\d*|ms\d*|r|mr|cl|cp|toc\d*|mt\d*|h|id|ide|rem)\s/.test(line)) continue;
    if (/^\\d\s/.test(line)) { flush(); verse = 0; buffer.push(line.replace(/^\\d\s/, '')); continue; }
    if (v) { flush(); verse = Number(v[1]); buffer.push(v[2]); continue; }
    if (verse !== null) buffer.push(line);
  }
  flush(); books.push({ book: index + 1, code, verses: verses.filter(v => v.book === index + 1).length });
}
const unique = new Map();
for (const row of verses) {
  const key = `${row.book}:${row.chapter}:${row.verse_nr}`;
  const previous = unique.get(key);
  if (previous) {
    assert.equal(row.verse_nr, 0, `Duplicate numbered verse ${key}`);
    previous.text += ` ${row.text}`;
  } else unique.set(key, row);
}
verses.splice(0, verses.length, ...unique.values());
assert.equal(verses.find(v => v.book === 1 && v.chapter === 1 && v.verse_nr === 1).text,
  'In the beginning, God created the heavens and the earth.');
assert.match(verses.find(v => v.book === 19 && v.chapter === 3 && v.verse_nr === 0).text, /Absalom/);
await mkdir(`${root}/english-import`, { recursive: true });
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const chunks = [];
for (let i = 0; i < verses.length; i += 800) {
  const rows = verses.slice(i, i + 800);
  const sql = `insert into public.reader_english_verses(edition_id,book,chapter,verse_nr,text) values\n${rows.map(v => `('webp-2026-11',${v.book},${v.chapter},${v.verse_nr},${quote(v.text)})`).join(',\n')}\non conflict(edition_id,book,chapter,verse_nr) do nothing;`;
  const file = `${root}/english-import/${String(chunks.length).padStart(3, '0')}.sql`;
  await writeFile(file, sql); chunks.push(file);
}
const manifest = { source: 'https://ebible.org/Scriptures/engwebp_usfm.zip', sha256: sha, edition: 'webp-2026-11',
  attribution: 'World English Bible, Protestant edition · eBible.org · public domain',
  mapping: 'same-reference; no token alignment claimed; edition differences retained',
  excluded: 'USFM footnotes/cross references/formatting and unverified word alignment',
  total: verses.length, headings: verses.filter(v => v.verse_nr === 0).length, omitted, books, chunks };
await writeFile(`${root}/english-manifest.json`, JSON.stringify(manifest, null, 2));
await writeFile(`${root}/english-verses.json`, JSON.stringify(verses));
console.log(JSON.stringify({ ...manifest, books: books.length, chunks: chunks.length }));
