// @file: scripts/build-literary-chunks.mjs
// Precomputes sanitized per-chapter literary payloads packed into 64 small binary packs
// (`v2/literary/index.json.gz` + `pack-00.bin`..`pack-3f.bin`) compatible with `packedShardEntry`
// byte-range reads in `corpus-worker.mjs` (< 3 ms Cloudflare Worker CPU, zero restricted MACULA fields).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  tokenizeShardVerses,
  extractClauseFrames,
} from '../src/relationships/literary-engine.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, '.artifacts-r12/staging-bundle');
const OUT_DIR = path.join(ROOT, '.artifacts/v2/literary');
const CHAPTERS_DIR = path.join(BUNDLE, 'v1/chapters');
const NUM_PACKS = 64;

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

function checkNoRestrictedKeys(val, p = '') {
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) checkNoRestrictedKeys(val[i], `${p}[${i}]`);
  } else if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      if (RESTRICTED_KEYS.has(k)) throw new Error(`Restricted key "${k}" at ${p}.${k}`);
      if (v && typeof v === 'object') checkNoRestrictedKeys(v, `${p}.${k}`);
    }
  }
}

function fnv1aHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const old of fs.readdirSync(OUT_DIR)) {
  fs.unlinkSync(path.join(OUT_DIR, old));
}

const chapterFiles = fs
  .readdirSync(CHAPTERS_DIR)
  .filter(f => /^b\d+-c\d+\.json\.gz$/.test(f))
  .sort();

const packBuffers = Array.from({ length: NUM_PACKS }, () => []);
const packOffsets = new Array(NUM_PACKS).fill(0);
const indexEntries = {};
let totalVerses = 0;
let syntaxVerses = 0;
let maxRecGz = 0;

