// BibleResearch MCP v2.0.0: compact 7-tool AI discovery interface.
// Pure Web/Deno TypeScript with strict epistemic separation and zero Node imports.

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { DatabaseQuery, DatabaseReader } from './catalog.ts';
import type { ChainState, ChainStep, ChainStore } from './chain-store.ts';
import { chainEvidenceTarget, matchesAxisFilter, selectChainEvidence, type AxisFilter, type ChainEvidence } from './chain-evidence.ts';
import {
  bookName,
  formatRef,
  isPassageLike,
  parsePassageString,
  type ParsedPassage,
} from './bible-ref.ts';
import { computeGematria } from './gematria.ts';
import { NOTE_SECURITY_NOTICE, formatCompactNote } from './notes-tools.ts';
import {
  executeAddResearchNote,
  executeCreateNote,
  executeDeleteNote,
  executeUpdateNote,
  noteAnchorInputSchema,
  noteBlockInputSchema,
  noteConnectionInputSchema,
  noteKinds,
  type NotesWriter,
} from './notes-write.ts';
import { dlmCardInputSchema, executeSaveDlmCard } from './dlm-notes.ts';
import { ResearchOpInputSchema, executeResearch, runLiteraryStructureMcp } from './research-engine.ts';
import {
  executeKgWriteAction,
  fetchKgNeighborsForChain,
  kgBatchInputSchema,
  kgClaimInputSchema,
  kgTrailInputSchema,
} from './research-graph-tools.ts';
import { WORKFLOW_INSTRUCTIONS, WORKFLOW_VERSION } from './research-workflow.ts';
import {
  verifyWordRowAlignment,
  buildWordEtymology,
  buildWordRealworld,
  cleanTransliteration,
  compactChronology,
  compactGeography,
  compactWordFromData,
  isFunctionWord,
  normalizeDiscoveryConnection,
  type CompactConnection,
  type CompactWord,
} from './word-model.ts';
import {
  computeBridgeSpecificityBonus,
  HIGH_DF_PROPER_NAME_HUBS,
  isLxxFunctionEquivalent,
  isVerifiedTextualProofEpistemic,
  normalizeEpistemicClass,
} from './literary/epistemic-taxonomy.ts';

export const V2_READ_TOOL_NAMES = [
  'get_Passage',
  'get_Word',
  'get_Connection',
  'follow_connectionchain',
  'research',
  'get_prompt',
] as const;

export const V2_WRITE_TOOL_NAME = 'write_Note' as const;

export const SERVER_INSTRUCTIONS_V2 = [
  'BibleResearch provides grounded original-language biblical research across STEP/MACULA Hebrew/Aramaic and Greek corpora, Swete LXX bridges, relationship graphs, scoped geography, competing chronology models, and study notes.',
  'Start with get_Passage or get_Word: outputs are compact, deduplicated, and include high-signal connections. Use get_Connection to test links across words or passages, follow_connectionchain to walk/branch remembered paths without repeating visited nodes, research for combined queries/gematria/chronology/geography calculations, get_prompt for research guidelines, and write_Note only when the user explicitly requests saving.',
  'Preserve epistemic distinctions: attestable text, lexical senses, documented roots, spelling-similarity candidates, statistical co-occurrence, arithmetic gematria, scoped geography, competing chronological models, and untrusted user/AI notes or DLM hypotheses.',
  'Legacy 46-tool access remains available at /legacy/mcp.',
].join(' ');

const readOnlyMeta = {
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { securitySchemes: [{ type: 'noauth' }] },
};

