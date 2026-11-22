// Offline regression fixtures only: no credentials, network, or user-note writes.
// Run: node --import ./scripts/mcp-deno-loader.mjs scripts/verify-mcp-research-reliability.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { executeResearch } from '../supabase/functions/bible-mcp/research-engine.ts';

const archive = JSON.parse(fs.readFileSync(new URL('../research/r12/mcp_v2_live_audit_2026-11-20/RAW_CASES.json', import.meta.url), 'utf8'));
const comparison = archive.cases.find((c) => c.id === 'R02');
const original = comparison.output.results[0];
const page = (rows) => ({ source: 'live', rows, page: { limit: 80, offset: 0, has_more: false, next_offset: null } });
const compareReader = async ({ name, args }) => {
  if (name === 'get_passage_compact_v1') return page([{ verses: original.passages.find((p) => p.verses[0].book === args.passages[0].book).verses }]);
  if (name === 'discover_biblical_connections_v2') return page([{ connections: [] }]);
  if (name === 'get_words_batch') return page([]);
  throw new Error('Unexpected fixture operation: ' + name);
};
const compared = await executeResearch(compareReader, comparison.input);
const result = compared.results[0];
for (let i = 0; i < original.passages.length; i++) {
  const before = original.passages[i].verses[0], after = result.passages[i].verses[0];
  assert.equal(after.english, before.web);
  assert.deepEqual(after.tokens.map((t) => t.surface), before.tokens.map((t) => t.surface));
  assert.deepEqual(after.tokens.map((t) => t.word_id ?? null), before.tokens.map((t) => t.word_id));
  assert.equal(after.xrefs, undefined);
  assert.ok(after.original.length > 0);
}
assert.ok(result.cross_references_and_bridges.some((c) => c.refs.includes('Revelation 11:4')), 'target_ref must survive comparison');
const beforeBytes = Buffer.byteLength(JSON.stringify(comparison.output)), afterBytes = Buffer.byteLength(JSON.stringify(compared));
assert.ok(afterBytes < beforeBytes * 0.85, 'Raw nested context must be reduced while retaining all verse text and tokens');
const unavailableGraph = await executeResearch(async (q) => {
  if (q.name === 'discover_biblical_connections_v2') throw new Error('upstream unavailable');
  return compareReader(q);
}, comparison.input);
assert.ok(unavailableGraph.results[0].warnings[0].includes('discovery unavailable'));
assert.ok(unavailableGraph.results[0].cross_references_and_bridges.length > 0);
const firstTokens = original.passages[0].verses[0].tokens;
const verified = await executeResearch(async (q) => {
  if (q.name === 'get_words_batch') return page([
    { id: firstTokens[0].word_id, original_word: firstTokens[0].surface, strongs_nr: firstTokens[0].strongs, transliteration: 'verified-token', grammar_code: 'VERIFIED' },
    { id: firstTokens[1].word_id, original_word: firstTokens[2].surface, strongs_nr: firstTokens[2].strongs, transliteration: 'WRONG-NEIGHBOR', grammar_code: 'WRONG' },
  ]);
  return compareReader(q);
}, comparison.input);
assert.equal(verified.results[0].passages[0].verses[0].tokens[0].transliteration, 'verified-token');
assert.equal(verified.results[0].passages[0].verses[0].tokens[0].grammar_code, 'VERIFIED');
assert.equal(verified.results[0].passages[0].verses[0].tokens[1].transliteration, undefined);
assert.equal(verified.results[0].passages[0].verses[0].tokens[1].grammar_code, undefined);
assert.ok(!JSON.stringify(verified).includes('WRONG-NEIGHBOR'));

