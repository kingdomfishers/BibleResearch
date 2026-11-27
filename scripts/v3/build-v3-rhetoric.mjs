/**
 * Stage S2: Lossless Sequential Clause Compiler & Rhetoric Pack Builder (`v3/rhetoric/`)
 *
 * Consumes ONLY CC BY 4.0 / CC0 / MIT / PD sources:
 *   - .artifacts-r12/staging-bundle/v2/relationships/r11-v1.0/r10/fast-verses/ (31,203 verses)
 *   - .artifacts-r12/staging-bundle/v2/relationships/r11-v1.0/r10/fast-profiles/ (lexical profiles)
 *   - .artifacts-r12/v3-build/sense-ontology.json (gated senses, C_XL concepts, valence)
 *   - .artifacts-r12/v3-build/sanitized-lexicon.json (sanitized STEP lexicon + segregated proper names)
 *   - .artifacts/v2/literary/ (optional pre-sanitized MACULA clause role frames, zero restricted UBS keys)
 *
 * Outputs identical packs to:
 *   - .artifacts-r12/v3-build/rhetoric/
 *   - .artifacts-r12/staging-bundle/v3/rhetoric/
 *
 * Strict invariants:
 *   - 100% verse & 100% token coverage (lossless sequential non-overlapping clause partition)
 *   - <= 64 files, each < 10 MiB
 *   - ZERO restricted UBS keys
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  BUILTIN_ONOMASTIC_LEXICON,
  canonicalStrongsKey,
  detectOnomasticValenceWordplays,
  detectSyntacticTalionAndPolyptoton,
  scoreGlossValence,
} from '../../src/relationships/wordplay-engine.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_FAST_VERSES = fs.existsSync(path.join(ROOT, '.artifacts-r12/staging-bundle/v2/fast-verses'))
  ? path.join(ROOT, '.artifacts-r12/staging-bundle/v2/fast-verses')
  : path.join(ROOT, '.artifacts-r12/staging-bundle/v2/relationships/r11-v1.0/r10/fast-verses');
const DEFAULT_FAST_PROFILES = fs.existsSync(path.join(ROOT, '.artifacts-r12/staging-bundle/v2/fast-profiles'))
  ? path.join(ROOT, '.artifacts-r12/staging-bundle/v2/fast-profiles')
  : path.join(ROOT, '.artifacts-r12/staging-bundle/v2/relationships/r11-v1.0/r10/fast-profiles');
const DEFAULT_ONTOLOGY_PATH = path.join(ROOT, '.artifacts-r12/v3-build/sense-ontology.json');
const DEFAULT_LEXICON_PATH = path.join(ROOT, '.artifacts-r12/v3-build/sanitized-lexicon.json');
const DEFAULT_LITERARY_DIR = path.join(ROOT, '.artifacts/v2/literary');
const OUT_BUILD_DIR = path.join(ROOT, '.artifacts-r12/v3-build/rhetoric');
const OUT_STAGING_DIR = path.join(ROOT, '.artifacts-r12/staging-bundle/v3/rhetoric');

const NUM_CLAUSE_SHARDS = 32;
const MAX_SHARD_BYTES = 10 * 1024 * 1024;

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

const NEGATION_STRONGS = new Set([
  'H3808', 'H408', 'H369', 'H1097', 'H1115', 'H657',
  'G3756', 'G3361', 'G3761', 'G3762', 'G3763', 'G3764', 'G3765', 'G3364', 'G3367',
]);

const FUNCTION_POS = new Set([
  'conjunction', 'preposition', 'article', 'particle', 'pronoun', 'om',
]);

const LIGHT_POLYSEMOUS_VERBS = new Set([
  'H5375', 'H5414', 'H6213', 'H7760', 'H7200', 'H4672', 'H3772', 'H3045',
  'H1980', 'H935', 'H3318', 'H5927', 'H7971', 'H3947',
  'G4160', 'G1325', 'G2192', 'G2983', 'G1096', 'G305', 'G906',
]);

function checkNoRestrictedKeys(val, p = '') {
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) checkNoRestrictedKeys(val[i], `${p}[${i}]`);
  } else if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      if (RESTRICTED_KEYS.has(k)) {
        throw new Error(`Restricted UBS key "${k}" detected at ${p}.${k}`);
      }
      if (v && typeof v === 'object') checkNoRestrictedKeys(v, `${p}.${k}`);
    }
  }
}

function loadLiteraryChapters(literaryDir) {
  const byVid = new Map();
  if (!fs.existsSync(path.join(literaryDir, 'index.json'))) return byVid;
  const idx = JSON.parse(fs.readFileSync(path.join(literaryDir, 'index.json'), 'utf8'));
  const packCache = new Map();
  for (const [, [packFile, start, length]] of Object.entries(idx.entries || {})) {
    let packBuf = packCache.get(packFile);
    if (!packBuf) {
      packBuf = fs.readFileSync(path.join(literaryDir, packFile));
      packCache.set(packFile, packBuf);
    }
    const ch = JSON.parse(zlib.gunzipSync(packBuf.subarray(start, start + length)).toString('utf8'));
    for (const v of Object.values(ch.verses || {})) {
      byVid.set(Number(v.verse_id), v);
    }
  }
  return byVid;
}

function loadFastProfiles(profilesDir) {
  const profiles = new Map();
  const files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json.gz')).sort();
  for (const f of files) {
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(profilesDir, f))).toString('utf8'));
    for (const [key, b64] of Object.entries(data.profiles || {})) {
      const p = JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
      const bs = canonicalStrongsKey(p.bs || key);
      if (bs) profiles.set(bs, p);
    }
  }
  return profiles;
}

function padStrongsBase(raw) {
  if (!raw) return '';
  const m = /^([HGhg])0*(\d+)(?:[A-Za-z].*)?$/.exec(String(raw).trim());
  return m ? m[1].toUpperCase() + m[2].padStart(4, '0') : '';
}

function stripConsonantsForAlign(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[^\u05D0-\u05EA\u0391-\u03C9]/g, '')
    .replace(/ς/g, 'σ')
    .toLowerCase();
}

function reconcileVersesWithWordsImmutable(verses) {
  const tablesDir = path.join(ROOT, '.artifacts/static-corpus/tables');
  const versesFile = path.join(tablesDir, 'verses_immutable/part-0000.jsonl.gz');
  const wordsDir = path.join(tablesDir, 'words_immutable');
  if (!fs.existsSync(versesFile) || !fs.existsSync(wordsDir)) return 0;

  const shiftedVerses = verses.filter(v => Array.isArray(v.toks) && v.toks.some((t, i) => Number(t.wn) !== i + 1));
  if (shiftedVerses.length === 0) return 0;

  const shiftedVidSet = new Set(shiftedVerses.map(v => v.vid));
  const widNeeded = new Set();
  const immVids = new Map();
  for (const line of zlib.gunzipSync(fs.readFileSync(versesFile)).toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (shiftedVidSet.has(row.id)) {
      immVids.set(row.id, row.word_ids || []);
      for (const wid of row.word_ids || []) widNeeded.add(wid);
    }
  }
  const wordById = new Map();
  for (const f of fs.readdirSync(wordsDir).filter(x => x.endsWith('.jsonl.gz')).sort()) {
    for (const line of zlib.gunzipSync(fs.readFileSync(path.join(wordsDir, f))).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      const w = JSON.parse(line);
      if (widNeeded.has(w.id)) wordById.set(w.id, w);
    }
  }

  let fixedTokens = 0;
  for (const v of shiftedVerses) {
    const immWords = (immVids.get(v.vid) || []).map(wid => wordById.get(wid)).filter(Boolean);
    const toks = v.toks || [];
    if (toks.length === immWords.length && toks.length > 0) {
      for (let i = 0; i < toks.length; i++) {
        const w = immWords[i];
        const bs = padStrongsBase(w.strongs_nr);
        toks[i].wn = i + 1;
        toks[i].wid = w.id;
        if (bs) {
          toks[i].s = bs;
          toks[i].all_s = [bs];
        }
        if (w.lexeme_key) toks[i].lk = `lemma:${w.lexeme_key}`;
        fixedTokens++;
      }
    } else if (immWords.length > 0 && toks.length > 0) {
      // Monotone consonantal surface match for differing token counts
      let j = 0;
      for (let i = 0; i < toks.length; i++) {
        const cTok = stripConsonantsForAlign(toks[i].sf);
        toks[i].wn = i + 1;
        for (let k = j; k < Math.min(immWords.length, j + 4); k++) {
          const cImm = stripConsonantsForAlign(immWords[k].original_word);
          if (cTok && cImm && (cTok === cImm || cImm.includes(cTok) || cTok.includes(cImm))) {
            const w = immWords[k];
            const bs = padStrongsBase(w.strongs_nr);
            toks[i].wid = w.id;
            if (bs) {
              toks[i].s = bs;
              toks[i].all_s = [bs];
            }
            if (w.lexeme_key) toks[i].lk = `lemma:${w.lexeme_key}`;
            j = k + 1;
            fixedTokens++;
            break;
          }
        }
      }
    }
  }
  return fixedTokens;
}

function loadAllFastVerses(versesDir) {
  const verses = [];
  const files = fs.readdirSync(versesDir).filter(f => f.endsWith('.json.gz')).sort();
  for (const f of files) {
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(versesDir, f))).toString('utf8'));
    for (const [vidStr, b64] of Object.entries(data.verses || {})) {
      const vid = Number(vidStr);
      const v = JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
      verses.push({ vid, ...v });
    }
  }
  verses.sort((a, b) => a.vid - b.vid);
  const fixedTokens = reconcileVersesWithWordsImmutable(verses);
  if (fixedTokens > 0) {
    console.log(`Reconciled ${fixedTokens} shifted tokens against words_immutable.`);
  }
  return verses;
}

/**
 * Normalize MACULA clause spans (or synthesize verb-delimited spans) into a 100%-cover,
 * non-overlapping, sequential partition over token array indices [0 .. nToks - 1].
 */
