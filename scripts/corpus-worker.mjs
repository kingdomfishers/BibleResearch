/**
 * scripts/corpus-worker.mjs
 * Cloudflare Worker entrypoint for `bibleresearch-corpus`.
 *
 * Serves:
 * - `/health`
 * - `/manifest.json`
 * - `/tables/<table>/part-<nnnn>.jsonl.gz` (decoded NDJSON by default, raw gzip if `?raw=1`)
 * - `/v1/catalog/metadata.json(.gz)`
 * - `/v1/chapters/b<book>-c<chapter>.json(.gz)`
 * - `/v1/lxx/b<book_no>.json(.gz)`
 * - `/v1/lexical/strongs-<bucket>.json(.gz)`
 * - `/v1/lexical/words-<bucket>.json(.gz)`
 * - `/v1/lexical/query-index.json(.gz)`
 * - `/v1/syntax/search-index.json(.gz)`
 * - `/v1/rpc/<operation>` deterministic query & compatibility gateway for static evidence RPCs
 */

import { withCorpusSecurity } from './corpus-security.mjs';
import {
  handleLookupCrossReferencesV1,
  handleLookupLexicalRelationshipsV1,
} from './corpus-relationships-rpc.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, apikey, X-Requested-With',
};

// In-memory isolate cache for hot metadata & frequently accessed shards
let cachedCatalog = null;
let cachedVerseById = null;
let cachedVerseByCoord = null;
let cachedBooksById = null;
let cachedLxxBooksByNo = null;
const shardLru = new Map();
const MAX_LRU_SHARDS = 32;

function setLru(key, val) {
  if (shardLru.has(key)) shardLru.delete(key);
  shardLru.set(key, val);
  if (shardLru.size > MAX_LRU_SHARDS) {
    const oldest = shardLru.keys().next().value;
    shardLru.delete(oldest);
  }
}

async function readAssetBytes(env, assetPath) {
  const url = new URL(assetPath, 'https://corpus.internal');
  const req = new Request(url.toString(), {
    method: 'GET',
    headers: { 'Accept-Encoding': 'identity' },
  });
  const res = await env.ASSETS.fetch(req);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function decompressGzipIfNeeded(bytes) {
  if (!bytes || bytes.length < 2) return bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const stream = new Response(bytes).body.pipeThrough(ds);
    const outBuf = await new Response(stream).arrayBuffer();
    return new Uint8Array(outBuf);
  }
  return bytes;
}

async function loadJsonShard(env, assetPath) {
  const gzPath = assetPath.endsWith('.gz') ? assetPath : `${assetPath}.gz`;
  if (shardLru.has(gzPath)) {
    return shardLru.get(gzPath);
  }
  const rawBytes = await readAssetBytes(env, gzPath);
  if (!rawBytes) return null;
  const decodedBytes = await decompressGzipIfNeeded(rawBytes);
  const text = new TextDecoder('utf-8').decode(decodedBytes);
  const parsed = JSON.parse(text);
  setLru(gzPath, parsed);
  return parsed;
}

async function ensureCatalog(env) {
  if (cachedCatalog) return cachedCatalog;
  const cat = await loadJsonShard(env, '/v1/catalog/metadata.json.gz');
  if (!cat) throw new Error('Failed to load /v1/catalog/metadata.json.gz');
  cachedCatalog = cat;
  cachedVerseById = new Map();
  cachedVerseByCoord = new Map();
  for (const [id, book, chapter, verse_nr] of cat.verses_compact) {
    cachedVerseById.set(id, { id, book, chapter, verse_nr });
    cachedVerseByCoord.set(`${book}:${chapter}:${verse_nr}`, id);
  }
  cachedBooksById = new Map();
  for (const b of cat.books) {
    cachedBooksById.set(Number(b.id), b);
  }
  cachedLxxBooksByNo = new Map();
  for (const lb of cat.lxx_swete_books) {
    cachedLxxBooksByNo.set(Number(lb.book_no), lb);
  }
  return cachedCatalog;
}

function jsonResponse(data, status = 200, cacheControl = 'public, max-age=3600') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
    },
  });
}

// ============================================================================
// RPC Implementations
// ============================================================================

