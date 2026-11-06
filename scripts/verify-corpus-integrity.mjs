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

async function runTests() {
  console.log('=== VERIFYING CORPUS DATA INTEGRITY & SOURCE COVERAGE (CORR-05) ===\n');
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

  // 1. Verify referential integrity (zero orphan references)
  {
    const { status, ok, data } = await rpcAnon('verify_referential_integrity_v1');
    if (!ok) console.error('verify_referential_integrity_v1 error:', status, data);
    assert(ok && data?.status === 'ok', 'verify_referential_integrity_v1 executed successfully');

    const fkr = data?.foreign_key_rejection;
    assert(fkr?.token_morphemes_invalid_verse_rejected, 'Foreign key rejection active for token_morphemes');
    assert(fkr?.word_form_lemmas_invalid_lemma_rejected, 'Foreign key rejection active for word_form_lemmas');

    const ccr = data?.check_constraint_rejection;
    assert(ccr?.synonymy_claim_rejected, 'Check constraint active: chk_lemma_root_links_no_synonymy');
    assert(ccr?.invalid_root_kind_rejected, 'Check constraint active: chk_lexical_roots_kind');
    assert(ccr?.self_relationship_rejected, 'Check constraint active: chk_entity_relationships_no_self_ref');
    assert(ccr?.invalid_morpheme_role_rejected, 'Check constraint active: chk_token_morphemes_role');

    const orphans = data?.orphan_counts || {};
    const orphanEntries = Object.entries(orphans);
    const totalOrphans = orphanEntries.reduce((sum, [, count]) => sum + (Number(count) || 0), 0);
    assert(orphanEntries.length === 12, 'Checked all 12 foreign-key relationships');
    assert(totalOrphans === 0, `Zero orphan references across all 12 relationships (got ${totalOrphans})`);
    assert(data?.provenance_integrity?.lxx_words_missing_provenance === 0,
      'Zero LXX words missing provenance');
  }

  // 2. Validate syntax tree integrity (zero cycles, valid hierarchy & spans)
  {
    const { status, ok, data } = await rpcAnon('validate_syntax_tree_integrity_v1');
    if (!ok) console.error('validate_syntax_tree_integrity_v1 error:', status, data);
    assert(ok && data?.status === 'PASS' && data?.is_valid === true,
      'validate_syntax_tree_integrity_v1 executed with status PASS');
    assert(data?.cycles_count === 0, `Zero cycles in syntax trees (got ${data?.cycles_count})`);
    assert(data?.terminals_without_xml_count === 0,
      `Zero orphaned terminal nodes without XML/word references (got ${data?.terminals_without_xml_count})`);
    assert(data?.span_inversions_count === 0,
      `Zero span inversions (got ${data?.span_inversions_count})`);
    assert(data?.orphaned_parents_count === 0,
      `Zero orphaned child nodes without parents (got ${data?.orphaned_parents_count})`);
    assert(data?.total_nodes >= 12000 && data?.total_edges >= 12000,
      `Syntax trees contain full pericope corpora (${data?.total_nodes} nodes, ${data?.total_edges} edges)`);
  }

  // 3. Verify Ketiv / Qere distinctions are preserved without silent substitution
  {
    const { data: kqTokens } = await queryTable(
      'morphhb_tokens?is_ketiv=eq.true&select=id,word_text,lemma,is_ketiv,is_qere&limit=10'
    );
    assert(Array.isArray(kqTokens) && kqTokens.length > 0, 'Loaded Ketiv tokens from morphhb_tokens');
    assert(kqTokens.every(t => t.is_ketiv === true && t.is_qere === false),
      'Ketiv readings are explicitly tagged with is_ketiv = true');

    const { data: qereTokens } = await queryTable(
      'morphhb_tokens?is_qere=eq.true&select=id,word_text,lemma,is_ketiv,is_qere&limit=10'
    );
    assert(Array.isArray(qereTokens) && qereTokens.length > 0, 'Loaded Qere tokens from morphhb_tokens');
    assert(qereTokens.every(t => t.is_qere === true && t.is_ketiv === false),
      'Qere readings are explicitly tagged with is_qere = true without silent overwriting');
  }

  // 4. Verify homographs remain distinguished (distinct Strong numbers / lemmas)
  {
    // Ruach (H7307 - wind/spirit/breath) vs Rawach (H7304 - to be wide/breathe)
    const { ok: ok7307, data: data7307 } = await rpcAnon('lookup_word_to_lemma_senses_v1', { p_query: 'H7307' });
    const { ok: ok7304, data: data7304 } = await rpcAnon('lookup_word_to_lemma_senses_v1', { p_query: 'H7304' });
    assert(ok7307 && ok7304, 'Both H7307 and H7304 resolve independently');
    const stem7307 = data7307?.word_forms?.[0]?.morpheme_lemma_links?.find(l => l.morpheme_role === 'stem')?.lemma;
    const stem7304 = data7304?.word_forms?.[0]?.morpheme_lemma_links?.find(l => l.morpheme_role === 'stem')?.lemma;
    assert(stem7307 && stem7304 && stem7307.lemma_key !== stem7304.lemma_key,
      `Homographs H7307 (${stem7307?.lemma_key}) and H7304 (${stem7304?.lemma_key}) are strictly distinguished`);

    // Kaphar (H3722 - atone/cover) vs Kopher (H3724 - ransom/pitch)
    const { ok: ok3722, data: data3722 } = await rpcAnon('lookup_word_to_lemma_senses_v1', { p_query: 'H3722' });
    const { ok: ok3724, data: data3724 } = await rpcAnon('lookup_word_to_lemma_senses_v1', { p_query: 'H3724' });
    assert(ok3722 && ok3724, 'Both H3722 and H3724 resolve independently');
    const stem3722 = data3722?.word_forms?.[0]?.morpheme_lemma_links?.find(l => l.morpheme_role === 'stem')?.lemma;
    const stem3724 = data3724?.word_forms?.[0]?.morpheme_lemma_links?.find(l => l.morpheme_role === 'stem')?.lemma;
    assert(stem3722 && stem3724 && stem3722.lemma_key !== stem3724.lemma_key,
      `Homographs H3722 (${stem3722?.lemma_key}) and H3724 (${stem3724?.lemma_key}) are strictly distinguished`);
  }

  // 5. Verify coverage reporting distinguishes token coverage from syntax tree coverage
  {
    const { ok, data } = await rpcAnon('audit_evidence_coverage_v1');
    assert(ok && data?.audit_type === 'evidence_coverage_and_integrity', 'audit_evidence_coverage_v1 executed successfully');
    const orphanEntries = Object.entries(data?.orphans || {});
    const totalAuditOrphans = orphanEntries.reduce((sum, [, count]) => sum + (Number(count) || 0), 0);
    assert(totalAuditOrphans === 0, `Overall evidence coverage audit passed with zero orphans (got ${totalAuditOrphans})`);

    // Syntax tree coverage is pericope-level, token coverage is corpus-wide
    const { data: syntaxNodes } = await queryTable('syntax_nodes?select=id&limit=1');
    assert(Array.isArray(syntaxNodes) && syntaxNodes.length > 0,
      'Syntax constituent trees are available and queryable');

    const { data: wordsSample } = await queryTable('words?select=id&limit=1');
    assert(Array.isArray(wordsSample) && wordsSample.length > 0,
      'Corpus token dictionary is available and queryable');
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