function buildLosslessClausePartition(nToks, enrichedToks, maculaClauses, litPosToTokenIdx) {
  if (nToks === 0) return [];
  const spans = [];

  if (Array.isArray(maculaClauses) && maculaClauses.length > 0) {
    const mapped = [];
    for (const mc of maculaClauses) {
      if (!Number.isFinite(mc.startPos) || !Number.isFinite(mc.endPos) || mc.endPos < mc.startPos) continue;
      const startIdx = litPosToTokenIdx.get(mc.startPos) ?? Math.max(0, Math.min(nToks - 1, mc.startPos - 1));
      const endIdx = litPosToTokenIdx.get(mc.endPos) ?? Math.max(0, Math.min(nToks - 1, mc.endPos - 1));
      if (endIdx >= startIdx) {
        mapped.push({ startIdx, endIdx, macula: mc });
      }
    }
    mapped.sort((a, b) => a.startIdx - b.startIdx || a.endIdx - b.endIdx);

    let cursor = 0; // 0-based token array index
    for (const mc of mapped) {
      if (cursor >= nToks) break;
      if (mc.endIdx < cursor) continue;
      if (mc.startIdx > cursor) {
        const gapEnd = Math.min(nToks - 1, mc.startIdx - 1);
        spans.push({ startIdx: cursor, endIdx: gapEnd, macula: null });
        cursor = gapEnd + 1;
      }
      if (cursor >= nToks) break;
      const effStart = Math.max(cursor, mc.startIdx);
      const effEnd = Math.min(nToks - 1, mc.endIdx);
      if (effStart <= effEnd) {
        spans.push({ startIdx: effStart, endIdx: effEnd, macula: mc.macula });
        cursor = effEnd + 1;
      }
    }
    if (cursor < nToks) {
      spans.push({ startIdx: cursor, endIdx: nToks - 1, macula: null });
    }
  } else {
    // Fallback morphological clause boundary split on finite verbs (never drops any token)
    let startIdx = 0;
    let seenVerb = false;
    for (let i = 0; i < nToks; i++) {
      const t = enrichedToks[i];
      const isVerb = t.cl === 'verb' || /^(?:H?V|V-)/.test(t.gc || '');
      if (isVerb && seenVerb && i - startIdx >= 2) {
        spans.push({ startIdx, endIdx: i - 1, macula: null });
        startIdx = i;
      }
      if (isVerb) seenVerb = true;
    }
    if (startIdx < nToks) {
      spans.push({ startIdx, endIdx: nToks - 1, macula: null });
    }
  }

  return spans;
}

