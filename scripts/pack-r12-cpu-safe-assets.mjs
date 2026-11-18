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

const root = path.resolve(process.argv[2] || '.artifacts-r12/staging-bundle');
assert.ok(root.toLowerCase().includes('staging'), `Staging bundle required, got: ${root}`);

const r10Dir = path.join(root, 'v2/relationships/r11-v1.0/r10');
assert.ok(fs.existsSync(r10Dir), `Missing R10 directory: ${r10Dir}`);

const backupDir = path.resolve('.artifacts-r12/rollback-r12-discovery-1');
fs.mkdirSync(backupDir, { recursive: true });

const readGzJson = (filePath) => JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)));
const decodeB64Gz = (b64) => JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')));
const encodeB64Gz = (obj) => zlib.gzipSync(JSON.stringify(obj), { level: 9 }).toString('base64');

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

console.log('Loading orthographic shards...');
const orthMap = new Map();
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

console.log('Loading and compacting r12-pilot.json.gz...');
const pilot = readGzJson(path.join(r10Dir, 'r12-pilot.json.gz'));
assert.equal(pilot.pilot_anchors?.length, 48, `Expected 48 pilot_anchors`);
assert.equal(Object.keys(pilot.anchors || {}).length, 48, `Expected 48 anchors in pilot.anchors`);

