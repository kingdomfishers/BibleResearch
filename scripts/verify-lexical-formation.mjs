// @file: scripts/verify-lexical-formation.mjs
// Automated verification suite for the Lexical Formation Data Infrastructure.
// Validates:
// 1. H7501 -> H7495 + H410 (theophoric compound formation)
// 2. H120 -> H127 and H1818 with appropriate epistemic distinction
// 3. Multiple lemmas sharing one Strong's number (homograph handling)
// 4. Hebrew final-letter orthographic normalization
// 5. Greek words and Greek final sigma normalization
// 6. Missing or conflicting source data & quarantine behavior
// 7. Repeated imports remain idempotent

import fs from 'node:fs/promises';

const env = Object.fromEntries(
  (await fs.readFile('.env', 'utf8'))
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    })
);
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY) {
  throw new Error('Missing Supabase credentials in .env');
}

async function callRpc(name, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`RPC ${name} failed (${res.status}): ${errText}`);
  }
  return await res.json();
}

async function queryTable(table, queryParams) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Query ${table} failed (${res.status}): ${errText}`);
  }
  return await res.json();
}

let passed = 0;
let failed = 0;

function report(testName, ok, details = '') {
  if (ok) {
    passed++;
    console.log(`  [PASS] ${testName}${details ? ` -> ${details}` : ''}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
  }
}

console.log('='.repeat(75));
console.log('LEXICAL FORMATION DATA INFRASTRUCTURE - COMPREHENSIVE VERIFICATION SUITE');
console.log('='.repeat(75) + '\n');

// ---------------------------------------------------------------------------
// TEST 1: H7501 -> H7495 + H410
// ---------------------------------------------------------------------------
console.log('Test Suite 1: Theophoric Compound Formation (H7501 -> H7495 + H410)');
try {
  const data = await callRpc('word_formation_research_rpc_v1', { p_query: 'H7501' });
  report('Status is OK', data.status === 'ok', `status=${data.status}`);

  const matched = (data.matched_lemmas || [])[0];
  report('Source lemma is H7501', matched?.base_strongs === 'H7501', `strongs=${matched?.base_strongs}`);

  const formations = data.lexical_formations || [];
  report('Formations found for H7501', formations.length > 0, `count=${formations.length}`);

  const f = formations.find(item => item.components && item.components.length === 2) || formations[0];
  report('Formation is theophoric or compound name', /theophoric|compound/i.test(f?.formation_type || ''), `formation_type=${f?.formation_type}`);
  report('Evidence status is documented', f?.evidence_status === 'documented', `status=${f?.evidence_status}`);
  report('Origin mode is sourced', f?.origin_mode === 'sourced', `origin_mode=${f?.origin_mode}`);

  const components = f?.components || [];
  report('Has exactly 2 components', components.length === 2, `count=${components.length}`);

  const comp1 = components.find(c => c.order === 1);
  const comp2 = components.find(c => c.order === 2);
  report('Component 1 is H7495 (to heal)', comp1?.base_strongs === 'H7495' && /heal|cure/i.test(comp1?.primary_gloss || ''), `strongs=${comp1?.base_strongs}, gloss=${comp1?.primary_gloss}`);
  report('Component 2 is H410 (God)', comp2?.base_strongs === 'H410' && /God/i.test(comp2?.primary_gloss || ''), `strongs=${comp2?.base_strongs}, gloss=${comp2?.primary_gloss}`);
} catch (err) {
  report('Suite 1 Execution', false, err.message);
}

