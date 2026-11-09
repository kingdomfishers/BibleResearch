import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

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

function loadGzipJson(relPath) {
  const p = path.resolve('.artifacts/static-corpus', relPath.replace(/^\//, ''));
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
}

async function fetchRest(endpoint) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    method: 'GET',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fetchRest failed ${res.status} on ${endpoint}: ${errText}`);
  }
  return res.json();
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

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.error(`FAIL: ${message}`);
    failed++;
  }
}

async function main() {
  console.log('=== AUDIT-02 Verification Suite ===\n');

  // 1. Verify Database hebrew_lxx_verse_map coverage and Nehemiah mappings
  console.log('1. Verifying Database hebrew_lxx_verse_map coverage...');
  const lxxCountRes = await fetchRest('hebrew_lxx_verse_map?select=count');
  const totalLxxMap = lxxCountRes?.[0]?.count ?? 0;
  // 23,261 canonical OT verses - 222 Ecclesiastes (upstream absent) = 23,039
  assert(totalLxxMap === 23039, `hebrew_lxx_verse_map has exactly 23,039 rows (got ${totalLxxMap})`);

  const nehVerses = await fetchRest('verses?book=eq.16&select=id&limit=1');
  const neh1_1_id = nehVerses?.[0]?.id;
  const nehMap = await fetchRest(`hebrew_lxx_verse_map?canonical_verse_id=eq.${neh1_1_id}&select=*`);
  assert(nehMap.length === 1, 'Nehemiah 1:1 has exactly 1 LXX mapping row in DB');
  assert(nehMap[0]?.lxx_book_no === 18 && nehMap[0]?.lxx_chapter === 11 && nehMap[0]?.lxx_verse_nr === 1,
    `Nehemiah 1:1 maps to Swete 18.Esdras_B 11:1 (got book=${nehMap[0]?.lxx_book_no}, ch=${nehMap[0]?.lxx_chapter}, vs=${nehMap[0]?.lxx_verse_nr})`);

  // 2. Verify Database macula_hebrew_morphemes OT versification alignment
  console.log('\n2. Verifying Database macula_hebrew_morphemes alignment...');
  const mPs3_1 = await fetchRest('macula_hebrew_morphemes?macula_id=eq.o190030010011&select=canonical_verse_id,word_id,link_status,text_form');
  assert(mPs3_1.length === 1, 'PSA 3:1!1 (מִזְמוֹר) exists in macula_hebrew_morphemes');
  assert(mPs3_1[0]?.canonical_verse_id === 13959 && mPs3_1[0]?.word_id === 88044,
    `PSA 3:1!1 maps to Psalm 3:0 (verse_id=13959, word_id=88044) (got verse=${mPs3_1[0]?.canonical_verse_id}, word=${mPs3_1[0]?.word_id})`);
  assert(mPs3_1[0]?.link_status === 'matched_consonantal', `PSA 3:1!1 has link_status='matched_consonantal'`);

  const mPs3_2 = await fetchRest('macula_hebrew_morphemes?macula_id=eq.o190030020011&select=canonical_verse_id,word_id,link_status,text_form');
  assert(mPs3_2.length === 1, 'PSA 3:2!1 (יְהוָה) exists in macula_hebrew_morphemes');
  assert(mPs3_2[0]?.canonical_verse_id === 13960 && mPs3_2[0]?.word_id === 71039,
    `PSA 3:2!1 maps to Psalm 3:1 (verse_id=13960, word_id=71039) (got verse=${mPs3_2[0]?.canonical_verse_id}, word=${mPs3_2[0]?.word_id})`);

  const mGen32_1 = await fetchRest('macula_hebrew_morphemes?macula_id=eq.o010320010011&select=canonical_verse_id,word_id,link_status,text_form');
  assert(mGen32_1[0]?.canonical_verse_id === 929 && mGen32_1[0]?.word_id === 138884,
    `GEN 32:1!1 (וַיַּשְׁכֵּם) maps to Genesis 31:55 (verse_id=929, word_id=138884) (got verse=${mGen32_1[0]?.canonical_verse_id}, word=${mGen32_1[0]?.word_id})`);

  const mGen32_2 = await fetchRest('macula_hebrew_morphemes?macula_id=eq.o010320020011&select=canonical_verse_id,word_id,link_status,text_form');
  assert(mGen32_2[0]?.canonical_verse_id === 930 && mGen32_2[0]?.word_id === 74104,
    `GEN 32:2!1 (וְיַעֲקֹב) maps to Genesis 32:1 (verse_id=930, word_id=74104) (got verse=${mGen32_2[0]?.canonical_verse_id}, word=${mGen32_2[0]?.word_id})`);

  // 3. Verify Database morphhb_tokens OT versification alignment
  console.log('\n3. Verifying Database morphhb_tokens alignment...');
  const morphPs3_1 = await fetchRest('morphhb_tokens?morphhb_id=eq.19AxB&select=canonical_verse_id,step_word_id,link_status,word_text');
  assert(morphPs3_1[0]?.canonical_verse_id === 13959 && morphPs3_1[0]?.step_word_id === 88044,
    `morphhb PSA 3:1 (19AxB מִזְמוֹר) maps to Psalm 3:0 (verse_id=13959, word_id=88044) (got verse=${morphPs3_1[0]?.canonical_verse_id}, word=${morphPs3_1[0]?.step_word_id})`);

  const morphPs3_2 = await fetchRest('morphhb_tokens?morphhb_id=eq.1992v&select=canonical_verse_id,step_word_id,link_status,word_text');
  assert(morphPs3_2[0]?.canonical_verse_id === 13960 && morphPs3_2[0]?.step_word_id === 71039,
    `morphhb PSA 3:2 (1992v יְהוָה) maps to Psalm 3:1 (verse_id=13960, word_id=71039) (got verse=${morphPs3_2[0]?.canonical_verse_id}, word=${morphPs3_2[0]?.step_word_id})`);

  const morphGen32_1 = await fetchRest('morphhb_tokens?morphhb_id=eq.01SDx&select=canonical_verse_id,step_word_id,link_status,word_text');
  assert(morphGen32_1[0]?.canonical_verse_id === 929 && morphGen32_1[0]?.step_word_id === 138884,
    `morphhb GEN 32:1 (01SDx וַ/יַּשְׁכֵּם) maps to Genesis 31:55 (verse_id=929, word_id=138884) (got verse=${morphGen32_1[0]?.canonical_verse_id}, word=${morphGen32_1[0]?.step_word_id})`);

  const morphGen32_2 = await fetchRest('morphhb_tokens?morphhb_id=eq.01azP&select=canonical_verse_id,step_word_id,link_status,word_text');
  assert(morphGen32_2[0]?.canonical_verse_id === 930 && morphGen32_2[0]?.step_word_id === 74104,
    `morphhb GEN 32:2 (01azP וְ/יַעֲקֹב) maps to Genesis 32:1 (verse_id=930, word_id=74104) (got verse=${morphGen32_2[0]?.canonical_verse_id}, word=${morphGen32_2[0]?.step_word_id})`);

  // 4. Verify Static Chapter Shards under /v1/chapters/
  console.log('\n4. Verifying Static Chapter Shards (/v1/chapters/)...');
  const ps3 = loadGzipJson('/v1/chapters/b19-c3.json.gz');
  if (ps3) {
    const v0 = ps3.verses?.['0'];
    const v1 = ps3.verses?.['1'];

    assert(v0 && v0.tokens?.length === 6, 'Psalm 3:0 has 6 canonical tokens');
    assert(v0.macula_hebrew_morphemes?.some(m => m.macula_id === 'o190030010011'),
      'Psalm 3:0 contains PSA 3:1!1 morpheme (מִזְמוֹר)');
    assert(v0.tree_ids?.length >= 1, 'Psalm 3:0 contains WLC syntax tree ID for superscription');

    assert(v1 && v1.tokens?.[0]?.word_id === 71039, 'Psalm 3:1 starts with word_id=71039 (יְהוָה)');
    assert(v1.macula_hebrew_morphemes?.some(m => m.macula_id === 'o190030020011'),
      'Psalm 3:1 contains PSA 3:2!1 morpheme (יְהוָה)');
    assert(v1.tree_ids?.length >= 1, 'Psalm 3:1 contains WLC syntax tree ID');
  } else {
    console.warn('Note: b19-c3.json.gz not yet rebuilt; will verify post-export');
  }

  const gen31 = loadGzipJson('/v1/chapters/b1-c31.json.gz');
  if (gen31) {
    const v55 = gen31.verses?.['55'];
    assert(v55 && v55.tokens?.[0]?.word_id === 138884, 'Genesis 31:55 starts with word_id=138884 (וַיַּשְׁכֵּם)');
    assert(v55.macula_hebrew_morphemes?.some(m => m.macula_id === 'o010320010011'),
      'Genesis 31:55 contains GEN 32:1!1 morpheme (וַיַּשְׁכֵּם)');
  }

  const gen32 = loadGzipJson('/v1/chapters/b1-c32.json.gz');
  if (gen32) {
    const v1 = gen32.verses?.['1'];
    assert(v1 && v1.tokens?.[0]?.word_id === 74104, 'Genesis 32:1 starts with word_id=74104 (וְיַעֲקֹב)');
    assert(v1.macula_hebrew_morphemes?.some(m => m.macula_id === 'o010320020011'),
      'Genesis 32:1 contains GEN 32:2!1 morpheme (וְיַעֲקֹב)');
  }

  const neh1 = loadGzipJson('/v1/chapters/b16-c1.json.gz');
  if (neh1) {
    const v1 = neh1.verses?.['1'];
    assert(v1?.hebrew_lxx_verse_map?.length >= 1, 'Nehemiah 1:1 chapter shard contains LXX verse mapping');
    assert(v1?.hebrew_lxx_verse_map?.[0]?.lxx_book_no === 18 && v1?.hebrew_lxx_verse_map?.[0]?.lxx_chapter === 11,
      'Nehemiah 1:1 maps to 18.Esdras_B ch 11 in chapter shard');
    const targetKeys = Object.keys(v1?.lxx_target_tokens || {});
    assert(targetKeys.length >= 1 && v1.lxx_target_tokens[targetKeys[0]]?.length > 0,
      'Nehemiah 1:1 contains Greek target tokens in chapter shard');
  }

  console.log('\n========================================');
  console.log(`AUDIT-02 Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in verify-audit-02:', err);
  process.exit(1);
});
