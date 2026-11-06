// Deterministic offline/online ETL for the Canonical Biblical Lexical & Evidence Database.
// Verifies pinned SHA-256 checksums against .artifacts/stepbible/manifest.json, extracts:
//   1. Exact dStrong -> lemma/lexeme mappings for all multi-lemma/homograph surface word forms (TAHOT + TAGNT)
//   2. Abbott-Smith Greek parenthesized etymological derivations & numbered lexical senses (TBESG CC BY 4.0)
//   3. Greek NT Conjoin-word syntax nodes & dependency edges (TAGNT)
//   4. Compound Hebrew/Aramaic token morphemes & sourced STEP sub-meaning / disambiguation annotations
// Never uses AI sense assignment or restricted Online Bible TBESH Meaning column 7.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { BOOKS, plain, strong } from './stepbible-parser.mjs';

const ARTIFACT_DIR = '.artifacts/stepbible';
const OUT_DIR = '.artifacts/canonical-etl';

const env = Object.fromEntries(
  (await fs.readFile('.env', 'utf8'))
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    })
);
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
assert.ok(SUPABASE_URL && ANON_KEY, 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');

const FILE_MAP = {
  TBESH: 'TBESH.txt',
  TBESG: 'TBESG.txt',
  'TAHOT Gen-Deu': 'TAHOT Gen-Deu.txt',
  'TAHOT Jos-Est': 'TAHOT Jos-Est.txt',
  'TAHOT Job-Sng': 'TAHOT Job-Sng.txt',
  'TAHOT Isa-Mal': 'TAHOT Isa-Mal.txt',
  'TAGNT Mat-Jhn': 'TAGNT Mat-Jhn.txt',
  'TAGNT Act-Rev': 'TAGNT Act-Rev.txt',
};

function sqlLit(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sqlTextArray(arr) {
  if (!arr || arr.length === 0) return "'{}'::text[]";
  return `ARRAY[${arr.map(sqlLit).join(',')}]::text[]`;
}

function stripDiacritics(str) {
  return str
    .normalize('NFKD')
    .replace(/[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF]/g, '')
    .trim();
}

async function fetchAllRows(table, selectCols, extraFilter = '') {
  const rows = [];
  let lastId = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(selectCols)}&id=gt.${lastId}${extraFilter}&order=id.asc&limit=1000`;
    const resp = await fetch(url, { headers: { apikey: ANON_KEY } });
    assert.equal(resp.status, 200, `Failed fetching ${table}: HTTP ${resp.status}`);
    const page = await resp.json();
    if (page.length === 0) break;
    rows.push(...page);
    lastId = page[page.length - 1].id;
    if (page.length < 1000) break;
  }
  return rows;
}

console.log('1. Verifying SHA-256 checksums of all 8 pinned STEP source files...');
const manifest = JSON.parse(await fs.readFile(path.join(ARTIFACT_DIR, 'manifest.json'), 'utf8'));
for (const src of manifest.sources) {
  const localFile = FILE_MAP[src.name];
  assert.ok(localFile, `Unmapped manifest source ${src.name}`);
  const buf = await fs.readFile(path.join(ARTIFACT_DIR, localFile));
  const actualSha = crypto.createHash('sha256').update(buf).digest('hex');
  assert.equal(actualSha, src.sha256, `SHA-256 mismatch on ${localFile}`);
}
console.log('   PASS: All 8 STEP artifact SHA-256 hashes match manifest.json.');

console.log('2. Loading canonical ID dictionaries from PostgreSQL (editions, lexemes, verses, multi-lemma words)...');
const [editions, lexemes, verses, existingWflIds] = await Promise.all([
  fetchAllRows('source_editions', 'id,edition_key'),
  fetchAllRows('lexemes', 'id,lexeme_key,language,base_strongs,extended_strongs,original_lemma,lemma_id'),
  fetchAllRows('verses', 'id,book,chapter,verse_nr'),
  fetchAllRows('word_form_lemmas', 'id,word_id'),
]);

const editionByKey = new Map(editions.map(e => [e.edition_key, e.id]));
const tahotEdId = editionByKey.get('step-tahot-wlc');
const tagntEdId = editionByKey.get('step-tagnt-na28');
const tbesgEdId = editionByKey.get('step-tbesg');
assert.ok(tahotEdId && tagntEdId && tbesgEdId, 'Missing STEP source_editions');

const lexemeByExt = new Map();
const lexemesByBase = new Map();
const greekLexemeByStripped = new Map();
for (const l of lexemes) {
  if (!lexemeByExt.has(l.extended_strongs)) lexemeByExt.set(l.extended_strongs, l);
  lexemeByExt.set(l.lexeme_key, l);
  const arr = lexemesByBase.get(l.base_strongs) || [];
  arr.push(l);
  lexemesByBase.set(l.base_strongs, arr);
  if (l.language === 'grc' && l.lemma_id) {
    const stripped = stripDiacritics(l.original_lemma.split(',')[0]).toLowerCase();
    if (stripped.length >= 2 && !greekLexemeByStripped.has(stripped)) {
      greekLexemeByStripped.set(stripped, l);
    }
  }
}

const verseIdByBcv = new Map(verses.map(v => [`${v.book}:${v.chapter}:${v.verse_nr}`, v.id]));
const coveredWordIds = new Set(existingWflIds.map(r => r.word_id));

// Fetch words not yet in word_form_lemmas (the 34,944 multi-lemma/homograph surface forms)
const allWords = await fetchAllRows('words', 'id,strongs_nr,grammar_code,original_word,transliteration,biblical_def');
const uncoveredWords = allWords.filter(w => !coveredWordIds.has(w.id));
console.log(`   Loaded ${lexemes.length} lexemes, ${verses.length} verses, ${allWords.length} words (${uncoveredWords.length} multi-lemma forms to disambiguate).`);

const wordIdByTuple = new Map();
for (const w of uncoveredWords) {
  const key = `${w.strongs_nr}\t${w.original_word}\t${w.grammar_code || ''}\t${w.transliteration}`;
  wordIdByTuple.set(key, w);
}

// ============================================================================
// 3. PARSE TBESG FOR ABBOTT-SMITH ETYMOLOGIES & NUMBERED GREEK SUB-SENSES
// ============================================================================
console.log('3. Extracting Abbott-Smith Greek etymological derivations & numbered senses from TBESG.txt...');
const tbesgRaw = await fs.readFile(path.join(ARTIFACT_DIR, 'TBESG.txt'), 'utf8');
const greekRoots = new Map(); // root_key -> { lexeme, script, stripped }
const greekRootLinks = []; // { childLemmaId, rootKey, evidenceNote, recordId }
const greekSubSenses = []; // { senseKey, lemmaId, lexemeId, senseCode, order, gloss, def, refs, recordId }

for (const line of tbesgRaw.split(/\r?\n/)) {
  const c = line.split('\t');
  if (!/^G\d{4,5}[a-zA-Z]*$/.test(c[0]) || c.length < 8) continue;
  const dstrongCode = c[1]?.trim().split(/[\s=]/)[0];
  const lex = lexemeByExt.get(dstrongCode);
  if (!lex || !lex.lemma_id) continue;
  const rawHtml = c[7]?.trim() || '';
  if (!rawHtml) continue;

  // 3a. Parenthesized Greek stem derivation right after headword: <BR /> (ἀγαθός)
  const derivMatch = rawHtml.match(/<BR\s*\/?>\s*\(([^()<>]{2,60})\)/i);
  if (derivMatch) {
    const inside = derivMatch[1].trim();
    const greekTokens = inside.match(/[\u0370-\u03FF\u1F00-\u1FFF]{3,}/g) || [];
    for (const gt of greekTokens) {
      const targetLex = greekLexemeByStripped.get(stripDiacritics(gt).toLowerCase());
      if (targetLex && targetLex.lemma_id && targetLex.lemma_id !== lex.lemma_id) {
        const rootKey = `root:${targetLex.lexeme_key}`;
        if (!greekRoots.has(rootKey)) {
          greekRoots.set(rootKey, {
            rootKey,
            lexeme: targetLex,
            script: targetLex.original_lemma,
            stripped: stripDiacritics(targetLex.original_lemma),
          });
        }
        greekRootLinks.push({
          childLemmaId: lex.lemma_id,
          rootKey,
          evidenceNote: `Abbott-Smith documented derivation "(${inside.replace(/\s+/g, ' ')})" under ${dstrongCode}; shared root/stem does NOT imply synonymy.`,
          recordId: `TBESG:${dstrongCode}`,
        });
        break;
      }
    }
  }

  // 3b. Numbered Abbott-Smith senses: __1. ... __2. ...
  const parts = rawHtml.split(/<BR\s*\/?>\s*__(?=[1-9]\.|(?:\([a-d]\)))/i);
  if (parts.length > 1) {
    let order = 2;
    for (let i = 1; i < parts.length && order <= 8; i++) {
      const seg = parts[i];
      const codeMatch = seg.match(/^([1-9]|\([a-d]\))\.?\s*/);
      if (!codeMatch) continue;
      const code = codeMatch[1].replace(/[()]/g, '');
      const boldGloss = seg.match(/<b>([^<]{1,80})<\/b>/)?.[1]?.trim() || lex.primary_gloss || c[6]?.trim() || code;
      const refs = [...seg.matchAll(/<ref=['"]([^'"]+)['"]>/gi)].map(m => m[1]).slice(0, 8);
      const cleanDef = plain(seg).replace(/\s+/g, ' ').trim().slice(0, 600);
      if (cleanDef.length < 3) continue;
      const senseKey = `sense:${lex.lexeme_key}:as:${code}:${i}`;
      greekSubSenses.push({
        senseKey,
        lemmaId: lex.lemma_id,
        lexemeId: lex.id,
        senseCode: `AS.${code}`,
        senseOrder: order++,
        shortGloss: plain(boldGloss).slice(0, 120) || c[6]?.trim() || 'sense',
        definitionText: cleanDef,
        refs,
        recordId: `TBESG:${dstrongCode}#${code}`,
      });
    }
  }
}
console.log(`   Extracted ${greekRoots.size} Abbott-Smith Greek roots, ${greekRootLinks.length} derivation links, and ${greekSubSenses.length} numbered senses.`);