// ---------------------------------------------------------------------------
// TEST 2: H120 -> H127 and H1818 with Appropriate Distinction
// ---------------------------------------------------------------------------
console.log('\nTest Suite 2: H120 -> H127 (Wordplay) vs H1818 (Orthographic Overlap)');
try {
  const data120 = await callRpc('word_formation_research_rpc_v1', { p_query: 'H120' });
  report('Status is OK for H120', data120.status === 'ok');

  // Verify literary connection between H120 and H127
  const conns = data120.other_connections || [];
  const conn127 = conns.find(c => c.target_strongs === 'H127' || c.source_strongs === 'H127');
  report(
    'H120 <-> H127 literary_wordplay connection exists',
    conn127?.relation_type === 'literary_wordplay',
    `relation_type=${conn127?.relation_type}, note=${conn127?.evidence_note}`
  );

  // Verify orthographic candidate overlap with H1818 (min_chars: 2)
  const cands = await callRpc('suggest_orthographic_candidates_v1', {
    p_query: 'H120',
    p_limit: 10,
    p_min_chars: 2
  });
  const cand1818 = (cands.candidate_connections || []).find(c => c.candidate_strongs === 'H1818');
  report(
    'H1818 discovered as consonantal candidate',
    !!cand1818 && cand1818.overlap_chars === 2,
    `overlap=${cand1818?.overlap_chars} chars (${cand1818?.overlap_position})`
  );
  report(
    'H1818 candidate remains unverified_candidate',
    cand1818?.evidence_status === 'unverified_candidate',
    `status=${cand1818?.evidence_status}`
  );
  report(
    'H1818 candidate asserts NO etymological inference',
    cand1818?.etymological_inference === false,
    `etymological_inference=${cand1818?.etymological_inference}`
  );

  // Verify reverse query: H1818 finds H120 as unverified candidate without synthetic etymology
  const cands1818 = await callRpc('suggest_orthographic_candidates_v1', {
    p_query: 'H1818',
    p_limit: 10,
    p_min_chars: 2
  });
  const cand120 = (cands1818.candidate_connections || []).find(c => c.candidate_strongs === 'H120');
  report(
    'H1818 -> H120 is unverified candidate with etymological_inference = false',
    cand120?.evidence_status === 'unverified_candidate' && cand120?.etymological_inference === false,
    `status=${cand120?.evidence_status}, etymology=${cand120?.etymological_inference}`
  );
} catch (err) {
  report('Suite 2 Execution', false, err.message);
}

// ---------------------------------------------------------------------------
// TEST 3: Multiple Lemmas Sharing One Strong's Number (Homographs)
// ---------------------------------------------------------------------------
console.log('\nTest Suite 3: Homograph Preservation & Disambiguation');
try {
  const data120 = await callRpc('word_formation_research_rpc_v1', { p_query: 'H120' });
  report(
    'H120 indicates homograph ambiguity flag',
    data120.needs_disambiguation === true,
    `needs_disambiguation=${data120.needs_disambiguation}`
  );
  report(
    'H120 lists all homograph lemma keys (H0120G, H0120H)',
    (data120.matched_lemmas || []).length >= 2,
    `matched_lemmas=${data120.matched_lemmas?.map(l => l.lemma_key).join(', ')}`
  );

  // Test H1254 (bara) homographs
  const data1254 = await callRpc('word_formation_research_rpc_v1', { p_query: 'H1254' });
  report(
    'H1254 indicates homograph ambiguity flag',
    data1254.needs_disambiguation === true,
    `needs_disambiguation=${data1254.needs_disambiguation}`
  );
  report(
    'H1254 lists distinct homographs',
    (data1254.matched_lemmas || []).length >= 2,
    `matched_lemmas=${data1254.matched_lemmas?.map(l => l.lemma_key).join(', ')}`
  );

  // Verify quarantined homograph mappings
  const quarantined = await queryTable('quarantined_evidence_records', {
    quarantine_reason: 'eq.ambiguous_homograph_host_mapping',
    select: 'id,dataset_key,source_record_id,quarantine_status',
    limit: '5'
  });
  report(
    'Quarantined evidence preserves unresolved homographs without merging',
    quarantined.length > 0 && quarantined[0].quarantine_status === 'unresolved',
    `sample_count=${quarantined.length}, sample_record=${quarantined[0]?.source_record_id}`
  );
} catch (err) {
  report('Suite 3 Execution', false, err.message);
}

