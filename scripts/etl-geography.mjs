// Offline deterministic ETL for Context-Aware Biblical Geography.
// Reconciles OpenBible, Theographic, STEPBible TIPNR, Pleiades links, and curated narrative passage contexts.
import fs from 'node:fs/promises';
import { OPENBIBLE_COMMIT, THEOGRAPHIC_COMMIT, STEPBIBLE_COMMIT } from './audit-geography.mjs';

const root = '.artifacts/geography';
const parseJsonl = async file => (await fs.readFile(`${root}/${file}`, 'utf8'))
  .replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));

const report = JSON.parse(await fs.readFile(`${root}/report.json`, 'utf8'));
const ancient = await parseJsonl('ancient.jsonl');
const modern = await parseJsonl('modern.jsonl');
const geometry = await parseJsonl('geometry.jsonl');
const obSources = await parseJsonl('source.jsonl');
const theoPlaces = JSON.parse((await fs.readFile(`${root}/theographic-places.json`, 'utf8')).replace(/^\uFEFF/, ''));
const tipnrPlaces = JSON.parse(await fs.readFile(`${root}/tipnr-places.json`, 'utf8'));
const theoEvents = JSON.parse((await fs.readFile('.artifacts/chronology-audit/events.json', 'utf8')).replace(/^\uFEFF/, ''));
const theoVerses = JSON.parse((await fs.readFile('.artifacts/chronology-audit/verses.json', 'utf8')).replace(/^\uFEFF/, ''));
const stepVerses = JSON.parse((await fs.readFile('.artifacts/stepbible/verses.json', 'utf8')).replace(/^\uFEFF/, ''));
const curatedPassages = JSON.parse(await fs.readFile('data/geography/passage-contexts.json', 'utf8'));

// Map OSIS book abbreviations to canonical 1-66 book numbers
const OSIS_TO_BOOK = {
  Gen: 1, Exod: 2, Lev: 3, Num: 4, Deut: 5, Josh: 6, Judg: 7, Ruth: 8,
  '1Sam': 9, '2Sam': 10, '1Kgs': 11, '2Kgs': 12, '1Chr': 13, '2Chr': 14,
  Ezra: 15, Neh: 16, Esth: 17, Job: 18, Ps: 19, Prov: 20, Eccl: 21,
  Song: 22, Isa: 23, Jer: 24, Lam: 25, Ezek: 26, Dan: 27, Hos: 28,
  Joel: 29, Amos: 30, Obad: 31, Jonah: 32, Mic: 33, Nah: 34, Hab: 35,
  Zeph: 36, Hag: 37, Zech: 38, Mal: 39, Matt: 40, Mark: 41, Luke: 42,
  John: 43, Acts: 44, Rom: 45, '1Cor': 46, '2Cor': 47, Gal: 48, Eph: 49,
  Phil: 50, Col: 51, '1Thess': 52, '2Thess': 53, '1Tim': 54, '2Tim': 55,
  Titus: 56, Phlm: 57, Heb: 58, Jas: 59, '1Pet': 60, '2Pet': 61,
  '1John': 62, '2John': 63, '3John': 64, Jude: 65, Rev: 66,
};

function parseOsis(osis) {
  const m = String(osis ?? '').match(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const book = OSIS_TO_BOOK[m[1]];
  if (!book) return null;
  return { book, chapter: Number(m[2]), verse: Number(m[3]), key: `${book}-${Number(m[2])}-${Number(m[3])}` };
}

const validStepAddresses = new Set(stepVerses.map(v => `${v.book}-${v.chapter}-${v.verse_nr}`));
const modernById = new Map(modern.map(m => [m.id, m]));
const geomById = new Map(geometry.map(g => [g.id, g]));
const obSourceById = new Map(obSources.map(s => [s.id, s]));
const tipnrById = new Map(tipnrPlaces.map(t => [t.tipnrId, t]));
const tipnrByName = new Map();
for (const t of tipnrPlaces) {
  const k = t.name.toLowerCase();
  if (!tipnrByName.has(k)) tipnrByName.set(k, t);
}
const theoPlaceById = new Map(theoPlaces.map(p => [p.id, p]));
const theoPlaceBySlug = new Map();
for (const p of theoPlaces) {
  if (p.fields.placeLookup) theoPlaceBySlug.set(String(p.fields.placeLookup).toLowerCase(), p);
  if (p.fields.displayTitle) theoPlaceBySlug.set(String(p.fields.displayTitle).toLowerCase(), p);
}

// Build polygon geometry from rough_boundary or regional radius when needed
function buildRoughGeometry(geomRec, lon, lat, radiusDeg = 0.18, credit = 'openbible') {
  if (geomRec?.suggested?.rough_boundary?.length >= 3) {
    const ring = geomRec.suggested.rough_boundary.map(pair => {
      const [lo, la] = pair.split(',').map(Number);
      return [Number(lo.toFixed(5)), Number(la.toFixed(5))];
    });
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      ring.push([...ring[0]]);
    }
    const lons = ring.map(p => p[0]);
    const lats = ring.map(p => p[1]);
    return {
      geometry: { type: 'Polygon', coordinates: [ring], credit: geomRec.source || credit },
      bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    };
  }
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    const pts = 12;
    const ring = [];
    for (let i = 0; i <= pts; i++) {
      const ang = (i / pts) * Math.PI * 2;
      ring.push([
        Number((lon + Math.cos(ang) * radiusDeg * 1.2).toFixed(5)),
        Number((lat + Math.sin(ang) * radiusDeg).toFixed(5)),
      ]);
    }
    return {
      geometry: { type: 'Polygon', coordinates: [ring], credit: 'approximate_region' },
      bbox: [
        Number((lon - radiusDeg * 1.2).toFixed(5)),
        Number((lat - radiusDeg).toFixed(5)),
        Number((lon + radiusDeg * 1.2).toFixed(5)),
        Number((lat + radiusDeg).toFixed(5)),
      ],
    };
  }
  return { geometry: null, bbox: null };
}

