export interface ChainStep {
  step_index: number;
  from_node: string;
  to_node: string;
  edge_id?: string;
  relation: string;
  epistemic: string;
  refs: string[];
  note?: string;
  branched_from_step?: number;
}

export interface ChainBranch {
  branch_id: string;
  from_step: number;
  from_node: string;
  created_at: string;
}

export interface ChainState {
  chain_id: string;
  root: string;
  current_node: string;
  visited_nodes: string[];
  visited_edges: string[];
  steps: ChainStep[];
  branches: ChainBranch[];
  active_candidates?: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export type InitialChainState = Omit<
  ChainState,
  'chain_id' | 'created_at' | 'updated_at' | 'expires_at'
>;

export interface ChainStoreConfig {
  url: string;
  serviceRoleKey: string;
}

export interface ChainStoreOptions {
  ttlMs?: number;
  now?: () => number;
}

export interface ChainStoreFailure {
  ok: false;
  error: string;
  message: string;
}

export type ChainCreateResult =
  | { ok: true; handle: string; chain_id: string; state: ChainState }
  | ChainStoreFailure;

export type ChainLoadResult =
  | { ok: true; chain_id: string; state: ChainState }
  | ChainStoreFailure;

export type ChainUpdateResult =
  | { ok: true; chain_id: string; state: ChainState }
  | ChainStoreFailure;

export interface ChainStore {
  create(
    initialState: InitialChainState,
    mcpSessionId?: string | null,
  ): Promise<ChainCreateResult>;
  load(
    handle: string,
    mcpSessionId?: string | null,
  ): Promise<ChainLoadResult>;
  update(
    handle: string,
    nextState: ChainState,
    mcpSessionId?: string | null,
  ): Promise<ChainUpdateResult>;
}

interface StoredChainRecord {
  chain_id: string;
  token_hash: string;
  session_hash: string | null;
  state: ChainState;
  expires_at: string;
}

interface RemoteChainRow {
  chain_id: string;
  token_hash: string;
  session_hash: string | null;
  state: ChainState;
  expires_at: string;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const LRU_MAX_ENTRIES = 128;
const MAX_VISITED_NODES = 40;
const MAX_STEPS = 60;
const MAX_BRANCHES = 10;
const MAX_STATE_BYTES = 48 * 1024;
const HANDLE_REGEX = /^ch_([0-9a-f]{24})_([0-9a-f]{36})$/;

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

/**
 * Constant-time string comparison using XOR over UTF-8 bytes.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  const maxLen = Math.max(bytesA.length, bytesB.length);
  let diff = bytesA.length ^ bytesB.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0;
}

function parseHandle(
  handle: string,
): { chainId: string; secret: string } | null {
  if (typeof handle !== 'string') return null;
  const match = HANDLE_REGEX.exec(handle);
  if (!match) return null;
  return { chainId: match[1], secret: match[2] };
}

function normalizeSessionId(mcpSessionId?: string | null): string | null {
  if (typeof mcpSessionId !== 'string') return null;
  const trimmed = mcpSessionId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizeChainState(
  raw: InitialChainState | ChainState,
  chainId: string,
  createdAt: string,
  updatedAt: string,
  expiresAt: string,
): ChainState {
  const clean: ChainState = {
    chain_id: chainId,
    root: String(raw.root ?? ''),
    current_node: String(raw.current_node ?? ''),
    visited_nodes: Array.isArray(raw.visited_nodes)
      ? raw.visited_nodes.map(String)
      : [],
    visited_edges: Array.isArray(raw.visited_edges)
      ? raw.visited_edges.map(String)
      : [],
    steps: Array.isArray(raw.steps) ? cloneJson(raw.steps) : [],
    branches: Array.isArray(raw.branches) ? cloneJson(raw.branches) : [],
    created_at: createdAt,
    updated_at: updatedAt,
    expires_at: expiresAt,
  };
  if (Array.isArray(raw.active_candidates)) {
    clean.active_candidates = cloneJson(raw.active_candidates);
  }
  return clean;
}

function validateStateBounds(state: ChainState): ChainStoreFailure | null {
  if (state.visited_nodes.length > MAX_VISITED_NODES) {
    return {
      ok: false,
      error: 'chain_limit_exceeded',
      message: `visited_nodes exceeds maximum of ${MAX_VISITED_NODES}.`,
    };
  }
  if (state.steps.length > MAX_STEPS) {
    return {
      ok: false,
      error: 'chain_limit_exceeded',
      message: `steps exceeds maximum of ${MAX_STEPS}.`,
    };
  }
  if (state.branches.length > MAX_BRANCHES) {
    return {
      ok: false,
      error: 'chain_limit_exceeded',
      message: `branches exceeds maximum of ${MAX_BRANCHES}.`,
    };
  }
  const serializedBytes = encoder.encode(JSON.stringify(state)).byteLength;
  if (serializedBytes > MAX_STATE_BYTES) {
    return {
      ok: false,
      error: 'chain_limit_exceeded',
      message: `Serialized chain state exceeds maximum of ${MAX_STATE_BYTES} bytes.`,
    };
  }
  return null;
}

function isExpired(expiresAt: string, nowMs: number): boolean {
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return true;
  return nowMs >= expiresMs;
}

function shouldPrune(): boolean {
  const byte = new Uint8Array(1);
  crypto.getRandomValues(byte);
  return byte[0] < 13; // ~5% (~1 in 20)
}

/**
 * Creates a capability-backed expiring chain store with bounded in-memory LRU
 * caching and optional Supabase PostgREST persistence.
 */
export function createChainStore(
  config?: ChainStoreConfig | null,
  fetcher: typeof fetch = fetch,
  options?: ChainStoreOptions,
): ChainStore {
  const baseUrl = config?.url ? config.url.replace(/\/+$/, '') : '';
  const serviceRoleKey = config?.serviceRoleKey ?? '';
  const hasRemote = baseUrl.length > 0 && serviceRoleKey.length > 0;
  const ttlMs =
    typeof options?.ttlMs === 'number' && options.ttlMs > 0
      ? options.ttlMs
      : DEFAULT_TTL_MS;
  const now = options?.now ?? (() => Date.now());

  const cache = new Map<string, StoredChainRecord>();

  function getCached(chainId: string): StoredChainRecord | undefined {
    const entry = cache.get(chainId);
    if (!entry) return undefined;
    cache.delete(chainId);
    cache.set(chainId, entry);
    return entry;
  }

  function setCached(chainId: string, record: StoredChainRecord): void {
    if (cache.has(chainId)) {
      cache.delete(chainId);
    }
    cache.set(chainId, {
      ...record,
      state: cloneJson(record.state),
    });
    if (cache.size > LRU_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
  }

  function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...extra,
    };
  }