function buildOnomasticLexicon(profiles, lexicon, ontology) {
  const out = {};
  for (const [k, entry] of Object.entries(BUILTIN_ONOMASTIC_LEXICON)) {
    out[k] = { ...entry };
  }

  const bsSenseValence = new Map();
  for (const s of Object.values(ontology.mapped_senses || {})) {
    const cs = canonicalStrongsKey(s.bs);
    if (s.valence !== 0 && !bsSenseValence.has(cs)) {
      bsSenseValence.set(cs, s.valence);
    }
  }

  for (const [key, seg] of Object.entries(lexicon.segregated_proper || {})) {
    const bs = canonicalStrongsKey(seg.base_strongs || key.replace(/#prop$/, ''));
    if (!bs || out[bs]) continue;
    const prof = profiles.get(bs);
    const gl = prof?.gl || seg.variants?.[0]?.gl || '';
    const v = bsSenseValence.get(bs) ?? scoreGlossValence(gl);
    const roots = (prof?.r13_wordplay || [])
      .filter(e => e.evidence_type === 'documented_root_family' || e.proven_common_root)
      .map(e => canonicalStrongsKey(e.target_bs))
      .filter(Boolean);
    if (roots.length > 0 || v !== 0) {
      out[bs] = {
        strongs: bs,
        rootStrongs: [...new Set(roots)].slice(0, 6),
        rootConsonants: '',
        etyGlosses: gl ? [gl] : [],
        synonyms: [],
        antonyms: [],
        valence: v,
        source: `STEP:${bs}`,
      };
    }
  }
  return out;
}

function writeAndCopy(relPath, buf, manifestFiles) {
  if (buf.length > MAX_SHARD_BYTES) {
    throw new Error(`File ${relPath} exceeds 10 MiB cap (${buf.length} bytes)`);
  }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  for (const dir of [OUT_BUILD_DIR, OUT_STAGING_DIR]) {
    const dest = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  manifestFiles.push({
    path: `v3/rhetoric/${relPath}`,
    bytes: buf.length,
    sha256,
  });
}

async function main() {
  const t0 = performance.now();
  console.log('Loading S1 artifacts & v2 fast assets...');
  const ontology = JSON.parse(fs.readFileSync(DEFAULT_ONTOLOGY_PATH, 'utf8'));
  const lexicon = JSON.parse(fs.readFileSync(DEFAULT_LEXICON_PATH, 'utf8'));
  const profiles = loadFastProfiles(DEFAULT_FAST_PROFILES);
  const verses = loadAllFastVerses(DEFAULT_FAST_VERSES);
  const literaryByVid = loadLiteraryChapters(DEFAULT_LITERARY_DIR);
  console.log(`Loaded ${verses.length} verses, ${profiles.size} profiles, ${literaryByVid.size} literary chapters in ${Math.round(performance.now() - t0)}ms.`);

  // Build lookup maps from ontology & lexicon
  const senseByBs = new Map();
  for (const s of Object.values(ontology.mapped_senses || {})) {
    const bs = canonicalStrongsKey(s.bs);
    if (!senseByBs.has(bs)) senseByBs.set(bs, s);
  }
  const senseToConcept = ontology.sense_to_concept || {};
  const mappedSenses = ontology.mapped_senses || {};
  const gatedEdges = ontology.gated_verse_edges || {};

  const onomasticLexicon = buildOnomasticLexicon(profiles, lexicon, ontology);
  const customValenceMap = new Map();
  for (const s of Object.values(mappedSenses)) {
    const cs = canonicalStrongsKey(s.bs);
    if (s.valence !== 0 && !customValenceMap.has(cs)) customValenceMap.set(cs, s.valence);
  }

  for (const dir of [OUT_BUILD_DIR, OUT_STAGING_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const old of fs.readdirSync(dir)) {
      fs.unlinkSync(path.join(dir, old));
    }
  }

  const shardBuckets = Array.from({ length: NUM_CLAUSE_SHARDS }, () => []);
  const shardSize = Math.ceil(verses.length / NUM_CLAUSE_SHARDS);

  let totalTokens = 0;
  let coveredTokens = 0;
  let totalClauses = 0;
  let maculaClauseVerses = 0;
  let negatedClauses = 0;
  let mappedConceptTokens = 0;
  let idiomSlotsCount = 0;

  const talionIndex = [];
  const onomasticIndex = [];

  // Process verses grouped by book for +-10 verse onomastic window
  const versesByBook = new Map();
  for (const v of verses) {
    const arr = versesByBook.get(v.book) ?? [];
    arr.push(v);
    versesByBook.set(v.book, arr);
  }

  let globalVerseIdx = 0;
  for (const [book, bookVerses] of versesByBook) {
    const bookWordplayTokens = [];

    for (const v of bookVerses) {
      const vid = v.vid;
      const lit = literaryByVid.get(vid);
      const litTokByWid = new Map();
      const litTokByPos = new Map();
      for (const lt of lit?.tokens || []) {
        if (lt.word_id) litTokByWid.set(Number(lt.word_id), lt);
        litTokByPos.set(Number(lt.word_position), lt);
      }

      const rawToks = Array.isArray(v.toks) ? v.toks : [];
      totalTokens += rawToks.length;

      const litPosToTokenIdx = new Map();
      const enrichedToks = rawToks.map((t, idx) => {
        const wn = Number(t.wn ?? idx + 1);
        const wid = Number(t.wid ?? 0);
        const lt = (wid ? litTokByWid.get(wid) : undefined) ?? litTokByPos.get(wn);
        if (lt?.word_position != null) {
          litPosToTokenIdx.set(Number(lt.word_position), idx);
        }
        const bs = canonicalStrongsKey(t.s || lt?.base_strongs || '');
        const gated = wid ? gatedEdges[`${vid}:${wid}`] : undefined;
        const senseObj = gated ? mappedSenses[gated.sense_id] : senseByBs.get(bs);
        const senseId = gated?.sense_id ?? senseObj?.sense_id ?? (bs ? `sense:${bs}:primary` : null);
        const conceptId = senseId ? (senseToConcept[senseId] ?? null) : null;
        if (conceptId) mappedConceptTokens++;
        const valence = senseObj?.valence ?? scoreGlossValence(t.g || lt?.gloss || '');
        const cl = String(t.cl || lt?.pos_class || '');
        const gc = String(lt?.word_grammar_code || '');
        const isNeg = NEGATION_STRONGS.has(bs);
        const isFunc =
          FUNCTION_POS.has(cl.toLowerCase()) ||
          /^H90\d{2}$/.test(bs) ||
          /^(?:CONJ|PREP|T-|P-|R-|C-)/.test(gc);

        const rec = {
          idx,
          wn,
          wid,
          sf: String(t.sf ?? lt?.surface_form ?? ''),
          lm: String(t.lm ?? lt?.lemma_script ?? ''),
          s: bs,
          lk: String(t.lk ?? lt?.lemma_key ?? (bs ? `lemma:${bs}` : '')),
          g: String(t.g ?? lt?.gloss ?? ''),
          cl,
          ...(gc ? { gc } : {}),
          ...(lt?.person ? { person: lt.person } : {}),
          ...(lt?.mood ? { mood: lt.mood } : {}),
          ...(lt?.stem ? { stem: lt.stem } : {}),
          ...(senseId ? { sense_id: senseId } : {}),
          ...(conceptId ? { concept_id: conceptId } : {}),
          ...(valence !== 0 ? { valence } : {}),
          ...(isNeg ? { is_neg: true } : {}),
          is_func: isFunc,
        };

        bookWordplayTokens.push({
          id: `${book <= 39 ? 'hbo' : 'grc_nt'}:${vid}:${wn}`,
          verseId: vid,
          book,
          ref: v.ref,
          index: bookWordplayTokens.length,
          surfaceForm: rec.sf,
          gloss: rec.g,
          strongs: bs,
          lemmaKey: rec.lk,
          lemmaScript: rec.lm,
          grammarCode: gc,
          posClass: cl,
          stem: lt?.stem ?? null,
          isFunctionWord: isFunc,
        });

        return rec;
      });

      const maculaClauses = Array.isArray(lit?.literary_clauses) ? lit.literary_clauses : null;
      if (maculaClauses && maculaClauses.length > 0) maculaClauseVerses++;

      const spans = buildLosslessClausePartition(enrichedToks.length, enrichedToks, maculaClauses, litPosToTokenIdx);
      const clauses = [];
      let verseCovered = 0;

      for (let ci = 0; ci < spans.length; ci++) {
        const sp = spans[ci];
        const cToks = enrichedToks.slice(sp.startIdx, sp.endIdx + 1);
        if (!cToks.length) continue;
        verseCovered += cToks.length;

        const mc = sp.macula;
        const predTok =
          (mc?.predicateStrongs
            ? cToks.find(t => canonicalStrongsKey(t.s) === canonicalStrongsKey(mc.predicateStrongs))
            : null) ??
          cToks.find(t => t.cl === 'verb' || /^(?:H?V|V-)/.test(t.gc || '')) ??
          cToks.find(t => !t.is_func) ??
          cToks[0];

        const negMarkers = cToks.filter(t => t.is_neg).map(t => ({ wn: t.wn, s: t.s, sf: t.sf }));
        const polarity = negMarkers.length > 0 ? 'negative' : 'positive';
        if (polarity === 'negative') negatedClauses++;

        let valSum = 0;
        for (const t of cToks) {
          if (t.valence) valSum += t.valence;
        }
        const clauseValence = valSum > 0 ? 1 : valSum < 0 ? -1 : 0;

        const objLemmas = mc?.objectLemmas ?? [];
        const govObjTok =
          cToks.find(t => objLemmas.includes(t.lk) && !t.is_func && t.s) ??
          cToks.find(t => t !== predTok && !t.is_func && t.s && (t.cl === 'noun' || /^H?Nc|^N-/.test(t.gc || '')));
        const predS = predTok?.s || '';
        const govS = govObjTok?.s || '';
        const isIdiom = Boolean(predS && govS && LIGHT_POLYSEMOUS_VERBS.has(predS));
        const idiomKey = isIdiom ? `idiom:${predS}+${govS}` : undefined;
        if (isIdiom) idiomSlotsCount++;

        const clauseSenseIds = [...new Set(cToks.map(t => t.sense_id).filter(Boolean))];
        const clauseConceptIds = [...new Set(cToks.map(t => t.concept_id).filter(Boolean))];

        clauses.push({
          clause_id: `cl:${vid}:${ci}`,
          start_wn: cToks[0].wn,
          end_wn: cToks[cToks.length - 1].wn,
          token_indices: cToks.map(t => t.idx),
          clause_type: mc?.clauseType ?? 'narrative',
          is_direct_speech: Boolean(mc?.isDirectSpeech),
          has_macula_frame: Boolean(mc),
          predicate: {
            s: predS,
            lk: predTok?.lk || '',
            sf: predTok?.sf || '',
            ...(predTok?.stem ? { stem: predTok.stem } : {}),
            ...(predTok?.person ? { person: predTok.person } : {}),
            ...(predTok?.mood ? { mood: predTok.mood } : {}),
            ...(predTok?.sense_id ? { sense_id: predTok.sense_id } : {}),
            ...(predTok?.concept_id ? { concept_id: predTok.concept_id } : {}),
          },
          slot_atom: {
            sense_id: idiomKey ?? predTok?.sense_id ?? predS,
            verb_stem: predTok?.stem || predTok?.mood || 'base',
            gov_obj: govS || (mc?.clauseType ?? 'narrative'),
            ...(idiomKey ? { idiom_key: idiomKey } : {}),
            is_idiom: isIdiom,
            valence: clauseValence,
          },
          subjects: mc?.subjectLemmas ?? [],
          objects: objLemmas,
          modifier_pairs: mc?.modifierPairs ?? [],
          polarity,
          neg_markers: negMarkers,
          valence: clauseValence,
          sense_ids: clauseSenseIds,
          concept_ids: clauseConceptIds,
        });
      }

      if (verseCovered !== rawToks.length) {
        throw new Error(`Lossy clause partition at vid=${vid}: covered ${verseCovered} !== ${rawToks.length}`);
      }
      coveredTokens += verseCovered;
      totalClauses += clauses.length;

      // Also detect syntactic talion / polyptoton within verse
      const verseWpToks = bookWordplayTokens.slice(bookWordplayTokens.length - rawToks.length);
      const verseClausesInput = clauses.map((c, idx) => ({
        startIndex: (bookWordplayTokens.length - rawToks.length) + c.token_indices[0],
        endIndex: (bookWordplayTokens.length - rawToks.length) + c.token_indices[c.token_indices.length - 1],
        subjectLemmas: c.subjects,
        objectLemmas: c.objects,
      }));
      const talionHits = detectSyntacticTalionAndPolyptoton(verseWpToks, verseClausesInput);
      for (const th of talionHits) {
        talionIndex.push({
          vid,
          ref: v.ref,
          kind: th.kind,
          strongsA: canonicalStrongsKey(th.tokenA.strongs),
          strongsB: canonicalStrongsKey(th.tokenB.strongs),
          formA: th.tokenA.surfaceForm,
          formB: th.tokenB.surfaceForm,
          shift: th.shiftSummary,
          cues: th.cues,
          score: th.score,
        });
      }

      const shardIdx = Math.min(NUM_CLAUSE_SHARDS - 1, Math.floor(globalVerseIdx / shardSize));
      shardBuckets[shardIdx].push({
        vid,
        book: v.book,
        chapter: v.chapter,
        verse: v.verse,
        ref: v.ref,
        tokens: enrichedToks,
        clauses,
      });
      globalVerseIdx++;
    }

    // Book-wide +-10 verse onomastic & evaluative valence plays
    const onomHits = detectOnomasticValenceWordplays(bookWordplayTokens, onomasticLexicon, customValenceMap);
    for (const oh of onomHits) {
      onomasticIndex.push({
        book,
        proper_ref: oh.properToken.ref,
        target_ref: oh.targetToken.ref,
        proper_strongs: canonicalStrongsKey(oh.properToken.strongs),
        target_strongs: canonicalStrongsKey(oh.targetToken.strongs),
        proper_form: oh.properToken.surfaceForm,
        target_form: oh.targetToken.surfaceForm,
        channel: oh.matchChannel,
        cues: oh.cues,
        score: oh.score,
      });
    }
  }

  console.log(`Processed all ${verses.length} verses in ${Math.round(performance.now() - t0)}ms; writing 32 rhetoric shards...`);
  const manifestFiles = [];

  for (let i = 0; i < NUM_CLAUSE_SHARDS; i++) {
    const payload = {
      schema_version: 'v3-rhetoric-clauses-1',
      shard: i,
      verse_count: shardBuckets[i].length,
      verses: shardBuckets[i],
    };
    checkNoRestrictedKeys(payload, `clauses-${i}`);
    const gz = zlib.gzipSync(JSON.stringify(payload), { level: 6 });
    writeAndCopy(`clauses-${String(i).padStart(2, '0')}.json.gz`, gz, manifestFiles);
  }

  checkNoRestrictedKeys(onomasticLexicon, 'onomastic-lexicon');
  writeAndCopy(
    'onomastic-lexicon.json',
    Buffer.from(JSON.stringify({ schema_version: 'v3-onomastic-1', entries: onomasticLexicon })),
    manifestFiles
  );

  const rhetoricIdxPayload = {
    schema_version: 'v3-rhetoric-index-1',
    talion_count: talionIndex.length,
    onomastic_count: onomasticIndex.length,
    syntactic_talion_hits: talionIndex,
    onomastic_valence_hits: onomasticIndex,
  };
  checkNoRestrictedKeys(rhetoricIdxPayload, 'rhetoric-index');
  writeAndCopy(
    'rhetoric-index.json.gz',
    zlib.gzipSync(JSON.stringify(rhetoricIdxPayload), { level: 6 }),
    manifestFiles
  );

  const manifest = {
    schema_version: 'v3-rhetoric-manifest-1',
    generated_at: new Date().toISOString(),
    license: 'CC BY 4.0 (STEPBible-Data, MACULA, OSHB, OEWN 2025) + CC0 1.0 (Wikidata) + MIT',
    restricted_ubs_keys_present: false,
    stats: {
      total_verses: verses.length,
      covered_verses: globalVerseIdx,
      verse_coverage_ratio: verses.length > 0 ? globalVerseIdx / verses.length : 0,
      total_tokens: totalTokens,
      covered_tokens: coveredTokens,
      token_coverage_ratio: totalTokens > 0 ? coveredTokens / totalTokens : 0,
      total_clauses: totalClauses,
      macula_clause_verses: maculaClauseVerses,
      negated_clauses: negatedClauses,
      mapped_concept_tokens: mappedConceptTokens,
      idiom_slots_disambiguated: idiomSlotsCount,
      syntactic_talion_hits: talionIndex.length,
      onomastic_valence_hits: onomasticIndex.length,
    },
    file_count: manifestFiles.length + 1,
    files: manifestFiles,
  };
  checkNoRestrictedKeys(manifest, 'manifest');
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2));
  for (const dir of [OUT_BUILD_DIR, OUT_STAGING_DIR]) {
    fs.writeFileSync(path.join(dir, 'manifest.json'), manifestBuf);
  }

  const elapsedMs = Math.round(performance.now() - t0);
  console.log(
    `Built v3/rhetoric/ in ${elapsedMs}ms: ${manifest.file_count} files, ` +
    `${globalVerseIdx}/${verses.length} verses (100%), ${coveredTokens}/${totalTokens} tokens (100%), ` +
    `${totalClauses} clauses (${maculaClauseVerses} MACULA-framed, ${negatedClauses} negated, ` +
    `${mappedConceptTokens} concept-mapped tokens, ${idiomSlotsCount} idiom slots, ` +
    `${talionIndex.length} talion hits, ${onomasticIndex.length} onomastic hits).`
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
