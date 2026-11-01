// @file: src/api/rpc.ts
// @feature: api
// @tables: words | verses | verse_translation_sources | word_translation_choices | chronology_models | chronology_runs | chronology_assertions | chronology_evidence | places | place_locations | verse_geography | passage_geography | geography_sources | lexemes | concepts | assertions | assertion_evidence
// @candidates: none
// @toc: imports | logic:sample-words | logic:sample-verses | logic:request | logic:chronology | logic:geography | logic:translations | logic:hydrated-research | logic:gateway

// === @section:imports ===
import { ensureReaderSession, restoreReaderSession, supabase } from './supabase';
import type { ActivePassage, ChronologyResponse, DataResult, HydratedCoOccurrence,
  RelationshipResearchPacket, TranslationSaveResult, VerseGeographyResponse, VerseTranslationToken,
  VerseWordToken, WordOccurrence, WordRecord, WordRelationship, VerseResearchRequest, VerseResearchResponse } from './types';

// === @section:logic:sample-words ===
// Negative IDs isolate fixtures from the database's positive word IDs.
const entries: [number, string, string, string, string, string, string][] = [
  [-1, 'בְּרֵאשִׁית', 'bə·rê·šîṯ', 'H7225', 'HR/Ncfsa', 'in beginning', 'The beginning or first part; here with the prefix “in”.'],
  [-2, 'בָּרָא', 'bā·rā', 'H1254', 'HVqp3ms', 'he created', 'To create; here a completed action with God as subject.'],
  [-3, 'אֱלֹהִים', '’ĕ·lō·hîm', 'H430', 'HNcmpa', 'God', 'God; a plural noun form used here with a singular verb.'],
  [-4, 'אֵת', '’êṯ', 'H853', 'HTo', '[object marker]', 'Marks the definite direct object; usually untranslated.'],
  [-5, 'הַשָּׁמַיִם', 'haš·šā·ma·yim', 'H8064', 'HTd/Ncmpa', 'the heavens', 'The heavens or sky, with the definite article.'],
  [-6, 'וְאֵת', 'wə·’êṯ', 'H853', 'HC/To', 'and [object marker]', 'The conjunction “and” attached to the direct-object marker.'],
  [-7, 'הָאָרֶץ', 'hā·’ā·reṣ', 'H776', 'HTd/Ncbsa', 'the earth', 'The earth or land, with the definite article.'],
  [-8, 'Ἐν', 'en', 'G1722', 'PREP', 'in', 'In, within, or among; here introducing a time expression.'],
  [-9, 'ἀρχῇ', 'archē', 'G746', 'N-DSF', 'beginning', 'Beginning or origin; here in the dative singular.'],
  [-10, 'ἦν', 'ēn', 'G1510', 'V-IAI-3S', 'was', 'To be or exist; imperfect active indicative, third person singular.'],
  [-11, 'ὁ', 'ho', 'G3588', 'T-NSM', 'the', 'The definite article; nominative masculine singular.'],
  [-12, 'λόγος', 'logos', 'G3056', 'N-NSM', 'Word', 'Word, speech, or account; here the Word in John’s prologue.'],
  [-13, 'καὶ', 'kai', 'G2532', 'CONJ', 'and', 'And, also, or even; connects the clauses here.'],
  [-14, 'πρὸς', 'pros', 'G4314', 'PREP', 'with', 'Toward or with; here with the accusative, expressing relationship.'],
  [-15, 'τὸν', 'ton', 'G3588', 'T-ASM', 'the', 'The definite article; accusative masculine singular.'],
  [-16, 'θεόν', 'theon', 'G2316', 'N-ASM', 'God', 'God; accusative masculine singular after the preposition.'],
  [-17, 'θεὸς', 'theos', 'G2316', 'N-NSM', 'God', 'God; nominative masculine singular in the final clause.'],
];
const sampleWords = new Map<number, WordRecord>(entries.map(([id, original_word,
  transliteration, strongs_nr, grammar_code, english, biblical_def]) => [id, {
  id, original_word, transliteration, strongs_nr, grammar_code, biblical_def,
  physical_def: null, english_translations: [english], co_occurrences: [],
}]));

