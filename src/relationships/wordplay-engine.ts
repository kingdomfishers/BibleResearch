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
  | 'consonantal_subsequence_only';

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

const HEBREW_PREFIXES = new Set(['ה', 'ו', 'מ', 'ל', 'ב', 'כ', 'ש', 'ת', 'י', 'נ']);
const HEBREW_SUFFIXES = ['ים', 'ות', 'ת', 'ה', 'י', 'נ', 'כ', 'ו'];

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

function stripOrdinaryHebrewAffixes(cons: string): string {
  let s = cons;
  for (const suf of HEBREW_SUFFIXES) {
    if (s.length - suf.length >= 3 && s.endsWith(suf)) {
      s = s.slice(0, s.length - suf.length);
      break;
    }
  }
  if (s.length >= 4 && HEBREW_PREFIXES.has(s[0])) {
    s = s.slice(1);
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

export function normalizeOriginalForm(script: string, strongsHint?: string): NormalizedOriginalForm {
  const language = detectLanguage(script, strongsHint);
  if (language === 'grc') {
    const clean = stripGreekLetters(script);
    let phon = '';
    for (const ch of clean) {
      const cls = GREEK_PHONETIC_CLASS[ch] || ch;
      if (cls === 'V' && phon.endsWith('V')) continue;
      phon += cls;
    }
    const strippedAffixStem = clean.replace(/(οσ|ον|ησ|ω|ειν|εσθαι|μαι)$/, '');
    const stem = strippedAffixStem.length >= 3 ? strippedAffixStem : clean;
    return {
      script,
      language,
      consonantal: clean,
      consonantalWithSinDot: clean,
      skeletonNoMatres: stem,
      strippedAffixStem: stem,
      phoneticClass: phon.replace(/V/g, '') || phon,
      ngrams2: buildNgrams(clean, 2),
      ngrams3: buildNgrams(clean, 3),
    };
  }

  const cons = stripHebrewConsonants(script, false);
  const consDot = stripHebrewConsonants(script, true);
  const noMatres = collapseMatresHebrew(cons);
  const stripped = stripOrdinaryHebrewAffixes(noMatres.length >= 3 ? noMatres : cons);
  let phon = '';
  for (const ch of noMatres) {
    phon += HEBREW_PHONETIC_CLASS[ch] || ch;
  }
  return {
    script,
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
  const cA = a.consonantal;
  const cB = b.consonantal;
  if (cA.length < 2 || cB.length < 2) return empty;

  const minLen = Math.min(cA.length, cB.length);
  const maxLen = Math.max(cA.length, cB.length);
  const lcs = longestCommonSubstring(cA, cB);
  const noMatresLcs = longestCommonSubstring(a.skeletonNoMatres, b.skeletonNoMatres);
  const bestLcs = noMatresLcs.length > lcs.length ? noMatresLcs : lcs;

  const editDist = weightedConsonantalDistance(cA, cB, a.language);
  const noMatresDist = weightedConsonantalDistance(a.skeletonNoMatres, b.skeletonNoMatres, a.language);
  const bestEdit = Math.min(editDist, noMatresDist);

  const phonDist = weightedConsonantalDistance(a.phoneticClass, b.phoneticClass, a.language);
  const metathesis = isConsonantalMetathesis(cA, cB) || isConsonantalMetathesis(a.skeletonNoMatres, b.skeletonNoMatres);

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

  if (cA === cB) {
    overlapKind = 'consonantal_exact';
    baseFormal = 0.96;
  } else if (a.skeletonNoMatres === b.skeletonNoMatres && a.skeletonNoMatres.length >= 2) {
    overlapKind = 'consonantal_exact';
    baseFormal = 0.9;
  } else if (metathesis) {
    overlapKind = 'metathesis';
    baseFormal = 0.78;
  } else if (a.strippedAffixStem === b.strippedAffixStem && a.strippedAffixStem.length >= 3) {
    overlapKind = 'prefix_suffix_overlap';
    baseFormal = 0.84;
  } else if ((cA.includes(cB) || cB.includes(cA)) && minLen >= 2 && maxLen - minLen <= 2) {
    overlapKind = minLen >= 3 ? 'prefix_suffix_overlap' : 'shared_consonantal_substring';
    baseFormal = minLen >= 3 ? 0.8 : 0.72;
  } else if (bestLcs.length >= 3 || (bestLcs.length === 2 && minLen <= 3 && maxLen <= 4 && bestEdit <= 1.5)) {
    overlapKind = bestLcs.length >= 3 ? 'shared_consonantal_substring' : 'edit_distance_1';
    baseFormal = bestLcs.length >= 3 ? 0.68 : 0.56;
  } else if (bestEdit <= 1.0 && minLen >= 3) {
    overlapKind = 'edit_distance_1';
    baseFormal = 0.64;
  } else if (
    phonDist <= 0.6 &&
    Math.min(a.phoneticClass.length, b.phoneticClass.length) >= 3 &&
    Math.abs(a.phoneticClass.length - b.phoneticClass.length) <= 1
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

const HEBREW_CAUSAL_WORDPLAY_STRONGS = new Set([
  'H3588', // ki (for/because)
  'H3651', // ken / al-ken (therefore)
  'H7121', // qara (call/name)
  'H8034', // shem (name)
  'H4100', // mah (what?)
  'H7200', // ra'ah (see — prophetic vision Q&A)
  'H3190', // yatab (well-seen / good)
  'H4480', // min (out of / from)
]);

const GREEK_CAUSAL_WORDPLAY_STRONGS = new Set([
  'G1063', // gar (for)
  'G3754', // hoti (because/for)
  'G1510', // eimi (copula / identification)
  'G3004', // lego (say/call)
  'G3686', // onoma (name)
  'G2564', // kaleo (call)
]);

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

  if (language === 'hbo') {
    if (allStrongs.has('H4100') && allStrongs.has('H7200')) cues.add('prophetic_vision_qa');
    if (allStrongs.has('H7121') && allStrongs.has('H8034')) cues.add('naming_etiological_formula');
    if (allStrongs.has('H3588') || allStrongs.has('H3651')) cues.add('explanatory_particle');
    for (const s of allStrongs) {
      if (HEBREW_CAUSAL_WORDPLAY_STRONGS.has(s) && s === 'H4480') cues.add('derivation_origin_preposition');
    }
    if (/\b(?:therefore|because|for i|called (?:his|her|its) name|what do you see)\b/.test(combinedEn)) {
      cues.add('explanatory_clause_cue');
    }
  } else {
    for (const s of allStrongs) {
      if (GREEK_CAUSAL_WORDPLAY_STRONGS.has(s)) {
        if (s === 'G1510') cues.add('identification_copula');
        else if (s === 'G3686' || s === 'G2564') cues.add('naming_formula');
        else cues.add('explanatory_particle');
      }
    }
    if (/\b(?:which is|that is to say|called|for|because)\b/.test(combinedEn)) {
      cues.add('explanatory_clause_cue');
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

function classifyPairEdge(params: {
  src: CorpusWordplayInputProfile;
  tgt: CorpusWordplayInputProfile;
  metrics: WordplayPairMetrics;
  sharedRootKey?: string;
  isFormationDerived: boolean;
  sameVerseVids: number[];
  adjacentVerseVids: number[];
  cueKinds: string[];
}): WordplayCandidateEdge | null {
  const { src, tgt, metrics, sharedRootKey, isFormationDerived, sameVerseVids, adjacentVerseVids, cueKinds } = params;
  const provenRoot = Boolean(sharedRootKey || isFormationDerived);
  const proxSame = sameVerseVids.length;
  const proxAdj = adjacentVerseVids.length;
  const hasCue = cueKinds.length > 0 && (proxSame > 0 || proxAdj > 0);
  const witnessVids = [...new Set([...sameVerseVids, ...adjacentVerseVids])].slice(0, 6);

  if (!metrics.comparable && !provenRoot) return null;

  // Noise suppression: require strong formal match unless proximate wordplay or documented root
  if (!provenRoot && proxSame === 0 && proxAdj === 0 && metrics.formal_score < 0.7) {
    return null;
  }
  // Common 2-letter lemmas only qualify if same/adjacent-verse proximate OR documented root OR exact consonantal match
  const minConsLen = Math.min(
    stripHebrewConsonants(src.script).length || stripGreekLetters(src.script).length,
    stripHebrewConsonants(tgt.script).length || stripGreekLetters(tgt.script).length,
  );
  if (minConsLen <= 2 && !provenRoot && proxSame === 0 && proxAdj === 0 && metrics.overlap_kind !== 'consonantal_exact') {
    return null;
  }

  let evidenceType: WordplayEvidenceType;
  let overlapKind: WordplayOverlapKind = metrics.overlap_kind;
  let epistemic: WordplayCandidateEdge['epistemic_class'];

  if (
    metrics.comparable &&
    ((hasCue && (proxSame > 0 || proxAdj > 0) && metrics.formal_score >= 0.72) ||
      ((proxSame > 0 || proxAdj > 0) && metrics.overlap_kind === 'consonantal_exact' && Math.min(src.total_verses, tgt.total_verses) <= 400))
  ) {
    evidenceType = 'attested_textual_wordplay';
    overlapKind = hasCue ? 'documented_biblical_wordplay' : metrics.overlap_kind;
    epistemic = 'direct_textual_evidence';
  } else if (metrics.comparable && (proxSame > 0 || proxAdj > 0) && metrics.formal_score >= 0.65) {
    evidenceType = 'proximate_wordplay_candidate';
    epistemic = 'candidate_literary_pattern';
  } else if (isFormationDerived) {
    evidenceType = 'morphological_derivation';
    overlapKind = 'shared_root';
    epistemic = 'documented_lexical_relationship';
  } else if (sharedRootKey) {
    evidenceType = 'documented_root_family';
    overlapKind = 'shared_root';
    epistemic = 'documented_lexical_relationship';
  } else if (metrics.overlap_kind === 'phonetic_similarity') {
    evidenceType = 'phonetic_similarity';
    epistemic = 'orthographic_similarity_only';
  } else {
    evidenceType = 'shared_consonantal_pattern';
    epistemic = 'orthographic_similarity_only';
  }

  const rarityFactor = 1 / Math.log2(4 + Math.min(src.total_verses, tgt.total_verses) * 0.25);
  const proxBoost = proxSame * 0.16 + proxAdj * 0.22 + (hasCue ? 0.28 : 0);
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
    ...(sharedRootKey ? { shared_root_key: sharedRootKey } : {}),
    shared_consonants: metrics.shared_consonants,
    source_consonants: stripHebrewConsonants(src.script) || stripGreekLetters(src.script),
    target_consonants: stripHebrewConsonants(tgt.script) || stripGreekLetters(tgt.script),
    edit_distance: metrics.edit_distance,
    phonetic_distance: metrics.phonetic_distance,
    idf_overlap: metrics.idf_overlap,
    proximity_same_verse: proxSame,
    proximity_adjacent_verse: proxAdj,
    has_explicit_cue: hasCue,
    cue_kinds: cueKinds,
    witness_vids: witnessVids,
    score,
    etymology_disclaimer: provenRoot
      ? 'Documented in STEP lexical root/formation records; shared derivation still does not guarantee identical contextual meaning.'
      : ETYMOLOGY_DISCLAIMER,
  };
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
              if (m.adjVids.length < 12) m.adjVids.push(vid);
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
        if (setB.has(vid) && meta.sameVids.length < 8) meta.sameVids.push(vid);
        else if ((setB.has(vid + 1) || setB.has(vid - 1)) && meta.adjVids.length < 8) meta.adjVids.push(vid);
      }
    }

    const cueSet = new Set<string>();
    if (verseLookup) {
      for (const vid of [...meta.sameVids.slice(0, 3), ...meta.adjVids.slice(0, 3)]) {
        const win: VerseWordplayContextInput[] = [];
        for (let dv = -1; dv <= 1; dv++) {
          const vl = verseLookup.get(vid + dv);
          if (vl) win.push(vl);
        }
        for (const cue of detectWordplayContextCues(win, nfA.language)) cueSet.add(cue);
      }
    }
    const cueKinds = [...cueSet];

    const forward = classifyPairEdge({
      src: pA,
      tgt: pB,
      metrics,
      sharedRootKey: meta.sharedRootKey,
      isFormationDerived: meta.isFormationDerived,
      sameVerseVids: meta.sameVids,
      adjacentVerseVids: meta.adjVids,
      cueKinds,
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
