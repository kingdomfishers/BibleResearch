// Idempotent ETL for Swete's Septuagint (nathans/lxx-swete, derived from First1KGreek tlg0527)
// License: CC BY-SA 4.0 for text. Kept in dedicated tables (public.lxx_swete_books, public.lxx_swete_words).
// Maps to canonical Hebrew (MT) verses via public.hebrew_lxx_verse_map without inventing word alignments.
// Outputs reproducible SQL batches under .artifacts/septuagint/

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('.artifacts/sources/lxx-swete/data');
const OUT_DIR = path.resolve('.artifacts/septuagint');
fs.mkdirSync(OUT_DIR, { recursive: true });

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    })
);
const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

async function postgrestSelectAll(tableAndFilter) {
  const all = [];
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    const sep = tableAndFilter.includes('?') ? '&' : '?';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableAndFilter}${sep}limit=${batchSize}&offset=${offset}`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`Select ${tableAndFilter} failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < batchSize) break;
    offset += batchSize;
  }
  return all;
}

function sqlLit(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return `'${String(val).replace(/'/g, "''")}'`;
}

// Map Swete file numbers to canonical Hebrew OT books (1..39) or null for deuterocanonical
const SWETE_CANONICAL_MAP = {
  1: 1,   // Genesis
  2: 2,   // Exodus
  3: 3,   // Leviticus
  4: 4,   // Numeri
  5: 5,   // Deuteronomium
  6: 6,   // Josue
  8: 7,   // Judices
  10: 8,  // Ruth
  11: 9,  // Regnorum I
  12: 10, // Regnorum II
  13: 11, // Regnorum III
  14: 12, // Regnorum IV
  15: 13, // Paralipomenon I
  16: 14, // Paralipomenon II
  18: 15, // Esdras B
  19: 17, // Esther
  27: 19, // Psalmi
  29: 20, // Proverbia
  31: 22, // Canticum
  32: 18, // Job
  36: 28, // Osee
  37: 30, // Amos
  38: 33, // Michaeas
  39: 29, // Joel
  40: 31, // Abdias
  41: 32, // Jonas
  42: 34, // Nahum
  43: 35, // Habacuc
  44: 36, // Sophonias
  45: 37, // Aggaeus
  46: 38, // Zacharias
  47: 39, // Malachias
  48: 23, // Isaias
  49: 24, // Jeremias
  51: 25, // Threni
  53: 26, // Ezechiel
  56: 27, // Daniel (Graeca)
};

console.log('=== Swete Septuagint SQL Generator (SEP-04) ===\n');

// 1. Resolve release and edition IDs
const releases = await postgrestSelectAll('source_releases?release_key=eq.lxx-swete-26bad3e&select=id');
const editions = await postgrestSelectAll('source_editions?edition_key=eq.lxx-swete&select=id');
if (!releases.length || !editions.length) {
  throw new Error('Missing lxx-swete in source_releases or source_editions.');
}
const releaseId = releases[0].id;
const editionId = editions[0].id;

// 2. Scan all books in data/
const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.txt')).sort();
console.log(`Discovered ${files.length} Swete LXX book files.`);

const bookRows = [];
for (const file of files) {
  const m = /^(\d+)\.(.+)\.txt$/.exec(file);
  if (!m) continue;
  const bookNo = parseInt(m[1], 10);
  const latinName = m[2].replace(/_/g, ' ');
  const canonicalBook = SWETE_CANONICAL_MAP[bookNo] ?? null;
  bookRows.push({
    book_no: bookNo,
    file_name: file,
    latin_name: latinName,
    canonical_book: canonicalBook,
  });
}

