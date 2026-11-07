// @file: scripts/verify-book-refs.mjs
// @feature: notes-reference-parser
// Verification suite for NOTE-11: Book aliases and reference parser
// Verifies:
// 1. Table-driven reference parsing (>= 40 cases across scopes, formats, books, edge cases)
// 2. All 66 canonical books resolvable by official name and by USFM code
// 3. Zero alias ambiguity in book_aliases table
// 4. Security: anon write denials on book_aliases table

import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

const hdr = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

let passed = 0;
let failed = 0;

function assert(condition, message, details = '') {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}${details ? ' -> ' + details : ''}`);
    failed++;
  }
}

async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: hdr,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function queryTable(endpoint) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    headers: hdr,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function run() {
  console.log('=== NOTE-11: Book Aliases and Reference Parser Verification Suite ===\n');

  // =========================================================================
  // SECTION 1: Security - Anon Write Denials on book_aliases
  // =========================================================================
  console.log('1. Testing anonymous write denials on book_aliases (TP-SEC-1)...');
  const postRes = await fetch(`${SUPABASE_URL}/rest/v1/book_aliases`, {
    method: 'POST',
    headers: hdr,
    body: JSON.stringify({ alias: 'malicious', book_id: 1, kind: 'abbrev' }),
  });
  assert(postRes.status >= 400, 'POST /rest/v1/book_aliases denied to anon', `status ${postRes.status}`);

  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/book_aliases?alias=eq.gen`, {
    method: 'PATCH',
    headers: hdr,
    body: JSON.stringify({ book_id: 2 }),
  });
  assert(patchRes.status >= 400, 'PATCH /rest/v1/book_aliases denied to anon', `status ${patchRes.status}`);

  const deleteRes = await fetch(`${SUPABASE_URL}/rest/v1/book_aliases?alias=eq.gen`, {
    method: 'DELETE',
    headers: hdr,
  });
  assert(deleteRes.status >= 400, 'DELETE /rest/v1/book_aliases denied to anon', `status ${deleteRes.status}`);

  // =========================================================================
  // SECTION 2: Catalog Check - Aliases count & Zero Ambiguity
  // =========================================================================
  console.log('\n2. Testing book_aliases coverage and uniqueness...');
  const aliasesRes = await queryTable('book_aliases?select=alias,book_id,kind');
  assert(aliasesRes.status === 200, 'book_aliases is readable by anon');
  const aliases = aliasesRes.data || [];
  assert(aliases.length >= 200, `book_aliases seeded with adequate coverage (${aliases.length} aliases found)`);

  const aliasMap = new Map();
  let duplicateCount = 0;
  for (const row of aliases) {
    if (aliasMap.has(row.alias)) {
      duplicateCount++;
    } else {
      aliasMap.set(row.alias, row.book_id);
    }
  }
  assert(duplicateCount === 0, 'Zero duplicate aliases in book_aliases table');

  // =========================================================================
  // SECTION 3: 66 Canonical Books Resolvable by Name and USFM
  // =========================================================================
  console.log('\n3. Testing resolution of all 66 books by name and USFM code...');
  const booksRes = await queryTable('books?select=id,name,usfm&order=id.asc');
  assert(booksRes.status === 200, 'books table readable');
  const books = booksRes.data || [];
  assert(books.length === 66, `All 66 canonical books found in database (count: ${books.length})`);

  let namePassCount = 0;
  let usfmPassCount = 0;
  for (const b of books) {
    const resName = await rpc('parse_bible_ref_v1', { p_text: b.name });
    if (resName.data?.status === 'ok' && resName.data?.book === b.id && resName.data?.scope === 'book') {
      namePassCount++;
    } else {
      console.error(`  Failed on book name: ${b.name}`, resName.data);
    }

    const resUsfm = await rpc('parse_bible_ref_v1', { p_text: b.usfm });
    if (resUsfm.data?.status === 'ok' && resUsfm.data?.book === b.id && resUsfm.data?.scope === 'book') {
      usfmPassCount++;
    } else {
      console.error(`  Failed on USFM code: ${b.usfm}`, resUsfm.data);
    }
  }
  assert(namePassCount === 66, 'All 66 books successfully resolved by official name');
  assert(usfmPassCount === 66, 'All 66 books successfully resolved by USFM code');

  // =========================================================================
  // SECTION 4: Table-Driven Cases (>= 40 cases)
  // =========================================================================
  console.log('\n4. Testing table-driven reference parsing cases (>= 40 cases)...');
  const testCases = [
    // Standard verse formats
    { input: 'Gen 1:1', expected: { status: 'ok', book: 1, chapter: 1, verse_start: 1, verse_end: 1, scope: 'verse', canonical: 'Genesis 1:1', verse_ids: [1, 1] } },
    { input: 'Gen 1.1', expected: { status: 'ok', book: 1, chapter: 1, verse_start: 1, verse_end: 1, scope: 'verse', canonical: 'Genesis 1:1', verse_ids: [1, 1] } },
    { input: 'Genesis 1:1', expected: { status: 'ok', book: 1, chapter: 1, verse_start: 1, verse_end: 1, scope: 'verse', canonical: 'Genesis 1:1' } },
    { input: 'John 3:16', expected: { status: 'ok', book: 43, chapter: 3, verse_start: 16, verse_end: 16, scope: 'verse', canonical: 'John 3:16' } },
    { input: 'Jn 3:16', expected: { status: 'ok', book: 43, chapter: 3, verse_start: 16, verse_end: 16, scope: 'verse', canonical: 'John 3:16' } },
    { input: 'Jn3:16', expected: { status: 'ok', book: 43, chapter: 3, verse_start: 16, verse_end: 16, scope: 'verse', canonical: 'John 3:16' } },
    { input: 'jhn 3.16', expected: { status: 'ok', book: 43, chapter: 3, verse_start: 16, verse_end: 16, scope: 'verse', canonical: 'John 3:16' } },

    // Ranges within a chapter
    { input: 'Genesis 1:1-3', expected: { status: 'ok', book: 1, chapter: 1, verse_start: 1, verse_end: 3, scope: 'range', canonical: 'Genesis 1:1-3', verse_ids: [1, 3] } },
    { input: 'John 3:16-18', expected: { status: 'ok', book: 43, chapter: 3, verse_start: 16, verse_end: 18, scope: 'range', canonical: 'John 3:16-18' } },
    { input: 'Gen 9:5-7', expected: { status: 'ok', book: 1, chapter: 9, verse_start: 5, verse_end: 7, scope: 'range', canonical: 'Genesis 9:5-7' } },
    { input: 'Rom 8:28-30', expected: { status: 'ok', book: 45, chapter: 8, verse_start: 28, verse_end: 30, scope: 'range', canonical: 'Romans 8:28-30' } },
    { input: 'Matt 5:1-12', expected: { status: 'ok', book: 40, chapter: 5, verse_start: 1, verse_end: 12, scope: 'range', canonical: 'Matthew 5:1-12' } },

    // Chapter-only scope
    { input: '1 Cor 13', expected: { status: 'ok', book: 46, chapter: 13, verse_start: 1, verse_end: 13, scope: 'chapter', canonical: '1 Corinthians 13' } },
    { input: 'Gen 1', expected: { status: 'ok', book: 1, chapter: 1, verse_start: 1, verse_end: 31, scope: 'chapter', canonical: 'Genesis 1', verse_ids: [1, 31] } },
    { input: 'Psalm 23', expected: { status: 'ok', book: 19, chapter: 23, scope: 'chapter', canonical: 'Psalms 23' } },
    { input: 'Rev 22', expected: { status: 'ok', book: 66, chapter: 22, scope: 'chapter', canonical: 'Revelation 22' } },

    // Psalm 3:0 heading (verse 0)
    { input: 'Ps 3:0', expected: { status: 'ok', book: 19, chapter: 3, verse_start: 0, verse_end: 0, scope: 'verse', canonical: 'Psalms 3:0', verse_ids: [13959, 13959] } },
    { input: 'Psalm 3:0', expected: { status: 'ok', book: 19, chapter: 3, verse_start: 0, verse_end: 0, scope: 'verse', canonical: 'Psalms 3:0' } },
    { input: 'Pss 3:0', expected: { status: 'ok', book: 19, chapter: 3, verse_start: 0, verse_end: 0, scope: 'verse', canonical: 'Psalms 3:0' } },

    // Numbered book variants (Arabic, Roman, spelled-out)
    { input: '1 John 5:7', expected: { status: 'ok', book: 62, chapter: 5, verse_start: 7, verse_end: 7, scope: 'verse', canonical: '1 John 5:7' } },
    { input: '1John 5:7', expected: { status: 'ok', book: 62, chapter: 5, verse_start: 7, verse_end: 7, scope: 'verse', canonical: '1 John 5:7' } },
    { input: '1John5:7', expected: { status: 'ok', book: 62, chapter: 5, verse_start: 7, verse_end: 7, scope: 'verse', canonical: '1 John 5:7' } },
    { input: 'I John 5:7', expected: { status: 'ok', book: 62, chapter: 5, verse_start: 7, verse_end: 7, scope: 'verse', canonical: '1 John 5:7' } },
    { input: 'First John 5:7', expected: { status: 'ok', book: 62, chapter: 5, verse_start: 7, verse_end: 7, scope: 'verse', canonical: '1 John 5:7' } },
    { input: '1st John 5:7', expected: { status: 'ok', book: 62, chapter: 5, verse_start: 7, verse_end: 7, scope: 'verse', canonical: '1 John 5:7' } },
    { input: '2 Kings 4:1-10', expected: { status: 'ok', book: 12, chapter: 4, verse_start: 1, verse_end: 10, scope: 'range', canonical: '2 Kings 4:1-10' } },
    { input: 'II Kings 4:1', expected: { status: 'ok', book: 12, chapter: 4, verse_start: 1, verse_end: 1, scope: 'verse', canonical: '2 Kings 4:1' } },
    { input: 'Second Kings 4:1', expected: { status: 'ok', book: 12, chapter: 4, verse_start: 1, verse_end: 1, scope: 'verse', canonical: '2 Kings 4:1' } },
    { input: '1 Cor 13:4-8', expected: { status: 'ok', book: 46, chapter: 13, verse_start: 4, verse_end: 8, scope: 'range', canonical: '1 Corinthians 13:4-8' } },
    { input: '2 Cor 5:17', expected: { status: 'ok', book: 47, chapter: 5, verse_start: 17, verse_end: 17, scope: 'verse', canonical: '2 Corinthians 5:17' } },
    { input: '1 Thess 5:16', expected: { status: 'ok', book: 52, chapter: 5, verse_start: 16, verse_end: 16, scope: 'verse', canonical: '1 Thessalonians 5:16' } },
    { input: '2 Thess 2:1-3', expected: { status: 'ok', book: 53, chapter: 2, verse_start: 1, verse_end: 3, scope: 'range', canonical: '2 Thessalonians 2:1-3' } },
    { input: '1 Tim 6:12', expected: { status: 'ok', book: 54, chapter: 6, verse_start: 12, verse_end: 12, scope: 'verse', canonical: '1 Timothy 6:12' } },
    { input: '2 Tim 3:16', expected: { status: 'ok', book: 55, chapter: 3, verse_start: 16, verse_end: 16, scope: 'verse', canonical: '2 Timothy 3:16' } },
    { input: '1 Pet 5:7', expected: { status: 'ok', book: 60, chapter: 5, verse_start: 7, verse_end: 7, scope: 'verse', canonical: '1 Peter 5:7' } },
    { input: '2 Pet 3:9', expected: { status: 'ok', book: 61, chapter: 3, verse_start: 9, verse_end: 9, scope: 'verse', canonical: '2 Peter 3:9' } },
    { input: '3 John 4', expected: { status: 'ok', book: 64, chapter: 1, verse_start: 4, verse_end: 4, scope: 'verse', canonical: '3 John 1:4' } },

    // Multi-word book names & alternate names
    { input: 'Song of Songs 2:1', expected: { status: 'ok', book: 22, chapter: 2, verse_start: 1, verse_end: 1, scope: 'verse', canonical: 'Song of Solomon 2:1' } },
    { input: 'Song of Solomon 2:1', expected: { status: 'ok', book: 22, chapter: 2, verse_start: 1, verse_end: 1, scope: 'verse', canonical: 'Song of Solomon 2:1' } },
    { input: 'Canticles 2:1', expected: { status: 'ok', book: 22, chapter: 2, verse_start: 1, verse_end: 1, scope: 'verse', canonical: 'Song of Solomon 2:1' } },
    { input: 'SoS 2:1', expected: { status: 'ok', book: 22, chapter: 2, verse_start: 1, verse_end: 1, scope: 'verse', canonical: 'Song of Solomon 2:1' } },
    { input: 'Qoh 3:1', expected: { status: 'ok', book: 21, chapter: 3, verse_start: 1, verse_end: 1, scope: 'verse', canonical: 'Ecclesiastes 3:1' } },
    { input: 'Eccl 3:1', expected: { status: 'ok', book: 21, chapter: 3, verse_start: 1, verse_end: 1, scope: 'verse', canonical: 'Ecclesiastes 3:1' } },

    // Single-chapter books: bare number is verse; chapter 1 explicit also works
    { input: 'Obad 5', expected: { status: 'ok', book: 31, chapter: 1, verse_start: 5, verse_end: 5, scope: 'verse', canonical: 'Obadiah 1:5' } },
    { input: 'Obad 1:5', expected: { status: 'ok', book: 31, chapter: 1, verse_start: 5, verse_end: 5, scope: 'verse', canonical: 'Obadiah 1:5' } },
    { input: 'Obad 1:1', expected: { status: 'ok', book: 31, chapter: 1, verse_start: 1, verse_end: 1, scope: 'verse', canonical: 'Obadiah 1:1' } },
    { input: 'Obad 1-5', expected: { status: 'ok', book: 31, chapter: 1, verse_start: 1, verse_end: 5, scope: 'range', canonical: 'Obadiah 1:1-5' } },
    { input: 'Phlm 5', expected: { status: 'ok', book: 57, chapter: 1, verse_start: 5, verse_end: 5, scope: 'verse', canonical: 'Philemon 1:5' } },
    { input: 'Jude 24', expected: { status: 'ok', book: 65, chapter: 1, verse_start: 24, verse_end: 24, scope: 'verse', canonical: 'Jude 1:24' } },
    { input: '2 John 1', expected: { status: 'ok', book: 63, chapter: 1, verse_start: 1, verse_end: 1, scope: 'verse', canonical: '2 John 1:1' } },

    // Book-only scope
    { input: 'Genesis', expected: { status: 'ok', book: 1, scope: 'book', canonical: 'Genesis', verse_ids: [1, 1533] } },
    { input: 'Gen', expected: { status: 'ok', book: 1, scope: 'book', canonical: 'Genesis', verse_ids: [1, 1533] } },
    { input: 'Exodus', expected: { status: 'ok', book: 2, scope: 'book', canonical: 'Exodus' } },
    { input: 'Revelation', expected: { status: 'ok', book: 66, scope: 'book', canonical: 'Revelation' } },
    { input: 'Rev', expected: { status: 'ok', book: 66, scope: 'book', canonical: 'Revelation' } },
    { input: 'Apocalypse', expected: { status: 'ok', book: 66, scope: 'book', canonical: 'Revelation' } },

    // Invalid references
    { input: 'Gen 51:1', expected: { status: 'invalid', reason: 'chapter_out_of_range' } },
    { input: 'Gen 1:99', expected: { status: 'invalid', reason: 'verse_out_of_range' } },
    { input: 'Gen 1:0', expected: { status: 'invalid', reason: 'verse_out_of_range' } },
    { input: 'foo 1:1', expected: { status: 'invalid', reason: 'unknown_book' } },
    { input: '', expected: { status: 'invalid', reason: 'empty_input' } },
    { input: '   ', expected: { status: 'invalid', reason: 'empty_input' } },
    { input: '12345', expected: { status: 'invalid', reason: 'unparseable_reference' } },
  ];

  let casePassCount = 0;
  for (const tc of testCases) {
    const res = await rpc('parse_bible_ref_v1', { p_text: tc.input });
    const data = res.data;
    let ok = (data?.status === tc.expected.status);

    if (tc.expected.status === 'ok') {
      if (tc.expected.book !== undefined && data?.book !== tc.expected.book) ok = false;
      if (tc.expected.chapter !== undefined && data?.chapter !== tc.expected.chapter) ok = false;
      if (tc.expected.verse_start !== undefined && data?.verse_start !== tc.expected.verse_start) ok = false;
      if (tc.expected.verse_end !== undefined && data?.verse_end !== tc.expected.verse_end) ok = false;
      if (tc.expected.scope !== undefined && data?.scope !== tc.expected.scope) ok = false;
      if (tc.expected.canonical !== undefined && data?.canonical !== tc.expected.canonical) ok = false;
      if (tc.expected.verse_ids !== undefined) {
        if (!data?.verse_ids || data.verse_ids[0] !== tc.expected.verse_ids[0] || data.verse_ids[1] !== tc.expected.verse_ids[1]) {
          ok = false;
        }
      }
    } else {
      if (tc.expected.reason !== undefined && data?.reason !== tc.expected.reason) ok = false;
    }

    assert(ok, `Ref parsed: "${tc.input}" -> ${JSON.stringify(data)}`);
    if (ok) casePassCount++;
  }

  assert(casePassCount === testCases.length, `All ${testCases.length} table-driven reference parsing cases passed`);

  console.log(`\n=== Verification Complete: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
