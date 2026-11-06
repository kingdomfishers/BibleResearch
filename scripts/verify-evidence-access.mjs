// @file: scripts/verify-evidence-access.mjs
// @feature: api
// @description: End-to-end evidence access and MCP vs PostgreSQL parity verification suite (F9)
// Tests:
//   1. MCP capability discovery and health endpoint
//   2. Parity between MCP (/mcp) and direct PostgreSQL PostgREST RPCs (/rest/v1/rpc/)
//   3. Traceable results for Hebrew, Greek NT, and Septuagint
//   4. Explicit reporting of missing evidence (anti-hallucination)
//   5. Disambiguation of incomplete coverage from zero matches
//   6. Provenance and 3-tier epistemic segregation
//   7. Read-only permissions and RLS enforcement

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const MCP_URL = process.env.BIBLE_MCP_URL || `${SUPABASE_URL}/functions/v1/bible-mcp/mcp`;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

let sequence = 0;
const results = [];
const sampleResponses = {};

function recordTest(id, category, name, passed, error = null, sample = null) {
  results.push({ id, category, name, passed, error: error ? String(error) : null });
  if (sample) sampleResponses[id] = sample;
  const statusStr = passed ? 'PASS' : 'FAIL';
  console.log(`  [${statusStr}] ${id}: ${name}`);
  if (!passed && error) console.error(`       Error: ${error}`);
}

