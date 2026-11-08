import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function rpc(name, body = {}) {
  const res = await fetch(`${REST_URL}/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RPC ${name} failed: HTTP ${res.status} - ${text}`);
  }
  return res.json();
}

async function exactCount(tableAndFilter) {
  const sep = tableAndFilter.includes('?') ? '&' : '?';
  const res = await fetch(`${REST_URL}/${tableAndFilter}${sep}select=id&limit=1`, {
    method: 'GET',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Count ${tableAndFilter} failed: HTTP ${res.status} - ${text}`);
  }
  const range = res.headers.get('content-range') || '';
  const totalStr = range.split('/')[1];
  assert(totalStr && totalStr !== '*', `Missing exact content-range for ${tableAndFilter}: ${range}`);
  return Number(totalStr);
}

async function exactCountByColumn(tableAndFilter, pkCol) {
  const sep = tableAndFilter.includes('?') ? '&' : '?';
  const res = await fetch(`${REST_URL}/${tableAndFilter}${sep}select=${pkCol}&limit=1`, {
    method: 'GET',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Count ${tableAndFilter} failed: HTTP ${res.status} - ${text}`);
  }
  const range = res.headers.get('content-range') || '';
  const totalStr = range.split('/')[1];
  assert(totalStr && totalStr !== '*', `Missing exact content-range for ${tableAndFilter}: ${range}`);
  return Number(totalStr);
}

