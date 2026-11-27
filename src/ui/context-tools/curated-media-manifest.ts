// @file: src/ui/context-tools/curated-media-manifest.ts
// @feature: verse-reader
// @tables: places | lexemes
// @candidates: curated-media
// @toc: imports | types | data:manifest | logic:urls | logic:places-index | logic:lookup | ui:figure

// === @section:imports ===
import type { GeographyLocation, VerseGeographyPacket } from '../../api/types';

// === @section:types ===
export type MediaEntityType = 'place' | 'feast';
export type MediaDepictionType = 'photograph' | 'artifact' | 'reconstruction' | 'historic_map';

export interface CuratedMediaAsset {
  id: string;
  entityType: MediaEntityType;
  keys: string[];
  strongs?: string[];
  title: string;
  caption: string;
  depictsPeriod: string;
  creationDate: string;
  depictionType: MediaDepictionType;
  confidence: 'established' | 'probable' | 'traditional';
  sourceURL: string;
  commonsFile: string;
  creator: string;
  licenseID: string;
  licenseURL: string;
  licenseAttribution: string;
  sourceRefs: string[];
  historicalNote?: string;
}

export interface BiblePlaceIndexEntry {
  id: string;
  name: string;
  aliases: string[];
  featureType: string;
  precision: string;
  lat: number | null;
  lon: number | null;
  strongs: string[];
  openBibleUri?: string;
  pleiadesUri?: string;
  verseCount: number;
}

export interface ResolvedPlaceSpotlight {
  placeKey: string;
  name: string;
  ancientName?: string;
  modernName?: string;
  aliases: string[];
  lat: number | null;
  lon: number | null;
  confidence: string;
  featureType?: string;
  isJerusalem: boolean;
  isIsrael?: boolean;
  media: CuratedMediaAsset[];
  sourceLabel: string;
}

// === @section:logic:urls ===
function normalizeCommonsFile(commonsFile: string): string {
  return commonsFile.trim().replace(/^file:/i, '').replace(/\s+/g, '_');
}

function buildCommonsFilePageUrl(commonsFile: string): string {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(normalizeCommonsFile(commonsFile))}`;
}

export function getCommonsThumbnailUrl(commonsFile: string, width = 640): string {
  const safeWidth = Math.max(120, Math.min(2048, Math.round(width)));
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(normalizeCommonsFile(commonsFile))}?width=${safeWidth}`;
}

// === @section:data:manifest ===
const CC_BY_SA_4 = {
  licenseID: 'CC BY-SA 4.0',
  licenseURL: 'https://creativecommons.org/licenses/by-sa/4.0/',
};
const CC_BY_SA_3 = {
  licenseID: 'CC BY-SA 3.0',
  licenseURL: 'https://creativecommons.org/licenses/by-sa/3.0/',
};
const CC_BY_3 = {
  licenseID: 'CC BY 3.0',
  licenseURL: 'https://creativecommons.org/licenses/by/3.0/',
};
const CC_BY_2 = {
  licenseID: 'CC BY 2.0',
  licenseURL: 'https://creativecommons.org/licenses/by/2.0/',
};

function makeAsset(
  spec: Omit<CuratedMediaAsset, 'sourceURL'>,
): CuratedMediaAsset {
  return {
    ...spec,
    sourceURL: buildCommonsFilePageUrl(spec.commonsFile),
  };
}

