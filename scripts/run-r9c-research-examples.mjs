// @file: scripts/run-r9c-research-examples.mjs
// Executes R9C critical research scenarios (§6A Ruach, §6B Dabar/Logos, §6C Genesis 1, §6D Negative Controls)
// against real immutable R9B + R8D offline shards and saves .artifacts-r9c/research-examples.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createNodeFsAssetReader, ShardedAdjacencyLoader } from '../src/relationships/adjacency-loader.ts';
import { resolveResearchConcept } from '../src/relationships/concept-resolver.ts';
import { discoverMultiHopPaths } from '../src/relationships/multihop-search.ts';

const R9B_STAGING = 'C:\\Projects\\BibleResearch-r9b\\.artifacts-r9b\\staging';
const R8D_CORPUS = 'C:\\Projects\\BibleResearch\\.artifacts\\static-corpus';
const OUT_DIR = path.resolve('.artifacts-r9c');
const OUT_FILE = path.join(OUT_DIR, 'research-examples.json');

function summarizeResult(res, topN = 5) {
  return {
    status: res.status,
    message: res.message,
    total_paths_found: res.coverage.total_paths_found,
    coverage: res.coverage,
    top_paths: res.paths.slice(0, topN).map((p) => ({
      path_id: p.path_id,
      hop_count: p.hop_count,
      score: p.ranking.score,
      factors: p.ranking.factors,
      why_ranked: p.ranking.why_ranked,
      join_scope: p.explanation.join_scope,
      shared_frame_ids: p.explanation.shared_frame_ids,
      shared_references: p.explanation.shared_references,
      chain: p.steps.map((s) => ({
        from: s.from_entity.entity_key,
        predicate: s.display_predicate,
        to: s.to_entity.entity_key,
        layer: s.layer,
        epistemic_class: s.epistemic_class,
        quality: s.quality,
        source_relationship_id: s.source_relationship_id,
        editions: s.editions,
        homograph_ambiguity: s.uncertainty.homograph_ambiguity,
        sample_references: s.evidence_summary.sample_references.slice(0, 5),
      })),
      establishes: p.explanation.establishes,
      does_not_establish: p.explanation.does_not_establish,
    })),
  };
}

async function inspectRuachPassageWitnesses(reader, loader) {
  const targets = [
    { ref: 'GEN 1:2', file: 'b1-c1.json.gz', key: 'macula-hebrew-wlc:GEN 1:2' },
    { ref: 'GEN 8:1', file: 'b1-c8.json.gz', key: 'macula-hebrew-wlc:GEN 8:1' },
    { ref: 'EZK 37:9', file: 'b26-c37.json.gz', key: 'macula-hebrew-wlc:EZK 37:9' },
  ];
  const passageSummaries = {};
  const manifest = await loader.getManifestSummary();
  const gramBase = manifest.layers.grammatical.base_dir;
  for (const t of targets) {
    const shard = await reader.readJson(`${gramBase}/passages/${t.file}`);
    const vData = shard?.data?.passages?.[t.key] || null;
    if (!vData) {
      passageSummaries[t.ref] = { found: false };
      continue;
    }
    const h7307Rels = (vData.relations || []).filter(
      (r) => r.subject?.lemma_id === 'lemma:H7307' || r.object?.lemma_id === 'lemma:H7307',
    );
    passageSummaries[t.ref] = {
      found: true,
      frames_in_verse: (vData.frames || []).length,
      h7307_relations: h7307Rels.map((r) => ({
        relation_id: r.relation_id,
        frame_id: r.frame_id,
        predicate: r.predicate,
        source: r.subject?.lemma_id,
        target: r.object?.lemma_id,
        quality: r.quality,
        edition: r.edition,
      })),
    };
  }
  return passageSummaries;
}