async function selectRows(queryPath) {
  const res = await fetch(`${REST_URL}/${queryPath}`, {
    method: 'GET',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${queryPath} failed: HTTP ${res.status} - ${text}`);
  }
  return res.json();
}

console.log('=== Canonical Biblical Lexical & Evidence Database Verification Suite ===\n');

// ---------------------------------------------------------------------------
// 1. Pinned STEP Source SHA-256 Audit (when offline cache is present)
// ---------------------------------------------------------------------------
const manifestPath = resolve('.artifacts/stepbible/manifest.json');
if (existsSync(manifestPath)) {
  console.log('1. Verifying pinned STEPBible-Data SHA-256 digests...');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.sources) ? manifest.sources : [];
  assert(files.length === 8, `Expected 8 pinned STEP files in manifest.sources, got ${files.length}`);
  let verifiedFiles = 0;
  for (const entry of files) {
    const localCandidate = resolve('.artifacts/stepbible', `${entry.name}.txt`);
    if (existsSync(localCandidate) && entry.sha256) {
      const digest = createHash('sha256').update(readFileSync(localCandidate)).digest('hex');
      assert(digest === entry.sha256, `SHA-256 mismatch on ${localCandidate}`);
      verifiedFiles++;
    }
  }
  assert(verifiedFiles === 8, `Expected all 8 local STEP files hash-checked, got ${verifiedFiles}`);
  console.log(`  PASS: Manifest pinned to commit ${manifest.commit} (${verifiedFiles}/8 STEP source files SHA-256 verified)`);
} else {
  console.log('1. Skipping local .artifacts/stepbible cache hash check (manifest not cached in working tree)');
}

// ---------------------------------------------------------------------------
// 2. Canonical Table Counts & Population Completeness
// ---------------------------------------------------------------------------
console.log('\n2. Verifying canonical table population counts over caller-RLS PostgREST...');
const expectedMinimums = [
  ['source_editions', 'id', 10],
  ['edition_passages', 'id', 62418],
  ['versification_mappings', 'id', 2131],
  ['lemmas', 'id', 22171],
  ['lexeme_identifiers', 'id', 113595],
  ['word_form_lemmas', 'id', 270447],
  ['lexical_roots', 'id', 2637],
  ['lemma_root_links', 'id', 6504],
  ['lexical_senses', 'id', 26179],
  ['token_morphemes', 'id', 2321],
  ['syntax_nodes', 'id', 3425],
  ['syntax_edges', 'id', 4081],
  ['semantic_annotations', 'id', 911],
  ['concept_properties', 'id', 8864],
  ['concept_external_links', 'id', 2119],
  ['relation_types', 'relation_type', 18],
  ['canonical_entities', 'id', 82485],
  ['entity_relationships', 'id', 15259],
];

const integrityReport = await rpc('verify_referential_integrity_v1');
const syntaxReport = await rpc('validate_syntax_tree_integrity_v1');
const auditReport = await rpc('audit_evidence_coverage_v1');
const offloadedCounts = {
  edition_passages: auditReport?.table_counts?.edition_passages ?? 0,
  lexeme_identifiers: auditReport?.table_counts?.lexeme_identifiers ?? 0,
  word_form_lemmas: auditReport?.table_counts?.word_form_lemmas ?? integrityReport?.row_counts?.word_form_lemmas ?? 0,
  token_morphemes: integrityReport?.row_counts?.token_morphemes ?? 0,
  syntax_nodes: syntaxReport?.total_nodes ?? integrityReport?.row_counts?.syntax_nodes ?? 0,
  syntax_edges: syntaxReport?.total_edges ?? integrityReport?.row_counts?.syntax_edges ?? 0,
};

for (const [table, pkCol, minCount] of expectedMinimums) {
  let actual = await exactCountByColumn(table, pkCol);
  if (actual === 0 && offloadedCounts[table]) {
    actual = offloadedCounts[table];
  }
  assert(actual >= minCount, `Table ${table} expected >= ${minCount} rows, got ${actual}`);
  console.log(`  PASS: public.${table} = ${actual.toLocaleString('en-US')} rows`);
}

// ---------------------------------------------------------------------------
// 3. Modeling Invariants (Form != Lemma != Root != Sense != Gloss)
// ---------------------------------------------------------------------------
console.log('\n3. Verifying strict linguistic & epistemic modeling invariants...');

// 3a. Word form != Lemma (Hebrew prefixed surface form decomposition + Greek inflections)
const gen1Word1 = await rpc('lookup_word_to_lemma_senses_v1', { p_word_id: 129386 });
assert(gen1Word1.status === 'ok', 'lookup_word_to_lemma_senses_v1(129386) status != ok');
assert(
  gen1Word1.modeling_invariants?.word_form_is_not_lemma === true &&
    gen1Word1.modeling_invariants?.sense_assignment_policy === 'catalog_only_no_ai_inference',
  'Missing word_form_is_not_lemma / catalog_only_no_ai_inference invariants'
);
const links129386 = gen1Word1.word_forms[0].morpheme_lemma_links;
assert(links129386.length === 2, `Expected 2 morpheme-lemma links on בְּרֵאשִׁית (129386), got ${links129386.length}`);
assert(
  links129386[0].morpheme_role === 'prefix_preposition' && links129386[1].morpheme_role === 'stem',
  `Unexpected morpheme roles on 129386: ${links129386.map(l => l.morpheme_role).join(', ')}`
);
assert(links129386[1].lemma.lemma_key === 'lemma:H7225G', `Expected stem lemma:H7225G, got ${links129386[1].lemma.lemma_key}`);
console.log('  PASS: Invariant [Form != Lemma] — Hebrew בְּרֵאשִׁית (word_id 129386) decomposes into prefix_preposition + stem lemma:H7225G');

// Cantillation-insensitive script lookup fallback
const scriptLookup = await rpc('lookup_word_to_lemma_senses_v1', { p_query: 'בְּרֵאשִׁית' });
assert(scriptLookup.status === 'ok' && scriptLookup.word_forms.length >= 1, 'Cantillation-stripped Hebrew lookup failed');
console.log(`  PASS: Cantillation-stripped Hebrew query matched ${scriptLookup.word_forms.length} Masoretic surface form(s)`);

// 3b. Lemma -> Occurrences across distinct inflected forms + keyset cursor pagination
const logosPage1 = await rpc('lookup_lemma_occurrences_v1', {
  p_lemma_query: 'G3056',
  p_after_verse_id: 0,
  p_limit: 5,
});
assert(logosPage1.status === 'ok', 'lookup_lemma_occurrences_v1(G3056) failed');
assert(logosPage1.totals.total_tokens === 330, `Expected 330 total tokens for G3056, got ${logosPage1.totals.total_tokens}`);
assert(
  logosPage1.totals.distinct_inflected_forms > 5,
  `Expected multiple inflected Greek forms for G3056, got ${logosPage1.totals.distinct_inflected_forms}`
);
assert(logosPage1.pagination.next_after_verse_id !== null, 'Expected non-null next_after_verse_id on page 1');

const logosPage2 = await rpc('lookup_lemma_occurrences_v1', {
  p_lemma_query: 'G3056',
  p_after_verse_id: logosPage1.pagination.next_after_verse_id,
  p_limit: 5,
});
assert(logosPage2.status === 'ok' && logosPage2.occurrences.length === 5, 'Page 2 of G3056 occurrences failed');
const maxPage1VerseId = Math.max(...logosPage1.occurrences.map(o => o.verse_id));
const minPage2VerseId = Math.min(...logosPage2.occurrences.map(o => o.verse_id));
assert(minPage2VerseId > maxPage1VerseId, `Keyset pagination overlap: ${minPage2VerseId} <= ${maxPage1VerseId}`);
console.log(
  `  PASS: Lemma G3056 aggregates ${logosPage1.totals.distinct_inflected_forms} inflected forms across 330 tokens with gap-free keyset pagination`
);

// 3c. Homograph preservation (H1254a/b/c and H5869a/b never merged by AI)
const baraHomographs = await rpc('lookup_lemma_occurrences_v1', { p_lemma_query: 'H1254', p_limit: 5 });
assert(
  baraHomographs.status === 'ok' && baraHomographs.homograph_or_query_candidates.length >= 3,
  `Expected >= 3 homograph candidates for H1254, got ${baraHomographs.homograph_or_query_candidates?.length}`
);
const ayinHomographs = await rpc('lookup_lemma_occurrences_v1', { p_lemma_query: 'H5869', p_limit: 5 });
assert(
  ayinHomographs.status === 'ok' && ayinHomographs.homograph_or_query_candidates.length >= 2,
  `Expected >= 2 homograph candidates for H5869, got ${ayinHomographs.homograph_or_query_candidates?.length}`
);
console.log(
  `  PASS: Homograph preservation — H1254 (${baraHomographs.homograph_or_query_candidates.length} lemmas) & H5869 (${ayinHomographs.homograph_or_query_candidates.length} lemmas) kept distinct`
);

// 3d. Lemma != Root, Root != Meaning, Shared Root never implies synonymy
const rootSample = await selectRows('lexical_roots?limit=1');
assert(rootSample.length === 1, 'Expected sample row from lexical_roots');
for (const forbiddenKey of ['meaning', 'gloss', 'definition', 'primary_gloss', 'biblical_def']) {
  assert(!(forbiddenKey in rootSample[0]), `Forbidden meaning column "${forbiddenKey}" found on lexical_roots`);
}
const synonymousRootLinks = await exactCount('lemma_root_links?implies_synonymy=eq.true');
assert(synonymousRootLinks === 0, `Expected 0 synonymous root links, got ${synonymousRootLinks}`);
const synonymousEtymTypes = await exactCountByColumn(
  'relation_types?category=eq.etymological&implies_synonymy=eq.true',
  'relation_type'
);
assert(synonymousEtymTypes === 0, `Expected 0 synonymous etymological relation_types, got ${synonymousEtymTypes}`);

const elohimRoots = await rpc('lookup_lemma_root_relatives_v1', { p_lemma_query: 'H0430G' });
assert(elohimRoots.status === 'ok' && elohimRoots.root_relatives.length >= 20, 'Expected >= 20 root relatives for H0430G');
assert(
  elohimRoots.modeling_invariants?.lemma_is_not_necessarily_root === true &&
    elohimRoots.modeling_invariants?.root_is_not_a_meaning === true &&
    elohimRoots.modeling_invariants?.shared_root_implies_synonymy === false,
  'Missing root modeling_invariants on lookup_lemma_root_relatives_v1'
);
assert(
  elohimRoots.root_relatives.every(r => r.implies_synonymy === false),
  'Found root relative with implies_synonymy !== false'
);
console.log(
  `  PASS: Invariant [Lemma != Root != Meaning & Shared Root != Synonymy] — 0 meaning columns on lexical_roots, 0 synonymous root links, ${elohimRoots.root_relatives.length} non-synonymous relatives for H0430G`
);

// 3e. Sense != English Translation & Translation != Word-for-Word Alignment
const ruachGlosses = await rpc('lookup_lemma_english_glosses_v1', { p_lemma_query: 'H7307G', p_limit: 15 });
assert(ruachGlosses.status === 'ok', 'lookup_lemma_english_glosses_v1(H7307G) failed');
assert(
  ruachGlosses.modeling_invariants?.lexical_sense_is_not_english_translation === true &&
    ruachGlosses.modeling_invariants?.translation_is_not_word_for_word_alignment === true,
  'Missing sense vs translation invariants'
);
assert(
  Array.isArray(ruachGlosses.lexicon_sense_glosses) &&
    ruachGlosses.lexicon_sense_glosses.length > 0 &&
    Array.isArray(ruachGlosses.attested_english_glosses) &&
    ruachGlosses.attested_english_glosses.length > 0,
  'Expected separated lexicon_sense_glosses and attested_english_glosses'
);
console.log(
  `  PASS: Invariant [Sense != English Rendering] — H7307G separates ${ruachGlosses.lexicon_sense_glosses.length} lexicon senses from ${ruachGlosses.attested_english_glosses.length} attested renderings`
);

// 3f. Passage -> Versification Mappings, Morphemes, Syntax Graph & Semantic Annotations
const psalm3Superscription = await rpc('lookup_passage_tokens_syntax_v1', { p_book: 19, p_chapter: 3, p_verse: 0 });
assert(
  psalm3Superscription.status === 'ok' && psalm3Superscription.versification_mappings.length >= 1,
  'Expected Masoretic versification mapping on Psalm 3:0'
);
const john1v1Syntax = await rpc('lookup_passage_tokens_syntax_v1', { p_book: 43, p_chapter: 1, p_verse: 1 });
assert(
  john1v1Syntax.status === 'ok' &&
    john1v1Syntax.tokens.length === 17 &&
    john1v1Syntax.syntax_edges.length >= 4 &&
    john1v1Syntax.english_editions.every(e => typeof e.alignment_note === 'string' && e.alignment_note.length > 10),
  'John 1:1 passage syntax / alignment_note check failed'
);
const rev4v5Syntax = await rpc('lookup_passage_tokens_syntax_v1', { p_book: 66, p_chapter: 4, p_verse: 5 });
assert(
  rev4v5Syntax.status === 'ok' && rev4v5Syntax.syntax_nodes.length >= 5,
  'Expected syntax_nodes on Revelation 4:5'
);
console.log(
  `  PASS: Passage lookup — Psalm 3:0 versification shift, John 1:1 (${john1v1Syntax.syntax_edges.length} syntax edges + alignment guard), Rev 4:5 (${rev4v5Syntax.syntax_nodes.length} syntax nodes)`
);

// 3g. External Concept Properties & Epistemic Separation
const athensConcept = await rpc('lookup_concept_properties_v1', { p_concept_query: 'Athens' });
assert(
  athensConcept.status === 'ok' &&
    athensConcept.modeling_invariants?.external_observation_is_not_biblical_interpretation === true &&
    athensConcept.concepts[0].properties.some(p => p.epistemic_layer === 'external_factual'),
  'Athens external factual concept check failed'
);
console.log(
  `  PASS: Invariant [External Observation != Biblical Interpretation] — Athens exposes ${athensConcept.concepts[0].properties.length} external_factual properties and ${athensConcept.concepts[0].external_links.length} authority links`
);

// ---------------------------------------------------------------------------
// 4. Provenance Completeness & Licensing Compliance
// ---------------------------------------------------------------------------
console.log('\n4. Verifying provenance completeness & STEP TBESH licensing compliance...');

const missingRelProv = await exactCount(
  'entity_relationships?or=(source_release_id.is.null,source_record_id.is.null,origin_mode.is.null,derivation_method.is.null)'
);
assert(missingRelProv === 0, `Found ${missingRelProv} entity_relationships missing provenance`);

const missingSenseProv = await exactCount(
  'lexical_senses?or=(source_release_id.is.null,source_edition_id.is.null,source_record_id.is.null,source_attribution.is.null)'
);
assert(missingSenseProv === 0, `Found ${missingSenseProv} lexical_senses missing provenance`);

const missingWordLemmaProv = await exactCount(
  'word_form_lemmas?or=(lemma_id.is.null,source_release_id.is.null,source_record_id.is.null,origin_mode.is.null)'
);
assert(missingWordLemmaProv === 0, `Found ${missingWordLemmaProv} word_form_lemmas missing lemma_id or provenance`);

// Verify Hebrew TBESH senses explicitly exclude Online Bible Meaning
const hebrewSenseSample = await selectRows('lexical_senses?sense_key=like.sense:H*&limit=10');
assert(
  hebrewSenseSample.length === 10 &&
    hebrewSenseSample.every(s => s.source_attribution.includes('Online Bible Meaning excluded')),
  'Hebrew TBESH lexical_senses must record Online Bible Meaning exclusion'
);

// Verify entity relationship lookup across lemma, root, passage, and concept alias
for (const [query, minEdges] of [
  ['lemma:G3056', 1],
  ['root:G3056', 6],
  ['passage:PSA.3.0', 1],
  ['concept:menorah', 2],
]) {
  const relPacket = await rpc('lookup_entity_relationships_v1', { p_entity_query: query });
  assert(
    relPacket.status === 'ok' && relPacket.relationships.length >= minEdges,
    `Expected >= ${minEdges} relationships for ${query}, got ${relPacket.relationships?.length}`
  );
  for (const r of relPacket.relationships) {
    assert(
      r.source_release_key && r.source_commit_sha && r.source_license && r.source_record_id && r.origin_mode && r.derivation_method,
      `Incomplete provenance on relationship ${r.relationship_key}`
    );
  }
}
console.log('  PASS: 100% provenance verified on entity_relationships, lexical_senses, and word_form_lemmas; TBESH Online Bible Meaning excluded');

// ---------------------------------------------------------------------------
// 5. RLS & Privilege Write-Denial Checks (Anonymous Client)
// ---------------------------------------------------------------------------
console.log('\n5. Verifying anonymous write denial & SECURITY DEFINER lockdown...');

for (const table of ['lemmas', 'lexical_senses', 'word_form_lemmas', 'entity_relationships']) {
  const postRes = await fetch(`${REST_URL}/${table}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  assert(postRes.status === 401 || postRes.status === 403, `Expected 401/403 on anon INSERT into ${table}, got ${postRes.status}`);

  const deleteRes = await fetch(`${REST_URL}/${table}?id=eq.1`, {
    method: 'DELETE',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });
  assert(
    deleteRes.status === 401 || deleteRes.status === 403,
    `Expected 401/403 on anon DELETE from ${table}, got ${deleteRes.status}`
  );
}

const ingestAttempt = await fetch(`${REST_URL}/rpc/ingest_lexemes_batch_v1`, {
  method: 'POST',
  headers: {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ p_rows: [] }),
});
assert(
  ingestAttempt.status === 401 || ingestAttempt.status === 403 || ingestAttempt.status === 404,
  `Expected anon execution of ingest_lexemes_batch_v1 to be denied, got HTTP ${ingestAttempt.status}`
);
console.log('  PASS: Anonymous INSERT/DELETE denied on canonical tables & ingest_lexemes_batch_v1 locked down');

console.log('\nALL CANONICAL LEXICAL & EVIDENCE DATABASE CHECKS PASSED!');
