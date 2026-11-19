/**
 * Offline R12 Discovery Compiler (r12-discovery-2 / r12-ranker-v2).
 *
 * Reads the already-built R8/R11 packed staging bundle in .artifacts-r12/staging-bundle
 * plus the pinned external OEWN 2025 + Wikidata fixture scripts/fixtures/r12-external-pilot.json.
 * Compiles:
 *  1) 2-5 meaningful-hop beam-search recommendations & proof paths using the canonical TS
 *     path ranker (src/relationships/path-ranker.ts, r12-ranker-v2 with endpoint coherence K)
 *  2) Sense-aware real-world physical property bridges (OEWN 2025 CC BY 4.0 + Wikidata CC0 1.0)
 *  3) Independent multi-family structural scene candidates from R8 grammatical clause features
 *  4) Distinct-root co-occurrence-prioritized orthographic word-form candidates
 *
 * Writes ONE compressed asset file:
 *   .artifacts-r12/staging-bundle/v2/relationships/r11-v1.0/r10/r12-pilot.json.gz
 * so total files stay <= 20,000 (Cloudflare Workers Static Assets limit) with all R3-R11 releases intact.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {
  R12_SCORE_VERSION,
  scoreR12Path,
  rankR12DiscoveryDestinations,
} from '../src/relationships/path-ranker.ts';
import { buildPropertyIndex, findPropertyBridges } from '../research/r12/property-bridges.mjs';
import { buildStructuralIndex, findStructuralCandidates } from '../research/r12/structural-candidates.mjs';
import { buildOrthographicIndex, findOrthographicCandidates } from '../research/r12/orthographic-candidates.mjs';

const root = path.resolve(process.argv[2] || '.artifacts-r12/staging-bundle');
const r10Dir = path.join(root, 'v2/relationships/r11-v1.0/r10');
const extPath = path.resolve('scripts/fixtures/r12-external-pilot.json');
assert.ok(fs.existsSync(r10Dir), `Missing ${r10Dir}`);
assert.ok(fs.existsSync(extPath), `Missing ${extPath}`);

const packedCache = new Map();
function readR10PackedJson(filePath) {
  const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)));
  if (d.schema_version !== 'r10-packed-1') return d;
  const pairs = Object.entries(d.entries).map(([key, [blob, start, length]]) => {
    const blobPath = path.join(r10Dir, blob);
    if (!packedCache.has(blobPath)) packedCache.set(blobPath, fs.readFileSync(blobPath));
    const bytes = packedCache.get(blobPath).subarray(start, start + length);
    const val = JSON.parse(bytes[0] === 31 && bytes[1] === 139 ? zlib.gunzipSync(bytes) : bytes);
    if (d.reference_keys) {
      const { verse_id, ...orig } = val;
      return [String(verse_id), orig];
    }
    return [key, val];
  });
  return { [d.field]: d.pairs ? pairs : Object.fromEntries(pairs) };
}

function writeGzipJson(filePath, data) {
  const tmp = filePath + '.r12-tmp';
  fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(data), { level: 9 }));
  fs.renameSync(tmp, filePath);
}

// Core 48-anchor seed set (24 Hebrew + 24 Greek) plus systematic cross-layer expansion
const CORE_PILOT_ANCHORS = [
  'H7307', 'H5869', 'H0875', 'H4325', 'H5216', 'H4501', 'H3940', 'H8081',
  'H8144', 'H0231', 'H0730', 'H7416', 'H1904', 'H0120', 'H0127', 'H1818',
  'H5397', 'H2091', 'H5178', 'H2233', 'H3899', 'H0068', 'H3532', 'H1285',
  'G4151', 'G3056', 'G3088', 'G3087', 'G2985', 'G3788', 'G4077', 'G5421',
  'G5204', 'G2847', 'G5301', 'G3037', 'G4703', 'G4690', 'G0740', 'G0129',
  'G5207', 'G2283', 'G4477', 'G5093', 'G5590', 'G5457', 'G0286', 'G1242',
];

// Intermediate routing stop-hubs (particles, pronouns, light/auxiliary verbs, generic hyper-frequent nouns).
// Never block these when explicitly queried as a starting anchor.
const STOP_HUB_STRONGS = new Set([
  'H0853', 'H0413', 'H5921', 'H3588', 'H0834', 'H4480', 'H0559', 'H3068', 'H0430', 'H1121', 'H3605', 'H0376',
  'H1961', 'H6213', 'H0935', 'H5414', 'H1980', 'H7200', 'H3947', 'H3318', 'H0582', 'H1931', 'H0859', 'H0589',
  'H2088', 'H3117', 'H1004', 'H0776', 'H3027', 'H5971', 'H4428', 'H1697', 'H8034', 'H1323', 'H3205',
  'H3509', 'H0428', 'H0369', 'H3808',
  'G3588', 'G2532', 'G1161', 'G0846', 'G1722', 'G1519', 'G3754', 'G2316', 'G2962', 'G1510', 'G3956', 'G3004',
  'G1473', 'G4771', 'G3778', 'G3739', 'G5100', 'G5101', 'G1096', 'G4160', 'G2192', 'G2064', 'G0444', 'G2250', 'G3962',
  'G1909', 'G3844', 'G1223', 'G0575', 'G2596', 'G3326', 'G4314', 'G1537', 'G5259', 'G4012', 'G1487', 'G2443',
  'G5613', 'G1063', 'G3767', 'G3762', 'G3650', 'G1520', 'G1438',
]);

console.log('Loading lemma-profiles from staging bundle...');
const profiles = new Map();
for (const f of fs.readdirSync(path.join(r10Dir, 'lemma-profiles')).sort()) {
  const d = readR10PackedJson(path.join(r10Dir, 'lemma-profiles', f));
  for (const [bs, prof] of Object.entries(d.entries || {})) {
    profiles.set(bs, prof);
  }
}
console.log(`Loaded ${profiles.size} lemma profiles.`);

const extData = JSON.parse(fs.readFileSync(extPath, 'utf8'));

// Verify every core pilot anchor exists
for (const bs of CORE_PILOT_ANCHORS) {
  assert.ok(profiles.has(bs), `Pilot anchor missing from lemma-profiles: ${bs}`);
}

const anchorSet = new Set(CORE_PILOT_ANCHORS);
for (const m of extData.external_mappings || []) {
  const bs = String(m.anchor_id || '').replace(/^lemma:/, '');
  if (bs && profiles.has(bs)) anchorSet.add(bs);
}
const autoCandidates = [];
for (const [bs, prof] of profiles) {
  if (anchorSet.has(bs) || STOP_HUB_STRONGS.has(bs)) continue;
  const tv = prof.total_verses || 0;
  if (tv < 5 || tv > 900) continue;
  const lxxCnt = (prof.lxx_relations || []).length;
  const gramCnt = (prof.grammatical_relations || []).length;
  const lexCnt = (prof.lexical_relations || []).length;
  if (lxxCnt > 0 && (gramCnt > 0 || lexCnt > 0)) {
    autoCandidates.push({
      bs,
      lang: prof.lang === 'grc' ? 'grc' : 'hbo',
      score: gramCnt * 2 + lxxCnt * 3 + lexCnt * 2 + Math.log1p(tv),
    });
  }
}
autoCandidates.sort((a, b) => b.score - a.score || a.bs.localeCompare(b.bs));
const otExtra = autoCandidates.filter((c) => c.lang === 'hbo').slice(0, 90);
const ntExtra = autoCandidates.filter((c) => c.lang === 'grc').slice(0, 90);
for (const c of [...otExtra, ...ntExtra]) {
  if (anchorSet.size >= 250) break;
  anchorSet.add(c.bs);
}
const PILOT_ANCHORS = [...anchorSet];
const PILOT_SET = new Set(PILOT_ANCHORS);
console.log(`Selected ${PILOT_ANCHORS.length} systematic R12 anchors (core=${CORE_PILOT_ANCHORS.length}, expanded=${PILOT_ANCHORS.length - CORE_PILOT_ANCHORS.length}).`);

// Load compact passage lookup by verse_id, ref, and coord from fast-verses (handles r10-b64gz-1 & r10-packed-1)
const verseByVid = new Map();
const verseByRef = new Map();
const verseByCoord = new Map();
const rawVerseChunkByVid = new Map();
const verseToksCache = new Map();

function decodeB64GzJson(b64) {
  return JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
}

function getVerseTokens(vid) {
  const cached = verseToksCache.get(vid);
  if (cached !== undefined) return cached;
  const rawB64 = rawVerseChunkByVid.get(vid);
  if (!rawB64) {
    verseToksCache.set(vid, []);
    return [];
  }
  const vObj = typeof rawB64 === 'string' ? decodeB64GzJson(rawB64) : rawB64;
  const toks = Array.isArray(vObj?.toks) ? vObj.toks : [];
  verseToksCache.set(vid, toks);
  return toks;
}

for (const f of fs.readdirSync(path.join(r10Dir, 'fast-verses')).sort()) {
  const filePath = path.join(r10Dir, 'fast-verses', f);
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)));
  if (raw.schema_version === 'r10-b64gz-1') {
    for (const [vidStr, sum] of Object.entries(raw.summaries || {})) {
      const vid = Number(vidStr);
      const [book, chapter, verse, ref, en, mt_ref] = sum;
      const entry = {
        verse_id: vid,
        ref,
        ...(mt_ref !== undefined && mt_ref !== null ? { mt_ref } : {}),
        book,
        chapter,
        verse,
        testament: book <= 39 ? 'OT' : 'NT',
        snippet: String(en || '').slice(0, 180),
      };
      verseByVid.set(vid, entry);
      verseByRef.set(ref, entry);
      verseByCoord.set(`${book}:${chapter}:${verse}`, entry);
      if (raw.verses?.[vidStr]) rawVerseChunkByVid.set(vid, raw.verses[vidStr]);
    }
  } else {
    const d = readR10PackedJson(filePath);
    for (const [vidStr, v] of Object.entries(d.verses || {})) {
      const vid = Number(vidStr);
      const entry = {
        verse_id: vid,
        ref: v.ref,
        ...(v.mt_ref !== undefined && v.mt_ref !== null ? { mt_ref: v.mt_ref } : {}),
        book: v.book,
        chapter: v.chapter,
        verse: v.verse,
        testament: v.book <= 39 ? 'OT' : 'NT',
        snippet: (v.en || '').slice(0, 180),
      };
      verseByVid.set(vid, entry);
      verseByRef.set(v.ref, entry);
      verseByCoord.set(`${v.book}:${v.chapter}:${v.verse}`, entry);
      rawVerseChunkByVid.set(vid, v);
    }
  }
}
console.log(`Loaded ${verseByVid.size} verse summaries.`);

const clamp01 = (x) => Math.max(0.05, Math.min(1, x));
const TOTAL_VERSES = 31203;

function isProperEntity(prof) {
  return Boolean(prof?.entity_kind === 'proper_name' || /-P$|--T$/.test(prof?.pos || ''));
}

// Build in-memory multi-layer typed graph and verse/chapter incidence maps across all loaded lemma-profiles
const adj = new Map(); // nodeId -> edge[]
const seenEdgeIds = new Set();
const nodeMeta = new Map(); // nodeId -> { label, script, gloss, tr, lang, total_verses, proper_entity }
const vidSetByBs = new Map();
const chapSetByBs = new Map();
const lxxTargetsByBs = new Map();
const lexSiblingsByBs = new Map();
const vidToLemmas = new Map();

function ensureNodeMeta(id, meta) {
  if (!nodeMeta.has(id)) nodeMeta.set(id, meta);
}
for (const [bs, prof] of profiles) {
  const proper = isProperEntity(prof);
  ensureNodeMeta(`lemma:${bs}`, {
    id: `lemma:${bs}`,
    bs,
    lang: prof.lang,
    script: prof.sc,
    tr: prof.tr,
    gl: prof.gl,
    total_verses: prof.total_verses || 1,
    proper_entity: proper,
  });
  const vids = new Set(prof.all_vids || []);
  vidSetByBs.set(bs, vids);
  const chaps = new Set();
  for (const vid of vids) {
    const v = verseByVid.get(vid);
    if (v) chaps.add(`${v.book}:${v.chapter}`);
    let list = vidToLemmas.get(vid);
    if (!list) {
      list = [];
      vidToLemmas.set(vid, list);
    }
    list.push(bs);
  }
  chapSetByBs.set(bs, chaps);
}

function addEdge(edge) {
  if (seenEdgeIds.has(edge.edge_id)) return;
  seenEdgeIds.add(edge.edge_id);
  if (!adj.has(edge.from_id)) adj.set(edge.from_id, []);
  adj.get(edge.from_id).push(edge);
}

// Compute outgoing degree proxy to calculate hub degrees & IDF
for (const [bs, prof] of profiles) {
  const fromId = `lemma:${bs}`;
  const df = Math.max(1, prof.total_verses || 1);
  const idfBase = Math.log((TOTAL_VERSES + 1) / (df + 1)) + 1;

  // 1) Attested grammatical relations (TEXTUAL layer)
  for (const gr of prof.grammatical_relations || []) {
    const targetBs = gr.related_strongs;
    if (!targetBs || targetBs === bs || !profiles.has(targetBs)) continue;
    const toId = `lemma:${targetBs}`;
    const targetProf = profiles.get(targetBs);
    const targetDf = Math.max(1, targetProf.total_verses || 1);
    const edgeIdf = Math.min(idfBase, Math.log((TOTAL_VERSES + 1) / (targetDf + 1)) + 1);
    const witnesses = (gr.witnesses || []).slice(0, 4);
    const attestationGroups = witnesses
      .map((w) => `gram:${w.clause_key || w.ref || ''}`)
      .filter((x) => x !== 'gram:');
    if (attestationGroups.length === 0) {
      attestationGroups.push(`gram_summary:${[bs, targetBs].sort().join('<->')}:${gr.predicate}`);
    }
    const passageIds = witnesses.map((w) => w.ref || w.passage?.ref).filter(Boolean);
    const occ = Math.max(1, gr.independent_witness_count || gr.occurrences || 1);
    const qWeight = clamp01((gr.witness_status === 'verified_matching_witness' ? 0.84 : 0.72) + Math.min(0.14, Math.log2(1 + occ) * 0.03));

    addEdge({
      edge_id: `e:gram:${bs}:${gr.predicate}:${gr.direction}:${targetBs}`,
      from_id: fromId,
      to_id: toId,
      layer: 'grammatical',
      relation_type: `gram_${gr.predicate}`,
      direction: gr.direction === 'incoming' ? 'reverse' : 'forward',
      epistemic_layer: 'TEXTUAL',
      quality_weight: Number(qWeight.toFixed(6)),
      administrative: false,
      mapping_status: 'verified',
      proper_entity: isProperEntity(targetProf),
      source_verse_count: prof.total_verses || 1,
      attestation_groups: [...new Set(attestationGroups)].sort(),
      passage_ids: [...new Set(passageIds)].sort(),
      feature_idf: Number(edgeIdf.toFixed(6)),
      intermediate_degree: targetProf.total_verses || 0,
      source_dataset: 'MACULA Grammar',
      sample_passages: witnesses.map((w) => w.passage || verseByRef.get(w.ref)).filter(Boolean),
    });
  }

  // 2) Attested lexical relations (LINGUISTIC layer; root join or direct lexical sibling)
  for (const lr of prof.lexical_relations || []) {
    const targetBs = lr.target_strongs;
    if (!targetBs || targetBs === bs || !profiles.has(targetBs)) continue;
    if (lr.type === 'shares_root' || lr.type === 'same_root') {
      if (!lexSiblingsByBs.has(bs)) lexSiblingsByBs.set(bs, new Set());
      lexSiblingsByBs.get(bs).add(targetBs);
    }
    const toId = `lemma:${targetBs}`;
    const targetProf = profiles.get(targetBs);
    const pairKey = [bs, targetBs].sort().join('<->');
    const relType = `lex_${lr.type || 'lexical_relation'}`;
    addEdge({
      edge_id: `e:lex:${bs}:${lr.type || 'rel'}:${targetBs}`,
      from_id: fromId,
      to_id: toId,
      layer: 'lexical',
      relation_type: relType,
      direction: 'symmetric',
      epistemic_layer: 'LINGUISTIC',
      quality_weight: lr.type === 'shares_root' || lr.type === 'same_root' ? 0.88 : 0.80,
      administrative: false,
      mapping_status: 'verified',
      proper_entity: isProperEntity(targetProf),
      source_verse_count: prof.total_verses || 1,
      attestation_groups: [`lex:step:${lr.type || 'root'}:${pairKey}`],
      passage_ids: (prof.all_vids || []).slice(0, 2).map((v) => verseByVid.get(v)?.ref).filter(Boolean),
      feature_idf: Number(Math.min(idfBase, Math.log((TOTAL_VERSES + 1) / (Math.max(1, targetProf.total_verses) + 1)) + 1).toFixed(6)),
      intermediate_degree: targetProf.total_verses || 0,
      source_dataset: 'STEPBible Lexicon',
      sample_passages: (prof.all_vids || []).slice(0, 2).map((v) => verseByVid.get(v)).filter(Boolean),
    });
  }

  // 3) LXX CATSS/Swete translation correspondences (LINGUISTIC cross-language bridge, bidirectional)
  for (const lx of prof.lxx_relations || []) {
    const targetBs = lx.target_strongs;
    if (!targetBs || targetBs === bs || !profiles.has(targetBs)) continue;
    if (!lxxTargetsByBs.has(bs)) lxxTargetsByBs.set(bs, []);
    lxxTargetsByBs.get(bs).push({ targetBs, refs: (lx.sample_refs || []).slice(0, 4) });
    if (!lxxTargetsByBs.has(targetBs)) lxxTargetsByBs.set(targetBs, []);
    lxxTargetsByBs.get(targetBs).push({ targetBs: bs, refs: (lx.sample_refs || []).slice(0, 4) });

    const toId = `lemma:${targetBs}`;
    const targetProf = profiles.get(targetBs);
    const pairKey = [bs, targetBs].sort().join('<->');
    const cleanRefs = (lx.sample_refs || []).slice(0, 4).filter(Boolean);
    const samplePassages = cleanRefs.map((r) => verseByRef.get(r)).filter(Boolean);
    const qWeight = clamp01(0.74 + Math.min(0.18, Math.log2(1 + (lx.count || 1)) * 0.03));
    const fwdEdge = {
      edge_id: `e:lxx:${bs}:${lx.type || 'bridge'}:${targetBs}`,
      from_id: fromId,
      to_id: toId,
      layer: 'lxx_translation',
      relation_type: 'lxx_translation_bridge',
      direction: bs.startsWith('H') ? 'forward' : 'reverse',
      epistemic_layer: 'LINGUISTIC',
      quality_weight: Number(qWeight.toFixed(6)),
      administrative: false,
      mapping_status: 'verified',
      proper_entity: isProperEntity(targetProf),
      source_verse_count: prof.total_verses || 1,
      attestation_groups: [`lxx:catss:${pairKey}`],
      passage_ids: cleanRefs,
      feature_idf: Number(Math.log((TOTAL_VERSES + 1) / (Math.max(1, Math.min(df, targetProf.total_verses || 1)) + 1)).toFixed(6)),
      intermediate_degree: targetProf.total_verses || 0,
      source_dataset: 'CATSS/Swete LXX',
      sample_passages: samplePassages,
    };
    addEdge(fwdEdge);
    addEdge({
      ...fwdEdge,
      edge_id: `e:lxx:${targetBs}:${lx.type || 'bridge'}:${bs}`,
      from_id: toId,
      to_id: fromId,
      direction: targetBs.startsWith('G') ? 'reverse' : 'forward',
      proper_entity: isProperEntity(prof),
      source_verse_count: targetProf.total_verses || 1,
      intermediate_degree: prof.total_verses || 0,
    });
  }

  // 4) Contextual collocation edges from clusters (HYPOTHESIS layer, low base weight)
  for (const cl of (prof.clusters || []).slice(0, 3)) {
    const clPassages = (cl.sample_passages || []).slice(0, 3);
    for (const cw of (cl.collocated_words || []).slice(0, 5)) {
      const targetBs = cw.bs;
      if (!targetBs || targetBs === bs || !profiles.has(targetBs)) continue;
      if (STOP_HUB_STRONGS.has(targetBs)) continue;
      const targetProf = profiles.get(targetBs);
      const targetDf = Math.max(1, targetProf.total_verses || 1);
      if (targetDf > 1200) continue;
      const qWeight = Math.max(0.32, Math.min(0.46, 0.32 + Math.log2(1 + (cw.hits || 1)) * 0.03));
      addEdge({
        edge_id: `e:ctx:${bs}:${cl.cluster_id}:${targetBs}`,
        from_id: fromId,
        to_id: `lemma:${targetBs}`,
        layer: 'contextual',
        relation_type: 'contextual_collocation',
        direction: 'undirected',
        epistemic_layer: 'HYPOTHESIS',
        quality_weight: Number(qWeight.toFixed(6)),
        administrative: false,
        mapping_status: 'verified',
        proper_entity: isProperEntity(targetProf),
        source_verse_count: prof.total_verses || 1,
        attestation_groups: clPassages.map((p) => `ctx:${p.ref}:${[bs, targetBs].sort().join('<->')}`),
        passage_ids: clPassages.map((p) => p.ref),
        feature_idf: Number(Math.min(6, Math.log((TOTAL_VERSES + 1) / (targetDf + 1))).toFixed(6)),
        intermediate_degree: targetDf,
        source_dataset: 'MACULA Contextual Collocation',
        sample_passages: clPassages,
      });
    }
  }
}

// Sort and diversify per-node adjacency deterministically
function diversifiedOutEdges(nodeId, limit = 16) {
  const raw = adj.get(nodeId) || [];
  if (raw.length === 0) return [];
  const sorted = [...raw].sort((a, b) => {
    const sa = a.quality_weight * (a.feature_idf || 1);
    const sb = b.quality_weight * (b.feature_idf || 1);
    if (sb !== sa) return sb - sa;
    return a.edge_id.localeCompare(b.edge_id);
  });
  const byLayer = { grammatical: [], lexical: [], lxx_translation: [], contextual: [] };
  for (const e of sorted) {
    if (!STOP_HUB_STRONGS.has(e.to_id.replace('lemma:', '')) && (byLayer[e.layer]?.length ?? 0) < 6) {
      (byLayer[e.layer] ||= []).push(e);
    }
  }
  const picked = [];
  const seenEdge = new Set();
  for (const bucket of Object.values(byLayer)) {
    for (const e of bucket) {
      if (picked.length >= limit) break;
      if (!seenEdge.has(e.edge_id)) {
        seenEdge.add(e.edge_id);
        picked.push(e);
      }
    }
  }
  for (const e of sorted) {
    if (picked.length >= limit) break;
    if (STOP_HUB_STRONGS.has(e.to_id.replace('lemma:', ''))) continue;
    if (!seenEdge.has(e.edge_id)) {
      seenEdge.add(e.edge_id);
      picked.push(e);
    }
  }
  return picked;
}

const endpointCtxCache = new Map();
function computeEndpointContext(anchorBs, targetBs, steps) {
  const pairKey = `${anchorBs}|${targetBs}`;
  let pairCtx = endpointCtxCache.get(pairKey);
  if (!pairCtx) {
    const aVids = vidSetByBs.get(anchorBs) || new Set();
    const tVids = vidSetByBs.get(targetBs) || new Set();
    const directVids = [];
    const [smaller, larger] = aVids.size <= tVids.size ? [aVids, tVids] : [tVids, aVids];
    for (const vid of smaller) {
      if (larger.has(vid)) {
        directVids.push(vid);
        if (directVids.length >= 6) break;
      }
    }
    const directPassages = directVids.map((vid) => verseByVid.get(vid)).filter(Boolean);
    const directRefs = directPassages.map((p) => p.ref);

    const bridgePassages = [];
    const bridgeRefs = new Set();
    for (const lx of lxxTargetsByBs.get(anchorBs) || []) {
      if (lx.targetBs === targetBs) {
        for (const r of lx.refs || []) {
          bridgeRefs.add(r);
          const p = verseByRef.get(r);
          if (p) bridgePassages.push(p);
          if (bridgeRefs.size >= 4) break;
        }
      } else {
        const lVids = vidSetByBs.get(lx.targetBs);
        if (lVids) {
          for (const vid of tVids) {
            if (lVids.has(vid)) {
              const p = verseByVid.get(vid);
              if (p && !bridgeRefs.has(p.ref)) {
                bridgeRefs.add(p.ref);
                bridgePassages.push(p);
                if (bridgeRefs.size >= 4) break;
              }
            }
          }
        }
      }
      if (bridgeRefs.size >= 4) break;
    }
    if (bridgeRefs.size < 4) {
      for (const lx of lxxTargetsByBs.get(targetBs) || []) {
        const lVids = vidSetByBs.get(lx.targetBs);
        if (!lVids) continue;
        for (const vid of aVids) {
          if (lVids.has(vid)) {
            const p = verseByVid.get(vid);
            if (p && !bridgeRefs.has(p.ref)) {
              bridgeRefs.add(p.ref);
              bridgePassages.push(p);
              if (bridgeRefs.size >= 4) break;
            }
          }
        }
        if (bridgeRefs.size >= 4) break;
      }
    }

    const aChaps = chapSetByBs.get(anchorBs) || new Set();
    const tChaps = chapSetByBs.get(targetBs) || new Set();
    let sameChapterOverlap = directRefs.length > 0 || bridgeRefs.size > 0;
    if (!sameChapterOverlap) {
      for (const ch of aChaps) {
        if (tChaps.has(ch)) { sameChapterOverlap = true; break; }
      }
    }
    if (!sameChapterOverlap) {
      for (const lx of lxxTargetsByBs.get(anchorBs) || []) {
        const lChaps = chapSetByBs.get(lx.targetBs);
        if (!lChaps) continue;
        for (const ch of lChaps) {
          if (tChaps.has(ch)) { sameChapterOverlap = true; break; }
        }
        if (sameChapterOverlap) break;
      }
    }
    pairCtx = {
      direct_cooccurrence_refs: directRefs,
      lxx_bridge_cooccurrence_refs: [...bridgeRefs].slice(0, 4),
      same_chapter_overlap: sameChapterOverlap,
      direct_witnesses: directPassages.slice(0, 4),
      bridge_witnesses: bridgePassages.slice(0, 4),
    };
    endpointCtxCache.set(pairKey, pairCtx);
  }
  const semanticSteps = steps.filter((s) => !s.administrative);
  const intermediateVerseCounts = [];
  const intermediateIsProper = [];
  for (let i = 0; i < semanticSteps.length - 1; i++) {
    const midBs = String(semanticSteps[i].to_id || '').replace(/^lemma:/, '');
    const midProf = profiles.get(midBs);
    intermediateVerseCounts.push(midProf?.total_verses || semanticSteps[i].intermediate_degree || 0);
    intermediateIsProper.push(isProperEntity(midProf));
  }
  return {
    pairCtx,
    endpoint_context: {
      direct_cooccurrence_refs: pairCtx.direct_cooccurrence_refs,
      lxx_bridge_cooccurrence_refs: pairCtx.lxx_bridge_cooccurrence_refs,
      same_chapter_overlap: pairCtx.same_chapter_overlap,
      intermediate_verse_counts: intermediateVerseCounts,
      intermediate_is_proper: intermediateIsProper,
    },
  };
}

// A. Precompute 2-5 hop beam search + canonical v2 proof ranking for every expanded anchor
console.log(`Running offline 2-5 hop beam search (${R12_SCORE_VERSION}, anchors=${PILOT_ANCHORS.length})...`);
const beamWidth = 64;
const maxMeaningfulHops = 5;
const maxPhysicalSteps = 10;
const multihopByAnchor = {};

for (const bs of PILOT_ANCHORS) {
  const anchorId = `lemma:${bs}`;
  const candidatePaths = [];
  let frontier = [{ nodeId: anchorId, steps: [], score: 0, visited: new Set([anchorId]), semHops: 0 }];
  let nodesExpanded = 0;

  for (let physDepth = 1; physDepth <= maxPhysicalSteps; physDepth++) {
    if (!frontier.length) break;
    const nextCandidates = [];
    for (const state of frontier) {
      if (nodesExpanded >= 250) break;
      nodesExpanded++;
      const edges = diversifiedOutEdges(state.nodeId, 16);
      for (const e of edges) {
        if (state.visited.has(e.to_id)) continue;
        const nextSemHops = state.semHops + (e.administrative ? 0 : 1);
        if (nextSemHops > maxMeaningfulHops) continue;
        const nextVisited = new Set(state.visited);
        nextVisited.add(e.to_id);
        const nextSteps = [...state.steps, e];
        if (nextSemHops >= 2 && !e.administrative && e.to_id !== anchorId) {
          candidatePaths.push({
            anchor_id: anchorId,
            target_id: e.to_id,
            steps: nextSteps,
          });
        }
        if (physDepth < maxPhysicalSteps && nextSemHops < maxMeaningfulHops) {
          const stepScore = e.quality_weight * 0.6 + Math.min(1, (e.feature_idf || 1) / 8) * 0.4;
          nextCandidates.push({
            nodeId: e.to_id,
            steps: nextSteps,
            score: state.score + stepScore,
            visited: nextVisited,
            semHops: nextSemHops,
          });
        }
      }
    }
    nextCandidates.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
    frontier = nextCandidates.slice(0, beamWidth);
  }

  // Deduplicate exact step chains and attach endpoint_context before calling rankR12DiscoveryDestinations
  const uniquePaths = [];
  const seenKeys = new Set();
  for (const cp of candidatePaths.slice(0, 600)) {
    const key = cp.steps.map((s) => s.edge_id).join('>');
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      const targetBs = cp.target_id.replace('lemma:', '');
      const { endpoint_context } = computeEndpointContext(bs, targetBs, cp.steps);
      uniquePaths.push({ ...cp, endpoint_context });
    }
  }

  const ranked = uniquePaths.length > 0
    ? rankR12DiscoveryDestinations(uniquePaths, { limit: 24, mmrPenalty: 0.12 })
    : { top: [], coverage: 'complete_candidate_pool', unreturned_destinations: 0, pruned_incoherent_count: 0 };

  const packPath = (p) => {
    const endpointMeta = nodeMeta.get(p.target_id);
    return {
      path_id: `r12:path:${bs}:${p.target_id.replace('lemma:', '')}:${Buffer.from(p.path_key).toString('base64url').slice(0, 12)}`,
      path_key: p.path_key,
      anchor_id: p.anchor_id,
      target_id: p.target_id,
      target_word: endpointMeta
        ? { strongs: endpointMeta.bs, language: endpointMeta.lang, script: endpointMeta.script, transliteration: endpointMeta.tr, gloss: endpointMeta.gl }
        : null,
      meaningful_hops: p.steps.filter((s) => !s.administrative).length,
      physical_hops: p.steps.length,
      K: p.K,
      endpoint_coherence: p.endpoint_coherence,
      endpoint_epistemic_status: p.endpoint_epistemic_status,
      epistemic_status: p.epistemic_status,
      partial_interest: p.partial_interest,
      score_parts: p.score_parts,
      independent_evidence_groups: p.independent_evidence_groups,
      passage_ids: p.passage_ids.slice(0, 6),
      steps: p.steps.map((s) => ({
        edge_id: s.edge_id,
        from_id: s.from_id,
        from_label: nodeMeta.get(s.from_id)?.script ? `${nodeMeta.get(s.from_id).script} (${nodeMeta.get(s.from_id).gl})` : s.from_id,
        to_id: s.to_id,
        to_label: nodeMeta.get(s.to_id)?.script ? `${nodeMeta.get(s.to_id).script} (${nodeMeta.get(s.to_id).gl})` : s.to_id,
        relation_type: s.relation_type,
        direction: s.direction,
        epistemic_layer: s.epistemic_layer,
        quality_weight: s.quality_weight,
        administrative: Boolean(s.administrative),
        source_dataset: s.source_dataset,
        witness_refs: (s.passage_ids || []).slice(0, 3),
        witness_passages: (s.sample_passages || []).slice(0, 2),
      })),
    };
  };

  multihopByAnchor[bs] = {
    anchor_id: anchorId,
    candidate_paths_evaluated: uniquePaths.length,
    pruned_incoherent_count: ranked.pruned_incoherent_count || 0,
    coverage: ranked.coverage,
    unreturned_destinations: ranked.unreturned_destinations,
    recommendations: ranked.top.slice(0, 24).map((rec) => {
      const targetBs = rec.target_id.replace('lemma:', '');
      const tMeta = nodeMeta.get(rec.target_id);
      const bestPacked = packPath(rec.paths[0]);
      const altPacked = rec.paths.slice(1, 4).map(packPath);
      const pairKey = `${bs}|${targetBs}`;
      const pairCtx = endpointCtxCache.get(pairKey);
      return {
        evidence_id: `r12:path:${bs}:${targetBs}`,
        anchor_id: rec.anchor_id,
        target_id: rec.target_id,
        target_word: tMeta
          ? { strongs: tMeta.bs, language: tMeta.lang, script: tMeta.script, transliteration: tMeta.tr, gloss: tMeta.gl }
          : null,
        score_version: R12_SCORE_VERSION,
        interest: rec.interest,
        mmr_score: rec.mmr_score,
        Q: rec.best_path_quality,
        K: rec.K ?? bestPacked.K,
        endpoint_coherence: rec.endpoint_coherence,
        endpoint_epistemic_status: rec.endpoint_epistemic_status,
        C: rec.convergence,
        D: rec.paths[0].score_parts.D,
        T: rec.paths[0].score_parts.T,
        hub_penalty: rec.paths[0].score_parts.hub_penalty,
        step_support_group_count: rec.step_support_group_count ?? rec.support_group_count,
        endpoint_support_group_count: rec.endpoint_support_group_count ?? 0,
        independent_group_count: rec.support_group_count,
        independent_evidence_groups: bestPacked.independent_evidence_groups.slice(0, 12),
        direct_endpoint_witnesses: pairCtx?.direct_witnesses || [],
        endpoint_bridge_witnesses: pairCtx?.bridge_witnesses || [],
        epistemic_layer: bestPacked.steps.some((st) => st.epistemic_layer === 'HYPOTHESIS') ? 'HYPOTHESIS' : bestPacked.steps[0].epistemic_layer,
        evidence_status: rec.evidence_status,
        best_path: bestPacked,
        alternative_paths: altPacked,
        limitation: rec.limitation,
      };
    }),
  };
}

// B. Precompute Physical-World Property Bridges using research/r12/property-bridges.mjs
console.log('Running offline physical-world property bridges...');
const propIndex = buildPropertyIndex(extData.property_assertions);
const propertyBridgesByAnchor = {};

for (const bs of PILOT_ANCHORS) {
  const anchorId = `lemma:${bs}`;
  const rawRes = findPropertyBridges(propIndex, anchorId, { maxDocumentFrequency: 18, limit: 12 });
  if (!rawRes.results.length) continue;
  const anchorProf = profiles.get(bs);
  const anchorPassages = (anchorProf?.all_vids || []).slice(0, 3).map((v) => verseByVid.get(v)).filter(Boolean);
  const seenPropIds = new Set();

  propertyBridgesByAnchor[bs] = rawRes.results.map((b) => {
    const targetBs = b.target_id.replace('lemma:', '');
    const targetProf = profiles.get(targetBs);
    const targetPassages = (targetProf?.all_vids || []).slice(0, 3).map((v) => verseByVid.get(v)).filter(Boolean);
    const topFeat = b.shared_features[0];
    const leftClaim = topFeat?.left?.[0];
    const rightClaim = topFeat?.right?.[0];
    const leftExtMap =
      extData.external_mappings.find((m) => m.sense_id && m.sense_id === b.anchor_sense_id) ||
      extData.external_mappings.find((m) => m.anchor_id === anchorId) ||
      null;
    const rightExtMap =
      extData.external_mappings.find((m) => m.sense_id && m.sense_id === b.target_sense_id) ||
      extData.external_mappings.find((m) => m.anchor_id === b.target_id) ||
      null;
    const valueConcept = extData.wikidata_concepts?.[topFeat?.feature?.value_id] || extData.oewn_concepts?.[topFeat?.feature?.value_id];
    let propId = `r12:prop:${bs}:${targetBs}`;
    if (seenPropIds.has(propId)) {
      propId = `r12:prop:${bs}:${targetBs}:${b.target_sense_id || b.anchor_sense_id || seenPropIds.size}`;
    }
    seenPropIds.add(propId);

    return {
      evidence_id: propId,
      anchor_id: anchorId,
      target_id: b.target_id,
      anchor_sense_id: b.anchor_sense_id || bs,
      target_sense_id: b.target_sense_id || targetBs,
      anchor_word: anchorProf ? { strongs: anchorProf.bs, language: anchorProf.lang, script: anchorProf.sc, transliteration: anchorProf.tr, gloss: anchorProf.gl } : null,
      target_word: targetProf ? { strongs: targetProf.bs, language: targetProf.lang, script: targetProf.sc, transliteration: targetProf.tr, gloss: targetProf.gl } : null,
      relation_type: b.relation_type,
      bridge_kind: b.bridge_kind || 'shared_external_property',
      assertion_origin: b.assertion_origin || 'EXTERNAL_ASSERTION',
      assertion_origins: b.assertion_origins || [],
      epistemic_layer: b.epistemic_layer,
      independent_biblical_support: b.independent_biblical_support,
      score: b.score,
      property_key: topFeat?.feature?.property_key,
      value_id: topFeat?.feature?.value_id,
      value_label: valueConcept?.label || valueConcept?.members?.[0] || topFeat?.feature?.value_id,
      left_mapping: leftExtMap,
      right_mapping: rightExtMap,
      shared_features: b.shared_features.slice(0, 4).map((sf) => ({
        property_key: sf.feature.property_key,
        value_id: sf.feature.value_id,
        value_label: (extData.wikidata_concepts?.[sf.feature.value_id]?.label || extData.oewn_concepts?.[sf.feature.value_id]?.members?.[0] || sf.feature.value_id),
        rarity: sf.rarity,
        left: sf.left.slice(0, 2),
        right: sf.right.slice(0, 2),
      })),
      mapping_status: (leftClaim?.mapping_status === 'verified' && rightClaim?.mapping_status === 'verified') ? 'verified' : 'candidate',
      claim_status: leftClaim?.claim_status || 'sourced',
      passages: [...anchorPassages.slice(0, 2), ...targetPassages.slice(0, 2)],
      limitation: b.limitation,
    };
  });
}

// C. Precompute Structural Scene Candidates using independent feature families
console.log('Building multi-family grammatical/clause scenes for structural-candidates...');
const NUMERAL_STRONGS = new Set([
  'H0259', 'H8147', 'H7969', 'H0702', 'H2568', 'H8337', 'H7651', 'H8083', 'H8672', 'H6235',
  'H7970', 'H0705', 'H2572', 'H7657', 'G1520', 'G1417', 'G5140', 'G5064', 'G4002', 'G1803',
  'G2033', 'G1176', 'G1427', 'G5062', 'G1440',
]);
const SIMILE_STRONGS = new Set([
  'H3644', 'H4912', 'G5613', 'G5618', 'G2531', 'G3664', 'G3666', 'G3850',
]);
const sceneFeatureMap = new Map();
for (const bs of PILOT_ANCHORS) {
  const prof = profiles.get(bs);
  for (const gr of (prof.grammatical_relations || []).slice(0, 20)) {
    for (const w of (gr.witnesses || []).slice(0, 3)) {
      const ref = w.ref || w.passage?.ref;
      if (!ref || !w.relation_id) continue;
      if (!sceneFeatureMap.has(ref)) {
        const coord = w.coords ? `${w.coords.book}:${w.coords.chapter}:${w.coords.verse}` : '';
        const verseEntry = (coord && verseByCoord.get(coord)) || verseByRef.get(ref);
        sceneFeatureMap.set(ref, {
          id: `scene:${ref.replace(/\s+/g, '_')}`,
          ref,
          coord,
          verse_id: verseEntry?.verse_id || w.passage?.verse_id || null,
          book: w.coords?.book || verseEntry?.book || 0,
          lineage_id: `${w.coords?.book || verseEntry?.book || 0}:${w.coords?.chapter || verseEntry?.chapter || 0}`,
          witness_ids: new Set(),
          features: new Map(),
          lemmas: new Set(),
          gramParticipants: new Set(),
        });
      }
      const sc = sceneFeatureMap.get(ref);
      sc.witness_ids.add(w.relation_id);
      sc.lemmas.add(bs);
      sc.gramParticipants.add(gr.related_strongs);
      sc.features.set(`role:${gr.predicate}`, `${bs}->${gr.related_strongs}`);
      sc.features.set(`participant:${gr.related_strongs}`, 'attested');
      sc.features.set(`anchor:${bs}`, gr.predicate);
    }
  }
}

for (const sc of sceneFeatureMap.values()) {
  if (!sc.verse_id) continue;
  const toks = getVerseTokens(sc.verse_id);
  for (const t of toks) {
    const sBs = t?.s;
    if (!sBs) continue;
    const tProf = profiles.get(sBs);
    if (tProf && (tProf.total_verses || 0) <= 500 && !STOP_HUB_STRONGS.has(sBs) && !sc.lemmas.has(sBs) && !sc.gramParticipants.has(sBs)) {
      sc.features.set(`co_lemma:${sBs}`, 'verse');
    }
    if (NUMERAL_STRONGS.has(sBs)) {
      sc.features.set(`qty:${sBs}`, t.g || 'numeral');
    }
    if (SIMILE_STRONGS.has(sBs)) {
      sc.features.set(`simile:${sBs}`, t.g || 'comparison');
    }
  }
}

const eligibleScenes = [...sceneFeatureMap.values()]
  .filter((s) => s.features.size >= 4)
  .map((s) => ({
    id: s.id,
    ref: s.ref,
    coord: s.coord,
    lineage_id: s.lineage_id,
    witness_ids: [...s.witness_ids].sort(),
    lemmas: [...s.lemmas],
    features: [...s.features.entries()].map(([role, value]) => ({ role, value })),
  }));
const eligibleSceneById = new Map(eligibleScenes.map((s) => [s.id, s]));

const structIndex = buildStructuralIndex(eligibleScenes);
const structuralByAnchor = {};
const seenStructPairsByAnchor = new Map();
for (const sc of eligibleScenes) {
  const res = findStructuralCandidates(structIndex, sc.id, {
    minSharedFeatures: 2,
    minDistinctFamilies: 2,
    minWeightedJaccard: 0.25,
    maxPerScene: 4,
    maxDfFraction: 0.15,
  });
  if (!res.results.length) continue;
  for (const bs of sc.lemmas) {
    if (!PILOT_SET.has(bs)) continue;
    if (!structuralByAnchor[bs]) {
      structuralByAnchor[bs] = [];
      seenStructPairsByAnchor.set(bs, new Set());
    }
    const seenPairs = seenStructPairsByAnchor.get(bs);
    for (const m of res.results) {
      if (structuralByAnchor[bs].length >= 6) break;
      const pairKey = [m.anchor_scene_id, m.candidate_scene_id].sort().join('|');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const candScene = eligibleSceneById.get(m.candidate_scene_id);
      const p1 = (sc.coord && verseByCoord.get(sc.coord)) || verseByRef.get(sc.ref);
      const p2 = candScene ? ((candScene.coord && verseByCoord.get(candScene.coord)) || verseByRef.get(candScene.ref)) : null;
      structuralByAnchor[bs].push({
        evidence_id: `r12:struct:${bs}:${sc.id.replace('scene:', '')}:${m.candidate_scene_id.replace('scene:', '')}`,
        anchor_id: `lemma:${bs}`,
        anchor_scene_id: m.anchor_scene_id,
        candidate_scene_id: m.candidate_scene_id,
        anchor_ref: sc.ref,
        candidate_ref: candScene?.ref || m.candidate_scene_id,
        relation_type: m.relation_type,
        epistemic_layer: m.epistemic_layer,
        weighted_jaccard: m.weighted_jaccard,
        shared_feature_families: m.shared_feature_families || [],
        distinctive_shared_features: m.distinctive_shared_features,
        all_shared_feature_count: m.all_shared_feature_count,
        anchor_witness_ids: m.anchor_witness_ids.slice(0, 4),
        candidate_witness_ids: m.candidate_witness_ids.slice(0, 4),
        passages: [p1, p2].filter(Boolean),
        limitation: m.limitation,
      });
    }
  }
}

// D. Precompute Orthographic Form Candidates (distinct-root & co-occurrence prioritized)
console.log('Running orthographic-candidates over canonical lemma scripts...');
const orthInputs = [];
for (const [bs, prof] of profiles) {
  if (!prof.sc) continue;
  const language = prof.lang === 'grc' ? 'grc' : 'he';
  orthInputs.push({ id: `lemma:${bs}`, language, form: prof.sc });
}
const orthIndex = buildOrthographicIndex(orthInputs);
const orthographicByAnchor = {};
for (const bs of PILOT_ANCHORS) {
  const anchorProf = profiles.get(bs);
  const excludeIds = [];
  for (const sib of lexSiblingsByBs.get(bs) || []) {
    excludeIds.push(`lemma:${sib}`);
  }
  const cooccurrenceCounts = new Map();
  for (const vid of anchorProf?.all_vids || []) {
    for (const otherBs of vidToLemmas.get(vid) || []) {
      if (otherBs === bs) continue;
      const oid = `lemma:${otherBs}`;
      cooccurrenceCounts.set(oid, (cooccurrenceCounts.get(oid) || 0) + 1);
    }
  }
  const res = findOrthographicCandidates(orthIndex, `lemma:${bs}`, {
    minScore: 0.50,
    limit: 8,
    excludeIds,
    cooccurrenceCounts,
    preferCooccurring: true,
  });
  if (!res.results.length) continue;
  const aVids = vidSetByBs.get(bs) || new Set();
  orthographicByAnchor[bs] = res.results.map((r) => {
    const tBs = r.target_id.replace('lemma:', '');
    const tProf = profiles.get(tBs);
    const tVids = vidSetByBs.get(tBs) || new Set();
    const sharedPassages = [];
    if (r.cooccurrence_verses > 0) {
      const [sm, lg] = aVids.size <= tVids.size ? [aVids, tVids] : [tVids, aVids];
      for (const vid of sm) {
        if (lg.has(vid)) {
          const p = verseByVid.get(vid);
          if (p) sharedPassages.push(p);
          if (sharedPassages.length >= 2) break;
        }
      }
    }
    const p1 = (anchorProf?.all_vids || []).slice(0, 1).map((v) => verseByVid.get(v)).filter(Boolean);
    const p2 = (tProf?.all_vids || []).slice(0, 1).map((v) => verseByVid.get(v)).filter(Boolean);
    const mergedPassages = [...sharedPassages];
    const seenPassVids = new Set(mergedPassages.map((p) => p.verse_id));
    for (const p of [...p1, ...p2]) {
      if (!seenPassVids.has(p.verse_id)) {
        seenPassVids.add(p.verse_id);
        mergedPassages.push(p);
      }
    }
    return {
      evidence_id: `r12:orth:${bs}:${tBs}`,
      anchor_id: r.anchor_id,
      target_id: r.target_id,
      target_word: tProf ? { strongs: tProf.bs, language: tProf.lang, script: tProf.sc, transliteration: tProf.tr, gloss: tProf.gl } : null,
      relation_type: r.relation_type,
      epistemic_layer: r.epistemic_layer,
      normalization: r.normalization,
      anchor_original: r.anchor_original,
      target_form: r.target_form,
      matched_normalized_text: r.matched_normalized_text,
      score: r.score,
      raw_orthographic_score: r.raw_orthographic_score,
      cooccurrence_verses: r.cooccurrence_verses || 0,
      normalized_form_equal: r.normalized_form_equal,
      passages: mergedPassages.slice(0, 4),
      limitation: r.limitation,
    };
  });
}

// Assemble compact R12 v2 JSON bundle (1 single compressed file)
const pilotBundle = {
  schema_version: 2,
  release_id: 'r12-discovery-2',
  score_version: R12_SCORE_VERSION,
  generated_at: new Date().toISOString(),
  pilot_anchors: PILOT_ANCHORS,
  external_sources: extData.sources,
  external_mappings: extData.external_mappings,
  anchors: Object.fromEntries(
    PILOT_ANCHORS.map((bs) => {
      const prof = profiles.get(bs);
      return [
        bs,
        {
          bs,
          lang: prof.lang,
          sc: prof.sc,
          tr: prof.tr,
          gl: prof.gl,
          total_verses: prof.total_verses,
          multihop: multihopByAnchor[bs],
          property_bridges: propertyBridgesByAnchor[bs] || [],
          structural_candidates: structuralByAnchor[bs] || [],
          orthographic_candidates: orthographicByAnchor[bs] || [],
        },
      ];
    }),
  ),
};

const outPilotPath = path.join(r10Dir, 'r12-pilot.json.gz');
writeGzipJson(outPilotPath, pilotBundle);

// Update fast-manifest.json.gz so runtime discovers r12_pilot & score_version
const fastManifestPath = path.join(r10Dir, 'fast-manifest.json.gz');
const fastManifest = JSON.parse(zlib.gunzipSync(fs.readFileSync(fastManifestPath)));
fastManifest.r12_pilot = 'r12-pilot.json.gz';
fastManifest.r12_version = 'r12-discovery-2';
fastManifest.r12_score_version = R12_SCORE_VERSION;
fastManifest.r12_pilot_anchors = PILOT_ANCHORS.length;
writeGzipJson(fastManifestPath, fastManifest);

// Verify Cloudflare Limits: <= 20,000 files, every file <= 25 MiB
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
  );
const allFiles = walk(root);
const pilotSize = fs.statSync(outPilotPath).size;
assert.ok(allFiles.length <= 20000, `Asset count ${allFiles.length} exceeds 20,000 limit`);
assert.ok(pilotSize <= 25 * 1024 * 1024, `Pilot size ${pilotSize} exceeds 25 MiB limit`);

console.log({
  pilot_anchors: PILOT_ANCHORS.length,
  anchors_with_multihop: Object.values(multihopByAnchor).filter((m) => m.recommendations.length > 0).length,
  total_multihop_recs: Object.values(multihopByAnchor).reduce((s, m) => s + m.recommendations.length, 0),
  anchors_with_property_bridges: Object.keys(propertyBridgesByAnchor).length,
  anchors_with_structural_candidates: Object.keys(structuralByAnchor).length,
  anchors_with_orthographic_candidates: Object.keys(orthographicByAnchor).length,
  eligible_structural_scenes: eligibleScenes.length,
  pilot_gz_bytes: pilotSize,
  total_staging_files: allFiles.length,
});
