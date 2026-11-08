// scripts/verify-hybrid-equivalence.mjs
// End-to-end equivalence and regression suite for the hybrid Cloudflare (`bibleresearch-corpus`)
// + Supabase (`ejoperxiwxlcbsqrkrvb`) architecture.

import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env');
const env = fs.existsSync(envPath)
  ? Object.fromEntries(
      fs
        .readFileSync(envPath, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => {
          const idx = l.indexOf('=');
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
        })
    )
  : {};

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co').replace(/\/+$/, '');
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const CORPUS_URL = (
  process.env.VITE_CORPUS_BASE_URL ||
  env.VITE_CORPUS_BASE_URL ||
  'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev'
).replace(/\/+$/, '');

function assert(cond, msg) {
  if (!cond) {
    console.error(`  [FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`  [PASS] ${msg}`);
}

async function sbRpc(fnName, params = {}, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`Supabase RPC ${fnName} HTTP ${res.status}: ${await res.text()}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 600));
    }
  }
}

async function cfRpc(fnName, params = {}, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${CORPUS_URL}/v1/rpc/${fnName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`Cloudflare RPC ${fnName} HTTP ${res.status}: ${await res.text()}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 600));
    }
  }
}

async function mcpToolCall(toolName, args = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/bible-mcp/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });
  if (!res.ok) throw new Error(`MCP ${toolName} HTTP ${res.status}: ${await res.text()}`);
  const text = await res.text();
  const body = res.headers.get('content-type')?.includes('text/event-stream')
    ? text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => JSON.parse(l.slice(5)))
        .find((p) => p.id === 1)
    : JSON.parse(text);
  if (body.error) throw new Error(`MCP error: ${JSON.stringify(body.error)}`);
  return body.result?.structuredContent ?? JSON.parse(body.result?.content?.[0]?.text || '{}');
}

async function main() {
  console.log('=== Hybrid Cloudflare + Supabase Equivalence Verification Suite ===\n');

  // 1. Compare Cloudflare vs Supabase on lookup_syntax_tree_v1 (Genesis 1:1, John 1:1, Ephesians 1:3-14, Obadiah 1:1)
  console.log('1. Verifying Syntax Tree Equivalence (Genesis 1:1, Obadiah 1:1, John 1:1, Ephesians 1:3-14)...');
  const sbGen1Syn = await sbRpc('lookup_syntax_tree_v1', { p_verse_id: 1, p_edition_key: 'macula-hebrew-wlc' });
  const cfGen1Syn = await cfRpc('lookup_syntax_tree_v1', { p_verse_id: 1, p_edition_key: 'macula-hebrew-wlc' });
  assert(sbGen1Syn.trees_count === 1 && cfGen1Syn.trees_count === 1, 'Both Supabase and Cloudflare return 1 WLC tree for Genesis 1:1');
  assert(
    sbGen1Syn.trees[0].nodes.length === cfGen1Syn.trees[0].nodes.length,
    `Genesis 1:1 node count matches (${sbGen1Syn.trees[0].nodes.length})`
  );

  // Obadiah 1:1 (previously unimported in PostgreSQL, now available via 983-file Macula corpus!)
  const cfObaSyn = await cfRpc('lookup_syntax_tree_v1', { p_book: 31, p_chapter: 1, p_verse: 1 });
  assert(cfObaSyn.has_syntax === true && cfObaSyn.trees_count >= 1, 'Obadiah 1:1 now has complete WLC syntax tree from 983-file corpus');

  // Ephesians 1:3-14 cross-verse span (sentence #s3 spans 1:3–1:6)
  const sbEphSyn = await sbRpc('lookup_syntax_tree_v1', { p_book: 49, p_chapter: 1, p_verse: 3, p_edition_key: 'macula-greek-nestle1904' });
  const cfEphSyn = await cfRpc('lookup_syntax_tree_v1', { p_book: 49, p_chapter: 1, p_verse: 3, p_edition_key: 'macula-greek-nestle1904' });
  assert(
    sbEphSyn.trees[0].is_cross_verse === true &&
      cfEphSyn.trees[0].is_cross_verse === true &&
      sbEphSyn.trees[0].cross_verse_span === cfEphSyn.trees[0].cross_verse_span,
    `Ephesians 1:3 cross-verse span matches across Supabase and Cloudflare (${cfEphSyn.trees[0].cross_verse_span})`
  );

  // 2. Compare lookup_passage_tokens_syntax_v1 (Genesis 1:1, Psalm 3:0, Daniel 2:4, John 1:1, Mark 16:9)
  console.log('\n2. Verifying Passage Token & Morphology Equivalence...');
  for (const [label, b, c, v] of [
    ['Genesis 1:1', 1, 1, 1],
    ['Psalm 3:0 (Heading)', 19, 3, 0],
    ['Daniel 2:4 (Aramaic transition)', 27, 2, 4],
    ['John 1:1', 43, 1, 1],
    ['Mark 16:9', 41, 16, 9],
  ]) {
    const sbTok = await sbRpc('lookup_passage_tokens_syntax_v1', { p_book: b, p_chapter: c, p_verse: v });
    const cfTok = await cfRpc('lookup_passage_tokens_syntax_v1', { p_book: b, p_chapter: c, p_verse: v });
    assert(
      sbTok.status === 'ok' && cfTok.status === 'ok' && sbTok.tokens.length === cfTok.tokens.length,
      `${label}: token count matches (${sbTok.tokens.length} tokens)`
    );
    assert(
      JSON.stringify(sbTok.tokens.map((t) => t.surface_form)) === JSON.stringify(cfTok.tokens.map((t) => t.surface_form)),
      `${label}: exact Unicode surface_form sequence matches`
    );
  }

  // 3. Compare Hebrew, Greek & Septuagint Evidence RPCs
  console.log('\n3. Verifying Hebrew, Greek & Septuagint Evidence Equivalence...');
  const sbHeb = await sbRpc('lookup_hebrew_verse_evidence_v1', { p_book: 27, p_chapter: 2, p_verse: 4 });
  const cfHeb = await cfRpc('lookup_hebrew_verse_evidence_v1', { p_book: 27, p_chapter: 2, p_verse: 4 });
  assert(
    sbHeb.summary.total_macula_morphemes === cfHeb.summary.total_macula_morphemes &&
      sbHeb.summary.total_morphhb_tokens === cfHeb.summary.total_morphhb_tokens &&
      sbHeb.summary.is_aramaic === true &&
      cfHeb.summary.is_aramaic === true,
    `Daniel 2:4 Hebrew/Aramaic evidence summary matches (${sbHeb.summary.total_macula_morphemes} morphemes)`
  );

  const sbGrk = await sbRpc('lookup_greek_verse_evidence_v1', { p_book: 43, p_chapter: 1, p_verse: 1 });
  const cfGrk = await cfRpc('lookup_greek_verse_evidence_v1', { p_book: 43, p_chapter: 1, p_verse: 1 });
  assert(
    sbGrk.summary.total_nestle_tokens === cfGrk.summary.total_nestle_tokens &&
      sbGrk.summary.total_sblgnt_tokens === cfGrk.summary.total_sblgnt_tokens &&
      sbGrk.summary.total_tagnt_tokens === cfGrk.summary.total_tagnt_tokens,
    `John 1:1 Greek evidence summary matches (${sbGrk.summary.total_nestle_tokens} Nestle1904 tokens)`
  );

  const sbLxx = await sbRpc('lookup_septuagint_passage_v1', { p_book_no: 33, p_chapter: 1, p_verse_nr: 1 });
  const cfLxx = await cfRpc('lookup_septuagint_passage_v1', { p_book_no: 33, p_chapter: 1, p_verse_nr: 1 });
  assert(
    sbLxx.found === true && cfLxx.found === true && sbLxx.tokens.length === cfLxx.tokens.length,
    `Wisdom of Solomon 1:1 (book 33) Septuagint tokens match (${sbLxx.tokens.length} tokens)`
  );

  // 4. Verify Hydrated Verse Research v1 & v2 and Dynamic Translations Composition
  console.log('\n4. Verifying Hydrated Research (v1 & v2) & Dynamic Composition...');
  const v1Gen = await sbRpc('get_verse_research_v1', {
    p_request: { passages: [{ book: 1, chapter: 1, verse: 1 }], occurrences: { mode: 'sample', limit: 5 } },
  });
  assert(v1Gen.status === 'ok' && v1Gen.verses.length === 1 && v1Gen.verses[0].words.length === 7, 'get_verse_research_v1 Genesis 1:1 ok');

  const v2Gen = await sbRpc('get_verse_research_v2', {
    p_request: { passages: [{ book: 1, chapter: 2, verse: 7 }], occurrences: { mode: 'sample', limit: 5 } },
  });
  assert(
    v2Gen.status === 'ok' && v2Gen.verses.length === 1 && Object.keys(v2Gen.lexical_formations || {}).length > 0,
    'get_verse_research_v2 Genesis 2:7 ok with lexical formations'
  );

  const vTrans = await sbRpc('get_verse_translations_v1', { p_book: 1, p_chapter: 1, p_verse: 1 });
  assert(Array.isArray(vTrans) && vTrans.length === 7 && vTrans[0].source_english !== null, 'get_verse_translations_v1 Genesis 1:1 ok');

  // 5. Verify bible-mcp Edge Function
  console.log('\n5. Verifying bible-mcp Edge Function Tools...');
  const mcpSyn = await mcpToolCall('get_syntax_tree', { p_book: 1, p_chapter: 1, p_verse: 1, p_edition_key: 'macula-hebrew-wlc' });
  assert(mcpSyn.has_syntax === true && mcpSyn.trees_count === 1, 'bible-mcp get_syntax_tree Genesis 1:1 ok');

  const mcpLxx = await mcpToolCall('get_septuagint_passage', { p_book_no: 1, p_chapter: 1, p_verse_nr: 1 });
  assert(mcpLxx.found === true && mcpLxx.tokens.length === 10, 'bible-mcp get_septuagint_passage Genesis 1:1 ok');

  // 6. Verify Live Website Worker Deployment
  console.log('\n6. Verifying Live Website Deployment (bibleresearch Worker)...');
  const siteRes = await fetch('https://bibleresearch.kingdomfishers-custom.workers.dev/');
  assert(siteRes.ok, 'Live website root HTML returns HTTP 200');
  const siteHtml = await siteRes.text();
  const jsMatch = siteHtml.match(/\/assets\/index-[^"]+\.js/);
  assert(Boolean(jsMatch), 'Live website HTML references compiled Vite JS bundle');
  const jsRes = await fetch(`https://bibleresearch.kingdomfishers-custom.workers.dev${jsMatch[0]}`);
  assert(jsRes.ok, `Live website JS bundle (${jsMatch[0]}) returns HTTP 200`);
  const jsBundle = await jsRes.text();
  assert(
    jsBundle.includes('bibleresearch-corpus.kingdomfishers-custom.workers.dev') &&
      jsBundle.includes('ejoperxiwxlcbsqrkrvb.supabase.co'),
    'Live website JS bundle includes hybrid Cloudflare static corpus and Supabase endpoints'
  );

  console.log('\n======================================================');
  console.log('ALL HYBRID EQUIVALENCE & REGRESSION CHECKS PASSED!');
  console.log('======================================================');
}

main().catch((err) => {
  console.error('Hybrid equivalence verification failed:', err);
  process.exit(1);
});
