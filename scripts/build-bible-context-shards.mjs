#!/usr/bin/env node
// @file: scripts/build-bible-context-shards.mjs
// @description: Downloads public-license biblical person & place datasets and builds
//               compact static JSON shards under public/data/ plus PROVENANCE.md.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT_DIR, 'public', 'data');

const URLS = {
  personCsv: 'https://raw.githubusercontent.com/BradyStephenson/bible-data/main/BibleData-Person.csv',
  personLabelCsv: 'https://raw.githubusercontent.com/BradyStephenson/bible-data/main/BibleData-PersonLabel.csv',
  personRelCsv: 'https://raw.githubusercontent.com/BradyStephenson/bible-data/main/BibleData-PersonRelationship.csv',
  personVerseCsv: 'https://raw.githubusercontent.com/BradyStephenson/bible-data/main/BibleData-PersonVerse.csv',
  placeCsv: 'https://raw.githubusercontent.com/BradyStephenson/bible-data/main/BibleData-Place.csv',
  placeLabelCsv: 'https://raw.githubusercontent.com/BradyStephenson/bible-data/main/BibleData-PlaceLabel.csv',
  theographicPlaces: 'https://raw.githubusercontent.com/robertrouse/theographic-bible-metadata/master/json/places.json',
  theographicPeople: 'https://raw.githubusercontent.com/robertrouse/theographic-bible-metadata/master/json/people.json',
};

