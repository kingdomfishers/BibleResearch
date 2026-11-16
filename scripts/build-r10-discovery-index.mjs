#!/usr/bin/env node
/**
 * R11 Universal Discovery Index Builder
 * Builds compact, provenance-tracked indexes in .artifacts-r10/staging/v2/relationships/r11-v1.0/
 * from verified pinned local sources (STEPBible, MACULA, MorphHB, CrossReferences-org excl. s21,
 * Swete Septuagint, Theographic Bible Data, WEB public domain). Zero AI at build time; zero restricted fields.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_ID = 'r11-v1.0';
const STATIC_TABLES = path.join(ROOT, '.artifacts', 'static-corpus', 'tables');
const XREF_DIR = path.join(ROOT, '.artifacts-r10', 'sources', 'bible-cross-references', 'json');
const CHRON_DIR = fs.existsSync(path.join(ROOT, '.artifacts', 'chronology-audit'))
  ? path.join(ROOT, '.artifacts', 'chronology-audit')
  : 'C:\\Projects\\BibleResearch\\.artifacts\\chronology-audit';
const ANNOT_DIR = path.join(ROOT, 'data', 'annotations');
const OUT_ROOT = path.join(ROOT, '.artifacts-r10', 'staging', 'v2', 'relationships', 'r11-v1.0');
const R8_BY_LEMMA_DIR = path.join(ROOT, '.artifacts-r10', 'deploy-bundle', 'v2', 'relationships', 'r8-v1.1', 'by-lemma');
const LXX_BRIDGE_PATH = path.join(ROOT, 'data', 'sources', 'bcv-lxx-bridge', 'lxx_bridge.tsv');

const RESTRICTED_KEYS = new Set([
  'semantic_frame', 'frame', 'greekstrong', 'sdbh', 'lexdomain',
  'coredomain', 'contextualdomain', 'domain', 'ln', 's21', 'tbesh_col_7',
]);

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64Hex(input) {
  let hash = FNV_OFFSET_64;
  const str = String(input);
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

function bucketHex64(key) {
  const idx = Number(BigInt('0x' + fnv1a64Hex(key)) % 64n);
  return idx.toString(16).padStart(2, '0');
}

function normalizeStrongs(raw) {
  if (!raw) return '';
  const m = String(raw).trim().toUpperCase().match(/^([HG])0*(\d+)([A-Z]?)$/);
  if (!m) return String(raw).trim().toUpperCase();
  return `${m[1]}${m[2].padStart(4, '0')}${m[3]}`;
}

function baseStrongs(raw) {
  if (!raw) return '';
  const m = String(raw).trim().toUpperCase().match(/^([HG])0*(\d+)/);
  return m ? `${m[1]}${m[2].padStart(4, '0')}` : String(raw).trim().toUpperCase();
}

function stripDiacriticsHebrew(s) {
  return String(s || '')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[^\u05D0-\u05EA]/g, '');
}

function stripDiacriticsGreek(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ς/g, 'σ');
}

function normalizeAscii(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.\-_'’"`]/g, '')
    .trim();
}

function singularizeEn(w) {
  if (!w || w.length <= 2) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ves') && w.length > 4) return w.slice(0, -3) + 'f';
  if (w.endsWith('sses') || w.endsWith('shes') || w.endsWith('ches') || w.endsWith('xes')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

function pluralizeEn(w) {
  if (!w || w.length <= 2) return w;
  if (w.endsWith('y') && !/[aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  if (w.endsWith('f')) return w.slice(0, -1) + 'ves';
  if (w.endsWith('s') || w.endsWith('sh') || w.endsWith('ch') || w.endsWith('x')) return w + 'es';
  return w + 's';
}

function readJsonlGzTable(tblName) {
  const dir = path.join(STATIC_TABLES, tblName);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl.gz')).sort();
  const rows = [];
  for (const f of files) {
    const text = zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8');
    for (const line of text.split('\n')) {
      if (line) rows.push(JSON.parse(line));
    }
  }
  return rows;
}

function streamJsonlGzTable(tblName, onRow) {
  const dir = path.join(STATIC_TABLES, tblName);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl.gz')).sort();
  for (const f of files) {
    const text = zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8');
    for (const line of text.split('\n')) {
      if (line) onRow(JSON.parse(line));
    }
  }
}

function assertCleanObject(obj, label) {
  const stack = [obj];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
    } else {
      for (const [k, v] of Object.entries(cur)) {
        if (RESTRICTED_KEYS.has(k)) {
          throw new Error(`Restricted key "${k}" detected in ${label}`);
        }
        stack.push(v);
      }
    }
  }
}

function writeGzJson(relPath, payload) {
  assertCleanObject(payload, relPath);
  const fullPath = path.join(OUT_ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  const gz = zlib.gzipSync(raw, { level: 9 });
  fs.writeFileSync(fullPath, gz);
  const prefix = `/v2/relationships/${RELEASE_ID}/${relPath.replaceAll('\\', '/')}`;
  return {
    path: prefix,
    raw_bytes: raw.length,
    gz_bytes: gz.length,
    sha256_raw: crypto.createHash('sha256').update(raw).digest('hex'),
    sha256_gz: crypto.createHash('sha256').update(gz).digest('hex'),
  };
}

function writePlainJson(relPath, payload) {
  assertCleanObject(payload, relPath);
  const fullPath = path.join(OUT_ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const raw = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(fullPath, raw);
  return raw;
}

const t0 = Date.now();
console.log(`R11 Index Build starting (${RELEASE_ID})...`);
fs.rmSync(OUT_ROOT, { recursive: true, force: true });
fs.mkdirSync(OUT_ROOT, { recursive: true });

// 1. Load books
const books = readJsonlGzTable('books');
const bookById = new Map(books.map(b => [b.id, b]));
const bookByUsfm = new Map(books.map(b => [b.usfm.toUpperCase(), b]));
const bookByNameLower = new Map();
for (const b of books) {
  bookByNameLower.set(b.name.toLowerCase(), b);
  bookByNameLower.set(b.usfm.toLowerCase(), b);
  bookByNameLower.set(b.name.toLowerCase().replace(/\s+/g, ''), b);
}
const BOOK_ALIASES = new Map([
  ['gen', 1], ['ge', 1], ['gn', 1], ['genesis', 1],
  ['ex', 2], ['exo', 2], ['exod', 2], ['exodus', 2],
  ['lev', 3], ['leviticus', 3], ['num', 4], ['numbers', 4], ['deut', 5], ['dt', 5], ['deuteronomy', 5],
  ['josh', 6], ['judg', 7], ['ruth', 8], ['1 sam', 9], ['1sam', 9], ['2 sam', 10], ['2sam', 10],
  ['1 kgs', 11], ['1 kings', 11], ['2 kgs', 12], ['2 kings', 12],
  ['ps', 19], ['psa', 19], ['psalm', 19], ['psalms', 19],
  ['prov', 20], ['isa', 23], ['jer', 24], ['ezek', 26], ['eze', 26], ['dan', 27],
  ['hos', 28], ['joel', 29], ['amos', 30], ['jonah', 32], ['mic', 33],
  ['zech', 38], ['zec', 38], ['zechariah', 38], ['mal', 39],
  ['matt', 40], ['mt', 40], ['mark', 41], ['mk', 41], ['luke', 42], ['lk', 42],
  ['john', 43], ['jn', 43], ['jhn', 43], ['acts', 44], ['rom', 45],
  ['1 cor', 46], ['1cor', 46], ['1 corinthians', 46], ['2 cor', 47], ['2cor', 47], ['2 corinthians', 47],
  ['gal', 48], ['eph', 49], ['phil', 50], ['col', 51],
  ['heb', 58], ['hebrews', 58], ['jas', 59], ['1 pet', 60], ['1pet', 60], ['1 peter', 60], ['2 pet', 61], ['2pet', 61],
  ['1 john', 62], ['1jn', 62], ['jude', 65], ['rev', 66], ['revelation', 66], ['apoc', 66],
]);

function coordKey(book, chapter, verse) {
  return `${book}:${chapter}:${verse}`;
}
function formatRef(book, chapter, verse) {
  const b = bookById.get(book);
  const bName = b ? b.name : `Book ${book}`;
  if (verse !== undefined && verse !== null) {
    return `${bName} ${chapter}:${verse}`;
  }
  return `${bName} ${chapter}`;
}

// 2. Load authoritative canonical coordinates FIRST from verses_immutable
console.log('Loading authoritative canonical verses_immutable...');
const canonVerses = readJsonlGzTable('verses_immutable');
const verseIdByCoord = new Map();
const coordByVerseId = new Map();
const wordToVid = new Map();

for (const v of canonVerses) {
  const ck = coordKey(v.book, v.chapter, v.verse_nr);
  verseIdByCoord.set(ck, v.id);
  coordByVerseId.set(v.id, {
    book: v.book,
    chapter: v.chapter,
    verse: v.verse_nr,
    key: ck,
    ref: formatRef(v.book, v.chapter, v.verse_nr),
    word_ids: v.word_ids || [],
    is_psalm_heading: v.book === 19 && v.verse_nr === 0,
  });
  if (v.word_ids) {
    for (const wid of v.word_ids) {
      wordToVid.set(wid, v.id);
    }
  }
}
console.log(`Loaded ${canonVerses.length} canonical verses, ${wordToVid.size} word mappings.`);

// Load WEB English verses
const englishByCoord = new Map();
streamJsonlGzTable('reader_english_verses', r => {
  englishByCoord.set(coordKey(r.book, r.chapter, r.verse_nr), r.text);
});

// Load versification mappings & hebrew_lxx_verse_map
const mtRefByVid = new Map();
const vidByLxxCoord = new Map();
const lxxCoordByVid = new Map();

const versificationMappings = readJsonlGzTable('versification_mappings');
for (const vm of versificationMappings) {
  const c = coordByVerseId.get(vm.canonical_verse_id);
  if (c && (vm.to_chapter !== c.chapter || vm.to_verse_nr !== c.verse)) {
    mtRefByVid.set(vm.canonical_verse_id, formatRef(vm.to_book, vm.to_chapter, vm.to_verse_nr));
  }
}

streamJsonlGzTable('hebrew_lxx_verse_map', r => {
  const k = `${r.lxx_book_no}:${r.lxx_chapter}:${r.lxx_verse_nr}`;
  const vid = Number(r.canonical_verse_id);
  vidByLxxCoord.set(k, vid);
  lxxCoordByVid.set(vid, k);
});

// Load CrossReferences.org bible_verses.json -> map xref verse_id -> canonical coord
const xrefVerses = JSON.parse(fs.readFileSync(path.join(XREF_DIR, 'bible_verses.json'), 'utf8'));
const xrefVerseIdToCoord = new Map();
for (const xv of xrefVerses) {
  const ch = Number(xv.bsb_ch || xv.kjv_ch);
  const vs = Number(xv.bsb_vs || xv.kjv_vs);
  if (xv.book_id && ch && vs) {
    const ck = coordKey(xv.book_id, ch, vs);
    xrefVerseIdToCoord.set(xv.id, { book: xv.book_id, chapter: ch, verse: vs, key: ck });
  }
}

// 3. Load lemmas, senses, roots, lexical_formations, canonical_entities, entity_relationships
console.log('Loading lexical tables...');
const lemmas = readJsonlGzTable('lemmas');
const lemmaById = new Map(lemmas.map(l => [l.id, l]));
const lemmasByBaseStrongs = new Map();
const lemmaByKey = new Map();
for (const l of lemmas) {
  lemmaByKey.set(l.lemma_key, l);
  const bs = baseStrongs(l.base_strongs);
  if (!lemmasByBaseStrongs.has(bs)) lemmasByBaseStrongs.set(bs, []);
  lemmasByBaseStrongs.get(bs).push(l);
}

const senses = readJsonlGzTable('lexical_senses');
const sensesByLemmaId = new Map();
for (const s of senses) {
  if (!sensesByLemmaId.has(s.lemma_id)) sensesByLemmaId.set(s.lemma_id, []);
  sensesByLemmaId.get(s.lemma_id).push(s);
}

const roots = readJsonlGzTable('lexical_roots');
const rootById = new Map(roots.map(r => [r.id, r]));
const rootLinks = readJsonlGzTable('lemma_root_links');
const rootsByLemmaId = new Map();
const lemmasByRootId = new Map();
for (const rl of rootLinks) {
  if (!rootsByLemmaId.has(rl.lemma_id)) rootsByLemmaId.set(rl.lemma_id, []);
  rootsByLemmaId.get(rl.lemma_id).push(rl);
  if (!lemmasByRootId.has(rl.root_id)) lemmasByRootId.set(rl.root_id, []);
  lemmasByRootId.get(rl.root_id).push(rl.lemma_id);
}

const lexicalConnections = readJsonlGzTable('lexical_connections');
const lxxAlignments = readJsonlGzTable('hebrew_lxx_word_alignments');

// Formations & Entity Relationships pre-index
const lexicalFormations = readJsonlGzTable('lexical_formations');
const formationsByBs = new Map(); // bs -> formation[]
const componentOfFormations = new Map(); // bs -> { formationBs, formation }[]

for (const lf of lexicalFormations) {
  const l = lemmaById.get(lf.lemma_id);
  const bs = l ? baseStrongs(l.base_strongs) : (lf.source_record_id ? baseStrongs(lf.source_record_id) : '');
  if (bs) {
    if (!formationsByBs.has(bs)) formationsByBs.set(bs, []);
    formationsByBs.get(bs).push(lf);
  }
  // Check if evidence_note mentions component Strong's like H7799
  const matches = (lf.evidence_note || '').match(/\b[HG]?0*(\d{3,5})\b/g);
  if (matches) {
    for (const m of matches) {
      const compBs = baseStrongs(m);
      if (compBs && compBs !== bs) {
        if (!componentOfFormations.has(compBs)) componentOfFormations.set(compBs, []);
        componentOfFormations.get(compBs).push({ formationBs: bs, formation: lf });
      }
    }
  }
}

const canonicalEntities = readJsonlGzTable('canonical_entities');
const ceMap = new Map(canonicalEntities.map(e => [e.id, e]));
const ceByLemmaId = new Map();
for (const ce of canonicalEntities) {
  if (ce.lemma_id) {
    if (!ceByLemmaId.has(ce.lemma_id)) ceByLemmaId.set(ce.lemma_id, []);
    ceByLemmaId.get(ce.lemma_id).push(ce);
  }
}

const entityRelationships = readJsonlGzTable('entity_relationships');
const entityRelsByLemmaId = new Map();
for (const er of entityRelationships) {
  const subCe = ceMap.get(er.subject_entity_id);
  const objCe = ceMap.get(er.object_entity_id);
  if (subCe?.lemma_id) {
    if (!entityRelsByLemmaId.has(subCe.lemma_id)) entityRelsByLemmaId.set(subCe.lemma_id, []);
    entityRelsByLemmaId.get(subCe.lemma_id).push({ rel: er, otherCe: objCe, role: 'subject' });
  }
  if (objCe?.lemma_id) {
    if (!entityRelsByLemmaId.has(objCe.lemma_id)) entityRelsByLemmaId.set(objCe.lemma_id, []);
    entityRelsByLemmaId.get(objCe.lemma_id).push({ rel: er, otherCe: subCe, role: 'object' });
  }
}

// 4. Preload BCV LXX Bridge & Swete Words by canonical vid
console.log('Loading LXX Bridge & Swete words...');
const lxxBridgeRows = [];
if (fs.existsSync(LXX_BRIDGE_PATH)) {
  const lines = fs.readFileSync(LXX_BRIDGE_PATH, 'utf8').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length >= 3) {
      lxxBridgeRows.push({
        hebrew_strong: baseStrongs(parts[0]),
        greek_strong: baseStrongs(parts[1]),
        count: Number(parts[2]),
      });
    }
  }
}
const lxxBridgeByBs = new Map();
for (const row of lxxBridgeRows) {
  if (!lxxBridgeByBs.has(row.hebrew_strong)) lxxBridgeByBs.set(row.hebrew_strong, []);
  lxxBridgeByBs.get(row.hebrew_strong).push(row);
  if (!lxxBridgeByBs.has(row.greek_strong)) lxxBridgeByBs.set(row.greek_strong, []);
  lxxBridgeByBs.get(row.greek_strong).push(row);
}

const lxxWordsByVid = new Map();
const lxxTextByVid = new Map();
streamJsonlGzTable('lxx_swete_words', r => {
  const k = `${r.book_no}:${r.chapter}:${r.verse_nr}`;
  const vid = vidByLxxCoord.get(k);
  if (vid) {
    let arr = lxxWordsByVid.get(vid);
    if (!arr) {
      arr = [];
      lxxWordsByVid.set(vid, arr);
    }
    arr.push(r.normalized_word);
    let txt = lxxTextByVid.get(vid);
    lxxTextByVid.set(vid, txt ? txt + ' ' + r.word_text : r.word_text);
  }
});
console.log(`Indexed Swete words for ${lxxWordsByVid.size} canonical verses.`);

// Preload r8-v1.1 summaries (clean only, zero restricted fields)
console.log('Preloading r8-v1.1 lemma summaries...');
const r8SummariesByBs = new Map(); // bs -> { outgoing: [], incoming: [] }
if (fs.existsSync(R8_BY_LEMMA_DIR)) {
  const r8Files = fs.readdirSync(R8_BY_LEMMA_DIR).filter(f => f.endsWith('.json.gz'));
  for (const f of r8Files) {
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(R8_BY_LEMMA_DIR, f))).toString('utf8'));
    for (const [k, v] of Object.entries(data.entries || {})) {
      const bs = baseStrongs(k.replace(/^lemma:/, ''));
      if (!bs) continue;
      const cleanSums = [];
      for (const s of [...(v.outgoing_summaries || []), ...(v.incoming_summaries || [])]) {
        cleanSums.push({
          predicate: s.predicate,
          direction: s.direction,
          display_label: s.display_label || s.predicate,
          related_strongs: baseStrongs(s.related_lemma?.strongs_base || s.from_lemma?.strongs_base || ''),
          related_script: s.related_lemma?.lemma_form || s.from_lemma?.lemma_form || '',
          related_gloss: s.related_lemma?.gloss || s.from_lemma?.gloss || '',
          occurrences: s.stats?.occurrences || 1,
        });
      }
      if (cleanSums.length > 0) {
        if (!r8SummariesByBs.has(bs)) r8SummariesByBs.set(bs, []);
        r8SummariesByBs.get(bs).push(...cleanSums);
      }
    }
  }
}
console.log(`Preloaded r8-v1.1 summaries for ${r8SummariesByBs.size} base Strong's.`);

// 5. Prepare per-book token storage & scan MACULA Hebrew + Greek
const tokensByBook = new Map(); // book -> Map<verse_id, token[]>
for (let b = 1; b <= 66; b++) tokensByBook.set(b, new Map());

const lemmaVerseHits = new Map(); // baseStrongs -> { count, sampleVerses: number[], verseSet: Set<number> }
const formsByLemma = new Map(); // bs -> Map<sf, { sf, tr, gl, mc, cnt, vid }>
const numeralPairs = [];
const explicitIdentHits = [];
const ntQuoteMarkers = [];

const HEBREW_NUMERALS = new Map([
  ['H0259', { val: 1, ord: false }], ['H7223', { val: 1, ord: true }],
  ['H8147', { val: 2, ord: false }], ['H8145', { val: 2, ord: true }],
  ['H7969', { val: 3, ord: false }], ['H7992', { val: 3, ord: true }],
  ['H0702', { val: 4, ord: false }], ['H7243', { val: 4, ord: true }],
  ['H2568', { val: 5, ord: false }], ['H2549', { val: 5, ord: true }],
  ['H8337', { val: 6, ord: false }], ['H8345', { val: 6, ord: true }],
  ['H7651', { val: 7, ord: false }], ['H7637', { val: 7, ord: true }],
  ['H7657', { val: 70, ord: false }], ['H7659', { val: 7, ord: false, mult: true }],
  ['H8083', { val: 8, ord: false }],
  ['H8672', { val: 9, ord: false }],
  ['H6235', { val: 10, ord: false }], ['H6240', { val: 10, ord: false }],
  ['H6242', { val: 20, ord: false }],
  ['H7970', { val: 30, ord: false }],
  ['H0705', { val: 40, ord: false }],
  ['H2572', { val: 50, ord: false }],
  ['H3967', { val: 100, ord: false }],
  ['H0505', { val: 1000, ord: false }],
]);

const GREEK_NUMERALS = new Map([
  ['G1520', { val: 1, ord: false }], ['G4413', { val: 1, ord: true }],
  ['G1417', { val: 2, ord: false }], ['G1208', { val: 2, ord: true }],
  ['G5140', { val: 3, ord: false }], ['G5154', { val: 3, ord: true }],
  ['G5064', { val: 4, ord: false }], ['G5067', { val: 4, ord: true }],
  ['G4002', { val: 5, ord: false }], ['G1803', { val: 6, ord: false }],
  ['G2033', { val: 7, ord: false }], ['G1442', { val: 7, ord: true }],
  ['G1440', { val: 70, ord: false }],
  ['G1767', { val: 9, ord: false }],
  ['G1176', { val: 10, ord: false }],
  ['G1427', { val: 12, ord: false }], ['G1428', { val: 12, ord: true }],
  ['G1501', { val: 20, ord: false }],
  ['G5144', { val: 30, ord: false }],
  ['G5062', { val: 40, ord: false }],
  ['G4004', { val: 50, ord: false }],
  ['G1540', { val: 100, ord: false }],
  ['G5507', { val: 1000, ord: false }],
]);

const MOTIF_STRONG_MAP = new Map([
  ['lampstand', { label: 'Lampstand (Menorah / Luchnia)', strongs: ['H4501', 'G3087'] }],
  ['lamp', { label: 'Lamp / Torch (Ner / Lampas)', strongs: ['H5216', 'H3940', 'G2985', 'G3088'] }],
  ['oil', { label: 'Olive Oil & Anointing', strongs: ['H8081', 'H3323', 'H4888', 'G1637', 'G5545'] }],
  ['spirit_wind_breath', { label: 'Spirit / Wind / Breath (Ruach / Pneuma / Neshamah)', strongs: ['H7307', 'H5397', 'G4151', 'G0417', 'G4157'] }],
  ['eyes', { label: 'Eyes & Sight (Ayin / Ophthalmos)', strongs: ['H5869', 'G3788'] }],
  ['water', { label: 'Water / Sea / Flood / Rivers', strongs: ['H4325', 'H3220', 'H5104', 'H4599', 'G5204', 'G2281', 'G4215'] }],
  ['fire', { label: 'Fire & Flame (Esh / Pyr)', strongs: ['H0784', 'H3852', 'G4442', 'G5395'] }],
  ['blood', { label: 'Blood & Life (Dam / Haima)', strongs: ['H1818', 'G0129'] }],
  ['passover_lamb', { label: 'Passover & Lamb (Pesach / Seh / Arnion)', strongs: ['H6453', 'H7716', 'H3532', 'G3957', 'G0721', 'G0286'] }],
  ['door_lintel', { label: 'Door, Gate & Doorposts (Petach / Mezuzah / Mashqoph / Thyra)', strongs: ['H6607', 'H4201', 'H4947', 'H8179', 'G2374'] }],
  ['baptism_washing', { label: 'Baptism, Washing & Cleansing (Taval / Rachatz / Baptizo)', strongs: ['H2881', 'H7364', 'H2891', 'G0907', 'G0908', 'G3068'] }],
  ['creation_light_darkness', { label: 'Creation, Darkness & Light', strongs: ['H1254', 'H0216', 'H2822', 'H8414', 'H8415', 'G2936', 'G5457', 'G4655', 'G2537'] }],
  ['tree_garden', { label: 'Tree, Branch & Garden', strongs: ['H6086', 'H1588', 'H2132', 'G3586', 'G1186', 'G1636'] }],
  ['directions_winds', { label: 'Four Winds / Four Directions / Ends of Earth', strongs: ['H0702', 'H7307', 'H3671', 'G5064', 'G0417'] }],
  ['wilderness_deliverance', { label: 'Wilderness, Cloud Pillar & Deliverance', strongs: ['H4057', 'H6051', 'H5982', 'G2048', 'G3507'] }],
  ['well_marriage', { label: 'Well, Drawing Water & Betrothal/Covenant', strongs: ['H0875', 'H5869', 'H7579', 'G4077'] }],
  ['adam_human_ground', { label: 'Adam / Humanity & Ground (Adam / Adamah / Anthropos)', strongs: ['H0120', 'H0127', 'H6083', 'G0444', 'G1093'] }],
]);

const strongsToMotifs = new Map();
for (const [mId, info] of MOTIF_STRONG_MAP.entries()) {
  for (const s of info.strongs) {
    if (!strongsToMotifs.has(s)) strongsToMotifs.set(s, []);
    strongsToMotifs.get(s).push(mId);
  }
}

const verseMotifs = new Map();

function classifyNumberKind(numInfo, nounStrongs, nounGloss) {
  const g = (nounGloss || '').toLowerCase();
  if (numInfo.ord) return 'ordinal_occurrence';
  if (['H3117', 'G2250', 'H8141', 'G2094', 'H2320', 'G3376', 'H7620'].includes(nounStrongs) || /\b(day|days|year|years|month|months|week|hour|night)\b/.test(g)) {
    return 'temporal_duration';
  }
  if (['H4151', 'G4151', 'H5216', 'G2985', 'H5869', 'G3788', 'H4501', 'G3087', 'G0792', 'G4973', 'G4536', 'G5357'].includes(nounStrongs)) {
    return 'symbolic_vision_count';
  }
  return 'counted_objects';
}

function recordVerseMotif(verseId, strongsCode) {
  const mIds = strongsToMotifs.get(strongsCode);
  if (!mIds) return;
  let mMap = verseMotifs.get(verseId);
  if (!mMap) {
    mMap = new Map();
    verseMotifs.set(verseId, mMap);
  }
  for (const mId of mIds) {
    if (!mMap.has(mId)) mMap.set(mId, new Set());
    mMap.get(mId).add(strongsCode);
  }
}

function recordLemmaHit(strongsCode, verseId) {
  if (!strongsCode) return;
  let rec = lemmaVerseHits.get(strongsCode);
  if (!rec) {
    rec = { count: 0, verseSet: new Set(), sampleVerses: [] };
    lemmaVerseHits.set(strongsCode, rec);
  }
  if (!rec.verseSet.has(verseId)) {
    rec.verseSet.add(verseId);
    rec.count++;
    if (rec.sampleVerses.length < 60) rec.sampleVerses.push(verseId);
  }
}

function recordFormHit(bs, { sf, tr, gl, mc, vid }) {
  if (!bs || !sf) return;
  const cleanSf = String(sf).trim();
  if (!cleanSf) return;
  let fMap = formsByLemma.get(bs);
  if (!fMap) {
    fMap = new Map();
    formsByLemma.set(bs, fMap);
  }
  let entry = fMap.get(cleanSf);
  if (!entry) {
    entry = { sf: cleanSf, tr: tr || '', gl: gl || '', mc: mc || '', cnt: 0, vid };
    fMap.set(cleanSf, entry);
  }
  entry.cnt++;
  if (!entry.gl && gl) entry.gl = gl;
  if (!entry.tr && tr) entry.tr = tr;
  if (!entry.mc && mc) entry.mc = mc;
}

// Stream MACULA Hebrew morphemes grouped by verse
console.log('Scanning macula_hebrew_morphemes...');
const currentHebVerse = new Map(); // canonical_verse_id -> { book, ch, vs, vid, toks: [] }

streamJsonlGzTable('macula_hebrew_morphemes', r => {
  const vid = Number(r.canonical_verse_id);
  const c = coordByVerseId.get(vid);
  if (!c) return;

  if (r.chapter_mt !== c.chapter || r.verse_mt !== c.verse) {
    mtRefByVid.set(vid, formatRef(c.book, r.chapter_mt, r.verse_mt));
  }

  const bs = baseStrongs(r.strong_x ? `H${r.strong_x}` : '');
  if (bs) {
    recordLemmaHit(bs, vid);
    recordVerseMotif(vid, bs);
  }

  let vObj = currentHebVerse.get(vid);
  if (!vObj) {
    vObj = { book: c.book, ch: c.chapter, vs: c.verse, vid, toks: [] };
    currentHebVerse.set(vid, vObj);
  }
  vObj.toks.push({
    w: r.word_no,
    m: r.morph_no,
    sf: r.text_form,
    lm: r.lemma,
    s: bs || (r.strong_x ? `H${r.strong_x}` : ''),
    g: r.gloss || r.english || '',
    mc: r.morph_code || '',
    cl: r.class || '',
  });
});

// Merge Hebrew morphemes into word tokens & preserve simile and all_s
for (const vObj of currentHebVerse.values()) {
  const byWord = new Map();
  for (const t of vObj.toks) {
    if (!byWord.has(t.w)) byWord.set(t.w, []);
    byWord.get(t.w).push(t);
  }
  const wordList = [...byWord.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([wNo, parts]) => {
      const content = parts.find(p => p.cl !== 'prep' && p.cl !== 'cj' && p.cl !== 'art') || parts[parts.length - 1];
      const distinctS = [...new Set(parts.map(p => p.s).filter(Boolean))];
      const mainS = content.s || distinctS[0] || '';
      const all_s = distinctS.length > 1 ? distinctS : undefined;
      const fullSf = parts.map(p => p.sf).join('');
      const fullG = parts.map(p => p.g).filter(Boolean).join(' ');
      const hasPrefixSim = parts.some(p => p.cl === 'prep' && stripDiacriticsHebrew(p.sf).startsWith('כ'));
      const isSimWord = mainS === 'H3644' || hasPrefixSim;

      // Record forms
      if (mainS) recordFormHit(mainS, { sf: fullSf, tr: '', gl: fullG, mc: content.mc || '', vid: vObj.vid });
      for (const p of parts) {
        if (p.s && p.s !== mainS) recordFormHit(p.s, { sf: p.sf, tr: '', gl: p.g, mc: p.mc || '', vid: vObj.vid });
      }

      return {
        wn: wNo,
        sf: fullSf,
        lm: content.lm || '',
        s: mainS,
        ...(all_s ? { all_s } : {}),
        g: fullG,
        cl: content.cl || '',
        isSimWord,
      };
    });

  // Apply adjacent simile propagation
  for (let i = 0; i < wordList.length; i++) {
    const w = wordList[i];
    if (w.isSimWord) {
      w.sim = true;
      if (w.s === 'H3644') {
        if (wordList[i + 1]) wordList[i + 1].sim = true;
      }
    }
  }
  // Strip internal flag
  const cleanedWordList = wordList.map(({ isSimWord, ...rest }) => rest);
  tokensByBook.get(vObj.book).set(vObj.vid, cleanedWordList);

  // Extract Hebrew numeral+noun pairs
  for (let i = 0; i < cleanedWordList.length; i++) {
    const wt = cleanedWordList[i];
    let numInfo = HEBREW_NUMERALS.get(wt.s);
    let val = numInfo?.val;
    let ord = numInfo?.ord ?? false;
    let numS = wt.s;

    // Check for compound twelve: H8147 + H6240
    if (wt.s === 'H8147' && cleanedWordList[i + 1]?.s === 'H6240') {
      val = 12;
      numS = 'H8147+H6240';
      numInfo = { val: 12, ord: false };
    }

    if (!numInfo) continue;
    for (let j = i + 1; j <= Math.min(i + 2, cleanedWordList.length - 1); j++) {
      const nt = cleanedWordList[j];
      if (nt.cl === 'noun' && nt.s) {
        const kind = classifyNumberKind(numInfo, nt.s, nt.g);
        numeralPairs.push({
          vid: vObj.vid,
          book: vObj.book,
          ch: vObj.ch,
          vs: vObj.vs,
          val: val || numInfo.val,
          ord,
          num_s: numS,
          noun_s: nt.s,
          noun_lm: nt.lm,
          noun_g: nt.g,
          kind,
        });
        break;
      }
    }
  }
}
currentHebVerse.clear();

// Stream MACULA Greek tokens (Nestle1904 track only)
console.log('Scanning macula_greek_tokens...');
const currentGrcVerse = new Map();

streamJsonlGzTable('macula_greek_tokens', r => {
  if (r.edition_key && r.edition_key !== 'macula-greek-nestle1904') return;
  const vid = Number(r.canonical_verse_id);
  const c = coordByVerseId.get(vid);
  if (!c) return;

  const bs = baseStrongs(r.strongs ? `G${r.strongs}` : '');
  if (bs) {
    recordLemmaHit(bs, vid);
    recordVerseMotif(vid, bs);
  }

  let vObj = currentGrcVerse.get(vid);
  if (!vObj) {
    vObj = { book: c.book, ch: c.chapter, vs: c.verse, vid, toks: [] };
    currentGrcVerse.set(vid, vObj);
  }
  vObj.toks.push({
    wn: r.word_no,
    id: r.xml_id,
    sf: r.text_form,
    lm: r.lemma,
    s: bs,
    g: r.gloss || r.english || '',
    cl: r.part_of_speech || '',
    role: r.role || '',
    ref: r.referent || '',
  });
});

for (const vObj of currentGrcVerse.values()) {
  const sorted = vObj.toks.sort((a, b) => a.wn - b.wn);
  const wordList = sorted.map((t, idx) => {
    const isSim = t.s === 'G5613';
    if (t.s) recordFormHit(t.s, { sf: t.sf, tr: '', gl: t.g, mc: t.cl, vid: vObj.vid });
    return {
      wn: t.wn,
      sf: t.sf,
      lm: t.lm,
      s: t.s,
      g: t.g,
      cl: t.cl,
      role: t.role || undefined,
      isSim,
    };
  });

  // Apply adjacent simile propagation for Greek (ὡς G5613)
  for (let i = 0; i < wordList.length; i++) {
    if (wordList[i].isSim) {
      wordList[i].sim = true;
      if (wordList[i + 1]) wordList[i + 1].sim = true;
    }
  }
  const cleanedWordList = wordList.map(({ isSim, ...rest }) => rest);
  tokensByBook.get(vObj.book).set(vObj.vid, cleanedWordList);

  // Extract Greek numeral+noun pairs
  for (let i = 0; i < sorted.length; i++) {
    const wt = sorted[i];
    const numInfo = GREEK_NUMERALS.get(wt.s);
    if (!numInfo) continue;
    for (const offset of [1, 2, -1, 3]) {
      const j = i + offset;
      if (j < 0 || j >= sorted.length) continue;
      const nt = sorted[j];
      if ((nt.cl === 'noun' || nt.cl === 'subst') && nt.s && !GREEK_NUMERALS.has(nt.s)) {
        const kind = classifyNumberKind(numInfo, nt.s, nt.g);
        numeralPairs.push({
          vid: vObj.vid,
          book: vObj.book,
          ch: vObj.ch,
          vs: vObj.vs,
          val: numInfo.val,
          ord: numInfo.ord,
          num_s: wt.s,
          noun_s: nt.s,
          noun_lm: nt.lm,
          noun_g: nt.g,
          kind,
        });
        break;
      }
    }
  }

  // Extract Greek copula + relative referent explicit identifications
  for (let i = 0; i < sorted.length - 1; i++) {
    const t = sorted[i];
    if (t.cl === 'pron' && t.ref && sorted[i + 1]?.s === 'G1510' && sorted[i + 1]?.role === 'vc') {
      const targetTok = sorted.find(x => x.id === t.ref);
      const predNoun = sorted.slice(i + 2, i + 7).find(x => x.cl === 'noun' && x.s !== 'G2316');
      if (targetTok && predNoun && targetTok.s && predNoun.s) {
        explicitIdentHits.push({
          vid: vObj.vid,
          ref: formatRef(vObj.book, vObj.ch, vObj.vs),
          subject_s: targetTok.s,
          subject_lemma: targetTok.lm,
          predicate_s: predNoun.s,
          predicate_lemma: predNoun.lm,
          pattern: 'greek_relative_copula_referent',
        });
      }
    }
    if (t.s === 'G5179' || t.s === 'G0499' || t.s === 'G0238' || t.s === 'G3957') {
      ntQuoteMarkers.push({
        vid: vObj.vid,
        ref: formatRef(vObj.book, vObj.ch, vObj.vs),
        marker_s: t.s,
        marker_lemma: t.lm,
      });
    }
  }
}
currentGrcVerse.clear();

// 6. Backfill missing verses and STEP word_form_lemmas scan
console.log('Backfilling missing verses & scanning word_form_lemmas...');
const wordsById = new Map();
streamJsonlGzTable('words_immutable', w => {
  wordsById.set(w.id, w);
  const vid = wordToVid.get(w.id);
  if (vid) {
    const bs = baseStrongs(w.strongs_nr);
    if (bs) {
      recordLemmaHit(bs, vid);
      recordVerseMotif(vid, bs);
      recordFormHit(bs, { sf: w.original_word, tr: w.transliteration, gl: w.english_translations?.[0], mc: w.grammar_code, vid });
    }
  }
});

const wflByWordId = new Map();
streamJsonlGzTable('word_form_lemmas', r => {
  let list = wflByWordId.get(r.word_id);
  if (!list) {
    list = [];
    wflByWordId.set(r.word_id, list);
  }
  list.push(r);

  const vid = wordToVid.get(r.word_id);
  if (vid) {
    const l = lemmaById.get(r.lemma_id);
    const bs = baseStrongs(r.dstrongs_tag) || (l ? baseStrongs(l.base_strongs) : '');
    if (bs) {
      recordLemmaHit(bs, vid);
      recordVerseMotif(vid, bs);
      recordFormHit(bs, { sf: r.morpheme_surface, tr: '', gl: r.morpheme_gloss, mc: r.grammar_code, vid });
    }
  }
});

let backfilledCount = 0;
for (const v of canonVerses) {
  const bMap = tokensByBook.get(v.book);
  if (!bMap.has(v.id)) {
    backfilledCount++;
    const wordList = (v.word_ids || []).map((wid, idx) => {
      const w = wordsById.get(wid);
      const wfls = wflByWordId.get(wid) || [];
      const content = wfls.find(p => p.morpheme_role === 'stem') || wfls[0];
      const lem = content ? lemmaById.get(content.lemma_id) : null;
      const s = lem ? baseStrongs(lem.base_strongs) : baseStrongs(w?.strongs_nr);
      const all_s_set = new Set();
      for (const p of wfls) {
        const pLem = lemmaById.get(p.lemma_id);
        const pBs = pLem ? baseStrongs(pLem.base_strongs) : baseStrongs(p.dstrongs_tag);
        if (pBs) all_s_set.add(pBs);
      }
      if (s) all_s_set.add(s);
      const all_s = all_s_set.size > 1 ? [...all_s_set] : undefined;
      const sf = w?.original_word || content?.morpheme_surface || '';
      const lm = lem?.lemma_script || w?.original_word || '';
      const glosses = [...new Set(wfls.map(p => p.morpheme_gloss).filter(Boolean))];
      const g = glosses.join(' ') || w?.english_translations?.[0] || '';
      const cl = content?.grammar_code || w?.grammar_code || '';
      const hasSim = wfls.some(p => p.morpheme_role === 'prefix_preposition' && stripDiacriticsHebrew(p.morpheme_surface).startsWith('כ')) || s === 'H3644' || s === 'G5613';

      if (s) {
        recordLemmaHit(s, v.id);
        recordFormHit(s, { sf, tr: w?.transliteration || '', gl: g, mc: cl, vid: v.id });
      }
      for (const bs of all_s_set) {
        if (bs !== s) recordLemmaHit(bs, v.id);
      }

      return {
        wn: idx + 1,
        sf,
        lm,
        s,
        ...(all_s ? { all_s } : {}),
        g,
        cl,
        ...(hasSim ? { sim: true } : {}),
      };
    });
    bMap.set(v.id, wordList);
  }
}
console.log(`Backfilled ${backfilledCount} verses missing from MACULA tokens.`);

function resolveCoord(book, ch, vs) {
  const vid = verseIdByCoord.get(coordKey(book, ch, vs));
  if (!vid) return null;
  const c = coordByVerseId.get(vid);
  return {
    verse_id: vid,
    ref: c.ref,
    book: c.book,
    chapter: c.chapter,
    verse: c.verse,
    testament: c.book <= 39 ? 'OT' : 'NT',
  };
}

function getOriginalWords(strongsList) {
  const out = [];
  const seen = new Set();
  for (const s of strongsList) {
    const bs = baseStrongs(s);
    if (!bs || seen.has(bs)) continue;
    seen.add(bs);
    const cand = lemmasByBaseStrongs.get(bs)?.[0];
    if (!cand) continue;
    const sense = sensesByLemmaId.get(cand.id)?.[0];
    out.push({
      lemma_key: cand.lemma_key,
      strongs: bs,
      language: cand.language === 'grc' ? 'grc' : 'hbo',
      lemma_script: cand.lemma_script,
      transliteration: cand.transliteration,
      gloss: sense?.short_gloss || cand.lemma_stripped,
    });
  }
  return out;
}

// 7. Write per-book evidence-passages (66 files)
console.log('Writing per-book evidence-passages (66 files)...');
const manifestFiles = [];
for (let b = 1; b <= 66; b++) {
  const bookMeta = bookById.get(b);
  const vMap = tokensByBook.get(b);
  const versesOut = {};
  for (const [vid, toks] of vMap.entries()) {
    const c = coordByVerseId.get(vid);
    let eng = c ? (englishByCoord.get(c.key) || null) : null;
    if (b === 19 && c?.verse === 0 && !eng) {
      eng = `[Hebrew superscription gloss] ${toks.map(w => w.g).filter(Boolean).join(' ')}`.trim();
    }
    const mtRef = mtRefByVid.get(vid);
    versesOut[String(vid)] = {
      book: b,
      chapter: c?.chapter ?? 0,
      verse: c?.verse ?? 0,
      ref: c?.ref ?? '',
      ...(mtRef ? { mt_ref: mtRef } : {}),
      en: eng,
      toks,
    };
  }
  const pad = String(b).padStart(2, '0');
  manifestFiles.push(writeGzJson(`r10/evidence-passages/book-${pad}.json.gz`, {
    schema_version: 1,
    book: b,
    name: bookMeta?.name ?? `Book ${b}`,
    verses: versesOut,
  }));
}

// 8. Convert ALL 63,663 CrossReferences.org links -> per-book bidirectional xref files (66 files, NO s21!)
console.log('Building full 66-book CrossReferences index (excluding s21)...');
const rawXrefs = JSON.parse(fs.readFileSync(path.join(XREF_DIR, 'cross_references.json'), 'utf8'));
const xrefsByBook = new Map();
for (let b = 1; b <= 66; b++) xrefsByBook.set(b, {});
let totalXrefPairs = 0;

for (const row of rawXrefs) {
  const fromC = xrefVerseIdToCoord.get(row.verse_id);
  if (!fromC) continue;
  const fromVid = verseIdByCoord.get(fromC.key);
  if (!fromVid) continue;
  const phrase = String(row.bsb || row.kjv || '').trim();
  const targets = [];
  for (const refGroup of row.refs || []) {
    if (!Array.isArray(refGroup) || refGroup.length === 0) continue;
    const first = xrefVerseIdToCoord.get(refGroup[0]);
    if (!first) continue;
    const toVid = verseIdByCoord.get(first.key);
    if (!toVid) continue;
    const last = xrefVerseIdToCoord.get(refGroup[refGroup.length - 1]);
    targets.push({
      to_vid: toVid,
      to_ref: last && last.verse !== first.verse && last.book === first.book && last.chapter === first.chapter
        ? `${formatRef(first.book, first.chapter, first.verse)}-${last.verse}`
        : formatRef(first.book, first.chapter, first.verse),
      to_b: first.book,
      to_c: first.chapter,
      to_v: first.verse,
      to_end_v: last && last.book === first.book && last.chapter === first.chapter ? last.verse : first.verse,
    });
    totalXrefPairs++;

    // Add reverse entry
    const revMap = xrefsByBook.get(first.book);
    const k = String(toVid);
    if (!revMap[k]) revMap[k] = { out: [], in: [] };
    if (revMap[k].in.length < 40) {
      revMap[k].in.push({
        from_vid: fromVid,
        from_ref: formatRef(fromC.book, fromC.chapter, fromC.verse),
        from_b: fromC.book,
        from_c: fromC.chapter,
        from_v: fromC.verse,
        phrase,
      });
    }
  }
  if (targets.length > 0) {
    const outMap = xrefsByBook.get(fromC.book);
    const k = String(fromVid);
    if (!outMap[k]) outMap[k] = { out: [], in: [] };
    outMap[k].out.push({ phrase, targets });
  }
}

for (let b = 1; b <= 66; b++) {
  const pad = String(b).padStart(2, '0');
  manifestFiles.push(writeGzJson(`r10/xrefs/book-${pad}.json.gz`, {
    schema_version: 1,
    book: b,
    by_verse: xrefsByBook.get(b),
  }));
}
console.log(`Indexed ${totalXrefPairs} bidirectional cross-reference links (s21 stripped).`);

// 9. Write numbers-index.json.gz
const byNumValue = new Map();
for (const np of numeralPairs) {
  const key = String(np.val);
  if (!byNumValue.has(key)) byNumValue.set(key, new Map());
  const nMap = byNumValue.get(key);
  const nk = `${np.noun_s}:${np.kind}`;
  if (!nMap.has(nk)) {
    nMap.set(nk, {
      noun_s: np.noun_s,
      noun_lm: np.noun_lm,
      noun_g: np.noun_g,
      kind: np.kind,
      count: 0,
      samples: [],
    });
  }
  const entry = nMap.get(nk);
  entry.count++;
  if (entry.samples.length < 15) {
    entry.samples.push({
      vid: np.vid,
      book: np.book,
      ch: np.ch,
      vs: np.vs,
      ref: formatRef(np.book, np.ch, np.vs),
      ord: np.ord,
    });
  }
}

const numbersIndexObj = {};
for (const [valStr, nMap] of byNumValue.entries()) {
  const groups = [...nMap.values()].sort((a, b) => {
    const scoreKind = k => (k === 'symbolic_vision_count' ? 0 : k === 'counted_objects' ? 1 : k === 'ordinal_occurrence' ? 2 : 3);
    return scoreKind(a.kind) - scoreKind(b.kind) || b.count - a.count;
  });
  numbersIndexObj[valStr] = {
    value: Number(valStr),
    total_pairs: groups.reduce((acc, g) => acc + g.count, 0),
    groups: groups.slice(0, 60),
  };
}
manifestFiles.push(writeGzJson('r10/numbers-index.json.gz', {
  schema_version: 1,
  source: 'MACULA Hebrew & Greek syntactic numeral-noun pairs (66 books)',
  license: 'CC BY 4.0',
  by_value: numbersIndexObj,
}));

// 10. Build explicit-and-typology.json.gz
const helperPassages = (...coords) => coords.map(([b, c, v, ev]) => {
  const p = resolveCoord(b, c, v);
  if (!p) throw new Error(`Failed to resolve passage ${b}:${c}:${v}`);
  const snippet = englishByCoord.get(coordKey(b, c, v)) || '';
  return ev ? { ...p, end_verse: ev, snippet } : { ...p, snippet };
});

const curatedEvidenceRecords = [
  // §2A Explicit Biblical Identifications
  {
    evidence_id: 'r10:ident:rev4_5_lamps_spirits',
    predicate: 'explicit_identification',
    evidence_tier: 1,
    epistemic_class: 'direct_textual_evidence',
    title: 'Revelation 4:5 explicitly identifies seven burning lamps with the seven Spirits of God',
    summary: 'John sees seven lamps of fire (ἑπτὰ λαμπάδες πυρός) burning before the throne and explicitly states "which are the seven Spirits of God" (αἵ εἰσιν τὰ ἑπτὰ πνεύματα τοῦ θεοῦ), using a relative-copula identification clause.',
    source_node_id: 'motif:lamp',
    target_node_id: 'motif:spirit_wind_breath',
    passages: helperPassages([66, 4, 5]),
    original_words: getOriginalWords(['G2033', 'G2985', 'G4442', 'G4151', 'G2316']),
    matched_terms: ['seven', 'lamps', 'lamp', 'fire', 'spirit', 'spirits', 'pneuma', 'throne', 'revelation'],
    number_classification: { number_value: 7, counted_entity: 'lamps / Spirits of God', kind: 'symbolic_vision_count', coincidence_risk: 'low', note: 'Explicit vision symbol equation inside the same clause (ἑπτὰ λαμπάδες = ἑπτὰ πνεύματα).' },
    limitations: ['Explicit identification holds within John’s throne-room vision (Rev 4:5); distinction from lampstands in Rev 1:20 must be preserved.'],
    provenance: { source_dataset: 'MACULA Greek (Nestle1904) + CrossReferences.org', source_record_ids: ['n66004005012-n66004005025'], license: 'CC BY 4.0', derivation_method: 'greek_relative_copula_referent_extraction' },
  },
  {
    evidence_id: 'r10:ident:rev5_6_eyes_spirits',
    predicate: 'explicit_identification',
    evidence_tier: 1,
    epistemic_class: 'direct_textual_evidence',
    title: 'Revelation 5:6 explicitly identifies the Lamb’s seven eyes with the seven Spirits of God',
    summary: 'The Lamb has seven horns and seven eyes (ὀφθαλμοὺς ἑπτά), "which are the seven Spirits of God sent out into all the earth" (οἵ εἰσιν τὰ [ἑπτὰ] πνεύματα τοῦ θεοῦ ἀπεσταλμένοι εἰς πᾶσαν τὴν γῆν), echoing Zechariah 4:10.',
    source_node_id: 'motif:eyes',
    target_node_id: 'motif:spirit_wind_breath',
    passages: helperPassages([66, 5, 6], [38, 4, 10]),
    original_words: getOriginalWords(['G2033', 'G3788', 'G4151', 'H7651', 'H5869']),
    matched_terms: ['seven', 'eyes', 'eye', 'spirit', 'spirits', 'lamb', 'earth', 'zechariah', 'revelation'],
    number_classification: { number_value: 7, counted_entity: 'eyes / Spirits of God', kind: 'symbolic_vision_count', coincidence_risk: 'low', note: 'Seven eyes explicitly identified with the seven Spirits of God and cross-referenced to Zech 4:10.' },
    limitations: ['Syntactic identification is explicit in Rev 5:6; its dependence on Zech 4:10 is literary/intertextual (LXX/MT cross-reference), not an explicit citation formula.'],
    provenance: { source_dataset: 'MACULA Greek + CrossReferences.org', source_record_ids: ['n66005006020-n66005006035', 'xref:rev5:6->zech4:10'], license: 'CC BY 4.0', derivation_method: 'greek_relative_copula_referent_and_xref' },
  },
  {
    evidence_id: 'r10:ident:rev1_20_lampstands_churches_control',
    predicate: 'explicit_identification',
    evidence_tier: 1,
    epistemic_class: 'direct_textual_evidence',
    title: 'Control contrast: Revelation 1:20 identifies the seven golden lampstands (λυχνίαι) as the seven churches, NOT the Spirits',
    summary: 'In Revelation 1:12–20, seven golden lampstands (λυχνία G3087) are explicitly identified as the seven churches (αἱ ἑπτὰ λυχνίαι ἑπτὰ ἐκκλησίαι εἰσίν), whereas in Revelation 4:5 seven burning lamps (λαμπάς G2985) are identified as the seven Spirits of God.',
    source_node_id: 'motif:lampstand',
    target_node_id: 'concept:churches',
    passages: helperPassages([66, 1, 20], [66, 1, 12]),
    original_words: getOriginalWords(['G2033', 'G3087', 'G1577']),
    matched_terms: ['seven', 'lampstand', 'lampstands', 'menorah', 'luchnia', 'church', 'churches', 'revelation'],
    number_classification: { number_value: 7, counted_entity: 'lampstands -> churches', kind: 'symbolic_vision_count', coincidence_risk: 'low', note: 'Negative control showing distinct referents for similar sevenfold light imagery within Revelation.' },
    limitations: ['Prevents conflating λυχνία (lampstand = churches in Rev 1:20) with λαμπάς (lamps = Spirits in Rev 4:5).'],
    provenance: { source_dataset: 'MACULA Greek + Reviewed Annotation lampstand-spirits', source_record_ids: ['n66001020025-n66001020030'], license: 'CC BY 4.0', derivation_method: 'greek_copula_extraction' },
  },
  {
    evidence_id: 'r10:corresp:zech4_menorah_oil_spirit_eyes',
    predicate: 'literary_correspondence',
    evidence_tier: 4,
    epistemic_class: 'verified_cross_reference',
    title: 'Zechariah 4:2–14 unites golden lampstand (menorah), seven lamps, olive oil, the LORD’s Spirit (ruach), and seven eyes',
    summary: 'Zechariah sees a solid gold lampstand (מְנוֹרָה H4501) with seven lamps (נֵר H5216) fed by two olive trees/oil (שֶׁמֶן/יִצְהָר H8081/H3323); v.6 declares "not by might, nor by power, but by my Spirit (רוּחִי H7307)"; v.10 identifies the seven ("שִׁבְעָה־אֵלֶּה") with the eyes of the LORD (עֵינֵי יְהוָה H5869) ranging through the whole earth.',
    source_node_id: 'motif:lampstand',
    target_node_id: 'motif:eyes',
    passages: helperPassages([38, 4, 2], [38, 4, 6], [38, 4, 10], [38, 4, 12]),
    original_words: getOriginalWords(['H4501', 'H7651', 'H5216', 'H8081', 'H7307', 'H5869']),
    matched_terms: ['zechariah', 'menorah', 'lampstand', 'seven', 'lamps', 'lamp', 'oil', 'olive', 'ruach', 'spirit', 'eyes', 'eye'],
    number_classification: { number_value: 7, counted_entity: 'lamps / eyes of YHWH', kind: 'symbolic_vision_count', coincidence_risk: 'low', note: 'Zech 4 co-locates seven lamps (v.2), Spirit (v.6), oil (v.12), and "these seven are the eyes of YHWH" (v.10).' },
    limitations: ['Zech 4:2–10 links lampstand, oil, Spirit, and seven eyes within the vision; its equation with Rev 4:5 and Rev 5:6 rests on cross-references and shared septuagint/vision vocabulary rather than an explicit quotation formula.'],
    provenance: { source_dataset: 'MACULA Hebrew + CrossReferences.org', source_record_ids: ['zech4:2-14', 'xref:zech4:2->rev4:5', 'xref:zech4:10->rev5:6'], license: 'CC BY 4.0', derivation_method: 'passage_cluster_and_xref_alignment' },
  },
  {
    evidence_id: 'r10:ident:john7_38_39_water_spirit',
    predicate: 'authorial_interpretation',
    evidence_tier: 2,
    epistemic_class: 'authorial_typology_or_quote',
    title: 'John 7:38–39 explicitly interprets "rivers of living water" (ὕδατος ζῶντος) as the Spirit (πνεῦμα)',
    summary: 'Jesus promises "rivers of living water will flow from within him," and the narrator explicitly explains: "But he said this about the Spirit (τοῦτο δὲ εἶπεν περὶ τοῦ πνεύματος), whom those believing in him were to receive."',
    source_node_id: 'motif:water',
    target_node_id: 'motif:spirit_wind_breath',
    passages: helperPassages([43, 7, 38], [43, 7, 39]),
    original_words: getOriginalWords(['G4215', 'G5204', 'G2198', 'G4151']),
    matched_terms: ['water', 'waters', 'living', 'river', 'rivers', 'spirit', 'pneuma', 'ruach', 'john'],
    limitations: ['Authorial explanatory gloss is explicit in John 7:39; connections back to specific OT water passages (Isa 44:3, Ezek 47:1, Zech 14:8) are intertextual correspondences.'],
    provenance: { source_dataset: 'MACULA Greek (Nestle1904)', source_record_ids: ['n43007038016-n43007039010'], license: 'CC BY 4.0', derivation_method: 'greek_authorial_meta_comment_extraction' },
  },
  {
    evidence_id: 'r10:lex:john3_8_wind_spirit_pneuma',
    predicate: 'verified_lexical_grammatical',
    evidence_tier: 3,
    epistemic_class: 'documented_lexical_relationship',
    title: 'John 3:5–8 uses πνεῦμα (G4151) for both "wind" and "Spirit" alongside "water" (ὕδωρ G5204)',
    summary: 'Following born of "water and the Spirit" (John 3:5), John 3:8 intentionally plays on the semantic range of Greek πνεῦμα (matching Hebrew רוּחַ H7307): "The wind blows (τὸ πνεῦμα ὅπου θέλει πνεῖ) ... so is everyone born of the Spirit (ἐκ τοῦ πνεύματος)."',
    source_node_id: 'lemma:G4151',
    target_node_id: 'motif:water',
    passages: helperPassages([43, 3, 5], [43, 3, 8]),
    original_words: getOriginalWords(['G4151', 'G4154', 'G5204', 'H7307']),
    matched_terms: ['wind', 'spirit', 'breath', 'water', 'ruach', 'pneuma', 'john'],
    linguistic_notes: ['Both Hebrew רוּחַ (H7307) and Greek πνεῦμα (G4151) span wind, breath, and spirit/Spirit; English translations must split one original-language word into two English words in John 3:8.'],
    limitations: ['Textual wordplay demonstrates shared semantic domain of wind/spirit in G4151/H7307, while context determines each occurrence’s primary sense.'],
    provenance: { source_dataset: 'MACULA Greek + STEPBible TBESG/TBESH', source_record_ids: ['n43003005001-n43003008025'], license: 'CC BY 4.0', derivation_method: 'lexical_polysemy_in_single_pericope' },
  },
  {
    evidence_id: 'r10:lex:ezek37_ruach_winds_directions_breath_spirit',
    predicate: 'verified_lexical_grammatical',
    evidence_tier: 3,
    epistemic_class: 'documented_lexical_relationship',
    title: 'Ezekiel 37:9,14 demonstrates רוּחַ (ruach H7307) across four directions/winds, breath, and God’s Spirit',
    summary: 'In Ezekiel 37:9, God commands prophecy to "the breath/wind" (הָרוּחַ) to "come from the four winds/directions" (מֵאַרְבַּע רוּחוֹת), reviving the slain; v.14 then identifies "my Spirit" (רוּחִי) as life-giving agent. Four winds/quarters is a recurrent biblical idiom for compass directions (Jer 49:36; Zech 2:6; Matt 24:31).',
    source_node_id: 'lemma:H7307',
    target_node_id: 'motif:directions_winds',
    passages: helperPassages([26, 37, 9], [26, 37, 14], [38, 2, 6]),
    original_words: getOriginalWords(['H7307', 'H0702', 'H5301', 'G0417']),
    matched_terms: ['ruach', 'spirit', 'wind', 'winds', 'breath', 'four', 'directions', 'direction', 'corners', 'ezekiel'],
    number_classification: { number_value: 4, counted_entity: 'winds / compass directions (אַרְבַּע רוּחוֹת)', kind: 'counted_objects', coincidence_risk: 'low', note: 'Idiomatic expression for the four cardinal directions using the plural of רוּחַ (wind/spirit).' },
    linguistic_notes: ['Lexical sense range of H7307 רוּחַ: (1) moving air / wind, (2) breath of life, (3) spirit / Spirit of God, (4) side / quarter / compass direction (plural רוּחוֹת in Ezek 42:16-20; Jer 49:36; Zech 2:6; cf. Greek ἄνεμοι in Matt 24:31, Rev 7:1).'],
    limitations: ['Presence of the plural "winds/directions" sense in Ezek 37:9 or Ezek 42 does not mean "directions" is synonymous with the Holy Spirit in unrelated verses.'],
    provenance: { source_dataset: 'MACULA Hebrew + STEPBible TBESH', source_record_ids: ['H7307:ezek37:9', 'H7307:ezek37:14'], license: 'CC BY 4.0', derivation_method: 'lexical_sense_and_collocation_extraction' },
  },
  {
    evidence_id: 'r10:corresp:gen1_2_gen8_1_ruach_water_wind',
    predicate: 'literary_correspondence',
    evidence_tier: 4,
    epistemic_class: 'verified_cross_reference',
    title: 'Genesis 1:2 and Genesis 8:1 co-locate רוּחַ (Spirit / wind) over הַמָּיִם (waters) in creation and post-flood renewal',
    summary: 'In Genesis 1:2, the Spirit/wind of God (רוּחַ אֱלֹהִים) hovers over the face of the waters (פְּנֵי הַמָּיִם). In Genesis 8:1, God causes a wind (רוּחַ) to pass over the earth so the waters (הַמָּיִם) subside—using the same H7307 + H4325 vocabulary at the dawn of creation and post-Flood renewal.',
    source_node_id: 'motif:spirit_wind_breath',
    target_node_id: 'motif:water',
    passages: helperPassages([1, 1, 2], [1, 8, 1], [19, 104, 30]),
    original_words: getOriginalWords(['H7307', 'H4325', 'H0430', 'H7363']),
    matched_terms: ['genesis', 'creation', 'ruach', 'spirit', 'wind', 'water', 'waters', 'flood', 'hovering'],
    linguistic_notes: ['רוּחַ אֱלֹהִים in Gen 1:2 ("Spirit of God" / "mighty wind") and רוּחַ in Gen 8:1 ("wind") share H7307 + H4325 (waters) across creation and de-creation/re-creation framing.'],
    limitations: ['Gen 1:2 → Gen 8:1 is a lexical/literary correspondence within Genesis, whereas Gen 1:2 ↔ Rev 4:5 (seven Spirits) is an indirect thematic/numerical parallel via Zech 4 and Isa 11:2 rather than an explicit quotation.'],
    provenance: { source_dataset: 'MACULA Hebrew + CrossReferences.org', source_record_ids: ['gen1:2->gen8:1', 'gen1:2->ps104:30'], license: 'CC BY 4.0', derivation_method: 'shared_lemma_pair_and_xref' },
  },
  {
    evidence_id: 'r10:motif:exod25_to_zech4_menorah_oil',
    predicate: 'literary_correspondence',
    evidence_tier: 4,
    epistemic_class: 'verified_cross_reference',
    title: 'Exodus 25:31–37 / 27:20–21 Tabernacle golden lampstand (menorah), seven lamps, and pure olive oil forms the background of Zechariah 4',
    summary: 'Exodus 25 commands a pure gold lampstand (מְנֹרַת זָהָב טָהוֹר) with seven lamps (שִׁבְעָה נֵרֹתֶיהָ Exod 25:37), supplied with beaten olive oil (שֶׁמֶן זַיִת Exod 27:20). Zechariah 4:2 reuses מְנוֹרַת זָהָב and שִׁבְעָה נֵרֹתֶיהָ directly, and LXX translates מְנוֹרָה with λυχνία (G3087).',
    source_node_id: 'motif:lampstand',
    target_node_id: 'motif:oil',
    passages: helperPassages([2, 25, 31], [2, 25, 37], [2, 27, 20], [38, 4, 2]),
    original_words: getOriginalWords(['H4501', 'H7651', 'H5216', 'H8081', 'G3087']),
    matched_terms: ['menorah', 'lampstand', 'seven', 'lamps', 'lamp', 'oil', 'exodus', 'zechariah', 'luchnia'],
    number_classification: { number_value: 7, counted_entity: 'lamps on the menorah (נֵרֹתֶיהָ)', kind: 'counted_objects', coincidence_risk: 'low', note: 'Direct verbal echo: Exod 25:37 וְעָשִׂיתָ אֶת־נֵרֹתֶיהָ שִׁבְעָה → Zech 4:2 וְשִׁבְעָה נֵרֹתֶיהָ עָלֶיהָ.' },
    limitations: ['Exod 25 gives physical tabernacle specifications; Zech 4 adapts its imagery prophetically for Zerubbabel and the Spirit’s empowering.', 'Distinguish Exod 25:37/Zech 4:2 (7 lamps נֵרוֹת on 1 lampstand) from Zech 4 (lampstand+Spirit) and Rev 1:12/20 (7 lampstands = churches) vs Rev 4:5 (7 lamps = Spirits).'],
    provenance: { source_dataset: 'MACULA Hebrew + HEBREW_LXX_WORD_ALIGNMENTS + CrossReferences.org', source_record_ids: ['exod25:31-37', 'zech4:2'], license: 'CC BY 4.0', derivation_method: 'exact_phrase_echo_and_lxx_bridge' },
  },

  // §2B Explicit Biblical Comparison / Typology: Red Sea & Baptism
  {
    evidence_id: 'r10:typo:1cor10_1_2_red_sea_baptism',
    predicate: 'typological_interpretation',
    evidence_tier: 1,
    epistemic_class: 'authorial_typology_or_quote',
    title: '1 Corinthians 10:1–2 explicitly compares Israel’s Red Sea & cloud crossing (Exodus 14) to baptism ("baptized into Moses in the cloud and in the sea")',
    summary: 'Paul writes that Israel’s fathers were "under the cloud, and all passed through the sea (διὰ τῆς θαλάσσης διῆλθον), and were all baptized into Moses in the cloud and in the sea (εἰς τὸν Μωϋσῆν ἐβαπτίσαντο ἐν τῇ νεφέλῃ καὶ ἐν τῇ θαλάσσῃ)," calling these events examples/types (τύποι G5179 in 1 Cor 10:6). This separates the historical Exodus 13–14 event from Paul’s later NT typological interpretation.',
    source_node_id: 'event:red_sea_crossing',
    target_node_id: 'motif:baptism_washing',
    passages: helperPassages([46, 10, 1], [46, 10, 2], [46, 10, 6], [2, 14, 21], [2, 14, 22], [2, 13, 21]),
    original_words: getOriginalWords(['G0907', 'G2281', 'G3507', 'G1330', 'G5179', 'H3220', 'H5488', 'H6051']),
    matched_terms: ['red', 'sea', 'crossing', 'exodus', 'baptism', 'baptized', 'cloud', 'moses', '1 corinthians', 'type', 'typology'],
    linguistic_notes: [
      'Greek 1 Cor 10:2: ἐβαπτίσαντο (G0907 baptizō) + ἐν τῇ νεφέλῃ (G3507 cloud) + ἐν τῇ θαλάσσῃ (G2281 sea), followed by τύποι (G5179 types/examples) in v.6.',
      'Hebrew Exodus 14:21–22: יָם (H3220 sea) / יַם־סוּף (Sea of Reeds); Israel passed through (בָּאוּ בְתוֹךְ הַיָּם) on dry ground while Exod 13:21–22 records the pillar of cloud (עַמּוּד עָנָן).',
    ],
    limitations: [
      'Explicit NT authorial typology by Paul (1 Cor 10:1–6); Exodus 14 itself narrates a historical deliverance without using ritual washing/baptism terminology.',
      'Do not infer that every narrative detail of Exodus 14 is an allegory or fixed symbol of Christian baptism beyond Paul’s explicit comparison (cloud, sea passage, deliverance under Moses).',
    ],
    provenance: { source_dataset: 'MACULA Greek + MACULA Hebrew + CrossReferences.org', source_record_ids: ['n46010001-n46010006', 'xref:1cor10:1->exod13:21', 'xref:1cor10:1->exod14:22'], license: 'CC BY 4.0', derivation_method: 'explicit_nt_typology_marker_and_xref' },
  },
  {
    evidence_id: 'r10:typo:1pet3_20_21_flood_baptism_control',
    predicate: 'typological_interpretation',
    evidence_tier: 2,
    epistemic_class: 'authorial_typology_or_quote',
    title: 'Parallel NT water-deliverance typology: 1 Peter 3:20–21 links the Noahic Flood waters as an antitype (ἀντίτυπον) to baptism',
    summary: 'Alongside Paul’s Red Sea typology in 1 Cor 10:1–2, 1 Peter 3:20–21 explicitly calls baptism an antitype (ἀντίτυπον G0499) corresponding to being brought safely through water (διεσώθησαν διʼ ὕδατος) in the ark.',
    source_node_id: 'event:flood',
    target_node_id: 'motif:baptism_washing',
    passages: helperPassages([60, 3, 20], [60, 3, 21]),
    original_words: getOriginalWords(['G0499', 'G0908', 'G5204']),
    matched_terms: ['baptism', 'water', 'flood', 'noah', 'antitype', 'type', 'salvation', 'peter'],
    limitations: ['Separate explicit NT water-salvation typology; illustrates that NT authors explicitly specify their intended OT water comparisons rather than treating all water texts identically.'],
    provenance: { source_dataset: 'MACULA Greek (Nestle1904)', source_record_ids: ['n60003020-n60003021'], license: 'CC BY 4.0', derivation_method: 'greek_antitypon_marker_extraction' },
  },

  // Passover, Door, Blood, Jesus
  {
    evidence_id: 'r10:typo:exod12_passover_blood_christ_1cor5_7',
    predicate: 'typological_interpretation',
    evidence_tier: 1,
    epistemic_class: 'authorial_typology_or_quote',
    title: 'Explicit NT Passover identification: 1 Cor 5:7 ("Christ, our Passover, has been sacrificed"), John 19:36, and 1 Pet 1:18–19',
    summary: 'Exodus 12:7,13,22–23 records the Passover lamb’s blood (דָּם H1818) applied to the lintel and two doorposts (מְזוּזֹת / מַשְׁקוֹף / פֶּתַח) so the destroyer cannot enter. NT writers explicitly connect Jesus to the Passover lamb: 1 Cor 5:7 (τὸ πάσχα ἡμῶν ἐτύθη Χριστός), John 19:36 quoting Exod 12:46 ("not one of his bones shall be broken"), 1 Pet 1:19 (blood of an unblemished lamb), and Heb 11:28 (sprinkling of blood).',
    source_node_id: 'motif:passover_lamb',
    target_node_id: 'concept:jesus',
    passages: helperPassages([2, 12, 7], [2, 12, 13], [2, 12, 46], [46, 5, 7], [43, 19, 36], [60, 1, 19], [58, 11, 28]),
    original_words: getOriginalWords(['H6453', 'H1818', 'H4201', 'H6607', 'G3957', 'G0129', 'G0286']),
    matched_terms: ['passover', 'blood', 'door', 'doorpost', 'doorposts', 'lintel', 'lamb', 'jesus', 'christ', 'exodus', 'corinthians', 'john'],
    limitations: [
      'Passover lamb / blood / unbroken-bone typology is explicitly attested in 1 Cor 5:7, John 19:36, 1 Pet 1:19, and Heb 11:28.',
      'Connecting Jesus’s "I am the door" saying (John 10:7,9 θύρα G2374, spoken in the sheepfold discourse) specifically to the Exodus 12 doorway/blood is a thematic/literary correspondence rather than an explicit citation in John 10.',
    ],
    provenance: { source_dataset: 'MACULA Hebrew & Greek + CrossReferences.org', source_record_ids: ['1cor5:7', 'john19:36', '1pet1:19', 'heb11:28', 'exod12:7'], license: 'CC BY 4.0', derivation_method: 'explicit_nt_quote_and_passover_typology' },
  },
  {
    evidence_id: 'r10:motif:john10_door_thematic_contrast',
    predicate: 'shared_motif',
    evidence_tier: 5,
    epistemic_class: 'shared_motif_evidence',
    title: 'Shared doorway imagery: John 10:7,9 ("I am the door of the sheep" θύρα G2374) vs Exodus 12:22–23 doorway/lintel (פֶּתַח H6607)',
    summary: 'In John 10:7–9 Jesus calls himself the door (θύρα) through which anyone enters and is saved (σωθήσεται); Exodus 12:22–23 marks the house doorway (פֶּתַח, LXX θύρα G2374) with blood for protection from judgment. LXX translates Exod 12:22 פֶּתַח with the exact Greek noun θύρα (G2374), creating shared vocabulary, though John 10’s immediate metaphor is a sheepfold.',
    source_node_id: 'motif:door_lintel',
    target_node_id: 'concept:jesus',
    passages: helperPassages([43, 10, 7], [43, 10, 9], [2, 12, 22], [2, 12, 23]),
    original_words: getOriginalWords(['G2374', 'H6607', 'H4201']),
    matched_terms: ['door', 'doors', 'doorpost', 'gate', 'jesus', 'passover', 'blood', 'lxx'],
    limitations: ['Shared motif and LXX word (θύρα), NOT an explicit quotation of Exodus 12 by John 10; kept distinct from John 19:36 & 1 Cor 5:7 explicit Passover citations.'],
    provenance: { source_dataset: 'MACULA Greek & Hebrew + LXX lexicon correspondence', source_record_ids: ['john10:7-9', 'exod12:22-23'], license: 'CC BY 4.0', derivation_method: 'lxx_word_bridge_and_motif_match' },
  },

  // §2F Orthographic & Wordplay: Adam / Dam / Adamah
  {
    evidence_id: 'r10:orth:adam_dam_consonantal_overlap',
    predicate: 'orthographic_overlap',
    evidence_tier: 7,
    epistemic_class: 'orthographic_similarity_only',
    title: 'Orthographic consonantal overlap: אָדָם (adam H0120, man/humanity) contains דָּם (dam H1818, blood) — NO proven common etymological root',
    summary: 'In unpointed Hebrew script, אָדָם (ʾ-d-m, 3 consonants: א-ד-ם) contains the two-consonant sequence ד-ם of דָּם (d-m, blood). These are distinct lexical entries (H0120 vs H1818) with different meanings ("humanity" vs "blood") and NO proven historical/morphological derivation linking them in STEPBible/BDB.',
    source_node_id: 'lemma:H0120G',
    target_node_id: 'lemma:H1818',
    passages: helperPassages([1, 2, 7], [1, 9, 6]),
    original_words: getOriginalWords(['H0120', 'H1818']),
    matched_terms: ['adam', 'dam', 'blood', 'man', 'human', 'אדם', 'דם', 'wordplay', 'consonants', 'root'],
    orthographic_analysis: {
      source_script: 'אָדָם',
      target_script: 'דָּם',
      source_consonants: 'א-ד-ם',
      target_consonants: 'ד-ם',
      shared_consonants: 'ד-ם (2nd & 3rd consonants of אדם)',
      overlap_kind: 'consonantal_subsequence_only',
      proven_common_root: false,
      etymology_warning: 'Orthographic resemblance only: consonantal overlap between א-ד-ם (adam) and ד-ם (dam) does NOT establish a shared historical root or Hebrew etymology. Compare Gen 9:6 where בָּאָדָם דָּמוֹ juxtaposes them topically without claiming etymological identity.',
    },
    linguistic_notes: [
      'אדם (H0120): ʾā-ḏām (consonants Aleph-Daleth-Mem) = man, humankind, Adam.',
      'דם (H1818): dām (consonants Daleth-Mem) = blood.',
      'BDB/STEPBible treat H0120 and H1818 as separate roots/families; letter-level homiletic interpretations (e.g. "aleph + blood") are modern/midrashic interpretive proposals, not lexical etymology.',
    ],
    limitations: ['Ranked at Tier 7 (orthographic resemblance) so spelling overlap is transparent yet never mistaken for historical root derivation or explicit biblical typology.'],
    provenance: { source_dataset: 'BibleResearch lexical_connections + STEPBible TBESH + HebrewLexicon', source_record_ids: ['lexical_connections:2', 'TBESH:H0120', 'TBESH:H1818'], license: 'CC BY 4.0', derivation_method: 'exact_consonantal_substring_v1' },
  },
  {
    evidence_id: 'r10:wordplay:adam_adamah_gen2_7',
    predicate: 'orthographic_wordplay',
    evidence_tier: 3,
    epistemic_class: 'documented_lexical_relationship',
    title: 'Stronger biblical wordplay: Genesis 2:5–7 juxtaposes אָדָם (adam H0120) and אֲדָמָה (adamah H0127, ground) sharing consonants א-ד-ם',
    summary: 'Genesis 2:5–7 exhibits direct biblical paronomasia: there was no human (אָדָם) to work the ground (אֲדָמָה), and God formed the human (הָאָדָם) of dust from the ground (מִן־הָאֲדָמָה, Gen 2:7; cf. Gen 3:19). Unlike אָדָם/דָּם, both share the full triliteral sequence א-ד-ם and are juxtaposed explicitly in the Hebrew narrative.',
    source_node_id: 'lemma:H0120G',
    target_node_id: 'lemma:H0127G',
    passages: helperPassages([1, 2, 7], [1, 2, 5], [1, 3, 19]),
    original_words: getOriginalWords(['H0120', 'H0127', 'H6083']),
    matched_terms: ['adam', 'adamah', 'ground', 'earth', 'dust', 'wordplay', 'genesis', 'אדם', 'אדמה', 'dam'],
    orthographic_analysis: {
      source_script: 'אָדָם',
      target_script: 'אֲדָמָה',
      source_consonants: 'א-ד-ם',
      target_consonants: 'א-ד-ם-ה',
      shared_consonants: 'א-ד-ם (all 3 triliteral consonants)',
      overlap_kind: 'documented_biblical_wordplay',
      proven_common_root: true,
      etymology_warning: 'Documented biblical literary paronomasia in Gen 2:5–7 & 3:19 with triliteral א-ד-ם overlap; STEP/BDB treat them under related א-ד-ם/אדם lexical group, though literary juxtaposition does not prove historical priority direction.',
    },
    limitations: ['Gen 2:7 establishes אָדָם ↔ אֲדָמָה (human ↔ ground), contrasting sharply with the weaker modern/midrashic אָדָם ↔ דָּם pairing.'],
    provenance: { source_dataset: 'BibleResearch lexical_connections + MACULA Hebrew Gen 2:5-7', source_record_ids: ['lexical_connections:1', 'o01002007'], license: 'CC BY 4.0', derivation_method: 'source_text_juxtaposition_and_triliteral_match' },
  },
  {
    evidence_id: 'r10:interp:gen4_10_11_blood_ground_echo',
    predicate: 'literary_correspondence',
    evidence_tier: 5,
    epistemic_class: 'candidate_literary_pattern',
    title: 'Thematic / interpretive sound echo in Genesis 4:10–11: brother’s blood (דְּמֵי אָחִיךָ) crying from the ground (מִן־הָאֲדָמָה)',
    summary: 'In Genesis 4:10–11, Abel’s blood (דְּמֵי H1818) cries to God from the ground (הָאֲדָמָה H0127), which opens its mouth to receive the blood—extending Genesis 2–3’s אָדָם/אֲדָמָה theme by juxtaposing דָּם (blood) and אֲדָמָה (ground). Marked as interpretive/literary resonance, NOT etymological identity.',
    source_node_id: 'lemma:H1818',
    target_node_id: 'lemma:H0127G',
    passages: helperPassages([1, 4, 10], [1, 4, 11]),
    original_words: getOriginalWords(['H1818', 'H0127', 'H0120']),
    matched_terms: ['blood', 'dam', 'ground', 'adamah', 'adam', 'abel', 'cain', 'genesis'],
    limitations: ['Genesis 4:10–11 links blood (דָּם) and ground (אֲדָמָה) in narrative judgment; connecting this back to אָדָם/דָּם as a single triangular wordplay is a secondary interpretive synthesis rather than a stated etymology.'],
    provenance: { source_dataset: 'MACULA Hebrew Gen 4:10-11', source_record_ids: ['o01004010-o01004011'], license: 'CC BY 4.0', derivation_method: 'pericope_cooccurrence_and_wordplay_contrast' },
  },

  // Creation & New Creation / Gen 1 & Rev 4 / Rev 21-22
  {
    evidence_id: 'r10:corresp:gen1_to_rev4_rev21_creation_spirits',
    predicate: 'literary_correspondence',
    evidence_tier: 4,
    epistemic_class: 'verified_cross_reference',
    title: 'Genesis 1 creation (Spirit over waters, light, sevenfold completion) and Revelation 4–5 & 21–22 (throne of Creator, seven Spirits, new creation)',
    summary: 'Genesis 1 opens with God creating heavens/earth, the Spirit/wind (רוּחַ אֱלֹהִים) hovering over the waters (v.2), light out of darkness (v.3), and sevenfold completion (Gen 2:1–3). Revelation 4:5–11 explicitly worships the Creator ("you created all things" v.11) before the seven Spirits/lamps (v.5), while Revelation 21:1,5 & 22:1–5 announce the "new heaven and new earth" with light, throne, river of water of life, and tree of life.',
    source_node_id: 'event:creation',
    target_node_id: 'motif:creation_light_darkness',
    passages: helperPassages([1, 1, 1], [1, 1, 2], [1, 2, 2], [66, 4, 5], [66, 4, 11], [66, 21, 1], [66, 22, 1]),
    original_words: getOriginalWords(['H1254', 'H7307', 'H4325', 'G2936', 'G4151', 'G2033']),
    matched_terms: ['genesis', 'creation', 'revelation', 'seven', 'spirits', 'spirit', 'new', 'light', 'water', 'throne', 'tree'],
    limitations: ['Rev 4:11 and Rev 21–22 explicitly recall Creation theology and Eden motifs, whereas connecting Gen 1:2’s singular Spirit directly to Rev 4:5’s "seven Spirits" passes through Isa 11:2 / Zech 4:2–10 rather than an explicit Gen 1 citation inside Rev 4:5.'],
    provenance: { source_dataset: 'MACULA + CrossReferences.org + Theographic events', source_record_ids: ['xref:rev4:11->gen1:1', 'xref:rev21:1->gen1:1', 'xref:rev22:1->gen2:9'], license: 'CC BY 4.0', derivation_method: 'xref_creation_to_revelation_chain' },
  },

  // Homograph / Disambiguation Control: ayin (eye vs spring/well)
  {
    evidence_id: 'r10:homograph:ayin_eye_vs_spring_h5869',
    predicate: 'verified_lexical_grammatical',
    evidence_tier: 3,
    epistemic_class: 'documented_lexical_relationship',
    title: 'Homograph disambiguation: Hebrew עַיִן (a.yin H5869) means both "eye / sight" (Zech 4:10) and "spring / fountain / well" (Gen 16:7; Exod 15:27)',
    summary: 'STEPBible distinguishes senses of עַיִן (H5869): physical eye/sight (H5869a → LXX ὀφθαλμός G3788, as in Zech 4:10 "eyes of YHWH") vs water spring/fountain (H5869b → LXX πηγή G4077, as in Gen 16:7, 24:13, Prov 8:28). Context prevents conflating "seven eyes" with literal springs while noting both senses use the same Hebrew noun.',
    source_node_id: 'lemma:H5869a',
    target_node_id: 'lemma:H5869b',
    passages: helperPassages([38, 4, 10], [1, 24, 13], [2, 15, 27]),
    original_words: getOriginalWords(['H5869', 'G3788', 'G4077']),
    matched_terms: ['eye', 'eyes', 'ayin', 'spring', 'fountain', 'well', 'water', 'homograph'],
    linguistic_notes: ['Sense 1: eye (Zech 4:10 עֵינֵי יְהוָה → ὀφθαλμοί).', 'Sense 2: spring of water (Gen 24:13 עֵין הַמַּיִם → πηγή).'],
    limitations: ['Homograph guard: never treat a spring/well occurrence of עַיִן as an "eyes of the LORD" occurrence merely by Strong’s number H5869.'],
    provenance: { source_dataset: 'STEPBible TBESH + MACULA Hebrew + LXX Alignments', source_record_ids: ['TBESH:H5869a', 'TBESH:H5869b'], license: 'CC BY 4.0', derivation_method: 'homograph_sense_separation' },
  },
];

// Cross-language verified motif equivalence bridges (§2G)
const crossLangBridges = [
  {
    evidence_id: 'r10:xlang:menorah_luchnia',
    predicate: 'cross_language_bridge',
    evidence_tier: 3,
    epistemic_class: 'documented_lexical_relationship',
    title: 'Same-image cross-language bridge: Hebrew מְנוֹרָה (menorah H4501) ↔ LXX/NT Greek λυχνία (luchnia G3087)',
    summary: 'LXX translates Exodus 25 & Zechariah 4 מְנוֹרָה (lampstand) using Greek λυχνία (G3087), the same Greek word used in Revelation 1:12–20 & 11:4 (linking Zech 4:3,11–14 to Rev 11:4 "the two lampstands").',
    source_node_id: 'lemma:H4501',
    target_node_id: 'lemma:G3087',
    passages: helperPassages([2, 25, 31], [38, 4, 2], [66, 11, 4], [66, 1, 12]),
    original_words: getOriginalWords(['H4501', 'G3087']),
    matched_terms: ['menorah', 'lampstand', 'lampstands', 'luchnia', 'zechariah', 'revelation'],
    limitations: ['Translation equivalence connects the physical object/imagery noun; passage context determines symbolism (Tabernacle vs Zech 4 vision vs Rev 1:20 churches vs Rev 11:4 two witnesses).'],
    provenance: { source_dataset: 'HEBREW_LXX_WORD_ALIGNMENTS + MACULA', source_record_ids: ['align:H4501->G3087'], license: 'CC BY 4.0', derivation_method: 'lxx_translation_equivalence' },
  },
  {
    evidence_id: 'r10:xlang:ner_lampas',
    predicate: 'cross_language_bridge',
    evidence_tier: 3,
    epistemic_class: 'documented_lexical_relationship',
    title: 'Same-image cross-language bridge: Hebrew נֵר / לַפִּיד (ner H5216 / lamp) ↔ Greek λαμπάς / λύχνος (lampas G2985 / luchnos G3088)',
    summary: 'Connects Zech 4:2 seven lamps (שִׁבְעָה נֵרֹתֶיהָ) and Ezek 1:13 burning torches (לַפִּידִים) with Revelation 4:5 seven burning lamps (ἑπτὰ λαμπάδες πυρός G2985).',
    source_node_id: 'lemma:H5216a',
    target_node_id: 'lemma:G2985',
    passages: helperPassages([38, 4, 2], [26, 1, 13], [66, 4, 5]),
    original_words: getOriginalWords(['H5216', 'H3940', 'G2985', 'G3088']),
    matched_terms: ['lamp', 'lamps', 'torch', 'ner', 'lampas', 'fire', 'seven', 'revelation', 'zechariah'],
    limitations: ['Shared lamp imagery in prophetic visions; LXX most often uses λύχνος for נֵר and λαμπάς for לַפִּיד (torch/lamp).'],
    provenance: { source_dataset: 'STEPBible + MACULA Hebrew & Greek', source_record_ids: ['H5216->G2985/G3088'], license: 'CC BY 4.0', derivation_method: 'lexical_semantic_bridge' },
  },
  {
    evidence_id: 'r10:xlang:ruach_pneuma_anemos',
    predicate: 'cross_language_bridge',
    evidence_tier: 3,
    epistemic_class: 'documented_lexical_relationship',
    title: 'Cross-language bridge: Hebrew רוּחַ (ruach H7307) ↔ Greek πνεῦμα (pneuma G4151) & ἄνεμος (anemos G0417)',
    summary: 'Hebrew רוּחַ encompasses spirit, breath, wind, and compass quarter/side; LXX and NT translate it primarily with πνεῦμα (Spirit/breath/wind, e.g., John 3:8; Acts 2:2) and with ἄνεμος when emphasizing wind/four compass winds (e.g., Matt 24:31; Rev 7:1).',
    source_node_id: 'lemma:H7307',
    target_node_id: 'lemma:G4151',
    passages: helperPassages([1, 1, 2], [26, 37, 9], [43, 3, 8], [66, 7, 1]),
    original_words: getOriginalWords(['H7307', 'G4151', 'G0417']),
    matched_terms: ['ruach', 'pneuma', 'anemos', 'spirit', 'wind', 'breath', 'directions', 'four'],
    limitations: ['Lexical equivalence explains why OT/NT passages bridge wind, breath, four winds, and Spirit using single-word clusters.'],
    provenance: { source_dataset: 'HEBREW_LXX_WORD_ALIGNMENTS + STEPBible', source_record_ids: ['align:H7307->G4151', 'align:H7307->G0417'], license: 'CC BY 4.0', derivation_method: 'lxx_translation_equivalence' },
  },
];

// Candidate literary patterns (§2E)
const wellMarriageData = JSON.parse(fs.readFileSync(path.join(ANNOT_DIR, 'well-marriage.json'), 'utf8'));
const candidatePatterns = [
  {
    evidence_id: 'r10:pattern:waters_separation_passage',
    predicate: 'literary_pattern',
    evidence_tier: 5,
    epistemic_class: 'candidate_literary_pattern',
    title: 'Candidate literary pattern: Waters → Separation / Parting → Safe Passage & New Beginning',
    summary: 'A recurring structural sequence appears across Creation (Gen 1:6–10 dividing waters), the Flood (Gen 7–8 waters subside), the Red Sea (Exod 14:21–22 parted sea passage), the Jordan (Josh 3:13–17), and NT baptism typology (1 Cor 10:1–2; 1 Pet 3:20–21). Marked as a candidate literary pattern except where NT authors explicitly connect them.',
    source_node_id: 'motif:water',
    target_node_id: 'motif:baptism_washing',
    passages: helperPassages([1, 1, 9], [1, 8, 1], [2, 14, 21], [6, 3, 16], [46, 10, 1], [60, 3, 21]),
    original_words: getOriginalWords(['H4325', 'H3220', 'H1234', 'G2281', 'G5204', 'G0907']),
    matched_terms: ['water', 'waters', 'sea', 'red', 'crossing', 'passage', 'separation', 'flood', 'jordan', 'baptism', 'creation'],
    limitations: ['Candidate structural pattern across narratives; historical intention as a single unified typology is proven ONLY where stated (e.g., 1 Cor 10:1–2, 1 Pet 3:20–21, Isa 51:10).'],
    provenance: { source_dataset: 'BibleResearch Pattern Synthesis + MACULA', source_record_ids: ['pattern:waters-separation-passage'], license: 'CC BY 4.0', derivation_method: 'curated_structural_pattern_with_controls' },
  },
  {
    evidence_id: 'r10:pattern:death_passage_life_passover_redsea',
    predicate: 'literary_pattern',
    evidence_tier: 5,
    epistemic_class: 'candidate_literary_pattern',
    title: 'Candidate literary pattern: Threat of Death / Judgment → Marked Doorway or Sea Passage → Deliverance to Life',
    summary: 'Connects Passover blood-marked doorway protection (Exod 12:7,13), Red Sea deliverance through mortal waters (Exod 14:29–30), and NT baptism into Christ’s death/resurrection (Rom 6:3–4; 1 Cor 5:7; 1 Cor 10:1–2).',
    source_node_id: 'motif:passover_lamb',
    target_node_id: 'motif:baptism_washing',
    passages: helperPassages([2, 12, 13], [2, 14, 30], [45, 6, 3], [45, 6, 4]),
    original_words: getOriginalWords(['H1818', 'H6453', 'G0907', 'G2288', 'G2222']),
    matched_terms: ['death', 'life', 'blood', 'passover', 'door', 'baptism', 'red', 'sea', 'jesus'],
    limitations: ['Candidate literary pattern; treat Rom 6:3–4 (baptism into death) and Exod 12/14 as distinct contexts unless linked explicitly by an author.'],
    provenance: { source_dataset: 'BibleResearch Pattern Synthesis', source_record_ids: ['pattern:death-passage-life'], license: 'CC BY 4.0', derivation_method: 'curated_structural_pattern_with_controls' },
  },
  {
    evidence_id: 'r10:pattern:well_marriage_with_controls',
    predicate: 'literary_pattern',
    evidence_tier: 5,
    epistemic_class: 'candidate_literary_pattern',
    title: 'Candidate type-scene: Encounter at a Well leading to Betrothal (Gen 24, Gen 29, Exod 2) — with non-betrothal well controls (Gen 21:19, Gen 26)',
    summary: `Reviewed Pentateuchal type-scene annotation (${wellMarriageData.denominator_note}): Rebekah (Gen 24:11–67), Rachel (Gen 29:2–28), and Zipporah (Exod 2:15–21) show a recurring well → drawing water → hospitality → marriage sequence, while Gen 21:19 (Hagar) and Gen 26:18–33 (Isaac) demonstrate wells without betrothal.`,
    source_node_id: 'motif:well_marriage',
    target_node_id: 'motif:water',
    passages: helperPassages([1, 24, 15], [1, 29, 2], [2, 2, 15], [1, 21, 19], [1, 26, 20]),
    original_words: getOriginalWords(['H0875', 'H5869', 'H4325']),
    matched_terms: ['well', 'water', 'marriage', 'betrothal', 'rebekah', 'rachel', 'zipporah', 'hagar', 'control', 'type-scene'],
    limitations: ['Candidate literary type-scene (epistemic category: interpretive); control passages Gen 21:19 & Gen 26 prove a well encounter alone does not signify marriage.'],
    provenance: { source_dataset: 'data/annotations/well-marriage.json', source_record_ids: wellMarriageData.episodes.map(e => e.assertion_key), license: wellMarriageData.license, derivation_method: 'reviewed_literary_annotation_with_controls' },
  },
];

// Add auto-detected Greek relative+copula identifications
const curatedIdsSeen = new Set(curatedEvidenceRecords.map(e => e.passages[0]?.verse_id));
let autoCopulaCount = 0;
for (const hit of explicitIdentHits) {
  if (curatedIdsSeen.has(hit.vid)) continue;
  const c = coordByVerseId.get(hit.vid);
  if (!c) continue;
  const subjWords = getOriginalWords([hit.subject_s, hit.predicate_s]);
  if (subjWords.length < 2) continue;
  curatedIdsSeen.add(hit.vid);
  autoCopulaCount++;
  curatedEvidenceRecords.push({
    evidence_id: `r10:ident:auto:${hit.vid}`,
    predicate: 'explicit_identification',
    evidence_tier: 1,
    epistemic_class: 'direct_textual_evidence',
    title: `${hit.ref} explicit identification clause (${subjWords[0].lemma_script} / ${subjWords[0].gloss} → ${subjWords[1].lemma_script} / ${subjWords[1].gloss})`,
    summary: `Syntactic relative-pronoun + copula clause (εἰμί G1510) in ${hit.ref} linking antecedent ${subjWords[0].lemma_script} (${subjWords[0].gloss}) to predicate ${subjWords[1].lemma_script} (${subjWords[1].gloss}).`,
    source_node_id: `lemma:${hit.subject_s}`,
    target_node_id: `lemma:${hit.predicate_s}`,
    passages: [{ verse_id: hit.vid, ref: hit.ref, book: c.book, chapter: c.chapter, verse: c.verse, testament: 'NT', snippet: englishByCoord.get(c.key) || '' }],
    original_words: subjWords,
    matched_terms: [subjWords[0].gloss, subjWords[1].gloss, subjWords[0].transliteration, subjWords[1].transliteration].map(normalizeAscii).filter(Boolean),
    limitations: ['Auto-extracted from MACULA Greek relative-pronoun referent + copula structure; verify full clause context in reader.'],
    provenance: { source_dataset: 'MACULA Greek (Nestle1904)', source_record_ids: [`auto_copula:${hit.vid}`], license: 'CC BY 4.0', derivation_method: 'greek_relative_copula_referent_extraction' },
  });
}

manifestFiles.push(writeGzJson('r10/explicit-and-typology.json.gz', {
  schema_version: 1,
  records: [...curatedEvidenceRecords, ...crossLangBridges, ...candidatePatterns],
}));
console.log(`Indexed ${curatedEvidenceRecords.length + crossLangBridges.length + candidatePatterns.length} explicit/typology/bridge/pattern records.`);

// 11. Build motifs-and-patterns.json.gz + Theographic Events
const chronEvents = JSON.parse(fs.readFileSync(path.join(CHRON_DIR, 'events.json'), 'utf8'));
const chronVerses = JSON.parse(fs.readFileSync(path.join(CHRON_DIR, 'verses.json'), 'utf8'));
const chronVerseIdToPassage = new Map();
for (const cv of chronVerses) {
  const osis = cv.fields?.osisRef;
  if (!osis) continue;
  const parts = osis.split('.');
  if (parts.length !== 3) continue;
  const b = bookByNameLower.get(parts[0].toLowerCase()) || bookById.get(BOOK_ALIASES.get(parts[0].toLowerCase()));
  if (!b) continue;
  const ch = Number(parts[1]), vs = Number(parts[2]);
  const vid = verseIdByCoord.get(coordKey(b.id, ch, vs));
  if (vid) chronVerseIdToPassage.set(cv.id, { verse_id: vid, ref: formatRef(b.id, ch, vs), book: b.id, chapter: ch, verse: vs, testament: b.id <= 39 ? 'OT' : 'NT' });
}

const indexedEvents = [];
for (const ev of chronEvents) {
  const title = ev.fields?.title;
  if (!title) continue;
  const passages = (ev.fields.verses || []).map(vid => chronVerseIdToPassage.get(vid)).filter(Boolean).slice(0, 12);
  if (passages.length === 0) continue;
  const terms = normalizeAscii(title).split(/\s+/).filter(w => w.length >= 3);
  if (/red sea/i.test(title)) terms.push('exodus', 'crossing', 'sea', 'baptism');
  if (/creation/i.test(title)) terms.push('genesis', 'earth', 'light', 'spirit');
  if (/passover/i.test(title)) terms.push('lamb', 'blood', 'door', 'exodus');
  if (/flood/i.test(title)) terms.push('noah', 'ark', 'water');
  if (/dry bones/i.test(title)) terms.push('ezekiel', 'ruach', 'breath', 'spirit', 'wind');
  indexedEvents.push({
    event_id: `event:${ev.fields.eventID || ev.id}`,
    title,
    start_date: ev.fields.startDate || null,
    duration: ev.fields.duration || null,
    passages,
    keywords: [...new Set(terms)],
  });
}

const motifCatalog = {};
for (const [mId, info] of MOTIF_STRONG_MAP.entries()) {
  const matchingVerses = [];
  for (const [vid, mMap] of verseMotifs.entries()) {
    const hitSet = mMap.get(mId);
    if (hitSet && hitSet.size > 0) {
      matchingVerses.push({ vid, hits: hitSet.size, strongs: [...hitSet] });
    }
  }
  matchingVerses.sort((a, b) => b.hits - a.hits || a.vid - b.vid);
  motifCatalog[mId] = {
    motif_id: mId,
    label: info.label,
    strongs: info.strongs,
    original_words: getOriginalWords(info.strongs),
    total_verses: matchingVerses.length,
    top_passages: matchingVerses.slice(0, 30).map(x => {
      const c = coordByVerseId.get(x.vid);
      return {
        verse_id: x.vid,
        ref: c.ref,
        book: c.book,
        chapter: c.chapter,
        verse: c.verse,
        testament: c.book <= 39 ? 'OT' : 'NT',
        matched_strongs: x.strongs,
      };
    }),
  };
}

const motifCooccurrences = {};
for (const [vid, mMap] of verseMotifs.entries()) {
  if (mMap.size < 2) continue;
  const mIds = [...mMap.keys()].sort();
  for (let i = 0; i < mIds.length; i++) {
    for (let j = i + 1; j < mIds.length; j++) {
      const pk = `${mIds[i]}|${mIds[j]}`;
      if (!motifCooccurrences[pk]) motifCooccurrences[pk] = { count: 0, sample_vids: [] };
      motifCooccurrences[pk].count++;
      if (motifCooccurrences[pk].sample_vids.length < 12) motifCooccurrences[pk].sample_vids.push(vid);
    }
  }
}
const compactPairs = {};
for (const [pk, val] of Object.entries(motifCooccurrences)) {
  if (val.count >= 1) {
    compactPairs[pk] = {
      count: val.count,
      passages: val.sample_vids.slice(0, 8).map(vid => {
        const c = coordByVerseId.get(vid);
        return { verse_id: vid, ref: c.ref, book: c.book, chapter: c.chapter, verse: c.verse, testament: c.book <= 39 ? 'OT' : 'NT' };
      }),
    };
  }
}

manifestFiles.push(writeGzJson('r10/motifs-and-patterns.json.gz', {
  schema_version: 1,
  motifs: motifCatalog,
  motif_pairs: compactPairs,
  events: indexedEvents,
}));
console.log(`Indexed ${Object.keys(motifCatalog).length} motifs, ${Object.keys(compactPairs).length} motif co-occurrence pairs, ${indexedEvents.length} events.`);

// 12. Build orthographic consonantal overlap shards (64 buckets) for Hebrew lemmas
console.log('Building Hebrew orthographic overlap & root shards (64 shards)...');
const hebrewByBase = new Map();
for (const l of lemmas) {
  if (l.language !== 'hbo' && l.language !== 'arc') continue;
  const bs = baseStrongs(l.base_strongs);
  const cons = stripDiacriticsHebrew(l.lemma_stripped || l.lemma_script);
  if (!cons || cons.length < 2) continue;
  if (!hebrewByBase.has(bs)) {
    const rLinks = (rootsByLemmaId.get(l.id) || []).map(rl => rl.root_id);
    const gloss = sensesByLemmaId.get(l.id)?.[0]?.short_gloss || '';
    hebrewByBase.set(bs, { bs, lemma_key: l.lemma_key, script: l.lemma_script, cons, tr: l.transliteration, gloss, rootIds: new Set(rLinks) });
  }
}

const orthShards = new Array(64).fill(null).map(() => ({}));
const hebList = [...hebrewByBase.values()];
const byConsSkeleton = new Map();
for (const h of hebList) {
  if (!byConsSkeleton.has(h.cons)) byConsSkeleton.set(h.cons, []);
  byConsSkeleton.get(h.cons).push(h);
}

for (const h of hebList) {
  const sameCons = (byConsSkeleton.get(h.cons) || []).filter(x => x.bs !== h.bs).slice(0, 6);
  const sharedRoot = [];
  for (const rid of h.rootIds) {
    for (const lid of lemmasByRootId.get(rid) || []) {
      const other = lemmaById.get(lid);
      if (other) {
        const obs = baseStrongs(other.base_strongs);
        if (obs !== h.bs && !sharedRoot.some(x => x.bs === obs)) {
          sharedRoot.push({ bs: obs, script: other.lemma_script, cons: stripDiacriticsHebrew(other.lemma_script), tr: other.transliteration, gloss: sensesByLemmaId.get(other.id)?.[0]?.short_gloss || '', root: rootById.get(rid)?.root_script || '' });
        }
      }
      if (sharedRoot.length >= 6) break;
    }
  }
  const subsequences = [];
  if (h.cons.length === 3) {
    for (let start = 0; start <= 1; start++) {
      const sub2 = h.cons.slice(start, start + 2);
      for (const cand of (byConsSkeleton.get(sub2) || []).slice(0, 4)) {
        if (cand.bs !== h.bs) {
          const shareRoot = [...h.rootIds].some(rid => cand.rootIds.has(rid));
          subsequences.push({
            bs: cand.bs,
            script: cand.script,
            cons: cand.cons,
            tr: cand.tr,
            gloss: cand.gloss,
            shared_consonants: sub2,
            proven_common_root: shareRoot,
            relation_note: shareRoot
              ? `Shares root anchor with ${h.script}; verify semantic relationship separately.`
              : `Orthographic subsequence only (${cand.cons} inside ${h.cons}); NO proven historical etymology or common root.`,
          });
        }
      }
    }
  }
  if (sameCons.length || sharedRoot.length || subsequences.length) {
    const bHex = bucketHex64(h.bs);
    const bIdx = parseInt(bHex, 16);
    orthShards[bIdx][h.bs] = {
      bs: h.bs,
      script: h.script,
      cons: h.cons,
      tr: h.tr,
      gloss: h.gloss,
      homographs: sameCons.map(x => ({ bs: x.bs, script: x.script, cons: x.cons, tr: x.tr, gloss: x.gloss })),
      shared_root: sharedRoot,
      consonantal_overlaps: subsequences.slice(0, 8),
    };
  }
}
for (let i = 0; i < 64; i++) {
  const bHex = i.toString(16).padStart(2, '0');
  manifestFiles.push(writeGzJson(`r10/orthographic/shard-${bHex}.json.gz`, { schema_version: 1, bucket: bHex, entries: orthShards[i] }));
}

// 13. Build comprehensive sharded lemma-lookup (64 shards)
console.log('Building comprehensive sharded lemma-lookup (64 shards)...');
const lookupShards = new Array(64).fill(null).map(() => new Map());

function addLookupToken(token, baseEntry, matchRank) {
  const norm = normalizeAscii(token);
  if (!norm || norm.length < 2 || STOPWORDS.has(norm)) return;
  const bIdx = parseInt(bucketHex64(norm), 16);
  const shard = lookupShards[bIdx];
  let list = shard.get(norm);
  if (!list) {
    list = [];
    shard.set(norm, list);
  }
  const existing = list.find(e => e.lk === baseEntry.lk);
  if (existing) {
    if (matchRank > existing.match_rank) existing.match_rank = matchRank;
  } else if (list.length < 32) {
    list.push({ ...baseEntry, match_rank: matchRank });
  }

  // Singular / Plural English variants
  const sing = singularizeEn(norm);
  if (sing !== norm && sing.length >= 2 && !STOPWORDS.has(sing)) {
    const sIdx = parseInt(bucketHex64(sing), 16);
    const sShard = lookupShards[sIdx];
    let sList = sShard.get(sing);
    if (!sList) {
      sList = [];
      sShard.set(sing, sList);
    }
    const sExist = sList.find(e => e.lk === baseEntry.lk);
    const rankAdj = Math.max(40, matchRank - 5);
    if (sExist) {
      if (rankAdj > sExist.match_rank) sExist.match_rank = rankAdj;
    } else if (sList.length < 32) {
      sList.push({ ...baseEntry, match_rank: rankAdj });
    }
  }

  const plur = pluralizeEn(norm);
  if (plur !== norm && plur.length >= 2 && !STOPWORDS.has(plur)) {
    const pIdx = parseInt(bucketHex64(plur), 16);
    const pShard = lookupShards[pIdx];
    let pList = pShard.get(plur);
    if (!pList) {
      pList = [];
      pShard.set(plur, pList);
    }
    const pExist = pList.find(e => e.lk === baseEntry.lk);
    const rankAdj = Math.max(40, matchRank - 5);
    if (pExist) {
      if (rankAdj > pExist.match_rank) pExist.match_rank = rankAdj;
    } else if (pList.length < 32) {
      pList.push({ ...baseEntry, match_rank: rankAdj });
    }
  }

  // Transliteration double-consonant variant (e.g. shoshanim <-> shoshannim)
  const dblN = norm.includes('nn') ? norm.replace(/nn/g, 'n') : (norm.includes('n') ? norm.replace(/n/g, 'nn') : null);
  if (dblN && dblN !== norm && dblN.length >= 2 && !STOPWORDS.has(dblN)) {
    const dIdx = parseInt(bucketHex64(dblN), 16);
    const dShard = lookupShards[dIdx];
    let dList = dShard.get(dblN);
    if (!dList) {
      dList = [];
      dShard.set(dblN, dList);
    }
    const dExist = dList.find(e => e.lk === baseEntry.lk);
    const rankAdj = Math.max(50, matchRank - 5);
    if (dExist) {
      if (rankAdj > dExist.match_rank) dExist.match_rank = rankAdj;
    } else if (dList.length < 32) {
      dList.push({ ...baseEntry, match_rank: rankAdj });
    }
  }
}

const STOPWORDS = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'that', 'this', 'unto', 'upon', 'have', 'are', 'was', 'were', 'not', 'but', 'all', 'his', 'her', 'its', 'they', 'them', 'you', 'your', 'one', 'two', 'shall', 'will', 'who', 'which', 'what', 'also', 'when', 'then']);

for (const l of lemmas) {
  const bs = baseStrongs(l.base_strongs);
  const hit = lemmaVerseHits.get(bs);
  const count = hit?.count ?? 0;
  const senseList = sensesByLemmaId.get(l.id) || [];
  const primaryGloss = senseList[0]?.short_gloss || l.lemma_stripped || '';
  const pos = l.primary_pos || '';
  const is_prop = Boolean(pos && (pos.includes('--L') || pos.includes('--P') || pos.includes('-L') || pos.includes('-P')));

  const baseEntry = {
    bs,
    lk: l.lemma_key,
    lang: l.language === 'grc' ? 'grc' : 'hbo',
    sc: l.lemma_script,
    tr: l.transliteration,
    gl: primaryGloss,
    cnt: count,
    is_prop,
    vs: (hit?.sampleVerses || []).slice(0, 12),
  };

  // 1. Strong's identifier (rank 100)
  addLookupToken(bs, baseEntry, 100);
  if (l.base_strongs && l.base_strongs !== bs) addLookupToken(l.base_strongs, baseEntry, 100);

  // 2. Primary gloss (rank 90)
  addLookupToken(primaryGloss, baseEntry, 90);
  for (const w of normalizeAscii(primaryGloss).split(/[^a-z0-9]+/)) {
    if (w.length >= 2 && !STOPWORDS.has(w)) addLookupToken(w, baseEntry, 90);
  }

  // 3. Transliteration (rank 85)
  if (l.transliteration) {
    addLookupToken(l.transliteration, baseEntry, 85);
    for (const tw of normalizeAscii(l.transliteration).split(/[^a-z0-9]+/)) {
      if (tw.length >= 3) addLookupToken(tw, baseEntry, 80);
    }
  }

  // 4. Pointed & stripped original script (rank 85)
  if (l.language === 'grc') {
    addLookupToken(stripDiacriticsGreek(l.lemma_script), baseEntry, 85);
  } else {
    const hs = stripDiacriticsHebrew(l.lemma_stripped || l.lemma_script);
    if (hs && hs.length >= 2) {
      const bIdx = parseInt(bucketHex64(hs), 16);
      const shard = lookupShards[bIdx];
      let list = shard.get(hs);
      if (!list) {
        list = [];
        shard.set(hs, list);
      }
      const existing = list.find(e => e.lk === baseEntry.lk);
      if (existing) {
        if (85 > existing.match_rank) existing.match_rank = 85;
      } else if (list.length < 32) {
        list.push({ ...baseEntry, match_rank: 85 });
      }
    }
  }

  // 5. Attested surface forms from MACULA / STEP
  const fMap = formsByLemma.get(bs);
  if (fMap) {
    for (const f of fMap.values()) {
      if (f.tr) addLookupToken(f.tr, baseEntry, 80);
      if (l.language === 'grc') {
        const gsf = stripDiacriticsGreek(f.sf);
        if (gsf && gsf.length >= 2) addLookupToken(gsf, baseEntry, 80);
      } else {
        const hsf = stripDiacriticsHebrew(f.sf);
        if (hsf && hsf.length >= 2) {
          const bIdx = parseInt(bucketHex64(hsf), 16);
          const shard = lookupShards[bIdx];
          let list = shard.get(hsf);
          if (!list) {
            list = [];
            shard.set(hsf, list);
          }
          const existing = list.find(e => e.lk === baseEntry.lk);
          if (existing) {
            if (80 > existing.match_rank) existing.match_rank = 80;
          } else if (list.length < 32) {
            list.push({ ...baseEntry, match_rank: 80 });
          }
        }
      }
      if (f.gl) {
        for (const w of normalizeAscii(f.gl).split(/[^a-z0-9]+/)) {
          if (w.length >= 2 && !STOPWORDS.has(w)) addLookupToken(w, baseEntry, 65);
        }
      }
    }
  }

  // 6. Secondary senses and definition text <= 120 chars (rank 75 / 50)
  for (const s of senseList) {
    if (s.short_gloss && s.short_gloss !== primaryGloss) {
      addLookupToken(s.short_gloss, baseEntry, 75);
      for (const w of normalizeAscii(s.short_gloss).split(/[^a-z0-9]+/)) {
        if (w.length >= 2 && !STOPWORDS.has(w)) addLookupToken(w, baseEntry, 75);
      }
    }
    if (s.definition_text && s.definition_text.length <= 120) {
      for (const w of normalizeAscii(s.definition_text).split(/[^a-z0-9]+/)) {
        if (w.length >= 3 && !STOPWORDS.has(w)) addLookupToken(w, baseEntry, 50);
      }
    }
  }
}

// Sort shard entries by (match_rank DESC, is_prop ASC, cnt DESC) and cap to 24
for (let i = 0; i < 64; i++) {
  const shard = lookupShards[i];
  const entries = [];
  for (const [k, arr] of shard.entries()) {
    arr.sort((a, b) => (b.match_rank - a.match_rank) || ((a.is_prop ? 1 : 0) - (b.is_prop ? 1 : 0)) || (b.cnt - a.cnt));
    entries.push([k, arr.length > 24 ? arr.slice(0, 24) : arr]);
  }
  const bHex = i.toString(16).padStart(2, '0');
  manifestFiles.push(writeGzJson(`r10/lemma-lookup/shard-${bHex}.json.gz`, { schema_version: 1, bucket: bHex, entries }));
}
console.log('Saved 64 lemma-lookup shards.');

// 14. Build Corpus-Wide Lemma Profiles (64 shards, shard-00..3f.json.gz)
console.log('Building corpus-wide lemma profiles (64 shards)...');

// Compute document frequency & IDF across all canonical verses
const TOTAL_CANONICAL_VERSES = 31203;
const idfMap = new Map();
for (const [bs, rec] of lemmaVerseHits.entries()) {
  const df = rec.verseSet.size;
  const idf = Math.log(TOTAL_CANONICAL_VERSES / Math.max(1, df));
  idfMap.set(bs, idf);
}

// Determine all unique base Strong's to profile
const profileStrongsSet = new Set();
for (const bs of lemmaVerseHits.keys()) {
  if (bs) profileStrongsSet.add(bs);
}
for (const bs of lemmasByBaseStrongs.keys()) {
  if (bs) profileStrongsSet.add(bs);
}

const profileShards = new Array(64).fill(null).map(() => ({}));
const ARCH_STRONGS = new Set([
  'H1004', 'H1964', 'H4908', 'H5982', 'H3805', 'H3220', 'H4501', 'H4196',
  'H0727', 'H3563', 'H8193', 'H4639', 'H0730', 'H6086', 'H2091', 'H5178', 'H7416',
]);

function getVerseCategory(vid, c, verseTokens) {
  const b = c.book;
  const ch = c.chapter;
  const vs = c.verse;
  if (b === 19 && vs === 0) {
    return 'psalm_superscription';
  }
  const isArchSection = (b === 2 && ch >= 25 && ch <= 40) ||
                        (b === 11 && ch >= 6 && ch <= 8) ||
                        (b === 14 && ch >= 3 && ch <= 4) ||
                        (b === 26 && ch >= 40 && ch <= 48);
  const hasArchWord = (b <= 14 || b === 26) && (verseTokens || []).some(t => ARCH_STRONGS.has(t.s) || (t.all_s && t.all_s.some(s => ARCH_STRONGS.has(s))));
  if (isArchSection || hasArchWord) {
    return 'temple_and_sanctuary_architecture';
  }
  if (b >= 2 && b <= 5) {
    return 'torah_ritual_and_covenant_law';
  }
  if (b >= 18 && b <= 22) {
    return 'poetic_imagery_and_similes';
  }
  if (b >= 23 && b <= 39) {
    return 'prophetic_imagery_and_oracles';
  }
  if (b >= 40 && b <= 44) {
    return 'gospel_and_nt_teaching';
  }
  if (b >= 45 && b <= 66) {
    return 'epistolary_and_apocalyptic';
  }
  return 'historical_narrative';
}

// Pre-index Greek lemmas by gloss words for O(1) Swete LXX witness candidate matching
const grcLemmasByGlossWord = new Map();
for (const [gBs, gList] of lemmasByBaseStrongs.entries()) {
  if (!gBs.startsWith('G')) continue;
  const gCand = gList[0];
  const gGloss = sensesByLemmaId.get(gCand.id)?.[0]?.short_gloss || gCand.lemma_stripped || '';
  const gWords = normalizeAscii(gGloss).split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));
  for (const w of gWords) {
    let list = grcLemmasByGlossWord.get(w);
    if (!list) {
      list = [];
      grcLemmasByGlossWord.set(w, list);
    }
    if (!list.some(x => x.base_strongs === gCand.base_strongs)) list.push(gCand);
  }
}

// Pre-compute Swete LXX witnesses bidirectionally (Hebrew <-> Greek)
console.log('Pre-computing Swete LXX witnesses...');
const sweteWitnessByBs = new Map();

for (const [bs, rec] of lemmaVerseHits.entries()) {
  if (!bs.startsWith('H')) continue;
  if (rec.verseSet.size > 250) continue;
  const cand = lemmasByBaseStrongs.get(bs)?.[0];
  if (!cand) continue;
  const gl = sensesByLemmaId.get(cand.id)?.[0]?.short_gloss || cand.lemma_stripped || '';
  const primaryWords = normalizeAscii(gl).split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));
  const seenGrcCand = new Set();
  const grcCandidates = [];
  for (const w of primaryWords) {
    for (const gCand of (grcLemmasByGlossWord.get(w) || [])) {
      if (!seenGrcCand.has(gCand.base_strongs)) {
        seenGrcCand.add(gCand.base_strongs);
        grcCandidates.push(gCand);
        if (grcCandidates.length >= 8) break;
      }
    }
    if (grcCandidates.length >= 8) break;
  }
  const vidsArr = [...rec.verseSet];
  for (const gCand of grcCandidates) {
    const gBs = baseStrongs(gCand.base_strongs);
    const stem = (gCand.lemma_stripped || '').slice(0, 4);
    if (stem.length >= 3) {
      let matchCount = 0;
      const sampleMatchRefs = [];
      for (const vid of vidsArr) {
        const lxxWords = lxxWordsByVid.get(vid);
        if (lxxWords && lxxWords.some(w => w.startsWith(stem))) {
          matchCount++;
          if (sampleMatchRefs.length < 4) {
            const c = coordByVerseId.get(vid);
            if (c) sampleMatchRefs.push(c.ref);
          }
        }
      }
      if (matchCount > 0) {
        if (!sweteWitnessByBs.has(bs)) sweteWitnessByBs.set(bs, []);
        sweteWitnessByBs.get(bs).push({
          type: 'lxx_swete_witness',
          target_strongs: gBs,
          script: gCand.lemma_script,
          gloss: sensesByLemmaId.get(gCand.id)?.[0]?.short_gloss || gCand.lemma_stripped,
          count: matchCount,
          sample_refs: sampleMatchRefs,
        });
        if (!sweteWitnessByBs.has(gBs)) sweteWitnessByBs.set(gBs, []);
        sweteWitnessByBs.get(gBs).push({
          type: 'lxx_swete_witness',
          target_strongs: bs,
          script: cand.lemma_script,
          gloss: gl,
          count: matchCount,
          sample_refs: sampleMatchRefs,
        });
      }
    }
  }
}
console.log(`Pre-computed Swete witnesses for ${sweteWitnessByBs.size} base Strong's.`);

let totalProfilesBuilt = 0;

for (const bs of profileStrongsSet) {
  const cand = lemmasByBaseStrongs.get(bs)?.[0] || lemmaByKey.get(bs);
  const lk = cand ? cand.lemma_key : `lemma:${bs}`;
  const lang = cand ? (cand.language === 'grc' ? 'grc' : 'hbo') : (bs.startsWith('G') ? 'grc' : 'hbo');
  const sc = cand ? cand.lemma_script : '';
  const tr = cand ? cand.transliteration : '';
  const pos = cand ? (cand.primary_pos || '') : '';
  const senseList = cand ? (sensesByLemmaId.get(cand.id) || []) : [];
  const gl = senseList[0]?.short_gloss || cand?.lemma_stripped || '';
  const entity_kind = pos.includes('--L') ? 'place' : pos.includes('--P') ? 'person' : pos.includes('--G') ? 'gentilic' : pos.includes('--T') ? 'title' : 'common';

  const hitRec = lemmaVerseHits.get(bs);
  const allVidsSorted = hitRec ? [...hitRec.verseSet].sort((a, b) => a - b) : [];
  const allVidsSet = new Set(allVidsSorted);

  // Forms
  const fMap = formsByLemma.get(bs);
  const topFormsSorted = fMap ? [...fMap.values()].sort((a, b) => b.cnt - a.cnt) : [];

  // Partition verses into evidence clusters (100% of allVidsSorted, no drops)
  const clusterBuckets = new Map(); // category -> vid[]
  for (const vid of allVidsSorted) {
    const c = coordByVerseId.get(vid);
    if (!c) continue;
    const vTokens = tokensByBook.get(c.book)?.get(vid);
    const cat = getVerseCategory(vid, c, vTokens);
    if (!clusterBuckets.has(cat)) clusterBuckets.set(cat, []);
    clusterBuckets.get(cat).push(vid);
  }

  const evidenceClusters = [];
  for (const [category, cVids] of clusterBuckets.entries()) {
    // Dynamic human-readable label
    let label = '';
    const bookSet = new Set();
    const chMap = new Map(); // bookName -> Set<chapter>
    for (const vid of cVids) {
      const c = coordByVerseId.get(vid);
      if (c) {
        const bMeta = bookById.get(c.book);
        const bName = bMeta ? bMeta.name : `Book ${c.book}`;
        bookSet.add(bName);
        if (!chMap.has(bName)) chMap.set(bName, new Set());
        chMap.get(bName).add(c.chapter);
      }
    }
    const bookSummary = [...chMap.entries()].slice(0, 3).map(([bName, chs]) => `${bName} ${[...chs].slice(0, 4).join(', ')}`).join(' · ');

    if (category === 'psalm_superscription') {
      const pRefs = cVids.map(vid => coordByVerseId.get(vid)?.ref).filter(Boolean);
      label = `Psalm Superscriptions / Headings (${pRefs.slice(0, 4).join(', ')})`;
    } else if (category === 'temple_and_sanctuary_architecture') {
      label = `Temple & Sanctuary Architecture (${bookSummary || [...bookSet].join(' · ')})`;
    } else if (category === 'torah_ritual_and_covenant_law') {
      label = `Torah Ritual & Covenant Law (${bookSummary || [...bookSet].join(' · ')})`;
    } else if (category === 'poetic_imagery_and_similes') {
      label = `Poetic Imagery & Similes (${bookSummary || [...bookSet].join(' · ')})`;
    } else if (category === 'prophetic_imagery_and_oracles') {
      label = `Prophetic Imagery & Oracles (${bookSummary || [...bookSet].join(' · ')})`;
    } else if (category === 'gospel_and_nt_teaching') {
      label = `Gospel & NT Teaching (${bookSummary || [...bookSet].join(' · ')})`;
    } else if (category === 'epistolary_and_apocalyptic') {
      label = `Epistolary & Apocalyptic Writings (${bookSummary || [...bookSet].join(' · ')})`;
    } else {
      label = `Historical Narrative (${bookSummary || [...bookSet].join(' · ')})`;
    }

    // Collocated content words sorted by idf * hits
    const collocWordMap = new Map(); // otherBs -> verseCount
    for (const vid of cVids) {
      const c = coordByVerseId.get(vid);
      if (!c) continue;
      const vTokens = tokensByBook.get(c.book)?.get(vid) || [];
      const vBsSet = new Set();
      for (const t of vTokens) {
        if (t.s && t.s !== bs) vBsSet.add(t.s);
        if (t.all_s) {
          for (const s of t.all_s) if (s !== bs) vBsSet.add(s);
        }
      }
      for (const otherBs of vBsSet) {
        const idf = idfMap.get(otherBs) || 0;
        if (idf >= 2.0) {
          collocWordMap.set(otherBs, (collocWordMap.get(otherBs) || 0) + 1);
        }
      }
    }

    const collocated_words = [...collocWordMap.entries()]
      .map(([otherBs, hits]) => {
        const idf = idfMap.get(otherBs) || 0;
        const otherCand = lemmasByBaseStrongs.get(otherBs)?.[0];
        if (!otherCand) return null;
        const oPos = otherCand.primary_pos || '';
        if (oPos.includes('prep') || oPos.includes('cj') || oPos.includes('art') || oPos.includes('pron')) return null;
        return {
          bs: otherBs,
          sc: otherCand.lemma_script,
          tr: otherCand.transliteration,
          gl: sensesByLemmaId.get(otherCand.id)?.[0]?.short_gloss || otherCand.lemma_stripped,
          hits,
          score: Number((idf * hits).toFixed(2)),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || b.hits - a.hits)
      .slice(0, 8);

    // Sample passages
    const sample_passages = [];
    let hasSimileInCluster = false;
    for (const vid of cVids.slice(0, 8)) {
      const c = coordByVerseId.get(vid);
      if (!c) continue;
      const vTokens = tokensByBook.get(c.book)?.get(vid) || [];
      const hasSim = vTokens.some(t => t.sim && (t.s === bs || (t.all_s && t.all_s.includes(bs))));
      if (hasSim) hasSimileInCluster = true;
      let snippet = englishByCoord.get(c.key) || '';
      if (c.book === 19 && c.verse === 0 && !snippet) {
        snippet = `[Hebrew superscription gloss] ${vTokens.map(w => w.g).filter(Boolean).join(' ')}`.trim();
      }
      const mtRef = mtRefByVid.get(vid);
      sample_passages.push({
        verse_id: vid,
        ref: c.ref,
        ...(mtRef ? { mt_ref: mtRef } : {}),
        book: c.book,
        chapter: c.chapter,
        verse: c.verse,
        testament: c.book <= 39 ? 'OT' : 'NT',
        snippet,
        has_simile: hasSim,
      });
    }

    // Cross-references
    const xrefTargets = [];
    const seenXrefVids = new Set();
    for (const vid of cVids) {
      const c = coordByVerseId.get(vid);
      if (!c) continue;
      const vXrefs = xrefsByBook.get(c.book)?.[String(vid)];
      if (vXrefs?.out) {
        for (const outG of vXrefs.out) {
          for (const tgt of outG.targets || []) {
            if (!seenXrefVids.has(tgt.to_vid)) {
              seenXrefVids.add(tgt.to_vid);
              const isSameLemma = allVidsSet.has(tgt.to_vid);
              xrefTargets.push({
                from_vid: vid,
                to_vid: tgt.to_vid,
                to_ref: tgt.to_ref,
                phrase: outG.phrase,
                is_same_lemma: isSameLemma,
              });
            }
          }
        }
      }
    }
    xrefTargets.sort((a, b) => (b.is_same_lemma ? 1 : 0) - (a.is_same_lemma ? 1 : 0));

    // Data-driven summary
    const attestedSfs = [...new Set(cVids.flatMap(vid => {
      const vTokens = tokensByBook.get(coordByVerseId.get(vid)?.book)?.get(vid) || [];
      return vTokens.filter(t => t.s === bs || (t.all_s && t.all_s.includes(bs))).map(t => t.sf);
    }))];
    const topCollocGlosses = collocated_words.map(w => w.gl).filter(Boolean);

    let summaryText = `Attested in ${cVids.length} verse${cVids.length === 1 ? '' : 's'} (${sample_passages.slice(0, 4).map(p => p.ref).join(', ')}${cVids.length > 4 ? '...' : ''}) with surface forms: ${attestedSfs.slice(0, 4).join(', ')}.`;
    if (topCollocGlosses.length > 0) {
      summaryText += ` Co-occurs with: ${topCollocGlosses.slice(0, 4).join(', ')}.`;
    }
    if (category === 'psalm_superscription') {
      summaryText += ` Psalm heading / musical or liturgical superscription; whether the term refers to a tune, instrument, liturgical occasion, or floral motif is uncertain in source text.`;
    } else if (category === 'temple_and_sanctuary_architecture') {
      summaryText += ` Occurs in sanctuary or Temple architectural descriptions and sacred vessel ornamentation.`;
    }

    evidenceClusters.push({
      cluster_id: `${bs}:${category}`,
      category,
      label,
      summary: summaryText,
      vids: cVids,
      sample_passages,
      collocated_words,
      has_simile: hasSimileInCluster,
      xrefs: xrefTargets.slice(0, 8),
    });
  }

  // Grammatical relations from r8-v1.1
  const r8List = r8SummariesByBs.get(bs) || [];
  const topGramRels = r8List
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 16);

  // Lexical relations (roots, formations, entity_relationships)
  const topLexRels = [];
  const seenLexKeys = new Set();

  if (cand) {
    // 1. Roots
    for (const rl of rootsByLemmaId.get(cand.id) || []) {
      const rObj = rootById.get(rl.root_id);
      for (const otherLid of (lemmasByRootId.get(rl.root_id) || []).slice(0, 6)) {
        if (otherLid !== cand.id) {
          const otherLem = lemmaById.get(otherLid);
          if (otherLem) {
            const otherBs = baseStrongs(otherLem.base_strongs);
            const k = `root:${otherBs}`;
            if (!seenLexKeys.has(k)) {
              seenLexKeys.add(k);
              topLexRels.push({
                type: 'shares_root',
                root: rObj?.root_script || '',
                target_strongs: otherBs,
                script: otherLem.lemma_script,
                gloss: sensesByLemmaId.get(otherLem.id)?.[0]?.short_gloss || otherLem.lemma_stripped,
              });
            }
          }
        }
      }
    }
  }

  // 2. Formations
  for (const lf of formationsByBs.get(bs) || []) {
    const k = `form:${lf.analysis_key || lf.id}`;
    if (!seenLexKeys.has(k)) {
      seenLexKeys.add(k);
      topLexRels.push({
        type: `formation_${lf.formation_type || 'compound'}`,
        target_strongs: bs,
        gloss: lf.whole_word_gloss || undefined,
        note: lf.evidence_note || undefined,
      });
    }
  }
  for (const comp of componentOfFormations.get(bs) || []) {
    const k = `comp:${comp.formationBs}`;
    if (!seenLexKeys.has(k)) {
      seenLexKeys.add(k);
      topLexRels.push({
        type: 'formation_component_of',
        target_strongs: comp.formationBs,
        note: comp.formation.evidence_note || undefined,
      });
    }
  }

  // 3. Entity relationships
  if (cand) {
    for (const erItem of entityRelsByLemmaId.get(cand.id) || []) {
      const otherCe = erItem.otherCe;
      if (otherCe?.lemma_id) {
        const otherLem = lemmaById.get(otherCe.lemma_id);
        if (otherLem) {
          const otherBs = baseStrongs(otherLem.base_strongs);
          const k = `er:${otherBs}:${erItem.rel.relation_type}`;
          if (!seenLexKeys.has(k)) {
            seenLexKeys.add(k);
            topLexRels.push({
              type: erItem.rel.relation_type,
              target_strongs: otherBs,
              label: otherCe.display_label || otherLem.lemma_script,
            });
          }
        }
      }
    }
  }

  // LXX relations (bcv-lxx-bridge + aligned/Swete witnesses)
  const topLxxRels = [];
  const seenLxxKeys = new Set();

  for (const row of (lxxBridgeByBs.get(bs) || []).slice(0, 8)) {
    const targetStrong = bs.startsWith('H') ? row.greek_strong : row.hebrew_strong;
    const targetCand = lemmasByBaseStrongs.get(targetStrong)?.[0];
    const k = `bridge:${targetStrong}`;
    if (!seenLxxKeys.has(k)) {
      seenLxxKeys.add(k);
      topLxxRels.push({
        type: 'bcv_lxx_bridge',
        target_strongs: targetStrong,
        script: targetCand?.lemma_script || '',
        gloss: sensesByLemmaId.get(targetCand?.id)?.[0]?.short_gloss || targetCand?.lemma_stripped || '',
        count: row.count,
      });
    }
  }

  // Swete LXX witness (pre-computed bidirectionally)
  for (const sw of (sweteWitnessByBs.get(bs) || [])) {
    const k = `swete:${sw.target_strongs}`;
    if (!seenLxxKeys.has(k)) {
      seenLxxKeys.add(k);
      topLxxRels.push(sw);
    }
  }

  if (bs.startsWith('H') && cand) {
    // LXX Psalm heading witness
    for (const vid of allVidsSorted) {
      const c = coordByVerseId.get(vid);
      if (c?.book === 19 && c?.verse === 0) {
        const lxxTxt = lxxTextByVid.get(vid);
        if (lxxTxt) {
          topLxxRels.push({
            type: 'lxx_heading_witness',
            ref: c.ref,
            lxx_text: lxxTxt,
          });
        }
      }
    }
  }

  // Homograph siblings (same skeleton in Hebrew, homographs in Greek)
  const homograph_siblings = [];
  if (cand) {
    if (lang === 'hbo' || lang === 'arc') {
      const cons = stripDiacriticsHebrew(cand.lemma_stripped || cand.lemma_script);
      const sibs = byConsSkeleton.get(cons) || [];
      for (const sib of sibs) {
        if (sib.bs !== bs) {
          homograph_siblings.push({
            bs: sib.bs,
            lk: sib.lemma_key,
            sc: sib.script,
            tr: sib.tr,
            gl: sib.gloss,
          });
        }
      }
      // Also check if same base Strongs has other lemma keys (e.g. H7799 vs H7799A)
      for (const otherL of (lemmasByBaseStrongs.get(bs) || [])) {
        if (otherL.id !== cand.id) {
          homograph_siblings.push({
            bs,
            lk: otherL.lemma_key,
            sc: otherL.lemma_script,
            tr: otherL.transliteration,
            gl: sensesByLemmaId.get(otherL.id)?.[0]?.short_gloss || otherL.lemma_stripped,
          });
        }
      }
    }
  }

  const profile = {
    bs,
    lk,
    lang,
    sc,
    tr,
    gl,
    pos,
    entity_kind,
    senses: senseList.slice(0, 6).map(s => ({ key: s.sense_key, gl: s.short_gloss, note: s.usage_note || undefined })),
    total_verses: allVidsSorted.length,
    all_vids: allVidsSorted,
    forms: topFormsSorted.slice(0, 30),
    clusters: evidenceClusters,
    grammatical_relations: topGramRels.slice(0, 16),
    lexical_relations: topLexRels.slice(0, 12),
    lxx_relations: topLxxRels.slice(0, 12),
    homograph_siblings: homograph_siblings.slice(0, 8),
  };

  const bHex = bucketHex64(bs);
  const bIdx = parseInt(bHex, 16);
  profileShards[bIdx][bs] = profile;
  totalProfilesBuilt++;
}

for (let i = 0; i < 64; i++) {
  const bHex = i.toString(16).padStart(2, '0');
  manifestFiles.push(writeGzJson(`r10/lemma-profiles/shard-${bHex}.json.gz`, {
    schema_version: 1,
    bucket: bHex,
    entries: profileShards[i],
  }));
}
console.log(`Saved ${totalProfilesBuilt} lemma profiles into 64 shards.`);

// 15. Build hot concept-index.json.gz
const MANUAL_ALIASES = {
  ruach: { strongs: ['H7307'], motifs: ['spirit_wind_breath', 'directions_winds'], note: 'Hebrew רוּחַ (wind, breath, Spirit, direction)' },
  pneuma: { strongs: ['G4151'], motifs: ['spirit_wind_breath'], note: 'Greek πνεῦμα (Spirit, breath, wind)' },
  spirit: { strongs: ['H7307', 'G4151'], motifs: ['spirit_wind_breath'] },
  spirits: { strongs: ['H7307', 'G4151'], motifs: ['spirit_wind_breath'] },
  wind: { strongs: ['H7307', 'G4151', 'G0417'], motifs: ['spirit_wind_breath', 'directions_winds'] },
  winds: { strongs: ['H7307', 'G0417'], motifs: ['directions_winds', 'spirit_wind_breath'] },
  breath: { strongs: ['H7307', 'H5397', 'G4157'], motifs: ['spirit_wind_breath'] },
  directions: { strongs: ['H7307', 'H0702'], motifs: ['directions_winds'] },
  direction: { strongs: ['H7307'], motifs: ['directions_winds'] },
  seven: { strongs: ['H7651', 'G2033'], numbers: [7] },
  four: { strongs: ['H0702', 'G5064'], numbers: [4], motifs: ['directions_winds'] },
  eyes: { strongs: ['H5869', 'G3788'], motifs: ['eyes'] },
  eye: { strongs: ['H5869', 'G3788'], motifs: ['eyes'] },
  ayin: { strongs: ['H5869'], motifs: ['eyes', 'well_marriage'], note: 'Homograph H5869: eye vs spring/fountain' },
  lamps: { strongs: ['H5216', 'H3940', 'G2985', 'G3088'], motifs: ['lamp'] },
  lamp: { strongs: ['H5216', 'H3940', 'G2985', 'G3088'], motifs: ['lamp'] },
  menorah: { strongs: ['H4501', 'G3087'], motifs: ['lampstand'] },
  lampstand: { strongs: ['H4501', 'G3087'], motifs: ['lampstand'] },
  lampstands: { strongs: ['H4501', 'G3087'], motifs: ['lampstand'] },
  luchnia: { strongs: ['G3087'], motifs: ['lampstand'] },
  oil: { strongs: ['H8081', 'H3323', 'G1637'], motifs: ['oil'] },
  water: { strongs: ['H4325', 'G5204'], motifs: ['water'] },
  waters: { strongs: ['H4325', 'G5204'], motifs: ['water'] },
  sea: { strongs: ['H3220', 'G2281'], motifs: ['water'] },
  river: { strongs: ['H5104', 'G4215'], motifs: ['water'] },
  rivers: { strongs: ['H5104', 'G4215'], motifs: ['water'] },
  fire: { strongs: ['H0784', 'G4442'], motifs: ['fire'] },
  baptism: { strongs: ['G0908', 'G0907'], motifs: ['baptism_washing'] },
  baptized: { strongs: ['G0907'], motifs: ['baptism_washing'] },
  red: { strongs: ['H5488', 'H3220'], motifs: ['water'] },
  passover: { strongs: ['H6453', 'G3957'], motifs: ['passover_lamb'] },
  lamb: { strongs: ['H7716', 'H3532', 'G0721', 'G0286'], motifs: ['passover_lamb'] },
  door: { strongs: ['H6607', 'H4201', 'H4947', 'G2374'], motifs: ['door_lintel'] },
  doorpost: { strongs: ['H4201'], motifs: ['door_lintel'] },
  doorposts: { strongs: ['H4201'], motifs: ['door_lintel'] },
  lintel: { strongs: ['H4947'], motifs: ['door_lintel'] },
  blood: { strongs: ['H1818', 'G0129'], motifs: ['blood'] },
  dam: { strongs: ['H1818'], motifs: ['blood'], note: 'Hebrew דָּם (blood H1818)' },
  adam: { strongs: ['H0120'], motifs: ['adam_human_ground'], note: 'Hebrew אָדָם (man/Adam H0120)' },
  adamah: { strongs: ['H0127'], motifs: ['adam_human_ground'], note: 'Hebrew אֲדָמָה (ground/earth H0127)' },
  ground: { strongs: ['H0127', 'G1093'], motifs: ['adam_human_ground'] },
  creation: { strongs: ['H1254', 'G2936'], motifs: ['creation_light_darkness'] },
  light: { strongs: ['H0216', 'G5457'], motifs: ['creation_light_darkness'] },
  darkness: { strongs: ['H2822', 'G4655'], motifs: ['creation_light_darkness'] },
  well: { strongs: ['H0875', 'H5869', 'G4077'], motifs: ['well_marriage'] },
  marriage: { strongs: ['H0802', 'G1062'], motifs: ['well_marriage'] },
  tree: { strongs: ['H6086', 'G3586', 'G1186'], motifs: ['tree_garden'] },
  jesus: { strongs: ['G2424', 'G5547'], motifs: ['passover_lamb'] },
  christ: { strongs: ['G5547'], motifs: ['passover_lamb'] },
  revelation: { strongs: ['G0602'], passages: helperPassages([66, 4, 5], [66, 5, 6], [66, 1, 20]) },
  genesis: { passages: helperPassages([1, 1, 1], [1, 1, 2], [1, 2, 7]) },
  exodus: { passages: helperPassages([2, 12, 7], [2, 14, 21]) },
  zechariah: { passages: helperPassages([38, 4, 2], [38, 4, 6], [38, 4, 10]) },
};
const hotTerms = {};
for (const [term, def] of Object.entries(MANUAL_ALIASES)) {
  hotTerms[term] = {
    ...def,
    original_words: def.strongs ? getOriginalWords(def.strongs) : [],
  };
}

manifestFiles.push(writeGzJson('r10/concept-index.json.gz', {
  schema_version: 1,
  aliases: hotTerms,
  book_names: books.map(b => ({ id: b.id, name: b.name, usfm: b.usfm, chapters: b.total_chapters })),
}));

// 16. Write R11 manifests
const manifestPayload = {
  release_id: RELEASE_ID,
  schema_version: '1.0.0',
  generated_at: new Date().toISOString(),
  inherits_release: 'r9b-v1.0',
  corpus_version: '2026.11.07-v1',
  counts: {
    verses: coordByVerseId.size,
    xref_links: totalXrefPairs,
    numeral_pairs: numeralPairs.length,
    explicit_and_typology_records: curatedEvidenceRecords.length + crossLangBridges.length + candidatePatterns.length,
    motifs: Object.keys(motifCatalog).length,
    motif_pairs: Object.keys(compactPairs).length,
    events: indexedEvents.length,
    lemma_profiles: totalProfilesBuilt,
    total_r10_files: manifestFiles.length + 3,
  },
  licenses: [
    'STEPBible TBESH/TBESG/TAHOT/TAGNT (CC BY 4.0; Online Bible Meaning & s21/sdbh excluded)',
    'MACULA Hebrew & Greek (Clear Bible, CC BY 4.0)',
    'MorphHB (CC BY 4.0)',
    'CrossReferences.org / OpenBible (CC BY 4.0; s21 excluded)',
    'Swete Septuagint (Public Domain)',
    'Theographic Bible Data (CC BY-SA 4.0)',
    'World English Bible (Public Domain)',
  ],
  files: manifestFiles,
};

writePlainJson('manifest.json', manifestPayload);
writeGzJson('manifest.json.gz', manifestPayload);
writeGzJson('runtime-manifest.json.gz', {
  release_id: RELEASE_ID,
  inherits_release: 'r9b-v1.0',
  r10_base: `/v2/relationships/${RELEASE_ID}/r10`,
  hash_algorithm: 'fnv1a64_mod64',
  buckets: 64,
  counts: manifestPayload.counts,
});

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
const totalGzBytes = manifestFiles.reduce((a, f) => a + f.gz_bytes, 0);
console.log(`R11 Index Build COMPLETE in ${elapsed}s: ${manifestFiles.length + 3} files, ${(totalGzBytes / (1024 * 1024)).toFixed(2)} MiB total compressed.`);