export const CURATED_MEDIA_ASSETS: readonly CuratedMediaAsset[] = [
  makeAsset({
    id: 'jerusalem-temple-mount',
    entityType: 'place',
    keys: ['jerusalem', 'zion', 'moriah', 'temple mount'],
    strongs: ['H3389', 'H3390', 'H6726', 'H4179', 'G2419', 'G2414'],
    title: 'Jerusalem — Temple Mount Platform',
    caption: 'View across the Temple Mount (Haram al-Sharif) retaining walls and platform in the Old City of Jerusalem.',
    depictsPeriod: 'Herodian & later periods',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Jerusalem, The Old city, Temple Mount 2.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_4,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 4.0)',
    sourceRefs: ['2 Chr 3:1', 'Ezra 3:10', 'Matt 24:1', 'Acts 3:1'],
    historicalNote: 'Depicts the monumental Herodian-era Temple Mount retaining platform overlaid by later Byzantine, Umayyad, and Ottoman superstructures.',
  }),
  makeAsset({
    id: 'jerusalem-old-city',
    entityType: 'place',
    keys: ['jerusalem', 'salem', 'city of david', 'jebus'],
    strongs: ['H3389', 'H3390', 'H8004', 'H2982', 'G2414', 'G2419'],
    title: 'Old City of Jerusalem',
    caption: 'Panoramic view of the walled Old City of Jerusalem rising above the Kidron and Hinnom valleys.',
    depictsPeriod: 'Iron Age to Ottoman skyline',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'The Old City of Jerusalem 1.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_3,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 3.0)',
    sourceRefs: ['2 Sam 5:7', 'Ps 122:2-3', 'Luke 19:41'],
    historicalNote: 'The visible city walls date primarily to the 16th-century Ottoman rebuild, enclosing hills occupied continuously since the Bronze and Iron Ages.',
  }),
  makeAsset({
    id: 'jerusalem-pool-of-siloam',
    entityType: 'place',
    keys: ['pool of siloam', 'siloam', 'shiloah'],
    strongs: ['H7975', 'G4611'],
    title: 'Pool of Siloam, Jerusalem',
    caption: 'Excavated stone steps of the Second Temple period Pool of Siloam at the southern outlet of Hezekiah’s Tunnel.',
    depictsPeriod: 'Second Temple / 1st century CE',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Pool of Siloam, Jerusalem.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_3,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 3.0)',
    sourceRefs: ['2 Kgs 20:20', 'Isa 8:6', 'John 9:7'],
    historicalNote: 'The stepped trapezoidal pool uncovered in 2004 dates to the late Second Temple period when pilgrims ascended from Siloam to the Temple.',
  }),
  makeAsset({
    id: 'capernaum-synagogue',
    entityType: 'place',
    keys: ['capernaum', 'kefar nahum'],
    strongs: ['G2584'],
    title: 'Capernaum Synagogue',
    caption: 'Ruins of the monumental white limestone synagogue at Capernaum on the northwestern shore of the Sea of Galilee.',
    depictsPeriod: 'Late Roman / Byzantine over 1st-c. CE basalt layer',
    creationDate: '2009 photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Capernaum synagogue by David Shankbone.jpg',
    creator: 'David Shankbone',
    ...CC_BY_3,
    licenseAttribution: 'David Shankbone (CC BY 3.0)',
    sourceRefs: ['Matt 4:13', 'Mark 1:21', 'John 6:59'],
    historicalNote: 'The standing 4th/5th-century CE limestone synagogue rests directly upon an earlier 1st-century CE black basalt synagogue foundation associated with Jesus’ Galilean ministry.',
  }),
  makeAsset({
    id: 'sea-of-galilee',
    entityType: 'place',
    keys: ['sea of galilee', 'galilee', 'gennesaret', 'tiberias', 'chinnereth'],
    strongs: ['H3672', 'G1056', 'G1082', 'G5085'],
    title: 'Sea of Galilee (Lake Kinneret)',
    caption: 'Freshwater lake in the northern Jordan Rift Valley bordered by the hills of Galilee and the Golan.',
    depictsPeriod: 'Natural landscape',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Sea of Galilee View.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_3,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 3.0)',
    sourceRefs: ['Num 34:11', 'Matt 4:18', 'Mark 4:35-41', 'John 21:1'],
  }),
  makeAsset({
    id: 'jordan-river',
    entityType: 'place',
    keys: ['jordan', 'jordan river', 'bethabara', 'bethany beyond the jordan'],
    strongs: ['H3383', 'G2446'],
    title: 'Jordan River',
    caption: 'Course of the Jordan River flowing south from the Sea of Galilee toward the Dead Sea.',
    depictsPeriod: 'Natural landscape',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'River Jordan near the Sea of Galilee.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_3,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 3.0)',
    sourceRefs: ['Josh 3:14-17', '2 Kgs 5:10', 'Matt 3:13'],
  }),
  makeAsset({
    id: 'megiddo-tel',
    entityType: 'place',
    keys: ['megiddo', 'armageddon', 'tel megiddo'],
    strongs: ['H4023', 'G0717'],
    title: 'Tel Megiddo',
    caption: 'Multi-strata archaeological mound (tell) guarding the Aruna Pass into the Jezreel Valley.',
    depictsPeriod: 'Bronze & Iron Ages',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Tel Megiddo 19.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_4,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 4.0)',
    sourceRefs: ['Josh 12:21', '1 Kgs 9:15', '2 Kgs 23:29', 'Rev 16:16'],
    historicalNote: 'Over 20 occupational layers span Canaanite, Israelite, and Assyrian strata; Revelation’s Har-Magedon draws symbolically on Megiddo’s strategic battleground.',
  }),
  makeAsset({
    id: 'jericho-tell',
    entityType: 'place',
    keys: ['jericho', 'tell es-sultan'],
    strongs: ['H3405', 'G2410'],
    title: 'Ancient Jericho (Tell es-Sultan)',
    caption: 'Aerial view of the ancient oasis tell of Jericho in the lower Jordan Valley.',
    depictsPeriod: 'Neolithic to Iron Age tell & oasis',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Jericho from above.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_3,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 3.0)',
    sourceRefs: ['Josh 6:1-20', 'Luke 18:35', 'Luke 19:1'],
    historicalNote: 'Bronze/Iron Age Jericho centers on Tell es-Sultan near Elisha’s Spring, while Herodian New Testament Jericho lay a short distance south along Wadi Qelt.',
  }),
  makeAsset({
    id: 'qumran-caves',
    entityType: 'place',
    keys: ['qumran', 'dead sea', 'salt sea', 'en-gedi', 'wilderness of judah'],
    strongs: ['H5872'],
    title: 'Qumran & Judean Wilderness Escarpment',
    caption: 'Marl terrace and limestone cliffs above the northwestern shore of the Dead Sea where the Dead Sea Scrolls were preserved.',
    depictsPeriod: 'Second Temple period (2nd c. BCE–1st c. CE)',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Qumran.jpeg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_3,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 3.0)',
    sourceRefs: ['Josh 15:61-62', '1 Sam 24:1', 'Matt 3:1'],
  }),
  makeAsset({
    id: 'bethlehem-nativity',
    entityType: 'place',
    keys: ['bethlehem', 'ephrathah', 'ephrah'],
    strongs: ['H1035', 'H0672', 'G0965'],
    title: 'Bethlehem — Church of the Nativity',
    caption: 'Traditional site in Bethlehem over a venerated cave complex remembered since early Christian centuries as the birthplace of Jesus.',
    depictsPeriod: '4th–6th c. CE basilica over earlier cave',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'traditional',
    commonsFile: 'Church of the Nativity-.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_3,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 3.0)',
    sourceRefs: ['Mic 5:2', 'Matt 2:1', 'Luke 2:4-7'],
    historicalNote: 'Justin Martyr (2nd c.) and Origen (3rd c.) mention a Bethlehem cave tradition; Constantine’s basilica was dedicated in 339 CE and rebuilt under Justinian.',
  }),
  makeAsset({
    id: 'masada-aerial',
    entityType: 'place',
    keys: ['masada', 'wilderness of engedi'],
    strongs: [],
    title: 'Masada Fortress Plateau',
    caption: 'Isolated desert plateau overlooking the Dead Sea fortified by Herod the Great in the 1st century BCE.',
    depictsPeriod: 'Herodian & First Jewish Revolt (1st c. BCE–73 CE)',
    creationDate: '2013 photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Israel-2013-Aerial 21-Masada.jpg',
    creator: 'Andrew Shiva',
    ...CC_BY_SA_4,
    licenseAttribution: 'Andrew Shiva (CC BY-SA 4.0)',
    sourceRefs: ['1 Sam 24:22'],
    historicalNote: 'Archaeology illuminates Herodian palatial architecture and Judean desert refuge strongholds (“the stronghold”).',
  }),
  makeAsset({
    id: 'caesarea-maritima-aqueduct',
    entityType: 'place',
    keys: ['caesarea', 'caesarea maritima', 'strato tower'],
    strongs: ['G2542'],
    title: 'Caesarea Maritima — Roman Aqueduct',
    caption: 'Raised coastal aqueduct built to supply fresh water from Mount Carmel springs to Herod’s port city of Caesarea.',
    depictsPeriod: 'Herodian / Roman Imperial period',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Caesarea Maritima aqueduct.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_3,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 3.0)',
    sourceRefs: ['Acts 10:1', 'Acts 23:23', 'Acts 25:1'],
  }),
  makeAsset({
    id: 'ephesus-celsus',
    entityType: 'place',
    keys: ['ephesus'],
    strongs: ['G2181'],
    title: 'Ephesus — Library of Celsus',
    caption: 'Restored monumental marble facade of the Library of Celsus in the civic center of Roman Ephesus.',
    depictsPeriod: 'Roman Imperial (c. 117 CE)',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Ephesus Celsus Library Façade.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_3,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 3.0)',
    sourceRefs: ['Acts 19:1', 'Eph 1:1', 'Rev 2:1'],
    historicalNote: 'The Library of Celsus was completed c. 117 CE, roughly six decades after Paul’s ministry in Ephesus, illustrating the Roman city’s civic monumentalism.',
  }),
  makeAsset({
    id: 'athens-areopagus',
    entityType: 'place',
    keys: ['athens', 'areopagus', 'mars hill'],
    strongs: ['G0116', 'G0697'],
    title: 'Athens — The Areopagus from the Acropolis',
    caption: 'Rocky outcrop northwest of the Athenian Acropolis where the Council of the Areopagus convened.',
    depictsPeriod: 'Classical to Roman Athens',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Areopagus from the Acropolis.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_3,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 3.0)',
    sourceRefs: ['Acts 17:16-34'],
  }),
  makeAsset({
    id: 'corinth-acropolis',
    entityType: 'place',
    keys: ['corinth', 'acrocorinth', 'achaia'],
    strongs: ['G2882', 'G0882'],
    title: 'Ancient Corinth & Acrocorinth',
    caption: 'Temple of Apollo and the towering citadel of Acrocorinth overlooking the Isthmus of Corinth.',
    depictsPeriod: 'Archaic Greek to Roman colony',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Ancient Corinth.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_3,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 3.0)',
    sourceRefs: ['Acts 18:1', '1 Cor 1:2', '2 Cor 1:1'],
  }),
  makeAsset({
    id: 'rome-forum',
    entityType: 'place',
    keys: ['rome', 'roman forum'],
    strongs: ['G4516'],
    title: 'Rome — Roman Forum',
    caption: 'Civic heart of imperial Rome, destination of Paul’s final recorded journey and early Christian letters.',
    depictsPeriod: 'Roman Republic & Empire',
    creationDate: 'Contemporary photograph',
    depictionType: 'photograph',
    confidence: 'established',
    commonsFile: 'Roman forum.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_SA_3,
    licenseAttribution: 'Wikimedia Commons (CC BY-SA 3.0)',
    sourceRefs: ['Acts 28:16', 'Rom 1:7', 'Phil 1:13'],
  }),
  makeAsset({
    id: 'ur-ziggurat',
    entityType: 'place',
    keys: ['ur', 'ur of the chaldeans', 'shinar', 'babylonia', 'chaldea'],
    strongs: ['H0218', 'H8152', 'H3778'],
    title: 'Great Ziggurat of Ur',
    caption: 'Restored stepped mudbrick ziggurat at Tell el-Muqayyar (ancient Ur) in southern Mesopotamia.',
    depictsPeriod: 'Neo-Sumerian (c. 2100 BCE) & Neo-Babylonian restoration',
    creationDate: '2005 photograph',
    depictionType: 'photograph',
    confidence: 'probable',
    commonsFile: 'Ziggurat of Ur.jpg',
    creator: 'Wikimedia Commons contributor',
    ...CC_BY_2,
    licenseAttribution: 'Wikimedia Commons (CC BY 2.0)',
    sourceRefs: ['Gen 11:28', 'Gen 11:31', 'Neh 9:7'],
    historicalNote: 'Southern Mesopotamian Ur (Tell el-Muqayyar) is the leading scholarly identification for Ur of the Chaldeans, though some traditions also link northern Mesopotamia.',
  }),
];

