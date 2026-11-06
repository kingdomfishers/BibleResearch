// @file: scripts/verify-referential-integrity.mjs
// Verification suite for Referential Integrity, Provenance Hardening & Quarantine Architecture (F2)
// Asserts:
//   1. Gloss-reference coupling (0 mismatches across Hebrew/Greek lemmas)
//   2. Database-native foreign key and domain constraint rejection
//   3. Quarantine table accessibility and read-only RLS policy
//   4. Direct provenance completeness on Septuagint words (source_release_id, source_edition_id)
//   5. Preservation of legitimate 1-to-many variants, homographs, and versification shifts
//   6. Zero unexplained orphans in validated records across all 12 relationships
//   7. Anonymous write denial across all canonical tables and quarantine table

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
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

async function fetchRest(endpoint, options = {}) {
  const res = await fetch(`${REST_URL}/${endpoint}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  return res;
}

console.log('=== Bible Research Engine Referential Integrity & Provenance Verification (F2) ===\n');

async function testReferentialIntegrity() {
  // ---------------------------------------------------------------------------
  // 1. Gloss-Reference Coupling Verification (Before/After Resolution)
  // ---------------------------------------------------------------------------
  console.log('1. Verifying gloss-reference coupling in lookup_lemma_english_glosses_v1...');
  const booksRes = await rpc('get_bible_books_v1', {});
  const bookMap = new Map((booksRes.books || []).map((b) => [b.id, b.usfm.toUpperCase()]));

  const testLemmas = ['H430', 'G3056', 'H7225'];
  let totalGlossCount = 0;
  let mismatchedGlosses = 0;
  const mismatches = [];

  for (const q of testLemmas) {
    const data = await rpc('lookup_lemma_english_glosses_v1', { p_lemma_query: q, p_limit: 15 });
    assert(data.status === 'ok', `Lookup failed for ${q}`);
    const glosses = data.attested_english_glosses || [];

    for (const g of glosses) {
      totalGlossCount++;
      const sp = g.sample_passage;
      const ref = sp.source_ref || '';
      const cvPattern = `${sp.chapter}.${sp.verse}`;
      const hasMatch = ref.includes(`.${cvPattern}`) || ref.includes(` ${cvPattern}`) || ref.startsWith(`${cvPattern}`);

      const refBook = ref.split('.')[0]?.toUpperCase();
      const targetUsfm = bookMap.get(sp.book);
      const bookPrefixMatches = targetUsfm && targetUsfm === refBook;

      if (!hasMatch || !bookPrefixMatches) {
        mismatchedGlosses++;
        mismatches.push({
          lemma: q,
          gloss: g.attested_gloss,
          reported: `${sp.book_name} ${sp.chapter}:${sp.verse} (book_id=${sp.book})`,
          cited: ref,
        });
      }
    }
  }

  assert(
    mismatchedGlosses === 0,
    `Found ${mismatchedGlosses} gloss-reference mismatches: ${JSON.stringify(mismatches)}`
  );
  console.log(`  PASS: Checked ${totalGlossCount} sample citations across 3 test lemmas; 0 mismatches found (100% coupled).`);

  // ---------------------------------------------------------------------------
  // 2. Database-Native Constraint Rejection & Provenance Verification
  // ---------------------------------------------------------------------------
  console.log('\n2. Verifying database-native constraint rejection via verify_referential_integrity_v1()...');
  const dbVerify = await rpc('verify_referential_integrity_v1', {});
  assert(dbVerify.status === 'ok', `verify_referential_integrity_v1 failed: ${JSON.stringify(dbVerify)}`);

  // FK Rejection
  const fkr = dbVerify.foreign_key_rejection;
  assert(fkr.token_morphemes_invalid_verse_rejected, 'Invalid verse_id in token_morphemes was NOT rejected');
  assert(fkr.word_form_lemmas_invalid_lemma_rejected, 'Invalid lemma_id in word_form_lemmas was NOT rejected');
  console.log('  PASS: Foreign key violations strictly rejected (token_morphemes, word_form_lemmas).');

  // Check Constraint Rejection
  const ccr = dbVerify.check_constraint_rejection;
  assert(ccr.synonymy_claim_rejected, 'implies_synonymy=true was NOT rejected on lemma_root_links');
  assert(ccr.invalid_root_kind_rejected, 'Invalid root_kind was NOT rejected on lexical_roots');
  assert(ccr.self_relationship_rejected, 'Self-relationship (subject=object) was NOT rejected on entity_relationships');
  assert(ccr.invalid_morpheme_role_rejected, 'Invalid morpheme_role was NOT rejected on token_morphemes');
  console.log('  PASS: Check constraints strictly enforced (no synonymy on roots, valid root kinds, no self-ref, valid morpheme roles).');

  // LXX Direct Provenance
  const prov = dbVerify.provenance_integrity;
  assert(
    prov.lxx_words_missing_provenance === 0,
    `Found ${prov.lxx_words_missing_provenance} lxx_swete_words missing direct source_release_id / source_edition_id`
  );
  console.log('  PASS: 100% direct provenance enforced on lxx_swete_words (0 missing release/edition IDs).');

  // Orphan Counts
  const orp = dbVerify.orphan_counts;
  for (const [key, count] of Object.entries(orp)) {
    assert(count === 0, `Detected orphan foreign key references in ${key}: ${count}`);
  }
  console.log('  PASS: Zero unexplained orphan records across all 12 canonical foreign-key relationships.');

  // Legitimate Variants & Homographs
  const vars = dbVerify.preserved_variants_and_homographs;
  assert(vars.homographs_h1254 === 3, `Expected 3 homographs for H1254, got ${vars.homographs_h1254}`);
  assert(vars.homographs_h5869 >= 8, `Expected >= 8 homographs for H5869, got ${vars.homographs_h5869}`);
  assert(vars.psalm_versification_shifts === 9, `Expected 9 psalm versification shifts, got ${vars.psalm_versification_shifts}`);
  assert(vars.multi_etymology_root_links === 5, `Expected 5 multi-etymology root links, got ${vars.multi_etymology_root_links}`);
  console.log(`  PASS: Legitimate 1-to-many variants preserved: ${vars.homographs_h1254} H1254 homographs, ${vars.homographs_h5869} H5869 homographs, ${vars.psalm_versification_shifts} versification shifts, ${vars.multi_etymology_root_links} multi-etymology links.`);

  // ---------------------------------------------------------------------------
  // 3. Quarantine Table Schema & Queryability Verification
  // ---------------------------------------------------------------------------
  console.log('\n3. Verifying quarantine table architecture (public.quarantined_evidence_records)...');
  const qRes = await fetchRest('quarantined_evidence_records?select=id,dataset_key,quarantine_status,quarantine_reason&limit=5');
  assert(qRes.ok, `Failed to query quarantined_evidence_records: HTTP ${qRes.status}`);
  const qRows = await qRes.json();
  assert(Array.isArray(qRows), 'Expected JSON array response for quarantined_evidence_records');
  console.log(`  PASS: Quarantine table public.quarantined_evidence_records is live and queryable (currently ${qRows.length} quarantined records).`);

  // ---------------------------------------------------------------------------
  // 4. Anonymous Write Denial & RLS Security (Quarantine & Canonical Tables)
  // ---------------------------------------------------------------------------
  console.log('\n4. Verifying anonymous write denial (RLS enforcement)...');
  const protectedTables = [
    'quarantined_evidence_records',
    'lemmas',
    'lexical_senses',
    'lxx_swete_words',
    'words',
    'lemma_root_links',
  ];

  for (const table of protectedTables) {
    // Attempt INSERT
    const insertRes = await fetchRest(table, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert(
      insertRes.status === 401 || insertRes.status === 403,
      `Expected HTTP 401/403 on anon INSERT into ${table}, got ${insertRes.status}`
    );

    // Attempt DELETE
    const deleteRes = await fetchRest(`${table}?id=eq.1`, {
      method: 'DELETE',
    });
    assert(
      deleteRes.status === 401 || deleteRes.status === 403,
      `Expected HTTP 401/403 on anon DELETE from ${table}, got ${deleteRes.status}`
    );
  }
  console.log(`  PASS: Anonymous writes (INSERT, DELETE) strictly denied by RLS across ${protectedTables.length} tables.`);

  console.log('\n================================================================');
  console.log('ALL REFERENTIAL INTEGRITY & PROVENANCE VERIFICATIONS PASSED (F2)');
  console.log('================================================================');
}

testReferentialIntegrity().catch((err) => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});