for (const file of chapterFiles) {
  const ch = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CHAPTERS_DIR, file))).toString('utf8'));
  const rawVerses = Object.values(ch.verses || {});
  if (!rawVerses.length) continue;

  const { edition, tokens, verseList } = tokenizeShardVerses(rawVerses);
  const { frames } = extractClauseFrames(verseList, tokens, edition);

  const framesByVid = new Map();
  for (const fr of frames) {
    const arr = framesByVid.get(fr.verseId) ?? [];
    arr.push({
      id: fr.id,
      verseId: fr.verseId,
      ref: fr.ref,
      startPos: fr.startPos,
      endPos: fr.endPos,
      predicateLemma: fr.predicateLemma,
      predicateStrongs: fr.predicateStrongs,
      predicateScript: fr.predicateScript,
      predicateWordId: fr.predicateWordId,
      predicatePerson: fr.predicatePerson,
      predicateMood: fr.predicateMood,
      subjectLemmas: fr.subjectLemmas,
      objectLemmas: fr.objectLemmas,
      modifierPairs: fr.modifierPairs,
      clauseType: fr.clauseType,
      isDirectSpeech: fr.isDirectSpeech,
      ...(fr.sourceNodeId ? { sourceNodeId: fr.sourceNodeId } : {}),
    });
    framesByVid.set(fr.verseId, arr);
  }

  const chapterVerses = {};
  for (const v of verseList) {
    totalVerses++;
    const vid = Number(v.verse_id);
    const preferredEdition = edition === 'hbo' ? 'macula-hebrew-wlc' : 'macula-greek-nestle1904';
    const treePrefix = edition === 'hbo' ? 'macula_tree:macula-hebrew-wlc' : 'macula_tree:macula-greek-nestle1904';
    const hasSyntax = (v.syntax_nodes || []).some(
      n => String(n.edition_key ?? '') === preferredEdition && String(n.node_key ?? '').startsWith(treePrefix)
    );
    if (hasSyntax) syntaxVerses++;

    const morphByPos = new Map();
    for (const m of v.morphhb_tokens || []) {
      const wn = Number(m.word_num);
      if (Number.isInteger(wn)) morphByPos.set(wn, m);
    }

    const tokByPos = new Map();
    for (const t of tokens) {
      if (t.verseId === vid) tokByPos.set(t.pos, t);
    }

    const compactTokens = (v.tokens || [])
      .slice()
      .sort((a, b) => Number(a.word_position) - Number(b.word_position))
      .map(t => {
        const pos = Number(t.word_position);
        const lt = tokByPos.get(pos);
        const cant = morphByPos.get(pos)?.cantillation;
        return {
          word_position: pos,
          word_id: Number(t.word_id ?? 0),
          surface_form: String(t.surface_form ?? ''),
          ...(t.transliteration ? { transliteration: String(t.transliteration) } : {}),
          ...(lt?.gloss ? { gloss: lt.gloss } : {}),
          ...(t.base_strongs ? { base_strongs: String(t.base_strongs) } : {}),
          ...(lt?.lemmaSource === 'occurrence' ? { lemma_key: lt.lemmaKey, lemma_script: lt.lemmaScript } : {}),
          ...(lt?.grammarCode ? { word_grammar_code: lt.grammarCode } : {}),
          ...(lt?.posClass ? { pos_class: lt.posClass } : {}),
          ...(lt?.person ? { person: lt.person } : {}),
          ...(lt?.number ? { number: lt.number } : {}),
          ...(lt?.gender ? { gender: lt.gender } : {}),
          ...(lt?.stem ? { stem: lt.stem } : {}),
          ...(lt?.mood ? { mood: lt.mood } : {}),
          ...(cant != null && String(cant) !== '' ? { cantillation: String(cant) } : {}),
        };
      });

    const lxxVerses = [];
    if (v.lxx_target_tokens && typeof v.lxx_target_tokens === 'object') {
      for (const [k, list] of Object.entries(v.lxx_target_tokens)) {
        if (!Array.isArray(list) || !list.length) continue;
        const sortedList = [...list].sort((a, b) => Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0));
        const parts = k.split(':');
        const bNo = Number(parts[0]) || Number(v.hebrew_lxx_verse_map?.[0]?.lxx_book_no ?? v.book);
        const chNo = Number(parts[1]) || Number(v.hebrew_lxx_verse_map?.[0]?.lxx_chapter ?? v.chapter);
        const vNo = Number(parts[3]) || Number(v.hebrew_lxx_verse_map?.[0]?.lxx_verse_nr ?? v.verse_nr);
        lxxVerses.push({
          book_no: bNo,
          chapter: chNo,
          verse_nr: vNo,
          word_count: sortedList.length,
          text: sortedList.map(w => String(w.word_text ?? '')).join(' '),
          norm: sortedList.map(w => String(w.normalized_word ?? '')).join(' '),
          tail_text: sortedList.slice(-8).map(w => String(w.word_text ?? '')).join(' '),
        });
      }
    }

    chapterVerses[String(v.verse_nr)] = {
      verse_id: vid,
      book: v.book,
      chapter: v.chapter,
      verse_nr: v.verse_nr,
      tokens: compactTokens,
      ...(hasSyntax ? { literary_clauses: framesByVid.get(vid) ?? [] } : { literary_clauses: null }),
      ...(Array.isArray(v.hebrew_lxx_verse_map) && v.hebrew_lxx_verse_map.length > 0
        ? {
            hebrew_lxx_verse_map: v.hebrew_lxx_verse_map.map(m => ({
              lxx_book_no: m.lxx_book_no,
              lxx_chapter: m.lxx_chapter,
              lxx_verse_nr: m.lxx_verse_nr,
              mapping_kind: m.mapping_kind,
            })),
          }
        : {}),
      ...(lxxVerses.length > 0 ? { lxx_verses: lxxVerses } : {}),
    };
  }

  const chKey = `${verseList[0].book}:${verseList[0].chapter}`;
  const recPayload = { schema_version: 1, verses: chapterVerses };
  checkNoRestrictedKeys(recPayload, chKey);
  const recGz = zlib.gzipSync(JSON.stringify(recPayload), { level: 9 });
  maxRecGz = Math.max(maxRecGz, recGz.length);

  const packIdx = fnv1aHash(chKey) % NUM_PACKS;
  const packFile = `pack-${packIdx.toString(16).padStart(2, '0')}.bin`;
  const start = packOffsets[packIdx];
  packBuffers[packIdx].push(recGz);
  packOffsets[packIdx] += recGz.length;
  indexEntries[chKey] = [packFile, start, recGz.length];
}

let totalPackBytes = 0;
let maxPackBytes = 0;
for (let i = 0; i < NUM_PACKS; i++) {
  const packFile = `pack-${i.toString(16).padStart(2, '0')}.bin`;
  const buf = Buffer.concat(packBuffers[i]);
  totalPackBytes += buf.length;
  maxPackBytes = Math.max(maxPackBytes, buf.length);
  fs.writeFileSync(path.join(OUT_DIR, packFile), buf);
}

const indexRaw = JSON.stringify({ schema_version: 'packed-1', entries: indexEntries });
fs.writeFileSync(path.join(OUT_DIR, 'index.json'), indexRaw);
const distDir = path.join(ROOT, 'dist');
if (fs.existsSync(distDir)) {
  const distLit = path.join(distDir, 'v2/literary');
  fs.mkdirSync(distLit, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR)) {
    fs.copyFileSync(path.join(OUT_DIR, f), path.join(distLit, f));
  }
}

console.log(
  `Built ${NUM_PACKS} packed literary blobs + index (${Object.keys(indexEntries).length} chapters, ${totalVerses} verses, ${syntaxVerses} with MACULA clauses): index=${(indexRaw.length / 1024).toFixed(1)} KB, maxRecord=${(maxRecGz / 1024).toFixed(1)} KB gz, maxPack=${(maxPackBytes / 1024).toFixed(1)} KB, total=${(totalPackBytes / 1024 / 1024).toFixed(2)} MB`
);
