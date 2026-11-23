/**
 * Step 1: CPU-safe R12 asset packer for .artifacts-r12/staging-bundle.
 *
 * Repacks .artifacts-r12/staging-bundle/v2/relationships/r11-v1.0/r10/ in place
 * without adding any new files, deleting existing R3-R11 files (including
 * packed-discovery-0..7.bin, lemma-lookup/*, lemma-profiles/*, orthographic/*,
 * r12-pilot.json.gz), or altering discovery outputs/rankings.
 *
 * Idempotent: supports reading both original `r10-packed-1` and already-repacked
 * `r10-b64gz-1` / `r10-book-index-1` / `r10-lazy-motifs-1` layouts.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { computeBucketHex, fnv1a64Hex } from '../src/relationships/adjacency-loader.ts';
import { buildCorpusWordplayIndex } from '../src/relationships/wordplay-engine.ts';
import { computeHighPmiCollocations, mineMultiPassageMotifs } from '../src/relationships/motif-discovery.ts';
import { compareStructuredRoleFrames, extractScripturalInterpretations } from '../src/relationships/symbolic-patterns.ts';

const args = process.argv.slice(2);
const versesOnly = args.includes('--verses-only');
const positionalArg = args.find((a) => !a.startsWith('--'));
const root = path.resolve(positionalArg || '.artifacts-r12/staging-bundle');
assert.ok(root.toLowerCase().includes('staging'), `Staging bundle required, got: ${root}`);

const r10Dir = path.join(root, 'v2/relationships/r11-v1.0/r10');
assert.ok(fs.existsSync(r10Dir), `Missing R10 directory: ${r10Dir}`);

const backupDir = path.resolve('.artifacts-r12/rollback-r12-discovery-1');
fs.mkdirSync(backupDir, { recursive: true });

const readGzJson = (filePath) => JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)));
const decodeB64Gz = (b64) => JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')));
const encodeB64Gz = (obj) => zlib.gzipSync(JSON.stringify(obj), { level: 9 }).toString('base64');

function readStaticTable(tableName) {
  const tblDir = path.resolve('.artifacts/static-corpus/tables', tableName);
  if (!fs.existsSync(tblDir)) return [];
  const rows = [];
  for (const f of fs.readdirSync(tblDir).sort()) {
    if (!f.includes('.jsonl')) continue;
    const rawBuf = fs.readFileSync(path.join(tblDir, f));
    const txt = (rawBuf[0] === 0x1f && rawBuf[1] === 0x8b ? zlib.gunzipSync(rawBuf) : rawBuf).toString('utf8');
    for (const line of txt.split('\n')) {
      if (line.trim()) rows.push(JSON.parse(line));
    }
  }
  return rows;
}

function padStrongsBase(raw) {
  const m = /^([HG])0*(\d+)[A-Z]*$/i.exec(String(raw || '').trim());
  return m ? `${m[1].toUpperCase()}${m[2].padStart(4, '0')}` : '';
}

function writeGzJsonAtomic(filePath, data, level = 1) {
  const raw = Buffer.from(JSON.stringify(data));
  const gz = zlib.gzipSync(raw, { level });
  const tmp = `${filePath}.r12-tmp`;
  fs.writeFileSync(tmp, gz);
  fs.renameSync(tmp, filePath);
  return { rawBytes: raw.length, gzBytes: gz.length };
}

const packedCache = new Map();
function decodePackedRecord([blob, start, length]) {
  const blobPath = path.join(r10Dir, blob);
  let buf = packedCache.get(blobPath);
  if (!buf) {
    buf = fs.readFileSync(blobPath);
    packedCache.set(blobPath, buf);
  }
  const slice = buf.subarray(start, start + length);
  const decoded = slice[0] === 0x1f && slice[1] === 0x8b ? zlib.gunzipSync(slice) : slice;
  return JSON.parse(decoded);
}

// 1. Ensure rollback backups exist for the 3 small metadata files (never overwrite existing backups)
for (const name of ['fast-manifest.json.gz', 'explicit-and-typology.json.gz', 'motifs-and-patterns.json.gz']) {
  const src = path.join(r10Dir, name);
  const dst = path.join(backupDir, name);
  assert.ok(fs.existsSync(src), `Missing source metadata file: ${src}`);
  if (!fs.existsSync(dst)) {
    const parsed = readGzJson(src);
    if (name === 'fast-manifest.json.gz') {
      assert.ok(!parsed.direct_b64gz, `${src} is already repacked and backup ${dst} is missing`);
    } else if (name === 'motifs-and-patterns.json.gz') {
      assert.notEqual(parsed.schema_version, 'r10-lazy-motifs-1', `${src} is already repacked and backup ${dst} is missing`);
    } else if (name === 'explicit-and-typology.json.gz') {
      assert.ok((parsed.records || []).length > 24, `${src} appears already filtered and backup ${dst} is missing`);
    }
    fs.copyFileSync(src, dst);
    console.log(`Backed up ${name} -> ${dst}`);
  }
}

// 2. Build full in-memory maps first
const tStart = Date.now();
console.log('Loading fast-verses...');
const verseMap = new Map();
const verseDir = path.join(r10Dir, 'fast-verses');
const verseFiles = fs.readdirSync(verseDir).filter((f) => f.endsWith('.json.gz')).sort();
assert.equal(verseFiles.length, 488, `Expected 488 fast-verses chunks, found ${verseFiles.length}`);
for (const f of verseFiles) {
  const d = readGzJson(path.join(verseDir, f));
  if (d.schema_version === 'r10-packed-1') {
    for (const [vidStr, ptr] of Object.entries(d.entries || {})) {
      verseMap.set(Number(vidStr), decodePackedRecord(ptr));
    }
  } else if (d.schema_version === 'r10-b64gz-1') {
    for (const [vidStr, b64] of Object.entries(d.verses || {})) {
      verseMap.set(Number(vidStr), decodeB64Gz(b64));
    }
  } else {
    for (const [vidStr, v] of Object.entries(d.verses || {})) {
      verseMap.set(Number(vidStr), v);
    }
  }
}
assert.equal(verseMap.size, 31203, `Expected 31203 verses in verseMap, got ${verseMap.size}`);
console.log(`Loaded ${verseMap.size} verses (${Date.now() - tStart} ms).`);

const vidByBookChVs = new Map();
for (const [vid, v] of verseMap) {
  vidByBookChVs.set(`${v.book}:${v.chapter}:${v.verse}`, vid);
}

// Reconcile fast-verses tokens against canonical r8-v1.2/chapter-lite (E07 canonical identity & stem lemma_keys)
const verseStemLemmaKeys = new Map(); // vid -> Map<baseStrongs, Set<lowerLemmaKey>>
const r8Dir = path.join(root, 'v2/relationships/r8-v1.2');
const r8ChapterLiteDir = path.join(r8Dir, 'chapter-lite');
const packedChCache = new Map();
const readPackedCh = ([blob, start, len]) => {
  const bp = path.join(r8Dir, blob);
  let buf = packedChCache.get(bp);
  if (!buf) { buf = fs.readFileSync(bp); packedChCache.set(bp, buf); }
  const slice = buf.subarray(start, start + len);
  const raw = slice[0] === 0x1f && slice[1] === 0x8b ? zlib.gunzipSync(slice) : slice;
  return JSON.parse(raw);
};
let reconciledTokenCount = 0;
if (fs.existsSync(r8ChapterLiteDir)) {
  for (const sf of fs.readdirSync(r8ChapterLiteDir).filter((x) => x.endsWith('.json.gz')).sort()) {
    const shard = readGzJson(path.join(r8ChapterLiteDir, sf));
    const entryPairs = shard.entries ? Object.entries(shard.entries).map(([k, ptr]) => [k, readPackedCh(ptr)]) : [];
    for (const [chKey, chData] of entryPairs) {
      const [bkStr, chStr] = chKey.split(':');
      for (const [vsStr, vObj] of Object.entries(chData || {})) {
        const vid = vidByBookChVs.get(`${bkStr}:${chStr}:${vsStr}`);
        if (!vid || !Array.isArray(vObj?.t)) continue;
        let m = verseStemLemmaKeys.get(vid);
        if (!m) { m = new Map(); verseStemLemmaKeys.set(vid, m); }
        const vEntry = verseMap.get(vid);
        const tokByWn = new Map();
        for (const t of vEntry?.toks || []) {
          if (t?.wn != null) tokByWn.set(Number(t.wn), t);
        }
        for (const row of vObj.t) {
          const wn = Number(row?.[0]);
          const wid = Number(row?.[1]);
          const bs = padStrongsBase(row?.[3]);
          if (!bs) continue;
          const morphArr = Array.isArray(row?.[4]) ? row[4] : [];
          let stemLk = '';
          for (const part of morphArr) {
            if (!Array.isArray(part) || part.length < 2) continue;
            const role = String(part[0] || '');
            const lk = String(part[1] || '').toLowerCase();
            if (!lk || /^lemma:h90/.test(lk)) continue;
            if (role === 'stem' || role === '' || morphArr.length === 1) {
              if (!stemLk) stemLk = String(part[1] || '');
              let s = m.get(bs); if (!s) { s = new Set(); m.set(bs, s); }
              s.add(lk);
            }
          }
          const tok = tokByWn.get(wn);
          if (tok) {
            if (Number.isFinite(wid) && wid > 0) tok.wid = wid;
            if (stemLk) tok.lk = stemLk;
            const prevBs = padStrongsBase(tok.s);
            const allSet = new Set(Array.isArray(tok.all_s) ? tok.all_s.map(padStrongsBase).filter(Boolean) : []);
            if (prevBs) allSet.add(prevBs);
            allSet.add(bs);
            if (allSet.size > 1 || Array.isArray(tok.all_s)) {
              tok.all_s = [...allSet];
            }
            if (prevBs !== bs) {
              tok.s = bs;
              tok._reconciledBs = bs;
              reconciledTokenCount++;
            }
          }
        }
      }
    }
  }
}
packedChCache.clear();
console.log(`Loaded chapter-lite stem lemma_keys for ${verseStemLemmaKeys.size} verses (reconciled ${reconciledTokenCount} canonical token Strong's).`);

const orthMap = new Map();
const pilot = readGzJson(path.join(r10Dir, 'r12-pilot.json.gz'));
assert.ok((pilot.pilot_anchors?.length || 0) >= 48, `Expected >= 48 pilot_anchors`);
assert.equal(Object.keys(pilot.anchors || {}).length, pilot.pilot_anchors.length, `Expected all pilot_anchors in pilot.anchors`);

const lemmaPosByKey = new Map();
for (const l of readStaticTable('lemmas')) {
  if (l?.lemma_key) lemmaPosByKey.set(String(l.lemma_key).toLowerCase(), String(l.primary_pos || ''));
}

let enrichedCount = 0;
let orthAttachedCount = 0;
let pilotAttachedCount = 0;
let r13SelfInterpretations = [];
let minedMotifsRes = { motifs: [], motifIdsByBs: new Map(), motifIdsByVid: new Map() };
let r13WordplayCount = 0;
let r13CollocCount = 0;
const baseProfByBs = new Map();
const fastProfilesDir = path.join(r10Dir, 'fast-profiles');
let maxFastProfileOuterBytes = 0;
let maxFastProfileRawBytes = 0;
let maxFastProfileShard = '';
let totalSubBuckets = 0;
let addedSynonymKeys = 0;
let addedSynonymEntries = 0;
let lookupCount = 0;

if (versesOnly) {
  console.log('--verses-only: loading base profiles from 64 lemma-profiles shards (skipping fast-profiles rebuild)...');
  const lemmaProfDir = path.join(r10Dir, 'lemma-profiles');
  for (const f of fs.readdirSync(lemmaProfDir).filter((x) => x.endsWith('.json.gz')).sort()) {
    const d = readGzJson(path.join(lemmaProfDir, f));
    const entries = d.schema_version === 'r10-packed-1'
      ? Object.entries(d.entries || {}).map(([k, ptr]) => [k, decodePackedRecord(ptr)])
      : Object.entries(d.entries || {});
    for (const [key, prof] of entries) {
      baseProfByBs.set(key, prof);
    }
  }
  assert.equal(baseProfByBs.size, 19566, `Expected 19566 base profiles, got ${baseProfByBs.size}`);
  for (const v of verseMap.values()) {
    for (const tok of v.toks || []) {
      if (tok?._reconciledBs) {
        const canonSc = baseProfByBs.get(tok._reconciledBs)?.sc;
        if (canonSc) tok.lm = String(canonSc).split(/[,;/]/)[0].trim() || tok.lm;
        delete tok._reconciledBs;
      }
    }
  }
} else {
console.log('Loading orthographic shards...');
const orthDir = path.join(r10Dir, 'orthographic');
const orthFiles = fs.readdirSync(orthDir).filter((f) => f.endsWith('.json.gz')).sort();
assert.equal(orthFiles.length, 64, `Expected 64 orthographic shards, found ${orthFiles.length}`);
for (const f of orthFiles) {
  const d = readGzJson(path.join(orthDir, f));
  for (const [bs, entry] of Object.entries(d.entries || {})) {
    if (entry?.homographs?.length > 0) {
      orthMap.set(bs, entry);
    }
  }
}
console.log(`Loaded ${orthMap.size} orthographic entries with homographs.`);

console.log('Compacting r12-pilot.json.gz...');

function compactPilotAnchor(a) {
  return {
    bs: a.bs,
    lang: a.lang,
    sc: a.sc,
    tr: a.tr,
    gl: a.gl,
    total_verses: a.total_verses,
    multihop: {
      pruned_incoherent_count: a.multihop?.pruned_incoherent_count || 0,
      unreturned_destinations: a.multihop?.unreturned_destinations || 0,
      recommendations: (a.multihop?.recommendations || []).map((rec) => {
        const best = rec.best_path || {};
        return {
          evidence_id: rec.evidence_id,
          anchor_id: rec.anchor_id,
          target_id: rec.target_id,
          target_word: rec.target_word,
          score_version: rec.score_version,
          epistemic_layer: rec.epistemic_layer,
          evidence_status: rec.evidence_status,
          interest: rec.interest,
          mmr_score: rec.mmr_score,
          Q: rec.Q,
          K: rec.K,
          endpoint_coherence: rec.endpoint_coherence,
          endpoint_epistemic_status: rec.endpoint_epistemic_status,
          C: rec.C,
          D: rec.D,
          T: rec.T,
          hub_penalty: rec.hub_penalty,
          step_support_group_count: rec.step_support_group_count,
          endpoint_support_group_count: rec.endpoint_support_group_count,
          independent_group_count: rec.independent_group_count,
          independent_evidence_groups: rec.independent_evidence_groups,
          direct_endpoint_witnesses: rec.direct_endpoint_witnesses || [],
          endpoint_bridge_witnesses: rec.endpoint_bridge_witnesses || [],
          limitation: rec.limitation,
          best_path: {
            meaningful_hops: best.meaningful_hops,
            physical_hops: best.physical_hops,
            K: best.K,
            endpoint_coherence: best.endpoint_coherence,
            endpoint_epistemic_status: best.endpoint_epistemic_status,
            score_parts: best.score_parts,
            target_word: best.target_word,
            steps: (best.steps || []).map((s) => ({
              edge_id: s.edge_id,
              from_id: s.from_id,
              from_label: s.from_label,
              to_id: s.to_id,
              to_label: s.to_label,
              relation_type: s.relation_type,
              direction: s.direction,
              epistemic_layer: s.epistemic_layer,
              quality_weight: s.quality_weight,
              administrative: s.administrative,
              source_dataset: s.source_dataset,
              witness_refs: s.witness_refs,
              witness_passages: s.witness_passages,
            })),
          },
          alternative_paths: (rec.alternative_paths || []).slice(0, 3).map((ap) => ({
            path_id: ap.path_id,
            partial_interest: ap.partial_interest,
            K: ap.K,
            steps: (ap.steps || []).map((s) => ({
              edge_id: s.edge_id,
              from_id: s.from_id,
              from_label: s.from_label,
              to_id: s.to_id,
              to_label: s.to_label,
              relation_type: s.relation_type,
              epistemic_layer: s.epistemic_layer,
              quality_weight: s.quality_weight,
              witness_refs: s.witness_refs,
            })),
          })),
        };
      }),
    },
    property_bridges: a.property_bridges || [],
    structural_candidates: a.structural_candidates || [],
    orthographic_candidates: a.orthographic_candidates || [],
  };
}

// Mirror exact projection logic from src/relationships/r10-discovery.ts (lines 231-594)
// to assert 100% field parity before vs after compaction.
const TIER_BASE_SCORE = { 1: 950, 2: 860, 3: 760, 4: 650, 5: 520, 6: 380, 7: 240, 8: 140 };

function projectMultihop(anchorData, rec) {
  const best = rec.best_path || {};
  const steps = best.steps || [];
  const tWord = rec.target_word || best.target_word;
  const passages = [];
  const seenVid = new Set();
  for (const st of steps) {
    for (const p of st.witness_passages || []) {
      if (p?.ref && !seenVid.has(p.verse_id || 0)) {
        seenVid.add(p.verse_id || passages.length + 1);
        passages.push({
          verse_id: Number(p.verse_id || 0),
          ref: p.ref,
          mt_ref: p.mt_ref,
          book: Number(p.book || 1),
          chapter: Number(p.chapter || 1),
          verse: Number(p.verse || 1),
          testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
          snippet: p.snippet,
        });
      }
    }
  }
  const origWords = [
    { strongs: anchorData.bs, language: anchorData.lang || 'hbo', lemma_script: anchorData.sc, transliteration: anchorData.tr, gloss: anchorData.gl },
    ...(tWord ? [{ strongs: tWord.strongs, language: tWord.language || 'grc', lemma_script: tWord.script, transliteration: tWord.transliteration, gloss: tWord.gloss }] : []),
  ];
  const hops = best.meaningful_hops ?? steps.length;
  const chainStr = steps.map((s) => `${s.from_label} --[${s.relation_type}]--> ${s.to_label}`).join(' ; ');
  const isHypothesis = rec.epistemic_layer === 'HYPOTHESIS' || rec.evidence_status === 'MIXED_OR_EXPLORATORY';
  const tier = isHypothesis ? 5 : 3;
  const finalScore = Math.round(700 + (rec.interest || 0) * 260);
  const epistClass = isHypothesis ? 'candidate_literary_pattern' : 'documented_lexical_relationship';
  return {
    evidence_id: rec.evidence_id,
    predicate: 'multihop_proof_path',
    evidence_tier: tier,
    epistemic_class: epistClass,
    title: `R12 ${hops}-hop discovery: ${anchorData.sc} (${anchorData.bs}) → ${tWord ? `${tWord.script} ("${tWord.gloss}", ${tWord.strongs})` : rec.target_id}`,
    summary: `${hops}-hop source-backed discovery path (${rec.independent_group_count} independent biblical support group(s); interest=${rec.interest}, Q=${rec.Q}, C=${rec.C}, D=${rec.D}, T=${rec.T}): ${chainStr}`,
    source_node_id: rec.anchor_id,
    target_node_id: rec.target_id,
    passages: passages.slice(0, 6),
    original_words: origWords,
    matched_terms: [anchorData.gl, anchorData.bs, tWord?.gloss, tWord?.strongs].filter(Boolean),
    limitations: [rec.limitation || 'A multi-hop source path connects intermediate attested steps without proving endpoint semantic identity or authorial intent.'],
    provenance: {
      source_dataset: [...new Set(steps.map((s) => s.source_dataset).filter(Boolean))].join(' + ') || 'MACULA + STEPBible + CATSS/Swete',
      source_record_ids: (rec.independent_evidence_groups || []).slice(0, 8),
      license: 'CC BY 4.0',
      derivation_method: 'r12_offline_beam_proof_ranker_v1',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: Math.round((rec.D || 0) * 100),
      witness_bonus: Math.round((rec.C || 0) * 100),
      common_word_penalty: Math.round((rec.hub_penalty || 0) * 100),
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: finalScore,
    },
    r12_metadata: {
      score_version: rec.score_version || 'r12-ranker-v2',
      epistemic_layer: rec.epistemic_layer || 'LINGUISTIC',
      epistemic_status: rec.evidence_status === 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION'
        ? 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION'
        : 'EXPLORATORY',
      meaningful_hops: hops,
      physical_hops: best.physical_hops ?? steps.length,
      Q: rec.Q ?? 0,
      K: rec.K ?? best.K ?? rec.endpoint_coherence ?? 1,
      endpoint_coherence: rec.endpoint_coherence ?? rec.K ?? 1,
      endpoint_epistemic_status: rec.endpoint_epistemic_status,
      C: rec.C ?? 0,
      D: rec.D ?? 0,
      T: rec.T ?? 0,
      hub_penalty: rec.hub_penalty ?? 0,
      interest: rec.interest ?? 0,
      mmr_score: rec.mmr_score,
      step_support_group_count: rec.step_support_group_count ?? rec.independent_group_count ?? 0,
      endpoint_support_group_count: rec.endpoint_support_group_count ?? 0,
      direct_endpoint_witnesses: rec.direct_endpoint_witnesses || [],
      endpoint_bridge_witnesses: rec.endpoint_bridge_witnesses || [],
      independent_group_count: rec.independent_group_count ?? 0,
      independent_evidence_groups: rec.independent_evidence_groups || [],
      alternative_path_count: (rec.alternative_paths || []).length,
      steps: steps.map((s) => ({
        edge_id: s.edge_id,
        from_id: s.from_id,
        from_label: s.from_label,
        to_id: s.to_id,
        to_label: s.to_label,
        relation_type: s.relation_type,
        direction: s.direction,
        epistemic_layer: s.epistemic_layer,
        quality_weight: s.quality_weight,
        administrative: s.administrative,
        source_dataset: s.source_dataset,
        witness_refs: s.witness_refs,
      })),
      alternative_paths: (rec.alternative_paths || []).slice(0, 3).map((ap) => ({
        path_id: ap.path_id,
        partial_interest: ap.partial_interest,
        steps: (ap.steps || []).map((s) => ({
          edge_id: s.edge_id,
          from_id: s.from_id,
          from_label: s.from_label,
          to_id: s.to_id,
          to_label: s.to_label,
          relation_type: s.relation_type,
          epistemic_layer: s.epistemic_layer,
          quality_weight: s.quality_weight,
          witness_refs: s.witness_refs,
        })),
      })),
    },
  };
}

function projectPropertyBridge(anchorData, b) {
  const tWord = b.target_word;
  const topFeat = b.shared_features?.[0];
  const leftRef = topFeat?.left?.[0];
  const rightRef = topFeat?.right?.[0];
  const tier = 5;
  const finalScore = Math.round(680 + (b.score || 0) * 160);
  const origWords = [
    { strongs: anchorData.bs, language: anchorData.lang || 'hbo', lemma_script: anchorData.sc, transliteration: anchorData.tr, gloss: anchorData.gl },
    ...(tWord ? [{ strongs: tWord.strongs, language: tWord.language || 'grc', lemma_script: tWord.script, transliteration: tWord.transliteration, gloss: tWord.gloss }] : []),
  ];
  const sourceIds = [
    leftRef?.source_id,
    rightRef?.source_id,
    ...(b.shared_features || []).slice(0, 3).flatMap((sf) => [sf.left?.[0]?.source_id, sf.right?.[0]?.source_id]),
  ].filter(Boolean);
  return {
    evidence_id: b.evidence_id,
    predicate: 'shared_external_property',
    evidence_tier: tier,
    epistemic_class: 'external_world_bridge',
    title: `Physical/semantic bridge: ${anchorData.sc} (${anchorData.gl}) ↔ ${tWord ? `${tWord.script} ("${tWord.gloss}")` : b.target_id} via "${b.value_label}"`,
    summary: `External concept bridge (${b.mapping_status} mapping; ${leftRef?.provider || 'OEWN/Wikidata'}) linking ${anchorData.bs} (${b.left_mapping?.sense_gloss || anchorData.gl}) and ${tWord?.strongs || b.target_id} (${b.right_mapping?.sense_gloss || tWord?.gloss || ''}) via shared property ${b.property_key}=${b.value_label}. Independent biblical support=0 (exploratory hypothesis).`,
    source_node_id: b.anchor_id,
    target_node_id: b.target_id,
    passages: (b.passages || []).slice(0, 6).map((p) => ({
      verse_id: Number(p.verse_id || 0),
      ref: p.ref,
      mt_ref: p.mt_ref,
      book: Number(p.book || 1),
      chapter: Number(p.chapter || 1),
      verse: Number(p.verse || 1),
      testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
      snippet: p.snippet,
    })),
    original_words: origWords,
    matched_terms: [anchorData.gl, tWord?.gloss, b.value_label, anchorData.bs, tWord?.strongs].filter(Boolean),
    limitations: [
      b.limitation || 'Shared externally sourced physical/semantic properties are exploratory research leads, not biblical identifications or proof of authorial intent.',
      ...(b.mapping_status === 'candidate' ? ['Lexical-to-external synset/QID mapping is candidate-grade due to polysemy; context determines which biblical sense applies.'] : []),
    ],
    provenance: {
      source_dataset: [...new Set([leftRef?.provider, rightRef?.provider].filter(Boolean))].join(' + ') || 'OpenEnglishWordNet 2025 + Wikidata',
      source_record_ids: [...new Set(sourceIds)].slice(0, 8),
      license: [...new Set([leftRef?.license, rightRef?.license].filter(Boolean))].join(' ; ') || 'CC BY 4.0 / CC0 1.0',
      derivation_method: 'r12_external_property_bridge',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: Math.round((b.score || 0) * 160),
      witness_bonus: 0,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: finalScore,
    },
    r12_metadata: {
      score_version: 'r12-ranker-v1',
      epistemic_layer: 'EXTERNAL_WORLD',
      epistemic_status: 'EXPLORATORY',
      meaningful_hops: 2,
      physical_hops: 2,
      Q: b.score ?? 0.5,
      C: 0,
      D: Number((topFeat?.rarity ? Math.min(1, topFeat.rarity / 6) : 0.7).toFixed(4)),
      T: 0.25,
      hub_penalty: 0,
      interest: b.score ?? 0.5,
      independent_group_count: 0,
      independent_evidence_groups: [],
      alternative_path_count: Math.max(0, (b.shared_features?.length || 1) - 1),
      external_bridge: {
        property_key: b.property_key,
        value_id: b.value_id,
        value_label: b.value_label,
        bridge_kind: b.bridge_kind || 'shared_external_property',
        assertion_origin: b.assertion_origin || 'EXTERNAL_ASSERTION',
        left_sense_id: b.anchor_sense_id,
        right_sense_id: b.target_sense_id,
        mapping_status: b.mapping_status === 'verified' ? 'verified' : 'candidate',
        claim_status: b.claim_status === 'sourced' ? 'sourced' : 'candidate',
        independent_biblical_support: 0,
        left_mapping: b.left_mapping || null,
        right_mapping: b.right_mapping || null,
        shared_features: b.shared_features || [],
      },
    },
  };
}

function projectStructural(anchorData, s) {
  const tier = 6;
  const finalScore = Math.round(620 + (s.weighted_jaccard || 0) * 140);
  return {
    evidence_id: s.evidence_id,
    predicate: 'structural_scene_parallel',
    evidence_tier: tier,
    epistemic_class: 'candidate_literary_pattern',
    title: `Structural clause parallel: ${s.anchor_ref} ↔ ${s.candidate_ref} (${s.all_shared_feature_count} shared roles, J=${s.weighted_jaccard})`,
    summary: `Candidate R8 grammatical scene parallel around ${anchorData.sc} (${anchorData.bs}) comparing ${s.anchor_ref} and ${s.candidate_ref} across ${(s.distinctive_shared_features || []).map((f) => `${f.role}=${f.value}`).join(', ')}.`,
    source_node_id: s.anchor_scene_id,
    target_node_id: s.candidate_scene_id,
    passages: (s.passages || []).slice(0, 6).map((p) => ({
      verse_id: Number(p.verse_id || 0),
      ref: p.ref,
      mt_ref: p.mt_ref,
      book: Number(p.book || 1),
      chapter: Number(p.chapter || 1),
      verse: Number(p.verse || 1),
      testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
      snippet: p.snippet,
    })),
    original_words: [{ strongs: anchorData.bs, language: anchorData.lang || 'hbo', lemma_script: anchorData.sc, transliteration: anchorData.tr, gloss: anchorData.gl }],
    matched_terms: [anchorData.gl, anchorData.bs, s.anchor_ref, s.candidate_ref].filter(Boolean),
    limitations: [s.limitation || 'Shared structural clause roles are candidate parallels, not proof of authorial dependence.'],
    provenance: {
      source_dataset: 'MACULA Hebrew & Greek R8 Grammatical Frames',
      source_record_ids: [...(s.anchor_witness_ids || []), ...(s.candidate_witness_ids || [])].slice(0, 6),
      license: 'CC BY 4.0',
      derivation_method: 'r12_structural_role_weighted_jaccard',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: Math.round((s.weighted_jaccard || 0) * 140),
      witness_bonus: Math.min(30, (s.all_shared_feature_count || 0) * 8),
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 0,
      final_score: finalScore,
    },
    r12_metadata: {
      score_version: 'r12-ranker-v1',
      epistemic_layer: 'HYPOTHESIS',
      epistemic_status: 'EXPLORATORY',
      meaningful_hops: 2,
      physical_hops: 2,
      Q: s.weighted_jaccard ?? 0.5,
      C: 0.25,
      D: s.weighted_jaccard ?? 0.5,
      T: 0.25,
      hub_penalty: 0,
      interest: s.weighted_jaccard ?? 0.5,
      independent_group_count: 2,
      independent_evidence_groups: [...(s.anchor_witness_ids || []), ...(s.candidate_witness_ids || [])].slice(0, 4),
      alternative_path_count: 0,
      structural_match: {
        weighted_jaccard: s.weighted_jaccard,
        shared_feature_families: s.shared_feature_families || [],
        shared_features: s.distinctive_shared_features || [],
        anchor_witness_ids: s.anchor_witness_ids || [],
        candidate_witness_ids: s.candidate_witness_ids || [],
      },
    },
  };
}

function projectOrthographic(anchorData, o) {
  const tWord = o.target_word;
  const tier = 7;
  const finalScore = Math.round(480 + (o.score || 0) * 100);
  return {
    evidence_id: o.evidence_id,
    predicate: 'orthographic_overlap',
    evidence_tier: tier,
    epistemic_class: 'orthographic_similarity_only',
    title: `Orthographic similarity: ${o.anchor_original} (${anchorData.bs}) ↔ ${o.target_form} (${tWord?.strongs || o.target_id}, matched "${o.matched_normalized_text}")`,
    summary: `Unpointed/unaccented script similarity (${o.normalization}, score=${o.score}, shared segment "${o.matched_normalized_text}"). ${o.limitation}`,
    source_node_id: o.anchor_id,
    target_node_id: o.target_id,
    passages: (o.passages || []).slice(0, 4).map((p) => ({
      verse_id: Number(p.verse_id || 0),
      ref: p.ref,
      mt_ref: p.mt_ref,
      book: Number(p.book || 1),
      chapter: Number(p.chapter || 1),
      verse: Number(p.verse || 1),
      testament: Number(p.book || 1) <= 39 ? 'OT' : 'NT',
      snippet: p.snippet,
    })),
    original_words: [
      { strongs: anchorData.bs, language: anchorData.lang || 'hbo', lemma_script: anchorData.sc, transliteration: anchorData.tr, gloss: anchorData.gl },
      ...(tWord ? [{ strongs: tWord.strongs, language: tWord.language || 'hbo', lemma_script: tWord.script, transliteration: tWord.transliteration, gloss: tWord.gloss }] : []),
    ],
    matched_terms: [anchorData.gl, tWord?.gloss, o.matched_normalized_text].filter(Boolean),
    limitations: [o.limitation || 'Shared spelling does not establish root, etymology, meaning, or intentional wordplay.'],
    provenance: {
      source_dataset: 'STEPBible Canonical Lemma Script',
      source_record_ids: [anchorData.bs, tWord?.strongs].filter(Boolean),
      license: 'CC BY 4.0',
      derivation_method: 'r12_orthographic_bigram_containment',
    },
    score_components: {
      base_tier_score: TIER_BASE_SCORE[tier],
      specificity_bonus: Math.round((o.score || 0) * 100),
      witness_bonus: 0,
      common_word_penalty: 0,
      number_coincidence_penalty: 0,
      orthographic_penalty: 40,
      final_score: finalScore,
    },
    r12_metadata: {
      score_version: 'r12-ranker-v1',
      epistemic_layer: 'HYPOTHESIS',
      epistemic_status: 'EXPLORATORY',
      meaningful_hops: 1,
      physical_hops: 1,
      Q: o.score ?? 0.5,
      C: 0,
      D: o.score ?? 0.5,
      T: 0.25,
      hub_penalty: 0,
      interest: Number(((o.score || 0.5) * 0.5).toFixed(4)),
      raw_orthographic_score: o.raw_orthographic_score,
      cooccurrence_verses: o.cooccurrence_verses || 0,
      independent_group_count: 0,
      independent_evidence_groups: [],
      alternative_path_count: 0,
    },
  };
}

const compactedPilotMap = new Map();
let verifiedMultihop = 0;
let verifiedBridges = 0;
let verifiedStructural = 0;
let verifiedOrth = 0;
for (const bs of pilot.pilot_anchors) {
  const orig = pilot.anchors[bs];
  assert.ok(orig, `Missing pilot anchor data for ${bs}`);
  const compacted = JSON.parse(JSON.stringify(compactPilotAnchor(orig)));
  assert.equal(compacted.bs, orig.bs);
  assert.equal(compacted.lang, orig.lang);
  assert.equal(compacted.sc, orig.sc);
  assert.equal(compacted.tr, orig.tr);
  assert.equal(compacted.gl, orig.gl);
  assert.equal(compacted.total_verses, orig.total_verses);
  assert.equal(compacted.multihop.unreturned_destinations, orig.multihop?.unreturned_destinations || 0);

  const origRecs = orig.multihop?.recommendations || [];
  assert.ok(origRecs.length <= 24, `Expected <= 24 multihop recommendations for ${bs}, got ${origRecs.length}`);
  assert.equal(compacted.multihop.recommendations.length, origRecs.length);
  for (let i = 0; i < origRecs.length; i++) {
    assert.deepEqual(projectMultihop(compacted, compacted.multihop.recommendations[i]), projectMultihop(orig, origRecs[i]));
    verifiedMultihop++;
  }

  const origProps = orig.property_bridges || [];
  assert.equal(compacted.property_bridges.length, origProps.length);
  for (let i = 0; i < origProps.length; i++) {
    assert.deepEqual(projectPropertyBridge(compacted, compacted.property_bridges[i]), projectPropertyBridge(orig, origProps[i]));
    verifiedBridges++;
  }

  const origStructs = orig.structural_candidates || [];
  assert.equal(compacted.structural_candidates.length, origStructs.length);
  for (let i = 0; i < origStructs.length; i++) {
    assert.deepEqual(projectStructural(compacted, compacted.structural_candidates[i]), projectStructural(orig, origStructs[i]));
    verifiedStructural++;
  }

  const origOrths = orig.orthographic_candidates || [];
  assert.equal(compacted.orthographic_candidates.length, origOrths.length);
  for (let i = 0; i < origOrths.length; i++) {
    assert.deepEqual(projectOrthographic(compacted, compacted.orthographic_candidates[i]), projectOrthographic(orig, origOrths[i]));
    verifiedOrth++;
  }

  compactedPilotMap.set(bs, compacted);
}
console.log({
  pilot_compaction_parity: 'PASS',
  verifiedMultihop,
  verifiedBridges,
  verifiedStructural,
  verifiedOrth,
});

// 3. Load all 19,566 canonical LemmaProfiles and STEP formation tables, then run Algorithms A, B, C
console.log('Loading lemma-profiles & static STEP tables...');
const profileBuckets = Array.from({ length: 1024 }, (_, idx) => ({
  hex: idx.toString(16).padStart(3, '0'),
  profiles: {},
  subLookup: Array.from({ length: 16 }, () => ({})),
}));
const bucketByHex = new Map(profileBuckets.map((b) => [b.hex, b]));

const lemmaProfDir = path.join(r10Dir, 'lemma-profiles');
const lemmaProfFiles = fs.readdirSync(lemmaProfDir).filter((f) => f.endsWith('.json.gz')).sort();
assert.equal(lemmaProfFiles.length, 64, `Expected 64 lemma-profiles shards, found ${lemmaProfFiles.length}`);

const seenProfileKeys = new Set();
const rawProfilesList = [];
for (const f of lemmaProfFiles) {
  const d = readGzJson(path.join(lemmaProfDir, f));
  const entries = d.schema_version === 'r10-packed-1'
    ? Object.entries(d.entries || {}).map(([k, ptr]) => [k, decodePackedRecord(ptr)])
    : Object.entries(d.entries || {});
  for (const [key, prof] of entries) {
    assert.equal(key, prof.bs, `Key mismatch in lemma-profiles: ${key} !== ${prof.bs}`);
    assert.ok(!seenProfileKeys.has(prof.bs), `Duplicate profile ${prof.bs}`);
    seenProfileKeys.add(prof.bs);
    baseProfByBs.set(prof.bs, prof);
    rawProfilesList.push(prof);
  }
}
assert.equal(rawProfilesList.length, 19566, `Expected 19566 profiles, got ${rawProfilesList.length}`);

const tblLemmas = readStaticTable('lemmas');
const tblRootLinks = readStaticTable('lemma_root_links');
const tblRoots = readStaticTable('lexical_roots');
const tblFormations = readStaticTable('lexical_formations');

const lemmaMetaById = new Map();
const rootKeyById = new Map();
for (const r of tblRoots) rootKeyById.set(r.id, r.root_key);
for (const l of tblLemmas) {
  lemmaMetaById.set(l.id, {
    lemma_key: l.lemma_key,
    bs: padStrongsBase(l.base_strongs),
    primary_pos: l.primary_pos || '',
    script: l.lemma_script || '',
  });
}
const rootKeysByBs = new Map();
for (const rl of tblRootLinks) {
  if (rl.etymology_type === 'shared_name_base' || rl.etymology_type === 'group_member_of') continue;
  const lm = lemmaMetaById.get(rl.lemma_id);
  const rk = rootKeyById.get(rl.root_id);
  if (!lm?.bs || !rk) continue;
  let arr = rootKeysByBs.get(lm.bs);
  if (!arr) { arr = []; rootKeysByBs.set(lm.bs, arr); }
  if (!arr.includes(rk)) arr.push(rk);
}
const formationTargetsByBs = new Map();
const addBidirectionalFormation = (aBs, bBs) => {
  if (!aBs || !bBs || aBs === bBs) return;
  let arrA = formationTargetsByBs.get(aBs);
  if (!arrA) { arrA = []; formationTargetsByBs.set(aBs, arrA); }
  if (!arrA.includes(bBs)) arrA.push(bBs);
  let arrB = formationTargetsByBs.get(bBs);
  if (!arrB) { arrB = []; formationTargetsByBs.set(bBs, arrB); }
  if (!arrB.includes(aBs)) arrB.push(aBs);
};
for (const fm of tblFormations) {
  const lm = lemmaMetaById.get(fm.lemma_id);
  if (!lm?.bs) continue;
  const refs = String(fm.evidence_note || '').match(/\b[HG]\d{3,5}\b/g) || [];
  for (const rawBs of refs) {
    const tBs = padStrongsBase(rawBs);
    if (tBs && tBs !== lm.bs) addBidirectionalFormation(lm.bs, tBs);
  }
}

// Enrich Hebrew derivation links from CC BY 4.0 Open Scriptures HebrewStrong.xml (requiring >= 2 shared Hebrew consonants)
const oshbXmlPath = path.resolve('.artifacts-r12/external-cache/oshb-lexicon/HebrewStrong.xml');
let oshbAddedLinks = 0;
const extractScriptConsonants = (s) => {
  const first = String(s || '').split(/[,;/]/)[0] || '';
  return [...first.normalize('NFD')].filter((ch) => {
    const cp = ch.codePointAt(0) || 0;
    return (cp >= 0x05d0 && cp <= 0x05ea) || (cp >= 0x03b1 && cp <= 0x03c9) || (cp >= 0x0391 && cp <= 0x03a9);
  }).map((c) => c.toLowerCase());
};
if (fs.existsSync(oshbXmlPath)) {
  const xmlText = fs.readFileSync(oshbXmlPath, 'utf8');
  const entryRe = /<entry id="(H\d+)">([\s\S]*?)<\/entry>/g;
  let em;
  while ((em = entryRe.exec(xmlText)) !== null) {
    const srcBs = padStrongsBase(em[1]);
    if (!srcBs) continue;
    const body = em[2];
    const srcBlockMatch = /<source>([\s\S]*?)<\/source>/.exec(body);
    if (!srcBlockMatch) continue;
    const srcBlock = srcBlockMatch[1];
    if (/foreign origin|uncertain derivation/i.test(srcBlock)) continue;
    const srcProf = baseProfByBs.get(srcBs);
    const srcCons = new Set(extractScriptConsonants(srcProf?.sc));
    if (srcCons.size < 2) continue;
    const refRe = /src="(H\d+)"/g;
    let rm;
    while ((rm = refRe.exec(srcBlock)) !== null) {
      const tBs = padStrongsBase(rm[1]);
      if (!tBs || tBs === srcBs) continue;
      const tProf = baseProfByBs.get(tBs);
      const tCons = extractScriptConsonants(tProf?.sc);
      const shared = [...new Set(tCons.filter((c) => srcCons.has(c)))];
      if (shared.length < 2) continue;
      const beforeLen = (formationTargetsByBs.get(srcBs) || []).length;
      addBidirectionalFormation(srcBs, tBs);
      if ((formationTargetsByBs.get(srcBs) || []).length > beforeLen) oshbAddedLinks++;
    }
  }
  console.log(`Enriched formationTargetsByBs with ${oshbAddedLinks} bidirectional consonant-verified links from Open Scriptures HebrewStrong.xml (CC BY 4.0).`);
}

// Build per-homograph lemma_key contextual gloss map across all verses (EV13 H3722 sense preservation)
const homographGlossCountsByBs = new Map(); // bs -> Map<lk, Map<cleanGloss, count>>
for (const v of verseMap.values()) {
  for (const tok of v.toks || []) {
    if (tok?._reconciledBs) {
      const canonSc = baseProfByBs.get(tok._reconciledBs)?.sc;
      if (canonSc) tok.lm = String(canonSc).split(/[,;/]/)[0].trim() || tok.lm;
      delete tok._reconciledBs;
    }
    const bs = padStrongsBase(tok?.s);
    const lk = String(tok?.lk || '').trim();
    const rawG = String(tok?.g || '')
      .replace(/^\([^)]+\)\s*/, '')
      .replace(/^(?:and|the|a|an|in|to|from|with|for|of|on)\s+/i, '')
      .replace(/\./g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!bs || !lk || !rawG || rawG.length < 2) continue;
    let byLk = homographGlossCountsByBs.get(bs);
    if (!byLk) { byLk = new Map(); homographGlossCountsByBs.set(bs, byLk); }
    let gMap = byLk.get(lk);
    if (!gMap) { gMap = new Map(); byLk.set(lk, gMap); }
    gMap.set(rawG, (gMap.get(rawG) || 0) + 1);
  }
}

