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
  '/rpc/lookup_word_to_lemma_senses_v1',
  '/rpc/lookup_lemma_occurrences_v1',
  '/rpc/lookup_lemma_root_relatives_v1',
  '/rpc/lookup_lemma_english_glosses_v1',
  '/rpc/lookup_passage_tokens_syntax_v1',
  '/rpc/lookup_concept_properties_v1',
  '/rpc/lookup_entity_relationships_v1',
  '/rpc/lookup_hebrew_to_greek_alignments_v1',
  '/rpc/lookup_greek_to_hebrew_alignments_v1',
  '/rpc/get_hebrew_septuagint_parallel_v1',
  '/rpc/lookup_cross_testament_greek_v1',
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

// 9. Test lookup_word_to_lemma_senses_v1
const wordSenses = await testPostgrest('/rpc/lookup_word_to_lemma_senses_v1', { p_word_id: 129386 });
if (!wordSenses || wordSenses.schema_version !== 1 || wordSenses.status !== 'ok' || !Array.isArray(wordSenses.word_forms) || wordSenses.word_forms.length === 0) {
  throw new Error(`lookup_word_to_lemma_senses_v1 returned unexpected response: ${JSON.stringify(wordSenses)}`);
}
console.log(`  PASS: lookup_word_to_lemma_senses_v1 decomposed word_id 129386 into ${wordSenses.word_forms[0].morpheme_lemma_links.length} morpheme-lemma links`);

// 10. Test lookup_lemma_occurrences_v1
const lemmaOccs = await testPostgrest('/rpc/lookup_lemma_occurrences_v1', { p_lemma_query: 'G3056', p_after_verse_id: 0, p_limit: 5 });
if (!lemmaOccs || lemmaOccs.schema_version !== 1 || lemmaOccs.status !== 'ok' || lemmaOccs.totals?.total_tokens !== 330) {
  throw new Error(`lookup_lemma_occurrences_v1 returned unexpected response: ${JSON.stringify(lemmaOccs)}`);
}
console.log(`  PASS: lookup_lemma_occurrences_v1 returned ${lemmaOccs.occurrences.length} / ${lemmaOccs.totals.total_tokens} occurrences for G3056`);

// 11. Test lookup_lemma_root_relatives_v1
const rootRels = await testPostgrest('/rpc/lookup_lemma_root_relatives_v1', { p_lemma_query: 'G3056' });
if (!rootRels || rootRels.schema_version !== 1 || rootRels.status !== 'ok' || rootRels.modeling_invariants?.shared_root_implies_synonymy !== false) {
  throw new Error(`lookup_lemma_root_relatives_v1 returned unexpected response: ${JSON.stringify(rootRels)}`);
}
console.log(`  PASS: lookup_lemma_root_relatives_v1 returned ${rootRels.root_relatives.length} non-synonymous relatives for G3056`);

// 12. Test lookup_lemma_english_glosses_v1
const lemmaGlosses = await testPostgrest('/rpc/lookup_lemma_english_glosses_v1', { p_lemma_query: 'H7307G', p_limit: 10 });
if (!lemmaGlosses || lemmaGlosses.schema_version !== 1 || lemmaGlosses.status !== 'ok' || !Array.isArray(lemmaGlosses.attested_english_glosses) || lemmaGlosses.attested_english_glosses.length === 0) {
  throw new Error(`lookup_lemma_english_glosses_v1 returned unexpected response: ${JSON.stringify(lemmaGlosses)}`);
}
console.log(`  PASS: lookup_lemma_english_glosses_v1 returned ${lemmaGlosses.lexicon_sense_glosses.length} senses and ${lemmaGlosses.attested_english_glosses.length} attested glosses for H7307G`);

// 13. Test lookup_passage_tokens_syntax_v1
const passageSyntax = await testPostgrest('/rpc/lookup_passage_tokens_syntax_v1', { p_book: 43, p_chapter: 1, p_verse: 1 });
if (!passageSyntax || passageSyntax.schema_version !== 1 || passageSyntax.status !== 'ok' || !Array.isArray(passageSyntax.tokens) || passageSyntax.tokens.length !== 17) {
  throw new Error(`lookup_passage_tokens_syntax_v1 returned unexpected response: ${JSON.stringify(passageSyntax)}`);
}
console.log(`  PASS: lookup_passage_tokens_syntax_v1 returned ${passageSyntax.tokens.length} tokens and ${passageSyntax.syntax_edges.length} syntax edges for John 1:1`);

// 14. Test lookup_concept_properties_v1
const conceptProps = await testPostgrest('/rpc/lookup_concept_properties_v1', { p_concept_query: 'Athens' });
if (!conceptProps || conceptProps.schema_version !== 1 || conceptProps.status !== 'ok' || !Array.isArray(conceptProps.concepts) || conceptProps.concepts.length === 0) {
  throw new Error(`lookup_concept_properties_v1 returned unexpected response: ${JSON.stringify(conceptProps)}`);
}
console.log(`  PASS: lookup_concept_properties_v1 returned ${conceptProps.concepts[0].properties.length} properties for Athens`);

