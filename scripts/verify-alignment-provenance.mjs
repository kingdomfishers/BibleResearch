import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

if (!ANON_KEY) {
  console.error('Missing VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

async function queryTable(endpoint) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    method: 'GET',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function rpcAnon(name, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runTests() {
  console.log('=== VERIFYING ALIGNMENT EVIDENCE & PROVENANCE (CORR-04) ===\n');
  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passCount++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failCount++;
    }
  }

  // 1. Audit hebrew_lxx_word_alignments
  {
    const { data: alignments } = await queryTable('hebrew_lxx_word_alignments?select=*&order=id.asc');
    assert(Array.isArray(alignments) && alignments.length >= 9, 'Loaded word alignment records');

    // Records 1-6 (Gen 1:1 and Isa 53:7) must be editorial_reference_collation, NOT Clear-Bible/macula-hebrew
    const maculaRecords = alignments.filter(a => a.algorithm_or_source === 'Clear-Bible/macula-hebrew');
    assert(maculaRecords.length === 0, 'Zero word alignments falsely cite Clear-Bible/macula-hebrew');

    const gen1Alignments = alignments.filter(a => a.alignment_key.startsWith('align:doc:gen1_1'));
    assert(gen1Alignments.length === 5, 'Genesis 1:1 has 5 editorial reference collation alignments');
    assert(gen1Alignments.every(a => a.algorithm_or_source === 'editorial_reference_collation'),
      'All Genesis 1:1 alignments have algorithm_or_source = editorial_reference_collation');

    const isa53 = alignments.find(a => a.alignment_key === 'align:doc:isa53_7_seh_probaton');
    assert(isa53?.algorithm_or_source === 'editorial_reference_collation',
      'Isaiah 53:7 has algorithm_or_source = editorial_reference_collation');

    const ps3 = alignments.find(a => a.alignment_key === 'align:doc:ps3_0_mizmor_david');
    assert(ps3?.algorithm_or_source === 'STEPBible TVTMS',
      'Psalm 3:0 title cites STEPBible TVTMS');

    const candidateAlign = alignments.find(a => a.alignment_tier === 'computationally_inferred_candidate');
    assert(candidateAlign?.verification_status === 'unverified_candidate' && Number(candidateAlign?.confidence_score) < 1.0,
      'Candidate alignment is strictly segregated with verification_status = unverified_candidate and confidence < 1.0');

    const scholarlyAlign = alignments.find(a => a.alignment_tier === 'scholarly_interpretation');
    assert(scholarlyAlign?.verification_status === 'scholarly_hypothesis',
      'Scholarly interpretation is segregated with verification_status = scholarly_hypothesis');
  }

  // 2. Audit entity_relationships (MACULA Hebrew-Greek dictionary equivalents)
  {
    const { data: oldAlignments } = await queryTable(
      'entity_relationships?derivation_method=eq.macula_hebrew_greek_equivalent&relation_type=eq.explicit_source_word_alignment'
    );
    assert(Array.isArray(oldAlignments) && oldAlignments.length === 0,
      'Zero MACULA dictionary links are falsely labeled as explicit_source_word_alignment');

    const { data: reclassified } = await queryTable(
      'entity_relationships?derivation_method=eq.macula_hebrew_greek_equivalent&relation_type=eq.source_provided_lexical_equivalent'
    );
    assert(Array.isArray(reclassified) && reclassified.length === 383,
      `All 383 MACULA dictionary links are relabeled source_provided_lexical_equivalent (got ${reclassified?.length})`);
    assert(reclassified.every(r => r.evidence_summary.includes('enabled_origin_unverified')),
      'All 383 MACULA dictionary links reference enabled_origin_unverified provenance');
  }

  // 3. Verify RPC retrieval transparency
  {
    // Check lookup_hebrew_to_greek_alignments_v1 for Elohim (H0430)
    const { status: statusHeb, ok: okHeb, data: dataHeb } = await rpcAnon('lookup_hebrew_to_greek_alignments_v1', {
      p_lemma_query: 'H0430',
      p_limit: 5
    });
    if (!okHeb) console.error('H0430 error:', statusHeb, dataHeb);
    assert(okHeb && dataHeb?.status === 'ok', 'lookup_hebrew_to_greek_alignments_v1 succeeds');
    const alignments = dataHeb?.alignments || [];
    assert(alignments.length > 0, `Returned ${alignments.length} Greek lexical equivalents for H0430`);
    if (alignments.length > 0) {
      assert(alignments[0]?.relation_type === 'source_provided_lexical_equivalent',
        `Alignments return truthful relation_type: source_provided_lexical_equivalent (got ${alignments[0]?.relation_type})`);
    }

    // Check lookup_greek_to_hebrew_alignments_v1 for Theos (G2316)
    const { status: statusGrk, ok: okGrk, data: dataGrk } = await rpcAnon('lookup_greek_to_hebrew_alignments_v1', {
      p_greek_query: 'G2316',
      p_limit: 5
    });
    if (!okGrk) console.error('G2316 error:', statusGrk, dataGrk);
    assert(okGrk && dataGrk?.status === 'ok', 'lookup_greek_to_hebrew_alignments_v1 succeeds');
    const grkAlignments = dataGrk?.alignments || [];
    assert(grkAlignments.length > 0, `Returned ${grkAlignments.length} Hebrew lexical equivalents for G2316`);
    if (grkAlignments.length > 0) {
      assert(grkAlignments[0]?.relation_type === 'source_provided_lexical_equivalent',
        `Greek-to-Hebrew alignments return relation_type: source_provided_lexical_equivalent (got ${grkAlignments[0]?.relation_type})`);
    }
  }

  console.log(`\nTests Completed: ${passCount} PASSED, ${failCount} FAILED.`);
  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled verification error:', err);
  process.exit(1);
});