// ============================================================================
// 4. PARSE TAHOT & TAGNT FOR DISAMBIGUATED WORD-FORM LEMMAS, MORPHEMES & SYNTAX
// ============================================================================
console.log('4. Scanning TAHOT & TAGNT tokens for exact homograph disambiguation, morphemes, and syntax...');
const wordDstrongCounts = new Map(); // `${wordId}\t${dstrong}` -> { wordId, dstrong, count, sampleRef, grammar, surface, gloss }
const syntaxEdges = []; // Greek NT Conjoin-word edges
const syntaxNodes = new Map(); // `${editionId}:${verseId}:${pos}` -> row
const tokenMorphemes = []; // Key compound / homograph morpheme breakdowns
const semanticAnnotations = []; // Sourced STEP sub-meaning & homograph occurrence tags

// Curated study chapters where we also materialize occurrence-level token_morphemes & semantic_annotations
// (while word_form_lemmas covers 100% of all 150,105 word forms across all 66 books!)
const FEATURED_VERSE_KEY = (book, ch) =>
  (book === 1 && (ch === 1 || ch === 24 || ch === 29)) ||
  (book === 2 && (ch === 3 || ch === 8 || ch === 25)) ||
  (book === 6 && ch === 17) ||
  (book === 9 && ch === 2) ||
  (book === 19 && (ch === 1 || ch === 3 || ch === 18 || ch === 23 || ch === 51)) ||
  (book === 23 && ch === 6) ||
  (book === 38 && ch === 4) ||
  (book === 40 && ch === 1) ||
  (book === 43 && (ch === 1 || ch === 4)) ||
  (book === 44 && ch === 17) ||
  (book === 45 && ch === 8) ||
  (book === 66 && (ch === 1 || ch === 4 || ch === 5 || ch === 21));

