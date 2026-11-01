import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BOOKS, SOURCE_COMMIT, SOURCE_FILES, sourceUrl, parseLexicon, parseText, strong, wordKey } from './stepbible-parser.mjs';

const directory = '.artifacts/stepbible';
const edition = process.argv.find(x => x.startsWith('--edition='))?.split('=')[1] || 'NA28';
if (!['NA28', 'TR', 'SBL'].includes(edition)) throw new Error('Supported editions: NA28, TR, SBL');
await mkdir(directory, { recursive: true });
const sources = [];
const texts = new Map();
for (const source of SOURCE_FILES) {
  const path = `${directory}/${source.name}.txt`;
  let data;
  try { data = await readFile(path); } catch {
    const response = await fetch(sourceUrl(source.path));
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${source.path}`);
    data = Buffer.from(await response.arrayBuffer());
    await writeFile(path, data);
  }
  texts.set(source.name, data.toString('utf8'));
  sources.push({ ...source, url: sourceUrl(source.path), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
const lexicon = new Map([...parseLexicon(texts.get('TBESH'), 'H'), ...parseLexicon(texts.get('TBESG'), 'G')]);
const tokens = SOURCE_FILES.filter(s => /TAHOT|TAGNT/.test(s.name)).flatMap(s => parseText(texts.get(s.name), s.name, edition));
const forms = new Map();
for (const token of tokens) {
  const key = wordKey(token);
  if (!forms.has(key)) forms.set(key, { token, translations: new Map() });
  const counts = forms.get(key).translations;
  counts.set(token.translation, (counts.get(token.translation) || 0) + 1);
}
const words = [...forms].sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(([key, { token: t, translations }], i) => {
  const lex = lexicon.get(t.root) || lexicon.get(t.root.replace(/[A-Za-z]+$/, ''));
  return { id: i + 1, strongs_nr: strong(t.root), grammar_code: t.grammar, original_word: t.original, transliteration: t.transliteration, biblical_def: lex?.definition || lex?.gloss || null, physical_def: null, english_translations: [...translations].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([translation]) => translation).filter(Boolean), co_occurrences: [], _key: key };
});
const ids = new Map(words.map(w => [w._key, w.id]));
const passages = new Map();
for (const token of tokens) {
  const key = `${token.book}-${token.chapter}-${token.verse}`;
  if (!passages.has(key)) passages.set(key, { book: token.book, chapter: token.chapter, verse_nr: token.verse, word_ids: [], millennium: null });
  passages.get(key).word_ids.push(ids.get(wordKey(token)));
}
const verses = [...passages.values()].sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse_nr - b.verse_nr).map((v, i) => ({ id: i + 1, ...v }));
const byBook = BOOKS.map((name, i) => ({ book: i + 1, name, verses: verses.filter(v => v.book === i + 1).length, tokens: verses.filter(v => v.book === i + 1).reduce((n, v) => n + v.word_ids.length, 0) }));
if (byBook.some(b => !b.verses)) throw new Error('Missing a canonical book');
if (verses.some(v => v.word_ids.some(id => !Number.isInteger(id) || id < 1 || id > words.length))) throw new Error('Dangling word reference');
const summary = { commit: SOURCE_COMMIT, edition, words: words.length, strongs: new Set(words.map(w => w.strongs_nr)).size, verses: verses.length, titles: verses.filter(v => v.verse_nr === 0).length, tokens: tokens.length, missingDefinitions: words.filter(w => !w.biblical_def).length, byBook, sources, transformations: ['English/NRSV references supplied by STEP Bible; Psalm headings retained as verse 0', 'TAHOT primary readings including Qere/restorations; no variant column concatenation', `TAGNT edition membership: ${edition}; shared source spelling/order retained`, 'Surface forms, pointing, punctuation and morphology preserved; internal segmentation slashes removed', 'Strong tags normalized to unpadded standard numbers; extended source tags retained in audit tokens', 'Hebrew biblical_def uses STEP gloss only: restricted Online Bible Meaning column excluded', 'Chronology and physical definitions left null; co-occurrences computed in PostgreSQL'] };
await writeFile(`${directory}/words.json`, JSON.stringify(words.map(({ _key, ...w }) => w)));
await writeFile(`${directory}/verses.json`, JSON.stringify(verses));
await writeFile(`${directory}/tokens.ndjson`, tokens.map(t => JSON.stringify(t)).join('\n'));
await writeFile(`${directory}/manifest.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, sources: undefined, byBook: undefined }, null, 2));
