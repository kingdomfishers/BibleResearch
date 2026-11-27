// @file: src/relationships/symbolic-patterns.ts
// Algorithm C: Scriptural self-interpretation extraction (with strict referent separation),
// MACULA/R8 structured role-frame matching, and symbolic/prophetic chain assembly.
// Pure TypeScript; zero hardcoded verse pairs.

export interface VerseTokenLite {
  wn?: number;
  sf?: string;
  lm?: string;
  s: string;
  g?: string;
  cl?: string;
}

export interface VerseInputLite {
  verse_id: number;
  book: number;
  chapter: number;
  verse: number;
  ref: string;
  en: string;
  toks: VerseTokenLite[];
}

export interface SelfInterpretationRecord {
  id: string;
  verse_id: number;
  ref: string;
  language: 'hbo' | 'grc';
  cue_kind:
    | 'greek_copula_identification'
    | 'greek_antitype_link'
    | 'hebrew_vision_qa_explanation'
    | 'hebrew_demonstrative_identification'
    | 'hebrew_naming_etiology'
    | 'hebrew_compound_name_etiology'
    | 'hebrew_birth_attribute_naming';
  symbol_strongs: string[];
  referent_strongs: string[];
  symbol_summary: string;
  referent_summary: string;
  witness_vids: number[];
  strict_referent_note: string;
}

const HEBREW_FINAL_MAP: Record<string, string> = {
  ך: 'כ',
  ם: 'מ',
  ן: 'נ',
  ף: 'פ',
  ץ: 'צ',
};

function hebrewConsonants(raw: string): string {
  const nfd = (raw || '').normalize('NFD');
  let out = '';
  for (const ch of nfd) {
    const code = ch.charCodeAt(0);
    if (code >= 0x05d0 && code <= 0x05ea) {
      out += HEBREW_FINAL_MAP[ch] ?? ch;
    }
  }
  return out;
}

function hebrewNoMatresStem(raw: string): string {
  const cons = hebrewConsonants(raw);
  if (cons.length <= 2) return cons;
  // Strip medial matres (ו, י) and final weak ה on >= 3-letter words
  let out = cons[0];
  for (let i = 1; i < cons.length - 1; i++) {
    const c = cons[i];
    if (c === 'ו' || c === 'י') continue;
    out += c;
  }
  const last = cons[cons.length - 1];
  if (last !== 'ה' || out.length < 2) {
    out += last;
  }
  return out;
}

const NAMING_CLAUSE_SKIP = new Set([
  'H0853', 'H0854', 'H4480', 'H0413', 'H5921', 'H0518', 'H3588', 'H0834', 'H1931', 'H0859',
  'H0589', 'H2088', 'H2063', 'H0428', 'H1992', 'H3605', 'H3808', 'H3541', 'H3651', 'H4100',
  'H0559', 'H1696', 'H1961', 'H7121', 'H8034', 'H3205', 'H2029', 'H0430', 'H3068', 'H0376',
  'H0802', 'H1121', 'H1323', 'H0001', 'H0517',
]);

const SKIP_CONTENT_STRONGS = new Set([
  'H0853', 'H0854', 'H4480', 'H0413', 'H5921', 'H0518', 'H3588', 'H0834', 'H1931', 'H0859',
  'H0589', 'H2088', 'H2063', 'H0428', 'H1992', 'H3605', 'H3808', 'H3541', 'H3651', 'H4100',
  'H0559', 'H1696', 'H1961', 'H7200', 'H3190',
  'G3588', 'G2532', 'G1161', 'G0846', 'G1722', 'G1519', 'G3754', 'G1473', 'G4771', 'G3778',
  'G3739', 'G5100', 'G5101', 'G1438', 'G1510', 'G1063', 'G3361', 'G3756', 'G3761', 'G0235',
  'G1537', 'G0575', 'G2596', 'G3326', 'G4012', 'G4314', 'G5228', 'G5613', 'G3004', 'G1492',
  'G2400', 'G3568', 'G2531', 'G1163', 'G3767',
]);

const SKIP_POS = new Set([
  'conjunction', 'preposition', 'article', 'particle', 'pronoun', 'interjection', 'adverb',
  'cj', 'prep', 'ptcl', 'adv', 'rel', 'om', 'intj', 'pron', 'det',
]);

function isContentToken(tok: VerseTokenLite): boolean {
  if (!tok.s || /^H900/.test(tok.s) || SKIP_CONTENT_STRONGS.has(tok.s)) return false;
  const cl = (tok.cl || '').toLowerCase();
  return !SKIP_POS.has(cl);
}

function isNominalLike(tok: VerseTokenLite): boolean {
  if (!isContentToken(tok)) return false;
  const cl = (tok.cl || '').toLowerCase();
  if (!cl) return true;
  return cl === 'noun' || cl === 'adj' || cl === 'num' || cl === 'nmpr' || cl === 'subs' || cl === 'n';
}

