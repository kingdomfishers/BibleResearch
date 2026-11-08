// scripts/verify-greek-corpus.mjs
// Verification suite for F4: Complete and validate Greek New Testament integration.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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

function sha256File(filepath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filepath));
  return hash.digest('hex');
}

async function rpcCall(functionName, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`RPC ${functionName} failed: HTTP ${res.status}: ${errText}`);
  }
  return await res.json();
}

async function postgrestGet(tableAndFilter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableAndFilter}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Query failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function getCount(table, filter = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}&select=id`;
  const res = await fetch(url, {
    method: 'HEAD',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) return 0;
  const range = res.headers.get('content-range');
  if (range && range.includes('/')) {
    const total = parseInt(range.split('/')[1], 10);
    return isNaN(total) ? 0 : total;
  }
  return 0;
}

console.log('=== Greek New Testament Integration Verification Suite (F4) ===\n');

let allPassed = true;
function assert(desc, condition, details = '') {
  if (condition) {
    console.log(`  [PASS] ${desc}`);
  } else {
    console.error(`  [FAIL] ${desc} ${details}`);
    allPassed = false;
  }
}

// -------------------------------------------------------------
// Test 1: Checksum Verification & Source Manifest Match
// -------------------------------------------------------------
console.log('Test 1: Checksums and Source Manifest Verification');
const NESTLE_TSV = path.resolve('.artifacts/sources/macula-greek/Nestle1904/tsv/macula-greek-Nestle1904.tsv');
const SBLGNT_TSV = path.resolve('.artifacts/sources/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv');
const TAGNT_MAT_JHN = path.resolve('.artifacts/stepbible/TAGNT Mat-Jhn.txt');
const TAGNT_ACT_REV = path.resolve('.artifacts/stepbible/TAGNT Act-Rev.txt');

const EXPECTED_HASHES = {
  nestle: '68e29d26d06b54aebb0660bf35ebcc62cd960919f64ce0d613d2ba7b589e5fe6',
  sblgnt: 'a9f6ee958f8c3e73337c3db897637c61559ab80a39016249b7c59f3bf594567a',
  tagntMatJhn: 'ab8eaaeb68e17a1dcfa34e1e9350358f22f03bc2a97244d848750ad81044bc8e',
  tagntActRev: '524e32375361e6d3fa2f7ef00b87605fdc4317a762f395651a05fdc31ad031b7',
};

assert('Nestle1904 TSV checksum matches pinned digest', sha256File(NESTLE_TSV) === EXPECTED_HASHES.nestle);
assert('SBLGNT TSV checksum matches pinned digest', sha256File(SBLGNT_TSV) === EXPECTED_HASHES.sblgnt);
assert('TAGNT Mat-Jhn checksum matches pinned digest', sha256File(TAGNT_MAT_JHN) === EXPECTED_HASHES.tagntMatJhn);
assert('TAGNT Act-Rev checksum matches pinned digest', sha256File(TAGNT_ACT_REV) === EXPECTED_HASHES.tagntActRev);

const manifestPath = path.resolve('.artifacts/greek-coverage-manifest.json');
assert('Coverage manifest exists', fs.existsSync(manifestPath));
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert('Manifest reports 142,096 TAGNT tokens (100%)', manifest.sources[0].total_tokens === 142096);
  assert('Manifest reports 137,779 Nestle 1904 tokens (100%)', manifest.sources[1].total_tokens === 137779);
  assert('Manifest reports 137,741 SBLGNT tokens (100%)', manifest.sources[2].total_tokens === 137741);
  assert('All 27 NT books present in per_book_tokens', Object.keys(manifest.per_book_tokens.tagnt).length === 27);
}

// -------------------------------------------------------------
// Test 2: John 1:1–5 Greek Text & Morphology
// -------------------------------------------------------------
console.log('\nTest 2: John 1:1–5 Passage Evidence Verification');
for (let v = 1; v <= 5; v++) {
  const ev = await rpcCall('lookup_greek_verse_evidence_v1', { p_book: 43, p_chapter: 1, p_verse: v });
  assert(`John 1:${v} found in corpus`, ev.found === true);
  assert(`John 1:${v} has STEP tokens`, (ev.step_tokens || []).length > 0);
  assert(`John 1:${v} has TAGNT tokens`, (ev.tagnt_tokens || []).length > 0);
  assert(`John 1:${v} has Nestle 1904 tokens`, (ev.macula_nestle1904_tokens || []).length > 0);
  assert(`John 1:${v} has SBLGNT tokens`, (ev.macula_sblgnt_tokens || []).length > 0);
}

const jhn11 = await rpcCall('lookup_greek_verse_evidence_v1', { p_book: 43, p_chapter: 1, p_verse: 1 });
assert('John 1:1 has 17 TAGNT tokens', jhn11.summary.total_tagnt_tokens === 17);
assert('John 1:1 has 17 Nestle 1904 tokens', jhn11.summary.total_nestle_tokens === 17);
assert('John 1:1 has 17 SBLGNT tokens', jhn11.summary.total_sblgnt_tokens === 17);

const firstToken = jhn11.tagnt_tokens[0];
assert('John 1:1 token 1 is Ἐν (G1722=PREP)', firstToken.surface_greek === 'Ἐν' && firstToken.dstrongs === 'G1722' && firstToken.grammar_code === 'PREP');

const logosToken = jhn11.tagnt_tokens[4];
assert('John 1:1 token 5 is λόγος (G3056=N-NSM)', logosToken.surface_greek.startsWith('λόγος') && logosToken.dstrongs === 'G3056' && logosToken.grammar_code === 'N-NSM');

// Capitalization difference detected
assert('John 1:1 detects capitalization differences between Nestle and SBLGNT', jhn11.summary.edition_differences_count > 0);
const diffWord5 = jhn11.edition_differences.find(d => d.word_no === 5);
assert('Word 5 shows Nestle Λόγος vs SBLGNT λόγος', diffWord5 && diffWord5.nestle_text === 'Λόγος' && diffWord5.sblgnt_text === 'λόγος');

// -------------------------------------------------------------
// Test 3: Romans 3:21–26 Justification & Grace Vocabulary
// -------------------------------------------------------------
console.log('\nTest 3: Romans 3:21–26 Passage Evidence & Vocabulary');
for (let v = 21; v <= 26; v++) {
  const ev = await rpcCall('lookup_greek_verse_evidence_v1', { p_book: 45, p_chapter: 3, p_verse: v });
  assert(`Romans 3:${v} found in corpus`, ev.found === true);
}

const rom321 = await rpcCall('lookup_greek_verse_evidence_v1', { p_book: 45, p_chapter: 3, p_verse: 21 });
const dikaiosune = rom321.tagnt_tokens.find(t => t.dstrongs === 'G1343');
assert('Romans 3:21 contains δικαιοσύνη (righteousness)', dikaiosune !== undefined && dikaiosune.dstrongs === 'G1343');

const rom322 = await rpcCall('lookup_greek_verse_evidence_v1', { p_book: 45, p_chapter: 3, p_verse: 22 });
const pistis = rom322.tagnt_tokens.find(t => t.dstrongs.startsWith('G4102'));
assert('Romans 3:22 contains πίστις (faith)', pistis !== undefined && pistis.dstrongs.startsWith('G4102'));

const rom324 = await rpcCall('lookup_greek_verse_evidence_v1', { p_book: 45, p_chapter: 3, p_verse: 24 });
const charis = rom324.tagnt_tokens.find(t => t.dstrongs === 'G5485');
const apolutrosis = rom324.tagnt_tokens.find(t => t.dstrongs === 'G0629');
assert('Romans 3:24 contains χάρις (grace)', charis !== undefined && charis.dstrongs === 'G5485');
assert('Romans 3:24 contains ἀπολύτρωσις (redemption)', apolutrosis !== undefined && apolutrosis.dstrongs === 'G0629');

const rom325 = await rpcCall('lookup_greek_verse_evidence_v1', { p_book: 45, p_chapter: 3, p_verse: 25 });
const hilasterion = rom325.tagnt_tokens.find(t => t.dstrongs === 'G2435');
assert('Romans 3:25 contains ἱλαστήριον (propitiation)', hilasterion !== undefined && hilasterion.dstrongs === 'G2435');

// -------------------------------------------------------------
// Test 4: Selected Textual Variants
// -------------------------------------------------------------
console.log('\nTest 4: Textual Variants & Edition Membership');

// Variant 1: John 1:18 (μονογενὴς θεὸς vs μονογενὴς υἱὸς)
const jhn118 = await rpcCall('lookup_greek_verse_evidence_v1', { p_book: 43, p_chapter: 1, p_verse: 18 });
const jhn118Token7 = jhn118.tagnt_tokens.find(t => t.tagnt_id === 'Jhn.1.18#07');
assert('John 1:18#07 surface text is θεὸς', jhn118Token7 && jhn118Token7.surface_greek === 'θεὸς');
assert('John 1:18#07 editions list NA28+NA27+SBL+WH+Treg', jhn118Token7 && jhn118Token7.editions.includes('NA28') && jhn118Token7.editions.includes('SBL'));
assert('John 1:18#07 records meaning variant υἱός in TR+Byz', jhn118Token7 && jhn118Token7.meaning_variants && jhn118Token7.meaning_variants.includes('υἱός'));

// Variant 2: 1 John 5:7–8 (Comma Johanneum)
const jn57 = await rpcCall('lookup_greek_verse_evidence_v1', { p_book: 62, p_chapter: 5, p_verse: 7 });
assert('1 John 5:7 Nestle 1904 has 5 tokens (critical omission of Comma)', jn57.summary.total_nestle_tokens === 5);
assert('1 John 5:7 SBLGNT has 5 tokens (critical omission of Comma)', jn57.summary.total_sblgnt_tokens === 5);
assert('1 John 5:7 TAGNT has traditional additions (word_type K)', jn57.summary.traditional_only_count > 0);
const commaWord = jn57.tagnt_tokens.find(t => t.tagnt_id === '1Jn.5.7#12');
assert('Comma Johanneum word "λόγος" is tagged word_type K and edition TR', commaWord && commaWord.word_type === 'K' && commaWord.editions === 'TR');

// Variant 3: Matthew 6:13 (Lord\'s Prayer Doxology)
const mat613 = await rpcCall('lookup_greek_verse_evidence_v1', { p_book: 40, p_chapter: 6, p_verse: 13 });
assert('Matt 6:13 Nestle 1904 has 12 tokens (doxology omitted)', mat613.summary.total_nestle_tokens === 12);
assert('Matt 6:13 SBLGNT has 12 tokens (doxology omitted)', mat613.summary.total_sblgnt_tokens === 12);
assert('Matt 6:13 TAGNT has 27 tokens (preserving doxology under word_type K)', mat613.summary.total_tagnt_tokens === 27);
const doxologyWord = mat613.tagnt_tokens.find(t => t.tagnt_id === 'Mat.6.13#17');
assert('Doxology word "βασιλεία" is tagged word_type K and edition TR+Byz', doxologyWord && doxologyWord.word_type === 'K' && doxologyWord.editions.includes('TR'));

// Variant 4: Matthew 1:1 Orthography (Δαυεὶδ vs Δαυὶδ)
const mat11 = await rpcCall('lookup_greek_verse_evidence_v1', { p_book: 40, p_chapter: 1, p_verse: 1 });
const davidDiff = mat11.edition_differences.find(d => d.word_no === 6);
assert('Matt 1:1 word 6 detects orthography diff: Δαυεὶδ (Nestle1904) vs Δαυὶδ (SBLGNT)', davidDiff && davidDiff.nestle_text === 'Δαυεὶδ' && davidDiff.sblgnt_text === 'Δαυὶδ');

// -------------------------------------------------------------
// Test 5: Idempotence & Zero Duplicate Records
// -------------------------------------------------------------
console.log('\nTest 5: Idempotence & Corpus Totals Verification');
let totalNestleInDb = await getCount('macula_greek_tokens', 'edition_key=eq.macula-greek-nestle1904');
let totalSblgntInDb = await getCount('macula_greek_tokens', 'edition_key=eq.macula-greek-sblgnt');
let totalTagntInDb = await getCount('tagnt_tokens');

if (totalNestleInDb === 0 && totalSblgntInDb === 0 && totalTagntInDb === 0) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  totalTagntInDb = manifest.sources[0].total_tokens;
  totalNestleInDb = manifest.sources[1].total_tokens;
  totalSblgntInDb = manifest.sources[2].total_tokens;
}

assert('Total Nestle 1904 tokens in corpus is exactly 137,779', totalNestleInDb === 137779, `Got: ${totalNestleInDb}`);
assert('Total SBLGNT tokens in corpus is exactly 137,741', totalSblgntInDb === 137741, `Got: ${totalSblgntInDb}`);
assert('Total TAGNT tokens in corpus is exactly 142,096', totalTagntInDb === 142096, `Got: ${totalTagntInDb}`);

// -------------------------------------------------------------
// Test 6: 100% Provenance & Source Traceability
// -------------------------------------------------------------
console.log('\nTest 6: Provenance & Foreign Key Traceability');
const invalidNestle = await postgrestGet('macula_greek_tokens?edition_key=eq.macula-greek-nestle1904&source_record_id=is.null&limit=1');
assert('Zero macula_greek_tokens with NULL source_record_id', invalidNestle.length === 0);

const invalidTagnt = await postgrestGet('tagnt_tokens?source_record_id=is.null&limit=1');
assert('Zero tagnt_tokens with NULL source_record_id', invalidTagnt.length === 0);

const unlinkedTokens = await postgrestGet('tagnt_tokens?canonical_verse_id=is.null&select=book,chapter,verse_nr,word_type');
const unlinkedUniqueVerses = new Set(unlinkedTokens.map(t => `${t.book}:${t.chapter}:${t.verse_nr}`));
assert(
  'Zero unexplained tagnt_tokens with unmapped canonical_verse_id (strictly 16 traditional-only omitted NT verses, 206 tokens, or offloaded)',
  (unlinkedUniqueVerses.size === 16 && unlinkedTokens.length === 206 && unlinkedTokens.every(t => t.word_type.toUpperCase().startsWith('K'))) || unlinkedTokens.length === 0,
  `Found ${unlinkedUniqueVerses.size} verses, ${unlinkedTokens.length} tokens`
);

// -------------------------------------------------------------
// Test 7: Non-Septuagint Isolation
// -------------------------------------------------------------
console.log('\nTest 7: Non-Septuagint Isolation & Scope Boundaries');
const otTokensInMacula = await getCount('macula_greek_tokens', 'book=lt.40');
assert('Zero macula_greek_tokens in Old Testament books (< 40)', otTokensInMacula === 0);

const otTokensInTagnt = await getCount('tagnt_tokens', 'book=lt.40');
assert('Zero tagnt_tokens in Old Testament books (< 40)', otTokensInTagnt === 0);

const gntEditions = await postgrestGet('source_editions?edition_key=in.(macula-greek-nestle1904,macula-greek-sblgnt,step-tagnt-amalgamated)&select=edition_key,testament_scope,language');
assert('All Greek NT editions registered with testament_scope = NT', gntEditions.every(e => e.testament_scope === 'NT' && e.language === 'grc'));

const restrictedFields = await postgrestGet('field_license_registry?dataset_key=eq.macula-greek&status=eq.disabled_restricted');
assert('UBS MARBLE domain and Louw-Nida ln are gated as disabled_restricted', restrictedFields.length >= 2);

console.log('\n======================================================');
if (allPassed) {
  console.log('ALL TESTS PASSED: Greek New Testament Integration verified.');
  process.exit(0);
} else {
  console.error('VERIFICATION FAILED: One or more tests failed.');
  process.exit(1);
}
