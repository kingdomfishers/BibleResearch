// @file: src/relationships/v4-hreg-types.ts
// Pure TypeScript types & compact binary codecs for BibleResearch v4 Higher-Order Relational Event Graphs (HREG),
// Pericope Table (BRV4PER), Predicate Similarity Oracle (BRV4SIM), and ESIDE Interpretation Sidecar.
// Zero Node-only imports; runs identically in Cloudflare Workers, Deno, Browser, and Node.

export const HREG_MAGIC = 'BRV4HREG';
export const PER_MAGIC = 'BRV4PER\0';
export const SIM_MAGIC = 'BRV4SIM\0';
export const RMAC_MAGIC = 'BRV4MAC\0';

export const HREG_SORTS = [
  'DEITY',
  'HUMAN',
  'GROUP',
  'CREATURE',
  'NATURE',
  'ARTIFACT',
  'PLACE',
  'ABSTRACT',
  'PROP',
] as const;
export type HregSort = (typeof HREG_SORTS)[number];

export const EVENT_ARCHETYPES = [
  'EMIT_SEND',
  'MOVE_DIRECTED',
  'RETURN_TURN',
  'ASCEND_ELEVATE',
  'DESCEND_HUMBLE',
  'CREATE_MAKE',
  'BEAR_PRODUCE',
  'DESTROY_STRIKE',
  'HEAL_RESTORE',
  'TRANSFORM_CHANGE',
  'GIVE_TRANSFER',
  'TAKE_SEIZE',
  'CAST_PLACE',
  'SEPARATE_DIVIDE',
  'JOIN_GATHER',
  'COVER_PROTECT',
  'SPEAK_DECLARE',
  'COMMAND_DIRECT',
  'APPEAL_CRY',
  'PERCEIVE_WITNESS',
  'KNOW_REMEMBER',
  'TEST_JUDGE',
  'COVENANT_BIND',
  'VIOLATE_SIN',
  'CONSUME_NOURISH',
  'WORSHIP_OFFER',
  'LIVE_DIE',
  'EXIST_EQUATE',
] as const;
export type EventArchetype = (typeof EVENT_ARCHETYPES)[number];

export const ARG_ROLES = [
  'AGENT',
  'PATIENT',
  'RECIPIENT',
  'THEME_2',
  'SOURCE',
  'GOAL_LOC',
  'INSTRUMENT',
  'MANNER_TIME',
] as const;
export type ArgRole = (typeof ARG_ROLES)[number];

export const HO_TYPES = [
  'CAUSE_GROUND',
  'RESULT_INFERENCE',
  'PURPOSE',
  'AVOIDANCE_LEST',
  'CONDITION',
  'CONTRAST_EXCEPT',
  'CONTRAST_ANTI',
  'CONCESSION',
  'EXPLICIT_ANALOGY',
  'A_FORTIORI',
  'PROPOSITIONAL_FRAME',
  'STATE_REVERSAL',
  'CMD_EXEC',
  'ORD',
] as const;
export type HoType = (typeof HO_TYPES)[number];

export type ForceKind = 'ASSERT' | 'DIRECTIVE' | 'PROHIBIT' | 'INTERROGATIVE' | 'PROMISE';

export const FORCE_KINDS: readonly ForceKind[] = [
  'ASSERT',
  'DIRECTIVE',
  'PROHIBIT',
  'INTERROGATIVE',
  'PROMISE',
] as const;

export interface HregParticipant {
  pid: number;
  strongs: string;
  conceptId: string;
  tipnrId: string;
  sort: HregSort;
  valence: -1 | 0 | 1;
  corefConf: number; // 0.75..1.0
  mentionVids: number[];
}

export interface HregArgBinding {
  role: ArgRole;
  pid: number;
}

export interface HregEvent {
  eid: number;
  vid: number;
  strongs: string;
  conceptId: string;
  arch: EventArchetype;
  pol: 'POS' | 'NEG';
  isCausative: boolean;
  isExistential: boolean;
  isPassive: boolean;
  force: ForceKind;
  valence: -1 | 0 | 1;
  idf: number;
  promotedConceptId: string; // non-empty when isExistential promotes PATIENT/PRED_NOM
  promotedStrongs: string;
  argRoles: HregArgBinding[]; // NEVER named `frame`!
}