// === @section:logic:places-index ===
const CURATED_PLACE_COORDS: Record<string, { name: string; lat: number; lon: number; featureType: string }> = {
  'jerusalem-temple-mount': { name: 'Jerusalem', lat: 31.7781, lon: 35.2354, featureType: 'city' },
  'jerusalem-old-city': { name: 'Jerusalem', lat: 31.7767, lon: 35.2345, featureType: 'city' },
  'jerusalem-pool-of-siloam': { name: 'Pool of Siloam', lat: 31.7706, lon: 35.235, featureType: 'spring' },
  'capernaum-synagogue': { name: 'Capernaum', lat: 32.8803, lon: 35.5753, featureType: 'settlement' },
  'sea-of-galilee': { name: 'Sea of Galilee', lat: 32.8231, lon: 35.5831, featureType: 'lake' },
  'jordan-river': { name: 'Jordan River', lat: 32.0, lon: 35.55, featureType: 'river' },
  'megiddo-tel': { name: 'Megiddo', lat: 32.5853, lon: 35.1844, featureType: 'settlement' },
  'jericho-tell': { name: 'Jericho', lat: 31.8711, lon: 35.4442, featureType: 'settlement' },
  'qumran-caves': { name: 'En-gedi / Dead Sea Wilderness', lat: 31.7414, lon: 35.4594, featureType: 'region' },
  'bethlehem-nativity': { name: 'Bethlehem', lat: 31.7044, lon: 35.2075, featureType: 'settlement' },
  'masada-aerial': { name: 'Masada', lat: 31.3156, lon: 35.3536, featureType: 'fortress' },
  'caesarea-maritima-aqueduct': { name: 'Caesarea', lat: 32.5, lon: 34.89, featureType: 'settlement' },
  'ephesus-celsus': { name: 'Ephesus', lat: 37.9409, lon: 27.3414, featureType: 'city' },
  'athens-areopagus': { name: 'Athens', lat: 37.9722, lon: 23.7233, featureType: 'city' },
  'corinth-acropolis': { name: 'Corinth', lat: 37.9061, lon: 22.8803, featureType: 'city' },
  'rome-forum': { name: 'Rome', lat: 41.8925, lon: 12.4853, featureType: 'city' },
  'ur-ziggurat': { name: 'Ur', lat: 30.9628, lon: 46.1031, featureType: 'settlement' },
};

