// @file: src/relationships/wordplay-engine.ts
// Algorithm A: Original-language wordplay, consonantal, phonetic, root, and textual-proximity discovery.
// Pure TypeScript compatible with browser/Worker bundles and Node strip-types; zero hardcoded verse pairs.

export type WordplayEvidenceType =
  | 'attested_textual_wordplay'
  | 'proximate_wordplay_candidate'
  | 'documented_root_family'
  | 'morphological_derivation'
  | 'shared_consonantal_pattern'
  | 'phonetic_similarity';

export type WordplayOverlapKind =
  | 'documented_biblical_wordplay'
  | 'shared_root'
  | 'consonantal_exact'
  | 'prefix_suffix_overlap'
  | 'shared_consonantal_substring'
  | 'metathesis'
  | 'edit_distance_1'
  | 'phonetic_similarity'
  | 'consonantal_subsequence_only'
  | 'syntactic_talion'
  | 'clause_polyptoton'
  | 'onomastic_valence_play';

export interface NormalizedOriginalForm {
  script: string;
  language: 'hbo' | 'grc';
  consonantal: string;
  consonantalWithSinDot: string;
  skeletonNoMatres: string;
  strippedAffixStem: string;
  phoneticClass: string;
  ngrams2: string[];
  ngrams3: string[];
}

export interface WordplayCandidateEdge {
  source_bs: string;
  target_bs: string;
  source_script: string;
  target_script: string;
  evidence_type: WordplayEvidenceType;
  overlap_kind: WordplayOverlapKind;
  epistemic_class:
    | 'direct_textual_evidence'
    | 'documented_lexical_relationship'
    | 'orthographic_similarity_only'
    | 'candidate_literary_pattern';
  proven_common_root: boolean;
  shared_root_key?: string;
  shared_consonants: string;
  source_consonants: string;
  target_consonants: string;
  edit_distance: number;
  phonetic_distance: number;
  idf_overlap: number;
  proximity_same_verse: number;
  proximity_adjacent_verse: number;
  has_explicit_cue: boolean;
  cue_kinds: string[];
  witness_vids: number[];
  score: number;
  etymology_disclaimer: string;
}

const HEBREW_FINAL_TO_MEDIAL: Readonly<Record<string, string>> = {
  'ך': 'כ',
  'ם': 'מ',
  'ן': 'נ',
  'ף': 'פ',
  'ץ': 'צ',
};

const HEBREW_PHONETIC_CLASS: Readonly<Record<string, string>> = {
  'א': 'A', 'ה': 'A', 'ח': 'A', 'ע': 'A',
  'ס': 'S', 'ש': 'S', 'צ': 'S', 'ז': 'S',
  'ק': 'K', 'כ': 'K', 'ג': 'K',
  'ת': 'T', 'ט': 'T', 'ד': 'T',
  'ב': 'P', 'פ': 'P', 'ו': 'P', 'מ': 'P',
  'ל': 'L', 'ר': 'L',
  'נ': 'N',
  'י': 'Y',
};

const GREEK_PHONETIC_CLASS: Readonly<Record<string, string>> = {
  'β': 'P', 'π': 'P', 'φ': 'P', 'μ': 'M',
  'γ': 'K', 'κ': 'K', 'χ': 'K',
  'δ': 'T', 'τ': 'T', 'θ': 'T',
  'ζ': 'S', 'σ': 'S', 'ξ': 'S', 'ψ': 'S',
  'λ': 'L', 'ρ': 'L',
  'ν': 'N',
  'α': 'V', 'ε': 'V', 'η': 'V', 'ι': 'V', 'ο': 'V', 'υ': 'V', 'ω': 'V',
};

const HEBREW_PROCLITICS = new Set(['ו', 'ב', 'כ', 'ל', 'מ', 'ה', 'ש']);
const HEBREW_MATRES = new Set(['ו', 'י']);
const HEBREW_SUFFIXES = ['ים', 'ות', 'ה', 'י', 'נ', 'כ', 'ו', 'ת'];

const GREEK_VERB_ENDINGS = [
  'εσθαι', 'ασθαι', 'ησθαι', 'ομεθα', 'εσθε', 'ονται', 'ωνται', 'ουσιν', 'ουσι',
  'ασιν', 'ησαν', 'θησαν', 'θησ', 'θην', 'θη', 'σαν', 'σα', 'ειν', 'εναι',
  'εισ', 'ει', 'ωμεν', 'ητε', 'ετε', 'ομεν', 'οντο', 'ατο', 'μαι', 'σαι',
  'ται', 'νται', 'ατεω', 'ιζω', 'αζω', 'ευω', 'εω', 'αω', 'οω', 'μι', 'σι',
  'ω', 'ησ', 'η', 'ον', 'εσ', 'ε',
];

const GREEK_NOMINAL_CASE_ENDINGS = [
  'οισιν', 'αισιν', 'ουσιν', 'ουμεν', 'οισ', 'αισ', 'ουσ', 'ων', 'ασ', 'ησ',
  'ωσ', 'οσ', 'ον', 'ου', 'α', 'η', 'ω', 'ι', 'σ', 'ν',
];

export function stripGreekInflectionalStem(
  cleanGreek: string,
  grammarCode = '',
  posClass = '',
): string {
  let s = cleanGreek;
  if (s.length <= 3) return s;
  const gc = grammarCode.toUpperCase();
  const pc = posClass.toLowerCase();
  const isVerb = pc === 'verb' || /^V-/.test(gc);

  if (isVerb) {
    for (const suf of GREEK_VERB_ENDINGS) {
      if (s.length - suf.length >= 3 && s.endsWith(suf)) {
        s = s.slice(0, s.length - suf.length);
        break;
      }
    }
    return s;
  }

  if (!pc && !gc) {
    // Unknown POS: check multi-char Greek verb endings (incl. contract -εω/-αω/-οω) before nominal -ω/-ν/-σ
    for (const suf of GREEK_VERB_ENDINGS) {
      if (suf.length >= 2 && s.length - suf.length >= 3 && s.endsWith(suf)) {
        s = s.slice(0, s.length - suf.length);
        return s;
      }
    }
  }

  for (const suf of GREEK_NOMINAL_CASE_ENDINGS) {
    if (s.length - suf.length >= 3 && s.endsWith(suf)) {
      s = s.slice(0, s.length - suf.length);
      break;
    }
  }
  // Strip trailing derivational -ι- (from -ιος/-ιον/-ια/-ιῳ) when stem >= 4 (e.g., αιωνι -> αιων, εκουσι -> εκουσ, κυρι -> κυρ)
  if (s.length >= 4 && s.endsWith('ι')) {
    s = s.slice(0, -1);
  }
  if (s.length >= 5 && (s.endsWith('μω') || s.endsWith('μο'))) {
    s = s.slice(0, -2);
  }
  return s;
}

export function stripHebrewProcliticsWithLemma(surfaceCons: string, lemmaCons?: string): string {
  let s = surfaceCons;
  if (!s) return s;
  if (!lemmaCons) return s;
  let stripped = 0;
  while (s.length > lemmaCons.length && stripped < 2 && HEBREW_PROCLITICS.has(s[0])) {
    if (lemmaCons.startsWith(s[0]) && s.length <= lemmaCons.length + 1) break;
    // Strip proclitic only when absent from lemmaScript start (or surface carries extra prefix before lemma)
    if (!lemmaCons.startsWith(s[0]) || s.slice(1).startsWith(lemmaCons.slice(0, Math.min(2, lemmaCons.length)))) {
      s = s.slice(1);
      stripped++;
    } else {
      break;
    }
  }
  return s;
}

export function countHebrewNonMaterConsonants(cons: string): number {
  if (!cons) return 0;
  let count = 0;
  for (let i = 0; i < cons.length; i++) {
    const ch = cons[i];
    if (HEBREW_MATRES.has(ch)) {
      // Initial waw/yod radical (e.g. ילד, ירד, ידע, ודע) is consonantal
      if (i === 0 && cons.length >= 3) count++;
      continue;
    }
    if (i === cons.length - 1 && (ch === 'ה' || ch === 'א') && cons.length >= 3) {
      continue;
    }
    count++;
  }
  return count;
}

export function detectLanguage(script: string, strongsHint?: string): 'hbo' | 'grc' {
  if (strongsHint && /^G/i.test(strongsHint.trim())) return 'grc';
  if (/[\u0370-\u03FF\u1F00-\u1FFF]/.test(script)) return 'grc';
  return 'hbo';
}

export function stripHebrewConsonants(raw: string, preserveSinDot = false): string {
  const nfd = raw.normalize('NFD');
  let out = '';
  for (let i = 0; i < nfd.length; i++) {
    const code = nfd.charCodeAt(i);
    if (code >= 0x0591 && code <= 0x05c7) {
      if (preserveSinDot && (code === 0x05c1 || code === 0x05c2)) {
        out += nfd[i];
      }
      continue;
    }
    const ch = nfd[i];
    if (ch >= 'א' && ch <= 'ת') {
      out += HEBREW_FINAL_TO_MEDIAL[ch] || ch;
    }
  }
  return out;
}

export function stripGreekLetters(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[^\u03b1-\u03c9]/g, '');
}

function collapseMatresHebrew(cons: string): string {
  if (cons.length <= 2) return cons;
  if (cons.length === 3 && (cons[1] === 'ו' || cons[1] === 'י')) {
    return cons[0] + cons[2];
  }
  if (cons.length === 3) return cons;
  let out = cons[0];
  for (let i = 1; i < cons.length - 1; i++) {
    const ch = cons[i];
    if (ch === 'ו' || ch === 'י') continue;
    out += ch;
  }
  const last = cons[cons.length - 1];
  if (out.length >= 3 && (last === 'ה' || last === 'י')) return out;
  return out + last;
}