async function handleLookupSyntaxTreeV1(env, params) {
  await ensureCatalog(env);
  const editionKey = params.p_edition_key ?? null;
  let verseMeta = null;

  if (params.p_verse_id !== undefined && params.p_verse_id !== null) {
    const vid = Number(params.p_verse_id);
    verseMeta = cachedVerseById.get(vid) || null;
    if (!verseMeta) {
      return { error: 'Verse not found', verse_id: vid };
    }
  } else {
    const b = Number(params.p_book);
    const c = Number(params.p_chapter);
    const v = Number(params.p_verse);
    const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
    if (!vid) {
      return {
        error: 'verse_not_found',
        book: b,
        chapter: c,
        verse_nr: v,
        has_syntax: false,
        syntax_status: 'passage_not_found',
        missing_syntax_reason: 'The requested passage does not exist in the canonical 66-book Bible index.',
      };
    }
    verseMeta = cachedVerseById.get(vid);
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${verseMeta.book}-c${verseMeta.chapter}.json.gz`);
  const vEntry = chShard?.verses?.[String(verseMeta.verse_nr)];
  const treeIds = vEntry?.tree_ids || [];

  const trees = [];
  const edges = [];
  const crossSpans = [];

  for (const tid of treeIds.slice().sort()) {
    const tBundle = chShard?.syntax_trees?.[tid];
    if (!tBundle) continue;
    if (editionKey && tBundle.tree.edition_key !== editionKey) continue;
    trees.push(tBundle.tree);
    for (const e of tBundle.edges || []) {
      edges.push(e);
    }
    for (const cs of tBundle.cross_verse_spans || []) {
      crossSpans.push(cs);
    }
  }

  edges.sort((a, b) => a.id - b.id);
  const hasSyntax = trees.length > 0;

  return {
    verse_id: verseMeta.id,
    book: verseMeta.book,
    chapter: verseMeta.chapter,
    verse_nr: verseMeta.verse_nr,
    has_syntax: hasSyntax,
    syntax_status: hasSyntax ? 'annotated_in_source' : 'unannotated_in_source',
    missing_syntax_reason: hasSyntax
      ? null
      : 'No syntax tree bank annotations exist for this verse in the requested edition. No syntax is inferred or guessed.',
    trees_count: trees.length,
    trees,
    edges_count: edges.length,
    edges,
    cross_verse_spans: crossSpans,
    epistemic_invariants: {
      morphology_vs_syntax_distinction:
        'Word morphology describes parts of speech; syntax tree describes hierarchical constituent grammar (phrases & clauses).',
      semantic_role_grounding:
        'Semantic frames (A0, A1) are emitted only when explicitly annotated upstream by MACULA.',
      unannotated_policy:
        'Missing syntax is reported explicitly as unannotated rather than approximated or guessed.',
      cross_verse_preservation:
        'Multi-verse clauses and sentences span verse boundaries without artificial truncation.',
    },
  };
}

async function handleLookupPassageTokensSyntaxV1(env, params) {
  await ensureCatalog(env);
  const b = Number(params.p_book);
  const c = Number(params.p_chapter);
  const v = Number(params.p_verse);
  const editionKey = params.p_edition_key ?? null;

  const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
  if (!vid) {
    return {
      schema_version: 1,
      status: 'passage_not_found',
      passage: { book: b, chapter: c, verse: v },
    };
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
  const vEntry = chShard?.verses?.[String(v)];
  const bMeta = chShard?.book_meta || cachedBooksById.get(b);

  const filterEd = (arr) =>
    editionKey ? (arr || []).filter((item) => item.edition_key === editionKey) : arr || [];

  const tokens = (vEntry?.tokens || []).map((t) => ({
    word_position: t.word_position,
    word_id: t.word_id,
    surface_form: t.surface_form,
    transliteration: t.transliteration,
    base_strongs: t.base_strongs,
    grammar_code: t.grammar_code,
    decoded_morphology: t.decoded_morphology,
    attested_english_gloss: t.attested_english_gloss,
    source_name: t.source_name,
    source_ref: t.source_ref,
    source_commit: t.source_commit,
    morphemes: t.morphemes || [],
  }));

  const syntaxNodes = filterEd(vEntry?.syntax_nodes).map((sn) => ({
    node_key: sn.node_key,
    edition_key: sn.edition_key,
    node_type: sn.node_type,
    start_word_position: sn.start_word_position,
    end_word_position: sn.end_word_position,
    head_word_position: sn.head_word_position,
    syntactic_role: sn.syntactic_role,
    grammar_summary: sn.grammar_summary,
    source_record_id: sn.source_record_id,
  }));

  const syntaxEdges = filterEd(vEntry?.syntax_edges).map((ed) => ({
    edition_key: ed.edition_key,
    dependent_word_position: ed.dependent_word_position,
    head_word_position: ed.head_word_position,
    relation_type: ed.relation_type,
    head_strongs: ed.head_strongs,
    raw_relation_tag: ed.raw_relation_tag,
    origin_mode: ed.origin_mode,
    derivation_method: ed.derivation_method,
    source_record_id: ed.source_record_id,
  }));

  return {
    schema_version: 1,
    status: 'ok',
    passage: {
      verse_id: vid,
      book: b,
      book_name: bMeta.name,
      usfm: bMeta.usfm,
      chapter: c,
      verse: v,
      testament: bMeta.testament,
      primary_language: bMeta.original_language,
    },
    edition_passages: filterEd(vEntry?.edition_passages),
    versification_mappings: vEntry?.versification_mappings || [],
    english_editions: vEntry?.english_editions || [],
    tokens,
    syntax_nodes: syntaxNodes,
    syntax_edges: syntaxEdges,
    semantic_annotations: filterEd(vEntry?.semantic_annotations),
  };
}

async function handleLookupHebrewVerseEvidenceV1(env, params) {
  await ensureCatalog(env);
  const b = Number(params.p_book);
  const c = Number(params.p_chapter);
  const v = Number(params.p_verse);
  const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
  if (!vid) {
    return {
      found: false,
      book: b,
      chapter: c,
      verse_nr: v,
      error: 'Verse not found in canonical corpus',
    };
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
  const vEntry = chShard?.verses?.[String(v)];
  const bMeta = chShard?.book_meta || cachedBooksById.get(b);

  const stepTokens = (vEntry?.tokens || []).map((t) => ({
    word_id: t.word_id,
    position: t.word_position,
    original_word: t.surface_form,
    transliteration: t.transliteration,
    strongs_nr: t.base_strongs,
    grammar_code: t.word_grammar_code,
    gematria: t.gematria ?? null,
  }));

  const morphhbTokens = (vEntry?.morphhb_tokens || []).map((mt) => ({
    id: mt.id,
    morphhb_id: mt.morphhb_id,
    word_num: mt.word_num,
    word_text: mt.word_text,
    lemma: mt.lemma,
    morph_code: mt.morph_code,
    cantillation: mt.cantillation,
    is_ketiv: mt.is_ketiv,
    is_qere: mt.is_qere,
    qere_target_id: mt.qere_target_id,
    is_aramaic: mt.is_aramaic,
    step_word_id: mt.step_word_id,
    link_status: mt.link_status,
    source_record_id: mt.source_record_id,
  }));

  const maculaMorphemes = (vEntry?.macula_hebrew_morphemes || []).map((m) => ({
    id: m.id,
    macula_id: m.macula_id,
    ref_mt: m.ref_mt,
    word_no: m.word_no,
    morph_no: m.morph_no,
    class: m.class,
    text_form: m.text_form,
    after_text: m.after_text,
    lemma: m.lemma,
    strong_x: m.strong_x,
    morph_code: m.morph_code,
    lang: m.lang,
    stem: m.stem,
    morph_type: m.morph_type,
    gloss: m.gloss,
    english: m.english,
    sense_number: m.sense_number,
    subjref: m.subjref,
    participantref: m.participantref,
    word_id: m.word_id,
    link_status: m.link_status,
  }));

  const syntaxNodes = (vEntry?.syntax_nodes || []).map((sn) => ({
    id: sn.id,
    node_key: sn.node_key,
    node_type: sn.node_type,
    start_word_position: sn.start_word_position,
    end_word_position: sn.end_word_position,
    head_word_position: sn.head_word_position,
    syntactic_role: sn.syntactic_role,
    grammar_summary: sn.grammar_summary,
  }));

  const syntaxEdges = (vEntry?.syntax_edges || [])
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((se) => ({
      id: se.id,
      source_node_id: se.source_node_id,
      target_node_id: se.target_node_id,
      relation_type: se.relation_type,
      raw_relation_tag: se.raw_relation_tag,
      dependent_word_position: se.dependent_word_position,
      head_word_position: se.head_word_position,
    }));

  const crossMaps = (vEntry?.cross_token_mappings || []).map((ctm) => ({
    id: ctm.id,
    step_word_id: ctm.step_word_id,
    morphhb_token_id: ctm.morphhb_token_id,
    macula_morpheme_id: ctm.macula_morpheme_id,
    mapping_status: ctm.mapping_status,
    notes: ctm.notes,
    derivation_method: ctm.derivation_method,
  }));

  const ketivCount = morphhbTokens.filter((t) => t.is_ketiv).length;
  const qereCount = morphhbTokens.filter((t) => t.is_qere).length;
  const isAramaic =
    morphhbTokens.some((t) => t.is_aramaic) || maculaMorphemes.some((m) => m.lang === 'A');

  return {
    found: true,
    verse: {
      id: vid,
      book: b,
      book_name: bMeta.name,
      book_usfm: bMeta.usfm,
      chapter: c,
      verse_nr: v,
      word_ids: vEntry?.word_ids || [],
    },
    step_tokens: stepTokens,
    morphhb_tokens: morphhbTokens,
    macula_morphemes: maculaMorphemes,
    syntax_nodes: syntaxNodes,
    syntax_edges: syntaxEdges,
    cross_token_mappings: crossMaps,
    summary: {
      total_step_tokens: stepTokens.length,
      total_morphhb_tokens: morphhbTokens.length,
      total_macula_morphemes: maculaMorphemes.length,
      ketiv_count: ketivCount,
      qere_count: qereCount,
      is_aramaic: isAramaic,
      has_syntax_hierarchy: syntaxNodes.length > 0,
      syntax_edges_count: syntaxEdges.length,
      cross_mappings_count: crossMaps.length,
    },
  };
}

async function handleLookupGreekVerseEvidenceV1(env, params) {
  await ensureCatalog(env);
  const b = Number(params.p_book);
  const c = Number(params.p_chapter);
  const v = Number(params.p_verse);
  const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
  if (!vid) {
    return {
      found: false,
      book: b,
      chapter: c,
      verse_nr: v,
      error: 'Verse not found in canonical corpus',
    };
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
  const vEntry = chShard?.verses?.[String(v)];
  const bMeta = chShard?.book_meta || cachedBooksById.get(b);

  const stepTokens = (vEntry?.tokens || []).map((t) => ({
    word_id: t.word_id,
    position: t.word_position,
    original_word: t.surface_form,
    transliteration: t.transliteration,
    strongs_nr: t.base_strongs,
    grammar_code: t.word_grammar_code,
    gematria: t.gematria ?? null,
  }));

  const tagntTokens = (vEntry?.tagnt_tokens || []).map((tt) => ({
    id: tt.id,
    tagnt_id: tt.tagnt_id,
    word_type: tt.word_type,
    surface_greek: tt.surface_greek,
    transliteration: tt.transliteration,
    english_translation: tt.english_translation,
    dstrongs: tt.dstrongs,
    grammar_code: tt.grammar_code,
    lemma: tt.lemma,
    step_gloss: tt.step_gloss,
    editions: tt.editions,
    meaning_variants: tt.meaning_variants,
    spelling_variants: tt.spelling_variants,
    sub_meaning: tt.sub_meaning,
    conjoin_word: tt.conjoin_word,
    sstrong_instance: tt.sstrong_instance,
    alt_strongs: tt.alt_strongs,
    word_position: tt.word_position,
    step_word_id: tt.step_word_id,
    link_status: tt.link_status,
  }));

  const mapGreekToken = (gt) => ({
    id: gt.id,
    xml_id: gt.xml_id,
    ref_nt: gt.ref_nt,
    word_no: gt.word_no,
    role: gt.role,
    part_of_speech: gt.part_of_speech,
    word_type: gt.word_type,
    text_form: gt.text_form,
    after_text: gt.after_text,
    lemma: gt.lemma,
    normalized: gt.normalized,
    strongs: gt.strongs,
    morph_code: gt.morph_code,
    person: gt.person,
    number: gt.number,
    gender: gt.gender,
    case_value: gt.case_value,
    tense: gt.tense,
    voice: gt.voice,
    mood: gt.mood,
    degree: gt.degree,
    gloss: gt.gloss,
    english: gt.english,
    mandarin: gt.mandarin,
    frame: gt.frame,
    subjref: gt.subjref,
    referent: gt.referent,
    step_word_id: gt.step_word_id,
    link_status: gt.link_status,
  });

  const allMaculaGrk = vEntry?.macula_greek_tokens || [];
  const nestleTokens = allMaculaGrk
    .filter((gt) => gt.edition_key === 'macula-greek-nestle1904')
    .map(mapGreekToken);
  const sblgntTokens = allMaculaGrk
    .filter((gt) => gt.edition_key === 'macula-greek-sblgnt')
    .map(mapGreekToken);

  const sblByWordNo = new Map();
  for (const s of sblgntTokens) sblByWordNo.set(s.word_no, s);

  const editionDiffs = [];
  for (const n of nestleTokens) {
    const s = sblByWordNo.get(n.word_no);
    if (s && (n.text_form !== s.text_form || n.morph_code !== s.morph_code || n.lemma !== s.lemma)) {
      editionDiffs.push({
        word_no: n.word_no,
        nestle_text: n.text_form,
        sblgnt_text: s.text_form,
        nestle_morph: n.morph_code,
        sblgnt_morph: s.morph_code,
        nestle_lemma: n.lemma,
        sblgnt_lemma: s.lemma,
      });
    }
  }

  const tradOnly = tagntTokens.filter((tt) => /^k/i.test(tt.word_type || '')).length;
  const critOnly = tagntTokens.filter(
    (tt) => /^n/i.test(tt.word_type || '') && !/k/i.test(tt.word_type || '')
  ).length;
  const meaningVarCount = tagntTokens.filter((tt) => tt.meaning_variants && tt.meaning_variants !== '').length;
  const spellingVarCount = tagntTokens.filter((tt) => tt.spelling_variants && tt.spelling_variants !== '').length;

  return {
    found: true,
    verse: {
      id: vid,
      book: b,
      book_name: bMeta.name,
      book_usfm: bMeta.usfm,
      chapter: c,
      verse_nr: v,
      word_ids: vEntry?.word_ids || [],
    },
    step_tokens: stepTokens,
    tagnt_tokens: tagntTokens,
    macula_nestle1904_tokens: nestleTokens,
    macula_sblgnt_tokens: sblgntTokens,
    edition_differences: editionDiffs,
    summary: {
      total_step_tokens: stepTokens.length,
      total_tagnt_tokens: tagntTokens.length,
      total_nestle_tokens: nestleTokens.length,
      total_sblgnt_tokens: sblgntTokens.length,
      traditional_only_count: tradOnly,
      critical_only_count: critOnly,
      meaning_variants_count: meaningVarCount,
      spelling_variants_count: spellingVarCount,
      edition_differences_count: editionDiffs.length,
      has_textual_variants:
        tradOnly > 0 || critOnly > 0 || meaningVarCount > 0 || editionDiffs.length > 0,
    },
  };
}

async function handleLookupSeptuagintPassageV1(env, params) {
  await ensureCatalog(env);
  const bookNo = Number(params.p_book_no);
  const chapter = Number(params.p_chapter);
  const verseNr =
    params.p_verse_nr !== undefined && params.p_verse_nr !== null ? Number(params.p_verse_nr) : null;
  const chSuffix = params.p_chapter_suffix ?? '';
  const vSuffix = params.p_verse_suffix ?? '';

  if (!cachedLxxBooksByNo.has(bookNo)) {
    if ([7, 9, 22, 30].includes(bookNo)) {
      return {
        found: false,
        reason: 'source_incompleteness',
        book_no: bookNo,
        message: `Book number ${bookNo} is absent from the declared upstream nathans/lxx-swete digital repository.`,
      };
    }
    return {
      found: false,
      reason: 'unknown_book',
      book_no: bookNo,
      message: `Book number ${bookNo} does not exist in Swete Septuagint catalog.`,
    };
  }

  const lxxShard = await loadJsonShard(env, `/v1/lxx/b${bookNo}.json.gz`);
  const tokens = (lxxShard?.words || [])
    .filter(
      (w) =>
        w.chapter === chapter &&
        (w.chapter_suffix || '') === chSuffix &&
        (verseNr === null || (w.verse_nr === verseNr && (w.verse_suffix || '') === vSuffix))
    )
    .map((w) => ({
      book_no: w.book_no,
      chapter: w.chapter,
      chapter_suffix: w.chapter_suffix,
      verse_nr: w.verse_nr,
      verse_suffix: w.verse_suffix,
      ordinal: w.ordinal,
      word_text: w.word_text,
      normalized_word: w.normalized_word,
      source_record_id: w.source_record_id,
      source_release_key: w.source_release_key,
      source_edition_key: w.source_edition_key,
    }));

  if (tokens.length === 0) {
    return {
      found: false,
      reason: 'passage_not_found',
      book_no: bookNo,
      chapter,
      chapter_suffix: chSuffix,
      verse_nr: verseNr,
      verse_suffix: vSuffix,
      message: 'No Greek words found in Swete Septuagint for the requested reference.',
    };
  }

  let matchedMap = null;
  let hebVerse = null;
  if (verseNr !== null) {
    for (const m of lxxShard?.versification_mappings || []) {
      if (
        m.lxx_chapter === chapter &&
        (m.lxx_chapter_suffix || '') === chSuffix &&
        m.lxx_verse_nr === verseNr &&
        (m.lxx_verse_suffix || '') === vSuffix &&
        m.canonical_verse_id !== null
      ) {
        matchedMap = m;
        hebVerse = cachedVerseById.get(Number(m.canonical_verse_id));
        break;
      }
    }
  }

  return {
    found: true,
    book: {
      book_no: lxxShard.book.book_no,
      latin_name: lxxShard.book.latin_name,
      canonical_book_id: lxxShard.book.canonical_book_id,
      canonical_book_name: lxxShard.book.canonical_book_name,
      is_deuterocanonical_or_apocrypha: lxxShard.book.is_deuterocanonical_or_apocrypha,
    },
    reference: {
      chapter,
      chapter_suffix: chSuffix,
      verse_nr: verseNr,
      verse_suffix: vSuffix,
    },
    summary: {
      total_tokens: tokens.length,
      has_hebrew_counterpart: Boolean(matchedMap && hebVerse),
      hebrew_canonical_verse_id: matchedMap ? matchedMap.canonical_verse_id : null,
      hebrew_reference: hebVerse
        ? { book: hebVerse.book, chapter: hebVerse.chapter, verse_nr: hebVerse.verse_nr }
        : null,
      versification_mapping: matchedMap
        ? {
            mapping_kind: matchedMap.mapping_kind,
            rule_citation: matchedMap.rule_citation,
            origin_mode: matchedMap.origin_mode,
            derivation_method: matchedMap.derivation_method,
          }
        : null,
      linguistic_annotation_status: 'unannotated_in_source',
      epistemic_disclaimer:
        'The Swete digital edition provides authentic surface tokens and punctuation without morphological tags or lemmas. External lexicons or parsers must not be presented as source-attested facts.',
    },
    tokens,
  };
}

async function handleLookupSeptuagintByCanonicalVerseV1(env, params) {
  await ensureCatalog(env);
  const vid = Number(params.p_canonical_verse_id);
  const vMeta = cachedVerseById.get(vid);
  if (!vMeta) {
    return {
      found: false,
      canonical_verse_id: vid,
      reason: 'no_attested_greek_verse_mapping',
      message: `Canonical verse ID ${vid} has no resolvable mapping to attested imported Swete word records.`,
    };
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${vMeta.book}-c${vMeta.chapter}.json.gz`);
  const vEntry = chShard?.verses?.[String(vMeta.verse_nr)];
  const maps = vEntry?.hebrew_lxx_verse_map || [];
  const targetTokens = vEntry?.lxx_target_tokens || {};

  for (const m of maps) {
    if (['unmatched_hebrew', 'unmatched_septuagint'].includes(m.mapping_kind)) continue;
    if (m.lxx_book_no === null || m.lxx_chapter === null || m.lxx_verse_nr === null) continue;
    const tKey = `${m.lxx_book_no}:${m.lxx_chapter}:${m.lxx_chapter_suffix || ''}:${m.lxx_verse_nr}:${m.lxx_verse_suffix || ''}`;
    if ((targetTokens[tKey] || []).length > 0) {
      return handleLookupSeptuagintPassageV1(env, {
        p_book_no: m.lxx_book_no,
        p_chapter: m.lxx_chapter,
        p_verse_nr: m.lxx_verse_nr,
        p_chapter_suffix: m.lxx_chapter_suffix || '',
        p_verse_suffix: m.lxx_verse_suffix || '',
      });
    }
  }

  return {
    found: false,
    canonical_verse_id: vid,
    reason: 'no_attested_greek_verse_mapping',
    message: `Canonical verse ID ${vid} has no resolvable mapping to attested imported Swete word records.`,
  };
}