const JERUSALEM_STRONGS = new Set(['H3389', 'H3390', 'G2419', 'G2414', 'H6726', 'H8004']);
const ISRAEL_STRONGS = new Set(['H3478', 'G2474']);
const ISRAEL_LAND_MEDIA_IDS = new Set([
  'jerusalem-temple-mount',
  'jerusalem-old-city',
  'sea-of-galilee',
  'megiddo-tel',
]);
const AMBIGUOUS_ENGLISH_PLACE_WORDS = new Set([
  'on', 'no', 'so', 'sin', 'in', 'at', 'to', 'of', 'by', 'or', 'as', 'an', 'is', 'it',
  'be', 'do', 'go', 'he', 'me', 'my', 'up', 'us', 'we', 'ai', 'ram', 'ham',
  'well', 'rock', 'mount', 'spring', 'plain', 'valley', 'gate', 'hill', 'sea', 'river',
  'city', 'land', 'desert', 'wilderness', 'east', 'west', 'north', 'south', 'high', 'low',
  'new', 'old', 'red', 'salt', 'great', 'little', 'house', 'way', 'rest', 'peace', 'hope',
  'grace', 'faith', 'love', 'good', 'king', 'lord', 'god', 'man', 'men', 'son', 'sons',
]);

let loadedBiblePlaces: readonly BiblePlaceIndexEntry[] = [];
let biblePlacesLoadPromise: Promise<readonly BiblePlaceIndexEntry[]> | null = null;

export function normalizeStrongsKey(value: string): string {
  const cleaned = value.trim().replace(/^lemma:/i, '').toUpperCase();
  const m = cleaned.match(/^([HG])0*(\d+)([A-Z]*)$/);
  if (!m) return cleaned;
  return `${m[1]}${m[2]}${m[3] ?? ''}`;
}

function normalizeLookupToken(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizePlaceIndexEntry(raw: unknown): BiblePlaceIndexEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!id || !name) return null;
  return {
    id,
    name,
    aliases: Array.isArray(obj.aliases) ? obj.aliases.filter((a): a is string => typeof a === 'string' && a.trim().length > 0) : [],
    featureType: typeof obj.featureType === 'string' ? obj.featureType : 'place',
    precision: typeof obj.precision === 'string' ? obj.precision : 'probable',
    lat: typeof obj.lat === 'number' && Number.isFinite(obj.lat) ? obj.lat : null,
    lon: typeof obj.lon === 'number' && Number.isFinite(obj.lon) ? obj.lon : null,
    strongs: Array.isArray(obj.strongs) ? obj.strongs.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : [],
    openBibleUri: typeof obj.openBibleUri === 'string' ? obj.openBibleUri : undefined,
    pleiadesUri: typeof obj.pleiadesUri === 'string' ? obj.pleiadesUri : undefined,
    verseCount: typeof obj.verseCount === 'number' && Number.isFinite(obj.verseCount) ? obj.verseCount : 0,
  };
}

export function loadBiblePlacesIndex(): Promise<readonly BiblePlaceIndexEntry[]> {
  if (biblePlacesLoadPromise) return biblePlacesLoadPromise;
  biblePlacesLoadPromise = (async () => {
    if (typeof fetch !== 'function') {
      loadedBiblePlaces = [];
      return loadedBiblePlaces;
    }
    try {
      const response = await fetch('/data/bible-places-index.json');
      if (!response.ok) {
        loadedBiblePlaces = [];
        return loadedBiblePlaces;
      }
      const payload = (await response.json()) as unknown;
      const items = Array.isArray(payload)
        ? payload
        : (payload && typeof payload === 'object' && Array.isArray((payload as { places?: unknown[] }).places))
          ? (payload as { places: unknown[] }).places
          : [];
      const normalized: BiblePlaceIndexEntry[] = [];
      for (const item of items) {
        const entry = normalizePlaceIndexEntry(item);
        if (entry) normalized.push(entry);
      }
      loadedBiblePlaces = normalized;
      return loadedBiblePlaces;
    } catch {
      loadedBiblePlaces = [];
      return loadedBiblePlaces;
    }
  })();
  return biblePlacesLoadPromise;
}

export function getLoadedBiblePlaces(): readonly BiblePlaceIndexEntry[] {
  return loadedBiblePlaces;
}