function stripOrdinaryHebrewAffixes(cons: string, lemmaCons?: string): string {
  let s = cons;
  for (const suf of HEBREW_SUFFIXES) {
    const minRemain = suf.length >= 2 ? 2 : 3;
    if (s.length - suf.length >= minRemain && s.endsWith(suf)) {
      s = s.slice(0, s.length - suf.length);
      break;
    }
  }
  // Lemma-guarded proclitic stripping: never strip leading מ/ה/ש/etc. if present in lemmaScript
  if (s.length >= 4 && (!lemmaCons || !lemmaCons.startsWith(s[0]))) {
    if (lemmaCons ? HEBREW_PROCLITICS.has(s[0]) : ['ו', 'ב', 'כ', 'ל'].includes(s[0])) {
      s = s.slice(1);
    }
  }
  return s;
}

function buildNgrams(text: string, size: number): string[] {
  if (text.length < size) return text ? [text] : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= text.length - size; i++) {
    const g = text.slice(i, i + size);
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

export function normalizeOriginalForm(
  script: string,
  strongsHint?: string,
  grammarCode?: string,
  posClass?: string,
  lemmaScript?: string,
): NormalizedOriginalForm {
  const language = detectLanguage(script, strongsHint);
  // Split multi-form comma/semicolon dictionary headwords (e.g., H0894 "בָּבֶ֫ל, בָּבֶל")
  // so repeated lexical entries do not concatenate into artificial double-length skeletons.
  const primaryScript = String(script || '').split(/[,;/]/)[0]?.trim() || String(script || '');
  const cleanLemma =
    lemmaScript && !lemmaScript.startsWith('[')
      ? String(lemmaScript).split(/[,;/]/)[0]?.trim() || ''
      : '';
  if (language === 'grc') {
    const clean = stripGreekLetters(primaryScript);
    const stem = stripGreekInflectionalStem(clean, grammarCode, posClass);
    let phon = '';
    for (const ch of stem) {
      const cls = GREEK_PHONETIC_CLASS[ch] || ch;
      if (cls === 'V' && phon.endsWith('V')) continue;
      phon += cls;
    }
    return {
      script: primaryScript,
      language,
      consonantal: clean,
      consonantalWithSinDot: clean,
      skeletonNoMatres: stem,
      strippedAffixStem: stem,
      phoneticClass: phon.replace(/V/g, '') || phon,
      ngrams2: buildNgrams(stem, 2),
      ngrams3: buildNgrams(stem, 3),
    };
  }

  const rawCons = stripHebrewConsonants(primaryScript, false);
  const rawConsDot = stripHebrewConsonants(primaryScript, true);
  const lemmaCons = cleanLemma ? stripHebrewConsonants(cleanLemma, false) : undefined;
  const cons = lemmaCons ? stripHebrewProcliticsWithLemma(rawCons, lemmaCons) : rawCons;
  const consDot = lemmaCons ? stripHebrewProcliticsWithLemma(rawConsDot, lemmaCons) : rawConsDot;
  const noMatres = collapseMatresHebrew(cons);
  const stripped = stripOrdinaryHebrewAffixes(cons, lemmaCons ?? cons);
  let phon = '';
  for (const ch of noMatres) {
    phon += HEBREW_PHONETIC_CLASS[ch] || ch;
  }
  return {
    script: primaryScript,
    language,
    consonantal: cons,
    consonantalWithSinDot: consDot,
    skeletonNoMatres: noMatres,
    strippedAffixStem: stripped,
    phoneticClass: phon,
    ngrams2: buildNgrams(cons, 2),
    ngrams3: buildNgrams(cons, 3),
  };
}

export function longestCommonSubstring(a: string, b: string): string {
  if (!a || !b) return '';
  let bestLen = 0;
  let bestEnd = 0;
  const dp = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1;
        if (dp[j] > bestLen) {
          bestLen = dp[j];
          bestEnd = i;
        }
      } else {
        dp[j] = 0;
      }
      prev = tmp;
    }
  }
  return bestLen > 0 ? a.slice(bestEnd - bestLen, bestEnd) : '';
}

export function weightedConsonantalDistance(
  a: string,
  b: string,
  language: 'hbo' | 'grc',
): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const map = language === 'hbo' ? HEBREW_PHONETIC_CLASS : GREEK_PHONETIC_CLASS;
  let prev = new Float64Array(m + 1);
  let curr = new Float64Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost =
        a[i - 1] === b[j - 1]
          ? 0
          : (map[a[i - 1]] && map[a[i - 1]] === map[b[j - 1]])
            ? 0.45
            : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return Math.round(prev[m] * 100) / 100;
}

export function isConsonantalMetathesis(a: string, b: string): boolean {
  if (a.length < 3 || a.length !== b.length || a === b) return false;
  const sa = [...a].sort().join('');
  const sb = [...b].sort().join('');
  return sa === sb;
}

export interface WordplayPairMetrics {
  comparable: boolean;
  overlap_kind: WordplayOverlapKind;
  shared_consonants: string;
  edit_distance: number;
  phonetic_distance: number;
  idf_overlap: number;
  formal_score: number;
}

const ETYMOLOGY_DISCLAIMER =
  'Formal original-language consonantal, phonetic, or proximate wordplay correspondence only; does NOT establish shared lexical etymology unless a STEP root or derivation link is explicitly documented.';

export function compareOriginalForms(
  a: NormalizedOriginalForm,
  b: NormalizedOriginalForm,
  ngramIdf?: ReadonlyMap<string, number>,
): WordplayPairMetrics {
  const empty: WordplayPairMetrics = {
    comparable: false,
    overlap_kind: 'consonantal_subsequence_only',
    shared_consonants: '',
    edit_distance: 99,
    phonetic_distance: 99,
    idf_overlap: 0,
    formal_score: 0,
  };
  if (a.language !== b.language || !a.consonantal || !b.consonantal) return empty;
  const isGrc = a.language === 'grc';
  // For Greek, compare POS-stripped inflectional stems so suffixes (-μος/-ιος/-ρον/-ος/-ον/-οις) never create false overlaps.
  const cA = isGrc ? (a.strippedAffixStem || a.consonantal) : a.consonantal;
  const cB = isGrc ? (b.strippedAffixStem || b.consonantal) : b.consonantal;
  if (cA.length < 2 || cB.length < 2) return empty;

  const minLen = Math.min(cA.length, cB.length);
  const maxLen = Math.max(cA.length, cB.length);
  const lcs = longestCommonSubstring(cA, cB);
  const noMatresLcs = isGrc ? lcs : longestCommonSubstring(a.skeletonNoMatres, b.skeletonNoMatres);
  const stemLcs = isGrc ? lcs : longestCommonSubstring(a.strippedAffixStem, b.strippedAffixStem);
  let bestLcs = noMatresLcs.length > lcs.length ? noMatresLcs : lcs;
  if (stemLcs.length > bestLcs.length) bestLcs = stemLcs;

  const editDist = weightedConsonantalDistance(cA, cB, a.language);
  const noMatresDist = isGrc ? editDist : weightedConsonantalDistance(a.skeletonNoMatres, b.skeletonNoMatres, a.language);
  const bestEdit = Math.min(editDist, noMatresDist);

  // Detect 3-char consonantal frame when single medial consonant differs (e.g., צדקה <-> צעקה)
  if (!isGrc && bestLcs.length === 2 && minLen >= 4 && editDist <= 1.0 && cA[0] === cB[0] && cA.slice(-2) === cB.slice(-2)) {
    bestLcs = cA[0] + cA.slice(-2);
  }

  const hasStrongHebrewRoot = (cons: string) => /[^אהוי]/.test(cons);
  const phonDist = weightedConsonantalDistance(a.phoneticClass, b.phoneticClass, a.language);
  const metathesis = isGrc
    ? cA.length >= 3 && isConsonantalMetathesis(cA, cB)
    : hasStrongHebrewRoot(cA) &&
      hasStrongHebrewRoot(cB) &&
      ((
        a.strippedAffixStem.length >= 3 &&
        b.strippedAffixStem.length >= 3 &&
        isConsonantalMetathesis(a.strippedAffixStem, b.strippedAffixStem)
      ) || (
        !cA.endsWith('ות') && !cB.endsWith('ות') &&
        !cA.endsWith('ים') && !cB.endsWith('ים') &&
        countHebrewNonMaterConsonants(cA) >= 3 &&
        countHebrewNonMaterConsonants(cB) >= 3 &&
        isConsonantalMetathesis(cA, cB)
      ));

  // IDF-weighted shared n-gram strength (caps common 2-consonant substrings while boosting distinctive stems)
  let ngramScore = 0;
  const setA = new Set([...a.ngrams3, ...a.ngrams2]);
  for (const g of [...b.ngrams3, ...b.ngrams2]) {
    if (!setA.has(g)) continue;
    const baseIdf = ngramIdf?.get(g) ?? (g.length >= 3 ? 4.2 : 2.1);
    ngramScore += g.length >= 3 ? baseIdf * 1.15 : baseIdf * 0.55;
  }
  const idfOverlap = Math.round(Math.min(12, ngramScore) * 100) / 100;

  let overlapKind: WordplayOverlapKind | null = null;
  let baseFormal = 0;

  if (cA === cB && (!isGrc || cA.length >= 3)) {
    overlapKind = 'consonantal_exact';
    baseFormal = 0.96;
  } else if (!isGrc && a.skeletonNoMatres === b.skeletonNoMatres && a.skeletonNoMatres.length >= 2) {
    overlapKind = 'consonantal_exact';
    baseFormal = 0.9;
  } else if (metathesis) {
    overlapKind = 'metathesis';
    baseFormal = 0.78;
  } else if (a.strippedAffixStem === b.strippedAffixStem && a.strippedAffixStem.length >= 3) {
    overlapKind = 'prefix_suffix_overlap';
    baseFormal = 0.84;
  } else if (
    (cA.includes(cB) || cB.includes(cA)) &&
    (isGrc ? minLen >= 3 : minLen >= 2) &&
    maxLen - minLen <= 2
  ) {
    overlapKind = minLen >= 3 ? 'prefix_suffix_overlap' : 'shared_consonantal_substring';
    baseFormal = minLen >= 3 ? 0.8 : 0.72;
  } else if (
    (isGrc || (hasStrongHebrewRoot(cA) && hasStrongHebrewRoot(cB))) &&
    (bestLcs.length >= 3 ||
      (!isGrc && bestLcs.length === 2 && minLen <= 3 && maxLen <= 4 && bestEdit <= 1.5))
  ) {
    overlapKind = bestLcs.length >= 3 ? 'shared_consonantal_substring' : 'edit_distance_1';
    baseFormal = bestLcs.length >= 3 ? 0.68 : 0.56;
  } else if ((isGrc || (hasStrongHebrewRoot(cA) && hasStrongHebrewRoot(cB))) && bestEdit <= 1.0 && minLen >= (isGrc ? 4 : 3)) {
    overlapKind = 'edit_distance_1';
    baseFormal = 0.64;
  } else if (
    phonDist <= 0.6 &&
    Math.min(a.phoneticClass.length, b.phoneticClass.length) >= 3 &&
    Math.abs(a.phoneticClass.length - b.phoneticClass.length) <= 1 &&
    (isGrc ? bestLcs.length >= 3 : countHebrewNonMaterConsonants(bestLcs) >= 2)
  ) {
    overlapKind = 'phonetic_similarity';
    baseFormal = 0.52;
  }

  if (!overlapKind) return empty;
  const idfBoost = Math.min(0.12, idfOverlap * 0.015);
  return {
    comparable: true,
    overlap_kind: overlapKind,
    shared_consonants: bestLcs || (overlapKind === 'phonetic_similarity' ? a.phoneticClass : cA),
    edit_distance: bestEdit,
    phonetic_distance: phonDist,
    idf_overlap: idfOverlap,
    formal_score: Math.min(1, Math.round((baseFormal + idfBoost - bestEdit * 0.04) * 1000) / 1000),
  };
}

