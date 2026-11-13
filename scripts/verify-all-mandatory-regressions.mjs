import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

function loadGzipJson(relPath) {
  const fullPath = path.resolve('.artifacts/static-corpus', relPath.replace(/^\//, ''));
  const buf = fs.readFileSync(fullPath);
  return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
}

function consonants(s) {
  if (!s) return '';
  return s.replace(/[^\u05D0-\u05EA]/g, '');
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed++;
  } else {
    console.log(`PASS: ${message}`);
    passed++;
  }
}

console.log('=== Mandatory Biblical Mappings Regression Suite ===\n');

// 1. Genesis 1:1
const gen1 = loadGzipJson('/v1/chapters/b1-c1.json.gz');
const gen1_1 = gen1.verses['1'];
assert(gen1_1 !== undefined, 'Genesis 1:1 present in b1-c1');
assert(gen1_1.tokens.length === 7, `Genesis 1:1 has 7 tokens (got ${gen1_1.tokens.length})`);
assert(consonants(gen1_1.tokens[0].surface_form) === 'בראשית', `Genesis 1:1 token 1 is בְּרֵאשִׁית (got ${gen1_1.tokens[0].surface_form})`);
assert(gen1_1.macula_hebrew_morphemes.length === 11, `Genesis 1:1 has 11 Macula Hebrew morphemes (got ${gen1_1.macula_hebrew_morphemes.length})`);
assert(gen1_1.morphhb_tokens.length === 7, `Genesis 1:1 has 7 MorphHB tokens (got ${gen1_1.morphhb_tokens.length})`);

// 2. Genesis 31:55 - 32:2
const gen31 = loadGzipJson('/v1/chapters/b1-c31.json.gz');
const gen32 = loadGzipJson('/v1/chapters/b1-c32.json.gz');
const gen31_55 = gen31.verses['55'];
const gen32_1 = gen32.verses['1'];
const gen32_2 = gen32.verses['2'];
assert(gen31_55 !== undefined, 'Genesis 31:55 present in b1-c31');
assert(consonants(gen31_55.tokens[0].surface_form) === 'וישכם', `Genesis 31:55 starts with וישכם (got ${gen31_55.tokens[0].surface_form})`);
assert(gen31_55.macula_hebrew_morphemes[0].ref_mt === 'GEN 32:1!1', `Genesis 31:55 maps to MT GEN 32:1!1 (got ${gen31_55.macula_hebrew_morphemes[0].ref_mt})`);
assert(gen32_1 !== undefined, 'Genesis 32:1 present in b1-c32');
assert(consonants(gen32_1.tokens[0].surface_form) === 'ויעקב', `Genesis 32:1 starts with ויעקב (got ${gen32_1.tokens[0].surface_form})`);
assert(gen32_1.macula_hebrew_morphemes[0].ref_mt === 'GEN 32:2!1', `Genesis 32:1 maps to MT GEN 32:2!1 (got ${gen32_1.macula_hebrew_morphemes[0].ref_mt})`);

// 3. Psalm 3:0-3 & Psalm 51
const psa3 = loadGzipJson('/v1/chapters/b19-c3.json.gz');
const psa3_0 = psa3.verses['0'];
const psa3_1 = psa3.verses['1'];
assert(psa3_0 !== undefined, 'Psalm 3:0 superscription present in b19-c3');
assert(psa3_0.tokens.length === 6, `Psalm 3:0 has 6 tokens (got ${psa3_0.tokens.length})`);
assert(consonants(psa3_0.tokens[0].surface_form) === 'מזמור', `Psalm 3:0 token 1 is מזמור (got ${psa3_0.tokens[0].surface_form})`);
assert(psa3_0.macula_hebrew_morphemes[0].ref_mt === 'PSA 3:1!1', `Psalm 3:0 maps to MT PSA 3:1!1`);
assert(consonants(psa3_1.tokens[0].surface_form) === 'יהוה', `Psalm 3:1 token 1 is יהוה (got ${psa3_1.tokens[0].surface_form})`);
assert(psa3_1.macula_hebrew_morphemes[0].ref_mt === 'PSA 3:2!1', `Psalm 3:1 maps to MT PSA 3:2!1`);

const psa51 = loadGzipJson('/v1/chapters/b19-c51.json.gz');
const psa51_0 = psa51.verses['0'];
const psa51_1 = psa51.verses['1'];
assert(psa51_0 !== undefined, 'Psalm 51:0 superscription present');
assert(consonants(psa51_0.tokens[0].surface_form) === 'למנצח', `Psalm 51:0 starts with למנצח`);
assert(consonants(psa51_1.tokens[0].surface_form) === 'חנני', `Psalm 51:1 starts with חנני`);

// 4. Daniel 2:4 (Hebrew-to-Aramaic transition & Ketiv/Qere)
const dan2 = loadGzipJson('/v1/chapters/b27-c2.json.gz');
const dan2_4 = dan2.verses['4'];
assert(dan2_4 !== undefined, 'Daniel 2:4 present in b27-c2');
const aramaicMorphTokens = dan2_4.morphhb_tokens.filter(t => t.is_aramaic);
assert(aramaicMorphTokens.length > 0, `Daniel 2:4 has Aramaic tokens in MorphHB (got ${aramaicMorphTokens.length})`);
const kqTokens = dan2_4.morphhb_tokens.filter(t => t.is_ketiv || t.is_qere);
assert(kqTokens.length > 0, `Daniel 2:4 preserves Ketiv/Qere tokens in MorphHB`);

// 5. Jeremiah's MT/LXX structural differences
const jer10 = loadGzipJson('/v1/chapters/b24-c10.json.gz');
assert(jer10.verses['1'] !== undefined, 'Jeremiah 10:1 present');
assert(jer10.verses['1'].hebrew_lxx_verse_map.length > 0, 'Jeremiah 10:1 has LXX verse mapping');

// 6. Joel and Malachi numbering differences
const joe2 = loadGzipJson('/v1/chapters/b29-c2.json.gz');
assert(joe2.verses['28'] !== undefined, 'Joel 2:28 present (MT ch 3:1)');
const mal4 = loadGzipJson('/v1/chapters/b39-c4.json.gz');
assert(mal4.verses['1'] !== undefined, 'Malachi 4:1 present (MT ch 3:19)');

// 7. John 1:1 in both Macula Greek editions
const jhn1 = loadGzipJson('/v1/chapters/b43-c1.json.gz');
const jhn1_1 = jhn1.verses['1'];
assert(jhn1_1 !== undefined, 'John 1:1 present in b43-c1');
const allJhnTrees = Object.values(jhn1.syntax_trees).map(t => t.tree);
const nestleTrees = allJhnTrees.filter(t => t.edition_key === 'macula-greek-nestle1904');
const sblgntTrees = allJhnTrees.filter(t => t.edition_key === 'macula-greek-sblgnt');
assert(nestleTrees.length > 0, 'John 1:1 has Nestle1904 syntax tree');
assert(sblgntTrees.length > 0, 'John 1:1 has SBLGNT syntax tree');
assert(jhn1_1.macula_greek_tokens.length > 0, 'John 1:1 has Macula Greek tokens');

// 8. Mark 16:9-20 and source-only Mark 16:99
const mrk16 = loadGzipJson('/v1/chapters/b41-c16.json.gz');
assert(mrk16.verses['9'] !== undefined, 'Mark 16:9 present in b41-c16');
assert(mrk16.verses['20'] !== undefined, 'Mark 16:20 present in b41-c16');
assert(mrk16.verses['99'] === undefined, 'Mark 16:99 NOT fabricated as canonical verse');
assert(mrk16.unmapped_syntax_nodes.length > 0, 'Mark 16 unmapped syntax nodes preserved');
assert(mrk16.unmapped_syntax_nodes.some(n => (n.source_ref || '').includes('MRK 16:99')), 'Mark 16:99 source nodes preserved in unmapped_syntax_nodes');

// 9. Ephesians 1:3-14 cross-verse syntax
const eph1 = loadGzipJson('/v1/chapters/b49-c1.json.gz');
const allEphTrees = Object.values(eph1.syntax_trees).map(t => t.tree);
const crossVerseTrees = allEphTrees.filter(t => t.is_cross_verse || t.end_verse_id > t.start_verse_id);
assert(crossVerseTrees.length > 0, 'Ephesians 1 has cross-verse syntax sentences spanning verses 3-14');
const s3 = allEphTrees.find(t => t.tree_id.endsWith('#s3'));
assert(s3 && s3.is_cross_verse && s3.start_verse_id === 29309 && s3.end_verse_id === 29312, 'Ephesians 1 sentence s3 spans verses 3-6 (4 verses)');

// 10. Revelation 22:21
const rev22 = loadGzipJson('/v1/chapters/b66-c22.json.gz');
const rev22_21 = rev22.verses['21'];
assert(rev22_21 !== undefined, 'Revelation 22:21 canonical ending present');
assert(rev22_21.tokens.length > 0, 'Revelation 22:21 has tokens');

// 11. Septuagint Esdras B / canonical Nehemiah
const neh1 = loadGzipJson('/v1/chapters/b16-c1.json.gz');
const neh1_1 = neh1.verses['1'];
assert(neh1_1 !== undefined, 'Nehemiah 1:1 present in b16-c1');
assert(neh1_1.hebrew_lxx_verse_map.length > 0, 'Nehemiah 1:1 has LXX verse mapping');
assert(neh1_1.hebrew_lxx_verse_map[0].lxx_book_no === 18, `Nehemiah 1:1 maps to Swete Esdras B (book 18, got ${neh1_1.hebrew_lxx_verse_map[0].lxx_book_no})`);
assert(neh1_1.hebrew_lxx_verse_map[0].lxx_chapter === 11, `Nehemiah 1:1 maps to Esdras B chapter 11 (got ${neh1_1.hebrew_lxx_verse_map[0].lxx_chapter})`);

// 12. Septuagint Deuterocanonical books and missing-source cases
const manifest = JSON.parse(fs.readFileSync('.artifacts/static-corpus/manifest.json', 'utf8'));
assert(manifest.tables.lxx_swete_books.total_rows === 55, `LXX has 55 Swete registered books (got ${manifest.tables.lxx_swete_books.total_rows})`);
assert(manifest.tables.hebrew_lxx_verse_map.total_rows === 23039, `hebrew_lxx_verse_map has 23,039 rows (got ${manifest.tables.hebrew_lxx_verse_map.total_rows})`);

console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