console.log('Running Algorithms A (wordplay), B (collocations + motifs), C (self-interpretations)...');
const verseLookupForWp = new Map();
const versesForInterp = [];
const vidToChapter = new Map();
const dfMapAll = new Map();
for (const p of rawProfilesList) dfMapAll.set(p.bs, p.total_verses || 0);

for (const [vid, v] of verseMap) {
  vidToChapter.set(vid, `${v.book}:${v.chapter}`);
  verseLookupForWp.set(vid, {
    verse_id: vid,
    book: v.book,
    strongsList: (v.toks || []).map((t) => t?.s).filter(Boolean),
    englishText: v.en || '',
  });
  versesForInterp.push({
    verse_id: vid,
    book: v.book,
    chapter: v.chapter,
    verse: v.verse,
    ref: v.ref,
    en: v.en || '',
    toks: (v.toks || []).map((t) => ({ wn: t.wn, sf: t.sf, lm: t.lm, s: t.s, g: t.g, cl: t.cl })),
  });
}

// Assign previously declared variables instead of shadowing inside the non-versesOnly block
r13SelfInterpretations = extractScripturalInterpretations(versesForInterp, dfMapAll);
const wordplayIndex = buildCorpusWordplayIndex(
  rawProfilesList.map((p) => ({
    bs: p.bs,
    script: p.sc || '',
    gloss: p.gl || '',
    total_verses: p.total_verses || 0,
    all_vids: p.all_vids || [],
    root_keys: rootKeysByBs.get(p.bs) || [],
    formation_targets: formationTargetsByBs.get(p.bs) || [],
  })),
  verseLookupForWp,
  { maxPerLemma: 10, maxVerseFreqForPureOrth: 850 },
);
const collocIndex = computeHighPmiCollocations(
  rawProfilesList.map((p) => ({
    bs: p.bs,
    script: p.sc,
    gloss: p.gl,
    total_verses: p.total_verses || 0,
    all_vids: p.all_vids || [],
  })),
  verseMap.size,
  { maxPerLemma: 12, maxDf: 2500 },
);
const lxxMapForMotifs = new Map();
for (const p of rawProfilesList) {
  if (Array.isArray(p.lxx_relations) && p.lxx_relations.length > 0) {
    lxxMapForMotifs.set(
      p.bs,
      p.lxx_relations
        .filter((lx) => lx?.target_strongs && (lx.count || 0) >= 2)
        .map((lx) => ({ target_bs: lx.target_strongs, count: lx.count || 0 })),
    );
  }
}
const interpEdgesForMotifs = [];
for (const si of r13SelfInterpretations) {
  for (const sym of si.symbol_strongs) {
    for (const refBs of si.referent_strongs) {
      interpEdgesForMotifs.push({ from_bs: sym, to_bs: refBs, verse_id: si.verse_id, cue: `${si.ref} ${si.cue_kind}` });
    }
  }
}
minedMotifsRes = mineMultiPassageMotifs({
  profiles: rawProfilesList.map((p) => ({
    bs: p.bs,
    script: p.sc,
    gloss: p.gl,
    total_verses: p.total_verses || 0,
    all_vids: p.all_vids || [],
  })),
  collocMap: collocIndex,
  wordplayMap: wordplayIndex,
  lxxMap: lxxMapForMotifs,
  interpretationEdges: interpEdgesForMotifs,
  vidToChapter,
  maxMotifs: 750,
});
r13WordplayCount = wordplayIndex.size;
r13CollocCount = collocIndex.size;
console.log(`Algorithms complete: wordplay=${wordplayIndex.size} lemmas, colloc=${collocIndex.size} lemmas, selfInterp=${r13SelfInterpretations.length}, motifs=${minedMotifsRes.motifs.length}.`);

