// Pure Web/Deno TypeScript module: shared compact word, connection, geography,
// chronology, etymology, and real-world builders for bible-mcp tools.
// Zero Node-only imports; all relative imports include .ts extensions.

import type { DatabaseQuery, DatabaseReader } from './catalog.ts';
import type { GematriaResult } from './gematria.ts';
import { isLxxFunctionEquivalent, normalizeEpistemicClass } from './literary/epistemic-taxonomy.ts';

export interface CompactConnection {
  id: string;
  expand_id?: string;
  relation: string;
  epistemic: string;
  evidence_type?: string;
  tier?: number;
  e_perp?: {
    bits: number;
    p_null?: number;
    register?: string;
  };
  axes?: string[];
  bridge_preview?: string;
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
    if (FUNCTION_STRONGS.has(strongs) || /^H90\d{2}$/i.test(strongs)) {
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

const PRIMARY_LEMMA_DISPLAY_OVERRIDES: Readonly<Record<string, {
  badRegex: RegExp;
  lemma?: string;
  lemmaKey?: string;
  transliteration?: string;
  gloss: string;
}>> = {
  H1540: {
    badRegex: /^(?:heglam|הֶגְלָם)$/i,
    lemma: 'גָּלָה',
    lemmaKey: 'lemma:h1540a',
    transliteration: 'galah',
    gloss: 'to uncover, reveal, go into exile',
  },
  H5158: {
    badRegex: /\bpalm[- ]tree\b/i,
    lemma: 'נַ֫חַל',
    lemmaKey: 'lemma:h5158a',
    transliteration: 'na.chal',
    gloss: 'wadi, torrent, valley',
  },
  H2319: {
    badRegex: /^new\s*\(/i,
    gloss: 'new',
  },
  H4417: {
    badRegex: /\bAlso:/i,
    lemma: 'מֶ֫לַח',
    lemmaKey: 'lemma:H4417',
    transliteration: 'me.lach',
    gloss: 'salt',
  },
  H6030: {
    badRegex: /\bto dwell\b|עוּן/i,
    lemma: 'עָנָה',
    lemmaKey: 'lemma:H6030B',
    transliteration: 'a.nah',
    gloss: 'to answer, respond, sing',
  },
  H7462: {
    badRegex: /עֵ֫קֶד|עקד|בֵּית|בֵּית|בית|Beth-eked/i,
    lemma: 'רָעָה',
    lemmaKey: 'lemma:H7462B',
    transliteration: 'ra.ah',
    gloss: 'to pasture, shepherd',
  },
};

export function sanitizeLemmaDisplayFields(fields: {
  strongs: string;
  lemma: string;
  lemmaKey?: string;
  transliteration: string;
  gloss: string;
  anchored?: boolean;
}): { lemma: string; lemmaKey?: string; transliteration: string; gloss: string } {
  const cleanedGloss = (fields.gloss || '').replace(/\s*[;|]?\s*\bAlso:.*$/i, '').trim() || fields.gloss;
  const normBs = normalizeStrongs(fields.strongs).replace(/^([HG])0*(\d+)[A-Z]*$/, (_, l: string, d: string) => `${l}${d.padStart(4, '0')}`);
  const rule = PRIMARY_LEMMA_DISPLAY_OVERRIDES[normBs];
  if (!rule) return cleanedGloss !== fields.gloss ? { ...fields, gloss: cleanedGloss } : fields;
  const hitBadGloss = rule.badRegex.test(cleanedGloss || '') || /\bAlso:/i.test(fields.gloss || '');
  const hitBadLemma = rule.badRegex.test(fields.lemma || '') || /h1540g/i.test(fields.lemmaKey || '');
  if (!hitBadGloss && !hitBadLemma) return cleanedGloss !== fields.gloss ? { ...fields, gloss: cleanedGloss } : fields;
  const forceLemmaReplace = normBs === 'H7462' && hitBadLemma;
  return {
    lemma: ((!fields.anchored || forceLemmaReplace) && hitBadLemma && rule.lemma) ? rule.lemma : fields.lemma,
    lemmaKey: (!fields.anchored && hitBadLemma && rule.lemmaKey) ? rule.lemmaKey : fields.lemmaKey,
    transliteration: (!fields.anchored && hitBadLemma && rule.transliteration) ? rule.transliteration : fields.transliteration,
    gloss: hitBadGloss || (forceLemmaReplace && !fields.anchored) ? rule.gloss : cleanedGloss,
  };
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
  // Ensure primary sense comes first when H5158B ("palm-tree") or H1540G ("Heglam") precedes the primary lemma sense.
  if (result.length > 1 && base) {
    const paddedBase = base.replace(/^([HG])0*(\d+)[A-Z]*$/, (_, l: string, d: string) => `${l}${d.padStart(4, '0')}`);
    const rule = PRIMARY_LEMMA_DISPLAY_OVERRIDES[paddedBase];
    if (rule && rule.badRegex.test(result[0].gloss || '')) {
      const primaryIdx = result.findIndex(
        (s, idx) => idx > 0 && !rule.badRegex.test(s.gloss || '') && !/Heglam/i.test(s.gloss || ''),
      );
      if (primaryIdx > 0) {
        const [pri] = result.splice(primaryIdx, 1);
        result.unshift(pri);
      }
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
    if (isLxxFunctionEquivalent(strongs, script)) {
      continue;
    }
    // Filter clearly corrupt Swete G0065 (ἀγριέλαιος wild olive tree) <-> H6501/H6171 (פֶּרֶא/עָרוֹד wild donkey)
    if (
      (src === 'G0065' && (strongs === 'H6501' || strongs === 'H6171' || /פֶּ֫רֶא|פרא|עָרוֹד/.test(script))) ||
      ((src === 'H6501' || src === 'H6171') && strongs === 'G0065')
    ) {
      continue;
    }
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
    const sanitizedLxx = sanitizeLemmaDisplayFields({
      strongs,
      lemma: script,
      transliteration: '',
      gloss,
      anchored: false,
    });
    result.push({
      ...(strongs ? { strongs } : {}),
      script: sanitizedLxx.lemma,
      gloss: sanitizedLxx.gloss,
      ...(count !== undefined ? { count } : {}),
      ...(direction ? { direction } : {}),
    });
  }
  if (result.length > 1) {
    result.sort((a, b) => {
      const ca = a.count ?? 0;
      const cb = b.count ?? 0;
      const wa = ca <= 4 ? ca * 0.25 : ca;
      const wb = cb <= 4 ? cb * 0.25 : cb;
      return wb - wa;
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
  const profileSensesList = asArray(profile?.senses)
    .map((s) => asRecord(s))
    .filter((s): s is Record<string, unknown> => s !== null);
  const matchingSenseGloss = (() => {
    if (anchored || !lemmaKey) return '';
    const lkLower = lemmaKey.toLowerCase();
    const hit = profileSensesList.find((s) => firstNonEmpty(s.key, s.lk).toLowerCase() === lkLower);
    return hit ? firstNonEmpty(hit.gl, hit.gloss) : '';
  })();
  const gloss = normalizeText(
    anchored
      ? firstNonEmpty(token?.gloss, profile?.gloss, profile?.gl, engArr[0])
      : firstNonEmpty(matchingSenseGloss, wordRow?.short_gloss, profile?.gloss, profile?.gl, wordRow?.definition),
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
  const sanitizedPrimary = sanitizeLemmaDisplayFields({
    strongs,
    lemma,
    lemmaKey,
    transliteration,
    gloss,
    anchored,
  });

  const out: CompactWord = {
    ...(form ? { form } : {}),
    lemma: sanitizedPrimary.lemma,
    strongs,
    ...(sanitizedPrimary.lemmaKey ? { lemma_key: sanitizedPrimary.lemmaKey } : {}),
    ...(senseStatus ? { sense_status: senseStatus } : {}),
    ...(lemmaCandidates.length > 0 ? { lemma_candidates: lemmaCandidates } : {}),
    transliteration: sanitizedPrimary.transliteration,
    gloss: sanitizedPrimary.gloss,
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
      .replace(/^R12 (\d+)-hop discovery: /, '$1-hop: ')
      .replace(/עוּן\s*\(H6030(?:,\s*"to dwell")?\)/g, 'עָנָה (H6030)'),
    140,
  );
  const id = firstNonEmpty(
    rawConn.evidence_id,
    rawConn.id,
    rawConn.connection_id,
    rawConn.key,
    `${relationRaw}:${title.slice(0, 48)}`,
  );
  const expandId = firstNonEmpty(
    rawConn.expand_id,
    rawConn.evidence_id,
    rawConn.id,
    rawConn.connection_id,
    id,
  );
  const v3Score = asRecord(rawConn.v3_score);
  const ePerp = v3Score && typeof v3Score.e_perp_bits === 'number'
    ? {
        bits: Number(v3Score.e_perp_bits.toFixed(2)),
        ...(typeof v3Score.p_null_approx === 'number' ? { p_null: Number(v3Score.p_null_approx.toExponential(2)) } : {}),
        ...(typeof v3Score.dominant_register === 'string' ? { register: v3Score.dominant_register } : {}),
      }
    : undefined;
  const axes = v3Score
    ? asArray(v3Score.independent_axes)
        .map(a => asRecord(a))
        .filter((a): a is Record<string, unknown> => a !== null)
        .map(a => firstNonEmpty(a.axis))
        .filter(Boolean)
        .slice(0, 6)
    : undefined;
  const r12Meta = asRecord(rawConn.r12_metadata);
  const r12Steps = asArray(r12Meta?.steps).map(s => asRecord(s)).filter((s): s is Record<string, unknown> => s !== null);
  const bridgePreview = firstNonEmpty(
    rawConn.bridge_preview,
    r12Steps.length >= 2
      ? r12Steps.map(s => firstNonEmpty(s.via, s.to_label, s.to_id)).filter(Boolean).slice(0, 3).join(' -> ')
      : '',
  );
  const rawEpistemic = firstNonEmpty(
    rawConn.epistemic,
    rawConn.epistemic_class,
    rawConn.epistemic_status,
    rawConn.epistemic_layer,
    rawConn.certainty,
    'semantic_hypothesis',
  );
  const evidenceType = firstNonEmpty(rawConn.evidence_type);
  const epistemic = normalizeEpistemicClass(rawEpistemic, 'semantic_hypothesis', evidenceType);
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
    .replace(/^Syntactic dependency analysis identifies direct grammatical connection \(([^)]+)\) between /, '$1: ')
    .replace(/עוּן\s*\(H6030,\s*"to dwell"\)/g, 'עָנָה (H6030, "to answer/sing")')
    .replace(/עוּן\s*\(to dwell\)/g, 'עָנָה (to answer/sing)')
    .replace(/עוּן\s*\(H6030\)/g, 'עָנָה (H6030)');
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
  const matchedEndpoints = asArray(rawConn.matched_concepts ?? rawConn.matched_endpoints ?? rawConn.endpoint_matches)
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map(ep => {
      if (ep === 'עוּן') return 'עָנָה';
      if (ep === 'to dwell' && /\bH6030\b/i.test(id)) return 'to answer/sing';
      return ep;
    })
    .slice(0, 8);
  const scoreBreakdown = asRecord(rawConn.score_breakdown);

  return {
    id,
    ...(expandId ? { expand_id: expandId } : {}),
    relation: relationRaw,
    epistemic,
    ...(evidenceType ? { evidence_type: evidenceType } : {}),
    ...(tier !== undefined ? { tier } : {}),
    ...(ePerp ? { e_perp: ePerp } : {}),
    ...(axes && axes.length > 0 ? { axes } : {}),
    ...(bridgePreview ? { bridge_preview: normalizeText(bridgePreview, 120) } : {}),
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
async function withEtymTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const ETYM_TIMEOUT_SENTINEL = Symbol('etym_timeout');

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
  let nonEtymologicalGroupings: Array<Record<string, unknown>> = [];
  let activeLemmaKey = options.activeLemmaKey ?? '';

  const sourceScript = firstNonEmpty(profile?.sc, profile?.lemma);
  const sourceGloss = firstNonEmpty(profile?.gl, profile?.gloss);
  const sourceCons = consonantKey(sourceScript);
  const isProperProfile =
    profile?.entity_kind === 'proper_person' ||
    profile?.entity_kind === 'proper_place' ||
    (/^[A-Z][a-zA-Z'’-]+(?:\s+[A-Z(]|$)/.test(sourceGloss) && !/^(?:to|a|an|the)\s/i.test(sourceGloss));
  const sharedConsonantCount = (a: string, b: string): number => {
    const ca = consonantKey(a);
    const cb = consonantKey(b);
    if (!ca || !cb) return 0;
    return [...new Set(ca)].filter((ch) => cb.includes(ch)).length;
  };
  const sanitizeRelativeRecord = (rec: Record<string, unknown>, rawRecord?: Record<string, unknown>): Record<string, unknown> | null => {
    const rBs = padStrongs(firstNonEmpty(rec.base_strongs, rawRecord?.base_strongs, rawRecord?.target_strongs, rawRecord?.strongs));
    const rScript = firstNonEmpty(rec.lemma_script, rawRecord?.lemma_script, rawRecord?.script);
    if (!rBs || !rScript) return null;
    const out: Record<string, unknown> = { ...rec, base_strongs: rBs, lemma_script: rScript };
    const rGloss = firstNonEmpty(out.primary_gloss, rawRecord?.primary_gloss, rawRecord?.gloss);
    if (
      rGloss &&
      sourceGloss &&
      rBs !== strongs &&
      sourceCons &&
      consonantKey(rScript) !== sourceCons &&
      rGloss.toLowerCase() === sourceGloss.toLowerCase()
    ) {
      if (rBs === 'H4519') {
        out.primary_gloss = 'Manasseh';
      } else {
        delete out.primary_gloss;
        out.evidence_note = firstNonEmpty(
          out.evidence_note,
          'Inherited homograph gloss suppressed; inspect the target entry directly.',
        );
      }
    }
    const relType = firstNonEmpty(out.relation_type).toLowerCase();
    if (relType === 'spelling_variant_of' && sourceScript && sharedConsonantCount(sourceScript, rScript) < 2) {
      out.relation_type = 'co_referential_or_related_name';
      out.evidence_note = firstNonEmpty(
        out.evidence_note,
        'Co-referential designation or alternate name rather than an orthographic spelling variant.',
      );
    }
    return out;
  };

  let formationTimedOut = false;
  try {
    const timed = await withEtymTimeout<Record<string, unknown>[] | typeof ETYM_TIMEOUT_SENTINEL>(
      callRpc(
        read,
        'get_word_formation_v1',
        { p_query: strongs, ...(options.wordId ? { p_word_id: options.wordId } : {}) },
        1,
        0,
      ),
      2000,
      ETYM_TIMEOUT_SENTINEL,
    );
    formationTimedOut = timed === ETYM_TIMEOUT_SENTINEL;
    const rows = formationTimedOut ? [] : timed;
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
        const rCompact = compactFormationRecord(root);
        const rText = `${firstNonEmpty(root.root_script, root.lemma_script, root.primary_gloss, root.evidence_note)}`;
        const looksLikeCompoundProperPlace =
          !isProperProfile &&
          (/^[A-Z][a-z]+-[a-z]+/i.test(firstNonEmpty(root.root_transliteration, root.primary_gloss)) ||
            /\b(?:place|camp|boundary|valley|ephes-dammim)\b/i.test(rText));
        if (activeLc && lk.toLowerCase() === activeLc) {
          if (looksLikeCompoundProperPlace) continue;
          roots.push(rCompact);
          keptRootKeys.add(firstNonEmpty(root.root_key));
        } else {
          if (looksLikeCompoundProperPlace) continue;
          const rk = firstNonEmpty(root.root_key);
          otherHomographRoots.push({
            ...rCompact,
            homograph_gloss: glossByLemma.get(lk.toLowerCase()) || undefined,
            relatives: allRelatives
              .filter((r) => firstNonEmpty(r.root_key) === rk)
              .map((r) => sanitizeRelativeRecord(compactFormationRecord(r), r))
              .filter((r): r is Record<string, unknown> => r !== null)
              .slice(0, 3),
            note: activeLc && lk
              ? 'Other homograph lemma; not the selected word.'
              : 'Lemma assignment unavailable; do not attribute this root to a selected sense.',
          });
        }
      }
      const NON_ETYM_TYPES = new Set(['shared_name_base', 'group_member_of']);
      for (const r of allRelatives) {
        if (!keptRootKeys.has(firstNonEmpty(r.root_key))) continue;
        const cleaned = sanitizeRelativeRecord(compactFormationRecord(r), r);
        if (!cleaned) continue;
        const rType = firstNonEmpty(cleaned.relation_type, r.relation_type, r.type).toLowerCase();
        if (NON_ETYM_TYPES.has(rType)) {
          nonEtymologicalGroupings.push(cleaned);
        } else {
          relatives.push(cleaned);
        }
      }
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

  // Fallback to verified STEPBible / HebrewStrong lexical_relations stored on the lemma profile
  // (excluding shared_name_base, group_member_of, and cross-script entries) when RPC roots/relatives are absent.
  const srcPrefix = strongs[0]?.toUpperCase() || '';
  const profileLex = asArray(profile?.lexical_relations)
    .map((r) => asRecord(r))
    .filter((r): r is Record<string, unknown> => r !== null);
  for (const lr of profileLex) {
    const tBs = padStrongs(firstNonEmpty(lr.target_strongs));
    const tScript = firstNonEmpty(lr.script);
    let lType = firstNonEmpty(lr.type, 'derived_from_root_anchor').toLowerCase();
    if (!tBs || !tScript || lType === 'shared_name_base' || lType === 'group_member_of' || lType === 'source_provided_lexical_equivalent') continue;
    if (srcPrefix && tBs[0] !== srcPrefix) continue;
    if (lType === 'shares_root') {
      const sCons = consonantKey(firstNonEmpty(profile?.sc));
      const tCons = consonantKey(tScript);
      if (sCons.length > 0 && tCons.length > 0) {
        const shared = [...new Set(sCons)].filter((ch) => tCons.includes(ch)).length;
        if (shared < 2) continue;
      }
    }
    const sourceBaseLen = sourceScript.normalize('NFD').replace(/[\u0300-\u036f\u0591-\u05c7]/g, '').replace(/[^\p{L}]/gu, '').length;
    const targetBaseLen = tScript.normalize('NFD').replace(/[\u0300-\u036f\u0591-\u05c7]/g, '').replace(/[^\p{L}]/gu, '').length;
    if (srcPrefix === 'G' && lType === 'derived_from' && sourceBaseLen >= 2 && sourceBaseLen <= 5 && targetBaseLen >= sourceBaseLen + 2) {
      lType = 'related_compound_or_cognate';
    }
    const rootLabel = firstNonEmpty(lr.root);
    let relGloss = firstNonEmpty(lr.gloss);
    if (relGloss && sourceGloss && tBs !== strongs && sourceCons && consonantKey(tScript) !== sourceCons && relGloss.toLowerCase() === sourceGloss.toLowerCase()) {
      relGloss = tBs === 'H4519' ? 'Manasseh' : '';
    }
    const lexText = `${rootLabel} ${tScript} ${relGloss}`;
    const looksCompoundPlaceLex = !isProperProfile && (/^[A-Z][a-z]+-[a-z]+/i.test(relGloss) || /ephes-dammim|אֶ[\u0591-\u05c7]*פֶס\s+דַ[\u0591-\u05c7]*מִ[\u0591-\u05c7]*ים|\b(?:ephes|dammim|place|valley|boundary)\b/i.test(lexText));
    if (looksCompoundPlaceLex) continue;
    const lexSource = srcPrefix === 'G' ? 'STEPBible / GreekLexicon' : 'STEPBible / OpenScriptures HebrewLexicon';
    if (rootLabel && roots.length === 0) {
      roots.push({
        root_key: `profile_root:${strongs}`,
        root_script: rootLabel,
        relation_type: lType,
        source: lexSource,
      });
    }
    if (!relatives.some((rel) => firstNonEmpty(rel.strongs, rel.base_strongs, rel.target_strongs) === tBs)) {
      relatives.push({
        strongs: tBs,
        script: tScript,
        ...(relGloss ? { gloss: relGloss } : {}),
        relation_type: lType,
        ...(rootLabel ? { root: rootLabel } : {}),
        source: lexSource,
      });
    }
  }

  const documentedStrongsSet = new Set<string>(
    relatives.map((r) => padStrongs(firstNonEmpty(r.strongs, r.base_strongs, r.target_strongs))).filter(Boolean),
  );

  const orthEntry = asRecord(profile?.orth_entry);
  const profileCandidates = [
    ...asArray(orthEntry?.homographs),
    ...asArray(orthEntry?.candidates),
  ];
  let spellingSuggestions = mapSpellingSuggestions(profileCandidates, safeLimit)
    .filter((s) => !documentedStrongsSet.has(padStrongs(firstNonEmpty(s.strongs))));

  if (spellingSuggestions.length === 0 && !formationTimedOut) {
    try {
      const orthRows = await withEtymTimeout(
        callRpc(
          read,
          'suggest_orthographic_candidates_v1',
          { p_query: strongs, p_limit: safeLimit },
          1,
          0,
        ),
        2000,
        [],
      );
      const first = asRecord(orthRows[0]);
      const rawCandidates = first
        ? [...asArray(first.homographs), ...asArray(first.candidate_connections), ...asArray(first.candidates), ...asArray(first.items)]
        : orthRows;
      spellingSuggestions = mapSpellingSuggestions(rawCandidates, safeLimit)
        .filter((s) => !documentedStrongsSet.has(padStrongs(firstNonEmpty(s.strongs))));
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
  if (isProperProfile) {
    noteParts.push('For proper names, Scripture often uses narrative paronomasia (sound-play explanation) distinct from comparative ANE historical etymology.');
  }
  if (spellingSuggestions.length > 0) noteParts.push(ORTHOGRAPHIC_WARNING);

  return {
    status: hasDocumented ? 'documented' : 'unavailable',
    ...(activeLemmaKey ? { lemma_key: activeLemmaKey } : {}),
    ...(roots.length > 0 ? { roots: roots.slice(0, safeLimit) } : {}),
    ...(formations.length > 0 ? { formations: formations.slice(0, safeLimit) } : {}),
    ...(relatives.length > 0 ? { relatives: relatives.slice(0, safeLimit) } : {}),
    ...(nonEtymologicalGroupings.length > 0 ? { non_etymological_groupings: nonEtymologicalGroupings.slice(0, safeLimit) } : {}),
    ...(otherHomographRoots.length > 0 ? { other_homograph_roots: otherHomographRoots.slice(0, 3) } : {}),
    ...(components.length > 0 ? { morphological_components: components } : {}),
    ...(spellingSuggestions.length > 0 ? { spelling_suggestions: spellingSuggestions } : {}),
    note: noteParts.join(' '),
  };
}

// CC BY 4.0 OEWN 2025 human-readable synset labels for external property bridges.
const OEWN_SYNSET_LABELS: Readonly<Record<string, string>> = {
  'oewn:00019308-n': 'natural object',
  'oewn:00020270-n': 'substance',
  'oewn:00836693-n': 'breath',
  'oewn:02415086-n': 'lamb',
  'oewn:02882960-n': 'bow',
  'oewn:02951254-n': 'candelabrum, candelabra',
  'oewn:02951993-n': 'candlestick, candle holder',
  'oewn:03187746-n': 'device',
  'oewn:03307066-n': 'excavation',
  'oewn:03579967-n': 'instrument',
  'oewn:03641539-n': 'lamp',
  'oewn:03670692-n': 'light, light source',
  'oewn:03751646-n': 'menorah',
  'oewn:04270870-n': 'source of illumination',
  'oewn:04463386-n': 'torch',
  'oewn:04569944-n': 'water system, water supply, water',
  'oewn:04572661-n': 'weapon, arm, weapon system',
  'oewn:04579630-n': 'well',
  'oewn:04589115-n': 'wick, taper',
  'oewn:04966849-n': 'chromatic color, chromatic colour, spectral color',
  'oewn:04969961-n': 'red, redness',
  'oewn:04972154-n': 'scarlet, vermilion, orange red',
  'oewn:05271349-n': 'body substance',
  'oewn:05305022-n': 'organ',
  'oewn:05306677-n': 'sense organ, sensory receptor, receptor',
  'oewn:05318579-n': 'eye, oculus, optic',
  'oewn:05404811-n': 'liquid body substance, bodily fluid, body fluid',
  'oewn:05407190-n': 'blood',
  'oewn:07571428-n': 'solid food',
  'oewn:07581905-n': 'foodstuff, food product',
  'oewn:07582428-n': 'starches',
  'oewn:07637670-n': 'baked goods',
  'oewn:07687880-n': 'edible fat',
  'oewn:07689142-n': 'vegetable oil, oil',
  'oewn:07695101-n': 'bread, breadstuff, staff of life',
  'oewn:07699909-n': 'matzo, matzoh, matzah',
  'oewn:07721456-n': 'produce, green goods, green groceries',
  'oewn:07721676-n': 'edible fruit',
  'oewn:07769089-n': 'fig',
  'oewn:07784670-n': 'pomegranate',
  'oewn:07818393-n': 'grain, food grain, cereal',
  'oewn:07819069-n': 'barley, barleycorn',
  'oewn:07819521-n': 'wheat, wheat berry',
  'oewn:07825072-n': 'ingredient, fixings',
  'oewn:07825344-n': 'flavorer, flavourer, flavoring',
  'oewn:07829083-n': 'salt, table salt, common salt',
  'oewn:09262646-n': 'celestial body, heavenly body',
  'oewn:09310874-n': 'geological formation, formation',
  'oewn:09426302-n': 'rainbow',
  'oewn:09438954-n': 'rock, stone',
  'oewn:09466357-n': 'spring, fountain, outflow',
  'oewn:09467004-n': 'star',
  'oewn:09473603-n': 'sun',
  'oewn:11441515-n': 'actinic radiation, actinic ray',
  'oewn:11445694-n': 'atmospheric phenomenon',
  'oewn:11471253-n': 'electromagnetic radiation, electromagnetic wave, nonparticulate radiation',
  'oewn:11494354-n': 'light, visible light, visible radiation',
  'oewn:11528510-n': 'smoke, fume',
  'oewn:11545095-n': 'weather, weather condition, conditions',
  'oewn:11546388-n': 'wind, air current, current of air',
  'oewn:11643556-n': 'cedar, cedar tree, true cedar',
  'oewn:11643755-n': 'cedar, cedarwood',
  'oewn:11696293-n': 'reproductive structure',
  'oewn:11699219-n': 'ovule',
  'oewn:11704458-n': 'seed',
  'oewn:12226211-n': 'herb, herbaceous plant',
  'oewn:12421840-n': 'fig tree',
  'oewn:12422189-n': 'fig, common fig, common fig tree',
  'oewn:12869259-n': 'hyssop, Hyssopus officinalis',
  'oewn:13104346-n': 'vascular plant, tracheophyte',
  'oewn:13121436-n': 'vine',
  'oewn:13124818-n': 'tree',
  'oewn:13155706-n': 'fruit',
  'oewn:13165571-n': 'grape, grapevine, grape vine',
  'oewn:13461236-n': 'bodily process, body process, bodily function',
  'oewn:13471379-n': 'combustion, burning',
  'oewn:13502051-n': 'fire, flame, flaming',
  'oewn:13547313-n': 'organic process, biological process',
  'oewn:13551611-n': 'oxidation, oxidization, oxidisation',
  'oewn:13557219-n': 'phase change, phase transition, state change',
  'oewn:13578096-n': 'smoke, smoking',
  'oewn:13593639-n': 'vaporization, vaporisation, vapor',
  'oewn:13890262-n': 'curve, curved shape',
  'oewn:13918793-n': 'bow, arc',
  'oewn:14604877-n': 'material, stuff',
  'oewn:14610949-n': 'alloy, metal',
  'oewn:14643012-n': 'binary compound',
  'oewn:14647071-n': 'chemical element, element',
  'oewn:14649636-n': 'metallic element, metal',
  'oewn:14651259-n': 'noble metal',
  'oewn:14659900-n': 'copper, Cu, atomic number 29',
  'oewn:14662977-n': 'gold, Au, atomic number 79',
  'oewn:14666595-n': 'iron, Fe, atomic number 26',
  'oewn:14679133-n': 'silver, Ag, atomic number 47',
  'oewn:14724906-n': 'animal product',
  'oewn:14741436-n': 'bronze',
  'oewn:14837352-n': 'clay',
  'oewn:14842408-n': 'compound, chemical compound',
  'oewn:14845213-n': 'conductor',
  'oewn:14846733-n': 'copper-base alloy',
  'oewn:14865437-n': 'air',
  'oewn:14865940-n': 'breath',
  'oewn:14867162-n': 'earth, ground',
  'oewn:14868863-n': 'soil, dirt',
  'oewn:14869913-n': 'water, H2O',
  'oewn:14888511-n': 'fat',
  'oewn:14901736-n': 'gas',
  'oewn:14958169-n': 'leaven, leavening',
  'oewn:14963583-n': 'fluid',
  'oewn:14964238-n': 'liquid',
  'oewn:14983373-n': 'natural fiber, natural fibre',
  'oewn:14983611-n': 'animal fiber, animal fibre',
  'oewn:14991055-n': 'oil',
  'oewn:15016279-n': 'plant material, plant substance',
  'oewn:15122728-n': 'wood',
  'oewn:15128784-n': 'wool',
};

const OEWN_ID_RE = /^oewn:\d{8}-[nvars]$/i;

function resolveOewnReadableLabel(rawIdOrLabel: string, fallbackText = ''): string {
  const key = rawIdOrLabel.trim().toLowerCase();
  if (OEWN_SYNSET_LABELS[key]) return OEWN_SYNSET_LABELS[key];
  if (OEWN_ID_RE.test(key)) {
    return fallbackText || 'broader lexical concept (OEWN)';
  }
  return rawIdOrLabel;
}

function normalizeBridgeEntry(raw: Record<string, unknown>): Record<string, unknown> {
  const propKey = firstNonEmpty(raw.property_key, raw.property);
  const origin = firstNonEmpty(raw.assertion_origin);
  const rawValueId = firstNonEmpty(raw.value_id, raw.oewn_id);
  const rawValueLabel = firstNonEmpty(raw.value_label, raw.value, raw.label);
  const isOewn = propKey.startsWith('oewn:') || origin.toUpperCase().includes('OEWN') || OEWN_ID_RE.test(rawValueId) || OEWN_ID_RE.test(rawValueLabel);
  const isWikidata = !isOewn && (propKey.startsWith('wd:') || origin.toUpperCase().includes('WIKIDATA') || rawValueId.startsWith('wd:'));
  const source = firstNonEmpty(
    raw.source,
    raw.dataset,
    raw.origin,
    isOewn ? 'OEWN 2025' : isWikidata ? 'Wikidata' : 'OEWN / Wikidata',
  );
  const license = firstNonEmpty(
    raw.license,
    isOewn ? 'CC BY 4.0' : source.toLowerCase().includes('wikidata') ? 'CC0' : 'CC BY 4.0',
  );
  const resolvedValueId = rawValueId || (OEWN_ID_RE.test(rawValueLabel) ? rawValueLabel.toLowerCase() : '');
  const fallbackDesc = firstNonEmpty(raw.label, raw.gloss, raw.definition, raw.sense_gloss);
  const cleanFallbackDesc = OEWN_ID_RE.test(fallbackDesc) ? '' : fallbackDesc;
  const resolvedValueLabel = OEWN_ID_RE.test(rawValueLabel)
    ? resolveOewnReadableLabel(rawValueLabel, cleanFallbackDesc)
    : rawValueLabel || (resolvedValueId ? resolveOewnReadableLabel(resolvedValueId, cleanFallbackDesc) : '');
  const propertyLabel = firstNonEmpty(
    raw.property_label,
    propKey === 'oewn:hypernym'
      ? 'hypernym (broader category)'
      : propKey === 'oewn:hypernym_l2'
        ? 'hypernym L2 (higher category)'
        : '',
  );
  return {
    ...raw,
    ...(propertyLabel ? { property_label: propertyLabel } : {}),
    ...(resolvedValueId ? { value_id: resolvedValueId } : {}),
    ...(resolvedValueLabel ? { value_label: resolvedValueLabel } : {}),
    source,
    license,
  };
}

// Sense-gated physical/process ontology properties from v3 sense-ontology (CC BY 4.0 OEWN 2025 / CC0 Wikidata).
const V3_SENSE_PHYSICAL_PROPS: Readonly<Record<string, {
  domain: string;
  props: Record<string, string | boolean>;
  senseRequireRe?: RegExp;
  senseRejectRe?: RegExp;
}>> = {
  H6884: { domain: 'metallurgy', props: { process: 'cupellation_refining', agent_medium: 'fire', removes: 'dross', tests_purity: true } },
  H0974: { domain: 'metallurgy', props: { process: 'metallurgical_assay', tests_purity: true } },
  H5509: { domain: 'metallurgy', props: { material_role: 'impurity_byproduct', separated_by: 'cupellation_refining', physical_state: 'solid_slag' } },
  H1253: { domain: 'metallurgy', props: { material_role: 'alkali_flux', process: 'cupellation_refining', chemical_action: 'saponification_and_flux' }, senseRejectRe: /\bclean(?:ness|se)?\b/i },
  H3564: { domain: 'metallurgy', props: { apparatus: 'smelting_furnace', energy_source: 'fire', process: 'cupellation_refining' } },
  H3536: { domain: 'metallurgy', props: { apparatus: 'kiln_furnace', energy_source: 'fire', process: 'calcination' } },
  H0861: { domain: 'metallurgy', props: { apparatus: 'smelting_furnace', energy_source: 'fire' } },
  G2575: { domain: 'metallurgy', props: { apparatus: 'smelting_furnace', energy_source: 'fire' } },
  G4448: { domain: 'metallurgy', props: { process: 'thermal_refining', agent_medium: 'fire' } },
  G1381: { domain: 'metallurgy', props: { process: 'metallurgical_assay', tests_purity: true } },
  H3701: { domain: 'metallurgy', props: { metal: 'silver', refined_by: 'cupellation_refining' } },
  G0696: { domain: 'metallurgy', props: { metal: 'silver', refined_by: 'cupellation_refining' } },
  H2091: { domain: 'metallurgy', props: { metal: 'gold', refined_by: 'cupellation_refining' } },
  G5557: { domain: 'metallurgy', props: { metal: 'gold', refined_by: 'cupellation_refining' } },
  H5178: { domain: 'metallurgy', props: { metal: 'copper_bronze' } },
  G5475: { domain: 'metallurgy', props: { metal: 'copper_bronze' } },
  H4647: { domain: 'metallurgy', props: { apparatus: 'bellows', supplies: 'air_draft', process: 'cupellation_refining' } },
  H4715: { domain: 'metallurgy', props: { apparatus: 'crucible', process: 'cupellation_refining' } },
  H0216: { domain: 'optics', props: { phenomenon: 'visible_light', emits_illumination: true } },
  G5457: { domain: 'optics', props: { phenomenon: 'visible_light', emits_illumination: true } },
  H5216: { domain: 'optics', props: { apparatus: 'oil_lamp', fuel: 'olive_oil', emits_illumination: true } },
  G3088: { domain: 'optics', props: { apparatus: 'oil_lamp', fuel: 'olive_oil', emits_illumination: true } },
  H4501: { domain: 'optics', props: { apparatus: 'lampstand', holds: 'oil_lamp', emits_illumination: true } },
  G3087: { domain: 'optics', props: { apparatus: 'lampstand', holds: 'oil_lamp', emits_illumination: true } },
  H3940: { domain: 'optics', props: { apparatus: 'torch', emits_illumination: true } },
  G2985: { domain: 'optics', props: { apparatus: 'torch_lamp', emits_illumination: true } },
  H0784: { domain: 'optics', props: { phenomenon: 'combustion', emits_heat_and_light: true } },
  G4442: { domain: 'optics', props: { phenomenon: 'combustion', emits_heat_and_light: true } },
  H4325: { domain: 'hydrology', props: { substance: 'water', physical_state: 'liquid' } },
  G5204: { domain: 'hydrology', props: { substance: 'water', physical_state: 'liquid' } },
  G4077: { domain: 'hydrology', props: { landform: 'natural_spring', yields: 'water' } },
  H4599: { domain: 'hydrology', props: { landform: 'natural_spring', yields: 'water' } },
  H5104: { domain: 'hydrology', props: { landform: 'river', contains: 'water' } },
  G4215: { domain: 'hydrology', props: { landform: 'river', contains: 'water' } },
  H5158: { domain: 'hydrology', props: { landform: 'wadi_seasonal_stream', contains: 'water' }, senseRejectRe: /\bpalm\b/i },
  H5869: { domain: 'hydrology', props: { landform: 'natural_spring', yields: 'water' }, senseRequireRe: /\b(?:spring|fountain|well)\b/i },
  H0730: { domain: 'botany', props: { organism: 'cedrus_libani', material: 'aromatic_timber' } },
  H0231: { domain: 'botany', props: { organism: 'hyssop', ritual_use: 'sprinkling_cleansing' } },
  G5301: { domain: 'botany', props: { organism: 'hyssop', ritual_use: 'sprinkling_cleansing' } },
  H2132: { domain: 'botany', props: { organism: 'olive_tree', yields: 'olive_oil' } },
  G1636: { domain: 'botany', props: { organism: 'olive_tree', yields: 'olive_oil' } },
  H2233: { domain: 'botany', props: { botanical_part: 'seed', biological_role: 'reproduction' } },
  G4690: { domain: 'botany', props: { botanical_part: 'seed', biological_role: 'reproduction' } },
  H4671: { domain: 'botany', props: { agricultural_byproduct: 'chaff', separated_by: 'winnowing' } },
  G0892: { domain: 'botany', props: { agricultural_byproduct: 'chaff', separated_by: 'winnowing' } },
  H7898: { domain: 'botany', props: { plant_form: 'thorny_shrub' } },
  H1612: { domain: 'botany', props: { organism: 'vitis_vinifera_vine', yields: 'grapes_wine' } },
  G0288: { domain: 'botany', props: { organism: 'vitis_vinifera_vine', yields: 'grapes_wine' } },
  H4417: { domain: 'minerals', props: { mineral: 'halite_salt', preserves_and_seasons: true, covenant_emblem: 'incorruptibility' } },
  G0217: { domain: 'minerals', props: { mineral: 'halite_salt', preserves_and_seasons: true } },
  H3722: { domain: 'materials', props: { substance: 'bitumen_pitch', process: 'waterproofing_sealing' }, senseRequireRe: /\b(?:pitch|cover|coat)\b/i },
  H0068: { domain: 'minerals', props: { mineral: 'stone' } },
  G3037: { domain: 'minerals', props: { mineral: 'stone' } },
};

function resolveSenseGatedPhysicalProps(
  strongs: string,
  gloss: string,
  profile: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const padBs = padStrongs(strongs);
  const lk = firstNonEmpty(profile?.lk, profile?.lemma_key);
  const senseContext = `${gloss} ${lk}`;
  const rawProfProps = asRecord(profile?.physical_props);
  const curated = padBs ? V3_SENSE_PHYSICAL_PROPS[padBs] : undefined;
  if (curated) {
    if (curated.senseRequireRe && !curated.senseRequireRe.test(senseContext)) return null;
    if (curated.senseRejectRe && curated.senseRejectRe.test(senseContext)) return null;
    return {
      domain: curated.domain,
      ...(rawProfProps ?? {}),
      ...curated.props,
    };
  }
  return rawProfProps ? { ...rawProfProps } : null;
}

/**
 * Combine biblical/physical definitions, OEWN/Wikidata property bridges, and
 * sense-gated v3 physical/process properties with explicit source/license attribution.
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
  const seenBridges = new Set<string>();
  const propertyBridges: Record<string, unknown>[] = [];
  for (const rawB of rawBridges) {
    const b = asRecord(rawB);
    if (!b) continue;
    const norm = normalizeBridgeEntry(b);
    const dedupKey = `${firstNonEmpty(norm.property_key, norm.property)}|${firstNonEmpty(norm.value_label, norm.value)}|${firstNonEmpty(norm.target_strongs)}`;
    if (seenBridges.has(dedupKey)) continue;
    seenBridges.add(dedupKey);
    propertyBridges.push(norm);
  }

  const physicalProperties = resolveSenseGatedPhysicalProps(strongs, gloss, profile);

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
        .map((c) => {
          const valLbl = firstNonEmpty(c.value_label, c.label, c.value);
          if (OEWN_ID_RE.test(valLbl)) {
            return normalizeBridgeEntry(c);
          }
          return c;
        })
        .slice(0, 8);
    } catch {
      // Concept property RPC may be unavailable for some terms/environments.
    }
  }

  if (!biblicalDef && !physicalDef && !physicalProperties && propertyBridges.length === 0 && conceptProperties.length === 0) {
    return {
      status: 'unavailable',
      note: 'No supported physical/real-world definition recorded for this word.',
    };
  }

  const sources: string[] = [];
  if (biblicalDef || physicalDef) sources.push('Biblical lexicon');
  if (physicalProperties) sources.push('v3 sense-ontology (CC BY 4.0)');
  if (propertyBridges.length > 0) sources.push('OEWN (CC BY 4.0) / Wikidata (CC0)');
  if (conceptProperties.length > 0) sources.push('Corpus concept properties');

  return {
    status: 'ok',
    ...(biblicalDef ? { biblical_def: biblicalDef } : {}),
    ...(physicalDef ? { physical_def: physicalDef } : {}),
    ...(physicalProperties ? { physical_properties: physicalProperties } : {}),
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