async function runSection6A(reader, loader) {
  const concepts = ['spirit', 'wind', 'breath', 'directions', 'life', 'water', 'light', 'oil', 'anointing'];
  const conceptResolutions = {};
  for (const c of concepts) {
    const r = await resolveResearchConcept(loader, c, { limit: 6 });
    conceptResolutions[c] = {
      status: r.status,
      requires_explicit_selection: r.requires_explicit_selection,
      candidates: r.candidates.map((x) => ({
        entity_key: x.entity_key,
        language: x.language,
        label: x.label,
        gloss: x.gloss,
        grammatical_degree: x.grammatical_degree,
      })),
    };
  }

  // Canonical Hebrew/Aramaic/Greek lemma targets associated with those concepts
  const targetedProbes = [
    { concept: 'wind/tempest/direction', target: 'lemma:H7307' },
    { concept: 'wind/arrogance (Aramaic cognate)', target: 'lemma:H7308' },
    { concept: 'breath (neshamah)', target: 'lemma:H5397' },
    { concept: 'spirit/wind (LXX/NT pneuma)', target: 'lemma:G4151' },
    { concept: 'life (chay)', target: 'lemma:H2416E' },
    { concept: 'water (mayim)', target: 'lemma:H4325G' },
    { concept: 'light (or)', target: 'lemma:H0216' },
    { concept: 'oil (shemen)', target: 'lemma:H8081' },
    { concept: 'anoint (mashach)', target: 'lemma:H4886' },
    { concept: 'anointing portion (mishchah)', target: 'lemma:H4888B' },
    { concept: 'anointing (Greek chrisma)', target: 'lemma:G5545' },
    { concept: 'olive oil (Greek elaion)', target: 'lemma:G1637' },
    { concept: 'direction/east (qedem)', target: 'lemma:H6924A' },
  ];

  const candidatePaths = {};
  const supportedTargets = [];
  const unsupportedTargets = [];
  for (const tp of targetedProbes) {
    const res =
      tp.target === 'lemma:H7307'
        ? await discoverMultiHopPaths(loader, { source: 'lemma:H7307', max_hops: 1, layers: ['lexical', 'lxx_translation'], limit: 12 })
        : await discoverMultiHopPaths(loader, {
            source: 'lemma:H7307',
            target: tp.target,
            max_hops: 2,
            limits: { max_contextual_pages_per_node: 4, max_per_node_edges: 200 },
            limit: 6,
          });
    candidatePaths[tp.target] = { concept: tp.concept, ...summarizeResult(res, 4) };
    if (res.coverage.total_paths_found > 0) supportedTargets.push(tp.target);
    else unsupportedTargets.push(tp.target);
  }

  const gramOnlyCheck = await discoverMultiHopPaths(loader, {
    source: 'lemma:H7307',
    target: 'lemma:H8081',
    max_hops: 2,
    layers: ['grammatical'],
  });

  const ruachNeighbors = await loader.getNeighbors('lemma:H7307', { layers: ['lexical', 'lxx_translation'] });
  const senseEntities = ruachNeighbors.edges
    .filter((e) => e.to_entity.entity_kind === 'sense' || e.to_entity.entity_kind === 'root')
    .map((e) => ({ entity_key: e.to_entity.entity_key, entity_kind: e.to_entity.entity_kind, predicate: e.display_predicate }));
  const lxxCandidates = ruachNeighbors.edges
    .filter((e) => e.layer === 'lxx_translation')
    .map((e) => ({ target: e.to_entity.entity_key, published_count: e.stats.published_count, share: e.stats.translation_share, ambiguous: e.uncertainty.homograph_ambiguity }));

  return {
    canonical_identity: 'lemma:H7307',
    aramaic_cognate_distinct: candidatePaths['lemma:H7308']?.status === 'ok',
    sense_and_root_entities: senseEntities,
    lxx_candidates: lxxCandidates,
    passage_witnesses: await inspectRuachPassageWitnesses(reader, loader),
    concept_resolutions: conceptResolutions,
    targeted_probes: candidatePaths,
    grammatical_only_h7307_to_h8081_oil: summarizeResult(gramOnlyCheck, 3),
    supported_targets: supportedTargets,
    unsupported_targets_or_grammatical_gaps: unsupportedTargets,
  };
}

async function runSection6B(loader) {
  const allLayers = await discoverMultiHopPaths(loader, { source: 'lemma:H1697G', target: 'lemma:G3056', max_hops: 2, limit: 8 });
  const byLayer = {};
  for (const layer of ['lxx_translation', 'lexical', 'contextual', 'grammatical']) {
    const r = await discoverMultiHopPaths(loader, { source: 'lemma:H1697G', target: 'lemma:G3056', max_hops: 2, layers: [layer], limit: 4 });
    byLayer[layer] = summarizeResult(r, 4);
  }
  const homographPlague = await discoverMultiHopPaths(loader, { source: 'lemma:H1697O', target: 'lemma:G3056', max_hops: 1 });
  const baseStrongsDisambig = await resolveResearchConcept(loader, 'H1697');
  return {
    base_strongs_H1697_disambiguation: {
      status: baseStrongsDisambig.status,
      candidates: baseStrongsDisambig.candidates.map((c) => ({ entity_key: c.entity_key, gloss: c.gloss })),
    },
    h1697g_to_g3056_all_layers_2hop: summarizeResult(allLayers, 6),
    per_single_layer_breakdown: byLayer,
    homograph_control_h1697o_plague_to_g3056: summarizeResult(homographPlague, 3),
  };
}