function isSymbolicCandidateNoun(tok: VerseTokenLite, rareCutoff: number, dfMap?: ReadonlyMap<string, number>): boolean {
  if (!isNominalLike(tok)) return false;
  const df = dfMap?.get(tok.s) ?? 50;
  return df <= rareCutoff;
}

/**
 * Scan canonical verses for explicit biblical self-interpretation statements
 * (Greek demonstrative/relative + copula identifications, antitype declarations,
 * and Hebrew prophetic vision Q&A or "these are..." symbol explanations).
 * Preserves clause-local symbol -> referent separation.
 */
export function extractScripturalInterpretations(
  verses: VerseInputLite[],
  dfMap?: ReadonlyMap<string, number>,
): SelfInterpretationRecord[] {
  const byVid = new Map<number, VerseInputLite>();
  for (const v of verses) byVid.set(v.verse_id, v);

  const out: SelfInterpretationRecord[] = [];
  const seenKey = new Set<string>();

  for (const v of verses) {
    const toks = v.toks || [];
    if (toks.length === 0) continue;
    const isNt = v.book >= 40;

    if (isNt) {
      // 1. Greek antitype explicit bridge (e.g., G0499 antitypon in 1 Pet 3:21 -> previous verse imagery)
      const antiIdx = toks.findIndex(t => t.s === 'G0499');
      if (antiIdx >= 0) {
        const afterNouns = toks.slice(antiIdx + 1).filter(t => isNominalLike(t)).slice(0, 3);
        const prevVerse = byVid.get(v.verse_id - 1);
        const contextNouns = [
          ...toks.slice(Math.max(0, antiIdx - 6), antiIdx).filter(t => isSymbolicCandidateNoun(t, 400, dfMap)),
          ...(prevVerse ? prevVerse.toks.filter(t => isSymbolicCandidateNoun(t, 160, dfMap)) : []),
        ].slice(0, 4);
        if (afterNouns.length > 0 && contextNouns.length > 0) {
          const id = `r13:interp:${v.verse_id}:anti`;
          if (!seenKey.has(id)) {
            seenKey.add(id);
            out.push({
              id,
              verse_id: v.verse_id,
              ref: v.ref,
              language: 'grc',
              cue_kind: 'greek_antitype_link',
              symbol_strongs: [...new Set(contextNouns.map(t => t.s))],
              referent_strongs: [...new Set(afterNouns.map(t => t.s))],
              symbol_summary: contextNouns.map(t => `${t.lm || t.sf || t.s} (${t.g || t.s})`).join(', '),
              referent_summary: afterNouns.map(t => `${t.lm || t.sf || t.s} (${t.g || t.s})`).join(', '),
              witness_vids: prevVerse ? [prevVerse.verse_id, v.verse_id] : [v.verse_id],
              strict_referent_note: `Explicit antitype statement in ${v.ref}; keep the antitype referent distinct from any other nearby typological details.`,
            });
          }
        }
      }

      // 2. Clause-local relative/demonstrative + copula (G3739/G3778 + G1510 "which are / these are / that is")
      const isPrepGoverned = (idx: number): boolean => {
        const p1 = idx > 0 ? toks[idx - 1] : null;
        const p2 = idx > 1 ? toks[idx - 2] : null;
        const isPrep = (t: VerseTokenLite | null) => Boolean(t && ((t.cl || '').toLowerCase() === 'prep' || SKIP_CONTENT_STRONGS.has(t.s) && /^G(?:1799|1722|1909|4314|5259|1537|0575|3326|2596)$/.test(t.s)));
        return isPrep(p1) || Boolean(p1 && (p1.cl || '').toLowerCase() === 'det' && isPrep(p2));
      };
      for (let i = 1; i < toks.length - 1; i++) {
        if (toks[i].s !== 'G1510') continue;
        const prevTok = toks[i - 1];
        const hasMarker =
          prevTok.s === 'G3739' ||
          prevTok.s === 'G3778' ||
          (i >= 2 && (toks[i - 2].s === 'G3739' || toks[i - 2].s === 'G3778')) ||
          toks[i + 1]?.s === 'G3778';
        if (!hasMarker) continue;

        // Walk backward within current clause boundary up to 10 tokens, skipping preposition-governed modifiers
        const leftCandidates: VerseTokenLite[] = [];
        for (let l = i - 1; l >= Math.max(0, i - 10); l--) {
          const lt = toks[l];
          if (l < i - 1 && (lt.s === 'G1510' || lt.s === 'G2532')) {
            if (leftCandidates.length > 0) break;
          }
          if (isPrepGoverned(l)) continue;
          if (isSymbolicCandidateNoun(lt, 450, dfMap)) {
            leftCandidates.unshift(lt);
            if (leftCandidates.length >= 3) break;
          }
        }

        const rightCandidates: VerseTokenLite[] = [];
        for (let r = i + 1; r < Math.min(toks.length, i + 9); r++) {
          const rt = toks[r];
          if (r > i + 1 && (rt.s === 'G1510' || rt.s === 'G2532') && rightCandidates.length >= 1) break;
          if (isNominalLike(rt)) {
            rightCandidates.push(rt);
            if (rightCandidates.length >= 3) break;
          }
        }

        if (leftCandidates.length === 0 || rightCandidates.length === 0) continue;
        // Require at least one rare or visionary/symbolic noun rather than trivial pronouns/generics
        const hasRareSymbol = leftCandidates.some(t => (dfMap?.get(t.s) ?? 999) <= 220);
        if (!hasRareSymbol) continue;

        const symStrongs = [...new Set(leftCandidates.map(t => t.s))];
        const refStrongs = [...new Set(rightCandidates.map(t => t.s))];
        if (symStrongs.every(s => refStrongs.includes(s))) continue;

        const id = `r13:interp:${v.verse_id}:${i}`;
        if (seenKey.has(id)) continue;
        seenKey.add(id);

        const symDesc = leftCandidates.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(' + ');
        const refDesc = rightCandidates.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(' + ');
        out.push({
          id,
          verse_id: v.verse_id,
          ref: v.ref,
          language: 'grc',
          cue_kind: 'greek_copula_identification',
          symbol_strongs: symStrongs,
          referent_strongs: refStrongs,
          symbol_summary: symDesc,
          referent_summary: refDesc,
          witness_vids: [v.verse_id],
          strict_referent_note: `${v.ref} specifically identifies ${symDesc} as ${refDesc}; preserve exact clause referent without merging across separate verses.`,
        });
      }

      // 3. Clause-final Greek equative copula (Subject NP + Predicate NP + G1510, e.g., Rev 1:20)
      for (let i = 3; i < toks.length; i++) {
        if (toks[i].s !== 'G1510') continue;
        const nearRel = toks[i - 1]?.s === 'G3739' || toks[i - 1]?.s === 'G3778' || toks[i - 2]?.s === 'G3739' || toks[i - 2]?.s === 'G3778';
        const clauseEnd = i === toks.length - 1 || toks[i + 1]?.s === 'G2532';
        if (nearRel || !clauseEnd) continue;

        const spanToks: VerseTokenLite[] = [];
        for (let l = i - 1; l >= Math.max(0, i - 9); l--) {
          const lt = toks[l];
          if (lt.s === 'G1510' || lt.s === 'G2532' || (lt.cl || '').toLowerCase() === 'verb') break;
          if (isPrepGoverned(l)) continue;
          spanToks.unshift(lt);
        }
        const spanNouns = spanToks.filter(t => isSymbolicCandidateNoun(t, 450, dfMap) && t.s !== 'G3466');
        if (spanNouns.length < 2) continue;
        const symToks = [spanNouns[0]];
        const refToks = spanNouns.slice(1);
        if ((dfMap?.get(symToks[0].s) ?? 999) > 220) continue;
        const symStrongs = [...new Set(symToks.map(t => t.s))];
        const refStrongs = [...new Set(refToks.map(t => t.s))];
        if (symStrongs.every(s => refStrongs.includes(s))) continue;

        const id = `r13:interp:${v.verse_id}:${i}`;
        if (seenKey.has(id)) continue;
        seenKey.add(id);

        const symDesc = symToks.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(' + ');
        const refDesc = refToks.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(' + ');
        out.push({
          id,
          verse_id: v.verse_id,
          ref: v.ref,
          language: 'grc',
          cue_kind: 'greek_copula_identification',
          symbol_strongs: symStrongs,
          referent_strongs: refStrongs,
          symbol_summary: symDesc,
          referent_summary: refDesc,
          witness_vids: [v.verse_id],
          strict_referent_note: `${v.ref} clause-final identification binds ${symDesc} to ${refDesc}; preserve exact referent without merging neighboring clauses.`,
        });
      }

      // 4. Bare Greek parable / symbolic equative copula (Noun + G1510 + [Art] + Noun, e.g., Luke 8:11 "The seed is the word of God")
      const hasParableCue = toks.some(t => t.s === 'G3850') || /\b(?:parable|mystery|allegory)\b/i.test(v.en || '');
      for (let i = 1; i < toks.length - 1; i++) {
        if (toks[i].s !== 'G1510') continue;
        const leftNoun = (() => {
          const t1 = toks[i - 1];
          if (t1 && isSymbolicCandidateNoun(t1, 180, dfMap) && !isPrepGoverned(i - 1)) return t1;
          return null;
        })();
        if (!leftNoun) continue;
        const symDf = dfMap?.get(leftNoun.s) ?? 999;
        if (!hasParableCue && symDf > 90) continue;

        const rightCandidates: VerseTokenLite[] = [];
        for (let r = i + 1; r < Math.min(toks.length, i + 5); r++) {
          const rt = toks[r];
          if (r > i + 1 && (rt.s === 'G1510' || rt.s === 'G2532') && rightCandidates.length >= 1) break;
          if (isNominalLike(rt)) rightCandidates.push(rt);
        }
        if (rightCandidates.length === 0) continue;
        const symStrongs = [leftNoun.s];
        const refStrongs = [...new Set(rightCandidates.map(t => t.s))];
        if (symStrongs.every(s => refStrongs.includes(s))) continue;

        const id = `r13:interp:${v.verse_id}:eq${i}`;
        if (seenKey.has(id)) continue;
        seenKey.add(id);

        const symDesc = `${leftNoun.lm || leftNoun.sf || leftNoun.s} (${leftNoun.s}, "${leftNoun.g || ''}")`;
        const refDesc = rightCandidates.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(' + ');
        out.push({
          id,
          verse_id: v.verse_id,
          ref: v.ref,
          language: 'grc',
          cue_kind: 'greek_copula_identification',
          symbol_strongs: symStrongs,
          referent_strongs: refStrongs,
          symbol_summary: symDesc,
          referent_summary: refDesc,
          witness_vids: [v.verse_id],
          strict_referent_note: `${v.ref} equative copula explicitly identifies ${symDesc} as ${refDesc}.`,
        });
      }
    } else {
      // OT Prophetic vision Q&A ("What do you see?" / "What are these?" -> next 0..2 verses explanation)
      const strongsSet = new Set(toks.map(t => t.s));
      const hasVisionQ = strongsSet.has('H4100') && (strongsSet.has('H7200') || strongsSet.has('H0428'));
      const enLower = (v.en || '').toLowerCase();
      const isVisionIntro = hasVisionQ && /\b(what do you see|what are these|i see|behold)\b/.test(enLower);
      if (isVisionIntro) {
        const next1 = byVid.get(v.verse_id + 1);
        const next2 = byVid.get(v.verse_id + 2);
        const windowNext = [next1, next2].filter((x): x is VerseInputLite => Boolean(x && x.book === v.book));
        if (windowNext.length > 0) {
          const symToks = toks.filter(t => isSymbolicCandidateNoun(t, 260, dfMap)).slice(0, 4);
          const refToks = windowNext
            .flatMap(w => w.toks)
            .filter(t => isContentToken(t) && ((dfMap?.get(t.s) ?? 999) <= 320 || t.s === 'H3068'))
            .slice(0, 5);
          if (symToks.length > 0 && refToks.length > 0) {
            const id = `r13:interp:${v.verse_id}:vis`;
            if (!seenKey.has(id)) {
              seenKey.add(id);
              const symDesc = symToks.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(', ');
              const refDesc = refToks.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(', ');
              out.push({
                id,
                verse_id: v.verse_id,
                ref: v.ref,
                language: 'hbo',
                cue_kind: 'hebrew_vision_qa_explanation',
                symbol_strongs: [...new Set(symToks.map(t => t.s))],
                referent_strongs: [...new Set(refToks.map(t => t.s))],
                symbol_summary: symDesc,
                referent_summary: refDesc,
                witness_vids: [v.verse_id, ...windowNext.map(w => w.verse_id)],
                strict_referent_note: `Prophetic vision Q&A in ${v.ref}-${windowNext[windowNext.length - 1].verse}; verify wordplay/interpretation boundaries explicitly.`,
              });
            }
          }
        }
      }

      // OT Equative demonstrative identification ("these bones ARE the whole house of Israel" / "these seven ARE the eyes of Yahweh",
      // strictly rejecting directional dative addresses or transitive action clauses like Ezek 37:5 "to these bones: I will cause breath to enter")
      const demIdx = toks.findIndex(t => t.s === 'H0428' || t.s === 'H1992');
      const hasDem = demIdx >= 0;
      const isEquativeDemEn =
        /\b(?:these(?:\s+[a-z]+){0,2}\s+(?:are|is)|they\s+are)\b/.test(enLower) &&
        !/\b(?:to|unto|into|against|upon|for)\s+these\b/.test(enLower) &&
        !/\b(?:cause\s+\w+\s+to\s+enter|put\s+sinews|bring\s+up\s+flesh)\b/.test(enLower);
      const isActionPrefix = demIdx > 0 && /^to\s+/i.test(toks[demIdx - 1]?.g || '');
      if (hasDem && isEquativeDemEn && !isActionPrefix) {
        const nouns = toks.filter(t => isSymbolicCandidateNoun(t, 350, dfMap) || t.s === 'H3068' || t.s === 'H7651');
        if (nouns.length >= 2) {
          const mid = Math.ceil(nouns.length / 2);
          const symToks = nouns.slice(0, mid);
          const refToks = nouns.slice(mid);
          const id = `r13:interp:${v.verse_id}:dem`;
          if (!seenKey.has(id) && symToks.some(t => (dfMap?.get(t.s) ?? 999) <= 220)) {
            seenKey.add(id);
            const symDesc = symToks.map(t => `${t.lm || t.sf || t.s} (${t.s})`).join(', ');
            const refDesc = refToks.map(t => `${t.lm || t.sf || t.s} (${t.s})`).join(', ');
            out.push({
              id,
              verse_id: v.verse_id,
              ref: v.ref,
              language: 'hbo',
              cue_kind: 'hebrew_demonstrative_identification',
              symbol_strongs: [...new Set(symToks.map(t => t.s))],
              referent_strongs: [...new Set(refToks.map(t => t.s))],
              symbol_summary: symDesc,
              referent_summary: refDesc,
              witness_vids: [v.verse_id],
              strict_referent_note: `Demonstrative symbol identification in ${v.ref}; keep distinct from similar imagery in other books unless explicitly linked.`,
            });
          }
        }
      }

      // OT Biblical Naming Etiologies ([H7121 קָרָא + H8034 שֵׁם + ProperName]):
      // 1) Compound 2-word stem decomposition (e.g. Gen 29:32 רְאוּבֵן H7205 [ראבן] = רָאָה H7200 [רא] + בֵּן H1121 [בן]),
      // 2) Single-word consonantal/root naming explanation in the naming verse or ±3v birth-speech response
      //    (e.g. Gen 21:3-6 יִצְחָק H3327 ↔ צְחֹק H6712 + צָחַק H6711),
      // 3) Birth-attribute naming description ([H3318 יָצָא + rare descriptive nouns/adjectives] + [H7121 + H8034 + ProperName],
      //    e.g. Gen 25:25 עֵשָׂו H6215 ↔ אַדְמוֹנִי H0132 + שֵׂעָר H8181).
      const callIdx = toks.findIndex(t => t.s === 'H7121');
      const nameNounIdx = toks.findIndex((t, idx) => t.s === 'H8034' && (callIdx < 0 || Math.abs(idx - callIdx) <= 4));
      if (callIdx >= 0 && nameNounIdx >= 0) {
        const anchorIdx = Math.max(callIdx, nameNounIdx);
        // When a relative clause (אֲשֶׁר H0834 or participle הַנּוֹלַד H3205) modifies שֵׁם בְּנוֹ (e.g. Gen 21:3 "called the name of his son who was born to him, whom Sarah bore to him, Isaac"),
        // the named entity appears right after the relative clause; prefer the token after the relative clause or the rarest proper name within +1..+10 tokens.
        const candTargets: VerseTokenLite[] = [];
        for (let k = anchorIdx + 1; k <= Math.min(toks.length - 1, anchorIdx + 10); k++) {
          const cand = toks[k];
          if (!cand || !cand.s || /^H900/.test(cand.s) || NAMING_CLAUSE_SKIP.has(cand.s)) continue;
          const cl = (cand.cl || '').toLowerCase();
          if (SKIP_POS.has(cl) || cl === 'verb') continue;
          const cCons = hebrewConsonants(cand.lm || cand.sf || '');
          if (cCons.length >= 2) {
            candTargets.push(cand);
          }
        }
        // If there is a relative clause (H0834) between anchorIdx and the last candidate, the named entity is the last candidate (after the relative clause); otherwise the first candidate.
        const hasRelBetween = toks.slice(anchorIdx + 1, anchorIdx + 9).some(t => t.s === 'H0834');
        const namedTok: VerseTokenLite | null =
          candTargets.length === 0
            ? null
            : hasRelBetween
              ? candTargets[candTargets.length - 1]
              : candTargets[0];

        if (namedTok) {
          const namedBs = namedTok.s;
          const namedRaw = namedTok.lm || namedTok.sf || '';
          const namedCons = hebrewConsonants(namedRaw);
          const namedStem = hebrewNoMatresStem(namedRaw);
          const namedLabel = `${namedRaw} (${namedBs}, "${namedTok.g || ''}")`;

          // Candidate explanation tokens in the same verse (excluding the naming formula itself, but keeping H1121 בֵּן for compound names like רְאוּבֵן)
          const sameVerseClauseToks = toks.filter(
            t =>
              t.s &&
              t.s !== namedBs &&
              !/^H900/.test(t.s) &&
              (t.s === 'H1121' || !NAMING_CLAUSE_SKIP.has(t.s)) &&
              !SKIP_POS.has((t.cl || '').toLowerCase()),
          );

          // Check (A): Compound 2-word prefix+suffix decomposition in the same verse (e.g., רְאוּבֵן [ראבן] = רָאָה [רא] + בֵּן [בן])
          let emittedCompound = false;
          if (namedStem.length >= 4) {
            for (let i = 0; i < sameVerseClauseToks.length && !emittedCompound; i++) {
              const t1 = sameVerseClauseToks[i];
              const s1 = hebrewNoMatresStem(t1.lm || t1.sf || '');
              const c1 = hebrewConsonants(t1.lm || t1.sf || '');
              if (s1.length < 2) continue;
              const prefCandidates = [s1, s1.slice(0, 2), c1.slice(0, 2)].filter(p => p.length >= 2);
              const matchedPref = prefCandidates.find(p => namedStem.startsWith(p));
              if (!matchedPref) continue;
              const remStem = namedStem.slice(matchedPref.length);
              if (remStem.length < 2) continue;

              for (let j = 0; j < sameVerseClauseToks.length; j++) {
                if (i === j) continue;
                const t2 = sameVerseClauseToks[j];
                if (t2.s === t1.s) continue;
                const s2 = hebrewNoMatresStem(t2.lm || t2.sf || '');
                const c2 = hebrewConsonants(t2.lm || t2.sf || '');
                if (s2 === remStem || c2 === remStem || (remStem.length >= 2 && s2.startsWith(remStem))) {
                  const id = `r13:interp:${v.verse_id}:compname:${namedBs}`;
                  if (!seenKey.has(id)) {
                    seenKey.add(id);
                    const refToks = [t1, t2];
                    const refDesc = refToks.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(' + ');
                    out.push({
                      id,
                      verse_id: v.verse_id,
                      ref: v.ref,
                      language: 'hbo',
                      cue_kind: 'hebrew_compound_name_etiology',
                      symbol_strongs: [namedBs],
                      referent_strongs: [t1.s, t2.s],
                      symbol_summary: namedLabel,
                      referent_summary: refDesc,
                      witness_vids: [v.verse_id],
                      strict_referent_note: `Clause-scoped compound naming etiology in ${v.ref}: ${namedLabel} decomposes into ${refDesc} (${matchedPref} + ${remStem} = ${namedStem}).`,
                    });
                    emittedCompound = true;
                  }
                  break;
                }
              }
            }
          }

          // Check (B): Single-word consonantal/root naming explanation in the same verse OR ±3v birth-speech window (only when same-verse speech is absent)
          const hasSameVerseSpeech = strongsSet.has('H0559') || strongsSet.has('H3588');
          const hasBirthVerb = strongsSet.has('H3205') || strongsSet.has('H2029');
          const windowVerses: { verse: VerseInputLite; toks: VerseTokenLite[] }[] = [
            { verse: v, toks: sameVerseClauseToks.filter(t => t.s !== 'H1121') },
          ];
          if (hasBirthVerb && !hasSameVerseSpeech) {
            for (let dv = 1; dv <= 3; dv++) {
              const nv = byVid.get(v.verse_id + dv);
              if (!nv || nv.book !== v.book || nv.chapter !== v.chapter) continue;
              const nvStrongs = new Set(nv.toks.map(t => t.s));
              if (nvStrongs.has('H0559') && !nvStrongs.has('H7121')) {
                const nvClauseToks = nv.toks.filter(
                  t =>
                    t.s &&
                    t.s !== namedBs &&
                    !/^H900/.test(t.s) &&
                    !NAMING_CLAUSE_SKIP.has(t.s) &&
                    !SKIP_POS.has((t.cl || '').toLowerCase()),
                );
                windowVerses.push({ verse: nv, toks: nvClauseToks });
              }
            }
          }

          const matchedEtiologyToks: VerseTokenLite[] = [];
          const matchedWitnessVids = new Set<number>([v.verse_id]);
          for (const wv of windowVerses) {
            for (const ct of wv.toks) {
              const ctCons = hebrewConsonants(ct.lm || ct.sf || '');
              const ctStem = hebrewNoMatresStem(ct.lm || ct.sf || '');
              if (ctStem.length < 2) continue;
              // Require >= 2 non-mater stem consonants shared in order with the named entity's stem
              let sharedInOrder = 0;
              let cursor = 0;
              for (const ch of ctStem) {
                const pos = namedStem.indexOf(ch, cursor);
                if (pos >= 0) {
                  sharedInOrder++;
                  cursor = pos + 1;
                }
              }
              const sharesRootSubstr =
                (ctStem.length >= 2 && namedCons.includes(ctStem.slice(0, 2))) ||
                (ctCons.length >= 3 && namedCons.includes(ctCons.slice(0, 3))) ||
                sharedInOrder >= 3 ||
                (sharedInOrder >= 2 && Math.min(ctStem.length, namedStem.length) <= 3 && Math.max(ctStem.length, namedStem.length) <= 4);
              if (sharesRootSubstr) {
                if (!matchedEtiologyToks.some(x => x.s === ct.s)) {
                  matchedEtiologyToks.push(ct);
                }
                matchedWitnessVids.add(wv.verse.verse_id);
              }
            }
          }

          if (matchedEtiologyToks.length > 0) {
            const primaryVid = [...matchedWitnessVids].pop() ?? v.verse_id;
            const id = `r13:interp:${v.verse_id}:name:${namedBs}`;
            if (!seenKey.has(id)) {
              seenKey.add(id);
              const refDesc = matchedEtiologyToks.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(', ');
              const spanRef =
                primaryVid !== v.verse_id && byVid.get(primaryVid)
                  ? `${v.ref}-${byVid.get(primaryVid)!.verse}`
                  : v.ref;
              out.push({
                id,
                verse_id: v.verse_id,
                ref: spanRef,
                language: 'hbo',
                cue_kind: 'hebrew_naming_etiology',
                symbol_strongs: [namedBs],
                referent_strongs: matchedEtiologyToks.map(t => t.s),
                symbol_summary: namedLabel,
                referent_summary: refDesc,
                witness_vids: [...matchedWitnessVids],
                strict_referent_note: `Explicit biblical naming etiology in ${spanRef}: ${namedLabel} is explained by ${refDesc}.`,
              });
            }
          } else if (strongsSet.has('H3318')) {
            // Check (C): Birth-attribute naming clause ([H3318 יָצָא + rare descriptive nouns/adjectives df <= 150] + [H7121 + H8034 + ProperName])
            const birthAttrToks = sameVerseClauseToks.filter(
              t =>
                t.s !== 'H3318' &&
                t.s !== 'H7223' &&
                isNominalLike(t) &&
                (dfMap?.get(t.s) ?? 999) <= 150,
            );
            if (birthAttrToks.length > 0) {
              const id = `r13:interp:${v.verse_id}:birthname:${namedBs}`;
              if (!seenKey.has(id)) {
                seenKey.add(id);
                const refDesc = birthAttrToks.map(t => `${t.lm || t.sf || t.s} (${t.s}, "${t.g || ''}")`).join(', ');
                out.push({
                  id,
                  verse_id: v.verse_id,
                  ref: v.ref,
                  language: 'hbo',
                  cue_kind: 'hebrew_birth_attribute_naming',
                  symbol_strongs: [namedBs],
                  referent_strongs: [...new Set(birthAttrToks.map(t => t.s))],
                  symbol_summary: namedLabel,
                  referent_summary: refDesc,
                  witness_vids: [v.verse_id],
                  strict_referent_note: `Birth-attribute naming clause in ${v.ref}: ${namedLabel} is named in immediate connection with birth attributes ${refDesc}.`,
                });
              }
            }
          }
        }
      }
    }
  }

  return out;
}