export interface VerseWordplayContextInput {
  strongsList: string[];
  englishText?: string;
}

export function detectWordplayContextCues(
  windowVerses: VerseWordplayContextInput[],
  language: 'hbo' | 'grc',
): string[] {
  const cues = new Set<string>();
  const allStrongs = new Set<string>();
  const combinedEn = windowVerses.map(v => v.englishText || '').join(' ').toLowerCase();
  for (const v of windowVerses) {
    for (const s of v.strongsList) allStrongs.add(s.toUpperCase());
  }

  // Strictly require textual/exegetical wordplay or naming markers rather than bare conjunctions/prepositions
  // like H4480 (min) or H3588 (ki) alone, which cause coincidental same-verse promotion (e.g., Lev 16:14, Isa 29:19).
  if (language === 'hbo') {
    const hasInterrogativeSee =
      (allStrongs.has('H4100') && allStrongs.has('H7200')) ||
      (/\bwhat do you see\b/.test(combinedEn) && allStrongs.has('H7200'));
    if (hasInterrogativeSee) {
      cues.add('prophetic_vision_qa');
    }
    const hasPropheticEcho =
      allStrongs.has('H7200') &&
      allStrongs.has('H559') &&
      allStrongs.has('H3068') &&
      (allStrongs.has('H3588') || allStrongs.has('H3541') || allStrongs.has('H4100'));
    if (hasPropheticEcho) {
      cues.add('prophetic_vision_qa');
    }
    const hasCausalNaming =
      allStrongs.has('H7121') &&
      (allStrongs.has('H8034') || /\bcalled (?:its|his|her) name\b|\bnamed (?:him|her|it)\b/.test(combinedEn)) &&
      (allStrongs.has('H3588') || allStrongs.has('H3651') || allStrongs.has('H0559') || allStrongs.has('H559') || /\bbecause\b|\btherefore\b|\bsaying\b/.test(combinedEn));
    if (hasCausalNaming) {
      cues.add('naming_etiological_formula');
    }
    const hasCreationFormation =
      (allStrongs.has('H3335') || allStrongs.has('H1129') || allStrongs.has('H3947')) &&
      allStrongs.has('H4480') &&
      (/\b(?:formed man|dust (?:of|from) the ground|taken out of|built)\b/.test(combinedEn) ||
        allStrongs.has('H0120') ||
        allStrongs.has('H120') ||
        allStrongs.has('H0127') ||
        allStrongs.has('H127'));
    if (hasCreationFormation) {
      cues.add('creation_formation_cue');
    }
  } else {
    if (allStrongs.has('G3177') || (allStrongs.has('G3004') && /\bwhich is(?:,| )?\s*(?:by )?interpretation\b|\bthat is to say\b/.test(combinedEn))) {
      cues.add('greek_interpretation_formula');
    }
    if (
      (allStrongs.has('G3686') || allStrongs.has('G2564')) &&
      allStrongs.has('G3754') &&
      allStrongs.has('G3177')
    ) {
      cues.add('naming_formula');
    }
    if (allStrongs.has('G0499') || (allStrongs.has('G1510') && /\b(?:which (?:is|are)|meaning)\b/.test(combinedEn))) {
      cues.add('identification_copula');
    }
  }
  return [...cues];
}

export interface CorpusWordplayInputProfile {
  bs: string;
  script: string;
  gloss?: string;
  total_verses: number;
  all_vids: number[];
  root_keys?: string[];
  formation_targets?: string[];
}

export interface CorpusWordplayVerseLookup {
  verse_id: number;
  book?: number;
  strongsList: string[];
  englishText?: string;
}

export interface CorpusWordplayOptions {
  maxPerLemma?: number;
  maxVerseFreqForPureOrth?: number;
}

