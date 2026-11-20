// Pure Web/Deno TypeScript module: shared compact word, connection, geography,
// chronology, etymology, and real-world builders for bible-mcp tools.
// Zero Node-only imports; all relative imports include .ts extensions.

import type { DatabaseQuery, DatabaseReader } from './catalog.ts';
import type { GematriaResult } from './gematria.ts';

export interface CompactConnection {
  id: string;
  relation: string;
  epistemic: string;
  tier?: number;
  title: string;
  why: string;
  refs: string[];
  target?: {
    strongs?: string;
    script?: string;
    transliteration?: string;
    gloss?: string;
  };
  witness?: string;
  uncertainty?: string;
}

export interface CompactWord {
  form: string;
  lemma: string;
  strongs: string;
  lemma_key?: string;
  transliteration: string;
  gloss: string;
  senses?: Array<{ key?: string; gloss: string; note?: string }>;
  grammar: string;
  pos?: string;
  total_verses?: number;
  lxx?: Array<{ strongs?: string; script: string; gloss: string; count?: number }>;
  etymology?: {
    status: 'documented' | 'unavailable';
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

function compactSenses(raw: unknown): CompactWord['senses'] | undefined {
  const items = asArray(raw);
  if (items.length === 0) return undefined;
  const result: NonNullable<CompactWord['senses']> = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const gloss = normalizeText(item, 140);
      if (gloss) result.push({ gloss });
      continue;
    }
    const obj = asRecord(item);
    if (!obj) continue;
    const gloss = normalizeText(firstNonEmpty(obj.gloss, obj.definition, obj.label, obj.text), 140);
    if (!gloss) continue;
    const key = firstNonEmpty(obj.key, obj.sense_key, obj.id);
    const note = normalizeText(firstNonEmpty(obj.note, obj.domain, obj.usage), 120);
    result.push({
      ...(key ? { key } : {}),
      gloss,
      ...(note ? { note } : {}),
    });
  }
  return result.length > 0 ? result : undefined;
}

