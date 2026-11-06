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

async function getVerseId(book, chapter, verse_nr) {
  const { data } = await queryTable(`verses?book=eq.${book}&chapter=eq.${chapter}&verse_nr=eq.${verse_nr}&select=id`);
  return data?.[0]?.id || null;
}

async function runTests() {
  console.log('=== VERIFYING HEBREW-SEPTUAGINT VERSIFICATION CORRECTIONS ===\n');
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

  // 1. Genesis 1:1 (standard 1:1 correspondence)
  {
    const { ok, data } = await rpcAnon('compare_hebrew_septuagint_passage_v1', {
      p_hebrew_book: 1,
      p_hebrew_chapter: 1,
      p_hebrew_verse: 1,
    });
    assert(ok && data?.status === 'ok', 'Genesis 1:1 resolves successfully');
    assert(data?.septuagint_passage?.book_no === 1 && data?.septuagint_passage?.chapter === 1 && data?.septuagint_passage?.verse_nr === 1,
      'Genesis 1:1 maps 1:1 to LXX Genesis 1:1');
    assert(data?.has_hebrew_passage && data?.has_septuagint_passage,
      'Genesis 1:1 loads both Hebrew and Greek passages');
  }

  // 2. Psalms 1 and 2 (0 conflicting active LXX targets, exactly 1 active mapping to Swete 1:1 and 2:1)
  {
    const ps1v1Id = await getVerseId(19, 1, 1);
    const { data: ps1Active } = await queryTable(`hebrew_lxx_verse_map?canonical_verse_id=eq.${ps1v1Id}&lxx_book_no=not.is.null`);
    assert(ps1Active?.length === 1, `Psalm 1:1 has exactly 1 active LXX mapping (got ${ps1Active?.length})`);
    assert(ps1Active?.[0]?.lxx_chapter === 1 && ps1Active?.[0]?.lxx_verse_nr === 1,
      'Psalm 1:1 active mapping points to LXX Swete 1:1');

    const ps2v1Id = await getVerseId(19, 2, 1);
    const { data: ps2Active } = await queryTable(`hebrew_lxx_verse_map?canonical_verse_id=eq.${ps2v1Id}&lxx_book_no=not.is.null`);
    assert(ps2Active?.length === 1, `Psalm 2:1 has exactly 1 active LXX mapping (got ${ps2Active?.length})`);
    assert(ps2Active?.[0]?.lxx_chapter === 2 && ps2Active?.[0]?.lxx_verse_nr === 1,
      'Psalm 2:1 active mapping points to LXX Swete 2:1');
  }

  // 3. Psalm 3 (superscription title shift: MT 3:1 text maps to LXX Swete 3:2)
  {
    const { ok, data } = await rpcAnon('compare_hebrew_septuagint_passage_v1', {
      p_hebrew_book: 19,
      p_hebrew_chapter: 3,
      p_hebrew_verse: 1,
    });
    assert(ok && data?.septuagint_passage?.chapter === 3 && data?.septuagint_passage?.verse_nr === 2,
      'Psalm 3:1 text maps to LXX Swete 3:2 due to superscription title shift');
  }

  // 4. Psalm 22 (MT 22 -> LXX 21)
  {
    const { ok, data } = await rpcAnon('compare_hebrew_septuagint_passage_v1', {
      p_hebrew_book: 19,
      p_hebrew_chapter: 22,
      p_hebrew_verse: 1,
    });
    assert(ok && data?.septuagint_passage?.chapter === 21,
      'Psalm 22 maps to LXX Swete Psalm 21');
  }

  // 5. Psalm 23 (MT 23:1 -> LXX 22:1 with "Κύριος ποιμαίνει με", MT 23:0 -> LXX 22:32 subscription)
  {
    const { ok, data } = await rpcAnon('compare_hebrew_septuagint_passage_v1', {
      p_hebrew_book: 19,
      p_hebrew_chapter: 23,
      p_hebrew_verse: 1,
    });
    assert(ok && data?.has_hebrew_passage && data?.has_septuagint_passage, 'Psalm 23:1 comparison succeeds');
    assert(data?.septuagint_passage?.chapter === 22 && data?.septuagint_passage?.verse_nr === 1,
      'Psalm 23:1 maps to LXX Swete 22:1');
    const firstLxxToken = data?.septuagint_passage?.words?.[0]?.word_text || '';
    assert(firstLxxToken.includes('Κύριος'),
      `Psalm 23:1 first LXX token is Κύριος (got: "${firstLxxToken}")`);

    // Check MT 23:0 title mapping
    const ps23v0Id = await getVerseId(19, 23, 0);
    const { data: ps23v0Map } = await queryTable(`hebrew_lxx_verse_map?canonical_verse_id=eq.${ps23v0Id}&lxx_book_no=not.is.null`);
    assert(ps23v0Map?.length === 1 && ps23v0Map[0]?.lxx_verse_nr === 32,
      'Psalm 23:0 title maps to LXX Swete 22:32 subscription');
  }

  // 6. Psalm 51 (MT 51 -> LXX 50, title v0 -> v1..2, v1 -> v3)
  {
    const { ok, data } = await rpcAnon('compare_hebrew_septuagint_passage_v1', {
      p_hebrew_book: 19,
      p_hebrew_chapter: 51,
      p_hebrew_verse: 1,
    });
    assert(ok && data?.septuagint_passage?.chapter === 50 && data?.septuagint_passage?.verse_nr === 3,
      'Psalm 51:1 maps to LXX Swete 50:3');
  }

  // 7. Psalm 119 (MT 119 -> LXX 118, verses 1..176)
  {
    const { ok: ok1, data: data1 } = await rpcAnon('compare_hebrew_septuagint_passage_v1', {
      p_hebrew_book: 19,
      p_hebrew_chapter: 119,
      p_hebrew_verse: 1,
    });
    assert(ok1 && data1?.septuagint_passage?.chapter === 118 && data1?.septuagint_passage?.verse_nr === 1,
      'Psalm 119:1 maps to LXX Swete 118:1');

    const { ok: ok176, data: data176 } = await rpcAnon('compare_hebrew_septuagint_passage_v1', {
      p_hebrew_book: 19,
      p_hebrew_chapter: 119,
      p_hebrew_verse: 176,
    });
    assert(ok176 && data176?.septuagint_passage?.chapter === 118 && data176?.septuagint_passage?.verse_nr === 176,
      'Psalm 119:176 maps to LXX Swete 118:176');
  }

  // 8. Isaiah 53 (direct match, check verse 5)
  {
    const { ok, data } = await rpcAnon('compare_hebrew_septuagint_passage_v1', {
      p_hebrew_book: 23,
      p_hebrew_chapter: 53,
      p_hebrew_verse: 5,
    });
    assert(ok && data?.septuagint_passage?.chapter === 53 && data?.septuagint_passage?.verse_nr === 5,
      'Isaiah 53:5 maps 1:1 to LXX Swete 53:5');
    // Ensure word alignments are scholarly or documented, none invented
    const candidateAlignments = data?.candidate_alignments || [];
    assert(candidateAlignments.length === 0, 'No unverified candidate word alignments in Isaiah 53:5');
  }

  // 9. Jeremiah reordered passages and omissions
  {
    // Jer 25:15 MT -> LXX 32:1
    const { ok, data } = await rpcAnon('compare_hebrew_septuagint_passage_v1', {
      p_hebrew_book: 24,
      p_hebrew_chapter: 25,
      p_hebrew_verse: 15,
    });
    assert(ok && data?.septuagint_passage?.chapter === 32 && data?.septuagint_passage?.verse_nr === 1,
      'Jeremiah 25:15 MT maps to LXX Swete 32:1 (major chapter reordering)');

    // Jer 10:6 MT -> unmatched_hebrew (omitted in LXX Swete/Old Greek)
    const jer10v6Id = await getVerseId(24, 10, 6);
    const { data: jer10v6Map } = await queryTable(`hebrew_lxx_verse_map?canonical_verse_id=eq.${jer10v6Id}`);
    assert(jer10v6Map?.length === 1 && jer10v6Map[0]?.mapping_kind === 'unmatched_hebrew',
      'Jeremiah 10:6 is properly classified as unmatched_hebrew (minus in LXX)');
  }

  // 10. 1 Samuel 17:12 (minus in LXX Swete)
  {
    const sam17v12Id = await getVerseId(9, 17, 12);
    const { data: sam17v12Map } = await queryTable(`hebrew_lxx_verse_map?canonical_verse_id=eq.${sam17v12Id}`);
    assert(sam17v12Map?.length === 1 && sam17v12Map[0]?.mapping_kind === 'unmatched_hebrew',
      '1 Samuel 17:12 is properly classified as unmatched_hebrew');
  }

  // 11. Zero active mappings pointing to non-existent LXX verses
  {
    // We already verified in DB query that count = 0, let's also test via REST API that no verse has verse_nr > 176
    const { data: invalidMatches } = await queryTable('hebrew_lxx_verse_map?lxx_verse_nr=gt.176');
    assert(Array.isArray(invalidMatches) && invalidMatches.length === 0,
      'Zero active mappings have lxx_verse_nr > 176');
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