function isLikelyProperNameProfile(p: CorpusWordplayInputProfile, norm: NormalizedOriginalForm): boolean {
  const gl = String(p.gloss || '');
  if (!gl) return false;
  // Proper nouns in STEP/OSHB glosses start with a capitalized personal/place name and lack lowercase verb/noun lead-ins
  const firstGloss = gl.split(/[,;/]/)[0].trim();
  const isCapName = /^[A-Z][a-z'’\-]{2,}$/.test(firstGloss) && !/^(The|And|For|But|Not|In|On|At|To|Of|A|An|Is|Are|Be|Or|If|As|My|Thy|His|Her|Our)$/.test(firstGloss);
  return isCapName && !norm.language.startsWith('g');
}

function classifyPairEdge(params: {
  src: CorpusWordplayInputProfile;
  tgt: CorpusWordplayInputProfile;
  normSrc: NormalizedOriginalForm;
  normTgt: NormalizedOriginalForm;
  metrics: WordplayPairMetrics;
  srcConsLen: number;
  tgtConsLen: number;
  sharedRootKey?: string;
  isFormationDerived: boolean;
  sameVerseVids: number[];
  adjacentVerseVids: number[];
  cueKinds: string[];
  hasOracleBodyVisionCooccurrence: boolean;
}): WordplayCandidateEdge | null {
  const {
    src,
    tgt,
    normSrc,
    normTgt,
    metrics,
    srcConsLen,
    tgtConsLen,
    sharedRootKey,
    isFormationDerived,
    sameVerseVids,
    adjacentVerseVids,
    cueKinds,
    hasOracleBodyVisionCooccurrence,
  } = params;
  // Require real shared consonantal overlap (>= 2) before asserting a common root/derivation;
  // prevents unshared alternative proper names (e.g. Babylon H0894 vs Pekod H6489) from claiming proven_common_root.
  const hasSharedStemLetters = metrics.comparable && metrics.shared_consonants.length >= 2;
  const provenRoot = Boolean((sharedRootKey || isFormationDerived) && hasSharedStemLetters);
  const proxSame = sameVerseVids.length;
  const proxAdj = adjacentVerseVids.length;
  const rawHasCue = cueKinds.length > 0 && (proxSame > 0 || proxAdj > 0);
  const witnessVids = [...new Set([...sameVerseVids, ...adjacentVerseVids])].slice(0, 6);

  if (!metrics.comparable && !provenRoot) return null;

  // Noise suppression: require strong formal match unless proximate wordplay or documented root
  if (!provenRoot && proxSame === 0 && proxAdj === 0 && metrics.formal_score < 0.7) {
    return null;
  }
  // Common 2-letter lemmas only qualify if same/adjacent-verse proximate OR documented root OR exact consonantal match
  const minConsLen = Math.min(srcConsLen, tgtConsLen);
  if (minConsLen <= 2 && !provenRoot && proxSame === 0 && proxAdj === 0 && metrics.overlap_kind !== 'consonantal_exact') {
    return null;
  }

  let evidenceType: WordplayEvidenceType;
  let overlapKind: WordplayOverlapKind = metrics.overlap_kind;
  let epistemic: WordplayCandidateEdge['epistemic_class'];

  // Strip weak mater-lectionis letters when counting shared consonants in Hebrew
  const nonMaterSharedLen = src.bs.startsWith('H')
    ? countHebrewNonMaterConsonants(metrics.shared_consonants)
    : metrics.shared_consonants.length;

  const exactNoMaterSkeleton =
    Boolean(normSrc.skeletonNoMatres && normTgt.skeletonNoMatres) &&
    normSrc.skeletonNoMatres === normTgt.skeletonNoMatres &&
    normSrc.skeletonNoMatres.length >= 2;

  const hasExplicitNamingOrCreationCue = cueKinds.some(
    c =>
      c === 'naming_etiological_formula' ||
      c === 'creation_formation_cue' ||
      c === 'greek_interpretation_formula' ||
      c === 'naming_formula',
  );
  // Prophetic vision Q&A cues ("what do you see?") bind only content/vision pairs — never a vocative speaker/prophet name paired with a 2-consonant common noun like עָמוֹס <-> עַם.
  const visionCueBound =
    cueKinds.includes('prophetic_vision_qa') &&
    hasOracleBodyVisionCooccurrence &&
    (!isLikelyProperNameProfile(src, normSrc) && !isLikelyProperNameProfile(tgt, normTgt));

  const pairBoundCue = hasExplicitNamingOrCreationCue || visionCueBound;
  const hasCue = rawHasCue && pairBoundCue;

  const cueOverlapQualified =
    hasCue &&
    (proxSame > 0 || proxAdj > 0) &&
    metrics.formal_score >= 0.56 &&
    (nonMaterSharedLen >= 3 ||
      (nonMaterSharedLen === 2 && (exactNoMaterSkeleton || provenRoot || hasExplicitNamingOrCreationCue)));

  const exactHomophonePun =
    (proxSame > 0 || proxAdj > 0) &&
    metrics.overlap_kind === 'consonantal_exact' &&
    minConsLen >= 3 &&
    Math.min(src.total_verses, tgt.total_verses) <= 300;

  if (metrics.comparable && (cueOverlapQualified || exactHomophonePun)) {
    evidenceType = 'attested_textual_wordplay';
    overlapKind = hasCue ? 'documented_biblical_wordplay' : metrics.overlap_kind;
    epistemic = 'direct_textual_evidence';
  } else if (metrics.comparable && (proxSame > 0 || proxAdj > 0) && metrics.formal_score >= 0.52) {
    evidenceType = 'proximate_wordplay_candidate';
    epistemic = nonMaterSharedLen >= 3 ? 'candidate_literary_pattern' : 'orthographic_similarity_only';
  } else if (isFormationDerived && provenRoot) {
    evidenceType = 'morphological_derivation';
    overlapKind = 'shared_root';
    epistemic = 'documented_lexical_relationship';
  } else if (sharedRootKey && provenRoot) {
    evidenceType = 'documented_root_family';
    overlapKind = 'shared_root';
    epistemic = 'documented_lexical_relationship';
  } else {
    // Pure consonantal/phonetic edges (without proximity or documented root) require >= 3 shared non-mater consonants or >= 3-char metathesis
    if (nonMaterSharedLen < 3 && metrics.overlap_kind !== 'metathesis') {
      return null;
    }
    if (metrics.overlap_kind === 'phonetic_similarity') {
      evidenceType = 'phonetic_similarity';
      epistemic = 'orthographic_similarity_only';
    } else {
      evidenceType = 'shared_consonantal_pattern';
      epistemic = 'orthographic_similarity_only';
    }
  }

  const rarityFactor = 1 / Math.log2(4 + Math.min(src.total_verses, tgt.total_verses) * 0.25);
  const proxBoost = proxSame * 0.16 + proxAdj * 0.22 + (evidenceType === 'attested_textual_wordplay' ? 0.28 : (hasCue ? 0.12 : 0));
  const rootBoost = provenRoot ? 0.18 : 0;
  const formalPart = metrics.comparable ? metrics.formal_score * 0.48 : 0.3;
  const rawScore = (formalPart + proxBoost + rootBoost) * (0.65 + 0.55 * rarityFactor);
  const score = Math.round(Math.min(1, rawScore) * 1000) / 1000;

  return {
    source_bs: src.bs,
    target_bs: tgt.bs,
    source_script: src.script,
    target_script: tgt.script,
    evidence_type: evidenceType,
    overlap_kind: overlapKind,
    epistemic_class: epistemic,
    proven_common_root: provenRoot,
    ...(provenRoot && sharedRootKey ? { shared_root_key: sharedRootKey } : {}),
    shared_consonants: metrics.shared_consonants,
    source_consonants: stripHebrewConsonants(src.script.split(/[,;/]/)[0] || src.script) || stripGreekLetters(src.script.split(/[,;/]/)[0] || src.script),
    target_consonants: stripHebrewConsonants(tgt.script.split(/[,;/]/)[0] || tgt.script) || stripGreekLetters(tgt.script.split(/[,;/]/)[0] || tgt.script),
    edit_distance: metrics.edit_distance,
    phonetic_distance: metrics.phonetic_distance,
    idf_overlap: metrics.idf_overlap,
    proximity_same_verse: proxSame,
    proximity_adjacent_verse: proxAdj,
    has_explicit_cue: hasCue && evidenceType === 'attested_textual_wordplay',
    cue_kinds: cueKinds,
    witness_vids: witnessVids,
    score,
    etymology_disclaimer: provenRoot
      ? 'Documented in STEP/OSHB lexical root or formation records; shared derivation still does not guarantee identical contextual meaning.'
      : ETYMOLOGY_DISCLAIMER,
  };
}

/** Re-validate whether a serialized corpus wordplay edge qualifies as attested_textual_wordplay. */
export function isVerifiedAttestedWordplayEdge(
  edge: any,
  srcProfile?: { bs?: string; gl?: string; gloss?: string; script?: string; sc?: string } | null,
  tgtProfile?: { bs?: string; gl?: string; gloss?: string; script?: string; sc?: string } | null,
): boolean {
  if (!edge || String(edge.evidence_type || '') !== 'attested_textual_wordplay') return false;
  if (!edge.has_explicit_cue && Number(edge.proximity_same_verse || 0) === 0 && Number(edge.proximity_adjacent_verse || 0) === 0) {
    return false;
  }
  const srcBs = canonicalStrongsKey(edge.source_bs || srcProfile?.bs || '');
  const shared = String(edge.shared_consonants || '');
  const nonMaterShared = srcBs.startsWith('H') ? countHebrewNonMaterConsonants(shared) : shared.length;
  if (nonMaterShared >= 3) return true;
  if (nonMaterShared < 2) return false;
  // For 2-consonant Hebrew pairs (e.g. קַיִץ H7019 <-> קֵץ H7093), require exact consonant-skeleton identity,
  // proven root, or explicit naming formula — rejecting proper-name substring accidents like עָמוֹס (עמס) <-> עַם (עם).
  if (edge.proven_common_root) return true;
  const cues: string[] = Array.isArray(edge.cue_kinds) ? edge.cue_kinds : [];
  if (cues.some(c => c === 'naming_etiological_formula' || c === 'creation_formation_cue' || c === 'naming_formula')) {
    return true;
  }
  const nfA = normalizeOriginalForm(String(edge.source_script || srcProfile?.sc || srcProfile?.script || ''), srcBs);
  const nfB = normalizeOriginalForm(String(edge.target_script || tgtProfile?.sc || tgtProfile?.script || ''), String(edge.target_bs || tgtProfile?.bs || ''));
  if (nfA.skeletonNoMatres && nfB.skeletonNoMatres && nfA.skeletonNoMatres === nfB.skeletonNoMatres) {
    return true;
  }
  return false;
}

const WORDPLAY_STOP_STRONGS = new Set([
  'H0834', 'H0853', 'H0854', 'H4480', 'H0413', 'H5921', 'H0518', 'H3588', 'H1931', 'H0859', 'H0589', 'H0595',
  'H2088', 'H2063', 'H0428', 'H3605', 'H3808', 'H3541', 'H3651', 'H1571', 'H0408', 'H0559', 'H1696', 'H1961',
  'H0935', 'H1980', 'H5414', 'H6213', 'H3966', 'H3068', 'H3069', 'H0430', 'H0113', 'H0136', 'H8147',
  'G3588', 'G2532', 'G1161', 'G0846', 'G1722', 'G1519', 'G3754', 'G1473', 'G4771', 'G3778', 'G3739', 'G5100',
  'G5101', 'G1438', 'G1510', 'G1063', 'G3361', 'G3756', 'G3761', 'G0235', 'G1537', 'G0575', 'G2596', 'G3326',
  'G4012', 'G4314', 'G5228', 'G5613', 'G3004', 'G1096', 'G4160', 'G2064', 'G2192',
]);

/**
 * Discover corpus-wide formal wordplay, consonantal, phonetic, root, and textual-proximity edges
 * across all canonical lemma profiles. Zero hardcoded pairs.
 */
export function buildCorpusWordplayIndex(
  profiles: CorpusWordplayInputProfile[],
  verseLookup?: ReadonlyMap<number, CorpusWordplayVerseLookup>,
  options: CorpusWordplayOptions = {},
): Map<string, WordplayCandidateEdge[]> {
  const maxPerLemma = options.maxPerLemma ?? 12;
  const maxPureFreq = options.maxVerseFreqForPureOrth ?? 850;
  const profByBs = new Map<string, CorpusWordplayInputProfile>();
  const normByBs = new Map<string, NormalizedOriginalForm>();
  const ngramDf = new Map<string, number>();

  for (const p of profiles) {
    if (!p.bs || !p.script) continue;
    profByBs.set(p.bs, p);
    const nf = normalizeOriginalForm(p.script, p.bs);
    normByBs.set(p.bs, nf);
    for (const g of new Set([...nf.ngrams2, ...nf.ngrams3])) {
      ngramDf.set(g, (ngramDf.get(g) || 0) + 1);
    }
  }

  const totalLemmas = Math.max(1, normByBs.size);
  const ngramIdf = new Map<string, number>();
  for (const [g, df] of ngramDf) {
    ngramIdf.set(g, Math.log(totalLemmas / df));
  }

  // Candidate pair accumulators keyed by canonical sorted "A|B"
  const pairMeta = new Map<string, {
    a: string;
    b: string;
    sameVids: number[];
    adjVids: number[];
    sharedRootKey?: string;
    isFormationDerived: boolean;
  }>();

  const ensurePair = (x: string, y: string) => {
    const a = x < y ? x : y;
    const b = x < y ? y : x;
    const k = `${a}|${b}`;
    let entry = pairMeta.get(k);
    if (!entry) {
      entry = { a, b, sameVids: [], adjVids: [], isFormationDerived: false };
      pairMeta.set(k, entry);
    }
    return entry;
  };

  // 1. Exact consonantal, stripped-stem, no-matres, phonetic, and rare n-gram inverted buckets
  const buckets = new Map<string, string[]>();
  const addBucket = (bk: string, bs: string) => {
    let arr = buckets.get(bk);
    if (!arr) { arr = []; buckets.set(bk, arr); }
    arr.push(bs);
  };

  const rootBuckets = new Map<string, string[]>();
  for (const p of profiles) {
    const nf = normByBs.get(p.bs);
    if (!nf) continue;
    for (const rk of p.root_keys || []) {
      let arr = rootBuckets.get(rk);
      if (!arr) { arr = []; rootBuckets.set(rk, arr); }
      arr.push(p.bs);
    }
    for (const ft of p.formation_targets || []) {
      if (profByBs.has(ft) && ft !== p.bs) {
        ensurePair(p.bs, ft).isFormationDerived = true;
      }
    }
    if (WORDPLAY_STOP_STRONGS.has(p.bs) || p.total_verses > maxPureFreq || /^H900/.test(p.bs)) continue;
    const prefix = nf.language;
    if (nf.consonantal.length >= 2) addBucket(`${prefix}:c:${nf.consonantal}`, p.bs);
    if (nf.skeletonNoMatres.length >= 2) addBucket(`${prefix}:m:${nf.skeletonNoMatres}`, p.bs);
    if (nf.strippedAffixStem.length >= 3) addBucket(`${prefix}:s:${nf.strippedAffixStem}`, p.bs);
    if (nf.phoneticClass.length >= 3) addBucket(`${prefix}:p:${nf.phoneticClass}`, p.bs);
    for (const g3 of nf.ngrams3) {
      if ((ngramDf.get(g3) || 0) <= 120) addBucket(`${prefix}:g3:${g3}`, p.bs);
    }
    if (nf.consonantal.length <= 4) {
      for (const g2 of nf.ngrams2) {
        if ((ngramDf.get(g2) || 0) <= 95) addBucket(`${prefix}:g2:${g2}`, p.bs);
      }
    }
  }

  for (const [rk, list] of rootBuckets) {
    if (list.length < 2 || list.length > 40) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const meta = ensurePair(list[i], list[j]);
        if (!meta.sharedRootKey) meta.sharedRootKey = rk;
      }
    }
  }

  const candidatePairs = new Set<string>();
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 140) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i] < list[j] ? list[i] : list[j];
        const b = list[i] < list[j] ? list[j] : list[i];
        candidatePairs.add(`${a}|${b}`);
      }
    }
  }

  // 2. Scan same-verse and +-1 adjacent-verse proximity (catches wordplay even between high-frequency words like H0120/H0127/H1818!)
  if (verseLookup && verseLookup.size > 0) {
    const vidList = [...verseLookup.keys()].sort((x, y) => x - y);
    for (let idx = 0; idx < vidList.length; idx++) {
      const vid = vidList[idx];
      const vCurr = verseLookup.get(vid)!;
      const uniqCurr = [...new Set(vCurr.strongsList)].filter(s => normByBs.has(s) && !/^H900/.test(s) && !WORDPLAY_STOP_STRONGS.has(s));
      // Same-verse pairs
      for (let i = 0; i < uniqCurr.length; i++) {
        const nfA = normByBs.get(uniqCurr[i])!;
        for (let j = i + 1; j < uniqCurr.length; j++) {
          const nfB = normByBs.get(uniqCurr[j])!;
          if (nfA.language !== nfB.language) continue;
          const lcs = longestCommonSubstring(nfA.skeletonNoMatres, nfB.skeletonNoMatres);
          const samePhon = nfA.phoneticClass.length >= 3 && nfA.phoneticClass === nfB.phoneticClass;
          if (lcs.length >= 2 || samePhon) {
            const m = ensurePair(uniqCurr[i], uniqCurr[j]);
            if (m.sameVids.length < 12) m.sameVids.push(vid);
            candidatePairs.add(`${m.a}|${m.b}`);
          }
        }
      }
      // Adjacent-verse (+1) pairs within same book
      const nextVid = vid + 1;
      const vNext = verseLookup.get(nextVid);
      if (vNext && (vNext.book === undefined || vCurr.book === undefined || vNext.book === vCurr.book)) {
        const uniqNext = [...new Set(vNext.strongsList)].filter(s => normByBs.has(s) && !/^H900/.test(s) && !WORDPLAY_STOP_STRONGS.has(s));
        for (const sA of uniqCurr) {
          const nfA = normByBs.get(sA)!;
          for (const sB of uniqNext) {
            if (sA === sB) continue;
            const nfB = normByBs.get(sB)!;
            if (nfA.language !== nfB.language) continue;
            const lcs = longestCommonSubstring(nfA.skeletonNoMatres, nfB.skeletonNoMatres);
            const samePhon = nfA.phoneticClass.length >= 3 && nfA.phoneticClass === nfB.phoneticClass;
            if (lcs.length >= 2 || samePhon) {
              const m = ensurePair(sA, sB);
              if (m.adjVids.length < 12) {
                if (!m.adjVids.includes(vid)) m.adjVids.push(vid);
                if (!m.adjVids.includes(nextVid)) m.adjVids.push(nextVid);
              }
              candidatePairs.add(`${m.a}|${m.b}`);
            }
          }
        }
      }
    }
  }

  // Also ensure same/adjacent proximity counts are populated for formal buckets when verseLookup omitted or partial
  for (const k of candidatePairs) {
    if (!pairMeta.has(k)) {
      const sep = k.indexOf('|');
      ensurePair(k.slice(0, sep), k.slice(sep + 1));
    }
  }

  const edgesByBs = new Map<string, WordplayCandidateEdge[]>();
  const pushDirected = (bs: string, edge: WordplayCandidateEdge) => {
    let arr = edgesByBs.get(bs);
    if (!arr) { arr = []; edgesByBs.set(bs, arr); }
    arr.push(edge);
  };

  for (const meta of pairMeta.values()) {
    const pA = profByBs.get(meta.a);
    const pB = profByBs.get(meta.b);
    const nfA = normByBs.get(meta.a);
    const nfB = normByBs.get(meta.b);
    if (!pA || !pB || !nfA || !nfB) continue;

    const metrics = compareOriginalForms(nfA, nfB, ngramIdf);
    if (!metrics.comparable && !meta.sharedRootKey && !meta.isFormationDerived) continue;

    // Populate proximity from profile vids if not already populated from verse scan
    if (meta.sameVids.length === 0 && meta.adjVids.length === 0 && pA.all_vids.length <= 2000 && pB.all_vids.length <= 2000) {
      const setB = new Set(pB.all_vids);
      for (const vid of pA.all_vids) {
        if (setB.has(vid) && meta.sameVids.length < 8) {
          meta.sameVids.push(vid);
        } else if (setB.has(vid + 1) && meta.adjVids.length < 8) {
          if (!meta.adjVids.includes(vid)) meta.adjVids.push(vid);
          if (!meta.adjVids.includes(vid + 1)) meta.adjVids.push(vid + 1);
        } else if (setB.has(vid - 1) && meta.adjVids.length < 8) {
          if (!meta.adjVids.includes(vid - 1)) meta.adjVids.push(vid - 1);
          if (!meta.adjVids.includes(vid)) meta.adjVids.push(vid);
        }
      }
    }

    const cueSet = new Set<string>();
    let hasOracleBodyVisionCooccurrence = false;
    if (verseLookup) {
      // Only inspect cues in the actual witness verses where both lemmas co-occur (same verse or adjacent pair),
      // never expanding +-1 verse beyond an adjacent pair.
      const witnessCheckVids = [...new Set([...meta.sameVids.slice(0, 3), ...meta.adjVids.slice(0, 4)])];
      const win: VerseWordplayContextInput[] = [];
      for (const vid of witnessCheckVids) {
        const vl = verseLookup.get(vid);
        if (vl) {
          win.push(vl);
          const list = vl.strongsList.map(s => s.toUpperCase());
          const idxSee = list.findIndex(s => s === 'H7200' || s === 'H4100');
          const idxA = list.lastIndexOf(pA.bs);
          const idxB = list.lastIndexOf(pB.bs);
          // Vision object and oracle interpretation follow the "what do you see?" question (or span adjacent verses)
          if (idxA >= 0 && idxB >= 0) {
            if (idxSee < 0 || (idxA > idxSee && idxB > idxSee)) {
              hasOracleBodyVisionCooccurrence = true;
            }
          } else if (idxSee >= 0 && ((idxA > idxSee && idxB < 0) || (idxB > idxSee && idxA < 0))) {
            // Pair spans adjacent verses where the seen vision object sits after "what do you see?" in verse i
            // and the interpretation word sits in verse i+1
            hasOracleBodyVisionCooccurrence = true;
          }
        }
      }
      if (win.length > 0) {
        for (const cue of detectWordplayContextCues(win, nfA.language)) cueSet.add(cue);
      }
    }
    const cueKinds = [...cueSet];

    const forward = classifyPairEdge({
      src: pA,
      tgt: pB,
      normSrc: nfA,
      normTgt: nfB,
      metrics,
      srcConsLen: nfA.consonantal.length,
      tgtConsLen: nfB.consonantal.length,
      sharedRootKey: meta.sharedRootKey,
      isFormationDerived: meta.isFormationDerived,
      sameVerseVids: meta.sameVids,
      adjacentVerseVids: meta.adjVids,
      cueKinds,
      hasOracleBodyVisionCooccurrence,
    });
    if (forward) {
      pushDirected(pA.bs, forward);
      pushDirected(pB.bs, {
        ...forward,
        source_bs: pB.bs,
        target_bs: pA.bs,
        source_script: pB.script,
        target_script: pA.script,
        source_consonants: forward.target_consonants,
        target_consonants: forward.source_consonants,
      });
    }
  }

  for (const [bs, list] of edgesByBs) {
    list.sort((x, y) =>
      Number(y.evidence_type === 'attested_textual_wordplay') - Number(x.evidence_type === 'attested_textual_wordplay') ||
      Number(y.evidence_type === 'proximate_wordplay_candidate') - Number(x.evidence_type === 'proximate_wordplay_candidate') ||
      y.score - x.score ||
      x.target_bs.localeCompare(y.target_bs)
    );
    edgesByBs.set(bs, list.slice(0, maxPerLemma));
  }

  return edgesByBs;
}