export function searchBiblePlaces(query: string, limit = 20): BiblePlaceIndexEntry[] {
  const max = Math.max(1, Math.min(200, Math.round(limit)));
  const q = normalizeLookupToken(query);
  if (!q) {
    return [...loadedBiblePlaces]
      .sort((a, b) => (b.verseCount - a.verseCount) || a.name.localeCompare(b.name))
      .slice(0, max);
  }
  const strongsQuery = /^[hg]\d+[a-z]*$/i.test(query.trim()) ? normalizeStrongsKey(query) : '';
  const scored: Array<{ entry: BiblePlaceIndexEntry; score: number }> = [];

  for (const entry of loadedBiblePlaces) {
    const normId = normalizeLookupToken(entry.id);
    const normName = normalizeLookupToken(entry.name);
    const normAliases = entry.aliases.map(normalizeLookupToken);
    let score = 0;

    if (normId === q || normName === q) {
      score = 100;
    } else if (normAliases.some(a => a === q)) {
      score = 90;
    } else if (strongsQuery && entry.strongs.some(s => normalizeStrongsKey(s) === strongsQuery)) {
      score = 85;
    } else if (normName.startsWith(q)) {
      score = 70;
    } else if (normAliases.some(a => a.startsWith(q))) {
      score = 60;
    } else if (
      normName.includes(q) ||
      normId.includes(q) ||
      normAliases.some(a => a.includes(q)) ||
      normalizeLookupToken(entry.featureType).includes(q)
    ) {
      score = 40;
    }

    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) =>
    (b.score - a.score) ||
    (b.entry.verseCount - a.entry.verseCount) ||
    a.entry.name.localeCompare(b.entry.name),
  );
  return scored.slice(0, max).map(item => item.entry);
}

function computeIsJerusalem(opts: {
  strongs?: string;
  strongsList?: string[];
  placeKey?: string;
  name?: string;
  ancientName?: string;
  aliases?: string[];
}): boolean {
  const strongsCandidates = [
    ...(opts.strongs ? [opts.strongs] : []),
    ...(opts.strongsList ?? []),
  ];
  for (const raw of strongsCandidates) {
    if (JERUSALEM_STRONGS.has(normalizeStrongsKey(raw))) {
      return true;
    }
  }
  const names = [opts.placeKey ?? '', opts.name ?? '', opts.ancientName ?? '', ...(opts.aliases ?? [])]
    .map(normalizeLookupToken)
    .filter(Boolean);
  for (const n of names) {
    if (n.includes('jerusalem')) return true;
    if (n === 'zion' || n === 'mount zion') return true;
  }
  return false;
}