for (const prof of rawProfilesList) {
  const firstOccPassages = [];
  for (const vid of (prof.all_vids || []).slice(0, 25)) {
    const v = verseMap.get(vid);
    if (v) {
      firstOccPassages.push({
        verse_id: vid,
        ref: v.ref,
        ...(v.mt_ref !== undefined && v.mt_ref !== null ? { mt_ref: v.mt_ref } : {}),
        book: v.book,
        chapter: v.chapter,
        verse: v.verse,
        testament: v.book <= 39 ? 'OT' : 'NT',
        snippet: v.en,
        is_psalm_heading: v.book === 19 && v.verse === 0,
      });
    }
  }

  // Filter legacy prof.lexical_relations against rootKeysByBs & >= 2 shared consonants for same-language roots (EV05),
  // and enrich with consonant-verified formationTargetsByBs links (e.g. H8247 <-> H8245, H8246 <-> H8247)
  const myRoots = new Set(rootKeysByBs.get(prof.bs) || []);
  const myFormTargets = new Set(formationTargetsByBs.get(prof.bs) || []);
  const myCons = new Set(extractScriptConsonants(prof.sc));
  const cleanedLexRels = [];
  const seenLexTarget = new Set();
  for (const lr of prof.lexical_relations || []) {
    const tBs = padStrongsBase(lr?.target_strongs);
    if (!tBs || tBs === prof.bs || seenLexTarget.has(tBs)) continue;
    const tProf = baseProfByBs.get(tBs);
    if (lr.type === 'shares_root') {
      const tRoots = rootKeysByBs.get(tBs) || [];
      const hasVerifiedSharedRoot = tRoots.some((rk) => myRoots.has(rk)) || myFormTargets.has(tBs);
      if (!hasVerifiedSharedRoot) continue;
      if (prof.bs[0] === tBs[0]) {
        const tCons = extractScriptConsonants(tProf?.sc || lr.script);
        const sharedC = [...new Set(tCons.filter((c) => myCons.has(c)))];
        if (sharedC.length < 2) continue;
      }
    }
    seenLexTarget.add(tBs);
    cleanedLexRels.push(lr);
  }
  for (const tBs of myFormTargets) {
    if (seenLexTarget.has(tBs)) continue;
    const tProf = baseProfByBs.get(tBs);
    if (!tProf) continue;
    if (prof.bs[0] === tBs[0]) {
      const tCons = extractScriptConsonants(tProf.sc);
      const sharedC = [...new Set(tCons.filter((c) => myCons.has(c)))];
      if (sharedC.length < 2) continue;
    }
    seenLexTarget.add(tBs);
    cleanedLexRels.push({
      type: 'derived_from_root_anchor',
      root: String(tProf.sc || '').split(/[,;/]/)[0].trim(),
      target_strongs: tBs,
      script: tProf.sc || '',
      gloss: tProf.gl || '',
    });
  }

  // Enrich senses with distinct homograph lemma_keys when multiple homographs exist on this base Strong's (EV13 H3722)
  const existingSenses = Array.isArray(prof.senses) ? [...prof.senses] : [];
  const byLk = homographGlossCountsByBs.get(prof.bs);
  if (byLk && byLk.size >= 2) {
    const existingKeys = new Set(existingSenses.map((s) => String(s?.key || '').toLowerCase()));
    for (const [lk, gMap] of [...byLk.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const topGlosses = [...gMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([g]) => g);
      if (topGlosses.length === 0) continue;
      const senseKey = lk.replace(/^lemma:/i, 'sense:') + ':contextual';
      if (!existingKeys.has(senseKey.toLowerCase()) && !existingKeys.has(lk.toLowerCase())) {
        existingSenses.push({
          key: lk,
          gl: topGlosses.join(' / '),
        });
      }
    }
  }

  const enriched = {
    ...prof,
    senses: existingSenses,
    lexical_relations: cleanedLexRels,
    first_occ_passages: firstOccPassages,
  };
  const orthEntry = orthMap.get(prof.bs);
  const wpEdges = wordplayIndex.get(prof.bs) || [];
  const collocEdges = collocIndex.get(prof.bs) || [];
  const profMotifIds = minedMotifsRes.motifIdsByBs.get(prof.bs) || [];

  if (orthEntry || wpEdges.length > 0) {
    const consOverlaps = wpEdges
      .filter((e) => !e.proven_common_root)
      .slice(0, 8)
      .map((e) => ({
        bs: e.target_bs,
        sc: e.target_script,
        gl: baseProfByBs.get(e.target_bs)?.gl || '',
        shared: e.shared_consonants,
        kind: e.overlap_kind,
        evidence_type: e.evidence_type,
        witness_vids: e.witness_vids,
        score: e.score,
      }));
    const sharedRootLinks = wpEdges
      .filter((e) => e.proven_common_root)
      .slice(0, 6)
      .map((e) => ({
        bs: e.target_bs,
        sc: e.target_script,
        gl: baseProfByBs.get(e.target_bs)?.gl || '',
        root_key: e.shared_root_key || null,
        evidence_type: e.evidence_type,
      }));
    enriched.orth_entry = {
      bs: orthEntry?.bs || prof.bs,
      script: orthEntry?.script || prof.sc,
      cons: orthEntry?.cons || '',
      homographs: orthEntry?.homographs || [],
      ...(consOverlaps.length > 0 ? { consonantal_overlaps: consOverlaps } : {}),
      ...(sharedRootLinks.length > 0 ? { shared_root: sharedRootLinks } : {}),
    };
    orthAttachedCount++;
  }
  if (wpEdges.length > 0) {
    enriched.r13_wordplay = wpEdges.slice(0, 10).map((e) => ({
      target_bs: e.target_bs,
      target_script: e.target_script,
      target_gloss: baseProfByBs.get(e.target_bs)?.gl || '',
      evidence_type: e.evidence_type,
      overlap_kind: e.overlap_kind,
      epistemic_class: e.epistemic_class,
      proven_common_root: e.proven_common_root,
      ...(e.shared_root_key ? { shared_root_key: e.shared_root_key } : {}),
      shared_consonants: e.shared_consonants,
      edit_distance: e.edit_distance,
      proximity_same_verse: e.proximity_same_verse,
      proximity_adjacent_verse: e.proximity_adjacent_verse,
      has_explicit_cue: e.has_explicit_cue,
      witness_vids: e.witness_vids,
      witness_refs: e.witness_vids.map((vid) => verseMap.get(vid)?.ref).filter(Boolean),
      score: e.score,
    }));
  }
  if (collocEdges.length > 0) {
    enriched.r13_colloc = collocEdges.map((c) => [
      c.target_bs,
      c.shared_count,
      Math.round(c.npmi * 100),
      c.sample_vids.slice(0, 3),
      baseProfByBs.get(c.target_bs)?.sc || '',
      baseProfByBs.get(c.target_bs)?.gl || '',
      c.sample_vids.slice(0, 3).map((vid) => verseMap.get(vid)?.ref).filter(Boolean),
    ]);
  }
  if (profMotifIds.length > 0) {
    enriched.r13_motif_ids = profMotifIds;
  }

  const pilotAnchor = compactedPilotMap.get(prof.bs);
  if (pilotAnchor) {
    enriched.r12_pilot_anchor = pilotAnchor;
    pilotAttachedCount++;
  }

  const bucketHex = computeBucketHex('fnv1a64_mod1024', 1024, prof.bs);
  const bucket = bucketByHex.get(bucketHex);
  assert.ok(bucket, `Invalid profile bucket hex ${bucketHex} for ${prof.bs}`);
  bucket.profiles[prof.bs] = encodeB64Gz(enriched);
  enrichedCount++;
}
assert.equal(enrichedCount, 19566, `Expected 19566 profiles, got ${enrichedCount}`);
assert.ok(orthAttachedCount >= orthMap.size, `Expected >= ${orthMap.size} orth entries attached, got ${orthAttachedCount}`);
assert.equal(pilotAttachedCount, pilot.pilot_anchors.length, `Expected ${pilot.pilot_anchors.length} pilot anchors attached, got ${pilotAttachedCount}`);
console.log(`Enriched ${enrichedCount} profiles (orth+wordplay: ${orthAttachedCount}, pilot: ${pilotAttachedCount}).`);

// 4. Load lemma-lookup and route entries into the 1,024 buckets + 16 sub-buckets
console.log('Loading & routing lemma-lookup entries...');
const lookupDir = path.join(r10Dir, 'lemma-lookup');
const lookupFiles = fs.readdirSync(lookupDir).filter((f) => f.endsWith('.json.gz')).sort();
assert.equal(lookupFiles.length, 64, `Expected 64 lemma-lookup shards, found ${lookupFiles.length}`);

for (let i = 0; i < lookupFiles.length; i++) {
  const f = lookupFiles[i];
  const d = readGzJson(path.join(lookupDir, f));
  let pairs;
  if (d.schema_version === 'r10-packed-1') {
    pairs = Object.entries(d.entries || {}).map(([k, ptr]) => [k, decodePackedRecord(ptr)]);
  } else if (d.schema_version === 'r10-b64gz-1') {
    pairs = [];
    for (const subB64 of Object.values(d.lookup || {})) {
      pairs.push(...Object.entries(decodeB64Gz(subB64)));
    }
  } else {
    pairs = Array.isArray(d.entries) ? d.entries : Object.entries(d.entries || {});
  }
  for (const [rawKey, value] of pairs) {
    const normKey = String(rawKey).toLowerCase();
    const lookupBucketKey = /^[hg]\d{4}$/.test(normKey) ? normKey.toUpperCase() : normKey;
    const bucketHex = computeBucketHex('fnv1a64_mod1024', 1024, lookupBucketKey);
    const subIdxNum = Number((BigInt('0x' + fnv1a64Hex(normKey)) >> 10n) & 15n);
    const bucket = bucketByHex.get(bucketHex);
    assert.ok(bucket, `Invalid lookup bucket ${bucketHex} for ${normKey}`);
    bucket.subLookup[subIdxNum][normKey] = value;
    lookupCount++;
  }
  if ((i + 1) % 16 === 0 || i === lookupFiles.length - 1) {
    console.log(`  lemma-lookup shards unpacked: ${i + 1}/${lookupFiles.length} (${lookupCount} entries)`);
  }
}
assert.ok(lookupCount >= 456129, `Expected >= 456129 lookup entries, got ${lookupCount}`);

// Enrich lookup sub-buckets with biblical English synonyms & key phrases using loaded profiles
const SYNONYM_AND_PHRASE_MAPPINGS = {
  yeast: ['H2557', 'H7603', 'G2219'],
  leaven: ['H2557', 'H7603', 'G2219'],
  unleavened: ['H4682', 'G0106'],
  resurrect: ['G0386', 'G1453', 'H6965'],
  resurrection: ['G0386', 'G1453', 'H6965'],
  rainbow: ['H7198', 'G2463'],
  crimson: ['H8144', 'H8438', 'G2847'],
  scarlet: ['H8144', 'H8438', 'G2847'],
  passover: ['H6453', 'G3957'],
  shepherd: ['H7462', 'G4166'],
  crucify: ['G4717', 'G4957', 'H8518'],
  crucifixion: ['G4717', 'G4957'],
  cross: ['G4716'],
  baptism: ['G0908', 'G0907'],
  baptize: ['G0907'],
  atonement: ['H3722', 'H3725', 'G2435', 'G2643'],
  propitiation: ['G2434', 'G2435', 'H3727'],
  incense: ['H7004', 'H3828', 'G2368'],
  tabernacle: ['H4908', 'H0168', 'G4633'],
  covenant: ['H1285', 'G1242'],
  scroll: ['H4039', 'H5612', 'G0975'],
  circumcision: ['H4135', 'G4061'],
  messiah: ['H4899', 'G5547', 'G3323'],
  anointed: ['H4899', 'H4886', 'G5547'],
  gospel: ['G2098', 'H1319'],
  parable: ['H4912', 'G3850'],
  serpent: ['H5175', 'H8314', 'G3789'],
  snake: ['H5175', 'G3789'],
  wilderness: ['H4057', 'G2048'],
  desert: ['H4057', 'H6160', 'G2048'],
  vineyard: ['H3754', 'G0290'],
  olive: ['H2132', 'G1636'],
  pomegranate: ['H7416'],
  hyssop: ['H0231', 'G5301'],
  cedar: ['H0730'],
  manna: ['H4478', 'G3131'],
  sabbath: ['H7676', 'G4521'],
  jubilee: ['H3104'],
  firstfruits: ['H1061', 'H7225', 'G0536'],
  morningstar: ['G5459', 'G4407', 'H1966'],
  daystar: ['G5459'],
  lightbearer: ['G5459', 'G5458'],
  lampstand: ['H4501', 'G3087'],
  menorah: ['H4501'],
  frankincense: ['H3828', 'G3030'],
  myrrh: ['H4753', 'G4666'],
  bronze: ['H5178', 'G5475'],
  brass: ['H5178', 'G5475'],
  'unleavened bread': ['H4682', 'G0106'],
  'fig tree': ['H8384', 'G4808'],
  'red sea': ['H5488', 'H3220'],
  'mercy seat': ['H3727', 'G2435'],
  'morning star': ['G5459', 'G4407', 'H1966'],
  'light bearer': ['G5459', 'G5458'],
  'living water': ['H4325', 'H2416', 'G5204', 'G2198'],
  'tree of life': ['H6086', 'H2416', 'G3586', 'G2222'],
  'son of man': ['H1121', 'H0120', 'G5207', 'G0444'],
  'lamb of god': ['H3532', 'H7716', 'G0286', 'G2316'],
  'holy spirit': ['H7307', 'H6944', 'G4151', 'G0040'],
  'burnt offering': ['H5930', 'G3646'],
  'high priest': ['H3548', 'H1419', 'G0749'],
  'ark of the covenant': ['H0727', 'H1285', 'G2787', 'G1242'],
  'bronze serpent': ['H5175', 'H5178'],
  'pillar of cloud': ['H5982', 'H6051'],
  'pillar of fire': ['H5982', 'H0784'],
  'third day': ['H7992', 'H3117', 'G5154', 'G2250'],
  'three days': ['H7969', 'H7992', 'H3117', 'G5140', 'G5154', 'G2250'],
  'bread of life': ['H3899', 'H2416', 'G0740', 'G2222'],
  'good shepherd': ['H7462', 'G4166', 'G2570'],
  'new covenant': ['H1285', 'H2319', 'G1242', 'G2537'],
  'day of atonement': ['H3117', 'H3725'],
  'burning bush': ['H5572', 'G0942'],
  'valley of dry bones': ['H1237', 'H6106', 'H3002'],
  almond: ['H8247', 'H8246'],
  watch: ['H8245'],
  watching: ['H8245'],
  pitch: ['H3724', 'H3722'],
  ark: ['H8392', 'H0727', 'G2787'],
  smoke: ['H6227', 'G2586'],
  adam: ['H0120'],
  ground: ['H0127'],
  blood: ['H1818', 'G0129'],
};

for (const [term, bsList] of Object.entries(SYNONYM_AND_PHRASE_MAPPINGS)) {
  const normKey = term.toLowerCase().trim();
  const bucketHex = computeBucketHex('fnv1a64_mod1024', 1024, normKey);
  const subIdxNum = Number((BigInt('0x' + fnv1a64Hex(normKey)) >> 10n) & 15n);
  const bucket = bucketByHex.get(bucketHex);
  if (!bucket) continue;
  const subMap = bucket.subLookup[subIdxNum];
  const rawExisting = Array.isArray(subMap[normKey]) ? subMap[normKey] : [];
  const existing = (normKey === 'resurrect' || normKey === 'resurrection')
    ? rawExisting.filter((c) => c.bs !== 'H2421')
    : rawExisting;
  const existingBs = new Set(existing.map((c) => c.bs));
  if (existing.length === 0) addedSynonymKeys++;
  const merged = [...existing];
  for (const bs of bsList) {
    if (existingBs.has(bs)) continue;
    const p = baseProfByBs.get(bs);
    if (!p) continue;
    merged.push({
      bs: p.bs,
      lk: p.lk || `lemma:${p.bs}`,
      lang: p.lang || (p.bs.startsWith('G') ? 'grc' : 'hbo'),
      sc: p.sc || '',
      tr: p.tr || '',
      gl: p.gl || '',
      cnt: p.total_verses || 0,
      is_prop: Boolean(p.entity_kind === 'proper_name' || /-P$|--T$/.test(p.pos || '')),
      vs: (p.all_vids || []).slice(0, 12),
      match_rank: normKey.includes(' ') ? 96 : 90,
    });
    existingBs.add(bs);
    addedSynonymEntries++;
  }
  if (merged.length > 0) subMap[normKey] = merged;
}
console.log(`Enriched lookup with ${addedSynonymKeys} new synonym/phrase keys (+${addedSynonymEntries} lemma entries).`);

// 5. Rewrite existing 1,024 fast-profiles/shard-000..3ff.json.gz
console.log('Writing 1,024 fast-profiles shards...');
for (const bucket of profileBuckets) {
  const shardPath = path.join(fastProfilesDir, `shard-${bucket.hex}.json.gz`);
  assert.ok(fs.existsSync(shardPath), `Missing existing fast-profiles shard: ${shardPath}`);
  const lookup = {};
  for (let s = 0; s < 16; s++) {
    const subMap = bucket.subLookup[s];
    if (Object.keys(subMap).length > 0) {
      lookup[s.toString(16)] = encodeB64Gz(subMap);
      totalSubBuckets++;
    }
  }
  const { rawBytes, gzBytes } = writeGzJsonAtomic(shardPath, {
    schema_version: 'r10-b64gz-1',
    profiles: bucket.profiles,
    lookup,
  }, 1);
  if (gzBytes > maxFastProfileOuterBytes) {
    maxFastProfileOuterBytes = gzBytes;
    maxFastProfileShard = `shard-${bucket.hex}.json.gz`;
  }
  if (rawBytes > maxFastProfileRawBytes) {
    maxFastProfileRawBytes = rawBytes;
  }
}
console.log(`Wrote 1,024 fast-profiles shards (${totalSubBuckets} non-empty sub-buckets, max outer=${maxFastProfileOuterBytes} B [${maxFastProfileShard}], max raw=${maxFastProfileRawBytes} B).`);
}