export interface CompactClauseFrame {
  pred: string;
  subj: string[];
  obj: string[];
  other: string[];
}

export interface FrameAlignmentResult {
  score: number;
  aligned_roles: Array<{ role: string; left: string; right: string }>;
}

/**
 * Compare grammatical role frames across two verses using optional LXX equivalent map
 * so scenes align predicates/agents/objects rather than raw bag-of-words overlap.
 */
export function compareStructuredRoleFrames(
  framesA: CompactClauseFrame[],
  framesB: CompactClauseFrame[],
  equivalentsByBs?: ReadonlyMap<string, ReadonlySet<string>>,
): FrameAlignmentResult {
  const shares = (a: string, b: string): boolean => {
    if (!a || !b) return false;
    if (a === b) return true;
    if (equivalentsByBs?.get(a)?.has(b)) return true;
    if (equivalentsByBs?.get(b)?.has(a)) return true;
    return false;
  };

  let bestScore = 0;
  let bestAligned: Array<{ role: string; left: string; right: string }> = [];

  for (const fa of framesA) {
    for (const fb of framesB) {
      const aligned: Array<{ role: string; left: string; right: string }> = [];
      let s = 0;
      if (shares(fa.pred, fb.pred)) {
        s += 0.4;
        aligned.push({ role: 'predicate', left: fa.pred, right: fb.pred });
      }
      for (const sa of fa.subj) {
        const hit = fb.subj.find(sb => shares(sa, sb));
        if (hit) {
          s += 0.3;
          aligned.push({ role: 'subject', left: sa, right: hit });
          break;
        }
      }
      for (const oa of fa.obj) {
        const hit = fb.obj.find(ob => shares(oa, ob));
        if (hit) {
          s += 0.3;
          aligned.push({ role: 'object', left: oa, right: hit });
          break;
        }
      }
      for (const xa of fa.other) {
        const hit = fb.other.find(xb => shares(xa, xb));
        if (hit) {
          s += 0.15;
          aligned.push({ role: 'adjunct', left: xa, right: hit });
          break;
        }
      }
      if (aligned.length >= 2 && s > bestScore) {
        bestScore = Math.min(1, Math.round(s * 1000) / 1000);
        bestAligned = aligned;
      }
    }
  }

  return { score: bestScore, aligned_roles: bestAligned };
}

