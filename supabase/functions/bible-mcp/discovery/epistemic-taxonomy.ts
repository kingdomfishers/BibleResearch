// @file: src/relationships/epistemic-taxonomy.ts
// Canonical epistemic taxonomy, LXX function-word filter, and bridge specificity helpers.
// Pure TypeScript shared across Browser, Cloudflare Worker, Deno Edge (bible-mcp), and Node scripts.

export type CanonicalEpistemicClass =
  | 'direct_textual_evidence'
  | 'authorial_typology_or_quote'
  | 'documented_lexical_relationship'
  | 'documented_collocation_or_cooccurrence'
  | 'documented_cross_language_bridge'
  | 'translation_correspondence'
  | 'grammatical_observation'
  | 'observed_textual_count'
  | 'verified_cross_reference'
  | 'editorial_cross_reference'
  | 'shared_motif_evidence'
  | 'statistical_association'
  | 'candidate_literary_pattern'
  | 'orthographic_similarity_only'
  | 'semantic_hypothesis'
  | 'external_world_fact'
  | 'user_note';

const LEGACY_EPISTEMIC_MAP: Readonly<Record<string, CanonicalEpistemicClass>> = {
  exploratory_hypothesis: 'semantic_hypothesis',
  interpretive_hypothesis: 'semantic_hypothesis',
  multi_hop_research_path: 'semantic_hypothesis',
  explicit_intertextual_witness: 'authorial_typology_or_quote',
  candidate_textual_evidence: 'candidate_literary_pattern',
  external_world_bridge: 'external_world_fact',
  explicit_biblical_interpretation: 'direct_textual_evidence',
  structural_analogy: 'shared_motif_evidence',
  explicit_correlative_analogy: 'authorial_typology_or_quote',
};

const VALID_CANONICAL_SET = new Set<string>([
  'direct_textual_evidence',
  'authorial_typology_or_quote',
  'documented_lexical_relationship',
  'documented_collocation_or_cooccurrence',
  'documented_cross_language_bridge',
  'translation_correspondence',
  'grammatical_observation',
  'observed_textual_count',
  'verified_cross_reference',
  'editorial_cross_reference',
  'shared_motif_evidence',
  'statistical_association',
  'candidate_literary_pattern',
  'orthographic_similarity_only',
  'semantic_hypothesis',
  'external_world_fact',
  'user_note',
]);

/** Normalize legacy or subsystem-specific epistemic labels onto CanonicalEpistemicClass. */
export function normalizeEpistemicClass(
  raw?: string | null,
  fallback: CanonicalEpistemicClass = 'semantic_hypothesis',
  evidenceType?: string | null,
): CanonicalEpistemicClass {
  const s = String(raw || '').trim();
  if (!s) return fallback;
  if (s === 'attested_textual_wordplay') {
    return evidenceType === 'attested_textual_wordplay'
      ? 'direct_textual_evidence'
      : 'candidate_literary_pattern';
  }
  if (LEGACY_EPISTEMIC_MAP[s]) return LEGACY_EPISTEMIC_MAP[s];
  if (VALID_CANONICAL_SET.has(s)) return s as CanonicalEpistemicClass;
  return fallback;
}

export const EPISTEMIC_STRENGTH_RANK: Readonly<Record<CanonicalEpistemicClass, number>> = {
  direct_textual_evidence: 100,
  authorial_typology_or_quote: 96,
  verified_cross_reference: 90,
  documented_lexical_relationship: 84,
  documented_cross_language_bridge: 80,
  translation_correspondence: 78,
  grammatical_observation: 74,
  observed_textual_count: 72,
  documented_collocation_or_cooccurrence: 66,
  shared_motif_evidence: 64,
  statistical_association: 56,
  editorial_cross_reference: 48,
  candidate_literary_pattern: 44,
  orthographic_similarity_only: 30,
  semantic_hypothesis: 24,
  external_world_fact: 20,
  user_note: 50,
};

/** True only for evidentially grounded textual/lexical/translation classes (excludes editorial xrefs, pure orthography, external world, hypotheses). */
export function isVerifiedTextualProofEpistemic(
  rawClass?: string | null,
  evidenceType?: string | null,
): boolean {
  const cls = normalizeEpistemicClass(rawClass, 'semantic_hypothesis', evidenceType);
  return (
    cls === 'direct_textual_evidence' ||
    cls === 'authorial_typology_or_quote' ||
    cls === 'verified_cross_reference' ||
    cls === 'documented_lexical_relationship' ||
    cls === 'documented_cross_language_bridge' ||
    cls === 'translation_correspondence' ||
    cls === 'grammatical_observation'
  );
}