// 6. Load xrefs/book-01..66, R8 grammatical roles & clause frames, chapter-lite lemma_keys, and motifs/events
console.log('Building IDF tables, LXX/root bridges, chapter-lite lemma_keys, and R8 clause frames...');
const PACK_FUNC_OR_STOP_STRONGS = new Set([
  'H0853','H0854','H4480','H0413','H5921','H0518','H3588','H0834','H1931','H0859','H0589','H0595','H2088','H2063','H0428','H3605','H3808','H3541','H3651',
  'G3588','G2532','G1161','G0846','G1722','G1519','G3754','G1473','G4771','G3778','G3739','G5100','G5101','G1438','G1063','G1537','G0575','G2596','G3326','G4012','G4314','G5228','G3361','G3756','G3761','G0235','G5613',
  // Greek copula & auxiliary inflections (Defect 5F)
  'G1510','G1488','G1498','G1511','G1526','G2070','G2076','G2258','G2468','G2531','G5600','G5607',
  // Ultra-common generic verbs/modifiers
  'H0559','H1696','H6213','H1961','H0935','H5414','H1980','H7200','H3947','H3318','H8085','H3045','H5975','H2142','H6996',
  'G3004','G1096','G4160','G2192','G2064','G2036','G1832','G1492','G0191','G1325','G2983','G1410','G2309','G3421','G3398',
  'H3967','H0505','H6240','H7239','G1540','G5507',
  'H3068','H3069','H0430','H3478','H1121','H0001','H0376','H0802','H3117','H8141','H1697','H1004','H0776','H4428','H5971',
  'G2316','G2962','G0444','G1093','G3962','G5207','G2250','G3551','G2424','G5547','G3956','G4183','G3173',
]);
const PACK_FUNC_CLASSES = new Set([
  'conjunction','preposition','article','particle','pronoun','interjection','adverb',
  'cj','prep','ptcl','adv','rel','om','intj','pron','det',
]);
const PHRASE_STOPWORDS = new Set([
  'the','a','an','of','in','on','to','for','and','or','he','she','it','they','we','you','me','my','his','her','its','our','your','their',
  'is','are','was','were','be','been','being','will','shall','would','should','have','has','had','that','this','these','those','who','whom',
  'which','from','with','by','at','as','into','unto','not','no','but','also','all','one','two','let','said','says','say','god','lord',
]);