const writeMeta = {
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

type Rec = Record<string, unknown>;

function asRec(val: unknown): Rec | null {
  return val && typeof val === 'object' && !Array.isArray(val) ? (val as Rec) : null;
}

function asArr(val: unknown): unknown[] {
  return Array.isArray(val) ? val : [];
}

function str(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val.trim() : fallback;
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

function textReply(text: string) {
  return [{ type: 'text' as const, text }];
}

function jsonReply(payload: Rec) {
  return { content: textReply(JSON.stringify(payload)) };
}

function errorReply(message: string, details?: Rec) {
  const payload = { status: 'error', error: message, ...(details ?? {}) };
  return { isError: true, content: textReply(JSON.stringify(payload)) };
}

async function callRpc(
  read: DatabaseReader,
  name: string,
  args: Rec,
  limit = 25,
  offset = 0,
): Promise<Rec[]> {
  const res = await read({ name: name as DatabaseQuery['name'], args, limit, offset });
  return Array.isArray(res.rows) ? res.rows : [];
}

async function safeCallFirst(
  read: DatabaseReader,
  name: string,
  args: Rec,
  limit = 1,
): Promise<Rec | null> {
  try {
    const rows = await callRpc(read, name, args, limit, 0);
    return asRec(rows[0]);
  } catch {
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>(resolve => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type McpView = 'clues' | 'evidence' | 'full';

const VIEW_ALIAS_VALUES = [
  'clues',
  'clue',
  'evidence',
  'full',
  'concise',
  'compact',
  'standard',
  'summary',
  'deep',
] as const;

const ViewAliasSchema = z.enum(VIEW_ALIAS_VALUES);

function resolveViewMode(view?: string, detail?: string): McpView {
  const raw = (view || detail || 'clues').toLowerCase();
  if (raw === 'full' || raw === 'deep') return 'full';
  if (raw === 'evidence' || raw === 'standard') return 'evidence';
  return 'clues';
}

function parseMcpView(view: unknown, compact?: boolean): McpView {
  if (view === 'evidence' || view === 'full' || view === 'clues') return view;
  if (typeof view === 'string') return resolveViewMode(view);
  return compact ? 'clues' : 'clues';
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

function toBase64Url(strVal: string): string {
  const bytes = utf8Encoder.encode(strVal);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(b64u: string): string {
  const padLen = (4 - (b64u.length % 4)) % 4;
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return utf8Decoder.decode(bytes);
}

const CHAIN_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function encodeStatelessChainToken(state: ChainState, sessionId?: string | null): string {
  const compactSteps = state.steps.slice(-10).map(s => ({
    i: s.step_index,
    f: s.from_node,
    t: s.to_node,
    ...(s.edge_id ? { e: s.edge_id } : {}),
    rel: s.relation,
    ep: s.epistemic,
    r: (s.refs || []).slice(0, 2),
    ...(s.branched_from_step !== undefined ? { b: s.branched_from_step } : {}),
  }));
  const payload = {
    v: 1,
    id: state.chain_id,
    r: state.root,
    c: state.current_node,
    vn: state.visited_nodes.slice(-24),
    ve: state.visited_edges.slice(-24),
    st: compactSteps,
    br: state.branches.slice(-6),
    exp: state.expires_at,
    ...(sessionId ? { sid: sessionId.slice(0, 32) } : {}),
  };
  return toBase64Url(JSON.stringify(payload));
}

function decodeStatelessChainToken(
  token: string,
  sessionId?: string | null,
): { ok: true; state: ChainState } | { ok: false; error: string; message: string } {
  try {
    const raw = JSON.parse(fromBase64Url(token)) as Rec;
    if (!raw || raw.v !== 1 || typeof raw.r !== 'string' || typeof raw.c !== 'string') {
      return { ok: false, error: 'invalid_chain_handle', message: 'Invalid connection chain handle.' };
    }
    if (typeof raw.sid === 'string' && raw.sid.length > 0) {
      if (!sessionId || sessionId.slice(0, 32) !== raw.sid) {
        return { ok: false, error: 'chain_access_denied', message: 'Connection chain does not belong to this session.' };
      }
    }
    const expIso = typeof raw.exp === 'string' && raw.exp ? raw.exp : new Date(Date.now() + CHAIN_DEFAULT_TTL_MS).toISOString();
    const expMs = Date.parse(expIso);
    if (Number.isFinite(expMs) && Date.now() >= expMs) {
      return { ok: false, error: 'chain_expired', message: 'Connection chain has expired.' };
    }
    const nowIso = new Date().toISOString();
    const steps: ChainStep[] = asArr(raw.st).map(asRec).filter((s): s is Rec => s !== null).map((s, idx) => ({
      step_index: typeof s.i === 'number' ? s.i : idx + 1,
      from_node: str(s.f),
      to_node: str(s.t),
      ...(str(s.e) ? { edge_id: str(s.e) } : {}),
      relation: str(s.rel, 'exploratory_step'),
      epistemic: str(s.ep, 'exploratory_hypothesis'),
      refs: asArr(s.r).filter((x): x is string => typeof x === 'string'),
      ...(typeof s.b === 'number' ? { branched_from_step: s.b } : {}),
    }));
    const branches = asArr(raw.br).map(asRec).filter((b): b is Rec => b !== null).map(b => ({
      branch_id: str(b.branch_id, 'br_1'),
      from_step: typeof b.from_step === 'number' ? b.from_step : 0,
      from_node: str(b.from_node, str(raw.r)),
      created_at: str(b.created_at, nowIso),
    }));
    return {
      ok: true,
      state: {
        chain_id: str(raw.id, 'stateless'),
        root: str(raw.r),
        current_node: str(raw.c),
        visited_nodes: asArr(raw.vn).filter((x): x is string => typeof x === 'string'),
        visited_edges: asArr(raw.ve).filter((x): x is string => typeof x === 'string'),
        steps,
        branches,
        active_candidates: [],
        created_at: nowIso,
        updated_at: nowIso,
        expires_at: expIso,
      },
    };
  } catch {
    return { ok: false, error: 'invalid_chain_handle', message: 'Invalid connection chain handle.' };
  }
}

function parseCompositeChainHandle(rawHandle: string): { storeHandle: string | null; statelessToken: string | null } {
  const trimmed = rawHandle.trim();
  if (trimmed.startsWith('v3c:')) {
    return { storeHandle: null, statelessToken: trimmed.slice(4) };
  }
  const idx = trimmed.indexOf('~v3c:');
  if (idx > 0) {
    return {
      storeHandle: trimmed.slice(0, idx),
      statelessToken: trimmed.slice(idx + 5),
    };
  }
  return { storeHandle: trimmed, statelessToken: null };
}

function formatCompositeChainHandle(storeHandle: string | null, state: ChainState, sessionId?: string | null): string {
  const token = encodeStatelessChainToken(state, sessionId);
  return storeHandle ? `${storeHandle}~v3c:${token}` : `v3c:${token}`;
}

function trimConcise(val: string | undefined, maxLen: number): string {
  if (!val) return '';
  const s = val.replace(/\s+/g, ' ').trim();
  return s.length <= maxLen ? s : `${s.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

function projectClue(c: CompactConnection, view: McpView): CompactConnection {
  const expandId = c.expand_id || c.id;
  if (view === 'full') return { ...c, expand_id: expandId };
  if (view === 'evidence') {
    const { score_breakdown: _sb, ...rest } = c;
    return { ...rest, expand_id: expandId };
  }
  // 'clues' view: crisp, non-redundant progressive clue (no verbose witness paragraphs or raw score_breakdown)
  const conciseTitle = trimConcise(c.title, 90);
  const conciseWhy = trimConcise(c.why, 80);
  return {
    id: c.id,
    expand_id: expandId,
    relation: c.relation,
    epistemic: c.epistemic,
    ...(c.tier !== undefined ? { tier: c.tier } : {}),
    ...(c.e_perp ? { e_perp: c.e_perp } : {}),
    ...(c.axes && c.axes.length > 0 ? { axes: c.axes.slice(0, 4) } : {}),
    title: conciseTitle,
    ...(conciseWhy && conciseWhy !== conciseTitle ? { why: conciseWhy } : {}),
    refs: (c.refs || []).slice(0, 2),
    ...(c.bridge_preview ? { bridge_preview: trimConcise(c.bridge_preview, 75) } : {}),
    ...(c.matched_endpoints ? { matched_endpoints: c.matched_endpoints } : {}),
    ...(c.target
      ? {
          target: {
            ...(c.target.strongs ? { strongs: c.target.strongs } : {}),
            ...(c.target.script ? { script: c.target.script } : {}),
            ...(c.target.gloss ? { gloss: trimConcise(c.target.gloss, 36) } : {}),
          },
        }
      : {}),
  };
}

async function expandClueById(
  read: DatabaseReader,
  expandId: string,
  detail: 'clue' | 'evidence' | 'full' = 'evidence',
): Promise<Rec> {
  const v3Res = await safeCallFirst(read, 'expand_clue_v3', { expand_id: expandId, detail });
  if (v3Res && v3Res.status !== 'not_found' && v3Res.status !== 'error') {
    return { ...v3Res, expand_id: expandId, detail };
  }
  const evRes = await safeCallFirst(read, 'get_connection_evidence_v1', { evidence_id: expandId });
  if (evRes && evRes.status !== 'not_found') {
    return { status: 'ok', expand_id: expandId, detail, ...evRes };
  }
  return v3Res ?? { status: 'not_found', expand_id: expandId, detail, error: `No evidence record found for "${expandId}".` };
}

function withChainNext(
  neighbors: CompactConnection[],
  fromNode: string,
  view: McpView = 'clues',
): Array<CompactConnection & { next: string; next_id: string }> {
  return neighbors.map(c => {
    const projected = projectClue(c, view);
    const nextTarget = String(chainEvidenceTarget(c as unknown as ChainEvidence, fromNode) || c.id);
    const nextId = String(c.expand_id || c.id || nextTarget);
    return {
      ...projected,
      next: nextTarget,
      next_id: nextId,
    };
  });
}

// Split profile decoding across bounded read RPCs to respect the free Worker CPU budget.
// Candidate selection and ordering use the identical plan produced by the corpus handler.
export async function fetchCompactPassage(read: DatabaseReader, args: Rec): Promise<Rec | null> {
  const packet = await safeCallFirst(read, 'get_passage_compact_v1', { ...args, defer_profiles: true });
  const plan = asRec(packet?.profile_plan);
  if (!packet || !plan) return packet;
  const candidates = asArr(plan.candidates).map(asRec).filter((c): c is Rec => c !== null);
  const loaded: Rec = {};
  let unavailable = false;
  for (let offset = 0; offset < candidates.length; offset += 8) {
    const page = await safeCallFirst(read, 'get_word_profiles_batch_v1', {
      strongs: candidates.slice(offset, offset + 8).map(c => c.bs),
      include_vids: false, include_forms: false, include_orth: true, include_pilot: false,
    });
    if (!page) unavailable = true;
    Object.assign(loaded, asRec(page?.profiles) ?? {});
  }
  candidates.sort((a, b) => Number(b.freq) - Number(a.freq)
    || Number(asRec(loaded[str(a.bs)])?.total_verses ?? Number.MAX_SAFE_INTEGER) - Number(asRec(loaded[str(b.bs)])?.total_verses ?? Number.MAX_SAFE_INTEGER)
    || str(a.bs).localeCompare(str(b.bs)));
  packet.profiles = Object.fromEntries(candidates.filter(c => loaded[str(c.bs)]).slice(0, Number(plan.limit)).map(c => [str(c.bs), loaded[str(c.bs)]]));
  delete packet.profile_plan;
  if (unavailable) packet.profiles_status = 'partial';
  return packet;
}

function parseRealworldFlag(val: unknown): 0 | 1 {
  return val === 1 || val === true ? 1 : 0;
}

function normalizeWordInput(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function extractPrimaryStrong(profile: Rec | null, fallback = ''): string {
  return str(profile?.bs ?? profile?.strongs ?? fallback).toUpperCase();
}

function filterConnectionsForPrimary(
  conns: CompactConnection[],
  primaryStrongs: string,
  targetLimit: number,
  excludeNoiseForHomograph = true,
): CompactConnection[] {
  const out: CompactConnection[] = [];
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  for (const c of conns) {
    if (seenIds.has(c.id)) continue;
    const tKey = c.title.toLowerCase();
    if (seenTitles.has(tKey)) continue;
    if (excludeNoiseForHomograph && primaryStrongs === 'H7307') {
      if (c.id.includes(':H7306:') || /\bH7306\b/i.test(c.title)) continue;
    }
    seenIds.add(c.id);
    seenTitles.add(tKey);
    out.push(c);
    if (out.length >= targetLimit) break;
  }
  return out;
}

function buildProfileDerivedConnections(profile: Rec, limit: number): CompactConnection[] {
  const bs = extractPrimaryStrong(profile);
  const sc = str(profile.sc);
  const gl = str(profile.gl);
  const out: CompactConnection[] = [];
  const greekSource = bs.startsWith('G');

  for (const rawLxx of asArr(profile.lxx_relations)) {
    if (out.length >= 3) break;
    const lx = asRec(rawLxx);
    if (!lx) continue;
    const tBs = str(lx.target_strongs);
    const tSc = str(lx.script);
    const tGl = str(lx.gloss);
    const cnt = typeof lx.count === 'number' ? lx.count : 0;
    if (!tSc && !tBs) continue;
    if (isLxxFunctionEquivalent(tBs, tSc)) continue;
    out.push({
      id: `lxx:${bs}:${tBs || tSc}`,
      relation: 'lxx_translation_bridge',
      epistemic: 'documented_cross_language_bridge',
      tier: 3,
      title: greekSource && tBs.startsWith('H')
        ? `LXX bridge: Hebrew ${tSc || tBs} (${tBs}${tGl ? `, "${tGl}"` : ''}) rendered by Greek ${sc || bs} (${bs})`
        : `LXX bridge: ${sc || bs} (${bs}) -> ${tSc} (${tBs}${tGl ? `, "${tGl}"` : ''})`,
      why: greekSource && tBs.startsWith('H')
        ? `Septuagint Greek ${sc || bs} (${bs}) renders Hebrew ${tSc || tBs} (${tBs})${cnt > 0 ? ` in ${cnt} passage(s)` : ''}.`
        : cnt > 0
          ? `Septuagint renders ${sc || bs} as ${tSc}${tGl ? ` ("${tGl}")` : ''} across ${cnt} passage(s).`
          : `Attested Septuagint correspondence ${sc || bs} -> ${tSc}.`,
      refs: [],
      target: { strongs: tBs || undefined, script: tSc, gloss: tGl },
    });
  }

  const extractScriptConsSet = (s: string): Set<string> => {
    const first = String(s || '').split(/[,;/]/)[0] || '';
    return new Set(
      [...first.normalize('NFD')]
        .filter(ch => {
          const cp = ch.codePointAt(0) || 0;
          return (cp >= 0x05d0 && cp <= 0x05ea) || (cp >= 0x03b1 && cp <= 0x03c9) || (cp >= 0x0391 && cp <= 0x03a9);
        })
        .map(c => c.toLowerCase()),
    );
  };
  const srcConsSet = extractScriptConsSet(sc);
  const sampleProfileRefs = asArr(profile.first_occ_passages)
    .map(asRec)
    .map(p => str(p?.ref))
    .filter(Boolean)
    .slice(0, 2);

  for (const rawLex of asArr(profile.lexical_relations).slice(0, 6)) {
    const lr = asRec(rawLex);
    if (!lr) continue;
    const tBs = padStrongsToken(str(lr.target_strongs));
    const tSc = str(lr.script);
    const tGl = str(lr.gloss);
    const kind = str(lr.type, 'lexical_relation');
    if (kind === 'shared_name_base' || kind === 'group_member_of') continue;
    if (kind === 'shares_root' && bs && tBs && bs[0] !== tBs[0]) continue;
    if (kind === 'shares_root' && bs && tBs && bs[0] === tBs[0]) {
      const tgtConsSet = extractScriptConsSet(tSc);
      if (srcConsSet.size > 0 && tgtConsSet.size > 0) {
        const sharedCount = [...tgtConsSet].filter(c => srcConsSet.has(c)).length;
        if (sharedCount < 2) continue;
      }
    }
    out.push({
      id: `lex:${bs}:${tBs || tSc}`,
      relation: kind,
      epistemic: 'documented_lexical_relationship',
      tier: 3,
      title: str(lr.label, `Lexical relation (${kind}): ${sc || bs} <-> ${tSc || tBs} ${tGl ? `("${tGl}")` : ''}`),
      why: lr.root ? `Shares documented root ${str(lr.root)} (${kind}).` : `Documented lexical link (${kind}).`,
      refs: sampleProfileRefs,
      target: { strongs: tBs || undefined, script: tSc || undefined, gloss: tGl },
    });
  }

  for (const rawGram of asArr(profile.grammatical_relations).slice(0, 4)) {
    const gr = asRec(rawGram);
    if (!gr) continue;
    const rBs = str(gr.related_strongs);
    if (isFunctionWord({ strongs: rBs })) continue;
    const rSc = str(gr.related_script);
    const rGl = str(gr.related_gloss);
    const pred = str(gr.predicate, 'grammatical_relation');
    const occ = typeof gr.occurrences === 'number' ? gr.occurrences : 0;
    out.push({
      id: `gram:${bs}:${pred}:${rBs}`,
      relation: pred,
      epistemic: 'documented_lexical_relationship',
      tier: 3,
      title: `${str(gr.display_label, pred)}: ${sc || bs} <-> ${rSc || rBs} ("${rGl}", ${occ}x)`,
      why: `R8 grammatical relation (${pred}) attested ${occ} time(s) with ${rSc || rBs} (${rGl}).`,
      refs: [],
      target: { strongs: rBs || undefined, script: rSc || undefined, gloss: rGl },
    });
  }

  for (const rawBridge of asArr(profile.pilot_bridges).slice(0, 2)) {
    const br = asRec(rawBridge);
    if (!br) continue;
    const prop = str(br.property_key);
    const val = str(br.value_label);
    const tBs = str(br.target_strongs);
    const tGl = str(br.target_gloss);
    if (!prop && !val) continue;
    out.push({
      id: `prop:${bs}:${prop}:${tBs || val}`,
      relation: str(br.bridge_kind, 'shared_external_property'),
      epistemic: 'external_world_bridge',
      tier: 6,
      title: `External property (${prop}=${val}): ${gl || bs}${tBs ? ` <-> ${tBs} ("${tGl}")` : ''}`,
      why: `External conceptual/physical property (${str(br.source, 'OEWN/Wikidata')}); not an independent textual citation.`,
      refs: [],
      ...(tBs ? { target: { strongs: tBs, gloss: tGl } } : {}),
      uncertainty: 'External property overlap requires separate textual witnesses.',
    });
  }

  return out.slice(0, limit);
}

const XREF_TRIVIAL_PHRASE_RE = /^(?:then|this\s+is|and|for|so|but|now|therefore|behold|or|that|in|on|at|to|of|the|a|an|it|is|was|were|he|she|they|we|you|i)$/i;

function buildXrefConnection(fromRef: string, fromVid: number, rawXr: unknown, concise = false): CompactConnection | null {
  let targetVid = 0;
  let targetRef = '';
  let phrase = '';
  let votes = 0;
  let flags = 0;
  if (Array.isArray(rawXr)) {
    targetVid = Number(rawXr[0] || 0);
    targetRef = str(rawXr[1]);
    phrase = str(rawXr[2]);
    flags = Number(rawXr[3] || 0);
  } else {
    const obj = asRec(rawXr);
    if (!obj) return null;
    targetVid = Number(obj.target_vid ?? obj.vid ?? 0);
    targetRef = str(obj.ref ?? obj.target_ref);
    phrase = str(obj.phrase ?? obj.snippet);
    flags = Number(obj.flags ?? 0);
    votes = obj.flags === undefined && typeof obj.votes === 'number' ? Number(obj.votes) : 0;
  }
  if (!targetRef) return null;
  if (XREF_TRIVIAL_PHRASE_RE.test(phrase.trim())) phrase = '';
  const fromOt = fromVid <= 23213;
  const toNt = targetVid > 23213;
  const isCrossTestament = (fromOt && toNt) || (!fromOt && targetVid > 0 && !toNt);
  const reciprocal = Boolean(flags & 1);
  const flagNote = reciprocal ? 'mutual link' : '';
  if (concise) {
    return {
      id: `r11:xref:${fromVid}:${targetVid}`,
      relation: isCrossTestament ? 'cross_testament_reference' : 'cross_reference',
      epistemic: 'editorial_cross_reference',
      tier: 4,
      title: `${targetRef}${phrase ? ` ("${phrase}")` : ''}`,
      why: `${isCrossTestament ? 'OT/NT x' : 'X'}ref${flagNote ? `, ${flagNote}` : votes > 0 ? `, ${votes} votes` : ''}`,
      refs: [targetRef],
    };
  }
  const detailSuffix = flagNote
    ? ` (${flagNote})`
    : votes > 0
      ? ` (${votes} witness votes)`
      : '';
  return {
    id: `r11:xref:${fromVid}:${targetVid}`,
    relation: isCrossTestament ? 'cross_testament_reference' : 'cross_reference',
    epistemic: 'editorial_cross_reference',
    tier: 4,
    title: `${fromRef} -> ${targetRef}${phrase ? ` ("${phrase}")` : ''}`,
    why: `${isCrossTestament ? 'Cross-testament ' : ''}CrossReferences.org link${detailSuffix}${phrase ? ` around "${phrase}"` : ''}.`,
    refs: [fromRef, targetRef],
  };
}

function buildRareWordHighlights(
  verse: Rec,
  profiles: Record<string, Rec>,
): CompactConnection[] {
  const ref = str(verse.ref);
  const tokens = asArr(verse.tokens).map(asRec).filter((t): t is Rec => t !== null);
  const highlights: CompactConnection[] = [];
  const seenBs = new Set<string>();

  for (const tok of tokens) {
    const bs = str(tok.strongs).toUpperCase();
    if (!bs || seenBs.has(bs) || isFunctionWord({ pos_class: str(tok.pos_class), strongs: bs })) continue;
    seenBs.add(bs);
    const prof = asRec(profiles[bs]);
    if (!prof) continue;

    const total = typeof prof.total_verses === 'number' ? prof.total_verses : 0;
    const sc = str(prof.sc, str(tok.lemma));
    const tr = cleanTransliteration(str(prof.tr), sc);
    const gl = str(prof.gl, str(tok.gloss));
    const lxx = asArr(prof.lxx_relations)
      .map(asRec)
      .filter((x): x is Rec => x !== null && !isLxxFunctionEquivalent(str(x.target_strongs), str(x.script)));
    const firstOcc = asArr(prof.first_occ_passages).map(asRec).filter((x): x is Rec => x !== null);
    const firstRef = str(firstOcc[0]?.ref);

    if (total === 1) {
      highlights.push({
        id: `rare:hapax:${bs}`,
        relation: 'hapax_legomenon',
        epistemic: 'documented_lexical_relationship',
        tier: 3,
        title: `Unique corpus word: ${sc} (${tr}, ${bs}) "${gl}"`,
        why: `${bs} appears in only 1 canonical verse (${ref}), making it a lexical hapax.`,
        refs: [ref],
        target: { strongs: bs, script: sc, transliteration: tr, gloss: gl },
      });
    } else if (lxx.length > 0 && total <= 80) {
      const topLxx = lxx[0];
      const lxxSc = str(topLxx.script);
      const lxxBs = str(topLxx.target_strongs);
      const lxxGl = str(topLxx.gloss);
      const lxxCnt = typeof topLxx.count === 'number' ? topLxx.count : 0;
      const otherRefs = firstOcc.map(f => str(f.ref)).filter(r => r && r !== ref).slice(0, 2);
      highlights.push({
        id: `lxx_highlight:${bs}:${lxxBs || lxxSc}`,
        relation: 'distinctive_lxx_bridge',
        epistemic: 'documented_cross_language_bridge',
        tier: 3,
        title: `${sc} (${tr}, ${bs}, ${total}v) -> LXX ${lxxSc} (${lxxBs}, "${lxxGl}")`,
        why: `Distinctive word (${total} verses) rendered by LXX as ${lxxSc}${lxxGl ? ` ("${lxxGl}")` : ''}${lxxCnt ? ` (${lxxCnt}x)` : ''}${firstRef === ref ? '; first biblical occurrence here' : ''}.`,
        refs: [ref, ...otherRefs],
        target: { strongs: lxxBs || bs, script: lxxSc, gloss: lxxGl },
      });
    } else if (firstRef === ref && total > 1 && total <= 150) {
      const clusters = asArr(prof.clusters).map(asRec).filter((c): c is Rec => c !== null);
      const topCluster = str(clusters[0]?.label);
      highlights.push({
        id: `first_occ:${bs}:${verse.verse_id}`,
        relation: 'first_biblical_occurrence',
        epistemic: 'documented_lexical_relationship',
        tier: 3,
        title: `First occurrence of ${sc} (${tr}, ${bs}, ${total}v) "${gl}"`,
        why: `First attested here in ${ref}; occurs in ${total} canonical verses${topCluster ? ` (e.g. ${topCluster})` : ''}.`,
        refs: [ref],
        target: { strongs: bs, script: sc, transliteration: tr, gloss: gl },
      });
    }
  }
  return highlights;
}

function padStrongsToken(raw: string): string {
  const m = /^([HG])0*(\d+)([A-Z]*)$/i.exec(raw.trim());
  return m ? `${m[1].toUpperCase()}${m[2].padStart(4, '0')}` : raw.trim().toUpperCase();
}

function hasHebrewNiqqud(raw: string): boolean {
  return /[\u05B0-\u05C7]/.test(raw);
}

function normalizeHebrewPointed(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\u0591-\u05AF\u05AB\u05BC\u05BD\u05BF\u05C0\u05C3-\u05C6]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildGreekTranslitVariants(raw: string): string[] {
  const q = raw.trim().toLowerCase();
  if (!/^[a-z\s\-']+$/.test(q) || q.length < 3) return [];
  const variants = new Set<string>();
  const add = (v: string) => { if (v && v !== q) variants.add(v); };
  if (q.includes('y')) add(q.replace(/y/g, 'u'));
  if (q.includes('u')) add(q.replace(/u/g, 'y'));
  if (q.includes('ch')) add(q.replace(/ch/g, 'kh'));
  if (q.includes('kh')) add(q.replace(/kh/g, 'ch'));
  if (q.includes('ph')) add(q.replace(/ph/g, 'f'));
  if (q.includes('oo')) add(q.replace(/oo/g, 'o'));
  if (q.includes('ou')) add(q.replace(/ou/g, 'u'));
  if (q.includes('ei')) add(q.replace(/ei/g, 'i'));
  if (q.includes('y') && q.includes('oo')) add(q.replace(/y/g, 'u').replace(/oo/g, 'o'));
  return [...variants].slice(0, 6);
}

async function resolveWordCandidate(
  read: DatabaseReader,
  wordQuery: string,
  passageHint?: string,
): Promise<{
  primary: Rec | null;
  ambiguous: Rec[];
  anchoredToken: Rec | null;
  anchoredWordRow: Rec | null;
  anchoredPassageRef: string | null;
  warnings: string[];
}> {
  let anchoredToken: Rec | null = null;
  let anchoredWordRow: Rec | null = null;
  let anchoredPassageRef: string | null = null;
  let lookupQuery = normalizeWordInput(wordQuery);
  const warnings: string[] = [];

  if (passageHint) {
    const parsed = parsePassageString(passageHint);
    if (parsed) {
      const compact = await safeCallFirst(read, 'get_passage_compact_v1', {
        passages: parsed.passages.slice(0, 1),
        max_verses: 5,
        offset: 0,
        include_profiles: false,
      });
      if (!compact) warnings.push(`Passage context lookup unavailable for "${passageHint}".`);
      const v0 = asArr(compact?.verses).map(asRec).find(Boolean);
      anchoredPassageRef = v0 ? str(v0.ref, parsed.normalized) : parsed.normalized;
      const tokens = asArr(v0?.tokens).map(asRec).filter((t): t is Rec => t !== null);
      const qTrim = lookupQuery.trim();
      const qLower = qTrim.toLowerCase();
      const qBase = /^[HG]0*\d+[A-Z]*$/i.test(qTrim) ? padStrongsToken(qTrim) : '';
      const qExt = /^[HG]0*\d+[A-Z]+$/i.test(qTrim) ? `lemma:${qTrim.toUpperCase()}` : '';
      anchoredToken =
        tokens.find(t => {
          const lk = str(t.lemma_key).toUpperCase();
          const bs = str(t.strongs).toUpperCase();
          const sf = str(t.surface);
          const lm = str(t.lemma);
          const gl = str(t.gloss).toLowerCase();
          const tr = str(t.tr).toLowerCase();
          return (qExt && lk === qExt) ||
            (qBase && bs === qBase) ||
            sf === qTrim ||
            lm === qTrim ||
            tr === qLower ||
            gl === qLower;
        }) ??
        tokens.find(t => {
          const gl = str(t.gloss).toLowerCase();
          return qLower.length >= 2 && new RegExp(`(^|[^a-z])${qLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(gl);
        }) ??
        tokens.find(t => str(t.gloss).toLowerCase().includes(qLower)) ??
        null;
      if (anchoredToken) {
        const wid = Number(anchoredToken.word_id);
        if (Number.isInteger(wid) && wid > 0) {
          const wRows = await callRpc(read, 'get_words_batch', { word_ids: [wid] }, 1, 0).catch(() => []);
          const candidateRow = asRec(wRows[0]);
          anchoredWordRow = verifyWordRowAlignment(anchoredToken, candidateRow) ? candidateRow : null;
          if (anchoredWordRow) anchoredToken = { ...anchoredToken, tr: anchoredWordRow.transliteration, code: anchoredWordRow.grammar_code };
        }
        const tokStrongs = str(anchoredToken.strongs);
        if (tokStrongs) lookupQuery = tokStrongs;
      }
    }
  }

  let lookupRes: Rec | null = null;
  try {
    const rows = await callRpc(read, 'resolve_fast_lookup_v1', { query: lookupQuery, limit: 15 }, 1, 0);
    lookupRes = asRec(rows[0]);
  } catch {
    warnings.push(`Lexical fast lookup unavailable for "${lookupQuery}".`);
  }
  let matches = asArr(lookupRes?.matches).map(asRec).filter((m): m is Rec => m !== null);
  if (matches.length === 0) {
    for (const variant of buildGreekTranslitVariants(lookupQuery)) {
      try {
        const vRows = await callRpc(read, 'resolve_fast_lookup_v1', { query: variant, limit: 10 }, 1, 0);
        const vMatches = asArr(asRec(vRows[0])?.matches).map(asRec).filter((m): m is Rec => m !== null);
        if (vMatches.length > 0) {
          matches = vMatches;
          break;
        }
      } catch { /* try next transliteration variant */ }
    }
  }
  if (matches.length > 1 && hasHebrewNiqqud(lookupQuery)) {
    const targetPointed = normalizeHebrewPointed(lookupQuery);
    const exactPointed: Rec[] = [];
    const rest: Rec[] = [];
    for (const m of matches) {
      if (normalizeHebrewPointed(str(m.sc)) === targetPointed) exactPointed.push(m);
      else rest.push(m);
    }
    if (exactPointed.length > 0) matches = [...exactPointed, ...rest];
  }
  const primary = matches[0] ?? null;
  const ambiguous = matches.slice(1, 11);
  return { primary, ambiguous, anchoredToken, anchoredWordRow, anchoredPassageRef, warnings };
}

async function fetchWordDetailsRow(read: DatabaseReader, strongs: string): Promise<{ wordId: number | null; wordRow: Rec | null }> {
  try {
    const resolved = await safeCallFirst(read, 'resolve_word_id', { p_query: strongs });
    const wid = Number(resolved?.word_id);
    if (!Number.isInteger(wid) || wid <= 0) return { wordId: null, wordRow: null };
    const details = await safeCallFirst(read, 'get_word_details', { word_id: wid });
    return { wordId: wid, wordRow: details };
  } catch {
    return { wordId: null, wordRow: null };
  }
}

const WORD_QUERY_STOPWORDS = new Set([
  'the', 'and', 'of', 'in', 'to', 'for', 'a', 'an', 'on', 'with', 'by', 'from', 'as', 'at', 'or',
]);

export async function buildFullCompactWord(
  read: DatabaseReader,
  wordQuery: string,
  options: { connections: number; etymology: number; realworld: 0 | 1; passage?: string; mode?: 'discover' | 'bridge' },
): Promise<{
  status: 'ok' | 'partial' | 'not_found';
  discovery_status: 'ok' | 'partial' | 'unavailable' | 'not_requested';
  coverage: Record<string, unknown>;
  warnings: string[];
  anchored_occurrence?: Rec;
  word: CompactWord | null;
  profile: Rec | null;
  wordId: number | null;
  grammarForms: Rec[];
  occurrences: Rec;
  ambiguousCandidates: Rec[];
}> {
  const { primary, ambiguous, anchoredToken, anchoredWordRow, anchoredPassageRef, warnings } = await resolveWordCandidate(
    read,
    wordQuery,
    options.passage,
  );
  if (!primary) {
    return {
      status: warnings.length > 0 ? 'partial' : 'not_found',
      discovery_status: warnings.length > 0 ? 'unavailable' : 'ok',
      coverage: { profile: 'unavailable', discovery: 'not_requested' },
      warnings,
      word: null,
      profile: null,
      wordId: null,
      grammarForms: [],
      occurrences: { total_verses: 0, clusters: [], samples: [] },
      ambiguousCandidates: [],
    };
  }

  const bs = extractPrimaryStrong(primary);
  const trimmedWordQuery = wordQuery.trim();
  const isStrongsCode = /^[HG]\d{1,5}[A-Z]?$/i.test(trimmedWordQuery);
  const extStrongsMatch = /^([HG])0*(\d+)([A-Z]+)$/i.exec(trimmedWordQuery);
  const explicitExtendedCode = extStrongsMatch
    ? `${extStrongsMatch[1].toUpperCase()}${extStrongsMatch[2].padStart(4, '0')}${extStrongsMatch[3].toUpperCase()}`
    : '';
  const explicitLemmaKey = explicitExtendedCode ? `lemma:${explicitExtendedCode}` : '';
  const nonStopTerms = wordQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !WORD_QUERY_STOPWORDS.has(t));
  const isMultiConceptWordQuery = !isStrongsCode && !options.passage && nonStopTerms.length >= 2;
  const anchorLemmaKey = anchoredToken ? str(anchoredToken.lemma_key) : explicitLemmaKey;
  const anchorExtendedStrongs = anchorLemmaKey ? anchorLemmaKey.replace(/^lemma:/i, '') : explicitExtendedCode;

  const [batchRes, wordDetailsRes, discRes] = await Promise.all([
    callRpc(read, 'get_word_profiles_batch_v1', {
      strongs: [bs],
      include_vids: false,
      include_forms: true,
      include_orth: true,
      include_pilot: true,
    }, 1, 0).then(rows => asRec(rows[0])).catch(() => {
      warnings.push(`Word profile lookup unavailable for ${bs}.`);
      return null;
    }),
    anchoredWordRow
      ? Promise.resolve({ wordId: Number(anchoredToken?.word_id || 0) || null, wordRow: anchoredWordRow })
      : withTimeout(fetchWordDetailsRow(read, bs), 2500, { wordId: null, wordRow: null }),
    options.connections > 0
      ? callRpc(read, 'discover_biblical_connections_v2', {
          query: isMultiConceptWordQuery ? wordQuery : bs,
          ...(isMultiConceptWordQuery ? {} : { focus_lemma: bs }),
          ...(anchorLemmaKey ? { anchor_lemma_key: anchorLemmaKey } : {}),
          ...(anchorExtendedStrongs ? { anchor_extended_strongs: anchorExtendedStrongs } : {}),
          ...(anchoredPassageRef ? { anchor_passage: anchoredPassageRef } : {}),
          ...(options.mode ? { mode: options.mode } : {}),
          limit: Math.min(25, Math.max(options.connections * 2, 12)),
        }, 1, 0).then(rows => asRec(rows[0])).catch(() => {
          warnings.push(`Discovery connection lookup unavailable for "${wordQuery}"; returning profile-only links.`);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const discFailed = options.connections > 0 && (!discRes || discRes.status === 'error');
  if (discRes && discRes.status === 'error' && discRes.error) {
    warnings.push(String(discRes.error));
  }
  const discoveryStatus: 'ok' | 'partial' | 'unavailable' | 'not_requested' =
    options.connections <= 0
      ? 'not_requested'
      : discFailed
        ? 'unavailable'
        : discRes?.status === 'partial'
          ? 'partial'
          : 'ok';

  const profilesMap = asRec(batchRes?.profiles);
  const rawFullProfile = asRec(profilesMap?.[bs]) ?? primary;
  const matchedExplicitSense = (!anchoredToken && explicitLemmaKey)
    ? asArr(rawFullProfile.senses).map(asRec).find(s =>
        str(s?.key ?? s?.lk).toLowerCase() === explicitLemmaKey.toLowerCase(),
      )
    : undefined;
  const fullProfile = matchedExplicitSense
    ? {
        ...rawFullProfile,
        lk: str(matchedExplicitSense.key ?? matchedExplicitSense.lk, explicitLemmaKey),
        gl: str(matchedExplicitSense.gl ?? matchedExplicitSense.gloss, str(rawFullProfile.gl)),
        ...(matchedExplicitSense.sc ? { sc: matchedExplicitSense.sc } : {}),
        ...(matchedExplicitSense.tr ? { tr: matchedExplicitSense.tr } : {}),
      }
    : rawFullProfile;
  const wordId = wordDetailsRes.wordId;
  const wordRow = wordDetailsRes.wordRow;

  const [etymologyData, realworldData, wordNotesRaw] = await Promise.all([
    options.etymology > 0 ? buildWordEtymology(read, bs, fullProfile, options.etymology,
      (anchoredToken || explicitLemmaKey) ? { activeLemmaKey: anchoredToken ? str(anchoredToken.lemma_key) : explicitLemmaKey, wordId } : {}) : Promise.resolve(null),
    options.realworld === 1
      ? withTimeout(buildWordRealworld(read, bs, str(fullProfile.gl), wordRow, fullProfile), 2500, { status: 'unavailable', sources: [] })
      : Promise.resolve(null),
    wordId
      ? withTimeout(
          safeCallFirst(read, 'get_notes_for_word_v1', {
            p_word_id: wordId,
            p_verse_id: null,
            p_word_position: null,
            p_limit: 5,
          }),
          2500,
          null,
        )
      : Promise.resolve(null),
  ]);

  const rawDiscConns = asArr(discRes?.strongest_connections ?? discRes?.connections)
    .map(asRec)
    .filter((c): c is Rec => c !== null)
    .map(normalizeDiscoveryConnection)
    .filter((c): c is CompactConnection => c !== null);

  const profileConns = options.connections > 0 ? buildProfileDerivedConnections(fullProfile, 10) : [];
  const mergedConns = options.connections > 0
    ? filterConnectionsForPrimary([...rawDiscConns, ...profileConns], bs, options.connections, true)
    : [];

  const compactNotes: Rec[] = [];
  if (wordNotesRaw) {
    const groups = asRec(wordNotesRaw.groups);
    for (const grpKey of ['occurrence', 'form', 'lemma']) {
      for (const n of asArr(groups?.[grpKey]).slice(0, 3)) {
        const rec = asRec(n);
        if (rec) compactNotes.push(formatCompactNote(rec));
      }
    }
  }

  const sc = anchoredToken ? str(anchoredToken.lemma) : str(fullProfile.sc);
  const gematria = sc ? computeGematria(sc, 'standard_lemma_script') : null;

  const samples = asArr(fullProfile.first_occ_passages)
    .map(asRec)
    .filter((s): s is Rec => s !== null)
    .map(s => ({
      ref: str(s.ref),
      ...(s.snippet ? { snippet: str(s.snippet).slice(0, 180) } : {}),
    }))
    .filter(s => s.ref);

  const homographs = asArr(fullProfile.homograph_siblings)
    .map(asRec)
    .filter((h): h is Rec => h !== null)
    .map(h => ({
      strongs: str(h.bs),
      script: str(h.sc),
      transliteration: cleanTransliteration(str(h.tr), str(h.sc)),
      gloss: str(h.gl),
      note: 'Homograph or consonantally related sibling',
    }));

  const otherAmbig = ambiguous
    .filter(a => str(a.bs) !== bs)
    .map(a => ({
      strongs: str(a.bs),
      script: str(a.sc),
      transliteration: cleanTransliteration(str(a.tr), str(a.sc)),
      gloss: str(a.gl),
      total_verses: typeof a.total_verses === 'number' ? a.total_verses : 0,
    }));

  const ambSeen = new Set<string>();
  const ambiguousCandidates: Rec[] = [];
  for (const item of [...homographs, ...otherAmbig]) {
    const key = str(item.strongs);
    if (!key || ambSeen.has(key)) continue;
    ambSeen.add(key);
    ambiguousCandidates.push(item);
    if (ambiguousCandidates.length >= 10) break;
  }

  const compactWord = compactWordFromData({
    token: anchoredToken,
    profile: fullProfile,
    wordRow,
    etymology: etymologyData,
    realworld: realworldData,
    notes: compactNotes,
    connections: mergedConns,
    gematria,
    etymologyDepth: options.etymology,
    realworldDepth: options.realworld,
    wordDepth: options.connections,
  });

  const grammarForms = asArr(fullProfile.forms)
    .map(asRec)
    .filter((f): f is Rec => f !== null)
    .slice(0, 8)
    .map(f => ({
      form: str(f.sf),
      transliteration: cleanTransliteration(str(f.tr), str(f.sf)),
      gloss: str(f.gl),
      code: str(f.mc),
      count: typeof f.cnt === 'number' ? f.cnt : 0,
    }));

  const isSanctuaryGlossary = /temple|sanctuary|tabernacle|altar|ark|lampstand|menorah|cherub|curtain|veil|holy|priest|incense|showbread|mercy|cubit|court|brazen|gold|sacred|anoint|offering|sacrifice|lamp|oil|olive/i.test(str(fullProfile.gl));
  const clusters = asArr(fullProfile.clusters)
    .map(asRec)
    .filter((c): c is Rec => c !== null)
    .slice(0, 5)
    .map(c => {
      if (str(c.category) === 'temple_and_sanctuary_architecture' && !isSanctuaryGlossary) {
        return {
          ...c,
          category: 'geographical_and_historical_narrative',
          label: str(c.label).replace(/Temple\s*&\s*Sanctuary Architecture/i, 'Historical & Geographical Narrative'),
        };
      }
      return c;
    });

  return {
    status: warnings.length > 0 || discoveryStatus === 'unavailable' || discoveryStatus === 'partial' ? 'partial' : 'ok',
    discovery_status: discoveryStatus,
    coverage: {
      profile: batchRes ? 'full' : 'lookup_summary_only',
      discovery: discoveryStatus,
      formal_orthographic_preserved: true,
    },
    warnings,
    ...(anchoredToken
      ? {
          anchored_occurrence: {
            ...(anchoredPassageRef ? { passage: anchoredPassageRef } : {}),
            ...(typeof anchoredToken.position === 'number' ? { position: anchoredToken.position } : {}),
            ...(wordId ? { word_id: wordId } : {}),
            strongs: bs,
            ...(anchorLemmaKey ? { lemma_key: anchorLemmaKey } : {}),
            ...(str(anchoredToken.sense_status) ? { sense_status: str(anchoredToken.sense_status) } : {}),
            ...(Array.isArray(anchoredToken.lemma_candidates) && anchoredToken.lemma_candidates.length > 0
              ? { lemma_candidates: anchoredToken.lemma_candidates }
              : {}),
            formal_links_note: 'Occurrence sense is preserved without filtering out formal consonantal or cross-homograph overlaps.',
          },
        }
      : {}),
    word: compactWord,
    profile: fullProfile,
    wordId,
    grammarForms,
    occurrences: {
      total_verses: typeof fullProfile.total_verses === 'number' ? fullProfile.total_verses : 0,
      clusters,
      samples,
    },
    ambiguousCandidates,
  };
}

export async function handleGetPassage(read: DatabaseReader, input: {
  passage: string;
  depth: number;
  word_depth: number;
  etymology: number;
  realworld: 0 | 1;
  literary?: 0 | 1 | 2;
  offset: number;
  limit: number;
  compact?: boolean;
  view?: McpView;
}): Promise<Rec> {
  const parsed = parsePassageString(input.passage);
  if (!parsed) {
    return {
      status: 'invalid_request',
      error: `Could not parse biblical passage reference: "${input.passage}". Examples: "Gen 6:14", "1COR12:10-1COR13:4", "Zechariah 4", "Ps 45:0".`,
    };
  }

  const firstSpan = parsed.passages[0];
  const anchorVerse = firstSpan.start_verse;
  const literaryLevel = input.literary ?? 1;
  const compactFlag = input.compact === true;
  const view = parseMcpView(input.view, compactFlag);
  const expectedSpan = parsed.passages.reduce(
    (sum, sp) => sum + Math.max(1, sp.end_verse - sp.start_verse + 1),
    0,
  );
  const isLargeCluesRange = view === 'clues' && Math.min(expectedSpan, input.limit) > 3;

  const compactPromise = fetchCompactPassage(read, {
    passages: parsed.passages,
    max_verses: input.limit,
    offset: input.offset,
    include_profiles: true,
    profile_limit: isLargeCluesRange ? 12 : 24,
  });

  const geoSampleCoords: Array<{ book: number; chapter: number; verse: number }> = [
    { book: firstSpan.book, chapter: firstSpan.chapter, verse: anchorVerse },
  ];
  const effectiveEndV = Math.min(firstSpan.end_verse, firstSpan.start_verse + Math.max(1, input.limit) - 1);
  if (effectiveEndV > anchorVerse) {
    const midV = Math.floor((anchorVerse + effectiveEndV) / 2);
    if (midV > anchorVerse && midV < effectiveEndV) {
      geoSampleCoords.push({ book: firstSpan.book, chapter: firstSpan.chapter, verse: midV });
    }
    geoSampleCoords.push({ book: firstSpan.book, chapter: firstSpan.chapter, verse: effectiveEndV });
  } else if (parsed.passages.length > 1) {
    const lastSpan = parsed.passages[parsed.passages.length - 1];
    geoSampleCoords.push({ book: lastSpan.book, chapter: lastSpan.chapter, verse: lastSpan.end_verse });
  }
  const geoPromise = withTimeout(
    Promise.all(
      geoSampleCoords.slice(0, 3).map(coord =>
        safeCallFirst(read, 'get_verse_geography', {
          p_book: coord.book,
          p_chapter: coord.chapter,
          p_verse: coord.verse,
        }).catch(() => null),
      ),
    ).then(results => {
      const mergedLocations: unknown[] = [];
      const seenPlaceKeys = new Set<string>();
      let firstRaw: Rec | null = null;
      for (const r of results) {
        if (!r) continue;
        if (!firstRaw) firstRaw = r;
        for (const loc of asArr(r.locations)) {
          const rec = asRec(loc);
          const pk = rec ? str(rec.place_key, str(rec.biblical_name, str(rec.place))) : '';
          if (pk && !seenPlaceKeys.has(pk)) {
            seenPlaceKeys.add(pk);
            mergedLocations.push(loc);
          }
        }
      }
      return firstRaw ? { ...firstRaw, locations: mergedLocations } : null;
    }),
    2500,
    null,
  );

  const chronPromise = withTimeout(
    safeCallFirst(read, 'get_verse_chronology_v1', {
      p_book: firstSpan.book,
      p_chapter: firstSpan.chapter,
      p_verse: anchorVerse,
    }),
    2500,
    null,
  );

  const notesPromise = withTimeout(
    Promise.all(
      parsed.passages.slice(0, 3).map(sp =>
        safeCallFirst(read, 'get_notes_for_passage_v1', {
          p_book: sp.book,
          p_chapter: sp.chapter,
          p_verse_start: sp.start_verse,
          p_verse_end: Math.min(sp.end_verse, sp.start_verse + 49),
          p_author_kind: null,
          p_note_kind: null,
          p_limit: 20,
        }),
      ),
    ),
    2500,
    [] as Array<Rec | null>,
  );

  const literaryPromise = literaryLevel > 0
    ? withTimeout(
        runLiteraryStructureMcp(read, {
          passage: parsed.normalized,
          passages: parsed.passages,
          detail: literaryLevel === 2 && view !== 'clues' ? 'standard' : 'compact',
          compare_lxx: false,
          include_alternatives: literaryLevel === 2 && view !== 'clues',
        }).catch(() => null),
        3000,
        null,
      )
    : Promise.resolve(null);

  const [compact, rawGeo, rawChron, noteBatches, literarySummary] = await Promise.all([
    compactPromise,
    geoPromise,
    chronPromise,
    notesPromise,
    literaryPromise,
  ]);

  if (!compact || compact.status !== 'ok') {
    return {
      status: 'not_found',
      passage: parsed.normalized,
      error: 'Passage data temporarily unavailable or outside canonical range.',
    };
  }

  const versesRaw = asArr(compact.verses).map(asRec).filter((v): v is Rec => v !== null);
  const profiles = asRec(compact.profiles) ?? {};

  // Collect word IDs and anchor verse IDs for translit/grammar/chronology enrichment
  const wordIdSet = new Set<number>();
  for (const v of versesRaw) {
    for (const rawT of asArr(v.tokens)) {
      const t = asRec(rawT);
      const wid = Number(t?.word_id);
      if (Number.isInteger(wid) && wid > 0) wordIdSet.add(wid);
    }
  }
  const anchorVids = [...new Set([
    Number(versesRaw[0]?.verse_id || 0),
    Number(versesRaw[versesRaw.length - 1]?.verse_id || 0),
  ].filter(n => n > 0))];

  const skipWordDetailsBatch = view === 'clues'
    && !compactFlag
    && input.etymology === 0
    && input.realworld === 0
    && input.word_depth === 0;

  // Pass the full passage (or current page span) to R13 discovery so connections reflect the entire passage rather than verse 1 alone.
  const anchorVerseRefs: string[] = [];
  if (input.depth > 0 && versesRaw.length > 0) {
    const firstV = versesRaw[0];
    const lastV = versesRaw[versesRaw.length - 1];
    const firstRef = str(firstV?.ref);
    const lastVerseNr = Number(lastV?.verse);
    const totalInRange = Number(compact.pagination?.total_verses ?? versesRaw.length);
    let rangeRef = parsed.normalized;
    if (versesRaw.length < totalInRange && firstRef) {
      rangeRef = Number(firstV?.chapter) === Number(lastV?.chapter) && Number(firstV?.book) === Number(lastV?.book) && Number.isInteger(lastVerseNr) && lastVerseNr > Number(firstV?.verse)
        ? `${firstRef}-${lastVerseNr}`
        : `${firstRef}..${str(lastV?.ref) || ''}`;
    }
    if (rangeRef) anchorVerseRefs.push(rangeRef);
  }

  const discoveryLimit = view === 'clues' && versesRaw.length > 3
    ? Math.min(12, Math.max(input.depth * 2, 6))
    : Math.min(25, Math.max(input.depth, 15));

  const [wordRows, chronBatch, ...discPages] = await Promise.all([
    !skipWordDetailsBatch && wordIdSet.size > 0
      ? withTimeout(
          callRpc(read, 'get_words_batch', { word_ids: [...wordIdSet] }, wordIdSet.size, 0).catch(() => []),
          2500,
          [] as Rec[],
        )
      : Promise.resolve([]),
    anchorVids.length > 0
      ? withTimeout(
          safeCallFirst(read, 'query_chronology_assertions_batch', { verse_ids: anchorVids }),
          2500,
          null,
        )
      : Promise.resolve(null),
    ...anchorVerseRefs.map(ref =>
      withTimeout(
        safeCallFirst(read, 'discover_biblical_connections_v2', {
          query: ref,
          limit: discoveryLimit,
        }),
        4000,
        null,
      ),
    ),
  ]);

  const wordById = new Map<number, Rec>();
  for (const wr of wordRows) {
    const wid = Number(wr.id);
    if (Number.isInteger(wid) && wid > 0) wordById.set(wid, wr);
  }

  // Group notes by verse_id and verse ref
  const notesByVerseId = new Map<number, Rec[]>();
  const notesByRef = new Map<string, Rec[]>();
  for (const nb of noteBatches) {
    if (!nb) continue;
    for (const n of asArr(nb.primary)) {
      const nRec = asRec(n);
      if (!nRec) continue;
      const compactNote = formatCompactNote(nRec);
      for (const anc of compactNote.anchors) {
        if (typeof anc.verse_id === 'number' && anc.verse_id > 0) {
          const vList = notesByVerseId.get(anc.verse_id) ?? [];
          if (!vList.some(x => x.id === compactNote.id)) vList.push(compactNote);
          notesByVerseId.set(anc.verse_id, vList);
        }
        if (anc.label) {
          const list = notesByRef.get(anc.label) ?? [];
          if (!list.some(x => x.id === compactNote.id)) list.push(compactNote);
          notesByRef.set(anc.label, list);
        }
      }
    }
  }

  // Build deduplicated shared lexicon keyed by Strong's (plus distinct homograph lemma_key only when multiple senses share a base Strong's)
  const contentStrongsOrder: string[] = [];
  const seenContentStrongs = new Set<string>();
  const sampleTokenByStrongs = new Map<string, Rec>();
  const extraLemmaKeyMap = new Map<string, { bs: string; token: Rec }>();
  for (const v of versesRaw) {
    for (const rawT of asArr(v.tokens)) {
      const t = asRec(rawT);
      if (!t) continue;
      const bs = str(t.strongs).toUpperCase();
      if (!bs) continue;
      const lk = str(t.lemma_key);
      if (!sampleTokenByStrongs.has(bs)) sampleTokenByStrongs.set(bs, t);
      else if (lk && lk !== str(sampleTokenByStrongs.get(bs)?.lemma_key) && !extraLemmaKeyMap.has(lk)) {
        extraLemmaKeyMap.set(lk, { bs, token: t });
      }
      if (!isFunctionWord({ pos_class: str(t.pos_class), strongs: bs }) && !seenContentStrongs.has(bs)) {
        seenContentStrongs.add(bs);
        contentStrongsOrder.push(bs);
      }
    }
  }

  const pickLexiconProfile = (prof: Rec | null, tok: Rec | undefined, bs: string): Rec | null => {
    const lk = tok ? str(tok.lemma_key) : '';
    const tokLemma = tok ? str(tok.lemma) : '';
    const tokPos = tok ? str(tok.pos_class) : '';
    const tokGloss = tok ? str(tok.gloss).replace(/^(?:and|the|a|an|of|to|in|for)\s+/i, '').trim() : '';
    const wid = Number(tok?.word_id || 0);
    const wRow = wid > 0 ? wordById.get(wid) ?? null : null;
    const rowGloss = wRow ? str(wRow.short_gloss) : '';
    if (!prof) {
      return tok
        ? { bs, sc: tokLemma, gl: rowGloss || tokGloss, lk, pos: tokPos }
        : null;
    }
    const profLk = str(prof.lk);
    const senses = asArr(prof.senses).map(asRec).filter((s): s is Rec => s !== null);
    const matchingSense = lk
      ? senses.find(s => str(s.key, str(s.lk)).toLowerCase() === lk.toLowerCase())
      : null;
    const sameSense = !lk || !profLk || lk.toLowerCase() === profLk.toLowerCase();
    const resolvedGloss = matchingSense
      ? str(matchingSense.gl, str(matchingSense.gloss))
      : sameSense
        ? str(prof.gl)
        : (rowGloss || tokGloss || str(prof.gl));
    return {
      ...prof,
      ...(lk ? { lk } : {}),
      ...(tokLemma ? { sc: tokLemma } : {}),
      ...(resolvedGloss ? { gl: resolvedGloss } : {}),
      ...(tokPos ? { pos: tokPos } : {}),
    };
  };

  const enrichTargets = contentStrongsOrder.slice(0, 10);
  const etymByStrongs = new Map<string, CompactWord['etymology']>();
  const rwByStrongs = new Map<string, Rec>();
  if (input.etymology > 0 || input.realworld === 1) {
    // Small batches keep the number of simultaneous upstream requests bounded on long passages.
    for (let i = 0; i < enrichTargets.length; i += 4) {
      await Promise.all(
        enrichTargets.slice(i, i + 4).map(async bs => {
          const prof = asRec(profiles[bs]);
          const tok = sampleTokenByStrongs.get(bs);
          const wid = Number(tok?.word_id || 0);
          const wRow = wid > 0 ? wordById.get(wid) ?? null : null;
          if (input.etymology > 0) {
            etymByStrongs.set(bs, await buildWordEtymology(read, bs, prof, input.etymology, { activeLemmaKey: str(tok?.lemma_key, str(prof?.lk)) }));
          }
          if (input.realworld === 1) {
            rwByStrongs.set(bs, await buildWordRealworld(read, bs, str(prof?.gl), wRow, prof));
          }
        }),
      );
    }
    if (input.realworld === 1) {
      for (const bs of contentStrongsOrder.slice(10)) {
        const prof = asRec(profiles[bs]);
        const tok = sampleTokenByStrongs.get(bs);
        const wid = Number(tok?.word_id || 0);
        const wRow = wid > 0 ? wordById.get(wid) ?? null : null;
        const bridges = asArr(prof?.pilot_bridges ?? asRec(prof?.r12_pilot_anchor)?.property_bridges);
        if (wRow?.biblical_def || wRow?.physical_def || bridges.length > 0) {
          rwByStrongs.set(bs, await buildWordRealworld(read, bs, str(prof?.gl), wRow, prof));
        }
      }
    }
  }

  const lexicon: Record<string, CompactWord> = {};
  for (const bs of contentStrongsOrder) {
    const rawProf = asRec(profiles[bs]);
    const tok = sampleTokenByStrongs.get(bs);
    const prof = pickLexiconProfile(rawProf, tok, bs);
    const wid = Number(tok?.word_id || 0);
    const wRow = wid > 0 ? wordById.get(wid) ?? null : null;
    if (!prof && !tok) continue;
    const perWordConns = input.word_depth > 0 && rawProf
      ? buildProfileDerivedConnections(rawProf, input.word_depth)
      : null;

    // Lexicon entries describe the lexeme, not the first inflected occurrence (those live in verses[].words).
    lexicon[bs] = compactWordFromData({
      token: null,
      profile: prof,
      wordRow: wRow,
      etymology: etymByStrongs.get(bs) ?? null,
      realworld: rwByStrongs.get(bs) ?? null,
      connections: perWordConns,
      etymologyDepth: input.etymology,
      realworldDepth: input.realworld,
      wordDepth: input.word_depth,
    });
  }
  for (const [lk, info] of extraLemmaKeyMap.entries()) {
    if (lexicon[lk] || lexicon[info.bs]?.lemma_key === lk) continue;
    const tok = info.token;
    if (isFunctionWord({ pos_class: str(tok.pos_class), strongs: info.bs })) continue;
    const rawProf = asRec(profiles[info.bs]);
    const prof = pickLexiconProfile(rawProf, tok, info.bs);
    const wid = Number(tok.word_id || 0);
    const wRow = wid > 0 ? wordById.get(wid) ?? null : null;
    lexicon[lk] = compactWordFromData({
      token: null,
      profile: prof,
      wordRow: wRow,
      etymology: etymByStrongs.get(info.bs) ?? null,
      realworld: rwByStrongs.get(info.bs) ?? null,
      connections: null,
      etymologyDepth: input.etymology,
      realworldDepth: input.realworld,
      wordDepth: 0,
    });
  }

  // Build per-verse outputs and accumulate passage-level connections
  const crossTestamentXrefs: CompactConnection[] = [];
  const otherXrefs: CompactConnection[] = [];
  const lexicalHighlights: CompactConnection[] = [];

  const versesOut = versesRaw.map(v => {
    const ref = str(v.ref, formatRef(Number(v.book), Number(v.chapter), Number(v.verse)));
    const vid = Number(v.verse_id || 0);
    const tokens = asArr(v.tokens).map(asRec).filter((t): t is Rec => t !== null);
    const wordsOut = tokens.map(t => {
      const wid = Number(t.word_id);
      const wRow = Number.isInteger(wid) && wid > 0 ? wordById.get(wid) : undefined;
      const bs = str(t.strongs).toUpperCase();
      const prof = bs ? asRec(profiles[bs]) : null;
      const surface = str(t.surface);
      // Transliteration and grammar come only from a lexical row proven to be this exact token.
      const verified = verifyWordRowAlignment(t, wRow);
      const tr = verified ? cleanTransliteration(str(wRow?.transliteration)) : '';
      const code = verified ? str(wRow?.grammar_code) : '';
      const leanMode = input.word_depth === 0 && input.etymology === 0;
      const inLexSameLemma = Boolean(bs && lexicon[bs] && (!str(t.lemma_key) || lexicon[bs].lemma_key === str(t.lemma_key)));
      const lemmaStr = str(t.lemma, str(t.lemma_key) === str(prof?.lk) ? str(prof?.sc) : '');
      const ambigCandidates = Array.isArray(t.lemma_candidates) && t.lemma_candidates.length > 1 ? t.lemma_candidates : null;
      return {
        pos: Number(t.position),
        ...(Number.isInteger(wid) && wid > 0 ? { word_id: wid } : {}),
        form: surface,
        ...(!leanMode || !inLexSameLemma ? (lemmaStr ? { lemma: lemmaStr } : {}) : {}),
        ...(bs ? { strongs: bs } : {}),
        ...((!leanMode || !inLexSameLemma) && str(t.lemma_key) ? { lemma_key: str(t.lemma_key) } : {}),
        ...(str(t.sense_status) && str(t.sense_status) !== 'resolved' ? { sense_status: str(t.sense_status) } : {}),
        ...(ambigCandidates ? { lemma_candidates: ambigCandidates } : {}),
        ...(tr ? { tr } : {}),
        gloss: str(t.gloss, verified ? str(asArr(wRow?.english_translations)[0]) : ''),
        ...(code ? { code } : {}),
        ...(!verified && !leanMode ? { alignment_status: 'partial_source_only' } : {}),
      };
    });

    const vXrefs: CompactConnection[] = [];
    const vXrefsConcise: CompactConnection[] = [];
    for (const rawXr of asArr(v.xrefs)) {
      const xc = buildXrefConnection(ref, vid, rawXr);
      if (!xc) continue;
      const xcc = buildXrefConnection(ref, vid, rawXr, true);
      if (xcc) vXrefsConcise.push(xcc);
      vXrefs.push(xc);
      if (xc.relation === 'cross_testament_reference') crossTestamentXrefs.push(xc);
      else otherXrefs.push(xc);
    }

    const vRare = buildRareWordHighlights(v, profiles as Record<string, Rec>);
    lexicalHighlights.push(...vRare);

    const verseEvents = asArr(v.events).map(asRec).filter((e): e is Rec => e !== null).map(ev => ({
      id: str(ev.event_id),
      title: str(ev.title),
      ...(typeof ev.start_year === 'number' ? { year: ev.start_year } : {}),
    }));

    const verseConns = input.depth > 0
      ? filterConnectionsForPrimary([...vXrefs, ...vRare], '', input.depth, false).map((c) => {
        const display = vXrefsConcise.find(x => x.id === c.id) ?? c;
        if (display.epistemic === 'editorial_cross_reference') {
          return { id: display.id, relation: display.relation, epistemic: display.epistemic, refs: display.refs, title: display.title };
        }
        const { witness: _w, why, ...rest } = display;
        return { ...rest, why: typeof why === 'string' && why.length > 100 ? `${why.slice(0, 97)}...` : why };
      })
      : [];

    const verseNotes = (vid > 0 ? notesByVerseId.get(vid) : undefined)
      ?? notesByRef.get(ref)
      ?? notesByRef.get(`${v.book}:${v.chapter}:${v.verse}`)
      ?? [];

    return {
      ref,
      verse_id: vid,
      ...(v.mt_ref ? { mt_ref: v.mt_ref } : {}),
      original: wordsOut.map(w => w.form).filter(Boolean).join(' '),
      english: str(v.web),
      ...(verseConns.length > 0 ? { verse_connections: verseConns } : {}),
      ...(verseEvents.length > 0 ? { events: verseEvents } : {}),
      words: wordsOut,
      ...(verseNotes.length > 0 ? { notes: verseNotes } : {}),
    };
  });

  // Preserve discover_biblical_connections_v2 ranking as primary (round-robin across anchor pages if multi-verse),
  // then append deduplicated fallback xrefs/highlights for targets not already covered.
  const discPerPage: CompactConnection[][] = [];
  let discoveryPartial = false;
  for (const page of discPages) {
    if (!page) {
      discoveryPartial = true;
      continue;
    }
    const pageConns: CompactConnection[] = [];
    for (const rawC of asArr(page.strongest_connections ?? page.connections)) {
      const rec = asRec(rawC);
      if (!rec) continue;
      const norm = normalizeDiscoveryConnection(rec);
      if (norm && !(norm.relation === 'explicit_comparison' && / · /.test(norm.title))) {
        pageConns.push(norm);
      }
    }
    if (pageConns.length > 0) discPerPage.push(pageConns);
  }
  const discNormalized: CompactConnection[] = [];
  if (discPerPage.length <= 1) {
    if (discPerPage[0]) discNormalized.push(...discPerPage[0]);
  } else {
    const maxPageLen = Math.max(...discPerPage.map(a => a.length));
    for (let i = 0; i < maxPageLen; i++) {
      for (const pageArr of discPerPage) {
        if (i < pageArr.length) discNormalized.push(pageArr[i]);
      }
    }
  }

  const normalizePairRef = (rawRef: string): string =>
    rawRef.trim().toLowerCase().replace(/:\s*(\d+)\s*-\s*\d+\s*$/, ':$1');
  const discCoveredIds = new Set(discNormalized.map(c => c.id));
  const discCoveredPairs = new Set<string>();
  for (const c of discNormalized) {
    const refs = asArr(c.refs).map(r => normalizePairRef(str(r))).filter(Boolean);
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        const pair = refs[i] < refs[j] ? `${refs[i]}|${refs[j]}` : `${refs[j]}|${refs[i]}`;
        discCoveredPairs.add(pair);
      }
    }
  }
  const fallbackDeduped = [...crossTestamentXrefs, ...lexicalHighlights, ...otherXrefs].filter(c => {
    if (discCoveredIds.has(c.id)) return false;
    const refs = asArr(c.refs).map(r => normalizePairRef(str(r))).filter(Boolean);
    if (refs.length >= 2) {
      const pair = refs[0] < refs[1] ? `${refs[0]}|${refs[1]}` : `${refs[1]}|${refs[0]}`;
      if (discCoveredPairs.has(pair)) return false;
    }
    return true;
  });

  const passageConnections = input.depth > 0
    ? filterConnectionsForPrimary(
        [...discNormalized, ...fallbackDeduped],
        '',
        input.depth,
        false,
      )
    : [];

  // Reuse the shared lexicon instead of repeating invariant lemma identities on every token.
  for (const verse of versesOut) {
    for (const word of verse.words) {
      const row = word as Rec;
      const shared = lexicon[str(row.strongs)] as unknown as Rec | undefined;
      if (shared && row.lemma === shared.lemma) delete row.lemma;
      if (shared && row.lemma_key === shared.lemma_key) delete row.lemma_key;
    }
  }

  const geography = compactGeography(rawGeo);
  const chronology = compactChronology(
    rawChron,
    asArr(chronBatch?.assertions).map(asRec).filter((a): a is Rec => a !== null),
    asArr(chronBatch?.models).map(asRec).filter((m): m is Rec => m !== null),
  );

  const hasAnyNotes = versesOut.some(v => Array.isArray(v.notes) && v.notes.length > 0);
  if (compactFlag) {
    for (const v of versesOut) {
      for (const word of v.words) {
        const w = word as Rec;
        delete w.word_id;
        delete w.tr;
        delete w.code;
        delete w.alignment_status;
      }
    }
    for (const key of Object.keys(lexicon)) {
      const entry = lexicon[key] as unknown as Rec;
      delete entry.senses;
      delete entry.occurrences_sample;
      delete entry.etymology;
      delete entry.realworld;
      delete entry.gematria;
    }
  }

  if (view === 'clues') {
    const isMultiVerseClues = versesOut.length > 1;
    const isChapterClues = versesOut.length > 4;

    // Track per-Strong's occurrence frequency across the returned verses for range deduplication
    const rangeFreq = new Map<string, number>();
    for (const v of versesOut) {
      for (const w of v.words) {
        const bs = str((w as Rec).strongs);
        if (bs && lexicon[bs]) rangeFreq.set(bs, (rangeFreq.get(bs) ?? 0) + 1);
      }
    }

    const lexEntries = Object.entries(lexicon);
    if (isMultiVerseClues) {
      lexEntries.sort((a, b) => {
        const fa = rangeFreq.get(a[0]) ?? 0;
        const fb = rangeFreq.get(b[0]) ?? 0;
        if (fb !== fa) return fb - fa;
        return Number((a[1] as unknown as Rec).total_verses ?? 99999) - Number((b[1] as unknown as Rec).total_verses ?? 99999);
      });
    }
    const maxLexEntries = isChapterClues ? 14 : isMultiVerseClues ? 20 : lexEntries.length;
    const clueLexicon: Record<string, Rec> = {};
    for (const [key, entry] of lexEntries.slice(0, maxLexEntries)) {
      const e = entry as unknown as Rec;
      const countInRange = rangeFreq.get(key);
      clueLexicon[key] = {
        lemma: e.lemma,
        strongs: e.strongs,
        ...(e.tr || e.transliteration ? { tr: e.tr ?? e.transliteration } : {}),
        gloss: e.gloss,
        ...(isMultiVerseClues && countInRange ? { count: countInRange } : {}),
        ...(e.total_verses !== undefined ? { total_verses: e.total_verses } : {}),
        ...(!isChapterClues && e.etymology ? { etymology: e.etymology } : {}),
        ...(!isChapterClues && e.realworld ? { realworld: e.realworld } : {}),
        ...(!isChapterClues && e.connections ? { connections: (e.connections as CompactConnection[]).map(c => projectClue(c, 'clues')) } : {}),
      };
    }

    const extractUniqueContentStrongs = (words: Rec[], maxTags: number): string[] => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const w of words) {
        const bs = str(w.strongs);
        if (!bs || seen.has(bs) || !lexicon[bs]) continue;
        seen.add(bs);
        out.push(bs);
        if (out.length >= maxTags) break;
      }
      return out;
    };

    const clueVerses = versesOut.map(v => {
      if (isChapterClues) {
        return {
          ref: v.ref,
          en: v.english,
          strongs: extractUniqueContentStrongs(v.words as Rec[], 6),
          ...(v.notes ? { notes: v.notes } : {}),
        };
      }
      if (isMultiVerseClues) {
        return {
          ref: v.ref,
          verse_id: v.verse_id,
          ...(v.mt_ref ? { mt_ref: v.mt_ref } : {}),
          original: v.original,
          en: v.english,
          strongs: extractUniqueContentStrongs(v.words as Rec[], 10),
          ...(v.notes ? { notes: v.notes } : {}),
        };
      }
      return {
        ref: v.ref,
        verse_id: v.verse_id,
        ...(v.mt_ref ? { mt_ref: v.mt_ref } : {}),
        original: v.original,
        english: v.english,
        words: v.words.map(w => {
          const wr = w as Rec;
          const bs = str(wr.strongs);
          return {
            pos: wr.pos,
            form: wr.form,
            ...(bs ? { strongs: bs } : {}),
            ...(!bs || !clueLexicon[bs] ? { gloss: wr.gloss } : {}),
          };
        }),
        ...(v.notes ? { notes: v.notes } : {}),
      };
    });

    const litRec = asRec(literarySummary);
    const litSeg = asRec(litRec?.segmentation);
    const clueLiterary = litRec
      ? {
          units_count: asArr(litSeg?.units).length,
          units: asArr(litSeg?.units).slice(0, 4).map(u => {
            const ur = asRec(u);
            return ur ? { label: ur.label, from_ref: ur.from_ref, to_ref: ur.to_ref } : u;
          }),
          symmetries_count: asArr(litRec.symmetries).length,
          wordplays_count: asArr(litRec.wordplays).length,
          key_words: asArr(litRec.key_words).slice(0, 5).map(kw => {
            const kr = asRec(kw);
            return kr ? { strongs: kr.strongs, script: kr.script, gloss: kr.gloss, count: kr.count } : kw;
          }),
        }
      : null;
    const clueConns = passageConnections.map(c => projectClue(c, 'clues'));
    const passageWarnings = discoveryPartial
      ? ['Graph discovery unavailable; returned passage text and lexicon only.']
      : [];
    const resultPacket: Rec = {
      status: discoveryPartial ? 'partial' : 'ok',
      view: 'clues',
      ...(passageWarnings.length ? { warnings: passageWarnings } : {}),
      passage: parsed.normalized,
      pagination: compact.pagination,
      ...(geography.status === 'ok' ? { geography } : { geography: { status: geography.status } }),
      ...(chronology.status === 'ok' ? { chronology } : { chronology: { status: chronology.status } }),
      ...(input.depth > 0 ? { passage_connections: clueConns } : {}),
      ...(discoveryPartial ? { discovery_status: 'partial' } : {}),
      ...(clueLiterary ? { literary_summary: clueLiterary } : literaryLevel > 0 ? { literary_status: 'unavailable' } : {}),
      lexicon: clueLexicon,
      ...(compact.profiles_status ? { lexical_status: compact.profiles_status } : {}),
      verses: clueVerses,
      ...(hasAnyNotes ? { notes_notice: NOTE_SECURITY_NOTICE } : {}),
    };

    // Guard chapter wire budget (<= 11.8 KB payload) without clipping single-verse payloads
    if (isChapterClues && JSON.stringify(resultPacket).length > 11800) {
      const trimmedLex: Record<string, Rec> = {};
      for (const [k, v] of Object.entries(clueLexicon).slice(0, 8)) trimmedLex[k] = v;
      resultPacket.lexicon = trimmedLex;
      if (Array.isArray(resultPacket.passage_connections) && resultPacket.passage_connections.length > 3) {
        resultPacket.passage_connections = (resultPacket.passage_connections as unknown[]).slice(0, 3);
      }
      if (JSON.stringify(resultPacket).length > 11800) {
        if (resultPacket.literary_summary && typeof resultPacket.literary_summary === 'object') {
          const ls = asRec(resultPacket.literary_summary);
          resultPacket.literary_summary = ls ? {
            units_count: ls.units_count,
            symmetries_count: ls.symmetries_count,
            wordplays_count: ls.wordplays_count,
          } : ls;
        }
        resultPacket.verses = (clueVerses as Rec[]).map(v => ({
          ref: v.ref,
          en: v.en,
          strongs: asArr(v.strongs).slice(0, 4),
          ...(v.notes ? { notes: v.notes } : {}),
        }));
      }
    }

    return resultPacket;
  }

  const compactConns = compactFlag
    ? passageConnections.map(c => ({
        id: c.id,
        expand_id: c.expand_id || c.id,
        relation: c.relation,
        epistemic: c.epistemic,
        ...(c.tier !== undefined ? { tier: c.tier } : {}),
        title: c.title,
        refs: c.refs,
      }))
    : passageConnections.map(c => projectClue(c, view));

  const fullWarnings = discoveryPartial
    ? ['Graph discovery unavailable; returned passage text and lexicon only.']
    : [];
  return {
    status: discoveryPartial ? 'partial' : 'ok',
    ...(!compactFlag ? { view } : {}),
    ...(fullWarnings.length ? { warnings: fullWarnings } : {}),
    passage: parsed.normalized,
    pagination: compact.pagination,
    geography,
    chronology,
    ...(input.depth > 0 ? { passage_connections: compactConns } : {}),
    ...(discoveryPartial ? { discovery_status: 'partial' } : {}),
    ...(literarySummary ? { literary_structure: literarySummary } : literaryLevel > 0 ? { literary_status: 'unavailable' } : {}),
    lexicon,
    ...(compact.profiles_status ? { lexical_status: compact.profiles_status } : {}),
    word_fields: 'Missing lemma/lemma_key inherit from lexicon[strongs]. word_id identifies a word form; verse_id + pos identifies its occurrence. Verse cross_reference entries are editorial links, not proof of dependence.',
    verses: versesOut,
    ...(hasAnyNotes ? { notes_notice: NOTE_SECURITY_NOTICE } : {}),
  };
}

interface EndpointMatcher {
  index: number;
  kind: 'passage' | 'word' | 'unresolved';
  strongs?: string;
  lemmaKey?: string;
  parsed?: ParsedPassage;
  vids?: Set<number>;
}

function passageRefsOverlap(a: ParsedPassage, refStr: string): boolean {
  const right = parsePassageString(refStr);
  if (!right) return false;
  return a.passages.some(x => right.passages.some(y =>
    x.book === y.book && x.chapter === y.chapter &&
    x.start_verse <= y.end_verse && y.start_verse <= x.end_verse,
  ));
}

function collectRawStrongsSet(rawC: Rec, norm: CompactConnection): Set<string> {
  const out = new Set<string>();
  const addToken = (val: unknown) => {
    const s = str(val);
    if (!s) return;
    const m = /([HG]0*\d+)/i.exec(s);
    if (m) out.add(padStrongsToken(m[1]));
  };
  addToken(rawC.source_node_id);
  addToken(rawC.target_node_id);
  addToken(rawC.strongs);
  addToken(rawC.source_strongs);
  addToken(rawC.target_strongs);
  addToken(norm.target?.strongs);
  for (const w of asArr(rawC.original_words).map(asRec)) {
    if (w) addToken(w.strongs);
  }
  const r12 = asRec(rawC.r12_metadata);
  for (const st of asArr(r12?.steps).map(asRec)) {
    if (st) {
      addToken(st.from_id);
      addToken(st.to_id);
    }
  }
  return out;
}

function evaluateEndpointCoverage(
  rawC: Rec,
  norm: CompactConnection,
  matchers: EndpointMatcher[],
): number[] {
  const rawStrongs = collectRawStrongsSet(rawC, norm);
  const rawRefs = [...norm.refs];
  for (const p of asArr(rawC.passages).map(asRec)) {
    if (p && str(p.ref)) rawRefs.push(str(p.ref));
  }
  const r12 = asRec(rawC.r12_metadata);
  for (const st of asArr(r12?.steps).map(asRec)) {
    for (const wr of asArr(st?.witness_refs)) {
      if (typeof wr === 'string' && wr.trim()) rawRefs.push(wr.trim());
    }
  }
  const rawVids = new Set<number>();
  for (const p of asArr(rawC.passages).map(asRec)) {
    const vid = Number(p?.verse_id);
    if (Number.isInteger(vid) && vid > 0) rawVids.add(vid);
  }

  const matched: number[] = [];
  for (const m of matchers) {
    if (m.kind === 'word' && m.strongs) {
      if (rawStrongs.has(padStrongsToken(m.strongs))) {
        matched.push(m.index);
      }
    } else if (m.kind === 'passage' && m.parsed) {
      const hitVid = m.vids ? [...rawVids].some(v => m.vids!.has(v)) : false;
      const hitRef = rawRefs.some(r => passageRefsOverlap(m.parsed!, r));
      if (hitVid || hitRef) matched.push(m.index);
    }
  }
  return matched;
}

function unwrapEvidencePayload(rawEv: Rec | null): Rec | null {
  if (!rawEv) return null;
  const inner = asRec(rawEv.evidence);
  const passageDetails = asArr(rawEv.passage_details)
    .map(asRec)
    .filter((d): d is Rec => d !== null)
    .map(d => asRec(d.passage) ?? d);
  if (!inner) return rawEv;
  return {
    ...rawEv,
    ...inner,
    ...(passageDetails.length > 0 && asArr(inner.passages).length === 0 ? { passages: passageDetails } : {}),
  };
}

export async function handleGetConnection(
  read: DatabaseReader,
  items: string[],
  maxConnections: number,
  compact = false,
  view: McpView = 'evidence',
): Promise<Rec> {
  const itemEntries: Array<{
    input: string;
    kind: 'passage' | 'word';
    parsed?: ParsedPassage;
    wordResult?: Awaited<ReturnType<typeof buildFullCompactWord>>;
    compactPassage?: Rec | null;
  }> = [];

  await Promise.all(
    items.map(async (rawItem, idx) => {
      const parsed = isPassageLike(rawItem) ? parsePassageString(rawItem) : null;
      if (parsed) {
        const compactPassage = await fetchCompactPassage(read, {
          passages: parsed.passages,
          max_verses: 14,
          offset: 0,
          include_profiles: true,
          profile_limit: 18,
        });
        itemEntries[idx] = { input: rawItem, kind: 'passage', parsed, compactPassage };
      } else {
        const wordResult = await buildFullCompactWord(read, rawItem, {
          connections: maxConnections,
          etymology: 0,
          realworld: 0,
        });
        itemEntries[idx] = { input: rawItem, kind: 'word', wordResult };
      }
    }),
  );

  const itemMatchers: EndpointMatcher[] = itemEntries.map((entry, idx) => {
    if (entry.kind === 'passage' && entry.parsed) {
      const vids = new Set(
        asArr(entry.compactPassage?.verses)
          .map(asRec)
          .map(v => Number(v?.verse_id))
          .filter(n => Number.isInteger(n) && n > 0),
      );
      return { index: idx, kind: 'passage', parsed: entry.parsed, vids };
    }
    if (entry.kind === 'word' && entry.wordResult?.word?.strongs) {
      return {
        index: idx,
        kind: 'word',
        strongs: entry.wordResult.word.strongs,
        lemmaKey: entry.wordResult.word.lemma_key,
      };
    }
    return { index: idx, kind: 'unresolved' };
  });

  const itemSummaries = itemEntries.map(entry => {
    if (entry.kind === 'passage' && entry.parsed) {
      const verses = asArr(entry.compactPassage?.verses).map(asRec).filter((v): v is Rec => v !== null);
      const profiles = asRec(entry.compactPassage?.profiles) ?? {};
      const contextualGlossByBs = new Map<string, string>();
      for (const v of verses) {
        for (const rawT of asArr(v.tokens)) {
          const t = asRec(rawT);
          const bsKey = padStrongsToken(str(t?.strongs));
          const tGl = str(t?.gloss);
          if (bsKey && tGl && !contextualGlossByBs.has(bsKey)) contextualGlossByBs.set(bsKey, tGl);
        }
      }
      return {
        input: entry.input,
        kind: 'passage',
        ...(!verses.length ? { status: 'unavailable', error: 'Passage source unavailable; retry this input before drawing conclusions.' } : {}),
        passage: entry.parsed.normalized,
        verse_count: entry.parsed.verse_count,
        verses_preview: verses.slice(0, 4).map(v => ({
          ref: str(v.ref),
          original: asArr(v.tokens).map(asRec).filter(Boolean).map(t => str(t?.surface)).join(' '),
          english: str(v.web),
        })),
        key_lemmas: Object.values(profiles)
          .map(asRec)
          .filter((p): p is Rec => p !== null)
          .slice(0, 8)
          .map(p => ({
            strongs: str(p.bs),
            lemma: str(p.sc),
            transliteration: cleanTransliteration(str(p.tr), str(p.sc)),
            gloss: contextualGlossByBs.get(padStrongsToken(str(p.bs))) || str(p.gl),
            total_verses: p.total_verses ?? 0,
          })),
      };
    }
    if (entry.wordResult?.word) {
      const occ = asRec(entry.wordResult.occurrences);
      return {
        input: entry.input,
        kind: 'word',
        ...(entry.wordResult.status !== 'ok' ? { status: entry.wordResult.status } : {}),
        word: entry.wordResult.word,
        occurrences: {
          total_verses: typeof occ?.total_verses === 'number' ? occ.total_verses : 0,
          clusters: asArr(occ?.clusters).slice(0, 3),
        },
        ...(entry.wordResult.ambiguousCandidates.length ? { ambiguous_candidates: entry.wordResult.ambiguousCandidates } : {}),
      };
    }
    return {
      input: entry.input,
      kind: 'unresolved',
      error: `Could not resolve "${entry.input}" to a canonical passage or lexical entry.`,
    };
  });

  type TaggedConn = { conn: CompactConnection; matchedIndices: number[]; isIndirect: boolean };
  const taggedCandidates: TaggedConn[] = [];
  const pushTagged = (conn: CompactConnection, matchedIndices: number[], isIndirect = false) => {
    const uniq = [...new Set(matchedIndices)].sort((a, b) => a - b);
    taggedCandidates.push({
      conn: {
        ...conn,
        matched_endpoints: uniq.map(i => itemEntries[i]?.input ?? String(i)),
      },
      matchedIndices: uniq,
      isIndirect,
    });
  };

  // Lane 1: Word <-> Word exact VID intersection & formal/wordplay/root links
  const wordEntries = itemEntries
    .map((e, idx) => ({ e, idx }))
    .filter(x => x.e.kind === 'word' && x.e.wordResult?.word?.strongs);
  const wordStrongs = wordEntries.map(x => str(x.e.wordResult!.word!.strongs));

  if (wordEntries.length >= 2) {
    try {
      const profRes = await safeCallFirst(read, 'get_word_profiles_batch_v1', {
        strongs: wordStrongs,
        include_vids: true,
        include_forms: false,
        include_orth: true,
        include_pilot: false,
      });
      const profMap = asRec(profRes?.profiles) ?? {};
      const vidArrays = wordEntries
        .map(w => ({
          idx: w.idx,
          bs: str(w.e.wordResult!.word!.strongs),
          vids: asArr(asRec(profMap[str(w.e.wordResult!.word!.strongs)])?.all_vids).map(Number).filter(n => n > 0),
        }))
        .filter(a => a.vids.length > 0);
      if (vidArrays.length >= 2) {
        const sets = vidArrays.slice(1).map(a => new Set(a.vids));
        const sameVerse = vidArrays[0].vids.filter(vid => sets.every(s => s.has(vid)));
        const nearbyVerse = sameVerse.length === 0
          ? vidArrays[0].vids.filter(vid => sets.every(s => s.has(vid) || s.has(vid - 1) || s.has(vid + 1) || s.has(vid - 2) || s.has(vid + 2)))
          : [];
        const witnessVids = (sameVerse.length > 0 ? sameVerse : nearbyVerse).slice(0, 4);
        if (witnessVids.length > 0) {
          const hyd = await safeCallFirst(read, 'get_passage_compact_v1', {
            verse_ids: witnessVids,
            include_profiles: false,
          });
          const wVerses = asArr(hyd?.verses).map(asRec).filter((v): v is Rec => v !== null);
          const refs = wVerses.map(v => str(v.ref)).filter(Boolean);
          const totalMatches = sameVerse.length > 0 ? sameVerse.length : nearbyVerse.length;
          // Nearby (±2v) co-attestation without any same-verse overlap is an indirect exploratory lead, not a direct proof
          const isNearbyOnly = sameVerse.length === 0;
          pushTagged({
            id: `intersect:${wordStrongs.join('+')}`,
            relation: sameVerse.length > 0 ? 'same_verse_co_attestation' : 'nearby_verse_co_attestation',
            epistemic: isNearbyOnly ? 'candidate_literary_pattern' : 'documented_collocation_or_cooccurrence',
            tier: isNearbyOnly ? 4 : 3,
            title: `${wordStrongs.join(' + ')} co-occur in ${totalMatches} ${sameVerse.length > 0 ? 'verse(s)' : 'nearby (±2v) passage(s)'}`,
            why: `Attested together in ${refs.join(', ')}. Co-occurrence provides textual witnesses to inspect, not automatic equivalence.`,
            refs,
            witness: wVerses[0] ? str(wVerses[0].web).slice(0, 160) : undefined,
          }, vidArrays.map(a => a.idx), isNearbyOnly);
        }
      }
      // Pairwise word-to-word orthographic / wordplay / root links from profiles (check both directions pA and pB)
      const extractConsForPair = (s: string): Set<string> => {
        const first = String(s || '').split(/[,;/]/)[0] || '';
        return new Set(
          [...first.normalize('NFD')]
            .filter(ch => {
              const cp = ch.codePointAt(0) || 0;
              return (cp >= 0x05d0 && cp <= 0x05ea) || (cp >= 0x03b1 && cp <= 0x03c9) || (cp >= 0x0391 && cp <= 0x03a9);
            })
            .map(c => c.toLowerCase()),
        );
      };
      for (let i = 0; i < wordEntries.length; i++) {
        for (let j = i + 1; j < wordEntries.length; j++) {
          const wA = wordEntries[i];
          const wB = wordEntries[j];
          const bsA = padStrongsToken(str(wA.e.wordResult!.word!.strongs));
          const bsB = padStrongsToken(str(wB.e.wordResult!.word!.strongs));
          const pA = asRec(profMap[bsA]);
          const pB = asRec(profMap[bsB]);

          const findWpInProf = (srcProf: Rec | null, targetBs: string): Rec | null => {
            if (!srcProf) return null;
            const list = [
              ...asArr(srcProf.r13_wordplay).map(asRec),
              ...asArr(asRec(srcProf.orth_entry)?.consonantal_overlaps).map(asRec),
              ...asArr(asRec(srcProf.orth_entry)?.shared_root).map(asRec),
              ...asArr(asRec(srcProf.orth_entry)?.homographs).map(asRec),
            ].filter((x): x is Rec => x !== null);
            return list.find(x => padStrongsToken(str(x.target_bs ?? x.bs ?? x.strongs)) === targetBs) ?? null;
          };

          const wpMatchA = findWpInProf(pA, bsB);
          const wpMatchB = !wpMatchA ? findWpInProf(pB, bsA) : null;
          const wpMatch = wpMatchA ?? wpMatchB;
          const canonicalFromBs = wpMatchA ? bsA : bsB;
          const canonicalToBs = wpMatchA ? bsB : bsA;

          if (wpMatch) {
            const rel = firstNonEmpty(wpMatch.evidence_type, wpMatch.overlap_kind, 'shared_consonantal_pattern');
            const sameV = Number(wpMatch.proximity_same_verse ?? 0);
            const adjV = Number(wpMatch.proximity_adjacent_verse ?? 0);
            const hasCue = Boolean(wpMatch.has_explicit_cue);
            const provenRoot = Boolean(wpMatch.proven_common_root) && str(wpMatch.shared_consonants).length >= 2;
            const isAttestedWp = rel === 'attested_textual_wordplay' || hasCue;
            const isDocRoot = rel === 'documented_root_family' || rel === 'morphological_derivation' || provenRoot;
            const wRefs = asArr(wpMatch.witness_refs).filter((r): r is string => typeof r === 'string').slice(0, 4);
            const isSameVerseRepeated = rel === 'proximate_wordplay_candidate' && sameV >= 2 && wRefs.length > 0;
            const isProximateWitnessed = rel === 'proximate_wordplay_candidate' && (sameV > 0 || adjV > 0);
            const epClass = isAttestedWp
              ? 'direct_textual_evidence'
              : isDocRoot
                ? 'documented_lexical_relationship'
                : isSameVerseRepeated
                  ? 'documented_collocation_or_cooccurrence'
                  : isProximateWitnessed
                    ? 'candidate_literary_pattern'
                    : 'orthographic_similarity_only';
            const evTypeOut = isSameVerseRepeated ? 'proximate_wordplay_witnessed_same_verse' : rel;
            const tier = isAttestedWp ? 2 : (isDocRoot || isSameVerseRepeated) ? 3 : isProximateWitnessed ? 4 : 5;
            pushTagged({
              id: `r13:wp:${canonicalFromBs}:${canonicalToBs}`,
              relation: rel,
              epistemic: epClass,
              evidence_type: evTypeOut,
              tier,
              title: isAttestedWp
                ? `Attested biblical wordplay: ${wA.e.wordResult!.word!.lemma} (${bsA}) <-> ${wB.e.wordResult!.word!.lemma} (${bsB})`
                : isDocRoot
                  ? `Shared root / derivation (${rel}): ${wA.e.wordResult!.word!.lemma} (${bsA}) <-> ${wB.e.wordResult!.word!.lemma} (${bsB})`
                  : `Consonantal / phonetic correspondence (${rel}): ${wA.e.wordResult!.word!.lemma} (${bsA}) <-> ${wB.e.wordResult!.word!.lemma} (${bsB})`,
              why: firstNonEmpty(
                wpMatch.why,
                wpMatch.note,
                `${wA.e.wordResult!.word!.lemma} (${bsA}, "${wA.e.wordResult!.word!.gloss}") and ${wB.e.wordResult!.word!.lemma} (${bsB}, "${wB.e.wordResult!.word!.gloss}") share consonants "${str(wpMatch.shared_consonants)}"${wRefs.length ? ` in ${wRefs.join(', ')}` : ''}.`,
              ),
              refs: wRefs,
              target: {
                strongs: bsB,
                script: wB.e.wordResult!.word!.lemma,
                gloss: wB.e.wordResult!.word!.gloss,
              },
            }, [wA.idx, wB.idx], tier > 4);
          }

          // Also check verified lexical_relations between bsA and bsB
          const findLexInProf = (srcProf: Rec | null, targetBs: string): Rec | null => {
            if (!srcProf) return null;
            return (
              asArr(srcProf.lexical_relations)
                .map(asRec)
                .find(lr => lr && padStrongsToken(str(lr.target_strongs)) === targetBs) ?? null
            );
          };
          const lexMatch = findLexInProf(pA, bsB) ?? findLexInProf(pB, bsA);
          if (lexMatch) {
            const kind = str(lexMatch.type, 'shares_root');
            let validCons = true;
            if (kind === 'shares_root' && bsA[0] === bsB[0]) {
              const cA = extractConsForPair(wA.e.wordResult!.word!.lemma);
              const cB = extractConsForPair(wB.e.wordResult!.word!.lemma);
              if (cA.size > 0 && cB.size > 0) {
                validCons = [...cB].filter(c => cA.has(c)).length >= 2;
              }
            }
            if (validCons) {
              const sampleRefs = [
                ...asArr(pA?.first_occ_passages).map(asRec).map(p => str(p?.ref)).filter(Boolean).slice(0, 1),
                ...asArr(pB?.first_occ_passages).map(asRec).map(p => str(p?.ref)).filter(Boolean).slice(0, 1),
              ];
              pushTagged({
                id: `lex:${bsA}:${bsB}`,
                relation: kind,
                epistemic: 'documented_lexical_relationship',
                evidence_type: 'documented_root_family',
                tier: 3,
                title: `Documented lexical relation (${kind}): ${wA.e.wordResult!.word!.lemma} (${bsA}) <-> ${wB.e.wordResult!.word!.lemma} (${bsB})`,
                why: `${wA.e.wordResult!.word!.lemma} (${bsA}, "${wA.e.wordResult!.word!.gloss}") and ${wB.e.wordResult!.word!.lemma} (${bsB}, "${wB.e.wordResult!.word!.gloss}") are linked by ${kind}${lexMatch.root ? ` (root ${str(lexMatch.root)})` : ''}.`,
                refs: sampleRefs,
                target: {
                  strongs: bsB,
                  script: wB.e.wordResult!.word!.lemma,
                  gloss: wB.e.wordResult!.word!.gloss,
                },
              }, [wA.idx, wB.idx], false);
            }
          }
        }
      }
    } catch {
      // Optional intersection lane
    }
  }

  // Lane 2: Word <-> Passage direct lexical/LXX match + Passage <-> Passage shared lemmas, bidirectional LXX bridges & bidirectional xrefs
  const passageEntries = itemEntries
    .map((e, idx) => ({ e, idx }))
    .filter(x => x.e.kind === 'passage' && x.e.compactPassage);

  for (const wItem of wordEntries) {
    const wObj = wItem.e.wordResult!.word!;
    const wBs = wObj.strongs;
    const lxxTargets = new Set((wObj.lxx ?? []).map(x => str(x.strongs).toUpperCase()).filter(Boolean));
    for (const pItem of passageEntries) {
      const verses = asArr(pItem.e.compactPassage?.verses).map(asRec).filter((v): v is Rec => v !== null);
      const matchingRefs: string[] = [];
      let matchedLxxRef = '';
      let matchedSnippet = '';
      for (const v of verses) {
        const toks = asArr(v.tokens).map(asRec).filter((t): t is Rec => t !== null);
        if (toks.some(t => str(t.strongs).toUpperCase() === wBs)) {
          matchingRefs.push(str(v.ref));
          if (!matchedSnippet) matchedSnippet = str(v.web).slice(0, 160);
        } else if (toks.some(t => lxxTargets.has(str(t.strongs).toUpperCase()))) {
          if (!matchedLxxRef) matchedLxxRef = str(v.ref);
        }
      }
      if (matchingRefs.length > 0) {
        pushTagged({
          id: `direct_in_passage:${wBs}:${pItem.e.parsed?.normalized}`,
          relation: 'direct_lexical_attestation',
          epistemic: 'direct_textual_evidence',
          tier: 2,
          title: `${wObj.lemma} (${wBs}) appears directly in ${matchingRefs.join(', ')}`,
          why: `Direct lexical attestation of ${wObj.lemma} (${wObj.transliteration}, "${wObj.gloss}") inside ${pItem.e.parsed?.normalized}.`,
          refs: matchingRefs.slice(0, 4),
          witness: matchedSnippet || undefined,
        }, [wItem.idx, pItem.idx], false);
      } else if (matchedLxxRef) {
        pushTagged({
          id: `lxx_in_passage:${wBs}:${pItem.e.parsed?.normalized}`,
          relation: 'cross_language_lxx_bridge',
          epistemic: 'documented_cross_language_bridge',
          tier: 3,
          title: `${wObj.lemma} (${wBs}) bridges via LXX Greek into ${matchedLxxRef}`,
          why: `Corresponding Septuagint Greek equivalent of ${wObj.lemma} (${wBs}) occurs in ${matchedLxxRef}.`,
          refs: [matchedLxxRef],
        }, [wItem.idx, pItem.idx], false);
      }
    }
  }

  const BRIDGE_STOPWORD_STRONGS = new Set([
    'H3605', 'G3956', 'H1961', 'G1096', 'H7200', 'G1492', 'G3708', 'H8147', 'G1417',
    'H0559', 'G3004', 'G2036', 'H0834', 'H3588', 'H5921', 'H0413', 'H4480', 'H0376',
    'G2532', 'G0846', 'G3588', 'G1722', 'G1519', 'H3068', 'G2962', 'H0853', 'H5973',
  ]);
  const explicitWordStrongs = new Set(
    itemEntries.filter(e => e.kind === 'word' && e.wordResult?.word?.strongs).map(e => padStrongsToken(str(e.wordResult!.word!.strongs))),
  );

  if (passageEntries.length >= 2) {
    const pSets = passageEntries.map(({ e: pe, idx }) => {
      const verses = asArr(pe.compactPassage?.verses).map(asRec).filter((v): v is Rec => v !== null);
      const vids = new Set(verses.map(v => Number(v.verse_id)).filter(n => n > 0));
      const profiles = asRec(pe.compactPassage?.profiles) ?? {};
      const strongsSet = new Set(Object.keys(profiles));
      const rootsByRoot = new Map<string, Array<{ bs: string; sc: string; gl: string; kind: string }>>();
      const lxxOut = new Map<string, { fromBs: string; fromSc: string; toSc: string; toGl: string; count: number }>();
      for (const [bs, rawP] of Object.entries(profiles)) {
        const p = asRec(rawP);
        const tv = typeof p?.total_verses === 'number' ? p.total_verses : 0;
        const padBs = padStrongsToken(bs);
        if (tv <= 220 && !BRIDGE_STOPWORD_STRONGS.has(padBs)) {
          for (const rawLr of asArr(p?.lexical_relations).map(asRec)) {
            const root = str(rawLr?.root).trim();
            if (!root || root.length < 2) continue;
            const list = rootsByRoot.get(root) ?? [];
            list.push({ bs: padBs, sc: str(p?.sc, bs), gl: str(p?.gl), kind: str(rawLr?.type, 'shared_root') });
            rootsByRoot.set(root, list);
          }
        }
        if (BRIDGE_STOPWORD_STRONGS.has(padBs) || tv > 600) continue;
        const lxxList = asArr(p?.lxx_relations).map(asRec).filter((x): x is Rec => x !== null);
        const maxCnt = lxxList.reduce((m, x) => Math.max(m, Number(x.count ?? 1)), 1);
        for (const lx of lxxList) {
          const tbs = str(lx.target_strongs).toUpperCase();
          if (!tbs || BRIDGE_STOPWORD_STRONGS.has(padStrongsToken(tbs)) || isLxxFunctionEquivalent(tbs, str(lx.script))) continue;
          const cnt = Number(lx.count ?? 1);
          // Skip secondary low-share co-occurrence noise (< 22% of the lemma's primary LXX translation count)
          if (maxCnt >= 10 && cnt < maxCnt * 0.22) continue;
          const prev = lxxOut.get(tbs);
          if (!prev || cnt > prev.count) {
            lxxOut.set(tbs, { fromBs: bs, fromSc: str(p?.sc), toSc: str(lx.script), toGl: str(lx.gloss), count: cnt });
          }
        }
      }
      return { pe, idx, verses, vids, profiles, strongsSet, rootsByRoot, lxxOut };
    });

    for (let i = 0; i < pSets.length; i++) {
      for (let j = i + 1; j < pSets.length; j++) {
        const a = pSets[i];
        const b = pSets[j];
        // Bidirectional direct cross-references collapsed per unordered verse pair [minVid, maxVid]
        const seenXrefVidPair = new Map<string, CompactConnection>();
        for (const [src, dst] of [[a, b], [b, a]] as const) {
          for (const v of src.verses) {
            const fromVid = Number(v.verse_id || 0);
            for (const xr of asArr(v.xrefs)) {
              const xc = buildXrefConnection(str(v.ref), fromVid, xr);
              const targetVid = Array.isArray(xr) ? Number(xr[0]) : Number(asRec(xr)?.target_vid ?? 0);
              if (!xc || !dst.vids.has(targetVid)) continue;
              const lo = Math.min(fromVid, targetVid);
              const hi = Math.max(fromVid, targetVid);
              const pairKey = `${lo}:${hi}`;
              const existing = seenXrefVidPair.get(pairKey);
              if (existing) {
                existing.title = existing.title.replace(' -> ', ' <-> ') + ' (reciprocal)';
                continue;
              }
              seenXrefVidPair.set(pairKey, xc);
              pushTagged(xc, [a.idx, b.idx], false);
            }
          }
        }
        // Shared rare content Strong's (with homograph lemma_key & contextual sense disambiguation, EV13)
        for (const bs of a.strongsSet) {
          if (b.strongsSet.has(bs)) {
            const padBs = padStrongsToken(bs);
            if (BRIDGE_STOPWORD_STRONGS.has(padBs) && !explicitWordStrongs.has(padBs)) continue;
            const p = asRec(a.profiles[bs]);
            const sc = str(p?.sc, bs);
            const gl = str(p?.gl);
            const tv = typeof p?.total_verses === 'number' ? p.total_verses : 0;
            if (tv <= 200) {
              const aToks = a.verses
                .flatMap(v => asArr(v.tokens).map(asRec))
                .filter((t): t is Rec => Boolean(t && padStrongsToken(str(t.strongs)) === padStrongsToken(bs)));
              const bToks = b.verses
                .flatMap(v => asArr(v.tokens).map(asRec))
                .filter((t): t is Rec => Boolean(t && padStrongsToken(str(t.strongs)) === padStrongsToken(bs)));
              const lkA = str(aToks[0]?.lemma_key);
              const lkB = str(bToks[0]?.lemma_key);
              const glA = str(aToks[0]?.gloss, gl);
              const glB = str(bToks[0]?.gloss, gl);
              const aRef = a.pe.parsed?.normalized ?? a.pe.input;
              const bRef = b.pe.parsed?.normalized ?? b.pe.input;

              if (lkA && lkB && lkA !== lkB) {
                pushTagged({
                  id: `shared_lemma_homograph:${bs}:${lkA}:${lkB}`,
                  relation: 'shared_root_distinct_senses',
                  epistemic: 'documented_lexical_relationship',
                  evidence_type: 'homograph_distinct_contextual_sense',
                  tier: 3,
                  title: `Shared Strong's across distinct homograph senses: ${sc} (${bs}) — ${lkA} ("${glA}") vs ${lkB} ("${glB}")`,
                  why: `${aRef} uses ${lkA} (${sc}, contextual gloss "${glA}"), whereas ${bRef} uses ${lkB} (${sc}, contextual gloss "${glB}"). A shared Strong's or root family does not establish identical lexical sense or automatic theological equivalence.`,
                  refs: [aRef, bRef],
                }, [a.idx, b.idx], false);
              } else {
                pushTagged({
                  id: `shared_lemma:${bs}`,
                  relation: 'shared_rare_vocabulary',
                  epistemic: 'documented_lexical_relationship',
                  tier: 3,
                  title: `Shared vocabulary: ${sc} (${bs}, ${tv}v) "${gl}"`,
                  why: `Both ${aRef} (gloss "${glA}") and ${bRef} (gloss "${glB}") use ${sc} (${lkA || bs}, "${gl}").`,
                  refs: [aRef, bRef],
                }, [a.idx, b.idx], false);
              }
            }
          }
        }
        // Passage <-> Passage root / derivation / wordplay bridges between rare content lemmas (e.g. Jer 1:11-12 H8247/H8245 <-> Exod 25:33-37 H8246)
        const seenRootBridgePair = new Set<string>();
        for (const [src, dst] of [[a, b], [b, a]] as const) {
          for (const [bsSrc, rawPSrc] of Object.entries(src.profiles)) {
            const pSrc = asRec(rawPSrc);
            const tvSrc = typeof pSrc?.total_verses === 'number' ? pSrc.total_verses : 999;
            if (!pSrc || tvSrc > 180) continue;
            const scSrc = str(pSrc.sc, bsSrc);
            const glSrc = str(pSrc.gl);

            for (const rawWp of asArr(pSrc.r13_wordplay).map(asRec)) {
              if (!rawWp) continue;
              const tBs = padStrongsToken(str(rawWp.target_bs));
              if (!tBs || tBs === bsSrc || !dst.strongsSet.has(tBs)) continue;
              const pDst = asRec(dst.profiles[tBs]);
              const tvDst = typeof pDst?.total_verses === 'number' ? pDst.total_verses : 999;
              if (tvDst > 180) continue;
              const pairKey = [bsSrc, tBs].sort().join(':');
              if (seenRootBridgePair.has(pairKey)) continue;
              seenRootBridgePair.add(pairKey);
              const evType = str(rawWp.evidence_type, 'shared_consonantal_pattern');
              const isRootOrCue =
                Boolean(rawWp.proven_common_root) ||
                Boolean(rawWp.has_explicit_cue) ||
                evType === 'documented_root_family' ||
                evType === 'morphological_derivation';
              if (!isRootOrCue && Number(rawWp.score ?? 0) < 0.78) continue;
              const scDst = str(pDst?.sc, str(rawWp.target_script, tBs));
              const glDst = str(pDst?.gl, str(rawWp.target_gloss));
              const srcRef = src.pe.parsed?.normalized ?? src.pe.input;
              const dstRef = dst.pe.parsed?.normalized ?? dst.pe.input;
              pushTagged({
                id: `passage_root_wordplay:${bsSrc}:${tBs}`,
                relation: isRootOrCue ? 'shared_root_or_wordplay_bridge' : 'consonantal_passage_bridge',
                epistemic: isRootOrCue ? 'documented_lexical_relationship' : 'candidate_literary_pattern',
                evidence_type: evType,
                tier: isRootOrCue ? 2 : 4,
                title: `Original-language lexical/wordplay bridge: ${scSrc} (${bsSrc}, "${glSrc}") <-> ${scDst} (${tBs}, "${glDst}")`,
                why: `${srcRef} attests ${scSrc} (${bsSrc}, "${glSrc}") and ${dstRef} attests ${scDst} (${tBs}, "${glDst}"), linked by ${evType} (shared consonants "${str(rawWp.shared_consonants)}").`,
                refs: [srcRef, dstRef],
              }, [a.idx, b.idx], !isRootOrCue);
            }

            for (const rawLr of asArr(pSrc.lexical_relations).map(asRec)) {
              if (!rawLr) continue;
              const tBs = padStrongsToken(str(rawLr.target_strongs));
              if (!tBs || tBs === bsSrc || !dst.strongsSet.has(tBs)) continue;
              const pDst = asRec(dst.profiles[tBs]);
              const tvDst = typeof pDst?.total_verses === 'number' ? pDst.total_verses : 999;
              if (tvDst > 180) continue;
              const pairKey = [bsSrc, tBs].sort().join(':');
              if (seenRootBridgePair.has(pairKey)) continue;
              seenRootBridgePair.add(pairKey);
              const scDst = str(pDst?.sc, str(rawLr.script, tBs));
              const glDst = str(pDst?.gl, str(rawLr.gloss));
              const srcRef = src.pe.parsed?.normalized ?? src.pe.input;
              const dstRef = dst.pe.parsed?.normalized ?? dst.pe.input;
              const kind = str(rawLr.type, 'derived_from_root_anchor');
              pushTagged({
                id: `passage_lex_bridge:${bsSrc}:${tBs}`,
                relation: kind,
                epistemic: 'documented_lexical_relationship',
                evidence_type: 'documented_root_family',
                tier: 2,
                title: `Original-language root/derivation bridge: ${scSrc} (${bsSrc}, "${glSrc}") <-> ${scDst} (${tBs}, "${glDst}")`,
                why: `${srcRef} uses ${scSrc} (${bsSrc}, "${glSrc}") and ${dstRef} uses ${scDst} (${tBs}, "${glDst}"), linked by documented ${kind}.`,
                refs: [srcRef, dstRef],
              }, [a.idx, b.idx], false);
            }
          }
        }
        // Cross-passage shared root bridge (even when direct target_strongs links were omitted between cognate lemmas)
        for (const [root, aItems] of a.rootsByRoot.entries()) {
          const bItems = b.rootsByRoot.get(root);
          if (!bItems || bItems.length === 0) continue;
          const aSrc = aItems[0];
          const bDst = bItems[0];
          if (!aSrc || !bDst || aSrc.bs === bDst.bs || aSrc.bs[0] !== bDst.bs[0]) continue;
          const pairKey = [aSrc.bs, bDst.bs].sort().join(':');
          if (seenRootBridgePair.has(pairKey)) continue;
          seenRootBridgePair.add(pairKey);
          const aRef = a.pe.parsed?.normalized ?? a.pe.input;
          const bRef = b.pe.parsed?.normalized ?? b.pe.input;
          pushTagged({
            id: `passage_root_bridge:${aSrc.bs}:${bDst.bs}`,
            relation: 'shared_root_cognates',
            epistemic: 'direct_textual_evidence',
            evidence_type: 'documented_root_family',
            tier: 2,
            title: `Shared root family (${root}): ${aSrc.sc} (${aSrc.bs}, "${aSrc.gl}") <-> ${bDst.sc} (${bDst.bs}, "${bDst.gl}")`,
            why: `${aRef} attests ${aSrc.sc} (${aSrc.bs}, "${aSrc.gl}") and ${bRef} attests ${bDst.sc} (${bDst.bs}, "${bDst.gl}"), both documented under root ${root}.`,
            refs: [aRef, bRef],
          }, [a.idx, b.idx], false);
        }
        // Bidirectional cross-testament LXX bridges (A -> B AND B -> A)
        const seenLxxPair = new Set<string>();
        const sharedLxxBridgePairs: Array<{ fromBs: string; fromSc: string; toBs: string; toSc: string; toGl: string }> = [];
        for (const [src, dst] of [[a, b], [b, a]] as const) {
          for (const [tbs, info] of src.lxxOut.entries()) {
            if (!dst.strongsSet.has(tbs)) continue;
            if (isLxxFunctionEquivalent(tbs, info.toSc)) continue;
            const srcTv = Number(asRec(src.profiles[info.fromBs])?.total_verses ?? 0);
            const dstTv = Number(asRec(dst.profiles[tbs])?.total_verses ?? 0);
            if (Math.max(srcTv, dstTv) > 600) continue;
            const pairKey = [info.fromBs, tbs].sort().join(':');
            if (seenLxxPair.has(pairKey)) continue;
            seenLxxPair.add(pairKey);
            sharedLxxBridgePairs.push({ fromBs: info.fromBs, fromSc: info.fromSc, toBs: tbs, toSc: info.toSc, toGl: info.toGl });
            pushTagged({
              id: `passage_lxx:${info.fromBs}:${tbs}`,
              relation: 'cross_language_lxx_bridge',
              epistemic: 'documented_cross_language_bridge',
              tier: 3,
              title: `LXX lexical bridge: ${info.fromSc} (${info.fromBs}) <-> ${info.toSc} (${tbs}, "${info.toGl}")`,
              why: `${src.pe.parsed?.normalized} uses ${info.fromSc} (${info.fromBs}), corresponding via LXX to ${info.toSc} (${tbs}), which appears in ${dst.pe.parsed?.normalized}.`,
              refs: [src.pe.parsed?.normalized ?? src.pe.input, dst.pe.parsed?.normalized ?? dst.pe.input],
            }, [a.idx, b.idx], false);
          }
        }

        // Explicit OT <-> NT Typological / Comparative Citation detection (when >= 3 LXX vocabulary bridges converge with NT comparative/citation markers)
        const aIsOt = a.verses.some(v => Number(v.book) <= 39);
        const bIsOt = b.verses.some(v => Number(v.book) <= 39);
        if (aIsOt !== bIsOt && sharedLxxBridgePairs.length >= 3) {
          const otSet = aIsOt ? a : b;
          const ntSet = aIsOt ? b : a;
          const TYPOLOGY_QUOTE_MARKERS = ['G5618', 'G2531', 'G1125', 'G4137', 'G3004', 'G0499', 'G5179'];
          const matchedMarkers = TYPOLOGY_QUOTE_MARKERS.filter(m => ntSet.strongsSet.has(m));
          const ntWeb = ntSet.verses.map(v => str(v.web)).join(' ').toLowerCase();
          const hasComparativeFormula = matchedMarkers.length > 0 || /\b(for as|just as|even so|so will|was in the belly|as it is written)\b/.test(ntWeb);
          if (hasComparativeFormula) {
            const otRef = otSet.pe.parsed?.normalized ?? otSet.pe.input;
            const ntRef = ntSet.pe.parsed?.normalized ?? ntSet.pe.input;
            const bridgeSummary = sharedLxxBridgePairs
              .slice(0, 6)
              .map(bp => `${bp.fromSc} (${bp.fromBs}) → ${bp.toSc} (${bp.toBs}, "${bp.toGl}")`)
              .join(', ');
            pushTagged({
              id: `nt_typological_citation:${otRef}:${ntRef}`,
              relation: 'explicit_typological_quotation',
              epistemic: 'authorial_typology_or_quote',
              evidence_type: 'explicit_biblical_interpretation',
              tier: 1,
              title: `Explicit NT typological citation & LXX phrase parallel: ${otRef} → ${ntRef} (${sharedLxxBridgePairs.length} aligned terms)`,
              why: `${ntRef} explicitly cites/compares ${otRef}${matchedMarkers.length > 0 ? ` (comparative/citation markers: ${matchedMarkers.join(', ')})` : ''} while reproducing ${sharedLxxBridgePairs.length} LXX Greek equivalents (${bridgeSummary}).`,
              refs: [otRef, ntRef],
            }, [a.idx, b.idx], false);
          }
        }
      }
    }
  }

  // Lane 3: R12/R13 graph bridge/compare discovery + shared Steiner subgraph engine
  const compareTargets = itemEntries.map(e => {
    if (e.kind === 'passage' && e.parsed) return e.parsed.normalized;
    if (e.wordResult?.word?.strongs) return e.wordResult.word.strongs;
    return e.input;
  });
  const [discRes, subgraphRes] = await Promise.all([
    safeCallFirst(read, 'discover_biblical_connections_v2', {
      query: compareTargets.join(' ; '),
      mode: 'bridge',
      compare_targets: compareTargets,
      limit: Math.min(25, maxConnections * 2),
    }),
    items.length >= 2
      ? safeCallFirst(read, 'discover_subgraph_v1', {
          anchors: compareTargets,
          max_hops: 3,
        })
      : Promise.resolve(null),
  ]);
  for (const rawC of asArr(discRes?.strongest_connections ?? discRes?.connections)) {
    const rec = asRec(rawC);
    if (!rec) continue;
    const norm = normalizeDiscoveryConnection(rec);
    if (!norm) continue;
    const matchedIndices = evaluateEndpointCoverage(rec, norm, itemMatchers);
    const isMultiHop = norm.relation === 'multihop_proof_path' || norm.id.startsWith('r12:path:');
    const isWeakTier = norm.tier !== undefined && norm.tier > 4;
    pushTagged(norm, matchedIndices, isMultiHop || isWeakTier);
  }

  // Fold verified 1-hop and multi-hop Steiner paths from discover_subgraph_v1
  if (subgraphRes?.status === 'ok') {
    for (const rawP of asArr(subgraphRes.paths)) {
      const p = asRec(rawP);
      if (!p) continue;
      const i = Number(p.from_anchor_index ?? -1);
      const j = Number(p.to_anchor_index ?? -1);
      if (i < 0 || j < 0 || i === j || i >= items.length || j >= items.length) continue;
      const hops = Number(p.hop_count ?? 1);
      const tier = Number(p.evidence_tier ?? 3);
      const refs = asArr(p.witness_refs).map(r => str(r)).filter(Boolean);
      const conn: CompactConnection = {
        id: `r13:subgraph:path:${i}:${j}`,
        relation: hops <= 1 ? 'steiner_direct_link' : 'steiner_bridge_path',
        epistemic: normalizeEpistemicClass(str(p.epistemic_class), hops <= 1 ? 'documented_lexical_relationship' : 'semantic_hypothesis'),
        tier,
        title: str(p.title, `${compareTargets[i]} <-> ${compareTargets[j]}`),
        why: str(p.why),
        ...(refs.length ? { refs } : {}),
        ...(typeof p.path_score === 'number' ? { score: p.path_score } : {}),
      };
      pushTagged(conn, [i, j], hops > 1 || tier > 4);
    }
  }

  const isVerifiedPairwiseCandidate = (t: typeof taggedCandidates[number]) => {
    if (t.matchedIndices.length < 2 || t.isIndirect) return false;
    const ep = normalizeEpistemicClass(t.conn.epistemic, 'semantic_hypothesis', t.conn.evidence_type);
    const id = t.conn.id || '';
    const evType = t.conn.evidence_type || '';
    if (ep === 'orthographic_similarity_only' || id.startsWith('r13:orth:') || id.startsWith('orth:')) return false;
    if (/^Close pericope proximity:/i.test(t.conn.title || '')) return false;
    if (
      id.startsWith('r13:wp:') &&
      ep !== 'direct_textual_evidence' &&
      evType !== 'attested_textual_wordplay' &&
      evType !== 'proximate_wordplay_witnessed_same_verse'
    ) return false;
    if (id.startsWith('r13:beam:') && ep !== 'direct_textual_evidence') return false;
    // Allow editorial xrefs only when no stronger textual/lexical proof exists, OR prefer verified classes:
    if (isVerifiedTextualProofEpistemic(ep, evType)) return true;
    return ep === 'documented_collocation_or_cooccurrence' || ep === 'shared_motif_evidence';
  };

  // Rank pairwise proof candidates by evidential & original-language specificity (explicit/wordplay/lexical/LXX first, hubs penalized)
  const scoreProofEdgePriority = (c: CompactConnection): number => {
    const id = c.id || '';
    if (id.startsWith('nt_typological_citation:') || id.startsWith('r10:ident:') || id.startsWith('r13:si:') || id.startsWith('r13:interp:') || id.startsWith('r10:typo:')) return 110;
    if (id.startsWith('r10:wordplay:') || (id.startsWith('r13:wp:') && c.epistemic === 'direct_textual_evidence')) return 105;
    if (id.startsWith('passage_root_wordplay:') || id.startsWith('passage_lex_bridge:')) return 98;
    if (id.startsWith('r13:wp:') || id.startsWith('r10:interp:')) return 92;
    if (id.startsWith('shared_lemma:') || id.startsWith('shared_lemma_homograph:') || id.startsWith('direct_in_passage:')) return 86;
    if (id.startsWith('passage_lxx:') || id.startsWith('lxx_in_passage:') || id.startsWith('r11:lxx:')) return 82;
    if (id.startsWith('lex:') || id.startsWith('r11:lex:')) return 78;
    if (id.startsWith('r13:motif:') || id.startsWith('r12:scene:')) return 65;
    if (id.startsWith('r13:subgraph:path:')) return 55;
    if (id.startsWith('r11:xref:') || id.startsWith('xref:')) return 30;
    return 50;
  };

  const mergedProfilesForSpec: Rec = {};
  for (const e of itemEntries) {
    Object.assign(mergedProfilesForSpec, asRec(e.compactPassage?.profiles) ?? {});
  }
  const computeConnSpecificity = (c: CompactConnection): number => {
    const m = /([HG]\d{4})[^\w]*([HG]\d{4})?/i.exec(`${c.id} ${c.target?.strongs || ''} ${c.title || ''}`);
    const bsA = m?.[1] ? padStrongsToken(m[1]) : (c.target?.strongs ? padStrongsToken(c.target.strongs) : '');
    const bsB = m?.[2] ? padStrongsToken(m[2]) : '';
    const pA = bsA ? asRec(mergedProfilesForSpec[bsA]) : null;
    const pB = bsB ? asRec(mergedProfilesForSpec[bsB]) : null;
    return computeBridgeSpecificityBonus(
      typeof pA?.total_verses === 'number' ? pA.total_verses : undefined,
      typeof pB?.total_verses === 'number' ? pB.total_verses : undefined,
      bsA || undefined,
      bsB || undefined,
      str(pA?.entity_kind) || undefined,
      str(pB?.entity_kind) || undefined,
    );
  };

  // Select at most ONE best independent verified edge per unordered anchor pair (u, v) (u < v)
  const bestByPair = new Map<string, { u: number; v: number; conn: CompactConnection; priority: number; specificity: number }>();
  const pairCandidates: Array<{ u: number; v: number; conn: CompactConnection; priority: number; specificity: number }> = [];
  for (const t of taggedCandidates) {
    if (!isVerifiedPairwiseCandidate(t)) continue;
    // Skip 3+ way generic co-occurrence records when building pairwise edges
    if (t.conn.id.startsWith('intersect:') && t.matchedIndices.length >= 3) continue;
    const prio = scoreProofEdgePriority(t.conn);
    const spec = computeConnSpecificity(t.conn);
    for (let a = 0; a < t.matchedIndices.length; a++) {
      for (let b = a + 1; b < t.matchedIndices.length; b++) {
        pairCandidates.push({ u: t.matchedIndices[a], v: t.matchedIndices[b], conn: t.conn, priority: prio, specificity: spec });
      }
    }
  }
  pairCandidates.sort((a, b) =>
    (b.priority - a.priority) ||
    (b.specificity - a.specificity) ||
    ((a.conn.tier ?? 3) - (b.conn.tier ?? 3)) ||
    (a.u - b.u) ||
    (a.v - b.v) ||
    a.conn.id.localeCompare(b.conn.id),
  );

  const usedPairEvidenceIds = new Set<string>();
  for (const pc of pairCandidates) {
    const pk = `${pc.u}:${pc.v}`;
    if (bestByPair.has(pk)) continue;
    // Do not reuse the exact same evidence record ID across multiple distinct anchor pairs to fake independent edges
    const baseEvId = pc.conn.id.replace(/:path:\d+:\d+$/, '');
    if (usedPairEvidenceIds.has(baseEvId)) continue;
    usedPairEvidenceIds.add(baseEvId);
    bestByPair.set(pk, pc);
  }

  // Compute connected components over 0 .. items.length - 1 using ONLY independent verified anchor-pair edges
  const endpointAdj = new Map<number, Set<number>>();
  for (let idx = 0; idx < items.length; idx++) endpointAdj.set(idx, new Set([idx]));
  for (const { u, v } of bestByPair.values()) {
    endpointAdj.get(u)?.add(v);
    endpointAdj.get(v)?.add(u);
  }

  let largestComp: number[] = items.length > 0 ? [0] : [];
  const visitedComp = new Set<number>();
  for (let idx = 0; idx < items.length; idx++) {
    if (visitedComp.has(idx)) continue;
    const comp: number[] = [];
    const q = [idx];
    visitedComp.add(idx);
    while (q.length > 0) {
      const cur = q.shift()!;
      comp.push(cur);
      for (const nxt of endpointAdj.get(cur) || []) {
        if (!visitedComp.has(nxt)) {
          visitedComp.add(nxt);
          q.push(nxt);
        }
      }
    }
    comp.sort((a, b) => a - b);
    if (comp.length > largestComp.length) largestComp = comp;
  }

  const compSet = new Set<number>(largestComp);
  const compPairEdges = [...bestByPair.values()]
    .filter(pe => compSet.has(pe.u) && compSet.has(pe.v))
    .sort((a, b) => b.priority - a.priority || a.u - b.u || a.v - b.v);

  const isGraphComplete = items.length >= 2 && largestComp.length === items.length;
  const isTrueTriangle = items.length === 3 && isGraphComplete && compPairEdges.length === 3;
  const hasTrueCycle = isGraphComplete && compPairEdges.length >= items.length && items.length >= 3;

  // Build maximum-priority spanning tree (plus cycle closure edges if true triangle/cycle)
  const uf = items.map((_, idx) => idx);
  const findUf = (x: number): number => (uf[x] === x ? x : (uf[x] = findUf(uf[x])));
  const proofEdges: typeof compPairEdges = [];
  for (const pe of compPairEdges) {
    const ru = findUf(pe.u);
    const rv = findUf(pe.v);
    if (ru !== rv) {
      uf[ru] = rv;
      proofEdges.push(pe);
    } else if (isTrueTriangle || proofEdges.length < items.length + 1) {
      proofEdges.push(pe);
    }
  }

  const proofType = !isGraphComplete
    ? 'partial_components'
    : items.length === 2
      ? 'direct_pair'
      : isTrueTriangle
        ? 'triangle'
        : hasTrueCycle
          ? 'cycle_network'
          : 'steiner_tree';

  if (items.length >= 3 && isGraphComplete && proofEdges.length >= items.length - 1) {
    const allIdx = items.map((_, idx) => idx);
    const spanRefs = [...new Set(proofEdges.flatMap(pe => pe.conn.refs || []))].slice(0, 8);
    const worstSpanTier = proofEdges.reduce((acc, pe) => Math.max(acc, pe.conn.tier ?? 2), 1);
    const edgeSummaries = proofEdges.map(
      pe => `[${compareTargets[pe.u]} <-> ${compareTargets[pe.v]}] ${pe.conn.title}${pe.conn.refs?.length ? ` (${pe.conn.refs.slice(0, 2).join(', ')})` : ''}`,
    );
    const synthesizedConn: CompactConnection & { constituent_evidence_ids?: string[] } = {
      id: `r13:proof:${proofType}:${compareTargets.join('+')}`,
      relation: isTrueTriangle ? 'verified_three_edge_triangle' : 'verified_steiner_network',
      epistemic: worstSpanTier <= 2 ? 'direct_textual_evidence' : 'documented_lexical_relationship',
      tier: Math.min(4, worstSpanTier),
      title: isTrueTriangle
        ? `Verified 3-edge triangle connecting ${compareTargets.join(' <-> ')}`
        : `Verified ${proofType.replace(/_/g, ' ')} (${proofEdges.length} independent edges) connecting ${compareTargets.join(' <-> ')}`,
      why: edgeSummaries.join(' | '),
      ...(spanRefs.length ? { refs: spanRefs } : {}),
      constituent_evidence_ids: proofEdges.map(pe => pe.conn.id),
      score: 480,
    };
    // Prepend verified multi-anchor proof summary followed by each individual verified proof edge (deduplicated by ID)
    const toPrepend: Array<{ conn: CompactConnection; matchedIndices: number[]; isIndirect: boolean }> = [
      {
        conn: {
          ...synthesizedConn,
          matched_endpoints: allIdx.map(i => itemEntries[i]?.input ?? String(i)),
        },
        matchedIndices: allIdx,
        isIndirect: false,
      },
      ...proofEdges.map(pe => ({
        conn: {
          ...pe.conn,
          matched_endpoints: [itemEntries[pe.u]?.input ?? String(pe.u), itemEntries[pe.v]?.input ?? String(pe.v)],
        },
        matchedIndices: allIdx,
        isIndirect: false,
      })),
    ];
    taggedCandidates.unshift(...toPrepend);
  }

  const coveredAnchors = largestComp.map(i => itemEntries[i]?.input ?? String(i));
  const uncoveredAnchors = itemEntries
    .map((e, idx) => ({ input: e.input, idx }))
    .filter(x => !compSet.has(x.idx))
    .map(x => x.input);
  const graphProof = {
    proof_type: proofType,
    is_complete: isGraphComplete,
    is_valid: isGraphComplete && proofEdges.length >= Math.max(1, items.length - 1),
    independent_edge_count: proofEdges.length,
    verified_edge_count: proofEdges.length,
    distinct_anchor_pairs_connected: bestByPair.size,
    covered_anchors: coveredAnchors,
    uncovered_anchors: uncoveredAnchors,
    ...(uncoveredAnchors.length > 0
      ? {
          partial_reason: `Connected ${coveredAnchors.length} of ${items.length} requested anchors; no verified <=3-hop original-language or textual edge reached: ${uncoveredAnchors.join(', ')}.`,
        }
      : {}),
    verified_edges: proofEdges.map(pe => ({
      anchor_pair: [pe.u, pe.v],
      from_anchor: itemEntries[pe.u]?.input ?? String(pe.u),
      to_anchor: itemEntries[pe.v]?.input ?? String(pe.v),
      evidence_id: pe.conn.id,
      relation: pe.conn.relation,
      epistemic: pe.conn.epistemic,
      tier: pe.conn.tier ?? 3,
      witness_refs: pe.conn.refs ?? [],
      title: pe.conn.title,
      why: pe.conn.why,
    })),
  };

  const dedupeById = (arr: CompactConnection[]): CompactConnection[] => {
    const out: CompactConnection[] = [];
    const seen = new Set<string>();
    for (const c of arr) {
      if (!c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  };
  const dedupeConnList = (arr: CompactConnection[]) => dedupeById(filterConnectionsForPrimary(arr, '', maxConnections, false));
  const completeMultiAnchor = dedupeConnList(
    taggedCandidates.filter(t => isVerifiedPairwiseCandidate(t) && t.matchedIndices.length === items.length).map(t => t.conn),
  );
  const completeAnchorIds = items.length >= 3 ? new Set(completeMultiAnchor.map(c => c.id)) : new Set<string>();
  const directPairwise = dedupeConnList(
    taggedCandidates
      .filter(t => isVerifiedPairwiseCandidate(t) && !completeAnchorIds.has(t.conn.id))
      .map(t => t.conn),
  );
  const indirectPaths = dedupeConnList(
    taggedCandidates
      .filter(t => t.matchedIndices.length >= 2 && (t.isIndirect || (t.conn.tier !== undefined && t.conn.tier > 4)))
      .map(t => t.conn),
  );
  const individualSuggestions = dedupeConnList(
    taggedCandidates.filter(t => t.matchedIndices.length <= 1).map(t => t.conn),
  );

  const connections = dedupeById(
    filterConnectionsForPrimary(
      [...completeMultiAnchor, ...directPairwise, ...indirectPaths],
      '',
      maxConnections,
      false,
    ),
  );
  const directLinkFound = completeMultiAnchor.length > 0 || directPairwise.length > 0;
  const allEndpointsConnected = completeMultiAnchor.length > 0;
  const warnings = itemEntries
    .filter(e => e.kind === 'passage' && !asArr(e.compactPassage?.verses).length)
    .map(e => `Passage source unavailable: ${e.input}. Retry before treating missing connections as absence.`);
  for (const entry of itemEntries) if (entry.compactPassage?.profiles_status === 'partial') warnings.push(`Lexical profiles incomplete for ${entry.input}; retry for missing lexical bridges.`);
  if (!discRes) warnings.push('Graph discovery unavailable. Returned direct witnesses are partial; retry to retrieve graph connections.');
  if (items.length >= 2 && !subgraphRes) warnings.push('Subgraph Steiner engine unavailable; returned connections are partial.');

  const projectConn = (c: CompactConnection): CompactConnection => {
    if (!compact) return projectClue(c, view);
    return {
      id: c.id,
      expand_id: c.expand_id || c.id,
      relation: c.relation,
      epistemic: c.epistemic,
      ...(c.evidence_type ? { evidence_type: c.evidence_type } : {}),
      ...(c.tier !== undefined ? { tier: c.tier } : {}),
      title: c.title,
      why: c.why,
      refs: c.refs,
      ...(c.target ? { target: c.target } : {}),
    };
  };

  if (view === 'clues' && !compact) {
    const clueItems = itemSummaries.map(it => {
      if (it.kind === 'word') {
        const w = asRec(it.word);
        return {
          input: it.input,
          kind: 'word',
          ...(it.status ? { status: it.status } : {}),
          strongs: str(w?.strongs),
          lemma: str(w?.lemma),
          tr: str(w?.transliteration),
          gloss: str(w?.gloss),
          ...(w?.total_verses !== undefined ? { total_verses: w.total_verses } : {}),
        };
      }
      if (it.kind === 'passage') {
        return {
          input: it.input,
          kind: 'passage',
          ...(it.status ? { status: it.status } : {}),
          passage: it.passage,
          verse_count: it.verse_count,
          key_lemmas: asArr(it.key_lemmas).slice(0, 5).map(l => {
            const lr = asRec(l);
            return lr ? { strongs: lr.strongs, lemma: lr.lemma, gloss: lr.gloss } : l;
          }),
        };
      }
      return it;
    });
    const clueGraphProof = {
      proof_type: graphProof.proof_type,
      is_complete: graphProof.is_complete,
      is_valid: graphProof.is_valid,
      independent_edge_count: graphProof.independent_edge_count,
      distinct_anchor_pairs_connected: graphProof.distinct_anchor_pairs_connected,
      ...(graphProof.partial_reason ? { partial_reason: graphProof.partial_reason } : {}),
      verified_edges: proofEdges.map(pe => ({
        from_anchor: itemEntries[pe.u]?.input ?? String(pe.u),
        to_anchor: itemEntries[pe.v]?.input ?? String(pe.v),
        evidence_id: pe.conn.id,
        expand_id: pe.conn.expand_id || pe.conn.id,
        relation: pe.conn.relation,
        epistemic: pe.conn.epistemic,
        tier: pe.conn.tier ?? 3,
        witness_refs: (pe.conn.refs ?? []).slice(0, 3),
        title: trimConcise(pe.conn.title, 90),
      })),
    };
    return {
      status: warnings.length ? 'partial' : 'ok',
      view: 'clues',
      ...(warnings.length ? { warnings } : {}),
      items: clueItems,
      direct_link_found: directLinkFound,
      all_endpoints_connected: allEndpointsConnected && isGraphComplete,
      graph_proof: clueGraphProof,
      ...(!directLinkFound ? { no_direct_link_reason: 'No direct verse co-occurrence, lexical/LXX match, explicit cross-reference, or verified pairwise motif connected at least two requested items.' } : {}),
      connections: connections.slice(0, Math.min(maxConnections, 8)).map(c => projectClue(c, 'clues')),
      ...(!directLinkFound && individualSuggestions.length > 0
        ? {
            individual_suggestions: individualSuggestions.slice(0, 3).map(s => ({
              id: s.id,
              expand_id: s.expand_id || s.id,
              relation: s.relation,
              title: trimConcise(s.title, 90),
              refs: (s.refs ?? []).slice(0, 2),
            })),
          }
        : {}),
    };
  }

  return {
    status: warnings.length ? 'partial' : 'ok',
    ...(!compact ? { view } : {}),
    ...(warnings.length ? { warnings } : {}),
    items: compact
      ? itemSummaries.map(it => it.kind === 'passage' ? { ...it, verses_preview: asArr(it.verses_preview).slice(0, 2) } : it)
      : itemSummaries,
    direct_link_found: directLinkFound,
    all_endpoints_connected: allEndpointsConnected && isGraphComplete,
    graph_proof: graphProof,
    ...(!directLinkFound ? { no_direct_link_reason: 'No direct verse co-occurrence, lexical/LXX match, explicit cross-reference, or verified pairwise motif connected at least two requested items.' } : {}),
    connections: connections.map(projectConn),
    complete_multi_anchor: completeMultiAnchor.map(projectConn),
    direct_pairwise: directPairwise.map(projectConn),
    indirect_paths: indirectPaths.map(projectConn),
    ...(individualSuggestions.length > 0
      ? {
          individual_suggestions: directLinkFound
            ? individualSuggestions.slice(0, compact ? 3 : 6).map(projectConn)
            : individualSuggestions.slice(0, 3).map(s => ({
                id: s.id,
                relation: s.relation,
                title: s.title,
                refs: s.refs,
              })),
        }
      : {}),
    uncertainty: directLinkFound
      ? 'Only verified connections linking at least two requested items count toward direct_link_found; inspect quoted verses before concluding authorial dependence.'
      : 'No direct verse co-occurrence or explicit textual witness linked at least two requested items; any single-anchor leads under individual_suggestions are non-linking suggestions.',
  };
}

function summarizeChainEpistemics(steps: ChainStep[]): Rec {
  if (steps.length === 0) {
    return {
      classification: 'seed_node',
      note: 'Chain initialized at seed node; no hops traversed yet.',
    };
  }
  const classes = [...new Set(steps.map(s => s.epistemic))];
  const allDirect = steps.length === 1 && (classes[0] === 'direct_textual_evidence' || classes[0] === 'documented_cross_language_bridge');
  const hasExploratory = classes.some(c =>
    c.includes('orthographic') || c.includes('external_world') || c.includes('exploratory') || c.includes('hypothesis'),
  );
  return {
    classification: allDirect ? 'direct_evidenced_link' : hasExploratory ? 'exploratory_multi_step_chain' : 'evidenced_multi_step_chain',
    hop_count: steps.length,
    epistemic_classes_in_path: classes,
    note: 'A multi-step chain does not automatically establish a direct connection between its endpoints; verify each step separately.',
  };
}

async function fetchNodeNeighbors(
  read: DatabaseReader,
  node: string,
  visitedNodes: Set<string>,
  visitedEdges: Set<string>,
  limit: number,
  axisFilter?: AxisFilter,
  layerMode: 'source_only' | 'algorithm_only' | 'research_only' | 'combined' = 'algorithm_only',
): Promise<{ resolvedNode: string; neighbors: CompactConnection[]; upstreamUnavailable?: boolean }> {
  const trimmed = node.trim();
  if (layerMode === 'research_only') {
    const kgConns = (await fetchKgNeighborsForChain(read, trimmed, limit)) as unknown as CompactConnection[];
    const unseenKg = kgConns.filter(c => !visitedEdges.has(c.id));
    return { resolvedNode: trimmed, neighbors: unseenKg.slice(0, limit) };
  }
  let queryStr = trimmed;
  let focusLemma: string | undefined;
  let parsedPassage: ReturnType<typeof parsePassageString> = null;

  if (/^r1[0123]:/i.test(trimmed)) {
    const rawEv = await safeCallFirst(read, 'get_connection_evidence_v1', { evidence_id: trimmed });
    const ev = unwrapEvidencePayload(rawEv);
    const origWords = asArr(ev?.original_words).map(asRec).filter((w): w is Rec => w !== null);
    const passages = asArr(ev?.passages).map(asRec).filter((p): p is Rec => p !== null);
    const nextSeed = str(origWords[1]?.strongs ?? origWords[0]?.strongs ?? passages[0]?.ref, trimmed);
    queryStr = nextSeed;
  } else if (isPassageLike(trimmed)) {
    parsedPassage = parsePassageString(trimmed);
    if (parsedPassage) queryStr = parsedPassage.normalized;
  } else {
    const lk = await safeCallFirst(read, 'resolve_fast_lookup_v1', { query: trimmed, limit: 3 });
    const first = asArr(lk?.matches).map(asRec).find(Boolean);
    if (first && str(first.bs)) {
      focusLemma = str(first.bs);
      queryStr = focusLemma;
    }
  }

  const isMultiVerseRange = Boolean(
    parsedPassage && (
      parsedPassage.passages.length > 1 ||
      (parsedPassage.passages[0]?.end_verse ?? 0) > (parsedPassage.passages[0]?.start_verse ?? 0)
    ),
  );

  const [disc, rangeCompact] = await Promise.all([
    safeCallFirst(read, 'discover_biblical_connections_v2', {
      query: queryStr,
      ...(focusLemma ? { focus_lemma: focusLemma } : {}),
      limit: Math.min(25, limit * 3),
    }),
    isMultiVerseRange && parsedPassage
      ? fetchCompactPassage(read, {
          passages: parsedPassage.passages.slice(0, 4),
          max_verses: 30,
          offset: 0,
          include_profiles: true,
          profile_limit: 24,
        })
      : Promise.resolve(null),
  ]);

  const rangeExtras: CompactConnection[] = [];
  if (isMultiVerseRange && parsedPassage && rangeCompact) {
    const RANGE_STOP = new Set([
      'H3605', 'G3956', 'H1961', 'G1096', 'H7200', 'G1492', 'G3708', 'H8147', 'G1417',
      'H0559', 'G3004', 'G2036', 'H0834', 'H3588', 'H5921', 'H0413', 'H4480', 'H0376',
      'G2532', 'G0846', 'G3588', 'G1722', 'G1519', 'H3068', 'G2962', 'H0853', 'H5973',
      'H1697', 'H0430', 'H3117', 'H0935', 'H3318', 'H5414', 'H6213',
    ]);
    const FUNC_POS = new Set(['conjunction', 'preposition', 'article', 'particle', 'pronoun', 'cj', 'prep', 'ptcl', 'adv', 'rel', 'om', 'intj', 'pron', 'det', 'conj']);
    const rangeVerseCountByBs = new Map<string, number>();
    const rangeVerses = asArr(rangeCompact.verses).map(asRec).filter((v): v is Rec => v !== null);
    for (const v of rangeVerses) {
      const seenInV = new Set<string>();
      for (const rawT of asArr(v.tokens)) {
        const t = asRec(rawT);
        if (!t) continue;
        const pos = str(t.pos_class).toLowerCase();
        if (FUNC_POS.has(pos)) continue;
        const padBs = padStrongsToken(str(t.strongs));
        if (!padBs || /^H900/.test(padBs) || RANGE_STOP.has(padBs)) continue;
        if (!seenInV.has(padBs)) {
          seenInV.add(padBs);
          rangeVerseCountByBs.set(padBs, (rangeVerseCountByBs.get(padBs) || 0) + 1);
        }
      }
    }
    const profiles = asRec(rangeCompact.profiles) ?? {};
    const scoredSalient = [...rangeVerseCountByBs.entries()]
      .map(([bs, occ]) => {
        const p = asRec(profiles[bs]);
        const tv = typeof p?.total_verses === 'number' && p.total_verses > 0 ? p.total_verses : 150;
        const idf = Math.log2(31203 / Math.max(1, tv));
        const salience = idf * (1 + 0.4 * Math.min(5, occ - 1)) * (tv > 2000 ? 0.35 : 1);
        return { bs, occ, tv, salience, prof: p };
      })
      .sort((a, b) => b.salience - a.salience);

    const topSalient = scoredSalient.slice(0, 4);
    const salientDiscs = await Promise.all(
      topSalient.slice(0, 2).map(s =>
        safeCallFirst(read, 'discover_biblical_connections_v2', {
          query: s.bs,
          focus_lemma: s.bs,
          limit: Math.min(10, Math.max(4, limit)),
        }),
      ),
    );
    for (const sd of salientDiscs) {
      for (const rawC of asArr(sd?.strongest_connections ?? sd?.connections)) {
        const rec = asRec(rawC);
        if (!rec) continue;
        const norm = normalizeDiscoveryConnection(rec);
        if (norm) rangeExtras.push(norm);
      }
    }
    for (const s of topSalient) {
      if (!s.prof) continue;
      if (!visitedNodes.has(s.bs.toLowerCase())) {
        const eid = `passage_lexeme:${parsedPassage.normalized}:${s.bs}`;
        rangeExtras.push({
          id: eid,
          relation: 'passage_salient_lemma',
          epistemic: 'direct_textual_evidence',
          tier: 2,
          title: `Salient lemma across ${parsedPassage.normalized} (${s.occ}/${rangeVerses.length} vv): ${str(s.prof.sc, s.bs)} (${s.bs}) "${str(s.prof.gl)}"`,
          why: `${str(s.prof.sc, s.bs)} (${s.bs}, "${str(s.prof.gl)}") recurs in ${s.occ} verses across ${parsedPassage.normalized} (${s.tv} total corpus vv).`,
          refs: [parsedPassage.normalized],
          target: { strongs: s.bs, script: str(s.prof.sc), transliteration: str(s.prof.tr), gloss: str(s.prof.gl) },
        });
      }
      for (const rawLx of asArr(s.prof.lxx_relations).slice(0, 2)) {
        const lx = asRec(rawLx);
        const tBs = str(lx?.target_strongs);
        const tSc = str(lx?.script);
        if (!tBs && !tSc) continue;
        rangeExtras.push({
          id: `lxx:${s.bs}:${tBs || tSc}`,
          relation: 'lxx_translation_bridge',
          epistemic: 'documented_cross_language_bridge',
          tier: 3,
          title: `LXX bridge from ${parsedPassage.normalized}: ${str(s.prof.sc, s.bs)} (${s.bs}) -> ${tSc} (${tBs})`,
          why: `Salient range lemma ${str(s.prof.sc, s.bs)} (${s.bs}) is rendered in LXX as ${tSc}${str(lx?.gloss) ? ` ("${str(lx?.gloss)}")` : ''}.`,
          refs: [parsedPassage.normalized],
          target: { strongs: tBs || undefined, script: tSc, gloss: str(lx?.gloss) },
        });
      }
    }
    // Include xrefs from verses beyond verse 1 across the range
    for (const v of rangeVerses.slice(1)) {
      const vRef = str(v.ref, parsedPassage.normalized);
      const vid = Number(v.verse_id || 0);
      for (const xr of asArr(v.xrefs).slice(0, 2)) {
        const xc = buildXrefConnection(vRef, vid, xr, true);
        if (xc) rangeExtras.push(xc);
      }
    }
  }

  const seenEdgeIds = new Set<string>();
  const allConns = [
    ...rangeExtras,
    ...asArr(disc?.strongest_connections ?? disc?.connections)
      .map(asRec)
      .filter((c): c is Rec => c !== null)
      .map(normalizeDiscoveryConnection)
      .filter((c): c is CompactConnection => c !== null),
  ].filter(c => {
    if (!c.id || seenEdgeIds.has(c.id)) return false;
    seenEdgeIds.add(c.id);
    return true;
  });

  const unseen = allConns.filter(c => {
    if (visitedEdges.has(c.id)) return false;
    const targetNode = chainEvidenceTarget(c, focusLemma ?? queryStr).toLowerCase();
    if (targetNode && visitedNodes.has(targetNode)) return false;
    if (axisFilter && !matchesAxisFilter(c as unknown as ChainEvidence, axisFilter)) return false;
    return true;
  });

  if (unseen.length === 0 && isPassageLike(trimmed)) {
    const parsed = parsePassageString(trimmed);
    if (parsed) {
      const compact = rangeCompact ?? await fetchCompactPassage(read, {
        passages: parsed.passages.slice(0, 2),
        max_verses: 12,
        offset: 0,
        include_profiles: true,
        profile_limit: 16,
      });
      const fallbackConns: CompactConnection[] = [];
      const profiles = asRec(compact?.profiles) ?? {};
      for (const [bs, rawP] of Object.entries(profiles)) {
        const p = asRec(rawP);
        if (!p || !bs) continue;
        const padBs = padStrongsToken(bs);
        if (visitedNodes.has(padBs.toLowerCase())) continue;
        const eid = `passage_lexeme:${parsed.normalized}:${padBs}`;
        if (!visitedEdges.has(eid)) {
          fallbackConns.push({
            id: eid,
            relation: 'passage_key_lemma',
            epistemic: 'direct_textual_evidence',
            tier: 2,
            title: `Key lemma in ${parsed.normalized}: ${str(p.sc, padBs)} (${padBs}) "${str(p.gl)}"`,
            why: `${parsed.normalized} contains ${str(p.sc, padBs)} (${padBs}, ${p.total_verses ?? 0} vv).`,
            refs: [parsed.normalized],
            target: { strongs: padBs, script: str(p.sc), transliteration: str(p.tr), gloss: str(p.gl) },
          });
        }
        if (!axisFilter || axisFilter === 'lxx') {
          for (const rawLx of asArr(p.lxx_relations).slice(0, 2)) {
            const lx = asRec(rawLx);
            const tBs = str(lx?.target_strongs);
            const tSc = str(lx?.script);
            if ((!tBs && !tSc) || isLxxFunctionEquivalent(tBs, tSc)) continue;
            const lxxId = `lxx:${padBs}:${tBs || tSc}`;
            if (visitedEdges.has(lxxId)) continue;
            fallbackConns.push({
              id: lxxId,
              relation: 'lxx_translation_bridge',
              epistemic: 'documented_cross_language_bridge',
              tier: 3,
              title: `LXX bridge in ${parsed.normalized}: ${str(p.sc, padBs)} (${padBs}) -> ${tSc} (${tBs})`,
              why: `Septuagint renders ${str(p.sc, padBs)} (${padBs}) as ${tSc}${str(lx?.gloss) ? ` ("${str(lx?.gloss)}")` : ''}.`,
              refs: [parsed.normalized],
              target: { strongs: tBs || undefined, script: tSc, gloss: str(lx?.gloss) },
            });
          }
        }
        if (axisFilter === 'wordplay') {
          for (const rawWp of asArr(p.r13_wordplay).slice(0, 2)) {
            const wp = asRec(rawWp);
            const tBs = str(wp?.target_bs);
            if (!tBs || visitedNodes.has(tBs.toLowerCase())) continue;
            const wpId = `r13:wp:${padBs}:${tBs}`;
            if (visitedEdges.has(wpId)) continue;
            fallbackConns.push({
              id: wpId,
              relation: 'orthographic_wordplay',
              epistemic: str(wp?.evidence_type) === 'attested_textual_wordplay' ? 'direct_textual_evidence' : 'candidate_literary_pattern',
              tier: str(wp?.evidence_type) === 'attested_textual_wordplay' ? 2 : 4,
              title: `Wordplay candidate from ${padBs}: ${str(p.sc, padBs)} <-> ${str(wp?.target_script, tBs)} (${tBs})`,
              why: `Shared consonants "${str(wp?.shared_consonants)}" in context of ${parsed.normalized}.`,
              refs: [parsed.normalized],
              target: { strongs: tBs, script: str(wp?.target_script), gloss: str(wp?.target_gloss) },
            });
          }
        }
      }
      for (const rawV of asArr(compact?.verses)) {
        const v = asRec(rawV);
        if (!v) continue;
        const vRef = str(v.ref, parsed.normalized);
        const vid = Number(v.verse_id || 0);
        for (const xr of asArr(v.xrefs).slice(0, 3)) {
          const xc = buildXrefConnection(vRef, vid, xr, true);
          if (!xc || visitedEdges.has(xc.id)) continue;
          const tNode = chainEvidenceTarget(xc, vRef).toLowerCase();
          if (tNode && visitedNodes.has(tNode)) continue;
          fallbackConns.push(xc);
        }
      }
      if (fallbackConns.length > 0) {
        unseen.push(...fallbackConns.filter(c => !axisFilter || matchesAxisFilter(c as unknown as ChainEvidence, axisFilter)));
      }
    }
  } else if (unseen.length === 0 && focusLemma) {
    const batch = await safeCallFirst(read, 'get_word_profiles_batch_v1', {
      strongs: [focusLemma],
      include_vids: false,
      include_forms: false,
      include_orth: false,
      include_pilot: false,
    });
    const prof = asRec(asRec(batch?.profiles)?.[focusLemma]);
    if (prof) {
      const derived = buildProfileDerivedConnections(prof, limit);
      for (const c of derived) {
        if (visitedEdges.has(c.id)) continue;
        const tNode = chainEvidenceTarget(c, focusLemma).toLowerCase();
        if (tNode && visitedNodes.has(tNode)) continue;
        if (axisFilter && !matchesAxisFilter(c as unknown as ChainEvidence, axisFilter)) continue;
        unseen.push(c);
      }
      if (unseen.length === 0) {
        for (const rawOcc of asArr(prof.first_occ_passages).slice(0, limit)) {
          const occ = asRec(rawOcc);
          const ref = str(occ?.ref);
          if (!ref || visitedNodes.has(ref.toLowerCase())) continue;
          const eid = `first_occ:${focusLemma}:${ref}`;
          if (visitedEdges.has(eid)) continue;
          unseen.push({
            id: eid,
            relation: 'lexical_occurrence_passage',
            epistemic: 'direct_textual_evidence',
            tier: 2,
            title: `${str(prof.sc, focusLemma)} (${focusLemma}, "${str(prof.gl)}") in ${ref}`,
            why: str(occ?.snippet, `Attested occurrence of ${focusLemma} at ${ref}.`),
            refs: [ref],
          });
        }
      }
    }
  }

  unseen.sort((a, b) => {
    const isNoise = (c: CompactConnection) =>
      c.epistemic === 'orthographic_similarity_only' ||
      c.id.startsWith('r13:orth:') ||
      c.id.startsWith('orth:') ||
      (c.id.startsWith('r13:wp:') && c.epistemic !== 'direct_textual_evidence');
    return (Number(isNoise(a)) - Number(isNoise(b))) || ((a.tier ?? 3) - (b.tier ?? 3));
  });

  const layerFiltered = layerMode === 'source_only'
    ? unseen.filter(c => {
        if (c.id.startsWith('r12:prop:') || c.relation === 'shared_external_property') return false;
        const ep = normalizeEpistemicClass(c.epistemic, 'semantic_hypothesis', c.evidence_type);
        return ep !== 'semantic_hypothesis' && ep !== 'external_world_fact' && ep !== 'user_note' && ep !== 'shared_motif_evidence';
      })
    : unseen;

  const filtered = filterConnectionsForPrimary(layerFiltered, focusLemma ?? '', limit, Boolean(focusLemma));
  const upstreamUnavailable = !disc && (!isMultiVerseRange || !rangeCompact);
  if (layerMode === 'combined') {
    const kgConns = (await fetchKgNeighborsForChain(read, focusLemma ?? trimmed, Math.min(6, limit))) as unknown as CompactConnection[];
    const unseenKg = kgConns.filter(c => !visitedEdges.has(c.id));
    return {
      resolvedNode: focusLemma ?? queryStr,
      neighbors: [...unseenKg, ...filtered].slice(0, limit),
      ...(upstreamUnavailable ? { upstreamUnavailable: true } : {}),
    };
  }
  return {
    resolvedNode: focusLemma ?? queryStr,
    neighbors: filtered,
    ...(upstreamUnavailable ? { upstreamUnavailable: true } : {}),
  };
}

export function createDiscoveryV2Server(
  read: DatabaseReader,
  writer: NotesWriter | null,
  chainStore: ChainStore,
  getHeaders?: () => Headers | undefined,
): McpServer {
  const server = new McpServer(
    { name: 'BibleResearch', version: WORKFLOW_VERSION },
    { instructions: SERVER_INSTRUCTIONS_V2 },
  );

  // 1. get_Passage
  server.registerTool('get_Passage', {
    title: 'Read original-language Bible passage with connections and context',
    description:
      'Primary tool for reading any verse, range, or chapter (including cross-chapter ranges like "1COR12:10-1COR13:4" and Psalm headings like "Ps 45:0"). Defaults to view="clues" (2-6 KB crisp progressive clues with expand_id handles, E_perp, and axes). Pass view="evidence" or view="full", or pass expand_id to hydrate any clue on demand.',
    inputSchema: z.strictObject({
      passage: z.string().trim().min(1).max(160).optional().describe('Verse, range, or chapter (e.g. "Gen 6:14", "Zechariah 4", "1COR12:10-1COR13:4", "Ps 45:0"). Required unless expand_id is provided.'),
      depth: z.number().int().min(0).max(25).default(3).describe('Top z connections for the passage and for each verse (0 omits connections).'),
      word_depth: z.number().int().min(0).max(15).default(0).describe('Top x connections per content word in shared lexicon (0 omits per-word connections).'),
      etymology: z.number().int().min(0).max(15).default(0).describe('0 omits; y > 0 adds documented roots/formations plus up to y separated spelling suggestions.'),
      realworld: z.union([z.literal(0), z.literal(1), z.boolean()]).default(0).describe('0 omits; 1 adds supported biblical/physical definitions and external property bridges.'),
      literary: z.number().int().min(0).max(2).default(1).describe('0 omits literary structure; 1 adds compact structural summary (default); 2 adds standard pattern_families, template cells, alternatives, and occurrence word_ids.'),
      offset: z.number().int().min(0).max(200).default(0).describe('Verse offset when paginating long ranges.'),
      limit: z.number().int().min(1).max(40).default(30).describe('Maximum complete verses per call (default 30, max 40).'),
      compact: z.boolean().optional().describe('Optional slim payload projection: strips token word_id/tr/code and secondary lexicon sections while keeping text, glosses, links, and literary summary.'),
      view: ViewAliasSchema.optional().describe('Progressive detail level: "clues" (default, crisp <=6-12 KB clues with expand_id), "evidence" (token/witness hydration), or "full".'),
      detail: ViewAliasSchema.optional().describe('Alias for view.'),
      expand_id: z.string().trim().min(1).max(220).optional().describe('Optional expand_id handle from a prior clue to hydrate rich witnesses/alignments on demand.'),
    }),
    ...readOnlyMeta,
  }, async ({ passage, depth = 3, word_depth = 0, etymology = 0, realworld = 0, literary = 1, offset = 0, limit = 30, compact = false, view, detail, expand_id }) => {
    const resolvedView = resolveViewMode(view, detail);
    try {
      if (expand_id) {
        const expDetail = resolvedView === 'full' ? 'full' : 'evidence';
        return jsonReply(await expandClueById(read, expand_id, expDetail));
      }
      if (!passage) {
        return errorReply('Provide passage (e.g. "Gen 6:14") or expand_id.');
      }
      const payload = await handleGetPassage(read, {
        passage,
        depth,
        word_depth,
        etymology,
        realworld: parseRealworldFlag(realworld),
        literary,
        offset,
        limit,
        compact,
        view: resolvedView,
      });
      return jsonReply(payload);
    } catch {
      return errorReply('Passage retrieval is temporarily unavailable.');
    }
  });

  // 2. get_Word
  server.registerTool('get_Word', {
    title: 'Inspect an original-language biblical word and its connections',
    description:
      'Primary lexical tool accepting English concepts, pointed Hebrew/Greek script, transliteration ("Ruach", "pyroo"), Strong\'s ("H4417"), or a word in a specific passage. Defaults to view="clues" with sense-gated real-world properties, ambiguous candidates, and expand_id handles; pass view="evidence"|"full" or expand_id for deeper hydration.',
    inputSchema: z.strictObject({
      word: z.string().trim().min(1).max(128).optional().describe('English word, original Hebrew/Greek, transliteration, lemma, or Strong\'s ID (e.g. "Ruach", "H7307", "πνεῦμα", "kaphar"). Required unless expand_id is provided.'),
      connections: z.number().int().min(0).max(25).optional().describe('Top x diverse connections with short witnesses (default 10).'),
      occurrences: z.number().int().min(0).max(50).optional().describe('Optional cap on occurrence sample references returned (default 3 in clues view).'),
      etymology: z.number().int().min(0).max(15).default(0).describe('0 omits; y > 0 adds documented roots/formations plus up to y separated spelling-similarity candidates.'),
      passage: z.string().trim().min(1).max(120).optional().describe('Optional passage reference (e.g. "Gen 6:14") to anchor a specific occurrence.'),
      mode: z.enum(['discover', 'bridge']).optional().describe('Optional discovery mode: "discover" (default) or "bridge" for physical-world property bridges.'),
      realworld: z.union([z.literal(0), z.literal(1), z.boolean()]).default(1).describe('1 (default) includes supported real-world/physical definitions and property bridges; 0 omits.'),
      view: ViewAliasSchema.optional().describe('Progressive detail level: "clues" (default, concise <=6 KB), "evidence", or "full".'),
      detail: ViewAliasSchema.optional().describe('Alias for view.'),
      expand_id: z.string().trim().min(1).max(220).optional().describe('Optional expand_id handle to hydrate rich evidence on demand.'),
    }),
    ...readOnlyMeta,
  }, async ({ word, connections, occurrences: occLimit, etymology = 0, passage, mode, realworld = 1, view, detail, expand_id }) => {
    const resolvedView = resolveViewMode(view, detail);
    const connLimit = connections ?? 10;
    try {
      if (expand_id) {
        const expDetail = resolvedView === 'full' ? 'full' : 'evidence';
        return jsonReply(await expandClueById(read, expand_id, expDetail));
      }
      if (!word) {
        return errorReply('Provide word or expand_id.');
      }
      const res = await buildFullCompactWord(read, word, {
        connections: connLimit,
        etymology,
        realworld: parseRealworldFlag(realworld),
        passage,
        ...(mode ? { mode } : {}),
      });
      if (!res.word) {
        return jsonReply({
          status: res.warnings.length > 0 ? 'partial' : 'not_found',
          view: resolvedView,
          query: word,
          resolution: 'not_found',
          discovery_status: res.discovery_status,
          coverage: res.coverage,
          ...(res.warnings.length > 0 ? { warnings: res.warnings } : {}),
          message: res.warnings.length > 0
            ? `Lexical lookup partially unavailable for "${word}"; retry before assuming absence.`
            : `No canonical Hebrew/Greek lexical entry found matching "${word}".`,
        });
      }
      const rawOccSamples = asArr(res.occurrences?.samples);
      if (resolvedView === 'clues') {
        const sampleCap = occLimit !== undefined ? occLimit : 3;
        const clueWord: Rec = {
          ...(res.word.form ? { form: res.word.form } : {}),
          lemma: res.word.lemma,
          strongs: res.word.strongs,
          ...(res.word.lemma_key ? { lemma_key: res.word.lemma_key } : {}),
          transliteration: res.word.transliteration,
          gloss: res.word.gloss,
          ...(res.word.pos ? { pos: res.word.pos } : {}),
          ...(res.word.total_verses !== undefined ? { total_verses: res.word.total_verses } : {}),
          ...(res.word.senses ? { senses: res.word.senses.slice(0, 4).map(s => ({ ...(s.key ? { key: s.key } : {}), gloss: s.gloss })) } : {}),
          ...(res.word.lxx ? { lxx: res.word.lxx.slice(0, 3) } : {}),
          ...(res.word.etymology ? { etymology: res.word.etymology } : {}),
          ...(res.word.realworld ? { realworld: res.word.realworld } : {}),
          ...(res.word.connections ? { connections: res.word.connections.slice(0, Math.min(connLimit, 4)).map(c => projectClue(c, 'clues')) } : {}),
          ...(sampleCap > 0 && rawOccSamples.length > 0
            ? { occurrences_sample: rawOccSamples.slice(0, sampleCap).map(s => ({ ref: str(asRec(s)?.ref) })).filter(s => s.ref) }
            : {}),
        };
        return jsonReply({
          status: res.status,
          view: 'clues',
          query: word,
          ...(res.discovery_status !== 'ok' ? { discovery_status: res.discovery_status } : {}),
          ...(res.warnings.length > 0 ? { warnings: res.warnings } : {}),
          ...(res.anchored_occurrence ? { anchored_occurrence: res.anchored_occurrence } : {}),
          word: clueWord,
          resolution: res.ambiguousCandidates.length ? 'selected_candidate_with_alternatives' : 'selected_lexical_entry',
          ...(res.ambiguousCandidates.length > 0 ? { ambiguous_candidates: res.ambiguousCandidates } : {}),
        });
      }
      const occurrencesOut = occLimit !== undefined
        ? { ...res.occurrences, samples: rawOccSamples.slice(0, occLimit) }
        : res.occurrences;
      return jsonReply({
        status: res.status,
        view: resolvedView,
        query: word,
        discovery_status: res.discovery_status,
        coverage: res.coverage,
        ...(res.warnings.length > 0 ? { warnings: res.warnings } : {}),
        ...(res.anchored_occurrence ? { anchored_occurrence: res.anchored_occurrence } : {}),
        word: {
          ...res.word,
          ...(res.word.connections ? { connections: res.word.connections.map(c => projectClue(c, resolvedView)) } : {}),
        },
        grammar_forms: res.grammarForms,
        grammar_forms_scope: 'Attested forms of this Strong\'s group, including possible homograph lemmas; not morphology of the selected occurrence.',
        resolution: res.ambiguousCandidates.length ? 'selected_candidate_with_alternatives' : 'selected_lexical_entry',
        occurrences: occurrencesOut,
        ambiguous_candidates: res.ambiguousCandidates,
      });
    } catch {
      return errorReply('Word lookup is temporarily unavailable.');
    }
  });

  // 3. get_Connection
  server.registerTool('get_Connection', {
    title: 'Find actual textual and lexical links between words or passages',
    description:
      'Compare 2 to 6 words, passages, or mixed inputs (e.g. ["Genesis 6:14", "Exodus 2:3"], ["Ruach", "Zechariah 4"], ["Zechariah 4", "Revelation 11"]). Defaults to view="clues" (non-redundant clues with expand_id handles and graph_proof). Pass view="evidence"|"full" or expand_id to hydrate rich witnesses/subgraphs.',
    inputSchema: z.strictObject({
      items: z.array(z.string().trim().min(1).max(200)).min(2).max(6).optional().describe('Two or more words, Strong\'s IDs, concepts, or passage references to compare. Required unless expand_id is provided.'),
      connections: z.number().int().min(1).max(25).default(10).describe('Maximum connections to return (default 10).'),
      compact: z.boolean().optional().describe('Optional slim payload projection omitting verbose per-card witnesses and ranking breakdowns.'),
      view: ViewAliasSchema.optional().describe('Progressive detail level: "clues" (default, crisp <=6 KB clues), "evidence", or "full".'),
      detail: ViewAliasSchema.optional().describe('Alias for view.'),
      expand_id: z.string().trim().min(1).max(220).optional().describe('Optional expand_id handle to hydrate rich evidence or subgraph witnesses on demand.'),
    }),
    ...readOnlyMeta,
  }, async ({ items, connections = 10, compact = false, view, detail, expand_id }) => {
    const resolvedView = resolveViewMode(view, detail);
    try {
      if (expand_id) {
        const expDetail = resolvedView === 'full' ? 'full' : 'evidence';
        return jsonReply(await expandClueById(read, expand_id, expDetail));
      }
      if (!items || items.length < 2) {
        return errorReply('Provide at least 2 items to compare or an expand_id.');
      }
      const payload = await handleGetConnection(read, items, connections, compact, resolvedView);
      return jsonReply(payload);
    } catch {
      return errorReply('Connection comparison is temporarily unavailable.');
    }
  });

  // 4. follow_connectionchain
  server.registerTool('follow_connectionchain', {
    title: 'Start, follow, branch, or revisit a remembered connection chain',
    description:
      'Maintains a private expiring server-side session chain of visited nodes and evidence so you can explore multi-step connections without repeating already-seen nodes. Omit chain with next/next_id="..." to start; pass chain handle with action="follow"|"branch"|"revisit"|"inspect" and optional axis_filter. Defaults to view="clues" (< 8 KB wire); pass view="evidence"|"full" or expand_id to hydrate.',
    inputSchema: z.strictObject({
      chain: z.string().trim().min(10).max(4000).optional().describe('Opaque chain handle returned by a prior follow_connectionchain call. Omit to start a new chain.'),
      next: z.string().trim().min(1).max(220).optional().describe('Target word, passage, or evidence_id to seed or advance to.'),
      next_id: z.string().trim().min(1).max(220).optional().describe('Alias for next: explicit clue/edge ID or next_id handle from a prior step.'),
      action: z.enum(['follow', 'branch', 'revisit', 'inspect']).default('follow').describe('Action on an existing chain (default: follow).'),
      from_node: z.string().trim().min(1).max(220).optional().describe('Node or step to branch from or revisit.'),
      axis_filter: z.enum(['lexical', 'lxx', 'wordplay', 'structure', 'concept_proc', 'xref']).optional().describe('Optional axis filter for neighbor suggestions.'),
      layer_mode: z.enum(['source_only', 'algorithm_only', 'research_only', 'combined']).optional().describe('Optional layer filter: algorithm_only (default), source_only, research_only (persistent KG), or combined.'),
      limit: z.number().int().min(1).max(25).default(8).describe('Maximum next connections to return (default 8).'),
      view: ViewAliasSchema.optional().describe('Progressive detail level: "clues" (default), "evidence", or "full".'),
      detail: ViewAliasSchema.optional().describe('Alias for view.'),
      expand_id: z.string().trim().min(1).max(220).optional().describe('Optional expand_id handle to hydrate rich evidence for a chain step.'),
    }),
    ...readOnlyMeta,
  }, async ({ chain, next, next_id, action = 'follow', from_node, axis_filter, layer_mode = 'algorithm_only', limit = 8, view, detail, expand_id }) => {
    const resolvedView = resolveViewMode(view, detail);
    const sessionId = getHeaders?.()?.get('mcp-session-id') ?? getHeaders?.()?.get('Mcp-Session-Id') ?? null;
    try {
      if (expand_id) {
        const expDetail = resolvedView === 'full' ? 'full' : 'evidence';
        return jsonReply(await expandClueById(read, expand_id, expDetail));
      }
      const initialTarget = next || next_id;
      if (!chain) {
        if (!initialTarget) {
          return errorReply('Provide next or next_id (a word, passage, or evidence_id) to start a new connection chain.');
        }
        const visitedNodes = new Set<string>([initialTarget.toLowerCase()]);
        const { resolvedNode, neighbors, upstreamUnavailable } = await fetchNodeNeighbors(read, initialTarget, visitedNodes, new Set(), limit, axis_filter, layer_mode);
        visitedNodes.add(resolvedNode.toLowerCase());
        const initPayload = {
          root: resolvedNode,
          current_node: resolvedNode,
          visited_nodes: [...visitedNodes],
          visited_edges: [],
          steps: [],
          branches: [],
          active_candidates: neighbors as unknown as Rec[],
        };
        const created = await chainStore.create(initPayload, sessionId);
        const nowIso = new Date().toISOString();
        const fallbackState: ChainState = created.ok
          ? created.state
          : {
              chain_id: 'stateless',
              ...initPayload,
              created_at: nowIso,
              updated_at: nowIso,
              expires_at: new Date(Date.now() + CHAIN_DEFAULT_TTL_MS).toISOString(),
            };
        const compositeHandle = formatCompositeChainHandle(created.ok ? created.handle : null, fallbackState, sessionId);
        const initStatus = upstreamUnavailable ? (neighbors.length > 0 ? 'partial' : 'unavailable') : 'ok';
        return jsonReply({
          status: initStatus,
          ...(upstreamUnavailable ? {
            warnings: ['Upstream discovery graph temporarily unavailable while expanding chain seed; retry or inspect next_connections.'],
            retryable: neighbors.length === 0,
          } : {}),
          view: resolvedView,
          chain: compositeHandle,
          expires_at: fallbackState.expires_at,
          step: 0,
          current_node: fallbackState.current_node,
          path_trail: [fallbackState.root],
          visited_count: fallbackState.visited_nodes.length,
          chain_epistemic_summary: summarizeChainEpistemics(fallbackState.steps),
          next_connections: withChainNext(neighbors, fallbackState.current_node, resolvedView),
          branches: fallbackState.branches,
        });
      }

      const { storeHandle, statelessToken } = parseCompositeChainHandle(chain);
      let loadedState: ChainState | null = null;
      let isStatelessFallback = !storeHandle;

      if (storeHandle) {
        const loaded = await chainStore.load(storeHandle, sessionId);
        if (loaded.ok) {
          loadedState = loaded.state;
        } else if ((loaded.error === 'chain_not_found' || loaded.error === 'chain_store_error') && statelessToken) {
          const decoded = decodeStatelessChainToken(statelessToken, sessionId);
          if (!decoded.ok) return errorReply(decoded.message, { code: decoded.error });
          loadedState = decoded.state;
          isStatelessFallback = true;
        } else {
          return errorReply(loaded.message, { code: loaded.error });
        }
      } else if (statelessToken) {
        const decoded = decodeStatelessChainToken(statelessToken, sessionId);
        if (!decoded.ok) return errorReply(decoded.message, { code: decoded.error });
        loadedState = decoded.state;
      } else {
        return errorReply('Invalid connection chain handle.', { code: 'invalid_chain_handle' });
      }

      const st: ChainState = {
        ...loadedState,
        visited_nodes: [...loadedState.visited_nodes],
        visited_edges: [...loadedState.visited_edges],
        steps: [...loadedState.steps],
        branches: [...loadedState.branches],
      };

      const persistOrEncode = async (): Promise<{ ok: true; handle: string; state: ChainState } | { ok: false; error: string; message: string }> => {
        if (!isStatelessFallback && storeHandle) {
          const updated = await chainStore.update(storeHandle, st, sessionId);
          if (updated.ok) {
            return {
              ok: true,
              handle: formatCompositeChainHandle(storeHandle, updated.state, sessionId),
              state: updated.state,
            };
          }
          if (updated.error !== 'chain_not_found' && updated.error !== 'chain_store_error') {
            return { ok: false, error: updated.error, message: updated.message };
          }
        }
        st.updated_at = new Date().toISOString();
        return {
          ok: true,
          handle: formatCompositeChainHandle(null, st, sessionId),
          state: st,
        };
      };

      if (action === 'inspect') {
        const visitedSet = new Set(st.visited_nodes.map(v => v.toLowerCase()));
        const edgeSet = new Set(st.visited_edges);
        const { neighbors } = await fetchNodeNeighbors(read, st.current_node, visitedSet, edgeSet, limit, axis_filter, layer_mode);
        st.active_candidates = neighbors as unknown as Rec[];
        const saved = await persistOrEncode();
        if (!saved.ok) return errorReply(saved.message, { code: saved.error });
        return jsonReply({
          status: 'ok',
          view: resolvedView,
          chain: saved.handle,
          expires_at: saved.state.expires_at,
          step: saved.state.steps.length,
          current_node: saved.state.current_node,
          path_trail: [saved.state.root, ...saved.state.steps.map(s => `${s.from_node} -> ${s.to_node} [${s.relation}]`)],
          visited_count: saved.state.visited_nodes.length,
          chain_epistemic_summary: summarizeChainEpistemics(saved.state.steps),
          next_connections: withChainNext(neighbors, saved.state.current_node, resolvedView),
          branches: saved.state.branches,
        });
      }

      if (action === 'revisit') {
        const target = from_node || initialTarget || st.root;
        st.current_node = target;
        const visitedSet = new Set(st.visited_nodes.map(v => v.toLowerCase()));
        const edgeSet = new Set(st.visited_edges);
        const { neighbors } = await fetchNodeNeighbors(read, target, visitedSet, edgeSet, limit, axis_filter, layer_mode);
        st.active_candidates = neighbors as unknown as Rec[];
        const saved = await persistOrEncode();
        if (!saved.ok) return errorReply(saved.message, { code: saved.error });
        return jsonReply({
          status: 'ok',
          view: resolvedView,
          chain: saved.handle,
          action: 'revisit',
          expires_at: saved.state.expires_at,
          step: saved.state.steps.length,
          current_node: saved.state.current_node,
          path_trail: [saved.state.root, ...saved.state.steps.map(s => `${s.from_node} -> ${s.to_node} [${s.relation}]`)],
          visited_count: saved.state.visited_nodes.length,
          chain_epistemic_summary: summarizeChainEpistemics(saved.state.steps),
          next_connections: withChainNext(neighbors, saved.state.current_node, resolvedView),
          branches: saved.state.branches,
        });
      }

      if (action === 'branch') {
        const origin = from_node || st.current_node;
        const branchId = `br_${st.branches.length + 1}`;
        st.branches.push({
          branch_id: branchId,
          from_step: st.steps.length,
          from_node: origin,
          created_at: new Date().toISOString(),
        });
        st.current_node = origin;
        if (!initialTarget) {
          const visitedSet = new Set(st.visited_nodes.map(v => v.toLowerCase()));
          const edgeSet = new Set(st.visited_edges);
          const { neighbors } = await fetchNodeNeighbors(read, origin, visitedSet, edgeSet, limit, axis_filter, layer_mode);
          st.active_candidates = neighbors as unknown as Rec[];
          const saved = await persistOrEncode();
          if (!saved.ok) return errorReply(saved.message, { code: saved.error });
          return jsonReply({
            status: 'ok',
            view: resolvedView,
            chain: saved.handle,
            action: 'branch',
            branch_id: branchId,
            expires_at: saved.state.expires_at,
            step: saved.state.steps.length,
            current_node: saved.state.current_node,
            chain_epistemic_summary: summarizeChainEpistemics(saved.state.steps),
            next_connections: withChainNext(neighbors, saved.state.current_node, resolvedView),
            branches: saved.state.branches,
          });
        }
      }

      let resolvedNext = initialTarget;
      if (action === 'follow' && !resolvedNext && Array.isArray(st.active_candidates) && st.active_candidates.length > 0) {
        const firstCand = st.active_candidates[0] as unknown as ChainEvidence;
        resolvedNext = chainEvidenceTarget(firstCand, st.current_node) || String((firstCand as unknown as Rec).id || '');
      }
      if (!resolvedNext) {
        return errorReply('Provide next or next_id (a target word, passage, or evidence_id) to follow this chain.', {
          code: 'invalid_request',
        });
      }
      const targetNext = resolvedNext;

      const fromNode = action === 'branch' && from_node ? from_node : st.current_node;
      let edgeId: string | undefined;
      let relation = 'exploratory_step';
      let epistemic = 'exploratory_hypothesis';
      let stepRefs: string[] = [];
      let toNode = targetNext;

      // Preserve a selected returned edge, including ordinary passage targets.
      // A branch origin has different candidates; never reuse the prior node's list.
      let candidates = action === 'branch' && from_node
        ? [] : (st.active_candidates ?? []) as unknown as ChainEvidence[];
      let selected = selectChainEvidence(candidates, fromNode, targetNext);
      if (!selected) {
        const origin = await fetchNodeNeighbors(read, fromNode, new Set(), new Set(), 15, axis_filter, layer_mode);
        candidates = origin.neighbors;
        selected = selectChainEvidence(candidates, fromNode, targetNext);
      }
      if (selected) {
        edgeId = selected.id;
        relation = selected.relation;
        epistemic = selected.epistemic;
        stepRefs = selected.refs;
        if (targetNext === selected.id || targetNext === selected.expand_id) {
          toNode = chainEvidenceTarget(selected, fromNode);
        }
      } else if (/^r1[0123]:|^v3:/i.test(targetNext)) {
        const rawEv = /^v3:/i.test(targetNext)
          ? await safeCallFirst(read, 'expand_clue_v3', { expand_id: targetNext, detail: 'evidence' })
          : await safeCallFirst(read, 'get_connection_evidence_v1', { evidence_id: targetNext });
        const ev = unwrapEvidencePayload(rawEv);
        if (ev && rawEv?.status !== 'not_found') {
          edgeId = targetNext;
          relation = str(ev.predicate ?? ev.relation ?? ev.kind, relation);
          epistemic = str(ev.epistemic_class ?? ev.epistemic, 'documented_lexical_relationship');
          stepRefs = asArr(ev.passages).map(asRec).filter(Boolean).map(p => str(p?.ref)).filter(Boolean).slice(0, 4);
          const words = asArr(ev.original_words).map(asRec).filter(Boolean);
          const cand = words.find(w => str(w?.strongs).toLowerCase() !== fromNode.toLowerCase());
          toNode = str(cand?.strongs) || stepRefs[0] || str(asRec(ev.pivot)?.ref) || str(asRec(ev.verse)?.ref) || targetNext;
        }
      } else {
        // Pairwise fallback when manually jumping to a target not present in top-15 single-anchor neighbors
        const pairRes = await handleGetConnection(read, [fromNode, targetNext], 5, false, 'evidence').catch(() => null);
        const pairCand = asArr(pairRes?.complete_multi_anchor)
          .concat(asArr(pairRes?.direct_pairwise))
          .concat(asArr(pairRes?.indirect_paths))
          .map(asRec)
          .find(Boolean);
        if (pairCand) {
          edgeId = str(pairCand.id) || undefined;
          relation = str(pairCand.relation, relation);
          epistemic = str(pairCand.epistemic, epistemic);
          stepRefs = asArr(pairCand.refs).filter((r): r is string => typeof r === 'string').slice(0, 4);
        }
      }

      const visitedSet = new Set(st.visited_nodes.map(v => v.toLowerCase()));
      const edgeSet = new Set(st.visited_edges);
      if (edgeId) edgeSet.add(edgeId);
      const { resolvedNode, neighbors } = await fetchNodeNeighbors(read, toNode, visitedSet, edgeSet, limit, axis_filter, layer_mode);
      if (!visitedSet.has(toNode.toLowerCase())) st.visited_nodes.push(toNode);
      visitedSet.add(toNode.toLowerCase());
      if (!visitedSet.has(resolvedNode.toLowerCase())) st.visited_nodes.push(resolvedNode);
      if (edgeId && !st.visited_edges.includes(edgeId)) st.visited_edges.push(edgeId);
      st.active_candidates = neighbors as unknown as Rec[];

      const newStep: ChainStep = {
        step_index: st.steps.length + 1,
        from_node: fromNode,
        to_node: resolvedNode,
        ...(edgeId ? { edge_id: edgeId } : {}),
        relation,
        epistemic,
        refs: stepRefs,
        ...(action === 'branch' ? { branched_from_step: st.steps.length } : {}),
      };
      st.steps.push(newStep);
      st.current_node = resolvedNode;

      const saved = await persistOrEncode();
      if (!saved.ok) return errorReply(saved.message, { code: saved.error });

      return jsonReply({
        status: 'ok',
        view: resolvedView,
        chain: saved.handle,
        expires_at: saved.state.expires_at,
        step: saved.state.steps.length,
        added_step: newStep,
        current_node: saved.state.current_node,
        path_trail: [saved.state.root, ...saved.state.steps.map(s => `${s.from_node} -> ${s.to_node} [${s.relation}]`)],
        visited_count: saved.state.visited_nodes.length,
        chain_epistemic_summary: summarizeChainEpistemics(saved.state.steps),
        next_connections: withChainNext(neighbors, saved.state.current_node, resolvedView),
        branches: saved.state.branches,
      });
    } catch {
      return errorReply('Connection chain traversal failed.');
    }
  });

  // 5. research
  server.registerTool('research', {
    title: 'Run targeted combined searches and calculations',
    description:
      'Flexible composable investigation tool. Supply query, expand_id, or 1-8 structured operations (`{ op, ... }`). v3 flagship ops: `lxx_concordance`, `tri_textual_diff`, `clause_role_query`, `sequence_parallels`, `wordplay_scan`, `expand_clue`, and bitset `set_combine`, plus persistent Research Knowledge Graph ops (`kg_search`, `kg_dossier`, `kg_neighbors`, `kg_paths`, `kg_trace`, `kg_contradictions`, `kg_trail`), alongside `evidence`, `occurrences`, `intersect_words`, `grammar_search`, `lxx`, `gematria`, `numbers`, `chronology_occurrences`, `geography_search`, `passage_compare`, `notes_search`, `discover_patterns`, `compare_patterns`, `trace_evidence`, `literary_structure`, `genealogy`, `tribe_lineage`, `sacred_architecture`, `feasts_calendar`.',
    inputSchema: z.strictObject({
      query: z.string().trim().min(1).max(400).optional().describe('Shorthand query (evidence_id, passages to compare, or topic/concept).'),
      operations: z.array(ResearchOpInputSchema).min(1).max(8).optional().describe('Batch of 1-8 declarative operations executed together with optional set_combine across results.'),
      limit: z.number().int().min(1).max(100).optional().describe('Default per-operation result cap (default 15, max 50).'),
      view: ViewAliasSchema.optional().describe('Progressive detail level: "clues" (default), "evidence", or "full".'),
      detail: ViewAliasSchema.optional().describe('Alias for view.'),
      expand_id: z.string().trim().min(1).max(220).optional().describe('Optional expand_id handle to hydrate rich evidence on demand.'),
    }),
    ...readOnlyMeta,
  }, async ({ query, operations, limit, view, detail, expand_id }) => {
    const resolvedView = resolveViewMode(view, detail);
    try {
      if (expand_id && !operations) {
        const expDetail = resolvedView === 'full' ? 'full' : 'evidence';
        return jsonReply(await expandClueById(read, expand_id, expDetail));
      }
      const payload = await executeResearch(read, { query, operations, limit, view: resolvedView, detail });
      return jsonReply(payload);
    } catch {
      return errorReply('Research query execution failed.');
    }
  });

  // 6. write_Note (when writer enabled)
  if (writer) {
    const noteRefInput = z.strictObject({
      passage: z.string().trim().min(1).max(100).optional().describe('Verse reference like "Gen 6:14" or "Ps 45:0".'),
      book: z.number().int().min(1).max(66).optional(),
      chapter: z.number().int().min(1).max(150).optional(),
      verse: z.number().int().min(0).max(176).optional(),
      word_position: z.number().int().min(1).optional(),
      word_id: z.number().int().positive().optional(),
      role: z.enum(['subject', 'object', 'mention', 'evidence']).optional(),
    });

    server.registerTool('write_Note', {
      title: 'Create, update, delete, or save DLM/Knowledge Graph research (user-authorized only)',
      description:
        'Preserves existing note-writing permissions, agent-key auth, ownership, kill switch, and DLM evidence separation. Only call when the user explicitly authorizes saving/updating/deleting research. Supports note actions ("create"|"update"|"delete"|"save_dlm") and persistent Knowledge Graph actions ("kg_save_batch"|"kg_update_claim"|"kg_challenge"|"kg_supersede"|"kg_save_trail").',
      inputSchema: z.strictObject({
        action: z.enum([
          'create', 'update', 'delete', 'save_dlm',
          'kg_save_batch', 'kg_update_claim', 'kg_challenge', 'kg_supersede', 'kg_save_trail',
        ]).default('create'),
        note_id: z.string().trim().max(64).optional().describe('Required UUID for update or delete.'),
        expected_version: z.number().int().min(1).optional().describe('Required current version for update.'),
        title: z.string().trim().max(200).optional(),
        body_md: z.string().trim().min(1).max(20000).optional(),
        note_kind: z.enum(noteKinds).optional(),
        language: z.string().trim().max(16).optional(),
        confidence: z.number().min(0).max(1).optional(),
        references: z.array(noteRefInput).min(1).max(8).optional().describe('Verse/word targets by passage string or canonical book/chapter/verse.'),
        anchors: z.array(noteAnchorInputSchema).min(1).max(20).optional().describe('Explicit database anchor objects.'),
        connections: z.array(noteConnectionInputSchema).max(20).optional(),
        blocks: z.array(noteBlockInputSchema).max(10).optional(),
        source_context: z.record(z.string(), z.unknown()).optional(),
        model: z.string().trim().max(80).optional(),
        dlm: dlmCardInputSchema.optional().describe('Required payload when action="save_dlm".'),
        kg: kgBatchInputSchema.optional().describe('Batch payload (nodes, claims, links) when action="kg_save_batch".'),
        claim: kgClaimInputSchema.partial({ claim_kind: true, predicate: true, evidence_class: true }).optional().describe('Claim payload for kg_update_claim, kg_challenge, or kg_supersede.'),
        target_claim_id: z.string().trim().max(64).optional().describe('Target claim UUID for kg_challenge or kg_supersede.'),
        explanation: z.string().trim().max(1000).optional().describe('Explanation for kg_challenge link.'),
        trail: kgTrailInputSchema.optional().describe('Research trail payload for kg_save_trail.'),
      }),
      outputSchema: z.record(z.string(), z.unknown()),
      ...writeMeta,
    }, async (args) => {
      const headers = getHeaders?.();
      const clientInfo = server.server.getClientVersion?.();

      if (
        args.action === 'kg_save_batch' ||
        args.action === 'kg_update_claim' ||
        args.action === 'kg_challenge' ||
        args.action === 'kg_supersede' ||
        args.action === 'kg_save_trail'
      ) {
        return await executeKgWriteAction(writer, args.action, args as unknown as Record<string, unknown>, clientInfo, headers);
      }

      if (args.action === 'delete') {
        if (!args.note_id) return errorReply('note_id is required for action="delete".');
        return await executeDeleteNote(writer, { note_id: args.note_id, model: args.model }, clientInfo, headers);
      }

      if (args.action === 'save_dlm') {
        if (!args.dlm) return errorReply('dlm card payload is required for action="save_dlm".');
        return await executeSaveDlmCard(writer, read, args.dlm, clientInfo, headers);
      }

      if (args.action === 'update') {
        if (!args.note_id || args.expected_version === undefined || !args.body_md || !args.note_kind || !args.anchors) {
          return errorReply('action="update" requires note_id, expected_version, body_md, note_kind, and anchors.');
        }
        return await executeUpdateNote(writer, {
          note_id: args.note_id,
          expected_version: args.expected_version,
          title: args.title,
          body_md: args.body_md,
          note_kind: args.note_kind,
          language: args.language ?? 'en',
          confidence: args.confidence,
          anchors: args.anchors,
          connections: args.connections ?? [],
          blocks: args.blocks ?? [],
          source_context: args.source_context,
          model: args.model,
        }, clientInfo, headers);
      }

      // action === 'create'
      if (!args.body_md) return errorReply('body_md is required to create a note.');

      if (args.anchors && args.anchors.length > 0) {
        return await executeCreateNote(writer, {
          title: args.title,
          body_md: args.body_md,
          note_kind: args.note_kind ?? 'observation',
          language: args.language ?? 'en',
          confidence: args.confidence,
          anchors: args.anchors,
          connections: args.connections ?? [],
          blocks: args.blocks ?? [],
          source_context: args.source_context,
          model: args.model,
        }, clientInfo, headers);
      }

      if (args.references && args.references.length > 0) {
        const resolvedRefs: Array<{
          book: number;
          chapter: number;
          verse: number;
          word_position?: number;
          word_id?: number;
          role?: 'subject' | 'object' | 'mention' | 'evidence';
        }> = [];
        for (const r of args.references) {
          if (r.passage) {
            const p = parsePassageString(r.passage);
            if (!p || p.passages.length !== 1 || p.passages[0].start_verse !== p.passages[0].end_verse) {
              return errorReply(`Invalid single-verse reference "${r.passage}" in references.`);
            }
            const sp = p.passages[0];
            resolvedRefs.push({
              book: sp.book,
              chapter: sp.chapter,
              verse: sp.start_verse,
              ...(r.word_position !== undefined ? { word_position: r.word_position } : {}),
              ...(r.word_id !== undefined ? { word_id: r.word_id } : {}),
              ...(r.role ? { role: r.role } : {}),
            });
          } else if (r.book !== undefined && r.chapter !== undefined && r.verse !== undefined) {
            resolvedRefs.push({
              book: r.book,
              chapter: r.chapter,
              verse: r.verse,
              ...(r.word_position !== undefined ? { word_position: r.word_position } : {}),
              ...(r.word_id !== undefined ? { word_id: r.word_id } : {}),
              ...(r.role ? { role: r.role } : {}),
            });
          } else {
            return errorReply('Each reference requires either passage or book/chapter/verse.');
          }
        }
        return await executeAddResearchNote(writer, read, {
          title: args.title,
          body_md: args.body_md,
          note_kind: args.note_kind ?? 'observation',
          language: args.language ?? 'en',
          confidence: args.confidence,
          references: resolvedRefs,
          source_context: args.source_context,
          model: args.model,
        }, clientInfo, headers);
      }

      return errorReply('Provide anchors or references to create a note.');
    });
  }

  // 7. get_prompt
  server.registerTool('get_prompt', {
    title: 'Get BibleResearch discovery guidelines prompt',
    description: 'Return the BibleResearch research guidelines explaining how to use the tools, verify connections with actual passages, and separate textual facts from hypotheses.',
    inputSchema: z.strictObject({}),
    ...readOnlyMeta,
  }, () => jsonReply({
    version: WORKFLOW_VERSION,
    instructions: WORKFLOW_INSTRUCTIONS,
  }));

  server.registerPrompt('bible_research', {
    title: 'BibleResearch guidelines',
    description: 'Evidence-first original-language Bible research guidelines for the 7 discovery tools.',
    argsSchema: z.object({}),
  }, () => ({
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text: WORKFLOW_INSTRUCTIONS },
    }],
  }));

  return server;
}
