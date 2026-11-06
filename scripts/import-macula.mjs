// Idempotent ETL for Clear-Bible/macula-hebrew (commit 47db250)
// Imports Hebrew syntax, morphology, Cherith glosses, Clear senses, and participant referents.
// Gated values (greek, greekstrong, frame) are stored in public.macula_gated_field_values.
// Cross-linguistic alignments are stored in public.entity_relationships (explicit_source_word_alignment).
// Outputs reproducible SQL batches under .artifacts/macula/

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const TSV_PATH = path.resolve('.artifacts/sources/macula-hebrew/WLC/tsv/macula-hebrew.tsv');
const OUT_DIR = path.resolve('.artifacts/macula');
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
  if (val === null || val === undefined || val === '') return 'null';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return `'${String(val).replace(/'/g, "''")}'`;
}

const BOOK_NAME_TO_ID = {
  GEN: 1, EXO: 2, LEV: 3, NUM: 4, DEU: 5, JOS: 6, JDG: 7, RUT: 8,
  '1SA': 9, '2SA': 10, '1KI': 11, '2KI': 12, '1CH': 13, '2CH': 14,
  EZR: 15, NEH: 16, EST: 17, JOB: 18, PSA: 19, PRO: 20, ECC: 21,
  SNG: 22, ISA: 23, JER: 24, LAM: 25, EZK: 26, DAN: 27, HOS: 28,
  JOL: 29, AMO: 30, OBA: 31, JON: 32, MIC: 33, NAM: 34, HAB: 35,
  ZEP: 36, HAG: 37, ZEC: 38, MAL: 39,
};

console.log('=== MACULA Hebrew ETL SQL Generator (SEP-03) ===\n');

// 1. Resolve release and edition IDs
const releases = await postgrestSelectAll('source_releases?release_key=eq.macula-hebrew-47db250&select=id');
const editions = await postgrestSelectAll('source_editions?edition_key=eq.macula-hebrew-wlc&select=id');
if (!releases.length || !editions.length) throw new Error('Missing macula-hebrew in source_releases or source_editions.');
const releaseId = releases[0].id;
const editionId = editions[0].id;

// 2. Load verse metadata and Psalm versification mappings
console.log('Loading canonical verses and versification mappings...');
const verses = await postgrestSelectAll('verses?book=in.(1,19,23)&select=id,book,chapter,verse_nr,word_ids');
const verseMap = new Map(); // key: "book:chapter:verse" -> { id, word_ids }
for (const v of verses) {
  verseMap.set(`${v.book}:${v.chapter}:${v.verse_nr}`, v);
}

// Load MT versification mappings for Psalms
const mtMappings = await postgrestSelectAll('versification_mappings?to_book=eq.19&select=canonical_verse_id,to_chapter,to_verse_nr');
const psalmShiftMap = new Map(); // key: "to_chapter:to_verse_nr" -> canonical_verse_id
for (const m of mtMappings) {
  psalmShiftMap.set(`${m.to_chapter}:${m.to_verse_nr}`, m.canonical_verse_id);
}
console.log(`Loaded ${verses.length} verses and ${mtMappings.length} Psalm versification shifts.`);

// 3. Stream macula-hebrew.tsv for target books: GEN, PSA, ISA
const targetBookNames = new Set(['GEN', 'PSA', 'ISA']);
console.log(`Filtering for target books: ${[...targetBookNames].join(', ')}...`);

const rl = readline.createInterface({
  input: fs.createReadStream(TSV_PATH, 'utf8'),
  crlfDelay: Infinity,
});

let header = null;
const morphemeTuples = [];
const gatedTuples = [];
let lineCount = 0;

