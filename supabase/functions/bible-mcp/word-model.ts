// Pure Web/Deno TypeScript module: shared compact word, connection, geography,
// chronology, etymology, and real-world builders for bible-mcp tools.
// Zero Node-only imports; all relative imports include .ts extensions.

import type { DatabaseQuery, DatabaseReader } from './catalog.ts';
import type { GematriaResult } from './gematria.ts';

export interface CompactConnection {
  id: string;
  relation: string;
  epistemic: string;
  evidence_type?: string;
  tier?: number;
  title: string;
  why: string;
  refs: string[];
  matched_endpoints?: string[];
  target?: {
    strongs?: string;
    script?: string;
    transliteration?: string;
    gloss?: string;
  };
  witness?: string;
  uncertainty?: string;
  score_breakdown?: Record<string, unknown>;
}

export interface CompactWord {
  form?: string;
  lemma: string;
  strongs: string;
  lemma_key?: string;
  sense_status?: string;
  lemma_candidates?: string[];
  transliteration: string;
  gloss: string;
  senses?: Array<{ key?: string; gloss: string; note?: string }>;
  grammar?: string;
  pos?: string;
  total_verses?: number;
  lxx?: Array<{ strongs?: string; script: string; gloss: string; count?: number; direction?: string }>;
  etymology?: {
    status: 'documented' | 'unavailable';
    lemma_key?: string;
    other_homograph_roots?: Array<Record<string, unknown>>;
    morphological_components?: Array<Record<string, unknown>>;
    roots?: Array<Record<string, unknown>>;
    formations?: Array<Record<string, unknown>>;
    relatives?: Array<Record<string, unknown>>;
    spelling_suggestions?: Array<{
      strongs: string;
      script: string;
      transliteration?: string;
      gloss: string;
      shared?: string;
      note: string;
    }>;
    note: string;
  };
  gematria?: GematriaResult;
  notes?: Array<Record<string, unknown>>;
  connections?: CompactConnection[];
  realworld?: Record<string, unknown>;
  occurrences_sample?: Array<{ ref: string; snippet?: string }>;
  ambiguous_candidates?: Array<Record<string, unknown>>;
}

export interface CompactWordOptions {
  token?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  wordRow?: Record<string, unknown> | null;
  etymology?: CompactWord['etymology'] | null;
  realworld?: Record<string, unknown> | null;
  notes?: Array<Record<string, unknown>> | null;
  connections?: CompactConnection[] | null;
  gematria?: GematriaResult | null;
  occurrences_sample?: Array<{ ref: string; snippet?: string }> | null;
  ambiguous_candidates?: Array<Record<string, unknown>> | null;
  etymologyDepth?: number;
  realworldDepth?: number;
  wordDepth?: number;
}

export interface CompactGeoPlace {
  place: string;
  modern: string | null;
  relation: string;
  lat: number | null;
  lon: number | null;
  confidence: string | number | null;
  evidence_ref: string | null;
  note: string;
  alternatives?: Array<Record<string, unknown>>;
}

export interface CompactGeographyResult {
  status: 'ok' | 'symbolic_or_unresolved';
  places: CompactGeoPlace[];
  note?: string;
}

export interface CompactChronologyPrimary {
  date: string;
  what_was_dated: string;
  model: string;
  uncertainty: string;
}

export interface CompactChronologyModelEntry {
  model: string;
  date: string;
  what_was_dated: string;
  note?: string;
}

export interface CompactChronologyResult {
  status: 'ok' | 'unresolved';
  primary: CompactChronologyPrimary | null;
  competing_models: CompactChronologyModelEntry[];
}

const FUNCTION_POS_TAGS = new Set([
  'conjunction',
  'conj',
  'cj',
  'preposition',
  'prep',
  'article',
  'art',
  'definite_article',
  'particle',
  'ptcl',
  'part',
  'pronoun',
  'pron',
  'pronominal',
  'adverb',
  'adv',
  'relative',
  'rel',
  'object_marker',
  'om',
  'interjection',
  'intj',
  'determiner',
  'det',
  'prefix',
  'suffix',
]);

const FUNCTION_STRONGS = new Set([
  'H0853',
  'H853',
  'G3588',
  'G2532',
  'G1161',
  'G0846',
  'G846',
]);

const SUPPRESSED_EDGE_RELATIONS = new Set([
  'conjunction',
  'article',
  'preposition',
  'particle',
  'pronoun',
  'grammatical_particle',
  'function_word',
]);

const HEBREW_TRANSLIT_MAP: Readonly<Record<string, string>> = {
  'א': "'",
  'ב': 'b',
  'ג': 'g',
  'ד': 'd',
  'ה': 'h',
  'ו': 'w',
  'ז': 'z',
  'ח': 'ch',
  'ט': 't',
  'י': 'y',
  'כ': 'k',
  'ך': 'k',
  'ל': 'l',
  'מ': 'm',
  'ם': 'm',
  'נ': 'n',
  'ן': 'n',
  'ס': 's',
  'ע': '`',
  'פ': 'p',
  'ף': 'p',
  'צ': 'ts',
  'ץ': 'ts',
  'ק': 'q',
  'ר': 'r',
  'ש': 'sh',
  'ת': 't',
};

const GREEK_TRANSLIT_MAP: Readonly<Record<string, string>> = {
  'α': 'a',
  'β': 'b',
  'γ': 'g',
  'δ': 'd',
  'ε': 'e',
  'ζ': 'z',
  'η': 'e',
  'θ': 'th',
  'ι': 'i',
  'κ': 'k',
  'λ': 'l',
  'μ': 'm',
  'ν': 'n',
  'ξ': 'x',
  'ο': 'o',
  'π': 'p',
  'ρ': 'r',
  'σ': 's',
  'ς': 's',
  'τ': 't',
  'υ': 'u',
  'φ': 'ph',
  'χ': 'ch',
  'ψ': 'ps',
  'ω': 'o',
};

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function asArray(val: unknown): unknown[] {
  return Array.isArray(val) ? val : [];
}

