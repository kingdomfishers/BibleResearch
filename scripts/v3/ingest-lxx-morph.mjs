/**
 * Stage S1.2: Clean-Room OpenScriptorium lxx-morph Ingestion & Morpho-Syntactic Alignment
 *
 * Strictly reads ONLY CC BY 4.0 data under:
 *   - .artifacts-r12/external-cache/lxx-morph/db/seeds/lxx_morph/*.json (skipping *.auto.json!)
 *   - .artifacts-r12/external-cache/lxx-morph/db/seeds/mt_alignment/{verse_pairs.jsonl,word_links.jsonl.gz,eval_300.json}
 * Never reads or copies ISC .rb/.rake code or CC BY-SA Swete data.
 *
 * Outputs:
 *   - .artifacts-r12/v3-build/lxx-alignment.json
 *   - .artifacts-r12/v3-build/rahlfs-concordance.bin
 *   - .artifacts-r12/staging-bundle/v3/align/mt-lxx-00..31.bin
 *   - .artifacts-r12/staging-bundle/v3/align/rahlfs-concordance-00..07.bin
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_LXX_CACHE = '.artifacts-r12/external-cache/lxx-morph';
const DEFAULT_R10_DIR = '.artifacts-r12/staging-bundle/v2/relationships/r11-v1.0/r10';
const DEFAULT_MACULA_HEB_DIR = '.artifacts/static-corpus/tables/macula_hebrew_morphemes';
const DEFAULT_LEXICON_PATH = '.artifacts-r12/v3-build/sanitized-lexicon.json';
const DEFAULT_OUT_JSON = '.artifacts-r12/v3-build/lxx-alignment.json';
const DEFAULT_ALIGN_DIR = '.artifacts-r12/staging-bundle/v3/align';

const LXX_COMMIT = 'c91f6b1e8fb3ba37df701e6ae31f675ace71a2b2';

const MT_BOOK_SLUG_TO_STEP = {
  'genesis': 'genesis',
  'exodus': 'exodus',
  'leviticus': 'leviticus',
  'numbers': 'numbers',
  'deuteronomy': 'deuteronomy',
  'joshua': 'joshua',
  'judges': 'judges',
  'ruth': 'ruth',
  '1-samuel': '1 samuel',
  '2-samuel': '2 samuel',
  '1-kings': '1 kings',
  '2-kings': '2 kings',
  '1-chronicles': '1 chronicles',
  '2-chronicles': '2 chronicles',
  'ezra': 'ezra',
  'nehemiah': 'nehemiah',
  'esther': 'esther',
  'job': 'job',
  'psalms': 'psalms',
  'proverbs': 'proverbs',
  'ecclesiastes': 'ecclesiastes',
  'song-of-solomon': 'song of solomon',
  'isaiah': 'isaiah',
  'jeremiah': 'jeremiah',
  'lamentations': 'lamentations',
  'ezekiel': 'ezekiel',
  'daniel': 'daniel',
  'hosea': 'hosea',
  'joel': 'joel',
  'amos': 'amos',
  'obadiah': 'obadiah',
  'jonah': 'jonah',
  'micah': 'micah',
  'nahum': 'nahum',
  'habakkuk': 'habakkuk',
  'zephaniah': 'zephaniah',
  'haggai': 'haggai',
  'zechariah': 'zechariah',
  'malachi': 'malachi',
};

// Book translation unit literalness spread sigma_book in [0.15, 0.45]
const BOOK_SIGMA = {
  'genesis': 0.18, 'exodus': 0.22, 'leviticus': 0.16, 'numbers': 0.18, 'deuteronomy': 0.18,
  'joshua': 0.22, 'joshua-vaticanus-b': 0.22, 'judges': 0.22, 'judges-vaticanus-b': 0.22,
  'ruth': 0.18, '1-samuel': 0.22, '2-samuel': 0.22, '1-kings': 0.24, '2-kings': 0.24,
  '1-chronicles': 0.20, '2-chronicles': 0.20, '2-esdras': 0.20, 'esther-greek': 0.40,
  'job-lxx': 0.42, 'psalms-lxx': 0.22, 'proverbs': 0.40, 'ecclesiastes': 0.16,
  'song-of-solomon': 0.18, 'isaiah': 0.36, 'jeremiah-lxx': 0.28, 'lamentations': 0.20,
  'ezekiel': 0.24, 'daniel': 0.44, 'daniel-theodotion': 0.20,
  'hosea': 0.28, 'joel': 0.24, 'amos': 0.26, 'obadiah': 0.24, 'jonah': 0.24,
  'micah': 0.26, 'nahum': 0.26, 'habakkuk': 0.28, 'zephaniah': 0.26,
  'haggai': 0.22, 'zechariah': 0.24, 'malachi': 0.24,
};

// Preferred primary Greek witness when multiple Rahlfs witnesses map to the same MT book
const BOOK_EDITION_PRIORITY = {
  'joshua-vaticanus-b': 2, 'joshua': 1,
  'judges': 2, 'judges-vaticanus-b': 1,
  'daniel': 2, 'daniel-theodotion': 1,
};

const GREEK_PREVERBS = [
  'ἀντι', 'ἀμφι', 'ἀνα', 'ἀπο', 'δια', 'εἰσ', 'ἐκ', 'ἐξ', 'ἐν', 'ἐπι',
  'κατα', 'κατ', 'μετα', 'μετ', 'παρα', 'παρ', 'περι', 'προσ', 'προ',
  'συν', 'συμ', 'συ', 'ὑπερ', 'ὑπο', 'ὑπ', 'ἀκρο', 'εὐ', 'πρωτο', 'πολυ',
];

const GREEK_FUNC_POS = new Set([
  'article', 'conjunction', 'preposition', 'particle', 'pronoun', 'interjection',
]);

const GREEK_BACKOFF_STOPWORDS = new Set([
  'ἔτι', 'νῦν', 'οὐκέτι', 'μηκέτι', 'πάλιν', 'τότε', 'οὕτως', 'οὕτω',
  'ἐκεῖ', 'ὧδε', 'ἤδη', 'ἄρτι', 'πῶς', 'εὐθύς', 'εὐθέως', 'μάλιστα',
]);

const HEB_FUNC_CL = new Set([
  'prep', 'conj', 'art', 'om', 'pron', 'part', 'rel', 'intg',
]);

export function normalizeGreekLemma(lemma) {
  if (!lemma) return '';
  return lemma.normalize('NFC').trim();
}

export function stripGreekDiacritics(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .normalize('NFC');
}

const GREEK_PREVERBS_PLAIN = GREEK_PREVERBS.map(pv =>
  pv.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ς/g, 'σ').normalize('NFC'),
);
const _stemCache = new Map();

export function stripGreekPreverbStem(lemma) {
  if (!lemma) return '';
  const hit = _stemCache.get(lemma);
  if (hit !== undefined) return hit;
  const plain = stripGreekDiacritics(lemma);
  let res = plain;
  for (const pvPlain of GREEK_PREVERBS_PLAIN) {
    if (plain.startsWith(pvPlain) && plain.length - pvPlain.length >= 4) {
      res = plain.slice(pvPlain.length);
      break;
    }
  }
  if (res === plain && plain.startsWith('α') && plain.length >= 7) {
    res = plain.slice(1);
  }
  _stemCache.set(lemma, res);
  return res;
}

function greekStemPrefix(stem) {
  return stem.length >= 5 ? stem.slice(0, 5) : stem;
}

export function mapHePosToCoarse(cl, morphCode) {
  if (cl === 'verb' || morphCode?.startsWith('V')) return 'V';
  if (cl === 'noun' || morphCode?.startsWith('N')) return 'N';
  if (cl === 'adj' || morphCode?.startsWith('A')) return 'A';
  if (cl === 'adv' || morphCode?.startsWith('D')) return 'D';
  if (cl === 'pron' || morphCode?.startsWith('P')) return 'P';
  if (cl === 'prep' || morphCode?.startsWith('R')) return 'R';
  if (cl === 'conj' || morphCode?.startsWith('C')) return 'C';
  return 'X';
}

export function mapGrkPosToCoarse(pos) {
  if (!pos) return 'X';
  if (pos === 'verb' || pos === 'participle' || pos === 'infinitive') return 'V';
  if (pos === 'noun' || pos === 'proper noun') return 'N';
  if (pos === 'adjective') return 'A';
  if (pos === 'adverb') return 'D';
  if (pos === 'pronoun') return 'P';
  if (pos === 'preposition') return 'R';
  if (pos === 'conjunction' || pos === 'particle') return 'C';
  if (pos === 'article') return 'T';
  return 'X';
}

function parseHebPersonNumber(morphCode) {
  if (!morphCode) return { subj: null, sfx: null };
  // Handles both MACULA ('Vqp3ms', 'Ncmsc+Sp3ms', 'Sp3ms') and STEP ('HR/Ncfsc/Sp3ms', 'HVqp3ms')
  let subj = null;
  let sfx = null;
  const parts = morphCode.split(/[+/]/);
  for (const rawPart of parts) {
    const part = rawPart.replace(/^[HA](?=[VNARDCPST])/, '');
    const sfxMatch = /^Sp([123][mfcb][sp])/i.exec(part);
    if (sfxMatch) sfx = sfxMatch[1].toLowerCase();
    const vMatch = /^V[a-z]{2}([123][mfcb][sp])/i.exec(part);
    if (vMatch) subj = vMatch[1].toLowerCase();
    const pMatch = /^P[a-z]*([123][mfcb][sp])/i.exec(part);
    if (pMatch && !subj) subj = pMatch[1].toLowerCase();
  }
  return { subj, sfx };
}

function classifyStepGrammar(grammarCode) {
  if (!grammarCode) return 'noun';
  const parts = grammarCode.split('/').map(p => p.replace(/^[HA](?=[VNARDCPST])/, ''));
  for (const p of parts) {
    if (p.startsWith('V')) return 'verb';
    if (p.startsWith('N')) return 'noun';
    if (p.startsWith('A')) return 'adj';
  }
  const last = parts[parts.length - 1] || '';
  if (last.startsWith('D')) return 'adv';
  if (last.startsWith('P')) return 'pron';
  if (last.startsWith('R')) return 'prep';
  if (last.startsWith('C')) return 'conj';
  if (last.startsWith('T')) return 'part';
  return 'noun';
}

function parseGrkPersonNumber(parsing, lemma) {
  if (!parsing) return { person: null, number: null };
  let person = null;
  if (/\b1st\b/.test(parsing)) person = '1';
  else if (/\b2nd\b/.test(parsing)) person = '2';
  else if (/\b3rd\b/.test(parsing)) person = '3';
  else if (lemma === 'ἐγώ') person = '1';
  else if (lemma === 'σύ') person = '2';
  else if (lemma === 'αὐτός') person = '3';

  let number = null;
  if (/\bsg\b/.test(parsing)) number = 's';
  else if (/\bpl\b/.test(parsing)) number = 'p';
  return { person, number };
}

function decodeB64Gz(b64) {
  return JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function extractRefChapterVerse(ref) {
  const idx = ref.lastIndexOf(' ');
  return idx >= 0 ? ref.slice(idx + 1) : ref;
}

function parseHeStrongs(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^[HG]\d+$/.test(s)) {
    return s[0] + s.slice(1).padStart(4, '0');
  }
  if (/^\d+$/.test(s)) {
    return 'H' + s.padStart(4, '0');
  }
  return s;
}

/**
 * Evaluate predicted alignment links against eval_300.json.
 * Standard AER = 1 - (|A ∩ S| + |A ∩ P|) / (|A| + |S|)
 * where S = conf === 'high' links, P = all gold links (high + med).
 * Also reports unweighted Precision, Recall, F1, and 1 - F1.
 */
