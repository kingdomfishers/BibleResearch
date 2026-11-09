/**
 * scripts/build-relationship-slice.mjs
 * Deterministic vertical-slice builder for static biblical cross-references and
 * lexical relationships under `.artifacts/static-corpus/v1/relationships/`.
 *
 * - Reuses existing canonical identifiers, `lemma_root_links`, `entity_relationships`,
 *   `lexical_formations`, `lemma_components`, `lexical_connections`, and `word_form_lemmas`.
 * - Parses real STEP Bible (`TBESH.txt` cols 0-6 only; `TBESG.txt` cols 0-7) markers.
 * - Transforms pinned `CrossReferences-org/bible-cross-references` slice rows
 *   (commit `671bbf73b1e5155e31b209442dc5be3f5b3c1a41`), preserving Psalm verse 0,
 *   split verses, and 16+1 KJV/TR edition-only coordinates while excluding `s21`.
 * - Does NOT execute full bulk corpus import or mutate Supabase.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fnv1a64Hex, CROSS_REFERENCE_GUARDRAILS, DEFAULT_XREF_ATTRIBUTION } from './corpus-relationships-rpc.mjs';

const CORPUS_ROOT = path.resolve('.artifacts/static-corpus');
const OUT_DIR = path.join(CORPUS_ROOT, 'v1/relationships');
const XREF_FIXTURE_PATH = path.resolve('scripts/fixtures/crossreferences-org-slice.json');
const TBESH_PATH = path.resolve('.artifacts/stepbible/TBESH.txt');
const TBESG_PATH = path.resolve('.artifacts/stepbible/TBESG.txt');

const STEP_COMMIT = 'be4191f0082aeedddb0eff0c02c966292b2bd641';

function readGzipJson(relPath) {
  const full = path.join(CORPUS_ROOT, relPath);
  const raw = fs.readFileSync(full);
  return JSON.parse(zlib.gunzipSync(raw).toString('utf8'));
}

function readGzipJsonl(relPath) {
  const full = path.join(CORPUS_ROOT, relPath);
  if (!fs.existsSync(full)) return [];
  const text = zlib.gunzipSync(fs.readFileSync(full)).toString('utf8').trim();
  if (!text) return [];
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function writeGzipJson(outFile, obj) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const json = JSON.stringify(obj);
  const gz = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
  fs.writeFileSync(outFile, gz);
}

function endpointSpanKey(ep) {
  if (ep.versification_status === 'edition_only_non_canonical' && ep.edition_only_ref) {
    const r = ep.edition_only_ref;
    return `ed:${r.edition}:${r.book}:${r.chapter}:${r.verse}`;
  }
  return ep.verse_start === ep.verse_end
    ? `v:${ep.book}:${ep.chapter}:${ep.verse_start}`
    : `r:${ep.book}:${ep.chapter}:${ep.verse_start}-${ep.verse_end}`;
}

function buildXrefId(sourceKey, sourcePassage, subverseSort, anchorSort, targetSpans) {
  const srcKey = endpointSpanKey(sourcePassage);
  const tgtKey = targetSpans.map(endpointSpanKey).join('+');
  const raw = `xref|${sourceKey}|${srcKey}|s${subverseSort}|a${anchorSort}|${tgtKey}`;
  return `rel:v1:xref:${sourceKey}:${srcKey}:s${subverseSort}:a${anchorSort}:${fnv1a64Hex(raw).slice(0, 12)}`;
}

const SYMMETRIC_LEX = new Set([
  'same_lemma',
  'same_documented_root',
  'semantic_overlap',
  'synonymy',
  'antonymy',
  'related_translation',
  'literary_wordplay',
  'orthographic_overlap',
  'co_occurrence',
]);

function buildLexId(sourceKey, category, rawCode, tier, subjKey, tgtKey) {
  const sym = SYMMETRIC_LEX.has(category);
  const [a, b] = sym && subjKey > tgtKey ? [tgtKey, subjKey] : [subjKey, tgtKey];
  const arrow = sym ? '<->' : '->';
  const raw = `lex|${sourceKey}|${category}|${rawCode}|${tier}|${a}${arrow}${b}`;
  return `rel:v1:lex:${category}:${a}:${b}:${fnv1a64Hex(raw).slice(0, 12)}`;
}

function lexicalGuardrails(category) {
  return {
    implies_synonymy: category === 'synonymy',
    implies_common_etymology:
      category === 'same_lemma' ||
      category === 'same_documented_root' ||
      category === 'derivation' ||
      category === 'cognate' ||
      category === 'morphological_relationship',
    inferred_from_english_gloss: false,
    inferred_from_spelling_alone: false,
  };
}

function normalizeGreekStrip(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\u0370-\u03ff\u1f00-\u1fff]/g, '')
    .toLowerCase();
}

function normalizeHebrewConsonants(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[^\u05d0-\u05ea]/g, '');
}

// 1. Load Canonical Catalog
const catalog = readGzipJson('v1/catalog/metadata.json.gz');
const verseIdByCoord = new Map();
const verseById = new Map();
const bookNameById = new Map();
for (const b of catalog.books) {
  bookNameById.set(Number(b.id), b.name);
}
for (const [id, book, chapter, verse_nr] of catalog.verses_compact) {
  verseIdByCoord.set(`${book}:${chapter}:${verse_nr}`, id);
  verseById.set(id, { id, book, chapter, verse_nr });
}

function formatSpanLabel(spans) {
  return spans
    .map(ep => {
      const bName = bookNameById.get(ep.book) || `Book ${ep.book}`;
      if (ep.versification_status === 'edition_only_non_canonical' && ep.edition_only_ref) {
        const r = ep.edition_only_ref;
        return `${bName} ${r.chapter}:${r.verse} (${r.edition} edition-only)`;
      }
      const range = ep.verse_start === ep.verse_end
        ? `${ep.chapter}:${ep.verse_start}`
        : `${ep.chapter}:${ep.verse_start}-${ep.verse_end}`;
      return ep.is_psalm_heading ? `${bName} ${range} (Heading)` : `${bName} ${range}`;
    })
    .join('; ');
}

// 2. Build Cross-Reference Shards from Pinned Fixture
const xrefFixture = JSON.parse(fs.readFileSync(XREF_FIXTURE_PATH, 'utf8'));
const bsbGroupCounts = new Map();
for (const v of xrefFixture.bible_verses) {
  const k = `${v.book_id}:${v.bsb_ch}:${v.bsb_vs}`;
  bsbGroupCounts.set(k, (bsbGroupCounts.get(k) || 0) + 1);
}

const mappedBySourceUid = new Map();
const editionOnlyVerses = {};

for (const v of xrefFixture.bible_verses) {
  const b = v.book_id;
  const bsbGroupKey = `${b}:${v.bsb_ch}:${v.bsb_vs}`;
  const groupCount = bsbGroupCounts.get(bsbGroupKey) || 1;

  // Case A: Psalm superscriptions in 63 two-row Psalms (kjv_sort=1 -> v.0, kjv_sort=2 -> v.1)
  if (b === 19 && v.bsb_vs === 1 && groupCount === 2) {
    const targetVerse = v.kjv_sort === 1 ? 0 : 1;
    const vid = verseIdByCoord.get(`19:${v.bsb_ch}:${targetVerse}`) ?? null;
    mappedBySourceUid.set(v.id, {
      endpoint: {
        book: 19,
        chapter: v.bsb_ch,
        verse_start: targetVerse,
        verse_end: targetVerse,
        start_verse_id: vid,
        end_verse_id: vid,
        is_psalm_heading: targetVerse === 0,
        versification_status: targetVerse === 0 ? 'exact_psalm_heading' : 'exact_canonical',
        edition_only_ref: null,
        versification_note: targetVerse === 0
          ? 'Mapped CrossReferences.org Psalm superscription row (kjv_sort=1, aov_vs=1) to canonical verse 0.'
          : null,
      },
      subverseSort: 1,
      alsoIndexPsalmV0: false,
    });
    continue;
  }

  // Case B: Single-row Psalm v.1 where canonical has v.0 + v.1 (53 short-heading Psalms)
  if (b === 19 && v.bsb_vs === 1 && groupCount === 1 && verseIdByCoord.has(`19:${v.bsb_ch}:0`)) {
    const vid = verseIdByCoord.get(`19:${v.bsb_ch}:1`);
    mappedBySourceUid.set(v.id, {
      endpoint: {
        book: 19,
        chapter: v.bsb_ch,
        verse_start: 1,
        verse_end: 1,
        start_verse_id: vid,
        end_verse_id: vid,
        is_psalm_heading: false,
        versification_status: 'combined_heading_and_verse1',
        edition_only_ref: null,
        versification_note: 'Source combines short Psalm superscription (v.0) and v.1 into one row.',
      },
      subverseSort: 1,
      alsoIndexPsalmV0: true,
    });
    continue;
  }

  // Case C: Canonical BSB coordinate exists
  const directVid = verseIdByCoord.get(`${b}:${v.bsb_ch}:${v.bsb_vs}`);
  if (directVid != null && v.has_bsb_text) {
    const isKjvShift = v.kjv_ch !== v.bsb_ch || v.kjv_vs !== v.bsb_vs;
    const isSubverse = groupCount > 1;
    mappedBySourceUid.set(v.id, {
      endpoint: {
        book: b,
        chapter: v.bsb_ch,
        verse_start: v.bsb_vs,
        verse_end: v.bsb_vs,
        start_verse_id: directVid,
        end_verse_id: directVid,
        is_psalm_heading: false,
        versification_status: isKjvShift
          ? 'versification_shift'
          : isSubverse
            ? 'sub_verse_part'
            : 'exact_canonical',
        edition_only_ref: null,
        versification_note: isKjvShift
          ? `KJV ${v.kjv_ch}:${v.kjv_vs} corresponds to canonical/BSB ${v.bsb_ch}:${v.bsb_vs}.`
          : isSubverse
            ? `Sub-verse segment ${v.bsb_sort} of ${groupCount} in source versification table.`
            : null,
      },
      subverseSort: v.bsb_sort || 1,
      alsoIndexPsalmV0: false,
    });
    continue;
  }

  // Case D: 2 Cor 13:14 shift (aov 13:13 = canonical 47:13:13)
  if (b === 47 && v.bsb_ch === 13 && v.bsb_vs === 14 && verseIdByCoord.has('47:13:13')) {
    const vid13 = verseIdByCoord.get('47:13:13');
    const ep = {
      book: 47,
      chapter: 13,
      verse_start: 13,
      verse_end: 13,
      start_verse_id: vid13,
      end_verse_id: vid13,
      is_psalm_heading: false,
      versification_status: 'versification_shift',
      edition_only_ref: { edition: 'BSB', book: 47, chapter: 13, verse: 14, source_verse_uid: v.id },
      versification_note: 'English 2 Cor 13:14 maps to Greek NA28/canonical 2 Cor 13:13 (source aov 13:13).',
    };
    mappedBySourceUid.set(v.id, { endpoint: ep, subverseSort: 2, alsoIndexPsalmV0: false });
    editionOnlyVerses['47:13:14'] = ep;
    continue;
  }

  // Case E: 16 KJV/Textus Receptus-only NT verses (no row in NA28-based canonical verses)
  const edEp = {
    book: b,
    chapter: v.kjv_ch,
    verse_start: v.kjv_vs,
    verse_end: v.kjv_vs,
    start_verse_id: null,
    end_verse_id: null,
    is_psalm_heading: false,
    versification_status: 'edition_only_non_canonical',
    edition_only_ref: {
      edition: 'KJV',
      book: b,
      chapter: v.kjv_ch,
      verse: v.kjv_vs,
      source_verse_uid: v.id,
    },
    versification_note: `Textus Receptus / KJV-only verse (${bookNameById.get(b)} ${v.kjv_ch}:${v.kjv_vs}); absent in NA28/BSB canonical numbering.`,
  };
  mappedBySourceUid.set(v.id, { endpoint: edEp, subverseSort: 1, alsoIndexPsalmV0: false });
  editionOnlyVerses[`${b}:${v.kjv_ch}:${v.kjv_vs}`] = edEp;
}

function collapseTargetGroup(uidGroup) {
  const eps = uidGroup
    .map(uid => mappedBySourceUid.get(uid)?.endpoint)
    .filter(Boolean);
  if (!eps.length) return [];
  const merged = [{ ...eps[0] }];
  for (let i = 1; i < eps.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = eps[i];
    if (
      prev.versification_status !== 'edition_only_non_canonical' &&
      cur.versification_status !== 'edition_only_non_canonical' &&
      prev.book === cur.book &&
      prev.chapter === cur.chapter &&
      cur.verse_start === prev.verse_end + 1 &&
      !prev.is_psalm_heading &&
      !cur.is_psalm_heading
    ) {
      prev.verse_end = cur.verse_end;
      prev.end_verse_id = cur.end_verse_id;
    } else if (
      prev.book === cur.book &&
      prev.chapter === cur.chapter &&
      prev.verse_start === cur.verse_start &&
      prev.verse_end === cur.verse_end
    ) {
      continue;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

const bookShards = new Map();
function ensureBookShard(bookId) {
  if (!bookShards.has(bookId)) {
    bookShards.set(bookId, {
      schema_version: 1,
      book_id: bookId,
      coverage: 'slice',
      covered_verses: new Set(),
      outgoing_by_verse: {},
      incoming_by_verse: {},
      edition_only_by_coord: {},
      versification_status_by_coord: {},
      versification_notes_by_coord: {},
    });
  }
  return bookShards.get(bookId);
}

// Register covered verses
for (const [coord, edEp] of Object.entries(editionOnlyVerses)) {
  const [bStr, chStr, vsStr] = coord.split(':');
  const shard = ensureBookShard(Number(bStr));
  shard.edition_only_by_coord[`${chStr}:${vsStr}`] = { endpoint: edEp, outgoing: [], incoming: [] };
}

const SLICE_COORDS = [
  '1:1:1', '1:1:2', '1:1:3', '1:1:4', '1:1:5',
  '1:2:4', '1:2:5', '1:2:7',
  '18:1:21',
  '19:3:0', '19:3:1', '19:23:0', '19:23:1', '19:110:0', '19:110:1',
  '20:8:22', '20:8:23', '20:8:24',
  '23:53:7',
  '43:1:1', '43:1:2', '43:1:3', '43:1:4', '43:1:5',
  '47:13:13',
  '64:1:14', '64:1:15',
];
for (const sid of [xrefFixture.special_cases?.dupGroupVerseId, xrefFixture.special_cases?.multiAnchorSameTargetVerseId]) {
  const m = sid ? mappedBySourceUid.get(sid) : null;
  if (m && m.endpoint.start_verse_id != null) {
    SLICE_COORDS.push(`${m.endpoint.book}:${m.endpoint.chapter}:${m.endpoint.verse_start}`);
  }
}
for (const c of SLICE_COORDS) {
  const [b, ch, vs] = c.split(':').map(Number);
  ensureBookShard(b).covered_verses.add(`${ch}:${vs}`);
}

let globalRank = 0;
for (const xr of xrefFixture.cross_references) {
  const srcMapped = mappedBySourceUid.get(xr.verse_id);
  if (!srcMapped) continue;
  const srcEp = srcMapped.endpoint;
  const srcShard = ensureBookShard(srcEp.book);
  const srcCoord = `${srcEp.chapter}:${srcEp.verse_start}`;
  if (srcEp.versification_note) {
    srcShard.versification_notes_by_coord[srcCoord] = srcEp.versification_note;
  }
  srcShard.versification_status_by_coord[srcCoord] = srcEp.versification_status;

  const phraseBsb = xr.bsb && xr.bsb.trim() ? xr.bsb.trim() : null;
  const phraseKjv = xr.kjv && xr.kjv.trim() ? xr.kjv.trim() : null;
  const anchor = {
    anchor_sort: xr.sort,
    anchor_scope: phraseBsb || phraseKjv ? 'phrase' : 'whole_verse',
    phrase_bsb: phraseBsb,
    phrase_kjv: phraseKjv,
    phrase_language: 'en',
    token_alignment: null,
    source_subverse_sort: srcMapped.subverseSort,
  };

  // Deduplicate exact duplicate target groups within the SAME (verse_id, sort) anchor
  const seenGroupsInAnchor = new Set();
  (xr.refs || []).forEach((grp, grpIdx) => {
    const spans = collapseTargetGroup(grp);
    if (!spans.length) return;
    const spanSig = spans.map(endpointSpanKey).join('+');
    if (seenGroupsInAnchor.has(spanSig)) return;
    seenGroupsInAnchor.add(spanSig);

    globalRank += 1;
    const targetKind = spans.length > 1
      ? 'verse_cluster'
      : spans[0].verse_start !== spans[0].verse_end
        ? 'verse_range'
        : 'single_verse';
    const relId = buildXrefId(
      'crossreferences_org_v1',
      srcEp,
      srcMapped.subverseSort,
      xr.sort,
      spans
    );
    const targetLabel = formatSpanLabel(spans);
    const baseProvenance = {
      ...DEFAULT_XREF_ATTRIBUTION,
      locator: `json/cross_references.json#verse_id=${xr.verse_id}&sort=${xr.sort}&grp=${grpIdx + 1}`,
      raw_field: 'refs',
      algorithm_version: null,
    };

    const outEdge = {
      relationship_id: relId,
      schema_version: 1,
      domain: 'cross_reference',
      relation_type: 'source_passage_association',
      epistemic_tier: 'attested_lexical_fact',
      direction: 'outgoing',
      source_passage: srcEp,
      anchor,
      target_kind: targetKind,
      target_spans: spans,
      target_label: targetLabel,
      group_ordinal: grpIdx + 1,
      rank_order: globalRank,
      provenance: baseProvenance,
      guardrails: CROSS_REFERENCE_GUARDRAILS,
    };

    if (srcEp.versification_status === 'edition_only_non_canonical') {
      const edBucket = srcShard.edition_only_by_coord[srcCoord];
      if (edBucket) edBucket.outgoing.push(outEdge);
    } else {
      srcShard.covered_verses.add(srcCoord);
      (srcShard.outgoing_by_verse[srcCoord] ??= []).push(outEdge);
      if (srcMapped.alsoIndexPsalmV0) {
        const v0Coord = `${srcEp.chapter}:0`;
        srcShard.covered_verses.add(v0Coord);
        srcShard.versification_status_by_coord[v0Coord] = 'combined_heading_and_verse1';
        srcShard.versification_notes_by_coord[v0Coord] = srcEp.versification_note;
        (srcShard.outgoing_by_verse[v0Coord] ??= []).push(outEdge);
      }
      if (srcEp.edition_only_ref && srcShard.edition_only_by_coord[`${srcEp.edition_only_ref.chapter}:${srcEp.edition_only_ref.verse}`]) {
        srcShard.edition_only_by_coord[`${srcEp.edition_only_ref.chapter}:${srcEp.edition_only_ref.verse}`].outgoing.push(outEdge);
      }
    }

    // Pre-invert incoming reverse lookup onto every target verse in each target span
    const inEdge = {
      ...outEdge,
      epistemic_tier: 'deterministic_computational',
      direction: 'incoming',
      provenance: {
        ...baseProvenance,
        algorithm_version: 'xref_reverse_index_v1',
      },
    };
    for (const sp of spans) {
      const tgtShard = ensureBookShard(sp.book);
      if (sp.versification_status === 'edition_only_non_canonical' && sp.edition_only_ref) {
        const edKey = `${sp.edition_only_ref.chapter}:${sp.edition_only_ref.verse}`;
        if (tgtShard.edition_only_by_coord[edKey]) {
          tgtShard.edition_only_by_coord[edKey].incoming.push(inEdge);
        }
        continue;
      }
      for (let vNum = sp.verse_start; vNum <= sp.verse_end; vNum++) {
        const tCoord = `${sp.chapter}:${vNum}`;
        (tgtShard.incoming_by_verse[tCoord] ??= []).push(inEdge);
      }
    }
  });
}

// Write Cross-Reference book shards
let totalXrefShards = 0;
for (const [bookId, shard] of bookShards.entries()) {
  const pad = String(bookId).padStart(2, '0');
  writeGzipJson(path.join(OUT_DIR, `xrefs-b${pad}.json.gz`), {
    ...shard,
    covered_verses: [...shard.covered_verses].sort(),
  });
  totalXrefShards += 1;
}

// 3. Build Lexical Relationship Vertical Slice from Real Local Corpus + STEP Bible
const lemmasTable = readGzipJsonl('tables/lemmas/part-0000.jsonl.gz');
const lexemesTable = readGzipJsonl('tables/lexemes/part-0000.jsonl.gz');
const rootLinksTable = readGzipJsonl('tables/lemma_root_links/part-0000.jsonl.gz');
const rootsTable = readGzipJsonl('tables/lexical_roots/part-0000.jsonl.gz');
const entityRelsTable = readGzipJsonl('tables/entity_relationships/part-0000.jsonl.gz');
const entitiesTable = readGzipJsonl('tables/canonical_entities/part-0000.jsonl.gz');
const formationsTable = readGzipJsonl('tables/lexical_formations/part-0000.jsonl.gz');
const componentsTable = readGzipJsonl('tables/lemma_components/part-0000.jsonl.gz');
const lexConnsTable = readGzipJsonl('tables/lexical_connections/part-0000.jsonl.gz');
const wflTable = readGzipJsonl('tables/word_form_lemmas/part-0000.jsonl.gz');
const queryIndex = readGzipJson('v1/lexical/query-index.json.gz');

// Load word records across word shards for word_id / co_occurrences / observed English renderings
const wordsById = new Map();
const wordsByStrongs = new Map();
for (const fname of fs.readdirSync(path.join(CORPUS_ROOT, 'v1/lexical'))) {
  if (!fname.startsWith('words-') || !fname.endsWith('.json.gz')) continue;
  const wShard = readGzipJson(`v1/lexical/${fname}`);
  const entries = wShard.words || wShard.entries || wShard;
  for (const val of Object.values(entries)) {
    const w = val.word || val;
    if (!w || typeof w.id !== 'number') continue;
    wordsById.set(w.id, w);
    const st = String(w.strongs_nr || '').toUpperCase();
    if (st) {
      if (!wordsByStrongs.has(st)) wordsByStrongs.set(st, []);
      wordsByStrongs.get(st).push(w);
    }
  }
}

const lemmaById = new Map(lemmasTable.map(l => [l.id, l]));
const lemmaByKey = new Map(lemmasTable.map(l => [l.canonical_key, l]));
const lexemeById = new Map(lexemesTable.map(lx => [lx.id, lx]));
const lexemesByLemmaId = new Map();
const lemmasByBaseStrongs = new Map();
for (const lx of lexemesTable) {
  if (lx.lemma_id) {
    if (!lexemesByLemmaId.has(lx.lemma_id)) lexemesByLemmaId.set(lx.lemma_id, []);
    lexemesByLemmaId.get(lx.lemma_id).push(lx);
  }
}
for (const l of lemmasTable) {
  if (l.base_strongs) {
    const bs = l.base_strongs.toUpperCase();
    if (!lemmasByBaseStrongs.has(bs)) lemmasByBaseStrongs.set(bs, []);
    lemmasByBaseStrongs.get(bs).push(l);
  }
}
const rootById = new Map(rootsTable.map(r => [r.id, r]));
const entityById = new Map(entitiesTable.map(e => [e.id, e]));

const wordIdsByLemmaId = new Map();
for (const row of wflTable) {
  if (!wordIdsByLemmaId.has(row.lemma_id)) wordIdsByLemmaId.set(row.lemma_id, []);
  wordIdsByLemmaId.get(row.lemma_id).push(row.word_id);
}

function makeLexicalEndpoint(lemma) {
  const lxs = lexemesByLemmaId.get(lemma.id) || [];
  const primaryLx = lexemeById.get(lemma.primary_lexeme_id) || lxs[0] || null;
  const wIds = wordIdsByLemmaId.get(lemma.id) || [];
  const compactBase = String(lemma.base_strongs || '').replace(/^([HG])0+(\d+)/, '$1$2');
  const fallbackWords = wordsByStrongs.get(String(lemma.base_strongs || '').toUpperCase())
    || wordsByStrongs.get(compactBase.toUpperCase())
    || [];
  const primaryWordId = wIds[0] ?? fallbackWords[0]?.id ?? null;
  const siblings = lemmasByBaseStrongs.get(String(lemma.base_strongs || '').toUpperCase()) || [];
  return {
    entity_kind: 'lemma',
    canonical_key: lemma.canonical_key,
    lemma_id: lemma.id,
    word_id: primaryWordId,
    language: lemma.language,
    base_strongs: lemma.base_strongs || null,
    extended_strongs: primaryLx?.extended_strongs || null,
    disambiguated_strongs: primaryLx?.disambiguated_strongs || null,
    unified_strongs: primaryLx?.unified_strongs || null,
    homograph_tag: lemma.homograph_tag || null,
    lemma_text: lemma.lemma_text,
    transliteration: lemma.transliteration || primaryLx?.transliteration || null,
    primary_gloss: primaryLx?.primary_gloss || fallbackWords[0]?.english_translations?.[0] || null,
    sense_ambiguous: siblings.length > 1 || lxs.length > 1,
  };
}

// Parse TBESH cols 0..6 ONLY (never read col 7) & TBESG cols 0..7
const tbeshByEStrong = new Map();
if (fs.existsSync(TBESH_PATH)) {
  for (const line of fs.readFileSync(TBESH_PATH, 'utf8').split(/\r?\n/)) {
    if (!/^[H]\d{4}/.test(line)) continue;
    const cols = line.split('\t').slice(0, 7); // Strictly exclude col 7 (Online Bible Meaning)
    tbeshByEStrong.set(cols[0].trim(), {
      eStrong: cols[0].trim(),
      dStrong: (cols[1] || '').trim(),
      uStrong: (cols[2] || '').trim(),
      hebrew: (cols[3] || '').trim(),
      translit: (cols[4] || '').trim(),
      morph: (cols[5] || '').trim(),
      gloss: (cols[6] || '').trim(),
    });
  }
}

const tbesgByEStrong = new Map();
const greekLemmaIndex = new Map();
for (const l of lemmasTable) {
  if (l.language === 'grc') {
    const k = normalizeGreekStrip(l.lemma_text);
    if (k && !greekLemmaIndex.has(k)) greekLemmaIndex.set(k, l);
  }
}
const hebrewConsonantIndex = new Map();
for (const l of lemmasTable) {
  if (l.language === 'hbo') {
    const k = normalizeHebrewConsonants(l.lemma_text);
    if (k && !hebrewConsonantIndex.has(k)) hebrewConsonantIndex.set(k, l);
  }
}

if (fs.existsSync(TBESG_PATH)) {
  for (const line of fs.readFileSync(TBESG_PATH, 'utf8').split(/\r?\n/)) {
    if (!/^G\d{4}/.test(line)) continue;
    const cols = line.split('\t');
    tbesgByEStrong.set(cols[0].trim(), {
      eStrong: cols[0].trim(),
      dStrong: (cols[1] || '').trim(),
      uStrong: (cols[2] || '').trim(),
      greek: (cols[3] || '').trim(),
      translit: (cols[4] || '').trim(),
      morph: (cols[5] || '').trim(),
      gloss: (cols[6] || '').trim(),
      abbottSmith: (cols[7] || '').trim(),
    });
  }
}

// Target vertical slice base Strong's families
const TARGET_BASES = new Set([
  'H7225', 'H7218', 'H1254', 'H6213', 'H0430', 'H0410', 'H0120', 'H0127', 'H1818',
  'H7501', 'H7495', 'H0001', 'H0002', 'H0175', 'H0216', 'H8064', 'H0776',
  'G3056', 'G3004', 'G0746', 'G2316', 'G0450', 'G1453', 'G1458', 'G2723',
  'G0002', 'G0005', 'G5457', 'G4655', 'G0018', 'G2556',
]);

const sliceLemmas = lemmasTable.filter(l => TARGET_BASES.has(String(l.base_strongs || '').toUpperCase()));
const edgesByKey = new Map();
function pushLexEdge(subjLemma, tgtLemma, category, rawCode, tier, reusedTable, explanation, provenance, stats = null, evidenceCoords = [], direction = null) {
  if (!subjLemma || !tgtLemma || subjLemma.canonical_key === tgtLemma.canonical_key && category !== 'same_lemma') return;
  const subj = makeLexicalEndpoint(subjLemma);
  const tgt = makeLexicalEndpoint(tgtLemma);
  const relId = buildLexId(provenance.source_key, category, rawCode, tier, subj.canonical_key, tgt.canonical_key);
  const evidenceVerses = evidenceCoords
    .map(c => {
      const [b, ch, vs] = c.split(':').map(Number);
      const vid = verseIdByCoord.get(c) ?? null;
      return vid ? {
        book: b, chapter: ch, verse_start: vs, verse_end: vs,
        start_verse_id: vid, end_verse_id: vid, is_psalm_heading: b === 19 && vs === 0,
        versification_status: 'exact_canonical', edition_only_ref: null, versification_note: null,
      } : null;
    })
    .filter(Boolean);

  const edge = {
    relationship_id: relId,
    schema_version: 1,
    domain: 'lexical',
    category,
    raw_relation_code: rawCode,
    epistemic_tier: tier,
    direction: direction || (SYMMETRIC_LEX.has(category) ? 'symmetric' : 'directed'),
    subject: subj,
    target: tgt,
    reused_source_table: reusedTable,
    explanation,
    evidence_verses: evidenceVerses,
    statistics: stats,
    provenance,
    guardrails: lexicalGuardrails(category),
  };
  const arr = edgesByKey.get(subj.canonical_key) || [];
  if (!arr.some(x => x.relationship_id === relId && x.target.canonical_key === tgt.canonical_key)) {
    arr.push(edge);
    edgesByKey.set(subj.canonical_key, arr);
  }
}

const stepHProv = (locator, rawField = 'dStrong/uStrong', algo = null) => ({
  source_key: 'stepbible_tbesh_v1',
  source_title: 'STEP Bible TBESH (Tyndale Brief Lexicon of Extended Strongs for Hebrew)',
  dataset_url: 'https://github.com/STEPBible/STEPBible-Data',
  pinned_commit: STEP_COMMIT,
  license: 'CC BY 4.0',
  attribution: 'STEP Bible (www.STEPBible.org) · Tyndale House Cambridge · CC BY 4.0',
  locator,
  raw_field: rawField,
  algorithm_version: algo,
  excluded_restricted_fields: ['TBESH.Meaning_col7_OnlineBible'],
});

const stepGProv = (locator, rawField = 'Abbott-Smith/dStrong', algo = null) => ({
  source_key: 'stepbible_tbesg_v1',
  source_title: 'STEP Bible TBESG (Brief Lexicon of Extended Strongs for Greek / Abbott-Smith)',
  dataset_url: 'https://github.com/STEPBible/STEPBible-Data',
  pinned_commit: STEP_COMMIT,
  license: 'CC BY 4.0',
  attribution: 'STEP Bible · Tyndale House & Abbott-Smith Manual Greek Lexicon · CC BY 4.0',
  locator,
  raw_field: rawField,
  algorithm_version: algo,
});

// A. Same-lemma inflected word-form links (`same_lemma` & `morphological_relationship`)
for (const l of sliceLemmas) {
  const wIds = wordIdsByLemmaId.get(l.id) || [];
  if (wIds.length > 0) {
    const w0 = wordsById.get(wIds[0]);
    if (w0) {
      const subj = makeLexicalEndpoint(l);
      const wfEndpoint = {
        ...subj,
        entity_kind: 'word_form',
        canonical_key: `word_form:${w0.id}`,
        word_id: w0.id,
        lemma_text: w0.original_word,
        transliteration: w0.transliteration,
      };
      const prov = (l.language === 'grc' ? stepGProv : stepHProv)(
        `word_form_lemmas#lemma_id=${l.id}&word_id=${w0.id}`,
        'dStrongs+Grammar',
        'wfl_projection_v1'
      );
      const sameLemmaId = buildLexId(prov.source_key, 'same_lemma', 'word_form_of_lemma', 'deterministic_computational', subj.canonical_key, wfEndpoint.canonical_key);
      const arr = edgesByKey.get(subj.canonical_key) || [];
      arr.push({
        relationship_id: sameLemmaId,
        schema_version: 1,
        domain: 'lexical',
        category: 'same_lemma',
        raw_relation_code: 'word_form_of_lemma',
        epistemic_tier: 'deterministic_computational',
        direction: 'symmetric',
        subject: subj,
        target: wfEndpoint,
        reused_source_table: 'word_form_lemmas',
        explanation: `Inflected surface form "${w0.original_word}" (${w0.grammar_code || 'attested form'}) is mapped to disambiguated lemma ${l.canonical_key} (${wIds.length} distinct inflected form(s) in corpus).`,
        evidence_verses: [],
        statistics: null,
        provenance: prov,
        guardrails: lexicalGuardrails('same_lemma'),
      });
      if (wIds.length > 1) {
        const w1 = wordsById.get(wIds[1]);
        if (w1) {
          const wf2 = {
            ...subj,
            entity_kind: 'word_form',
            canonical_key: `word_form:${w1.id}`,
            word_id: w1.id,
            lemma_text: w1.original_word,
            transliteration: w1.transliteration,
          };
          const morphId = buildLexId(prov.source_key, 'morphological_relationship', 'shared_inflectional_paradigm', 'deterministic_computational', subj.canonical_key, wf2.canonical_key);
          arr.push({
            relationship_id: morphId,
            schema_version: 1,
            domain: 'lexical',
            category: 'morphological_relationship',
            raw_relation_code: 'shared_inflectional_paradigm',
            epistemic_tier: 'deterministic_computational',
            direction: 'directed',
            subject: subj,
            target: wf2,
            reused_source_table: 'word_form_lemmas',
            explanation: `Morphological inflection "${w1.original_word}" (${w1.grammar_code || 'paradigm form'}) shares stem/paradigm with ${l.lemma_text}.`,
            evidence_verses: [],
            statistics: null,
            provenance: prov,
            guardrails: lexicalGuardrails('morphological_relationship'),
          });
        }
      }
      edgesByKey.set(subj.canonical_key, arr);
    }
  }
}

// B. Reuse `lemma_root_links` (`same_documented_root`, `derivation`, `cognate`, `morphological_relationship`)
const lemmasByRootId = new Map();
for (const rl of rootLinksTable) {
  if (!lemmasByRootId.has(rl.root_id)) lemmasByRootId.set(rl.root_id, []);
  lemmasByRootId.get(rl.root_id).push(rl);
}
for (const rl of rootLinksTable) {
  const subj = lemmaById.get(rl.lemma_id);
  if (!subj || !TARGET_BASES.has(String(subj.base_strongs || '').toUpperCase())) continue;
  const root = rootById.get(rl.root_id);
  const peers = lemmasByRootId.get(rl.root_id) || [];
  for (const peerRl of peers) {
    if (peerRl.lemma_id === rl.lemma_id) continue;
    const tgt = lemmaById.get(peerRl.lemma_id);
    if (!tgt) continue;
    const prov = (subj.language === 'grc' ? stepGProv : stepHProv)(
      `lemma_root_links#id=${rl.id}->root=${root?.canonical_key}`,
      rl.raw_relation || rl.link_type
    );
    if (rl.link_type === 'aramaic_cognate_of' || rl.link_type === 'hebrew_cognate_of' || rl.link_type === 'greek_loan_or_transliteration' || subj.language !== tgt.language) {
      pushLexEdge(
        subj, tgt, 'cognate', rl.link_type, 'attested_lexical_fact', 'lemma_root_links',
        `Documented ${subj.language.toUpperCase()} ↔ ${tgt.language.toUpperCase()} cognate/loan relationship (${rl.link_type}) via ${root?.canonical_key || 'lexicon anchor'}.`,
        prov
      );
    } else if (rl.link_type === 'derived_from' && peerRl.link_type === 'base_root_anchor') {
      pushLexEdge(
        subj, tgt, 'derivation', rl.link_type, 'attested_lexical_fact', 'lemma_root_links',
        `Documented lexical derivation (${rl.raw_relation || 'derived_from'}) from historical root anchor ${tgt.lemma_text} (${root?.root_text || ''}).`,
        prov, null, [], 'directed'
      );
    } else if (rl.link_type === 'form_of' || rl.link_type === 'spelling_variant_of') {
      pushLexEdge(
        subj, tgt, 'morphological_relationship', rl.link_type, 'attested_lexical_fact', 'lemma_root_links',
        `Documented morphological/orthographic form relationship (${rl.link_type}) in STEP lexicon.`,
        prov, null, [], 'directed'
      );
    } else {
      pushLexEdge(
        subj, tgt, 'same_documented_root', rl.link_type, 'attested_lexical_fact', 'lemma_root_links',
        `Both lemmas are linked to documented historical root ${root?.root_text || root?.canonical_key || ''} (shared root never implies synonymy).`,
        prov
      );
    }
  }
}

// C. Reuse `lexical_formations` & `lemma_components` (`derivation`)
const compsByLemmaKey = new Map();
for (const c of componentsTable) {
  if (!compsByLemmaKey.has(c.lemma_key)) compsByLemmaKey.set(c.lemma_key, []);
  compsByLemmaKey.get(c.lemma_key).push(c);
}
for (const f of formationsTable) {
  const subj = lemmaByKey.get(f.lemma_key);
  if (!subj || !TARGET_BASES.has(String(subj.base_strongs || '').toUpperCase())) continue;
  const comps = compsByLemmaKey.get(f.lemma_key) || [];
  for (const c of comps) {
    if (!c.component_lemma_key) continue;
    const tgt = lemmaByKey.get(c.component_lemma_key);
    if (!tgt) continue;
    pushLexEdge(
      subj, tgt, 'derivation', f.formation_kind, 'attested_lexical_fact', 'lexical_formations',
      `Documented ${f.formation_kind} component (${c.component_role}): ${f.explanation || c.component_surface}.`,
      stepHProv(`lexical_formations#${f.lemma_key}`, 'formation_kind'),
      null, [], 'directed'
    );
  }
}

// D. Reuse `lexical_connections` (`literary_wordplay` vs `orthographic_overlap`)
for (const lc of lexConnsTable) {
  const left = lemmaByKey.get(lc.left_lemma_key);
  const right = lemmaByKey.get(lc.right_lemma_key);
  if (!left || !right) continue;
  if (!TARGET_BASES.has(String(left.base_strongs || '').toUpperCase()) && !TARGET_BASES.has(String(right.base_strongs || '').toUpperCase())) continue;
  const isWordplay = lc.connection_type === 'literary_wordplay';
  const cat = isWordplay ? 'literary_wordplay' : 'orthographic_overlap';
  const tier = isWordplay
    ? (lc.epistemic_status === 'reviewed_interpretation' ? 'human_reviewed_interpretation' : 'attested_lexical_fact')
    : 'deterministic_computational';
  const evCoords = isWordplay ? ['1:2:5', '1:2:7'] : [];
  const prov = stepHProv(
    `lexical_connections#id=${lc.id}`,
    lc.connection_type,
    isWordplay ? null : 'consonantal_containment_v1'
  );
  pushLexEdge(left, right, cat, lc.connection_type, tier, 'lexical_connections', lc.explanation, prov, null, evCoords);
  pushLexEdge(right, left, cat, lc.connection_type, tier, 'lexical_connections', lc.explanation, prov, null, evCoords);
}

// E. Reuse `entity_relationships` (`cognate` & `source_lexical_equivalence`)
for (const er of entityRelsTable) {
  const fromEnt = entityById.get(er.from_entity_id);
  const toEnt = entityById.get(er.to_entity_id);
  if (!fromEnt || !toEnt) continue;
  const subj = lemmaByKey.get(fromEnt.canonical_key);
  const tgt = lemmaByKey.get(toEnt.canonical_key);
  if (!subj || !tgt) continue;
  if (!TARGET_BASES.has(String(subj.base_strongs || '').toUpperCase()) && !TARGET_BASES.has(String(tgt.base_strongs || '').toUpperCase())) continue;

  if (er.relation_type_code === 'greek_transliteration_of' || er.relation_type_code === 'aramaic_cognate_of' || er.relation_type_code === 'hebrew_cognate_of') {
    const prov = stepGProv(`entity_relationships#id=${er.id}`, er.relation_type_code);
    pushLexEdge(subj, tgt, 'cognate', er.relation_type_code, 'attested_lexical_fact', 'entity_relationships',
      `Attested cross-language cognate/transliteration (${er.relation_type_code}) between ${subj.language} and ${tgt.language}.`, prov, null, [], 'directed');
    pushLexEdge(tgt, subj, 'cognate', er.relation_type_code, 'attested_lexical_fact', 'entity_relationships',
      `Attested cross-language cognate/transliteration (${er.relation_type_code}) between ${subj.language} and ${tgt.language}.`, prov, null, [], 'inverse');
  } else if (er.relation_type_code === 'source_provided_lexical_equivalent') {
    const prov = stepGProv(`entity_relationships#id=${er.id}`, er.relation_type_code);
    pushLexEdge(subj, tgt, 'source_lexical_equivalence', er.relation_type_code, 'attested_lexical_fact', 'entity_relationships',
      `Source-attested lexical equivalence recorded in primary lexicon (not inferred from English glosses).`, prov, null, [], 'directed');
  }
}

// F. Parse TBESG explicit Abbott-Smith `SYN.:`, `opposite to`, and `[in LXX chiefly for <Hebrew>]` + `uStrong` semantic_overlap
for (const l of sliceLemmas) {
  // Semantic overlap within unified Strong's sub-meanings (e.g. H0430G <-> H0430a, G2556G <-> G2556H)
  const siblings = lemmasByBaseStrongs.get(String(l.base_strongs || '').toUpperCase()) || [];
  for (const sib of siblings) {
    if (sib.id === l.id) continue;
    const lxsA = lexemesByLemmaId.get(l.id) || [];
    const lxsB = lexemesByLemmaId.get(sib.id) || [];
    const uA = lxsA[0]?.unified_strongs;
    const uB = lxsB[0]?.unified_strongs;
    if (uA && uB && uA === uB) {
      pushLexEdge(
        l, sib, 'semantic_overlap', 'unified_strongs_submeaning', 'attested_lexical_fact', 'stepbible_lexicon',
        `STEP Bible groups ${l.canonical_key} and ${sib.canonical_key} under unified Strong’s ${uA} with distinct contextual sub-meanings.`,
        (l.language === 'grc' ? stepGProv : stepHProv)(`uStrong#${uA}`, 'uStrong')
      );
    }
  }

  if (l.language === 'grc') {
    const lxs = lexemesByLemmaId.get(l.id) || [];
    const eKey = lxs[0]?.extended_strongs || l.base_strongs;
    const tbesg = tbesgByEStrong.get(eKey) || tbesgByEStrong.get(String(l.base_strongs || ''));
    if (tbesg?.abbottSmith) {
      const def = tbesg.abbottSmith;
      // 1. Explicit SYN.:
      const synMatch = def.match(/SYN\.?:<\/i>?\s*(?:see:\s*)?([^<.]+)\./i) || def.match(/SYN\.?:\s*([^<.]+)\./i);
      if (synMatch) {
        const greekTokens = synMatch[1].match(/[\u0370-\u03ff\u1f00-\u1fff]+/g) || [];
        for (const gt of greekTokens) {
          const tgt = greekLemmaIndex.get(normalizeGreekStrip(gt));
          if (tgt && tgt.id !== l.id) {
            const prov = stepGProv(`TBESG.txt#${tbesg.eStrong}:SYN`, 'Abbott-Smith SYN.:');
            pushLexEdge(l, tgt, 'synonymy', 'abbott_smith_syn', 'attested_lexical_fact', 'stepbible_lexicon',
              `Explicitly listed under Abbott-Smith SYN.: "${synMatch[0].replace(/<[^>]+>/g, '').trim()}".`, prov);
            pushLexEdge(tgt, l, 'synonymy', 'abbott_smith_syn', 'attested_lexical_fact', 'stepbible_lexicon',
              `Explicitly listed under Abbott-Smith SYN. of ${l.lemma_text}: "${synMatch[0].replace(/<[^>]+>/g, '').trim()}".`, prov);
          }
        }
      }
      // 2. Explicit `opposite to <Greek>` antonymy
      const oppMatch = def.match(/opposite\s+to\s+([^<):;]+)/i);
      if (oppMatch) {
        const greekTokens = oppMatch[1].match(/[\u0370-\u03ff\u1f00-\u1fff]+/g) || [];
        for (const gt of greekTokens) {
          if (['το', 'τη', 'η', 'ο'].includes(normalizeGreekStrip(gt))) continue;
          const tgt = greekLemmaIndex.get(normalizeGreekStrip(gt));
          if (tgt && tgt.id !== l.id) {
            const prov = stepGProv(`TBESG.txt#${tbesg.eStrong}:opposite_to`, 'Abbott-Smith opposite to');
            pushLexEdge(l, tgt, 'antonymy', 'abbott_smith_opposite', 'attested_lexical_fact', 'stepbible_lexicon',
              `Explicitly attested as lexical opposite in Abbott-Smith: "${oppMatch[0].trim()}".`, prov);
            pushLexEdge(tgt, l, 'antonymy', 'abbott_smith_opposite', 'attested_lexical_fact', 'stepbible_lexicon',
              `Explicitly attested as lexical opposite of ${l.lemma_text} in Abbott-Smith: "${oppMatch[0].trim()}".`, prov);
          }
        }
      }
      // 3. Explicit `[in LXX chiefly for <Hebrew>]` or `Heb. <Hebrew>` source lexical equivalence
      const lxxForMatch = def.match(/(?:in\s+LXX[^;\]]*for|Heb\.)\s+([\u0590-\u05ff]+)/i);
      if (lxxForMatch) {
        const hebCons = normalizeHebrewConsonants(lxxForMatch[1]);
        const hebTgt = hebrewConsonantIndex.get(hebCons);
        if (hebTgt) {
          const prov = stepGProv(`TBESG.txt#${tbesg.eStrong}:LXX_Heb`, 'Abbott-Smith LXX/Heb');
          pushLexEdge(l, hebTgt, 'source_lexical_equivalence', 'abbott_smith_lxx_hebrew', 'attested_lexical_fact', 'stepbible_lexicon',
            `Abbott-Smith explicitly attests Hebrew lexical counterpart: "${lxxForMatch[0].trim()}".`, prov, null, [], 'directed');
          pushLexEdge(hebTgt, l, 'source_lexical_equivalence', 'abbott_smith_lxx_hebrew', 'attested_lexical_fact', 'stepbible_lexicon',
            `Abbott-Smith (${l.lemma_text}) explicitly attests LXX/Greek counterpart for ${hebTgt.lemma_text}: "${lxxForMatch[0].trim()}".`, prov, null, [], 'inverse');
        }
      }
    }
  }
}

// G. Statistical `related_translation` & `co_occurrence` (strictly marked `statistical_association`)
const beraA = lemmaByKey.get('lemma:H1254A') || sliceLemmas.find(x => x.base_strongs === 'H1254');
const asahA = lemmaByKey.get('lemma:H6213A') || sliceLemmas.find(x => x.base_strongs === 'H6213');
if (beraA && asahA) {
  const wBera = (wordsByStrongs.get('H1254') || [])[0];
  const wAsah = (wordsByStrongs.get('H6213') || [])[0];
  const sharedGlosses = (wBera?.english_translations || ['create', 'make']).filter(g =>
    (wAsah?.english_translations || ['make', 'do', 'create']).some(x => x.toLowerCase() === g.toLowerCase())
  );
  const rendered = sharedGlosses.length ? sharedGlosses : ['make'];
  const prov = stepHProv('verse_translation_sources#H1254+H6213', 'english_translations', 'shared_rendering_overlap_v1');
  const stats = {
    shared_count: rendered.length,
    subject_total: wBera?.english_translations?.length || 1,
    object_total: wAsah?.english_translations?.length || 1,
    score: null,
    metric_formula: 'count(intersect(observed_english_renderings))',
    shared_renderings: rendered,
  };
  pushLexEdge(
    beraA, asahA, 'related_translation', 'shared_english_rendering', 'statistical_association', 'verse_translation_sources',
    `Observed English translation overlap (${rendered.map(r => `"${r}"`).join(', ')}); shared English translation is a rendering distribution and NEVER establishes synonymy or shared etymology.`,
    prov, stats, ['1:1:1', '1:1:26', '1:2:3']
  );
  pushLexEdge(
    asahA, beraA, 'related_translation', 'shared_english_rendering', 'statistical_association', 'verse_translation_sources',
    `Observed English translation overlap (${rendered.map(r => `"${r}"`).join(', ')}); shared English translation NEVER establishes synonymy or shared etymology.`,
    prov, stats, ['1:1:1', '1:1:26', '1:2:3']
  );
}

for (const l of sliceLemmas) {
  const ep = makeLexicalEndpoint(l);
  if (!ep.word_id) continue;
  const w = wordsById.get(ep.word_id);
  if (!w || !Array.isArray(w.co_occurrences)) continue;
  for (const co of w.co_occurrences.slice(0, 3)) {
    const coWord = wordsById.get(co.word_id);
    if (!coWord) continue;
    const padded = String(coWord.strongs_nr || '').replace(/^([HG])(\d+)/i, (_, p, d) => p.toUpperCase() + d.padStart(4, '0'));
    const coLemmas = lemmasByBaseStrongs.get(padded) || [];
    const tgtLemma = coLemmas[0];
    if (!tgtLemma || tgtLemma.id === l.id) continue;
    const prov = (l.language === 'grc' ? stepGProv : stepHProv)(
      `words.co_occurrences#word_id=${w.id}->${coWord.id}`,
      'co_occurrences',
      'proximity_score_v1:freq/(1+avg_dist)'
    );
    pushLexEdge(
      l, tgtLemma, 'co_occurrence', 'within_verse_cooccurrence', 'statistical_association', 'words.co_occurrences',
      `Statistical within-verse co-occurrence (${co.freq} shared verses, avg token distance ${co.avg_dist}, score ${co.score}); contextual proximity does not imply shared meaning.`,
      prov,
      {
        shared_count: co.freq,
        subject_total: co.freq,
        object_total: null,
        score: co.score,
        metric_formula: 'freq / (1 + avg_dist)',
      }
    );
  }
}

// Assemble lexical buckets (`00`..`3f`) + `lexical-index.json.gz`
const bucketShards = new Map();
const bucketByKey = {};
const keyByLookup = {};
const keyBySurface = {};
const keyByWordId = {};

const allSliceKeys = new Set([...sliceLemmas.map(l => l.canonical_key), ...edgesByKey.keys()]);
for (const key of allSliceKeys) {
  const l = lemmaByKey.get(key);
  if (!l) continue;
  const focus = makeLexicalEndpoint(l);
  const siblings = (lemmasByBaseStrongs.get(String(l.base_strongs || '').toUpperCase()) || [])
    .filter(s => s.id !== l.id)
    .map(makeLexicalEndpoint);
  const bucketNum = Number(BigInt(`0x${fnv1a64Hex(key).slice(0, 8)}`) % 64n);
  const bucket = bucketNum.toString(16).padStart(2, '0');
  bucketByKey[key] = bucket;

  if (focus.base_strongs) {
    const bs = focus.base_strongs.toUpperCase();
    const compact = bs.replace(/^([HG])0+(\d+)/, '$1$2');
    // Prefer primary 'G' or 'A' homograph or exact match for base lookup
    if (!keyByLookup[bs] || focus.homograph_tag === 'G' || focus.homograph_tag === 'A') {
      keyByLookup[bs] = key;
      keyByLookup[compact] = key;
    }
  }
  if (focus.extended_strongs) keyByLookup[focus.extended_strongs.toUpperCase()] = key;
  if (focus.disambiguated_strongs) keyByLookup[focus.disambiguated_strongs.toUpperCase()] = key;
  if (focus.lemma_text && !keyBySurface[focus.lemma_text]) keyBySurface[focus.lemma_text] = key;
  for (const wid of wordIdsByLemmaId.get(l.id) || []) {
    if (!keyByWordId[String(wid)]) keyByWordId[String(wid)] = key;
  }
  if (focus.word_id && !keyByWordId[String(focus.word_id)]) {
    keyByWordId[String(focus.word_id)] = key;
  }

  if (!bucketShards.has(bucket)) bucketShards.set(bucket, { schema_version: 1, bucket, entries: {} });
  bucketShards.get(bucket).entries[key] = {
    focus,
    homograph_siblings: siblings,
    edges: edgesByKey.get(key) || [],
  };
}

for (const [bucket, data] of bucketShards.entries()) {
  writeGzipJson(path.join(OUT_DIR, `lexical-${bucket}.json.gz`), data);
}

writeGzipJson(path.join(OUT_DIR, 'lexical-index.json.gz'), {
  schema_version: 1,
  coverage: 'slice',
  bucket_count: 64,
  bucket_by_key: bucketByKey,
  key_by_lookup: keyByLookup,
  key_by_surface: keyBySurface,
  key_by_word_id: keyByWordId,
});

writeGzipJson(path.join(OUT_DIR, 'manifest.json.gz'), {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  coverage_mode: 'vertical_slice',
  sources: {
    cross_references: DEFAULT_XREF_ATTRIBUTION,
    stepbible_hebrew: stepHProv('TBESH.txt'),
    stepbible_greek: stepGProv('TBESG.txt'),
  },
  xref_attribution: DEFAULT_XREF_ATTRIBUTION,
  edition_only_verses: editionOnlyVerses,
  counts: {
    xref_book_shards: totalXrefShards,
    xref_edges: globalRank,
    lexical_entries: Object.keys(bucketByKey).length,
    lexical_buckets_populated: bucketShards.size,
    edition_only_verses: Object.keys(editionOnlyVerses).length,
  },
});

console.log('Built static relationship vertical slice:', {
  outDir: OUT_DIR,
  xrefBookShards: totalXrefShards,
  xrefEdges: globalRank,
  lexicalEntries: Object.keys(bucketByKey).length,
  lexicalBuckets: bucketShards.size,
  editionOnlyVerses: Object.keys(editionOnlyVerses).length,
});
