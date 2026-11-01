import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const fixtures = JSON.parse(await fs.readFile('scripts/fixtures/hydrated-research-cases.json', 'utf8'));
assert.equal(fixtures.passages.length, 5);
assert.ok(fixtures.invalid.length >= 8);
if (process.argv.includes('--fixtures-only')) {
  console.log('PASS acceptance fixtures: Hebrew, Greek, heading, symbolic, reviewed evidence and invalid inputs');
  process.exit(0);
}
const env = Object.fromEntries((await fs.readFile('.env', 'utf8')).split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
  }));
async function rpc(name, body, query = '') {
  const response = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${name}${query}`, {
    method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
  });
  assert.equal(response.status, 200, `${name}: ${await response.clone().text().then(s => s.slice(0, 200))}`);
  return response.json();
}
const research = p_request => rpc('get_verse_research_v1', { p_request });
if (process.argv.includes('--stress-only')) {
  const passages = [
    { book: 17, chapter: 8, verse: 9 }, { book: 12, chapter: 16, verse: 15 },
    { book: 66, chapter: 20, verse: 4 }, { book: 41, chapter: 16, verse: 8 },
    { book: 43, chapter: 8, verse: 44 },
  ];
  const started = performance.now();
  const packet = await research({ passages });
  assert.ok(['ok', 'packet_limit_exceeded'].includes(packet.status));
  if (packet.status === 'packet_limit_exceeded') {
    assert.ok(packet.measured_bytes > packet.max_packet_bytes);
    assert.equal('verses' in packet, false, 'An oversized response must not expose a partial packet');
  } else {
    assert.equal(packet.verses.length, 5);
    assert.equal(packet.coverage.occurrences_complete, true);
  }
  console.log(`PASS public five-long-verse stress: ${packet.status}, ${Math.round(performance.now() - started)} ms, ${packet.measured_bytes ?? Buffer.byteLength(JSON.stringify(packet))} bytes`);
  process.exit(0);
}
for (const passage of fixtures.passages) {
  const packet = await research({ passages: [passage], occurrences: { mode: 'sample', limit: 2 } });
  assert.equal(packet.status, 'ok');
  const verse = packet.verses[0];
  const source = await rpc('get_verse_translations_v1', {
    p_book: passage.book, p_chapter: passage.chapter, p_verse: passage.verse,
  });
  assert.equal(verse.words.length, source.length);
  for (const [i, word] of verse.words.entries()) {
    assert.equal(word.word_position, i + 1);
    for (const k of ['word_id', 'original_word', 'transliteration', 'strongs_nr']) assert.equal(word[k], source[i][k]);
    assert.equal(word.grammar.raw_code, source[i].grammar_code);
    assert.equal(word.translations.source_english, source[i].source_english);
    assert.ok(packet.lexical_entries[word.lexical_entry_key]);
    assert.ok(!('selected_english' in word.translations));
  }
  if (passage.verse === 0) assert.equal(verse.passage.is_heading, true);
  if (passage.book === 66) assert.equal(verse.geography.has_physical_location, false);
  if (passage.chapter === 29) assert.ok(verse.semantic_evidence.length > 0);
  for (const entry of Object.values(packet.lexical_entries)) {
    assert.ok(entry.occurrences.references.length <= 2);
    assert.equal(entry.occurrences.complete, entry.occurrences.distinct_passage_total <= 2);
    assert.ok(entry.top_connected_words.length <= 7);
  }
  console.log(`PASS source parity and coverage ${passage.book}:${passage.chapter}:${passage.verse}`);
}
const start = performance.now();
const full = await research({ passages: fixtures.passages.slice(0, 2) });
assert.equal(full.status, 'ok');
assert.equal(full.verses.length, 2);
assert.equal(full.coverage.occurrences_complete, true);
assert.ok(Buffer.byteLength(JSON.stringify(full)) <= 8 * 1024 * 1024);
for (const entry of Object.values(full.lexical_entries)) {
  const o = entry.occurrences;
  assert.equal(o.complete, true);
  assert.equal(o.references.length, o.distinct_passage_total);
  assert.equal(o.references.reduce((n, r) => n + r.occurrence_count, 0), o.corpus_token_total);
  const cached = await rpc('prompt_word_cooccurrences', { p_word_query: entry.strongs_nr }, '?limit=7');
  assert.deepEqual(entry.top_connected_words.map(w => w.word_id), cached.map(w => w.word_id));
}
const independent = await rpc('prompt_word_occurrences', { p_word_query: 'H7225' }, '?limit=1000');
assert.deepEqual(full.lexical_entries.H7225.occurrences.references,
  independent.map(({ book, chapter, verse_nr, occurrence_count }) => ({ book, chapter, verse: verse_nr, occurrence_count })));
assert.equal(full.lexical_entries.H1254.lexeme_candidates.length, 3);
assert.equal(full.lexical_entries.H1254.needs_disambiguation, true);
console.log(`PASS complete occurrences, ranking and homographs (${Math.round(performance.now() - start)} ms with comparisons)`);
for (const input of fixtures.invalid) assert.equal((await research(input)).status, 'invalid_request');
assert.equal((await research({ passages: [fixtures.missing] })).status, 'passage_not_found');
assert.equal((await research({ passages: Array(6).fill(fixtures.passages[0]) })).status, 'invalid_request');
assert.equal((await research({ passages: [fixtures.passages[0]], chronology_model_id: 'missing' })).status, 'invalid_request');
console.log('PASS invalid input, missing passages, batch bounds and invalid model');