/** Canonical Greek function-word Strong's (article G3588, particles, conjunctions, prepositions, pronouns, copula). */
export const GREEK_LXX_FUNCTION_STRONGS = new Set<string>([
  'G3588', 'G2532', 'G1161', 'G1722', 'G1519', 'G0846', 'G3739', 'G3778',
  'G1473', 'G4771', 'G1537', 'G0575', 'G1909', 'G4314', 'G1223', 'G3326',
  'G5259', 'G3844', 'G4012', 'G3754', 'G3756', 'G3361', 'G1063', 'G0235',
  'G2228', 'G1487', 'G5613', 'G2531', 'G1510', 'G5100', 'G5101', 'G3767',
  'G5037', 'G0302', 'G2443', 'G1437', 'G2596', 'G5228', 'G4253', 'G1438',
  'G3761', 'G3762', 'G3362', 'G3748', 'G3745', 'G1565', 'G5124', 'G3779',
]);

export const HEBREW_LXX_FUNCTION_STRONGS = new Set<string>([
  'H0834', 'H0853', 'H0854', 'H0413', 'H4480', 'H5921', 'H3588', 'H0518',
  'H3808', 'H0408', 'H1931', 'H0859', 'H0589', 'H0595', 'H2088', 'H2063',
  'H0428', 'H3605', 'H3541', 'H3651', 'H1571', 'H0369',
]);

export const GREEK_LXX_STOP_LEMMAS = new Set<string>([
  'ὁ', 'καί', 'δέ', 'ἐν', 'εἰς', 'αὐτός', 'ὅς', 'οὗτος', 'ἐγώ', 'σύ',
  'ἐκ', 'ἀπό', 'ἐπί', 'πρός', 'διά', 'μετά', 'ὑπό', 'παρά', 'περί', 'ὅτι',
  'οὐ', 'μή', 'γάρ', 'ἀλλά', 'ἤ', 'εἰ', 'ὡς', 'καθώς', 'εἰμί', 'τίς',
  'τις', 'οὖν', 'τέ', 'ἄν', 'ἵνα', 'ἐάν', 'κατά', 'ὑπέρ', 'ἑαυτοῦ',
  'οὐδέ', 'οὐδείς', 'μηδείς', 'ὅστις', 'ἐκεῖνος', 'οὕτως', 'πᾶς',
]);

function stripGreekDiacriticsLower(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .trim();
}

const GREEK_LXX_STOP_LEMMAS_PLAIN = new Set<string>(
  [...GREEK_LXX_STOP_LEMMAS].map(stripGreekDiacriticsLower),
);

function padStrongsKey(raw?: string | null): string {
  const m = /^([HG])0*(\d+)/i.exec(String(raw || '').trim());
  return m ? `${m[1].toUpperCase()}${m[2].padStart(4, '0')}` : '';
}

/** True when a target Strong's or Greek lemma is an article/particle/preposition/pronoun/copula noise equivalent. */
export function isLxxFunctionEquivalent(
  strongs?: string | null,
  lemma?: string | null,
): boolean {
  const s = padStrongsKey(strongs);
  if (s && (GREEK_LXX_FUNCTION_STRONGS.has(s) || HEBREW_LXX_FUNCTION_STRONGS.has(s) || /^H90\d{2}$/.test(s))) {
    return true;
  }
  if (lemma) {
    const first = String(lemma).split(/[,;/\s]+/)[0] || '';
    const plain = stripGreekDiacriticsLower(first);
    if (plain && GREEK_LXX_STOP_LEMMAS_PLAIN.has(plain)) return true;
  }
  return false;
}

/** High-frequency personal/covenant/theophoric names & generic hubs that should not outrank rare concrete lexical/typological correspondences. */
export const HIGH_DF_PROPER_NAME_HUBS = new Set<string>([
  'H4872', 'G3475', // Moses / Μωϋσῆς
  'H3478', 'G2474', // Israel
  'H1732', 'G1138', // David
  'H0085', 'G0011', // Abraham
  'H3290', 'G2384', // Jacob
  'H3063', 'G2455', // Judah
  'H3389', 'G2419', // Jerusalem
  'H4714', 'G0125', // Egypt
  'H3068', 'H0430', 'G2316', 'G2962', 'G2424', 'G5547',
  'H1121', 'H0376', 'H0120', 'H5971', 'H3117', 'H0776', 'H4428',
  'G0444', 'G1093', 'G3956', 'G5207', 'G2250',
]);

/** Specificity bonus used to rank rarer concrete lexical/typological bridges above shared high-DF names like Moses. */
export function computeBridgeSpecificityBonus(
  tvA?: number | null,
  tvB?: number | null,
  bsA?: string | null,
  bsB?: string | null,
  entityKindA?: string | null,
  entityKindB?: string | null,
): number {
  const maxTv = Math.max(1, Number(tvA || 0), Number(tvB || 0));
  const idf = Math.max(0, Math.min(12, Math.log2(31102 / maxTv)));
  const kA = padStrongsKey(bsA);
  const kB = padStrongsKey(bsB);
  const isProperHub =
    (kA && HIGH_DF_PROPER_NAME_HUBS.has(kA)) ||
    (kB && HIGH_DF_PROPER_NAME_HUBS.has(kB)) ||
    ((entityKindA === 'person' || entityKindB === 'person') && maxTv >= 60);
  return Math.round((idf * 4 - (isProperHub ? 28 : 0)) * 100) / 100;
}