// 15. Test lookup_entity_relationships_v1
const entityRels = await testPostgrest('/rpc/lookup_entity_relationships_v1', { p_entity_query: 'root:G3056' });
if (!entityRels || entityRels.schema_version !== 1 || entityRels.status !== 'ok' || !Array.isArray(entityRels.relationships) || entityRels.relationships.length === 0) {
  throw new Error(`lookup_entity_relationships_v1 returned unexpected response: ${JSON.stringify(entityRels)}`);
}
console.log(`  PASS: lookup_entity_relationships_v1 returned ${entityRels.relationships.length} provenance-tracked edges for root:G3056`);

// 16. Test lookup_hebrew_to_greek_alignments_v1
const hebToGrk = await testPostgrest('/rpc/lookup_hebrew_to_greek_alignments_v1', { p_lemma_query: 'H0430' });
if (!hebToGrk || hebToGrk.schema_version !== 1 || hebToGrk.status !== 'ok' || !Array.isArray(hebToGrk.alignments) || hebToGrk.alignments.length === 0) {
  throw new Error(`lookup_hebrew_to_greek_alignments_v1 returned unexpected response: ${JSON.stringify(hebToGrk)}`);
}
console.log(`  PASS: lookup_hebrew_to_greek_alignments_v1 returned ${hebToGrk.alignments.length} alignments for H0430 (top: ${hebToGrk.alignments[0].greek_script} ${hebToGrk.alignments[0].greek_strong})`);

// 17. Test lookup_greek_to_hebrew_alignments_v1
const grkToHeb = await testPostgrest('/rpc/lookup_greek_to_hebrew_alignments_v1', { p_greek_query: 'G2316' });
if (!grkToHeb || grkToHeb.schema_version !== 1 || grkToHeb.status !== 'ok' || !Array.isArray(grkToHeb.alignments) || grkToHeb.alignments.length === 0) {
  throw new Error(`lookup_greek_to_hebrew_alignments_v1 returned unexpected response: ${JSON.stringify(grkToHeb)}`);
}
console.log(`  PASS: lookup_greek_to_hebrew_alignments_v1 returned ${grkToHeb.alignments.length} alignments for G2316 (top: ${grkToHeb.alignments[0].hebrew_script} ${grkToHeb.alignments[0].hebrew_strong})`);

// 18. Test get_hebrew_septuagint_parallel_v1 (Genesis 1:1 and Psalm 3:0 versification shift)
const parallelGen = await testPostgrest('/rpc/get_hebrew_septuagint_parallel_v1', { p_book: 1, p_chapter: 1, p_verse: 1 });
if (!parallelGen || parallelGen.schema_version !== 1 || parallelGen.status !== 'ok' || parallelGen.masoretic.word_count !== 7 || parallelGen.septuagint.word_count !== 10) {
  throw new Error(`get_hebrew_septuagint_parallel_v1 Gen 1:1 unexpected: ${JSON.stringify(parallelGen)}`);
}
const parallelPsa = await testPostgrest('/rpc/get_hebrew_septuagint_parallel_v1', { p_book: 19, p_chapter: 3, p_verse: 0 });
if (!parallelPsa || parallelPsa.septuagint.chapter !== 3 || parallelPsa.septuagint.verse_nr !== 1 || parallelPsa.septuagint.mapping_kind !== 'versification_shift') {
  throw new Error(`get_hebrew_septuagint_parallel_v1 Psa 3:0 shift unexpected: ${JSON.stringify(parallelPsa)}`);
}
console.log(`  PASS: get_hebrew_septuagint_parallel_v1 verified Genesis 1:1 parallel and Psalm 3:0 title shift -> LXX 3:1`);

// 19. Test lookup_cross_testament_greek_v1
const crossTestament = await testPostgrest('/rpc/lookup_cross_testament_greek_v1', { p_greek_query: 'G2316', p_limit: 5 });
if (!crossTestament || crossTestament.schema_version !== 1 || crossTestament.status !== 'ok' || crossTestament.nt_occurrences.total_count === 0 || crossTestament.lxx_occurrences.total_count === 0) {
  throw new Error(`lookup_cross_testament_greek_v1 unexpected: ${JSON.stringify(crossTestament)}`);
}
console.log(`  PASS: lookup_cross_testament_greek_v1 returned ${crossTestament.nt_occurrences.total_count} NT and ${crossTestament.lxx_occurrences.total_count} LXX occurrences for G2316`);

console.log('\nAll OpenAPI 3.1.0 and PostgREST endpoint checks PASSED!');