export function evaluateAlignmentLinks(evalVerses, predLinksByRef) {
  let interS = 0;
  let interP = 0;
  let totalA = 0;
  let totalS = 0;
  let totalP = 0;

  for (const ev of evalVerses) {
    const key = `${ev.grk_book}|${ev.ref}`;
    const pred = predLinksByRef.get(key) || [];
    const predSet = new Set(pred.map(l => `${l.h}:${l.g}`));
    const goldS = new Set();
    const goldP = new Set();
    for (const g of ev.links || []) {
      const k = `${g.h}:${g.g}`;
      goldP.add(k);
      if (g.conf === 'high') goldS.add(k);
    }
    totalA += predSet.size;
    totalS += goldS.size;
    totalP += goldP.size;
    for (const k of predSet) {
      if (goldS.has(k)) interS++;
      if (goldP.has(k)) interP++;
    }
  }

  const precision = totalA > 0 ? interP / totalA : 0;
  const recall = totalP > 0 ? interP / totalP : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const aer = totalA + totalS > 0 ? 1 - (interS + interP) / (totalA + totalS) : 1;
  return {
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    aer: Number(aer.toFixed(4)),
    one_minus_f1: Number((1 - f1).toFixed(4)),
    pred_count: totalA,
    gold_sure: totalS,
    gold_possible: totalP,
    inter_sure: interS,
    inter_possible: interP,
  };
}

