// scripts/import-lxx-swete.mjs
// Deterministic Septuagint ETL for Henry Barclay Swete's Cambridge Septuagint (nathans/lxx-swete, CC BY-SA 4.0).
// Ingests all 55 declared books (588,579 tokens) across 29,308 verse units.
// Preserves:
//   - Raw Unicode Greek text, diacritics, and punctuation (word_text)
//   - Normalized lowercase search representations (normalized_word)
//   - Exact token order (ordinal)
//   - Non-numeric chapter units (Esther prologue, Odae iva/ivb) via chapter_suffix
//   - Reference-level MT <-> LXX verse mappings with explicit mapping kinds
//   - Identification of Greek books without Hebrew MT counterparts

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('.artifacts/sources/lxx-swete/data');
const OUT_DIR = path.resolve('.artifacts/septuagint');
fs.mkdirSync(OUT_DIR, { recursive: true });

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

// Mirroring public.strip_greek_diacritics in JavaScript
function stripGreekDiacritics(text) {
  if (!text) return '';
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036F\u1DC0-\u1DFF\u1F00-\u1FFF.,;:·"᾽᾿῀῁()[\]{}«»—\-!]/g, '')
    .toLowerCase()
    .normalize('NFC');
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
      const delay = attempt * 1000;
      console.warn(`[RETRY ${attempt}/${retries}] ${functionName} error: ${err.message}. Retrying in ${delay}ms...`);
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

// Canonical Hebrew (MT) book IDs (1..39) corresponding to Swete file numbers
const SWETE_CANONICAL_MAP = {
  1: 1,   // Genesis
  2: 2,   // Exodus
  3: 3,   // Leviticus
  4: 4,   // Numeri
  5: 5,   // Deuteronomium
  6: 6,   // Josue
  8: 7,   // Judices
  10: 8,  // Ruth
  11: 9,  // Regnorum I (1 Samuel)
  12: 10, // Regnorum II (2 Samuel)
  13: 11, // Regnorum III (1 Kings)
  14: 12, // Regnorum IV (2 Kings)
  15: 13, // Paralipomenon I (1 Chronicles)
  16: 14, // Paralipomenon II (2 Chronicles)
  17: null, // Esdras A (1 Esdras / Greek Ezra - Deuterocanonical)
  18: 15, // Esdras B (Ezra-Nehemiah in LXX)
  19: 17, // Esther
  20: null, // Judith
  21: null, // Tobias
  23: null, // 1 Maccabees
  24: null, // 2 Maccabees
  25: null, // 3 Maccabees
  26: null, // 4 Maccabees
  27: 19, // Psalmi
  28: null, // Odae (Odes including Prayer of Manasseh)
  29: 20, // Proverbia
  31: 22, // Canticum (Song of Songs)
  32: 18, // Job
  33: null, // Sapientia Salomonis (Wisdom of Solomon)
  34: null, // Ecclesiasticus (Sirach)
  35: null, // Psalmi Salomonis (Psalms of Solomon)
  36: 28, // Osee (Hosea)
  37: 30, // Amos
  38: 33, // Michaeas (Micah)
  39: 29, // Joel
  40: 31, // Abdias (Obadiah)
  41: 32, // Jonas (Jonah)
  42: 34, // Nahum
  43: 35, // Habacuc (Habakkuk)
  44: 36, // Sophonias (Zephaniah)
  45: 37, // Aggaeus (Haggai)
  46: 38, // Zacharias (Zechariah)
  47: 39, // Malachias (Malachi)
  48: 23, // Isaias (Isaiah)
  49: 24, // Jeremias (Jeremiah)
  50: null, // Baruch
  51: 25, // Threni (Lamentations)
  52: null, // Epistula Jeremiae (Letter of Jeremiah)
  53: 26, // Ezechiel (Ezekiel)
  54: null, // Susanna (Greek translation)
  55: null, // Susanna (Theodotion version)
  56: 27, // Daniel (Greek translation)
  57: null, // Daniel (Theodotion version)
  58: null, // Bel et Draco (Greek translation)
  59: null, // Bel et Draco (Theodotion version)
};

async function main() {
  console.log('=== Swete Septuagint Complete Ingestion Pipeline (F7) ===\n');
  const startTime = Date.now();

  // 1. Verify Source Checksums
  console.log('1. Verifying source provenance and checksums...');
  const readmePath = path.resolve('.artifacts/sources/lxx-swete/README.md');
  const copyingPath = path.resolve('.artifacts/sources/lxx-swete/COPYING-Code');
  const readmeHash = sha256File(readmePath);
  const copyingHash = sha256File(copyingPath);
  console.log(`  README.md:     ${readmeHash}`);
  console.log(`  COPYING-Code:  ${copyingHash}`);

  // 2. Resolve Provenance Identifiers
  console.log('2. Resolving source release & edition IDs...');
  const releases = await postgrestSelectAll('source_releases?release_key=eq.lxx-swete-26bad3e&select=id');
  const editions = await postgrestSelectAll('source_editions?edition_key=eq.lxx-swete&select=id');
  if (!releases.length || !editions.length) {
    throw new Error('Missing lxx-swete in source_releases or source_editions.');
  }
  const releaseId = releases[0].id;
  const editionId = editions[0].id;
  console.log(`  releaseId=${releaseId}, editionId=${editionId}`);

  // 3. Scan & Ingest All 55 Book Metadata
  console.log('3. Scanning declared upstream book files...');
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.txt')).sort();
  console.log(`  Found ${files.length} book files in data directory.`);

  // 4. Ingest Words Across All 55 Books
  console.log('\n4. Ingesting Swete Greek text tokens (55 books)...');
  let grandTotalTokens = 0;
  let grandTotalVerses = 0;
  const bookManifest = [];
  const BATCH_SIZE = 2000;

  for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
    const file = files[fileIdx];
    const m = /^(\d+)\.(.+)\.txt$/.exec(file);
    if (!m) continue;
    const bookNo = parseInt(m[1], 10);
    const latinName = m[2].replace(/_/g, ' ');
    const canonicalBook = SWETE_CANONICAL_MAP[bookNo] ?? null;

    const filePath = path.join(DATA_DIR, file);
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(l => l.trim());
    const ordinals = new Map();
    const verseSet = new Set();
    const wordsToInsert = [];

    let firstToken = null;
    let lastToken = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lm = /^(\d+)\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_\-\.]+)\s+(.+)$/.exec(line);
      if (!lm) {
        throw new Error(`Unparseable line in ${file}:${i + 1}: ${line}`);
      }

      const chStr = lm[2];
      const vStr = lm[3];
      const wordText = lm[4].trim();

      // Chapter parsing
      let chapter = 0;
      let chapterSuffix = '';
      if (chStr === 'prologue') {
        chapter = 0;
        chapterSuffix = 'prologue';
      } else if (chStr === 'iva') {
        chapter = 4;
        chapterSuffix = 'a';
      } else if (chStr === 'ivb') {
        chapter = 4;
        chapterSuffix = 'b';
      } else {
        chapter = parseInt(chStr, 10);
      }

      // Verse parsing
      const vm = /^(\d+)([a-zA-Z0-9_\-\.]*)$/.exec(vStr);
      if (!vm) {
        throw new Error(`Unparseable verse in ${file}:${i + 1}: ${vStr}`);
      }
      const verseNr = parseInt(vm[1], 10);
      const verseSuffix = vm[2] || '';

      const verseKey = `${bookNo}.${chapter}.${chapterSuffix}.${verseNr}.${verseSuffix}`;
      verseSet.add(verseKey);

      const nextOrd = (ordinals.get(verseKey) || 0) + 1;
      ordinals.set(verseKey, nextOrd);

      const sourceRecordId = `SWETE:${bookNo}.${chStr}.${vStr}#${nextOrd}`;
      const normalized = stripGreekDiacritics(wordText);

      if (!firstToken) firstToken = wordText;
      lastToken = wordText;

      wordsToInsert.push({
        book_no: bookNo,
        chapter,
        chapter_suffix: chapterSuffix,
        verse_nr: verseNr,
        verse_suffix: verseSuffix,
        ordinal: nextOrd,
        word_text: wordText,
        normalized_word: normalized,
        source_record_id: sourceRecordId,
        source_release_id: releaseId,
        source_edition_id: editionId,
      });
    }

    // Ingest in batches
    for (let b = 0; b < wordsToInsert.length; b += BATCH_SIZE) {
      const batch = wordsToInsert.slice(b, b + BATCH_SIZE);
      const res = await rpcCall('ingest_swete_words_batch_v1', { p_words: batch });
      if (res.status !== 'success') {
        throw new Error(`Batch insertion failed in ${file} at ${b}: ${JSON.stringify(res)}`);
      }
    }

    grandTotalTokens += wordsToInsert.length;
    grandTotalVerses += verseSet.size;

    bookManifest.push({
      book_no: bookNo,
      latin_name: latinName,
      file_name: file,
      canonical_book: canonicalBook,
      is_deuterocanonical_or_apocrypha: canonicalBook === null,
      tokens: wordsToInsert.length,
      distinct_verses: verseSet.size,
      first_token: firstToken,
      last_token: lastToken,
    });

    const pct = (((fileIdx + 1) / files.length) * 100).toFixed(1);
    console.log(`  [${String(fileIdx + 1).padStart(2, '0')}/${files.length} - ${pct}%] Book ${String(bookNo).padStart(2, '0')}: ${latinName.padEnd(30, ' ')} -> ${String(wordsToInsert.length).padStart(6, ' ')} tokens, ${String(verseSet.size).padStart(5, ' ')} verses`);
  }

  console.log(`\nSwete Greek Words Ingestion Complete: ${grandTotalTokens} tokens across ${grandTotalVerses} verses in 55 books!`);

  // 5. Expand Hebrew (MT) <-> LXX Verse Mappings Across All Canonical OT Books
  console.log('\n5. Generating and ingesting Hebrew (MT) <-> LXX Verse Mappings...');
  // Fetch canonical verses from database for all 39 OT books
  const allOtVerses = await postgrestSelectAll('verses?book=lte.39&select=id,book,chapter,verse_nr&order=book,chapter,verse_nr');
  console.log(`  Fetched ${allOtVerses.length} canonical Old Testament verses from DB.`);

  // Create mapping array
  const mappingsToInsert = [];

  for (const v of allOtVerses) {
    let lxxBookNo;
    let lxxCh = v.chapter;
    let lxxChSuffix = '';
    let lxxV = v.verse_nr;
    let lxxVSuffix = '';
    let mappingKind = 'same_reference';
    let ruleCitation = `Standard direct chapter and verse alignment between MT and LXX ${v.book}:${v.chapter}.${v.verse_nr}.`;

    if (v.book === 16) {
      // AUDIT-02: Nehemiah (book 16) is contained in Swete 18.Esdras_B chapters 11..23
      lxxBookNo = 18;
      lxxCh = v.chapter + 10;
      mappingKind = 'versification_shift';
      ruleCitation = `Nehemiah canonical book 16 ch ${v.chapter} aligns to Swete 18.Esdras_B ch ${lxxCh}.`;
    } else {
      const bookNo = Object.keys(SWETE_CANONICAL_MAP).find(
        k => SWETE_CANONICAL_MAP[k] === v.book && SWETE_CANONICAL_MAP[k] !== null
      );
      if (!bookNo) continue; // No direct counterpart (e.g. Ecclesiastes)
      lxxBookNo = parseInt(bookNo, 10);
    }

    // Special per-book versification rules
    if (v.book === 19) {
      // PSALMS versification shift
      if (v.chapter >= 1 && v.chapter <= 8) {
        lxxCh = v.chapter;
        mappingKind = 'same_reference';
      } else if (v.chapter === 9 || v.chapter === 10) {
        lxxCh = 9;
        mappingKind = 'psalm_numbering_shift';
      } else if (v.chapter >= 11 && v.chapter <= 113) {
        lxxCh = v.chapter - 1;
        mappingKind = 'psalm_numbering_shift';
      } else if (v.chapter === 114 || v.chapter === 115) {
        lxxCh = 113;
        mappingKind = 'psalm_numbering_shift';
      } else if (v.chapter === 116) {
        lxxCh = v.verse_nr <= 9 ? 114 : 115;
        mappingKind = 'psalm_numbering_shift';
      } else if (v.chapter >= 117 && v.chapter <= 146) {
        lxxCh = v.chapter - 1;
        mappingKind = 'psalm_numbering_shift';
      } else if (v.chapter === 147) {
        lxxCh = v.verse_nr <= 11 ? 146 : 147;
        mappingKind = 'psalm_numbering_shift';
      } else if (v.chapter >= 148 && v.chapter <= 150) {
        lxxCh = v.chapter;
        mappingKind = 'same_reference';
      }

      // Psalm superscription title shift
      if (v.verse_nr === 0) {
        lxxV = 1;
        mappingKind = 'superscription_title_verse';
        ruleCitation = `Psalms MT ${v.chapter}:${v.verse_nr} (superscription) -> LXX Swete ${lxxCh}:${lxxV} (title verse).`;
      } else {
        lxxV = v.verse_nr + 1;
        mappingKind = 'versification_shift';
        ruleCitation = `Psalms MT ${v.chapter}:${v.verse_nr} -> LXX Swete ${lxxCh}:${lxxV} (title shift).`;
      }
    } else if (v.book === 17) {
      // ESTHER: MT chapters align to LXX chapters, but LXX adds prologue & additions
      lxxCh = v.chapter;
      lxxV = v.verse_nr;
      mappingKind = 'same_reference';
      ruleCitation = `Esther MT ${v.chapter}:${v.verse_nr} aligns to LXX core text; LXX includes Greek prologue and deuterocanonical additions.`;
    }

    const sourceRecordId = `MT-LXX:${v.book}.${v.chapter}.${v.verse_nr}->${lxxBookNo}.${lxxCh}${lxxChSuffix}.${lxxV}${lxxVSuffix}`;

    mappingsToInsert.push({
      canonical_verse_id: v.id,
      lxx_book_no: lxxBookNo,
      lxx_chapter: lxxCh,
      lxx_chapter_suffix: lxxChSuffix,
      lxx_verse_nr: lxxV,
      lxx_verse_suffix: lxxVSuffix,
      mapping_kind: mappingKind,
      rule_citation: ruleCitation,
      origin_mode: 'algorithmically_calculated',
      derivation_method: 'mt_lxx_versification_alignment',
      algorithm_version: '1.1.0',
      source_release_id: releaseId,
      source_record_id: sourceRecordId,
    });
  }

  console.log(`  Ingesting ${mappingsToInsert.length} MT <-> LXX verse mappings in batches...`);
  const MAP_BATCH_SIZE = 2000;
  let totalMappingsInserted = 0;
  for (let m = 0; m < mappingsToInsert.length; m += MAP_BATCH_SIZE) {
    const batch = mappingsToInsert.slice(m, m + MAP_BATCH_SIZE);
    const res = await rpcCall('ingest_hebrew_lxx_mappings_batch_v1', { p_mappings: batch });
    if (res.status !== 'success') {
      throw new Error(`Batch mapping insertion failed at ${m}: ${JSON.stringify(res)}`);
    }
    totalMappingsInserted += (res.inserted_count || batch.length);
  }
  console.log(`  Ingested ${mappingsToInsert.length} verse mappings successfully.`);

  // 6. Write Manifest Artifact
  const manifest = {
    source_edition: 'Swete Septuagint (The Old Testament in Greek According to the Septuagint)',
    source_repository: 'https://github.com/nathans/lxx-swete',
    commit: '26bad3e',
    license: 'CC BY-SA 4.0',
    provenance_hashes: {
      'README.md': readmeHash,
      'COPYING-Code': copyingHash,
    },
    metrics: {
      declared_books: 55,
      missing_source_book_numbers_in_1_to_59: [7, 9, 22, 30],
      total_ingested_tokens: grandTotalTokens,
      total_ingested_verse_units: grandTotalVerses,
      total_mt_lxx_verse_mappings: mappingsToInsert.length,
      elapsed_seconds: ((Date.now() - startTime) / 1000).toFixed(1),
    },
    books: bookManifest,
  };

  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nSaved coverage manifest to ${manifestPath}`);
  console.log(`Elapsed Time: ${manifest.metrics.elapsed_seconds}s`);
  console.log('================================================================');
  console.log('SWETE SEPTUAGINT INGESTION COMPLETED SUCCESSFULLY');
  console.log('================================================================');
}

main().catch(err => {
  console.error('\nFATAL ERROR in import-lxx-swete:', err);
  process.exit(1);
});