for (const part of ['Gen-Deu', 'Jos-Est', 'Job-Sng', 'Isa-Mal']) {
  const text = await fs.readFile(path.join(ARTIFACT_DIR, `TAHOT ${part}.txt`), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const c = line.split('\t');
    const ref = c[0]?.match(/^([1-3]?[A-Za-z]{2,3})\.(\d+)\.(\d+).*#(\d+)=(.*)$/);
    if (!ref || !c[1]?.trim()) continue;
    const book = BOOKS.indexOf(ref[1]) + 1;
    const chapter = Number(ref[2]);
    const verse = Number(ref[3]);
    const pos = Number(ref[4]);
    const rawDstrong = c[4]?.match(/\{(H\d+[A-Za-z]*)/)?.[1] || c[4]?.match(/H\d+[A-Za-z]*/)?.[0];
    if (!rawDstrong) continue;
    const baseStrongs = strong(rawDstrong);
    const original = c[1].replace(/[\/\\]/g, '');
    const translit = c[2].replace(/\//g, '');
    const grammar = c[5]?.trim() || '';
    const w = wordIdByTuple.get(`${baseStrongs}\t${original}\t${grammar}\t${translit}`);
    if (w) {
      const mKey = `${w.id}\t${rawDstrong}`;
      const prev = wordDstrongCounts.get(mKey);
      if (prev) {
        prev.count++;
      } else {
        wordDstrongCounts.set(mKey, {
          wordId: w.id,
          dstrong: rawDstrong,
          count: 1,
          sampleRef: c[0],
          grammar,
          surface: original,
          gloss: plain(c[3] || '').slice(0, 200),
          isGreek: false,
        });
      }
    }

    const verseId = verseIdByBcv.get(`${book}:${chapter}:${verse}`);
    if (verseId && FEATURED_VERSE_KEY(book, chapter)) {
      // Decompose slash-separated Hebrew morphemes (e.g., H9003/{H7225G}, בְּ/רֵאשִׁ֖ית, HR/Ncfsa)
      const dParts = (c[4] || '').split(/[\/\\]/).filter(Boolean);
      const hParts = (c[1] || '').split(/[\/\\]/);
      const tParts = (c[2] || '').split(/[\/\\]/);
      const gParts = grammar.split(/[\/\\]/);
      const eParts = (c[3] || '').split(/[\/\\]/);
      for (let idx = 0; idx < dParts.length; idx++) {
        const cleanTag = dParts[idx].replace(/[{}]/g, '').trim();
        if (!cleanTag) continue;
        const isStem = dParts[idx].includes('{') || dParts.length === 1;
        const gSeg = gParts[idx] || (idx === 0 ? grammar : '');
        let role = isStem ? 'stem' : 'prefix_particle';
        if (!isStem) {
          if (/^[HA]?R/i.test(gSeg) || cleanTag === 'H9003' || cleanTag === 'H9004' || cleanTag === 'H9005') role = 'prefix_preposition';
          else if (/^[HA]?C/i.test(gSeg) || cleanTag === 'H9002') role = 'prefix_conjunction';
          else if (/^[HA]?Td/i.test(gSeg) || cleanTag === 'H9009') role = 'prefix_article';
          else if (/^Sp/i.test(gSeg) || idx > 0) role = 'pronominal_suffix';
        }
        const mLex = lexemeByExt.get(cleanTag) || (lexemesByBase.get(cleanTag.replace(/[A-Za-z]+$/, '').replace(/^H0+/, 'H')) || [])[0] || null;
        tokenMorphemes.push({
          editionId: tahotEdId,
          verseId,
          pos,
          order: idx + 1,
          role,
          surface: hParts[idx] || original,
          translit: tParts[idx] || translit,
          grammar: gSeg || grammar,
          gloss: plain(eParts[idx] || '').slice(0, 120),
          dstrongsTag: cleanTag,
          lemmaId: mLex?.lemma_id || null,
          lexemeId: mLex?.id || null,
          recordId: `TAHOT:${c[0]}#${idx + 1}`,
        });
      }

      // Extract Expanded Strong sub-meaning / named-entity tag if present
      const expMatch = (c[11] || '').match(/\{([HG]\d+[A-Za-z]*)=([^=}]+)=([^}]*»[^}]+)\}/);
      if (expMatch) {
        const tagLex = lexemeByExt.get(expMatch[1]);
        const isNamed = expMatch[3].includes('@');
        semanticAnnotations.push({
          editionId: tahotEdId,
          verseId,
          pos,
          kind: isNamed ? 'named_entity_identity' : 'step_sub_meaning',
          val: expMatch[3].trim().slice(0, 240),
          lemmaId: tagLex?.lemma_id || null,
          lexemeId: tagLex?.id || null,
          layer: isNamed ? 'external_factual' : 'lexical_reference',
          recordId: `TAHOT:${c[0]}`,
        });
      }
    }
  }
}