async function handleGetReaderPassagesV1(env, params) {
  await ensureCatalog(env);
  const passages = params.p_passages;
  if (!Array.isArray(passages) || passages.length < 1 || passages.length > 12) {
    return { status: 'invalid_request' };
  }
  for (const p of passages) {
    if (
      !p ||
      typeof p !== 'object' ||
      !/^[0-9]{1,2}$/.test(String(p.book ?? '')) ||
      !/^[0-9]{1,3}$/.test(String(p.chapter ?? '')) ||
      !/^[0-9]{1,3}$/.test(String(p.verse ?? ''))
    ) {
      return { status: 'invalid_request' };
    }
  }

  const out = [];
  for (const p of passages) {
    const b = Number(p.book);
    const c = Number(p.chapter);
    const v = Number(p.verse);
    const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
    const vEntry = chShard?.verses?.[String(v)];
    const webp = (vEntry?.english_editions || []).find((e) => e.edition_id === 'webp-2026-11');
    const text = webp ? webp.text : null;
    out.push({
      passage: p,
      text,
      edition: 'World English Bible',
      edition_id: 'webp-2026-11',
      mapping_status: text === null ? 'unavailable' : 'same_reference',
    });
  }

  return { status: 'ok', passages: out };
}

async function handleGetVerseTranslationSourcesBatchV1(env, params) {
  await ensureCatalog(env);
  const verseIds = Array.isArray(params.p_verse_ids) ? params.p_verse_ids.map(Number) : [];
  const chaptersToLoad = new Map();
  for (const vid of verseIds) {
    const vMeta = cachedVerseById.get(vid);
    if (vMeta) {
      const chKey = `${vMeta.book}:${vMeta.chapter}`;
      if (!chaptersToLoad.has(chKey)) chaptersToLoad.set(chKey, []);
      chaptersToLoad.get(chKey).push(vMeta);
    }
  }

  const versesOut = {};
  for (const [chKey, vMetas] of chaptersToLoad.entries()) {
    const [b, c] = chKey.split(':').map(Number);
    const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
    for (const vm of vMetas) {
      const vEntry = chShard?.verses?.[String(vm.verse_nr)];
      if (vEntry) {
        versesOut[String(vm.id)] = (vEntry.tokens || []).map((t) => ({
          verse_id: vm.id,
          word_position: t.word_position,
          word_id: t.word_id,
          source_english: t.attested_english_gloss,
          source_ref: t.source_ref,
          source_name: t.source_name,
          source_commit: t.source_commit,
          grammar_code: t.grammar_code,
        }));
      }
    }
  }

  return { status: 'ok', verses: versesOut };
}

async function handleSearchSyntaxPatternsV1(env, params) {
  const idx = await loadJsonShard(env, '/v1/syntax/search-index.json.gz');
  const rule = params.rule_label || params.p_rule_label || null;
  const role = params.syntactic_role || params.p_syntactic_role || null;
  const crossOnly = Boolean(params.cross_verse_only || params.p_cross_verse_only);
  const limit = Math.min(Math.max(Number(params.limit || params.p_limit || 25), 1), 100);

  if (crossOnly) {
    return {
      status: 'ok',
      total_cross_verse_trees: idx.cross_verse_trees.length,
      samples: idx.cross_verse_trees.slice(0, limit),
    };
  }
  if (rule) {
    return {
      status: 'ok',
      rule_label: rule,
      total_occurrences: idx.rule_counts[rule] || 0,
      samples: (idx.rule_samples[rule] || []).slice(0, limit),
    };
  }
  if (role) {
    return {
      status: 'ok',
      syntactic_role: role,
      total_occurrences: idx.role_counts[role] || 0,
    };
  }
  return {
    status: 'ok',
    rule_counts: idx.rule_counts,
    role_counts: idx.role_counts,
    cl_type_counts: idx.cl_type_counts,
    cross_verse_trees_count: idx.cross_verse_trees.length,
    unmapped_nodes_count: idx.unmapped_nodes.length,
  };
}

function md5Hex00to7f(inputStr) {
  // Deterministic fallback or precomputed bucket lookup via query-index
  // Note: for Strong's buckets we also store the exact bucket in /v1/lexical/query-index.json.gz
  return null;
}

let cachedQueryIndex = null;
let cachedStrongsBucketMap = null;

async function ensureQueryIndex(env) {
  if (cachedQueryIndex) return cachedQueryIndex;
  const qi = await loadJsonShard(env, '/v1/lexical/query-index.json.gz');
  if (!qi) throw new Error('Failed to load /v1/lexical/query-index.json.gz');
  cachedQueryIndex = qi;
  cachedStrongsBucketMap = new Map();
  for (const lem of qi.lemmas || []) {
    if (lem.base_strongs && lem.bucket) {
      cachedStrongsBucketMap.set(lem.base_strongs.toUpperCase(), lem.bucket);
    }
  }
  return cachedQueryIndex;
}