// ---------------------------------------------------------------------------
// TEST 4: Hebrew Final-Letter Orthographic Normalization
// ---------------------------------------------------------------------------
console.log('\nTest Suite 4: Hebrew Final-Letter Normalization (ךםןףץ -> כמנפצ)');
try {
  // Query with final-letter spelling vs medial-letter spelling
  const resFinal = await callRpc('suggest_orthographic_candidates_v1', {
    p_query: 'שלם',
    p_limit: 5,
    p_min_chars: 3
  });
  const resMedial = await callRpc('suggest_orthographic_candidates_v1', {
    p_query: 'שלמ',
    p_limit: 5,
    p_min_chars: 3
  });

  report('Query with final mem (שלם) returns ok', resFinal.status === 'ok');
  report('Query with medial mem (שלמ) returns ok', resMedial.status === 'ok');

  const finalStrs = (resFinal.candidate_connections || []).map(c => c.candidate_strongs);
  const medialStrs = (resMedial.candidate_connections || []).map(c => c.candidate_strongs);

  report(
    'Final mem and medial mem yield identical normalized candidate sets',
    finalStrs.length > 0 && JSON.stringify(finalStrs) === JSON.stringify(medialStrs),
    `final=[${finalStrs.join(',')}], medial=[${medialStrs.join(',')}]`
  );

  // Test final nun (ן) vs medial nun (נ)
  const resNunFinal = await callRpc('suggest_orthographic_candidates_v1', {
    p_query: 'חן',
    p_limit: 5,
    p_min_chars: 2
  });
  const resNunMedial = await callRpc('suggest_orthographic_candidates_v1', {
    p_query: 'חנ',
    p_limit: 5,
    p_min_chars: 2
  });
  const nunFinalStrs = (resNunFinal.candidate_connections || []).map(c => c.candidate_strongs);
  const nunMedialStrs = (resNunMedial.candidate_connections || []).map(c => c.candidate_strongs);
  report(
    'Final nun and medial nun yield identical candidate sets',
    nunFinalStrs.length > 0 && JSON.stringify(nunFinalStrs) === JSON.stringify(nunMedialStrs),
    `count=${nunFinalStrs.length}`
  );
} catch (err) {
  report('Suite 4 Execution', false, err.message);
}

// ---------------------------------------------------------------------------
// TEST 5: Greek Words & Greek Final Sigma Normalization
// ---------------------------------------------------------------------------
console.log('\nTest Suite 5: Greek Words & Greek Final Sigma Normalization (ς -> σ)');
try {
  // G130 compound: αἱματεκχυσία
  const dataG130 = await callRpc('word_formation_research_rpc_v1', { p_query: 'G130' });
  report('G130 query returns ok', dataG130.status === 'ok');
  const fG130 = (dataG130.lexical_formations || [])[0];
  report(
    'G130 formation exists with components',
    fG130 && fG130.components?.length >= 2,
    `components=${fG130?.components?.map(c => c.base_strongs).join(' + ')}`
  );

  // G3056 (logos) candidate suggestions
  const resLogosSigma = await callRpc('suggest_orthographic_candidates_v1', {
    p_query: 'λογος', // with final sigma ς
    p_limit: 5,
    p_min_chars: 4
  });
  const resLogosMedial = await callRpc('suggest_orthographic_candidates_v1', {
    p_query: 'λογοσ', // with medial sigma σ
    p_limit: 5,
    p_min_chars: 4
  });

  report('Greek query with final sigma (λογος) returns ok', resLogosSigma.status === 'ok');
  report('Greek query with medial sigma (λογοσ) returns ok', resLogosMedial.status === 'ok');

  const gFinalStrs = (resLogosSigma.candidate_connections || []).map(c => c.candidate_strongs);
  const gMedialStrs = (resLogosMedial.candidate_connections || []).map(c => c.candidate_strongs);
  report(
    'Greek final sigma (ς) and medial sigma (σ) yield identical candidate sets',
    gFinalStrs.length > 0 && JSON.stringify(gFinalStrs) === JSON.stringify(gMedialStrs),
    `candidates=[${gFinalStrs.join(',')}]`
  );

  // Verify language isolation (Greek query returns zero Hebrew words)
  const nonGreek = (resLogosSigma.candidate_connections || []).filter(c => !c.candidate_strongs.startsWith('G'));
  report('Greek query returns ONLY Greek candidates (no cross-language pollution)', nonGreek.length === 0, `nonGreek=${nonGreek.length}`);
} catch (err) {
  report('Suite 5 Execution', false, err.message);
}

