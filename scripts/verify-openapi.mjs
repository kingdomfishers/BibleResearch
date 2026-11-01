import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const openApiPath = resolve('supabase/openapi.json');
const raw = readFileSync(openApiPath, 'utf-8');
const spec = JSON.parse(raw);

console.log('Testing OpenAPI specification...');

if (spec.openapi !== '3.1.0') {
  throw new Error(`Expected openapi version 3.1.0, got ${spec.openapi}`);
}
if (!spec.info || !spec.info.title || !spec.info.version) {
  throw new Error('Missing required info fields');
}
if (!Array.isArray(spec.servers) || spec.servers.length === 0) {
  throw new Error('Missing server definitions');
}

const requiredPaths = [
  '/rpc/prompt_verse_words',
  '/rpc/prompt_word_occurrences',
  '/rpc/prompt_word_cooccurrences',
  '/rpc/prompt_word_relationships',
  '/rpc/resolve_word_id',
  '/rpc/get_verse_chronology_v1',
  '/rpc/get_verse_geography',
  '/rpc/research_relationships_v1',
  '/rpc/get_verse_research_v1',
];

for (const path of requiredPaths) {
  if (!spec.paths[path]) {
    throw new Error(`Missing required path: ${path}`);
  }
  const post = spec.paths[path].post;
  if (!post) {
    throw new Error(`Path ${path} missing POST operation`);
  }
  if (!post.operationId) {
    throw new Error(`Path ${path} missing operationId`);
  }
  if (!post.requestBody) {
    throw new Error(`Path ${path} missing requestBody`);
  }
  if (!post.responses || !post.responses['200']) {
    throw new Error(`Path ${path} missing 200 response`);
  }
  console.log(`  PASS: Schema for ${path} (${post.operationId})`);
}

const serverUrl = spec.servers[0].url;
const apiKey = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

console.log('\nTesting live PostgREST endpoints against spec...');

async function testPostgrest(path, body) {
  const url = `${serverUrl}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': apiKey,
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to call ${path}: HTTP ${response.status} - ${errorText}`);
  }
  return response.json();
}

const hydrated = await testPostgrest('/rpc/get_verse_research_v1', {
  p_request: { passages: [{ book: 1, chapter: 1, verse: 1 }], occurrences: { mode: 'sample', limit: 2 } },
});
if (hydrated.status !== 'ok' || hydrated.verses[0].words.length !== 7 || hydrated.coverage.occurrences_complete !== false) {
  throw new Error('Hydration RPC does not match its OpenAPI contract');
}
console.log('  PASS: get_verse_research_v1 returns typed hydration and explicit sample coverage');
if (process.argv.includes('--hydration-only')) process.exit(0);

// 1. Test prompt_verse_words
const verseWords = await testPostgrest('/rpc/prompt_verse_words', { p_book: 1, p_chapter: 1, p_verse: 1 });
if (!Array.isArray(verseWords) || verseWords.length !== 7) {
  throw new Error(`prompt_verse_words returned unexpected response: ${JSON.stringify(verseWords)}`);
}
console.log(`  PASS: prompt_verse_words returned ${verseWords.length} tokens for Genesis 1:1`);

// 2. Test prompt_word_occurrences
const occurrences = await testPostgrest('/rpc/prompt_word_occurrences', { p_word_query: 'H7225' });
if (!Array.isArray(occurrences) || occurrences.length !== 49) {
  throw new Error(`prompt_word_occurrences returned unexpected response count: ${occurrences.length}`);
}
console.log(`  PASS: prompt_word_occurrences returned ${occurrences.length} passages for H7225`);

// 3. Test prompt_word_cooccurrences
const cooccurrences = await testPostgrest('/rpc/prompt_word_cooccurrences', { p_word_query: 'H7225' });
if (!Array.isArray(cooccurrences) || cooccurrences.length === 0) {
  throw new Error(`prompt_word_cooccurrences returned unexpected response: ${JSON.stringify(cooccurrences)}`);
}
console.log(`  PASS: prompt_word_cooccurrences returned ${cooccurrences.length} partners for H7225`);

// 4. Test resolve_word_id
const resolvedId = await testPostgrest('/rpc/resolve_word_id', { p_query: 'H7225' });
if (typeof resolvedId !== 'number' || resolvedId <= 0) {
  throw new Error(`resolve_word_id returned unexpected id: ${resolvedId}`);
}
console.log(`  PASS: resolve_word_id resolved H7225 to ${resolvedId}`);

// 5. Test prompt_word_relationships
const relationships = await testPostgrest('/rpc/prompt_word_relationships', {
  p_word_ids: [verseWords[0].word_id, verseWords[1].word_id],
});
if (!Array.isArray(relationships) || relationships.length === 0) {
  throw new Error(`prompt_word_relationships returned unexpected response: ${JSON.stringify(relationships)}`);
}
console.log(`  PASS: prompt_word_relationships returned ${relationships.length} shared passages with scores`);

// 6. Test get_verse_chronology_v1
const chronology = await testPostgrest('/rpc/get_verse_chronology_v1', {
  p_book: 11,
  p_chapter: 6,
  p_verse: 1,
  p_model_id: 'theographic-verse-v1',
  p_run_id: null,
  p_evidence_cursor: null,
});
if (!chronology || chronology.schema_version !== 1 || chronology.status !== 'ok' || !chronology.summary) {
  throw new Error(`get_verse_chronology_v1 returned unexpected response: ${JSON.stringify(chronology)}`);
}
console.log(`  PASS: get_verse_chronology_v1 returned "${chronology.summary.label}" (${chronology.assignment_status}) for 1 Kings 6:1`);

// 7. Test get_verse_geography
const geography = await testPostgrest('/rpc/get_verse_geography', {
  p_book: 43,
  p_chapter: 4,
  p_verse: 7,
});
if (!geography || geography.schema_version !== 1 || geography.status !== 'ok' || !Array.isArray(geography.locations) || geography.locations.length === 0) {
  throw new Error(`get_verse_geography returned unexpected response: ${JSON.stringify(geography)}`);
}
console.log(`  PASS: get_verse_geography returned ${geography.locations.length} locations (${geography.resolution_status}) for John 4:7`);

// 8. Test research_relationships_v1
const relResearch = await testPostgrest('/rpc/research_relationships_v1', {
  p_request: { subject: { text: 'well' }, target: { text: 'marriage' }, mode: 'explain' },
});
if (!relResearch || relResearch.schema_version !== 1 || relResearch.status !== 'ok' || !Array.isArray(relResearch.evidence_paths) || relResearch.evidence_paths.length < 3) {
  throw new Error(`research_relationships_v1 returned unexpected response: ${JSON.stringify(relResearch)}`);
}
console.log(`  PASS: research_relationships_v1 returned ${relResearch.evidence_paths.length} paths for "well" -> "marriage"`);

console.log('\nAll OpenAPI 3.1.0 and PostgREST endpoint checks PASSED!');