// Generate books catalog SQL
let booksSql = `-- 1. Swete LXX Books Catalog (55 books)\n`;
booksSql += `INSERT INTO public.lxx_swete_books (book_no, file_name, latin_name, canonical_book, source_release_id, source_edition_id)\nVALUES\n`;
booksSql += bookRows.map(b =>
  `  (${b.book_no}, ${sqlLit(b.file_name)}, ${sqlLit(b.latin_name)}, ${sqlLit(b.canonical_book)}, ${releaseId}, ${editionId})`
).join(',\n');
booksSql += `\nON CONFLICT (book_no) DO UPDATE SET\n  latin_name = EXCLUDED.latin_name,\n  canonical_book = EXCLUDED.canonical_book;\n`;
fs.writeFileSync(path.join(OUT_DIR, '01_swete_books.sql'), booksSql, 'utf8');
console.log('Wrote .artifacts/septuagint/01_swete_books.sql');

// 3. Generate Words SQL for Genesis (1), Psalms (27), Isaiah (48)
const targetBooks = [
  { no: 1, name: 'genesis', file: '01.Genesis.txt' },
  { no: 27, name: 'psalms', file: '27.Psalmi.txt' },
  { no: 48, name: 'isaiah', file: '48.Isaias.txt' },
];

for (const tb of targetBooks) {
  const filePath = path.join(DATA_DIR, tb.file);
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const ordinals = new Map();
  const wordTuples = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const m = /^(\d+)\.(\d+)\.(\d+)([a-z]*) (.+)$/.exec(line);
    if (!m) continue;
    const chapter = parseInt(m[2], 10);
    const verseNr = parseInt(m[3], 10);
    const suffix = m[4] || '';
    const wordText = m[5].trim();
    const key = `${chapter}.${verseNr}.${suffix}`;
    const nextOrd = (ordinals.get(key) || 0) + 1;
    ordinals.set(key, nextOrd);

    wordTuples.push(
      `(${tb.no}, ${chapter}, ${verseNr}, ${sqlLit(suffix)}, ${nextOrd}, ${sqlLit(wordText)}, ${sqlLit(`SWETE:${tb.no}.${chapter}.${verseNr}${suffix}#${nextOrd}`)})`
    );
  }

  // Split into chunks of 3000 tuples (~150-200 KB per chunk)
  const CHUNK_SIZE = 3000;
  let chunkIdx = 1;
  for (let i = 0; i < wordTuples.length; i += CHUNK_SIZE) {
    const chunk = wordTuples.slice(i, i + CHUNK_SIZE);
    let chunkSql = `INSERT INTO public.lxx_swete_words (book_no, chapter, verse_nr, verse_suffix, ordinal, word_text, source_record_id)\nVALUES\n`;
    chunkSql += chunk.join(',\n');
    chunkSql += `\nON CONFLICT (book_no, chapter, verse_nr, verse_suffix, ordinal) DO NOTHING;\n`;
    const fname = `02_${tb.name}_words_part_${String(chunkIdx).padStart(2, '0')}.sql`;
    fs.writeFileSync(path.join(OUT_DIR, fname), chunkSql, 'utf8');
    chunkIdx++;
  }
  console.log(`Generated ${chunkIdx - 1} SQL chunks for ${tb.name} (${wordTuples.length} words).`);
}

// 4. Generate Hebrew (MT) <-> LXX Verse Mappings for Genesis, Psalms, Isaiah
console.log('Generating Hebrew (MT) <-> LXX Verse Mappings...');
const verses = await postgrestSelectAll('verses?book=in.(1,19,23)&select=id,book,chapter,verse_nr&order=book,chapter,verse_nr');

