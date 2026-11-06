// Prepares <= 45 KB chunked SQL files for direct MCP execution:
// Target validation chapters: Genesis 1, Psalms 1-3, Isaiah 53

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const CHUNK_DIR = path.resolve('.artifacts/val_chunks');
fs.mkdirSync(CHUNK_DIR, { recursive: true });

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

function sqlLit(val, allowEmpty = false) {
  if (val === null || val === undefined || (!allowEmpty && val === '')) return 'null';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return `'${String(val).replace(/'/g, "''")}'`;
}

console.log('=== Chunking Validation SQL (<= 45 KB per file) ===\n');

// 1. Swete Words
const DATA_DIR = path.resolve('.artifacts/sources/lxx-swete/data');
const lxxFiles = [
  { no: 1, file: '01.Genesis.txt', filter: (ch, v) => ch === 1 },
  { no: 27, file: '27.Psalmi.txt', filter: (ch, v) => ch >= 1 && ch <= 3 },
  { no: 48, file: '48.Isaias.txt', filter: (ch, v) => ch === 53 },
];

const lxxWordTuples = [];
for (const spec of lxxFiles) {
  const lines = fs.readFileSync(path.join(DATA_DIR, spec.file), 'utf8').split(/\r?\n/);
  const ordinals = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = /^(\d+)\.(\d+)\.(\d+)([a-z]*) (.+)$/.exec(line);
    if (!m) continue;
    const ch = parseInt(m[2], 10);
    const v = parseInt(m[3], 10);
    if (!spec.filter(ch, v)) continue;
    const suffix = m[4] || '';
    const wordText = m[5].trim();
    const key = `${ch}.${v}.${suffix}`;
    const nextOrd = (ordinals.get(key) || 0) + 1;
    ordinals.set(key, nextOrd);

    lxxWordTuples.push(
      `(${spec.no}, ${ch}, ${v}, ${sqlLit(suffix, true)}, ${nextOrd}, ${sqlLit(wordText)}, ${sqlLit(`SWETE:${spec.no}.${ch}.${v}${suffix}#${nextOrd}`)})`
    );
  }
}

// Write LXX Words in 2 parts (700 words each, ~45 KB)
const LXX_WORDS_PART_SIZE = 750;
let lxxPart = 1;
for (let i = 0; i < lxxWordTuples.length; i += LXX_WORDS_PART_SIZE) {
  const chunk = lxxWordTuples.slice(i, i + LXX_WORDS_PART_SIZE);
  let sql = `INSERT INTO public.lxx_swete_words (book_no, chapter, verse_nr, verse_suffix, ordinal, word_text, source_record_id)\nVALUES\n`;
  sql += chunk.join(',\n');
  sql += `\nON CONFLICT (book_no, chapter, verse_nr, verse_suffix, ordinal) DO NOTHING;\n`;
  fs.writeFileSync(path.join(CHUNK_DIR, `lxx_words_part_${lxxPart}.sql`), sql, 'utf8');
  lxxPart++;
}

// 2. Verse mappings (70 mappings, ~8 KB)
const verses = await postgrestSelectAll(
  'verses?or=(and(book.eq.1,chapter.eq.1),and(book.eq.19,chapter.in.(1,2,3)),and(book.eq.23,chapter.eq.53))&select=id,book,chapter,verse_nr,word_ids&order=book,chapter,verse_nr'
);
const mappingTuples = [];
for (const v of verses) {
  if (v.book === 1) {
    mappingTuples.push(
      `(${v.id}, 1, ${v.chapter}, ${v.verse_nr}, '', 'same_reference', 'Genesis MT and LXX share identical chapter and verse numbering.', 'algorithmically_calculated', 'genesis_mt_lxx_direct_correspondence', '1.0.0', 9, ${sqlLit(`GEN.MT-LXX:${v.chapter}.${v.verse_nr}`)})`
    );
  } else if (v.book === 23) {
    mappingTuples.push(
      `(${v.id}, 48, ${v.chapter}, ${v.verse_nr}, '', 'same_reference', 'Isaiah MT and LXX share standard chapter and verse numbering.', 'algorithmically_calculated', 'isaiah_mt_lxx_direct_correspondence', '1.0.0', 9, ${sqlLit(`ISA.MT-LXX:${v.chapter}.${v.verse_nr}`)})`
    );
  } else if (v.book === 19) {
    const lxxCh = v.chapter;
    let lxxV = v.verse_nr;
    let vKind = 'same_reference';
    if (v.chapter === 3) {
      if (v.verse_nr === 0) {
        lxxV = 1;
        vKind = 'versification_shift';
      } else {
        lxxV = v.verse_nr + 1;
        vKind = 'versification_shift';
      }
    }
    mappingTuples.push(
      `(${v.id}, 27, ${lxxCh}, ${lxxV}, '', ${sqlLit(vKind)}, ${sqlLit(`Psalms MT ${v.chapter}:${v.verse_nr} -> LXX Swete ${lxxCh}:${lxxV}.`)}, 'algorithmically_calculated', 'psalms_mt_lxx_versification_shift', '1.0.0', 9, ${sqlLit(`PSA.MT-LXX:${v.chapter}.${v.verse_nr}->${lxxCh}.${lxxV}`)})`
    );
  }
}
let mapSql = `INSERT INTO public.hebrew_lxx_verse_map (canonical_verse_id, lxx_book_no, lxx_chapter, lxx_verse_nr, lxx_verse_suffix, mapping_kind, rule_citation, origin_mode, derivation_method, algorithm_version, source_release_id, source_record_id)\nVALUES\n`;
mapSql += mappingTuples.join(',\n');
mapSql += `;\n`;
fs.writeFileSync(path.join(CHUNK_DIR, `hebrew_lxx_mappings.sql`), mapSql, 'utf8');