// 1. Sources
const geoSources = [
  ...report.manifest.map(m => ({
    source_key: m.key,
    dataset: m.dataset,
    version: m.version,
    locator: m.url,
    sha256: m.sha256,
    license: m.license,
    attribution: m.attribution,
    raw_metadata: { file: m.file, bytes: m.bytes },
  })),
  {
    source_key: 'pleiades_gazetteer',
    dataset: 'Pleiades Gazetteer of Ancient Places',
    version: '2026-snapshot',
    locator: 'https://pleiades.stoa.org',
    sha256: null,
    license: 'CC BY 3.0',
    attribution: 'Pleiades contributors (https://pleiades.stoa.org), CC BY 3.0',
    raw_metadata: { linked_via: ['openbible:s2428ed', 'theographic:recogitoUri'] },
  },
  {
    source_key: 'curated_narrative_geography',
    dataset: 'BibleResearch Curated Narrative Passage Geography',
    version: '1.0.0',
    locator: 'data/geography/passage-contexts.json',
    sha256: null,
    license: 'CC BY 4.0',
    attribution: 'Curated narrative boundaries citing explicit Scripture references and OpenBible/Theographic/STEP identifiers',
    raw_metadata: { passages: curatedPassages.length },
  },
];

// 2. Places & Place Locations
const places = [];
const locations = [];
const obIdToPlaceKey = new Map();
const theoIdToPlaceKey = new Map();

// Regional/approximate place IDs that should always carry an approximate_region polygon
const regionalAncientIds = new Set([
  'a6d9af3', // Haran (also used for regional pastoral context in Gen 29)
  'a282dce', // Samaria 2 (region)
  'af3daeb', // Eden 1
  'af725b1', // Shinar
  'af301ca', // Egypt
  'acc6d8e', // Midian
  'a0f54e4', // Wilderness of Sin
  'ae50cf1', // Wilderness of Sinai
  'acdbce0', // Wilderness of Shur
]);