function firstNonEmpty(...vals: unknown[]): string {
  for (const val of vals) {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed && trimmed !== 'null' && trimmed !== 'undefined') return trimmed;
    }
  }
  return '';
}

function normalizeText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  const collapsed = val.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

function normalizeStrongs(val: unknown): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim().toUpperCase();
  return trimmed;
}

async function callRpc(
  read: DatabaseReader,
  name: string,
  args: Record<string, unknown>,
  limit = 20,
  offset = 0,
): Promise<Record<string, unknown>[]> {
  const res = await read({
    name: name as DatabaseQuery['name'],
    args,
    limit,
    offset,
  });
  return Array.isArray(res.rows) ? res.rows : [];
}

/**
 * Identify grammatical function words (particles, articles, pronouns, conjunctions,
 * prepositions, Hebrew object-marker H0853, H900* prefixes) while preserving real
 * content words such as YHWH (H3068).
 */
export function isFunctionWord(tok: { pos_class?: string; strongs?: string }): boolean {
  const strongs = normalizeStrongs(tok.strongs);
  if (strongs === 'H3068') return false;
  if (strongs) {
    if (FUNCTION_STRONGS.has(strongs) || /^H900\d*$/i.test(strongs)) {
      return true;
    }
  }

  const posRaw = typeof tok.pos_class === 'string' ? tok.pos_class.toLowerCase().trim() : '';
  if (!posRaw) return false;
  if (FUNCTION_POS_TAGS.has(posRaw)) return true;

  const parts = posRaw.split(/[\s,;|/]+/);
  return parts.some((part) => FUNCTION_POS_TAGS.has(part));
}

/**
 * Return a clean trimmed transliteration, falling back to basic script
 * transliteration when raw transliteration is empty and fallbackScript exists.
 */
