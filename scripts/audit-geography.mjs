// Offline SHA-256 verified geography source audit across OpenBible, Theographic, STEP TIPNR, and Pleiades links.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const OPENBIBLE_COMMIT = '7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f';
export const THEOGRAPHIC_COMMIT = '744355c7a5f38efd407bc67a5257c99aca9532bc';
export const STEPBIBLE_COMMIT = 'be4191f0082aeedddb0eff0c02c966292b2bd641';

const root = '.artifacts/geography';
await fs.mkdir(root, { recursive: true });

const remoteFiles = [
  {
    key: 'openbible_ancient',
    file: 'ancient.jsonl',
    dataset: 'OpenBible.info Bible-Geocoding-Data',
    version: OPENBIBLE_COMMIT,
    license: 'CC BY 4.0',
    attribution: 'OpenBible.info (Stephen Smith), CC BY 4.0',
    url: `https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/${OPENBIBLE_COMMIT}/data/ancient.jsonl`,
  },
  {
    key: 'openbible_modern',
    file: 'modern.jsonl',
    dataset: 'OpenBible.info Bible-Geocoding-Data',
    version: OPENBIBLE_COMMIT,
    license: 'CC BY 4.0',
    attribution: 'OpenBible.info (Stephen Smith), CC BY 4.0',
    url: `https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/${OPENBIBLE_COMMIT}/data/modern.jsonl`,
  },
  {
    key: 'openbible_geometry',
    file: 'geometry.jsonl',
    dataset: 'OpenBible.info Bible-Geocoding-Data',
    version: OPENBIBLE_COMMIT,
    license: 'CC BY 4.0 / ODbL 1.0 (OSM geometries)',
    attribution: 'OpenBible.info (CC BY 4.0); OpenStreetMap contributors (ODbL 1.0)',
    url: `https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/${OPENBIBLE_COMMIT}/data/geometry.jsonl`,
  },
  {
    key: 'openbible_source',
    file: 'source.jsonl',
    dataset: 'OpenBible.info Bible-Geocoding-Data',
    version: OPENBIBLE_COMMIT,
    license: 'CC BY 4.0',
    attribution: 'OpenBible.info scholarly bibliography metadata, CC BY 4.0',
    url: `https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/${OPENBIBLE_COMMIT}/data/source.jsonl`,
  },
  {
    key: 'theographic_places',
    file: 'theographic-places.json',
    dataset: 'Theographic Bible Metadata',
    version: THEOGRAPHIC_COMMIT,
    license: 'CC BY-SA 4.0',
    attribution: 'Robert Rouse / Theographic Bible Metadata, CC BY-SA 4.0',
    url: `https://raw.githubusercontent.com/robertrouse/theographic-bible-metadata/${THEOGRAPHIC_COMMIT}/json/places.json`,
  },
  {
    key: 'stepbible_tipnr',
    file: 'stepbible-tipnr.txt',
    dataset: 'STEPBible TIPNR Proper Names',
    version: STEPBIBLE_COMMIT,
    license: 'CC BY 4.0',
    attribution: 'STEPBible.org / Tyndale House Cambridge (TIPNR), CC BY 4.0',
    url: `https://raw.githubusercontent.com/STEPBible/STEPBible-Data/${STEPBIBLE_COMMIT}/${encodeURIComponent('Proper Nouns')}/${encodeURIComponent('TIPNR - Translators Individualised Proper Names with all References - STEPBible.org CC BY.txt')}`,
  },
];

const download = process.argv.includes('--download');
const manifest = [];