// ---------------------------------------------------------------------------
// TEST 6: Missing or Conflicting Source Data & Quarantine
// ---------------------------------------------------------------------------
console.log('\nTest Suite 6: Missing / Conflicting Source Data & Quarantine Integrity');
try {
  // Nonexistent Strong's number
  const dataNotFound = await callRpc('word_formation_research_rpc_v1', { p_query: 'H99999' });
  report(
    'Nonexistent Strong number returns status=not_found',
    dataNotFound.status === 'not_found',
    `status=${dataNotFound.status}`
  );

  // Invalid query (empty string)
  const dataInvalid = await callRpc('word_formation_research_rpc_v1', { p_query: '   ' });
  report(
    'Whitespace query returns status=invalid_request',
    dataInvalid.status === 'invalid_request',
    `status=${dataInvalid.status}`
  );

  // Verify quarantined table status
  const quarantinedRecords = await queryTable('quarantined_evidence_records', {
    quarantine_status: 'eq.unresolved',
    select: 'quarantine_reason,quarantine_status,dataset_key',
    limit: '10'
  });
  report(
    'Quarantined records are safely preserved in unresolved status',
    quarantinedRecords.length > 0 && quarantinedRecords.every(r => r.quarantine_status === 'unresolved'),
    `count=${quarantinedRecords.length}`
  );
} catch (err) {
  report('Suite 6 Execution', false, err.message);
}

// ---------------------------------------------------------------------------
// TEST 7: Repeated Imports Remain Idempotent
// ---------------------------------------------------------------------------
console.log('\nTest Suite 7: Idempotency of Repeated Imports');
try {
  const formationsBefore = await queryTable('lexical_formations', { select: 'id' });
  const componentsBefore = await queryTable('lemma_components', { select: 'id' });
  const quarantinedBefore = await queryTable('quarantined_evidence_records', { select: 'id' });

  // Re-run batch ingestion of a known formation with source_strongs
  const sampleFormation = [{
    source_strongs: 'H7501',
    analysis_key: 'strongs-h7501-name-formation',
    formation_type: 'theophoric_name',
    whole_word_gloss: 'God has healed / God heals',
    evidence_note: "Strong's H7501 explicitly identifies components: H7495 and H410",
    source_title: "Strong's Exhaustive Concordance: H7501",
    source_url: 'https://biblehub.com/strongs/hebrew/7501.htm',
    source_record_id: 'H7501',
    origin_mode: 'sourced',
    components: [
      { order: 1, component_strongs: 'H7495', surface_text: 'רפא', role: 'verbal_element', semantic_contribution: 'heal' },
      { order: 2, component_strongs: 'H410', surface_text: 'אל', role: 'divine_name_element', semantic_contribution: 'God' }
    ]
  }];
  const ingestResult = await callRpc('ingest_lexical_formations_batch_v1', {
    p_formations: sampleFormation
  });
  report('Re-ingestion of existing formation returns 0 new formations', ingestResult.formations_inserted === 0, `inserted=${ingestResult.formations_inserted}`);

  const formationsAfter = await queryTable('lexical_formations', { select: 'id' });
  const componentsAfter = await queryTable('lemma_components', { select: 'id' });
  const quarantinedAfter = await queryTable('quarantined_evidence_records', { select: 'id' });

  report('Formation row count is unchanged', formationsBefore.length === formationsAfter.length, `count=${formationsAfter.length}`);
  report('Component row count is unchanged', componentsBefore.length === componentsAfter.length, `count=${componentsAfter.length}`);
  report('Quarantined row count is unchanged', quarantinedBefore.length === quarantinedAfter.length, `count=${quarantinedAfter.length}`);
} catch (err) {
  report('Suite 7 Execution', false, err.message);
}

console.log('\n' + '='.repeat(75));
console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
console.log('='.repeat(75));

if (failed > 0) {
  process.exit(1);
}