async function runSection6C(loader) {
  const concepts = {};
  for (const w of ['create', 'god', 'heavens', 'earth', 'light', 'spirit']) {
    const r = await resolveResearchConcept(loader, w, { language: 'hbo', limit: 4 });
    concepts[w] = r.candidates.map((c) => ({ entity_key: c.entity_key, label: c.label, gloss: c.gloss }));
  }
  const pairs = [
    { name: 'God (H0430G) -> create (H1254a)', source: 'lemma:H0430G', target: 'lemma:H1254a', max_hops: 2 },
    { name: 'God (H0430G) <-> heavens (H8064)', source: 'lemma:H0430G', target: 'lemma:H8064', max_hops: 2 },
    { name: 'heavens (H8064) <-> earth (H0776G)', source: 'lemma:H8064', target: 'lemma:H0776G', max_hops: 2 },
    { name: 'Spirit (H7307) <-> light (H0216)', source: 'lemma:H7307', target: 'lemma:H0216', max_hops: 2 },
  ];
  const pairResults = {};
  for (const p of pairs) {
    const r = await discoverMultiHopPaths(loader, { source: p.source, target: p.target, max_hops: p.max_hops, limit: 5 });
    pairResults[p.name] = summarizeResult(r, 4);
  }
  return { concept_candidates: concepts, pairwise_discovery: pairResults };
}

async function runSection6D(loader) {
  const controls = {};
  controls.grammatical_only_cross_testament_h7307_to_g3056 = summarizeResult(
    await discoverMultiHopPaths(loader, { source: 'lemma:H7307', target: 'lemma:G3056', max_hops: 2, layers: ['grammatical'] }),
  );
  controls.unsupported_lxx_h7307_to_g3056 = summarizeResult(
    await discoverMultiHopPaths(loader, { source: 'lemma:H7307', target: 'lemma:G3056', max_hops: 1, layers: ['lxx_translation'] }),
  );
  controls.homograph_disambig_H1254 = await resolveResearchConcept(loader, 'H1254');
  controls.english_concept_rejected_for_direct_traversal = await discoverMultiHopPaths(loader, { source: 'spirit', max_hops: 2 });
  controls.unknown_entity = await discoverMultiHopPaths(loader, { source: 'lemma:H9999ZZ', max_hops: 2 });
  controls.function_word_hub_comparison = summarizeResult(
    await discoverMultiHopPaths(loader, { source: 'lemma:H0430G', target: 'lemma:H8064', max_hops: 2, layers: ['grammatical'], limit: 6 }),
    6,
  );
  controls.truncated_contextual_scope = summarizeResult(
    await discoverMultiHopPaths(loader, { source: 'lemma:H7307', target: 'lemma:H8081', max_hops: 1, layers: ['contextual'], limits: { max_contextual_pages_per_node: 0 } }),
  );
  return controls;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const reader = await createNodeFsAssetReader([R9B_STAGING, R8D_CORPUS]);
  const loader = new ShardedAdjacencyLoader(reader, { releaseVersion: 'r9b-v1.0', maxCachedShards: 128 });

  const report = {
    generated_at: new Date().toISOString(),
    release_version: await loader.getReleaseVersion(),
    sections: {
      section_6a_ruach: await runSection6A(reader, loader),
      section_6b_dabar_logos: await runSection6B(loader),
      section_6c_genesis_1: await runSection6C(loader),
      section_6d_negative_controls: await runSection6D(loader),
    },
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Saved R9C research examples to ${OUT_FILE}`);
  console.log('6A Ruach supported:', report.sections.section_6a_ruach.supported_targets);
  console.log('6A Ruach unsupported:', report.sections.section_6a_ruach.unsupported_targets_or_grammatical_gaps);
  console.log('6A Ruach gram-only H7307->H8081:', report.sections.section_6a_ruach.grammatical_only_h7307_to_h8081_oil.status);
  console.log('6B Dabar->Logos top path:', report.sections.section_6b_dabar_logos.h1697g_to_g3056_all_layers_2hop.top_paths[0]?.chain);
  console.log('6D Cross-testament gram-only:', report.sections.section_6d_negative_controls.grammatical_only_cross_testament_h7307_to_g3056.message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