export function canonicalStrongsKey(raw: string): string {
  const s = String(raw || '').trim().toUpperCase();
  const m = /^([HG])0*(\d+)([A-Z]?)$/.exec(s);
  return m ? `${m[1]}${m[2]}${m[3]}` : s;
}

export interface WordplayTokenInput {
  id: string;
  verseId: number;
  book?: number;
  ref: string;
  index: number;
  surfaceForm: string;
  transliteration?: string;
  gloss?: string;
  strongs: string;
  lemmaKey?: string;
  lemmaScript?: string;
  grammarCode?: string;
  posClass?: string;
  stem?: string | null;
  isFunctionWord?: boolean;
}

export interface WordplayClauseInput {
  startIndex: number;
  endIndex: number;
  subjectLemmas?: string[];
  objectLemmas?: string[];
}

export interface TalionPolyptotonMatch {
  tokenA: WordplayTokenInput;
  tokenB: WordplayTokenInput;
  kind: 'syntactic_talion' | 'clause_polyptoton';
  sharedStem: string;
  shiftSummary: string;
  cues: string[];
  score: number;
}

const TALION_STOP_STRONGS = new Set([
  'H1961', 'H559', 'H6213', 'H935', 'H1980', 'H5414', 'H1696', 'H7200', 'H3068', 'H430', 'H1121', 'H3117', 'H3605',
  'G1510', 'G3004', 'G1096', 'G4160', 'G2064', 'G2192', 'G2316', 'G2962', 'G444', 'G846',
]);

