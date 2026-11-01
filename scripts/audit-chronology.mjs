// Read-only chronology source audit; never connects to or changes the database.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const COMMIT = '744355c7a5f38efd407bc67a5257c99aca9532bc';
const root = '.artifacts/chronology-audit';
const sources = {
  verses: '056ca2a13683ca4aca020aae6655f0b488a8abc291959b385ef83ba1c7db0fff',
  events: 'e616381e79402b15842ce668d0884f6659250487c260a0cc41dada2e1748ddf5',
  books: 'fdaebcc53eff498e52b161be67bbc278a619cdcab843a439202d89388affd99a',
};
await fs.mkdir(root, { recursive: true });
const tables = {};
const manifest = [];
for (const [name, expected] of Object.entries(sources)) {
  const url = `https://raw.githubusercontent.com/robertrouse/theographic-bible-metadata/${COMMIT}/json/${name}.json`;
  const path = `${root}/${name}.json`;
  if (process.argv.includes('--download')) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`${name}: download checksum mismatch`);
    await fs.writeFile(path, bytes);
  }
  const bytes = await fs.readFile(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expected) throw new Error(`${name}: checksum mismatch; use --download to restore pinned data`);
  tables[name] = JSON.parse(bytes);
  manifest.push({ name, url, sha256, bytes: bytes.length, rows: tables[name].length });
}

const address = id => {
  if (!/^\d{8}$/.test(id)) throw new Error(`Invalid verseID: ${id}`);
  return `${Number(id.slice(0, 2))}-${Number(id.slice(2, 5))}-${Number(id.slice(5))}`;
};
const hasYear = record => Number.isInteger(record.fields.yearNum);
const yearFromDate = date => {
  const match = String(date ?? '').match(/^(-?\d+)(?:-\d{2}-\d{2})?$/);
  if (!match) throw new Error(`Invalid source startDate: ${date}`);
  return Number(match[1]);
};
const verses = new Map(tables.verses.map(record => [record.id, record]));
const addresses = new Map(tables.verses.map(record => [address(record.fields.verseID), record]));
if (verses.size !== tables.verses.length || addresses.size !== verses.size) throw new Error('Duplicate source identity/address');
const linked = new Set();
const disagreements = [];
let danglingEventLinks = 0;
for (const event of tables.events) {
  const year = yearFromDate(event.fields.startDate);
  for (const id of new Set(event.fields.verses ?? [])) {
    const verse = verses.get(id);
    if (!verse) { danglingEventLinks++; continue; }
    linked.add(id);
    if (hasYear(verse) && verse.fields.yearNum !== year) {
      disagreements.push({ reference: verse.fields.osisRef, verseYear: verse.fields.yearNum,
        eventId: event.id, event: event.fields.title, eventStartYear: year });
    }
  }
}
const byBook = tables.books.map(({ fields: book }) => {
  const rows = tables.verses.filter(record => Number(record.fields.verseID.slice(0, 2)) === book.bookOrder);
  return { book: book.bookOrder, name: book.bookName, verses: rows.length,
    verseYear: rows.filter(hasYear).length, eventLinked: rows.filter(record => linked.has(record.id)).length,
    neither: rows.filter(record => !hasYear(record) && !linked.has(record.id)).length };
});
let local = null;
try {
  const step = JSON.parse(await fs.readFile('.artifacts/stepbible/verses.json', 'utf8'));
  const matched = step.map(row => ({ row, source: addresses.get(`${row.book}-${row.chapter}-${row.verse_nr}`) }));
  local = { passages: step.length, headings: step.filter(row => row.verse_nr === 0).length,
    sameAddress: matched.filter(row => row.source).length,
    sameAddressWithVerseYear: matched.filter(row => row.source && hasYear(row.source)).length,
    sameAddressWithEvent: matched.filter(row => row.source && linked.has(row.source.id)).length,
    noSameAddress: matched.filter(row => !row.source).map(({ row }) => `${row.book}-${row.chapter}-${row.verse_nr}`),
    caution: 'Address candidates only: KJV and STEP English/NRSV numbering require an explicit versification audit before publication.' };
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const report = { commit: COMMIT, sources: manifest,
  source: { verses: verses.size, verseYears: tables.verses.filter(hasYear).length,
    noVerseYear: tables.verses.filter(record => !hasYear(record)).length,
    zeroYears: tables.verses.filter(record => record.fields.yearNum === 0).length,
    events: tables.events.length, eventLinkedVerses: linked.size,
    verseYearOrEvent: tables.verses.filter(record => hasYear(record) || linked.has(record.id)).length,
    neither: tables.verses.filter(record => !hasYear(record) && !linked.has(record.id)).length,
    danglingEventLinks, eventStartDisagreements: disagreements.length },
  caveat: 'Event mentions do not prove narrative setting; differing start years can reflect event duration, retrospection or different chronology models.',
  byBook, local, disagreementExamples: disagreements.slice(0, 20),
  selectedPassages: ['Gen.2.7', 'John.1.1', 'Acts.2.1', 'Rev.1.1'].map(reference => {
    const verse = tables.verses.find(record => record.fields.osisRef === reference);
    return { reference, year: verse?.fields.yearNum ?? null,
      events: tables.events.filter(event => event.fields.verses?.includes(verse?.id))
        .map(event => ({ title: event.fields.title, startDate: event.fields.startDate })) };
  }) };
await fs.writeFile(`${root}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ commit: COMMIT, ...report.source,
  local: local && { ...local, noSameAddress: local.noSameAddress.length },
  selectedPassages: report.selectedPassages }, null, 2));