for await (const line of rl) {
  if (!header) {
    header = line.split('\t');
    continue;
  }
  const p = line.split('\t');
  const maculaId = p[0];
  const ref = p[1];
  if (!ref) continue;
  const bookAbbr = ref.split(' ')[0];
  if (!targetBookNames.has(bookAbbr)) continue;

  lineCount++;
  const bookId = BOOK_NAME_TO_ID[bookAbbr];
  // ref format: "GEN 1:1!1"
  const refMatch = /^[A-Z0-9]+\s+(\d+):(\d+)!(\d+)$/.exec(ref);
  const chMt = refMatch ? parseInt(refMatch[1], 10) : 0;
  const vMt = refMatch ? parseInt(refMatch[2], 10) : 0;
  const wNo = refMatch ? parseInt(refMatch[3], 10) : 0;
  const morphNo = parseInt(maculaId.slice(-1), 10) || 1;

  // Resolve canonical_verse_id
  let canonicalVerseId = null;
  let wordId = null;

  if (bookId === 19) {
    // Psalm with MT versification
    canonicalVerseId = psalmShiftMap.get(`${chMt}:${vMt}`) ?? null;
    if (!canonicalVerseId) {
      const vRec = verseMap.get(`${bookId}:${chMt}:${vMt}`);
      if (vRec) canonicalVerseId = vRec.id;
    }
  } else {
    const vRec = verseMap.get(`${bookId}:${chMt}:${vMt}`);
    if (vRec) canonicalVerseId = vRec.id;
  }

  if (canonicalVerseId) {
    const vRec = verses.find(x => x.id === canonicalVerseId);
    if (vRec && Array.isArray(vRec.word_ids) && wNo > 0 && wNo <= vRec.word_ids.length) {
      wordId = vRec.word_ids[wNo - 1];
    }
  }

  const linkStatus = wordId ? 'matched_consonantal' : 'unlinked';

  morphemeTuples.push(
    `(${sqlLit(maculaId)}, ${sqlLit(ref)}, ${bookId}, ${chMt}, ${vMt}, ${wNo}, ${morphNo}, ` +
    `${sqlLit(p[2])}, ${sqlLit(p[3])}, ${sqlLit(p[5])}, ${sqlLit(p[17])}, ${sqlLit(p[6])}, ` +
    `${sqlLit(p[15])}, ${sqlLit(p[16])}, ${sqlLit(p[14])}, ${sqlLit(p[23])}, ${sqlLit(p[11])}, ` +
    `${sqlLit(p[12])}, ${sqlLit(p[13])}, ${sqlLit(p[8])}, ${sqlLit(p[30])}, ${sqlLit(p[31])}, ` +
    `${canonicalVerseId ?? 'null'}, ${wordId ?? 'null'}, ${sqlLit(linkStatus)}, ` +
    `${releaseId}, ${editionId}, ${sqlLit(maculaId)}, 'directly_imported', 'macula_hebrew_tsv_row')`
  );

  // Gated fields: greek, greekstrong, frame
  const greek = (p[9] || '').trim();
  const greekstrong = (p[10] || '').trim();
  const frame = (p[29] || '').trim();

  if (greek) {
    gatedTuples.push({ maculaId, field: 'greek', val: greek });
  }
  if (greekstrong) {
    gatedTuples.push({ maculaId, field: 'greekstrong', val: greekstrong });
  }
  if (frame) {
    gatedTuples.push({ maculaId, field: 'frame', val: frame });
  }
}

console.log(`Parsed ${lineCount} morphemes across GEN, PSA, ISA.`);
console.log(`Gated field entries to link: ${gatedTuples.length} (greek, greekstrong, frame).`);

// 4. Split morpheme tuples into SQL chunks of 3000 rows
const MORPH_CHUNK_SIZE = 3000;
let morphChunkIdx = 1;
for (let i = 0; i < morphemeTuples.length; i += MORPH_CHUNK_SIZE) {
  const chunk = morphemeTuples.slice(i, i + MORPH_CHUNK_SIZE);
  let sql = `INSERT INTO public.macula_hebrew_morphemes (\n` +
    `  macula_id, ref_mt, book, chapter_mt, verse_mt, word_no, morph_no,\n` +
    `  class, text_form, after_text, lemma, strong_x,\n` +
    `  morph_code, lang, stem, morph_type, gloss,\n` +
    `  english, mandarin, sense_number, subjref, participantref,\n` +
    `  canonical_verse_id, word_id, link_status,\n` +
    `  source_release_id, source_edition_id, source_record_id, origin_mode, derivation_method\n` +
    `) VALUES\n` +
    chunk.join(',\n') +
    `\nON CONFLICT (macula_id) DO NOTHING;\n`;
  const fname = `01_morphemes_part_${String(morphChunkIdx).padStart(2, '0')}.sql`;
  fs.writeFileSync(path.join(OUT_DIR, fname), sql, 'utf8');
  morphChunkIdx++;
}
console.log(`Generated ${morphChunkIdx - 1} SQL chunks for macula_hebrew_morphemes.`);

// 5. Generate gated field values SQL chunks
// Uses subquery: SELECT m.id, 'macula-hebrew', field, val FROM macula_hebrew_morphemes m WHERE m.macula_id = ...
const GATED_CHUNK_SIZE = 3000;
let gatedChunkIdx = 1;
for (let i = 0; i < gatedTuples.length; i += GATED_CHUNK_SIZE) {
  const chunk = gatedTuples.slice(i, i + GATED_CHUNK_SIZE);
  let sql = `INSERT INTO public.macula_gated_field_values (morpheme_id, dataset_key, field_name, field_value)\n` +
    `SELECT m.id, v.d, v.f, v.val\n` +
    `FROM (VALUES\n` +
    chunk.map(g => `  (${sqlLit(g.maculaId)}, 'macula-hebrew', ${sqlLit(g.field)}, ${sqlLit(g.val)})`).join(',\n') +
    `\n) AS v(mid, d, f, val)\n` +
    `JOIN public.macula_hebrew_morphemes m ON m.macula_id = v.mid\n` +
    `ON CONFLICT (morpheme_id, field_name) DO UPDATE SET field_value = EXCLUDED.field_value;\n`;
  const fname = `02_gated_values_part_${String(gatedChunkIdx).padStart(2, '0')}.sql`;
  fs.writeFileSync(path.join(OUT_DIR, fname), sql, 'utf8');
  gatedChunkIdx++;
}
console.log(`Generated ${gatedChunkIdx - 1} SQL chunks for macula_gated_field_values.`);

console.log('\nAll MACULA Hebrew SQL files generated in .artifacts/macula/!\n');