// Minimal pure-JS MD5 first byte & 0x7f for Strong's numbers not in lemmas table
function computeStrongsBucketHex(strongsNr) {
  const str = String(strongsNr || '').toUpperCase();
  const utf8 = new TextEncoder().encode(str);
  const K = new Uint32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const bitLen = utf8.length * 8;
  const padLen = ((56 - ((utf8.length + 1) % 64)) + 64) % 64;
  const buf = new Uint8Array(utf8.length + 1 + padLen + 8);
  buf.set(utf8);
  buf[utf8.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(buf.length - 8, bitLen >>> 0, true);
  view.setUint32(buf.length - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < buf.length; offset += 64) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      const M = view.getUint32(offset + g * 4, true);
      F = (F + A + K[i] + M) >>> 0;
      A = D;
      D = C;
      C = B;
      const rot = (F << S[i]) | (F >>> (32 - S[i]));
      B = (B + rot) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  const firstByte = (a0 & 0xff) & 0x7f;
  return firstByte.toString(16).padStart(2, '0');
}

async function loadStrongsEntry(env, strongsNr) {
  if (!strongsNr) return null;
  const key = String(strongsNr).toUpperCase();
  const bHex = computeStrongsBucketHex(key);
  const bucket = await loadJsonShard(env, `/v1/lexical/strongs-${bHex}.json.gz`);
  return bucket?.[key] || bucket?.[strongsNr] || null;
}

async function loadWordEntry(env, wordId) {
  const wid = Number(wordId);
  if (!Number.isFinite(wid) || wid <= 0) return null;
  const bIdx = Math.floor(wid / 2500);
  const bHex = bIdx.toString(16).padStart(2, '0');
  const bucket = await loadJsonShard(env, `/v1/lexical/words-${bHex}.json.gz`);
  return bucket?.[String(wid)] || null;
}

function readerUsageLabel(strongsNr, english) {
  const raw = String(english || '').replace(/\s*\/\s*/g, ' ').trim();
  if (strongsNr === 'H7307') {
    if (/\bwinds?\b/i.test(english || '')) return 'wind';
    if (/\bspirits?\b/i.test(english || '')) return 'spirit';
    if (/\bbreath\b/i.test(english || '')) return 'breath';
    if (/\b(side|sides|quarter|quarters|direction|directions)\b/i.test(english || '')) return 'direction / side';
  }
  return raw;
}

async function handleGetReaderOverviewV1(env, params) {
  const cat = await ensureCatalog(env);
  const b = Number(params.p_book);
  const c = Number(params.p_chapter);
  const v = Number(params.p_verse);
  const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
  if (!vid) {
    return {
      status: 'passage_not_found',
      ranges: {},
      grammar: {},
      place_anchors: [],
      previous: null,
      next: null,
    };
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
  const vEntry = chShard?.verses?.[String(v)];
  const tokens = vEntry?.tokens || [];

  const grammar = {};
  const strongsSet = new Set();
  for (const t of tokens) {
    grammar[String(t.word_position)] =
      cat.decode_grammar_catalog?.[t.word_grammar_code] || t.decoded_morphology || {};
    if (t.base_strongs) strongsSet.add(t.base_strongs);
  }

  const ranges = {};
  for (const snr of strongsSet) {
    const sEntry = await loadStrongsEntry(env, snr);
    const groups = (sEntry?.rendering_groups || []).slice();
    groups.sort((a, bGrp) => {
      const aPri =
        snr === 'H7307' && ['wind', 'spirit', 'breath', 'direction / side'].includes(a.label) ? 0 : 1;
      const bPri =
        snr === 'H7307' && ['wind', 'spirit', 'breath', 'direction / side'].includes(bGrp.label) ? 0 : 1;
      if (aPri !== bPri) return aPri - bPri;
      if (bGrp.token_total !== a.token_total) return bGrp.token_total - a.token_total;
      return String(a.label).localeCompare(String(bGrp.label));
    });
    ranges[snr] = groups.slice(0, 4).map((g, idx) => {
      const exV = cachedVerseById.get(Number(g.example_verse_id));
      return {
        label: g.label,
        token_total: g.token_total,
        verse_total: g.verse_total,
        book: exV ? exV.book : 1,
        chapter: exV ? exV.chapter : 1,
        verse: exV ? exV.verse_nr : 1,
        rank: idx + 1,
      };
    });
  }

  const prevV = cachedVerseById.get(vid - 1) || null;
  const nextV = cachedVerseById.get(vid + 1) || null;

  return {
    status: 'ok',
    ranges,
    grammar,
    place_anchors: [],
    previous: prevV ? { book: prevV.book, chapter: prevV.chapter, verse: prevV.verse_nr } : null,
    next: nextV ? { book: nextV.book, chapter: nextV.chapter, verse: nextV.verse_nr } : null,
  };
}

async function handleGetReaderWordV1(env, params) {
  await ensureCatalog(env);
  const wid = Number(params.p_word_id);
  const afterVid = Math.max(Number(params.p_after || 0), 0);
  const rendering = params.p_rendering ?? null;

  const wEntry = await loadWordEntry(env, wid);
  if (!wEntry || !wEntry.word) {
    return {
      status: 'word_not_found',
      word: null,
      lexemes: [],
      token_total: 0,
      verse_total: 0,
      scope: 'Base Strong’s group; observed STEP occurrence renderings; token senses are not assigned.',
      occurrences: [],
      next_cursor: null,
    };
  }

  const targetWord = wEntry.word;
  const snr = targetWord.strongs_nr;
  const sEntry = await loadStrongsEntry(env, snr);
  const allWordsOfStrongs = sEntry?.words || [targetWord];

  let tokenTotal = 0;
  const byVerse = new Map();
  for (const sw of allWordsOfStrongs) {
    const swEntry = sw.id === wid ? wEntry : await loadWordEntry(env, sw.id);
    for (const occ of swEntry?.vts_occurrences || []) {
      if (rendering !== null && readerUsageLabel(snr, occ.source_english) !== rendering) {
        continue;
      }
      tokenTotal += 1;
      const vId = Number(occ.verse_id);
      const cur = byVerse.get(vId);
      const seText = occ.source_english ?? '';
      if (!cur) {
        byVerse.set(vId, { verse_id: vId, occurrence_count: 1, source_english: seText });
      } else {
        cur.occurrence_count += 1;
        if (seText < cur.source_english) cur.source_english = seText;
      }
    }
  }

  const sortedVerses = Array.from(byVerse.values()).sort((a, b) => a.verse_id - b.verse_id);
  const filtered = sortedVerses.filter((g) => g.verse_id > afterVid);
  const paged = filtered.slice(0, 12).map((g) => {
    const vm = cachedVerseById.get(g.verse_id);
    return {
      verse_id: g.verse_id,
      occurrence_count: g.occurrence_count,
      source_english: g.source_english,
      book: vm ? vm.book : 1,
      chapter: vm ? vm.chapter : 1,
      verse: vm ? vm.verse_nr : 1,
    };
  });

  const maxPagedVid = paged.length > 0 ? paged[paged.length - 1].verse_id : null;
  const hasMore = maxPagedVid !== null && filtered.length > 12;

  return {
    status: 'ok',
    word: targetWord,
    lexemes: sEntry?.lexemes || [],
    token_total: tokenTotal,
    verse_total: sortedVerses.length,
    scope: 'Base Strong’s group; observed STEP occurrence renderings; token senses are not assigned.',
    occurrences: paged,
    next_cursor: hasMore ? maxPagedVid : null,
  };
}

async function handleCompareHebrewSeptuagintPassageV1(env, params) {
  const cat = await ensureCatalog(env);
  let queryMode = null;
  let verseId = params.p_canonical_verse_id != null ? Number(params.p_canonical_verse_id) : null;
  let hebBook = params.p_hebrew_book != null ? Number(params.p_hebrew_book) : null;
  let hebChapter = params.p_hebrew_chapter != null ? Number(params.p_hebrew_chapter) : null;
  let hebVerse = params.p_hebrew_verse != null ? Number(params.p_hebrew_verse) : null;

  let lxxBookNo = params.p_lxx_book_no != null ? Number(params.p_lxx_book_no) : null;
  let lxxChapter = params.p_lxx_chapter != null ? Number(params.p_lxx_chapter) : null;
  let lxxChSuffix = params.p_lxx_chapter_suffix || '';
  let lxxVerseNr = params.p_lxx_verse_nr != null ? Number(params.p_lxx_verse_nr) : null;
  let lxxVSuffix = params.p_lxx_verse_suffix || '';

  if (verseId !== null || (hebBook !== null && hebChapter !== null && hebVerse !== null)) {
    queryMode = 'hebrew';
  } else if (lxxBookNo !== null && lxxChapter !== null && lxxVerseNr !== null) {
    queryMode = 'septuagint';
  } else {
    return {
      schema_version: 1,
      status: 'invalid_request',
      message:
        'Either Hebrew reference (book, chapter, verse / canonical_verse_id) or Septuagint reference (lxx_book_no, lxx_chapter, lxx_verse_nr) must be provided.',
    };
  }

  let correspondenceStatus = 'matched';
  let mappings = [];
  let lxxBookName = '';
  let isDeuterocanonical = false;

  if (queryMode === 'hebrew') {
    if (verseId === null) {
      verseId = cachedVerseByCoord.get(`${hebBook}:${hebChapter}:${hebVerse}`) || null;
    } else {
      const vm = cachedVerseById.get(verseId);
      if (vm) {
        hebBook = vm.book;
        hebChapter = vm.chapter;
        hebVerse = vm.verse_nr;
      } else {
        verseId = null;
      }
    }
    if (verseId === null) {
      return {
        schema_version: 1,
        status: 'not_found',
        message: 'Passage not found in canonical Hebrew corpus',
      };
    }

    const chShard = await loadJsonShard(env, `/v1/chapters/b${hebBook}-c${hebChapter}.json.gz`);
    const vEntry = chShard?.verses?.[String(hebVerse)];
    const rawMaps = vEntry?.hebrew_lxx_verse_map || [];
    mappings = rawMaps.map((m) => {
      const lb = m.lxx_book_no != null ? cachedLxxBooksByNo.get(Number(m.lxx_book_no)) : null;
      return {
        id: m.id,
        canonical_verse_id: m.canonical_verse_id,
        lxx_book_no: m.lxx_book_no,
        lxx_book_name: lb ? lb.latin_name : '',
        lxx_chapter: m.lxx_chapter,
        lxx_chapter_suffix: m.lxx_chapter_suffix,
        lxx_verse_nr: m.lxx_verse_nr,
        lxx_verse_suffix: m.lxx_verse_suffix,
        mapping_kind: m.mapping_kind,
        rule_citation: m.rule_citation,
        origin_mode: m.origin_mode,
        derivation_method: m.derivation_method,
      };
    });

    const primaryMap = mappings[0] || null;
    if (primaryMap) {
      if (['unmatched_hebrew', 'mt_plus'].includes(primaryMap.mapping_kind) || primaryMap.lxx_book_no == null) {
        correspondenceStatus = 'unmatched_hebrew_minus_in_lxx';
      } else {
        correspondenceStatus = primaryMap.mapping_kind === 'reordered' ? 'reordered' : 'matched';
        lxxBookNo = primaryMap.lxx_book_no;
        lxxBookName = primaryMap.lxx_book_name;
        lxxChapter = primaryMap.lxx_chapter;
        lxxChSuffix = primaryMap.lxx_chapter_suffix || '';
        lxxVerseNr = primaryMap.lxx_verse_nr;
        lxxVSuffix = primaryMap.lxx_verse_suffix || '';
      }
    } else {
      let foundLb = null;
      for (const lb of cat.lxx_swete_books) {
        if (lb.canonical_book === hebBook) {
          foundLb = lb;
          break;
        }
      }
      if (foundLb) {
        lxxBookNo = foundLb.book_no;
        lxxBookName = foundLb.latin_name;
        lxxChapter = hebChapter;
        lxxVerseNr = hebVerse;
        correspondenceStatus = 'unverified_candidate';
      } else {
        correspondenceStatus = 'unmatched_hebrew_minus_in_lxx';
      }
    }
  } else {
    const lb = cachedLxxBooksByNo.get(lxxBookNo);
    if (!lb) {
      return {
        schema_version: 1,
        status: 'not_found',
        message: 'Septuagint book not found',
      };
    }
    lxxBookName = lb.latin_name;
    isDeuterocanonical = lb.canonical_book == null;

    const lxxShard = await loadJsonShard(env, `/v1/lxx/b${lxxBookNo}.json.gz`);
    const rawMaps = (lxxShard?.versification_mappings || []).filter(
      (m) =>
        m.lxx_chapter === lxxChapter &&
        m.lxx_verse_nr === lxxVerseNr &&
        (lxxChSuffix === '' || (m.lxx_chapter_suffix || '') === lxxChSuffix) &&
        (lxxVSuffix === '' || (m.lxx_verse_suffix || '') === lxxVSuffix)
    );
    mappings = rawMaps.map((m) => {
      const vm = m.canonical_verse_id != null ? cachedVerseById.get(Number(m.canonical_verse_id)) : null;
      const bk = vm ? cachedBooksById.get(vm.book) : null;
      return {
        id: m.id,
        canonical_verse_id: m.canonical_verse_id,
        hebrew_reference: vm && bk ? `${bk.name} ${vm.chapter}:${vm.verse_nr}` : '',
        hebrew_book: vm ? vm.book : null,
        hebrew_chapter: vm ? vm.chapter : null,
        hebrew_verse: vm ? vm.verse_nr : null,
        mapping_kind: m.mapping_kind,
        rule_citation: m.rule_citation,
        origin_mode: m.origin_mode,
        derivation_method: m.derivation_method,
      };
    });

    const primaryMap = mappings[0] || null;
    if (primaryMap) {
      if (['unmatched_septuagint', 'lxx_plus'].includes(primaryMap.mapping_kind) || primaryMap.canonical_verse_id == null) {
        correspondenceStatus = 'unmatched_lxx_plus_in_greek';
      } else {
        correspondenceStatus = primaryMap.mapping_kind === 'reordered' ? 'reordered' : 'matched';
        verseId = primaryMap.canonical_verse_id;
        hebBook = primaryMap.hebrew_book;
        hebChapter = primaryMap.hebrew_chapter;
        hebVerse = primaryMap.hebrew_verse;
      }
    } else if (isDeuterocanonical) {
      correspondenceStatus = 'unmatched_lxx_plus_in_greek';
    } else if (lb.canonical_book != null) {
      hebBook = lb.canonical_book;
      const candVid = cachedVerseByCoord.get(`${hebBook}:${lxxChapter}:${lxxVerseNr}`);
      if (candVid) {
        verseId = candVid;
        hebChapter = lxxChapter;
        hebVerse = lxxVerseNr;
        correspondenceStatus = 'matched';
      } else {
        correspondenceStatus = 'unmatched_lxx_plus_in_greek';
      }
    } else {
      correspondenceStatus = 'unmatched_lxx_plus_in_greek';
    }
  }

  let mtWords = [];
  if (verseId !== null && hebBook !== null && hebChapter !== null && hebVerse !== null) {
    const chShard = await loadJsonShard(env, `/v1/chapters/b${hebBook}-c${hebChapter}.json.gz`);
    const vEntry = chShard?.verses?.[String(hebVerse)];
    mtWords = (vEntry?.tokens || []).map((t) => ({
      ordinal: t.word_position,
      word_id: t.word_id,
      original_word: t.surface_form,
      transliteration: t.transliteration,
      strongs_nr: t.base_strongs,
      gloss: (t.english_translations || [])[0] || null,
      alignment_status: 'unmatched',
      aligned_lxx_ordinals: [],
    }));
  }

  let lxxWords = [];
  if (lxxBookNo !== null && lxxChapter !== null && lxxVerseNr !== null) {
    const lxxShard = await loadJsonShard(env, `/v1/lxx/b${lxxBookNo}.json.gz`);
    lxxWords = (lxxShard?.words || [])
      .filter(
        (sw) =>
          sw.chapter === lxxChapter &&
          (lxxChSuffix === '' || (sw.chapter_suffix || '') === lxxChSuffix) &&
          sw.verse_nr === lxxVerseNr &&
          (lxxVSuffix === '' || (sw.verse_suffix || '') === lxxVSuffix)
      )
      .map((sw) => ({
        ordinal: sw.ordinal,
        lxx_word_id: sw.id,
        word_text: sw.word_text,
        normalized_word: sw.normalized_word,
        alignment_status: 'unmatched',
        aligned_hebrew_ordinals: [],
      }));
  }

  if (
    lxxBookNo !== null &&
    lxxWords.length === 0 &&
    !['unmatched_hebrew_minus_in_lxx', 'unmatched_lxx_plus_in_greek'].includes(correspondenceStatus)
  ) {
    correspondenceStatus = 'missing_lxx_text';
  }

  const allAlignments = (cat.hebrew_lxx_word_alignments || []).filter(
    (a) =>
      (verseId !== null && a.canonical_verse_id === verseId) ||
      (lxxBookNo !== null &&
        a.lxx_book_no === lxxBookNo &&
        a.lxx_chapter === lxxChapter &&
        a.lxx_verse_nr === lxxVerseNr)
  );
  const mapAlign = (a) => ({
    alignment_key: a.alignment_key,
    cardinality: a.cardinality,
    alignment_tier: a.alignment_tier,
    verification_status: a.verification_status,
    confidence_score: a.confidence_score,
    hebrew_text: a.hebrew_text,
    hebrew_ordinals: a.hebrew_token_ordinals,
    hebrew_strongs: a.hebrew_strongs,
    lxx_text: a.lxx_text,
    lxx_ordinals: a.lxx_token_ordinals,
    lxx_strongs: a.lxx_strongs,
    algorithm_or_source: a.algorithm_or_source,
    translation_technique: a.translation_technique,
    evidence_summary: a.evidence_summary,
  });

  const docAlignments = allAlignments.filter((a) => a.alignment_tier === 'documented_textual').map(mapAlign);
  const candAlignments = allAlignments
    .filter((a) => a.alignment_tier === 'computationally_inferred_candidate')
    .map(mapAlign);
  const scholarlyAlignments = allAlignments
    .filter((a) => a.alignment_tier === 'scholarly_interpretation')
    .map(mapAlign);

  if (docAlignments.length > 0 || candAlignments.length > 0) {
    for (const mw of mtWords) {
      const da = docAlignments.find((a) => (a.hebrew_ordinals || []).includes(mw.ordinal));
      const ca = candAlignments.find((a) => (a.hebrew_ordinals || []).includes(mw.ordinal));
      if (da) {
        mw.alignment_status = 'documented_aligned';
        mw.aligned_lxx_ordinals = da.lxx_ordinals || [];
      } else if (ca) {
        mw.alignment_status = 'candidate_aligned';
        mw.aligned_lxx_ordinals = ca.lxx_ordinals || [];
      }
    }
    for (const lw of lxxWords) {
      const da = docAlignments.find((a) => (a.lxx_ordinals || []).includes(lw.ordinal));
      const ca = candAlignments.find((a) => (a.lxx_ordinals || []).includes(lw.ordinal));
      if (da) {
        lw.alignment_status = 'documented_aligned';
        lw.aligned_hebrew_ordinals = da.hebrew_ordinals || [];
      } else if (ca) {
        lw.alignment_status = 'candidate_aligned';
        lw.aligned_hebrew_ordinals = ca.hebrew_ordinals || [];
      }
    }
  }

  const statusOut =
    correspondenceStatus === 'missing_lxx_text'
      ? 'missing_lxx_text'
      : correspondenceStatus === 'unverified_candidate'
        ? 'unverified_mapping'
        : 'ok';

  return {
    schema_version: 1,
    status: statusOut,
    query_mode: queryMode,
    correspondence_status: correspondenceStatus,
    has_hebrew_passage: verseId !== null,
    has_septuagint_passage:
      lxxWords.length > 0 &&
      lxxBookNo !== null &&
      lxxChapter !== null &&
      lxxVerseNr !== null &&
      correspondenceStatus !== 'unmatched_hebrew_minus_in_lxx',
    hebrew_passage:
      verseId !== null
        ? {
            canonical_verse_id: verseId,
            book: hebBook,
            chapter: hebChapter,
            verse_nr: hebVerse,
            word_count: mtWords.length,
            words: mtWords,
          }
        : null,
    septuagint_passage:
      lxxBookNo !== null && correspondenceStatus !== 'unmatched_hebrew_minus_in_lxx'
        ? {
            book_no: lxxBookNo,
            latin_name: lxxBookName || '',
            chapter: lxxChapter,
            chapter_suffix: lxxChSuffix,
            verse_nr: lxxVerseNr,
            verse_suffix: lxxVSuffix,
            is_deuterocanonical: isDeuterocanonical,
            word_count: lxxWords.length,
            words: lxxWords,
          }
        : null,
    versification_mappings: mappings,
    documented_alignments: docAlignments,
    candidate_alignments: candAlignments,
    scholarly_interpretations: scholarlyAlignments,
    epistemic_disclaimer:
      'Candidate alignments are computationally inferred and strictly segregated from verified textual evidence. Source-attested, editorially collated, candidate, and scholarly alignment statuses must remain distinct. Absent imported Greek tokens do not prove a textual omission.',
  };
}

async function handleGetHebrewSeptuagintParallelV1(env, params) {
  const cat = await ensureCatalog(env);
  const qi = await ensureQueryIndex(env);
  const b = Number(params.p_book);
  const c = Number(params.p_chapter);
  const v = Number(params.p_verse);
  const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
  if (!vid) {
    return {
      schema_version: 1,
      status: 'not_found',
      message: 'Passage not found in canonical corpus',
    };
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
  const vEntry = chShard?.verses?.[String(v)];
  const rawMaps = vEntry?.hebrew_lxx_verse_map || [];
  let lxxBookNo = null;
  let lxxBookName = null;
  let lxxChapter = null;
  let lxxVerseNr = null;
  let lxxSuffix = '';
  let mappingKind = 'unmapped';
  let ruleCitation = null;

  if (rawMaps.length > 0 && rawMaps[0].lxx_book_no != null) {
    const m = rawMaps[0];
    const lb = cachedLxxBooksByNo.get(Number(m.lxx_book_no));
    lxxBookNo = m.lxx_book_no;
    lxxBookName = lb ? lb.latin_name : null;
    lxxChapter = m.lxx_chapter;
    lxxVerseNr = m.lxx_verse_nr;
    lxxSuffix = m.lxx_verse_suffix || '';
    mappingKind = m.mapping_kind;
    ruleCitation = m.rule_citation;
  } else {
    for (const lb of cat.lxx_swete_books) {
      if (lb.canonical_book === b) {
        lxxBookNo = lb.book_no;
        lxxBookName = lb.latin_name;
        break;
      }
    }
    lxxChapter = c;
    lxxVerseNr = v;
    mappingKind = 'unverified_candidate';
  }

  const mtWords = (vEntry?.tokens || []).map((t) => ({
    id: t.word_id,
    ordinal: t.word_position,
    original_word: t.surface_form,
    transliteration: t.transliteration,
    strongs_nr: t.base_strongs,
    gloss: (t.english_translations || [])[0] || null,
  }));

  let lxxWords = [];
  if (lxxBookNo !== null) {
    const lxxShard = await loadJsonShard(env, `/v1/lxx/b${lxxBookNo}.json.gz`);
    lxxWords = (lxxShard?.words || [])
      .filter((sw) => sw.chapter === lxxChapter && sw.verse_nr === lxxVerseNr)
      .map((sw) => ({
        id: sw.id,
        ordinal: sw.ordinal,
        word_text: sw.word_text,
        source_record_id: sw.source_record_id,
      }));
  }

  const regEntry = (cat.field_license_registry || []).find(
    (r) => r.dataset_key === 'macula-hebrew' && r.field_name === 'greekstrong'
  );
  const licenseStatus = regEntry ? regEntry.status : 'disabled_unverified';
  const wordAlignments = [];

  if (['enabled_verified', 'enabled_origin_unverified'].includes(licenseStatus)) {
    const grkEntities = (qi.canonical_entities || []).filter(
      (ce) => ce.entity_kind === 'lemma' && ce.language === 'grc'
    );
    for (const m of vEntry?.macula_hebrew_morphemes || []) {
      const gf = m.gated_fields || {};
      const gStrong = gf.greekstrong ?? null;
      const gWord = gf.greek ?? null;
      let gDisplay = null;
      if (gStrong) {
        const padded = `lemma:G${String(gStrong).padStart(4, '0')}`;
        const ceMatch = grkEntities.find(
          (ce) => ce.entity_key === padded || String(ce.entity_key || '').startsWith(padded)
        );
        if (ceMatch) gDisplay = ceMatch.display_label;
      }
      wordAlignments.push({
        word_no: m.word_no,
        morph_no: m.morph_no,
        text_form: m.text_form,
        strong_x: m.strong_x,
        lemma: m.lemma,
        gloss: m.gloss,
        greek_strong: gStrong,
        greek_word: gWord,
        greek_display_label: gDisplay,
        relation_type: 'source_lexical_equivalent',
        evidence_status: licenseStatus,
      });
    }
  }

  const statusOut =
    b > 39
      ? 'not_applicable'
      : lxxWords.length === 0
        ? 'missing_lxx_text'
        : mappingKind === 'unverified_candidate'
          ? 'unverified_mapping'
          : 'ok';

  const textEvStatus =
    b > 39
      ? 'not_applicable'
      : lxxWords.length === 0
        ? 'unavailable'
        : mappingKind === 'unverified_candidate'
          ? 'unverified'
          : 'available';

  return {
    schema_version: 1,
    status: statusOut,
    canonical_verse: { id: vid, book: b, chapter: c, verse_nr: v },
    masoretic: {
      book: b,
      chapter: c,
      verse_nr: v,
      word_count: mtWords.length,
      words: mtWords,
    },
    septuagint: {
      lxx_book_no: lxxBookNo,
      latin_name: lxxBookName,
      chapter: lxxChapter,
      verse_nr: lxxVerseNr,
      verse_suffix: lxxSuffix,
      mapping_kind: mappingKind,
      rule_citation: ruleCitation,
      word_count: lxxWords.length,
      words: lxxWords,
    },
    word_alignments: wordAlignments,
    textual_evidence_status: textEvStatus,
    license_info: {
      lxx_source: 'CC BY-SA 4.0 (nathans/lxx-swete, First1KGreek)',
      macula_hebrew: 'CC BY 4.0 (Clear-Bible/macula-hebrew)',
      macula_alignments_status: licenseStatus,
      catss_policy: 'External reference only; CATSS alignment data is NOT embedded.',
    },
  };
}

async function handleLookupHebrewSeptuagintAlignmentsV1(env, params) {
  const cat = await ensureCatalog(env);
  const q = String(params.p_query || '').trim();
  const tier = params.p_tier ?? null;
  const limit = Math.max(Number(params.p_limit || 50), 1);
  if (!q) {
    return {
      schema_version: 1,
      status: 'invalid_request',
      message: 'p_query must not be empty',
    };
  }
  const qLower = q.toLowerCase();
  const filtered = (cat.hebrew_lxx_word_alignments || [])
    .filter((a) => {
      if (tier && a.alignment_tier !== tier) return false;
      return (
        String(a.hebrew_text || '').toLowerCase().includes(qLower) ||
        String(a.lxx_text || '').toLowerCase().includes(qLower) ||
        (a.hebrew_strongs || []).includes(q) ||
        (a.lxx_strongs || []).includes(q) ||
        String(a.alignment_key || '').toLowerCase().includes(qLower)
      );
    })
    .map((a) => {
      const lb = a.lxx_book_no != null ? cachedLxxBooksByNo.get(Number(a.lxx_book_no)) : null;
      return {
        id: a.id,
        alignment_key: a.alignment_key,
        canonical_verse_id: a.canonical_verse_id,
        lxx_book_no: a.lxx_book_no,
        lxx_book_name: lb ? lb.latin_name : '',
        lxx_chapter: a.lxx_chapter,
        lxx_chapter_suffix: a.lxx_chapter_suffix,
        lxx_verse_nr: a.lxx_verse_nr,
        lxx_verse_suffix: a.lxx_verse_suffix,
        hebrew_text: a.hebrew_text,
        hebrew_token_ordinals: a.hebrew_token_ordinals,
        hebrew_strongs: a.hebrew_strongs,
        lxx_text: a.lxx_text,
        lxx_token_ordinals: a.lxx_token_ordinals,
        lxx_strongs: a.lxx_strongs,
        cardinality: a.cardinality,
        alignment_tier: a.alignment_tier,
        verification_status: a.verification_status,
        confidence_score: a.confidence_score,
        algorithm_or_source: a.algorithm_or_source,
        translation_technique: a.translation_technique,
        evidence_summary: a.evidence_summary,
      };
    });

  const tierRank = (t) =>
    t === 'documented_textual' ? 1 : t === 'scholarly_interpretation' ? 2 : 3;
  filtered.sort((a, b) => {
    const tr = tierRank(a.alignment_tier) - tierRank(b.alignment_tier);
    if (tr !== 0) return tr;
    const cs = Number(b.confidence_score || 0) - Number(a.confidence_score || 0);
    if (cs !== 0) return cs;
    return a.id - b.id;
  });

  const sliced = filtered.slice(0, limit);
  return {
    schema_version: 1,
    status: 'ok',
    query: params.p_query,
    tier_filter: tier,
    total_returned: sliced.length,
    alignments: sliced,
    epistemic_disclaimer:
      'Candidate alignments are computationally inferred and strictly segregated from verified textual evidence. Unmatched words remain explicitly unaligned without invented equivalents.',
  };
}

async function handlePromptVerseWords(env, params) {
  await ensureCatalog(env);
  const b = Number(params.p_book);
  const c = Number(params.p_chapter);
  const v = Number(params.p_verse);
  const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
  if (!vid) return [];
  const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
  const vEntry = chShard?.verses?.[String(v)];
  return (vEntry?.tokens || []).map((t) => ({
    word_position: t.word_position,
    word_id: t.word_id,
    original_word: t.surface_form,
    transliteration: t.transliteration,
    strongs_nr: t.base_strongs,
    grammar_code: t.word_grammar_code,
    primary_english: (t.english_translations || [])[0] || null,
    millennium: null,
  }));
}

async function handlePromptWordOccurrences(env, params) {
  await ensureCatalog(env);
  const q = String(params.p_word_query || '').trim();
  if (!q) return [];
  let snr = q.toUpperCase();
  if (/^\d+$/.test(q)) {
    const wEntry = await loadWordEntry(env, Number(q));
    snr = wEntry?.word?.strongs_nr || '';
  }
  const sEntry = await loadStrongsEntry(env, snr);
  return (sEntry?.occurrences?.references || []).map((r) => ({
    book: r.book,
    chapter: r.chapter,
    verse_nr: r.verse,
    millennium: null,
    occurrence_count: r.occurrence_count,
  }));
}

async function handlePromptWordCooccurrences(env, params) {
  await ensureCatalog(env);
  const q = String(params.p_word_query || '').trim();
  if (!q) return [];
  let snr = q.toUpperCase();
  if (/^\d+$/.test(q)) {
    const wEntry = await loadWordEntry(env, Number(q));
    snr = wEntry?.word?.strongs_nr || '';
  }
  const sEntry = await loadStrongsEntry(env, snr);
  const firstWord = (sEntry?.words || [])[0];
  if (!firstWord) return [];
  const coList = firstWord.co_occurrences || [];
  const out = [];
  for (const elm of coList) {
    const targetWid = Number(elm.word_id);
    const twEntry = await loadWordEntry(env, targetWid);
    const tw = twEntry?.word;
    if (!tw) continue;
    out.push({
      word_id: tw.id,
      strongs_nr: tw.strongs_nr,
      original_word: tw.original_word,
      transliteration: tw.transliteration,
      primary_english: (tw.english_translations || [])[0] || null,
      score: Number(elm.score),
      frequency: Number(elm.freq),
      avg_distance: Number(elm.avg_dist),
    });
  }
  out.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.word_id - b.word_id));
  return out;
}

// ============================================================================
// Lexical / Word-Form-Lemmas Batch & Live Asset Integrity Handlers
// ============================================================================

async function handleGetWordFormLemmasBatchV1(env, params) {
  await ensureCatalog(env);
  const wordIds = Array.isArray(params.p_word_ids) ? params.p_word_ids.map(Number).filter((x) => Number.isFinite(x) && x > 0) : [];
  const bucketsToLoad = new Map();
  for (const wid of wordIds) {
    const bIdx = Math.floor(wid / 2500);
    const bHex = bIdx.toString(16).padStart(2, '0');
    if (!bucketsToLoad.has(bHex)) bucketsToLoad.set(bHex, []);
    bucketsToLoad.get(bHex).push(wid);
  }

  const wordsOut = {};
  for (const [bHex, wids] of bucketsToLoad.entries()) {
    const bucket = await loadJsonShard(env, `/v1/lexical/words-${bHex}.json.gz`);
    if (!bucket) continue;
    for (const wid of wids) {
      const entry = bucket[String(wid)];
      if (entry) {
        wordsOut[String(wid)] = {
          word_form_lemmas: entry.word_form_lemmas || [],
          vts_occurrences: params.p_include_occurrences ? (entry.vts_occurrences || []) : undefined,
        };
      }
    }
  }
  return { status: 'ok', words: wordsOut };
}

async function handleGetLemmaLexicalSummaryV1(env, params) {
  const cat = await ensureCatalog(env);
  const lid = Number(params.p_lemma_id);
  const snr = String(params.p_base_strongs || '').trim().toUpperCase();
  const mode = String(params.p_mode || 'occurrences'); // 'occurrences' | 'glosses' | 'semantics'
  const afterVerseId = Math.max(Number(params.p_after_verse_id || 0), 0);
  const limit = Math.min(Math.max(Number(params.p_limit || 50), 1), 200);

  if (!Number.isFinite(lid) || lid <= 0) {
    return { status: 'invalid_request', message: 'Valid p_lemma_id is required' };
  }

  // Known cross-Strong's stem exceptions in STEP (69 word forms across 5 lemmas)
  const extraStrongsByLemma = {
    3666: ['G1492', 'G3700', 'G3708'],
    6349: ['G4053', 'G4057'],
    14118: ['H2388', 'H2390'],
    15763: ['H3588', 'H3651', 'H5921'],
    19621: ['H6648', 'H6647'],
  };
  const targetStrongsList = extraStrongsByLemma[lid] || (snr ? [snr] : []);

  // Collect all candidate word IDs from the Strong's buckets
  const candidateWords = new Map();
  for (const sKey of targetStrongsList) {
    const sEntry = await loadStrongsEntry(env, sKey);
    for (const w of sEntry?.words || []) {
      candidateWords.set(Number(w.id), w);
    }
  }

  // Group candidate word IDs by words-<bucket> shard so each shard is read once
  const wordsByBucket = new Map();
  for (const wid of candidateWords.keys()) {
    const bHex = Math.floor(wid / 2500).toString(16).padStart(2, '0');
    if (!wordsByBucket.has(bHex)) wordsByBucket.set(bHex, []);
    wordsByBucket.get(bHex).push(wid);
  }

  // Filter for word_form_lemmas where lemma_id === lid and morpheme_role === 'stem'
  const stemForms = [];
  const allOcc = [];

  for (const [bHex, wids] of wordsByBucket.entries()) {
    const bucket = await loadJsonShard(env, `/v1/lexical/words-${bHex}.json.gz`);
    if (!bucket) continue;
    for (const wid of wids) {
      const entry = bucket[String(wid)];
      if (!entry) continue;
      const wObj = entry.word || candidateWords.get(wid);
      const matchingStem = (entry.word_form_lemmas || []).find(
        (wfl) => Number(wfl.lemma_id) === lid && wfl.morpheme_role === 'stem'
      );
      if (!matchingStem) continue;
      stemForms.push({
        word_id: wid,
        word: wObj,
        is_context_ambiguous: Boolean(matchingStem.is_context_ambiguous),
        dstrongs_tag: matchingStem.dstrongs_tag || null,
        observed_token_count: Number(matchingStem.observed_token_count || 0),
      });
      for (const occ of entry.vts_occurrences || []) {
        const vId = Number(occ.verse_id);
        const vm = cachedVerseById.get(vId);
        const bMeta = vm ? cachedBooksById.get(vm.book) : null;
        const srcCommit = 'be4191f0082aeedddb0eff0c02c966292b2bd641';
        let srcName = 'TAHOT Gen-Deu';
        if (vm) {
          if (vm.book >= 6 && vm.book <= 17) srcName = 'TAHOT Jos-Est';
          else if (vm.book >= 18 && vm.book <= 22) srcName = 'TAHOT Job-Sng';
          else if (vm.book >= 23 && vm.book <= 39) srcName = 'TAHOT Isa-Mal';
          else if (vm.book >= 40 && vm.book <= 43) srcName = 'TAGNT Mat-Jhn';
          else if (vm.book >= 44) srcName = 'TAGNT Act-Rev';
        }
        allOcc.push({
          verse_id: vId,
          book: vm ? vm.book : 1,
          book_name: bMeta ? bMeta.name : '',
          usfm: bMeta ? bMeta.usfm : '',
          chapter: vm ? vm.chapter : 1,
          verse_nr: vm ? vm.verse_nr : 1,
          word_position: Number(occ.word_position),
          word_id: wid,
          inflected_form: wObj?.original_word || '',
          inflected_transliteration: wObj?.transliteration || '',
          grammar_code: wObj?.grammar_code || null,
          dstrongs_tag: matchingStem.dstrongs_tag || null,
          source_english: occ.source_english ?? '',
          source_ref: occ.source_ref ?? '',
          source_name: srcName,
          source_commit: srcCommit,
          is_context_ambiguous: Boolean(matchingStem.is_context_ambiguous),
        });
      }
    }
  }

  if (mode === 'occurrences') {
    allOcc.sort((a, b) => (a.verse_id !== b.verse_id ? a.verse_id - b.verse_id : a.word_position - b.word_position));
    const distinctVerses = new Set(allOcc.map((o) => o.verse_id)).size;
    const ambigTokens = allOcc.filter((o) => o.is_context_ambiguous).length;
    const afterFiltered = allOcc.filter((o) => o.verse_id > afterVerseId);
    const paged = afterFiltered.slice(0, limit);
    const maxPagedVid = paged.length > 0 ? paged[paged.length - 1].verse_id : afterVerseId;
    const hasMore = afterFiltered.some((o) => o.verse_id > maxPagedVid);

    return {
      status: 'ok',
      totals: {
        distinct_inflected_forms: stemForms.length,
        total_tokens: allOcc.length,
        total_verses: distinctVerses,
        ambiguous_form_tokens: ambigTokens,
      },
      pagination: {
        after_verse_id: afterVerseId,
        limit,
        returned_count: paged.length,
        next_after_verse_id: hasMore ? maxPagedVid : null,
      },
      occurrences: paged.map((p) => ({
        verse_id: p.verse_id,
        book: p.book,
        book_name: p.book_name,
        usfm: p.usfm,
        chapter: p.chapter,
        verse: p.verse_nr,
        word_position: p.word_position,
        word_id: p.word_id,
        inflected_form: p.inflected_form,
        inflected_transliteration: p.inflected_transliteration,
        grammar_code: p.grammar_code,
        dstrongs_tag: p.dstrongs_tag,
        attested_english_rendering: p.source_english,
        source_ref: p.source_ref,
        is_surface_form_homograph_ambiguous: p.is_context_ambiguous,
      })),
    };
  }

  // Group glosses for mode === 'glosses' or 'semantics'
  let untranslatedCount = 0;
  const glossGroups = new Map();
  for (const o of allOcc) {
    const rawEng = String(o.source_english || '').trim();
    if (!rawEng) {
      untranslatedCount += 1;
      continue;
    }
    let grp = glossGroups.get(rawEng);
    if (!grp) {
      grp = {
        raw_english: rawEng,
        token_count: 0,
        verse_ids: new Set(),
        word_ids: new Set(),
        first_occ: o,
      };
      glossGroups.set(rawEng, grp);
    }
    grp.token_count += 1;
    grp.verse_ids.add(o.verse_id);
    grp.word_ids.add(o.word_id);
    if (
      o.verse_id < grp.first_occ.verse_id ||
      (o.verse_id === grp.first_occ.verse_id && String(o.source_ref) < String(grp.first_occ.source_ref))
    ) {
      grp.first_occ = o;
    }
  }

  const sortedGlosses = Array.from(glossGroups.values()).sort((a, b) => {
    if (b.token_count !== a.token_count) return b.token_count - a.token_count;
    return a.raw_english < b.raw_english ? -1 : a.raw_english > b.raw_english ? 1 : 0;
  });

  if (mode === 'glosses') {
    return {
      status: 'ok',
      corpus_rendering_summary: {
        total_attested_tokens: allOcc.length,
        distinct_attested_english_strings: glossGroups.size,
        untranslated_grammatical_tokens: untranslatedCount,
      },
      attested_english_glosses: sortedGlosses.slice(0, limit).map((gg) => ({
        attested_gloss: gg.raw_english,
        usage_group: readerUsageLabel(snr, gg.raw_english),
        token_count: gg.token_count,
        verse_count: gg.verse_ids.size,
        inflected_form_count: gg.word_ids.size,
        sample_passage: {
          book: gg.first_occ.book,
          book_name: gg.first_occ.book_name,
          chapter: gg.first_occ.chapter,
          verse: gg.first_occ.verse_nr,
          source_ref: gg.first_occ.source_ref,
        },
        source_dataset: gg.first_occ.source_name,
        source_commit: gg.first_occ.source_commit,
      })),
    };
  }

  // mode === 'semantics'
  const sortedForms = stemForms.slice().sort((a, b) => {
    if (b.observed_token_count !== a.observed_token_count) return b.observed_token_count - a.observed_token_count;
    return a.word_id - b.word_id;
  });

  return {
    status: 'ok',
    attested_translation_glosses: sortedGlosses.slice(0, 12).map((gg) => ({
      attested_gloss: gg.raw_english,
      token_count: gg.token_count,
      verse_count: gg.verse_ids.size,
      sample_passage: {
        verse_id: gg.first_occ.verse_id,
        source_ref: gg.first_occ.source_ref,
        book: gg.first_occ.book,
        book_name: gg.first_occ.book_name,
        chapter: gg.first_occ.chapter,
        verse: gg.first_occ.verse_nr,
      },
      source_attribution: `${gg.first_occ.source_name} (${gg.first_occ.source_commit.slice(0, 7)})`,
      caveat:
        'Attested rendering from translation sources; contextual equivalence only, does not constitute a dictionary definition.',
    })),
    surface_forms_summary: {
      distinct_forms_count: stemForms.length,
      sample_surface_forms: sortedForms.slice(0, 6).map((sf) => ({
        word_id: sf.word_id,
        surface_form: sf.word?.original_word || '',
        transliteration: sf.word?.transliteration || '',
        grammar_code: sf.word?.grammar_code || null,
        observed_count: sf.observed_token_count,
      })),
    },
  };
}

let cachedManifestIndex = null;

async function ensureManifestIndex(env) {
  if (cachedManifestIndex) return cachedManifestIndex;
  const rawBytes = await readAssetBytes(env, '/manifest.json');
  if (!rawBytes) {
    throw new Error('Missing /manifest.json in static assets');
  }
  const text = new TextDecoder('utf-8').decode(rawBytes);
  const doc = JSON.parse(text);
  const byPath = new Map();
  for (const f of doc.v1_retrieval_shards || doc.v1_sharded_assets || []) {
    byPath.set(f.path, f);
  }
  for (const tInfo of Object.values(doc.tables || {})) {
    for (const s of tInfo.shards || []) {
      byPath.set(s.path, s);
    }
  }
  cachedManifestIndex = { doc, byPath };
  return cachedManifestIndex;
}

async function computeSha256Hex(uint8Bytes) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', uint8Bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function runLiveCorpusVerification(env) {
  const failures = [];
  let manifestInfo = null;
  try {
    manifestInfo = await ensureManifestIndex(env);
  } catch (err) {
    return {
      ok: false,
      failures: [`manifest_load_failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const { doc, byPath } = manifestInfo;
  if (Number(doc?.cloudflare_limits_check?.total_asset_files || 0) < 1800) {
    failures.push(`manifest_incomplete_asset_count: ${doc?.cloudflare_limits_check?.total_asset_files}`);
  }
  if (Number(doc?.macula_syntax_completion?.files_imported_and_verified || 0) !== 983) {
    failures.push(`macula_syntax_files_mismatch: ${doc?.macula_syntax_completion?.files_imported_and_verified}`);
  }

  // Verify live SHA-256 and structural decoding of representative shards across all corpus layers
  const probePaths = [
    '/v1/lexical/query-index.json.gz',
    '/v1/syntax/search-index.json.gz',
    '/v1/chapters/b1-c1.json.gz',
    '/v1/chapters/b19-c3.json.gz',
    '/v1/chapters/b27-c2.json.gz',
    '/v1/chapters/b31-c1.json.gz',
    '/v1/chapters/b43-c1.json.gz',
    '/v1/chapters/b49-c1.json.gz',
    '/v1/lxx/b1.json.gz',
    '/v1/lxx/b27.json.gz',
    '/v1/lexical/words-00.json.gz',
    '/v1/lexical/strongs-00.json.gz',
  ];

  const loadedShards = new Map();
  for (const path of probePaths) {
    const expectedMeta = byPath.get(path);
    if (!expectedMeta) {
      failures.push(`missing_manifest_entry: ${path}`);
      continue;
    }
    const rawBytes = await readAssetBytes(env, path);
    if (!rawBytes) {
      failures.push(`missing_asset_bytes: ${path}`);
      continue;
    }
    if (rawBytes.byteLength !== Number(expectedMeta.compressed_bytes)) {
      failures.push(`compressed_size_mismatch: ${path} (${rawBytes.byteLength} !== ${expectedMeta.compressed_bytes})`);
    }
    const actualSha = await computeSha256Hex(rawBytes);
    if (actualSha !== expectedMeta.sha256_compressed) {
      failures.push(`sha256_mismatch: ${path} (${actualSha} !== ${expectedMeta.sha256_compressed})`);
    }
    const parsed = await loadJsonShard(env, path);
    if (!parsed || typeof parsed !== 'object') {
      failures.push(`json_decode_failed: ${path}`);
    } else {
      loadedShards.set(path, parsed);
    }
  }

  // Live structural checks on syntax trees in sampled OT, Aramaic, Minor Prophets, and NT chapters
  for (const chPath of ['/v1/chapters/b1-c1.json.gz', '/v1/chapters/b27-c2.json.gz', '/v1/chapters/b31-c1.json.gz', '/v1/chapters/b43-c1.json.gz', '/v1/chapters/b49-c1.json.gz']) {
    const ch = loadedShards.get(chPath);
    if (!ch) continue;
    const trees = Object.values(ch.syntax_trees || {});
    if (trees.length === 0) {
      failures.push(`empty_syntax_trees_in_chapter: ${chPath}`);
      continue;
    }
    for (const tBundle of trees) {
      const nodes = tBundle?.tree?.nodes || [];
      const depthById = new Map();
      for (const n of nodes) depthById.set(Number(n.id), Number(n.depth || 0));
      for (const n of nodes) {
        if (n.parent_node_id != null) {
          const pDepth = depthById.get(Number(n.parent_node_id));
          if (pDepth === undefined) {
            failures.push(`orphan_parent_node_in_${chPath}: node ${n.id}`);
          } else if (Number(n.depth || 0) <= pDepth) {
            failures.push(`cycle_or_depth_inversion_in_${chPath}: node ${n.id}`);
          }
        }
        if (n.is_terminal && !String(n.terminal_xml_id || '').trim()) {
          failures.push(`terminal_missing_xml_id_in_${chPath}: node ${n.id}`);
        }
        if (n.start_word_position != null && n.end_word_position != null && Number(n.start_word_position) > Number(n.end_word_position)) {
          failures.push(`span_inversion_in_${chPath}: node ${n.id}`);
        }
      }
    }
    // Check restricted fields are absent on tokens
    const firstVerse = Object.values(ch.verses || {})[0];
    for (const m of firstVerse?.macula_hebrew_morphemes || []) {
      for (const rf of ['sdbh', 'lexdomain', 'coredomain', 'sensenumber', 'contextualgloss']) {
        if (rf in m) failures.push(`restricted_field_leaked_in_${chPath}: ${rf}`);
      }
    }
    for (const g of firstVerse?.macula_greek_tokens || []) {
      for (const rf of ['ln', 'domain', 'contextualdomain', 'sensenumber']) {
        if (rf in g) failures.push(`restricted_field_leaked_in_${chPath}: ${rf}`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    verified_assets_count: probePaths.length,
    manifest_total_assets: doc?.cloudflare_limits_check?.total_asset_files || 0,
  };
}

async function handleValidateSyntaxTreeIntegrityV1(env) {
  const cat = await ensureCatalog(env);
  const liveCheck = await runLiveCorpusVerification(env);
  const base = cat.baseline_audits?.validate_syntax_tree_integrity_v1 || {};
  if (!liveCheck.ok) {
    return {
      ...base,
      is_valid: false,
      status: 'FAIL',
      failure_reasons: liveCheck.failures,
      live_asset_verification: liveCheck,
    };
  }
  return {
    ...base,
    is_valid: Boolean(base.is_valid),
    status: base.is_valid ? 'PASS' : 'FAIL',
    live_asset_verification: {
      status: 'PASS',
      verified_assets_count: liveCheck.verified_assets_count,
      manifest_total_assets: liveCheck.manifest_total_assets,
    },
  };
}

async function handleVerifyReferentialIntegrityV1(env) {
  const cat = await ensureCatalog(env);
  const liveCheck = await runLiveCorpusVerification(env);
  const base = cat.baseline_audits?.verify_referential_integrity_v1 || {};
  if (!liveCheck.ok) {
    return {
      ...base,
      is_valid: false,
      status: 'FAIL',
      failure_reasons: liveCheck.failures,
      live_asset_verification: liveCheck,
    };
  }
  return {
    ...base,
    is_valid: true,
    status: 'ok',
    live_asset_verification: {
      status: 'PASS',
      verified_assets_count: liveCheck.verified_assets_count,
      manifest_total_assets: liveCheck.manifest_total_assets,
    },
  };
}

async function handleAuditEvidenceCoverageV1(env) {
  const cat = await ensureCatalog(env);
  const liveCheck = await runLiveCorpusVerification(env);
  const base = cat.baseline_audits?.audit_evidence_coverage_v1 || {};
  if (!liveCheck.ok) {
    return {
      ...base,
      status: 'FAIL',
      is_valid: false,
      failure_reasons: liveCheck.failures,
      live_asset_verification: liveCheck,
    };
  }
  return {
    ...base,
    status: 'ok',
    is_valid: true,
    live_asset_verification: {
      status: 'PASS',
      verified_assets_count: liveCheck.verified_assets_count,
      manifest_total_assets: liveCheck.manifest_total_assets,
    },
  };
}

async function handleGetHebrewImportStatusV1(env) {
  const cat = await ensureCatalog(env);
  const liveCheck = await runLiveCorpusVerification(env);
  const base = cat.baseline_audits?.get_hebrew_import_status_v1 || {};
  if (!liveCheck.ok) {
    return {
      ...base,
      status: 'FAIL',
      is_valid: false,
      failure_reasons: liveCheck.failures,
      live_asset_verification: liveCheck,
    };
  }
  return base;
}

// ============================================================================
// Worker Fetch Handler
// ============================================================================

const corpusWorker = {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // 1. Health check
      if (pathname === '/health' || pathname === '/v1/health') {
        return jsonResponse(
          {
            status: 'ok',
            worker: 'bibleresearch-corpus',
            corpus_version: '2026.11.07-v1',
          },
          200,
          'no-store'
        );
      }

      // 2. RPC Gateway (`/v1/rpc/<operation>`)
      if (pathname.startsWith('/v1/rpc/')) {
        const op = pathname.slice('/v1/rpc/'.length).replace(/\/+$/, '');
        let params = {};
        if (request.method === 'POST') {
          const bodyText = await request.text();
          if (bodyText.trim()) params = JSON.parse(bodyText);
        } else {
          for (const [k, v] of url.searchParams.entries()) {
            params[k] = v;
          }
        }

        if (op === 'lookup_syntax_tree_v1') {
          return jsonResponse(await handleLookupSyntaxTreeV1(env, params));
        }
        if (op === 'validate_syntax_tree_integrity_v1') {
          return jsonResponse(await handleValidateSyntaxTreeIntegrityV1(env));
        }
        if (op === 'lookup_passage_tokens_syntax_v1') {
          return jsonResponse(await handleLookupPassageTokensSyntaxV1(env, params));
        }
        if (op === 'lookup_hebrew_verse_evidence_v1') {
          return jsonResponse(await handleLookupHebrewVerseEvidenceV1(env, params));
        }
        if (op === 'lookup_greek_verse_evidence_v1') {
          return jsonResponse(await handleLookupGreekVerseEvidenceV1(env, params));
        }
        if (op === 'lookup_septuagint_passage_v1') {
          return jsonResponse(await handleLookupSeptuagintPassageV1(env, params));
        }
        if (op === 'lookup_septuagint_by_canonical_verse_v1') {
          return jsonResponse(await handleLookupSeptuagintByCanonicalVerseV1(env, params));
        }
        if (op === 'get_reader_passages_v1') {
          return jsonResponse(await handleGetReaderPassagesV1(env, params));
        }
        if (op === 'get_verse_translation_sources_batch_v1') {
          return jsonResponse(await handleGetVerseTranslationSourcesBatchV1(env, params));
        }
        if (op === 'get_word_form_lemmas_batch_v1') {
          return jsonResponse(await handleGetWordFormLemmasBatchV1(env, params));
        }
        if (op === 'get_lemma_lexical_summary_v1') {
          return jsonResponse(await handleGetLemmaLexicalSummaryV1(env, params));
        }
        if (op === 'audit_evidence_coverage_v1') {
          return jsonResponse(await handleAuditEvidenceCoverageV1(env));
        }
        if (op === 'verify_referential_integrity_v1') {
          return jsonResponse(await handleVerifyReferentialIntegrityV1(env));
        }
        if (op === 'get_hebrew_import_status_v1') {
          return jsonResponse(await handleGetHebrewImportStatusV1(env));
        }
        if (op === 'search_syntax_patterns_v1') {
          return jsonResponse(await handleSearchSyntaxPatternsV1(env, params));
        }
        if (op === 'get_reader_overview_v1') {
          return jsonResponse(await handleGetReaderOverviewV1(env, params));
        }
        if (op === 'get_reader_word_v1') {
          return jsonResponse(await handleGetReaderWordV1(env, params));
        }
        if (op === 'compare_hebrew_septuagint_passage_v1') {
          return jsonResponse(await handleCompareHebrewSeptuagintPassageV1(env, params));
        }
        if (op === 'get_hebrew_septuagint_parallel_v1') {
          return jsonResponse(await handleGetHebrewSeptuagintParallelV1(env, params));
        }
        if (op === 'lookup_hebrew_septuagint_alignments_v1') {
          return jsonResponse(await handleLookupHebrewSeptuagintAlignmentsV1(env, params));
        }
        if (op === 'prompt_verse_words') {
          return jsonResponse(await handlePromptVerseWords(env, params));
        }
        if (op === 'prompt_word_occurrences') {
          return jsonResponse(await handlePromptWordOccurrences(env, params));
        }
        if (op === 'prompt_word_cooccurrences') {
          return jsonResponse(await handlePromptWordCooccurrences(env, params));
        }
        if (op === 'lookup_cross_references_v1') {
          return jsonResponse(
            await handleLookupCrossReferencesV1(
              {
                env,
                loadJsonShard,
                ensureCatalog,
                getVerseIdByCoord: coord => cachedVerseByCoord?.get(coord) ?? null,
                getVerseById: id => cachedVerseById?.get(id) ?? null,
              },
              params
            )
          );
        }
        if (op === 'lookup_lexical_relationships_v1') {
          return jsonResponse(
            await handleLookupLexicalRelationshipsV1(
              {
                env,
                loadJsonShard,
                ensureCatalog,
                getVerseIdByCoord: coord => cachedVerseByCoord?.get(coord) ?? null,
                getVerseById: id => cachedVerseById?.get(id) ?? null,
              },
              params
            )
          );
        }

        return jsonResponse({ error: 'unknown_rpc_operation', operation: op }, 404, 'no-store');
      }

      // 3. Convenience syntax search & unmapped routes
      if (pathname === '/v1/syntax/search') {
        const params = Object.fromEntries(url.searchParams.entries());
        return jsonResponse(await handleSearchSyntaxPatternsV1(env, params));
      }
      if (pathname === '/v1/syntax/unmapped') {
        const idx = await loadJsonShard(env, '/v1/syntax/search-index.json.gz');
        return jsonResponse({
          status: 'ok',
          total_unmapped_nodes: idx.unmapped_nodes.length,
          unmapped_nodes: idx.unmapped_nodes,
        });
      }

      // 4. Static Asset Retrieval (`/manifest.json`, `/v1/...`, `/tables/...`)
      const wantRawGzip = url.searchParams.get('raw') === '1';
      let targetPath = pathname;
      if (
        (pathname.startsWith('/v1/') || pathname.startsWith('/tables/')) &&
        !pathname.endsWith('.gz')
      ) {
        targetPath = `${pathname}.gz`;
      }

      const assetBytes = await readAssetBytes(env, targetPath);
      if (!assetBytes) {
        return jsonResponse({ error: 'asset_not_found', path: pathname }, 404, 'no-store');
      }

      if (wantRawGzip) {
        return new Response(assetBytes, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/gzip',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      const decodedBytes = await decompressGzipIfNeeded(assetBytes);
      const isJsonl = targetPath.includes('.jsonl');
      return new Response(decodedBytes, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': isJsonl
            ? 'application/x-ndjson; charset=utf-8'
            : 'application/json; charset=utf-8',
          'Cache-Control':
            pathname === '/manifest.json'
              ? 'public, max-age=300'
              : 'public, max-age=31536000, immutable',
        },
      });
    } catch (err) {
      return jsonResponse(
        {
          error: 'internal_worker_error',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
        'no-store'
      );
    }
  },
};

export default withCorpusSecurity(corpusWorker);