for (const anc of ancient) {
  const placeKey = `openbible:${anc.id}`;
  obIdToPlaceKey.set(anc.id, placeKey);
  const tipnrId = anc.linked_data?.s3b25cf?.id?.split('(')[0]?.trim() ?? null;
  const tipnr = (tipnrId && tipnrById.get(tipnrId)) || tipnrByName.get(anc.friendly_id.replace(/\s+\d+$/, '').toLowerCase()) || null;
  const theoKey = anc.linked_data?.s294e03?.id?.toLowerCase() ?? anc.friendly_id.toLowerCase();
  const theo = theoPlaceBySlug.get(theoKey) || null;
  if (theo) theoIdToPlaceKey.set(theo.id, placeKey);

  const pleiadesId = anc.linked_data?.s2428ed?.id
    || (theo?.fields?.recogitoUri?.match(/pleiades\.stoa\.org\/places\/(\d+)/)?.[1])
    || null;
  const wikidataId = anc.linked_data?.s7cc8b2?.id || null;

  const histNames = new Set();
  if (anc.friendly_id) histNames.add(anc.friendly_id);
  if (theo?.fields?.kjvName) histNames.add(theo.fields.kjvName);
  if (theo?.fields?.esvName) histNames.add(theo.fields.esvName);
  if (theo?.fields?.recogitoLabel) histNames.add(theo.fields.recogitoLabel);
  if (anc.translation_name_counts) {
    for (const k of Object.keys(anc.translation_name_counts)) histNames.add(k);
  }

  const placeType = anc.types?.[0] || theo?.fields?.featureType?.toLowerCase() || 'place';
  const isNonPhysical = ['vision', 'heavenly', 'mythical', 'symbolic'].includes(placeType);

  places.push({
    place_key: placeKey,
    biblical_name: anc.friendly_id,
    historical_names: [...histNames].slice(0, 10),
    hebrew_name: tipnr?.hebrewName ?? null,
    greek_name: tipnr?.greekName ?? null,
    strongs_numbers: tipnr?.strongs ?? [],
    place_type: placeType,
    is_non_physical: isNonPhysical,
    external_ids: {
      openbible_id: anc.id,
      theographic_id: theo?.id ?? null,
      tipnr_id: tipnr?.tipnrId ?? tipnrId,
      pleiades_id: pleiadesId,
      pleiades_url: pleiadesId ? `https://pleiades.stoa.org/places/${pleiadesId}` : null,
      wikidata_id: wikidataId,
      wikidata_url: wikidataId ? `https://www.wikidata.org/wiki/${wikidataId}` : null,
      openbible_url: `https://www.openbible.info/geo/ancient/${anc.id}/${anc.url_slug || ''}`,
    },
    primary_source_key: 'openbible_ancient',
    source_info: {
      url_slug: anc.url_slug,
      types: anc.types ?? [],
      tipnr_description: tipnr?.description ?? null,
    },
  });

  // Extract identifications from extra.associations + identifications[]
  let extra = {};
  try { extra = anc.extra ? JSON.parse(anc.extra) : {}; } catch { extra = {}; }
  const assocs = Array.isArray(extra.associations) ? extra.associations : [];
  const idList = Array.isArray(anc.identifications) ? anc.identifications : [];

  if (assocs.length === 0 && idList.length === 0) {
    locations.push({
      location_key: `${placeKey}:unknown`,
      place_key: placeKey,
      rank_order: 1,
      modern_name: 'Unidentified ancient site',
      latitude: null,
      longitude: null,
      geometry: null,
      bbox: null,
      precision_kind: 'none',
      location_status: 'unknown',
      confidence_label: 'Location unknown in scholarly sources',
      raw_source_score: {},
      is_alternative: false,
      evidence_summary: `No consensus or verifiable physical coordinates established for ${anc.friendly_id}.`,
      source_citations: [],
      source_key: 'openbible_ancient',
    });
    continue;
  }

  // Keep up to top 8 scholarly identifications per ancient place to keep DB & RPC fast while preserving all major disputed proposals
  const topAssocs = assocs.slice(0, 8);
  const topScore = topAssocs[0]?.score ?? 0;
  const secondScore = topAssocs[1]?.score ?? null;
  const isDisputedMulti = topAssocs.length > 1 && (topScore < 600 || (secondScore !== null && secondScore >= topScore * 0.2));

  for (let idx = 0; idx < topAssocs.length; idx++) {
    const assoc = topAssocs[idx];
    const mod = modernById.get(assoc.modern_id) || null;
    const idObj = idList[assoc.identification_ids?.[0]?.[0] ?? idx] || idList[0] || {};
    const scoreObj = idObj.score || { time_total: assoc.score };
    let lon = null, lat = null;
    const lonlatStr = mod?.lonlat || idObj?.resolutions?.[0]?.lonlat || null;
    if (lonlatStr && lonlatStr.includes(',')) {
      const [lo, la] = lonlatStr.split(',').map(Number);
      if (Number.isFinite(lo) && Number.isFinite(la)) { lon = lo; lat = la; }
    }

    const geomId = mod?.geometry_id || idObj?.resolutions?.[0]?.geometry_id || null;
    const geomRec = geomId ? geomById.get(geomId) : null;
    const isRegionType = ['region', 'mountain range', 'body of water', 'river', 'island', 'valley', 'road'].includes(placeType)
      || mod?.precision?.granularity === 'region'
      || regionalAncientIds.has(anc.id)
      || Boolean(geomRec?.suggested?.rough_boundary);

    const { geometry: polyGeom, bbox } = isRegionType
      ? buildRoughGeometry(geomRec, lon, lat, placeType === 'settlement' ? 0.14 : 0.25, anc.geometry_credit || 'openbible')
      : { geometry: null, bbox: lon !== null && lat !== null ? [lon, lat, lon, lat] : null };

    const scoreVal = Number(assoc.score ?? scoreObj.time_total ?? 0);
    let locStatus = 'probable';
    if (lon === null && !polyGeom) locStatus = 'unknown';
    else if (isDisputedMulti || idx > 0) locStatus = scoreVal >= 550 && idx === 0 ? 'probable' : 'disputed';
    else if (placeType === 'region' && !mod) locStatus = 'regional_only';
    else if (scoreVal >= 700) locStatus = 'established';
    else if (scoreVal >= 300) locStatus = 'probable';
    else locStatus = 'disputed';

    const voteCount = scoreObj.vote_count ?? null;
    const confLabel = locStatus === 'established'
      ? `Established scholarly identification (OpenBible score ${scoreVal}${voteCount ? `, ${voteCount} sources` : ''})`
      : locStatus === 'probable'
      ? `Probable identification (${ topAssocs.length > 1 ? `${topAssocs.length} proposals; ` : '' }OpenBible score ${scoreVal})`
      : locStatus === 'disputed'
      ? `Disputed / alternative proposal #${idx + 1} of ${assocs.length} (OpenBible score ${scoreVal})`
      : `Approximate regional identification`;

    // Collect cited sources from idObj.votes
    const citedSources = [];
    const voteTotals = idObj?.votes?.totals || {};
    for (const sid of Object.keys(voteTotals).slice(0, 5)) {
      const sRec = obSourceById.get(sid);
      if (sRec) {
        citedSources.push({
          id: sRec.id,
          display_name: sRec.display_name,
          year: sRec.year ?? null,
          url: sRec.worldcat_url || sRec.google_books_url || null,
        });
      }
    }
    if (pleiadesId) {
      citedSources.push({
        id: `pleiades:${pleiadesId}`,
        display_name: `Pleiades Ancient Places #${pleiadesId}`,
        year: null,
        url: `https://pleiades.stoa.org/places/${pleiadesId}`,
      });
    }

    const cleanDesc = String(idObj.description || assoc.name || anc.friendly_id).replace(/<[^>]+>/g, '');
    locations.push({
      location_key: `${placeKey}:${assoc.modern_id || idx}`,
      place_key: placeKey,
      rank_order: idx + 1,
      modern_name: assoc.name || mod?.friendly_id || anc.friendly_id,
      latitude: lat,
      longitude: lon,
      geometry: polyGeom,
      bbox,
      precision_kind: isRegionType && placeType !== 'settlement' ? 'approximate_region' : (polyGeom ? 'site_area' : (lon !== null ? 'point' : 'none')),
      location_status: locStatus,
      confidence_label: confLabel,
      raw_source_score: {
        openbible_score: scoreVal,
        vote_total: scoreObj.vote_total ?? null,
        vote_count: voteCount,
        vote_average: scoreObj.vote_average ?? null,
        modern_precision: mod?.precision ?? null,
        theographic_precision: theo?.fields?.precision ?? null,
      },
      is_alternative: idx > 0,
      evidence_summary: `Identified as ${cleanDesc} (${mod?.type || placeType}). ${
        assocs.length > 1
          ? `Ranked #${idx + 1} among ${assocs.length} scholarly proposals (${assocs.slice(0, 5).map(a => `${a.name}: ${a.score}`).join(', ')}).`
          : `Supported by OpenBible geocoding synthesis (score ${scoreVal}).`
      }`,
      source_citations: citedSources,
      source_key: 'openbible_modern',
    });
  }
}

// Add explicit symbolic / non-physical places for apocalyptic/heavenly visions (e.g. New Jerusalem in Rev 21:2)
for (const sym of [
  {
    place_key: 'symbolic:new-jerusalem',
    biblical_name: 'New Jerusalem (Heavenly Vision)',
    historical_names: ['New Jerusalem', 'Holy City'],
    hebrew_name: null,
    greek_name: 'Ἰερουσαλὴμ καινή',
    strongs_numbers: ['G2419', 'G2537'],
    place_type: 'heavenly',
    is_non_physical: true,
    external_ids: { note: 'Apocalyptic heavenly city in Revelation 3:12; 21:2, 10; distinct from earthly Jerusalem.' },
    primary_source_key: 'curated_narrative_geography',
    source_info: { reason: 'Heavenly/eschatological vision; no terrestrial GPS coordinates.' },
  },
  {
    place_key: 'symbolic:heavenly-throne',
    biblical_name: 'Heavenly Throne Room (Vision)',
    historical_names: ['Heaven'],
    hebrew_name: 'שָׁמַיִם',
    greek_name: 'οὐρανός',
    strongs_numbers: ['H8064', 'G3772'],
    place_type: 'heavenly',
    is_non_physical: true,
    external_ids: { note: 'Heavenly vision setting in Revelation 4-5.' },
    primary_source_key: 'curated_narrative_geography',
    source_info: { reason: 'Non-physical heavenly realm.' },
  },
]) {
  places.push(sym);
}

// 3. Build Passage Geography (Curated + Verified Single-Book Event Settings from Theographic)
const passages = [...curatedPassages.map(p => ({ ...p, source_key: 'curated_narrative_geography', event_key: null }))];
const coveredPassageKeys = new Set(passages.map(p => p.passage_key));

for (const ev of theoEvents) {
  const locIds = ev.fields.locations || [];
  const verseRecIds = ev.fields.verses || [];
  if (!locIds.length || !verseRecIds.length) continue;
  const placeKey = theoIdToPlaceKey.get(locIds[0]);
  if (!placeKey) continue;

  const parsedRefs = verseRecIds
    .map(vid => theoVerses.find(v => v.id === vid))
    .filter(Boolean)
    .map(v => ({ osis: v.fields.osisRef, parsed: parseOsis(v.fields.osisRef) }))
    .filter(x => x.parsed && x.parsed.book <= 44); // Historical narrative books Genesis..Acts

  if (parsedRefs.length < 2) continue;
  const books = new Set(parsedRefs.map(r => r.parsed.book));
  if (books.size !== 1) continue; // Only contiguous single-book narrative spans
  parsedRefs.sort((a, b) => (a.parsed.chapter - b.parsed.chapter) || (a.parsed.verse - b.parsed.verse));
  const first = parsedRefs[0].parsed;
  const last = parsedRefs[parsedRefs.length - 1].parsed;
  // Avoid overly broad multi-chapter spans (> 2 chapters) from overriding local narrative transitions
  if (last.chapter - first.chapter > 2) continue;

  const pKey = `event:${ev.id}:${first.book}-${first.chapter}-${first.verse}`;
  if (coveredPassageKeys.has(pKey)) continue;
  coveredPassageKeys.add(pKey);

  passages.push({
    passage_key: pKey,
    title: ev.fields.title,
    book: first.book,
    start_chapter: first.chapter,
    start_verse: first.verse,
    end_chapter: last.chapter,
    end_verse: last.verse,
    place_key: placeKey,
    relationship_type: 'contextual_location',
    resolution_tier: 3,
    confidence_level: 'probable',
    evidence_refs: `${parsedRefs[0].osis}–${parsedRefs[parsedRefs.length - 1].osis}`,
    evidence_explanation: `Theographic event "${ev.fields.title}" (${parsedRefs[0].osis}–${parsedRefs[parsedRefs.length - 1].osis}) associates this narrative episode with ${places.find(p => p.place_key === placeKey)?.biblical_name || placeKey}.`,
    source_key: 'theographic_places',
    event_key: `theographic:event:${ev.id}:${THEOGRAPHIC_COMMIT}`,
  });
}

// 4. Build Verse Geography from OpenBible ancient.jsonl verses[] + milestone narrative overrides
// First index which places are active event locations in Theographic events per verse address
const eventPlacesByAddress = new Map();
for (const ev of theoEvents) {
  const locKeys = (ev.fields.locations || []).map(id => theoIdToPlaceKey.get(id)).filter(Boolean);
  if (!locKeys.length) continue;
  for (const vid of (ev.fields.verses || [])) {
    const v = theoVerses.find(x => x.id === vid);
    const p = v ? parseOsis(v.fields.osisRef) : null;
    if (!p) continue;
    if (!eventPlacesByAddress.has(p.key)) eventPlacesByAddress.set(p.key, { placeKeys: new Set(), titles: [] });
    const entry = eventPlacesByAddress.get(p.key);
    locKeys.forEach(k => entry.placeKeys.add(k));
    if (!entry.titles.includes(ev.fields.title)) entry.titles.push(ev.fields.title);
  }
}

const verseLinks = [];
const seenVersePlace = new Set();
const primaryLocStatusByPlace = new Map();
for (const loc of locations) {
  if (loc.rank_order === 1) primaryLocStatusByPlace.set(loc.place_key, loc.location_status);
}

for (const anc of ancient) {
  const placeKey = `openbible:${anc.id}`;
  const locStatus = primaryLocStatusByPlace.get(placeKey) || 'probable';
  const confLevel = locStatus === 'established' ? 'established'
    : locStatus === 'probable' ? 'probable'
    : locStatus === 'disputed' ? 'disputed'
    : locStatus === 'regional_only' ? 'regional'
    : 'unknown';

  for (const vObj of (anc.verses || [])) {
    const p = parseOsis(vObj.osis);
    if (!p || !validStepAddresses.has(p.key)) continue;

    // Symbolic guard: Revelation 21:2 and 21:10 and 3:12 mention New Jerusalem, never physical Jerusalem
    if (p.book === 66 && ((p.chapter === 21 && (p.verse === 2 || p.verse === 10)) || (p.chapter === 3 && p.verse === 12)) && anc.id === 'a15257a') {
      continue;
    }

    const inst = vObj.instance_types || {};
    const hasPeopleGroup = Boolean(inst.people_group);
    const evInfo = eventPlacesByAddress.get(p.key);
    const isEventSetting = Boolean(evInfo?.placeKeys.has(placeKey)) && !hasPeopleGroup;

    // Curated passage setting match for this verse
    const activeCuratedForVerse = curatedPassages.filter(cp =>
      cp.book === p.book &&
      (cp.start_chapter < p.chapter || (cp.start_chapter === p.chapter && cp.start_verse <= p.verse)) &&
      (cp.end_chapter > p.chapter || (cp.end_chapter === p.chapter && cp.end_verse >= p.verse))
    );
    const matchingPassage = activeCuratedForVerse.find(cp => cp.place_key === placeKey)
      || (anc.id === 'a815d89' ? activeCuratedForVerse.find(cp => cp.passage_key === 'acts-17-16-34-athens-areopagus') : null);
    const hasOtherActivePassage = activeCuratedForVerse.length > 0 && !matchingPassage;

    let relType = 'mentioned_location';
    let tier = 1;
    if (locStatus === 'unknown') {
      relType = 'uncertain_location';
    } else if (hasPeopleGroup || hasOtherActivePassage) {
      relType = 'mentioned_location';
    } else if (isEventSetting || matchingPassage || (p.book <= 44 && ['hill', 'spring', 'well', 'mountain'].includes(anc.types?.[0]) && p.book !== 19)) {
      relType = 'event_location';
    } else if (p.book <= 17 || (p.book >= 40 && p.book <= 44)) {
      relType = evInfo ? 'mentioned_location' : 'event_location';
    }

    const dedupKey = `${p.key}|${placeKey}|${relType}`;
    if (seenVersePlace.has(dedupKey)) continue;
    seenVersePlace.add(dedupKey);

    verseLinks.push({
      address: p.key,
      book: p.book,
      chapter: p.chapter,
      verse: p.verse,
      place_key: placeKey,
      relationship_type: relType,
      resolution_tier: tier,
      is_inferred: false,
      confidence_level: confLevel,
      evidence_ref: vObj.readable || vObj.osis,
      evidence_explanation: relType === 'event_location'
        ? `${vObj.readable || vObj.osis} explicitly names ${anc.friendly_id} as part of the narrative setting${evInfo?.titles?.length ? ` (${evInfo.titles[0]})` : ''}.`
        : hasPeopleGroup
        ? `${vObj.readable || vObj.osis} references an inhabitant/demonym of ${anc.friendly_id} rather than establishing ${anc.friendly_id} as the physical scene coordinate.`
        : `${vObj.readable || vObj.osis} explicitly mentions ${anc.friendly_id} in the text.`,
      passage_key: matchingPassage?.passage_key ?? null,
      source_key: 'openbible_ancient',
    });
  }
}

// Add explicit travel_origin / travel_destination annotations for key travel verses (John 4:3-4, Acts 17:15, Acts 18:1, Gen 28:10, Num 33:8)
const explicitTravelLinks = [
  {
    book: 43, chapter: 4, verse: 3, place_key: 'openbible:a149f13', // Judea 1
    relationship_type: 'travel_origin', confidence_level: 'established',
    evidence_ref: 'John 4:3', evidence_explanation: 'Jesus leaves Judea (travel origin) and departs again for Galilee.',
  },
  {
    book: 43, chapter: 4, verse: 3, place_key: 'openbible:a9cf1e8', // Galilee 1
    relationship_type: 'travel_destination', confidence_level: 'established',
    evidence_ref: 'John 4:3', evidence_explanation: 'Galilee is the destination of Jesus\' journey from Judea through Samaria.',
  },
  {
    book: 44, chapter: 18, verse: 1, place_key: 'openbible:a1fe6e7', // Athens
    relationship_type: 'travel_origin', confidence_level: 'established',
    evidence_ref: 'Acts 18:1', evidence_explanation: 'Paul departs from Athens (travel origin) and goes to Corinth.',
  },
  {
    book: 44, chapter: 18, verse: 1, place_key: 'openbible:a6f437a', // Corinth
    relationship_type: 'travel_destination', confidence_level: 'established',
    evidence_ref: 'Acts 18:1', evidence_explanation: 'Paul arrives in Corinth (travel destination) after leaving Athens.',
  },
  {
    book: 1, chapter: 28, verse: 10, place_key: 'openbible:ad2f6c2', // Beersheba 1
    relationship_type: 'travel_origin', confidence_level: 'established',
    evidence_ref: 'Genesis 28:10', evidence_explanation: 'Jacob sets out from Beersheba (travel origin) toward Haran.',
  },
  {
    book: 1, chapter: 28, verse: 10, place_key: 'openbible:a6d9af3', // Haran
    relationship_type: 'travel_destination', confidence_level: 'established',
    evidence_ref: 'Genesis 28:10', evidence_explanation: 'Jacob travels toward Haran (travel destination).',
  },
];

for (const tl of explicitTravelLinks) {
  if (!places.some(p => p.place_key === tl.place_key)) continue;
  const key = `${tl.book}-${tl.chapter}-${tl.verse}|${tl.place_key}|${tl.relationship_type}`;
  if (seenVersePlace.has(key)) continue;
  seenVersePlace.add(key);
  verseLinks.push({
    address: `${tl.book}-${tl.chapter}-${tl.verse}`,
    book: tl.book,
    chapter: tl.chapter,
    verse: tl.verse,
    place_key: tl.place_key,
    relationship_type: tl.relationship_type,
    resolution_tier: 1,
    is_inferred: false,
    confidence_level: tl.confidence_level,
    evidence_ref: tl.evidence_ref,
    evidence_explanation: tl.evidence_explanation,
    passage_key: null,
    source_key: 'curated_narrative_geography',
  });
}

await fs.writeFile(`${root}/staged-sources.json`, JSON.stringify(geoSources, null, 2));
await fs.writeFile(`${root}/staged-places.json`, JSON.stringify(places, null, 2));
await fs.writeFile(`${root}/staged-locations.json`, JSON.stringify(locations, null, 2));
await fs.writeFile(`${root}/staged-passages.json`, JSON.stringify(passages, null, 2));
await fs.writeFile(`${root}/staged-verse-links.json`, JSON.stringify(verseLinks, null, 2));

// Emit idempotent SQL chunks for database import
const q = v => v === null || v === undefined ? 'null' : `'${String(v).replaceAll("'", "''")}'`;
const qArr = arr => !arr || !arr.length ? `'{}'::text[]` : `ARRAY[${arr.map(q).join(',')}]::text[]`;
const qFloatArr = arr => !arr || !arr.length ? 'null' : `ARRAY[${arr.map(x => Number(x)).join(',')}]::double precision[]`;
const qJson = obj => obj === null || obj === undefined ? 'null' : `${q(JSON.stringify(obj))}::jsonb`;

const srcSql = `insert into public.geography_sources(source_key,dataset,version,locator,sha256,license,attribution,raw_metadata) values\n` +
  geoSources.map(s => `(${q(s.source_key)},${q(s.dataset)},${q(s.version)},${q(s.locator)},${q(s.sha256)},${q(s.license)},${q(s.attribution)},${qJson(s.raw_metadata)})`).join(',\n') +
  `\non conflict(source_key) do nothing;\n`;

const placeRows = places.map(p =>
  `(${q(p.place_key)},${q(p.biblical_name)},${qArr(p.historical_names)},${q(p.hebrew_name)},${q(p.greek_name)},${qArr(p.strongs_numbers)},${q(p.place_type)},${p.is_non_physical ? 'true' : 'false'},${qJson(p.external_ids)},${q(p.primary_source_key)},${qJson(p.source_info)})`
);
const placesSql = `insert into public.places(place_key,biblical_name,historical_names,hebrew_name,greek_name,strongs_numbers,place_type,is_non_physical,external_ids,primary_source_id,source_info)\n` +
  `select v.place_key,v.biblical_name,v.historical_names,v.hebrew_name,v.greek_name,v.strongs_numbers,v.place_type,v.is_non_physical,v.external_ids,s.id,v.source_info\n` +
  `from (values\n${placeRows.join(',\n')}\n) as v(place_key,biblical_name,historical_names,hebrew_name,greek_name,strongs_numbers,place_type,is_non_physical,external_ids,primary_source_key,source_info)\n` +
  `join public.geography_sources s on s.source_key = v.primary_source_key\n` +
  `on conflict(place_key) do nothing;\n`;

const passageRows = passages.map(p =>
  `(${q(p.passage_key)},${q(p.title)},${p.book},${p.start_chapter},${p.start_verse},${p.end_chapter},${p.end_verse},${q(p.place_key)},${q(p.relationship_type)},${p.resolution_tier},${q(p.confidence_level)},${q(p.evidence_refs)},${q(p.evidence_explanation)},${q(p.event_key)},${q(p.source_key)})`
);
const passagesSql = `insert into public.passage_geography(passage_key,title,book,start_chapter,start_verse,end_chapter,end_verse,place_id,relationship_type,resolution_tier,confidence_level,evidence_refs,evidence_explanation,chronology_event_id,source_id)\n` +
  `select v.passage_key,v.title,v.book::smallint,v.start_chapter::smallint,v.start_verse::smallint,v.end_chapter::smallint,v.end_verse::smallint,pl.id,v.relationship_type,v.resolution_tier::smallint,v.confidence_level,v.evidence_refs,v.evidence_explanation,ce.id,s.id\n` +
  `from (values\n${passageRows.join(',\n')}\n) as v(passage_key,title,book,start_chapter,start_verse,end_chapter,end_verse,place_key,relationship_type,resolution_tier,confidence_level,evidence_refs,evidence_explanation,event_key,source_key)\n` +
  `left join public.places pl on pl.place_key = v.place_key\n` +
  `left join public.chronology_events ce on ce.event_key = v.event_key\n` +
  `join public.geography_sources s on s.source_key = v.source_key\n` +
  `on conflict(passage_key) do nothing;\n`;

await fs.writeFile(`${root}/sql-01-core.sql`, srcSql + '\n' + placesSql + '\n' + passagesSql);

const locChunkSize = 1000;
let locFileIdx = 1;
for (let i = 0; i < locations.length; i += locChunkSize) {
  const slice = locations.slice(i, i + locChunkSize);
  const rows = slice.map(l =>
    `(${q(l.location_key)},${q(l.place_key)},${l.rank_order},${q(l.modern_name)},${l.latitude === null ? 'null::double precision' : l.latitude},${l.longitude === null ? 'null::double precision' : l.longitude},${qJson(l.geometry)},${qFloatArr(l.bbox)},${q(l.precision_kind)},${q(l.location_status)},${q(l.confidence_label)},${qJson(l.raw_source_score)},${l.is_alternative ? 'true' : 'false'},${q(l.evidence_summary)},${qJson(l.source_citations)},${q(l.source_key)})`
  );
  const sql = `insert into public.place_locations(location_key,place_id,rank_order,modern_name,latitude,longitude,geometry,bbox,precision_kind,location_status,confidence_label,raw_source_score,is_alternative,evidence_summary,source_citations,source_id)\n` +
    `select v.location_key,pl.id,v.rank_order::smallint,v.modern_name,v.latitude,v.longitude,v.geometry,v.bbox,v.precision_kind,v.location_status,v.confidence_label,v.raw_source_score,v.is_alternative,v.evidence_summary,v.source_citations,s.id\n` +
    `from (values\n${rows.join(',\n')}\n) as v(location_key,place_key,rank_order,modern_name,latitude,longitude,geometry,bbox,precision_kind,location_status,confidence_label,raw_source_score,is_alternative,evidence_summary,source_citations,source_key)\n` +
    `join public.places pl on pl.place_key = v.place_key\n` +
    `join public.geography_sources s on s.source_key = v.source_key\n` +
    `on conflict(location_key) do nothing;\n`;
  await fs.writeFile(`${root}/sql-02-locs-${locFileIdx++}.sql`, sql);
}

const vLinkChunkSize = 2200;
let vLinkFileIdx = 1;
for (let i = 0; i < verseLinks.length; i += vLinkChunkSize) {
  const slice = verseLinks.slice(i, i + vLinkChunkSize);
  const rows = slice.map(vl =>
    `(${vl.book},${vl.chapter},${vl.verse},${q(vl.place_key)},${q(vl.relationship_type)},${vl.resolution_tier},${vl.is_inferred ? 'true' : 'false'},${q(vl.confidence_level)},${q(vl.evidence_ref)},${q(vl.evidence_explanation)},${q(vl.passage_key)},${q(vl.source_key)})`
  );
  const sql = `insert into public.verse_geography(verse_id,place_id,relationship_type,resolution_tier,is_inferred,confidence_level,evidence_ref,evidence_explanation,establishing_passage_id,source_id)\n` +
    `select vr.id,pl.id,v.relationship_type,v.resolution_tier::smallint,v.is_inferred,v.confidence_level,v.evidence_ref,v.evidence_explanation,pg.id,s.id\n` +
    `from (values\n${rows.join(',\n')}\n) as v(book,chapter,verse,place_key,relationship_type,resolution_tier,is_inferred,confidence_level,evidence_ref,evidence_explanation,passage_key,source_key)\n` +
    `join public.verses vr on vr.book = v.book::smallint and vr.chapter = v.chapter::smallint and vr.verse_nr = v.verse::smallint\n` +
    `join public.places pl on pl.place_key = v.place_key\n` +
    `left join public.passage_geography pg on pg.passage_key = v.passage_key\n` +
    `join public.geography_sources s on s.source_key = v.source_key\n` +
    `on conflict(verse_id,place_id,relationship_type) do nothing;\n`;
  await fs.writeFile(`${root}/sql-03-vlinks-${vLinkFileIdx++}.sql`, sql);
}

const tipnrUpdates = places
  .filter(p => p.hebrew_name || p.greek_name || (p.strongs_numbers && p.strongs_numbers.length))
  .map(p => `(${q(p.place_key)},${q(p.hebrew_name)},${q(p.greek_name)},${qArr(p.strongs_numbers)})`);
const upSql = `update public.places as p\nset hebrew_name = v.hebrew_name, greek_name = v.greek_name, strongs_numbers = v.strongs_numbers\nfrom (values\n${tipnrUpdates.join(',\n')}\n) as v(place_key,hebrew_name,greek_name,strongs_numbers)\nwhere p.place_key = v.place_key;\n`;

const travelRows = explicitTravelLinks.map(vl =>
  `(${vl.book},${vl.chapter},${vl.verse},${q(vl.place_key)},${q(vl.relationship_type)},1,false,${q(vl.confidence_level)},${q(vl.evidence_ref)},${q(vl.evidence_explanation)},null,'curated_narrative_geography')`
);
const travelSql = `insert into public.verse_geography(verse_id,place_id,relationship_type,resolution_tier,is_inferred,confidence_level,evidence_ref,evidence_explanation,establishing_passage_id,source_id)\n` +
  `select vr.id,pl.id,v.relationship_type,v.resolution_tier::smallint,v.is_inferred,v.confidence_level,v.evidence_ref,v.evidence_explanation,null::bigint,s.id\n` +
  `from (values\n${travelRows.join(',\n')}\n) as v(book,chapter,verse,place_key,relationship_type,resolution_tier,is_inferred,confidence_level,evidence_ref,evidence_explanation,passage_key,source_key)\n` +
  `join public.verses vr on vr.book = v.book::smallint and vr.chapter = v.chapter::smallint and vr.verse_nr = v.verse::smallint\n` +
  `join public.places pl on pl.place_key = v.place_key\n` +
  `join public.geography_sources s on s.source_key = v.source_key\n` +
  `on conflict(verse_id,place_id,relationship_type) do nothing;\n`;

const enrichSql = `${upSql}\n${passagesSql}\n${travelSql}`;
await fs.writeFile(`${root}/sql-04-enrichment.sql`, enrichSql);

const chunkFiles = [
  'sql-01-core.sql',
  'sql-02-locs-1.sql', 'sql-02-locs-2.sql', 'sql-02-locs-3.sql', 'sql-02-locs-4.sql',
  'sql-03-vlinks-1.sql', 'sql-03-vlinks-2.sql', 'sql-03-vlinks-3.sql', 'sql-03-vlinks-4.sql',
  'sql-04-enrichment.sql',
];
const combinedSql = [];
for (const cf of chunkFiles) {
  combinedSql.push(`-- === ${cf} ===\n` + await fs.readFile(`${root}/${cf}`, 'utf8'));
}
await fs.writeFile('scripts/import-geography.sql', combinedSql.join('\n\n'));

console.log(`Staged geography ETL: ${geoSources.length} sources, ${places.length} places, ${locations.length} place_locations, ${passages.length} passage_geography intervals, ${verseLinks.length} verse_geography links.`);