// 3. MACULA Morphemes (1314 morphemes, ~45 KB per 250 morphemes -> 6 parts)
const TSV_PATH = path.resolve('.artifacts/sources/macula-hebrew/WLC/tsv/macula-hebrew.tsv');
const verseMap = new Map();
for (const v of verses) {
  verseMap.set(`${v.book}:${v.chapter}:${v.verse_nr}`, v);
}
const mtMappings = await postgrestSelectAll('versification_mappings?to_book=eq.19&to_chapter=in.(1,2,3)&select=canonical_verse_id,to_chapter,to_verse_nr');
const psalmShiftMap = new Map();
for (const m of mtMappings) {
  psalmShiftMap.set(`${m.to_chapter}:${m.to_verse_nr}`, m.canonical_verse_id);
}
const BOOK_MAP = { GEN: 1, PSA: 19, ISA: 23 };

const rl = readline.createInterface({
  input: fs.createReadStream(TSV_PATH, 'utf8'),
  crlfDelay: Infinity,
});

let header = null;
const morphemeTuples = [];
const gatedTuples = [];

for await (const line of rl) {
  if (!header) { header = line.split('\t'); continue; }
  const p = line.split('\t');
  const maculaId = p[0];
  const ref = p[1];
  if (!ref) continue;
  const bookAbbr = ref.split(' ')[0];
  if (!BOOK_MAP[bookAbbr]) continue;

  const refMatch = /^[A-Z0-9]+\s+(\d+):(\d+)!(\d+)$/.exec(ref);
  if (!refMatch) continue;
  const chMt = parseInt(refMatch[1], 10);
  const vMt = parseInt(refMatch[2], 10);
  const wNo = parseInt(refMatch[3], 10);
  const morphNo = parseInt(maculaId.slice(-1), 10) || 1;

  let isTarget = false;
  if (bookAbbr === 'GEN' && chMt === 1) isTarget = true;
  if (bookAbbr === 'PSA' && chMt >= 1 && chMt <= 3) isTarget = true;
  if (bookAbbr === 'ISA' && chMt === 53) isTarget = true;
  if (!isTarget) continue;

  const bookId = BOOK_MAP[bookAbbr];
  let canonicalVerseId = null;
  let wordId = null;

  if (bookId === 19) {
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
    `7, 11, ${sqlLit(maculaId)}, 'directly_imported', 'macula_hebrew_tsv_row')`
  );

  const greek = (p[9] || '').trim();
  const greekstrong = (p[10] || '').trim();
  const frame = (p[29] || '').trim();

  if (greek) gatedTuples.push({ maculaId, field: 'greek', val: greek });
  if (greekstrong) gatedTuples.push({ maculaId, field: 'greekstrong', val: greekstrong });
  if (frame) gatedTuples.push({ maculaId, field: 'frame', val: frame });
}

const MORPH_SIZE = 125;
let morphPart = 1;
for (let i = 0; i < morphemeTuples.length; i += MORPH_SIZE) {
  const chunk = morphemeTuples.slice(i, i + MORPH_SIZE);
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
  fs.writeFileSync(path.join(CHUNK_DIR, `macula_morph_part_${morphPart}.sql`), sql, 'utf8');
  morphPart++;
}

// 4. Gated tuples (2294 entries -> 5 parts of ~450 rows, ~40 KB)
const GATED_SIZE = 450;
let gatedPart = 1;
for (let i = 0; i < gatedTuples.length; i += GATED_SIZE) {
  const chunk = gatedTuples.slice(i, i + GATED_SIZE);
  let sql = `INSERT INTO public.macula_gated_field_values (morpheme_id, dataset_key, field_name, field_value)\n` +
    `SELECT m.id, v.d, v.f, v.val\n` +
    `FROM (VALUES\n` +
    chunk.map(g => `  (${sqlLit(g.maculaId)}, 'macula-hebrew', ${sqlLit(g.field)}, ${sqlLit(g.val)})`).join(',\n') +
    `\n) AS v(mid, d, f, val)\n` +
    `JOIN public.macula_hebrew_morphemes m ON m.macula_id = v.mid\n` +
    `ON CONFLICT (morpheme_id, field_name) DO UPDATE SET field_value = EXCLUDED.field_value;\n`;
  fs.writeFileSync(path.join(CHUNK_DIR, `macula_gated_part_${gatedPart}.sql`), sql, 'utf8');
  gatedPart++;
}

console.log(`Generated in ${CHUNK_DIR}:`);
console.log(`  lxx_words: ${lxxPart - 1} parts`);
console.log(`  hebrew_lxx_mappings: 1 part`);
console.log(`  macula_morph: ${morphPart - 1} parts`);
console.log(`  macula_gated: ${gatedPart - 1} parts`);
