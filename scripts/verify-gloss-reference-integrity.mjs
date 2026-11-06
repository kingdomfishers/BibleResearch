// @file: scripts/verify-gloss-reference-integrity.mjs
// Verification & Reproduction of the Gloss-Reference Disconnect Bug (F2-01)
// Checks whether sample_passage.source_ref in lookup_lemma_english_glosses_v1
// matches the actual book, chapter, and verse returned for that sample.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

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

console.log('=== Gloss-Reference Disconnect Investigation & Reproduction (F2-01) ===\n');

async function testGlossReferences() {
  const booksRes = await rpc('get_bible_books_v1', {});
  const bookMap = new Map((booksRes.books || []).map(b => [b.id, b.usfm.toUpperCase()]));

  const testLemmas = ['H430', 'G3056', 'H7225'];
  let totalGlossCount = 0;
  let mismatchedGlosses = 0;
  const mismatches = [];

  for (const q of testLemmas) {
    console.log(`Checking attested glosses for lemma ${q}...`);
    const data = await rpc('lookup_lemma_english_glosses_v1', { p_lemma_query: q, p_limit: 10 });
    if (data.status !== 'ok') {
      throw new Error(`Lookup failed for ${q}: ${JSON.stringify(data)}`);
    }

    const glosses = data.attested_english_glosses || [];
    for (const g of glosses) {
      totalGlossCount++;
      const sp = g.sample_passage;
      const ref = sp.source_ref || '';
      
      // Expected ref starts with standard book abbreviation (e.g., Gen, Exo, 1Ki, etc.)
      // and contains chapter.verse (e.g. "Gen.1.1" or "1Ki.11.33")
      const cvPattern = `${sp.chapter}.${sp.verse}`;
      const hasMatch = ref.includes(`.${cvPattern}`) || ref.includes(` ${cvPattern}`) || ref.startsWith(`${cvPattern}`);

      // Check book compatibility using book USFM map or standard abbreviation
      const refBook = ref.split('.')[0]?.toUpperCase();
      const targetUsfm = bookMap.get(sp.book);
      const bookPrefixMatches = targetUsfm && (targetUsfm === refBook);

      if (!hasMatch || !bookPrefixMatches) {
        mismatchedGlosses++;
        mismatches.push({
          lemma: q,
          gloss: g.attested_gloss,
          passage_reported: `${sp.book_name} ${sp.chapter}:${sp.verse} (book_id=${sp.book})`,
          source_ref_cited: sp.source_ref,
        });
      }
    }
  }

  console.log(`\nChecked ${totalGlossCount} attested gloss sample references across ${testLemmas.length} lemmas.`);
  if (mismatches.length > 0) {
    console.log(`\n[REPRODUCED] Found ${mismatches.length} gloss-reference mismatches:`);
    mismatches.slice(0, 10).forEach((m, idx) => {
      console.log(`  ${idx + 1}. [${m.lemma}] "${m.gloss}":`);
      console.log(`     Reported Passage: ${m.passage_reported}`);
      console.log(`     Cited Source Ref: ${m.source_ref_cited} (DISCONNECTED)`);
    });
    return { status: 'reproduced', mismatches };
  } else {
    console.log('\n[CLEAN] All sample passages have 100% synchronized source_ref citations.');
    return { status: 'clean', mismatches: [] };
  }
}

testGlossReferences().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
