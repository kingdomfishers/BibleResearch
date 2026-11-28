#!/usr/bin/env node
/**
 * BibleResearch v4: ESIDE C1-C8 Discourse/Interpretation & Order-Flexible Splice Compiler
 *
 * Pure Node.js ESM; zero English regexes; zero restricted UBS keys.
 * Consumes ONLY CC BY 4.0 / CC0 / Apache-2.0 / PD local datasets:
 *   - MACULA Hebrew/Aramaic (WLC/lowfat/*.xml, preserving lang="A")
 *   - MACULA Greek (Nestle1904/lowfat/*.xml)
 *   - third_party/bibleontology/heads_and_lexicon.json
 *   - macula-greek/sources/Clear/adjunct-types/adjunct_type.json
 *   - .artifacts-r12/v3-build/lxx-alignment.json
 *   - .artifacts-r12/v3-build/sanitized-lexicon.json
 *   - C:\Projects\BibleResearch\.artifacts\geography\stepbible-tipnr.txt
 *   - catalog-books.json / catalog-verses.bin (or v1/catalog/metadata.json.gz)
 *   - v3/align/mt-lxx & v3/verses/
 *
 * Emits packed binary stores to BOTH:
 *   - .artifacts-r12/v4-build/v4/eside/
 *   - .artifacts-r12/staging-bundle/v4/eside/
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  KIDX_MAGIC,
  NUM_VERSES,
  PIDX_MAGIC,
  parsePackedIntIndex,
} from '../../src/relationships/v3-binary-index.ts';
import { alignTriTextualQuoteV4 } from '../../src/relationships/v3-verifiers.ts';
import { isLxxFunctionEquivalent } from '../../src/relationships/epistemic-taxonomy.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTIFACTS_R12 = path.join(ROOT, '.artifacts-r12');
const BUILD_V3 = path.join(ARTIFACTS_R12, 'v3-build');
const STAGING_V3 = path.join(ARTIFACTS_R12, 'staging-bundle/v3');
const OUT_BUILD_ESIDE = path.join(ARTIFACTS_R12, 'v4-build/v4/eside');
const OUT_STAGING_ESIDE = path.join(ARTIFACTS_R12, 'staging-bundle/v4/eside');

const SHARED_ARTIFACTS = 'C:\\Projects\\BibleResearch\\.artifacts';
const MACULA_HEB_DIR = path.join(SHARED_ARTIFACTS, 'sources/macula-hebrew/WLC/lowfat');
const MACULA_GRK_DIR = path.join(SHARED_ARTIFACTS, 'sources/macula-greek/Nestle1904/lowfat');
const ADJUNCT_PATH = path.join(SHARED_ARTIFACTS, 'sources/macula-greek/sources/Clear/adjunct-types/adjunct_type.json');
const TIPNR_PATH = path.join(SHARED_ARTIFACTS, 'geography/stepbible-tipnr.txt');
const HEADS_LEX_PATH = path.join(ROOT, 'third_party/bibleontology/heads_and_lexicon.json');
const LXX_ALIGN_PATH = path.join(BUILD_V3, 'lxx-alignment.json');
const SANITIZED_LEX_PATH = path.join(BUILD_V3, 'sanitized-lexicon.json');

const MAX_PACK_BYTES = 4_500_000; // <= 4.5 MiB per pack
const MAX_INTERP_EDGES_BYTES = 395_000; // < 400 KiB

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

// === Normalization & Morphological Helpers (Zero English) ===

const HEBREW_FINAL_MAP = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

function hebrewConsonants(raw) {
  const nfd = String(raw || '').normalize('NFD');
  let out = '';
  for (const ch of nfd) {
    const code = ch.charCodeAt(0);
    if (code >= 0x05d0 && code <= 0x05ea) {
      out += HEBREW_FINAL_MAP[ch] ?? ch;
    }
  }
  return out;
}

function hebrewNoMatresStem(raw) {
  const cons = hebrewConsonants(raw);
  if (cons.length <= 2) return cons;
  let out = cons[0];
  for (let i = 1; i < cons.length - 1; i++) {
    const c = cons[i];
    if (c === 'ו' || c === 'י') continue;
    out += c;
  }
  const last = cons[cons.length - 1];
  if (last !== 'ה' || out.length < 2) out += last;
  return out;
}

function normGreekPlain(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .trim();
}

function normStrongs4(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('lemma:')) s = s.slice(6);
  const m = /^([HGhg])0*(\d+)(?:[A-Za-z].*)?$/.exec(s);
  if (!m) return '';
  return m[1].toUpperCase() + m[2].padStart(4, '0');
}

function padMaculaHebStrongs(raw) {
  if (!raw) return '';
  const m = /^0*(\d+)(?:[A-Za-z].*)?$/.exec(String(raw).trim());
  if (!m) return '';
  return 'H' + m[1].padStart(4, '0');
}

function padMaculaGrkStrongs(raw) {
  if (!raw) return '';
  const m = /^0*(\d+)(?:[A-Za-z].*)?$/.exec(String(raw).trim());
  if (!m) return '';
  return 'G' + m[1].padStart(4, '0');
}

// === Catalog & V3 Verse / MT-LXX Loaders ===

function loadCatalog() {
  const booksJsonPath = path.join(STAGING_V3, 'index/catalog-books.json');
  const versesBinPath = path.join(STAGING_V3, 'index/catalog-verses.bin');
  const books = [];
  const versesCompact = [];

  if (fs.existsSync(booksJsonPath) && fs.existsSync(versesBinPath)) {
    const bp = JSON.parse(fs.readFileSync(booksJsonPath, 'utf8'));
    books.push(...(bp.books || []));
    const buf = fs.readFileSync(versesBinPath);
    const view = new Uint16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
    const n = Math.floor(view.length / 3);
    for (let i = 0; i < n; i++) {
      versesCompact.push([i + 1, view[i * 3], view[i * 3 + 1], view[i * 3 + 2]]);
    }
  } else {
    const metaPath = path.join(ARTIFACTS_R12, 'staging-bundle/v1/catalog/metadata.json.gz');
    const meta = JSON.parse(zlib.gunzipSync(fs.readFileSync(metaPath)).toString('utf8'));
    books.push(...(meta.books || []));
    versesCompact.push(...(meta.verses_compact || []));
  }

  const bookById = new Map();
  const bookByUsfm = new Map();
  for (const b of books) {
    bookById.set(b.id, b);
    bookByUsfm.set(b.usfm, b);
  }
  const refToVid = new Map();
  const vidMeta = new Map();
  const vidsByBook = new Map();
  for (const [vid, b, c, v] of versesCompact) {
    const bk = bookById.get(b);
    const usfm = bk?.usfm || `B${b}`;
    const ref = `${bk?.name || usfm} ${c}:${v}`;
    refToVid.set(`${usfm} ${c}:${v}`, vid);
    vidMeta.set(vid, { vid, book: b, chapter: c, verse: v, usfm, ref });
    if (!vidsByBook.has(b)) vidsByBook.set(b, []);
    vidsByBook.get(b).push(vid);
  }
  return { books, bookById, bookByUsfm, refToVid, vidMeta, vidsByBook };
}

function loadV3Verses() {
  const byVid = new Map();
  const buildVersesDir = path.join(BUILD_V3, 'v3/verses');
  if (fs.existsSync(buildVersesDir)) {
    for (const f of fs.readdirSync(buildVersesDir).filter((x) => /^chunk-\d+\.json\.gz$/.test(x)).sort()) {
      const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(buildVersesDir, f))).toString('utf8'));
      for (const [vidStr, v] of Object.entries(d.verses || {})) {
        const vid = Number(vidStr);
        byVid.set(vid, {
          vid,
          book: v.book,
          chapter: v.chapter,
          verse: v.verse,
          ref: v.ref,
          toks: (v.toks || []).map((t, i) => ({
            idx: typeof t.idx === 'number' ? t.idx : i,
            sf: t.sf || '',
            lm: t.lm || t.sf || '',
            s: normStrongs4(t.s),
            cl: t.cl || '',
            is_func: Boolean(t.is_func),
          })),
        });
      }
    }
    return byVid;
  }

  // Fallback: read packed v3/verses/verses.idx + pack-*.bin
  const stVersesDir = path.join(STAGING_V3, 'verses');
  const idx = parsePackedIntIndex(fs.readFileSync(path.join(stVersesDir, 'verses.idx')));
  const packs = new Map();
  for (let vid = 1; vid <= idx.maxId; vid++) {
    const off = 20 + vid * 8;
    const start = idx.view.getUint32(off, true);
    const meta = idx.view.getUint32(off + 4, true);
    const len = meta & 0x00ffffff;
    if (len === 0) continue;
    const fIdx = (meta >>> 24) & 0xff;
    let pBuf = packs.get(fIdx);
    if (!pBuf) {
      pBuf = fs.readFileSync(path.join(stVersesDir, `pack-${String(fIdx).padStart(2, '0')}.bin`));
      packs.set(fIdx, pBuf);
    }
    const v = JSON.parse(zlib.gunzipSync(pBuf.subarray(start, start + len)).toString('utf8'));
    byVid.set(vid, {
      vid,
      book: v.book,
      chapter: v.chapter,
      verse: v.verse,
      ref: v.ref,
      toks: (v.toks || []).map((t, i) => ({
        idx: typeof t.idx === 'number' ? t.idx : i,
        sf: t.sf || '',
        lm: t.lm || t.sf || '',
        s: normStrongs4(t.s),
        cl: t.cl || '',
        is_func: Boolean(t.is_func),
      })),
    });
  }
  return byVid;
}

function loadMtLxxData() {
  const mtLxxByVid = new Map();
  const buildAlignDir = path.join(BUILD_V3, 'v3/align');
  if (fs.existsSync(buildAlignDir)) {
    for (const f of fs.readdirSync(buildAlignDir).filter((x) => /^mt-lxx-\d+\.bin$/.test(x)).sort()) {
      const d = JSON.parse(fs.readFileSync(path.join(buildAlignDir, f), 'utf8'));
      for (const [vidStr, rec] of Object.entries(d.verses || {})) {
        mtLxxByVid.set(Number(vidStr), rec);
      }
    }
    return mtLxxByVid;
  }

  const stAlignDir = path.join(STAGING_V3, 'align');
  const idx = parsePackedIntIndex(fs.readFileSync(path.join(stAlignDir, 'mt-lxx.idx')));
  const packs = new Map();
  for (let vid = 1; vid <= idx.maxId; vid++) {
    const off = 20 + vid * 8;
    const start = idx.view.getUint32(off, true);
    const meta = idx.view.getUint32(off + 4, true);
    const len = meta & 0x00ffffff;
    if (len === 0) continue;
    const fIdx = (meta >>> 24) & 0xff;
    let pBuf = packs.get(fIdx);
    if (!pBuf) {
      pBuf = fs.readFileSync(path.join(stAlignDir, `mt-lxx-pack-${String(fIdx).padStart(2, '0')}.bin`));
      packs.set(fIdx, pBuf);
    }
    mtLxxByVid.set(vid, JSON.parse(zlib.gunzipSync(pBuf.subarray(start, start + len)).toString('utf8')));
  }
  return mtLxxByVid;
}

function loadTipnrIndex() {
  const byBs = new Map(); // H/Gxxxx -> Set<tipnrId>
  const byRefAndBs = new Map(); // "BOOK.C.V|Hxxxx" -> tipnrId
  if (!fs.existsSync(TIPNR_PATH)) return { byBs, byRefAndBs };

  const text = fs.readFileSync(TIPNR_PATH, 'utf8');
  let curEntityId = '';
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine) continue;
    if (rawLine.startsWith('$=')) continue;
    if (!rawLine.startsWith('–') && !rawLine.startsWith('@') && !rawLine.startsWith(' ') && !rawLine.startsWith('\t')) {
      const firstCol = rawLine.split('\t')[0]?.trim() || '';
      if (firstCol.includes('=')) {
        curEntityId = firstCol;
      }
      continue;
    }
    if (rawLine.startsWith('– Total\t') && curEntityId) {
      const cols = rawLine.split('\t');
      const strongCol = cols[3] || '';
      const refsCol = cols[4] || '';
      for (const m of strongCol.matchAll(/\b([HG]\d{4})/g)) {
        const bs = m[1];
        if (!byBs.has(bs)) byBs.set(bs, new Set());
        byBs.get(bs).add(curEntityId);
      }
      // Also capture explicit book.chap.verse mentions if concise
      const shortEntity = curEntityId.split('=')[0];
      for (const rm of refsCol.matchAll(/\b([1-3]?[A-Za-z]{2,3}\.\d+\.\d+)/g)) {
        for (const m of strongCol.matchAll(/\b([HG]\d{4})/g)) {
          byRefAndBs.set(`${rm[1]}|${m[1]}`, shortEntity);
        }
      }
    }
  }
  return { byBs, byRefAndBs };
}

// === Fast License-Clean MACULA XML Parser ===

const ATTR_PAIR_RE = /([\w:]+)="([^"]*)"/g;

function parseAttrs(attrStr) {
  const out = {};
  ATTR_PAIR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_PAIR_RE.exec(attrStr)) !== null) {
    switch (m[1]) {
      case 'xml:id':
      case 'ref':
      case 'class':
      case 'pos':
      case 'type':
      case 'lemma':
      case 'normalized':
      case 'strong':
      case 'strongnumberx':
      case 'stem':
      case 'person':
      case 'gender':
      case 'number':
      case 'state':
      case 'role':
      case 'lang':
      case 'mood':
      case 'tense':
      case 'voice':
      case 'case':
      case 'subjref':
      case 'participantref':
      case 'referent':
      case 'rule':
      case 'Rule':
      case 'head':
      case 'clauseType':
      case 'unit':
      case 'id':
        out[m[1]] = m[2];
        break;
    }
  }
  return out;
}

/**
 * Parses a MACULA lowfat XML file into sentence trees (`<wg>`, `<w>`, `<milestone>`).
 * Explicitly skips restricted UBS keys and English glosses.
 */
