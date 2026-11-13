// @file: src/api/notes-rpc.ts
// @feature: notes
// @tables: notes | note_anchors | note_connections | note_blocks | note_authors
// @candidates: none
// @toc: imports | logic:transport | logic:passage-word-reads | logic:note-search-reads | logic:writes | logic:gateway

// === @section:imports ===
import { supabase } from './supabase';
import type {
  ActivePassage,
  AuthorKind,
  ConnectionTypesResponse,
  DataResult,
  NoteDeleteResult,
  NoteDetailResponse,
  NoteKind,
  NoteListResponse,
  NoteReviewResult,
  NoteReviewStatus,
  NoteSavePayload,
  NoteWriteError,
  NoteWriteResult,
  PassageNotesResponse,
  TargetSearchResponse,
  WordNotesResponse,
} from './types';

// === @section:logic:transport ===
async function call<T>(
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<DataResult<T | null>> {
  if (!supabase) return { data: null, source: 'unavailable', error: 'Database connection is not configured.' };
  try {
    const combinedSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    const { data, error } = await supabase.rpc(name, args).abortSignal(combinedSignal);
    if (error) {
      return { data: null, source: 'unavailable', error: error.message || 'Database request failed.' };
    }
    return { data: (data as T) ?? null, source: 'live', error: null };
  } catch (err) {
    const isTimeout =
      (err instanceof Error && err.name === 'TimeoutError') ||
      (Boolean(signal) && !signal?.aborted && err instanceof Error && err.name === 'AbortError');
    const msg = isTimeout ? 'Request timed out.' : (err instanceof Error ? err.message : 'Database request failed.');
    return { data: null, source: 'unavailable', error: msg };
  }
}

async function callWrite<T extends { ok: boolean; error?: NoteWriteError }>(
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 15000
): Promise<T> {
  if (!supabase) {
    return {
      ok: false,
      error: { code: 'network_error', message: 'Database connection is not configured.' },
    } as T;
  }
  try {
    const { data, error } = await supabase.rpc(name, args).abortSignal(AbortSignal.timeout(timeoutMs));
    if (error) {
      return {
        ok: false,
        error: { code: 'network_error', message: error.message || 'Database write failed.' },
      } as T;
    }
    return (data as T) ?? ({
      ok: false,
      error: { code: 'network_error', message: 'Empty response received from write RPC.' },
    } as T);
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.message.toLowerCase().includes('timeout'));
    return {
      ok: false,
      error: {
        code: isTimeout ? 'timeout' : 'network_error',
        message: err instanceof Error ? err.message : 'Transport failure during note write.',
      },
    } as T;
  }
}

// === @section:logic:passage-word-reads ===
let cachedConnectionTypes: ConnectionTypesResponse | null = null;
let pendingConnectionTypes: Promise<DataResult<ConnectionTypesResponse | null>> | null = null;

async function connectionTypes(
  opts?: { signal?: AbortSignal }
): Promise<DataResult<ConnectionTypesResponse | null>> {
  if (cachedConnectionTypes) {
    return { data: cachedConnectionTypes, source: 'live', error: null };
  }
  // Share startup reads, but keep explicitly cancellable callers independent.
  if (!opts?.signal && pendingConnectionTypes) return pendingConnectionTypes;
  const request = call<ConnectionTypesResponse>('list_note_connection_types_v1', {}, 10000, opts?.signal)
    .then(res => {
      if (res.data) cachedConnectionTypes = res.data;
      return res;
    });
  if (opts?.signal) return request;
  pendingConnectionTypes = request.finally(() => { pendingConnectionTypes = null; });
  return pendingConnectionTypes;
}

async function getForPassage(
  p: ActivePassage,
  opts?: {
    verseEnd?: number;
    authorKind?: AuthorKind | 'all' | null;
    noteKind?: NoteKind | null;
    limit?: number;
    signal?: AbortSignal;
  }
): Promise<DataResult<PassageNotesResponse | null>> {
  const authorKindParam = opts?.authorKind && opts.authorKind !== 'all' ? opts.authorKind : null;
  return call<PassageNotesResponse>(
    'get_notes_for_passage_v1',
    {
      p_book: p.book,
      p_chapter: p.chapter,
      p_verse_start: p.verse,
      p_verse_end: opts?.verseEnd ?? p.verse,
      p_author_kind: authorKindParam,
      p_note_kind: opts?.noteKind ?? null,
      p_limit: opts?.limit ?? 50,
    },
    10000,
    opts?.signal
  );
}

async function getForWord(
  wordId: number,
  verseId?: number | null,
  position?: number | null,
  opts?: { limit?: number; signal?: AbortSignal }
): Promise<DataResult<WordNotesResponse | null>> {
  return call<WordNotesResponse>(
    'get_notes_for_word_v1',
    {
      p_word_id: wordId,
      p_verse_id: verseId ?? null,
      p_word_position: position ?? null,
      p_limit: opts?.limit ?? 50,
    },
    10000,
    opts?.signal
  );
}

// === @section:logic:note-search-reads ===
async function getNote(
  id: string,
  opts?: { signal?: AbortSignal }
): Promise<DataResult<NoteDetailResponse | null>> {
  return call<NoteDetailResponse>('get_note_v1', { p_note_id: id }, 10000, opts?.signal);
}

async function list(
  filters?: {
    authorKind?: AuthorKind | 'all' | null;
    noteKind?: NoteKind | null;
    connectionType?: string | null;
    query?: string | null;
  },
  cursor?: unknown,
  opts?: { limit?: number; signal?: AbortSignal }
): Promise<DataResult<NoteListResponse | null>> {
  const authorKindParam = filters?.authorKind && filters.authorKind !== 'all' ? filters.authorKind : null;
  return call<NoteListResponse>(
    'list_notes_v1',
    {
      p_author_kind: authorKindParam,
      p_note_kind: filters?.noteKind ?? null,
      p_connection_type: filters?.connectionType ?? null,
      p_query: filters?.query ?? null,
      p_limit: opts?.limit ?? 25,
      p_cursor: cursor ?? null,
    },
    10000,
    opts?.signal
  );
}

async function searchTargets(
  query: string,
  kinds?: string[] | null,
  signal?: AbortSignal
): Promise<DataResult<TargetSearchResponse | null>> {
  return call<TargetSearchResponse>(
    'search_note_targets_v1',
    { p_query: query, p_kinds: kinds ?? null, p_limit: 20 },
    8000,
    signal
  );
}

// === @section:logic:writes ===
async function save(payload: NoteSavePayload): Promise<NoteWriteResult> {
  return callWrite<NoteWriteResult>('save_note_v1', { p_note: payload }, 15000);
}

async function remove(id: string, expectedVersion?: number): Promise<NoteDeleteResult> {
  return callWrite<NoteDeleteResult>(
    'delete_note_v1',
    { p_note_id: id, p_expected_version: expectedVersion ?? null },
    15000
  );
}

async function setReview(id: string, status: NoteReviewStatus): Promise<NoteReviewResult> {
  return callWrite<NoteReviewResult>(
    'set_note_review_v1',
    { p_note_id: id, p_review_status: status },
    15000
  );
}

// === @section:logic:gateway ===
export const NotesRPC = {
  getForPassage,
  getForWord,
  getNote,
  list,
  connectionTypes,
  searchTargets,
  save,
  remove,
  setReview,
};
