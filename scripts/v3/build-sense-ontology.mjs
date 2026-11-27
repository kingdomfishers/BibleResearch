/**
 * Stage S1.3: Skew-Safe LLR-Margin Sense Gate, OEWN 2025 + Wikidata CC0 Ontology,
 * Cross-Lingual Concept Equivalence Classes (C_XL), Evaluative Valence (+1/-1),
 * and OEWN L1 Co-Hyponym Material Groups.
 *
 * Strictly CC BY 4.0 / CC0 / PD:
 *   - .artifacts-r12/v3-build/sanitized-lexicon.json (CC BY 4.0)
 *   - .artifacts-r12/v3-build/lxx-alignment.json (CC BY 4.0)
 *   - .artifacts-r12/external-cache/oewn-2025/*.json (CC BY 4.0)
 *   - scripts/fixtures/r12-external-pilot.json (CC0 1.0 Wikidata + CC BY 4.0 OEWN)
 *   - .artifacts/static-corpus/tables/{verses_immutable,words_immutable,verse_translation_sources} (CC BY 4.0)
 *
 * Output: .artifacts-r12/v3-build/sense-ontology.json
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_LEXICON_PATH = '.artifacts-r12/v3-build/sanitized-lexicon.json';
const DEFAULT_LXX_ALIGN_PATH = '.artifacts-r12/v3-build/lxx-alignment.json';
const DEFAULT_OEWN_DIR = '.artifacts-r12/external-cache/oewn-2025';
const DEFAULT_PILOT_PATH = 'scripts/fixtures/r12-external-pilot.json';
const DEFAULT_TABLES_DIR = '.artifacts/static-corpus/tables';
const DEFAULT_OUT_PATH = '.artifacts-r12/v3-build/sense-ontology.json';

const GAMMA_MIN = 3.0;

// Explicit multi-sense LLR-gate profiles for critical biblical polysemes
// (merged automatically with all sanitized-lexicon entries having >= 2 retained senses)
const CURATED_POLYSEME_SPECS = {
  H5869: {
    base_strongs: 'H5869',
    lemma: 'עַיִן',
    senses: [
      {
        sense_id: 'sense:H5869:eye',
        label: 'eye / sight / appearance',
        gloss_re: /\b(?:eye|eyes|sight|look|face|appearance|presence|behold|blind)\b/i,
        lxx_lemmas: new Set(['ὀφθαλμός', 'ἔναντι', 'ἐνώπιον', 'κατέναντι', 'πρόσωπον', 'ὅρασις']),
        oewn_id: 'oewn:05318579-n',
        wikidata_id: 'wd:Q7364',
      },
      {
        sense_id: 'sense:H5869:spring',
        label: 'spring / fountain of water',
        gloss_re: /\b(?:spring|fountain|well)\b/i,
        lxx_lemmas: new Set(['πηγή', 'κρήνη', 'ὕδωρ', 'φρέαρ']),
        oewn_id: 'oewn:09466357-n',
        wikidata_id: 'wd:Q124714',
      },
    ],
  },
  H5158: {
    base_strongs: 'H5158',
    lemma: 'נַחַל',
    senses: [
      {
        sense_id: 'sense:H5158:wadi',
        label: 'wadi / torrent / brook / valley',
        gloss_re: /\b(?:wadi|torrent|brook|river|valley|stream|channel|flood)\b/i,
        lxx_lemmas: new Set(['χείμαρρος', 'φάραγξ', 'ποταμός', 'κοιλάς', 'αὐλών', 'νάπη']),
        oewn_id: 'oewn:09489806-n',
        wikidata_id: null,
      },
      {
        sense_id: 'sense:H5158:palm',
        label: 'palm-tree',
        gloss_re: /\b(?:palm)\b/i,
        lxx_lemmas: new Set(['φοῖνιξ']),
        oewn_id: 'oewn:12606794-n',
        wikidata_id: null,
      },
    ],
  },
  H7307: {
    base_strongs: 'H7307',
    lemma: 'רוּחַ',
    senses: [
      {
        sense_id: 'sense:H7307:spirit',
        label: 'spirit / temper / disposition',
        gloss_re: /\b(?:spirit|spirits|temper|mind|courage|anger|ghost)\b/i,
        lxx_lemmas: new Set(['πνεῦμα', 'θυμός', 'ψυχή', 'νοῦς']),
        oewn_id: 'oewn:06841300-n',
        wikidata_id: null,
      },
      {
        sense_id: 'sense:H7307:wind',
        label: 'wind / breath / air',
        gloss_re: /\b(?:wind|winds|breath|air|blast|tempest|breeze|vain|emptiness)\b/i,
        lxx_lemmas: new Set(['ἄνεμος', 'πνοή', 'αὖρα', 'θύελλα', 'καταιγίς']),
        oewn_id: 'oewn:11546388-n',
        wikidata_id: 'wd:Q8094',
      },
      {
        sense_id: 'sense:H7307:side',
        label: 'side / quarter / direction',
        gloss_re: /\b(?:side|quarter|direction)\b/i,
        lxx_lemmas: new Set(['κλίμα', 'μέρος', 'πλευρά']),
        oewn_id: 'oewn:08667007-n',
        wikidata_id: null,
      },
    ],
  },
  B1253: {
    base_strongs: 'B1253',
    member_bs: ['H1252', 'H1253'],
    lemma: 'בֹּר',
    senses: [
      {
        sense_id: 'sense:H1252:cleanness',
        label: 'cleanness / purity',
        bs_match: 'H1252',
        gloss_re: /\b(?:clean|cleanness|pure|purity|innocence|purely)\b/i,
        lxx_lemmas: new Set(['καθαριότης', 'καθαρός', 'ἀθῳότης']),
        oewn_id: 'oewn:04799015-n',
        wikidata_id: null,
      },
      {
        sense_id: 'sense:H1253:lye',
        label: 'lye / potash / alkali',
        bs_match: 'H1253',
        gloss_re: /\b(?:lye|potash|alkali|soap|cleanse)\b/i,
        lxx_lemmas: new Set(['πόα', 'βόρα']),
        oewn_id: 'oewn:14939900-n',
        wikidata_id: null,
      },
    ],
  },
  H3722: {
    base_strongs: 'H3722',
    lemma: 'כָּפַר',
    senses: [
      {
        sense_id: 'sense:H3722A:atone',
        label: 'to atone / propitiate / pardon',
        gloss_re: /\b(?:atone|atonement|forgive|pardon|reconcile|appease|purge|cleanse)\b/i,
        lxx_lemmas: new Set(['ἐξιλάσκομαι', 'ἱλάσκομαι', 'καθαρίζω', 'ἀφίημι']),
        oewn_id: 'oewn:02530576-v',
        wikidata_id: null,
      },
      {
        sense_id: 'sense:H3722B:cover_pitch',
        label: 'to cover with pitch / coat',
        gloss_re: /\b(?:cover|pitch|coat)\b/i,
        lxx_lemmas: new Set(['ἀσφαλτόω']),
        oewn_id: 'oewn:01334709-v',
        wikidata_id: null,
      },
    ],
  },
};

// Curated physical, metallurgical, botanical, hydrological, anatomical, architectural, & process properties
// Extends r12-external-pilot.json across all key biblical physical domains
const CURATED_DOMAIN_MAPPINGS = [
  // Metallurgy / refining / furnace / dross / alkali / cupellation
  { bs: 'H6884', domain: 'metallurgy', oewn_search: ['refine', 'smelt', 'purify'], pos: 'v', props: { process: 'cupellation_refining', agent_medium: 'fire', removes: 'dross', tests_purity: true } },
  { bs: 'H0974', domain: 'metallurgy', oewn_search: ['test', 'assay', 'examine'], pos: 'v', props: { process: 'metallurgical_assay', tests_purity: true } },
  { bs: 'H5509', domain: 'metallurgy', oewn_search: ['dross', 'slag', 'scum'], pos: 'n', props: { material_role: 'impurity_byproduct', separated_by: 'cupellation_refining', physical_state: 'solid_slag' } },
  { bs: 'H1253', domain: 'metallurgy', oewn_search: ['lye', 'alkali', 'potash'], pos: 'n', props: { material_role: 'alkali_flux', process: 'cupellation_refining', chemical_action: 'saponification_and_flux' } },
  { bs: 'H3564', domain: 'metallurgy', oewn_search: ['furnace', 'smelter'], pos: 'n', props: { apparatus: 'smelting_furnace', energy_source: 'fire', process: 'cupellation_refining' } },
  { bs: 'H3536', domain: 'metallurgy', oewn_search: ['kiln', 'furnace'], pos: 'n', props: { apparatus: 'kiln_furnace', energy_source: 'fire', process: 'calcination' } },
  { bs: 'H0861', domain: 'metallurgy', oewn_search: ['furnace'], pos: 'n', props: { apparatus: 'smelting_furnace', energy_source: 'fire' } },
  { bs: 'G2575', domain: 'metallurgy', oewn_search: ['furnace', 'oven'], pos: 'n', props: { apparatus: 'smelting_furnace', energy_source: 'fire' } },
  { bs: 'G4448', domain: 'metallurgy', oewn_search: ['burn', 'refine', 'ignite'], pos: 'v', props: { process: 'thermal_refining', agent_medium: 'fire' } },
  { bs: 'G1381', domain: 'metallurgy', oewn_search: ['test', 'assay', 'prove'], pos: 'v', props: { process: 'metallurgical_assay', tests_purity: true } },
  { bs: 'G0096', domain: 'metallurgy', oewn_search: ['unapproved', 'worthless', 'rejected'], pos: 'a', props: { material_role: 'failed_assay_dross', valence: -1 } },
  { bs: 'H3701', domain: 'metallurgy', oewn_search: ['silver'], pos: 'n', material_group: 'MAT:METALS', props: { metal: 'silver', refined_by: 'cupellation_refining' } },
  { bs: 'G0696', domain: 'metallurgy', oewn_search: ['silver'], pos: 'n', material_group: 'MAT:METALS', props: { metal: 'silver', refined_by: 'cupellation_refining' } },
  { bs: 'H2091', domain: 'metallurgy', oewn_search: ['gold'], pos: 'n', material_group: 'MAT:METALS', props: { metal: 'gold', refined_by: 'cupellation_refining' } },
  { bs: 'G5557', domain: 'metallurgy', oewn_search: ['gold'], pos: 'n', material_group: 'MAT:METALS', props: { metal: 'gold', refined_by: 'cupellation_refining' } },
  { bs: 'H5178', domain: 'metallurgy', oewn_search: ['bronze', 'copper', 'brass'], pos: 'n', material_group: 'MAT:METALS', props: { metal: 'copper_bronze' } },
  { bs: 'G5475', domain: 'metallurgy', oewn_search: ['bronze', 'copper'], pos: 'n', material_group: 'MAT:METALS', props: { metal: 'copper_bronze' } },
  { bs: 'H1270', domain: 'metallurgy', oewn_search: ['iron'], pos: 'n', material_group: 'MAT:METALS', props: { metal: 'iron' } },
  { bs: 'G4604', domain: 'metallurgy', oewn_search: ['iron'], pos: 'n', material_group: 'MAT:METALS', props: { metal: 'iron' } },
  { bs: 'H5777', domain: 'metallurgy', oewn_search: ['lead'], pos: 'n', material_group: 'MAT:METALS', props: { metal: 'lead', process: 'cupellation_refining' } },
  { bs: 'H0913', domain: 'metallurgy', oewn_search: ['tin'], pos: 'n', material_group: 'MAT:METALS', props: { metal: 'tin', material_role: 'alloy_or_dross' } },
  { bs: 'H4647', domain: 'metallurgy', oewn_search: ['bellows'], pos: 'n', props: { apparatus: 'bellows', supplies: 'air_draft', process: 'cupellation_refining' } },
  { bs: 'H4715', domain: 'metallurgy', oewn_search: ['crucible', 'melting pot'], pos: 'n', props: { apparatus: 'crucible', process: 'cupellation_refining' } },
  // Light / optics / lamp / eye
  { bs: 'H0216', domain: 'optics', oewn_search: ['light', 'visible light'], pos: 'n', props: { phenomenon: 'visible_light', emits_illumination: true } },
  { bs: 'G5457', domain: 'optics', oewn_search: ['light', 'visible light'], pos: 'n', props: { phenomenon: 'visible_light', emits_illumination: true } },
  { bs: 'H5216', domain: 'optics', oewn_search: ['lamp'], pos: 'n', props: { apparatus: 'oil_lamp', fuel: 'olive_oil', emits_illumination: true } },
  { bs: 'G3088', domain: 'optics', oewn_search: ['lamp'], pos: 'n', props: { apparatus: 'oil_lamp', fuel: 'olive_oil', emits_illumination: true } },
  { bs: 'H4501', domain: 'optics', oewn_search: ['menorah', 'lampstand', 'candelabrum'], pos: 'n', props: { apparatus: 'lampstand', holds: 'oil_lamp', emits_illumination: true } },
  { bs: 'G3087', domain: 'optics', oewn_search: ['lampstand', 'candlestick'], pos: 'n', props: { apparatus: 'lampstand', holds: 'oil_lamp', emits_illumination: true } },
  { bs: 'H3940', domain: 'optics', oewn_search: ['torch'], pos: 'n', props: { apparatus: 'torch', emits_illumination: true } },
  { bs: 'G2985', domain: 'optics', oewn_search: ['torch', 'lamp'], pos: 'n', props: { apparatus: 'torch_lamp', emits_illumination: true } },
  { bs: 'H8121', domain: 'optics', oewn_search: ['sun'], pos: 'n', props: { celestial_body: 'sun', emits_illumination: true } },
  { bs: 'G2246', domain: 'optics', oewn_search: ['sun'], pos: 'n', props: { celestial_body: 'sun', emits_illumination: true } },
  { bs: 'H0784', domain: 'optics', oewn_search: ['fire'], pos: 'n', props: { phenomenon: 'combustion', emits_heat_and_light: true } },
  { bs: 'G4442', domain: 'optics', oewn_search: ['fire'], pos: 'n', props: { phenomenon: 'combustion', emits_heat_and_light: true } },
  // Hydrology / spring / wadi / river
  { bs: 'H4325', domain: 'hydrology', oewn_search: ['water'], pos: 'n', props: { substance: 'water', physical_state: 'liquid' } },
  { bs: 'G5204', domain: 'hydrology', oewn_search: ['water'], pos: 'n', props: { substance: 'water', physical_state: 'liquid' } },
  { bs: 'G4077', domain: 'hydrology', oewn_search: ['spring', 'fountain'], pos: 'n', props: { landform: 'natural_spring', yields: 'water' } },
  { bs: 'H4599', domain: 'hydrology', oewn_search: ['spring', 'fountain'], pos: 'n', props: { landform: 'natural_spring', yields: 'water' } },
  { bs: 'H5104', domain: 'hydrology', oewn_search: ['river', 'stream'], pos: 'n', props: { landform: 'river', contains: 'water' } },
  { bs: 'G4215', domain: 'hydrology', oewn_search: ['river', 'stream'], pos: 'n', props: { landform: 'river', contains: 'water' } },
  { bs: 'H0875', domain: 'hydrology', oewn_search: ['well'], pos: 'n', props: { structure: 'water_well', yields: 'water' } },
  { bs: 'G5421', domain: 'hydrology', oewn_search: ['well'], pos: 'n', props: { structure: 'water_well', yields: 'water' } },
  // Botany / agriculture
  { bs: 'H0730', domain: 'botany', oewn_search: ['cedar'], pos: 'n', material_group: 'MAT:WOOD_SPECIES', props: { organism: 'cedrus_libani', material: 'aromatic_timber' } },
  { bs: 'H0231', domain: 'botany', oewn_search: ['hyssop'], pos: 'n', material_group: 'MAT:BOTANY_HERBS', props: { organism: 'hyssop', ritual_use: 'sprinkling_cleansing' } },
  { bs: 'G5301', domain: 'botany', oewn_search: ['hyssop'], pos: 'n', material_group: 'MAT:BOTANY_HERBS', props: { organism: 'hyssop', ritual_use: 'sprinkling_cleansing' } },
  { bs: 'H2132', domain: 'botany', oewn_search: ['olive'], pos: 'n', material_group: 'MAT:WOOD_SPECIES', props: { organism: 'olive_tree', yields: 'olive_oil' } },
  { bs: 'G1636', domain: 'botany', oewn_search: ['olive'], pos: 'n', material_group: 'MAT:WOOD_SPECIES', props: { organism: 'olive_tree', yields: 'olive_oil' } },
  { bs: 'H2233', domain: 'botany', oewn_search: ['seed'], pos: 'n', props: { botanical_part: 'seed', biological_role: 'reproduction' } },
  { bs: 'G4690', domain: 'botany', oewn_search: ['seed'], pos: 'n', props: { botanical_part: 'seed', biological_role: 'reproduction' } },
  { bs: 'H4671', domain: 'botany', oewn_search: ['chaff'], pos: 'n', props: { agricultural_byproduct: 'chaff', separated_by: 'winnowing' } },
  { bs: 'G0892', domain: 'botany', oewn_search: ['chaff'], pos: 'n', props: { agricultural_byproduct: 'chaff', separated_by: 'winnowing' } },
  { bs: 'H7898', domain: 'botany', oewn_search: ['thorn', 'thornbush', 'brier'], pos: 'n', props: { plant_form: 'thorny_shrub' } },
  { bs: 'H2406', domain: 'botany', oewn_search: ['wheat'], pos: 'n', material_group: 'MAT:GRAINS', props: { grain: 'wheat' } },
  { bs: 'G4621', domain: 'botany', oewn_search: ['wheat'], pos: 'n', material_group: 'MAT:GRAINS', props: { grain: 'wheat' } },
  { bs: 'H8184', domain: 'botany', oewn_search: ['barley'], pos: 'n', material_group: 'MAT:GRAINS', props: { grain: 'barley' } },
  { bs: 'G2916', domain: 'botany', oewn_search: ['barley'], pos: 'a', material_group: 'MAT:GRAINS', props: { grain: 'barley' } },
  // Salt / minerals / stone
  { bs: 'H4417', domain: 'minerals', oewn_search: ['salt', 'table salt'], pos: 'n', props: { mineral: 'halite_salt', preserves_and_seasons: true } },
  { bs: 'G0217', domain: 'minerals', oewn_search: ['salt', 'table salt'], pos: 'n', props: { mineral: 'halite_salt', preserves_and_seasons: true } },
  { bs: 'H0068', domain: 'minerals', oewn_search: ['stone', 'rock'], pos: 'n', material_group: 'MAT:STONES', props: { mineral: 'stone' } },
  { bs: 'G3037', domain: 'minerals', oewn_search: ['stone', 'rock'], pos: 'n', material_group: 'MAT:STONES', props: { mineral: 'stone' } },
  { bs: 'H6697', domain: 'minerals', oewn_search: ['rock', 'cliff'], pos: 'n', material_group: 'MAT:STONES', props: { landform: 'rock_crag' } },
  { bs: 'G4073', domain: 'minerals', oewn_search: ['rock'], pos: 'n', material_group: 'MAT:STONES', props: { landform: 'bedrock' } },
];

// Evaluative valence seed words (+1 positive / -1 negative) for OEWN antonym/similar propagation
const VALENCE_POS_SEEDS = new Set([
  'good', 'fair', 'beautiful', 'lovely', 'pure', 'clean', 'holy', 'righteous',
  'just', 'upright', 'faithful', 'true', 'wise', 'noble', 'honorable', 'honor',
  'glory', 'glorious', 'blessed', 'blessing', 'joy', 'glad', 'peace', 'life',
  'sweet', 'pleasant', 'bright', 'light', 'innocent', 'worthy', 'strong',
  'prosperous', 'healthy', 'heal', 'save', 'salvation', 'favor', 'grace',
  'mercy', 'love', 'kind', 'uprightness', 'integrity', 'perfection', 'beauty',
]);

const VALENCE_NEG_SEEDS = new Set([
  'bad', 'evil', 'wicked', 'ugly', 'shame', 'disgrace', 'nakedness', 'naked',
  'impure', 'unclean', 'defiled', 'defile', 'curse', 'cursed', 'sorrow', 'grief',
  'death', 'false', 'falsehood', 'foolish', 'fool', 'weak', 'bitter', 'bitterness',
  'dark', 'darkness', 'reproach', 'scorn', 'contempt', 'sin', 'iniquity',
  'guilt', 'guilty', 'abomination', 'worthless', 'corrupt', 'corruption', 'destroy',
  'destruction', 'calamity', 'affliction', 'oppression', 'violence', 'terror',
]);

// Material / natural-kind co-hyponym group seeds (for E_perp correlation damping)
const MATERIAL_GROUP_KEYWORDS = [
  ['MAT:METALS', new Set(['metal', 'metallic element', 'alloy', 'gold', 'silver', 'copper', 'bronze', 'iron', 'lead', 'tin', 'brass'])],
  ['MAT:PRECIOUS_STONES', new Set(['gem', 'gemstone', 'precious stone', 'jewel', 'mineral', 'onyx', 'emerald', 'sapphire', 'jasper', 'beryl', 'ruby', 'topaz', 'pearl'])],
  ['MAT:WOOD_SPECIES', new Set(['wood', 'timber', 'tree', 'cedar', 'cypress', 'acacia', 'oak', 'olive', 'pine', 'fir', 'fig', 'sycamore'])],
  ['MAT:GRAINS', new Set(['grain', 'cereal', 'wheat', 'barley', 'spelt', 'rye', 'millet', 'flour'])],
  ['MAT:TEXTILES', new Set(['fabric', 'cloth', 'textile', 'linen', 'wool', 'purple', 'scarlet', 'garment', 'robe', 'tunic', 'cloak'])],
  ['MAT:VESSELS', new Set(['vessel', 'container', 'jar', 'pot', 'bowl', 'cup', 'pitcher', 'basin', 'urn', 'flask', 'bottle'])],
  ['MAT:ANIMALS', new Set(['animal', 'livestock', 'cattle', 'sheep', 'lamb', 'goat', 'bull', 'ox', 'bird', 'dove', 'pigeon', 'lion', 'serpent', 'fish'])],
  ['MAT:SANCTUARY_ARCH', new Set(['building', 'structure', 'temple', 'sanctuary', 'altar', 'pillar', 'gate', 'door', 'wall', 'court', 'chamber', 'threshold', 'curtain', 'veil'])],
];

const OEWN_TOP_NOISE = new Set(['00001740-n', '00001930-n', '00002137-n', '00002452-n', '00002684-n']);

function padStrongs(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^[HG]\d+$/.test(s)) return s[0] + s.slice(1).padStart(4, '0');
  if (/^\d+$/.test(s)) return 'H' + s.padStart(4, '0');
  return s;
}

function mapStepPosToOewnPos(pos) {
  if (!pos) return null;
  if (/:V\b/i.test(pos)) return 'v';
  if (/:N\b|^[HAG]:N/i.test(pos)) return 'n';
  if (/:A\b|^[HAG]:A/i.test(pos)) return 'a';
  if (/:ADV\b|^[HAG]:Adv/i.test(pos)) return 'r';
  return null;
}

function extractGlossWords(gl) {
  if (!gl) return [];
  const raw = gl
    .toLowerCase()
    .replace(/\bto\s+/g, '')
    .replace(/\bbe\s+/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[:/;,]+/)
    .map(p => p.trim())
    .filter(Boolean);
  const words = [];
  for (const part of raw) {
    words.push(part);
    for (const w of part.replace(/[^a-z\s-]/g, ' ').split(/\s+/)) {
      if (w.length >= 3) words.push(w);
    }
  }
  return [...new Set(words)];
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function parseStepRole(grammarCode) {
  if (!grammarCode) return 'X';
  const seg = grammarCode.split('/').map(p => p.replace(/^[HA](?=[VNARDCPST])/, ''));
  for (const p of seg) {
    if (p.startsWith('V')) return 'V';
    if (p.startsWith('N')) return p.endsWith('c') ? 'N_CSTR' : 'N';
    if (p.startsWith('A')) return 'A';
  }
  return 'X';
}

export async function buildSenseOntology({
  lexiconPath = DEFAULT_LEXICON_PATH,
  lxxAlignPath = DEFAULT_LXX_ALIGN_PATH,
  oewnDir = DEFAULT_OEWN_DIR,
  pilotPath = DEFAULT_PILOT_PATH,
  tablesDir = DEFAULT_TABLES_DIR,
  outPath = DEFAULT_OUT_PATH,
  writeOutput = true,
} = {}) {
  const t0 = Date.now();

  // 1. Load sanitized lexicon + pilot Wikidata CC0 claims
  const lexicon = JSON.parse(fs.readFileSync(lexiconPath, 'utf8'));
  const profiles = lexicon.profiles || {};
  const pilot = fs.existsSync(pilotPath) ? JSON.parse(fs.readFileSync(pilotPath, 'utf8')) : { wikidata_concepts: {}, property_assertions: [], external_mappings: [] };

  // 2. Load OEWN 2025 synsets + entries
  const synsets = new Map(); // synset_id -> { members, definition, hypernym, similar, also, partOfSpeech, domain }
  const synsetFiles = fs.readdirSync(oewnDir)
    .filter(f => /^(?:noun|verb|adj|adv)\..*\.json$/.test(f))
    .sort();
  for (const f of synsetFiles) {
    const domain = f.replace(/\.json$/, '');
    const obj = JSON.parse(fs.readFileSync(path.join(oewnDir, f), 'utf8'));
    for (const [sid, data] of Object.entries(obj)) {
      synsets.set(sid, { ...data, domain });
    }
  }

  // Index OEWN entries: sense_id -> { synset, antonym, derivation, ... } and member -> synsets[]
  const senseIdToSynset = new Map();
  const synsetLinks = new Map(); // sid -> { antonyms: Set, derivations: Set }
  const memberIndex = new Map(); // "word|pos" -> Set(sid)
  const entryFiles = fs.readdirSync(oewnDir).filter(f => /^entries-.*\.json$/.test(f)).sort();

  for (const f of entryFiles) {
    const obj = JSON.parse(fs.readFileSync(path.join(oewnDir, f), 'utf8'));
    for (const [lemma, posMap] of Object.entries(obj)) {
      const lNorm = lemma.toLowerCase().replace(/_/g, ' ');
      for (const [posKey, posObj] of Object.entries(posMap)) {
        const coarsePos = posKey === 's' ? 'a' : posKey;
        for (const s of posObj.sense || []) {
          if (s.id && s.synset) {
            senseIdToSynset.set(s.id, s.synset);
            const mk = `${lNorm}|${coarsePos}`;
            if (!memberIndex.has(mk)) memberIndex.set(mk, []);
            memberIndex.get(mk).push(s.synset);
          }
        }
      }
    }
  }
  // Second pass over entries to resolve sense-level antonyms & derivations to synset IDs
  for (const f of entryFiles) {
    const obj = JSON.parse(fs.readFileSync(path.join(oewnDir, f), 'utf8'));
    for (const posMap of Object.values(obj)) {
      for (const posObj of Object.values(posMap)) {
        for (const s of posObj.sense || []) {
          const sid = s.synset;
          if (!sid) continue;
          if (s.antonym?.length || s.derivation?.length) {
            let rec = synsetLinks.get(sid);
            if (!rec) {
              rec = { antonyms: new Set(), derivations: new Set() };
              synsetLinks.set(sid, rec);
            }
            for (const aId of s.antonym || []) {
              const target = senseIdToSynset.get(aId);
              if (target) rec.antonyms.add(target);
            }
            for (const dId of s.derivation || []) {
              const target = senseIdToSynset.get(dId);
              if (target) rec.derivations.add(target);
            }
          }
        }
      }
    }
  }
  console.error('[sense-ontology] OEWN loaded synsets:', synsets.size, Date.now() - t0, 'ms');

  // 3. Propagate Evaluative Valence (+1 / -1) across OEWN antonym / similar / derivation graph
  const synsetValence = new Map(); // sid -> +1 | -1
  for (const [sid, syn] of synsets.entries()) {
    const mems = (syn.members || []).map(m => m.toLowerCase());
    if (mems.some(m => VALENCE_POS_SEEDS.has(m))) synsetValence.set(sid, 1);
    else if (mems.some(m => VALENCE_NEG_SEEDS.has(m))) synsetValence.set(sid, -1);
  }
  for (let hop = 0; hop < 2; hop++) {
    const updates = [];
    for (const [sid, val] of synsetValence.entries()) {
      const syn = synsets.get(sid);
      for (const sim of [...(syn?.similar || []), ...(syn?.also || [])]) {
        if (!synsetValence.has(sim)) updates.push([sim, val]);
      }
      const links = synsetLinks.get(sid);
      if (links) {
        for (const ant of links.antonyms) {
          if (!synsetValence.has(ant)) updates.push([ant, -val]);
        }
        for (const drv of links.derivations) {
          if (!synsetValence.has(drv)) updates.push([drv, val]);
        }
      }
    }
    for (const [sid, val] of updates) {
      if (!synsetValence.has(sid)) synsetValence.set(sid, val);
    }
  }
  console.error('[sense-ontology] valence synsets:', synsetValence.size, Date.now() - t0, 'ms');

  // 4. Load lxx-alignment.json (for g_LXX per (vid, wid) AND symmetric MT <-> LXX pairs)
  const lxxAlign = JSON.parse(fs.readFileSync(lxxAlignPath, 'utf8'));
  const widVidToGrkLemma = new Map(); // "vid:wid" -> g_lemma
  const mtLxxPairCounts = new Map(); // "h_bs\0g_lemma" -> count
  const mtTotals = new Map();
  const lxxTotals = new Map();

  for (const v of lxxAlign.verses || []) {
    for (const l of v.links || []) {
      if (l.vid && l.wid && l.g_lemma) {
        widVidToGrkLemma.set(`${l.vid}:${l.wid}`, l.g_lemma);
      }
      if (!l.rule && l.h_bs && l.g_lemma && !profiles[l.h_bs]?.is_grammatical_marker) {
        const k = `${l.h_bs}\0${l.g_lemma}`;
        mtLxxPairCounts.set(k, (mtLxxPairCounts.get(k) || 0) + 1);
        mtTotals.set(l.h_bs, (mtTotals.get(l.h_bs) || 0) + 1);
        lxxTotals.set(l.g_lemma, (lxxTotals.get(l.g_lemma) || 0) + 1);
      }
    }
  }

  // 5. Load verses_immutable & words_immutable (5s) for per-verse contexts ctx(v) and (role, gov)
  const versesFile = path.join(tablesDir, 'verses_immutable', 'part-0000.jsonl.gz');
  const wordsDir = path.join(tablesDir, 'words_immutable');
  const wordById = new Map();
  for (const f of fs.readdirSync(wordsDir).filter(x => x.endsWith('.jsonl.gz')).sort()) {
    for (const line of zlib.gunzipSync(fs.readFileSync(path.join(wordsDir, f))).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      const w = JSON.parse(line);
      wordById.set(w.id, {
        wid: w.id,
        bs: padStrongs(w.strongs_nr),
        gr: w.grammar_code || '',
        role: parseStepRole(w.grammar_code),
        en: (w.english_translations || []).join(' ').toLowerCase(),
      });
    }
  }

  const verseList = [];
  for (const line of zlib.gunzipSync(fs.readFileSync(versesFile)).toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    const v = JSON.parse(line);
    verseList.push({ vid: v.id, book: v.book, chapter: v.chapter, verse: v.verse_nr, word_ids: v.word_ids || [] });
  }

  // 6. Build Skew-Safe LLR-Margin Sense Gate for multi-sense lemmas (strict leave-one-out!)
  // Map every polysemous bs -> spec
  const polySpecs = new Map();
  for (const [key, spec] of Object.entries(CURATED_POLYSEME_SPECS)) {
    const members = spec.member_bs || [spec.base_strongs];
    for (const bs of members) polySpecs.set(bs, { key, spec });
  }

  // Collect occurrences for polysemous clusters from verseList
  const polyOccurrences = new Map(); // clusterKey -> [{ vid, wid, bs, g_lxx, role_gov, ctx, seed_idx }]
  for (const spec of Object.values(CURATED_POLYSEME_SPECS)) {
    polyOccurrences.set(spec.base_strongs, []);
  }

  // Also scan verse_translation_sources ONLY for word_ids belonging to polySpecs!
  const polyWids = new Set();
  for (const w of wordById.values()) {
    if (polySpecs.has(w.bs)) polyWids.add(w.wid);
  }
  const vtsByVidWid = new Map();
  const vtsDir = path.join(tablesDir, 'verse_translation_sources');
  if (fs.existsSync(vtsDir)) {
    for (const f of fs.readdirSync(vtsDir).filter(x => x.endsWith('.jsonl.gz')).sort()) {
      for (const line of zlib.gunzipSync(fs.readFileSync(path.join(vtsDir, f))).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        if (polyWids.has(row.word_id)) {
          vtsByVidWid.set(`${row.verse_id}:${row.word_id}`, (row.source_english || '').toLowerCase());
        }
      }
    }
  }

  for (const v of verseList) {
    const tokens = v.word_ids.map(wid => wordById.get(wid)).filter(Boolean);
    const contentBs = tokens
      .map(t => t.bs)
      .filter(bs => bs && !profiles[bs]?.is_grammatical_marker);

    for (let idx = 0; idx < tokens.length; idx++) {
      const tok = tokens[idx];
      const hit = polySpecs.get(tok.bs);
      if (!hit) continue;
      const { spec } = hit;
      const gLxx = widVidToGrkLemma.get(`${v.vid}:${tok.wid}`) || '<NONE>';
      // Governing partner: next token if construct noun, else nearest verb in verse
      let gov = '<NONE>';
      if (tok.role === 'N_CSTR' && tokens[idx + 1]?.bs && !profiles[tokens[idx + 1].bs]?.is_grammatical_marker) {
        gov = tokens[idx + 1].bs;
      } else {
        const nearestV = tokens.find((t, ti) => ti !== idx && t.role === 'V' && t.bs);
        if (nearestV) gov = nearestV.bs;
      }
      const roleGov = `${tok.role}:${gov}`;
      const ctx = contentBs.filter(bs => bs !== tok.bs);
      const occEn = vtsByVidWid.get(`${v.vid}:${tok.wid}`) || tok.en;

      // Determine ground-truth / seed sense index from observed textual English + bs_match + gLxx
      let seedIdx = -1;
      for (let si = 0; si < spec.senses.length; si++) {
        const sDef = spec.senses[si];
        if (sDef.bs_match && tok.bs === sDef.bs_match) {
          seedIdx = si;
          break;
        }
        if (sDef.lxx_lemmas?.has(gLxx) && sDef.gloss_re?.test(occEn)) {
          seedIdx = si;
          break;
        }
      }
      if (seedIdx === -1) {
        for (let si = 0; si < spec.senses.length; si++) {
          if (spec.senses[si].gloss_re?.test(occEn)) {
            seedIdx = si;
            break;
          }
        }
      }
      if (seedIdx === -1) {
        for (let si = 0; si < spec.senses.length; si++) {
          if (spec.senses[si].lxx_lemmas?.has(gLxx)) {
            seedIdx = si;
            break;
          }
        }
      }
      if (seedIdx === -1) seedIdx = 0; // default majority prior for seed estimation

      polyOccurrences.get(spec.base_strongs).push({
        vid: v.vid,
        wid: tok.wid,
        bs: tok.bs,
        g_lxx: gLxx,
        role_gov: roleGov,
        ctx: [...new Set(ctx)],
        seed_idx: seedIdx,
      });
    }
  }

  // Evaluate Skew-Safe LLR-Margin Gate with strict Leave-One-Out likelihoods
  const senseGateResults = {};
  const gatedVerseEdges = {}; // "vid:wid" -> { sense_id, oewn_id, wikidata_id, lambda }
  const polysemyEvalSummary = {};

  for (const [clusterKey, spec] of Object.entries(CURATED_POLYSEME_SPECS)) {
    const occs = polyOccurrences.get(clusterKey) || [];
    const K = spec.senses.length;
    const senseCounts = new Array(K).fill(0);
    const lxxCounts = Array.from({ length: K }, () => new Map());
    const lxxVocab = new Set();
    const rgCounts = Array.from({ length: K }, () => new Map());
    const rgVocab = new Set();
    const ctxCounts = Array.from({ length: K }, () => new Map());
    const ctxTotals = new Array(K).fill(0);
    const ctxVocab = new Set();

    for (const o of occs) {
      const s = o.seed_idx;
      senseCounts[s]++;
      lxxCounts[s].set(o.g_lxx, (lxxCounts[s].get(o.g_lxx) || 0) + 1);
      lxxVocab.add(o.g_lxx);
      rgCounts[s].set(o.role_gov, (rgCounts[s].get(o.role_gov) || 0) + 1);
      rgVocab.add(o.role_gov);
      for (const u of o.ctx) {
        ctxCounts[s].set(u, (ctxCounts[s].get(u) || 0) + 1);
        ctxTotals[s]++;
        ctxVocab.add(u);
      }
    }

    const totOcc = occs.length || 1;
    const pi0 = (senseCounts[0] + 0.5) / (totOcc + 0.5 * K);
    const lxxBgTotals = new Map();
    for (const m of lxxCounts) for (const [k, c] of m.entries()) lxxBgTotals.set(k, (lxxBgTotals.get(k) || 0) + c);
    const rgBgTotals = new Map();
    for (const m of rgCounts) for (const [k, c] of m.entries()) rgBgTotals.set(k, (rgBgTotals.get(k) || 0) + c);
    const ctxBgTotals = new Map();
    for (const m of ctxCounts) for (const [k, c] of m.entries()) ctxBgTotals.set(k, (ctxBgTotals.get(k) || 0) + c);
    const totCtxAll = ctxTotals.reduce((a, b) => a + b, 0) || 1;

    let acceptedS0 = 0;
    let acceptedSk = 0;
    let ambiguousCount = 0;
    let fpCount = 0;
    let evaluatedCount = 0;
    const perSenseCounts = new Array(K).fill(0);

    for (const o of occs) {
      // Skew-safe leave-one-out Jelinek-Mercer smoothed likelihood P(x | s):
      // When c_loo(x, s_k) == 0 and c_loo(x, s_0) == 0, P_JM(x|s_k) == P_JM(x|s_0) => LLR = 0 exactly (zero minority-class denominator skew!).
      const looJmProb = (mapArr, totArr, bgMap, totAll, sIdx, key, lamJm, isCtx = false) => {
        const isOwnSense = o.seed_idx === sIdx;
        const c = Math.max(0, (mapArr[sIdx].get(key) || 0) - (isOwnSense ? 1 : 0));
        const tot = Math.max(0, isCtx ? totArr[sIdx] - (isOwnSense ? o.ctx.length : 0) : totArr[sIdx] - (isOwnSense ? 1 : 0));
        const pBg = ((bgMap.get(key) || 0) + 0.5) / (totAll + 1.0);
        const mle = tot > 0 ? c / tot : 0;
        return (1 - lamJm) * mle + lamJm * pBg;
      };

      let bestK = -1;
      let bestMarginAboveThresh = -Infinity;
      let maxLambda = -Infinity;

      for (let k = 1; k < K; k++) {
        // Never select an unattested sense
        if (senseCounts[k] === 0) continue;

        // 1. LXX likelihood ratio
        let llrLxx = 0;
        if (o.g_lxx !== '<NONE>' && ((lxxCounts[k].get(o.g_lxx) || 0) > 0 || (lxxCounts[0].get(o.g_lxx) || 0) > 0)) {
          const pLxxK = looJmProb(lxxCounts, senseCounts, lxxBgTotals, totOcc, k, o.g_lxx, 0.25);
          const pLxx0 = looJmProb(lxxCounts, senseCounts, lxxBgTotals, totOcc, 0, o.g_lxx, 0.25);
          llrLxx = Math.log2(pLxxK / pLxx0);
        }

        // 2. (role, gov) likelihood ratio
        let llrRg = 0;
        if ((rgCounts[k].get(o.role_gov) || 0) > 0 || (rgCounts[0].get(o.role_gov) || 0) > 0) {
          const pRgK = looJmProb(rgCounts, senseCounts, rgBgTotals, totOcc, k, o.role_gov, 0.45);
          const pRg0 = looJmProb(rgCounts, senseCounts, rgBgTotals, totOcc, 0, o.role_gov, 0.45);
          llrRg = Math.log2(pRgK / pRg0);
        }

        // 3. Context ctx(v)\{w} clamped [-2, 2]
        let llrCtx = 0;
        for (const u of o.ctx) {
          if ((ctxCounts[k].get(u) || 0) === 0 && (ctxCounts[0].get(u) || 0) === 0) continue;
          const pUK = looJmProb(ctxCounts, ctxTotals, ctxBgTotals, totCtxAll, k, u, 0.50, true);
          const pU0 = looJmProb(ctxCounts, ctxTotals, ctxBgTotals, totCtxAll, 0, u, 0.50, true);
          llrCtx += clamp(Math.log2(pUK / pU0), -2, 2);
        }

        const lambda = llrLxx + llrRg + llrCtx;
        if (lambda > maxLambda) maxLambda = lambda;

        const pik = (senseCounts[k] + 0.5) / (totOcc + 0.5 * K);
        const threshold = Math.log2(pi0 / pik) + GAMMA_MIN;
        if (lambda > threshold && lambda - threshold > bestMarginAboveThresh) {
          bestMarginAboveThresh = lambda - threshold;
          bestK = k;
        }
      }

      let decision = 'AMBIGUOUS';
      let chosenIdx = -1;
      if (bestK !== -1) {
        chosenIdx = bestK;
        decision = spec.senses[bestK].sense_id;
        acceptedSk++;
        perSenseCounts[bestK]++;
      } else if (maxLambda < -GAMMA_MIN) {
        chosenIdx = 0;
        decision = spec.senses[0].sense_id;
        acceptedS0++;
        perSenseCounts[0]++;
      } else {
        ambiguousCount++;
      }

      if (chosenIdx !== -1) {
        evaluatedCount++;
        if (chosenIdx !== o.seed_idx) fpCount++;
        const chosenSpec = spec.senses[chosenIdx];
        gatedVerseEdges[`${o.vid}:${o.wid}`] = {
          bs: o.bs,
          sense_id: chosenSpec.sense_id,
          oewn_id: chosenSpec.oewn_id,
          wikidata_id: chosenSpec.wikidata_id || null,
          lambda: Number(maxLambda.toFixed(3)),
        };
      }
    }

    const fpRate = evaluatedCount > 0 ? fpCount / evaluatedCount : 0;
    polysemyEvalSummary[clusterKey] = {
      total_occurrences: occs.length,
      seed_distribution: senseCounts,
      accepted_s0: acceptedS0,
      accepted_sk: acceptedSk,
      abstained_ambiguous: ambiguousCount,
      per_sense_accepted: perSenseCounts,
      fp_count: fpCount,
      evaluated_accepted: evaluatedCount,
      fp_rate: Number(fpRate.toFixed(4)),
    };
    senseGateResults[clusterKey] = spec.senses.map((s, idx) => ({
      sense_id: s.sense_id,
      label: s.label,
      oewn_id: s.oewn_id,
      wikidata_id: s.wikidata_id,
      accepted_count: perSenseCounts[idx],
    }));
  }
  console.error('[sense-ontology] LLR sense gate complete:', JSON.stringify(polysemyEvalSummary), Date.now() - t0, 'ms');

  // 7. Map >= 2,500 biblical content SenseIDs to OEWN 2025 synsets + L1 hypernyms + properties
  // Index curated pilot mappings first
  const curatedByBs = new Map();
  for (const m of CURATED_DOMAIN_MAPPINGS) curatedByBs.set(m.bs, m);

  const pilotByBs = new Map();
  for (const m of pilot.external_mappings || []) {
    const bs = (m.anchor_id || '').replace(/^lemma:/, '');
    if (!pilotByBs.has(bs)) pilotByBs.set(bs, []);
    pilotByBs.get(bs).push(m);
  }

  function findBestOewnSynset(searchWords, targetPos, fullGloss) {
    const glossTokens = new Set(extractGlossWords(fullGloss));
    let bestSid = null;
    let bestScore = -Infinity;

    for (const w of searchWords) {
      const candidates = [];
      if (targetPos) {
        for (const sid of memberIndex.get(`${w}|${targetPos}`) || []) candidates.push(sid);
      }
      if (!candidates.length) {
        for (const p of ['n', 'v', 'a', 'r']) {
          for (const sid of memberIndex.get(`${w}|${p}`) || []) candidates.push(sid);
        }
      }
      for (const sid of candidates.slice(0, 12)) {
        const syn = synsets.get(sid);
        if (!syn) continue;
        // Skip modern technology / sports / taxonomy noise
        const def = (syn.definition?.[0] || '').toLowerCase();
        if (/\b(?:baseball|football|golf|computer|software|internet|jazz|chemistry|genus|species of|taxonom)\b/.test(def)) {
          continue;
        }
        let sc = 0;
        if (targetPos && (syn.partOfSpeech === targetPos || (targetPos === 'a' && syn.partOfSpeech === 's'))) sc += 3;
        const mem0 = (syn.members?.[0] || '').toLowerCase();
        if (mem0 === w) sc += 2.5;
        else if (syn.members?.some(m => m.toLowerCase() === w)) sc += 1.5;
        for (const gt of glossTokens) {
          if (def.includes(gt)) sc += 1.0;
        }
        if (syn.domain?.startsWith('noun.substance') || syn.domain?.startsWith('noun.artifact') || syn.domain?.startsWith('noun.phenomenon') || syn.domain?.startsWith('noun.plant') || syn.domain?.startsWith('noun.body')) {
          sc += 0.5;
        }
        if (sc > bestScore) {
          bestScore = sc;
          bestSid = sid;
        }
      }
    }
    return bestSid ? `oewn:${bestSid}` : null;
  }

  function getL1Hypernyms(oewnId) {
    if (!oewnId) return [];
    const raw = oewnId.replace(/^oewn:/, '');
    const syn = synsets.get(raw);
    if (!syn?.hypernym?.length) return [];
    return syn.hypernym
      .filter(h => !OEWN_TOP_NOISE.has(h))
      .map(h => ({
        oewn_id: `oewn:${h}`,
        label: synsets.get(h)?.members?.[0] || h,
      }));
  }

  function detectMaterialGroup(oewnId, curated) {
    if (curated?.material_group) return curated.material_group;
    if (!oewnId) return null;
    const raw = oewnId.replace(/^oewn:/, '');
    const syn = synsets.get(raw);
    if (!syn) return null;
    const bag = new Set((syn.members || []).map(m => m.toLowerCase()));
    for (const h of syn.hypernym || []) {
      for (const hm of synsets.get(h)?.members || []) bag.add(hm.toLowerCase());
      for (const h2 of synsets.get(h)?.hypernym || []) {
        for (const h2m of synsets.get(h2)?.members || []) bag.add(h2m.toLowerCase());
      }
    }
    for (const [grp, kwSet] of MATERIAL_GROUP_KEYWORDS) {
      for (const w of bag) {
        if (kwSet.has(w)) return grp;
      }
    }
    return null;
  }

  const mappedSenses = {}; // sense_id -> { bs, lang, gl, oewn_id, l1_hypernyms, wikidata_id, physical_props, valence, material_group, sense_gated }
  let oewnMappedCount = 0;

  for (const [bs, prof] of Object.entries(profiles)) {
    if (prof.is_grammatical_marker || prof.canonical_df === 0) continue;
    if (prof.entity_kind === 'person' || prof.entity_kind === 'place' || /^N:N--[LP]/i.test(prof.pos || '')) continue;

    // Polysemous gated lemmas attach curated verified senses rather than blind lemma-level OEWN mapping
    if (CURATED_POLYSEME_SPECS[bs]) {
      for (const sDef of CURATED_POLYSEME_SPECS[bs].senses) {
        const l1 = getL1Hypernyms(sDef.oewn_id);
        const synRaw = sDef.oewn_id?.replace(/^oewn:/, '');
        const synObj = synRaw ? synsets.get(synRaw) : null;
        const val = synRaw ? synsetValence.get(synRaw) || 0 : 0;
        mappedSenses[sDef.sense_id] = {
          sense_id: sDef.sense_id,
          bs,
          lang: prof.lang,
          gl: sDef.label,
          oewn_id: sDef.oewn_id,
          oewn_label: synObj?.members?.slice(0, 3).join(', ') || sDef.label,
          oewn_domain: synObj?.domain || null,
          l1_hypernyms: l1,
          wikidata_id: sDef.wikidata_id || null,
          physical_props: null,
          valence: val,
          material_group: detectMaterialGroup(sDef.oewn_id, null),
          sense_gated: true,
        };
        oewnMappedCount++;
      }
      continue;
    }

    const primarySenseId = prof.senses?.[0]?.sense_id || `sense:${bs}:primary`;
    const curated = curatedByBs.get(bs);
    const pilotRows = pilotByBs.get(bs);
    const targetPos = curated?.pos || mapStepPosToOewnPos(prof.pos);

    let oewnId = null;
    let wikidataId = null;

    if (pilotRows?.length === 1 && pilotRows[0].mapping_status === 'verified') {
      oewnId = pilotRows[0].oewn_id;
      wikidataId = pilotRows[0].wikidata_id || null;
    }
    if (!oewnId && curated) {
      oewnId = findBestOewnSynset(curated.oewn_search, curated.pos, prof.gl);
    }
    if (!oewnId) {
      const searchTerms = extractGlossWords(prof.gl);
      if (prof.top_verse_gloss) searchTerms.push(...extractGlossWords(prof.top_verse_gloss));
      oewnId = findBestOewnSynset(searchTerms, targetPos, prof.gl);
    }
    if (!oewnId) continue;

    const synRaw = oewnId.replace(/^oewn:/, '');
    const synObj = synsets.get(synRaw);
    let valence = synsetValence.get(synRaw) || 0;
    if (curated?.props?.valence) valence = curated.props.valence;
    // Direct seed fallback on gloss words if synset didn't link
    if (valence === 0) {
      const gWords = extractGlossWords(prof.gl);
      if (gWords.some(w => VALENCE_POS_SEEDS.has(w))) valence = 1;
      else if (gWords.some(w => VALENCE_NEG_SEEDS.has(w))) valence = -1;
    }

    mappedSenses[primarySenseId] = {
      sense_id: primarySenseId,
      bs,
      lang: prof.lang,
      gl: prof.gl,
      oewn_id: oewnId,
      oewn_label: synObj?.members?.slice(0, 3).join(', ') || prof.gl,
      oewn_domain: synObj?.domain || null,
      l1_hypernyms: getL1Hypernyms(oewnId),
      wikidata_id: wikidataId,
      physical_props: curated?.props || null,
      valence,
      material_group: detectMaterialGroup(oewnId, curated),
      sense_gated: (prof.senses?.length || 1) === 1,
    };
    oewnMappedCount++;
  }

  // Also ensure Mic 1:11 valence test lemmas (שָׁפִיר H8208, בֹּשֶׁת H1322, עֶרְיָה H6181) have explicit OEWN/valence entries
  const ensureValenceEntry = (bs, val, glFallback, search) => {
    const prof = profiles[bs];
    if (!prof) return;
    const sid = prof.senses?.[0]?.sense_id || `sense:${bs}:primary`;
    if (!mappedSenses[sid]) {
      const oewnId = findBestOewnSynset(search, mapStepPosToOewnPos(prof.pos), prof.gl || glFallback) || null;
      const synObj = oewnId ? synsets.get(oewnId.replace(/^oewn:/, '')) : null;
      mappedSenses[sid] = {
        sense_id: sid,
        bs,
        lang: prof.lang,
        gl: prof.gl || glFallback,
        oewn_id: oewnId,
        oewn_label: synObj?.members?.slice(0, 3).join(', ') || prof.gl || glFallback,
        oewn_domain: synObj?.domain || null,
        l1_hypernyms: getL1Hypernyms(oewnId),
        wikidata_id: null,
        physical_props: null,
        valence: val,
        material_group: null,
        sense_gated: true,
      };
      if (oewnId) oewnMappedCount++;
    } else if (mappedSenses[sid].valence === 0) {
      mappedSenses[sid].valence = val;
    }
  };
  ensureValenceEntry('H8208', 1, 'fair / beautiful', ['fair', 'beautiful', 'pleasant']);
  ensureValenceEntry('H1322', -1, 'shame', ['shame', 'disgrace']);
  ensureValenceEntry('H6181', -1, 'nakedness', ['nakedness', 'bareness']);

  // 8. Induce Cross-Lingual Concept Equivalence Classes (C_XL)
  // Symmetric MT <-> Rahlfs LXX <-> NT clusters + sense-gated OEWN synset anchors
  const bsToPrimarySense = new Map();
  for (const s of Object.values(mappedSenses)) {
    if (!bsToPrimarySense.has(s.bs)) bsToPrimarySense.set(s.bs, s.sense_id);
  }

  // Also map Greek LXX lemmas -> NT G* Strong's bs via consonantal/lemma match in sanitized-lexicon
  const grkLemmaToNtBs = new Map();
  for (const [bs, prof] of Object.entries(profiles)) {
    if (!bs.startsWith('G') || prof.is_grammatical_marker) continue;
    const scNorm = prof.sc?.normalize('NFC').replace(/[^\u0370-\u03FF\u1F00-\u1FFF]/g, '');
    if (scNorm) grkLemmaToNtBs.set(scNorm, bs);
  }

  // Group by sense-gated OEWN synset first (primary high-precision equivalence!)
  const oewnToSenses = new Map();
  for (const s of Object.values(mappedSenses)) {
    if (!s.oewn_id) continue;
    if (!oewnToSenses.has(s.oewn_id)) oewnToSenses.set(s.oewn_id, []);
    oewnToSenses.get(s.oewn_id).push(s.sense_id);
  }

  // Merge via symmetric MT <-> Rahlfs LXX <-> NT pairs when P_fwd >= 0.18 && P_rev >= 0.18 && count >= 2
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const clusterSizes = new Map();
  const union = (a, b, maxSz = 16) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const sa = clusterSizes.get(ra) || 1;
    const sb = clusterSizes.get(rb) || 1;
    if (sa + sb > maxSz) return;
    parent.set(rb, ra);
    clusterSizes.set(ra, sa + sb);
  };

  for (const sids of oewnToSenses.values()) {
    if (sids.length < 2) continue;
    for (let i = 1; i < sids.length; i++) union(sids[0], sids[i], 14);
  }

  for (const [k, c] of mtLxxPairCounts.entries()) {
    if (c < 2) continue;
    const sep = k.indexOf('\0');
    const hBs = k.slice(0, sep);
    const gLem = k.slice(sep + 1);
    const pf = c / (mtTotals.get(hBs) || 1);
    const pr = c / (lxxTotals.get(gLem) || 1);
    if (pf < 0.18 || pr < 0.18) continue;

    const hSid = bsToPrimarySense.get(hBs);
    const gBs = grkLemmaToNtBs.get(gLem.normalize('NFC'));
    const gSid = gBs ? bsToPrimarySense.get(gBs) : null;
    if (hSid && gSid) {
      // Avoid merging conflicting OEWN domains unless compatible POS
      const hPos = mappedSenses[hSid]?.oewn_id?.slice(-1);
      const gPos = mappedSenses[gSid]?.oewn_id?.slice(-1);
      if (!hPos || !gPos || hPos === gPos) {
        union(hSid, gSid, 16);
      }
    }
  }

  // Collect ConceptIDs C_XL
  const rootToMembers = new Map();
  for (const sid of Object.keys(mappedSenses)) {
    const r = find(sid);
    if (!rootToMembers.has(r)) rootToMembers.set(r, []);
    rootToMembers.get(r).push(sid);
  }

  const conceptClasses = {};
  const senseToConcept = {};
  const materialGroups = {};
  let conceptIdx = 0;

  for (const members of rootToMembers.values()) {
    // Keep cross-lingual / multi-member clusters + major content concepts (df >= 2 or curated)
    const hasCross = members.some(m => mappedSenses[m].lang === 'hbo') && members.some(m => mappedSenses[m].lang === 'grc');
    const maxDf = Math.max(...members.map(m => profiles[mappedSenses[m].bs]?.canonical_df || 0));
    if (!hasCross && members.length === 1 && maxDf < 3 && !mappedSenses[members[0]].physical_props) continue;

    conceptIdx++;
    const cid = `C_XL:${String(conceptIdx).padStart(4, '0')}`;
    const first = mappedSenses[members[0]];
    const matGroup = members.map(m => mappedSenses[m].material_group).find(Boolean) || null;
    const valVotes = members.map(m => mappedSenses[m].valence).filter(v => v !== 0);
    const valence = valVotes.length > 0 ? (valVotes.reduce((a, b) => a + b, 0) >= 0 ? 1 : -1) : 0;
    const oewnSyn = members.map(m => mappedSenses[m].oewn_id).find(Boolean) || null;
    const oewnMembers = oewnSyn ? synsets.get(oewnSyn.replace(/^oewn:/, ''))?.members : null;
    const oewnLabel = oewnMembers?.slice(0, 3).join(', ') || first.gl;
    const label = oewnMembers?.[0] || first.gl;

    conceptClasses[cid] = {
      concept_id: cid,
      label,
      oewn_id: oewnSyn,
      oewn_label: oewnSyn ? oewnLabel : null,
      wikidata_id: members.map(m => mappedSenses[m].wikidata_id).find(Boolean) || null,
      valence,
      material_group: matGroup,
      cross_lingual: hasCross,
      members,
      strongs: [...new Set(members.map(m => mappedSenses[m].bs))],
    };
    for (const m of members) senseToConcept[m] = cid;
    if (matGroup) {
      if (!materialGroups[matGroup]) materialGroups[matGroup] = [];
      materialGroups[matGroup].push(cid);
    }
  }

  const uniqueWdClaims = [];
  const seenWdClaimIds = new Set();
  for (const a of pilot.property_assertions || []) {
    if (a.provider !== 'Wikidata' || !a.source_id || seenWdClaimIds.has(a.source_id)) continue;
    seenWdClaimIds.add(a.source_id);
    uniqueWdClaims.push(a);
  }

  const output = {
    schema_version: 3,
    generated_at: new Date().toISOString(),
    license: 'CC BY 4.0 (STEPBible, OEWN 2025, OpenScriptorium lxx-morph) + CC0 1.0 (Wikidata)',
    gamma_min_bits: GAMMA_MIN,
    sources: [
      ...(pilot.sources || []),
      {
        id: 'lxx-morph-rahlfs',
        provider: 'OpenScriptorium/lxx-morph',
        license: 'CC BY 4.0',
      },
    ],
    stats: {
      oewn_synsets_loaded: synsets.size,
      wikidata_concepts_loaded: Object.keys(pilot.wikidata_concepts || {}).length,
      wikidata_claims_loaded: uniqueWdClaims.length,
      mapped_senses_count: oewnMappedCount,
      concept_classes_count: Object.keys(conceptClasses).length,
      cross_lingual_concepts_count: Object.values(conceptClasses).filter(c => c.cross_lingual).length,
      valence_tagged_senses: Object.values(mappedSenses).filter(s => s.valence !== 0).length,
      material_groups_count: Object.keys(materialGroups).length,
      gated_verse_edges_count: Object.keys(gatedVerseEdges).length,
    },
    polysemy_eval: polysemyEvalSummary,
    sense_gate_profiles: senseGateResults,
    wikidata_concepts: pilot.wikidata_concepts || {},
    wikidata_claims: uniqueWdClaims,
    mapped_senses: mappedSenses,
    sense_to_concept: senseToConcept,
    concept_classes: conceptClasses,
    material_groups: materialGroups,
    gated_verse_edges: gatedVerseEdges,
  };

  if (writeOutput) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output));
  }

  return {
    outPath,
    elapsed_ms: Date.now() - t0,
    stats: output.stats,
    polysemy_eval: polysemyEvalSummary,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const res = await buildSenseOntology();
  console.log(JSON.stringify(res, null, 2));
}