export interface HregHoEdge {
  hid: number;
  hoType: HoType;
  fromEid: number;
  toEid: number;
  vid: number;
}

export interface CompactHreg {
  pericopeId: number;
  startVid: number;
  endVid: number;
  book: number;
  genre: number;
  participants: HregParticipant[];
  events: HregEvent[];
  hoEdges: HregHoEdge[];
  esideTags: number; // bitmask of M4 frame types
}

export interface PericopeMeta {
  pericopeId: number;
  startVid: number;
  endVid: number;
  book: number;
  genre: number;
  evCount: number;
  hoCount: number;
  packFile: number;
  flags: number;
  byteOff: number;
  byteLen: number;
}

export interface PericopeTable {
  numPericopes: number;
  records: PericopeMeta[];
  vidToPericopes: Uint32Array; // 31203 * 2 (up to 2 pericope IDs per vid, 0 = none)
  lookupVidPericopes(vid: number): number[];
}

export interface PredicateSimOracle {
  strongsToIdx: Map<string, number>;
  idxToStrongs: string[];
  /** Sorted uint32 pairs ((minIdx << 16) | maxIdx) -> simQ8 (0..255 -> 0..1) */
  pairKeys: Uint32Array;
  pairSims: Uint8Array;
  lookupProximitySim(bsA: string, bsB: string): number;
  sameConceptOrTipnr(pA: HregParticipant, pB: HregParticipant): boolean;
  isLxxLinked?(bsA: string, bsB: string): boolean;
}

const UTF8_ENC = new TextEncoder();
const UTF8_DEC = new TextDecoder('utf-8');

