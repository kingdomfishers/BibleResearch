/**
 * Rebuilds v4/index/rmac-bmw.bin directly from existing v4/hreg/pack-*.bin
 * using extractRmacFeatures + buildRmacBmwIndex from v4-rmac-index.ts
 * so offline index keys and online R-MAC queries are 100% identical.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  decodeCompactHreg,
  parsePericopeTable,
} from '../../src/relationships/v4-hreg-types.ts';
import {
  BMW_FLAG_ACTANT,
  BMW_FLAG_CONCEPT,
} from '../../src/relationships/v3-binary-index.ts';
import {
  buildRmacBmwIndex,
  extractRmacFeatures,
} from '../../src/relationships/v4-rmac-index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const buildV4 = path.join(repoRoot, '.artifacts-r12/v4-build/v4');
const stagingV4 = path.join(repoRoot, '.artifacts-r12/staging-bundle/v4');

const perTable = parsePericopeTable(
  fs.readFileSync(path.join(stagingV4, 'index/pericopes.bin')),
  fs.readFileSync(path.join(stagingV4, 'index/vid-to-pericopes.bin')),
);

const packCache = new Map();
const hregs = [];
const m2Df = new Map();
const extracted = [];

for (const meta of perTable.records) {
  if (!packCache.has(meta.packFile)) {
    packCache.set(meta.packFile, fs.readFileSync(path.join(stagingV4, `hreg/pack-${String(meta.packFile).padStart(2, '0')}.bin`)));
  }
  const pack = packCache.get(meta.packFile);
  const slice = pack.subarray(meta.byteOff, meta.byteOff + meta.byteLen);
  const plain = slice[0] === 0x1f && slice[1] === 0x8b ? zlib.gunzipSync(slice) : slice;
  const g = decodeCompactHreg(plain);
  hregs.push(g);
  const feat = extractRmacFeatures(g);
  extracted.push(feat);
  for (const k of feat.m2) {
    m2Df.set(k, (m2Df.get(k) || 0) + 1);
  }
}

const maxM2Df = Math.floor(0.05 * hregs.length);
const maxGenDf = Math.floor(0.055 * hregs.length);
const buildWithMinDf = (minM2Df) => {
  const postings = new Map();
  const relBoosted = new Set();
  const add = (key, pid, flags) => {
    let rec = postings.get(key);
    if (!rec) {
      rec = { pericopeIds: new Set(), flags };
      postings.set(key, rec);
    } else {
      rec.flags |= flags;
    }
    rec.pericopeIds.add(pid);
  };
  for (let i = 0; i < hregs.length; i++) {
    const g = hregs[i];
    const feat = extracted[i];
    if (g.hoEdges.some(h => h.hoType !== 'ORD') || g.esideTags !== 0) relBoosted.add(g.pericopeId);
    for (const f of feat.features) {
      if (f.family === 'M2') {
        const df = m2Df.get(f.key) || 0;
        if (df < minM2Df || df > maxM2Df) continue;
        add(f.key, g.pericopeId, BMW_FLAG_ACTANT);
      } else if (f.family === 'M3') {
        add(f.key, g.pericopeId, BMW_FLAG_CONCEPT);
      } else {
        add(f.key, g.pericopeId, BMW_FLAG_ACTANT);
      }
    }
  }
  for (const [k, rec] of postings.entries()) {
    const df = rec.pericopeIds.size;
    if (df < 2 || (!k.startsWith('M4:') && df > maxGenDf)) {
      postings.delete(k);
    }
  }
  return buildRmacBmwIndex(postings, hregs.length, {
    denseThreshold: 256,
    relBoostedPericopes: relBoosted,
  });
};

let buf = buildWithMinDf(2);
if (buf.byteLength > 4.5 * 1024 * 1024) {
  buf = buildWithMinDf(3);
}
for (const dir of [buildV4, stagingV4]) {
  fs.writeFileSync(path.join(dir, 'index/rmac-bmw.bin'), buf);
  const mfPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(mfPath)) {
    const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
    const entry = mf.files?.find(f => f.path === 'v4/index/rmac-bmw.bin');
    if (entry) {
      entry.bytes = buf.byteLength;
      entry.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
    }
  }
}
console.log(`Rebuilt v4/index/rmac-bmw.bin using v4-rmac-index.ts (${buf.byteLength} bytes, ${(buf.byteLength / 1024 / 1024).toFixed(2)} MiB).`);