for (const item of remoteFiles) {
  const localPath = `${root}/${item.file}`;
  let exists = false;
  try { await fs.access(localPath); exists = true; } catch { exists = false; }
  if (download || !exists) {
    const res = await fetch(item.url, { headers: { 'User-Agent': 'BibleResearch-GeoETL/1.0' } });
    if (!res.ok) throw new Error(`Failed to fetch ${item.key}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(localPath, bytes);
  }
  const bytes = await fs.readFile(localPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  manifest.push({ ...item, bytes: bytes.length, sha256 });
}

const parseJsonl = async file => (await fs.readFile(`${root}/${file}`, 'utf8'))
  .replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));

const ancient = await parseJsonl('ancient.jsonl');
const modern = await parseJsonl('modern.jsonl');
const geometry = await parseJsonl('geometry.jsonl');
const sources = await parseJsonl('source.jsonl');
const theoPlaces = JSON.parse((await fs.readFile(`${root}/theographic-places.json`, 'utf8')).replace(/^\uFEFF/, ''));
const tipnrRaw = (await fs.readFile(`${root}/stepbible-tipnr.txt`, 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/);

// Extract Pleiades links from OpenBible (s2428ed) and Theographic (recogitoUri), and TIPNR IDs (s3b25cf)
let pleiadesLinks = 0;
const knownTipnrIds = new Set();
for (const a of ancient) {
  if (a.linked_data?.s2428ed?.id) pleiadesLinks++;
  if (a.linked_data?.s3b25cf?.id) knownTipnrIds.add(a.linked_data.s3b25cf.id.split('(')[0].trim());
}
let theoPleiadesLinks = 0;
for (const p of theoPlaces) {
  if (/pleiades\.stoa\.org\/places\/\d+/.test(String(p.fields?.recogitoUri ?? ''))) theoPleiadesLinks++;
}

// Parse STEPBible TIPNR place records and original-language names
const tipnrPlaces = new Map();
let currentPlaceKey = null;
for (const line of tipnrRaw) {
  if (!line || line.startsWith('#') || line.startsWith('$') || line.startsWith('=')) continue;
  const cols = line.split('\t');
  if (!line.startsWith('–') && !line.startsWith('-')) {
    const header = cols[0]?.trim() ?? '';
    const desc = cols[1]?.trim() ?? '';
    const cleanKey = header.split('=')[0].split('(')[0].trim();
    if (header.includes('@') && (knownTipnrIds.has(cleanKey) || /(place|city|town|region|mountain|river|valley|well|spring|island|sea|brook|hill|desert|wilderness|land|country|mount|district|province)/i.test(desc))) {
      currentPlaceKey = cleanKey;
      const strongs = header.includes('=') ? header.split('=')[1].trim() : null;
      tipnrPlaces.set(currentPlaceKey, {
        tipnrId: currentPlaceKey,
        name: currentPlaceKey.split('@')[0],
        description: desc,
        strongs: strongs ? [strongs] : [],
        hebrewName: null,
        greekName: null,
      });
    } else {
      currentPlaceKey = null;
    }
  } else if (currentPlaceKey && tipnrPlaces.has(currentPlaceKey)) {
    const entry = tipnrPlaces.get(currentPlaceKey);
    const tagCol = cols[2]?.trim() ?? '';
    const m = tagCol.match(/^([HG]\d+[A-Za-z]?)«[^=]+=([^\t]+)/);
    if (m) {
      const [, strong, script] = m;
      if (!entry.strongs.includes(strong)) entry.strongs.push(strong);
      if (strong.startsWith('H') && !entry.hebrewName) entry.hebrewName = script.trim();
      if (strong.startsWith('G') && !entry.greekName) entry.greekName = script.trim();
    }
  }
}

const report = {
  auditedAt: new Date().toISOString(),
  manifest,
  counts: {
    openbibleAncient: ancient.length,
    openbibleModern: modern.length,
    openbibleGeometry: geometry.length,
    openbibleSources: sources.length,
    openbiblePleiadesLinks: pleiadesLinks,
    theographicPlaces: theoPlaces.length,
    theographicPleiadesLinks: theoPleiadesLinks,
    tipnrPlaces: tipnrPlaces.size,
  },
  milestoneSamples: {
    athens: ancient.find(a => a.friendly_id === 'Athens')?.id ?? null,
    areopagus: ancient.find(a => a.friendly_id === 'Areopagus')?.id ?? null,
    sychar: ancient.find(a => a.friendly_id === 'Sychar')?.id ?? null,
    samariaRegion: ancient.find(a => a.friendly_id === 'Samaria 2')?.id ?? null,
    haran: ancient.find(a => a.friendly_id === 'Haran')?.id ?? null,
    marah: ancient.find(a => a.friendly_id === 'Marah')?.id ?? null,
    mountSinai: ancient.find(a => a.friendly_id === 'Mount Sinai')?.id ?? null,
    newJerusalemInAncient: ancient.find(a => /new jerusalem/i.test(a.friendly_id))?.id ?? null,
  },
};

await fs.writeFile(`${root}/report.json`, JSON.stringify(report, null, 2));
await fs.writeFile(`${root}/tipnr-places.json`, JSON.stringify([...tipnrPlaces.values()], null, 2));
console.log(`Geography source audit complete: ${ancient.length} ancient places, ${modern.length} modern locations, ${geometry.length} geometries, ${sources.length} sources, ${theoPlaces.length} Theographic places, ${tipnrPlaces.size} TIPNR places, ${pleiadesLinks + theoPleiadesLinks} Pleiades links.`);