export function cleanTransliteration(raw?: string | null, fallbackScript?: string): string {
  const cleaned = typeof raw === 'string'
    ? raw.replace(/\s+/g, ' ').trim()
    : '';
  if (cleaned && cleaned !== '-' && cleaned.toLowerCase() !== 'null' && cleaned.toLowerCase() !== 'undefined') {
    return cleaned;
  }

  const fallback = typeof fallbackScript === 'string' ? fallbackScript.trim() : '';
  if (!fallback) return '';

  const stripped = fallback.normalize('NFKD').replace(/[\u0591-\u05C7\u0300-\u036F]/g, '').toLowerCase();
  let out = '';
  for (const ch of stripped) {
    if (HEBREW_TRANSLIT_MAP[ch]) {
      out += HEBREW_TRANSLIT_MAP[ch];
    } else if (GREEK_TRANSLIT_MAP[ch]) {
      out += GREEK_TRANSLIT_MAP[ch];
    } else if (/[a-z0-9'\-\s]/i.test(ch)) {
      out += ch;
    }
  }
  const translit = out.replace(/\s+/g, ' ').trim();
  return translit || fallback;
}

function compactSenses(
  raw: unknown,
  homographSiblings?: unknown,
  baseStrongs?: string,
): CompactWord['senses'] | undefined {
  const items = asArray(raw);
  const result: NonNullable<CompactWord['senses']> = [];
  const seen = new Set<string>();
  const push = (entry: { key?: string; gloss: string; note?: string }) => {
    const dedupe = (entry.key || entry.gloss).toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    result.push(entry);
  };
  for (const item of items) {
    if (typeof item === 'string') {
      const gloss = normalizeText(item, 140);
      if (gloss) push({ gloss });
      continue;
    }
    const obj = asRecord(item);
    if (!obj) continue;
    const gloss = normalizeText(firstNonEmpty(obj.gloss, obj.gl, obj.short_gloss, obj.definition, obj.label, obj.text), 140);
    if (!gloss) continue;
    const key = firstNonEmpty(obj.key, obj.sense_key, obj.id, obj.lemma_key);
    const note = normalizeText(firstNonEmpty(obj.note, obj.domain, obj.usage), 120);
    push({
      ...(key ? { key } : {}),
      gloss,
      ...(note ? { note } : {}),
    });
  }
  // Other homograph lemmas sharing the same Strong's number are distinct words with their own sense.
  const base = normalizeStrongs(baseStrongs);
  if (base) {
    for (const rawSib of asArray(homographSiblings)) {
      const sib = asRecord(rawSib);
      if (!sib || normalizeStrongs(sib.bs) !== base) continue;
      const gloss = normalizeText(firstNonEmpty(sib.gl, sib.gloss), 140);
      const key = firstNonEmpty(sib.lk, sib.lemma_key);
      if (!gloss) continue;
      push({ ...(key ? { key } : {}), gloss, note: 'Separate homograph lemma under the same Strong\'s number' });
    }
  }
  return result.length > 0 ? result : undefined;
}

function compactLxx(raw: unknown, sourceStrongs?: string): CompactWord['lxx'] | undefined {
  const items = asArray(raw);
  if (items.length === 0) return undefined;
  const result: NonNullable<CompactWord['lxx']> = [];
  const byTarget = new Map<string, number>();
  const src = normalizeStrongs(sourceStrongs);
  for (const item of items) {
    const obj = asRecord(item);
    if (!obj) continue;
    const script = firstNonEmpty(obj.script, obj.greek, obj.hebrew, obj.lemma, obj.word, obj.text);
    const gloss = normalizeText(firstNonEmpty(obj.gloss, obj.english, obj.meaning), 100);
    if (!script && !gloss) continue;
    const strongs = normalizeStrongs(firstNonEmpty(obj.strongs, obj.target_strongs, obj.greek_strongs))
      .replace(/^([HG])0*(\d+)([A-Z]*)$/, (_, language: string, digits: string, suffix: string) =>
        `${language}${digits.padStart(4, '0')}${suffix}`);
    const count = typeof obj.count === 'number' && Number.isFinite(obj.count)
      ? obj.count
      : typeof obj.occurrences === 'number' && Number.isFinite(obj.occurrences)
        ? obj.occurrences
        : undefined;
    // The same target is often listed by two evidence sources (alignment bridge + Swete witness): merge, keep max count.
    const targetKey = strongs || script;
    const existingIdx = targetKey ? byTarget.get(targetKey) : undefined;
    if (existingIdx !== undefined) {
      const prev = result[existingIdx];
      if (count !== undefined && (prev.count === undefined || count > prev.count)) prev.count = count;
      if (!prev.script && script) prev.script = script;
      if (!prev.gloss && gloss) prev.gloss = gloss;
      continue;
    }
    const direction = src && strongs
      ? (src.startsWith('G') && strongs.startsWith('H')
        ? 'hebrew_source_rendered_by_this_greek'
        : src.startsWith('H') && strongs.startsWith('G')
          ? 'greek_rendering_of_this_hebrew'
          : undefined)
      : undefined;
    if (targetKey) byTarget.set(targetKey, result.length);
    result.push({
      ...(strongs ? { strongs } : {}),
      script,
      gloss,
      ...(count !== undefined ? { count } : {}),
      ...(direction ? { direction } : {}),
    });
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Assemble a compact word payload from token, profile, lexicon row, and optional
 * enrichment layers, omitting empty optional arrays and unrequested sections.
 */
export function compactWordFromData(opts: CompactWordOptions): CompactWord {
  const token = opts.token ?? null;
  const profile = opts.profile ?? null;
  const wordRow = opts.wordRow ?? null;
  const tokenLemmaKey = firstNonEmpty(token?.lemma_key);
  const profileLemmaKey = firstNonEmpty(profile?.lemma_key, profile?.lk);
  const matchingProfile = !tokenLemmaKey || !profileLemmaKey || tokenLemmaKey === profileLemmaKey;
  const lemma = firstNonEmpty(
    token?.lemma,
    token?.lexical_form,
    matchingProfile ? profile?.lemma : '',
    matchingProfile ? profile?.sc : '',
    wordRow?.lemma,
  );
  // Anchored mode: the caller selected one source token, so form/grammar/gloss describe that occurrence.
  // Lemma mode: describe the lexeme only; never borrow an arbitrary inflected sample as if it were this word.
  const anchored = token !== null;
  const form = anchored
    ? firstNonEmpty(token?.text, token?.surface, token?.form, token?.word)
    : '';
  const strongs = normalizeStrongs(
    firstNonEmpty(
      token?.strongs,
      profile?.strongs,
      profile?.bs,
      wordRow?.strongs,
      wordRow?.strongs_nr,
      profile?.strongs_id,
    ),
  );
  const lemmaKey = anchored
    ? tokenLemmaKey
    : firstNonEmpty(profile?.lemma_key, profile?.lk, wordRow?.lemma_key);
  const transliteration = cleanTransliteration(
    anchored
      ? firstNonEmpty(token?.transliteration, token?.tr)
      : firstNonEmpty(profile?.transliteration, profile?.tr),
    anchored ? form : lemma,
  );
  const engArr = anchored ? asArray(wordRow?.english_translations).filter((x): x is string => typeof x === 'string') : [];
  const gloss = normalizeText(
    anchored
      ? firstNonEmpty(token?.gloss, profile?.gloss, profile?.gl, engArr[0])
      : firstNonEmpty(profile?.gloss, profile?.gl, wordRow?.short_gloss, wordRow?.definition),
    180,
  );
  const grammar = anchored
    ? firstNonEmpty(token?.grammar, token?.code, token?.morph_desc, token?.morphology, token?.morph)
    : '';
  const pos = firstNonEmpty(token?.pos_class, token?.pos, profile?.pos_class, profile?.pos, wordRow?.pos);
  const rawTotalVerses = profile?.total_verses ?? profile?.verse_count ?? wordRow?.total_verses;
  const totalVerses = typeof rawTotalVerses === 'number' && Number.isFinite(rawTotalVerses)
    ? rawTotalVerses
    : undefined;

  const senses = compactSenses(profile?.senses ?? wordRow?.senses, profile?.homograph_siblings, strongs);
  const lxx = compactLxx(profile?.lxx ?? profile?.lxx_relations ?? profile?.lxx_equivalents ?? wordRow?.lxx, strongs);
  const senseStatus = firstNonEmpty(token?.sense_status, profile?.sense_status);
  const lemmaCandidates = asArray(token?.lemma_candidates)
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);

  const out: CompactWord = {
    ...(form ? { form } : {}),
    lemma,
    strongs,
    ...(lemmaKey ? { lemma_key: lemmaKey } : {}),
    ...(senseStatus ? { sense_status: senseStatus } : {}),
    ...(lemmaCandidates.length > 0 ? { lemma_candidates: lemmaCandidates } : {}),
    transliteration,
    gloss,
    ...(senses ? { senses } : {}),
    ...(grammar ? { grammar } : {}),
    ...(pos ? { pos } : {}),
    ...(totalVerses !== undefined ? { total_verses: totalVerses } : {}),
    ...(lxx ? { lxx } : {}),
  };

  if (opts.etymologyDepth !== 0 && opts.etymology) {
    out.etymology = opts.etymology;
  }
  if (opts.gematria) {
    out.gematria = opts.gematria;
  }
  if (opts.notes && opts.notes.length > 0) {
    out.notes = opts.notes;
  }
  if (opts.wordDepth !== 0 && opts.connections && opts.connections.length > 0) {
    out.connections = opts.connections;
  }
  if (opts.realworldDepth !== 0 && opts.realworld) {
    out.realworld = opts.realworld;
  }
  if (opts.occurrences_sample && opts.occurrences_sample.length > 0) {
    out.occurrences_sample = opts.occurrences_sample;
  }
  if (opts.ambiguous_candidates && opts.ambiguous_candidates.length > 0) {
    out.ambiguous_candidates = opts.ambiguous_candidates;
  }

  return out;
}

function extractRefStrings(rawConn: Record<string, unknown>): string[] {
  const candidates: unknown[] = [];
  for (const key of ['refs', 'passages', 'verse_refs', 'citations', 'verses', 'anchors', 'supporting_refs']) {
    if (Array.isArray(rawConn[key])) {
      candidates.push(...(rawConn[key] as unknown[]));
    }
  }
  if (typeof rawConn.ref === 'string') candidates.push(rawConn.ref);
  if (typeof rawConn.verse_ref === 'string') candidates.push(rawConn.verse_ref);

  const refs: string[] = [];
  const seen = new Set<string>();
  for (const item of candidates) {
    let ref = '';
    if (typeof item === 'string') {
      ref = item.trim();
    } else {
      const obj = asRecord(item);
      if (obj) {
        ref = firstNonEmpty(obj.ref, obj.reference, obj.verse_ref, obj.citation, obj.label);
      }
    }
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
      if (refs.length >= 4) break;
    }
  }
  return refs;
}

function extractWitnessSnippet(rawConn: Record<string, unknown>): string | undefined {
  const direct = firstNonEmpty(
    rawConn.witness,
    rawConn.witness_snippet,
    rawConn.snippet,
    rawConn.quote,
  );
  if (direct) return normalizeText(direct, 160);

  for (const key of ['passages', 'witnesses', 'evidence', 'supporting_witnesses']) {
    const arr = asArray(rawConn[key]);
    if (arr.length === 0) continue;
    const first = arr[0];
    if (typeof first === 'string') {
      const text = normalizeText(first, 160);
      if (text) return text;
    } else {
      const obj = asRecord(first);
      if (obj) {
        const text = normalizeText(
          firstNonEmpty(obj.snippet, obj.text, obj.witness, obj.quote, obj.summary),
          160,
        );
        if (text) return text;
      }
    }
  }
  return undefined;
}

function extractTarget(rawConn: Record<string, unknown>): CompactConnection['target'] | undefined {
  const origWords = asArray(rawConn.original_words).map((w) => asRecord(w)).filter((w): w is Record<string, unknown> => w !== null);
  const targetObj = asRecord(rawConn.target) ?? asRecord(rawConn.to_word) ?? asRecord(rawConn.word) ?? origWords[1] ?? origWords[0] ?? null;
  const strongs = normalizeStrongs(
    firstNonEmpty(
      targetObj?.strongs,
      rawConn.target_strongs,
      rawConn.to_strongs,
      rawConn.strongs,
    ),
  );
  const script = firstNonEmpty(
    targetObj?.script,
    targetObj?.lemma_script,
    targetObj?.lemma,
    targetObj?.word,
    rawConn.target_script,
    rawConn.target_lemma,
  );
  const transliteration = cleanTransliteration(
    firstNonEmpty(targetObj?.transliteration, rawConn.target_transliteration),
    script,
  );
  const gloss = normalizeText(
    firstNonEmpty(targetObj?.gloss, rawConn.target_gloss, rawConn.gloss),
    100,
  );

  if (!strongs && !script && !transliteration && !gloss) return undefined;
  return {
    ...(strongs ? { strongs } : {}),
    ...(script ? { script } : {}),
    ...(transliteration ? { transliteration } : {}),
    ...(gloss ? { gloss } : {}),
  };
}

/**
 * Normalize R12 strongest_connections items to a compact connection card while
 * suppressing low-signal grammatical edges involving function words.
 */
export function normalizeDiscoveryConnection(rawConn: Record<string, unknown>): CompactConnection | null {
  const targetObj = asRecord(rawConn.target) ?? asRecord(rawConn.to_word) ?? asRecord(rawConn.word);
  const sourceObj = asRecord(rawConn.source) ?? asRecord(rawConn.from_word);

  const relationRaw = firstNonEmpty(
    rawConn.relation,
    rawConn.predicate,
    rawConn.connection_type,
    rawConn.edge_type,
    rawConn.kind,
    rawConn.type,
    'related',
  );
  const relationLower = relationRaw.toLowerCase();

  const targetPos = firstNonEmpty(
    targetObj?.pos_class,
    targetObj?.pos,
    rawConn.target_pos,
    rawConn.pos_class,
    rawConn.pos,
  );
  const targetStrongs = firstNonEmpty(
    targetObj?.strongs,
    rawConn.target_strongs,
    rawConn.to_strongs,
    rawConn.strongs,
  );
  const sourcePos = firstNonEmpty(sourceObj?.pos_class, sourceObj?.pos, rawConn.source_pos);
  const sourceStrongs = firstNonEmpty(sourceObj?.strongs, rawConn.source_strongs, rawConn.from_strongs);

  if (
    SUPPRESSED_EDGE_RELATIONS.has(relationLower) ||
    isFunctionWord({ pos_class: targetPos, strongs: targetStrongs }) ||
    isFunctionWord({ pos_class: sourcePos, strongs: sourceStrongs })
  ) {
    return null;
  }

  const title = normalizeText(
    firstNonEmpty(rawConn.title, rawConn.label, rawConn.headline, rawConn.summary, relationRaw)
      .replace(/^R12 (\d+)-hop discovery: /, '$1-hop: '),
    140,
  );
  const id = firstNonEmpty(
    rawConn.evidence_id,
    rawConn.id,
    rawConn.connection_id,
    rawConn.key,
    `${relationRaw}:${title.slice(0, 48)}`,
  );
  const epistemic = firstNonEmpty(
    rawConn.epistemic,
    rawConn.epistemic_class,
    rawConn.epistemic_status,
    rawConn.epistemic_layer,
    rawConn.certainty,
    'textual_evidence',
  );
  const rawTier = rawConn.tier ?? rawConn.evidence_tier ?? rawConn.confidence_tier;
  const tier = typeof rawTier === 'number' && Number.isFinite(rawTier) ? rawTier : undefined;
  let whyText = firstNonEmpty(
    rawConn.why, rawConn.explanation, rawConn.reason, rawConn.rationale,
    rawConn.description, rawConn.summary, title,
  );
  // Remove repeated discovery machinery before the existing text budget is applied.
  // This keeps more of the actual biblical path, without changing selected edges or scores.
  whyText = whyText
    .replace(/^(\d+)-hop source-backed discovery path \(([^,;)]+)[^)]*\): /, '$1-hop path ($2): ')
    .replace(/--\[lxx_translation_bridge\]-->/g, '—LXX→')
    .replace(/--\[gram_grammatical_subject_of\]-->/g, '—subject of→')
    .replace(/--\[gram_grammatical_object_of\]-->/g, '—object of→')
    .replace(/--\[gram_modifies\]-->/g, '—modifies→')
    .replace(/--\[lex_source_provided_lexical_equivalent\]-->/g, '—source lexical equivalent→')
    .replace(/^Syntactic dependency analysis identifies direct grammatical connection \(([^)]+)\) between /, '$1: ');
  const why = normalizeText(
    whyText,
    240,
  );
  const refs = extractRefStrings(rawConn);
  const target = extractTarget(rawConn);
  const witness = extractWitnessSnippet(rawConn);
  const rawLimits = asArray(rawConn.limitations).filter((x): x is string => typeof x === 'string');
  const uncertainty = normalizeText(
    firstNonEmpty(rawConn.uncertainty, rawConn.caveat, rawConn.epistemic_note, rawLimits[0]),
    180,
  );
  const evidenceType = firstNonEmpty(rawConn.evidence_type);
  const matchedEndpoints = asArray(rawConn.matched_concepts ?? rawConn.matched_endpoints ?? rawConn.endpoint_matches)
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, 8);
  const scoreBreakdown = asRecord(rawConn.score_breakdown);

  return {
    id,
    relation: relationRaw,
    epistemic,
    ...(evidenceType ? { evidence_type: evidenceType } : {}),
    ...(tier !== undefined ? { tier } : {}),
    title,
    why,
    refs,
    ...(matchedEndpoints.length > 0 ? { matched_endpoints: matchedEndpoints } : {}),
    ...(target ? { target } : {}),
    ...(witness ? { witness } : {}),
    ...(uncertainty ? { uncertainty } : {}),
    ...(scoreBreakdown ? { score_breakdown: scoreBreakdown } : {}),
  };
}

