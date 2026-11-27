/**
 * Stage S3: Binary Hybrid Bitset/BMW Index, 6-Partition Typed Conductance CSR,
 * Precomputed Top-64 PPR Shards, and Flat v3 Profile/Verse Packs.
 *
 * Strictly consumes CC BY 4.0 / CC0 / MIT / PD sources (zero UBS restricted keys, zero Swete BY-SA):
 *   - .artifacts-r12/v3-build/sanitized-lexicon.json
 *   - .artifacts-r12/v3-build/lxx-alignment.json
 *   - .artifacts-r12/v3-build/rahlfs-concordance.bin (or v3/align/rahlfs-concordance-00..07.bin)
 *   - .artifacts-r12/v3-build/sense-ontology.json
 *   - .artifacts-r12/v3-build/rhetoric/{clauses-00..31.json.gz,rhetoric-index.json.gz}
 *   - .artifacts-r12/staging-bundle/v2/relationships/r11-v1.0/r10/{fast-verses,fast-profiles,xrefs,motifs-and-patterns.json.gz,explicit-and-typology.json.gz}
 *
 * Writes identical S3 packs to BOTH:
 *   - .artifacts-r12/v3-build/v3/
 *   - .artifacts-r12/staging-bundle/v3/
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  BITSET_WORDS,
  BMW_FLAG_ACTANT,
  BMW_FLAG_CONCEPT,
  BMW_FLAG_DENSE,
  BMW_FLAG_FUNC_STOP,
  BMW_FLAG_LXX,
  BMW_MAGIC,
  CSR_MAGIC,
  GRAPH_PARTITIONS,
  NUM_BLOCKS,
  NUM_VERSES,
  PPR_MAGIC,
  hashKey64,
} from '../../src/relationships/v3-binary-index.ts';
import { isLxxFunctionEquivalent } from '../../src/relationships/epistemic-taxonomy.ts';
import { isVerifiedAttestedWordplayEdge } from '../../src/relationships/wordplay-engine.ts';
import { repairV3VerseToks } from '../../src/relationships/v3-runtime-adapter.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD_DIR = path.join(ROOT, '.artifacts-r12/v3-build');
const OUT_BUILD_V3 = path.join(BUILD_DIR, 'v3');
const OUT_STAGING_V3 = path.join(ROOT, '.artifacts-r12/staging-bundle/v3');
const R10_DIR = path.join(ROOT, '.artifacts-r12/staging-bundle/v2/relationships/r11-v1.0/r10');

const MAX_FILE_BYTES = 10 * 1024 * 1024; // strictly < 10 MiB
const MAX_FLAT_SHARD_BYTES = 1024 * 1024; // strictly < 1 MiB for flat profiles/verses
const DENSE_THRESHOLD = 1000; // dense 3,904 B bitset for df > 1000
const NUM_CSR_PARTS = 16;
const NUM_PPR_SHARDS = 32;
const NUM_PROFILE_SHARDS = 48;
const NUM_VERSE_CHUNKS = 48;

const CONDUCTANCE_BETA = 0.40;
const CONDUCTANCE_KAPPA = 3;
const CONCEPT_PROC_MAX_MASS = 0.06;
const PPR_ALPHA = 0.20;
const PPR_EPS = 2e-5;

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

const PARTITION_INDEX = Object.fromEntries(GRAPH_PARTITIONS.map((name, i) => [name, i]));

function normStrongs4(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('lemma:')) s = s.slice(6);
  const m = /^([HGhg])0*(\d+)(?:[A-Za-z].*)?$/.exec(s);
  if (!m) return '';
  return m[1].toUpperCase() + m[2].padStart(4, '0');
}

function normalizeGreekLemma(lemma) {
  return lemma ? String(lemma).normalize('NFC').trim() : '';
}

function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function stripRestrictedKeys(val) {
  if (Array.isArray(val)) {
    return val.map(stripRestrictedKeys);
  }
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (RESTRICTED_KEYS.has(k)) continue;
      out[k] = v && typeof v === 'object' ? stripRestrictedKeys(v) : v;
    }
    return out;
  }
  return val;
}

function assertNoRestrictedKeys(val, p = '') {
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) assertNoRestrictedKeys(val[i], `${p}[${i}]`);
  } else if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      if (RESTRICTED_KEYS.has(k)) {
        throw new Error(`Restricted UBS key "${k}" detected at ${p}.${k}`);
      }
      if (v && typeof v === 'object') assertNoRestrictedKeys(v, `${p}.${k}`);
    }
  }
}

function writeDual(relPath, buf, maxBytes = MAX_FILE_BYTES) {
  if (buf.byteLength >= maxBytes) {
    throw new Error(`File ${relPath} size ${buf.byteLength} exceeds cap ${maxBytes}`);
  }
  for (const base of [OUT_BUILD_V3, OUT_STAGING_V3]) {
    const dest = path.join(base, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  return {
    path: `v3/${relPath.replace(/\\/g, '/')}`,
    bytes: buf.byteLength,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

function cleanDirFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) cleanDirFiles(p);
    else fs.unlinkSync(p);
  }
}

function loadRahlfsConcordance() {
  const buildPath = path.join(BUILD_DIR, 'rahlfs-concordance.bin');
  if (fs.existsSync(buildPath)) {
    return JSON.parse(fs.readFileSync(buildPath, 'utf8'));
  }
  const alignDir = path.join(OUT_STAGING_V3, 'align');
  const merged = { schema_version: 3, total_books: 59, total_verses: 0, lemmas: {} };
  for (const f of fs.readdirSync(alignDir).filter(x => /^rahlfs-concordance-\d+\.bin$/.test(x)).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(alignDir, f), 'utf8'));
    merged.total_books = d.total_books;
    merged.total_verses = d.total_verses;
    Object.assign(merged.lemmas, d.lemmas);
  }
  return merged;
}

function buildBmwBinary(postingsMap, relBoostedVids) {
  const entries = [];
  const seenHashes = new Set();

  for (const [key, rec] of postingsMap.entries()) {
    if (!rec.vids || rec.vids.size === 0) continue;
    const { hi, lo } = hashKey64(key);
    const hashTag = `${hi}:${lo}`;
    if (seenHashes.has(hashTag)) {
      throw new Error(`64-bit hash collision on BMW key "${key}"`);
    }
    seenHashes.add(hashTag);
    const vids = [...rec.vids].filter(v => v >= 1 && v <= NUM_VERSES).sort((a, b) => a - b);
    if (vids.length === 0) continue;
    const df = vids.length;
    const isDense = df > DENSE_THRESHOLD;
    const flags = (isDense ? BMW_FLAG_DENSE : 0) | (rec.flags || 0);
    const idf = Math.log2(NUM_VERSES / df);
    const idfQ8 = Math.min(255, Math.max(0, Math.round(idf * 20)));
    entries.push({ key, hi, lo, df, vids, flags, idfQ8 });
  }

  entries.sort((a, b) => (a.hi !== b.hi ? a.hi - b.hi : a.lo - b.lo));

  const headerSize = 64;
  const dirSize = entries.length * 20;
  const denseChunks = [];
  const sparseChunks = [];
  const bmwChunks = [];
  let denseOff = 0;
  let sparseOff = 0;
  let bmwOff = 0;
  let denseCount = 0;

  for (const e of entries) {
    const isDense = (e.flags & BMW_FLAG_DENSE) !== 0;
    if (isDense) {
      denseCount++;
      e.payloadOffset = denseOff;
      const words = new Uint32Array(BITSET_WORDS);
      for (const vid of e.vids) {
        const idx0 = vid - 1;
        words[idx0 >>> 5] |= 1 << (idx0 & 31);
      }
      const buf = new Uint8Array(BITSET_WORDS * 4);
      const dv = new DataView(buf.buffer);
      for (let w = 0; w < BITSET_WORDS; w++) dv.setUint32(w * 4, words[w], true);
      denseChunks.push(buf);
      denseOff += buf.byteLength;
    } else {
      e.payloadOffset = sparseOff;
      const bytes = [];
      let prev = 0;
      for (const vid of e.vids) {
        const idx0 = vid - 1;
        let d = idx0 - prev;
        prev = idx0;
        while (d >= 0x80) {
          bytes.push((d & 0x7f) | 0x80);
          d >>>= 7;
        }
        bytes.push(d);
      }
      const arr = Uint8Array.from(bytes);
      sparseChunks.push(arr);
      sparseOff += arr.byteLength;
    }

    // 64-verse BMW block summaries matching v3-binary-index.ts (NUM_BLOCKS = 488)
    const blockHasRel = new Map();
    for (const vid of e.vids) {
      const b = (vid - 1) >>> 6;
      const rel = relBoostedVids.has(vid);
      if (!blockHasRel.has(b) || rel) blockHasRel.set(b, rel);
    }
    const sortedBlocks = [...blockHasRel.keys()].sort((a, b) => a - b);
    const bmwBuf = new Uint8Array(2 + sortedBlocks.length * 4);
    const bv = new DataView(bmwBuf.buffer);
    bv.setUint16(0, sortedBlocks.length, true);
    for (let i = 0; i < sortedBlocks.length; i++) {
      const b = sortedBlocks[i];
      const ubRelQ8 = blockHasRel.get(b) ? 24 : 12; // 0.60 vs 0.30 relational upper-bound
      bv.setUint16(2 + i * 4, b, true);
      bv.setUint8(2 + i * 4 + 2, e.idfQ8);
      bv.setUint8(2 + i * 4 + 3, ubRelQ8);
    }
    e.bmwOffset = bmwOff;
    bmwChunks.push(bmwBuf);
    bmwOff += bmwBuf.byteLength;
  }

  const denseOffset = headerSize + dirSize;
  const sparseOffset = denseOffset + denseOff;
  const bmwOffset = sparseOffset + sparseOff;
  const totalBytes = bmwOffset + bmwOff;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);

  for (let i = 0; i < 8; i++) out[i] = BMW_MAGIC.charCodeAt(i);
  view.setUint32(8, 3, true);
  view.setUint32(12, NUM_VERSES, true);
  view.setUint32(16, NUM_BLOCKS, true);
  view.setUint32(20, entries.length, true);
  view.setUint32(24, headerSize, true);
  view.setUint32(28, denseOffset, true);
  view.setUint32(32, sparseOffset, true);
  view.setUint32(36, bmwOffset, true);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const off = headerSize + i * 20;
    view.setUint32(off, e.lo, true);
    view.setUint32(off + 4, e.hi, true);
    view.setUint16(off + 8, e.df, true);
    view.setUint8(off + 10, e.flags);
    view.setUint8(off + 11, e.idfQ8);
    view.setUint32(off + 12, e.payloadOffset, true);
    view.setUint32(off + 16, e.bmwOffset, true);
  }

  let cur = denseOffset;
  for (const c of denseChunks) { out.set(c, cur); cur += c.byteLength; }
  for (const c of sparseChunks) { out.set(c, cur); cur += c.byteLength; }
  for (const c of bmwChunks) { out.set(c, cur); cur += c.byteLength; }

  return {
    buf: out,
    stats: {
      terms: entries.length,
      dense_terms: denseCount,
      sparse_terms: entries.length - denseCount,
      dense_bytes: denseOff,
      sparse_bytes: sparseOff,
      bmw_bytes: bmwOff,
      total_bytes: totalBytes,
    },
  };
}

async function main() {
  const t0 = performance.now();
  console.log('Stage S3: Loading S1/S2 & sanitized r10 artifacts...');

  const lexicon = JSON.parse(fs.readFileSync(path.join(BUILD_DIR, 'sanitized-lexicon.json'), 'utf8'));
  const ontology = JSON.parse(fs.readFileSync(path.join(BUILD_DIR, 'sense-ontology.json'), 'utf8'));
  const lxxAlign = JSON.parse(fs.readFileSync(path.join(BUILD_DIR, 'lxx-alignment.json'), 'utf8'));
  const rahlfsConc = loadRahlfsConcordance();

  const rhetDir = path.join(BUILD_DIR, 'rhetoric');
  const rhetoricIdx = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(path.join(rhetDir, 'rhetoric-index.json.gz'))).toString('utf8')
  );

  // Load lossless clauses-00..31.json.gz (31,203 canonical verses)
  const versesByVid = new Map();
  for (const f of fs.readdirSync(rhetDir).filter(x => /^clauses-\d+\.json\.gz$/.test(x)).sort()) {
    const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(rhetDir, f))).toString('utf8'));
    for (const v of d.verses || []) {
      versesByVid.set(v.vid, v);
    }
  }
  console.log(`Loaded ${versesByVid.size} rhetoric verses in ${Math.round(performance.now() - t0)}ms.`);

  // Load fast-verses (English text + mt_ref + top scored xrefs)
  const fastVersesDir = path.join(R10_DIR, 'fast-verses');
  const enByVid = new Map();
  const mtRefByVid = new Map();
  const fastXrefsByVid = new Map();
  for (const f of fs.readdirSync(fastVersesDir).filter(x => /^chunk-.*\.json\.gz$/.test(x)).sort()) {
    const chunk = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fastVersesDir, f))).toString('utf8'));
    for (const [vidStr, b64] of Object.entries(chunk.verses || {})) {
      const vid = Number(vidStr);
      const v = JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
      if (v.en) enByVid.set(vid, v.en);
      if (v.mt_ref) mtRefByVid.set(vid, v.mt_ref);
    }
    for (const [vidStr, list] of Object.entries(chunk.xrefs || {})) {
      const vid = Number(vidStr);
      if (Array.isArray(list)) fastXrefsByVid.set(vid, list);
    }
  }

  // Reconcile shifted OT token positions (e.g., Jer 6:29) against canonical v1/chapters and fix adjacent NT swaps (1 Pet 2:6)
  const v1ChapterDir = path.join(ROOT, '.artifacts-r12/staging-bundle/v1/chapters');
  const v1ChapterCache = new Map();
  const stripHebCons = s => String(s || '').normalize('NFD').replace(/[^\u05D0-\u05EA]/g, '');
  let otReconciledVerses = 0;
  let ntRepairedVerses = 0;
  for (const [vid, rv] of versesByVid.entries()) {
    const toks = rv.tokens || [];
    if (rv.book >= 40 && toks.length > 0) {
      const rep = repairV3VerseToks({ vid, book: rv.book, toks });
      if (rep !== toks && rep.some((rt, idx) => rt.s !== toks[idx].s || rt.lm !== toks[idx].lm)) {
        rv.tokens = rep.map((rt, idx) => ({ ...rt, wn: idx + 1 }));
        ntRepairedVerses++;
      }
      continue;
    }
    const isShifted = rv.book <= 39 && toks.some((t, i) => Number(t.wn) !== i + 1);
    if (!isShifted) continue;
    const chFile = `b${rv.book}-c${rv.chapter}.json.gz`;
    let chVerses = v1ChapterCache.get(chFile);
    if (chVerses === undefined) {
      const chPath = path.join(v1ChapterDir, chFile);
      if (fs.existsSync(chPath)) {
        const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(chPath)).toString('utf8'));
        chVerses = Object.values(parsed.verses || {});
      } else {
        chVerses = null;
      }
      v1ChapterCache.set(chFile, chVerses);
    }
    const v1Verse = chVerses?.find(x => Number(x.verse_id) === vid || Number(x.verse_nr || x.verse) === rv.verse);
    const v1Toks = Array.isArray(v1Verse?.tokens) ? v1Verse.tokens : [];
    if (!v1Toks.length) continue;

    // Expand Kethib-Qere joined tokens in v1 (e.g. "מֵאֵשׁ תַּם") cleanly to aligned sub-slots
    const canonSlots = [];
    for (const ct of v1Toks) {
      const parts = String(ct.surface_form || '').trim().split(/\s+/).filter(Boolean);
      const baseBs = normStrongs4(ct.base_strongs);
      const stemMorph = (ct.morphemes || []).find(m => m.morpheme_role === 'stem') || ct.morphemes?.[ct.morphemes.length - 1];
      const baseLm = stemMorph?.lemma_script || '';
      if (parts.length <= 1) {
        canonSlots.push({ cons: stripHebCons(parts[0] || ''), wid: ct.word_id, bs: baseBs, lm: baseLm, gl: ct.attested_english_gloss || '' });
      } else {
        for (let pi = 0; pi < parts.length; pi++) {
          canonSlots.push({
            cons: stripHebCons(parts[pi]),
            wid: ct.word_id,
            bs: pi === 0 ? baseBs : '',
            lm: pi === 0 ? baseLm : '',
            gl: pi === 0 ? (ct.attested_english_gloss || '') : '',
          });
        }
      }
    }

    // Monotone consonantal matching from toks[i] -> canonSlots[j]
    let ci = 0;
    const matchedCanon = new Array(toks.length).fill(null);
    for (let i = 0; i < toks.length; i++) {
      const tc = stripHebCons(toks[i].sf);
      for (let k = ci; k < Math.min(canonSlots.length, ci + 4); k++) {
        const cc = canonSlots[k].cons;
        if (tc && cc && (tc === cc || (tc.length >= 2 && cc.length >= 2 && (tc.includes(cc) || cc.includes(tc))))) {
          matchedCanon[i] = canonSlots[k];
          ci = k + 1;
          break;
        }
      }
    }
    // Preserve valid original lemma/strongs only for split Qere parts (where canonSlot.bs === ''); replace shifted slots using canonical v1 token!
    for (let i = 0; i < toks.length; i++) {
      const mc = matchedCanon[i];
      toks[i].wn = i + 1;
      if (mc) {
        if (mc.wid) toks[i].wid = mc.wid;
        if (mc.bs) {
          toks[i].s = mc.bs;
          toks[i].lk = `lemma:${mc.bs}`;
          if (mc.lm) toks[i].lm = mc.lm;
          if (mc.gl) toks[i].g = mc.gl;
        }
      }
    }
    otReconciledVerses++;
  }
  console.log(`Token hygiene: reconciled ${otReconciledVerses} shifted OT verses, ${ntRepairedVerses} swapped NT verses.`);

  // Load r10/xrefs/book-*.json.gz
  const xrefsDir = path.join(R10_DIR, 'xrefs');
  const bookXrefsByVid = new Map();
  for (const f of fs.readdirSync(xrefsDir).filter(x => x.endsWith('.json.gz')).sort()) {
    const x = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(xrefsDir, f))).toString('utf8'));
    for (const [vidStr, rec] of Object.entries(x.by_verse || {})) {
      bookXrefsByVid.set(Number(vidStr), rec.out || []);
    }
  }

  // Load & sanitize fast-profiles (strip restricted keys & drop r12_pilot_anchor noise blobs)
  const fastProfilesDir = path.join(R10_DIR, 'fast-profiles');
  const rawFastProfiles = new Map();
  for (const f of fs.readdirSync(fastProfilesDir).filter(x => x.endsWith('.json.gz')).sort()) {
    const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fastProfilesDir, f))).toString('utf8'));
    for (const [k, b64] of Object.entries(d.profiles || {})) {
      const bs = normStrongs4(k);
      if (!bs) continue;
      const p = JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
      delete p.r12_pilot_anchor;
      rawFastProfiles.set(bs, stripRestrictedKeys(p));
    }
  }

  const motifsDoc = stripRestrictedKeys(
    JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(R10_DIR, 'motifs-and-patterns.json.gz'))).toString('utf8'))
  );
  const r13Motifs = motifsDoc.r13_motifs_b64gz
    ? stripRestrictedKeys(JSON.parse(zlib.gunzipSync(Buffer.from(motifsDoc.r13_motifs_b64gz, 'base64')).toString('utf8')))
    : {};
  const r13MotifsByBs = motifsDoc.r13_motifs_by_bs || {};
  const r13MotifsByVid = motifsDoc.r13_motifs_by_vid || {};

  const explicitDoc = stripRestrictedKeys(
    JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(R10_DIR, 'explicit-and-typology.json.gz'))).toString('utf8'))
  );

  console.log(`Loaded fast-verses/profiles/xrefs/motifs in ${Math.round(performance.now() - t0)}ms.`);

  const INCREMENTAL_PACKS = process.argv.includes('--incremental-packs');
  // Clean previous S3 output subdirectories (preserve align/ and rhetoric/ in staging-bundle/v3/;
  // in --incremental-packs mode, also preserve graph/ and existing nodes.json.gz ID mapping)
  const cleanSubs = INCREMENTAL_PACKS ? ['profiles', 'verses'] : ['index', 'graph', 'profiles', 'verses'];
  for (const sub of cleanSubs) {
    cleanDirFiles(path.join(OUT_BUILD_V3, sub));
    cleanDirFiles(path.join(OUT_STAGING_V3, sub));
  }

  // Grammatical marker set & ontology maps
  const grammaticalMarkers = new Set();
  for (const [bsRaw, prof] of Object.entries(lexicon.profiles || {})) {
    const bs = normStrongs4(bsRaw);
    if (bs && prof.is_grammatical_marker) grammaticalMarkers.add(bs);
  }

  const polysemeStrongs = new Set();
  for (const [bsRaw, prof] of Object.entries(lexicon.profiles || {})) {
    const bs = normStrongs4(bsRaw);
    if (bs && (prof.senses?.length || 0) > 1) polysemeStrongs.add(bs);
  }
  for (const bsRaw of Object.keys(ontology.sense_gate_profiles || {})) {
    const bs = normStrongs4(bsRaw);
    if (bs) polysemeStrongs.add(bs);
  }

  const bsToConcepts = new Map(); // bs -> Set<conceptId>
  const conceptMeta = new Map(); // cid -> { label, oewn_id, oewn_label, wikidata_id, valence, material_group, physical_props }
  for (const [cid, cObj] of Object.entries(ontology.concept_classes || {})) {
    conceptMeta.set(cid, {
      concept_id: cid,
      label: cObj.label,
      oewn_id: cObj.oewn_id || null,
      oewn_label: cObj.oewn_label || cObj.label || null,
      wikidata_id: cObj.wikidata_id || null,
      valence: cObj.valence || 0,
      material_group: cObj.material_group || null,
      cross_lingual: Boolean(cObj.cross_lingual),
      strongs: (cObj.strongs || []).map(normStrongs4).filter(Boolean),
    });
    for (const sRaw of cObj.strongs || []) {
      const bs = normStrongs4(sRaw);
      if (!bs) continue;
      if (!bsToConcepts.has(bs)) bsToConcepts.set(bs, new Set());
      bsToConcepts.get(bs).add(cid);
    }
  }

  const bsPhysicalProps = new Map();
  for (const ms of Object.values(ontology.mapped_senses || {})) {
    const bs = normStrongs4(ms.bs);
    if (bs && ms.physical_props && !bsPhysicalProps.has(bs)) {
      bsPhysicalProps.set(bs, ms.physical_props);
    }
  }

  // =========================================================================
  // 1. Build Postings Map for BRV3BMW + Collect Relational Evidence
  // =========================================================================
  const postings = new Map(); // key -> { vids: Set<number>, flags: number }
  const addPosting = (key, vid, flags = 0) => {
    if (!key || vid < 1 || vid > NUM_VERSES) return;
    let rec = postings.get(key);
    if (!rec) {
      rec = { vids: new Set(), flags };
      postings.set(key, rec);
    } else {
      rec.flags |= flags;
    }
    rec.vids.add(vid);
  };

  const relBoostedVids = new Set();
  const splitSenseKeys = new Set();
  const indexedStrongsKeys = new Set();
  const greekLemmaToStrongs = new Map(); // normalized Greek lemma -> Map<Gxxxx, count>

  for (const [vid, v] of versesByVid.entries()) {
    if ((fastXrefsByVid.get(vid)?.length || 0) > 0 || (bookXrefsByVid.get(vid)?.length || 0) > 0) {
      relBoostedVids.add(vid);
    }
    if (r13MotifsByVid[String(vid)]?.length) relBoostedVids.add(vid);

    for (const t of v.tokens || []) {
      const bs = normStrongs4(t.s);
      if (bs) {
        indexedStrongsKeys.add(bs);
        addPosting(bs, vid, grammaticalMarkers.has(bs) ? BMW_FLAG_FUNC_STOP : 0);
        if (bs.startsWith('G') && t.lm && !t.is_func && !grammaticalMarkers.has(bs)) {
          const gLem = normalizeGreekLemma(t.lm);
          if (gLem) {
            if (!greekLemmaToStrongs.has(gLem)) greekLemmaToStrongs.set(gLem, new Map());
            const gm = greekLemmaToStrongs.get(gLem);
            gm.set(bs, (gm.get(bs) || 0) + 1);
          }
        }
      }

      // Split polyseme / gated sense keys (e.g. H5869#eye, H5869#spring)
      if (t.sense_id) {
        const sm = /^sense:([^:]+):(.+)$/.exec(t.sense_id);
        if (sm) {
          const sBs = normStrongs4(sm[1]);
          const tag = sm[2];
          if (sBs && tag !== 'primary' && tag !== 'unified') {
            const sk = `${sBs}#${tag}`;
            splitSenseKeys.add(sk);
            addPosting(sk, vid, 0);
          }
        }
      }
      if (bs && polysemeStrongs.has(bs) && t.lk) {
        const lkMatch = /^lemma:[HG]\d+([a-zA-Z]+)$/.exec(t.lk);
        if (lkMatch && lkMatch[1] !== 'G' && lkMatch[1] !== 'a') {
          const sk = `${bs}#${bs}${lkMatch[1]}`;
          splitSenseKeys.add(sk);
          addPosting(sk, vid, 0);
        }
      }

      if (t.concept_id) {
        addPosting(`c:${t.concept_id}`, vid, BMW_FLAG_CONCEPT);
      }
    }

    // Lossless clause actant / role keys
    for (const cl of v.clauses || []) {
      const predBs = normStrongs4(cl.predicate?.s);
      const predCid = cl.predicate?.concept_id || null;
      if (cl.polarity === 'negative' || (cl.neg_markers && cl.neg_markers.length > 0)) {
        addPosting('role:NEG:*', vid, BMW_FLAG_ACTANT);
        if (predBs) addPosting(`role:NEG:${predBs}`, vid, BMW_FLAG_ACTANT);
        if (predCid) addPosting(`role:NEG:${predCid}`, vid, BMW_FLAG_ACTANT);
      }
      for (const subj of cl.subjects || []) {
        const sBs = normStrongs4(subj);
        if (sBs) {
          addPosting(`role:${sBs}:SUBJ`, vid, BMW_FLAG_ACTANT);
          if (predBs) addPosting(`role:${predBs}:SUBJ`, vid, BMW_FLAG_ACTANT);
        }
      }
      for (const obj of cl.objects || []) {
        const oBs = normStrongs4(obj);
        if (oBs) {
          addPosting(`role:${oBs}:OBJ`, vid, BMW_FLAG_ACTANT);
          if (predBs) addPosting(`role:${predBs}:OBJ`, vid, BMW_FLAG_ACTANT);
        }
      }
    }
  }

  // Rahlfs LXX lemma postings (lxx:<lemma>), excluding Greek article/conjunction/preposition stop lemmas
  const lxxKeys = [];
  for (const [lemRaw, rec] of Object.entries(rahlfsConc.lemmas || {})) {
    const lem = normalizeGreekLemma(lemRaw);
    if (!lem || isLxxFunctionEquivalent(null, lem)) continue;
    const key = `lxx:${lem}`;
    let hasValid = false;
    for (const v of rec.verses || []) {
      if (v.vid >= 1 && v.vid <= NUM_VERSES) {
        addPosting(key, v.vid, BMW_FLAG_LXX);
        hasValid = true;
      }
    }
    if (hasValid) lxxKeys.push(key);
  }

  // Aggregate MT<->LXX alignments & shifts per verse/lemma (filter function/adverb stopwords)
  const LXX_EQUIV_STOPWORDS = new Set([
    'καί', 'ὁ', 'ἐν', 'εἰς', 'ἐπί', 'πρός', 'ἀπό', 'διά', 'κατά', 'μετά', 'περί', 'ὑπό', 'ἐκ',
    'αὐτός', 'ἐγώ', 'σύ', 'δέ', 'γάρ', 'ἀλλά', 'οὐ', 'μή', 'ὅτι', 'ὡς', 'τις', 'τίς', 'ὅς',
    'ἔτι', 'νῦν', 'οὐκέτι', 'μηκέτι', 'πάλιν', 'τότε', 'οὕτως', 'οὕτω', 'ἐκεῖ', 'ὧδε', 'ἤδη', 'ἄρτι',
  ]);
  const hToLxxCounts = new Map(); // "Hxxxx\0lxx:..." -> { count, stabSum }
  const hLxxEquivSummary = new Map(); // Hxxxx -> Map<g_lemma, { count, stabSum }>
  const hLxxShiftsSummary = new Map(); // Hxxxx -> shift[]
  for (const av of lxxAlign.verses || []) {
    for (const vid of av.vids || []) {
      if ((av.shifts || []).length > 0) relBoostedVids.add(vid);
    }
    for (const l of av.links || []) {
      if (l.rule) continue;
      const hBs = normStrongs4(l.h_bs);
      const gLem = normalizeGreekLemma(l.g_lemma);
      if (!hBs || !gLem || grammaticalMarkers.has(hBs) || LXX_EQUIV_STOPWORDS.has(gLem) || isLxxFunctionEquivalent(null, gLem)) continue;
      if (l.method === 'psi_backoff' && (l.psi ?? 0) < 4.5) continue;
      const lxxKey = `lxx:${gLem}`;
      const k = `${hBs}\0${lxxKey}`;
      let rec = hToLxxCounts.get(k);
      if (!rec) { rec = { count: 0, stabSum: 0 }; hToLxxCounts.set(k, rec); }
      rec.count++;
      rec.stabSum += l.stability ?? 0.85;

      if (!hLxxEquivSummary.has(hBs)) hLxxEquivSummary.set(hBs, new Map());
      const hm = hLxxEquivSummary.get(hBs);
      let hr = hm.get(gLem);
      if (!hr) { hr = { count: 0, stabSum: 0 }; hm.set(gLem, hr); }
      hr.count++;
      hr.stabSum += l.stability ?? 0.85;
    }
    for (const sh of av.shifts || []) {
      const hBs = normStrongs4(sh.h_bs);
      if (hBs) {
        if (!hLxxShiftsSummary.has(hBs)) hLxxShiftsSummary.set(hBs, []);
        const arr = hLxxShiftsSummary.get(hBs);
        if (arr.length < 12) arr.push({ ref: av.ref, vid: av.vids?.[0] || null, ...sh });
      }
    }
  }

  console.log('Building postings-bmw.bin...');
  const bmwBuilt = buildBmwBinary(postings, relBoostedVids);
  const bmwMeta = writeDual('index/postings-bmw.bin', bmwBuilt.buf);
  console.log('postings-bmw.bin:', bmwBuilt.stats);

  const existingNodesPath = path.join(OUT_STAGING_V3, 'index/nodes.json.gz');
  const existingManifestPath = path.join(OUT_STAGING_V3, 'manifest.json');
  const canIncremental = INCREMENTAL_PACKS && fs.existsSync(existingNodesPath) && fs.existsSync(existingManifestPath);

  let numNonVerseNodes = 0;
  let totalNodes = NUM_VERSES;
  let nodesMeta = null;
  let totalCsrEdges = 0;
  let maxConceptProcMassObserved = 0;
  let csrManifestFiles = [];
  let pprSeedsCount = 0;
  let totalPprEntries = 0;
  let pprManifestFiles = [];

  if (canIncremental) {
    const prevManifest = JSON.parse(fs.readFileSync(existingManifestPath, 'utf8'));
    numNonVerseNodes = prevManifest.graph.num_entities;
    totalNodes = prevManifest.graph.total_nodes;
    totalCsrEdges = prevManifest.graph.total_csr_edges;
    maxConceptProcMassObserved = prevManifest.graph.concept_proc_max_mass;
    pprSeedsCount = prevManifest.graph.ppr_seeds;
    totalPprEntries = prevManifest.graph.ppr_entries;
    nodesMeta = { bytes: fs.statSync(existingNodesPath).size };
    csrManifestFiles = prevManifest.files.filter(f => f.path.startsWith('v3/graph/typed-csr/'));
    pprManifestFiles = prevManifest.files.filter(f => f.path.startsWith('v3/graph/ppr-top64/'));
    console.log(`Incremental mode: reusing existing nodes (${totalNodes}) + CSR (${csrManifestFiles.length} parts) + PPR (${pprManifestFiles.length} shards).`);
  } else {
  // =========================================================================
  // 2. Canonical Node ID Space (1..31203 = verses, >=31204 = entities)
  // =========================================================================
  const keyToId = new Map();
  const idToKey = []; // index = nodeId - (NUM_VERSES + 1)
  const nodeMeta = []; // compact [axisKey, df, isPhysical(0|1), cohyponymGroup, isExplicitCue(0|1)]

  const allocNode = (key, axisKey, df, isPhysical = 0, cohyponymGroup = '', isExplicitCue = 0) => {
    if (keyToId.has(key)) return keyToId.get(key);
    const id = NUM_VERSES + 1 + idToKey.length;
    keyToId.set(key, id);
    idToKey.push(key);
    nodeMeta.push([axisKey, Math.max(1, df), isPhysical ? 1 : 0, cohyponymGroup || '', isExplicitCue ? 1 : 0]);
    return id;
  };

  for (const bs of [...indexedStrongsKeys].sort()) {
    const df = postings.get(bs)?.vids.size || 1;
    const cids = bsToConcepts.get(bs);
    const primaryCid = cids ? [...cids][0] : null;
    const cInfo = primaryCid ? conceptMeta.get(primaryCid) : null;
    const phys = bsPhysicalProps.get(bs) || cInfo?.material_group;
    const axisKey = primaryCid ? `CONCEPT:${primaryCid}` : `LEMMA:${bs}`;
    allocNode(bs, axisKey, df, Boolean(phys), cInfo?.material_group || '', 0);
  }

  for (const sk of [...splitSenseKeys].sort()) {
    const df = postings.get(sk)?.vids.size || 1;
    const bs = sk.split('#')[0];
    const phys = bsPhysicalProps.get(bs);
    allocNode(sk, `SENSE:${sk}`, df, Boolean(phys), '', 1);
  }

  for (const lxxKey of [...new Set(lxxKeys)].sort()) {
    const df = postings.get(lxxKey)?.vids.size || 1;
    allocNode(lxxKey, `LXX:${lxxKey.slice(4)}`, df, 0, '', 0);
  }

  for (const [cid, cInfo] of [...conceptMeta.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const cKey = `c:${cid}`;
    const df = postings.get(cKey)?.vids.size || Math.max(1, cInfo.strongs.length);
    const isPhys = Boolean(cInfo.material_group);
    allocNode(cKey, `CONCEPT:${cid}`, df, isPhys, cInfo.material_group || '', 0);
  }

  numNonVerseNodes = idToKey.length;
  totalNodes = NUM_VERSES + numNonVerseNodes;
  console.log(`Canonical node space: ${NUM_VERSES} verses + ${numNonVerseNodes} entities = ${totalNodes} nodes.`);

  const nodesPayload = {
    schema_version: 3,
    num_verses: NUM_VERSES,
    entity_offset: NUM_VERSES + 1,
    total_nodes: totalNodes,
    key_to_id: Object.fromEntries(keyToId),
    id_to_key: idToKey,
    node_meta: nodeMeta,
  };
  assertNoRestrictedKeys(nodesPayload, 'nodes');
  const nodesGz = zlib.gzipSync(JSON.stringify(nodesPayload), { level: 6 });
  nodesMeta = writeDual('index/nodes.json.gz', nodesGz);

  // =========================================================================
  // 3. Build 6-Partition Typed Conductance CSR (beta=0.40, kappa=3, CP<=0.06)
  // =========================================================================
  // Store raw edges in Map<fromNodeId, Map<string "to:part", { to, part, weight, flags }>>
  const rawAdj = Array.from({ length: totalNodes + 1 }, () => new Map());
  const addEdge = (from, to, partName, weight, epistemicFlags = 1) => {
    if (!from || !to || from === to || weight <= 0) return;
    if (from > totalNodes || to > totalNodes) return;
    const part = PARTITION_INDEX[partName];
    const key = (to * 8) + part;
    const m = rawAdj[from];
    const prev = m.get(key);
    if (prev) {
      prev.weight += weight;
      prev.flags |= epistemicFlags;
    } else {
      m.set(key, { to, part, weight, flags: epistemicFlags });
    }
  };
  const addBiEdge = (u, v, partName, wFwd, wRev = wFwd, flags = 1) => {
    addEdge(u, v, partName, wFwd, flags);
    addEdge(v, u, partName, wRev, flags);
  };

  // Partition 0: OCC (verse <-> content Strong's / gated sense / concept)
  for (const [vid, v] of versesByVid.entries()) {
    const tokCounts = new Map();
    const senseCounts = new Map();
    const verseConcepts = new Set();
    for (const t of v.tokens || []) {
      const bs = normStrongs4(t.s);
      if (bs && !t.is_func && !grammaticalMarkers.has(bs)) {
        tokCounts.set(bs, (tokCounts.get(bs) || 0) + 1);
      }
      if (t.sense_id) {
        const sm = /^sense:([^:]+):(.+)$/.exec(t.sense_id);
        if (sm && sm[2] !== 'primary' && sm[2] !== 'unified') {
          const sk = `${normStrongs4(sm[1])}#${sm[2]}`;
          senseCounts.set(sk, (senseCounts.get(sk) || 0) + 1);
        }
      }
      if (t.concept_id && !t.is_func) verseConcepts.add(`c:${t.concept_id}`);
    }

    for (const [bs, cnt] of tokCounts.entries()) {
      const nId = keyToId.get(bs);
      if (!nId) continue;
      const df = postings.get(bs)?.vids.size || 1;
      const idf = Math.log2(NUM_VERSES / df);
      const isSplitPoly = polysemeStrongs.has(bs) && [...senseCounts.keys()].some(sk => sk.startsWith(bs + '#'));
      const w = (1 + 0.18 * Math.min(idf, 12)) * cnt * (isSplitPoly ? 0.35 : 1.0);
      addBiEdge(vid, nId, 'OCC', w, w, 1);
    }
    for (const [sk, cnt] of senseCounts.entries()) {
      const nId = keyToId.get(sk);
      if (!nId) continue;
      const df = postings.get(sk)?.vids.size || 1;
      const idf = Math.log2(NUM_VERSES / df);
      const w = (1.5 + 0.22 * Math.min(idf, 12)) * cnt;
      addBiEdge(vid, nId, 'OCC', w, w, 1);
    }
    for (const cKey of verseConcepts) {
      const cId = keyToId.get(cKey);
      if (!cId) continue;
      const df = postings.get(cKey)?.vids.size || 1;
      const idf = Math.log2(NUM_VERSES / df);
      const w = 0.65 + 0.10 * Math.min(idf, 10);
      addBiEdge(vid, cId, 'OCC', w, w, 8);
    }
  }

  // Partition 1: XREF (verse <-> verse)
  for (const [vid, list] of fastXrefsByVid.entries()) {
    for (const item of list.slice(0, 24)) {
      const toVid = Number(item[0]);
      if (toVid >= 1 && toVid <= NUM_VERSES && toVid !== vid) {
        const rawScore = Number(item[6] || 40);
        const w = Math.max(0.4, Math.min(3.0, rawScore / 40));
        addBiEdge(vid, toVid, 'XREF', w, 0.7 * w, 1);
      }
    }
  }
  for (const [vid, groups] of bookXrefsByVid.entries()) {
    for (const grp of groups) {
      for (const t of grp.targets || []) {
        const toVid = Number(t.to_vid);
        if (toVid >= 1 && toVid <= NUM_VERSES && toVid !== vid) {
          addBiEdge(vid, toVid, 'XREF', 0.85, 0.60, 1);
        }
      }
    }
  }

  // Partition 2: LXX (Hxxxx <-> lxx:<lemma>, Gxxxx <-> lxx:<lemma>, lxx:<lemma> <-> vid)
  for (const [k, rec] of hToLxxCounts.entries()) {
    const [hBs, lxxKey] = k.split('\0');
    const hId = keyToId.get(hBs);
    const lId = keyToId.get(lxxKey);
    if (!hId || !lId) continue;
    const meanStab = rec.stabSum / Math.max(1, rec.count);
    const w = Math.min(8.0, Math.log1p(rec.count) * meanStab * 1.6);
    addBiEdge(hId, lId, 'LXX', w, w, 2);
  }
  for (const [gLem, gMap] of greekLemmaToStrongs.entries()) {
    const lId = keyToId.get(`lxx:${gLem}`);
    if (!lId) continue;
    for (const [gBs, cnt] of gMap.entries()) {
      const gId = keyToId.get(gBs);
      if (!gId) continue;
      const w = Math.min(8.0, 1.5 + Math.log1p(cnt) * 1.4);
      addBiEdge(gId, lId, 'LXX', w, w, 2);
    }
  }
  for (const lxxKey of lxxKeys) {
    const lId = keyToId.get(lxxKey);
    const rec = postings.get(lxxKey);
    if (!lId || !rec) continue;
    const df = rec.vids.size;
    if (df > 2500) continue; // skip Greek articles/conjunctions as hub links
    const idf = Math.log2(NUM_VERSES / df);
    const w = 0.8 + 0.14 * Math.min(idf, 12);
    for (const vid of rec.vids) {
      addBiEdge(lId, vid, 'LXX', w, w, 2);
    }
  }

  // Partition 3: LEX_SYN (sense <-> strongs, siblings, lexical & syntactic actant links)
  for (const sk of splitSenseKeys) {
    const sId = keyToId.get(sk);
    const bs = sk.split('#')[0];
    const bId = keyToId.get(bs);
    if (sId && bId) addBiEdge(sId, bId, 'LEX_SYN', 2.2, 1.0, 4);
  }
  for (const [bsRaw, prof] of Object.entries(lexicon.profiles || {})) {
    const u = keyToId.get(normStrongs4(bsRaw));
    if (!u) continue;
    for (const sib of prof.cross_bs_siblings || []) {
      const v = keyToId.get(normStrongs4(sib.bs));
      if (v) addBiEdge(u, v, 'LEX_SYN', 1.1, 1.1, 4);
    }
  }
  for (const [bs, fp] of rawFastProfiles.entries()) {
    const u = keyToId.get(bs);
    if (!u || grammaticalMarkers.has(bs)) continue;
    for (const lr of fp.lexical_relations || []) {
      const v = keyToId.get(normStrongs4(lr.target_strongs));
      if (v && !grammaticalMarkers.has(normStrongs4(lr.target_strongs))) {
        addBiEdge(u, v, 'LEX_SYN', 1.8, 1.8, 4);
      }
    }
    for (const gr of (fp.grammatical_relations || []).slice(0, 16)) {
      const tBs = normStrongs4(gr.related_strongs);
      const v = keyToId.get(tBs);
      if (v && !grammaticalMarkers.has(tBs)) {
        const w = Math.min(3.0, 0.7 + 0.4 * Math.log1p(gr.independent_witness_count || gr.occurrences || 1));
        addBiEdge(u, v, 'LEX_SYN', w, w * 0.8, 4);
      }
    }
  }
  for (const v of versesByVid.values()) {
    for (const cl of v.clauses || []) {
      const predBs = normStrongs4(cl.predicate?.s);
      const pId = keyToId.get(predBs);
      if (!pId || grammaticalMarkers.has(predBs)) continue;
      for (const arg of [...(cl.subjects || []), ...(cl.objects || [])]) {
        const aBs = normStrongs4(arg);
        const aId = keyToId.get(aBs);
        if (aId && !grammaticalMarkers.has(aBs)) {
          addBiEdge(pId, aId, 'LEX_SYN', 0.45, 0.45, 4);
        }
      }
    }
  }

  // Partition 4: WP (onomastic valence, talion, r13_wordplay, r13_motifs, self-interpretations)
  for (const oh of rhetoricIdx.onomastic_valence_hits || []) {
    const u = keyToId.get(normStrongs4(oh.proper_strongs));
    const v = keyToId.get(normStrongs4(oh.target_strongs));
    if (u && v) {
      const w = Math.max(1.5, 3.2 * (oh.score || 0.85));
      addBiEdge(u, v, 'WP', w, w, 4);
    }
  }
  for (const th of rhetoricIdx.syntactic_talion_hits || []) {
    const u = keyToId.get(normStrongs4(th.strongsA));
    const v = keyToId.get(normStrongs4(th.strongsB));
    const w = Math.max(1.0, 2.0 * (th.score || 0.8));
    if (u && v) addBiEdge(u, v, 'WP', w, w, 4);
    if (u && th.vid >= 1 && th.vid <= NUM_VERSES) addBiEdge(u, th.vid, 'WP', 1.4, 1.4, 4);
  }
  for (const [bs, fp] of rawFastProfiles.entries()) {
    const u = keyToId.get(bs);
    if (!u || grammaticalMarkers.has(bs)) continue;
    for (const wp of fp.r13_wordplay || []) {
      const tBs = normStrongs4(wp.target_bs);
      const v = keyToId.get(tBs);
      if (v && !grammaticalMarkers.has(tBs)) {
        const mult = wp.proven_common_root || wp.has_explicit_cue ? 2.8 : 1.4;
        const w = Math.max(0.8, mult * (wp.score || 0.7));
        addBiEdge(u, v, 'WP', w, w, 4);
      }
    }
    for (const col of (fp.r13_colloc || []).slice(0, 12)) {
      const tBs = normStrongs4(col[0]);
      const v = keyToId.get(tBs);
      if (v && !grammaticalMarkers.has(tBs)) {
        const w = Math.min(2.2, 0.6 + 0.3 * Math.log1p(col[1] || 1));
        addBiEdge(u, v, 'WP', w, w, 4);
      }
    }
  }
  for (const m of Object.values(r13Motifs || {})) {
    for (const e of m.edges || []) {
      const u = keyToId.get(normStrongs4(e.from_bs));
      const v = keyToId.get(normStrongs4(e.to_bs));
      if (u && v) addBiEdge(u, v, 'WP', Math.max(1.0, e.weight || 1.2), Math.max(1.0, e.weight || 1.2), 4);
    }
  }
  for (const interp of explicitDoc.r13_self_interpretations || []) {
    for (const sRaw of interp.symbol_strongs || []) {
      const u = keyToId.get(normStrongs4(sRaw));
      if (!u) continue;
      for (const rRaw of interp.referent_strongs || []) {
        const v = keyToId.get(normStrongs4(rRaw));
        if (v) addBiEdge(u, v, 'WP', 2.8, 2.8, 1);
      }
    }
  }

  // Partition 5: CONCEPT_PROC (C_XL concept classes, material groups, physical processes)
  for (const [cid, cInfo] of conceptMeta.entries()) {
    const cNode = keyToId.get(`c:${cid}`);
    if (!cNode) continue;
    for (const bs of cInfo.strongs) {
      const sNode = keyToId.get(bs);
      if (sNode && !grammaticalMarkers.has(bs)) {
        addBiEdge(cNode, sNode, 'CONCEPT_PROC', 1.6, 1.6, 8);
      }
    }
  }
  for (const cidList of Object.values(ontology.material_groups || {})) {
    const nodes = cidList.map(cid => keyToId.get(`c:${cid}`)).filter(Boolean);
    for (let i = 0; i < nodes.length; i++) {
      // Link each concept to up to 10 peers in the same material group
      for (let step = 1; step <= Math.min(10, nodes.length - 1); step++) {
        const j = (i + step) % nodes.length;
        addBiEdge(nodes[i], nodes[j], 'CONCEPT_PROC', 0.8, 0.8, 8);
      }
    }
  }
  const procBuckets = new Map();
  for (const [bs, props] of bsPhysicalProps.entries()) {
    const tag = props.process || props.material_role || props.apparatus;
    if (!tag) continue;
    if (!procBuckets.has(tag)) procBuckets.set(tag, []);
    const nId = keyToId.get(bs);
    if (nId) procBuckets.get(tag).push(nId);
  }
  for (const nList of procBuckets.values()) {
    for (let i = 0; i < nList.length; i++) {
      for (let j = i + 1; j < nList.length; j++) {
        addBiEdge(nList[i], nList[j], 'CONCEPT_PROC', 1.5, 1.5, 8);
      }
    }
  }

  // Apply Conductance Degree Weighting (beta=0.40, kappa=3) + Normalize + Cap CONCEPT_PROC <= 0.06
  const deg = new Int32Array(totalNodes + 1);
  for (let u = 1; u <= totalNodes; u++) deg[u] = rawAdj[u].size;

  const csrEdgesByNode = new Array(totalNodes + 1);
  totalCsrEdges = 0;
  maxConceptProcMassObserved = 0;

  for (let u = 1; u <= totalNodes; u++) {
    const m = rawAdj[u];
    if (m.size === 0) {
      csrEdgesByNode[u] = [];
      continue;
    }

    // Group by partition, compute w_cond = w_raw / (deg(v) + kappa)^beta, cap top-384 per partition
    const byPart = [[], [], [], [], [], []];
    for (const e of m.values()) {
      const wCond = e.weight / Math.pow(deg[e.to] + CONDUCTANCE_KAPPA, CONDUCTANCE_BETA);
      byPart[e.part].push({ to: e.to, part: e.part, flags: e.flags, w: wCond });
    }

    const keptOther = [];
    let sumOther = 0;
    for (let p = 0; p < 5; p++) {
      if (byPart[p].length > 384) {
        byPart[p].sort((a, b) => b.w - a.w);
        byPart[p].length = 384;
      }
      for (const e of byPart[p]) {
        sumOther += e.w;
        keptOther.push(e);
      }
    }

    const keptCP = byPart[5];
    if (keptCP.length > 256) {
      keptCP.sort((a, b) => b.w - a.w);
      keptCP.length = 256;
    }
    let sumCP = 0;
    for (const e of keptCP) sumCP += e.w;

    const finalEdges = [];
    if (sumOther > 0 && sumCP > 0) {
      const rawFracCP = sumCP / (sumOther + sumCP);
      const targetFracCP = Math.min(rawFracCP, 0.058); // headroom for u16 rounding so strictly <= 0.06
      const scaleCP = targetFracCP / sumCP;
      const scaleOther = (1 - targetFracCP) / sumOther;
      for (const e of keptOther) finalEdges.push({ ...e, w: e.w * scaleOther });
      for (const e of keptCP) finalEdges.push({ ...e, w: e.w * scaleCP });
    } else if (sumOther > 0) {
      const scaleOther = 1 / sumOther;
      for (const e of keptOther) finalEdges.push({ ...e, w: e.w * scaleOther });
    } else if (sumCP > 0) {
      const scaleCP = 0.058 / sumCP;
      for (const e of keptCP) finalEdges.push({ ...e, w: e.w * scaleCP });
    }

    // Quantize weightQ16 and enforce post-quantization CONCEPT_PROC <= 0.06 invariant
    let cpQ16Sum = 0;
    const cpIndices = [];
    for (let i = 0; i < finalEdges.length; i++) {
      const e = finalEdges[i];
      const q = Math.max(1, Math.min(65535, Math.round(e.w * 65535)));
      e.wQ16 = q;
      if (e.part === 5) {
        cpQ16Sum += q;
        cpIndices.push(i);
      }
    }
    const maxAllowedCpQ16 = Math.floor(CONCEPT_PROC_MAX_MASS * 65535);
    if (cpQ16Sum > maxAllowedCpQ16 && cpIndices.length > 0) {
      cpIndices.sort((a, b) => finalEdges[b].wQ16 - finalEdges[a].wQ16);
      let idx = 0;
      while (cpQ16Sum > maxAllowedCpQ16) {
        const ei = cpIndices[idx % cpIndices.length];
        if (finalEdges[ei].wQ16 > 1) {
          finalEdges[ei].wQ16--;
          cpQ16Sum--;
        } else {
          // Drop tiniest CP edge if all are at min quantum 1 and count > maxAllowedCpQ16
          finalEdges[ei].wQ16 = 0;
          cpQ16Sum--;
        }
        idx++;
        if (idx > cpIndices.length * 4 && cpQ16Sum > maxAllowedCpQ16) break;
      }
    }

    const validEdges = finalEdges.filter(e => e.wQ16 > 0);
    validEdges.sort((a, b) => a.to - b.to || a.part - b.part);
    let cpMass = 0;
    for (const e of validEdges) if (e.part === 5) cpMass += e.wQ16 / 65535;
    if (cpMass > maxConceptProcMassObserved) maxConceptProcMassObserved = cpMass;

    csrEdgesByNode[u] = validEdges;
    totalCsrEdges += validEdges.length;
    rawAdj[u] = null; // free memory incrementally
  }

  console.log(
    `Conductance CSR built: ${totalNodes} nodes, ${totalCsrEdges} edges, max CONCEPT_PROC mass=${maxConceptProcMassObserved.toFixed(5)} (${Math.round(performance.now() - t0)}ms).`
  );

  // Write 16 Typed CSR binary parts (part = nodeId & 15)
  csrManifestFiles = [];
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

    csrManifestFiles.push(writeDual(`graph/typed-csr/part-${String(p).padStart(2, '0')}.bin`, buf));
  }

  // =========================================================================
  // 4. Offline Forward-Push PPR (alpha=0.20, eps=2e-5) -> ppr-top64/shard-00..31.bin
  // =========================================================================
  console.log('Running offline Forward-Push PPR across all nodes...');
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
    csrEdgesByNode[u] = null; // free JS edge arrays before PPR
  }

  const pprArr = new Float64Array(totalNodes + 1);
  const resArr = new Float64Array(totalNodes + 1);
  const maskArr = new Uint8Array(totalNodes + 1);
  const inQueue = new Uint8Array(totalNodes + 1);
  const seenTouched = new Uint8Array(totalNodes + 1);
  const touched = new Int32Array(totalNodes + 1);
  const queueLen = totalNodes + 8;
  const queue = new Int32Array(queueLen);

  // Scratch min-heap of size 64 for allocation-free Top-64 extraction
  const heapTarget = new Int32Array(64);
  const heapProb = new Float64Array(64);
  const heapMask = new Uint8Array(64);
  const orderIdx = new Int32Array(64);

  const pprBuckets = Array.from({ length: NUM_PPR_SHARDS }, () => []);
  pprSeedsCount = 0;
  totalPprEntries = 0;
  let totalEdgePushes = 0;

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
      const thresh = PPR_EPS * nodeDeg[u];
      if (r < thresh) continue;

      resArr[u] = 0;
      pprArr[u] += PPR_ALPHA * r;
      const pushMass = (1 - PPR_ALPHA) * r;
      const uMask = maskArr[u];

      const eStart = csrOffsets[u];
      const eEnd = csrOffsets[u + 1];
      totalEdgePushes += eEnd - eStart;
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

    // Flush unpushed residual lower-bound mass & extract Top-64 via min-heap (zero JS object allocs)
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
      // Insertion sort descending on <= 64 indices
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

    if (seed % 10000 === 0) {
      console.log(`  PPR progress: ${seed}/${totalNodes} seeds (${Math.round(performance.now() - tPpr)}ms, edgePushes=${totalEdgePushes})`);
    }
  }

  console.log(`Forward-Push PPR finished in ${Math.round(performance.now() - tPpr)}ms: ${pprSeedsCount} seeds, ${totalPprEntries} Top-64 entries.`);

  pprManifestFiles = [];
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

    pprManifestFiles.push(writeDual(`graph/ppr-top64/shard-${String(s).padStart(2, '0')}.bin`, buf));
  }
  } // end if (!canIncremental)

  // =========================================================================
  // 5. Flat Enriched Packs: v3/profiles/ (48 shards) & v3/verses/ (48 chunks)
  // =========================================================================
  console.log('Building flat enriched v3/profiles/ and v3/verses/...');
  const profileBuckets = Array.from({ length: NUM_PROFILE_SHARDS }, () => ({}));
  const allProfileKeys = new Set([...Object.keys(lexicon.profiles || {}), ...rawFastProfiles.keys()]);

  for (const bsRaw of [...allProfileKeys].sort()) {
    const bs = normStrongs4(bsRaw);
    if (!bs) continue;
    const lexP = lexicon.profiles?.[bs] || {};
    const fp = rawFastProfiles.get(bs) || {};

    const cids = bsToConcepts.get(bs) ? [...bsToConcepts.get(bs)] : [];
    const concepts = cids.map(cid => conceptMeta.get(cid)).filter(Boolean);
    const phys = bsPhysicalProps.get(bs) || null;
    const senseGate = ontology.sense_gate_profiles?.[bs] || null;

    const lxxEqMap = hLxxEquivSummary.get(bs);
    const lxxEquivs = lxxEqMap
      ? [...lxxEqMap.entries()]
          .map(([g_lemma, r]) => ({
            g_lemma,
            count: r.count,
            mean_stability: Number((r.stabSum / Math.max(1, r.count)).toFixed(3)),
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 12)
      : [];
    const lxxShifts = hLxxShiftsSummary.get(bs) || [];

    const motifsForBs = (r13MotifsByBs[bs] || []).slice(0, 16).map(mid => r13Motifs[mid] || { motif_id: mid });

    const slimGramRels = (fp.grammatical_relations || []).slice(0, 24).map(gr => ({
      predicate: gr.predicate,
      direction: gr.direction,
      related_strongs: normStrongs4(gr.related_strongs) || gr.related_strongs,
      related_script: gr.related_script,
      related_gloss: gr.related_gloss,
      occurrences: gr.occurrences,
      independent_witness_count: gr.independent_witness_count,
    }));

    const profileObj = {
      bs,
      lk: lexP.lk || fp.lk || `lemma:${bs}`,
      lang: lexP.lang || fp.lang || (bs.startsWith('G') ? 'grc' : 'hbo'),
      sc: lexP.sc || fp.sc || '',
      tr: lexP.tr || fp.tr || '',
      gl: lexP.gl || fp.gl || '',
      top_verse_gloss: lexP.top_verse_gloss || '',
      pos: lexP.pos || fp.pos || '',
      entity_kind: lexP.entity_kind || fp.entity_kind || 'common',
      canonical_df: lexP.canonical_df ?? fp.total_verses ?? 0,
      idf: lexP.idf ?? 0,
      is_grammatical_marker: Boolean(lexP.is_grammatical_marker),
      headword_rescued: Boolean(lexP.headword_rescued),
      senses: lexP.senses || fp.senses || [],
      cross_bs_siblings: lexP.cross_bs_siblings || [],
      concepts,
      ...(phys ? { physical_props: phys } : {}),
      ...(senseGate ? { sense_gate: senseGate } : {}),
      ...(lxxEquivs.length ? { lxx_equivalents: lxxEquivs } : {}),
      ...(lxxShifts.length ? { lxx_shifts: lxxShifts } : {}),
      lexical_relations: fp.lexical_relations || [],
      grammatical_relations: slimGramRels,
      lxx_relations: (fp.lxx_relations || []).filter(r => !isLxxFunctionEquivalent(r?.target_strongs, r?.script)),
      r13_wordplay: (fp.r13_wordplay || []).slice(0, 24).map(e => {
        if (e?.evidence_type === 'attested_textual_wordplay' && !isVerifiedAttestedWordplayEdge(e, { bs, sc: lexP.sc || fp.sc || '', gl: lexP.gl || fp.gl || '' })) {
          return {
            ...e,
            evidence_type: 'proximate_wordplay_candidate',
            epistemic_class: 'orthographic_similarity_only',
            has_explicit_cue: false,
          };
        }
        return e;
      }),
      r13_colloc: (fp.r13_colloc || []).slice(0, 24),
      ...(motifsForBs.length ? { r13_motifs: motifsForBs } : {}),
      ...(fp.forms ? { forms: fp.forms.slice(0, 24) } : {}),
      all_vids: postings.get(bs) ? [...postings.get(bs).vids].sort((a, b) => a - b) : (fp.all_vids || []),
    };

    const shardIdx = fnv1a32(bs) % NUM_PROFILE_SHARDS;
    profileBuckets[shardIdx][bs] = profileObj;
  }

  const profileManifestFiles = [];
  for (let s = 0; s < NUM_PROFILE_SHARDS; s++) {
    const payload = {
      schema_version: 3,
      shard: s,
      num_shards: NUM_PROFILE_SHARDS,
      shard_fn: 'fnv1a32_mod_48',
      profile_count: Object.keys(profileBuckets[s]).length,
      profiles: profileBuckets[s],
    };
    assertNoRestrictedKeys(payload, `profiles-${s}`);
    const gz = zlib.gzipSync(JSON.stringify(payload), { level: 6 });
    profileManifestFiles.push(
      writeDual(`profiles/shard-${String(s).padStart(2, '0')}.json.gz`, gz, MAX_FLAT_SHARD_BYTES)
    );
  }

  const verseBuckets = Array.from({ length: NUM_VERSE_CHUNKS }, () => ({}));
  const chunkSpan = Math.ceil(NUM_VERSES / NUM_VERSE_CHUNKS);
  for (let vid = 1; vid <= NUM_VERSES; vid++) {
    const rv = versesByVid.get(vid);
    if (!rv) continue;
    const toks = (rv.tokens || []).map(t => ({
      ...t,
      s: normStrongs4(t.s) || t.s,
    }));
    const concepts = [...new Set(toks.map(t => t.concept_id).filter(Boolean))];
    const xrefs = (fastXrefsByVid.get(vid) || []).slice(0, 16).map(x => ({
      to_vid: x[0],
      to_ref: x[1],
      phrase: x[2],
      score: x[6] ?? 0,
    }));
    const motifs = r13MotifsByVid[String(vid)] || [];

    const chunkIdx = Math.min(NUM_VERSE_CHUNKS - 1, Math.floor((vid - 1) / chunkSpan));
    verseBuckets[chunkIdx][vid] = {
      vid,
      book: rv.book,
      chapter: rv.chapter,
      verse: rv.verse,
      ref: rv.ref,
      ...(mtRefByVid.get(vid) ? { mt_ref: mtRefByVid.get(vid) } : {}),
      en: enByVid.get(vid) || '',
      toks,
      clauses: rv.clauses || [],
      concepts,
      ...(xrefs.length ? { xrefs } : {}),
      ...(motifs.length ? { r13_motifs: motifs } : {}),
    };
  }

  const verseManifestFiles = [];
  for (let c = 0; c < NUM_VERSE_CHUNKS; c++) {
    const payload = {
      schema_version: 3,
      chunk: c,
      num_chunks: NUM_VERSE_CHUNKS,
      chunk_span: chunkSpan,
      verse_count: Object.keys(verseBuckets[c]).length,
      verses: verseBuckets[c],
    };
    assertNoRestrictedKeys(payload, `verses-${c}`);
    const gz = zlib.gzipSync(JSON.stringify(payload), { level: 6 });
    verseManifestFiles.push(
      writeDual(`verses/chunk-${String(c).padStart(2, '0')}.json.gz`, gz, MAX_FLAT_SHARD_BYTES)
    );
  }

  // =========================================================================
  // 6. Inventory ALL files in staging-bundle/v3/ & Write v3/manifest.json
  // =========================================================================
  const allV3Files = [];
  const walkV3 = (dir, relBase = 'v3') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      const rel = `${relBase}/${e.name}`;
      if (e.isDirectory()) walkV3(full, rel);
      else if (rel !== 'v3/manifest.json') {
        const buf = fs.readFileSync(full);
        if (buf.byteLength >= MAX_FILE_BYTES) {
          throw new Error(`v3 file ${rel} exceeds 10 MiB (${buf.byteLength} bytes)`);
        }
        allV3Files.push({
          path: rel,
          bytes: buf.byteLength,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        });
      }
    }
  };
  walkV3(OUT_STAGING_V3);

  const maxFile = allV3Files.reduce((m, f) => (f.bytes > m.bytes ? f : m), { path: '', bytes: 0 });
  const totalBytes = allV3Files.reduce((s, f) => s + f.bytes, 0);

  const manifest = {
    schema_version: 3,
    generated_at: new Date().toISOString(),
    license: 'CC BY 4.0 (STEPBible-Data, MACULA, OSHB, OEWN 2025, OpenScriptorium lxx-morph) + CC0 1.0 (Wikidata) + MIT',
    license_audit: '0 restricted UBS keys',
    swete_included: false,
    bmw_index: bmwBuilt.stats,
    graph: {
      num_verses: NUM_VERSES,
      num_entities: numNonVerseNodes,
      total_nodes: totalNodes,
      partitions: GRAPH_PARTITIONS,
      total_csr_edges: totalCsrEdges,
      conductance_beta: CONDUCTANCE_BETA,
      conductance_kappa: CONDUCTANCE_KAPPA,
      concept_proc_max_mass: Number(maxConceptProcMassObserved.toFixed(6)),
      ppr_alpha: PPR_ALPHA,
      ppr_eps: PPR_EPS,
      ppr_seeds: pprSeedsCount,
      ppr_entries: totalPprEntries,
    },
    flat_packs: {
      profile_shards: NUM_PROFILE_SHARDS,
      profile_count: allProfileKeys.size,
      verse_chunks: NUM_VERSE_CHUNKS,
      verse_count: versesByVid.size,
    },
    file_count: allV3Files.length + 1,
    total_bytes: totalBytes,
    max_file: { path: maxFile.path, bytes: maxFile.bytes },
    files: allV3Files,
  };
  assertNoRestrictedKeys(manifest, 'manifest');
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2));
  for (const base of [OUT_BUILD_V3, OUT_STAGING_V3]) {
    fs.writeFileSync(path.join(base, 'manifest.json'), manifestBuf);
  }

  const elapsed = Math.round(performance.now() - t0);
  console.log(
    `Stage S3 complete in ${elapsed}ms: ${manifest.file_count} v3/ files, ` +
    `total ${(totalBytes / 1048576).toFixed(2)} MiB, max file ${maxFile.path} (${maxFile.bytes} B), ` +
    `BMW=${bmwMeta.bytes} B, nodes=${nodesMeta.bytes} B, CSR=${csrManifestFiles.length} parts, PPR=${pprManifestFiles.length} shards.`
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