function checkHeader(bytes: Uint8Array, magic: string): boolean {
  if (bytes.byteLength < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Encode a CompactHreg into a compact binary buffer (placed inside gzipped packs).
 * Uses a local string dictionary so each participant/event uses fixed compact integers.
 */
export function encodeCompactHreg(g: CompactHreg): Uint8Array {
  const strings: string[] = [''];
  const strToId = new Map<string, number>([['', 0]]);
  const intern = (s: string): number => {
    const clean = s || '';
    const existing = strToId.get(clean);
    if (existing !== undefined) return existing;
    const id = strings.length;
    strings.push(clean);
    strToId.set(clean, id);
    return id;
  };

  for (const p of g.participants) {
    intern(p.strongs);
    intern(p.conceptId);
    intern(p.tipnrId);
  }
  for (const e of g.events) {
    intern(e.strongs);
    intern(e.conceptId);
    intern(e.promotedConceptId);
    intern(e.promotedStrongs);
  }

  const encodedStrs = strings.map(s => UTF8_ENC.encode(s));
  let strBytesTotal = 2; // count u16
  for (const b of encodedStrs) strBytesTotal += 2 + b.byteLength;

  let partBytesTotal = 0;
  for (const p of g.participants) {
    partBytesTotal += 10 + Math.min(255, p.mentionVids.length) * 2;
  }
  let evBytesTotal = 0;
  for (const e of g.events) {
    evBytesTotal += 18 + Math.min(255, e.argRoles.length) * 2;
  }
  const hoBytesTotal = g.hoEdges.length * 6;

  const totalBytes = 20 + strBytesTotal + partBytesTotal + evBytesTotal + hoBytesTotal;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);

  for (let i = 0; i < 8; i++) out[i] = HREG_MAGIC.charCodeAt(i);
  view.setUint32(8, g.pericopeId, true);
  view.setUint16(12, g.startVid, true);
  view.setUint16(14, g.endVid, true);
  out[16] = g.book & 0xff;
  out[17] = g.genre & 0xff;
  out[18] = g.participants.length & 0xff;
  out[19] = g.events.length & 0xff;

  let pos = 20;
  // Write HO count + esideTags inside first 2 bytes? No, store HO count right after events!
  view.setUint16(pos, strings.length, true);
  pos += 2;
  for (const b of encodedStrs) {
    view.setUint16(pos, b.byteLength, true);
    pos += 2;
    out.set(b, pos);
    pos += b.byteLength;
  }

  for (const p of g.participants) {
    out[pos++] = p.pid & 0xff;
    out[pos++] = Math.max(0, HREG_SORTS.indexOf(p.sort)) & 0xff;
    view.setUint16(pos, intern(p.strongs), true); pos += 2;
    view.setUint16(pos, intern(p.conceptId), true); pos += 2;
    view.setUint16(pos, intern(p.tipnrId), true); pos += 2;
    out[pos++] = p.valence < 0 ? 2 : p.valence > 0 ? 1 : 0;
    const mvCount = Math.min(255, p.mentionVids.length);
    out[pos++] = mvCount;
    for (let i = 0; i < mvCount; i++) {
      view.setUint16(pos, p.mentionVids[i], true); pos += 2;
    }
  }

  for (const e of g.events) {
    out[pos++] = e.eid & 0xff;
    view.setUint16(pos, e.vid, true); pos += 2;
    view.setUint16(pos, intern(e.strongs), true); pos += 2;
    view.setUint16(pos, intern(e.conceptId), true); pos += 2;
    view.setUint16(pos, intern(e.promotedConceptId), true); pos += 2;
    view.setUint16(pos, intern(e.promotedStrongs), true); pos += 2;
    out[pos++] = Math.max(0, EVENT_ARCHETYPES.indexOf(e.arch)) & 0xff;
    const flags =
      (e.pol === 'NEG' ? 1 : 0) |
      (e.isCausative ? 2 : 0) |
      (e.isExistential ? 4 : 0) |
      (e.isPassive ? 8 : 0) |
      ((Math.max(0, FORCE_KINDS.indexOf(e.force)) & 0x07) << 4);
    out[pos++] = flags;
    out[pos++] = e.valence < 0 ? 2 : e.valence > 0 ? 1 : 0;
    view.setUint16(pos, Math.min(65535, Math.round(e.idf * 1000)), true); pos += 2;
    const ac = Math.min(255, e.argRoles.length);
    out[pos++] = ac;
    out[pos++] = 0; // reserved pad
    for (let i = 0; i < ac; i++) {
      out[pos++] = Math.max(0, ARG_ROLES.indexOf(e.argRoles[i].role)) & 0xff;
      out[pos++] = e.argRoles[i].pid & 0xff;
    }
  }

  // Wait: append hoEdges header (2B hoCount + 2B esideTags) — adjust buffer size if needed
  const hoHeader = new Uint8Array(4 + g.hoEdges.length * 6);
  const hoView = new DataView(hoHeader.buffer);
  hoView.setUint16(0, g.hoEdges.length, true);
  hoView.setUint16(2, g.esideTags & 0xffff, true);
  let hp = 4;
  for (const h of g.hoEdges) {
    hoHeader[hp++] = h.hid & 0xff;
    hoHeader[hp++] = Math.max(0, HO_TYPES.indexOf(h.hoType)) & 0xff;
    hoHeader[hp++] = h.fromEid & 0xff;
    hoHeader[hp++] = h.toEid & 0xff;
    hoView.setUint16(hp, h.vid, true); hp += 2;
  }

  const finalOut = new Uint8Array(pos + hoHeader.byteLength);
  finalOut.set(out.subarray(0, pos), 0);
  finalOut.set(hoHeader, pos);
  return finalOut;
}

export function decodeCompactHreg(bytes: Uint8Array): CompactHreg {
  if (!checkHeader(bytes, HREG_MAGIC)) throw new Error('Invalid BRV4HREG header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pericopeId = view.getUint32(8, true);
  const startVid = view.getUint16(12, true);
  const endVid = view.getUint16(14, true);
  const book = bytes[16];
  const genre = bytes[17];
  const partCount = bytes[18];
  const evCount = bytes[19];

  let pos = 20;
  const strCount = view.getUint16(pos, true); pos += 2;
  const strings: string[] = new Array(strCount);
  for (let i = 0; i < strCount; i++) {
    const len = view.getUint16(pos, true); pos += 2;
    strings[i] = len > 0 ? UTF8_DEC.decode(bytes.subarray(pos, pos + len)) : '';
    pos += len;
  }

  const participants: HregParticipant[] = new Array(partCount);
  for (let i = 0; i < partCount; i++) {
    const pid = bytes[pos++];
    const sortIdx = bytes[pos++];
    const sId = view.getUint16(pos, true); pos += 2;
    const cId = view.getUint16(pos, true); pos += 2;
    const tId = view.getUint16(pos, true); pos += 2;
    const valByte = bytes[pos++];
    const mvCount = bytes[pos++];
    const mentionVids: number[] = new Array(mvCount);
    for (let j = 0; j < mvCount; j++) {
      mentionVids[j] = view.getUint16(pos, true); pos += 2;
    }
    participants[i] = {
      pid,
      strongs: strings[sId] || '',
      conceptId: strings[cId] || '',
      tipnrId: strings[tId] || '',
      sort: HREG_SORTS[sortIdx] ?? 'PROP',
      valence: valByte === 2 ? -1 : valByte === 1 ? 1 : 0,
      corefConf: 0.95,
      mentionVids,
    };
  }

  const events: HregEvent[] = new Array(evCount);
  for (let i = 0; i < evCount; i++) {
    const eid = bytes[pos++];
    const vid = view.getUint16(pos, true); pos += 2;
    const sId = view.getUint16(pos, true); pos += 2;
    const cId = view.getUint16(pos, true); pos += 2;
    const pcId = view.getUint16(pos, true); pos += 2;
    const psId = view.getUint16(pos, true); pos += 2;
    const archIdx = bytes[pos++];
    const flags = bytes[pos++];
    const valByte = bytes[pos++];
    const idf = view.getUint16(pos, true) / 1000; pos += 2;
    const ac = bytes[pos++];
    pos++; // pad
    const argRoles: HregArgBinding[] = new Array(ac);
    for (let j = 0; j < ac; j++) {
      const rIdx = bytes[pos++];
      const pid = bytes[pos++];
      argRoles[j] = { role: ARG_ROLES[rIdx] ?? 'PATIENT', pid };
    }
    events[i] = {
      eid,
      vid,
      strongs: strings[sId] || '',
      conceptId: strings[cId] || '',
      promotedConceptId: strings[pcId] || '',
      promotedStrongs: strings[psId] || '',
      arch: EVENT_ARCHETYPES[archIdx] ?? 'EXIST_EQUATE',
      pol: (flags & 1) !== 0 ? 'NEG' : 'POS',
      isCausative: (flags & 2) !== 0,
      isExistential: (flags & 4) !== 0,
      isPassive: (flags & 8) !== 0,
      force: FORCE_KINDS[(flags >>> 4) & 0x07] ?? 'ASSERT',
      valence: valByte === 2 ? -1 : valByte === 1 ? 1 : 0,
      idf,
      argRoles,
    };
  }

  const hoCount = view.getUint16(pos, true); pos += 2;
  const esideTags = view.getUint16(pos, true); pos += 2;
  const hoEdges: HregHoEdge[] = new Array(hoCount);
  for (let i = 0; i < hoCount; i++) {
    const hid = bytes[pos++];
    const hoIdx = bytes[pos++];
    const fromEid = bytes[pos++];
    const toEid = bytes[pos++];
    const vid = view.getUint16(pos, true); pos += 2;
    hoEdges[i] = {
      hid,
      hoType: HO_TYPES[hoIdx] ?? 'ORD',
      fromEid,
      toEid,
      vid,
    };
  }

  return {
    pericopeId,
    startVid,
    endVid,
    book,
    genre,
    participants,
    events,
    hoEdges,
    esideTags,
  };
}

/**
 * Parse v4/index/pericopes.bin (BRV4PER\0) + optional vid-to-pericopes.bin.
 * Header (16B): magic(8) | version:u32(1) | numPericopes:u32
 * Record (16B): startVid:u16 | endVid:u16 | book:u8 | genre:u8 | evCount:u8 | hoCount:u8 | packFile:u8 | flags:u8 | byteOff:u32 | byteLen:u16
 */
export function parsePericopeTable(perBytes: Uint8Array, vidMapBytes?: Uint8Array | null): PericopeTable {
  if (!checkHeader(perBytes, PER_MAGIC)) throw new Error('Invalid BRV4PER magic header');
  const view = new DataView(perBytes.buffer, perBytes.byteOffset, perBytes.byteLength);
  const numPericopes = view.getUint32(12, true);
  const records: PericopeMeta[] = new Array(numPericopes);
  for (let i = 0; i < numPericopes; i++) {
    const off = 16 + i * 16;
    records[i] = {
      pericopeId: i + 1,
      startVid: view.getUint16(off, true),
      endVid: view.getUint16(off + 2, true),
      book: perBytes[off + 4],
      genre: perBytes[off + 5],
      evCount: perBytes[off + 6],
      hoCount: perBytes[off + 7],
      packFile: perBytes[off + 8],
      flags: perBytes[off + 9],
      byteOff: view.getUint32(off + 10, true),
      byteLen: view.getUint16(off + 14, true),
    };
  }
  const vidToPericopes = new Uint32Array(31203 * 2);
  if (vidMapBytes && vidMapBytes.byteLength >= 31203 * 8) {
    const mv = new DataView(vidMapBytes.buffer, vidMapBytes.byteOffset, vidMapBytes.byteLength);
    for (let i = 0; i < 31203 * 2; i++) {
      vidToPericopes[i] = mv.getUint32(i * 4, true);
    }
  } else {
    for (const r of records) {
      for (let v = r.startVid; v <= r.endVid && v <= 31203; v++) {
        const base = (v - 1) * 2;
        if (vidToPericopes[base] === 0) vidToPericopes[base] = r.pericopeId;
        else if (vidToPericopes[base + 1] === 0) vidToPericopes[base + 1] = r.pericopeId;
      }
    }
  }
  const lookupVidPericopes = (vid: number): number[] => {
    if (!Number.isFinite(vid) || vid < 1 || vid > 31203) return [];
    const base = (vid - 1) * 2;
    const p1 = vidToPericopes[base];
    const p2 = vidToPericopes[base + 1];
    if (p1 === 0) return [];
    return p2 !== 0 ? [p1, p2] : [p1];
  };
  return { numPericopes, records, vidToPericopes, lookupVidPericopes };
}

/**
 * Parse v4/index/pred-sim.bin (BRV4SIM\0).
 * Header (20B): magic(8) | version:u32(1) | numStrongs:u32 | numPairs:u32
 * Dictionary: numStrongs * 8B fixed ASCII Strong's (padded with 0)
 * Pairs: numPairs * 5B (pairKey:u32 = (minIdx<<16)|maxIdx, simQ8:u8) sorted ascending by pairKey.
 */
export function parsePredSimTable(bytes: Uint8Array): PredicateSimOracle {
  if (!checkHeader(bytes, SIM_MAGIC)) throw new Error('Invalid BRV4SIM magic header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numStrongs = view.getUint32(12, true);
  const numPairs = view.getUint32(16, true);

  const strongsToIdx = new Map<string, number>();
  const idxToStrongs: string[] = new Array(numStrongs);
  let pos = 20;
  for (let i = 0; i < numStrongs; i++) {
    let s = '';
    for (let j = 0; j < 8; j++) {
      const c = bytes[pos + j];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    pos += 8;
    idxToStrongs[i] = s;
    strongsToIdx.set(s, i);
  }

  const pairKeys = new Uint32Array(numPairs);
  const pairSims = new Uint8Array(numPairs);
  for (let i = 0; i < numPairs; i++) {
    pairKeys[i] = view.getUint32(pos, true);
    pairSims[i] = bytes[pos + 4];
    pos += 5;
  }

  const lookupProximitySim = (bsA: string, bsB: string): number => {
    if (!bsA || !bsB) return 0;
    if (bsA === bsB) return 1.0;
    const iA = strongsToIdx.get(bsA);
    const iB = strongsToIdx.get(bsB);
    if (iA === undefined || iB === undefined) return 0;
    const loIdx = iA < iB ? iA : iB;
    const hiIdx = iA < iB ? iB : iA;
    const target = ((loIdx << 16) | hiIdx) >>> 0;
    let lo = 0;
    let hi = numPairs - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const k = pairKeys[mid];
      if (k < target) lo = mid + 1;
      else if (k > target) hi = mid - 1;
      else return pairSims[mid] / 255;
    }
    return 0;
  };

  const sameConceptOrTipnr = (pA: HregParticipant, pB: HregParticipant): boolean => {
    if (pA.tipnrId && pB.tipnrId && pA.tipnrId === pB.tipnrId) return true;
    if (pA.conceptId && pB.conceptId && pA.conceptId === pB.conceptId) return true;
    if (pA.strongs && pB.strongs && pA.strongs === pB.strongs) return true;
    return false;
  };

  return {
    strongsToIdx,
    idxToStrongs,
    pairKeys,
    pairSims,
    lookupProximitySim,
    sameConceptOrTipnr,
  };
}
