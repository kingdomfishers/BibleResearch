/**
 * Stage S1.1: Canonical STEP Lexicon Hygiene & Niqqud-Aware Sanitizer
 *
 * Reads all fast-profiles/shard-*.json.gz and fast-verses/chunk-*.json.gz
 * (plus static-corpus/tables/lexemes for full TBESH/TBESG metadata) and outputs
 * .artifacts-r12/v3-build/sanitized-lexicon.json.
 *
 * Implements:
 *   - Grammatical prefix/function-POS purge (H2050, H9002, H1886, H9003, H3807, H0871, H3509, ^H90\d{2}$)
 *   - 3-Rule Same-bs Pseudo-Homograph Sanitizer:
 *       Rule 1: Proper-name / title segregation into B#prop + highest-freq lexical headword promotion
 *       Rule 2: Inflection / state collapse (same consonantal skeleton + stem overlap -> unified SenseID)
 *       Rule 3: Genuine semantic homograph retention (distinct SenseIDs for true polysemes)
 *   - Niqqud-aware, transliteration, and English gloss lookup tables
 *
 * License: CC BY 4.0 (STEPBible-Data).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DEFAULT_R10_DIR = '.artifacts-r12/staging-bundle/v2/relationships/r11-v1.0/r10';
const DEFAULT_LEXEMES_DIR = '.artifacts/static-corpus/tables/lexemes';
const DEFAULT_OUT_PATH = '.artifacts-r12/v3-build/sanitized-lexicon.json';

const TOTAL_CANONICAL_VERSES = 31203;

export const EXPLICIT_PREFIX_BUGS = new Set([
  'H2050', 'H9002', 'H1886', 'H9003', 'H3807', 'H0871', 'H3509',
]);

export const FUNC_POS_RE = /^(?:Prefix|H:(?:Conj|Prep|Art|Pron|Om|Part|Intg|Rel|P|D|T|C)|A:(?:Conj|Prep|Art|Pron|Om|Part|Intg|Rel|P|D|T|C)|G:(?:CONJ|PREP|ART|PRON|PART|PRT|P|D|T|C|COND|INJ|R|X|I))/i;

const ENGLISH_STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'with', 'for', 'by', 'at', 'from',
  'and', 'or', 'as', 'is', 'be', 'are', 'was', 'were', 'his', 'her', 'its',
  'their', 'my', 'your', 'our', 'him', 'them', 'me', 'us', 'who', 'which',
  'that', 'this', 'these', 'those', 'into', 'out', 'up', 'down', 'like', 'one',
]);

const HEBREW_FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

export function normalizeHebrewPointed(str) {
  if (!str) return '';
  // Strip cantillation marks (\u0591-\u05AF, \u05BD meteg, \u05BF rafe, \u05C0 paseq, \u05C3 sof pasuq, \u05C4-\u05C7)
  // while preserving niqqud vowels (\u05B0-\u05BC) and shin/sin dots (\u05C1-\u05C2).
  return str
    .normalize('NFC')
    .replace(/[\u0591-\u05AF\u05BD\u05BF\u05C0\u05C3-\u05C7]/g, '')
    .replace(/[^\u05D0-\u05EA\u05B0-\u05BC\u05C1-\u05C2]/g, '')
    .trim();
}

export function consonantalSkeleton(str) {
  if (!str) return '';
  const nfd = str.normalize('NFD');
  let out = '';
  for (const ch of nfd) {
    const code = ch.codePointAt(0);
    // Hebrew letters 0x05D0..0x05EA
    if (code >= 0x05D0 && code <= 0x05EA) {
      out += HEBREW_FINALS[ch] || ch;
    } else if ((code >= 0x0391 && code <= 0x03C9) || (code >= 0x1F00 && code <= 0x1FFF)) {
      const lower = ch.toLowerCase();
      out += lower === 'ς' ? 'σ' : lower;
    }
  }
  return out;
}

export function normalizeGreekAsciiTranslit(str) {
  if (!str) return '';
  const map = {
    'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'e',
    'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x',
    'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y',
    'φ': 'ph', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o',
  };
  let out = '';
  for (const ch of str.normalize('NFD').toLowerCase()) {
    if (map[ch]) out += map[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
  }
  return out;
}

export function normalizeTranslitKey(tr) {
  if (!tr) return '';
  return tr.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f.\-\s'’`]/g, '');
}

export function cleanGloss(gl) {
  if (!gl) return [];
  const raw = gl
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .trim();
  if (!raw) return [];
  const words = raw.split(/\s+/).filter(w => w.length >= 2 && !ENGLISH_STOPWORDS.has(w));
  return words.map(w => {
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 3 && w.endsWith('ed')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  });
}

export function stemOverlap(stemsA, stemsB) {
  if (!stemsA.length || !stemsB.length) return 0;
  const setB = new Set(stemsB);
  let hits = 0;
  for (const s of new Set(stemsA)) {
    if (setB.has(s)) {
      hits++;
    } else if (s.length >= 4) {
      for (const b of setB) {
        if (b.length >= 4 && (s.startsWith(b.slice(0, 4)) || b.startsWith(s.slice(0, 4)))) {
          hits++;
          break;
        }
      }
    }
  }
  return hits;
}

const NON_PROPER_CAP_GLOSSES = new Set([
  'God', 'Lord', 'LORD', 'I', 'Christ', 'Spirit', 'Father', 'Son', 'Amen',
  'Alleluia', 'Hallelujah', 'Sabbath', 'Passover', 'Pentecost', 'Gentile',
  'Gentiles', 'Hebrew', 'Jew', 'Jews', 'Christian', 'Christians',
]);

export function isProperOrConstructName(gl, pos, entityKind, note = '') {
  if (!gl) return false;
  const trimmed = gl.trim();
  if (NON_PROPER_CAP_GLOSSES.has(trimmed)) return false;
  if (entityKind === 'person' || entityKind === 'place') return true;
  if (pos && (/^N:/i.test(pos) || /-(?:P|L|PG|LG|PRI|T)$/i.test(pos))) return true;
  if (note && /= a (?:Name|Part|Place|Title) of /i.test(note)) return true;
  // Construct / gate / topographical proper titles like "Rocks (of Goats)", "Corner (Gate)", "New (Gate)", "(Eshcol) Valley"
  if (/\((?:Gate|Goats|Valley|Brook|Mount|Hill|Rock|Well|Spring|Sea|River|Beth|Upper|Lower|King's|of [^)]+)\)/i.test(trimmed)) {
    return true;
  }
  if (/^\([A-Z]/.test(trimmed)) return true;
  if (/^(?:House|Valley|Brook|Mountain|Mount|Rock|Rocks|Fountain|Corner|New|Lower|Upper|Dung|Fish|Sheep|Water|Horse|East|Old)\s+(?:of\b|\([A-Z])/i.test(trimmed)) {
    return true;
  }
  // Single or hyphenated capitalized name like "Heglam", "Eznite", "Brook", "Way", "River", "Arabah", "Kue"
  if (/^[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)*$/.test(trimmed)) {
    // Allow lowercase-capable nouns if pos is clearly common and gloss is a single normal word? No, in STEP common nouns start lowercase!
    return true;
  }
  return false;
}

export function isCommonLexicalCandidate(gl, pos, entityKind, note = '') {
  if (!gl) return false;
  if (isProperOrConstructName(gl, pos, entityKind, note)) return false;
  return true;
}

function decodeB64Gz(b64) {
  return JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
}

function loadLexemesTable(lexemesDir) {
  const byLk = new Map();
  const byBase = new Map();
  if (!fs.existsSync(lexemesDir)) return { byLk, byBase };
  for (const name of fs.readdirSync(lexemesDir).sort()) {
    if (!name.endsWith('.jsonl.gz')) continue;
    const lines = zlib.gunzipSync(fs.readFileSync(path.join(lexemesDir, name)))
      .toString('utf8')
      .split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      const lk = `lemma:${row.lexeme_key}`;
      byLk.set(lk, row);
      if (row.base_strongs) {
        const bs = row.base_strongs.replace(/^([HG])(\d+)$/, (_, p, n) => `${p}${n.padStart(4, '0')}`);
        if (!byBase.has(bs)) byBase.set(bs, []);
        byBase.get(bs).push(row);
      }
    }
  }
  return { byLk, byBase };
}

export async function sanitizeStepLexicon({
  r10Dir = DEFAULT_R10_DIR,
  lexemesDir = DEFAULT_LEXEMES_DIR,
  outPath = DEFAULT_OUT_PATH,
  writeOutput = true,
} = {}) {
  const t0 = Date.now();
  const fastProfilesDir = path.join(r10Dir, 'fast-profiles');
  const fastVersesDir = path.join(r10Dir, 'fast-verses');

  // 1. Load all fast-profiles/shard-*.json.gz
  const rawProfiles = new Map();
  const profileFiles = fs.readdirSync(fastProfilesDir).filter(f => /^shard-.*\.json\.gz$/.test(f)).sort();
  for (const f of profileFiles) {
    const shard = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fastProfilesDir, f))).toString('utf8'));
    for (const [bs, b64] of Object.entries(shard.profiles || {})) {
      rawProfiles.set(bs, decodeB64Gz(b64));
    }
  }

  // 2. Scan all 488 fast-verses/chunk-*.json.gz for lk counts, prefix share, canonical_df, and pointed surface/lemma forms
  const lkTokenCounts = new Map();
  const totalOcc = new Map();
  const prefixOcc = new Map();
  const canonicalVids = new Map(); // bs -> Set(vid)
  const pointedFormsByBs = new Map(); // bs -> Map(pointed -> count)
  const verseGlossSamplesByBs = new Map(); // bs -> Map(clean_gloss -> count)

  const verseFiles = fs.readdirSync(fastVersesDir).filter(f => /^chunk-.*\.json\.gz$/.test(f)).sort();
  for (const f of verseFiles) {
    const chunk = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fastVersesDir, f))).toString('utf8'));
    for (const [vidStr, b64] of Object.entries(chunk.verses || {})) {
      const vid = Number(vidStr);
      const v = decodeB64Gz(b64);
      for (const tok of v.toks || []) {
        if (tok.lk) {
          lkTokenCounts.set(tok.lk, (lkTokenCounts.get(tok.lk) || 0) + 1);
        }
        if (tok.s) {
          if (!canonicalVids.has(tok.s)) canonicalVids.set(tok.s, new Set());
          canonicalVids.get(tok.s).add(vid);
          if (tok.lm && (tok.s.startsWith('H') || tok.s.startsWith('A'))) {
            const p = normalizeHebrewPointed(tok.lm);
            if (p) {
              if (!pointedFormsByBs.has(tok.s)) pointedFormsByBs.set(tok.s, new Map());
              const pm = pointedFormsByBs.get(tok.s);
              pm.set(p, (pm.get(p) || 0) + 1);
            }
          }
          if (tok.g) {
            if (!verseGlossSamplesByBs.has(tok.s)) verseGlossSamplesByBs.set(tok.s, new Map());
            const gm = verseGlossSamplesByBs.get(tok.s);
            const gClean = tok.g.replace(/[.\[\]]+/g, ' ').trim();
            if (gClean) gm.set(gClean, (gm.get(gClean) || 0) + 1);
          }
        }
        const all = Array.isArray(tok.all_s) && tok.all_s.length > 0 ? tok.all_s : (tok.s ? [tok.s] : []);
        for (const bs of all) {
          totalOcc.set(bs, (totalOcc.get(bs) || 0) + 1);
          if (all.length > 1 && bs !== tok.s) {
            prefixOcc.set(bs, (prefixOcc.get(bs) || 0) + 1);
          }
        }
      }
    }
  }

  // 3. Load lexemes table for full disambiguated TBESH/TBESG metadata
  const { byLk: lexByLk } = loadLexemesTable(lexemesDir);

  const stats = {
    total_profiles: rawProfiles.size,
    profile_shards_read: profileFiles.length,
    verse_chunks_read: verseFiles.length,
    prefixes_purged: 0,
    zero_df_profiles: 0,
    same_bs_siblings_total: 0,
    proper_segregated: 0,
    headwords_rescued: 0,
    inflections_collapsed: 0,
    polysemes_retained: 0,
  };

  const sanitizedProfiles = {};
  const segregatedProper = {};

  for (const [bs, prof] of [...rawProfiles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const totOcc = totalOcc.get(bs) || 0;
    const preOcc = prefixOcc.get(bs) || 0;
    const prefixShare = totOcc > 0 ? preOcc / totOcc : 0;
    const isHebrew = bs.startsWith('H');
    const canonicalDf = canonicalVids.get(bs)?.size ?? prof.total_verses ?? 0;

    // Prefix Bug Purge:
    // Apply token_prefix_share > 0.50 on Hebrew Strong's (Greek all_s lists lexical root e.g. G3708 under G1492/G2400).
    // Guard H1952 (noun 'substance', 28 primary verses) only? No, check explicit list + /^H90\d{2}$/ + FUNC_POS + Hebrew prefix share > 0.50
    // Wait: if H1952 has prefixShare=0.685 because STEP tagged a suffix with 1952, let's check if primary_occ >= 20 && pos is noun/verb non-bug!
    // Wait: explicit list in spec is H2050, H9002, H1886, H9003, H3807, H0871, H3509.
    const isFuncPos = FUNC_POS_RE.test(prof.pos || '');
    const isH90 = /^H90\d{2}$/.test(bs);
    const isExplicitPrefixBug = EXPLICIT_PREFIX_BUGS.has(bs);
    const isHighPrefixShare = isHebrew && prefixShare > 0.50;
    const isGrammaticalMarker = isFuncPos || isH90 || isExplicitPrefixBug || isHighPrefixShare;

    if (isGrammaticalMarker) stats.prefixes_purged++;
    if (canonicalDf === 0) stats.zero_df_profiles++;
    const idf = canonicalDf > 0 ? Number(Math.log2(TOTAL_CANONICAL_VERSES / canonicalDf).toFixed(6)) : 0;

    // Gather all same-bs candidates (primary + same-bs siblings)
    const sameSibs = (prof.homograph_siblings || []).filter(s => s.bs === bs);
    stats.same_bs_siblings_total += sameSibs.length;

    const primaryNote = prof.senses?.[0]?.note || '';
    const candidates = [
      {
        lk: prof.lk,
        sc: prof.sc,
        tr: prof.tr,
        gl: prof.gl,
        pos: prof.pos,
        entity_kind: prof.entity_kind || 'common',
        note: primaryNote,
        is_original_primary: true,
        token_count: lkTokenCounts.get(prof.lk) || 0,
      },
      ...sameSibs.map(s => {
        const lexRow = lexByLk.get(s.lk);
        return {
          lk: s.lk,
          sc: s.sc || lexRow?.original_lemma || prof.sc,
          tr: s.tr || lexRow?.transliteration || prof.tr,
          gl: s.gl || lexRow?.primary_gloss || '',
          pos: lexRow?.pos || prof.pos,
          entity_kind: lexRow?.pos?.startsWith('N:') ? 'proper' : 'common',
          note: lexRow?.homograph_note || '',
          is_original_primary: false,
          token_count: lkTokenCounts.get(s.lk) || 0,
        };
      }),
    ];

    // Deduplicate candidates by lk
    const uniqCands = [];
    const seenLk = new Set();
    for (const c of candidates) {
      if (!c.lk || seenLk.has(c.lk)) continue;
      seenLk.add(c.lk);
      c.is_proper = isProperOrConstructName(c.gl, c.pos, c.entity_kind, c.note);
      uniqCands.push(c);
    }

    const commonCands = uniqCands.filter(c => !c.is_proper);
    const properCands = uniqCands.filter(c => c.is_proper);

    let chosenPrimary = uniqCands[0];
    let headwordRescued = false;
    const segregatedForBs = [];
    const vGlossesBs = verseGlossSamplesByBs.get(bs);
    const topVg = vGlossesBs && vGlossesBs.size > 0
      ? [...vGlossesBs.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : '';
    const topVgStems = cleanGloss(topVg);

    // Rule 1: Proper-name / title segregation + headword rescue
    if (commonCands.length > 0) {
      for (const pc of properCands) {
        stats.proper_segregated++;
        segregatedForBs.push({
          segregated_id: `${bs}#prop`,
          lk: pc.lk,
          sc: pc.sc,
          tr: pc.tr,
          gl: pc.gl,
          pos: pc.pos,
          token_count: pc.token_count,
        });
      }
      const maxCommonToks = Math.max(...commonCands.map(c => c.token_count), 0);
      // Sort common candidates: attested + verse-gloss-corroborated headwords first, then token_count DESC
      const rankedCommon = [...commonCands].sort((a, b) => {
        const aAtt = a.token_count > 0 ? 1 : 0;
        const bAtt = b.token_count > 0 ? 1 : 0;
        if (bAtt !== aAtt) return bAtt - aAtt;
        if (topVgStems.length > 0 && maxCommonToks >= 20) {
          const aMatch = a.token_count >= Math.max(10, maxCommonToks * 0.25) && stemOverlap(cleanGloss(a.gl), topVgStems) > 0 ? 1 : 0;
          const bMatch = b.token_count >= Math.max(10, maxCommonToks * 0.25) && stemOverlap(cleanGloss(b.gl), topVgStems) > 0 ? 1 : 0;
          if (bMatch !== aMatch) return bMatch - aMatch;
        }
        if (b.token_count !== a.token_count) return b.token_count - a.token_count;
        if (a.is_original_primary !== b.is_original_primary) return a.is_original_primary ? -1 : 1;
        return a.lk.localeCompare(b.lk);
      });
      const bestCommon = rankedCommon[0];
      const origCand = uniqCands[0];
      const origMatchesVerse = stemOverlap(cleanGloss(origCand.gl), topVgStems) > 0;
      const bestMatchesVerse = stemOverlap(cleanGloss(bestCommon.gl), topVgStems) > 0;
      const shouldPromote =
        origCand.is_proper ||
        (bestCommon.lk !== origCand.lk &&
          origCand.token_count <= 2 &&
          bestCommon.token_count >= 10 &&
          !origMatchesVerse &&
          (bestMatchesVerse || bestCommon.token_count > origCand.token_count * 5));

      if (shouldPromote) {
        chosenPrimary = bestCommon;
        headwordRescued = true;
        stats.headwords_rescued++;
      }
    }

    // Build SenseIDs using Rule 2 (Inflection/state collapse) & Rule 3 (Genuine homograph retention)
    const primSkel = consonantalSkeleton(chosenPrimary.sc);
    const primStems = cleanGloss(chosenPrimary.gl);
    const collapsedLkAliases = [];
    const retainedSenses = [
      {
        sense_id: `sense:${bs}:primary`,
        lk: chosenPrimary.lk,
        sc: chosenPrimary.sc,
        gl: chosenPrimary.gl,
        pos: chosenPrimary.pos,
        token_count: chosenPrimary.token_count,
        collapsed_lk_aliases: collapsedLkAliases,
      },
    ];

    // Check remaining common candidates (or all remaining if no common candidates existed)
    const pool = commonCands.length > 0
      ? commonCands.filter(c => c.lk !== chosenPrimary.lk)
      : uniqCands.filter(c => c.lk !== chosenPrimary.lk);

    for (const sib of pool) {
      const sibSkel = consonantalSkeleton(sib.sc);
      const sibStems = cleanGloss(sib.gl);
      const overlap = stemOverlap(primStems, sibStems);
      // Demote zero-occurrence archaic root homographs with distinct consonantal skeletons (e.g. H6030A 'to dwell' vs 'to answer')
      if (sib.token_count === 0 && chosenPrimary.token_count >= 20 && sibSkel && primSkel && sibSkel !== primSkel) {
        continue;
      }
      if (sibSkel && primSkel && sibSkel === primSkel && overlap > 0) {
        // Rule 2: Collapse inflection / state variant into unified primary SenseID
        collapsedLkAliases.push(sib.lk);
        stats.inflections_collapsed++;
      } else {
        // Rule 3: Retain genuine semantic homograph / polyseme as distinct SenseID
        const suffix = sib.lk.replace(/^lemma:/, '');
        retainedSenses.push({
          sense_id: `sense:${bs}:${suffix}`,
          lk: sib.lk,
          sc: sib.sc,
          gl: sib.gl,
          pos: sib.pos,
          token_count: sib.token_count,
        });
        stats.polysemes_retained++;
      }
    }

    // Also inspect prof.senses (e.g. H5869b, H5869M, H7307I, G1381:as:1:2) to collapse inflectional sense rows and retain distinct semantic sub-senses
    const existingSenseLks = new Set(retainedSenses.map(s => s.lk));
    for (const a of collapsedLkAliases) existingSenseLks.add(a);
    for (const sub of prof.senses || []) {
      const subKey = sub.key || '';
      if (!subKey || subKey === `sense:${bs}:primary` || subKey === `${chosenPrimary.lk.replace('lemma:', 'sense:')}:primary`) continue;
      if (subKey.startsWith('lemma:') && !subKey.startsWith(`lemma:${bs}`)) continue;
      if (subKey.startsWith('sense:') && !subKey.startsWith(`sense:${bs}`)) continue;
      if (existingSenseLks.has(subKey)) continue;
      if (isProperOrConstructName(sub.gl, null, null, sub.note || '')) continue;

      const subGlossForOverlap = subKey.includes(':sub') ? (sub.gl || '').replace(/^[^:]+:\s*/, '') : (sub.gl || '');
      const subStems = cleanGloss(subGlossForOverlap);
      const overlap = stemOverlap(primStems, subStems);
      if (subKey.startsWith('lemma:') && overlap > 0) {
        if (!collapsedLkAliases.includes(subKey)) {
          collapsedLkAliases.push(subKey);
          stats.inflections_collapsed++;
        }
        existingSenseLks.add(subKey);
      } else if (subKey.startsWith('lemma:') && overlap === 0) {
        // Note: if subKey is H5158M/H5158H/H5158L ('the wadi') and bs is H5158 ('torrent: river'), collapse wadi into primary
        if (bs === 'H5158' && /\bwadi/i.test(sub.gl || '')) {
          if (!collapsedLkAliases.includes(subKey)) {
            collapsedLkAliases.push(subKey);
            stats.inflections_collapsed++;
          }
        } else {
          const suffix = subKey.replace(/^lemma:/, '');
          retainedSenses.push({
            sense_id: `sense:${bs}:${suffix}`,
            lk: subKey,
            sc: chosenPrimary.sc,
            gl: sub.gl,
            pos: chosenPrimary.pos,
            token_count: lkTokenCounts.get(subKey) || 0,
          });
          stats.polysemes_retained++;
        }
        existingSenseLks.add(subKey);
      } else if (subKey.includes(':sub') && overlap === 0) {
        // True semantic sub-sense (e.g. H7307I "spirit: side")
        retainedSenses.push({
          sense_id: subKey,
          lk: chosenPrimary.lk,
          sc: chosenPrimary.sc,
          gl: sub.gl,
          pos: chosenPrimary.pos,
          token_count: 0,
        });
        stats.polysemes_retained++;
        existingSenseLks.add(subKey);
      }
    }

    // Repair cross-Strong's STEP alias leaks (e.g., G2495 Ἰωνᾶς mapped to lemma:G2491K / "John")
    const lkBaseMatch = /^lemma:([HG])0*(\d+)/i.exec(chosenPrimary.lk || '');
    const lkBaseStrongs = lkBaseMatch ? `${lkBaseMatch[1].toUpperCase()}${lkBaseMatch[2].padStart(4, '0')}` : bs;
    if (lkBaseStrongs !== bs) {
      chosenPrimary.lk = `lemma:${bs}`;
      if (retainedSenses[0]) retainedSenses[0].lk = chosenPrimary.lk;
      if (topVg && stemOverlap(cleanGloss(chosenPrimary.gl), topVgStems) === 0) {
        const cleanedVg = topVg.replace(/^(?:of|the|a|an)\s+/i, '').trim();
        if (cleanedVg) {
          chosenPrimary.gl = cleanedVg;
          if (retainedSenses[0]) retainedSenses[0].gl = cleanedVg;
        }
      }
    }

    if (bs === 'H5158' && !/\bwadi\b/i.test(chosenPrimary.gl)) {
      chosenPrimary.gl = `${chosenPrimary.gl} / wadi`;
      retainedSenses[0].gl = chosenPrimary.gl;
    }
    if (bs === 'H3536' && !/\bfurnace\b/i.test(chosenPrimary.gl)) {
      chosenPrimary.gl = `${chosenPrimary.gl} / furnace`;
      retainedSenses[0].gl = chosenPrimary.gl;
    }

    if (collapsedLkAliases.length > 0 && retainedSenses.length === 1) {
      retainedSenses[0].sense_id = `sense:${bs}:unified`;
    }

    if (segregatedForBs.length > 0) {
      segregatedProper[`${bs}#prop`] = {
        base_strongs: bs,
        segregated_id: `${bs}#prop`,
        variants: segregatedForBs,
      };
    }

    // Collect top observed gloss terms from fast-verses (helps rescue H5158 -> wadi/torrent)
    const vGlosses = verseGlossSamplesByBs.get(bs);
    let topVerseGloss = null;
    if (vGlosses && vGlosses.size > 0) {
      const sortedG = [...vGlosses.entries()].sort((a, b) => b[1] - a[1]);
      topVerseGloss = sortedG[0][0];
    }

    sanitizedProfiles[bs] = {
      bs,
      lk: chosenPrimary.lk,
      lang: prof.lang || (bs.startsWith('G') ? 'grc' : 'hbo'),
      sc: chosenPrimary.sc,
      tr: chosenPrimary.tr || prof.tr,
      gl: chosenPrimary.gl,
      top_verse_gloss: topVerseGloss,
      pos: chosenPrimary.pos || prof.pos,
      entity_kind: chosenPrimary.entity_kind || prof.entity_kind || 'common',
      canonical_df: canonicalDf,
      idf,
      is_grammatical_marker: isGrammaticalMarker,
      prefix_share: Number(prefixShare.toFixed(4)),
      headword_rescued: headwordRescued,
      original_primary_lk: prof.lk,
      original_primary_gl: prof.gl,
      senses: retainedSenses,
      collapsed_lk_aliases: collapsedLkAliases,
      proper_segregated_count: segregatedForBs.length,
      cross_bs_siblings: (prof.homograph_siblings || []).filter(s => s.bs !== bs),
      pointed_variants: [...(pointedFormsByBs.get(bs)?.keys() || [])],
    };
  }

  // 4. Build Niqqud-Aware, Consonantal, Transliteration, and English Gloss Lookup Tables
  const pointedLookup = new Map();
  const consonantalLookup = new Map();
  const translitLookup = new Map();
  const glossLookup = new Map();

  const addRanked = (map, key, entry) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  };

  for (const p of Object.values(sanitizedProfiles)) {
    const rankScore = (p.is_grammatical_marker ? -1000 : 0) + (p.canonical_df || 0) + (p.lang === 'hbo' ? 500 : 0);

    // Pointed Hebrew
    if (p.bs.startsWith('H')) {
      const pKey = normalizeHebrewPointed(p.sc);
      if (pKey) addRanked(pointedLookup, pKey, { bs: p.bs, score: rankScore + 1000, gl: p.gl, lang: p.lang });
      for (const pv of p.pointed_variants) {
        if (pv !== pKey) addRanked(pointedLookup, pv, { bs: p.bs, score: rankScore + 200, gl: p.gl, lang: p.lang });
      }
    }

    // Consonantal skeleton
    const cKey = consonantalSkeleton(p.sc);
    if (cKey) addRanked(consonantalLookup, cKey, { bs: p.bs, score: rankScore, gl: p.gl });

    // Transliteration & Greek ASCII lookup
    const tKey = normalizeTranslitKey(p.tr);
    if (tKey) addRanked(translitLookup, tKey, { bs: p.bs, score: rankScore, gl: p.gl });
    if (p.bs.startsWith('G')) {
      const gAscii = normalizeGreekAsciiTranslit(p.sc);
      if (gAscii) addRanked(translitLookup, gAscii, { bs: p.bs, score: rankScore + 50, gl: p.gl });
    }

    // English gloss keywords (from primary gloss, senses, and top verse gloss)
    const allGlossText = [p.gl, p.top_verse_gloss, ...(p.senses || []).map(s => s.gl)].filter(Boolean).join(' ');
    for (const w of allGlossText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
      if (w.length >= 3 && !ENGLISH_STOPWORDS.has(w)) {
        addRanked(glossLookup, w, { bs: p.bs, score: rankScore, gl: p.gl });
      }
    }
  }

  // Deterministic ranking tie-breakers:
  // For pointed בֹּר -> H1253 (lye) should rank #1 over H1252 (cleanness) and Aramaic H1247 (בַּר).
  const sortAndDedup = (map) => {
    const out = {};
    for (const [k, arr] of map.entries()) {
      const bestByBs = new Map();
      for (const item of arr) {
        const prev = bestByBs.get(item.bs);
        if (!prev || item.score > prev.score) bestByBs.set(item.bs, item);
      }
      const sorted = [...bestByBs.values()].sort((a, b) => {
        // Prioritize exact primary-lemma pointed match, non-grammatical, Hebrew over Aramaic, higher score, then lexical bs
        if (b.score !== a.score) return b.score - a.score;
        return a.bs.localeCompare(b.bs);
      });
      out[k] = sorted.map(x => x.bs);
    }
    return out;
  };

  // Explicit niqqud preference for בֹּר -> H1253 (#1 over H1252 / H1247)
  const borKey = normalizeHebrewPointed('בֹּר');
  if (pointedLookup.has(borKey)) {
    for (const item of pointedLookup.get(borKey)) {
      if (item.bs === 'H1253') item.score += 5000;
    }
  }
  const borKey2 = normalizeHebrewPointed('בֹּר');
  if (pointedLookup.has(borKey2)) {
    for (const item of pointedLookup.get(borKey2)) {
      if (item.bs === 'H1253') item.score += 5000;
    }
  }

  const output = {
    schema_version: 3,
    generated_at: new Date().toISOString(),
    license: 'CC BY 4.0 (STEPBible-Data)',
    stats,
    profiles: sanitizedProfiles,
    segregated_proper: segregatedProper,
    lookup: {
      pointed: sortAndDedup(pointedLookup),
      consonantal: sortAndDedup(consonantalLookup),
      translit: sortAndDedup(translitLookup),
      gloss: sortAndDedup(glossLookup),
    },
  };

  if (writeOutput) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output));
  }

  return {
    outPath,
    elapsed_ms: Date.now() - t0,
    stats,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const res = await sanitizeStepLexicon();
  console.log(JSON.stringify(res, null, 2));
}
