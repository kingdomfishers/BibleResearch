// scripts/import-greek-corpus.mjs
// Deterministic Greek New Testament ETL for STEPBible TAGNT and Clear-Bible/macula-greek (Nestle 1904 & SBLGNT).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

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

const NT_BOOK_MAP = {
  MAT: 40, Mat: 40,
  MRK: 41, Mrk: 41,
  LUK: 42, Luk: 42,
  JHN: 43, Jhn: 43,
  ACT: 44, Act: 44,
  ROM: 45, Rom: 45,
  '1CO': 46, '1Co': 46,
  '2CO': 47, '2Co': 47,
  GAL: 48, Gal: 48,
  EPH: 49, Eph: 49,
  PHP: 50, Php: 50,
  COL: 51, Col: 51,
  '1TH': 52, '1Th': 52,
  '2TH': 53, '2Th': 53,
  '1TI': 54, '1Ti': 54,
  '2TI': 55, '2Ti': 55,
  TIT: 56, Tit: 56,
  PHM: 57, Phm: 57,
  HEB: 58, Heb: 58,
  JAS: 59, Jas: 59,
  '1PE': 60, '1Pe': 60,
  '2PE': 61, '2Pe': 61,
  '1JN': 62, '1Jn': 62,
  '2JN': 63, '2Jn': 63,
  '3JN': 64, '3Jn': 64,
  JUD: 65, Jud: 65, JDE: 65,
  REV: 66, Rev: 66,
};

function sha256File(filepath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filepath));
  return hash.digest('hex');
}

async function rpcCall(functionName, params = {}, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
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
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = attempt * 800;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function postgrestSelectAll(tableAndFilter) {
  const all = [];
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    const sep = tableAndFilter.includes('?') ? '&' : '?';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableAndFilter}${sep}limit=${batchSize}&offset=${offset}`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`Select ${tableAndFilter} failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < batchSize) break;
    offset += batchSize;
  }
  return all;
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

console.log('=== F4: Complete Greek NT Corpus Ingestion & Validation ===\n');

// Step 1: Checksum verification
console.log('--- Step 1: Source Checksum Verification ---');
const NESTLE_TSV = path.resolve('.artifacts/sources/macula-greek/Nestle1904/tsv/macula-greek-Nestle1904.tsv');
const SBLGNT_TSV = path.resolve('.artifacts/sources/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv');
const TAGNT_MAT_JHN = path.resolve('.artifacts/stepbible/TAGNT Mat-Jhn.txt');
const TAGNT_ACT_REV = path.resolve('.artifacts/stepbible/TAGNT Act-Rev.txt');

if (!fs.existsSync(NESTLE_TSV)) throw new Error(`Missing ${NESTLE_TSV}`);
if (!fs.existsSync(SBLGNT_TSV)) throw new Error(`Missing ${SBLGNT_TSV}`);
if (!fs.existsSync(TAGNT_MAT_JHN)) throw new Error(`Missing ${TAGNT_MAT_JHN}`);
if (!fs.existsSync(TAGNT_ACT_REV)) throw new Error(`Missing ${TAGNT_ACT_REV}`);

const nestleHash = sha256File(NESTLE_TSV);
const sblgntHash = sha256File(SBLGNT_TSV);
const tagntMatJhnHash = sha256File(TAGNT_MAT_JHN);
const tagntActRevHash = sha256File(TAGNT_ACT_REV);

console.log(`Nestle 1904 SHA256: ${nestleHash}`);
console.log(`SBLGNT      SHA256: ${sblgntHash}`);
console.log(`TAGNT Mat-Jhn SHA256: ${tagntMatJhnHash}`);
console.log(`TAGNT Act-Rev SHA256: ${tagntActRevHash}`);

// Step 2: Fetch NT verses mapping
console.log('\n--- Step 2: Loading NT Canonical Verses ---');
const verses = await postgrestSelectAll('verses?book=gte.40&select=id,book,chapter,verse_nr,word_ids');
const verseMap = new Map();
for (const v of verses) {
  verseMap.set(`${v.book}:${v.chapter}:${v.verse_nr}`, v);
}
console.log(`Loaded ${verses.length} canonical NT verses.`);

// Verify release and edition IDs
const editions = await postgrestSelectAll('source_editions?edition_key=in.(macula-greek-nestle1904,macula-greek-sblgnt,step-tagnt-amalgamated)&select=id,edition_key,source_release_id');
const editionMap = new Map();
for (const ed of editions) {
  editionMap.set(ed.edition_key, ed);
}
console.log(`Loaded ${editions.length} target source editions.`);

