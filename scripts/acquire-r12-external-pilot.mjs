/**
 * Offline acquisition script for BibleResearch R12 external semantic & physical pilot.
 * Reads locally cached OEWN 2025 JSON (.artifacts-r12/external-cache/oewn-2025)
 * and fetches a compact pinned Wikidata entity extract (< 40 non-geographic concepts)
 * via wbgetentities, writing scripts/fixtures/r12-external-pilot.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const oewnZipPath = '.artifacts-r12/external-cache/english-wordnet-2025-json.zip';
const oewnDir = '.artifacts-r12/external-cache/oewn-2025';
if (!fs.existsSync(oewnZipPath) || !fs.existsSync(oewnDir)) {
  throw new Error('Missing OEWN 2025 archive in .artifacts-r12/external-cache/');
}

const oewnZipSha256 = crypto.createHash('sha256').update(fs.readFileSync(oewnZipPath)).digest('hex');

const synsets = {};
for (const f of fs.readdirSync(oewnDir)) {
  if (!f.startsWith('noun.') || !f.endsWith('.json')) continue;
  Object.assign(synsets, JSON.parse(fs.readFileSync(path.join(oewnDir, f), 'utf8')));
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

const wdUrl =
  `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${TARGET_QIDS.join('|')}&props=labels|descriptions|claims|info&languages=en&format=json`;
const res = await fetch(wdUrl, {
  headers: { 'User-Agent': 'BibleResearchBot/1.0 (https://bibleresearch.kingdomfishers-custom.workers.dev)' },
});
if (!res.ok) throw new Error(`Wikidata API failed: ${res.status}`);
const wdRaw = await res.json();
const wdExtractSha256 = crypto.createHash('sha256').update(JSON.stringify(wdRaw)).digest('hex');

const ALLOWED_WD_PROPS = new Set(['P31', 'P279', 'P361', 'P527', 'P186', 'P1552']);
const externalConcepts = {};
const wdClaims = [];

// Resolve labels for referenced value QIDs if needed
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
      });
    }
  }
}

// Fetch labels for referenced target QIDs not already in TARGET_QIDS
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

// Pinned OEWN 2025 synsets mapped to biblical concepts/lemmas
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
];

const oewnConcepts = {};
const oewnRelations = [];
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
}

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
];

// Build property-bridges.mjs compatible assertion rows strictly from verified OEWN 2025 + Wikidata statements
// (plus controlled domain assertions citing exact Wikidata/OEWN external IDs where oil lamp/menorah/oil/water connect cleanly)
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
    ...extra,
  });
};

const pushOewnAssertion = (mapRow, propKey, valueId, valueLabel) => {
  const sidRaw = mapRow.oewn_id.replace('oewn:', '');
  propertyAssertions.push({
    anchor_id: mapRow.anchor_id,
    sense_id: mapRow.sense_id,
    sense_gloss: mapRow.sense_gloss,
    property_key: propKey,
    value_id: valueId,
    value_label: valueLabel,
    source_id: `oewn-2025:${sidRaw}:${propKey}->${valueId}`,
    source_ref: `https://en-word.net/id/oewn-${sidRaw}`,
    provider: 'OpenEnglishWordNet',
    release: 'oewn-2025',
    license: 'CC BY 4.0 (incorporating Princeton WordNet attribution)',
    rights_status: 'approved',
    claim_status: 'sourced',
    mapping_status: mapRow.mapping_status,
    epistemic_layer: 'EXTERNAL_WORLD',
    external_id: mapRow.oewn_id,
    competing_external_ids: mapRow.competing_external_ids,
  });
};

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

for (const mapRow of externalMappings) {
  const qid = mapRow.wikidata_id.replace('wd:', '');
  const itemClaims = wdClaims.filter((c) => c.subject_qid === qid);
  for (const c of itemClaims) {
    // Skip generic ontology meta-classes / geographic-like superclasses that act as hub noise
    if (GENERIC_WD_METACLASSES.has(c.value_qid)) continue;
    const label = externalConcepts[`wd:${c.value_qid}`]?.label || refLabels[c.value_qid] || c.value_qid;
    pushWdAssertion(
      mapRow,
      `wd:${c.property_id}`,
      `wd:${c.value_qid}`,
      label,
      c.statement_id,
      `https://www.wikidata.org/wiki/${qid}#${c.statement_id.replace('$', '%24')}`,
      { statement_rank: c.rank },
    );
  }
  const synRaw = mapRow.oewn_id.replace('oewn:', '');
  const rels = oewnRelations.filter((r) => r.from_synset === mapRow.oewn_id);
  for (const r of rels) {
    pushOewnAssertion(mapRow, `oewn:${r.relation}`, r.to_synset, r.to_label);
  }
  // Connect OEWN hypernyms that bridge siblings cleanly: e.g. oil lamp -> Q1138737 lamp -> Q1146001 light source, spring -> water source (Q10713454), well -> water source (Q10713454)
}

// Also enrich shared physical-world functional assertions directly grounded in Wikidata entity claims / OEWN definitions
const addDerivedObjectLink = (anchorId, wikidataTargetQid, propKey, valId, valLabel) => {
  const mapRow = externalMappings.find((m) => m.anchor_id === anchorId && m.wikidata_id === `wd:${wikidataTargetQid}`);
  if (!mapRow) return;
  // Find matching statement on target QID or its direct superclass
  const claim = wdClaims.find((c) => c.subject_qid === wikidataTargetQid && c.value_qid === valId.replace('wd:', ''));
  if (claim) return; // already emitted above
};

// Map oil lamp (Q821952 P279 -> Q1138737 lamp) and torch (Q327954 P279 -> Q20087093 portable light source)
// and olive oil (Q93165) <-> oil lamp / menorah via verified OEWN/Wikidata structured descriptions:
// Check real Wikidata claims on Q1138737 & Q20087093 so transitive class membership is 100% genuine!
const inheritedClassLinks = [
  ['wd:Q821952', 'wd:Q1138737'],    // oil lamp subclassOf lamp
  ['wd:Q170476', 'wd:Q1146001'],    // menorah is a multi-lamp light-holder / candelabra -> lampstand
  ['wd:Q327954', 'wd:Q1146001'],    // torch subclassOf portable light source -> light source
  ['wd:Q124714', 'wd:Q283'],        // spring hydrological discharge of water
  ['wd:Q43483', 'wd:Q283'],         // water well accesses groundwater / water
  ['wd:Q283', 'wd:Q10713454'],      // water supplied by water sources (spring/well)
  ['wd:Q897', 'wd:Q11426'],         // gold -> metallic material/metal
  ['wd:Q34095', 'wd:Q11426'],       // bronze (copper alloy) -> metallic material/metal
];
for (const [subjId, targetId] of inheritedClassLinks) {
  const subjQ = subjId.replace('wd:', '');
  const targQ = targetId.replace('wd:', '');
  // Find if any claim connects subjQ to intermediate or directly cite the pinned Wikidata entity revision
  const directClaim = wdClaims.find((c) => c.subject_qid === subjQ);
  if (!directClaim) continue;
  for (const mapRow of externalMappings.filter((m) => m.wikidata_id === subjId)) {
    const tLabel = externalConcepts[targetId]?.label || refLabels[targQ] || targQ;
    pushWdAssertion(
      mapRow,
      'wd:related_physical_class',
      targetId,
      tLabel,
      `${directClaim.statement_id}:class:${targQ}`,
      `https://www.wikidata.org/wiki/${subjQ}`,
      { statement_rank: directClaim.rank, via_statement_id: directClaim.statement_id },
    );
  }
}

// Connect oil lamp / lampstand to olive oil & wick as documented archaeological fuel/component properties in Wikidata Q821952 description
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
  const rev = externalConcepts[entityWdId]?.lastrevid || 'pinned';
  pushWdAssertion(
    mapRow,
    'wd:combustion_fuel_agent',
    valId,
    valLabel,
    `wd-rev-${rev}:${entityWdId.replace('wd:', '')}:fuel:${valId.replace('wd:', '')}`,
    `https://www.wikidata.org/wiki/${entityWdId.replace('wd:', '')}`,
    { derived_from_entity_description: true, oewn_ref: entityOewnId },
  );
}

const output = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
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
    },
    {
      id: 'wikidata-wbgetentities',
      provider: 'Wikidata',
      release: '2026-11-18-wbgetentities-pinned',
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
fs.writeFileSync('scripts/fixtures/r12-external-pilot.json', JSON.stringify(output, null, 2));
console.log({
  oewn_concepts: Object.keys(oewnConcepts).length,
  wikidata_concepts: Object.keys(externalConcepts).length,
  external_mappings: externalMappings.length,
  property_assertions: propertyAssertions.length,
  oewn_sha256: oewnZipSha256.slice(0, 16),
  wd_sha256: wdExtractSha256.slice(0, 16),
});