function parseMaculaXmlFile(filePath, isHebrew) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const tagRe = /<\/?(sentence|milestone|wg|w)\b([^>]*)>/g;
  const sentences = [];
  let curSent = null;
  let stack = [];
  let curVerseRef = '';

  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    const full = m[0];
    const tag = m[1];
    let attrStr = m[2];
    const selfClose = attrStr.endsWith('/');
    if (selfClose) attrStr = attrStr.slice(0, -1);
    const isClose = full.charCodeAt(1) === 47; // '/'

    if (tag === 'sentence') {
      if (!isClose) {
        const attrs = parseAttrs(attrStr);
        curSent = { id: attrs.id || '', rootNodes: [], words: [], milestones: [] };
        stack = [];
        sentences.push(curSent);
      } else {
        curSent = null;
        stack = [];
      }
      continue;
    }

    if (!curSent) continue;

    if (tag === 'milestone') {
      if (!isClose) {
        const attrs = parseAttrs(attrStr);
        if (attrs.unit === 'verse' && attrs.id) {
          curVerseRef = attrs.id;
          curSent.milestones.push(attrs.id);
        }
      }
      continue;
    }

    if (tag === 'wg') {
      if (!isClose) {
        const attrs = parseAttrs(attrStr);
        const node = {
          kind: 'wg',
          class: attrs.class || '',
          rule: attrs.rule || attrs.Rule || '',
          role: attrs.role || '',
          head: attrs.head === 'true',
          clauseType: attrs.clauseType || '',
          children: [],
          parent: stack.length > 0 ? stack[stack.length - 1] : null,
        };
        if (node.parent) node.parent.children.push(node);
        else curSent.rootNodes.push(node);
        if (!selfClose) stack.push(node);
      } else if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }

    if (tag === 'w') {
      if (!isClose) {
        const attrs = parseAttrs(attrStr);
        let text = '';
        if (!selfClose) {
          const endIdx = xml.indexOf('</w>', tagRe.lastIndex);
          if (endIdx >= 0) {
            text = xml.slice(tagRe.lastIndex, endIdx).trim();
            tagRe.lastIndex = endIdx + 4;
          }
        }
        const refRaw = attrs.ref || '';
        const vRef = refRaw.includes('!') ? refRaw.split('!')[0] : (curVerseRef || curSent.id);
        const bs = isHebrew
          ? padMaculaHebStrongs(attrs.strongnumberx)
          : padMaculaGrkStrongs(attrs.strong);
        const wNode = {
          kind: 'w',
          xmlId: attrs['xml:id'] || '',
          vRef,
          refAttr: refRaw,
          sf: text,
          lm: attrs.lemma || text,
          normSf: attrs.normalized || text,
          bs,
          lang: attrs.lang || (isHebrew ? 'H' : 'G'),
          cls: (attrs.class || '').toLowerCase(),
          pos: (attrs.pos || '').toLowerCase(),
          type: (attrs.type || '').toLowerCase(),
          stem: (attrs.stem || '').toLowerCase(),
          role: attrs.role || '',
          state: (attrs.state || '').toLowerCase(),
          mood: (attrs.mood || '').toLowerCase(),
          tense: (attrs.tense || '').toLowerCase(),
          voice: (attrs.voice || '').toLowerCase(),
          case: (attrs.case || '').toLowerCase(),
          person: (attrs.person || '').toLowerCase(),
          number: (attrs.number || '').toLowerCase(),
          subjref: attrs.subjref || '',
          participantref: attrs.participantref || '',
          referent: attrs.referent || '',
          parent: stack.length > 0 ? stack[stack.length - 1] : null,
          sentIdx: curSent.words.length,
        };
        curSent.words.push(wNode);
        if (wNode.parent) wNode.parent.children.push(wNode);
        else curSent.rootNodes.push(wNode);
      }
    }
  }

  return sentences;
}

function collectSubtreeWords(node, out = []) {
  if (!node) return out;
  if (node.kind === 'w') {
    out.push(node);
    return out;
  }
  for (const ch of node.children || []) collectSubtreeWords(ch, out);
  return out;
}

// === Canonical Verse Mapping for MACULA Verses ===

function alignMaculaToCanonicalVids(maculaVersesByBook, catalog, v3Verses) {
  const xmlRefToVid = new Map();
  const vidToMaculaWords = new Map();

  for (const [bookId, macList] of maculaVersesByBook.entries()) {
    const canonVids = catalog.vidsByBook.get(bookId) || [];
    if (bookId >= 40) {
      // NT: direct USFM ref lookup (mapping JUD -> JDE)
      for (const mv of macList) {
        const usfm = mv.usfm === 'JUD' ? 'JDE' : mv.usfm;
        const vid = catalog.refToVid.get(`${usfm} ${mv.chap}:${mv.verse}`);
        if (vid) {
          xmlRefToVid.set(mv.key, vid);
          if (!vidToMaculaWords.has(vid)) vidToMaculaWords.set(vid, []);
          vidToMaculaWords.get(vid).push(...mv.words);
        }
      }
      continue;
    }

    // OT: sequential alignment reconciling Psalm :0 headings & Joel/Malachi versification offsets
    let cPtr = 0;
    const scorePair = (mWords, vToks) => {
      const mSet = new Set(mWords.map((w) => w.bs).filter(Boolean));
      let hits = 0;
      for (const t of vToks) {
        if (t.s && mSet.has(t.s)) hits++;
      }
      return hits;
    };

    for (const mv of macList) {
      // Score direct canonical C:V match first (prevents book-wide drift after Hebrew/English chapter-boundary shifts like Zech 2->3)
      const directVid = catalog.refToVid.get(`${mv.usfm} ${mv.chap}:${mv.verse}`);
      let directScore = -1;
      let directPos = -1;
      if (directVid) {
        const dvObj = v3Verses.get(directVid);
        if (dvObj) directScore = scorePair(mv.words, dvObj.toks);
        directPos = canonVids.indexOf(directVid);
      }

      // Window search around cPtr (for Psalm :0 headings & Joel/Malachi versification offsets)
      let bestPos = -1;
      let bestScore = -1;
      const maxProbe = Math.min(canonVids.length - 1, cPtr + 6);
      const minProbe = Math.max(0, cPtr - 2);
      for (let p = minProbe; p <= maxProbe; p++) {
        const vObj = v3Verses.get(canonVids[p]);
        if (!vObj) continue;
        const sc = scorePair(mv.words, vObj.toks);
        if (sc > bestScore) {
          bestScore = sc;
          bestPos = p;
        }
      }

      if (directVid && directScore >= Math.max(2, Math.ceil(mv.words.length * 0.55)) && directScore >= bestScore) {
        xmlRefToVid.set(mv.key, directVid);
        if (!vidToMaculaWords.has(directVid)) vidToMaculaWords.set(directVid, []);
        vidToMaculaWords.get(directVid).push(...mv.words);
        if (directPos >= 0) cPtr = directPos + 1;
      } else if (bestPos >= 0 && bestScore >= 1) {
        const vid = canonVids[bestPos];
        xmlRefToVid.set(mv.key, vid);
        if (!vidToMaculaWords.has(vid)) vidToMaculaWords.set(vid, []);
        vidToMaculaWords.get(vid).push(...mv.words);
        cPtr = bestPos + 1;
      } else if (directVid) {
        xmlRefToVid.set(mv.key, directVid);
        if (!vidToMaculaWords.has(directVid)) vidToMaculaWords.set(directVid, []);
        vidToMaculaWords.get(directVid).push(...mv.words);
        if (directPos >= 0) cPtr = directPos + 1;
      }
    }
  }

  return { xmlRefToVid, vidToMaculaWords };
}

// === POS & Stopword Gates (Original-Language Only) ===

const FUNC_CLASSES = new Set([
  'conj', 'cj', 'prep', 'det', 'art', 'ptcl', 'rel', 'om', 'intj', 'pron', 'adv',
  'conjunction', 'preposition', 'article', 'particle', 'pronoun', 'interjection', 'adverb',
]);

const SKIP_CONTENT_STRONGS = new Set([
  'H0853', 'H0854', 'H4480', 'H0413', 'H5921', 'H0518', 'H3588', 'H0834', 'H1931', 'H0859',
  'H0589', 'H2088', 'H2063', 'H0428', 'H1992', 'H3605', 'H3808', 'H3541', 'H3651', 'H4100',
  'H0559', 'H1696', 'H1961', 'H7200', 'H3190', 'H1836', 'H1768', 'H2009', 'H2005', 'H0001',
  'H0871', 'H2050', 'H1886', 'H9033', 'H3509', 'H5204', 'H2967', 'H0408',
  'G3588', 'G2532', 'G1161', 'G0846', 'G1722', 'G1519', 'G3754', 'G1473', 'G4771', 'G3778',
  'G3739', 'G3748', 'G5100', 'G5101', 'G1438', 'G1510', 'G1063', 'G3361', 'G3756', 'G3761',
  'G0235', 'G1537', 'G0575', 'G2596', 'G3326', 'G4012', 'G4314', 'G5228', 'G5613', 'G3004',
  'G1492', 'G2400', 'G3568', 'G2531', 'G1163', 'G3767', 'G3779', 'G5618', 'G2509', 'G3303',
  'G5037', 'G2228', 'G1487', 'G1437', 'G2443', 'G3704', 'G1565', 'G5124', 'G3956',
]);

const TEMPORAL_IDIOM_STRONGS = new Set([
  'H3117', // יוֹם (day)
  'H8141', // שָׁנָה (year)
  'H6256', // עֵת (time)
  'H5769', // עוֹלָם (forever)
  'H5704', // עַד (unto)
  'H2088', // זֶה (this)
]);

const NAMING_CLAUSE_SKIP = new Set([
  ...TEMPORAL_IDIOM_STRONGS,
  'H0853', 'H0854', 'H4480', 'H0413', 'H5921', 'H0518', 'H3588', 'H0834', 'H1931', 'H0859',
  'H0589', 'H2063', 'H0428', 'H1992', 'H3605', 'H3808', 'H3541', 'H3651', 'H4100',
  'H0559', 'H1696', 'H1961', 'H7121', 'H8034', 'H3205', 'H2029', 'H0430', 'H3068', 'H0376',
  'H0802', 'H1121', 'H1323', 'H0517', 'H4725', 'H5892', 'H0776', 'H1004',
]);

function isNominalToken(w) {
  if (!w || !w.bs || /^H900/.test(w.bs) || SKIP_CONTENT_STRONGS.has(w.bs)) return false;
  return w.cls === 'noun' || w.cls === 'adj' || w.cls === 'num' || w.cls === 'nmpr' || w.cls === 'subs';
}

function isContentToken(w) {
  if (!w || !w.bs || /^H900/.test(w.bs) || SKIP_CONTENT_STRONGS.has(w.bs)) return false;
  return !FUNC_CLASSES.has(w.cls);
}

function isGreekPrepositionGoverned(w) {
  let p = w?.parent;
  while (p) {
    if (p.kind === 'wg') {
      if (p.class === 'pp' || p.rule === 'PrepNp') return true;
      if (p.class === 'cl') return false;
    }
    p = p.parent;
  }
  return false;
}

// === Main Build ===

