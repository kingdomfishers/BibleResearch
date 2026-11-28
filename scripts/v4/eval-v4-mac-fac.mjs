/**
 * Gate V4-2: MAC/FAC Structural Analogy Recall vs. Hard-Negative Rejection Suite
 * Tests R-MAC Recall@32 >= 90%, Biblical-SME p_struct < 0.05 on positives,
 * 10/10 hard-negative rejections, and < 1.5 ms/pair SME latency.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  decodeCompactHreg,
  parsePericopeTable,
  parsePredSimTable,
} from '../../src/relationships/v4-hreg-types.ts';
import {
  parseRmacBmwIndex,
  queryRmacCandidates,
} from '../../src/relationships/v4-rmac-index.ts';
import {
  evaluateSmePair,
  runSeqlGeneralization,
} from '../../src/relationships/v4-sme-engine.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const v4Dir = path.join(repoRoot, '.artifacts-r12/staging-bundle/v4');

const perTable = parsePericopeTable(
  fs.readFileSync(path.join(v4Dir, 'index/pericopes.bin')),
  fs.readFileSync(path.join(v4Dir, 'index/vid-to-pericopes.bin')),
);
const simOracle = parsePredSimTable(fs.readFileSync(path.join(v4Dir, 'index/pred-sim.bin')));
const rmacIdx = parseRmacBmwIndex(fs.readFileSync(path.join(v4Dir, 'index/rmac-bmw.bin')));

// Load catalog metadata to resolve passage refs -> canonical vid ranges
const cat = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(repoRoot, '.artifacts-r12/staging-bundle/v1/catalog/metadata.json.gz'))).toString('utf8'));
const bookByName = new Map();
for (const b of cat.books) {
  bookByName.set(b.name.toLowerCase(), b.id);
  bookByName.set(b.usfm.toLowerCase(), b.id);
}
const BOOK_ALIASES = {
  gen: 1, exod: 2, lev: 3, num: 4, deut: 5, josh: 6, judg: 7, ruth: 8,
  '1 kgs': 11, '2 kgs': 12, '1 chr': 13, ezra: 15, ps: 19, isa: 23, jer: 24, ezek: 26, dan: 27,
  amos: 30, jonah: 32, zech: 38, matt: 40, mark: 41, luke: 42, john: 43,
  rom: 45, '1 cor': 46, '2 cor': 47, gal: 48, heb: 58, '1 pet': 60, rev: 66,
};
for (const [k, v] of Object.entries(BOOK_ALIASES)) bookByName.set(k, v);

const vidByBcv = new Map();
const chapterVids = new Map();
for (const [vid, b, c, v] of cat.verses_compact) {
  vidByBcv.set(`${b}:${c}:${v}`, vid);
  const ck = `${b}:${c}`;
  if (!chapterVids.has(ck)) chapterVids.set(ck, []);
  chapterVids.get(ck).push(vid);
}

function resolveSpanVids(refStr) {
  const m = /^(.+?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/.exec(refStr.trim());
  if (!m) throw new Error(`Cannot parse ref: ${refStr}`);
  const bId = bookByName.get(m[1].toLowerCase());
  if (!bId) throw new Error(`Unknown book: ${m[1]}`);
  const ch = Number(m[2]);
  if (!m[3]) {
    const arr = chapterVids.get(`${bId}:${ch}`) || [];
    return [arr[0], arr[arr.length - 1]];
  }
  const v1 = Number(m[3]);
  const v2 = m[4] ? Number(m[4]) : v1;
  return [vidByBcv.get(`${bId}:${ch}:${v1}`), vidByBcv.get(`${bId}:${ch}:${v2}`)];
}

const packCache = new Map();
function loadHreg(pericopeId) {
  const meta = perTable.records[pericopeId - 1];
  if (!meta) return null;
  if (!packCache.has(meta.packFile)) {
    packCache.set(meta.packFile, fs.readFileSync(path.join(v4Dir, `hreg/pack-${String(meta.packFile).padStart(2, '0')}.bin`)));
  }
  const pack = packCache.get(meta.packFile);
  const slice = pack.subarray(meta.byteOff, meta.byteOff + meta.byteLen);
  const plain = slice[0] === 0x1f && slice[1] === 0x8b ? zlib.gunzipSync(slice) : slice;
  return decodeCompactHreg(plain);
}

function getBestPericopesForSpan(refStr) {
  const [sVid, eVid] = resolveSpanVids(refStr);
  const cands = [];
  for (const r of perTable.records) {
    const overlap = Math.min(r.endVid, eVid) - Math.max(r.startVid, sVid) + 1;
    if (overlap > 0) {
      const span = eVid - sVid + 1;
      const rSpan = r.endVid - r.startVid + 1;
      const jaccard = overlap / (span + rSpan - overlap);
      cands.push({ pericopeId: r.pericopeId, overlap, jaccard });
    }
  }
  cands.sort((a, b) => b.jaccard - a.jaccard || b.overlap - a.overlap);
  return cands.slice(0, 6).map(c => loadHreg(c.pericopeId));
}

function spansOverlap(hreg, targetHregs) {
  return targetHregs.some(th => Math.max(hreg.startVid, th.startVid) <= Math.min(hreg.endVid, th.endVid));
}

const POSITIVES = [
  { id: 'POS-01', base: 'Isa 55:10-10', target: 'Isa 55:11-11', mode: 'CONCORDANT' },
  { id: 'POS-02', base: 'Exod 15:23-26', target: '2 Kgs 2:19-22', mode: 'CONCORDANT' },
  { id: 'POS-03', base: 'Gen 1:1-26', target: 'Jer 4:23-26', mode: 'INVERSION' },
  { id: 'POS-04', base: 'Gen 19:1-11', target: 'Judg 19:16-24', mode: 'CONCORDANT' },
  { id: 'POS-05', base: 'Isa 5:1-7', target: 'Ps 80:8-16', mode: 'CONCORDANT' },
  { id: 'POS-06', base: 'Isa 5:1-7', target: 'Rom 11:16-24', mode: 'CONCORDANT' },
  { id: 'POS-07', base: 'Num 21:6-9', target: 'John 3:14-15', mode: 'CONCORDANT' },
  { id: 'POS-08', base: 'Jonah 1:4-16', target: 'Ps 107:23-32', mode: 'CONCORDANT' },
  { id: 'POS-09', base: 'Gen 38:6-26', target: 'Ruth 4:1-13', mode: 'CONCORDANT' },
  { id: 'POS-10', base: 'Gen 22:1-14', target: 'Heb 11:17-19', mode: 'CONCORDANT' },
  { id: 'POS-11', base: 'Deut 8:1-5', target: 'Matt 4:1-11', mode: 'CONCORDANT' },
  { id: 'POS-12', base: 'Isa 55:10-11', target: 'Luke 8:4-15', mode: 'CONCORDANT' },
  { id: 'POS-13', base: 'Exod 17:1-7', target: 'Num 20:2-13', mode: 'CONCORDANT' },
  { id: 'POS-14', base: 'Gen 1:1-31', target: 'Exod 20:8-11', mode: 'CONCORDANT' },
];

const NEGATIVES = [
  { id: 'NEG-01', base: 'Gen 19:10-10', target: 'Ezek 41:23-23' },
  { id: 'NEG-02', base: 'Gen 19:1-11', target: 'Ezek 41:15-26' },
  { id: 'NEG-03', base: 'Isa 55:10-10', target: 'Gen 5:1-15' },
  { id: 'NEG-04', base: 'Exod 15:23-26', target: 'Ps 136:1-12' },
  { id: 'NEG-05', base: 'Amos 1:3-15', target: 'Num 7:12-23' },
  { id: 'NEG-06', base: 'Lev 11:1-12', target: '1 Cor 14:1-12' },
  { id: 'NEG-07', base: '1 Chr 1:1-15', target: 'Rev 21:1-12' },
  { id: 'NEG-08', base: 'Josh 15:1-12', target: 'Rom 16:1-12' },
  { id: 'NEG-09', base: 'Ezra 2:1-15', target: 'Mark 7:1-12' },
  { id: 'NEG-10', base: 'Num 26:1-15', target: 'Gal 2:1-12' },
];

let posRmacHits = 0;
let posSmePass = 0;
const posDetails = [];
const smeLatencies = [];

for (const tc of POSITIVES) {
  const bHregs = getBestPericopesForSpan(tc.base);
  const tHregs = getBestPericopesForSpan(tc.target);

  // Check R-MAC Recall@32 (excluding direct same-span pericopes; intra-pericope POS-01 tracked separately)
  let rmacHit = false;
  for (const bh of bHregs) {
    const cands = queryRmacCandidates(rmacIdx, bh, { kStructural: 16, kHybrid: 16, kTotal: 32, pericopeTable: perTable });
    if (cands.some(c => {
      const ch = loadHreg(c.pericopeId);
      return ch && spansOverlap(ch, tHregs);
    })) {
      rmacHit = true;
      break;
    }
  }
  const samePericope = bHregs.some(bh => tHregs.some(th => bh.pericopeId === th.pericopeId));
  if (rmacHit) posRmacHits++;

  // Evaluate best pairwise Biblical-SME across the top pericope slices
  let bestEval = null;
  for (const bh of bHregs.slice(0, 6)) {
    for (const th of tHregs.slice(0, 4)) {
      const t0 = performance.now();
      const ev = evaluateSmePair(bh, th, simOracle, { bPerm: 32 });
      smeLatencies.push(performance.now() - t0);
      if (!bestEval || ev.deltaSmeStruct > bestEval.deltaSmeStruct || (ev.deltaSmeStruct === bestEval.deltaSmeStruct && ev.winning.sms > bestEval.winning.sms)) {
        bestEval = ev;
      }
    }
  }
  const smeOk = Boolean(bestEval && bestEval.pStruct < 0.05 && bestEval.deltaSmeStruct > 0);
  if (smeOk) posSmePass++;
  posDetails.push({
    id: tc.id,
    pair: `${tc.base} <-> ${tc.target}`,
    samePericope,
    rmacHit,
    smeOk,
    regime: bestEval?.regime,
    classification: bestEval?.classification,
    sms: bestEval?.winning.sms,
    pStruct: bestEval?.pStruct,
    delta: bestEval?.deltaSmeStruct,
    mappedEv: bestEval?.winning.mappedEvents.length,
    mappedHo: bestEval?.winning.mappedHo.length,
  });
}

let negRejected = 0;
const negDetails = [];
for (const tc of NEGATIVES) {
  const bHregs = getBestPericopesForSpan(tc.base);
  const tHregs = getBestPericopesForSpan(tc.target);
  let bestEval = null;
  for (const bh of bHregs.slice(0, 2)) {
    for (const th of tHregs.slice(0, 2)) {
      const t0 = performance.now();
      const ev = evaluateSmePair(bh, th, simOracle, { bPerm: 32 });
      smeLatencies.push(performance.now() - t0);
      if (!bestEval || ev.deltaSmeStruct > bestEval.deltaSmeStruct) bestEval = ev;
    }
  }
  const rejected = !bestEval || bestEval.deltaSmeStruct === 0 || bestEval.pStruct >= 0.05;
  if (rejected) negRejected++;
  negDetails.push({
    id: tc.id,
    pair: `${tc.base} <-> ${tc.target}`,
    rejected,
    sms: bestEval?.winning.sms,
    pStruct: bestEval?.pStruct,
    delta: bestEval?.deltaSmeStruct,
  });
}

// 3-Way SEQL check: Isa 5:1-7 + Ps 80:8-16 + Rom 11:16-24
const seqlHregs = [
  getBestPericopesForSpan('Isa 5:1-7')[0],
  getBestPericopesForSpan('Ps 80:8-16')[0],
  getBestPericopesForSpan('Rom 11:16-24')[0],
];
const seqlRes = runSeqlGeneralization(seqlHregs, simOracle);

smeLatencies.sort((a, b) => a - b);
const p50 = smeLatencies[Math.floor(smeLatencies.length * 0.5)] || 0;
const p95 = smeLatencies[Math.floor(smeLatencies.length * 0.95)] || 0;

const distinctPos = posDetails.filter(p => !p.samePericope);
const distinctRmacHits = distinctPos.filter(p => p.rmacHit).length;
const summary = {
  gate: 'V4-2',
  pos_total: POSITIVES.length,
  distinct_pericope_pos_total: distinctPos.length,
  rmac_recall_at_32: `${distinctRmacHits}/${distinctPos.length} (${((distinctRmacHits / Math.max(1, distinctPos.length)) * 100).toFixed(1)}%)`,
  rmac_all_14: `${posRmacHits}/${POSITIVES.length}`,
  sme_pass: `${posSmePass}/${POSITIVES.length}`,
  neg_rejected: `${negRejected}/${NEGATIVES.length}`,
  seql_schema_events: seqlRes.schemaEvents.length,
  seql_schema_ho: seqlRes.schemaHoEdges.length,
  sme_pair_with_32_perms_p50_ms: Number(p50.toFixed(2)),
  sme_pair_with_32_perms_p95_ms: Number(p95.toFixed(2)),
  positives: posDetails,
  negatives: negDetails,
};

fs.mkdirSync(path.join(repoRoot, '.artifacts-r12/v4-eval'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, '.artifacts-r12/v4-eval/gate-v4-2.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  gate: summary.gate,
  rmac_recall_at_32: summary.rmac_recall_at_32,
  sme_pass: summary.sme_pass,
  neg_rejected: summary.neg_rejected,
  seql_schema_events: summary.seql_schema_events,
  seql_schema_ho: summary.seql_schema_ho,
  p50_ms: summary.sme_pair_with_32_perms_p50_ms,
  p95_ms: summary.sme_pair_with_32_perms_p95_ms,
  failed_pos: posDetails.filter(p => !p.rmacHit || !p.smeOk).map(p => `${p.id}: rmac=${p.rmacHit}, sme=${p.smeOk}, p=${p.pStruct}, sms=${p.sms}`),
  failed_neg: negDetails.filter(n => !n.rejected).map(n => `${n.id}: p=${n.pStruct}, delta=${n.delta}`),
}, null, 2));
