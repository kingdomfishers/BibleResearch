// Live verification of public.get_verse_geography and public."getVerseGeography" against Supabase REST API.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .map(l => l.match(/^([A-Z0-9_]+)=(.+)$/))
    .filter(Boolean)
    .map(m => [m[1], m[2].trim()])
);
const base = env.VITE_SUPABASE_URL;
const anon = env.VITE_SUPABASE_ANON_KEY;
const headers = {
  apikey: anon,
  Authorization: `Bearer ${anon}`,
  'Content-Type': 'application/json',
};

async function callGeo(book, chapter, verse, rpcName = 'get_verse_geography') {
  const body = rpcName === 'getVerseGeography'
    ? { book, chapter, verse }
    : { p_book: book, p_chapter: chapter, p_verse: verse };
  const res = await fetch(`${base}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200, `${rpcName}(${book},${chapter},${verse}) returned HTTP ${res.status}`);
  return res.json();
}

// Test 1: Direct location — Acts 17:22 (Athens & Areopagus)
const acts17 = await callGeo(44, 17, 22);
assert.equal(acts17.status, 'ok');
assert.equal(acts17.resolution_status, 'direct_event_location');
assert.equal(acts17.has_physical_location, true);
assert.ok(acts17.locations.some(l => l.biblical_name === 'Areopagus' && l.relationship_type === 'event_location'));
assert.ok(acts17.locations.some(l => l.biblical_name === 'Athens' && l.relationship_type === 'event_location'));
const athens = acts17.locations.find(l => l.biblical_name === 'Athens');
assert.ok(Math.abs(athens.latitude - 37.97) < 0.05 && Math.abs(athens.longitude - 23.72) < 0.05);
assert.ok(athens.external_ids.pleiades_id, 'Athens must preserve Pleiades Gazetteer link');

// Test 2: Contextual location — John 4:7 (Sychar inherited from John 4:4-6, Samaria 2 as mentioned_location)
const john47 = await callGeo(43, 4, 7);
assert.equal(john47.status, 'ok');
assert.equal(john47.resolution_status, 'passage_context');
assert.equal(john47.locations[0].biblical_name, 'Sychar');
assert.equal(john47.locations[0].relationship_type, 'contextual_location');
assert.equal(john47.locations[0].is_inferred, true);
assert.equal(john47.locations[0].establishing_refs, 'John 4:4-6');
assert.ok(john47.locations[0].alternative_locations.length >= 1, 'Sychar must include alternative proposal (Tell Balatah)');
const samariaMention = john47.locations.find(l => l.biblical_name.startsWith('Samaria'));
assert.ok(samariaMention && samariaMention.relationship_type === 'mentioned_location');

// Dialogue mention inside narrative setting — John 4:20 (mentions Jerusalem while scene remains at Sychar)
const john420 = await callGeo(43, 4, 20);
assert.equal(john420.locations[0].biblical_name, 'Sychar');
assert.equal(john420.locations[0].relationship_type, 'contextual_location');
const jerusalemMention = john420.locations.find(l => l.biblical_name === 'Jerusalem');
assert.ok(jerusalemMention && jerusalemMention.relationship_type === 'mentioned_location');

// Test 3: Regional narrative location — Genesis 29:10 (Haran regional pastoral setting, no fabricated exact well GPS)
const gen2910 = await callGeo(1, 29, 10);
assert.equal(gen2910.status, 'ok');
assert.equal(gen2910.resolution_status, 'passage_context');
assert.equal(gen2910.locations[0].biblical_name, 'Haran');
assert.equal(gen2910.locations[0].relationship_type, 'contextual_location');
assert.equal(gen2910.locations[0].confidence_level, 'regional');
assert.equal(gen2910.locations[0].precision_kind, 'approximate_region');
assert.equal(gen2910.locations[0].geometry?.type, 'Polygon');
assert.ok(gen2910.locations[0].establishing_refs.includes('29:1, 4'));

// Test 4: Disputed wilderness locations — Exodus 15:23 (Marah) & Exodus 19:2 (Mount Sinai)
const exod1523 = await callGeo(2, 15, 23);
assert.equal(exod1523.status, 'ok');
const marah = exod1523.locations.find(l => l.biblical_name === 'Marah');
assert.ok(marah, 'Exodus 15:23 must include Marah');
assert.equal(marah.location_status, 'disputed');
assert.ok(marah.alternative_locations.length >= 2, 'Marah must preserve competing route proposals');

const exod192 = await callGeo(2, 19, 2);
const sinai = exod192.locations.find(l => l.biblical_name === 'Mount Sinai');
assert.ok(sinai, 'Exodus 19:2 must include Mount Sinai');
assert.ok(sinai.alternative_locations.length >= 4, 'Mount Sinai must preserve competing scholarly proposals');

// Test 5: Symbolic / non-physical location — Revelation 21:2 (New Jerusalem must NEVER return physical coordinates)
const rev212 = await callGeo(66, 21, 2);
assert.equal(rev212.status, 'ok');
assert.equal(rev212.resolution_status, 'symbolic_non_physical');
assert.equal(rev212.has_physical_location, false);
assert.ok(rev212.message?.includes('No reliable geographical location identified for this verse'));
assert.ok(rev212.locations.every(l => l.latitude === null && l.longitude === null && l.geometry === null));

// Unknown / wisdom verse with no physical location — Proverbs 15:1
const prov151 = await callGeo(20, 15, 1);
assert.equal(prov151.status, 'ok');
assert.equal(prov151.resolution_status, 'unknown');
assert.equal(prov151.has_physical_location, false);
assert.equal(prov151.message, 'No reliable geographical location identified for this verse.');
assert.equal(prov151.locations.length, 0);

// Travel origin & destination — Acts 18:1 (Athens -> Corinth)
const acts181 = await callGeo(44, 18, 1);
assert.ok(acts181.locations.some(l => l.biblical_name === 'Athens' && l.relationship_type === 'travel_origin'));
assert.ok(acts181.locations.some(l => l.biblical_name === 'Corinth' && l.relationship_type === 'travel_destination'));

// Epistolary & Prophetic Provenance + Chronological Era Gazetteer:
// Colossians 1:15 -> Colossae (audience_location) + Rome (composition_location)
const col115 = await callGeo(51, 1, 15);
assert.equal(col115.status, 'ok');
assert.ok(col115.chronological_context?.era_key === 'roman_new_testament', 'Colossians must resolve Roman/Apostolic chronological context');
assert.ok(col115.locations.some(l => l.biblical_name === 'Colossae' && l.relationship_type === 'audience_location' && l.ancient_name?.includes('Colossia')), 'Colossians 1:15 must include Colossae / Colossia as audience_location');
assert.ok(col115.locations.some(l => l.biblical_name === 'Rome' && l.relationship_type === 'composition_location'), 'Colossians 1:15 must include Rome as composition_location');
assert.ok(Array.isArray(col115.era_gazetteer) && col115.era_gazetteer.length >= 4, 'Colossians 1:15 must include era_gazetteer');

// Ephesians 2:8 -> Ephesus (audience_location) + Rome (composition_location)
const eph28 = await callGeo(49, 2, 8);
assert.equal(eph28.status, 'ok');
assert.ok(eph28.locations.some(l => l.biblical_name === 'Ephesus' && l.relationship_type === 'audience_location' && l.ancient_name?.includes('Ephesos')), 'Ephesians 2:8 must include Ephesus as audience_location');
assert.ok(eph28.locations.some(l => l.biblical_name === 'Rome' && l.relationship_type === 'composition_location'), 'Ephesians 2:8 must include Rome as composition_location');

// Daniel 8:2 & 8:14 -> Ulai Canal (Eulaeus River) + Susa (Shushan)
const dan82 = await callGeo(27, 8, 2);
assert.equal(dan82.status, 'ok');
assert.ok(dan82.chronological_context?.era_key === 'exile_persian', 'Daniel 8 must resolve Exilic/Persian chronological context');
assert.ok(dan82.locations.some(l => l.biblical_name === 'Ulai' && l.ancient_name?.includes('Ulai Canal')), 'Daniel 8:2 must include Ulai Canal');
assert.ok(dan82.locations.some(l => l.biblical_name === 'Susa' && l.ancient_name?.includes('Shushan')), 'Daniel 8:2 must include Susa (Shushan)');

const dan814 = await callGeo(27, 8, 14);
assert.equal(dan814.status, 'ok');
assert.ok(dan814.locations.some(l => l.biblical_name === 'Ulai' && l.relationship_type === 'contextual_location'), 'Daniel 8:14 must inherit Ulai Canal setting');
assert.ok(dan814.locations.some(l => l.biblical_name === 'Susa' && l.relationship_type === 'composition_location'), 'Daniel 8:14 must include Susa composition/vision provenance');

// Test 9: Compatibility wrapper getVerseGeography(book, chapter, verse) & error bounds
const aliasActs = await callGeo(44, 17, 22, 'getVerseGeography');
assert.equal(aliasActs.status, 'ok');
assert.equal(aliasActs.locations[0].biblical_name, acts17.locations[0].biblical_name);

const invalidRef = await callGeo(99, 1, 1);
assert.equal(invalidRef.status, 'invalid_reference');
const notFound = await callGeo(1, 1, 170);
assert.equal(notFound.status, 'passage_not_found');

for (const pkt of [acts17, john47, john420, gen2910, exod1523, exod192, rev212, prov151, acts181]) {
  assert.ok(Buffer.byteLength(JSON.stringify(pkt)) <= 51200, 'Packet must stay <= 50 KiB');
}

// Verify anonymous writes to geography tables are rejected
const writeAttempt = await fetch(`${base}/rest/v1/places`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ place_key: 'anon-write-test', biblical_name: 'Forbidden' }),
});
assert.ok([401, 403].includes(writeAttempt.status), 'Anonymous writes to places must be rejected');

console.log('Geography RPC verification passed: Tests 1-5 & 9 (Acts 17:22, John 4:7, John 4:20, Genesis 29:10, Exodus 15:23/19:2, Revelation 21:2, Proverbs 15:1, Acts 18:1, getVerseGeography alias, packet bounds, and denied writes).');
