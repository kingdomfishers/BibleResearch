/**
 * Offline/online acquisition script for BibleResearch R12 external semantic & physical pilot.
 * Reads locally cached OEWN 2025 JSON (.artifacts-r12/external-cache/oewn-2025)
 * and either rebuilds deterministically from pinned Wikidata claims in
 * scripts/fixtures/r12-external-pilot.json (--from-pinned, zero network requests)
 * or fetches the compact pinned Wikidata entity extract via wbgetentities.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const WD_PROP_RE = /^wd:P\d+$/;
const WD_GUID_RE = /^[Qq]\d+\$[0-9a-fA-F-]+$/;

export function validateExternalAssertions(assertions) {
  if (!Array.isArray(assertions)) {
    throw new TypeError('Expected property_assertions array');
  }
  for (const a of assertions) {
    if (!a || typeof a !== 'object') {
      throw new TypeError('Invalid assertion entry');
    }
    if (a.provider === 'Wikidata') {
      if (typeof a.property_key !== 'string' || !WD_PROP_RE.test(a.property_key)) {
        throw new Error(`Invalid Wikidata property_key: ${a.property_key}`);
      }
      if (typeof a.source_id !== 'string' || !WD_GUID_RE.test(a.source_id)) {
        throw new Error(`Invalid Wikidata statement GUID source_id: ${a.source_id}`);
      }
      if (a.assertion_origin !== 'ORIGINAL_WIKIDATA_STATEMENT') {
        throw new Error(`Wikidata assertion missing ORIGINAL_WIKIDATA_STATEMENT origin: ${a.source_id}`);
      }
    } else if (a.provider === 'OpenEnglishWordNet') {
      if (
        a.assertion_origin !== 'ORIGINAL_OEWN_RELATION' &&
        a.assertion_origin !== 'DERIVED_OEWN_HYPERNYM_L2'
      ) {
        throw new Error(`Invalid OEWN assertion_origin: ${a.assertion_origin}`);
      }
      if (a.assertion_origin === 'DERIVED_OEWN_HYPERNYM_L2') {
        if (a.claim_status !== 'candidate' || !a.derivation_basis) {
          throw new Error(`DERIVED_OEWN_HYPERNYM_L2 must be candidate with derivation_basis: ${a.source_id}`);
        }
      }
    } else if (a.assertion_origin === 'DERIVED_PHYSICAL_ASSERTION') {
      if (a.provider === 'Wikidata' || a.claim_status !== 'candidate') {
        throw new Error(`DERIVED_PHYSICAL_ASSERTION must not claim Wikidata/sourced status: ${a.source_id}`);
      }
      if (typeof a.property_key === 'string' && a.property_key.startsWith('wd:')) {
        throw new Error(`DERIVED_PHYSICAL_ASSERTION must not use wd:* predicate: ${a.property_key}`);
      }
      if (typeof a.source_id === 'string' && WD_GUID_RE.test(a.source_id)) {
        throw new Error(`DERIVED_PHYSICAL_ASSERTION must not use Wikidata GUID: ${a.source_id}`);
      }
    }
  }
  return true;
}

// Target Wikidata QIDs (all non-geographic physical objects, materials, sensory organs, natural phenomena)
const TARGET_QIDS = [
  'Q1138737',   // lamp
  'Q821952',    // oil lamp
  'Q170476',    // menorah
  'Q327954',    // torch
  'Q1146001',   // light source
  'Q20087093',  // portable light source
  'Q548275',    // candelabra
  'Q235544',    // flame
  'Q3196',      // fire
  'Q9128',      // light
  'Q93165',     // olive oil
  'Q849004',    // candle wick
  'Q124714',    // spring (hydrology)
  'Q43483',     // water well
  'Q838858',    // cistern
  'Q283',       // water
  'Q10713454',  // water source
  'Q7364',      // eye
  'Q7873',      // blood
  'Q137931',    // Hyssopus officinalis
  'Q13714507',  // Origanum syriacum
  'Q61105',     // Cedrus libani
  'Q13222088',  // pomegranate
  'Q2268159',   // scarlet
  'Q897',       // gold
  'Q753',       // copper
  'Q34095',     // bronze
  'Q40763',     // seed
  'Q7802',      // bread
  'Q22731',     // stone
  'Q8094',      // wind
  'Q9530',      // breathing
  'Q7368',      // sheep
  'Q36465',     // flour
  'Q133235',    // combustion
  'Q3355930',   // sensory organ
  'Q1058795',   // body fluid
];

const ALLOWED_WD_PROPS = new Set(['P31', 'P279', 'P361', 'P527', 'P186', 'P1552']);

// Pinned OEWN 2025 synsets mapped to biblical concepts/lemmas (verified against .artifacts-r12/external-cache/oewn-2025/)
const OEWN_SELECTED_SYNSETS = [
  '03641539-n', // lamp (artificial source of visible illumination)
  '03751646-n', // menorah (seven-branched candelabrum)
  '04463386-n', // torch (hand-carried flammable light)
  '03670692-n', // light source (hypernym of lamp/torch)
  '04589115-n', // wick / taper
  '14991055-n', // oil
  '07689142-n', // vegetable oil / edible oil
  '13502051-n', // fire / combustion
  '11494354-n', // visible light
  '09466357-n', // spring (natural flow of ground water)
  '04579630-n', // well (shaft dug to obtain water)
  '14869913-n', // water (clear colorless liquid)
  '04569944-n', // water source / facility
  '05318579-n', // eye (organ of sight)
  '05407190-n', // blood (fluid pumped through body)
  '12869259-n', // hyssop
  '11643556-n', // cedar (genus Cedrus)
  '11643755-n', // cedar wood
  '07784670-n', // pomegranate (fruit)
  '04972154-n', // scarlet (vivid red color)
  '14662977-n', // gold
  '14659900-n', // copper
  '14741436-n', // bronze
  '11704458-n', // seed (plant ovule)
  '07695101-n', // bread
  '09438954-n', // stone / rock
  '11546388-n', // wind (air current)
  '00836693-n', // breath (breathing process)
  '14865940-n', // breath (inhaled/exhaled air)
  '02415086-n', // lamb (young sheep)
  // Expanded core physical biblical nouns (OEWN 2025 CC BY 4.0)
  '13578096-n', // smoke (hot vapor containing carbon particles from combustion)
  '11528510-n', // smoke, fume (cloud of fine particles suspended in gas)
  '14679133-n', // silver (Ag, precious metallic element)
  '14666595-n', // iron (Fe, heavy ductile magnetic metallic element)
  '07829083-n', // table salt / common salt
  '07819521-n', // wheat, wheat berry (grain)
  '07819069-n', // barley, barleycorn (grain)
  '13165571-n', // grape, grapevine (Vitis woody vine)
  '13121436-n', // vine (climbing/twining plant)
  '12422189-n', // fig, common fig tree (Ficus carica)
  '07769089-n', // fig (edible fruit)
  '09473603-n', // sun (star around which planetary system revolves)
  '15128784-n', // wool (animal fiber sheared for weaving)
  '14958169-n', // leaven, leavening (substance producing fermentation)
  '07699909-n', // matzo / unleavened bread
  '14837352-n', // clay (fine-grained plastic soil)
  '09426302-n', // rainbow (arc of colored light in sky)
  '02882960-n', // bow (weapon for shooting arrows)
];

// Explicit biblical lemma/sense -> external concept crosswalk (competing polysemous senses preserved distinct)
const externalMappings = [
  // 'ayin (H5869): EYE sense vs SPRING/FOUNTAIN sense explicitly separated!
  {
    mapping_id: 'map:H5869:eye',
    anchor_id: 'lemma:H5869',
    sense_id: 'H5869_eye',
    sense_gloss: 'eye (organ of vision)',
    oewn_id: 'oewn:05318579-n',
    wikidata_id: 'wd:Q7364',
    mapping_status: 'verified',
    competing_external_ids: ['oewn:09466357-n', 'wd:Q124714'],
    notes: 'Senses separated: H5869 denotes both anatomical eye (most frequent) and water spring (e.g. Gen 16:7). Occurrence context decides which sense applies.',
  },
  {
    mapping_id: 'map:H5869:spring',
    anchor_id: 'lemma:H5869',
    sense_id: 'H5869_spring',
    sense_gloss: 'spring / fountain of water',
    oewn_id: 'oewn:09466357-n',
    wikidata_id: 'wd:Q124714',
    mapping_status: 'candidate',
    competing_external_ids: ['oewn:05318579-n', 'wd:Q7364'],
    notes: 'Polysemous lemma H5869 ("eye" vs "spring"); hydrology sense applies specifically in water-source passages (e.g. Gen 16:7, Gen 24:13). Marked candidate at lemma level pending occurrence disambiguation.',
  },
  {
    mapping_id: 'map:H0875:well',
    anchor_id: 'lemma:H0875',
    sense_id: 'H0875_well',
    sense_gloss: 'well / dug water pit',
    oewn_id: 'oewn:04579630-n',
    wikidata_id: 'wd:Q43483',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew be\'er: excavated or natural shaft yielding groundwater (e.g. Gen 16:14, Gen 21:19).',
  },
  {
    mapping_id: 'map:H4325:water',
    anchor_id: 'lemma:H4325',
    sense_id: 'H4325_water',
    sense_gloss: 'water',
    oewn_id: 'oewn:14869913-n',
    wikidata_id: 'wd:Q283',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Primary Hebrew word for physical water.',
  },
  {
    mapping_id: 'map:G4077:spring',
    anchor_id: 'lemma:G4077',
    sense_id: 'G4077_spring',
    sense_gloss: 'spring / fountain of water',
    oewn_id: 'oewn:09466357-n',
    wikidata_id: 'wd:Q124714',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Greek pege: natural spring or fountain (e.g. John 4:6, Jas 3:11).',
  },
  {
    mapping_id: 'map:G5421:well',
    anchor_id: 'lemma:G5421',
    sense_id: 'G5421_well',
    sense_gloss: 'well / cistern / shaft',
    oewn_id: 'oewn:04579630-n',
    wikidata_id: 'wd:Q43483',
    mapping_status: 'verified',
    competing_external_ids: ['wd:Q838858'],
    notes: 'Greek phrear: deep excavated well/shaft (e.g. John 4:11-12).',
  },
  {
    mapping_id: 'map:G5204:water',
    anchor_id: 'lemma:G5204',
    sense_id: 'G5204_water',
    sense_gloss: 'water',
    oewn_id: 'oewn:14869913-n',
    wikidata_id: 'wd:Q283',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Primary Greek word for physical water.',
  },
  {
    mapping_id: 'map:G3788:eye',
    anchor_id: 'lemma:G3788',
    sense_id: 'G3788_eye',
    sense_gloss: 'eye',
    oewn_id: 'oewn:05318579-n',
    wikidata_id: 'wd:Q7364',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Primary Greek anatomical word for eye.',
  },
  // Light, lamps & fuel
  {
    mapping_id: 'map:H5216:lamp',
    anchor_id: 'lemma:H5216',
    sense_id: 'H5216_lamp',
    sense_gloss: 'oil lamp',
    oewn_id: 'oewn:03641539-n',
    wikidata_id: 'wd:Q821952',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew ner: ancient oil-fed lamp (distinct from multi-branched lampstand H4501 menorah).',
  },
  {
    mapping_id: 'map:H4501:menorah',
    anchor_id: 'lemma:H4501',
    sense_id: 'H4501_menorah',
    sense_gloss: 'lampstand / menorah',
    oewn_id: 'oewn:03751646-n',
    wikidata_id: 'wd:Q170476',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew menorah: sanctuary lampstand holding lamps (Exod 25:31-37, Zech 4:2).',
  },
  {
    mapping_id: 'map:H3940:torch',
    anchor_id: 'lemma:H3940',
    sense_id: 'H3940_torch',
    sense_gloss: 'torch / flaming brand',
    oewn_id: 'oewn:04463386-n',
    wikidata_id: 'wd:Q327954',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew lappid: hand-carried flaming torch.',
  },
  {
    mapping_id: 'map:H8081:olive_oil',
    anchor_id: 'lemma:H8081',
    sense_id: 'H8081_oil',
    sense_gloss: 'oil (primarily olive oil)',
    oewn_id: 'oewn:07689142-n',
    wikidata_id: 'wd:Q93165',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew shemen: pressed olive oil used for anointing and sanctuary lamps (Exod 27:20, Zech 4:12).',
  },
  {
    mapping_id: 'map:G3088:lamp',
    anchor_id: 'lemma:G3088',
    sense_id: 'G3088_lamp',
    sense_gloss: 'portable oil lamp',
    oewn_id: 'oewn:03641539-n',
    wikidata_id: 'wd:Q821952',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Greek lychnos: portable oil lamp (e.g. Matt 5:15, Luke 11:34).',
  },
  {
    mapping_id: 'map:G3087:lampstand',
    anchor_id: 'lemma:G3087',
    sense_id: 'G3087_lampstand',
    sense_gloss: 'lampstand',
    oewn_id: 'oewn:03751646-n',
    wikidata_id: 'wd:Q170476',
    mapping_status: 'candidate',
    competing_external_ids: ['wd:Q548275'],
    notes: 'Greek lychnia: lampstand (domestic or sanctuary; Rev 1:20 explicitly equates seven lampstands with seven churches).',
  },
  {
    mapping_id: 'map:G2985:torch',
    anchor_id: 'lemma:G2985',
    sense_id: 'G2985_torch',
    sense_gloss: 'torch / oil-fed lamp',
    oewn_id: 'oewn:04463386-n',
    wikidata_id: 'wd:Q327954',
    mapping_status: 'candidate',
    competing_external_ids: ['wd:Q821952', 'oewn:03641539-n'],
    notes: 'Greek lampas: oil-fed torch or lamp (Matt 25:1-8, Rev 4:5); keeps torch vs oil lamp distinction explicit.',
  },
  {
    mapping_id: 'map:G5457:light',
    anchor_id: 'lemma:G5457',
    sense_id: 'G5457_light',
    sense_gloss: 'light',
    oewn_id: 'oewn:11494354-n',
    wikidata_id: 'wd:Q9128',
    mapping_status: 'candidate',
    competing_external_ids: ['oewn:14587365-n'],
    notes: 'Greek phos has both physical illumination and theological/metaphorical senses; modern optical concept applies only to physical referents.',
  },
  // Breath, wind, spirit (strictly candidate physical senses — spirit sense unmapped!)
  {
    mapping_id: 'map:H7307:wind',
    anchor_id: 'lemma:H7307',
    sense_id: 'H7307_wind',
    sense_gloss: 'wind / moving air',
    oewn_id: 'oewn:11546388-n',
    wikidata_id: 'wd:Q8094',
    mapping_status: 'candidate',
    competing_external_ids: ['oewn:14865940-n', 'wd:Q9530'],
    notes: 'ruach spans spirit, wind, and breath. Do NOT project physical wind/breath onto occurrences referring to the Spirit of God without contextual evidence.',
  },
  {
    mapping_id: 'map:H7307:breath',
    anchor_id: 'lemma:H7307',
    sense_id: 'H7307_breath',
    sense_gloss: 'breath',
    oewn_id: 'oewn:14865940-n',
    wikidata_id: 'wd:Q9530',
    mapping_status: 'candidate',
    competing_external_ids: ['oewn:11546388-n', 'wd:Q8094'],
    notes: 'Breath sense of ruach, overlapping with H5397 neshamah.',
  },
  {
    mapping_id: 'map:H5397:breath',
    anchor_id: 'lemma:H5397',
    sense_id: 'H5397_breath',
    sense_gloss: 'breath / respiration',
    oewn_id: 'oewn:00836693-n',
    wikidata_id: 'wd:Q9530',
    mapping_status: 'verified',
    competing_external_ids: ['oewn:14865940-n'],
    notes: 'Hebrew neshamah: life-breath / respiration (Gen 2:7).',
  },
  {
    mapping_id: 'map:G4151:wind_breath',
    anchor_id: 'lemma:G4151',
    sense_id: 'G4151_wind_breath',
    sense_gloss: 'wind / breath (polysemous with spirit)',
    oewn_id: 'oewn:11546388-n',
    wikidata_id: 'wd:Q8094',
    mapping_status: 'candidate',
    competing_external_ids: ['oewn:00836693-n', 'wd:Q9530'],
    notes: 'Greek pneuma spans Spirit/spirit, wind (John 3:8), and breath; physical mapping is strictly candidate.',
  },
  // Sanctuary materials, plants, dyes, metals & objects
  {
    mapping_id: 'map:H8144:scarlet',
    anchor_id: 'lemma:H8144',
    sense_id: 'H8144_scarlet',
    sense_gloss: 'scarlet / crimson dye or yarn',
    oewn_id: 'oewn:04972154-n',
    wikidata_id: 'wd:Q2268159',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew shani: crimson/scarlet dyed wool/thread.',
  },
  {
    mapping_id: 'map:G2847:scarlet',
    anchor_id: 'lemma:G2847',
    sense_id: 'G2847_scarlet',
    sense_gloss: 'scarlet / crimson',
    oewn_id: 'oewn:04972154-n',
    wikidata_id: 'wd:Q2268159',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Greek kokkinos: scarlet/crimson (e.g. Heb 9:19, Rev 17:3).',
  },
  {
    mapping_id: 'map:H0231:hyssop',
    anchor_id: 'lemma:H0231',
    sense_id: 'H0231_hyssop',
    sense_gloss: 'hyssop plant (likely Origanum syriacum)',
    oewn_id: 'oewn:12869259-n',
    wikidata_id: 'wd:Q13714507',
    mapping_status: 'candidate',
    competing_external_ids: ['wd:Q137931'],
    notes: 'Botanical identification of biblical ezov is most commonly Origanum syriacum (Syrian oregano) rather than European Hyssopus officinalis.',
  },
  {
    mapping_id: 'map:G5301:hyssop',
    anchor_id: 'lemma:G5301',
    sense_id: 'G5301_hyssop',
    sense_gloss: 'hyssop plant',
    oewn_id: 'oewn:12869259-n',
    wikidata_id: 'wd:Q13714507',
    mapping_status: 'candidate',
    competing_external_ids: ['wd:Q137931'],
    notes: 'Greek hyssopos (Heb 9:19, John 19:29).',
  },
  {
    mapping_id: 'map:H0730:cedar',
    anchor_id: 'lemma:H0730',
    sense_id: 'H0730_cedar',
    sense_gloss: 'cedar tree / cedarwood (Cedrus libani)',
    oewn_id: 'oewn:11643755-n',
    wikidata_id: 'wd:Q61105',
    mapping_status: 'verified',
    competing_external_ids: ['oewn:11643556-n'],
    notes: 'Hebrew erez: Lebanon cedar / aromatic timber.',
  },
  {
    mapping_id: 'map:H7416:pomegranate',
    anchor_id: 'lemma:H7416',
    sense_id: 'H7416_pomegranate',
    sense_gloss: 'pomegranate fruit/ornament',
    oewn_id: 'oewn:07784670-n',
    wikidata_id: 'wd:Q13222088',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew rimmon: pomegranate fruit or carved sanctuary ornament.',
  },
  {
    mapping_id: 'map:H2091:gold',
    anchor_id: 'lemma:H2091',
    sense_id: 'H2091_gold',
    sense_gloss: 'gold',
    oewn_id: 'oewn:14662977-n',
    wikidata_id: 'wd:Q897',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew zahav: gold.',
  },
  {
    mapping_id: 'map:H5178:bronze',
    anchor_id: 'lemma:H5178',
    sense_id: 'H5178_bronze',
    sense_gloss: 'copper / bronze',
    oewn_id: 'oewn:14741436-n',
    wikidata_id: 'wd:Q34095',
    mapping_status: 'candidate',
    competing_external_ids: ['wd:Q753', 'oewn:14659900-n'],
    notes: 'Hebrew nechoshet covers both unalloyed copper and copper-tin bronze.',
  },
  {
    mapping_id: 'map:H1818:blood',
    anchor_id: 'lemma:H1818',
    sense_id: 'H1818_blood',
    sense_gloss: 'blood',
    oewn_id: 'oewn:05407190-n',
    wikidata_id: 'wd:Q7873',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew dam: biological blood (not to be conflated with H0120 adam).',
  },
  {
    mapping_id: 'map:G0129:blood',
    anchor_id: 'lemma:G0129',
    sense_id: 'G0129_blood',
    sense_gloss: 'blood',
    oewn_id: 'oewn:05407190-n',
    wikidata_id: 'wd:Q7873',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Greek haima: biological blood.',
  },
  {
    mapping_id: 'map:H2233:seed',
    anchor_id: 'lemma:H2233',
    sense_id: 'H2233_seed',
    sense_gloss: 'seed (botanical / extended offspring)',
    oewn_id: 'oewn:11704458-n',
    wikidata_id: 'wd:Q40763',
    mapping_status: 'candidate',
    competing_external_ids: [],
    notes: 'Hebrew zera spans agricultural seed and genealogical offspring; physical concept applies to botanical sense.',
  },
  {
    mapping_id: 'map:G4703:seed',
    anchor_id: 'lemma:G4703',
    sense_id: 'G4703_seed',
    sense_gloss: 'seed (sown agricultural seed)',
    oewn_id: 'oewn:11704458-n',
    wikidata_id: 'wd:Q40763',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Greek sporos: sown seed.',
  },
  {
    mapping_id: 'map:G4690:seed',
    anchor_id: 'lemma:G4690',
    sense_id: 'G4690_seed',
    sense_gloss: 'seed / offspring',
    oewn_id: 'oewn:11704458-n',
    wikidata_id: 'wd:Q40763',
    mapping_status: 'candidate',
    competing_external_ids: [],
    notes: 'Greek sperma: botanical seed and metaphorical offspring.',
  },
  {
    mapping_id: 'map:H3899:bread',
    anchor_id: 'lemma:H3899',
    sense_id: 'H3899_bread',
    sense_gloss: 'bread / food',
    oewn_id: 'oewn:07695101-n',
    wikidata_id: 'wd:Q7802',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew lechem: bread / baked food.',
  },
  {
    mapping_id: 'map:G0740:bread',
    anchor_id: 'lemma:G0740',
    sense_id: 'G0740_bread',
    sense_gloss: 'bread / loaf',
    oewn_id: 'oewn:07695101-n',
    wikidata_id: 'wd:Q7802',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Greek artos: baked bread / loaf.',
  },
  {
    mapping_id: 'map:H0068:stone',
    anchor_id: 'lemma:H0068',
    sense_id: 'H0068_stone',
    sense_gloss: 'stone / rock',
    oewn_id: 'oewn:09438954-n',
    wikidata_id: 'wd:Q22731',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew eben: mineral stone or cut building stone.',
  },
  {
    mapping_id: 'map:G3037:stone',
    anchor_id: 'lemma:G3037',
    sense_id: 'G3037_stone',
    sense_gloss: 'stone',
    oewn_id: 'oewn:09438954-n',
    wikidata_id: 'wd:Q22731',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Greek lithos: stone.',
  },
  // Expanded core physical biblical nouns (OEWN 2025 CC BY 4.0)
  {
    mapping_id: 'map:H0784:fire',
    anchor_id: 'lemma:H0784',
    sense_id: 'H0784_fire',
    sense_gloss: 'fire',
    oewn_id: 'oewn:13502051-n',
    wikidata_id: 'wd:Q3196',
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew esh: physical fire / combustion.',
  },
  {
    mapping_id: 'map:H6227:smoke',
    anchor_id: 'lemma:H6227',
    sense_id: 'H6227_smoke',
    sense_gloss: 'smoke',
    oewn_id: 'oewn:13578096-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: ['oewn:11528510-n'],
    notes: 'Hebrew ashan: smoke produced by fire/combustion.',
  },
  {
    mapping_id: 'map:H3701:silver',
    anchor_id: 'lemma:H3701',
    sense_id: 'H3701_silver',
    sense_gloss: 'silver (metal / currency)',
    oewn_id: 'oewn:14679133-n',
    wikidata_id: null,
    mapping_status: 'candidate',
    competing_external_ids: ['oewn:13393039-n'],
    notes: 'Hebrew keseph denotes both silver metal and silver money/shekels.',
  },
  {
    mapping_id: 'map:H1270:iron',
    anchor_id: 'lemma:H1270',
    sense_id: 'H1270_iron',
    sense_gloss: 'iron',
    oewn_id: 'oewn:14666595-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew barzel: metallic iron.',
  },
  {
    mapping_id: 'map:H4417:salt',
    anchor_id: 'lemma:H4417',
    sense_id: 'H4417_salt',
    sense_gloss: 'salt',
    oewn_id: 'oewn:07829083-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew melach: mineral/table salt (used in covenantal offerings and Salt Sea names).',
  },
  {
    mapping_id: 'map:G0217:salt',
    anchor_id: 'lemma:G0217',
    sense_id: 'G0217_salt',
    sense_gloss: 'salt',
    oewn_id: 'oewn:07829083-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Greek halas: salt (Matt 5:13, Mark 9:50, Col 4:6).',
  },
  {
    mapping_id: 'map:H2406:wheat',
    anchor_id: 'lemma:H2406',
    sense_id: 'H2406_wheat',
    sense_gloss: 'wheat',
    oewn_id: 'oewn:07819521-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: ['oewn:12162602-n'],
    notes: 'Hebrew chittah: wheat grain (and standing wheat crop).',
  },
  {
    mapping_id: 'map:G4621:wheat',
    anchor_id: 'lemma:G4621',
    sense_id: 'G4621_wheat',
    sense_gloss: 'wheat / grain',
    oewn_id: 'oewn:07819521-n',
    wikidata_id: null,
    mapping_status: 'candidate',
    competing_external_ids: ['oewn:12162602-n'],
    notes: 'Greek sitos: wheat or cereal grain (Matt 13:25, John 12:24).',
  },
  {
    mapping_id: 'map:H8184:barley',
    anchor_id: 'lemma:H8184',
    sense_id: 'H8184_barley',
    sense_gloss: 'barley',
    oewn_id: 'oewn:07819069-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: ['oewn:12143761-n'],
    notes: 'Hebrew seorah: barley grain.',
  },
  {
    mapping_id: 'map:G2916:barley',
    anchor_id: 'lemma:G2916',
    sense_id: 'G2916_barley',
    sense_gloss: 'made of barley (barley loaves)',
    oewn_id: 'oewn:07819069-n',
    wikidata_id: null,
    mapping_status: 'candidate',
    competing_external_ids: ['oewn:12143761-n'],
    notes: 'Greek krithinos: adjective denoting barley-grain composition (John 6:9, 6:13).',
  },
  {
    mapping_id: 'map:H1612:vine',
    anchor_id: 'lemma:H1612',
    sense_id: 'H1612_vine',
    sense_gloss: 'grapevine',
    oewn_id: 'oewn:13165571-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: ['oewn:13121436-n'],
    notes: 'Hebrew gephen: grapevine (Vitis).',
  },
  {
    mapping_id: 'map:G0288:vine',
    anchor_id: 'lemma:G0288',
    sense_id: 'G0288_vine',
    sense_gloss: 'grapevine',
    oewn_id: 'oewn:13165571-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: ['oewn:13121436-n'],
    notes: 'Greek ampelos: grapevine (John 15:1-5).',
  },
  {
    mapping_id: 'map:H8384:fig',
    anchor_id: 'lemma:H8384',
    sense_id: 'H8384_fig',
    sense_gloss: 'fig tree / fig',
    oewn_id: 'oewn:12422189-n',
    wikidata_id: null,
    mapping_status: 'candidate',
    competing_external_ids: ['oewn:07769089-n'],
    notes: 'Hebrew teenah denotes both fig tree and fig fruit.',
  },
  {
    mapping_id: 'map:G4808:fig_tree',
    anchor_id: 'lemma:G4808',
    sense_id: 'G4808_fig_tree',
    sense_gloss: 'fig tree',
    oewn_id: 'oewn:12422189-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: ['oewn:07769089-n'],
    notes: 'Greek suke: fig tree (Matt 21:19, Luke 13:6).',
  },
  {
    mapping_id: 'map:H8121:sun',
    anchor_id: 'lemma:H8121',
    sense_id: 'H8121_sun',
    sense_gloss: 'sun',
    oewn_id: 'oewn:09473603-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: ['oewn:11505767-n'],
    notes: 'Hebrew shemesh: sun.',
  },
  {
    mapping_id: 'map:G2246:sun',
    anchor_id: 'lemma:G2246',
    sense_id: 'G2246_sun',
    sense_gloss: 'sun',
    oewn_id: 'oewn:09473603-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: ['oewn:11505767-n'],
    notes: 'Greek helios: sun.',
  },
  {
    mapping_id: 'map:H6785:wool',
    anchor_id: 'lemma:H6785',
    sense_id: 'H6785_wool',
    sense_gloss: 'wool',
    oewn_id: 'oewn:15128784-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew tsemer: sheep wool fiber.',
  },
  {
    mapping_id: 'map:G2053:wool',
    anchor_id: 'lemma:G2053',
    sense_id: 'G2053_wool',
    sense_gloss: 'wool',
    oewn_id: 'oewn:15128784-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Greek erion: wool (Heb 9:19, Rev 1:14).',
  },
  {
    mapping_id: 'map:H2557:leaven',
    anchor_id: 'lemma:H2557',
    sense_id: 'H2557_leaven',
    sense_gloss: 'leaven / leavened dough',
    oewn_id: 'oewn:14958169-n',
    wikidata_id: null,
    mapping_status: 'candidate',
    competing_external_ids: ['oewn:07695101-n'],
    notes: 'Hebrew chamets covers fermenting leaven and leavened food.',
  },
  {
    mapping_id: 'map:H7603:leaven',
    anchor_id: 'lemma:H7603',
    sense_id: 'H7603_leaven',
    sense_gloss: 'leaven / sourdough starter',
    oewn_id: 'oewn:14958169-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew seor: fermenting leaven / sourdough starter.',
  },
  {
    mapping_id: 'map:G2219:leaven',
    anchor_id: 'lemma:G2219',
    sense_id: 'G2219_leaven',
    sense_gloss: 'leaven / yeast',
    oewn_id: 'oewn:14958169-n',
    wikidata_id: null,
    mapping_status: 'candidate',
    competing_external_ids: [],
    notes: 'Greek zume: physical leaven (Matt 13:33) and metaphorical teaching/influence (Matt 16:6).',
  },
  {
    mapping_id: 'map:H4682:unleavened_bread',
    anchor_id: 'lemma:H4682',
    sense_id: 'H4682_unleavened_bread',
    sense_gloss: 'unleavened bread',
    oewn_id: 'oewn:07699909-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew matstsah: unleavened bread.',
  },
  {
    mapping_id: 'map:G0106:unleavened_bread',
    anchor_id: 'lemma:G0106',
    sense_id: 'G0106_unleavened_bread',
    sense_gloss: 'unleavened / unleavened bread',
    oewn_id: 'oewn:07699909-n',
    wikidata_id: null,
    mapping_status: 'candidate',
    competing_external_ids: [],
    notes: 'Greek azumos: unleavened bread or Festival of Unleavened Bread.',
  },
  {
    mapping_id: 'map:H2563:clay',
    anchor_id: 'lemma:H2563',
    sense_id: 'H2563_clay',
    sense_gloss: 'clay / mortar',
    oewn_id: 'oewn:14837352-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Hebrew chomer: potter clay or mud mortar.',
  },
  {
    mapping_id: 'map:G4081:clay',
    anchor_id: 'lemma:G4081',
    sense_id: 'G4081_clay',
    sense_gloss: 'clay / mud',
    oewn_id: 'oewn:14837352-n',
    wikidata_id: null,
    mapping_status: 'verified',
    competing_external_ids: [],
    notes: 'Greek pelos: potter clay or wet clay/mud (John 9:6, Rom 9:21).',
  },
  {
    mapping_id: 'map:H7198:bow',
    anchor_id: 'lemma:H7198',
    sense_id: 'H7198_bow',
    sense_gloss: 'bow (archery weapon)',
    oewn_id: 'oewn:02882960-n',
    wikidata_id: null,
    mapping_status: 'candidate',
    competing_external_ids: ['oewn:09426302-n'],
    notes: 'Polysemous lemma H7198 qeshet: archery bow (most frequent) vs rainbow (Gen 9:13).',
  },
  {
    mapping_id: 'map:H7198:rainbow',
    anchor_id: 'lemma:H7198',
    sense_id: 'H7198_rainbow',
    sense_gloss: 'rainbow (sky arc)',
    oewn_id: 'oewn:09426302-n',
    wikidata_id: null,
    mapping_status: 'candidate',
    competing_external_ids: ['oewn:02882960-n'],
    notes: 'Polysemous lemma H7198 qeshet: rainbow sense in Gen 9:13-16 and Ezek 1:28.',
  },
];

const GENERIC_WD_METACLASSES = new Set([
  'Q223557',     // physical object
  'Q2424752',    // product
  'Q4167410',    // Wikimedia disambiguation page
  'Q112234259',  // type of physical object
  'Q16521',      // taxon
  'Q112826905',  // class of anatomical entity
  'Q103812529',  // organ type
  'Q103907369',  // biogenic substance type
  'Q112826975',  // particular anatomical entity
  'Q66576455',   // set of heterogeneous clusters
  'Q867393',     // amenity
  'Q113145171',  // type of chemical entity
  'Q119892838',  // type of mixture of chemical entities
  'Q1924900',    // metallic material
  'Q35145263',   // natural geographic object
  'Q12046615',   // feature type
  'Q19861951',   // type of food or dish
  'Q118733587',  // type of meteorological phenomenon
  'Q124326543',  // production environment factor
  'Q11992872',   // useful plant
]);

const GENERIC_OEWN_TOP_SYNSETS = new Set([
  '00001740-n', // entity
  '00001930-n', // physical entity
  '00002684-n', // object
  '00003553-n', // whole
  '00021007-n', // matter
  '00022119-n', // artifact
]);

function normalizeQualifiers(rawQualifiers) {
  if (!rawQualifiers) return [];
  if (Array.isArray(rawQualifiers)) return rawQualifiers;
  const out = [];
  for (const [prop, snaks] of Object.entries(rawQualifiers)) {
    for (const s of snaks || []) {
      out.push({
        property: prop,
        datatype: s.datatype || null,
        datavalue: s.datavalue?.value ?? null,
      });
    }
  }
  return out;
}

async function loadWikidataSource({ fromPinned, pinnedPath }) {
  if (fromPinned) {
    if (!fs.existsSync(pinnedPath)) {
      throw new Error(`Missing pinned fixture for --from-pinned: ${pinnedPath}`);
    }
    const pinned = JSON.parse(fs.readFileSync(pinnedPath, 'utf8'));
    const wdSource = (pinned.sources || []).find((s) => s.id === 'wikidata-wbgetentities');
    const externalConcepts = { ...(pinned.wikidata_concepts || {}) };
    const wdClaims = [];
    const refLabels = {};
    const seenClaims = new Set();

    for (const [k, v] of Object.entries(externalConcepts)) {
      if (v?.label) refLabels[k.replace('wd:', '')] = v.label;
    }

    const sourceClaims = Array.isArray(pinned.wikidata_claims) ? pinned.wikidata_claims : null;
    if (sourceClaims) {
      for (const c of sourceClaims) {
        if (!c.statement_id || !WD_GUID_RE.test(c.statement_id)) continue;
        const dedup = `${c.subject_qid}|${c.property_id}|${c.value_qid}|${c.statement_id}`;
        if (seenClaims.has(dedup)) continue;
        seenClaims.add(dedup);
        wdClaims.push({ ...c, qualifiers: c.qualifiers || [] });
      }
    } else {
      for (const a of pinned.property_assertions || []) {
        if (a.provider !== 'Wikidata') continue;
        if (!WD_PROP_RE.test(a.property_key || '') || !WD_GUID_RE.test(a.source_id || '')) continue;
        const subjectQid = (a.external_id || '').replace('wd:', '');
        const propId = a.property_key.replace('wd:', '');
        const valueQid = (a.value_id || '').replace('wd:', '');
        if (!subjectQid || !propId || !valueQid) continue;
        if (a.value_label) refLabels[valueQid] = a.value_label;
        const revMatch = /^wikidata-wbgetentities-rev-(\d+)$/.exec(a.release || '');
        const lastrevid = revMatch
          ? Number(revMatch[1])
          : externalConcepts[a.external_id]?.lastrevid || 'pinned';
        const dedup = `${subjectQid}|${propId}|${valueQid}|${a.source_id}`;
        if (seenClaims.has(dedup)) continue;
        seenClaims.add(dedup);
        wdClaims.push({
          subject_qid: subjectQid,
          property_id: propId,
          value_qid: valueQid,
          statement_id: a.source_id,
          rank: a.statement_rank || 'normal',
          lastrevid,
          qualifiers: Array.isArray(a.qualifiers) ? a.qualifiers : [],
        });
      }
    }

    return {
      wdExtractSha256: wdSource?.extract_sha256 || 'pinned',
      wdRelease: wdSource?.release || '2026-11-18-wbgetentities-pinned',
      externalConcepts,
      wdClaims,
      refLabels,
      generatedAt: pinned.generated_at || new Date().toISOString(),
    };
  }

  const wdUrl =
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${TARGET_QIDS.join('|')}&props=labels|descriptions|claims|info&languages=en&format=json`;
  const res = await fetch(wdUrl, {
    headers: { 'User-Agent': 'BibleResearchBot/1.0 (https://bibleresearch.kingdomfishers-custom.workers.dev)' },
  });
  if (!res.ok) throw new Error(`Wikidata API failed: ${res.status}`);
  const wdRaw = await res.json();
  const wdExtractSha256 = crypto.createHash('sha256').update(JSON.stringify(wdRaw)).digest('hex');

  const externalConcepts = {};
  const wdClaims = [];
  const referencedQids = new Set();

  for (const qid of TARGET_QIDS) {
    const ent = wdRaw.entities?.[qid];
    if (!ent || ent.missing !== undefined) continue;
    externalConcepts[`wd:${qid}`] = {
      external_id: `wd:${qid}`,
      provider: 'Wikidata',
      lastrevid: ent.lastrevid,
      label: ent.labels?.en?.value || qid,
      description: ent.descriptions?.en?.value || '',
      license: 'CC0 1.0',
      source_ref: `https://www.wikidata.org/wiki/${qid}`,
    };
    for (const prop of ALLOWED_WD_PROPS) {
      for (const c of ent.claims?.[prop] || []) {
        if (c.rank === 'deprecated') continue;
        const valQid = c.mainsnak?.datavalue?.value?.id;
        if (!valQid || typeof valQid !== 'string' || !valQid.startsWith('Q')) continue;
        referencedQids.add(valQid);
        wdClaims.push({
          subject_qid: qid,
          property_id: prop,
          value_qid: valQid,
          statement_id: c.id,
          rank: c.rank || 'normal',
          lastrevid: ent.lastrevid,
          qualifiers: normalizeQualifiers(c.qualifiers),
        });
      }
    }
  }

  const missingLabelQids = [...referencedQids].filter((q) => !externalConcepts[`wd:${q}`]);
  const refLabels = {};
  for (let i = 0; i < missingLabelQids.length; i += 45) {
    const batch = missingLabelQids.slice(i, i + 45);
    const lres = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join('|')}&props=labels|descriptions&languages=en&format=json`,
      { headers: { 'User-Agent': 'BibleResearchBot/1.0 (https://bibleresearch.kingdomfishers-custom.workers.dev)' } },
    );
    const lj = await lres.json();
    for (const [q, ent] of Object.entries(lj.entities || {})) {
      if (ent.labels?.en?.value) refLabels[q] = ent.labels.en.value;
    }
  }

  return {
    wdExtractSha256,
    wdRelease: '2026-11-18-wbgetentities-pinned',
    externalConcepts,
    wdClaims,
    refLabels,
    generatedAt: new Date().toISOString(),
  };
}

export async function acquireExternalPilot({ fromPinned = false } = {}) {
  const oewnZipPath = '.artifacts-r12/external-cache/english-wordnet-2025-json.zip';
  const oewnDir = '.artifacts-r12/external-cache/oewn-2025';
  const pinnedPath = 'scripts/fixtures/r12-external-pilot.json';
  if (!fs.existsSync(oewnZipPath) || !fs.existsSync(oewnDir)) {
    throw new Error('Missing OEWN 2025 archive in .artifacts-r12/external-cache/');
  }

  const oewnZipSha256 = crypto.createHash('sha256').update(fs.readFileSync(oewnZipPath)).digest('hex');

  const synsets = {};
  for (const f of fs.readdirSync(oewnDir)) {
    if (!f.startsWith('noun.') || !f.endsWith('.json')) continue;
    Object.assign(synsets, JSON.parse(fs.readFileSync(path.join(oewnDir, f), 'utf8')));
  }

  const {
    wdExtractSha256,
    wdRelease,
    externalConcepts,
    wdClaims,
    refLabels,
    generatedAt,
  } = await loadWikidataSource({ fromPinned, pinnedPath });

  const oewnConcepts = {};
  const oewnRelations = [];
  const oewnHypernymL2 = [];

  for (const sid of OEWN_SELECTED_SYNSETS) {
    const s = synsets[sid];
    if (!s) throw new Error(`OEWN synset not found in local archive: ${sid}`);
    oewnConcepts[`oewn:${sid}`] = {
      external_id: `oewn:${sid}`,
      provider: 'OpenEnglishWordNet',
      release: 'oewn-2025',
      members: s.members || [],
      definition: s.definition?.[0] || '',
      ili: s.ili || null,
      license: 'CC BY 4.0 (incorporating Princeton WordNet attribution)',
      source_ref: `https://en-word.net/id/oewn-${sid}`,
    };
    for (const rel of ['hypernym', 'part_meronym', 'substance_meronym', 'member_meronym']) {
      for (const targetSid of s[rel] || []) {
        const targetSyn = synsets[targetSid];
        oewnRelations.push({
          from_synset: `oewn:${sid}`,
          relation: rel,
          to_synset: `oewn:${targetSid}`,
          to_label: targetSyn?.members?.[0] || targetSid,
          to_definition: targetSyn?.definition?.[0] || '',
        });
      }
    }
    for (const midSid of s.hypernym || []) {
      const midSyn = synsets[midSid];
      for (const l2Sid of midSyn?.hypernym || []) {
        if (GENERIC_OEWN_TOP_SYNSETS.has(l2Sid)) continue;
        const l2Syn = synsets[l2Sid];
        oewnHypernymL2.push({
          from_synset: `oewn:${sid}`,
          relation: 'hypernym_l2',
          to_synset: `oewn:${l2Sid}`,
          to_label: l2Syn?.members?.[0] || l2Sid,
          derivation_basis: `oewn:${midSid}`,
        });
      }
    }
  }

  const propertyAssertions = [];
  const pushWdAssertion = (mapRow, propKey, valueId, valueLabel, statementId, sourceRef, extra = {}) => {
    propertyAssertions.push({
      anchor_id: mapRow.anchor_id,
      sense_id: mapRow.sense_id,
      sense_gloss: mapRow.sense_gloss,
      property_key: propKey,
      value_id: valueId,
      value_label: valueLabel,
      source_id: statementId,
      source_ref: sourceRef,
      provider: 'Wikidata',
      release: `wikidata-wbgetentities-rev-${wdClaims.find((c) => c.statement_id === statementId)?.lastrevid || 'pinned'}`,
      license: 'CC0 1.0',
      rights_status: 'approved',
      claim_status: 'sourced',
      mapping_status: mapRow.mapping_status,
      epistemic_layer: 'EXTERNAL_WORLD',
      external_id: mapRow.wikidata_id,
      competing_external_ids: mapRow.competing_external_ids,
      assertion_origin: 'ORIGINAL_WIKIDATA_STATEMENT',
      ...extra,
    });
  };

  const pushOewnAssertion = (mapRow, propKey, valueId, valueLabel, extra = {}) => {
    const sidRaw = mapRow.oewn_id.replace('oewn:', '');
    propertyAssertions.push({
      anchor_id: mapRow.anchor_id,
      sense_id: mapRow.sense_id,
      sense_gloss: mapRow.sense_gloss,
      property_key: propKey,
      value_id: valueId,
      value_label: valueLabel,
      source_id: extra.source_id || `oewn-2025:${sidRaw}:${propKey}->${valueId}`,
      source_ref: `https://en-word.net/id/oewn-${sidRaw}`,
      provider: 'OpenEnglishWordNet',
      release: 'oewn-2025',
      license: 'CC BY 4.0 (incorporating Princeton WordNet attribution)',
      rights_status: 'approved',
      claim_status: extra.claim_status || 'sourced',
      mapping_status: mapRow.mapping_status,
      epistemic_layer: 'EXTERNAL_WORLD',
      external_id: mapRow.oewn_id,
      competing_external_ids: mapRow.competing_external_ids,
      assertion_origin: extra.assertion_origin || 'ORIGINAL_OEWN_RELATION',
      ...(extra.derivation_basis ? { derivation_basis: extra.derivation_basis } : {}),
    });
  };

  const pushDerivedPhysicalAssertion = (mapRow, propKey, valueId, valueLabel, sourceId, sourceRef, extra = {}) => {
    propertyAssertions.push({
      anchor_id: mapRow.anchor_id,
      sense_id: mapRow.sense_id,
      sense_gloss: mapRow.sense_gloss,
      property_key: propKey,
      value_id: valueId,
      value_label: valueLabel,
      source_id: sourceId,
      source_ref: sourceRef,
      provider: 'BibleResearch Derived Physical Graph',
      release: 'r12-derived-v1',
      license: 'CC0 1.0',
      rights_status: 'approved',
      claim_status: 'candidate',
      mapping_status: mapRow.mapping_status,
      epistemic_layer: 'EXTERNAL_WORLD',
      external_id: mapRow.oewn_id || mapRow.wikidata_id,
      competing_external_ids: mapRow.competing_external_ids,
      assertion_origin: 'DERIVED_PHYSICAL_ASSERTION',
      ...extra,
    });
  };

  for (const mapRow of externalMappings) {
    if (mapRow.wikidata_id) {
      const qid = mapRow.wikidata_id.replace('wd:', '');
      const itemClaims = wdClaims.filter((c) => c.subject_qid === qid);
      for (const c of itemClaims) {
        if (GENERIC_WD_METACLASSES.has(c.value_qid)) continue;
        const label = externalConcepts[`wd:${c.value_qid}`]?.label || refLabels[c.value_qid] || c.value_qid;
        pushWdAssertion(
          mapRow,
          `wd:${c.property_id}`,
          `wd:${c.value_qid}`,
          label,
          c.statement_id,
          `https://www.wikidata.org/wiki/${qid}#${c.statement_id.replace('$', '%24')}`,
          { statement_rank: c.rank, qualifiers: c.qualifiers || [] },
        );
      }
    }

    const rels = oewnRelations.filter((r) => r.from_synset === mapRow.oewn_id);
    for (const r of rels) {
      pushOewnAssertion(mapRow, `oewn:${r.relation}`, r.to_synset, r.to_label, {
        assertion_origin: 'ORIGINAL_OEWN_RELATION',
      });
    }

    const sidRaw = mapRow.oewn_id.replace('oewn:', '');
    const l2Rels = oewnHypernymL2.filter((r) => r.from_synset === mapRow.oewn_id);
    for (const r of l2Rels) {
      const basisRaw = r.derivation_basis.replace('oewn:', '');
      pushOewnAssertion(mapRow, 'oewn:hypernym_l2', r.to_synset, r.to_label, {
        assertion_origin: 'DERIVED_OEWN_HYPERNYM_L2',
        claim_status: 'candidate',
        derivation_basis: r.derivation_basis,
        source_id: `oewn-2025:${sidRaw}:oewn:hypernym_l2->${r.to_synset}:via:${basisRaw}`,
      });
    }
  }

  // Explicit compiler hypotheses for physical domain associations (never disguised as Wikidata statements)
  const derivedClassLinks = [
    ['wd:Q821952', 'wd:Q1138737', 'lamp'],
    ['wd:Q170476', 'wd:Q1146001', 'light source'],
    ['wd:Q327954', 'wd:Q1146001', 'light source'],
    ['wd:Q124714', 'wd:Q283', 'water'],
    ['wd:Q43483', 'wd:Q283', 'water'],
    ['wd:Q283', 'wd:Q10713454', 'water source'],
    ['wd:Q897', 'wd:Q11426', 'metal'],
    ['wd:Q34095', 'wd:Q11426', 'metal'],
  ];
  for (const [subjId, targetId, fallbackLabel] of derivedClassLinks) {
    const subjQ = subjId.replace('wd:', '');
    const targQ = targetId.replace('wd:', '');
    const tLabel = externalConcepts[targetId]?.label || refLabels[targQ] || fallbackLabel;
    for (const mapRow of externalMappings.filter((m) => m.wikidata_id === subjId)) {
      pushDerivedPhysicalAssertion(
        mapRow,
        'derived:physical_class',
        targetId,
        tLabel,
        `derived:physical_class:${mapRow.sense_id}:${targQ}`,
        `https://www.wikidata.org/wiki/${subjQ}`,
        { derivation_basis: subjId },
      );
    }
  }

  const lampFuelMappings = [
    ['lemma:H5216', 'H5216_lamp', 'wd:Q93165', 'olive oil', 'wd:Q821952', 'oewn:03641539-n'],
    ['lemma:G3088', 'G3088_lamp', 'wd:Q93165', 'olive oil', 'wd:Q821952', 'oewn:03641539-n'],
    ['lemma:H8081', 'H8081_oil', 'wd:Q93165', 'olive oil', 'wd:Q93165', 'oewn:07689142-n'],
    ['lemma:H4501', 'H4501_menorah', 'wd:Q93165', 'olive oil', 'wd:Q170476', 'oewn:03751646-n'],
    ['lemma:G2985', 'G2985_torch', 'wd:Q93165', 'olive oil', 'wd:Q327954', 'oewn:04463386-n'],
  ];
  for (const [anchorId, senseId, valId, valLabel, entityWdId, entityOewnId] of lampFuelMappings) {
    const mapRow = externalMappings.find((m) => m.anchor_id === anchorId && m.sense_id === senseId);
    if (!mapRow) continue;
    pushDerivedPhysicalAssertion(
      mapRow,
      'derived:functional_association',
      valId,
      valLabel,
      `derived:lamp_fuel:${senseId}:${valId.replace('wd:', '')}`,
      `https://www.wikidata.org/wiki/${entityWdId.replace('wd:', '')}`,
      { derivation_basis: entityWdId, oewn_ref: entityOewnId },
    );
  }

  validateExternalAssertions(propertyAssertions);

  const output = {
    schema_version: 1,
    generated_at: generatedAt,
    sources: [
      {
        id: 'oewn-2025',
        provider: 'OpenEnglishWordNet',
        release: '2025',
        license: 'CC BY 4.0 (incorporating Princeton WordNet attribution)',
        publisher: 'https://en-word.net/downloads',
        download: 'https://en-word.net/static/english-wordnet-2025-json.zip',
        archive_sha256: oewnZipSha256,
        synset_count: Object.keys(oewnConcepts).length,
        relation_count: oewnRelations.length,
        hypernym_l2_count: oewnHypernymL2.length,
      },
      {
        id: 'wikidata-wbgetentities',
        provider: 'Wikidata',
        release: wdRelease,
        license: 'CC0 1.0 (structured namespace data)',
        publisher: 'https://www.wikidata.org/wiki/Wikidata:Licensing',
        api_endpoint: 'https://www.wikidata.org/w/api.php?action=wbgetentities',
        extract_sha256: wdExtractSha256,
        concept_count: Object.keys(externalConcepts).length,
        claim_count: wdClaims.length,
      },
    ],
    wikidata_concepts: externalConcepts,
    oewn_concepts: oewnConcepts,
    external_mappings: externalMappings,
    property_assertions: propertyAssertions,
  };

  fs.mkdirSync('scripts/fixtures', { recursive: true });
  fs.writeFileSync(pinnedPath, JSON.stringify(output, null, 2));
  return {
    oewn_concepts: Object.keys(oewnConcepts).length,
    wikidata_concepts: Object.keys(externalConcepts).length,
    external_mappings: externalMappings.length,
    property_assertions: propertyAssertions.length,
    oewn_sha256: oewnZipSha256.slice(0, 16),
    wd_sha256: wdExtractSha256.slice(0, 16),
    from_pinned: fromPinned,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const fromPinned = process.argv.includes('--from-pinned');
  const summary = await acquireExternalPilot({ fromPinned });
  console.log(summary);
}