function extractCapitalizedPlaceCandidates(english?: string): string[] {
  if (!english) return [];
  const parts = english
    .split(/[,;/|]+/)
    .map(p => p.replace(/^[("'“‘\s]+|[.,;:!?)"'”’\s]+$/g, '').trim())
    .filter(Boolean);
  const candidates = new Set<string>();
  const prepPrefix = /^(?:in|to|into|unto|from|of|at|near|by|toward|towards|against|through|upon|over|the)\s+/i;

  for (const part of parts) {
    const stripped = part.replace(prepPrefix, '').replace(/^(?:the\s+)/i, '').trim();
    for (const candidate of [part, stripped]) {
      if (!candidate || !/^[A-Z]/.test(candidate)) continue;
      const norm = normalizeLookupToken(candidate);
      if (!norm || AMBIGUOUS_ENGLISH_PLACE_WORDS.has(norm)) continue;
      candidates.add(candidate);
    }
  }
  return [...candidates];
}

function findIndexMatch(opts: {
  placeKey?: string;
  name?: string;
  strongs?: string;
}): BiblePlaceIndexEntry | undefined {
  if (loadedBiblePlaces.length === 0) return undefined;
  const keyNorm = opts.placeKey ? normalizeLookupToken(opts.placeKey) : '';
  const nameNorm = opts.name ? normalizeLookupToken(opts.name) : '';
  const strongsNorm = opts.strongs ? normalizeStrongsKey(opts.strongs) : '';

  if (keyNorm) {
    const byId = loadedBiblePlaces.find(e => normalizeLookupToken(e.id) === keyNorm);
    if (byId) return byId;
  }
  if (strongsNorm) {
    const byStrongs = loadedBiblePlaces
      .filter(e => e.strongs.some(s => normalizeStrongsKey(s) === strongsNorm))
      .sort((a, b) => b.verseCount - a.verseCount);
    if (byStrongs[0]) return byStrongs[0];
  }
  if (nameNorm) {
    const byName = loadedBiblePlaces
      .filter(e => normalizeLookupToken(e.name) === nameNorm || e.aliases.some(a => normalizeLookupToken(a) === nameNorm))
      .sort((a, b) => b.verseCount - a.verseCount);
    if (byName[0]) return byName[0];
  }
  return undefined;
}

function findGeoLocationMatch(
  packet: VerseGeographyPacket | null | undefined,
  opts: { placeKey?: string; name?: string; strongs?: string; englishCandidates?: string[]; original?: string },
): GeographyLocation | undefined {
  const locations = packet?.locations;
  if (!locations || locations.length === 0) return undefined;

  if (opts.placeKey) {
    const keyNorm = normalizeLookupToken(opts.placeKey);
    const byKey = locations.find(loc => normalizeLookupToken(loc.place_key) === keyNorm);
    if (byKey) return byKey;
  }
  if (opts.strongs) {
    const target = normalizeStrongsKey(opts.strongs);
    if (target) {
      const byStrongs = locations.find(loc =>
        loc.strongs_numbers.some(s => normalizeStrongsKey(s) === target),
      );
      if (byStrongs) return byStrongs;
    }
  }
  const nameTargets = new Set<string>();
  if (opts.name) nameTargets.add(normalizeLookupToken(opts.name));
  for (const cand of opts.englishCandidates ?? []) {
    nameTargets.add(normalizeLookupToken(cand));
  }
  if (nameTargets.size > 0) {
    const byName = locations.find(loc => {
      const names = [loc.biblical_name, loc.ancient_name ?? '', ...loc.historical_names]
        .map(normalizeLookupToken)
        .filter(Boolean);
      return names.some(n => nameTargets.has(n));
    });
    if (byName) return byName;
  }
  if (opts.original && opts.original.trim()) {
    const orig = opts.original.trim();
    const byOrig = locations.find(loc => loc.hebrew_name === orig || loc.greek_name === orig);
    if (byOrig) return byOrig;
  }
  return undefined;
}

function formatIndexSourceLabel(entry: BiblePlaceIndexEntry): string {
  if (entry.openBibleUri && entry.pleiadesUri) return 'OpenBible.info · Pleiades';
  if (entry.openBibleUri) return 'OpenBible.info Geocoding';
  if (entry.pleiadesUri) return 'Pleiades Gazetteer';
  return 'Biblical Places Index';
}

function mergeAliases(...lists: Array<readonly string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) {
      const trimmed = item.trim();
      const norm = normalizeLookupToken(trimmed);
      if (!trimmed || seen.has(norm)) continue;
      seen.add(norm);
      out.push(trimmed);
    }
  }
  return out;
}

function computeIsIsrael(opts: {
  strongs?: string;
  strongsList?: string[];
  placeKey?: string;
  name?: string;
}): boolean {
  const strongsCandidates = [
    ...(opts.strongs ? [opts.strongs] : []),
    ...(opts.strongsList ?? []),
  ];
  for (const raw of strongsCandidates) {
    if (ISRAEL_STRONGS.has(normalizeStrongsKey(raw))) {
      return true;
    }
  }
  const normKey = normalizeLookupToken(opts.placeKey ?? '');
  const normName = normalizeLookupToken(opts.name ?? '');
  return normKey === 'israel_land' || normKey === 'israel' || normName === 'israel';
}

function buildIsraelLandSpotlight(opts: {
  strongs?: string;
  geo?: GeographyLocation;
  idx?: BiblePlaceIndexEntry;
}): ResolvedPlaceSpotlight {
  const aliases = mergeAliases(
    ['Land of Israel', 'Kingdom of Israel', 'Eretz Yisrael'],
    opts.geo?.historical_names,
    opts.idx?.aliases,
  );
  const media = CURATED_MEDIA_ASSETS.filter(
    asset => asset.entityType === 'place' && ISRAEL_LAND_MEDIA_IDS.has(asset.id),
  );
  return {
    placeKey: 'israel_land',
    name: 'Israel',
    ancientName: 'Land & Kingdom of Israel (יִשְׂרָאֵל)',
    modernName: 'Israel / West Bank',
    aliases,
    lat: 31.89,
    lon: 35.2,
    confidence: 'regional',
    featureType: 'region',
    isJerusalem: false,
    isIsrael: true,
    media,
    sourceLabel: opts.geo?.source?.attribution ?? (opts.idx ? formatIndexSourceLabel(opts.idx) : 'Curated Biblical Atlas'),
  };
}

function buildSpotlightFromSources(opts: {
  placeKey: string;
  name: string;
  ancientName?: string;
  modernName?: string;
  geo?: GeographyLocation;
  idx?: BiblePlaceIndexEntry;
  strongs?: string;
  fallbackConfidence?: string;
  fallbackFeatureType?: string;
  fallbackSourceLabel?: string;
  fallbackLat?: number | null;
  fallbackLon?: number | null;
}): ResolvedPlaceSpotlight {
  const { geo, idx } = opts;
  const placeKey = geo?.place_key ?? idx?.id ?? opts.placeKey;
  const name = geo?.biblical_name ?? idx?.name ?? opts.name;
  const ancientName = geo?.ancient_name ?? geo?.biblical_name ?? opts.ancientName;
  const modernName = geo?.modern_name ?? opts.modernName ?? undefined;
  const aliases = mergeAliases(geo?.historical_names, idx?.aliases);
  const strongsList = mergeAliases(
    opts.strongs ? [opts.strongs] : undefined,
    geo?.strongs_numbers,
    idx?.strongs,
  );
  const isIsrael = computeIsIsrael({
    strongs: opts.strongs,
    strongsList,
    placeKey,
    name,
  });
  if (isIsrael) {
    return buildIsraelLandSpotlight({ strongs: opts.strongs, geo, idx });
  }
  const lat = geo?.latitude ?? idx?.lat ?? opts.fallbackLat ?? null;
  const lon = geo?.longitude ?? idx?.lon ?? opts.fallbackLon ?? null;
  const media = getMediaForPlace({
    place_key: placeKey,
    biblical_name: name,
    ancient_name: ancientName,
    strongs_numbers: strongsList,
  });

  return {
    placeKey,
    name,
    ancientName,
    modernName,
    aliases,
    lat,
    lon,
    confidence: geo?.confidence_level ?? idx?.precision ?? opts.fallbackConfidence ?? 'probable',
    featureType: geo?.place_type ?? idx?.featureType ?? opts.fallbackFeatureType,
    isJerusalem: computeIsJerusalem({
      strongs: opts.strongs,
      strongsList,
      placeKey,
      name,
      ancientName,
      aliases,
    }),
    isIsrael: false,
    media,
    sourceLabel: geo?.source?.attribution ?? (idx ? formatIndexSourceLabel(idx) : (opts.fallbackSourceLabel ?? 'Curated Biblical Atlas')),
  };
}

export function resolvePlaceForWord(args: {
  strongs?: string;
  english?: string;
  original?: string;
  placeAnchors?: Array<{ word_position: number; place_key: string; name: string }>;
  position?: number;
  geographyPacket?: VerseGeographyPacket | null;
}): ResolvedPlaceSpotlight | null {
  const normStrongs = args.strongs ? normalizeStrongsKey(args.strongs) : '';
  const englishCandidates = extractCapitalizedPlaceCandidates(args.english);
  const hasIsraelEnglish =
    englishCandidates.some(c => normalizeLookupToken(c).replace(/['’]s$/, '') === 'israel') ||
    /\bisrael\b/i.test(args.english ?? '');

  // 0. Direct Strong's match for Israel (H3478 / G2474) -> Land / Kingdom of Israel
  if (normStrongs && ISRAEL_STRONGS.has(normStrongs)) {
    const geo = findGeoLocationMatch(args.geographyPacket, {
      placeKey: 'israel_land',
      name: 'Israel',
      strongs: normStrongs,
    });
    const idx = findIndexMatch({
      placeKey: 'israel_land',
      name: 'Israel',
      strongs: normStrongs,
    });
    return buildIsraelLandSpotlight({ strongs: normStrongs, geo, idx });
  }

  // 1a. Direct verse place anchor at word position
  if (args.position != null && args.placeAnchors && args.placeAnchors.length > 0) {
    const anchor = args.placeAnchors.find(a => a.word_position === args.position);
    if (anchor) {
      const geo = findGeoLocationMatch(args.geographyPacket, {
        placeKey: anchor.place_key,
        name: anchor.name,
        strongs: normStrongs || undefined,
      });
      const idx = findIndexMatch({
        placeKey: anchor.place_key,
        name: anchor.name,
        strongs: normStrongs || undefined,
      });
      return buildSpotlightFromSources({
        placeKey: anchor.place_key,
        name: anchor.name,
        ancientName: anchor.name,
        geo,
        idx,
        strongs: normStrongs || undefined,
        fallbackConfidence: 'established',
        fallbackSourceLabel: 'Passage Place Anchor',
      });
    }
  }

  // 1b. Verse geography packet locations matching Strong's or biblical/ancient name
  const geoMatch = findGeoLocationMatch(args.geographyPacket, {
    strongs: normStrongs || undefined,
    englishCandidates,
    original: args.original,
  });
  if (geoMatch) {
    const idx = findIndexMatch({
      placeKey: geoMatch.place_key,
      name: geoMatch.biblical_name,
      strongs: normStrongs || geoMatch.strongs_numbers[0],
    });
    return buildSpotlightFromSources({
      placeKey: geoMatch.place_key,
      name: geoMatch.biblical_name,
      ancientName: geoMatch.ancient_name,
      modernName: geoMatch.modern_name ?? undefined,
      geo: geoMatch,
      idx,
      strongs: normStrongs || undefined,
    });
  }

  // 2. Normalized Strong's lookup against loaded Bible places index and curated place assets
  if (normStrongs) {
    const idx = findIndexMatch({ strongs: normStrongs });
    if (idx) {
      return buildSpotlightFromSources({
        placeKey: idx.id,
        name: idx.name,
        idx,
        strongs: normStrongs,
      });
    }
    const curatedAsset = CURATED_MEDIA_ASSETS.find(asset =>
      asset.entityType === 'place' &&
      (asset.strongs ?? []).some(s => normalizeStrongsKey(s) === normStrongs),
    );
    if (curatedAsset) {
      const meta = CURATED_PLACE_COORDS[curatedAsset.id];
      const placeName = meta?.name ?? curatedAsset.title;
      return buildSpotlightFromSources({
        placeKey: curatedAsset.keys[0] ?? curatedAsset.id,
        name: placeName,
        ancientName: placeName,
        strongs: normStrongs,
        fallbackConfidence: curatedAsset.confidence,
        fallbackFeatureType: meta?.featureType,
        fallbackSourceLabel: 'Curated Biblical Sites',
        fallbackLat: meta?.lat ?? null,
        fallbackLon: meta?.lon ?? null,
      });
    }
  }

  // 3. Exact capitalized English place name against loaded Bible places index (guarding against common verbs/words)
  if (englishCandidates.length > 0 && loadedBiblePlaces.length > 0) {
    for (const candidate of englishCandidates) {
      const candNorm = normalizeLookupToken(candidate);
      const matches = loadedBiblePlaces
        .filter(entry =>
          Boolean(entry.featureType) &&
          (normalizeLookupToken(entry.name) === candNorm ||
            entry.aliases.some(a => normalizeLookupToken(a) === candNorm)),
        )
        .sort((a, b) => {
          const aExact = normalizeLookupToken(a.name) === candNorm ? 1 : 0;
          const bExact = normalizeLookupToken(b.name) === candNorm ? 1 : 0;
          return (bExact - aExact) || (b.verseCount - a.verseCount);
        });
      if (matches[0]) {
        const idx = matches[0];
        return buildSpotlightFromSources({
          placeKey: idx.id,
          name: idx.name,
          idx,
          strongs: normStrongs || undefined,
        });
      }
    }
  }

  // 4. English "Israel" fallback when not matched as another specific place
  if (hasIsraelEnglish) {
    const idx = findIndexMatch({ placeKey: 'israel_land', name: 'Israel', strongs: normStrongs || undefined });
    return buildIsraelLandSpotlight({ strongs: normStrongs || undefined, idx });
  }

  return null;
}

// === @section:logic:lookup ===
function buildPlaceCandidates(place: {
  place_key: string;
  biblical_name: string;
  ancient_name?: string;
}): string[] {
  const raw = [place.place_key, place.biblical_name, place.ancient_name ?? ''];
  const out = new Set<string>();
  for (const item of raw) {
    const cleaned = normalizeLookupToken(item);
    if (!cleaned) continue;
    out.add(cleaned);
    // Strip trailing disambiguation numbers like "jerusalem 1"
    const noIndex = cleaned.replace(/\s+\d+$/, '').trim();
    if (noIndex) out.add(noIndex);
  }
  return [...out];
}

function matchesPlaceKeys(asset: CuratedMediaAsset, placeTokens: string[]): boolean {
  for (const key of asset.keys) {
    const normKey = normalizeLookupToken(key);
    if (!normKey) continue;
    for (const token of placeTokens) {
      if (token === normKey) return true;
      // Match whole words when a multi-word ancient/biblical name includes the key (e.g. "ancient jerusalem")
      if (normKey.length >= 4 && token.split(' ').includes(normKey)) return true;
    }
  }
  return false;
}

export function getMediaForPlace(place: {
  place_key: string;
  biblical_name: string;
  ancient_name?: string;
  strongs_numbers?: string[];
}): CuratedMediaAsset[] {
  if (
    computeIsIsrael({
      placeKey: place.place_key,
      name: place.biblical_name,
      strongsList: place.strongs_numbers,
    })
  ) {
    return CURATED_MEDIA_ASSETS.filter(
      asset => asset.entityType === 'place' && ISRAEL_LAND_MEDIA_IDS.has(asset.id),
    );
  }

  const tokens = buildPlaceCandidates(place);
  const strongsSet = new Set((place.strongs_numbers ?? []).map(normalizeStrongsKey));
  const matches: CuratedMediaAsset[] = [];

  for (const asset of CURATED_MEDIA_ASSETS) {
    if (asset.entityType !== 'place') continue;
    const keyMatch = matchesPlaceKeys(asset, tokens);
    const strongsMatch = (asset.strongs ?? []).some(s => strongsSet.has(normalizeStrongsKey(s)));
    if (keyMatch || strongsMatch) {
      matches.push(asset);
    }
  }
  return matches;
}

export function getMediaForStrongs(strongs: string): CuratedMediaAsset[] {
  const target = normalizeStrongsKey(strongs);
  if (!target) return [];
  if (ISRAEL_STRONGS.has(target)) {
    return CURATED_MEDIA_ASSETS.filter(
      asset => asset.entityType === 'place' && ISRAEL_LAND_MEDIA_IDS.has(asset.id),
    );
  }
  return CURATED_MEDIA_ASSETS.filter(asset =>
    asset.entityType === 'place' &&
    (asset.strongs ?? []).some(s => normalizeStrongsKey(s) === target),
  );
}

// === @section:ui:figure ===
const DEPICTION_LABELS: Record<MediaDepictionType, string> = {
  photograph: 'Photograph',
  artifact: 'Artifact',
  reconstruction: 'Reconstruction',
  historic_map: 'Historic Map',
};

function createBadge(text: string, className: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function createExternalLink(href: string, label: string, className?: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = label;
  if (className) a.className = className;
  return a;
}

export function renderMediaFigure(
  asset: CuratedMediaAsset,
  opts?: { compact?: boolean; onOpenLightbox?: (asset: CuratedMediaAsset) => void },
): HTMLElement {
  const compact = Boolean(opts?.compact);
  const figure = document.createElement('figure');
  figure.className = compact ? 'curated-media-figure curated-media-figure--compact' : 'curated-media-figure';

  const mediaWrap = document.createElement('div');
  mediaWrap.className = 'curated-media-visual';

  const img = document.createElement('img');
  img.className = 'curated-media-img';
  img.src = getCommonsThumbnailUrl(asset.commonsFile, compact ? 480 : 800);
  img.alt = asset.title;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';

  const fallback = document.createElement('div');
  fallback.className = 'curated-media-fallback';
  fallback.hidden = true;
  const fbTitle = document.createElement('strong');
  fbTitle.textContent = asset.title;
  const fbDesc = document.createElement('span');
  fbDesc.textContent = asset.caption;
  const fbLink = createExternalLink(asset.sourceURL, 'Open image on Wikimedia Commons ↗', 'curated-media-fallback-link');
  fallback.append(fbTitle, fbDesc, fbLink);

  let visualTarget: HTMLElement = img;
  if (opts?.onOpenLightbox) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'curated-media-thumb-btn';
    btn.setAttribute('aria-label', `Inspect larger media details for ${asset.title}`);
    btn.append(img);
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      opts.onOpenLightbox!(asset);
    });
    visualTarget = btn;
  }

  img.addEventListener('error', () => {
    visualTarget.hidden = true;
    fallback.hidden = false;
  });

  mediaWrap.append(visualTarget, fallback);

  const badges = document.createElement('div');
  badges.className = 'curated-media-badges';
  badges.append(
    createBadge(DEPICTION_LABELS[asset.depictionType], `curated-media-badge type-${asset.depictionType}`),
    createBadge(asset.depictsPeriod, 'curated-media-badge period'),
    createBadge(asset.confidence, `curated-media-badge conf-${asset.confidence}`),
  );

  const figcaption = document.createElement('figcaption');
  figcaption.className = 'curated-media-caption';

  const titleEl = document.createElement('strong');
  titleEl.className = 'curated-media-title';
  titleEl.textContent = asset.title;

  const descEl = document.createElement('p');
  descEl.className = 'curated-media-desc';
  descEl.textContent = asset.caption;

  figcaption.append(titleEl, descEl);

  if (asset.historicalNote && !compact) {
    const noteEl = document.createElement('p');
    noteEl.className = 'curated-media-note';
    noteEl.textContent = asset.historicalNote;
    figcaption.append(noteEl);
  }

  if (asset.sourceRefs.length > 0) {
    const refsEl = document.createElement('div');
    refsEl.className = 'curated-media-refs';
    refsEl.textContent = `Refs: ${asset.sourceRefs.join(' · ')}`;
    figcaption.append(refsEl);
  }

  const licenseEl = document.createElement('div');
  licenseEl.className = 'curated-media-license';
  licenseEl.append(
    document.createTextNode(`${asset.creator} · `),
    createExternalLink(asset.licenseURL, asset.licenseAttribution),
    document.createTextNode(' · '),
    createExternalLink(asset.sourceURL, 'Commons ↗'),
  );
  figcaption.append(licenseEl);

  figure.append(mediaWrap, badges, figcaption);
  return figure;
}
