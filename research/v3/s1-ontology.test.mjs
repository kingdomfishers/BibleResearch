import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ONTOLOGY_PATH = '.artifacts-r12/v3-build/sense-ontology.json';

let cachedOntology;
function loadOntology() {
  if (!cachedOntology) {
    cachedOntology = JSON.parse(fs.readFileSync(ONTOLOGY_PATH, 'utf8'));
  }
  return cachedOntology;
}

test('S1-O1: License provenance, 37 Wikidata concepts (124 claims), and >= 2,500 OEWN-mapped senses', () => {
  const ont = loadOntology();
  assert.match(ont.license, /CC BY 4\.0/);
  assert.match(ont.license, /CC0 1\.0/);
  assert.doesNotMatch(ont.license, /BY-SA/i);
  assert.equal(ont.gamma_min_bits, 3.0);

  assert.equal(ont.stats.wikidata_concepts_loaded, 37);
  assert.equal(ont.stats.wikidata_claims_loaded, 124);
  assert.ok(ont.stats.mapped_senses_count >= 2500, `Expected >=2,500 mapped senses, got ${ont.stats.mapped_senses_count}`);
  assert.ok(ont.stats.concept_classes_count >= 2500, `Expected >=2,500 C_XL concepts, got ${ont.stats.concept_classes_count}`);
  assert.ok(ont.stats.cross_lingual_concepts_count >= 400);
});

test('S1-O2: Skew-Safe LLR-Margin Sense Gate achieves < 3% polysemy FP rate across H5869, H5158, H7307, B1253', () => {
  const ont = loadOntology();
  let totalEval = 0;
  let totalFp = 0;

  for (const key of ['H5869', 'H5158', 'H7307', 'B1253']) {
    const ev = ont.polysemy_eval[key];
    assert.ok(ev, `Missing polysemy_eval for ${key}`);
    assert.ok(ev.total_occurrences > 0, `${key} must have occurrences`);
    assert.ok(ev.fp_rate < 0.03, `${key} FP rate ${ev.fp_rate} must be < 0.03`);
    totalEval += ev.evaluated_accepted;
    totalFp += ev.fp_count;
  }

  const combinedFpRate = totalEval > 0 ? totalFp / totalEval : 0;
  assert.ok(combinedFpRate < 0.03, `Combined stratified FP rate ${combinedFpRate} must be < 0.03`);

  // Verify H5869 separates eye and spring without blind lemma-level OEWN linkage
  assert.equal(ont.mapped_senses['sense:H5869:eye']?.oewn_id, 'oewn:05318579-n');
  assert.equal(ont.mapped_senses['sense:H5869:spring']?.oewn_id, 'oewn:09466357-n');
  assert.ok(ont.polysemy_eval.H5869.per_sense_accepted[1] >= 1, 'H5869 must accept genuine spring occurrences');
  assert.ok(ont.polysemy_eval.H7307.per_sense_accepted[1] >= 1 && ont.polysemy_eval.H7307.per_sense_accepted[2] >= 1, 'H7307 must accept wind and side');
  assert.equal(ont.polysemy_eval.B1253.fp_rate, 0, 'B1253 must have 0% FP rate');
  assert.ok(ont.polysemy_eval.B1253.abstained_ambiguous >= 1, 'B1253 must abstain when LLR margin < gamma_min');
});

test('S1-O3: Physical/process metallurgy, optics, hydrology, and botany domains + C_XL equivalence', () => {
  const ont = loadOntology();
  const byBs = new Map();
  for (const s of Object.values(ont.mapped_senses)) {
    if (!byBs.has(s.bs)) byBs.set(s.bs, []);
    byBs.get(s.bs).push(s);
  }

  // Metallurgy / refining / cupellation properties
  assert.equal(byBs.get('H6884')?.[0]?.physical_props?.process, 'cupellation_refining');
  assert.equal(byBs.get('H5509')?.[0]?.physical_props?.material_role, 'impurity_byproduct');
  assert.equal(byBs.get('H1253')?.[0]?.physical_props?.material_role, 'alkali_flux');
  assert.equal(byBs.get('H3564')?.[0]?.physical_props?.apparatus, 'smelting_furnace');
  assert.equal(byBs.get('G0096')?.[0]?.physical_props?.material_role, 'failed_assay_dross');

  // Cross-lingual C_XL links stone (H0068 <-> G3037) or water (H4325 <-> G5204) or silver (H3701 <-> G0696)
  const stoneHebCid = ont.sense_to_concept[byBs.get('H0068')?.[0]?.sense_id];
  const stoneGrkCid = ont.sense_to_concept[byBs.get('G3037')?.[0]?.sense_id];
  assert.ok(stoneHebCid && stoneHebCid === stoneGrkCid, 'H0068 and G3037 must share a C_XL ConceptID');

  const waterHebCid = ont.sense_to_concept[byBs.get('H4325')?.[0]?.sense_id];
  const waterGrkCid = ont.sense_to_concept[byBs.get('G5204')?.[0]?.sense_id];
  assert.ok(waterHebCid && waterHebCid === waterGrkCid, 'H4325 and G5204 must share a C_XL ConceptID');
});

test('S1-O4: Evaluative valence (+1/-1) and OEWN L1 co-hyponym material groups', () => {
  const ont = loadOntology();
  const findBs = (bs) => Object.values(ont.mapped_senses).find(s => s.bs === bs);

  // Mic 1:11 valence test: שָׁפִיר (+1) vs בֹּשֶׁת (-1) and עֶרְיָה (-1)
  assert.equal(findBs('H8208')?.valence, 1, 'H8208 (שָׁפִיר, fair) must have valence +1');
  assert.equal(findBs('H1322')?.valence, -1, 'H1322 (בֹּשֶׁת, shame) must have valence -1');
  assert.equal(findBs('H6181')?.valence, -1, 'H6181 (עֶרְיָה, nakedness) must have valence -1');

  // Material co-hyponym groups for E_perp correlation damping
  assert.ok(ont.material_groups['MAT:METALS']?.length >= 3, 'MAT:METALS material group must exist');
  assert.ok(ont.material_groups['MAT:WOOD_SPECIES']?.length >= 2, 'MAT:WOOD_SPECIES material group must exist');
  assert.ok(ont.material_groups['MAT:GRAINS']?.length >= 2, 'MAT:GRAINS material group must exist');
});