/**
 * Compact verse/passage geography strictly from rawGeo.locations[],
 * intentionally omitting era_gazetteer payloads.
 */
export function compactGeography(rawGeo: Record<string, unknown> | null): CompactGeographyResult {
  const locations = asArray(rawGeo?.locations);
  if (locations.length === 0) {
    const fallbackNote = normalizeText(
      firstNonEmpty(
        rawGeo?.note,
        rawGeo?.explanation,
        rawGeo?.message,
        'No literal geographic location resolved; reference may be symbolic, poetic, or geographically unlocated.',
      ),
      220,
    );
    return {
      status: 'symbolic_or_unresolved',
      places: [],
      note: fallbackNote,
    };
  }

  const places: CompactGeoPlace[] = [];
  for (const item of locations) {
    const loc = asRecord(item);
    if (!loc) continue;
    const place = firstNonEmpty(loc.biblical_name, loc.place, loc.name, loc.place_name, loc.ancient_name);
    if (!place) continue;
    const modernVal = firstNonEmpty(loc.modern, loc.modern_name);
    const relation = firstNonEmpty(loc.relationship_type, loc.relation, 'contextual_location');
    const lat = typeof loc.lat === 'number' && Number.isFinite(loc.lat)
      ? loc.lat
      : typeof loc.latitude === 'number' && Number.isFinite(loc.latitude)
        ? loc.latitude
        : null;
    const lon = typeof loc.lon === 'number' && Number.isFinite(loc.lon)
      ? loc.lon
      : typeof loc.lng === 'number' && Number.isFinite(loc.lng)
        ? loc.lng
        : typeof loc.longitude === 'number' && Number.isFinite(loc.longitude)
          ? loc.longitude
          : null;
    const confidence = typeof loc.confidence === 'string' || typeof loc.confidence === 'number'
      ? loc.confidence
      : typeof loc.confidence_level === 'string'
        ? loc.confidence_level
        : typeof loc.confidence_label === 'string'
          ? loc.confidence_label
          : null;
    const evidenceRef = firstNonEmpty(loc.evidence_ref, loc.ref, loc.source_ref) || null;
    const note = normalizeText(
      firstNonEmpty(loc.evidence_explanation, loc.note, loc.explanation),
      220,
    );
    const alternatives = asArray(loc.alternatives ?? loc.alternative_locations)
      .map((alt) => asRecord(alt))
      .filter((alt): alt is Record<string, unknown> => alt !== null);

    places.push({
      place,
      modern: modernVal || null,
      relation,
      lat,
      lon,
      confidence,
      evidence_ref: evidenceRef,
      note,
      ...(alternatives.length > 0 ? { alternatives } : {}),
    });
  }

  if (places.length === 0) {
    return {
      status: 'symbolic_or_unresolved',
      places: [],
      note: 'No literal geographic location resolved; reference may be symbolic, poetic, or geographically unlocated.',
    };
  }

  const topNote = normalizeText(firstNonEmpty(rawGeo?.note, rawGeo?.summary), 220);
  return {
    status: 'ok',
    places,
    ...(topNote ? { note: topNote } : {}),
  };
}