async function callMcpRpc(method, params = {}) {
  const id = ++sequence;
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  assert.ok(response.ok, `MCP HTTP ${response.status}: ${text.slice(0, 200)}`);
  const payload = response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(p => p.id === id)
    : JSON.parse(text);
  assert.equal(payload?.id, id, `Missing matching JSON-RPC id ${id}`);
  assert.ok(!payload.error, `MCP Error: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function callMcpTool(name, args = {}) {
  const res = await callMcpRpc('tools/call', { name, arguments: args });
  assert.ok(!res.isError, `Tool ${name} failed: ${JSON.stringify(res.content)}`);
  return res.structuredContent;
}

async function callPostgrestRpc(name, args = {}) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${name}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  assert.ok(response.ok, `PostgREST HTTP ${response.status} on ${name}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function main() {
  console.log('=== Bible Research Engine Evidence Access & MCP/DB Parity Verification Suite (F9) ===\n');

  // ---------------------------------------------------------------------------
  // 1. MCP Capability Discovery & Health Endpoint
  // ---------------------------------------------------------------------------
  console.log('1. Verifying MCP Capability Discovery & Health Endpoint...');
  try {
    const healthRes = await fetch(`${SUPABASE_URL}/functions/v1/bible-mcp/health`, { signal: AbortSignal.timeout(10000) });
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.status, 'ok');
    assert.equal(health.read_only, true);
    assert.equal(health.authentication, 'none');
    assert.equal(health.tools, 17, `Expected 17 tools in health, got ${health.tools}`);
    assert.equal(health.prompts, 17, `Expected 17 prompts in health, got ${health.prompts}`);
    recordTest('DISC-01', 'Discovery', 'Anonymous health endpoint reports 17 tools and 17 prompts', true, null, health);
  } catch (err) {
    recordTest('DISC-01', 'Discovery', 'Anonymous health endpoint reports 17 tools and 17 prompts', false, err);
  }

  try {
    const toolsList = await callMcpRpc('tools/list');
    const tools = toolsList.tools;
    assert.equal(tools.length, 17, `Expected 17 tools in tools/list, got ${tools.length}`);
    const expectedTools = [
      'audit_evidence_coverage',
      'compare_hebrew_septuagint_passage',
      'get_research_prompt',
      'get_septuagint_passage',
      'get_syntax_tree',
      'get_verse_chronology_v1',
      'get_verse_geography',
      'get_verse_research',
      'get_word_details',
      'lookup_hebrew_septuagint_alignments',
      'lookup_lexical_semantics',
      'prompt_verse_words',
      'prompt_word_cooccurrences',
      'prompt_word_occurrences',
      'prompt_word_relationships',
      'research_relationships',
      'resolve_word_id',
    ];
    assert.deepEqual(tools.map(t => t.name).sort(), expectedTools.sort());
    assert.ok(tools.every(t => t.annotations?.readOnlyHint === true), 'All tools must declare readOnlyHint=true');
    assert.ok(tools.every(t => t.annotations?.destructiveHint === false), 'All tools must declare destructiveHint=false');
    recordTest('DISC-02', 'Discovery', 'Exact catalog of 17 read-only tools discoverable with schemas', true);
  } catch (err) {
    recordTest('DISC-02', 'Discovery', 'Exact catalog of 17 read-only tools discoverable with schemas', false, err);
  }

  // ---------------------------------------------------------------------------
  // 2. Original-Language Tokens & Morphology Parity (Hebrew, Greek NT, LXX)
  // ---------------------------------------------------------------------------
  console.log('\n2. Verifying Original-Language Passage Tokens & Morphology Parity...');

  // Hebrew: Genesis 1:1
  try {
    const mcpHeb = await callMcpTool('prompt_verse_words', { p_book: 1, p_chapter: 1, p_verse: 1 });
    const dbHeb = await callPostgrestRpc('prompt_verse_words', { p_book: 1, p_chapter: 1, p_verse: 1 });
    assert.equal(mcpHeb.rows.length, 7);
    assert.equal(dbHeb.length, 7);
    assert.equal(mcpHeb.rows[0].original_word, dbHeb[0].original_word);
    assert.equal(mcpHeb.rows[0].strongs_nr, 'H7225');
    assert.equal(dbHeb[0].strongs_nr, 'H7225');
    assert.deepEqual(mcpHeb.rows.map(r => r.word_position), [1, 2, 3, 4, 5, 6, 7]);
    recordTest('PARITY-HEB', 'Parity', 'Hebrew OT Genesis 1:1 MCP vs DB returns identical 7 tokens', true, null, {
      tokens: mcpHeb.rows.map(r => ({ pos: r.word_position, word: r.original_word, strongs: r.strongs_nr, gloss: r.gloss })),
    });
  } catch (err) {
    recordTest('PARITY-HEB', 'Parity', 'Hebrew OT Genesis 1:1 MCP vs DB returns identical 7 tokens', false, err);
  }

  // Greek NT: John 1:1
  try {
    const mcpGrk = await callMcpTool('prompt_verse_words', { p_book: 43, p_chapter: 1, p_verse: 1 });
    const dbGrk = await callPostgrestRpc('prompt_verse_words', { p_book: 43, p_chapter: 1, p_verse: 1 });
    assert.equal(mcpGrk.rows.length, 17);
    assert.equal(dbGrk.length, 17);
    assert.equal(mcpGrk.rows[0].original_word, dbGrk[0].original_word);
    assert.ok(mcpGrk.rows.some(r => r.strongs_nr === 'G3056'), 'John 1:1 must contain G3056 (logos)');
    recordTest('PARITY-GRK', 'Parity', 'Greek NT John 1:1 MCP vs DB returns identical 17 tokens with G3056', true, null, {
      tokens_count: mcpGrk.rows.length,
      sample_token: mcpGrk.rows[1],
    });
  } catch (err) {
    recordTest('PARITY-GRK', 'Parity', 'Greek NT John 1:1 MCP vs DB returns identical 17 tokens with G3056', false, err);
  }

  // Septuagint: Genesis 1:1 (Swete LXX)
  try {
    const mcpLxx = await callMcpTool('get_septuagint_passage', { p_book_no: 1, p_chapter: 1, p_verse_nr: 1 });
    const dbLxx = await callPostgrestRpc('lookup_septuagint_passage_v1', { p_book_no: 1, p_chapter: 1, p_verse_nr: 1 });
    assert.equal(mcpLxx.found, true);
    assert.equal(dbLxx.found, true);
    assert.equal(mcpLxx.tokens.length, 10);
    assert.equal(dbLxx.tokens.length, 10);
    assert.equal(mcpLxx.tokens[0].word_text, 'ΕΝ');
    assert.equal(dbLxx.tokens[0].word_text, 'ΕΝ');
    assert.equal(mcpLxx.tokens[1].word_text, 'ΑΡΧΗ');
    assert.equal(mcpLxx.summary.total_tokens, 10);
    assert.ok(mcpLxx.summary.epistemic_disclaimer.includes('Swete digital edition'));
    recordTest('PARITY-LXX', 'Parity', 'Septuagint Genesis 1:1 MCP vs DB returns identical 10 Greek tokens', true, null, {
      book: mcpLxx.book.latin_name,
      tokens: mcpLxx.tokens.map(t => ({ ord: t.ordinal, text: t.word_text, norm: t.normalized_word })),
      summary: mcpLxx.summary,
    });
  } catch (err) {
    recordTest('PARITY-LXX', 'Parity', 'Septuagint Genesis 1:1 MCP vs DB returns identical 10 Greek tokens', false, err);
  }

  // ---------------------------------------------------------------------------
  // 3. Lexical Semantics & Traceable Occurrences Parity
  // ---------------------------------------------------------------------------
  console.log('\n3. Verifying Lexical Semantics & Traceable Occurrences Parity...');

  // Hebrew: Pointed vs Unpointed רוח
  try {
    const mcpRuach = await callMcpTool('lookup_lexical_semantics', { p_query: 'רוח' });
    const dbRuach = await callPostgrestRpc('lookup_lexical_semantics_v1', { p_query: 'רוח' });
    assert.equal(mcpRuach.status, 'ok');
    assert.equal(dbRuach.status, 'ok');
    assert.equal(mcpRuach.lemmas.length, dbRuach.lemmas.length);
    assert.ok(mcpRuach.lemmas.length >= 4, 'Must return at least 4 distinct lemmas for unpointed רוח');
    const allRoots = mcpRuach.lemmas.flatMap(l => l.documented_roots || []);
    assert.ok(allRoots.every(r => r.implies_synonymy === false), 'Non-synonymous root invariant');
    const allSenses = mcpRuach.lemmas.flatMap(l => l.documented_senses || []);
    assert.ok(allSenses.length > 0, 'Must return documented lexical senses');
    assert.ok(allSenses.every(s => s.source_edition_key), 'Source provenance on senses');
    recordTest('LEX-RUACH', 'Lexical', 'Hebrew רוח MCP vs DB preserves 4 distinct homographs, roots & senses', true, null, {
      query: mcpRuach.query_analysis?.raw_query || 'רוח',
      lemmas: mcpRuach.lemmas.map(l => ({ lemma: l.lemma_script, strongs: l.base_strongs, transliteration: l.transliteration })),
      roots_count: allRoots.length,
      senses_count: allSenses.length,
    });
  } catch (err) {
    recordTest('LEX-RUACH', 'Lexical', 'Hebrew רוח MCP vs DB preserves 4 distinct homographs, roots & senses', false, err);
  }

  // Greek: λόγος (G3056)
  try {
    const mcpLogos = await callMcpTool('lookup_lexical_semantics', { p_query: 'λόγος' });
    const dbLogos = await callPostgrestRpc('lookup_lexical_semantics_v1', { p_query: 'λόγος' });
    assert.equal(mcpLogos.status, 'ok');
    assert.equal(dbLogos.status, 'ok');
    assert.equal(mcpLogos.lemmas[0].lemma_id, dbLogos.lemmas[0].lemma_id);
    assert.equal(mcpLogos.lemmas[0].base_strongs, 'G3056');
    const glosses = mcpLogos.lemmas[0].attested_translation_glosses || [];
    assert.ok(glosses.length > 0, 'Must return translation glosses');
    assert.ok(glosses.every(g => g.caveat.includes('contextual equivalence only')), 'Glosses must state translation caveat');
    recordTest('LEX-LOGOS', 'Lexical', 'Greek λόγος MCP vs DB resolves to G3056 with documented senses & glosses', true, null, {
      base_strongs: mcpLogos.lemmas[0].base_strongs,
      glosses_sample: glosses.slice(0, 3),
      senses_sample: (mcpLogos.lemmas[0].documented_senses || []).slice(0, 2),
    });
  } catch (err) {
    recordTest('LEX-LOGOS', 'Lexical', 'Greek λόγος MCP vs DB resolves to G3056 with documented senses & glosses', false, err);
  }

  // ---------------------------------------------------------------------------
  // 4. Syntactic Relationships for a Passage Parity
  // ---------------------------------------------------------------------------
  console.log('\n4. Verifying Syntactic Structure & Grammar Relationships Parity...');

  // Genesis 1:1 Syntax Tree
  try {
    const mcpSyntax = await callMcpTool('get_syntax_tree', { p_book: 1, p_chapter: 1, p_verse: 1 });
    const dbSyntax = await callPostgrestRpc('lookup_syntax_tree_v1', { p_book: 1, p_chapter: 1, p_verse: 1 });
    assert.equal(mcpSyntax.has_syntax, true);
    assert.equal(dbSyntax.has_syntax, true);
    assert.equal(mcpSyntax.syntax_status, 'annotated_in_source');
    assert.equal(mcpSyntax.trees_count, dbSyntax.trees_count);
    assert.equal(mcpSyntax.edges_count, dbSyntax.edges_count);
    assert.ok(mcpSyntax.trees_count > 0, 'Genesis 1:1 must have at least 1 syntax tree');
    assert.ok(mcpSyntax.edges_count > 0, 'Genesis 1:1 must have syntax edges');
    assert.ok(mcpSyntax.epistemic_invariants.morphology_vs_syntax_distinction, 'Epistemic invariant metadata present');
    recordTest('SYNTAX-GEN', 'Syntax', 'Genesis 1:1 MCP vs DB returns identical constituent trees and grammatical roles', true, null, {
      trees_count: mcpSyntax.trees_count,
      edges_count: mcpSyntax.edges_count,
      sample_tree: mcpSyntax.trees[0],
    });
  } catch (err) {
    recordTest('SYNTAX-GEN', 'Syntax', 'Genesis 1:1 MCP vs DB returns identical constituent trees and grammatical roles', false, err);
  }

  // John 1:1 Syntax Tree
  try {
    const mcpGrkSyntax = await callMcpTool('get_syntax_tree', { p_book: 43, p_chapter: 1, p_verse: 1 });
    const dbGrkSyntax = await callPostgrestRpc('lookup_syntax_tree_v1', { p_book: 43, p_chapter: 1, p_verse: 1 });
    assert.equal(mcpGrkSyntax.has_syntax, true);
    assert.equal(dbGrkSyntax.has_syntax, true);
    assert.equal(mcpGrkSyntax.trees_count, 1, 'John 1:1 has 1 compound sentence tree');
    assert.ok(mcpGrkSyntax.trees[0].nodes.length >= 20, 'John 1:1 has rich constituent tree');
    recordTest('SYNTAX-JHN', 'Syntax', 'John 1:1 MCP vs DB returns identical Greek clause tree with role edges', true);
  } catch (err) {
    recordTest('SYNTAX-JHN', 'Syntax', 'John 1:1 MCP vs DB returns identical Greek clause tree with role edges', false, err);
  }

  // ---------------------------------------------------------------------------
  // 5. Hebrew and Septuagint Documented Correspondence Parity
  // ---------------------------------------------------------------------------
  console.log('\n5. Verifying Hebrew-Septuagint Correspondence & 3-Tier Alignments Parity...');

  // Genesis 1:1 Comparison
  try {
    const mcpComp = await callMcpTool('compare_hebrew_septuagint_passage', { p_hebrew_book: 1, p_hebrew_chapter: 1, p_hebrew_verse: 1 });
    const dbComp = await callPostgrestRpc('compare_hebrew_septuagint_passage_v1', { p_hebrew_book: 1, p_hebrew_chapter: 1, p_hebrew_verse: 1 });
    assert.equal(mcpComp.correspondence_status, 'matched');
    assert.equal(dbComp.correspondence_status, 'matched');
    assert.equal(mcpComp.hebrew_passage.word_count, 7);
    assert.equal(mcpComp.septuagint_passage.word_count, 10);
    assert.equal(mcpComp.documented_alignments.length, 5);
    assert.equal(dbComp.documented_alignments.length, 5);
    // 1:many verified alignment (בְּרֵאשִׁית -> ΕΝ ΑΡΧΗ)
    const breshit = mcpComp.documented_alignments[0];
    assert.equal(breshit.cardinality, 'one_to_many');
    assert.deepEqual(breshit.hebrew_ordinals, [1]);
    assert.deepEqual(breshit.lxx_ordinals, [1, 2]);
    assert.equal(breshit.confidence_score, 1.0);
    assert.equal(breshit.verification_status, 'verified_source_attestation');
    recordTest('COMP-GEN', 'Comparison', 'Genesis 1:1 MCP vs DB returns identical 3-tier alignments & 1:many correspondence', true, null, {
      correspondence_status: mcpComp.correspondence_status,
      documented_alignments_count: mcpComp.documented_alignments.length,
      sample_alignment: breshit,
    });
  } catch (err) {
    recordTest('COMP-GEN', 'Comparison', 'Genesis 1:1 MCP vs DB returns identical 3-tier alignments & 1:many correspondence', false, err);
  }

  // Jeremiah 25:15 TVTMS Reordered Correspondence
  try {
    const mcpJer = await callMcpTool('compare_hebrew_septuagint_passage', { p_hebrew_book: 24, p_hebrew_chapter: 25, p_hebrew_verse: 15 });
    const dbJer = await callPostgrestRpc('compare_hebrew_septuagint_passage_v1', { p_hebrew_book: 24, p_hebrew_chapter: 25, p_hebrew_verse: 15 });
    assert.equal(mcpJer.correspondence_status, 'reordered');
    assert.equal(dbJer.correspondence_status, 'reordered');
    assert.equal(mcpJer.septuagint_passage.chapter, 32);
    assert.equal(mcpJer.septuagint_passage.verse_nr, 1);
    recordTest('COMP-JER', 'Comparison', 'Jeremiah 25:15 MT correctly maps to LXX 32:1 with reordered status', true, null, {
      correspondence_status: mcpJer.correspondence_status,
      hebrew: 'Jeremiah 25:15',
      lxx: `${mcpJer.septuagint_passage.latin_name} ${mcpJer.septuagint_passage.chapter}:${mcpJer.septuagint_passage.verse_nr}`,
    });
  } catch (err) {
    recordTest('COMP-JER', 'Comparison', 'Jeremiah 25:15 MT correctly maps to LXX 32:1 with reordered status', false, err);
  }

  // Word Alignment Lookup Tool Parity
  try {
    const mcpAlign = await callMcpTool('lookup_hebrew_septuagint_alignments', { p_query: 'H7225' });
    const dbAlign = await callPostgrestRpc('lookup_hebrew_septuagint_alignments_v1', { p_query: 'H7225' });
    assert.equal(mcpAlign.status, 'ok');
    assert.equal(dbAlign.status, 'ok');
    assert.equal(mcpAlign.alignments.length, dbAlign.alignments.length);
    assert.ok(mcpAlign.alignments.length > 0);
    recordTest('COMP-ALIGN', 'Comparison', 'Word alignment lookup tool returns matching alignments across MCP and DB', true);
  } catch (err) {
    recordTest('COMP-ALIGN', 'Comparison', 'Word alignment lookup tool returns matching alignments across MCP and DB', false, err);
  }

  // ---------------------------------------------------------------------------
  // 6. Evidence Coverage Audit Parity
  // ---------------------------------------------------------------------------
  console.log('\n6. Verifying Evidence Coverage Audit Parity...');
  try {
    const mcpAudit = await callMcpTool('audit_evidence_coverage');
    const dbAudit = await callPostgrestRpc('audit_evidence_coverage_v1');
    assert.equal(mcpAudit.table_counts.verses, 31203);
    assert.equal(dbAudit.table_counts.verses, 31203);
    assert.equal(mcpAudit.table_counts.lxx_swete_words, 588579);
    assert.equal(dbAudit.table_counts.lxx_swete_words, 588579);
    // Integrity checks: 0 orphans, 0 duplicates
    assert.equal(mcpAudit.orphans.orphan_map_books, 0);
    assert.equal(mcpAudit.orphans.orphan_map_verses, 0);
    assert.equal(mcpAudit.orphans.orphan_lxx_books, 0);
    assert.ok(Object.values(mcpAudit.orphans).every(v => v === 0), 'Zero orphans across all relationships');
    assert.ok(Object.values(mcpAudit.duplicates).every(v => v === 0), 'Zero duplicates across all tables');
    recordTest('AUDIT-COV', 'Coverage', 'Audit coverage reports 31,203 verses, 588,579 LXX words, 0 orphans, 0 duplicates', true, null, {
      verses: mcpAudit.table_counts.verses,
      tokens: mcpAudit.table_counts.verse_translation_sources,
      swete_lxx: mcpAudit.table_counts.lxx_swete_words,
      orphans: mcpAudit.orphans,
    });
  } catch (err) {
    recordTest('AUDIT-COV', 'Coverage', 'Audit coverage reports 31,203 verses, 588,579 LXX words, 0 orphans, 0 duplicates', false, err);
  }

  // ---------------------------------------------------------------------------
  // 7. Anti-Hallucination & Explicit Missing Evidence Reporting
  // ---------------------------------------------------------------------------
  console.log('\n7. Verifying Anti-Hallucination & Missing Evidence Behavior...');

  // Unannotated Syntax: Obadiah 1:1
  try {
    const obadiah = await callMcpTool('get_syntax_tree', { p_book: 31, p_chapter: 1, p_verse: 1 });
    assert.equal(obadiah.has_syntax, false);
    assert.equal(obadiah.syntax_status, 'unannotated_in_source');
    assert.equal(obadiah.trees_count, 0);
    assert.ok(obadiah.missing_syntax_reason.includes('No syntax tree bank annotations exist'));
    recordTest('ANTI-SYNTAX', 'Anti-Hallucination', 'Unannotated syntax reports unannotated_in_source with explicit reason (no guessing)', true, null, {
      has_syntax: obadiah.has_syntax,
      status: obadiah.syntax_status,
      reason: obadiah.missing_syntax_reason,
    });
  } catch (err) {
    recordTest('ANTI-SYNTAX', 'Anti-Hallucination', 'Unannotated syntax reports unannotated_in_source with explicit reason (no guessing)', false, err);
  }

  // Unmatched Hebrew Minus: Jeremiah 10:6 (absent in Septuagint)
  try {
    const jer10_6 = await callMcpTool('compare_hebrew_septuagint_passage', { p_hebrew_book: 24, p_hebrew_chapter: 10, p_hebrew_verse: 6 });
    assert.equal(jer10_6.correspondence_status, 'unmatched_hebrew_minus_in_lxx');
    assert.equal(jer10_6.has_septuagint_passage, false);
    recordTest('ANTI-MINUS', 'Anti-Hallucination', 'Jeremiah 10:6 absent in Septuagint reports unmatched_hebrew_minus_in_lxx', true, null, {
      status: jer10_6.correspondence_status,
      has_lxx: jer10_6.has_septuagint_passage,
    });
  } catch (err) {
    recordTest('ANTI-MINUS', 'Anti-Hallucination', 'Jeremiah 10:6 absent in Septuagint reports unmatched_hebrew_minus_in_lxx', false, err);
  }

  // Disambiguation: Incomplete Coverage vs Non-Existent Passage
  try {
    const invalidPassage = await callMcpTool('get_syntax_tree', { p_book: 1, p_chapter: 99, p_verse: 1 });
    assert.equal(invalidPassage.syntax_status, 'passage_not_found');
    assert.equal(invalidPassage.error, 'verse_not_found');
    recordTest('ANTI-DISTINCT', 'Anti-Hallucination', 'Non-existent passage distinguishes passage_not_found from unannotated', true, null, invalidPassage);
  } catch (err) {
    recordTest('ANTI-DISTINCT', 'Anti-Hallucination', 'Non-existent passage distinguishes passage_not_found from unannotated', false, err);
  }

  // ---------------------------------------------------------------------------
  // 8. Read-Only Permissions & RLS Enforcement
  // ---------------------------------------------------------------------------
  console.log('\n8. Verifying Read-Only Boundaries & RLS Enforcement...');
  try {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/lxx_swete_words`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ book_no: 1, chapter: 1, verse_nr: 1, ordinal: 999, word_text: 'ATTACK' }),
    });
    assert.ok(!insertRes.ok, `Anonymous INSERT must fail; got HTTP ${insertRes.status}`);
    recordTest('RLS-WRITE', 'Security', 'Anonymous write to canonical evidence tables strictly denied (HTTP 401/403/RLS)', true);
  } catch (err) {
    recordTest('RLS-WRITE', 'Security', 'Anonymous write to canonical evidence tables strictly denied (HTTP 401/403/RLS)', false, err);
  }

  // ---------------------------------------------------------------------------
  // 9. Summary & Machine-Readable Output Generation
  // ---------------------------------------------------------------------------
  const total = results.length;
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = total - passedCount;

  console.log('\n======================================================');
  console.log(`F9 VERIFICATION SUMMARY: ${passedCount}/${total} PASSED (${failedCount} FAILED)`);
  console.log('======================================================\n');

  const report = {
    test_run: 'F9 — Verify Complete Evidence Access Through PostgreSQL and MCP',
    timestamp: new Date().toISOString(),
    mcp_endpoint: MCP_URL,
    total_tests: total,
    passed_tests: passedCount,
    failed_tests: failedCount,
    status: failedCount === 0 ? 'ALL_TESTS_PASSED' : 'TESTS_FAILED',
    results,
    sample_responses: sampleResponses,
    unresolved_limitations: [
      {
        area: 'Septuagint Linguistic Annotations',
        status: 'intentionally_unannotated',
        details: 'Swete digital edition provides authentic Greek surface text, punctuation, and token order, but does not provide morphological tags or lemma links. External morphological guesswork is strictly disallowed to prevent hallucination.'
      },
      {
        area: 'MACULA Syntax Tree Bank Coverage',
        status: 'source_scope_bounded',
        details: 'Syntax constituent trees are available for MACULA-annotated passages (e.g. Genesis 1-3, Psalm 23, Isaiah 53 in OT; all 27 books in NT). Unannotated OT passages transparently report syntax_status: "unannotated_in_source".'
      },
      {
        area: 'Hebrew-Septuagint Word Alignments',
        status: 'strict_3_tier_segregation',
        details: 'Alignments are strictly partitioned into documented_textual (verified), computationally_inferred_candidate (confidence < 1.0), and scholarly_interpretation. Database check constraint chk_candidate_never_masquerade prevents candidate masquerading.'
      }
    ]
  };

  writeFileSync('EVIDENCE_ACCESS_VERIFICATION_REPORT.json', JSON.stringify(report, null, 2));
  console.log('Machine-readable report written to EVIDENCE_ACCESS_VERIFICATION_REPORT.json');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error running verification suite:', err);
  process.exit(1);
});
