/**
 * R10 Biblical Concept, Motif & Typology Discovery Runtime Engine
 * Upgraded to power Universal R11 Discovery Engine (`r11-v1.0`).
 * Runs identically in Cloudflare Workers (via AssetReader) and Node.js tests.
 * Two-stage bounded execution:
 *   Stage 1: Parse NL / concept lists / refs -> resolve original-language & motif/event candidates
 *   Stage 1.5: Parallel bounded profile loading from sharded `lemma-profiles`
 *   Stage 2: Universal evidence synthesis, dynamic clusters, grammatical relations, LXX bridges,
 *            lexical formations, cross-references, multi-concept intersections, complete occurrence pagination.
 */

import { fnv1a64Hex, computeBucketHex } from './adjacency-loader.ts';
import type { AssetReader } from './adjacency-loader.ts';
import { beamSearchMotifPaths, type RuntimeBeamProfile } from './motif-discovery.ts';
import { assembleSymbolicChains, type SelfInterpretationRecord } from './symbolic-patterns.ts';
import {
  fuseMultichannelCandidatesRrf,
  type DiscoveryChannelName,
  type MultichannelCandidateEntry,
} from './tesserae-retrieval.ts';
import { blockMaxWandTopK, lookupCsrEdges, lookupPprTop64, NUM_VERSES, type PprEntry } from './v3-binary-index.ts';
import { isLxxFunctionEquivalent } from './epistemic-taxonomy.ts';
import { isVerifiedAttestedWordplayEdge } from './wordplay-engine.ts';
import {
  computeEPerpScore,
  reconstructPassagePpr,
  type PassagePprAnchorTerm,
} from './v3-scorer.ts';
import {
  alignClauseSequencesPiecewise,
  alignTriTextualQuote,
  alignTriTextualQuoteV4,
  type ClauseSig,
} from './v3-verifiers.ts';
import {
  V3RuntimeSession,
  buildClauseSigsFromV3Verse,
  buildNtTokensFromV3Verse,
  buildOtCandidateFromV3,
  findV3BridgePivots,
  normStrongs4,
} from './v3-runtime-adapter.ts';
import { queryRmacCandidates } from './v4-rmac-index.ts';
import { evaluateSmePair } from './v4-sme-engine.ts';
import { makeSmeEvidenceId } from './v4-epistemic-algebra.ts';

const SELF_INTERP_INDEX_CACHE = new WeakMap<any[], { byStrongs: Map<string, any[]>; byVid: Map<number, any[]> }>();

const WORDPLAY_DISCLAIMER =
  'Shared consonantal or phonetic pattern does not establish a historical etymology, common root, or intentional authorial link unless independently documented.';
import type {
  ConnectionEvidenceResult,
  DiscoverConnectionsQuery,
  DiscoverConnectionsResult,
  ExpandConnectionResult,
  R10Cluster,
  R10ClusterBridge,
  R10ConnectionPath,
  R10ConnectionSummary,
  R10ControlOrWarning,
  R10EpistemicClass,
  R10EvidenceRecord,
  R10EvidenceTier,
  R10Node,
  R10NumberKind,
  R10OriginalWordRef,
  R10PassageRef,
  R10Predicate,
  R10QueryIntent,
  R10ResolvedConcept,
  R13ScoreBreakdown,
  V3ScoreMeta,
} from './r10-types.ts';

export const DEFAULT_R10_RELEASE = 'r11-v1.0';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MAX_SUBREQUEST_BUDGET = 45;
const MAX_EVIDENCE_BOOKS = 8;

const BOOK_VID_STARTS = [
  1, 1534, 2747, 3606, 4894, 5853, 6511, 7129, 7214, 8024,
  8719, 9535, 10254, 11196, 12018, 12298, 12704, 12871, 13941, 16518,
  17433, 17655, 17772, 19064, 20428, 20582, 21855, 22212, 22409, 22482,
  22628, 22649, 22697, 22802, 22849, 22905, 22958, 22996, 23207, 23262,
  24330, 25003, 26152, 27030, 28033, 28465, 28902, 29158, 29307, 29462,
  29566, 29661, 29750, 29797, 29910, 29993, 30039, 30064, 30367, 30475,
  30580, 30641, 30746, 30759, 30774, 30799,
];

function bookForVid(vid: number): number {
  if (vid < 1) return 1;
  for (let i = BOOK_VID_STARTS.length - 1; i >= 0; i--) {
    if (vid >= BOOK_VID_STARTS[i]) return i + 1;
  }
  return 1;
}

const TIER_BASE_SCORE: Record<R10EvidenceTier, number> = {
  1: 950,
  2: 860,
  3: 760,
  4: 650,
  5: 520,
  6: 380,
  7: 240,
  8: 140,
};

const QUERY_STOPWORDS = new Set([
  'how', 'do', 'does', 'did', 'what', 'which', 'who', 'where', 'when', 'why',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'into', 'on', 'upon',
  'with', 'between', 'from', 'for', 'by', 'as', 'at', 'through', 'about',
  'there', 'this', 'that', 'these', 'those', 'their', 'his', 'her', 'its',
  'connect', 'connects', 'connected', 'connection', 'connections', 'related',
  'relationship', 'relationships', 'link', 'links', 'find', 'show', 'explain',
  'compare', 'mean', 'meaning', 'significance', 'symbol', 'symbolism',
  'crossing', 'biblical', 'bible', 'scripture', 'verse', 'verses', 'passage',
]);

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  ten: 10, twelve: 12, forty: 40, seventy: 70,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '10': 10, '12': 12, '40': 40, '70': 70,
};

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const NUMBER_PHRASE_RE = new RegExp(
  `\\b(?:${Object.keys(SMALL_NUMBERS).join('|')}|hundred|thousand)(?:(?:[ -]+)(?:${Object.keys(SMALL_NUMBERS).join('|')}|hundred|thousand))*\\b`,
  'gi'
);

function normalizeNumberPhrases(text: string): string {
  if (!text || !/[a-z]/i.test(text) || /^[HG]\d+[A-Z]?$/i.test(text.trim())) return text;
  return text.replace(NUMBER_PHRASE_RE, phrase => {
    if (!/[ -]/.test(phrase) && phrase.toLowerCase() in SMALL_NUMBERS) return phrase;
    let total = 0, group = 0;
    for (const token of phrase.toLowerCase().split(/[ -]+/)) {
      if (token === 'hundred') group = (group || 1) * 100;
      else if (token === 'thousand') { total += (group || 1) * 1000; group = 0; }
      else group += SMALL_NUMBERS[token];
    }
    return String(total + group);
  });
}

function normalizeToken(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9\u0590-\u05ff\u0370-\u03ff]+/g, ' ')
    .trim();
}

function stripPossessive(w: string): string {
  if (w.length > 4 && w.endsWith('s')) {
    return w;
  }
  return w;
}

function getSingularForm(word: string): string | null {
  const w = word.toLowerCase();
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('es') && w.length > 4) {
    if (w.endsWith('shes') || w.endsWith('ches') || w.endsWith('xes') || w.endsWith('sses')) {
      return w.slice(0, -2);
    }
    return w.slice(0, -1);
  }
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) {
    return w.slice(0, -1);
  }
  return null;
}

const PRONOUN_OR_FUNC_STRONGS = new Set([
  'H0853', 'H0854', 'H4480', 'H0413', 'H5921', 'H0518', 'H3588', 'H0834',
  'H1931', 'H0859', 'H0589', 'H0595', 'H2088', 'H2063', 'H0428',
  'G3588', 'G2532', 'G1161', 'G0846', 'G1722', 'G1519', 'G3754', 'G1473',
  'G4771', 'G3778', 'G3739', 'G5100', 'G5101', 'G1438',
]);

const GENERIC_LIGHT_VERB_STRONGS = new Set([
  'H0559', 'H1696', 'H6213', 'H1961', 'H0935', 'H5414', 'H1980', 'H7200', 'H3947', 'H3318',
  'G3004', 'G1096', 'G4160', 'G2192', 'G2064', 'G1510', 'G2036',
]);

const COMPOUND_MAGNITUDE_STRONGS = new Set([
  'H3967', 'H0505', 'H6240', 'H7239', 'G1540', 'G5507',
]);

const SMALL_NUMERAL_STRONGS = new Set([
  'H0259', 'H8147', 'H7969', 'H0702', 'H2568', 'H8337', 'H7651', 'H8083', 'H8672', 'H6235',
  'G1520', 'G1417', 'G5140', 'G5064', 'G4002', 'G1803', 'G2033', 'G1176', 'G1427',
]);

const MACULA_FUNC_CLASSES = new Set([
  'conjunction', 'preposition', 'article', 'particle', 'pronoun',
  'cj', 'prep', 'ptcl', 'adv', 'rel', 'om', 'intj', 'pron', 'det',
]);

function isMaculaFuncClass(cl: unknown): boolean {
  return MACULA_FUNC_CLASSES.has(String(cl || '').toLowerCase());
}

const HIGH_FREQ_CONTENT_STOP_STRONGS = new Set(['H3605', 'G3956']);
const HIGH_FREQ_THEO_HUB_STRONGS = new Set([
  'H3068', 'H3069', 'H0430', 'H3478', 'H0776', 'H3117', 'H0376', 'H1121', 'H0001',
  'G2316', 'G2962', 'G0444', 'G2424', 'G5547', 'G4183', 'G3173',
]);

function applyRangeRef(passage: R10PassageRef, rawRef?: string | null): R10PassageRef {
  const ref = String(rawRef || '').trim();
  if (!ref) return passage;
  const m = ref.match(/:(\d+)\s*-\s*(\d+)\s*$/);
  if (!m) return passage;
  const startV = Number(m[1]);
  const endV = Number(m[2]);
  if (Number.isInteger(startV) && Number.isInteger(endV) && endV > startV) {
    return {
      ...passage,
      ref,
      verse: startV,
      end_verse: endV,
    };
  }
  return passage;
}

function buildRefStub(vid: number, rawRef?: string | null): R10PassageRef {
  const book = bookForVid(vid);
  const ref = String(rawRef || '').trim() || `Verse ${vid}`;
  const m = ref.match(/(\d+):(\d+)(?:\s*-\s*(\d+))?\s*$/);
  const chapter = m ? Number(m[1]) : 1;
  const verse = m ? Number(m[2]) : 1;
  const endVerse = m && m[3] ? Number(m[3]) : undefined;
  return {
    verse_id: vid,
    ref,
    book,
    chapter,
    verse,
    ...(endVerse && endVerse > verse ? { end_verse: endVerse } : {}),
    testament: book <= 39 ? 'OT' : 'NT',
    is_psalm_heading: book === 19 && verse === 0,
  };
}

const SENSE_GLOSS_STOPWORDS = new Set([
  'to', 'be', 'a', 'an', 'the', 'of', 'in', 'on', 'or', 'and', 'for', 'with',
  'by', 'as', 'at', 'from', 'it', 'its', 'oneself', 'make', 'making', 'cause',
  'hiphil', 'piel', 'qal', 'niphal', 'hithpael', 'pual', 'hophal', 'pael',
]);

const SENSE_STEMS_CACHE = new Map<string, Set<string>>();

function extractSenseStems(text: string): Set<string> {
  const raw = String(text || '');
  const cached = SENSE_STEMS_CACHE.get(raw);
  if (cached) return cached;
  const stems = new Set<string>();
  const words = raw.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (w.length < 3 || SENSE_GLOSS_STOPWORDS.has(w)) continue;
    stems.add(w);
    if (w.length >= 5 && w.endsWith('e')) stems.add(w.slice(0, -1));
    const sing = getSingularForm(w);
    if (sing && sing.length >= 3) stems.add(sing);
    for (const ms of getMorphStems(w)) {
      if (ms.length >= 3) stems.add(ms);
    }
  }
  if (SENSE_STEMS_CACHE.size >= 512) SENSE_STEMS_CACHE.clear();
  SENSE_STEMS_CACHE.set(raw, stems);
  return stems;
}

function countStemOverlap(a: Set<string>, b: Set<string>): number {
  let hits = 0;
  for (const s of a) {
    if (b.has(s)) hits++;
  }
  return hits;
}

function resolveDisplaySense(
  prof: LemmaProfile,
  witnessPassages: Array<{ verse_id?: number; snippet?: string }>,
  explicitToks?: any[],
): { lk: string; sc: string; tr: string; gl: string } {
  const sibs = prof.homograph_siblings;
  if (!sibs || sibs.length === 0) {
    return { lk: prof.lk, sc: prof.sc, tr: prof.tr, gl: prof.gl };
  }
  const sameStrongsSiblings = sibs.filter(sib => sib.bs === prof.bs);
  if (sameStrongsSiblings.length === 0 || (witnessPassages.length === 0 && (!explicitToks || explicitToks.length === 0))) {
    return { lk: prof.lk, sc: prof.sc, tr: prof.tr, gl: prof.gl };
  }

  const candidates = [
    { lk: prof.lk, sc: prof.sc, tr: prof.tr, gl: prof.gl, isDefault: true },
    ...sameStrongsSiblings.map(sib => ({
      lk: sib.lk || prof.lk,
      sc: sib.sc || prof.sc,
      tr: sib.tr || prof.tr,
      gl: sib.gl,
      isDefault: false,
    })),
  ];

  const matchingExplicitToks = (explicitToks || []).filter(t => t.s === prof.bs && (t.g || t.lk));
  const explicitLks = new Set(matchingExplicitToks.map(t => String(t.lk || '').toLowerCase()).filter(Boolean));
  const witnessVids = new Set(witnessPassages.map(p => Number(p.verse_id || 0)).filter(v => v > 0));
  const matchingForms: any[] = [];
  const profForms = prof.forms || [];
  for (let fi = 0; fi < profForms.length && fi < 80; fi++) {
    const f = profForms[fi];
    if (f?.vid && witnessVids.has(f.vid) && f.gl) {
      matchingForms.push(f);
      if (matchingForms.length >= 6) break;
    }
  }
  const snippetTexts = witnessPassages.slice(0, 6).map(p => p.snippet).filter((s): s is string => Boolean(s));

  const explicitStemsList = matchingExplicitToks.filter(t => t.g).map(t => extractSenseStems(t.g));
  const formStemsList = matchingForms.map(f => extractSenseStems(f.gl));
  const snippetStemsList = snippetTexts.map(s => extractSenseStems(s));

  let best = candidates[0];
  let bestScore = -1;
  let defaultScore = 0;

  for (const cand of candidates) {
    const candStems = extractSenseStems(cand.gl);
    let score = cand.lk && explicitLks.has(String(cand.lk).toLowerCase()) ? 12 : 0;
    for (const es of explicitStemsList) score += countStemOverlap(candStems, es) * 4;
    for (const fs of formStemsList) score += countStemOverlap(candStems, fs) * 3;
    for (const ss of snippetStemsList) score += countStemOverlap(candStems, ss) * 2;
    if (cand.isDefault) defaultScore = score;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  const chosen = bestScore > defaultScore ? best : candidates[0];
  return { lk: chosen.lk, sc: chosen.sc, tr: chosen.tr, gl: chosen.gl };
}

function verifyTermSenseInVerse(
  term: string,
  prof: LemmaProfile,
  passage: { verse_id?: number; snippet?: string },
  toks: any[],
): boolean {
  if (/^[HG]\d+$/i.test(term)) return true;
  const sameStrongsSiblings = (prof.homograph_siblings || []).filter(sib => sib.bs === prof.bs);
  if (sameStrongsSiblings.length === 0) return true;
  const lemmaToks = (toks || []).filter(t => t.s === prof.bs && t.g);
  if (lemmaToks.length === 0) return true;
  const occStems = extractSenseStems(lemmaToks.map(t => t.g).join(' '));
  if (occStems.size === 0) return true;
  const chosen = resolveDisplaySense(prof, [passage], toks);
  const chosenStems = extractSenseStems(chosen.gl);
  const lowerTerm = term.toLowerCase().trim();
  const aliasList = QUERY_FALLBACK_ALIAS_MAP[lowerTerm] || [];
  const termStems = extractSenseStems([term, ...aliasList].join(' '));
  if (termStems.size === 0) return true;
  return countStemOverlap(termStems, occStems) > 0 || countStemOverlap(termStems, chosenStems) > 0;
}

const QUERY_FALLBACK_ALIAS_MAP: Record<string, string[]> = {
  yeast: ['leaven'],
  resurrection: ['resurrect', 'rise', 'raise'],
  resurrected: ['resurrect', 'rise'],
  resurrecting: ['resurrect', 'rise'],
  menorah: ['lampstand'],
  redemption: ['redeem'],
  atonement: ['atone'],
  propitiation: ['mercy seat'],
};

function getMorphStems(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  if (w.endsWith('ing') && w.length > 5) {
    const base = w.slice(0, -3);
    out.push(base, base + 'e');
  } else if (w.endsWith('tion') && w.length > 6) {
    out.push(w.slice(0, -3), w.slice(0, -4) + 'e');
  } else if (w.endsWith('ion') && w.length > 5) {
    out.push(w.slice(0, -3), w.slice(0, -3) + 'e');
  } else if (w.endsWith('ed') && w.length > 4) {
    const base = w.slice(0, -2);
    out.push(base, base + 'e');
  } else if (w.endsWith('ation') && w.length > 7) {
    const base = w.slice(0, -5);
    out.push(base, base + 'e');
  } else if (w.endsWith('er') && w.length > 4) {
    out.push(w.slice(0, -2));
  } else if (w.endsWith('ly') && w.length > 4) {
    out.push(w.slice(0, -2));
  }
  return out.filter((s) => s.length >= 3);
}

function confidenceFromRecord(r: R10EvidenceRecord): R10ConnectionSummary['confidence_label'] {
  if (r.epistemic_class === 'editorial_cross_reference') return 'candidate_pattern';
  if (r.predicate === 'explicit_identification' || r.predicate === 'explicit_comparison' || r.predicate === 'typological_interpretation' || r.predicate === 'direct_quotation' || r.predicate === 'authorial_interpretation') {
    return r.evidence_tier <= 2 ? 'explicit_textual' : 'strong_correspondence';
  }
  if (r.predicate === 'literary_correspondence' || r.predicate === 'cross_reference_witness' || r.predicate === 'multihop_proof_path') return 'strong_correspondence';
  if (r.predicate === 'verified_lexical_grammatical' || r.predicate === 'cross_language_bridge' || r.predicate === 'orthographic_wordplay') return 'lexical_reference';
  if (r.predicate === 'literary_pattern' || r.predicate === 'structural_scene_parallel' || r.predicate === 'shared_external_property' || r.predicate === 'biblical_event') return 'candidate_pattern';
  if (r.predicate === 'orthographic_overlap') return 'orthographic_only';
  if (r.predicate === 'interpretive_hypothesis') return 'interpretive';
  return 'moderate_motif';
}

function defaultUncertainty(r: R10EvidenceRecord): string {
  if (r.epistemic_class === 'editorial_cross_reference') {
    return 'Modern editorial cross-reference index (CrossReferences.org / OpenBible); candidate parallel for human verification, not proof of ancient citation or textual dependence.';
  }
  if (r.predicate === 'explicit_identification') return 'Directly stated in text; keep separate from other passages with distinct referents.';
  if (r.predicate === 'typological_interpretation' || r.predicate === 'explicit_comparison') return 'Explicit NT authorial comparison; separates historical OT narrative from later NT theological interpretation.';
  if (r.predicate === 'authorial_interpretation') return 'Explicit biblical narrator/author gloss; intertextual OT echoes remain secondary.';
  if (r.predicate === 'verified_lexical_grammatical' || r.predicate === 'cross_language_bridge') return 'Documented original-language lexical/translation fact; context governs which sense applies per verse.';
  if (r.predicate === 'multihop_proof_path') return '2-5 hop attested discovery path; individual steps are source-backed, but a path never proves endpoint identity or authorial intent.';
  if (r.predicate === 'shared_external_property') return 'Externally sourced physical/semantic property bridge (OEWN 2025 / Wikidata); exploratory hypothesis only (independent_biblical_support=0).';
  if (r.predicate === 'structural_scene_parallel') return 'At-tested R8 structural clause role parallel; candidate hypothesis only, not proof of literary dependence.';
  if (r.predicate === 'literary_correspondence' || r.predicate === 'cross_reference_witness') return 'Cross-reference / lexical correspondence; shared motif or anchor does not alone prove direct citation.';
  if (r.predicate === 'orthographic_overlap') return 'Spelling/consonantal overlap ONLY; does NOT establish a shared etymological root.';
  if (r.predicate === 'literary_pattern') return 'Candidate literary/structural pattern; interpretive synthesis beyond explicit text links.';
  if (r.predicate === 'numbered_entity') return 'Co-occurring counted entity; verify object identity vs coincidental shared number.';
  if (r.predicate === 'biblical_event') return 'Narrative chronology sequence from Theographic Bible Data; reflects editorial episode grouping and reference dating rather than direct lexical dependence.';
  return 'Shared biblical motif across passages; contextual differences preserved.';
}

function languageFromStrongs(strongs: string | undefined, fallback: 'hbo' | 'grc' = 'hbo'): 'hbo' | 'grc' {
  if (/^G/i.test(strongs || '')) return 'grc';
  if (/^H/i.test(strongs || '')) return 'hbo';
  return fallback;
}

function parseLexicalLabel(label?: string): { script: string; transliteration: string } {
  const raw = String(label || '').trim();
  if (!raw) return { script: '', transliteration: '' };
  const m = raw.match(/^(.+?)\s*\(([^)·]+?)(?:\s*·\s*[HG]\d+[A-Z]?)?\)\s*$/i);
  if (m) return { script: m[1].trim(), transliteration: m[2].trim() };
  return { script: raw, transliteration: '' };
}

function isProperNameGloss(gloss?: string): boolean {
  const g = String(gloss || '').trim();
  if (!g) return false;
  return /^[A-Z]/.test(g) || /\(Sea of\)/i.test(g);
}

function buildLexicalRelationRecord(params: {
  evidenceId: string;
  prof: LemmaProfile;
  lrel: any;
  targetProf?: LemmaProfile | null;
  passages: R10PassageRef[];
  scoreComponents: R10EvidenceRecord['score_components'];
}): R10EvidenceRecord {
  const { evidenceId, prof, lrel, targetProf, passages, scoreComponents } = params;
  const sourceLang = languageFromStrongs(prof.bs, prof.lang);
  const parsedLabel = parseLexicalLabel(lrel.label);
  const targetStrongs = lrel.target_strongs ? String(lrel.target_strongs) : '';
  const targetLang: 'hbo' | 'grc' = targetProf?.lang || (targetStrongs ? languageFromStrongs(targetStrongs, sourceLang) : sourceLang);
  const targetScript = String(lrel.script || parsedLabel.script || targetProf?.sc || '').trim();
  const targetTranslit = String(lrel.transliteration || parsedLabel.transliteration || targetProf?.tr || '').trim();
  const targetGloss = String(lrel.gloss || targetProf?.gl || '').trim();

  const targetDisplay = lrel.label
    ? String(lrel.label)
    : targetScript && targetStrongs
      ? `${targetScript} (${targetStrongs})`
      : targetStrongs || (lrel.root ? String(lrel.root) : prof.bs);

  const sourceWord: R10OriginalWordRef = {
    lemma_key: prof.lk,
    strongs: prof.bs,
    language: sourceLang,
    lemma_script: prof.sc,
    transliteration: prof.tr,
    gloss: prof.gl,
  };
  const includeTargetWord = Boolean(
    targetStrongs && (targetStrongs !== prof.bs || (targetScript && targetScript !== prof.sc)),
  );
  const targetWord: R10OriginalWordRef | null = includeTargetWord
    ? {
        ...(targetProf?.lk ? { lemma_key: targetProf.lk } : {}),
        strongs: targetStrongs,
        language: targetLang,
        lemma_script: targetScript,
        transliteration: targetTranslit,
        gloss: targetGloss,
      }
    : null;

  const relType = String(lrel.type || '');
  const isCrossLanguage = Boolean(targetStrongs && sourceLang !== targetLang);
  const isProperName = isProperNameGloss(prof.gl) || isProperNameGloss(targetGloss);

  let predicate: R10Predicate = 'verified_lexical_grammatical';
  let epistemicClass: R10EpistemicClass = 'documented_lexical_relationship';
  let derivationMethod = 'lexical_root_derivation';
  let title = '';
  let summary = '';
  let limitations: string[] = [];

  if (relType.startsWith('formation_')) {
    predicate = 'verified_lexical_grammatical';
    epistemicClass = 'documented_lexical_relationship';
    derivationMethod = 'lexical_formation_analysis';
    const typeLabel = relType.replace(/_/g, ' ');
    if (targetStrongs && targetStrongs !== prof.bs) {
      title = `Lexical formation (${typeLabel}): ${prof.sc} (${prof.bs}) ↔ ${targetDisplay}`;
    } else {
      title = `Lexical formation (${typeLabel}): ${prof.sc} (${prof.bs}${prof.gl ? `, "${prof.gl}"` : ''})`;
    }
    summary = lrel.note
      ? `Lexical formation analysis for ${prof.sc} (${prof.bs}${prof.gl ? `, "${prof.gl}"` : ''}): ${String(lrel.note)}`
      : `Lexical formation analysis (${typeLabel}) links ${prof.sc} (${prof.bs}) with ${targetDisplay}.`;
    limitations = [
      'Lexicon-documented word formation or component etymology; contextual meaning in a given passage is governed by usage rather than component parts alone.',
    ];
  } else if (relType === 'source_provided_lexical_equivalent' || (isCrossLanguage && !isProperName)) {
    predicate = 'cross_language_bridge';
    epistemicClass = 'documented_cross_language_bridge';
    derivationMethod = 'source_provided_lexical_equivalent';
    title = `Cross-language lexical equivalent: ${prof.sc} (${prof.bs}) ↔ ${targetDisplay}`;
    summary = `Source-provided lexical and translation equivalent links ${prof.sc} (${prof.bs}${prof.gl ? `, "${prof.gl}"` : ''}) with ${targetDisplay}${targetGloss ? ` ("${targetGloss}")` : ''}; this documents semantic/translation correspondence across Hebrew and Greek rather than a shared morphological root.`;
    limitations = [
      'Source-provided cross-language lexical/translation equivalent (not a shared morphological root derivation); verify specific verse context before equating theological senses.',
    ];
  } else if (relType === 'shares_root' && isCrossLanguage && isProperName) {
    predicate = 'cross_language_bridge';
    epistemicClass = 'documented_cross_language_bridge';
    derivationMethod = 'cross_language_name_transcription';
    title = `Cross-language proper-name correspondence: ${prof.sc} (${prof.bs}) ↔ ${targetDisplay}`;
    summary = `Cross-language proper-name transcription links ${sourceLang === 'grc' ? 'Greek' : 'Hebrew/Aramaic'} ${prof.sc} (${prof.bs}${prof.gl ? `, "${prof.gl}"` : ''}) and ${targetLang === 'grc' ? 'Greek' : 'Hebrew/Aramaic'} ${targetDisplay}${targetGloss ? ` ("${targetGloss}")` : ''} as the same biblical proper name across testaments, rather than a morphological root derivation.`;
    limitations = [
      'Cross-language proper-name transcription/equivalence (not an intra-language morphological root derivation); confirm referent identity in context where names are shared by multiple figures.',
    ];
  } else if (relType === 'shares_root' && isCrossLanguage) {
    predicate = 'cross_language_bridge';
    epistemicClass = 'documented_cross_language_bridge';
    derivationMethod = 'source_provided_lexical_equivalent';
    title = `Cross-language lexical equivalent: ${prof.sc} (${prof.bs}) ↔ ${targetDisplay}`;
    summary = `Cross-language lexical correspondence links ${sourceLang === 'grc' ? 'Greek' : 'Hebrew/Aramaic'} ${prof.sc} (${prof.bs}${prof.gl ? `, "${prof.gl}"` : ''}) with ${targetLang === 'grc' ? 'Greek' : 'Hebrew/Aramaic'} ${targetDisplay}${targetGloss ? ` ("${targetGloss}")` : ''}; Hebrew/Aramaic and Greek do not share a historical morphological root.`;
    limitations = [
      'Cross-language translation/semantic correspondence (not a shared historical morphological root).',
    ];
  } else {
    predicate = 'verified_lexical_grammatical';
    epistemicClass = 'documented_lexical_relationship';
    derivationMethod = 'lexical_root_derivation';
    title = `Lexical relation (${relType.replace(/_/g, ' ')}): ${prof.sc} (${prof.bs}) ↔ ${targetDisplay}`;
    summary = `Morphological and root derivation analysis links ${prof.sc} (${prof.bs}) to ${targetDisplay}${targetGloss ? ` ("${targetGloss}")` : ''}.`;
    limitations = [
      'Lexical root derivation reflects shared etymological origin; semantic usage in specific verses diverges.',
    ];
  }

  return {
    evidence_id: evidenceId,
    predicate,
    evidence_tier: 3,
    epistemic_class: epistemicClass,
    title,
    summary,
    source_node_id: `lemma:${prof.bs}`,
    target_node_id: targetStrongs ? `lemma:${targetStrongs}` : `root:${lrel.root || prof.bs}`,
    passages,
    original_words: [sourceWord, ...(targetWord ? [targetWord] : [])],
    matched_terms: [...new Set([prof.gl, prof.sc, targetGloss, targetScript].filter(Boolean))],
    limitations,
    provenance: {
      source_dataset: 'STEPBible TBESH/TBESG Lexicon',
      source_record_ids: [prof.bs, targetStrongs].filter(Boolean),
      license: 'CC BY 4.0',
      derivation_method: derivationMethod,
    },
    score_components: scoreComponents,
  };
}

const XREF_TRIVIAL_ANCHOR_RE = /^(?:then|this\s+is|and|for|so|but|now|therefore|behold|or|that|in|on|at|to|of|the|a|an|it|is|was|were|he|she|they|we|you|i)$/i;

function sanitizeXrefPhrase(raw: string | undefined): string {
  const cleaned = String(raw || '').trim();
  if (!cleaned || XREF_TRIVIAL_ANCHOR_RE.test(cleaned)) return '';
  return cleaned;
}

function buildXrefRecord(params: {
  evidenceId?: string;
  fromPassage: R10PassageRef;
  toPassage: R10PassageRef;
  phrase?: string;
  isReciprocal?: boolean;
  isCrossTest?: boolean;
  isSameLemma?: boolean;
  originalWords?: R10OriginalWordRef[];
  extraMatchedTerms?: string[];
  sharedContentCount?: number;
  lxxBridgeCount?: number;
  overlapBonus?: number;
  backgroundPenalty?: number;
  isPassageIntent?: boolean;
  scenePairsText?: string;
  sceneRoleCount?: number;
}): R10EvidenceRecord {
  const {
    fromPassage,
    toPassage,
    phrase: rawPhrase = '',
    isReciprocal = false,
    isSameLemma,
    originalWords = [],
    extraMatchedTerms = [],
    sharedContentCount = 0,
    lxxBridgeCount = 0,
    overlapBonus = 0,
    backgroundPenalty = 0,
    isPassageIntent = false,
    scenePairsText = '',
    sceneRoleCount = 0,
  } = params;
  const phrase = sanitizeXrefPhrase(rawPhrase);
  const isCrossTest = Boolean(params.isCrossTest || fromPassage.testament !== toPassage.testament);
  const baseXrefScore = isReciprocal && isCrossTest
    ? 835
    : isReciprocal
      ? 785
      : isCrossTest
        ? 750
        : 700;
  const strongCorrob = (sharedContentCount + lxxBridgeCount) >= 2 || overlapBonus >= 85;
  const xrefCap = isPassageIntent && strongCorrob
    ? 970
    : (isCrossTest && (overlapBonus > 0 || isReciprocal) ? 925 : 885);
  const boundedOverlap = overlapBonus > 0
    ? Math.max(0, Math.min(xrefCap, baseXrefScore + overlapBonus) - baseXrefScore)
    : 0;
  const finalScore = Math.max(10, baseXrefScore + boundedOverlap - backgroundPenalty);
  const witnessBonus = isReciprocal ? 45 : 20;
  const specificityBonus = (baseXrefScore + boundedOverlap) - TIER_BASE_SCORE[4] - witnessBonus;
  const overlapNote = sharedContentCount > 0 || lxxBridgeCount > 0
    ? ` (${sharedContentCount} shared lemma${sharedContentCount === 1 ? '' : 's'}, ${lxxBridgeCount} LXX alignment bridge${lxxBridgeCount === 1 ? '' : 's'}${sceneRoleCount > 0 ? `, ${sceneRoleCount} matching grammatical role${sceneRoleCount === 1 ? '' : 's'}` : ''}${scenePairsText ? `; aligned lemmas: ${scenePairsText}` : ''})`
    : '';

  return {
    evidence_id: params.evidenceId || `r11:xref:${fromPassage.verse_id}:${toPassage.verse_id}`,
    predicate: 'cross_reference_witness',
    evidence_tier: 4,
    epistemic_class: 'editorial_cross_reference',
    title: `Modern editorial cross-reference${isReciprocal ? ' (reciprocal)' : ''}${isCrossTest ? ' (OT↔NT)' : ''}: ${fromPassage.ref} ${isReciprocal ? '↔' : '→'} ${toPassage.ref}${phrase ? ` ("${phrase}")` : ''}`,
    summary: `Modern editorial cross-reference index (CrossReferences.org / OpenBible) ${isReciprocal ? 'reciprocally ' : ''}links ${fromPassage.ref} and ${toPassage.ref}${phrase ? ` via anchor phrase "${phrase}"` : ''}${isSameLemma !== undefined ? ` (${isSameLemma ? 'same original lemma' : 'thematic editorial cross-reference'})` : ''}${overlapNote}.`,
    source_node_id: `passage:${fromPassage.ref}`,
    target_node_id: `passage:${toPassage.ref}`,
    passages: [fromPassage, toPassage],
    original_words: originalWords,
    matched_terms: [...new Set([fromPassage.ref, toPassage.ref, phrase, ...extraMatchedTerms].filter(Boolean))],
    limitations: [
      'Modern editorial cross-reference index (CrossReferences.org / OpenBible); reflects post-biblical reference compilation rather than ancient editorial witness or proven direct textual dependence.',
    ],
    provenance: {
      source_dataset: 'CrossReferences.org / OpenBible',
      source_record_ids: [fromPassage.ref, toPassage.ref],
      license: 'CC BY 4.0',
      derivation_method: 'modern_editorial_cross_reference_index',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[4],
      specificity_bonus: specificityBonus,
      witness_bonus: witnessBonus,
      common_word_penalty: backgroundPenalty,
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: finalScore,
    },
  };
}

function buildEventRecord(params: {
  evidenceId: string;
  anchorPassage: R10PassageRef;
  evId: string;
  evInfo: { prev: string | null; next: string | null; title: string; start_date?: string | null; sample_vids?: number[] };
  nextEvId: string | null;
  nextInfo: { prev: string | null; next: string | null; title: string; start_date?: string | null; sample_vids?: number[] } | null;
  nextPassage: R10PassageRef | null;
  isExactMatch: boolean;
  evSamplePassage?: R10PassageRef | null;
  nextSpanPassage?: R10PassageRef | null;
}): R10EvidenceRecord {
  const {
    evidenceId,
    anchorPassage,
    evId,
    evInfo,
    nextEvId,
    nextInfo,
    nextPassage,
    isExactMatch,
    evSamplePassage = null,
    nextSpanPassage = null,
  } = params;
  const evPassages: R10PassageRef[] = [];
  const seenEvPassVids = new Set<number>();
  for (const p of [anchorPassage, evSamplePassage, nextPassage, nextSpanPassage]) {
    if (p && !seenEvPassVids.has(p.verse_id)) {
      seenEvPassVids.add(p.verse_id);
      evPassages.push(p);
    }
  }
  const nextRefsText = [nextPassage?.ref, nextSpanPassage?.ref]
    .filter((r, i, arr): r is string => Boolean(r) && arr.indexOf(r) === i)
    .join(', ');
  const specificityBonus = isExactMatch ? 155 : 140;
  const witnessBonus = 15;
  const finalScore = TIER_BASE_SCORE[4] + specificityBonus + witnessBonus;

  return {
    evidence_id: evidenceId,
    predicate: 'biblical_event',
    evidence_tier: 4,
    epistemic_class: 'shared_motif_evidence',
    title: isExactMatch
      ? `Biblical narrative sequence: ${evInfo.title}${nextInfo ? ` → ${nextInfo.title}` : ''} (${anchorPassage.ref})`
      : `Chapter-level narrative context: ${evInfo.title}${nextInfo ? ` → ${nextInfo.title}` : ''} (near ${anchorPassage.ref})`,
    summary: isExactMatch
      ? `${anchorPassage.ref} belongs to canonical narrative episode "${evInfo.title}"${evInfo.start_date ? ` (${evInfo.start_date})` : ''}${evSamplePassage ? ` (within episode context including ${evSamplePassage.ref})` : ''}${nextInfo ? `, followed in canonical narrative sequence by "${nextInfo.title}" (${nextRefsText})` : ''}. Canonical narrative sequence context only; sequential proximity does not establish literary dependence or liturgical commemoration.`
      : `${anchorPassage.ref} occurs in the same chapter context as canonical narrative episode "${evInfo.title}"${evInfo.start_date ? ` (${evInfo.start_date})` : ''}${evSamplePassage ? ` (including ${evSamplePassage.ref})` : ''}${nextInfo ? `, followed in canonical narrative sequence by "${nextInfo.title}" (${nextRefsText})` : ''}; verse-level membership is chapter-inferred rather than directly attested in the event index. Canonical narrative sequence context only; sequential proximity does not establish literary dependence or liturgical commemoration.`,
    source_node_id: `passage:${anchorPassage.ref}`,
    target_node_id: nextEvId || evId,
    passages: evPassages,
    original_words: [],
    matched_terms: [anchorPassage.ref, evInfo.title, nextInfo?.title || ''].filter(Boolean),
    limitations: [
      isExactMatch
        ? 'Canonical narrative sequence context only (Theographic Bible Data); sequential or chronological proximity does not establish direct quotation, literary dependence, or liturgical commemoration.'
        : 'Chapter-level narrative context (verse not directly indexed in event passages); sequential or chronological proximity does not establish direct quotation, literary dependence, or liturgical commemoration.',
    ],
    provenance: {
      source_dataset: 'Theographic Bible Data',
      source_record_ids: [evId, ...(nextEvId ? [nextEvId] : [])],
      license: 'CC BY-SA 4.0',
      derivation_method: 'chronological_event_adjacency',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[4],
      specificity_bonus: specificityBonus,
      witness_bonus: witnessBonus,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: finalScore,
    },
  };
}

function buildEmbeddedSceneRecord(params: {
  sceneTuple: any[];
  fromPassage: R10PassageRef;
  toPassage: R10PassageRef;
  anchorPassage?: R10PassageRef | null;
}): R10EvidenceRecord | null {
  const { sceneTuple, fromPassage, toPassage, anchorPassage = null } = params;
  const kind = Number(sceneTuple[0] || 0);
  const isCrossTest = fromPassage.testament !== toPassage.testament;
  if (kind === 1) {
    const idf10 = Number(sceneTuple[3] || 0);
    const roleHits = Number(sceneTuple[4] || 0);
    const pairsStr = String(sceneTuple[5] || '');
    const pairCount = pairsStr ? pairsStr.split(',').filter(Boolean).length : 0;
    const isVerifiedScene = roleHits >= 2 || pairCount >= 3;
    const sceneTier: R10EvidenceTier = isVerifiedScene ? 4 : 6;
    const specBonus = isVerifiedScene
      ? Math.min(275, 85 + Math.round(idf10 * 0.95) + roleHits * 25 + (isCrossTest ? 55 : 0))
      : 15;
    const witBonus = isVerifiedScene ? Math.min(40, roleHits * 10 + 15) : 5;
    const finalScore = TIER_BASE_SCORE[sceneTier] + specBonus + witBonus;
    return {
      evidence_id: `r12:scene:${fromPassage.verse_id}:${toPassage.verse_id}`,
      predicate: 'structural_scene_parallel',
      evidence_tier: sceneTier,
      epistemic_class: isVerifiedScene ? 'shared_motif_evidence' : 'candidate_literary_pattern',
      title: `Structural & lexical scene correspondence${isCrossTest ? ' (OT↔NT)' : ''}: ${fromPassage.ref} ↔ ${toPassage.ref}`,
      summary: `Cross-book alignment between ${fromPassage.ref} and ${toPassage.ref} sharing rare attested lemmas/LXX equivalents (${pairsStr || 'shared rare terms'}${roleHits > 0 ? `, ${roleHits} shared MACULA grammatical role(s)` : ''}, IDF=${(idf10 / 10).toFixed(1)}). Candidate literary/scene parallel; inspect both contexts before inferring authorial dependence.`,
      source_node_id: `passage:${fromPassage.ref}`,
      target_node_id: `passage:${toPassage.ref}`,
      passages: [fromPassage, toPassage],
      original_words: [],
      matched_terms: [fromPassage.ref, toPassage.ref, ...pairsStr.split(/[,-]/).filter(Boolean)],
      limitations: [
        'Deterministic rare-lemma, LXX-bridge, and R8 clause-role alignment; shared scene vocabulary does not automatically prove direct citation or literary dependence.',
      ],
      provenance: {
        source_dataset: 'MACULA Hebrew & Greek + Swete LXX + R8 Syntactic Frames',
        source_record_ids: [fromPassage.ref, toPassage.ref],
        license: 'CC BY 4.0',
        derivation_method: 'structural_rare_lemma_scene_alignment',
      },
      score_components: {
        base_tier_score: TIER_BASE_SCORE[4],
        specificity_bonus: specBonus,
        witness_bonus: witBonus,
        common_word_penalty: 0,
        number_coincidence_penalty: 0,
        orthographic_penalty: 0,
        final_score: finalScore,
      },
    };
  }
  if (kind === 2) {
    const srcBs = String(sceneTuple[3] || '');
    const tgtBs = String(sceneTuple[4] || '');
    const embeddedAnchorRef = typeof sceneTuple[6] === 'string' && sceneTuple[6] ? sceneTuple[6] : '';
    const displayAnchorRef = anchorPassage?.ref || embeddedAnchorRef || fromPassage.ref;
    const passages = [fromPassage];
    if (anchorPassage && anchorPassage.verse_id !== fromPassage.verse_id) passages.push(anchorPassage);
    passages.push(toPassage);
    const specBonus = 195;
    const witBonus = 20;
    const finalScore = TIER_BASE_SCORE[4] + specBonus + witBonus;
    return {
      evidence_id: `r12:entity:${fromPassage.verse_id}:${toPassage.verse_id}`,
      predicate: 'literary_pattern',
      evidence_tier: 4,
      epistemic_class: 'shared_motif_evidence',
      title: `Pericope named-entity bridge${isCrossTest ? ' (OT↔NT)' : ''}: ${srcBs} (${displayAnchorRef}) ↔ ${tgtBs} (${toPassage.ref})`,
      summary: `Chapter pericope verse ${displayAnchorRef} (near ${fromPassage.ref}) attests rare proper name ${srcBs}, linked across testaments via STEP/LXX lexical alignment to ${tgtBs} in ${toPassage.ref}. Connects episode context to later genealogy or reception witness.`,
      source_node_id: `passage:${fromPassage.ref}`,
      target_node_id: `passage:${toPassage.ref}`,
      passages,
      original_words: [],
      matched_terms: [fromPassage.ref, toPassage.ref, srcBs, tgtBs],
      limitations: [
        'Pericope proper-name context bridge; the target proper name appears in the surrounding chapter episode rather than necessarily in the queried verse itself.',
      ],
      provenance: {
        source_dataset: 'STEPBible + MACULA Hebrew & Greek',
        source_record_ids: [displayAnchorRef, toPassage.ref, srcBs, tgtBs],
        license: 'CC BY 4.0',
        derivation_method: 'pericope_proper_name_cross_testament_bridge',
      },
      score_components: {
        base_tier_score: TIER_BASE_SCORE[4],
        specificity_bonus: specBonus,
        witness_bonus: witBonus,
        common_word_penalty: 0,
        number_coincidence_penalty: 0,
        orthographic_penalty: 0,
        final_score: finalScore,
      },
    };
  }
  if (kind === 3) {
    const sharedStrongs = String(sceneTuple[3] || '');
    const dist = Number(sceneTuple[4] || 1);
    const isForward = toPassage.verse_id > fromPassage.verse_id;
    const specBonus = Math.max(90, (isForward ? 175 : 135) - dist * 4);
    const witBonus = 15;
    const finalScore = TIER_BASE_SCORE[4] + specBonus + witBonus;
    return {
      evidence_id: `r12:prog:${fromPassage.verse_id}:${toPassage.verse_id}`,
      predicate: 'biblical_event',
      evidence_tier: 4,
      epistemic_class: 'shared_motif_evidence',
      title: isForward
        ? `Same-chapter narrative progression: ${fromPassage.ref} → ${toPassage.ref}`
        : `Same-chapter preceding context: ${fromPassage.ref} ← ${toPassage.ref}`,
      summary: `${fromPassage.ref} and ${toPassage.ref} (${dist} verse(s) ${isForward ? 'ahead' : 'earlier'} in the same chapter) share rare domain vocabulary (${sharedStrongs || 'shared rare lemmas'}), marking ${isForward ? 'forward' : 'preceding'} itinerary, ritual, or structural context.`,
      source_node_id: `passage:${fromPassage.ref}`,
      target_node_id: `passage:${toPassage.ref}`,
      passages: [fromPassage, toPassage],
      original_words: [],
      matched_terms: [fromPassage.ref, toPassage.ref, ...sharedStrongs.split(',').filter(Boolean)],
      limitations: [
        'Same-chapter sequential proximity sharing rare vocabulary; verify narrative continuity in context.',
      ],
      provenance: {
        source_dataset: 'MACULA Hebrew & Greek',
        source_record_ids: [fromPassage.ref, toPassage.ref],
        license: 'CC BY 4.0',
        derivation_method: isForward ? 'same_chapter_progression_alignment' : 'same_chapter_preceding_context_alignment',
      },
      score_components: {
        base_tier_score: TIER_BASE_SCORE[4],
        specificity_bonus: specBonus,
        witness_bonus: witBonus,
        common_word_penalty: 0,
        number_coincidence_penalty: 0,
        orthographic_penalty: 0,
        final_score: finalScore,
      },
    };
  }
  return null;
}

const RESURRECTION_DEATH_MARKERS = new Set([
  'H4191', 'H4194', 'H7585', 'H6965',
  'G2288', 'G3498', 'G0386', 'G1453', 'G0450',
]);
const DAY_UNIT_STRONGS = new Set(['H3117', 'G2250']);
const YEAR_UNIT_STRONGS = new Set(['H8141', 'G2094']);

function hasResurrectionContext(
  passages: R10PassageRef[],
  toksByVid?: Map<number, any[]>,
): boolean {
  for (const p of passages) {
    const toks = toksByVid?.get(p.verse_id) || [];
    if (toks.some(t => RESURRECTION_DEATH_MARKERS.has(String(t?.s || '')))) return true;
    const text = p.snippet || '';
    if (/\b(dead|death|died|die|grave|sheol|hades|rose|risen|raise|raised|resurrect\w*|reviv\w*|live again|third day)\b/i.test(text)) {
      return true;
    }
  }
  return false;
}

function isYearUnitWithoutDayPassage(
  passages: R10PassageRef[],
  toksByVid?: Map<number, any[]>,
): boolean {
  if (passages.length === 0) return false;
  let sawYear = false;
  let sawDay = false;
  for (const p of passages) {
    const toks = toksByVid?.get(p.verse_id) || [];
    if (toks.some(t => YEAR_UNIT_STRONGS.has(String(t?.s || '')))) sawYear = true;
    if (toks.some(t => DAY_UNIT_STRONGS.has(String(t?.s || '')))) sawDay = true;
    const text = p.snippet || '';
    if (/\byears?\b/i.test(text)) sawYear = true;
    if (/\bdays?\b/i.test(text)) sawDay = true;
  }
  return sawYear && !sawDay;
}

function buildR13WordplayRecord(
  prof: LemmaProfile,
  edge: any,
  witnessPassages: R10PassageRef[],
): R10EvidenceRecord {
  const rawEvType = String(edge.evidence_type || 'shared_consonantal_pattern');
  const sharedConsLen = String(edge.shared_consonants || '').length;
  const provenRoot = Boolean(edge.proven_common_root) && sharedConsLen >= 2;
  const isVerifiedAttested = isVerifiedAttestedWordplayEdge(edge, prof);
  const hasCue = Boolean(edge.has_explicit_cue) && (rawEvType !== 'attested_textual_wordplay' || isVerifiedAttested);
  const evType = rawEvType === 'attested_textual_wordplay' && (!hasCue || !isVerifiedAttested)
    ? 'proximate_wordplay_candidate'
    : (!provenRoot && (rawEvType === 'documented_root_family' || rawEvType === 'morphological_derivation')
        ? 'shared_consonantal_pattern'
        : rawEvType);
  const rawScore = Number(edge.score || 0.5);
  const proxSame = Number(edge.proximity_same_verse || 0);
  const proxAdj = Number(edge.proximity_adjacent_verse || 0);
  const isStrongRepeatedProximate = proxSame >= 2 && proxSame + proxAdj >= 6 && rawScore >= 0.85;
  const tier: R10EvidenceTier = evType === 'attested_textual_wordplay'
    ? 2
    : ((evType === 'documented_root_family' || evType === 'morphological_derivation' || isStrongRepeatedProximate)
        ? 3
        : (evType === 'proximate_wordplay_candidate' || provenRoot ? 4 : 5));
  const pred: R10Predicate = (tier <= 4 || provenRoot) ? 'orthographic_wordplay' : 'orthographic_overlap';
  const epClass: R10EpistemicClass = evType === 'attested_textual_wordplay'
    ? 'direct_textual_evidence'
    : ((evType === 'documented_root_family' || evType === 'morphological_derivation' || provenRoot)
      ? 'documented_lexical_relationship'
      : 'orthographic_similarity_only');
  const repeatedProximateBonus =
    isStrongRepeatedProximate
      ? Math.min(62, 24 + proxSame * 6 + Math.min(proxAdj, 8) * 2)
      : 0;
  const specBonus =
    (tier <= 2
      ? Math.min(55, Math.round(rawScore * 55))
      : (tier === 3 ? Math.min(48, Math.round(rawScore * 48)) : Math.min(42, Math.round(rawScore * 42)))) +
    repeatedProximateBonus;
  const witBonus = Math.min(34, witnessPassages.length * 8 + (hasCue ? 12 : 0) + (proxSame >= 2 ? 6 : 0));
  const orthPen = tier >= 5 ? 45 : 0;
  const finalScore = Math.max(10, TIER_BASE_SCORE[tier] + specBonus + witBonus - orthPen);

  return {
    evidence_id: `r13:wp:${prof.bs}:${edge.target_bs}`,
    predicate: pred,
    evidence_type: evType,
    evidence_tier: tier,
    epistemic_class: epClass,
    title: evType === 'attested_textual_wordplay'
      ? `Attested biblical wordplay: ${prof.sc} (${prof.bs}) ↔ ${edge.target_script} (${edge.target_bs})`
      : (provenRoot
          ? `Shared root / derivation (${evType.replace(/_/g, ' ')}): ${prof.sc} (${prof.bs}) ↔ ${edge.target_script} (${edge.target_bs})`
          : `Consonantal / phonetic correspondence: ${prof.sc} (${prof.bs}) ↔ ${edge.target_script} (${edge.target_bs})`),
    summary: `${prof.sc} (${prof.bs}, "${prof.gl}") and ${edge.target_script} (${edge.target_bs}, "${edge.target_gloss || ''}") share consonantal/phonetic sequence "${edge.shared_consonants || ''}" (edit distance ${edge.edit_distance ?? '?'}${edge.proximity_same_verse ? ', same-verse proximity' : (edge.proximity_adjacent_verse ? ', adjacent-verse proximity' : '')}${edge.has_explicit_cue ? ', explicit textual cue' : ''}). ${provenRoot ? `Documented shared root ${edge.shared_root_key || 'in STEPBible'}.` : WORDPLAY_DISCLAIMER}`,
    source_node_id: `lemma:${prof.bs}`,
    target_node_id: `lemma:${edge.target_bs}`,
    passages: witnessPassages,
    original_words: [
      { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
      { strongs: edge.target_bs, language: languageFromStrongs(edge.target_bs, prof.lang), lemma_script: edge.target_script || '', transliteration: '', gloss: edge.target_gloss || '' },
    ],
    matched_terms: [prof.gl, edge.target_gloss || '', prof.sc, edge.target_script || '', prof.bs, edge.target_bs].filter(Boolean),
    orthographic_analysis: {
      source_script: prof.sc,
      target_script: edge.target_script || '',
      source_consonants: prof.sc,
      target_consonants: edge.target_script || '',
      shared_consonants: edge.shared_consonants || '',
      overlap_kind: edge.overlap_kind === 'documented_biblical_wordplay'
        ? 'documented_biblical_wordplay'
        : (provenRoot ? 'shared_root' : 'consonantal_subsequence_only'),
      proven_common_root: provenRoot,
      etymology_warning: WORDPLAY_DISCLAIMER,
    },
    limitations: [
      provenRoot
        ? 'Documented root or morphological relationship in STEPBible/BDB; textual context determines stylistic play.'
        : WORDPLAY_DISCLAIMER,
    ],
    provenance: {
      source_dataset: 'STEPBible + MACULA Original Text',
      source_record_ids: (edge.witness_refs || []).slice(0, 4),
      license: 'CC BY 4.0',
      derivation_method: `r13_wordplay_${evType}`,
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: specBonus,
      witness_bonus: witBonus,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: orthPen,
      final_score: finalScore,
    },
  };
}

function buildR13CollocRecord(
  prof: LemmaProfile,
  targetBs: string,
  targetProf: { sc: string; tr: string; gl: string; lk?: string; lang?: 'hbo' | 'grc' } | null,
  sharedCount: number,
  npmi100: number,
  passages: R10PassageRef[],
): R10EvidenceRecord {
  const npmi = npmi100 / 100;
  const tier: R10EvidenceTier = npmi >= 0.42 && sharedCount >= 4 ? 3 : 4;
  const specBonus = Math.min(115, Math.round(npmi * 95 + Math.min(sharedCount, 12) * 3));
  const witBonus = Math.min(30, sharedCount * 3);
  const tLabel = targetProf ? `${targetProf.sc} ("${targetProf.gl}", ${targetBs})` : targetBs;
  return {
    evidence_id: `r13:colloc:${prof.bs}:${targetBs}`,
    predicate: 'verified_lexical_grammatical',
    evidence_type: 'collocation',
    evidence_tier: tier,
    epistemic_class: 'documented_collocation_or_cooccurrence',
    title: `High-PMI collocation: ${prof.sc} (${prof.bs}) ↔ ${tLabel} (NPMI=${npmi.toFixed(2)}, ${sharedCount}×)`,
    summary: `${prof.sc} (${prof.bs}, "${prof.gl}") and ${tLabel} co-occur in ${sharedCount} verses (normalized PMI ${npmi.toFixed(2)}), indicating non-accidental contextual association.`,
    source_node_id: `lemma:${prof.bs}`,
    target_node_id: `lemma:${targetBs}`,
    passages,
    original_words: [
      { lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
      ...(targetProf
        ? [{ lemma_key: targetProf.lk, strongs: targetBs, language: targetProf.lang || languageFromStrongs(targetBs, prof.lang), lemma_script: targetProf.sc, transliteration: targetProf.tr, gloss: targetProf.gl }]
        : [{ strongs: targetBs, language: languageFromStrongs(targetBs, prof.lang), lemma_script: targetBs, transliteration: '', gloss: '' }]),
    ],
    matched_terms: [prof.gl, targetProf?.gl || targetBs, prof.bs, targetBs].filter(Boolean),
    limitations: ['Pointwise mutual information highlights recurring textual company rather than automatic synonymy.'],
    provenance: {
      source_dataset: 'MACULA Hebrew & Greek + STEPBible',
      source_record_ids: passages.map(p => p.ref),
      license: 'CC BY 4.0',
      derivation_method: 'r13_npmi_collocation',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: specBonus,
      witness_bonus: witBonus,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: TIER_BASE_SCORE[tier] + specBonus + witBonus,
    },
  };
}

function buildR13MotifRecord(
  motif: any,
  passages: R10PassageRef[],
  profileByStrongs?: Map<string, LemmaProfile>,
): R10EvidenceRecord {
  const chCount = Number(motif.independent_chapters || 0);
  const witVids: number[] = Array.isArray(motif.witness_vids) ? motif.witness_vids : [];
  const nodeList: string[] = Array.isArray(motif.nodes) ? motif.nodes : [];
  const edgeTypes = [...new Set<string>((motif.edges || []).map((e: any) => String(e?.edge_type || '')).filter(Boolean))];
  const tier: R10EvidenceTier = chCount >= 4 && witVids.length >= 3 ? 3 : 4;
  const distScore = Number(motif.distinctiveness || 0.5);
  const specBonus = Math.min(185, Math.round(Math.min(1, distScore / 3) * 145 + chCount * 8));
  const witBonus = Math.min(50, Math.max(witVids.length, passages.length) * 8);
  const originalWords: R10OriginalWordRef[] = nodeList.slice(0, 6).map((bs: string) => {
    const p = profileByStrongs?.get(bs);
    if (p) {
      return { lemma_key: p.lk, strongs: p.bs, language: p.lang, lemma_script: p.sc, transliteration: p.tr, gloss: p.gl };
    }
    const nm = Array.isArray(motif.node_meta)
      ? motif.node_meta.find((x: any) => Array.isArray(x) && x[0] === bs)
      : null;
    return {
      strongs: bs,
      language: languageFromStrongs(bs, 'hbo'),
      lemma_script: (nm && nm[1]) || bs,
      transliteration: '',
      gloss: (nm && nm[2]) || '',
    };
  });
  const nodeLabel = originalWords.map(w => (w.lemma_script && w.lemma_script !== w.strongs ? `${w.lemma_script} (${w.gloss || w.strongs})` : w.strongs)).join(' ↔ ');
  const rawMotifId = String(motif.motif_id || '').trim();
  const normalizedMotifId = rawMotifId.startsWith('r13:motif:') ? rawMotifId : `r13:motif:${rawMotifId}`;
  return {
    evidence_id: normalizedMotifId,
    predicate: 'shared_motif',
    evidence_type: 'multi_passage_motif',
    evidence_tier: tier,
    epistemic_class: 'shared_motif_evidence',
    title: `Multi-passage motif (${motif.kind || 'network'}): ${nodeLabel || nodeList.join(' ↔ ')} (${chCount} chapters)`,
    summary: `Recurring motif network (${motif.kind || 'triangle'}${motif.cross_testament ? ', OT↔NT' : ''}) connecting ${nodeList.join(', ')} across ${chCount} chapters and ${witVids.length || passages.length} shared witness verses; edge types: ${edgeTypes.join(', ')}.`,
    source_node_id: `motif:${motif.motif_id}`,
    target_node_id: passages[0] ? `passage:${passages[0].ref}` : `motif:${motif.motif_id}`,
    passages,
    original_words: originalWords,
    matched_terms: [...nodeList, ...edgeTypes],
    limitations: ['Mined multi-passage motif candidate across independent chapters; examine individual passages in context.'],
    provenance: {
      source_dataset: 'MACULA Hebrew & Greek + STEPBible',
      source_record_ids: passages.map(p => p.ref),
      license: 'CC BY 4.0',
      derivation_method: 'r13_multi_passage_motif_mining',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: specBonus,
      witness_bonus: witBonus,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: TIER_BASE_SCORE[tier] + specBonus + witBonus,
    },
  };
}

function buildR13SelfInterpRecord(
  si: SelfInterpretationRecord,
  passages: R10PassageRef[],
  profileByStrongs?: Map<string, LemmaProfile>,
): R10EvidenceRecord {
  const pred: R10Predicate = si.cue_kind === 'greek_antitype_link'
    ? 'typological_interpretation'
    : 'explicit_identification';
  const epClass: R10EpistemicClass = si.cue_kind === 'greek_antitype_link'
    ? 'authorial_typology_or_quote'
    : 'direct_textual_evidence';
  const origWords: R10OriginalWordRef[] = [...new Set([...si.symbol_strongs, ...si.referent_strongs])].slice(0, 6).map(bs => {
    const p = profileByStrongs?.get(bs);
    return p
      ? { lemma_key: p.lk, strongs: p.bs, language: p.lang, lemma_script: p.sc, transliteration: p.tr, gloss: p.gl }
      : { strongs: bs, language: languageFromStrongs(bs, si.language), lemma_script: bs, transliteration: '', gloss: '' };
  });
  return {
    evidence_id: si.id.startsWith('r13:interp:') ? si.id : `r13:interp:${si.id}`,
    predicate: pred,
    evidence_type: 'explicit_biblical_interpretation',
    evidence_tier: 1,
    epistemic_class: epClass,
    title: `Scriptural self-interpretation (${si.ref}): ${si.symbol_summary} → ${si.referent_summary}`,
    summary: `${si.ref} (${si.cue_kind.replace(/_/g, ' ')}) identifies ${si.symbol_summary} as ${si.referent_summary}. ${si.strict_referent_note}`,
    source_node_id: `passage:${si.ref}`,
    target_node_id: si.referent_strongs[0] ? `lemma:${si.referent_strongs[0]}` : `passage:${si.ref}`,
    passages,
    original_words: origWords,
    matched_terms: [si.ref, si.symbol_summary, si.referent_summary, ...si.symbol_strongs, ...si.referent_strongs],
    limitations: [si.strict_referent_note],
    provenance: {
      source_dataset: 'World English Bible + MACULA Clause Tokens',
      source_record_ids: [si.ref],
      license: 'Public Domain / CC BY 4.0',
      derivation_method: 'r13_clause_self_interpretation',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[1],
      specificity_bonus: 95,
      witness_bonus: 35,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: TIER_BASE_SCORE[1] + 130,
    },
  };
}

function buildR13SymChainRecord(
  chain: ReturnType<typeof assembleSymbolicChains>[number],
  passages: R10PassageRef[],
  profileByStrongs?: Map<string, LemmaProfile>,
): R10EvidenceRecord {
  const linkNodes = [...new Set(chain.links.flatMap(l => [l.from_node, l.to_node.split('+')[0]]).filter(s => /^[HG]\d+$/.test(s)))];
  const origWords: R10OriginalWordRef[] = linkNodes.slice(0, 6).map(bs => {
    const p = profileByStrongs?.get(bs);
    return p
      ? { lemma_key: p.lk, strongs: p.bs, language: p.lang, lemma_script: p.sc, transliteration: p.tr, gloss: p.gl }
      : { strongs: bs, language: languageFromStrongs(bs, 'hbo'), lemma_script: bs, transliteration: '', gloss: '' };
  });
  const tierNum: R10EvidenceTier = 3;
  const specBonus = Math.min(85, Math.round(chain.score / 10));
  const witBonus = Math.min(30, chain.covered_refs.length * 6);
  return {
    evidence_id: chain.chain_id,
    predicate: 'literary_correspondence',
    evidence_type: 'symbolic_chain',
    evidence_tier: tierNum,
    epistemic_class: chain.referent_separations.length > 0 ? 'authorial_typology_or_quote' : 'shared_motif_evidence',
    title: `Symbolic-prophetic chain from ${chain.seed}: ${chain.covered_refs.slice(0, 4).join(' → ')}`,
    summary: `Multi-stage pattern (${chain.links.map(l => l.stage).filter((v, i, a) => a.indexOf(v) === i).join(' -> ')}) connecting ${chain.links.map(l => l.summary).slice(0, 4).join(' ; ')}.`,
    source_node_id: `lemma:${chain.seed}`,
    target_node_id: `motif:${chain.chain_id}`,
    passages,
    original_words: origWords,
    matched_terms: [chain.seed, ...chain.covered_refs.slice(0, 4)],
    limitations: chain.referent_separations.length > 0
      ? chain.referent_separations.slice(0, 3)
      : ['Staged wordplay -> artifact motif -> self-interpretation chain; check each verse link separately.'],
    provenance: {
      source_dataset: 'STEPBible + MACULA + Self-Interpretation Extractor',
      source_record_ids: chain.links.map(l => l.evidence_id).slice(0, 6),
      license: 'CC BY 4.0',
      derivation_method: 'r13_symbolic_chain_assembly',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tierNum],
      specificity_bonus: specBonus,
      witness_bonus: witBonus,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: TIER_BASE_SCORE[tierNum] + specBonus + witBonus,
    },
  };
}

function buildR13BeamRecord(
  beam: ReturnType<typeof beamSearchMotifPaths>[number],
  passages: R10PassageRef[],
  profileByStrongs?: Map<string, LemmaProfile>,
): R10EvidenceRecord {
  const pathKey = beam.nodes.join('-');
  const types = [...new Set(beam.edges.map(e => e.edge_type))];
  const origWords: R10OriginalWordRef[] = beam.nodes.slice(0, 6).map(bs => {
    const p = profileByStrongs?.get(bs);
    return p
      ? { lemma_key: p.lk, strongs: p.bs, language: p.lang, lemma_script: p.sc, transliteration: p.tr, gloss: p.gl }
      : { strongs: bs, language: languageFromStrongs(bs, 'hbo'), lemma_script: bs, transliteration: '', gloss: '' };
  });
  const pureOrthographicBeam =
    types.length > 0 &&
    types.every(t => t === 'wordplay') &&
    beam.edges.every(e => !/attested_textual_wordplay|documented_root/i.test(String(e.detail || '')));
  const tier: R10EvidenceTier = pureOrthographicBeam ? 5 : (beam.reached_target && types.length >= 2 ? 3 : 4);
  const epClass: R10EpistemicClass = pureOrthographicBeam ? 'orthographic_similarity_only' : 'shared_motif_evidence';
  const specBonus = Math.min(165, Math.round(beam.score * 65 + types.length * 25));
  const witBonus = Math.min(45, beam.witness_vids.length * 8);
  return {
    evidence_id: `r13:beam:${pathKey}`,
    predicate: pureOrthographicBeam ? 'orthographic_overlap' : 'multihop_proof_path',
    evidence_type: pureOrthographicBeam ? 'orthographic_beam_candidate' : 'multi_hop_pattern',
    evidence_tier: tier,
    epistemic_class: epClass,
    title: `Multi-hop pattern (${types.join('+')}): ${origWords.map(w => w.gloss || w.strongs).join(' → ')}`,
    summary: `Bounded beam path (${beam.edges.map(e => `${e.from_bs} -[${e.edge_type}:${e.detail}]-> ${e.to_bs}`).join(' ; ')})${beam.reached_target ? ' reaching queried target concept' : ''}.`,
    source_node_id: `lemma:${beam.nodes[0]}`,
    target_node_id: `lemma:${beam.nodes[beam.nodes.length - 1]}`,
    passages,
    original_words: origWords,
    matched_terms: [...beam.nodes, ...types],
    limitations: ['Multi-hop exploratory path combining independent evidence types; inspect intermediate steps before drawing conclusions.'],
    provenance: {
      source_dataset: 'STEPBible + MACULA R13 Multi-Hop Graph',
      source_record_ids: passages.map(p => p.ref),
      license: 'CC BY 4.0',
      derivation_method: 'r13_runtime_beam_search',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: specBonus,
      witness_bonus: witBonus,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: pureOrthographicBeam ? 35 : 0,
      final_score: Math.max(10, TIER_BASE_SCORE[tier] + specBonus + witBonus - (pureOrthographicBeam ? 35 : 0)),
    },
  };
}

function inferEvidenceType(rec: R10EvidenceRecord): string {
  if (rec.evidence_type) return rec.evidence_type;
  const id = rec.evidence_id || '';
  if (id.startsWith('r13:interp:') || id.startsWith('r11:explicit:') || id.startsWith('r10:ident:') || rec.predicate === 'explicit_identification') {
    return 'explicit_biblical_interpretation';
  }
  if (id.startsWith('r13:symchain:')) return 'symbolic_chain';
  if (id.startsWith('r13:motif:')) return 'multi_passage_motif';
  if (id.startsWith('r13:beam:') || id.startsWith('r12:path:')) return 'multi_hop_pattern';
  if (id.startsWith('r13:colloc:') || id.startsWith('r11:colloc:')) return 'collocation';
  if (id.startsWith('r11:lxx:') || rec.predicate === 'cross_language_bridge') return 'translation_alignment';
  if (id.startsWith('r11:gram:')) return 'syntactic_relationship';
  if (id.startsWith('r11:lex:')) return 'documented_root_family';
  if (id.startsWith('r12:scene:') || id.startsWith('r12:struct:')) return 'structural_scene_parallel';
  if (id.startsWith('r12:prop:')) return 'physical_world_bridge';
  if (id.startsWith('r12:prog:') || id.startsWith('r12:event:') || id.startsWith('r11:event:')) return 'narrative_progression';
  if (id.startsWith('r11:xref:')) {
    const isCross = rec.passages.some(p => p.testament === 'OT') && rec.passages.some(p => p.testament === 'NT');
    return isCross ? 'cross_testament_correspondence' : 'explicit_quotation_or_allusion';
  }
  if (rec.predicate === 'orthographic_wordplay') {
    return (rec.evidence_type === 'attested_textual_wordplay' || rec.evidence_tier <= 2)
      ? 'attested_textual_wordplay'
      : 'proximate_wordplay_candidate';
  }
  if (rec.predicate === 'orthographic_overlap') return 'shared_consonantal_pattern';
  if (rec.predicate === 'interpretive_hypothesis') return 'interpretive_hypothesis';
  return rec.predicate;
}

function validateEvidenceR13(
  records: R10EvidenceRecord[],
  ctx: {
    filters: NonNullable<DiscoverConnectionsQuery['filters']>;
    asksResurrection: boolean;
    asksDayNumber: boolean;
    toksByVid?: Map<number, any[]>;
    explicitWordsNote?: string;
  },
): R10EvidenceRecord[] {
  const allowedTypes = ctx.filters.evidence_types?.length ? new Set(ctx.filters.evidence_types) : null;
  const out: R10EvidenceRecord[] = [];
  for (const rec of records) {
    const evType = inferEvidenceType(rec);
    if (allowedTypes && !allowedTypes.has(evType)) continue;

    if (ctx.asksResurrection && (rec.original_words || []).some(w => w.strongs === 'H2421')) {
      const hasDeathMarker = hasResurrectionContext(rec.passages, ctx.toksByVid);
      if (!hasDeathMarker) continue;
    }

    if (ctx.asksDayNumber && (rec.evidence_id.startsWith('r11:intersect:pericope:') || rec.evidence_id.startsWith('r11:cluster:H7969:'))) {
      if (isYearUnitWithoutDayPassage(rec.passages, ctx.toksByVid)) continue;
    }

    if (ctx.explicitWordsNote && (rec.evidence_id.startsWith('r13:wp:') || rec.predicate === 'orthographic_overlap')) {
      if (!rec.limitations.includes(ctx.explicitWordsNote)) {
        out.push({ ...rec, evidence_type: evType, limitations: [...rec.limitations, ctx.explicitWordsNote] });
        continue;
      }
    }
    out.push(rec.evidence_type ? rec : { ...rec, evidence_type: evType });
  }
  return out;
}

function scoreCandidatesR13(
  records: R10EvidenceRecord[],
  ctx: {
    supportClass: (r: R10EvidenceRecord) => 'all_concepts' | 'meaningful_subset' | 'background';
    queryIntent: R10QueryIntent;
  },
): R10EvidenceRecord[] {
  const rawMeta = records.map((r) => {
    const sc = r.score_components;
    const isCrossTest = r.passages.some(p => p.testament === 'OT') && r.passages.some(p => p.testament === 'NT');
    const sup = ctx.supportClass(r);
    const evType = inferEvidenceType(r);

    const E = Math.max(0.05, Math.min(1, 1.05 - r.evidence_tier * 0.11));
    let F = 0.55;
    if (evType === 'explicit_biblical_interpretation' || evType === 'attested_textual_wordplay' || evType === 'structural_scene_parallel') F = 0.92;
    else if (evType === 'cross_testament_correspondence' || evType === 'symbolic_chain' || evType === 'documented_root_family') F = 0.85;
    else if (evType === 'multi_passage_motif' || evType === 'collocation' || evType === 'translation_alignment') F = 0.78;
    else if (evType === 'shared_consonantal_pattern') F = 0.52;

    const rawP = Math.max(0.05, Math.min(1, 0.35 + (sc.specificity_bonus || 0) / 350));
    const indCount = Math.max(
      r.r12_metadata?.independent_group_count || 0,
      (isCrossTest ? 1 : 0) + (r.passages.length >= 2 ? 1 : 0),
    );
    const hasStrongEvidenceAxis =
      evType === 'explicit_biblical_interpretation' ||
      evType === 'attested_textual_wordplay' ||
      evType === 'cross_testament_correspondence' ||
      evType === 'documented_root_family' ||
      indCount >= 2 ||
      r.evidence_tier <= 2;
    // Prevent pure statistical rarity from dominating single-axis weak/editorial candidates.
    const P = hasStrongEvidenceAxis ? rawP : Math.min(0.75, rawP);
    const I = Math.min(1, 0.2 + indCount * 0.25 + ((r.score_components.witness_bonus || 0) / 140));
    const R = sup === 'all_concepts' ? 0.96 : (sup === 'meaningful_subset' ? 0.74 : (ctx.queryIntent === 'passage_intertext' ? 0.84 : 0.48));
    let baseNovelty = 0.35;
    if (evType === 'attested_textual_wordplay' || evType === 'symbolic_chain' || evType === 'multi_passage_motif') baseNovelty = 0.92;
    else if (evType === 'multi_hop_pattern' || evType === 'physical_world_bridge' || evType === 'cross_testament_correspondence') baseNovelty = 0.82;
    else if (evType === 'collocation' || evType === 'structural_scene_parallel') baseNovelty = 0.72;
    const N = E >= 0.45 ? Number((baseNovelty * (0.4 + 0.6 * E)).toFixed(3)) : 0;
    const U = Math.min(1, ((sc.common_word_penalty || 0) + (sc.number_coincidence_penalty || 0) + (sc.orthographic_penalty || 0)) / 320);

    return {
      r,
      evType,
      E: Math.round(E * 1000) / 1000,
      F: Math.round(F * 1000) / 1000,
      P: Math.round(P * 1000) / 1000,
      I: Math.round(I * 1000) / 1000,
      R: Math.round(R * 1000) / 1000,
      N,
      U: Math.round(U * 1000) / 1000,
      eKey: 0.55 * E + 0.45 * F,
      pKey: 0.45 * P + 0.35 * I + 0.2 * N,
      rKey: 0.65 * R + 0.35 * ((E + I) / 2),
    };
  });

  const assignRanks = (key: 'eKey' | 'pKey' | 'rKey') => {
    const order = rawMeta.map((m, idx) => ({ idx, val: m[key] })).sort((a, b) => b.val - a.val);
    const rankMap = new Array<number>(rawMeta.length);
    order.forEach((o, rank) => { rankMap[o.idx] = rank + 1; });
    return rankMap;
  };
  const rE = assignRanks('eKey');
  const rP = assignRanks('pKey');
  const rR = assignRanks('rKey');
  const maxRrf = 3 / 61;

  return rawMeta.map((m, idx) => {
    const rawRrf = 1 / (60 + rE[idx]) + 1 / (60 + rP[idx]) + 1 / (60 + rR[idx]);
    const rrf = Math.round((rawRrf / maxRrf) * 1000) / 1000;
    const effN = m.evType === 'proximate_wordplay_candidate' ? Math.min(m.N, 0.25) : m.N;
    const delta = Math.round(m.I * 24 + m.E * 12 + effN * 14 + rrf * 16 - m.U * 35);
    const finalScore = Math.max(10, m.r.score_components.final_score + delta);
    const evidenceStrength = Math.round(Math.max(0, Math.min(1, m.E * 0.45 + m.F * 0.25 + m.P * 0.15 + m.I * 0.15 - m.U * 0.25)) * 1000) / 1000;
    const explorationValue = Math.round(Math.max(0, Math.min(1, m.R * 0.45 + effN * 0.35 + rrf * 0.2)) * 1000) / 1000;
    const breakdown: R13ScoreBreakdown = {
      E: m.E,
      F: m.F,
      P: m.P,
      I: m.I,
      R: m.R,
      N: effN,
      U: m.U,
      rrf,
      final: finalScore,
      evidence_strength: evidenceStrength,
      exploration_value: explorationValue,
      formula: 'base + round(20*I + 18*N + 15*rrf - 35*U)',
    };
    return {
      ...m.r,
      evidence_type: m.evType,
      score_breakdown: breakdown,
      score_components: {
        ...m.r.score_components,
        final_score: finalScore,
      },
    };
  });
}

function diversifyResultsR13(
  ranked: R10EvidenceRecord[],
  ctx: {
    supportClass: (r: R10EvidenceRecord) => 'all_concepts' | 'meaningful_subset' | 'background';
    queryIntent: R10QueryIntent;
    limit: number;
  },
): R10EvidenceRecord[] {
  const familyBucket = (r: R10EvidenceRecord): string => {
    const id = r.evidence_id || '';
    if (id.startsWith('v4:eside:c7')) return 'explicit_quote';
    if (id.startsWith('v4:eside:') || id.startsWith('r13:interp:') || id.startsWith('r11:explicit:')) return 'explicit_interp';
    if (id.startsWith('v4:sme:')) return 'struct_analogy';
    if (id.startsWith('v4:ppr:') || id.startsWith('v4:lxxbmw:')) return 'v4_ppr_discovery';
    if (id.startsWith('r11:xref:')) {
      const isCross = r.passages.some(p => p.testament === 'OT') && r.passages.some(p => p.testament === 'NT');
      return isCross ? 'xref_cross' : 'xref_same';
    }
    if (id.startsWith('r12:entity:')) {
      const isCross = r.passages.some(p => p.testament === 'OT') && r.passages.some(p => p.testament === 'NT');
      return isCross ? 'entity_bridge' : 'scene_progress';
    }
    if (id.startsWith('r12:scene:') || id.startsWith('r12:prog:') || id.startsWith('r12:event:')) {
      return 'scene_progress';
    }
    if (id.startsWith('r13:wp:')) return 'wordplay';
    if (id.startsWith('r12:orth:') || id.startsWith('r11:orth:')) return 'orth_overlap';
    if (id.startsWith('r13:v3bmw:')) return 'v3_bmw';
    if (id.startsWith('r13:v3bridge:')) return 'v3_bridge';
    if (id.startsWith('r13:motif:') || id.startsWith('r13:symchain:') || id.startsWith('r13:colloc:') || id.startsWith('r13:beam:')) return 'motif_chain';
    if (id.startsWith('r11:lxx:') || id.startsWith('r11:lex:') || id.startsWith('r11:gram:') || id.startsWith('r11:colloc:')) return 'lxx_lex_gram';
    if (id.startsWith('r12:prop:')) return 'prop_bridge';
    if (id.startsWith('r12:path:') || id.startsWith('r11:bridge:')) return 'bridge_prop';
    return 'cluster_other';
  };

  const quotaFor = (fam: string): { cap: number; pen: number } => {
    if (ctx.queryIntent === 'passage_intertext') {
      if (fam === 'xref_cross') return { cap: 4, pen: 28 };
      if (fam === 'explicit_interp' || fam === 'explicit_quote') return { cap: 4, pen: 35 };
      if (fam === 'struct_analogy' || fam === 'v4_ppr_discovery') return { cap: 4, pen: 32 };
      if (fam === 'entity_bridge') return { cap: 2, pen: 45 };
      if (fam === 'xref_same') return { cap: 2, pen: 50 };
      if (fam === 'scene_progress') return { cap: 3, pen: 45 };
      if (fam === 'wordplay') return { cap: 2, pen: 50 };
      if (fam === 'motif_chain') return { cap: 1, pen: 60 };
      return { cap: 2, pen: 45 };
    }
    if (fam === 'explicit_interp' || fam === 'explicit_quote' || fam === 'struct_analogy') return { cap: 3, pen: 40 };
    if (fam === 'v4_ppr_discovery') return { cap: 3, pen: 40 };
    if (fam === 'wordplay' && ctx.queryIntent === 'lexical') return { cap: 2, pen: 40 };
    if (fam === 'wordplay') return { cap: 1, pen: 75 };
    if (fam === 'motif_chain') return { cap: 2, pen: 55 };
    if (fam === 'prop_bridge') return { cap: 2, pen: 35 };
    if (fam === 'bridge_prop') return { cap: 4, pen: 25 };
    if (fam === 'lxx_lex_gram') return { cap: 3, pen: 35 };
    if (fam === 'cluster_other' || fam === 'scene_progress') return { cap: 2, pen: 55 };
    return { cap: 3, pen: 45 };
  };

  const mmrDiversifyGroup = (items: R10EvidenceRecord[], windowSize: number): R10EvidenceRecord[] => {
    if (items.length <= 2) return items;
    const pool = items.slice(0, windowSize);
    const tail = items.slice(windowSize);
    const selected: R10EvidenceRecord[] = [];
    const famUsed = new Map<string, number>();
    const meta = pool.map(cand => {
      const fam = familyBucket(cand);
      const q = quotaFor(fam);
      const vids = new Set<number>();
      for (let i = 0; i < cand.passages.length; i++) {
        const v = cand.passages[i].verse_id;
        if (v > 0) vids.add(v);
      }
      return {
        cand,
        fam,
        cap: q.cap,
        pen: q.pen,
        vids,
        maxSim: 0,
        alive: true,
      };
    });

    for (let step = 0; step < meta.length; step++) {
      let bestIdx = 0;
      let bestUtil = -Infinity;
      for (let i = 0; i < meta.length; i++) {
        const m = meta[i];
        if (!m.alive) continue;
        const used = famUsed.get(m.fam) || 0;
        const famPen = used >= m.cap ? (used - m.cap + 1) * m.pen : 0;
        const util = m.cand.score_components.final_score - famPen - Math.round(m.maxSim * 28);
        if (util > bestUtil) {
          bestUtil = util;
          bestIdx = i;
        }
      }
      const pickedMeta = meta[bestIdx];
      pickedMeta.alive = false;
      selected.push(pickedMeta.cand);
      famUsed.set(pickedMeta.fam, (famUsed.get(pickedMeta.fam) || 0) + 1);
      const pv = pickedMeta.vids;
      if (pv.size > 0) {
        for (let i = 0; i < meta.length; i++) {
          const m = meta[i];
          if (!m.alive || m.vids.size === 0) continue;
          let inter = 0;
          for (const v of m.vids) if (pv.has(v)) inter++;
          if (inter > 0) {
            const sim = inter / (m.vids.size + pv.size - inter);
            if (sim > m.maxSim) m.maxSim = sim;
          }
        }
      }
    }
    return [...selected, ...tail];
  };

  const windowSz = Math.max(28, ctx.limit * 3);
  const allSup: R10EvidenceRecord[] = [];
  const meanSup: R10EvidenceRecord[] = [];
  const bgSup: R10EvidenceRecord[] = [];
  for (const r of ranked) {
    const sc = ctx.supportClass(r);
    if (sc === 'all_concepts') allSup.push(r);
    else if (sc === 'meaningful_subset') meanSup.push(r);
    else bgSup.push(r);
  }
  return [
    ...mmrDiversifyGroup(allSup, windowSz),
    ...mmrDiversifyGroup(meanSup, windowSz),
    ...mmrDiversifyGroup(bgSup, windowSz),
  ];
}

async function runV3DiscoveryAndVerification(params: {
  reader: AssetReader;
  query: DiscoverConnectionsQuery;
  queryIntent: R10QueryIntent;
  explicitPassages: R10PassageRef[];
  explicitPassageMeta: Array<{ ep: R10PassageRef; contentStrongs: string[] }>;
  matchedStrongs: Set<string>;
  passageContentStrongs: string[];
  conceptGroups: Array<{ term: string; strongsSet: Set<string>; vids: Set<number> }>;
  rankedAll: R10EvidenceRecord[];
  uniqueMap: Map<string, R10EvidenceRecord>;
  bridges: R10ClusterBridge[];
  profileByStrongs: Map<string, LemmaProfile>;
}): Promise<void> {
  const {
    reader,
    query,
    queryIntent,
    explicitPassages,
    explicitPassageMeta,
    matchedStrongs,
    passageContentStrongs,
    conceptGroups,
    rankedAll,
    uniqueMap,
    bridges,
    profileByStrongs,
  } = params;

  const anchorVids = [...new Set([
    ...explicitPassageMeta.map((m) => m.ep.verse_id),
    ...explicitPassages.map((p) => p.verse_id),
  ])].filter((v) => v > 0 && v <= 31203);
  const anchorStrongs = [...new Set([
    ...[...matchedStrongs].map((s) => normStrongs4(s)).filter((s) => s && !PRONOUN_OR_FUNC_STRONGS.has(s) && !HIGH_FREQ_CONTENT_STOP_STRONGS.has(s)),
    ...passageContentStrongs.map((s) => normStrongs4(s)).filter((s) => s && !PRONOUN_OR_FUNC_STRONGS.has(s) && !HIGH_FREQ_CONTENT_STOP_STRONGS.has(s)),
  ])].slice(0, 24);
  if (anchorVids.length === 0 && anchorStrongs.length === 0) return;

  const hasBinarySupport =
    typeof reader.readBinary === 'function' ||
    Boolean((reader as unknown as { __v3Hooks?: unknown }).__v3Hooks);
  if (!hasBinarySupport) return;

  const session = new V3RuntimeSession(reader);
  const [bmw, nodes] = await Promise.all([session.getBmw(), session.getNodes()]);
  if (!bmw || !nodes) return;

  // 0a. ESIDE C1-C8 Explicit Scriptural Interpretation injection (AXIS:EXPLICIT_INTERP)
  const esideVidSet = new Set<number>();
  const anchorVidSet0 = new Set<number>(anchorVids);
  try {
    // Also discover reverse explicit-interpretation witnesses pointing TO anchorVids via CSR Partition 6
    const revWitnessSet = new Set<number>();
    if (anchorVids.length > 0) {
      const partIds = [...new Set(anchorVids.slice(0, 6).map((v) => v & 15))];
      const csrMap = new Map<number, Awaited<ReturnType<typeof session.getCsrPart>>>();
      await Promise.all(partIds.map(async (pid) => csrMap.set(pid, await session.getCsrPart(pid))));
      for (const av of anchorVids.slice(0, 6)) {
        const cp = csrMap.get(av & 15);
        if (!cp) continue;
        for (const e of lookupCsrEdges(cp, av)) {
          if (e.partition === 6 && e.toNodeId >= 1 && e.toNodeId <= NUM_VERSES && !anchorVidSet0.has(e.toNodeId)) {
            revWitnessSet.add(e.toNodeId);
          }
        }
      }
    }
    const revWitnessVids = [...revWitnessSet].slice(0, 10);
    const queryEsideVids = [...new Set<number>([...anchorVids.slice(0, 12), ...revWitnessVids])];
    const esideByVid = queryEsideVids.length > 0
      ? await session.getV4EsideVidBatch(queryEsideVids)
      : new Map<number, { vid: number; records: any[] } | null>();

    const esideEntries: Array<{ rec: any; isRevTargetHit: boolean; isConceptNlHit: boolean; covCount: number }> = [];
    const anchorC1SymSet = new Set<string>();
    for (const v of anchorVids.slice(0, 12)) {
      const entry = esideByVid.get(v);
      for (const r of entry?.records || []) {
        esideEntries.push({ rec: r, isRevTargetHit: false, isConceptNlHit: false, covCount: 0 });
        if (['C1', 'C2', 'C4', 'C6'].includes(String(r?.eside_class || ''))) {
          for (const s of r.symbol_strongs || []) {
            const ns = normStrongs4(s);
            if (ns) anchorC1SymSet.add(ns);
          }
        }
      }
    }
    for (const rv of revWitnessVids) {
      const entry = esideByVid.get(rv);
      for (const r of entry?.records || []) {
        if (String(r?.eside_class || '') === 'C8') continue;
        const hitsAnchor = (r.target_vids || []).some((tv: unknown) => anchorVidSet0.has(Number(tv)));
        if (hitsAnchor) {
          esideEntries.push({ rec: r, isRevTargetHit: true, isConceptNlHit: false, covCount: 0 });
        }
      }
    }

    // Symbol-sibling & multi-concept NL ESIDE lookup via eside-bs (strictly filtered so generic hubs never pollute passage queries)
    if (explicitPassages.length > 0 && anchorC1SymSet.size > 0) {
      const symList = [...anchorC1SymSet].slice(0, 4);
      const bsHits = await Promise.all(symList.map((bs) => session.getV4EsideBs(bs)));
      const symCands: Array<{ r: any; score: number }> = [];
      const seenSymIds = new Set<string>();
      for (const b of bsHits) {
        for (const r of b?.records || []) {
          if (!r?.id || seenSymIds.has(r.id)) continue;
          seenSymIds.add(r.id);
          const cls = String(r?.eside_class || '');
          if (!['C1', 'C2', 'C4', 'C6'].includes(cls)) continue;
          const rVid = Number(r.verse_id || 0);
          if (anchorVidSet0.has(rVid)) continue;
          const syms = (r.symbol_strongs || []).map((x: string) => normStrongs4(x)).filter(Boolean);
          const refs = (r.referent_strongs || []).map((x: string) => normStrongs4(x)).filter(Boolean);
          if (syms.length === 0 || refs.length === 0) continue;
          const isSameBook = Math.abs(rVid - anchorVids[0]) <= 150;
          const isPropheticOrNt = rVid >= 17656; // Isaiah+ or NT
          const distinctSymBonus = syms.some((s: string) => anchorC1SymSet.has(s)) ? 2 : 0;
          const s = distinctSymBonus + (isPropheticOrNt ? 2 : 0) + (isSameBook ? -1 : 1) + (cls === 'C1' || cls === 'C2' ? 1 : 0);
          symCands.push({ r, score: s });
        }
      }
      symCands.sort((a, b) => b.score - a.score || Number(b.r.verse_id || 0) - Number(a.r.verse_id || 0));
      for (const item of symCands.slice(0, 3)) {
        esideEntries.push({ rec: item.r, isRevTargetHit: false, isConceptNlHit: false, covCount: 1 });
      }
    } else if (explicitPassages.length === 0 && conceptGroups.length >= 2) {
      const cgStrongs: string[] = [];
      const seenCgS = new Set<string>();
      for (const cg of conceptGroups.slice(0, 4)) {
        let added = 0;
        for (const bs of cg.strongsSet) {
          const ns = normStrongs4(bs);
          if (!ns || seenCgS.has(ns)) continue;
          seenCgS.add(ns);
          cgStrongs.push(ns);
          added++;
          if (added >= 10) break;
        }
      }
      if (cgStrongs.length > 0) {
        const bsHits = await Promise.all(cgStrongs.slice(0, 28).map((bs) => session.getV4EsideBs(bs)));
        const nlCands: Array<{ r: any; cov: number }> = [];
        const seenNl = new Set<string>();
        for (const b of bsHits) {
          for (const r of b?.records || []) {
            if (!r?.id || seenNl.has(r.id)) continue;
            seenNl.add(r.id);
            const cls = String(r.eside_class || '');
            if (cls === 'C7' || cls === 'C8') continue;
            const rStrongs = new Set([
              ...(r.symbol_strongs || []).map((x: string) => normStrongs4(x)),
              ...(r.referent_strongs || []).map((x: string) => normStrongs4(x)),
            ].filter(Boolean));
            const rVid = Number(r.verse_id || 0);
            let cov = 0;
            for (const cg of conceptGroups) {
              const hitS = [...rStrongs].some((s) => cg.strongsSet.has(s));
              const hitV = rVid > 0 && cg.vids.has(rVid);
              if (hitS || hitV) cov++;
            }
            if (cov >= 2) nlCands.push({ r, cov });
          }
        }
        nlCands.sort((a, b) => b.cov - a.cov || String(a.r.id).localeCompare(String(b.r.id)));
        for (const item of nlCands.slice(0, 4)) {
          esideEntries.push({ rec: item.r, isRevTargetHit: false, isConceptNlHit: true, covCount: item.cov });
        }
      }
    } else if (explicitPassages.length === 0 && anchorStrongs.length > 0 && queryIntent !== 'physical_bridge') {
      const bsHits = await Promise.all(anchorStrongs.slice(0, 3).map((bs) => session.getV4EsideBs(bs)));
      for (const b of bsHits) {
        for (const r of (b?.records || []).slice(0, 3)) {
          esideEntries.push({ rec: r, isRevTargetHit: false, isConceptNlHit: false, covCount: 0 });
        }
      }
    }

    // Measure target_vid corroboration so repeated C7 targets across a span/xrefs outscore single accidental echoes
    const tgtCorroboration = new Map<number, number>();
    for (const existing of rankedAll) {
      for (const p of existing.passages || []) {
        if (p.verse_id >= 1 && p.verse_id <= 31203 && !anchorVidSet0.has(p.verse_id)) {
          tgtCorroboration.set(p.verse_id, (tgtCorroboration.get(p.verse_id) || 0) + 1);
        }
      }
    }
    for (const { rec: r } of esideEntries) {
      for (const tv of r?.target_vids || []) {
        const tvn = Number(tv);
        if (tvn >= 1 && tvn <= 31203 && !anchorVidSet0.has(tvn)) {
          tgtCorroboration.set(tvn, (tgtCorroboration.get(tvn) || 0) + 1);
        }
      }
    }
    const maxCorrob = (r: any): number => {
      let mx = 0;
      for (const tv of r?.target_vids || []) mx = Math.max(mx, tgtCorroboration.get(Number(tv)) || 0);
      return mx;
    };
    const clsPriority = (cls: string): number =>
      cls === 'C1' || cls === 'C2' || cls === 'C4' || cls === 'C6' ? 3 : (cls === 'C5' ? 2 : (cls === 'C7' ? 1 : 0));
    esideEntries.sort((a, b) =>
      Number(b.isConceptNlHit) - Number(a.isConceptNlHit) ||
      Number(b.isRevTargetHit) - Number(a.isRevTargetHit) ||
      clsPriority(String(b.rec?.eside_class || '')) - clsPriority(String(a.rec?.eside_class || '')) ||
      maxCorrob(b.rec) - maxCorrob(a.rec),
    );

    const seenEsideIds = new Set<string>();
    const esideTargetScoreByVid = new Map<number, number>();
    for (const { rec: r, isRevTargetHit, isConceptNlHit, covCount } of esideEntries) {
      if (!r?.id || seenEsideIds.has(r.id) || uniqueMap.has(r.id)) continue;
      seenEsideIds.add(r.id);
      const cls = String(r.eside_class || 'C1');
      const vNum = Number(r.verse_id || 0);
      if (vNum >= 1 && vNum <= 31203) esideVidSet.add(vNum);
      for (const tv of r.target_vids || []) {
        const tvn = Number(tv);
        if (tvn >= 1 && tvn <= 31203) {
          esideVidSet.add(tvn);
          esideTargetScoreByVid.set(tvn, Math.max(esideTargetScoreByVid.get(tvn) || 0, 5.5));
        }
      }
      const wVids: number[] = [...new Set<number>([vNum, ...(r.target_vids || []).map(Number), ...(r.witness_vids || []).map(Number)])]
        .filter((x) => x >= 1 && x <= 31203)
        .slice(0, 4);
      if (wVids.length === 0) continue;
      const vMap = await session.getVersesBatch(wVids);
      const passages: R10PassageRef[] = wVids
        .map((vid) => vMap.get(vid))
        .filter(Boolean)
        .map((vObj) => applyRangeRef(buildRefStub(vObj.vid, vObj.ref), vObj.ref));
      if (passages.length === 0) {
        passages.push(applyRangeRef(buildRefStub(wVids[0], String(r.ref || `vid:${wVids[0]}`)), String(r.ref || `vid:${wVids[0]}`)));
      }
      const rawSym = [...new Set<string>([...(r.symbol_strongs || []), ...(r.referent_strongs || []), ...(r.tenor_strongs || []), ...(r.vehicle_strongs || [])])]
        .map((s) => normStrongs4(s))
        .filter(Boolean)
        .slice(0, 6);
      const words: R10OriginalWordRef[] = rawSym.map((bs) => {
        const prof = profileByStrongs.get(bs);
        return {
          strongs: bs,
          lemma_key: prof?.lk || `lemma:${bs}`,
          language: bs.startsWith('G') ? 'grc' : 'hbo',
          lemma_script: prof?.sc || bs,
          transliteration: prof?.tr || '',
          gloss: prof?.gl || '',
        };
      });
      const isExactAnchorHit = isRevTargetHit || wVids.some((wv) => anchorVids.includes(wv));
      const corrob = maxCorrob(r);
      const tier: R10EvidenceTier = (cls === 'C1' || cls === 'C2' || cls === 'C4' || cls === 'C6' || cls === 'C7') && isExactAnchorHit ? 1 : 2;
      const predicate: R10Predicate =
        cls === 'C1' || cls === 'C4' || cls === 'C6'
          ? 'explicit_identification'
          : cls === 'C2' || cls === 'C3'
            ? 'explicit_comparison'
            : cls === 'C5'
              ? 'orthographic_wordplay'
              : cls === 'C7'
                ? 'direct_quotation'
                : 'literary_correspondence';
      const epistemicClass: R10EpistemicClass =
        cls === 'C7' || cls === 'C3' ? 'authorial_typology_or_quote' : 'direct_textual_evidence';
      const baseRaw = isConceptNlHit
        ? (968 + Math.min(25, covCount * 12))
        : (tier === 1
            ? (isExactAnchorHit ? 975 + Math.min(20, Math.max(0, corrob - 1) * 8) : 950)
            : (isExactAnchorHit ? 930 : (covCount >= 1 ? 912 : 895)));
      const baseFinal = Math.min(995, baseRaw);
      const rec: R10EvidenceRecord = {
        evidence_id: r.id,
        predicate,
        evidence_type: cls === 'C5' ? 'attested_textual_wordplay' : 'explicit_biblical_interpretation',
        evidence_tier: tier,
        epistemic_class: epistemicClass,
        title: `Explicit scriptural ${cls} interpretation${r.ref ? ` (${r.ref})` : ''}: ${String(r.summary || r.trigger || cls).slice(0, 90)}`,
        summary: String(r.summary || `ESIDE ${cls} discourse interpretation grounded in MACULA clause syntax.`),
        source_node_id: anchorVids[0] ? `passage:${explicitPassages[0]?.ref || anchorVids[0]}` : `lemma:${rawSym[0] || anchorStrongs[0] || 'eside'}`,
        target_node_id: r.target_vids?.[0] ? `passage:${r.sources?.[0] || r.target_vids[0]}` : `lemma:${rawSym[1] || rawSym[0] || r.id}`,
        passages,
        original_words: words,
        matched_terms: rawSym,
        limitations: cls === 'C8' ? ['Simile/analogy compares shared relational features; do not treat figure as literal identity.'] : [],
        provenance: {
          source_dataset: 'MACULA Hebrew & Greek + STEPBible (v4 ESIDE C1-C8)',
          source_record_ids: [r.id],
          license: 'CC BY 4.0',
          derivation_method: `v4_eside_${cls.toLowerCase()}`,
        },
        score_components: {
          base_tier_score: TIER_BASE_SCORE[tier],
          specificity_bonus: Math.max(20, baseFinal - TIER_BASE_SCORE[tier]),
          witness_bonus: passages.length * 8,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: baseFinal,
        },
        expand_id: r.id,
      };
      rankedAll.push(rec);
      uniqueMap.set(r.id, rec);
    }
  } catch {
    // Non-fatal when v4/eside/ assets are absent
  }

  // 0b. R-MAC + Biblical-SME Autonomous Structural Analogy Discovery
  const smeBitsByVid = new Map<number, number>();
  try {
    if (anchorVids.length > 0 && !query.skip_v3_shortlist) {
      const [perTable, simOracle, rmacIdx] = await Promise.all([
        session.getV4Pericopes(),
        session.getV4PredSim(),
        session.getV4Rmac(),
      ]);
      if (perTable && simOracle && rmacIdx) {
        const pickBestPericope = (vids: number[]): number => {
          const sV = Math.min(...vids);
          const eV = Math.max(...vids);
          const counts = new Set<number>();
          for (const v of vids) for (const pid of perTable.lookupVidPericopes(v)) counts.add(pid);
          let bestPid = 0;
          let bestJacc = -1;
          for (const pid of counts) {
            const rec = perTable.records[pid - 1];
            if (!rec) continue;
            const ov = Math.min(rec.endVid, eV) - Math.max(rec.startVid, sV) + 1;
            const jacc = ov / Math.max(1, eV - sV + 1 + rec.endVid - rec.startVid + 1 - ov);
            if (jacc > bestJacc) { bestJacc = jacc; bestPid = pid; }
          }
          return bestPid;
        };
        const basePid = pickBestPericope(explicitPassageMeta[0]?.ep ? [explicitPassageMeta[0].ep.verse_id] : anchorVids);
        const endPid = anchorVids.length > 1 ? pickBestPericope([anchorVids[anchorVids.length - 1]]) : 0;
        const basePids = endPid > 0 && endPid !== basePid ? [basePid, endPid] : (basePid > 0 ? [basePid] : []);
        const explicitTargetPids = explicitPassageMeta
          .slice(1, 3)
          .map((m) => (m.ep.verse_id > 0 ? pickBestPericope([m.ep.verse_id]) : 0))
          .filter((pid) => pid > 0 && !basePids.includes(pid));
        if (basePids.length > 0) {
          const bMap = await session.getV4HregBatch(basePids);
          const evals: ReturnType<typeof evaluateSmePair>[] = [];
          const candPidsAll = explicitTargetPids.length > 0
            ? explicitTargetPids
            : (() => {
                const scoreByPid = new Map<number, number>();
                for (const bp of basePids) {
                  const bh = bMap.get(bp);
                  if (!bh || bh.events.length < 2) continue;
                  for (const c of queryRmacCandidates(rmacIdx, bh, { kTotal: 20, pericopeTable: perTable }).slice(0, 14)) {
                    if (!basePids.includes(c.pericopeId)) {
                      scoreByPid.set(c.pericopeId, Math.max(scoreByPid.get(c.pericopeId) || 0, c.combinedScore));
                    }
                  }
                }
                return [...scoreByPid.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map((e) => e[0]);
              })();
          const baseHreg = bMap.get(basePids[0])!;
          if (candPidsAll.length > 0 && baseHreg && baseHreg.events.length >= 2) {
            const tMap = await session.getV4HregBatch(candPidsAll);
            const bpCount = 24;
            for (const tp of candPidsAll) {
              const th = tMap.get(tp);
              if (!th || th.pericopeId === baseHreg.pericopeId) continue;
              const ev = evaluateSmePair(baseHreg, th, simOracle, { bPerm: bpCount });
              if (ev.pStruct < 0.05 && ev.deltaSmeStruct > 0) evals.push(ev);
            }
            evals.sort((a, b) => b.deltaSmeStruct - a.deltaSmeStruct || b.winning.sms - a.winning.sms);
            for (const ev of evals.slice(0, 4)) {
              const th = tMap.get(ev.targetPericopeId)!;
              const repVid = Math.max(1, Math.min(31203, th.startVid));
              smeBitsByVid.set(repVid, Math.max(smeBitsByVid.get(repVid) || 0, ev.deltaSmeStruct));
              const smeId = makeSmeEvidenceId(ev.basePericopeId, ev.targetPericopeId, ev.regime);
              if (uniqueMap.has(smeId)) continue;
              const vMap = await session.getVersesBatch([baseHreg.startVid, repVid]);
              const pB = vMap.get(baseHreg.startVid);
              const pT = vMap.get(repVid);
              const refB = pB?.ref || `vid:${baseHreg.startVid}`;
              const refT = pT?.ref || `vid:${repVid}`;
              const tier: R10EvidenceTier = ev.pStruct < 0.035 && ev.winning.mappedHo.length >= 2 ? 2 : 3;
              const finalSme = Math.min(955, Math.round(815 + ev.deltaSmeStruct * 18 + ev.winning.mappedHo.length * 10));
                const rec: R10EvidenceRecord = {
                  evidence_id: smeId,
                  predicate: 'structural_scene_parallel',
                  evidence_type: 'structural_analogy',
                  evidence_tier: tier,
                  epistemic_class: 'shared_motif_evidence',
                  title: `Gentner SME ${ev.classification} (${ev.regime}): ${refB} <-> ${refT} (${ev.winning.mappedEvents.length} events, ${ev.winning.mappedHo.length} HO)`,
                  summary: `Mapped ${ev.winning.mappedEvents.length} parallel predicates and ${ev.winning.mappedHo.length} higher-order relations (SMS=${ev.winning.sms.toFixed(2)}, p_struct=${ev.pStruct.toFixed(3)}, rho_ent=${ev.rhoEnt.toFixed(2)}). ${ev.divergences.length} explicit divergence(s); ${ev.candidateInferences.length} candidate inference(s).`,
                  source_node_id: `passage:${refB}`,
                  target_node_id: `passage:${refT}`,
                  passages: [
                    ...(pB ? [applyRangeRef(buildRefStub(pB.vid, refB), refB)] : []),
                    applyRangeRef(buildRefStub(repVid, refT), refT),
                  ],
                  original_words: [],
                  matched_terms: [ev.classification, ev.regime, `ho:${ev.winning.mappedHo.length}`],
                  limitations: [
                    'Gentner structural correspondence maps higher-order relational structure; structural analogy does not imply lexical equivalence or identity.',
                  ],
                  provenance: {
                    source_dataset: 'MACULA Hebrew & Greek + BibleResearch v4 Biblical-SME / R-MAC',
                    source_record_ids: [smeId],
                    license: 'CC BY 4.0',
                    derivation_method: 'v4_biblical_sme_structure_mapping',
                  },
                  score_components: {
                    base_tier_score: TIER_BASE_SCORE[tier],
                    specificity_bonus: Math.max(15, finalSme - TIER_BASE_SCORE[tier]),
                    witness_bonus: ev.winning.mappedHo.length * 10,
                    common_word_penalty: 0,
                    number_coincidence_penalty: 0,
                    orthographic_penalty: 0,
                    final_score: finalSme,
                  },
                  expand_id: smeId,
                };
                rankedAll.push(rec);
                uniqueMap.set(smeId, rec);
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal when v4 HREG packs are absent
  }

  // 1. v3 Binary BMW retrieval for multi-term co-occurrence hits
  if (anchorStrongs.length >= 2) {
    const wandHits = blockMaxWandTopK(bmw, anchorStrongs, 12, 2.5);
    const anchorVidSet = new Set(anchorVids);
    let addedBmw = 0;
    for (const hit of wandHits) {
      if (addedBmw >= 4) break;
      if (hit.matchedCount < 2 || anchorVidSet.has(hit.vid)) continue;
      const evId = `r13:v3bmw:${hit.vid}`;
      if (uniqueMap.has(evId)) continue;
      const v = await session.getVerse(hit.vid);
      if (!v) continue;
      const pRef = applyRangeRef(buildRefStub(hit.vid, v.ref), v.ref);
      pRef.snippet = v.en || '';
      const matchedInVerse: R10OriginalWordRef[] = [];
      const seenBs = new Set<string>();
      for (const t of v.toks || []) {
        const bs = normStrongs4(t.s);
        if (!bs || !anchorStrongs.includes(bs) || seenBs.has(bs)) continue;
        seenBs.add(bs);
        const prof = profileByStrongs.get(bs);
        matchedInVerse.push({
          strongs: bs,
          lemma_key: t.lk || prof?.lk,
          language: bs.startsWith('G') ? 'grc' : 'hbo',
          lemma_script: prof?.sc || t.lm || t.sf || bs,
          transliteration: prof?.tr || '',
          gloss: prof?.gl || t.g || '',
        });
      }
      const tier: R10EvidenceTier = hit.matchedCount >= 3 || hit.score >= 12 ? 3 : 4;
      const recScore = Math.min(890, Math.round(640 + hit.score * 12));
      const rec: R10EvidenceRecord = {
        evidence_id: evId,
        predicate: 'literary_correspondence',
        evidence_type: 'multi_passage_motif',
        evidence_tier: tier,
        epistemic_class: 'documented_collocation_or_cooccurrence',
        title: `Multi-term v3 BMW convergence (${hit.matchedCount} rare terms) in ${pRef.ref}`,
        summary: `Block-Max WAND retrieval surfaced ${pRef.ref} matching ${hit.matchedCount} query lemmas (${matchedInVerse.map((w) => w.strongs).join(', ')}, BMW=${hit.score.toFixed(2)}).`,
        source_node_id: `lemma:${anchorStrongs[0]}`,
        target_node_id: `passage:${pRef.ref}`,
        passages: [...explicitPassages.slice(0, 1), pRef],
        original_words: matchedInVerse,
        matched_terms: matchedInVerse.map((w) => w.strongs || '').filter(Boolean),
        limitations: ['Co-occurring original-language terms in a verse; inspect context to determine thematic vs coincidental link.'],
        provenance: {
          source_dataset: 'MACULA Hebrew & Greek + STEPBible (v3 BMW Index)',
          source_record_ids: [pRef.ref],
          license: 'CC BY 4.0',
          derivation_method: 'v3_block_max_wand_retrieval',
        },
        score_components: {
          base_tier_score: TIER_BASE_SCORE[tier],
          specificity_bonus: Math.max(20, recScore - TIER_BASE_SCORE[tier]),
          witness_bonus: hit.matchedCount * 10,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: recScore,
        },
        expand_id: `v3:bmw:${hit.vid}`,
      };
      rankedAll.push(rec);
      uniqueMap.set(evId, rec);
      addedBmw++;
    }
  }

  // 2. Intermediate bridge pivot discovery via rankBridgePivots
  const pivotAnchorGroups: Array<{ vids: number[]; strongs: string[] }> = [];
  if (explicitPassageMeta.length >= 2) {
    for (const pm of explicitPassageMeta.slice(0, 4)) {
      if (pm.ep.verse_id > 0) {
        pivotAnchorGroups.push({ vids: [pm.ep.verse_id], strongs: pm.contentStrongs.slice(0, 6) });
      }
    }
  } else if (conceptGroups.length >= 2) {
    for (const cg of conceptGroups.slice(0, 4)) {
      const vids = [...cg.vids].slice(0, 3);
      const strongs = [...cg.strongsSet].slice(0, 4);
      if (vids.length > 0 || strongs.length > 0) pivotAnchorGroups.push({ vids, strongs });
    }
  } else if (query.mode === 'bridge' && anchorStrongs.length >= 2) {
    for (const s of anchorStrongs.slice(0, 3)) {
      pivotAnchorGroups.push({ vids: [], strongs: [s] });
    }
  }

  if (pivotAnchorGroups.length >= 2) {
    const pivots = await findV3BridgePivots(session, pivotAnchorGroups, 4);
    for (const pv of pivots) {
      if (pv.geometricMeanMass < 0.003 || pv.axisCount < 2 || pv.pivotScore < 0.015) continue;
      const evId = `r13:v3bridge:${pv.vid}`;
      if (uniqueMap.has(evId)) continue;
      const v = await session.getVerse(pv.vid);
      if (!v) continue;
      const pRef = applyRangeRef(buildRefStub(pv.vid, v.ref), v.ref);
      pRef.snippet = v.en || '';
      const bridgeScore = Math.min(895, Math.round(740 + pv.axisCount * 22 + Math.min(80, pv.pivotScore * 400)));
      const rec: R10EvidenceRecord = {
        evidence_id: evId,
        predicate: 'literary_correspondence',
        evidence_type: 'multi_hop_pattern',
        evidence_tier: 3,
        epistemic_class: 'shared_motif_evidence',
        title: `Intermediate bridge pivot: ${pRef.ref} (${pv.axisCount} independent axes)`,
        summary: `Information-bottleneck PPR pivot ${pRef.ref} bridges query anchors across ${pv.axisCount} independent axes (${pv.bridgedAxes.slice(0, 4).join(', ')}, geom=${pv.geometricMeanMass.toFixed(4)}).`,
        source_node_id: explicitPassages[0] ? `passage:${explicitPassages[0].ref}` : `lemma:${anchorStrongs[0] || 'query'}`,
        target_node_id: `passage:${pRef.ref}`,
        passages: [...explicitPassages.slice(0, 2), pRef],
        original_words: [],
        matched_terms: pv.bridgedAxes.slice(0, 5),
        limitations: ['Intermediate Typed Conductance PPR bridge pivot; verify contextual alignment at each endpoint.'],
        provenance: {
          source_dataset: 'BibleResearch v3 Conductance PPR Graph',
          source_record_ids: [pRef.ref],
          license: 'CC BY 4.0',
          derivation_method: 'v3_information_bottleneck_pivot',
        },
        score_components: {
          base_tier_score: TIER_BASE_SCORE[3],
          specificity_bonus: Math.max(10, bridgeScore - TIER_BASE_SCORE[3]),
          witness_bonus: pv.axisCount * 10,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: bridgeScore,
        },
        expand_id: `v3:bridge:${anchorVids[0] || 0}:${anchorVids[1] || 0}:${pv.vid}`,
      };
      rankedAll.push(rec);
      uniqueMap.set(evId, rec);

      if (bridges.length < 6) {
        bridges.push({
          bridge_id: evId,
          from_cluster_id: 'anchor_0',
          to_cluster_id: 'anchor_1',
          bridging_node: {
            id: `passage:${pRef.ref}`,
            kind: 'passage',
            label: pRef.ref,
            passage: pRef,
            epistemic_class: 'shared_motif_evidence',
            grounding_source: 'v3 Typed Conductance PPR',
          },
          evidence_id: evId,
          evidence_tier: 3,
          explanation: rec.summary,
        });
      }
    }
  }

  // 3. Top-24 shortlist exact verifiers + E_perp multi-axis Log-Bayes scoring
  if (query.skip_v3_shortlist) return;
  const shortlistCap = anchorVids.length === 0 && anchorStrongs.length <= 1
    ? Math.min(10, Math.max(6, (query.limit || 8) + 2))
    : Math.min(12, Math.max(8, (query.limit || 10) + 2));
  const shortlist = rankedAll.slice(0, shortlistCap);
  let triChecked = 0;
  let seqChecked = 0;

  const toTerms = (strongsList: string[]): PassagePprAnchorTerm[] => {
    const out: PassagePprAnchorTerm[] = [];
    const seen = new Set<number>();
    for (const raw of strongsList) {
      const bs = normStrongs4(raw);
      if (!bs) continue;
      const nid = nodes.key_to_id[bs];
      if (!nid || seen.has(nid)) continue;
      seen.add(nid);
      const meta = nodes.node_meta[nid - nodes.entity_offset];
      const df = Math.max(1, Number(meta?.[1]) || 10);
      out.push({
        nodeId: nid,
        idf: Math.max(0.25, Math.log2(NUM_VERSES / df)),
        axisKey: String(meta?.[0] || `LEMMA:${bs}`),
        ...(meta?.[3] ? { cohyponymGroup: String(meta[3]) } : {}),
      });
    }
    return out;
  };

  const baseAnchorTerms = toTerms(anchorStrongs).sort((a, b) => b.idf - a.idf);
  const allShortlistSeedIds = new Set<number>([...anchorVids, ...baseAnchorTerms.map((t) => t.nodeId)]);
  const candMetaList = shortlist.map((rec, idx) => {
    const candVids = rec.passages.map((p) => p.verse_id).filter((v) => v > 0 && v <= 31203);
    const candStrongs = (rec.original_words || []).map((w) => normStrongs4(w.strongs)).filter(Boolean);
    const candTerms = toTerms(candStrongs);
    if (idx < 6) {
      for (const v of candVids.slice(0, 2)) allShortlistSeedIds.add(v);
      for (const t of candTerms.slice(0, 2)) allShortlistSeedIds.add(t.nodeId);
    }
    return { rec, candVids, candStrongs, candTerms };
  });

  const batchPprShards = await session.preloadPprShards([...allShortlistSeedIds], 6);
  const batchPprLookup = (seedId: number): PprEntry[] => {
    const sh = batchPprShards.get(seedId & 31);
    return sh ? lookupPprTop64(sh, seedId) : [];
  };
  const getNodeMeta = session.buildNodeMetaLookup(nodes);
  const baseDistA = (anchorVids.length > 0 || baseAnchorTerms.length > 0)
    ? reconstructPassagePpr(anchorVids, baseAnchorTerms, batchPprLookup, [], {
        tokenCount: Math.max(4, anchorVids.length * 10, baseAnchorTerms.length * 3),
      })
    : null;

  for (let i = 0; i < candMetaList.length; i++) {
    const { rec, candVids, candTerms } = candMetaList[i];

    let delta3WayBits = 0;
    let deltaSeqBits = 0;
    let deltaWordplayBits = 0;
    let triSummary: V3ScoreMeta['tritextual'] | undefined;
    let seqSummary: V3ScoreMeta['sequence_parallel'] | undefined;

    if (rec.evidence_id.startsWith('r13:wp:') && rec.orthographic_analysis?.proven_common_root) {
      deltaWordplayBits = 4.5;
    }

    // Tri-textual MT <-> LXX <-> NT exact verifier on cross-testament passage shortlist (bounded <= 4)
    const hasNtAnchor = anchorVids.some((v) => v >= 23214);
    const hasOtAnchor = anchorVids.some((v) => v <= 23213);
    const otCandVids = candVids.filter((v) => v <= 23213 && !anchorVids.includes(v));
    const ntCandVids = candVids.filter((v) => v >= 23214 && !anchorVids.includes(v));

    if (triChecked < 4 && ((hasNtAnchor && otCandVids.length > 0) || (hasOtAnchor && ntCandVids.length > 0))) {
      triChecked++;
      const ntVid = hasNtAnchor ? anchorVids.find((v) => v >= 23214)! : ntCandVids[0];
      const otVidList = hasNtAnchor ? otCandVids.slice(0, 3) : anchorVids.filter((v) => v <= 23213).slice(0, 3);
      const ntVerse = await session.getVerse(ntVid);
      if (ntVerse) {
        const ntTokens = buildNtTokensFromV3Verse(ntVerse);
        const otGroups = (await Promise.all(otVidList.map((ov) => buildOtCandidateFromV3(session, ov, nodes))))
          .filter((g): g is NonNullable<typeof g> => Boolean(g));
        if (ntTokens.length > 0 && otGroups.length > 0) {
          const tri = alignTriTextualQuoteV4(ntTokens, otGroups, { hasCitationFormula: true }) || alignTriTextualQuote(ntTokens, otGroups);
          if (tri && tri.evidenceBits > 0) {
            delta3WayBits = tri.evidenceBits;
            triSummary = {
              sources: tri.sources,
              evidence_bits: tri.evidenceBits,
              agrees_lxx_against_mt: tri.summary.agrees_lxx_against_mt,
              agrees_mt_against_lxx: tri.summary.agrees_mt_against_lxx,
              composite_splice: tri.summary.composite_splice,
            };
            if (tri.evidenceBits >= 7.0 && rec.epistemic_class === 'editorial_cross_reference') {
              rec.epistemic_class = 'authorial_typology_or_quote';
              rec.predicate = 'direct_quotation';
              rec.evidence_type = 'direct_quotation';
              rec.summary = `${rec.summary} Tri-textual MT/LXX/NT quotation verified (${tri.sources.join(', ')}, ${tri.evidenceBits.toFixed(1)} bits).`;
            }
          }
        }
      }
    }

    // Piecewise Polarity Sequence Aligner SW^piece_pol on passage pairs (bounded <= 4)
    if (
      seqChecked < 4 &&
      anchorVids.length > 0 &&
      candVids.length > 0 &&
      candVids.some((v) => !anchorVids.includes(v))
    ) {
      seqChecked++;
      const aVid = anchorVids[0];
      const bVid = candVids.find((v) => v !== aVid)!;
      const loadClauseWindow = async (centerVid: number): Promise<ClauseSig[]> => {
        const vList = [centerVid - 1, centerVid, centerVid + 1].filter((v) => v >= 1 && v <= 31203);
        const loaded = await Promise.all(vList.map((v) => session.getVerseClauses(v)));
        return loaded.flatMap((cv) => buildClauseSigsFromV3Verse(cv));
      };
      const [clA, clB] = await Promise.all([loadClauseWindow(aVid), loadClauseWindow(bVid)]);
      if (clA.length >= 2 && clB.length >= 2) {
        const seq = alignClauseSequencesPiecewise(clA, clB, { permutations: 32 });
        if (seq.evidence_bits > 0) {
          deltaSeqBits = seq.evidence_bits;
          seqSummary = {
            arc_kind: seq.arc_kind,
            raw_score: seq.raw_score,
            p_null: seq.p_null,
            evidence_bits: seq.evidence_bits,
            has_inversion: seq.blocks.some((b) => b.mode === 'INVERSION'),
          };
        }
      }
    }

    const effDistA = baseDistA ?? reconstructPassagePpr(candVids.slice(0, 1), candTerms, batchPprLookup, [], {
      tokenCount: Math.max(4, candVids.length * 10, candTerms.length * 3),
    });
    const effCandVids = candVids.length > 0 ? candVids : anchorVids;
    const effCandTerms = candTerms.length > 0 ? candTerms : baseAnchorTerms;
    const effDistB = (effCandVids.length > 0 || effCandTerms.length > 0)
      ? reconstructPassagePpr(effCandVids, effCandTerms, batchPprLookup, [], {
          tokenCount: Math.max(4, effCandVids.length * 10, effCandTerms.length * 3),
        })
      : null;

    const deltaEsideBits = rec.evidence_id.startsWith('v4:eside:') || candVids.some((v) => esideVidSet.has(v)) ? 5.5 : 0;
    const deltaSmeStructBits = candVids.reduce((mx, v) => Math.max(mx, smeBitsByVid.get(v) || 0), 0);

    const ePerp = effDistB
      ? computeEPerpScore(effDistA, effDistB, getNodeMeta, {
          deltaSeqBits,
          deltaSmeStructBits,
          deltaEsideBits,
          delta3WayBits,
          deltaWordplayBits,
        })
      : null;

    if (ePerp) {
      const v3Meta: V3ScoreMeta = {
        e_perp_bits: ePerp.ePerpBits,
        raw_textual_bits: ePerp.rawTextualBits,
        physical_bits_capped: ePerp.physicalBitsCapped,
        n_eff: ePerp.nEff,
        axis_factor: ePerp.axisFactor,
        single_axis_floor: ePerp.singleAxisFloor,
        max_axis_rarity_bits: ePerp.maxAxisRarityBits,
        dominant_register: ePerp.dominantRegister,
        p_null_approx: ePerp.pNullApprox,
        independent_axes: ePerp.independentAxes.slice(0, 6).map((a) => ({
          axis: a.axis,
          bits: Number(a.bits.toFixed(2)),
          is_physical: a.isPhysical,
        })),
        ...(triSummary ? { tritextual: triSummary } : {}),
        ...(seqSummary ? { sequence_parallel: seqSummary } : {}),
      };
      rec.v3_score = v3Meta;
      if (!rec.expand_id) rec.expand_id = rec.evidence_id;

      // Apply calibrated E_perp damping on single medium-df traps & boost on multi-axis / verified breakthroughs
      let scoreDelta = 0;
      if (
        ePerp.axisFactor < 0.30 &&
        ePerp.nEff < 1.25 &&
        rec.evidence_tier >= 4 &&
        queryIntent !== 'physical_bridge' &&
        delta3WayBits === 0 &&
        deltaSeqBits === 0
      ) {
        scoreDelta = -45;
      } else if (
        ePerp.ePerpBits >= 6.0 &&
        (ePerp.nEff >= 1.8 || ePerp.singleAxisFloor >= 0.75 || delta3WayBits >= 3 || deltaSeqBits >= 3)
      ) {
        scoreDelta = Math.min(35, Math.round(ePerp.ePerpBits * 1.8));
      }
      if (scoreDelta !== 0) {
        rec.score_components = {
          ...rec.score_components,
          final_score: Math.max(10, rec.score_components.final_score + scoreDelta),
        };
      }
    }
  }

  // 4. Single-Seed 8-Partition PPR + Rare-LXX Discovery Emittance
  if (explicitPassages.length === 1 && anchorVids.length >= 1 && baseDistA && !query.compare_targets?.length) {
    const anchorTestament = anchorVids[0] <= 23213 ? 'OT' : 'NT';
    const minAnchorVid = Math.min(...anchorVids);
    const maxAnchorVid = Math.max(...anchorVids);
    const existingTargetVids = new Set<number>(anchorVids);
    for (const r of rankedAll) {
      for (const p of r.passages || []) {
        if (p.verse_id >= 1 && p.verse_id <= NUM_VERSES) existingTargetVids.add(p.verse_id);
      }
    }
    // Collect any rare target Strong's (idf >= 8.0) surfaced inside seed ESIDE records for narrative origin lookup
    const esideRareTargetStrongs: string[] = [];
    for (const r of rankedAll) {
      if (!r.evidence_id.startsWith('v4:eside:')) continue;
      for (const mt of r.matched_terms || []) {
        const ns = normStrongs4(mt);
        if (!ns) continue;
        const nid = nodes.key_to_id[ns];
        if (!nid || nid < nodes.entity_offset) continue;
        const df = Math.max(1, Number(nodes.node_meta[nid - nodes.entity_offset]?.[1]) || 999);
        if (Math.log2(NUM_VERSES / df) >= 8.0 && !esideRareTargetStrongs.includes(ns)) {
          esideRareTargetStrongs.push(ns);
        }
      }
    }
    const existingTop10Vids = new Set<number>(anchorVids);
    for (const r of rankedAll.slice(0, 10)) {
      for (const p of r.passages || []) {
        if (p.verse_id >= 1 && p.verse_id <= NUM_VERSES) existingTop10Vids.add(p.verse_id);
      }
    }
    const maskByTargetVid = new Map<number, number>();
    const csrBonusByVid = new Map<number, number>();
    const anchorPartIds = [...new Set(anchorVids.slice(0, 6).map((v) => v & 15))];
    const anchorCsrMap = new Map<number, Awaited<ReturnType<typeof session.getCsrPart>>>();
    await Promise.all(anchorPartIds.map(async (pid) => anchorCsrMap.set(pid, await session.getCsrPart(pid))));
    for (const av of anchorVids.slice(0, 6)) {
      for (const pprE of batchPprLookup(av)) {
        maskByTargetVid.set(pprE.targetNodeId, (maskByTargetVid.get(pprE.targetNodeId) || 0) | pprE.metapathMask);
      }
      const cp = anchorCsrMap.get(av & 15);
      if (cp) {
        for (const e of lookupCsrEdges(cp, av)) {
          if (e.partition >= 6 && e.toNodeId >= 1 && e.toNodeId <= NUM_VERSES) {
            csrBonusByVid.set(e.toNodeId, Math.max(csrBonusByVid.get(e.toNodeId) || 0, e.weight));
            maskByTargetVid.set(e.toNodeId, (maskByTargetVid.get(e.toNodeId) || 0) | (1 << e.partition));
          }
        }
      }
    }
    const pprCandidates: Array<{ vid: number; score: number; mass: number; isCrossT: boolean; hasV4Mask: boolean }> = [];
    const candVidSet = new Set<number>([...baseDistA.mass.keys(), ...csrBonusByVid.keys()]);
    for (const nid of candVidSet) {
      if (nid < 1 || nid > NUM_VERSES) continue;
      if (nid >= minAnchorVid - 15 && nid <= maxAnchorVid + 15) continue;
      const csrW = csrBonusByVid.get(nid) || 0;
      const mass = Math.max(baseDistA.mass.get(nid) || 0, csrW > 0 ? 0.025 + csrW * 0.25 : 0);
      if (mass < 0.003) continue;
      const isCrossT = (nid <= 23213 ? 'OT' : 'NT') !== anchorTestament;
      const mask = maskByTargetVid.get(nid) || 0;
      const hasV4Mask = (mask & ((1 << 6) | (1 << 7))) !== 0;
      const s = mass * (isCrossT ? 1.55 : 1.0) * (hasV4Mask ? 1.45 : 1.0);
      pprCandidates.push({ vid: nid, score: s, mass, isCrossT, hasV4Mask });
    }
    pprCandidates.sort((a, b) => b.score - a.score);
    const chosenPpr = [
      ...pprCandidates.filter((c) => c.hasV4Mask && !existingTop10Vids.has(c.vid)).slice(0, 2),
      ...pprCandidates.filter((c) => c.isCrossT && !existingTop10Vids.has(c.vid)).slice(0, 2),
      ...pprCandidates.filter((c) => !existingTop10Vids.has(c.vid)).slice(0, 2),
    ];
    const seenChosen = new Set<number>();
    const dedupChosen = chosenPpr.filter((c) => !seenChosen.has(c.vid) && seenChosen.add(c.vid)).slice(0, 4);
    if (dedupChosen.length === 0) dedupChosen.push(...pprCandidates.slice(0, 2));

    // Also probe 2-hop CSR Part 2 (entity -> lxx:<lemma> -> cross-testament entity) + rare ESIDE target Strong's
    const lxxBridgeStrongs: string[] = [...esideRareTargetStrongs.filter((s) => (s.startsWith('G') ? 'NT' : 'OT') !== anchorTestament).slice(0, 3)];
    const seenLxxBs = new Set<string>([...anchorStrongs, ...lxxBridgeStrongs]);
    const rareAnchorTerms = baseAnchorTerms.filter((t) => t.idf >= 3.0).slice(0, 8);
    if (rareAnchorTerms.length > 0) {
      const partIds = [...new Set(rareAnchorTerms.map((t) => t.nodeId & 15))];
      const csrMap = new Map<number, Awaited<ReturnType<typeof session.getCsrPart>>>();
      await Promise.all(partIds.map(async (pid) => csrMap.set(pid, await session.getCsrPart(pid))));
      const lxxIntermediateIds: number[] = [];
      for (const t of rareAnchorTerms) {
        const cp = csrMap.get(t.nodeId & 15);
        if (!cp) continue;
        const p2Edges = lookupCsrEdges(cp, t.nodeId)
          .filter((e) => e.partition === 2 && e.toNodeId >= nodes.entity_offset)
          .sort((a, b) => b.weight - a.weight);
        for (const e of p2Edges.slice(0, 4)) {
          const k = nodes.id_to_key[e.toNodeId - nodes.entity_offset] || '';
          if (k.startsWith('lxx:')) {
            if (!lxxIntermediateIds.includes(e.toNodeId)) lxxIntermediateIds.push(e.toNodeId);
          } else {
            const ns = normStrongs4(k);
            if (ns && !seenLxxBs.has(ns) && (ns.startsWith('G') ? 'NT' : 'OT') !== anchorTestament) {
              seenLxxBs.add(ns);
              lxxBridgeStrongs.push(ns);
            }
          }
        }
      }
      if (lxxIntermediateIds.length > 0) {
        const lxxPartIds = [...new Set(lxxIntermediateIds.map((nid) => nid & 15))];
        await Promise.all(lxxPartIds.map(async (pid) => {
          if (!csrMap.has(pid)) csrMap.set(pid, await session.getCsrPart(pid));
        }));
        for (const lxxNid of lxxIntermediateIds.slice(0, 20)) {
          const cp = csrMap.get(lxxNid & 15);
          if (!cp) continue;
          const hops = lookupCsrEdges(cp, lxxNid)
            .filter((e) => e.partition === 2 && e.toNodeId >= nodes.entity_offset)
            .sort((a, b) => b.weight - a.weight);
          for (const e of hops.slice(0, 4)) {
            const k = nodes.id_to_key[e.toNodeId - nodes.entity_offset] || '';
            const ns = normStrongs4(k);
            if (ns && !seenLxxBs.has(ns) && (ns.startsWith('G') ? 'NT' : 'OT') !== anchorTestament) {
              seenLxxBs.add(ns);
              lxxBridgeStrongs.push(ns);
            }
          }
        }
      }
    }
    const lxxBmwHits: Array<{ vid: number; score: number }> = [];
    if (lxxBridgeStrongs.length > 0) {
      const lxxHits = blockMaxWandTopK(bmw, lxxBridgeStrongs.slice(0, 16), 12, 2.5);
      for (const h of lxxHits) {
        if (h.vid >= minAnchorVid - 15 && h.vid <= maxAnchorVid + 15) continue;
        const isCrossT = (h.vid <= 23213 ? 'OT' : 'NT') !== anchorTestament;
        if (isCrossT && (h.matchedCount >= 2 || h.score >= 8.5)) {
          lxxBmwHits.push({ vid: h.vid, score: h.score + h.matchedCount * 2.5 });
        }
      }
      lxxBmwHits.sort((a, b) => b.score - a.score);
    }

    const emitVids = [
      ...dedupChosen.map((c) => ({ vid: c.vid, kind: 'ppr' as const, weight: c.mass, score: Math.min(962, Math.round(922 + Math.min(40, c.score * 650))) })),
      ...lxxBmwHits.slice(0, 3).map((h) => ({ vid: h.vid, kind: 'lxxbmw' as const, weight: h.score, score: Math.min(958, Math.round(915 + Math.min(43, h.score * 2.2))) })),
    ];
    if (emitVids.length > 0) {
      const vMap = await session.getVersesBatch([anchorVids[0], ...emitVids.map((x) => x.vid)]);
      const aV = vMap.get(anchorVids[0]);
      const aRef = aV ? applyRangeRef(buildRefStub(aV.vid, aV.ref), aV.ref) : explicitPassages[0];
      for (const item of emitVids) {
        const tv = vMap.get(item.vid);
        if (!tv) continue;
        const evId = item.kind === 'ppr' ? `v4:ppr:${anchorVids[0]}:${item.vid}` : `v4:lxxbmw:${item.vid}`;
        if (uniqueMap.has(evId)) continue;
        const tRef = applyRangeRef(buildRefStub(item.vid, tv.ref), tv.ref);
        tRef.snippet = tv.en || '';
        const rec: R10EvidenceRecord = {
          evidence_id: evId,
          predicate: item.kind === 'ppr' ? 'literary_correspondence' : 'cross_language_bridge',
          evidence_type: item.kind === 'ppr' ? 'multi_hop_pattern' : 'lxx_translation_bridge',
          evidence_tier: 2,
          epistemic_class: item.kind === 'ppr' ? 'shared_motif_evidence' : 'documented_cross_language_bridge',
          title: item.kind === 'ppr'
            ? `Conductance PPR 8-partition discovery: ${aRef.ref} -> ${tRef.ref}`
            : `Cross-testament LXX lexical convergence: ${aRef.ref} -> ${tRef.ref}`,
          summary: item.kind === 'ppr'
            ? `Typed 8-partition PPR reached ${tRef.ref} (mass=${item.weight.toFixed(4)}) across multi-axis original-language and discourse/structural links.`
            : `Rare anchor lemmas mapped via LXX equivalence converged in ${tRef.ref} (BMW=${item.weight.toFixed(2)}).`,
          source_node_id: `passage:${aRef.ref}`,
          target_node_id: `passage:${tRef.ref}`,
          passages: [aRef, tRef],
          original_words: [],
          matched_terms: [],
          limitations: ['8-partition graph/LXX discovery lead; inspect both passage contexts carefully.'],
          provenance: {
            source_dataset: 'MACULA Hebrew & Greek + BibleResearch v4 8-Partition CSR/PPR',
            source_record_ids: [aRef.ref, tRef.ref],
            license: 'CC BY 4.0',
            derivation_method: item.kind === 'ppr' ? 'v4_single_seed_ppr' : 'v4_lxx_bmw_bridge',
          },
          score_components: {
            base_tier_score: TIER_BASE_SCORE[2],
            specificity_bonus: Math.max(15, item.score - TIER_BASE_SCORE[2]),
            witness_bonus: 20,
            common_word_penalty: 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: item.score,
          },
          expand_id: evId,
        };
        rankedAll.push(rec);
        uniqueMap.set(evId, rec);
      }
    }
  }
}

export async function decodeB64Gz<T = any>(
  reader: AssetReader,
  b64: string,
  cacheKey?: string,
  localCache?: Map<string, any>,
): Promise<T> {
  const memoKey = cacheKey || b64;
  if (localCache?.has(memoKey)) return localCache.get(memoKey) as T;
  let val: T;
  if (typeof reader.decodeB64GzJson === 'function') {
    val = await reader.decodeB64GzJson<T>(b64, cacheKey);
  } else {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const isGz = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (isGz) {
      val = await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
      ).json() as T;
    } else {
      val = JSON.parse(new TextDecoder('utf-8').decode(bytes)) as T;
    }
  }
  localCache?.set(memoKey, val);
  return val;
}

async function readR10Json<T = any>(
  reader: AssetReader,
  releaseId: string,
  relPath: string,
  budget: ReadBudget
): Promise<T | null> {
  budget.pages ||= new Map();
  if (budget.pages.has(relPath)) return budget.pages.get(relPath)!;
  if (budget.used >= budget.max) { budget.missing?.push(`budget:${relPath}`); return null; }
  budget.used++;
  const fullPath = `/v2/relationships/${releaseId}/r10/${relPath}`;
  const pending = reader.readJson(fullPath).then(res => {
    if (!res) {
      budget.missing?.push(fullPath);
      // Missing R11 fast metadata never grants permission for a legacy book scan.
      // Explicit older release IDs retain their original reader contract.
      if (relPath === 'fast-manifest.json.gz' && releaseId === DEFAULT_R10_RELEASE) return { selective: true, profile_buckets: 1024, verse_chunk_size: 64 };
      return null;
    }
    // Quarantine unverified legacy window-based copula records and fix known homograph sense slips on load.
    if (relPath === 'explicit-and-typology.json.gz') {
      const data = res.data as { records?: Array<any>; r13_self_interpretations?: SelfInterpretationRecord[] };
      const cleanedRecords = (data.records || [])
        .filter(r => !r.evidence_id?.startsWith('r10:ident:auto:'))
        .map(r => {
          if (r.evidence_id === 'r10:corresp:gen1_to_rev4_rev21_creation_spirits' && Array.isArray(r.original_words)) {
            return {
              ...r,
              original_words: r.original_words.map((w: any) =>
                w?.strongs === 'H1254' && (w?.lemma_key === 'lemma:H1254c' || /fatten/i.test(String(w?.gloss || '')))
                  ? { ...w, lemma_key: 'lemma:H1254a', gloss: 'to create' }
                  : w
              ),
            };
          }
          if (r.evidence_id === 'r10:corresp:gen1_2_gen8_1_ruach_water_wind' && Array.isArray(r.original_words)) {
            return {
              ...r,
              original_words: r.original_words.map((w: any) =>
                w?.strongs === 'H7363' && /weak/i.test(String(w?.gloss || ''))
                  ? { ...w, gloss: 'hover / flutter (Piel)' }
                  : w
              ),
            };
          }
          return r;
        });
      return { ...data, records: cleanedRecords };
    }
    return res.data;
  });
  budget.pages.set(relPath, pending);
  return (await pending) as T | null;
}

interface FastManifest {
  profile_buckets: number;
  verse_chunk_size: number;
  lookup_buckets?: number;
  lookup_sub_buckets?: number;
  selective?: boolean;
  packed?: boolean;
  direct_b64gz?: boolean;
  r12_pilot?: string;
  r12_version?: string;
  witness_version?: string;
  r12_pilot_anchors?: number;
  r12_pilot_embedded?: boolean;
  r12_score_version?: string;
  r12_pilot_anchors_list?: string[];
  r12_external_sources?: Array<{ id: string; provider: string; release: string; license: string; archive_sha256?: string; extract_sha256?: string }>;
  r12_external_mappings?: Array<Record<string, any>>;
  strongs_lookup_upper_bucket?: boolean;
  motifs_event_keywords?: string[];
  verse_xrefs_embedded?: boolean;
  verse_events_embedded?: boolean;
  verse_scenes_embedded?: boolean;
}
type ReadBudget = { used: number; max: number; missing?: string[]; pages?: Map<string, Promise<any>>; b64Cache?: Map<string, any> };

interface MotifsData {
  schema_version?: string | number;
  motifs: Record<string, any>;
  motif_pairs?: Record<string, any>;
  motif_pairs_b64gz?: string;
  events?: any[];
  events_b64gz?: string;
  event_keywords?: string[];
  event_seq?: Record<string, { prev: string | null; next: string | null; title: string; start_date?: string | null; sample_vids?: number[] }>;
  event_by_chapter?: Record<string, string[]>;
  r13_motifs_b64gz?: string;
  r13_motifs_by_bs?: Record<string, string[]>;
  r13_motifs_by_vid?: Record<string, string[]>;
}

interface R12PilotBundle {
  schema_version: number;
  release_id: string;
  score_version: string;
  pilot_anchors: string[];
  external_sources?: Array<{ id: string; provider: string; release: string; license: string; archive_sha256?: string; extract_sha256?: string }>;
  external_mappings?: Array<Record<string, any>>;
  anchors: Record<string, any>;
}

async function readR12Pilot(
  reader: AssetReader,
  releaseId: string,
  manifest: FastManifest | null | undefined,
  budget: ReadBudget,
): Promise<R12PilotBundle | null> {
  const pilotRel = manifest?.r12_pilot || 'r12-pilot.json.gz';
  return readR10Json<R12PilotBundle>(reader, releaseId, pilotRel, budget);
}

function r12MultihopRecToRecord(anchorData: any, rec: any): R10EvidenceRecord {
  const best = rec.best_path || {};
  const steps: any[] = best.steps || [];
  const tWord = rec.target_word || best.target_word;
  const passages: R10PassageRef[] = [];
  const seenVid = new Set<number>();
  const pushPassage = (p: any) => {
    if (!p?.ref) return;
    const vid = Number(p.verse_id || 0);
    if (vid && seenVid.has(vid)) return;
    seenVid.add(vid || passages.length + 1);
    passages.push({
      verse_id: vid,
      ref: p.ref,
      mt_ref: p.mt_ref,
      book: Number(p.book || 1),
      chapter: Number(p.chapter || 1),
      verse: Number(p.verse || 1),
      testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
      snippet: p.snippet,
    });
  };
  for (const p of rec.direct_endpoint_witnesses || []) pushPassage(p);
  for (const p of rec.endpoint_bridge_witnesses || []) pushPassage(p);
  for (const st of steps) {
    for (const p of st.witness_passages || []) pushPassage(p);
  }
  const origWords: R10OriginalWordRef[] = [
    {
      strongs: anchorData.bs,
      language: anchorData.lang || 'hbo',
      lemma_script: anchorData.sc,
      transliteration: anchorData.tr,
      gloss: anchorData.gl,
    },
    ...(tWord
      ? [{
          strongs: tWord.strongs,
          language: tWord.language || 'grc',
          lemma_script: tWord.script,
          transliteration: tWord.transliteration,
          gloss: tWord.gloss,
        }]
      : []),
  ];
  const hops = best.meaningful_hops ?? steps.length;
  const chainStr = steps.map((s: any) => `${s.from_label} --[${s.relation_type}]--> ${s.to_label}`).join(' ; ');
  const isHypothesis = rec.epistemic_layer === 'HYPOTHESIS' || rec.evidence_status === 'MIXED_OR_EXPLORATORY';
  const epStatus: 'DIRECT_ENDPOINT_WITNESS' | 'COHERENT_MULTIHOP_LEAD' | 'BRIDGE_SUPPORTED_PATH' | 'EXPLORATORY_STEP_CHAIN' =
    rec.endpoint_epistemic_status || (isHypothesis ? 'EXPLORATORY_STEP_CHAIN' : 'BRIDGE_SUPPORTED_PATH');

  let tier: R10EvidenceTier = 5;
  let epistClass: R10EpistemicClass = 'documented_cross_language_bridge';
  let finalScore = Math.round(580 + (rec.interest || 0) * 200);
  if (epStatus === 'DIRECT_ENDPOINT_WITNESS') {
    tier = 4;
    epistClass = 'documented_collocation_or_cooccurrence';
    finalScore = Math.round(720 + (rec.interest || 0) * 170);
  } else if (isHypothesis || epStatus === 'EXPLORATORY_STEP_CHAIN') {
    tier = 6;
    epistClass = 'candidate_literary_pattern';
    finalScore = Math.round(420 + (rec.interest || 0) * 180);
  } else if (epStatus === 'COHERENT_MULTIHOP_LEAD') {
    tier = 5;
    epistClass = 'documented_cross_language_bridge';
    finalScore = Math.round(660 + (rec.interest || 0) * 180);
  }

  return {
    evidence_id: rec.evidence_id,
    predicate: 'multihop_proof_path',
    evidence_tier: tier,
    epistemic_class: epistClass,
    title: `R12 ${hops}-hop discovery: ${anchorData.sc} (${anchorData.bs}) → ${tWord ? `${tWord.script} ("${tWord.gloss}", ${tWord.strongs})` : rec.target_id}`,
    summary: `${hops}-hop source-backed discovery path (${epStatus.replace(/_/g, ' ').toLowerCase()}, K=${rec.K ?? rec.endpoint_coherence ?? 1}, endpoint_groups=${rec.endpoint_support_group_count ?? 0}, step_groups=${rec.step_support_group_count ?? rec.independent_group_count}; interest=${rec.interest}): ${chainStr}`,
    source_node_id: rec.anchor_id,
    target_node_id: rec.target_id,
    passages: passages.slice(0, 6),
    original_words: origWords,
    matched_terms: [anchorData.gl, anchorData.bs, tWord?.gloss, tWord?.strongs].filter(Boolean),
    limitations: [
      rec.limitation || 'A multi-hop source path connects intermediate attested steps without proving endpoint semantic identity or authorial intent.',
    ],
    provenance: {
      source_dataset: [...new Set(steps.map((s: any) => s.source_dataset).filter(Boolean))].join(' + ') || 'MACULA + STEPBible + CATSS/Swete',
      source_record_ids: (rec.independent_evidence_groups || []).slice(0, 8),
      license: 'CC BY 4.0',
      derivation_method: 'r12_offline_beam_proof_ranker_v2',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: Math.round((rec.D || 0) * 100),
      witness_bonus: Math.round((rec.C || 0) * 100),
      common_word_penalty: Math.round((rec.hub_penalty || 0) * 100),
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: finalScore,
    },
    r12_metadata: {
      score_version: rec.score_version || 'r12-ranker-v2',
      epistemic_layer: rec.epistemic_layer || 'LINGUISTIC',
      epistemic_status: rec.evidence_status === 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION'
        ? 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION'
        : 'EXPLORATORY',
      meaningful_hops: hops,
      physical_hops: best.physical_hops ?? steps.length,
      Q: rec.Q ?? 0,
      K: rec.K ?? rec.endpoint_coherence,
      endpoint_coherence: rec.endpoint_coherence ?? rec.K,
      endpoint_epistemic_status: epStatus,
      C: rec.C ?? 0,
      D: rec.D ?? 0,
      T: rec.T ?? 0,
      hub_penalty: rec.hub_penalty ?? 0,
      interest: rec.interest ?? 0,
      mmr_score: rec.mmr_score,
      step_support_group_count: rec.step_support_group_count ?? rec.independent_group_count ?? 0,
      endpoint_support_group_count: rec.endpoint_support_group_count ?? 0,
      independent_group_count: rec.independent_group_count ?? 0,
      independent_evidence_groups: rec.independent_evidence_groups || [],
      direct_endpoint_witnesses: rec.direct_endpoint_witnesses || [],
      endpoint_bridge_witnesses: rec.endpoint_bridge_witnesses || [],
      alternative_path_count: (rec.alternative_paths || []).length,
      steps: steps.map((s: any) => ({
        edge_id: s.edge_id,
        from_id: s.from_id,
        from_label: s.from_label,
        to_id: s.to_id,
        to_label: s.to_label,
        relation_type: s.relation_type,
        direction: s.direction,
        epistemic_layer: s.epistemic_layer,
        quality_weight: s.quality_weight,
        administrative: s.administrative,
        source_dataset: s.source_dataset,
        witness_refs: s.witness_refs,
      })),
      alternative_paths: (rec.alternative_paths || []).slice(0, 3).map((ap: any) => ({
        path_id: ap.path_id,
        partial_interest: ap.partial_interest,
        steps: (ap.steps || []).map((s: any) => ({
          edge_id: s.edge_id,
          from_id: s.from_id,
          from_label: s.from_label,
          to_id: s.to_id,
          to_label: s.to_label,
          relation_type: s.relation_type,
          epistemic_layer: s.epistemic_layer,
          quality_weight: s.quality_weight,
          witness_refs: s.witness_refs,
        })),
      })),
    },
  };
}

function r12PropertyBridgeToRecord(anchorData: any, b: any): R10EvidenceRecord {
  const tWord = b.target_word;
  const topFeat = b.shared_features?.[0];
  const leftRef = topFeat?.left?.[0];
  const rightRef = topFeat?.right?.[0];
  const tier: R10EvidenceTier = 5;
  const isEquiv = b.bridge_kind === 'external_concept_equivalence';
  const finalScore = isEquiv ? Math.round(780 + (b.score || 0) * 80) : Math.round(730 + (b.score || 0) * 80);
  const origWords: R10OriginalWordRef[] = [
    {
      strongs: anchorData.bs,
      language: anchorData.lang || 'hbo',
      lemma_script: anchorData.sc,
      transliteration: anchorData.tr,
      gloss: anchorData.gl,
    },
    ...(tWord
      ? [{
          strongs: tWord.strongs,
          language: tWord.language || 'grc',
          lemma_script: tWord.script,
          transliteration: tWord.transliteration,
          gloss: tWord.gloss,
        }]
      : []),
  ];

  const sourceIds = [
    leftRef?.source_id,
    rightRef?.source_id,
    ...(b.shared_features || []).slice(0, 3).flatMap((sf: any) => [sf.left?.[0]?.source_id, sf.right?.[0]?.source_id]),
  ].filter(Boolean);

  return {
    evidence_id: b.evidence_id,
    predicate: 'shared_external_property',
    evidence_tier: tier,
    epistemic_class: 'external_world_fact',
    title: isEquiv
      ? `External concept equivalence: ${anchorData.sc} (${anchorData.gl}) ↔ ${tWord ? `${tWord.script} ("${tWord.gloss}")` : b.target_id} via "${b.value_label}"`
      : `Physical/semantic bridge: ${anchorData.sc} (${anchorData.gl}) ↔ ${tWord ? `${tWord.script} ("${tWord.gloss}")` : b.target_id} via "${b.value_label}"`,
    summary: `External ${isEquiv ? 'concept equivalence' : 'property bridge'} (${b.mapping_status} mapping; ${leftRef?.provider || 'OEWN/Wikidata'}) linking ${anchorData.bs} (${b.left_mapping?.sense_gloss || anchorData.gl}) and ${tWord?.strongs || b.target_id} (${b.right_mapping?.sense_gloss || tWord?.gloss || ''}) via shared property ${b.property_key}=${b.value_label}. Independent biblical support=0 (exploratory hypothesis).`,
    source_node_id: b.anchor_id,
    target_node_id: b.target_id,
    passages: (b.passages || []).slice(0, 6).map((p: any) => ({
      verse_id: Number(p.verse_id || 0),
      ref: p.ref,
      mt_ref: p.mt_ref,
      book: Number(p.book || 1),
      chapter: Number(p.chapter || 1),
      verse: Number(p.verse || 1),
      testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
      snippet: p.snippet,
    })),
    original_words: origWords,
    matched_terms: [anchorData.gl, tWord?.gloss, b.value_label, anchorData.bs, tWord?.strongs].filter(Boolean),
    limitations: [
      b.limitation || 'Shared externally sourced physical/semantic properties are exploratory research leads, not biblical identifications or proof of authorial intent.',
      ...(b.mapping_status === 'candidate' ? ['Lexical-to-external synset/QID mapping is candidate-grade due to polysemy; context determines which biblical sense applies.'] : []),
    ],
    provenance: {
      source_dataset: (() => {
        const rawProviders = [...new Set([leftRef?.provider, rightRef?.provider].filter(Boolean))];
        if (rawProviders.some((p) => /WordNet|Wikidata/i.test(p))) return rawProviders.join(' + ');
        return `${rawProviders.join(' + ') || 'BibleResearch Derived Physical Graph'} (derived from Wikidata / OpenEnglishWordNet 2025)`;
      })(),
      source_record_ids: [...new Set(sourceIds)].slice(0, 8),
      license: [...new Set([leftRef?.license, rightRef?.license].filter(Boolean))].join(' ; ') || 'CC BY 4.0 / CC0 1.0',
      derivation_method: 'r12_external_property_bridge',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: Math.round((b.score || 0) * 160),
      witness_bonus: 0,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: finalScore,
    },
    r12_metadata: {
      score_version: 'r12-ranker-v2',
      epistemic_layer: 'EXTERNAL_WORLD',
      epistemic_status: 'EXPLORATORY',
      meaningful_hops: 2,
      physical_hops: 2,
      Q: b.score ?? 0.5,
      C: 0,
      D: Number((topFeat?.rarity ? Math.min(1, topFeat.rarity / 6) : 0.7).toFixed(4)),
      T: 0.25,
      hub_penalty: 0,
      interest: b.score ?? 0.5,
      independent_group_count: 0,
      independent_evidence_groups: [],
      alternative_path_count: Math.max(0, (b.shared_features?.length || 1) - 1),
      external_bridge: {
        property_key: b.property_key,
        value_id: b.value_id,
        value_label: b.value_label,
        bridge_kind: b.bridge_kind || 'shared_external_property',
        assertion_origin: b.assertion_origin,
        left_sense_id: b.anchor_sense_id,
        right_sense_id: b.target_sense_id,
        mapping_status: b.mapping_status === 'verified' ? 'verified' : 'candidate',
        claim_status: b.claim_status === 'sourced' ? 'sourced' : 'candidate',
        independent_biblical_support: 0,
        left_mapping: b.left_mapping || null,
        right_mapping: b.right_mapping || null,
        shared_features: b.shared_features || [],
      },
    },
  };
}

function r12StructuralToRecord(anchorData: any, s: any): R10EvidenceRecord {
  const tier: R10EvidenceTier = 6;
  const finalScore = Math.round(620 + (s.weighted_jaccard || 0) * 140);
  return {
    evidence_id: s.evidence_id,
    predicate: 'structural_scene_parallel',
    evidence_tier: tier,
    epistemic_class: 'candidate_literary_pattern',
    title: `Structural clause parallel: ${s.anchor_ref} ↔ ${s.candidate_ref} (${s.all_shared_feature_count} shared roles, J=${s.weighted_jaccard})`,
    summary: `Candidate R8 grammatical scene parallel around ${anchorData.sc} (${anchorData.bs}) comparing ${s.anchor_ref} and ${s.candidate_ref} across ${(s.distinctive_shared_features || []).map((f: any) => `${f.role}=${f.value}`).join(', ')}.`,
    source_node_id: s.anchor_scene_id,
    target_node_id: s.candidate_scene_id,
    passages: (s.passages || []).slice(0, 6).map((p: any) => ({
      verse_id: Number(p.verse_id || 0),
      ref: p.ref,
      mt_ref: p.mt_ref,
      book: Number(p.book || 1),
      chapter: Number(p.chapter || 1),
      verse: Number(p.verse || 1),
      testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
      snippet: p.snippet,
    })),
    original_words: [{
      strongs: anchorData.bs,
      language: anchorData.lang || 'hbo',
      lemma_script: anchorData.sc,
      transliteration: anchorData.tr,
      gloss: anchorData.gl,
    }],
    matched_terms: [anchorData.gl, anchorData.bs, s.anchor_ref, s.candidate_ref].filter(Boolean),
    limitations: [s.limitation || 'Shared structural clause roles are candidate parallels, not proof of authorial dependence.'],
    provenance: {
      source_dataset: 'MACULA Hebrew & Greek R8 Grammatical Frames',
      source_record_ids: [...(s.anchor_witness_ids || []), ...(s.candidate_witness_ids || [])].slice(0, 6),
      license: 'CC BY 4.0',
      derivation_method: 'r12_structural_role_weighted_jaccard',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: Math.round((s.weighted_jaccard || 0) * 140),
      witness_bonus: Math.min(30, (s.all_shared_feature_count || 0) * 8),
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: finalScore,
    },
    r12_metadata: {
      score_version: 'r12-ranker-v2',
      epistemic_layer: 'HYPOTHESIS',
      epistemic_status: 'EXPLORATORY',
      meaningful_hops: 2,
      physical_hops: 2,
      Q: s.weighted_jaccard ?? 0.5,
      C: 0.25,
      D: s.weighted_jaccard ?? 0.5,
      T: 0.25,
      hub_penalty: 0,
      interest: s.weighted_jaccard ?? 0.5,
      independent_group_count: 2,
      independent_evidence_groups: [...(s.anchor_witness_ids || []), ...(s.candidate_witness_ids || [])].slice(0, 4),
      alternative_path_count: 0,
      structural_match: {
        weighted_jaccard: s.weighted_jaccard,
        shared_feature_families: s.shared_feature_families || [],
        shared_features: s.distinctive_shared_features || [],
        anchor_witness_ids: s.anchor_witness_ids || [],
        candidate_witness_ids: s.candidate_witness_ids || [],
      },
    },
  };
}

function r12OrthographicToRecord(anchorData: any, o: any): R10EvidenceRecord {
  const tWord = o.target_word;
  const coocc = Number(o.cooccurrence_verses || 0);
  const tier: R10EvidenceTier = coocc > 0 ? 6 : 7;
  const finalScore = coocc > 0
    ? Math.round(620 + (o.score || 0) * 180)
    : Math.round(430 + (o.score || 0) * 120);
  return {
    evidence_id: o.evidence_id,
    predicate: 'orthographic_overlap',
    evidence_tier: tier,
    epistemic_class: 'orthographic_similarity_only',
    title: `Orthographic similarity: ${o.anchor_original} (${anchorData.bs}) ↔ ${o.target_form} (${tWord?.strongs || o.target_id}, matched "${o.matched_normalized_text}")`,
    summary: `Unpointed/unaccented script similarity (${o.normalization}, score=${o.score}, shared segment "${o.matched_normalized_text}"${coocc > 0 ? `, co-occurs in ${coocc} canonical verse(s)` : ''}). ${o.limitation}`,
    source_node_id: o.anchor_id,
    target_node_id: o.target_id,
    passages: (o.passages || []).slice(0, 4).map((p: any) => ({
      verse_id: Number(p.verse_id || 0),
      ref: p.ref,
      mt_ref: p.mt_ref,
      book: Number(p.book || 1),
      chapter: Number(p.chapter || 1),
      verse: Number(p.verse || 1),
      testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
      snippet: p.snippet,
    })),
    original_words: [
      { strongs: anchorData.bs, language: anchorData.lang || 'hbo', lemma_script: anchorData.sc, transliteration: anchorData.tr, gloss: anchorData.gl },
      ...(tWord ? [{ strongs: tWord.strongs, language: tWord.language || 'hbo', lemma_script: tWord.script, transliteration: tWord.transliteration, gloss: tWord.gloss }] : []),
    ],
    matched_terms: [anchorData.gl, tWord?.gloss, o.matched_normalized_text].filter(Boolean),
    limitations: [o.limitation || 'Shared spelling does not establish root, etymology, meaning, or intentional wordplay.'],
    provenance: {
      source_dataset: 'STEPBible Canonical Lemma Script',
      source_record_ids: [anchorData.bs, tWord?.strongs].filter(Boolean),
      license: 'CC BY 4.0',
      derivation_method: 'r12_orthographic_bigram_containment',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: Math.round((o.score || 0) * 100),
      witness_bonus: 0,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 40,
      final_score: finalScore,
    },
    r12_metadata: {
      score_version: 'r12-ranker-v2',
      epistemic_layer: 'HYPOTHESIS',
      epistemic_status: 'EXPLORATORY',
      meaningful_hops: 1,
      physical_hops: 1,
      Q: o.score ?? 0.5,
      C: 0,
      D: o.score ?? 0.5,
      T: 0.25,
      hub_penalty: 0,
      interest: Number(((o.score || 0.5) * 0.5).toFixed(4)),
      raw_orthographic_score: o.raw_orthographic_score,
      cooccurrence_verses: coocc,
      independent_group_count: 0,
      independent_evidence_groups: [],
      alternative_path_count: 0,
    },
  };
}

async function readR10Key(reader: AssetReader, release: string, file: string, key: string, field: string, budget: ReadBudget): Promise<any> {
  const index = await readR10Json<any>(reader, release, file, budget);
  if (index?.schema_version === 'r10-packed-1') {
    const entry = index.entries?.[key];
    if (!entry) return null;
    const [blob, start, length] = entry;
    return readR10Json(reader, release, `${blob}#bytes=${start}-${start + length - 1}`, budget);
  }
  const values = index?.[field];
  return Array.isArray(values) ? values.find((pair: any[]) => pair[0] === key)?.[1] : values?.[key];
}

/** Read only the deterministic key branch; missing pages never trigger legacy scans. */
export async function readSelectiveKey(reader: AssetReader, release: string, namespace: string, key: string, budget: ReadBudget): Promise<any> {
  const hash = BigInt('0x' + fnv1a64Hex(key)).toString(2).padStart(64, '0');
  let prefix = hash.slice(0, namespace === 'refs' ? 7 : 8);
  for (;;) {
    const page = await readR10Json<any>(reader, release, `selective/${namespace}/${prefix}.json.gz`, budget);
    if (!page) return null;
    if (page.routes) {
      const route = page.routes.find((value: string) => hash.startsWith(value));
      if (!route || route.length <= prefix.length) return null;
      prefix = route;
    } else if (page.split) {
      const digit = hash[prefix.length];
      if (!digit || !page.split.includes(digit)) return null;
      prefix += digit;
    } else if (page.continuation) {
      if (page.continuation.key !== key) return null;
      let serialized = '';
      for (const rel of page.continuation.pages) {
        const part = await readR10Json<{ text: string }>(reader, release, rel, budget);
        if (!part) return null;
        serialized += part.text;
      }
      return JSON.parse(serialized);
    } else return page.entries?.[key] ?? null;
  }
}

function sanitizeLoadedProfile(prof: LemmaProfile | null): LemmaProfile | null {
  if (!prof) return null;
  if (prof.bs === 'G2495' && (/\bJohn\b/i.test(prof.gl || '') || /^lemma:G2491/i.test(prof.lk || ''))) {
    return { ...prof, lk: 'lemma:G2495', sc: 'Ἰωνᾶς', tr: 'Iōnas', gl: 'Jonah' };
  }
  if (prof.bs === 'H6030' && (/\bto dwell\b/i.test(prof.gl || '') || /עוּן/.test(prof.sc || ''))) {
    return { ...prof, lk: 'lemma:H6030B', sc: 'עָנָה', tr: 'a.nah', gl: 'to answer' };
  }
  return prof;
}

async function readProfile(reader: AssetReader, release: string, manifest: FastManifest | null, bs: string, budget: ReadBudget): Promise<LemmaProfile | null> {
  if (manifest?.direct_b64gz) {
    const bucket = computeBucketHex('fnv1a64_mod1024', 1024, bs);
    const shard = await readR10Json<{ profiles?: Record<string, string> }>(reader, release, `fast-profiles/shard-${bucket}.json.gz`, budget);
    const b64 = shard?.profiles?.[bs];
    if (!b64) return null;
    return sanitizeLoadedProfile(await decodeB64Gz<LemmaProfile>(reader, b64, `/r10/p:${release}:${bs}`, (budget.b64Cache ||= new Map())));
  }
  if (manifest?.selective) return sanitizeLoadedProfile(await readSelectiveKey(reader, release, 'profiles', bs, budget));
  const bucket = computeBucketHex(manifest ? 'fnv1a64_mod1024' : 'fnv1a64_mod64', manifest?.profile_buckets || 64, bs);
  if (manifest?.packed) return sanitizeLoadedProfile(await readR10Key(reader, release, `fast-profiles/shard-${bucket}.json.gz`, bs, 'entries', budget));
  const shard = await readR10Json<{ entries?: Record<string, LemmaProfile> }>(reader, release, `${manifest ? 'fast-profiles' : 'lemma-profiles'}/shard-${bucket}.json.gz`, budget);
  return sanitizeLoadedProfile(shard?.entries?.[bs] || null);
}

interface ConceptIndexData {
  aliases: Record<string, {
    strongs?: string[];
    motifs?: string[];
    numbers?: number[];
    note?: string;
    passages?: R10PassageRef[];
    original_words?: R10OriginalWordRef[];
  }>;
  book_names: Array<{ id: number; name: string; usfm: string; chapters: number }>;
}

export interface LemmaProfile {
  bs: string;
  lk: string;
  lang: 'hbo' | 'grc';
  sc: string;
  tr: string;
  gl: string;
  pos: string;
  entity_kind?: string;
  senses: Array<{ key: string; gl: string; note?: string }>;
  total_verses: number;
  all_vids: number[];
  forms: Array<{ sf: string; tr: string; gl: string; mc?: string; cnt: number; vid?: number }>;
  clusters: Array<{
    cluster_id: string;
    category: string;
    label: string;
    summary: string;
    vids: number[];
    sample_passages: Array<{
      verse_id: number;
      ref: string;
      mt_ref?: string;
      book: number;
      chapter: number;
      verse: number;
      testament: 'OT' | 'NT';
      snippet: string;
      has_simile: boolean;
    }>;
    collocated_words: Array<{ bs: string; sc: string; tr: string; gl: string; hits: number; score: number }>;
    has_simile: boolean;
    xrefs: Array<{ from_vid: number; to_vid: number; to_ref: string; phrase: string; is_same_lemma: boolean }>;
  }>;
  grammatical_relations: Array<{
    predicate: string;
    direction: 'incoming' | 'outgoing';
    display_label: string;
    related_strongs: string;
    related_script: string;
    related_gloss: string;
    occurrences: number;
    independent_witness_count?: number;
    witnesses?: Array<{ relation_id: string; clause_key: string; edition: string; subject_token_id: string; object_token_id: string; passage: R10PassageRef }>;
    witness_status?: string;
  }>;
  lexical_relations: any[];
  lxx_relations: any[];
  homograph_siblings: Array<{ bs: string; lk?: string; sc: string; tr: string; gl: string }>;
  first_occ_passages?: R10PassageRef[];
  orth_entry?: any;
  r12_pilot_anchor?: any;
  r13_wordplay?: any[];
  r13_colloc?: Array<[string, number, number, number[]]>;
  r13_motif_ids?: string[];
}

const BOOK_LOOKUP_CACHE = new WeakMap<ConceptIndexData['book_names'], Map<string, number>>();

function parsePassageReferences(rawQuery: string, bookNames: ConceptIndexData['book_names']): Array<{ refText: string; book: number; chapter: number; verse: number | null; endVerse?: number }> {
  if (!/[A-Za-z]\s+\d/.test(rawQuery)) return [];
  let bookLookup = BOOK_LOOKUP_CACHE.get(bookNames);
  if (!bookLookup) {
    bookLookup = new Map<string, number>();
    for (const b of bookNames) {
      bookLookup.set(b.name.toLowerCase(), b.id);
      bookLookup.set(b.usfm.toLowerCase(), b.id);
    }
    const aliases: Record<string, number> = {
      gen: 1, exod: 2, ex: 2, lev: 3, num: 4, deut: 5, josh: 6, judg: 7,
      '1 sam': 9, '2 sam': 10, '1 kgs': 11, '2 kgs': 12, ps: 19, psa: 19, psalm: 19,
      prov: 20, isa: 23, jer: 24, ezek: 26, dan: 27, zech: 38, mal: 39,
      matt: 40, mt: 40, mk: 41, lk: 42, jn: 43, acts: 44, rom: 45,
      '1 cor': 46, '1 corinthians': 46, '2 cor': 47, gal: 48, eph: 49,
      heb: 58, jas: 59, '1 pet': 60, '1 peter': 60, rev: 66,
    };
    for (const [k, v] of Object.entries(aliases)) bookLookup.set(k, v);
    BOOK_LOOKUP_CACHE.set(bookNames, bookLookup);
  }
  const out: Array<{ refText: string; book: number; chapter: number; verse: number | null; endVerse?: number }> = [];

  const re = /\b([1-3]?\s?[A-Za-z]+)\s+(\d{1,3})(?::(\d{1,3})(?:[-–](\d{1,3}))?)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawQuery)) !== null) {
    const bName = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
    const bid = bookLookup.get(bName) ?? bookLookup.get(bName.replace(/s$/, ''));
    if (!bid) continue;
    const ch = Number(m[2]);
    const vs = m[3] !== undefined ? Number(m[3]) : null;
    const endVs = m[4] !== undefined ? Number(m[4]) : undefined;
    out.push({ refText: m[0], book: bid, chapter: ch, verse: vs, endVerse: endVs });
  }
  return out;
}

function tokenizeTerms(query: DiscoverConnectionsQuery): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  const rawList: string[] = [];
  if (query.concepts && query.concepts.length > 0) {
    rawList.push(...query.concepts);
  }
  const cleaned = normalizeNumberPhrases(String(query.query || ''))
    .replace(/([A-Za-z]+)'s\b/g, '$1')
    .replace(/[?:,;()[\]{}"]/g, ' ');
  for (const part of cleaned.split(/[\s,/]+/)) {
    if (part.trim()) rawList.push(part.trim());
  }
  for (const item of rawList) {
    // Handle Strong's codes immediately
    const sm = item.toUpperCase().match(/^([HG])0*(\d+)([A-Z]?)$/);
    if (sm) {
      const code = `${sm[1]}${sm[2].padStart(4, '0')}`;
      if (!seen.has(code)) {
        seen.add(code);
        terms.push(code);
      }
      continue;
    }
    const norm = stripPossessive(normalizeToken(item));
    if (!norm || norm.length < 2 && !NUMBER_WORDS[norm]) continue;
    if (QUERY_STOPWORDS.has(norm)) continue;
    if (!seen.has(norm)) {
      seen.add(norm);
      terms.push(norm);
    }
  }
  return terms.slice(0, 16);
}

function createPassageHydrator(
  reader: AssetReader,
  releaseId: string,
  fastManifest: FastManifest | null | undefined,
  budget: ReadBudget,
  defaultNeedToks = false,
) {
  const fastVerseCache = new Map<number, any>();
  const bookCache = new Map<number, any>();
  const chunkMetaCache = new Map<number, { xrefs?: any[]; events?: string[]; scenes?: any[] }>();
  async function loadBookData(bookId: number): Promise<any> {
    if (bookCache.has(bookId)) return bookCache.get(bookId);
    const pad = String(bookId).padStart(2, '0');
    const data = await readR10Json<{ verses?: Record<string, any> }>(
      reader, releaseId, `evidence-passages/book-${pad}.json.gz`, budget
    );
    const verses = data?.verses || null;
    bookCache.set(bookId, verses);
    return verses;
  }

  async function hydratePassageByVid(vid: number, needToks = defaultNeedToks): Promise<R10PassageRef | null> {
    const book = bookForVid(vid);
    let v;
    if (fastManifest?.direct_b64gz) {
      const cachedV = bookCache.get(book)?.[String(vid)];
      if (cachedV && (!needToks || cachedV.toks)) {
        v = cachedV;
      } else {
        const chunkNum = Math.floor((vid - 1) / (fastManifest.verse_chunk_size || 64));
        const chunkHex = chunkNum.toString(16).padStart(3, '0');
        const chunk = await readR10Json<{
          summaries?: Record<string, [number, number, number, string, string, string | null | undefined]>;
          verses?: Record<string, string>;
          xrefs?: Record<string, any[]>;
          events?: Record<string, string[]>;
          scenes?: Record<string, any[]>;
        }>(reader, releaseId, `fast-verses/chunk-${chunkHex}.json.gz`, budget);
        if (chunk?.xrefs?.[String(vid)] || chunk?.events?.[String(vid)] || chunk?.scenes?.[String(vid)]) {
          chunkMetaCache.set(vid, {
            xrefs: chunk.xrefs?.[String(vid)],
            events: chunk.events?.[String(vid)],
            scenes: chunk.scenes?.[String(vid)],
          });
        }
        if (!needToks && chunk?.summaries?.[String(vid)]) {
          const [sBook, sChapter, sVerse, sRef, sEn, sMtRef] = chunk.summaries[String(vid)];
          return {
            verse_id: vid,
            ref: sRef,
            ...(sMtRef !== null && sMtRef !== undefined ? { mt_ref: sMtRef } : {}),
            book: sBook,
            chapter: sChapter,
            verse: sVerse,
            testament: sBook <= 39 ? 'OT' : 'NT',
            snippet: sEn,
            is_psalm_heading: sBook === 19 && sVerse === 0,
          };
        }
        const b64 = chunk?.verses?.[String(vid)];
        if (b64) {
          v = await decodeB64Gz<any>(reader, b64, `/r10/v:${releaseId}:${vid}`, budget.b64Cache);
          if (v) bookCache.set(book, { ...(bookCache.get(book) || {}), [String(vid)]: v });
        }
      }
    } else if (fastManifest?.packed) {
      const chunk = Math.floor((vid - 1) / fastManifest.verse_chunk_size);
      v = await readR10Key(reader, releaseId, `fast-verses/chunk-${chunk.toString(16).padStart(3, '0')}.json.gz`, String(vid), 'verses', budget);
      if (v) bookCache.set(book, { ...(bookCache.get(book) || {}), [String(vid)]: v });
    } else if (fastManifest?.selective) {
      v = await readSelectiveKey(reader, releaseId, 'verses', String(vid), budget);
      if (v) bookCache.set(book, { ...(bookCache.get(book) || {}), [String(vid)]: v });
    } else if (fastManifest) {
      const chunk = Math.floor((vid - 1) / fastManifest.verse_chunk_size);
      if (!fastVerseCache.has(chunk)) {
        const data = await readR10Json<{ verses: Record<string, any> }>(reader, releaseId, `fast-verses/chunk-${chunk.toString(16).padStart(3, '0')}.json.gz`, budget);
        fastVerseCache.set(chunk, data?.verses || {});
      }
      v = fastVerseCache.get(chunk)?.[String(vid)];
      if (v) bookCache.set(book, { ...(bookCache.get(book) || {}), [String(vid)]: v });
    } else {
      const verses = await loadBookData(book);
      v = verses?.[String(vid)];
    }
    if (!v) return null;
    return {
      verse_id: vid,
      ref: v.ref,
      mt_ref: v.mt_ref,
      book: v.book,
      chapter: v.chapter,
      verse: v.verse,
      testament: v.book <= 39 ? 'OT' : 'NT',
      snippet: v.en,
      is_psalm_heading: v.book === 19 && v.verse === 0,
    };
  }

  return { bookCache, chunkMetaCache, loadBookData, hydratePassageByVid };
}

export async function discoverBiblicalConnections(
  reader: AssetReader,
  query: DiscoverConnectionsQuery,
  releaseId: string = query.release_id || DEFAULT_R10_RELEASE
): Promise<DiscoverConnectionsResult> {
  const tStart = Date.now();
  const budget: ReadBudget & { missing: string[] } = { used: 0, max: MAX_SUBREQUEST_BUDGET, missing: [], b64Cache: new Map<string, any>() };
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(query.limit ?? DEFAULT_LIMIT)));
  const offset = Math.max(0, Number.parseInt(String(query.cursor || '0'), 10) || 0);

  const [conceptIdx, explicitData, fastManifest] = await Promise.all([
    readR10Json(reader, releaseId, 'concept-index.json.gz', budget) as Promise<ConceptIndexData | null>,
    readR10Json(reader, releaseId, 'explicit-and-typology.json.gz', budget) as Promise<{
      records: any[];
      r13_self_interpretations?: SelfInterpretationRecord[];
    } | null>,
    readR10Json<FastManifest>(reader, releaseId, 'fast-manifest.json.gz', budget),
  ]);

  let motifsData: MotifsData | null = null;
  if (!fastManifest?.motifs_event_keywords) {
    motifsData = await readR10Json<MotifsData>(reader, releaseId, 'motifs-and-patterns.json.gz', budget);
  }

  if (!conceptIdx || !explicitData || (!fastManifest?.motifs_event_keywords && !motifsData)) {
    throw new Error(`R10 release indexes missing for release_id=${releaseId}`);
  }

  async function ensureMotifsData(): Promise<MotifsData | null> {
    if (!motifsData) {
      motifsData = await readR10Json<MotifsData>(reader, releaseId, 'motifs-and-patterns.json.gz', budget);
    }
    return motifsData;
  }

  const bookById = new Map((conceptIdx.book_names || []).map(b => [b.id, b]));
  const parsedRefs = parsePassageReferences(query.query || '', conceptIdx.book_names || []);
  let lexicalQuery = query.query || '';
  for (const ref of parsedRefs) lexicalQuery = lexicalQuery.replace(ref.refText, ' ');
  if (query.anchor_passage) {
    for (const apr of parsePassageReferences(query.anchor_passage, conceptIdx.book_names || [])) {
      if (!parsedRefs.some(r => r.book === apr.book && r.chapter === apr.chapter && r.verse === apr.verse)) {
        parsedRefs.push(apr);
      }
    }
  }
  const extractedTerms = tokenizeTerms({ ...query, query: lexicalQuery });
  const explicitPassages: R10PassageRef[] = parsedRefs.map(pr => {
    const bk = bookById.get(pr.book);
    return {
      verse_id: 0,
      ref: `${bk?.name || `Book ${pr.book}`} ${pr.chapter}${pr.verse !== null ? `:${pr.verse}` : ''}`,
      book: pr.book,
      chapter: pr.chapter,
      verse: pr.verse !== null ? pr.verse : 1,
      end_verse: pr.endVerse,
      testament: pr.book <= 39 ? 'OT' : 'NT',
      is_psalm_heading: pr.book === 19 && pr.verse === 0,
    };
  });

  const resolvedConcepts: R10ResolvedConcept[] = [];
  const missingConcepts: string[] = [];
  const matchedStrongs = new Set<string>();
  const matchedMotifs = new Set<string>();
  const matchedNumbers = new Set<number>();
  const matchedEvents: any[] = [];
  const lemmaCache = new Map<string, any>();
  const controls: R10ControlOrWarning[] = [];

  // Passage hydration helper
  const { bookCache, chunkMetaCache, loadBookData, hydratePassageByVid } = createPassageHydrator(
    reader, releaseId, fastManifest, budget, false,
  );



  const refTokensToIgnore = new Set<string>();
  const contextVerseIds = new Set<number>();
  for (const pr of parsedRefs) {
    refTokensToIgnore.add(String(pr.chapter));
    if (pr.verse !== null && pr.verse !== undefined) refTokensToIgnore.add(String(pr.verse));
    if (pr.endVerse) refTokensToIgnore.add(String(pr.endVerse));
    const bk = bookById.get(pr.book);
    if (bk) {
      refTokensToIgnore.add(bk.name.toLowerCase());
      refTokensToIgnore.add(bk.usfm.toLowerCase());
      refTokensToIgnore.add(bk.name.toLowerCase().replace(/s$/, ''));
    }
  }

  // Hydrate explicit passage references and capture embedded verse xrefs/events/scenes
  const explicitPassageMeta: Array<{ ep: R10PassageRef; xrefs: any[]; eventIds: string[]; scenes: any[]; contentStrongs: string[] }> = [];
  const pericopeNeighbors: Array<{ ep: R10PassageRef; xrefs: any[]; dist: number; parentRef: string }> = [];
  const seenPericopeVids = new Set<number>();
  const bookChapterVids = new Map<number, Record<string, number[]>>();
  let pericopeBoundaryReads = 0;
  const explicitToks: any[] = [];
  const explicitPassageVidSet = new Set<number>();
  const passageContentStrongs: string[] = [];
  const passageOtherStrongs: string[] = [];
  const MAX_EXPLICIT_SPAN_VERSES = 14;
  for (let epIdx = 0; epIdx < explicitPassages.length; epIdx++) {
    const ep = explicitPassages[epIdx];
    const pr = parsedRefs[epIdx];
    let verses;
    let chapterVidsForEp: number[] = [];
    let targetSpanVids: number[] = [];
    if (fastManifest?.direct_b64gz) {
      const pad = String(ep.book).padStart(2, '0');
      const index = await readR10Json<any>(reader, releaseId, `evidence-passages/book-${pad}.json.gz`, budget);
      if (index?.coord_to_vid) {
        if (index.chapter_vids) bookChapterVids.set(ep.book, index.chapter_vids);
        chapterVidsForEp = (index.chapter_vids?.[String(ep.chapter)] || []).map((v: any) => Number(v));
        for (const vid of chapterVidsForEp) contextVerseIds.add(vid);
        if (pr && pr.verse === null && chapterVidsForEp.length > 0) {
          targetSpanVids = chapterVidsForEp.slice();
        } else if (ep.end_verse && ep.end_verse > ep.verse) {
          for (let vn = ep.verse; vn <= ep.end_verse; vn++) {
            const vid = Number(index.coord_to_vid[`${ep.chapter}:${vn}`] || 0);
            if (vid > 0) targetSpanVids.push(vid);
          }
        } else {
          const vid = Number(index.coord_to_vid[`${ep.chapter}:${ep.verse}`] || 0);
          if (vid > 0) targetSpanVids.push(vid);
        }
        if (targetSpanVids.length > MAX_EXPLICIT_SPAN_VERSES) {
          const sampled: number[] = [];
          const n = targetSpanVids.length;
          for (let k = 0; k < MAX_EXPLICIT_SPAN_VERSES; k++) {
            const idxPos = k === MAX_EXPLICIT_SPAN_VERSES - 1
              ? n - 1
              : Math.floor((k * (n - 1)) / (MAX_EXPLICIT_SPAN_VERSES - 1));
            const sv = targetSpanVids[idxPos];
            if (!sampled.includes(sv)) sampled.push(sv);
          }
          targetSpanVids = sampled;
        }
        await Promise.all(targetSpanVids.map(vid => hydratePassageByVid(vid, true)));
        verses = bookCache.get(ep.book);
      } else if (index?.verses) {
        verses = index.verses;
        bookCache.set(ep.book, verses);
      }
    } else if (fastManifest?.selective) {
      const vid = await readSelectiveKey(reader, releaseId, 'refs', `${ep.book}:${ep.chapter}:${ep.verse}`, budget);
      if (vid) { targetSpanVids = [Number(vid)]; await hydratePassageByVid(Number(vid), true); }
      verses = bookCache.get(ep.book);
    } else if (fastManifest?.packed) {
      const bookFile = `evidence-passages/book-${String(ep.book).padStart(2, '0')}.json.gz`;
      const index = await readR10Json<any>(reader, releaseId, bookFile, budget);
      chapterVidsForEp = (index?.chapter_vids?.[String(ep.chapter)] || []).map((v: any) => Number(v));
      for (const vid of chapterVidsForEp) contextVerseIds.add(vid);
      const v = await readR10Key(reader, releaseId, bookFile, `${ep.chapter}:${ep.verse}`, 'verses', budget);
      if (v) { targetSpanVids = [Number(v.verse_id)]; await hydratePassageByVid(Number(v.verse_id), true); verses = bookCache.get(ep.book); }
    } else verses = await loadBookData(ep.book);

    if (verses) {
      const hydratedEntries: Array<{ vid: number; vVal: any }> = [];
      for (const [vKey, vVal] of Object.entries(verses) as [string, any][]) {
        const vid = Number(vKey);
        const inExplicitRange =
          targetSpanVids.length > 0
            ? targetSpanVids.includes(vid)
            : vVal.chapter === ep.chapter &&
              (pr?.verse === null
                ? true
                : vVal.verse >= ep.verse && vVal.verse <= (ep.end_verse ?? ep.verse));
        if (inExplicitRange) hydratedEntries.push({ vid, vVal });
      }
      hydratedEntries.sort((a, b) => a.vid - b.vid);

      const perVerseDistinctStrongs: string[][] = [];
      for (const { vid, vVal } of hydratedEntries) {
        explicitPassageVidSet.add(vid);
        if (ep.verse_id === 0 && vVal.chapter === ep.chapter && vVal.verse === ep.verse) {
          ep.verse_id = vid;
          ep.snippet = vVal.en;
          ep.mt_ref = vVal.mt_ref;
        }
        const meta = chunkMetaCache.get(vid);
        const verseContentStrongs: string[] = [];
        for (const t of vVal.toks || []) {
          explicitToks.push(t);
          if (!t.s || PRONOUN_OR_FUNC_STRONGS.has(t.s)) continue;
          const isFuncClass = isMaculaFuncClass(t.cl);
          if (!isFuncClass && !GENERIC_LIGHT_VERB_STRONGS.has(t.s) && !SMALL_NUMERAL_STRONGS.has(t.s)) {
            if (!verseContentStrongs.includes(t.s)) verseContentStrongs.push(t.s);
          } else if (!isFuncClass && !passageOtherStrongs.includes(t.s)) {
            passageOtherStrongs.push(t.s);
          }
        }
        perVerseDistinctStrongs.push(verseContentStrongs);
        const verseRef: R10PassageRef = vVal.verse === ep.verse && vVal.chapter === ep.chapter && hydratedEntries.length === 1
          ? ep
          : {
              verse_id: vid,
              ref: vVal.ref || `${bookById.get(ep.book)?.name || `Book ${ep.book}`} ${vVal.chapter}:${vVal.verse}`,
              ...(vVal.mt_ref ? { mt_ref: vVal.mt_ref } : {}),
              book: ep.book,
              chapter: vVal.chapter,
              verse: vVal.verse,
              testament: ep.book <= 39 ? 'OT' : 'NT',
              ...(vVal.en ? { snippet: vVal.en } : {}),
              is_psalm_heading: ep.book === 19 && vVal.verse === 0,
            };
        explicitPassageMeta.push({
          ep: verseRef,
          xrefs: meta?.xrefs || [],
          eventIds: meta?.events || [],
          scenes: meta?.scenes || [],
          contentStrongs: verseContentStrongs,
        });
      }
      // Round-robin content lemmas across ALL verses in the span so middle/closing verses are represented equally.
      const maxPerVerseLen = perVerseDistinctStrongs.reduce((m, arr) => Math.max(m, arr.length), 0);
      for (let pos = 0; pos < maxPerVerseLen; pos++) {
        for (const vArr of perVerseDistinctStrongs) {
          const s = vArr[pos];
          if (s && !passageContentStrongs.includes(s)) passageContentStrongs.push(s);
        }
      }

      if (ep.verse_id === 0 && hydratedEntries[0]) {
        ep.verse_id = hydratedEntries[0].vid;
        ep.snippet = hydratedEntries[0].vVal.en;
        ep.mt_ref = hydratedEntries[0].vVal.mt_ref;
      }

      if (!query.lite_subgraph_mode && explicitPassageVidSet.size <= 4 && fastManifest?.direct_b64gz && ep.verse_id > 0 && chapterVidsForEp.length > 0) {
        const chunkSize = fastManifest.verse_chunk_size || 64;
        const anchorEndVid = hydratedEntries.length > 0 ? hydratedEntries[hydratedEntries.length - 1].vid : ep.verse_id;
        for (const nVid of chapterVidsForEp) {
          const dist = Math.min(Math.abs(nVid - ep.verse_id), Math.abs(nVid - anchorEndVid));
          if (explicitPassageVidSet.has(nVid) || dist < 1 || dist > 12 || seenPericopeVids.has(nVid)) continue;
          const nChunkHex = Math.floor((nVid - 1) / chunkSize).toString(16).padStart(3, '0');
          const nChunkPath = `fast-verses/chunk-${nChunkHex}.json.gz`;
          if (!budget.pages?.has(nChunkPath)) {
            if (dist <= 4 && pericopeBoundaryReads < 1 && budget.used < budget.max - 10) {
              pericopeBoundaryReads++;
              await readR10Json(reader, releaseId, nChunkPath, budget);
            } else {
              continue;
            }
          }
          const nChunk = await budget.pages?.get(nChunkPath);
          const sum = nChunk?.summaries?.[String(nVid)];
          if (!sum) continue;
          seenPericopeVids.add(nVid);
          const [sBook, sChapter, sVerse, sRef, sEn, sMtRef] = sum;
          pericopeNeighbors.push({
            ep: {
              verse_id: nVid,
              ref: sRef,
              ...(sMtRef !== null && sMtRef !== undefined ? { mt_ref: sMtRef } : {}),
              book: sBook,
              chapter: sChapter,
              verse: sVerse,
              testament: sBook <= 39 ? 'OT' : 'NT',
              snippet: sEn,
              is_psalm_heading: sBook === 19 && sVerse === 0,
            },
            xrefs: nChunk?.xrefs?.[String(nVid)] || [],
            dist,
            parentRef: ep.ref,
          });
        }
      }
    }
  }
  const explicitPassageContentStrongsSet = new Set(passageContentStrongs);
  for (const s of (passageContentStrongs.length > 0 ? passageContentStrongs : passageOtherStrongs)) {
    matchedStrongs.add(s);
  }

  // Sharded lemma-lookup loader with caching
  const shardMemo = new Map<string, Map<string, any[]>>();
  async function fetchShard(key: string): Promise<any[]> {
    const normKey = String(key || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036F]/g, '')
      .replace(/[\u0591-\u05C7]/g, '')
      .trim()
      .toLowerCase()
      .replace(/ς/g, 'σ');
    if (fastManifest?.direct_b64gz && fastManifest.lookup_buckets === 1024) {
      const bucketKey = (fastManifest.strongs_lookup_upper_bucket && /^[hg]\d{4}$/.test(normKey))
        ? normKey.toUpperCase()
        : normKey;
      const bucket = computeBucketHex('fnv1a64_mod1024', 1024, bucketKey);
      const subIdx = Number((BigInt('0x' + fnv1a64Hex(normKey)) >> 10n) & 15n).toString(16);
      const shard = await readR10Json<{ lookup?: Record<string, string> }>(
        reader, releaseId, `fast-profiles/shard-${bucket}.json.gz`, budget
      );
      const b64 = shard?.lookup?.[subIdx];
      if (!b64) return [];
      const subMap = await decodeB64Gz<Record<string, any[]>>(
        reader, b64, `/r10/l:${releaseId}:${bucket}:${subIdx}`, budget.b64Cache
      );
      return subMap?.[normKey] || [];
    }
    if (fastManifest?.packed) {
      const bucket = computeBucketHex('fnv1a64_mod64', 64, normKey);
      return (await readR10Key(reader, releaseId, `lemma-lookup/shard-${bucket}.json.gz`, normKey, 'entries', budget)) || [];
    }
    if (fastManifest?.selective) return (await readSelectiveKey(reader, releaseId, 'lookup', normKey, budget)) || [];
    const bHex = computeBucketHex('fnv1a64_mod64', 64, normKey);
    if (!shardMemo.has(bHex)) {
      const shard = await readR10Json<{ entries?: Array<[string, any[]]> }>(
        reader, releaseId, `lemma-lookup/shard-${bHex}.json.gz`, budget
      );
      const map = new Map<string, any[]>();
      if (shard?.entries) {
        for (const [k, arr] of shard.entries) map.set(k, arr);
      }
      shardMemo.set(bHex, map);
    }
    return shardMemo.get(bHex)?.get(normKey) || [];
  }

  const NUMERAL_PREFERRED_STRONGS: Record<string, string[]> = {
    '40': ['h0705', 'g5062'],
    forty: ['h0705', 'g5062'],
  };

  async function lookupShardToken(tok: string): Promise<any[]> {
    const rawKey = /^[HG]\d+$/i.test(tok) ? tok.toLowerCase() : tok.toLowerCase();
    if (NUMERAL_PREFERRED_STRONGS[rawKey]) {
      const preferred = (await Promise.all(NUMERAL_PREFERRED_STRONGS[rawKey].map(s => fetchShard(s)))).flat();
      if (preferred.length > 0) return preferred;
    }
    let hits = await fetchShard(rawKey);
    if (hits.length === 0) {
      const sing = getSingularForm(rawKey);
      if (sing && sing !== rawKey) hits = await fetchShard(sing);
    }
    if (hits.length === 0) {
      for (const stem of getMorphStems(rawKey)) {
        hits = await fetchShard(stem);
        if (hits.length > 0) break;
      }
    }
    if (hits.length === 0 && QUERY_FALLBACK_ALIAS_MAP[rawKey]) {
      for (const fb of QUERY_FALLBACK_ALIAS_MAP[rawKey]) {
        hits = await fetchShard(fb);
        if (hits.length > 0) break;
      }
    }
    if (hits.length === 0 && /^[a-z]{3,}$/.test(rawKey)) {
      const variants = new Set<string>();
      const add = (v: string) => { if (v && v !== rawKey) variants.add(v); };
      if (rawKey.endsWith('k')) add(rawKey + 'h');
      if (rawKey.endsWith('kh')) add(rawKey.slice(0, -1));
      if (rawKey.includes('ch')) { add(rawKey.replace(/ch/g, 'kh')); add(rawKey.replace(/ch/g, 'h')); }
      if (rawKey.includes('ts')) add(rawKey.replace(/ts/g, 'tz'));
      if (rawKey.includes('tz')) add(rawKey.replace(/tz/g, 'ts'));
      if (rawKey.includes('q')) add(rawKey.replace(/q/g, 'k'));
      if (rawKey.includes('ph')) add(rawKey.replace(/ph/g, 'f'));
      if (rawKey.includes('b')) add(rawKey.replace(/b/g, 'v'));
      if (rawKey.includes('v')) { add(rawKey.replace(/v/g, 'b')); add(rawKey.replace(/v/g, 'w')); }
      if (rawKey.includes('p')) add(rawKey.replace(/p/g, 'f'));
      if (rawKey.includes('f')) add(rawKey.replace(/f/g, 'p'));
      if (rawKey.includes('w')) add(rawKey.replace(/w/g, 'v'));
      for (const tv of [...variants].slice(0, 10)) {
        hits = await fetchShard(tv);
        if (hits.length > 0) break;
      }
    }
    return hits;
  }

  const isExplicitProperQuery = /\b(susa|shushan|persia|palace|citadel|city|capital|person|place)\b/i.test(query.query || '');
  let cachedEvents: any[] | null = Array.isArray(motifsData?.events) ? motifsData.events : null;
  let cachedEventById: Map<string, any> | null = cachedEvents
    ? new Map(cachedEvents.map((e: any) => [e.event_id, e]))
    : null;
  async function ensureEventsMap(mdInput?: MotifsData | null): Promise<Map<string, any> | null> {
    if (cachedEventById) return cachedEventById;
    const md = mdInput ?? (await ensureMotifsData());
    if (!md) return null;
    if (!cachedEvents) {
      cachedEvents = Array.isArray(md.events)
        ? md.events
        : (md.events_b64gz
            ? await decodeB64Gz<any[]>(reader, md.events_b64gz, `/r10/events:${releaseId}`, budget.b64Cache)
            : null);
    }
    if (cachedEvents) {
      cachedEventById = new Map(cachedEvents.map((e: any) => [e.event_id, e]));
    }
    return cachedEventById;
  }
  const eventKeywordList = fastManifest?.motifs_event_keywords ?? motifsData?.event_keywords;
  const eventKeywordSet = !cachedEvents && Array.isArray(eventKeywordList)
    ? new Set(eventKeywordList)
    : null;

  // Stage 1: Resolve multi-word phrases (3-gram, 2-gram) then remaining terms
  const phraseConsumedTerms = new Set<string>();
  const phraseResolvedTerms: string[] = [];
  const rawQueryTokens = extractedTerms.filter((t) => !/^[HG]\d{4}$/i.test(t) && !refTokensToIgnore.has(t));
  if (rawQueryTokens.length >= 2) {
    for (const n of [3, 2]) {
      for (let i = 0; i + n <= rawQueryTokens.length; i++) {
        const span = rawQueryTokens.slice(i, i + n);
        if (span.some((t) => phraseConsumedTerms.has(t.toLowerCase()))) continue;
        const phrase = span.map((t) => t.toLowerCase()).join(' ');
        const hits = conceptIdx.aliases[phrase] ? [] : await fetchShard(phrase);
        if (conceptIdx.aliases[phrase] || hits.length > 0) {
          phraseResolvedTerms.push(phrase);
          for (const t of span) {
            const tl = t.toLowerCase();
            if (!(tl in NUMBER_WORDS) && !(tl in SMALL_NUMBERS)) {
              phraseConsumedTerms.add(tl);
            }
          }
        }
      }
    }
  }
  const stage1Terms = [
    ...phraseResolvedTerms,
    ...extractedTerms.filter((t) => !phraseConsumedTerms.has(t.toLowerCase())),
  ];
  const isPassageOnlyQuery = explicitPassages.length > 0 && stage1Terms.length === 0;

  // Resolve concepts via aliases + sharded lemma-lookup
  for (const term of stage1Terms) {
    if (/^\d+$/.test(term) && refTokensToIgnore.has(term) && !NUMBER_WORDS[term]) continue;
    const lower = term.toLowerCase();
    const alias = conceptIdx.aliases[lower];
    const numVal = /^\d+$/.test(lower) ? Number(lower) : (NUMBER_WORDS[lower] ?? SMALL_NUMBERS[lower]);
    let evHits: any[] = [];
    if (lower.length >= 4 || ['red', 'sea'].includes(lower)) {
      if (!cachedEvents && eventKeywordSet?.has(lower)) {
        await ensureEventsMap();
      }
      if (cachedEvents) {
        evHits = cachedEvents.filter(e => e.keywords?.includes(lower)).slice(0, 4);
      }
    }

    const hasContextWitness = (hit: any) => (hit.vs || []).some((vid: number) => contextVerseIds.has(Number(vid)));
    const isResurrectionTerm = /^resurrect(?:ion|ed|ing)?$/.test(lower);
    const rawShardHits = await lookupShardToken(term);
    let filteredShardHits = isResurrectionTerm ? rawShardHits.filter(h => h.bs !== 'H2421') : rawShardHits;
    if (numVal !== undefined && /^\d+$/.test(lower)) {
      filteredShardHits = filteredShardHits.filter(h =>
        /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|twelfth|fortieth|\d+)\b/i.test(String(h.gl || '')),
      );
    }
    const hasPrimaryHeadGloss = (hit: any) => {
      const head = normalizeToken(String(hit.gl || '').split(/[:/,;(]/)[0] || '');
      return head === lower;
    };
    const shardHits = filteredShardHits.sort((a, b) =>
      Number(hasContextWitness(b)) - Number(hasContextWitness(a)) ||
      Number(hasPrimaryHeadGloss(b)) - Number(hasPrimaryHeadGloss(a)) ||
      Number(b.cnt > 0) - Number(a.cnt > 0) ||
      Number(normalizeToken(b.gl || '') === lower) - Number(normalizeToken(a.gl || '') === lower) ||
      b.match_rank - a.match_rank || b.cnt - a.cnt);

    // Proper-Name vs Common-Noun Guard:
    // 1) If propShard has an exact gloss match (e.g. "hagar" -> H1904 "Hagar") and nonPropShard has
    //    NO exact gloss match (e.g. H1481 "to sojourn" matched only via transliteration/surface),
    //    select the exact proper-name entries and keep non-proper transliteration collisions separate.
    // 2) Conversely, if nonPropShard matches and propShard has no exact gloss match (e.g. "lily" -> H7799 vs H7800 "Susa"),
    //    keep non-proper entries as primary unless query explicitly asks for a proper place/person.
    const nonPropShard = shardHits.filter(h => !h.is_prop);
    const propShard = shardHits.filter(h => h.is_prop);
    const exactProperMatches = propShard.filter(h => normalizeToken(h.gl || '') === lower);
    const exactNonPropMatches = nonPropShard.filter(h => normalizeToken(h.gl || '') === lower);
    let primaryShardHits = shardHits;
    const excludedProper: any[] = [];
    if (exactProperMatches.length > 0 && exactNonPropMatches.length === 0) {
      primaryShardHits = exactProperMatches;
      for (const np of nonPropShard) {
        controls.push({
          control_id: `ctrl:proper_vs_translit:${np.bs}:${lower}`,
          kind: 'homograph_disambiguation',
          title: `Proper name "${term}" (${exactProperMatches[0].bs}) separated from lexical match ${np.sc} ("${np.gl}", ${np.bs})`,
          explanation: `Query term "${term}" matches proper entity ${exactProperMatches.map(x => `${x.sc} (${x.bs})`).join(', ')} directly by gloss; non-proper entry ${np.sc} (${np.bs}, "${np.gl}") is kept separate so unrelated passages are not mislabeled as "${term}".`,
        });
      }
    } else if (nonPropShard.length > 0 && !isExplicitProperQuery && exactProperMatches.length === 0) {
      primaryShardHits = nonPropShard;
      excludedProper.push(...propShard);
    }
    const attestedGlossHits = primaryShardHits.filter(h => h.cnt > 0 && (h.match_rank ?? 0) >= 85);
    if (attestedGlossHits.length > 0) {
      const coveredLangs = new Set(attestedGlossHits.map(h => h.lang));
      const crossLangFallbacks: any[] = [];
      for (const lang of ['hbo', 'grc'] as const) {
        if (!coveredLangs.has(lang)) {
          const fallbackHit = primaryShardHits.find(h => h.lang === lang && h.cnt > 0);
          if (fallbackHit) crossLangFallbacks.push(fallbackHit);
        }
      }
      primaryShardHits = [...attestedGlossHits, ...crossLangFallbacks];
    }

    if (alias || primaryShardHits.length > 0 || numVal !== undefined || evHits.length > 0) {
      const lemmas: R10OriginalWordRef[] = [];
      const nodes: R10Node[] = [];
      const homographSiblings: Array<{ bs: string; lk?: string; sc: string; tr: string; gl: string }> = [];

      // Add primary shard hits first (filter out zero-verse ghosts when attested entries exist;
      // keep the #1 hit first, then prefer cnt >= 5 ahead of cnt < 5 so rare-but-real verbs aren't starved)
      const nonZeroPrimary = primaryShardHits.some(h => (h.cnt || 0) > 0)
        ? primaryShardHits.filter(h => (h.cnt || 0) > 0)
        : primaryShardHits;
      const dedupedPrimary = nonZeroPrimary.filter((h, i, all) => all.findIndex(x => x.bs === h.bs) === i);
      const distinctPrimary = dedupedPrimary.length > 1
        ? [
            dedupedPrimary[0],
            ...dedupedPrimary.slice(1).sort((a, b) =>
              Number((b.cnt || 0) >= 5) - Number((a.cnt || 0) >= 5) ||
              Number(normalizeToken(b.gl || '') === lower) - Number(normalizeToken(a.gl || '') === lower) ||
              (b.match_rank || 0) - (a.match_rank || 0) ||
              (b.cnt || 0) - (a.cnt || 0)
            ),
          ]
        : dedupedPrimary;
      for (const h of distinctPrimary.slice(0, 5)) {
        matchedStrongs.add(h.bs);
        const ow: R10OriginalWordRef = {
          lemma_key: h.lk,
          strongs: h.bs,
          language: h.lang,
          lemma_script: h.sc,
          transliteration: h.tr,
          gloss: h.gl,
        };
        lemmaCache.set(h.bs, ow);
        lemmas.push(ow);
      }

      // Merge alias original words without duplicate Strong's
      if (alias?.original_words) {
        for (const aw of alias.original_words) {
          if (isResurrectionTerm && aw.strongs === 'H2421') continue;
          if (aw.strongs) matchedStrongs.add(aw.strongs);
          if (!lemmas.some(l => l.strongs === aw.strongs)) {
            lemmas.push({ ...aw });
            if (aw.strongs) lemmaCache.set(aw.strongs, aw);
          }
        }
      }
      for (const s of alias?.strongs || []) {
        if (isResurrectionTerm && s === 'H2421') continue;
        matchedStrongs.add(s);
      }

      // Handle excluded proper-name homographs
      for (const ep of excludedProper) {
        homographSiblings.push({ bs: ep.bs, lk: ep.lk, sc: ep.sc, tr: ep.tr, gl: ep.gl });
        controls.push({
          control_id: `ctrl:homograph_proper:${ep.bs}`,
          kind: 'homograph_disambiguation',
          title: `Homograph distinction: Common noun "${term}" vs proper name ${ep.gl} (${ep.bs})`,
          explanation: `Original script ${ep.sc} can designate both the botanical / common entity "${term}" and proper entity "${ep.gl}" (${ep.bs}). Separated by default to prevent geographical or personal confounding.`,
        });
      }

      if ((alias?.motifs?.length ?? 0) > 0) {
        const md = await ensureMotifsData();
        for (const m of alias!.motifs!) {
          matchedMotifs.add(m);
          const mInfo = md?.motifs?.[m];
          if (mInfo) {
            nodes.push({
              id: `motif:${m}`,
              kind: 'motif',
              label: mInfo.label,
              motif_id: m,
              epistemic_class: 'shared_motif_evidence',
              grounding_source: 'MACULA + STEPBible',
            });
          }
        }
      }
      if (numVal !== undefined) {
        matchedNumbers.add(numVal);
        nodes.push({
          id: `number:${numVal}`,
          kind: 'number_entity',
          label: `Number ${numVal}`,
          number_value: numVal,
          epistemic_class: 'direct_textual_evidence',
          grounding_source: 'MACULA numeral pairs',
        });
      }
      for (const w of lemmas) {
        nodes.push({
          id: `lemma:${w.strongs}`,
          kind: 'lemma',
          label: `${w.lemma_script} (${w.transliteration || w.gloss})`,
          subtitle: w.gloss,
          language: w.language,
          strongs: w.strongs,
          lemma_key: w.lemma_key,
          lemma_script: w.lemma_script,
          transliteration: w.transliteration,
          gloss: w.gloss,
          epistemic_class: 'documented_lexical_relationship',
          grounding_source: 'STEPBible + MACULA',
        });
      }
      for (const eh of evHits) {
        matchedEvents.push(eh);
        nodes.push({
          id: eh.event_id,
          kind: 'event',
          label: eh.title,
          event_id: eh.event_id,
          epistemic_class: 'shared_motif_evidence',
          grounding_source: 'Theographic Bible Data',
        });
      }

      const resKind = /^[HG]\d+$/i.test(term)
        ? 'strongs'
        : (numVal !== undefined ? 'number' : (alias?.motifs?.length ? 'motif' : 'english_concept'));

      resolvedConcepts.push({
        input_token: term,
        normalized: lower,
        matched: true,
        resolution_kind: resKind,
        candidate_nodes: nodes,
        lemmas,
        sense_candidates: primaryShardHits.length > distinctPrimary.length ? primaryShardHits.map(h => ({ key: h.lk || h.bs, gl: h.gl, note: 'Lexical candidate; this name or sense has not been assigned to a particular occurrence.' })) : undefined,
        homograph_siblings: homographSiblings.length > 0 ? homographSiblings : undefined,
        ambiguity_note: contextVerseIds.size && primaryShardHits.some(hasContextWitness)
          ? 'Candidates attested in the referenced chapter are preferred. Sampled lexical occurrences do not establish which person or sense an individual token denotes; alternatives remain available.'
          : alias?.note || (primaryShardHits.length > 3 ? `Multiple original-language candidates (${primaryShardHits.slice(0, 3).map(h => h.sc).join(', ')}...)` : undefined),
      });
    } else if (!/^\d+$/.test(term)) {
      missingConcepts.push(term);
      resolvedConcepts.push({
        input_token: term,
        normalized: lower,
        matched: false,
        resolution_kind: 'unresolved',
        candidate_nodes: [],
        lemmas: [],
      });
    }
  }

  // Stage 1.5: Parallel bounded profile loading from sharded `lemma-profiles` for primary resolved Strong's codes
  // Round-robin concepts so the first ambiguous term cannot consume every slot, and skip numeral Strong's
  // on non-number phrase concepts when an explicit number concept already owns them.
  const explicitNumberStrongsStage15 = new Set<string>();
  for (const rc of resolvedConcepts) {
    if (rc.resolution_kind === 'number') {
      for (const l of rc.lemmas) {
        if (l.strongs) explicitNumberStrongsStage15.add(l.strongs);
      }
    }
  }
  const prioritized = new Set<string>();
  if (query.focus_lemma) prioritized.add(query.focus_lemma);
  const rawAnchorStrongs = query.anchor_extended_strongs || query.anchor?.extended_strongs || '';
  const anchorNormStrongs = rawAnchorStrongs
    ? rawAnchorStrongs.toUpperCase().replace(/^([HG])0*(\d+)[A-Z]?$/, (_, p, n) => p + n.padStart(4, '0'))
    : '';
  if (anchorNormStrongs) {
    matchedStrongs.add(anchorNormStrongs);
    prioritized.add(anchorNormStrongs);
  }
  if (query.anchor_lemma_key) {
    const m = /^([HG])0*(\d+)/i.exec(query.anchor_lemma_key.replace(/^lemma:/i, ''));
    if (m) {
      const nBs = m[1].toUpperCase() + m[2].padStart(4, '0');
      matchedStrongs.add(nBs);
      prioritized.add(nBs);
    }
  }
  for (let depth = 0; depth < 6; depth++) {
    for (const concept of resolvedConcepts) {
      const candidateLemmas = (concept.resolution_kind !== 'number' && explicitNumberStrongsStage15.size > 0)
        ? (() => {
            const nonNum = concept.lemmas.filter(l => l.strongs && !SMALL_NUMERAL_STRONGS.has(l.strongs) && !explicitNumberStrongsStage15.has(l.strongs));
            return nonNum.length > 0 ? nonNum : concept.lemmas;
          })()
        : (concept.input_token.includes(' ')
            ? [
                ...concept.lemmas.filter(l => l.strongs && l.strongs !== 'H3117' && l.strongs !== 'G2250'),
                ...concept.lemmas.filter(l => l.strongs === 'H3117' || l.strongs === 'G2250'),
              ]
            : concept.lemmas);
      const strongs = candidateLemmas[depth]?.strongs;
      if (strongs) prioritized.add(strongs);
    }
  }
  const multiConcept = extractedTerms.filter(t => !refTokensToIgnore.has(t)).length >= 2 || parsedRefs.length >= 2;
  const queryIntent: R10QueryIntent = query.mode === 'bridge'
    ? 'physical_bridge'
    : isPassageOnlyQuery
      ? 'passage_intertext'
      : multiConcept
        ? 'multi_concept'
        : resolvedConcepts.some(rc => rc.resolution_kind === 'strongs' || rc.resolution_kind === 'script_or_transliteration' || rc.resolution_kind === 'english_concept')
          ? 'lexical'
          : 'open_discovery';
  const profileSliceLimit = isPassageOnlyQuery
    ? (query.mode === 'bridge' ? 5 : (query.lite_subgraph_mode ? 3 : 4))
    : (resolvedConcepts.length >= 3 ? Math.min(8, resolvedConcepts.length * 2 + 2) : 6);
  const rawCandidateStrongs = [...new Set([...prioritized, ...matchedStrongs])];
  const hasExplicitAnchorPassage = Boolean(query.anchor_passage && explicitPassageMeta.length > 0);
  const orderedCandidateStrongs = (isPassageOnlyQuery || hasExplicitAnchorPassage)
    ? [
        ...rawCandidateStrongs.filter(s => !HIGH_FREQ_THEO_HUB_STRONGS.has(s)),
        ...rawCandidateStrongs.filter(s => HIGH_FREQ_THEO_HUB_STRONGS.has(s)),
      ]
    : rawCandidateStrongs;
  if (hasExplicitAnchorPassage && query.focus_lemma) {
    for (const s of passageContentStrongs) {
      if (s !== query.focus_lemma && !HIGH_FREQ_CONTENT_STOP_STRONGS.has(s) && !orderedCandidateStrongs.includes(s)) {
        orderedCandidateStrongs.push(s);
      }
    }
  }
  const profileStrongsToLoad = orderedCandidateStrongs.slice(0, hasExplicitAnchorPassage ? Math.max(profileSliceLimit, 5) : profileSliceLimit);
  const loadedProfiles: LemmaProfile[] = [];
  const profileByStrongs = new Map<string, LemmaProfile>();
  for (const bs of profileStrongsToLoad) {
    if (isPassageOnlyQuery && loadedProfiles.length >= profileSliceLimit && budget.used >= budget.max - 18) break;
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    if (prof) { loadedProfiles.push(prof); profileByStrongs.set(bs, prof); }
  }
  if (isPassageOnlyQuery && loadedProfiles.length > 1) {
    loadedProfiles.sort((a, b) => (a.total_verses || 99999) - (b.total_verses || 99999));
  }

  // Enrich resolved concepts with profile details
  for (const rc of resolvedConcepts) {
    const prof = rc.lemmas.map(l => profileByStrongs.get(l.strongs || '')).find(Boolean);
    if (prof) {
      rc.sense_candidates = prof.senses;
      rc.forms = prof.forms;
      rc.total_verses = prof.total_verses;
      rc.entity_kind = prof.entity_kind;
      if (prof.homograph_siblings?.length) {
        const existing = rc.homograph_siblings || [];
        const combined = [...existing];
        for (const sib of prof.homograph_siblings) {
          if (!combined.some(x => x.bs === sib.bs)) combined.push(sib);
        }
        rc.homograph_siblings = combined;
        for (const sib of prof.homograph_siblings) {
          if (!controls.some(c => c.control_id === `ctrl:homograph_sibling:${prof.bs}:${sib.bs}`)) {
            controls.push({
              control_id: `ctrl:homograph_sibling:${prof.bs}:${sib.bs}`,
              kind: 'homograph_disambiguation',
              title: `Homograph sibling: ${prof.sc} (${prof.gl} · ${prof.bs}) vs ${sib.sc} (${sib.gl} · ${sib.bs})`,
              explanation: `Hebrew consonantal skeleton for ${prof.sc} (${prof.bs}) is shared with ${sib.sc} (${sib.bs}, "${sib.gl}"). Preserved separately to prevent confounding distinct biblical concepts.`,
            });
          }
        }
      }
    }
  }



  // Stage 2: Candidate evidence generation
  const allCandidates: R10EvidenceRecord[] = [];
  const asksResurrection =
    /\bresurrect(?:ion|ed|ing)?\b/i.test(query.query || '') ||
    (query.concepts || []).some(c => /\bresurrect/i.test(c));
  const asksDayNumber =
    (/\bday(?:s)?\b/i.test(query.query || '') || extractedTerms.some(t => /^(day|days|H3117|G2250)$/i.test(t))) &&
    (matchedNumbers.size > 0 || /\b(three|third|seven|forty|3|7|40)\b/i.test(query.query || ''));
  const e2SeedXrefIds = new Set<string>();
  const pericopeXrefIds = new Set<string>();
  const seenGramPairs = new Set<string>();
  const queryTermSet = new Set(extractedTerms.map(t => t.toLowerCase()));
  const clusters: R10Cluster[] = [];
  const bridges: R10ClusterBridge[] = [];
  const crossReferencesOut: DiscoverConnectionsResult['related_discoveries']['cross_references'] = [];

  const recordWitnessesExplicitPassage = (passages: R10PassageRef[]): boolean =>
    passages.some(p =>
      (p.verse_id > 0 && explicitPassageVidSet.has(p.verse_id)) ||
      parsedRefs.some(pr =>
        p.book === pr.book &&
        p.chapter === pr.chapter &&
        (pr.verse === null || p.verse === pr.verse || (p.end_verse !== undefined && pr.verse >= p.verse && pr.verse <= p.end_verse))
      )
    );

  // A. Evidence-Derived Clusters & Relations from loaded lemma-profiles
  for (const prof of loadedProfiles) {
    const effTotalVerses = (prof.total_verses <= 3 && !isPassageOnlyQuery && !query.focus_lemma && loadedProfiles.length > 1)
      ? Math.max(18, prof.total_verses)
      : Math.max(8, prof.total_verses);
    const idfBonus = Math.min(80, Math.max(0, Math.round((Math.log(31203 / effTotalVerses) - 3) * 16)));
    const hubPenalty = prof.total_verses > 250 && !multiConcept ? 140 : 0;
    const profBgPenalty = isPassageOnlyQuery ? (query.mode === 'bridge' ? 95 : 225) : 0;
    const profDefaultSense = resolveDisplaySense(prof, [], explicitToks);

    // A. Clusters
    const clusterSlice = query.lite_subgraph_mode ? [] : (prof.clusters || []).slice(0, isPassageOnlyQuery ? 2 : 4);
    for (const cl of clusterSlice) {
      const anchorNodes: R10Node[] = [
        {
          id: `lemma:${prof.bs}`,
          kind: 'lemma',
          label: `${prof.sc} (${prof.tr})`,
          subtitle: prof.gl,
          language: prof.lang,
          strongs: prof.bs,
          lemma_key: prof.lk,
          lemma_script: prof.sc,
          transliteration: prof.tr,
          gloss: prof.gl,
          epistemic_class: 'direct_textual_evidence',
          grounding_source: 'STEPBible + MACULA',
        },
        ...cl.sample_passages.slice(0, 3).map(p => ({
          id: `passage:${p.ref}`,
          kind: 'passage' as const,
          label: p.ref,
          passage: {
            verse_id: p.verse_id,
            ref: p.ref,
            mt_ref: p.mt_ref,
            book: p.book,
            chapter: p.chapter,
            verse: p.verse,
            testament: p.testament,
            snippet: p.snippet,
            is_psalm_heading: p.book === 19 && p.verse === 0,
          },
          epistemic_class: 'direct_textual_evidence' as const,
          grounding_source: 'MACULA',
        })),
      ];

      const isSanctuaryClusterVerified = (clObj: any): boolean => {
        if (clObj.category !== 'temple_and_sanctuary_architecture') return false;
        const collocs = (clObj.collocated_words || []).map((w: any) => String(w.gl || '').toLowerCase());
        const passagesText = (clObj.sample_passages || []).map((p: any) => `${p.ref || ''} ${p.snippet || ''}`.toLowerCase()).join(' ');
        const hasSanctuaryColloc = collocs.some((g: string) =>
          /\b(temple|tabernacle|sanctuary|altar|ark|lampstand|menorah|curtain|veil|cherub|cherubim|holies|priest|levite|incense|offering|atonement|ephod|breastplate|pillar|courtyard|bowl|socket|cubit|gold|bronze|engraving|signet)\b/.test(g)
        );
        const hasSanctuaryRefOrText =
          /\b(tabernacle|sanctuary|temple|altar|ark|lampstand|curtain|cherub|priest|most holy|holy place|house of the lord|house of yahweh|tent of meeting)\b/.test(passagesText) ||
          (clObj.sample_passages || []).some((p: any) =>
            (p.book === 2 && p.chapter >= 25 && p.chapter <= 40) ||
            (p.book === 3 && p.chapter <= 16) ||
            (p.book === 4 && (p.chapter === 3 || p.chapter === 4 || p.chapter === 7 || p.chapter === 8 || p.chapter === 17)) ||
            (p.book === 11 && p.chapter >= 5 && p.chapter <= 8) ||
            (p.book === 14 && p.chapter >= 2 && p.chapter <= 7) ||
            (p.book === 26 && p.chapter >= 40 && p.chapter <= 48) ||
            (p.book === 38 && (p.chapter === 3 || p.chapter === 4 || p.chapter === 6)) ||
            (p.book === 58 && p.chapter >= 8 && p.chapter <= 10)
          );
        const looksGeographical =
          (/\b(sea|arabah|jordan|border|boundary|valley|salt|salt sea|dead sea|wilderness|joshua|conquest|philistine|king of)\b/.test(passagesText) ||
            /\bsalt\b/i.test(String(prof.gl || ''))) &&
          !hasSanctuaryColloc;
        return (hasSanctuaryColloc || hasSanctuaryRefOrText) && !looksGeographical;
      };

      const effectiveCategory = cl.category === 'temple_and_sanctuary_architecture' && !isSanctuaryClusterVerified(cl)
        ? 'geographical_and_historical_narrative'
        : cl.category;
      const effectiveLabel = effectiveCategory !== cl.category
        ? String(cl.label || '').replace(/Temple & Sanctuary Architecture/gi, 'Geographical & Historical Context')
        : cl.label;
      const effectiveSummary = effectiveCategory !== cl.category
        ? String(cl.summary || '').replace(/sanctuary|temple architecture/gi, 'historical/geographical passages')
        : cl.summary;
      const safeClusterId = effectiveCategory !== cl.category
        ? `${prof.bs}:${effectiveCategory}`
        : cl.cluster_id;

      clusters.push({
        cluster_id: safeClusterId,
        label: effectiveLabel,
        category: effectiveCategory,
        concepts: [prof.gl, prof.sc],
        anchor_nodes: anchorNodes,
        connection_ids: [`r11:cluster:${safeClusterId}`],
        summary: effectiveSummary,
        total_passages: cl.vids.length,
        passages: cl.sample_passages.map(p => ({
          verse_id: p.verse_id,
          ref: p.ref,
          mt_ref: p.mt_ref,
          book: p.book,
          chapter: p.chapter,
          verse: p.verse,
          testament: p.testament,
          snippet: p.snippet,
          is_psalm_heading: p.book === 19 && p.verse === 0,
        })),
        uncertainty_note: effectiveCategory === 'psalm_superscription'
          ? 'Psalm heading / musical or liturgical superscription; whether the expression denotes a tune, instrument, or floral motif is uncertain in source text.'
          : 'Evidence-derived semantic cluster grouping attested verses by shared vocabulary and genre.',
        collocated_words: cl.collocated_words,
      });

      let tier: R10EvidenceTier = 3;
      let predicate: R10Predicate = 'verified_lexical_grammatical';
      let epistemicClass: R10EpistemicClass = 'direct_textual_evidence';
      let limitations = ['Evidence-derived corpus cluster based on syntactic and lexical co-occurrence.'];

      if (effectiveCategory === 'temple_and_sanctuary_architecture') {
        const hasArchColloc = (cl.collocated_words || []).some(w =>
          ['pillar', 'cup', 'brim', 'handbreadth', 'thickness', 'bath', 'deed'].some(k => w.gl.toLowerCase().includes(k))
        ) || (cl.xrefs || []).length > 0;
        tier = hasArchColloc ? 2 : 3;
        predicate = 'verified_lexical_grammatical';
        limitations = ['Sanctuary and Temple architecture descriptions; physical ornamentation rather than metaphorical or typological discourse.'];
      } else if (effectiveCategory === 'psalm_superscription') {
        tier = 3;
        predicate = 'verified_lexical_grammatical';
        epistemicClass = 'documented_lexical_relationship';
        limitations = ['Psalm heading / musical or liturgical superscription; whether the expression denotes a tune, instrument, or floral motif is uncertain in source text.'];
      } else if (['poetic_imagery_and_similes', 'prophetic_imagery_and_oracles', 'gospel_and_nt_teaching'].includes(effectiveCategory)) {
        if (cl.has_simile) {
          tier = 2;
          predicate = 'explicit_comparison';
          limitations = ['Explicit comparative simile in biblical text; context determines the extent of figurative correspondence.'];
        } else {
          tier = 3;
          predicate = 'verified_lexical_grammatical';
          limitations = ['Attested imagery in poetic or prophetic discourse.'];
        }
      }

      const baseScore = TIER_BASE_SCORE[tier];
      const witnessBonus = Math.min(80, cl.vids.length * 6);
      const specificityBonus = idfBonus + (cl.has_simile ? 30 : 0);
      const clusterContainsSeed = isPassageOnlyQuery && cl.vids.some(v => explicitPassageVidSet.has(v));
      const clusterBgPenalty = isPassageOnlyQuery
        ? (query.mode === 'bridge' ? 110 : ((clusterContainsSeed && prof.total_verses <= 250) ? profBgPenalty : 250))
        : 0;
      const finalScore = Math.max(10, baseScore + specificityBonus + witnessBonus - hubPenalty - clusterBgPenalty - 45);

      const rawClusterPassages: R10PassageRef[] = cl.sample_passages.map(p => ({
        verse_id: p.verse_id,
        ref: p.ref,
        mt_ref: p.mt_ref,
        book: p.book,
        chapter: p.chapter,
        verse: p.verse,
        testament: p.testament,
        snippet: p.snippet,
        is_psalm_heading: p.book === 19 && p.verse === 0,
      }));
      const clusterPassages = (asksDayNumber && SMALL_NUMERAL_STRONGS.has(prof.bs))
        ? rawClusterPassages.filter(p => !isYearUnitWithoutDayPassage([p]) && !/\b(?:hundred|thousand)\b/i.test(p.snippet || ''))
        : rawClusterPassages;
      if (clusterPassages.length === 0) continue;
      const clusterSense = isPassageOnlyQuery ? profDefaultSense : resolveDisplaySense(prof, clusterPassages, explicitToks);
      const clusterVids = new Set(cl.vids);
      const matchingForms: any[] = [];
      const clForms = prof.forms || [];
      for (let fi = 0; fi < clForms.length && fi < 60; fi++) {
        const f = clForms[fi];
        if (f?.vid && clusterVids.has(f.vid)) {
          matchingForms.push(f);
          if (matchingForms.length >= 3) break;
        }
      }
      const originalWords: R10OriginalWordRef[] = [
        {
          lemma_key: clusterSense.lk,
          strongs: prof.bs,
          language: prof.lang,
          lemma_script: clusterSense.sc,
          transliteration: clusterSense.tr,
          gloss: clusterSense.gl,
        },
        ...matchingForms.slice(0, 3).map(f => ({
          lemma_key: clusterSense.lk,
          strongs: prof.bs,
          language: prof.lang,
          lemma_script: f.sf,
          transliteration: f.tr,
          gloss: f.gl,
        })),
      ];

      allCandidates.push({
        evidence_id: `r11:cluster:${safeClusterId}`,
        predicate,
        evidence_tier: tier,
        epistemic_class: epistemicClass,
        title: effectiveLabel,
        summary: effectiveSummary,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `cluster:${safeClusterId}`,
        passages: clusterPassages,
        original_words: originalWords,
        matched_terms: [clusterSense.gl, clusterSense.sc, prof.bs],
        limitations,
        provenance: {
          source_dataset: 'MACULA Hebrew & Greek + STEPBible',
          source_record_ids: cl.sample_passages.map(p => p.ref),
          license: 'CC BY 4.0',
          derivation_method: 'evidence_derived_semantic_cluster',
        },
        score_components: {
          base_tier_score: baseScore,
          specificity_bonus: specificityBonus,
          witness_bonus: witnessBonus,
          common_word_penalty: hubPenalty + clusterBgPenalty,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: finalScore,
        },
      });

      // E. Cross-References from cluster
      for (const xr of (cl.xrefs || []).slice(0, 4)) {
        const fromP: R10PassageRef = {
          verse_id: xr.from_vid,
          ref: cl.sample_passages.find(p => p.verse_id === xr.from_vid)?.ref || `Verse ${xr.from_vid}`,
          book: bookForVid(xr.from_vid),
          chapter: 1,
          verse: 1,
          testament: bookForVid(xr.from_vid) <= 39 ? 'OT' : 'NT',
        };
        const toP: R10PassageRef = {
          verse_id: xr.to_vid,
          ref: xr.to_ref,
          book: bookForVid(xr.to_vid),
          chapter: 1,
          verse: 1,
          testament: bookForVid(xr.to_vid) <= 39 ? 'OT' : 'NT',
        };
        const xrSense = isPassageOnlyQuery ? profDefaultSense : resolveDisplaySense(prof, [fromP, toP], explicitToks);
        crossReferencesOut.push({
          from_ref: fromP.ref,
          to_ref: xr.to_ref,
          anchor_phrase: xr.phrase,
          from_passage: fromP,
          to_passage: toP,
        });
        const clusterXrefBgPen = isPassageOnlyQuery && !explicitPassageVidSet.has(xr.from_vid) ? 190 : 0;
        allCandidates.push(buildXrefRecord({
          evidenceId: `r11:xref:${xr.from_vid}:${xr.to_vid}`,
          fromPassage: fromP,
          toPassage: toP,
          phrase: xr.phrase,
          isReciprocal: false,
          isCrossTest: fromP.testament !== toP.testament,
          isSameLemma: xr.is_same_lemma,
          originalWords: [{
            lemma_key: xrSense.lk,
            strongs: prof.bs,
            language: languageFromStrongs(prof.bs, prof.lang),
            lemma_script: xrSense.sc,
            transliteration: xrSense.tr,
            gloss: xrSense.gl,
          }],
          extraMatchedTerms: [xrSense.gl],
          backgroundPenalty: clusterXrefBgPen,
        }));
      }
    }

    // B. Direct Grammatical Relations (filter out pronouns/particles; demote generic light verbs)
    let nonFuncGram = (prof.grammatical_relations || []).filter(gr =>
      gr.occurrences >= 1 &&
      (gr.witnesses === undefined || gr.witnesses.length > 0) &&
      !PRONOUN_OR_FUNC_STRONGS.has(gr.related_strongs)
    );
    if (isPassageOnlyQuery) {
      nonFuncGram = [...nonFuncGram].sort((a, b) =>
        Number(recordWitnessesExplicitPassage(b.witnesses?.map(w => w.passage) || [])) -
        Number(recordWitnessesExplicitPassage(a.witnesses?.map(w => w.passage) || []))
      );
    }
    const fastPassageOrLite = isPassageOnlyQuery || Boolean(query.lite_subgraph_mode);
    nonFuncGram = nonFuncGram.slice(0, fastPassageOrLite ? 4 : 5);

    for (const gr of nonFuncGram) {
      const grPassages = gr.witnesses?.map(w => w.passage) || [];
      const isPassageWitnessGram = isPassageOnlyQuery && recordWitnessesExplicitPassage(grPassages);
      const normGramPred = gr.predicate
        .replace(/^(?:has_|is_)/, '')
        .replace(/_(?:of|with|by|to|from)$/, '');
      const [ga, gb] = [prof.bs, gr.related_strongs].sort();
      const gramPairKey = `${ga}:${gb}:${normGramPred}`;
      if (seenGramPairs.has(gramPairKey)) continue;
      seenGramPairs.add(gramPairKey);
      const gramBgPenalty = isPassageOnlyQuery && !isPassageWitnessGram ? (query.mode === 'bridge' ? 110 : 245) : 0;
      const gramSense = fastPassageOrLite ? profDefaultSense : resolveDisplaySense(prof, grPassages, explicitToks);
      const gTier: R10EvidenceTier = (grPassages.length > 0 && (gr.independent_witness_count ?? gr.occurrences) >= 2) ? 2 : 3;
      const gBase = TIER_BASE_SCORE[gTier];
      const gSpec = idfBonus + 25;
      const gWit = Math.min(40, (gr.independent_witness_count ?? gr.occurrences) * 8);
      const lightVerbPen = (GENERIC_LIGHT_VERB_STRONGS.has(gr.related_strongs) || GENERIC_LIGHT_VERB_STRONGS.has(prof.bs)) ? 140 : 0;
      const rawGramScore = Math.max(10, gBase + gSpec + gWit - hubPenalty - lightVerbPen - gramBgPenalty);
      const finalGramScore = isPassageWitnessGram
        ? Math.min(850, Math.max(10, rawGramScore - 75))
        : rawGramScore;
      const gramPassageCapPen = Math.max(0, rawGramScore - finalGramScore);
      allCandidates.push({
        evidence_id: `r11:gram:${prof.bs}:${gr.predicate}:${gr.related_strongs}`,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: gTier,
        epistemic_class: 'direct_textual_evidence',
        title: `${gr.display_label}: ${gramSense.sc} (${gramSense.tr}) ↔ ${gr.related_script} ("${gr.related_gloss}", ${gr.occurrences}×)`,
        summary: `Syntactic dependency analysis identifies direct grammatical connection (${gr.display_label}) between ${gramSense.sc} (${prof.bs}, "${gramSense.gl}") and ${gr.related_script} (${gr.related_strongs}, "${gr.related_gloss}") across ${gr.occurrences} indexed occurrences.${gr.independent_witness_count !== undefined ? ` ${gr.independent_witness_count} distinct canonical source clauses pass token-position verification; parallel editions are counted once.` : ''}`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `lemma:${gr.related_strongs}`,
        passages: grPassages,
        original_words: [
          { lemma_key: gramSense.lk, strongs: prof.bs, language: languageFromStrongs(prof.bs, prof.lang), lemma_script: gramSense.sc, transliteration: gramSense.tr, gloss: gramSense.gl },
          { strongs: gr.related_strongs, language: languageFromStrongs(gr.related_strongs, prof.lang), lemma_script: gr.related_script, transliteration: '', gloss: gr.related_gloss },
        ],
        matched_terms: [gramSense.gl, gr.related_gloss, prof.bs, gr.related_strongs],
        limitations: [gr.witnesses ? `Exact source relations; ${gr.independent_witness_count} distinct canonical clause witnesses. Parallel editions and mirrored paths do not add independent support.` : 'Legacy aggregate without attached matching witnesses; inspect grammatical relationship evidence before citing.', 'Syntactic construct/argument relation; shared grammar alone establishes no theological or authorial significance.'],
        provenance: {
          source_dataset: 'MACULA Hebrew/Greek Syntactic Trees',
          source_record_ids: gr.witnesses?.map(w => w.relation_id) || [],
          license: 'CC BY 4.0',
          derivation_method: 'syntactic_dependency_relation',
        },
        score_components: {
          base_tier_score: gBase,
          specificity_bonus: gSpec,
          witness_bonus: gWit,
          common_word_penalty: hubPenalty + lightVerbPen + gramBgPenalty + gramPassageCapPen,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: finalGramScore,
        },
      });
    }

    // C. Documented LXX Bridges (exclude Greek/Hebrew article & particle noise such as G3588)
    let lxxAdded = 0;
    const lxxCap = fastPassageOrLite ? 4 : 6;
    for (let idx = 0; idx < (prof.lxx_relations || []).length && lxxAdded < lxxCap; idx++) {
      const rel = prof.lxx_relations[idx];
      if (isLxxFunctionEquivalent(rel?.target_strongs, rel?.script)) continue;
      lxxAdded++;
      const lxxPassages = (rel.sample_refs || (rel.ref ? [rel.ref] : [])).slice(0, 4).map((rf: string) => ({
        verse_id: 0,
        ref: rf,
        book: 0,
        chapter: 1,
        verse: 1,
        testament: 'OT' as const,
      }));
      const lxxSense = fastPassageOrLite ? profDefaultSense : resolveDisplaySense(prof, lxxPassages, explicitToks);
      const isHeadingMatch = rel.type === 'lxx_heading_witness' &&
        parsedRefs.some(pr => new RegExp(`\\b${pr.chapter}:${pr.verse ?? 0}\\b`).test(String(rel.ref || '')));
      const lxxBgPenalty = isPassageOnlyQuery && !isHeadingMatch ? (query.mode === 'bridge' ? 100 : 235) : 0;
      let relTitle = `Septuagint (LXX) bridge: ${lxxSense.sc} (${prof.bs})`;
      let relSummary = `Documented Septuagint translation relationship for ${lxxSense.sc}.`;
      const isGreekSource = /^G/i.test(prof.bs);
      const targetIsHebrew = /^H/i.test(String(rel.target_strongs || ''));
      if (rel.type === 'lxx_swete_witness') {
        relTitle = isGreekSource && targetIsHebrew
          ? `Septuagint (LXX) bridge: ${rel.script || rel.target_strongs} (${rel.target_strongs}${rel.gloss ? `, "${rel.gloss}"` : ''}) → Greek ${lxxSense.sc} (${prof.bs}) across ${rel.count} passages`
          : `Septuagint (LXX) bridge: ${lxxSense.sc} (${prof.bs}) → ${rel.script} (${rel.target_strongs}, "${rel.gloss}") across ${rel.count} passages`;
        relSummary = isGreekSource && targetIsHebrew
          ? `Ancient Greek Septuagint translates Hebrew ${rel.script || rel.target_strongs} (${rel.target_strongs}${rel.gloss ? `, "${rel.gloss}"` : ''}) as Greek ${lxxSense.sc} (${prof.bs}) in ${rel.count} occurrences (${(rel.sample_refs || []).slice(0, 4).join(', ')}). Establishes documented Greek translation bridge.`
          : `Ancient Greek Septuagint translates Hebrew ${lxxSense.sc} (${prof.bs}) as Greek ${rel.script} (${rel.target_strongs}) in ${rel.count} occurrences (${(rel.sample_refs || []).slice(0, 4).join(', ')}). Establishes documented Greek translation bridge.`;
      } else if (rel.type === 'lxx_heading_witness') {
        relTitle = `Septuagint superscription witness for ${rel.ref}: ${lxxSense.sc} (${prof.bs})`;
        relSummary = `In ${rel.ref}, the Septuagint renders the Hebrew title containing ${lxxSense.sc} as: "${rel.lxx_text}". Witnesses ancient translation understanding of this superscription.`;
      } else if (rel.type === 'bcv_lxx_bridge' || rel.type === 'word_alignment') {
        relTitle = isGreekSource && targetIsHebrew
          ? `Septuagint alignment witness: Hebrew ${rel.script || rel.target_strongs} (${rel.target_strongs}) → Greek ${lxxSense.sc} (${prof.bs})`
          : `Septuagint alignment witness: ${lxxSense.sc} (${prof.bs}) → ${rel.script || rel.target_strongs}`;
        relSummary = isGreekSource && targetIsHebrew
          ? `Documented LXX lexical alignment linking Greek ${lxxSense.sc} (${prof.bs}) with Hebrew witness ${rel.script || rel.target_strongs} (${rel.target_strongs}).`
          : `Documented LXX lexical alignment linking Hebrew ${lxxSense.sc} (${prof.bs}) with Greek witness ${rel.script || rel.target_strongs}.`;
      }
      allCandidates.push({
        evidence_id: `r11:lxx:${prof.bs}:${idx}`,
        predicate: 'cross_language_bridge',
        evidence_tier: 3,
        epistemic_class: 'documented_lexical_relationship',
        title: relTitle,
        summary: relSummary,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: rel.target_strongs ? `lemma:${rel.target_strongs}` : `concept:lxx:${prof.bs}`,
        passages: lxxPassages,
        original_words: [
          { lemma_key: lxxSense.lk, strongs: prof.bs, language: languageFromStrongs(prof.bs, prof.lang), lemma_script: lxxSense.sc, transliteration: lxxSense.tr, gloss: lxxSense.gl },
          ...(rel.target_strongs ? [{ strongs: rel.target_strongs, language: languageFromStrongs(rel.target_strongs, 'grc'), lemma_script: rel.script || '', transliteration: '', gloss: rel.gloss || '' }] : []),
        ],
        matched_terms: [lxxSense.gl, lxxSense.sc, rel.gloss || ''].filter(Boolean),
        limitations: ['Historical Septuagint translation choice; reflects Alexandrian Jewish understanding of the Hebrew text.'],
        provenance: {
          source_dataset: 'Swete LXX / Hatch-Redpath / STEPBible',
          source_record_ids: (rel.sample_refs || [rel.ref || prof.bs]),
          license: 'CC BY 4.0',
          derivation_method: 'lxx_swete_alignment',
        },
        score_components: {
          base_tier_score: TIER_BASE_SCORE[3],
          specificity_bonus: idfBonus + 90,
          witness_bonus: Math.min(30, (rel.count || 1) * 5),
          common_word_penalty: hubPenalty + lxxBgPenalty,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: Math.max(10, TIER_BASE_SCORE[3] + idfBonus + 90 + Math.min(30, (rel.count || 1) * 5) - hubPenalty - lxxBgPenalty),
        },
      });
    }

    // D. Lexical relations (validate same-script consonant overlap >= 2 for shares_root and attach sample witnesses)
    const lexSense = profDefaultSense;
    const profForLex = lexSense.lk === prof.lk && lexSense.gl === prof.gl
      ? prof
      : { ...prof, lk: lexSense.lk, sc: lexSense.sc, tr: lexSense.tr, gl: lexSense.gl };
    const extractConsSet = (s: string) => {
      const first = String(s || '').split(/[,;/]/)[0] || '';
      return new Set(
        [...first.normalize('NFD')]
          .filter(ch => {
            const cp = ch.codePointAt(0) || 0;
            return (cp >= 0x05d0 && cp <= 0x05ea) || (cp >= 0x03b1 && cp <= 0x03c9) || (cp >= 0x0391 && cp <= 0x03a9);
          })
          .map(c => c.toLowerCase()),
      );
    };
    const srcConsSet = extractConsSet(prof.sc);
    const lexCap = fastPassageOrLite ? 4 : 5;
    for (let idx = 0; idx < Math.min(lexCap, (prof.lexical_relations || []).length); idx++) {
      const lrel = prof.lexical_relations[idx];
      const tBs = String(lrel?.target_strongs || '');
      if (lrel?.type === 'shares_root' && tBs && prof.bs[0] === tBs[0]) {
        const tgtConsSet = extractConsSet(lrel.script || profileByStrongs.get(tBs)?.sc || '');
        const sharedCount = [...tgtConsSet].filter(c => srcConsSet.has(c)).length;
        if (sharedCount < 2) continue;
      }
      const targetProf = tBs && tBs !== prof.bs
        ? profileByStrongs.get(tBs) || null
        : null;
      const lexPassages = [
        ...((prof.first_occ_passages || []).slice(0, 1)),
        ...((targetProf?.first_occ_passages || []).slice(0, 1)),
      ].filter((p, i, arr) => p && arr.findIndex(x => x.verse_id === p.verse_id) === i);
      allCandidates.push(buildLexicalRelationRecord({
        evidenceId: `r11:lex:${prof.bs}:${idx}`,
        prof: profForLex,
        lrel,
        targetProf,
        passages: lexPassages,
        scoreComponents: {
          base_tier_score: TIER_BASE_SCORE[3],
          specificity_bonus: idfBonus + 80,
          witness_bonus: 20,
          common_word_penalty: hubPenalty + profBgPenalty,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: Math.max(10, TIER_BASE_SCORE[3] + idfBonus + 80 + 20 - hubPenalty - profBgPenalty),
        },
      }));
    }

    // D2. Direct Collocated Vocabulary (top non-stop-hub collocations from attested cluster contexts)
    const seenCollocTargets = new Set<string>();
    const collocClusters = query.lite_subgraph_mode ? [] : (prof.clusters || []).slice(0, isPassageOnlyQuery ? 2 : 3);
    const maxCollocTargets = isPassageOnlyQuery ? 2 : 5;
    const maxCollocPerCluster = isPassageOnlyQuery ? 2 : 3;
    for (const clForColloc of collocClusters) {
      const samplePassages = (clForColloc.sample_passages || []).slice(0, 6).map(p => ({
        verse_id: p.verse_id,
        ref: p.ref,
        mt_ref: p.mt_ref,
        book: p.book,
        chapter: p.chapter,
        verse: p.verse,
        testament: p.testament,
        snippet: p.snippet,
        is_psalm_heading: p.book === 19 && p.verse === 0,
      }));
      const collocSense = fastPassageOrLite ? profDefaultSense : resolveDisplaySense(prof, samplePassages, explicitToks);
      let clusterCollocAdded = 0;
      for (const cw of clForColloc.collocated_words || []) {
        if (!cw.bs || cw.bs === prof.bs || seenCollocTargets.has(cw.bs)) continue;
        if (PRONOUN_OR_FUNC_STRONGS.has(cw.bs) || GENERIC_LIGHT_VERB_STRONGS.has(cw.bs) || SMALL_NUMERAL_STRONGS.has(cw.bs) || HIGH_FREQ_CONTENT_STOP_STRONGS.has(cw.bs)) continue;
        seenCollocTargets.add(cw.bs);
        clusterCollocAdded++;
        const collocBase = Math.min(750, Math.max(660, 660 + Math.round((cw.score || 0) * 60 + Math.log2(1 + (cw.hits || 1)) * 18)));
        const collocScore = Math.max(10, collocBase - profBgPenalty);
        allCandidates.push({
          evidence_id: `r11:colloc:${prof.bs}:${cw.bs}`,
          predicate: 'verified_lexical_grammatical',
          evidence_tier: 4,
          epistemic_class: 'documented_collocation_or_cooccurrence',
          title: `Direct collocation: ${collocSense.sc} ("${collocSense.gl}") ↔ ${cw.sc} ("${cw.gl}", ${cw.hits}×)`,
          summary: `Corpus co-occurrence links ${collocSense.sc} (${prof.bs}, "${collocSense.gl}") with ${cw.sc} (${cw.bs}, "${cw.gl}") across ${cw.hits} shared contexts (${samplePassages.map(p => p.ref).join(', ')}).`,
          source_node_id: `lemma:${prof.bs}`,
          target_node_id: `lemma:${cw.bs}`,
          passages: samplePassages,
          original_words: [
            { lemma_key: collocSense.lk, strongs: prof.bs, language: prof.lang, lemma_script: collocSense.sc, transliteration: collocSense.tr, gloss: collocSense.gl },
            { strongs: cw.bs, language: prof.lang, lemma_script: cw.sc, transliteration: cw.tr || '', gloss: cw.gl },
          ],
          matched_terms: [collocSense.gl, cw.gl, prof.bs, cw.bs],
          limitations: ['Co-occurring vocabulary in shared contexts; inspect surrounding verses for syntactic or thematic relation.'],
          provenance: {
            source_dataset: 'MACULA Hebrew & Greek + STEPBible',
            source_record_ids: samplePassages.map(p => p.ref),
            license: 'CC BY 4.0',
            derivation_method: 'direct_cluster_collocation',
          },
          score_components: {
            base_tier_score: TIER_BASE_SCORE[4],
            specificity_bonus: collocBase - TIER_BASE_SCORE[4],
            witness_bonus: 0,
            common_word_penalty: profBgPenalty,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: collocScore,
          },
        });
        if (clusterCollocAdded >= maxCollocPerCluster || seenCollocTargets.size >= maxCollocTargets) break;
      }
      if (seenCollocTargets.size >= maxCollocTargets) break;
    }
  }

  // E2. Passage-level Embedded Cross-References, Structural Scenes & Chronological Events
  const surfacedXrefTargetVids = new Set<number>();
  if (explicitPassageMeta.length > 0) {
    const mdForEvents = motifsData && explicitPassageMeta.some(m => m.eventIds.length > 0) ? motifsData : null;
    const e2SliceLimit = explicitPassageMeta.length > 1
      ? Math.max(4, Math.ceil(36 / explicitPassageMeta.length))
      : ((isPassageOnlyQuery || hasExplicitAnchorPassage) && query.mode !== 'bridge' ? 24 : (hasExplicitAnchorPassage ? 10 : 8));
    const e2MaxTotalHydrate = hasExplicitAnchorPassage ? 2 : (query.mode === 'bridge' ? 0 : (isPassageOnlyQuery ? 2 : 1));
    let e2TotalHydrated = 0;
    for (const { ep, xrefs, eventIds, scenes, contentStrongs } of explicitPassageMeta) {
      const seedContentSet = new Set(contentStrongs.filter(s => !HIGH_FREQ_CONTENT_STOP_STRONGS.has(s)));
      const seedLxxToSource = new Map<string, string[]>();
      if (isPassageOnlyQuery) {
        for (const s of seedContentSet) {
          const sProf = profileByStrongs.get(s);
          for (const lr of sProf?.lxx_relations || []) {
            const ts = lr.target_strongs;
            if (!ts || PRONOUN_OR_FUNC_STRONGS.has(ts) || GENERIC_LIGHT_VERB_STRONGS.has(ts) || SMALL_NUMERAL_STRONGS.has(ts) || HIGH_FREQ_CONTENT_STOP_STRONGS.has(ts)) continue;
            const list = seedLxxToSource.get(ts) || [];
            if (!list.includes(s)) list.push(s);
            seedLxxToSource.set(ts, list);
          }
        }
      }
      const weightOfSeedStrongs = (s: string) => {
        const p = profileByStrongs.get(s);
        if (!p) return 1.0;
        return Math.max(0.5, Math.min(4.0, Math.log(31203 / Math.max(1, p.total_verses)) - 2.5));
      };

      const sceneByToVid = new Map<number, any[]>();
      for (const sc of scenes || []) {
        if (Number(sc?.[0]) === 1 && Number(sc?.[1]) > 0) {
          sceneByToVid.set(Number(sc[1]), sc);
        }
      }

      const preScoredXrefs = (xrefs || []).map((xr: any[]) => {
        const toVid = Number(xr[0]);
        const toRef = String(xr[1] || '');
        const phrase = String(xr[2] || '');
        const flags = Number(xr[3] || 0);
        const isReciprocal = (flags & 1) !== 0;
        const toBook = bookForVid(toVid);
        const isCrossTest = (flags & 2) !== 0 || ep.testament !== (toBook <= 39 ? 'OT' : 'NT');
        const hasTupleStats = xr.length >= 7;
        const lexCount = hasTupleStats ? Number(xr[4] || 0) : 0;
        const lxxCount = hasTupleStats ? Number(xr[5] || 0) : 0;
        let idf10 = hasTupleStats ? Number(xr[6] || 0) : 0;
        const matchedScene = sceneByToVid.get(toVid);
        const sceneRoles = matchedScene ? Number(matchedScene[4] || 0) : 0;
        const scenePairsText = matchedScene ? String(matchedScene[5] || '') : '';
        if (matchedScene) idf10 = Math.max(idf10, Number(matchedScene[3] || 0));
        const phraseContentWords = phrase.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4).length;
        const phraseExtra = phraseContentWords >= 4 ? 40 : (phraseContentWords >= 3 ? 25 : 0);
        const crossCorrExtra = isCrossTest && ((lexCount + lxxCount) >= 1 || idf10 >= 40) ? 20 : 0;
        const overlapBonus = (lexCount > 0 || lxxCount > 0 || idf10 > 0)
          ? Math.min(240, Math.round(idf10 * 1.0 + (lexCount + lxxCount) * 18 + sceneRoles * 15 + phraseExtra + crossCorrExtra))
          : 0;
        const basePre = isReciprocal && isCrossTest ? 835 : isReciprocal ? 785 : isCrossTest ? 750 : 700;
        const capPre = (isPassageOnlyQuery || hasExplicitAnchorPassage) && ((lexCount + lxxCount) >= 2 || idf10 >= 40) ? 970 : (isCrossTest ? 925 : 885);
        const preScore = Math.min(capPre, basePre + overlapBonus);
        return {
          toVid, toRef, phrase, isReciprocal, isCrossTest, hasTupleStats,
          lexCount, lxxCount, idf10, sceneRoles, scenePairsText, overlapBonus, preScore,
        };
      });
      preScoredXrefs.sort((a, b) => b.preScore - a.preScore || a.toVid - b.toVid);

      for (const item of preScoredXrefs.slice(0, e2SliceLimit)) {
        const { toVid, toRef, phrase, isReciprocal, isCrossTest, hasTupleStats } = item;
        surfacedXrefTargetVids.add(toVid);
        const toBook = bookForVid(toVid);
        const canHydrate = !hasTupleStats && e2TotalHydrated < e2MaxTotalHydrate && budget.used < budget.max - 8;
        const rawToPassage: R10PassageRef = (canHydrate
          ? await hydratePassageByVid(toVid, false)
          : null) || buildRefStub(toVid, toRef);
        const toPassage = applyRangeRef(rawToPassage, toRef);
        if (canHydrate) e2TotalHydrated++;

        let sharedContentCount = item.lexCount;
        let lxxBridgeCount = item.lxxCount;
        let overlapBonus = item.overlapBonus;
        if (!hasTupleStats && isPassageOnlyQuery) {
          const toToks: any[] = bookCache.get(toBook)?.[String(toVid)]?.toks || [];
          const targetContentStrongs = new Set<string>();
          for (const t of toToks) {
            if (!t.s || PRONOUN_OR_FUNC_STRONGS.has(t.s) || GENERIC_LIGHT_VERB_STRONGS.has(t.s) || SMALL_NUMERAL_STRONGS.has(t.s) || HIGH_FREQ_CONTENT_STOP_STRONGS.has(t.s)) continue;
            if (isMaculaFuncClass(t.cl)) continue;
            targetContentStrongs.add(t.s);
          }
          let idfWeightSum = 0;
          const countedSeedStrongs = new Set<string>();
          for (const ts of targetContentStrongs) {
            if (seedContentSet.has(ts)) {
              sharedContentCount++;
              if (!countedSeedStrongs.has(ts)) {
                countedSeedStrongs.add(ts);
                idfWeightSum += weightOfSeedStrongs(ts);
              }
            } else if (seedLxxToSource.has(ts)) {
              lxxBridgeCount++;
              for (const srcS of seedLxxToSource.get(ts)!) {
                if (!countedSeedStrongs.has(srcS)) {
                  countedSeedStrongs.add(srcS);
                  idfWeightSum += weightOfSeedStrongs(srcS);
                }
              }
            }
          }
          if (sharedContentCount > 0 || lxxBridgeCount > 0) {
            overlapBonus = Math.min(90, Math.round(sharedContentCount * 12 + lxxBridgeCount * 6 + idfWeightSum * 3));
          }
        }

        crossReferencesOut.push({
          from_ref: ep.ref,
          to_ref: toPassage.ref,
          anchor_phrase: phrase,
          from_passage: ep,
          to_passage: toPassage,
        });
        const xrefId = `r11:xref:${ep.verse_id}:${toVid}`;
        e2SeedXrefIds.add(xrefId);
        allCandidates.push(buildXrefRecord({
          evidenceId: xrefId,
          fromPassage: ep,
          toPassage,
          phrase,
          isReciprocal,
          isCrossTest,
          sharedContentCount,
          lxxBridgeCount,
          overlapBonus,
          isPassageIntent: (isPassageOnlyQuery && query.mode !== 'bridge') || hasExplicitAnchorPassage,
          scenePairsText: item.scenePairsText,
          sceneRoleCount: item.sceneRoles,
        }));
      }

      // Surface embedded Stream A (structural/rare-lemma), Stream B (pericope proper-name), Stream C (same-chapter progression)
      if ((scenes || []).length > 0 && (isPassageOnlyQuery || parsedRefs.length > 0)) {
        const nonDupScenes = (scenes || []).filter((sc: any[]) => {
          const kind = Number(sc?.[0] || 0);
          const tVid = Number(sc?.[1] || 0);
          if (!tVid) return false;
          if (kind === 1 && surfacedXrefTargetVids.has(tVid)) return false;
          return true;
        });
        for (const sc of nonDupScenes.slice(0, 6)) {
          const kind = Number(sc[0] || 0);
          const tVid = Number(sc[1] || 0);
          const tRef = String(sc[2] || `Verse ${tVid}`);
          const toPassage = applyRangeRef(buildRefStub(tVid, tRef), tRef);
          let anchorPassage: R10PassageRef | null = null;
          if (kind === 2 && Number(sc[5]) > 0) {
            const aVid = Number(sc[5]);
            const cachedAnchor = bookCache.get(bookForVid(aVid))?.[String(aVid)];
            if (cachedAnchor || (Math.abs(aVid - ep.verse_id) <= 12 && budget.used < budget.max - 10)) {
              anchorPassage = await hydratePassageByVid(aVid, false);
            }
          }
          const rec = buildEmbeddedSceneRecord({
            sceneTuple: sc,
            fromPassage: ep,
            toPassage,
            anchorPassage,
          });
          if (rec) allCandidates.push(rec);
        }
      }

      if (mdForEvents?.event_seq && eventIds.length > 0) {
        const eventById = await ensureEventsMap(mdForEvents);
        const inspected = eventIds.map((evId) => {
          const evInfo = mdForEvents.event_seq![evId];
          const evObj = eventById?.get(evId);
          const evPassagesRaw: any[] = Array.isArray(evObj?.passages) ? evObj.passages : [];
          const isExactMatch = evPassagesRaw.length > 0
            ? evPassagesRaw.some((p: any) => Number(p.verse_id) === ep.verse_id)
            : true;
          const distinctBooks = new Set(
            evPassagesRaw.map((p: any) => Number(p.book)).filter((b: number) => b > 0)
          );
          const nextEvId = evInfo?.next || null;
          const nextInfo = nextEvId ? mdForEvents.event_seq![nextEvId] || null : null;
          const nextVid = nextInfo?.sample_vids?.[0];
          const nextJumpsBook = Boolean(nextVid && bookForVid(Number(nextVid)) !== ep.book);
          const isSameBookEvent = Boolean(evInfo) && (
            isExactMatch ||
            (distinctBooks.size <= 1 && (distinctBooks.size === 0 || distinctBooks.has(ep.book)) && !nextJumpsBook)
          );
          return { evId, evInfo, isExactMatch, distinctBooks, nextEvId, nextInfo, nextVid, nextJumpsBook, isSameBookEvent };
        }).filter((x) => Boolean(x.evInfo));
        const hasSameBookEvent = inspected.some((x) => x.isSameBookEvent);
        const seenEvIds = new Set<string>();
        const chunkSize = fastManifest?.verse_chunk_size || 64;
        const summaryToPassage = (vid: number, sum: [number, number, number, string, string, string | null | undefined]): R10PassageRef => {
          const [sBook, sChapter, sVerse, sRef, sEn, sMtRef] = sum;
          return {
            verse_id: vid,
            ref: sRef,
            ...(sMtRef !== null && sMtRef !== undefined ? { mt_ref: sMtRef } : {}),
            book: sBook,
            chapter: sChapter,
            verse: sVerse,
            testament: sBook <= 39 ? 'OT' : 'NT',
            snippet: sEn,
            is_psalm_heading: sBook === 19 && sVerse === 0,
          };
        };
        let nextEventChapterReads = 0;
        let addedEvents = 0;

        for (const item of inspected) {
          if (seenEvIds.has(item.evId)) continue;
          seenEvIds.add(item.evId);
          if (!item.isExactMatch && (item.distinctBooks.size > 1 || (item.nextJumpsBook && hasSameBookEvent))) {
            continue;
          }
          const evId = item.evId;
          const evInfo = item.evInfo!;
          const nextEvId = item.nextEvId;
          const nextInfo = item.nextInfo;
          const nextVid = item.nextVid;
          const nextPassage = nextVid ? await hydratePassageByVid(Number(nextVid), false) : null;

          // Up to 1 already-loaded same-book witness from evInfo.sample_vids (0 extra reads, preferring same chapter)
          let evSamplePassage: R10PassageRef | null = null;
          if (fastManifest?.direct_b64gz && Array.isArray(evInfo.sample_vids)) {
            let bestSampleDist = Infinity;
            for (const rawVid of evInfo.sample_vids) {
              const sVid = Number(rawVid);
              if (!sVid || sVid === ep.verse_id || sVid === nextPassage?.verse_id || bookForVid(sVid) !== ep.book) continue;
              const sChunkHex = Math.floor((sVid - 1) / chunkSize).toString(16).padStart(3, '0');
              const sChunkPath = `fast-verses/chunk-${sChunkHex}.json.gz`;
              if (!budget.pages?.has(sChunkPath)) continue;
              const sChunk = await budget.pages.get(sChunkPath);
              const sum = sChunk?.summaries?.[String(sVid)];
              if (!sum) continue;
              const sameChapterPenalty = sum[1] === ep.chapter ? 0 : 10000;
              const candDist = sameChapterPenalty + Math.abs(sVid - ep.verse_id);
              if (candDist < bestSampleDist) {
                bestSampleDist = candDist;
                evSamplePassage = summaryToPassage(sVid, sum);
              }
            }
          }

          // Check event_by_chapter for an uncovered same-book chapter of nextEvId (highest reciprocal xref anchor)
          let nextSpanPassage: R10PassageRef | null = null;
          const epBookChVids = bookChapterVids.get(ep.book);
          if (fastManifest?.direct_b64gz && nextEvId && nextInfo && mdForEvents.event_by_chapter && epBookChVids) {
            const coveredChapters = new Set<number>();
            if (nextPassage && nextPassage.book === ep.book) coveredChapters.add(nextPassage.chapter);
            for (const rawSv of nextInfo.sample_vids || []) {
              const sv = Number(rawSv);
              if (bookForVid(sv) !== ep.book) continue;
              for (const [chStr, vids] of Object.entries(epBookChVids)) {
                if (vids.length > 0 && sv >= Number(vids[0]) && sv <= Number(vids[vids.length - 1]) && vids.some(v => Number(v) === sv)) {
                  coveredChapters.add(Number(chStr));
                  break;
                }
              }
            }

            const uncoveredChapters: number[] = [];
            const prefix = `${ep.book}:`;
            for (const [chKey, evList] of Object.entries(mdForEvents.event_by_chapter)) {
              if (!chKey.startsWith(prefix) || !Array.isArray(evList) || !evList.includes(nextEvId)) continue;
              const chNum = Number(chKey.slice(prefix.length));
              if (chNum && chNum !== ep.chapter && !coveredChapters.has(chNum)) uncoveredChapters.push(chNum);
            }
            uncoveredChapters.sort((a, b) => Number(b > ep.chapter) - Number(a > ep.chapter) || a - b);

            const targetCh = uncoveredChapters[0];
            const targetVids = targetCh ? (epBookChVids[String(targetCh)] || []).map(v => Number(v)) : [];
            if (targetVids.length > 0) {
              const targetChunks = [...new Set(targetVids.map(v => `fast-verses/chunk-${Math.floor((v - 1) / chunkSize).toString(16).padStart(3, '0')}.json.gz`))];
              if (!targetChunks.some(p => budget.pages?.has(p)) && nextEventChapterReads < 1 && budget.used < budget.max - 8) {
                nextEventChapterReads++;
                await readR10Json(reader, releaseId, targetChunks[0], budget);
              }
              let bestRecip = -1;
              let bestTotal = -1;
              for (const tVid of targetVids) {
                const tChunkPath = `fast-verses/chunk-${Math.floor((tVid - 1) / chunkSize).toString(16).padStart(3, '0')}.json.gz`;
                if (!budget.pages?.has(tChunkPath)) continue;
                const tChunk = await budget.pages.get(tChunkPath);
                const tEvents: string[] = tChunk?.events?.[String(tVid)] || [];
                if (!tEvents.includes(nextEvId)) continue;
                const sum = tChunk?.summaries?.[String(tVid)];
                if (!sum) continue;
                const xrefs: any[] = tChunk?.xrefs?.[String(tVid)] || [];
                const recip = xrefs.filter(x => (Number(x[3]) & 1) !== 0).length;
                if (recip > bestRecip || (recip === bestRecip && xrefs.length > bestTotal)) {
                  bestRecip = recip;
                  bestTotal = xrefs.length;
                  nextSpanPassage = summaryToPassage(tVid, sum);
                }
              }
            }
          }

          const rec = buildEventRecord({
            evidenceId: `r12:event:${ep.verse_id}:${evId}`,
            anchorPassage: ep,
            evId,
            evInfo,
            nextEvId,
            nextInfo,
            nextPassage,
            isExactMatch: item.isExactMatch,
            evSamplePassage,
            nextSpanPassage,
          });
          allCandidates.push(rec);
          matchedEvents.push({
            event_id: evId,
            title: evInfo.title,
            start_date: evInfo.start_date,
            passages: rec.passages,
          });
          addedEvents++;
          if (addedEvents >= 2) break;
        }
      }
    }

    if (!query.lite_subgraph_mode && explicitPassageVidSet.size <= 4 && isPassageOnlyQuery && query.mode !== 'bridge' && pericopeNeighbors.length > 0) {
      const neighborXrefCands: Array<{
        nEp: R10PassageRef; parentRef: string; dist: number; toVid: number; toRef: string;
        phrase: string; isReciprocal: boolean; lexCount: number; lxxCount: number; idf10: number; overlapBonus: number;
      }> = [];
      for (const pn of pericopeNeighbors) {
        for (const xr of pn.xrefs || []) {
          const [toVidRaw, toRef, phrase, flags, rawLex, rawLxx, rawIdf10] = xr;
          const toVid = Number(toVidRaw);
          if (!toVid || surfacedXrefTargetVids.has(toVid) || explicitPassageVidSet.has(toVid)) continue;
          const isReciprocal = (Number(flags) & 1) !== 0;
          const toTestament = bookForVid(toVid) <= 39 ? 'OT' : 'NT';
          const isCrossTest = (Number(flags) & 2) !== 0 || pn.ep.testament !== toTestament;
          if (!isCrossTest) continue;
          if (!isReciprocal && pn.dist > 2) continue;
          const lexCount = Number(rawLex || 0);
          const lxxCount = Number(rawLxx || 0);
          const idf10 = Number(rawIdf10 || 0);
          const overlapBonus = (lexCount > 0 || lxxCount > 0 || idf10 > 0)
            ? Math.min(180, Math.round(idf10 * 0.8 + (lexCount + lxxCount) * 12))
            : 0;
          neighborXrefCands.push({
            nEp: pn.ep,
            parentRef: pn.parentRef,
            dist: pn.dist,
            toVid,
            toRef: String(toRef),
            phrase: String(phrase || ''),
            isReciprocal,
            lexCount,
            lxxCount,
            idf10,
            overlapBonus,
          });
        }
      }
      neighborXrefCands.sort((a, b) =>
        Number(a.dist > 4) - Number(b.dist > 4) ||
        b.overlapBonus - a.overlapBonus ||
        Number(b.isReciprocal) - Number(a.isReciprocal) ||
        a.dist - b.dist ||
        a.toVid - b.toVid
      );
      const pickedToVids = new Set<number>();
      for (const cand of neighborXrefCands) {
        if (pickedToVids.has(cand.toVid)) continue;
        pickedToVids.add(cand.toVid);
        const toPassage = applyRangeRef(buildRefStub(cand.toVid, cand.toRef), cand.toRef);
        const xrefId = `r11:xref:${cand.nEp.verse_id}:${cand.toVid}`;
        pericopeXrefIds.add(xrefId);
        const isCorrob = (cand.lexCount + cand.lxxCount) >= 1 || cand.idf10 >= 40;
        const rec = buildXrefRecord({
          evidenceId: xrefId,
          fromPassage: cand.nEp,
          toPassage,
          phrase: cand.phrase,
          isReciprocal: cand.isReciprocal,
          isCrossTest: true,
          sharedContentCount: cand.lexCount,
          lxxBridgeCount: cand.lxxCount,
          overlapBonus: cand.overlapBonus,
          isPassageIntent: isPassageOnlyQuery,
          backgroundPenalty: isCorrob ? 85 : (cand.isReciprocal ? 110 : 135),
        });
        rec.title = `${rec.title} (same-chapter pericope context near ${cand.parentRef})`;
        rec.summary = `Same-chapter pericope context (${cand.nEp.ref}, ${cand.dist}v from ${cand.parentRef}): ${rec.summary}`;
        rec.limitations = [
          `Surfaced from neighboring same-chapter pericope verse ${cand.nEp.ref} (not ${cand.parentRef} directly).`,
          ...rec.limitations,
        ];
        crossReferencesOut.push({
          from_ref: cand.nEp.ref,
          to_ref: toPassage.ref,
          anchor_phrase: cand.phrase,
          from_passage: cand.nEp,
          to_passage: toPassage,
        });
        allCandidates.push(rec);
        if (pickedToVids.size >= 3) break;
      }
    }
  }

  // F. Multi-Concept Dynamic Intersections & Bridges (when >= 2 distinct concept term groups resolve to lemma profiles)
  const explicitNumberStrongs = new Set<string>();
  for (const rc of resolvedConcepts) {
    if (rc.resolution_kind === 'number') {
      for (const l of rc.lemmas) {
        if (l.strongs) explicitNumberStrongs.add(l.strongs);
      }
    }
  }
  const matchedMultiWordTokens = new Set<string>();
  for (const rc of resolvedConcepts) {
    if (rc.matched && rc.input_token.includes(' ')) {
      for (const part of rc.input_token.toLowerCase().split(/\s+/)) {
        if (part.length >= 3) matchedMultiWordTokens.add(part);
      }
    }
  }
  const conceptGroups: Array<{
    term: string;
    profiles: LemmaProfile[];
    vids: Set<number>;
    strongsSet: Set<string>;
    isNumeric: boolean;
    minTotal: number;
  }> = [];
  for (const rc of resolvedConcepts) {
    if (!rc.matched) continue;
    if (!rc.input_token.includes(' ') && matchedMultiWordTokens.has(rc.input_token.toLowerCase())) {
      continue;
    }
    let groupProfs = rc.lemmas
      .map(l => profileByStrongs.get(l.strongs || ''))
      .filter((p): p is LemmaProfile => Boolean(p));
    if (rc.input_token.includes(' ') && groupProfs.length >= 2) {
      const specificPhraseProfs = groupProfs.filter(p => (p.total_verses || 0) <= 360 && p.bs !== 'H3117' && p.bs !== 'G2250');
      if (specificPhraseProfs.length > 0) {
        groupProfs = specificPhraseProfs;
      }
    } else if (rc.resolution_kind !== 'number' && explicitNumberStrongs.size > 0) {
      const nonNumProfs = groupProfs.filter(p => !SMALL_NUMERAL_STRONGS.has(p.bs) && !explicitNumberStrongs.has(p.bs));
      if (nonNumProfs.length > 0) groupProfs = nonNumProfs;
    }
    if (groupProfs.length > 0) {
      const combinedVids = new Set<number>();
      const strongsSet = new Set<string>();
      for (const p of groupProfs) {
        strongsSet.add(p.bs);
        for (const v of p.all_vids) combinedVids.add(v);
      }
      const positiveTotals = groupProfs.map(p => p.total_verses || 0).filter(t => t > 0);
      const minTotal = positiveTotals.length > 0 ? Math.min(...positiveTotals) : 99999;
      const isNumeric = rc.resolution_kind === 'number' || groupProfs.every(p => SMALL_NUMERAL_STRONGS.has(p.bs));
      conceptGroups.push({ term: rc.input_token, profiles: groupProfs, vids: combinedVids, strongsSet, isNumeric, minTotal });
    }
  }

  const nonNumericGroups = conceptGroups.filter(g => !g.isNumeric);
  const minNonNumericTotal = nonNumericGroups.length > 0
    ? Math.min(...nonNumericGroups.map(g => g.minTotal))
    : Infinity;
  const maxGroupTotal = conceptGroups.length > 0
    ? Math.max(...conceptGroups.map(g => g.minTotal))
    : 0;
  const requireGoverning =
    nonNumericGroups.length >= 1 &&
    (conceptGroups.length >= 3 || (conceptGroups.some(g => g.isNumeric) && maxGroupTotal / Math.max(1, minNonNumericTotal) >= 4));
  const governingGroups = requireGoverning
    ? nonNumericGroups.filter(g => g.minTotal === minNonNumericTotal)
    : [];
  const governingGroupSet = new Set(governingGroups);

  if (conceptGroups.length >= 2) {
    let intersectHydrateReads = 0;
    for (let i = 0; i < conceptGroups.length; i++) {
      for (let j = i + 1; j < conceptGroups.length; j++) {
        const gA = conceptGroups[i];
        const gB = conceptGroups[j];
        const sharedVids = [...gA.vids].filter(v => gB.vids.has(v));
        const touchesGoverning = governingGroupSet.size === 0 || governingGroupSet.has(gA) || governingGroupSet.has(gB);
        if (governingGroupSet.size > 0 && !touchesGoverning) continue;

        // 1. Same-verse intersections (with compound numeral guard, proximity & sense verification)
        if (sharedVids.length > 0) {
          const involvesNumeral =
            matchedNumbers.size > 0 ||
            gA.profiles.some(p => SMALL_NUMERAL_STRONGS.has(p.bs)) ||
            gB.profiles.some(p => SMALL_NUMERAL_STRONGS.has(p.bs));
          const aSet = new Set(gA.profiles.map(pr => pr.bs));
          const bSet = new Set(gB.profiles.map(pr => pr.bs));
          const aVidSets = new Map(gA.profiles.map(pr => [pr.bs, new Set(pr.all_vids)]));
          const bVidSets = new Map(gB.profiles.map(pr => [pr.bs, new Set(pr.all_vids)]));
          const minCrossPairTotal = (vid: number): number => {
            let best = Infinity;
            for (const pa of gA.profiles) {
              if (!aVidSets.get(pa.bs)?.has(vid)) continue;
              for (const pb of gB.profiles) {
                if (pb.bs === pa.bs || !bVidSets.get(pb.bs)?.has(vid)) continue;
                const tot = (pa.total_verses || 99999) + (pb.total_verses || 99999);
                if (tot < best) best = tot;
              }
            }
            return best;
          };
          const sortedShared = [...sharedVids].sort((v1, v2) => {
            const m1 = minCrossPairTotal(v1);
            const m2 = minCrossPairTotal(v2);
            const b1 = bookForVid(v1);
            const b2 = bookForVid(v2);
            const isProphOrNt1 = (b1 >= 23 && b1 <= 39) || b1 >= 40;
            const isProphOrNt2 = (b2 >= 23 && b2 <= 39) || b2 >= 40;
            return (
              Number(m1 < Infinity) - Number(m2 < Infinity) ||
              Number(contextVerseIds.has(v2)) - Number(contextVerseIds.has(v1)) ||
              m1 - m2 ||
              (asksResurrection && asksDayNumber ? Number(isProphOrNt2) - Number(isProphOrNt1) : 0) ||
              v1 - v2
            );
          });
          const sameLemmaOnly = !sortedShared.some(v => minCrossPairTotal(v) < Infinity);
          const sliceCap = sameLemmaOnly ? 3 : (involvesNumeral ? 6 : 5);
          const inspectSlice = sortedShared.slice(0, sliceCap);
          const candidateVids: Array<{ vid: number; p: R10PassageRef; pA: LemmaProfile; pB: LemmaProfile; toks: any[]; minDist: number }> = [];
          for (const vid of inspectSlice) {
            if (budget.used >= budget.max - 6) break;
            const cachedInBook = bookCache.get(bookForVid(vid))?.[String(vid)];
            if (!cachedInBook && intersectHydrateReads >= 4) break;
            const usedBefore = budget.used;
            const p = await hydratePassageByVid(vid, true);
            if (budget.used > usedBefore) intersectHydrateReads++;
            if (!p) continue;
            const pA = gA.profiles.find(pr => pr.all_vids.includes(vid));
            const pB = gB.profiles.find(pr => pr.bs !== pA?.bs && pr.all_vids.includes(vid)) || gB.profiles.find(pr => pr.all_vids.includes(vid));
            if (!pA || !pB) continue;
            const vData = bookCache.get(p.book)?.[String(vid)];
            const toks: any[] = vData?.toks || [];

            if (pA.bs !== pB.bs) {
              if (!verifyTermSenseInVerse(gA.term, pA, p, toks) || !verifyTermSenseInVerse(gB.term, pB, p, toks)) {
                continue;
              }
            }

            if (involvesNumeral) {
              const numToks = toks.filter(t => SMALL_NUMERAL_STRONGS.has(t.s) && (aSet.has(t.s) || bSet.has(t.s)));
              const hasCompoundMagnitudeAdjacent = numToks.some(nt =>
                toks.some(mt => COMPOUND_MAGNITUDE_STRONGS.has(mt.s) && Math.abs((nt.wn || 0) - (mt.wn || 0)) <= 2)
              );
              if (hasCompoundMagnitudeAdjacent) continue;
            }
            const aWns = toks.filter(t => aSet.has(t.s)).map(t => Number(t.wn || 0));
            const bWns = toks.filter(t => bSet.has(t.s)).map(t => Number(t.wn || 0));
            let minDist = 999;
            for (const wa of aWns) {
              for (const wb of bWns) minDist = Math.min(minDist, Math.abs(wa - wb));
            }
            candidateVids.push({ vid, p, pA, pB, toks, minDist });
          }
          candidateVids.sort((x, y) =>
            Number(y.minDist <= 6) - Number(x.minDist <= 6) || x.minDist - y.minDist || x.vid - y.vid
          );

          for (const { vid, p, pA, pB, toks, minDist } of candidateVids.slice(0, 6)) {

            if (pA.bs === pB.bs) {
              const seenWn = new Set<number>();
              const sameToks = toks.filter(t => {
                if (t.s !== pA.bs || seenWn.has(t.wn)) return false;
                seenWn.add(t.wn);
                return true;
              });
              if (sameToks.length >= 2) {
                allCandidates.push({
                  evidence_id: `r11:repeat:verse:${pA.bs}:${vid}`,
                  predicate: 'verified_lexical_grammatical',
                  evidence_tier: 3,
                  epistemic_class: 'direct_textual_evidence',
                  title: `Repeated lemma in ${p.ref}: ${pA.sc} (${pA.bs}, ${sameToks.length}×)`,
                  summary: `${p.ref} attests ${sameToks.length} distinct token occurrences of the same lemma ${pA.sc} (${pA.bs}, "${pA.gl}") at word positions ${sameToks.map(t => t.wn).join(', ')}.`,
                  source_node_id: `lemma:${pA.bs}`,
                  target_node_id: `passage:${p.ref}`,
                  passages: [p],
                  original_words: [
                    { lemma_key: pA.lk, strongs: pA.bs, language: pA.lang, lemma_script: pA.sc, transliteration: pA.tr, gloss: pA.gl },
                  ],
                  matched_terms: [gA.term, gB.term, pA.gl],
                  limitations: ['Repetition of a single canonical lemma across distinct verse tokens; context determines whether each occurrence carries the same or distinct contextual sense.'],
                  provenance: {
                    source_dataset: 'MACULA Hebrew & Greek',
                    source_record_ids: sameToks.map(t => `${p.ref}#${t.wn}`),
                    license: 'CC BY 4.0',
                    derivation_method: 'repeated_lemma_distinct_tokens',
                  },
                  score_components: {
                    base_tier_score: TIER_BASE_SCORE[3],
                    specificity_bonus: 110,
                    witness_bonus: Math.min(40, sameToks.length * 10),
                    common_word_penalty: 0,
                    number_coincidence_penalty: 0,
                    orthographic_penalty: 0,
                    final_score: TIER_BASE_SCORE[3] + 110 + Math.min(40, sameToks.length * 10),
                  },
                });
              } else if (gA.term !== gB.term) {
                const singleWn = sameToks[0]?.wn;
                allCandidates.push({
                  evidence_id: `r11:polysemy:${pA.bs}:${vid}`,
                  predicate: 'interpretive_hypothesis',
                  evidence_tier: 5,
                  epistemic_class: 'documented_lexical_relationship',
                  title: `Single-token polysemy notice: "${gA.term}" and "${gB.term}" map to one ${pA.sc} (${pA.bs}) token in ${p.ref}`,
                  summary: `Both "${gA.term}" and "${gB.term}" resolve to the single lemma ${pA.sc} (${pA.bs}, "${pA.gl}"), which occurs once in ${p.ref}${singleWn ? ` (word ${singleWn})` : ''}. Lexical polysemy is not two independent co-occurring words.`,
                  source_node_id: `lemma:${pA.bs}`,
                  target_node_id: `lemma:${pA.bs}`,
                  passages: [p],
                  original_words: [
                    { lemma_key: pA.lk, strongs: pA.bs, language: pA.lang, lemma_script: pA.sc, transliteration: pA.tr, gloss: pA.gl },
                  ],
                  matched_terms: [gA.term, gB.term, pA.gl],
                  limitations: ['Single source occurrence only; multiple English glosses of one polysemous word do not establish independent textual convergence.'],
                  provenance: {
                    source_dataset: 'MACULA Hebrew & Greek + STEPBible',
                    source_record_ids: [singleWn ? `${p.ref}#${singleWn}` : p.ref],
                    license: 'CC BY 4.0',
                    derivation_method: 'single_token_polysemy_notice',
                  },
                  score_components: {
                    base_tier_score: TIER_BASE_SCORE[5],
                    specificity_bonus: 40,
                    witness_bonus: 0,
                    common_word_penalty: 0,
                    number_coincidence_penalty: 0,
                    orthographic_penalty: 0,
                    final_score: TIER_BASE_SCORE[5] + 40,
                  },
                });
              }
              continue;
            }

            const senseA = resolveDisplaySense(pA, [p], toks);
            const senseB = resolveDisplaySense(pB, [p], toks);
            const evId = `r11:intersect:verse:${pA.bs}:${pB.bs}:${vid}`;
            const proxBonus = minDist <= 4 ? 20 : 0;
            const idfA = Math.max(0, Math.log(31203 / Math.max(1, pA.total_verses || 100)) - 2.5);
            const idfB = Math.max(0, Math.log(31203 / Math.max(1, pB.total_verses || 100)) - 2.5);
            const idfBonus = Math.min(80, Math.round((idfA + idfB) * 10));
            const witBonus = Math.min(25, sharedVids.length * 4);
            allCandidates.push({
              evidence_id: evId,
              predicate: 'verified_lexical_grammatical',
              evidence_tier: 2,
              epistemic_class: 'direct_textual_evidence',
              title: `Direct textual convergence: "${gA.term}" + "${gB.term}" in ${p.ref}`,
              summary: `Scripture text contains both ${senseA.sc} ("${senseA.gl}") and ${senseB.sc} ("${senseB.gl}") in the same verse (${p.ref}): "${p.snippet || ''}". Direct primary witness of co-occurrence.`,
              source_node_id: `lemma:${pA.bs}`,
              target_node_id: `lemma:${pB.bs}`,
              passages: [p],
              original_words: [
                { lemma_key: senseA.lk, strongs: pA.bs, language: pA.lang, lemma_script: senseA.sc, transliteration: senseA.tr, gloss: senseA.gl },
                { lemma_key: senseB.lk, strongs: pB.bs, language: pB.lang, lemma_script: senseB.sc, transliteration: senseB.tr, gloss: senseB.gl },
              ],
              matched_terms: [gA.term, gB.term, senseA.gl, senseB.gl],
              limitations: ['Direct intra-verse co-occurrence establishes textual contact; syntax and discourse function determine relationship.'],
              provenance: {
                source_dataset: 'MACULA Hebrew & Greek',
                source_record_ids: [p.ref],
                license: 'CC BY 4.0',
                derivation_method: 'exact_verse_lemma_intersection',
              },
              score_components: {
                base_tier_score: TIER_BASE_SCORE[2],
                specificity_bonus: 135 + proxBonus + idfBonus,
                witness_bonus: witBonus,
                common_word_penalty: 0,
                number_coincidence_penalty: 0,
                orthographic_penalty: 0,
                final_score: TIER_BASE_SCORE[2] + 135 + proxBonus + idfBonus + witBonus,
              },
            });
          }
        }

        // 2. Pericope window intersections (1 <= |vidA - vidB| <= 4 in same book)
        const pericopeCandidates: Array<{ vA: number; vB: number; profA: LemmaProfile; profB: LemmaProfile; priority: number }> = [];
        const arrA = [...gA.vids].sort((a, b) => a - b);
        const arrB = [...gB.vids].sort((a, b) => a - b);
        const termAStems = extractSenseStems(gA.term);
        const termBStems = extractSenseStems(gB.term);
        let startB = 0;
        for (const vA of arrA) {
          while (startB < arrB.length && arrB[startB] < vA - 4) startB++;
          for (let bIndex = startB; bIndex < arrB.length && arrB[bIndex] <= vA + 4; bIndex++) {
            const vB = arrB[bIndex];
            const diff = Math.abs(vA - vB);
            if (diff >= 1 && diff <= 4 && bookForVid(vA) === bookForVid(vB)) {
              const pA = gA.profiles.find(pr => pr.all_vids.includes(vA));
              const pB = gB.profiles.find(pr => pr.all_vids.includes(vB));
              if (pA && pB && pA.bs !== pB.bs) {
                const aDirect = countStemOverlap(termAStems, extractSenseStems(pA.gl)) > 0 ? 1 : 0;
                const bDirect = countStemOverlap(termBStems, extractSenseStems(pB.gl)) > 0 ? 1 : 0;
                const ctxBoost = (contextVerseIds.has(vA) || contextVerseIds.has(vB)) ? 2 : 0;
                pericopeCandidates.push({ vA, vB, profA: pA, profB: pB, priority: aDirect + bDirect + ctxBoost });
              }
            }
          }
          if (pericopeCandidates.length >= 24) break;
        }
        pericopeCandidates.sort((x, y) => y.priority - x.priority || Math.abs(x.vA - x.vB) - Math.abs(y.vA - y.vB) || x.vA - y.vA);

        let pericopeEmitted = 0;
        const pericopeInvolvesNumeral =
          matchedNumbers.size > 0 || gA.isNumeric || gB.isNumeric ||
          gA.profiles.some(p => SMALL_NUMERAL_STRONGS.has(p.bs)) ||
          gB.profiles.some(p => SMALL_NUMERAL_STRONGS.has(p.bs));
        if (touchesGoverning) {
          for (const { vA, vB, profA, profB } of pericopeCandidates.slice(0, 6)) {
            if (pericopeEmitted >= 2) break;
            if (budget.used >= budget.max - 6 || intersectHydrateReads >= 6) break;
            const needSenseA = pericopeInvolvesNumeral || (profA.homograph_siblings || []).some(s => s.bs === profA.bs);
            const needSenseB = pericopeInvolvesNumeral || (profB.homograph_siblings || []).some(s => s.bs === profB.bs);
            const usedBefore = budget.used;
            const pA = await hydratePassageByVid(vA, needSenseA);
            const pB = await hydratePassageByVid(vB, needSenseB);
            intersectHydrateReads += Math.max(0, budget.used - usedBefore);
            if (!pA || !pB) continue;
            const toksA: any[] = bookCache.get(pA.book)?.[String(vA)]?.toks || [];
            const toksB: any[] = bookCache.get(pB.book)?.[String(vB)]?.toks || [];
            if (!verifyTermSenseInVerse(gA.term, profA, pA, toksA) || !verifyTermSenseInVerse(gB.term, profB, pB, toksB)) {
              continue;
            }
            if (pericopeInvolvesNumeral) {
              const hasCompoundNearNum = (toks: any[]) => toks
                .filter(t => SMALL_NUMERAL_STRONGS.has(t.s))
                .some(nt => toks.some(mt => COMPOUND_MAGNITUDE_STRONGS.has(mt.s) && Math.abs((nt.wn || 0) - (mt.wn || 0)) <= 2));
              if (hasCompoundNearNum(toksA) || hasCompoundNearNum(toksB)) continue;
              const pTokMap = new Map<number, any[]>([[vA, toksA], [vB, toksB]]);
              if (asksDayNumber && isYearUnitWithoutDayPassage([pA, pB], pTokMap)) continue;
            }
            const senseA = resolveDisplaySense(profA, [pA], toksA);
            const senseB = resolveDisplaySense(profB, [pB], toksB);
            pericopeEmitted++;
            allCandidates.push({
              evidence_id: `r11:intersect:pericope:${vA}:${vB}`,
              predicate: 'shared_motif',
              evidence_tier: 4,
              epistemic_class: 'shared_motif_evidence',
              title: `Close pericope proximity: "${gA.term}" (${pA.ref}) ↔ "${gB.term}" (${pB.ref})`,
              summary: `Original-language terms ${senseA.sc} ("${senseA.gl}") and ${senseB.sc} ("${senseB.gl}") appear within ${Math.abs(vA - vB)} verse(s) of each other in the same literary context (${pA.ref} and ${pB.ref}).`,
              source_node_id: `passage:${pA.ref}`,
              target_node_id: `passage:${pB.ref}`,
              passages: [pA, pB],
              original_words: [
                { lemma_key: senseA.lk, strongs: profA.bs, language: profA.lang, lemma_script: senseA.sc, transliteration: senseA.tr, gloss: senseA.gl },
                { lemma_key: senseB.lk, strongs: profB.bs, language: profB.lang, lemma_script: senseB.sc, transliteration: senseB.tr, gloss: senseB.gl },
              ],
              matched_terms: [gA.term, gB.term, senseA.gl, senseB.gl],
              limitations: ['A four-verse window is a statistical proximity candidate, not a verified pericope boundary or intentional literary relationship.'],
              provenance: {
                source_dataset: 'MACULA Hebrew & Greek',
                source_record_ids: [pA.ref, pB.ref],
                license: 'CC BY 4.0',
                derivation_method: 'pericope_window_intersection',
              },
              score_components: {
                base_tier_score: TIER_BASE_SCORE[4],
                specificity_bonus: 90,
                witness_bonus: 20,
                common_word_penalty: 0,
                number_coincidence_penalty: 0,
                orthographic_penalty: 0,
                final_score: TIER_BASE_SCORE[4] + 90 + 20,
              },
            });
          }
        }

        // 3. Shared collocation / xref bridges
        const profA = gA.profiles[0];
        const profB = gB.profiles[0];
        const collocA = new Map<string, { sc: string; gl: string; score: number }>();
        for (const cl of profA.clusters || []) {
          for (const cw of cl.collocated_words || []) collocA.set(cw.bs, { sc: cw.sc, gl: cw.gl, score: cw.score });
        }
        for (const cl of profB.clusters || []) {
          for (const cw of cl.collocated_words || []) {
            if (collocA.has(cw.bs)) {
              const bBridgeId = `bridge:concept:${profA.bs}:${profB.bs}:${cw.bs}`;
              if (!bridges.some(b => b.bridge_id === bBridgeId)) {
                const bridgeNode: R10Node = {
                  id: `lemma:${cw.bs}`,
                  kind: 'lemma',
                  label: `${cw.sc} (${cw.gl})`,
                  strongs: cw.bs,
                  epistemic_class: 'direct_textual_evidence',
                  grounding_source: 'STEPBible + MACULA',
                };
                bridges.push({
                  bridge_id: bBridgeId,
                  from_cluster_id: profA.clusters?.[0]?.cluster_id || profA.bs,
                  to_cluster_id: profB.clusters?.[0]?.cluster_id || profB.bs,
                  bridging_node: bridgeNode,
                  evidence_id: `r11:bridge:${profA.bs}:${profB.bs}:${cw.bs}`,
                  evidence_tier: 4,
                  explanation: `Both "${gA.term}" and "${gB.term}" significantly co-occur with ${cw.sc} ("${cw.gl}" · ${cw.bs}) in scriptural contexts.`,
                });
              }
            }
          }
        }
      }
    }
  }

  // Explicit and typology records matching query
  for (const rec of explicitData.records || []) {
    const recTerms = new Set((rec.matched_terms || []).map((t: string) => t.toLowerCase()));
    const matchedQueryTerms: string[] = [];
    for (const qt of queryTermSet) {
      if (recTerms.has(qt)) matchedQueryTerms.push(qt);
    }
    const matchedStrongsLabels: string[] = [];
    for (const ow of rec.original_words || []) {
      if (ow.strongs && matchedStrongs.has(ow.strongs) && !matchedStrongsLabels.includes(ow.strongs)) {
        matchedStrongsLabels.push(ow.strongs);
      }
    }
    const strongsOverlap = matchedStrongsLabels.length;
    let passageOverlap = 0;
    for (const pr of parsedRefs) {
      if ((rec.passages || []).some((p: R10PassageRef) => p.book === pr.book && p.chapter === pr.chapter && (!pr.verse || p.verse === pr.verse || (p.end_verse && pr.verse >= p.verse && pr.verse <= p.end_verse)))) {
        passageOverlap++;
      }
    }
    let pericopeOverlap = 0;
    if (isPassageOnlyQuery && passageOverlap === 0 && pericopeNeighbors.length > 0) {
      for (const pn of pericopeNeighbors) {
        if ((rec.passages || []).some((p: R10PassageRef) => p.book === pn.ep.book && p.chapter === pn.ep.chapter && p.verse === pn.ep.verse)) {
          pericopeOverlap++;
          break;
        }
      }
    }

    const isRawEnglishWordQuery = !isPassageOnlyQuery && parsedRefs.length === 0 && !/[HG]\d{3,5}/i.test(query.query || '');
    if (isRawEnglishWordQuery && !multiConcept && matchedQueryTerms.length === 0) continue;
    const totalHits = matchedQueryTerms.length + Math.min(2, strongsOverlap) + passageOverlap * 2 + pericopeOverlap;
    if (totalHits === 0) continue;
    const rareStrongsOverlap = matchedStrongsLabels.filter(s => {
      const p = profileByStrongs.get(s);
      return Boolean(p && p.total_verses <= 250);
    }).length;
    if (isPassageOnlyQuery && passageOverlap === 0 && pericopeOverlap === 0 && rareStrongsOverlap < 2) continue;
    if (multiConcept && matchedQueryTerms.length < 1 && strongsOverlap < 1 && passageOverlap === 0) continue;
    if (rec.evidence_id?.startsWith('r10:ident:auto:') && multiConcept && matchedQueryTerms.length < 2 && passageOverlap === 0) continue;

    const effectiveConceptMatches = new Set([
      ...matchedQueryTerms,
      ...matchedStrongsLabels.map(s =>
        resolvedConcepts.find(c => c.lemmas.some(l => l.strongs === s))?.normalized ?? s
      ),
    ]).size;

    const tier = rec.evidence_tier as R10EvidenceTier;
    const baseScore = TIER_BASE_SCORE[tier] ?? 400;
    const specificityBonus = effectiveConceptMatches * 140 + passageOverlap * 120 + (pericopeOverlap > 0 ? 65 : 0) + (rec.passages?.some((p: any) => p.testament === 'OT') && rec.passages?.some((p: any) => p.testament === 'NT') ? 45 : 0);
    const witnessBonus = Math.min(60, (rec.passages?.length || 1) * 12);
    const singleConceptInMultiPenalty = multiConcept && effectiveConceptMatches < 2 && passageOverlap === 0 ? 320 : 0;
    const passageBackgroundPenalty = isPassageOnlyQuery && passageOverlap === 0 ? (pericopeOverlap > 0 ? 160 : 280) : 0;
    const commonWordPenalty =
      (matchedQueryTerms.length === 1 && ['water', 'spirit', 'earth', 'blood', 'light', 'jesus'].includes(matchedQueryTerms[0]) && passageOverlap === 0 ? 120 : 0) +
      passageBackgroundPenalty;
    const numberCoincPenalty = rec.number_classification?.coincidence_risk === 'high' ? 220 : 0;
    const orthPenalty = rec.predicate === 'orthographic_overlap' ? 180 : 0;
    const finalScore = Math.max(10, baseScore + specificityBonus + witnessBonus - singleConceptInMultiPenalty - commonWordPenalty - numberCoincPenalty - orthPenalty);

    allCandidates.push({
      ...rec,
      matched_terms: [...new Set([...matchedQueryTerms, ...matchedStrongsLabels])],
      score_components: {
        base_tier_score: baseScore,
        specificity_bonus: specificityBonus,
        witness_bonus: witnessBonus,
        common_word_penalty: commonWordPenalty,
        number_coincidence_penalty: numberCoincPenalty,
        orthographic_penalty: orthPenalty,
        final_score: finalScore,
      },
    });
  }

  // Synthesize dynamic motif pair evidence
  const motifArray = [...matchedMotifs];
  if (motifArray.length >= 2) {
    const md = await ensureMotifsData();
    const motifPairs = md?.motif_pairs ?? (
      md?.motif_pairs_b64gz
        ? await decodeB64Gz<Record<string, any>>(reader, md.motif_pairs_b64gz, `/r10/motif_pairs:${releaseId}`, budget.b64Cache)
        : undefined
    );
    for (let i = 0; i < motifArray.length; i++) {
      for (let j = i + 1; j < motifArray.length; j++) {
        const [a, b] = [motifArray[i], motifArray[j]].sort();
        const pair = motifPairs?.[`${a}|${b}`];
        if (!pair || !pair.passages?.length) continue;
        const mA = md?.motifs?.[a];
        const mB = md?.motifs?.[b];
        const evId = `r10:synth:motifpair:${a}:${b}`;
        const words = [...(mA?.original_words || []).slice(0, 3), ...(mB?.original_words || []).slice(0, 3)];
        allCandidates.push({
          evidence_id: evId,
          predicate: 'shared_motif',
          evidence_tier: 5,
          epistemic_class: 'shared_motif_evidence',
          title: `Co-occurring biblical motifs: ${mA?.label || a} + ${mB?.label || b} (${pair.count} shared verses)`,
          summary: `Deterministic corpus scan found ${pair.count} verses containing both motifs (${pair.passages.slice(0, 4).map((p: any) => p.ref).join(', ')}). Co-occurrence indicates shared imagery within those verses; context decides whether a theological or typological link exists.`,
          source_node_id: `motif:${a}`,
          target_node_id: `motif:${b}`,
          passages: pair.passages.slice(0, 6),
          original_words: words,
          matched_terms: [a, b],
          limitations: ['Motif co-occurrence does not automatically prove deliberate literary allusion across separate books.'],
          provenance: {
            source_dataset: 'MACULA Hebrew & Greek (31,146 verses scanned)',
            source_record_ids: pair.passages.slice(0, 4).map((p: any) => p.ref),
            license: 'CC BY 4.0',
            derivation_method: 'deterministic_verse_motif_intersection',
          },
          score_components: {
            base_tier_score: TIER_BASE_SCORE[5],
            specificity_bonus: Math.min(80, pair.count * 2),
            witness_bonus: Math.min(50, pair.passages.length * 8),
            common_word_penalty: pair.count > 40 ? 90 : 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: TIER_BASE_SCORE[5] + Math.min(80, pair.count * 2) - (pair.count > 40 ? 90 : 0),
          },
        });
      }
    }
  }

  // Dynamic Number Entity checks
  if (
    matchedNumbers.size > 0 &&
    (governingGroups.length === 0 || !allCandidates.some(c => c.evidence_id.startsWith('r11:intersect:verse:')))
  ) {
    const numbersData = await readR10Json<{ by_value?: Record<string, any> }>(reader, releaseId, 'numbers-index.json.gz', budget);
    if (numbersData?.by_value) {
      for (const nVal of matchedNumbers) {
        const bucket = numbersData.by_value[String(nVal)];
        if (!bucket) continue;
        const relevantGroups = (bucket.groups || []).filter((g: any) =>
          resolvedConcepts.every(c => c.resolution_kind === 'number') ||
          matchedStrongs.has(g.noun_s) ||
          queryTermSet.has(normalizeToken(g.noun_g).split(/\s+/)[0] || '') ||
          g.kind === 'symbolic_vision_count'
        ).slice(0, 4);

        for (const grp of relevantGroups) {
          const isHighCoinc = grp.kind === 'temporal_duration' || grp.count > 25;
          const tier: R10EvidenceTier = grp.kind === 'symbolic_vision_count' ? 4 : 6;
          const pen = isHighCoinc ? 220 : 0;
          const passages: R10PassageRef[] = (grp.samples || []).slice(0, 5).map((s: any) => ({
            verse_id: s.vid,
            ref: s.ref,
            book: s.book,
            chapter: s.ch,
            verse: s.vs,
            testament: s.book <= 39 ? 'OT' : 'NT',
          }));
          allCandidates.push({
            evidence_id: `r10:synth:num:${nVal}:${grp.noun_s}:${grp.kind}`,
            predicate: 'numbered_entity',
            evidence_tier: tier,
            epistemic_class: 'direct_textual_evidence',
            title: `Counted entity (${grp.kind.replace(/_/g, ' ')}): ${nVal} × ${grp.noun_lm} ("${grp.noun_g}", ${grp.count}× in Scripture)`,
            summary: `Syntactic numeral-noun extraction shows ${nVal} modifying ${grp.noun_lm} (${grp.noun_s}, "${grp.noun_g}") across ${grp.count} occurrences (e.g., ${passages.slice(0, 3).map(p => p.ref).join(', ')}).`,
            source_node_id: `number:${nVal}`,
            target_node_id: `lemma:${grp.noun_s}`,
            passages,
            original_words: lemmaCache.has(grp.noun_s) ? [lemmaCache.get(grp.noun_s)!] : [],
            matched_terms: [String(nVal), normalizeToken(grp.noun_g)],
            number_classification: {
              number_value: nVal,
              counted_entity: `${grp.noun_lm} (${grp.noun_g})`,
              kind: grp.kind as R10NumberKind,
              coincidence_risk: isHighCoinc ? 'high' : 'low',
              note: isHighCoinc ? 'High-frequency temporal or ordinary count; shared number alone does NOT establish symbolic equivalence.' : 'Specific counted object / vision entity.',
            },
            limitations: ['Counted-entity matches prove the syntactic numeral+noun phrase appears; theological typology requires contextual or authorial links.'],
            provenance: { source_dataset: 'MACULA Hebrew & Greek syntactic numerals', source_record_ids: passages.slice(0, 3).map(p => p.ref), license: 'CC BY 4.0', derivation_method: 'syntactic_numeral_noun_extraction' },
            score_components: {
              base_tier_score: TIER_BASE_SCORE[tier],
              specificity_bonus: matchedStrongs.has(grp.noun_s) ? 90 : 20,
              witness_bonus: Math.min(40, grp.count * 4),
              common_word_penalty: 0,
              number_coincidence_penalty: pen,
              orthographic_penalty: 0,
              final_score: TIER_BASE_SCORE[tier] + (matchedStrongs.has(grp.noun_s) ? 90 : 20) - pen,
            },
          });
        }
      }
    }
  }

  // Dynamic Orthographic shard lookup
  const hebStrongs = [...matchedStrongs].filter(s => s.startsWith('H')).slice(0, 3);
  const orthDetails: any[] = [];
  for (const hs of hebStrongs) {
    if (fastManifest?.direct_b64gz) {
      const entry = profileByStrongs.get(hs)?.orth_entry;
      if (entry) orthDetails.push(entry);
    } else {
      const bHex = computeBucketHex('fnv1a64_mod64', 64, hs);
      const orthShard = await readR10Json<{ entries?: Record<string, any> }>(reader, releaseId, `orthographic/shard-${bHex}.json.gz`, budget);
      const entry = orthShard?.entries?.[hs];
      if (entry) orthDetails.push(entry);
    }
  }

  // R12 Pilot Integration: merge offline 2-5 hop beam recommendations, external property bridges,
  // structural clause parallels, and orthographic candidates for matched pilot anchors.
  const r12AnchorsMatched: string[] = [];
  let r12MultihopCount = 0;
  let r12PropertyCount = 0;
  let r12StructuralCount = 0;
  let r12OrthographicCount = 0;
  let r12TailCursor: string | null = null;
  let r12ScoreVersion = 'r12-ranker-v1';
  let r12ExternalSources: Array<{ id: string; provider: string; release: string; license: string }> = [];

  const pilotCandidateKeys = new Set<string>(matchedStrongs);
  if (query.focus_lemma) pilotCandidateKeys.add(query.focus_lemma);
  if (query.anchor?.extended_strongs) pilotCandidateKeys.add(query.anchor.extended_strongs.replace(/([HG])0*(\d+)[A-Z]?/i, (_, p, n) => p + n.padStart(4, '0')));
  if (pilotCandidateKeys.size > 0 && (fastManifest?.r12_pilot_embedded || fastManifest?.r12_pilot)) {
    const isMismatchedPassageHomograph = (prof: LemmaProfile | null | undefined): boolean => {
      if (!isPassageOnlyQuery || !prof) return false;
      const sameStrongsSibs = (prof.homograph_siblings || []).filter(s => s.bs === prof.bs);
      if (sameStrongsSibs.length === 0) return false;
      const chosen = resolveDisplaySense(prof, explicitPassages, explicitToks);
      if (!chosen.gl || chosen.gl === prof.gl) return false;
      return countStemOverlap(extractSenseStems(prof.gl), extractSenseStems(chosen.gl)) === 0;
    };

    const resolvedPilotAnchors: Array<[string, any]> = [];
    if (fastManifest.r12_pilot_embedded) {
      r12ScoreVersion = fastManifest.r12_score_version || 'r12-ranker-v1';
      r12ExternalSources = (fastManifest.r12_external_sources || []).map(s => ({
        id: s.id,
        provider: s.provider,
        release: s.release,
        license: s.license,
      }));
      const pilotSet = new Set(fastManifest.r12_pilot_anchors_list || []);
      const allowedExtraPilotKeys = new Set<string>(profileStrongsToLoad);
      if (query.focus_lemma) allowedExtraPilotKeys.add(query.focus_lemma);
      if (query.anchor?.extended_strongs) {
        allowedExtraPilotKeys.add(query.anchor.extended_strongs.replace(/([HG])0*(\d+)[A-Z]?/i, (_, p, n) => p + n.padStart(4, '0')));
      }
      for (const bs of pilotCandidateKeys) {
        if (!pilotSet.has(bs)) continue;
        let prof = profileByStrongs.get(bs);
        if (!prof) {
          if (!allowedExtraPilotKeys.has(bs) || budget.used >= 14) continue;
          prof = (await readProfile(reader, releaseId, fastManifest, bs, budget)) ?? undefined;
          if (prof) profileByStrongs.set(bs, prof);
        }
        if (isMismatchedPassageHomograph(prof)) continue;
        const anchorData = prof?.r12_pilot_anchor;
        if (anchorData) resolvedPilotAnchors.push([bs, anchorData]);
      }
    } else if (fastManifest.r12_pilot) {
      const r12Pilot = await readR12Pilot(reader, releaseId, fastManifest, budget);
      if (r12Pilot?.anchors) {
        r12ScoreVersion = r12Pilot.score_version || 'r12-ranker-v1';
        r12ExternalSources = (r12Pilot.external_sources || []).map(s => ({
          id: s.id,
          provider: s.provider,
          release: s.release,
          license: s.license,
        }));
        for (const bs of pilotCandidateKeys) {
          const anchorData = r12Pilot.anchors[bs];
          if (!anchorData) continue;
          if (isMismatchedPassageHomograph(profileByStrongs.get(bs))) continue;
          resolvedPilotAnchors.push([bs, anchorData]);
        }
      }
    }
    const demoteR12IfBackground = (rec: R10EvidenceRecord, allowMultiLemma: boolean): R10EvidenceRecord => {
      if (!isPassageOnlyQuery) return rec;
      if (recordWitnessesExplicitPassage(rec.passages)) return rec;
      if (allowMultiLemma) {
        const lemmaStrongs = (rec.original_words || []).map(w => w.strongs).filter((s): s is string => Boolean(s));
        const multiCount = new Set(lemmaStrongs.filter(s => explicitPassageContentStrongsSet.has(s))).size;
        if (multiCount >= 2) return rec;
      }
      return {
        ...rec,
        score_components: {
          ...rec.score_components,
          common_word_penalty: rec.score_components.common_word_penalty + 190,
          final_score: Math.max(10, rec.score_components.final_score - 190),
        },
      };
    };

    for (const [bs, anchorData] of resolvedPilotAnchors) {
      r12AnchorsMatched.push(bs);

      const recs: any[] = anchorData.multihop?.recommendations || [];
      const takeRecs = (query.mode === 'expand' || query.mode === 'bridge' || query.focus_lemma === bs) ? recs.slice(0, 12) : recs.slice(0, 8);
      for (const rec of takeRecs) {
        allCandidates.push(demoteR12IfBackground(r12MultihopRecToRecord(anchorData, rec), true));
        r12MultihopCount++;
      }
      if ((anchorData.multihop?.unreturned_destinations || 0) > 0 && !r12TailCursor) {
        r12TailCursor = String(offset + limit);
      }

      if (!query.lite_subgraph_mode) {
        const props: any[] = anchorData.property_bridges || [];
        for (const b of props.slice(0, 6)) {
          allCandidates.push(demoteR12IfBackground(r12PropertyBridgeToRecord(anchorData, b), false));
          r12PropertyCount++;
        }
      }

      const structs: any[] = anchorData.structural_candidates || [];
      for (const s of structs.slice(0, 3)) {
        allCandidates.push(demoteR12IfBackground(r12StructuralToRecord(anchorData, s), false));
        r12StructuralCount++;
      }

      if (!query.lite_subgraph_mode || query.filters?.include_orthographic) {
        const orths: any[] = [...(anchorData.orthographic_candidates || [])].sort(
          (a, b) => Number((b.cooccurrence_verses || 0) > 0) - Number((a.cooccurrence_verses || 0) > 0) || (b.score || 0) - (a.score || 0)
        );
        for (const o of orths.slice(0, 5)) {
          allCandidates.push(demoteR12IfBackground(r12OrthographicToRecord(anchorData, o), false));
          r12OrthographicCount++;
        }
      }
    }
  }

  // R13 Discovery Integration: Algorithms A (Wordplay & Roots), B (Collocations, Motifs, Beam Search), C (Self-Interpretations & Symbolic Chains)
  // Zero-read Stage 2: resolve passages strictly from in-memory caches (bookCache / loadedProfiles / embedded refs) or buildRefStub.
  const R13_WP_STOP_STRONGS = new Set([
    ...HIGH_FREQ_CONTENT_STOP_STRONGS,
    ...PRONOUN_OR_FUNC_STRONGS,
    ...GENERIC_LIGHT_VERB_STRONGS,
    'H2009', 'H1836', 'H1835', 'H1932', 'H1768', 'H4101', 'H4479',
  ]);
  const knownPassageByVid = new Map<number, R10PassageRef>();
  for (const ep of explicitPassages) {
    if (ep.verse_id > 0) knownPassageByVid.set(ep.verse_id, ep);
  }
  for (const prof of loadedProfiles) {
    for (const fp of prof.first_occ_passages || []) {
      if (fp?.verse_id > 0 && !knownPassageByVid.has(fp.verse_id)) knownPassageByVid.set(fp.verse_id, fp);
    }
    for (const cl of prof.clusters || []) {
      for (const sp of cl.sample_passages || []) {
        if (sp?.verse_id > 0 && !knownPassageByVid.has(sp.verse_id)) {
          knownPassageByVid.set(sp.verse_id, {
            verse_id: sp.verse_id,
            ref: sp.ref,
            ...(sp.mt_ref ? { mt_ref: sp.mt_ref } : {}),
            book: sp.book,
            chapter: sp.chapter,
            verse: sp.verse,
            testament: sp.testament,
            snippet: sp.snippet,
            is_psalm_heading: sp.book === 19 && sp.verse === 0,
          });
        }
      }
    }
  }
  const cachedOrStubPassages = (vids: number[], refs: string[] = [], cap = 3): R10PassageRef[] => {
    const out: R10PassageRef[] = [];
    for (let idx = 0; idx < vids.length && out.length < cap; idx++) {
      const vid = Number(vids[idx] || 0);
      if (!vid || vid <= 0) continue;
      const known = knownPassageByVid.get(vid);
      if (known) {
        out.push(known);
        continue;
      }
      const cached = bookCache.get(bookForVid(vid))?.[String(vid)];
      if (cached) {
        out.push({
          verse_id: vid,
          ref: cached.ref,
          ...(cached.mt_ref ? { mt_ref: cached.mt_ref } : {}),
          book: cached.book,
          chapter: cached.chapter,
          verse: cached.verse,
          testament: cached.book <= 39 ? 'OT' : 'NT',
          snippet: cached.en,
          is_psalm_heading: cached.book === 19 && cached.verse === 0,
        });
        continue;
      }
      out.push(buildRefStub(vid, refs[idx] || `Verse ${vid}`));
    }
    return out;
  };
  const demoteR13IfBackground = (rec: R10EvidenceRecord): R10EvidenceRecord => {
    if (!isPassageOnlyQuery) return rec;
    if (recordWitnessesExplicitPassage(rec.passages)) return rec;
    return {
      ...rec,
      score_components: {
        ...rec.score_components,
        common_word_penalty: rec.score_components.common_word_penalty + 150,
        final_score: Math.max(10, rec.score_components.final_score - 150),
      },
    };
  };
  const matchedR13MotifObjs: any[] = [];
  const matchedSelfInterps: SelfInterpretationRecord[] = [];
  const wordplayForChain: Array<{ source_bs: string; target_bs: string; detail: string; witness_refs: string[]; score: number }> = [];
  const collocNeighborsForChain = new Map<string, Array<{ target_bs: string; shared_count: number; npmi: number; sample_refs: string[] }>>();
  const lxxEquivForChain = new Map<string, string[]>();
  const explicitWordplayQuery =
    /[\u0590-\u05FF\u0370-\u03FF]|\b(wordplay|pun|root|consonant|cognate|etymology)\b/i.test(query.query || '') ||
    Boolean(query.focus_lemma);

  // Algorithm A: r13_wordplay from loaded profiles
  const wpPerProfLimit = explicitWordplayQuery ? 6 : 3;
  const emittedWpIds = new Set<string>();
  for (const prof of loadedProfiles.slice(0, 4)) {
    if (R13_WP_STOP_STRONGS.has(prof.bs)) continue;
    for (const lx of prof.lxx_relations || []) {
      if (lx?.target_strongs && !isLxxFunctionEquivalent(lx.target_strongs, lx.script)) {
        const arr = lxxEquivForChain.get(prof.bs) || [];
        if (!arr.includes(lx.target_strongs)) arr.push(lx.target_strongs);
        lxxEquivForChain.set(prof.bs, arr);
      }
    }
    if (Array.isArray(prof.r13_colloc)) {
      collocNeighborsForChain.set(
        prof.bs,
        prof.r13_colloc.slice(0, 6).map(([tBs, cnt, npmi100, , , , sampleRefs]: any) => ({
          target_bs: tBs,
          shared_count: cnt,
          npmi: npmi100 / 100,
          sample_refs: Array.isArray(sampleRefs) ? sampleRefs : [],
        })),
      );
    }
    const isWeakOrthographicNoiseEdge = (sourceProf: LemmaProfile, edge: any): boolean => {
      const sharedCons = String(edge.shared_consonants || '');
      const isDocumented = edge.overlap_kind === 'documented_biblical_wordplay' || edge.evidence_type === 'documented_biblical_wordplay';
      const isUnverifiedOrthOnly = !edge.proven_common_root && !edge.has_explicit_cue && !isDocumented;
      const nonGutturalMaterCount = [...sharedCons].filter(ch => !'אהויחע'.includes(ch)).length;
      if (isUnverifiedOrthOnly && sharedCons.length <= 2 && nonGutturalMaterCount <= 1) {
        return true;
      }
      if (
        sourceProf.bs.startsWith('G') &&
        !edge.proven_common_root &&
        !isDocumented &&
        ((sharedCons.length <= 3 && Number(edge.edit_distance ?? 9) > 1) ||
          /^(?:αω|εω|οω|αζω|ιζω|ευω|ατεω|ανο|ον|ος|ης|ων|νο|νος|ια|εν|ιν|ρον)$/i.test(sharedCons))
      ) {
        return true;
      }
      if (edge.has_explicit_cue || edge.proven_common_root || Number(edge.proximity_same_verse || 0) >= 1) return false;
      if (sourceProf.bs.startsWith('G') && sharedCons.length <= 3) {
        return true;
      }
      if (sharedCons.length <= 2 && Number(edge.proximity_adjacent_verse || 0) === 0) return true;
      return false;
    };
    let wpAdded = 0;
    for (const rawEdge of prof.r13_wordplay || []) {
      if (!rawEdge?.target_bs || R13_WP_STOP_STRONGS.has(rawEdge.target_bs)) continue;
      const edge = rawEdge.evidence_type === 'attested_textual_wordplay' && !isVerifiedAttestedWordplayEdge(rawEdge, prof)
        ? { ...rawEdge, evidence_type: 'proximate_wordplay_candidate', has_explicit_cue: false }
        : rawEdge;
      if (isWeakOrthographicNoiseEdge(prof, edge)) continue;
      if (queryIntent === 'physical_bridge' && !edge.has_explicit_cue) continue;
      const wpWitnessInPassage = (edge.witness_vids || []).some((v: number) => explicitPassageVidSet.has(Number(v)));
      const wpBothInPassage = isPassageOnlyQuery && matchedStrongs.has(prof.bs) && matchedStrongs.has(edge.target_bs);
      if (isPassageOnlyQuery && !wpWitnessInPassage && !wpBothInPassage) continue;
      if (wpAdded >= wpPerProfLimit) break;
      const wPassages = cachedOrStubPassages(edge.witness_vids || [], edge.witness_refs || [], 2);
      const baseWpRec = buildR13WordplayRecord(prof, edge, wPassages);
      const wpSameVerseHit = Number(edge.proximity_same_verse || 0) > 0 && recordWitnessesExplicitPassage(wPassages);
      const wpDirectHit = (Boolean(edge.has_explicit_cue) || wpSameVerseHit || wpBothInPassage) && (recordWitnessesExplicitPassage(wPassages) || wpBothInPassage);
      const wpExtraPen = isPassageOnlyQuery && !wpDirectHit ? 120 : 0;
      const wpExactPassageBoost = isPassageOnlyQuery && wpDirectHit ? (wpBothInPassage ? 78 : 42) : 0;
      const rec = (wpExtraPen || wpExactPassageBoost)
        ? {
            ...baseWpRec,
            score_components: {
              ...baseWpRec.score_components,
              witness_bonus: baseWpRec.score_components.witness_bonus + wpExactPassageBoost,
              common_word_penalty: baseWpRec.score_components.common_word_penalty + wpExtraPen,
              final_score: Math.max(10, baseWpRec.score_components.final_score + wpExactPassageBoost - wpExtraPen),
            },
          }
        : baseWpRec;
      allCandidates.push(rec);
      emittedWpIds.add(rec.evidence_id);
      emittedWpIds.add(`r13:wp:${edge.target_bs}:${prof.bs}`);
      wpAdded++;
      if (wordplayForChain.length < 6 && (edge.has_explicit_cue || Number(edge.score || 0) >= 0.72)) {
        wordplayForChain.push({
          source_bs: prof.bs,
          target_bs: edge.target_bs,
          detail: `${edge.evidence_type}: ${edge.shared_consonants || ''}`,
          witness_refs: wPassages.map(p => p.ref).filter(r => !/^Verse \d+$/.test(r)),
          score: Number(edge.score || 0.5),
        });
      }
    }
    if ((prof.total_verses || 0) <= 1800 || query.focus_lemma === prof.bs) {
      for (const tuple of (prof.r13_colloc || []).slice(0, 3) as any[]) {
        const [tBs, sharedCount, npmi100, sampleVids, tSc, tGl, sampleRefs] = tuple;
        const cPassages = cachedOrStubPassages(sampleVids || [], Array.isArray(sampleRefs) ? sampleRefs : [], 2);
        const tProfOrFallback =
          profileByStrongs.get(tBs) ||
          (tSc || tGl ? { sc: String(tSc || tBs), tr: '', gl: String(tGl || ''), lang: languageFromStrongs(tBs, prof.lang) } : null);
        allCandidates.push(
          demoteR13IfBackground(
            buildR13CollocRecord(prof, tBs, tProfOrFallback, sharedCount, npmi100, cPassages),
          ),
        );
      }
    }
  }

  // Passage-scoped wordplay scan across ALL loadedProfiles (so in-passage pairs like Genesis 4:10-11 H1818 דָּם ↔ H0127 אֲדָמָה are never dropped by slice(0, 4) or wpPerProfLimit)
  if (explicitPassageVidSet.size > 0 && queryIntent !== 'physical_bridge') {
    for (const prof of loadedProfiles) {
      if (R13_WP_STOP_STRONGS.has(prof.bs)) continue;
      for (const edge of prof.r13_wordplay || []) {
        if (!edge?.target_bs || R13_WP_STOP_STRONGS.has(edge.target_bs)) continue;
        const sharedCons = String(edge.shared_consonants || '');
        const isDocumented = edge.overlap_kind === 'documented_biblical_wordplay' || edge.evidence_type === 'documented_biblical_wordplay';
        if (
          prof.bs.startsWith('G') &&
          !edge.proven_common_root &&
          !isDocumented &&
          ((sharedCons.length <= 3 && Number(edge.edit_distance ?? 9) > 1) ||
            /^(?:αω|εω|οω|αζω|ιζω|ευω|ατεω|ανο|ον|ος|ης|ων|νο|νος|ια|εν|ιν|ρον)$/i.test(sharedCons))
        ) {
          continue;
        }
        if (!edge.has_explicit_cue && !edge.proven_common_root && Number(edge.proximity_same_verse || 0) === 0) {
          if ((prof.bs.startsWith('G') && (sharedCons.length <= 3 || /^(?:αω|εω|οω|αζω|ιζω|ευω|ατεω|ανο|ον|ος|ης|ια)$/i.test(sharedCons))) ||
              (sharedCons.length <= 2 && Number(edge.proximity_adjacent_verse || 0) === 0)) continue;
        }
        const evId = `r13:wp:${prof.bs}:${edge.target_bs}`;
        if (emittedWpIds.has(evId)) continue;
        const witnessesExplicit = (edge.witness_vids || []).some((v: number) => explicitPassageVidSet.has(Number(v)));
        const bothInPassage = matchedStrongs.has(prof.bs) && matchedStrongs.has(edge.target_bs);
        if (!witnessesExplicit && !bothInPassage) continue;
        const wPassages = cachedOrStubPassages(
          witnessesExplicit
            ? (edge.witness_vids || []).filter((v: number) => explicitPassageVidSet.has(Number(v))).concat(edge.witness_vids || [])
            : (edge.witness_vids || []),
          edge.witness_refs || [],
          2,
        );
        const baseWpRec = buildR13WordplayRecord(prof, edge, wPassages);
        const wpBoost = bothInPassage ? 85 : 52;
        const rec = {
          ...baseWpRec,
          score_components: {
            ...baseWpRec.score_components,
            witness_bonus: baseWpRec.score_components.witness_bonus + wpBoost,
            final_score: baseWpRec.score_components.final_score + wpBoost,
          },
        };
        allCandidates.push(rec);
        emittedWpIds.add(evId);
        emittedWpIds.add(`r13:wp:${edge.target_bs}:${prof.bs}`);
      }
    }
  }

  // Algorithm C: Clause-local Biblical Self-Interpretations (strictly scoped via O(1) index)
  const selfInterpsAll = explicitData.r13_self_interpretations || [];
  if (selfInterpsAll.length > 0 && queryIntent !== 'physical_bridge') {
    let siIndex = SELF_INTERP_INDEX_CACHE.get(selfInterpsAll);
    if (!siIndex) {
      const byStrongs = new Map<string, any[]>();
      const byVid = new Map<number, any[]>();
      for (const si of selfInterpsAll) {
        for (const s of si.symbol_strongs || []) {
          let arr = byStrongs.get(s);
          if (!arr) { arr = []; byStrongs.set(s, arr); }
          arr.push(si);
        }
        for (const s of si.referent_strongs || []) {
          let arr = byStrongs.get(s);
          if (!arr) { arr = []; byStrongs.set(s, arr); }
          arr.push(si);
        }
        const vids = si.witness_vids?.length ? si.witness_vids : [si.verse_id];
        for (const v of vids) {
          const vn = Number(v);
          if (!vn) continue;
          let arr = byVid.get(vn);
          if (!arr) { arr = []; byVid.set(vn, arr); }
          arr.push(si);
        }
      }
      siIndex = { byStrongs, byVid };
      SELF_INTERP_INDEX_CACHE.set(selfInterpsAll, siIndex);
    }
    const candSelfInterps = new Set<any>();
    for (const vid of explicitPassageVidSet) {
      for (const si of siIndex.byVid.get(vid) || []) candSelfInterps.add(si);
    }
    if (!isPassageOnlyQuery) {
      for (const s of matchedStrongs) {
        for (const si of siIndex.byStrongs.get(s) || []) candSelfInterps.add(si);
      }
    }
    for (const si of candSelfInterps) {
      // Guard against stale temporal-noun false birthname records (e.g. Judges 15:19 "the day" H3117)
      if (si.cue_kind === 'hebrew_birth_attribute_naming' && (si.symbol_strongs || []).some((s: string) => s === 'H3117' || s === 'H8141' || s === 'H6256' || s === 'H5769')) {
        continue;
      }
      const exactVerseHit =
        explicitPassageVidSet.has(si.verse_id) ||
        (si.witness_vids || []).some((v: number) => explicitPassageVidSet.has(Number(v)));
      if (isPassageOnlyQuery && !exactVerseHit) continue;
      const symMatches = si.symbol_strongs.filter((s: string) => matchedStrongs.has(s));
      const allMatchedHits = [...new Set([...symMatches, ...si.referent_strongs.filter((s: string) => matchedStrongs.has(s))])];
      const hasRareSymbolMatch = symMatches.some((s: string) => {
        const p = profileByStrongs.get(s);
        return p ? p.total_verses <= 100 : false;
      });
      if (!exactVerseHit && allMatchedHits.length < 2 && !hasRareSymbolMatch) continue;
      matchedSelfInterps.push(si);
      if (matchedSelfInterps.length <= (exactVerseHit ? 4 : 2)) {
        const siPassages = cachedOrStubPassages(si.witness_vids?.length ? si.witness_vids : [si.verse_id], [si.ref], 2);
        let rec = buildR13SelfInterpRecord(si, siPassages, profileByStrongs);
        if (!exactVerseHit && !isPassageOnlyQuery) {
          rec = {
            ...rec,
            evidence_tier: 2,
            score_components: {
              ...rec.score_components,
              base_tier_score: TIER_BASE_SCORE[2],
              specificity_bonus: 45,
              witness_bonus: 15,
              final_score: TIER_BASE_SCORE[2] + 60,
            },
          };
        }
        allCandidates.push(rec);
      }
    }
  }

  // Algorithm B: Multi-Passage Motifs (only load motifs-and-patterns when profiles or passages link to mined motifs)
  const profileMotifIds = new Set<string>();
  for (const p of loadedProfiles) {
    for (const mid of p.r13_motif_ids || []) profileMotifIds.add(mid);
  }
  const hasAnyMotifHint = profileMotifIds.size > 0 || (motifsData?.r13_motifs_b64gz !== undefined);
  if (hasAnyMotifHint && budget.used < budget.max - 8) {
    const md = await ensureMotifsData();
    if (md?.r13_motifs_b64gz) {
      const candMotifIds = new Set<string>(profileMotifIds);
      for (const s of matchedStrongs) {
        for (const mid of md.r13_motifs_by_bs?.[s] || []) candMotifIds.add(mid);
      }
      for (const vid of explicitPassageVidSet) {
        for (const mid of md.r13_motifs_by_vid?.[String(vid)] || []) candMotifIds.add(mid);
      }
      if (candMotifIds.size > 0) {
        const decodedMotifs = await decodeB64Gz<Record<string, any>>(reader, md.r13_motifs_b64gz, `/r13/motifs:${releaseId}`, budget.b64Cache);
        const motifList = [...candMotifIds]
          .map(id => decodedMotifs?.[id] || (Array.isArray(decodedMotifs) ? decodedMotifs.find((x: any) => x.motif_id === id) : null))
          .filter(Boolean)
          .sort((a: any, b: any) =>
            Number(b.cross_testament) - Number(a.cross_testament) ||
            Number(b.independent_chapters || 0) - Number(a.independent_chapters || 0) ||
            Number(b.distinctiveness || 0) - Number(a.distinctiveness || 0)
          );
        for (const m of motifList.slice(0, 3)) {
          matchedR13MotifObjs.push(m);
          matchedMotifs.add(m.motif_id);
          const mPassages = cachedOrStubPassages((m.witness_vids || []).slice(0, 3), Array.isArray(m.witness_refs) ? m.witness_refs : [], 3);
          allCandidates.push(demoteR13IfBackground(buildR13MotifRecord(m, mPassages, profileByStrongs)));
        }
      }
    }
  }

  // Algorithm C Symbolic Chains (only when explicit self-interpretation + strong wordplay converge)
  if (matchedSelfInterps.length > 0 && wordplayForChain.length > 0 && loadedProfiles[0]) {
    const symChains = assembleSymbolicChains({
      seedStrongOrVid: loadedProfiles[0].bs,
      wordplayTargets: wordplayForChain,
      collocNeighborsByBs: collocNeighborsForChain,
      lxxEquivalentsByBs: lxxEquivForChain,
      selfInterpretations: matchedSelfInterps,
    });
    for (const ch of symChains.slice(0, 1)) {
      const firstVids = ch.links
        .map(l => Number(l.evidence_id.split(':')[2] || 0))
        .filter(v => v > 0 && v <= 32000);
      const scPassages = cachedOrStubPassages(firstVids, ch.covered_refs || [], 3);
      if (isPassageOnlyQuery && !recordWitnessesExplicitPassage(scPassages)) continue;
      allCandidates.push(demoteR13IfBackground(buildR13SymChainRecord(ch, scPassages, profileByStrongs)));
    }
  }

  // Algorithm B Runtime Bounded Beam Search (across loaded profiles, zero extra subrequests)
  if (loadedProfiles.length >= 2 && (query.mode === 'bridge' || queryIntent === 'multi_concept' || queryIntent === 'open_discovery')) {
    const runtimeProfMap = new Map<string, RuntimeBeamProfile>();
    for (const p of loadedProfiles.slice(0, 8)) runtimeProfMap.set(p.bs, p);
    const startProf = loadedProfiles[0];
    const targetBsSet = new Set(loadedProfiles.slice(1).map(p => p.bs));
    const beamPaths = beamSearchMotifPaths({
      startBs: startProf.bs,
      targetBs: targetBsSet,
      profilesByBs: runtimeProfMap,
      maxHops: Math.min(3, Math.max(2, Number(query.max_hops ?? 3))),
      beamWidth: 10,
    });
    for (const bp of beamPaths.slice(0, 2)) {
      if (!bp.reached_target && bp.edges.length < 3) continue;
      const bpPassages = cachedOrStubPassages((bp.witness_vids || []).slice(0, 3), [], 2);
      allCandidates.push(demoteR13IfBackground(buildR13BeamRecord(bp, bpPassages, profileByStrongs)));
    }
  }

  // Filter, Validate, Score, and Rank candidates
  const filters = query.filters || {};
  const toksByVidCache = new Map<number, any[]>();
  for (const bVerses of bookCache.values()) {
    if (!bVerses || typeof bVerses !== 'object') continue;
    for (const [k, vObj] of Object.entries(bVerses)) {
      if (Array.isArray((vObj as any)?.toks)) toksByVidCache.set(Number(k), (vObj as any).toks);
    }
  }
  const anchorCaveat = query.anchor_lemma_key
    ? `Anchored on ${query.anchor_lemma_key}; formal consonantal/motif links spanning distinct lexical homographs are kept explicit rather than merged.`
    : undefined;

  let filtered = allCandidates.filter(c => {
    if (filters.predicates?.length && !filters.predicates.includes(c.predicate)) return false;
    if (filters.max_tier && c.evidence_tier > filters.max_tier) return false;
    if (filters.include_orthographic === false && (c.predicate === 'orthographic_overlap' || c.predicate === 'orthographic_wordplay')) return false;
    if (filters.include_candidate_patterns === false && (c.predicate === 'literary_pattern' || c.predicate === 'structural_scene_parallel')) return false;
    if (filters.include_interpretive === false && c.predicate === 'interpretive_hypothesis') return false;
    if (filters.testaments?.length && !c.passages.some(p => filters.testaments!.includes(p.testament))) return false;
    return true;
  });

  filtered = validateEvidenceR13(filtered, {
    filters,
    asksResurrection,
    asksDayNumber,
    toksByVid: toksByVidCache,
    explicitWordsNote: anchorCaveat,
  });

  // Apply bridge-mode weighting before sorting
  if (query.mode === 'bridge') {
    filtered = filtered.map((rec) => {
      const id = rec.evidence_id || '';
      const isCrossTest = rec.passages.some(p => p.testament === 'OT') && rec.passages.some(p => p.testament === 'NT');
      let boost = 0;
      if (id.startsWith('r11:lxx:')) {
        const targetBs = rec.target_node_id.replace(/^lemma:/, '');
        const isQueryInternal = Boolean(targetBs && matchedStrongs.has(targetBs));
        if (rec.passages.length > 0 && !isQueryInternal) boost = 50;
      } else if (id.startsWith('r12:prop:')) {
        boost = 150;
      } else if ((id.startsWith('r12:path:') || id.startsWith('r13:motif:') || id.startsWith('r13:beam:')) && isCrossTest) {
        boost = 45;
      }
      if (!boost) return rec;
      return {
        ...rec,
        score_components: {
          ...rec.score_components,
          specificity_bonus: rec.score_components.specificity_bonus + boost,
          final_score: rec.score_components.final_score + boost,
        },
      };
    });
  }

  const recordCoversGroup = (record: R10EvidenceRecord, g: typeof conceptGroups[number]): boolean =>
    record.passages.some(p => g.vids.has(p.verse_id)) ||
    (record.original_words || []).some(w => Boolean(w.strongs && g.strongsSet.has(w.strongs)));

  const sharedWitnesses = (record: R10EvidenceRecord) => conceptGroups.length >= 2
    ? record.passages.filter(p => conceptGroups.every(g => g.vids.has(p.verse_id))) : [];
  const supportCache = new WeakMap<R10EvidenceRecord, 'all_concepts' | 'meaningful_subset' | 'background'>();
  const supportClass = (record: R10EvidenceRecord): 'all_concepts' | 'meaningful_subset' | 'background' => {
    if (conceptGroups.length < 2) return 'background';
    const hit = supportCache.get(record);
    if (hit !== undefined) return hit;
    let res: 'all_concepts' | 'meaningful_subset' | 'background' = 'meaningful_subset';
    if (record.predicate === 'orthographic_overlap' || record.predicate === 'interpretive_hypothesis') {
      res = 'background';
    } else if (sharedWitnesses(record).length && missingConcepts.length === 0) {
      res = 'all_concepts';
    } else {
      const isPericope = record.provenance.derivation_method === 'pericope_window_intersection';
      const coveredByVerse = record.passages.some(p => conceptGroups.filter(g => g.vids.has(p.verse_id)).length >= 2);
      const coveredByPericope = isPericope && conceptGroups.filter(g => record.passages.some(p => g.vids.has(p.verse_id))).length >= 2;
      const isExplicitMultiConceptRecord =
        record.evidence_id.startsWith('r10:') &&
        conceptGroups.length >= 4 &&
        conceptGroups.filter(g => recordCoversGroup(record, g)).length >= 3;
      if (!coveredByVerse && !coveredByPericope && !isExplicitMultiConceptRecord) res = 'background';
      else if (governingGroups.length > 0 && !isExplicitMultiConceptRecord && !governingGroups.some(g => recordCoversGroup(record, g))) {
        res = 'background';
      }
    }
    supportCache.set(record, res);
    return res;
  };
  if (!query.lite_subgraph_mode) {
    filtered = scoreCandidatesR13(filtered, { supportClass, queryIntent });

    // Multichannel Reciprocal Rank Fusion (RRF) synergy bonus across independent discovery channels
    const classifyDiscoveryChannel = (rec: R10EvidenceRecord): DiscoveryChannelName => {
      const id = rec.evidence_id || '';
      if (id.startsWith('r13:wp:') || id.startsWith('r11:orth:') || rec.predicate === 'orthographic_wordplay' || rec.predicate === 'orthographic_overlap') {
        return 'wordplay_consonantal';
      }
      if (id.startsWith('r13:si:') || id.startsWith('r10:ident:') || id.startsWith('r13:symchain:') || rec.predicate === 'explicit_identification') {
        return 'symbolic_self_interpretation';
      }
      if (id.startsWith('r11:lxx:')) return 'lxx_greek_bridge';
      if (id.startsWith('r11:lex:') || rec.evidence_type === 'documented_root_family') return 'root_morphology';
      if (id.startsWith('r13:colloc:') || id.startsWith('r11:colloc:')) return 'collocation_pmi';
      if (id.startsWith('r11:scene:') || id.startsWith('r11:gram:') || rec.predicate === 'structural_scene_parallel') {
        return 'structural_clause_frame';
      }
      if (id.startsWith('r13:motif:') || id.startsWith('r10:motif:') || rec.predicate === 'shared_motif') {
        return 'motif_cluster';
      }
      if (id.startsWith('r11:xref:')) return 'cross_reference';
      if (id.startsWith('r12:prop:')) return 'genealogy_proper_noun';
      return 'exact_lemma_rarity';
    };
    const deriveMultichannelTargetKey = (rec: R10EvidenceRecord): string => {
      if (rec.source_node_id.startsWith('lemma:') && rec.target_node_id.startsWith('lemma:') && rec.source_node_id !== rec.target_node_id) {
        return rec.source_node_id < rec.target_node_id
          ? `${rec.source_node_id}<->${rec.target_node_id}`
          : `${rec.target_node_id}<->${rec.source_node_id}`;
      }
      const pRefs = rec.passages || [];
      let r0 = '';
      let r1 = '';
      for (let i = 0; i < pRefs.length; i++) {
        const rf = pRefs[i].ref;
        if (rf) {
          if (!r0) r0 = rf;
          else { r1 = rf; break; }
        }
      }
      if (r1) return r0 < r1 ? `passages:${r0}<->${r1}` : `passages:${r1}<->${r0}`;
      if (rec.target_node_id) return rec.target_node_id;
      return rec.evidence_id;
    };
    const channelBuckets = new Map<DiscoveryChannelName, Array<{ rec: R10EvidenceRecord; targetKey: string }>>();
    const targetKeysByIdx: string[] = new Array(filtered.length);
    for (let i = 0; i < filtered.length; i++) {
      const rec = filtered[i];
      const ch = classifyDiscoveryChannel(rec);
      const targetKey = deriveMultichannelTargetKey(rec);
      targetKeysByIdx[i] = targetKey;
      let arr = channelBuckets.get(ch);
      if (!arr) { arr = []; channelBuckets.set(ch, arr); }
      arr.push({ rec, targetKey });
    }
    const rrfEntries: MultichannelCandidateEntry[] = [];
    for (const [ch, list] of channelBuckets) {
      list.sort((a, b) => b.rec.score_components.final_score - a.rec.score_components.final_score);
      for (let idx = 0; idx < list.length; idx++) {
        rrfEntries.push({
          target_key: list[idx].targetKey,
          channel: ch,
          rank: idx + 1,
          raw_score: list[idx].rec.score_components.final_score,
          connection_id: list[idx].rec.evidence_id,
        });
      }
    }
    const rrfFused = fuseMultichannelCandidatesRrf(rrfEntries, 60);
    filtered = filtered.map((rec, i) => {
      if (rec.predicate === 'orthographic_overlap' || rec.evidence_tier >= 5) return rec;
      const fused = rrfFused.get(targetKeysByIdx[i]);
      if (!fused || fused.channel_count < 2 || fused.synergy_bonus <= 0) return rec;
      return {
        ...rec,
        score_components: {
          ...rec.score_components,
          witness_bonus: rec.score_components.witness_bonus + fused.synergy_bonus,
          final_score: rec.score_components.final_score + fused.synergy_bonus,
        },
      };
    });
  }

  const supportRank = { all_concepts: 2, meaningful_subset: 1, background: 0 };
  filtered.sort((a, b) => supportRank[supportClass(b)] - supportRank[supportClass(a)] ||
    b.score_components.final_score - a.score_components.final_score || a.evidence_tier - b.evidence_tier);

  const uniqueMap = new Map<string, R10EvidenceRecord>();
  const seenLemmaPairKeys = new Set<string>();
  const seenXrefPairs = new Map<string, string>();
  const consolidatedTargetKeys = new Map<string, { primaryId: string; channels: Set<string> }>();
  const convergenceTargetKeyFor = (item: R10EvidenceRecord): string | null => {
    const id = item.evidence_id;
    if (id.startsWith('r11:cluster:') || id.startsWith('r13:motif:') || id.startsWith('r12:event:') || id.startsWith('r12:prop:')) {
      return null;
    }
    if (item.source_node_id.startsWith('lemma:') && item.target_node_id.startsWith('lemma:') && item.source_node_id !== item.target_node_id) {
      const a = item.source_node_id;
      const b = item.target_node_id;
      return `pair:${a <= b ? `${a}<->${b}` : `${b}<->${a}`}`;
    }
    if (item.passages.length <= 2) {
      const nonAnchor = item.passages.find(p => p.verse_id > 0 && !explicitPassageVidSet.has(p.verse_id));
      const tv = nonAnchor?.verse_id || (item.passages[0]?.verse_id || 0);
      if (tv > 0 && (item.target_node_id.startsWith('passage:') || isPassageOnlyQuery)) {
        return `target_vid:${tv}`;
      }
    }
    return null;
  };
  for (const item of filtered) {
    if (uniqueMap.has(item.evidence_id)) continue;
    if (item.evidence_id.startsWith('r11:xref:')) {
      const m = /^r11:xref:(\d+):(\d+)/.exec(item.evidence_id);
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        const pairKey = a <= b ? `${a}:${b}` : `${b}:${a}`;
        const existingId = seenXrefPairs.get(pairKey);
        if (existingId) {
          const prev = uniqueMap.get(existingId);
          if (prev && !prev.title.includes('↔')) {
            prev.title = prev.title.replace(' -> ', ' ↔ ') + ' (reciprocal)';
          }
          continue;
        }
        seenXrefPairs.set(pairKey, item.evidence_id);
      }
    }
    if (
      (item.evidence_id.startsWith('r11:lxx:') || item.evidence_id.startsWith('r11:lex:') || item.evidence_id.startsWith('r11:colloc:') || item.evidence_id.startsWith('r13:colloc:')) &&
      item.source_node_id.startsWith('lemma:') &&
      item.target_node_id.startsWith('lemma:')
    ) {
      const famTag = item.evidence_id.startsWith('r11:lxx:') ? 'lxx' : (item.evidence_id.startsWith('r11:lex:') ? 'lex' : 'colloc');
      const pairKey = `${famTag}:${item.source_node_id}->${item.target_node_id}`;
      if (seenLemmaPairKeys.has(pairKey)) continue;
      seenLemmaPairKeys.add(pairKey);
    }
    const cKey = query.lite_subgraph_mode ? null : convergenceTargetKeyFor(item);
    const channelTag = cKey ? (item.evidence_type || inferEvidenceType(item)) : '';
    if (cKey && consolidatedTargetKeys.has(cKey)) {
      const cons = consolidatedTargetKeys.get(cKey)!;
      const primary = uniqueMap.get(cons.primaryId);
      if (primary) {
        const addedChannel = !cons.channels.has(channelTag);
        cons.channels.add(channelTag);
        for (const p of item.passages) {
          if (primary.passages.length < 4 && !primary.passages.some(x => x.verse_id === p.verse_id && x.ref === p.ref)) {
            primary.passages.push(p);
          }
        }
        for (const ow of item.original_words || []) {
          if ((primary.original_words || []).length < 4 && !(primary.original_words || []).some(w => w.strongs === ow.strongs)) {
            primary.original_words.push(ow);
          }
        }
        for (const mt of item.matched_terms || []) {
          if ((primary.matched_terms || []).length < 8 && !(primary.matched_terms || []).includes(mt)) {
            primary.matched_terms.push(mt);
          }
        }
        if (addedChannel) {
          const extraChannels = Math.min(2, cons.channels.size - 1);
          const convBonus = 14;
          primary.score_components = {
            ...primary.score_components,
            witness_bonus: (primary.score_components.witness_bonus || 0) + convBonus,
            final_score: Math.min(995, primary.score_components.final_score + convBonus),
          };
          if (primary.r12_metadata) {
            primary.r12_metadata = {
              ...primary.r12_metadata,
              independent_group_count: Math.max(
                primary.r12_metadata.independent_group_count || 1,
                1 + extraChannels,
              ),
            };
          }
          if (!primary.summary.includes('Convergent evidence:')) {
            primary.summary = `${primary.summary} Convergent evidence: ${[...cons.channels].join(' + ')}.`;
          } else {
            primary.summary = primary.summary.replace(/Convergent evidence: [^.]+\./, `Convergent evidence: ${[...cons.channels].join(' + ')}.`);
          }
        }
        continue;
      }
    }
    if (cKey) {
      consolidatedTargetKeys.set(cKey, { primaryId: item.evidence_id, channels: new Set([channelTag]) });
    }
    uniqueMap.set(item.evidence_id, item);
  }
  const dedupedList = [...uniqueMap.values()];
  const familyCounts = new Map<string, number>();
  const rankedAll = dedupedList.map((item) => {
    const eid = item.evidence_id;
    const c1 = eid.indexOf(':');
    const c2 = c1 >= 0 ? eid.indexOf(':', c1 + 1) : -1;
    const baseFamily = c2 >= 0 ? eid.slice(0, c2) : eid;
    let familyKey = baseFamily;
    if (queryIntent === 'passage_intertext' && baseFamily === 'r11:xref') {
      familyKey = e2SeedXrefIds.has(item.evidence_id)
        ? 'r11:xref:seed'
        : (pericopeXrefIds.has(item.evidence_id) ? 'r11:xref:pericope' : 'r11:xref:cluster');
    } else if (queryIntent === 'physical_bridge' && baseFamily === 'r12:path' && r12AnchorsMatched.length > 1) {
      const anchorBs = item.evidence_id.split(':')[2] || '';
      familyKey = anchorBs ? `r12:path:${anchorBs}` : baseFamily;
    } else if (queryIntent === 'physical_bridge' && baseFamily === 'r11:cluster' && loadedProfiles.length > 1) {
      const anchorBs = item.evidence_id.split(':')[2] || '';
      familyKey = anchorBs ? `r11:cluster:${anchorBs}` : baseFamily;
    } else if (queryIntent !== 'passage_intertext' && queryIntent !== 'physical_bridge' && baseFamily === 'r12:path') {
      const [, , anchorBs = '', targetBs = ''] = item.evidence_id.split(':');
      familyKey = (anchorBs && targetBs && anchorBs[0] !== targetBs[0]) ? 'r12:path:xlang' : 'r12:path:same';
    }
    const seen = (familyCounts.get(familyKey) || 0) + 1;
    familyCounts.set(familyKey, seen);
    let grace = 2;
    let stepPen = 55;
    if (queryIntent === 'passage_intertext') {
      if (familyKey === 'r11:xref:seed') {
        grace = 4;
        stepPen = 25;
      } else if (baseFamily === 'r12:scene' || baseFamily === 'r12:entity') {
        grace = 2;
        stepPen = 45;
      } else if (baseFamily === 'r12:prog') {
        grace = 1;
        stepPen = 45;
      } else if (baseFamily === 'r11:gram' || baseFamily === 'r11:lxx' || baseFamily === 'r12:path') {
        grace = 1;
        stepPen = 60;
      } else if (baseFamily === 'r12:event') {
        grace = 1;
        stepPen = 55;
      }
    } else if (queryIntent === 'physical_bridge') {
      if (baseFamily === 'r12:prop') {
        grace = 4;
        stepPen = 35;
      } else if (baseFamily === 'r11:lxx' || baseFamily === 'r12:event') {
        grace = 1;
        stepPen = 55;
      } else if (baseFamily === 'r12:path') {
        grace = r12AnchorsMatched.length > 1 ? 2 : 2;
        stepPen = r12AnchorsMatched.length > 1 ? 55 : 65;
      } else if (baseFamily === 'r11:cluster' && loadedProfiles.length > 1) {
        grace = 1;
        stepPen = 55;
      }
    } else if (queryIntent === 'lexical') {
      if (baseFamily === 'r11:lex') {
        grace = 3;
        stepPen = 40;
      } else if (baseFamily === 'r11:lxx') {
        grace = 2;
        stepPen = 45;
      } else if (baseFamily === 'r11:gram') {
        grace = 2;
        stepPen = 55;
      } else if (baseFamily === 'r11:cluster') {
        grace = 1;
        stepPen = 55;
      } else if (familyKey === 'r12:path:same') {
        grace = 4;
        stepPen = 18;
      } else if (familyKey === 'r12:path:xlang') {
        grace = 1;
        stepPen = 30;
      } else if (baseFamily === 'r12:event') {
        grace = 1;
        stepPen = 55;
      }
    } else {
      if (baseFamily === 'r11:lex') {
        grace = 2;
        stepPen = 45;
      } else if (baseFamily === 'r11:lxx') {
        grace = 2;
        stepPen = 45;
      } else if (baseFamily === 'r11:gram' || baseFamily === 'r11:cluster' || baseFamily === 'r12:event') {
        grace = 1;
        stepPen = 55;
      } else if (familyKey === 'r12:path:same') {
        grace = 4;
        stepPen = 18;
      } else if (familyKey === 'r12:path:xlang') {
        grace = 1;
        stepPen = 30;
      }
    }
    if (seen <= grace) return item;
    const pen = (seen - grace) * stepPen;
    return {
      ...item,
      score_components: {
        ...item.score_components,
        final_score: Math.max(10, item.score_components.final_score - pen),
      },
    };
  });
  rankedAll.sort((a, b) => supportRank[supportClass(b)] - supportRank[supportClass(a)] ||
    b.score_components.final_score - a.score_components.final_score || a.evidence_tier - b.evidence_tier);

  // V3 BMW/PPR/E_perp enrichment stays opt-in so default worker discovery stays comfortably within Cloudflare Free 10 ms CPU.
  if (query.include_v3_verification && !query.skip_v3_verification) {
    await runV3DiscoveryAndVerification({
      reader,
      query,
      queryIntent,
      explicitPassages,
      explicitPassageMeta,
      matchedStrongs,
      passageContentStrongs,
      conceptGroups,
      rankedAll,
      uniqueMap,
      bridges,
      profileByStrongs,
    });
  }

  if (!query.lite_subgraph_mode) {
    rankedAll.sort((a, b) => supportRank[supportClass(b)] - supportRank[supportClass(a)] ||
      b.score_components.final_score - a.score_components.final_score || a.evidence_tier - b.evidence_tier);
    const diversifiedAll = diversifyResultsR13(rankedAll, { supportClass, queryIntent, limit });
    rankedAll.length = 0;
    rankedAll.push(...diversifiedAll);
  } else {
    rankedAll.sort((a, b) => supportRank[supportClass(b)] - supportRank[supportClass(a)] ||
      b.score_components.final_score - a.score_components.final_score || a.evidence_tier - b.evidence_tier);
  }

  // G. Complete Occurrence Pagination
  const focusProf = (query.focus_lemma ? profileByStrongs.get(query.focus_lemma) : null) ||
    loadedProfiles[0] || null;

  let targetVids: number[] = [];
  if (focusProf) {
    if (query.cluster_id) {
      const cl = focusProf.clusters?.find(c => c.cluster_id === query.cluster_id);
      targetVids = cl ? cl.vids : focusProf.all_vids;
    } else {
      targetVids = focusProf.all_vids;
    }
  }

  const occLimit = limit;
  const occOffset = offset;
  const pagedOccVids = targetVids.slice(occOffset, occOffset + occLimit);
  let hasMoreOcc = occOffset + occLimit < targetVids.length;

  let hydratedOccPassages: R10PassageRef[] = [];
  if (!query.lite_subgraph_mode) {
    if (
      !query.cluster_id &&
      occOffset === 0 &&
      focusProf?.first_occ_passages?.length &&
      pagedOccVids.length > 0 &&
      (occLimit <= focusProf.first_occ_passages.length || pagedOccVids.length <= focusProf.first_occ_passages.length)
    ) {
      hydratedOccPassages = focusProf.first_occ_passages.slice(0, pagedOccVids.length);
    } else {
      for (const vid of pagedOccVids) {
        const p = await hydratePassageByVid(vid);
        if (!p) break;
        hydratedOccPassages.push(p);
      }
    }
  }
  hasMoreOcc = occOffset + hydratedOccPassages.length < targetVids.length;

  // When expanding or paging through occurrences, synthesize individual occurrence evidence cards
  if (!query.lite_subgraph_mode && (query.mode === 'expand' || query.focus_lemma || query.cluster_id || offset >= rankedAll.length) && focusProf) {
    for (const p of hydratedOccPassages) {
      const occEvId = `r11:occ:${focusProf.bs}:${p.verse_id}`;
      if (!uniqueMap.has(occEvId)) {
        const occSense = resolveDisplaySense(focusProf, [p], explicitToks);
        const rec: R10EvidenceRecord = {
          evidence_id: occEvId,
          predicate: 'verified_lexical_grammatical',
          evidence_tier: 3,
          epistemic_class: 'direct_textual_evidence',
          title: `Attested occurrence: ${occSense.sc} (${occSense.tr}) in ${p.ref}`,
          summary: `Attested biblical occurrence of ${occSense.sc} (${focusProf.bs}, "${occSense.gl}") in ${p.ref}: "${p.snippet || ''}".`,
          source_node_id: `lemma:${focusProf.bs}`,
          target_node_id: `passage:${p.ref}`,
          passages: [p],
          original_words: [{
            strongs: focusProf.bs,
            lemma_key: occSense.lk,
            language: focusProf.lang,
            lemma_script: occSense.sc,
            transliteration: occSense.tr,
            gloss: occSense.gl,
          }],
          matched_terms: [occSense.gl, occSense.sc, focusProf.bs],
          limitations: ['Individual verse occurrence; context defines specific grammatical role and semantic nuance.'],
          provenance: {
            source_dataset: 'MACULA + STEPBible',
            source_record_ids: [p.ref],
            license: 'CC BY 4.0',
            derivation_method: 'canonical_verse_attestation',
          },
          score_components: {
            base_tier_score: 760,
            specificity_bonus: 60,
            witness_bonus: 10,
            common_word_penalty: 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: 830,
          },
        };
        rankedAll.push(rec);
        uniqueMap.set(occEvId, rec);
      }
    }
  }

  const pagedRecords = rankedAll.slice(offset, offset + limit);

  // Lazy post-ranking snippet & stub-ref hydration for top displayed connections within budget
  let postSnippetReads = 0;
  if (!query.lite_subgraph_mode) {
    for (const rec of pagedRecords.slice(0, 8)) {
      for (let pi = 0; pi < rec.passages.length; pi++) {
        const p = rec.passages[pi];
        const isStubRef = Boolean(p && /^Verse \d+$/.test(p.ref));
        if (!p || (!isStubRef && p.snippet) || !p.verse_id || p.verse_id <= 0) continue;
        if (bookCache.get(p.book)?.[String(p.verse_id)] || (postSnippetReads < 4 && budget.used < budget.max - 6)) {
          const usedBefore = budget.used;
          const hp = await hydratePassageByVid(p.verse_id, false);
          if (budget.used > usedBefore) postSnippetReads++;
          if (hp?.snippet || hp?.ref) {
            rec.passages[pi] = applyRangeRef({
              ...p,
              ...(isStubRef ? { ref: hp.ref, book: hp.book, chapter: hp.chapter, verse: hp.verse, testament: hp.testament } : {}),
              ...(hp.snippet ? { snippet: hp.snippet } : {}),
              ...(hp.mt_ref ? { mt_ref: hp.mt_ref } : {}),
            }, isStubRef ? hp.ref : p.ref);
          }
        }
      }
    }
  }

  // H. Summaries with Research-Grade Rationale
  const summaries: R10ConnectionSummary[] = pagedRecords.map(r => {
    const penalties: string[] = [];
    if (r.score_components.common_word_penalty > 0) penalties.push(`common_word_penalty(-${r.score_components.common_word_penalty})`);
    if (r.score_components.number_coincidence_penalty > 0) penalties.push(`number_coincidence_penalty(-${r.score_components.number_coincidence_penalty})`);
    if (r.score_components.orthographic_penalty > 0) penalties.push(`orthographic_penalty(-${r.score_components.orthographic_penalty})`);

    const whyRationale = `Tier ${r.evidence_tier} (${r.epistemic_class.replace(/_/g, ' ')}). Base score ${r.score_components.base_tier_score} with specificity bonus +${r.score_components.specificity_bonus} and witness corroboration +${r.score_components.witness_bonus} across ${r.passages.length} attested passages.${penalties.length > 0 ? ` Penalties: ${penalties.join(', ')}.` : ''}`;

    const clusterIdMatch = r.evidence_id.startsWith('r11:cluster:')
      ? r.evidence_id.replace('r11:cluster:', '')
      : undefined;

    return {
      connection_id: r.evidence_id,
      query_intent: queryIntent,
      query_support: supportClass(r),
      shared_witness_refs: sharedWitnesses(r).map(p => p.ref),
      evidence_id: r.evidence_id,
      evidence_release_id: releaseId,
      title: r.title,
      explanation: r.summary,
      predicate: r.predicate,
      evidence_type: r.evidence_type || inferEvidenceType(r),
      evidence_tier: r.evidence_tier,
      epistemic_class: r.epistemic_class,
      score: r.score_components.final_score,
      ...(r.score_breakdown ? { score_breakdown: r.score_breakdown } : {}),
      confidence_label: confidenceFromRecord(r),
      uncertainty_note: r.limitations[0] || defaultUncertainty(r),
      matched_concepts: r.matched_terms,
      passages: r.passages,
      original_words: r.original_words,
      witness_count: Math.max(1, r.provenance?.source_record_ids?.length || r.passages.length),
      penalties_applied: penalties,
      cluster_id: clusterIdMatch,
      ranking_rationale: {
        base_tier_score: r.score_components.base_tier_score,
        specificity_bonus: r.score_components.specificity_bonus,
        witness_bonus: r.score_components.witness_bonus,
        penalties,
        final_score: r.score_components.final_score,
        why_ranked_high: whyRationale,
      },
      ...(r.r12_metadata ? { r12_metadata: r.r12_metadata } : {}),
      ...(r.v3_score ? { v3_score: r.v3_score } : {}),
      ...(r.expand_id ? { expand_id: r.expand_id } : {}),
    };
  });

  // Multi-cluster bridges if not already populated
  if (clusters.length >= 2 && bridges.length === 0) {
    for (let i = 0; i < clusters.length - 1; i++) {
      const cA = clusters[i];
      const cB = clusters[i + 1];
      const bridgeNode = cA.anchor_nodes.find(n => n.kind === 'lemma') || cB.anchor_nodes.find(n => n.kind === 'lemma') || cA.anchor_nodes[0];
      if (bridgeNode) {
        bridges.push({
          bridge_id: `bridge:${cA.cluster_id}:${cB.cluster_id}`,
          from_cluster_id: cA.cluster_id,
          to_cluster_id: cB.cluster_id,
          bridging_node: bridgeNode,
          evidence_id: summaries[0]?.evidence_id || '',
          evidence_tier: summaries[0]?.evidence_tier || 3,
          explanation: `Subclusters stay distinct rather than forced into one chain; linked via shared biblical concept ${bridgeNode.label}.`,
        });
      }
    }
  }

  // Construct Connection Paths from top evidence records (multi-step for R12 proof paths)
  const connectionPaths: R10ConnectionPath[] = query.lite_subgraph_mode ? [] : pagedRecords.slice(0, 8).map(r => {
    if (r.r12_metadata?.steps?.length) {
      const steps = r.r12_metadata.steps;
      const firstSt = steps[0];
      const lastSt = steps[steps.length - 1];
      const startNode: R10Node = {
        id: firstSt.from_id,
        kind: 'lemma',
        label: firstSt.from_label,
        epistemic_class: r.epistemic_class,
        grounding_source: firstSt.source_dataset || r.provenance.source_dataset,
      };
      const endNode: R10Node = {
        id: lastSt.to_id,
        kind: 'lemma',
        label: lastSt.to_label,
        epistemic_class: r.epistemic_class,
        grounding_source: lastSt.source_dataset || r.provenance.source_dataset,
      };
      return {
        path_id: `path:${r.evidence_id}`,
        start_node: startNode,
        end_node: endNode,
        matched_concepts: r.matched_terms,
        weakest_tier: r.evidence_tier,
        aggregate_score: r.score_components.final_score,
        explanation: r.summary,
        limitations: r.limitations,
        steps: steps.map(st => ({
          from_node_id: st.from_id,
          from_label: st.from_label,
          to_node_id: st.to_id,
          to_label: st.to_label,
          predicate: r.predicate,
          evidence_tier: r.evidence_tier,
          epistemic_class: r.epistemic_class,
          evidence_id: r.evidence_id,
          relation_summary: `${st.relation_type} (${st.epistemic_layer}, q=${st.quality_weight}${st.witness_refs?.length ? `, refs=${st.witness_refs.slice(0, 2).join(', ')}` : ''})`,
          key_passage: r.passages[0],
        })),
      };
    }

    const startP = r.passages[0];
    const endP = r.passages[r.passages.length - 1];
    const startNode: R10Node = startP
      ? { id: `passage:${startP.ref}`, kind: 'passage', label: startP.ref, passage: startP, epistemic_class: r.epistemic_class, grounding_source: r.provenance.source_dataset }
      : { id: r.source_node_id, kind: 'concept', label: r.source_node_id.replace(/^[a-z]+:/, ''), epistemic_class: r.epistemic_class, grounding_source: r.provenance.source_dataset };
    const endNode: R10Node = endP && endP.ref !== startP?.ref
      ? { id: `passage:${endP.ref}`, kind: 'passage', label: endP.ref, passage: endP, epistemic_class: r.epistemic_class, grounding_source: r.provenance.source_dataset }
      : { id: r.target_node_id, kind: 'concept', label: r.target_node_id.replace(/^[a-z]+:/, ''), epistemic_class: r.epistemic_class, grounding_source: r.provenance.source_dataset };
    return {
      path_id: `path:${r.evidence_id}`,
      start_node: startNode,
      end_node: endNode,
      matched_concepts: r.matched_terms,
      weakest_tier: r.evidence_tier,
      aggregate_score: r.score_components.final_score,
      explanation: r.summary,
      limitations: r.limitations,
      steps: [{
        from_node_id: startNode.id,
        from_label: startNode.label,
        to_node_id: endNode.id,
        to_label: endNode.label,
        predicate: r.predicate,
        evidence_tier: r.evidence_tier,
        epistemic_class: r.epistemic_class,
        evidence_id: r.evidence_id,
        relation_summary: r.title,
        key_passage: startP,
      }],
    };
  });

  // Additional thematic controls
  if (matchedMotifs.has('lampstand') || matchedMotifs.has('lamp') || queryTermSet.has('seven')) {
    controls.push({
      control_id: 'ctrl:rev1_20_vs_rev4_5',
      kind: 'distinct_context_warning',
      title: 'Distinct imagery control: Rev 1:20 lampstands (λυχνίαι = churches) vs Rev 4:5 lamps (λαμπάδες = Spirits)',
      explanation: 'Revelation explicitly gives different referents for the seven lampstands (Rev 1:20 = seven churches) and the seven burning lamps (Rev 4:5 = seven Spirits of God). Do not merge all "seven + lamp" references into one meaning.',
    });
  }
  if (queryTermSet.has('seven') || queryTermSet.has('7') || queryTermSet.has('four') || queryTermSet.has('4')) {
    controls.push({
      control_id: 'ctrl:number_coincidence_guard',
      kind: 'number_coincidence_warning',
      title: 'Number coincidence guard: shared numeral alone does not prove theological connection',
      explanation: 'Ordinal occurrences, temporal durations, and unrelated ordinary counts are separated from symbolic vision counts and penalized when context differs.',
    });
  }
  if (queryTermSet.has('baptism') || queryTermSet.has('sea') || queryTermSet.has('exodus')) {
    controls.push({
      control_id: 'ctrl:exod14_event_vs_paul_typology',
      kind: 'alternative_explanation',
      title: 'Historical event vs later NT typology (Exodus 14 vs 1 Corinthians 10:1–2)',
      explanation: 'Exodus 14 narrates historical deliverance without baptism vocabulary; Paul in 1 Cor 10:1–2 introduces the typological comparison. Avoid reading later baptismal symbolism into every Exodus 14 detail.',
    });
  }
  if (queryTermSet.has('adam') && queryTermSet.has('dam') || hebStrongs.some(s => s === 'H0120' || s === 'H1818')) {
    controls.push({
      control_id: 'ctrl:adam_dam_not_etymology',
      kind: 'orthographic_false_positive_warning',
      title: 'Orthographic false-etymology guard: אָדָם (adam) vs דָּם (dam)',
      explanation: 'While אָדָם (ʾ-d-m) orthographically contains ד-ם (d-m, blood), STEPBible/BDB treat them as distinct lexical entries with NO proven common historical root. Contrast this weak spelling overlap with the explicit Hebrew wordplay אָדָם ↔ אֲדָמָה (ground) in Gen 2:7.',
    });
  }
  if (missingConcepts.length > 0) {
    controls.push({
      control_id: 'ctrl:missing_concepts',
      kind: 'missing_evidence',
      title: `Unresolved or unsupported query terms: ${missingConcepts.join(', ')}`,
      explanation: 'These terms did not match canonical original-language lemmas, motifs, or events in the index; no fabricated connections were added.',
    });
  }

  for (const od of orthDetails) {
    if (od.homographs?.length) {
      controls.push({
        control_id: `ctrl:orth_homograph:${od.bs}`,
        kind: 'homograph_disambiguation',
        title: `Hebrew consonantal homograph notice for ${od.script} (${od.bs})`,
        explanation: `${od.script} (${od.cons}) shares its unpointed consonantal skeleton with distinct entry ${od.homographs.map((h: any) => `${h.script} (${h.bs} "${h.gloss}")`).join(', ')}.`,
      });
    }
  }

  // I. Iterative Analysis Mode Construction
  const effectiveMode = query.mode || 'discover';
  const iterativeAnalysis: DiscoverConnectionsResult['iterative_analysis'] = {
    mode: effectiveMode,
  };

  if (effectiveMode === 'expand') {
    iterativeAnalysis.explanation = `Expanded deep occurrence analysis for ${focusProf ? `${focusProf.sc} (${focusProf.bs}, "${focusProf.gl}")` : query.query}. Total attested canonical verses: ${targetVids.length}.`;
  } else if (effectiveMode === 'bridge') {
    iterativeAnalysis.explanation = `Conceptual bridge analysis connecting distinct semantic domains via intermediate original-language hubs.`;
    iterativeAnalysis.bridges = bridges;
  } else if (effectiveMode === 'compare') {
    iterativeAnalysis.explanation = `Comparative distribution across canonical corpora and semantic clusters.`;
    iterativeAnalysis.comparison = {
      targets: query.compare_targets || extractedTerms,
      clusters: clusters.map(c => ({ id: c.cluster_id, label: c.label, passages_count: c.total_passages })),
      differences: 'Examines genre variations (narrative architecture vs poetic imagery vs superscriptions) and canonical testament distribution.',
    };
  } else if (effectiveMode === 'explain') {
    iterativeAnalysis.explanation = `Hermeneutical rationale: synthesis of Tier 1-3 source-grounded evidence records, separating direct grammatical/textual facts from later interpretive traditions.`;
  } else if (effectiveMode === 'challenge') {
    iterativeAnalysis.explanation = `Negative controls, disambiguation guards, and homograph boundaries.`;
    iterativeAnalysis.challenges = controls;
  }

  if (focusProf && targetVids.length > 0) {
    iterativeAnalysis.lemma_occurrences = {
      strongs: focusProf.bs,
      total_verses: targetVids.length,
      offset: occOffset,
      returned: hydratedOccPassages.length,
      next_cursor: hasMoreOcc ? String(occOffset + hydratedOccPassages.length) : null,
      has_more: hasMoreOcc,
      passages: hydratedOccPassages,
    };
  }

  const totalAvailable = rankedAll.length;
  const hasMore = offset + pagedRecords.length < totalAvailable;
  const elapsedMs = Math.max(1, Date.now() - tStart);

  return {
    schema_version: 1,
    status: pagedRecords.length > 0 ? (missingConcepts.length > 0 ? 'partial' : 'ok') : 'no_match',
    query_intent: queryIntent,
    release_id: releaseId,
    evidence_release_id: releaseId,
    parsed_query: {
      raw_query: query.query,
      extracted_terms: extractedTerms,
      explicit_passages: explicitPassages,
      resolved_concepts: resolvedConcepts,
      missing_concepts: missingConcepts,
      multi_cluster_mode: clusters.length >= 2,
    },
    strongest_connections: summaries,
    clusters: query.lite_subgraph_mode ? [] : clusters.slice(0, 6),
    bridges: query.lite_subgraph_mode ? [] : bridges.slice(0, 8),
    connection_paths: connectionPaths.slice(0, 8),
    related_discoveries: query.lite_subgraph_mode
      ? {
          additional_motifs: [],
          roots_and_wordplay: [],
          cross_references: [],
          literary_parallels: [],
          biblical_events: [],
        }
      : {
          additional_motifs: [...matchedMotifs].map(mId => ({
            motif_id: mId,
            label: motifsData?.motifs?.[mId]?.label || mId,
            summary: `Verified original-language motif occurrences across ${motifsData?.motifs?.[mId]?.total_verses || 0} verses.`,
            passage_count: motifsData?.motifs?.[mId]?.total_verses || 0,
          })),
          roots_and_wordplay: summaries.filter(s => s.predicate === 'orthographic_wordplay' || s.predicate === 'orthographic_overlap' || s.predicate === 'cross_language_bridge'),
          cross_references: crossReferencesOut.slice(0, 20),
          literary_parallels: summaries.filter(s => s.predicate === 'literary_pattern' || s.predicate === 'literary_correspondence'),
          biblical_events: matchedEvents.slice(0, 6).map(e => ({
            event_id: e.event_id,
            title: e.title,
            timing_label: e.start_date || undefined,
            passages: e.passages.slice(0, 4),
          })),
        },
    controls_and_alternatives: controls,
    pagination: {
      total_available: totalAvailable,
      returned: summaries.length,
      next_cursor: hasMore ? String(offset + limit) : null,
      has_more: hasMore,
    },
    search_metadata: {
      // Exhausting bounded generated candidates is not exhaustive corpus discovery.
      exhaustive: false,
      scope: 'Bounded candidate discovery over selected lemma profiles; occurrence pagination is complete only for its selected lemma and source editions.',
      resolution_state: resolvedConcepts.length || explicitPassages.length ? 'known_concept' : 'unknown_concept',
      occurrence_state: loadedProfiles.some(p => p.total_verses > 0) || explicitPassages.some(p => p.verse_id > 0) ? 'direct_occurrences_found' : 'no_indexed_occurrences',
      connection_state: totalAvailable ? 'connections_found' : 'no_higher_order_connections',
      completeness_state: budget.used >= budget.max ? 'resource_limits_reached' : budget.missing.length ? 'missing_source_coverage' : 'search_incomplete',
      missing_assets: budget.missing,
      occurrence_scope: focusProf ? { lemma: focusProf.bs, total_verses: targetVids.length,
        page_complete: hydratedOccPassages.length === pagedOccVids.length,
        pagination_complete: !hasMoreOcc && hydratedOccPassages.length === pagedOccVids.length,
        source_scope: 'Indexed canonical verse witnesses from MACULA Hebrew, Nestle1904 and STEP; LXX correspondences reported separately.' } : undefined,
      bounded_by: [
        `limit=${limit}`,
        `max_subrequests=${budget.max}`,
        `used_subrequests=${budget.used}`,
      ],
      asset_requests_used: budget.used,
      execution_ms: elapsedMs,
      source_attribution: [
        'STEPBible TBESH/TBESG/TAHOT/TAGNT (CC BY 4.0)',
        'MACULA Hebrew & Greek (CC BY 4.0)',
        'CrossReferences.org / OpenBible (CC BY 4.0)',
        'Theographic Bible Data (CC BY-SA 4.0)',
        'World English Bible (Public Domain)',
        ...(r12PropertyCount > 0
          ? ['Open English WordNet 2025 (CC BY 4.0 / Princeton WordNet attribution)', 'Wikidata Structured Concept Extract (CC0 1.0)']
          : []),
      ],
    },
    iterative_analysis: iterativeAnalysis,
    ...(r12AnchorsMatched.length > 0
      ? {
          r12_discovery: {
            schema_version: 1,
            release_id: fastManifest?.r12_version || 'r12-discovery-3',
            evidence_release_id: releaseId,
            score_version: r12ScoreVersion,
            pilot_anchors_matched: [...new Set(r12AnchorsMatched)],
            multihop_recommendations_count: r12MultihopCount,
            property_bridges_count: r12PropertyCount,
            structural_candidates_count: r12StructuralCount,
            orthographic_candidates_count: r12OrthographicCount,
            exploratory_tail_cursor: r12TailCursor,
            external_sources: r12ExternalSources,
          },
        }
      : {}),
  };
}

export async function getConnectionEvidence(
  reader: AssetReader,
  evidenceId: string,
  releaseId: string = DEFAULT_R10_RELEASE
): Promise<ConnectionEvidenceResult> {
  const budget = { used: 0, max: MAX_SUBREQUEST_BUDGET, missing: [] as string[], b64Cache: new Map<string, any>() };
  const fastManifest = await readR10Json<FastManifest>(reader, releaseId, 'fast-manifest.json.gz', budget);
  if (releaseId !== DEFAULT_R10_RELEASE && !fastManifest) {
    // Preserve legacy (e.g. r10-v1.0) and fixture releases that omit fast-manifest.json.gz
    const legacyExplicit = await readR10Json<{ records?: any[] }>(reader, releaseId, 'explicit-and-typology.json.gz', budget);
    if (!legacyExplicit) {
      // Use an isolated probe budget so DEFAULT_R10_RELEASE does not collide with releaseId in budget.pages
      const probeBudget: ReadBudget = { used: 0, max: 5, pages: new Map(), missing: [] };
      const loadedManifest = await readR10Json<FastManifest>(reader, DEFAULT_R10_RELEASE, 'fast-manifest.json.gz', probeBudget);
      // Note: readR10Json synthesizes a default fast-manifest object on miss for DEFAULT_R10_RELEASE,
      // so require probeBudget.missing.length === 0 to confirm the bundle actually loaded.
      if (loadedManifest && (probeBudget.missing?.length ?? 0) === 0) {
        const isOverlayTag =
          releaseId === loadedManifest.r12_version ||
          releaseId === loadedManifest.witness_version;
        const reason: 'corpus_overlay_release_id_passed' | 'unsupported_evidence_release_id' =
          isOverlayTag ? 'corpus_overlay_release_id_passed' : 'unsupported_evidence_release_id';
        return {
          schema_version: 1,
          status: 'release_mismatch',
          release_id: releaseId,
          evidence_release_id: DEFAULT_R10_RELEASE,
          requested_release_id: releaseId,
          ...(loadedManifest.r12_version ? { corpus_release_id: loadedManifest.r12_version } : {}),
          error: isOverlayTag
            ? `Requested release_id '${releaseId}' is a corpus/R12 overlay identifier, not an evidence index release. Loaded evidence index release is '${DEFAULT_R10_RELEASE}'. Omit release_id or pass '${DEFAULT_R10_RELEASE}'.`
            : `Unsupported evidence release_id '${releaseId}'. Loaded evidence index release is '${DEFAULT_R10_RELEASE}'.`,
          mismatch: {
            requested_release_id: releaseId,
            expected_evidence_release_id: DEFAULT_R10_RELEASE,
            ...(loadedManifest.r12_version ? { loaded_corpus_release_id: loadedManifest.r12_version } : {}),
            reason,
            hint: `Call get_connection_evidence_v1 without release_id or with release_id='${DEFAULT_R10_RELEASE}'.`,
          },
          evidence: null,
          passage_details: [],
          coverage: { state: 'available', missing_assets: [] },
        };
      }
    }
  }
  let record: R10EvidenceRecord | null = null;
  const targetStrongs = new Set<string>();

  const { bookCache, chunkMetaCache, loadBookData, hydratePassageByVid } = createPassageHydrator(
    reader, releaseId, fastManifest, budget, true,
  );

  // Handle R13 v3 dynamic evidence IDs (v3bridge / v3bmw)
  if (evidenceId.startsWith('r13:v3bridge:') || evidenceId.startsWith('r13:v3bmw:')) {
    const vid = Number(evidenceId.split(':').pop() || '0');
    if (vid >= 1 && vid <= 31203) {
      const session = new V3RuntimeSession(reader);
      const [v, csr] = await Promise.all([session.getVerse(vid), session.lookupCsr(vid)]);
      if (v) {
        const pRef = applyRangeRef(buildRefStub(vid, v.ref), v.ref);
        pRef.snippet = v.en || '';
        const isBridge = evidenceId.startsWith('r13:v3bridge:');
        const words: R10OriginalWordRef[] = [];
        const seenBs = new Set<string>();
        for (const t of v.toks || []) {
          const bs = normStrongs4(t.s);
          if (!bs || t.is_func || seenBs.has(bs) || words.length >= 6) continue;
          seenBs.add(bs);
          targetStrongs.add(bs);
          words.push({
            strongs: bs,
            lemma_key: t.lk,
            language: bs.startsWith('G') ? 'grc' : 'hbo',
            lemma_script: t.lm || t.sf || bs,
            transliteration: '',
            gloss: t.g || '',
          });
        }
        record = {
          evidence_id: evidenceId,
          predicate: 'literary_correspondence',
          evidence_type: isBridge ? 'multi_hop_pattern' : 'multi_passage_motif',
          evidence_tier: 3,
          epistemic_class: isBridge ? 'shared_motif_evidence' : 'documented_collocation_or_cooccurrence',
          title: isBridge
            ? `Intermediate bridge pivot: ${pRef.ref}`
            : `Multi-term v3 BMW convergence in ${pRef.ref}`,
          summary: `${pRef.ref} (${csr.length} typed CSR links, ${(v.concepts || []).length} cross-lingual concepts): "${v.en || ''}"`,
          source_node_id: `passage:${pRef.ref}`,
          target_node_id: `passage:${pRef.ref}`,
          passages: [pRef],
          original_words: words,
          matched_terms: (v.concepts || []).slice(0, 6),
          limitations: ['BibleResearch v3 Typed Conductance PPR / BMW evidence record; verify endpoint contexts.'],
          provenance: {
            source_dataset: 'MACULA + STEPBible + v3 Conductance Graph',
            source_record_ids: [pRef.ref],
            license: 'CC BY 4.0',
            derivation_method: isBridge ? 'v3_information_bottleneck_pivot' : 'v3_block_max_wand_retrieval',
          },
          score_components: {
            base_tier_score: TIER_BASE_SCORE[3],
            specificity_bonus: 80,
            witness_bonus: 20,
            common_word_penalty: 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: TIER_BASE_SCORE[3] + 100,
          },
          expand_id: evidenceId,
        };
      }
    }
  }

  // Handle R11 synthesized dynamic evidence IDs
  if (evidenceId.startsWith('r11:cluster:')) {
    const clId = evidenceId.replace('r11:cluster:', '');
    const bs = clId.split(':')[0];
    targetStrongs.add(bs);
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    const cl = prof?.clusters?.find((c: any) => c.cluster_id === clId);
    if (prof && cl) {
      let tier: R10EvidenceTier = 3;
      let predicate: R10Predicate = 'verified_lexical_grammatical';
      let epistemicClass: R10EpistemicClass = 'direct_textual_evidence';
      let limitations = ['Evidence-derived corpus cluster based on syntactic and lexical co-occurrence.'];

      const looksGeoCluster = cl.category === 'temple_and_sanctuary_architecture' && (() => {
        const collocs = (cl.collocated_words || []).map((w: any) => String(w.gl || '').toLowerCase());
        const passagesText = (cl.sample_passages || []).map((p: any) => `${p.ref || ''} ${p.snippet || ''}`.toLowerCase()).join(' ');
        const hasSanctuaryColloc = collocs.some((g: string) =>
          /\b(temple|tabernacle|sanctuary|altar|ark|lampstand|menorah|curtain|veil|cherub|cherubim|holies|priest|levite|incense|offering|atonement|ephod|breastplate|pillar|courtyard|bowl|socket|cubit|gold|bronze|engraving|signet)\b/.test(g)
        );
        const hasSanctuaryRef =
          /\b(tabernacle|sanctuary|temple|altar|ark|lampstand|curtain|cherub|priest|most holy|holy place|house of the lord|house of yahweh|tent of meeting)\b/.test(passagesText);
        return !hasSanctuaryColloc && !hasSanctuaryRef;
      })();

      if (cl.category === 'temple_and_sanctuary_architecture' && !looksGeoCluster) {
        const hasArchColloc = (cl.collocated_words || []).some((w: any) =>
          ['pillar', 'cup', 'brim', 'handbreadth', 'thickness', 'bath', 'deed'].some(k => w.gl.toLowerCase().includes(k))
        ) || (cl.xrefs || []).length > 0;
        tier = hasArchColloc ? 2 : 3;
        limitations = ['Sanctuary and Temple architecture descriptions; physical ornamentation rather than metaphorical or typological discourse.'];
      } else if (looksGeoCluster) {
        tier = 3;
        limitations = ['Evidence-derived cluster grouping historical and geographical occurrences.'];
      } else if (cl.category === 'psalm_superscription') {
        tier = 3;
        epistemicClass = 'documented_lexical_relationship';
        limitations = ['Psalm heading / musical or liturgical superscription; whether the expression denotes a tune, instrument, or floral motif is uncertain in source text.'];
      } else if (['poetic_imagery_and_similes', 'prophetic_imagery_and_oracles', 'gospel_and_nt_teaching'].includes(cl.category)) {
        if (cl.has_simile) {
          tier = 2;
          predicate = 'explicit_comparison';
          limitations = ['Explicit comparative simile in biblical text; context determines the extent of figurative correspondence.'];
        } else {
          tier = 3;
          limitations = ['Attested imagery in poetic or prophetic discourse.'];
        }
      }

      record = {
        evidence_id: evidenceId,
        predicate,
        evidence_tier: tier,
        epistemic_class: epistemicClass,
        title: cl.label,
        summary: cl.summary,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `cluster:${cl.cluster_id}`,
        passages: cl.sample_passages.map((p: any) => ({
          verse_id: p.verse_id,
          ref: p.ref,
          mt_ref: p.mt_ref,
          book: p.book,
          chapter: p.chapter,
          verse: p.verse,
          testament: p.testament,
          snippet: p.snippet,
          is_psalm_heading: p.book === 19 && p.verse === 0,
        })),
        original_words: [
          { lemma_key: prof.lk, strongs: prof.bs, language: languageFromStrongs(prof.bs, prof.lang), lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
        ],
        matched_terms: [prof.gl, prof.sc, prof.bs],
        limitations,
        provenance: {
          source_dataset: 'MACULA Hebrew & Greek + STEPBible',
          source_record_ids: cl.sample_passages.map((p: any) => p.ref),
          license: 'CC BY 4.0',
          derivation_method: 'evidence_derived_semantic_cluster',
        },
        score_components: {
          base_tier_score: TIER_BASE_SCORE[tier],
          specificity_bonus: 80,
          witness_bonus: 40,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: TIER_BASE_SCORE[tier] + 120,
        },
      };
    }
  } else if (evidenceId.startsWith('r11:gram:')) {
    const [, , bs, pred, relStrongs] = evidenceId.split(':');
    targetStrongs.add(bs);
    targetStrongs.add(relStrongs);
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    const gr = prof?.grammatical_relations?.find((g: any) => g.predicate === pred && g.related_strongs === relStrongs);
    if (prof && gr && (gr.witnesses === undefined || gr.witnesses.length > 0)) {
      const gTier: R10EvidenceTier = (gr.independent_witness_count ?? gr.occurrences) >= 2 ? 2 : 3;
      const grPassages = gr.witnesses?.map(w => w.passage) || [];
      const gramSense = resolveDisplaySense(prof, grPassages);
      record = {
        evidence_id: evidenceId,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: gTier,
        epistemic_class: 'direct_textual_evidence',
        title: `${gr.display_label}: ${gramSense.sc} (${gramSense.tr}) ↔ ${gr.related_script} ("${gr.related_gloss}", ${gr.occurrences}×)`,
        summary: `Syntactic dependency analysis identifies direct grammatical connection (${gr.display_label}) between ${gramSense.sc} (${prof.bs}, "${gramSense.gl}") and ${gr.related_script} (${gr.related_strongs}, "${gr.related_gloss}") across ${gr.occurrences} indexed occurrences.${gr.independent_witness_count !== undefined ? ` ${gr.independent_witness_count} distinct canonical source clauses pass token-position verification; parallel editions are counted once.` : ''}`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `lemma:${gr.related_strongs}`,
        passages: grPassages,
        original_words: [
          { lemma_key: gramSense.lk, strongs: prof.bs, language: languageFromStrongs(prof.bs, prof.lang), lemma_script: gramSense.sc, transliteration: gramSense.tr, gloss: gramSense.gl },
          { strongs: gr.related_strongs, language: languageFromStrongs(gr.related_strongs, prof.lang), lemma_script: gr.related_script, transliteration: '', gloss: gr.related_gloss },
        ],
        matched_terms: [gramSense.gl, gr.related_gloss, prof.bs, gr.related_strongs],
        limitations: [gr.witnesses ? `Exact source relations; ${gr.independent_witness_count} distinct canonical clause witnesses. Parallel editions and mirrored paths do not add independent support.` : 'Legacy aggregate without attached matching witnesses; inspect grammatical relationship evidence before citing.', 'Syntactic construct/argument relation; shared grammar alone establishes no theological or authorial significance.'],
        provenance: {
          source_dataset: 'MACULA Hebrew/Greek Syntactic Trees',
          source_record_ids: gr.witnesses?.map(w => w.relation_id) || [],
          license: 'CC BY 4.0',
          derivation_method: 'syntactic_dependency_relation',
        },
        score_components: {
          base_tier_score: TIER_BASE_SCORE[gTier],
          specificity_bonus: 80,
          witness_bonus: 20,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: TIER_BASE_SCORE[gTier] + 100,
        },
      };
    }
  } else if (evidenceId.startsWith('r11:occ:')) {
    const [, , bs, vidStr] = evidenceId.split(':');
    targetStrongs.add(bs);
    const vid = Number(vidStr);
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    const p = await hydratePassageByVid(vid);
    if (prof && p) {
      record = {
        evidence_id: evidenceId,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: 3,
        epistemic_class: 'direct_textual_evidence',
        title: `Attested occurrence: ${prof.sc} (${prof.tr}) in ${p.ref}`,
        summary: `Attested biblical occurrence of ${prof.sc} (${prof.bs}, "${prof.gl}") in ${p.ref}: "${p.snippet || ''}".`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `passage:${p.ref}`,
        passages: [p],
        original_words: [
          { lemma_key: prof.lk, strongs: prof.bs, language: languageFromStrongs(prof.bs, prof.lang), lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
        ],
        matched_terms: [prof.gl, prof.sc, prof.bs],
        limitations: ['Individual verse occurrence; context defines specific grammatical role and semantic nuance.'],
        provenance: {
          source_dataset: 'MACULA + STEPBible',
          source_record_ids: [p.ref],
          license: 'CC BY 4.0',
          derivation_method: 'canonical_verse_attestation',
        },
        score_components: {
          base_tier_score: 760,
          specificity_bonus: 60,
          witness_bonus: 10,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: 830,
        },
      };
    }
  } else if (evidenceId.startsWith('r11:intersect:verse:')) {
    const [, , , bsA, bsB, vidStr] = evidenceId.split(':');
    targetStrongs.add(bsA);
    targetStrongs.add(bsB);
    const vid = Number(vidStr);
    const p = await hydratePassageByVid(vid);
    if (p) {
      const vData = bookCache.get(p.book)?.[String(vid)];
      const toks: any[] = vData?.toks || [];
      if (bsA === bsB) {
        const distinctWn = new Set(toks.filter(t => t.s === bsA).map(t => t.wn));
        if (distinctWn.size < 2) {
          return {
            schema_version: 1,
            status: 'not_found',
            release_id: releaseId,
            evidence_release_id: releaseId,
            evidence: null,
            passage_details: [],
            coverage: {
              state: 'available',
              missing_assets: budget.missing,
            },
          };
        }
      }
      record = {
        evidence_id: evidenceId,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: 2,
        epistemic_class: 'direct_textual_evidence',
        title: `Direct textual convergence in ${p.ref}`,
        summary: `Scripture text contains both ${bsA} and ${bsB} in the same verse (${p.ref}): "${p.snippet || ''}".`,
        source_node_id: `lemma:${bsA}`,
        target_node_id: `lemma:${bsB}`,
        passages: [p],
        original_words: [],
        matched_terms: [bsA, bsB],
        limitations: ['Direct intra-verse co-occurrence establishes textual contact; syntax and discourse function determine relationship.'],
        provenance: {
          source_dataset: 'MACULA Hebrew & Greek',
          source_record_ids: [p.ref],
          license: 'CC BY 4.0',
          derivation_method: 'exact_verse_lemma_intersection',
        },
        score_components: {
          base_tier_score: 860,
          specificity_bonus: 180,
          witness_bonus: 40,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: 1080,
        },
      };
    }
  } else if (evidenceId.startsWith('r11:polysemy:')) {
    const [, , bs, vidStr] = evidenceId.split(':');
    targetStrongs.add(bs);
    const vid = Number(vidStr);
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    const p = await hydratePassageByVid(vid);
    if (prof && p) {
      record = {
        evidence_id: evidenceId,
        predicate: 'interpretive_hypothesis',
        evidence_tier: 5,
        epistemic_class: 'documented_lexical_relationship',
        title: `Single-token polysemy notice for ${prof.sc} (${prof.bs}) in ${p.ref}`,
        summary: `Lexical polysemy across glosses of ${prof.sc} (${prof.bs}, "${prof.gl}") in ${p.ref}: "${p.snippet || ''}". One attested token does not establish independent co-occurrence.`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `lemma:${prof.bs}`,
        passages: [p],
        original_words: [{ lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl }],
        matched_terms: [prof.bs, prof.gl],
        limitations: ['Single source occurrence only; multiple English glosses of one polysemous word do not establish independent textual convergence.'],
        provenance: { source_dataset: 'MACULA Hebrew & Greek + STEPBible', source_record_ids: [p.ref], license: 'CC BY 4.0', derivation_method: 'single_token_polysemy_notice' },
        score_components: { base_tier_score: TIER_BASE_SCORE[5], specificity_bonus: 40, witness_bonus: 0, common_word_penalty: 0, number_coincidence_penalty: 0, orthographic_penalty: 0, final_score: TIER_BASE_SCORE[5] + 40 },
      };
    }
  } else if (evidenceId.startsWith('r11:repeat:verse:')) {
    const [, , , bs, vidStr] = evidenceId.split(':');
    targetStrongs.add(bs);
    const vid = Number(vidStr);
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    const p = await hydratePassageByVid(vid);
    if (prof && p) {
      record = {
        evidence_id: evidenceId,
        predicate: 'verified_lexical_grammatical',
        evidence_tier: 3,
        epistemic_class: 'direct_textual_evidence',
        title: `Repeated lemma in ${p.ref}: ${prof.sc} (${prof.bs})`,
        summary: `Distinct token occurrences of ${prof.sc} (${prof.bs}, "${prof.gl}") in ${p.ref}: "${p.snippet || ''}".`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: `passage:${p.ref}`,
        passages: [p],
        original_words: [{ lemma_key: prof.lk, strongs: prof.bs, language: prof.lang, lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl }],
        matched_terms: [prof.bs, prof.gl],
        limitations: ['Repetition of a single canonical lemma across distinct verse tokens.'],
        provenance: { source_dataset: 'MACULA Hebrew & Greek', source_record_ids: [p.ref], license: 'CC BY 4.0', derivation_method: 'repeated_lemma_distinct_tokens' },
        score_components: { base_tier_score: TIER_BASE_SCORE[3], specificity_bonus: 110, witness_bonus: 20, common_word_penalty: 0, number_coincidence_penalty: 0, orthographic_penalty: 0, final_score: TIER_BASE_SCORE[3] + 130 },
      };
    }
  } else if (evidenceId.startsWith('r11:lxx:')) {
    const [, , bs, idxStr] = evidenceId.split(':');
    targetStrongs.add(bs);
    const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
    const rel = prof?.lxx_relations?.[Number(idxStr)];
    if (prof && rel) {
      if (rel.target_strongs) targetStrongs.add(rel.target_strongs);
      const sampleRefs = (rel.sample_refs || (rel.ref ? [rel.ref] : [])).slice(0, 4);
      const refSet = new Set(sampleRefs);
      const pool: any[] = [
        ...(prof.first_occ_passages || []),
        ...((prof.clusters || []).flatMap((c: any) => c.sample_passages || [])),
      ];
      const lxxPassages: R10PassageRef[] = [];
      const seenVid = new Set<number>();
      for (const p of pool) {
        if (p?.ref && refSet.has(p.ref) && !seenVid.has(p.verse_id || 0)) {
          seenVid.add(p.verse_id || lxxPassages.length + 1);
          lxxPassages.push({
            verse_id: Number(p.verse_id || 0),
            ref: p.ref,
            mt_ref: p.mt_ref,
            book: Number(p.book || 1),
            chapter: Number(p.chapter || 1),
            verse: Number(p.verse || 1),
            testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
            snippet: p.snippet,
            is_psalm_heading: Number(p.book || 1) === 19 && Number(p.verse || 1) === 0,
          });
        }
      }
      if (lxxPassages.length === 0) {
        for (const p of pool) {
          if (p?.ref && !seenVid.has(p.verse_id || 0)) {
            seenVid.add(p.verse_id || lxxPassages.length + 1);
            lxxPassages.push({
              verse_id: Number(p.verse_id || 0),
              ref: p.ref,
              mt_ref: p.mt_ref,
              book: Number(p.book || 1),
              chapter: Number(p.chapter || 1),
              verse: Number(p.verse || 1),
              testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
              snippet: p.snippet,
              is_psalm_heading: Number(p.book || 1) === 19 && Number(p.verse || 1) === 0,
            });
            if (lxxPassages.length >= 3) break;
          }
        }
      }
      if (lxxPassages.length === 0) {
        for (const vid of (prof.all_vids || []).slice(0, 3)) {
          const hp = await hydratePassageByVid(vid);
          if (hp) lxxPassages.push(hp);
        }
      }
      record = {
        evidence_id: evidenceId,
        predicate: 'cross_language_bridge',
        evidence_tier: 3,
        epistemic_class: 'documented_lexical_relationship',
        title: rel.type === 'lxx_heading_witness' ? `Septuagint superscription witness for ${rel.ref}: ${prof.sc}` : `Septuagint (LXX) bridge: ${prof.sc} (${prof.bs}) → ${rel.script || ''} (${rel.target_strongs || ''})`,
        summary: rel.type === 'lxx_heading_witness' ? `In ${rel.ref}, the Septuagint renders the Hebrew title containing ${prof.sc} as: "${rel.lxx_text}".` : `Septuagint translates Hebrew ${prof.sc} as Greek ${rel.script} across ${rel.count || 1} passages.`,
        source_node_id: `lemma:${prof.bs}`,
        target_node_id: rel.target_strongs ? `lemma:${rel.target_strongs}` : `concept:lxx:${prof.bs}`,
        passages: lxxPassages.slice(0, 4),
        original_words: [
          { lemma_key: prof.lk, strongs: prof.bs, language: languageFromStrongs(prof.bs, prof.lang), lemma_script: prof.sc, transliteration: prof.tr, gloss: prof.gl },
          ...(rel.target_strongs ? [{ strongs: rel.target_strongs, language: languageFromStrongs(rel.target_strongs, 'grc'), lemma_script: rel.script || '', transliteration: '', gloss: rel.gloss || '' }] : []),
        ],
        matched_terms: [prof.gl, prof.sc, rel.gloss || ''].filter(Boolean),
        limitations: ['Historical Septuagint translation choice; reflects Alexandrian Jewish understanding of the Hebrew text.'],
        provenance: {
          source_dataset: 'Swete LXX / Hatch-Redpath / STEPBible',
          source_record_ids: (rel.sample_refs || [rel.ref || prof.bs]),
          license: 'CC BY 4.0',
          derivation_method: 'lxx_swete_alignment',
        },
        score_components: {
          base_tier_score: 760,
          specificity_bonus: 60,
          witness_bonus: 20,
          common_word_penalty: 0,
          number_coincidence_penalty: 0,
          orthographic_penalty: 0,
          final_score: 840,
        },
      };
    }
  } else if (evidenceId.startsWith('r11:xref:')) {
    const [, , fVidStr, tVidStr] = evidenceId.split(':');
    const fVid = Number(fVidStr);
    const tVid = Number(tVidStr);
    const p1 = await hydratePassageByVid(fVid, true);
    const p2Raw = await hydratePassageByVid(tVid, false);
    if (p1 && p2Raw) {
      const fMeta = chunkMetaCache.get(fVid);
      const xrEntry = (fMeta?.xrefs || []).find((x: any[]) => Number(x[0]) === tVid);
      const sceneEntry = (fMeta?.scenes || []).find((sc: any[]) => Number(sc?.[0]) === 1 && Number(sc?.[1]) === tVid);
      const p2 = applyRangeRef(p2Raw, xrEntry?.[1]);
      const phrase = xrEntry ? String(xrEntry[2] || '') : '';
      const flags = xrEntry ? Number(xrEntry[3] || 0) : 0;
      const isReciprocal = (flags & 1) !== 0;
      const isCrossTest = xrEntry ? (flags & 2) !== 0 : (p1.testament !== p2.testament);
      record = buildXrefRecord({
        evidenceId,
        fromPassage: p1,
        toPassage: p2,
        phrase,
        isReciprocal,
        isCrossTest,
        ...(sceneEntry ? { scenePairsText: String(sceneEntry[5] || ''), sceneRoleCount: Number(sceneEntry[4] || 0) } : {}),
      });
    }
  } else if (
    evidenceId.startsWith('r12:scene:') ||
    evidenceId.startsWith('r12:entity:') ||
    evidenceId.startsWith('r12:prog:')
  ) {
    const [, familyKind, fVidStr, tVidStr] = evidenceId.split(':');
    const fVid = Number(fVidStr);
    const tVid = Number(tVidStr);
    const expectedKind = familyKind === 'scene' ? 1 : (familyKind === 'entity' ? 2 : 3);
    const [p1, p2] = await Promise.all([
      hydratePassageByVid(fVid, true),
      hydratePassageByVid(tVid, true),
    ]);
    if (p1 && p2) {
      const sc = (chunkMetaCache.get(fVid)?.scenes || []).find(
        (x: any[]) => Number(x?.[0]) === expectedKind && Number(x?.[1]) === tVid,
      );
      if (sc) {
        const anchorPassage = expectedKind === 2 && Number(sc[5]) > 0
          ? await hydratePassageByVid(Number(sc[5]), false)
          : null;
        record = buildEmbeddedSceneRecord({
          sceneTuple: sc,
          fromPassage: p1,
          toPassage: p2,
          anchorPassage,
        });
      }
    }
  } else if (evidenceId.startsWith('r11:colloc:')) {
    const [, , bsA, bsB] = evidenceId.split(':');
    if (bsA && bsB) {
      targetStrongs.add(bsA);
      targetStrongs.add(bsB);
      const [profA, profB] = await Promise.all([
        readProfile(reader, releaseId, fastManifest, bsA, budget),
        readProfile(reader, releaseId, fastManifest, bsB, budget),
      ]);
      const cw = (profA?.clusters?.[0]?.collocated_words || []).find((x: any) => x.bs === bsB);
      const samplePassages: R10PassageRef[] = (profA?.clusters?.[0]?.sample_passages || []).slice(0, 4).map((p: any) => ({
        verse_id: p.verse_id,
        ref: p.ref,
        mt_ref: p.mt_ref,
        book: p.book,
        chapter: p.chapter,
        verse: p.verse,
        testament: p.testament,
        snippet: p.snippet,
        is_psalm_heading: p.book === 19 && p.verse === 0,
      }));
      if (profA && cw) {
        record = {
          evidence_id: evidenceId,
          predicate: 'verified_lexical_grammatical',
          evidence_tier: 4,
          epistemic_class: 'documented_collocation_or_cooccurrence',
          title: `Direct collocation: ${profA.sc} ("${profA.gl}") ↔ ${cw.sc} ("${cw.gl}", ${cw.hits}×)`,
          summary: `Corpus co-occurrence links ${profA.sc} (${profA.bs}, "${profA.gl}") with ${cw.sc} (${cw.bs}, "${cw.gl}") across ${cw.hits} shared contexts.`,
          source_node_id: `lemma:${profA.bs}`,
          target_node_id: `lemma:${cw.bs}`,
          passages: samplePassages,
          original_words: [
            { lemma_key: profA.lk, strongs: profA.bs, language: profA.lang, lemma_script: profA.sc, transliteration: profA.tr, gloss: profA.gl },
            ...(profB ? [{ lemma_key: profB.lk, strongs: profB.bs, language: profB.lang, lemma_script: profB.sc, transliteration: profB.tr, gloss: profB.gl }] : []),
          ],
          matched_terms: [profA.gl, cw.gl, profA.bs, cw.bs],
          limitations: ['Co-occurring vocabulary in shared contexts; inspect surrounding verses for syntactic or thematic relation.'],
          provenance: {
            source_dataset: 'MACULA Hebrew & Greek + STEPBible',
            source_record_ids: samplePassages.map(p => p.ref),
            license: 'CC BY 4.0',
            derivation_method: 'direct_cluster_collocation',
          },
          score_components: { base_tier_score: TIER_BASE_SCORE[4], specificity_bonus: 50, witness_bonus: 20, common_word_penalty: 0, number_coincidence_penalty: 0, orthographic_penalty: 0, final_score: 720 },
        };
      }
    }
  } else if (evidenceId.startsWith('r12:event:')) {
    const rest = evidenceId.slice('r12:event:'.length);
    const sepIdx = rest.indexOf(':');
    const vid = Number(sepIdx >= 0 ? rest.slice(0, sepIdx) : rest);
    const evId = sepIdx >= 0 ? rest.slice(sepIdx + 1) : '';
    const p1 = vid ? await hydratePassageByVid(vid, true) : null;
    const motifsData = await readR10Json<MotifsData>(reader, releaseId, 'motifs-and-patterns.json.gz', budget);
    const evInfo = motifsData?.event_seq?.[evId];
    if (p1 && evInfo) {
      const eventsList = Array.isArray(motifsData?.events)
        ? motifsData!.events
        : (motifsData?.events_b64gz
            ? await decodeB64Gz<any[]>(reader, motifsData.events_b64gz, `/r10/events:${releaseId}`, budget.b64Cache)
            : null);
      const evObj = eventsList?.find((e: any) => e.event_id === evId);
      const evPassagesRaw: any[] = Array.isArray(evObj?.passages) ? evObj.passages : [];
      const isExactMatch = evPassagesRaw.length > 0
        ? evPassagesRaw.some((p: any) => Number(p.verse_id) === vid)
        : true;
      const nextEvId = evInfo.next || null;
      const nextInfo = nextEvId ? motifsData?.event_seq?.[nextEvId] || null : null;
      const nextVid = nextInfo?.sample_vids?.[0];
      const nextPassage = nextVid ? await hydratePassageByVid(Number(nextVid), false) : null;
      record = buildEventRecord({
        evidenceId,
        anchorPassage: p1,
        evId,
        evInfo,
        nextEvId,
        nextInfo,
        nextPassage,
        isExactMatch,
      });
    }
  } else if (evidenceId.startsWith('r11:intersect:pericope:')) {
    const [, , , vAStr, vBStr] = evidenceId.split(':');
    const vA = Number(vAStr);
    const vB = Number(vBStr);
    if (Number.isInteger(vA) && vA > 0 && Number.isInteger(vB) && vB > 0) {
      const p1 = await hydratePassageByVid(vA);
      const p2 = await hydratePassageByVid(vB);
      if (p1 && p2) {
        record = {
          evidence_id: evidenceId,
          predicate: 'shared_motif',
          evidence_tier: 4,
          epistemic_class: 'shared_motif_evidence',
          title: `Close pericope proximity: ${p1.ref} ↔ ${p2.ref}`,
          summary: `Verses ${p1.ref} and ${p2.ref} appear within ${Math.abs(vA - vB)} verse(s) of each other in the same literary context.`,
          source_node_id: `passage:${p1.ref}`,
          target_node_id: `passage:${p2.ref}`,
          passages: [p1, p2],
          original_words: [],
          matched_terms: [p1.ref, p2.ref],
          limitations: ['A four-verse window is a statistical proximity candidate, not a verified pericope boundary or intentional literary relationship.'],
          provenance: {
            source_dataset: 'MACULA Hebrew & Greek',
            source_record_ids: [p1.ref, p2.ref],
            license: 'CC BY 4.0',
            derivation_method: 'pericope_window_intersection',
          },
          score_components: {
            base_tier_score: TIER_BASE_SCORE[4],
            specificity_bonus: 90,
            witness_bonus: 20,
            common_word_penalty: 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: TIER_BASE_SCORE[4] + 110,
          },
        };
      }
    }
  } else if (evidenceId.startsWith('r11:lex:')) {
    const [, , bs, idxStr] = evidenceId.split(':');
    const idx = Number(idxStr);
    if (bs && Number.isInteger(idx) && idx >= 0) {
      targetStrongs.add(bs);
      const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
      const lrel = prof?.lexical_relations?.[idx];
      if (prof && lrel) {
        if (lrel.target_strongs) targetStrongs.add(lrel.target_strongs);
        const targetProf = lrel.target_strongs && lrel.target_strongs !== prof.bs
          ? await readProfile(reader, releaseId, fastManifest, lrel.target_strongs, budget)
          : null;
        const samplePassages: R10PassageRef[] = (prof.clusters?.[0]?.sample_passages || []).slice(0, 3).map((p: any) => ({
          verse_id: p.verse_id,
          ref: p.ref,
          mt_ref: p.mt_ref,
          book: p.book,
          chapter: p.chapter,
          verse: p.verse,
          testament: p.testament,
          snippet: p.snippet,
          is_psalm_heading: p.book === 19 && p.verse === 0,
        }));
        record = buildLexicalRelationRecord({
          evidenceId,
          prof,
          lrel,
          targetProf,
          passages: samplePassages,
          scoreComponents: {
            base_tier_score: TIER_BASE_SCORE[3],
            specificity_bonus: 15,
            witness_bonus: 20,
            common_word_penalty: 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: TIER_BASE_SCORE[3] + 35,
          },
        });
      }
    }
  } else if (evidenceId.startsWith('r11:bridge:')) {
    const [, , bsA, bsB, cwBs] = evidenceId.split(':');
    if (bsA && bsB && cwBs) {
      [bsA, bsB, cwBs].forEach(s => targetStrongs.add(s));
      const [profA, profB, profCw] = await Promise.all([
        readProfile(reader, releaseId, fastManifest, bsA, budget),
        readProfile(reader, releaseId, fastManifest, bsB, budget),
        readProfile(reader, releaseId, fastManifest, cwBs, budget),
      ]);
      if (profA && profB) {
        const mapSamples = (prof: any): R10PassageRef[] =>
          (prof.clusters?.[0]?.sample_passages || []).slice(0, 2).map((p: any) => ({
            verse_id: p.verse_id,
            ref: p.ref,
            mt_ref: p.mt_ref,
            book: p.book,
            chapter: p.chapter,
            verse: p.verse,
            testament: p.testament,
            snippet: p.snippet,
            is_psalm_heading: p.book === 19 && p.verse === 0,
          }));
        record = {
          evidence_id: evidenceId,
          predicate: 'shared_motif',
          evidence_tier: 4,
          epistemic_class: 'shared_motif_evidence',
          title: `Shared collocation bridge: ${profA.sc} (${profA.bs}) ↔ ${profCw?.sc || cwBs} ↔ ${profB.sc} (${profB.bs})`,
          summary: `Both ${profA.sc} ("${profA.gl}", ${profA.bs}) and ${profB.sc} ("${profB.gl}", ${profB.bs}) co-occur with ${profCw ? `${profCw.sc} ("${profCw.gl}", ${profCw.bs})` : cwBs} in scriptural contexts.`,
          source_node_id: `lemma:${profA.bs}`,
          target_node_id: `lemma:${profB.bs}`,
          passages: [...mapSamples(profA), ...mapSamples(profB)],
          original_words: [
            { lemma_key: profA.lk, strongs: profA.bs, language: profA.lang, lemma_script: profA.sc, transliteration: profA.tr, gloss: profA.gl },
            { lemma_key: profB.lk, strongs: profB.bs, language: profB.lang, lemma_script: profB.sc, transliteration: profB.tr, gloss: profB.gl },
          ],
          matched_terms: [profA.gl, profB.gl, profCw?.gl || cwBs].filter(Boolean),
          limitations: ['Indirect collocation bridge through a third term; check individual verse contexts before inferring a thematic link.'],
          provenance: {
            source_dataset: 'MACULA Hebrew & Greek + STEPBible',
            source_record_ids: [profA.bs, cwBs, profB.bs],
            license: 'CC BY 4.0',
            derivation_method: 'shared_collocation_bridge',
          },
            score_components: {
            base_tier_score: TIER_BASE_SCORE[4],
            specificity_bonus: 60,
            witness_bonus: 20,
            common_word_penalty: 0,
            number_coincidence_penalty: 0,
            orthographic_penalty: 0,
            final_score: TIER_BASE_SCORE[4] + 80,
          },
        };
      }
    }
  } else if (evidenceId.startsWith('r13:wp:')) {
    const [, , bs, targetBs] = evidenceId.split(':');
    if (bs && targetBs) {
      targetStrongs.add(bs);
      targetStrongs.add(targetBs);
      const prof = await readProfile(reader, releaseId, fastManifest, bs, budget);
      const wp = (prof?.r13_wordplay || []).find((e: any) => e.target_bs === targetBs);
      if (prof && wp) {
        const wPassages: R10PassageRef[] = [];
        const witnessVidList = [...new Set<number>((wp.witness_vids || []).map((x: unknown) => Number(x)).filter(Boolean))];
        for (const vid of witnessVidList.slice(0, 4)) {
          const hp = await hydratePassageByVid(vid, true);
          if (hp) wPassages.push(hp);
        }
        // E01 completeness fallback: if an adjacent-verse wordplay stored only the first verse, inspect vid + 1 in same book
        if (wPassages.length === 1 && Number(wp.proximity_adjacent_verse || 0) > 0 && witnessVidList[0]) {
          const v0 = witnessVidList[0];
          const bVerses = bookCache.get(wPassages[0].book);
          const v1 = v0 + 1;
          if (bVerses?.[String(v1)]?.toks?.some((t: any) => t?.s === targetBs || t?.s === bs)) {
            const hp1 = await hydratePassageByVid(v1, false);
            if (hp1) wPassages.push(hp1);
          }
        }
        record = buildR13WordplayRecord(prof, wp, wPassages);
      }
    }
  } else if (evidenceId.startsWith('r13:colloc:')) {
    const [, , bs, targetBs] = evidenceId.split(':');
    if (bs && targetBs) {
      targetStrongs.add(bs);
      targetStrongs.add(targetBs);
      const [profA, profB] = await Promise.all([
        readProfile(reader, releaseId, fastManifest, bs, budget),
        readProfile(reader, releaseId, fastManifest, targetBs, budget),
      ]);
      const col = (profA?.r13_colloc || []).find((c: any) => c[0] === targetBs);
      if (profA && col) {
        const [, sharedCount, npmi100, sampleVids] = col;
        const cPassages: R10PassageRef[] = [];
        for (const vid of (sampleVids || []).slice(0, 3)) {
          const hp = await hydratePassageByVid(Number(vid), false);
          if (hp) cPassages.push(hp);
        }
        record = buildR13CollocRecord(profA, targetBs, profB || null, Number(sharedCount || 0), Number(npmi100 || 0), cPassages);
      }
    }
  } else if (evidenceId.startsWith('r13:motif:')) {
    const cleanMotifId = evidenceId.replace(/^r13:motif:r13:motif:/, 'r13:motif:');
    const strippedId = cleanMotifId.slice('r13:motif:'.length);
    const md = await readR10Json<MotifsData>(reader, releaseId, 'motifs-and-patterns.json.gz', budget);
    if (md?.r13_motifs_b64gz) {
      const decodedMotifs = await decodeB64Gz<Record<string, any>>(reader, md.r13_motifs_b64gz, `/r13/motifs:${releaseId}`, budget.b64Cache);
      const m =
        decodedMotifs?.[cleanMotifId] ||
        decodedMotifs?.[strippedId] ||
        decodedMotifs?.[evidenceId] ||
        (Array.isArray(decodedMotifs)
          ? decodedMotifs.find((x: any) => x.motif_id === cleanMotifId || x.motif_id === strippedId || x.motif_id === evidenceId)
          : null);
      if (m) {
        for (const bs of m.nodes || []) targetStrongs.add(bs);
        const mPassages: R10PassageRef[] = [];
        for (const vid of (m.witness_vids || []).slice(0, 4)) {
          const hp = await hydratePassageByVid(Number(vid), false);
          if (hp) mPassages.push(hp);
        }
        record = buildR13MotifRecord(m, mPassages);
      }
    }
  } else if (evidenceId.startsWith('r13:interp:')) {
    const expData = await readR10Json<{ r13_self_interpretations?: SelfInterpretationRecord[] }>(reader, releaseId, 'explicit-and-typology.json.gz', budget);
    const si = (expData?.r13_self_interpretations || []).find((x: SelfInterpretationRecord) => x.id === evidenceId);
    if (si) {
      for (const s of [...si.symbol_strongs, ...si.referent_strongs]) targetStrongs.add(s);
      const siPassages: R10PassageRef[] = [];
      for (const vid of (si.witness_vids?.length ? si.witness_vids : [si.verse_id]).slice(0, 3)) {
        const hp = await hydratePassageByVid(Number(vid), false);
        if (hp) siPassages.push(hp);
      }
      record = buildR13SelfInterpRecord(si, siPassages);
    }
  } else if (evidenceId.startsWith('r13:symchain:')) {
    const seed = evidenceId.slice('r13:symchain:'.length);
    const [prof, expData] = await Promise.all([
      /^[HG]\d+$/.test(seed) ? readProfile(reader, releaseId, fastManifest, seed, budget) : Promise.resolve(null),
      readR10Json<{ r13_self_interpretations?: SelfInterpretationRecord[] }>(reader, releaseId, 'explicit-and-typology.json.gz', budget),
    ]);
    if (prof) {
      targetStrongs.add(prof.bs);
      const wpList = (prof.r13_wordplay || []).slice(0, 5).map((e: any) => ({
        source_bs: prof.bs,
        target_bs: e.target_bs,
        detail: `${e.evidence_type}: ${e.shared_consonants || ''}`,
        witness_refs: (e.witness_refs || []).slice(0, 3),
        score: Number(e.score || 0.5),
      }));
      const cMap = new Map<string, Array<{ target_bs: string; shared_count: number; npmi: number; sample_refs: string[] }>>([
        [prof.bs, (prof.r13_colloc || []).slice(0, 6).map((c: any) => ({
          target_bs: c[0], shared_count: c[1], npmi: c[2] / 100, sample_refs: (c[3] || []).map((v: number) => `Verse ${v}`),
        }))],
      ]);
      const lxMap = new Map<string, string[]>([
        [prof.bs, (prof.lxx_relations || []).map((l: any) => l.target_strongs).filter(Boolean)],
      ]);
      const chains = assembleSymbolicChains({
        seedStrongOrVid: prof.bs,
        wordplayTargets: wpList,
        collocNeighborsByBs: cMap,
        lxxEquivalentsByBs: lxMap,
        selfInterpretations: expData?.r13_self_interpretations || [],
      });
      const ch = chains.find(x => x.chain_id === evidenceId) || chains[0];
      if (ch) {
        const scPassages: R10PassageRef[] = [];
        for (const vid of (prof.first_occ_passages || []).slice(0, 2).map(p => p.verse_id)) {
          const hp = await hydratePassageByVid(vid, false);
          if (hp) scPassages.push(hp);
        }
        record = buildR13SymChainRecord(ch, scPassages);
      }
    }
  } else if (evidenceId.startsWith('r13:beam:')) {
    const nodes = evidenceId.slice('r13:beam:'.length).split('-').filter(Boolean);
    for (const s of nodes) targetStrongs.add(s);
    const profs = (await Promise.all(nodes.slice(0, 4).map(s => readProfile(reader, releaseId, fastManifest, s, budget)))).filter(Boolean) as LemmaProfile[];
    if (profs.length > 0) {
      const rpMap = new Map<string, RuntimeBeamProfile>(profs.map(p => [p.bs, p]));
      const paths = beamSearchMotifPaths({
        startBs: nodes[0],
        targetBs: nodes.length > 1 ? new Set([nodes[nodes.length - 1]]) : undefined,
        profilesByBs: rpMap,
        maxHops: Math.min(3, Math.max(1, nodes.length - 1)),
        beamWidth: 12,
      });
      const hit = paths.find(bp => bp.nodes.join('-') === nodes.join('-')) || paths[0];
      if (hit) {
        const bPassages: R10PassageRef[] = [];
        for (const vid of (hit.witness_vids || []).slice(0, 3)) {
          const hp = await hydratePassageByVid(vid, false);
          if (hp) bPassages.push(hp);
        }
        record = buildR13BeamRecord(hit, bPassages);
      }
    }
  }

  // R12 Pilot Evidence Resolution (`r12:path:...`, `r12:prop:...`, `r12:struct:...`, `r12:orth:...`)
  if (
    evidenceId.startsWith('r12:path:') ||
    evidenceId.startsWith('r12:prop:') ||
    evidenceId.startsWith('r12:struct:') ||
    evidenceId.startsWith('r12:orth:')
  ) {
    const anchorKey = evidenceId.split(':')[2] || '';
    let anchorData: any = null;
    if (fastManifest?.r12_pilot_embedded) {
      if (anchorKey && (fastManifest.r12_pilot_anchors_list || []).includes(anchorKey)) {
        anchorData = (await readProfile(reader, releaseId, fastManifest, anchorKey, budget))?.r12_pilot_anchor ?? null;
      }
    } else {
      const r12Pilot = await readR12Pilot(reader, releaseId, fastManifest, budget);
      anchorData = r12Pilot?.anchors?.[anchorKey];
    }
    if (anchorData) {
      if (evidenceId.startsWith('r12:path:')) {
        const rec = (anchorData.multihop?.recommendations || []).find((r: any) => r.evidence_id === evidenceId);
        if (rec) record = r12MultihopRecToRecord(anchorData, rec);
      } else if (evidenceId.startsWith('r12:prop:')) {
        const prop = (anchorData.property_bridges || []).find((b: any) => b.evidence_id === evidenceId);
        if (prop) record = r12PropertyBridgeToRecord(anchorData, prop);
      } else if (evidenceId.startsWith('r12:struct:')) {
        const st = (anchorData.structural_candidates || []).find((s: any) => s.evidence_id === evidenceId);
        if (st) record = r12StructuralToRecord(anchorData, st);
      } else if (evidenceId.startsWith('r12:orth:')) {
        const orth = (anchorData.orthographic_candidates || []).find((o: any) => o.evidence_id === evidenceId);
        if (orth) record = r12OrthographicToRecord(anchorData, orth);
      }
    }
  }

  // Fallback to explicitData
  if (!record) {
    const explicitData = await readR10Json(reader, releaseId, 'explicit-and-typology.json.gz', budget) as { records: any[] } | null;
    record = (explicitData?.records || []).find((r: any) => r.evidence_id === evidenceId) || null;
  }

  // Support synthesized motif pairs
  if (!record && evidenceId.startsWith('r10:synth:motifpair:')) {
    const parts = evidenceId.split(':');
    const a = parts[3], b = parts[4];
    const motifsData = await readR10Json<MotifsData>(
      reader, releaseId, 'motifs-and-patterns.json.gz', budget
    );
    const motifPairs = motifsData?.motif_pairs ?? (
      motifsData?.motif_pairs_b64gz
        ? await decodeB64Gz<Record<string, any>>(reader, motifsData.motif_pairs_b64gz, `/r10/motif_pairs:${releaseId}`, budget.b64Cache)
        : undefined
    );
    const pair = motifPairs?.[`${a}|${b}`];
    if (pair) {
      const mA = motifsData!.motifs?.[a], mB = motifsData!.motifs?.[b];
      record = {
        evidence_id: evidenceId,
        predicate: 'shared_motif',
        evidence_tier: 5,
        epistemic_class: 'shared_motif_evidence',
        title: `Co-occurring motifs: ${mA?.label || a} + ${mB?.label || b}`,
        summary: `${pair.count} verses contain original-language terms from both motifs.`,
        source_node_id: `motif:${a}`,
        target_node_id: `motif:${b}`,
        passages: pair.passages.slice(0, 6),
        original_words: [...(mA?.original_words || []).slice(0, 3), ...(mB?.original_words || []).slice(0, 3)],
        matched_terms: [a, b],
        limitations: ['Motif co-occurrence does not establish deliberate literary allusion across separate books without contextual or authorial evidence.'],
        provenance: { source_dataset: 'MACULA Hebrew & Greek', source_record_ids: pair.passages.map((p: any) => p.ref), license: 'CC BY 4.0', derivation_method: 'deterministic_verse_motif_intersection' },
        score_components: { base_tier_score: 520, specificity_bonus: 40, witness_bonus: 20, common_word_penalty: 0, number_coincidence_penalty: 0, orthographic_penalty: 0, final_score: 580 },
      };
    }
  } else if (!record && evidenceId.startsWith('r10:synth:num:')) {
    const [, , , valStr, nounS, kind] = evidenceId.split(':');
    const numbersData = await readR10Json<any>(reader, releaseId, 'numbers-index.json.gz', budget);
    const grp = (numbersData?.by_value?.[valStr]?.groups || []).find((g: any) => g.noun_s === nounS && g.kind === kind);
    if (grp) {
      const passages = (grp.samples || []).slice(0, 6).map((s: any) => ({ verse_id: s.vid, ref: s.ref, book: s.book, chapter: s.ch, verse: s.vs, testament: s.book <= 39 ? 'OT' : 'NT' as const }));
      record = {
        evidence_id: evidenceId,
        predicate: 'numbered_entity',
        evidence_tier: grp.kind === 'symbolic_vision_count' ? 4 : 6,
        epistemic_class: 'direct_textual_evidence',
        title: `Counted entity: ${valStr} × ${grp.noun_lm} ("${grp.noun_g}")`,
        summary: `Appears ${grp.count} times across Scripture as ${grp.kind.replace(/_/g, ' ')}.`,
        source_node_id: `number:${valStr}`,
        target_node_id: `lemma:${nounS}`,
        passages,
        original_words: [],
        matched_terms: [valStr, grp.noun_g],
        number_classification: { number_value: Number(valStr), counted_entity: `${grp.noun_lm} (${grp.noun_g})`, kind: grp.kind, coincidence_risk: grp.count > 25 ? 'high' : 'low', note: 'Syntactic numeral-noun extraction' },
        limitations: ['Numeral frequency alone does not establish theological equivalence across unrelated books.'],
        provenance: { source_dataset: 'MACULA numerals', source_record_ids: passages.map((p: any) => p.ref), license: 'CC BY 4.0', derivation_method: 'syntactic_numeral_noun_extraction' },
        score_components: { base_tier_score: 650, specificity_bonus: 20, witness_bonus: 20, common_word_penalty: 0, number_coincidence_penalty: 0, orthographic_penalty: 0, final_score: 690 },
      };
    }
  }

  if (!record) {
    return { schema_version: 1, status: 'not_found', release_id: releaseId, evidence_release_id: releaseId, evidence: null, passage_details: [],
      coverage: { state: budget.used >= budget.max ? 'resource_limits_reached' : budget.missing.length ? 'missing_source_coverage' : 'available', missing_assets: budget.missing } };
  }

  for (const ow of record.original_words || []) {
    if (ow.strongs) targetStrongs.add(ow.strongs);
  }

  const booksNeeded = [...new Set((record.passages || []).map(p => p.book).filter(b => b > 0))].slice(0, MAX_EVIDENCE_BOOKS);
  if (fastManifest) {
    for (const p of record.passages.slice(0, 6)) {
      let vid = p.verse_id || 0;
      if (!vid && fastManifest.selective && p.book > 0) {
        vid = Number(await readSelectiveKey(reader, releaseId, 'refs', `${p.book}:${p.chapter}:${p.verse}`, budget));
      } else if (!vid && fastManifest.direct_b64gz && p.book > 0) {
        const pad = String(p.book).padStart(2, '0');
        const idx = await readR10Json<any>(reader, releaseId, `evidence-passages/book-${pad}.json.gz`, budget);
        vid = Number(idx?.coord_to_vid?.[`${p.chapter}:${p.verse}`] || 0);
      }
      if (vid) await hydratePassageByVid(vid, true);
    }
  } else {
    await Promise.all(booksNeeded.map(async b => { await loadBookData(b); }));
  }

  const passageDetails = (record.passages || []).slice(0, 6).map(p => {
    const bVerses = bookCache.get(p.book);
    const vData = (p.verse_id ? bVerses?.[String(p.verse_id)] : null) ||
      Object.values(bVerses || {}).find((v: any) => v.chapter === p.chapter && v.verse === p.verse);
    const tokens = (vData?.toks || []).map((t: any) => ({
      ...(t.wid !== undefined ? { word_id: Number(t.wid) } : {}),
      word_no: t.wn,
      surface: t.sf,
      lemma: t.lm,
      ...(t.lk ? { lemma_key: t.lk } : {}),
      strongs: t.s,
      gloss: t.g,
      grammar: t.cl || undefined,
      is_highlighted: targetStrongs.has(t.s) || (Array.isArray(t.all_s) && t.all_s.some((s: string) => targetStrongs.has(s))),
    }));
    return {
      passage: {
        ...p,
        mt_ref: vData?.mt_ref ?? p.mt_ref,
        is_psalm_heading: p.book === 19 && (p.verse === 0 || vData?.verse === 0),
      },
      english_text: vData?.en || p.snippet || null,
      english_edition: vData?.en ? 'World English Bible (Public Domain)' : null,
      original_tokens: tokens,
    };
  });

  return {
    schema_version: 1,
    status: 'ok',
    release_id: releaseId,
    evidence_release_id: releaseId,
    evidence: record,
    passage_details: passageDetails,
    coverage: { state: budget.used >= budget.max ? 'resource_limits_reached' : budget.missing.length ? 'missing_source_coverage' : 'available', missing_assets: budget.missing },
    notes_overlay_hint: {
      has_interpretive_layer: false,
      separation_notice: 'Source textual evidence is strictly separated from unreviewed DLM or personal research notes.',
    },
  };
}

export async function expandBiblicalConnection(
  reader: AssetReader,
  nodeId: string,
  options: { limit?: number; cursor?: string | null; release_id?: string } = {}
): Promise<ExpandConnectionResult> {
  const releaseId = options.release_id || DEFAULT_R10_RELEASE;
  let seedQuery = nodeId
    .replace(/^(motif:|lemma:|passage:|event:|concept:|number:|cluster:)/, '')
    .replace(/_/g, ' ');

  let clusterId: string | undefined;
  let focusLemma: string | undefined;

  if (nodeId.startsWith('cluster:')) {
    clusterId = nodeId.replace(/^cluster:/, '');
    focusLemma = clusterId.split(':')[0];
    seedQuery = focusLemma;
  } else if (nodeId.startsWith('lemma:')) {
    focusLemma = nodeId.replace(/^lemma:/, '');
    seedQuery = focusLemma;
  } else if (nodeId.startsWith('sense:')) {
    const rawSense = nodeId.replace(/^sense:/, '');
    const m = /^([HG]\d+)/i.exec(rawSense);
    if (m) {
      focusLemma = m[1].toUpperCase();
      seedQuery = focusLemma;
    }
  } else if (
    nodeId.startsWith('ext:wd:') ||
    nodeId.startsWith('ext:oewn:') ||
    nodeId.startsWith('wd:') ||
    nodeId.startsWith('oewn:')
  ) {
    const extTarget = nodeId.replace(/^ext:/, '');
    const r12Budget: ReadBudget = { used: 0, max: 10, missing: [] };
    const manifest = await readR10Json<FastManifest>(reader, releaseId, 'fast-manifest.json.gz', r12Budget);
    const externalMappings = manifest?.r12_external_mappings
      ?? (await readR12Pilot(reader, releaseId, manifest, r12Budget))?.external_mappings;
    if (externalMappings) {
      const mappedAnchors = externalMappings
        .filter((m: any) => m.wikidata_id === extTarget || m.oewn_id === extTarget)
        .map((m: any) => String(m.anchor_id || '').replace(/^lemma:/, ''))
        .filter(Boolean);
      if (mappedAnchors.length > 0) {
        focusLemma = mappedAnchors[0];
        seedQuery = mappedAnchors.join(' ');
      }
    }
  } else if (nodeId.startsWith('r12:prop:') || nodeId.startsWith('r12:path:')) {
    const parts = nodeId.split(':');
    if (parts[3] && /^[HG]\d+$/i.test(parts[3])) {
      focusLemma = parts[3];
      seedQuery = parts[3];
    } else if (parts[2]) {
      focusLemma = parts[2];
      seedQuery = parts[2];
    }
  }

  const discovery = await discoverBiblicalConnections(reader, {
    query: seedQuery,
    mode: 'expand',
    cluster_id: clusterId,
    focus_lemma: focusLemma,
    limit: options.limit ?? 8,
    cursor: options.cursor ?? null,
    release_id: releaseId,
  }, releaseId);

  const centerNode: R10Node = {
    id: nodeId,
    kind: nodeId.startsWith('motif:') ? 'motif' : nodeId.startsWith('lemma:') ? 'lemma' : nodeId.startsWith('passage:') ? 'passage' : 'concept',
    label: seedQuery,
    epistemic_class: 'direct_textual_evidence',
    grounding_source: 'R11 index expansion',
  };

  return {
    schema_version: 1,
    status: discovery.strongest_connections.length > 0 ? 'ok' : 'not_found',
    release_id: releaseId,
    evidence_release_id: releaseId,
    center_node: centerNode,
    connections: discovery.strongest_connections,
    controls: discovery.controls_and_alternatives,
    pagination: {
      returned: discovery.pagination.returned,
      next_cursor: discovery.pagination.next_cursor,
      has_more: discovery.pagination.has_more,
    },
  };
}
