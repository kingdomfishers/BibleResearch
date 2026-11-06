// @file: scripts/verify-prompts1-4-completion.mjs
// End-to-end verification script for BibleResearch Prompts 1-4 completion and defect correction.

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
const MCP_ENDPOINT = `${SUPABASE_URL}/functions/v1/bible-mcp/mcp`;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function check(name, condition, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${name}${details ? ` (${details})` : ''}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${name}${details ? ` - ${details}` : ''}`);
  }
}

async function rpc(name, params = {}) {
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

let mcpSeq = 0;
async function mcpCall(toolName, args = {}) {
  const id = ++mcpSeq;
  try {
    const res = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    const payload = res.headers.get('content-type')?.includes('text/event-stream')
      ? text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(p => p.id === id)
      : JSON.parse(text);

    if (!payload || payload.error) {
      return { ok: false, status: res.status, error: payload?.error };
    }
    const result = payload.result;
    return {
      ok: !result?.isError,
      status: res.status,
      result: result?.structuredContent ?? result,
    };
  } catch (err) {
    return { ok: false, status: 500, error: String(err) };
  }
}

async function main() {
  console.log('================================================================');
  console.log('BIBLERESEARCH PROMPTS 1–4 COMPREHENSIVE END-TO-END VERIFICATION');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // CASE 1: Genesis 1:1
  // -------------------------------------------------------------
  console.log('CASE 1: Genesis 1:1 (Hebrew tokens, LXX comparison, alignment provenance)');
  {
    // PostgREST: prompt_verse_words
    const { ok: okV, data: words } = await rpc('prompt_verse_words', { p_book: 1, p_chapter: 1, p_verse: 1 });
    check('Gen 1:1 Hebrew tokens count', okV && Array.isArray(words) && words.length === 7, `found ${words?.length} tokens`);
    check('Gen 1:1 first token is H7225 Bereshit', words?.[0]?.strongs_nr === 'H7225' && words?.[0]?.word_position === 1);
    check('Gen 1:1 second token is H1254 Bara', words?.[1]?.strongs_nr === 'H1254' && words?.[1]?.word_position === 2);
    check('Gen 1:1 third token is H430 Elohim', words?.[2]?.strongs_nr === 'H430' && words?.[2]?.word_position === 3);

    // MCP comparison: compare_hebrew_septuagint_passage
    const { ok: okMcp, result: comp } = await mcpCall('compare_hebrew_septuagint_passage', {
      p_hebrew_book: 1, p_hebrew_chapter: 1, p_hebrew_verse: 1
    });
    check('Gen 1:1 MCP MT-LXX comparison status', okMcp && comp?.status === 'ok', `status: ${comp?.status}`);
    const lxxWords = comp?.septuagint_passage?.words || [];
    check('Gen 1:1 Septuagint contains 10 Greek tokens', lxxWords.length === 10, `LXX tokens: ${lxxWords.length}`);
    check('Gen 1:1 LXX begins with En arche epoiesen', lxxWords[0]?.word_text?.toUpperCase().includes('ΕΝ') && lxxWords[1]?.word_text?.toUpperCase().includes('ΑΡΧΗ'));

    // Alignments provenance: editorial reference collation, NOT macula_hebrew_greek_equivalent
    const alignments = comp?.documented_alignments || [];
    const hasEditorialColl = alignments.some(a => a.algorithm_or_source === 'editorial_reference_collation');
    const hasFakeMacula = alignments.some(a => a.algorithm_or_source === 'Clear-Bible/macula-hebrew');
    check('Gen 1:1 alignments use editorial reference collation', hasEditorialColl, 'editorial_reference_collation verified');
    check('Gen 1:1 zero fake MACULA manuscript alignments', !hasFakeMacula, 'no fake manuscript alignments');
  }

  // -------------------------------------------------------------
  // CASE 2: Genesis 1:4
  // -------------------------------------------------------------
  console.log('\nCASE 2: Genesis 1:4 (Badal H914, Elohim H430, Bein H996, morphology, syntax)');
  {
    const { ok, data: words } = await rpc('prompt_verse_words', { p_book: 1, p_chapter: 1, p_verse: 4 });
    check('Gen 1:4 words retrieved', ok && Array.isArray(words) && words.length >= 8);
    
    // Check Badal H914
    const badalToken = words?.find(w => w.strongs_nr === 'H914');
    check('Gen 1:4 Badal (H914) separation token present', !!badalToken, `form: ${badalToken?.original_word}`);

    // Check Elohim H430
    const elohimToken = words?.find(w => w.strongs_nr === 'H430');
    check('Gen 1:4 Elohim (H430) token present', !!elohimToken, `form: ${elohimToken?.original_word}`);

    // Check Bein H996
    const beinToken = words?.find(w => w.strongs_nr === 'H996');
    check('Gen 1:4 Bein (H996) token present', !!beinToken, `form: ${beinToken?.original_word}`);

    // Syntax tree via MCP
    const { ok: okSyntax, result: syn } = await mcpCall('get_syntax_tree', {
      p_book: 1, p_chapter: 1, p_verse: 4
    });
    check('Gen 1:4 syntax tree retrieved', okSyntax && syn?.syntax_status === 'annotated_in_source', `status: ${syn?.syntax_status}`);
    check('Gen 1:4 syntax hierarchy has trees and edges', syn?.trees_count > 0 && syn?.edges_count > 0, `trees: ${syn?.trees_count}, edges: ${syn?.edges_count}`);
    const rootNodes = syn?.trees?.[0]?.nodes || [];
    check('Gen 1:4 syntax tree has valid nodes', rootNodes.length > 0, `nodes in tree: ${rootNodes.length}`);
  }

  // -------------------------------------------------------------
  // CASE 3: Genesis 1:2
  // -------------------------------------------------------------
  console.log('\nCASE 3: Genesis 1:2 (Ruach H7307 senses, occurrences, no fake alignments)');
  {
    // Ruach lexical semantics via MCP
    const { ok: okLex, result: lex } = await mcpCall('lookup_lexical_semantics', { p_query: 'H7307' });
    check('Ruach H7307 lexical semantics status', okLex && lex?.status === 'ok');
    
    const targetLemma = lex?.lemmas?.[0];
    const senses = targetLemma?.documented_senses || [];
    const lexemes = targetLemma?.lexemes || [];
    const hasSpiritGloss = lexemes.some(l => l.primary_gloss?.toLowerCase().includes('spirit'));
    const hasBreathSense = senses.some(s => s.short_gloss?.toLowerCase().includes('breath') || s.definition_text?.toLowerCase().includes('breath')) ||
      senses.some(s => s.short_gloss?.toLowerCase().includes('wind') || s.short_gloss?.toLowerCase().includes('spirit'));
    check('Ruach H7307 contains attested lexical senses/glosses', senses.length > 0 || lexemes.length > 0, `${senses.length} senses, ${lexemes.length} lexemes`);
    check('Ruach H7307 includes spirit / wind / breath', hasSpiritGloss || hasBreathSense);

    // Ruach occurrences via prompt_word_occurrences
    const { ok: okOcc, result: occRes } = await mcpCall('prompt_word_occurrences', { p_word_query: 'H7307', limit: 1 });
    const totalOccurrences = occRes?.page?.total_rows || targetLemma?.surface_forms_summary?.distinct_forms_count || 0;
    check('Ruach H7307 distinct surface forms documented (>10)', targetLemma?.surface_forms_summary?.distinct_forms_count >= 10,
      `distinct forms: ${targetLemma?.surface_forms_summary?.distinct_forms_count}`);

    // Genesis 1:2 parallel comparison: no fake alignments
    const { ok: okComp, result: comp } = await mcpCall('compare_hebrew_septuagint_passage', {
      p_hebrew_book: 1, p_hebrew_chapter: 1, p_hebrew_verse: 2
    });
    check('Gen 1:2 parallel comparison returned', okComp && comp?.status === 'ok');
    const alignments = comp?.documented_alignments || [];
    check('Gen 1:2 does not invent manuscript word alignments', alignments.length === 0, `documented alignments count: ${alignments.length}`);
  }

  // -------------------------------------------------------------
  // CASE 4: Psalm 23:1
  // -------------------------------------------------------------
  console.log('\nCASE 4: Psalm 23:1 (Versification: MT 23:1 -> LXX 22:1 "Κύριος ποιμαίνει με", title handling)');
  {
    // Compare MT Psalm 23:1
    const { ok: okPs1, result: comp1 } = await mcpCall('compare_hebrew_septuagint_passage', {
      p_hebrew_book: 19, p_hebrew_chapter: 23, p_hebrew_verse: 1
    });
    check('Psalm 23:1 comparison status', okPs1 && comp1?.status === 'ok');
    check('Psalm 23:1 correctly maps MT 23:1 to LXX Swete 22:1',
      comp1?.hebrew_passage?.book === 19 && comp1?.hebrew_passage?.chapter === 23 && comp1?.septuagint_passage?.verse_nr === 1,
      `MT: Ps ${comp1?.hebrew_passage?.chapter}, LXX: Ps ${comp1?.septuagint_passage?.chapter}:${comp1?.septuagint_passage?.verse_nr}`);
    
    const lxxWords = comp1?.septuagint_passage?.words || [];
    const lxxText = lxxWords.map(w => w.word_text).join(' ');
    check('LXX 22:1 begins with "Κύριος ποιμαίνει με"', lxxText.includes('Κύριος') && lxxText.includes('ποιμαίνει'), `text: ${lxxText}`);

    // Verify MT Psalm 23:0 title maps to LXX 22:32 subscription
    const { ok: okPs0, result: comp0 } = await mcpCall('compare_hebrew_septuagint_passage', {
      p_hebrew_book: 19, p_hebrew_chapter: 23, p_hebrew_verse: 0
    });
    check('Psalm 23:0 title comparison status', okPs0 && comp0?.status === 'ok');
    check('Psalm 23:0 maps MT 23:0 title to LXX 22:32 subscription', comp0?.septuagint_passage?.verse_nr === 32,
      `LXX verse: ${comp0?.septuagint_passage?.verse_nr}`);

    // Check MT Psalm 23:2 -> LXX 22:2 (proves NO 1-verse title shift error)
    const { ok: okPs2, result: comp2 } = await mcpCall('compare_hebrew_septuagint_passage', {
      p_hebrew_book: 19, p_hebrew_chapter: 23, p_hebrew_verse: 2
    });
    check('Psalm 23:2 maps 1:1 to LXX 22:2 (no title shift error)', comp2?.septuagint_passage?.verse_nr === 2,
      `LXX verse: ${comp2?.septuagint_passage?.verse_nr}`);
  }

  // -------------------------------------------------------------
  // CASE 5: Isaiah 53:5
  // -------------------------------------------------------------
  console.log('\nCASE 5: Isaiah 53:5 (Parallel text Hebrew/Greek, no invented alignments)');
  {
    const { ok, result: comp } = await mcpCall('compare_hebrew_septuagint_passage', {
      p_hebrew_book: 23, p_hebrew_chapter: 53, p_hebrew_verse: 5
    });
    check('Isaiah 53:5 comparison status', ok && comp?.status === 'ok');
    check('Isaiah 53:5 Hebrew tokens returned', Array.isArray(comp?.hebrew_passage?.words) && comp?.hebrew_passage?.words?.length > 0,
      `Hebrew words: ${comp?.hebrew_passage?.words?.length}`);
    check('Isaiah 53:5 Septuagint tokens returned', Array.isArray(comp?.septuagint_passage?.words) && comp?.septuagint_passage?.words?.length > 0,
      `LXX words: ${comp?.septuagint_passage?.words?.length}`);
    
    // Ensure no unverified alignment masquerades as manuscript evidence
    const candidates = comp?.candidate_alignments || [];
    const masquerading = candidates.filter(a => a.tier === 'computationally_inferred_candidate' && a.status === 'verified');
    check('Isaiah 53:5 zero unverified candidate alignments masquerading as verified', masquerading.length === 0, `count: ${masquerading.length}`);
  }

  // -------------------------------------------------------------
  // CASE 6: John 1:1
  // -------------------------------------------------------------
  console.log('\nCASE 6: John 1:1 (Greek lemma lookup, morphology, editions, syntax)');
  {
    // Greek NT verse words
    const { ok: okWords, data: words } = await rpc('prompt_verse_words', { p_book: 43, p_chapter: 1, p_verse: 1 });
    check('John 1:1 Greek tokens count (17 tokens)', okWords && Array.isArray(words) && words.length === 17, `count: ${words?.length}`);
    
    const logos = words?.find(w => w.strongs_nr === 'G3056');
    check('John 1:1 contains Logos (G3056)', !!logos, `word: ${logos?.original_word}, translit: ${logos?.transliteration}`);
    check('Logos has correct grammar code N-NSM', logos?.grammar_code === 'N-NSM' || logos?.grammar_code?.includes('N-NSM'), `grammar: ${logos?.grammar_code}`);

    // Greek verse evidence with editions (TAGNT, Nestle1904, SBLGNT)
    const { ok: okEv, data: ev } = await rpc('lookup_greek_verse_evidence_v1', { p_book: 43, p_chapter: 1, p_verse: 1 });
    check('John 1:1 multi-edition evidence status', okEv && ev?.found === true);
    check('John 1:1 contains TAGNT edition tokens', Array.isArray(ev?.tagnt_tokens) && ev?.tagnt_tokens?.length === 17);
    check('John 1:1 contains MACULA Nestle1904 Greek tokens', Array.isArray(ev?.macula_nestle1904_tokens) && ev?.macula_nestle1904_tokens?.length >= 17);
    check('John 1:1 contains MACULA SBLGNT Greek tokens', Array.isArray(ev?.macula_sblgnt_tokens) && ev?.macula_sblgnt_tokens?.length >= 17);

    // Syntax tree for John 1:1
    const { ok: okSyn, result: syn } = await mcpCall('get_syntax_tree', { p_book: 43, p_chapter: 1, p_verse: 1 });
    check('John 1:1 syntax tree status', okSyn && syn?.syntax_status === 'annotated_in_source');
    check('John 1:1 syntax tree has Greek clause nodes', syn?.trees?.[0]?.nodes?.length > 0 && syn?.edges_count > 0,
      `nodes: ${syn?.trees?.[0]?.nodes?.length}, edges: ${syn?.edges_count}`);
  }

  // -------------------------------------------------------------
  // CASE 7: Kaphar (H3722)
  // -------------------------------------------------------------
  console.log('\nCASE 7: Kaphar (H3722: senses, roots, occurrences, glosses, homograph distinction)');
  {
    const { ok: ok3722, result: lex3722 } = await mcpCall('lookup_lexical_semantics', { p_query: 'H3722' });
    check('Kaphar H3722 lexical semantics status', ok3722 && lex3722?.status === 'ok');
    
    const targetLemma3722 = lex3722?.lemmas?.[0];
    check('Kaphar H3722 lemma script is כִּפֶּר', targetLemma3722?.lemma_script?.includes('כִּפֶּר') || targetLemma3722?.transliteration?.toLowerCase().includes('ki.pher'),
      `script: ${targetLemma3722?.lemma_script}`);
    
    const senses3722 = targetLemma3722?.documented_senses || [];
    check('Kaphar H3722 has documented atone/cover senses', senses3722.some(s => s.short_gloss?.toLowerCase().includes('atone') || s.definition_text?.toLowerCase().includes('atone')),
      `senses: ${senses3722.map(s => s.short_gloss).join(', ')}`);

    const glosses3722 = targetLemma3722?.attested_translation_glosses || [];
    check('Kaphar H3722 has attested translation glosses', glosses3722.length > 0, `glosses count: ${glosses3722.length}`);

    // Verify strict distinction from Kopher H3724
    const { ok: ok3724, result: lex3724 } = await mcpCall('lookup_lexical_semantics', { p_query: 'H3724' });
    check('Kopher H3724 resolves independently', ok3724 && lex3724?.status === 'ok');
    const targetLemma3724 = lex3724?.lemmas?.[0];
    check('H3722 and H3724 are strictly distinguished', targetLemma3722?.lemma_key !== targetLemma3724?.lemma_key,
      `${targetLemma3722?.lemma_key} !== ${targetLemma3724?.lemma_key}`);
  }

  // -------------------------------------------------------------
  // CASE 8: General Regression (Reader, Chronology, Geography, Relationships, Pagination, Security)
  // -------------------------------------------------------------
  console.log('\nCASE 8: General Regression (Reader, Chronology, Geography, Relationships, Pagination, Security)');
  {
    // Reader: get_verse_research
    const { ok: okRes, result: verseRes } = await mcpCall('get_verse_research', {
      profile: 'analysis',
      p_request: { passages: [{ book: 1, chapter: 1, verse: 1 }] }
    });
    check('Reader get_verse_research returns analysis packet', okRes && verseRes?.status === 'ok');

    // Chronology: get_verse_chronology_v1
    const { ok: okChrono, result: chrono } = await mcpCall('get_verse_chronology_v1', {
      p_book: 11, p_chapter: 6, p_verse: 1
    });
    check('Chronology returns multi-model dates for 1 Kings 6:1', okChrono && chrono?.rows?.[0]?.status === 'ok');

    // Geography: get_verse_geography
    const { ok: okGeo, result: geo } = await mcpCall('get_verse_geography', {
      p_book: 43, p_chapter: 4, p_verse: 7
    });
    check('Geography returns context-aware location for John 4:7', okGeo && geo?.rows?.[0]?.status === 'ok');

    // Relationships: research_relationships
    const { ok: okRel, result: rel } = await mcpCall('research_relationships', {
      subject: 'well', target: 'marriage', mode: 'explain'
    });
    check('Relationships returns evidence graph for well -> marriage', okRel && rel?.rows?.[0]?.status === 'ok');

    // Pagination: prompt_word_occurrences
    const { ok: okPage, result: pageRes } = await mcpCall('prompt_word_occurrences', {
      p_word_query: 'H7225', limit: 10, offset: 0
    });
    check('Pagination returns 10 rows with next_offset = 10', okPage && pageRes?.rows?.length === 10 && pageRes?.page?.next_offset === 10);

    // Security: Anonymous write rejected
    const testWriteRes = await fetch(`${SUPABASE_URL}/rest/v1/words`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 9999999, original_word: 'hack' }),
    });
    check('Security: Anonymous write to evidence table strictly rejected (HTTP 401/403/RLS)', !testWriteRes.ok, `status: ${testWriteRes.status}`);

    // Query limits: limit > 100 rejected
    const { result: rejectedLim, ok: okRejected } = await mcpCall('prompt_word_occurrences', {
      p_word_query: 'H7225', limit: 500
    });
    check('Query limits enforced: limit > 100 rejected', !okRejected || rejectedLim?.isError === true);
  }

  console.log('\n================================================================');
  console.log(`END-TO-END VERIFICATION RESULT: ${passedTests}/${totalTests} PASSED, ${failedTests} FAILED`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