function formatChronDate(obj: Record<string, unknown>): string {
  const direct = firstNonEmpty(obj.date, obj.date_label, obj.label, obj.year_label);
  if (direct) return direct;
  const earliest = obj.earliest_year ?? obj.start_year;
  const latest = obj.latest_year ?? obj.end_year;
  if (typeof earliest === 'number' && typeof latest === 'number') {
    return earliest === latest ? String(earliest) : `${earliest}..${latest}`;
  }
  if (typeof earliest === 'number') return String(earliest);
  if (typeof obj.year === 'number') return String(obj.year);
  return '';
}

/**
 * Compact chronology assertions and expose competing chronology models explicitly.
 */
export function compactChronology(
  rawChron: Record<string, unknown> | null,
  extraAssertions?: Array<Record<string, unknown>>,
  extraModels?: Array<Record<string, unknown>>,
): CompactChronologyResult {
  const modelMetaById = new Map<string, Record<string, unknown>>();
  for (const m of extraModels ?? []) {
    const id = firstNonEmpty(m.model_id, m.id, m.slug, m.name);
    if (id) modelMetaById.set(id, m);
  }

  const chronModel = asRecord(rawChron?.model);
  const chronSummary = asRecord(rawChron?.summary);
  const rawPrimary = asRecord(rawChron?.primary)
    ?? (chronSummary && (chronSummary.label || chronSummary.earliest_year !== undefined) ? chronSummary : null)
    ?? (rawChron && (rawChron.date || rawChron.date_label || rawChron.earliest_year !== undefined) ? rawChron : null);
  let primary: CompactChronologyPrimary | null = null;
  if (rawPrimary) {
    const date = formatChronDate(rawPrimary);
    const model = firstNonEmpty(
      rawPrimary.model,
      rawPrimary.model_id,
      rawPrimary.model_name,
      chronModel?.name,
      chronModel?.id,
      rawPrimary.source_model,
    );
    const chronAssumptions = asRecord(chronModel?.assumptions);
    if (date || model) {
      primary = {
        date: date || 'unspecified',
        what_was_dated: firstNonEmpty(
          rawPrimary.what_was_dated,
          rawPrimary.event_label,
          rawPrimary.axis,
          rawPrimary.subject,
          'event_or_composition',
        ),
        model: model || 'primary',
        uncertainty: normalizeText(
          firstNonEmpty(
            rawPrimary.uncertainty,
            rawPrimary.uncertainty_note,
            rawPrimary.precision,
            rawPrimary.note,
            chronAssumptions?.precision,
            chronAssumptions?.basis,
          ),
          200,
        ),
      };
    }
  }

  const competing: CompactChronologyModelEntry[] = [];
  const seen = new Set<string>();
  if (primary) {
    seen.add(`${primary.model}|${primary.date}|${primary.what_was_dated}`);
  }

  const candidateRows: Array<Record<string, unknown>> = [];
  for (const alt of asArray(rawChron?.alternatives)) {
    const rec = asRecord(alt);
    if (rec) candidateRows.push(rec);
  }
  for (const assertion of extraAssertions ?? []) {
    candidateRows.push(assertion);
  }

  for (const row of candidateRows) {
    const modelId = firstNonEmpty(row.model, row.model_id, row.model_name, row.source_model, 'competing_model');
    const meta = modelMetaById.get(modelId);
    const date = formatChronDate(row);
    if (!date) continue;
    const whatWasDated = firstNonEmpty(
      row.what_was_dated,
      row.event_label,
      row.axis,
      row.subject,
      'event_or_composition',
    );
    const dedupeKey = `${modelId}|${date}|${whatWasDated}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const note = normalizeText(
      firstNonEmpty(row.note, row.uncertainty, row.explanation, meta?.description, meta?.note),
      180,
    );
    competing.push({
      model: modelId,
      date,
      what_was_dated: whatWasDated,
      ...(note ? { note } : {}),
    });
  }

  return {
    status: primary !== null || competing.length > 0 ? 'ok' : 'unresolved',
    primary,
    competing_models: competing,
  };
}

const ORTHOGRAPHIC_WARNING =
  'Orthographic/spelling similarity only; does NOT establish shared etymology or lexical derivation.';

function mapSpellingSuggestions(
  items: unknown[],
  limit: number,
): NonNullable<NonNullable<CompactWord['etymology']>['spelling_suggestions']> {
  const out: NonNullable<NonNullable<CompactWord['etymology']>['spelling_suggestions']> = [];
  const seen = new Set<string>();

  for (const rawItem of items) {
    const item = asRecord(rawItem);
    if (!item) continue;
    const strongs = normalizeStrongs(firstNonEmpty(item.bs, item.strongs, item.target_strongs, item.id));
    const script = firstNonEmpty(item.sc, item.script, item.lemma, item.word, item.surface);
    const gloss = normalizeText(firstNonEmpty(item.gl, item.gloss, item.short_gloss, item.definition), 120);
    if (!strongs && !script) continue;
    const key = `${strongs}|${script}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const translit = cleanTransliteration(firstNonEmpty(item.tr, item.transliteration, item.translit), script);
    const shared = firstNonEmpty(item.cons, item.shared, item.skeleton, item.shared_consonants, item.match_type);
    const note = normalizeText(
      firstNonEmpty(item.note, ORTHOGRAPHIC_WARNING),
      180,
    );

    out.push({
      strongs,
      script,
      ...(translit ? { transliteration: translit } : {}),
      gloss,
      ...(shared ? { shared } : {}),
      note,
    });
    if (out.length >= limit) break;
  }

  return out;
}