function compactLxx(raw: unknown): CompactWord['lxx'] | undefined {
  const items = asArray(raw);
  if (items.length === 0) return undefined;
  const result: NonNullable<CompactWord['lxx']> = [];
  for (const item of items) {
    const obj = asRecord(item);
    if (!obj) continue;
    const script = firstNonEmpty(obj.script, obj.greek, obj.lemma, obj.word, obj.text);
    const gloss = normalizeText(firstNonEmpty(obj.gloss, obj.english, obj.meaning), 100);
    if (!script && !gloss) continue;
    const strongs = normalizeStrongs(firstNonEmpty(obj.strongs, obj.greek_strongs));
    const count = typeof obj.count === 'number' && Number.isFinite(obj.count)
      ? obj.count
      : typeof obj.occurrences === 'number' && Number.isFinite(obj.occurrences)
        ? obj.occurrences
        : undefined;
    result.push({
      ...(strongs ? { strongs } : {}),
      script: script || gloss,
      gloss,
      ...(count !== undefined ? { count } : {}),
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

  const lemma = firstNonEmpty(
    profile?.lemma,
    profile?.sc,
    token?.lemma,
    wordRow?.lemma,
    wordRow?.original_word,
    token?.lexical_form,
    token?.text,
    token?.surface,
    token?.form,
    wordRow?.word,
  );
  const form = firstNonEmpty(
    token?.text,
    token?.surface,
    token?.form,
    token?.word,
    wordRow?.word,
    wordRow?.original_word,
    profile?.form,
    lemma,
  );
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
  const lemmaKey = firstNonEmpty(profile?.lemma_key, profile?.lk, token?.lemma_key, wordRow?.lemma_key);
  const transliteration = cleanTransliteration(
    firstNonEmpty(
      token?.transliteration,
      token?.tr,
      profile?.transliteration,
      profile?.tr,
      wordRow?.transliteration,
      wordRow?.translit,
    ),
    lemma || form,
  );
  const engArr = asArray(wordRow?.english_translations).filter((x): x is string => typeof x === 'string');
  const gloss = normalizeText(
    firstNonEmpty(
      token?.gloss,
      profile?.gloss,
      profile?.gl,
      wordRow?.gloss,
      wordRow?.short_gloss,
      engArr[0],
      wordRow?.definition,
    ),
    180,
  );
  const grammar = firstNonEmpty(
    token?.grammar,
    token?.code,
    token?.morph_desc,
    token?.morphology,
    token?.morph,
    profile?.grammar,
    wordRow?.grammar_code,
    wordRow?.morphology,
  );
  const pos = firstNonEmpty(token?.pos_class, token?.pos, profile?.pos_class, profile?.pos, wordRow?.pos);
  const rawTotalVerses = profile?.total_verses ?? profile?.verse_count ?? wordRow?.total_verses;
  const totalVerses = typeof rawTotalVerses === 'number' && Number.isFinite(rawTotalVerses)
    ? rawTotalVerses
    : undefined;

  const senses = compactSenses(profile?.senses ?? wordRow?.senses);
  const lxx = compactLxx(profile?.lxx ?? profile?.lxx_relations ?? profile?.lxx_equivalents ?? wordRow?.lxx);

  const out: CompactWord = {
    form,
    lemma,
    strongs,
    ...(lemmaKey ? { lemma_key: lemmaKey } : {}),
    transliteration,
    gloss,
    ...(senses ? { senses } : {}),
    grammar,
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
    firstNonEmpty(rawConn.title, rawConn.label, rawConn.headline, rawConn.summary, relationRaw),
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
  const why = normalizeText(
    firstNonEmpty(
      rawConn.why,
      rawConn.explanation,
      rawConn.reason,
      rawConn.rationale,
      rawConn.description,
      rawConn.summary,
      title,
    ),
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

  return {
    id,
    relation: relationRaw,
    epistemic,
    ...(tier !== undefined ? { tier } : {}),
    title,
    why,
    refs,
    ...(target ? { target } : {}),
    ...(witness ? { witness } : {}),
    ...(uncertainty ? { uncertainty } : {}),
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
    const strongs = normalizeStrongs(firstNonEmpty(item.strongs, item.target_strongs, item.id));
    const script = firstNonEmpty(item.script, item.lemma, item.word, item.surface);
    const gloss = normalizeText(firstNonEmpty(item.gloss, item.short_gloss, item.definition), 120);
    if (!strongs && !script) continue;
    const key = `${strongs}|${script}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const translit = cleanTransliteration(firstNonEmpty(item.transliteration, item.translit), script);
    const shared = firstNonEmpty(item.shared, item.skeleton, item.shared_consonants, item.match_type);
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

/**
 * Retrieve documented etymology/formation (roots, formations, relatives) via
 * get_word_formation_v1 and separate non-etymological orthographic candidates.
 */
export async function buildWordEtymology(
  read: DatabaseReader,
  strongs: string,
  profile: Record<string, unknown> | null,
  limit: number,
): Promise<NonNullable<CompactWord['etymology']>> {
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 10, 50));
  let roots: Array<Record<string, unknown>> = [];
  let formations: Array<Record<string, unknown>> = [];
  let relatives: Array<Record<string, unknown>> = [];

  try {
    const rows = await callRpc(read, 'get_word_formation_v1', { p_query: strongs }, 1, 0);
    const first = asRecord(rows[0]);
    if (first) {
      roots = asArray(first.documented_roots ?? first.roots)
        .map((r) => asRecord(r))
        .filter((r): r is Record<string, unknown> => r !== null);
      formations = asArray(first.lexical_formations ?? first.formations)
        .map((r) => asRecord(r))
        .filter((r): r is Record<string, unknown> => r !== null);
      relatives = asArray(first.root_relatives ?? first.relatives)
        .map((r) => asRecord(r))
        .filter((r): r is Record<string, unknown> => r !== null);
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
  const note = hasDocumented
    ? spellingSuggestions.length > 0
      ? `Documented lexical formation records returned. ${ORTHOGRAPHIC_WARNING}`
      : 'Documented lexical formation records returned.'
    : spellingSuggestions.length > 0
      ? `No documented etymology/root record found. ${ORTHOGRAPHIC_WARNING}`
      : 'No documented etymology, root, or formation record found for this word.';

  return {
    status: hasDocumented ? 'documented' : 'unavailable',
    ...(roots.length > 0 ? { roots: roots.slice(0, safeLimit) } : {}),
    ...(formations.length > 0 ? { formations: formations.slice(0, safeLimit) } : {}),
    ...(relatives.length > 0 ? { relatives: relatives.slice(0, safeLimit) } : {}),
    ...(spellingSuggestions.length > 0 ? { spelling_suggestions: spellingSuggestions } : {}),
    note,
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
