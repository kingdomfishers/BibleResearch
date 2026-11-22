// Pure Web/Deno TypeScript module: declarative, zero-eval composable
// query and calculation engine for bible-mcp `research`.
// Zero Node-only imports; all relative imports include .ts extensions.

import * as z from 'zod';
import type { DatabaseQuery, DatabaseReader } from './catalog.ts';
import {
  expandPassageRefs,
  formatRef,
  isPassageLike,
  parsePassageString,
  type ParsedPassage,
} from './bible-ref.ts';
import { computeGematria, type GematriaResult } from './gematria.ts';
import { NOTE_SECURITY_NOTICE, formatCompactNote } from './notes-tools.ts';
import {
  cleanTransliteration,
  isFunctionWord,
  normalizeDiscoveryConnection,
  verifyWordRowAlignment,
  type CompactConnection,
} from './word-model.ts';

export const ResearchOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('evidence'),
    id: z.string().trim().min(1).max(64).optional(),
    evidence_id: z.string().trim().min(1).max(220),
    release_id: z.string().trim().min(1).max(64).optional(),
  }),
  z.strictObject({
    op: z.literal('occurrences'),
    id: z.string().trim().min(1).max(64).optional(),
    word: z.string().trim().min(1).max(128),
    testament: z.enum(['OT', 'NT']).optional(),
    book: z.number().int().min(1).max(66).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).max(10000).optional(),
  }),
  z.strictObject({
    op: z.literal('intersect_words'),
    id: z.string().trim().min(1).max(64).optional(),
    words: z.array(z.string().trim().min(1).max(128)).min(2).max(5),
    window: z.number().int().min(0).max(3).optional().default(0),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.strictObject({
    op: z.literal('grammar_search'),
    id: z.string().trim().min(1).max(64).optional(),
    word: z.string().trim().min(1).max(128).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    predicates: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
    direction: z.enum(['both', 'outgoing', 'incoming']).optional(),
    include_syntax_tree: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.strictObject({
    op: z.literal('lxx'),
    id: z.string().trim().min(1).max(64).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    word: z.string().trim().min(1).max(128).optional(),
    mode: z.enum(['compare', 'passage', 'translations', 'alignments']).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.strictObject({
    op: z.literal('gematria'),
    id: z.string().trim().min(1).max(64).optional(),
    terms: z.array(z.string().trim().min(1).max(128)).min(1).max(10),
    find_matches: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.strictObject({
    op: z.literal('numbers'),
    id: z.string().trim().min(1).max(64).optional(),
    number: z.number().finite().optional(),
    query: z.string().trim().min(1).max(160).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  z.strictObject({
    op: z.literal('chronology_occurrences'),
    id: z.string().trim().min(1).max(64).optional(),
    word: z.string().trim().min(1).max(128).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    limit: z.number().int().min(1).max(80).optional(),
  }),
  z.strictObject({
    op: z.literal('geography_search'),
    id: z.string().trim().min(1).max(64).optional(),
    place: z.string().trim().min(1).max(128),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.strictObject({
    op: z.literal('passage_compare'),
    id: z.string().trim().min(1).max(64).optional(),
    passages: z.array(z.string().trim().min(1).max(160)).min(2).max(4),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.strictObject({
    op: z.literal('notes_search'),
    id: z.string().trim().min(1).max(64).optional(),
    passage: z.string().trim().min(1).max(160).optional(),
    word: z.string().trim().min(1).max(128).optional(),
    include_dlm: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.strictObject({
    op: z.literal('set_combine'),
    id: z.string().trim().min(1).max(64).optional(),
    combine: z.enum(['intersect', 'union', 'difference']),
    refs: z.array(z.string().trim().min(1).max(64)).min(2).max(6),
    limit: z.number().int().min(1).max(50).optional(),
  }),
]);

export type ResearchOp =
  | { op: 'evidence'; id?: string; evidence_id: string; release_id?: string }
  | { op: 'occurrences'; id?: string; word: string; testament?: 'OT' | 'NT'; book?: number; limit?: number; offset?: number }
  | { op: 'intersect_words'; id?: string; words: string[]; window?: number; limit?: number }
  | { op: 'grammar_search'; id?: string; word?: string; passage?: string; predicates?: string[]; direction?: 'both' | 'outgoing' | 'incoming'; include_syntax_tree?: boolean; limit?: number }
  | { op: 'lxx'; id?: string; passage?: string; word?: string; mode?: 'compare' | 'passage' | 'translations' | 'alignments'; limit?: number }
  | { op: 'gematria'; id?: string; terms: string[]; find_matches?: boolean; limit?: number }
  | { op: 'numbers'; id?: string; number?: number; query?: string; limit?: number }
  | { op: 'chronology_occurrences'; id?: string; word?: string; passage?: string; limit?: number }
  | { op: 'geography_search'; id?: string; place: string; limit?: number }
  | { op: 'passage_compare'; id?: string; passages: string[]; limit?: number }
  | { op: 'notes_search'; id?: string; passage?: string; word?: string; include_dlm?: boolean; limit?: number }
  | { op: 'set_combine'; id?: string; combine: 'intersect' | 'union' | 'difference'; refs: string[]; limit?: number };

const OperationsBatchSchema = z.array(ResearchOpSchema).min(1).max(8);

interface OpContext {
  read: DatabaseReader;
  defaultLimit: number;
  verseIdStore: Map<string, number[]>;
}

interface ResolvedWord {
  query: string;
  strongs: string;
  lemmaKey: string;
  wordId: number | null;
  lemma: string;
  gloss: string;
  raw: Record<string, unknown> | null;
}

interface WordProfileVids {
  strongs: string;
  totalVerses: number;
  allVids: number[];
  vidBookMap: Map<number, number>;
  bookDistribution: Record<string, number>;
}

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
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function clampLimit(val: number | undefined, fallback: number, max = 50): number {
  const n = typeof val === 'number' && Number.isFinite(val) ? Math.trunc(val) : fallback;
  return Math.max(1, Math.min(n, max));
}

function trimText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  const collapsed = val.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  return collapsed.length <= maxLen
    ? collapsed
    : `${collapsed.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
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

function extractFirstObject(rows: Record<string, unknown>[]): Record<string, unknown> | null {
  return rows.length > 0 ? asRecord(rows[0]) : null;
}

function extractRowsOrField(rows: Record<string, unknown>[], ...fields: string[]): Record<string, unknown>[] {
  if (rows.length === 0) return [];
  const first = asRecord(rows[0]);
  if (first) {
    for (const field of fields) {
      if (Array.isArray(first[field])) {
        return (first[field] as unknown[])
          .map((item) => asRecord(item))
          .filter((item): item is Record<string, unknown> => item !== null);
      }
    }
  }
  return rows;
}

function inferBookFromVid(vid: number, vidBookMap?: Map<number, number>): number | null {
  if (vidBookMap && vidBookMap.has(vid)) {
    return vidBookMap.get(vid) ?? null;
  }
  if (vid >= 1_000_000) {
    const book = Math.floor(vid / 1_000_000);
    if (book >= 1 && book <= 66) return book;
  }
  return null;
}

function matchesBookOrTestament(
  book: number | null,
  filterBook?: number,
  testament?: 'OT' | 'NT',
): boolean {
  if (book === null) return false;
  if (filterBook !== undefined && book !== filterBook) return false;
  if (testament === 'OT' && (book < 1 || book > 39)) return false;
  if (testament === 'NT' && (book < 40 || book > 66)) return false;
  return true;
}

async function resolveWordFast(read: DatabaseReader, word: string): Promise<ResolvedWord | null> {
  const rows = await callRpc(read, 'resolve_fast_lookup_v1', { query: word }, 5, 0);
  const first = extractFirstObject(rows);
  const candidates = extractRowsOrField(rows, 'matches', 'candidates', 'results', 'items');
  const match = candidates[0] ?? first;
  if (!match) return null;

  const strongs = firstNonEmpty(match.bs, match.strongs, match.extended_strongs, match.strongs_id).toUpperCase();
  const lemmaKey = firstNonEmpty(match.lk, match.lemma_key, match.lemma_id);
  const rawWordId = match.word_id ?? match.id;
  const wordId = typeof rawWordId === 'number' && Number.isInteger(rawWordId) && rawWordId > 0
    ? rawWordId
    : null;

  if (!strongs && !lemmaKey && wordId === null) return null;
  return {
    query: word,
    strongs,
    lemmaKey,
    wordId,
    lemma: firstNonEmpty(match.sc, match.lemma, match.script, match.word),
    gloss: firstNonEmpty(match.gl, match.gloss, match.short_gloss),
    raw: match,
  };
}

function parseVidsPayload(profile: Record<string, unknown> | null, strongs: string): WordProfileVids {
  const allVids: number[] = [];
  const vidBookMap = new Map<number, number>();
  const bookDistribution: Record<string, number> = {};

  if (!profile) {
    return { strongs, totalVerses: 0, allVids, vidBookMap, bookDistribution };
  }

  const rawByBook = asRecord(profile.vids_by_book ?? profile.book_vids);
  if (rawByBook) {
    for (const [bookKey, listVal] of Object.entries(rawByBook)) {
      const bookNum = Number(bookKey);
      const vids = asArray(listVal);
      if (Number.isInteger(bookNum) && bookNum >= 1 && bookNum <= 66) {
        bookDistribution[String(bookNum)] = vids.length;
      }
      for (const item of vids) {
        if (typeof item === 'number' && Number.isInteger(item) && item > 0) {
          allVids.push(item);
          if (Number.isInteger(bookNum)) vidBookMap.set(item, bookNum);
        }
      }
    }
  }

  if (allVids.length === 0) {
    for (const item of asArray(profile.all_vids ?? profile.verse_ids)) {
      if (typeof item === 'number' && Number.isInteger(item) && item > 0) {
        allVids.push(item);
        const book = inferBookFromVid(item);
        if (book !== null) vidBookMap.set(item, book);
      } else {
        const obj = asRecord(item);
        const vid = obj?.verse_id ?? obj?.vid ?? obj?.id;
        const book = obj?.book;
        if (typeof vid === 'number' && Number.isInteger(vid) && vid > 0) {
          allVids.push(vid);
          if (typeof book === 'number' && book >= 1 && book <= 66) {
            vidBookMap.set(vid, book);
          } else {
            const inferred = inferBookFromVid(vid);
            if (inferred !== null) vidBookMap.set(vid, inferred);
          }
        }
      }
    }
  }

  const rawDist = asRecord(profile.book_distribution ?? profile.book_counts);
  if (rawDist) {
    for (const [k, v] of Object.entries(rawDist)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        bookDistribution[k] = v;
      }
    }
  } else if (Object.keys(bookDistribution).length === 0) {
    for (const vid of allVids) {
      const book = inferBookFromVid(vid, vidBookMap);
      if (book !== null) {
        const key = String(book);
        bookDistribution[key] = (bookDistribution[key] ?? 0) + 1;
      }
    }
  }

  const rawTotal = profile.total_verses ?? profile.verse_count;
  const totalVerses = typeof rawTotal === 'number' && Number.isFinite(rawTotal)
    ? rawTotal
    : allVids.length;

  return {
    strongs: firstNonEmpty(profile.strongs, strongs).toUpperCase(),
    totalVerses,
    allVids: Array.from(new Set(allVids)).sort((a, b) => a - b),
    vidBookMap,
    bookDistribution,
  };
}

async function fetchWordProfileWithVids(
  read: DatabaseReader,
  resolved: ResolvedWord,
): Promise<WordProfileVids> {
  const rows = await callRpc(
    read,
    'get_word_profiles_batch_v1',
    {
      strongs: [resolved.strongs || resolved.lemmaKey].filter(Boolean),
      include_vids: true,
      include_forms: false,
      include_orth: false,
      include_pilot: false,
    },
    1,
    0,
  );
  const first = extractFirstObject(rows);
  const keyed = first && asRecord(first.profiles)
    ? (asRecord(first.profiles)?.[resolved.strongs] as Record<string, unknown> | undefined)
      ?? (Object.values(asRecord(first.profiles) ?? {})[0] as Record<string, unknown> | undefined)
      ?? null
    : null;
  const profiles = extractRowsOrField(rows, 'profiles', 'items', 'words');
  const profile = asRecord(keyed) ?? profiles[0] ?? first;
  return parseVidsPayload(profile, resolved.strongs);
}

async function hydrateCompactVersesByIds(
  read: DatabaseReader,
  verseIds: number[],
): Promise<Record<string, unknown>[]> {
  const verses: Record<string, unknown>[] = [];
  for (let offset = 0; offset < verseIds.length; offset += 50) {
    const ids = verseIds.slice(offset, offset + 50);
    const rows = await callRpc(read, 'get_passage_compact_v1',
      { verse_ids: ids, include_profiles: false, max_verses: ids.length }, ids.length, 0);
    verses.push(...extractRowsOrField(rows, 'verses', 'items', 'passages'));
  }
  return verses;
}

async function hydrateCompactVersesByPassage(
  read: DatabaseReader,
  parsed: ParsedPassage,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  const verses: Record<string, unknown>[] = [];
  while (verses.length < limit) {
    const pageLimit = Math.min(50, limit - verses.length);
    const rows = await callRpc(read, 'get_passage_compact_v1',
      { passages: parsed.passages, include_profiles: false, max_verses: pageLimit, offset: verses.length }, pageLimit, 0);
    const page = extractRowsOrField(rows, 'verses', 'items', 'passages');
    verses.push(...page);
    if (page.length < pageLimit || rows[0]?.pagination && asRecord(rows[0].pagination)?.has_more === false) break;
  }
  return verses;
}

async function executeEvidence(
  read: DatabaseReader,
  op: Extract<ResearchOp, { op: 'evidence' }>,
): Promise<Record<string, unknown>> {
  const rows = await callRpc(
    read,
    'get_connection_evidence_v1',
    {
      evidence_id: op.evidence_id,
      ...(op.release_id ? { release_id: op.release_id } : {}),
    },
    1,
    0,
  );
  const raw = extractFirstObject(rows);
  if (!raw) {
    return { status: 'not_found', evidence_id: op.evidence_id };
  }
  const tokens = asArray(raw.tokens).slice(0, 40);
  const passages = asArray(raw.passages ?? raw.verses).slice(0, 12);
  return {
    status: firstNonEmpty(raw.status, 'ok'),
    evidence_id: firstNonEmpty(raw.evidence_id, op.evidence_id),
    ...(raw.release_id ? { release_id: raw.release_id } : {}),
    ...(raw.relation ? { relation: raw.relation } : {}),
    ...(raw.epistemic ? { epistemic: raw.epistemic } : {}),
    ...(raw.title ? { title: trimText(raw.title, 180) } : {}),
    ...(raw.summary || raw.why ? { summary: trimText(firstNonEmpty(raw.why, raw.summary), 400) } : {}),
    ...(tokens.length > 0 ? { tokens } : {}),
    ...(passages.length > 0 ? { passages } : {}),
    ...(raw.orthographic_decomposition ? { orthographic_decomposition: raw.orthographic_decomposition } : {}),
    ...(raw.number_classification ? { number_classification: raw.number_classification } : {}),
    ...(raw.provenance ? { provenance: raw.provenance } : {}),
  };
}

async function executeOccurrences(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'occurrences' }>,
): Promise<{ result: Record<string, unknown>; storedIds: number[] }> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const offset = op.offset ?? 0;
  const resolved = await resolveWordFast(ctx.read, op.word);
  if (!resolved) {
    return {
      result: {
        status: 'not_found',
        word: op.word,
        total_verses: 0,
        filtered_count: 0,
        verse_ids: [],
        verses: [],
        book_distribution: {},
      },
      storedIds: [],
    };
  }

  const profile = await fetchWordProfileWithVids(ctx.read, resolved);
  const hasFilter = op.book !== undefined || op.testament !== undefined;

  let filteredVids = profile.allVids;
  let preHydrated: Record<string, unknown>[] | null = null;

  if (hasFilter) {
    const knownBookVids = profile.allVids.filter((vid) => {
      const book = inferBookFromVid(vid, profile.vidBookMap);
      return book !== null;
    });

    if (knownBookVids.length === profile.allVids.length && profile.allVids.length > 0) {
      filteredVids = profile.allVids.filter((vid) =>
        matchesBookOrTestament(inferBookFromVid(vid, profile.vidBookMap), op.book, op.testament),
      );
    } else if (profile.allVids.length > 0) {
      const probeSlice = profile.allVids.slice(0, 200);
      const hydratedAll = await hydrateCompactVersesByIds(ctx.read, probeSlice);
      const matched = hydratedAll.filter((v) => {
        const b = typeof v.book === 'number' ? v.book : null;
        return matchesBookOrTestament(b, op.book, op.testament);
      });
      filteredVids = matched
        .map((v) => v.verse_id)
        .filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
      preHydrated = matched.slice(offset, offset + limit);
    }
  }

  const pagedIds = filteredVids.slice(offset, offset + limit);
  const verses = preHydrated ?? (await hydrateCompactVersesByIds(ctx.read, pagedIds));

  return {
    result: {
      status: 'ok',
      word: op.word,
      strongs: profile.strongs || resolved.strongs,
      lemma: resolved.lemma,
      total_verses: profile.totalVerses,
      filtered_count: filteredVids.length,
      verse_ids: pagedIds,
      verses,
      book_distribution: profile.bookDistribution,
    },
    storedIds: filteredVids,
  };
}

async function executeIntersectWords(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'intersect_words' }>,
): Promise<{ result: Record<string, unknown>; storedIds: number[] }> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const windowSize = op.window ?? 0;

  const resolvedList = await Promise.all(op.words.map((w) => resolveWordFast(ctx.read, w)));
  const missing = op.words.filter((_, idx) => !resolvedList[idx]);
  if (missing.length > 0) {
    return {
      result: {
        status: 'not_found',
        missing_words: missing,
        verse_ids: [],
        verses: [],
      },
      storedIds: [],
    };
  }

  const profiles = await Promise.all(
    resolvedList.map((r) => fetchWordProfileWithVids(ctx.read, r!)),
  );
  const sortedProfiles = [...profiles].sort((a, b) => a.allVids.length - b.allVids.length);
  const anchor = sortedProfiles[0];
  const others = sortedProfiles.slice(1);

  const matchedIds: number[] = [];
  if (windowSize === 0) {
    const otherSets = others.map((p) => new Set(p.allVids));
    for (const vid of anchor.allVids) {
      if (otherSets.every((set) => set.has(vid))) {
        matchedIds.push(vid);
      }
    }
  } else {
    for (const vid of anchor.allVids) {
      const anchorBook = inferBookFromVid(vid, anchor.vidBookMap);
      const matchesAll = others.every((other) =>
        other.allVids.some((otherVid) => {
          if (Math.abs(otherVid - vid) > windowSize) return false;
          const otherBook = inferBookFromVid(otherVid, other.vidBookMap);
          if (anchorBook !== null && otherBook !== null && anchorBook !== otherBook) {
            return false;
          }
          return true;
        }),
      );
      if (matchesAll) matchedIds.push(vid);
    }
  }

  const topIds = matchedIds.slice(0, limit);
  const verses = await hydrateCompactVersesByIds(ctx.read, topIds);

  return {
    result: {
      status: 'ok',
      words: op.words,
      window: windowSize,
      total_matches: matchedIds.length,
      verse_ids: topIds,
      verses,
    },
    storedIds: matchedIds,
  };
}

async function executeGrammarSearch(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'grammar_search' }>,
): Promise<Record<string, unknown>> {
  if (!op.word && !op.passage) {
    return { status: 'invalid_request', error: 'Provide word or passage for grammar_search.' };
  }
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);

  if (op.passage) {
    const parsed = parsePassageString(op.passage);
    if (!parsed) {
      return { status: 'invalid_request', error: `Could not parse passage: ${op.passage}` };
    }
    const refs = expandPassageRefs(parsed.passages).slice(0, Math.min(limit, 10));
    const frames = await Promise.all(
      refs.map(async (ref) => {
        const frameRows = await callRpc(
          ctx.read,
          'query_relationships_v2',
          {
            op: 'passage_frames',
            book: ref.book,
            chapter: ref.chapter,
            verse: ref.verse,
            include_candidates: true,
          },
          1,
          0,
        );
        let syntaxTree: Record<string, unknown> | null = null;
        if (op.include_syntax_tree) {
          const treeRows = await callRpc(
            ctx.read,
            'lookup_syntax_tree_v1',
            { p_book: ref.book, p_chapter: ref.chapter, p_verse: ref.verse },
            1,
            0,
          );
          syntaxTree = extractFirstObject(treeRows);
        }
        return {
          ref: formatRef(ref.book, ref.chapter, ref.verse),
          frames: extractFirstObject(frameRows),
          ...(syntaxTree ? { syntax_tree: syntaxTree } : {}),
        };
      }),
    );
    return { status: 'ok', passage: parsed.normalized, results: frames };
  }

  const rows = await callRpc(
    ctx.read,
    'query_relationships_v2',
    {
      op: 'lemma_relationships',
      query: op.word,
      ...(op.predicates ? { predicates: op.predicates } : {}),
      ...(op.direction ? { direction: op.direction } : {}),
      limit,
      offset: 0,
    },
    1,
    0,
  );
  return {
    status: 'ok',
    word: op.word,
    relationships: extractFirstObject(rows),
  };
}

async function executeLxx(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'lxx' }>,
): Promise<Record<string, unknown>> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const mode = op.mode ?? (op.passage ? 'compare' : 'translations');

  if (op.passage) {
    const parsed = parsePassageString(op.passage);
    if (!parsed) {
      return { status: 'invalid_request', error: `Could not parse passage: ${op.passage}` };
    }
    const span = parsed.passages[0];
    if (mode === 'passage') {
      const rows = await callRpc(
        ctx.read,
        'lookup_septuagint_passage_v1',
        { p_book_no: span.book, p_chapter: span.chapter, p_verse_nr: span.start_verse },
        1,
        0,
      );
      return { status: 'ok', mode, passage: parsed.normalized, data: extractFirstObject(rows) };
    }
    if (mode === 'alignments') {
      const rows = await callRpc(
        ctx.read,
        'lookup_hebrew_septuagint_alignments_v1',
        { p_query: op.word ?? parsed.normalized, p_limit: limit },
        1,
        0,
      );
      return { status: 'ok', mode, passage: parsed.normalized, data: extractFirstObject(rows) };
    }
    const rows = await callRpc(
      ctx.read,
      'compare_hebrew_septuagint_passage_v1',
      { p_hebrew_book: span.book, p_hebrew_chapter: span.chapter, p_hebrew_verse: span.start_verse },
      1,
      0,
    );
    return { status: 'ok', mode: 'compare', passage: parsed.normalized, data: extractFirstObject(rows) };
  }

  if (!op.word) {
    return { status: 'invalid_request', error: 'Provide passage or word for lxx operation.' };
  }

  if (mode === 'alignments') {
    const rows = await callRpc(
      ctx.read,
      'lookup_hebrew_septuagint_alignments_v1',
      { p_query: op.word, p_limit: limit },
      1,
      0,
    );
    return { status: 'ok', mode, word: op.word, data: extractFirstObject(rows) };
  }

  const rows = await callRpc(
    ctx.read,
    'query_relationships_v2',
    { op: 'lxx_translations', query: op.word, limit, offset: 0 },
    1,
    0,
  );
  return { status: 'ok', mode: 'translations', word: op.word, data: extractFirstObject(rows) };
}

async function executeGematria(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'gematria' }>,
): Promise<Record<string, unknown>> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const calculations: GematriaResult[] = op.terms.map((term) => computeGematria(term));

  let matches: Record<string, unknown>[] | undefined;
  if (op.find_matches && calculations[0] && calculations[0].value > 0) {
    const rows = await callRpc(
      ctx.read,
      'query_words_by_gematria',
      { gematria: calculations[0].value },
      limit,
      0,
    );
    matches = extractRowsOrField(rows, 'words', 'matches', 'items').slice(0, limit);
  }

  return {
    status: 'ok',
    calculations,
    ...(matches !== undefined
      ? {
          target_value: calculations[0].value,
          matches,
          epistemic: 'arithmetic_coincidence_only_not_proof',
          epistemic_note:
            'Shared gematria/isopsephy sums are arithmetic coincidences only and do not prove textual dependence or etymology.',
        }
      : {}),
  };
}

async function executeNumbers(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'numbers' }>,
): Promise<Record<string, unknown>> {
  if (op.number === undefined && !op.query) {
    return { status: 'invalid_request', error: 'Provide number or query for numbers operation.' };
  }
  const limit = clampLimit(op.limit, 15, 25);
  const searchQuery = String(op.number ?? op.query);
  const rows = await callRpc(
    ctx.read,
    'discover_biblical_connections_v2',
    { query: searchQuery, limit },
    1,
    0,
  );
  const payload = extractFirstObject(rows) ?? {};
  const rawConnections = asArray(payload.strongest_connections ?? payload.connections)
    .map((c) => asRecord(c))
    .filter((c): c is Record<string, unknown> => c !== null);

  const normalized = rawConnections
    .map((c) => normalizeDiscoveryConnection(c))
    .filter((c): c is CompactConnection => c !== null);

  const numberItems = normalized.filter(
    (c) =>
      /number|count|numeric|ordinal|symbol/i.test(c.relation) ||
      /number|count|numeric|seven|twelve|forty|three/i.test(c.title) ||
      /number|count|numeric/i.test(c.why),
  );

  return {
    status: 'ok',
    query: searchQuery,
    items: numberItems.length > 0 ? numberItems : normalized,
    ...(payload.number_classifications ? { number_classifications: payload.number_classifications } : {}),
    epistemic: 'descriptive_pattern_only',
    coincidence_warning:
      'Numeric occurrences and symbolic number groupings are descriptive only; numerical coincidences do not establish causation or hidden codes.',
  };
}

async function executeChronologyOccurrences(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'chronology_occurrences' }>,
): Promise<{ result: Record<string, unknown>; storedIds: number[] }> {
  if (!op.word && !op.passage) {
    return {
      result: { status: 'invalid_request', error: 'Provide word or passage for chronology_occurrences.' },
      storedIds: [],
    };
  }
  const limit = clampLimit(op.limit, 80, 80);
  let allIds: number[] = [];
  let totalMatchingVerses = 0;
  if (op.word) {
    const resolved = await resolveWordFast(ctx.read, op.word);
    if (resolved) {
      const profile = await fetchWordProfileWithVids(ctx.read, resolved);
      allIds = profile.allVids;
      totalMatchingVerses = profile.totalVerses;
    }
  } else if (op.passage) {
    const parsed = parsePassageString(op.passage);
    if (!parsed) return { result: { status: 'invalid_request', error: 'Could not parse passage: ' + op.passage }, storedIds: [] };
    const hydrated = await hydrateCompactVersesByPassage(ctx.read, parsed, parsed.verse_count);
    allIds = hydrated.map((v) => Number(v.verse_id)).filter((id) => Number.isInteger(id) && id > 0);
    totalMatchingVerses = parsed.verse_count;
  }
  // Bound work independently of the witness display limit. A few early
  // occurrences cannot describe the historical distribution of a whole lemma.
  const verseIds = [...new Set(allIds)].slice(0, 1000);
  if (!verseIds.length) return { result: { status: 'not_found', verse_ids: [], models: [] }, storedIds: [] };
  const assertions: Record<string, unknown>[] = [];
  const modelNames = new Map<string, string>();
  let assertionCapReached = false;
  for (let offset = 0; offset < verseIds.length; offset += 80) {
    const ids = verseIds.slice(offset, offset + 80);
    const rows = await callRpc(ctx.read, 'query_chronology_assertions_batch', { verse_ids: ids }, ids.length, 0);
    const batch = extractRowsOrField(rows, 'assertions', 'items', 'results');
    assertionCapReached ||= batch.length >= 400;
    assertions.push(...batch);
    for (const raw of asArray(rows[0]?.models)) {
      const model = asRecord(raw);
      if (model) modelNames.set(String(model.id), firstNonEmpty(model.name));
    }
  }
  const groups = new Map<string, { model_id: string; model: string; axis: string; earliest_year: number | null; latest_year: number | null; verse_ids: Set<number> }>();
  const datedIds = new Set<number>();
  const requestedIds = new Set(verseIds);
  for (const row of assertions) {
    const vid = Number(row.verse_id);
    if (!requestedIds.has(vid)) continue;
    const modelId = String(row.model_id ?? row.model ?? 'unknown_model');
    const axis = firstNonEmpty(row.axis, row.chronology_axis, 'unspecified');
    const earliest = typeof row.earliest_year === 'number' ? row.earliest_year : null;
    const latest = typeof row.latest_year === 'number' ? row.latest_year : null;
    // Keep uncertain intervals intact; assigning their midpoint invents precision.
    const exact = earliest !== null && earliest === latest;
    const start = exact ? Math.floor(earliest / 100) * 100 : earliest;
    const end = exact ? start! + 99 : latest;
    const key = [modelId, axis, start, end].join('|');
    if (!groups.has(key)) groups.set(key, { model_id: modelId, model: modelNames.get(modelId) || modelId, axis, earliest_year: start, latest_year: end, verse_ids: new Set() });
    groups.get(key)!.verse_ids.add(vid);
    if (earliest !== null || latest !== null) datedIds.add(vid);
  }
  const distribution = [...groups.values()].sort((a, b) => a.model_id.localeCompare(b.model_id) || a.axis.localeCompare(b.axis) || (a.earliest_year ?? Infinity) - (b.earliest_year ?? Infinity));
  return {
    result: {
      status: 'ok',
      count_unit: 'distinct matching verses per model/axis/date bin, not token occurrences',
      assumptions: 'Chronology models are interpretive. Axes stay separate; exact dates use 100-year bins, uncertain intervals stay intact. Astronomical years: 0 = 1 BC. Verses may occur in multiple bins/models.',
      coverage: { total_matching_verses: totalMatchingVerses, indexed_verse_ids: allIds.length, examined_verses: verseIds.length, remaining_verses: Math.max(0, totalMatchingVerses - verseIds.length), selection: 'first indexed verses in canonical order, capped at 1000; not a random sample', dated_verses: datedIds.size, undated_verses: verseIds.length - datedIds.size, complete_matching_verse_coverage: totalMatchingVerses === verseIds.length && !assertionCapReached, assertion_cap_reached: assertionCapReached, max_examined_verses: 1000 },
      models: distribution.map((g) => ({ model_id: g.model_id, model: g.model, axis: g.axis, earliest_year: g.earliest_year, latest_year: g.latest_year, count: g.verse_ids.size, verse_ids: [...g.verse_ids].slice(0, limit), witnesses_truncated: g.verse_ids.size > limit })),
    },
    storedIds: verseIds,
  };
}

function readableReference(value: unknown): string {
  const ref = typeof value === 'string' ? value : '';
  return ref.replace(/^(\d{1,2}):(\d{1,3}):(\d{1,3})(?=$|\s|[-–])/, (_match, b, c, v) => formatRef(Number(b), Number(c), Number(v)));
}

function compactComparisonVerse(verse: Record<string, unknown>, wordById: Map<number, Record<string, unknown>>, lexicon: Record<string, unknown>): Record<string, unknown> {
  const tokens = asArray(verse.words ?? verse.tokens).map((raw) => {
    const token = asRecord(raw) ?? {};
    const fields = ['position', 'word_id', 'surface', 'lemma', 'lemma_key', 'lemma_candidates', 'sense_status', 'strongs', 'all_strongs', 'gloss', 'transliteration', 'grammar_code', 'pos_class', 'alignment', 'alignment_status', 'source_token_id', 'source_word_id', 'canonical_occurrence_id'];
    const compact = Object.fromEntries(fields.filter((key) => token[key] !== undefined && token[key] !== null && token[key] !== '').map((key) => [key, token[key]]));
    const row = wordById.get(Number(token.word_id));
    // Never attach another word's morphology or transliteration, even if its ID exists.
    delete compact.transliteration;
    delete compact.grammar_code;
    if (verifyWordRowAlignment(token, row)) {
      const tr = cleanTransliteration(firstNonEmpty(row?.transliteration));
      const code = firstNonEmpty(row?.grammar_code);
      if (tr) compact.transliteration = tr;
      if (code) compact.grammar_code = code;
    }
    const lexical = Object.fromEntries(['lemma', 'pos_class', 'lemma_candidates', 'sense_status'].filter((key) => compact[key] !== undefined).map((key) => [key, compact[key]]));
    const baseKey = firstNonEmpty(token.lemma_key, token.strongs);
    if (baseKey) {
      // Preserve distinct records if source variants under one lemma disagree.
      let key = baseKey;
      for (let suffix = 2; lexicon[key]; suffix++) {
        const stored = { ...asRecord(lexicon[key]) };
        delete stored.lemma_key;
        if (JSON.stringify(stored) === JSON.stringify(lexical)) break;
        key = baseKey + ':' + suffix;
      }
      lexicon[key] = key === baseKey ? lexical : { ...lexical, lemma_key: token.lemma_key };
      compact.key = key;
      for (const field of ['lemma', 'lemma_key', 'pos_class', 'lemma_candidates', 'sense_status']) delete compact[field];
    }
    return compact;
  });
  return {
    verse_id: verse.verse_id,
    ref: verse.ref || formatRef(Number(verse.book), Number(verse.chapter), Number(verse.verse)),
    original: firstNonEmpty(verse.original, verse.original_text, verse.text, tokens.map((t) => t.surface).join(' ')),
    english: firstNonEmpty(verse.web, verse.english),
    tokens,
  };
}

async function executeGeographySearch(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'geography_search' }>,
): Promise<Record<string, unknown>> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const rows = await callRpc(
    ctx.read,
    'query_places_by_name',
    { query: op.place },
    limit,
    0,
  );
  const placesRaw = extractRowsOrField(rows, 'places', 'items', 'results');
  const places = placesRaw.slice(0, limit).map((p) => {
    const lat = typeof p.lat === 'number' && Number.isFinite(p.lat)
      ? p.lat
      : typeof p.latitude === 'number' && Number.isFinite(p.latitude)
        ? p.latitude
        : null;
    const lon = typeof p.lon === 'number' && Number.isFinite(p.lon)
      ? p.lon
      : typeof p.lng === 'number' && Number.isFinite(p.lng)
        ? p.lng
        : typeof p.longitude === 'number' && Number.isFinite(p.longitude)
          ? p.longitude
          : null;
    return {
      place: firstNonEmpty(p.place, p.name, p.ancient_name),
      place_type: firstNonEmpty(p.place_type, p.type, 'unknown'),
      modern_name: firstNonEmpty(p.modern_name, p.modern) || null,
      lat,
      lon,
      ...(p.is_non_physical !== undefined ? { is_non_physical: p.is_non_physical } : {}),
      linked_passages: asArray(p.linked_passages ?? p.passages ?? p.refs).slice(0, 12).map((raw) => {
        const link = asRecord(raw);
        return link
          ? { ...link, ref: readableReference(link.ref ?? link.evidence_ref), role: firstNonEmpty(link.role, link.relationship_type, 'unknown') }
          : { ref: readableReference(raw), role: 'unknown' };
      }),
      coverage: 'Published links only; roles are source assertions. Unknown roles do not establish event or audience location.',
      events: asArray(p.events).slice(0, 8),
    };
  });

  return {
    status: places.length > 0 ? 'ok' : 'not_found',
    query: op.place,
    places,
  };
}

async function executePassageCompare(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'passage_compare' }>,
): Promise<Record<string, unknown>> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const parsedPassages: Array<{ input: string; parsed: ParsedPassage }> = [];
  for (const p of op.passages) {
    const parsed = parsePassageString(p);
    if (!parsed) {
      return { status: 'invalid_request', error: `Could not parse passage: ${p}` };
    }
    parsedPassages.push({ input: p, parsed });
  }

  const hydratedPassages = await Promise.all(
    parsedPassages.map(async ({ parsed }) => ({
      normalized: parsed.normalized,
      verses: await hydrateCompactVersesByPassage(ctx.read, parsed, parsed.verse_count),
    })),
  );
  const wordIds = [...new Set(hydratedPassages.flatMap((p) => p.verses.flatMap((v) => asArray(v.words ?? v.tokens).map((t) => Number(asRecord(t)?.word_id)))))]
    .filter((id) => Number.isInteger(id) && id > 0);
  const wordById = new Map<number, Record<string, unknown>>();
  try {
    const rows = wordIds.length ? await callRpc(ctx.read, 'get_words_batch', { word_ids: wordIds }, wordIds.length, 0) : [];
    for (const row of rows) wordById.set(Number(row.id), row);
  } catch {
    // Verified source tokens remain available without optional enrichment.
  }

  const lemmaCountsPerPassage = hydratedPassages.map((p) => {
    const map = new Map<string, { strongs: string; lemma: string; gloss: string; count: number }>();
    for (const verse of p.verses) {
      for (const rawTok of asArray(verse.words ?? verse.tokens)) {
        const tok = asRecord(rawTok);
        if (!tok) continue;
        const strongs = firstNonEmpty(tok.strongs, tok.strongs_id).toUpperCase();
        const posClass = firstNonEmpty(tok.pos_class, tok.pos);
        if (!strongs || isFunctionWord({ strongs, pos_class: posClass })) continue;
        const existing = map.get(strongs);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(strongs, {
            strongs,
            lemma: firstNonEmpty(tok.lemma, tok.text, tok.form),
            gloss: firstNonEmpty(tok.gloss),
            count: 1,
          });
        }
      }
    }
    return map;
  });

  const sharedLemmas: Array<{ strongs: string; lemma: string; gloss: string; counts: number[] }> = [];
  if (lemmaCountsPerPassage.length >= 2) {
    const firstMap = lemmaCountsPerPassage[0];
    for (const [strongs, entry] of firstMap.entries()) {
      if (lemmaCountsPerPassage.every((m) => m.has(strongs))) {
        sharedLemmas.push({
          strongs,
          lemma: entry.lemma,
          gloss: entry.gloss,
          counts: lemmaCountsPerPassage.map((m) => m.get(strongs)?.count ?? 0),
        });
      }
    }
  }

  let crossConnections: CompactConnection[] = [];
  const warnings: string[] = [];
  const verseIdSets = hydratedPassages.map((p) => new Set(
    p.verses.map((v) => Number(v.verse_id)).filter((n) => Number.isInteger(n) && n > 0),
  ));
  for (let i = 0; i < hydratedPassages.length; i++) {
    for (const v of hydratedPassages[i].verses) {
      const fromRef = firstNonEmpty(v.ref, 'verse');
      for (const rawXr of asArray(v.xrefs)) {
        const xr = asRecord(rawXr);
        const targetVid = Number(xr?.target_vid ?? (Array.isArray(rawXr) ? rawXr[0] : 0));
        const targetRef = firstNonEmpty(xr?.ref, xr?.target_ref, Array.isArray(rawXr) ? rawXr[1] : '');
        const phrase = firstNonEmpty(xr?.phrase, Array.isArray(rawXr) ? rawXr[2] : '');
        const matchedIdx = verseIdSets.findIndex((s, j) => j !== i && s.has(targetVid));
        if (matchedIdx >= 0) {
          crossConnections.push({
            id: `xref:${v.verse_id}:${targetVid}`,
            relation: 'cross_reference',
            epistemic: 'editorial_cross_reference',
            tier: 4,
            title: `${fromRef} <-> ${targetRef || `vid:${targetVid}`}`,
            why: phrase ? `Cross-reference witness ("${phrase}")` : 'Direct cross-reference between compared passages',
            refs: [fromRef, ...(targetRef ? [targetRef] : [])],
          });
        }
      }
    }
  }
  try {
    const discRows = await callRpc(
      ctx.read,
      'discover_biblical_connections_v2',
      {
        query: parsedPassages.map((p) => p.parsed.normalized).join(' ; '),
        mode: 'compare',
        compare_targets: parsedPassages.map((p) => p.parsed.normalized),
        limit: Math.min(limit, 25),
      },
      1,
      0,
    );
    const payload = extractFirstObject(discRows);
    const rawConns = asArray(payload?.strongest_connections ?? payload?.connections)
      .map((c) => asRecord(c))
      .filter((c): c is Record<string, unknown> => c !== null);
    crossConnections.push(...rawConns
      .map((c) => normalizeDiscoveryConnection(c))
      .filter((c): c is CompactConnection => c !== null));
  } catch {
    warnings.push('Connection discovery unavailable; direct cross-references remain available. Retry to retrieve graph bridges.');
  }

  const lexicon: Record<string, unknown> = {};
  const passages = hydratedPassages.map((p) => ({ normalized: p.normalized, verses: p.verses.map((v) => compactComparisonVerse(v, wordById, lexicon)) }));
  return {
    status: 'ok',
    passages,
    lexicon,
    word_enrichment: 'Transliteration/grammar require matching word ID, surface and Strong\'s. Missing fields are unverified/unavailable. tokens[].key indexes lexicon; its lemma_key is the source identity. verse_id + position identifies an occurrence.',
    ...(warnings.length ? { warnings } : {}),
    shared_lemmas: sharedLemmas.slice(0, limit),
    cross_references_and_bridges: crossConnections.slice(0, limit),
  };
}

async function executeNotesSearch(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'notes_search' }>,
): Promise<Record<string, unknown>> {
  if (!op.passage && !op.word) {
    return {
      epistemic_layer: 'user_note',
      notice: NOTE_SECURITY_NOTICE,
      status: 'invalid_request',
      error: 'Provide passage or word for notes_search.',
    };
  }
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);

  if (op.passage) {
    const parsed = parsePassageString(op.passage);
    if (!parsed) {
      return {
        epistemic_layer: 'user_note',
        notice: NOTE_SECURITY_NOTICE,
        status: 'invalid_request',
        error: `Could not parse passage: ${op.passage}`,
      };
    }
    const span = parsed.passages[0];
    const rows = await callRpc(
      ctx.read,
      'get_notes_for_passage_v1',
      {
        p_book: span.book,
        p_chapter: span.chapter,
        p_verse_start: span.start_verse,
        p_verse_end: span.end_verse,
        p_author_kind: null,
        p_note_kind: null,
        p_limit: limit,
      },
      1,
      0,
    );
    const rawNotes = extractFirstObject(rows);
    const primary = asArray(rawNotes?.primary)
      .map((n) => asRecord(n))
      .filter((n): n is Record<string, unknown> => n !== null)
      .map(formatCompactNote);
    const secondary = asArray(rawNotes?.secondary)
      .map((n) => asRecord(n))
      .filter((n): n is Record<string, unknown> => n !== null)
      .map(formatCompactNote);

    let dlmNotes: Record<string, unknown> | undefined;
    if (op.include_dlm) {
      try {
        const dlmRows = await callRpc(
          ctx.read,
          'get_dlm_notes_for_verse_v1',
          { p_book: span.book, p_chapter: span.chapter, p_verse: span.start_verse, p_limit: Math.min(limit, 20) },
          1,
          0,
        );
        dlmNotes = extractFirstObject(dlmRows) ?? undefined;
      } catch {
        // Optional DLM layer.
      }
    }

    return {
      epistemic_layer: 'user_note',
      notice: NOTE_SECURITY_NOTICE,
      status: 'ok',
      passage: parsed.normalized,
      untrusted_notes: { primary, secondary },
      ...(dlmNotes ? { untrusted_dlm_notes: dlmNotes } : {}),
    };
  }

  let wordId: number | null = /^\d+$/.test(op.word!) ? Number(op.word) : null;
  if (wordId === null) {
    const resolved = await resolveWordFast(ctx.read, op.word!);
    wordId = resolved?.wordId ?? null;
  }
  if (wordId === null) {
    return {
      epistemic_layer: 'user_note',
      notice: NOTE_SECURITY_NOTICE,
      status: 'not_found',
      word: op.word,
      untrusted_notes: { items: [] },
    };
  }

  const rows = await callRpc(
    ctx.read,
    'get_notes_for_word_v1',
    { p_word_id: wordId, p_verse_id: null, p_word_position: null, p_limit: limit },
    1,
    0,
  );
  const rawNotes = extractFirstObject(rows);
  const items = extractRowsOrField(rows, 'items', 'primary', 'notes').map(formatCompactNote);

  return {
    epistemic_layer: 'user_note',
    notice: NOTE_SECURITY_NOTICE,
    status: 'ok',
    word: op.word,
    word_id: wordId,
    untrusted_notes: rawNotes ? { ...rawNotes, compacted: items } : { items },
  };
}

async function executeSetCombine(
  ctx: OpContext,
  op: Extract<ResearchOp, { op: 'set_combine' }>,
): Promise<{ result: Record<string, unknown>; storedIds: number[] }> {
  const limit = clampLimit(op.limit, ctx.defaultLimit, 50);
  const resolvedSets: number[][] = [];
  const missingRefs: string[] = [];

  for (const ref of op.refs) {
    const ids = ctx.verseIdStore.get(ref);
    if (!ids) {
      missingRefs.push(ref);
    } else {
      resolvedSets.push(ids);
    }
  }

  if (missingRefs.length > 0) {
    return {
      result: {
        status: 'invalid_reference',
        missing_refs: missingRefs,
        verse_ids: [],
        verses: [],
      },
      storedIds: [],
    };
  }

  let combined: number[] = [];
  if (op.combine === 'intersect') {
    const base = resolvedSets[0] ?? [];
    const restSets = resolvedSets.slice(1).map((s) => new Set(s));
    combined = Array.from(new Set(base.filter((id) => restSets.every((set) => set.has(id)))));
  } else if (op.combine === 'union') {
    const unionSet = new Set<number>();
    for (const s of resolvedSets) {
      for (const id of s) unionSet.add(id);
    }
    combined = Array.from(unionSet).sort((a, b) => a - b);
  } else {
    const base = resolvedSets[0] ?? [];
    const excludeSet = new Set<number>();
    for (const s of resolvedSets.slice(1)) {
      for (const id of s) excludeSet.add(id);
    }
    combined = Array.from(new Set(base.filter((id) => !excludeSet.has(id))));
  }

  const topIds = combined.slice(0, limit);
  const verses = await hydrateCompactVersesByIds(ctx.read, topIds);

  return {
    result: {
      status: 'ok',
      combine: op.combine,
      refs: op.refs,
      total_matches: combined.length,
      verse_ids: topIds,
      verses,
    },
    storedIds: combined,
  };
}

function splitCompareQueryPassages(query: string): string[] | null {
  const semi = query.split(/\s*[;|]\s*|\s+\bvs\.?\b\s+|\s+\band\b\s+/i).map((s) => s.trim()).filter(Boolean);
  if (semi.length >= 2 && semi.every((part) => isPassageLike(part))) {
    return semi.slice(0, 4);
  }
  const commaParts = query.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  if (commaParts.length >= 2 && commaParts.every((part) => isPassageLike(part))) {
    return commaParts.slice(0, 4);
  }
  return null;
}

/**
 * Execute either structured research operations[] (up to 8 per call) or a
 * shorthand query string (r10/r11/r12 evidence ID, 2+ passages compare, or
 * discovery query normalized to CompactConnection[]).
 */
export async function executeResearch(
  read: DatabaseReader,
  input: { query?: string; operations?: unknown[]; limit?: number },
): Promise<Record<string, unknown>> {
  const defaultLimit = clampLimit(input.limit, 20, 50);

  if (input.operations !== undefined) {
    const parsedOps = OperationsBatchSchema.safeParse(input.operations);
    if (!parsedOps.success) {
      return {
        status: 'invalid_request',
        error: 'Invalid research operations payload (expected 1-8 valid operations).',
        issues: parsedOps.error.issues,
      };
    }

    const ctx: OpContext = {
      read,
      defaultLimit,
      verseIdStore: new Map<string, number[]>(),
    };
    const results: Array<Record<string, unknown>> = [];

    const ops = parsedOps.data as ResearchOp[];
    for (let idx = 0; idx < ops.length; idx++) {
      const op = ops[idx];
      let output: Record<string, unknown>;
      let storedIds: number[] | null = null;

      try {
      switch (op.op) {
        case 'evidence':
          output = await executeEvidence(read, op);
          break;
        case 'occurrences': {
          const res = await executeOccurrences(ctx, op);
          output = res.result;
          storedIds = res.storedIds;
          break;
        }
        case 'intersect_words': {
          const res = await executeIntersectWords(ctx, op);
          output = res.result;
          storedIds = res.storedIds;
          break;
        }
        case 'grammar_search':
          output = await executeGrammarSearch(ctx, op);
          break;
        case 'lxx':
          output = await executeLxx(ctx, op);
          break;
        case 'gematria':
          output = await executeGematria(ctx, op);
          break;
        case 'numbers':
          output = await executeNumbers(ctx, op);
          break;
        case 'chronology_occurrences': {
          const res = await executeChronologyOccurrences(ctx, op);
          output = res.result;
          storedIds = res.storedIds;
          break;
        }
        case 'geography_search':
          output = await executeGeographySearch(ctx, op);
          break;
        case 'passage_compare':
          output = await executePassageCompare(ctx, op);
          break;
        case 'notes_search':
          output = await executeNotesSearch(ctx, op);
          break;
        case 'set_combine': {
          const res = await executeSetCombine(ctx, op);
          output = res.result;
          storedIds = res.storedIds;
          break;
        }
      }

      } catch {
        output = { status: 'error', error: `Research operation "${op.op}" could not complete. Retry this operation; other results are retained.`, retryable: true };
      }

      if (storedIds !== null) {
        ctx.verseIdStore.set(String(idx), storedIds);
        if (op.id) ctx.verseIdStore.set(op.id, storedIds);
      }
      results.push({
        index: idx,
        ...(op.id ? { id: op.id } : {}),
        op: op.op,
        ...output,
      });
    }

    return {
      status: results.every((r) => r.status === 'error') ? 'error' : results.some((r) => r.status === 'error') ? 'partial' : 'ok',
      mode: 'operations',
      results,
    };
  }

  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) {
    return {
      status: 'invalid_request',
      error: 'Provide either operations[] or query.',
    };
  }

  if (/^r1[012]:/i.test(query)) {
    const evidence = await executeEvidence(read, { op: 'evidence', evidence_id: query });
    return {
      status: evidence.status === 'not_found' ? 'not_found' : 'ok',
      mode: 'shorthand_evidence',
      ...evidence,
    };
  }

  const multiPassages = splitCompareQueryPassages(query);
  if (multiPassages) {
    const ctx: OpContext = { read, defaultLimit, verseIdStore: new Map() };
    const compared = await executePassageCompare(ctx, {
      op: 'passage_compare',
      passages: multiPassages,
      limit: defaultLimit,
    });
    return {
      mode: 'shorthand_passage_compare',
      ...compared,
    };
  }

  const rows = await callRpc(
    read,
    'discover_biblical_connections_v2',
    { query, limit: Math.min(defaultLimit, 25) },
    1,
    0,
  );
  const payload = extractFirstObject(rows) ?? {};
  const rawConnections = asArray(payload.strongest_connections ?? payload.connections)
    .map((c) => asRecord(c))
    .filter((c): c is Record<string, unknown> => c !== null);
  const connections = rawConnections
    .map((c) => normalizeDiscoveryConnection(c))
    .filter((c): c is CompactConnection => c !== null);

  return {
    status: 'ok',
    mode: 'shorthand_discover',
    query,
    ...(payload.evidence_release_id ? { evidence_release_id: payload.evidence_release_id } : {}),
    connections,
  };
}
