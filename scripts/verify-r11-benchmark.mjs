/** Read-only seeded holdout: ground truth from pinned MACULA rows, never profiles. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { createNodeFsAssetReader } from '../src/relationships/adjacency-loader.ts';
import { discoverBiblicalConnections } from '../src/relationships/r10-discovery.ts';

const truth = new Map();
for (const [table, prefix, column] of [['macula_hebrew_morphemes', 'H', 'strong_x'], ['macula_greek_tokens', 'G', 'strongs']]) {
  const dir = path.resolve('.artifacts/static-corpus/tables', table);
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.jsonl.gz')).sort()) {
    for (const line of zlib.gunzipSync(fs.readFileSync(path.join(dir, name))).toString().split('\n')) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (prefix === 'G' && row.edition_key && row.edition_key !== 'macula-greek-nestle1904') continue;
      const match = String(row[column] || '').match(/^(\d+)/);
      const vid = Number(row.canonical_verse_id);
      if (!match || !vid) continue;
      const key = prefix + match[1].padStart(4, '0');
      if (!truth.has(key)) truth.set(key, new Set());
      truth.get(key).add(vid);
    }
  }
}
let seed = 1152026;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
const keys = [...truth.keys()].sort();
for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
// Exclude named design examples by using an independently seeded original-language sample.
const excluded = new Set(['H7799', 'H7800', 'G2918', 'H7307', 'G4151', 'H0231', 'H7416']);
const sample = keys.filter(k => !excluded.has(k)).slice(0, 30);
function scan(table, visit) {
  const dir = path.resolve('.artifacts/static-corpus/tables', table);
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.jsonl.gz')).sort()) {
    for (const line of zlib.gunzipSync(fs.readFileSync(path.join(dir, name))).toString().split('\n')) if (line) visit(JSON.parse(line));
  }
}
// Independently extend the selected MACULA sample with STEP source witnesses.
const selected = new Set(sample), wordVerse = new Map(), lemmaCodes = new Map();
scan('verses_immutable', row => { for (const id of row.word_ids || []) wordVerse.set(id, row.id); });
function addStep(code, word) {
  const m = String(code || '').match(/^([HG])0*(\d+)/i);
  const key = m ? m[1].toUpperCase() + m[2].padStart(4, '0') : '';
  const vid = wordVerse.get(word);
  if (selected.has(key) && vid) truth.get(key).add(vid);
}
scan('words_immutable', row => addStep(row.strongs_nr, row.id));
scan('lemmas', row => lemmaCodes.set(row.id, row.base_strongs));
scan('word_form_lemmas', row => addStep(row.dstrongs_tag || lemmaCodes.get(row.lemma_id), row.word_id));
const reader = await createNodeFsAssetReader([path.resolve('.artifacts-r10/deploy-bundle')]);
const results = [];
for (const lemma of sample) {
  let cursor = null;
  const retrieved = new Set();
  let pages = 0;
  const start = performance.now();
  do {
    const result = await discoverBiblicalConnections(reader, { query: lemma, mode: 'expand', focus_lemma: lemma, limit: 25, cursor });
    const occurrences = result.iterative_analysis?.lemma_occurrences;
    assert.ok(occurrences, `${lemma}: missing occurrence response`);
    for (const p of occurrences.passages) {
      assert.ok(!retrieved.has(p.verse_id), `${lemma}: duplicate pagination witness`);
      assert.ok(p.ref && !p.ref.includes('(vid'), `${lemma}: missing canonical reference`);
      retrieved.add(p.verse_id);
    }
    cursor = occurrences.next_cursor;
    assert.ok(++pages < 1000, 'Pagination failed to terminate');
  } while (cursor);
  const expected = truth.get(lemma);
  const missing = [...expected].filter(v => !retrieved.has(v));
  const extra = [...retrieved].filter(v => !expected.has(v));
  results.push({ lemma, expected: expected.size, retrieved: retrieved.size, recall: (expected.size - missing.length) / expected.size, missing, extra, pages, ms: Math.round(performance.now() - start) });
}
const pairs = [];
for (const lemma of sample.slice(0, 15)) {
  const vid = [...truth.get(lemma)][0];
  const partners = [...truth].filter(([key, vids]) => key !== lemma && !excluded.has(key) && vids.has(vid)).map(([key]) => key).sort();
  if (!partners.length) continue;
  const partner = partners[Math.floor(random() * partners.length)];
  const response = await discoverBiblicalConnections(reader, { query: `${lemma} ${partner}`, limit: 25 });
  const direct = response.strongest_connections.filter(c => c.evidence_id.startsWith('r11:intersect:verse:'));
  assert.ok(direct.length, `${lemma} + ${partner}: missed source-attested joint witness`);
  let unsupported = 0;
  for (const connection of direct) {
    for (const passage of connection.passages) {
      if (!truth.get(lemma).has(passage.verse_id) || !truth.get(partner).has(passage.verse_id)) unsupported++;
    }
  }
  assert.equal(unsupported, 0, `${lemma} + ${partner}: unsupported same-verse claim`);
  assert.equal(response.strongest_connections[0].query_support, 'all_concepts');
  pairs.push({ lemma, partner, source_vid: vid, direct_connections_checked: direct.length, unsupported,
    top_support: response.strongest_connections[0].query_support, globally_exhaustive: response.search_metadata.exhaustive });
}
const report = { seed: 1152026, ground_truth: 'Pinned MACULA Hebrew + Nestle1904 + STEP words and morphemes, distinct canonical verse IDs', results, pairs,
  limitations: ['Connection precision and interpretive ranking require separate semantic evaluation; direct recall is not connection precision.', 'STEP backfills may add legitimate witnesses beyond MACULA ground truth.'] };
fs.mkdirSync('.artifacts-r10/benchmarks', { recursive: true });
fs.writeFileSync('.artifacts-r10/benchmarks/holdout.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
assert.ok(results.every(r => r.missing.length === 0 && r.extra.length === 0), 'Source-corpus recall or precision is incomplete');