  function triggerBackgroundPrune(cutoffIso: string): void {
    if (!hasRemote || !shouldPrune()) return;
    const pruneUrl = `${baseUrl}/rest/v1/mcp_connection_chains?expires_at=lt.${encodeURIComponent(cutoffIso)}`;
    void (async () => {
      try {
        await fetcher(pruneUrl, {
          method: 'DELETE',
          headers: buildAuthHeaders(),
        });
      } catch {
        // Non-blocking best-effort cleanup; ignore errors.
      }
    })();
  }

  async function fetchRemoteRecord(
    chainId: string,
  ): Promise<{ ok: true; record: StoredChainRecord | null } | ChainStoreFailure> {
    const queryUrl = `${baseUrl}/rest/v1/mcp_connection_chains?chain_id=eq.${encodeURIComponent(chainId)}&select=chain_id,token_hash,session_hash,state,expires_at`;
    try {
      const response = await fetcher(queryUrl, {
        method: 'GET',
        headers: buildAuthHeaders({ Accept: 'application/json' }),
      });
      if (!response.ok) {
        return {
          ok: false,
          error: 'chain_store_error',
          message: `Failed to load connection chain (status ${response.status}).`,
        };
      }
      const rows = (await response.json()) as unknown;
      if (!Array.isArray(rows) || rows.length === 0) {
        return { ok: true, record: null };
      }
      const row = rows[0] as RemoteChainRow;
      if (!row || typeof row.token_hash !== 'string' || !row.state) {
        return { ok: true, record: null };
      }
      const state = sanitizeChainState(
        row.state,
        chainId,
        String(row.state.created_at ?? ''),
        String(row.state.updated_at ?? ''),
        String(row.expires_at ?? row.state.expires_at ?? ''),
      );
      return {
        ok: true,
        record: {
          chain_id: chainId,
          token_hash: row.token_hash,
          session_hash: typeof row.session_hash === 'string' ? row.session_hash : null,
          state,
          expires_at: String(row.expires_at ?? state.expires_at),
        },
      };
    } catch {
      return {
        ok: false,
        error: 'chain_store_error',
        message: 'Failed to load connection chain from store.',
      };
    }
  }

  async function verifyAndGetRecord(
    handle: string,
    mcpSessionId?: string | null,
  ): Promise<
    | { ok: true; chainId: string; tokenHash: string; record: StoredChainRecord }
    | ChainStoreFailure
  > {
    const parsed = parseHandle(handle);
    if (!parsed) {
      return {
        ok: false,
        error: 'invalid_chain_handle',
        message: 'Invalid connection chain handle.',
      };
    }

    const tokenHash = await sha256Hex(parsed.secret);
    const normalizedSession = normalizeSessionId(mcpSessionId);
    const callerSessionHash = normalizedSession
      ? await sha256Hex(normalizedSession)
      : null;

    let record = getCached(parsed.chainId);
    if (!record && hasRemote) {
      const remoteResult = await fetchRemoteRecord(parsed.chainId);
      if (!remoteResult.ok) {
        return remoteResult;
      }
      if (remoteResult.record) {
        record = remoteResult.record;
        setCached(parsed.chainId, record);
      }
    }

    if (!record) {
      return {
        ok: false,
        error: 'chain_not_found',
        message: 'Connection chain not found.',
      };
    }

    if (!constantTimeEqual(record.token_hash, tokenHash)) {
      return {
        ok: false,
        error: 'chain_access_denied',
        message: 'Invalid or unauthorized connection chain.',
      };
    }

    if (
      record.session_hash !== null &&
      callerSessionHash !== null &&
      !constantTimeEqual(record.session_hash, callerSessionHash)
    ) {
      return {
        ok: false,
        error: 'chain_access_denied',
        message: 'Connection chain does not belong to this session.',
      };
    }

    if (isExpired(record.expires_at, now())) {
      cache.delete(parsed.chainId);
      return {
        ok: false,
        error: 'chain_expired',
        message: 'Connection chain has expired.',
      };
    }

    return {
      ok: true,
      chainId: parsed.chainId,
      tokenHash,
      record,
    };
  }