function compactPilotAnchor(a) {
  return {
    bs: a.bs,
    lang: a.lang,
    sc: a.sc,
    tr: a.tr,
    gl: a.gl,
    total_verses: a.total_verses,
    multihop: {
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
          C: rec.C,
          D: rec.D,
          T: rec.T,
          hub_penalty: rec.hub_penalty,
          independent_group_count: rec.independent_group_count,
          independent_evidence_groups: rec.independent_evidence_groups,
          limitation: rec.limitation,
          best_path: {
            meaningful_hops: best.meaningful_hops,
            physical_hops: best.physical_hops,
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
      score_version: rec.score_version || 'r12-ranker-v1',
      epistemic_layer: rec.epistemic_layer || 'LINGUISTIC',
      epistemic_status: rec.evidence_status === 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION'
        ? 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION'
        : 'EXPLORATORY',
      meaningful_hops: hops,
      physical_hops: best.physical_hops ?? steps.length,
      Q: rec.Q ?? 0,
      C: rec.C ?? 0,
      D: rec.D ?? 0,
      T: rec.T ?? 0,
      hub_penalty: rec.hub_penalty ?? 0,
      interest: rec.interest ?? 0,
      mmr_score: rec.mmr_score,
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
  assert.equal(origRecs.length, 24, `Expected 24 multihop recommendations for ${bs}, got ${origRecs.length}`);
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

// 3. Load and enrich all 19,566 canonical LemmaProfiles from lemma-profiles/
console.log('Loading & enriching lemma-profiles...');
const profileBuckets = Array.from({ length: 1024 }, (_, idx) => ({
  hex: idx.toString(16).padStart(3, '0'),
  profiles: {},
  subLookup: Array.from({ length: 16 }, () => ({})),
}));
const bucketByHex = new Map(profileBuckets.map((b) => [b.hex, b]));

const lemmaProfDir = path.join(r10Dir, 'lemma-profiles');
const lemmaProfFiles = fs.readdirSync(lemmaProfDir).filter((f) => f.endsWith('.json.gz')).sort();
assert.equal(lemmaProfFiles.length, 64, `Expected 64 lemma-profiles shards, found ${lemmaProfFiles.length}`);

let enrichedCount = 0;
let orthAttachedCount = 0;
let pilotAttachedCount = 0;
const seenProfileKeys = new Set();

for (const f of lemmaProfFiles) {
  const d = readGzJson(path.join(lemmaProfDir, f));
  const entries = d.schema_version === 'r10-packed-1'
    ? Object.entries(d.entries || {}).map(([k, ptr]) => [k, decodePackedRecord(ptr)])
    : Object.entries(d.entries || {});
  for (const [key, prof] of entries) {
    assert.equal(key, prof.bs, `Key mismatch in lemma-profiles: ${key} !== ${prof.bs}`);
    assert.ok(!seenProfileKeys.has(prof.bs), `Duplicate profile ${prof.bs}`);
    seenProfileKeys.add(prof.bs);

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

    const enriched = {
      ...prof,
      first_occ_passages: firstOccPassages,
    };
    const orthEntry = orthMap.get(prof.bs);
    if (orthEntry) {
      enriched.orth_entry = {
        bs: orthEntry.bs,
        script: orthEntry.script,
        cons: orthEntry.cons,
        homographs: orthEntry.homographs,
      };
      orthAttachedCount++;
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
}
assert.equal(enrichedCount, 19566, `Expected 19566 profiles, got ${enrichedCount}`);
assert.equal(orthAttachedCount, orthMap.size, `Expected all ${orthMap.size} orth entries attached, got ${orthAttachedCount}`);
assert.equal(pilotAttachedCount, 48, `Expected 48 pilot anchors attached, got ${pilotAttachedCount}`);
console.log(`Enriched ${enrichedCount} profiles (orth: ${orthAttachedCount}, pilot: ${pilotAttachedCount}).`);

// 4. Load lemma-lookup and route all 456,129 entries into the same 1,024 buckets + 16 sub-buckets
console.log('Loading & routing lemma-lookup entries...');
const lookupDir = path.join(r10Dir, 'lemma-lookup');
const lookupFiles = fs.readdirSync(lookupDir).filter((f) => f.endsWith('.json.gz')).sort();
assert.equal(lookupFiles.length, 64, `Expected 64 lemma-lookup shards, found ${lookupFiles.length}`);

let lookupCount = 0;
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
assert.equal(lookupCount, 456129, `Expected 456129 lookup entries, got ${lookupCount}`);

// 5. Rewrite existing 1,024 fast-profiles/shard-000..3ff.json.gz
console.log('Writing 1,024 fast-profiles shards...');
const fastProfilesDir = path.join(r10Dir, 'fast-profiles');
let maxFastProfileOuterBytes = 0;
let maxFastProfileRawBytes = 0;
let maxFastProfileShard = '';
let totalSubBuckets = 0;

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

// 6. Rewrite existing 488 fast-verses/chunk-000..1e7.json.gz
console.log('Writing 488 fast-verses chunks...');
const verseChunks = Array.from({ length: 488 }, () => ({ summaries: {}, verses: {} }));
let versesAssigned = 0;
for (const [vid, v] of verseMap) {
  const chunkIdx = Math.floor((vid - 1) / 64);
  assert.ok(chunkIdx >= 0 && chunkIdx < 488, `Chunk index out of bounds: ${chunkIdx} for vid=${vid}`);
  const chunk = verseChunks[chunkIdx];
  chunk.summaries[vid] = [v.book, v.chapter, v.verse, v.ref, v.en || '', v.mt_ref ?? null];
  chunk.verses[vid] = encodeB64Gz(v);
  versesAssigned++;
}
assert.equal(versesAssigned, 31203, `Expected 31203 verses assigned, got ${versesAssigned}`);

let maxFastVerseOuterBytes = 0;
let maxFastVerseRawBytes = 0;
let maxFastVerseChunk = '';
let writtenVerses = 0;
for (let c = 0; c < 488; c++) {
  const hex = c.toString(16).padStart(3, '0');
  const chunkPath = path.join(verseDir, `chunk-${hex}.json.gz`);
  assert.ok(fs.existsSync(chunkPath), `Missing existing fast-verses chunk: ${chunkPath}`);
  const { summaries, verses } = verseChunks[c];
  writtenVerses += Object.keys(verses).length;
  const { rawBytes, gzBytes } = writeGzJsonAtomic(chunkPath, {
    schema_version: 'r10-b64gz-1',
    summaries,
    verses,
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
const expPath = path.join(r10Dir, 'explicit-and-typology.json.gz');
const expBackupPath = path.join(backupDir, 'explicit-and-typology.json.gz');
const expSrc = readGzJson(fs.existsSync(expBackupPath) ? expBackupPath : expPath);
const filteredRecords = (expSrc.records || []).filter((r) => !r.evidence_id?.startsWith('r10:ident:auto:'));
assert.equal(filteredRecords.length, 24, `Expected 24 filtered explicit records, got ${filteredRecords.length}`);
const expSizes = writeGzJsonAtomic(expPath, {
  ...expSrc,
  records: filteredRecords,
}, 1);

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
const eventKeywords = [...new Set((mp.events || []).flatMap((e) => e.keywords || []).map((k) => String(k).toLowerCase()))];
const mpSizes = writeGzJsonAtomic(mpPath, {
  schema_version: 'r10-lazy-motifs-1',
  motifs: mp.motifs,
  event_keywords: eventKeywords,
  motif_pairs_b64gz: encodeB64Gz(mp.motif_pairs || {}),
  events_b64gz: encodeB64Gz(mp.events || []),
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
  witness_version: 'r12-witnesses-1',
  r12_pilot: 'r12-pilot.json.gz',
  r12_pilot_embedded: true,
  r12_version: 'r12-discovery-1',
  r12_score_version: pilot.score_version || 'r12-ranker-v1',
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
      assert.equal(prof.r12_pilot_anchor.multihop.recommendations.length, 24);
      verifiedPilotProfiles++;
    }
    if (prof.orth_entry) {
      assert.ok(prof.orth_entry.homographs.length > 0);
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
assert.equal(verifiedLookup, 456129);
assert.equal(verifiedPilotProfiles, 48);
assert.equal(verifiedOrthProfiles, orthMap.size);

let verifiedVerses = 0;
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
}
assert.equal(verifiedVerses, 31203);

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
  release: 'r12-discovery-1',
  staging_root: root,
  total_files: files.length,
  max_individual_file_bytes: maxIndividualFileBytes,
  max_individual_file_path: maxIndividualFilePath,
  profiles_enriched: enrichedCount,
  orth_entries_attached: orthAttachedCount,
  pilot_anchors_attached: pilotAttachedCount,
  lookup_entries_routed: lookupCount,
  lookup_non_empty_sub_buckets: totalSubBuckets,
  verses_written: writtenVerses,
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