export interface EtymologyOptions {
  /** Homograph lemma selected by the caller (e.g. a source token's lemma_key). */
  activeLemmaKey?: string;
  /** Contextual gloss for display; never sufficient to choose a homograph lemma. */
  contextualGloss?: string;
  /** Canonical word id of an anchored occurrence (enables token-level component candidates). */
  wordId?: number | null;
}

const ROOT_FIELDS = [
  'root_key', 'root_script', 'root_transliteration', 'lemma_key', 'relation_type', 'base_strongs',
  'lemma_script', 'primary_gloss', 'transliteration', 'evidence_note',
] as const;

function compactFormationRecord(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ROOT_FIELDS) {
    const val = rec[key];
    if (typeof val === 'string' && val.trim()) out[key] = key === 'evidence_note' ? normalizeText(val, 200) : val.trim();
  }
  if (rec.implies_synonymy === false) out.implies_synonymy = false;
  return out;
}

/**
 * Retrieve documented etymology/formation (roots, formations, relatives) via
 * get_word_formation_v1. Roots are attributed to the specific homograph lemma that carries
 * them: roots documented only for a different lemma under the same Strong's number are listed
 * separately and never presented as this word's etymology. Spelling similarity is kept apart.
 */
export async function buildWordEtymology(
  read: DatabaseReader,
  strongs: string,
  profile: Record<string, unknown> | null,
  limit: number,
  options: EtymologyOptions = {},
): Promise<NonNullable<CompactWord['etymology']>> {
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 10, 50));
  let roots: Array<Record<string, unknown>> = [];
  let formations: Array<Record<string, unknown>> = [];
  let relatives: Array<Record<string, unknown>> = [];
  let otherHomographRoots: Array<Record<string, unknown>> = [];
  let components: Array<Record<string, unknown>> = [];
  let activeLemmaKey = options.activeLemmaKey ?? '';

  try {
    const rows = await callRpc(
      read,
      'get_word_formation_v1',
      { p_query: strongs, ...(options.wordId ? { p_word_id: options.wordId } : {}) },
      1,
      0,
    );
    const first = asRecord(rows[0]);
    if (first) {
      const matched = asArray(first.matched_lemmas)
        .map((m) => asRecord(m))
        .filter((m): m is Record<string, unknown> => m !== null);
      const glossByLemma = new Map<string, string>();
      for (const m of matched) {
        const lk = firstNonEmpty(m.lemma_key);
        if (lk) glossByLemma.set(lk.toLowerCase(), firstNonEmpty(m.primary_gloss));
      }
      if (!activeLemmaKey) {
        activeLemmaKey = firstNonEmpty(profile?.lk, profile?.lemma_key);
        if (!activeLemmaKey && matched.length === 1) activeLemmaKey = firstNonEmpty(matched[0]?.lemma_key);
      }
      const activeLc = activeLemmaKey.toLowerCase();

      const allRoots = asArray(first.documented_roots ?? first.roots)
        .map((r) => asRecord(r))
        .filter((r): r is Record<string, unknown> => r !== null);
      const allRelatives = asArray(first.root_relatives ?? first.relatives)
        .map((r) => asRecord(r))
        .filter((r): r is Record<string, unknown> => r !== null);
      const keptRootKeys = new Set<string>();
      for (const root of allRoots) {
        const lk = firstNonEmpty(root.lemma_key);
        if (activeLc && lk.toLowerCase() === activeLc) {
          roots.push(compactFormationRecord(root));
          keptRootKeys.add(firstNonEmpty(root.root_key));
        } else {
          const rk = firstNonEmpty(root.root_key);
          otherHomographRoots.push({
            ...compactFormationRecord(root),
            homograph_gloss: glossByLemma.get(lk.toLowerCase()) || undefined,
            relatives: allRelatives.filter((r) => firstNonEmpty(r.root_key) === rk).map(compactFormationRecord).slice(0, 3),
            note: activeLc && lk
              ? 'Other homograph lemma; not the selected word.'
              : 'Lemma assignment unavailable; do not attribute this root to a selected sense.',
          });
        }
      }
      relatives = allRelatives
        .filter((r) => keptRootKeys.has(firstNonEmpty(r.root_key)))
        .map(compactFormationRecord);
      formations = asArray(first.lexical_formations ?? first.formations)
        .map((r) => asRecord(r))
        .filter((r): r is Record<string, unknown> => r !== null)
        .filter((r) => {
          const lk = firstNonEmpty(r.lemma_key);
          return Boolean(activeLc && lk.toLowerCase() === activeLc);
        })
        .map(compactFormationRecord);

      if (options.wordId) {
        const seen = new Set<string>();
        for (const cand of asArray(first.word_form_component_candidates)) {
          const c = asRecord(cand);
          if (!c) continue;
          const lk = firstNonEmpty(c.lemma_key);
          if (c.is_context_ambiguous !== false || !activeLc || lk.toLowerCase() !== activeLc) continue;
          const entry = {
            surface: firstNonEmpty(c.surface),
            role: firstNonEmpty(c.morpheme_role),
            grammar: firstNonEmpty(c.grammar_code),
            gloss: firstNonEmpty(c.gloss),
          };
          const key = JSON.stringify(entry);
          if (seen.has(key)) continue;
          seen.add(key);
          components.push(entry);
        }
        components = components.slice(0, 6);
      }
    }
  } catch {
    // Graceful degradation when word formation RPC is temporarily unavailable.
  }

  const orthEntry = asRecord(profile?.orth_entry);
  const profileCandidates = [
    ...asArray(orthEntry?.homographs),
    ...asArray(orthEntry?.candidates),
  ];
  let spellingSuggestions = mapSpellingSuggestions(profileCandidates, safeLimit);

  if (spellingSuggestions.length === 0) {
    try {
      const orthRows = await callRpc(
        read,
        'suggest_orthographic_candidates_v1',
        { p_query: strongs, p_limit: safeLimit },
        1,
        0,
      );
      const first = asRecord(orthRows[0]);
      const rawCandidates = first
        ? [...asArray(first.homographs), ...asArray(first.candidate_connections), ...asArray(first.candidates), ...asArray(first.items)]
        : orthRows;
      spellingSuggestions = mapSpellingSuggestions(rawCandidates, safeLimit);
    } catch {
      // Optional orthographic fallback; leave empty on error.
    }
  }

  const hasDocumented = roots.length > 0 || formations.length > 0 || relatives.length > 0;
  const noteParts: string[] = [];
  if (hasDocumented) noteParts.push('Documented lexical formation records for the selected lemma.');
  else if (otherHomographRoots.length > 0) {
    noteParts.push(activeLemmaKey
      ? 'No verified root for the selected lemma; other or unassigned roots are separate.'
      : 'Lemma selection is unresolved; roots are listed separately without assigning them to a sense.');
  } else noteParts.push('No documented etymology, root, or formation record found for this word.');
  if (spellingSuggestions.length > 0) noteParts.push(ORTHOGRAPHIC_WARNING);

  return {
    status: hasDocumented ? 'documented' : 'unavailable',
    ...(activeLemmaKey ? { lemma_key: activeLemmaKey } : {}),
    ...(roots.length > 0 ? { roots: roots.slice(0, safeLimit) } : {}),
    ...(formations.length > 0 ? { formations: formations.slice(0, safeLimit) } : {}),
    ...(relatives.length > 0 ? { relatives: relatives.slice(0, safeLimit) } : {}),
    ...(otherHomographRoots.length > 0 ? { other_homograph_roots: otherHomographRoots.slice(0, 3) } : {}),
    ...(components.length > 0 ? { morphological_components: components } : {}),
    ...(spellingSuggestions.length > 0 ? { spelling_suggestions: spellingSuggestions } : {}),
    note: noteParts.join(' '),
  };
}