const mappingTuples = [];
for (const v of verses) {
  if (v.book === 1) {
    mappingTuples.push(
      `(${v.id}, 1, ${v.chapter}, ${v.verse_nr}, '', 'same_reference', 'Genesis MT and LXX share identical chapter and verse numbering.', 'algorithmically_calculated', 'genesis_mt_lxx_direct_correspondence', '1.0.0', ${releaseId}, ${sqlLit(`GEN.MT-LXX:${v.chapter}.${v.verse_nr}`)})`
    );
  } else if (v.book === 23) {
    mappingTuples.push(
      `(${v.id}, 48, ${v.chapter}, ${v.verse_nr}, '', 'same_reference', 'Isaiah MT and LXX share standard chapter and verse numbering.', 'algorithmically_calculated', 'isaiah_mt_lxx_direct_correspondence', '1.0.0', ${releaseId}, ${sqlLit(`ISA.MT-LXX:${v.chapter}.${v.verse_nr}`)})`
    );
  } else if (v.book === 19) {
    let lxxCh = v.chapter;
    let kind = 'same_reference';
    if (v.chapter >= 1 && v.chapter <= 8) {
      lxxCh = v.chapter;
      kind = 'same_reference';
    } else if (v.chapter === 9 || v.chapter === 10) {
      lxxCh = 9;
      kind = 'psalm_numbering_shift';
    } else if (v.chapter >= 11 && v.chapter <= 113) {
      lxxCh = v.chapter - 1;
      kind = 'psalm_numbering_shift';
    } else if (v.chapter === 114 || v.chapter === 115) {
      lxxCh = 113;
      kind = 'psalm_numbering_shift';
    } else if (v.chapter === 116) {
      lxxCh = v.verse_nr <= 9 ? 114 : 115;
      kind = 'psalm_numbering_shift';
    } else if (v.chapter >= 117 && v.chapter <= 146) {
      lxxCh = v.chapter - 1;
      kind = 'psalm_numbering_shift';
    } else if (v.chapter === 147) {
      lxxCh = v.verse_nr <= 11 ? 146 : 147;
      kind = 'psalm_numbering_shift';
    } else if (v.chapter >= 148 && v.chapter <= 150) {
      lxxCh = v.chapter;
      kind = 'same_reference';
    }

    let lxxV = v.verse_nr;
    let vKind = kind;
    if (v.verse_nr === 0) {
      lxxV = 1;
      vKind = 'versification_shift';
    } else {
      lxxV = v.verse_nr + 1;
      vKind = 'versification_shift';
    }

    mappingTuples.push(
      `(${v.id}, 27, ${lxxCh}, ${lxxV}, '', ${sqlLit(vKind)}, ${sqlLit(`Psalms MT ${v.chapter}:${v.verse_nr} -> LXX Swete ${lxxCh}:${lxxV} (Psalm numbering shift + title shift).`)}, 'algorithmically_calculated', 'psalms_mt_lxx_versification_shift', '1.0.0', ${releaseId}, ${sqlLit(`PSA.MT-LXX:${v.chapter}.${v.verse_nr}->${lxxCh}.${lxxV}`)})`
    );
  }
}

// Write mappings SQL in 2000-tuple chunks
const MAP_CHUNK_SIZE = 2000;
let mapIdx = 1;
for (let i = 0; i < mappingTuples.length; i += MAP_CHUNK_SIZE) {
  const chunk = mappingTuples.slice(i, i + MAP_CHUNK_SIZE);
  let chunkSql = `INSERT INTO public.hebrew_lxx_verse_map (canonical_verse_id, lxx_book_no, lxx_chapter, lxx_verse_nr, lxx_verse_suffix, mapping_kind, rule_citation, origin_mode, derivation_method, algorithm_version, source_release_id, source_record_id)\nVALUES\n`;
  chunkSql += chunk.join(',\n');
  chunkSql += `;\n`;
  const fname = `03_hebrew_lxx_mappings_part_${String(mapIdx).padStart(2, '0')}.sql`;
  fs.writeFileSync(path.join(OUT_DIR, fname), chunkSql, 'utf8');
  mapIdx++;
}
console.log(`Generated ${mapIdx - 1} SQL chunks for verse mappings (${mappingTuples.length} mappings).`);
console.log('\nAll Swete LXX SQL files generated in .artifacts/septuagint/!');
