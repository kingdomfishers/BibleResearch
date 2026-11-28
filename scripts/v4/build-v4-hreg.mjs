#!/usr/bin/env node
/**
 * BibleResearch v4 Offline HREG + PredSim + R-MAC Compiler
 *
 * Strictly consumes CC BY 4.0 / CC0 / MIT / PD local sources:
 *   - MACULA Hebrew WLC lowfat XML (preserving lang="A" Aramaic; NEVER reading sdbh/lexdomain/coredomain/contextualdomain/frame/greek/greekstrong)
 *   - MACULA Greek Nestle1904 lowfat XML (reading Clear A0/A1/A2 links into argRoles, NEVER key `frame`; NEVER reading domain/ln)
 *   - Clear adjunct_type.json, Proximity.tsv, greek-wordsenses.tsv
 *   - STEPBible TIPNR (stepbible-tipnr.txt)
 *   - BibleOntology heads_and_lexicon.json (S0-S4 + S3 connectives)
 *   - v3-build/{sanitized-lexicon.json, lxx-alignment.json, sense-ontology.json}
 *   - OEWN 2025 JSON synsets
 *   - Canonical verse catalog (catalog-books.json + catalog-verses.bin, or v1/catalog/metadata.json.gz) + v3/verses mt_ref
 *
 * Writes identical v4 outputs to BOTH:
 *   - .artifacts-r12/v4-build/v4/
 *   - .artifacts-r12/staging-bundle/v4/
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ARG_ROLES,
  EVENT_ARCHETYPES,
  HO_TYPES,
  HREG_SORTS,
  PER_MAGIC,
  RMAC_MAGIC,
  SIM_MAGIC,
  decodeCompactHreg,
  encodeCompactHreg,
} from '../../src/relationships/v4-hreg-types.ts';
import {
  BMW_FLAG_ACTANT,
  BMW_FLAG_CONCEPT,
  BMW_FLAG_DENSE,
  hashKey64,
} from '../../src/relationships/v3-binary-index.ts';
import {
  buildRmacBmwIndex as buildRmacBmwIndexV4,
  extractRmacFeatures as extractRmacFeaturesV4,
} from '../../src/relationships/v4-rmac-index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const ART_R10 = path.join(REPO_ROOT, '.artifacts-r12');
const ART_MAIN = 'C:/Projects/BibleResearch/.artifacts';

const MACULA_HEB_DIR = path.join(ART_MAIN, 'sources/macula-hebrew/WLC/lowfat');
const MACULA_GRK_DIR = path.join(ART_MAIN, 'sources/macula-greek/Nestle1904/lowfat');
const ADJUNCT_PATH = path.join(ART_MAIN, 'sources/macula-greek/sources/Clear/adjunct-types/adjunct_type.json');
const PROXIMITY_PATH = path.join(ART_MAIN, 'sources/macula-hebrew/sources/Clear/synonyms/Proximity.tsv');
const GRK_SENSE_PATH = path.join(ART_MAIN, 'sources/macula-greek/sources/Clear/wordsense/greek-wordsenses.tsv');
const TIPNR_PATH = path.join(ART_MAIN, 'geography/stepbible-tipnr.txt');

const HEADS_PATH = path.join(REPO_ROOT, 'third_party/bibleontology/heads_and_lexicon.json');
const V3_BUILD_DIR = path.join(ART_R10, 'v3-build');
const STAGING_DIR = path.join(ART_R10, 'staging-bundle');
const OEWN_DIR = path.join(ART_R10, 'external-cache/oewn-2025');

const OUT_V4_BUILD = path.join(ART_R10, 'v4-build/v4');
const OUT_V4_STAGING = path.join(STAGING_DIR, 'v4');

const NUM_VERSES = 31203;
const NUM_PACK_FILES = 6;
const MAX_ASSET_BYTES = 4_500_000;
const DENSE_THRESHOLD = 256;
const MAX_HREG_EVENTS = 24;
const MAX_HREG_PARTICIPANTS = 32;
const MAX_COREF_CLUSTER = 12;

const RESTRICTED_KEYS = new Set([
  'gated_fields',
  'semantic_frame',
  'frame',
  'greekstrong',
  'sdbh',
  'lexdomain',
  'coredomain',
  'contextualdomain',
  'domain',
  'ln',
  'field_name',
]);

const HEB_FORBIDDEN_ATTRS = new Set([
  'sdbh', 'lexdomain', 'coredomain', 'contextualdomain', 'frame', 'greek', 'greekstrong',
]);
const GRK_FORBIDDEN_ATTRS = new Set(['domain', 'ln']);

function assertNoRestrictedKeys(val, p = '') {
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) assertNoRestrictedKeys(val[i], `${p}[${i}]`);
  } else if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      if (RESTRICTED_KEYS.has(k)) {
        throw new Error(`Restricted UBS key "${k}" detected at ${p}.${k}`);
      }
      if (v && typeof v === 'object') assertNoRestrictedKeys(v, `${p}.${k}`);
    }
  }
}

function cleanDirFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) cleanDirFiles(p);
    else fs.unlinkSync(p);
  }
}

function writeDual(relPath, buf, maxBytes = MAX_ASSET_BYTES) {
  if (buf.byteLength > maxBytes) {
    throw new Error(`v4 asset ${relPath} size ${buf.byteLength} exceeds cap ${maxBytes}`);
  }
  for (const base of [OUT_V4_BUILD, OUT_V4_STAGING]) {
    const dest = path.join(base, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  return {
    path: `v4/${relPath.replace(/\\/g, '/')}`,
    bytes: buf.byteLength,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

// =============================================================================
// 1. Normalization & Strong's Helpers
// =============================================================================

function normStrongs4(raw, langHint = '') {
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('lemma:')) s = s.slice(6);
  const m = /^([HGAhga])?0*(\d+)(?:[A-Za-z].*)?$/.exec(s);
  if (!m) return '';
  let prefix = m[1] ? m[1].toUpperCase() : (langHint === 'G' ? 'G' : 'H');
  if (prefix === 'A') prefix = 'H'; // STEP/WLC Strong's numbers unify Aramaic under H0001..H8674
  return prefix + m[2].padStart(4, '0');
}

function normS3(raw) {
  if (!raw) return '';
  const s = String(raw);
  let heb = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c >= '\u05d0' && c <= '\u05ea') heb += c;
  }
  if (heb) return heb;
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function bookGenre(bookId) {
  if (bookId <= 5) return 0; // Law
  if (bookId <= 17) return 1; // Historical
  if (bookId <= 22) return 2; // Poetical / Wisdom
  if (bookId === 27) return 6; // Daniel (Apocalyptic)
  if (bookId <= 39) return 3; // Prophets
  if (bookId <= 44) return 4; // Gospels & Acts
  if (bookId <= 65) return 5; // Epistles
  return 6; // Revelation
}

// =============================================================================
// 2. Canonical Verse Mapping (31,203 vv, 116 Psalm :0 headings + mt_ref)
// =============================================================================

function loadCanonicalCatalog() {
  const booksPath = path.join(STAGING_DIR, 'v3/index/catalog-books.json');
  const versesBinPath = path.join(STAGING_DIR, 'v3/index/catalog-verses.bin');
  let books = [];
  const verseTuples = new Array(NUM_VERSES + 1);

  if (fs.existsSync(booksPath) && fs.existsSync(versesBinPath)) {
    const booksDoc = JSON.parse(fs.readFileSync(booksPath, 'utf8'));
    books = booksDoc.books || [];
    const buf = fs.readFileSync(versesBinPath);
    const u16 = new Uint16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
    const count = Math.floor(u16.length / 3);
    if (count !== NUM_VERSES) throw new Error(`Expected ${NUM_VERSES} catalog verses, got ${count}`);
    for (let i = 0; i < count; i++) {
      verseTuples[i + 1] = [u16[i * 3], u16[i * 3 + 1], u16[i * 3 + 2]];
    }
  } else {
    const meta = JSON.parse(
      zlib.gunzipSync(fs.readFileSync(path.join(STAGING_DIR, 'v1/catalog/metadata.json.gz'))).toString('utf8')
    );
    books = meta.books || [];
    const vc = meta.verses_compact || [];
    if (vc.length !== NUM_VERSES) throw new Error(`Expected ${NUM_VERSES} metadata verses, got ${vc.length}`);
    for (const [vid, b, c, v] of vc) {
      verseTuples[vid] = [b, c, v];
    }
  }

  const usfmToBookId = new Map();
  const nameToBookId = new Map();
  for (const b of books) {
    usfmToBookId.set(String(b.usfm).toUpperCase(), b.id);
    nameToBookId.set(String(b.name).toLowerCase(), b.id);
    nameToBookId.set(String(b.usfm).toLowerCase(), b.id);
  }
  usfmToBookId.set('JUD', 65); // MACULA uses JUD for Jude while catalog uses JDE
  nameToBookId.set('psalm', 19);
  nameToBookId.set('song of solomon', 22);
  nameToBookId.set('song of songs', 22);

  const canonByTuple = new Map();
  let psalm0Count = 0;
  for (let vid = 1; vid <= NUM_VERSES; vid++) {
    const [b, c, v] = verseTuples[vid];
    canonByTuple.set(`${b}:${c}:${v}`, vid);
    if (b === 19 && v === 0) psalm0Count++;
  }
  if (psalm0Count !== 116) {
    throw new Error(`Expected 116 Psalm :0 headings, got ${psalm0Count}`);
  }

  // Load mt_ref crosswalk from v3/verses packed store
  const mtTupleToVids = new Map();
  const v3VersesDir = path.join(STAGING_DIR, 'v3/verses');
  const idxBuf = fs.readFileSync(path.join(v3VersesDir, 'verses.idx'));
  const view = new DataView(idxBuf.buffer, idxBuf.byteOffset, idxBuf.byteLength);
  const maxId = view.getUint32(12, true);
  const packCount = view.getUint32(16, true);
  const packs = Array.from({ length: packCount }, (_, p) =>
    fs.readFileSync(path.join(v3VersesDir, `pack-${String(p).padStart(2, '0')}.bin`))
  );

  for (let vid = 1; vid <= NUM_VERSES; vid++) {
    const [b, c, v] = verseTuples[vid];
    let mtKey = `${b}:${c}:${v}`;
    if (b <= 39 && vid <= maxId) {
      const off = 20 + vid * 8;
      const start = view.getUint32(off, true);
      const m = view.getUint32(off + 4, true);
      const len = m & 0x00ffffff;
      const fi = (m >>> 24) & 0xff;
      if (len > 0) {
        const rec = JSON.parse(zlib.gunzipSync(packs[fi].subarray(start, start + len)).toString('utf8'));
        if (rec.mt_ref) {
          const rm = /^(.+?)\s+(\d+):(\d+)$/.exec(String(rec.mt_ref).trim());
          if (rm) {
            const bid = nameToBookId.get(rm[1].toLowerCase());
            if (bid) mtKey = `${bid}:${Number(rm[2])}:${Number(rm[3])}`;
          }
        }
      }
    }
    let arr = mtTupleToVids.get(mtKey);
    if (!arr) {
      arr = [];
      mtTupleToVids.set(mtKey, arr);
    }
    arr.push(vid);
  }

  return { books, verseTuples, usfmToBookId, canonByTuple, mtTupleToVids };
}

// =============================================================================
// 3. Dictionary Loaders (Proximity, Adjuncts, Greek Senses, TIPNR, Ontology, OEWN)
// =============================================================================

function loadProximityAndWritePredSim(lexicon) {
  const lines = fs.readFileSync(PROXIMITY_PATH, 'utf8').split(/\r?\n/);
  const pairMinDist = new Map(); // "A|B" -> min distance

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const t1 = line.indexOf('\t');
    const t2 = line.indexOf('\t', t1 + 1);
    if (t1 < 0 || t2 < 0) continue;
    const sA = normStrongs4(line.slice(0, t1));
    const sB = normStrongs4(line.slice(t1 + 1, t2));
    const d = Number(line.slice(t2 + 1));
    if (!sA || !sB || sA === sB || !Number.isFinite(d)) continue;
    const lo = sA < sB ? sA : sB;
    const hi = sA < sB ? sB : sA;
    const key = `${lo}|${hi}`;
    const prev = pairMinDist.get(key);
    if (prev === undefined || d < prev) pairMinDist.set(key, d);
  }

  const distToSim = d => (d <= 0.72 ? Math.max(0, Math.min(1, 1 - (d - 0.25) / 0.55)) : 0);

  const simH5414G1325 = distToSim(pairMinDist.get('G1325|H5414') ?? 1);
  const simH0157G0025 = distToSim(pairMinDist.get('G0025|H0157') ?? 1);
  if (!(simH5414G1325 > 0.60 && simH0157G0025 > 0.60)) {
    throw new Error(`Proximity.tsv polarity check failed: H5414-G1325=${simH5414G1325}, H0157-G0025=${simH0157G0025}`);
  }

  // Build BRV4SIM\0 table & neighbor map
  const strongsSet = new Set();
  const proxPairs = [];
  const proxNeighbors = new Map(); // bs -> Array<{ bs, sim }>

  for (const [key, d] of pairMinDist.entries()) {
    const sim = distToSim(d);
    if (sim <= 0) continue;
    const simQ8 = Math.min(255, Math.max(1, Math.round(sim * 255)));
    const sep = key.indexOf('|');
    const lo = key.slice(0, sep);
    const hi = key.slice(sep + 1);
    strongsSet.add(lo);
    strongsSet.add(hi);
    proxPairs.push({ lo, hi, simQ8 });

    if (!proxNeighbors.has(lo)) proxNeighbors.set(lo, []);
    if (!proxNeighbors.has(hi)) proxNeighbors.set(hi, []);
    proxNeighbors.get(lo).push({ bs: hi, sim });
    proxNeighbors.get(hi).push({ bs: lo, sim });
  }

  // Also include lexicon Strong's keys if needed, keeping <= 65535
  const idxToStrongs = [...strongsSet].sort();
  if (idxToStrongs.length > 65535) {
    throw new Error(`pred-sim numStrongs ${idxToStrongs.length} exceeds uint16`);
  }
  const strongsToIdx = new Map(idxToStrongs.map((s, i) => [s, i]));

  const encodedPairs = [];
  for (const p of proxPairs) {
    const iA = strongsToIdx.get(p.lo);
    const iB = strongsToIdx.get(p.hi);
    const loIdx = iA < iB ? iA : iB;
    const hiIdx = iA < iB ? iB : iA;
    encodedPairs.push({ key: ((loIdx << 16) | hiIdx) >>> 0, simQ8: p.simQ8 });
  }
  encodedPairs.sort((a, b) => a.key - b.key);

  const numStrongs = idxToStrongs.length;
  const numPairs = encodedPairs.length;
  const buf = Buffer.alloc(20 + numStrongs * 8 + numPairs * 5);
  for (let i = 0; i < 8; i++) buf[i] = SIM_MAGIC.charCodeAt(i);
  buf.writeUInt32LE(1, 8);
  buf.writeUInt32LE(numStrongs, 12);
  buf.writeUInt32LE(numPairs, 16);

  let pos = 20;
  for (const s of idxToStrongs) {
    buf.write(s.slice(0, 8), pos, 'ascii');
    pos += 8;
  }
  for (const p of encodedPairs) {
    buf.writeUInt32LE(p.key, pos);
    buf[pos + 4] = p.simQ8;
    pos += 5;
  }

  const predSimMeta = writeDual('index/pred-sim.bin', buf);
  return {
    predSimMeta,
    numStrongs,
    numPairs,
    simH5414G1325,
    simH0157G0025,
    proxNeighbors,
    lookupSim(bsA, bsB) {
      if (!bsA || !bsB) return 0;
      if (bsA === bsB) return 1.0;
      const lo = bsA < bsB ? bsA : bsB;
      const hi = bsA < bsB ? bsB : bsA;
      const d = pairMinDist.get(`${lo}|${hi}`);
      return d !== undefined ? distToSim(d) : 0;
    },
  };
}

function loadAdjunctTypes() {
  const arr = JSON.parse(fs.readFileSync(ADJUNCT_PATH, 'utf8'));
  const byHeadId = new Map();
  const byWordId = new Map();
  for (const rec of arr) {
    const ftype = rec.field_type;
    if (!ftype) continue;
    if (rec.node_head) byHeadId.set(rec.node_head, ftype);
    if (rec.words && typeof rec.words === 'object') {
      for (const wid of Object.keys(rec.words)) {
        if (!byWordId.has(wid)) byWordId.set(wid, ftype);
      }
    }
  }
  return { byHeadId, byWordId };
}

function loadGreekWordSenses() {
  const map = new Map();
  const lines = fs.readFileSync(GRK_SENSE_PATH, 'utf8').split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    map.set(line.slice(0, tab).trim(), line.slice(tab + 1).trim());
  }
  return map;
}

const TIPNR_BOOK_MAP = {
  gen: 1, exo: 2, lev: 3, num: 4, deu: 5, jos: 6, jdg: 7, rut: 8,
  '1sa': 9, '2sa': 10, '1ki': 11, '2ki': 12, '1ch': 13, '2ch': 14,
  ezr: 15, neh: 16, est: 17, job: 18, psa: 19, pro: 20, ecc: 21,
  sng: 22, sol: 22, isa: 23, jer: 24, lam: 25, ezk: 26, eze: 26,
  dan: 27, hos: 28, jol: 29, joe: 29, amo: 30, oba: 31, jon: 32,
  mic: 33, nam: 34, nah: 34, hab: 35, zep: 36, hag: 37, zec: 38, mal: 39,
  mat: 40, mrk: 41, mar: 41, luk: 42, jhn: 43, joh: 43, act: 44,
  rom: 45, '1co': 46, '2co': 47, gal: 48, eph: 49, php: 50, phi: 50,
  col: 51, '1th': 52, '2th': 53, '1ti': 54, '2ti': 55, tit: 56, phm: 57,
  heb: 58, jas: 59, jam: 59, '1pe': 60, '2pe': 61, '1jn': 62, '1jo': 62,
  '2jn': 63, '2jo': 63, '3jn': 64, '3jo': 64, jud: 65, jde: 65, rev: 66,
};

function loadTipnr(canonByTuple) {
  const lines = fs.readFileSync(TIPNR_PATH, 'utf8').split(/\r?\n/);
  const byVidBs = new Map(); // "vid:bs" -> { tipnrId, type }
  const bsToTipnrs = new Map(); // bs -> Set<tipnrId>
  const tipnrType = new Map();

  let curId = '';
  let curType = '';
  for (const line of lines) {
    if (!line || line.startsWith('$') || line.startsWith('*') || line.startsWith('@') || line.startsWith('‖') || line.startsWith('=') || line.startsWith(' ')) {
      continue;
    }
    const cols = line.split('\t');
    if (!line.startsWith('–')) {
      const idCol = cols[0] || '';
      if (!idCol.includes('@') || !idCol.includes('=')) {
        curId = '';
        continue;
      }
      curId = idCol.trim();
      curType = (cols[8] || '').trim();
      tipnrType.set(curId, curType);
      continue;
    }

    if (!curId) continue;
    const sig = cols[0] || '';
    if (sig.startsWith('– Total') || sig.includes('LXX')) continue;
    const dStrCol = cols[2] || '';
    const eqIdx = dStrCol.indexOf('=');
    const strongPart = eqIdx >= 0 ? dStrCol.slice(0, eqIdx) : dStrCol;
    const rawStrongs = strongPart.split('«').map(s => normStrongs4(s)).filter(Boolean);
    const refsCol = cols[5] || '';
    if (!rawStrongs.length || !refsCol) continue;

    for (const bs of rawStrongs) {
      if (!bsToTipnrs.has(bs)) bsToTipnrs.set(bs, new Set());
      bsToTipnrs.get(bs).add(curId);
    }

    for (const token of refsCol.split(/[;,]/)) {
      const refStr = token.trim();
      const rm = /^([1-3]?[A-Za-z]{2,3})\.(\d+)\.(\d+)/.exec(refStr);
      if (!rm) continue;
      const bid = TIPNR_BOOK_MAP[rm[1].toLowerCase()];
      if (!bid) continue;
      const vid = canonByTuple.get(`${bid}:${Number(rm[2])}:${Number(rm[3])}`);
      if (!vid) continue;
      for (const bs of rawStrongs) {
        const k = `${vid}:${bs}`;
        if (!byVidBs.has(k)) byVidBs.set(k, { tipnrId: curId, type: curType });
      }
    }
  }

  const unambigBsToTipnr = new Map();
  for (const [bs, set] of bsToTipnrs.entries()) {
    if (set.size === 1) {
      const id = [...set][0];
      unambigBsToTipnr.set(bs, { tipnrId: id, type: tipnrType.get(id) || '' });
    }
  }

  return {
    lookup(vid, bs) {
      return byVidBs.get(`${vid}:${bs}`) || unambigBsToTipnr.get(bs) || null;
    },
  };
}

function loadOewnAndArchetypes(lexicon, ontology, lxxAlign, proxNeighbors) {
  const verbSynsets = new Map();
  const nounDomainBySynId = new Map();
  const oewnFiles = fs.readdirSync(OEWN_DIR).filter(f => f.endsWith('.json'));

  for (const f of oewnFiles) {
    if (!f.startsWith('verb.') && !f.startsWith('noun.')) continue;
    const domainName = f.replace(/\.json$/, '');
    const data = JSON.parse(fs.readFileSync(path.join(OEWN_DIR, f), 'utf8'));
    for (const [sid, s] of Object.entries(data)) {
      if (f.startsWith('verb.')) {
        verbSynsets.set(sid, {
          id: sid,
          domain: domainName,
          members: s.members || [],
          hypernym: s.hypernym || [],
          causes: s.causes || [],
          entails: s.entails || [],
          def: (s.definition || [])[0] || '',
        });
      } else {
        nounDomainBySynId.set(sid, domainName);
      }
    }
  }

  // Keyword/hypernym rules mapping OEWN domains + glosses -> 28 EventArchetypes
  const ARCH_RULES = [
    ['EMIT_SEND', /\b(send|emit|dispatch|pour|shed|issue|dispatch|release|send out|send forth|send away|dismiss)\b/i],
    ['RETURN_TURN', /\b(return|turn back|turn around|repent|restore back|go back|come back|turn aside|turn toward|return)\b/i],
    ['ASCEND_ELEVATE', /\b(ascend|go up|climb|rise|arise|exalt|lift up|raise|elevate|mount|soar)\b/i],
    ['DESCEND_HUMBLE', /\b(descend|go down|come down|fall|drop|sink|humble|bow down|prostrate|lower|cast down)\b/i],
    ['MOVE_DIRECTED', /\b(go|come|walk|march|travel|flee|run|enter|depart|approach|follow|pursue|cross|pass|bring|lead|carry)\b/i],
    ['CREATE_MAKE', /\b(create|make|form|fashion|build|construct|establish|appoint|work|accomplish|perform|do|prepare)\b/i],
    ['BEAR_PRODUCE', /\b(bear|give birth|beget|sprout|grow|bud|blossom|flourish|multiply|produce|yield|fruit|germinate)\b/i],
    ['DESTROY_STRIKE', /\b(destroy|strike|smite|kill|slay|break|crush|cut off|shatter|burn|consume by fire|ruin|overthrow|perish|tear down|shatter)\b/i],
    ['HEAL_RESTORE', /\b(heal|cure|restore|save|deliver|rescue|redeem|cleanse|purify|wash|revive|mend|bind up|comfort)\b/i],
    ['TRANSFORM_CHANGE', /\b(transform|change|turn into|become|alter|renew|corrupt|defile|harden|melt)\b/i],
    ['GIVE_TRANSFER', /\b(give|grant|bestow|hand over|deliver over|impart|entrust|assign|distribute|pay|reward|bless)\b/i],
    ['TAKE_SEIZE', /\b(take|seize|grasp|capture|receive|accept|obtain|gather in|snatch|plunder|inherit|possess)\b/i],
    ['CAST_PLACE', /\b(cast|throw|hurl|fling|put|place|set|lay|plant|sow|bury|pour out|sprinkle)\b/i],
    ['SEPARATE_DIVIDE', /\b(separate|divide|split|scatter|disperse|cast out|drive out|banish|cut|sever|distinguish|forsake|leave)\b/i],
    ['JOIN_GATHER', /\b(join|gather|assemble|collect|unite|cling|cleave|attach|graft|bind together|meet)\b/i],
    ['COVER_PROTECT', /\b(cover|protect|shield|guard|keep|watch|hide|shelter|defend|surround|clothe|anoint)\b/i],
    ['SPEAK_DECLARE', /\b(speak|say|tell|declare|proclaim|announce|preach|answer|reply|report|prophesy|teach|confess|name)\b/i],
    ['COMMAND_DIRECT', /\b(command|order|charge|instruct|warn|forbid|send word|commission|decree|ordain)\b/i],
    ['APPEAL_CRY', /\b(cry|call out|pray|implore|beseech|beg|entreat|ask|seek|plead|weep|lament|groan|sigh)\b/i],
    ['PERCEIVE_WITNESS', /\b(see|look|behold|watch|observe|hear|listen|witness|testify|appear|reveal|show)\b/i],
    ['KNOW_REMEMBER', /\b(know|understand|perceive|discern|remember|forget|think|consider|meditate|believe|trust|recognize)\b/i],
    ['TEST_JUDGE', /\b(test|try|prove|assay|examine|judge|condemn|acquit|vindicate|punish|avenge|rebuke|reprove|discipline)\b/i],
    ['COVENANT_BIND', /\b(covenant|swear|vow|promise|pledge|betroth|marry|bind|seal|ratify|reconcile)\b/i],
    ['VIOLATE_SIN', /\b(sin|transgress|rebel|disobey|trespass|wicked|betray|deceive|lie|steal|commit adultery|idol|forsake)\b/i],
    ['CONSUME_NOURISH', /\b(eat|drink|feed|nourish|satisfy|water|saturate|taste|fast|hunger|thirst|devour|swallow)\b/i],
    ['WORSHIP_OFFER', /\b(worship|bow|praise|sing|rejoice|thank|offer|sacrifice|burn incense|minister|serve|hallow|sanctify)\b/i],
    ['LIVE_DIE', /\b(live|survive|breathe|dwell|abide|remain|sleep|wake|die|expire|perish|rise from dead)\b/i],
    ['EXIST_EQUATE', /\b(be|exist|become|remain|stand|sit|lie|have|lack|nothing)\b/i],
  ];

  const OEWN_DOMAIN_FALLBACK = {
    'verb.motion': 'MOVE_DIRECTED',
    'verb.communication': 'SPEAK_DECLARE',
    'verb.perception': 'PERCEIVE_WITNESS',
    'verb.cognition': 'KNOW_REMEMBER',
    'verb.consumption': 'CONSUME_NOURISH',
    'verb.creation': 'CREATE_MAKE',
    'verb.change': 'TRANSFORM_CHANGE',
    'verb.contact': 'DESTROY_STRIKE',
    'verb.possession': 'GIVE_TRANSFER',
    'verb.social': 'COVENANT_BIND',
    'verb.emotion': 'APPEAL_CRY',
    'verb.body': 'LIVE_DIE',
    'verb.stative': 'EXIST_EQUATE',
    'verb.competition': 'DESTROY_STRIKE',
    'verb.weather': 'EMIT_SEND',
  };

  function classifyDirectArchetype(bs, oewnId, glossStr) {
    // 1. Check high-signal gloss/OEWN members first (with POS gating)
    const syn = oewnId ? verbSynsets.get(oewnId.replace(/^oewn:/, '')) : null;
    const text = [glossStr || '', syn ? syn.members.join(' ') : '', syn ? syn.def : ''].join(' ');
    for (const [arch, re] of ARCH_RULES) {
      if (re.test(text)) return arch;
    }
    if (syn && OEWN_DOMAIN_FALLBACK[syn.domain]) {
      return OEWN_DOMAIN_FALLBACK[syn.domain];
    }
    return null;
  }

  // Initial vote per verbal bs
  const bsToMappedSense = new Map();
  for (const ms of Object.values(ontology.mapped_senses || {})) {
    const bs = normStrongs4(ms.bs);
    if (bs && !bsToMappedSense.has(bs)) bsToMappedSense.set(bs, ms);
  }

  const initialArch = new Map();
  const bsCausativeOewn = new Set();
  for (const [bsRaw, prof] of Object.entries(lexicon.profiles || {})) {
    const bs = normStrongs4(bsRaw);
    if (!bs) continue;
    const pos = String(prof.pos || '');
    const ms = bsToMappedSense.get(bs);
    const oewnId = ms?.oewn_id || null;
    if (oewnId && oewnId.endsWith('-v')) {
      const syn = verbSynsets.get(oewnId.replace(/^oewn:/, ''));
      if (syn && syn.causes && syn.causes.length > 0) bsCausativeOewn.add(bs);
    }
    const isVerbPos = /verb|V:/i.test(pos) || (oewnId && oewnId.endsWith('-v'));
    if (!isVerbPos) continue;
    const a = classifyDirectArchetype(bs, oewnId, prof.gl || ms?.gl || '');
    if (a) initialArch.set(bs, a);
  }

  // Rahlfs LXX bridge map (H_bs -> Set<G_bs>)
  const grkLemmaToBs = new Map();
  for (const [bsRaw, prof] of Object.entries(lexicon.profiles || {})) {
    const bs = normStrongs4(bsRaw);
    if (bs && bs.startsWith('G') && prof.sc) {
      const n = normS3(prof.sc);
      if (n && !grkLemmaToBs.has(n)) grkLemmaToBs.set(n, bs);
    }
  }
  const lxxBridge = new Map(); // bs -> Map<targetBs, count>
  for (const av of lxxAlign.verses || []) {
    for (const l of av.links || []) {
      const hBs = normStrongs4(l.h_bs);
      const gBs = grkLemmaToBs.get(normS3(l.g_lemma));
      if (!hBs || !gBs) continue;
      if (!lxxBridge.has(hBs)) lxxBridge.set(hBs, new Map());
      lxxBridge.get(hBs).set(gBs, (lxxBridge.get(hBs).get(gBs) || 0) + 1);
    }
  }

  // Neighborhood majority vote over Proximity.tsv + LXX links (solves gloss-homograph misclassifications like H7725)
  const finalArch = new Map();
  for (const [bs, initA] of initialArch.entries()) {
    const votes = new Map([[initA, 1.4]]);
    for (const nb of proxNeighbors.get(bs) || []) {
      const nbA = initialArch.get(nb.bs);
      if (nbA) votes.set(nbA, (votes.get(nbA) || 0) + nb.sim * 1.2);
    }
    const lxxMap = lxxBridge.get(bs);
    if (lxxMap) {
      for (const [gBs, cnt] of lxxMap.entries()) {
        const gA = initialArch.get(gBs);
        if (gA) votes.set(gA, (votes.get(gA) || 0) + Math.min(1.5, cnt * 0.25));
      }
    }
    let bestA = initA;
    let bestScore = -1;
    for (const [a, sc] of votes.entries()) {
      if (sc > bestScore) {
        bestScore = sc;
        bestA = a;
      }
    }
    finalArch.set(bs, bestA);
  }

  return {
    verbSynsets,
    nounDomainBySynId,
    bsCausativeOewn,
    getArchetype(bs, glossFallback = '') {
      const hit = finalArch.get(bs);
      if (hit) return hit;
      const direct = classifyDirectArchetype(bs, null, glossFallback);
      return direct || 'EXIST_EQUATE';
    },
  };
}

// =============================================================================
// 4. Pure Node.js License-Gated MACULA XML Parser & S1/S2/S4 Clause Extractor
// =============================================================================

const ATTR_RE = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
const TAG_RE = /<(\/)?([a-zA-Z0-9_:]+)([^>]*?)(\/)?>|([^<]+)/g;

function decodeXmlEntities(s) {
  if (!s || !s.includes('&')) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseMaculaXml(xmlText, isGreek) {
  const forbidden = isGreek ? GRK_FORBIDDEN_ATTRS : HEB_FORBIDDEN_ATTRS;
  const root = { tag: 'root', attrs: {}, children: [], text: '' };
  const stack = [root];
  TAG_RE.lastIndex = 0;

  let m;
  while ((m = TAG_RE.exec(xmlText)) !== null) {
    const isClose = Boolean(m[1]);
    const tag = m[2];
    const rawAttrs = m[3];
    const isSelf = Boolean(m[4]);
    const txt = m[5];

    if (txt !== undefined) {
      const trimmed = txt.trim();
      if (trimmed) {
        const top = stack[stack.length - 1];
        top.text = top.text ? `${top.text} ${trimmed}` : trimmed;
      }
      continue;
    }

    if (tag.startsWith('?')) continue;

    if (isClose) {
      if (stack.length > 1 && stack[stack.length - 1].tag === tag) {
        stack.pop();
      }
      continue;
    }

    const attrs = {};
    if (rawAttrs) {
      ATTR_RE.lastIndex = 0;
      let am;
      while ((am = ATTR_RE.exec(rawAttrs)) !== null) {
        const k = am[1];
        if (forbidden.has(k)) continue;
        // For Greek XML, allow reading Clear `frame` ONLY into internal `clearArgs` (never stored under `frame`!)
        if (isGreek && k === 'frame') {
          attrs.clearArgs = am[2];
          continue;
        }
        attrs[k] = decodeXmlEntities(am[2]);
      }
    }

    const node = { tag, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!isSelf) stack.push(node);
  }
  return root;
}

const GREEK_CLASS_MAP = { conj: 'cj', det: 'art' };
const GREEK_PERSON_MAP = { αυτος: 'third', εγω: 'first', συ: 'second' };
const FUNCTION_CLASSES = new Set(['cj', 'rel', 'prep', 'ptcl', 'art']);
const OPENER_CLASSES = new Set(['cj', 'rel', 'prep', 'ptcl']);
const OPENER_AND_ADV = new Set(['cj', 'rel', 'prep', 'ptcl', 'adv']);
const NOT_A_VERB_FORM = new Set([
  'common', 'proper', 'adjective', 'relative', 'demonstrative', 'interjection',
  'gentilic', 'personal', 'cardinal', 'ordinal',
]);
const FINITE_VERB_FORMS = new Set([
  'qatal', 'yiqtol', 'wayyiqtol', 'weqatal', 'imperative', 'jussive', 'cohortative',
  'indicative', 'subjunctive', 'optative',
]);
const HEB_CONJ_MAP = {
  p: 'qatal', q: 'weqatal', i: 'yiqtol', w: 'wayyiqtol', v: 'imperative',
  j: 'jussive', h: 'cohortative', r: 'participle', s: 'participle',
  c: 'infinitive construct', a: 'infinitive absolute',
};
const COMPLEX_RULES = new Set(['ClCl', 'ClCl2', 'Conj-CL', 'CLaCL', 'aCLaCL']);
const CONTRAST_LEMMAS = new Set(['αλλα', 'πλην', 'ברם', 'להן']);

function parseFileWithS1S2S4(xmlRoot, isGreek, headsBundle, adjuncts, greekSenses, usfmToBookId, mtTupleToVids, canonByTuple, verseTuples) {
  const langKey = isGreek ? 'greek' : 'hebrew';
  const headsCfg = headsBundle[langKey].heads;
  const compatCfg = headsBundle.compatibility_extensions?.[langKey] || {};
  const coordSet = new Set(headsCfg.coord || []);
  const firstMap = { ...(headsCfg.head_first || {}), ...(compatCfg.head_first || {}) };
  const lastMap = { ...(headsCfg.head_last || {}), ...(compatCfg.head_last || {}) };
  const prepSet = new Set(headsCfg.prep || []);
  const wrapSet = new Set(headsCfg.wrap || []);

  const lexCfg = headsBundle[langKey].lexicon;
  const forceMap = lexCfg.force_by_verb_type || { _default: 'assertion' };
  const subjunctiveMain = lexCfg.subjunctive_main || null;
  const qTypes = new Set(lexCfg.question_types || []);
  const qLemmas = new Set((lexCfg.question_lemmas || []).map(normS3));
  const qPunct = lexCfg.question_punctuation || null;
  const negTypes = new Set(lexCfg.negative_types || []);
  const negLemmas = new Set((lexCfg.negative_lemmas || []).map(normS3));
  const subordinators = new Set((lexCfg.subordinators || []).map(normS3));
  const speechSet = new Set((lexCfg.speech_verbs || []).map(normS3));
  const perceiveSet = new Set((lexCfg.perceive_verbs || []).map(normS3));
  const narrativeMoods = new Set(lexCfg.narrative_moods || ['wayyiqtol']);
  const headingWords = new Set((lexCfg.heading_words || []).map(normS3));

  const wordsById = new Map();
  const wordsByBareId = new Map(); // without leading 'o' or 'n' if needed
  const posByRef = new Map();
  const negOnlyPositions = new Set();

  function resolveVerseIds(refStr) {
    const m = /^([A-Z0-9]+)\s+(\d+):(\d+)$/.exec(refStr);
    if (!m) return [];
    const bid = usfmToBookId.get(m[1]);
    if (!bid) return [];
    const ch = Number(m[2]);
    const vs = Number(m[3]);
    if (!isGreek) {
      const mtHits = mtTupleToVids.get(`${bid}:${ch}:${vs}`);
      if (mtHits && mtHits.length) return mtHits;
    }
    const cHit = canonByTuple.get(`${bid}:${ch}:${vs}`);
    return cHit ? [cHit] : [];
  }

  function indexWords(node) {
    if (node.tag === 'w') {
      const a = node.attrs;
      const rawRef = a.ref || '';
      const vref = rawRef.split('!')[0];
      const wid = a['xml:id'];
      if (vref && wid) {
        const pos = posByRef.get(vref) || 0;
        posByRef.set(vref, pos + 1);
        const rec = { ...a };
        rec.id = wid;
        rec.ref = rawRef;
        rec.verse_ref = vref;
        rec.pos_in_verse = pos;
        rec.text = node.text || '';
        rec.after = a.after || '';
        rec.morph = a.morph || '';
        rec.vids = resolveVerseIds(vref);

        if (isGreek) {
          rec.lang = 'G';
          if (rec.strong && !rec.strongnumberx) rec.strongnumberx = rec.strong;
          rec.class = GREEK_CLASS_MAP[rec.class] || rec.class;
          if (rec.class === 'verb' && rec.mood) rec.type = rec.mood;
          if (rec.class === 'pron' && !rec.person) {
            const gp = GREEK_PERSON_MAP[normS3(rec.lemma)];
            if (gp) rec.person = gp;
          }
          if (!rec.sensenumber && greekSenses.has(wid)) {
            rec.sensenumber = greekSenses.get(wid);
          }
          const adj = adjuncts.byHeadId.get(wid) || adjuncts.byWordId.get(wid);
          if (adj) rec.adjunctType = adj;
          const nl = normS3(rec.lemma);
          if (nl === 'μονον' || nl === 'μονος') negOnlyPositions.add(`${vref}#${pos}`);
        } else {
          rec.lang = a.lang || 'H';
          if (rec.class === 'verb') {
            if (!rec.type && rec.morph.length >= 3 && rec.morph.startsWith('V')) {
              const t = HEB_CONJ_MAP[rec.morph[2]];
              if (t) rec.type = t;
            }
            if (!rec.mood) rec.mood = rec.type;
          }
        }
        rec.bs = normStrongs4(rec.strongnumberx, rec.lang);
        rec.lemmaNorm = normS3(rec.lemma);
        wordsById.set(wid, rec);
        wordsByBareId.set(wid.replace(/^[on]/, ''), rec);
      }
      return;
    }
    for (const ch of node.children) indexWords(ch);
  }
  indexWords(xmlRoot);

  function isNegativeWord(w) {
    if (!w) return false;
    const lem = w.lemma || '';
    if (lem.normalize('NFD').includes('\u0314')) return false; // Greek rough-breathing οὗ guard
    if (negTypes.has(w.type || '')) return true;
    if (negLemmas.has(normS3(lem))) return true;
    if (w.morph === 'Tn') return true;
    return false;
  }

  function isNotOnly(w) {
    if (!w || !w.verse_ref) return false;
    for (let k = 1; k <= 4; k++) {
      if (negOnlyPositions.has(`${w.verse_ref}#${w.pos_in_verse + k}`)) return true;
    }
    return false;
  }

  function isFn(elem, allowed = FUNCTION_CLASSES) {
    if (elem.tag !== 'w') return false;
    const rec = wordsById.get(elem.attrs['xml:id']);
    if (!rec) return false;
    return allowed.has(rec.class) || rec.type === 'interrogative';
  }

  function getRule(elem) {
    return elem.attrs.rule || elem.attrs.Rule || '';
  }

  function isV2clWord(elem) {
    return (
      elem.tag === 'w' &&
      (elem.attrs.role === 'v' || elem.attrs.role === 'vc') &&
      (getRule(elem) === 'v2cl' || getRule(elem) === 'vc2cl')
    );
  }

  function isComplex(elem) {
    if (elem.tag !== 'wg') return false;
    const cls = elem.attrs.class;
    if (cls !== undefined && cls !== 'cl') return false;
    const kids = elem.children;
    const rule = getRule(elem);
    if (kids.some(ch => ch.attrs.role)) {
      if (!COMPLEX_RULES.has(rule)) return false;
      let count = 0;
      for (const ch of kids) {
        if (isV2clWord(ch)) count++;
        else if (ch.tag === 'wg' && (ch.attrs.class === 'cl' || isComplex(ch))) count++;
        else if (ch.tag === 'w' && isFn(ch, OPENER_AND_ADV)) continue;
        else if (ch.tag === 'wg' && ch.attrs.class === 'cjp') continue;
        else return false;
      }
      return count >= 2;
    }
    let hasCl = false;
    for (const ch of kids) {
      if (ch.tag === 'w') {
        if (isV2clWord(ch)) hasCl = true;
        else if (!isFn(ch, OPENER_AND_ADV)) return false;
      } else if (ch.attrs.class === 'cl' || isComplex(ch)) {
        hasCl = true;
      } else if (ch.attrs.class !== 'cjp') {
        return false;
      }
    }
    return hasCl;
  }

  function unwrapConjunct(elem) {
    if (elem.tag !== 'wg' || elem.attrs.type !== 'group' || getRule(elem)) return elem;
    const rest = elem.children.filter(x => {
      if (x.tag !== 'w') return true;
      const rec = wordsById.get(x.attrs['xml:id']);
      return !(isFn(x, new Set(['cj'])) || rec?.lemma === 'καί' || rec?.lemma === 'ἤ');
    });
    return rest.length === 1 && rest.length < elem.children.length ? rest[0] : elem;
  }

  function iterWords(elem, out = []) {
    if (elem.tag === 'w') {
      const rec = wordsById.get(elem.attrs['xml:id']);
      if (rec) out.push(rec);
    } else {
      for (const ch of elem.children) iterWords(ch, out);
    }
    return out;
  }

  function resolveHeads(elem, topSpan = null, isCoord = false, prepLemmas = [], prepWords = [], coordGroupId = null) {
    if (!topSpan) topSpan = iterWords(elem).map(w => w.id);
    if (elem.tag === 'w') {
      const rec = wordsById.get(elem.attrs['xml:id']);
      if (!rec) return [];
      return [{
        word: rec,
        isClausal: false,
        isCoordinated: isCoord,
        coordGroupId,
        tokenSpan: topSpan,
        prepLemmas: [...prepLemmas],
        prepWords: [...prepWords],
      }];
    }
    if (elem.attrs.class === 'cl' || isComplex(elem)) {
      return [{
        word: null,
        isClausal: true,
        isCoordinated: isCoord,
        coordGroupId,
        tokenSpan: iterWords(elem).map(w => w.id),
        prepLemmas: [...prepLemmas],
        prepWords: [...prepWords],
      }];
    }
    const kids = elem.children;
    const rule = getRule(elem);
    if (!kids.length) return [];
    if (kids.length === 1) {
      return resolveHeads(kids[0], topSpan, isCoord, prepLemmas, prepWords, coordGroupId);
    }
    if (coordSet.has(rule)) {
      const cgid = coordGroupId || `coord:${topSpan[0] || ''}:${rule}`;
      const res = [];
      for (const rk of kids) {
        const k = unwrapConjunct(rk);
        if (k.tag === 'w' && isFn(k, new Set(['cj']))) continue;
        res.push(...resolveHeads(k, topSpan, true, prepLemmas, prepWords, cgid));
      }
      return res;
    }
    if (prepSet.has(rule)) {
      const marked = kids.filter(k => k.attrs.head === 'true');
      const obj = marked[0] || kids[kids.length - 1];
      const nextPrepL = [...prepLemmas];
      const nextPrepW = [...prepWords];
      for (const k of kids) {
        if (k === obj || k.tag !== 'w') continue;
        const kr = wordsById.get(k.attrs['xml:id']);
        if (kr && (kr.class === 'prep' || kr.pos === 'preposition')) {
          const pl = normS3(kr.lemma);
          if (pl && !nextPrepL.includes(pl)) nextPrepL.push(pl);
          nextPrepW.push(kr);
        }
      }
      return resolveHeads(obj, topSpan, isCoord, nextPrepL, nextPrepW, coordGroupId);
    }

    const markedIdx = kids.findIndex(k => k.attrs.head === 'true');
    let headIdx = 0;
    let verified = true;
    if (markedIdx >= 0) headIdx = markedIdx;
    else if (rule in lastMap) headIdx = kids.length - 1;
    else if (rule in firstMap) headIdx = 0;
    else if (wrapSet.has(rule)) {
      const nonFn = kids.map((k, i) => ({ k, i })).filter(x => !(x.k.tag === 'w' && isFn(x.k)));
      headIdx = nonFn.length === 1 ? nonFn[0].i : 0;
      if (nonFn.length !== 1) verified = false;
    } else {
      verified = false;
    }

    if (kids[headIdx]?.tag === 'w' && wordsById.get(kids[headIdx].attrs['xml:id'])?.class === 'art') {
      const nonArt = kids.findIndex((k, i) => i > headIdx && !(k.tag === 'w' && isFn(k)));
      if (nonArt >= 0) headIdx = nonArt;
    }

    const res = resolveHeads(kids[headIdx], topSpan, isCoord, prepLemmas, prepWords, coordGroupId);
    if (res.length && res[0].isClausal && verified) {
      const wi = kids.findIndex((k, i) => i !== headIdx && k.tag === 'w' && (!isFn(k) || wordsById.get(k.attrs['xml:id'])?.type === 'interrogative'));
      if (wi >= 0) return resolveHeads(kids[wi], topSpan, isCoord, prepLemmas, prepWords, coordGroupId);
    }
    return res;
  }

  // Extract sentences -> clauses in document order
  const sentences = [];
  function findSentences(node) {
    if (node.tag === 'sentence') {
      sentences.push(node);
      return;
    }
    for (const ch of node.children) findSentences(ch);
  }
  findSentences(xmlRoot);

  const allClauses = [];
  const clauseCounters = new Map();
  let seenSpeechInFile = false;

  for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
    const sent = sentences[sIdx];
    const sentClauses = [];
    const s3Links = []; // intra-sentence nesting / connective links

    function collectDirectWords(clElem, excludedSet) {
      const direct = [];
      function walk(n) {
        for (const ch of n.children) {
          if (excludedSet.has(ch)) continue;
          if (ch.tag === 'w') {
            const rec = wordsById.get(ch.attrs['xml:id']);
            if (rec) direct.push(rec);
          } else if (ch.tag === 'wg') {
            if (ch.attrs.class === 'cl' || isComplex(ch)) continue;
            walk(ch);
          }
        }
      }
      walk(clElem);
      return direct;
    }

    function nextCid(vref) {
      const k = clauseCounters.get(vref) || 0;
      clauseCounters.set(vref, k + 1);
      return { k, cid: `${vref}#cl${k}` };
    }

    function buildV2cl(wElem, parentCid, pendingOpeners, wrappingNeg, roleInParent, prepContext) {
      const rec = wordsById.get(wElem.attrs['xml:id']);
      if (!rec) return null;
      const { k, cid } = nextCid(rec.verse_ref);
      const rawRole = wElem.attrs.role || 'v';
      const vHead = { word: rec, isClausal: false, isCoordinated: false, tokenSpan: [rec.id], prepLemmas: [], prepWords: [] };
      const resolvedRoles = { [rawRole]: [vHead] };
      const negSignals = [];
      if (wrappingNeg) negSignals.push('wrapping_neg');
      if (isNegativeWord(rec) && !isNotOnly(rec)) negSignals.push(rec.id);

      let vt = rec.type;
      if (NOT_A_VERB_FORM.has(vt)) vt = null;
      let force = forceMap[vt || ''] || forceMap._default;
      if (vt === 'subjunctive' && subjunctiveMain && !parentCid && !pendingOpeners.some(o => subordinators.has(normS3(o.lemma)))) {
        force = subjunctiveMain;
      }

      const qSignals = [];
      for (const o of pendingOpeners) {
        if (qTypes.has(o.type) || qLemmas.has(normS3(o.lemma))) qSignals.push(o.id);
      }
      if (qTypes.has(rec.type) || qLemmas.has(normS3(rec.lemma))) qSignals.push(rec.id);
      if (qPunct && (rec.after || '').includes(qPunct)) qSignals.push('punct:;');

      const cl = {
        cid,
        vref: rec.verse_ref,
        vids: rec.vids,
        parentCid,
        roleInParent: roleInParent || 'v2cl',
        clauseKind: rawRole === 'v' ? 'verbal' : 'copular',
        resolvedRoles,
        predWord: rec,
        verbForm: vt,
        verbStem: rec.stem || '',
        voice: rec.voice || 'unknown',
        forceKind: force,
        negated: negSignals.length > 0,
        hasQuestion: qSignals.length > 0,
        openers: pendingOpeners,
        prepContext: prepContext || [],
        directWords: [rec],
        allWords: [rec],
        speechQuoted: false,
        speechParentCid: null,
        speakerScope: 'unknown',
      };
      sentClauses.push(cl);
      return cl;
    }

    function walkContainer(container, parentCid, pendingOpeners, wrappingNeg, roleInParent, keepInherited, preferNodeRole, prepContext) {
      const inherited = [...pendingOpeners];
      let localOpeners = [...inherited];
      let localNeg = wrappingNeg;
      let prevChildCl = null;

      for (const ch of container.children) {
        if (isV2clWord(ch)) {
          const cr = ch.attrs.role || roleInParent || 'v2cl';
          const cl = buildV2cl(ch, parentCid, localOpeners, localNeg, cr, prepContext);
          if (cl && prevChildCl) {
            s3Links.push({ fromCid: prevChildCl.cid, toCid: cl.cid, openers: localOpeners, kind: 'sibling' });
          }
          if (cl) prevChildCl = cl;
          localOpeners = keepInherited ? [...inherited] : [];
          localNeg = wrappingNeg;
        } else if (ch.tag === 'w') {
          const r = wordsById.get(ch.attrs['xml:id']);
          if (r) {
            if (isNegativeWord(r) && !isNotOnly(r)) localNeg = true;
            else if (CONTRAST_LEMMAS.has(normS3(r.lemma))) localNeg = false;
            if (isFn(ch, OPENER_AND_ADV)) localOpeners.push(r);
          }
        } else if (ch.tag === 'wg' && ch.attrs.class === 'cjp') {
          for (const w of iterWords(ch)) {
            if (CONTRAST_LEMMAS.has(normS3(w.lemma))) localNeg = false;
            localOpeners.push(w);
          }
        } else if (ch.tag === 'wg') {
          const cr = preferNodeRole ? (container.attrs.role || roleInParent) : (ch.attrs.role || roleInParent);
          const firstCl = visitWg(ch, parentCid, localOpeners, localNeg, cr, prepContext);
          if (firstCl && prevChildCl) {
            s3Links.push({ fromCid: prevChildCl.cid, toCid: firstCl.cid, openers: localOpeners, kind: 'sibling' });
          }
          if (firstCl) prevChildCl = firstCl;
          localOpeners = keepInherited ? [...inherited] : [];
          localNeg = wrappingNeg;
        }
      }
      return prevChildCl;
    }

    function visitWg(node, parentCid, pendingOpeners, wrappingNeg, roleInParent, prepContext = []) {
      if (node.tag !== 'wg') return null;
      if (isComplex(node)) {
        return walkContainer(node, parentCid, pendingOpeners, wrappingNeg, roleInParent, true, true, prepContext);
      }
      if (node.attrs.class === 'cl') {
        const ws = iterWords(node);
        if (!ws.length) return null;
        const firstVref = ws[0].verse_ref;
        const { cid } = nextCid(firstVref);

        const directV = node.children.filter(c => c.attrs.role === 'v' || c.attrs.role === 'vc');
        const subV2cl = directV.filter(isV2clWord);
        const primaryV = directV.filter(c => !isV2clWord(c));
        const detachedV2cl = primaryV.length && subV2cl.length ? subV2cl : [];
        const excluded = new Set(detachedV2cl);

        const directWords = collectDirectWords(node, excluded);
        const childOpeners = [...pendingOpeners];
        const resolvedRoles = {};

        for (const ch of node.children) {
          if (excluded.has(ch)) continue;
          const rAttr = ch.attrs.role;
          if (ch.tag === 'w' && !rAttr && isFn(ch, OPENER_CLASSES)) {
            const r = wordsById.get(ch.attrs['xml:id']);
            if (r) childOpeners.push(r);
            continue;
          }
          if (ch.tag === 'wg' && ch.attrs.class === 'cjp' && !rAttr) {
            childOpeners.push(...iterWords(ch));
            continue;
          }
          if (rAttr) {
            const hs = resolveHeads(ch);
            if (!resolvedRoles[rAttr]) resolvedRoles[rAttr] = [];
            resolvedRoles[rAttr].push(...hs);
          }
        }

        let negated = wrappingNeg;
        for (const w of directWords) {
          if (isNegativeWord(w) && !isNotOnly(w)) {
            negated = true;
            break;
          }
        }

        const vHeads = (resolvedRoles.v || []).filter(h => h.word !== null);
        const vcHeads = (resolvedRoles.vc || []).filter(h => h.word !== null);
        const pHeads = resolvedRoles.p || [];
        let predWord = null;
        if (vHeads.length === 1) predWord = vHeads[0].word;
        else if (vHeads.length > 1) {
          const fin = vHeads.filter(h => FINITE_VERB_FORMS.has(h.word.type || ''));
          predWord = (fin[0] || vHeads[0]).word;
        } else if (vcHeads.length) {
          predWord = vcHeads[0].word;
        }

        const clauseKind = vHeads.length ? 'verbal' : vcHeads.length ? 'copular' : pHeads.length ? 'verbless' : 'other';
        let vt = predWord?.type || null;
        if (NOT_A_VERB_FORM.has(vt)) vt = null;
        let force = forceMap[vt || ''] || forceMap._default;
        if (vt === 'subjunctive' && subjunctiveMain && !parentCid && !childOpeners.some(o => subordinators.has(normS3(o.lemma)))) {
          force = subjunctiveMain;
        }

        const qSignals = [];
        for (const o of childOpeners) {
          if (qTypes.has(o.type) || qLemmas.has(normS3(o.lemma))) qSignals.push(o.id);
        }
        for (const w of directWords) {
          if (qTypes.has(w.type) || qLemmas.has(normS3(w.lemma))) qSignals.push(w.id);
        }
        if (qPunct && directWords.some(w => (w.after || '').includes(qPunct))) qSignals.push('punct:;');

        // Determine canonical vid(s) for this clause (handling Psalm :0 headings sharing MT :1)
        let clauseVids = ws[0].vids;
        if (clauseVids.length > 1 && verseTuples[clauseVids[0]]?.[0] === 19 && verseTuples[clauseVids[0]]?.[2] === 0) {
          const isHeading = directWords.some(w => headingWords.has(normS3(w.lemma))) ||
            (ws[0].vids === clauseVids && parentCid === null && sentClauses.length === 0 && directWords.some(w => w.bs === 'H1732' || w.bs === 'H4210' || w.bs === 'H5329'));
          clauseVids = isHeading ? [clauseVids[0]] : [clauseVids[1]];
        }

        const cl = {
          cid,
          vref: firstVref,
          vids: clauseVids,
          parentCid,
          roleInParent,
          clauseKind,
          resolvedRoles,
          predWord,
          verbForm: vt,
          verbStem: predWord?.stem || '',
          voice: predWord?.voice || 'unknown',
          forceKind: force,
          negated,
          hasQuestion: qSignals.length > 0,
          openers: childOpeners,
          prepContext: prepContext || [],
          directWords,
          allWords: ws,
          speechQuoted: false,
          speechParentCid: null,
          speakerScope: 'unknown',
        };
        sentClauses.push(cl);

        for (const wCh of detachedV2cl) {
          buildV2cl(wCh, cid, [], false, 'v2cl', []);
        }

        for (const ch of node.children) {
          if (ch.tag !== 'wg' || excluded.has(ch)) continue;
          const chRole = ch.attrs.role || null;
          if (ch.attrs.class === 'cl' || isComplex(ch)) {
            visitWg(ch, cid, [], false, chRole, []);
          } else {
            const walkNested = (pnode, pRole, accPreps) => {
              const curRule = getRule(pnode);
              let nextPreps = accPreps;
              if (prepSet.has(curRule) || curRule === 'PrepCL') {
                const ps = pnode.children
                  .filter(k => k.tag === 'w' && isFn(k, new Set(['prep', 'rel', 'cj'])))
                  .map(k => wordsById.get(k.attrs['xml:id']))
                  .filter(Boolean);
                if (ps.length) nextPreps = [...accPreps, ...ps];
              }
              for (const pk of pnode.children) {
                if (pk.tag !== 'wg') continue;
                if (pk.attrs.class === 'cl' || isComplex(pk)) {
                  visitWg(pk, cid, [], false, pRole, nextPreps);
                } else {
                  walkNested(pk, pRole, nextPreps);
                }
              }
            };
            walkNested(ch, chRole, []);
          }
        }
        return cl;
      }

      return walkContainer(node, parentCid, pendingOpeners, wrappingNeg, roleInParent, false, false, prepContext);
    }

    let prevTopCl = null;
    for (const topWg of sent.children) {
      if (topWg.tag === 'wg') {
        const firstCl = visitWg(topWg, null, [], false, topWg.attrs.role || null, []);
        if (firstCl && prevTopCl) {
          s3Links.push({ fromCid: prevTopCl.cid, toCid: firstCl.cid, openers: firstCl.openers, kind: 'top' });
        }
        if (firstCl) prevTopCl = firstCl;
      }
    }

    // S4 speech-turn scoping
    const byCid = new Map(sentClauses.map(c => [c.cid, c]));
    const topLevel = sentClauses.filter(c => c.parentCid === null);
    for (let i = 0; i < topLevel.length; i++) {
      const c = topLevel[i];
      const pw = c.predWord;
      if (!pw || !speechSet.has(normS3(pw.lemma))) continue;
      for (let j = i + 1; j < topLevel.length; j++) {
        const f = topLevel[j];
        const fpw = f.predWord;
        const fl = normS3(fpw?.lemma);
        const fp = fpw?.person;
        if (speechSet.has(fl) && fp !== 'first' && fp !== 'second') break;
        if (narrativeMoods.has(f.verbForm) && fp === 'third') break;
        f.speechQuoted = true;
        f.speechParentCid = c.cid;
      }
    }
    for (const c of sentClauses) {
      if (!c.parentCid) continue;
      const parent = byCid.get(c.parentCid);
      if (!parent) continue;
      const ppw = parent.predWord;
      if (ppw && speechSet.has(normS3(ppw.lemma)) && c.roleInParent === 'o') {
        c.speechQuoted = true;
        c.speechParentCid = parent.cid;
      } else if (parent.speechQuoted) {
        c.speechQuoted = true;
        c.speechParentCid = parent.speechParentCid;
      }
    }
    const sentWords = sentClauses.flatMap(c => c.directWords);
    const sentHas12 = sentWords.some(w => w.person === 'first' || w.person === 'second');
    if (sentClauses.some(c => c.speechQuoted)) seenSpeechInFile = true;

    for (const c of sentClauses) {
      if (c.speechQuoted) {
        c.speakerScope = 'quoted_speaker';
        continue;
      }
      const pw = c.predWord;
      const pwp = pw?.person;
      const isSp = pw && speechSet.has(normS3(pw.lemma)) && pwp !== 'first' && pwp !== 'second';
      const isTop = c.parentCid === null;
      const isHebWay3 = !isGreek && c.verbForm === 'wayyiqtol' && pwp === 'third';
      const parent = c.parentCid ? byCid.get(c.parentCid) : null;
      if ((isSp && isTop && !sentHas12) || (isHebWay3 && isTop) || (parent?.speakerScope === 'narrator' && pwp !== 'first' && pwp !== 'second')) {
        c.speakerScope = 'narrator';
      } else if (!isGreek && !seenSpeechInFile && !sentHas12 && pwp !== 'first' && pwp !== 'second' && sIdx <= 1) {
        c.speakerScope = 'narrator';
      }
    }

    for (const c of sentClauses) {
      c.s3ParentLinks = s3Links.filter(l => l.toCid === c.cid);
      c.perceiveVerb = Boolean(c.predWord && perceiveSet.has(normS3(c.predWord.lemma)));
      c.speechVerb = Boolean(c.predWord && speechSet.has(normS3(c.predWord.lemma)));
      allClauses.push(c);
    }
  }

  return { wordsById, wordsByBareId, clauses: allClauses };
}

// =============================================================================
// 5. Pericope Segmentation (100% Canonical Coverage, <= 2 Pericopes / Verse)
// =============================================================================

function buildPericopes(verseTuples, clausesByVid) {
  const vidsByChapter = new Map(); // "book:chapter" -> number[]
  for (let vid = 1; vid <= NUM_VERSES; vid++) {
    const [b, c] = verseTuples[vid];
    const key = `${b}:${c}`;
    let arr = vidsByChapter.get(key);
    if (!arr) {
      arr = [];
      vidsByChapter.set(key, arr);
    }
    arr.push(vid);
  }

  const pericopes = []; // { pericopeId, startVid, endVid, book, genre, vids }
  const vidCount = new Uint8Array(NUM_VERSES + 1);
  const vidToPericopes = new Uint32Array(NUM_VERSES * 2);

  const emitPericope = (book, vids) => {
    if (!vids.length) return;
    const startVid = vids[0];
    const endVid = vids[vids.length - 1];
    // Verify no vid exceeds 2 pericopes
    for (let v = startVid; v <= endVid; v++) {
      if (vidCount[v] >= 2) return; // skip redundant overlap if already at max 2
    }
    const pericopeId = pericopes.length + 1;
    pericopes.push({
      pericopeId,
      startVid,
      endVid,
      book,
      genre: bookGenre(book),
      vids,
    });
    for (let v = startVid; v <= endVid; v++) {
      const base = (v - 1) * 2;
      vidToPericopes[base + vidCount[v]] = pericopeId;
      vidCount[v]++;
    }
  };

  for (const [, chVids] of vidsByChapter.entries()) {
    const book = verseTuples[chVids[0]][0];
    const n = chVids.length;
    if (n <= 7) {
      emitPericope(book, chVids);
      continue;
    }
    if (n <= 12) {
      const mid = Math.ceil(n / 2);
      emitPericope(book, chVids.slice(0, Math.min(n, mid + 1)));
      emitPericope(book, chVids.slice(Math.max(0, mid - 1)));
      continue;
    }

    // Long chapters (> 12 vv): find MACULA speech-turn / discourse changepoints,
    // then cover with 50%-overlapping windows of 5..8 verses (stride = 3..4, ensuring <= 2 per vid!)
    const breaks = new Set([0]);
    for (let i = 1; i < n; i++) {
      const prevCl = clausesByVid.get(chVids[i - 1]) || [];
      const curCl = clausesByVid.get(chVids[i]) || [];
      const prevScope = prevCl[prevCl.length - 1]?.speakerScope;
      const curScope = curCl[0]?.speakerScope;
      if (prevScope && curScope && prevScope !== curScope && curScope !== 'unknown') {
        breaks.add(i);
      }
    }

    const winSize = 6;
    const stride = 3;
    let pos = 0;
    while (pos < n) {
      let end = Math.min(n, pos + winSize);
      if (end < n) {
        for (const cand of [end - 1, end + 1]) {
          if (cand > pos + 3 && cand <= Math.min(n, pos + 8) && breaks.has(cand)) {
            end = cand;
            break;
          }
        }
      }
      if (n - end > 0 && n - end < 3 && end - pos <= 8) {
        end = n;
      }
      const slice = chVids.slice(pos, end);
      let safeStart = 0;
      while (safeStart < slice.length && vidCount[slice[safeStart]] >= 2) safeStart++;
      if (safeStart < slice.length) {
        emitPericope(book, slice.slice(safeStart));
      }
      if (end >= n) break;
      const step = Math.max(stride, Math.ceil((end - pos) / 2));
      pos += step;
    }
  }

  // Guarantee 100% coverage of all 31,203 canonical verses
  for (let vid = 1; vid <= NUM_VERSES; vid++) {
    if (vidCount[vid] === 0) {
      const [book] = verseTuples[vid];
      emitPericope(book, [vid]);
    }
  }

  return { pericopes, vidToPericopes };
}

// =============================================================================
// 6. HREG Compiler (Tier 0 Coref, Tier 1 Events/Roles, Tier 2 HO Edges)
// =============================================================================

const DEITY_STRONGS = new Set(['H3068', 'H0430', 'H0410', 'H0136', 'H7706', 'G2316', 'G2962', 'G2424', 'G5547']);
const INDEF_GENERIC_STRONGS = new Set(['H0376', 'G0444', 'G5100', 'H3605']);
const EXISTENTIAL_STRONGS = new Set(['H0369', 'H3426', 'H1961', 'H0657', 'G1510', 'G3762', 'G3367']);
const EXISTENTIAL_NEG_STRONGS = new Set(['H0369', 'H0657', 'G3762', 'G3367']);
const CAUSATIVE_STEMS = new Set(['hiphil', 'haphel', 'aphel']);
const PASSIVE_STEMS = new Set(['niphal', 'hophal', 'pual', 'hithpael', 'hithpeel']);
const CONCRETE_TOOL_KEYWORDS = /\b(rod|staff|sword|spear|stone|bow|arrow|water|fire|salt|wood|tree|bowl|cup|hand|finger|mouth|tongue|oil|blood|ashes|hyssop|ash|hammer|axe|knife|net|snare|cord|rope|key|scroll|pen|ink|gold|silver|iron|bronze)\b/i;

function compilePericopeHreg(per, clauses, wordsById, wordsByBareId, ctx) {
  const { lexicon, ontology, archOracle, tipnr, proxOracle } = ctx;
  const profiles = lexicon.profiles || {};
  const mappedSenses = ontology.mapped_senses || {};
  const senseToConcept = ontology.sense_to_concept || {};
  const conceptClasses = ontology.concept_classes || {};

  // Build quick bs -> sense/concept/valence lookup
  const getWordSemantics = (w) => {
    const bs = w.bs || '';
    const prof = profiles[bs];
    let senseId = '';
    if (w.sensenumber && bs) {
      const cand = `sense:${bs}:${w.sensenumber}`;
      if (mappedSenses[cand]) senseId = cand;
    }
    if (!senseId && prof?.senses?.[0]?.sense_id) senseId = prof.senses[0].sense_id;
    const ms = senseId ? mappedSenses[senseId] : null;
    const conceptId = (senseId && senseToConcept[senseId]) || '';
    const cMeta = conceptId ? conceptClasses[conceptId] : null;
    const valence = ms?.valence ?? cMeta?.valence ?? 0;
    const oewnDomain = ms?.oewn_domain || '';
    const gl = prof?.gl || ms?.gl || '';
    return { bs, senseId, conceptId, valence, oewnDomain, gl, idf: prof?.idf ?? 4.0, isFunc: Boolean(prof?.is_grammatical_marker) };
  };

  const resolveAntecedentWord = (refId) => {
    if (!refId) return null;
    return wordsById.get(refId) || wordsByBareId.get(refId.replace(/^[on]/, '')) || null;
  };

  const resolveWordTipnr = (w) => {
    if (!w || !w.bs) return '';
    for (const vid of w.vids || []) {
      const hit = tipnr.lookup(vid, w.bs);
      if (hit) return hit.tipnrId;
    }
    return '';
  };

  const inferSort = (w, sem, tipnrId) => {
    if (DEITY_STRONGS.has(w.bs)) return 'DEITY';
    if (tipnrId) {
      const hit = w.vids?.[0] ? tipnr.lookup(w.vids[0], w.bs) : null;
      const t = hit?.type || '';
      if (t === 'Supernatural') return 'DEITY';
      if (t === 'Male' || t === 'Female') return 'HUMAN';
      if (t === 'Group') return 'GROUP';
      if (t === 'Place') return 'PLACE';
    }
    const d = sem.oewnDomain || '';
    if (d === 'noun.person') return 'HUMAN';
    if (d === 'noun.group') return 'GROUP';
    if (d === 'noun.animal') return 'CREATURE';
    if (d === 'noun.plant' || d === 'noun.substance' || d === 'noun.phenomenon' || d === 'noun.object') return 'NATURE';
    if (d === 'noun.artifact' || d === 'noun.food') return 'ARTIFACT';
    if (d === 'noun.location') return 'PLACE';
    if (d.startsWith('noun.')) return 'ABSTRACT';
    if (w.type === 'proper') return 'PROP';
    if (w.class === 'pron') return 'HUMAN';
    return 'ABSTRACT';
  };

  // --- Step 1: Collect Clause Events & Participant Mentions ---
  // Assign mention nodes for every argument token or coordinated group; use Union-Find for Tier-0!
  const mentions = []; // { idx, key, word, antWord, vid, clauseIdx, speakerScope, isDefinite, isSameClauseSubj, coordGroupId, sem, tipnrId }
  const mentionIdxByKey = new Map();

  const SKIP_PARTICIPANT_CLASSES = new Set(['art', 'cj', 'om', 'ptcl', 'prep', 'rel', 'ij']);
  const SKIP_PARTICIPANT_STRONGS = new Set(['H3808', 'H0408', 'H3651', 'G3756', 'G3361', 'G3588', 'G3779']);

  const registerMention = (w, clauseIdx, speakerScope, coordGroupId = null, isDefinite = false, clauseVid = 0) => {
    if (!w) return -1;
    // Follow explicit referent/participantref to canonical antecedent (chapter-scoped!)
    let ant = w;
    const ptrStr = w.participantref || w.referent || '';
    const ptrIds = ptrStr.split(/[\s;]+/).filter(Boolean);
    if (ptrIds.length > 0) {
      const target = resolveAntecedentWord(ptrIds[0]);
      if (target) ant = target;
    }

    const useVid = clauseVid || w.vids?.[0] || per.startVid;
    const key = coordGroupId ? `cg:${coordGroupId}` : `w:${w.id}@${useVid}`;
    if (mentionIdxByKey.has(key)) return mentionIdxByKey.get(key);

    const effective = (ant.class !== 'pron' && ant.pos !== 'suffix' && ant.bs) ? ant : (w.class !== 'pron' && w.pos !== 'suffix' ? w : ant);
    const sem = getWordSemantics(effective);
    const tipnrId = resolveWordTipnr(effective);
    const idx = mentions.length;
    mentionIdxByKey.set(key, idx);
    mentions.push({
      idx,
      key,
      word: w,
      effective,
      ptrIds,
      vid: useVid,
      clauseIdx,
      speakerScope,
      coordGroupId,
      isDefinite: isDefinite || effective.type === 'proper' || Boolean(tipnrId),
      sem,
      tipnrId,
      sort: inferSort(effective, sem, tipnrId),
    });
    return idx;
  };

  // --- Step 2: Build Raw Events from Clauses ---
  const rawEvents = [];
  const cidToRawEventIdx = new Map();

  for (let ci = 0; ci < clauses.length; ci++) {
    const cl = clauses[ci];
    const pw = cl.predWord;
    const vid = cl.vids?.[0] || per.startVid;
    const predSem = pw ? getWordSemantics(pw) : { bs: '', senseId: '', conceptId: '', valence: 0, gl: '', idf: 2.0, isFunc: true };

    const isExistential =
      cl.clauseKind === 'verbless' ||
      cl.clauseKind === 'copular' ||
      (pw && EXISTENTIAL_STRONGS.has(pw.bs));

    let pol = cl.negated || (pw && EXISTENTIAL_NEG_STRONGS.has(pw.bs)) ? 'NEG' : 'POS';
    const isPassive =
      cl.voice === 'passive' ||
      (!pw?.lang?.startsWith('G') && PASSIVE_STEMS.has(cl.verbStem));

    const hasDirectObj = (cl.resolvedRoles.o?.length || 0) > 0 || (pw?.clearArgs || '').includes('A1:');
    const isCausative =
      CAUSATIVE_STEMS.has(cl.verbStem) ||
      ((cl.verbStem === 'piel' || cl.verbStem === 'pael') && hasDirectObj) ||
      (pw && archOracle.bsCausativeOewn.has(pw.bs));

    let force = 'ASSERT';
    if (cl.hasQuestion) force = 'INTERROGATIVE';
    else if (cl.forceKind === 'directive') force = pol === 'NEG' ? 'PROHIBIT' : 'DIRECTIVE';

    const arch = isExistential ? 'EXIST_EQUATE' : archOracle.getArchetype(predSem.bs, predSem.gl);

    // Prune bare quotative speech openers if they have no content args beyond speaker/addressee and frame a speech clause
    const nextCl = clauses[ci + 1];
    const isBareQuotativeOpener =
      cl.speechVerb &&
      !isExistential &&
      !(cl.resolvedRoles.o?.some(h => !h.isClausal)) &&
      ((nextCl && nextCl.speechQuoted) || clauses.some(c2 => c2.speechParentCid === cl.cid));

    // Map arguments to 8 normalized ArgRoles
    const rawArgs = []; // { role, mentionIdx, word }
    const addArg = (role, head) => {
      if (!head || head.isClausal || !head.word) return;
      const w = head.word;
      if (SKIP_PARTICIPANT_CLASSES.has(w.class) || SKIP_PARTICIPANT_STRONGS.has(w.bs)) return;
      if (w.class === 'adv' && !w.adjunctType) return;
      const mIdx = registerMention(w, ci, cl.speakerScope, head.coordGroupId, false, vid);
      if (mIdx >= 0) rawArgs.push({ role, mentionIdx: mIdx, word: w });
    };

    // Core syntactic roles + passive voice normalization
    for (const h of cl.resolvedRoles.s || []) {
      addArg(isPassive ? 'PATIENT' : 'AGENT', h);
    }
    for (const h of cl.resolvedRoles.o || []) {
      addArg('PATIENT', h);
    }
    for (const h of cl.resolvedRoles.p || []) {
      if (h.prepLemmas?.length) {
        const pl = h.prepLemmas[0];
        if (pl === 'מן' || pl === 'εκ' || pl === 'απο') addArg('SOURCE', h);
        else if (pl === 'אל' || pl === 'על' || pl === 'εις' || pl === 'προς') addArg('GOAL_LOC', h);
        else addArg(isExistential ? 'PATIENT' : 'GOAL_LOC', h);
      } else {
        addArg('PATIENT', h);
      }
    }
    for (const h of cl.resolvedRoles.io || []) addArg('RECIPIENT', h);
    for (const h of cl.resolvedRoles.o2 || []) addArg('THEME_2', h);

    // Clear Greek A0/A1/A2 semantic links (read from internal clearArgs, NEVER serialized under key `frame`)
    if (pw?.clearArgs) {
      for (const seg of pw.clearArgs.split(/\s+/)) {
        const am = /^(A[012]):(.+)$/.exec(seg);
        if (!am) continue;
        const aRole = am[1] === 'A0' ? 'AGENT' : am[1] === 'A1' ? 'PATIENT' : 'RECIPIENT';
        for (const idPart of am[2].split(';').filter(Boolean)) {
          const aw = resolveAntecedentWord(idPart);
          if (aw && aw.class !== 'verb' && !SKIP_PARTICIPANT_CLASSES.has(aw.class) && !SKIP_PARTICIPANT_STRONGS.has(aw.bs)) {
            const mIdx = registerMention(aw, ci, cl.speakerScope, null, false, vid);
            if (mIdx >= 0 && !rawArgs.some(r => r.role === aRole && r.mentionIdx === mIdx)) {
              rawArgs.push({ role: aRole, mentionIdx: mIdx, word: aw });
            }
          }
        }
      }
    }

    // Hebrew subjref implicit subject (when no syntactic `s` present)
    if (pw?.subjref && !rawArgs.some(r => r.role === (isPassive ? 'PATIENT' : 'AGENT'))) {
      const subIds = pw.subjref.split(/[\s;]+/).filter(Boolean);
      const cgid = subIds.length > 1 ? `subj:${pw.id}` : null;
      for (const sid of subIds) {
        const sw = resolveAntecedentWord(sid);
        if (sw) {
          const mIdx = registerMention(sw, ci, cl.speakerScope, cgid, true, vid);
          if (mIdx >= 0) rawArgs.push({ role: isPassive ? 'PATIENT' : 'AGENT', mentionIdx: mIdx, word: sw });
        }
      }
    }

    // Oblique PPs & Adjuncts (Clear adjunct_type.json + Hebrew prep rules)
    for (const rKey of ['pp', 'cmpl', 'adv']) {
      for (const h of cl.resolvedRoles[rKey] || []) {
        if (h.isClausal || !h.word) continue;
        const w = h.word;
        if (rKey === 'adv' && w.class === 'adv' && !w.adjunctType) continue;
        const pl = h.prepLemmas?.[0] || '';
        const adj = w.adjunctType || h.prepWords?.[0]?.adjunctType || '';
        let normRole = 'GOAL_LOC';
        if (isPassive && (pl === 'מן' || pl === 'ל' || pl === 'υπο' || pl === 'παρα')) {
          normRole = 'AGENT';
        } else if (adj === 'Source' || pl === 'מן' || pl === 'εκ' || pl === 'απο') {
          normRole = 'SOURCE';
        } else if (adj === 'Instrument') {
          normRole = 'INSTRUMENT';
        } else if (adj === 'Manner' || adj === 'Time' || adj === 'Extent' || pl === 'כ' || pl === 'κατα') {
          normRole = 'MANNER_TIME';
        } else if (adj === 'Goal' || adj === 'Place' || pl === 'אל' || pl === 'על' || pl === 'εις' || pl === 'προς' || pl === 'εν') {
          normRole = 'GOAL_LOC';
        } else if (pl === 'ב') {
          const gl = getWordSemantics(w).gl;
          normRole = CONCRETE_TOOL_KEYWORDS.test(gl) ? 'INSTRUMENT' : 'GOAL_LOC';
        } else if (pl === 'ל') {
          const sort = inferSort(w, getWordSemantics(w), resolveWordTipnr(w));
          normRole = (sort === 'HUMAN' || sort === 'DEITY' || sort === 'GROUP') ? 'RECIPIENT' : 'GOAL_LOC';
        }
        addArg(normRole, h);
      }
    }

    // Also inspect pronominal suffixes on direct noun arguments (e.g., Isa 55:11 דְּבָרִי -> יְהוָה)
    for (const dw of cl.directWords) {
      if ((dw.pos === 'suffix' || dw.class === 'pron') && dw.participantref && !rawArgs.some(r => r.word.id === dw.id)) {
        const mIdx = registerMention(dw, ci, cl.speakerScope, null, false, vid);
        if (mIdx >= 0 && dw.role === 'o') rawArgs.push({ role: 'PATIENT', mentionIdx: mIdx, word: dw });
      }
    }

    // Existential-Negation & Copular Patient Promotion (Jer 4:23-26)
    let promotedConceptId = '';
    let promotedStrongs = '';
    let promotedIdf = 0;
    if (isExistential) {
      const patArg = rawArgs.find(r => r.role === 'PATIENT') || rawArgs.find(r => r.role === 'AGENT');
      if (patArg) {
        if (patArg.role !== 'PATIENT') patArg.role = 'PATIENT';
        const pm = mentions[patArg.mentionIdx];
        promotedStrongs = pm.sem.bs;
        promotedConceptId = pm.sem.conceptId || pm.sem.senseId || '';
        promotedIdf = pm.sem.idf;
      } else {
        // Check directWords for a non-existential noun
        const nounW = cl.directWords.find(w => (w.class === 'noun' || w.class === 'adj') && w.bs && !EXISTENTIAL_STRONGS.has(w.bs));
        if (nounW) {
          const nSem = getWordSemantics(nounW);
          promotedStrongs = nSem.bs;
          promotedConceptId = nSem.conceptId || nSem.senseId || '';
          promotedIdf = nSem.idf;
          const mIdx = registerMention(nounW, ci, cl.speakerScope, null, true, vid);
          if (mIdx >= 0) rawArgs.push({ role: 'PATIENT', mentionIdx: mIdx, word: nounW });
        }
      }
    }

    // Event evaluative valence: predicate valence or promoted patient valence
    let evValence = predSem.valence || 0;
    if (evValence === 0 && rawArgs.length > 0) {
      for (const a of rawArgs) {
        const av = mentions[a.mentionIdx].sem.valence;
        if (av !== 0) { evValence = av; break; }
      }
    }

    const idx = rawEvents.length;
    cidToRawEventIdx.set(cl.cid, idx);
    rawEvents.push({
      rawIdx: idx,
      cl,
      vid,
      strongs: predSem.bs || (isExistential ? 'H1961' : ''),
      conceptId: predSem.conceptId || predSem.senseId || '',
      arch,
      pol,
      isCausative,
      isExistential,
      isPassive,
      force,
      valence: evValence > 0 ? 1 : evValence < 0 ? -1 : 0,
      idf: isExistential && promotedIdf > predSem.idf ? promotedIdf : predSem.idf,
      promotedConceptId,
      promotedStrongs,
      rawArgs,
      isBareQuotativeOpener,
    });
  }

  // --- Step 3: Tier-0 3-Priority Union-Find Coreference ---
  const nM = mentions.length;
  const parent = Int32Array.from({ length: nM }, (_, i) => i);
  const clusterSize = Int32Array.from({ length: nM }, () => 1);
  const clusterConf = Float32Array.from({ length: nM }, () => 1.0);
  const clusterHasTipnr = new Uint8Array(nM);
  for (let i = 0; i < nM; i++) {
    if (mentions[i].tipnrId) clusterHasTipnr[i] = 1;
  }

  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b, conf) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const sz = clusterSize[ra] + clusterSize[rb];
    if (!clusterHasTipnr[ra] && !clusterHasTipnr[rb] && sz > MAX_COREF_CLUSTER) return;
    parent[rb] = ra;
    clusterSize[ra] = sz;
    clusterHasTipnr[ra] = clusterHasTipnr[ra] | clusterHasTipnr[rb];
    clusterConf[ra] = Math.min(clusterConf[ra], clusterConf[rb], conf);
  };

  // Priority 1 (conf = 1.0): Explicit subjref/participantref/referent + coord bundling (O(N) indexed!)
  // Note: MACULA Hebrew xml:id starts with 'o' while subjref/participantref omit 'o' — index both!
  const byWordIdMentions = new Map();
  const byPtrIdMentions = new Map();
  const byEffectiveIdMentions = new Map();
  const addIdxMap = (map, k, idx) => {
    let arr = map.get(k);
    if (!arr) { arr = []; map.set(k, arr); }
    arr.push(idx);
  };
  for (const m of mentions) {
    addIdxMap(byWordIdMentions, m.word.id, m.idx);
    const bareW = m.word.id.replace(/^[on]/, '');
    if (bareW !== m.word.id) addIdxMap(byWordIdMentions, bareW, m.idx);
    for (const pid of m.ptrIds) {
      addIdxMap(byPtrIdMentions, pid.replace(/^[on]/, ''), m.idx);
    }
    if (m.effective !== m.word) {
      addIdxMap(byEffectiveIdMentions, m.effective.id.replace(/^[on]/, ''), m.idx);
    }
  }
  for (const list of byPtrIdMentions.values()) {
    for (let k = 1; k < list.length; k++) union(list[0], list[k], 1.0);
  }
  for (const list of byEffectiveIdMentions.values()) {
    for (let k = 1; k < list.length; k++) union(list[0], list[k], 1.0);
  }
  for (const m of mentions) {
    for (const pid of m.ptrIds) {
      const targets = byWordIdMentions.get(pid) || byWordIdMentions.get(pid.replace(/^[on]/, ''));
      if (targets) {
        for (const tIdx of targets) union(tIdx, m.idx, 1.0);
      }
    }
  }

  // Priority 2 (conf = 0.95): TIPNR proper entity IDs
  const tipnrRep = new Map();
  for (const m of mentions) {
    if (!m.tipnrId) continue;
    const prev = tipnrRep.get(m.tipnrId);
    if (prev !== undefined) union(prev, m.idx, 0.95);
    else tipnrRep.set(m.tipnrId, m.idx);
  }

  // Priority 3 (conf = 0.75): Bounded <= 6 clause same-speaker definite recurrence
  for (let i = 0; i < nM; i++) {
    const a = mentions[i];
    if (!a.sem.bs || a.effective.class === 'pron' || a.effective.pos === 'suffix') continue;
    if (INDEF_GENERIC_STRONGS.has(a.sem.bs)) continue;
    if (a.effective.lemmaNorm === 'αυτος') continue; // Greek non-reflexive αὐτός guard
    for (let j = i + 1; j < nM; j++) {
      const b = mentions[j];
      if (Math.abs(b.clauseIdx - a.clauseIdx) > 6) continue;
      if (a.speakerScope !== 'unknown' && b.speakerScope !== 'unknown' && a.speakerScope !== b.speakerScope) continue;
      if (b.effective.class === 'pron' || b.effective.pos === 'suffix') continue;
      if (b.sem.bs !== a.sem.bs) continue;
      if (a.sem.senseId && b.sem.senseId && a.sem.senseId !== b.sem.senseId) continue;
      if (a.effective.number && b.effective.number && a.effective.number !== b.effective.number) continue;
      if (!a.isDefinite && !b.isDefinite) continue;
      union(i, j, 0.75);
    }
  }

  // --- Step 4: Tier-2 Higher-Order Relations (before salience pruning so HO-connected events get priority!) ---
  const hoCandidates = []; // { hoType, fromRawIdx, toRawIdx, vid }
  const mapConnectiveToHo = (connKind, prevNeg, isPerceive) => {
    switch (connKind) {
      case 'because': return isPerceive ? 'PROPOSITIONAL_FRAME' : 'CAUSE_GROUND';
      case 'therefore':
      case 'result': return 'RESULT_INFERENCE';
      case 'purpose': return 'PURPOSE';
      case 'lest': return 'AVOIDANCE_LEST';
      case 'if': return 'CONDITION';
      case 'but_rather': return 'CONTRAST_EXCEPT';
      case 'contrast': return prevNeg ? 'CONTRAST_EXCEPT' : 'CONTRAST_ANTI';
      case 'though': return 'CONCESSION';
      case 'as': return 'EXPLICIT_ANALOGY';
      case 'then': return 'ORD';
      default: return null;
    }
  };

  const hebLex = lexicon ? null : null; // use headsBundle connectives dynamically below
  const { headsBundle } = ctx;
  const isHebPericope = per.book <= 39;
  const s3Lex = headsBundle[isHebPericope ? 'hebrew' : 'greek'].lexicon;
  const s3Conn = s3Lex.connectives || {};
  const s3Within = s3Lex.within_by_prep || {};

  for (let i = 0; i < rawEvents.length; i++) {
    const ev = rawEvents[i];
    const cl = ev.cl;

    // 4a. Nested clause under parent (PROPOSITIONAL_FRAME / PrepCL / Adjunct)
    if (cl.parentCid && cidToRawEventIdx.has(cl.parentCid)) {
      const pIdx = cidToRawEventIdx.get(cl.parentCid);
      const pEv = rawEvents[pIdx];
      let hoType = null;

      const prepLems = cl.prepContext.map(p => normS3(p.lemma));
      const openerLems = cl.openers.map(o => normS3(o.lemma));
      const allLems = [...prepLems, ...openerLems];
      const joined = allLems.join(' ');

      if (pEv.cl.speechVerb || pEv.cl.perceiveVerb || cl.speechQuoted) {
        hoType = 'PROPOSITIONAL_FRAME';
      } else if (s3Within[joined]) {
        hoType = mapConnectiveToHo(s3Within[joined], pEv.pol === 'NEG', pEv.cl.perceiveVerb);
      } else {
        for (const l of allLems) {
          if (s3Within[l]) {
            hoType = mapConnectiveToHo(s3Within[l], pEv.pol === 'NEG', pEv.cl.perceiveVerb);
            if (hoType) break;
          }
        }
      }
      if (!hoType) {
        const adj = cl.openers.find(o => o.adjunctType)?.adjunctType || cl.directWords.find(w => w.adjunctType)?.adjunctType;
        if (adj === 'Condition') hoType = 'CONDITION';
        else if (adj === 'Result') hoType = 'RESULT_INFERENCE';
        else if (adj === 'Concession') hoType = 'CONCESSION';
        else if (adj === 'Comparison') hoType = 'EXPLICIT_ANALOGY';
      }
      if (!hoType && cl.roleInParent === 'o') hoType = 'PROPOSITIONAL_FRAME';
      if (hoType) {
        const revDir = hoType === 'CONDITION' || hoType === 'CAUSE_GROUND';
        hoCandidates.push({
          hoType,
          fromRawIdx: revDir ? i : pIdx,
          toRawIdx: revDir ? pIdx : i,
          vid: ev.vid,
        });
      }
    }

    // 4b. Sibling / Sequential S3 connectives between rawEvents[i-1] and rawEvents[i]
    if (i > 0) {
      const prev = rawEvents[i - 1];
      const opLems = cl.openers.map(o => normS3(o.lemma));
      const joined = opLems.join(' ');
      let hoType = null;

      // Multi-word connective match (e.g. "כי אם", "על כן", "גם כי", "לכן")
      if (s3Conn[joined]) {
        const entry = s3Conn[joined];
        const kind = (prev.pol === 'NEG' && entry.after_negative) ? entry.after_negative : (entry.any || entry.mid);
        hoType = mapConnectiveToHo(kind, prev.pol === 'NEG', prev.cl.perceiveVerb);
      }
      if (!hoType) {
        for (let oi = 0; oi < opLems.length; oi++) {
          const l = opLems[oi];
          if (oi + 1 < opLems.length && s3Conn[`${l} ${opLems[oi + 1]}`]) {
            const entry = s3Conn[`${l} ${opLems[oi + 1]}`];
            const kind = (prev.pol === 'NEG' && entry.after_negative) ? entry.after_negative : (entry.any || entry.mid);
            hoType = mapConnectiveToHo(kind, prev.pol === 'NEG', prev.cl.perceiveVerb);
            if (hoType) break;
          }
          if (s3Within[l]) {
            hoType = mapConnectiveToHo(s3Within[l], prev.pol === 'NEG', prev.cl.perceiveVerb);
            if (hoType) break;
          }
          if (s3Conn[l]) {
            const entry = s3Conn[l];
            const kind = (prev.pol === 'NEG' && entry.after_negative) ? entry.after_negative : (entry.any || entry.mid);
            hoType = mapConnectiveToHo(kind, prev.pol === 'NEG', prev.cl.perceiveVerb);
            if (hoType && hoType !== 'ORD') break;
          }
        }
      }

      // Explicit correlative analogy (כאשר...כן / καθώς...οὕτως / ὥσπερ...οὕτως)
      const curHasCorrelTarget = cl.directWords.some(w => ['כן', 'ουτως', 'ουτω'].includes(normS3(w.lemma)));
      if (curHasCorrelTarget) {
        for (let j = Math.max(0, i - 4); j < i; j++) {
          const candPrev = rawEvents[j];
          const prevHasBase = candPrev.cl.openers.concat(candPrev.cl.directWords).some(w =>
            ['כאשר', 'כ', 'καθως', 'ωσπερ', 'καθαπερ'].includes(normS3(w.lemma))
          );
          if (prevHasBase) {
            hoCandidates.push({ hoType: 'EXPLICIT_ANALOGY', fromRawIdx: j, toRawIdx: i, vid: ev.vid });
            break;
          }
        }
      }

      // A fortiori signals (אף כי / πόσῳ μᾶλλον)
      if (cl.directWords.concat(cl.openers).some(w => ['αρα', 'μαλλον'].includes(normS3(w.lemma))) &&
          cl.directWords.concat(cl.openers).some(w => ['ποσος', 'πολυς'].includes(normS3(w.lemma)))) {
        hoType = 'A_FORTIORI';
      }

      if (hoType) {
        hoCandidates.push({ hoType, fromRawIdx: i - 1, toRawIdx: i, vid: ev.vid });
      } else if (cl.verbForm === 'wayyiqtol' || (!isHebPericope && ['δε', 'και', 'τοτε'].some(x => opLems.includes(x)))) {
        hoCandidates.push({ hoType: 'ORD', fromRawIdx: i - 1, toRawIdx: i, vid: ev.vid });
      }
    }
  }

  // 4c. STATE_REVERSAL and CMD_EXEC across coreferent participants
  for (let i = 0; i < rawEvents.length; i++) {
    const e1 = rawEvents[i];
    const roots1 = new Set(e1.rawArgs.map(a => find(a.mentionIdx)));
    for (let j = i + 1; j < Math.min(rawEvents.length, i + 7); j++) {
      const e2 = rawEvents[j];
      const roots2 = new Set(e2.rawArgs.map(a => find(a.mentionIdx)));
      let shared = false;
      for (const r of roots1) if (roots2.has(r)) { shared = true; break; }
      if (!shared) continue;

      if ((e1.pol !== e2.pol) || (e1.valence !== 0 && e2.valence !== 0 && e1.valence === -e2.valence)) {
        hoCandidates.push({ hoType: 'STATE_REVERSAL', fromRawIdx: i, toRawIdx: j, vid: e2.vid });
      }
      if (e1.force === 'DIRECTIVE' && e2.force === 'ASSERT' && (e1.arch === e2.arch || shared)) {
        hoCandidates.push({ hoType: 'CMD_EXEC', fromRawIdx: i, toRawIdx: j, vid: e2.vid });
      }
    }
  }

  // --- Step 5: Salience Cap <= 24 Events & <= 32 Participants ---
  const hoDegree = new Int32Array(rawEvents.length);
  for (const h of hoCandidates) {
    if (h.hoType !== 'ORD') {
      hoDegree[h.fromRawIdx]++;
      hoDegree[h.toRawIdx]++;
    }
  }

  let keptEvents = rawEvents.filter(e => !e.isBareQuotativeOpener || hoDegree[e.rawIdx] > 0);
  if (keptEvents.length === 0) keptEvents = rawEvents.slice();
  if (keptEvents.length > MAX_HREG_EVENTS) {
    keptEvents.sort((a, b) => {
      const sa = (hoDegree[a.rawIdx] > 0 ? 10 : 0) + (a.isExistential && a.promotedStrongs ? 8 : a.isExistential ? 4 : 0) + a.idf;
      const sb = (hoDegree[b.rawIdx] > 0 ? 10 : 0) + (b.isExistential && b.promotedStrongs ? 8 : b.isExistential ? 4 : 0) + b.idf;
      return sb - sa || a.rawIdx - b.rawIdx;
    });
    keptEvents = keptEvents.slice(0, MAX_HREG_EVENTS).sort((a, b) => a.rawIdx - b.rawIdx);
  }

  const rawToLocalEid = new Map();
  keptEvents.forEach((e, idx) => rawToLocalEid.set(e.rawIdx, idx));

  // Collect active participant clusters used by keptEvents (capped at <= 32)
  const clusterStats = new Map(); // root -> { root, count, idf, mentions: [] }
  for (const ev of keptEvents) {
    for (const a of ev.rawArgs) {
      const r = find(a.mentionIdx);
      let st = clusterStats.get(r);
      if (!st) {
        st = { root: r, count: 0, idf: 0, mentions: [] };
        clusterStats.set(r, st);
      }
      st.count++;
      st.idf = Math.max(st.idf, mentions[a.mentionIdx].sem.idf);
      st.mentions.push(mentions[a.mentionIdx]);
    }
  }
  // Also include any cluster mentioned directly by a mention in kept clauses if room remains
  let keptClusters = [...clusterStats.values()];
  if (keptClusters.length > MAX_HREG_PARTICIPANTS) {
    keptClusters.sort((a, b) => (b.count * 2 + b.idf) - (a.count * 2 + a.idf) || a.root - b.root);
    keptClusters = keptClusters.slice(0, MAX_HREG_PARTICIPANTS);
  }

  const rootToLocalPid = new Map();
  const participants = keptClusters.map((st, pid) => {
    rootToLocalPid.set(st.root, pid);
    // Pick canonical representative mention (prefer TIPNR -> proper -> non-pronoun -> highest IDF)
    const rep = st.mentions.slice().sort((a, b) => {
      const sa = (a.tipnrId ? 100 : 0) + (a.effective.class !== 'pron' && a.effective.pos !== 'suffix' ? 50 : 0) + a.sem.idf;
      const sb = (b.tipnrId ? 100 : 0) + (b.effective.class !== 'pron' && b.effective.pos !== 'suffix' ? 50 : 0) + b.sem.idf;
      return sb - sa;
    })[0];
    const mentionVids = [...new Set(st.mentions.map(m => m.vid).filter(v => v >= 1 && v <= NUM_VERSES))].sort((a, b) => a - b);
    return {
      pid,
      strongs: rep.sem.bs || '',
      conceptId: rep.sem.conceptId || rep.sem.senseId || '',
      tipnrId: st.mentions.map(m => m.tipnrId).find(Boolean) || '',
      sort: rep.sort,
      valence: rep.sem.valence > 0 ? 1 : rep.sem.valence < 0 ? -1 : 0,
      corefConf: Math.max(0.75, Math.min(1.0, clusterConf[st.root])),
      mentionVids,
    };
  });

  const events = keptEvents.map((ev, eid) => {
    const argRoles = [];
    const seenRolePid = new Set();
    for (const a of ev.rawArgs) {
      const pid = rootToLocalPid.get(find(a.mentionIdx));
      if (pid === undefined) continue;
      const key = `${a.role}:${pid}`;
      if (seenRolePid.has(key)) continue;
      seenRolePid.add(key);
      argRoles.push({ role: a.role, pid });
    }
    return {
      eid,
      vid: ev.vid,
      strongs: ev.strongs,
      conceptId: ev.conceptId,
      arch: ev.arch,
      pol: ev.pol,
      isCausative: ev.isCausative,
      isExistential: ev.isExistential,
      isPassive: ev.isPassive,
      force: ev.force,
      valence: ev.valence,
      idf: ev.idf,
      promotedConceptId: ev.promotedConceptId,
      promotedStrongs: ev.promotedStrongs,
      argRoles,
    };
  });

  // Map Tier-2 HO edges to local eids & deduplicate
  const hoEdges = [];
  const seenHo = new Set();
  for (const h of hoCandidates) {
    const fromEid = rawToLocalEid.get(h.fromRawIdx);
    const toEid = rawToLocalEid.get(h.toRawIdx);
    if (fromEid === undefined || toEid === undefined || fromEid === toEid) continue;
    const key = `${h.hoType}:${fromEid}:${toEid}`;
    if (seenHo.has(key)) continue;
    seenHo.add(key);
    hoEdges.push({
      hid: hoEdges.length,
      hoType: h.hoType,
      fromEid,
      toEid,
      vid: h.vid,
    });
    if (hoEdges.length >= 128) break;
  }

  // M4 ESIDE discourse frame bitmask (bits 0..5)
  let esideTags = 0;
  const allClWords = clauses.flatMap(c => c.allWords);
  if (hoEdges.some(h => h.hoType === 'EXPLICIT_ANALOGY')) esideTags |= 1 << 0; // M4:EXP_ANALOGY
  if (allClWords.some(w => ['H2472', 'H2377', 'H4758', 'H6623', 'H6591', 'G3705', 'G0602'].includes(w.bs))) esideTags |= 1 << 1; // M4:VISION_DECODE
  if (allClWords.some(w => ['H4912', 'H2420', 'G3850'].includes(w.bs))) esideTags |= 1 << 2; // M4:PARABLE_DECODE
  if (hoEdges.some(h => h.hoType === 'CONDITION') && events.some(e => e.arch === 'COVENANT_BIND' || e.force === 'DIRECTIVE')) esideTags |= 1 << 3; // M4:COVENANT_COND
  if (allClWords.some(w => w.bs === 'G1125' && allClWords.some(w2 => w2.bs === 'G2531' || w2.bs === 'G1063'))) esideTags |= 1 << 4; // M4:QUOTATION_SPLICE
  if (allClWords.some(w => w.bs === 'H7121' || w.bs === 'G2564') && allClWords.some(w => w.bs === 'H8034' || w.bs === 'G3686') && hoEdges.some(h => h.hoType === 'CAUSE_GROUND')) {
    esideTags |= 1 << 5; // M4:NAMING_ETIOLOGY
  }

  return {
    pericopeId: per.pericopeId,
    startVid: per.startVid,
    endVid: per.endVid,
    book: per.book,
    genre: per.genre,
    participants,
    events,
    hoEdges,
    esideTags,
  };
}

// =============================================================================
// 7. R-MAC Feature Extraction & BRV4MAC\0 Binary Builder
// =============================================================================

const M4_TAG_NAMES = [
  'M4:EXP_ANALOGY',
  'M4:VISION_DECODE',
  'M4:PARABLE_DECODE',
  'M4:COVENANT_COND',
  'M4:QUOTATION_SPLICE',
  'M4:NAMING_ETIOLOGY',
];

function shortRoleCode(r) {
  switch (r) {
    case 'AGENT': return 'A';
    case 'PATIENT': return 'P';
    case 'RECIPIENT': return 'R';
    case 'THEME_2': return 'T';
    case 'SOURCE': return 'S';
    case 'GOAL_LOC': return 'G';
    case 'INSTRUMENT': return 'I';
    case 'MANNER_TIME': return 'M';
    default: return 'X';
  }
}

function fnv64Str(str) {
  const { hi, lo } = hashKey64(str);
  return `${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
}

function extractRmacFeatures(hreg) {
  const keys = [];
  const { events, participants, hoEdges, esideTags } = hreg;

  // M1: Factored Relational Dyads (M1F, M1D, M1V)
  const hoByPair = new Map();
  for (const h of hoEdges) {
    if (h.hoType === 'ORD') continue;
    const k = `${h.fromEid}:${h.toEid}`;
    if (!hoByPair.has(k)) hoByPair.set(k, []);
    hoByPair.get(k).push(h.hoType);
  }

  // Event-to-event role transitions within <= 4 events
  const pidToEventRoles = new Map();
  for (const e of events) {
    for (const ar of e.argRoles) {
      if (!pidToEventRoles.has(ar.pid)) pidToEventRoles.set(ar.pid, []);
      pidToEventRoles.get(ar.pid).push({ eid: e.eid, role: shortRoleCode(ar.role) });
    }
  }

  const emittedPairs = new Set();
  const emitDyad = (i, j, ho, rt) => {
    const eA = events[i];
    const eB = events[j];
    const tag = `${i}:${j}:${ho}:${rt}`;
    if (emittedPairs.has(tag)) return;
    emittedPairs.add(tag);

    const pA = eA.pol === 'NEG' ? 'N' : 'P';
    const pB = eB.pol === 'NEG' ? 'N' : 'P';
    const cA = eA.isCausative ? '1' : '0';
    const cB = eB.isCausative ? '1' : '0';
    const relLabel = ho || rt;
    keys.push({ key: `M1F:${eA.arch}|${relLabel}|${eB.arch}`, flags: BMW_FLAG_ACTANT });
    if (ho) {
      keys.push({ key: `M1D:${ho}|${pA}${pB}|${cA}${cB}|${rt || 'NONE'}`, flags: BMW_FLAG_ACTANT });
    }
    if ((eA.valence !== 0 && eB.valence !== 0 && eA.valence === -eB.valence) || pA !== pB) {
      keys.push({ key: `M1V:VAL_REV|${rt || ho}|${eA.valence}->${eB.valence}`, flags: BMW_FLAG_ACTANT });
    }
    if ((rt === 'A->P' || rt === 'P->A')) {
      keys.push({ key: 'M1V:TALION|A<->P', flags: BMW_FLAG_ACTANT });
    }
  };

  for (const h of hoEdges) {
    if (h.hoType === 'ORD') continue;
    const eA = events[h.fromEid];
    const eB = events[h.toEid];
    if (!eA || !eB) continue;
    let rt = '';
    for (const a1 of eA.argRoles) {
      for (const a2 of eB.argRoles) {
        if (a1.pid === a2.pid) {
          rt = `${shortRoleCode(a1.role)}->${shortRoleCode(a2.role)}`;
          break;
        }
      }
      if (rt) break;
    }
    emitDyad(h.fromEid, h.toEid, h.hoType, rt);
  }

  for (const occs of pidToEventRoles.values()) {
    for (let a = 0; a < occs.length; a++) {
      for (let b = a + 1; b < occs.length; b++) {
        if (occs[b].eid - occs[a].eid > 4) break;
        const rt = `${occs[a].role}->${occs[b].role}`;
        const hos = hoByPair.get(`${occs[a].eid}:${occs[b].eid}`) || [''];
        for (const ho of hos) emitDyad(occs[a].eid, occs[b].eid, ho, rt);
      }
    }
  }

  // M2: Entity-Blind 2-Round Typed Relational Weisfeiler-Leman (2-RWL)
  // Two channels: pure ENT and coarse sort(x)
  let cP0 = participants.map(() => 'ENT');
  let cP0Sort = participants.map(p => p.sort);
  let cE = events.map(e => `${e.arch}:${e.pol}:${e.isCausative ? 1 : 0}`);
  let cESort = [...cE];

  const runWlRound = (pColors, eColors) => {
    const nextP = pColors.map((col, pid) => {
      const nbrs = [];
      for (const e of events) {
        for (const ar of e.argRoles) {
          if (ar.pid === pid) nbrs.push(`${ar.role}:${eColors[e.eid]}`);
        }
      }
      nbrs.sort();
      return fnv64Str(`${col}|${nbrs.join(',')}`);
    });
    const nextE = eColors.map((col, eid) => {
      const nbrs = [];
      for (const ar of events[eid].argRoles) {
        nbrs.push(`${ar.role}:${pColors[ar.pid]}`);
      }
      for (const h of hoEdges) {
        if (h.hoType === 'ORD') continue;
        if (h.fromEid === eid) nbrs.push(`HO_OUT:${h.hoType}:${eColors[h.toEid]}`);
        if (h.toEid === eid) nbrs.push(`HO_IN:${h.hoType}:${eColors[h.fromEid]}`);
      }
      nbrs.sort();
      return fnv64Str(`${col}|${nbrs.join(',')}`);
    });
    return { nextP, nextE };
  };

  for (let t = 0; t < 2; t++) {
    const r1 = runWlRound(cP0, cE);
    cP0 = r1.nextP;
    cE = r1.nextE;
    const r2 = runWlRound(cP0Sort, cESort);
    cP0Sort = r2.nextP;
    cESort = r2.nextE;
  }
  const m2Hashes = new Set();
  for (const h of cE) m2Hashes.add(`M2:E:${h}`);
  for (const h of cESort) m2Hashes.add(`M2:S:${h}`);

  // M3 / M3E: Cross-lingual Concept x Role & Existential-Concept signatures
  for (const e of events) {
    if (e.isExistential && (e.promotedConceptId || e.promotedStrongs)) {
      const target = e.promotedConceptId || e.promotedStrongs;
      keys.push({ key: `M3E:EXIST:${e.pol}:${target}`, flags: BMW_FLAG_CONCEPT });
    }
    for (const ar of e.argRoles) {
      const p = participants[ar.pid];
      if (!p) continue;
      const cid = p.conceptId || p.strongs;
      if (cid) {
        keys.push({ key: `M3:${cid}:${ar.role}`, flags: BMW_FLAG_CONCEPT });
      }
    }
  }

  // M4: Explicit ESIDE discourse frame tags
  for (let b = 0; b < M4_TAG_NAMES.length; b++) {
    if ((esideTags & (1 << b)) !== 0) {
      keys.push({ key: M4_TAG_NAMES[b], flags: BMW_FLAG_ACTANT });
    }
  }

  return { directKeys: keys, m2Hashes };
}

function buildRmacBmwBinary(numPericopes, postingsMap, relBoostedPericopes) {
  const numBlocks = Math.ceil(numPericopes / 64);
  const bitsetWords = numBlocks * 2;
  const entries = [];
  const seenHashes = new Set();

  for (const [key, rec] of postingsMap.entries()) {
    if (!rec.pids || rec.pids.size === 0) continue;
    const { hi, lo } = hashKey64(key);
    const hashTag = `${hi}:${lo}`;
    if (seenHashes.has(hashTag)) {
      throw new Error(`64-bit hash collision on BRV4MAC key "${key}"`);
    }
    seenHashes.add(hashTag);
    const pids = [...rec.pids].filter(p => p >= 1 && p <= numPericopes).sort((a, b) => a - b);
    if (!pids.length) continue;
    const df = pids.length;
    const isDense = df > DENSE_THRESHOLD;
    const flags = (isDense ? BMW_FLAG_DENSE : 0) | (rec.flags || 0);
    const idf = Math.log2(numPericopes / df);
    const idfQ8 = Math.min(255, Math.max(0, Math.round(idf * 20)));
    entries.push({ key, hi, lo, df, pids, flags, idfQ8 });
  }

  entries.sort((a, b) => (a.hi !== b.hi ? a.hi - b.hi : a.lo - b.lo));

  const headerSize = 64;
  const dirSize = entries.length * 20;
  const denseChunks = [];
  const sparseChunks = [];
  const bmwChunks = [];
  let denseOff = 0;
  let sparseOff = 0;
  let bmwOff = 0;
  let denseCount = 0;

  for (const e of entries) {
    const isDense = (e.flags & BMW_FLAG_DENSE) !== 0;
    if (isDense) {
      denseCount++;
      e.payloadOffset = denseOff;
      const words = new Uint32Array(bitsetWords);
      for (const pid of e.pids) {
        const idx0 = pid - 1;
        words[idx0 >>> 5] |= 1 << (idx0 & 31);
      }
      const buf = new Uint8Array(bitsetWords * 4);
      const dv = new DataView(buf.buffer);
      for (let w = 0; w < bitsetWords; w++) dv.setUint32(w * 4, words[w], true);
      denseChunks.push(buf);
      denseOff += buf.byteLength;
    } else {
      e.payloadOffset = sparseOff;
      const bytes = [];
      let prev = 0;
      for (const pid of e.pids) {
        const idx0 = pid - 1;
        let d = idx0 - prev;
        prev = idx0;
        while (d >= 0x80) {
          bytes.push((d & 0x7f) | 0x80);
          d >>>= 7;
        }
        bytes.push(d);
      }
      const arr = Uint8Array.from(bytes);
      sparseChunks.push(arr);
      sparseOff += arr.byteLength;
    }

    const blockHasRel = new Map();
    for (const pid of e.pids) {
      const b = (pid - 1) >>> 6;
      const rel = relBoostedPericopes.has(pid);
      if (!blockHasRel.has(b) || rel) blockHasRel.set(b, rel);
    }
    const sortedBlocks = [...blockHasRel.keys()].sort((a, b) => a - b);
    const bmwBuf = new Uint8Array(2 + sortedBlocks.length * 4);
    const bv = new DataView(bmwBuf.buffer);
    bv.setUint16(0, sortedBlocks.length, true);
    for (let i = 0; i < sortedBlocks.length; i++) {
      const b = sortedBlocks[i];
      const ubRelQ8 = blockHasRel.get(b) ? 24 : 12;
      bv.setUint16(2 + i * 4, b, true);
      bv.setUint8(2 + i * 4 + 2, e.idfQ8);
      bv.setUint8(2 + i * 4 + 3, ubRelQ8);
    }
    e.bmwOffset = bmwOff;
    bmwChunks.push(bmwBuf);
    bmwOff += bmwBuf.byteLength;
  }

  const denseOffset = headerSize + dirSize;
  const sparseOffset = denseOffset + denseOff;
  const bmwOffset = sparseOffset + sparseOff;
  const totalBytes = bmwOffset + bmwOff;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);

  for (let i = 0; i < 8; i++) out[i] = RMAC_MAGIC.charCodeAt(i);
  view.setUint32(8, 4, true); // version 4
  view.setUint32(12, numPericopes, true);
  view.setUint32(16, numBlocks, true);
  view.setUint32(20, entries.length, true);
  view.setUint32(24, headerSize, true);
  view.setUint32(28, denseOffset, true);
  view.setUint32(32, sparseOffset, true);
  view.setUint32(36, bmwOffset, true);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const off = headerSize + i * 20;
    view.setUint32(off, e.lo, true);
    view.setUint32(off + 4, e.hi, true);
    view.setUint16(off + 8, e.df, true);
    view.setUint8(off + 10, e.flags);
    view.setUint8(off + 11, e.idfQ8);
    view.setUint32(off + 12, e.payloadOffset, true);
    view.setUint32(off + 16, e.bmwOffset, true);
  }

  let cur = denseOffset;
  for (const c of denseChunks) { out.set(c, cur); cur += c.byteLength; }
  for (const c of sparseChunks) { out.set(c, cur); cur += c.byteLength; }
  for (const c of bmwChunks) { out.set(c, cur); cur += c.byteLength; }

  return {
    buf: out,
    stats: {
      terms: entries.length,
      dense_terms: denseCount,
      sparse_terms: entries.length - denseCount,
      num_blocks: numBlocks,
      dense_bytes: denseOff,
      sparse_bytes: sparseOff,
      bmw_bytes: bmwOff,
      total_bytes: totalBytes,
    },
  };
}

// =============================================================================
// 8. Main Compiler Pipeline
// =============================================================================

async function main() {
  const t0 = performance.now();
  console.log('BibleResearch v4 Offline HREG + PredSim + R-MAC Compiler starting...');

  cleanDirFiles(OUT_V4_BUILD);
  cleanDirFiles(OUT_V4_STAGING);

  const headsBundle = JSON.parse(fs.readFileSync(HEADS_PATH, 'utf8'));
  const lexicon = JSON.parse(fs.readFileSync(path.join(V3_BUILD_DIR, 'sanitized-lexicon.json'), 'utf8'));
  const ontology = JSON.parse(fs.readFileSync(path.join(V3_BUILD_DIR, 'sense-ontology.json'), 'utf8'));
  const lxxAlign = JSON.parse(fs.readFileSync(path.join(V3_BUILD_DIR, 'lxx-alignment.json'), 'utf8'));

  const catalog = loadCanonicalCatalog();
  console.log(`Loaded canonical catalog (${NUM_VERSES} vv, ${catalog.mtTupleToVids.size} MT tuples) in ${Math.round(performance.now() - t0)}ms.`);

  const proxOracle = loadProximityAndWritePredSim(lexicon);
  console.log(`Built pred-sim.bin (${proxOracle.numStrongs} Strongs, ${proxOracle.numPairs} pairs, sim(H5414,G1325)=${proxOracle.simH5414G1325.toFixed(3)}, sim(H0157,G0025)=${proxOracle.simH0157G0025.toFixed(3)})`);

  const adjuncts = loadAdjunctTypes();
  const greekSenses = loadGreekWordSenses();
  const tipnr = loadTipnr(catalog.canonByTuple);
  const archOracle = loadOewnAndArchetypes(lexicon, ontology, lxxAlign, proxOracle.proxNeighbors);
  console.log(`Loaded dictionaries (adjuncts=${adjuncts.byHeadId.size}, grkSenses=${greekSenses.size}, oewnVerbs=${archOracle.verbSynsets.size}) in ${Math.round(performance.now() - t0)}ms.`);

  // Parse all MACULA Hebrew (929 chapters) & Greek (27 books) XMLs
  const hebFiles = fs.readdirSync(MACULA_HEB_DIR).filter(f => /^\d{2}-.*-lowfat\.xml$/.test(f)).sort();
  const grkFiles = fs.readdirSync(MACULA_GRK_DIR).filter(f => /^\d{2}-.*\.xml$/.test(f)).sort();

  const wordsByBook = new Map(); // bookId -> { wordsById, wordsByBareId }
  const clausesByVid = new Map(); // vid -> Clause[]
  let totalClauses = 0;
  let totalAramaicTokens = 0;

  const ingestFile = (dir, file, isGreek) => {
    const xmlText = fs.readFileSync(path.join(dir, file), 'utf8');
    const parsedXml = parseMaculaXml(xmlText, isGreek);
    const { wordsById, wordsByBareId, clauses } = parseFileWithS1S2S4(
      parsedXml,
      isGreek,
      headsBundle,
      adjuncts,
      greekSenses,
      catalog.usfmToBookId,
      catalog.mtTupleToVids,
      catalog.canonByTuple,
      catalog.verseTuples,
    );

    for (const w of wordsById.values()) {
      if (w.lang === 'A') totalAramaicTokens++;
      for (const vid of w.vids || []) {
        const b = catalog.verseTuples[vid]?.[0];
        if (!b) continue;
        let bk = wordsByBook.get(b);
        if (!bk) {
          bk = { wordsById: new Map(), wordsByBareId: new Map() };
          wordsByBook.set(b, bk);
        }
        bk.wordsById.set(w.id, w);
        bk.wordsByBareId.set(w.id.replace(/^[on]/, ''), w);
      }
    }
    for (const cl of clauses) {
      totalClauses++;
      for (const vid of cl.vids || []) {
        let arr = clausesByVid.get(vid);
        if (!arr) {
          arr = [];
          clausesByVid.set(vid, arr);
        }
        arr.push(cl);
      }
    }
  };

  for (const f of hebFiles) ingestFile(MACULA_HEB_DIR, f, false);
  for (const f of grkFiles) ingestFile(MACULA_GRK_DIR, f, true);
  console.log(`Parsed ${hebFiles.length} Heb + ${grkFiles.length} Grk XMLs (${totalClauses} clauses, ${totalAramaicTokens} Aramaic tokens) in ${Math.round(performance.now() - t0)}ms.`);

  // Segment 31,203 canonical verses into pericopes
  const { pericopes, vidToPericopes } = buildPericopes(catalog.verseTuples, clausesByVid);
  console.log(`Segmented ${NUM_VERSES} verses into ${pericopes.length} pericopes.`);

  // Verify 100% verse coverage
  let uncovered = 0;
  for (let vid = 1; vid <= NUM_VERSES; vid++) {
    if (vidToPericopes[(vid - 1) * 2] === 0) uncovered++;
  }
  if (uncovered > 0) throw new Error(`Uncovered verses detected: ${uncovered}`);

  // Compile HREGs and collect R-MAC features
  const hregs = new Array(pericopes.length);
  const rawFeatures = new Array(pericopes.length);
  const m2Df = new Map();
  let totalParticipants = 0;
  let totalEvents = 0;
  let totalHoEdges = 0;

  for (let i = 0; i < pericopes.length; i++) {
    const per = pericopes[i];
    const perClauses = [];
    const seenCl = new Set();
    for (const vid of per.vids) {
      for (const cl of clausesByVid.get(vid) || []) {
        if (!seenCl.has(cl.cid)) {
          seenCl.add(cl.cid);
          perClauses.push(cl);
        }
      }
    }
    const bkWords = wordsByBook.get(per.book) || { wordsById: new Map(), wordsByBareId: new Map() };
    const hreg = compilePericopeHreg(per, perClauses, bkWords.wordsById, bkWords.wordsByBareId, {
      lexicon,
      ontology,
      archOracle,
      tipnr,
      proxOracle,
      headsBundle,
    });
    hregs[i] = hreg;
    totalParticipants += hreg.participants.length;
    totalEvents += hreg.events.length;
    totalHoEdges += hreg.hoEdges.length;

    const feat = extractRmacFeaturesV4(hreg);
    rawFeatures[i] = feat;
    for (const h of feat.m2) {
      m2Df.set(h, (m2Df.get(h) || 0) + 1);
    }
  }
  console.log(`Compiled ${hregs.length} HREGs (participants=${totalParticipants}, events=${totalEvents}, hoEdges=${totalHoEdges}) in ${Math.round(performance.now() - t0)}ms.`);

  // Pack gzipped CompactHreg records into pack-00..05.bin + pericopes.bin
  const packChunks = Array.from({ length: NUM_PACK_FILES }, () => []);
  const packOffsets = new Array(NUM_PACK_FILES).fill(0);
  const perBin = Buffer.alloc(16 + pericopes.length * 16);
  for (let i = 0; i < 8; i++) perBin[i] = PER_MAGIC.charCodeAt(i);
  perBin.writeUInt32LE(1, 8);
  perBin.writeUInt32LE(pericopes.length, 12);

  const perChunkSpan = Math.ceil(pericopes.length / NUM_PACK_FILES);
  for (let i = 0; i < pericopes.length; i++) {
    const g = hregs[i];
    const encoded = encodeCompactHreg(g);
    // Sanity round-trip check on first 10 records
    if (i < 10) {
      const dec = decodeCompactHreg(encoded);
      if (dec.pericopeId !== g.pericopeId || dec.events.length !== g.events.length) {
        throw new Error(`HREG roundtrip mismatch at pericope ${g.pericopeId}`);
      }
    }
    const gz = zlib.gzipSync(encoded, { level: 6 });
    if (gz.byteLength > 65535) throw new Error(`Compressed HREG ${g.pericopeId} exceeds u16 length: ${gz.byteLength}`);
    const packIdx = Math.min(NUM_PACK_FILES - 1, Math.floor(i / perChunkSpan));
    const byteOff = packOffsets[packIdx];
    packChunks[packIdx].push(gz);
    packOffsets[packIdx] += gz.byteLength;

    const off = 16 + i * 16;
    perBin.writeUInt16LE(g.startVid, off);
    perBin.writeUInt16LE(g.endVid, off + 2);
    perBin[off + 4] = g.book & 0xff;
    perBin[off + 5] = g.genre & 0xff;
    perBin[off + 6] = g.events.length & 0xff;
    perBin[off + 7] = g.hoEdges.length & 0xff;
    perBin[off + 8] = packIdx & 0xff;
    perBin[off + 9] = g.esideTags !== 0 ? 1 : 0;
    perBin.writeUInt32LE(byteOff >>> 0, off + 10);
    perBin.writeUInt16LE(gz.byteLength, off + 14);
  }

  const manifestFiles = [proxOracle.predSimMeta];
  for (let p = 0; p < NUM_PACK_FILES; p++) {
    const packBuf = Buffer.concat(packChunks[p]);
    manifestFiles.push(writeDual(`hreg/pack-${String(p).padStart(2, '0')}.bin`, packBuf));
  }
  manifestFiles.push(writeDual('index/pericopes.bin', perBin));

  const vidMapBuf = Buffer.alloc(NUM_VERSES * 8);
  for (let i = 0; i < NUM_VERSES * 2; i++) {
    vidMapBuf.writeUInt32LE(vidToPericopes[i] >>> 0, i * 4);
  }
  manifestFiles.push(writeDual('index/vid-to-pericopes.bin', vidMapBuf));

  // Build BRV4MAC\0 (Goldilocks DF filter on M2: 2 <= df <= 0.06 * numPericopes)
  const maxM2Df = Math.floor(0.06 * pericopes.length);
  const buildMacPostings = (minM2Df) => {
    const postings = new Map();
    const relBoosted = new Set();
    const add = (key, pid, flags) => {
      let rec = postings.get(key);
      if (!rec) {
        rec = { pericopeIds: new Set(), flags };
        postings.set(key, rec);
      } else {
        rec.flags |= flags;
      }
      rec.pericopeIds.add(pid);
    };
    for (let i = 0; i < pericopes.length; i++) {
      const pid = pericopes[i].pericopeId;
      const g = hregs[i];
      if (g.hoEdges.some(h => h.hoType !== 'ORD') || g.esideTags !== 0) relBoosted.add(pid);
      const feat = rawFeatures[i];
      for (const f of feat.features) {
        if (f.family === 'M2') {
          const df = m2Df.get(f.key) || 0;
          if (df < minM2Df || df > maxM2Df) continue;
          add(f.key, pid, BMW_FLAG_ACTANT);
        } else if (f.family === 'M3') {
          add(f.key, pid, BMW_FLAG_CONCEPT);
        } else {
          add(f.key, pid, BMW_FLAG_ACTANT);
        }
      }
    }
    return { postings, relBoosted };
  };

  let minM2Df = 2;
  let { postings: macPostings, relBoosted } = buildMacPostings(minM2Df);
  let rmacBuf = buildRmacBmwIndexV4(macPostings, pericopes.length, {
    denseThreshold: 256,
    relBoostedPericopes: relBoosted,
  });
  if (rmacBuf.byteLength > MAX_ASSET_BYTES) {
    minM2Df = 3;
    ({ postings: macPostings, relBoosted } = buildMacPostings(minM2Df));
    rmacBuf = buildRmacBmwIndexV4(macPostings, pericopes.length, {
      denseThreshold: 256,
      relBoostedPericopes: relBoosted,
    });
  }
  const rmacBuilt = { buf: rmacBuf, termCount: macPostings.size };

  const rmacMeta = writeDual('index/rmac-bmw.bin', rmacBuilt.buf);
  manifestFiles.push(rmacMeta);

  const totalBytes = manifestFiles.reduce((s, f) => s + f.bytes, 0);
  const maxFile = manifestFiles.reduce((m, f) => (f.bytes > m.bytes ? f : m), { path: '', bytes: 0 });
  const manifest = {
    schema_version: 4,
    generated_at: new Date().toISOString(),
    license: 'CC BY 4.0 (MACULA Hebrew/Greek, Clear Proximity/Adjuncts/Senses, STEPBible TIPNR, OEWN 2025, BibleOntology) + CC0 1.0 + Apache-2.0',
    license_audit: '0 restricted UBS keys',
    stats: {
      canonical_verses: NUM_VERSES,
      pericopes: pericopes.length,
      participants: totalParticipants,
      events: totalEvents,
      ho_edges: totalHoEdges,
      aramaic_tokens: totalAramaicTokens,
      m2_min_df: minM2Df,
      m2_max_df: maxM2Df,
      rmac: rmacBuilt.stats,
      pred_sim: { strongs: proxOracle.numStrongs, pairs: proxOracle.numPairs },
    },
    file_count: manifestFiles.length + 1,
    total_bytes: totalBytes,
    max_file: maxFile,
    files: manifestFiles.sort((a, b) => a.path.localeCompare(b.path)),
  };
  assertNoRestrictedKeys(manifest, 'v4/manifest.json');
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2));
  for (const base of [OUT_V4_BUILD, OUT_V4_STAGING]) {
    fs.writeFileSync(path.join(base, 'manifest.json'), manifestBuf);
  }

  console.log(
    `v4 HREG build complete in ${Math.round(performance.now() - t0)}ms: ` +
    `${pericopes.length} pericopes, ${totalEvents} events, ${totalHoEdges} HO edges, ` +
    `rmac=${(rmacMeta.bytes / 1048576).toFixed(2)} MiB (${rmacBuilt.stats.terms} terms), ` +
    `total=${(totalBytes / 1048576).toFixed(2)} MiB, max=${maxFile.path} (${(maxFile.bytes / 1048576).toFixed(2)} MiB)`
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