  return {
    async create(
      initialState: InitialChainState,
      mcpSessionId?: string | null,
    ): Promise<ChainCreateResult> {
      const chainId = randomHex(12);
      const secret = randomHex(18);
      const handle = `ch_${chainId}_${secret}`;
      const tokenHash = await sha256Hex(secret);
      const normalizedSession = normalizeSessionId(mcpSessionId);
      const sessionHash = normalizedSession
        ? await sha256Hex(normalizedSession)
        : null;

      const nowMs = now();
      const createdAt = new Date(nowMs).toISOString();
      const expiresAt = new Date(nowMs + ttlMs).toISOString();
      const state = sanitizeChainState(
        initialState,
        chainId,
        createdAt,
        createdAt,
        expiresAt,
      );

      const boundsError = validateStateBounds(state);
      if (boundsError) {
        return boundsError;
      }

      if (hasRemote) {
        try {
          const response = await fetcher(
            `${baseUrl}/rest/v1/mcp_connection_chains`,
            {
              method: 'POST',
              headers: buildAuthHeaders({
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              }),
              body: JSON.stringify({
                chain_id: chainId,
                token_hash: tokenHash,
                session_hash: sessionHash,
                state,
                created_at: createdAt,
                updated_at: createdAt,
                expires_at: expiresAt,
              }),
            },
          );
          if (!response.ok) {
            return {
              ok: false,
              error: 'chain_store_error',
              message: `Failed to persist connection chain (status ${response.status}).`,
            };
          }
          triggerBackgroundPrune(createdAt);
        } catch {
          return {
            ok: false,
            error: 'chain_store_error',
            message: 'Failed to persist connection chain.',
          };
        }
      }

      setCached(chainId, {
        chain_id: chainId,
        token_hash: tokenHash,
        session_hash: sessionHash,
        state,
        expires_at: expiresAt,
      });

      return {
        ok: true,
        handle,
        chain_id: chainId,
        state: cloneJson(state),
      };
    },

    async load(
      handle: string,
      mcpSessionId?: string | null,
    ): Promise<ChainLoadResult> {
      const verified = await verifyAndGetRecord(handle, mcpSessionId);
      if (!verified.ok) {
        return verified;
      }
      return {
        ok: true,
        chain_id: verified.chainId,
        state: cloneJson(verified.record.state),
      };
    },

    async update(
      handle: string,
      nextState: ChainState,
      mcpSessionId?: string | null,
    ): Promise<ChainUpdateResult> {
      const verified = await verifyAndGetRecord(handle, mcpSessionId);
      if (!verified.ok) {
        return verified;
      }

      const updatedAt = new Date(now()).toISOString();
      const updatedState = sanitizeChainState(
        nextState,
        verified.chainId,
        verified.record.state.created_at,
        updatedAt,
        verified.record.expires_at,
      );

      const boundsError = validateStateBounds(updatedState);
      if (boundsError) {
        return boundsError;
      }

      if (hasRemote) {
        const patchUrl = `${baseUrl}/rest/v1/mcp_connection_chains?chain_id=eq.${encodeURIComponent(verified.chainId)}&token_hash=eq.${encodeURIComponent(verified.tokenHash)}`;
        try {
          const response = await fetcher(patchUrl, {
            method: 'PATCH',
            headers: buildAuthHeaders({
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            }),
            body: JSON.stringify({
              state: updatedState,
              updated_at: updatedAt,
            }),
          });
          if (!response.ok) {
            return {
              ok: false,
              error: 'chain_store_error',
              message: `Failed to update connection chain (status ${response.status}).`,
            };
          }
        } catch {
          return {
            ok: false,
            error: 'chain_store_error',
            message: 'Failed to update connection chain.',
          };
        }
      }

      setCached(verified.chainId, {
        chain_id: verified.chainId,
        token_hash: verified.tokenHash,
        session_hash: verified.record.session_hash,
        state: updatedState,
        expires_at: verified.record.expires_at,
      });

      return {
        ok: true,
        chain_id: verified.chainId,
        state: cloneJson(updatedState),
      };
    },
  };
}