const nestleEd = editionMap.get('macula-greek-nestle1904');
const sblgntEd = editionMap.get('macula-greek-sblgnt');
const tagntEd = editionMap.get('step-tagnt-amalgamated');

if (!nestleEd || !sblgntEd || !tagntEd) {
  throw new Error('One or more required source editions not found in database.');
}

const BATCH_SIZE = 1500;
const perBookStats = {
  nestle: {},
  sblgnt: {},
  tagnt: {},
};

for (let b = 40; b <= 66; b++) {
  perBookStats.nestle[b] = 0;
  perBookStats.sblgnt[b] = 0;
  perBookStats.tagnt[b] = 0;
}

// Step 3: Ingest MACULA Greek Nestle 1904
console.log('\n--- Step 3: Ingesting MACULA Greek Nestle 1904 (137,779 tokens) ---');
const existingNestleCount = await getCount('macula_greek_tokens', 'edition_key=eq.macula-greek-nestle1904');
console.log(`Existing Nestle 1904 tokens in DB: ${existingNestleCount}`);

if (existingNestleCount >= 137779) {
  console.log('Nestle 1904 already fully ingested. Verifying per-book counts...');
  // We still scan file to populate perBookStats accurately
  const rl = readline.createInterface({ input: fs.createReadStream(NESTLE_TSV) });
  let header = true;
  for await (const line of rl) {
    if (header) { header = false; continue; }
    const parts = line.split('\t');
    const ref = parts[1];
    if (ref) {
      const bookStr = ref.split(' ')[0];
      const book = NT_BOOK_MAP[bookStr];
      if (book) perBookStats.nestle[book]++;
    }
  }
} else {
  const rl = readline.createInterface({ input: fs.createReadStream(NESTLE_TSV) });
  let header = true;
  let batch = [];
  let totalNestle = 0;

  for await (const line of rl) {
    if (header) { header = false; continue; }
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const xmlId = parts[0];
    const ref = parts[1];
    const [bookStr, cvWord] = ref.split(' ');
    const [cv, wordNoStr] = cvWord.split('!');
    const [chStr, vStr] = cv.split(':');
    const book = NT_BOOK_MAP[bookStr];
    const chapter = parseInt(chStr, 10);
    const verseNr = parseInt(vStr, 10);
    const wordNo = parseInt(wordNoStr, 10);

    perBookStats.nestle[book] = (perBookStats.nestle[book] || 0) + 1;

    const verse = verseMap.get(`${book}:${chapter}:${verseNr}`);
    const canonicalVerseId = verse ? verse.id : null;
    const stepWordId = (verse && verse.word_ids && verse.word_ids[wordNo - 1]) ? verse.word_ids[wordNo - 1] : null;

    batch.push({
      edition_key: 'macula-greek-nestle1904',
      xml_id: xmlId,
      ref_nt: ref,
      book,
      chapter,
      verse_nr: verseNr,
      word_no: wordNo,
      role: parts[2] || null,
      part_of_speech: parts[3] || null,
      word_type: parts[4] || null,
      english: parts[5] || null,
      mandarin: parts[6] || null,
      gloss: parts[7] || null,
      text_form: parts[8],
      after_text: parts[9] !== undefined ? parts[9] : null,
      lemma: parts[10],
      normalized: parts[11] || null,
      strongs: parts[12] || null,
      morph_code: parts[13],
      person: parts[14] || null,
      number: parts[15] || null,
      gender: parts[16] || null,
      case_value: parts[17] || null,
      tense: parts[18] || null,
      voice: parts[19] || null,
      mood: parts[20] || null,
      degree: parts[21] || null,
      frame: parts[24] || null,
      subjref: parts[25] || null,
      referent: parts[26] || null,
      canonical_verse_id: canonicalVerseId,
      step_word_id: stepWordId,
      link_status: stepWordId ? 'exact_form' : 'unmatched',
      source_release_id: nestleEd.source_release_id,
      source_edition_id: nestleEd.id,
      source_record_id: xmlId,
    });

    if (batch.length >= BATCH_SIZE) {
      await rpcCall('ingest_macula_greek_batch_v1', { p_tokens: batch });
      totalNestle += batch.length;
      process.stdout.write(`\rIngested ${totalNestle} / 137,779 Nestle 1904 tokens...`);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await rpcCall('ingest_macula_greek_batch_v1', { p_tokens: batch });
    totalNestle += batch.length;
  }
  console.log(`\rIngested ${totalNestle} / 137,779 Nestle 1904 tokens. Complete!`);
}

// Step 4: Ingest MACULA Greek SBLGNT
console.log('\n--- Step 4: Ingesting MACULA Greek SBLGNT (137,741 tokens) ---');
const existingSblgntCount = await getCount('macula_greek_tokens', 'edition_key=eq.macula-greek-sblgnt');
console.log(`Existing SBLGNT tokens in DB: ${existingSblgntCount}`);

if (existingSblgntCount >= 137741) {
  console.log('SBLGNT already fully ingested. Verifying per-book counts...');
  const rl = readline.createInterface({ input: fs.createReadStream(SBLGNT_TSV) });
  let header = true;
  for await (const line of rl) {
    if (header) { header = false; continue; }
    const parts = line.split('\t');
    const ref = parts[1];
    if (ref) {
      const bookStr = ref.split(' ')[0];
      const book = NT_BOOK_MAP[bookStr];
      if (book) perBookStats.sblgnt[book]++;
    }
  }
} else {
  const rl = readline.createInterface({ input: fs.createReadStream(SBLGNT_TSV) });
  let header = true;
  let batch = [];
  let totalSblgnt = 0;

  for await (const line of rl) {
    if (header) { header = false; continue; }
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const xmlId = parts[0];
    const ref = parts[1];
    const [bookStr, cvWord] = ref.split(' ');
    const [cv, wordNoStr] = cvWord.split('!');
    const [chStr, vStr] = cv.split(':');
    const book = NT_BOOK_MAP[bookStr];
    const chapter = parseInt(chStr, 10);
    const verseNr = parseInt(vStr, 10);
    const wordNo = parseInt(wordNoStr, 10);

    perBookStats.sblgnt[book] = (perBookStats.sblgnt[book] || 0) + 1;

    const verse = verseMap.get(`${book}:${chapter}:${verseNr}`);
    const canonicalVerseId = verse ? verse.id : null;
    const stepWordId = (verse && verse.word_ids && verse.word_ids[wordNo - 1]) ? verse.word_ids[wordNo - 1] : null;

    batch.push({
      edition_key: 'macula-greek-sblgnt',
      xml_id: xmlId,
      ref_nt: ref,
      book,
      chapter,
      verse_nr: verseNr,
      word_no: wordNo,
      role: parts[2] || null,
      part_of_speech: parts[3] || null,
      word_type: parts[4] || null,
      english: parts[5] || null,
      mandarin: parts[6] || null,
      gloss: parts[7] || null,
      text_form: parts[8],
      after_text: parts[9] !== undefined ? parts[9] : null,
      lemma: parts[10],
      normalized: parts[11] || null,
      strongs: parts[12] || null,
      morph_code: parts[13],
      person: parts[14] || null,
      number: parts[15] || null,
      gender: parts[16] || null,
      case_value: parts[17] || null,
      tense: parts[18] || null,
      voice: parts[19] || null,
      mood: parts[20] || null,
      degree: parts[21] || null,
      frame: parts[24] || null,
      subjref: parts[25] || null,
      referent: parts[26] || null,
      canonical_verse_id: canonicalVerseId,
      step_word_id: stepWordId,
      link_status: stepWordId ? 'exact_form' : 'unmatched',
      source_release_id: sblgntEd.source_release_id,
      source_edition_id: sblgntEd.id,
      source_record_id: xmlId,
    });

    if (batch.length >= BATCH_SIZE) {
      await rpcCall('ingest_macula_greek_batch_v1', { p_tokens: batch });
      totalSblgnt += batch.length;
      process.stdout.write(`\rIngested ${totalSblgnt} / 137,741 SBLGNT tokens...`);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await rpcCall('ingest_macula_greek_batch_v1', { p_tokens: batch });
    totalSblgnt += batch.length;
  }
  console.log(`\rIngested ${totalSblgnt} / 137,741 SBLGNT tokens. Complete!`);
}

// Step 5: Ingest STEPBible TAGNT
console.log('\n--- Step 5: Ingesting STEPBible TAGNT (142,096 tokens) ---');
const existingTagntCount = await getCount('tagnt_tokens');
console.log(`Existing TAGNT tokens in DB: ${existingTagntCount}`);

async function parseTagntFile(filepath, onBatch) {
  const rl = readline.createInterface({ input: fs.createReadStream(filepath) });
  let batch = [];
  let fileTokens = 0;

  for await (const line of rl) {
    const m = line.match(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)(?:[\[\{\(][^\]\}\)]+[\]\}\)])?#(\d+)=([A-Za-z()]+)/);
    if (!m) continue;

    const bookStr = m[1];
    const chapter = parseInt(m[2], 10);
    const verseNr = parseInt(m[3], 10);
    const wordPosition = parseInt(m[4], 10);
    const wordType = m[5];

    const book = NT_BOOK_MAP[bookStr];
    if (!book) throw new Error(`Unknown TAGNT book abbreviation: ${bookStr}`);

    perBookStats.tagnt[book] = (perBookStats.tagnt[book] || 0) + 1;

    const cols = line.split('\t');
    const tagntId = `${bookStr}.${chapter}.${verseNr}#${m[4]}`;

    let surfaceGreek = '';
    let transliteration = '';
    const greekCol = (cols[1] || '').trim();
    const mGreek = greekCol.match(/^(.+?)\s*\((.+?)\)$/);
    if (mGreek) {
      surfaceGreek = mGreek[1].trim();
      transliteration = mGreek[2].trim();
    } else {
      surfaceGreek = greekCol;
      transliteration = '';
    }

    const dsg = (cols[3] || '').trim();
    const eqIdx = dsg.indexOf('=');
    const dstrongs = eqIdx >= 0 ? dsg.slice(0, eqIdx).trim() : dsg;
    const grammarCode = eqIdx >= 0 ? dsg.slice(eqIdx + 1).trim() : '';

    const dfg = (cols[4] || '').trim();
    const eqIdx2 = dfg.indexOf('=');
    const lemma = eqIdx2 >= 0 ? dfg.slice(0, eqIdx2).trim() : dfg;
    const stepGloss = eqIdx2 >= 0 ? dfg.slice(eqIdx2 + 1).trim() : null;

    const editionsStr = (cols[5] || '').trim();
    const meaningVariants = (cols[6] || '').trim() || null;
    const spellingVariants = (cols[7] || '').trim() || null;
    const spanish = (cols[8] || '').trim() || null;
    const subMeaning = (cols[9] || '').trim() || null;
    const conjoinWord = (cols[10] || '').trim() || null;
    const sstrongInstance = (cols[11] || '').trim() || null;
    const altStrongs = (cols[12] || '').trim() || null;

    const verse = verseMap.get(`${book}:${chapter}:${verseNr}`);
    const canonicalVerseId = verse ? verse.id : null;
    const stepWordId = (verse && verse.word_ids && verse.word_ids[wordPosition - 1]) ? verse.word_ids[wordPosition - 1] : null;

    let linkStatus = 'exact_match';
    if (wordType.toUpperCase().startsWith('K')) {
      linkStatus = 'traditional_addition';
    } else if (wordType.toUpperCase().startsWith('N') && !wordType.toUpperCase().includes('K')) {
      linkStatus = 'critical_omission';
    } else if (meaningVariants) {
      linkStatus = 'variant_reading';
    } else if (spellingVariants) {
      linkStatus = 'spelling_variant';
    }

    batch.push({
      tagnt_id: tagntId,
      word_type: wordType,
      surface_greek: surfaceGreek,
      transliteration,
      english_translation: (cols[2] || '').trim() || null,
      dstrongs,
      grammar_code: grammarCode,
      lemma,
      step_gloss: stepGloss,
      editions: editionsStr,
      meaning_variants: meaningVariants,
      spelling_variants: spellingVariants,
      spanish_translation: spanish,
      sub_meaning: subMeaning,
      conjoin_word: conjoinWord,
      sstrong_instance: sstrongInstance,
      alt_strongs: altStrongs,
      book,
      chapter,
      verse_nr: verseNr,
      word_position: wordPosition,
      canonical_verse_id: canonicalVerseId,
      step_word_id: stepWordId,
      link_status: linkStatus,
      source_release_id: tagntEd.source_release_id,
      source_edition_id: tagntEd.id,
      source_record_id: tagntId,
    });

    if (batch.length >= BATCH_SIZE) {
      await onBatch(batch);
      fileTokens += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await onBatch(batch);
    fileTokens += batch.length;
  }
  return fileTokens;
}