function extractMorphPolarityFeatures(tok: WordplayTokenInput): {
  voice: 'active' | 'passive' | 'middle' | null;
  tense: string | null;
  posTag: string;
  caseTag: string | null;
} {
  const gc = (tok.grammarCode || '').toUpperCase();
  const pc = (tok.posClass || '').toLowerCase();
  const lang = detectLanguage(tok.surfaceForm, tok.strongs);
  if (lang === 'grc') {
    const vMatch = /^V-([0-9A-Z])([A-Z])([A-Z])/.exec(gc) || /^V-([A-Z])([A-Z])([A-Z])/.exec(gc);
    if (vMatch) {
      const tenseChar = vMatch[1];
      const voiceChar = vMatch[2];
      const voice = voiceChar === 'P' ? 'passive' : voiceChar === 'M' || voiceChar === 'D' ? 'middle' : 'active';
      return { voice, tense: tenseChar, posTag: 'V', caseTag: null };
    }
    const nMatch = /^([NA])-(?:[0-9])?([NGDAV])/.exec(gc);
    if (nMatch) {
      return { voice: null, tense: null, posTag: nMatch[1], caseTag: nMatch[2] };
    }
    if (gc === 'ADV' || pc === 'adverb') {
      return { voice: null, tense: null, posTag: 'ADV', caseTag: 'ADV' };
    }
    return { voice: null, tense: null, posTag: pc || gc, caseTag: null };
  }

  // Hebrew morphhb/ETCBC grammar codes: e.g. HVqrmsc (Qal active), HVNi3ms (Niphal passive), HVP/HVH/HVt
  const stemProp = (tok.stem || '').toLowerCase();
  const hMatch = /V([a-zA-Z])([a-zA-Z])/.exec(tok.grammarCode || '');
  let voice: 'active' | 'passive' | 'middle' | null = null;
  let tense: string | null = null;
  if (hMatch) {
    const stemCode = hMatch[1];
    tense = hMatch[2];
    if (['N', 'P', 'u', 'h', 'O', 'K'].includes(stemCode) || /niphal|pual|hophal|passive/i.test(stemProp)) {
      voice = 'passive';
    } else if (['t', 'M'].includes(stemCode) || /hit/i.test(stemProp)) {
      voice = 'middle';
    } else {
      voice = 'active';
    }
  }
  const nPos = /([NA][a-z])/.exec(tok.grammarCode || '')?.[1] ?? pc;
  let hCaseTag: string | null = null;
  if (!hMatch && /^(?:H?(?:R[^/]*|T[^/]*|C[^/]*)\/)?[NA]/.test(tok.grammarCode || '')) {
    const gcRaw = tok.grammarCode || '';
    const prefMatch = /^H?([RTC][^/]*)\//.exec(gcRaw);
    const stateMatch = /[NA][a-z]{2,3}([ca])/.exec(gcRaw);
    const sufMatch = /\/(Sp[123][mfc][sp])/.exec(gcRaw);
    const parts = [prefMatch ? prefMatch[1] : '', stateMatch ? stateMatch[1] : '', sufMatch ? sufMatch[1] : ''].filter(Boolean);
    if (parts.length) hCaseTag = parts.join(':');
  }
  return { voice, tense, posTag: hMatch ? 'V' : nPos, caseTag: hCaseTag };
}

/**
 * Detect Syntactic Talion & Clause Polyptoton across adjacent condition/consequence,
 * active/passive, mirror case-inversion, or cognate case/POS-shifted pairs (e.g. 1 Cor 3:17, Matt 21:41, Gen 9:6, Mark 2:27).
 */
