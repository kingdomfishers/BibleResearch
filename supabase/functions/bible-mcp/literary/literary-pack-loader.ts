// @file: src/relationships/literary-pack-loader.ts
// Pure Web/Deno/Browser/Worker byte-range loader for `/v2/literary/` packed blobs.
// Uses native HTTP `Range` (`206` or full `200` fallback slice) + `DecompressionStream('gzip')`
// with zero Node-only imports so Browser, Supabase Edge Functions, and Cloudflare Workers share one loader.

import type { ShardVerseInput } from './literary-engine.ts';

export interface LiteraryIndex {
  schema_version: string;
  entries: Record<string, [string, number, number]>;
}

export interface ChapterVerseCoords {
  book: number;
  chapter: number;
  start_verse: number;
  end_verse: number;
}

export interface PassageSpanInput {
  book: number;
  chapter: number;
  verse?: number | null;
  start_verse?: number | null;
  end_verse?: number | null;
}

const DEFAULT_PUBLIC_CDN_LITERARY_BASE = 'https://bibleresearch.kingdomfishers-custom.workers.dev/v2/literary';
const MAX_CACHED_CHAPTERS = 16;

const indexCache = new Map<string, LiteraryIndex>();
const chapterCache = new Map<string, Record<string, ShardVerseInput>>();

export function defaultLiteraryPackBaseUrl(): string {
  if (typeof globalThis !== 'undefined' && 'location' in globalThis) {
    const host = (globalThis as unknown as { location?: { hostname?: string } }).location?.hostname ?? '';
    if (host.includes('bibleresearch.kingdomfishers-custom.workers.dev')) {
      return '/v2/literary';
    }
  }
  return DEFAULT_PUBLIC_CDN_LITERARY_BASE;
}

export function normalizePassageCoords(params: {
  passages?: PassageSpanInput[];
  book?: number;
  chapter?: number;
  verse?: number;
  start_verse?: number;
  end_verse?: number;
}): ChapterVerseCoords[] {
  const out: ChapterVerseCoords[] = [];
  const list = Array.isArray(params.passages) && params.passages.length > 0
    ? params.passages
    : params.book && params.chapter
      ? [{
          book: Number(params.book),
          chapter: Number(params.chapter),
          verse: params.verse,
          start_verse: params.start_verse,
          end_verse: params.end_verse,
        }]
      : [];

  for (const p of list) {
    const book = Number(p.book);
    const chapter = Number(p.chapter);
    if (!Number.isInteger(book) || !Number.isInteger(chapter) || book <= 0 || chapter <= 0) continue;
    const hasSingle = p.verse !== undefined && p.verse !== null && p.verse !== ('' as unknown);
    const hasRange =
      (p.start_verse !== undefined && p.start_verse !== null && p.start_verse !== ('' as unknown)) ||
      (p.end_verse !== undefined && p.end_verse !== null && p.end_verse !== ('' as unknown));
    if (hasSingle && !hasRange) {
      const v = Math.max(0, Math.floor(Number(p.verse)));
      out.push({ book, chapter, start_verse: v, end_verse: v });
    } else if (hasRange) {
      const sv = p.start_verse != null ? Math.max(0, Math.floor(Number(p.start_verse))) : 0;
      const ev = p.end_verse != null ? Math.min(200, Math.max(sv, Math.floor(Number(p.end_verse)))) : sv;
      out.push({ book, chapter, start_verse: sv, end_verse: ev });
    } else {
      out.push({ book, chapter, start_verse: 0, end_verse: 200 });
    }
  }
  return out;
}

async function gunzipJson(bytes: ArrayBuffer): Promise<{ schema_version: number; verses: Record<string, ShardVerseInput> }> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).json() as { schema_version: number; verses: Record<string, ShardVerseInput> };
}

function getCachedChapter(key: string): Record<string, ShardVerseInput> | undefined {
  const hit = chapterCache.get(key);
  if (hit) {
    chapterCache.delete(key);
    chapterCache.set(key, hit);
  }
  return hit;
}

function setCachedChapter(key: string, verses: Record<string, ShardVerseInput>): void {
  if (chapterCache.has(key)) chapterCache.delete(key);
  else if (chapterCache.size >= MAX_CACHED_CHAPTERS) {
    const oldest = chapterCache.keys().next().value;
    if (oldest !== undefined) chapterCache.delete(oldest);
  }
  chapterCache.set(key, verses);
}

export async function loadLiteraryVersesFromPack(
  baseUrl: string,
  coords: ChapterVerseCoords[],
  fetcher: typeof fetch = fetch,
): Promise<{ verses: ShardVerseInput[]; truncated: boolean }> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  if (!coords.length) return { verses: [], truncated: false };

  let index = indexCache.get(cleanBase);
  if (!index) {
    const res = await fetcher(`${cleanBase}/index.json`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { verses: [], truncated: false };
    index = (await res.json()) as LiteraryIndex;
    indexCache.set(cleanBase, index);
  }

  const chapterKeys = [...new Set(coords.map(c => `${c.book}:${c.chapter}`))];
  const chapterMap = new Map<string, Record<string, ShardVerseInput>>();

  await Promise.all(
    chapterKeys.map(async chKey => {
      const cacheKey = `${cleanBase}|${chKey}`;
      const cached = getCachedChapter(cacheKey);
      if (cached) {
        chapterMap.set(chKey, cached);
        return;
      }
      const entry = index!.entries[chKey];
      if (!entry) return;
      const [packFile, start, length] = entry;
      const end = start + length - 1;
      const res = await fetcher(`${cleanBase}/${packFile}`, {
        headers: { Range: `bytes=${start}-${end}` },
      });
      if (!res.ok) throw new Error(`Failed to load literary pack ${packFile} (HTTP ${res.status})`);
      let sliceBuf: ArrayBuffer;
      if (res.status === 206) {
        sliceBuf = await res.arrayBuffer();
      } else {
        const full = await res.arrayBuffer();
        sliceBuf = full.slice(start, start + length);
      }
      const parsed = await gunzipJson(sliceBuf);
      if (parsed?.verses) {
        setCachedChapter(cacheKey, parsed.verses);
        chapterMap.set(chKey, parsed.verses);
      }
    }),
  );

  const singleChapter = chapterKeys.length === 1;
  const maxCap = singleChapter ? 176 : 55;
  const seenVid = new Set<number>();
  const collected: ShardVerseInput[] = [];

  for (const sp of coords) {
    const chVerses = chapterMap.get(`${sp.book}:${sp.chapter}`);
    if (!chVerses) continue;
    for (let v = sp.start_verse; v <= sp.end_verse; v++) {
      const item = chVerses[String(v)];
      if (!item) continue;
      if (!seenVid.has(item.verse_id)) {
        seenVid.add(item.verse_id);
        collected.push(item);
      }
    }
  }

  const truncated = collected.length > maxCap;
  return {
    verses: collected.slice(0, maxCap),
    truncated,
  };
}
