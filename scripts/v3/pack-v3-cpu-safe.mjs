/**
 * Packs Stage S3/S2 v3 JSON shards into binary byte-range indexed packs
 * (BRV3PIDX / BRV3KIDX / BRV3NODE) inside .artifacts-r12/staging-bundle/v3/
 * so Cloudflare Workers Free (10 ms CPU / 128 MB RAM) only gunzip + parse 1-15 KB per record.
 *
 * Also reconciles v3/rhetoric/clauses tokens against repaired v3/verses tokens.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  KIDX_MAGIC,
  NODE_MAGIC,
  NUM_VERSES,
  PIDX_MAGIC,
} from '../../src/relationships/v3-binary-index.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD_DIR = path.join(ROOT, '.artifacts-r12/v3-build');
const BUILD_V3 = path.join(BUILD_DIR, 'v3');
const BUILD_RHET = path.join(BUILD_DIR, 'rhetoric');
const BUILD_ALIGN = path.join(BUILD_DIR, 'v3/align');
const STAGING_V3 = path.join(ROOT, '.artifacts-r12/staging-bundle/v3');

const MAX_PACK_BYTES = 4_800_000; // <= 4.8 MiB per pack (< 10 MiB limit)
const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024;

function writeMagic(buf, magic) {
  for (let i = 0; i < 8; i++) buf[i] = magic.charCodeAt(i);
}

function removeMatching(dir, regex) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const f of fs.readdirSync(dir)) {
    if (regex.test(f)) {
      fs.unlinkSync(path.join(dir, f));
      removed++;
    }
  }
  return removed;
}

function writePackedIntStore({ recordsById, maxId, outDir, idxName, packPrefix }) {
  fs.mkdirSync(outDir, { recursive: true });
  removeMatching(outDir, new RegExp(`^${packPrefix}-\\d+\\.bin$`));
  const ids = [...recordsById.keys()].filter(id => id >= 0 && id <= maxId).sort((a, b) => a - b);

  const locById = new Map();
  const packFiles = [];
  let chunks = [];
  let curBytes = 0;
  let fileIdx = 0;

  const flushPack = () => {
    if (chunks.length === 0) return;
    const fname = `${packPrefix}-${String(fileIdx).padStart(2, '0')}.bin`;
    fs.writeFileSync(path.join(outDir, fname), Buffer.concat(chunks));
    packFiles.push({ fname, bytes: curBytes });
    fileIdx++;
    chunks = [];
    curBytes = 0;
  };

  for (const id of ids) {
    const gz = zlib.gzipSync(JSON.stringify(recordsById.get(id)), { level: 6 });
    if (gz.length >= 0x00ffffff) throw new Error(`Record id=${id} exceeds 16 MiB`);
    if (curBytes > 0 && curBytes + gz.length > MAX_PACK_BYTES) {
      flushPack();
    }
    locById.set(id, { fileIdx, start: curBytes, length: gz.length });
    chunks.push(gz);
    curBytes += gz.length;
  }
  flushPack();

  const idxBuf = Buffer.alloc(20 + (maxId + 1) * 8);
  writeMagic(idxBuf, PIDX_MAGIC);
  idxBuf.writeUInt32LE(1, 8);
  idxBuf.writeUInt32LE(maxId, 12);
  idxBuf.writeUInt32LE(packFiles.length, 16);
  for (const [id, loc] of locById.entries()) {
    const off = 20 + id * 8;
    idxBuf.writeUInt32LE(loc.start >>> 0, off);
    idxBuf.writeUInt32LE((((loc.fileIdx & 0xff) << 24) | (loc.length & 0x00ffffff)) >>> 0, off + 4);
  }
  fs.writeFileSync(path.join(outDir, idxName), idxBuf);
  return { count: ids.length, idxBytes: idxBuf.byteLength, packFiles };
}

function writePackedKeyStore({ recordsByKey, outDir, idxName, packPrefix }) {
  fs.mkdirSync(outDir, { recursive: true });
  removeMatching(outDir, new RegExp(`^${packPrefix}-\\d+\\.bin$`));
  const entries = [...recordsByKey.entries()]
    .map(([k, val]) => ({ key: k, keyBuf: Buffer.from(k, 'utf8'), val }))
    .sort((a, b) => Buffer.compare(a.keyBuf, b.keyBuf));

  const packFiles = [];
  let chunks = [];
  let curBytes = 0;
  let fileIdx = 0;

  const flushPack = () => {
    if (chunks.length === 0) return;
    const fname = `${packPrefix}-${String(fileIdx).padStart(2, '0')}.bin`;
    fs.writeFileSync(path.join(outDir, fname), Buffer.concat(chunks));
    packFiles.push({ fname, bytes: curBytes });
    fileIdx++;
    chunks = [];
    curBytes = 0;
  };

  const indexed = [];
  const strChunks = [];
  let strOff = 0;

  for (const entry of entries) {
    const gz = zlib.gzipSync(JSON.stringify(entry.val), { level: 6 });
    if (gz.length >= 0x00ffffff) throw new Error(`Record key=${entry.key} exceeds 16 MiB`);
    if (curBytes > 0 && curBytes + gz.length > MAX_PACK_BYTES) {
      flushPack();
    }
    indexed.push({
      keyOff: strOff,
      keyLen: entry.keyBuf.length,
      start: curBytes,
      fileIdx,
      length: gz.length,
    });
    strChunks.push(entry.keyBuf);
    strOff += entry.keyBuf.length;
    chunks.push(gz);
    curBytes += gz.length;
  }
  flushPack();

  const dirOffset = 24;
  const headerAndDir = Buffer.alloc(dirOffset + indexed.length * 16);
  writeMagic(headerAndDir, KIDX_MAGIC);
  headerAndDir.writeUInt32LE(1, 8);
  headerAndDir.writeUInt32LE(indexed.length, 12);
  headerAndDir.writeUInt32LE(packFiles.length, 16);
  headerAndDir.writeUInt32LE(dirOffset, 20);

  for (let i = 0; i < indexed.length; i++) {
    const e = indexed[i];
    const off = dirOffset + i * 16;
    headerAndDir.writeUInt32LE(e.keyOff >>> 0, off);
    headerAndDir.writeUInt32LE(e.keyLen >>> 0, off + 4);
    headerAndDir.writeUInt32LE(e.start >>> 0, off + 8);
    headerAndDir.writeUInt32LE((((e.fileIdx & 0xff) << 24) | (e.length & 0x00ffffff)) >>> 0, off + 12);
  }
  const idxBuf = Buffer.concat([headerAndDir, ...strChunks]);
  fs.writeFileSync(path.join(outDir, idxName), idxBuf);
  return { count: indexed.length, idxBytes: idxBuf.byteLength, packFiles };
}

function buildNodesBin({ nodesJsonGzPath, outPath }) {
  const nodes = JSON.parse(zlib.gunzipSync(fs.readFileSync(nodesJsonGzPath)).toString('utf8'));
  const numVerses = Number(nodes.num_verses || NUM_VERSES);
  const entityOffset = Number(nodes.entity_offset || NUM_VERSES + 1);
  const idToKey = Array.isArray(nodes.id_to_key) ? nodes.id_to_key : [];
  const nodeMeta = Array.isArray(nodes.node_meta) ? nodes.node_meta : [];
  const entityCount = idToKey.length;

  const strPoolMap = new Map();
  const strChunks = [];
  let strLenTotal = 0;
  const internStr = (raw) => {
    const s = String(raw || '');
    if (!s) return { off: 0, len: 0 };
    const cached = strPoolMap.get(s);
    if (cached) return cached;
    const b = Buffer.from(s, 'utf8');
    const rec = { off: strLenTotal, len: b.length };
    strPoolMap.set(s, rec);
    strChunks.push(b);
    strLenTotal += b.length;
    return rec;
  };

  const lookupItems = [];
  const metaBuf = Buffer.alloc(entityCount * 24);
  for (let i = 0; i < entityCount; i++) {
    const keyStr = String(idToKey[i] || '');
    const kRec = internStr(keyStr);
    const nid = entityOffset + i;
    lookupItems.push({ keyBuf: Buffer.from(keyStr, 'utf8'), kRec, nid });

    const m = nodeMeta[i] || [keyStr, 1, 0, '', 0];
    const axisRec = internStr(m[0]);
    const df = Math.max(0, Number(m[1]) || 0);
    const flags = (Number(m[2]) ? 1 : 0) | (Number(m[4]) ? 2 : 0);
    const cohypRec = internStr(m[3]);

    const off = i * 24;
    metaBuf.writeUInt32LE(kRec.off >>> 0, off);
    metaBuf.writeUInt16LE(Math.min(0xffff, kRec.len), off + 4);
    metaBuf.writeUInt8(flags, off + 6);
    metaBuf.writeUInt8(0, off + 7);
    metaBuf.writeUInt32LE(df >>> 0, off + 8);
    metaBuf.writeUInt32LE(axisRec.off >>> 0, off + 12);
    metaBuf.writeUInt16LE(Math.min(0xffff, axisRec.len), off + 16);
    metaBuf.writeUInt16LE(Math.min(0xffff, cohypRec.len), off + 18);
    metaBuf.writeUInt32LE(cohypRec.off >>> 0, off + 20);
  }

  lookupItems.sort((a, b) => Buffer.compare(a.keyBuf, b.keyBuf));
  const lookupBuf = Buffer.alloc(entityCount * 12);
  for (let i = 0; i < entityCount; i++) {
    const it = lookupItems[i];
    const off = i * 12;
    lookupBuf.writeUInt32LE(it.kRec.off >>> 0, off);
    lookupBuf.writeUInt16LE(Math.min(0xffff, it.kRec.len), off + 4);
    lookupBuf.writeUInt16LE(0, off + 6);
    lookupBuf.writeUInt32LE(it.nid >>> 0, off + 8);
  }

  const lookupDirOff = 32;
  const metaOff = lookupDirOff + lookupBuf.byteLength;
  const header = Buffer.alloc(32);
  writeMagic(header, NODE_MAGIC);
  header.writeUInt32LE(1, 8);
  header.writeUInt32LE(numVerses, 12);
  header.writeUInt32LE(entityOffset, 16);
  header.writeUInt32LE(entityCount, 20);
  header.writeUInt32LE(lookupDirOff, 24);
  header.writeUInt32LE(metaOff, 28);

  const outBuf = Buffer.concat([header, lookupBuf, metaBuf, ...strChunks]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, outBuf);
  return { entityCount, bytes: outBuf.byteLength };
}

function main() {
  const t0 = performance.now();

  // 1. Pack v3/verses (from .artifacts-r12/v3-build/v3/verses/chunk-*.json.gz)
  const verseById = new Map();
  const verseBookById = new Map();
  const buildVersesDir = path.join(BUILD_V3, 'verses');
  for (const f of fs.readdirSync(buildVersesDir).filter(x => /^chunk-\d+\.json\.gz$/.test(x)).sort()) {
    const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(buildVersesDir, f))).toString('utf8'));
    for (const [vidStr, v] of Object.entries(d.verses || {})) {
      const vid = Number(vidStr);
      verseById.set(vid, v);
      verseBookById.set(vid, Number(v.book || 0));
    }
  }
  const stVersesDir = path.join(STAGING_V3, 'verses');
  const versesRes = writePackedIntStore({
    recordsById: verseById,
    maxId: NUM_VERSES,
    outDir: stVersesDir,
    idxName: 'verses.idx',
    packPrefix: 'pack',
  });
  const removedVerseChunks = removeMatching(stVersesDir, /^chunk-\d+\.json\.gz$/);
  console.log(`Packed v3/verses: ${versesRes.count} vv -> ${versesRes.packFiles.length} pack files + verses.idx (${versesRes.idxBytes} B), removed ${removedVerseChunks} chunks.`);

  // 2. Pack v3/profiles
  const profByKey = new Map();
  const buildProfDir = path.join(BUILD_V3, 'profiles');
  for (const f of fs.readdirSync(buildProfDir).filter(x => /^shard-\d+\.json\.gz$/.test(x)).sort()) {
    const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(buildProfDir, f))).toString('utf8'));
    for (const [bs, prof] of Object.entries(d.profiles || {})) {
      profByKey.set(bs, prof);
    }
  }
  const stProfDir = path.join(STAGING_V3, 'profiles');
  const profRes = writePackedKeyStore({
    recordsByKey: profByKey,
    outDir: stProfDir,
    idxName: 'profiles.idx',
    packPrefix: 'pack',
  });
  const removedProfShards = removeMatching(stProfDir, /^shard-\d+\.json\.gz$/);
  console.log(`Packed v3/profiles: ${profRes.count} profiles -> ${profRes.packFiles.length} pack files + profiles.idx (${profRes.idxBytes} B), removed ${removedProfShards} shards.`);

  // 3. Pack v3/rhetoric/clauses (reconciling OT tokens against repaired v3/verses) & per-book rhetoric-index
  const clauseById = new Map();
  for (const f of fs.readdirSync(BUILD_RHET).filter(x => /^clauses-\d+\.json\.gz$/.test(x)).sort()) {
    const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(BUILD_RHET, f))).toString('utf8'));
    for (const v of d.verses || []) {
      const vid = Number(v.vid);
      const repV = verseById.get(vid);
      if (repV?.toks) {
        v.tokens = repV.toks;
      }
      clauseById.set(vid, v);
    }
  }
  const stRhetDir = path.join(STAGING_V3, 'rhetoric');
  const clauseRes = writePackedIntStore({
    recordsById: clauseById,
    maxId: NUM_VERSES,
    outDir: stRhetDir,
    idxName: 'clauses.idx',
    packPrefix: 'clauses-pack',
  });

  const rhetIdx = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(BUILD_RHET, 'rhetoric-index.json.gz'))).toString('utf8'));
  const rhetByBook = new Map();
  const ensureBookRhet = (b) => {
    const key = String(b);
    let rec = rhetByBook.get(key);
    if (!rec) {
      rec = { schema_version: 3, book: Number(b), syntactic_talion_hits: [], onomastic_valence_hits: [] };
      rhetByBook.set(key, rec);
    }
    return rec;
  };
  for (const h of rhetIdx.syntactic_talion_hits || []) {
    const b = verseBookById.get(Number(h.vid)) || 0;
    if (b > 0) ensureBookRhet(b).syntactic_talion_hits.push(h);
  }
  for (const h of rhetIdx.onomastic_valence_hits || []) {
    const b = Number(h.book || 0);
    if (b > 0) ensureBookRhet(b).onomastic_valence_hits.push(h);
  }
  const rhetBookRes = writePackedKeyStore({
    recordsByKey: rhetByBook,
    outDir: stRhetDir,
    idxName: 'rhetoric-book.idx',
    packPrefix: 'rhetoric-book-pack',
  });
  const removedRhet = removeMatching(stRhetDir, /^(?:clauses-\d+\.json\.gz|rhetoric-index\.json\.gz)$/);
  console.log(`Packed v3/rhetoric: ${clauseRes.count} clause vv -> ${clauseRes.packFiles.length} pack files + ${rhetBookRes.count} book rhetoric slices, removed ${removedRhet} old files.`);

  // 4. Pack v3/align/mt-lxx & rahlfs-concordance
  const alignSrcDir = fs.existsSync(BUILD_ALIGN) ? BUILD_ALIGN : path.join(STAGING_V3, 'align');
  const stAlignDir = path.join(STAGING_V3, 'align');
  const mtLxxByVid = new Map();
  for (const f of fs.readdirSync(alignSrcDir).filter(x => /^mt-lxx-\d+\.bin$/.test(x)).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(alignSrcDir, f), 'utf8'));
    for (const [vidStr, rec] of Object.entries(d.verses || {})) {
      mtLxxByVid.set(Number(vidStr), rec);
    }
  }
  const mtLxxRes = writePackedIntStore({
    recordsById: mtLxxByVid,
    maxId: NUM_VERSES,
    outDir: stAlignDir,
    idxName: 'mt-lxx.idx',
    packPrefix: 'mt-lxx-pack',
  });

  const rahlfsByKey = new Map();
  for (const f of fs.readdirSync(alignSrcDir).filter(x => /^rahlfs-concordance-\d+\.bin$/.test(x)).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(alignSrcDir, f), 'utf8'));
    for (const [lem, rec] of Object.entries(d.lemmas || {})) {
      rahlfsByKey.set(lem, rec);
    }
  }
  const rahlfsRes = writePackedKeyStore({
    recordsByKey: rahlfsByKey,
    outDir: stAlignDir,
    idxName: 'rahlfs-concordance.idx',
    packPrefix: 'rahlfs-concordance-pack',
  });
  const removedAlign = removeMatching(stAlignDir, /^(?:mt-lxx-\d+\.bin|rahlfs-concordance-\d+\.bin)$/);
  console.log(`Packed v3/align: ${mtLxxRes.count} mt-lxx vv -> ${mtLxxRes.packFiles.length} files, ${rahlfsRes.count} rahlfs lemmas -> ${rahlfsRes.packFiles.length} files, removed ${removedAlign} old bins.`);

  // 5. Build v3/index/nodes.bin (BRV3NODE) and remove nodes.json.gz from staging
  const stIdxDir = path.join(STAGING_V3, 'index');
  const nodesBinRes = buildNodesBin({
    nodesJsonGzPath: path.join(BUILD_V3, 'index/nodes.json.gz'),
    outPath: path.join(stIdxDir, 'nodes.bin'),
  });
  const removedNodesJson = removeMatching(stIdxDir, /^nodes\.json\.gz$/);
  console.log(`Built v3/index/nodes.bin (${nodesBinRes.entityCount} entities, ${nodesBinRes.bytes} B), removed ${removedNodesJson} nodes.json.gz.`);

  // 6. Refresh v3/manifest.json in staging
  const manifestPath = path.join(STAGING_V3, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const allV3Files = [];
  const walk = (dir, relBase = 'v3') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      const rel = `${relBase}/${e.name}`;
      if (e.isDirectory()) walk(full, rel);
      else if (rel !== 'v3/manifest.json') {
        const buf = fs.readFileSync(full);
        if (buf.byteLength >= MAX_SINGLE_FILE_BYTES) {
          throw new Error(`Staging v3 file ${rel} exceeds 10 MiB (${buf.byteLength} B)`);
        }
        allV3Files.push({
          path: rel,
          bytes: buf.byteLength,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        });
      }
    }
  };
  walk(STAGING_V3);
  const maxFile = allV3Files.reduce((m, f) => (f.bytes > m.bytes ? f : m), { path: '', bytes: 0 });
  const totalBytes = allV3Files.reduce((s, f) => s + f.bytes, 0);
  manifest.generated_at = new Date().toISOString();
  manifest.packed_byte_range = true;
  manifest.file_count = allV3Files.length + 1;
  manifest.total_bytes = totalBytes;
  manifest.max_file = maxFile;
  manifest.files = allV3Files;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`v3 CPU-safe packing complete in ${Math.round(performance.now() - t0)}ms: ${manifest.file_count} v3/ files, total ${(totalBytes / 1048576).toFixed(2)} MiB, max ${maxFile.path} (${maxFile.bytes} B).`);
}

main();