export function detectSyntacticTalionAndPolyptoton(
  tokens: WordplayTokenInput[],
  clauses?: WordplayClauseInput[],
): TalionPolyptotonMatch[] {
  const out: TalionPolyptotonMatch[] = [];
  const seen = new Set<string>();

  const clauseIdxOf = (tokIndex: number): number => {
    if (!clauses?.length) return -1;
    return clauses.findIndex(c => tokIndex >= c.startIndex && tokIndex <= c.endIndex);
  };

  interface RawCandidatePair {
    i: number;
    j: number;
    a: WordplayTokenInput;
    b: WordplayTokenInput;
    stemA: string;
    morphA: ReturnType<typeof extractMorphPolarityFeatures>;
    morphB: ReturnType<typeof extractMorphPolarityFeatures>;
    sameStrong: boolean;
    sameLemma: boolean;
    isStopStrongs: boolean;
    voiceFlip: boolean;
    tenseFlip: boolean;
    posOrCaseFlip: boolean;
    caseFlipPair: [string, string] | null;
    hasCondMarker: boolean;
    hasContrastMarker: boolean;
    actantFlip: boolean;
    clIdxA: number;
    clIdxB: number;
  }

  const rawPairs: RawCandidatePair[] = [];
  const preTokens = tokens.map((tok, idx) => {
    if (tok.isFunctionWord || !tok.strongs) return null;
    const cs = canonicalStrongsKey(tok.strongs);
    const nf = normalizeOriginalForm(
      tok.surfaceForm,
      tok.strongs,
      tok.grammarCode,
      tok.posClass,
      tok.lemmaScript,
    );
    const stem = nf.strippedAffixStem || nf.consonantal;
    return {
      idx,
      tok,
      cs,
      nf,
      stem,
      morph: extractMorphPolarityFeatures(tok),
      clIdx: clauseIdxOf(tok.index),
      gcUpper: (tok.grammarCode || '').toUpperCase(),
    };
  });

  for (let i = 0; i < preTokens.length; i++) {
    const pA = preTokens[i];
    if (!pA) continue;
    const { tok: a, cs: csA, nf: nfA, stem: stemA, morph: morphA, clIdx: clIdxA, gcUpper: gcA } = pA;
    if (stemA.length < 3 && csA !== 'H1818') continue;

    for (let j = i + 1; j < Math.min(preTokens.length, i + 18); j++) {
      const pB = preTokens[j];
      if (!pB) continue;
      const { tok: b, cs: csB, nf: nfB, stem: stemB, morph: morphB, clIdx: clIdxB, gcUpper: gcB } = pB;
      if (Math.abs(b.verseId - a.verseId) > 1) break;
      if (nfA.language !== nfB.language) continue;

      const sameStrong = csA === csB;
      const sameLemma = Boolean(a.lemmaKey && b.lemmaKey && a.lemmaKey === b.lemmaKey);
      const sameStem = stemA.length >= 3 && stemA === stemB;
      if (!sameStrong && !sameLemma && !sameStem) continue;
      const isStopStrongs = (sameStrong || sameLemma) && TALION_STOP_STRONGS.has(csA);

      if (gcA && gcB && gcA === gcB && nfA.consonantal === nfB.consonantal) continue;
      const voiceFlip = Boolean(
        morphA.voice &&
        morphB.voice &&
        morphA.voice !== morphB.voice &&
        (morphA.voice === 'passive' || morphB.voice === 'passive'),
      );
      const tenseFlip = Boolean(
        morphA.posTag === 'V' &&
        morphB.posTag === 'V' &&
        morphA.tense &&
        morphB.tense &&
        morphA.tense !== morphB.tense,
      );
      const caseFlip = Boolean(morphA.caseTag && morphB.caseTag && morphA.caseTag !== morphB.caseTag);
      const posOrCaseFlip = Boolean(morphA.posTag !== morphB.posTag || caseFlip);
      if (!voiceFlip && !tenseFlip && !posOrCaseFlip) continue;

      // Check conditional / talion & contrast markers in window [i-6 .. j+2]
      const winStart = Math.max(0, i - 6);
      const winEnd = Math.min(tokens.length, j + 3);
      const winSlice = tokens.slice(winStart, winEnd);
      const hasCondMarker = winSlice
        .some(t => ['G1487', 'G1437', 'G3739', 'H3588', 'H518', 'H834'].includes(canonicalStrongsKey(t.strongs)));
      const hasContrastMarker = tokens
        .slice(i + 1, j)
        .some(t => ['G3756', 'G3361', 'G235', 'G1223', 'H3808', 'H408', 'H369'].includes(canonicalStrongsKey(t.strongs)));

      // Check clause subject/object actant swap when clauses are provided
      let actantFlip = false;
      if (clauses && clIdxA >= 0 && clIdxB >= 0 && clIdxA !== clIdxB) {
        const cA = clauses[clIdxA];
        const cB = clauses[clIdxB];
        const subjA = new Set(cA.subjectLemmas || []);
        const objA = new Set(cA.objectLemmas || []);
        const subjB = new Set(cB.subjectLemmas || []);
        const objB = new Set(cB.objectLemmas || []);
        actantFlip =
          [...subjA].some(s => objB.has(s)) ||
          [...objA].some(o => subjB.has(o)) ||
          (subjA.size > 0 && subjB.size > 0 && [...subjA].every(s => !subjB.has(s)));
      }

      rawPairs.push({
        i,
        j,
        a,
        b,
        stemA,
        morphA,
        morphB,
        sameStrong,
        sameLemma,
        isStopStrongs,
        voiceFlip,
        tenseFlip,
        posOrCaseFlip,
        caseFlipPair: caseFlip ? [morphA.caseTag!, morphB.caseTag!] : null,
        hasCondMarker,
        hasContrastMarker,
        actantFlip,
        clIdxA,
        clIdxB,
      });
    }
  }

  // Detect mirrored nominal case-inversions within the same verse (e.g., Mark 2:27 N->A paired with A->N)
  const mirrorIndices = new Set<number>();
  for (let p = 0; p < rawPairs.length; p++) {
    const rp1 = rawPairs[p];
    if (!rp1.caseFlipPair || rp1.a.verseId !== rp1.b.verseId) continue;
    const [c1A, c1B] = rp1.caseFlipPair;
    for (let q = p + 1; q < rawPairs.length; q++) {
      const rp2 = rawPairs[q];
      if (!rp2.caseFlipPair || rp2.a.verseId !== rp1.a.verseId || rp2.b.verseId !== rp1.a.verseId) continue;
      if (rp1.a.strongs === rp2.a.strongs) continue;
      const [c2A, c2B] = rp2.caseFlipPair;
      const reversed = c1A === c2B && c1B === c2A;
      const interleaved =
        (rp1.i < rp2.i && rp2.j < rp1.j) ||
        (rp1.i < rp2.i && rp2.i < rp1.j && rp1.j < rp2.j);
      if (reversed && interleaved && (rp1.hasContrastMarker || rp2.hasContrastMarker || rp1.clIdxA !== rp1.clIdxB)) {
        mirrorIndices.add(p);
        mirrorIndices.add(q);
      }
    }
  }

  for (let p = 0; p < rawPairs.length; p++) {
    const rp = rawPairs[p];
    const isMirrorCaseInversion = mirrorIndices.has(p);
    if (rp.isStopStrongs && !isMirrorCaseInversion) continue;

    const isAdjacentCognatePolyptoton = rp.j - rp.i <= 2 && (rp.posOrCaseFlip || rp.tenseFlip || rp.voiceFlip);
    const isTalion =
      isMirrorCaseInversion ||
      (rp.voiceFlip && (rp.sameStrong || rp.sameLemma)) ||
      (rp.tenseFlip && (rp.sameStrong || rp.sameLemma) && (rp.hasCondMarker || rp.actantFlip || rp.j - rp.i <= 4)) ||
      (rp.actantFlip && (rp.voiceFlip || rp.tenseFlip));

    if (!isTalion && !isAdjacentCognatePolyptoton) continue;

    const pairId = `${rp.a.id}|${rp.b.id}`;
    if (seen.has(pairId)) continue;
    seen.add(pairId);

    const kind: TalionPolyptotonMatch['kind'] = isTalion ? 'syntactic_talion' : 'clause_polyptoton';
    const cues: string[] = [kind];
    if (rp.voiceFlip) cues.push('voice_inversion');
    if (rp.tenseFlip) cues.push('tense_aspect_shift');
    if (rp.posOrCaseFlip) cues.push('case_pos_polyptoton');
    if (isMirrorCaseInversion) cues.push('mirror_case_inversion');
    if (rp.actantFlip) cues.push('actant_role_flip');

    const shiftSummary = [
      rp.voiceFlip ? `${rp.morphA.voice}->${rp.morphB.voice}` : '',
      rp.tenseFlip ? `${rp.morphA.tense}->${rp.morphB.tense}` : '',
      rp.posOrCaseFlip ? `${rp.morphA.caseTag || rp.morphA.posTag}->${rp.morphB.caseTag || rp.morphB.posTag}` : '',
    ]
      .filter(Boolean)
      .join(', ');

    out.push({
      tokenA: rp.a,
      tokenB: rp.b,
      kind,
      sharedStem: rp.stemA,
      shiftSummary,
      cues,
      score: Math.min(
        0.98,
        Math.round(
          (0.82 +
            (rp.voiceFlip ? 0.1 : 0) +
            (isMirrorCaseInversion ? 0.11 : 0) +
            (rp.actantFlip ? 0.05 : 0) +
            (rp.j - rp.i <= 3 ? 0.04 : 0)) *
            1000,
        ) / 1000,
      ),
    });
  }

  return out;
}

export interface OnomasticEtymologyEntry {
  strongs: string;
  rootStrongs: string[];
  rootConsonants: string;
  etyGlosses: string[];
  synonyms: string[];
  antonyms: string[];
  valence: -1 | 0 | 1;
  source: string;
}

/**
 * Documented CC BY 4.0 (OSHB HebrewStrong.xml + STEP TBESG/TBESH + OEWN 2025) proper-noun
 * etymologies and semantic polarity for runtime analysis without requiring external 72 MB WordNet files.
 * Build pipelines (`build-v3-rhetoric.mjs`) extend this dynamically across the full corpus lexicon.
 */
export const BUILTIN_ONOMASTIC_LEXICON: Readonly<Record<string, OnomasticEtymologyEntry>> = {
  G3682: {
    strongs: 'G3682',
    rootStrongs: ['G3685', 'G8518'],
    rootConsonants: 'ον',
    etyGlosses: ['profitable', 'useful', 'profit', 'benefit'],
    synonyms: ['useful', 'helpful', 'profitable', 'beneficial', 'serviceable'],
    antonyms: ['useless', 'unprofitable', 'worthless', 'unserviceable'],
    valence: 1,
    source: 'TBESG:G3682',
  },
  G4074: {
    strongs: 'G4074',
    rootStrongs: ['G4073'],
    rootConsonants: 'πετρ',
    etyGlosses: ['stone', 'rock'],
    synonyms: ['stone', 'rock'],
    antonyms: [],
    valence: 0,
    source: 'TBESG:G4074G',
  },
  H8208: {
    strongs: 'H8208',
    rootStrongs: ['H8231', 'H8233'],
    rootConsonants: 'שפר',
    etyGlosses: ['beautiful', 'fair', 'pleasant', 'goodly'],
    synonyms: ['beautiful', 'fair', 'pleasant', 'goodly', 'comely'],
    antonyms: ['ugly', 'shame', 'shameful', 'nakedness', 'disgrace', 'foul'],
    valence: 1,
    source: 'OSHB:H8208',
  },
  H4796: {
    strongs: 'H4796',
    rootStrongs: ['H4751', 'H4843'],
    rootConsonants: 'מר',
    etyGlosses: ['bitter', 'bitterness', 'bitter springs'],
    synonyms: ['bitter', 'bitterness', 'sorrow', 'grief', 'calamity', 'evil'],
    antonyms: ['good', 'sweet', 'pleasant', 'joy', 'gladness'],
    valence: -1,
    source: 'OSHB:H4796',
  },
  H392: {
    strongs: 'H392',
    rootStrongs: ['H391', 'H3576'],
    rootConsonants: 'כזב',
    etyGlosses: ['deceitful', 'lying', 'deception'],
    synonyms: ['deceitful', 'deceptive', 'lying', 'false', 'vain'],
    antonyms: ['truth', 'faithful', 'true'],
    valence: -1,
    source: 'OSHB:H392',
  },
  H1036: {
    strongs: 'H1036',
    rootStrongs: ['H1004', 'H6083'],
    rootConsonants: 'עפר',
    etyGlosses: ['house of dust', 'dust'],
    synonyms: ['dust', 'ash', 'earth'],
    antonyms: [],
    valence: -1,
    source: 'OSHB:H1036',
  },
  H4762: {
    strongs: 'H4762',
    rootStrongs: ['H4761', 'H3423'],
    rootConsonants: 'רש',
    etyGlosses: ['summit', 'possession', 'heir'],
    synonyms: ['heir', 'possessor', 'dispossess', 'inheritance'],
    antonyms: [],
    valence: 0,
    source: 'OSHB:H4762',
  },
  H6630: {
    strongs: 'H6630',
    rootStrongs: ['H6629', 'H3318'],
    rootConsonants: 'צאנ',
    etyGlosses: ['sheep pasture', 'flock', 'go out'],
    synonyms: ['flock', 'sheep', 'exit', 'go out'],
    antonyms: [],
    valence: 0,
    source: 'OSHB:H6630',
  },
  H1018: {
    strongs: 'H1018',
    rootStrongs: ['H1004', 'H681'],
    rootConsonants: 'אצל',
    etyGlosses: ['house of the side', 'near', 'taking away'],
    synonyms: ['side', 'near', 'take away'],
    antonyms: [],
    valence: 0,
    source: 'OSHB:H1018',
  },
  H5037: {
    strongs: 'H5037',
    rootStrongs: ['H5036', 'H5039'],
    rootConsonants: 'נבל',
    etyGlosses: ['fool', 'dolt', 'folly'],
    synonyms: ['fool', 'foolish', 'folly', 'senseless', 'vile'],
    antonyms: ['wise', 'wisdom', 'discreet', 'understanding'],
    valence: -1,
    source: 'OSHB:H5037',
  },
  H5146: {
    strongs: 'H5146',
    rootStrongs: ['H5162', 'H5117'],
    rootConsonants: 'נח',
    etyGlosses: ['rest', 'comfort'],
    synonyms: ['rest', 'comfort', 'quiet'],
    antonyms: ['toil', 'labor', 'affliction'],
    valence: 1,
    source: 'OSHB:H5146',
  },
  H120: {
    strongs: 'H120',
    rootStrongs: ['H127', 'H119'],
    rootConsonants: 'אדם',
    etyGlosses: ['humankind', 'red', 'ground'],
    synonyms: ['ground', 'earth', 'dust', 'red'],
    antonyms: [],
    valence: 0,
    source: 'OSHB:H120',
  },
  H3819: {
    strongs: 'H3819',
    rootStrongs: ['H3808', 'H5971'],
    rootConsonants: 'עמי',
    etyGlosses: ['not my people'],
    synonyms: ['not my people', 'rejected'],
    antonyms: ['my people', 'beloved'],
    valence: -1,
    source: 'OSHB:H3819',
  },
  H3818: {
    strongs: 'H3818',
    rootStrongs: ['H3808', 'H7355'],
    rootConsonants: 'רחם',
    etyGlosses: ['not pitied', 'no mercy'],
    synonyms: ['no mercy', 'unpitied'],
    antonyms: ['mercy', 'compassion', 'pity'],
    valence: -1,
    source: 'OSHB:H3818',
  },
};