function idfOfBs(bs) {
  const tv = baseProfByBs.get(bs)?.total_verses || 1000;
  return Math.max(0.5, Math.min(4.5, Math.log(31203 / Math.max(1, tv)) - 2.2));
}

function phraseSpecificityBonus(phrase) {
  const words = String(phrase || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !PHRASE_STOPWORDS.has(w));
  if (words.length >= 3) return 0.55;
  if (words.length === 2) return 0.25;
  return 0;
}

const verseContentMap = new Map(); // vid -> { set: Set<string>, list: string[] }
const chapterVidsMap = new Map(); // "book:chapter" -> number[]
for (const [vid, v] of verseMap) {
  vidByBookChVs.set(`${v.book}:${v.chapter}:${v.verse}`, vid);
  const ck = `${v.book}:${v.chapter}`;
  let chArr = chapterVidsMap.get(ck);
  if (!chArr) { chArr = []; chapterVidsMap.set(ck, chArr); }
  chArr.push(vid);
  const set = new Set();
  const list = [];
  for (const t of v.toks || []) {
    const s = t?.s;
    if (!s || PACK_FUNC_OR_STOP_STRONGS.has(s) || PACK_FUNC_CLASSES.has(String(t.cl || '').toLowerCase())) continue;
    if (!set.has(s)) { set.add(s); list.push(s); }
  }
  verseContentMap.set(vid, { set, list });
}
for (const arr of chapterVidsMap.values()) arr.sort((a, b) => a - b);

// Bidirectional direct LXX bridge map (NO transitive root-sibling drift!)
const lxxBridgeMap = new Map(); // bs -> Set<string>
function addBridgeEdge(a, b) {
  if (!a || !b || a === b || PACK_FUNC_OR_STOP_STRONGS.has(a) || PACK_FUNC_OR_STOP_STRONGS.has(b)) return;
  let sa = lxxBridgeMap.get(a); if (!sa) { sa = new Set(); lxxBridgeMap.set(a, sa); } sa.add(b);
  let sb = lxxBridgeMap.get(b); if (!sb) { sb = new Set(); lxxBridgeMap.set(b, sb); } sb.add(a);
}
for (const [bs, p] of baseProfByBs) {
  if (PACK_FUNC_OR_STOP_STRONGS.has(bs) || (p.total_verses || 9999) > 600) continue;
  for (const lr of p.lxx_relations || []) {
    const ts = lr.target_strongs;
    const tp = baseProfByBs.get(ts);
    if (!ts || !tp || PACK_FUNC_OR_STOP_STRONGS.has(ts) || (tp.total_verses || 9999) > 550) continue;
    if ((lr.count || 0) >= 2 || lr.type === 'lxx_swete_witness' || lr.type === 'bcv_lxx_bridge' || lr.type === 'word_alignment') {
      addBridgeEdge(bs, ts);
    }
  }
  for (const lr of p.lexical_relations || []) {
    if (!['shares_root','aramaic_cognate_parallel','derived_from_root_anchor','source_provided_lexical_equivalent'].includes(lr.type)) continue;
    const ts = lr.target_strongs;
    const tp = baseProfByBs.get(ts);
    if (!ts || !tp || PACK_FUNC_OR_STOP_STRONGS.has(ts) || (tp.total_verses || 9999) > 550) continue;
    addBridgeEdge(bs, ts);
  }
}

function parseEndVerse(refStr) {
  const m = String(refStr || '').match(/:(\d+)\s*-\s*(\d+)\s*$/);
  return m ? { startV: Number(m[1]), endV: Number(m[2]) } : null;
}

function computeSpanOverlap(fromVid, toVid, toEndV, toStartV) {
  const fromContent = verseContentMap.get(fromVid);
  if (!fromContent || fromContent.list.length === 0) return { lexCount: 0, lxxCount: 0, idfOverlap: 0 };
  const spanLen = toEndV && toStartV && toEndV > toStartV ? Math.min(10, toEndV - toStartV) : 0;
  const targetSet = new Set();
  const targetBook = verseMap.get(toVid)?.book;
  for (let dv = 0; dv <= spanLen; dv++) {
    const tv = verseMap.get(toVid + dv);
    if (!tv || tv.book !== targetBook) break;
    const tc = verseContentMap.get(toVid + dv);
    if (tc) for (const s of tc.list) targetSet.add(s);
  }
  if (targetSet.size === 0) return { lexCount: 0, lxxCount: 0, idfOverlap: 0 };
  let lexCount = 0;
  let lxxCount = 0;
  let idfOverlap = 0;
  for (const s of fromContent.list) {
    if (targetSet.has(s)) {
      lexCount++;
      idfOverlap += idfOfBs(s);
      continue;
    }
    const bridges = lxxBridgeMap.get(s);
    if (!bridges) continue;
    let bridged = false;
    for (const b of bridges) {
      if (targetSet.has(b)) { bridged = true; break; }
    }
    if (bridged) {
      lxxCount++;
      idfOverlap += idfOfBs(s);
    }
  }
  return { lexCount, lxxCount, idfOverlap: Math.min(14.0, idfOverlap) };
}

console.log('Indexing xrefs and events for fast-verses chunks...');
const xrefsDir = path.join(r10Dir, 'xrefs');
const xrefFiles = fs.readdirSync(xrefsDir).filter((f) => f.endsWith('.json.gz')).sort();
assert.equal(xrefFiles.length, 66, `Expected 66 xrefs book files, found ${xrefFiles.length}`);

const outSetByVid = new Map();
const rawByVid = new Map();
const vidDegree = new Map();
for (const xf of xrefFiles) {
  const xd = readGzJson(path.join(xrefsDir, xf));
  for (const [vidStr, entry] of Object.entries(xd.by_verse || {})) {
    const vid = Number(vidStr);
    rawByVid.set(vid, entry);
    const outTargets = new Set();
    let total = 0;
    for (const o of entry.out || []) {
      for (const t of o.targets || []) {
        outTargets.add(t.to_vid);
        total++;
      }
    }
    outSetByVid.set(vid, outTargets);
    total += (entry.in || []).length;
    vidDegree.set(vid, total);
  }
}

const embeddedXrefsByVid = new Map();
const xrefTargetSetByVid = new Map();
let totalEmbeddedXrefs = 0;
for (const [vid, entry] of rawByVid) {
  const v = verseMap.get(vid);
  const fromBook = v?.book || 1;
  const fromTestament = fromBook <= 39;
  const candByTarget = new Map();
  const scoreXrefCand = (toVid, toRef, phrase, reciprocal, crossTestament, toStartV, toEndV) => {
    const targetDeg = vidDegree.get(toVid) || 1;
    const { lexCount, lxxCount, idfOverlap } = computeSpanOverlap(vid, toVid, toEndV, toStartV);
    const pBonus = phraseSpecificityBonus(phrase);
    const corroborated = idfOverlap >= 2.0 || (lexCount + lxxCount) >= 2 || (crossTestament && lxxCount >= 1);
    const degDenom = corroborated ? Math.log2(4 + targetDeg * 0.12) : Math.log2(2 + targetDeg);
    const xTestWeight = crossTestament ? (lexCount + lxxCount >= 1 || pBonus > 0 ? 2.15 : 1.75) : 1.0;
    const score = ((reciprocal ? 2.6 : 1.0) * xTestWeight * (1 + idfOverlap * 0.5 + pBonus)) / degDenom;
    return { score, lexCount, lxxCount, idfOverlap };
  };
  for (const o of entry.out || []) {
    const phrase = String(o.phrase || '').slice(0, 60);
    for (const t of o.targets || []) {
      const toVid = Number(t.to_vid);
      if (!toVid || toVid === vid) continue;
      const reciprocal = Boolean(outSetByVid.get(toVid)?.has(vid));
      const crossTestament = fromTestament !== (Number(t.to_b) <= 39);
      const flags = (reciprocal ? 1 : 0) | (crossTestament ? 2 : 0);
      const parsedRange = parseEndVerse(t.to_ref);
      const toStartV = Number(t.to_v || parsedRange?.startV || 0);
      const toEndV = Number(t.to_end_v || parsedRange?.endV || toStartV);
      const { score, lexCount, lxxCount, idfOverlap } = scoreXrefCand(toVid, t.to_ref, phrase, reciprocal, crossTestament, toStartV, toEndV);
      const prev = candByTarget.get(toVid);
      if (!prev || score > prev.score || (score === prev.score && phrase.length > prev.phrase.length)) {
        candByTarget.set(toVid, { toVid, toRef: t.to_ref, phrase, flags, score, lexCount, lxxCount, idf10: Math.round(idfOverlap * 10) });
      }
    }
  }
  for (const inc of entry.in || []) {
    const toVid = Number(inc.from_vid);
    if (!toVid || toVid === vid) continue;
    const reciprocal = Boolean(outSetByVid.get(vid)?.has(toVid));
    const crossTestament = fromTestament !== (Number(inc.from_b) <= 39);
    const incPhrase = String(inc.phrase || '').slice(0, 60);
    const parsedRange = parseEndVerse(inc.from_ref);
    const toStartV = Number(inc.from_v || parsedRange?.startV || 0);
    const toEndV = Number(inc.from_end_v || parsedRange?.endV || toStartV);
    const existing = candByTarget.get(toVid);
    if (existing) {
      existing.flags |= 1; // mutual link
      const rescored = scoreXrefCand(toVid, existing.toRef, existing.phrase || incPhrase, true, crossTestament, toStartV, toEndV);
      if (rescored.score > existing.score) {
        existing.score = rescored.score;
        existing.lexCount = Math.max(existing.lexCount, rescored.lexCount);
        existing.lxxCount = Math.max(existing.lxxCount, rescored.lxxCount);
        existing.idf10 = Math.max(existing.idf10, Math.round(rescored.idfOverlap * 10));
      }
      continue;
    }
    const flags = (reciprocal ? 1 : 0) | (crossTestament ? 2 : 0) | 4;
    const { score, lexCount, lxxCount, idfOverlap } = scoreXrefCand(toVid, inc.from_ref, incPhrase, reciprocal, crossTestament, toStartV, toEndV);
    candByTarget.set(toVid, {
      toVid,
      toRef: inc.from_ref,
      phrase: incPhrase,
      flags,
      score,
      lexCount,
      lxxCount,
      idf10: Math.round(idfOverlap * 10),
    });
  }
  if (candByTarget.size > 0) {
    const topXrefs = [...candByTarget.values()]
      .sort((a, b) => b.score - a.score || a.toVid - b.toVid)
      .slice(0, 28)
      .map((x) => [x.toVid, x.toRef, x.phrase, x.flags, x.lexCount, x.lxxCount, x.idf10]);
    embeddedXrefsByVid.set(vid, topXrefs);
    xrefTargetSetByVid.set(vid, new Set(topXrefs.map((x) => x[0])));
    totalEmbeddedXrefs += topXrefs.length;
  }
}
console.log(`Indexed evidence-weighted top-28 xrefs across ${embeddedXrefsByVid.size} verses (${totalEmbeddedXrefs} links).`);