// === @section:logic:sample-verses ===
const sample: Record<string, VerseWordToken[]> = {};
// Fixture sequences only. Production word ordering and hydration stay in SQL.
for (const [key, ids, millennium] of [
  ['1-1-1', [-1, -2, -3, -4, -5, -6, -7], 1],
  ['43-1-1', [-8, -9, -10, -11, -12, -13, -11, -12, -10, -14, -15, -16, -13, -17, -10, -11, -12], null],
] as const) {
  sample[key] = ids.map((id, index) => {
    const word = sampleWords.get(id)!;
    return { word_id: id, word_position: index + 1, original_word: word.original_word,
      transliteration: word.transliteration, strongs_nr: word.strongs_nr,
      grammar_code: word.grammar_code, primary_english: word.english_translations![0], millennium };
  });
}
// Illustrative, pre-authored fixture metadata; never a corpus-wide statistic.
const sampleRelated: Record<number, HydratedCoOccurrence[]> = {
  [-1]: [
    { word_id: -2, original_word: 'בָּרָא', transliteration: 'bā·rā', strongs_nr: 'H1254', primary_english: 'created', score: 0.5, frequency: 1, avg_distance: 1 },
    { word_id: -3, original_word: 'אֱלֹהִים', transliteration: '’ĕ·lō·hîm', strongs_nr: 'H430', primary_english: 'God', score: 0.33, frequency: 1, avg_distance: 2 },
  ],
  [-12]: [
    { word_id: -10, original_word: 'ἦν', transliteration: 'ēn', strongs_nr: 'G1510', primary_english: 'was', score: 0.5, frequency: 1, avg_distance: 2 },
    { word_id: -17, original_word: 'θεὸς', transliteration: 'theos', strongs_nr: 'G2316', primary_english: 'God', score: 0.25, frequency: 1, avg_distance: 3 },
  ],
};
const sampleQueryWord = (query: string | number) => [...sampleWords.values()].find(word =>
  String(word.id) === String(query) || word.strongs_nr === query || word.transliteration === query);
const result = <T>(data: T, source: DataResult<T>['source'], error: string | null = null): DataResult<T> =>
  ({ data, source, error });

// === @section:logic:request ===
async function rpc<T>(name: string, args: Record<string, unknown>, timeoutMs = 1500): Promise<DataResult<T[]>> {
  if (!supabase) return result([], 'unavailable', 'Database connection is not configured.');
  try {
    const { data, error } = await supabase.rpc(name, args).abortSignal(AbortSignal.timeout(timeoutMs));
    if (error) return result([], 'unavailable', 'The database is unavailable.');
    return result((data ?? []) as T[], 'live');
  } catch { return result([], 'unavailable', 'The database is unavailable.'); }
}
async function wordDetails(wordId: number): Promise<DataResult<WordRecord | null>> {
  if (wordId < 0) return result(sampleWords.get(wordId) ?? null, 'sample');
  if (!supabase) return result(null, 'unavailable');
  try {
    const { data, error } = await supabase.from('words').select('*').eq('id', wordId)
      .abortSignal(AbortSignal.timeout(1500)).maybeSingle();
    return error ? result(null, 'unavailable', 'Word details are unavailable.') : result(data, 'live');
  } catch { return result(null, 'unavailable', 'Word details are unavailable.'); }
}

// === @section:logic:chronology ===
async function verseChronology(p: ActivePassage, modelId = 'theographic-verse-v1', runId?: string, cursor?: string)
  : Promise<DataResult<ChronologyResponse | null>> {
  if (!supabase) return result(null, 'unavailable', 'Chronology is not configured.');
  try {
    const { data, error } = await supabase.rpc('get_verse_chronology_v1', {
      p_book: p.book, p_chapter: p.chapter, p_verse: p.verse, p_model_id: modelId,
      p_run_id: runId ?? null, p_evidence_cursor: cursor ?? null,
    }).abortSignal(AbortSignal.timeout(8000));
    if (error || !data || data.schema_version !== 1) return result(null, 'unavailable', 'Chronology could not be loaded. Try again.');
    return result(data as ChronologyResponse, 'live');
  } catch { return result(null, 'unavailable', 'Chronology could not be loaded. Try again.'); }
}