export interface SymbolicChainLink {
  stage: 'wordplay' | 'artifact_motif' | 'prophetic_vision' | 'explicit_self_interpretation';
  from_node: string;
  to_node: string;
  evidence_id: string;
  refs: string[];
  summary: string;
  strict_note?: string;
}

export interface AssembledSymbolicChain {
  chain_id: string;
  seed: string;
  links: SymbolicChainLink[];
  covered_refs: string[];
  referent_separations: string[];
  score: number;
}

/**
 * Assemble multi-stage symbolic & prophetic progression chains cleanly from
 * wordplay edges -> shared ritual/artifact collocations -> prophetic vision / NT self-interpretations,
 * enforcing strict referent separation when multiple NT identifications exist.
 */
export function assembleSymbolicChains(params: {
  seedStrongOrVid: string;
  wordplayTargets: Array<{ source_bs: string; target_bs: string; witness_refs: string[]; score: number; detail: string }>;
  collocNeighborsByBs: ReadonlyMap<string, Array<{ target_bs: string; shared_count: number; npmi: number; sample_refs: string[] }>>;
  lxxEquivalentsByBs: ReadonlyMap<string, string[]>;
  selfInterpretations: SelfInterpretationRecord[];
  verseRefByVid?: ReadonlyMap<number, string>;
}): AssembledSymbolicChain[] {
  const {
    seedStrongOrVid,
    wordplayTargets,
    collocNeighborsByBs,
    lxxEquivalentsByBs,
    selfInterpretations,
  } = params;

  const interpBySymbolBs = new Map<string, SelfInterpretationRecord[]>();
  for (const si of selfInterpretations) {
    for (const s of si.symbol_strongs) {
      let arr = interpBySymbolBs.get(s);
      if (!arr) { arr = []; interpBySymbolBs.set(s, arr); }
      arr.push(si);
    }
  }

  const links: SymbolicChainLink[] = [];
  const reachedNodes = new Set<string>();
  const refSet = new Set<string>();
  const refSeparations = new Set<string>();

  for (const wp of wordplayTargets.slice(0, 4)) {
    links.push({
      stage: 'wordplay',
      from_node: wp.source_bs,
      to_node: wp.target_bs,
      evidence_id: `r13:wp:${wp.source_bs}:${wp.target_bs}`,
      refs: wp.witness_refs.slice(0, 3),
      summary: wp.detail,
    });
    reachedNodes.add(wp.source_bs);
    reachedNodes.add(wp.target_bs);
    for (const r of wp.witness_refs) refSet.add(r);
  }

  // Expand 1-2 ritual/artifact collocation hops from seed + wordplay derivatives
  const frontier = [...reachedNodes];
  if (frontier.length === 0 && /^[HG]\d+$/i.test(seedStrongOrVid)) frontier.push(seedStrongOrVid.toUpperCase());

  const secondTierNodes: string[] = [...frontier];
  for (const u of frontier) {
    for (const col of (collocNeighborsByBs.get(u) || []).slice(0, 3)) {
      if (reachedNodes.has(col.target_bs)) continue;
      links.push({
        stage: 'artifact_motif',
        from_node: u,
        to_node: col.target_bs,
        evidence_id: `r13:colloc:${u}:${col.target_bs}`,
        refs: col.sample_refs.slice(0, 3),
        summary: `Shared co-occurrence (${col.shared_count}v, NPMI=${col.npmi})`,
      });
      reachedNodes.add(col.target_bs);
      secondTierNodes.push(col.target_bs);
      for (const r of col.sample_refs) refSet.add(r);
    }
  }

  // Attach self-interpretations reached directly or via LXX equivalent from secondTierNodes
  const attachedInterpIds = new Set<string>();
  for (const nodeBs of secondTierNodes) {
    const candidateSyms = new Set([nodeBs, ...(lxxEquivalentsByBs.get(nodeBs) || [])]);
    // Also follow 1 further high-NPMI hop (e.g. lampstand -> lamp -> eye) to reach prophetic/apocalyptic self-interpretations
    for (const col of (collocNeighborsByBs.get(nodeBs) || []).slice(0, 3)) {
      candidateSyms.add(col.target_bs);
      for (const lx of lxxEquivalentsByBs.get(col.target_bs) || []) candidateSyms.add(lx);
    }

    for (const symBs of candidateSyms) {
      for (const si of interpBySymbolBs.get(symBs) || []) {
        if (attachedInterpIds.has(si.id)) continue;
        attachedInterpIds.add(si.id);
        links.push({
          stage: si.language === 'hbo' ? 'prophetic_vision' : 'explicit_self_interpretation',
          from_node: nodeBs,
          to_node: si.referent_strongs.join('+'),
          evidence_id: si.id,
          refs: [si.ref],
          summary: `${si.ref}: ${si.symbol_summary} -> ${si.referent_summary}`,
          strict_note: si.strict_referent_note,
        });
        refSet.add(si.ref);
        refSeparations.add(si.strict_referent_note);
      }
    }
  }

  if (links.length < 2) return [];
  return [{
    chain_id: `r13:symchain:${seedStrongOrVid}`,
    seed: seedStrongOrVid,
    links: links.slice(0, 12),
    covered_refs: [...refSet].slice(0, 12),
    referent_separations: [...refSeparations].slice(0, 6),
    score: Math.round((links.length * 120 + attachedInterpIds.size * 180) * 100) / 100,
  }];
}