export function concordanceShardIndex(lemma, numShards = 8) {
  let h = 0x811c9dc5;
  for (let i = 0; i < lemma.length; i++) {
    h ^= lemma.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % numShards;
}

export function writeShardedRahlfsConcordance(concOut, alignDir, numShards = 8) {
  fs.mkdirSync(alignDir, { recursive: true });
  const unshardedStale = path.join(alignDir, 'rahlfs-concordance.bin');
  if (fs.existsSync(unshardedStale)) {
    fs.unlinkSync(unshardedStale);
  }
  const shards = Array.from({ length: numShards }, (_, s) => ({
    schema_version: concOut.schema_version ?? 3,
    license: concOut.license,
    shard: s,
    num_shards: numShards,
    shard_fn: 'fnv1a32_utf16_mod_8',
    total_books: concOut.total_books,
    total_verses: concOut.total_verses,
    lemmas: {},
  }));
  for (const [lem, rec] of Object.entries(concOut.lemmas || {})) {
    const s = concordanceShardIndex(lem, numShards);
    shards[s].lemmas[lem] = rec;
  }
  for (let s = 0; s < numShards; s++) {
    const shardName = `rahlfs-concordance-${String(s).padStart(2, '0')}.bin`;
    fs.writeFileSync(path.join(alignDir, shardName), JSON.stringify(shards[s]));
  }
}

export async function ingestLxxMorph({
  lxxCacheDir = DEFAULT_LXX_CACHE,
  r10Dir = DEFAULT_R10_DIR,
  maculaHebDir = DEFAULT_MACULA_HEB_DIR,
  lexiconPath = DEFAULT_LEXICON_PATH,
  outJsonPath = DEFAULT_OUT_JSON,
  alignDir = DEFAULT_ALIGN_DIR,
  writeOutput = true,
} = {}) {
  const t0 = Date.now();
  const seedsDir = path.join(lxxCacheDir, 'db', 'seeds');
  const lxxMorphDir = path.join(seedsDir, 'lxx_morph');
  const mtAlignDir = path.join(seedsDir, 'mt_alignment');

  // 1. Load sanitized lexicon for IDF(h) and grammatical-marker checks
  const lexicon = fs.existsSync(lexiconPath)
    ? JSON.parse(fs.readFileSync(lexiconPath, 'utf8'))
    : { profiles: {} };
  const profiles = lexicon.profiles || {};

  // 2. Load ALL 60 non-auto JSON files in lxx_morph/ (strictly skip *.auto.json!)
  const lxxMorphFiles = fs.readdirSync(lxxMorphDir)
    .filter(f => f.endsWith('.json') && !f.endsWith('.auto.json'))
    .sort();
  if (lxxMorphFiles.length !== 60) {
    throw new Error(`Expected 60 non-auto JSON files in ${lxxMorphDir}, found ${lxxMorphFiles.length}`);
  }

  const lxxBooks = new Map(); // slug -> Map('ch:v' -> words[])
  const lxxMorphManifest = [];
  let nullResolutionsCount = 0;

  for (const file of lxxMorphFiles) {
    const full = path.join(lxxMorphDir, file);
    const sha256 = sha256File(full);
    lxxMorphManifest.push({ file, sha256, bytes: fs.statSync(full).size });
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (file === '_null_resolutions.json') {
      nullResolutionsCount = Array.isArray(data) ? data.length : Object.keys(data).length;
      continue;
    }
    const slug = file.replace(/\.json$/, '');
    const verseMap = new Map();
    for (const v of data) {
      const cv = extractRefChapterVerse(v.ref);
      verseMap.set(cv, v.words || []);
    }
    lxxBooks.set(slug, verseMap);
  }

  // 3. Load verse_pairs.jsonl, word_links.jsonl.gz, eval_300.json + SHA-256 provenance
  const vpFile = path.join(mtAlignDir, 'verse_pairs.jsonl');
  const wlFile = path.join(mtAlignDir, 'word_links.jsonl.gz');
  const evFile = path.join(mtAlignDir, 'eval_300.json');

  const provenance = {
    source_repo: 'https://github.com/OpenScriptorium/lxx-morph',
    pinned_commit: LXX_COMMIT,
    license: 'CC BY 4.0',
    swete_included: false,
    isc_code_copied: false,
    lxx_morph_non_auto_files: lxxMorphFiles.length,
    lxx_morph_book_files: lxxBooks.size,
    null_resolutions_count: nullResolutionsCount,
    lxx_morph_manifest_sha256: crypto
      .createHash('sha256')
      .update(lxxMorphManifest.map(m => `${m.file}:${m.sha256}`).join('\n'))
      .digest('hex'),
    mt_alignment_files: {
      'verse_pairs.jsonl': { sha256: sha256File(vpFile), bytes: fs.statSync(vpFile).size },
      'word_links.jsonl.gz': { sha256: sha256File(wlFile), bytes: fs.statSync(wlFile).size },
      'eval_300.json': { sha256: sha256File(evFile), bytes: fs.statSync(evFile).size },
    },
  };

  const versePairs = fs.readFileSync(vpFile, 'utf8').trim().split('\n').map(JSON.parse);
  const wordLinksRaw = zlib.gunzipSync(fs.readFileSync(wlFile)).toString('utf8').trim().split('\n').map(JSON.parse);
  const eval300 = JSON.parse(fs.readFileSync(evFile, 'utf8'));

  // 4. Load STEP canonical verses & words from static-corpus tables (5s) or fast-verses fallback
  const tablesDir = path.resolve(maculaHebDir, '..');
  const booksFile = path.join(tablesDir, 'books', 'part-0000.jsonl.gz');
  const versesFile = path.join(tablesDir, 'verses_immutable', 'part-0000.jsonl.gz');
  const wordsDir = path.join(tablesDir, 'words_immutable');
  const stepByRef = new Map(); // "genesis 1:1" -> { vid, book, chapter, verse, ref, toks }
  const stepByVid = new Map();

  if (fs.existsSync(booksFile) && fs.existsSync(versesFile) && fs.existsSync(wordsDir)) {
    const bookById = new Map();
    for (const line of zlib.gunzipSync(fs.readFileSync(booksFile)).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      const b = JSON.parse(line);
      bookById.set(b.id, b.name);
    }
    const wordById = new Map();
    for (const f of fs.readdirSync(wordsDir).filter(x => x.endsWith('.jsonl.gz')).sort()) {
      for (const line of zlib.gunzipSync(fs.readFileSync(path.join(wordsDir, f))).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        const w = JSON.parse(line);
        const bs = parseHeStrongs(w.strongs_nr);
        const pn = parseHebPersonNumber(w.grammar_code);
        wordById.set(w.id, {
          wid: w.id,
          s: bs,
          sf: w.original_word,
          gr: w.grammar_code,
          cl: classifyStepGrammar(w.grammar_code),
          subj_pn: pn.subj,
          sfx_pn: pn.sfx,
        });
      }
    }
    for (const line of zlib.gunzipSync(fs.readFileSync(versesFile)).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      const v = JSON.parse(line);
      if (v.book > 39) continue; // OT only needed for MT<->LXX
      const bookName = bookById.get(v.book) || '';
      const ref = `${bookName} ${v.chapter}:${v.verse_nr}`;
      const toks = (v.word_ids || []).map(wid => wordById.get(wid) || { wid, s: null, sf: '', cl: 'noun' });
      const rec = { vid: v.id, book: v.book, chapter: v.chapter, verse: v.verse_nr, ref, toks };
      stepByRef.set(ref.toLowerCase(), rec);
      stepByVid.set(v.id, rec);
    }
  } else {
    const fastVersesDir = path.join(r10Dir, 'fast-verses');
    for (const f of fs.readdirSync(fastVersesDir).filter(x => /^chunk-.*\.json\.gz$/.test(x)).sort()) {
      const chunk = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fastVersesDir, f))).toString('utf8'));
      for (const [vidStr, b64] of Object.entries(chunk.verses || {})) {
        const v = decodeB64Gz(b64);
        if (v.book > 39) continue;
        const vid = Number(vidStr);
        const rec = { vid, book: v.book, chapter: v.chapter, verse: v.verse, ref: v.ref, toks: v.toks || [] };
        stepByRef.set(v.ref.toLowerCase(), rec);
        stepByVid.set(vid, rec);
      }
    }
  }

  // 5. Fast-scan MACULA Hebrew morphemes ONLY for syntactic role markers (subjref/participantref)
  console.error('[ingest-lxx] step4 loaded stepByRef:', stepByRef.size, Date.now() - t0, 'ms');
  const maculaRoleWids = new Set();
  if (fs.existsSync(maculaHebDir)) {
    const widRe = /"word_id":(\d+)/;
    for (const f of fs.readdirSync(maculaHebDir).filter(x => x.endsWith('.jsonl.gz')).sort()) {
      const lines = zlib.gunzipSync(fs.readFileSync(path.join(maculaHebDir, f))).toString('utf8').split('\n');
      for (const line of lines) {
        if (!line || (line.includes('"subjref":null') && line.includes('"participantref":null'))) continue;
        const m = widRe.exec(line);
        if (m) maculaRoleWids.add(Number(m[1]));
      }
    }
  }
  console.error('[ingest-lxx] step5 maculaRoleWids:', maculaRoleWids.size, Date.now() - t0, 'ms');

  // Helper: map (mt_book, mt_refs[]) -> concatenated STEP tokens with canonical_verse_id + word_id
  function resolveMtTokens(mtBook, mtRefs, grkRefs) {
    const stepBook = MT_BOOK_SLUG_TO_STEP[mtBook] || mtBook.replace(/-/g, ' ');
    const tokens = [];
    const vids = [];
    for (const mr of mtRefs || []) {
      if (stepBook === 'psalms' && mr.endsWith(':1') && (grkRefs?.length >= 2 || true)) {
        const ch = mr.split(':')[0];
        const heading = stepByRef.get(`psalms ${ch}:0`);
        if (heading) {
          vids.push(heading.vid);
          heading.toks.forEach((t, ti) => tokens.push({ ...t, vid: heading.vid, vid_tok_idx: ti }));
        }
      }
      const v = stepByRef.get(`${stepBook} ${mr}`);
      if (v) {
        vids.push(v.vid);
        v.toks.forEach((t, ti) => tokens.push({ ...t, vid: v.vid, vid_tok_idx: ti }));
      }
    }
    return { vids, tokens };
  }

  // 6. Build full Rahlfs concordance across all 59 Rahlfs book files + map canonical_verse_id via verse_pairs
  const vpByGrk = new Map(); // "grk_book|grk_ref" -> vp
  const vpByMtRef = new Map(); // "mt_book|mt_ref" -> vp[]
  for (const vp of versePairs) {
    vpByGrk.set(`${vp.grk_book}|${vp.grk_ref}`, vp);
    if (vp.mt_book && vp.mt_refs?.length) {
      for (const mr of vp.mt_refs) {
        const k = `${vp.mt_book}|${mr}`;
        if (!vpByMtRef.has(k)) vpByMtRef.set(k, []);
        vpByMtRef.get(k).push(vp);
      }
    }
  }

  const rahlfsConcordance = new Map(); // lemma -> { total_occ, verses: Map(loc -> { book, ref, vid, count }) }
  const greekLemmaDf = new Map();
  let totalGrkVerses = 0;
  for (const [slug, verseMap] of lxxBooks.entries()) {
    for (const [cv, words] of verseMap.entries()) {
      totalGrkVerses++;
      const vp = vpByGrk.get(`${slug}|${cv}`);
      let vid = null;
      if (vp?.mt_book && vp.mt_refs?.length) {
        const stepBook = MT_BOOK_SLUG_TO_STEP[vp.mt_book] || vp.mt_book.replace(/-/g, ' ');
        // Note: if psalms heading grk_ref == '3:1' and '3:2' also maps to '3:1', use :0 for first
        let targetRef = vp.mt_refs[0];
        if (stepBook === 'psalms' && targetRef.endsWith(':1')) {
          const ch = targetRef.split(':')[0];
          const sameMt = vpByMtRef.get(`psalms|${targetRef}`) || [];
          if (sameMt.length >= 2 && sameMt[0].grk_ref === cv && stepByRef.has(`psalms ${ch}:0`)) {
            targetRef = `${ch}:0`;
          }
        }
        vid = stepByRef.get(`${stepBook} ${targetRef}`)?.vid || null;
      }
      const seenInVerse = new Set();
      for (let gi = 0; gi < words.length; gi++) {
        const lemma = normalizeGreekLemma(words[gi].lemma || words[gi].surface);
        if (!lemma) continue;
        let rec = rahlfsConcordance.get(lemma);
        if (!rec) {
          rec = { total_occ: 0, verses: new Map() };
          rahlfsConcordance.set(lemma, rec);
        }
        rec.total_occ++;
        const vKey = `${slug}:${cv}`;
        let vRec = rec.verses.get(vKey);
        if (!vRec) {
          vRec = { b: slug, r: cv, vid, c: 0 };
          rec.verses.set(vKey, vRec);
        }
        vRec.c++;
        if (!seenInVerse.has(lemma)) {
          seenInVerse.add(lemma);
          greekLemmaDf.set(lemma, (greekLemmaDf.get(lemma) || 0) + 1);
        }
      }
    }
  }

  const getGreekIdf = (lemma) => {
    const df = greekLemmaDf.get(lemma) || 0;
    return df > 0 ? Math.log2(totalGrkVerses / df) : 0;
  };

  // 7. Build paired verse records combining word_links.jsonl.gz + lxx_morph + STEP tokens
  const wlByKey = new Map(); // "grk_book|ref" -> wl
  for (const wl of wordLinksRaw) {
    wlByKey.set(`${wl.grk_book}|${wl.ref}`, wl);
  }

  const pairedVerses = [];
  let matchedVidsCount = 0;
  let stepTokenMatchedCount = 0;
  let stepTokenFallbackCount = 0;

  for (const wl of wordLinksRaw) {
    const [mtBook, mtCv] = (() => {
      const idx = wl.ref.lastIndexOf(' ');
      return [wl.ref.slice(0, idx), wl.ref.slice(idx + 1)];
    })();
    const grkBookMap = lxxBooks.get(wl.grk_book);
    if (!grkBookMap) continue;

    const grkTokens = [];
    for (const gr of wl.grk_refs || []) {
      const words = grkBookMap.get(gr) || [];
      words.forEach((w, gi) => grkTokens.push({ ...w, grk_ref: gr, grk_tok_idx: gi }));
    }
    const { vids, tokens: stepTokens } = resolveMtTokens(mtBook, [mtCv], wl.grk_refs);
    // Also check if verse_pairs mapped multiple mt_refs (e.g. Exodus 38:15 -> 37:19-21)
    let resolvedVids = vids;
    let resolvedStepTokens = stepTokens;
    if (wl.grk_refs?.length === 1) {
      const vp = vpByGrk.get(`${wl.grk_book}|${wl.grk_refs[0]}`);
      if (vp && vp.mt_refs?.length > 1) {
        const multi = resolveMtTokens(vp.mt_book, vp.mt_refs, wl.grk_refs);
        if (multi.tokens.length > 0) {
          resolvedVids = multi.vids;
          resolvedStepTokens = multi.tokens;
        }
      }
    }
    if (resolvedVids.length > 0) matchedVidsCount++;

    // Map WLC index h -> STEP token
    const maxH = wl.links.reduce((m, l) => Math.max(m, l.h), -1);
    if (resolvedStepTokens.length === maxH + 1 || resolvedStepTokens.length >= maxH + 1) {
      stepTokenMatchedCount++;
    } else {
      stepTokenFallbackCount++;
    }

    pairedVerses.push({
      ref: wl.ref,
      mt_book: mtBook,
      mt_cv: mtCv,
      grk_book: wl.grk_book,
      grk_refs: wl.grk_refs,
      vids: resolvedVids,
      stepTokens: resolvedStepTokens,
      grkTokens,
      backboneLinks: wl.links || [],
    });
  }

  console.error('[ingest-lxx] step7 pairedVerses:', pairedVerses.length, Date.now() - t0, 'ms');
  // 8. Learn Bidirectional IBM-1 / EM Translation Tables + Preverb-Stripped Stem Backoff
  // Seed counts from stability >= 0.7 backbone links across all 23,878 paired verses
  const pairCounts = new Map(); // "h_bs\0g_lemma" -> count
  const hTotals = new Map();
  const gTotals = new Map();
  const stemPairCounts = new Map(); // "h_bs\0g_stem" -> count

  for (const pv of pairedVerses) {
    pv.emHs = pv.stepTokens.filter(t => t?.s && !HEB_FUNC_CL.has(t.cl)).map(t => t.s);
    pv.emGs = pv.grkTokens
      .filter(t => t && !GREEK_FUNC_POS.has(t.pos))
      .map(t => normalizeGreekLemma(t.lemma || t.surface))
      .filter(Boolean);
    for (const l of pv.backboneLinks) {
      if ((l.stability || 0) < 0.7 && !l.rule) continue;
      const hTok = pv.stepTokens[Math.min(l.h, pv.stepTokens.length - 1)];
      const gTok = pv.grkTokens[l.g];
      if (!hTok?.s || !gTok || GREEK_FUNC_POS.has(gTok.pos)) continue;
      const hBs = hTok.s;
      const gLem = normalizeGreekLemma(gTok.lemma || gTok.surface);
      if (!gLem || ['ὁ', 'καί', 'δέ', 'ἐν', 'εἰς', 'αὐτός', 'ὅς', 'οὗτος', 'ἐγώ', 'σύ', 'ἐκ', 'ἀπό', 'ἐπί', 'πρός', 'διά', 'μετά', 'ὑπό', 'παρά', 'περί', 'ὅτι', 'οὐ', 'μή', 'γάρ', 'ἀλλά', 'ἤ', 'εἰ', 'ὡς', 'καθώς', 'εἰμί', 'τίς', 'τις', 'οὖν', 'τέ', 'ἄν', 'ἵνα'].includes(gLem)) continue;
      const w = l.stability || 0.85;
      const k = `${hBs}\0${gLem}`;
      pairCounts.set(k, (pairCounts.get(k) || 0) + w);
      hTotals.set(hBs, (hTotals.get(hBs) || 0) + w);
      gTotals.set(gLem, (gTotals.get(gLem) || 0) + w);

      const gStem = stripGreekPreverbStem(gLem);
      if (gStem) {
        const sk = `${hBs}\0${gStem}`;
        stemPairCounts.set(sk, (stemPairCounts.get(sk) || 0) + w);
        const gp = greekStemPrefix(gStem);
        if (gp !== gStem) {
          const pk = `${hBs}\0${gp}`;
          stemPairCounts.set(pk, (stemPairCounts.get(pk) || 0) + w);
        }
      }
    }
  }

  // 5 iterations of IBM-1 EM refinement over co-occurring content pairs
  // Only accumulate soft expectations for pairs with non-trivial prior support or short/unaligned windows
  let pFwd = new Map(); // "h_bs\0g_lemma" -> P(g|h)
  let pRev = new Map(); // "h_bs\0g_lemma" -> P(h|g)
  const updateProbsFromCounts = (counts, hTot, gTot) => {
    const fwd = new Map();
    const rev = new Map();
    for (const [k, c] of counts.entries()) {
      const sep = k.indexOf('\0');
      const h = k.slice(0, sep);
      const g = k.slice(sep + 1);
      fwd.set(k, (c + 0.05) / ((hTot.get(h) || 1) + 0.5));
      rev.set(k, (c + 0.05) / ((gTot.get(g) || 1) + 0.5));
    }
    return { fwd, rev };
  };
  ({ fwd: pFwd, rev: pRev } = updateProbsFromCounts(pairCounts, hTotals, gTotals));

  // Pre-filter co-occurring pairs that appear at least twice across pairedVerses (eliminates 95% of 1-off noise pairs)
  const coocFreq = new Map();
  for (const pv of pairedVerses) {
    const hs = new Set(pv.emHs);
    const gs = new Set(pv.emGs);
    for (const h of hs) {
      for (const g of gs) {
        const k = `${h}\0${g}`;
        if (pairCounts.has(k)) continue;
        coocFreq.set(k, (coocFreq.get(k) || 0) + 1);
      }
    }
  }
  const activePairs = new Set(pairCounts.keys());
  for (const [k, f] of coocFreq.entries()) {
    if (f >= 2) activePairs.add(k);
  }
  console.error('[ingest-lxx] activePairs:', activePairs.size, Date.now() - t0, 'ms');

  for (let iter = 0; iter < 5; iter++) {
    const nextCounts = new Map(pairCounts);
    const nextHTot = new Map(hTotals);
    const nextGTot = new Map(gTotals);
    for (const [k, v] of nextCounts.entries()) nextCounts.set(k, v * 0.5);
    for (const [k, v] of nextHTot.entries()) nextHTot.set(k, v * 0.5);
    for (const [k, v] of nextGTot.entries()) nextGTot.set(k, v * 0.5);

    for (const pv of pairedVerses) {
      const hs = pv.emHs;
      const gs = pv.emGs;
      if (!hs.length || !gs.length) continue;
      for (const gLem of gs) {
        let z = 1e-6;
        const scores = new Float64Array(hs.length);
        for (let i = 0; i < hs.length; i++) {
          const k = `${hs[i]}\0${gLem}`;
          const s = pFwd.get(k) || (activePairs.has(k) ? 1e-3 : 0);
          scores[i] = s;
          z += s;
        }
        for (let i = 0; i < hs.length; i++) {
          const post = scores[i] / z;
          if (post < 0.08) continue;
          const k = `${hs[i]}\0${gLem}`;
          nextCounts.set(k, (nextCounts.get(k) || 0) + post);
          nextHTot.set(hs[i], (nextHTot.get(hs[i]) || 0) + post);
          nextGTot.set(gLem, (nextGTot.get(gLem) || 0) + post);
        }
      }
    }
    ({ fwd: pFwd, rev: pRev } = updateProbsFromCounts(nextCounts, nextHTot, nextGTot));
    console.error('[ingest-lxx] EM iter', iter + 1, Date.now() - t0, 'ms');
  }

  // Stem backoff probability P_stem(g_stem | h_bs)
  const pStemFwd = new Map();
  for (const [sk, c] of stemPairCounts.entries()) {
    const h = sk.slice(0, sk.indexOf('\0'));
    pStemFwd.set(sk, (c + 0.05) / ((hTotals.get(h) || 1) + 0.5));
  }

  const totalHTokens = [...hTotals.values()].reduce((a, b) => a + b, 0) || 1;
  const totalGTokens = [...gTotals.values()].reduce((a, b) => a + b, 0) || 1;

  /**
   * Compute Morpho-Syntactic Psi(i, j) matrix score for candidate (h_i, g_j).
   */
  function scorePsi(hMeta, gMeta, i, m, j, n, sigmaBook) {
    const k = `${hMeta.bs}\0${gMeta.lemma}`;
    let pf = pFwd.get(k) || 0;
    let pr = pRev.get(k) || 0;

    // Preverb / compound stem backoff (catches e.g. פִּנָּה -> ἀκρογωνιαῖος, קָרָא -> μετακαλέω)
    let compoundBonus = 0;
    const sk = `${hMeta.bs}\0${gMeta.stem}`;
    const spk = `${hMeta.bs}\0${greekStemPrefix(gMeta.stem)}`;
    const pStem = Math.max(pStemFwd.get(sk) || 0, 0.7 * (pStemFwd.get(spk) || 0));
    if (pStem > 0.02) {
      pf = Math.max(pf, 0.35 * pStem);
      pr = Math.max(pr, 0.25 * pStem);
      compoundBonus = 1.5;
    }

    const p0g = Math.max(1e-6, (gTotals.get(gMeta.lemma) || 1) / totalGTokens);
    const p0h = Math.max(1e-6, (hTotals.get(hMeta.bs) || 1) / totalHTokens);
    const lexTerm = pf > 0 && pr > 0
      ? Math.log2((pf * pr) / (p0g * p0h))
      : -4.0;

    // Phi_POS (lambda_pos = 3.0)
    const phiPos = hMeta.cpos === gMeta.cpos ? 1.0 : (hMeta.cpos !== 'X' && gMeta.cpos !== 'X' ? -0.6 : 0);
    // Phi_feat (lambda_feat = 1.5): person / number agreement
    let phiFeat = 0;
    if (hMeta.pn && gMeta.pn) {
      if (hMeta.pn.person && gMeta.pn.person && hMeta.pn.person === gMeta.pn.person) phiFeat += 0.5;
      if (hMeta.pn.number && gMeta.pn.number && hMeta.pn.number === gMeta.pn.number) phiFeat += 0.5;
    }
    // Phi_role (lambda_role = 2.0): MACULA argument / predicate alignment
    let phiRole = 0;
    if (hMeta.has_role && !GREEK_FUNC_POS.has(gMeta.pos)) phiRole = 0.5;
    else if (hMeta.cpos === 'V' && gMeta.cpos === 'V') phiRole = 0.5;

    const dist = Math.abs((i + 0.5) / Math.max(1, m) - (j + 0.5) / Math.max(1, n));
    return (
      lexTerm +
      compoundBonus +
      3.0 * phiPos +
      1.5 * phiFeat +
      2.0 * phiRole -
      0.6 * (dist / sigmaBook)
    );
  }

  function runBackoffPass(hList, gList, existingLinks, grkBook) {
    const alignedH = new Set(existingLinks.map(l => l.h));
    const alignedG = new Set(existingLinks.map(l => l.g));
    const sigmaBook = BOOK_SIGMA[grkBook] || 0.25;
    const m = hList.length;
    const n = gList.length;

    const candidates = [];
    for (let i = 0; i < m; i++) {
      if (alignedH.has(i) || hList[i].isFunc) continue;
      for (let j = 0; j < n; j++) {
        if (alignedG.has(j) || gList[j].isFunc) continue;
        if (GREEK_BACKOFF_STOPWORDS.has(gList[j].lemma)) continue;
        // Prevent nominal / proper-name backoff onto Greek adverbs (e.g. H3819 -> ἔτι)
        if (hList[i].cpos === 'N' && gList[j].cpos === 'D') continue;
        const psi = scorePsi(hList[i], gList[j], i, m, j, n, sigmaBook);
        if (psi >= 3.2) {
          candidates.push({ h: i, g: j, psi });
        }
      }
    }
    candidates.sort((a, b) => b.psi - a.psi);
    const added = [];
    for (const c of candidates) {
      if (alignedH.has(c.h) || alignedG.has(c.g)) continue;
      alignedH.add(c.h);
      alignedG.add(c.g);
      added.push({ h: c.h, g: c.g, psi: Number(c.psi.toFixed(3)), method: 'psi_backoff' });
    }
    return added;
  }

  const rawPairFreq = new Map();
  for (const pv of pairedVerses) {
    for (const l of pv.backboneLinks) {
      if (l.rule) continue;
      const hTok = pv.stepTokens[Math.min(l.h, pv.stepTokens.length - 1)];
      const gTok = pv.grkTokens[l.g];
      if (!hTok?.s || !gTok) continue;
      const gLem = normalizeGreekLemma(gTok.lemma || gTok.surface);
      const rk = `${hTok.s}\0${gLem}`;
      rawPairFreq.set(rk, (rawPairFreq.get(rk) || 0) + 1);
    }
  }

  function filterWeakHallucinations(links, hList, gList) {
    const prunedH = new Set();
    const keptMain = [];
    for (const l of links) {
      if (l.rule) continue;
      const hTok = hList[l.h];
      const gTok = gList[l.g];
      if (
        hTok && gTok &&
        !hTok.isFunc && !gTok.isFunc &&
        l.stability !== undefined && l.stability < 0.55 &&
        ((hTok.cpos === 'D' && gTok.cpos === 'N') || (hTok.cpos === 'N' && gTok.cpos === 'D')) &&
        (rawPairFreq.get(`${hTok.bs}\0${gTok.lemma}`) || 0) <= 1
      ) {
        prunedH.add(l.h);
        continue;
      }
      keptMain.push(l);
    }
    const keptH = new Set(keptMain.map(l => l.h));
    return links.filter(l => {
      if (!l.rule) return !prunedH.has(l.h) || keptMain.includes(l);
      return !prunedH.has(l.h) || keptH.has(l.h);
    });
  }

  // 9. Evaluate strictly on eval_300.json (both raw word_links and fused word_links + Psi(i,j))
  const evalRawPred = new Map();
  const evalFusedPred = new Map();
  for (const ev of eval300) {
    const key = `${ev.grk_book}|${ev.ref}`;
    const wl = wlByKey.get(key);
    const baseLinks = (wl?.links || []).map(l => ({ h: l.h, g: l.g, stability: l.stability, rule: l.rule }));
    evalRawPred.set(key, baseLinks);

    // Build hList & gList from eval_300 + lxx_morph pos/parsing
    const grkBookMap = lxxBooks.get(ev.grk_book);
    const grkWords = [];
    for (const gr of ev.grk_refs || []) {
      grkWords.push(...(grkBookMap?.get(gr) || []));
    }
    const hList = (ev.heb || []).map(h => {
      const bs = parseHeStrongs(h.strongs);
      const cpos = mapHePosToCoarse(null, h.morph);
      const pnRaw = parseHebPersonNumber(h.morph);
      return {
        bs,
        cpos,
        isFunc: /^(?:Conj|Prep|Art|Pron|Rel|Intg|Part)/.test(h.morph || '') && !/N-|V-|Adj-/.test(h.morph || ''),
        has_role: cpos === 'V' || cpos === 'N',
        pn: pnRaw.subj ? { person: pnRaw.subj[0], number: pnRaw.subj[2] } : null,
      };
    });
    const gList = (ev.grk || []).map((g, gi) => {
      const mw = grkWords[gi] || {};
      const lemma = normalizeGreekLemma(g.lemma || mw.lemma || g.surface);
      const pos = mw.pos || '';
      const pn = parseGrkPersonNumber(mw.parsing || '', lemma);
      return {
        lemma,
        stem: stripGreekPreverbStem(lemma),
        pos,
        cpos: mapGrkPosToCoarse(pos),
        isFunc: GREEK_FUNC_POS.has(pos),
        pn,
      };
    });
    const cleanBase = filterWeakHallucinations(baseLinks, hList, gList);
    const backoff = runBackoffPass(hList, gList, cleanBase, ev.grk_book);
    evalFusedPred.set(key, [...cleanBase, ...backoff]);
  }

  const evalRawMetrics = evaluateAlignmentLinks(eval300, evalRawPred);
  const evalFusedMetrics = evaluateAlignmentLinks(eval300, evalFusedPred);
  console.error('[ingest-lxx] step9 eval_300:', JSON.stringify({ raw: evalRawMetrics, fused: evalFusedMetrics }), Date.now() - t0, 'ms');

  // 10. Fuse word_links + Psi(i,j) across ALL 23,878 paired verses + extract typed LxxTranslationShift records
  const alignmentsByVerse = [];
  const shiftCounts = {
    pronoun_person_shift: 0,
    lexical_theological_shift: 0,
    lxx_plus_expansion: 0,
    mt_minus: 0,
  };
  let totalLinksCount = 0;
  let backoffLinksCount = 0;

  const empPairCounts = new Map();
  const empHTotals = new Map();
  const stagedVerses = [];

  for (const pv of pairedVerses) {
    const hList = pv.stepTokens.map(t => {
      const cpos = mapHePosToCoarse(t.cl, t.gr);
      const pnStr = t.subj_pn;
      return {
        bs: t.s,
        wid: t.wid,
        vid: t.vid,
        vid_tok_idx: t.vid_tok_idx,
        sf: t.sf,
        cl: t.cl,
        cpos,
        isFunc: HEB_FUNC_CL.has(t.cl),
        has_role: Boolean((t.wid && maculaRoleWids.has(t.wid)) || cpos === 'V' || cpos === 'N'),
        pn: pnStr ? { person: pnStr[0], number: pnStr[2] } : null,
        sfx_pn: t.sfx_pn || null,
      };
    });
    const gList = pv.grkTokens.map(g => {
      const lemma = normalizeGreekLemma(g.lemma || g.surface);
      return {
        lemma,
        surface: g.surface,
        stem: stripGreekPreverbStem(lemma),
        pos: g.pos || '',
        parsing: g.parsing || '',
        cpos: mapGrkPosToCoarse(g.pos),
        isFunc: GREEK_FUNC_POS.has(g.pos),
        pn: parseGrkPersonNumber(g.parsing || '', lemma),
      };
    });

    const baseLinks = filterWeakHallucinations(
      pv.backboneLinks.map(l => ({
        h: l.h,
        g: l.g,
        ...(l.stability !== undefined ? { stability: l.stability } : {}),
        ...(l.rule ? { rule: l.rule } : {}),
      })),
      hList,
      gList,
    );
    const backoff = runBackoffPass(hList, gList, baseLinks, pv.grk_book);
    backoffLinksCount += backoff.length;
    const fused = [...baseLinks, ...backoff].map(l => {
      const hTok = hList[l.h];
      const gTok = gList[l.g];
      if (!l.rule && hTok?.bs && gTok?.lemma) {
        const ek = `${hTok.bs}\0${gTok.lemma}`;
        empPairCounts.set(ek, (empPairCounts.get(ek) || 0) + 1);
        empHTotals.set(hTok.bs, (empHTotals.get(hTok.bs) || 0) + 1);
      }
      return {
        ...l,
        ...(hTok?.wid ? { wid: hTok.wid, vid: hTok.vid, h_bs: hTok.bs } : {}),
        ...(gTok ? { g_lemma: gTok.lemma } : {}),
      };
    });
    totalLinksCount += fused.length;
    stagedVerses.push({ pv, hList, gList, fused });
  }

  for (const { pv, hList, gList, fused } of stagedVerses) {
    // Extract typed LxxTranslationShift records
    const shifts = [];
    const seenShift = new Set();

    // 10a. pronoun_person_shift: aligned (h_i, g_j) or clitic pronoun within [j, j+2]
    for (const l of fused) {
      const hTok = hList[l.h];
      if (!hTok?.sfx_pn) continue;
      const hPers = hTok.sfx_pn[0];
      const hNum = hTok.sfx_pn[2];
      const candGIndices = l.rule === 'sfx' ? [l.g] : [l.g, l.g + 1, l.g + 2];
      for (const gj of candGIndices) {
        const gTok = gList[gj];
        if (!gTok || gTok.pos !== 'pronoun') continue;
        if (gTok.pn.person && (gTok.pn.person !== hPers || (gTok.pn.number && gTok.pn.number !== hNum))) {
          const sk = `pps:${l.h}:${gj}`;
          if (!seenShift.has(sk)) {
            seenShift.add(sk);
            shiftCounts.pronoun_person_shift++;
            shifts.push({
              type: 'pronoun_person_shift',
              h: l.h,
              g: gj,
              h_bs: hTok.bs,
              h_sf: hTok.sf,
              h_sfx: hTok.sfx_pn,
              g_surface: gTok.surface,
              g_lemma: gTok.lemma,
              g_parsing: gTok.parsing,
            });
          }
        }
      }
    }

    // 10b. lexical_theological_shift: empirical P(g|h) < 0.08 && IDF(g) >= 3.5
    for (const l of fused) {
      if (l.rule) continue;
      const hTok = hList[l.h];
      const gTok = gList[l.g];
      if (!hTok || !gTok || hTok.isFunc || gTok.isFunc) continue;
      if (hTok.pos === 'proper noun' || gTok.pos === 'proper noun') continue;
      const pgh = (empPairCounts.get(`${hTok.bs}\0${gTok.lemma}`) || 0) / Math.max(1, empHTotals.get(hTok.bs) || 1);
      const gIdf = getGreekIdf(gTok.lemma);
      if (pgh < 0.08 && gIdf >= 3.5 && (l.stability >= 0.6 || l.psi >= 3.5)) {
        const sk = `lts:${l.h}:${l.g}`;
        if (!seenShift.has(sk)) {
          seenShift.add(sk);
          shiftCounts.lexical_theological_shift++;
          shifts.push({
            type: 'lexical_theological_shift',
            h: l.h,
            g: l.g,
            h_bs: hTok.bs,
            h_sf: hTok.sf,
            g_lemma: gTok.lemma,
            g_surface: gTok.surface,
            p_g_given_h: Number(pgh.toFixed(4)),
            g_idf: Number(gIdf.toFixed(2)),
          });
        }
      }
    }

    // 10c. lxx_plus_expansion & mt_minus: contiguous unaligned content span len >= 2 or sum IDF >= 5.0
    const alignedGSet = new Set(fused.map(l => l.g));
    const alignedHSet = new Set(fused.map(l => l.h));

    let curSpan = [];
    const flushG = () => {
      const content = curSpan.filter(idx => !gList[idx].isFunc);
      const sumIdf = content.reduce((acc, idx) => acc + getGreekIdf(gList[idx].lemma), 0);
      if (content.length >= 2 || sumIdf >= 5.0) {
        shiftCounts.lxx_plus_expansion++;
        shifts.push({
          type: 'lxx_plus_expansion',
          g_start: curSpan[0],
          g_end: curSpan[curSpan.length - 1],
          content_len: content.length,
          sum_idf: Number(sumIdf.toFixed(2)),
          text: curSpan.map(idx => gList[idx].surface).join(' '),
          lemmas: content.map(idx => gList[idx].lemma),
        });
      }
      curSpan = [];
    };
    for (let gj = 0; gj < gList.length; gj++) {
      if (!alignedGSet.has(gj)) curSpan.push(gj);
      else if (curSpan.length) flushG();
    }
    if (curSpan.length) flushG();

    let curHSpan = [];
    const flushH = () => {
      const content = curHSpan.filter(idx => !hList[idx].isFunc);
      const sumIdf = content.reduce((acc, idx) => acc + (profiles[hList[idx].bs]?.idf || 4.0), 0);
      if (content.length >= 2 || sumIdf >= 5.0) {
        shiftCounts.mt_minus++;
        shifts.push({
          type: 'mt_minus',
          h_start: curHSpan[0],
          h_end: curHSpan[curHSpan.length - 1],
          content_len: content.length,
          sum_idf: Number(sumIdf.toFixed(2)),
          strongs: content.map(idx => hList[idx].bs),
        });
      }
      curHSpan = [];
    };
    for (let hi = 0; hi < hList.length; hi++) {
      if (!alignedHSet.has(hi)) curHSpan.push(hi);
      else if (curHSpan.length) flushH();
    }
    if (curHSpan.length) flushH();

    alignmentsByVerse.push({
      ref: pv.ref,
      grk_book: pv.grk_book,
      grk_refs: pv.grk_refs,
      vids: pv.vids,
      edition_priority: BOOK_EDITION_PRIORITY[pv.grk_book] || 2,
      links: fused,
      shifts,
      heb_tokens: hList.map(h => ({ sf: h.sf, bs: h.bs, wid: h.wid, vid: h.vid })),
      grk_tokens: gList.map(g => ({ s: g.surface, l: g.lemma, p: g.pos })),
    });
  }

  // 11. Build sharded mt-lxx-00..31.bin & rahlfs-concordance.bin
  if (writeOutput) {
    fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
    fs.mkdirSync(alignDir, { recursive: true });

    const outDoc = {
      schema_version: 3,
      generated_at: new Date().toISOString(),
      provenance,
      stats: {
        paired_verses: pairedVerses.length,
        matched_canonical_vids: matchedVidsCount,
        step_token_exact_or_bounded: stepTokenMatchedCount,
        step_token_fallback: stepTokenFallbackCount,
        total_links: totalLinksCount,
        backoff_links_added: backoffLinksCount,
        shift_counts: shiftCounts,
        rahlfs_unique_lemmas: rahlfsConcordance.size,
      },
      eval_300: {
        raw_word_links: evalRawMetrics,
        fused_psi_backoff: evalFusedMetrics,
      },
      verses: alignmentsByVerse,
    };
    fs.writeFileSync(outJsonPath, JSON.stringify(outDoc));

    // Write 32 compact shards mt-lxx-00..31.bin partitioned by primary canonical_verse_id % 32
    const shards = Array.from({ length: 32 }, () => ({ schema_version: 3, verses: {} }));
    for (const v of alignmentsByVerse) {
      const primaryVid = v.vids[0] || 0;
      const shardIdx = primaryVid % 32;
      const entry = {
        ref: v.ref,
        grk_book: v.grk_book,
        grk_refs: v.grk_refs,
        vids: v.vids,
        links: v.links,
        shifts: v.shifts,
        grk_tokens: v.grk_tokens,
      };
      const existing = shards[shardIdx].verses[primaryVid];
      if (!existing || v.edition_priority > (existing._pri || 0)) {
        if (existing) entry.alt_editions = [...(existing.alt_editions || []), { grk_book: existing.grk_book, grk_refs: existing.grk_refs, links: existing.links, shifts: existing.shifts }];
        shards[shardIdx].verses[primaryVid] = { ...entry, _pri: v.edition_priority };
      } else {
        existing.alt_editions = [...(existing.alt_editions || []), entry];
      }
    }
    for (let s = 0; s < 32; s++) {
      for (const rec of Object.values(shards[s].verses)) delete rec._pri;
      const shardName = `mt-lxx-${String(s).padStart(2, '0')}.bin`;
      fs.writeFileSync(path.join(alignDir, shardName), JSON.stringify(shards[s]));
    }

    // Write full rahlfs-concordance.bin to v3-build and 8 < 4 MiB shards to alignDir
    const concOut = {
      schema_version: 3,
      license: 'CC BY 4.0 (OpenScriptorium/lxx-morph Rahlfs 1935)',
      total_books: lxxBooks.size,
      total_verses: totalGrkVerses,
      lemmas: {},
    };
    for (const [lem, rec] of [...rahlfsConcordance.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      concOut.lemmas[lem] = {
        total_occ: rec.total_occ,
        df: rec.verses.size,
        idf: Number(getGreekIdf(lem).toFixed(4)),
        verses: [...rec.verses.values()],
      };
    }
    fs.writeFileSync(path.join(path.dirname(outJsonPath), 'rahlfs-concordance.bin'), JSON.stringify(concOut));
    writeShardedRahlfsConcordance(concOut, alignDir, 8);
  }

  return {
    outJsonPath,
    alignDir,
    elapsed_ms: Date.now() - t0,
    eval_300: {
      raw_word_links: evalRawMetrics,
      fused_psi_backoff: evalFusedMetrics,
    },
    stats: {
      paired_verses: pairedVerses.length,
      matched_canonical_vids: matchedVidsCount,
      total_links: totalLinksCount,
      backoff_links_added: backoffLinksCount,
      shift_counts: shiftCounts,
      rahlfs_unique_lemmas: rahlfsConcordance.size,
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const res = await ingestLxxMorph();
  console.log(JSON.stringify(res, null, 2));
}
