// BibleResearch MCP v2.0.0: compact 7-tool AI discovery interface.
// Pure Web/Deno TypeScript with strict epistemic separation and zero Node imports.

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { DatabaseQuery, DatabaseReader } from './catalog.ts';
import type { ChainState, ChainStep, ChainStore } from './chain-store.ts';
import { chainEvidenceTarget, selectChainEvidence, type ChainEvidence } from './chain-evidence.ts';
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
import { ResearchOpSchema, executeResearch } from './research-engine.ts';
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
  return { content: textReply(JSON.stringify(payload)), structuredContent: payload };
}

function errorReply(message: string, details?: Rec) {
  const payload = { status: 'error', error: message, ...(details ?? {}) };
  return { isError: true, content: textReply(JSON.stringify(payload)), structuredContent: payload };
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

// Split profile decoding across bounded read RPCs to respect the free Worker CPU budget.
// Candidate selection and ordering use the identical plan produced by the corpus handler.
export async function fetchCompactPassage(read: DatabaseReader, args: Rec): Promise<Rec | null> {
  const packet = await safeCallFirst(read, 'get_passage_compact_v1', { ...args, defer_profiles: true });
  const plan = asRec(packet?.profile_plan);
  if (!packet || !plan) return packet;
  const candidates = asArr(plan.candidates).map(asRec).filter((c): c is Rec => c !== null);
  const loaded: Rec = {};
  let unavailable = false;
  for (let offset = 0; offset < candidates.length; offset += 4) {
    const page = await safeCallFirst(read, 'get_word_profiles_batch_v1', {
      strongs: candidates.slice(offset, offset + 4).map(c => c.bs),
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

  for (const rawLxx of asArr(profile.lxx_relations).slice(0, 3)) {
    const lx = asRec(rawLxx);
    if (!lx) continue;
    const tBs = str(lx.target_strongs);
    const tSc = str(lx.script);
    const tGl = str(lx.gloss);
    const cnt = typeof lx.count === 'number' ? lx.count : 0;
    if (!tSc && !tBs) continue;
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

  for (const rawLex of asArr(profile.lexical_relations).slice(0, 4)) {
    const lr = asRec(rawLex);
    if (!lr) continue;
    const tBs = padStrongsToken(str(lr.target_strongs));
    const tSc = str(lr.script);
    const tGl = str(lr.gloss);
    const kind = str(lr.type, 'lexical_relation');
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
    const lxx = asArr(prof.lxx_relations).map(asRec).filter((x): x is Rec => x !== null);
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
    const rows = await callRpc(read, 'resolve_fast_lookup_v1', { query: lookupQuery, limit: 10 }, 1, 0);
    lookupRes = asRec(rows[0]);
  } catch {
    warnings.push(`Lexical fast lookup unavailable for "${lookupQuery}".`);
  }
  const matches = asArr(lookupRes?.matches).map(asRec).filter((m): m is Rec => m !== null);
  const primary = matches[0] ?? null;
  const ambiguous = matches.slice(1, 6);
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
  const isStrongsCode = /^[HG]\d{1,5}[A-Z]?$/i.test(wordQuery.trim());
  const nonStopTerms = wordQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !WORD_QUERY_STOPWORDS.has(t));
  const isMultiConceptWordQuery = !isStrongsCode && !options.passage && nonStopTerms.length >= 2;
  const anchorLemmaKey = anchoredToken ? str(anchoredToken.lemma_key) : '';
  const anchorExtendedStrongs = anchorLemmaKey ? anchorLemmaKey.replace(/^lemma:/i, '') : '';

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
      : fetchWordDetailsRow(read, bs),
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
  const fullProfile = asRec(profilesMap?.[bs]) ?? primary;
  const wordId = wordDetailsRes.wordId;
  const wordRow = wordDetailsRes.wordRow;

  const [etymologyData, realworldData, wordNotesRaw] = await Promise.all([
    options.etymology > 0 ? buildWordEtymology(read, bs, fullProfile, options.etymology,
      anchoredToken ? { activeLemmaKey: str(anchoredToken.lemma_key), wordId } : {}) : Promise.resolve(null),
    options.realworld === 1
      ? buildWordRealworld(read, bs, str(fullProfile.gl), wordRow, fullProfile)
      : Promise.resolve(null),
    wordId
      ? safeCallFirst(read, 'get_notes_for_word_v1', {
          p_word_id: wordId,
          p_verse_id: null,
          p_word_position: null,
          p_limit: 5,
        })
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
    if (ambiguousCandidates.length >= 6) break;
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

  const clusters = asArr(fullProfile.clusters)
    .map(asRec)
    .filter((c): c is Rec => c !== null)
    .slice(0, 5);

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
  offset: number;
  limit: number;
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
  const compactPromise = fetchCompactPassage(read, {
    passages: parsed.passages,
    max_verses: input.limit,
    offset: input.offset,
    include_profiles: true,
    profile_limit: 24,
  });

  const geoPromise = safeCallFirst(read, 'get_verse_geography', {
    p_book: firstSpan.book,
    p_chapter: firstSpan.chapter,
    p_verse: anchorVerse,
  });

  const chronPromise = safeCallFirst(read, 'get_verse_chronology_v1', {
    p_book: firstSpan.book,
    p_chapter: firstSpan.chapter,
    p_verse: anchorVerse,
  });

  const notesPromise = Promise.all(
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
  );

  const [compact, rawGeo, rawChron, noteBatches] = await Promise.all([
    compactPromise,
    geoPromise,
    chronPromise,
    notesPromise,
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

  // Pick up to 3 anchor verse refs across the page for R12 discovery
  const anchorVerseRefs: string[] = [];
  if (input.depth > 0 && versesRaw.length > 0) {
    const firstRef = str(versesRaw[0].ref);
    if (firstRef) anchorVerseRefs.push(firstRef);
    let richest: Rec | null = null;
    let richestScore = -1;
    for (const v of versesRaw) {
      const xrCount = asArr(v.xrefs).length;
      if (xrCount > richestScore) {
        richestScore = xrCount;
        richest = v;
      }
    }
    const richRef = richest ? str(richest.ref) : '';
    if (richRef && !anchorVerseRefs.includes(richRef)) anchorVerseRefs.push(richRef);
    const lastRef = str(versesRaw[versesRaw.length - 1].ref);
    if (lastRef && !anchorVerseRefs.includes(lastRef) && anchorVerseRefs.length < 3) {
      anchorVerseRefs.push(lastRef);
    }
  }

  const [wordRows, chronBatch, ...discPages] = await Promise.all([
    wordIdSet.size > 0
      ? callRpc(read, 'get_words_batch', { word_ids: [...wordIdSet] }, wordIdSet.size, 0).catch(() => [])
      : Promise.resolve([]),
    anchorVids.length > 0
      ? safeCallFirst(read, 'query_chronology_assertions_batch', { verse_ids: anchorVids })
      : Promise.resolve(null),
    ...anchorVerseRefs.map(ref =>
      safeCallFirst(read, 'discover_biblical_connections_v2', {
        query: ref,
        limit: Math.min(25, Math.max(input.depth, 15)),
      }),
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

  // Build deduplicated shared lexicon keyed by Strong's (plus distinct homograph lemma_key if multiple senses share a base Strong's)
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
            etymByStrongs.set(bs, await buildWordEtymology(read, bs, prof, input.etymology, { activeLemmaKey: str(prof?.lk) }));
          }
          if (input.realworld === 1) {
            rwByStrongs.set(bs, await buildWordRealworld(read, bs, str(prof?.gl), wRow, prof));
          }
        }),
      );
    }
  }

  const lexicon: Record<string, CompactWord> = {};
  for (const bs of contentStrongsOrder) {
    const prof = asRec(profiles[bs]);
    const tok = sampleTokenByStrongs.get(bs);
    const wid = Number(tok?.word_id || 0);
    const wRow = wid > 0 ? wordById.get(wid) ?? null : null;
    if (!prof && !tok) continue;
    const perWordConns = input.word_depth > 0 && prof
      ? buildProfileDerivedConnections(prof, input.word_depth)
      : null;

    // Lexicon entries describe the lexeme, not the first inflected occurrence (those live in verses[].words).
    lexicon[bs] = compactWordFromData({
      token: null,
      profile: prof ?? (tok ? { bs, sc: str(tok.lemma), gl: str(tok.gloss), lk: str(tok.lemma_key), pos: str(tok.pos_class) } : null),
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
    if (lexicon[lk]) continue;
    const tok = info.token;
    if (isFunctionWord({ pos_class: str(tok.pos_class), strongs: info.bs })) continue;
    const prof = asRec(profiles[info.bs]);
    const wid = Number(tok.word_id || 0);
    const wRow = wid > 0 ? wordById.get(wid) ?? null : null;
    lexicon[lk] = compactWordFromData({
      token: null,
      profile: {
        ...(prof ?? {}),
        bs: info.bs,
        lk,
        sc: str(tok.lemma, str(prof?.sc)),
        gl: str(tok.gloss, str(prof?.gl)),
        pos: str(tok.pos_class, str(prof?.pos)),
      },
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
      return {
        pos: Number(t.position),
        ...(Number.isInteger(wid) && wid > 0 ? { word_id: wid } : {}),
        form: surface,
        lemma: str(t.lemma, str(t.lemma_key) === str(prof?.lk) ? str(prof?.sc) : ''),
        ...(bs ? { strongs: bs } : {}),
        ...(str(t.lemma_key) ? { lemma_key: str(t.lemma_key) } : {}),
        ...(str(t.sense_status) ? { sense_status: str(t.sense_status) } : {}),
        ...(Array.isArray(t.lemma_candidates) ? { lemma_candidates: t.lemma_candidates } : {}),
        ...(tr ? { tr } : {}),
        gloss: str(t.gloss, verified ? str(asArr(wRow?.english_translations)[0]) : ''),
        ...(code ? { code } : {}),
        ...(verified ? {} : { alignment_status: 'partial_source_only' }),
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
          return { id: display.id, relation: display.relation, refs: display.refs, title: display.title };
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

  return {
    status: 'ok',
    passage: parsed.normalized,
    pagination: compact.pagination,
    geography,
    chronology,
    ...(input.depth > 0 ? { passage_connections: passageConnections } : {}),
    ...(discoveryPartial ? { discovery_status: 'partial' } : {}),
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
            gloss: str(p.gl),
            total_verses: p.total_verses ?? 0,
          })),
      };
    }
    if (entry.wordResult?.word) {
      return {
        input: entry.input,
        kind: 'word',
        ...(entry.wordResult.status !== 'ok' ? { status: entry.wordResult.status } : {}),
        word: entry.wordResult.word,
        grammar_forms: entry.wordResult.grammarForms,
        grammar_forms_scope: 'Attested forms of this Strong\'s group, including possible homograph lemmas; not morphology of the selected occurrence.',
        occurrences: entry.wordResult.occurrences,
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
          // Nearby (±2v) co-attestation across >= 3 common words is an exploratory lead, not a direct multi-anchor proof
          const isNearbyMulti = sameVerse.length === 0 && vidArrays.length >= 3;
          pushTagged({
            id: `intersect:${wordStrongs.join('+')}`,
            relation: sameVerse.length > 0 ? 'same_verse_co_attestation' : 'nearby_verse_co_attestation',
            epistemic: 'documented_collocation_or_cooccurrence',
            tier: isNearbyMulti ? 4 : 3,
            title: `${wordStrongs.join(' + ')} co-occur in ${totalMatches} ${sameVerse.length > 0 ? 'verse(s)' : 'nearby (±2v) passage(s)'}`,
            why: `Attested together in ${refs.join(', ')}. Co-occurrence provides textual witnesses to inspect, not automatic equivalence.`,
            refs,
            witness: wVerses[0] ? str(wVerses[0].web).slice(0, 160) : undefined,
          }, vidArrays.map(a => a.idx), isNearbyMulti);
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
            const isProximateWitnessed = rel === 'proximate_wordplay_candidate' && (sameV > 0 || adjV > 0);
            const epClass = isAttestedWp
              ? 'direct_textual_evidence'
              : isDocRoot
                ? 'documented_lexical_relationship'
                : isProximateWitnessed
                  ? 'candidate_literary_pattern'
                  : 'orthographic_similarity_only';
            const tier = isAttestedWp ? 2 : isDocRoot ? 3 : isProximateWitnessed ? 4 : 5;
            const wRefs = asArr(wpMatch.witness_refs).filter((r): r is string => typeof r === 'string').slice(0, 4);
            pushTagged({
              id: `r13:wp:${canonicalFromBs}:${canonicalToBs}`,
              relation: rel,
              epistemic: epClass,
              evidence_type: rel,
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

  if (passageEntries.length >= 2) {
    const pSets = passageEntries.map(({ e: pe, idx }) => {
      const verses = asArr(pe.compactPassage?.verses).map(asRec).filter((v): v is Rec => v !== null);
      const vids = new Set(verses.map(v => Number(v.verse_id)).filter(n => n > 0));
      const profiles = asRec(pe.compactPassage?.profiles) ?? {};
      const strongsSet = new Set(Object.keys(profiles));
      const lxxOut = new Map<string, { fromBs: string; fromSc: string; toSc: string; toGl: string; count: number }>();
      for (const [bs, rawP] of Object.entries(profiles)) {
        const p = asRec(rawP);
        const lxxList = asArr(p?.lxx_relations).map(asRec).filter((x): x is Rec => x !== null);
        const maxCnt = lxxList.reduce((m, x) => Math.max(m, Number(x.count ?? 1)), 1);
        for (const lx of lxxList) {
          const tbs = str(lx.target_strongs).toUpperCase();
          const cnt = Number(lx.count ?? 1);
          // Skip secondary low-share co-occurrence noise (< 22% of the lemma's primary LXX translation count)
          if (!tbs || (maxCnt >= 10 && cnt < maxCnt * 0.22)) continue;
          const prev = lxxOut.get(tbs);
          if (!prev || cnt > prev.count) {
            lxxOut.set(tbs, { fromBs: bs, fromSc: str(p?.sc), toSc: str(lx.script), toGl: str(lx.gloss), count: cnt });
          }
        }
      }
      return { pe, idx, verses, vids, profiles, strongsSet, lxxOut };
    });

    for (let i = 0; i < pSets.length; i++) {
      for (let j = i + 1; j < pSets.length; j++) {
        const a = pSets[i];
        const b = pSets[j];
        // Bidirectional direct cross-references between passage A and passage B
        for (const [src, dst] of [[a, b], [b, a]] as const) {
          for (const v of src.verses) {
            for (const xr of asArr(v.xrefs)) {
              const xc = buildXrefConnection(str(v.ref), Number(v.verse_id), xr);
              const targetVid = Array.isArray(xr) ? Number(xr[0]) : Number(asRec(xr)?.target_vid ?? 0);
              if (xc && dst.vids.has(targetVid)) {
                pushTagged(xc, [a.idx, b.idx], false);
              }
            }
          }
        }
        // Shared rare content Strong's (with homograph lemma_key & contextual sense disambiguation, EV13)
        for (const bs of a.strongsSet) {
          if (b.strongsSet.has(bs)) {
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
                evType === 'attested_textual_wordplay' ||
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
        // Bidirectional cross-testament LXX bridges (A -> B AND B -> A)
        const seenLxxPair = new Set<string>();
        const sharedLxxBridgePairs: Array<{ fromBs: string; fromSc: string; toBs: string; toSc: string; toGl: string }> = [];
        for (const [src, dst] of [[a, b], [b, a]] as const) {
          for (const [tbs, info] of src.lxxOut.entries()) {
            if (!dst.strongsSet.has(tbs)) continue;
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
        epistemic: str(p.epistemic_class, hops <= 1 ? 'documented_lexical_relationship' : 'multi_hop_research_path'),
        tier,
        title: str(p.title, `${compareTargets[i]} <-> ${compareTargets[j]}`),
        why: str(p.why),
        ...(refs.length ? { refs } : {}),
        ...(typeof p.path_score === 'number' ? { score: p.path_score } : {}),
      };
      pushTagged(conn, [i, j], hops > 1 || tier > 4);
    }
  }

  const isVerifiedPairwiseCandidate = (t: typeof taggedCandidates[number]) =>
    t.matchedIndices.length >= 2 &&
    !t.isIndirect &&
    (t.conn.epistemic === 'direct_textual_evidence' ||
      t.conn.epistemic === 'authorial_typology_or_quote' ||
      t.conn.epistemic === 'documented_cross_language_bridge' ||
      t.conn.epistemic === 'documented_collocation_or_cooccurrence' ||
      t.conn.epistemic === 'documented_lexical_relationship' ||
      t.conn.epistemic === 'verified_cross_reference' ||
      t.conn.epistemic === 'editorial_cross_reference' ||
      t.conn.epistemic === 'shared_motif_evidence' ||
      (t.conn.tier !== undefined && t.conn.tier <= 4));

  // Rank pairwise proof candidates by evidential & original-language specificity (explicit/wordplay/lexical/LXX first, editorial xrefs last)
  const scoreProofEdgePriority = (c: CompactConnection): number => {
    const id = c.id || '';
    if (id.startsWith('r10:ident:') || id.startsWith('r13:si:') || id.startsWith('r13:interp:') || id.startsWith('r10:typo:')) return 110;
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

  // Select at most ONE best independent verified edge per unordered anchor pair (u, v) (u < v)
  const bestByPair = new Map<string, { u: number; v: number; conn: CompactConnection; priority: number }>();
  const pairCandidates: Array<{ u: number; v: number; conn: CompactConnection; priority: number }> = [];
  for (const t of taggedCandidates) {
    if (!isVerifiedPairwiseCandidate(t)) continue;
    // Skip 3+ way generic co-occurrence records when building pairwise edges
    if (t.conn.id.startsWith('intersect:') && t.matchedIndices.length >= 3) continue;
    const prio = scoreProofEdgePriority(t.conn);
    for (let a = 0; a < t.matchedIndices.length; a++) {
      for (let b = a + 1; b < t.matchedIndices.length; b++) {
        pairCandidates.push({ u: t.matchedIndices[a], v: t.matchedIndices[b], conn: t.conn, priority: prio });
      }
    }
  }
  pairCandidates.sort((a, b) => b.priority - a.priority || (a.conn.tier ?? 3) - (b.conn.tier ?? 3));

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
    const synthesizedConn: CompactConnection = {
      id: `r13:proof:${proofType}:${compareTargets.join('+')}`,
      relation: isTrueTriangle ? 'verified_three_edge_triangle' : 'verified_steiner_network',
      epistemic: worstSpanTier <= 2 ? 'direct_textual_evidence' : 'documented_lexical_relationship',
      tier: Math.min(4, worstSpanTier),
      title: isTrueTriangle
        ? `Verified 3-edge triangle connecting ${compareTargets.join(' <-> ')}`
        : `Verified ${proofType.replace(/_/g, ' ')} (${proofEdges.length} independent edges) connecting ${compareTargets.join(' <-> ')}`,
      why: edgeSummaries.join(' | '),
      ...(spanRefs.length ? { refs: spanRefs } : {}),
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

  const dedupeConnList = (arr: CompactConnection[]) => filterConnectionsForPrimary(arr, '', maxConnections, false);
  const completeMultiAnchor = dedupeConnList(
    taggedCandidates.filter(t => !t.isIndirect && t.matchedIndices.length === items.length).map(t => t.conn),
  );
  const directPairwise = dedupeConnList(
    taggedCandidates
      .filter(isVerifiedPairwiseCandidate)
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

  const connections = filterConnectionsForPrimary(
    [...completeMultiAnchor, ...directPairwise, ...indirectPaths],
    '',
    maxConnections,
    false,
  );
  const directLinkFound = completeMultiAnchor.length > 0 || directPairwise.length > 0;
  const allEndpointsConnected = completeMultiAnchor.length > 0;
  const warnings = itemEntries
    .filter(e => e.kind === 'passage' && !asArr(e.compactPassage?.verses).length)
    .map(e => `Passage source unavailable: ${e.input}. Retry before treating missing connections as absence.`);
  for (const entry of itemEntries) if (entry.compactPassage?.profiles_status === 'partial') warnings.push(`Lexical profiles incomplete for ${entry.input}; retry for missing lexical bridges.`);
  if (!discRes) warnings.push('Graph discovery unavailable. Returned direct witnesses are partial; retry to retrieve graph connections.');

  return {
    status: warnings.length ? 'partial' : 'ok',
    ...(warnings.length ? { warnings } : {}),
    items: itemSummaries,
    direct_link_found: directLinkFound,
    all_endpoints_connected: allEndpointsConnected && isGraphComplete,
    graph_proof: graphProof,
    ...(!directLinkFound ? { no_direct_link_reason: 'No direct verse co-occurrence, lexical/LXX match, explicit cross-reference, or verified pairwise motif connected at least two requested items.' } : {}),
    connections,
    complete_multi_anchor: completeMultiAnchor,
    direct_pairwise: directPairwise,
    indirect_paths: indirectPaths,
    ...(individualSuggestions.length > 0 ? { individual_suggestions: individualSuggestions.slice(0, 6) } : {}),
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
): Promise<{ resolvedNode: string; neighbors: CompactConnection[] }> {
  const trimmed = node.trim();
  let queryStr = trimmed;
  let focusLemma: string | undefined;

  if (/^r1[0123]:/i.test(trimmed)) {
    const rawEv = await safeCallFirst(read, 'get_connection_evidence_v1', { evidence_id: trimmed });
    const ev = unwrapEvidencePayload(rawEv);
    const origWords = asArr(ev?.original_words).map(asRec).filter((w): w is Rec => w !== null);
    const passages = asArr(ev?.passages).map(asRec).filter((p): p is Rec => p !== null);
    const nextSeed = str(origWords[1]?.strongs ?? origWords[0]?.strongs ?? passages[0]?.ref, trimmed);
    queryStr = nextSeed;
  } else if (isPassageLike(trimmed)) {
    const parsed = parsePassageString(trimmed);
    if (parsed) queryStr = parsed.normalized;
  } else {
    const lk = await safeCallFirst(read, 'resolve_fast_lookup_v1', { query: trimmed, limit: 3 });
    const first = asArr(lk?.matches).map(asRec).find(Boolean);
    if (first && str(first.bs)) {
      focusLemma = str(first.bs);
      queryStr = focusLemma;
    }
  }

  const disc = await safeCallFirst(read, 'discover_biblical_connections_v2', {
    query: queryStr,
    ...(focusLemma ? { focus_lemma: focusLemma } : {}),
    limit: Math.min(25, limit * 3),
  });

  const allConns = asArr(disc?.strongest_connections ?? disc?.connections)
    .map(asRec)
    .filter((c): c is Rec => c !== null)
    .map(normalizeDiscoveryConnection)
    .filter((c): c is CompactConnection => c !== null);

  const unseen = allConns.filter(c => {
    if (visitedEdges.has(c.id)) return false;
    const targetNode = str(c.target?.strongs ?? c.refs[0] ?? c.id).toLowerCase();
    if (targetNode && visitedNodes.has(targetNode)) return false;
    return true;
  });

  return {
    resolvedNode: focusLemma ?? queryStr,
    neighbors: filterConnectionsForPrimary(unseen, focusLemma ?? '', limit, Boolean(focusLemma)),
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
      'Primary tool for reading any verse, range, or chapter (including cross-chapter ranges like "1COR12:10-1COR13:4" and Psalm headings like "Ps 45:0"). Returns complete original text, readable WEB English, compact word table linked to a deduplicated shared lexicon, top z passage/verse connections, scoped geography, and named chronology models. Keep word_depth=0, etymology=0, realworld=0 on initial read unless deeper word detail is needed.',
    inputSchema: z.strictObject({
      passage: z.string().trim().min(1).max(160).describe('Verse, range, or chapter (e.g. "Gen 6:14", "Zechariah 4", "1COR12:10-1COR13:4", "Ps 45:0").'),
      depth: z.number().int().min(0).max(25).default(3).describe('Top z connections for the passage and for each verse (0 omits connections).'),
      word_depth: z.number().int().min(0).max(15).default(0).describe('Top x connections per content word in shared lexicon (0 omits per-word connections).'),
      etymology: z.number().int().min(0).max(15).default(0).describe('0 omits; y > 0 adds documented roots/formations plus up to y separated spelling suggestions.'),
      realworld: z.union([z.literal(0), z.literal(1), z.boolean()]).default(0).describe('0 omits; 1 adds supported biblical/physical definitions and external property bridges.'),
      offset: z.number().int().min(0).max(200).default(0).describe('Verse offset when paginating long ranges.'),
      limit: z.number().int().min(1).max(40).default(30).describe('Maximum complete verses per call (default 30, max 40).'),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({ passage, depth = 3, word_depth = 0, etymology = 0, realworld = 0, offset = 0, limit = 30 }) => {
    try {
      const payload = await handleGetPassage(read, {
        passage,
        depth,
        word_depth,
        etymology,
        realworld: parseRealworldFlag(realworld),
        offset,
        limit,
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
      'Primary lexical tool accepting English concepts, original Hebrew/Greek script, transliteration ("Ruach"), Strong\'s ("H7307"), or a word in a specific passage. Returns the shared CompactWord object with senses, grammar forms, biblical occurrences, LXX links, explicit-method gematria, optional documented etymology separated from spelling suggestions, real-world meaning where supported, and top diverse connections.',
    inputSchema: z.strictObject({
      word: z.string().trim().min(1).max(128).describe('English word, original Hebrew/Greek, transliteration, lemma, or Strong\'s ID (e.g. "Ruach", "H7307", "πνεῦμα", "kaphar").'),
      connections: z.number().int().min(0).max(25).default(10).describe('Top x diverse connections with short witnesses (default 10).'),
      etymology: z.number().int().min(0).max(15).default(0).describe('0 omits; y > 0 adds documented roots/formations plus up to y separated spelling-similarity candidates.'),
      passage: z.string().trim().min(1).max(120).optional().describe('Optional passage reference (e.g. "Gen 6:14") to anchor a specific occurrence.'),
      mode: z.enum(['discover', 'bridge']).optional().describe('Optional discovery mode: "discover" (default) or "bridge" for physical-world property bridges.'),
      realworld: z.union([z.literal(0), z.literal(1), z.boolean()]).default(1).describe('1 (default) includes supported real-world/physical definitions and property bridges; 0 omits.'),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({ word, connections = 10, etymology = 0, passage, mode, realworld = 1 }) => {
    try {
      const res = await buildFullCompactWord(read, word, {
        connections,
        etymology,
        realworld: parseRealworldFlag(realworld),
        passage,
        ...(mode ? { mode } : {}),
      });
      if (!res.word) {
        return jsonReply({
          status: res.warnings.length > 0 ? 'partial' : 'not_found',
          query: word,
          discovery_status: res.discovery_status,
          coverage: res.coverage,
          ...(res.warnings.length > 0 ? { warnings: res.warnings } : {}),
          message: res.warnings.length > 0
            ? `Lexical lookup partially unavailable for "${word}"; retry before assuming absence.`
            : `No canonical Hebrew/Greek lexical entry found matching "${word}".`,
        });
      }
      return jsonReply({
        status: res.status,
        query: word,
        discovery_status: res.discovery_status,
        coverage: res.coverage,
        ...(res.warnings.length > 0 ? { warnings: res.warnings } : {}),
        ...(res.anchored_occurrence ? { anchored_occurrence: res.anchored_occurrence } : {}),
        word: res.word,
        grammar_forms: res.grammarForms,
        grammar_forms_scope: 'Attested forms of this Strong\'s group, including possible homograph lemmas; not morphology of the selected occurrence.',
        resolution: res.ambiguousCandidates.length ? 'selected_candidate_with_alternatives' : 'selected_lexical_entry',
        occurrences: res.occurrences,
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
      'Compare 2 to 6 words, passages, or mixed inputs (e.g. ["Genesis 6:14", "Exodus 2:3"], ["Ruach", "Zechariah 4"], ["Zechariah 4", "Revelation 11"]). Returns full CompactWord objects for word inputs, compact context (without per-word expansion) for passage inputs, multiple real connection lanes, supporting verses, and explicit uncertainty.',
    inputSchema: z.strictObject({
      items: z.array(z.string().trim().min(1).max(200)).min(2).max(6).describe('Two or more words, Strong\'s IDs, concepts, or passage references to compare.'),
      connections: z.number().int().min(1).max(25).default(10).describe('Maximum connections to return (default 10).'),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({ items, connections = 10 }) => {
    try {
      const payload = await handleGetConnection(read, items, connections);
      return jsonReply(payload);
    } catch {
      return errorReply('Connection comparison is temporarily unavailable.');
    }
  });

  // 4. follow_connectionchain
  server.registerTool('follow_connectionchain', {
    title: 'Start, follow, branch, or revisit a remembered connection chain',
    description:
      'Maintains a private expiring server-side session chain of visited nodes and evidence so you can explore multi-step connections without repeating already-seen nodes. Omit chain with next="..." to start; pass chain handle with action="follow"|"branch"|"revisit"|"inspect" to advance, branch, or inspect.',
    inputSchema: z.strictObject({
      chain: z.string().trim().min(10).max(120).optional().describe('Opaque chain handle returned by a prior follow_connectionchain call. Omit to start a new chain.'),
      next: z.string().trim().min(1).max(220).optional().describe('Target word, passage, or evidence_id to seed or advance to.'),
      action: z.enum(['follow', 'branch', 'revisit', 'inspect']).default('follow').describe('Action on an existing chain (default: follow).'),
      from_node: z.string().trim().min(1).max(220).optional().describe('Node or step to branch from or revisit.'),
      limit: z.number().int().min(1).max(15).default(8).describe('Maximum next connections to return (default 8).'),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({ chain, next, action = 'follow', from_node, limit = 8 }) => {
    const sessionId = getHeaders?.()?.get('mcp-session-id') ?? getHeaders?.()?.get('Mcp-Session-Id') ?? null;
    try {
      if (!chain) {
        if (!next) {
          return errorReply('Provide next (a word, passage, or evidence_id) to start a new connection chain.');
        }
        const visitedNodes = new Set<string>([next.toLowerCase()]);
        const { resolvedNode, neighbors } = await fetchNodeNeighbors(read, next, visitedNodes, new Set(), limit);
        visitedNodes.add(resolvedNode.toLowerCase());
        const created = await chainStore.create({
          root: resolvedNode,
          current_node: resolvedNode,
          visited_nodes: [...visitedNodes],
          visited_edges: [],
          steps: [],
          branches: [],
          active_candidates: neighbors as unknown as Rec[],
        }, sessionId);
        if (!created.ok) return errorReply(created.message, { code: created.error });
        return jsonReply({
          status: 'ok',
          chain: created.handle,
          expires_at: created.state.expires_at,
          step: 0,
          current_node: created.state.current_node,
          path_trail: [created.state.root],
          visited_count: created.state.visited_nodes.length,
          chain_epistemic_summary: summarizeChainEpistemics(created.state.steps),
          next_connections: neighbors,
          branches: created.state.branches,
        });
      }

      const loaded = await chainStore.load(chain, sessionId);
      if (!loaded.ok) return errorReply(loaded.message, { code: loaded.error });

      const st: ChainState = {
        ...loaded.state,
        visited_nodes: [...loaded.state.visited_nodes],
        visited_edges: [...loaded.state.visited_edges],
        steps: [...loaded.state.steps],
        branches: [...loaded.state.branches],
      };

      if (action === 'inspect') {
        const visitedSet = new Set(st.visited_nodes.map(v => v.toLowerCase()));
        const edgeSet = new Set(st.visited_edges);
        const { neighbors } = await fetchNodeNeighbors(read, st.current_node, visitedSet, edgeSet, limit);
        st.active_candidates = neighbors as unknown as Rec[];
        const updated = await chainStore.update(chain, st, sessionId);
        if (!updated.ok) return errorReply(updated.message, { code: updated.error });
        return jsonReply({
          status: 'ok',
          chain,
          expires_at: st.expires_at,
          step: st.steps.length,
          current_node: st.current_node,
          path_trail: [st.root, ...st.steps.map(s => `${s.from_node} -> ${s.to_node} [${s.relation}]`)],
          visited_count: st.visited_nodes.length,
          chain_epistemic_summary: summarizeChainEpistemics(st.steps),
          next_connections: neighbors,
          branches: st.branches,
        });
      }

      if (action === 'revisit') {
        const target = from_node || next || st.root;
        st.current_node = target;
        const visitedSet = new Set(st.visited_nodes.map(v => v.toLowerCase()));
        const edgeSet = new Set(st.visited_edges);
        const { neighbors } = await fetchNodeNeighbors(read, target, visitedSet, edgeSet, limit);
        st.active_candidates = neighbors as unknown as Rec[];
        const updated = await chainStore.update(chain, st, sessionId);
        if (!updated.ok) return errorReply(updated.message, { code: updated.error });
        return jsonReply({
          status: 'ok',
          chain,
          action: 'revisit',
          expires_at: updated.state.expires_at,
          step: updated.state.steps.length,
          current_node: updated.state.current_node,
          path_trail: [updated.state.root, ...updated.state.steps.map(s => `${s.from_node} -> ${s.to_node} [${s.relation}]`)],
          visited_count: updated.state.visited_nodes.length,
          chain_epistemic_summary: summarizeChainEpistemics(updated.state.steps),
          next_connections: neighbors,
          branches: updated.state.branches,
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
        if (!next) {
          const visitedSet = new Set(st.visited_nodes.map(v => v.toLowerCase()));
          const edgeSet = new Set(st.visited_edges);
          const { neighbors } = await fetchNodeNeighbors(read, origin, visitedSet, edgeSet, limit);
          st.active_candidates = neighbors as unknown as Rec[];
          const updated = await chainStore.update(chain, st, sessionId);
          if (!updated.ok) return errorReply(updated.message, { code: updated.error });
          return jsonReply({
            status: 'ok',
            chain,
            action: 'branch',
            branch_id: branchId,
            expires_at: updated.state.expires_at,
            step: updated.state.steps.length,
            current_node: updated.state.current_node,
            chain_epistemic_summary: summarizeChainEpistemics(updated.state.steps),
            next_connections: neighbors,
            branches: updated.state.branches,
          });
        }
      }

      if (!next) {
        return errorReply('Provide next (a target word, passage, or evidence_id) to follow this chain.');
      }

      const fromNode = action === 'branch' && from_node ? from_node : st.current_node;
      let edgeId: string | undefined;
      let relation = 'exploratory_step';
      let epistemic = 'exploratory_hypothesis';
      let stepRefs: string[] = [];
      let toNode = next;

      // Preserve a selected returned edge, including ordinary passage targets.
      // A branch origin has different candidates; never reuse the prior node's list.
      let candidates = action === 'branch' && from_node
        ? [] : (st.active_candidates ?? []) as unknown as ChainEvidence[];
      let selected = selectChainEvidence(candidates, fromNode, next);
      if (!selected) {
        const origin = await fetchNodeNeighbors(read, fromNode, new Set(), new Set(), 15);
        candidates = origin.neighbors;
        selected = selectChainEvidence(candidates, fromNode, next);
      }
      if (selected) {
        edgeId = selected.id;
        relation = selected.relation;
        epistemic = selected.epistemic;
        stepRefs = selected.refs;
        if (next === selected.id) toNode = chainEvidenceTarget(selected, fromNode);
      } else if (/^r1[0123]:/i.test(next)) {
        const rawEv = await safeCallFirst(read, 'get_connection_evidence_v1', { evidence_id: next });
        const ev = unwrapEvidencePayload(rawEv);
        if (ev && rawEv?.status !== 'not_found') {
          edgeId = next;
          relation = str(ev.predicate ?? ev.relation, relation);
          epistemic = str(ev.epistemic_class ?? ev.epistemic, 'documented_lexical_relationship');
          stepRefs = asArr(ev.passages).map(asRec).filter(Boolean).map(p => str(p?.ref)).filter(Boolean).slice(0, 4);
          const words = asArr(ev.original_words).map(asRec).filter(Boolean);
          const cand = words.find(w => str(w?.strongs).toLowerCase() !== fromNode.toLowerCase());
          toNode = str(cand?.strongs) || stepRefs[0] || next;
        }
      } else {
        // Pairwise fallback when manually jumping to a target not present in top-15 single-anchor neighbors
        const pairRes = await handleGetConnection(read, [fromNode, next], 5).catch(() => null);
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
      const { resolvedNode, neighbors } = await fetchNodeNeighbors(read, toNode, visitedSet, edgeSet, limit);
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

      const updated = await chainStore.update(chain, st, sessionId);
      if (!updated.ok) return errorReply(updated.message, { code: updated.error });

      return jsonReply({
        status: 'ok',
        chain,
        expires_at: updated.state.expires_at,
        step: updated.state.steps.length,
        added_step: newStep,
        current_node: updated.state.current_node,
        path_trail: [updated.state.root, ...updated.state.steps.map(s => `${s.from_node} -> ${s.to_node} [${s.relation}]`)],
        visited_count: updated.state.visited_nodes.length,
        chain_epistemic_summary: summarizeChainEpistemics(updated.state.steps),
        next_connections: neighbors,
        branches: updated.state.branches,
      });
    } catch {
      return errorReply('Connection chain traversal failed.');
    }
  });

  // 5. research
  server.registerTool('research', {
    title: 'Run targeted combined searches and calculations',
    description:
      'Flexible composable investigation tool. Supply a natural-language query or an array of up to 8 operations in one call: evidence, occurrences, intersect_words, grammar_search, lxx, gematria, numbers, chronology_occurrences, geography_search, passage_compare, notes_search, set_combine, discover_patterns, compare_patterns, trace_evidence, genealogy, tribe_lineage, sacred_architecture, feasts_calendar.',
    inputSchema: z.strictObject({
      query: z.string().trim().min(1).max(400).optional().describe('Shorthand query (evidence_id, passages to compare, or topic/concept).'),
      operations: z.array(ResearchOpSchema).min(1).max(8).optional().describe('Batch of 1-8 declarative operations executed together with optional set_combine across results.'),
      limit: z.number().int().min(1).max(50).optional().describe('Default per-operation result cap (default 15, max 50).'),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    ...readOnlyMeta,
  }, async ({ query, operations, limit }) => {
    try {
      const payload = await executeResearch(read, { query, operations, limit });
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
      title: 'Create, update, delete, or save DLM study notes (user-authorized only)',
      description:
        'Preserves existing note-writing permissions, agent-key auth, ownership, kill switch, and DLM evidence separation. Only call when the user explicitly authorizes saving/updating/deleting a note. Supports action="create"|"update"|"delete"|"save_dlm".',
      inputSchema: z.strictObject({
        action: z.enum(['create', 'update', 'delete', 'save_dlm']).default('create'),
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
      }),
      outputSchema: z.record(z.string(), z.unknown()),
      ...writeMeta,
    }, async (args) => {
      const headers = getHeaders?.();
      const clientInfo = server.server.getClientVersion?.();

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
    outputSchema: z.object({
      version: z.string(),
      instructions: z.string(),
    }),
    ...readOnlyMeta,
  }, () => ({
    content: textReply(WORKFLOW_INSTRUCTIONS),
    structuredContent: {
      version: WORKFLOW_VERSION,
      instructions: WORKFLOW_INSTRUCTIONS,
    },
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