// Build Stream A (clause-aligned rare-lemma scene), Stream B (verified proper-name pericope bridge), Stream C (forward progression)
const conceptIdxForUsfm = readGzJson(path.join(r10Dir, 'concept-index.json.gz'));
const usfmToBook = new Map((conceptIdxForUsfm.book_names || []).map((b) => [String(b.usfm).toUpperCase(), b.id]));
const verseRoles = new Map();
const verseClauseFrames = new Map(); // vid -> CompactClauseFrame[]
const r8PassagesDir = path.join(root, 'v2/relationships/r8-v1.2/passages');
if (fs.existsSync(r8PassagesDir)) {
  for (const f of fs.readdirSync(r8PassagesDir)) {
    if (!f.endsWith('.json.gz')) continue;
    const d = readGzJson(path.join(r8PassagesDir, f));
    for (const pObj of Object.values(d.passages || {})) {
      const m = String(pObj.reference || '').match(/^([1-3A-Z]+)\s+(\d+):(\d+)/i);
      if (!m) continue;
      const bk = usfmToBook.get(m[1].toUpperCase());
      if (!bk) continue;
      const rVid = vidByBookChVs.get(`${bk}:${m[2]}:${m[3]}`);
      if (!rVid) continue;
      let rm = verseRoles.get(rVid);
      if (!rm) { rm = new Map(); verseRoles.set(rVid, rm); }
      const cFrames = [];
      for (const fr of pObj.frames || []) {
        const predBs = padStrongsBase(String(fr.predicate?.lemma_id || '').replace(/^lemma:/, ''));
        const subj = [];
        const obj = [];
        const other = [];
        if (predBs && !PACK_FUNC_OR_STOP_STRONGS.has(predBs)) {
          let s = rm.get(predBs); if (!s) { s = new Set(); rm.set(predBs, s); } s.add('pred');
        }
        for (const r of fr.roles || []) {
          const rBs = padStrongsBase(String(r.lemma_id || '').replace(/^lemma:/, ''));
          if (rBs && r.role) {
            let s = rm.get(rBs); if (!s) { s = new Set(); rm.set(rBs, s); } s.add(r.role);
            if (!PACK_FUNC_OR_STOP_STRONGS.has(rBs)) {
              const roleLc = String(r.role).toLowerCase();
              if (roleLc.includes('subj') || roleLc.includes('agent')) subj.push(rBs);
              else if (roleLc.includes('obj')) obj.push(rBs);
              else other.push(rBs);
            }
          }
        }
        if (cFrames.length < 4 && ((predBs && !PACK_FUNC_OR_STOP_STRONGS.has(predBs)) || subj.length > 0 || obj.length > 0)) {
          cFrames.push({ pred: predBs || '', subj: subj.slice(0, 3), obj: obj.slice(0, 3), other: other.slice(0, 3) });
        }
      }
      if (cFrames.length > 0) verseClauseFrames.set(rVid, cFrames);
    }
  }
}
console.log(`Loaded R8 grammatical roles & clause frames for ${verseRoles.size} verses.`);

const lemmaSceneTargets = new Map();
for (const [bs, p] of baseProfByBs) {
  if (PACK_FUNC_OR_STOP_STRONGS.has(bs) || (p.total_verses || 9999) > 520) continue;
  const arr = [{ key: `L:${bs}`, originBs: bs, idf: idfOfBs(bs) }];
  const seenKey = new Set([`L:${bs}`]);
  const cands = [];
  for (const lr of p.lxx_relations || []) {
    const ts = lr.target_strongs;
    const tp = baseProfByBs.get(ts);
    if (!ts || !tp || PACK_FUNC_OR_STOP_STRONGS.has(ts) || (tp.total_verses || 9999) > 450) continue;
    const cnt = lr.count || 0;
    const share = cnt / Math.max(1, p.total_verses || 1);
    if (cnt >= 3 && share >= 0.12) {
      cands.push({ ts, score: cnt * (bs[0] === 'H' && ts[0] === 'G' ? 1 : 0.8), idf: (idfOfBs(bs) + idfOfBs(ts)) * 0.5 + 0.35 });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands.slice(0, 2)) {
    const key = `B:${c.ts}`;
    if (!seenKey.has(key)) {
      seenKey.add(key);
      arr.push({ key, originBs: bs, idf: c.idf });
    }
  }
  if (bs[0] === 'G' && !seenKey.has(`B:${bs}`)) {
    arr.push({ key: `B:${bs}`, originBs: bs, idf: idfOfBs(bs) });
  }
  lemmaSceneTargets.set(bs, arr);
}

const scenePostings = new Map();
const verseSceneTargets = new Map();
for (const [vid, v] of verseMap) {
  const vc = verseContentMap.get(vid);
  if (!vc || vc.list.length < 2) continue;
  const targets = [];
  for (const bs of vc.list) {
    const targs = lemmaSceneTargets.get(bs);
    if (!targs) continue;
    for (const tg of targs) {
      targets.push(tg);
      let lst = scenePostings.get(tg.key);
      if (!lst) { lst = []; scenePostings.set(tg.key, lst); }
      lst.push({ vid, book: v.book, originBs: bs, idf: tg.idf });
    }
  }
  if (targets.length > 0) verseSceneTargets.set(vid, targets);
}

const embeddedScenesByVid = new Map();
let streamACount = 0;
let streamBCount = 0;
let streamCCount = 0;

for (const [vid, v] of verseMap) {
  const srcTargets = verseSceneTargets.get(vid);
  if (!srcTargets) continue;
  const rolesV = verseRoles.get(vid);
  const framesV = verseClauseFrames.get(vid) || [];
  const candMap = new Map();
  for (const sc of srcTargets) {
    const lst = scenePostings.get(sc.key);
    if (!lst || lst.length < 2 || lst.length > 480) continue;
    for (let k = 0; k < lst.length; k++) {
      const hit = lst[k];
      if (hit.book === v.book) continue;
      let acc = candMap.get(hit.vid);
      if (!acc) {
        acc = { vid: hit.vid, book: hit.book, srcSet: new Set(), tgtSet: new Set(), pairs: [], idfSum: 0, roleHits: 0, maxMinFreq: 0 };
        candMap.set(hit.vid, acc);
      }
      if (!acc.srcSet.has(sc.originBs) && !acc.tgtSet.has(hit.originBs)) {
        acc.srcSet.add(sc.originBs);
        acc.tgtSet.add(hit.originBs);
        acc.idfSum += (sc.idf + hit.idf) * 0.5;
        const f1 = baseProfByBs.get(sc.originBs)?.total_verses || 999;
        const f2 = baseProfByBs.get(hit.originBs)?.total_verses || 999;
        acc.maxMinFreq = Math.max(acc.maxMinFreq, Math.min(f1, f2));
        const r1 = rolesV?.get(sc.originBs);
        const r2 = verseRoles.get(hit.vid)?.get(hit.originBs);
        if (r1 && r2) {
          for (const r of r1) {
            if (r !== 'pred' && r2.has(r)) { acc.roleHits++; break; }
          }
        }
        if (acc.pairs.length < 4) acc.pairs.push(`${sc.originBs}-${hit.originBs}`);
      }
    }
  }
  if (candMap.size === 0) continue;
  const fromOt = v.book <= 39;
  const qualified = [];
  for (const acc of candMap.values()) {
    if (acc.srcSet.size < 2 || acc.tgtSet.size < 2) continue;
    const isXtest = fromOt !== (acc.book <= 39);
    const framesTgt = verseClauseFrames.get(acc.vid) || [];
    const clauseAlign = (framesV.length > 0 && framesTgt.length > 0)
      ? compareStructuredRoleFrames(framesV, framesTgt, lxxBridgeMap)
      : { score: 0, aligned_roles: [] };
    const clauseHits = clauseAlign.aligned_roles.length;
    const strongTriad = acc.srcSet.size >= 3 && acc.tgtSet.size >= 3 && acc.idfSum >= 7.8;
    const alignedRarePair = acc.srcSet.size >= 2 && acc.tgtSet.size >= 2 && acc.idfSum >= 7.0 && (clauseHits >= 2 || acc.roleHits >= 2 || acc.srcSet.size >= 3) && acc.maxMinFreq <= 140;
    if (strongTriad || alignedRarePair) {
      const score = acc.idfSum + Math.max(acc.roleHits, clauseHits) * 2.2 + (acc.srcSet.size >= 3 ? 2.5 : 0) + (isXtest ? 1.2 : 0);
      qualified.push({ ...acc, roleHits: Math.max(acc.roleHits, clauseHits), isXtest, score });
    }
  }
  if (qualified.length === 0) continue;
  qualified.sort((a, b) => b.score - a.score || a.vid - b.vid);
  const picked = [];
  for (const q of qualified) {
    if (q.isXtest && picked.filter((x) => x.isXtest).length < 2) picked.push(q);
  }
  for (const q of qualified) {
    if (picked.length >= 2) break;
    if (!picked.some((x) => x.vid === q.vid)) picked.push(q);
  }
  if (picked.length > 0) {
    const tuples = picked.map((q) => [1, q.vid, verseMap.get(q.vid)?.ref || `Verse ${q.vid}`, Math.round(q.idfSum * 10), q.roleHits, q.pairs.join(','), 1]);
    embeddedScenesByVid.set(vid, tuples);
    streamACount += tuples.length;
  }
}

// Stream B: Rare proper-name cross-testament/genealogy bridge verified on actual verse token lemma_key & target proper-name POS (Defect 5H)
function isProperNamePos(pos) {
  return /-(?:P|T|L)$|--(?:P|T|L)$/.test(String(pos || ''));
}
const rareCrossTestProperTargets = new Map();
for (const [bs, p] of baseProfByBs) {
  const isProp = p.entity_kind === 'proper_name' || isProperNamePos(p.pos);
  if (!isProp || (p.total_verses || 999) > 40 || (p.total_verses || 0) === 0) continue;
  const isPersonal = /-[MF]-P$/.test(p.pos || '');
  const srcOt = bs[0] === 'H';
  const targets = [];
  for (const lr of [...(p.lexical_relations || []), ...(p.lxx_relations || [])]) {
    const ts = lr.target_strongs;
    const tp = baseProfByBs.get(ts);
    if (!ts || !tp || (ts[0] === 'H') === srcOt || (tp.total_verses || 999) > 40) continue;
    const tgtIsProp = tp.entity_kind === 'proper_name' || isProperNamePos(tp.pos);
    if (!tgtIsProp) continue;
    for (const tVid of (tp.all_vids || []).slice(0, 3)) {
      const tRef = verseMap.get(tVid)?.ref;
      if (tRef) targets.push({ targetBs: ts, targetVid: tVid, targetRef: tRef, isPersonal, targetTotal: tp.total_verses || 99 });
    }
  }
  if (targets.length > 0) {
    targets.sort((a, b) => a.targetTotal - b.targetTotal || a.targetVid - b.targetVid);
    rareCrossTestProperTargets.set(bs, targets.slice(0, 4));
  }
}
const streamBCandsByVid = new Map();
for (const [srcBs, targets] of rareCrossTestProperTargets) {
  const srcProf = baseProfByBs.get(srcBs);
  for (const anchorVid of srcProf?.all_vids || []) {
    const av = verseMap.get(anchorVid);
    if (!av || (av.book > 19 && av.book !== 44)) continue;
    const tokLkSet = verseStemLemmaKeys.get(anchorVid)?.get(srcBs);
    if (tokLkSet && tokLkSet.size > 0) {
      const hasPropToken = [...tokLkSet].some((lk) => {
        const pos = lemmaPosByKey.get(lk);
        return !pos || isProperNamePos(pos);
      });
      if (!hasPropToken) continue;
    }
    const chVids = chapterVidsMap.get(`${av.book}:${av.chapter}`) || [];
    for (const nearVid of chVids) {
      const dist = Math.abs(nearVid - anchorVid);
      if (nearVid === anchorVid || dist > 22) continue;
      if (verseContentMap.get(nearVid)?.set.has(srcBs)) continue;
      let list = streamBCandsByVid.get(nearVid);
      if (!list) { list = []; streamBCandsByVid.set(nearVid, list); }
      for (const tg of targets) {
        list.push({ srcBs, anchorVid, anchorRef: av.ref, dist, ...tg });
      }
    }
  }
}
for (const [nearVid, list] of streamBCandsByVid) {
  list.sort((a, b) =>
    Number(b.isPersonal) - Number(a.isPersonal) ||
    a.targetTotal - b.targetTotal ||
    a.dist - b.dist ||
    a.targetVid - b.targetVid
  );
  const existing = embeddedScenesByVid.get(nearVid) || [];
  const countBySrc = new Map();
  let added = 0;
  for (const cand of list) {
    if (added >= 2) break;
    if (existing.some((x) => x[1] === cand.targetVid)) continue;
    const srcUsed = countBySrc.get(cand.srcBs) || 0;
    const maxForSrc = (cand.isPersonal && cand.targetTotal <= 5) ? 2 : 1;
    if (srcUsed >= maxForSrc) continue;
    countBySrc.set(cand.srcBs, srcUsed + 1);
    existing.push([2, cand.targetVid, cand.targetRef, cand.srcBs, cand.targetBs, cand.anchorVid, cand.anchorRef]);
    added++;
    streamBCount++;
  }
  if (existing.length > 0) embeddedScenesByVid.set(nearVid, existing);
}

// Stream C: Same-chapter forward progression (strictly j > i, toVid > fromVid)
const FORMULA_SKIP_STRONGS = new Set(['H3205','H8034','H2421','H0259','H8147','H7969','G1080','G3686']);
for (const chVids of chapterVidsMap.values()) {
  if (chVids.length < 2) continue;
  for (let i = 0; i < chVids.length; i++) {
    const vid = chVids[i];
    const c1 = verseContentMap.get(vid);
    if (!c1 || c1.list.length < 2) continue;
    const xrSet = xrefTargetSetByVid.get(vid);
    let best = null;
    for (let j = i + 1; j <= Math.min(chVids.length - 1, i + 8); j++) {
      const nVid = chVids[j];
      if (xrSet?.has(nVid)) continue;
      const c2 = verseContentMap.get(nVid);
      if (!c2) continue;
      const shared = [];
      let sumIdf = 0;
      for (const s of c1.list) {
        if (FORMULA_SKIP_STRONGS.has(s)) continue;
        const tv = baseProfByBs.get(s)?.total_verses || 999;
        if (tv > 220) continue;
        if (c2.set.has(s)) {
          shared.push(s);
          sumIdf += idfOfBs(s);
        }
      }
      if (shared.length >= 2 && sumIdf >= 4.5) {
        const dist = nVid - vid;
        const sc = sumIdf - dist * 0.15;
        if (!best || sc > best.sc) best = { vid: nVid, sc, shared: shared.slice(0, 3).join(','), dist };
      }
    }
    if (best) {
      const existing = embeddedScenesByVid.get(vid) || [];
      if (!existing.some((x) => x[1] === best.vid)) {
        existing.push([3, best.vid, verseMap.get(best.vid)?.ref || `Verse ${best.vid}`, best.shared, best.dist]);
        embeddedScenesByVid.set(vid, existing);
        streamCCount++;
      }
    }
  }
}
console.log(`Built scenes for ${embeddedScenesByVid.size} verses (StreamA=${streamACount}, StreamB=${streamBCount}, StreamC=${streamCCount}).`);

const expPath = path.join(r10Dir, 'explicit-and-typology.json.gz');
const expBackupPath = path.join(backupDir, 'explicit-and-typology.json.gz');
const expSrc = readGzJson(fs.existsSync(expBackupPath) ? expBackupPath : expPath);

const mpPath = path.join(r10Dir, 'motifs-and-patterns.json.gz');
const mpBackupPath = path.join(backupDir, 'motifs-and-patterns.json.gz');
const mpRaw = readGzJson(fs.existsSync(mpBackupPath) ? mpBackupPath : mpPath);
const mp = mpRaw.schema_version === 'r10-lazy-motifs-1'
  ? {
      motifs: mpRaw.motifs,
      motif_pairs: decodeB64Gz(mpRaw.motif_pairs_b64gz),
      events: decodeB64Gz(mpRaw.events_b64gz),
    }
  : mpRaw;

function parseEventSortKey(ev) {
  const s = String(ev?.start_date || '').trim();
  const m = s.match(/^(-?\d+)(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!m) return { yr: 999999, mo: 99, dy: 99 };
  const yr = parseInt(m[1], 10);
  const mo = m[2] ? parseInt(m[2], 10) : 1;
  const dy = m[3] ? parseInt(m[3], 10) : 1;
  return { yr, mo: yr < 0 ? 13 - mo : mo, dy: yr < 0 ? 32 - dy : dy };
}
const sortedEvents = [...(mp.events || [])].sort((a, b) => {
  const ka = parseEventSortKey(a);
  const kb = parseEventSortKey(b);
  if (ka.yr !== kb.yr) return ka.yr - kb.yr;
  if (ka.mo !== kb.mo) return ka.mo - kb.mo;
  if (ka.dy !== kb.dy) return ka.dy - kb.dy;
  const va = a.passages?.[0]?.verse_id ?? 999999;
  const vb = b.passages?.[0]?.verse_id ?? 999999;
  return va - vb || String(a.event_id).localeCompare(String(b.event_id));
});

const eventSeq = {};
const eventsByExactVid = new Map();
const eventsBySpanVid = new Map();
const eventsByChapter = new Map();
for (let i = 0; i < sortedEvents.length; i++) {
  const ev = sortedEvents[i];
  eventSeq[ev.event_id] = {
    prev: i > 0 ? sortedEvents[i - 1].event_id : null,
    next: i + 1 < sortedEvents.length ? sortedEvents[i + 1].event_id : null,
    title: ev.title,
    start_date: ev.start_date || null,
    sample_vids: (ev.passages || []).slice(0, 8).map((p) => p.verse_id),
  };
  const chMinMax = new Map();
  for (const p of ev.passages || []) {
    if (p.verse_id) {
      let arr = eventsByExactVid.get(p.verse_id);
      if (!arr) { arr = []; eventsByExactVid.set(p.verse_id, arr); }
      if (!arr.includes(ev.event_id)) arr.push(ev.event_id);
      if (p.book && p.chapter) {
        const ck = `${p.book}:${p.chapter}`;
        const cur = chMinMax.get(ck) || { min: p.verse_id, max: p.verse_id };
        cur.min = Math.min(cur.min, p.verse_id);
        cur.max = Math.max(cur.max, p.verse_id);
        chMinMax.set(ck, cur);
      }
    }
    if (p.book && p.chapter) {
      const ck = `${p.book}:${p.chapter}`;
      let arr = eventsByChapter.get(ck);
      if (!arr) { arr = []; eventsByChapter.set(ck, arr); }
      if (!arr.includes(ev.event_id)) arr.push(ev.event_id);
    }
  }
  for (const { min, max } of chMinMax.values()) {
    if (max > min && max - min <= 12) {
      for (let sv = min; sv <= max; sv++) {
        let arr = eventsBySpanVid.get(sv);
        if (!arr) { arr = []; eventsBySpanVid.set(sv, arr); }
        if (!arr.includes(ev.event_id)) arr.push(ev.event_id);
      }
    }
  }
}

console.log('Writing 488 fast-verses chunks (with embedded xrefs + event IDs + scenes + clause frames)...');
const verseChunks = Array.from({ length: 488 }, () => ({ summaries: {}, verses: {}, xrefs: {}, events: {}, scenes: {}, frames: {} }));
let versesAssigned = 0;
let versesWithXrefs = 0;
let versesWithEvents = 0;
let versesWithScenes = 0;
let versesWithFrames = 0;
for (const [vid, v] of verseMap) {
  const chunkIdx = Math.floor((vid - 1) / 64);
  assert.ok(chunkIdx >= 0 && chunkIdx < 488, `Chunk index out of bounds: ${chunkIdx} for vid=${vid}`);
  const chunk = verseChunks[chunkIdx];
  chunk.summaries[vid] = [v.book, v.chapter, v.verse, v.ref, v.en || '', v.mt_ref ?? null];
  chunk.verses[vid] = encodeB64Gz(v);
  const xrList = embeddedXrefsByVid.get(vid);
  if (xrList?.length) {
    chunk.xrefs[vid] = xrList;
    versesWithXrefs++;
  }
  const scList = embeddedScenesByVid.get(vid);
  if (scList?.length) {
    chunk.scenes[vid] = scList;
    versesWithScenes++;
  }
  const cfList = verseClauseFrames.get(vid);
  if (cfList?.length) {
    chunk.frames[vid] = cfList.map((f) => [f.pred, f.subj, f.obj, f.other]);
    versesWithFrames++;
  }
  // Defect 5H: Only attach exact event verses + tight contiguous span (never blind whole-chapter pollution!)
  const evList = [];
  for (const eid of eventsByExactVid.get(vid) || []) {
    if (!evList.includes(eid)) evList.push(eid);
    if (evList.length >= 3) break;
  }
  if (evList.length < 3) {
    for (const eid of eventsBySpanVid.get(vid) || []) {
      if (!evList.includes(eid)) evList.push(eid);
      if (evList.length >= 3) break;
    }
  }
  if (evList.length > 0) {
    chunk.events[vid] = evList;
    versesWithEvents++;
  }
  versesAssigned++;
}
assert.equal(versesAssigned, 31203, `Expected 31203 verses assigned, got ${versesAssigned}`);
console.log(`Attached xrefs=${versesWithXrefs}, events=${versesWithEvents}, scenes=${versesWithScenes}, frames=${versesWithFrames}.`);

let maxFastVerseOuterBytes = 0;
let maxFastVerseRawBytes = 0;
let maxFastVerseChunk = '';
let writtenVerses = 0;
for (let c = 0; c < 488; c++) {
  const hex = c.toString(16).padStart(3, '0');
  const chunkPath = path.join(verseDir, `chunk-${hex}.json.gz`);
  assert.ok(fs.existsSync(chunkPath), `Missing existing fast-verses chunk: ${chunkPath}`);
  const { summaries, verses, xrefs, events, scenes, frames } = verseChunks[c];
  writtenVerses += Object.keys(verses).length;
  const { rawBytes, gzBytes } = writeGzJsonAtomic(chunkPath, {
    schema_version: 'r10-b64gz-1',
    summaries,
    verses,
    xrefs,
    events,
    scenes,
    frames,
  }, 1);
  if (gzBytes > maxFastVerseOuterBytes) {
    maxFastVerseOuterBytes = gzBytes;
    maxFastVerseChunk = `chunk-${hex}.json.gz`;
  }
  if (rawBytes > maxFastVerseRawBytes) {
    maxFastVerseRawBytes = rawBytes;
  }
}
assert.equal(writtenVerses, 31203, `Expected 31203 written verses, got ${writtenVerses}`);
console.log(`Wrote 488 fast-verses chunks (${writtenVerses} verses, max outer=${maxFastVerseOuterBytes} B [${maxFastVerseChunk}], max raw=${maxFastVerseRawBytes} B).`);

// 7. Rewrite existing 66 evidence-passages/book-01..66.json.gz
console.log('Writing 66 evidence-passages book indexes...');
const evDir = path.join(r10Dir, 'evidence-passages');
const evFiles = fs.readdirSync(evDir).filter((f) => f.endsWith('.json.gz')).sort();
assert.equal(evFiles.length, 66, `Expected 66 evidence-passages books, found ${evFiles.length}`);

let evBookVersesTotal = 0;
for (let b = 1; b <= 66; b++) {
  const pad = String(b).padStart(2, '0');
  const bookPath = path.join(evDir, `book-${pad}.json.gz`);
  assert.ok(fs.existsSync(bookPath), `Missing existing evidence-passages file: ${bookPath}`);
  const d = readGzJson(bookPath);
  let chapter_vids;
  let coord_to_vid;
  if (d.schema_version === 'r10-packed-1') {
    chapter_vids = d.chapter_vids;
    coord_to_vid = {};
    for (const [coord, ptr] of Object.entries(d.entries || {})) {
      const val = decodePackedRecord(ptr);
      const vid = Number(val.verse_id);
      assert.equal(coord, `${val.chapter}:${val.verse}`, `Coord mismatch in book-${pad}: ${coord}`);
      assert.equal(val.book, b, `Book mismatch in book-${pad}: ${val.book}`);
      coord_to_vid[coord] = vid;
    }
  } else if (d.schema_version === 'r10-book-index-1') {
    chapter_vids = d.chapter_vids;
    coord_to_vid = d.coord_to_vid;
  } else {
    chapter_vids = {};
    coord_to_vid = {};
    for (const [vidStr, v] of Object.entries(d.verses || {})) {
      const vid = Number(vidStr);
      const ch = String(v.chapter);
      (chapter_vids[ch] ||= []).push(vid);
      coord_to_vid[`${v.chapter}:${v.verse}`] = vid;
    }
  }
  assert.ok(chapter_vids && Object.keys(chapter_vids).length > 0, `Empty chapter_vids for book-${pad}`);
  const chVidList = Object.values(chapter_vids).flat().map(Number);
  assert.equal(chVidList.length, Object.keys(coord_to_vid).length, `chapter_vids vs coord_to_vid count mismatch in book-${pad}`);
  for (const [coord, vid] of Object.entries(coord_to_vid)) {
    const v = verseMap.get(Number(vid));
    assert.ok(v && v.book === b && `${v.chapter}:${v.verse}` === coord, `Book index mismatch book-${pad} ${coord} -> ${vid}`);
    evBookVersesTotal++;
  }
  writeGzJsonAtomic(bookPath, {
    schema_version: 'r10-book-index-1',
    chapter_vids,
    coord_to_vid,
  }, 1);
}
assert.equal(evBookVersesTotal, 31203, `Expected 31203 book index entries across 66 books, got ${evBookVersesTotal}`);
console.log(`Wrote 66 evidence-passages book indexes (${evBookVersesTotal} coordinates).`);

// 8. Optimize explicit-and-typology.json.gz and motifs-and-patterns.json.gz
const filteredRecords = (expSrc.records || []).filter((r) => !r.evidence_id?.startsWith('r10:ident:auto:'));
assert.equal(filteredRecords.length, 24, `Expected 24 filtered explicit records, got ${filteredRecords.length}`);
const expSizes = writeGzJsonAtomic(expPath, {
  ...expSrc,
  records: filteredRecords,
  ...(r13SelfInterpretations.length > 0 ? { r13_self_interpretations: r13SelfInterpretations } : {}),
}, 1);

const eventKeywords = [...new Set((mp.events || []).flatMap((e) => e.keywords || []).map((k) => String(k).toLowerCase()))];
const r13MotifById = Object.fromEntries(
  minedMotifsRes.motifs.map((m) => [
    m.motif_id,
    {
      ...m,
      witness_refs: (m.witness_vids || []).slice(0, 6).map((vid) => verseMap.get(vid)?.ref).filter(Boolean),
      node_meta: (m.nodes || []).map((bs) => {
        const bp = baseProfByBs.get(bs);
        return [bs, bp?.sc || '', bp?.gl || ''];
      }),
    },
  ]),
);
const r13MotifsByBs = Object.fromEntries(minedMotifsRes.motifIdsByBs);
const r13MotifsByVid = Object.fromEntries(minedMotifsRes.motifIdsByVid);

// Build compact lxx_token_lexicon (E10) and genealogy_index (CC BY 4.0) inside motifs-and-patterns.json.gz (0 new files)
const normalizeGreekToken = (w) =>
  String(w || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\u0370-\u03ff\u1f00-\u1fff]/gi, '')
    .toLowerCase();

const hebToGreekMap = new Map(); // Hxxxx -> Map<Gxxxx, count>
const referencedGreekSet = new Set();
const extraGreekScripts = new Map(); // Gxxxx -> Set<normForm>

const lxxBridgeTsvPath = path.resolve('data/sources/bcv-lxx-bridge/lxx_bridge.tsv');
if (fs.existsSync(lxxBridgeTsvPath)) {
  const lines = fs.readFileSync(lxxBridgeTsvPath, 'utf8').split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split('\t');
    if (parts.length < 2) continue;
    const hBs = padStrongsBase(parts[0]);
    const gBs = padStrongsBase(parts[1]);
    const cnt = Math.max(1, Number(parts[2]) || 1);
    if (!hBs.startsWith('H') || !gBs.startsWith('G')) continue;
    let gm = hebToGreekMap.get(hBs);
    if (!gm) { gm = new Map(); hebToGreekMap.set(hBs, gm); }
    gm.set(gBs, Math.max(gm.get(gBs) || 0, cnt));
    referencedGreekSet.add(gBs);
  }
}
for (const [bs, prof] of baseProfByBs) {
  if (!bs.startsWith('H')) continue;
  for (const lr of prof.lxx_relations || []) {
    const gBs = padStrongsBase(lr.target_strongs);
    if (!gBs.startsWith('G')) continue;
    const cnt = Math.max(1, Number(lr.count) || 2);
    let gm = hebToGreekMap.get(bs);
    if (!gm) { gm = new Map(); hebToGreekMap.set(bs, gm); }
    gm.set(gBs, Math.max(gm.get(gBs) || 0, cnt));
    referencedGreekSet.add(gBs);
    if (lr.script) {
      const nf = normalizeGreekToken(lr.script);
      if (nf.length >= 2) {
        let s = extraGreekScripts.get(gBs);
        if (!s) { s = new Set(); extraGreekScripts.set(gBs, s); }
        s.add(nf);
      }
    }
  }
}
const hebrewToGreek = {};
for (const [hBs, gm] of hebToGreekMap) {
  const topPairs = [...gm.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8);
  if (topPairs.length > 0) hebrewToGreek[hBs] = topPairs;
}
const greekForms = {};
for (const gBs of referencedGreekSet) {
  const gProf = baseProfByBs.get(gBs);
  const formsSet = new Set(extraGreekScripts.get(gBs) || []);
  if (gProf?.sc) {
    for (const part of String(gProf.sc).split(/[,;/]/)) {
      const nf = normalizeGreekToken(part);
      if (nf.length >= 2) formsSet.add(nf);
    }
  }
  for (const f of gProf?.forms || []) {
    if (formsSet.size >= 24) break;
    const nf = normalizeGreekToken(f?.sf);
    if (nf.length >= 2) formsSet.add(nf);
  }
  if (formsSet.size > 0) greekForms[gBs] = [...formsSet].slice(0, 24);
}