// === @section:logic:geography ===
const geographyCache = new Map<string, VerseGeographyResponse>();
async function verseGeography(p: ActivePassage): Promise<DataResult<VerseGeographyResponse | null>> {
  const key = `${p.book}-${p.chapter}-${p.verse}`;
  const cached = geographyCache.get(key);
  if (cached) return result(cached, 'live');
  if (!supabase) return result(null, 'unavailable', 'Geography is not configured.');
  try {
    const { data, error } = await supabase.rpc('get_verse_geography', {
      p_book: p.book, p_chapter: p.chapter, p_verse: p.verse,
    }).abortSignal(AbortSignal.timeout(6000));
    if (error || !data || data.schema_version !== 1) return result(null, 'unavailable', 'Geography could not be loaded. Try again.');
    const packet = data as VerseGeographyResponse;
    if (packet.status === 'ok') {
      if (geographyCache.size >= 250) {
        const firstKey = geographyCache.keys().next().value;
        if (firstKey) geographyCache.delete(firstKey);
      }
      geographyCache.set(key, packet);
    }
    return result(packet, 'live');
  } catch { return result(null, 'unavailable', 'Geography could not be loaded. Try again.'); }
}
async function researchRelationships(subject: string, target?: string): Promise<DataResult<RelationshipResearchPacket | null>> {
  if (!supabase) return result(null, 'unavailable', 'Relationship research is not configured.');
  try {
    const p_request = {
      subject: { text: subject },
      ...(target ? { target: { text: target }, mode: 'explain' } : { mode: 'discover' }),
      corpus: 'primary',
    };
    const { data, error } = await supabase.rpc('research_relationships_v1', { p_request }).abortSignal(AbortSignal.timeout(6000));
    if (error || !data || data.schema_version !== 1) return result(null, 'unavailable', 'Relationship research could not be loaded.');
    return result(data as RelationshipResearchPacket, 'live');
  } catch { return result(null, 'unavailable', 'Relationship research could not be loaded.'); }
}

// === @section:logic:translations ===
async function sessionDeadline<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Your reader session timed out. Please retry.')), 10000);
    })]);
  } finally { clearTimeout(timer); }
}
function sampleTranslations(p: ActivePassage): VerseTranslationToken[] {
  return (sample[`${p.book}-${p.chapter}-${p.verse}`] ?? []).map(token => ({
    ...token, source_english: token.primary_english, english_translations: [token.primary_english ?? ''],
    selected_english: null, has_choice: false, source_ref: null,
  }));
}
async function verseTranslations(p: ActivePassage): Promise<DataResult<VerseTranslationToken[]>> {
  let sessionError: string | null = null;
  if (supabase) {
    try { await sessionDeadline(restoreReaderSession()); }
    catch (error) { sessionError = error instanceof Error ? error.message : 'Saved translations could not be restored.'; }
    const live = await rpc<VerseTranslationToken>('get_verse_translations_v1', {
      p_book: p.book, p_chapter: p.chapter, p_verse: p.verse,
    }, 8000);
    if (live.data.length) return { ...live, error: sessionError };
    const fixture = sampleTranslations(p);
    return fixture.length ? result(fixture, 'sample', live.error ?? sessionError) : live;
  }
  const fixture = sampleTranslations(p);
  return result(fixture, fixture.length ? 'sample' : 'unavailable', 'Database connection is not configured.');
}
async function saveTranslation(p: ActivePassage, token: VerseWordToken, english: string | null)
  : Promise<DataResult<TranslationSaveResult | null>> {
  if (token.word_id < 0) return result(null, 'sample', 'Sample translation choices are not saved.');
  if (!supabase) return result(null, 'unavailable', 'Database connection is not configured.');
  try {
    await sessionDeadline(ensureReaderSession());
    const args = { p_book: p.book, p_chapter: p.chapter, p_verse: p.verse,
      p_word_position: token.word_position, p_word_id: token.word_id };
    const { data, error } = english === null
      ? await supabase.rpc('reset_word_translation_v1', args).abortSignal(AbortSignal.timeout(8000))
      : await supabase.rpc('save_word_translation_v1', { ...args, p_english: english }).abortSignal(AbortSignal.timeout(8000));
    if (error || !data || typeof data.saved !== 'boolean' || typeof data.english !== 'string') {
      return result(null, 'unavailable', 'Your translation could not be saved. Please retry.');
    }
    return result(data as TranslationSaveResult, 'live');
  } catch (error) {
    return result(null, 'unavailable', error instanceof Error ? error.message : 'Your translation could not be saved. Please retry.');
  }
}