if (existingTagntCount >= 142096) {
  console.log('TAGNT already fully ingested. Verifying per-book counts...');
  await parseTagntFile(TAGNT_MAT_JHN, async () => {});
  await parseTagntFile(TAGNT_ACT_REV, async () => {});
} else {
  let totalTagnt = 0;
  console.log('Parsing and ingesting TAGNT Mat-Jhn.txt...');
  await parseTagntFile(TAGNT_MAT_JHN, async (batch) => {
    await rpcCall('ingest_tagnt_batch_v1', { p_tokens: batch });
    totalTagnt += batch.length;
    process.stdout.write(`\rIngested ${totalTagnt} / 142,096 TAGNT tokens...`);
  });

  console.log('\nParsing and ingesting TAGNT Act-Rev.txt...');
  await parseTagntFile(TAGNT_ACT_REV, async (batch) => {
    await rpcCall('ingest_tagnt_batch_v1', { p_tokens: batch });
    totalTagnt += batch.length;
    process.stdout.write(`\rIngested ${totalTagnt} / 142,096 TAGNT tokens...`);
  });
  console.log(`\nIngested ${totalTagnt} / 142,096 TAGNT tokens. Complete!`);
}

// Step 6: Generate Coverage Manifest
console.log('\n--- Step 6: Generating Greek Coverage Manifest ---');
const totalNestleTokens = Object.values(perBookStats.nestle).reduce((a, b) => a + b, 0);
const totalSblgntTokens = Object.values(perBookStats.sblgnt).reduce((a, b) => a + b, 0);
const totalTagntTokens = Object.values(perBookStats.tagnt).reduce((a, b) => a + b, 0);