/** RFC-4180 compliant CSV parser handling embedded commas, newlines in quotes, and doubled quotes `""`. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows.shift().map(h => h.trim());
  return rows.map(r => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = r[i] ?? '';
    }
    return obj;
  });
}

const BOOK_META = {
  GEN: [1, 'Gen'], EXO: [2, 'Exod'], LEV: [3, 'Lev'], NUM: [4, 'Num'], DEU: [5, 'Deut'],
  JOS: [6, 'Josh'], JDG: [7, 'Judg'], RUT: [8, 'Ruth'], '1SA': [9, '1 Sam'], '2SA': [10, '2 Sam'],
  '1KI': [11, '1 Kgs'], '2KI': [12, '2 Kgs'], '1CH': [13, '1 Chr'], '2CH': [14, '2 Chr'],
  EZR: [15, 'Ezra'], NEH: [16, 'Neh'], EST: [17, 'Esth'], JOB: [18, 'Job'], PSA: [19, 'Ps'],
  PRO: [20, 'Prov'], ECC: [21, 'Eccl'], SNG: [22, 'Song'], SOS: [22, 'Song'], ISA: [23, 'Isa'], IS: [23, 'Isa'],
  JER: [24, 'Jer'], LAM: [25, 'Lam'], EZK: [26, 'Ezek'], DAN: [27, 'Dan'], HOS: [28, 'Hos'],
  JOL: [29, 'Joel'], AMO: [30, 'Amos'], OBA: [31, 'Obad'], JON: [32, 'Jonah'], MIC: [33, 'Mic'],
  NAM: [34, 'Nah'], HAB: [35, 'Hab'], ZEP: [36, 'Zeph'], HAG: [37, 'Hag'], ZEC: [38, 'Zech'],
  MAL: [39, 'Mal'], MAT: [40, 'Matt'], MRK: [41, 'Mark'], LUK: [42, 'Luke'], JHN: [43, 'John'],
  ACT: [44, 'Acts'], ROM: [45, 'Rom'], '1CO': [46, '1 Cor'], '2CO': [47, '2 Cor'], GAL: [48, 'Gal'],
  EPH: [49, 'Eph'], PHP: [50, 'Phil'], COL: [51, 'Col'], '1TH': [52, '1 Thess'], '2TH': [53, '2 Thess'],
  '1TI': [54, '1 Tim'], '2TI': [55, '2 Tim'], TIT: [56, 'Titus'], PHM: [57, 'Phlm'], HEB: [58, 'Heb'],
  JAS: [59, 'Jas'], '1PE': [60, '1 Pet'], '2PE': [61, '2 Pet'], '1JN': [62, '1 John'],
  '2JN': [63, '2 John'], '3JN': [64, '3 John'], JUD: [65, 'Jude'], REV: [66, 'Rev'],
  PSALM: [19, 'Ps'],
};

function parseBibleRef(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/^["'\s]+|["'\s]+$/g, '');
  const m = /^([0-9]?[A-Za-z]+)\s+(\d+):(\d+)/.exec(cleaned);
  if (!m) return null;
  const code = m[1].toUpperCase();
  const meta = BOOK_META[code];
  if (!meta) return null;
  const chapter = Number(m[2]);
  const verse = Number(m[3]) || 1;
  if (!Number.isFinite(chapter) || chapter <= 0) return null;
  return {
    label: `${meta[1]} ${chapter}:${verse}`,
    passage: { book: meta[0], chapter, verse },
  };
}

function extractRefsFromText(text) {
  if (!text) return [];
  const results = [];
  const seen = new Set();
  const re = /\b([0-9]?[A-Z]{2,5})\s+(\d+):(\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const parsed = parseBibleRef(`${m[1]} ${m[2]}:${m[3]}`);
    if (parsed) {
      const key = `${parsed.passage.book}:${parsed.passage.chapter}:${parsed.passage.verse}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(parsed);
      }
    }
  }
  return results;
}

function parseStrongsList(...fields) {
  const out = [];
  const seen = new Set();
  for (const raw of fields) {
    if (!raw) continue;
    const tokens = String(raw).split(/[\s,;]+/).map(t => t.trim()).filter(Boolean);
    for (const tok of tokens) {
      const m = /^([HG])0*(\d+)$/i.exec(tok);
      if (!m) continue;
      const norm = `${m[1].toUpperCase()}${Number(m[2])}`;
      if (!seen.has(norm)) {
        seen.add(norm);
        out.push(norm);
      }
    }
  }
  return out;
}

function normalizeNameKey(name) {
  return String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function deriveEra(firstRef, theoPerson) {
  if (
    theoPerson &&
    Number.isFinite(theoPerson.birthYear) &&
    Number.isFinite(theoPerson.deathYear) &&
    Math.abs(theoPerson.deathYear - theoPerson.birthYear) <= 250
  ) {
    const fmt = (y) => (y < 0 ? `${Math.abs(y)} BCE` : `${y} CE`);
    if (theoPerson.birthYear !== theoPerson.deathYear) {
      return `c. ${fmt(theoPerson.birthYear)}–${fmt(theoPerson.deathYear)}`;
    }
    return `c. ${fmt(theoPerson.birthYear)}`;
  }
  const book = firstRef?.passage.book;
  const chap = firstRef?.passage.chapter ?? 1;
  const verse = firstRef?.passage.verse ?? 1;
  if (!book) return 'Biblical';
  if (book === 1 && (chap <= 10 || (chap === 11 && verse <= 25))) return 'Primeval / Nations';
  if (book === 1 || book === 18) return 'Patriarchal';
  if (book >= 2 && book <= 6) return 'Exodus & Conquest';
  if (book === 7 || book === 8) return 'Judges';
  if (book >= 9 && book <= 14) return 'Monarchy';
  if (book === 15 || book === 16 || book === 17 || book === 37 || book === 38 || book === 39) return 'Exile & Post-Exilic';
  if (book >= 19 && book <= 39) return 'Monarchy & Prophets';
  if (book >= 40 && book <= 43) return 'Gospels';
  return 'Apostolic';
}

function deriveLineageGroup(person, keyRefs) {
  const ref = keyRefs[0]?.passage;
  const tribe = (person.tribe || '').toLowerCase();
  if (ref) {
    const { book, chapter } = ref;
    if (book >= 40) return 'gospels_apostles';
    if (book === 1 && (chapter <= 10 || (chapter === 11 && ref.verse <= 25))) return 'creation_nations';
    if (book === 1 || book === 18) return 'patriarchs';
    if (book >= 2 && book <= 6) return 'exodus_priests';
    if (book === 8) return 'davidic';
  }
  if (tribe === 'levi') return 'exodus_priests';
  if (tribe === 'judah' && /king|david|solomon|lineage of the messiah/i.test(person.unique_attribute || '')) {
    return 'davidic';
  }
  return 'kings_prophets';
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

async function main() {
  console.log('Downloading upstream datasets...');
  const [
    personCsvText,
    personLabelCsvText,
    personRelCsvText,
    personVerseCsvText,
    placeCsvText,
    placeLabelCsvText,
    theoPlacesRaw,
    theoPeopleRaw,
  ] = await Promise.all([
    fetchText(URLS.personCsv),
    fetchText(URLS.personLabelCsv),
    fetchText(URLS.personRelCsv),
    fetchText(URLS.personVerseCsv),
    fetchText(URLS.placeCsv),
    fetchText(URLS.placeLabelCsv),
    fetchJson(URLS.theographicPlaces),
    fetchJson(URLS.theographicPeople),
  ]);

  const rawPersons = parseCsv(personCsvText);
  const rawPersonLabels = parseCsv(personLabelCsvText);
  const rawPersonRels = parseCsv(personRelCsvText);
  const rawPersonVerses = parseCsv(personVerseCsvText);
  const rawPlaces = parseCsv(placeCsvText);
  const rawPlaceLabels = parseCsv(placeLabelCsvText);

  // Index labels by person_id
  const labelsByPerson = new Map();
  for (const lbl of rawPersonLabels) {
    const pid = lbl.person_id;
    if (!pid || pid === 'YHVH_1') continue;
    let list = labelsByPerson.get(pid);
    if (!list) {
      list = [];
      labelsByPerson.set(pid, list);
    }
    list.push(lbl);
  }

  // Index unambiguous theographic people by lowercased name
  const theoByName = new Map();
  for (const tp of theoPeopleRaw) {
    const f = tp.fields || {};
    const key = normalizeNameKey(f.name || f.displayTitle);
    if (!key) continue;
    let arr = theoByName.get(key);
    if (!arr) {
      arr = [];
      theoByName.set(key, arr);
    }
    arr.push(f);
  }

  // Count human base names for homonymGroup
  const humanRows = rawPersons.filter(p => p.person_id && p.person_id !== 'YHVH_1');
  const nameCounts = new Map();
  for (const p of humanRows) {
    const key = (p.person_name || '').trim().toLowerCase();
    if (!key) continue;
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }

  const humanIdSet = new Set(humanRows.map(p => p.person_id));
  const sexById = new Map(humanRows.map(p => [p.person_id, (p.sex || '').toLowerCase()]));

  // Build people array
  const people = [];
  for (const p of humanRows) {
    const id = p.person_id;
    const labels = labelsByPerson.get(id) || [];
    const primaryLabel = labels.find(l => l.label_type === 'proper name') || labels[0];

    const name = (p.person_name || primaryLabel?.english_label || id).trim();
    const disambiguator = (p.unique_attribute || '').trim() || undefined;
    const hebrew = labels.map(l => l.hebrew_label?.trim()).find(Boolean) || undefined;
    const greek = labels.map(l => l.greek_label?.trim()).find(Boolean) || undefined;
    const transliteration =
      labels.map(l => l.hebrew_label_transliterated?.trim() || l.greek_label_transliterated?.trim()).find(Boolean) ||
      undefined;

    const properLabels = labels.filter(l => l.label_type === 'proper name');
    const strongsSource = properLabels.length > 0 ? properLabels : labels;
    const strongs = parseStrongsList(
      ...strongsSource.flatMap(l => [l.hebrew_strongs_number, l.greek_strongs_number]),
    );
    if (id === 'Jacob_1') {
      for (const extra of ['H3290', 'G2384', 'H3478', 'G2474']) {
        if (!strongs.includes(extra)) strongs.push(extra);
      }
    }

    const keyRefs = [];
    const seenRefs = new Set();
    const pushRef = (r) => {
      if (!r) return;
      const k = `${r.passage.book}:${r.passage.chapter}:${r.passage.verse}`;
      if (seenRefs.has(k)) return;
      seenRefs.add(k);
      keyRefs.push(r);
    };
    for (const l of labels) pushRef(parseBibleRef(l.label_reference_id));
    for (const r of extractRefsFromText(p.unique_attribute)) pushRef(r);
    for (const r of extractRefsFromText(p.person_notes)) pushRef(r);

    const nameKey = normalizeNameKey(name);
    const theoMatches = theoByName.get(nameKey) || [];
    const theoPerson = theoMatches.length === 1 ? theoMatches[0] : undefined;

    const era = deriveEra(keyRefs[0], theoPerson);
    const lineageGroup = deriveLineageGroup(p, keyRefs);

    const summaryParts = [];
    if (p.unique_attribute) summaryParts.push(p.unique_attribute.trim());
    if (p.tribe) summaryParts.push(`Tribe: ${p.tribe.trim()}`);
    if (p.person_notes) summaryParts.push(p.person_notes.trim());
    const summary = summaryParts.join(' · ') || `${name} (biblical figure)`;

    const baseKey = name.toLowerCase();
    const homonymGroup = (nameCounts.get(baseKey) || 0) >= 2 ? baseKey : undefined;

    const entry = {
      id,
      name,
      era,
      lineageGroup,
      summary,
      keyRefs: keyRefs.slice(0, 6),
    };
    if (disambiguator) entry.disambiguator = disambiguator;
    if (hebrew) entry.hebrew = hebrew;
    if (greek) entry.greek = greek;
    if (transliteration) entry.transliteration = transliteration;
    if (strongs.length > 0) entry.strongs = strongs;
    if (p.sex) entry.sex = p.sex.trim().toLowerCase();
    if (p.tribe) entry.tribe = p.tribe.trim();
    if (homonymGroup) entry.homonymGroup = homonymGroup;

    people.push(entry);
  }

  // Build deduplicated relationships
  const edgeMap = new Map();
  let skippedNonHumanOrMissing = 0;
  let skippedUnmappedType = 0;

  const normalizeCat = (raw) => (raw === 'explicit' ? 'explicit' : 'inferred');

  const upsertEdge = (fromId, toId, type, symmetric, category, witnessRef, typeLabel, note) => {
    if (!fromId || !toId || fromId === toId) return;
    const a = symmetric && fromId > toId ? toId : fromId;
    const b = symmetric && fromId > toId ? fromId : toId;
    const key = `${a}|${b}|${type}`;
    const existing = edgeMap.get(key);
    if (existing) {
      // Prefer explicit over inferred, and prefer edges with witnessRef
      if (existing.category !== 'explicit' && category === 'explicit') {
        existing.category = 'explicit';
      }
      if (!existing.witnessRef && witnessRef) existing.witnessRef = witnessRef;
      if (!existing.typeLabel && typeLabel) existing.typeLabel = typeLabel;
      if (!existing.note && note) existing.note = note;
      return;
    }
    const edge = {
      id: `${a}_${b}_${type}`,
      fromId: a,
      toId: b,
      type,
      category,
      witnessRef: witnessRef || { label: 'Scripture', passage: { book: 1, chapter: 1, verse: 1 } },
    };
    if (typeLabel) edge.typeLabel = typeLabel;
    if (note) edge.note = note;
    edgeMap.set(key, edge);
  };

  for (const r of rawPersonRels) {
    const p1 = r.person_id_1;
    const p2 = r.person_id_2;
    if (!humanIdSet.has(p1) || !humanIdSet.has(p2)) {
      skippedNonHumanOrMissing++;
      continue;
    }
    const rawType = (r.relationship_type || '').trim().toLowerCase();
    const cat = normalizeCat((r.relationship_category || '').trim().toLowerCase());
    const witnessRef = parseBibleRef(r.reference_id);
    const rawNote = (r.relationship_notes || '').trim() || undefined;

    if (rawType === 'father') {
      upsertEdge(p1, p2, 'father', false, cat, witnessRef, undefined, rawNote);
    } else if (rawType === 'mother') {
      upsertEdge(p1, p2, 'mother', false, cat, witnessRef, undefined, rawNote);
    } else if (rawType === 'son' || rawType === 'daughter') {
      const parentSex = sexById.get(p2);
      const pType = parentSex === 'female' ? 'mother' : 'father';
      upsertEdge(p2, p1, pType, false, cat, witnessRef, undefined, rawNote);
    } else if (rawType === 'husband' || rawType === 'wife') {
      upsertEdge(p1, p2, 'spouse', true, cat, witnessRef, undefined, rawNote);
    } else if (rawType === 'concubinator' || rawType === 'concubine') {
      upsertEdge(p1, p2, 'spouse', true, cat, witnessRef, 'Concubine', rawNote || 'Concubine / secondary wife');
    } else if (rawType === 'brother' || rawType === 'sister') {
      upsertEdge(p1, p2, 'sibling', true, cat, witnessRef, undefined, rawNote);
    } else if (rawType === 'half-brother' || rawType === 'half-sister') {
      upsertEdge(p1, p2, 'sibling', true, cat, witnessRef, 'Half-sibling', rawNote || 'Half-sibling');
    } else if (
      rawType === 'master' || rawType === 'rabbi' || rawType === 'patron' ||
      rawType === 'king' || rawType === 'chief' || rawType === 'army commander' || rawType === 'army captain'
    ) {
      upsertEdge(p1, p2, 'mentor_disciple', false, cat, witnessRef, rawType, rawNote || `Role: ${rawType}`);
    } else if (
      rawType === 'servant' || rawType === 'disciple' || rawType === 'apostle' ||
      rawType === 'client' || rawType === 'lieutenant' || rawType === 'bearer'
    ) {
      upsertEdge(p2, p1, 'mentor_disciple', false, cat, witnessRef, rawType, rawNote || `Role: ${rawType}`);
    } else if (rawType === 'killer') {
      upsertEdge(p1, p2, 'adversary', false, cat, witnessRef, 'Slayer', rawNote || 'Slew');
    } else if (rawType === 'killed by') {
      upsertEdge(p2, p1, 'adversary', false, cat, witnessRef, 'Slayer', rawNote || 'Slew');
    } else if (rawType === 'ally' || rawType === 'cousin' || rawType === 'brother-in-law' || rawType === 'sister-in-law') {
      upsertEdge(p1, p2, 'covenant_friend', true, cat, witnessRef, rawType, rawNote || `Relation: ${rawType}`);
    } else if (rawType === 'original heir' || rawType === 'original inheritor') {
      const from = rawType === 'original heir' ? p2 : p1;
      const to = rawType === 'original heir' ? p1 : p2;
      upsertEdge(from, to, 'successor', false, cat, witnessRef, 'Heir', rawNote);
    } else {
      // Ancestor/descendant, grandfather/grandson, victim/raper, etc. are excluded from direct 1-hop graph edges
      // to keep 1-2 gen family trees faithful and uncluttered.
      skippedUnmappedType++;
    }
  }

  const relationships = [...edgeMap.values()];
  const explicitEdges = relationships.filter(e => e.category === 'explicit').length;
  const inferredEdges = relationships.length - explicitEdges;

  const peopleGraph = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: [
      'BradyStephenson/bible-data (CC BY 4.0)',
      'robertrouse/theographic-bible-metadata (CC BY-SA 4.0)',
    ],
    stats: {
      peopleCount: people.length,
      relationshipCount: relationships.length,
      explicitEdges,
      inferredEdges,
      skippedNonHumanOrMissing,
      skippedUnmappedType,
    },
    people,
    relationships,
  };

  // Build bible-places-index.json
  const placeMetaById = new Map(rawPlaces.map(p => [p.place_id, p]));
  const placeLabelsByOpenBible = new Map();
  const placeLabelsByName = new Map();

  for (const pl of rawPlaceLabels) {
    const obId = (pl.open_bible_id || '').trim();
    if (obId && obId !== 'none') {
      let arr = placeLabelsByOpenBible.get(obId);
      if (!arr) {
        arr = [];
        placeLabelsByOpenBible.set(obId, arr);
      }
      arr.push(pl);
    }
    const meta = placeMetaById.get(pl.place_id);
    const names = [pl.english_label, meta?.place_name].map(normalizeNameKey).filter(Boolean);
    for (const nk of names) {
      let arr = placeLabelsByName.get(nk);
      if (!arr) {
        arr = [];
        placeLabelsByName.set(nk, arr);
      }
      arr.push(pl);
    }
  }

  const places = [];
  let locatedCount = 0;
  let unlocatedCount = 0;
  let strongsMatchedCount = 0;

  for (const tp of theoPlacesRaw) {
    const f = tp.fields || {};
    const latNum = Number.parseFloat(f.latitude);
    const lonNum = Number.parseFloat(f.longitude);
    const hasCoords = Number.isFinite(latNum) && Number.isFinite(lonNum);
    if (hasCoords) locatedCount++;
    else unlocatedCount++;

    const obUri = f.openBibleUri || undefined;
    const obId = obUri ? obUri.split('/').pop() : undefined;

    let matchedLabels = obId ? placeLabelsByOpenBible.get(obId) : undefined;
    if (!matchedLabels || matchedLabels.length === 0) {
      matchedLabels = placeLabelsByName.get(normalizeNameKey(f.displayTitle || f.kjvName || f.esvName));
    }

    const strongs = matchedLabels
      ? parseStrongsList(...matchedLabels.flatMap(l => [l.hebrew_strongs_number, l.greek_strongs_number]))
      : [];
    if (strongs.length > 0) strongsMatchedCount++;

    const hebrew = matchedLabels?.map(l => l.hebrew_label?.trim()).find(Boolean);
    const greek = matchedLabels?.map(l => l.greek_label?.trim()).find(Boolean);

    const aliasSet = new Set();
    if (Array.isArray(f.aliases)) {
      for (const a of f.aliases) if (typeof a === 'string' && a.trim()) aliasSet.add(a.trim());
    } else if (typeof f.aliases === 'string' && f.aliases.trim()) {
      for (const a of f.aliases.split(',')) if (a.trim()) aliasSet.add(a.trim());
    }
    if (f.kjvName && f.kjvName !== f.displayTitle) aliasSet.add(f.kjvName);
    if (f.esvName && f.esvName !== f.displayTitle) aliasSet.add(f.esvName);

    const entry = {
      placeLookup: f.placeLookup || f.slug || tp.id,
      displayTitle: f.displayTitle || f.kjvName || f.esvName || f.placeLookup,
      aliases: [...aliasSet],
      featureType: f.featureType || null,
      precision: f.precision || null,
      latitude: hasCoords ? Number(latNum.toFixed(6)) : null,
      longitude: hasCoords ? Number(lonNum.toFixed(6)) : null,
      verseCount: typeof f.verseCount === 'number' ? f.verseCount : 0,
      openBibleUri: obUri || null,
      pleiadesUri: f.pleiadesUri || null,
    };
    if (strongs.length > 0) entry.strongs = strongs;
    if (hebrew) entry.hebrew = hebrew;
    if (greek) entry.greek = greek;

    places.push(entry);
  }

  // Ensure an explicit Israel land/region entry exists carrying H3478 & G2474
  const hasIsraelLandStrongs = places.some(
    pl => Array.isArray(pl.strongs) && (pl.strongs.includes('H3478') || pl.strongs.includes('G2474')),
  );
  if (!hasIsraelLandStrongs) {
    places.push({
      id: 'israel_land',
      name: 'Israel',
      placeLookup: 'israel_land',
      displayTitle: 'Israel',
      aliases: ['Land of Israel', 'Kingdom of Israel', 'Northern Kingdom'],
      strongs: ['H3478', 'G2474'],
      hebrew: 'יִשְׂרָאֵל',
      greek: 'Ἰσραήλ',
      featureType: 'Region',
      precision: 'Regional',
      latitude: 31.89,
      longitude: 35.2,
      lat: 31.89,
      lon: 35.2,
      verseCount: 0,
      openBibleUri: null,
      pleiadesUri: null,
    });
    locatedCount++;
    strongsMatchedCount++;
  }

  // Build bible-person-verses.json: canonical "book:chapter:verse" -> deduplicated person_id[]
  const versePersonSets = new Map();
  let verseMentionCount = 0;
  for (const row of rawPersonVerses) {
    const pid = (row.person_id || '').trim();
    if (!pid || pid === 'YHVH_1' || pid === 'NA') continue;
    const parsed = parseBibleRef(row.reference_id);
    if (!parsed) continue;
    const vKey = `${parsed.passage.book}:${parsed.passage.chapter}:${parsed.passage.verse}`;
    let set = versePersonSets.get(vKey);
    if (!set) {
      set = new Set();
      versePersonSets.set(vKey, set);
    }
    if (!set.has(pid)) {
      set.add(pid);
      verseMentionCount++;
    }
  }
  const personVersesIndex = {};
  for (const [vKey, set] of versePersonSets.entries()) {
    personVersesIndex[vKey] = [...set];
  }
  const verseCountIndexed = versePersonSets.size;

  const placesIndex = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: [
      'robertrouse/theographic-bible-metadata (CC BY-SA 4.0)',
      'BradyStephenson/bible-data (CC BY 4.0)',
      'OpenBible.info Ancient Places (CC BY 4.0)',
    ],
    stats: {
      placeCount: places.length,
      locatedCount,
      unlocatedCount,
      strongsMatchedCount,
    },
    places,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const peoplePath = path.join(OUT_DIR, 'bible-people-graph.json');
  const personVersesPath = path.join(OUT_DIR, 'bible-person-verses.json');
  const placesPath = path.join(OUT_DIR, 'bible-places-index.json');
  const provPath = path.join(OUT_DIR, 'PROVENANCE.md');

  const peopleJson = JSON.stringify(peopleGraph);
  const personVersesJson = JSON.stringify(personVersesIndex);
  const placesJson = JSON.stringify(placesIndex);

  await writeFile(peoplePath, peopleJson, 'utf8');
  await writeFile(personVersesPath, personVersesJson, 'utf8');
  await writeFile(placesPath, placesJson, 'utf8');

  const provenanceMd = `# Biblical Context Shards — Data Provenance & Licenses

Generated by \`scripts/build-bible-context-shards.mjs\` on ${new Date().toISOString().slice(0, 10)}.

## Artifacts

- \`bible-people-graph.json\` — **${people.length.toLocaleString('en-US')}** biblical human figures and **${relationships.length.toLocaleString('en-US')}** deduplicated Scripture-witnessed relationships (${explicitEdges.toLocaleString('en-US')} explicit, ${inferredEdges.toLocaleString('en-US')} inferred). Non-human deity rows (\`YHVH_1\`) are excluded from the human genealogy graph.
- \`bible-person-verses.json\` — **${verseCountIndexed.toLocaleString('en-US')}** canonical verses mapped to **${verseMentionCount.toLocaleString('en-US')}** deduplicated human person attestations (excluding \`YHVH_1\` and \`NA\`).
- \`bible-places-index.json\` — **${places.length.toLocaleString('en-US')}** biblical places (${locatedCount.toLocaleString('en-US')} with coordinates, ${unlocatedCount.toLocaleString('en-US')} unlocated/symbolic with \`latitude: null, longitude: null\`, ${strongsMatchedCount.toLocaleString('en-US')} matched with Strong's numbers).

## Upstream Sources & Attribution

1. **BradyStephenson / bible-data** — [https://github.com/BradyStephenson/bible-data](https://github.com/BradyStephenson/bible-data)
   - License: **CC BY 4.0** (Creative Commons Attribution 4.0 International)
   - Files used: \`BibleData-Person.csv\`, \`BibleData-PersonLabel.csv\`, \`BibleData-PersonRelationship.csv\`, \`BibleData-PersonVerse.csv\`, \`BibleData-Place.csv\`, \`BibleData-PlaceLabel.csv\`
   - Contribution: Canonical disambiguated biblical person IDs, Hebrew/Greek original-script labels, transliterations, normalized Strong's numbers, verse-level person attestations (\`BibleData-PersonVerse.csv\`), and explicit/inferred verse-cited relationships.

2. **Robert Rouse / Theographic Bible Metadata** — [https://github.com/robertrouse/theographic-bible-metadata](https://github.com/robertrouse/theographic-bible-metadata)
   - License: **CC BY-SA 4.0** (Creative Commons Attribution-ShareAlike 4.0 International)
   - Files used: \`json/people.json\`, \`json/places.json\`
   - Contribution: Biblical place index, feature types, precision levels, coordinates, verse counts, Pleiades links, and chronological era ranges.

3. **OpenBible.info Ancient Places** — [https://www.openbible.info/geo/](https://www.openbible.info/geo/)
   - License: **CC BY 4.0** (Creative Commons Attribution 4.0 International)
   - Contribution: Ancient place identifiers (\`openBibleUri\`) and geolocation precision metadata linked through Theographic Bible Metadata and \`BibleData-PlaceLabel.csv\`.
`;

  await writeFile(provPath, provenanceMd, 'utf8');

  console.log(`Generated ${peoplePath} (${(peopleJson.length / 1024).toFixed(1)} KB): ${people.length} people, ${relationships.length} edges (${explicitEdges} explicit, ${inferredEdges} inferred)`);
  console.log(`Generated ${personVersesPath} (${(personVersesJson.length / 1024).toFixed(1)} KB): ${verseCountIndexed} verses, ${verseMentionCount} person attestations`);
  console.log(`Generated ${placesPath} (${(placesJson.length / 1024).toFixed(1)} KB): ${places.length} places (${locatedCount} located, ${unlocatedCount} null coords, ${strongsMatchedCount} Strong's matched)`);
  console.log(`Generated ${provPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
