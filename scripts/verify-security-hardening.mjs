// scripts/verify-security-hardening.mjs
// Verifies Phase 1: Critical Security Hardening
// 1. Anonymous callers cannot invoke privileged ingestion/mutation/cleanup functions.
// 2. Anonymous callers cannot perform INSERT/UPDATE/DELETE on protected evidence tables.
// 3. Public read-only research APIs and validation functions continue to work as SECURITY INVOKER.

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
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

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
  return { status: res.status, ok: res.ok, body: await res.text() };
}

async function postgrestAnon(endpoint, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ok: res.ok, body: await res.text() };
}

// §N.4 Notes Feature Allow-list: Explicitly allowed anon-callable RPCs for single-user notes.
// NOTE-08 functions (save_note_v1, delete_note_v1, set_note_review_v1) and read/search RPCs
// are permitted to be executed by anon. Functions not yet created are tolerated.
export const NOTES_RPC_ALLOW_LIST = [
  'save_note_v1',
  'delete_note_v1',
  'set_note_review_v1',
  'get_notes_for_passage_v1',
  'get_notes_for_word_v1',
  'get_note_v1',
  'list_notes_v1',
  'list_note_connection_types_v1',
  'search_note_targets_v1',
  'note_validate_block_v1',
];

async function runTests() {
  console.log('=== Verifying Phase 1: Security Hardening & Privilege Isolation ===\n');
  let passed = 0;
  let failed = 0;

  function assert(desc, condition, details = '') {
    if (condition) {
      console.log(`PASS: ${desc}`);
      passed++;
    } else {
      console.error(`FAIL: ${desc} - ${details}`);
      failed++;
    }
  }

  // 1. Ingestion / mutation functions must deny anonymous execution
  console.log('1. Testing administrative function lockdown...');
  const resClean = await rpcAnon('clean_stale_hebrew_lxx_jeremiah_v1');
  assert(
    'clean_stale_hebrew_lxx_jeremiah_v1 denied to anonymous caller',
    resClean.status === 401 || resClean.status === 403 || resClean.status === 404 || !resClean.ok,
    `Status: ${resClean.status}`
  );

  const resIngestMacula = await rpcAnon('ingest_macula_batch_v1', { p_morphemes: [] });
  assert(
    'ingest_macula_batch_v1 denied to anonymous caller',
    resIngestMacula.status === 401 || resIngestMacula.status === 403 || resIngestMacula.status === 404 || !resIngestMacula.ok,
    `Status: ${resIngestMacula.status}`
  );

  const resIngestSwete = await rpcAnon('ingest_swete_words_batch_v1', { p_words: [] });
  assert(
    'ingest_swete_words_batch_v1 denied to anonymous caller',
    resIngestSwete.status === 401 || resIngestSwete.status === 403 || resIngestSwete.status === 404 || !resIngestSwete.ok,
    `Status: ${resIngestSwete.status}`
  );

  const resIngestMorph = await rpcAnon('ingest_morphhb_batch_v1', { p_tokens: [] });
  assert(
    'ingest_morphhb_batch_v1 denied to anonymous caller',
    resIngestMorph.status === 401 || resIngestMorph.status === 403 || resIngestMorph.status === 404 || !resIngestMorph.ok,
    `Status: ${resIngestMorph.status}`
  );

  const resIngestFormations = await rpcAnon('ingest_lexical_formations_batch_v1', { p_formations: [] });
  assert(
    'ingest_lexical_formations_batch_v1 denied to anonymous caller (AUDIT-01)',
    resIngestFormations.status === 401 || resIngestFormations.status === 403 || resIngestFormations.status === 404 || !resIngestFormations.ok,
    `Status: ${resIngestFormations.status}`
  );

  const resIngestQuarantined = await rpcAnon('ingest_quarantined_records_batch_v1', { p_records: [] });
  assert(
    'ingest_quarantined_records_batch_v1 denied to anonymous caller (AUDIT-01)',
    resIngestQuarantined.status === 401 || resIngestQuarantined.status === 403 || resIngestQuarantined.status === 404 || !resIngestQuarantined.ok,
    `Status: ${resIngestQuarantined.status}`
  );

  const resCallCorpus = await rpcAnon('call_corpus_rpc_v1', { p_operation: 'lookup_syntax_tree_v1', p_params: {} });
  assert(
    'call_corpus_rpc_v1 denied to anonymous caller (AUDIT-01)',
    resCallCorpus.status === 401 || resCallCorpus.status === 403 || resCallCorpus.status === 404 || !resCallCorpus.ok,
    `Status: ${resCallCorpus.status}`
  );

  // 2. Direct RLS table write denials
  console.log('\n2. Testing RLS write denials on evidence & legacy tables...');
  const resWriteVerse = await postgrestAnon('verses', 'POST', {
    book: 99,
    chapter: 99,
    verse_nr: 99,
  });
  assert(
    'INSERT into verses denied to anonymous caller (RLS enforced)',
    !resWriteVerse.ok || resWriteVerse.status === 401 || resWriteVerse.status === 403,
    `Status: ${resWriteVerse.status}`
  );

  const resWriteWords = await postgrestAnon('words', 'POST', {
    original_word: 'FAKE',
  });
  assert(
    'INSERT into words denied to anonymous caller (RLS enforced)',
    !resWriteWords.ok || resWriteWords.status === 401 || resWriteWords.status === 403,
    `Status: ${resWriteWords.status}`
  );

  const resWriteContent = await postgrestAnon('content', 'POST', {
    title: 'FAKE_CONTENT',
  });
  assert(
    'INSERT into legacy content table denied to anonymous caller',
    !resWriteContent.ok || resWriteContent.status === 401 || resWriteContent.status === 403,
    `Status: ${resWriteContent.status}`
  );

  // 3. Public read-only research APIs remain functional
  console.log('\n3. Testing public research APIs as SECURITY INVOKER...');
  const resLxx = await rpcAnon('lookup_septuagint_passage_v1', {
    p_book_no: 1,
    p_chapter: 1,
    p_verse_nr: 1,
  });
  assert(
    'lookup_septuagint_passage_v1 accessible anonymously (Gen 1:1)',
    resLxx.ok && resLxx.body.includes('ἐποίησεν'),
    `Status: ${resLxx.status}`
  );

  const resSyntax = await rpcAnon('lookup_syntax_tree_v1', {
    p_book: 1,
    p_chapter: 1,
    p_verse: 1,
  });
  assert(
    'lookup_syntax_tree_v1 accessible anonymously (Gen 1:1)',
    resSyntax.ok && JSON.parse(resSyntax.body).trees_count >= 1,
    `Status: ${resSyntax.status}`
  );

  const resAudit = await rpcAnon('audit_evidence_coverage_v1');
  if (!resAudit.ok) console.error('resAudit error body:', resAudit.body);
  assert(
    'audit_evidence_coverage_v1 accessible anonymously as SECURITY INVOKER',
    resAudit.ok && JSON.parse(resAudit.body).table_counts !== undefined,
    `Status: ${resAudit.status}`
  );

  // 4. Notes single-user RPC allow-list & helper isolation (§N.4)
  console.log('\n4. Testing Notes RPC isolation and allow-list (§N.4)...');
  const isolatedHelpers = [
    'note_settings_v1',
    'note_assert_writes_enabled_v1',
    'note_resolve_human_author_v1',
    'note_resolve_agent_author_v1',
  ];
  for (const h of isolatedHelpers) {
    const res = await rpcAnon(h);
    assert(
      `Internal helper ${h} denied to anonymous caller`,
      !res.ok || res.status === 401 || res.status === 403 || res.status === 404,
      `Status: ${res.status}`
    );
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