function normalizeBridgeEntry(raw: Record<string, unknown>): Record<string, unknown> {
  const source = firstNonEmpty(raw.source, raw.dataset, raw.origin, 'OEWN / Wikidata');
  const license = firstNonEmpty(
    raw.license,
    source.toLowerCase().includes('wikidata') ? 'CC0' : 'CC BY 4.0',
  );
  return {
    ...raw,
    source,
    license,
  };
}

/**
 * Combine biblical/physical definitions, OEWN/Wikidata property bridges, and
 * concept properties with explicit source/license attribution.
 */
export async function buildWordRealworld(
  read: DatabaseReader,
  strongs: string,
  gloss: string,
  wordRow: Record<string, unknown> | null,
  profile: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  const biblicalDef = normalizeText(firstNonEmpty(wordRow?.biblical_def), 400);
  const physicalDef = normalizeText(firstNonEmpty(wordRow?.physical_def), 400);

  const pilotAnchor = asRecord(profile?.r12_pilot_anchor);
  const rawBridges = asArray(profile?.pilot_bridges ?? pilotAnchor?.property_bridges);
  const propertyBridges = rawBridges
    .map((b) => asRecord(b))
    .filter((b): b is Record<string, unknown> => b !== null)
    .map(normalizeBridgeEntry);

  let conceptProperties: Array<Record<string, unknown>> = [];
  const conceptQuery = firstNonEmpty(strongs, gloss);
  if (conceptQuery) {
    try {
      const rows = await callRpc(
        read,
        'lookup_concept_properties_v1',
        { p_concept_query: conceptQuery },
        10,
        0,
      );
      const first = asRecord(rows[0]);
      const items = first
        ? asArray(first.concepts ?? first.properties ?? first.items)
        : rows;
      conceptProperties = items
        .map((c) => asRecord(c))
        .filter((c): c is Record<string, unknown> => c !== null)
        .slice(0, 8);
    } catch {
      // Concept property RPC may be unavailable for some terms/environments.
    }
  }

  if (!biblicalDef && !physicalDef && propertyBridges.length === 0 && conceptProperties.length === 0) {
    return {
      status: 'unavailable',
      note: 'No supported physical/real-world definition recorded for this word.',
    };
  }

  const sources: string[] = [];
  if (biblicalDef || physicalDef) sources.push('Biblical lexicon');
  if (propertyBridges.length > 0) sources.push('OEWN (CC BY 4.0) / Wikidata (CC0)');
  if (conceptProperties.length > 0) sources.push('Corpus concept properties');

  return {
    status: 'ok',
    ...(biblicalDef ? { biblical_def: biblicalDef } : {}),
    ...(physicalDef ? { physical_def: physicalDef } : {}),
    ...(propertyBridges.length > 0 ? { property_bridges: propertyBridges } : {}),
    ...(conceptProperties.length > 0 ? { concept_properties: conceptProperties } : {}),
    sources,
  };
}