// === @section:logic:hydrated-research ===
async function verseResearch(request: VerseResearchRequest): Promise<DataResult<VerseResearchResponse | null>> {
  if (!supabase) return result(null, 'unavailable', 'Research database is not configured.');
  try {
    const { data, error } = await supabase.rpc('get_verse_research_v1', { p_request: request })
      .abortSignal(AbortSignal.timeout(12000));
    if (error || !data || data.schema_version !== 1) {
      return result(null, 'unavailable', 'Verse research could not be loaded. Try again.');
    }
    return result(data as VerseResearchResponse, 'live');
  } catch { return result(null, 'unavailable', 'Verse research could not be loaded. Try again.'); }
}

// === @section:logic:gateway ===
export const BibleRPC = {
  getVerseResearch: verseResearch,
  getSampleTranslations: sampleTranslations,
  getVerseTranslations: verseTranslations,
  saveTranslation,
  getSampleVerse(p: ActivePassage): VerseWordToken[] {
    return sample[`${p.book}-${p.chapter}-${p.verse}`] ?? [];
  },
  async getVerseWords(book: number, chapter: number, verse: number) {
    const live = await rpc<VerseWordToken>('prompt_verse_words', { p_book: book, p_chapter: chapter, p_verse: verse });
    if (live.data.length) return live;
    const fixture = this.getSampleVerse({ book, chapter, verse });
    return fixture.length ? result(fixture, 'sample') : live;
  },
  async getWordOccurrences(query: string | number): Promise<DataResult<WordOccurrence[]>> {
    const word = sampleQueryWord(query);
    if (typeof query === 'number' && query < 0 && word) {
      return result([{ book: word.id >= -7 ? 1 : 43, chapter: 1, verse_nr: 1,
        millennium: word.id >= -7 ? 1 : null, occurrence_count: [-10, -11, -12].includes(word.id) ? 3 : word.id === -13 ? 2 : 1 }], 'sample');
    }
    const live = await rpc<WordOccurrence>('prompt_word_occurrences', { p_word_query: String(query) });
    if (live.data.length || !word) return live;
    return this.getWordOccurrences(word.id);
  },
  async getWordCoOccurrences(query: string | number) {
    const word = sampleQueryWord(query);
    if (word && (typeof query === 'number' && query < 0)) return result(sampleRelated[word.id] ?? [], 'sample');
    const live = await rpc<HydratedCoOccurrence>('prompt_word_cooccurrences', { p_word_query: String(query) });
    return live.data.length || !word ? live : result(sampleRelated[word.id] ?? [], 'sample');
  },
  getWordRelationships(wordIds: number[]) {
    if (wordIds.some(id => id < 0)) return Promise.resolve(result<WordRelationship[]>([], 'sample'));
    return rpc<WordRelationship>('prompt_word_relationships', { p_word_ids: wordIds });
  },
  getWordDetails: wordDetails,
  getVerseChronology: verseChronology,
  getVerseGeography: verseGeography,
  researchRelationships,
  getWordPopupDetails: wordDetails,
  async resolveWordId(query: string): Promise<number | null> {
    if (!supabase) return null;
    try {
      const { data } = await supabase.rpc('resolve_word_id', { p_query: query }).abortSignal(AbortSignal.timeout(1500));
      return typeof data === 'number' && data > 0 ? data : null;
    } catch { return null; }
  },
};