const POSITIVE_VALENCE_TOKENS = new Set([
  'good', 'beautiful', 'fair', 'pleasant', 'useful', 'helpful', 'profitable', 'profit', 'benefit',
  'joy', 'gladness', 'blessing', 'blessed', 'sweet', 'honor', 'honour', 'glory', 'wise', 'wisdom',
  'righteous', 'holy', 'love', 'beloved', 'mercy', 'compassion', 'comfort', 'rest', 'heal', 'life',
  'clean', 'pure', 'peace', 'salvation', 'grace', 'truth', 'faithful', 'delight', 'worthy',
]);

const NEGATIVE_VALENCE_TOKENS = new Set([
  'bad', 'evil', 'wicked', 'ugly', 'foul', 'useless', 'unprofitable', 'worthless', 'bitter',
  'bitterness', 'shame', 'shameful', 'nakedness', 'disgrace', 'dishonor', 'sorrow', 'grief',
  'pain', 'calamity', 'curse', 'cursed', 'fool', 'foolish', 'folly', 'deceit', 'deceitful',
  'lying', 'false', 'vain', 'empty', 'sin', 'iniquity', 'transgression', 'death', 'destroy',
  'defiled', 'unclean', 'trouble', 'affliction', 'woe', 'lament', 'mourning', 'weep',
]);

export function scoreGlossValence(gloss: string): -1 | 0 | 1 {
  if (!gloss) return 0;
  const words = gloss.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
  let pos = 0;
  let neg = 0;
  for (const w of words) {
    if (POSITIVE_VALENCE_TOKENS.has(w)) pos++;
    if (NEGATIVE_VALENCE_TOKENS.has(w)) neg++;
  }
  if (pos > neg) return 1;
  if (neg > pos) return -1;
  return 0;
}

export interface OnomasticValenceMatch {
  properToken: WordplayTokenInput;
  targetToken: WordplayTokenInput;
  etymology: OnomasticEtymologyEntry;
  matchChannel: 'etymological_root' | 'etymological_synonym_antonym' | 'evaluative_valence_contrast';
  sharedConsonants: string;
  cues: string[];
  score: number;
}

/**
 * Resolve proper nouns within a ±10-verse window against etymological glosses/roots,
 * OEWN synonyms/antonyms, and evaluative valence (+1 vs -1).
 */
export function detectOnomasticValenceWordplays(
  tokens: WordplayTokenInput[],
  customLexicon?: ReadonlyMap<string, OnomasticEtymologyEntry> | Readonly<Record<string, OnomasticEtymologyEntry>>,
  customValenceMap?: ReadonlyMap<string, -1 | 0 | 1>,
): OnomasticValenceMatch[] {
  const out: OnomasticValenceMatch[] = [];
  const seen = new Set<string>();

  const lookupEntry = (strongs: string): OnomasticEtymologyEntry | undefined => {
    const cs = canonicalStrongsKey(strongs);
    if (!cs) return undefined;
    if (customLexicon instanceof Map) {
      return customLexicon.get(cs) ?? BUILTIN_ONOMASTIC_LEXICON[cs];
    }
    if (customLexicon && typeof customLexicon === 'object') {
      const rec = customLexicon as Record<string, OnomasticEtymologyEntry>;
      return rec[cs] ?? BUILTIN_ONOMASTIC_LEXICON[cs];
    }
    return BUILTIN_ONOMASTIC_LEXICON[cs];
  };

  let sortedByVid = true;
  for (let k = 1; k < tokens.length; k++) {
    if (tokens[k].verseId < tokens[k - 1].verseId) {
      sortedByVid = false;
      break;
    }
  }

  const tgtCache = new Array<{ words: string[]; valence: -1 | 0 | 1 } | undefined>(tokens.length);
  const getTgtMeta = (idx: number, tgt: WordplayTokenInput) => {
    let m = tgtCache[idx];
    if (!m) {
      const words = (tgt.gloss || '')
        .toLowerCase()
        .replace(/[^a-z\s-]/g, ' ')
        .split(/[\s-]+/)
        .filter(w => w.length >= 3);
      const csTgt = canonicalStrongsKey(tgt.strongs);
      const valence = customValenceMap?.get(csTgt) ?? scoreGlossValence(tgt.gloss || '');
      m = { words, valence };
      tgtCache[idx] = m;
    }
    return m;
  };

  for (let i = 0; i < tokens.length; i++) {
    const pn = tokens[i];
    if (!pn.strongs) continue;
    const csPn = canonicalStrongsKey(pn.strongs);
    const entry = lookupEntry(csPn);
    if (!entry) continue;

    const rootSet = new Set(entry.rootStrongs.map(canonicalStrongsKey));
    const synSet = new Set(entry.synonyms.map(s => s.toLowerCase()));
    const antSet = new Set(entry.antonyms.map(s => s.toLowerCase()));

    let winStart = 0;
    let winEnd = tokens.length;
    if (sortedByVid) {
      winStart = i;
      while (winStart > 0 && pn.verseId - tokens[winStart - 1].verseId <= 10) winStart--;
      winEnd = i + 1;
      while (winEnd < tokens.length && tokens[winEnd].verseId - pn.verseId <= 10) winEnd++;
    }

    for (let j = winStart; j < winEnd; j++) {
      if (i === j) continue;
      const tgt = tokens[j];
      if (tgt.isFunctionWord || !tgt.strongs) continue;
      if (pn.book !== undefined && tgt.book !== undefined && pn.book !== tgt.book) continue;
      const verseDiff = Math.abs(tgt.verseId - pn.verseId);
      if (verseDiff > 10) continue;

      const csTgt = canonicalStrongsKey(tgt.strongs);
      if (csTgt === csPn) continue;
      // Do not pair unrelated high-frequency discourse words on valence alone
      if (TALION_STOP_STRONGS.has(csTgt)) continue;

      const pairKey = [csPn, csTgt].sort().join('|');
      if (seen.has(pairKey)) continue;

      const { words: tgtGlossWords, valence: tgtValence } = getTgtMeta(j, tgt);

      let matchChannel: OnomasticValenceMatch['matchChannel'] | null = null;
      let score = 0;
      const cues: string[] = ['onomastic_etymology'];

      if (rootSet.has(csTgt)) {
        matchChannel = 'etymological_root';
        score = Math.max(0.82, 0.95 - verseDiff * 0.01);
        cues.push('etymological_root_match');
      } else if (tgtGlossWords.some(w => antSet.has(w))) {
        matchChannel = 'etymological_synonym_antonym';
        score = Math.max(0.78, 0.92 - verseDiff * 0.012);
        cues.push('etymological_antonym');
      } else if (tgtGlossWords.some(w => synSet.has(w))) {
        matchChannel = 'etymological_synonym_antonym';
        score = Math.max(0.75, 0.88 - verseDiff * 0.012);
        cues.push('etymological_synonym');
      } else if (
        entry.valence !== 0 &&
        tgtValence !== 0 &&
        entry.valence === -tgtValence &&
        verseDiff === 0 &&
        Math.abs(tgt.index - pn.index) <= 6
      ) {
        matchChannel = 'evaluative_valence_contrast';
        score = 0.86;
        cues.push('evaluative_valence_contrast');
      }

      if (!matchChannel) continue;
      seen.add(pairKey);

      out.push({
        properToken: pn,
        targetToken: tgt,
        etymology: entry,
        matchChannel,
        sharedConsonants: entry.rootConsonants,
        cues,
        score: Math.round(score * 1000) / 1000,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}