// Caller limit bounds witnesses, not the verses included in date distributions.
const allIds = Array.from({ length: 85 }, (_, i) => i + 1);
const batches = [];
const distributionReader = async ({ name, args }) => {
  if (name === 'resolve_fast_lookup_v1') return page([{ strongs: 'H7307', lemma_key: 'lemma:H7307' }]);
  if (name === 'get_word_profiles_batch_v1') return page([{ profiles: { H7307: { total_verses: 85, vids_by_book: { 1: allIds } } } }]);
  if (name === 'query_chronology_assertions_batch') {
    batches.push(args.verse_ids);
    return page([{ models: [{ id: 'test', name: 'Fixture chronology' }], assertions: args.verse_ids.flatMap((verse_id) => [
      { verse_id, model_id: 'test', axis: 'source_placement', earliest_year: -500, latest_year: -500 },
      { verse_id, model_id: 'test', axis: 'source_placement', earliest_year: -500, latest_year: -500 },
      { verse_id, model_id: 'test', axis: 'mentioned_event', earliest_year: -800, latest_year: -700 },
    ]) }]);
  }
  throw new Error('Unexpected fixture operation: ' + name);
};
const chronology = (await executeResearch(distributionReader, { operations: [{ op: 'chronology_occurrences', word: 'H7307', limit: 3 }] })).results[0];
assert.deepEqual(batches.map((b) => b.length), [80, 5]);
assert.equal(chronology.coverage.examined_verses, 85);
assert.equal(chronology.coverage.complete_matching_verse_coverage, true);
assert.equal(chronology.models.length, 2);
for (const bin of chronology.models) { assert.equal(bin.count, 85); assert.equal(bin.verse_ids.length, 3); assert.equal(bin.witnesses_truncated, true); }
assert.equal(chronology.models.find((g) => g.axis === 'mentioned_event').latest_year, -700, 'Keep uncertain intervals intact');
const uncertain = (await executeResearch(async (q) => {
  if (q.name === 'query_chronology_assertions_batch') return page([{ assertions: [{ verse_id: 1, model_id: 'test', axis: 'event', earliest_year: -500 }] }]);
  return distributionReader(q);
}, { operations: [{ op: 'chronology_occurrences', word: 'H7307', limit: 1 }] })).results[0];
assert.equal(uncertain.models[0].latest_year, null, 'A missing bound must not become an exact date');
assert.equal(uncertain.coverage.undated_verses, 84);

const geography = (await executeResearch(async () => page([{ places: [{ name: 'Corinth', linked_passages: ['53:1:1 (Audience)', { ref: '44:18:1', relationship_type: 'event_location' }] }] }]), { operations: [{ op: 'geography_search', place: 'Corinth' }] })).results[0];
assert.equal(geography.places[0].linked_passages[0].ref, '2 Thessalonians 1:1 (Audience)');
assert.equal(geography.places[0].linked_passages[0].role, 'unknown', 'Do not infer location role from a title');
assert.equal(geography.places[0].linked_passages[1].ref, 'Acts 18:1');
assert.equal(geography.places[0].linked_passages[1].role, 'event_location');

const combinedInput = archive.cases.find((c) => c.id === 'R01').input;
const combined = await executeResearch(async (q) => {
  if (q.name === 'query_places_by_name') throw new Error('private upstream diagnostic service_role=SECRET');
  return distributionReader(q);
}, combinedInput);
assert.equal(combined.status, 'partial');
assert.equal(combined.results[0].status, 'ok');
assert.equal(combined.results[1].status, 'error');
assert.equal(combined.results[2].status, 'ok');
assert.ok(!JSON.stringify(combined).includes('SECRET'));
assert.ok(combined.results[1].error.includes('geography_search'));

// Comparison must not silently stop after the first 20 verses.
const range = await executeResearch(async ({ name, args, limit }) => name === 'get_passage_compact_v1'
  ? page([{ verses: Array.from({ length: limit }, (_, i) => ({ verse_id: args.passages[0].book * 1000 + args.offset + i, book: args.passages[0].book, chapter: 1, verse: args.offset + i + 1, web: 'complete verse', tokens: [] })) }])
  : page([{ connections: [] }]), { operations: [{ op: 'passage_compare', passages: ['1COR12:10-1COR13:4', 'Psalms 119'], limit: 2 }] });
assert.deepEqual(range.results[0].passages.map((p) => p.verses.length), [26, 176]);
assert.equal(new Set(range.results[0].passages[1].verses.map((v) => v.verse_id)).size, 176, 'Pagination preserves distinct verse identities');
console.log(JSON.stringify({ status: 'pass', archive_R02_before_bytes: beforeBytes, compact_after_bytes: afterBytes, reduction_percent: Math.round((1 - afterBytes / beforeBytes) * 100), checks: ['archive comparison completeness/IDs/size', 'readable cross-reference targets', 'chronology distributions/axes/dedup/batching/witness bounds', 'geography refs/roles', 'combined-operation error isolation/no secret leak', 'cross-chapter comparison completeness'] }));