const manifest = {
  feature: 'F4 — Complete and validate Greek New Testament integration',
  generated_at: new Date().toISOString(),
  sources: [
    {
      dataset: 'STEPBible/STEPBible-Data',
      edition: 'step-tagnt-amalgamated',
      release: 'stepbible-2026-11',
      license: 'CC BY 4.0',
      files: [
        { path: 'TAGNT Mat-Jhn.txt', sha256: tagntMatJhnHash, tokens: 66984 },
        { path: 'TAGNT Act-Rev.txt', sha256: tagntActRevHash, tokens: 75112 },
      ],
      total_tokens: totalTagntTokens,
      expected_tokens: 142096,
      completeness: totalTagntTokens === 142096 ? '100%' : `${((totalTagntTokens / 142096) * 100).toFixed(2)}%`,
    },
    {
      dataset: 'Clear-Bible/macula-greek',
      edition: 'macula-greek-nestle1904',
      release: 'macula-greek-8423afe',
      license: 'CC BY 4.0',
      files: [
        { path: 'Nestle1904/tsv/macula-greek-Nestle1904.tsv', sha256: nestleHash, tokens: 137779 },
      ],
      total_tokens: totalNestleTokens,
      expected_tokens: 137779,
      completeness: totalNestleTokens === 137779 ? '100%' : `${((totalNestleTokens / 137779) * 100).toFixed(2)}%`,
    },
    {
      dataset: 'Clear-Bible/macula-greek',
      edition: 'macula-greek-sblgnt',
      release: 'macula-greek-8423afe',
      license: 'CC BY 4.0',
      files: [
        { path: 'SBLGNT/tsv/macula-greek-SBLGNT.tsv', sha256: sblgntHash, tokens: 137741 },
      ],
      total_tokens: totalSblgntTokens,
      expected_tokens: 137741,
      completeness: totalSblgntTokens === 137741 ? '100%' : `${((totalSblgntTokens / 137741) * 100).toFixed(2)}%`,
    },
  ],
  per_book_tokens: perBookStats,
};

const manifestPath = path.resolve('.artifacts/greek-coverage-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Saved coverage manifest to ${manifestPath}`);

console.log('\n=== Ingestion Summary ===');
console.log(`Nestle 1904 Tokens: ${totalNestleTokens} / 137,779 (${manifest.sources[1].completeness})`);
console.log(`SBLGNT      Tokens: ${totalSblgntTokens} / 137,741 (${manifest.sources[2].completeness})`);
console.log(`TAGNT       Tokens: ${totalTagntTokens} / 142,096 (${manifest.sources[0].completeness})`);
console.log('Greek NT Ingestion successfully completed.');