// Compute corpus-wide Hebrew Strong's -> LXX Swete Greek normalized token co-occurrence (IBM-1 / PMI / Dice)
// across all aligned OT-LXX verses in v1/lxx/b*.json.gz so LXX-only vocabulary (e.g. καρυινην, καρυισκους, κρατηρες, σφαιρωτηρες)
// has empirically attested candidate alignments without any hardcoding.
const hebrewToLxxForms = {};
const catMetaPath = path.join(root, 'v1/catalog/metadata.json.gz');
const lxxDirPath = path.join(root, 'v1/lxx');
if (fs.existsSync(catMetaPath) && fs.existsSync(lxxDirPath)) {
  const catMeta = readGzJson(catMetaPath);
  const grkStopForms = new Set([
    'και', 'δε', 'γαρ', 'ο', 'η', 'το', 'του', 'της', 'τω', 'τη', 'τον', 'την', 'οι', 'αι', 'τα',
    'των', 'τοις', 'ταις', 'τους', 'τας', 'εν', 'εις', 'εκ', 'εξ', 'απο', 'προς', 'επι', 'κατα',
    'μετα', 'δια', 'υπο', 'περι', 'παρα', 'αυτος', 'αυτου', 'αυτω', 'αυτον', 'αυτης', 'αυτη',
    'αυτην', 'αυτων', 'αυτοις', 'αυτους', 'ου', 'μη', 'ουκ', 'ουχ', 'ως', 'οτι', 'ει', 'αν',
  ]);
  const hebDfLxx = new Map();
  const grkDfLxx = new Map();
  const pairCooc = new Map(); // hBs -> Map<nw, { cnt: number, posBonus: number }>

  for (const lb of catMeta.lxx_swete_books || []) {
    const lxxPath = path.join(lxxDirPath, `b${lb.book_no}.json.gz`);
    if (!fs.existsSync(lxxPath)) continue;
    const lxxShard = readGzJson(lxxPath);
    const vidByLxxChVs = new Map();
    for (const m of lxxShard.versification_mappings || []) {
      if (m.canonical_verse_id != null && !m.lxx_chapter_suffix && !m.lxx_verse_suffix) {
        const k = `${m.lxx_chapter}:${m.lxx_verse_nr}`;
        if (!vidByLxxChVs.has(k)) vidByLxxChVs.set(k, Number(m.canonical_verse_id));
      }
    }
    const wordsByChVs = new Map();
    for (const w of lxxShard.words || []) {
      if (w.is_chapter_heading_marker || w.chapter_suffix || w.verse_suffix) continue;
      const k = `${w.chapter}:${w.verse_nr}`;
      let arr = wordsByChVs.get(k);
      if (!arr) { arr = []; wordsByChVs.set(k, arr); }
      arr.push(w);
    }
    for (const [chVs, gWords] of wordsByChVs) {
      let vid = vidByLxxChVs.get(chVs);
      if (!vid && lb.canonical_book != null) {
        vid = vidByBookChVs.get(`${lb.canonical_book}:${chVs}`);
      }
      if (!vid) continue;
      const hVerse = verseMap.get(vid);
      if (!hVerse?.toks?.length || !gWords.length) continue;

      const hToks = hVerse.toks
        .map((t, idx) => ({ bs: padStrongsBase(t.s), relPos: idx / Math.max(1, hVerse.toks.length) }))
        .filter((t) => t.bs.startsWith('H') && !PACK_FUNC_OR_STOP_STRONGS.has(t.bs));
      const gToks = gWords
        .map((w, idx) => ({ nw: normalizeGreekToken(w.normalized_word || w.word_text), relPos: idx / Math.max(1, gWords.length) }))
        .filter((w) => w.nw.length >= 3 && !grkStopForms.has(w.nw));
      if (!hToks.length || !gToks.length) continue;

      const seenH = new Set();
      for (const ht of hToks) {
        if (!seenH.has(ht.bs)) {
          seenH.add(ht.bs);
          hebDfLxx.set(ht.bs, (hebDfLxx.get(ht.bs) || 0) + 1);
        }
      }
      const seenG = new Set();
      for (const gt of gToks) {
        if (!seenG.has(gt.nw)) {
          seenG.add(gt.nw);
          grkDfLxx.set(gt.nw, (grkDfLxx.get(gt.nw) || 0) + 1);
        }
      }

      const seenPairs = new Set();
      for (const ht of hToks) {
        let gm = pairCooc.get(ht.bs);
        if (!gm) { gm = new Map(); pairCooc.set(ht.bs, gm); }
        for (const gt of gToks) {
          const pk = `${ht.bs}:${gt.nw}`;
          const posSim = Math.max(0, 1 - Math.abs(ht.relPos - gt.relPos) * 1.4);
          let cur = gm.get(gt.nw);
          if (!cur) {
            cur = { cnt: 0, posSum: 0 };
            gm.set(gt.nw, cur);
          }
          if (!seenPairs.has(pk)) {
            seenPairs.add(pk);
            cur.cnt++;
          }
          cur.posSum = Math.max(cur.posSum, posSim);
        }
      }
    }
  }

  for (const [hBs, gm] of pairCooc) {
    const hDf = hebDfLxx.get(hBs) || 1;
    const scored = [];
    for (const [nw, { cnt, posSum }] of gm) {
      const gDf = grkDfLxx.get(nw) || 1;
      if (cnt === 1 && (hDf > 18 || gDf > 24)) continue;
      if (cnt === 2 && (hDf > 90 || gDf > 120)) continue;
      const dice = (2 * cnt) / (hDf + gDf);
      const pGivenH = cnt / hDf;
      const pGivenG = cnt / gDf;
      const score = dice * 0.5 + pGivenH * 0.25 + pGivenG * 0.15 + (posSum / Math.max(1, cnt)) * 0.1;
      if (score >= 0.14 || (cnt >= 3 && pGivenH >= 0.22)) {
        scored.push([nw, cnt, Math.min(95, Math.round((0.55 + Math.min(0.38, score * 0.6)) * 100))]);
      }
    }
    scored.sort((a, b) => b[2] - a[2] || b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    if (scored.length > 0) {
      hebrewToLxxForms[hBs] = scored.slice(0, 6);
    }
  }
  console.log(`Mined empirical OT-LXX token co-occurrence forms for ${Object.keys(hebrewToLxxForms).length} Hebrew content lemmas.`);
}

const lxxTokenLexicon = {
  hebrew_to_greek: hebrewToGreek,
  greek_forms: greekForms,
  hebrew_to_lxx_forms: hebrewToLxxForms,
};

let genealogyIndex = { people_by_bs: {}, people_by_id: {}, edges: [], verses_by_person: {}, people_by_vid: {} };
const peopleGraphPath = path.resolve('public/data/bible-people-graph.json');
const personVersesPath = path.resolve('public/data/bible-person-verses.json');
if (fs.existsSync(peopleGraphPath)) {
  const pg = JSON.parse(fs.readFileSync(peopleGraphPath, 'utf8'));
  const peopleById = {};
  const peopleByBs = {};
  for (const p of pg.people || []) {
    if (!p?.id) continue;
    const strongs = (p.strongs || []).map(padStrongsBase).filter(Boolean);
    peopleById[p.id] = {
      id: p.id,
      name: p.name || p.id,
      era: p.era || '',
      lineageGroup: p.lineageGroup || '',
      strongs,
      hebrew: p.hebrew || '',
      greek: p.greek || '',
    };
    for (const s of strongs) {
      if (!peopleByBs[s]) peopleByBs[s] = [];
      if (!peopleByBs[s].includes(p.id)) peopleByBs[s].push(p.id);
    }
  }
  const edges = (pg.relationships || []).map((r) => ({
    from: r.fromId,
    to: r.toId,
    type: r.type || 'kinship',
    category: r.category || 'explicit',
    ref: r.witnessRef?.label || '',
  }));
  const versesByPerson = {};
  const peopleByVid = {};
  if (fs.existsSync(personVersesPath)) {
    const pv = JSON.parse(fs.readFileSync(personVersesPath, 'utf8'));
    for (const [coord, pIds] of Object.entries(pv || {})) {
      const vid = vidByBookChVs.get(coord);
      if (!vid || !Array.isArray(pIds)) continue;
      for (const pid of pIds) {
        if (!peopleById[pid]) continue;
        if (!versesByPerson[pid]) versesByPerson[pid] = [];
        if (versesByPerson[pid].length < 24) versesByPerson[pid].push(vid);
        if (!peopleByVid[vid]) peopleByVid[vid] = [];
        if (!peopleByVid[vid].includes(pid)) peopleByVid[vid].push(pid);
      }
    }
  }
  genealogyIndex = {
    people_by_bs: peopleByBs,
    people_by_id: peopleById,
    edges,
    verses_by_person: versesByPerson,
    people_by_vid: peopleByVid,
  };
  console.log(`Packed genealogy_index (${Object.keys(peopleById).length} people, ${edges.length} edges) & lxx_token_lexicon (${Object.keys(hebrewToGreek).length} Hebrew lemmas).`);
}

const mpSizes = writeGzJsonAtomic(mpPath, {
  schema_version: 'r10-lazy-motifs-1',
  motifs: mp.motifs,
  event_keywords: eventKeywords,
  event_seq: eventSeq,
  event_by_chapter: Object.fromEntries(eventsByChapter),
  motif_pairs_b64gz: encodeB64Gz(mp.motif_pairs || {}),
  events_b64gz: encodeB64Gz(sortedEvents),
  r13_motifs_b64gz: encodeB64Gz(r13MotifById),
  r13_motifs_by_bs: r13MotifsByBs,
  r13_motifs_by_vid: r13MotifsByVid,
  lxx_token_lexicon_b64gz: encodeB64Gz(lxxTokenLexicon),
  genealogy_index_b64gz: encodeB64Gz(genealogyIndex),
}, 1);

// 9. Update fast-manifest.json.gz
const fastManifestPath = path.join(r10Dir, 'fast-manifest.json.gz');
const fastManifestObj = {
  profile_buckets: 1024,
  lookup_buckets: 1024,
  lookup_sub_buckets: 16,
  verse_chunk_size: 64,
  packed: false,
  direct_b64gz: true,
  strongs_lookup_upper_bucket: true,
  motifs_event_keywords: eventKeywords,
  verse_xrefs_embedded: true,
  verse_events_embedded: true,
  verse_scenes_embedded: true,
  verse_frames_embedded: true,
  witness_version: 'r12-witnesses-1',
  r12_pilot: 'r12-pilot.json.gz',
  r12_pilot_embedded: true,
  r12_version: 'r13-discovery-3',
  r13_version: 'r13-discovery-3',
  r12_score_version: 'r13-ranker-v3',
  r12_pilot_anchors: pilot.pilot_anchors.length,
  r12_pilot_anchors_list: pilot.pilot_anchors,
  r12_external_sources: pilot.external_sources || [],
  r12_external_mappings: pilot.external_mappings || [],
};
const fastManifestSizes = writeGzJsonAtomic(fastManifestPath, fastManifestObj, 1);

// 10. Post-write verification and exact walk-and-hash SHA-256 (matching prepare-r12-increment.mjs lines 275-288)
const verifyManifest = readGzJson(fastManifestPath);
assert.deepEqual(verifyManifest, fastManifestObj);
const verifyExp = readGzJson(expPath);
assert.equal(verifyExp.records.length, 24);
assert.ok(verifyExp.records.every((r) => !r.evidence_id?.startsWith('r10:ident:auto:')));
const verifyMp = readGzJson(mpPath);
assert.equal(verifyMp.schema_version, 'r10-lazy-motifs-1');
assert.equal(Object.keys(decodeB64Gz(verifyMp.motif_pairs_b64gz)).length, Object.keys(mp.motif_pairs || {}).length);
assert.equal(decodeB64Gz(verifyMp.events_b64gz).length, (mp.events || []).length);

// Verify all written fast-profiles and fast-verses shards round-trip with exact counts
let verifiedProfiles = 0;
let verifiedLookup = 0;
let verifiedPilotProfiles = 0;
let verifiedOrthProfiles = 0;
if (versesOnly) {
  const fpFiles = fs.readdirSync(fastProfilesDir).filter((f) => f.endsWith('.json.gz'));
  assert.equal(fpFiles.length, 1024, `Expected 1024 fast-profiles shards, got ${fpFiles.length}`);
  verifiedProfiles = baseProfByBs.size;
} else {
for (let i = 0; i < 1024; i++) {
  const hex = i.toString(16).padStart(3, '0');
  const d = readGzJson(path.join(fastProfilesDir, `shard-${hex}.json.gz`));
  assert.equal(d.schema_version, 'r10-b64gz-1');
  for (const [bs, b64] of Object.entries(d.profiles || {})) {
    assert.equal(computeBucketHex('fnv1a64_mod1024', 1024, bs), hex);
    const prof = decodeB64Gz(b64);
    assert.equal(prof.bs, bs);
    assert.ok(Array.isArray(prof.first_occ_passages));
    assert.equal(prof.first_occ_passages.length, Math.min(25, (prof.all_vids || []).length));
    if (prof.r12_pilot_anchor) {
      assert.ok((prof.r12_pilot_anchor.multihop?.recommendations?.length || 0) <= 24);
      verifiedPilotProfiles++;
    }
    if (prof.orth_entry) {
      assert.ok(
        (prof.orth_entry.homographs?.length || 0) > 0 ||
        (prof.orth_entry.consonantal_overlaps?.length || 0) > 0 ||
        (prof.orth_entry.shared_root?.length || 0) > 0,
      );
      verifiedOrthProfiles++;
    }
    verifiedProfiles++;
  }
  for (const [subIdx, b64] of Object.entries(d.lookup || {})) {
    const subMap = decodeB64Gz(b64);
    for (const key of Object.keys(subMap)) {
      const expectedBucketKey = /^[hg]\d{4}$/.test(key) ? key.toUpperCase() : key;
      assert.equal(computeBucketHex('fnv1a64_mod1024', 1024, expectedBucketKey), hex);
      assert.equal(Number((BigInt('0x' + fnv1a64Hex(key)) >> 10n) & 15n).toString(16), subIdx);
      verifiedLookup++;
    }
  }
}
assert.equal(verifiedProfiles, 19566);
assert.ok(verifiedLookup >= 456129 + addedSynonymKeys);
assert.equal(verifiedPilotProfiles, pilot.pilot_anchors.length);
assert.ok(verifiedOrthProfiles >= orthMap.size);
}

let verifiedVerses = 0;
let verifiedXrefVerses = 0;
for (let c = 0; c < 488; c++) {
  const hex = c.toString(16).padStart(3, '0');
  const d = readGzJson(path.join(verseDir, `chunk-${hex}.json.gz`));
  assert.equal(d.schema_version, 'r10-b64gz-1');
  for (const [vidStr, b64] of Object.entries(d.verses || {})) {
    const v = decodeB64Gz(b64);
    const sum = d.summaries[vidStr];
    assert.deepEqual(sum, [v.book, v.chapter, v.verse, v.ref, v.en || '', v.mt_ref ?? null]);
    verifiedVerses++;
  }
  verifiedXrefVerses += Object.keys(d.xrefs || {}).length;
}
assert.equal(verifiedVerses, 31203);
assert.ok(verifiedXrefVerses > 20000, `Expected embedded xrefs across chunks, got ${verifiedXrefVerses}`);

let verifiedEvCoords = 0;
for (let b = 1; b <= 66; b++) {
  const pad = String(b).padStart(2, '0');
  const d = readGzJson(path.join(evDir, `book-${pad}.json.gz`));
  assert.equal(d.schema_version, 'r10-book-index-1');
  verifiedEvCoords += Object.keys(d.coord_to_vid || {}).length;
}
assert.equal(verifiedEvCoords, 31203);

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]
  );