function consonantKey(val: string): string {
  return val
    .normalize('NFD')
    .replace(/[\u0591-\u05af]/g, '')
    .replace(/[^\p{L}\p{M}]/gu, '')
    .toLowerCase();
}

function padStrongs(val: string): string {
  const m = /^([HG])0*(\d+)/i.exec(val.trim());
  return m ? `${m[1].toUpperCase()}${m[2].padStart(4, '0')}` : '';
}

/**
 * A lexical-table row may enrich a passage token only if it is the same source token:
 * identical word-form id, surface letters AND Strong's number. Otherwise its
 * transliteration/grammar belong to another word and must not be attached.
 */
export function verifyWordRowAlignment(token: Record<string, unknown>, row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  const wid = Number(token.word_id);
  if (!Number.isInteger(wid) || wid <= 0 || Number(row.id) !== wid) return false;
  const tokCons = consonantKey(firstNonEmpty(token.surface));
  const rowCons = consonantKey(firstNonEmpty(row.original_word));
  const tokBs = padStrongs(firstNonEmpty(token.strongs));
  const rowBs = padStrongs(firstNonEmpty(row.strongs_nr));
  const tokenExtended = /[A-Z]+$/i.exec(firstNonEmpty(token.strongs))?.[0].toUpperCase();
  const rowExtended = /[A-Z]+$/i.exec(firstNonEmpty(row.strongs_nr))?.[0].toUpperCase();
  if (tokenExtended && rowExtended && tokenExtended !== rowExtended) return false;
  const tokenLemma = firstNonEmpty(token.lemma_key);
  const rowLemma = firstNonEmpty(row.lemma_key);
  if (tokenLemma && rowLemma && tokenLemma !== rowLemma) return false;
  return Boolean(tokCons && rowCons && tokCons === rowCons && tokBs && rowBs && tokBs === rowBs);
}