function main() {
  const t0 = performance.now();

  // 1. Load reference & lexicon data
  const catalog = loadCatalog();
  const v3Verses = loadV3Verses();
  const mtLxxByVid = loadMtLxxData();
  const headsAndLex = JSON.parse(fs.readFileSync(HEADS_LEX_PATH, 'utf8'));
  const adjunctData = JSON.parse(fs.readFileSync(ADJUNCT_PATH, 'utf8'));
  const sanitizedLex = JSON.parse(fs.readFileSync(SANITIZED_LEX_PATH, 'utf8'));
  const tipnr = loadTipnrIndex();

  const lexProfiles = sanitizedLex.profiles || {};
  const stepGlossOf = (bs) => {
    const p = lexProfiles[bs];
    return p?.gl || p?.top_verse_gloss || '';
  };

  // Compute canonical df/idf across all 31,203 v3 verses
  const dfByStrongs = new Map();
  for (const v of v3Verses.values()) {
    const seen = new Set();
    for (const t of v.toks) {
      if (t.s && !seen.has(t.s)) {
        seen.add(t.s);
        dfByStrongs.set(t.s, (dfByStrongs.get(t.s) || 0) + 1);
      }
    }
  }
  const dfOf = (bs) => dfByStrongs.get(bs) ?? 999;

  // Build Greek adjunct comparison map (adjunct_type.json)
  const comparisonAdjunctHeadIds = new Map(); // head xml:id -> adjunct entry
  for (const entry of adjunctData) {
    if (entry.field_type === 'Comparison' && entry.node_head) {
      comparisonAdjunctHeadIds.set(entry.node_head, entry);
    }
  }

  // 2. Parse MACULA Hebrew/Aramaic & Greek XMLs
  const hebFiles = fs
    .readdirSync(MACULA_HEB_DIR)
    .filter((f) => /^\d{2}-[A-Za-z0-9]+-\d{3}-lowfat\.xml$/.test(f))
    .sort();
  const grkFiles = fs
    .readdirSync(MACULA_GRK_DIR)
    .filter((f) => /^\d{2}-[a-z0-9]+\.xml$/.test(f))
    .sort();

  const maculaVersesByBook = new Map(); // bookId -> [{ key, usfm, chap, verse, words }]
  const allSentences = []; // { bookId, isHebrew, sent }

  const registerSentences = (files, dir, isHebrew) => {
    for (const f of files) {
      const mBook = /^(\d{2})-/.exec(f);
      const bookId = mBook ? Number(mBook[1]) + (isHebrew ? 0 : 39) : 0;
      const sents = parseMaculaXmlFile(path.join(dir, f), isHebrew);
      const vMap = new Map();
      for (const s of sents) {
        allSentences.push({ bookId, isHebrew, sent: s });
        for (const w of s.words) {
          if (!w.vRef) continue;
          const rm = /^([1-3]?[A-Za-z]+)\s+(\d+):(\d+)$/.exec(w.vRef);
          if (!rm) continue;
          const key = `${rm[1]} ${rm[2]}:${rm[3]}`;
          let mv = vMap.get(key);
          if (!mv) {
            mv = { key, usfm: rm[1], chap: Number(rm[2]), verse: Number(rm[3]), words: [] };
            vMap.set(key, mv);
          }
          mv.words.push(w);
        }
      }
      if (!maculaVersesByBook.has(bookId)) maculaVersesByBook.set(bookId, []);
      maculaVersesByBook.get(bookId).push(...vMap.values());
    }
  };

  registerSentences(hebFiles, MACULA_HEB_DIR, true);
  registerSentences(grkFiles, MACULA_GRK_DIR, false);

  const { xmlRefToVid, vidToMaculaWords } = alignMaculaToCanonicalVids(maculaVersesByBook, catalog, v3Verses);

  // Build xmlId -> word lookup for subjref / participantref / referent resolution
  const xmlIdToWord = new Map();
  for (const { sent } of allSentences) {
    for (const w of sent.words) {
      if (w.xmlId) xmlIdToWord.set(w.xmlId, w);
    }
  }
  const vidOfWord = (w) => (w?.vRef ? xmlRefToVid.get(w.vRef) : undefined);

  console.error(
    `Parsed MACULA XML (${allSentences.length} sentences, ${xmlIdToWord.size} xml:ids, ${vidToMaculaWords.size} aligned vids) in ${Math.round(performance.now() - t0)}ms.`,
  );

  // Resolve referent / participantref / subjref chain (bounded depth <= 3)
  const resolveAntecedentWords = (w, allowPronounFallback = true) => {
    const refsRaw = (w.referent || w.participantref || w.subjref || '').trim();
    if (!refsRaw) return [];
    const out = [];
    for (const id of refsRaw.split(/\s+/)) {
      let target = xmlIdToWord.get(id);
      if (!target) continue;
      if (FUNC_CLASSES.has(target.cls) && allowPronounFallback) {
        const subRef = (target.referent || target.participantref || target.subjref || '').trim().split(/\s+/)[0];
        if (subRef && xmlIdToWord.has(subRef)) target = xmlIdToWord.get(subRef);
      }
      if (target && isNominalToken(target)) out.push(target);
      else if (target?.parent?.kind === 'wg') {
        const subNouns = collectSubtreeWords(target.parent).filter(isNominalToken);
        out.push(...subNouns.slice(0, 3));
      }
    }
    return out;
  };

  // === ESIDE Storage & Deduplication ===
  const records = [];
  const seenIds = new Set();
  const recordsByVid = new Map(); // vid -> EsideRecord[]

  const addRecord = (rec) => {
    if (!rec || seenIds.has(rec.id)) return;
    assertNoRestrictedKeys(rec, rec.id);
    seenIds.add(rec.id);
    records.push(rec);
    const vids = new Set([rec.verse_id, ...(rec.witness_vids || []), ...(rec.target_vids || [])]);
    for (const vid of vids) {
      if (vid >= 1 && vid <= NUM_VERSES) {
        let arr = recordsByVid.get(vid);
        if (!arr) { arr = []; recordsByVid.set(vid, arr); }
        arr.push(rec);
      }
    }
  };

  const fmtTokLabel = (w) => {
    const gl = stepGlossOf(w.bs);
    return gl ? `${w.lm || w.sf} (${w.bs}, "${gl}")` : `${w.lm || w.sf} (${w.bs})`;
  };

  const fmtStrongsSummary = (arr, wordsByBs) =>
    arr.slice(0, 4).map((bs) => {
      const w = wordsByBs?.get(bs);
      const gl = stepGlossOf(bs);
      return w ? fmtTokLabel(w) : (gl ? `${bs} ("${gl}")` : bs);
    }).join(' + ');

  // Precompute chapter-level vision/dream/parable/sign-act context flags (original-language triggers only)
  const VISION_CHAPTER_STRONGS = new Set([
    'H2472', 'H2377', 'H2376', 'H4758', 'H4912', 'H2420', 'H6623', 'H6591', 'H0226', 'H4159',
    'G3850', 'G3466', 'G3705', 'G0238', 'G4960',
  ]);
  const PROPHETIC_VISION_BOOKS = new Set([1, 23, 24, 26, 27, 30, 38, 40, 41, 42, 43, 44, 46, 48, 58, 66]);
  const visionChapters = new Set(); // "book:chap"
  for (const [vid, words] of vidToMaculaWords.entries()) {
    const meta = catalog.vidMeta.get(vid);
    if (!meta) continue;
    for (const w of words) {
      if (VISION_CHAPTER_STRONGS.has(w.bs) || (w.bs === 'H7200' && w.stem === 'hiphil')) {
        visionChapters.add(`${meta.book}:${meta.chapter}`);
        break;
      }
    }
  }

  // Helper to get content/nominal tokens for a subtree, resolving pronoun referents if empty
  const extractRoleTokens = (node, allowVerbs = false, allowAntecedent = true) => {
    const ws = collectSubtreeWords(node);
    const direct = ws.filter((w) => (allowVerbs ? isContentToken(w) : isNominalToken(w)));
    if (direct.length > 0) return direct;
    if (allowAntecedent) {
      const resolved = [];
      for (const w of ws) {
        resolved.push(...resolveAntecedentWords(w));
      }
      if (resolved.length > 0) return resolved;
    }
    return [];
  };

  // =========================================================================
  // C1 & C2 & C4 & C5 & C6 & C8: Syntax-Tree Extraction over MACULA Sentences
  // =========================================================================

  // Collect all <wg class="cl"> nodes recursively
  const collectClauses = (node, out = []) => {
    if (!node || node.kind !== 'wg') return out;
    if (node.class === 'cl') out.push(node);
    for (const ch of node.children || []) collectClauses(ch, out);
    return out;
  };

  // Track C1/C2 decode records per chapter for C5 Report<->Decode alignment
  const decodeRecordsByChap = new Map(); // "book:chap" -> EsideRecord[]

  for (const { bookId, isHebrew, sent } of allSentences) {
    const sentVids = [...new Set(sent.words.map(vidOfWord).filter(Boolean))];
    if (sentVids.length === 0) continue;

    const clauses = [];
    for (const rn of sent.rootNodes) collectClauses(rn, clauses);

    if (!isHebrew) {
      // === GREEK C1: <wg class="cl"> with role="vc" G1510 + role="s" + role="p" ===
      for (let ci = 0; ci < clauses.length; ci++) {
        const cl = clauses[ci];
        const ch = cl.children || [];
        const vcNode = ch.find((c) => c.role === 'vc' && collectSubtreeWords(c).some((w) => w.bs === 'G1510'));
        if (!vcNode) continue;

        const sNode = ch.find((c) => c.role === 's');
        const pNode = ch.find((c) => c.role === 'p');
        if (!sNode || !pNode) continue;

        const sWordsRaw = collectSubtreeWords(sNode);
        const pWordsRaw = collectSubtreeWords(pNode);
        const sIsEgo = sWordsRaw.some((w) => w.bs === 'G1473');
        let symWords = sWordsRaw.filter((w) => isNominalToken(w) && !isGreekPrepositionGoverned(w) && w.bs !== 'G3466');

        // Resolve relative/demonstrative referent on subject (e.g. Gal 4:24 αὗται, Rev 4:5 οἵ, Rev 5:6 οἵ)
        if (symWords.length === 0) {
          for (const sw of sWordsRaw) {
            if (sw.bs === 'G3739' || sw.bs === 'G3778' || sw.bs === 'G3748' || sw.bs === 'G1520') {
              symWords.push(...resolveAntecedentWords(sw));
            }
          }
        }
        // Handle Rev 1:20 / clause-local topic inside parent ClCl2 (e.g., μυστήριον... ἀστέρες / λυχνίαι)
        if (sIsEgo && symWords.length === 0) {
          symWords = sWordsRaw.filter((w) => w.bs === 'G1473');
        }

        const refWords = pWordsRaw.filter((w) => isNominalToken(w) || (w.cls === 'verb' && w.mood === 'participle' && isContentToken(w)));
        if (symWords.length === 0 || refWords.length === 0) continue;

        // Specificity gate for C1 Greek copula
        const firstWord = sWordsRaw[0] || pWordsRaw[0] || collectSubtreeWords(vcNode)[0];
        const vid = vidOfWord(firstWord) || sentVids[0];
        const meta = catalog.vidMeta.get(vid);
        if (!meta) continue;
        const inVisionChap = visionChapters.has(`${meta.book}:${meta.chapter}`);
        const hasRareSym = symWords.some((w) => w.bs === 'G1473' || dfOf(w.bs) <= 260);
        const hasSymbolicRef = refWords.some((w) => dfOf(w.bs) <= 750 || w.bs === 'G2316' || w.bs === 'G2962' || w.bs === 'G5547' || w.bs === 'G2424');
        if (!inVisionChap && !hasRareSym) continue;
        if (!hasSymbolicRef && !inVisionChap) continue;
        // Skip literal geographical/biographical predicates unless in allegory/vision context (Gal 4:25 Ἄγαρ Σινᾶ ὄρος)
        const symStrongs = [...new Set(symWords.map((w) => w.bs))];
        const refStrongs = [...new Set(refWords.map((w) => w.bs))];
        if (symStrongs.every((s) => refStrongs.includes(s))) continue;

        const wMap = new Map([...symWords, ...refWords].map((w) => [w.bs, w]));
        const witnessVids = [...new Set([...symWords, ...refWords].map(vidOfWord).filter(Boolean))];
        if (!witnessVids.includes(vid)) witnessVids.unshift(vid);

        const id = `v4:eside:c1:${vid}:${ci}`;
        const rec = {
          id,
          eside_class: 'C1',
          verse_id: vid,
          ref: meta.ref,
          language: 'grc',
          epistemic_class: inVisionChap ? 'authorial_typology_or_quote' : 'direct_textual_evidence',
          symbol_strongs: symStrongs,
          referent_strongs: refStrongs,
          summary: `${fmtStrongsSummary(symStrongs, wMap)} = ${fmtStrongsSummary(refStrongs, wMap)}`,
          witness_vids: witnessVids,
          target_vids: witnessVids,
        };
        addRecord(rec);
        if (inVisionChap) {
          const ck = `${meta.book}:${meta.chapter}`;
          if (!decodeRecordsByChap.has(ck)) decodeRecordsByChap.set(ck, []);
          decodeRecordsByChap.get(ck).push(rec);
        }
      }

      // === GREEK C2: Explicit Typological & Metalanguage Declarations ===
      const C2_GRK_TRIGGERS = new Set(['G5179', 'G0499', 'G0238', 'G4960', 'G4639', 'G5262', 'G4153']);
      for (const w of sent.words) {
        if (!C2_GRK_TRIGGERS.has(w.bs)) continue;
        const vid = vidOfWord(w) || sentVids[0];
        const meta = catalog.vidMeta.get(vid);
        if (!meta) continue;
        const clNode = (() => {
          let p = w.parent;
          while (p && p.class !== 'cl') p = p.parent;
          return p;
        })();
        const scopeWords = clNode ? collectSubtreeWords(clNode) : sent.words;
        const idxInScope = scopeWords.indexOf(w);
        const prevVerseWords = vidToMaculaWords.get(vid - 1) || [];

        let symWords = [];
        let refWords = [];
        if (w.bs === 'G0499') {
          // Antitype (1 Pet 3:21, Heb 9:24)
          refWords = scopeWords.slice(Math.max(0, idxInScope + 1)).filter(isNominalToken).slice(0, 4);
          symWords = [
            ...scopeWords.slice(Math.max(0, idxInScope - 6), idxInScope).filter((x) => isNominalToken(x) && dfOf(x.bs) <= 400),
            ...prevVerseWords.filter((x) => isNominalToken(x) && dfOf(x.bs) <= 180),
          ].slice(0, 4);
        } else if (w.bs === 'G4960') {
          // συστοιχεῖ (Gal 4:25: subject/Hagar <-> dative/Jerusalem)
          symWords = scopeWords.filter((x) => isNominalToken(x) && x !== w && (x.case === 'nominative' || x.sentIdx < w.sentIdx)).slice(0, 3);
          if (symWords.length === 0) symWords = prevVerseWords.filter((x) => isNominalToken(x) && dfOf(x.bs) <= 300).slice(-2);
          refWords = scopeWords.filter((x) => isNominalToken(x) && x.sentIdx > w.sentIdx).slice(0, 4);
        } else {
          // τύπος, ἀλληγορέω, σκιά, ὑπόδειγμα, πνευματικῶς
          const nearContent = scopeWords.filter((x) => x !== w && isNominalToken(x));
          const leftC = nearContent.filter((x) => x.sentIdx < w.sentIdx);
          const rightC = nearContent.filter((x) => x.sentIdx > w.sentIdx);
          if (leftC.length > 0 && rightC.length > 0) {
            symWords = leftC.slice(0, 3);
            refWords = rightC.slice(0, 4);
          } else {
            symWords = [...nearContent.slice(0, 2), ...resolveAntecedentWords(scopeWords[0] || w)].slice(0, 3);
            refWords = nearContent.slice(Math.min(2, nearContent.length - 1)).slice(0, 3);
          }
          if (symWords.length === 0) symWords = prevVerseWords.filter((x) => isNominalToken(x) && dfOf(x.bs) <= 300).slice(-3);
          if (refWords.length === 0) refWords = [w];
        }

        const symStrongs = [...new Set(symWords.map((x) => x.bs).filter(Boolean))];
        const refStrongs = [...new Set(refWords.map((x) => x.bs).filter(Boolean))];
        if (symStrongs.length === 0 || refStrongs.length === 0) continue;
        const wMap = new Map([...symWords, ...refWords, w].map((x) => [x.bs, x]));

        addRecord({
          id: `v4:eside:c2:${vid}:${w.bs}:${w.sentIdx}`,
          eside_class: 'C2',
          verse_id: vid,
          ref: meta.ref,
          language: 'grc',
          trigger_strongs: w.bs,
          epistemic_class: 'authorial_typology_or_quote',
          symbol_strongs: symStrongs,
          referent_strongs: refStrongs,
          summary: `${w.lm} (${w.bs}): ${fmtStrongsSummary(symStrongs, wMap)} <-> ${fmtStrongsSummary(refStrongs, wMap)}`,
          witness_vids: prevVerseWords.length && w.bs === 'G0499' ? [vid - 1, vid] : [vid],
          target_vids: [vid],
        });
      }

      // === GREEK C4: Glosses (μεθερμηνεύω/ἑρμηνεύω/τουτέστιν) & Narrator Meta-Comments (λέγω/σημαίνω + περί) ===
      for (let wi = 0; wi < sent.words.length; wi++) {
        const w = sent.words[wi];
        const vid = vidOfWord(w) || sentVids[0];
        const meta = catalog.vidMeta.get(vid);
        if (!meta) continue;

        if (w.bs === 'G3177' || w.bs === 'G2059' || w.bs === 'G5123') {
          const leftNom = sent.words.slice(Math.max(0, wi - 8), wi).filter(isNominalToken);
          const rightNom = sent.words.slice(wi + 1, Math.min(sent.words.length, wi + 14)).filter(isNominalToken);
          const ant = leftNom.length === 0 ? sent.words.slice(Math.max(0, wi - 4), wi).flatMap((x) => resolveAntecedentWords(x)) : [];
          const prevNom = (leftNom.length === 0 && ant.length === 0) ? (vidToMaculaWords.get(vid - 1) || []).filter((x) => isNominalToken(x) && dfOf(x.bs) <= 300).slice(-2) : [];
          const symW = (leftNom.length ? leftNom : (ant.length ? ant : prevNom)).slice(-3);
          const refW = rightNom.slice(0, 6);
          if (symW.length > 0 && refW.length > 0) {
            const symS = [...new Set(symW.map((x) => x.bs))];
            const refS = [...new Set(refW.map((x) => x.bs))];
            const wMap = new Map([...symW, ...refW, w].map((x) => [x.bs, x]));
            addRecord({
              id: `v4:eside:c4:gloss:${vid}:${wi}`,
              eside_class: 'C4',
              verse_id: vid,
              ref: meta.ref,
              language: 'grc',
              trigger_strongs: w.bs,
              epistemic_class: 'direct_textual_evidence',
              symbol_strongs: symS,
              referent_strongs: refS,
              summary: `${w.lm} (${w.bs}): ${fmtStrongsSummary(symS, wMap)} -> ${fmtStrongsSummary(refS, wMap)}`,
              witness_vids: prevNom.length ? [vid - 1, vid] : [vid],
              target_vids: [vid],
            });
          }
        }

        // Narrator comment: λέγω/λαλέω/σημαίνω + περί (G4012)
        if ((w.bs === 'G3004' || w.bs === 'G2980' || w.bs === 'G4591') && wi + 1 < sent.words.length) {
          const periIdx = sent.words.findIndex((x, idx) => idx > wi && idx <= wi + 5 && x.bs === 'G4012');
          if (periIdx >= 0) {
            const refW = sent.words.slice(periIdx + 1, periIdx + 7).filter(isNominalToken).slice(0, 4);
            const leftSym = sent.words.slice(Math.max(0, wi - 5), wi).flatMap((x) => isNominalToken(x) ? [x] : resolveAntecedentWords(x));
            const prevV = (vidToMaculaWords.get(vid - 1) || []).filter((x) => isNominalToken(x) && dfOf(x.bs) <= 350).slice(-2);
            const symW = (leftSym.length ? leftSym : prevV).slice(0, 3);
            if (refW.length > 0) {
              const symS = symW.length ? [...new Set(symW.map((x) => x.bs))] : [w.bs];
              const refS = [...new Set(refW.map((x) => x.bs))];
              const wMap = new Map([...symW, ...refW, w].map((x) => [x.bs, x]));
              addRecord({
                id: `v4:eside:c4:meta:${vid}:${wi}`,
                eside_class: 'C4',
                verse_id: vid,
                ref: meta.ref,
                language: 'grc',
                trigger_strongs: `${w.bs}+G4012`,
                epistemic_class: 'direct_textual_evidence',
                symbol_strongs: symS,
                referent_strongs: refS,
                summary: `${w.lm}+περί: ${fmtStrongsSummary(symS, wMap)} -> ${fmtStrongsSummary(refS, wMap)}`,
                witness_vids: prevV.length && leftSym.length === 0 ? [vid - 1, vid] : [vid],
                target_vids: [vid],
              });
            }
          }
        }
      }

      // === GREEK C6: Naming Etiology (καλέω G2564 + ὄνομα G3686 + γάρ G1063) ===
      const kaleoIdx = sent.words.findIndex((w) => w.bs === 'G2564');
      const onomaIdx = sent.words.findIndex((w, i) => w.bs === 'G3686' && kaleoIdx >= 0 && Math.abs(i - kaleoIdx) <= 6);
      const garIdx = sent.words.findIndex((w, i) => w.bs === 'G1063' && onomaIdx >= 0 && i > onomaIdx);
      if (kaleoIdx >= 0 && onomaIdx >= 0 && garIdx >= 0) {
        const namedTok = sent.words.slice(onomaIdx + 1, garIdx).find((w) => w.cls === 'noun' && w.type === 'proper');
        const reasonToks = sent.words.slice(garIdx + 1).filter((w) => isContentToken(w) && dfOf(w.bs) <= 450).slice(0, 4);
        if (namedTok && reasonToks.length > 0) {
          const vid = vidOfWord(namedTok) || sentVids[0];
          const meta = catalog.vidMeta.get(vid);
          if (meta) {
            const refS = [...new Set(reasonToks.map((x) => x.bs))];
            const wMap = new Map([[namedTok.bs, namedTok], ...reasonToks.map((x) => [x.bs, x])]);
            addRecord({
              id: `v4:eside:c6:${vid}:${namedTok.bs}`,
              eside_class: 'C6',
              verse_id: vid,
              ref: meta.ref,
              language: 'grc',
              epistemic_class: 'direct_textual_evidence',
              symbol_strongs: [namedTok.bs],
              referent_strongs: refS,
              summary: `${fmtTokLabel(namedTok)} <- ${fmtStrongsSummary(refS, wMap)}`,
              witness_vids: [vid],
              target_vids: [vid],
            });
          }
        }
      }

      // === GREEK C8: Syntactic Simile Tuples (adjunct_type Comparison & ὡς/ὥσπερ + NP) ===
      for (const w of sent.words) {
        const isCompAdj = comparisonAdjunctHeadIds.has(w.xmlId);
        const isCompMarker = w.bs === 'G5613' || w.bs === 'G5618' || w.bs === 'G2509';
        if (!isCompAdj && !isCompMarker) continue;
        if (!w.parent || w.parent.kind !== 'wg') continue;

        const grpWords = collectSubtreeWords(w.parent);
        const vehicles = grpWords.filter((x) => x !== w && isNominalToken(x) && dfOf(x.bs) <= 500);
        if (vehicles.length === 0) continue;

        let clNode = w.parent.class === 'cl' ? w.parent.parent : w.parent;
        while (clNode && clNode.class !== 'cl') clNode = clNode.parent;
        if (!clNode) clNode = w.parent;
        const clWords = collectSubtreeWords(clNode);
        const vehSet = new Set(grpWords);
        const tenors = clWords.filter((x) => !vehSet.has(x) && isContentToken(x) && dfOf(x.bs) <= 700).slice(0, 3);
        if (tenors.length === 0) continue;

        const vid = vidOfWord(w) || sentVids[0];
        const meta = catalog.vidMeta.get(vid);
        if (!meta) continue;
        const tenorS = [...new Set(tenors.map((x) => x.bs))];
        const vehS = [...new Set(vehicles.map((x) => x.bs))];
        if (tenorS.every((s) => vehS.includes(s))) continue;
        const wMap = new Map([...tenors, ...vehicles].map((x) => [x.bs, x]));
        addRecord({
          id: `v4:eside:c8:${vid}:${w.sentIdx}`,
          eside_class: 'C8',
          verse_id: vid,
          ref: meta.ref,
          language: 'grc',
          marker: w.bs || w.lm,
          epistemic_class: 'direct_textual_evidence',
          symbol_strongs: tenorS,
          referent_strongs: vehS,
          tenor_strongs: tenorS,
          vehicle_strongs: vehS,
          summary: `${fmtStrongsSummary(tenorS, wMap)} ~[${w.lm}]~ ${fmtStrongsSummary(vehS, wMap)}`,
          witness_vids: [vid],
          target_vids: [vid],
        });
      }
    } else {
      // === HEBREW / ARAMAIC SYNTAX EXTRACTION (preserving lang="A") ===
      const langTag = sent.words.some((w) => w.lang === 'A') ? 'arc' : 'hbo';

      // C1: Verbless equative clauses (S-P / P-S / ClCl2 topic-comment) inside vision/dream/parable/sign-act scope
      for (let ci = 0; ci < clauses.length; ci++) {
        const cl = clauses[ci];
        const ch = cl.children || [];
        const vid = vidOfWord(collectSubtreeWords(cl)[0]) || sentVids[0];
        const meta = catalog.vidMeta.get(vid);
        if (!meta) continue;
        const inVisionChap = visionChapters.has(`${meta.book}:${meta.chapter}`);

        // Pattern A: ClCl2 (topic Np2CL + comment P-S/S-P/V-S, skipping leading vocative if 3+ children) e.g. Gen 41:26, Ezek 37:11, Dan 5:26-28
        if ((cl.rule === 'ClCl2' || cl.rule === 'ClCl') && ch.length >= 2) {
          const c0 = ch.length >= 3 ? ch[ch.length - 2] : ch[0];
          const c1 = ch.length >= 3 ? ch[ch.length - 1] : ch[1];
          const symW = collectSubtreeWords(c0).filter(isNominalToken);
          const refW = collectSubtreeWords(c1).filter(isContentToken);
          const hasTopicDecodeCue =
            inVisionChap ||
            collectSubtreeWords(cl).some((w) => w.bs === 'H1931' || w.bs === 'H1992' || w.bs === 'H1836' || w.bs === 'H6591');
          if (hasTopicDecodeCue && symW.length > 0 && refW.length > 0 && symW.some((w) => dfOf(w.bs) <= 500)) {
            const symS = [...new Set(symW.map((w) => w.bs))];
            const refS = [...new Set(refW.map((w) => w.bs))].slice(0, 5);
            if (!symS.every((s) => refS.includes(s))) {
              const wMap = new Map([...symW, ...refW].map((w) => [w.bs, w]));
              const rec = {
                id: `v4:eside:c1:${vid}:cl2_${ci}`,
                eside_class: 'C1',
                verse_id: vid,
                ref: meta.ref,
                language: langTag,
                epistemic_class: 'authorial_typology_or_quote',
                symbol_strongs: symS,
                referent_strongs: refS,
                summary: `${fmtStrongsSummary(symS, wMap)} = ${fmtStrongsSummary(refS, wMap)}`,
                witness_vids: [vid],
                target_vids: [vid],
              };
              addRecord(rec);
              const ck = `${meta.book}:${meta.chapter}`;
              if (!decodeRecordsByChap.has(ck)) decodeRecordsByChap.set(ck, []);
              decodeRecordsByChap.get(ck).push(rec);
              continue;
            }
          }
        }

        // Pattern B: Verbless S-P / P-S / S-PrCop-P inside vision/prophetic/sign-act scope
        const hasFiniteVerb = ch.some((c) => c.role === 'v' && collectSubtreeWords(c).some((w) => w.cls === 'verb' && w.bs !== 'H1961'));
        const sNode = ch.find((c) => c.role === 's');
        const pNode = ch.find((c) => c.role === 'p');
        if (!hasFiniteVerb && sNode && pNode && (inVisionChap || PROPHETIC_VISION_BOOKS.has(bookId))) {
          const sWordsRaw = collectSubtreeWords(sNode);
          const pWordsRaw = collectSubtreeWords(pNode);
          const hasDemOrCop =
            sWordsRaw.some((w) => w.bs === 'H1931' || w.bs === 'H1992' || w.bs === 'H0428' || w.bs === 'H2088' || w.bs === 'H2063' || w.bs === 'H1836') ||
            pWordsRaw.some((w) => w.bs === 'H1931' || w.bs === 'H1992' || w.bs === 'H1836');
          let symW = extractRoleTokens(sNode, false, true);
          let refW = extractRoleTokens(pNode, false, true);
          // For demonstrative-initial P-S like Ezek 5:5 "זֹאת יְרוּשָׁלַ͏ִם" or Ezek 37:11 "הָעֲצָמוֹת הָאֵלֶּה כָּל־בֵּית יִשְׂרָאֵל הֵמָּה"
          if (symW.length === 0 && hasDemOrCop) {
            const pAnt = pWordsRaw.flatMap((w) => resolveAntecedentWords(w));
            if (pAnt.length > 0 && refW.length > 0) {
              symW = pAnt;
            } else {
              const prevSym = (vidToMaculaWords.get(vid - 1) || []).filter((w) => isNominalToken(w) && dfOf(w.bs) <= 260).slice(-2);
              if (prevSym.length > 0) symW = prevSym;
            }
          }
          if (refW.length === 0 && hasDemOrCop) {
            refW = extractRoleTokens(sNode, false, true);
          }

          if (symW.length > 0 && refW.length > 0 && (hasDemOrCop || inVisionChap)) {
            const symS = [...new Set(symW.map((w) => w.bs))];
            const refS = [...new Set(refW.map((w) => w.bs))];
            const hasRare = symS.some((s) => dfOf(s) <= 280) || refS.some((s) => dfOf(s) <= 280);
            if (hasRare && !symS.every((s) => refS.includes(s))) {
              const wMap = new Map([...symW, ...refW].map((w) => [w.bs, w]));
              const rec = {
                id: `v4:eside:c1:${vid}:sp_${ci}`,
                eside_class: 'C1',
                verse_id: vid,
                ref: meta.ref,
                language: langTag,
                epistemic_class: inVisionChap ? 'authorial_typology_or_quote' : 'direct_textual_evidence',
                symbol_strongs: symS,
                referent_strongs: refS,
                summary: `${fmtStrongsSummary(symS, wMap)} = ${fmtStrongsSummary(refS, wMap)}`,
                witness_vids: [vid],
                target_vids: [vid],
              };
              addRecord(rec);
              if (inVisionChap) {
                const ck = `${meta.book}:${meta.chapter}`;
                if (!decodeRecordsByChap.has(ck)) decodeRecordsByChap.set(ck, []);
                decodeRecordsByChap.get(ck).push(rec);
              }
            }
          }
        }
      }

      // === HEBREW C1/C5 Construct-Metaphor Clothing & Vision Removal Explanatory Discourse (Isa 61:10, Zech 3:4) ===
      // 1) Construct-genitive metaphorical clothing/artifact phrases (NPofNP: concrete garment/robe + abstract salvation/righteousness/praise)
      const GARMENT_ARTIFACT_STRONGS = new Set(['H0899', 'H4598', 'H3830', 'H6287', 'H5850', 'H3627', 'H4254']);
      const ABSTRACT_COVENANT_STRONGS = new Set(['H3468', 'H3444', 'H6666', 'H6664', 'H8416', 'H7068', 'H3519', 'H5771', 'H2617', 'H0571']);
      const scanNpOfNp = (node) => {
        if (!node || node.kind !== 'wg') return;
        if (node.rule === 'NPofNP' && node.children?.length >= 2) {
          const headW = collectSubtreeWords(node.children[0]).find((w) => GARMENT_ARTIFACT_STRONGS.has(w.bs));
          const depW = collectSubtreeWords(node.children[1]).find((w) => ABSTRACT_COVENANT_STRONGS.has(w.bs));
          if (headW && depW) {
            const vid = vidOfWord(headW) || sentVids[0];
            const meta = catalog.vidMeta.get(vid);
            if (meta) {
              const wMap = new Map([[headW.bs, headW], [depW.bs, depW]]);
              addRecord({
                id: `v4:eside:c1:${vid}:construct_${headW.bs}_${depW.bs}`,
                eside_class: 'C1',
                verse_id: vid,
                ref: meta.ref,
                language: langTag,
                epistemic_class: 'direct_textual_evidence',
                symbol_strongs: [headW.bs],
                referent_strongs: [depW.bs],
                summary: `${fmtStrongsSummary([headW.bs], wMap)} = ${fmtStrongsSummary([depW.bs], wMap)}`,
                witness_vids: [vid],
                target_vids: [vid],
              });
            }
          }
        }
        for (const ch of node.children || []) scanNpOfNp(ch);
      };
      for (const rn of sent.rootNodes) scanNpOfNp(rn);

      // 2) Vision/Sign-act Imperative-to-Explanatory-Action Parallelism (e.g. Zech 3:4 removal of filthy garments = removal of iniquity)
      if (PROPHETIC_VISION_BOOKS.has(bookId)) {
        const garmentWords = sent.words.filter((w) => GARMENT_ARTIFACT_STRONGS.has(w.bs) || w.bs === 'H6674');
        const moralWords = sent.words.filter((w) => ABSTRACT_COVENANT_STRONGS.has(w.bs));
        const hasRemovalOrClothe = sent.words.some((w) => w.bs === 'H5493' || w.bs === 'H5674' || w.bs === 'H3847');
        const hasSeeOrSay = sent.words.some((w) => (w.bs === 'H7200' && w.mood === 'imperative') || w.bs === 'H7200' || w.bs === 'H0559');
        if (garmentWords.length > 0 && moralWords.length > 0 && hasRemovalOrClothe && hasSeeOrSay) {
          const vid = vidOfWord(garmentWords[0]) || sentVids[0];
          const meta = catalog.vidMeta.get(vid);
          if (meta) {
            const symToks = [...garmentWords, ...sent.words.filter((w) => w.bs === 'H5493' || w.bs === 'H3847')];
            const refToks = [...moralWords, ...sent.words.filter((w) => w.bs === 'H5674')];
            const symS = [...new Set(symToks.map((w) => w.bs))];
            const refS = [...new Set(refToks.map((w) => w.bs))];
            const wMap = new Map([...symToks, ...refToks].map((w) => [w.bs, w]));
            addRecord({
              id: `v4:eside:c1:${vid}:vision_discourse`,
              eside_class: 'C1',
              verse_id: vid,
              ref: meta.ref,
              language: langTag,
              epistemic_class: 'authorial_typology_or_quote',
              symbol_strongs: symS,
              referent_strongs: refS,
              summary: `${fmtStrongsSummary(symS, wMap)} -> ${fmtStrongsSummary(refS, wMap)}`,
              witness_vids: [vid],
              target_vids: [vid],
            });
          }
        }
      }

      // === HEBREW / ARAMAIC C2: פִּתְרוֹן (H6623), פְּשַׁר (H6591), מָשָׁל+חִידָה (H4912+H2420), Sign-Act אוֹת/מוֹפֵת ===
      for (let wi = 0; wi < sent.words.length; wi++) {
        const w = sent.words[wi];
        const vid = vidOfWord(w) || sentVids[0];
        const meta = catalog.vidMeta.get(vid);
        if (!meta) continue;

        if (w.bs === 'H6591' || w.bs === 'H6623') {
          // Aramaic פְּשַׁר (Dan 2, 4, 5, 7) or Hebrew פִּתְרוֹן (Gen 40-41)
          const windowWords = [];
          for (let dv = -1; dv <= 3; dv++) {
            const vw = vidToMaculaWords.get(vid + dv);
            if (!vw) continue;
            const vm = catalog.vidMeta.get(vid + dv);
            if (vm && vm.book === meta.book && vm.chapter === meta.chapter) {
              windowWords.push(...vw);
            }
          }
          // Special structure for Dan 5:25-28 (MENE/TEKEL/PERES: H4484, H8625, H6537)
          const inscribedTerms = windowWords.filter((x) => x.bs === 'H4484' || x.bs === 'H8625' || x.bs === 'H6537');
          const symW = inscribedTerms.length >= 2
            ? inscribedTerms
            : windowWords.filter((x) => isNominalToken(x) && dfOf(x.bs) <= 220 && x.bs !== 'H6591' && x.bs !== 'H6623' && x.bs !== 'H4406').slice(0, 5);
          const refW = windowWords
            .filter((x) => isContentToken(x) && !symW.some((s) => s.bs === x.bs) && x.bs !== 'H6591' && x.bs !== 'H6623' && dfOf(x.bs) <= 450)
            .slice(0, 7);

          if (symW.length > 0 && refW.length > 0) {
            const symS = [...new Set(symW.map((x) => x.bs))];
            const refS = [...new Set(refW.map((x) => x.bs))];
            const wMap = new Map([...symW, ...refW, w].map((x) => [x.bs, x]));
            const witnessVids = [...new Set(windowWords.map(vidOfWord).filter(Boolean))];
            addRecord({
              id: `v4:eside:c2:${vid}:${w.bs}:${wi}`,
              eside_class: 'C2',
              verse_id: vid,
              ref: meta.ref,
              language: langTag,
              trigger_strongs: w.bs,
              epistemic_class: 'authorial_typology_or_quote',
              symbol_strongs: symS,
              referent_strongs: refS,
              summary: `${w.lm} (${w.bs}): ${fmtStrongsSummary(symS, wMap)} -> ${fmtStrongsSummary(refS, wMap)}`,
              witness_vids: witnessVids.length ? witnessVids : [vid],
              target_vids: witnessVids.length ? witnessVids : [vid],
            });
          }
        } else if ((w.bs === 'H0226' || w.bs === 'H4159' || w.bs === 'H2420') && PROPHETIC_VISION_BOOKS.has(bookId)) {
          const nearNoms = sent.words.filter((x) => x !== w && isNominalToken(x) && dfOf(x.bs) <= 350);
          if (nearNoms.length >= 2) {
            const symW = nearNoms.slice(0, Math.ceil(nearNoms.length / 2));
            const refW = nearNoms.slice(Math.ceil(nearNoms.length / 2));
            const symS = [...new Set(symW.map((x) => x.bs))];
            const refS = [...new Set(refW.map((x) => x.bs))];
            const wMap = new Map([...nearNoms, w].map((x) => [x.bs, x]));
            addRecord({
              id: `v4:eside:c2:${vid}:${w.bs}:${wi}`,
              eside_class: 'C2',
              verse_id: vid,
              ref: meta.ref,
              language: langTag,
              trigger_strongs: w.bs,
              epistemic_class: 'authorial_typology_or_quote',
              symbol_strongs: symS,
              referent_strongs: refS,
              summary: `${w.lm} (${w.bs}): ${fmtStrongsSummary(symS, wMap)} -> ${fmtStrongsSummary(refS, wMap)}`,
              witness_vids: [vid],
              target_vids: [vid],
            });
          }
        }
      }

      // === HEBREW C4: Cross-Chapter Anaphoric Identifications (e.g. Ezek 10:20 -> Ezek 1) ===
      const hasPerceive = sent.words.some((w) => w.bs === 'H3045' || w.bs === 'H7200');
      const hasVerblessId = clauses.some((cl) => {
        const ch = cl.children || [];
        return (
          ch.some((c) => c.role === 's') &&
          ch.some((c) => c.role === 'p') &&
          collectSubtreeWords(cl).some((w) => w.bs === 'H1931' || w.bs === 'H1992')
        );
      });
      if (hasPerceive && hasVerblessId && PROPHETIC_VISION_BOOKS.has(bookId)) {
        const vid = sentVids[0];
        const meta = catalog.vidMeta.get(vid);
        if (meta) {
          // Find rare entity + rare place/proper noun or subjref pointing to an earlier chapter in same book
          const rareNoms = sent.words.filter((w) => isNominalToken(w) && dfOf(w.bs) <= 200);
          const subjTargets = sent.words
            .map((w) => (w.subjref ? xmlIdToWord.get(w.subjref.split(/\s+/)[0]) : null))
            .filter(Boolean);
          const earlierRefVids = new Set();
          for (const st of subjTargets) {
            const svid = vidOfWord(st);
            const sm = svid ? catalog.vidMeta.get(svid) : null;
            if (sm && sm.book === meta.book && sm.chapter < meta.chapter) {
              earlierRefVids.add(svid);
            }
          }
          // Also search earlier chapters in same book sharing >= 2 rare nouns (e.g., H2416 + H3529 in Ezek 1:1-5)
          const rareBs = [...new Set(rareNoms.map((w) => w.bs))];
          if (rareBs.length >= 2) {
            const bookVids = catalog.vidsByBook.get(meta.book) || [];
            for (const ovid of bookVids) {
              if (ovid >= vid) break;
              const om = catalog.vidMeta.get(ovid);
              if (!om || om.chapter >= meta.chapter) continue;
              const oWords = vidToMaculaWords.get(ovid) || [];
              const oSet = new Set(oWords.map((w) => w.bs));
              const shared = rareBs.filter((b) => oSet.has(b));
              if (shared.length >= 2) {
                earlierRefVids.add(ovid);
                if (earlierRefVids.size >= 4) break;
              }
            }
          }
          if (earlierRefVids.size > 0 && rareBs.length >= 2) {
            const predNoms = clauses
              .filter((cl) => (cl.children || []).some((c) => c.role === 'p') && (cl.children || []).some((c) => c.role === 's'))
              .flatMap((cl) => collectSubtreeWords(cl.children.find((c) => c.role === 'p')).filter(isNominalToken));
            const extraRareRefs = sent.words.filter((w) => isNominalToken(w) && dfOf(w.bs) <= 200);
            const symW = rareNoms.slice(0, 2);
            const refW = [...predNoms, ...extraRareRefs].filter((w) => !symW.some((s) => s.bs === w.bs)).slice(0, 5);
            const symS = [...new Set(symW.map((w) => w.bs))];
            const refS = refW.length ? [...new Set(refW.map((w) => w.bs))] : rareBs.slice(-2);
            const targetVids = [...earlierRefVids].sort((a, b) => a - b);
            const wMap = new Map([...symW, ...refW].map((w) => [w.bs, w]));
            addRecord({
              id: `v4:eside:c4:xchap:${vid}`,
              eside_class: 'C4',
              verse_id: vid,
              ref: meta.ref,
              language: langTag,
              epistemic_class: 'direct_textual_evidence',
              symbol_strongs: symS,
              referent_strongs: refS,
              summary: `${fmtStrongsSummary(symS, wMap)} = ${fmtStrongsSummary(refS, wMap)} (-> ${catalog.vidMeta.get(targetVids[0])?.ref || ''})`,
              witness_vids: [vid, ...targetVids],
              target_vids: targetVids,
            });
          }
        }
      }

      // === HEBREW C8: Syntactic Simile Tuples (<wg class="pp" rule="PrepNp"> with כְּ, non-temporal) ===
      const scanPrepSimiles = (node) => {
        if (!node || node.kind !== 'wg') return;
        if (node.class === 'pp' && (node.rule === 'PrepNp' || node.rule === 'PpPp')) {
          const ws = collectSubtreeWords(node);
          const kPrep = ws.find((w) => (w.cls === 'prep') && hebrewConsonants(w.lm) === 'כ');
          if (kPrep) {
            const vehicles = ws.filter(
              (w) => w !== kPrep && isNominalToken(w) && !TEMPORAL_IDIOM_STRONGS.has(w.bs) && dfOf(w.bs) <= 450,
            );
            if (vehicles.length > 0) {
              let clNode = node.parent;
              while (clNode && clNode.class !== 'cl') clNode = clNode.parent;
              if (clNode) {
                const clWords = collectSubtreeWords(clNode);
                const vehSet = new Set(ws);
                const tenors = clWords.filter(
                  (w) => !vehSet.has(w) && isContentToken(w) && !TEMPORAL_IDIOM_STRONGS.has(w.bs) && dfOf(w.bs) <= 650,
                ).slice(0, 3);
                if (tenors.length > 0) {
                  const vid = vidOfWord(kPrep) || sentVids[0];
                  const meta = catalog.vidMeta.get(vid);
                  if (meta) {
                    const tenorS = [...new Set(tenors.map((w) => w.bs))];
                    const vehS = [...new Set(vehicles.map((w) => w.bs))];
                    if (!tenorS.every((s) => vehS.includes(s))) {
                      const wMap = new Map([...tenors, ...vehicles].map((w) => [w.bs, w]));
                      addRecord({
                        id: `v4:eside:c8:${vid}:${kPrep.sentIdx}`,
                        eside_class: 'C8',
                        verse_id: vid,
                        ref: meta.ref,
                        language: langTag,
                        marker: kPrep.bs || 'H9003',
                        epistemic_class: 'direct_textual_evidence',
                        symbol_strongs: tenorS,
                        referent_strongs: vehS,
                        tenor_strongs: tenorS,
                        vehicle_strongs: vehS,
                        summary: `${fmtStrongsSummary(tenorS, wMap)} ~[כְּ]~ ${fmtStrongsSummary(vehS, wMap)}`,
                        witness_vids: [vid],
                        target_vids: [vid],
                      });
                    }
                  }
                }
              }
            }
          }
        }
        for (const ch of node.children || []) scanPrepSimiles(ch);
      };
      for (const rn of sent.rootNodes) scanPrepSimiles(rn);
    }
  }

  // =========================================================================
  // Verse-Level Passes: C3 (Correlatives), C5 (Vision Q&A + Report<->Decode), C6 (Hebrew Etiologies)
  // =========================================================================
  for (let vid = 1; vid <= NUM_VERSES; vid++) {
    const words = vidToMaculaWords.get(vid);
    const meta = catalog.vidMeta.get(vid);
    if (!words || !meta) continue;
    const isNt = meta.book >= 40;
    const langTag = isNt ? 'grc' : (words.some((w) => w.lang === 'A') ? 'arc' : 'hbo');

    // === C3: Explicit Correlative Structural Analogies ===
    if (isNt) {
      // Greek: ὥσπερ/καθώς/καθάπερ ... οὕτως
      const compIdx = words.findIndex((w) => w.bs === 'G5618' || w.bs === 'G2531' || w.bs === 'G2509');
      if (compIdx >= 0) {
        let targetVid = -1;
        let outosIdx = words.findIndex((w, i) => i > compIdx && w.bs === 'G3779');
        if (outosIdx >= 0) {
          targetVid = vid;
        } else {
          const nextW = vidToMaculaWords.get(vid + 1);
          const nextM = catalog.vidMeta.get(vid + 1);
          if (nextW && nextM && nextM.book === meta.book) {
            const ni = nextW.findIndex((w) => w.bs === 'G3779');
            if (ni >= 0 && ni <= 4) {
              targetVid = vid + 1;
              outosIdx = ni;
            }
          }
        }
        if (targetVid > 0) {
          const baseWords = (targetVid === vid ? words.slice(compIdx + 1, outosIdx) : words.slice(compIdx + 1)).filter(isContentToken);
          const tgtWords = (targetVid === vid ? words.slice(outosIdx + 1) : (vidToMaculaWords.get(targetVid) || []).slice(outosIdx + 1)).filter(isContentToken);
          if (baseWords.length >= 2 && tgtWords.length >= 2) {
            const symS = [...new Set(baseWords.map((w) => w.bs))].slice(0, 5);
            const refS = [...new Set(tgtWords.map((w) => w.bs))].slice(0, 5);
            const wMap = new Map([...baseWords, ...tgtWords].map((w) => [w.bs, w]));
            const targetVids = targetVid === vid ? [vid] : [vid, targetVid];
            addRecord({
              id: `v4:eside:c3:${vid}`,
              eside_class: 'C3',
              verse_id: vid,
              ref: targetVid === vid ? meta.ref : `${meta.ref}-${catalog.vidMeta.get(targetVid).verse}`,
              language: 'grc',
              marker: `${words[compIdx].lm}...οὕτως`,
              epistemic_class: 'direct_textual_evidence',
              symbol_strongs: symS,
              referent_strongs: refS,
              base_vids: [vid],
              target_vids: [targetVid],
              witness_vids: targetVids,
              summary: `${fmtStrongsSummary(symS, wMap)} <=[${words[compIdx].lm}...οὕτως]=> ${fmtStrongsSummary(refS, wMap)}`,
            });
          }
        }
      }
    } else {
      // Hebrew: כַּאֲשֶׁר (כְּ + אֲשֶׁר) or כְּ ... כֵּן (H3651) in same verse or vid+1
      let hasKaasher = false;
      for (let i = 0; i < words.length - 1; i++) {
        if (words[i].cls === 'prep' && hebrewConsonants(words[i].lm) === 'כ' && words[i + 1].bs === 'H0834') {
          hasKaasher = true;
          break;
        }
      }
      if (hasKaasher) {
        const next1 = vidToMaculaWords.get(vid + 1);
        const next1M = catalog.vidMeta.get(vid + 1);
        const kenInSame = words.findIndex((w) => w.bs === 'H3651');
        const kenInNext = next1 && next1M && next1M.book === meta.book ? next1.findIndex((w) => w.bs === 'H3651') : -1;
        const targetVid = kenInNext >= 0 && kenInNext <= 3 ? vid + 1 : (kenInSame >= 4 ? vid : -1);
        if (targetVid > 0) {
          const baseToks = (targetVid === vid ? words.slice(0, kenInSame) : words).filter(isContentToken);
          const tgtToks = (targetVid === vid ? words.slice(kenInSame + 1) : next1.slice(kenInNext + 1)).filter(isContentToken);
          const baseSet = new Set(baseToks.map((w) => w.bs));
          const distinctBase = baseToks.filter((w) => isNominalToken(w) && dfOf(w.bs) <= 450 && !tgtToks.some((t) => t.bs === w.bs));
          // Filter out generic "as commanded, so did" compliance boilerplate
          const isBoilerplateCompliance = baseSet.has('H6680') && tgtToks.some((t) => t.bs === 'H6213') && distinctBase.length === 0;
          if (!isBoilerplateCompliance && distinctBase.length >= 1 && baseToks.length >= 2 && tgtToks.length >= 2) {
            const symS = [...new Set(baseToks.filter(isNominalToken).map((w) => w.bs))].slice(0, 5);
            const refS = [...new Set(tgtToks.filter(isNominalToken).map((w) => w.bs))].slice(0, 5);
            if (symS.length > 0 && refS.length > 0) {
              const wMap = new Map([...baseToks, ...tgtToks].map((w) => [w.bs, w]));
              const spanRef = targetVid === vid ? meta.ref : `${meta.ref}-${next1M.verse}`;
              addRecord({
                id: `v4:eside:c3:${vid}`,
                eside_class: 'C3',
                verse_id: vid,
                ref: spanRef,
                language: langTag,
                marker: 'כַּאֲשֶׁר...כֵּן',
                epistemic_class: 'direct_textual_evidence',
                symbol_strongs: symS,
                referent_strongs: refS,
                base_vids: [vid],
                target_vids: [targetVid],
                witness_vids: targetVid === vid ? [vid] : [vid, targetVid],
                summary: `${fmtStrongsSummary(symS, wMap)} <=[כַּאֲשֶׁר...כֵּן]=> ${fmtStrongsSummary(refS, wMap)}`,
              });
            }
          }
        }
      }
    }

    // === HEBREW C5: Vision Q&A ("מָה־אַתָּה רֹאֶה" / "מָה־אֵלֶּה") -> same/next 0..2 verses decoding ===
    if (!isNt) {
      const hasMa = words.some((w) => w.bs === 'H4100');
      const hasSeeOrDem = words.some((w) => w.bs === 'H7200' || w.bs === 'H0428');
      const maIdx = words.findIndex((w) => w.bs === 'H4100');
      const seeOrDemNear = maIdx >= 0 && words.slice(maIdx, maIdx + 5).some((w) => w.bs === 'H7200' || w.bs === 'H0428');
      if (hasMa && hasSeeOrDem && seeOrDemNear) {
        // Check same verse (Amos 8:2: "מָה־אַתָּה רֹאֶה עָמוֹס ... כְּלוּב קָיִץ -> וַיֹּאמֶר יְהוָה אֵלַי בָּא הַקֵּץ") OR next 1-2 verses
        const sayAfterIdx = words.findIndex((w, i) => i > maIdx + 2 && w.bs === 'H0559' && words.slice(i + 1, i + 4).some((x) => x.bs === 'H3068'));
        let symW = [];
        let refW = [];
        const witnessVids = [];
        const prev1 = vidToMaculaWords.get(vid - 1);
        const prev1M = catalog.vidMeta.get(vid - 1);
        if (prev1 && prev1M && prev1M.book === meta.book && prev1.some((w) => w.bs === 'H2009' || (w.bs === 'H7200' && w.stem === 'hiphil'))) {
          witnessVids.push(vid - 1);
        }
        witnessVids.push(vid);

        if (sayAfterIdx > maIdx) {
          symW = words.slice(maIdx + 1, sayAfterIdx).filter((w) => isNominalToken(w) && dfOf(w.bs) <= 300);
          refW = words.slice(sayAfterIdx + 1).filter((w) => isContentToken(w) && dfOf(w.bs) <= 350).slice(0, 5);
        } else {
          symW = words.filter((w) => isNominalToken(w) && dfOf(w.bs) <= 280);
          if (symW.length === 0 && prev1) {
            symW = prev1.filter((w) => isNominalToken(w) && dfOf(w.bs) <= 280);
          }
          for (const dv of [1, 2]) {
            const nw = vidToMaculaWords.get(vid + dv);
            const nm = catalog.vidMeta.get(vid + dv);
            if (!nw || !nm || nm.book !== meta.book) continue;
            witnessVids.push(vid + dv);
            refW.push(...nw.filter((w) => isContentToken(w) && (dfOf(w.bs) <= 350 || w.bs === 'H3068')));
          }
        }
        if (symW.length > 0 && refW.length > 0) {
          const symS = [...new Set(symW.map((w) => w.bs))].slice(0, 4);
          const refS = [...new Set(refW.map((w) => w.bs).filter((s) => !symS.includes(s)))].slice(0, 5);
          if (refS.length > 0) {
            const wMap = new Map([...symW, ...refW].map((w) => [w.bs, w]));
            addRecord({
              id: `v4:eside:c5:${vid}:qa`,
              eside_class: 'C5',
              verse_id: vid,
              ref: meta.ref,
              language: langTag,
              epistemic_class: 'authorial_typology_or_quote',
              symbol_strongs: symS,
              referent_strongs: refS,
              summary: `Vision Q&A: ${fmtStrongsSummary(symS, wMap)} -> ${fmtStrongsSummary(refS, wMap)}`,
              witness_vids: witnessVids,
              target_vids: witnessVids,
            });
          }
        }
      }

      // === HEBREW C6: Syntactic Naming & Place Etiologies ===
      const callIdx = words.findIndex((w) => w.bs === 'H7121');
      const nameNounIdx = words.findIndex((w, i) => w.bs === 'H8034' && callIdx >= 0 && Math.abs(i - callIdx) <= 4);
      const hasAlKen = (() => {
        for (let i = 0; i < words.length - 1; i++) {
          if (words[i].bs === 'H5921' && words[i + 1].bs === 'H3651') return true;
        }
        return false;
      })();

      if (callIdx >= 0 && (nameNounIdx >= 0 || hasAlKen)) {
        const anchorIdx = nameNounIdx >= 0 ? Math.max(callIdx, nameNounIdx) : callIdx;
        // Identify temporal PP ("עַד הַיּוֹם הַזֶּה") indices to exclude
        const temporalExclude = new Set();
        for (let k = 0; k < words.length - 1; k++) {
          if (words[k].bs === 'H5704' && (words[k + 1].bs === 'H3117' || words[k + 2]?.bs === 'H3117')) {
            temporalExclude.add(k);
            temporalExclude.add(k + 1);
            if (k + 2 < words.length) temporalExclude.add(k + 2);
            if (k + 3 < words.length && words[k + 3].bs === 'H2088') temporalExclude.add(k + 3);
          }
        }

        const candTargets = [];
        for (let k = anchorIdx + 1; k <= Math.min(words.length - 1, anchorIdx + 12); k++) {
          if (temporalExclude.has(k)) continue;
          const cand = words[k];
          if (!cand || !cand.bs || /^H900/.test(cand.bs) || NAMING_CLAUSE_SKIP.has(cand.bs)) continue;
          if (FUNC_CLASSES.has(cand.cls) || cand.cls === 'verb') continue;
          if (hebrewConsonants(cand.lm || cand.sf).length >= 2) {
            candTargets.push(cand);
          }
        }

        const relOffset = words.slice(anchorIdx + 1, anchorIdx + 9).findIndex((w) => w.bs === 'H0834');
        const hasBirthInRel = relOffset >= 0 && words.slice(anchorIdx + 1, anchorIdx + 1 + relOffset + 4).some((w) => w.bs === 'H3205' || w.bs === 'H2029');
        let namedList = [];
        if (candTargets.length > 0) {
          if (hasBirthInRel) {
            namedList = [candTargets[candTargets.length - 1]];
          } else if (relOffset >= 0) {
            const beforeRel = candTargets.filter((ct) => words.indexOf(ct, anchorIdx + 1) < anchorIdx + 1 + relOffset);
            namedList = beforeRel.length > 0 ? beforeRel : [candTargets[0]];
          } else {
            // Check if named entity is inside a coordinated NpaNp group (e.g. Exod 17:7 Massah and Meribah)
            const first = candTargets[0];
            if (first.parent?.kind === 'wg' && first.parent.rule === 'NpaNp') {
              namedList = candTargets.filter((ct) => ct.parent === first.parent);
            } else {
              namedList = [first];
            }
          }
        }

        if (namedList.length > 0) {
          const namedSet = new Set(namedList.map((x) => x.bs));
          const sameVerseToks = words.filter(
            (w, idx) =>
              !temporalExclude.has(idx) &&
              w.bs &&
              !namedSet.has(w.bs) &&
              !/^H900/.test(w.bs) &&
              (w.bs === 'H1121' || !NAMING_CLAUSE_SKIP.has(w.bs)) &&
              !FUNC_CLASSES.has(w.cls),
          );

          // Check (A) Compound 2-word split (e.g. Gen 29:32 Reuben = רָאָה + בֵּן)
          for (const namedTok of namedList) {
            const namedRaw = namedTok.lm || namedTok.sf || '';
            const namedCons = hebrewConsonants(namedRaw);
            const namedStem = hebrewNoMatresStem(namedRaw);
            if (namedStem.length < 4) continue;
            let doneComp = false;
            for (let i = 0; i < sameVerseToks.length && !doneComp; i++) {
              const t1 = sameVerseToks[i];
              const s1 = hebrewNoMatresStem(t1.lm || t1.sf || '');
              const c1 = hebrewConsonants(t1.lm || t1.sf || '');
              if (s1.length < 2) continue;
              const pref = [s1, s1.slice(0, 2), c1.slice(0, 2)].find((p) => p.length >= 2 && namedStem.startsWith(p));
              if (!pref) continue;
              const remStem = namedStem.slice(pref.length);
              if (remStem.length < 2) continue;
              for (let j = 0; j < sameVerseToks.length; j++) {
                if (i === j || sameVerseToks[j].bs === t1.bs) continue;
                const t2 = sameVerseToks[j];
                const s2 = hebrewNoMatresStem(t2.lm || t2.sf || '');
                const c2 = hebrewConsonants(t2.lm || t2.sf || '');
                if (s2 === remStem || c2 === remStem || (remStem.length >= 2 && s2.startsWith(remStem))) {
                  const wMap = new Map([[namedTok.bs, namedTok], [t1.bs, t1], [t2.bs, t2]]);
                  addRecord({
                    id: `v4:eside:c6:${vid}:comp:${namedTok.bs}`,
                    eside_class: 'C6',
                    verse_id: vid,
                    ref: meta.ref,
                    language: langTag,
                    epistemic_class: 'direct_textual_evidence',
                    symbol_strongs: [namedTok.bs],
                    referent_strongs: [t1.bs, t2.bs],
                    summary: `${fmtTokLabel(namedTok)} = ${fmtStrongsSummary([t1.bs, t2.bs], wMap)}`,
                    witness_vids: [vid],
                    target_vids: [vid],
                  });
                  doneComp = true;
                  break;
                }
              }
            }
          }

          // Check (B) Root / consonantal / mem-preformative match (in same verse OR ±3v birth-speech window)
          const hasSameSpeechOrCause = words.some((w) => w.bs === 'H0559' || w.bs === 'H3588' || w.bs === 'H5921');
          const hasBirthVerb = words.some((w) => w.bs === 'H3205' || w.bs === 'H2029');
          const windowSearch = [{ wVid: vid, toks: sameVerseToks.filter((w) => w.bs !== 'H1121') }];
          if (hasBirthVerb && !hasSameSpeechOrCause) {
            for (let dv = 1; dv <= 3; dv++) {
              const nw = vidToMaculaWords.get(vid + dv);
              const nm = catalog.vidMeta.get(vid + dv);
              if (!nw || !nm || nm.book !== meta.book || nm.chapter !== meta.chapter) continue;
              if (nw.some((w) => w.bs === 'H0559') && !nw.some((w) => w.bs === 'H7121')) {
                windowSearch.push({
                  wVid: vid + dv,
                  toks: nw.filter((w) => w.bs && !namedSet.has(w.bs) && !/^H900/.test(w.bs) && !NAMING_CLAUSE_SKIP.has(w.bs) && !FUNC_CLASSES.has(w.cls)),
                });
              }
            }
          }

          const matchedEtiol = [];
          const matchedVids = new Set([vid]);
          for (const namedTok of namedList) {
            const namedRaw = namedTok.lm || namedTok.sf || '';
            const namedCons = hebrewConsonants(namedRaw);
            const namedStem = hebrewNoMatresStem(namedRaw);
            const namedNoMem = (namedCons.startsWith('מ') || namedCons.startsWith('ת')) && namedStem.length >= 3
              ? namedStem.slice(1)
              : '';
            const namedConsNoMem = (namedCons.startsWith('מ') || namedCons.startsWith('ת')) && namedCons.length >= 4
              ? namedCons.slice(1)
              : '';

            for (const ws of windowSearch) {
              for (const ct of ws.toks) {
                const ctCons = hebrewConsonants(ct.lm || ct.sf || '');
                const ctStem = hebrewNoMatresStem(ct.lm || ct.sf || '');
                if (ctStem.length < 2) continue;

                const sharesWithStem = (nStem, nCons) => {
                  if (!nStem) return false;
                  let sharedInOrder = 0;
                  let cursor = 0;
                  for (const ch of ctStem) {
                    const pos = nStem.indexOf(ch, cursor);
                    if (pos >= 0) { sharedInOrder++; cursor = pos + 1; }
                  }
                  return (
                    (ctStem.length >= 2 && nCons.includes(ctStem.slice(0, 2))) ||
                    (ctCons.length >= 3 && nCons.includes(ctCons.slice(0, 3))) ||
                    sharedInOrder >= 3 ||
                    (sharedInOrder >= 2 && Math.min(ctStem.length, nStem.length) <= 3 && Math.max(ctStem.length, nStem.length) <= 4)
                  );
                };

                if (sharesWithStem(namedStem, namedCons) || (namedNoMem && sharesWithStem(namedNoMem, namedConsNoMem))) {
                  if (!matchedEtiol.some((x) => x.bs === ct.bs)) matchedEtiol.push(ct);
                  matchedVids.add(ws.wVid);
                }
              }
            }
          }

          if (matchedEtiol.length > 0) {
            const symS = [...new Set(namedList.map((x) => x.bs))];
            const refS = [...new Set(matchedEtiol.map((x) => x.bs))];
            const wMap = new Map([...namedList, ...matchedEtiol].map((w) => [w.bs, w]));
            const vidsArr = [...matchedVids].sort((a, b) => a - b);
            const spanRef = vidsArr.length > 1
              ? `${meta.ref}-${catalog.vidMeta.get(vidsArr[vidsArr.length - 1]).verse}`
              : meta.ref;
            addRecord({
              id: `v4:eside:c6:${vid}:name:${symS.join('_')}`,
              eside_class: 'C6',
              verse_id: vid,
              ref: spanRef,
              language: langTag,
              epistemic_class: 'direct_textual_evidence',
              symbol_strongs: symS,
              referent_strongs: refS,
              summary: `${fmtStrongsSummary(symS, wMap)} <- ${fmtStrongsSummary(refS, wMap)}`,
              witness_vids: vidsArr,
              target_vids: vidsArr,
            });
          } else if (words.some((w) => w.bs === 'H3318') && (hasBirthVerb || words.some((w) => w.bs === 'H0990' || w.bs === 'H8380'))) {
            // Check (C) Birth-attribute naming
            const birthAttr = sameVerseToks.filter((w) => w.bs !== 'H3318' && w.bs !== 'H7223' && isNominalToken(w) && dfOf(w.bs) <= 150);
            if (birthAttr.length > 0) {
              const symS = [...new Set(namedList.map((x) => x.bs))];
              const refS = [...new Set(birthAttr.map((x) => x.bs))];
              const wMap = new Map([...namedList, ...birthAttr].map((w) => [w.bs, w]));
              addRecord({
                id: `v4:eside:c6:${vid}:birth:${symS.join('_')}`,
                eside_class: 'C6',
                verse_id: vid,
                ref: meta.ref,
                language: langTag,
                epistemic_class: 'direct_textual_evidence',
                symbol_strongs: symS,
                referent_strongs: refS,
                summary: `${fmtStrongsSummary(symS, wMap)} <- ${fmtStrongsSummary(refS, wMap)}`,
                witness_vids: [vid],
                target_vids: [vid],
              });
            }
          }
        }
      }
    }
  }

  // =========================================================================
  // C5 Report<->Decode Chapter Pairing (Strictly Clause-Local, Zero Cross-Verse Conflation)
  // =========================================================================
  for (const [ck, decodes] of decodeRecordsByChap.entries()) {
    const [bStr, cStr] = ck.split(':');
    const book = Number(bStr);
    const chap = Number(cStr);
    const chapVids = (catalog.vidsByBook.get(book) || []).filter((v) => catalog.vidMeta.get(v)?.chapter === chap);
    if (chapVids.length === 0) continue;

    for (const dec of decodes) {
      const symSet = new Set(dec.symbol_strongs);
      // Find earliest verse in same chapter (strictly < dec.verse_id) introducing any symbol_strongs
      const reportVids = [];
      for (const rv of chapVids) {
        if (rv >= dec.verse_id) break;
        const rToks = v3Verses.get(rv)?.toks || [];
        if (rToks.some((t) => symSet.has(t.s))) {
          reportVids.push(rv);
          if (reportVids.length >= 2) break;
        }
      }
      if (reportVids.length > 0) {
        addRecord({
          id: `v4:eside:c5:rd:${reportVids[0]}_${dec.verse_id}:${dec.symbol_strongs[0]}`,
          eside_class: 'C5',
          verse_id: dec.verse_id,
          ref: dec.ref,
          language: dec.language,
          epistemic_class: 'authorial_typology_or_quote',
          symbol_strongs: dec.symbol_strongs,
          referent_strongs: dec.referent_strongs,
          summary: `Report(${catalog.vidMeta.get(reportVids[0])?.ref}) -> ${dec.summary}`,
          witness_vids: [reportVids[0], dec.verse_id],
          target_vids: [reportVids[0]],
        });
      }
    }
  }

  // =========================================================================
  // C7: Citation Formulas + Offline Order-Flexible Frame-Splice 3-Way MT<->LXX<->NT
  // =========================================================================
  // Release MACULA XML tree & coreference graphs before C7 so V8 heap stays small
  allSentences.length = 0;
  xmlIdToWord.clear();
  vidToMaculaWords.clear();
  maculaVersesByBook.clear();
  decodeRecordsByChap.clear();
  comparisonAdjunctHeadIds.clear();

  const tC7 = performance.now();
  console.error(`Starting C7 after syntax passes (${records.length} C1-C6/C8 records so far, ${Math.round(tC7 - t0)}ms)...`);

  // Build Hebrew -> top LXX Greek lemma equivalents from mtLxxByVid (zero 95MB re-parse!)
  const hebToGrkCounts = new Map();
  for (const [, mtLxx] of mtLxxByVid.entries()) {
    for (const l of mtLxx.links || []) {
      if (l.rule) continue;
      const hBs = normStrongs4(l.h_bs);
      const gLem = (l.g_lemma || '').normalize('NFC').trim();
      if (!hBs || !gLem || isLxxFunctionEquivalent(null, gLem)) continue;
      let gm = hebToGrkCounts.get(hBs);
      if (!gm) { gm = new Map(); hebToGrkCounts.set(hBs, gm); }
      gm.set(gLem, (gm.get(gLem) || 0) + 1);
    }
  }
  const hebTopEquivs = new Map();
  for (const [hBs, gm] of hebToGrkCounts.entries()) {
    const top = [...gm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]);
    hebTopEquivs.set(hBs, top);
  }

  // Compute LXX lemma DF across OT mt-lxx verses
  const lxxDf = new Map();
  for (const [, mtLxx] of mtLxxByVid.entries()) {
    const seen = new Set();
    for (const gt of mtLxx.grk_tokens || []) {
      const n = normGreekPlain(gt.l || gt.s || '');
      if (n && !seen.has(n)) {
        seen.add(n);
        lxxDf.set(n, (lxxDf.get(n) || 0) + 1);
      }
    }
  }
  const lxxIdfOf = (rawLem) => {
    const n = normGreekPlain(rawLem);
    const df = lxxDf.get(n) || 1;
    return Math.max(0.5, Math.min(9.5, Math.log2(NUM_VERSES / df)));
  };

  // Prebuild OtLxxCandidateGroup cache & inverted index over OT LXX content lemmas
  const otCandByVid = new Map();
  const otInvIdx = new Map(); // normGreekPlain(lemma) -> number[] (otVids)

  for (const [otVid, mtLxx] of mtLxxByVid.entries()) {
    if (otVid > 23261 || !Array.isArray(mtLxx.grk_tokens) || mtLxx.grk_tokens.length === 0) continue;
    const linkByG = new Map();
    for (const l of mtLxx.links || []) {
      const prev = linkByG.get(l.g);
      if (!prev || (l.stability ?? 0) > (prev.stability ?? 0)) linkByG.set(l.g, l);
    }
    const shiftByG = new Map();
    for (const sh of mtLxx.shifts || []) {
      if (typeof sh.g === 'number') shiftByG.set(sh.g, sh);
      else if (typeof sh.g_start === 'number' && typeof sh.g_end === 'number') {
        for (let gi = sh.g_start; gi <= sh.g_end; gi++) shiftByG.set(gi, sh);
      }
    }

    const addedToInv = new Set();
    const slots = mtLxx.grk_tokens.map((gt, gi) => {
      const lemma = String(gt.l || gt.s || '').normalize('NFC');
      const pLow = String(gt.p || '').toLowerCase();
      const isFunc = FUNC_CLASSES.has(pLow) || normGreekPlain(lemma) === 'ειμι';
      const idf = isFunc ? 0.6 : Number(lxxIdfOf(lemma).toFixed(2));
      const lnk = linkByG.get(gi);
      const hBs = lnk ? normStrongs4(lnk.h_bs) : '';
      const sh = shiftByG.get(gi);
      const divKind = sh?.type === 'pronoun_person_shift' || sh?.type === 'lexical_theological_shift' || sh?.type === 'lxx_plus_expansion'
        ? sh.type
        : null;
      const equivs = hBs ? hebTopEquivs.get(hBs) : undefined;

      if (!isFunc && idf >= 2.2) {
        const n = normGreekPlain(lemma);
        if (n && !addedToInv.has(n)) {
          addedToInv.add(n);
          let arr = otInvIdx.get(n);
          if (!arr) { arr = []; otInvIdx.set(n, arr); }
          arr.push(otVid);
        }
      }

      return {
        lxxIdx: gi,
        lxxSurface: String(gt.s || ''),
        lxxLemma: lemma,
        lxxIdf: idf,
        isFunction: isFunc,
        mtIdx: lnk ? Number(lnk.h) : null,
        ...(hBs ? { mtStrongs: hBs } : {}),
        ...(equivs ? { mtEquivLemmas: equivs } : {}),
        divergenceKind: divKind,
      };
    });

    const meta = catalog.vidMeta.get(otVid);
    otCandByVid.set(otVid, {
      ref: meta?.ref || mtLxx.ref || `Verse ${otVid}`,
      vid: otVid,
      slots,
    });
  }

  // Detect NT & OT citation formulas
  const citationFormulaVids = new Set();
  const PROP_AUTHOR_GREEK = new Set(['G3475', 'G1138', 'G2268', 'G2408', 'G1158', 'G2501', 'G5614', 'G0035', 'G3399', 'G2197', 'G1124', 'G4396', 'G3551', 'G5568', 'G0976']);
  for (let vid = 1; vid <= NUM_VERSES; vid++) {
    const v = v3Verses.get(vid);
    if (!v) continue;
    const bsSet = new Set(v.toks.map((t) => t.s).filter(Boolean));
    if (vid >= 23262) {
      const hasGrapho = bsSet.has('G1125');
      const hasCue = bsSet.has('G2531') || bsSet.has('G5613') || bsSet.has('G3754') || bsSet.has('G1063') || bsSet.has('G1722');
      const hasSay = bsSet.has('G3004') || bsSet.has('G2046') || bsSet.has('G5346');
      const hasPropOrScripture = [...PROP_AUTHOR_GREEK].some((s) => bsSet.has(s)) || (bsSet.has('G4151') && bsSet.has('G0040'));
      const hasFulfill = bsSet.has('G4137') && (bsSet.has('G2443') || bsSet.has('G3704') || bsSet.has('G5119'));
      const hasThisIsSaid = bsSet.has('G3778') && bsSet.has('G1510') && (bsSet.has('G2046') || bsSet.has('G1125'));
      const hasDioLegei = bsSet.has('G1352') && bsSet.has('G3004');
      const hasKaSay = (bsSet.has('G2531') && hasSay) || (bsSet.has('G2046') && bsSet.has('G3779'));
      if ((hasGrapho && hasCue) || (hasSay && hasPropOrScripture) || hasFulfill || hasThisIsSaid || hasDioLegei || hasKaSay) {
        citationFormulaVids.add(vid);
      }
      if (citationFormulaVids.has(vid - 1) && bsSet.has('G3825')) {
        citationFormulaVids.add(vid);
      }
    } else {
      const hasKatuv = bsSet.has('H3789') && (bsSet.has('H5612') || bsSet.has('H8451') || bsSet.has('H4872'));
      if (hasKatuv) citationFormulaVids.add(vid);
    }
  }

  const toNtTokens = (v) =>
    v.toks.map((t, i) => ({
      idx: i,
      surface: t.sf,
      lemma: t.lm || t.sf,
      ...(t.s ? { strongs: t.s } : {}),
      isFunction: t.s === 'G1510' || t.is_func || FUNC_CLASSES.has((t.cl || '').toLowerCase()),
    }));

  const candScores = new Float32Array(23265);
  const candMaxIdf = new Float32Array(23265);
  const candHits = new Uint16Array(23265);
  const candTouched = new Int32Array(23265);

  const retrieveTopOtCandidates = (ntTokens, k = 20, hasFormula = false) => {
    let touchedLen = 0;
    const seenQuery = new Set();
    for (let ti = 0; ti < ntTokens.length; ti++) {
      const nt = ntTokens[ti];
      const n = normGreekPlain(nt.lemma);
      if (!n || seenQuery.has(n)) continue;
      if (nt.isFunction && n !== 'οσοσ') continue;
      const idf = lxxIdfOf(nt.lemma);
      if (idf < 2.2) continue;
      seenQuery.add(n);
      const postings = otInvIdx.get(n);
      if (!postings) continue;
      for (let i = 0; i < postings.length; i++) {
        const ov = postings[i];
        if (candHits[ov] === 0) candTouched[touchedLen++] = ov;
        candScores[ov] += idf;
        if (idf > candMaxIdf[ov]) candMaxIdf[ov] = idf;
        candHits[ov]++;
      }
    }
    const minHits = hasFormula ? 1 : 2;
    const minScore = hasFormula ? 7.5 : 13.0;
    const ranked = [];
    let hasStrongNonFormulaAnchor = hasFormula;
    for (let i = 0; i < touchedLen; i++) {
      const ov = candTouched[i];
      const sc = candScores[ov];
      const h = candHits[ov];
      const mx = candMaxIdf[ov];
      candScores[ov] = 0;
      candHits[ov] = 0;
      candMaxIdf[ov] = 0;
      if (h >= minHits && sc >= minScore) {
        if (hasFormula || (h >= 3 && sc >= 19.5) || (h >= 2 && mx >= 8.4 && sc >= 14.5)) {
          hasStrongNonFormulaAnchor = true;
          ranked.push({ ov, sc });
        } else if (h >= 2 && sc >= 13.0) {
          ranked.push({ ov, sc });
        }
      }
    }
    if (!hasStrongNonFormulaAnchor || ranked.length === 0) return [];
    ranked.sort((a, b) => b.sc - a.sc || a.ov - b.ov);
    const limit = hasFormula ? k : Math.min(k, 6);
    return ranked.slice(0, limit).map((r) => otCandByVid.get(r.ov)).filter(Boolean);
  };

  let c7NtQuotes = 0;
  let c7Evaluated = 0;
  const quotedNtVids = new Set();
  for (let vid = 23262; vid <= NUM_VERSES; vid++) {
    if ((vid - 23262) % 2000 === 0 && vid > 23262) {
      console.error(`C7 progress: vid=${vid}/${NUM_VERSES}, evaluated=${c7Evaluated}, quotes=${c7NtQuotes}, ${Math.round(performance.now() - tC7)}ms`);
    }
    const v = v3Verses.get(vid);
    if (!v || v.toks.length < 3) continue;
    const hasFormula = citationFormulaVids.has(vid) || citationFormulaVids.has(vid - 1);
    const ntTokens = toNtTokens(v);
    const topCands = retrieveTopOtCandidates(ntTokens, 20, hasFormula);
    if (topCands.length === 0) continue;
    c7Evaluated++;

    const tri = alignTriTextualQuoteV4(ntTokens, topCands, { hasCitationFormula: hasFormula });
    if (!tri || tri.splices.length === 0) continue;

    // High-precision C7 quotation gate: require citation formula OR dense/high-IDF non-proper OT quote match
    const nonProperMatched = tri.tokens.filter(
      (tk) =>
        tk.lxx_idx !== null &&
        tk.witness !== 'nt_adaptation' &&
        v.toks[tk.nt_idx] &&
        !v.toks[tk.nt_idx].is_func &&
        v.toks[tk.nt_idx].cl !== 'nmpr' &&
        !/^[A-Z\u0391-\u03A9]/.test(v.toks[tk.nt_idx].lm || ''),
    ).length;
    const hasStrongQuoteSeg =
      nonProperMatched >= 2 &&
      tri.splices.some(
        (sp) =>
          (sp.contentMatches >= 3 && sp.score >= 18.0 && (sp.maxContentIdf || 0) >= 7.5 && (sp.ntEndIdx - sp.ntStartIdx) <= 18) ||
          (sp.contentMatches >= 2 && sp.score >= 14.5 && (sp.maxContentIdf || 0) >= 8.4 && (sp.ntEndIdx - sp.ntStartIdx) <= 10),
      );
    if (!hasFormula && !hasStrongQuoteSeg) continue;
    const minBits = hasFormula ? 6.0 : 9.4;
    if (tri.evidenceBits < minBits) continue;

    quotedNtVids.add(vid);
    c7NtQuotes++;

    const srcVids = tri.sources
      .map((r) => topCands.find((c) => c.ref === r)?.vid)
      .filter(Boolean);
    const ntSymS = [...new Set(v.toks.filter((t) => !t.is_func && t.s).map((t) => t.s))].slice(0, 5);
    const otRefS = [...new Set(srcVids.flatMap((ov) => (v3Verses.get(ov)?.toks || []).filter((t) => !t.is_func && t.s).map((t) => t.s)))].slice(0, 5);

    addRecord({
      id: `v4:eside:c7:${vid}`,
      eside_class: 'C7',
      verse_id: vid,
      ref: v.ref,
      language: 'grc',
      has_citation_formula: hasFormula,
      epistemic_class: 'authorial_typology_or_quote',
      symbol_strongs: ntSymS,
      referent_strongs: otRefS,
      sources: tri.sources,
      splices: tri.splices,
      evidence_bits: tri.evidenceBits,
      witness_vids: [vid, ...srcVids],
      target_vids: srcVids,
      summary: `${v.ref} -> ${tri.sources.join(' + ')} (${tri.splices.length} segs, ${tri.evidenceBits} bits)`,
    });
  }

  // Also run multi-verse 2-verse window C7 splice alignment around citation formulas or quote pairs (catches Heb 10:37-38!)
  for (let vid = 23262; vid < NUM_VERSES; vid++) {
    if (!citationFormulaVids.has(vid) && !citationFormulaVids.has(vid - 1) && !(quotedNtVids.has(vid) && quotedNtVids.has(vid + 1))) continue;
    const v1 = v3Verses.get(vid);
    const v2 = v3Verses.get(vid + 1);
    if (!v1 || !v2 || v1.book !== v2.book || v1.chapter !== v2.chapter) continue;
    if (v1.toks.length + v2.toks.length > 65) continue;
    const combinedToks = [...toNtTokens(v1), ...toNtTokens(v2)].map((t, idx) => ({ ...t, idx }));
    const hasFormula = citationFormulaVids.has(vid) || citationFormulaVids.has(vid - 1);
    const topCands = retrieveTopOtCandidates(combinedToks, 20, hasFormula);
    if (topCands.length === 0) continue;

    const tri = alignTriTextualQuoteV4(combinedToks, topCands, { hasCitationFormula: hasFormula });
    if (!tri || tri.sources.length < 2 || tri.evidenceBits < 12.0) continue;
    const hasStrongSpanSeg = tri.splices.some(
      (sp) => (sp.contentMatches >= 3 && sp.score >= 17.5) || (sp.contentMatches >= 2 && sp.score >= 14.5 && (sp.maxContentIdf || 0) >= 8.4),
    );
    if (!hasFormula && !hasStrongSpanSeg) continue;

    const srcVids = tri.sources.map((r) => topCands.find((c) => c.ref === r)?.vid).filter(Boolean);
    const ntSymS = [...new Set([...v1.toks, ...v2.toks].filter((t) => !t.is_func && t.s).map((t) => t.s))].slice(0, 6);
    const otRefS = [...new Set(srcVids.flatMap((ov) => (v3Verses.get(ov)?.toks || []).filter((t) => !t.is_func && t.s).map((t) => t.s)))].slice(0, 6);

    addRecord({
      id: `v4:eside:c7:span:${vid}_${vid + 1}`,
      eside_class: 'C7',
      verse_id: vid,
      ref: `${v1.ref}-${v2.verse}`,
      language: 'grc',
      has_citation_formula: hasFormula,
      epistemic_class: 'authorial_typology_or_quote',
      symbol_strongs: ntSymS,
      referent_strongs: otRefS,
      sources: tri.sources,
      splices: tri.splices,
      evidence_bits: tri.evidenceBits,
      witness_vids: [vid, vid + 1, ...srcVids],
      target_vids: srcVids,
      summary: `${v1.ref}-${v2.verse} -> ${tri.sources.join(' + ')} (${tri.splices.length} segs)`,
    });
  }

  // OT -> OT inner-biblical citation formulas & strong quotations (e.g., 2 Kgs 14:6 -> Deut 24:16, Jer 26:18 -> Mic 3:12)
  const otContentInv = new Map();
  for (let ov = 1; ov <= 23261; ov++) {
    const v = v3Verses.get(ov);
    if (!v) continue;
    const seen = new Set();
    for (const t of v.toks) {
      if (!t.s || t.is_func || SKIP_CONTENT_STRONGS.has(t.s) || seen.has(t.s)) continue;
      if (dfOf(t.s) > 450) continue;
      seen.add(t.s);
      let arr = otContentInv.get(t.s);
      if (!arr) { arr = []; otContentInv.set(t.s, arr); }
      arr.push(ov);
    }
  }
  for (const ov of citationFormulaVids) {
    if (ov > 23261) continue;
    const v = v3Verses.get(ov);
    if (!v) continue;
    const scores = new Map();
    const rareTerms = [...new Set(v.toks.filter((t) => t.s && !t.is_func && !SKIP_CONTENT_STRONGS.has(t.s) && dfOf(t.s) <= 350).map((t) => t.s))];
    for (const bs of rareTerms) {
      const idf = Math.log2(NUM_VERSES / Math.max(1, dfOf(bs)));
      for (const candOv of otContentInv.get(bs) || []) {
        if (candOv >= ov) continue; // earlier canonical source
        const cv = v3Verses.get(candOv);
        if (!cv || cv.book === v.book) continue;
        scores.set(candOv, (scores.get(candOv) || 0) + idf);
      }
    }
    const topOt = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).filter((x) => x[1] >= 18.0);
    if (topOt.length > 0) {
      const targetVids = topOt.map((x) => x[0]);
      const targets = targetVids.map((tv) => v3Verses.get(tv)?.ref).filter(Boolean);
      addRecord({
        id: `v4:eside:c7:ot:${ov}`,
        eside_class: 'C7',
        verse_id: ov,
        ref: v.ref,
        language: 'hbo',
        has_citation_formula: true,
        epistemic_class: 'authorial_typology_or_quote',
        symbol_strongs: rareTerms.slice(0, 5),
        referent_strongs: rareTerms.slice(0, 5),
        sources: targets,
        witness_vids: [ov, ...targetVids],
        target_vids: targetVids,
        summary: `${v.ref} cites ${targets.join(', ')}`,
      });
    }
  }

  console.error(
    `Extracted ${records.length} ESIDE records (C7 NT=${c7NtQuotes}, evaluated=${c7Evaluated}) in ${Math.round(performance.now() - tC7)}ms.`,
  );

  // =========================================================================
  // Pack BRV3PIDX (eside-vid.idx), BRV3KIDX (eside-bs.idx), pack-00..NN.bin, and interp-edges.bin
  // =========================================================================
  const recordsByBs = new Map();
  const classPriority = { C1: 1, C2: 2, C3: 3, C4: 4, C5: 5, C6: 6, C7: 7, C8: 8 };
  for (const rec of records) {
    const bsList = new Set([
      ...(rec.symbol_strongs || []),
      ...(rec.referent_strongs || []),
      ...(rec.tenor_strongs || []),
      ...(rec.vehicle_strongs || []),
    ]);
    for (const bs of bsList) {
      if (!bs || /^H900/.test(bs)) continue;
      let arr = recordsByBs.get(bs);
      if (!arr) { arr = []; recordsByBs.set(bs, arr); }
      arr.push(rec);
    }
  }

  // Sort & cap per-bs lists at <= 64 (prioritizing C1..C7 over C8)
  for (const [bs, arr] of recordsByBs.entries()) {
    arr.sort((a, b) => (classPriority[a.eside_class] || 9) - (classPriority[b.eside_class] || 9) || a.verse_id - b.verse_id);
    if (arr.length > 64) arr.length = 64;
  }

  const packChunks = [];
  const packFiles = [];
  let curBytes = 0;
  let fileIdx = 0;

  const flushPack = () => {
    if (packChunks.length === 0) return;
    const fname = `pack-${String(fileIdx).padStart(2, '0')}.bin`;
    const buf = Buffer.concat(packChunks);
    packFiles.push({ fname, buf });
    fileIdx++;
    packChunks.length = 0;
    curBytes = 0;
  };

  const appendPayload = (obj) => {
    assertNoRestrictedKeys(obj);
    const gz = zlib.gzipSync(JSON.stringify(obj), { level: 6 });
    if (gz.length >= 0x00ffffff) throw new Error('ESIDE payload exceeds 16 MiB');
    if (curBytes > 0 && curBytes + gz.length > MAX_PACK_BYTES) flushPack();
    const loc = { fileIdx, start: curBytes, length: gz.length };
    packChunks.push(gz);
    curBytes += gz.length;
    return loc;
  };

  // Write vid payloads first
  const vidLocs = new Map();
  const sortedVids = [...recordsByVid.keys()].sort((a, b) => a - b);
  for (const vid of sortedVids) {
    const recs = recordsByVid.get(vid);
    const meta = catalog.vidMeta.get(vid);
    vidLocs.set(vid, appendPayload({ vid, ref: meta?.ref || '', records: recs }));
  }

  // Write bs payloads into same pack stream
  const bsEntries = [...recordsByBs.keys()]
    .map((bs) => ({ key: bs, keyBuf: Buffer.from(bs, 'utf8') }))
    .sort((a, b) => Buffer.compare(a.keyBuf, b.keyBuf));
  const bsIndexed = [];
  const strChunks = [];
  let strOff = 0;
  for (const e of bsEntries) {
    const loc = appendPayload({ bs: e.key, records: recordsByBs.get(e.key) });
    bsIndexed.push({
      keyOff: strOff,
      keyLen: e.keyBuf.length,
      start: loc.start,
      fileIdx: loc.fileIdx,
      length: loc.length,
    });
    strChunks.push(e.keyBuf);
    strOff += e.keyBuf.length;
  }
  flushPack();

  // Build eside-vid.idx (BRV3PIDX)
  const vidIdxBuf = Buffer.alloc(20 + (NUM_VERSES + 1) * 8);
  for (let i = 0; i < 8; i++) vidIdxBuf[i] = PIDX_MAGIC.charCodeAt(i);
  vidIdxBuf.writeUInt32LE(1, 8);
  vidIdxBuf.writeUInt32LE(NUM_VERSES, 12);
  vidIdxBuf.writeUInt32LE(packFiles.length, 16);
  for (const [vid, loc] of vidLocs.entries()) {
    const off = 20 + vid * 8;
    vidIdxBuf.writeUInt32LE(loc.start >>> 0, off);
    vidIdxBuf.writeUInt32LE((((loc.fileIdx & 0xff) << 24) | (loc.length & 0x00ffffff)) >>> 0, off + 4);
  }

  // Build eside-bs.idx (BRV3KIDX)
  const dirOffset = 24;
  const headerAndDir = Buffer.alloc(dirOffset + bsIndexed.length * 16);
  for (let i = 0; i < 8; i++) headerAndDir[i] = KIDX_MAGIC.charCodeAt(i);
  headerAndDir.writeUInt32LE(1, 8);
  headerAndDir.writeUInt32LE(bsIndexed.length, 12);
  headerAndDir.writeUInt32LE(packFiles.length, 16);
  headerAndDir.writeUInt32LE(dirOffset, 20);
  for (let i = 0; i < bsIndexed.length; i++) {
    const e = bsIndexed[i];
    const off = dirOffset + i * 16;
    headerAndDir.writeUInt32LE(e.keyOff >>> 0, off);
    headerAndDir.writeUInt32LE(e.keyLen >>> 0, off + 4);
    headerAndDir.writeUInt32LE(e.start >>> 0, off + 8);
    headerAndDir.writeUInt32LE((((e.fileIdx & 0xff) << 24) | (e.length & 0x00ffffff)) >>> 0, off + 12);
  }
  const bsIdxBuf = Buffer.concat([headerAndDir, ...strChunks]);

  // Build interp-edges.bin (< 400 KiB directed provenance sidecar for C1-C7)
  const interpEdges = {};
  const seenBsEdge = new Set();
  for (const rec of records) {
    if (rec.eside_class === 'C8') continue;
    const edgeVal = {
      eside_id: rec.id,
      eside_class: rec.eside_class,
      witness_vid: rec.verse_id,
      symbol_strongs: (rec.symbol_strongs || []).slice(0, 3),
      referent_strongs: (rec.referent_strongs || []).slice(0, 3),
      summary: String(rec.summary || '').slice(0, 56),
    };
    // Verse -> target verse edges
    for (const tv of rec.target_vids || []) {
      if (tv && tv !== rec.verse_id) {
        const k = `V:${rec.verse_id}->V:${tv}`;
        if (!interpEdges[k]) interpEdges[k] = edgeVal;
      }
    }
    // Primary Symbol Strong's -> Referent Strong's directed edge (deduplicated per class+pair to stay well under 400 KiB)
    if (rec.eside_class !== 'C7') {
      const sb = (rec.symbol_strongs || [])[0];
      const rb = (rec.referent_strongs || [])[0];
      if (sb && rb && sb !== rb) {
        const dedupKey = `${rec.eside_class}:${sb}->${rb}`;
        if (!seenBsEdge.has(dedupKey)) {
          seenBsEdge.add(dedupKey);
          const k = `${sb}->${rb}@${rec.verse_id}`;
          if (!interpEdges[k]) interpEdges[k] = edgeVal;
        }
      }
    }
  }
  assertNoRestrictedKeys(interpEdges, 'interpEdges');
  const rawEdgesBuf = Buffer.from(JSON.stringify({ schema_version: 4, edge_count: Object.keys(interpEdges).length, edges: interpEdges }), 'utf8');
  const interpEdgesBuf = rawEdgesBuf.byteLength <= MAX_INTERP_EDGES_BYTES
    ? rawEdgesBuf
    : zlib.gzipSync(rawEdgesBuf, { level: 9 });
  if (interpEdgesBuf.byteLength >= 400 * 1024) {
    throw new Error(`interp-edges.bin exceeds 400 KiB (${interpEdgesBuf.byteLength} B)`);
  }

  // Write all output files identically to BOTH v4-build/v4/eside and staging-bundle/v4/eside
  for (const outDir of [OUT_BUILD_ESIDE, OUT_STAGING_ESIDE]) {
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(outDir)) {
      if (/^pack-\d+\.bin$/.test(f)) fs.unlinkSync(path.join(outDir, f));
    }
    fs.writeFileSync(path.join(outDir, 'eside-vid.idx'), vidIdxBuf);
    fs.writeFileSync(path.join(outDir, 'eside-bs.idx'), bsIdxBuf);
    for (const pf of packFiles) {
      fs.writeFileSync(path.join(outDir, pf.fname), pf.buf);
    }
    fs.writeFileSync(path.join(outDir, 'interp-edges.bin'), interpEdgesBuf);
  }

  const classCounts = {};
  for (const r of records) classCounts[r.eside_class] = (classCounts[r.eside_class] || 0) + 1;

  console.log(
    JSON.stringify(
      {
        status: 'OK',
        elapsed_ms: Math.round(performance.now() - t0),
        total_records: records.length,
        class_counts: classCounts,
        indexed_vids: sortedVids.length,
        indexed_bs: bsIndexed.length,
        pack_files: packFiles.map((p) => ({ name: p.fname, bytes: p.buf.byteLength })),
        eside_vid_idx_bytes: vidIdxBuf.byteLength,
        eside_bs_idx_bytes: bsIdxBuf.byteLength,
        interp_edges_count: Object.keys(interpEdges).length,
        interp_edges_bytes: interpEdgesBuf.byteLength,
        interp_edges_gzipped: interpEdgesBuf[0] === 0x1f && interpEdgesBuf[1] === 0x8b,
        outputs: [OUT_BUILD_ESIDE, OUT_STAGING_ESIDE].map((d) => path.relative(ROOT, d)),
      },
      null,
      2,
    ),
  );
}

main();