const files = walk(root);
assert.equal(files.length, 20000, `Expected exactly 20000 files, got ${files.length}`);
assert.ok(!files.some((p) => p.endsWith('.r12-tmp')), 'Unexpected temporary file found');

let maxIndividualFileBytes = 0;
let maxIndividualFilePath = '';
const digest = crypto.createHash('sha256');
for (const p of files.sort()) {
  const stat = fs.statSync(p);
  assert.ok(stat.size <= 25 * 1024 * 1024, `File exceeds 25 MiB: ${p} (${stat.size})`);
  if (stat.size > maxIndividualFileBytes) {
    maxIndividualFileBytes = stat.size;
    maxIndividualFilePath = path.relative(root, p).replaceAll('\\', '/');
  }
  digest.update(path.relative(root, p).replaceAll('\\', '/'));
  digest.update(
    crypto.createHash('sha256').update(fs.readFileSync(p)).digest(),
  );
}
const assetSha256 = digest.digest('hex');

const summary = {
  release: 'r13-discovery-3',
  staging_root: root,
  total_files: files.length,
  max_individual_file_bytes: maxIndividualFileBytes,
  max_individual_file_path: maxIndividualFilePath,
  profiles_enriched: enrichedCount,
  orth_entries_attached: orthAttachedCount,
  r13_wordplay_lemmas: r13WordplayCount,
  r13_colloc_lemmas: r13CollocCount,
  r13_self_interpretations: r13SelfInterpretations.length,
  r13_motifs: minedMotifsRes.motifs.length,
  pilot_anchors_attached: pilotAttachedCount,
  verses_with_embedded_frames: versesWithFrames,
  lookup_entries_routed: verifiedLookup,
  synonym_keys_added: addedSynonymKeys,
  synonym_entries_added: addedSynonymEntries,
  lookup_non_empty_sub_buckets: totalSubBuckets,
  verses_written: writtenVerses,
  verses_with_embedded_xrefs: versesWithXrefs,
  verses_with_embedded_events: versesWithEvents,
  verses_with_embedded_scenes: versesWithScenes,
  scenes_stream_a: streamACount,
  scenes_stream_b: streamBCount,
  scenes_stream_c: streamCCount,
  evidence_book_coords_written: evBookVersesTotal,
  fast_profiles_max_outer_bytes: maxFastProfileOuterBytes,
  fast_profiles_max_raw_bytes: maxFastProfileRawBytes,
  fast_profiles_max_shard: maxFastProfileShard,
  fast_verses_max_outer_bytes: maxFastVerseOuterBytes,
  fast_verses_max_raw_bytes: maxFastVerseRawBytes,
  fast_verses_max_chunk: maxFastVerseChunk,
  explicit_and_typology_gz_bytes: expSizes.gzBytes,
  explicit_and_typology_raw_bytes: expSizes.rawBytes,
  explicit_and_typology_records: verifyExp.records.length,
  motifs_and_patterns_gz_bytes: mpSizes.gzBytes,
  motifs_and_patterns_raw_bytes: mpSizes.rawBytes,
  motifs_event_keywords_count: eventKeywords.length,
  fast_manifest_gz_bytes: fastManifestSizes.gzBytes,
  fast_manifest_raw_bytes: fastManifestSizes.rawBytes,
  asset_sha256: assetSha256,
  elapsed_ms: Date.now() - tStart,
};

console.log(JSON.stringify(summary, null, 2));
