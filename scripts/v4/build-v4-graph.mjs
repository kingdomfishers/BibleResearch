#!/usr/bin/env node
/**
 * BibleResearch v4 Graph Builder (Multi-threaded SME + 8-Partition CSR + Forward-Push PPR):
 * Upgrades the canonical typed conductance CSR & Top-64 PPR shards from 6 to 8 partitions:
 *   0: OCC, 1: XREF, 2: LXX, 3: LEX_SYN, 4: WP (stripped of r13_self_interpretations),
 *   5: CONCEPT_PROC (mass <= 0.06),
 *   6: EXPLICIT_INTERP (v4 ESIDE C1-C7 provenance edges, strict transitivity),
 *   7: STRUCT_ANALOGY (offline Top-8 R-MAC + Biblical-SME edges, NON_TRANSITIVE flag 0x80, mass <= 0.08).
 *
 * Updates BOTH:
 *   - .artifacts-r12/v3-build/v3/{graph/,manifest.json}
 *   - .artifacts-r12/staging-bundle/v3/{graph/,manifest.json}
 * And refreshes .artifacts-r12/staging-bundle/v4/manifest.json + v4-build/v4/manifest.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import {
  CSR_MAGIC,
  GRAPH_PARTITIONS,
  NUM_VERSES,
  PPR_MAGIC,
  lookupCsrEdges,
  parseCsrPart,
  parseNodesBin,
} from '../../src/relationships/v3-binary-index.ts';
import {
  decodeCompactHreg,
  parsePericopeTable,
  parsePredSimTable,
} from '../../src/relationships/v4-hreg-types.ts';
import {
  parseRmacBmwIndex,
  queryRmacCandidates,
} from '../../src/relationships/v4-rmac-index.ts';
import { evaluateSmePair } from '../../src/relationships/v4-sme-engine.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BUILD_V3 = path.join(ROOT, '.artifacts-r12/v3-build/v3');
const STAGING_V3 = path.join(ROOT, '.artifacts-r12/staging-bundle/v3');
const BUILD_V4 = path.join(ROOT, '.artifacts-r12/v4-build/v4');
const STAGING_V4 = path.join(ROOT, '.artifacts-r12/staging-bundle/v4');
const R10_DIR = path.join(ROOT, '.artifacts-r12/staging-bundle/v2/relationships/r11-v1.0/r10');

const NUM_CSR_PARTS = 16;
const NUM_PPR_SHARDS = 32;
const CONDUCTANCE_BETA = 0.40;
const CONDUCTANCE_KAPPA = 3;
const CONCEPT_PROC_MAX_MASS = 0.06;
const STRUCT_ANALOGY_MAX_MASS = 0.08;
const EXPLICIT_INTERP_MAX_MASS = 0.42;
const PPR_ALPHA = 0.20;
const PPR_EPS = 2e-5;
const NON_TRANSITIVE_FLAG = 1 << 7;
const MAX_PACK_BYTES = Math.floor(4.8 * 1024 * 1024);

function loadAllHregs() {
  const perTable = parsePericopeTable(
    fs.readFileSync(path.join(STAGING_V4, 'index/pericopes.bin')),
    fs.readFileSync(path.join(STAGING_V4, 'index/vid-to-pericopes.bin')),
  );
  const packCache = new Map();
  const hregsByPid = new Array(perTable.numPericopes + 1);
  const qualifyingHregs = [];
  for (const meta of perTable.records) {
    let pBuf = packCache.get(meta.packFile);
    if (!pBuf) {
      pBuf = fs.readFileSync(path.join(STAGING_V4, `hreg/pack-${String(meta.packFile).padStart(2, '0')}.bin`));
      packCache.set(meta.packFile, pBuf);
    }
    const slice = pBuf.subarray(meta.byteOff, meta.byteOff + meta.byteLen);
    const plain = slice[0] === 0x1f && slice[1] === 0x8b ? zlib.gunzipSync(slice) : slice;
    const h = decodeCompactHreg(plain);
    hregsByPid[h.pericopeId] = h;
    if (h.events.length >= 2 && h.hoEdges.length >= 1) {
      qualifyingHregs.push(h);
    }
  }
  packCache.clear();
  return { perTable, hregsByPid, qualifyingHregs };
}

if (!isMainThread) {
  const { workerId, pidSlice } = workerData;
  const predSim = parsePredSimTable(fs.readFileSync(path.join(STAGING_V4, 'index/pred-sim.bin')));
  const rmacIdx = parseRmacBmwIndex(fs.readFileSync(path.join(STAGING_V4, 'index/rmac-bmw.bin')));
  const { perTable, hregsByPid } = loadAllHregs();
  const seenLocalPairs = new Set();
  const accepted = [];
  let evaluated = 0;
  let preScreened = 0;

  for (let idx = 0; idx < pidSlice.length; idx++) {
    const baseH = hregsByPid[pidSlice[idx]];
    if (!baseH) continue;
    const cands = queryRmacCandidates(rmacIdx, baseH, {
      kStructural: 4,
      kHybrid: 4,
      kTotal: 6,
      pericopeTable: perTable,
    });
    for (const c of cands) {
      const targetH = hregsByPid[c.pericopeId];
      if (!targetH || targetH.events.length < 2 || targetH.hoEdges.length < 1) continue;
      if (Math.abs(targetH.startVid - baseH.startVid) <= 15) continue;
      const lo = baseH.pericopeId < targetH.pericopeId ? baseH.pericopeId : targetH.pericopeId;
      const hi = baseH.pericopeId < targetH.pericopeId ? targetH.pericopeId : baseH.pericopeId;
      const pk = lo * 16384 + hi;
      if (seenLocalPairs.has(pk)) continue;
      seenLocalPairs.add(pk);
      evaluated++;

      const hA = hregsByPid[lo];
      const hB = hregsByPid[hi];
      if (!hA || !hB) continue;

      // Stage 1: fast bPerm=0 structural pre-screen
      const ev0 = evaluateSmePair(hA, hB, predSim, { bPerm: 0 });
      const pass0 =
        (ev0.winning.mappedHo.length >= 2 && ev0.winning.phiConn >= 0.60 && ev0.winning.sms >= 0.50) ||
        (ev0.winning.mappedHo.length >= 1 && ev0.winning.phiConn >= 0.72 && ev0.winning.sms >= 0.65 && ev0.winning.largestComponentEventCount >= 2);
      if (!pass0) continue;
      preScreened++;

      // Stage 2: exact permutation null bPerm=32
      const ev = evaluateSmePair(hA, hB, predSim, { bPerm: 32 });
      if (
        ev.pStruct < 0.035 &&
        (ev.classification === 'CROSS_DOMAIN_ANALOGY' || ev.classification === 'LITERAL_PARALLEL_OR_TYPOLOGY')
      ) {
        const evVidPairs = [];
        for (const me of ev.winning.mappedEvents) {
          if (evVidPairs.length >= 2) break;
          const bEv = hA.events.find((e) => e.eid === me.baseEid);
          const tEv = hB.events.find((e) => e.eid === me.targetEid);
          const uV = bEv?.vid;
          const vV = tEv?.vid;
          if (uV >= 1 && uV <= NUM_VERSES && vV >= 1 && vV <= NUM_VERSES && uV !== vV && (uV !== hA.startVid || vV !== hB.startVid)) {
            evVidPairs.push([uV, vV]);
          }
        }
        accepted.push({
          lo,
          hi,
          startVidA: hA.startVid,
          startVidB: hB.startVid,
          sms: ev.winning.sms,
          phiConn: ev.winning.phiConn,
          deltaSmeStruct: ev.deltaSmeStruct,
          evVidPairs,
        });
      }
    }
    if (idx + 1 === Math.floor(pidSlice.length / 2)) {
      console.log(`  Worker ${workerId}: 50% (${idx + 1}/${pidSlice.length}), eval=${evaluated}, pre=${preScreened}, acc=${accepted.length}`);
    }
  }

  console.log(`  Worker ${workerId}: 100% (${pidSlice.length}/${pidSlice.length}), eval=${evaluated}, pre=${preScreened}, acc=${accepted.length}`);
  parentPort.postMessage({
    workerId,
    evaluated,
    preScreened,
    accepted,
  });
}

const RESTRICTED_KEYS = new Set([
  'gated_fields',
  'semantic_frame',
  'frame',
  'greekstrong',
  'sdbh',
  'lexdomain',
  'coredomain',
  'contextualdomain',
  'domain',
  'ln',
  'field_name',
]);

function assertNoRestrictedKeys(val, label = 'root') {
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) assertNoRestrictedKeys(val[i], `${label}[${i}]`);
  } else if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      if (RESTRICTED_KEYS.has(k)) {
        throw new Error(`Restricted UBS key "${k}" at ${label}.${k}`);
      }
      if (v && typeof v === 'object') assertNoRestrictedKeys(v, `${label}.${k}`);
    }
  }
}

function normStrongs4(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('lemma:')) s = s.slice(6);
  const m = /^([HGhg])0*(\d+)(?:[A-Za-z].*)?$/.exec(s);
  if (!m) return '';
  return m[1].toUpperCase() + m[2].padStart(4, '0');
}

function readJsonAuto(filePath) {
  const buf = fs.readFileSync(filePath);
  const plain = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
  return JSON.parse(plain.toString('utf8'));
}

function writeDual(baseDirs, relPath, buf) {
  if (buf.byteLength > MAX_PACK_BYTES) {
    throw new Error(`Asset ${relPath} exceeds 4.8 MiB limit (${buf.byteLength} bytes)`);
  }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  for (const dir of baseDirs) {
    const out = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
  }
  return { bytes: buf.byteLength, sha256 };
}

function addWeightedMapEdge(mapBySrc, u, v, w, flags = 0) {
  if (!Number.isInteger(u) || !Number.isInteger(v) || u < 1 || v < 1 || u === v || !(w > 0)) return;
  let m = mapBySrc[u];
  if (!m) {
    m = new Map();
    mapBySrc[u] = m;
  }
  const prev = m.get(v);
  if (!prev) {
    m.set(v, { to: v, w, flags });
  } else {
    if (w > prev.w) prev.w = w;
    prev.flags |= flags;
  }
}

function runWorkerChunk(workerId, pidSlice) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), {
      workerData: { workerId, pidSlice },
    });
    w.once('message', resolve);
    w.once('error', reject);
    w.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker ${workerId} exited with code ${code}`));
    });
  });
}

async function main() {
  const t0 = performance.now();
  console.log('=== BibleResearch v4 8-Partition CSR + PPR Builder ===');

  const nodesBuf = fs.readFileSync(path.join(STAGING_V3, 'index/nodes.bin'));
  const nodesTable = parseNodesBin(nodesBuf);
  const totalNodes = nodesTable.numVerses + nodesTable.entityCount;
  console.log(`Loaded nodes.bin: ${nodesTable.numVerses} verses + ${nodesTable.entityCount} entities = ${totalNodes} total nodes.`);

  // 1. Identify legacy r13_self_interpretations edges to strip from Partition 4 (WP)
  const explicitDocPath = path.join(R10_DIR, 'explicit-and-typology.json.gz');
  const explicitDoc = fs.existsSync(explicitDocPath) ? readJsonAuto(explicitDocPath) : { r13_self_interpretations: [] };
  const stripWpPairs = new Set();
  for (const interp of explicitDoc.r13_self_interpretations || []) {
    for (const sRaw of interp.symbol_strongs || []) {
      const u = nodesTable.lookupNodeId(normStrongs4(sRaw));
      if (!u) continue;
      for (const rRaw of interp.referent_strongs || []) {
        const v = nodesTable.lookupNodeId(normStrongs4(rRaw));
        if (v && u !== v) {
          stripWpPairs.add(`${u}:${v}`);
          stripWpPairs.add(`${v}:${u}`);
        }
      }
    }
  }
  console.log(`Prepared ${stripWpPairs.size / 2} r13_self_interpretations Strong's pairs to move from WP (part 4) -> EXPLICIT_INTERP (part 6).`);

  // 2. Load existing CSR partitions 0..5 cleanly (strip part >= 6 for idempotency & stripped WP pairs)
  const existing0to4 = new Array(totalNodes + 1);
  const existing5 = new Array(totalNodes + 1);
  const nodeModified = new Uint8Array(totalNodes + 1);
  const baseDeg = new Int32Array(totalNodes + 1);
  let strippedWpCount = 0;

  for (let p = 0; p < NUM_CSR_PARTS; p++) {
    const partPath = path.join(STAGING_V3, `graph/typed-csr/part-${String(p).padStart(2, '0')}.bin`);
    const csrPart = parseCsrPart(fs.readFileSync(partPath));
    for (let u = p === 0 ? 16 : p; u <= totalNodes; u += NUM_CSR_PARTS) {
      const edges = lookupCsrEdges(csrPart, u);
      if (edges.length === 0) continue;
      const list04 = [];
      const list5 = [];
      for (const e of edges) {
        if (e.partition >= 6) {
          nodeModified[u] = 1;
          continue;
        }
        if (e.partition === 4 && stripWpPairs.has(`${u}:${e.toNodeId}`)) {
          nodeModified[u] = 1;
          strippedWpCount++;
          continue;
        }
        if (e.partition === 5) list5.push(e);
        else list04.push(e);
      }
      if (list04.length > 0) existing0to4[u] = list04;
      if (list5.length > 0) existing5[u] = list5;
      baseDeg[u] = list04.length + list5.length;
    }
  }
  console.log(`Loaded baseline CSR parts 0..15; stripped ${strippedWpCount} legacy WP self-interp directed edges.`);

  // 3. Partition 6: EXPLICIT_INTERP from v4/eside/interp-edges.bin
  const interpEdgesPath = path.join(STAGING_V4, 'eside/interp-edges.bin');
  if (!fs.existsSync(interpEdgesPath)) {
    throw new Error(`Missing ${interpEdgesPath}; run build-v4-eside.mjs first.`);
  }
  const interpData = readJsonAuto(interpEdgesPath);
  const rawPart6 = new Array(totalNodes + 1);
  let part6InputCount = 0;

  for (const [k, ev] of Object.entries(interpData.edges || {})) {
    if (k.startsWith('V:')) {
      const m = /^V:(\d+)->V:(\d+)$/.exec(k);
      if (m) {
        const srcVid = Number(m[1]);
        const tgtVid = Number(m[2]);
        if (srcVid >= 1 && srcVid <= NUM_VERSES && tgtVid >= 1 && tgtVid <= NUM_VERSES && srcVid !== tgtVid) {
          const wFwd = ev.eside_class === 'C7' ? 3.0 : 3.2;
          const wRev = ev.eside_class === 'C7' ? 2.6 : 2.9;
          addWeightedMapEdge(rawPart6, srcVid, tgtVid, wFwd, 0);
          addWeightedMapEdge(rawPart6, tgtVid, srcVid, wRev, 0);
          nodeModified[srcVid] = 1;
          nodeModified[tgtVid] = 1;
          part6InputCount += 2;
        }
      }
    } else if (k.includes('->') && k.includes('@')) {
      const m = /^([HG]\d{4})->([HG]\d{4})@(\d+)$/.exec(k);
      if (m) {
        const sId = nodesTable.lookupNodeId(m[1]);
        const rId = nodesTable.lookupNodeId(m[2]);
        const wid = Number(m[3]);
        if (sId && rId && sId !== rId) {
          addWeightedMapEdge(rawPart6, sId, rId, 3.0, 0);
          addWeightedMapEdge(rawPart6, rId, sId, 2.5, 0);
          nodeModified[sId] = 1;
          nodeModified[rId] = 1;
          part6InputCount += 2;
        }
        if (wid >= 1 && wid <= NUM_VERSES) {
          if (sId) {
            addWeightedMapEdge(rawPart6, wid, sId, 2.4, 0);
            addWeightedMapEdge(rawPart6, sId, wid, 2.2, 0);
            nodeModified[wid] = 1;
            nodeModified[sId] = 1;
            part6InputCount += 2;
          }
          if (rId) {
            addWeightedMapEdge(rawPart6, wid, rId, 2.4, 0);
            addWeightedMapEdge(rawPart6, rId, wid, 2.2, 0);
            nodeModified[wid] = 1;
            nodeModified[rId] = 1;
            part6InputCount += 2;
          }
        }
      }
    }
  }
  console.log(`Ingested Partition 6 (EXPLICIT_INTERP): ${part6InputCount} directed raw candidate additions.`);

  // 4. Partition 7: STRUCT_ANALOGY via 1-Pass Parallel R-MAC + Two-Stage Biblical-SME
  const tSme = performance.now();
  const perMetaOnly = parsePericopeTable(fs.readFileSync(path.join(STAGING_V4, 'index/pericopes.bin')));
  const qualifyingPids = [];
  for (const r of perMetaOnly.records) {
    if (r.evCount >= 2 && r.hoCount >= 1) {
      qualifyingPids.push(r.pericopeId);
    }
  }
  const cpuCount = os.cpus().length || 4;
  const numWorkers = Math.min(8, Math.max(2, cpuCount - 1));
  console.log(`Dispatching ${qualifyingPids.length} qualifying pericopes across ${numWorkers} worker threads for R-MAC + SME...`);

  const workerPromises = [];
  const chunkSize = Math.ceil(qualifyingPids.length / numWorkers);
  for (let w = 0; w < numWorkers; w++) {
    const slice = qualifyingPids.slice(w * chunkSize, (w + 1) * chunkSize);
    if (slice.length === 0) continue;
    workerPromises.push(runWorkerChunk(w, new Uint32Array(slice)));
  }
  const workerResults = await Promise.all(workerPromises);

  let totalEvaluated = 0;
  let totalPreScreened = 0;
  let totalAccepted = 0;
  const dedupPairSeen = new Set();
  const hitsByPid = new Map();
  for (const wr of workerResults) {
    totalEvaluated += wr.evaluated;
    totalPreScreened += wr.preScreened;
    for (const acc of wr.accepted) {
      const pk = acc.lo * 16384 + acc.hi;
      if (dedupPairSeen.has(pk)) continue;
      dedupPairSeen.add(pk);
      totalAccepted++;
      const quality = acc.deltaSmeStruct * 0.4 + acc.phiConn * 0.6 + acc.sms * 0.4;
      const itemA = { ...acc, quality };
      if (!hitsByPid.has(acc.lo)) hitsByPid.set(acc.lo, []);
      hitsByPid.get(acc.lo).push(itemA);
      if (!hitsByPid.has(acc.hi)) hitsByPid.set(acc.hi, []);
      hitsByPid.get(acc.hi).push(itemA);
    }
  }

  const rawPart7 = new Array(totalNodes + 1);
  let part7RawEdges = 0;
  for (const hits of hitsByPid.values()) {
    hits.sort((a, b) => b.quality - a.quality);
    for (const hHit of hits.slice(0, 8)) {
      const w = Math.max(1.0, Math.min(3.5, hHit.sms * 2.5));
      if (hHit.startVidA >= 1 && hHit.startVidA <= NUM_VERSES && hHit.startVidB >= 1 && hHit.startVidB <= NUM_VERSES) {
        addWeightedMapEdge(rawPart7, hHit.startVidA, hHit.startVidB, w, NON_TRANSITIVE_FLAG);
        addWeightedMapEdge(rawPart7, hHit.startVidB, hHit.startVidA, w, NON_TRANSITIVE_FLAG);
        nodeModified[hHit.startVidA] = 1;
        nodeModified[hHit.startVidB] = 1;
        part7RawEdges += 2;
      }
      for (const [uV, vV] of hHit.evVidPairs) {
        addWeightedMapEdge(rawPart7, uV, vV, w * 0.75, NON_TRANSITIVE_FLAG);
        addWeightedMapEdge(rawPart7, vV, uV, w * 0.75, NON_TRANSITIVE_FLAG);
        nodeModified[uV] = 1;
        nodeModified[vV] = 1;
        part7RawEdges += 2;
      }
    }
  }
  hitsByPid.clear();
  console.log(
    `Parallel SME finished in ${Math.round(performance.now() - tSme)}ms: evaluated=${totalEvaluated}, preScreened=${totalPreScreened}, acceptedPairs=${totalAccepted}, part7RawEdges=${part7RawEdges}.`,
  );

  // 5. Recompute conductance degrees & build normalized 8-partition CSR adjacency
  const totalDeg = new Int32Array(totalNodes + 1);
  for (let u = 1; u <= totalNodes; u++) {
    totalDeg[u] = baseDeg[u] + (rawPart6[u]?.size || 0) + (rawPart7[u]?.size || 0);
  }

  const csrEdgesByNode = new Array(totalNodes + 1);
  let totalCsrEdges = 0;
  let maxConceptProcMassObserved = 0;
  let maxStructAnalogyMassObserved = 0;
  let totalPart6Edges = 0;
  let totalPart7Edges = 0;

  for (let u = 1; u <= totalNodes; u++) {
    const l04 = existing0to4[u] || [];
    const l5 = existing5[u] || [];
    const m6 = rawPart6[u];
    const m7 = rawPart7[u];

    if (!nodeModified[u] && !m6 && !m7) {
      const validEdges = [];
      let cpQ16 = 0;
      for (const e of l04) {
        validEdges.push({ to: e.toNodeId, part: e.partition, flags: e.epistemicFlags, wQ16: Math.max(1, Math.min(65535, Math.round(e.weight * 65535))) });
      }
      for (const e of l5) {
        const wQ16 = Math.max(1, Math.min(65535, Math.round(e.weight * 65535)));
        cpQ16 += wQ16;
        validEdges.push({ to: e.toNodeId, part: 5, flags: e.epistemicFlags, wQ16 });
      }
      if (cpQ16 / 65535 > maxConceptProcMassObserved) maxConceptProcMassObserved = cpQ16 / 65535;
      validEdges.sort((a, b) => a.to - b.to || a.part - b.part);
      csrEdgesByNode[u] = validEdges;
      totalCsrEdges += validEdges.length;
      continue;
    }

    let sum04 = 0;
    const kept04 = [];
    for (const e of l04) {
      if (e.weight > 0) {
        sum04 += e.weight;
        kept04.push({ to: e.toNodeId, part: e.partition, flags: e.epistemicFlags, w: e.weight });
      }
    }

    let sum5 = 0;
    const kept5 = [];
    for (const e of l5) {
      if (e.weight > 0) {
        sum5 += e.weight;
        kept5.push({ to: e.toNodeId, part: 5, flags: e.epistemicFlags, w: e.weight });
      }
    }

    const kept6 = [];
    if (m6) {
      for (const e of m6.values()) {
        const wCond = e.w / Math.pow(totalDeg[e.to] + CONDUCTANCE_KAPPA, CONDUCTANCE_BETA);
        kept6.push({ to: e.to, part: 6, flags: e.flags, w: wCond });
      }
      if (kept6.length > 256) {
        kept6.sort((a, b) => b.w - a.w);
        kept6.length = 256;
      }
    }
    let sum6 = 0;
    for (const e of kept6) sum6 += e.w;

    const kept7 = [];
    if (m7) {
      for (const e of m7.values()) {
        const wCond = e.w / Math.pow(totalDeg[e.to] + CONDUCTANCE_KAPPA, CONDUCTANCE_BETA);
        kept7.push({ to: e.to, part: 7, flags: NON_TRANSITIVE_FLAG, w: wCond });
      }
      if (kept7.length > 64) {
        kept7.sort((a, b) => b.w - a.w);
        kept7.length = 64;
      }
    }
    let sum7 = 0;
    for (const e of kept7) sum7 += e.w;

    const totalRaw = sum04 + sum5 + sum6 + sum7;
    if (totalRaw <= 0) {
      csrEdgesByNode[u] = [];
      continue;
    }

    const targetFrac5 = sum5 > 0 ? Math.min(sum5 / totalRaw, 0.058) : 0;
    const targetFrac7 = sum7 > 0 ? Math.min(sum7 / totalRaw, 0.075) : 0;
    let targetFrac6 = 0;
    if (sum6 > 0) {
      if (sum04 > 0) {
        targetFrac6 = Math.min(sum6 / totalRaw, EXPLICIT_INTERP_MAX_MASS);
      } else {
        targetFrac6 = Math.max(0, 1 - targetFrac5 - targetFrac7);
      }
    }
    const targetFrac04 = sum04 > 0 ? Math.max(0, 1 - targetFrac5 - targetFrac6 - targetFrac7) : 0;

    const finalEdges = [];
    if (sum04 > 0 && targetFrac04 > 0) {
      const sc = targetFrac04 / sum04;
      for (const e of kept04) finalEdges.push({ ...e, w: e.w * sc });
    }
    if (sum5 > 0 && targetFrac5 > 0) {
      const sc = targetFrac5 / sum5;
      for (const e of kept5) finalEdges.push({ ...e, w: e.w * sc });
    }
    if (sum6 > 0 && targetFrac6 > 0) {
      const sc = targetFrac6 / sum6;
      for (const e of kept6) finalEdges.push({ ...e, w: e.w * sc });
    }
    if (sum7 > 0 && targetFrac7 > 0) {
      const sc = targetFrac7 / sum7;
      for (const e of kept7) finalEdges.push({ ...e, w: e.w * sc });
    }

    let cpQ16 = 0;
    let saQ16 = 0;
    const cpIndices = [];
    const saIndices = [];
    for (let i = 0; i < finalEdges.length; i++) {
      const e = finalEdges[i];
      const q = Math.max(1, Math.min(65535, Math.round(e.w * 65535)));
      e.wQ16 = q;
      if (e.part === 5) {
        cpQ16 += q;
        cpIndices.push(i);
      } else if (e.part === 7) {
        saQ16 += q;
        saIndices.push(i);
      }
    }

    const clampPartitionCap = (indices, sumQ16, maxFraction) => {
      const limitQ16 = Math.floor(maxFraction * 65535);
      if (sumQ16 <= limitQ16 || indices.length === 0) return;
      indices.sort((a, b) => finalEdges[b].wQ16 - finalEdges[a].wQ16);
      let idx = 0;
      while (sumQ16 > limitQ16) {
        const ei = indices[idx % indices.length];
        if (finalEdges[ei].wQ16 > 1) {
          finalEdges[ei].wQ16--;
          sumQ16--;
        } else if (finalEdges[ei].wQ16 === 1) {
          finalEdges[ei].wQ16 = 0;
          sumQ16--;
        }
        idx++;
        if (idx > indices.length * 6 && sumQ16 > limitQ16) break;
      }
    };
    clampPartitionCap(cpIndices, cpQ16, CONCEPT_PROC_MAX_MASS);
    clampPartitionCap(saIndices, saQ16, STRUCT_ANALOGY_MAX_MASS);

    const validEdges = finalEdges.filter((e) => e.wQ16 > 0);
    validEdges.sort((a, b) => a.to - b.to || a.part - b.part);

    let obsCp = 0;
    let obsSa = 0;
    for (const e of validEdges) {
      if (e.part === 5) obsCp += e.wQ16 / 65535;
      if (e.part === 6) totalPart6Edges++;
      if (e.part === 7) {
        obsSa += e.wQ16 / 65535;
        totalPart7Edges++;
      }
    }
    if (obsCp > maxConceptProcMassObserved) maxConceptProcMassObserved = obsCp;
    if (obsSa > maxStructAnalogyMassObserved) maxStructAnalogyMassObserved = obsSa;

    csrEdgesByNode[u] = validEdges;
    totalCsrEdges += validEdges.length;

    existing0to4[u] = null;
    existing5[u] = null;
    rawPart6[u] = null;
    rawPart7[u] = null;
  }

  console.log(
    `8-Partition CSR built: ${totalNodes} nodes, ${totalCsrEdges} edges (part6=${totalPart6Edges}, part7=${totalPart7Edges}), maxCpMass=${maxConceptProcMassObserved.toFixed(5)}, maxSaMass=${maxStructAnalogyMassObserved.toFixed(5)}.`,
  );
  if (maxConceptProcMassObserved > CONCEPT_PROC_MAX_MASS + 1e-6) {
    throw new Error(`CONCEPT_PROC mass invariant violated: ${maxConceptProcMassObserved}`);
  }
  if (maxStructAnalogyMassObserved > STRUCT_ANALOGY_MAX_MASS + 1e-6) {
    throw new Error(`STRUCT_ANALOGY mass invariant violated: ${maxStructAnalogyMassObserved}`);
  }

  const csrDirs = [BUILD_V3, STAGING_V3];
  for (let p = 0; p < NUM_CSR_PARTS; p++) {
    const partNodes = [];
    let partEdgeCount = 0;
    for (let nodeId = p === 0 ? 16 : p; nodeId <= totalNodes; nodeId += NUM_CSR_PARTS) {
      const edges = csrEdgesByNode[nodeId];
      if (edges && edges.length > 0) {
        partNodes.push({ nodeId, edges });
        partEdgeCount += edges.length;
      }
    }
    const dirOffset = 32;
    const adjOffset = dirOffset + partNodes.length * 12;
    const totalLen = adjOffset + partEdgeCount * 8;
    const buf = new Uint8Array(totalLen);
    const view = new DataView(buf.buffer);
    for (let i = 0; i < 8; i++) buf[i] = CSR_MAGIC.charCodeAt(i);
    view.setUint32(8, 3, true);
    view.setUint32(12, p, true);
    view.setUint32(16, NUM_CSR_PARTS, true);
    view.setUint32(20, partNodes.length, true);
    view.setUint32(24, dirOffset, true);
    view.setUint32(28, adjOffset, true);

    let eByteOff = 0;
    for (let i = 0; i < partNodes.length; i++) {
      const { nodeId, edges } = partNodes[i];
      const dOff = dirOffset + i * 12;
      view.setUint32(dOff, nodeId, true);
      view.setUint32(dOff + 4, eByteOff, true);
      view.setUint16(dOff + 8, edges.length, true);
      view.setUint16(dOff + 10, 0, true);
      for (let j = 0; j < edges.length; j++) {
        const e = edges[j];
        const pOff = adjOffset + eByteOff + j * 8;
        view.setUint32(pOff, e.to, true);
        buf[pOff + 4] = e.part;
        buf[pOff + 5] = e.flags;
        view.setUint16(pOff + 6, e.wQ16, true);
      }
      eByteOff += edges.length * 8;
    }
    writeDual(csrDirs, `graph/typed-csr/part-${String(p).padStart(2, '0')}.bin`, buf);
  }

  // 6. Recompute 8-Partition Forward-Push PPR -> ppr-top64/shard-00..31.bin
  console.log('Recomputing Forward-Push PPR across all nodes (alpha=0.20, eps=2e-5)...');
  const tPpr = performance.now();
  const csrOffsets = new Int32Array(totalNodes + 2);
  for (let u = 1; u <= totalNodes; u++) {
    csrOffsets[u + 1] = csrOffsets[u] + csrEdgesByNode[u].length;
  }
  const flatTo = new Int32Array(totalCsrEdges);
  const flatPart = new Uint8Array(totalCsrEdges);
  const flatW = new Float64Array(totalCsrEdges);
  const nodeDeg = new Int32Array(totalNodes + 1);
  for (let u = 1; u <= totalNodes; u++) {
    const edges = csrEdgesByNode[u];
    nodeDeg[u] = Math.max(1, edges.length);
    const base = csrOffsets[u];
    for (let j = 0; j < edges.length; j++) {
      flatTo[base + j] = edges[j].to;
      flatPart[base + j] = edges[j].part;
      flatW[base + j] = edges[j].wQ16 / 65535;
    }
    csrEdgesByNode[u] = null;
  }

  const pprArr = new Float64Array(totalNodes + 1);
  const resArr = new Float64Array(totalNodes + 1);
  const maskArr = new Uint8Array(totalNodes + 1);
  const inQueue = new Uint8Array(totalNodes + 1);
  const seenTouched = new Uint8Array(totalNodes + 1);
  const touched = new Int32Array(totalNodes + 1);
  const queueLen = totalNodes + 8;
  const queue = new Int32Array(queueLen);

  const heapTarget = new Int32Array(64);
  const heapProb = new Float64Array(64);
  const heapMask = new Uint8Array(64);
  const orderIdx = new Int32Array(64);

  const pprBuckets = Array.from({ length: NUM_PPR_SHARDS }, () => []);
  let pprSeedsCount = 0;
  let totalPprEntries = 0;

  for (let seed = 1; seed <= totalNodes; seed++) {
    const start = csrOffsets[seed];
    const end = csrOffsets[seed + 1];
    if (end <= start) continue;

    let touchedLen = 0;
    let qHead = 0;
    let qTail = 0;
    resArr[seed] = 1.0;
    seenTouched[seed] = 1;
    touched[touchedLen++] = seed;
    inQueue[seed] = 1;
    queue[qTail++] = seed;

    while (qHead !== qTail) {
      const u = queue[qHead++];
      if (qHead === queueLen) qHead = 0;
      inQueue[u] = 0;

      const r = resArr[u];
      if (r < PPR_EPS * nodeDeg[u]) continue;

      resArr[u] = 0;
      pprArr[u] += PPR_ALPHA * r;
      const pushMass = (1 - PPR_ALPHA) * r;
      const uMask = maskArr[u];

      const eStart = csrOffsets[u];
      const eEnd = csrOffsets[u + 1];
      for (let e = eStart; e < eEnd; e++) {
        const v = flatTo[e];
        const add = pushMass * flatW[e];
        if (add <= 0) continue;
        if (!seenTouched[v]) {
          seenTouched[v] = 1;
          touched[touchedLen++] = v;
        }
        const nv = resArr[v] + add;
        resArr[v] = nv;
        maskArr[v] |= uMask | (1 << flatPart[e]);
        if (!inQueue[v] && nv >= PPR_EPS * nodeDeg[v]) {
          inQueue[v] = 1;
          queue[qTail++] = v;
          if (qTail === queueLen) qTail = 0;
        }
      }
    }

    let heapLen = 0;
    for (let i = 0; i < touchedLen; i++) {
      const v = touched[i];
      const totalP = pprArr[v] + PPR_ALPHA * resArr[v];
      const vMask = maskArr[v];
      pprArr[v] = 0;
      resArr[v] = 0;
      maskArr[v] = 0;
      inQueue[v] = 0;
      seenTouched[v] = 0;

      if (v === seed || totalP <= 1e-7) continue;
      if (heapLen < 64) {
        let idx = heapLen++;
        while (idx > 0) {
          const parent = (idx - 1) >> 1;
          if (heapProb[parent] <= totalP) break;
          heapTarget[idx] = heapTarget[parent];
          heapProb[idx] = heapProb[parent];
          heapMask[idx] = heapMask[parent];
          idx = parent;
        }
        heapTarget[idx] = v;
        heapProb[idx] = totalP;
        heapMask[idx] = vMask;
      } else if (totalP > heapProb[0] || (totalP === heapProb[0] && v < heapTarget[0])) {
        let idx = 0;
        while (true) {
          const l = (idx << 1) + 1;
          const r = l + 1;
          let smallest = idx;
          if (l < 64 && heapProb[l] < totalP) smallest = l;
          const bestP = smallest === idx ? totalP : heapProb[smallest];
          if (r < 64 && heapProb[r] < bestP) smallest = r;
          if (smallest === idx) break;
          heapTarget[idx] = heapTarget[smallest];
          heapProb[idx] = heapProb[smallest];
          heapMask[idx] = heapMask[smallest];
          idx = smallest;
        }
        heapTarget[idx] = v;
        heapProb[idx] = totalP;
        heapMask[idx] = vMask;
      }
    }

    if (heapLen > 0) {
      for (let i = 0; i < heapLen; i++) orderIdx[i] = i;
      for (let i = 1; i < heapLen; i++) {
        const keyIdx = orderIdx[i];
        const keyP = heapProb[keyIdx];
        const keyT = heapTarget[keyIdx];
        let j = i - 1;
        while (j >= 0 && (heapProb[orderIdx[j]] < keyP || (heapProb[orderIdx[j]] === keyP && heapTarget[orderIdx[j]] > keyT))) {
          orderIdx[j + 1] = orderIdx[j];
          j--;
        }
        orderIdx[j + 1] = keyIdx;
      }
      const packed = new Uint8Array(heapLen * 7);
      const pv = new DataView(packed.buffer);
      for (let i = 0; i < heapLen; i++) {
        const k = orderIdx[i];
        const pOff = i * 7;
        const logProbQ16 = Math.min(65535, Math.max(0, Math.round(-Math.log(Math.max(1e-7, heapProb[k])) * 4096)));
        pv.setUint32(pOff, heapTarget[k], true);
        pv.setUint16(pOff + 4, logProbQ16, true);
        packed[pOff + 6] = heapMask[k];
      }
      pprBuckets[seed & 31].push({ seed, count: heapLen, packed });
      pprSeedsCount++;
      totalPprEntries += heapLen;
    }

    if (seed % 15000 === 0) {
      console.log(`  PPR progress: ${seed}/${totalNodes} seeds (${Math.round(performance.now() - tPpr)}ms)`);
    }
  }

  for (let s = 0; s < NUM_PPR_SHARDS; s++) {
    const items = pprBuckets[s];
    items.sort((a, b) => a.seed - b.seed);
    let recCount = 0;
    for (const it of items) recCount += it.count;
    const indexOffset = 32;
    const dataOffset = indexOffset + items.length * 12;
    const totalLen = dataOffset + recCount * 7;
    const buf = new Uint8Array(totalLen);
    const view = new DataView(buf.buffer);
    for (let i = 0; i < 8; i++) buf[i] = PPR_MAGIC.charCodeAt(i);
    view.setUint32(8, 3, true);
    view.setUint32(12, s, true);
    view.setUint32(16, NUM_PPR_SHARDS, true);
    view.setUint32(20, items.length, true);
    view.setUint32(24, indexOffset, true);
    view.setUint32(28, dataOffset, true);
    let rByteOff = 0;
    for (let i = 0; i < items.length; i++) {
      const { seed, count, packed } = items[i];
      const iOff = indexOffset + i * 12;
      view.setUint32(iOff, seed, true);
      view.setUint32(iOff + 4, rByteOff, true);
      view.setUint16(iOff + 8, count, true);
      view.setUint16(iOff + 10, 0, true);
      buf.set(packed, dataOffset + rByteOff);
      rByteOff += packed.byteLength;
    }
    writeDual(csrDirs, `graph/ppr-top64/shard-${String(s).padStart(2, '0')}.bin`, buf);
  }
  console.log(`Forward-Push PPR finished in ${Math.round(performance.now() - tPpr)}ms: ${pprSeedsCount} seeds, ${totalPprEntries} entries.`);

  // 7. Refresh v3/manifest.json & v4/manifest.json in BOTH build & staging
  const v3Manifest = JSON.parse(fs.readFileSync(path.join(STAGING_V3, 'manifest.json'), 'utf8'));
  const allV3Files = [];
  const walkFiles = (rootDir, prefix, outArr, skipRel) => {
    for (const e of fs.readdirSync(rootDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(rootDir, e.name);
      const rel = `${prefix}/${e.name}`;
      if (e.isDirectory()) walkFiles(full, rel, outArr, skipRel);
      else if (rel !== skipRel) {
        const b = fs.readFileSync(full);
        if (b.byteLength > MAX_PACK_BYTES) {
          throw new Error(`Asset ${rel} exceeds 4.8 MiB (${b.byteLength} bytes)`);
        }
        outArr.push({
          path: rel,
          bytes: b.byteLength,
          sha256: crypto.createHash('sha256').update(b).digest('hex'),
        });
      }
    }
  };
  walkFiles(STAGING_V3, 'v3', allV3Files, 'v3/manifest.json');
  const maxV3File = allV3Files.reduce((m, f) => (f.bytes > m.bytes ? f : m), { path: '', bytes: 0 });
  const totalV3Bytes = allV3Files.reduce((s, f) => s + f.bytes, 0);

  v3Manifest.generated_at = new Date().toISOString();
  v3Manifest.graph = {
    ...v3Manifest.graph,
    partitions: [...GRAPH_PARTITIONS],
    total_csr_edges: totalCsrEdges,
    part6_explicit_interp_edges: totalPart6Edges,
    part7_struct_analogy_edges: totalPart7Edges,
    concept_proc_max_mass: Number(maxConceptProcMassObserved.toFixed(6)),
    struct_analogy_max_mass: Number(maxStructAnalogyMassObserved.toFixed(6)),
    ppr_alpha: PPR_ALPHA,
    ppr_eps: PPR_EPS,
    ppr_seeds: pprSeedsCount,
    ppr_entries: totalPprEntries,
  };
  v3Manifest.file_count = allV3Files.length + 1;
  v3Manifest.total_bytes = totalV3Bytes;
  v3Manifest.max_file = maxV3File;
  v3Manifest.files = allV3Files;
  assertNoRestrictedKeys(v3Manifest, 'v3Manifest');
  const v3ManBuf = Buffer.from(JSON.stringify(v3Manifest, null, 2));
  writeDual(csrDirs, 'manifest.json', v3ManBuf);

  const v4ManifestPath = path.join(STAGING_V4, 'manifest.json');
  const v4Manifest = fs.existsSync(v4ManifestPath) ? JSON.parse(fs.readFileSync(v4ManifestPath, 'utf8')) : { schema_version: 4 };
  const allV4Files = [];
  walkFiles(STAGING_V4, 'v4', allV4Files, 'v4/manifest.json');
  const maxV4File = allV4Files.reduce((m, f) => (f.bytes > m.bytes ? f : m), { path: '', bytes: 0 });
  const totalV4Bytes = allV4Files.reduce((s, f) => s + f.bytes, 0);
  v4Manifest.generated_at = new Date().toISOString();
  v4Manifest.stats = {
    ...(v4Manifest.stats || {}),
    eside_interp_edges: Object.keys(interpData.edges || {}).length,
    csr_part6_explicit_interp: totalPart6Edges,
    csr_part7_struct_analogy: totalPart7Edges,
    csr_max_cp_mass: Number(maxConceptProcMassObserved.toFixed(6)),
    csr_max_sa_mass: Number(maxStructAnalogyMassObserved.toFixed(6)),
  };
  v4Manifest.file_count = allV4Files.length + 1;
  v4Manifest.total_bytes = totalV4Bytes;
  v4Manifest.max_file = maxV4File;
  v4Manifest.files = allV4Files;
  assertNoRestrictedKeys(v4Manifest, 'v4Manifest');
  const v4ManBuf = Buffer.from(JSON.stringify(v4Manifest, null, 2));
  const v4Dirs = fs.existsSync(BUILD_V4) ? [BUILD_V4, STAGING_V4] : [STAGING_V4];
  writeDual(v4Dirs, 'manifest.json', v4ManBuf);

  console.log(
    `=== 8-Partition CSR + PPR complete in ${Math.round(performance.now() - t0)}ms ===\n` +
    `  v3 files: ${v3Manifest.file_count}, max=${maxV3File.path} (${maxV3File.bytes} B)\n` +
    `  v4 files: ${v4Manifest.file_count}, max=${maxV4File.path} (${maxV4File.bytes} B)`,
  );
}

if (isMainThread) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