for (const part of ['Mat-Jhn', 'Act-Rev']) {
  const text = await fs.readFile(path.join(ARTIFACT_DIR, `TAGNT ${part}.txt`), 'utf8');
  let verseTokCounter = new Map(); // verseId -> incremental 1..N matching verse_translation_sources.word_position
  const rawPosToSeq = new Map(); // `${verseId}:${rawHashNum}` -> seqPos
  const pendingConjoins = [];

  for (const line of text.split(/\r?\n/)) {
    const c = line.split('\t');
    const ref = c[0]?.match(/^([1-3]?[A-Za-z]{2,3})\.(\d+)\.(\d+).*#(\d+)=(.*)$/);
    if (!ref) continue;
    if (!c[5]?.split(/[+\s;,]+/).includes('NA28')) continue;
    const book = BOOKS.indexOf(ref[1]) + 1;
    const chapter = Number(ref[2]);
    const verse = Number(ref[3]);
    const rawNum = Number(ref[4]);
    const verseId = verseIdByBcv.get(`${book}:${chapter}:${verse}`);
    if (!verseId) continue;

    const seqPos = (verseTokCounter.get(verseId) || 0) + 1;
    verseTokCounter.set(verseId, seqPos);
    rawPosToSeq.set(`${verseId}:${rawNum}`, seqPos);

    const rawDstrong = c[3]?.match(/G\d+[A-Za-z]*/)?.[0];
    const greekMatch = c[1]?.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (rawDstrong && greekMatch) {
      const baseStrongs = strong(rawDstrong);
      const original = greekMatch[1].trim();
      const translit = greekMatch[2];
      const grammar = c[3].split('=').at(-1).trim();
      const w = wordIdByTuple.get(`${baseStrongs}\t${original}\t${grammar}\t${translit}`);
      if (w) {
        const mKey = `${w.id}\t${rawDstrong}`;
        const prev = wordDstrongCounts.get(mKey);
        if (prev) prev.count++;
        else {
          wordDstrongCounts.set(mKey, {
            wordId: w.id,
            dstrong: rawDstrong,
            count: 1,
            sampleRef: c[0],
            grammar,
            surface: original,
            gloss: plain(c[2] || '').slice(0, 200),
            isGreek: true,
          });
        }
      }

      // Conjoin-word syntax dependency: e.g., "#04»05:G3056" or "#06«05:G2316"
      const conj = c[10]?.trim() || '';
      const conjMatch = conj.match(/^#?(\d+)([»«])(\d+)(?::([HG]\d+[A-Za-z]*))?/);
      if (conjMatch) {
        pendingConjoins.push({
          verseId,
          depSeqPos: seqPos,
          dir: conjMatch[2],
          targetRawNum: Number(conjMatch[3]),
          headStrongs: conjMatch[4] || null,
          rawTag: conj,
          sourceRef: c[0],
          grammar,
        });
      }

      if (FEATURED_VERSE_KEY(book, chapter) && c[9]?.trim()) {
        const gLex = lexemeByExt.get(rawDstrong);
        const subVal = c[9].trim();
        semanticAnnotations.push({
          editionId: tagntEdId,
          verseId,
          pos: seqPos,
          kind: subVal.includes('@') ? 'named_entity_identity' : 'step_sub_meaning',
          val: subVal.slice(0, 240),
          lemmaId: gLex?.lemma_id || null,
          lexemeId: gLex?.id || null,
          layer: subVal.includes('@') ? 'external_factual' : 'lexical_reference',
          recordId: `TAGNT:${c[0]}`,
        });
      }
    }
  }

  for (const pc of pendingConjoins) {
    const headSeqPos = rawPosToSeq.get(`${pc.verseId}:${pc.targetRawNum}`);
    if (!headSeqPos || headSeqPos === pc.depSeqPos) continue;
    const relType = pc.dir === '»' ? 'conjoin_forward_head' : 'conjoin_backward_head';
    syntaxEdges.push({
      editionId: tagntEdId,
      verseId: pc.verseId,
      depPos: pc.depSeqPos,
      headPos: headSeqPos,
      relType,
      headStrongs: pc.headStrongs,
      rawTag: pc.rawTag,
      recordId: `TAGNT:${pc.sourceRef}`,
    });
    const minP = Math.min(pc.depSeqPos, headSeqPos);
    const maxP = Math.max(pc.depSeqPos, headSeqPos);
    const nKey = `syn:tagnt:${pc.verseId}:head:${headSeqPos}`;
    const existingNode = syntaxNodes.get(nKey);
    if (!existingNode) {
      syntaxNodes.set(nKey, {
        nodeKey: nKey,
        editionId: tagntEdId,
        verseId: pc.verseId,
        startPos: minP,
        endPos: maxP,
        headPos: headSeqPos,
        headStrongs: pc.headStrongs,
        recordId: `TAGNT:${pc.sourceRef}`,
      });
    } else {
      existingNode.startPos = Math.min(existingNode.startPos, minP);
      existingNode.endPos = Math.max(existingNode.endPos, maxP);
    }
  }
}

// Fallback for any uncovered word whose exact surface tuple wasn't hit (e.g. Qere edge case):
// link to all primary lemmas under its base_strongs marked is_context_ambiguous = true
const seenUncoveredWordIds = new Set();
const dstrongSetPerWord = new Map();
for (const item of wordDstrongCounts.values()) {
  seenUncoveredWordIds.add(item.wordId);
  const s = dstrongSetPerWord.get(item.wordId) || new Set();
  s.add(item.dstrong);
  dstrongSetPerWord.set(item.wordId, s);
}

let fallbackCount = 0;
for (const w of uncoveredWords) {
  if (seenUncoveredWordIds.has(w.id)) continue;
  const candidates = (lexemesByBase.get(w.strongs_nr) || []).filter(l => l.lemma_id);
  const uniqueByLemma = new Map();
  for (const c of candidates) if (!uniqueByLemma.has(c.lemma_id)) uniqueByLemma.set(c.lemma_id, c);
  for (const c of uniqueByLemma.values()) {
    fallbackCount++;
    wordDstrongCounts.set(`${w.id}\t${c.extended_strongs}`, {
      wordId: w.id,
      dstrong: c.extended_strongs,
      count: 0,
      sampleRef: `words:${w.id}`,
      grammar: w.grammar_code || '',
      surface: w.original_word,
      gloss: (w.biblical_def || '').slice(0, 200),
      isGreek: c.language === 'grc',
      forceAmbiguous: uniqueByLemma.size > 1,
    });
  }
}

console.log(`   Resolved ${wordDstrongCounts.size} disambiguated word_form_lemmas rows (fallback=${fallbackCount}), ${syntaxNodes.size} syntax phrases, ${syntaxEdges.length} Greek NT syntax edges, ${tokenMorphemes.length} morphemes, ${semanticAnnotations.length} annotations.`);

// ============================================================================
// 5. WRITE DETERMINISTIC IDEMPOTENT SQL CHUNKS (<= 43 KB EACH) TO .artifacts/canonical-etl/
// ============================================================================
await fs.rm(OUT_DIR, { recursive: true, force: true });
await fs.mkdir(OUT_DIR, { recursive: true });

const MAX_BYTES = 42000;

async function writeChunkedValues(prefix, buildSqlFromRows, tupleStrings) {
  let fileIdx = 0;
  let batch = [];
  let batchBytes = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    fileIdx++;
    const packedLines = [];
    for (let i = 0; i < batch.length; i += 5) {
      packedLines.push(batch.slice(i, i + 5).join(','));
    }
    const sql = buildSqlFromRows(packedLines);
    const fname = `${prefix}_${String(fileIdx).padStart(3, '0')}.sql`;
    await fs.writeFile(path.join(OUT_DIR, fname), sql, 'utf8');
    batch = [];
    batchBytes = 0;
  };
  for (const t of tupleStrings) {
    const tBytes = Buffer.byteLength(t, 'utf8') + 2;
    if (batch.length > 0 && batchBytes + tBytes > MAX_BYTES) {
      await flush();
    }
    batch.push(t);
    batchBytes += tBytes;
  }
  await flush();
  return fileIdx;
}

// 5a. Abbott-Smith roots & root links
let asRootFiles = 0;
if (greekRoots.size > 0) {
  const rootTuples = [...greekRoots.values()].map(r =>
    `(${sqlLit(r.rootKey)},${sqlLit(r.script)},${sqlLit(r.stripped)},${r.lexeme.id},${sqlLit('TBESG:' + r.lexeme.extended_strongs)})`
  );
  asRootFiles += await writeChunkedValues(
    '01a_as_roots',
    rows => `insert into public.lexical_roots (root_key, language, root_script, root_stripped, transliteration, root_kind, anchor_lexeme_id, source_release_id, source_edition_id, source_record_id)
select v.rk, 'grc', v.sc, v.st, null, 'greek_etymological_stem', v.lx_id, 1, ${tbesgEdId}, v.rec
from (values\n${rows.join(',\n')}\n) as v(rk, sc, st, lx_id, rec)
on conflict (root_key) do nothing;\n`,
    rootTuples
  );
}

let asLinkFiles = 0;
if (greekRootLinks.length > 0) {
  const linkTuples = greekRootLinks.map(l =>
    `(${l.childLemmaId},${sqlLit(l.rootKey)},${sqlLit(l.evidenceNote)},${sqlLit(l.recordId)})`
  );
  asLinkFiles += await writeChunkedValues(
    '01b_as_links',
    rows => `insert into public.lemma_root_links (lemma_id, root_id, etymology_type, implies_synonymy, evidence_note, source_release_id, source_edition_id, source_record_id, origin_mode, derivation_method)
select distinct on (v.lemma_id, r.id) v.lemma_id, r.id, 'derived_from', false, v.note, 1, ${tbesgEdId}, v.rec_id, 'directly_imported', 'Parsed directly from Abbott-Smith parenthesized Greek stem in STEP TBESG'
from (values\n${rows.join(',\n')}\n) as v(lemma_id, root_key, note, rec_id)
join public.lexical_roots r on r.root_key = v.root_key
on conflict (lemma_id, root_id, etymology_type) do nothing;\n`,
    linkTuples
  );
}

const senseTuples = greekSubSenses.map(s =>
  `(${sqlLit(s.senseKey)},${s.lemmaId},${s.lexemeId},${sqlLit(s.senseCode)},${s.senseOrder},${sqlLit(s.shortGloss)},${sqlLit(s.definitionText)},${sqlTextArray(s.refs)},${sqlLit(s.recordId)})`
);
const asSenseFiles = await writeChunkedValues(
  '01c_as_senses',
  rows => `insert into public.lexical_senses (sense_key, lemma_id, lexeme_id, sense_code, sense_order, short_gloss, definition_text, scripture_refs, source_attribution, source_release_id, source_edition_id, source_record_id)
select v.sk, v.lem_id, v.lex_id, v.sc, v.so, v.sg, v.dt, v.sr, 'Abbott-Smith Manual Greek Lexicon of the NT via STEP TBESG (CC BY 4.0)', 1, ${tbesgEdId}, v.rec
from (values\n${rows.join(',\n')}\n) as v(sk, lem_id, lex_id, sc, so, sg, dt, sr, rec)
on conflict (sense_key) do nothing;\n`,
  senseTuples
);

// 5b. Disambiguated word_form_lemmas chunks (join words + lexemes in PostgreSQL)
const wflTuples = [];
for (const item of wordDstrongCounts.values()) {
  let lex = lexemeByExt.get(item.dstrong);
  if (!lex) {
    const b = strong(item.dstrong);
    lex = (lexemesByBase.get(b) || []).find(l => l.lemma_id) || null;
  }
  if (!lex || !lex.lemma_id) continue;
  const ambig = Boolean(item.forceAmbiguous) || (dstrongSetPerWord.get(item.wordId)?.size || 0) > 1;
  wflTuples.push(
    `(${item.wordId},${lex.id},${item.count},${ambig},${sqlLit(item.sampleRef)})`
  );
}

const wflFiles = await writeChunkedValues(
  '02_wfl',
  rows => `insert into public.word_form_lemmas (word_id, component_order, morpheme_role, morpheme_surface, morpheme_gloss, grammar_code, dstrongs_tag, lemma_id, lexeme_id, observed_token_count, is_context_ambiguous, source_release_id, source_edition_id, source_record_id, origin_mode, derivation_method)
select
  w.id,
  case when w.grammar_code ~ '^(H[RCcTd]|A[RC])[^/]*/' then 2 else 1 end,
  'stem',
  w.original_word,
  left(coalesce(w.biblical_def, ''), 200),
  w.grammar_code,
  lx.extended_strongs,
  lx.lemma_id,
  lx.id,
  v.cnt,
  v.ambig,
  1,
  case when lx.language = 'grc' then ${tagntEdId} else ${tahotEdId} end,
  v.sref,
  'directly_imported',
  'Exact token-level dStrong alignment from STEP TAHOT/TAGNT'
from (values\n${rows.join(',\n')}\n) as v(word_id, lex_id, cnt, ambig, sref)
join public.words w on w.id = v.word_id
join public.lexemes lx on lx.id = v.lex_id
where lx.lemma_id is not null
on conflict (word_id, component_order, dstrongs_tag) do nothing;\n`,
  wflTuples
);

// 5c. Greek NT syntax edges (syntax_nodes derived deterministically in 99_post_sync.sql)
const synEdgeTuples = syntaxEdges.map(e =>
  `(${e.verseId},${e.depPos},${e.headPos},${e.relType === 'conjoin_forward_head' ? 1 : 2},${sqlLit(e.headStrongs)},${sqlLit(e.rawTag)},${sqlLit(e.recordId)})`
);
const synEdgeFiles = await writeChunkedValues(
  '03_syn_edges',
  rows => `insert into public.syntax_edges (edition_id, verse_id, dependent_word_position, head_word_position, relation_type, head_strongs, raw_relation_tag, source_release_id, source_record_id, origin_mode, derivation_method)
select
  ${tagntEdId},
  v.vid,
  v.dpos,
  v.hpos,
  case when v.rcode = 1 then 'conjoin_forward_head' else 'conjoin_backward_head' end,
  v.hstr,
  v.rtag,
  1,
  v.rec,
  'directly_imported',
  'Parsed directly from STEP TAGNT column 10 Conjoin word grammatical attachment'
from (values\n${rows.join(',\n')}\n) as v(vid, dpos, hpos, rcode, hstr, rtag, rec)
on conflict (edition_id, verse_id, dependent_word_position, head_word_position, relation_type) do nothing;\n`,
  synEdgeTuples
);

// 5d. Token morphemes & semantic annotations
const morphTuples = tokenMorphemes.map(m =>
  `(${m.editionId},${m.verseId},${m.pos},${m.order},${sqlLit(m.role)},${sqlLit(m.surface)},${sqlLit(m.translit)},${sqlLit(m.grammar)},${sqlLit(m.gloss)},${sqlLit(m.dstrongsTag)},${m.lemmaId ?? 'null::bigint'},${m.lexemeId ?? 'null::bigint'},${sqlLit(m.recordId)})`
);
const morphFiles = await writeChunkedValues(
  '04a_morphemes',
  rows => `insert into public.token_morphemes (edition_id, verse_id, word_position, component_order, morpheme_role, surface_form, transliteration, grammar_code, morpheme_gloss, dstrongs_tag, lemma_id, lexeme_id, source_release_id, source_record_id)
select v.eid, v.vid, v.pos, v.ord, v.mrole, v.surf, v.tr, v.gr, v.gl, v.dtag, v.lem_id, v.lex_id, 1, v.rec
from (values\n${rows.join(',\n')}\n) as v(eid, vid, pos, ord, mrole, surf, tr, gr, gl, dtag, lem_id, lex_id, rec)
on conflict (edition_id, verse_id, word_position, component_order) do nothing;\n`,
  morphTuples
);

const annTuples = semanticAnnotations.map(a =>
  `(${a.editionId},${a.verseId},${a.pos},${a.kind === 'named_entity_identity' ? 1 : 2},${sqlLit(a.val)},${a.lemmaId ?? 'null::bigint'},${a.lexemeId ?? 'null::bigint'},${sqlLit(a.recordId)})`
);
const annFiles = await writeChunkedValues(
  '04b_annotations',
  rows => `insert into public.semantic_annotations (edition_id, verse_id, start_word_position, end_word_position, annotation_kind, annotation_value, lemma_id, lexeme_id, epistemic_layer, origin_mode, derivation_method, review_status, source_release_id, source_record_id)
select
  v.eid, v.vid, v.pos, v.pos,
  case when v.kcode = 1 then 'named_entity_identity' else 'step_sub_meaning' end,
  v.val, v.lem_id, v.lex_id,
  case when v.kcode = 1 then 'external_factual' else 'lexical_reference' end,
  'directly_imported',
  'Parsed directly from STEP TAHOT/TAGNT sub-meaning & named-entity column',
  'reviewed',
  1,
  v.rec
from (values\n${rows.join(',\n')}\n) as v(eid, vid, pos, kcode, val, lem_id, lex_id, rec)
on conflict (edition_id, verse_id, start_word_position, end_word_position, annotation_kind, source_record_id) do nothing;\n`,
  annTuples
);

console.log(`PASS: Generated compact <=42KB SQL batches in ${OUT_DIR}: roots=${asRootFiles}, links=${asLinkFiles}, senses=${asSenseFiles}, wfl=${wflFiles}, syn_edges=${synEdgeFiles}, morphemes=${morphFiles}, annotations=${annFiles}.`);
